import assert from 'node:assert/strict';
import { test } from 'node:test';
import { once } from 'node:events';
import { mkdirSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { createProgressServer } from '../../service/server.ts';
import { graphItems } from '../../shared/plan-graph.ts';
import { countItems, type Item, type PlanGraphRequest, type Request } from '../../shared/progress.ts';
import { readDetail, readPlanGraph, type ServiceHost } from '../../ui/shared/source.ts';
import { searchFixture } from '../fixtures/plan-task-search.ts';
import { createLargePlanReplay, generateLargePlan, largePlanProjection, largePlanSteps, LARGE_PLAN_ID, LARGE_PLAN_SEED, LARGE_PLAN_VERSION, type LargePlanStep } from '../fixtures/large-plan.ts';

function evidence(name: string, value: unknown) {
  if (!process.env.EVIDENCE) return;
  mkdirSync(process.env.EVIDENCE, { recursive: true });
  writeFileSync(`${process.env.EVIDENCE}/${name}.json`, JSON.stringify(value, null, 2) + '\n');
}
const edgeCount = (items: readonly { dependencies?: readonly string[] }[]) => items.reduce((n, i) => n + (i.dependencies?.length ?? 0), 0);
const structure = (items: readonly Item[]) => items.map(({ id, kind, title, parentId, dependencies }) => ({ id, kind, title, parentId, dependencies }));

function validateShape(step: LargePlanStep) {
  const { items } = step, byId = new Map(items.map(i => [i.id, i]));
  assert.equal(byId.size, items.length);
  assert.equal(items.length, step.itemCount);
  assert.equal(edgeCount(items), step.edgeCount);
  // Production validator checks both dependency and containment DAGs, references and kinds.
  assert.equal(graphItems(items).length, items.length);
  for (const item of items) {
    assert.ok((item.dependencies?.length ?? 0) <= 16);
    assert.equal(new Set(item.dependencies).size, item.dependencies?.length ?? 0);
    if (item.kind === 'group') {
      const layer = Number(item.id.slice(2));
      assert.equal(item.status, 'pending'); assert.deepEqual(item.dependencies, []);
      assert.equal(item.parentId, layer % 5 ? `G-${String(layer - layer % 5).padStart(2, '0')}` : undefined);
    } else {
      assert.ok(item.parentId); assert.equal(byId.get(item.parentId!)?.kind, 'group');
      for (const dependency of item.dependencies ?? []) {
        assert.equal(byId.get(dependency)?.kind, 'task');
        assert.ok(Number(dependency.slice(2, 4)) < Number(item.id.slice(2, 4)));
      }
    }
  }
}

test('large-plan generator: exact deterministic authored shape and reserved anchors', () => {
  const steps = largePlanSteps(), initial = steps[0], items = initial.items;
  assert.deepEqual(generateLargePlan(), generateLargePlan(LARGE_PLAN_SEED));
  assert.deepEqual(steps, largePlanSteps());
  assert.deepEqual(initial.counts, { done: 147, total: 931, remaining: 784, skipped: 49 });
  assert.equal(items.length, 1000); assert.equal(edgeCount(items), 2000);
  assert.equal(items.filter(i => i.kind === 'task').length, 980);
  assert.equal(items.filter(i => i.kind === 'group').length, 20);
  assert.equal(items.filter(i => i.parentId).length, 996);
  assert.equal(items.filter(i => i.dependencies?.length === 16).length, 6);
  assert.equal(items.filter(i => i.dependencies?.includes('T-00-48')).length, 56);
  const expectedStatuses = { pending: 588, working: 98, blocked: 98, done: 147, skipped: 49 };
  for (const seed of [LARGE_PLAN_SEED, 0, 0xffffffff]) {
    const generated = generateLargePlan(seed), tasks = generated.filter(i => i.kind === 'task');
    assert.deepEqual(Object.fromEntries(Object.keys(expectedStatuses).map(s => [s, tasks.filter(i => i.status === s).length])), expectedStatuses);
    for (const [id, status] of Object.entries({ 'T-00-00': 'pending', 'T-01-00': 'pending', 'T-01-01': 'pending', 'T-01-02': 'pending', 'T-00-01': 'done', 'T-00-02': 'done', 'T-00-04': 'done', 'T-00-48': 'done', 'T-19-48': 'done', 'T-00-03': 'skipped', 'T-01-03': 'blocked' })) assert.equal(tasks.find(i => i.id === id)?.status, status);
    assert.deepEqual(generated.map(({ status: _status, ...i }) => i), generateLargePlan().map(({ status: _status, ...i }) => i));
  }
  assert.notDeepEqual(generateLargePlan(0), generateLargePlan());
  for (const seed of [-1, 1.5, 0x100000000, NaN]) assert.throws(() => generateLargePlan(seed));
  // Independently enumerate every expected stored slot and edge, including wrap-around.
  for (let layer = 0; layer < 20; layer++) for (let column = 0; column < 49; column++) {
    const ll = String(layer).padStart(2, '0'), cc = String(column).padStart(2, '0');
    const item = items[layer * 50 + column + 1];
    assert.equal(items[layer * 50].id, `G-${ll}`);
    assert.equal(item.id, `T-${ll}-${cc}`); assert.equal(item.title, `Synthetic task ${ll}-${cc}`); assert.equal(item.parentId, `G-${ll}`);
    const prev = String(layer - 1).padStart(2, '0');
    const deps = layer ? [`T-${prev}-${cc}`, `T-${prev}-${String((column + 1) % 49).padStart(2, '0')}`] : [];
    if (column === 0 && layer >= 4 && (layer - 4) % 3 === 0) for (let c = 2; c <= 15; c++) deps.push(`T-${prev}-${String(c).padStart(2, '0')}`);
    if (layer >= 2 && column >= 20 && column <= 22) deps.push('T-00-48');
    assert.deepEqual(item.dependencies, deps);
  }
  for (const step of steps) validateShape(step);
});

async function runScenario() {
  const f = searchFixture(false), token = 'synthetic-large-plan-token';
  const server = createProgressServer(f.store, token);
  const reports: { op: string; bytes: number; items: number; revision: number; structuralRevision: number; chunk?: number; chunks?: number }[] = [];
  const operationIds = new Set<string>(), uploads = new Set<string>();
  let stagedChecks = 0;
  const original = f.store.apply.bind(f.store);
  f.store.apply = (value, ...args) => {
    const request = value as Request, bytes = Buffer.byteLength(JSON.stringify(value));
    assert.ok(bytes <= 16384); assert.ok(request.oid); assert.equal(request.plan, LARGE_PLAN_ID);
    assert.equal(operationIds.has(request.oid!), false); operationIds.add(request.oid!);
    if (request.op === 'stage' && request.chunk === 0) {
      assert.ok(request.upload); assert.equal(uploads.has(request.upload!), false); uploads.add(request.upload!);
    }
    if (request.items) {
      assert.ok(request.items.length <= 50);
      for (const i of request.items) assert.ok((i.dependencies?.length ?? 0) <= 16);
      if (request.rev === 7 && request.items.some(i => i.id === 'T-19-48')) assert.equal('status' in request.items.find(i => i.id === 'T-19-48')!, false);
    }
    if (request.changes) assert.ok(request.changes.length <= 50);
    const before = f.store.get(f.alpha.id, LARGE_PLAN_ID);
    const receipt = original(value, ...args);
    if (request.op === 'stage') {
      assert.deepEqual(f.store.get(f.alpha.id, LARGE_PLAN_ID), before);
      assert.equal(receipt.rev, before?.revision ?? 0); assert.equal(receipt.structuralRev, before?.structuralRevision ?? 0);
      assert.equal(receipt.staged, request.chunk);
      if (before) assert.deepEqual(f.store.planGraph(pin(before.revision)).items, graphItems(before.items));
      else assert.throws(() => f.store.planGraph(pin(1)), { code: 'not-found' });
      stagedChecks++;
    } else {
      assert.equal(receipt.rev, (before?.revision ?? 0) + 1);
      assert.equal(receipt.structuralRev, (before?.structuralRevision ?? 0) + (request.op === 'change' ? 0 : 1));
      if (request.changes) assert.deepEqual(receipt.changed, request.changes.map(i => i.id));
    }
    if (request.op === 'commit') assert.equal(request.chunks, 20);
    reports.push({ op: request.op, bytes, items: request.items?.length ?? request.changes?.length ?? 0, revision: receipt.rev, structuralRevision: receipt.structuralRev, ...(request.chunk === undefined ? {} : { chunk: request.chunk }), ...(request.chunks === undefined ? {} : { chunks: request.chunks }) });
    return receipt;
  };
  const pin = (revision: number): PlanGraphRequest => ({ storeId: f.storeId, binding: { sourceId: f.alpha.id, verified: true }, source: f.alpha.id, plan: LARGE_PLAN_ID, revision, cleanupRev: 0 });
  const requests: { route: string; status: number; bytes: number; ms: number }[] = [];
  let detailWallMs = 0;
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const host: ServiceHost = { serviceRequest: async q => {
    const start = performance.now();
    const response = await fetch(`${base}${q.path}?${new URLSearchParams(q.query)}`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000) });
    const body = await response.text();
    requests.push({ route: q.path, status: response.status, bytes: Buffer.byteLength(body), ms: performance.now() - start });
    return { status: response.status, body };
  } };
  async function graph(revision: number) {
    const response = await fetch(`${base}/health`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000) });
    assert.equal(response.status, 200); const health = await response.json(); assert.equal(health.planGraph, 1);
    const before = requests.length;
    const result = await readPlanGraph(host, health, pin(revision));
    assert.equal(requests.length - before, 1);
    assert.equal(requests.at(-1)!.route, '/v1/plan-graph');
    assert.ok(requests.at(-1)!.bytes <= 1048576);
    return result;
  }
  try {
    const replay = createLargePlanReplay(f);
    assert.throws(() => replay.advance('S1'), /in order/);
    const snapshots: unknown[] = [], checkpoints: Record<string, unknown>[] = [];
    let previous: Item[] | undefined;
    for (const step of replay.steps) {
      const reportStart = reports.length, start = performance.now();
      if (step.id === 'S0') replay.seed(); else replay.advance(step.id);
      const reportMs = performance.now() - start;
      const stored = f.store.get(f.alpha.id, LARGE_PLAN_ID)!;
      assert.equal(stored.sessionId, 'M');
      assert.equal(stored.revision, step.revision); assert.equal(stored.structuralRevision, step.structuralRevision);
      assert.equal(stored.title, step.title); assert.deepEqual(countItems(stored.items), step.counts);
      assert.deepEqual(largePlanProjection(stored.items), step.items);
      const status = (id: string) => stored.items.find(i => i.id === id)?.status;
      if (step.id === 'S1') assert.equal(status('T-00-00'), 'working');
      if (step.id === 'S2') {
        assert.equal(status('T-00-00'), 'done'); assert.equal(status('T-00-03'), 'done'); assert.equal(status('T-01-03'), 'pending');
      }
      if (step.id === 'S3') {
        const rotation = { pending: 'working', working: 'blocked', blocked: 'done', done: 'skipped', skipped: 'pending' };
        const changed = stored.items.filter(i => status(i.id) !== previous!.find(p => p.id === i.id)!.status);
        assert.deepEqual(changed.map(i => i.id), [...Array.from({ length: 49 }, (_, c) => `T-08-${String(c).padStart(2, '0')}`), 'T-09-00']);
        for (const item of changed) assert.equal(item.status, rotation[previous!.find(i => i.id === item.id)!.status]);
      }
      if (step.id === 'S4') assert.equal(stored.title, 'Synthetic dependency plan revised');
      if (step.id === 'S5') {
        const moved = stored.items.find(i => i.id === 'T-10-24')!;
        assert.equal(moved.title, 'Synthetic task moved'); assert.equal(moved.parentId, 'G-11');
        assert.deepEqual(moved.dependencies, ['T-09-24', 'T-08-25']);
        assert.equal(stored.items.findIndex(i => i.id === moved.id), previous!.findIndex(i => i.id === 'T-10-25'));
        assert.equal(stored.items.findIndex(i => i.id === 'T-10-25'), previous!.findIndex(i => i.id === moved.id));
      }
      assert.equal(stored.items.length, step.id === 'S6' ? 999 : 1000);
      assert.equal(edgeCount(stored.items), step.id === 'S6' ? 1998 : 2000);
      const committed = reports.slice(reportStart);
      const replacement = ['S0', 'S5', 'S6', 'S7'].includes(step.id);
      assert.equal(committed.length, replacement ? 21 : 1);
      if (replacement) {
        assert.deepEqual(committed.slice(0, 20).map(r => r.chunk), Array.from({ length: 20 }, (_, n) => n));
        assert.deepEqual(committed.slice(0, 20).map(r => r.items), Array.from({ length: 20 }, (_, n) => step.id === 'S6' && n === 19 ? 49 : 50));
        assert.equal(committed[20].op, 'commit');
      }
      if (previous && (step.class === 'status-only' || step.id === 'S4')) assert.deepEqual(structure(stored.items), structure(previous));
      if (previous && ['S5', 'S6', 'S7'].includes(step.id)) {
        const affected = new Set(step.affectedIds);
        assert.deepEqual(largePlanProjection(stored.items.filter(i => !affected.has(i.id))), largePlanProjection(previous.filter(i => !affected.has(i.id))));
      }
      const leaf = stored.items.find(i => i.id === 'T-19-48');
      if (step.id === 'S6') assert.equal(leaf, undefined);
      if (step.id === 'S7') assert.equal(leaf?.status, 'pending');
      if (step.id === 'S8') assert.equal(leaf?.status, 'working');
      const graphStart = requests.length, read = await graph(step.revision);
      assert.equal(read.ok, true); if (!read.ok) throw Error('Pinned graph failed');
      assert.deepEqual(read.graph, f.store.planGraph(pin(step.revision)));
      assert.equal(read.graph.complete, true); assert.equal(read.graph.itemCount, stored.items.length);
      assert.equal('nextCursor' in read.graph, false);
      assert.deepEqual(read.graph.items, graphItems(stored.items));
      if (step.id === 'S0') {
        const detailStart = requests.length, detailClock = performance.now();
        const detail = await readDetail(host, { sourceId: f.alpha.id, id: LARGE_PLAN_ID });
        detailWallMs = performance.now() - detailClock;
        assert.equal(detail.ok, true); if (!detail.ok) throw Error('Complete detail failed');
        assert.equal(detail.restarts, 0); assert.equal(requests.length - detailStart, 50);
        assert.deepEqual(graphItems(detail.detail.items), read.graph.items);
        assert.deepEqual(largePlanProjection(detail.detail.items), step.items);
      } else {
        const stale = await graph(step.revision - 1);
        assert.equal(stale.ok, false); if (stale.ok) throw Error('Old pin accepted');
        assert.equal(stale.reason, 'conflict'); assert.equal(stale.status, 409);
      }
      snapshots.push({ id: step.id, title: stored.title, revision: stored.revision, structuralRevision: stored.structuralRevision, items: largePlanProjection(stored.items) });
      checkpoints.push({ id: step.id, class: step.class, revision: stored.revision, structuralRevision: stored.structuralRevision, items: stored.items.length, edges: edgeCount(stored.items), counts: step.counts, affectedIds: step.affectedIds, edgeChanges: step.edgeChanges, parentChanges: step.parentChanges, reportRequests: committed.length, reportMs, graph: requests[graphStart] });
      previous = stored.items;
      assert.throws(() => replay.advance(step.id), /in order/);
    }
    assert.equal(stagedChecks, 80); assert.equal(reports.length, 89);
    assert.equal(reports.filter(r => r.op === 'stage').length, 80);
    assert.equal(reports.filter(r => r.op === 'commit').length, 4);
    assert.equal(uploads.size, 4);
    assert.throws(() => createLargePlanReplay(f).seed(), /Unexpected large-plan starting checkpoint/);
    return { snapshots, checkpoints, reports, requests, stagedChecks, detailWallMs };
  } finally {
    server.close(); await once(server, 'close'); f.cleanup();
  }
}

test('large-plan real reports and authenticated HTTP: S0–S8 and independent-store repeat', async () => {
  const first = await runScenario(), second = await runScenario();
  assert.deepEqual(second.snapshots, first.snapshots);
  const maxReportBytes = Math.max(...first.reports.map(r => r.bytes));
  evidence('fixture', { format: LARGE_PLAN_VERSION, seed: LARGE_PLAN_SEED, items: 1000, tasks: 980, groups: 20, edges: 2000, containmentLinks: 996, maxPrerequisites: 16, acceptedRequests: first.reports.length, stageRequests: 80, commitRequests: 4, initialStageRequests: 20, initialChunkItems: 50, maxReportBytes, requestLimitBytes: 16384, stagedChecks: first.stagedChecks, repeatedStores: 2, semanticRepeatMatched: true });
  evidence('replay', { format: LARGE_PLAN_VERSION, seed: LARGE_PLAN_SEED, checkpoints: first.checkpoints.map(({ reportMs: _reportMs, graph: _graph, ...facts }) => facts), independentStoreSemanticRepeat: true, observedRemoval: true, reintroducedStatus: 'pending', statusOnlyStructurePreserved: true, stalePinsConflicted: 8 });
  const detail = first.requests.filter(r => r.route === '/v1/plan'), graph = first.requests.filter(r => r.route === '/v1/plan-graph' && r.status === 200);
  evidence('performance', { format: LARGE_PLAN_VERSION, seed: LARGE_PLAN_SEED, runtime: process.version, serviceMode: 'temporary SQLite and authenticated loopback HTTP', sampleCount: 1, interpretation: 'Diagnostic service baseline, not a latency SLA or native-host proof', timingScope: 'Graph/detail request ms include fetch and body read; detailWallMs includes complete reader parsing; reportMs includes fixture assertions and staged-state inspections', acceptedReportRequests: first.reports.length, maxReportBytes, graphResponseLimitBytes: 1048576, successfulGraphRequests: graph.length, stalePinConflictRequests: first.requests.filter(r => r.status === 409).length, graphRequestsPerPinnedRead: 1, graphResponseBytes: graph.map(r => r.bytes), graphMs: graph.map(r => r.ms), detailRequests: detail.length, detailResponseBytes: detail.reduce((n, r) => n + r.bytes, 0), detailMs: detail.reduce((n, r) => n + r.ms, 0), detailWallMs: first.detailWallMs, checkpoints: first.checkpoints.map(({ id, reportMs, graph }) => ({ id, reportMs, graph })) });
});
