import http from 'node:http';
import path from 'node:path';
import { MENTIONS_SEARCH_PATH, MENTIONS_RESOLVE_PATH } from '@openchamber/sdk';
import { mentionBody, searchMentions, resolveMention } from './mentions.ts';
import { GRAPH_LIMITS } from '../shared/plan-graph.ts';
import { RUN_LIMITS, parseReconcileBody, parseDismissLossBody, type RunRequest } from '../shared/subagent-runs.ts';
import { parseCaptureBinding } from '../shared/document-captures.ts';
import { CAPTURE_LIMITS } from '../shared/document-comparison.ts';
import { timingSafeEqual } from 'node:crypto';
import { VERSION, LIMITS, ProgressError, identifier, type Code } from '../shared/progress.ts';
import { Store, storageError } from '../shared/store.ts';
import { SetupError, type Action } from '../setup/lifecycle.ts';
import { ManagedBindingError } from '../shared/managed-binding.ts';
import { platformErrorCode,writerTarget } from '../shared/platform.ts';
import type { ManagedSetupAction } from '../shared/progress.ts';
import type { SetupController } from './setup-controller.ts';
import { taskTiming } from './task-timing.ts';
import { blockedTiming } from './blocked-timing.ts';
import { RELEASE } from '../shared/release.ts';
import { parseCleanup } from '../shared/cleanup.ts';
import { SEARCH_LIMITS, type SearchOptions, type SearchKey } from '../shared/progress.ts';
import {MANAGED_STEP_ROUTE,MANAGED_STEP_LIMITS,managedSetupStepRequest,type ManagedSetupStepResponse,type ManagedStepDiagnostic,type ManagedFreshStepDiagnostic} from '../shared/managed-steps.ts';
import {withSetupWriter} from './request-worker.ts';
import {managedDiagnostic} from '../setup/managed-diagnostic.ts';
import { needsYou } from './needs-you.ts';
import { NEEDS_YOU_LIMITS, type NeedsYouRequest } from '../shared/needs-you.ts';
import { delegationView } from './delegation-view.ts';

// Both step envelopes and compatibility routes retain the same setup refusals.
// In particular the retained configuration lock is a conflict, not worker busy.
const SETUP_HTTP_STATUS=new Map<string,number>([
  ...['invalid','confirmation-required','targets-unverified'].map(code=>[code,400] as const),
  ['not-found',404],
  ...['managed-step-conflict','managed-step-unsupported','managed-step-limit','managed-journal-unsupported','managed-inspection-expired',
    'managed-review-stale','managed-selection-conflict','managed-source-conflict','managed-migration-required','managed-migration-conflict','managed-migration-pending',
    'managed-action-required','managed-service-required','managed-configuration-busy','managed-path-unverified','managed-scope-unsupported',
    'managed-binding-invalid','managed-binding-modified','ownership-invalid','modified-owned-files','foreign-files','collision','schema','binding','source-unverified'].map(code=>[code,409] as const),
]);
export function managedStepHttpStatus(code:string):number {return SETUP_HTTP_STATUS.get(code)??503;}

/** Only fixed read/control routes. No store path, token or SQL from request bodies. */
export function createProgressServer(store: Store | undefined, token: string, unavailableCode?: Code, setup?: SetupController) {
  if (!token) throw new ProgressError('binding');
  const expected = Buffer.from(`Bearer ${token}`);
  // Explicit Store injection is used by standalone callers, not managed main.
  // Capture capabilities once here too; the health handler itself does no I/O.
  let standaloneRuns=false,standaloneError=unavailableCode;
  if(!setup&&store)try{standaloneRuns=['current','previous'].includes(store.subagentRunStorage());}catch(e){standaloneError=storageError(e).code;}
  const server = http.createServer({maxHeaderSize:32*1024},async (req,res) => {
    function answer(status: number, body: unknown) {
      let text = JSON.stringify(body);
      if (Buffer.byteLength(text) > LIMITS.responseBytes) { status=413;text=JSON.stringify({error:'response-too-large'}); }
      res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}); res.end(text);
    }
    const supplied = Buffer.from(req.headers.authorization ?? '');
    if (supplied.length !== expected.length || !timingSafeEqual(supplied,expected)) return answer(401,{error:'unauthorized'});
    const admittedAt=process.hrtime.bigint();
    let stepRoute=false,stepVersion:1|2=1,stepStage:ManagedStepDiagnostic['stage']|ManagedFreshStepDiagnostic['stage']='journal';
    const stepRefusal=(code:string,accounting={securitySpawns:0,elapsedMs:Number(process.hrtime.bigint()-admittedAt)/1_000_000})=>
      answer(managedStepHttpStatus(code),{version:stepVersion,disposition:'refused',inspection:null,progress:null,error:{stage:stepStage,code},accounting} as ManagedSetupStepResponse);
    let cleanupRoute=false, digestRoute=false, searchRoute=false, comparisonRoute=false, runsRoute=false, graphRoute=false, mentionRoute=false, inboxRoute=false, delegationRoute=false;
    try {
      const url = new URL(req.url ?? '/','http://127.0.0.1');
      delegationRoute=url.searchParams.has('delegationIntent');
      mentionRoute=url.pathname===MENTIONS_SEARCH_PATH||url.pathname===MENTIONS_RESOLVE_PATH;
      if(mentionRoute){
        if(url.origin!=='http://127.0.0.1')return answer(404,{error:'not-found'});
        if(req.method!=='POST')return answer(405,{error:'method-not-allowed'});
        if(url.search)throw new ProgressError('invalid');
        let size=0;const chunks:Buffer[]=[];
        for await(const chunk of req){const b=Buffer.from(chunk);size+=b.length;if(size>LIMITS.requestBytes){req.resume();return answer(413,{error:'request-too-large'});}chunks.push(b);}
        let text:string;try{text=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));}catch{throw new ProgressError('invalid');}
        const search=url.pathname===MENTIONS_SEARCH_PATH,body=mentionBody(text,search?'search':'resolve');
        const active=setup?await setup.currentForRequest():{store,error:unavailableCode};if(!active.store)return answer(503,{error:active.error??'storage'});
        const alive=()=>!req.aborted&&!req.socket.destroyed&&!res.destroyed;
        // Resolve pages across awaits; take the current Store per page because a concurrent request may have reopened it.
        let held:Store|undefined=active.store;
        const acquire=()=>{const s=held??(setup?setup.current().store:store);held=undefined;if(!s)throw new ProgressError('storage');return s;};
        return answer(200,search?searchMentions(active.store,body.query as string,body.directory as string|null,alive):await resolveMention(acquire,body.id as string,alive));
      }
      graphRoute=url.pathname==='/v1/plan-graph';
      inboxRoute=url.pathname==='/v1/needs-you'||url.searchParams.has('needsYou');
      if(graphRoute&&req.method!=='GET')return answer(405,{error:'method-not-allowed'});
      runsRoute=['/v1/subagent-runs','/v1/subagent-runs/reconcile','/v1/subagent-runs/dismiss-loss'].includes(url.pathname);
      if(runsRoute) {
        if(url.origin!=='http://127.0.0.1')return answer(404,{error:'not-found'});
        const active=setup?await setup.currentForRequest():{store,error:unavailableCode};
        if(!active.store)return answer(503,{error:active.error??'storage'});
        if(url.pathname!=='/v1/subagent-runs') {
          if(req.method!=='POST')return answer(405,{error:'method-not-allowed'});
          if(url.search)return answer(404,{error:'not-found'});
          let size=0;const chunks:Buffer[]=[];
          for await(const chunk of req){const b=Buffer.from(chunk);size+=b.length;if(size>RUN_LIMITS.queryBytes){req.resume();return answer(413,{error:'request-too-large'});}chunks.push(b);}
          let text:string;try{text=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));}catch{throw new ProgressError('invalid');}
          return answer(200,url.pathname.endsWith('/dismiss-loss')?active.store.dismissRunLoss(parseDismissLossBody(text)):active.store.requestRunReconciliation(parseReconcileBody(text)));
        }
        if(req.method!=='GET')return answer(405,{error:'method-not-allowed'});
        if(req.headers['content-length']&&req.headers['content-length']!=='0'||req.headers['transfer-encoding'])return answer(400,{error:'body-not-allowed'});
        const allowed=['storeId','binding','source','root','plan','cleanupRev','view','cursor'];
        if([...url.searchParams.keys()].some(k=>!allowed.includes(k)||url.searchParams.getAll(k).length!==1))return answer(404,{error:'not-found'});
        if(Buffer.byteLength(url.search)>RUN_LIMITS.queryBytes)throw new ProgressError('invalid');
        const r=Object.fromEntries(url.searchParams) as unknown as RunRequest;
        r.binding=parseCaptureBinding(url.searchParams.get('binding'));
        if(url.searchParams.has('cleanupRev')){const v=url.searchParams.get('cleanupRev')!;if(!/^\d{1,16}$/.test(v)||!Number.isSafeInteger(Number(v)))throw new ProgressError('invalid');r.cleanupRev=Number(v);}
        return answer(200,active.store.subagentRuns(r));
      }
      comparisonRoute=['/v1/document-captures','/v1/document-comparison'].includes(url.pathname);
      if(comparisonRoute&&req.method!=='GET')return answer(405,{error:'method-not-allowed'});
      digestRoute=url.pathname==='/v1/change-digest';
      searchRoute=url.pathname==='/v1/search'||url.pathname==='/v1/search-state';
      if (url.origin !== 'http://127.0.0.1') return answer(404,{error:'not-found'});
      if(searchRoute&&req.method!=='GET')return answer(405,{error:'method-not-allowed'});
      cleanupRoute=['/v1/plan/archive','/v1/plan/restore','/v1/plan/delete'].includes(url.pathname);
      if(cleanupRoute) {
        if(req.method!=='POST')return answer(405,{error:'method-not-allowed'});
        if(url.search)return answer(404,{error:'not-found'});
        let size=0;const chunks:Buffer[]=[];
        for await(const chunk of req){const b=Buffer.from(chunk);size+=b.length;if(size>LIMITS.requestBytes){req.resume();return answer(413,{error:'request-too-large'});}chunks.push(b);}
        let body:unknown;try{body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}catch{throw new ProgressError('invalid');}
        const action=url.pathname.endsWith('/archive')?'archive':url.pathname.endsWith('/restore')?'restore':'delete';
        const request=parseCleanup(action,body);
        const active=setup?await setup.currentForRequest():{store,error:unavailableCode};
        if(!active.store)return answer(503,{error:active.error??'storage'});
        return answer(200,active.store.cleanup(action,request));
      }
      if(url.pathname==='/v1/extension-update') {
        if(req.method!=='GET')return answer(405,{error:'method-not-allowed'});
        if(url.search)return answer(404,{error:'not-found'});
        if(req.headers['content-length']&&req.headers['content-length']!=='0'||req.headers['transfer-encoding'])return answer(400,{error:'body-not-allowed'});
        // Compatibility backoff for old guests, not a scheduled remote check.
        return answer(200,{installedVersion:RELEASE,repository:'Phototonic/openchamber-progress',ref:'main',
          state:'unknown',checkedAt:null,stale:false,diagnostic:'unavailable',nextCheckAt:new Date(Date.now()+3_600_000).toISOString()});
      }
      if(url.pathname==='/v1/setup'||url.pathname.startsWith('/v1/setup/')) {
        if(url.search)return answer(404,{error:'not-found'});
        if(!setup)return answer(503,{error:'setup-unavailable'});
        if(url.pathname==='/v1/setup') {
          if(req.method!=='GET')return answer(405,{error:'method-not-allowed'});
          if(req.headers['content-length']&&req.headers['content-length']!=='0'||req.headers['transfer-encoding'])return answer(400,{error:'body-not-allowed'});
          if(!setup.managed)return answer(200,setup.status(true));
          const reply=await setup.request({action:'status'},admittedAt);
          return reply.ok?answer(200,reply.value):answer(managedStepHttpStatus(reply.code),{error:reply.code});
        }
        const action=url.pathname.slice('/v1/setup/'.length);
        if(!['inspect','install','update','disable','enable','remove-capture','managed-inspect','managed-configure','managed-migrate','managed-enable','managed-disable','managed-step'].includes(action))return answer(404,{error:'not-found'});
        if(req.method!=='POST')return answer(405,{error:'method-not-allowed'});
        // Refuse old monolithic input before discovery, body parsing or workers.
        if(action==='managed-migrate'||process.platform==='win32'&&['managed-inspect','managed-configure'].includes(action)){
          req.resume();return answer(409,{error:'managed-action-required'});
        }
        stepRoute=url.pathname===MANAGED_STEP_ROUTE;
        let size=0;const chunks:Buffer[]=[];
        for await(const chunk of req){const b=Buffer.from(chunk);size+=b.length;if(size>(stepRoute?MANAGED_STEP_LIMITS.requestBytes:LIMITS.requestBytes)){req.resume();return answer(413,{error:'request-too-large'});}chunks.push(b);}
        let body:unknown;try{const text=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));body=text?JSON.parse(text):{};}catch{throw new ProgressError('invalid');}
        if(stepRoute){
          stepVersion=(body as {version?:unknown}|null)?.version===2?2:1;
          const parsed=managedSetupStepRequest(body);if(!parsed)return stepRefusal('invalid');
          stepStage=parsed.action==='begin'?'prepare':parsed.action==='advance'?parsed.step.name:parsed.action==='inspect'?'roots':parsed.action==='status'?'journal':'lock';
          const reply=await setup.request({action:'managed-step',body:parsed},admittedAt);
          if(!reply.ok){if(reply.refusal)return answer(managedStepHttpStatus(reply.code),reply.refusal);
            if(reply.code==='managed-step-port-busy'||reply.code==='managed-step-unsettled')stepStage='lock';return stepRefusal(reply.code,reply.accounting);}
          const value=reply.value as ManagedSetupStepResponse;
          return answer(value.error?managedStepHttpStatus(value.error.code):200,value);
        }
        // Fresh configuration retains the legacy single-request budget and
        // controller nonce. Hold both writer slots throughout, including review
        // validation, publication and cleanup; never bypass a running step.
        if(action==='managed-inspect'||action==='managed-configure')
          return answer(200,await withSetupWriter(()=>setup.runFreshManaged(action,body),setup.writerTargets(body)));
        return answer(200,await withSetupWriter(()=>setup.run(action as Action|ManagedSetupAction,body),setup.writerTargets(body)));
      }
      if (req.headers['content-length'] && req.headers['content-length'] !== '0' || req.headers['transfer-encoding']) return answer(400,{error:'body-not-allowed'});
      if (url.pathname === '/health') {
        if(req.method!=='GET')return answer(405,{error:'method-not-allowed'});
        if(url.search)return answer(404,{error:'not-found'});
        // Authenticated host liveness, not data admission. Never refresh, inspect
        // legacy ownership, or query SQLite to render a controller snapshot.
        if(!setup&&(!store||standaloneError))return answer(503,{error:standaloneError??'storage'});
        const snapshot=setup?setup.health():{state:'ready',ready:true,sqlite:true,diagnostics:[],subagentRuns:standaloneRuns};
        const {subagentRuns,...health}=snapshot;
        return answer(200,{ok:true,...health,...(setup?.managed?{managedMigrationSteps:1,managedFreshSteps:1}:{}),...(health.ready?{planComposerHandoff:1,planGraph:1,planCleanup:1,planCleanupActive:1,planChangeDigests:1,planTaskSearch:1,needsYouInbox:1,delegationIntent:1,documentCaptureComparison:1,...(subagentRuns?{subagentRuns:1}:{})}:{}),
          protocolVersion:VERSION,schemaVersion:VERSION,runtime:{node:process.versions.node,bun:process.versions.bun??null}});
      }
      if (url.pathname === '/v1/capture/disable' || url.pathname === '/v1/capture/enable') {
        if (req.method !== 'POST') return answer(405,{error:'method-not-allowed'});
        if (url.search) return answer(404,{error:'not-found'});
        const enabled=url.pathname.endsWith('/enable');
        if(setup?.managed){
          const reply=await setup.request({action:'capture',enabled},admittedAt);
          return reply.ok?answer(200,reply.value):answer(managedStepHttpStatus(reply.code),{error:reply.code});
        }
        return await withSetupWriter(()=>{
          const active=setup?setup.current():{store,error:unavailableCode};
          if(!active.store)return answer(503,{error:active.error??'storage'});
          if(setup&&enabled)setup.enableCapture();else active.store.setEnabled(enabled);
          return answer(200,{ok:true,captureEnabled:enabled});
        },setup?setup.writerTargets():store?[writerTarget('store',path.dirname(store.file))]:[]);
      }
      const active=setup?await setup.currentForRequest():{store,error:unavailableCode};const currentStore=active.store;
      if (req.method !== 'GET') return answer(405,{error:'method-not-allowed'});
      const routes: Record<string,string[]> = { '/v1/search':['q','source','session','lifecycle','status','archived','limit','cursor'], '/v1/search-state':['storeId','keys'], '/v1/change-digest':['storeId','source','plan','to','after','cleanupRev'], '/v1/plans':['cursor','limit','source','session','directory','archived'], '/v1/plan':['source','plan','cursor'], '/v1/document':['source','plan','cursor','capture'], '/v1/history':['source','plan','cursor','limit'] };
      routes['/v1/document-captures']=['storeId','binding','source','plan','cleanupRev','cursor'];
      routes['/v1/needs-you']=['storeId','binding','source','cursor','limit','timing'];
      routes['/v1/plans'].push('needsYou','needsYouTiming','delegationIntent');
      routes['/v1/search-state'].push('needsYou','needsYouTiming');
      routes['/v1/plan'].push('delegationIntent');
      routes['/v1/plan-graph']=['storeId','binding','source','plan','revision','cleanupRev'];
      routes['/v1/document-comparison']=['storeId','binding','source','plan','cleanupRev','before','after'];
      const allowed = routes[url.pathname];
      if (!allowed || [...url.searchParams.keys()].some(k => !allowed.includes(k) || url.searchParams.getAll(k).length !== 1)) return answer(404,{error:'not-found'});
      if(searchRoute && Buffer.byteLength(url.search)>SEARCH_LIMITS.queryBytes)throw new ProgressError('invalid');
      if(comparisonRoute && Buffer.byteLength(url.search)>CAPTURE_LIMITS.queryBytes)throw new ProgressError('invalid');
      if(graphRoute && Buffer.byteLength(url.search)>GRAPH_LIMITS.queryBytes)throw new ProgressError('invalid');
      if(inboxRoute && Buffer.byteLength(url.search)>NEEDS_YOU_LIMITS.queryBytes)throw new ProgressError('invalid');
      if(url.searchParams.has('needsYou') && url.searchParams.get('needsYou')!=='1')throw new ProgressError('invalid');
      if(url.searchParams.has('needsYouTiming') && (url.searchParams.get('needsYouTiming')!=='1' || !url.searchParams.has('needsYou')))throw new ProgressError('invalid');
      if(url.searchParams.has('delegationIntent') && url.searchParams.get('delegationIntent')!=='1')throw new ProgressError('invalid');
      const number = (key: string, fallback: number) => { const v = url.searchParams.get(key); if (v === null) return fallback; if (!/^\d{1,9}$/.test(v)) throw new ProgressError('invalid'); return Number(v); };
      const text = (key: string, required = false) => { const v = url.searchParams.get(key) ?? undefined; if (required && !v || v !== undefined && (key === 'directory' ? v.length > 4096 || v.includes('\0') : !identifier(v))) throw new ProgressError('invalid'); return v; };
      if(!currentStore)return answer(503,{error:active.error??'storage'});
      if(url.pathname==='/v1/needs-you') {
        const r:NeedsYouRequest={storeId:text('storeId',true)!,binding:parseCaptureBinding(url.searchParams.get('binding')),source:text('source',true)!};
        if(url.searchParams.has('cursor'))r.cursor=url.searchParams.get('cursor')!;
        if(url.searchParams.has('limit'))r.limit=number('limit',NEEDS_YOU_LIMITS.rows);
        if(url.searchParams.has('timing')){const value=url.searchParams.get('timing');if(value!=='0'&&value!=='1')throw new ProgressError('invalid');r.timing=value==='1';}
        return answer(200,needsYou(currentStore,r));
      }
      const summary = (value: {storeId:string;sourceBinding:NeedsYouRequest['binding']}) => {
        if(!url.searchParams.has('needsYou'))return {};
        if(!value.sourceBinding.verified||!value.sourceBinding.sourceId)return {};
        return {needsYou:needsYou(currentStore,{storeId:value.storeId,binding:value.sourceBinding,source:value.sourceBinding.sourceId,timing:url.searchParams.has('needsYouTiming')})};
      };
      if(url.pathname==='/v1/search') {
        const options=Object.fromEntries(url.searchParams) as SearchOptions;
        if(url.searchParams.has('limit'))options.limit=number('limit',20);
        return answer(200,currentStore.search(options));
      }
      if(url.pathname==='/v1/search-state') {
        let keys:SearchKey[];try{keys=JSON.parse(url.searchParams.get('keys')??'null');}catch{throw new ProgressError('invalid');}
        const state=currentStore.searchState(text('storeId',true)!,keys);
        return answer(200,{...state,...summary(state)});
      }
      if (url.pathname === '/v1/plans') {
        const archived=url.searchParams.get('archived')??'exclude';if(archived!=='exclude'&&archived!=='only')throw new ProgressError('invalid');
        const cursor=number('cursor',0);
        if(url.searchParams.has('needsYou')&&cursor!==0)throw new ProgressError('invalid');
        const list=currentStore.list({cursor,limit:number('limit',20),source:text('source'),session:text('session'),directory:text('directory'),archived});
        const data=url.searchParams.has('delegationIntent')?list.data.map(plan=>({...plan,delegationToken:delegationView(currentStore,list,plan).token})):list.data;
        return answer(200,{...list,data,...summary(list)});
      }
      const source = text('source',true)!; const plan = text('plan',true)!;
      if (graphRoute) {
        const pin = (key: string, min: number) => { const v=url.searchParams.get(key);if(v===null||!/^\d{1,16}$/.test(v)||!Number.isSafeInteger(Number(v))||Number(v)<min)throw new ProgressError('invalid');return Number(v); };
        return answer(200,currentStore.planGraph({storeId:text('storeId',true)!,binding:parseCaptureBinding(url.searchParams.get('binding')),source,plan,revision:pin('revision',1),cleanupRev:pin('cleanupRev',0)}));
      }
      if (comparisonRoute) {
        const integer = (key: string, min: number) => { const value=url.searchParams.get(key);if(value===null||!/^\d{1,16}$/.test(value)||!Number.isSafeInteger(Number(value))||Number(value)<min)throw new ProgressError('invalid');return Number(value); };
        const r={storeId:text('storeId',true)!,binding:parseCaptureBinding(url.searchParams.get('binding')),source,plan,cleanupRev:integer('cleanupRev',0)};
        return answer(200,url.pathname==='/v1/document-captures' ? currentStore.documentCaptures(r,url.searchParams.get('cursor')??undefined) : currentStore.documentComparison(r,integer('before',1),integer('after',1)));
      }
      if (digestRoute) {
        const revision = (key: string, minimum: number) => { const v=url.searchParams.get(key);if(v===null||!/^\d{1,16}$/.test(v)||!Number.isSafeInteger(Number(v))||Number(v)<minimum)throw new ProgressError('invalid');return Number(v); };
        return answer(200,currentStore.changeDigest({storeId:text('storeId',true)!,source,plan,to:revision('to',1),cleanupRev:revision('cleanupRev',0),...(url.searchParams.has('after')?{after:revision('after',1)}:{})}));
      }
      if (url.pathname === '/v1/plan') {
        const cursor=number('cursor',0);
        if(url.searchParams.has('delegationIntent')&&cursor!==0)throw new ProgressError('invalid');
        const detail=currentStore.detail(source,plan,cursor);
        const overlay=url.searchParams.has('delegationIntent')?delegationView(currentStore,detail,detail.plan).view:undefined;
        return answer(200,{...detail,timing:taskTiming(currentStore,detail),blockedTiming:blockedTiming(currentStore,detail),...(overlay?{delegationIntent:overlay}:{})});
      }
      if (url.pathname === '/v1/document') return answer(200,currentStore.document(source,plan,number('cursor',0),url.searchParams.has('capture')?number('capture',0):undefined));
      return answer(200,currentStore.history(source,plan,number('cursor',0),number('limit',20)));
    } catch (e) {
      if(stepRoute)return stepRefusal(managedDiagnostic(e));
      const workerCode=managedDiagnostic(e);
      if(workerCode==='managed-step-port-busy'||workerCode==='managed-step-unsettled')return answer(503,{error:workerCode});
      const platformCode=platformErrorCode(e);
      if(platformCode)return answer(503,{error:platformCode});
      if(e instanceof ManagedBindingError||e instanceof SetupError)return answer(SETUP_HTTP_STATUS.get(e.code)??409,{error:e.code});
      const error = e instanceof ProgressError ? e : storageError(e);
      if((cleanupRoute||digestRoute||searchRoute||comparisonRoute||runsRoute||graphRoute||mentionRoute||inboxRoute||delegationRoute)&&['conflict','operation-reused','closed'].includes(error.code))return answer(409,{error:error.code});
      return answer(error.code === 'invalid' ? 400 : error.code === 'not-found' ? 404 : 503,{error:error.code});
    }
  });
  // Receive deadlines only (408), not setup execution/response deadlines. A
  // fully received fresh setup request may legitimately take longer than 5s.
  server.requestTimeout=5000;server.headersTimeout=5000;
  return server;
}
