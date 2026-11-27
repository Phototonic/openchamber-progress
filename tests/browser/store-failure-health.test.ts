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
import { appCountsModules } from './app-counts-stub.ts';
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
import {parseSetup,parseLastAction} from '../../ui/shared/adapter.ts';
import {lastMigrationText} from '../../ui/shared/setup.ts';
import {managedStepCall, StepDriver} from '../../ui/shared/setup-steps.ts';
import {freshEngine} from './managed-migration-engine.ts';

const items = [{ id: 'task', title: 'Reported work', kind: 'task' as const, status: 'working' as const }];
const row = summary('P-A', items, { sessionId: 'A', document: docRef() });
const response = (value: unknown, status = 200): GuestRequestResult => ({ status, body: JSON.stringify(value) });
const failedHealth = (code: string) => ({ ...HEALTH, ready: false, sqlite: false, diagnostics: [code] });
// Drain microtasks/IO turns, not a timing assumption about network completion.
async function settle() { for (let i = 0; i < 8; i++) await new Promise<void>(r => setImmediate(r)); }

test('concurrent starting readList calls tolerate only Setup worker contention and reread health',async()=>{
  let setupCalls=0,healthCalls=0;
  let release!:()=>void;
  const held=new Promise<void>(resolve=>{release=resolve;});
  const host={serviceRequest:async(q:GuestRequest)=>{
    if(q.path==='/health'){healthCalls++;return response({...HEALTH_UNCONFIGURED,state:'starting'});}
    assert.equal(q.path,'/v1/setup');
    if(++setupCalls===1){await held;return response(setupRead());}
    if(setupCalls===3)release();
    return response({error:'managed-step-unsettled'},503);
  }};
  const results=await Promise.all(Array.from({length:3},()=>source.readList(host,{})));
  assert.ok(results.every(r=>r.ok&&r.read===null),JSON.stringify(results));
  assert.equal(setupCalls,3);assert.equal(healthCalls,6,'one follow-up health read per surface, no retry loop');
});

test('startup contention fallback preserves every other error and the follow-up health verdict',async()=>{
  for(const initial of ['starting','refused'])for(const [status,code] of [[503,'managed-step-unsettled'],[409,'managed-step-unsettled'],[503,'private-permissions']] as const){
    const calls:string[]=[];
    const result=await source.readList({serviceRequest:async q=>{
      calls.push(q.path);
      return q.path==='/health'?response({...HEALTH_UNCONFIGURED,state:initial}):response({error:code},status);
    }},{});
    const tolerated=initial==='starting'&&status===503&&code==='managed-step-unsettled';
    assert.equal(result.ok,tolerated);
    assert.deepEqual(calls,tolerated?['/health','/v1/setup','/health']:['/health','/v1/setup']);
    if(!result.ok)assert.equal(result.failure.code,code);
  }
  for(const next of ['starting','unconfigured','ready','refused','unsettled','mixed']){
    let healthCalls=0;
    const calls:string[]=[];
    const result=await source.readList({serviceRequest:async q=>{
      calls.push(q.path);
      if(q.path==='/v1/setup')return response({error:'managed-step-unsettled'},503);
      if(q.path==='/v1/plans')return response(plansPage([row]));
      return response(++healthCalls===1?{...HEALTH_UNCONFIGURED,state:'starting'}:
        next==='ready'?{...HEALTH,state:next}:next==='refused'?{...failedHealth('private-permissions'),state:next}:
          next==='unsettled'||next==='mixed'?{...failedHealth('managed-step-unsettled'),state:'refused',...(next==='mixed'?{diagnostics:['managed-step-unsettled','private-permissions']}:{})}:{...HEALTH_UNCONFIGURED,state:next});
    }},{});
    assert.equal(result.ok,next!=='refused'&&next!=='mixed');
    if(result.ok)assert.equal(result.read!==null,next==='ready');
    else assert.equal(result.failure.code,next==='mixed'?'managed-step-unsettled':'private-permissions');
    assert.deepEqual(calls,next==='ready'?['/health','/v1/setup','/health','/v1/plans']:['/health','/v1/setup','/health']);
  }
});

test('snapshot starting/refused explicitly admits once before reading data, with fresh capabilities',async()=>{
  for(const state of ['starting','refused'])for(const intent of [false,true]){
    const calls:GuestRequest[]=[];let admitted=false;
    const result=await source.readList({serviceRequest:async q=>{
      calls.push(q);
      if(q.path==='/v1/setup'){admitted=true;return response(setupRead());}
      if(q.path==='/health')return response(admitted?{...HEALTH,state:'ready',needsYouInbox:1,delegationIntent:1}:{...failedHealth('storage'),state});
      return response(plansPage([row]));
    }},{session:'A'},10,{demand:'rows',mono:()=>123},intent);
    assert.ok(result.ok&&result.read);assert.deepEqual(calls.map(q=>q.path),['/health','/v1/setup','/health','/v1/plans']);
    assert.equal(result.health.needsYouInbox,1);assert.equal(result.health.delegationIntent,1);assert.equal(result.inbox?.state,'missing');
    assert.equal(calls[3].query?.needsYou,'1');assert.equal(calls[3].query?.needsYouTiming,'1');
    assert.equal(calls[3].query?.delegationIntent,intent?'1':undefined);
  }
});

test('every refused security/binding state is a failure, never a setup-needed success',async()=>{
  for(const code of ['managed-binding-modified','managed-binding-invalid','windows-security-unavailable','private-permissions','path-unverified','unsafe-parent','symlink-escape','managed-scope-unsupported']){
    const calls:string[]=[];
    const r=await source.readList({serviceRequest:async q=>{calls.push(q.path);return response(q.path==='/health'?{...failedHealth(code),state:'refused'}:setupRead());}},null);
    assert.equal(r.ok,false,code);assert.equal(!r.ok&&r.failure.code,code);
    assert.deepEqual(calls,['/health','/v1/setup','/health']);
  }
});

test('Setup retains fixed stage/code on status and failed HTTP actions, with actionable localized copy',async()=>{
  for(const code of ['private-permissions','unsafe-parent','symlink-escape','windows-security-unavailable','path-unverified','EACCES','EPERM','EBUSY','EIO','ENOSPC']){
    const lastAction={stage:'migration-record' as const,code};
    assert.deepEqual(parseSetup(JSON.stringify({...setupRead(),lastAction})).lastAction,lastAction);
    const r=await source.setupCall({serviceRequest:async()=>response({error:code,lastAction},503)},'managed-migrate',null,true,'a'.repeat(64));
    assert.ok(!r.ok);assert.deepEqual(r.lastAction,lastAction);
    assert.match(lastMigrationText(lastAction),/Last migration attempt failed: migration-record/);
    assert.match(lastMigrationText(lastAction,'ru'),/Последняя попытка переноса не удалась/);
    assert.notEqual(lastMigrationText(lastAction),lastMigrationText(lastAction,'ru'));
  }
  for(const lastAction of [{stage:'raw /private/path',code:'EACCES'},{stage:'lock',code:'private-secret'},{stage:'lock',code:42}])assert.equal(parseLastAction(JSON.stringify({lastAction})),undefined);
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

test('a responding Setup conflict keeps its diagnostic and never reads plans', async () => {
  const code = 'managed-migration-conflict';
  for (const [setupStatus, diagnostic, kind] of [
    [200, code, 'setup-refused'], [409, code, 'setup-refused'], [503, 'storage', 'unavailable'],
    [200, 'unexpected-code', 'unavailable'], [200, 'busy', 'busy'], [200, 'corrupt', 'damaged'], [200, 'schema', 'incompatible'],
  ] as const) {
    const calls: string[] = [];
    const r = await source.readList({ serviceRequest: async q => {
      calls.push(q.path);
      if (q.path === '/v1/setup') return setupStatus === 200 ? response(setupRead()) : response({ error: diagnostic }, setupStatus);
      assert.equal(q.path, '/health');
      return response({ ...failedHealth(diagnostic), state: 'refused' });
    } }, {});
    assert.ok(!r.ok);
    assert.equal(r.failure.kind, kind);
    assert.equal(r.failure.code, diagnostic);
    assert.deepEqual(calls, ['/health', '/v1/setup', ...(setupStatus === 200 ? ['/health'] : [])]);
  }
  const routes: string[] = [];
  const proxy = await source.readList({ serviceRequest: async q => {
    routes.push(q.path);
    return response({ error: code }, 503);
  } }, {});
  assert.ok(!proxy.ok);
  assert.equal(proxy.failure.kind, 'unavailable', 'an HTTP error outside Setup admission is not a Setup diagnosis');
  assert.deepEqual(routes, ['/health']);
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
    assert.equal(banner!.title,kind==='incompatible'?'Progress data needs an update':'Progress is not responding');
    assert.equal(banner!.body,kind==='incompatible'?'Update Agent Progress in OpenChamber.':'Try again in a moment.');
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
      if (name in appCountsModules) return appCountsModules[name];
      if (name === '@openchamber/sdk') return { connectHost: () => host };
      if (name === '@openchamber/sdk/ui') return { applyHostReady() {} };
      if (name === './phone-layout.ts') return { applyDeviceHooks() {} }; // presentation-only hook; phone-layout.test.ts covers the real module
      if (name === './source.ts') return source;
      if (name === './setup.ts') return { retireSetupSteps() {} };
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

test('fresh Setup review waits for its own status read and excludes passive reads until the action replies', async () => {
  const c = controller();
  const engine = freshEngine();
  const releaseStep = engine.hold(1);
  let releaseStatus!: () => void;
  const status = new Promise<void>(resolve => { releaseStatus = resolve; });
  let statusInFlight = false, holdStatus = false;
  const stepPath = '/v1/setup/managed-step';
  const driver = new StepDriver({
    send: (request, current) => managedStepCall(c.vc.service(current), request),
    context: () => 'synthetic', changed() {}, refresh() { c.vc.requestSetup(); },
  });
  driver.observe('synthetic', 'synthetic');
  try {
    c.intercept(async (q, next) => {
      if (q.path === '/health') return response(HEALTH_UNCONFIGURED);
      if (q.path === '/v1/setup' && holdStatus) {
        statusInFlight = true;
        await status;
        statusInFlight = false;
      }
      if (q.path !== stepPath) return next();
      if (statusInFlight) return response({version: 2, disposition: 'refused', progress: null, inspection: null,
        error: {stage: 'lock', code: 'managed-step-unsettled'}, accounting: {securitySpawns: 0, elapsedMs: 0}}, 503);
      return engine.host.serviceRequest(q);
    });
    c.ready('A'); await settle();
    holdStatus = true;
    c.vc.requestSetup(); // More → Setup, retaining the previously displayed status
    assert.equal(statusInFlight, true);
    const review = driver.inspect('begin', {family: 'fresh'});
    await settle();
    assert.equal(driver.state.outcome?.code, undefined, 'the panel’s own status read must not cause a refusal');
    assert.equal(c.requests.filter(q => q.path === stepPath).length, 0);

    holdStatus = false;
    releaseStatus();
    await settle();
    assert.equal(engine.requests.length, 1);
    const mark = c.requests.length;
    c.vc.requestSetup();
    assert.equal(c.requests.slice(mark).some(q => q.path === '/v1/setup'), false);
    releaseStep();
    await review;
    assert.equal(driver.state.review?.kind, 'begin');
    assert.equal(c.requests.filter(q => q.path === stepPath).length, 1, 'no action retry');
  } finally {
    releaseStatus();
    releaseStep();
    c.stop();
  }
});

test('fresh Setup review still surfaces an unsettled refusal from another caller', async () => {
  const c = controller();
  const stepPath = '/v1/setup/managed-step';
  try {
    c.intercept(async (q, next) => q.path === stepPath
      ? response({version: 2, disposition: 'refused', progress: null, inspection: null,
        error: {stage: 'lock', code: 'managed-step-unsettled'}, accounting: {securitySpawns: 0, elapsedMs: 0}}, 503)
      : next());
    c.ready('A'); await settle();
    const driver = new StepDriver({
      send: (request, current) => managedStepCall(c.vc.service(current), request),
      context: () => 'synthetic', changed() {}, refresh() { c.vc.requestSetup(); },
    });
    driver.observe('synthetic', 'synthetic');
    await driver.inspect('begin', {family: 'fresh'});
    assert.equal(driver.state.review, null);
    assert.deepEqual(driver.state.outcome, {code: 'managed-step-unsettled', stage: 'lock', uncertain: false});
    assert.equal(c.requests.filter(q => q.path === stepPath).length, 1);
  } finally { c.stop(); }
});

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

test('last-good panel data stays stale when the service refuses Setup', async () => {
  const c = controller();
  try {
    c.ready('A'); await settle();
    const lastGood = c.vc.lastGoodAt;
    assert.ok(lastGood);
    c.intercept(async (q, next) => q.path === '/health' ? response({ ...failedHealth('managed-migration-conflict'), state: 'refused' }) : next());
    const mark = c.requests.length;
    c.vc.retry(); await settle();
    assert.equal(c.vc.read?.plans[0]?.id, 'P-A');
    assert.equal(c.vc.lastGoodAt, lastGood);
    assert.equal(c.vc.failure?.kind, 'setup-refused');
    assert.equal(c.vc.failure?.code, 'managed-migration-conflict');
    assert.deepEqual(c.requests.slice(mark).map(q => q.path), ['/health', '/v1/setup', '/health']);
  } finally { c.stop(); }
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
