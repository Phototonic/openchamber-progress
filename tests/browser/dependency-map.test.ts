import assert from 'node:assert/strict';
import { test } from 'node:test';
import { once } from 'node:events';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import type { AddressInfo } from 'node:net';
import { createProgressServer } from '../../service/server.ts';
import { readDetail, type CompleteDetailResult, type ServiceHost } from '../../ui/shared/source.ts';
import { DependencyMap, type MapClaim } from '../../ui/shared/dependency-map.ts';
import { searchFixture } from '../fixtures/plan-task-search.ts';
import { seedMapFixture, MAP_FIXTURE_VERSION } from '../fixtures/dependency-map.ts';
import * as scope from '../../ui/shared/scope.ts';
import * as refresh from '../../ui/shared/refresh.ts';
import * as defaultView from '../../ui/shared/default-view.ts';
import * as i18n from '../../ui/shared/i18n.ts';
import * as model from '../../ui/shared/model.ts';
import * as planSelection from '../../ui/shared/plan-selection.ts';

const tick = () => new Promise<void>(resolve => setImmediate(resolve));
async function until(predicate: () => boolean) {
  const end = Date.now() + 8000;
  while (!predicate()) { if (Date.now() > end) throw Error('Map did not settle'); await tick(); }
}
test('complete HTTP pairing, bounded retries, independent readings and retired continuations', async () => {
  const f = searchFixture(false); seedMapFixture(f);
  const server = createProgressServer(f.store, 'synthetic-token'); server.listen(0, 'localhost'); await once(server, 'listening');
  const base = `http://localhost:${(server.address() as AddressInfo).port}`;
  const routes: string[] = []; let status = 200; let malformed = false; let hold: Promise<void> | null = null;
  const host: ServiceHost = { serviceRequest: async q => {
    routes.push(q.path);
    const held = hold, code = status, corrupt = malformed;
    const r = await fetch(`${base}${q.path}?${new URLSearchParams(q.query)}`, { headers: { authorization: 'Bearer synthetic-token' } });
    let body = await r.text();
    if (q.path === '/v1/plan-graph') {
      if (held) await held;
      if (code !== 200) return { status: code, body: JSON.stringify({ error: code === 404 ? 'not-found' : 'conflict' }) };
      if (corrupt) { const dto = JSON.parse(body); dto.items.find((i: { id: string }) => i.id === 'I').status = 'done'; body = JSON.stringify(dto); }
    }
    return { status: r.status, body };
  } };
  let changes = 0;
  const map = new DependencyMap(current => ({ serviceRequest: q => current() ? host.serviceRequest(q) : Promise.reject(Error('Retired')) }), () => changes++);
  const graphCalls = () => routes.filter(p => p === '/v1/plan-graph').length;
  let valid = true;
  const claim = async (scope = 'board:all', account = 'synthetic-account'): Promise<MapClaim> => {
    const result = await readDetail(host, { sourceId: f.alpha.id, id: 'P-map' }); assert.ok(result.ok);
    return { account, scope, read: { storeId: f.storeId, binding: { sourceId: f.alpha.id, verified: true } }, plan: result.plan,
      detail: { result, current: () => valid }, health: { ready: true, sqlite: true, diagnostics: [], planGraph: 1 }, refreshSerial: 1, active: true, visible: true };
  };
  const records: string[] = [];
  try {
    let c = await claim();
    map.reconcile({ ...c, health: { ready: true, sqlite: true, diagnostics: [] } }); assert.equal(graphCalls(), 0); assert.equal(map.value.state, 'unavailable');
    map.reconcile(c); await until(() => map.value.state === 'ready');
    assert.equal(map.value.picture!.graph.items.length, map.value.picture!.detail.detail.items.length);
    const initial = map.value.picture; const calls = graphCalls();
    for (let n = 2; n < 5; n++) map.reconcile({ ...c, refreshSerial: n });
    assert.equal(graphCalls(), calls); assert.equal(map.value.picture, initial);
    records.push('capability-zero-requests', 'complete-pair', 'unchanged-polls-zero-graph-work');
    const missingIdentity = structuredClone(c.detail!.result);
    missingIdentity.snapshot = null;
    const unavailable = new DependencyMap(() => host, () => {});
    unavailable.reconcile({ ...c, detail: { result: missingIdentity, current: () => true } });
    assert.equal(unavailable.value.state, 'unavailable'); assert.equal(unavailable.value.picture, null); assert.equal(graphCalls(), calls); unavailable.dispose();
    assert.throws(() => { initial!.detail.plan.title = 'Changed after acceptance'; });
    records.push('missing-identity-unavailable', 'accepted-metadata-owned-and-frozen');
    // Real status report advances detail; no new header is merged into the retained picture.
    f.apply('P-map', { op: 'change', changes: [{ id: 'B', status: 'done' }] });
    c = await claim(); malformed = true;
    map.reconcile(c); await until(() => changes === 2);
    assert.equal(map.value.state, 'updating'); assert.equal(map.value.picture, initial);
    assert.equal(map.value.picture!.detail.plan.revision, 1); assert.equal(map.value.current, false);
    const failedCalls = graphCalls(); map.reconcile(c); await tick(); assert.equal(graphCalls(), failedCalls);
    malformed = false; status = 409;
    map.reconcile({ ...c, refreshSerial: 2 }); await until(() => changes === 3); assert.equal(map.value.state, 'updating');
    status = 503; map.reconcile({ ...c, refreshSerial: 3 }); await until(() => changes === 4); assert.equal(map.value.state, 'error'); assert.equal(map.value.picture, initial);
    status = 200; map.reconcile({ ...c, refreshSerial: 4 }); await until(() => map.value.state === 'ready'); assert.equal(map.value.picture!.detail.plan.revision, 2);
    records.push('semantic-disagreement-retains-old-whole-picture', 'conflict-updating', 'read-error-next-refresh-retry');
    // Every identity dimension retires an already-sent graph reply, even after A → B → A.
    for (const dimension of ['selection', 'source', 'store', 'account', 'binding', 'scope', 'cleanup', 'hidden', 'leave', 'eviction', 'dispose']) {
      map.reset(); valid = true; status = 200;
      let release!: () => void; hold = new Promise<void>(resolve => { release = resolve; });
      const start = graphCalls(); map.reconcile(c); await until(() => graphCalls() > start);
      const before = changes;
      if (dimension === 'hidden') map.reconcile({ ...c, visible: false });
      else if (dimension === 'leave') map.reconcile({ ...c, active: false });
      else if (dimension === 'eviction') { valid = false; map.reset(); }
      else if (dimension === 'dispose') map.dispose();
      else {
        const next = structuredClone({ ...c, detail: null });
        if (dimension === 'selection') next.plan.id = 'P-map-none';
        if (dimension === 'source') next.plan.sourceId = f.beta.id;
        if (dimension === 'store') next.read.storeId = 'other-store';
        if (dimension === 'account') next.account = 'other-account';
        if (dimension === 'binding') next.read.binding.verified = false;
        if (dimension === 'scope') next.scope = 'rail:B';
        if (dimension === 'cleanup') next.plan.cleanup = { state: 'archived', revision: 1 };
        map.reconcile(next); map.reconcile({ ...c, detail: null });
      }
      release(); hold = null; await tick(); await tick(); assert.equal(changes, before, dimension);
      assert.equal(map.value.picture, null, dimension);
      records.push(`retired-${dimension}`);
    }
    // Separate frame instances never borrow a same-ID picture, even with identical metadata.
    const board = new DependencyMap(() => host, () => {}), rail = new DependencyMap(() => host, () => {});
    valid = true; c = await claim(); board.reconcile(c); rail.reconcile({ ...c, scope: 'rail:A' });
    await until(() => board.value.current && rail.value.current);
    const boardPicture = board.value.picture;
    // Board scope excludes host session. Rail reading scope is the selected session, not directory.
    board.reconcile(c); assert.equal(board.value.picture, boardPicture);
    rail.reconcile({ ...c, scope: 'rail:B', detail: null }); rail.reconcile({ ...c, scope: 'rail:A', detail: null }); assert.equal(rail.value.picture, null);
    status = 404; board.pause(); board.reconcile(c); await until(() => board.value.state === 'not-found'); assert.equal(board.value.picture, null);
    records.push('board-host-session-independent', 'rail-session-roundtrip-retires', 'independent-frame-pictures', '404-clears-picture');
    board.dispose(); rail.dispose();
    // A selected result need not be inside the ordinary capped plan list. The complete reader
    // supplies its metadata; no library-prefix reconstruction is used by the map.
    for (let n = 0; n < 501; n++) f.seedPlan(`P-before-${String(n).padStart(3, '0')}`, 'Neutral library entry', []);
    status = 200;
    const outside = new DependencyMap(() => host, () => {});
    outside.reconcile(await claim('board:search:outside-list')); await until(() => outside.value.current);
    assert.equal(outside.value.picture!.detail.plan.title, 'Dependency map fixture'); outside.dispose();
    records.push('complete-search-selected-metadata-independent-of-list-prefix');
    // Held complete-detail pages use the actual reader's existing continuation guard. A failed
    // read can retain first-page metadata, but never supplies map cards/classification.
    f.seedPlan('P-paged', 'Paged fixture', Array.from({ length: 60 }, (_, n) => ({ id: `T-${n}`, title: 'Paged task', kind: 'task' as const })));
    let releaseDetail!: () => void, detailCurrent = true, pages = 0;
    const heldDetail = new Promise<void>(resolve => { releaseDetail = resolve; });
    const detailHost: ServiceHost = { serviceRequest: async q => {
      if (!detailCurrent) throw Error('Retired detail');
      const reply = await host.serviceRequest(q);
      if (q.path === '/v1/plan' && ++pages === 1) await heldDetail;
      return reply;
    } };
    const read = readDetail(detailHost, { sourceId: f.alpha.id, id: 'P-paged' });
    await until(() => pages === 1); detailCurrent = false; releaseDetail();
    const failed = await read; assert.equal(failed.ok, false); assert.ok(failed.snapshot); assert.equal(pages, 1);
    const prefix = new DependencyMap(() => host, () => {}); const beforePrefix = graphCalls();
    prefix.reconcile({ ...c, plan: { ...c.plan, id: 'P-paged', key: `${f.alpha.id}/P-paged` }, detail: { result: failed, current: () => true } });
    assert.equal(prefix.value.state, 'error'); assert.equal(prefix.value.picture, null); assert.equal(graphCalls(), beforePrefix); prefix.dispose();
    records.push('held-detail-no-continuation-after-retirement', 'failed-first-page-never-classified');
    let releaseGraphs!: () => void;
    hold = new Promise<void>(resolve => { releaseGraphs = resolve; });
    const bounded = new DependencyMap(() => host, () => {}), baseCount = graphCalls();
    bounded.reconcile({ ...c, scope: 'rail:A' }); await until(() => graphCalls() === baseCount + 1);
    bounded.reconcile({ ...c, scope: 'rail:B' }); await until(() => graphCalls() === baseCount + 2);
    bounded.reconcile({ ...c, scope: 'rail:C' }); bounded.reconcile({ ...c, scope: 'rail:D' });
    await tick(); assert.equal(graphCalls(), baseCount + 2, 'at most obsolete + current transport');
    hold = null; releaseGraphs(); await until(() => bounded.value.current);
    assert.equal(graphCalls(), baseCount + 3, 'only the last queued reading starts'); bounded.dispose();
    records.push('two-inflight-transports-single-latest-candidate');
    // Execute the existing rail's real scope/preference owner, with only SDK/DOM mounts stubbed.
    // No map UI or alternate preference owner is introduced for this test.
    let railSpec: any, choosePlan: (key: string) => void = () => {}, preferenceReads = 0;
    const preferences: ((value: string) => void)[] = [];
    const node = () => ({ dataset: {}, append() {} });
    const components = new Proxy({}, { get: (_target, name) => name === 'planPicker' ? (options: { onChange: typeof choosePlan }) => { choosePlan = options.onChange; return node(); } : name === 'testid' ? (n: unknown) => n : name === 'failureFacts' ? () => [] : () => node() });
    runInNewContext(ts.transpileModule(readFileSync(new URL('../../ui/panel/main.ts', import.meta.url), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText, { exports: {}, require: (name: string) => {
      if (name === '@openchamber/sdk/ui') return { mountSelect: (_n: unknown, options: { onChange: typeof choosePlan }) => { choosePlan = options.onChange; } };
      if (name.endsWith('/app.ts')) return { startView: (spec: unknown) => { railSpec = spec; } };
      if (name.endsWith('/scope.ts')) return scope;
      if (name.endsWith('/plan-selection.ts')) return planSelection;
      if (name.endsWith('/refresh.ts')) return refresh;
      if (name.endsWith('/default-view.ts')) return defaultView;
      if (name.endsWith('/i18n.ts')) return i18n;
      if (name.endsWith('/components.ts')) return components;
      // S5 wires the shared map into the production rail. This preference-owner test stubs only
      // that presentation boundary; complete map pairing/retirement is exercised above.
      if (name.endsWith('/dependency-map-view.ts')) return { planViewSwitch: node, createMapFrame: () => ({
        sync() {}, resetReading() {}, listTargets() {}, retire() {}, afterPaint() {}, enter() {}, leave() {},
      }) };
      if (name.endsWith('/census-view.ts')) return { runClaim: () => null };
      if (name.endsWith('/setup.ts')) return { initialSetupUi: () => ({}), reloadNote: () => null };
      if (name.endsWith('/cleanup-view.ts')) return { cleanupNotice: () => null, cleanupBlock: () => null };
      if (name.endsWith('/official.ts')) return { officialMainBlock: () => null };
      if (name.endsWith('/model.ts')) return model;
      return {};
    } });
    const otherPlan = { ...c.plan, id: 'P-map-none', key: `${f.alpha.id}/P-map-none` };
    const vc: any = { identity: 'synthetic-identity', session: { id: 'M' }, directory: '/fixture/main',
      ui: { selected: null }, read: { plans: [c.plan, otherPlan], binding: { verified: false }, captureEnabled: true },
      env: { boundSource: null }, storage: { get: () => { preferenceReads++; return new Promise<string>(resolve => preferences.push(resolve)); }, set: async () => {} },
      setUi: (patch: unknown) => { vc.ui = { ...vc.ui, ...patch as object }; }, detail: () => null, summary: () => null, document: () => null };
    railSpec.onContext(vc); railSpec.paint(node(), vc); choosePlan(otherPlan.key);
    preferences.shift()!(c.plan.key); await tick(); assert.equal(vc.ui.selected, otherPlan.key, 'late preference cannot override manual choice');
    vc.directory = '/fixture/enriched'; railSpec.onContext(vc); assert.equal(preferenceReads, 1); assert.equal(vc.ui.selected, otherPlan.key);
    vc.session = { id: 'B' }; railSpec.onContext(vc); vc.session = { id: 'M' }; railSpec.onContext(vc);
    assert.equal(railSpec.reading(vc).scope, 'rail:M');
    preferences.shift()!(c.plan.key); await tick(); assert.equal(vc.ui.selected, otherPlan.key, 'obsolete session preference retired');
    vc.session = null; railSpec.onContext(vc); assert.equal(railSpec.reading(vc), null); assert.equal(vc.ui.selected, null);
    preferences.shift()!(c.plan.key); await tick(); assert.equal(vc.ui.selected, null);
    records.push('actual-rail-late-preference-retired', 'actual-rail-directory-enrichment-preserved', 'actual-rail-session-and-null-reading-scope');
    if (process.env.EVIDENCE) { mkdirSync(process.env.EVIDENCE, { recursive: true }); writeFileSync(`${process.env.EVIDENCE}/results.json`, JSON.stringify({ fixture: MAP_FIXTURE_VERSION, runtime: process.version, passed: true, checks: records, graphRequests: graphCalls(), detailRequests: routes.filter(p => p === '/v1/plan').length, note: 'Real disposable HTTP; semantic mismatch and HTTP faults explicitly injected. No rendered map or rail preference UI integration claimed.' }, null, 2) + '\n'); }
  } finally { map.dispose(); server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); f.cleanup(); }
});

test('review regressions: expired same-revision detail ownership recovers; restart exhaustion stays Updating', async () => {
  const f = searchFixture(false); seedMapFixture(f);
  const server = createProgressServer(f.store, 'synthetic-token'); server.listen(0, 'localhost'); await once(server, 'listening');
  const base = `http://localhost:${(server.address() as AddressInfo).port}`;
  let graphCalls = 0, graphReplies = 0, held: Promise<void> | null = null, restartFault = false;
  const host: ServiceHost = { serviceRequest: async q => {
    const hold = held;
    if (q.path === '/v1/plan-graph') graphCalls++;
    const response = await fetch(`${base}${q.path}?${new URLSearchParams(q.query)}`, { headers: { authorization: 'Bearer synthetic-token' } });
    let body = await response.text();
    if (q.path === '/v1/plan-graph') { if (hold) await hold; graphReplies++; }
    // Labelled detail fault injection: each continuation advances revision, exhausting the
    // actual reader's bounded restarts. The first-page metadata is deliberately unaccepted.
    if (restartFault && q.path === '/v1/plan') {
      const page = JSON.parse(body); page.plan.title = 'Unaccepted prefix';
      if (q.query?.cursor) page.plan.revision++;
      body = JSON.stringify(page);
    }
    return { status: response.status, body };
  } };
  const maps: DependencyMap[] = [];
  const makeMap = (changed: () => void = () => {}) => {
    const map = new DependencyMap(current => ({ serviceRequest: q => current() ? host.serviceRequest(q) : Promise.reject(Error('Retired')) }), changed);
    maps.push(map); return map;
  };
  try {
    const result = await readDetail(host, { sourceId: f.alpha.id, id: 'P-map' }); assert.ok(result.ok);
    const c: MapClaim = { account: 'synthetic-account', scope: 'board:all', read: { storeId: f.storeId, binding: { sourceId: f.alpha.id, verified: true } },
      plan: result.plan, detail: { result, current: () => true }, health: { ready: true, sqlite: true, diagnostics: [], planGraph: 1 }, refreshSerial: 1, active: true, visible: true };
    for (const releaseBeforeReplacement of [false, true]) {
      let valid = true, changes = 0, release!: () => void;
      held = new Promise<void>(resolve => { release = resolve; });
      const map = makeMap(() => changes++), calls = graphCalls, replies = graphReplies;
      map.reconcile({ ...c, detail: { result, current: () => valid } });
      await until(() => graphCalls === calls + 1);
      valid = false;
      if (releaseBeforeReplacement) {
        release(); await until(() => graphReplies === replies + 1); await tick();
        assert.equal(changes, 0, 'expired graph completion cannot paint');
      }
      held = null;
      const replacement: CompleteDetailResult = structuredClone(result);
      replacement.snapshot = { ...replacement.snapshot!, captureEnabled: !replacement.snapshot!.captureEnabled };
      // No intervening null/loading claim, revision change, refresh serial or Try again.
      const next = { ...c, detail: { result: replacement, current: () => true } };
      map.reconcile(next);
      await until(() => map.value.current);
      assert.equal(graphCalls, calls + 2); assert.equal(map.value.picture!.detail.snapshot!.captureEnabled, replacement.snapshot!.captureEnabled);
      assert.equal(changes, 1);
      release(); await until(() => graphReplies === replies + 2); await tick();
      assert.equal(changes, 1, 'released old graph cannot overwrite replacement');
      map.reconcile({ ...next, refreshSerial: 2 }); assert.equal(graphCalls, calls + 2, 'settled replacement stays deduplicated');
      map.dispose();
    }
    {
      // Replacement after the first picture has settled: same revision, new detail, no new graph work.
      const map = makeMap(); map.reconcile(c); await until(() => map.value.current);
      const settled = map.value.picture!, calls = graphCalls;
      const replacement: CompleteDetailResult = structuredClone(result);
      replacement.snapshot = { ...replacement.snapshot!, captureEnabled: !replacement.snapshot!.captureEnabled };
      map.reconcile({ ...c, detail: { result: replacement, current: () => true }, refreshSerial: 2 });
      assert.equal(map.value.state, 'ready'); assert.equal(map.value.current, true);
      assert.equal(map.value.picture!.detail.snapshot!.captureEnabled, replacement.snapshot!.captureEnabled, 'settled picture adopts replaced detail');
      assert.equal(map.value.picture!.graph, settled.graph, 'matched graph reused'); assert.equal(graphCalls, calls, 'no graph request for same-revision replacement');
      assert.ok(Object.isFrozen(map.value.picture!.detail)); assert.notEqual(map.value.picture!.detail, replacement, 'owns a copy');
      const adopted = map.value.picture;
      map.reconcile({ ...c, detail: { result: replacement, current: () => true }, refreshSerial: 3 });
      assert.equal(map.value.picture, adopted, 'unchanged polls keep picture identity');
      map.dispose();
    }
    f.seedPlan('P-paged-review', 'Paged restart fixture', Array.from({ length: 60 }, (_, n) => ({ id: `T-${n}`, title: 'Paged task', kind: 'task' as const })));
    const complete = await readDetail(host, { sourceId: f.alpha.id, id: 'P-paged-review' }); assert.ok(complete.ok);
    const paged = { ...c, plan: complete.plan, detail: { result: complete, current: () => true } };
    const map = makeMap(); map.reconcile(paged); await until(() => map.value.current);
    const accepted = map.value.picture, calls = graphCalls;
    restartFault = true;
    const failed = await readDetail(host, { sourceId: f.alpha.id, id: 'P-paged-review' });
    assert.equal(failed.ok, false); if (failed.ok) throw Error('Expected revision restart exhaustion');
    assert.equal(failed.cause.kind, 'revision-restarts'); assert.ok(failed.snapshot);
    const failureClaim = { ...paged, detail: { result: failed, current: () => true } };
    for (const refreshSerial of [1, 1, 2]) {
      map.reconcile({ ...failureClaim, refreshSerial });
      assert.equal(map.value.state, 'updating'); assert.equal(map.value.picture, accepted); assert.equal(map.value.current, false);
      assert.equal(graphCalls, calls, 'failed prefix starts no graph work');
    }
    const initial = makeMap(); initial.reconcile(failureClaim); assert.equal(initial.value.state, 'updating'); assert.equal(initial.value.picture, null);
    restartFault = false;
    map.reconcile({ ...paged, refreshSerial: 3 }); await until(() => map.value.current);
    assert.equal(graphCalls, calls + 1); assert.equal(map.value.picture!.detail.plan.title, complete.plan.title);
    if (process.env.EVIDENCE) { mkdirSync(process.env.EVIDENCE, { recursive: true }); writeFileSync(`${process.env.EVIDENCE}/review-fixes.json`, JSON.stringify({ fixture: MAP_FIXTURE_VERSION, runtime: process.version, passed: true, checks: ['same-revision-replacement-while-graph-held', 'same-revision-replacement-after-settled-picture', 'same-revision-replacement-after-expired-completion', 'no-null-claim-or-refresh-required-for-replacement', 'old-completion-cannot-overwrite', 'actual-detail-restart-exhaustion-updating', 'retained-consistent-picture', 'initial-updating-without-prefix', 'failed-prefix-zero-graph-requests', 'successful-refreshed-detail-recovers'] }, null, 2) + '\n'); }
  } finally { for (const map of maps) map.dispose(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); f.cleanup(); }
});
