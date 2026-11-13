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
import { EMPTY_LIVE } from '../../ui/shared/live.ts';
import { contextListScope, contextScope, pageListScope, NO_FILTERS, placeOf } from '../../ui/shared/scope.ts';
import { parsePlansPage } from '../../ui/shared/adapter.ts';
import type { ViewContext, ViewSpec } from '../../ui/shared/app.ts';
import type { GuestRequest, GuestRequestResult, HostReadyContext } from '@openchamber/sdk';
import { HEALTH, plansPage, planPage, summary, setupRead, envelope, docRef } from './fixtures.ts';

const items = [{ id: 'task', title: 'Reported work', kind: 'task' as const, status: 'done' as const }];
const row = summary('P-A', items, { sessionId: 'A', lifecycle: 'finished', document: docRef() });
const plan = parsePlansPage(JSON.stringify(plansPage([row]))).data[0];
const response = (value: unknown, status = 200) => ({ status, body: JSON.stringify(value) });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
// Drain microtasks/IO turns, not a timing assumption about network completion.
async function settle() { for (let i = 0; i < 8; i++) await new Promise<void>(r => setImmediate(r)); }

type Ui = { sessionFilter: string; archived: boolean; selected: string | null };
/** Execute the actual shared controller. DOM/layout and SDK mount mechanics are
 * deliberately minimal here; current-bundle browser QA owns those boundaries. */
function controller(board = false, beforeUiChange?: (previous: Ui, next: Ui) => void, paintHook?: (vc: ViewContext<Ui>) => void) {
  const listeners: Record<string, (value?: any) => void> = {};
  const requests: GuestRequest[] = [];
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
    get: async (key: string, options?: { scope: string }) => { if (key !== 'interface-language.v1') return undefined; languageStorage.push({ op: 'get', key, scope: options?.scope }); return languageValue; },
    set: async (key: string, value: unknown, options?: { scope: string }) => { if (key === 'interface-language.v1') { languageStorage.push({ op: 'set', key, scope: options?.scope }); await languageWrite; languageValue = value; } },
    delete: async () => {},
  },
    onReady: (fn: any) => { listeners.ready = fn; }, onSession: (fn: any) => { listeners.session = fn; }, onDirectory: (fn: any) => { listeners.directory = fn; } };
  const exports: any = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL('../../ui/shared/app.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, document, window: { addEventListener: (name: string, fn: any) => { listeners[name] = fn; } },
    AbortController, requestAnimationFrame: (fn: () => void) => queueMicrotask(fn), queueMicrotask, performance, console, setTimeout: () => 1, clearTimeout() {},
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
      if (name === './components.ts') return { el: node, refreshLabels() {},
        retireReadingUi() { infoPaints.push({ kind: 'retire' }); },
        beginInfoPaint(root: object) { infoPaints.push({ kind: 'begin', root }); },
        commitInfoPaint(root: object) { assert.equal(mount.firstElementChild, root, 'dispose previous handles after root replacement'); infoPaints.push({ kind: 'commit', root }); },
      };
      if (name === './live.ts') return { LiveWorkspace: class { snapshot = EMPTY_LIVE; sessionSubscriptionCount = 0; start() {} restart() {} want() {} dispose() {} } };
      if (name === './official.ts') return { OfficialMainState: class { check = async () => ({ next: null, apply: () => false }); } };
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
      vc = value; paints.push(vc.read?.plans[0]?.id ?? null); paintHook?.(vc); },
  };
  exports.startView(spec);
  return { requests, paints, contexts, listeners, infoPaints, languageStorage, holdLanguageWrite: (value: Promise<void> | null) => { languageWrite = value; }, setLanguage: (value: unknown) => { languageValue = value; }, get vc() { return vc; }, get pickerOpen() { return expanded; }, openPicker: () => { expanded = true; }, closePicker: () => { expanded = false; }, openDisclosure: () => { disclosure = true; },
    get focusCalls() { return focusCalls; }, get focusedControl() { return document.activeElement === thisControl(); },
    setFocus: (owns: boolean, active: 'control' | 'body' | 'outside') => { ownsFocus = owns; document.activeElement = active === 'control' ? thisControl() : active === 'body' ? body : { isConnected: true }; },
    focusReturn: (event = 'focus') => { ownsFocus = true; listeners[event === 'focus' ? 'focus' : 'document:focusin']?.(); },
    openLivePopup: (nestedSelect = false) => { livePopup = true; expanded = nestedSelect; },
    intercept: (fn: (q: GuestRequest, next: () => Promise<GuestRequestResult>) => Promise<GuestRequestResult>) => { const next = handler; handler = q => fn(q, () => next(q)); },
    ready: (id: string | null | undefined, directory: string | null = '/fixture/Alpha', account = 'fixture', language = { locale: 'en', supported: false }) => listeners.ready({ session: id ? { id } : id, directory, connection: { account }, locale: language.locale, features: { deviceStorage: language.supported }, surface: spec.surface } as HostReadyContext),
    stop: () => listeners.pagehide(),
  };
}

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
