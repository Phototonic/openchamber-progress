import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import type { GuestRequest, GuestRequestResult, HostReadyContext } from '@openchamber/sdk';
import { countItems, type Item, type PlanSummary } from '../../shared/progress.ts';
import { parsePlanPage, parsePlansPage } from '../../ui/shared/adapter.ts';
import type { ViewContext, ViewSpec } from '../../ui/shared/app.ts';
import { EMPTY_LIVE } from '../../ui/shared/live.ts';
import { summarize, type Lifecycle, type PlanDetail, type PlanView } from '../../ui/shared/model.ts';
import { assignment, invalidReason, readiness, type Readiness } from '../../ui/shared/readiness.ts';
import * as refresh from '../../ui/shared/refresh.ts';
import * as path from '../../ui/shared/path.ts';
import * as cleanup from '../../ui/shared/cleanup.ts';
import * as source from '../../ui/shared/source.ts';
import { HEALTH, setupRead } from './fixtures.ts';
import {
  boundaryItems, FOREIGN, READY_CONTRIBUTIONS, READY_ITEMS, READY_LINKS, readyEnvelope, readyPage, readySummary, SA, SB, SC, SOURCE, STORE,
} from './ready-tasks-fixtures.ts';

const planOf = (summary: PlanSummary) => parsePlansPage(JSON.stringify({ ...readyEnvelope(), data: [summary], nextCursor: null })).data[0];
function detailOf(items: unknown[] = READY_ITEMS, summary = readySummary(), contributions: unknown[] = READY_CONTRIBUTIONS): { plan: PlanView; detail: PlanDetail } {
  const page = parsePlanPage(JSON.stringify({ ...readyPage(summary, items, contributions), items: { data: items, nextCursor: null }, contributions: { data: contributions, nextCursor: null } }));
  return { plan: page.plan, detail: { key: page.plan.key, revision: page.plan.revision, items: page.items.data, contributions: page.contributions.data, links: page.links } };
}
const ready = (r: Readiness) => { assert.equal(r.state, 'ready'); return r as Extract<Readiness, { state: 'ready' }>; };
const ids = (r: Readiness) => { const x = ready(r); return Object.fromEntries(Object.entries(x.groups).map(([k, v]) => [k, v.map((e) => e.item.id)])); };
const classify = (items: Item[], lifecycle: Lifecycle = 'active') => { const { plan, detail } = detailOf(items); return readiness({ ...plan, lifecycle }, { state: 'ready', value: detail }); };
const withItem = (id: string, patch: Partial<Item>, items = READY_ITEMS) => items.map((i) => (i.id === id ? { ...i, ...patch } : i));
function deepFreeze<T>(v: T): T { if (v && typeof v === 'object') { Object.freeze(v); for (const x of Object.values(v)) deepFreeze(x); } return v; }

test('fixture classification: ready R/I, waiting W, skipped K, blocked B; inputs and counts untouched', () => {
  const { plan, detail } = detailOf();
  const before = JSON.stringify(detail);
  const counts = summarize(plan, detail);
  deepFreeze(detail);
  const r = ready(readiness(plan, { state: 'ready', value: detail }));
  assert.deepEqual(ids(r), { ready: ['R', 'I'], waiting: ['W'], skipped: ['K'], blocked: ['B'] });
  assert.equal(JSON.stringify(detail), before);
  assert.deepEqual(countItems(detail.items), { done: 1, total: 7, remaining: 6, skipped: 1 });
  assert.deepEqual([counts.done, counts.total, counts.remaining, counts.skipped], [1, 7, 6, 1]);
  assert.deepEqual(summarize(plan, detail), counts);
  // Every recorded prerequisite is explained, done ones included; K appears exactly once.
  const all = Object.values(r.groups).flat();
  assert.equal(all.filter((e) => e.item.id === 'K').length, 1);
  const k = r.groups.skipped[0];
  assert.deepEqual(k.prerequisites, [{ kind: 'task', id: 'S', title: 'Optional benchmark', status: 'skipped' }, { kind: 'task', id: 'W', title: 'Write the summary', status: 'pending' }]);
  assert.deepEqual(r.groups.ready[0].prerequisites, [{ kind: 'task', id: 'D', title: 'Prepare inputs', status: 'done' }]);
  assert.deepEqual(r.groups.blocked[0].prerequisites.map((p) => p.kind === 'task' && p.status), ['done']);
  assert.deepEqual(r.groups.ready.map((e) => e.recorded), ['listed', 'omitted']);
  assert.ok(all.every((e) => e.parent.kind === 'known' && e.parent.title === 'Release preparation'));
  assert.ok(!all.some((e) => ['G', 'D', 'S', 'X'].includes(e.item.id)), 'groups and working/done/skipped tasks are never readiness entries');
  assert.equal(r.incomplete, false);
});

test('precedence follows reported changes: blocked never auto-clears, skipped is never done', () => {
  assert.deepEqual(ids(classify(withItem('D', { status: 'working' }))), { ready: ['I'], waiting: ['R', 'W'], skipped: ['K'], blocked: ['B'] });
  assert.deepEqual(ids(classify(withItem('R', { status: 'done' }))), { ready: ['W', 'I'], waiting: [], skipped: ['K'], blocked: ['B'] });
  assert.deepEqual(ids(classify(withItem('S', { status: 'done' }))), { ready: ['R', 'I'], waiting: ['W', 'K'], skipped: [], blocked: ['B'] });
  const unblocked = withItem('W', { status: 'done' }, withItem('R', { status: 'done' }, withItem('S', { status: 'done' })));
  assert.deepEqual(ids(classify(unblocked)).ready, ['K', 'I']);
  // B stays explicitly blocked with every prerequisite done, and with none recorded.
  assert.deepEqual(ids(classify(withItem('B', { dependencies: undefined }))).blocked, ['B']);
  assert.deepEqual(ids(classify(withItem('B', { dependencies: [] }))).blocked, ['B']);
  // A blocked prerequisite only makes its dependants wait.
  assert.deepEqual(ids(classify(withItem('W', { dependencies: ['B'] }))).waiting, ['W']);
  for (const lifecycle of ['completed', 'cancelled', 'failed'] as const) assert.deepEqual(classify(READY_ITEMS, lifecycle), { state: 'closed' });
});

test('omitted and explicit empty lists are "none recorded", never proof; empty, all-skipped and all-done active plans claim nothing', () => {
  const r = ready(classify(withItem('I', { dependencies: [] })));
  assert.equal(r.groups.ready.find((e) => e.item.id === 'I')?.recorded, 'empty');
  assert.deepEqual(ids(classify([])), { ready: [], waiting: [], skipped: [], blocked: [] });
  assert.deepEqual(ids(classify(READY_ITEMS.map((i) => ({ ...i, status: i.kind === 'task' ? 'skipped' : i.status })))), { ready: [], waiting: [], skipped: [], blocked: [] });
  assert.deepEqual(ids(classify(READY_ITEMS.map((i) => ({ ...i, status: 'done' })))), { ready: [], waiting: [], skipped: [], blocked: [] });
});

test('unresolved and group references stay visible and keep their dependant from being ready', () => {
  const dangling = ready(classify(withItem('I', { dependencies: ['gone', 'D'] })));
  const i = dangling.groups.waiting.find((e) => e.item.id === 'I')!;
  assert.deepEqual(i.prerequisites, [{ kind: 'unresolved', id: 'gone' }, { kind: 'task', id: 'D', title: 'Prepare inputs', status: 'done' }]);
  assert.equal(i.incomplete, true); assert.equal(dangling.incomplete, true);
  const group = ready(classify(withItem('I', { dependencies: ['G'] })));
  assert.deepEqual(group.groups.waiting.find((e) => e.item.id === 'I')!.prerequisites, [{ kind: 'not-task', id: 'G', title: 'Release preparation' }]);
  // A known skipped prerequisite still decides the waiting subgroup; other reasons remain listed.
  const mixed = ready(classify(withItem('K', { dependencies: ['S', 'gone'] })));
  assert.deepEqual(mixed.groups.skipped.map((e) => [e.item.id, e.prerequisites.map((p) => p.kind)]), [['K', ['task', 'unresolved']]]);
  // An unknown parent is reported as unknown, not guessed or dropped.
  assert.deepEqual(ready(classify(withItem('I', { parentId: 'missing-group' }))).groups.ready.find((e) => e.item.id === 'I')!.parent, { kind: 'unknown', id: 'missing-group' });
});

test('malformed dependency lists are refused by the adapter; omitted lists still parse', () => {
  const parse = (dependencies: unknown) => parsePlanPage(JSON.stringify(readyPage(readySummary(), [{ id: 'T', title: 'Task', kind: 'task', status: 'pending', dependencies }], [])));
  for (const bad of [null, 'D', {}, [1], ['D', null], ['']]) assert.throws(() => parse(bad), /unreadable dependencies/, JSON.stringify(bad));
  assert.equal(parse(undefined).items.data[0].dependencies, undefined);
  assert.deepEqual(parse([]).items.data[0].dependencies, []);
  const failed = source.classify(captureError(() => parse([1])));
  assert.equal(failed.kind, 'invalid');
});
function captureError(fn: () => unknown) { try { fn(); } catch (e) { return e; } throw new Error('expected a throw'); }

test('duplicate IDs, self-edges and cycles make readiness unavailable without repair; long chains stay bounded', () => {
  assert.deepEqual(classify([...READY_ITEMS, { id: 'R', title: 'Duplicate R', kind: 'task', status: 'pending' }]), { state: 'invalid', reason: 'duplicate-id' });
  assert.deepEqual(classify(withItem('I', { dependencies: ['I'] })), { state: 'invalid', reason: 'self-dependency' });
  assert.deepEqual(classify(withItem('R', { dependencies: ['D', 'W'] })), { state: 'invalid', reason: 'cycle' });
  const chain: Item[] = Array.from({ length: 1000 }, (_, n) => ({ id: `C${n}`, title: `Chain ${n}`, kind: 'task', status: n < 999 ? 'done' : 'pending', ...(n ? { dependencies: [`C${n - 1}`] } : {}) }));
  assert.equal(invalidReason(chain), null);
  assert.deepEqual(ids(classify(chain)).ready, ['C999']);
  assert.equal(invalidReason([...chain.slice(0, 999), { ...chain[999], dependencies: ['C998', 'C999x'] }, { id: 'C999x', title: 'Back edge', kind: 'task', status: 'pending', dependencies: ['C999'] }]), 'cycle');
});

test('loading, failed and mismatched detail never classify', () => {
  const { plan, detail } = detailOf();
  assert.deepEqual(readiness(plan, null), { state: 'loading' });
  assert.deepEqual(readiness(plan, { state: 'loading' }), { state: 'loading' });
  assert.deepEqual(readiness(plan, { state: 'error' }), { state: 'unavailable' });
  assert.deepEqual(readiness({ ...plan, revision: plan.revision + 1 }, { state: 'ready', value: detail }), { state: 'loading' });
  assert.deepEqual(readiness({ ...plan, key: `${FOREIGN}/P-ready` }, { state: 'ready', value: detail }), { state: 'loading' });
});

test('assignment is the recorded assignee only; "selected" needs the same session and the verified bound source', () => {
  const r = ready(classify(READY_ITEMS));
  const entry = (id: string) => Object.values(r.groups).flat().find((e) => e.item.id === id)!;
  assert.equal(entry('W').assigneeSessionId, null, 'a link to B is not a recorded assignee');
  assert.equal(entry('I').assigneeSessionId, null, 'the plan owner is not a default assignee');
  assert.deepEqual(assignment(entry('R'), SA, SOURCE, SOURCE), { kind: 'selected', sessionId: SA });
  assert.deepEqual(assignment(entry('R'), SB, SOURCE, SOURCE), { kind: 'other', sessionId: SA });
  assert.deepEqual(assignment(entry('R'), null, SOURCE, SOURCE), { kind: 'other', sessionId: SA });
  assert.deepEqual(assignment(entry('R'), SA, FOREIGN, SOURCE), { kind: 'other', sessionId: SA }, 'foreign source never borrows the selected session');
  assert.deepEqual(assignment(entry('R'), SA, SOURCE, null), { kind: 'other', sessionId: SA }, 'no verified binding');
  assert.deepEqual(assignment(entry('W'), SB, SOURCE, SOURCE), { kind: 'none' });
  // Reports stay distinct from assignment; repeated relays and duplicate item IDs give one report each.
  assert.deepEqual(entry('K').reports, [{ mode: 'direct', reporterSessionId: SC, attributedSessionId: SC }, { mode: 'parent-relay', reporterSessionId: SA, attributedSessionId: SC }]);
  assert.equal(entry('K').assigneeSessionId, SC);
  assert.equal(READY_LINKS.length, 2);
});

// ---------------------------------------------------------------- read boundary (Q2)

type Route = (q: GuestRequest) => Promise<GuestRequestResult> | GuestRequestResult;
const reply = (body: unknown, status = 200): GuestRequestResult => ({ status, body: JSON.stringify(body) });
function host(route: Route) { const calls: GuestRequest[] = []; return { calls, serviceRequest: async (q: GuestRequest) => { calls.push(q); return route(q); } }; }
const page = (q: GuestRequest) => Number(q.query?.cursor ?? 0);
function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; }
async function settle() { for (let i = 0; i < 8; i++) await new Promise<void>((r) => setImmediate(r)); }

test('20+1 boundary: nothing is exposed while page 2 is held; the final-page prerequisite then resolves', async () => {
  const items = boundaryItems(21);
  const summary = readySummary(items);
  const held = deferred<GuestRequestResult>();
  const h = host((q) => (page(q) === 1 ? held.promise : reply(readyPage(summary, items, [], page(q)))));
  let settled = false;
  const pending = source.readDetail(h, planOf(summary)).then((r) => { settled = true; return r; });
  await settle();
  assert.equal(settled, false, 'no partial detail while a continuation is pending');
  assert.deepEqual(h.calls.map((c) => c.query?.cursor ?? '-'), ['-', '1']);
  held.resolve(reply(readyPage(summary, items, [], 1)));
  const res = await pending;
  assert.ok(res.ok);
  const r = readiness(res.plan, { state: 'ready', value: res.detail });
  assert.ok(ids(r).ready.includes('T0'), 'first-page task is ready only once its final-page prerequisite is known done');
  assert.deepEqual(ready(r).groups.ready.find((e) => e.item.id === 'T0')!.prerequisites, [{ kind: 'task', id: 'T20', title: 'Final page prerequisite', status: 'done' }]);
  // The same boundary with a pending final task is waiting, never ready from the first page.
  const items2 = boundaryItems(21, 'pending');
  const res2 = await source.readDetail(host((q) => reply(readyPage(readySummary(items2), items2, [], page(q)))), planOf(readySummary(items2)));
  assert.ok(res2.ok && ids(readiness(res2.plan, { state: 'ready', value: res2.detail })).waiting.includes('T0'));
});

test('unequal item/contribution cursors: one cursor, only open lists appended; contributions never become tasks', async () => {
  const contributions = Array.from({ length: 45 }, (_, n) => ({ ...READY_CONTRIBUTIONS[2], revision: n + 1 }));
  const s = readySummary();
  const res = await source.readDetail(host((q) => reply(readyPage(s, READY_ITEMS, contributions, page(q)))), planOf(s));
  assert.ok(res.ok);
  assert.deepEqual([res.detail.items.length, res.detail.contributions.length], [9, 45]);
  const r = ready(readiness(res.plan, { state: 'ready', value: res.detail }));
  assert.equal(Object.values(r.groups).flat().length, 5);
  assert.deepEqual(r.groups.skipped[0].reports, [{ mode: 'parent-relay', reporterSessionId: SA, attributedSessionId: SC }]);
  assert.deepEqual(countItems(res.detail.items), countItems(READY_ITEMS));
  const many = boundaryItems(45);
  const res2 = await source.readDetail(host((q) => reply(readyPage(readySummary(many), many, READY_CONTRIBUTIONS, page(q)))), planOf(readySummary(many)));
  assert.ok(res2.ok);
  assert.deepEqual([res2.detail.items.length, res2.detail.contributions.length], [45, 4]);
});

test('revision restarts stay bounded; mixed store/binding/plan pages and cap exhaustion are errors, never empty success', async () => {
  const items = boundaryItems(21);
  let rev = 3;
  const churn = await source.readDetail(host((q) => reply(readyPage(readySummary(items, { revision: page(q) ? ++rev : rev }), items, [], page(q)))), planOf(readySummary(items)));
  assert.equal(churn.ok, false);
  assert.equal(!churn.ok && churn.failure.kind, 'invalid');
  const swaps: [string, (q: GuestRequest) => unknown][] = [
    ['store', (q) => readyPage(readySummary(items), items, [], page(q), READY_LINKS, readyEnvelope(page(q) ? { storeId: 'store-other' } : {}))],
    ['binding', (q) => readyPage(readySummary(items), items, [], page(q), READY_LINKS, readyEnvelope(page(q) ? { sourceBinding: { sourceId: FOREIGN, verified: false } } : {}))],
    ['plan source', (q) => readyPage(readySummary(items, page(q) ? { sourceId: FOREIGN } : {}), items, [], page(q))],
  ];
  for (const [what, body] of swaps) {
    const h = host((q) => reply(body(q)));
    const res = await source.readDetail(h, planOf(readySummary(items)));
    assert.equal(res.ok, false, what);
    assert.equal(!res.ok && res.failure.kind, 'invalid', what);
    assert.equal(h.calls.length, 2, `${what}: refused at the mixed page, no restart loop`);
  }
  const wrong = await source.readDetail(host(() => reply(readyPage(readySummary(items, { id: 'P-other' }), items, []))), planOf(readySummary(items)));
  assert.equal(wrong.ok, false);
  const endless = host((q) => reply({ ...readyPage(readySummary(), READY_ITEMS, []), items: { data: [], nextCursor: String(page(q) + 1) } }));
  const capped = await source.readDetail(endless, planOf(readySummary()));
  assert.equal(capped.ok, false);
  assert.equal(endless.calls.length, source.MAX_DETAIL_PAGES);
  const failed = await source.readDetail(host((q) => (page(q) ? reply({ error: 'busy' }, 503) : reply(readyPage(readySummary(items), items, [])))), planOf(readySummary(items)));
  assert.equal(!failed.ok && failed.failure.kind, 'busy');
  assert.deepEqual(readiness(planOf(readySummary(items)), failed.ok ? null : { state: 'error' }), { state: 'unavailable' });
});

test('1000 tasks assemble at the normal page size and classify once', async () => {
  const items: Item[] = Array.from({ length: 1000 }, (_, n) => ({ id: `T${n}`, title: `Task ${n}`, kind: 'task', status: n === 999 ? 'pending' : 'done', ...(n === 999 ? { dependencies: ['T0', 'T500', 'T998'] } : {}) }));
  const s = readySummary(items);
  const h = host((q) => reply(readyPage(s, items, [], page(q))));
  const res = await source.readDetail(h, planOf(s));
  assert.ok(res.ok);
  assert.equal(h.calls.length, 50);
  assert.equal(res.detail.items.length, 1000);
  assert.deepEqual(ids(readiness(res.plan, { state: 'ready', value: res.detail })).ready, ['T999']);
});

// The actual shared controller with a minimal DOM: held continuation pages and context changes.
type Ui = { selected: string | null };
function controller() {
  const listeners: Record<string, (value?: any) => void> = {};
  const requests: GuestRequest[] = [];
  const node = () => ({ dataset: {} as Record<string, string>, firstElementChild: null as any, querySelector: () => null, querySelectorAll: () => [], getAnimations: () => [], setAttribute() {}, append() {}, replaceChildren(child: any) { this.firstElementChild = child; } });
  const mount = node();
  const document = { documentElement: node(), head: node(), visibilityState: 'visible', activeElement: null, getElementById: (id: string) => (id === 'root' ? mount : {}), addEventListener() {}, scrollingElement: { scrollTop: 0 } };
  let store = STORE;
  let route: Route = () => reply({ error: 'not-found' }, 404);
  const svc = (q: GuestRequest): Promise<GuestRequestResult> | GuestRequestResult => {
    if (q.path === '/health') return reply({ ...HEALTH, planCleanup: 1 });
    if (q.path === '/v1/setup') return reply(setupRead());
    if (q.path === '/v1/plans') return reply({ ...readyEnvelope({ storeId: store }), data: q.query?.session === SA ? [items.summary] : [], nextCursor: null });
    return route(q);
  };
  const items = { list: boundaryItems(21), summary: readySummary(boundaryItems(21)) };
  const h = { serviceRequest: async (q: GuestRequest) => { requests.push(q); return svc(q); }, storage: { get: async () => undefined, set: async () => {}, delete: async () => {} }, onReady: (fn: any) => { listeners.ready = fn; }, onSession: (fn: any) => { listeners.session = fn; }, onDirectory: (fn: any) => { listeners.directory = fn; } };
  const exports: any = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL('../../ui/shared/app.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports, document, window: { addEventListener: (name: string, fn: any) => { listeners[name] = fn; } }, queueMicrotask, performance, console, setTimeout: () => 1, clearTimeout() {},
    require: (name: string) => {
      if (name === '@openchamber/sdk') return { connectHost: () => h };
      if (name === '@openchamber/sdk/ui') return { applyHostReady() {} };
      if (name === './source.ts') return source;
      if (name === './cleanup.ts') return cleanup;
      if (name === './refresh.ts') return refresh;
      if (name === './path.ts') return path;
      if (name === './components.ts') return { el: node, refreshLabels() {} };
      if (name === './live.ts') return { LiveWorkspace: class { snapshot = EMPTY_LIVE; sessionSubscriptionCount = 0; start() {} restart() {} want() {} dispose() {} } };
      if (name === './official.ts') return { OfficialMainState: class { check = async () => ({ next: null, apply: () => false }); } };
      return {};
    },
  });
  let vc!: ViewContext<Ui>;
  const spec: ViewSpec<Ui> = {
    surface: 'panel', maxSessionSubscriptions: 2, initialUi: () => ({ selected: null }),
    scope: ({ session }) => (session ? { session: session.id } : null),
    wantProjects: () => [], wantDetails: (c) => c.read?.plans.slice(0, 1) ?? [],
    paint: (_root, value) => { vc = value; },
  };
  exports.startView(spec);
  return {
    requests, items, get vc() { return vc; }, setStore: (s: string) => { store = s; }, setRoute: (r: Route) => { route = r; },
    ready: (id: string | null) => listeners.ready({ session: id ? { id } : null, directory: '/fixture/ready', connection: { account: 'fixture' }, locale: 'en', surface: 'panel' } as HostReadyContext),
    retry: () => vc.retry(), stop: () => listeners.pagehide(),
  };
}
const readinessIn = (vc: ViewContext<Ui>) => { const p = vc.read?.plans[0]; return p ? readiness(p, vc.detail(p)) : null; };

test('actual controller: held continuation shows loading; context or store change retires it without further pages', async () => {
  const c = controller();
  const held = deferred<GuestRequestResult>();
  c.setRoute((q) => (q.path === '/v1/plan' && page(q) === 1 ? held.promise : reply(readyPage(c.items.summary, c.items.list, [], page(q)))));
  c.ready(SA); await settle();
  assert.deepEqual(readinessIn(c.vc), { state: 'loading' }, 'a held page 2 is loading, never a ready prefix');
  // A → null → B: retired; releasing the held page issues nothing and paints nothing.
  c.ready(null); await settle(); c.ready(SB); await settle();
  const mark = c.requests.length;
  held.resolve(reply(readyPage(c.items.summary, c.items.list, [], 1))); await settle();
  assert.equal(c.requests.slice(mark).some((q) => q.path === '/v1/plan'), false);
  assert.equal(readinessIn(c.vc), null);
  assert.ok(c.requests.filter((q) => q.path === '/v1/plans').every((q) => q.query?.session), 'rail lists are always session-scoped');
  // Back to A: a fresh, complete read classifies normally.
  c.setRoute((q) => reply(readyPage(c.items.summary, c.items.list, [], page(q))));
  c.ready(SA); await settle();
  assert.ok(ids(readinessIn(c.vc)!).ready.includes('T0'));
  // Store replacement with identical IDs and revision drops the old detail authority.
  const held2 = deferred<GuestRequestResult>();
  c.setRoute((q) => (q.path === '/v1/plan' ? held2.promise : reply({ error: 'not-found' }, 404)));
  c.setStore('store-replaced'); c.retry(); await settle();
  assert.deepEqual(readinessIn(c.vc), { state: 'loading' }, 'a new store identity cannot reuse the previous detail');
  held2.resolve(reply(readyPage(c.items.summary, c.items.list, [], 0, READY_LINKS, readyEnvelope({ storeId: 'store-replaced' }))));
  c.stop();
});

test('actual controller: a failed detail stays a stable error and is retried once per list refresh, never per paint', async () => {
  const c = controller();
  c.setRoute((q) => (page(q) ? reply({ error: 'busy' }, 503) : reply(readyPage(c.items.summary, c.items.list, [], 0))));
  c.ready(SA); await settle();
  const details = () => c.requests.filter((q) => q.path === '/v1/plan').length;
  assert.equal(details(), 2, 'first page plus the failing continuation, once');
  assert.deepEqual(readinessIn(c.vc), { state: 'unavailable' });
  c.retry(); await settle();
  assert.equal(details(), 4, 'Try again / the next poll retries exactly once');
  assert.deepEqual(readinessIn(c.vc), { state: 'unavailable' });
  c.setRoute((q) => reply(readyPage(c.items.summary, c.items.list, [], page(q))));
  c.retry(); await settle();
  assert.ok(ids(readinessIn(c.vc)!).ready.includes('T0'));
  c.stop();
});

test('null rail session issues no plan, list, document or history query', async () => {
  const c = controller(); c.ready(null); await settle(); c.retry(); await settle();
  assert.deepEqual([...new Set(c.requests.map((q) => q.path))].filter((p) => p.startsWith('/v1/plan') || p === '/v1/document' || p === '/v1/history'), []);
  c.stop();
});
