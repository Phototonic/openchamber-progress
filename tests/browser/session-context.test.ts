import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as source from '../../ui/shared/source.ts';
import * as cleanup from '../../ui/shared/cleanup.ts';
import * as refresh from '../../ui/shared/refresh.ts';
import * as path from '../../ui/shared/path.ts';
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
function controller(board = false) {
  const listeners: Record<string, (value?: any) => void> = {};
  const requests: GuestRequest[] = [];
  let expanded = false;
  const node = () => ({ dataset: {} as Record<string, string>, firstElementChild: null as any,
    querySelector: (s: string) => s === '[aria-expanded="true"]' && expanded ? {} : null,
    querySelectorAll: () => [], getAnimations: () => [], setAttribute() {}, append() {},
    replaceChildren(child: any) { this.firstElementChild = child; expanded = false; },
  });
  const mount = node();
  const document = { documentElement: node(), head: node(), visibilityState: 'visible', activeElement: null,
    getElementById: (id: string) => id === 'root' ? mount : {}, addEventListener() {}, scrollingElement: { scrollTop: 0 } };
  let handler = async (q: GuestRequest): Promise<GuestRequestResult> => {
    if (q.path === '/health') return response({ ...HEALTH, planCleanup: 1 });
    if (q.path === '/v1/setup') return response(setupRead());
    if (q.path === '/v1/plans') return response(plansPage(!q.query?.session || ['A', 'C'].includes(q.query.session) ? [row] : []));
    if (q.path === '/v1/plan') return response(planPage(row, items, []));
    if (q.path === '/v1/document') return response({ ...envelope(), document: docRef(), text: 'Recorded document', nextCursor: null });
    if (q.path === '/v1/history') return response({ ...envelope(), data: [], nextCursor: null });
    return response({ error: 'not-found' }, 404);
  };
  const host = { serviceRequest: (q: GuestRequest) => { requests.push(q); return handler(q); }, storage: { get: async () => undefined, set: async () => {}, delete: async () => {} },
    onReady: (fn: any) => { listeners.ready = fn; }, onSession: (fn: any) => { listeners.session = fn; }, onDirectory: (fn: any) => { listeners.directory = fn; } };
  const exports: any = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL('../../ui/shared/app.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, document, window: { addEventListener: (name: string, fn: any) => { listeners[name] = fn; } },
    queueMicrotask, performance, console, setTimeout: () => 1, clearTimeout() {},
    require: (name: string) => {
      if (name === '@openchamber/sdk') return { connectHost: () => host };
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
  const paints: Array<string | null> = [];
  const spec: ViewSpec<Ui> = {
    surface: board ? 'page' : 'panel', maxSessionSubscriptions: 2,
    initialUi: () => ({ sessionFilter: 'all', archived: false, selected: null }),
    scope: ({ session, directory }, ui) => board ? { ...pageListScope({ ...NO_FILTERS, session: ui.sessionFilter }), archived: ui.archived ? 'only' : 'exclude' } : contextListScope(session?.id, directory),
    wantProjects: () => [], wantDetails: c => c.read?.plans.slice(0, 1) ?? [],
    actionPlan: c => c.read?.plans[0] ?? null,
    paint: (_root, value) => { vc = value; paints.push(vc.read?.plans[0]?.id ?? null); },
  };
  exports.startView(spec);
  return { requests, paints, listeners, get vc() { return vc; }, get pickerOpen() { return expanded; }, openPicker: () => { expanded = true; }, closePicker: () => { expanded = false; },
    intercept: (fn: (q: GuestRequest, next: () => Promise<GuestRequestResult>) => Promise<GuestRequestResult>) => { const next = handler; handler = q => fn(q, () => next(q)); },
    ready: (id: string | null | undefined, directory: string | null = '/fixture/Alpha', account = 'fixture') => listeners.ready({ session: id ? { id } : id, directory, connection: { account }, locale: 'en', surface: spec.surface } as HostReadyContext),
    stop: () => listeners.pagehide(),
  };
}

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
