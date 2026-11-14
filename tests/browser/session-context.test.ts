import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as source from '../../ui/shared/source.ts';
import * as checkpoint from '../../ui/shared/change-digest-checkpoint.ts';
import * as cleanup from '../../ui/shared/cleanup.ts';
import * as refresh from '../../ui/shared/refresh.ts';
import * as path from '../../ui/shared/path.ts';
import * as language from '../../ui/shared/language.ts';
import * as sessionContext from '../../ui/shared/session-context.ts';
import { EMPTY_LIVE, LiveWorkspace, hostWorkContext, projectFor, type LiveSnapshot } from '../../ui/shared/live.ts';
import { contextListScope, contextScope, pageListScope, NO_FILTERS, placeOf } from '../../ui/shared/scope.ts';
import { parsePlansPage } from '../../ui/shared/adapter.ts';
import type { ViewContext, ViewSpec } from '../../ui/shared/app.ts';
import type { GuestRequest, GuestRequestResult, HostReadyContext } from '@openchamber/sdk';
import { HEALTH, SRC, OTHER_SRC, plansPage, planPage, summary, setupRead, envelope, docRef } from './fixtures.ts';

const items = [{ id: 'task', title: 'Reported work', kind: 'task' as const, status: 'done' as const }];
const row = summary('P-A', items, { sessionId: 'A', lifecycle: 'finished', document: docRef() });
const plan = parsePlansPage(JSON.stringify(plansPage([row]))).data[0];
const response = (value: unknown, status = 200) => ({ status, body: JSON.stringify(value) });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
// Drain microtasks/IO turns, not a timing assumption about network completion.
async function settle() { for (let i = 0; i < 8; i++) await new Promise<void>(r => setImmediate(r)); }

test('optional device hints repaint through the existing owner without identity, visibility or read changes', async () => {
  const c = controller();
  try {
    c.ready('A'); await settle();
    assert.equal(c.vc.device, undefined); assert.equal(c.vc.env.device, undefined);
    const requests = c.requests.length, identity = c.vc.identity, paints = c.paints.length;
    const device: NonNullable<HostReadyContext['device']> = { formFactor: 'phone', pointer: 'coarse', insets: { top: 20, right: 0, bottom: 12, left: 0 }, keyboard: 280 };
    c.listeners.ready({ ...c.vc.ctx, device }); await settle();
    assert.deepEqual(c.vc.device, device); assert.deepEqual(c.vc.env.device, device);
    assert.ok(c.paints.length > paints);
    assert.equal(c.vc.identity, identity); assert.equal(c.requests.length, requests);
    const current = c.paints.length;
    c.listeners.ready({ ...c.vc.ctx, device: structuredClone(device) }); await settle();
    assert.equal(c.paints.length, current, 'unchanged ready device hints do not repaint');
    c.listeners.ready({ ...c.vc.ctx, device: undefined }); await settle();
    assert.equal(c.vc.env.device, undefined); assert.equal(c.requests.length, requests);
  } finally { c.stop(); }
});

type Ui = { sessionFilter: string; archived: boolean; selected: string | null };
/** Execute the actual shared controller. DOM/layout and SDK mount mechanics are
 * deliberately minimal here; current-bundle browser QA owns those boundaries. */
function controller(board = false, beforeUiChange?: (previous: Ui, next: Ui) => void, paintHook?: (vc: ViewContext<Ui>, root: any) => void) {
  const listeners: Record<string, (value?: any) => void> = {};
  const requests: GuestRequest[] = [];
  const storageCalls: string[] = [];
  const timers = new Map<number, { fn: () => void; ms: number }>();
  let timerId = 0;
  const languageStorage: Array<{ op: string; key: string; scope?: string }> = [];
  let languageValue: unknown;
  let languageWrite: Promise<void> | null = null;
  const infoPaints: { kind: string; root?: object }[] = [];
  let expanded = false, disclosure = false, livePopup = false;
  let ownsFocus = true, focusCalls = 0;
  const body = { isConnected: true };
  const node = () => ({ dataset: {} as Record<string, string>, firstElementChild: null as any,
    control: null as any,
    contains(active: unknown): boolean { return !!active && (active === this.control || this.firstElementChild?.contains(active)); },
    querySelector: (s: string) => s.includes('[aria-expanded="true"]') && (expanded || disclosure && !s.includes('[aria-haspopup]')) ? {} : null,
    querySelectorAll(s: string): any[] { return s === '[aria-haspopup][aria-expanded="true"]' && (expanded || livePopup)
      ? [{ closest: (selector: string) => selector === '[data-live-popup]' && livePopup ? {} : null }] : s === '[data-testid="fixture-control"]' ? [this.control ?? this.firstElementChild?.control].filter(Boolean) : []; },
    getAnimations: () => [], setAttribute() {}, append() {},
    replaceChildren(child: any) { if (this.firstElementChild?.control) { this.firstElementChild.control.isConnected = false; if (document.activeElement === this.firstElementChild.control) document.activeElement = body; } this.firstElementChild = child; expanded = disclosure = livePopup = false; },
  });
  // Only the root owns a control; mount queries delegate to the current painted root.
  const thisControl = (): any => mount.firstElementChild?.control;
  const mount = node();
  const document = { documentElement: node(), head: node(), visibilityState: 'visible', activeElement: null as any, body, hasFocus: () => ownsFocus,
    getElementById: (id: string) => id === 'root' ? mount : {}, addEventListener(name: string, fn: any) { listeners[`document:${name}`] = fn; }, scrollingElement: { scrollTop: 0 } };
  let handler = async (q: GuestRequest): Promise<GuestRequestResult> => {
    if (q.path === '/health') return response({ ...HEALTH, planCleanup: 1 });
    if (q.path === '/v1/setup') return response(setupRead());
    if (q.path === '/v1/plans') return response(plansPage(!q.query?.session || ['A', 'C'].includes(q.query.session) ? [row] : []));
    if (q.path === '/v1/plan') return response(planPage(row, items, []));
    if (q.path === '/v1/document') return response({ ...envelope(), document: docRef(), text: 'Recorded document', nextCursor: null });
    if (q.path === '/v1/history') return response({ ...envelope(), data: [], nextCursor: null });
    return response({ error: 'not-found' }, 404);
  };
  const host = { serviceRequest: (q: GuestRequest) => { requests.push(q); return handler(q); }, storage: {
    get: async (key: string, options?: { scope: string }) => { storageCalls.push(key); if (key !== 'interface-language.v1') return undefined; languageStorage.push({ op: 'get', key, scope: options?.scope }); return languageValue; },
    set: async (key: string, value: unknown, options?: { scope: string }) => { storageCalls.push(key); if (key === 'interface-language.v1') { languageStorage.push({ op: 'set', key, scope: options?.scope }); await languageWrite; languageValue = value; } },
    delete: async () => {},
  },
    onItem: (fn: any) => { listeners.item = fn; },
    onConnection: (fn: any) => { listeners.connection = fn; },
    onReady: (fn: any) => { listeners.ready = fn; }, onSession: (fn: any) => { listeners.session = fn; }, onDirectory: (fn: any) => { listeners.directory = fn; } };
  let snapshot = EMPTY_LIVE;
  let liveChanged = () => {};
  const exports: any = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL('../../ui/shared/app.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, document, window: { addEventListener: (name: string, fn: any) => { listeners[name] = fn; } },
    AbortController, requestAnimationFrame: (fn: () => void) => queueMicrotask(fn), queueMicrotask, performance, console,
    setTimeout: (fn: () => void, ms: number) => { const id = ++timerId; timers.set(id, { fn, ms }); return id; },
    clearTimeout: (id: number) => { timers.delete(id); },
    require: (name: string) => {
      if (name === '@openchamber/sdk') return { connectHost: () => host };
      if (name === '@openchamber/sdk/ui') return { applyHostReady() {} };
      if (name === './source.ts') return source;
      // A confirmed delete retires review markers; without the advertised device feature it does nothing.
      if (name === './change-digest-checkpoint.ts') return checkpoint;
      if (name === './cleanup.ts') return cleanup;
      if (name === './refresh.ts') return refresh;
      if (name === './path.ts') return path;
      if (name === './language.ts') return language;
      if (name === './session-context.ts') return sessionContext;
      if (name === './components.ts') return { el: node, refreshLabels() {},
        retireReadingUi() { infoPaints.push({ kind: 'retire' }); },
        beginInfoPaint(root: object) { infoPaints.push({ kind: 'begin', root }); },
        commitInfoPaint(root: object) { assert.equal(mount.firstElementChild, root, 'dispose previous handles after root replacement'); infoPaints.push({ kind: 'commit', root }); },
      };
      if (name === './live.ts') return { projectFor, LiveWorkspace: class {
        constructor(_host: unknown, _max: number, changed: () => void) { liveChanged = changed; }
        get snapshot() { return snapshot; } sessionSubscriptionCount = 0; start() {} restart() {} want() {} dispose() {}
      } };
      return {};
    },
  });
  let vc!: ViewContext<Ui>;
  const paints: Array<string | null> = [];
  const contexts: Array<{ session: string | null; identity: string; hasRead: boolean }> = [];
  const spec: ViewSpec<Ui> = {
    beforeUiChange,
    surface: board ? 'page' : 'panel', maxSessionSubscriptions: 2,
    initialUi: () => ({ sessionFilter: 'all', archived: false, selected: null }),
    scope: ({ session, directory }, ui) => board ? { ...pageListScope({ ...NO_FILTERS, session: ui.sessionFilter }), archived: ui.archived ? 'only' : 'exclude' } : contextListScope(session?.id, directory),
    wantProjects: () => [], wantDetails: c => c.read?.plans.slice(0, 1) ?? [],
    actionPlan: c => c.read?.plans[0] ?? null,
    onContext: c => { contexts.push({ session: c.session?.id ?? null, identity: c.identity, hasRead: !!c.read }); },
    paint: (_root, value) => { assert.equal(infoPaints.at(-1)?.root, _root, 'collect handles under this paint before creating controls');
      (_root as any).control = { dataset: { testid: 'fixture-control' }, isConnected: true,
        closest: (selector: string) => selector === '[data-testid]' ? (_root as any).control : null,
        querySelectorAll: () => [], matches: () => false,
        focus() { focusCalls++; document.activeElement = this; },
      };
      vc = value; paints.push(vc.read?.plans[0]?.id ?? null); paintHook?.(vc, _root); },
  };
  exports.startView(spec);
  return { requests, paints, contexts, listeners, infoPaints, languageStorage, storageCalls,
    live: (next: LiveSnapshot) => { snapshot = next; liveChanged(); },
    tick: (ms: number) => { const entry = [...timers].find(([, timer]) => timer.ms === ms); assert.ok(entry, `expected scheduled ${ms} ms refresh`); timers.delete(entry[0]); entry[1].fn(); },
    visibility: (state: string) => { document.visibilityState = state; listeners['document:visibilitychange'](); },
    holdLanguageWrite: (value: Promise<void> | null) => { languageWrite = value; }, setLanguage: (value: unknown) => { languageValue = value; }, get vc() { return vc; }, get pickerOpen() { return expanded; }, openPicker: () => { expanded = true; }, closePicker: () => { expanded = false; }, openDisclosure: () => { disclosure = true; },
    get focusCalls() { return focusCalls; }, get focusedControl() { return document.activeElement === thisControl(); },
    setFocus: (owns: boolean, active: 'control' | 'body' | 'outside') => { ownsFocus = owns; document.activeElement = active === 'control' ? thisControl() : active === 'body' ? body : { isConnected: true }; },
    focusReturn: (event = 'focus') => { ownsFocus = true; listeners[event === 'focus' ? 'focus' : 'document:focusin']?.(); },
    openLivePopup: (nestedSelect = false) => { livePopup = true; expanded = nestedSelect; },
    intercept: (fn: (q: GuestRequest, next: () => Promise<GuestRequestResult>) => Promise<GuestRequestResult>) => { const next = handler; handler = q => fn(q, () => next(q)); },
    ready: (id: string | null | undefined, directory: string | null = '/fixture/Alpha', account = 'fixture', language = { locale: 'en', supported: false }, item: unknown = null) => listeners.ready({ session: id ? { id } : id, directory, connection: { account }, locale: language.locale, features: { deviceStorage: language.supported }, surface: spec.surface, item } as HostReadyContext),
    stop: () => listeners.pagehide(),
  };
}

const progressAction = (id = 'A', directory = '/fixture/Alpha') => ({ kind: 'session', action: 'open-progress', sessionId: id, directory, sessionTitle: 'Not an identity' });
function actionLive(ids = ['A', 'B']): LiveSnapshot {
  return { projectsState: 'ready', projects: [{ id: 'project', name: 'Synthetic project', directory: '/fixture/Alpha' }], worktrees: new Map(), capped: [],
    sessions: new Map([['project', { state: 'ready', coverage: [{ directory: '/fixture/Alpha', state: 'ready' }], records: ids.map(id => ({ id, title: `Host ${id}`, projectId: 'project', directory: '/fixture/Alpha', parentId: null, archivedAt: null, worktree: null, activity: 'idle', outcome: null })) }]]) };
}

test('native Progress ready/onItem/onSession ordering pins an inactive explicit target, then ordinary opening follows chat', async () => {
  for (const order of ['ready', 'item-first', 'session-first', 'item-after-ready']) {
    const c = controller();
    try {
      c.live(actionLive());
      if (order === 'item-first') c.listeners.item(progressAction());
      if (order === 'session-first') c.listeners.session({ id: 'B' });
      c.ready('B', '/fixture/Alpha', 'fixture', { locale: 'ru', supported: false }, order === 'item-after-ready' ? null : progressAction());
      if (order === 'item-after-ready') c.listeners.item(progressAction());
      await settle();
      assert.equal(c.vc.session?.id, 'A', order);
      assert.equal(c.vc.read?.plans[0]?.id, 'P-A');
      assert.equal(c.vc.progressContext, null);
      assert.equal(c.vc.env.locale, 'ru');
      const mark = c.requests.length;
      c.listeners.session({ id: 'B', title: 'Another visible chat' }); await settle();
      assert.equal(c.vc.session?.id, 'A');
      assert.equal(c.requests.length, mark, 'chat alone starts no extra reads');
      c.listeners.item(progressAction('B')); await settle();
      assert.equal(c.vc.session?.id, 'B'); assert.deepEqual(c.vc.read?.plans, []);
      c.listeners.session({ id: 'A' }); c.listeners.item(null); await settle();
      assert.equal(c.vc.progressAction, false); assert.equal(c.vc.session?.id, 'A');
      assert.ok(c.requests.every(q => q.method === 'GET' && ['/health', '/v1/plans', '/v1/plan', '/v1/setup'].includes(q.path)), 'no compose/send/status/Workflows or mutation requests');
    } finally { c.stop(); }
  }
});

test('explicit local reset shows the current session, retires a held pinned read and survives same-item replay', async () => {
  const c = controller(), held = deferred<GuestRequestResult>(); let holdA = false;
  c.intercept((q, next) => q.path === '/v1/plans' && q.query?.session === 'A' && holdA ? (holdA = false, held.promise) : next());
  try {
    c.live(actionLive(['A', 'B', 'C'])); c.ready('B', '/fixture/Alpha', 'fixture', undefined, progressAction()); await settle();
    assert.equal(c.vc.session?.id, 'A'); assert.equal(c.vc.read?.plans[0]?.id, 'P-A');
    assert.equal(typeof c.vc.progressReset, 'function', 'pinned scope offers the reset');
    holdA = true; c.vc.retry(); await settle();
    const storage = c.storageCalls.length;
    c.vc.progressReset!(); await settle();
    assert.equal(c.vc.progressAction, false); assert.equal(c.vc.progressReset, undefined);
    assert.equal(c.vc.session?.id, 'B', 'ordinary current-session scope'); assert.deepEqual(c.vc.read?.plans, []);
    const mark = c.requests.length;
    held.resolve(response(plansPage([row], 'retired-next', { storeId: 'retired-store' }))); await settle();
    assert.equal(c.requests.slice(mark).some(q => q.query?.cursor === 'retired-next'), false, 'held pinned read cannot continue');
    assert.notEqual(c.vc.read?.storeId, 'retired-store'); assert.deepEqual(c.vc.read?.plans, []);
    // The retained host item keeps arriving: onItem, a ready snapshot with a locale/theme update.
    c.listeners.item(progressAction()); await settle();
    c.ready('B', '/fixture/Alpha', 'fixture', { locale: 'ru', supported: false }, progressAction()); await settle();
    assert.equal(c.vc.session?.id, 'B'); assert.equal(c.vc.progressAction, false); assert.equal(c.vc.env.locale, 'ru');
    assert.equal(c.requests.slice(mark).some(q => q.query?.session === 'A'), false, 'same retained item does not re-pin this frame');
    // Ordinary rules: the chat moves the scope; visibility neither pins nor unpins.
    c.listeners.session({ id: 'C' }); await settle(); assert.equal(c.vc.session?.id, 'C');
    c.visibility('hidden'); c.visibility('visible'); await settle(); assert.equal(c.vc.session?.id, 'C'); assert.equal(c.vc.progressAction, false);
    assert.ok(c.storageCalls.slice(storage).every(k => k === 'interface-language.v1'), 'reset writes no host storage');
    assert.ok(c.requests.every(q => q.method === 'GET'), 'no progress mutation, compose or navigation request');
    // A different valid target starts normal validation again.
    c.listeners.item(progressAction('B')); await settle();
    assert.equal(c.vc.progressAction, true); assert.equal(c.vc.session?.id, 'B');
  } finally { held.resolve(response(plansPage([]))); c.stop(); }
});

test('a host-cleared item ends the reset episode; a later delivery of the same target pins again', async () => {
  const c = controller();
  try {
    c.live(actionLive()); c.ready('B', '/fixture/Alpha', 'fixture', undefined, progressAction()); await settle();
    c.vc.progressReset!(); await settle(); assert.equal(c.vc.session?.id, 'B');
    c.listeners.item(null); await settle();
    assert.equal(c.vc.progressAction, false); assert.equal(c.vc.session?.id, 'B');
    c.listeners.item(progressAction()); await settle();
    assert.equal(c.vc.progressAction, true); assert.equal(c.vc.session?.id, 'A'); assert.equal(c.vc.read?.plans[0]?.id, 'P-A');
  } finally { c.stop(); }
});

test('reset leaves unavailable, checking, invalid and no-current-session pins without reading the pinned target', async () => {
  for (const mode of ['unavailable', 'checking', 'invalid', 'no-session']) {
    const c = controller();
    try {
      if (mode !== 'checking') c.live(actionLive(mode === 'unavailable' ? ['B'] : ['A', 'B']));
      c.ready(mode === 'no-session' ? null : 'B', '/fixture/Alpha', 'fixture', undefined, mode === 'invalid' ? { ...progressAction(), action: 'unknown' } : progressAction());
      await settle();
      assert.equal(c.vc.progressAction, true, mode); assert.equal(typeof c.vc.progressReset, 'function', mode);
      if (mode !== 'no-session') assert.equal(c.vc.progressContext, mode, mode);
      const mark = c.requests.length;
      c.vc.progressReset!(); await settle();
      assert.equal(c.vc.progressAction, false, mode); assert.equal(c.vc.progressContext, null, mode);
      assert.equal(c.requests.slice(mark).some(q => q.query?.session === 'A'), false, `${mode}: no pinned read is needed`);
      if (mode === 'no-session') {
        assert.equal(c.vc.session, null); assert.equal(c.vc.read, null, 'ordinary no-session state, no substitute');
        assert.equal(c.requests.slice(mark).some(q => q.path === '/v1/plans'), false);
      } else { assert.equal(c.vc.session?.id, 'B', mode); assert.deepEqual(c.vc.read?.plans, [], mode); }
    } finally { c.stop(); }
  }
});

test('a reset handle from an earlier pin cannot reset a newer target or an ordinary view', async () => {
  const c = controller();
  try {
    c.live(actionLive()); c.ready('B', '/fixture/Alpha', 'fixture', undefined, progressAction()); await settle();
    const old = c.vc;
    c.listeners.item(progressAction('B')); await settle();
    old.progressReset!(); await settle();
    assert.equal(c.vc.progressAction, true, 'newer target stays pinned'); assert.equal(c.vc.session?.id, 'B');
    const pinnedB = c.vc; pinnedB.progressReset!(); await settle();
    c.listeners.session({ id: 'A' }); await settle(); assert.equal(c.vc.session?.id, 'A');
    pinnedB.progressReset!(); await settle();
    assert.equal(c.vc.progressAction, false); assert.equal(c.vc.session?.id, 'A', 'a used handle is inert');
  } finally { c.stop(); }
});

test('focus on the reset control is handed to the resulting ordinary heading once the control disappears', async () => {
  let focused = 0, painted = false;
  const c = controller(false, undefined, (vc, root) => {
    if (vc.progressAction) return;
    painted = true;
    delete root.control; // the reset control is gone from the ordinary paint
    root.heading = { dataset: { testid: 'empty-state' }, isConnected: true, getBoundingClientRect: () => ({ top: 0, bottom: -1 }), scrollIntoView() {}, focus() { focused++; } };
  });
  try {
    c.live(actionLive()); c.ready('B', '/fixture/Alpha', 'fixture', undefined, progressAction()); await settle();
    painted = false;
    c.setFocus(true, 'control');
    c.vc.handoff({ heading: (root: any) => root.heading ?? null });
    c.vc.progressReset!(); await settle();
    assert.equal(painted, true); assert.equal(focused, 1, 'the context transition keeps this activation’s hand-off');
    c.vc.retry(); await settle();
    assert.equal(focused, 1, 'ordinary refreshes do not take focus again');
  } finally { c.stop(); }
});

test('native manifest action adds no payload or capability and leaves both background actions unchanged', () => {
  const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).openchamber.contributes;
  assert.deepEqual(manifest.actions.find((v: { id: string }) => v.id === 'open-progress'), { id: 'open-progress', label: 'Open Agent Progress', where: 'session', mode: 'open' });
  assert.deepEqual(manifest.actions.filter((v: { id: string }) => v.id !== 'open-progress'), [
    { id: 'insert-handoff', label: 'Insert handoff', where: 'session', mode: 'background' },
    { id: 'insert-progress-update', label: 'Insert progress update', where: 'session', mode: 'background' },
  ]);
  assert.deepEqual(manifest.capabilities, ['sessions']); assert.deepEqual(manifest.background, { entry: 'background/index.html' });
});

test('a previously readable action clears data when access or setup is withdrawn, not a stale alternate source', async () => {
  for (const mode of ['denied', 'setup-lost', 'binding-lost']) {
    const c = controller();
    try {
      c.live(actionLive()); c.ready('B', '/fixture/Alpha', 'fixture', undefined, progressAction()); await settle(); assert.ok(c.vc.read);
      c.intercept(async (q, next) => {
        if (q.path === '/health') {
          if (mode === 'denied') throw { code: 'NOT_GRANTED' };
          return response({ ...HEALTH, ready: false, diagnostics: mode === 'binding-lost' ? ['binding'] : [] });
        }
        return next();
      });
      c.vc.retry(); await settle(); assert.equal(c.vc.read, null); assert.ok(c.vc.failure); assert.equal(c.vc.session?.id, 'A');
    } finally { c.stop(); }
  }
});

test('action waits for current exact unambiguous location coverage; removal never becomes the visible session', async () => {
  const c = controller();
  try {
    c.ready('B', '/fixture/Alpha', 'fixture', undefined, progressAction()); await settle();
    assert.equal(c.vc.progressContext, 'checking');
    assert.equal(c.requests.some(q => q.path === '/v1/plans'), false);
    c.live(actionLive()); await settle(); assert.equal(c.vc.read?.plans[0].id, 'P-A');
    c.live(actionLive(['B'])); await settle();
    assert.equal(c.vc.progressContext, 'unavailable'); assert.equal(c.vc.read, null); assert.equal(c.vc.session?.id, 'A');
    const mark = c.requests.length; c.vc.retry(); await settle();
    assert.equal(c.requests.slice(mark).some(q => q.path === '/v1/plans'), false);
    const moved = actionLive(); moved.sessions.get('project')!.records[0].directory = '/fixture/Moved';
    c.live(moved); await settle(); assert.equal(c.vc.progressContext, 'unavailable');
    const duplicate = actionLive(); duplicate.sessions.get('project')!.records.push({ ...duplicate.sessions.get('project')!.records[0] });
    c.live(duplicate); await settle(); assert.equal(c.vc.progressContext, 'unavailable');
    const denied = actionLive(); denied.sessions.get('project')!.state = 'error';
    c.live(denied); await settle(); assert.equal(c.vc.progressContext, 'unavailable');
    c.live(actionLive()); await settle(); assert.ok(c.vc.read);
  } finally { c.stop(); }
});

test('malformed native metadata refuses without a visible-chat fallback; board ignores action items', async () => {
  for (const item of [{ ...progressAction(), action: 'unknown' }, { ...progressAction(), kind: 'message' }, { ...progressAction(), sessionId: '' }, { ...progressAction(), directory: null }, { ...progressAction(), directory: '/fixture/\nBad' }, { ...progressAction(), sessionId: 'x'.repeat(201) }]) {
    const c = controller();
    try {
      c.live(actionLive()); c.ready('B', '/fixture/Alpha', 'fixture', undefined, item); await settle();
      assert.equal(c.vc.progressContext, 'invalid'); assert.equal(c.vc.session, null); assert.equal(c.vc.read, null);
      assert.equal(c.requests.some(q => q.path === '/v1/plans'), false);
    } finally { c.stop(); }
  }
  const board = controller(true);
  try { board.ready('B', '/fixture/Alpha', 'fixture', undefined, progressAction()); await settle(); assert.equal(board.vc.progressAction, false); assert.ok(board.vc.read); }
  finally { board.stop(); }
});

test('action source collisions filter foreign plans; only complete verified results can establish zero or multiple plans', async () => {
  for (const mode of ['collision', 'empty', 'multiple', 'unverified', 'partial', 'denied', 'malformed']) {
    const c = controller();
    c.intercept(async (q, next) => {
      if (q.path !== '/v1/plans') return next();
      if (mode === 'denied') throw { code: 'NOT_GRANTED', message: 'Not granted' };
      if (mode === 'malformed') return response({ data: 'bad' });
      const rows = mode === 'empty' ? [] : mode === 'multiple' ? [row, { ...row, id: 'P-second' }] : [row, { ...row, sourceId: OTHER_SRC }];
      return response(plansPage(rows, mode === 'partial' ? 'more' : null, mode === 'unverified' ? { sourceBinding: { sourceId: SRC, verified: false } } : {}));
    });
    try {
      c.live(actionLive()); c.ready('B', '/fixture/Alpha', 'fixture', undefined, progressAction()); await settle();
      if (['denied', 'malformed', 'unverified', 'partial'].includes(mode)) {
        assert.equal(c.vc.read, null, mode); assert.ok(c.vc.failure, mode);
        assert.equal(c.requests.some(q => q.path === '/v1/plan'), false);
      } else {
        assert.equal(c.vc.read?.plans.length, mode === 'multiple' ? 2 : mode === 'empty' ? 0 : 1, mode);
        assert.ok(c.vc.read?.plans.every(p => p.sourceId === SRC));
      }
    } finally { c.stop(); }
  }
});

test('held action reads cannot continue or restore after replacement, account change, removed target or directory revalidation', async () => {
  for (const change of ['item', 'account', 'connection', 'removed', 'directory', 'ready-directory', 'ordinary']) {
    const c = controller(), held = deferred<GuestRequestResult>(); let first = true;
    c.intercept((q, next) => q.path === '/v1/plans' && first ? (first = false, held.promise) : next());
    try {
      c.live(actionLive()); c.ready('B', '/fixture/Alpha', 'fixture', undefined, progressAction()); await settle();
      if (change === 'item') c.listeners.item(progressAction('B'));
      if (change === 'account') c.ready('B', '/fixture/Alpha', 'replacement', undefined, progressAction());
      if (change === 'connection') c.listeners.connection({ connected: true, account: 'replacement' });
      if (change === 'removed') c.live(actionLive(['B']));
      if (change === 'directory') c.listeners.directory('/fixture/Other');
      if (change === 'ready-directory') c.ready('B', '/fixture/Other', 'fixture', undefined, progressAction());
      if (change === 'ordinary') { c.listeners.session({ id: 'B' }); c.listeners.item(null); }
      await settle(); const mark = c.requests.length;
      held.resolve(response(plansPage([row], 'retired-next', { storeId: 'retired-store' }))); await settle();
      assert.equal(c.requests.slice(mark).some(q => q.query?.cursor === 'retired-next'), false, change);
      assert.notEqual(c.vc.read?.storeId, 'retired-store', change);
      if (['item', 'removed', 'ordinary'].includes(change)) assert.notEqual(c.vc.read?.plans[0]?.id, 'P-A', change);
    } finally { held.resolve(response(plansPage([]))); c.stop(); }
  }
});

test('optional host work context is bounded, literal, URL-free and independent of session identity', () => {
  assert.deepEqual(hostWorkContext({}), {});
  assert.deepEqual(hostWorkContext({ agent: 42, links: 'bad' }), {});
  const links = Array.from({ length: 8 }, () => ({ title: '<img src=x>'.repeat(30), url: 'https://example.invalid/issue', kind: 'issue', linkedAt: 1 }));
  const result = hostWorkContext({ agent: '<script>'.repeat(20), links });
  assert.equal(result.agent?.length, 80); assert.equal(result.links?.length, 5); assert.equal(result.links?.[0].title.length, 200); assert.equal(result.moreLinks, true);
  assert.ok(result.links?.[0].title.startsWith('<img')); assert.equal(JSON.stringify(result).includes('https:'), false);
  assert.deepEqual(hostWorkContext({ links: [{ ...links[0], url: 'javascript:alert(1)' }, { ...links[0], linkedAt: 'bad' }, { ...links[0], kind: 'unknown' }] }), {});
});

test('live adapter exposes optional host context without altering session identity or activity', async () => {
  const callbacks = new Map<string, (value: any) => void>();
  const workspace = new LiveWorkspace({
    onProjects: async cb => { callbacks.set('projects', cb); return () => {}; },
    onWorktrees: async (_id, cb) => { callbacks.set('worktrees', cb); return () => {}; },
    onSessions: async (_id, cb) => { callbacks.set('sessions', cb); return () => {}; },
  }, 2, () => {});
  try {
    workspace.start(); await settle();
    callbacks.get('projects')!({ state: 'ready', projects: actionLive().projects }); workspace.want(['project']); await settle();
    const raw = { ...actionLive().sessions.get('project')!.records[0], createdAt: 1, updatedAt: 1, items: [], agent: 'Host agent', links: [{ title: 'Host issue', kind: 'issue', url: 'https://example.invalid/issue', linkedAt: 1 }] };
    callbacks.get('sessions')!({ state: 'ready', sessions: [raw], coverage: [{ directory: '/fixture/Alpha', state: 'ready' }] });
    const saved = workspace.snapshot.sessions.get('project')!.records[0];
    assert.equal(saved.id, 'A'); assert.equal(saved.activity, 'idle'); assert.equal(saved.agent, 'Host agent'); assert.equal(saved.links?.[0].title, 'Host issue');
    callbacks.get('sessions')!({ state: 'ready', sessions: [{ ...raw, agent: {}, links: {} }] });
    const malformed = workspace.snapshot.sessions.get('project')!.records[0];
    assert.equal(malformed.id, 'A'); assert.equal(malformed.activity, 'idle'); assert.equal(malformed.agent, undefined); assert.equal(malformed.links, undefined);
  } finally { workspace.dispose(); await settle(); }
});

test('QA-R current controller never asks old services for update metadata or dismissal across its lifecycle', async () => {
  const cases: Array<{ status: number; body: unknown }> = [
    { status: 200, body: { state: 'available', candidateVersion: '9.0.0' } },
    { status: 404, body: { error: 'not-found' } }, { status: 200, body: 'malformed' },
  ];
  const results: object[] = [];
  for (const board of [false, true]) for (const old of cases) {
    const c = controller(board);
    let failure: 'none' | 'unconfigured' | 'unavailable' = 'none';
    let updateCalls = 0;
    c.intercept(async (q, next) => {
      if (q.path === '/v1/extension-update') { updateCalls++; return response(old.body, old.status); }
      if (failure === 'unconfigured' && q.path === '/health') return response({ ...HEALTH, ready: false });
      if (failure === 'unavailable' && q.path === '/health') return response({ error: 'storage' }, 503);
      return next();
    });
    try {
      c.ready('A', '/fixture/Alpha', 'fixture', { locale: 'en', supported: true }); await settle();
      assert.ok(c.vc.read);
      c.tick(3000); await settle();
      c.listeners.session({ id: 'B' }); await settle();
      c.listeners.session(null); await settle();
      c.visibility('hidden'); await settle();
      const hiddenRequests = c.requests.length;
      c.focusReturn(); await settle(); assert.equal(c.requests.length, hiddenRequests);
      c.visibility('visible'); await settle();
      c.ready('A', '/fixture/Alpha', 'fixture', { locale: 'ru', supported: true }); await settle();
      failure = 'unconfigured'; c.vc.retry(); await settle(); assert.equal(c.vc.health?.ready, false);
      failure = 'unavailable'; c.vc.retry(); await settle(); assert.ok(c.vc.failure);
      c.tick(8000); await settle();
      failure = 'none'; c.vc.retry(); await settle(); assert.ok(c.vc.read);
      assert.equal(updateCalls, 0);
      assert.ok(c.languageStorage.length > 0, 'language preference remains independent');
      assert.ok(!c.storageCalls.includes('official-main-dismissed'));
      assert.ok(!('officialMain' in c.vc));
      results.push({ surface: board ? 'board' : 'session', oldReply: old.status === 404 ? 'missing' : typeof old.body === 'string' ? 'malformed' : 'available', updateCalls, dismissalCalls: 0 });
    } finally { c.stop(); }
  }
  if (process.env.EVIDENCE) {
    const { mkdirSync, writeFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    mkdirSync(process.env.EVIDENCE, { recursive: true });
    writeFileSync(resolve(process.env.EVIDENCE, 'mixed-versions.json'), JSON.stringify({ currentController: results, oldConsumerBase: '676eea9', oldConsumerProof: 'backend/extension-updates.test.ts' }, null, 2));
  }
});

test('unfocused background paints defer focus until this frame returns, across repeated replacements', async () => {
  for (const event of ['focus', 'focusin']) {
    const c = controller();
    try {
      c.ready('A'); await settle();
      c.setFocus(false, 'control');
      c.vc.retry(); await settle();
      c.ready('A', '/fixture/Alpha', 'fixture', { locale: 'ru', supported: false }); await settle();
      assert.equal(c.focusCalls, 0, 'poll and external language paints must not take focus');
      assert.equal(c.focusedControl, false);
      c.focusReturn(event);
      await settle();
      assert.equal(c.focusedControl, true, 'restore the rebuilt control on genuine frame focus return');
      assert.equal(c.focusCalls, 1);
      c.focusReturn(event);
      await settle();
      assert.equal(c.focusCalls, 1, 'return is one-shot');
    } finally { c.stop(); }
  }
});

test('deferred repaint focus never overrides a new control, starts from body, or survives retirement', async () => {
  for (const scenario of ['body', 'outside', 'new-control', 'focusin', 'focus-race', 'context', 'identity', 'store', 'dispose']) {
    const c = controller();
    try {
      c.ready('A'); await settle();
      c.setFocus(false, scenario === 'body' || scenario === 'outside' ? scenario : 'control');
      c.vc.retry(); await settle();
      if (scenario === 'new-control') c.setFocus(true, 'outside');
      if (scenario === 'focusin') { c.setFocus(true, 'outside'); c.focusReturn('focusin'); c.setFocus(true, 'body'); }
      if (scenario === 'focus-race') { c.focusReturn(); c.setFocus(true, 'outside'); }
      if (scenario === 'context') { c.ready('B'); await settle(); }
      if (scenario === 'identity') { c.ready('A', '/fixture/Alpha', 'another-account'); await settle(); }
      if (scenario === 'store') {
        c.intercept(async (q, next) => q.path === '/v1/plans' ? response({ ...plansPage([row]), storeId: 'replacement-store' }) : next());
        c.vc.retry(); await settle();
      }
      if (scenario === 'dispose') c.stop();
      c.focusReturn();
      await settle();
      assert.equal(c.focusCalls, 0, scenario);
    } finally { c.stop(); }
  }
});

test('language reads and focus return are independent of failed progress and use device scope', async () => {
  const c = controller();
  c.intercept(async () => { throw new Error('fixture service unavailable'); });
  try {
    c.setLanguage({ v: 1, preference: 'ru' });
    c.ready('A', '/fixture/Alpha', 'fixture', { locale: 'en', supported: true });
    await settle();
    assert.equal(c.vc.env.locale, 'ru');
    assert.equal(c.vc.language.preference, 'ru');
    assert.ok(c.vc.failure);
    assert.ok(c.languageStorage.length > 0);
    assert.ok(c.languageStorage.every(q => q.scope === 'device'));
    const progressReads = c.requests.length;
    c.setLanguage({ v: 1, preference: 'en' });
    c.listeners.focus();
    await settle();
    assert.equal(c.vc.env.locale, 'en');
    assert.equal(c.requests.length, progressReads, 'focus language check must not retry progress');
  } finally { c.stop(); }
});

test('manual language survives context changes, while automatic follows only supported host languages', async () => {
  const c = controller();
  try {
    c.ready('A', '/fixture/Alpha', 'fixture', { locale: 'ru-RU', supported: true });
    await settle();
    assert.equal(c.vc.env.locale, 'ru');
    c.vc.language.choose('en');
    await settle();
    assert.equal(c.vc.env.locale, 'en');
    c.ready('B', '/fixture/Beta', 'other-account', { locale: 'ru', supported: true });
    await settle();
    assert.equal(c.vc.env.locale, 'en');
    c.vc.language.choose('auto');
    await settle();
    assert.equal(c.vc.env.locale, 'ru');
    c.ready('B', '/fixture/Beta', 'other-account', { locale: 'de-DE', supported: true });
    await settle();
    assert.equal(c.vc.env.locale, 'en');
  } finally { c.stop(); }
});

test('language repaint cannot retry an already failed inline document; explicit retry still can', async () => {
  let previousLanguage = '';
  const c = controller(false, undefined, vc => {
    if (previousLanguage && previousLanguage !== vc.env.locale && vc.read?.plans[0]) vc.requestDocument(vc.read.plans[0]);
    previousLanguage = vc.env.locale;
  });
  c.intercept(async (q, next) => q.path === '/v1/document' ? response({ error: 'busy' }, 503) : next());
  try {
    c.ready('A'); await settle();
    const p = c.vc.read!.plans[0];
    c.vc.requestDocument(p); await settle();
    assert.equal(c.vc.document(p)?.state, 'error');
    const reads = c.requests.filter(q => q.path === '/v1/document').length;
    c.ready('A', '/fixture/Alpha', 'fixture', { locale: 'ru', supported: false }); await settle();
    assert.equal(c.requests.filter(q => q.path === '/v1/document').length, reads);
    c.vc.requestDocument(p); await settle();
    assert.equal(c.requests.filter(q => q.path === '/v1/document').length, reads + 1);
  } finally { c.stop(); }
});

test('saving, failed save and same-effective-language choice do not retry a retained document error', async () => {
  let previous = '';
  const c = controller(false, undefined, vc => {
    const next = JSON.stringify([vc.language.pending, vc.language.writeError, vc.language.preference]);
    if (previous && next !== previous && vc.read?.plans[0]) vc.requestDocument(vc.read.plans[0]);
    previous = next;
  });
  c.intercept(async (q, next) => q.path === '/v1/document' ? response({ error: 'busy' }, 503) : next());
  try {
    c.ready('A', '/fixture/Alpha', 'fixture', { locale: 'en', supported: true }); await settle();
    c.vc.requestDocument(c.vc.read!.plans[0]); await settle();
    const reads = () => c.requests.filter(q => q.path === '/v1/document').length;
    assert.equal(reads(), 1);
    let reject!: (e: Error) => void;
    c.holdLanguageWrite(new Promise<void>((_resolve, no) => { reject = no; }));
    c.vc.language.choose('ru'); await settle();
    assert.equal(c.vc.language.pending, true);
    assert.equal(reads(), 1, 'pending save still uses the old language and must not retry');
    reject(new Error('synthetic storage refused')); await settle();
    assert.equal(c.vc.language.writeError, 'saveFailed');
    assert.equal(reads(), 1, 'failed save must not retry');
    c.holdLanguageWrite(null);
    c.vc.language.choose('en'); await settle();
    assert.equal(c.vc.language.preference, 'en');
    assert.equal(c.vc.env.locale, 'en');
    assert.equal(reads(), 1, 'same effective language must not retry');
  } finally { c.stop(); }
});

test('background paints preserve a pressed control until release; authority changes still retire immediately', async () => {
  const c = controller();
  try {
    c.ready('A'); await settle();
    const target = { closest: () => ({}), isConnected: true, setPointerCapture() {} };
    c.listeners['document:pointerdown']({ button: 0, target });
    const before = c.paints.length;
    c.intercept(async (q, next) => q.path === '/v1/plans' ? response({ error: 'unavailable' }, 503) : next());
    c.vc.retry(); await settle();
    assert.equal(c.paints.length, before, 'background read cannot replace the pressed target');
    c.listeners['document:pointerup'](); await settle();
    assert.ok(c.paints.length > before, 'release resumes the pending paint');
    c.listeners['document:pointerdown']({ button: 0, target: { closest: (selector: string) => selector === '#root' ? {} : null, isConnected: true } });
    const beforeDrag = c.paints.length;
    c.intercept(async (q, next) => q.path === '/v1/plans' ? response(plansPage([row])) : next());
    c.vc.retry(); await settle();
    assert.ok(c.paints.length > beforeDrag, 'non-control drags do not defer live map paints');
    c.listeners['document:pointerdown']({ button: 0, target });
    c.ready(null); await settle();
    assert.equal(c.vc.session, null, 'authority retirement is not deferred by a held pointer');
  } finally { c.stop(); }
});

test('sidebar null/undefined never falls back to directory; board {} and contributors stay intact', async () => {
  for (const id of [null, undefined, '']) for (const directory of [null, '/fixture/Alpha', 'C:\\fixture\\Alpha']) {
    assert.equal(contextListScope(id, directory), null);
    assert.equal(contextScope([plan], id, directory).kind, 'none');
  }
  assert.deepEqual(contextListScope('A', '/moved'), { session: 'A' });
  assert.deepEqual(pageListScope(NO_FILTERS), {});
  assert.deepEqual(pageListScope({ ...NO_FILTERS, session: 'C' }), { session: 'C' });
  const helping = contextScope([plan], 'C');
  assert.equal(helping.kind === 'session' && helping.plans[0].id, 'P-A');
  assert.equal(helping.kind === 'session' && helping.owned, 0);
  assert.equal(placeOf({ ...plan, directory: 'c:\\fixture\\Alpha' }, EMPTY_LIVE).projectLabel, 'Alpha');
  assert.equal(placeOf({ ...plan, directory: '/fixture/Alpha\\' }, EMPTY_LIVE).projectLabel, 'Alpha\\');
  const calls: GuestRequest[] = [];
  const result = await source.readList({ serviceRequest: async q => { calls.push(q); return response(HEALTH); } }, null);
  assert.equal(result.ok && result.read, null); assert.deepEqual(calls.map(q => q.path), ['/health']);
});

test('initial store identity adoption notifies context consumers before a later session switch', async () => {
  const c = controller();
  try {
    c.ready('A'); await settle();
    assert.ok(c.vc.identity);
    assert.ok(c.contexts.some(v => v.session === 'A' && v.identity === c.vc.identity && v.hasRead), 'the rail must learn the store authority before the user can choose a plan');
    const count = c.contexts.length;
    c.vc.retry(); await settle();
    assert.equal(c.contexts.length, count, 'unchanged polls do not repeat the identity transition');
  } finally { c.stop(); }
});

test('actual controller: full ready A → null → B retires held list and open picker, then accepts later ready A', async () => {
  const c = controller(); const held = deferred<GuestRequestResult>();
  c.intercept((q, next) => q.path === '/v1/plans' && q.query?.session === 'A' ? held.promise : next());
  c.ready('A'); await settle(); assert.equal(c.vc.read as unknown, null);
  c.openPicker(); c.ready(null); c.listeners.directory('/fixture/Alpha'); c.listeners.session(null); await settle();
  assert.equal(c.vc.session as unknown, null); assert.equal(c.vc.read as unknown, null);
  const mark = c.requests.length; c.vc.retry(); await settle();
  assert.equal(c.requests.slice(mark).some(q => q.path.startsWith('/v1/plan') || ['/v1/document', '/v1/history'].includes(q.path)), false);
  c.ready('B'); await settle(); assert.equal(c.vc.session?.id, 'B'); assert.deepEqual(c.vc.read?.plans as unknown, []);
  held.resolve(response(plansPage([row]))); await settle(); assert.deepEqual(c.vc.read?.plans as unknown, []);
  c.ready('A'); await settle(); assert.equal(c.vc.read?.plans[0].id, 'P-A');
  const lists = c.requests.filter(q => q.path === '/v1/plans').length;
  c.ready('A', 'C:\\fixture\\Moved'); c.listeners.directory('C:\\fixture\\Moved'); c.listeners.session({ id: 'A' }); await settle();
  assert.equal(c.vc.read?.plans[0].id, 'P-A'); assert.equal(c.requests.filter(q => q.path === '/v1/plans').length, lists);
  assert.ok(c.requests.filter(q => q.path === '/v1/plans').every(q => q.query?.session && !q.query.directory));
  c.stop();
});

test('same-session metadata preserves open pickers and manual choice; navigation retires them', async () => {
  for (const board of [false, true]) {
    const c = controller(board); c.ready('A'); await settle();
    c.vc.setUi({ selected: plan.key }); await settle();
    c.openPicker(); const paints = c.paints.length;
    c.listeners.session({ id: 'A', title: 'Updated title', busy: true }); await settle();
    assert.equal(c.pickerOpen, true); assert.equal(c.paints.length, paints);
    c.listeners.ready({ session: { id: 'A', title: 'Another title', busy: false }, directory: '/fixture/Alpha', connection: { account: 'fixture' }, locale: 'en', surface: board ? 'page' : 'panel' }); await settle();
    assert.equal(c.pickerOpen, true); assert.equal(c.paints.length, paints);
    assert.equal(c.vc.ui.selected, plan.key);
    c.closePicker(); c.listeners.session({ id: 'A', title: 'Another title', busy: false }); await settle();
    assert.equal(c.vc.session?.title, 'Another title'); assert.equal(c.vc.ui.selected, plan.key);
    c.openPicker();
    c.ready(null); await settle(); assert.equal(c.pickerOpen, false);
    c.ready('A'); await settle(); c.openPicker();
    c.ready('B'); await settle(); assert.equal(c.pickerOpen, false);
    c.stop();
  }
});

test('an expanded disclosure does not indefinitely defer background reports',async()=>{
  const c=controller(true);try{
    c.ready('A');await settle();c.openDisclosure();const before=c.paints.length;
    c.listeners.session({id:'A',title:'Updated while comparison is open'});await settle();
    assert(c.paints.length>before);assert.equal(c.vc.session?.title,'Updated while comparison is open');
  }finally{c.stop();}
});

test('live Filters and its nested select cannot defer capture-off or read-error paints', async () => {
  for (const nestedSelect of [false, true]) {
    const c = controller(true);
    try {
      c.ready('A'); await settle();
      c.openLivePopup(nestedSelect);
      const before = c.paints.length;
      c.intercept(async (q, next) => q.path === '/v1/plans' ? response({ ...plansPage([row]), captureEnabled: false }) : next());
      c.vc.retry(); await settle();
      assert.ok(c.paints.length > before, 'capture update paints with the popup open');
      assert.equal(c.vc.read?.captureEnabled, false);
      c.openLivePopup(nestedSelect);
      const beforeError = c.paints.length;
      c.intercept(async (q, next) => q.path === '/v1/plans' ? response({ error: 'unavailable' }, 503) : next());
      c.vc.retry(); await settle();
      assert.ok(c.paints.length > beforeError, 'a concrete failure cannot remain hidden behind the popup');
      assert.ok(c.vc.failure);
    } finally { c.stop(); }
  }
});

test('live popup retirement accepts the new authority and rejects a held old reply', async () => {
  const c = controller(true), held = deferred<GuestRequestResult>();
  try {
    c.ready('A'); await settle();
    const original = c.vc.identity;
    let holding = true;
    c.intercept((q, next) => q.path === '/v1/plans' && holding ? (holding = false, held.promise) : next());
    c.openLivePopup(true); c.vc.retry(); await settle();
    c.ready('B', '/fixture/Other', 'another-account'); await settle();
    const paints = c.paints.length;
    assert.equal(c.vc.ctx.connection?.account, 'another-account');
    assert.equal(c.pickerOpen, false, 'authority change replaces the old popup before its reply');
    held.resolve(response({ ...plansPage([row]), storeId: 'retired-store', captureEnabled: false })); await settle();
    assert.equal(c.vc.identity, original, 'same store authority remains current under the new account');
    assert.notEqual(c.vc.read?.storeId, 'retired-store');
    assert.equal(c.vc.read?.captureEnabled, true);
    assert.equal(c.paints.length, paints, 'retired reply does not create a stale paint');
  } finally { held.resolve(response(plansPage([row]))); c.stop(); }
});

test('a live Filters popup cannot keep a cleanup confirmation or its callback alive across authority change', async () => {
  const c = controller(true);
  try {
    c.ready('A'); await settle();
    c.vc.requestDelete(plan); await settle();
    const confirmation = c.vc;
    assert.ok(confirmation.cleanup.target);
    c.openLivePopup(true);
    c.ready('A', '/fixture/Alpha', 'replacement-account');
    const mark = c.requests.length;
    confirmation.confirmDelete(); // synchronous retirement, before another paint
    await settle();
    assert.equal(c.vc.cleanup.target, null);
    assert.equal(c.requests.slice(mark).some(q => q.method === 'POST'), false);
  } finally { c.stop(); }
});

test('view-owned requests retire on effective UI transitions before a held reply or repaint',async()=>{
  let retired=false,continued=false;
  const c=controller(true,(before,next)=>{if(before.selected!==next.selected||before.sessionFilter!==next.sessionFilter)retired=true;});
  try{
    c.ready('A');await settle();retired=false;
    const held=deferred<void>();void held.promise.then(()=>{if(!retired)continued=true;});
    const painted=c.paints.length;c.vc.setUi({selected:'source/other'});
    assert.equal(retired,true);assert.equal(c.paints.length,painted);
    held.resolve();await settle();assert.equal(continued,false);
    retired=false;c.vc.setUi({});assert.equal(retired,false);
    c.vc.setUi({sessionFilter:'another-session'});assert.equal(retired,true);
  }finally{c.stop();}
});

test('retired health/part replies cannot start continuation requests or stale actions in draft', async () => {
  const c = controller(); const health = deferred<GuestRequestResult>();
  let first = true;
  c.intercept((q, next) => q.path === '/health' && first ? (first = false, health.promise) : next());
  c.ready('A'); await settle(); c.ready(null); await settle();
  health.resolve(response(HEALTH)); await settle(); assert.equal(c.requests.some(q => q.path === '/v1/plans'), false);
  c.ready('A'); await settle(); const old = c.vc;
  const held = deferred<GuestRequestResult>();
  c.intercept((q, next) => ['/v1/document', '/v1/history', '/v1/plan'].includes(q.path) ? held.promise : next());
  old.requestDocument(plan); old.requestHistory(plan); old.requestDelete(plan); await settle();
  const confirmation = c.vc;
  assert.ok(confirmation.cleanup.target);
  c.ready(null); await settle(); const mark = c.requests.length;
  old.requestDocument(plan); old.requestHistory(plan); confirmation.confirmDelete();
  held.resolve(response({ ...envelope(), document: docRef(), text: 'retired', data: [], nextCursor: 'more' })); await settle();
  assert.equal(c.vc.cleanup.target, null); assert.equal(c.vc.read, null);
  assert.equal(c.requests.slice(mark).some(q => q.path !== '/health' && q.path !== '/v1/setup'), false);
  c.stop();
});

test('a failed B read cannot expose A or leave its error on a later draft/empty scope', async () => {
  const c = controller(); c.ready('A'); await settle(); assert.ok(c.vc.read);
  let fail = true;
  c.intercept((q, next) => q.path === '/v1/plans' && q.query?.session === 'B' && fail ? Promise.resolve(response({ error: 'busy' }, 503)) : next());
  c.ready('B'); await settle(); assert.equal(c.vc.read as unknown, null); assert.equal(c.vc.failure?.kind, 'busy');
  c.ready(undefined); await settle(); assert.equal(c.vc.failure as unknown, null); assert.equal(c.vc.read as unknown, null);
  fail = false; c.ready('B'); await settle(); assert.deepEqual(c.vc.read?.plans, []); c.stop();
});

test('actual board controller keeps explicit session filter and archive mode through host A/null/B snapshots', async () => {
  const c = controller(true); c.ready('A'); await settle(); assert.equal(c.vc.read?.plans[0].id, 'P-A');
  c.vc.setUi({ sessionFilter: 'C', archived: true }); await settle();
  const count = c.requests.filter(q => q.path === '/v1/plans').length;
  c.ready(null); c.ready('B'); c.listeners.directory('/fixture/Moved'); await settle();
  assert.equal(c.vc.ui.sessionFilter, 'C'); assert.equal(c.vc.ui.archived, true);
  assert.equal(c.requests.filter(q => q.path === '/v1/plans').length, count);
  assert.equal(c.requests.filter(q => q.path === '/v1/plans').at(-1)?.query?.session, 'C');
  assert.equal(c.requests.filter(q => q.path === '/v1/plans').at(-1)?.query?.archived, 'only'); c.stop();
});
