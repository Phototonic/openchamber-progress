// V3 (board search, controller): the actual startView/app.ts in a VM with the board's search hooks
// (freshness in place of the list poll, retirement on reset/hidden/dispose, guarded service,
// detail-plan metadata) and the production SearchController, over a REAL in-process HTTP service.
// Held replies are labelled seams; poll timers are driven explicitly (Try again = one poll).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import type { GuestRequest } from '@openchamber/sdk';
import type { ViewContext, ViewSpec } from '../../ui/shared/app.ts';
import * as source from '../../ui/shared/source.ts';
import * as summaries from '../../ui/shared/summary.ts';
import * as cleanup from '../../ui/shared/cleanup.ts';
import * as refresh from '../../ui/shared/refresh.ts';
import * as path from '../../ui/shared/path.ts';
import * as digestModule from '../../ui/shared/change-digest.ts';
import * as checkpoint from '../../ui/shared/change-digest-checkpoint.ts';
import { EMPTY_LIVE } from '../../ui/shared/live.ts';
import { ALL } from '../../ui/shared/scope.ts';
import { SearchController, type SearchCriteria } from '../../ui/shared/search.ts';
import { libraryId, seedSearchLibrary } from '../fixtures/plan-task-search.ts';
import { Device } from './change-digests-fixture.ts';
import { searchBackend, searchProxy, settle, until, type Backend, type SearchProxy } from './plan-task-search-fixture.ts';

const APP = ts.transpileModule(readFileSync(new URL('../../ui/shared/app.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

type Ui = { selected: string | null; archived: boolean; search: { key: string; criteria: SearchCriteria } | null };
const criteria = (patch: Partial<SearchCriteria> = {}): SearchCriteria => ({ q: '', source: ALL, lifecycle: ALL, status: ALL, project: ALL, worktree: ALL, session: ALL, archived: false, labels: {}, ...patch });

function frame(svc: SearchProxy, surface: 'page' | 'panel' | 'status' = 'page') {
  const listeners: Record<string, (v?: any) => void> = {};
  const docListeners: Record<string, () => void> = {};
  class Node {
    dataset: Record<string, string> = {}; children: Node[] = [];
    get firstElementChild() { return this.children[0] ?? null; }
    contains(n: unknown): boolean { return n === this || this.children.some((c) => c.contains(n)); }
    querySelectorAll(): Node[] { return []; }
    querySelector() { return null; }
    closest() { return null; }
    focus() {} getAnimations() { return []; } setAttribute() {} append(...c: Node[]) { this.children.push(...c); } replaceChildren(c: Node) { this.children = [c]; }
  }
  const node = () => new Node();
  const mount = node();
  const document = { documentElement: node(), head: node(), body: node(), visibilityState: 'visible', activeElement: null, getElementById: (id: string) => (id === 'root' ? mount : {}), addEventListener: (name: string, fn: () => void) => { docListeners[name] = fn; }, scrollingElement: { scrollTop: 0 } };
  let account = 'account-example';
  const device = new Device();
  const host = {
    serviceRequest: (q: GuestRequest) => svc.serviceRequest(q),
    storage: device.storage(),
    onReady: (fn: any) => { listeners.ready = fn; }, onSession: (fn: any) => { listeners.session = fn; }, onDirectory: (fn: any) => { listeners.directory = fn; },
    openSession: async () => { throw new Error('search must never open a session'); }, toast: async () => {},
  };
  const exports: any = {};
  runInNewContext(APP, {
    exports, document, navigator: {}, crypto: globalThis.crypto, queueMicrotask, performance, console, setTimeout: () => 1, clearTimeout() {},
    window: { addEventListener: (name: string, fn: any) => { listeners[name] = fn; } },
    require: (name: string) => {
      if (name === '@openchamber/sdk') return { connectHost: () => host };
      if (name === '@openchamber/sdk/ui') return { applyHostReady() {} };
      if (name === './source.ts') return source;
      if (name === './summary.ts') return summaries;
      if (name === './cleanup.ts') return cleanup;
      if (name === './refresh.ts') return refresh;
      if (name === './path.ts') return path;
      if (name === './change-digest.ts') return digestModule;
      if (name === './change-digest-checkpoint.ts') return checkpoint;
      if (name === './components.ts') return { el: node, refreshLabels() {} };
      if (name === './live.ts') return { LiveWorkspace: class { snapshot = EMPTY_LIVE; sessionSubscriptionCount = 0; start() {} restart() {} want() {} dispose() {} } };
      if (name === './official.ts') return { OfficialMainState: class { check = async () => ({ next: null, apply: () => false }); } };
      return {};
    },
  });
  let vc!: ViewContext<Ui>;
  let paints = 0;
  /** As the board: the three plans opened before the selection keep their part caches. */
  let recent: string[] = [];
  const search = new SearchController({ service: (current) => vc.service(current), changed: () => vc?.updateUi(() => ({})), visible: () => document.visibilityState !== 'hidden' });
  const board = surface === 'page';
  const active = (c: ViewContext<Ui>) => !!c.ui.search && search.key === c.ui.search.key;
  const spec: ViewSpec<Ui> = {
    surface, maxSessionSubscriptions: 2,
    initialUi: () => ({ selected: null, archived: false, search: null }),
    scope: (_c, ui) => ({ archived: ui.archived ? 'only' : 'exclude' }),
    wantProjects: () => [],
    wantDetails: (c) => { const r = search.selectedPlan(); return active(c) && r && r.key === c.ui.selected ? [r] : []; },
    actionPlan: (c) => { const r = search.selectedPlan(); return r && active(c) ? c.detailPlan(r) : null; },
    forgetPlans: (keys, ui) => (keys.has(ui.selected ?? '') ? { selected: null } : {}),
    paint: (_root, c) => { paints++; vc = c; if (!c.ui.search && search.active) search.clear(); },
    // The board alone wires search; rail and Work Status have no search hooks at all.
    ...(board ? {
      partsKey: (c: ViewContext<Ui>) => (active(c) ? JSON.stringify([c.ui.search!.key, c.ui.selected]) : null),
      retainParts: (c: ViewContext<Ui>) => (active(c) ? new Set([...recent, ...(c.ui.selected ? [c.ui.selected] : [])]) : null),
      freshness: (c: ViewContext<Ui>) => (active(c) && search.freshKeys().length ? (service: source.ServiceHost) => search.revalidate(service) : null),
      retire: (reason: 'reset' | 'hidden' | 'dispose') => { if (reason === 'reset') search.retire(); else if (reason === 'hidden') search.hidden(); else search.dispose(); },
    } : {}),
  };
  exports.startView(spec);
  const ready = () => listeners.ready({ session: null, directory: null, connection: { connected: true, account }, locale: 'en', surface, settings: {}, item: null, theme: {}, features: { deviceStorage: true } });
  ready();
  let n = 0;
  return {
    search, get vc() { return vc; }, get paints() { return paints; },
    loaded: () => until(() => !!vc?.read, 'list read'),
    submit: async (patch: Partial<SearchCriteria>) => {
      const c = criteria({ archived: vc.ui.archived, ...patch });
      const key = `run-${++n}`;
      search.submit(key, c, { storeId: vc.read!.storeId, binding: vc.read!.binding }, EMPTY_LIVE);
      vc.setUi({ search: { key, criteria: c }, selected: null });
      await until(() => !search.view()?.busy, 'search action');
      return search.view()!;
    },
    open: async (planKey: string) => {
      const previous = vc.ui.selected;
      if (previous && previous !== planKey) recent = [...recent.filter((k) => k !== previous && k !== planKey), previous].slice(-3);
      search.select(planKey); vc.setUi({ selected: planKey });
      await until(() => !!search.selectedPlan() && !!vc.detailPlan(search.selectedPlan()!), 'complete detail of the opened hit');
    },
    poll: async () => { vc.retry(); await settle(); },
    hide: () => { document.visibilityState = 'hidden'; docListeners.visibilitychange(); },
    show: () => { document.visibilityState = 'visible'; docListeners.visibilitychange(); },
    stop: () => listeners.pagehide(),
    account: (next: string) => { account = next; ready(); },
  };
}

async function withBackend(library: boolean, body: (b: Backend, svc: SearchProxy) => Promise<void>) {
  const b = await searchBackend(true);
  if (library) seedSearchLibrary(b.f);
  try { await body(b, searchProxy(b)); } finally { await b.stop(); }
}
const since = (svc: SearchProxy, mark: number) => svc.log.slice(mark).map((l) => l.path);

test('while results are shown the poll revalidates them instead of the list; deletion beyond plan 500 converges', async () => {
  await withBackend(true, async (b, svc) => {
    const a = frame(svc);
    await a.loaded();
    let mark = svc.log.length;
    await a.poll();
    assert.ok(since(svc, mark).includes('/v1/plans'), 'ordinary browsing polls the list');
    let v = await a.submit({ q: 'Needle-at-1001' });
    for (let i = 0; i < 5 && v.more; i++) { a.search.more(); await until(() => !a.search.view()!.busy, 'more'); v = a.search.view()!; }
    assert.deepEqual(v.page.hits.map((h) => h.plan.id), [libraryId(1001)]);
    mark = svc.log.length;
    await a.poll();
    const paints = a.paints;
    await a.poll(); await a.poll();
    assert.equal(a.paints, paints, 'an unchanged freshness poll does not repaint');
    assert.deepEqual(since(svc, mark), ['/v1/search-state', '/v1/search-state', '/v1/search-state'], 'no list, search or detail work on unchanged polls');
    assert.equal(svc.log.at(-1)!.query!.keys, JSON.stringify([{ source: b.f.alpha.id, plan: libraryId(1001) }]), 'only displayed keys');
    // Another client deletes the hit past the ordinary 500-plan list prefix.
    await b.act('delete', libraryId(1001));
    await a.poll();
    v = a.search.view()!;
    assert.equal(v.page.hits.length, 0); assert.equal(v.removed, 1); assert.equal(v.stop, 'changed');
    assert.equal(a.vc.failure, null);
    // Nothing shown: the poll falls back to the ordinary list read.
    mark = svc.log.length;
    await a.poll();
    assert.ok(since(svc, mark).includes('/v1/plans'));
    a.stop();
  });
});

test('opened hit: detail from the existing loader, revision change re-read once, failed freshness is stale', async () => {
  await withBackend(false, async (b, svc) => {
    const a = frame(svc);
    await a.loaded();
    await a.submit({ q: 'export csv' });
    await a.open('source-alpha/P-export');
    const plan = a.vc.detailPlan(a.search.selectedPlan()!)!;
    assert.equal(plan.document.state !== undefined, true, 'painted metadata is complete detail, not the search summary');
    assert.equal(svc.count('/v1/plan'), 1, 'one detail read for the opened hit only');
    b.f.apply('P-export', { op: 'change', changes: [{ id: 'T-done', status: 'pending' }] });
    await a.poll();
    await until(() => a.vc.detailPlan(a.search.selectedPlan()!)?.revision === plan.revision + 1, 'current revision');
    assert.equal(svc.count('/v1/plan'), 2, 'one re-read for the observed revision change');
    assert.equal(a.search.view()!.changedKeys, 1, 'results found before the change are qualified');
    await a.poll(); await a.poll();
    assert.equal(svc.count('/v1/plan'), 2, 'no re-read per poll');
    // A failing freshness read is stale (banner), never an empty result.
    const failing = frame({ ...svc, serviceRequest: async (q: GuestRequest) => (q.path === '/v1/search-state' ? { status: 503, body: '{"error":"busy"}' } : svc.serviceRequest(q)) } as SearchProxy);
    await failing.loaded();
    await failing.submit({ q: 'export csv' });
    await failing.poll();
    assert.equal(failing.vc.failure?.kind, 'busy');
    assert.ok(failing.search.view()!.page.hits.length > 0, 'results stay, marked by the stale banner');
    failing.stop(); a.stop();
  });
});

test('freshness polls keep the list poll\'s setup recheck: a pending reload notice is re-read each successful poll', async () => {
  await withBackend(false, async (b, svc) => {
    // Labelled seam: the setup reply reports a pending reload (companion not yet loaded by OpenCode).
    const setup = JSON.stringify({ configured: true, installed: true, verified: true, separateLifecycle: true, activation: 'reload-required', diagnostics: [] });
    const proxy = { ...svc, serviceRequest: async (q: GuestRequest) => (q.path === '/v1/setup' ? (svc.log.push({ path: q.path, query: null, at: svc.log.length }), { status: 200, body: setup }) : svc.serviceRequest(q)) } as SearchProxy;
    const a = frame(proxy);
    await a.loaded(); await settle();
    await a.submit({ q: 'export csv' });
    const mark = svc.log.length;
    await a.poll(); await a.poll();
    const paths = since(svc, mark);
    assert.deepEqual(paths.filter((p) => p !== '/v1/setup'), ['/v1/search-state', '/v1/search-state'], 'still no list read while results are shown');
    assert.equal(paths.filter((p) => p === '/v1/setup').length, 2, 'one setup recheck per successful freshness poll, as after a list read');
    a.stop();
  });
});

test('J1-B1/B4: a new selection retires the old detail read (no continuation, no queue); part caches keep only the selection and recent plans', async () => {
  await withBackend(false, async (b, svc) => {
    b.f.seedPlan('P-many', 'Many export rows', Array.from({ length: 60 }, (_, n) => ({ id: `M${n}`, title: `Row ${n}`, kind: 'task' as const, status: 'pending' as const })));
    for (const n of [1, 2, 3, 4, 5]) b.f.seedPlan(`P-r${n}`, `Recent export ${n}`, [{ id: 'R', title: 'Row', kind: 'task', status: 'pending' }]);
    const a = frame(svc);
    await a.loaded();
    await a.submit({ q: 'export' });
    const reads = (plan: string) => svc.log.filter((l) => l.path === '/v1/plan' && l.query?.plan === plan);
    // B1: hold P-many's first detail page, then open another result of the same run.
    const release = svc.hold('/v1/plan');
    a.search.select('source-alpha/P-many'); a.vc.setUi({ selected: 'source-alpha/P-many' });
    await until(() => reads('P-many').length === 1, 'first page requested');
    await a.open('source-alpha/P-r1');
    assert.ok(a.vc.detailPlan(a.search.selectedPlan()!), 'the next selection completed while the old read was held');
    release(); await settle();
    assert.equal(reads('P-many').length, 1, 'the retired read sent no continuation page after release');
    assert.ok(reads('P-many').every((l) => !l.query?.cursor));
    // B4: open more results; the oldest falls out of the retained set and its cache entry is evicted.
    for (const n of [2, 3, 4, 5]) await a.open(`source-alpha/P-r${n}`);
    const detailOf = (id: string) => a.vc.detail({ key: `source-alpha/${id}` } as Parameters<typeof a.vc.detail>[0]);
    assert.equal(detailOf('P-r1'), null, 'an older opened plan’s detail was evicted');
    assert.equal(detailOf('P-many'), null, 'the retired read never repopulated the cache');
    for (const id of ['P-r2', 'P-r3', 'P-r4', 'P-r5']) assert.equal(detailOf(id)?.state, 'ready', `${id} kept (selection + three recent)`);
    const before = reads('P-r4').length;
    await a.open('source-alpha/P-r4');
    assert.equal(reads('P-r4').length, before, 'a recent plan is reused without a read');
    await a.open('source-alpha/P-r1');
    assert.ok(reads('P-r1').length >= 2, 'an evicted plan is read again');
    a.stop();
  });
});

test('local cleanup, account change and store change retire the search; held windows cannot act afterwards', async () => {
  await withBackend(false, async (b, svc) => {
    b.finish('P-title');
    const a = frame(svc);
    await a.loaded();
    await a.submit({ q: 'export csv' });
    await a.open('source-alpha/P-title');
    // Local cleanup success retires the whole generation (Refresh search offered).
    const listed = a.vc.read;
    // Labelled seam: hold the post-cleanup list reply, so retirement is observed before the re-read lands.
    const relist = svc.hold('/v1/plans');
    a.vc.runCleanup('archive', a.vc.detailPlan(a.search.selectedPlan()!)!);
    await until(() => a.search.view()?.stop === 'retired', 'retired by cleanup');
    assert.match(a.search.view()!.status.text, /Refresh search/);
    assert.equal(a.search.view()!.countsCurrent, false);
    // Cleanup also retires the list: until its authoritative re-read lands there is no store read to
    // search under (the board shows loading and offers no search action).
    await until(() => a.vc.read === null, 'list retired by cleanup');
    relist();
    await until(() => !!a.vc.read && a.vc.read !== listed, 'list re-read painted after cleanup');
    // Held window of a retired run: released after a new run started; it adds nothing.
    const hold = svc.hold('/v1/search');
    a.search.submit('held', criteria({ q: 'Needle' }), { storeId: a.vc.read!.storeId, binding: a.vc.read!.binding }, EMPTY_LIVE);
    a.vc.setUi({ search: { key: 'held', criteria: criteria({ q: 'Needle' }) } });
    await until(() => svc.log.at(-1)?.query?.q === 'Needle', 'held window sent');
    a.account('account-other');
    await settle();
    assert.equal(a.vc.ui.search, null, 'account change resets the board');
    assert.equal(a.search.view(), null);
    const sent = svc.count('/v1/search');
    hold(); await settle();
    assert.equal(svc.count('/v1/search'), sent, 'no continuation from the retired account');
    // Store change: freshness reports a conflict, the list read adopts the new store and resets.
    await a.loaded();
    await a.submit({ q: 'export csv' });
    const other = await searchBackend(true);
    try {
      const swap = searchProxy(other);
      Object.assign(svc, { serviceRequest: swap.serviceRequest });
      await a.poll(); await settle();
      assert.equal(a.vc.read?.storeId, other.f.storeId);
      assert.equal(a.vc.ui.search, null, 'another store never shows this store\'s results');
    } finally { await other.stop(); }
    a.stop();
  });
});

test('hidden frames start neither freshness nor windows; disposal stops everything; rail and Work Status never search', async () => {
  await withBackend(true, async (b, svc) => {
    const a = frame(svc);
    await a.loaded();
    const hold = svc.hold('/v1/search');
    a.search.submit('h', criteria({ q: 'Needle-at-1001' }), { storeId: a.vc.read!.storeId, binding: a.vc.read!.binding }, EMPTY_LIVE);
    a.vc.setUi({ search: { key: 'h', criteria: criteria({ q: 'Needle-at-1001' }) } });
    await until(() => svc.log.at(-1)?.path === '/v1/search', 'window sent');
    const mark = svc.log.length;
    a.hide(); hold(); await settle();
    a.vc.retry(); await settle();
    assert.equal(a.search.view()!.stop, 'hidden');
    assert.deepEqual(since(svc, mark).filter((p) => p.startsWith('/v1/search')), [], 'hidden: no continuation');
    a.show(); await settle();
    a.search.more(); await until(() => !a.search.view()!.busy, 'continued');
    const total = svc.log.length;
    a.stop(); await settle();
    a.search.more(); a.vc.retry(); await settle();
    assert.equal(svc.log.length, total, 'disposed: no requests');
    for (const surface of ['panel', 'status'] as const) {
      const s = searchProxy(b);
      const f = frame(s, surface);
      await f.loaded();
      for (let i = 0; i < 3; i++) await f.poll();
      assert.equal(s.log.filter((l) => l.path.startsWith('/v1/search')).length, 0, `${surface}: zero search requests`);
      f.stop();
    }
  });
});
