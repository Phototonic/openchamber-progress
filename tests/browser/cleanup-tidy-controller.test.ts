// Actual startView controller, with held service receipts and explicitly driven context events.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { appCountsModules } from './app-counts-stub.ts';
import type { ViewContext, ViewSpec } from '../../ui/shared/app.ts';
import * as source from '../../ui/shared/source.ts';
import * as cleanup from '../../ui/shared/cleanup.ts';
import * as refresh from '../../ui/shared/refresh.ts';
import * as language from '../../ui/shared/language.ts';
import * as path from '../../ui/shared/path.ts';
import * as sessionContext from '../../ui/shared/session-context.ts';
import * as checkpoints from '../../ui/shared/change-digest-checkpoint.ts';
import * as liveModule from '../../ui/shared/live.ts';
import type { LiveProject, LiveSession } from '../../ui/shared/live.ts';
import { BoardDerivation, NO_FILTERS } from '../../ui/shared/scope.ts';
import { inPlace, scopeAvailability } from '../../ui/shared/search.ts';
import type { PlanSummary } from '../../shared/progress.ts';
const { EMPTY_LIVE } = liveModule;
import { HEALTH, plansPage, summary, S } from './fixtures.ts';
import { pageHook } from './page-hooks.ts';

const APP = ts.transpileModule(readFileSync(new URL('../../ui/shared/app.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const drain = async () => { for (let n = 0; n < 40; n++) await new Promise<void>(r => setImmediate(r)); };
async function until(check: () => boolean) {
  for (let n = 0; n < 100; n++) { if (check()) return; await drain(); }
  assert.fail('Controller did not reach the expected state');
}
/** Host-side workspace streams for the real LiveWorkspace: `pause` leaves discovery loading, as after a restart. */
function liveFeed(config: { projects: LiveProject[]; sessions: LiveSession[]; worktrees?: { directory: string; name: string; branch: string; status: 'ready' }[] }) {
  let ready = true;
  const pushers = new Set<() => void>();
  const subscribe = (push: () => void) => { pushers.add(push); push(); return Promise.resolve(() => { pushers.delete(push); }); };
  return {
    host: {
      onProjects: (cb: (v: unknown) => void) => subscribe(() => cb(ready ? { state: 'ready', projects: config.projects } : { state: 'loading', projects: [] })),
      onWorktrees: (_id: string, cb: (v: unknown) => void) => subscribe(() => cb({ state: ready ? 'ready' : 'loading', worktrees: ready ? config.worktrees ?? [] : [] })),
      onSessions: (id: string, cb: (v: unknown) => void) => subscribe(() => cb({ state: ready ? 'ready' : 'loading', sessions: ready ? config.sessions.filter(s => s.projectId === id) : [], coverage: [] })),
    },
    pause() { ready = false; },
    settle() { ready = true; for (const push of [...pushers]) push(); },
    dropWorktrees() { config.worktrees = []; for (const push of [...pushers]) push(); },
    drop(id: string) { config.sessions = config.sessions.filter(s => s.id !== id); for (const push of [...pushers]) push(); },
  };
}
const liveSession = (id: string, projectId = 'proj', directory = '/fixture/proj'): LiveSession => ({ id, title: id, projectId, directory, parentId: null, archivedAt: null, worktree: null, activity: 'idle', outcome: null });
type Opts = { plans?: PlanSummary[]; live?: { projects: LiveProject[]; sessions: LiveSession[]; worktrees?: { directory: string; name: string; branch: string; status: 'ready' }[] } };
function frame(surface: 'page' | 'panel', scan = false, active = false, activeCapability = true, extra: Partial<ViewSpec<any>> = {}, opts: Opts = {}) {
  const listeners: Record<string, (v?: any) => void> = {};
  const focusables = new Map<string, { focused: number; tagName: string; focus(): void; querySelector(): null }>();
  let focused: unknown = null;
  class Node {
    dataset: Record<string, string> = {}; children: Node[] = [];
    get firstElementChild() { return this.children[0] ?? null; }
    contains(n: unknown): boolean { return n === this || this.children.some(c => c.contains(n)); }
    querySelectorAll() { return []; } querySelector(selector?: string) { return (selector && focusables.get(selector)) || null; } closest() { return null; }
    focus() {} getAnimations() { return []; } setAttribute() {}
    append(...nodes: Node[]) { this.children.push(...nodes); }
    replaceChildren(node: Node) { this.children = [node]; }
  }
  const mount = new Node();
  const document = { documentElement: new Node(), head: new Node(), body: new Node(), visibilityState: 'visible', get activeElement() { return focused; }, scrollingElement: { scrollTop: 0 }, getElementById: (id: string) => id === 'root' ? mount : {}, addEventListener() {} };
  const plans = opts.plans ?? [summary('one', [], { lifecycle: active ? 'active' : 'finished' }), summary('two', [], { lifecycle: 'cancelled' })];
  const feed = opts.live ? liveFeed(opts.live) : null;
  let capability = true;
  let setupLost = false;
  const posts: string[] = [];
  const bodies: any[] = [];
  let release: (() => void) | undefined;
  let hold = false;
  let refused: string | null = null;
  const markers = new Map<string, unknown>();
  let effectiveScope = 'initial';
  let vc!: ViewContext<{ filter: string }>;
  const host = {
    async serviceRequest(q: { path: string; body?: string }) {
      if (q.path === '/health') return { status: 200, body: JSON.stringify({ ...HEALTH, ...(setupLost ? { ready: false } : {}), ...(capability && !setupLost ? { planCleanup: 1 } : {}), ...(activeCapability ? { planCleanupActive: 1 } : {}) }) };
      if (q.path === '/v1/plans') return { status: 200, body: JSON.stringify(plansPage(plans)) };
       if (['/v1/plan/archive', '/v1/plan/restore', '/v1/plan/delete'].includes(q.path)) {
        posts.push(q.path);
        const request = JSON.parse(q.body!);
        bodies.push(request);
        if (request.plan === refused) return { status: 409, body: '{"error":"conflict"}' };
        if (hold) { hold = false; await new Promise<void>(r => { release = r; }); }
         return { status: 200, body: JSON.stringify({ ...request, cleanup: { state: q.path.endsWith('archive') ? 'archived' : q.path.endsWith('delete') ? 'deleted' : 'visible', revision: request.cleanupRev + 1 } }) };
      }
      return { status: 404, body: '{"error":"not-found"}' };
    },
    storage: { get: async (key: string) => markers.get(key), set: async (key: string, value: unknown) => { markers.set(key, value); },
      keys: async () => [...markers.keys()], delete: async (key: string) => { markers.delete(key); } },
    onReady(fn: any) { listeners.ready = fn; }, onSession(fn: any) { listeners.session = fn; },
    onDirectory(fn: any) { listeners.directory = fn; }, onItem() {}, onConnection() {}, ...feed?.host,
  };
  const exports: any = {};
  runInNewContext(APP, {
    exports, document, AbortController, crypto: globalThis.crypto, queueMicrotask, performance, console,
    setTimeout: () => 1, clearTimeout() {},
    window: { addEventListener: (key: string, fn: any) => { listeners[key] = fn; } },
    require: (name: string) => ({
      ...appCountsModules,
      '@openchamber/sdk': { connectHost: () => host }, '@openchamber/sdk/ui': { applyHostReady() {} },
       './source.ts': source, './cleanup.ts': cleanup, './refresh.ts': refresh, './language.ts': language, './session-context.ts': sessionContext, './path.ts': path,
       './change-digest-checkpoint.ts': checkpoints,
      './phone-layout.ts': { applyDeviceHooks() {} }, './setup.ts': { retireSetupSteps() {} },
      './components.ts': { el: () => new Node(), refreshLabels() {}, retireReadingUi() {}, beginInfoPaint() {}, commitInfoPaint() {} },
      './live.ts': feed ? liveModule : { LiveWorkspace: class { snapshot = EMPTY_LIVE; sessionSubscriptionCount = 0; start() {} restart() {} want() {} dispose() {} } },
      './official.ts': { OfficialMainState: class { check = async () => ({ next: null, apply: () => false }); } },
    } as Record<string, unknown>)[name] ?? {},
  });
  const spec: ViewSpec<{ filter: string }> = {
    surface, maxSessionSubscriptions: feed ? 4 : 0, initialUi: () => ({ filter: 'all' }),
    scope: c => surface === 'page' ? {} : { session: c.session?.id },
     tidyScope: c => c.ui.filter, tidyPlans: c => c.read?.plans ?? [],
    selectionScope: () => effectiveScope,
     tidyScan: scan ? (c, key) => new cleanup.CleanupScan(key, c.read!.storeId, false, async cursor => {
       const offset = Number(cursor ?? 0);
       return { plans: offset === 0 ? c.read!.plans.slice(0, 1) : offset === 2000 ? c.read!.plans.slice(1) : [],
         visited: 50, nextCursor: offset === 2000 ? null : String(offset + 50) };
     }) : undefined,
    wantProjects: () => [], wantDetails: () => [], paint: (_root, c) => { vc = c; }, ...extra,
  };
  exports.startView(spec);
  listeners.ready({ session: { id: S.M }, directory: '/fixture', connection: { connected: true, account: 'example' }, features: { deviceStorage: true }, locale: 'en', surface, settings: {}, item: null, theme: {} });
  return {
    get vc() { return vc; }, posts, markers, bodies, live: feed,
    capability(on: boolean) { capability = on; },
    setup(lost: boolean) { setupLost = lost; },
    refuse(plan: string) { refused = plan; },
    addPlan(plan: (typeof plans)[number]) { plans.push(plan); },
    /** The control painted with this test id; counts the times the controller moved focus to it. */
    focusable(id: string) {
      const node = { focused: 0, tagName: 'BUTTON', focus() { node.focused++; }, querySelector: () => null };
      focusables.set(`[data-testid="${id}"]`, node); return node;
    },
    focusAt(element: unknown) { focused = element; },
    normalizeScope(value: string) { effectiveScope = value; },
    hold() { hold = true; }, release() { assert.ok(release); release(); },
    session(id: string) { listeners.session({ id }); },
    account() { listeners.ready({ ...vc.ctx, connection: { connected: true, account: 'other-account' } }); },
    stop() { listeners.pagehide(); },
  };
}

for (const switchAccount of [false, true]) test(`Tidy delete retires only confirmed checkpoints in the captured account (switch: ${switchAccount})`, async () => {
  const f = frame('page');
  try {
    await until(() => !!f.vc?.read);
    const identity = (plan: string, account = 'example'): checkpoints.CheckpointIdentity => ({
      integrationAccount: account, storeId: f.vc.read!.storeId, binding: { ...f.vc.read!.binding },
      source: f.vc.read!.plans[0].sourceId, plan,
    });
    const keys = [identity('one'), identity('two'), identity('one', 'other-account'), identity('unrelated')].map(id => {
      const key = checkpoints.checkpointKey(id, 1);
      f.markers.set(key, checkpoints.checkpointValue(id, 1)); return key;
    });
    f.vc.requestTidy(); await drain(); f.vc.deleteTidy(); await drain();
    if (switchAccount) f.hold(); else f.refuse('two');
    f.vc.confirmTidyDelete();
    if (switchAccount) {
      await until(() => f.posts.length === 1);
      f.account(); await drain(); f.release();
    }
    await until(() => !f.vc.cleanup.pending);
    await drain();
    assert.equal(f.markers.has(keys[0]), false, 'validated deletion retires the original account marker');
    assert.ok(keys.slice(1).every(key => f.markers.has(key)), 'refused/unsent plans and other contexts keep their markers');
  } finally { f.stop(); }
});

test('selection controller shares confirmation binding, active acknowledgements and receipt-bound Undo', async () => {
  const f = frame('page', false, true);
  try {
    await until(() => !!f.vc?.read);
    f.vc.requestSelection('archive', { all: false, plans: f.vc.read!.plans, includes: () => true });
    await until(() => !!f.vc.cleanup.tidy?.confirmation);
    assert.equal(f.vc.cleanup.tidy?.confirmation?.activeCount, 1);
    f.vc.confirmTidy();
    await until(() => !!f.vc.cleanup.tidy?.result);
    assert.deepEqual(f.bodies.map(b => b.active), [true, undefined]);
    f.vc.undoTidy();
    await until(() => f.vc.cleanup.tidy?.result?.action === 'restore');
    assert.equal(f.bodies.length, 4);
    assert(f.bodies.slice(2).every(b => !('active' in b)));
  } finally { f.stop(); }
});

test('a pre-paint selection action cannot broaden when the effective scope normalizes', async () => {
  const f = frame('page');
  try {
    await until(() => !!f.vc?.read);
    const opener = f.vc;
    const request = { all: true, plans: opener.read!.plans, includes: () => true, scope: 'initial' };
    f.normalizeScope('all');
    opener.requestSelection('delete', request);
    await drain();
    const retired = f.vc.cleanup.tidy;
    assert.equal(retired, undefined, 'a retired rule must not open a broader confirmation');
    assert.equal(f.posts.length, 0);
    f.vc.requestSelection('delete', { ...request, scope: 'all' });
    await until(() => !!f.vc.cleanup.tidy?.confirmation);
    assert.equal(f.vc.cleanup.tidy?.confirmation?.targets.length, 2, 'a fresh gesture can select the new scope');
  } finally { f.stop(); }
});

for (const switchAccount of [false, true]) test(`selection delete retires only receipt-confirmed checkpoints (account switch: ${switchAccount})`, async () => {
  const f = frame('page', false, true);
  try {
    await until(() => !!f.vc?.read);
    const identity = (plan: string, account = 'example'): checkpoints.CheckpointIdentity => ({
      integrationAccount: account, storeId: f.vc.read!.storeId, binding: { ...f.vc.read!.binding },
      source: f.vc.read!.plans[0].sourceId, plan,
    });
    const keys = [identity('one'), identity('two'), identity('one', 'other-account'), identity('unrelated')].map(id => {
      const key = checkpoints.checkpointKey(id, 1);
      f.markers.set(key, checkpoints.checkpointValue(id, 1)); return key;
    });
    f.vc.requestSelection('delete', { all: true, plans: f.vc.read!.plans, includes: () => true });
    await until(() => !!f.vc.cleanup.tidy?.confirmation);
    if (switchAccount) f.hold(); else f.refuse('two');
    f.vc.confirmTidyDelete();
    if (switchAccount) {
      await until(() => f.posts.length === 1);
      f.account(); await drain(); f.release();
    }
    await until(() => !f.vc.cleanup.pending);
    await drain();
    assert.equal(f.bodies[0].active, true);
    assert.equal(f.markers.has(keys[0]), false);
    assert.ok(keys.slice(1).every(key => f.markers.has(key)), 'refused, unsent and other-account checkpoints survive');
  } finally { f.stop(); }
});

test('selection without active capability leaves active targets out before requests', async () => {
  const f = frame('page', false, true, false);
  try {
    await until(() => !!f.vc?.read);
    f.vc.requestSelection('delete', { all: false, plans: f.vc.read!.plans, includes: () => true });
    await until(() => !!f.vc.cleanup.tidy?.confirmation);
    assert.equal(f.vc.cleanup.tidy?.confirmation?.excludedActive, 1);
    const stale = f.vc;
    f.vc.cancelTidy(); await drain();
    stale.confirmTidyDelete(); await drain();
    assert.equal(f.bodies.length, 0);
    f.vc.requestSelection('delete', { all: false, plans: f.vc.read!.plans, includes: () => true });
    await until(() => !!f.vc.cleanup.tidy?.confirmation);
    f.vc.confirmTidyDelete();
    await until(() => !!f.vc.cleanup.tidy?.result);
    assert.equal(f.bodies.length, 1);
    assert.equal(f.bodies[0].plan, 'two');
    assert(!('active' in f.bodies[0]));
  } finally { f.stop(); }
});
test('board keeps a pending batch and receipt-bound Undo across a host-session-only switch', async () => {
  const f = frame('page');
  try {
    await until(() => !!f.vc?.read);
    f.vc.requestTidy(); await drain(); f.hold(); f.vc.confirmTidy();
    await until(() => f.posts.length === 1);
    f.session(S.U); await drain(); f.release();
    await until(() => !f.vc.cleanup.pending);
    assert.equal(f.posts.length, 2);
    assert.equal(f.vc.cleanup.tidy?.result?.succeeded.length, 2);
    const result = f.vc.cleanup.tidy?.result;
    f.session(S.M); await drain();
    assert.equal(f.vc.cleanup.tidy?.result, result, 'completed Undo survives another host-session switch');
    f.vc.undoTidy(); await until(() => f.vc.cleanup.tidy?.result?.action === 'restore');
    assert.equal(f.posts.filter(p => p.endsWith('/restore')).length, 2);
  } finally { f.stop(); }
});

test('a retired confirmation cannot approve targets added by Check more', async () => {
  const f = frame('page', true);
  try {
    await until(() => !!f.vc?.read);
    f.vc.requestTidy();
    await until(() => f.vc.cleanup.tidy?.confirmation?.targets.length === 1);
    const previous = f.vc;
    f.vc.moreTidy();
    await until(() => f.vc.cleanup.tidy?.confirmation?.targets.length === 2);
    previous.confirmTidy(); await drain();
    assert.equal(f.posts.length, 0, 'the one-plan confirmation cannot authorize the new two-plan count');
    f.vc.confirmTidy();
    await until(() => f.vc.cleanup.tidy?.result?.succeeded.length === 2);
  } finally { f.stop(); }
});
test('board scope away and back permanently retires a pending batch before its receipt arrives', async () => {
  const f = frame('page');
  try {
    await until(() => !!f.vc?.read);
    f.vc.requestTidy(); await drain(); f.hold(); f.vc.confirmTidy();
    await until(() => f.posts.length === 1);
    f.vc.setUi({ filter: 'other-project' });
    f.vc.setUi({ filter: 'all' });
    f.release(); await until(() => !f.vc.cleanup.pending);
    assert.equal(f.posts.length, 1);
    assert.equal(f.vc.cleanup.tidy, undefined);
  } finally { f.stop(); }
});
test('rail session away and back still retires its session-scoped pending batch', async () => {
  const f = frame('panel');
  try {
    await until(() => !!f.vc?.read);
    f.vc.requestTidy(); await drain(); f.hold(); f.vc.confirmTidy();
    await until(() => f.posts.length === 1);
    f.session(S.U); f.session(S.M); f.release();
    await until(() => !f.vc.cleanup.pending);
    assert.equal(f.posts.length, 1);
    assert.equal(f.vc.cleanup.tidy, undefined);
  } finally { f.stop(); }
});
test('board account changes still retire the pending batch and its receipts', async () => {
  const f = frame('page');
  try {
    await until(() => !!f.vc?.read);
    f.vc.requestTidy(); await drain(); f.hold(); f.vc.confirmTidy();
    await until(() => f.posts.length === 1);
    f.account(); f.release(); await until(() => !f.vc.cleanup.pending);
    assert.equal(f.posts.length, 1);
    assert.equal(f.vc.cleanup.tidy, undefined);
  } finally { f.stop(); }
});

test('Delete requires its own step; archive cannot confirm it, and Stop ends after the held delete receipt', async () => {
  const f = frame('page');
  try {
    await until(() => !!f.vc?.read);
    f.vc.requestTidy(); await drain();
    f.vc.confirmTidyDelete(); await drain();
    assert.equal(f.posts.length, 0, 'delete cannot bypass its second step');
    f.vc.deleteTidy(); await drain();
    assert.equal(f.vc.cleanup.tidy?.confirmation?.deleting, true);
    assert.equal(f.posts.length, 0);
    f.vc.confirmTidy(); await drain();
    assert.equal(f.posts.length, 0, 'old Archive callback cannot confirm deletion');
    f.hold(); f.vc.confirmTidyDelete();
    await until(() => f.posts.length === 1);
    f.vc.stopTidy(); f.release();
    await until(() => !f.vc.cleanup.pending);
    assert.equal(f.posts.length, 1);
    assert.equal(f.vc.cleanup.tidy?.result?.action, 'delete');
    assert.equal(f.vc.cleanup.tidy?.result?.succeeded.length, 1);
    f.vc.undoTidy(); await drain();
    assert.equal(f.posts.length, 1, 'delete has no Undo path');
  } finally { f.stop(); }
});

// The board page's own scope hooks, with the effective filters the board displays under test control.
function effectiveScope() {
  const state = { filters: { project: 'all', worktree: 'all', session: 'all' }, selectionEpoch: 0 };
  const globals: Record<string, unknown> = { derivedBoard: () => ({ filters: state.filters }), isSearching: () => false, selectionEpoch: 0, tidyEffective: '', tidyFilters: null };
  return { state, extra: { tidyScope: pageHook('tidyScope', globals) } as Partial<ViewSpec<{ filter: string }>> };
}
for (const [name, open] of [
  ['Tidy', (f: ReturnType<typeof frame>) => f.vc.requestTidy()],
  ['Select all', (f: ReturnType<typeof frame>) => f.vc.requestSelection('delete', { all: true, plans: f.vc.read!.plans, includes: () => true })],
] as const) test(`${name} confirmation is retired when a refresh changes the effective board scope before it is confirmed`, async () => {
  const scope = effectiveScope();
  const f = frame('page', false, true, true, scope.extra);
  try {
    await until(() => !!f.vc?.read);
    open(f); await until(() => !!f.vc.cleanup.tidy?.confirmation);
    const stale = f.vc;
    scope.state.filters = { project: 'p:other', worktree: 'all', session: 'all' };
    stale.deleteTidy();
    // Inspected before any repaint can retire the state on its own account.
    if (name === 'Tidy') assert.notEqual(stale.cleanup.tidy?.confirmation?.deleting, true, 'Delete cannot proceed to its second step');
    stale.confirmTidy(); stale.confirmTidyDelete(); await drain();
    assert.equal(f.posts.length, 0, 'no request is sent for the earlier, broader count');
    f.vc.invalidate(); await drain();
    assert.equal(f.vc.cleanup.tidy, undefined, 'the confirmation is gone after the next paint');
  } finally { f.stop(); }
});
for (const [name, open] of [
  ['Tidy', (f: ReturnType<typeof frame>) => { f.vc.requestTidy(); }],
  ['Select all', (f: ReturnType<typeof frame>) => { f.vc.requestSelection('delete', { all: true, plans: f.vc.read!.plans, includes: () => true }); }],
] as const) test(`the final ${name} Delete click is refused when the scope changes with its second step open`, async () => {
  const scope = effectiveScope();
  const f = frame('page', false, true, true, scope.extra);
  try {
    await until(() => !!f.vc?.read);
    open(f); await until(() => !!f.vc.cleanup.tidy?.confirmation);
    if (name === 'Tidy') { f.vc.deleteTidy(); await drain(); }
    assert.equal(f.vc.cleanup.tidy?.confirmation?.deleting, true);
    const stale = f.vc;
    scope.state.filters = { project: 'p:other', worktree: 'all', session: 'all' };
    stale.confirmTidyDelete(); await drain();
    assert.equal(f.posts.length, 0);
  } finally { f.stop(); }
});
test('a run keeps its own result when its reconciliation reshapes the effective scope', async () => {
  // The board narrows to a project while the first read is shown; once the run reloads, that project is gone.
  const state: { first?: unknown } = {};
  const globals: Record<string, unknown> = {
    derivedBoard: (c: { read: unknown }) => { state.first ??= c.read; return { filters: { project: c.read === state.first ? 'p:one' : 'all', worktree: 'all', session: 'all' } }; },
    isSearching: () => false, selectionEpoch: 0, tidyEffective: '', tidyFilters: null,
  };
  const f = frame('page', false, false, true, { tidyScope: pageHook('tidyScope', globals) });
  try {
    await until(() => !!f.vc?.read);
    f.vc.requestTidy(); await until(() => !!f.vc.cleanup.tidy?.confirmation);
    f.vc.confirmTidy();
    await until(() => !!f.vc.cleanup.tidy?.result);
    await until(() => !!f.vc.read && f.vc.read !== state.first);
    await drain();
    assert.equal(f.vc.cleanup.tidy?.result?.succeeded.length, 2, 'the finished run keeps its result and Undo');
    f.vc.undoTidy(); await until(() => f.vc.cleanup.tidy?.result?.action === 'restore');
    assert.equal(f.posts.filter(p => p.endsWith('/restore')).length, 2);
  } finally { f.stop(); }
});

test('only receipt-confirmed plans leave a selection held across a truncated library', async () => {
  const selection = new cleanup.PlanSelection();
  const globals = { selection, captures: { retire() {} }, reporting: { retire() {} }, search: { select() {} } };
  const f = frame('page', false, false, true, { forgetPlans: pageHook('forgetPlans', globals) });
  try {
    await until(() => !!f.vc?.read);
    const plans = f.vc.read!.plans;
    selection.reconcile('scope', plans, true); selection.mode = true;
    for (const p of plans) selection.toggle(p);
    assert.equal(selection.count, 2);
    f.refuse('two');
    f.vc.requestSelection('archive', { ...selection.snapshot() });
    await until(() => !!f.vc.cleanup.tidy?.confirmation);
    f.vc.confirmTidy();
    await until(() => !!f.vc.cleanup.tidy?.result);
    assert.equal(selection.has(plans[0].key), false, 'the archived plan is no longer selected');
    assert.equal(selection.has(plans[1].key), true, 'a refused plan stays selected');
    assert.equal(selection.count, 1);
  } finally { f.stop(); }
});

// Real LiveWorkspace + the page's own scope hooks: placement can change without any plan revision changing.
const WT = '/fixture/wt';
const placed = (extra: Record<string, unknown> = {}) => {
  const board = new BoardDerivation();
  const globals: Record<string, unknown> = {
    derivedBoard: (c: any) => board.get({ plans: c.read?.plans ?? [], live: c.env.live, filters: c.ui.filters, bound: c.env.boundSource, locale: 'en', archived: c.ui.archived, reading: 'fixture' }),
    isSearching: () => false, inPlace, scopeAvailability, NO_FILTERS, selectionEpoch: 0, tidyEffective: '', tidyFilters: null, ...extra,
  };
  return { globals, extra: { tidyScope: pageHook('tidyScope', globals), tidyMember: pageHook('tidyMember', globals),
    initialUi: () => ({ filter: 'all', filters: { ...NO_FILTERS }, archived: false, search: null }), wantProjects: () => ['proj'] } as Partial<ViewSpec<any>> };
};
const liveReady = (f: ReturnType<typeof frame>) => until(() => !!f.vc?.read && f.vc.live.projectsState === 'ready' && f.vc.live.sessions.get('proj')?.state === 'ready');

test('a destructive request only reaches plans still in the displayed scope when it is sent', async () => {
  const config = { projects: [{ id: 'proj', name: 'Proj', directory: '/fixture/proj' }], sessions: [liveSession(S.M), liveSession(S.U)] };
  const p = placed();
  const f = frame('page', false, false, true, p.extra, { live: config, plans: [
    summary('one', [], { lifecycle: 'finished', directory: WT, sessionId: S.M }), summary('two', [], { lifecycle: 'cancelled', directory: WT, sessionId: S.U })] });
  try {
    await liveReady(f);
    const worktree = (p.globals.derivedBoard as any)(f.vc).places.get(f.vc.read!.plans[1].key).worktreeKey;
    (f.vc as any).setUi({ filters: { ...NO_FILTERS, worktree } });
    f.vc.requestTidy(); await until(() => !!f.vc.cleanup.tidy?.confirmation);
    assert.equal(f.vc.cleanup.tidy?.confirmation?.targets.length, 2);
    // The first plan's live owner leaves; the second still keeps the same worktree filter on the board.
    f.live!.drop(S.M); await drain();
    assert.equal((p.globals.derivedBoard as any)(f.vc).filters.worktree, worktree, 'the board still shows this worktree');
    f.vc.deleteTidy(); await drain();
    f.vc.confirmTidyDelete();
    await until(() => !!f.vc.cleanup.tidy?.result);
    assert.deepEqual(f.bodies.map(b => b.plan), ['two'], 'the plan that left the displayed scope is not sent');
    assert.equal(f.vc.cleanup.tidy?.result?.succeeded.length, 1);
    assert.equal(f.vc.cleanup.tidy?.result?.remaining.length, 1, 'it is counted as skipped');
  } finally { f.stop(); }
});

test('a host-session restart of live discovery keeps an in-flight archive run, its receipt and Undo', async () => {
  const config = { projects: [{ id: 'proj', name: 'Proj', directory: '/fixture/proj' }], sessions: [liveSession(S.M)] };
  const p = placed();
  const f = frame('page', false, false, true, p.extra, { live: config, plans: [
    summary('one', [], { lifecycle: 'finished', directory: '/fixture/proj' }), summary('two', [], { lifecycle: 'cancelled', directory: '/fixture/proj' })] });
  try {
    await liveReady(f);
    (f.vc as any).setUi({ filters: { ...NO_FILTERS, project: 'p:proj' } });
    f.vc.requestTidy(); await until(() => !!f.vc.cleanup.tidy?.confirmation);
    f.hold(); f.vc.confirmTidy();
    await until(() => f.posts.length === 1);
    f.live!.pause(); f.session(S.U); await drain();
    assert.equal((p.globals.derivedBoard as any)(f.vc).filters.project, 'all', 'discovery restart makes the saved project look gone');
    f.release();
    await until(() => !f.vc.cleanup.pending);
    await drain();
    const result = f.vc.cleanup.tidy?.result;
    assert.equal(result?.succeeded.length, 1, 'the receipt of the request already sent is kept');
    assert.equal(f.posts.length, 1, 'no further request goes to a plan that cannot be placed while discovery reloads');
    assert.equal(result?.remaining.length, 1);
    f.live!.settle();
    f.vc.undoTidy(); await until(() => f.vc.cleanup.tidy?.result?.action === 'restore');
    assert.equal(f.posts.filter(x => x.endsWith('/restore')).length, 1);
  } finally { f.stop(); }
});

test('Try again after a partial selection result still opens when the scope has since normalized', async () => {
  const f = frame('page', false, false, true);
  try {
    await until(() => !!f.vc?.read);
    const plans = f.vc.read!.plans;
    f.refuse('two');
    f.vc.requestSelection('archive', { all: false, plans, includes: () => true, scope: 'initial' });
    await until(() => !!f.vc.cleanup.tidy?.confirmation);
    f.vc.confirmTidy();
    await until(() => !!f.vc.cleanup.tidy?.result);
    assert.equal(f.vc.cleanup.tidy?.result?.remaining.length, 1);
    f.normalizeScope('all');
    f.vc.retryTidy(); await drain();
    assert.deepEqual(f.vc.cleanup.tidy?.confirmation?.targets.map(t => t.request.plan), ['two'], 'only the captured remaining plan, under the fresh scope');
  } finally { f.stop(); }
});

test('losing cleanup support retires a pending confirmation, which does not return with support', async () => {
  const f = frame('page', false, true);
  try {
    await until(() => !!f.vc?.read);
    f.vc.requestSelection('delete', { all: false, plans: f.vc.read!.plans, includes: () => true });
    await until(() => !!f.vc.cleanup.tidy?.confirmation);
    const stale = f.vc;
    f.capability(false); f.vc.retry();
    await until(() => f.vc.health?.planCleanup !== 1);
    await drain();
    assert.equal(f.vc.cleanup.tidy, undefined);
    f.capability(true); f.vc.retry();
    await until(() => f.vc.health?.planCleanup === 1);
    stale.confirmTidyDelete(); f.vc.confirmTidyDelete(); await drain();
    assert.equal(f.posts.length, 0);
    assert.equal(f.vc.cleanup.tidy, undefined);
  } finally { f.stop(); }
});

test('a search with displayed hits revalidates through its own read and observes capability loss at the next list read', async () => {
  let searching = true, freshReads = 0;
  const f = frame('page', false, true, true, { freshness: () => searching ? async () => { freshReads++; return { state: 'fresh', captureEnabled: true, inbox: undefined } as any; } : null });
  try {
    await until(() => !!f.vc?.read);
    f.capability(false); f.vc.retry(); await until(() => freshReads > 0); await drain();
    assert.equal(f.vc.health?.planCleanup, 1, 'the search freshness read carries no service capabilities');
    searching = false; f.vc.retry();
    await until(() => f.vc.health?.planCleanup !== 1);
  } finally { f.stop(); }
});

test('a search Delete is refused when its chosen worktree left discovery, though its live owner still places the plan there', async () => {
  const ext = '/fixture/ext';
  const config = { projects: [{ id: 'proj', name: 'Proj', directory: '/fixture/proj' }], sessions: [liveSession(S.M)],
    worktrees: [{ directory: ext, name: 'ext', branch: 'ext', status: 'ready' as const }] };
  const p = placed({ isSearching: () => true });
  const f = frame('page', false, false, true, p.extra, { live: config, plans: [summary('one', [], { lifecycle: 'finished', directory: ext, sessionId: S.M })] });
  try {
    await until(() => !!f.vc?.read && f.vc.live.projectsState === 'ready' && f.vc.live.sessions.get('proj')?.state === 'ready' && f.vc.live.worktrees.get('proj')?.state === 'ready');
    const criteria = { project: 'p:proj', worktree: 'w:' + path.directoryKey(ext), session: 'all' };
    (f.vc as any).setUi({ search: { key: 'search', criteria } });
    assert.equal(scopeAvailability(criteria, f.vc.live), 'ok');
    f.vc.requestTidy(); await until(() => !!f.vc.cleanup.tidy?.confirmation);
    f.vc.deleteTidy(); await drain();
    f.live!.dropWorktrees();
    await until(() => f.vc.live.sessions.get('proj')?.state === 'ready' && f.vc.live.worktrees.get('proj')?.records.length === 0);
    assert.notEqual(scopeAvailability(criteria, f.vc.live), 'ok', 'a fresh search count would be refused');
    assert.equal(inPlace(criteria, { ownerSessionId: S.M, directory: ext, sourceId: 'src-local' }, f.vc.live, 'src-local'), true, 'while placement alone still passes');
    f.vc.confirmTidyDelete(); await until(() => !!f.vc.cleanup.tidy?.result);
    assert.equal(f.posts.length, 0);
    assert.equal(f.vc.cleanup.tidy?.result?.remaining.length, 1);
  } finally { f.stop(); }
});

test('Try again on a complete browse list offers only remaining plans the board still shows', async () => {
  const visible = new Set<string>();
  const f = frame('page', false, false, true, { tidyPlans: (c: any) => (c.read?.plans ?? []).filter((x: any) => visible.has(x.key)) });
  try {
    await until(() => !!f.vc?.read);
    const plans = f.vc.read!.plans;
    for (const x of plans) visible.add(x.key);
    f.refuse('two');
    f.vc.requestSelection('archive', { all: false, plans, includes: () => true, scope: 'initial' });
    await until(() => !!f.vc.cleanup.tidy?.confirmation);
    f.vc.confirmTidy(); await until(() => !!f.vc.cleanup.tidy?.result);
    visible.delete(plans[1].key);
    f.vc.retryTidy(); await drain();
    assert.equal(f.vc.cleanup.tidy?.confirmation?.targets.length, 0, 'a plan that moved out of scope is not offered');
  } finally { f.stop(); }
});

test('a finished result and its Undo survive the reconciliation read losing cleanup support, but cannot act', async () => {
  const f = frame('page');
  try {
    await until(() => !!f.vc?.read);
    f.vc.requestTidy(); await until(() => !!f.vc.cleanup.tidy?.confirmation);
    f.hold(); f.vc.confirmTidy(); await until(() => f.posts.length === 1);
    f.capability(false); f.release();
    await until(() => !f.vc.cleanup.pending);
    await until(() => f.vc.health?.planCleanup !== 1);
    await drain();
    assert.equal(f.vc.cleanup.tidy?.result?.succeeded.length, 2, 'the completed counts and receipts remain');
    f.vc.undoTidy(); await drain();
    assert.equal(f.posts.filter(x => x.endsWith('/restore')).length, 0, 'Undo does nothing without support');
  } finally { f.stop(); }
});

test('an unconfigured-service read retires an open Tidy Delete confirmation, which does not return on recovery', async () => {
  const f = frame('page');
  try {
    await until(() => !!f.vc?.read);
    f.vc.requestTidy(); await until(() => !!f.vc.cleanup.tidy?.confirmation);
    f.vc.deleteTidy(); await drain();
    assert.equal(f.vc.cleanup.tidy?.confirmation?.deleting, true);
    const stale = f.vc;
    f.setup(true); f.vc.retry();
    await until(() => f.vc.health?.ready === false);
    await drain();
    f.setup(false); f.vc.retry();
    await until(() => f.vc.health?.planCleanup === 1 && !f.vc.failure);
    stale.confirmTidyDelete(); f.vc.confirmTidyDelete(); await drain();
    assert.equal(f.posts.length, 0);
    assert.equal(f.vc.cleanup.tidy, undefined);
  } finally { f.stop(); }
});

type TidyScan = NonNullable<ViewSpec<{ filter: string }>['tidyScan']>;

// A retry recounts what the run left, never the whole scope again (and never newly matching plans).
test('Tidy Try again recounts only the remaining plans when the whole scope is loaded', async () => {
  const f = frame('page');
  try {
    await until(() => !!f.vc?.read);
    f.refuse('two');
    f.vc.requestTidy(); await until(() => !!f.vc.cleanup.tidy?.confirmation);
    // Another plan matches while the run is under way; the run's reconciliation read sees it.
    f.addPlan(summary('three', [], { lifecycle: 'failed' }));
    f.vc.confirmTidy();
    await until(() => !!f.vc.cleanup.tidy?.result);
    await until(() => f.vc.read?.plans.length === 3);
    assert.deepEqual(f.vc.cleanup.tidy?.result?.remaining.map(t => t.request.plan), ['two']);
    f.vc.retryTidy();
    await until(() => !!f.vc.cleanup.tidy?.confirmation);
    assert.deepEqual(f.vc.cleanup.tidy?.confirmation?.targets.map(t => t.request.plan), ['two']);
  } finally { f.stop(); }
});
test('Tidy Try again hands the scan only the remaining identities and never lets active plans in', async () => {
  const calls: { allowActive?: boolean; known?: cleanup.CleanupPlan[] }[] = [];
  const tidyScan: TidyScan = (c, key, includes, allowActive, known) => {
    calls.push({ allowActive, known });
    return new cleanup.CleanupScan(key, c.read!.storeId, false, async () => ({ plans: c.read!.plans, visited: 2, nextCursor: null }), false, 50, includes, allowActive);
  };
  const f = frame('page', false, false, true, { tidyScan });
  try {
    await until(() => !!f.vc?.read);
    f.refuse('two');
    f.vc.requestTidy(); await until(() => !!f.vc.cleanup.tidy?.confirmation);
    assert.equal(calls[0].known, undefined, 'the first count walks the scope');
    f.vc.confirmTidy();
    await until(() => !!f.vc.cleanup.tidy?.result);
    f.vc.retryTidy();
    await until(() => !!f.vc.cleanup.tidy?.confirmation);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[1].known?.map(p => p.id), ['two']);
    assert.equal(calls[1].allowActive, false);
    assert.ok(calls[1].known?.[0].ownerSessionId && calls[1].known[0].directory !== undefined, 'placement facts travel with the identity');
    assert.deepEqual(f.vc.cleanup.tidy?.confirmation?.targets.map(t => t.request.plan), ['two']);
  } finally { f.stop(); }
});
test('an explicit selection names its plans to the scan; Select all does not', async () => {
  const known: (cleanup.CleanupPlan[] | undefined)[] = [];
  const tidyScan: TidyScan = (c, key, includes, allowActive, plans) => {
    known.push(plans);
    return new cleanup.CleanupScan(key, c.read!.storeId, false, async () => ({ plans: c.read!.plans, visited: 2, nextCursor: null }), false, 50, includes, allowActive);
  };
  const f = frame('page', false, false, true, { tidyScan });
  try {
    await until(() => !!f.vc?.read);
    const plans = f.vc.read!.plans;
    f.vc.requestSelection('archive', { all: false, plans: plans.slice(0, 1), includes: p => p.key === plans[0].key });
    await until(() => !!f.vc.cleanup.tidy?.confirmation);
    f.vc.cancelTidy(); await drain();
    f.vc.requestSelection('archive', { all: true, plans, includes: () => true });
    await until(() => !!f.vc.cleanup.tidy?.confirmation);
    assert.deepEqual(known.map(k => k?.map(p => p.id)), [['one'], undefined]);
  } finally { f.stop(); }
});

for (const [name, focus, restored] of [
  ['another control keeps focus', { closest: () => null }, false],
  ['a removed control hands focus back to Cancel', null, true],
] as const) test(`background counting finishing: ${name}`, async () => {
  let open!: () => void;
  const gate = new Promise<void>(r => { open = r; });
  const tidyScan: TidyScan = (c, key) =>
    new cleanup.CleanupScan(key, c.read!.storeId, false, async () => { await gate; return { plans: c.read!.plans, visited: 2, nextCursor: null }; });
  const f = frame('page', false, false, true, { tidyScan });
  try {
    await until(() => !!f.vc?.read);
    const cancel = f.focusable('tidy-cancel');
    f.vc.requestTidy(); await drain();
    const opened = cancel.focused;
    assert.ok(opened >= 1, 'Cancel takes focus when the panel opens');
    f.focusAt(focus);
    open();
    await until(() => !!f.vc.cleanup.tidy?.confirmation);
    await drain();
    assert.equal(cancel.focused > opened, restored);
  } finally { f.stop(); }
});
