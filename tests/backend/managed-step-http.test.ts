import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {once} from 'node:events';
import {fork} from 'node:child_process';
import cp from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {setTimeout as delay} from 'node:timers/promises';
import {isolatedEnvironment} from '../fixtures/managed.ts';
import {lifecycle,migrationEvidence} from '../../setup/lifecycle.ts';
import {createManagedBindingDirectory} from '../../shared/managed-binding.ts';
import {writeMigration,readManagedStepJournal,migrationFile} from '../../setup/managed-migration.ts';
import {Store} from '../../shared/store.ts';
import type {ManagedStepResponse,ManagedStepRequest,ManagedStepProgress} from '../../shared/managed-steps.ts';

const payload={plugin:'// synthetic managed',guidance:'synthetic guidance',removal:'// synthetic removal',version:'1.3.0'};
const operationId='11111111-1111-4111-8111-111111111111';
const projection=fs.mkdtempSync('/tmp/opencode/managed-http-source-');
const spawnSync=cp.spawnSync,systemRoot=process.env.SystemRoot;
let legacySpawns=0;
let Controller:typeof import('../../service/setup-controller.ts').SetupController,serverFactory:typeof import('../../service/server.ts').createProgressServer;
before(async()=>{
  // The compatibility routes remain in the controller on the main thread.
  // Count their actual process boundary too, without using native PowerShell.
  process.env.SystemRoot='C:\\Windows';
  cp.spawnSync=((_command:string,_args:string[],options:cp.SpawnSyncOptionsWithStringEncoding):cp.SpawnSyncReturns<string>=>{
    legacySpawns++;
    const input=JSON.parse(String(options.input));for(const p of input.create)fs.mkdirSync(p,{mode:0o700});
    return {pid:1,output:[],stdout:JSON.stringify(input.paths.map(()=>({owned:true,private:true,reparse:false,unsafeParent:false}))),stderr:'',status:0,signal:null};
  }) as typeof cp.spawnSync;
  syncBuiltinESMExports();
  for(const dir of ['shared','setup','service'])fs.cpSync(path.resolve(dir),path.join(projection,dir),{recursive:true});
  fs.symlinkSync(path.resolve('node_modules'),path.join(projection,'node_modules'),'dir');
  fs.mkdirSync(path.join(projection,'tests/backend'),{recursive:true});
  for(const name of ['managed-http-worker.ts','managed-http-server.ts'])fs.copyFileSync(path.resolve('tests/backend',name),path.join(projection,'tests/backend',name));
  const platform=path.join(projection,'shared/platform.ts');let source=fs.readFileSync(platform,'utf8');
  source=source.replace("export const windows = process.platform === 'win32';",'export const windows = true;');
  const start=source.indexOf("  if (value.includes('\\0')",source.indexOf('function windowsPathsInner(')),end=source.indexOf('  let current = clean;',start);
  assert.ok(start>0&&end>start);
  source=source.slice(0,start)+"  if (!path.isAbsolute(value) || path.resolve(value) !== value) throw new PlatformError('path-unverified');\n  const clean = value;\n"+source.slice(end);fs.writeFileSync(platform,source);
  const engine=path.join(projection,'setup/managed-step-engine.ts');source=fs.readFileSync(engine,'utf8');
  const crash=(step:string,order:string)=>`if(process.env.TEST_CRASH_STEP===${step}&&process.env.TEST_CRASH_ORDER==='${order}')process.exit(17);`;
  source=source.replace('    applyManagedStepEffect(env,payload,running,freshCapture);',
    `${crash('m.step!.name','before')}\n    applyManagedStepEffect(env,payload,running,freshCapture);\n${crash('m.step!.name','after')}\nif(process.env.TEST_EFFECT_ERROR==='1')throw new Error('synthetic effect interruption');`);
  source=source.replace('    createManagedBindingDirectory(env);',`${crash("'prepare'",'before')}\n    createManagedBindingDirectory(env);`);
  source=source.replace("  return {disposition:'applied',progress:managedJournalProgress(next),journal:next};",`${crash("'prepare'",'after')}\n  return {disposition:'applied',progress:managedJournalProgress(next),journal:next};`);
  fs.writeFileSync(engine,source);
  Controller=(await import(pathToFileURL(path.join(projection,'service/setup-controller.ts')).href)).SetupController;
  serverFactory=(await import(pathToFileURL(path.join(projection,'service/server.ts')).href)).createProgressServer;
});
after(()=>{cp.spawnSync=spawnSync;syncBuiltinESMExports();if(systemRoot===undefined)delete process.env.SystemRoot;else process.env.SystemRoot=systemRoot;fs.rmSync(projection,{recursive:true,force:true});});

async function fixture(kind:'manifest'|'receipt'|'empty'|'selector'='manifest'){
  const root=fs.mkdtempSync('/tmp/opencode/managed-http-fixture-'),env=isolatedEnvironment(root);
  const targets={configRoot:path.join(env.XDG_CONFIG_HOME!,'opencode'),dataRoot:path.join(env.XDG_DATA_HOME!,'opencode'),storeRoot:path.join(root,'store'),confirmed:true};
  for(const file of [targets.configRoot,targets.dataRoot])fs.mkdirSync(file,{mode:0o700});
  if(kind!=='empty')lifecycle('install',targets,{...payload,version:'1.1.1'});
  if(kind==='selector'){
    // Retained activation selector from the lifecycle owner's supported grammar.
    const legacy=path.join(targets.configRoot,'plugins/agent-progress');
    fs.copyFileSync(path.join(legacy,'.ownership.json'),path.join(legacy,'.agent-progress-activation-11111111-1111-4111-8111-111111111111'));
  }
  if(kind==='receipt'){
    const evidence=migrationEvidence(targets);createManagedBindingDirectory(env);
    writeMigration(env,{binding:{...evidence.binding,installId:'managed-synthetic'},legacyInstallId:evidence.binding.installId,phase:'pending'});
    lifecycle('remove-capture',targets);
  }
  Object.assign(env,{TEST_WINDOWS:'1',TEST_FAULT_FILE:path.join(root,'fault.json'),TEST_READY_FILE:path.join(root,'ready'),TEST_RELEASE_FILE:path.join(root,'release')});
  const worker=pathToFileURL(path.join(projection,'tests/backend/managed-http-worker.ts'));
  const setup=new Controller({env},()=>payload,undefined,undefined,worker),server=serverFactory(undefined,'synthetic-http-fixture',undefined,setup);
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const url=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  const http=async(route:string,body?:unknown)=>{
    const response=await fetch(url+route,{method:body===undefined?'GET':'POST',headers:{authorization:'Bearer synthetic-http-fixture','content-type':'application/json'},
      ...(body===undefined||route.startsWith('/v1/capture/')?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(22_000)});
    return {status:response.status,body:await response.json()};
  };
  const counts:Array<{step:string;spawns:number}>=[];
  const dispatch=setup.request.bind(setup);
  setup.request=async(request,startedAt)=>{
    const result=await dispatch(request,startedAt);assert.ok(result.accounting.securitySpawns<=6);
    if(request.action!=='managed-step')counts.push({step:request.action,spawns:result.accounting.securitySpawns});
    return result;
  };
  const step=async(request:ManagedStepRequest)=>{
    const response=await http('/v1/setup/managed-step',request),body=response.body as ManagedStepResponse;
    assert.equal(body.version,1);assert.ok(body.accounting.securitySpawns<=6);counts.push({step:request.action==='advance'?`${request.step.name}:${request.step.batch}`:request.action,spawns:body.accounting.securitySpawns});
    if('operationId' in request&&body.progress)assert.equal(body.progress.operationId,request.operationId);
    if(body.disposition==='applied'||body.disposition==='replayed'){
      assert.equal(body.progress!.sequence,request.action==='begin'?1:'expectedSequence' in request?request.expectedSequence+1:NaN);
      if(request.action==='advance'&&!body.error)assert.deepEqual(body.progress!.lastCompleted,request.step);
    }
    assert.equal(response.status===200,body.error===null,'non-null error overrides disposition');
    return {...response,body};
  };
  const inspect=async()=>{
    let cursor:string|undefined;
    for(let i=0;i<6;i++){
      const r=await step({version:1,action:'inspect',...(cursor?{cursor}:{})});assert.equal(r.status,200,JSON.stringify(r.body.error));
      if(r.body.inspection!.state==='complete')return r.body.inspection!.review;
      cursor=r.body.inspection!.cursor!;
    }
    throw new Error('inspection did not complete');
  };
  const begin=async()=>{const review=await inspect();return step({version:1,action:'begin',operationId,confirmed:true,expected:review.expected});};
  const status=async()=>{const r=await step({version:1,action:'status',operationId});assert.equal(r.status,200,JSON.stringify(r.body.error));return r.body.progress!;};
  const advance=(p:ManagedStepProgress)=>step({version:1,action:'advance',operationId,expectedSequence:p.sequence,step:p.step!});
  const control=(action:'pause'|'abandon'|'resume',p:ManagedStepProgress,review?:Extract<ManagedStepRequest,{action:'resume'}>['review'])=>step({version:1,action,operationId,expectedSequence:p.sequence,...(review?{review}:{})});
  const until=async(name:string)=>{let p=await status();while(p.step?.name!==name){const r=await advance(p);assert.equal(r.status,200,JSON.stringify(r.body.error));p=r.body.progress!;}return p;};
  const fault=(value:object)=>fs.writeFileSync(env.TEST_FAULT_FILE!,JSON.stringify(value),{mode:0o600});
  const capture=(value?:boolean)=>{const store=new Store(path.join(targets.storeRoot,'progress.sqlite'));try{if(value!==undefined)store.setEnabled(value);return store.list().captureEnabled;}finally{store.close();}};
  return {root,env,setup,http,url,step,inspect,begin,status,advance,control,until,fault,capture,counts,targets,
    async close(){await new Promise<void>(r=>server.close(()=>r()));setup.close();fs.rmSync(root,{recursive:true,force:true});}};
}

for(const kind of ['manifest','receipt','selector'] as const)test(`HTTP ${kind} journey, every step/retry/control is correlated and bounded`,async t=>{
  const f=await fixture(kind);try{
    const before=await f.http('/v1/setup');assert.equal(before.status,200);assert.ok(!Object.hasOwn(before.body.delivery,'migrationProgress'));assert.equal(before.body.delivery.managedMigrationSteps,1);
    for(const route of ['managed-inspect','managed-configure','managed-migrate']){
      const refused=await f.http('/v1/setup/'+route,route==='managed-inspect'?{}:{confirmed:true,expected:'a'.repeat(64)});
      assert.equal(refused.status,409);assert.deepEqual(refused.body,{error:'managed-action-required'});
    }
    let r=await f.begin();assert.equal(r.status,200,JSON.stringify(r.body.error));let p=r.body.progress!;
    for(const action of ['pause','abandon','resume'] as const){r=await f.control(action,p);assert.equal(r.status,200);p=r.body.progress!;}
    while(p.state!=='complete'){
      r=await f.advance(p);assert.equal(r.status,200,JSON.stringify(r.body.error));
      const replay=await f.advance(p);assert.equal(replay.status,200);assert.equal(replay.body.disposition,'replayed');p=r.body.progress!;
      const read=await f.http('/v1/setup');assert.equal(read.status,200,JSON.stringify(read.body));assert.equal(read.body.delivery.migrationProgress.sequence,p.sequence);
    }
    assert.equal(f.capture(),true);const bytes=fs.readFileSync(migrationFile(f.env));
    assert.equal((await f.control('resume',p)).status,409);
    assert.equal((await f.http('/v1/capture/disable',{})).status,200);assert.equal(f.capture(),false);
    assert.deepEqual(fs.readFileSync(migrationFile(f.env)),bytes);
    const enabled=await f.http('/v1/capture/enable',{});assert.equal(enabled.status,200);assert.deepEqual(enabled.body,{ok:true,captureEnabled:true});assert.equal(f.capture(),true);
    assert.equal((await f.http('/health')).body.ready,true,'bounded Setup admission updates only the cheap health observation');
    const events=fs.readFileSync(path.join(f.targets.storeRoot,'installation-history.jsonl'),'utf8').trim().split('\n').map(line=>JSON.parse(line));
    assert.equal(events.filter(e=>e.action==='remove-capture').length,1);
    t.diagnostic(JSON.stringify({kind,counts:f.counts}));
  }finally{await f.close();}
});

test('HTTP legacy compatibility refusal has zero writes or worker launches',async t=>{
  const f=await fixture();try{
    const before=fs.readFileSync(path.join(f.targets.storeRoot,'progress.sqlite'));
    f.fault({hold:true});
    const counts:Array<{route:string;spawns:number}>=[];
    for(const route of ['managed-inspect','managed-configure','managed-migrate']){
      const before=legacySpawns,started=performance.now();
      const r=await f.http('/v1/setup/'+route,route==='managed-inspect'?{}:{confirmed:true,expected:'a'.repeat(64)});
      assert.equal(r.status,409);assert.deepEqual(r.body,{error:'managed-action-required'});
      const spawns=legacySpawns-before;counts.push({route,spawns});
      assert.ok(spawns<=(route==='managed-migrate'?0:6));assert.ok(performance.now()-started<=8000);
    }
    assert.equal(fs.existsSync(f.env.TEST_READY_FILE!),false);assert.equal(fs.existsSync(migrationFile(f.env)),false);
    assert.deepEqual(fs.readFileSync(path.join(f.targets.storeRoot,'progress.sqlite')),before);
    t.diagnostic(JSON.stringify({kind:'legacy-refusal',counts}));
  }finally{await f.close();}
});

test('HTTP fresh inspection and configuration retain legacy consent and spawn budgets',async t=>{
  const f=await fixture('empty');try{
    const before=legacySpawns;
    const inspected=await f.http('/v1/setup/managed-inspect',{storeRoot:f.targets.storeRoot});
    assert.equal(inspected.status,200,JSON.stringify(inspected.body));
    const inspectSpawns=legacySpawns-before;
    const review=inspected.body.delivery.review;
    assert.ok(review.expected);assert.equal(fs.existsSync(migrationFile(f.env)),false);
    assert.equal(fs.existsSync(f.targets.storeRoot),false,'inspection has no product writes');
    const input={storeRoot:review.targets.storeRoot,confirmed:true,expected:review.expected};
    const unauthenticated=await fetch(f.url+'/v1/setup/managed-configure',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input),signal:AbortSignal.timeout(5000)});
    assert.equal(unauthenticated.status,401);
    assert.equal((await f.http('/v1/setup/managed-configure',{...input,confirmed:false})).body.error,'confirmation-required');
    assert.equal((await f.http('/v1/setup/managed-configure',{...input,expected:'f'.repeat(64)})).body.error,'managed-review-stale');
    assert.equal((await f.http('/v1/setup/managed-configure',{...input,storeRoot:path.join(f.root,'different')})).body.error,'managed-review-stale');
    assert.equal(fs.existsSync(f.targets.storeRoot),false,'refused consent cannot create the store');
    assert.equal(fs.existsSync(path.dirname(migrationFile(f.env))),false);
    const configuring=legacySpawns;
    const configured=await f.http('/v1/setup/managed-configure',{storeRoot:review.targets.storeRoot,confirmed:true,expected:review.expected});
    const configureSpawns=legacySpawns-configuring;
    assert.equal(configured.status,200,JSON.stringify(configured.body));
    assert.equal(configured.body.configured,true);assert.equal(configured.body.verified,true);
    assert.equal(configured.body.delivery.migration,'none');
    assert.equal(configured.body.captureEnabled,true);assert.equal(fs.existsSync(migrationFile(f.env)),false);
    assert.ok(inspectSpawns<=3,`inspect: ${inspectSpawns}`);assert.ok(configureSpawns<=24,`configure: ${configureSpawns}`);
    assert.equal((await f.http('/v1/setup')).body.configured,true);
    t.diagnostic(JSON.stringify({kind:'fresh',inspectSpawns,configureSpawns}));
  }finally{await f.close();}
});

test('HTTP fresh routes refuse ambiguous legacy plus managed selection without changing either',async()=>{
  const f=await fixture('empty');try{
    const review=(await f.http('/v1/setup/managed-inspect',{storeRoot:f.targets.storeRoot})).body.delivery.review;
    assert.equal((await f.http('/v1/setup/managed-configure',{storeRoot:f.targets.storeRoot,confirmed:true,expected:review.expected})).status,200);
    const legacy=path.join(f.targets.configRoot,'plugins/agent-progress');fs.mkdirSync(legacy,{recursive:true,mode:0o700});
    const selector=path.join(f.targets.dataRoot,'agent-progress-managed/progress-binding.json');
    const before=fs.readFileSync(selector),database=fs.readFileSync(path.join(f.targets.storeRoot,'progress.sqlite'));
    for(const route of ['managed-inspect','managed-configure']){
      const r=await f.http('/v1/setup/'+route,route==='managed-inspect'?{}:{storeRoot:f.targets.storeRoot,confirmed:true,expected:review.expected});
      assert.equal(r.status,409);assert.deepEqual(r.body,{error:route==='managed-inspect'?'managed-action-required':'managed-migration-conflict'});
    }
    assert.deepEqual(fs.readFileSync(selector),before);assert.deepEqual(fs.readFileSync(path.join(f.targets.storeRoot,'progress.sqlite')),database);
    assert.deepEqual(fs.readdirSync(legacy),[]);assert.equal(fs.existsSync(migrationFile(f.env)),false);
  }finally{await f.close();}
});

test('HTTP fresh routes never treat an existing unknown journal as fresh configuration',async()=>{
  const f=await fixture('empty');try{
    createManagedBindingDirectory(f.env);fs.writeFileSync(migrationFile(f.env),'unknown journal',{mode:0o600});
    for(const route of ['managed-inspect','managed-configure']){
      const r=await f.http('/v1/setup/'+route,route==='managed-inspect'?{}:{confirmed:true,expected:'a'.repeat(64)});
      assert.equal(r.status,409);assert.deepEqual(r.body,{error:'managed-action-required'});
    }
    assert.equal(fs.readFileSync(migrationFile(f.env),'utf8'),'unknown journal');assert.equal(fs.existsSync(f.targets.storeRoot),false);
  }finally{await f.close();}
});

test('HTTP fresh confirmation refuses legacy discovery appearing after review',async()=>{
  const f=await fixture('empty');try{
    const review=(await f.http('/v1/setup/managed-inspect',{storeRoot:f.targets.storeRoot})).body.delivery.review;
    const legacy=path.join(f.targets.configRoot,'plugins/agent-progress');fs.mkdirSync(legacy,{recursive:true,mode:0o700});
    const result=await f.http('/v1/setup/managed-configure',{storeRoot:f.targets.storeRoot,confirmed:true,expected:review.expected});
    assert.equal(result.status,409);assert.deepEqual(result.body,{error:'managed-action-required'});
    assert.equal(fs.existsSync(f.targets.storeRoot),false);assert.equal(fs.existsSync(path.dirname(migrationFile(f.env))),false);
    assert.deepEqual(fs.readdirSync(legacy),[]);
  }finally{await f.close();}
});

test('HTTP empty Setup omits progress and does not create metadata',async()=>{
  const f=await fixture('empty');try{
    const read=await f.http('/v1/setup');assert.equal(read.status,200);assert.equal(read.body.delivery.managedMigrationSteps,1);
    assert.equal(Object.hasOwn(read.body.delivery,'migrationProgress'),false);assert.equal(read.body.captureEnabled,null);
    assert.equal((await f.http('/health')).body.state,'unconfigured');assert.equal(fs.existsSync(migrationFile(f.env)),false);
    assert.ok(f.counts.every(c=>c.spawns<=6));
  }finally{await f.close();}
});

test('HTTP bounded reads and capture retain the service selection pin across workers',async()=>{
  const f=await fixture('receipt');try{
    let p=(await f.begin()).body.progress!;while(p.state!=='complete')p=(await f.advance(p)).body.progress!;
    assert.equal((await f.http('/v1/setup')).status,200);
    const file=path.join(f.targets.dataRoot,'agent-progress-managed','progress-binding.json');fs.appendFileSync(file,' ');
    for(const route of ['/v1/setup','/v1/capture/disable','/v1/capture/enable']){
      const r=await f.http(route,route.includes('/capture/')?{}:undefined);
      if(route==='/v1/setup'){assert.equal(r.status,200);assert.deepEqual(r.body.diagnostics,['managed-binding-modified']);assert.equal(r.body.delivery.configuration,'invalid');}
      else{assert.equal(r.status,409);assert.equal(r.body.error,'managed-binding-modified');}
    }
    assert.equal(f.capture(),true);assert.equal((await f.http('/health')).body.state,'refused');
  }finally{await f.close();}
});

test('HTTP validation, unknown operation and stale step refusals preserve fixed envelopes and same-target progress',async()=>{
  const f=await fixture();try{
    for(const body of [{version:2,action:'status'},{version:1,action:'status',secret:'not accepted'},{version:1,action:'advance',operationId,expectedSequence:-1,step:{name:'enable',batch:0}}]){
      const r=await f.http('/v1/setup/managed-step',body);assert.equal(r.status,400);assert.equal(r.body.error.code,'invalid');assert.equal(r.body.disposition,'refused');assert.equal(r.body.accounting.securitySpawns,0);
    }
    assert.equal((await f.step({version:1,action:'status',operationId})).status,404);
    const begun=await f.begin(),p=begun.body.progress!;
    const r=await f.step({version:1,action:'advance',operationId,expectedSequence:p.sequence,step:{name:'enable',batch:0}});
    assert.equal(r.status,409);assert.equal(r.body.error!.stage,'enable');assert.equal(r.body.error!.code,'managed-step-conflict');assert.equal(r.body.progress!.sequence,p.sequence);
    const wrong=await f.step({version:1,action:'status',operationId:'22222222-2222-4222-8222-222222222222'});assert.equal(wrong.status,404);assert.equal(wrong.body.progress,null);
  }finally{await f.close();}
});

for(const order of ['before','after'])test(`HTTP worker crash ${order} every effect retains resumable evidence`,async()=>{
  const f=await fixture('selector');try{
    let p=(await f.begin()).body.progress!;
    while(p.state!=='complete'){
      const old=p;f.fault({crashStep:p.step!.name,order});
      const r=await f.advance(p);assert.equal(r.status,503);assert.equal(r.body.error!.code,'managed-step-unsettled');
      f.fault({});p=await f.status();assert.equal(p.state,'running');assert.equal(p.sequence,old.sequence);assert.equal(p.worker,'unsettled');
      const capture=['enable','disable'].includes(p.step!.name),ambiguous=capture&&f.capture()!==(p.step!.name==='enable');
      if(ambiguous){
        assert.equal((await f.control('resume',p)).body.error!.code,'managed-step-unsettled');
        const review=await f.inspect();const resumed=await f.control('resume',p,{confirmed:true,expected:review.expected,step:p.step!.name as 'enable'|'disable'});
        assert.equal(resumed.status,200,JSON.stringify(resumed.body.error));p=resumed.body.progress!;
      }else{const resumed=await f.control('resume',p);assert.equal(resumed.status,200);p=resumed.body.progress!;}
      const recovered=await f.advance(p);assert.equal(recovered.status,200,JSON.stringify(recovered.body.error));p=recovered.body.progress!;
    }
    assert.equal(f.capture(),true);
    const events=fs.readFileSync(path.join(f.targets.storeRoot,'installation-history.jsonl'),'utf8').trim().split('\n').map(line=>JSON.parse(line));
    assert.equal(events.filter(e=>e.operationId===operationId).length,1);
  }finally{await f.close();}
});

for(const order of ['before','after'])test(`HTTP prepare crash ${order} metadata publication recovers without other effects`,async()=>{
  const f=await fixture();try{
    const review=await f.inspect(),request={version:1 as const,action:'begin' as const,operationId,confirmed:true as const,expected:review.expected};
    f.fault({crashStep:'prepare',order});assert.equal((await f.step(request)).status,503);f.fault({});
    if(order==='after'){const r=await f.step(request);assert.equal(r.status,200);assert.equal(r.body.disposition,'replayed');}
    else assert.equal((await f.begin()).status,200);
    assert.equal(f.capture(),true);assert.equal(readManagedStepJournal(f.env)!.migration.sequence,1);
  }finally{await f.close();}
});

for(const name of ['disable','enable'] as const)test(`HTTP failed ${name} replay and one-use fresh consent`,async()=>{
  const f=await fixture();try{
    await f.begin();let p=await f.until(name);f.fault({capture:'before'});
    const failed=await f.advance(p);assert.equal(failed.status,503);assert.equal(failed.body.progress!.state,'failed');f.fault({});
    const replay=await f.advance(p);assert.equal(replay.status,503);assert.equal(replay.body.disposition,'replayed');assert.ok(replay.body.error);
    p=failed.body.progress!;assert.equal((await f.control('resume',p)).status,503);
    const review=await f.inspect();
    const stale=await f.control('resume',p,{confirmed:true,step:name,expected:'f'.repeat(64)});assert.equal(stale.status,409);
    const renewed=await f.inspect(),consent={confirmed:true as const,step:name,expected:renewed.expected};
    const resumed=await f.control('resume',p,consent);assert.equal(resumed.status,200);
    assert.equal((await f.control('resume',p,consent)).body.disposition,'replayed');p=resumed.body.progress!;
    const result=await f.advance(p);assert.equal(result.status,200);f.capture(name!=='enable');
    assert.equal((await f.advance(p)).body.disposition,'replayed');assert.equal(f.capture(),name!=='enable');
    assert.notEqual(review.expected,renewed.expected);
  }finally{await f.close();}
});

test('HTTP two-process writer fence refuses overlapping migration and ordinary capture while health stays cheap',async()=>{
  const f=await fixture(),fresh=await fixture('empty');let child:ReturnType<typeof fork>|undefined;
  try{
    const review=(await fresh.http('/v1/setup/managed-inspect',{storeRoot:f.targets.storeRoot})).body.delivery.review;
    assert.ok(review.expected);
    await f.begin();const p=await f.status();f.fault({hold:true});
    const holding=f.advance(p);
    const deadline=Date.now()+5000;while(!fs.existsSync(f.env.TEST_READY_FILE!)&&Date.now()<deadline)await delay(10);assert.ok(fs.existsSync(f.env.TEST_READY_FILE!));
    const count=f.counts.length,health=await f.http('/health');assert.equal(health.status,200);assert.equal(health.body.state,'starting');assert.equal(health.body.managedMigrationSteps,1);assert.equal(f.counts.length,count,'health dispatches no security worker');
    for(const route of ['/v1/capture/disable','/v1/capture/enable']){const r=await f.http(route,{});assert.equal(r.status,503);assert.equal(r.body.error,'managed-step-unsettled');}
    const spawns=legacySpawns;
    const configure=await f.http('/v1/setup/managed-configure',{storeRoot:f.targets.storeRoot,confirmed:true,expected:'a'.repeat(64)});
    assert.equal(configure.status,503);assert.equal(configure.body.error,'managed-step-port-busy');assert.equal(legacySpawns,spawns,'busy refuses before controller admission');
    const shared=await fresh.http('/v1/setup/managed-configure',{storeRoot:review.targets.storeRoot,confirmed:true,expected:review.expected});
    assert.equal(shared.status,503);assert.equal(shared.body.error,'managed-step-port-busy','a different scope sharing the Store also fences');
    assert.equal(legacySpawns,spawns);assert.equal(fs.existsSync(path.dirname(migrationFile(fresh.env))),false);
    assert.equal((await f.control('pause',p)).body.error!.code,'managed-step-unsettled');
    child=fork(path.join(projection,'tests/backend/managed-http-server.ts'),[],{execArgv:['--experimental-strip-types'],env:f.env,silent:true});
    const [ready]=await once(child,'message',{signal:AbortSignal.timeout(5000)});
    const r=await fetch(`http://127.0.0.1:${ready.port}/v1/setup/managed-step`,{method:'POST',headers:{authorization:'Bearer synthetic-http-fixture','content-type':'application/json'},body:JSON.stringify({version:1,action:'pause',operationId,expectedSequence:p.sequence}),signal:AbortSignal.timeout(5000)});
    assert.equal(r.status,503);const body=await r.json();assert.equal(body.error.code,'managed-step-port-busy');assert.equal(body.accounting.securitySpawns,0);
    fs.writeFileSync(f.env.TEST_RELEASE_FILE!,'release');f.fault({});assert.equal((await holding).status,200);
    // The second service advances the same journal while this supervisor keeps
    // its old claim. A hint mismatch must not reject the valid following request.
    const current=await f.status();
    const changed=await fetch(`http://127.0.0.1:${ready.port}/v1/setup/managed-step`,{method:'POST',headers:{authorization:'Bearer synthetic-http-fixture','content-type':'application/json'},body:JSON.stringify({version:1,action:'pause',operationId,expectedSequence:current.sequence}),signal:AbortSignal.timeout(5000)});
    assert.equal(changed.status,200);const paused=await changed.json();
    assert.equal((await f.control('resume',paused.progress)).status,200,'stale private hint is only an optimization claim');
  }finally{if(child){const exited=once(child,'exit');child.kill('SIGTERM');await exited;}await fresh.close();await f.close();}
});

test('HTTP response deadline retains writer exclusion until the late worker exits',async()=>{
  const f=await fixture();try{
    const p=(await f.begin()).body.progress!,dispatch=f.setup.request.bind(f.setup);
    let first=true;f.setup.request=(request,startedAt)=>dispatch(request,first?(first=false,process.hrtime.bigint()-16_000_000_000n):startedAt);
    f.fault({hold:true});const waiting=f.advance(p);
    const deadline=Date.now()+5000;while(!fs.existsSync(f.env.TEST_READY_FILE!)&&Date.now()<deadline)await delay(10);assert.ok(fs.existsSync(f.env.TEST_READY_FILE!));
    const refused=await waiting;assert.equal(refused.status,503);assert.equal(refused.body.error!.code,'managed-step-deadline');
    assert.equal((await f.control('pause',p)).body.error!.code,'managed-step-unsettled');
    assert.equal((await f.http('/v1/capture/disable',{})).body.error,'managed-step-unsettled');
    assert.equal((await f.http('/health')).status,200);
    fs.writeFileSync(f.env.TEST_RELEASE_FILE!,'release');f.fault({});
    const until=Date.now()+5000;let settled=false;
    while(Date.now()<until){const r=await f.step({version:1,action:'status',operationId});if(r.status===200){assert.equal(r.body.progress!.sequence,p.sequence);settled=true;break;}await delay(10);}
    assert.ok(settled);assert.equal(f.capture(),true);
  }finally{await f.close();}
});

test('HTTP diagnostics preserve owner failures, corrupt journals and missing markers without private messages',async()=>{
  const f=await fixture();try{
    let p=(await f.begin()).body.progress!;
    const bytes=fs.readFileSync(migrationFile(f.env));
    for(const [ownerCode,code,status] of [['installation-changed','managed-migration-conflict',409],['payload-invalid','managed-step-unsupported',409],['unknown-error','storage',503]] as const){
      f.fault({ownerCode});const r=await f.advance(p);assert.equal(r.status,status);assert.equal(r.body.error!.code,code);assert.equal(r.body.error!.stage,'expectation');assert.equal(r.body.progress!.sequence,p.sequence);
      assert.ok(!JSON.stringify(r.body).includes('not public'));assert.deepEqual(fs.readFileSync(migrationFile(f.env)),bytes);f.fault({});p=await f.status();
    }
    f.fault({securityError:'managed-step-unsettled'});const fence=await f.advance(p);assert.equal(fence.status,503);assert.equal(fence.body.error!.code,'managed-step-unsettled');f.fault({});
    fs.writeFileSync(migrationFile(f.env),'corrupt',{mode:0o600});
    const first=await f.step({version:1,action:'inspect'});assert.equal(first.status,200);
    const corrupt=await f.step({version:1,action:'inspect',cursor:first.body.inspection!.cursor!});assert.equal(corrupt.status,409);assert.equal(corrupt.body.error!.code,'managed-journal-unsupported');assert.equal(corrupt.body.error!.stage,'managed-state');
    fs.writeFileSync(migrationFile(f.env),bytes);
    fs.unlinkSync(path.join(path.dirname(migrationFile(f.env)),'.ownership.json'));
    const marker=await f.step({version:1,action:'status',operationId});assert.equal(marker.status,409);assert.equal(marker.body.error!.code,'managed-binding-invalid');
  }finally{await f.close();}
});

for(const exhausted of ['spawns','time'] as const)test(`HTTP pre-effect ${exhausted} exhaustion is a bounded refusal, not partial success`,async()=>{
  const f=await fixture();try{
    const p=(await f.begin()).body.progress!,before=fs.readFileSync(migrationFile(f.env));
    f.fault(exhausted==='spawns'?{spentSpawns:3}:{clockOffset:7000});
    const r=await f.advance(p);assert.equal(r.status,503);assert.equal(r.body.error!.code,exhausted==='spawns'?'managed-step-budget':'managed-step-deadline');
    assert.equal(r.body.progress!.sequence,p.sequence);assert.deepEqual(fs.readFileSync(migrationFile(f.env)),before);assert.equal(f.capture(),true);
  }finally{await f.close();}
});

for(const state of ['pending','running','paused','failed','abandoned','complete'] as const)test(`HTTP ${state} control transition matrix`,async()=>{
  const f=await fixture();try{
    let p=(await f.begin()).body.progress!;
    if(state==='running'){f.fault({crashStep:'expectation',order:'after'});await f.advance(p);f.fault({});p=await f.status();}
    if(state==='failed'){f.fault({effectError:true});const r=await f.advance(p);assert.equal(r.status,503);f.fault({});p=r.body.progress!;}
    if(state==='paused'||state==='abandoned')p=(await f.control(state==='paused'?'pause':'abandon',p)).body.progress!;
    if(state==='complete')while(p.state!=='complete'){const r=await f.advance(p);assert.equal(r.status,200);p=r.body.progress!;}
    assert.equal(p.state,state);const bytes=fs.readFileSync(migrationFile(f.env)),database=fs.readFileSync(path.join(f.targets.storeRoot,'progress.sqlite'));
    for(const action of ['pause','abandon','resume'] as const){
      fs.writeFileSync(migrationFile(f.env),bytes);await f.status();
      const allowed=action==='pause'?['pending','running','failed']:action==='abandon'?['pending','running','failed','paused']:['pending','running','paused','failed','abandoned'];
      const r=await f.control(action,p);assert.equal(r.status,allowed.includes(state)?200:409,JSON.stringify(r.body.error));
      if(allowed.includes(state)){
        assert.equal(r.body.progress!.sequence,p.sequence+1);assert.deepEqual(r.body.progress!.step,p.step);
        assert.equal((await f.control(action,p)).body.disposition,'replayed');
      }else assert.deepEqual(fs.readFileSync(migrationFile(f.env)),bytes);
      assert.deepEqual(fs.readFileSync(path.join(f.targets.storeRoot,'progress.sqlite')),database);
    }
  }finally{await f.close();}
});
