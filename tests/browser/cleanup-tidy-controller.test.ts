// Actual startView controller, with held service receipts and explicitly driven context events.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import type { ViewContext, ViewSpec } from '../../ui/shared/app.ts';
import * as source from '../../ui/shared/source.ts';
import * as cleanup from '../../ui/shared/cleanup.ts';
import * as refresh from '../../ui/shared/refresh.ts';
import * as language from '../../ui/shared/language.ts';
import * as path from '../../ui/shared/path.ts';
import * as sessionContext from '../../ui/shared/session-context.ts';
import { EMPTY_LIVE } from '../../ui/shared/live.ts';
import { HEALTH, plansPage, summary, S } from './fixtures.ts';

const APP = ts.transpileModule(readFileSync(new URL('../../ui/shared/app.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const drain = async () => { for (let n = 0; n < 40; n++) await new Promise<void>(r => setImmediate(r)); };
async function until(check: () => boolean) {
  for (let n = 0; n < 100; n++) { if (check()) return; await drain(); }
  assert.fail('Controller did not reach the expected state');
}
function frame(surface: 'page' | 'panel') {
  const listeners: Record<string, (v?: any) => void> = {};
  class Node {
    dataset: Record<string, string> = {}; children: Node[] = [];
    get firstElementChild() { return this.children[0] ?? null; }
    contains(n: unknown): boolean { return n === this || this.children.some(c => c.contains(n)); }
    querySelectorAll() { return []; } querySelector() { return null; } closest() { return null; }
    focus() {} getAnimations() { return []; } setAttribute() {}
    append(...nodes: Node[]) { this.children.push(...nodes); }
    replaceChildren(node: Node) { this.children = [node]; }
  }
  const mount = new Node();
  const document = { documentElement: new Node(), head: new Node(), body: new Node(), visibilityState: 'visible', activeElement: null, scrollingElement: { scrollTop: 0 }, getElementById: (id: string) => id === 'root' ? mount : {}, addEventListener() {} };
  const plans = [summary('one', [], { lifecycle: 'finished' }), summary('two', [], { lifecycle: 'cancelled' })];
  const posts: string[] = [];
  let release: (() => void) | undefined;
  let hold = false;
  let vc!: ViewContext<{ filter: string }>;
  const host = {
    async serviceRequest(q: { path: string; body?: string }) {
      if (q.path === '/health') return { status: 200, body: JSON.stringify({ ...HEALTH, planCleanup: 1 }) };
      if (q.path === '/v1/plans') return { status: 200, body: JSON.stringify(plansPage(plans)) };
      if (q.path === '/v1/plan/archive' || q.path === '/v1/plan/restore') {
        posts.push(q.path);
        const request = JSON.parse(q.body!);
        if (hold) { hold = false; await new Promise<void>(r => { release = r; }); }
        return { status: 200, body: JSON.stringify({ ...request, cleanup: { state: q.path.endsWith('archive') ? 'archived' : 'visible', revision: request.cleanupRev + 1 } }) };
      }
      return { status: 404, body: '{"error":"not-found"}' };
    },
    storage: { get: async () => undefined, set: async () => {} },
    onReady(fn: any) { listeners.ready = fn; }, onSession(fn: any) { listeners.session = fn; },
    onDirectory(fn: any) { listeners.directory = fn; }, onItem() {}, onConnection() {},
  };
  const exports: any = {};
  runInNewContext(APP, {
    exports, document, AbortController, crypto: globalThis.crypto, queueMicrotask, performance, console,
    setTimeout: () => 1, clearTimeout() {},
    window: { addEventListener: (key: string, fn: any) => { listeners[key] = fn; } },
    require: (name: string) => ({
      '@openchamber/sdk': { connectHost: () => host }, '@openchamber/sdk/ui': { applyHostReady() {} },
      './source.ts': source, './cleanup.ts': cleanup, './refresh.ts': refresh, './language.ts': language, './session-context.ts': sessionContext, './path.ts': path,
      './phone-layout.ts': { applyDeviceHooks() {} }, './setup.ts': { retireSetupSteps() {} },
      './components.ts': { el: () => new Node(), refreshLabels() {}, retireReadingUi() {}, beginInfoPaint() {}, commitInfoPaint() {} },
      './live.ts': { LiveWorkspace: class { snapshot = EMPTY_LIVE; sessionSubscriptionCount = 0; start() {} restart() {} want() {} dispose() {} } },
      './official.ts': { OfficialMainState: class { check = async () => ({ next: null, apply: () => false }); } },
    } as Record<string, unknown>)[name] ?? {},
  });
  const spec: ViewSpec<{ filter: string }> = {
    surface, maxSessionSubscriptions: 0, initialUi: () => ({ filter: 'all' }),
    scope: c => surface === 'page' ? {} : { session: c.session?.id },
    tidyScope: c => c.ui.filter, tidyPlans: c => c.read?.plans ?? [],
    wantProjects: () => [], wantDetails: () => [], paint: (_root, c) => { vc = c; },
  };
  exports.startView(spec);
  listeners.ready({ session: { id: S.M }, directory: '/fixture', connection: { connected: true, account: 'example' }, locale: 'en', surface, settings: {}, item: null, theme: {} });
  return {
    get vc() { return vc; }, posts,
    hold() { hold = true; }, release() { assert.ok(release); release(); },
    session(id: string) { listeners.session({ id }); },
    account() { listeners.ready({ ...vc.ctx, connection: { connected: true, account: 'other-account' } }); },
    stop() { listeners.pagehide(); },
  };
}
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
