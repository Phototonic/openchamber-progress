import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { searchFixture } from '../fixtures/plan-task-search.ts';
import { seedMapFixture } from '../fixtures/dependency-map.ts';
import { seedMapAttribution } from '../fixtures/dependency-map-attribution.ts';
import { createProgressServer } from '../../service/server.ts';
import { readDetail, readPlanGraph, type ServiceHost } from '../../ui/shared/source.ts';
import { deriveDependencies } from '../../ui/shared/dependency-derivation.ts';
import { mapAttribution, type MapAttributionInput } from '../../ui/shared/dependency-map-attribution.ts';
import { runClaim } from '../../ui/shared/census-view.ts';
import { censusFor, planFacts } from '../../ui/shared/census.ts';
import { EMPTY_LIVE } from '../../ui/shared/live.ts';
import { ExecutionBaselines, rosterFor } from '../../ui/shared/subagents.ts';
import { RunsController, type RunsPanel } from '../../ui/shared/runs.ts';
import { DependencyMapLayout } from '../../ui/shared/dependency-map-layout.ts';

test('map proof: revision, delegation, latest child, scope and roster independence', async t => {
  const f = searchFixture(false); seedMapFixture(f); const fixture = seedMapAttribution(f);
  const server = createProgressServer(f.store, 'fixture-only'); server.listen(0, 'localhost'); await once(server, 'listening');
  const host: ServiceHost = { serviceRequest: async q => {
    const r = await fetch(`http://localhost:${(server.address() as { port: number }).port}${q.path}?${new URLSearchParams(q.query)}`, { headers: { authorization: 'Bearer fixture-only' } });
    return { status: r.status, body: await r.text() };
  } };
  try {
    const detail = await readDetail(host, { sourceId: f.alpha.id, id: 'P-map' }); assert.ok(detail.ok);
    const request = runClaim({ storeId: f.storeId, binding: { sourceId: f.alpha.id, verified: true }, captureEnabled: true }, f.actor.sessionId, detail.plan).request;
    const graph = await readPlanGraph(host, { planGraph: 1 }, { ...request, plan: 'P-map', cleanupRev: 0, revision: detail.plan.revision }); assert.ok(graph.ok);
    const facts = deriveDependencies(graph.graph.items); assert.equal(facts.state, 'valid'); if (facts.state !== 'valid') return;
    const read = f.store.subagentRuns(request);
    const runs: RunsPanel = { state: 'ready', read, featured: read.data, more: [], hasMore: false, continuation: false, paging: false, pageError: false, shown: 0, reconciling: false, failure: null, historyRequestFailed: false, baselines: new ExecutionBaselines(), showMore() {}, retryHistory() {} };
    const base: MapAttributionInput = { snapshot: { state: 'ready', current: true, picture: { detail, graph: graph.graph, facts } }, request, runs, census: censusFor(request.root, detail.plan.directory, EMPTY_LIVE), liveSeq: 0 };
    const fresh = (): MapAttributionInput => ({ ...base, snapshot: { ...base.snapshot, picture: { ...base.snapshot.picture!, detail: structuredClone(detail) } }, request: structuredClone(request), runs: { ...runs, read: structuredClone(read), featured: structuredClone(read.data), baselines: new ExecutionBaselines() } });
    const b = (v: MapAttributionInput) => mapAttribution(v).get('B')!;
    const item = (v: MapAttributionInput) => v.snapshot.picture!.detail.detail.items.find(i => i.id === 'B')!;
    const row = (v: MapAttributionInput) => v.runs!.featured.find(r => r.childSessionId === fixture.child.sessionId)!;
    assert.ok(b(base).assignment); assert.equal(b(base).live.proven, true);
    assert.equal(mapAttribution(base).get('C')!.assignment, null); assert.equal(mapAttribution(base).get('C')!.live.proven, false);
    assert.deepEqual(mapAttribution(base).get('C')!.links, ['map-linked']);
    await t.test('successful visit withdraws live proof on failed refresh and restores it on recovery without movement', async () => {
      let fail = false;
      const controller = new RunsController({ visible: () => true, changed() {}, service: () => ({ serviceRequest: async () => fail
        ? { status: 503, body: '{"error":"unavailable"}' }
        : { status: 200, body: JSON.stringify(read) } }) });
      const claim = { owner: 'proof-refresh-frame', request, capable: true, captureEnabled: false };
      const paint = () => { controller.beginPaint(); const panel = controller.claim(claim); controller.endPaint(); return panel; };
      const until = async (condition: (panel: RunsPanel) => boolean) => {
        const end = Date.now() + 2000;
        while (!condition(paint())) { assert.ok(Date.now() < end, 'run refresh did not settle'); await new Promise(r => setImmediate(r)); }
        return paint();
      };
      const geometry = new DependencyMapLayout();
      const positions = () => [...geometry.compute(graph.graph.items, { width: 220, height: 100, columnGap: 70, rowGap: 25 }, 600).positions];
      try {
        paint(); const success = await until(p => p.state === 'ready');
        assert.equal(success.failure, null); assert.equal(b({ ...base, runs: success }).live.proven, true);
        const before = positions(), cachedRows = success.featured;
        fail = true; controller.poll();
        const failed = await until(p => p.failure !== null);
        assert.equal(failed.state, 'ready'); assert.strictEqual(failed.featured, cachedRows);
        assert.deepEqual(b({ ...base, runs: failed }).live, { proven: false, reason: 'run-scope-unavailable' });
        assert.deepEqual(positions(), before);
        fail = false; controller.poll();
        const recovered = await until(p => p.failure === null);
        assert.equal(recovered.state, 'ready'); assert.equal(b({ ...base, runs: recovered }).live.proven, true);
        assert.deepEqual(positions(), before);
      } finally { controller.retire(); }
    });
    for (const [name, change] of Object.entries<(v: MapAttributionInput) => void>({
      'stale binding': v => { item(v).delegation!.validAtRevision--; },
      'same-child relink / missing provenance': v => { delete item(v).delegation; },
      'mismatched binding child': v => { item(v).delegation!.childSessionId = 'other'; },
      'mismatched coordinator': v => { item(v).delegation!.coordinatorSessionId = 'other'; },
      'no loaded run': v => { v.runs!.featured = []; },
      'childless unverified dispatch': v => { const r = row(v); r.childSessionId = null; r.latestForChild = false; },
      'another child running': v => { row(v).childSessionId = 'other'; },
      'missing latest mark / old service': v => { delete (row(v) as Partial<ReturnType<typeof row>>).latestForChild; },
      'unloaded latest': v => { row(v).latestForChild = false; },
      'conflicting latest': v => { v.runs!.more = [{ ...row(v), id: 'duplicate' }]; },
      'latest mark disagrees with execution order': v => { const r = structuredClone(row(v)); r.id = 'newer'; r.latestForChild = false; r.ran.startedAt! += 100; v.runs!.more = [r]; },
      'failed run read': v => { v.runs!.state = 'error'; },
      'terminal run / claim is not activity': v => { row(v).ran.state = 'succeeded'; row(v).ran.endedAt = 100; },
      'superseded picture': v => { v.snapshot = { ...v.snapshot, current: false }; },
      'foreign run source': v => { row(v).source = 'other'; },
      'foreign binding': v => { v.request.binding.verified = false; },
      'cross-plan reply': v => { v.runs!.read!.plan = 'other'; },
      'cross-frame child-root reply': v => { v.request.root = fixture.child.sessionId; },
      'cross-store reply': v => { v.runs!.read!.storeId = 'other'; },
      'cleanup identity changed': v => { v.request.cleanupRev!++; },
    })) await t.test(name, () => { const v = fresh(); change(v); assert.equal(b(v).live.proven, false); });
    await t.test('session running elsewhere is not task execution; other tasks never borrow its proof', () => {
      const v = fresh(); row(v).planContext = { plan: 'another-plan', revision: 1, observedAt: 1 };
      // Binding-to-child, not planContext, proves the SESSION word on B only.
      assert.equal(b(v).live.proven, true); assert.equal(mapAttribution(v).get('C')!.live.proven, false);
      assert.ok(!('taskRunning' in b(v)));
    });
    await t.test('direct and relayed reports remain context, never assignment or execution proof', () => {
      const v = fresh(), i = item(v); delete i.delegation;
      v.snapshot.picture!.detail.detail.contributions.push({ revision: detail.plan.revision, reporterSessionId: 'coordinator', attributedSessionId: fixture.child.sessionId, mode: 'parent-relay', itemIds: ['B'] });
      const projection = b(v);
      assert.equal(projection.assignment, null); assert.equal(projection.live.proven, false);
      assert.equal(projection.reporter, i.reporterSessionId); assert.equal(projection.reports.at(-1)!.mode, 'parent-relay');
      assert.equal(projection.reports.at(-1)!.attributedSessionId, fixture.child.sessionId);
    });
    await t.test('roster output and participants stay unchanged by projection', () => {
      const v = fresh(), input = { surface: 'page' as const, plan: detail.plan, facts: planFacts(detail.plan, { state: 'ready' as const, value: detail.detail }, f.alpha.id), census: v.census, runs: v.runs, verified: true, currentSession: null };
      const before = rosterFor(input); mapAttribution(v); assert.deepEqual(rosterFor(input), before);
    });
    await t.test('host-only activity, report context and foreign picture cannot certify assignment', () => {
      const v = fresh();
      const observed = { id: fixture.child.sessionId, parentId: request.root, depth: 1, title: 'Assigned session', activity: 'running' as const, outcome: null, archived: false, activeSeq: 1 };
      v.census = { state: 'ready', rootId: request.root, project: { id: 'project-alpha', name: 'Example', directory: detail.plan.directory }, root: { ...observed, id: request.root, depth: 0, parentId: null }, rows: [observed], omitted: 0, gaps: [] };
      v.runs!.featured = []; assert.equal(b(v).live.proven, false);
      const foreign = fresh(), d = foreign.snapshot.picture!.detail;
      d.snapshot = { ...d.snapshot!, identity: { ...d.snapshot!.identity, binding: { ...d.snapshot!.identity.binding, verified: false } } };
      assert.equal(b(foreign).assignment, null); assert.equal(b(foreign).live.proven, false);
      const linked = fresh(); delete item(linked).assigneeSessionId; delete item(linked).delegation;
      assert.equal(b(linked).assignment, null); assert.ok(b(linked).links.includes(fixture.child.sessionId));
      assert.equal(b(linked).live.proven, false); assert.ok(b(linked).reporter);
    });
    await t.test('terminal resume requires a post-baseline transition and current census coverage', () => {
      const v = fresh(), r = row(v); r.ran.state = 'succeeded'; r.ran.endedAt = 1000;
      const observed = { id: fixture.child.sessionId, parentId: request.root, depth: 1, title: 'Assigned session', activity: 'running' as const, outcome: null, archived: false, activeSeq: 1 };
      v.census = { state: 'ready', rootId: request.root, project: { id: 'project-alpha', name: 'Example', directory: detail.plan.directory }, root: { ...observed, id: request.root, depth: 0, parentId: null }, rows: [observed], omitted: 0, gaps: [] };
      v.liveSeq = 1; assert.equal(b(v).live.proven, false); // cached running is not resume
      observed.activeSeq = 2; v.liveSeq = 2; assert.equal(b(v).live.proven, true);
      v.census.gaps = ['coverage']; assert.equal(b(v).live.proven, false);
    });
    await t.test('real same-child relink invalidates binding at adapter boundary', async () => {
      f.apply('P-map', { op: 'link', child: fixture.child.sessionId, assign: ['B'] }, f.actor, fixture.child);
      const next = await readDetail(host, { sourceId: f.alpha.id, id: 'P-map' }); assert.ok(next.ok);
      assert.equal(next.detail.items.find(i => i.id === 'B')!.delegation, undefined);
      const v = fresh(); v.snapshot.picture!.detail.detail.items = next.detail.items;
      assert.equal(b(v).assignment, null); assert.equal(b(v).live.proven, false);
    });
    await t.test('source/session switch retires held run reply before it can supply proof', async () => {
      let release!: () => void, called!: () => void; const admitted = new Promise<void>(r => { called = r; });
      const held = new Promise<void>(r => { release = r; }); let paints = 0;
      const controller = new RunsController({ visible: () => true, changed: () => { paints++; }, service: () => ({ serviceRequest: async () => { called(); await held; return { status: 200, body: JSON.stringify(read) }; } }) });
      controller.beginPaint(); controller.claim({ owner: 'frame-A', request, capable: true, captureEnabled: false }); controller.endPaint(); await admitted;
      controller.beginPaint(); const next = controller.claim({ owner: 'frame-B', request: { ...request, root: fixture.child.sessionId, source: 'other' }, capable: false, captureEnabled: false }); controller.endPaint();
      release(); await new Promise(r => setImmediate(r));
      assert.equal(paints, 0); assert.equal(next.read, null); assert.equal(b({ ...base, runs: next }).live.proven, false); controller.retire();
    });
  } finally { await new Promise<void>(r => server.close(() => r())); f.cleanup(); }
});
