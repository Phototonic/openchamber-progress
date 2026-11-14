// Health-reported store failures: a configured store that cannot open must surface as a
// classified failure (damaged/incompatible/busy/unavailable) on the main surfaces, while a
// genuinely unconfigured service keeps the setup-needed null read. Source-level readList
// checks plus the actual shared controller in a VM over a synthetic device, mirroring the
// session-context harness; DOM/layout belong to current-bundle browser QA.
import { test } from 'node:test';
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
import * as i18n from '../../ui/shared/i18n.ts';
import { EMPTY_LIVE } from '../../ui/shared/live.ts';
import { contextListScope } from '../../ui/shared/scope.ts';
import type { ViewContext, ViewSpec } from '../../ui/shared/app.ts';
import type { GuestRequest, GuestRequestResult, HostReadyContext } from '@openchamber/sdk';
import type { ReadFailure } from '../../ui/shared/source.ts';
import { HEALTH, HEALTH_UNCONFIGURED, plansPage, planPage, setupRead, envelope, docRef, summary } from './fixtures.ts';

const items = [{ id: 'task', title: 'Reported work', kind: 'task' as const, status: 'working' as const }];
const row = summary('P-A', items, { sessionId: 'A', document: docRef() });
const response = (value: unknown, status = 200): GuestRequestResult => ({ status, body: JSON.stringify(value) });
const failedHealth = (code: string) => ({ ...HEALTH, ready: false, sqlite: false, diagnostics: [code] });
// Drain microtasks/IO turns, not a timing assumption about network completion.
async function settle() { for (let i = 0; i < 8; i++) await new Promise<void>(r => setImmediate(r)); }

test('snapshot starting/refused explicitly admits once before reading data, with fresh capabilities',async()=>{
  for(const state of ['starting','refused']){
    const calls:string[]=[];let admitted=false;
    const result=await source.readList({serviceRequest:async q=>{
      calls.push(q.path);
      if(q.path==='/v1/setup'){admitted=true;return response(setupRead());}
      if(q.path==='/health')return response(admitted?{...HEALTH,state:'ready'}:{...failedHealth('storage'),state});
      return response(plansPage([row]));
    }},{session:'A'});
    assert.ok(result.ok&&result.read);assert.deepEqual(calls,['/health','/v1/setup','/health','/v1/plans']);
  }
});

test('snapshot admission refusal and proxy errors never authorize plans or create a retry loop',async()=>{
  for(const failure of ['refused','proxy','unconfigured']){
    const calls:string[]=[];
    const result=await source.readList({serviceRequest:async q=>{
      calls.push(q.path);
      if(q.path==='/v1/setup')return failure==='proxy'?response({error:'storage'},503):response(setupRead());
      return response(calls.length===1?{...HEALTH_UNCONFIGURED,state:'starting'}:failure==='unconfigured'?{...HEALTH_UNCONFIGURED,state:'unconfigured'}:{...failedHealth('corrupt'),state:'refused'});
    }},{session:'A'});
    assert.deepEqual(calls,failure==='proxy'?['/health','/v1/setup']:['/health','/v1/setup','/health']);
    if(failure==='unconfigured')assert.ok(result.ok&&result.read===null);else assert.equal(result.ok,false);
  }
});

test('readList classifies health-reported store failures; only /health is called', async () => {
  for (const [code, kind] of [['corrupt', 'damaged'], ['schema', 'incompatible'], ['busy', 'busy'], ['storage', 'unavailable']] as const) {
    const calls: GuestRequest[] = [];
    const result = await source.readList({ serviceRequest: async q => { calls.push(q); return response(failedHealth(code)); } }, { session: 'A' });
    assert.equal(result.ok, false, code);
    assert.deepEqual(result.ok === false && { kind: result.failure.kind, code: result.failure.code }, { kind, code }, code);
    assert.match(result.ok === false ? result.failure.message : '', new RegExp(`store as ${code}`), code);
    assert.deepEqual(calls.map(q => q.path), ['/health'], code);
    const unscoped = await source.readList({ serviceRequest: async () => response(failedHealth(code)) }, null);
    assert.equal(unscoped.ok === false && unscoped.failure.kind, kind, code);
  }
});

test('readList classifies a configured binding failure as unavailable with identity copy', async () => {
  const calls: GuestRequest[] = [];
  const result = await source.readList({ serviceRequest: async q => { calls.push(q); return response(failedHealth('binding')); } }, { session: 'A' });
  assert.equal(result.ok, false);
  assert.deepEqual(result.ok === false && { kind: result.failure.kind, code: result.failure.code }, { kind: 'unavailable', code: 'binding' });
  assert.match(result.ok === false ? result.failure.message : '', /configured store does not match this installation/);
  assert.deepEqual(calls.map(q => q.path), ['/health']);
});

test('schema diagnostics and 503 replies render incompatible copy; host failure stays unavailable', async () => {
  let banner: {title:string;body:string}|undefined;
  const components:any={};
  runInNewContext(ts.transpileModule(readFileSync(new URL('../../ui/shared/components.ts',import.meta.url),'utf8'),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
  }).outputText,{
    exports:components,
    document:{createElement:()=>({dataset:{},setAttribute(){}})},
    require:(name:string)=>name==='@openchamber/sdk/ui'?{mountBanner:(_slot:unknown,value:typeof banner)=>{banner=value;}}:name==='./i18n.ts'?i18n:{},
  });
  for(const [reply,kind] of [
    [response(failedHealth('schema')),'incompatible'],
    [response({error:'schema'},503),'incompatible'],
    [response({error:'SERVICE_FAILED',message:"The extension's service failed to start."},502),'unavailable'],
  ] as const){
    const result=await source.readList({serviceRequest:async()=>reply},{session:'A'});
    assert.equal(result.ok,false);if(result.ok)throw Error('expected refusal');
    assert.equal(result.failure.kind,kind);
    const block=components.failureBlock(result.failure,()=>{});
    assert.equal(block.dataset.testid,`state-${kind}`);
    assert.equal(banner!.title,components.FAILURE_COPY[kind].title);
    assert.equal(banner!.body,components.FAILURE_COPY[kind].body);
    assert.equal(banner!.title,kind==='incompatible'?'Progress data needs an update':'Progress service is not responding');
    assert.equal(banner!.body,kind==='incompatible'?'The progress store uses a format this view does not support. Update the extension and its companion.':'It may still be starting. Try again in a moment.');
  }
});

test('readList keeps the unconfigured null read byte-compatible', async () => {
  const calls: GuestRequest[] = [];
  const result = await source.readList({ serviceRequest: async q => { calls.push(q); return response(HEALTH_UNCONFIGURED); } }, { session: 'A' });
  assert.equal(result.ok, true);
  assert.equal(result.ok === true && result.read, null);
  assert.equal(result.ok === true && result.health.ready, false);
  assert.deepEqual(result.ok === true && result.health.diagnostics, ['targets-unverified']);
  assert.deepEqual(calls.map(q => q.path), ['/health']);
});

type Ui = { sessionFilter: string; archived: boolean; selected: string | null };
/** Execute the actual shared controller (session-context harness shape). */
function controller() {
  const listeners: Record<string, (value?: any) => void> = {};
  const requests: GuestRequest[] = [];
  let expanded = false, disclosure = false;
  const node = () => ({ dataset: {} as Record<string, string>, firstElementChild: null as any,
    querySelector: () => null, querySelectorAll: () => [], getAnimations: () => [], setAttribute() {}, append() {},
    replaceChildren(child: any) { this.firstElementChild = child; expanded = disclosure = false; },
  });
  const mount = node();
  const document = { documentElement: node(), head: node(), visibilityState: 'visible', activeElement: null,
    getElementById: (id: string) => id === 'root' ? mount : {}, addEventListener() {}, scrollingElement: { scrollTop: 0 } };
  let handler = async (q: GuestRequest): Promise<GuestRequestResult> => {
    if (q.path === '/health') return response(HEALTH);
    if (q.path === '/v1/setup') return response(setupRead());
    if (q.path === '/v1/plans') return response(plansPage(!q.query?.session || q.query.session === 'A' ? [row] : []));
    if (q.path === '/v1/plan') return response(planPage(row, items, []));
    if (q.path === '/v1/document') return response({ ...envelope(), document: docRef(), text: 'Recorded document', nextCursor: null });
    if (q.path === '/v1/history') return response({ ...envelope(), data: [], nextCursor: null });
    return response({ error: 'not-found' }, 404);
  };
  const host = { serviceRequest: (q: GuestRequest) => { requests.push(q); return handler(q); }, storage: { get: async () => undefined, set: async () => {}, delete: async () => {} },
    onItem() { return () => {}; },
    onConnection() { return () => {}; },
    onReady: (fn: any) => { listeners.ready = fn; }, onSession: (fn: any) => { listeners.session = fn; }, onDirectory: (fn: any) => { listeners.directory = fn; } };
  const exports: any = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL('../../ui/shared/app.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, document, window: { addEventListener: (name: string, fn: any) => { listeners[name] = fn; } },
    AbortController, queueMicrotask, performance, console, setTimeout: () => 1, clearTimeout() {},
    require: (name: string) => {
      if (name === '@openchamber/sdk') return { connectHost: () => host };
      if (name === '@openchamber/sdk/ui') return { applyHostReady() {} };
      if (name === './source.ts') return source;
      if (name === './change-digest-checkpoint.ts') return checkpoint;
      if (name === './cleanup.ts') return cleanup;
      if (name === './refresh.ts') return refresh;
      if (name === './path.ts') return path;
      if (name === './language.ts') return language;
      if (name === './session-context.ts') return sessionContext;
      if (name === './components.ts') return { el: node, refreshLabels() {}, retireReadingUi() {}, beginInfoPaint() {}, commitInfoPaint() {} };
      if (name === './live.ts') return { LiveWorkspace: class { snapshot = EMPTY_LIVE; sessionSubscriptionCount = 0; start() {} restart() {} want() {} dispose() {} } };
      if (name === './official.ts') return { OfficialMainState: class { check = async () => ({ next: null, apply: () => false }); } };
      return {};
    },
  });
  let vc!: ViewContext<Ui>;
  const spec: ViewSpec<Ui> = {
    surface: 'panel', maxSessionSubscriptions: 2,
    initialUi: () => ({ sessionFilter: 'all', archived: false, selected: null }),
    scope: ({ session }) => contextListScope(session?.id ?? null, null),
    wantProjects: () => [], wantDetails: c => c.read?.plans.slice(0, 1) ?? [],
    actionPlan: c => c.read?.plans[0] ?? null,
    paint: (_root, value) => { vc = value; },
  };
  exports.startView(spec);
  return { requests, get vc() { return vc; },
    intercept: (fn: (q: GuestRequest, next: () => Promise<GuestRequestResult>) => Promise<GuestRequestResult>) => { const next = handler; handler = q => fn(q, () => next(q)); },
    ready: (id: string | null) => listeners.ready({ session: id ? { id } : id, directory: '/fixture/Alpha', connection: { account: 'fixture' }, locale: 'en', surface: spec.surface } as HostReadyContext),
    stop: () => listeners.pagehide(),
  };
}

test('fresh surface shows the damaged failure, not the setup form, for a corrupt store', async () => {
  const c = controller();
  c.intercept(async (q, next) => q.path === '/health' ? response(failedHealth('corrupt')) : q.path === '/v1/plans' ? response({ error: 'corrupt' }, 503) : next());
  c.ready('A'); await settle();
  assert.equal(c.vc.read as unknown, null);
  assert.equal(c.vc.failure?.kind, 'damaged'); assert.equal(c.vc.failure?.code, 'corrupt');
  assert.equal(c.vc.lastGoodAt, null);
  assert.equal(c.requests.some(q => q.path === '/v1/plans'), false);
  c.stop();
});

test('cached data is retained and marked stale-damaged when the store breaks between refreshes', async () => {
  const c = controller();
  c.ready('A'); await settle();
  assert.equal(c.vc.read?.plans[0]?.id, 'P-A'); assert.ok(c.vc.lastGoodAt); assert.equal(c.vc.failure, null);
  c.intercept(async (q, next) => q.path === '/health' ? response(failedHealth('corrupt')) : q.path === '/v1/plans' ? response({ error: 'corrupt' }, 503) : next());
  const mark = c.requests.length; c.vc.retry(); await settle();
  assert.equal(c.vc.read?.plans[0]?.id, 'P-A');
  assert.ok(c.vc.lastGoodAt);
  // Re-widen: the healthy-state assertion above narrows the same property path.
  const failure = c.vc.failure as ReadFailure | null;
  assert.equal(failure?.kind, 'damaged'); assert.equal(failure?.code, 'corrupt');
  assert.equal(c.requests.slice(mark).some(q => q.path === '/v1/plans'), false);
  c.stop();
});

test('configured binding failure shows a fresh failure, not the setup form, and stays stale on cached data', async () => {
  const broken = () => response(failedHealth('binding'));
  const fresh = controller();
  fresh.intercept(async (q, next) => q.path === '/health' ? broken() : next());
  fresh.ready('A'); await settle();
  assert.equal(fresh.vc.read as unknown, null);
  assert.equal(fresh.vc.failure?.kind, 'unavailable'); assert.equal(fresh.vc.failure?.code, 'binding');
  assert.equal(fresh.requests.some(q => q.path === '/v1/plans'), false);
  fresh.stop();

  const cached = controller();
  cached.ready('A'); await settle();
  assert.equal(cached.vc.read?.plans[0]?.id, 'P-A'); assert.ok(cached.vc.lastGoodAt); assert.equal(cached.vc.failure, null);
  cached.intercept(async (q, next) => q.path === '/health' ? broken() : next());
  cached.vc.retry(); await settle();
  assert.equal(cached.vc.read?.plans[0]?.id, 'P-A');
  assert.ok(cached.vc.lastGoodAt);
  // Re-widen: the healthy-state assertion above narrows the same property path.
  const failure = cached.vc.failure as ReadFailure | null;
  assert.equal(failure?.kind, 'unavailable'); assert.equal(failure?.code, 'binding');
  cached.stop();
});

test('unconfigured health still reads as the setup-needed state, without store calls', async () => {
  const c = controller();
  c.intercept(async (q, next) => q.path === '/health' ? response(HEALTH_UNCONFIGURED) : next());
  c.ready('A'); await settle();
  assert.equal(c.vc.read as unknown, null);
  assert.equal(c.vc.failure, null);
  assert.equal(c.vc.health?.ready, false);
  assert.equal(c.requests.some(q => q.path === '/v1/plans'), false);
  c.stop();
});
