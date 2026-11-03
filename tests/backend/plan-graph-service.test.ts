import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdirSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { createProgressServer } from '../../service/server.ts';
import { Store } from '../../shared/store.ts';
import { LIMITS, type ItemInput, type PlanGraphRequest } from '../../shared/progress.ts';
import { GRAPH_LIMITS, graphItems } from '../../shared/plan-graph.ts';
import { searchFixture } from '../fixtures/plan-task-search.ts';
import { boundaryItems } from '../browser/ready-tasks-fixtures.ts';
import { readDetail, type ServiceHost } from '../../ui/shared/source.ts';

const summaries: Record<string, unknown[]> = { service: [], races: [], limits: [] };
function record(file: string, label: string, facts: Record<string, number | boolean | string> = {}) {
  summaries[file].push({ case: label, passed: true, ...facts });
  if (process.env.EVIDENCE) { mkdirSync(process.env.EVIDENCE, { recursive: true }); writeFileSync(`${process.env.EVIDENCE}/${file}.json`, JSON.stringify(summaries[file], null, 2) + '\n'); }
}
function items(n: number): ItemInput[] {
  return boundaryItems(n).map((item, i) => i === 0 ? { id: 'G', title: 'Group', kind: 'group', status: 'pending', dependencies: [`T-${n - 1}`] } : { ...item, id: `T-${i}`, title: 'Task', parentId: 'G', status: i === 1 ? 'working' : 'pending', ...(i > 1 ? { dependencies: [`T-${i - 1}`] } : {}) });
}
async function fixture() {
  const f = searchFixture(false), token = 'synthetic-graph-token';
  const server = createProgressServer(f.store, token); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const request = (plan = 'P'): PlanGraphRequest => ({ storeId: f.storeId, binding: { sourceId: f.alpha.id, verified: true }, source: f.alpha.id, plan, revision: f.store.get(f.alpha.id, plan)?.revision ?? 1, cleanupRev: 0 });
  const query = (r: PlanGraphRequest) => new URLSearchParams({ ...r, binding: JSON.stringify(r.binding), revision: String(r.revision), cleanupRev: String(r.cleanupRev) });
  async function get(path: string, init?: RequestInit) { const response = await fetch(base + path, { headers: { authorization: `Bearer ${token}` }, ...init }); const body = await response.text(); return { status: response.status, body, value: JSON.parse(body), headers: response.headers }; }
  const graph = (r = request()) => get(`/v1/plan-graph?${query(r)}`);
  const host: ServiceHost = { serviceRequest: async q => get(`${q.path}?${new URLSearchParams(q.query)}`) };
  return { ...f, base, token, request, query, get, graph, host, async close() { server.close(); await once(server, 'close'); f.cleanup(); } };
}
function refused(r: { status: number; value: unknown }, status: number, error: string) { assert.equal(r.status, status); assert.deepEqual(r.value, { error }); }

test('graph service: complete, minimal, identity-pinned, read-only and capture independent', async () => {
  const f = await fixture();
  try {
    f.seedPlan('P', 'Synthetic plan', items(41));
    f.seedPlan('P', 'Other source', [{ id: 'T-1', title: 'Other', kind: 'task', status: 'done' }], { ...f.actor, sourceId: f.beta.id });
    assert.equal((await f.get('/health')).value.planGraph, 1);
    const before = f.store.db.prepare('SELECT * FROM sqlite_master ORDER BY name').all();
    const dump = () => ['plans','revisions','receipts','contributions','meta'].map(table => f.store.db.prepare(`SELECT * FROM ${table}`).all());
    const data = dump(); const r = await f.graph();
    assert.equal(r.status, 200); assert.equal(r.value.itemCount, 41); assert.equal(r.value.complete, true);
    assert.equal(r.headers.get('cache-control'), 'no-store'); assert.equal(r.headers.get('x-content-type-options'), 'nosniff'); assert.match(r.headers.get('content-type')!, /^application\/json/);
    assert.deepEqual(r.value.items, graphItems(f.store.get(f.alpha.id, 'P')!.items));
    assert.deepEqual(Object.keys(r.value).sort(), ['protocolVersion','schemaVersion','planGraph','storeId','sourceBinding','source','plan','revision','structuralRevision','cleanup','complete','itemCount','items'].sort());
    assert.deepEqual(r.value.cleanup, { state: 'visible', revision: 0 });
    assert.deepEqual(dump(), data); assert.deepEqual(f.store.db.prepare('SELECT * FROM sqlite_master ORDER BY name').all(), before);
    f.store.setEnabled(false); assert.deepEqual((await f.graph()).value.items, r.value.items);
    const ro = new Store(f.store.file, { readOnly: true }); ro.bindReads(f.alpha.id, true);
    try { assert.deepEqual(ro.planGraph(f.request()).items, r.value.items); } finally { ro.close(); }
    refused(await f.graph(f.request('missing')), 404, 'not-found');
    f.store.setEnabled(true); f.seedPlan('empty', 'Empty', []); assert.deepEqual((await f.graph(f.request('empty'))).value.items, []);
    f.seedPlan('repeats', 'Recorded repeats', [{ id: 'G', title: 'Group', kind: 'group', dependencies: ['T','T'] }, { id: 'T', title: 'Task', kind: 'task' }]);
    assert.deepEqual((await f.graph(f.request('repeats'))).value.items[0].dependencies, ['T','T']);
    const high = f.store.get(f.alpha.id, 'empty')!; high.revision = 10000000000;
    f.store.db.prepare('UPDATE plans SET revision=?,snapshot=? WHERE source=? AND id=?').run(high.revision, JSON.stringify(high), f.alpha.id, 'empty');
    assert.equal((await f.graph(f.request('empty'))).value.revision, high.revision);
    record('service', 'complete-minimal-read-only-capture-off-legacy', { status: 200, items: 41 });
  } finally { await f.close(); }
});

test('graph service: fixed request refusals and store errors', async () => {
  const f = await fixture();
  try {
    f.seedPlan('P', 'Plan', items(3)); const r = f.request(); const path = `/v1/plan-graph?${f.query(r)}`;
    refused(await f.get(path, { headers: {} }), 401, 'unauthorized');
    refused(await f.get(path, { method: 'POST' }), 405, 'method-not-allowed');
    refused(await f.get(path, { method: 'POST', body: 'x' }), 405, 'method-not-allowed');
    // A transfer-encoded GET body must be rejected before any graph read.
    const { request } = await import('node:http');
    const bodyReply = await new Promise<{ status: number; value: unknown }>((resolve, reject) => {
      const req = request(new URL(path, f.base), { method: 'GET', headers: { authorization: `Bearer ${f.token}`, 'content-length': '1' } }, res => {
        let body = ''; res.setEncoding('utf8'); res.on('data', chunk => { body += chunk; }); res.on('end', () => resolve({ status: res.statusCode!, value: JSON.parse(body) }));
      }); req.on('error', reject); req.end('x');
    });
    refused(bodyReply, 400, 'body-not-allowed');
    for (const extra of ['&cursor=1','&page=0','&limit=1','&plan=P']) refused(await f.get(path + extra), 404, 'not-found');
    for (const key of ['storeId','binding','source','plan','revision','cleanupRev']) { const q = f.query(r); q.delete(key); refused(await f.get(`/v1/plan-graph?${q}`), 400, 'invalid'); }
    for (const revision of ['0','-1','NaN','9007199254740992','1.2']) { const q = f.query(r); q.set('revision', revision); refused(await f.get(`/v1/plan-graph?${q}`), 400, 'invalid'); }
    const large = f.query(r); large.set('binding', 'x'.repeat(17000)); refused(await f.get(`/v1/plan-graph?${large}`), 400, 'invalid');
    for (const changed of [{ storeId: 'other' }, { revision: 9999999999 }, { cleanupRev: 1 }, { binding: { sourceId: f.beta.id, verified: false } }]) refused(await f.graph({ ...r, ...changed }), 409, 'conflict');
    f.store.db.exec('PRAGMA user_version=3'); refused(await f.graph(r), 503, 'schema'); f.store.db.exec('PRAGMA user_version=2');
    for (const code of ['busy','storage','schema','binding'] as const) {
      const server = createProgressServer(undefined, 'synthetic', code); server.listen(0, '127.0.0.1'); await once(server, 'listening');
      try { const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}${path}`, { headers: { authorization: 'Bearer synthetic' } }); assert.equal(response.status, 503); assert.deepEqual(await response.json(), { error: code }); }
      finally { server.close(); await once(server, 'close'); }
    }
    record('service', 'request-and-store-refusals', { passed: true });
  } finally { await f.close(); }
});

test('fault-only SQL snapshots fail closed and admission precedes materialization', async () => {
  const f = await fixture();
  try {
    f.seedPlan('P', 'Plan', items(3)); const r = f.request(), original = f.store.get(f.alpha.id, 'P')!;
    f.store.db.exec('PRAGMA ignore_check_constraints=ON'); // Fault injection only, not an accepted write.
    const inject = (text: string) => f.store.db.prepare('UPDATE plans SET snapshot=? WHERE source=? AND id=?').run(text, r.source, r.plan);
    for (const bad of ['{', ...[
      { ...original, sourceId: 'wrong' }, { ...original, revision: 0 }, { ...original, structuralRevision: 99 },
      { ...original, items: [original.items[0], original.items[0]] },
      { ...original, items: [{ ...original.items[1], parentId: 'missing' }] },
      { ...original, items: [{ ...original.items[1], dependencies: ['missing'] }] },
      { ...original, items: [{ ...original.items[1], dependencies: ['T-1'] }] },
      { ...original, items: [{ ...original.items[1], parentId: undefined, dependencies: ['T-2'] }, { ...original.items[2], parentId: undefined, dependencies: ['T-1'] }] },
      { ...original, items: [{ id: 'G', kind: 'group', status: 'pending', parentId: 'H' }, { id: 'H', kind: 'group', status: 'pending', parentId: 'G' }] },
      { ...original, items: items(1001) }, { ...original, items: [{ id: 'x', kind: 'unknown', status: 'pending' }] },
      { ...original, items: [{ ...original.items[0], status: ['pending'] }, ...original.items.slice(1)] },
      { ...original, items: [{ ...original.items[0], dependencies: Array(17).fill('T-1') }, ...original.items.slice(1)] },
    ].map(v => JSON.stringify(v))]) { inject(bad); refused(await f.graph(r), 503, 'corrupt'); }
    inject(' '.repeat(GRAPH_LIMITS.inputBytes + 1));
    const prepare = f.store.db.prepare.bind(f.store.db); let admitted = false;
    f.store.db.prepare = ((sql: string) => {
      const statement = prepare(sql);
      if (sql.includes('THEN snapshot END')) { const get = statement.get.bind(statement); statement.get = ((...args: Parameters<typeof get>) => { const row = get(...args); assert.equal(row?.snapshot, null); admitted = true; return row; }) as typeof statement.get; }
      return statement;
    }) as typeof f.store.db.prepare;
    refused(await f.graph(r), 503, 'corrupt'); assert.equal(admitted, true); f.store.db.prepare = prepare;
    inject(JSON.stringify(original));
    const exact = JSON.stringify({ ...original, padding: '' });
    inject(JSON.stringify({ ...original, padding: 'x'.repeat(GRAPH_LIMITS.inputBytes - Buffer.byteLength(exact)) }));
    assert.equal((await f.graph(r)).status, 200);
    inject(JSON.stringify(original));
    const graph = f.store.planGraph.bind(f.store);
    // Structurally valid, but impossible under accepted structural-upload byte budgets.
    const names = Array.from({ length: 1000 }, (_, n) => `T${String(n).padStart(4, '0')}${'x'.repeat(75)}`);
    const largeItems = graphItems(names.map((id, n) => ({ id, kind: 'task', status: 'pending', dependencies: names.slice(Math.max(0, n - 16), n) })));
    f.store.planGraph = () => ({ ...graph(r), items: largeItems, itemCount: largeItems.length });
    refused(await f.graph(r), 413, 'response-too-large'); f.store.planGraph = graph;
    record('limits', 'fault-only-input-admission-and-output-ceiling', { inputBytes: GRAPH_LIMITS.inputBytes, outputCeiling: LIMITS.responseBytes });
  } finally { await f.close(); }
});

test('real held replies: detail restarts, graph remains captured, cleanup and binding pins conflict', { timeout: 15000 }, async () => {
  const f = await fixture();
  try {
    f.seedPlan('P', 'Plan', items(41));
    async function held<T>(path: string, read: (host: ServiceHost) => Promise<T>, mutate: () => void) {
      let release!: () => void, reached!: () => void; const gate = new Promise<void>(r => { release = r; }); const seen = new Promise<void>(r => { reached = r; }); let first = true, completed = false;
      const host: ServiceHost = { serviceRequest: async q => { const response = await f.host.serviceRequest(q); if (first && q.path === path) { first = false; reached(); await gate; } return response; } };
      const pending = read(host).then(r => { completed = true; return r; }); await seen; assert.equal(completed, false); mutate(); release(); return pending;
    }
    const replacement = items(41).map((i, n) => n === 0 ? { ...i, id: 'H', dependencies: ['N-40'] } : { ...i, id: `N-${n}`, parentId: 'H', dependencies: n > 1 ? ['N-1'] : [], status: 'done' as const });
    const detail = await held('/v1/plan', host => readDetail(host, { sourceId: f.alpha.id, id: 'P' }), () => { f.apply('P', { op: 'revise', items: replacement }); });
    assert.equal(detail.ok, true); if (!detail.ok) throw Error('detail failed'); assert.equal(detail.restarts, 1); assert.deepEqual(graphItems(detail.detail.items), graphItems(f.store.get(f.alpha.id, 'P')!.items));
    const r = f.request(), old = (await f.graph(r)).value;
    const next: ItemInput[] = replacement.filter(i => i.id !== 'N-2').map(i => i.id === 'N-3' ? { ...i, parentId: undefined, dependencies: ['N-new'] } : i);
    next.push({ id: 'N-new', title: 'New task', kind: 'task', status: 'working', parentId: 'H', dependencies: ['N-1'] });
    const captured = await held('/v1/plan-graph', host => host.serviceRequest({ method: 'GET', path: '/v1/plan-graph', query: Object.fromEntries(f.query(r)) }), () => { f.apply('P', { op: 'revise', items: next }); });
    assert.deepEqual(JSON.parse(captured.body), old); refused(await f.graph(r), 409, 'conflict');
    const refreshed = (await f.graph()).value;
    assert.equal(refreshed.revision, r.revision + 1); assert.equal(refreshed.complete, true); assert.equal(refreshed.itemCount, next.length);
    assert.deepEqual(refreshed.items, graphItems(next));
    f.apply('P', { op: 'change', changes: [{ id: 'N-new', status: 'done' }] }); f.apply('P', { op: 'finish', outcome: 'finished' });
    let pin = f.request();
    const cleanup = (action: 'archive' | 'restore', generation: number) => f.store.cleanup(action, { storeId: pin.storeId, source: pin.source, plan: pin.plan, rev: pin.revision, cleanupRev: generation, oid: `cleanup-${action}` });
    const archived = await held('/v1/plan', host => readDetail(host, { sourceId: pin.source, id: pin.plan }), () => { cleanup('archive', 0); });
    assert.equal(archived.ok, true); if (archived.ok) { assert.equal(archived.restarts, 1); assert.equal(archived.plan.revision, pin.revision); assert.deepEqual(archived.plan.cleanup, { state: 'archived', revision: 1 }); }
    refused(await f.graph(pin), 409, 'conflict'); pin = { ...pin, cleanupRev: 1 }; assert.equal((await f.graph(pin)).value.cleanup.state, 'archived');
    const restored = await held('/v1/plan', host => readDetail(host, { sourceId: pin.source, id: pin.plan }), () => { cleanup('restore', 1); });
    assert.equal(restored.ok, true); if (restored.ok) { assert.equal(restored.restarts, 1); assert.equal(restored.plan.revision, pin.revision); assert.deepEqual(restored.plan.cleanup, { state: 'visible', revision: 2 }); }
    refused(await f.graph(pin), 409, 'conflict'); pin = { ...pin, cleanupRev: 2 };
    f.store.bindReads(f.beta.id, false); refused(await f.graph(pin), 409, 'conflict'); f.store.bindReads(f.alpha.id, true);
    f.store.cleanup('delete', { storeId: pin.storeId, source: pin.source, plan: pin.plan, rev: pin.revision, cleanupRev: 2, oid: 'delete', confirmed: true }); refused(await f.graph(pin), 404, 'not-found');
    record('races', 'real-mutations-held-detail-and-graph', { detailRestarts: 1, cleanupRestarts: 2, capturedRevision: r.revision, currentRevision: r.revision + 1, graphNodesAdded: 1, graphNodesRemoved: 1, graphDependencyEdgesChanged: 1, graphParentsChanged: 1, graphReplacementStatusChanged: true, refreshedItems: next.length });
  } finally { await f.close(); }
});

test('1000-item supported staged inputs: one graph request, bounded bytes, no history scans', async () => {
  const f = await fixture();
  try {
    for (const variant of ['ordinary','long-id-one-edge','short-id-sixteen-edges']) {
      let input: ItemInput[] = variant === 'ordinary' ? boundaryItems(1000) : items(1000);
      if (variant === 'long-id-one-edge') { const names = input.map((_, i) => `T${String(i).padStart(4, '0')}${'x'.repeat(75)}`); input = input.map((i, n) => ({ ...i, id: names[n], parentId: undefined, dependencies: n > 1 ? [names[n - 1]] : [] })); }
      if (variant === 'short-id-sixteen-edges') input = input.map((i, n) => ({ ...i, dependencies: Array.from({ length: Math.min(16, n - 1) }, (_, j) => `T-${n - j - 1}`) }));
      let maxStageBytes = 0, chunks = 0;
      const apply = f.store.apply.bind(f.store);
      f.store.apply = ((request, ...args) => {
        const bytes = Buffer.byteLength(JSON.stringify(request)); assert.ok(bytes <= LIMITS.requestBytes);
        if ((request as { op: string }).op === 'stage') { chunks++; maxStageBytes = Math.max(maxStageBytes, bytes); }
        return apply(request, ...args);
      }) as typeof f.store.apply;
      f.seedPlan(variant, 'Synthetic scale', input); f.store.apply = apply; assert.equal(chunks, 20); const pin = f.request(variant);
      const queries: string[] = []; const prepare = f.store.db.prepare.bind(f.store.db); f.store.db.prepare = ((sql: string) => { queries.push(sql); return prepare(sql); }) as typeof f.store.db.prepare;
      const start = performance.now(); const r = await f.graph(pin); const graphMs = performance.now() - start; f.store.db.prepare = prepare;
      assert.equal(r.status, 200); assert.equal(r.value.items.length, 1000); assert.deepEqual(r.value.items, graphItems(input)); assert.equal(new Set(r.value.items.map((i: { id: string }) => i.id)).size, 1000);
      assert.ok(!queries.some(sql => /\b(revisions|contributions)\b/i.test(sql))); const bytes = Buffer.byteLength(r.body); assert.ok(bytes <= LIMITS.responseBytes);
      let requests = 0; const detailStart = performance.now(); const detail = await readDetail({ serviceRequest: q => { requests++; return f.host.serviceRequest(q); } }, { sourceId: pin.source, id: pin.plan }); const detailMs = performance.now() - detailStart;
      assert.equal(detail.ok, true); assert.equal(requests, 50);
      record('limits', variant, { items: 1000, bytes, graphRequests: 1, detailRequests: requests, graphMs, detailMs, historyScans: 0, chunks, maxStageBytes });
    }
  } finally { await f.close(); }
});
