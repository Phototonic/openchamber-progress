// Waiting-delegation retirement in the actual frame controller (ui/shared/app.ts) with the real
// read parser and deterministic held replies. Declaration, reservation, cancel and invalidation do
// not advance the progress revision: only the list's delegation token moves. DOM, layout and real
// input belong to delegation-intent-qa.ts. The service here is a synthetic contract fixture.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { appCountsModules } from './app-counts-stub.ts';
import type { GuestRequest, GuestRequestResult } from '@openchamber/sdk';
import type { ViewContext, ViewSpec } from '../../ui/shared/app.ts';
import * as source from '../../ui/shared/source.ts';
import * as cleanup from '../../ui/shared/cleanup.ts';
import * as refresh from '../../ui/shared/refresh.ts';
import * as path from '../../ui/shared/path.ts';
import * as language from '../../ui/shared/language.ts';
import * as sessionContext from '../../ui/shared/session-context.ts';
import { EMPTY_LIVE } from '../../ui/shared/live.ts';
import { currentIntent } from '../../ui/shared/intent.ts';
import { readingRequest, type InboxReading } from '../../ui/shared/inbox-view.ts';
import type { PlanDetail, PlanView } from '../../ui/shared/model.ts';
import { INTENT_CANCELLED, INTENT_PENDING, INTENT_REFUSED } from '../fixtures/attention-contracts.ts';
import { HEALTH, SRC, planPage, plansPage, setupRead, summary } from './fixtures.ts';

type Rec = Record<string, any>;
const reply = (body: unknown, status = 200): GuestRequestResult => ({ status, body: JSON.stringify(body) });
function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>((yes) => { resolve = yes; }); return { promise, resolve }; }
async function settle() { for (let i = 0; i < 10; i++) await new Promise<void>((r) => setImmediate(r)); }
const ITEMS = [{ id: 'task-a', title: 'Draft', kind: 'task' as const, status: 'pending' as const }, { id: 'task-b', title: 'Ship', kind: 'task' as const, status: 'pending' as const }];
/** A frozen overlay moved into the fixture store/source/plan at revision 3. */
const overlay = (base: unknown) => { const v = structuredClone(base) as Rec; Object.assign(v, { storeId: 'store-1', source: SRC, sourceBinding: { sourceId: SRC, verified: true } }); return v; };
type Ui = { n: number };

function controller(surface: 'panel' | 'status' = 'panel', capable = true, searching = false, inbox = false) {
  const listeners: Record<string, (v?: any) => void> = {};
  const requests: GuestRequest[] = [];
  const el = (): any => ({ dataset: {}, children: [], append() {}, replaceChildren() {}, setAttribute() {}, querySelector: () => null, querySelectorAll: () => [], contains: () => false, getAnimations: () => [] });
  const mount = el();
  const document = { documentElement: el(), head: el(), body: el(), visibilityState: 'visible', activeElement: null, getElementById: (id: string) => id === 'root' ? mount : {}, addEventListener() {}, scrollingElement: { scrollTop: 0 } };
  const state = { token: 'intent-pending', overlay: overlay(INTENT_PENDING) as Rec | null, revision: 3 };
  const plan = () => ({ ...summary('plan-alpha', ITEMS, { revision: state.revision, cleanup: { state: 'visible', revision: 0 } } as never), ...(state.token ? { delegationToken: state.token } : {}) });
  const normal = (q: GuestRequest) => reply({ ...planPage(plan() as never, ITEMS, [], undefined, []), ...(q.query?.delegationIntent === '1' && state.overlay ? { delegationIntent: state.overlay } : {}) });
  let detail: (q: GuestRequest) => Promise<GuestRequestResult> | GuestRequestResult = normal;
  const host = {
    serviceRequest: async (q: GuestRequest) => {
      requests.push(q);
      if (q.path === '/health') return reply({ ...HEALTH, ...(capable ? { delegationIntent: 1 } : {}) });
      if (q.path === '/v1/setup') return reply(setupRead());
      if (q.path === '/v1/plans') return reply(plansPage([plan() as never]));
      if (q.path === '/v1/plan') return detail(q);
      return reply({ error: 'not-found' }, 404);
    },
    storage: { get: async () => undefined, set: async () => {}, delete: async () => {} },
    onItem() { return () => {}; }, onConnection() { return () => {}; },
    onReady: (fn: any) => { listeners.ready = fn; }, onSession: (fn: any) => { listeners.session = fn; }, onDirectory: (fn: any) => { listeners.directory = fn; },
  };
  const exports: any = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL('../../ui/shared/app.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    AbortController, exports, document, navigator: {}, window: { addEventListener: (name: string, fn: any) => { listeners[name] = fn; } }, queueMicrotask, performance, console, setTimeout: () => 1, clearTimeout() {},
    require: (name: string) => {
      if (name in appCountsModules) return appCountsModules[name];
      if (name === '@openchamber/sdk') return { connectHost: () => host };
      if (name === '@openchamber/sdk/ui') return { applyHostReady() {} };
      if (name === './phone-layout.ts') return { applyDeviceHooks() {} };
      if (name === './source.ts') return source;
      if (name === './setup.ts') return { retireSetupSteps() {} };
      if (name === './cleanup.ts') return cleanup;
      if (name === './refresh.ts') return refresh;
      if (name === './path.ts') return path;
      if (name === './language.ts') return language;
      if (name === './session-context.ts') return sessionContext;
      if (name === './components.ts') return { el, refreshLabels() {}, retireReadingUi() {}, beginInfoPaint() {}, commitInfoPaint() {} };
      if (name === './live.ts') return { LiveWorkspace: class { snapshot = EMPTY_LIVE; sessionSubscriptionCount = 0; start() {} restart() {} want() {} dispose() {} } };
      if (name === './official.ts') return { OfficialMainState: class { check = async () => ({ next: null, apply: () => false }); } };
      return {};
    },
  });
  let vc!: ViewContext<Ui>;
  const reading: InboxReading = { token: 1, target: { storeId: 'store-1', source: SRC, plan: 'plan-alpha', task: 'task-a', revision: 3, cleanupRev: 0 }, task: 'Draft', planTitle: 'Plan alpha', coordinator: 'A', group: 'needs-you', rowKey: 'task-a' };
  const inboxPlan = (c: ViewContext<Ui>) => {
    const request = readingRequest(reading);
    return readingRequest(reading, null, c.detailPlan(request));
  };
  // Search selection metadata deliberately omits the list's delegation token.
  const searchPlan = (c: ViewContext<Ui>): PlanView[] => (c.read?.plans.slice(0, 1) ?? []).map(({ delegationToken: _token, ...p }) => p);
  const spec: ViewSpec<Ui> = {
    surface, maxSessionSubscriptions: 2, initialUi: () => ({ n: 0 }),
    scope: ({ session }) => session ? { session: session.id } : null,
    wantProjects: () => [], wantDetails: (c) => surface === 'status' ? [] : c.read?.plans.slice(0, 1) ?? [],
    ...(searching ? {
      // Only the open plan's bounded head may update its overlay; requests remain token-free,
      // like SearchController.selectedPlan(). Rendered QA exercises the actual board.
      wantDetails: searchPlan,
      freshness: () => async () => ({ state: 'fresh' as const, captureEnabled: true }),
      refreshDetails: searchPlan,
      reading: (c: ViewContext<Ui>) => ({ plan: c.read?.plans[0]?.key ?? '', scope: `search:${c.ui.n}` }),
    } : {}),
    ...(inbox ? {
      wantDetails: (c: ViewContext<Ui>) => [inboxPlan(c)],
      refreshDetails: (c: ViewContext<Ui>) => [inboxPlan(c)],
      reading: () => ({ plan: `${SRC}/plan-alpha`, scope: 'inbox:1' }),
    } : {}),
    paint: (_root, c) => { vc = c; },
  };
  exports.startView(spec);
  const listed = (): PlanView => inbox ? inboxPlan(vc) : searching ? searchPlan(vc)[0] : vc.read!.plans[0];
  return {
    state, requests,
    ready: () => listeners.ready({ session: { id: 'A' }, directory: null, connection: { account: 'example' }, locale: 'en', surface }),
    /** One ordinary list refresh (the visible poll's job). */
    poll: async () => { vc.retry(); await settle(); },
    route: (r: typeof detail) => { detail = r; }, normal,
    get plan() { return listed(); },
    get detail() { return vc.detail(listed()); },
    get intent() { const d = vc.detail(listed()); return d?.state === 'ready' ? currentIntent(searching ? vc.detailPlan(listed()) ?? listed() : listed(), d.value) : null; },
    reads: () => requests.filter((q) => q.path === '/v1/plan').length,
    stop: () => listeners.pagehide(),
    leave: () => vc.setUi({ n: vc.ui.n + 1 }),
  };
}

test('an inbox reading with token-free metadata and no overlay uses only one head per unchanged poll', async () => {
  const c = controller('panel', true, false, true);
  try {
    c.state.token = ''; c.state.overlay = null;
    c.ready(); await settle();
    assert.equal(c.detail?.state, 'ready');
    assert.equal(c.plan.delegationToken, undefined);
    const detail = (c.detail as { value: PlanDetail }).value;
    for (let i = 0; i < 3; i++) {
      const reads = c.reads();
      await c.poll();
      assert.equal(c.reads(), reads + 1, 'one head, no redundant full-detail refreshes');
      assert.equal(c.intent?.state, 'absent');
      assert.equal((c.detail as { value: PlanDetail }).value.items, detail.items);
    }
  } finally { c.stop(); }
});

test('an inbox head clears a missing overlay without rereading token-free detail', async () => {
  const c = controller('panel', true, false, true);
  try {
    c.state.token = ''; // Detail metadata has no token; only the head's overlay can supply it.
    c.ready(); await settle();
    await c.poll();
    assert.equal(c.intent?.state, 'waiting');
    const detail = (c.detail as { value: PlanDetail }).value;
    c.state.overlay = null;
    for (let i = 0; i < 2; i++) {
      const reads = c.reads();
      await c.poll();
      assert.equal(c.reads(), reads + 1, 'overlay retirement and unchanged polls need only a head');
      assert.equal(c.intent?.state, 'absent');
      assert.equal(c.intent?.tasks.size, 0);
      assert.equal((c.detail as { value: PlanDetail }).value.items, detail.items);
    }
  } finally { c.stop(); }
});

test('search cadence clears a same-revision cancellation without rereading the list or replacing tasks', async () => {
  const c = controller('panel', true, true);
  try {
    c.ready(); await settle();
    assert.equal(c.intent?.state, 'waiting');
    const lists = c.requests.filter(q => q.path === '/v1/plans').length;
    const detail = (c.detail as { value: PlanDetail }).value;
    assert.equal(c.plan.delegationToken, undefined, 'search requests stay token-free after head adoption');
    // Adopt a new waiting token before checking unchanged polls (reservation stays waiting).
    c.state.token = 'intent-reserved';
    c.state.overlay = { ...overlay(INTENT_PENDING), token: c.state.token };
    const beforeAdoption = c.reads();
    await c.poll();
    assert.equal(c.reads(), beforeAdoption + 1, 'adoption needs only the head');
    for (let i = 0; i < 3; i++) {
      const reads = c.reads();
      await c.poll();
      assert.equal(c.reads(), reads + 1, 'one head per unchanged pending poll');
      assert.equal(c.intent?.state, 'waiting');
      assert.equal((c.detail as { value: PlanDetail }).value.items, detail.items);
    }
    const reads = c.reads();
    c.state.token = 'intent-cancelled'; c.state.overlay = overlay(INTENT_CANCELLED);
    await c.poll();
    assert.equal(c.intent?.state, 'clear');
    assert.equal(c.plan.revision, 3);
    assert.equal(c.plan.delegationToken, undefined);
    assert.equal(c.reads(), reads + 1, 'one bounded head, no second full-detail read');
    assert.equal(c.requests.filter(q => q.path === '/v1/plans').length, lists);
    assert.equal((c.detail as { value: PlanDetail }).value.items, detail.items, 'complete tasks are retained, not replaced by the head page');
  } finally { c.stop(); }
});

test('search heads coalesce slow reads and reject a retired same-plan reading', async () => {
  const c = controller('panel', true, true);
  const held = deferred<GuestRequestResult>();
  try {
    c.ready(); await settle();
    c.route(() => held.promise);
    const reads = c.reads();
    await c.poll(); await c.poll();
    assert.equal(c.reads(), reads + 1, 'one head in flight');
    c.state.token = 'intent-cancelled'; c.state.overlay = overlay(INTENT_CANCELLED);
    c.route(c.normal);
    held.resolve(c.normal({ method: 'GET', path: '/v1/plan', query: { delegationIntent: '1' } }));
    await settle();
    assert.equal(c.intent?.state, 'clear', 'a slow current success advances the overlay');
    assert.equal(c.reads(), reads + 2, 'one coalesced follow-up');
    const retired = deferred<GuestRequestResult>();
    c.route(() => retired.promise); await c.poll();
    c.leave(); await settle();
    c.state.token = 'intent-refused'; c.state.overlay = overlay(INTENT_REFUSED);
    retired.resolve(c.normal({ method: 'GET', path: '/v1/plan', query: { delegationIntent: '1' } }));
    await settle();
    assert.equal(c.intent?.state, 'clear', 'a retired head cannot paint in another reading');
  } finally { held.resolve(reply({}, 503)); c.stop(); }
});

test('a pending declaration shows from the detail overlay; an unchanged token never re-reads detail', async () => {
  const c = controller();
  try {
    c.ready(); await settle();
    assert.equal(c.plan.delegationToken, 'intent-pending');
    assert.equal(c.intent?.state, 'waiting');
    assert.deepEqual([...c.intent!.tasks.keys()], ['task-a']);
    assert.ok(c.requests.filter((q) => q.path === '/v1/plans').every((q) => q.query?.delegationIntent === '1'));
    assert.ok(c.requests.filter((q) => q.path === '/v1/plan').every((q) => q.query?.delegationIntent === '1'));
    const reads = c.reads();
    for (let i = 0; i < 3; i++) await c.poll();
    assert.equal(c.reads(), reads, 'the note adds no detail read or polling loop of its own');
    assert.ok(c.requests.every((q) => q.method === 'GET'), 'reads only; nothing settles, assigns or dispatches');
  } finally { c.stop(); }
});

test('a token-only change retires the note before the reply and keeps the tasks painted', async () => {
  const c = controller();
  try {
    c.ready(); await settle();
    assert.equal(c.intent?.state, 'waiting');
    const held = deferred<void>();
    c.route(async (q) => { await held.promise; return c.normal(q); });
    // Cancelled at the same progress revision: only the list token moves.
    c.state.token = 'intent-cancelled'; c.state.overlay = overlay(INTENT_CANCELLED);
    const reads = c.reads();
    await c.poll();
    assert.equal(c.reads(), reads + 1, 'exactly one background detail read');
    assert.equal(c.detail?.state, 'ready', 'no loading gap: the task list stays painted');
    assert.equal(c.intent?.state, 'stale', 'the old pending note is not painted while the reply is held');
    assert.equal(c.intent?.tasks.size, 0);
    await c.poll();
    assert.equal(c.reads(), reads + 1, 'an in-flight refresh is not repeated by the next poll');
    held.resolve(); await settle();
    assert.equal(c.intent?.state, 'clear');
    // Refused later, still at revision 3: shown as a refusal, not as waiting.
    c.route(c.normal);
    c.state.token = 'intent-refused'; c.state.overlay = overlay(INTENT_REFUSED);
    await c.poll();
    assert.equal(c.intent?.state, 'refused');
    assert.deepEqual([...c.intent!.tasks], [['task-a', { state: 'refused', reason: 'changed' }]]);
    assert.equal((c.detail as { value: PlanDetail }).value.revision, 3);
  } finally { c.stop(); }
});

test('a failed token refresh keeps the tasks without a note and retries after the next list read', async () => {
  const c = controller();
  try {
    c.ready(); await settle();
    c.route(() => reply({ error: 'busy' }, 503));
    c.state.token = 'intent-reserved-later';
    const reads = c.reads();
    await c.poll();
    assert.equal(c.reads(), reads + 1);
    assert.equal(c.detail?.state, 'ready', 'a failed overlay refresh never replaces ready tasks with an error');
    assert.equal(c.intent?.state, 'stale');
    c.route(c.normal);
    c.state.overlay = { ...overlay(INTENT_PENDING), token: 'intent-reserved-later' };
    await c.poll();
    assert.equal(c.reads(), reads + 2, 'retried once on the next list read');
    assert.equal(c.intent?.state, 'waiting');
  } finally { c.stop(); }
});

test('Work Status and older services never ask for the overlay and never show a note', async () => {
  const status = controller('status');
  try {
    status.ready(); await settle();
    assert.ok(status.requests.length > 0);
    assert.ok(status.requests.every((q) => q.query?.delegationIntent === undefined));
  } finally { status.stop(); }
  const older = controller('panel', false);
  try {
    older.state.token = ''; // an older service supplies no token
    older.ready(); await settle();
    assert.ok(older.requests.every((q) => q.query?.delegationIntent === undefined));
    assert.equal(older.detail?.state, 'ready');
    assert.equal(older.intent?.state, 'absent');
    assert.equal(older.intent?.tasks.size, 0);
  } finally { older.stop(); }
});
