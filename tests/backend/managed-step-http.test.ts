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
import {DatabaseSync} from 'node:sqlite';
import {isolatedEnvironment} from '../fixtures/managed.ts';
import {nativeService} from '../fixtures/windows-service-driver.ts';
import {lifecycle,migrationEvidence} from '../../setup/lifecycle.ts';
import {createManagedBindingDirectory,managedBindingFile,readManagedExpectation,writeManagedExpectation} from '../../shared/managed-binding.ts';
import {writeMigration,readManagedStepJournal,readManagedFreshStepJournal,migrationFile} from '../../setup/managed-migration.ts';
import {Store,digest} from '../../shared/store.ts';
import type {ManagedStepResponse,ManagedStepRequest,ManagedStepProgress,ManagedFreshStepRequest,ManagedFreshStepResponse,ManagedFreshStepProgress,ManagedSetupStepRequest} from '../../shared/managed-steps.ts';
import {StepDriver,managedStepCall,nextAction,currentProgress} from '../../ui/shared/setup-steps.ts';
import {parseSetup} from '../../ui/shared/adapter.ts';
import {setupCall,readList} from '../../ui/shared/source.ts';
import {acquireWriterSlots} from '../../service/writer-fence.ts';
import {writerTarget} from '../../shared/platform.ts';
import {SetupController} from '../../service/setup-controller.ts';
import {createProgressServer} from '../../service/server.ts';

const payload={plugin:'// synthetic managed',guidance:'synthetic guidance',removal:'// synthetic removal',version:'1.3.0'};
const operationId='11111111-1111-4111-8111-111111111111';
const projection=fs.mkdtempSync('/tmp/opencode/managed-http-source-');
const spawnSync=cp.spawnSync,systemRoot=process.env.SystemRoot;
let legacySpawns=0,priorUmask=0o022;
let Controller:typeof import('../../service/setup-controller.ts').SetupController,serverFactory:typeof import('../../service/server.ts').createProgressServer,windowsServerFactory:typeof serverFactory;
before(async()=>{
  // The compatibility routes remain in the controller on the main thread. No
  // permission check may start a process: count any attempt and refuse it.
  process.env.SystemRoot='C:\\Windows';
  // The projected Windows path creates ordinary directories; a restrictive umask
  // keeps this test's POSIX-side readers satisfied.
  priorUmask=process.umask(0o077);
  cp.spawnSync=(()=>{legacySpawns++;throw new Error('no permission check may start a process');}) as unknown as typeof cp.spawnSync;
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
  assert.ok(source.includes('    const created=applyManagedStepEffect(env,payload,running,freshCapture);'));
  source=source.replace('    const created=applyManagedStepEffect(env,payload,running,freshCapture);',
    `${crash('m.step!.name','before')}\n    const created=applyManagedStepEffect(env,payload,running,freshCapture);\n${crash('m.step!.name','after')}\nif(process.env.TEST_EFFECT_ERROR==='1')throw new Error('synthetic effect interruption');`);
  source=source.replace('    createManagedBindingDirectory(env);',`${crash("'prepare'",'before')}\n    createManagedBindingDirectory(env);`);
  source=source.replace("  return {disposition:'applied',progress:managedSetupJournalProgress(next),journal:next};",`${crash("'prepare'",'after')}\n  return {disposition:'applied',progress:managedSetupJournalProgress(next),journal:next};`);
  fs.writeFileSync(engine,source);
  const binding=path.join(projection,'shared/managed-binding.ts');source=fs.readFileSync(binding,'utf8');
  for(const [statement,order] of [['linkSync(stage, file);','linked'],['unlinkSync(stage);','unlinked']] as const){
    const anchor=`      ${statement}`;
    assert.ok(source.includes(anchor));
    source=source.replace(anchor,`${anchor}\n      if(initialJournal){${crash("'prepare'",order)}}`);
  }
  fs.writeFileSync(binding,source);
  Controller=(await import(pathToFileURL(path.join(projection,'service/setup-controller.ts')).href)).SetupController;
  serverFactory=(await import(pathToFileURL(path.join(projection,'service/server.ts')).href)).createProgressServer;
  // Route retirement is a native-OS rule, independent of the substituted
  // Windows security/path boundary used by the non-Windows compatibility cases.
  const serverSource=fs.readFileSync(path.join(projection,'service/server.ts'),'utf8');assert.ok(serverSource.includes("process.platform==='win32'"));
  fs.writeFileSync(path.join(projection,'service/server-windows.ts'),serverSource.replace("process.platform==='win32'",'true'));
  windowsServerFactory=(await import(pathToFileURL(path.join(projection,'service/server-windows.ts')).href)).createProgressServer;
});
after(()=>{process.umask(priorUmask);cp.spawnSync=spawnSync;syncBuiltinESMExports();if(systemRoot===undefined)delete process.env.SystemRoot;else process.env.SystemRoot=systemRoot;fs.rmSync(projection,{recursive:true,force:true});});

async function fixture(kind:'manifest'|'receipt'|'empty'|'selector'='manifest',routes:'projected'|'windows'|'native'='projected'){
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
  Object.assign(env,{TEST_FAULT_FILE:path.join(root,'fault.json'),TEST_READY_FILE:path.join(root,'ready'),TEST_RELEASE_FILE:path.join(root,'release')});
  const worker=pathToFileURL(path.join(projection,'tests/backend/managed-http-worker.ts'));
  const setup=routes==='native'?new SetupController({env},()=>payload):new Controller({env},()=>payload,undefined,undefined,worker);
  const server=(routes==='native'?createProgressServer:routes==='windows'?windowsServerFactory:serverFactory)(undefined,'synthetic-http-fixture',undefined,setup);
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
    const result=await dispatch(request,startedAt);assert.equal(result.accounting.securitySpawns,0);
    if(request.action!=='managed-step')counts.push({step:request.action,spawns:result.accounting.securitySpawns});
    return result;
  };
  const step=async(request:ManagedStepRequest)=>{
    const response=await http('/v1/setup/managed-step',request),body=response.body as ManagedStepResponse;
    assert.equal(body.version,1);assert.equal(body.accounting.securitySpawns,0);counts.push({step:request.action==='advance'?`${request.step.name}:${request.step.batch}`:request.action,spawns:body.accounting.securitySpawns});
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
  const host={serviceRequest:async(q: {path:string;method?:string;body?:string})=>{
    const r=await fetch(url+q.path,{method:q.method,body:q.body,headers:{authorization:'Bearer synthetic-http-fixture'},signal:AbortSignal.timeout(22000)});
    return {status:r.status,body:await r.text()};
  }};
  return {root,env,setup,http,url,host,step,inspect,begin,status,advance,control,until,fault,capture,counts,targets,
    async close(){await new Promise<void>(r=>server.close(()=>r()));setup.close();fs.rmSync(root,{recursive:true,force:true});}};
}

async function freshHttpFixture(kind:'default'|'custom'|'retained-new'|'retained-reuse'='custom',enabled=false,routes:'windows'|'native'='windows'){
  const f=await fixture('empty',routes);
  if(kind==='default')f.targets.storeRoot=path.join(f.targets.dataRoot,'openchamber-progress');
  const database=path.join(f.targets.storeRoot,'progress.sqlite');
  if(kind.startsWith('retained')){
    fs.mkdirSync(f.targets.storeRoot,{mode:0o700});const s=new Store(database,{create:true});try{
      s.setEnabled(enabled);s.registerSource({id:'other-source',configRoot:path.join(f.root,'other-config'),dataRoot:path.join(f.root,'other-data'),verified:true});
      if(kind==='retained-reuse')s.registerSource({id:'same-source',configRoot:f.targets.configRoot,dataRoot:f.targets.dataRoot,verified:true});
    }finally{s.close();}
  }
  const step=async(request:ManagedFreshStepRequest)=>{
    const r=await f.http('/v1/setup/managed-step',request),body=r.body as ManagedFreshStepResponse;
    assert.equal(body.version,2);assert.equal(body.accounting.securitySpawns,0);
    assert.equal(body.error===null,r.status===200);if(body.progress)assert.equal(body.progress.planKind,'fresh');
    f.counts.push({step:request.action==='advance'?request.step.name:request.action,spawns:body.accounting.securitySpawns});
    return {...r,body};
  };
  const inspect=async()=>{
    let cursor:string|undefined;
    for(let i=0;i<5;i++){
      const r=await step({version:2,action:'inspect',...(cursor?{cursor}:kind==='default'?{}:{storeRoot:f.targets.storeRoot})});
      assert.equal(r.status,200,JSON.stringify(r.body.error));
      if(r.body.inspection!.state==='complete')return r.body.inspection!.review;
      cursor=r.body.inspection!.cursor!;
    }
    throw new Error('fresh inspection did not complete');
  };
  const begin=async()=>{const review=await inspect();return step({version:2,action:'begin',operationId,confirmed:true,expected:review.expected});};
  const status=async()=>{const r=await step({version:2,action:'status',operationId});assert.equal(r.status,200);return r.body.progress!;};
  const advance=(p:ManagedFreshStepProgress)=>step({version:2,action:'advance',operationId,expectedSequence:p.sequence,step:p.step!});
  const control=(action:'pause'|'resume'|'abandon',p:ManagedFreshStepProgress,review?:Extract<ManagedFreshStepRequest,{action:'resume'}>['review'])=>step({version:2,action,operationId,expectedSequence:p.sequence,...(review?{review}:{})});
  const until=async(name:string)=>{let p=await status();while(p.step?.name!==name){const r=await advance(p);assert.equal(r.status,200,JSON.stringify(r.body.error));p=r.body.progress!;}return p;};
  return {...f,database,step,inspect,begin,status,advance,control,until};
}

async function coldHttp(env:NodeJS.ProcessEnv) {
  const child=fork(path.join(projection,'tests/backend/managed-http-server.ts'),[],{execArgv:['--experimental-strip-types'],env,silent:true});
  const exited=once(child,'exit');
  const close=async()=>{child.kill('SIGTERM');await exited;};
  try{
    const [ready]=await once(child,'message',{signal:AbortSignal.timeout(5000)});
    const http=async(route:string,body?:unknown)=>{
      const response=await fetch(`http://127.0.0.1:${ready.port}${route}`,{method:body===undefined?'GET':'POST',
        headers:{authorization:'Bearer synthetic-http-fixture','content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),
        signal:AbortSignal.timeout(22_000)});
      return {status:response.status,body:await response.json()};
    };
    return {http,step:(request:ManagedSetupStepRequest)=>http('/v1/setup/managed-step',request),close};
  }catch(error){await close();throw error;}
}

test('cold migration begin settles only the proven first journal pair',async()=>{
  const f=await fixture();let cold:Awaited<ReturnType<typeof coldHttp>>|undefined;
  try{
    const review=await f.inspect(),begin={version:1,action:'begin',operationId,confirmed:true,expected:review.expected} as const;
    const capture=f.capture(),file=migrationFile(f.env);
    f.fault({crashStep:'prepare',order:'linked'});
    assert.equal((await f.step(begin)).status,503);
    f.fault({});cold=await coldHttp(f.env);
    const bytes=fs.readFileSync(file),stage=`${file}.stage-prepare-${digest(bytes)}`,first=fs.statSync(file,{bigint:true});
    const retained=()=>{
      for(const name of [file,stage]){
        const stat=fs.statSync(name,{bigint:true});
        assert.equal(stat.ino,first.ino);assert.equal(stat.dev,first.dev);assert.equal(stat.nlink,2n);
        assert.deepEqual(fs.readFileSync(name),bytes);
      }
    };
    retained();
    // Test the routing-only cold claim before any Setup/step status can cache it.
    const release=await acquireWriterSlots([writerTarget('store',f.targets.storeRoot)]);
    try{assert.equal((await cold.step(begin)).body.error.code,'managed-step-port-busy');retained();}finally{await release();}
    const setup=await cold.http('/v1/setup');
    assert.equal(setup.status,200);assert.equal(setup.body.configured,false);
    assert.equal(nextAction(setup.body.delivery.migrationProgress),'continue');
    const status=await cold.step({version:1,action:'status',operationId});
    assert.equal(status.status,200);assert.equal(status.body.progress.sequence,1);assert.equal(status.body.progress.capture.state,'unknown');
    assert.equal((await cold.step({...begin,expected:'d'.repeat(64)})).status,409);
    assert.equal((await cold.step({...begin,version:2})).status,409);
    f.fault({clockOffset:15000});
    assert.equal((await cold.step(begin)).body.error.code,'managed-step-deadline');
    f.fault({});retained();
    // Cold again: even without a status hint, acquire the original Store slot.
    await cold.close();cold=await coldHttp(f.env);
    const replay=await cold.step(begin);
    assert.equal(replay.status,200);assert.equal(replay.body.disposition,'replayed');
    assert.equal(replay.body.progress.sequence,1);assert.equal(replay.body.progress.capture.state,'unknown');
    const final=fs.statSync(file,{bigint:true});
    assert.equal(final.ino,first.ino);assert.equal(final.dev,first.dev);assert.equal(final.nlink,1n);
    assert.deepEqual(fs.readFileSync(file),bytes);assert.equal(fs.existsSync(stage),false);
    assert.equal(fs.existsSync(path.join(path.dirname(file),'progress-binding.json')),false);
    assert.equal(fs.readdirSync(f.targets.storeRoot).some(name=>name.startsWith('managed-expectation-')),false);
    assert.equal(f.capture(),capture);
  }finally{await cold?.close();await f.close();}
});

test('cold fresh custom Store Continue needs no begin token and advances only the advertised step',async()=>{
  const f=await freshHttpFixture();let cold:Awaited<ReturnType<typeof coldHttp>>|undefined;
  try{
    f.fault({crashStep:'prepare',order:'linked'});assert.equal((await f.begin()).status,503);
    f.fault({});cold=await coldHttp(f.env);
    const file=migrationFile(f.env),bytes=fs.readFileSync(file),stage=`${file}.stage-prepare-${digest(bytes)}`;
    const setup=await cold.http('/v1/setup');assert.equal(setup.status,200);
    const p=setup.body.delivery.freshProgress as ManagedFreshStepProgress;
    assert.equal(nextAction(p),'continue');assert.equal(p.sequence,1);assert.equal(setup.body.captureEnabled,null);
    const observed=await cold.step({version:2,action:'status',operationId});
    assert.equal(observed.status,200);assert.deepEqual(observed.body.progress,p);
    assert.equal(fs.statSync(stage).nlink,2);assert.deepEqual(fs.readFileSync(file),bytes);
    const advance={version:2,action:'advance',operationId:p.operationId,expectedSequence:p.sequence,step:p.step!} as const;
    assert.equal((await cold.step({...advance,expectedSequence:0})).status,409);
    fs.mkdirSync(f.targets.storeRoot,{mode:0o700});
    assert.equal((await cold.step(advance)).status,409,'changed Store claim must refuse before unlink');
    assert.equal(fs.statSync(stage).nlink,2);assert.deepEqual(fs.readFileSync(stage),bytes);assert.deepEqual(fs.readFileSync(file),bytes);
    fs.rmdirSync(f.targets.storeRoot);
    const continued=await cold.step(advance);assert.equal(continued.status,200,JSON.stringify(continued.body.error));
    assert.equal(continued.body.progress.sequence,2);assert.deepEqual(continued.body.progress.lastCompleted,p.step);
    assert.ok(fs.statSync(f.targets.storeRoot).isDirectory());assert.equal(fs.existsSync(f.database),false);
    assert.equal(fs.existsSync(stage),false);assert.equal(fs.statSync(file).nlink,1);
    assert.equal(fs.existsSync(path.join(f.targets.dataRoot,'openchamber-progress')),false);
    assert.equal(fs.existsSync(path.join(path.dirname(file),'progress-binding.json')),false);
  }finally{await cold?.close();await f.close();}
});

test('cold fresh begin already unlinked before worker exit follows ordinary replay',async()=>{
  const f=await freshHttpFixture('default');let cold:Awaited<ReturnType<typeof coldHttp>>|undefined;
  try{
    const review=await f.inspect(),begin={version:2,action:'begin',operationId,confirmed:true,expected:review.expected} as const;
    f.fault({crashStep:'prepare',order:'unlinked'});assert.equal((await f.step(begin)).status,503);
    const file=migrationFile(f.env),bytes=fs.readFileSync(file);
    assert.equal(fs.statSync(file).nlink,1);assert.equal(fs.existsSync(`${file}.stage-prepare-${digest(bytes)}`),false);
    assert.equal(fs.existsSync(f.targets.storeRoot),false);
    f.fault({});cold=await coldHttp(f.env);
    const replay=await cold.step(begin);assert.equal(replay.status,200);assert.equal(replay.body.disposition,'replayed');
    assert.equal(replay.body.progress.sequence,1);assert.deepEqual(fs.readFileSync(file),bytes);
    assert.equal(fs.existsSync(f.targets.storeRoot),false);
  }finally{await cold?.close();await f.close();}
});

test('cold begin unlink failure reports the retained checkpoint and allows an exact retry',async()=>{
  const f=await freshHttpFixture();let cold:Awaited<ReturnType<typeof coldHttp>>|undefined;
  try{
    const review=await f.inspect(),begin={version:2,action:'begin',operationId,confirmed:true,expected:review.expected} as const;
    f.fault({crashStep:'prepare',order:'linked'});assert.equal((await f.step(begin)).status,503);
    const file=migrationFile(f.env),bytes=fs.readFileSync(file),stage=`${file}.stage-prepare-${digest(bytes)}`;
    f.fault({unlinkCode:'EPERM'});cold=await coldHttp(f.env);
    const refused=await cold.step(begin);
    assert.equal(refused.status,503);
    assert.equal(refused.body.disposition,'refused');
    assert.deepEqual(refused.body.error,{stage:'prepare',code:'EPERM'});
    assert.equal(refused.body.progress.operationId,operationId);
    assert.equal(refused.body.progress.sequence,1);assert.equal(nextAction(refused.body.progress),'continue');
    assert.equal(fs.statSync(file).nlink,2);assert.equal(fs.statSync(stage).nlink,2);
    assert.deepEqual(fs.readFileSync(file),bytes);assert.deepEqual(fs.readFileSync(stage),bytes);
    f.fault({});
    const replay=await cold.step(begin);
    assert.equal(replay.status,200);assert.equal(replay.body.disposition,'replayed');assert.equal(replay.body.progress.sequence,1);
    assert.equal(fs.existsSync(stage),false);assert.equal(fs.statSync(file).nlink,1);
    assert.deepEqual(fs.readFileSync(file),bytes);assert.equal(fs.existsSync(f.targets.storeRoot),false);
  }finally{await cold?.close();await f.close();}
});

for(const kind of ['default','custom','retained-new','retained-reuse'] as const)test(`HTTP fresh ${kind} review, cancellation, lost reply, pause and completion`,async t=>{
  const f=await freshHttpFixture(kind,true);try{
    const before=fs.existsSync(f.database)?fs.readFileSync(f.database):null;
    const review=await f.inspect();assert.equal(review.planKind,'fresh');assert.equal(review.storeMode,before?'retain':'create');
    assert.equal(fs.existsSync(path.dirname(migrationFile(f.env))),false);
    const empty=await f.http('/v1/setup');assert.equal(empty.body.configured,false);assert.equal(empty.body.delivery.freshProgress,undefined);
    assert.equal(empty.body.delivery.migration,'none');assert.equal(empty.body.delivery.migrationProgress,undefined);
    assert.equal(review.capture.state,before?'on':'unknown');
    assert.equal(review.capture.observedAt===null,!before);
    if(before)assert.deepEqual(fs.readFileSync(f.database),before);else assert.equal(fs.existsSync(f.database),false);
    // Abandon the read-only review, then explicitly inspect/confirm a new one.
    let r=await f.begin();assert.equal(r.status,200,JSON.stringify(r.body.error));let p=r.body.progress!;
    assert.equal(p.capture.state,'unknown');assert.deepEqual(p.lastCompleted,{name:'prepare',batch:0});
    if(!before)assert.equal(fs.existsSync(f.database),false);
    const replayBegin=await f.step({version:2,action:'begin',operationId,confirmed:true,expected:readManagedFreshStepJournal(f.env)!.migration.consent.reviewDigest});
    assert.equal(replayBegin.body.disposition,'replayed');
    assert.equal((await f.http('/v1/setup/managed-step',{version:1,action:'inspect'})).status,200);
    const afterOtherInspection=await f.step({version:2,action:'begin',operationId,confirmed:true,expected:readManagedFreshStepJournal(f.env)!.migration.consent.reviewDigest});
    assert.equal(afterOtherInspection.body.disposition,'replayed','an unrelated inspection cannot revoke a durable begin receipt');
    r=await f.control('pause',p);assert.equal(r.status,200);p=r.body.progress!;
    assert.equal((await f.advance(p)).status,409);assert.equal(fs.existsSync(f.database),!!before);
    r=await f.control('resume',p);assert.equal(r.status,200);p=r.body.progress!;
    while(p.state!=='complete'){
      r=await f.advance(p);assert.equal(r.status,200,JSON.stringify(r.body.error));
      const replay=await f.advance(p);assert.equal(replay.body.disposition,'replayed');
      p=r.body.progress!;
      const observed=await f.http('/v1/setup');assert.equal(observed.status,200);assert.equal(observed.body.delivery.migrationProgress,undefined);
      assert.equal(observed.body.delivery.freshProgress.sequence,p.sequence);assert.deepEqual(observed.body.delivery.freshProgress.plan,review.plan);
      if(!before&&p.lastCompleted!.name!=='enable'&&p.state!=='complete')assert.notEqual(observed.body.captureEnabled,true);
    }
    assert.equal(f.capture(),true);
    const disabled=await f.http('/v1/capture/disable',{});assert.equal(disabled.status,200);assert.equal(f.capture(),false);
    assert.equal((await f.control('resume',p)).status,409);assert.equal(f.capture(),false);
    t.diagnostic(JSON.stringify({kind,requests:f.counts}));
  }finally{await f.close();}
});

test('fresh retained-source reconnection replaces only its older same-install expectation',async()=>{
  const f=await freshHttpFixture('retained-reuse',false);try{
    const store=new Store(f.database),state=store.list();store.close();
    const source=state.sources.find(s=>s.configRoot===f.targets.configRoot)!;
    const binding={protocolVersion:2 as const,schemaVersion:2 as const,version:payload.version,database:f.database,storeId:state.storeId,source,
      installId:`managed-${digest(JSON.stringify([state.storeId,source]))}`};
    const old={format:1 as const,storeId:binding.storeId,sourceId:source.id,installId:binding.installId,version:'1.1.1',fingerprint:'a'.repeat(64)};
    writeManagedExpectation(binding,old);
    const review=await f.inspect();assert.equal(review.sourceMode,'reuse');assert.equal(review.packageVersion,payload.version);
    assert.deepEqual(readManagedExpectation(binding),old,'inspection is read-only');
    let r=await f.step({version:2,action:'begin',operationId,confirmed:true,expected:review.expected});
    assert.equal(r.status,200,JSON.stringify(r.body.error));let p=r.body.progress!;
    assert.deepEqual(readManagedExpectation(binding),old,'begin does not replace the expectation');
    while(p.state!=='complete'){
      r=await f.advance(p);assert.equal(r.status,200,JSON.stringify(r.body.error));p=r.body.progress!;
    }
    const expected=readManagedExpectation(binding)!;assert.equal(expected.version,payload.version);assert.notEqual(expected.fingerprint,old.fingerprint);
    const after=new Store(f.database);try{assert.deepEqual(after.list().sources,state.sources);assert.equal(after.list().storeId,state.storeId);assert.equal(after.list().captureEnabled,false);}finally{after.close();}
    // Once checkpointed, even same-identity old bytes cannot be substituted.
    const changed=await freshHttpFixture('retained-reuse',false);try{
      let q=(await changed.begin()).body.progress!;q=(await changed.advance(q)).body.progress!;
      const journal=readManagedFreshStepJournal(changed.env)!;
      const bytes=fs.readFileSync(migrationFile(changed.env));
      writeManagedExpectation(journal,{...readManagedExpectation(journal)!,version:old.version,fingerprint:old.fingerprint});
      const refused=await changed.advance(q);assert.equal(refused.status,409);assert.equal(refused.body.error!.code,'managed-review-stale');
      assert.deepEqual(fs.readFileSync(migrationFile(changed.env)),bytes);
    }finally{await changed.close();}
  }finally{await f.close();}
});

test('completed fresh creation remains verified after another source joins the shared Store',async()=>{
  const f=await freshHttpFixture();try{
    let p=(await f.begin()).body.progress!;
    while(p.state!=='complete'){const r=await f.advance(p);assert.equal(r.status,200,JSON.stringify(r.body.error));p=r.body.progress!;}
    const store=new Store(f.database);try{
      store.registerSource({id:'second-source',configRoot:path.join(f.root,'second-config'),dataRoot:path.join(f.root,'second-data'),verified:true});
    }finally{store.close();}
    const read=await setupCall(f.host,null);assert.ok(read.ok);
    assert.equal(read.setup.verified,true);assert.equal(read.setup.captureEnabled,true);
    assert.equal(read.setup.delivery!.freshProgress!.state,'complete');assert.deepEqual(read.setup.diagnostics,[]);
    for(const enabled of [false,true]){
      const control=await setupCall(f.host,enabled?'managed-enable':'managed-disable',null,true,undefined,read.setup.delivery!.managedMigrationSteps);
      assert.ok(control.ok,JSON.stringify(control));assert.equal(control.setup.verified,true);assert.equal(control.setup.captureEnabled,enabled);
    }
  }finally{await f.close();}
});

for(const routes of ['windows','native'] as const)test(`completed fresh identity checks (${routes==='native'?'native Linux':'projected Windows'})`,
  {skip:routes==='native'&&process.platform!=='linux'},async()=>{
  const f=await freshHttpFixture('custom',false,routes);try{
    const file=migrationFile(f.env),selector=managedBindingFile(f.env);
    const change=(original:Buffer,claim:'directory'|'database',field:'device'|'inode'|'birthNs')=>{
      const journal=JSON.parse(original.toString());
      const object=journal.migration.created[claim].object;
      object[field]=String(BigInt(object[field])+1n);
      return Buffer.from(JSON.stringify(journal));
    };
    const observe=async(bytes:Buffer,code:string|null)=>{
      fs.writeFileSync(file,bytes);
      const read=await f.http('/v1/setup');
      const health=await f.http('/health');
      assert.equal(read.status,200);
      assert.equal(read.body.configured,true);
      assert.equal(read.body.verified,!code);
      assert.deepEqual(read.body.diagnostics,code?[code]:[]);
      assert.equal(read.body.captureEnabled,code?null:true);
      if(code)assert.equal(read.body.reportingIdentity,undefined);
      else {
        assert.equal(read.body.reportingIdentity?.verified,true);
        assert.equal(read.body.delivery.freshProgress.state,'complete');
        assert.equal(read.body.delivery.migration,'complete');
      }
      assert.equal(health.status,200);
      assert.equal(health.body.ready,!code);
      assert.equal(health.body.state,code?'refused':'ready');
      assert.deepEqual(health.body.diagnostics,code?[code]:[]);
      assert.deepEqual(fs.readFileSync(file),bytes,'status must not rewrite historical evidence');
    };
    const next=async(p:ManagedFreshStepProgress)=>{
      const r=await f.advance(p);assert.equal(r.status,200,JSON.stringify(r.body.error));return r.body.progress!;
    };
    const begun=await f.begin();assert.equal(begun.status,200,JSON.stringify(begun.body.error));
    let p=begun.body.progress!;
    while(p.lastCompleted?.name!=='publish-binding')p=await next(p);
    if(routes==='windows'){
      const unfinished=fs.readFileSync(file),changed=change(unfinished,'directory','device');
      await observe(changed,'managed-migration-conflict');
      const advance=await f.advance(p);
      assert.equal(advance.body.error?.code,'managed-migration-conflict');
      assert.deepEqual(fs.readFileSync(file),changed);
      fs.writeFileSync(file,unfinished);
    }
    while(p.state!=='complete')p=await next(p);
    const completed=fs.readFileSync(file);
    if(routes==='windows'){
      // Cold admission must not remember the selection from the unfinished read.
      const cold=await coldHttp(f.env);
      const moved=path.join(f.root,'unselected.json');
      try{
        fs.renameSync(selector,moved);
        const changed=change(completed,'directory','device');
        fs.writeFileSync(file,changed);
        const read=await cold.http('/v1/setup'),health=await cold.http('/health');
        assert.equal(read.status,200);
        assert.equal(read.body.configured,false);
        assert.equal(read.body.verified,false);
        assert.equal(read.body.reportingIdentity,undefined);
        assert.deepEqual(read.body.diagnostics,['managed-migration-conflict']);
        assert.equal(health.body.state,'refused');
        assert.equal(fs.existsSync(selector),false);
        assert.deepEqual(fs.readFileSync(file),changed);
      }finally{await cold.close();if(fs.existsSync(moved))fs.renameSync(moved,selector);}
    }
    await observe(completed,null);
    for(const claim of ['directory','database'] as const)await observe(change(completed,claim,'device'),null);
    await observe(change(completed,'directory','inode'),'managed-migration-conflict');
    await observe(change(completed,'database','birthNs'),'managed-migration-conflict');
    if(routes==='windows'){
      const db=new DatabaseSync(f.database);
      try{db.prepare('UPDATE meta SET store_id=? WHERE singleton=1').run('different-store');}finally{db.close();}
      await observe(change(completed,'database','device'),'managed-source-conflict');
    }
  }finally{await f.close();}
});

test('Windows old fresh routes refuse before body parsing, security, workers and writes',async()=>{
  const f=await freshHttpFixture();try{
    let workers=0;const dispatch=f.setup.request.bind(f.setup);f.setup.request=async(...args)=>{workers++;return dispatch(...args);};
    const before=legacySpawns;
    for(const action of ['managed-inspect','managed-configure']){
      const r=await fetch(f.url+'/v1/setup/'+action,{method:'POST',headers:{authorization:'Bearer synthetic-http-fixture'},body:'not JSON',signal:AbortSignal.timeout(1500)});
      assert.equal(r.status,409);assert.deepEqual(await r.json(),{error:'managed-action-required'});
    }
    assert.equal(workers,0);assert.equal(legacySpawns,before);assert.equal(fs.existsSync(f.database),false);
    assert.equal(fs.existsSync(path.dirname(migrationFile(f.env))),false);
    const health=await f.http('/health');assert.equal(health.body.managedFreshSteps,1);assert.equal(health.body.managedMigrationSteps,1);assert.equal(health.body.state,'starting');
    assert.equal(workers,0);assert.equal(legacySpawns,before);
  }finally{await f.close();}
});

for(const order of ['before','after'])test(`fresh prepare worker crash ${order} publication recovers only by explicit begin`,async()=>{
  const f=await freshHttpFixture();try{
    const review=await f.inspect(),request={version:2 as const,action:'begin' as const,operationId,confirmed:true as const,expected:review.expected};
    f.fault({crashStep:'prepare',order});assert.equal((await f.step(request)).status,503);f.fault({});
    assert.equal(fs.existsSync(f.database),false);assert.equal(fs.existsSync(f.targets.storeRoot),false);
    const observed=await f.http('/v1/setup');assert.equal(observed.status,200);assert.equal(observed.body.configured,false);
    assert.equal(observed.body.delivery.migrationProgress,undefined);
    assert.ok(!observed.body.delivery.freshProgress||observed.body.delivery.freshProgress.lastCompleted!==null);
    if(order==='after'){
      assert.equal(observed.body.delivery.freshProgress.sequence,1);
      const worker=pathToFileURL(path.join(projection,'tests/backend/managed-http-worker.ts'));
      const cold=new Controller({env:f.env},()=>payload,undefined,undefined,worker);
      try{const r=await cold.request({action:'managed-step',body:request});assert.ok(r.ok);assert.equal((r.value as ManagedFreshStepResponse).disposition,'replayed');}
      finally{cold.close();}
    }else {assert.equal(observed.body.delivery.freshProgress,undefined);assert.equal((await f.begin()).status,200);}
    assert.equal(fs.existsSync(f.database),false);
  }finally{await f.close();}
});

test('fresh HTTP stale review, unsupported family and changed creation target refuse without writes',async()=>{
  const f=await freshHttpFixture();try{
    const review=await f.inspect();fs.mkdirSync(f.targets.storeRoot,{mode:0o700});
    const stale=await f.step({version:2,action:'begin',operationId,confirmed:true,expected:review.expected});
    assert.equal(stale.status,409);assert.equal(fs.existsSync(f.database),false);assert.equal(fs.existsSync(path.dirname(migrationFile(f.env))),false);
    // Reviewed existing empty directory is a different consent, not adoption of
    // the old absence claim. Explicitly review and confirm that new target.
    const begun=await f.begin();assert.equal(begun.status,200);
    const bytes=fs.readFileSync(migrationFile(f.env));
    for(const body of [{version:1,action:'status',operationId},{version:1,action:'pause',operationId,expectedSequence:1},
      {version:1,action:'advance',operationId,expectedSequence:1,step:{name:'expectation',batch:0}}]){
      const r=await f.http('/v1/setup/managed-step',body);assert.equal(r.status,409);assert.equal(r.body.version,1);assert.equal(r.body.disposition,'refused');
      assert.equal(r.body.progress,null);assert.deepEqual(fs.readFileSync(migrationFile(f.env)),bytes);
    }
    const roots=await f.http('/v1/setup/managed-step',{version:1,action:'inspect'});assert.equal(roots.status,200);
    const family=await f.http('/v1/setup/managed-step',{version:1,action:'inspect',cursor:roots.body.inspection.cursor});
    assert.equal(family.status,409);assert.equal(family.body.error.code,'managed-journal-unsupported');assert.deepEqual(fs.readFileSync(migrationFile(f.env)),bytes);
    fs.writeFileSync(f.database,'unproven partial database',{mode:0o600});const partial=fs.readFileSync(f.database);
    const refused=await f.advance(begun.body.progress!);assert.notEqual(refused.status,200);
    assert.deepEqual(fs.readFileSync(f.database),partial);assert.deepEqual(fs.readFileSync(migrationFile(f.env)),bytes);
  }finally{await f.close();}
});

test('fresh wire refuses a retained migration journal without translating or mutating it',async()=>{
  const f=await fixture();try{
    const p=(await f.begin()).body.progress!,bytes=fs.readFileSync(migrationFile(f.env));
    for(const body of [{version:2,action:'status',operationId},{version:2,action:'pause',operationId,expectedSequence:p.sequence},
      {version:2,action:'begin',operationId,confirmed:true,expected:'a'.repeat(64)}]){
      const r=await f.http('/v1/setup/managed-step',body);assert.equal(r.status,409);assert.equal(r.body.version,2);assert.equal(r.body.progress,null);
      assert.equal(r.body.error.code,'managed-journal-unsupported');assert.equal(r.body.accounting.securitySpawns,0);assert.deepEqual(fs.readFileSync(migrationFile(f.env)),bytes);
    }
  }finally{await f.close();}
});

for(const order of ['before','after'])test(`fresh HTTP restart ${order} each effect requires explicit recovery`,async()=>{
  for(const name of ['store-directory','create-store','expectation','register-source','publish-binding','enable','reconcile']){
    const f=await freshHttpFixture();try{
      await f.begin();const p=await f.until(name),request={version:2 as const,action:'advance' as const,operationId,expectedSequence:p.sequence,step:p.step!};
      f.fault({crashStep:name,order});assert.equal((await f.step(request)).status,503);f.fault({});
      const retained=readManagedFreshStepJournal(f.env)!;assert.equal(retained.migration.state,'running');assert.equal(retained.migration.step!.name,name);
      if(name==='store-directory'&&order==='after'){
        const observed=await f.http('/v1/setup');
        assert.equal(observed.status,200);assert.equal(observed.body.delivery.planKind,'fresh');
        assert.equal(observed.body.delivery.migration,'unavailable');assert.equal(observed.body.delivery.freshProgress,undefined);
        assert.deepEqual(observed.body.diagnostics,['managed-migration-conflict']);assert.equal(observed.body.captureEnabled,null);
        const r=await f.control('resume',await f.status());assert.equal(r.status,409);assert.equal(fs.existsSync(f.database),false);continue;
      }
      // Another supervisor represents restart: only read observation first;
      // replay/begin/control never runs a following effect automatically.
      const worker=pathToFileURL(path.join(projection,'tests/backend/managed-http-worker.ts'));
      const cold=new Controller({env:f.env},()=>payload,undefined,undefined,worker);
      const observed=await cold.request({action:'status'});assert.equal(observed.ok,true);
      if(observed.ok)assert.equal((observed.value as any).delivery.freshProgress.state,'running');
      let review:Extract<ManagedFreshStepRequest,{action:'resume'}>['review'];
      if(name==='enable'&&order==='before')review={confirmed:true,step:'enable',expected:(await f.inspect()).expected};
      const resumed=await f.control('resume',await f.status(),review);assert.equal(resumed.status,200,JSON.stringify(resumed.body.error));
      const recovered=await f.advance(resumed.body.progress!);assert.equal(recovered.status,200,JSON.stringify(recovered.body.error));
      if(name==='reconcile')assert.equal(recovered.body.progress!.state,'complete');
      cold.close();
    }finally{await f.close();}
  }
});

test('fresh custom Store fence covers reviewed begin across scopes and a busy worker',async()=>{
  const f=await freshHttpFixture(),other=await freshHttpFixture();let holding:ReturnType<typeof f.advance>|undefined;
  try{
    other.targets.storeRoot=f.targets.storeRoot;const review=await other.inspect();
    const p=(await f.begin()).body.progress!;f.fault({hold:true});holding=f.advance(p);
    const deadline=Date.now()+5000;while(!fs.existsSync(f.env.TEST_READY_FILE!)&&Date.now()<deadline)await delay(10);assert.ok(fs.existsSync(f.env.TEST_READY_FILE!));
    const health=await f.http('/health');assert.equal(health.status,200);assert.equal(health.body.ready,false);
    const busy=await f.control('pause',p);assert.equal(busy.status,503);assert.equal(busy.body.error!.stage,'lock');assert.equal(busy.body.accounting.securitySpawns,0);
    const shared=await other.step({version:2,action:'begin',operationId,confirmed:true,expected:review.expected});
    assert.equal(shared.status,503);assert.equal(shared.body.error!.code,'managed-step-port-busy');assert.equal(shared.body.accounting.securitySpawns,0);
    assert.equal(fs.existsSync(f.targets.storeRoot),false);assert.equal(fs.existsSync(path.dirname(migrationFile(other.env))),false);
    fs.writeFileSync(f.env.TEST_RELEASE_FILE!,'release');f.fault({});assert.equal((await holding).status,200);holding=undefined;
    assert.equal(fs.existsSync(f.database),false);assert.equal(fs.existsSync(f.targets.storeRoot),true);
  }finally{if(holding){fs.writeFileSync(f.env.TEST_RELEASE_FILE!,'release');await holding;}await other.close();await f.close();}
});

test('fresh response deadline keeps its custom Store fenced until actual worker exit',async()=>{
  const f=await freshHttpFixture();try{
    const p=(await f.begin()).body.progress!,dispatch=f.setup.request.bind(f.setup);let first=true;
    f.setup.request=(r,start)=>dispatch(r,first?(first=false,process.hrtime.bigint()-16_000_000_000n):start);
    f.fault({hold:true});const waiting=f.advance(p);
    const deadline=Date.now()+5000;while(!fs.existsSync(f.env.TEST_READY_FILE!)&&Date.now()<deadline)await delay(10);assert.ok(fs.existsSync(f.env.TEST_READY_FILE!));
    const expired=await waiting;assert.equal(expired.status,503);assert.equal(expired.body.version,2);assert.equal(expired.body.error!.code,'managed-step-deadline');
    assert.equal((await f.control('resume',p)).body.error!.code,'managed-step-unsettled');
    await assert.rejects(acquireWriterSlots(f.setup.writerTargets({storeRoot:f.targets.storeRoot})),{code:'managed-step-port-busy'});
    assert.equal((await f.http('/health')).status,200);assert.equal(fs.existsSync(f.targets.storeRoot),false);
    fs.writeFileSync(f.env.TEST_RELEASE_FILE!,'release');f.fault({});
    const until=Date.now()+5000;let settled=false;
    while(Date.now()<until){const r=await f.step({version:2,action:'status',operationId});if(r.status===200){assert.equal(r.body.progress!.sequence,p.sequence);settled=true;break;}await delay(10);}
    assert.ok(settled);assert.equal(fs.existsSync(f.targets.storeRoot),false);
  }finally{await f.close();}
});

test('fresh StepDriver cancels, confirms, pauses, loses a creation reply and explicitly resumes to completion',async()=>{
  const f=await freshHttpFixture();try{
    const requests:ManagedSetupStepRequest[]=[];let pause=true,drop=true,inflight=0,maxInflight=0;
    const driver=new StepDriver<ManagedSetupStepRequest>({context:()=> 'synthetic-fresh-context',changed:()=>{},refresh:()=>{},operationId:()=>operationId,
      send:async(r)=>{requests.push(r);inflight++;maxInflight=Math.max(maxInflight,inflight);try{
        const result=await managedStepCall(f.host,r);
        if(r.action==='begin'&&pause){pause=false;driver.requestPause();await driver.confirmStop(null);}
        if(r.action==='advance'&&r.step.name==='create-store'&&drop){drop=false;return {kind:'dropped'};}
        return result;
      }finally{inflight--;}}});
    await driver.inspect('begin',{family:'fresh',storeRoot:f.targets.storeRoot});assert.equal(driver.state.review?.kind,'begin');
    driver.cancelReview();assert.equal(driver.state.review,null);assert.equal(fs.existsSync(path.dirname(migrationFile(f.env))),false);
    await driver.inspect('begin',{family:'fresh',storeRoot:f.targets.storeRoot});await driver.confirmBegin();assert.equal(fs.existsSync(f.database),false,'acknowledgement is required');
    driver.setAck(true);await driver.confirmBegin();assert.equal(driver.state.progress!.state,'paused');assert.equal(driver.state.progress!.capture.state,'unknown');assert.equal(fs.existsSync(f.targets.storeRoot),false);
    await driver.resume(driver.state.progress);assert.equal(driver.state.outcome!.uncertain,true);assert.equal(driver.state.outcome!.code,'managed-step-no-reply');
    assert.equal(fs.existsSync(f.database),true);assert.equal(f.capture(),false);
    const sent=requests.length;await driver.status(driver.state.progress);assert.equal(requests.length,sent+1);assert.equal(driver.state.progress!.step!.name,'expectation');assert.equal(f.capture(),false);
    const read=parseSetup(JSON.stringify((await f.http('/v1/setup')).body))!;assert.equal(read.delivery!.freshProgress!.capture.state,'off');assert.equal(read.delivery!.migrationProgress,undefined);
    await driver.continueRun(driver.state.progress);assert.equal(driver.state.progress!.state,'complete');assert.equal(driver.state.outcome,null);assert.equal(f.capture(),true);
    assert.equal(maxInflight,1);assert.ok(requests.every(r=>r.version===2));
  }finally{await f.close();}
});

for(const kind of ['retained-new','retained-reuse'] as const)test(`fresh StepDriver ${kind} reconnects with capture off preserved`,async()=>{
  const f=await freshHttpFixture(kind,false);try{
    const requests:ManagedSetupStepRequest[]=[];
    const driver=new StepDriver<ManagedSetupStepRequest>({context:()=> 'synthetic-fresh-context',changed:()=>{},refresh:()=>{},operationId:()=>operationId,
      send:r=>{requests.push(r);return managedStepCall(f.host,r);}});
    await driver.inspect('begin',{family:'fresh',storeRoot:f.targets.storeRoot});driver.setAck(true);await driver.confirmBegin();
    assert.equal(driver.state.progress!.state,'complete',JSON.stringify(driver.state.outcome));assert.equal(f.capture(),false);
    assert.ok(!requests.some(r=>r.action==='advance'&&['store-directory','create-store','enable'].includes(r.step.name)));
    const status=parseSetup(JSON.stringify((await f.http('/v1/setup')).body))!;assert.equal(status.captureEnabled,false);assert.equal(status.delivery!.freshProgress!.state,'complete');
  }finally{await f.close();}
});

for(const order of ['before','after'])test(`fresh StepDriver uncertain enable ${order} reconciles without overriding a later disable`,async()=>{
  const f=await freshHttpFixture();try{
    const requests:ManagedSetupStepRequest[]=[];
    const driver=new StepDriver<ManagedSetupStepRequest>({context:()=> 'synthetic-fresh-context',changed:()=>{},refresh:()=>{},operationId:()=>operationId,
      send:r=>{requests.push(r);return managedStepCall(f.host,r);}});
    await driver.inspect('begin',{family:'fresh',storeRoot:f.targets.storeRoot});driver.setAck(true);f.fault({capture:order});await driver.confirmBegin();f.fault({});
    assert.equal(driver.state.progress!.state,'failed');assert.equal(driver.state.progress!.step!.name,'enable');
    const observed=parseSetup(JSON.stringify((await f.http('/v1/setup')).body))!.delivery!.freshProgress!;
    assert.equal(f.capture(),order==='after');
    if(order==='before'){
      assert.equal(observed.recovery,'review');await driver.inspect('capture',{progress:observed});assert.equal(driver.state.review!.kind,'capture');
      driver.setAck(true);await driver.confirmCapture();
    }else await driver.resume(observed);
    assert.equal(driver.state.progress!.state,'complete',JSON.stringify(driver.state.outcome));assert.equal(f.capture(),true);
    assert.equal((await f.http('/v1/capture/disable',{})).status,200);assert.equal(f.capture(),false);
    const enable=requests.findLast(r=>r.action==='advance'&&r.step.name==='enable')!;
    const replay=await f.http('/v1/setup/managed-step',enable);assert.equal(replay.status,409);assert.equal(f.capture(),false);
    assert.equal(requests.filter(r=>r.action==='resume'&&r.review).length,order==='before'?1:0);
  }finally{await f.close();}
});

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

for(const kind of ['receipt','empty'] as const)test(`Setup UI client capture controls after ${kind==='receipt'?'completed migration':'fresh managed setup'}`,async()=>{
  const f=await fixture(kind);try{
    if(kind==='receipt'){
      let p=(await f.begin()).body.progress!;while(p.state!=='complete')p=(await f.advance(p)).body.progress!;
    }else{
      const review=(await f.http('/v1/setup/managed-inspect',{storeRoot:f.targets.storeRoot})).body.delivery.review;
      assert.equal((await f.http('/v1/setup/managed-configure',{storeRoot:f.targets.storeRoot,confirmed:true,expected:review.expected})).status,200);
    }
    const read=await setupCall(f.host,null);assert.ok(read.ok);
    const capability=read.setup.delivery!.managedMigrationSteps;assert.equal(capability,1);
    const requests:Array<{path:string;body?:string}>=[];
    const host={serviceRequest:async(q:Parameters<typeof f.host.serviceRequest>[0])=>{requests.push(q);return f.host.serviceRequest(q);}};
    for(const enabled of [false,true]){
      const result=await setupCall(host,enabled?'managed-enable':'managed-disable',null,true,undefined,capability);
      assert.ok(result.ok,JSON.stringify(result));assert.equal(result.setup.captureEnabled,enabled);assert.equal((await f.http('/v1/setup')).body.captureEnabled,enabled);
    }
    assert.deepEqual(requests.map(q=>q.path),['/v1/capture/disable','/v1/setup','/v1/capture/enable','/v1/setup']);
    assert.ok(requests.every(q=>!Object.hasOwn(q,'body')),'capture routes reject even JSON consent bodies');
    const count=requests.length;
    assert.deepEqual(await setupCall(host,'managed-disable',null,false,undefined,capability),{ok:false,code:'confirmation-required'});
    assert.equal(requests.length,count,'UI confirmation must gate the bodyless mutation');
    const release=await acquireWriterSlots(f.setup.writerTargets());
    try{
      const result=await setupCall(host,'managed-disable',null,true,undefined,capability);
      assert.deepEqual(result,{ok:false,code:'managed-step-port-busy'});
    }finally{await release();}
    assert.equal((await f.http('/v1/setup')).body.captureEnabled,true);
    for(const code of ['private-permissions','path-unverified']){
      f.fault({platformCode:code});
      assert.deepEqual(await setupCall(host,'managed-disable',null,true,undefined,capability),{ok:false,code});
    }
    f.fault({});
  }finally{await f.close();}
});

test('real HTTP UI hide/show drops a held step reply until explicit Continue',async()=>{
  const f=await fixture();try{
    let context:string|null='["account","page",null,null]';
    let release!:()=>void,arrived!:()=>void;
    const held=new Promise<void>(r=>{release=r;}),ready=new Promise<void>(r=>{arrived=r;});
    const requests:ManagedStepRequest[]=[];
    const driver=new StepDriver({context:()=>context,changed:()=>{},refresh:()=>{},operationId:()=>operationId,
      send:async(r)=>{requests.push(r);const reply=await managedStepCall(f.host,r);if(r.action==='advance'&&r.step.name==='expectation'){arrived();await held;}return reply;}});
    driver.observe(context,'account');await driver.inspect('begin');driver.setAck(true);
    const running=driver.confirmBegin();await ready;
    const key=context;context=null;driver.observe(null,'account');context=key;driver.observe(key,'account');
    release();await running;
    assert.equal(requests.at(-1)?.action,'advance');assert.equal(requests.filter(r=>r.action==='advance').length,1);
    assert.equal(f.capture(),true,'no disable after returning to the view');
    const read=await setupCall(f.host,null);assert.ok(read.ok);
    const shown=currentProgress(driver.state.progress,read.setup.delivery!.migrationProgress)!;
    assert.equal(shown.step?.name,'disable');assert.equal(nextAction(shown),'continue');
    await driver.continueRun(shown);assert.equal(driver.state.progress?.state,'complete');
  }finally{await f.close();}
});

for(const name of ['disable','enable'] as const)test(`real HTTP UI refreshes failed ${name} at the same sequence before capture review`,async()=>{
  const f=await fixture();try{
    await f.begin();const before=await f.until(name);f.fault({capture:'before'});
    const driver=new StepDriver({context:()=> 'synthetic-context',changed:()=>{},refresh:()=>{},send:(r)=>managedStepCall(f.host,r)});
    await driver.continueRun(before);f.fault({});
    const failed=driver.state.progress!;
    assert.equal(failed.state,'failed');assert.equal(failed.capture.state,'unknown');assert.equal(nextAction(failed),'resume');
    const read=await setupCall(f.host,null);assert.ok(read.ok);
    const observed=read.setup.delivery!.migrationProgress!;assert.equal(observed.sequence,failed.sequence);
    const shown=currentProgress(failed,observed)!;
    assert.equal(shown.capture.state,name==='disable'?'on':'off');assert.equal(nextAction(shown),'review');
    await driver.inspect('capture',{progress:shown});assert.equal(driver.state.review?.kind,'capture');
    await driver.confirmCapture();assert.equal(driver.state.progress!.sequence,failed.sequence,'no capture review submission without acknowledgement');
    driver.setAck(true);await driver.confirmCapture();assert.equal(driver.state.progress?.state,'complete');assert.equal(f.capture(),true);
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
      assert.equal(spawns,0);assert.ok(performance.now()-started<=8000);
    }
    assert.equal(fs.existsSync(f.env.TEST_READY_FILE!),false);assert.equal(fs.existsSync(migrationFile(f.env)),false);
    assert.deepEqual(fs.readFileSync(path.join(f.targets.storeRoot,'progress.sqlite')),before);
    t.diagnostic(JSON.stringify({kind:'legacy-refusal',counts}));
  }finally{await f.close();}
});

test('HTTP fresh inspection and configuration retain legacy consent and start no process',async t=>{
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
    assert.equal(inspectSpawns,0);assert.equal(configureSpawns,0);
    assert.equal((await f.http('/v1/setup')).body.configured,true);
    t.diagnostic(JSON.stringify({kind:'fresh',inspectSpawns,configureSpawns}));
  }finally{await f.close();}
});

test('HTTP legacy refusal with the native concurrent-health observer never enters its main-thread hold',async t=>{
  const f=await fixture();let service:Awaited<ReturnType<typeof nativeService>>|undefined;
  try{
    service=await nativeService({...f.env,SystemRoot:'C:\\Windows'},o=>t.diagnostic(JSON.stringify({phase:o.phase,status:o.status,error:o.value.error,counts:o.counts})),path.join(projection,'service/main.ts'));
    const r=await service.request('/v1/setup/managed-inspect',{},'legacy-inspect',{expectedStatus:409,maxSpawns:0});
    assert.deepEqual(r.value,{error:'managed-action-required'});
    assert.equal(r.counts.workers,0);assert.equal(r.counts.legacyReads,0);
    assert.equal(fs.existsSync(migrationFile(f.env)),false);
  }finally{await service?.stop();await f.close();}
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
    const before=legacySpawns;
    for(const route of ['managed-inspect','managed-configure']){
      const r=await f.http('/v1/setup/'+route,route==='managed-inspect'?{}:{confirmed:true,expected:'a'.repeat(64)});
      assert.equal(r.status,409);assert.deepEqual(r.body,{error:'managed-action-required'});
    }
    assert.equal(fs.readFileSync(migrationFile(f.env),'utf8'),'unknown journal');assert.equal(fs.existsSync(f.targets.storeRoot),false);
    assert.equal(legacySpawns,before,'journal presence refusal starts no process');
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

test('HTTP absent presence hint cannot authorize configuration when legacy appears during fresh validation',async t=>{
  const f=await fixture('empty');try{
    const review=(await f.http('/v1/setup/managed-inspect',{storeRoot:f.targets.storeRoot})).body.delivery.review;
    const legacy=path.join(f.targets.configRoot,'plugins/agent-progress');
    // The first canonical path resolution happens only in the full validation,
    // after the presence hint found nothing: make legacy appear exactly then.
    const real=fs.realpathSync.native;let appeared=false;
    t.mock.method(fs.realpathSync,'native',((...args:Parameters<typeof real>)=>{if(!appeared){appeared=true;fs.mkdirSync(legacy,{recursive:true,mode:0o700});}return real(...args);}) as typeof real);
    const result=await f.http('/v1/setup/managed-configure',{storeRoot:f.targets.storeRoot,confirmed:true,expected:review.expected});
    assert.equal(appeared,true,'legacy appeared during fresh validation');
    assert.equal(result.status,409);assert.deepEqual(result.body,{error:'managed-action-required'});
    assert.equal(fs.existsSync(f.targets.storeRoot),false);assert.equal(fs.existsSync(path.dirname(migrationFile(f.env))),false);
    assert.deepEqual(fs.readdirSync(legacy),[]);
  }finally{t.mock.restoreAll();await f.close();}
});

test('HTTP empty Setup omits progress and does not create metadata',async()=>{
  const f=await fixture('empty');try{
    const read=await f.http('/v1/setup');assert.equal(read.status,200);assert.equal(read.body.delivery.managedMigrationSteps,1);
    assert.equal(Object.hasOwn(read.body.delivery,'migrationProgress'),false);assert.equal(read.body.captureEnabled,null);
    assert.equal((await f.http('/health')).body.state,'unconfigured');assert.equal(fs.existsSync(migrationFile(f.env)),false);
    assert.ok(f.counts.every(c=>c.spawns===0));
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

test('HTTP capture enable refuses an idle paused migration while disable remains available',async()=>{
  const f=await fixture();try{
    await f.begin();const p=await f.until('enable');
    const paused=await f.control('pause',p);assert.equal(paused.status,200);assert.equal(paused.body.progress!.state,'paused');
    assert.equal(readManagedStepJournal(f.env)!.migration.state,'paused');
    assert.equal(f.capture(),false);
    const enabled=await f.http('/v1/capture/enable',{});
    assert.equal(enabled.status,409);assert.deepEqual(enabled.body,{error:'managed-migration-required'});assert.equal(f.capture(),false);
    f.capture(true);
    const disabled=await f.http('/v1/capture/disable',{});
    assert.equal(disabled.status,200);assert.deepEqual(disabled.body,{ok:true,captureEnabled:false});assert.equal(f.capture(),false);
  }finally{await f.close();}
});

test('HTTP capture routes preserve precise platform fault codes without changing capture',async()=>{
  const f=await fixture('receipt');try{
    let p=(await f.begin()).body.progress!;while(p.state!=='complete')p=(await f.advance(p)).body.progress!;
    for(const code of ['private-permissions','path-unverified']){
      f.fault({platformCode:code});
      for(const enabled of [false,true]){
        const r=await f.http(`/v1/capture/${enabled?'enable':'disable'}`,{});
        assert.equal(r.status,503);assert.deepEqual(r.body,{error:code});assert.equal(f.capture(),true);
      }
    }
    f.fault({});assert.equal((await f.http('/v1/capture/disable',{})).status,200);assert.equal(f.capture(),false);
  }finally{await f.close();}
});

for(const recovery of ['interrupted','capture-review'] as const)test(`real HTTP service and UI step driver complete ${recovery} resume with unsettled intent`,async()=>{
  const f=await fixture();try{
    await f.begin();let p=await f.until(recovery==='interrupted'?'remove-discovery':'enable');
    f.fault(recovery==='interrupted'?{crashStep:p.step!.name,order:'before'}:{capture:'before'});
    assert.equal((await f.advance(p)).status,503);f.fault({});
    const setup=await f.http('/v1/setup');
    p=parseSetup(JSON.stringify(setup.body)).delivery!.migrationProgress!;
    assert.equal(p.worker,'unsettled');
    assert.equal(nextAction(p),recovery==='interrupted'?'resume':'review');
    const requests:ManagedStepRequest[]=[],replies:ManagedStepResponse[]=[];
    let inflight=0,maxInflight=0;
    const driver=new StepDriver({
      context:()=> 'synthetic-context',changed:()=>{},refresh:()=>{},
      send:async(request,current)=>{
        assert.ok(current());requests.push(request);maxInflight=Math.max(maxInflight,++inflight);
        try{
          const result=await managedStepCall({serviceRequest:async q=>{
            const r=await fetch(f.url+q.path,{method:q.method,body:q.body,headers:{authorization:'Bearer synthetic-http-fixture'},signal:AbortSignal.timeout(22000)});
            return {status:r.status,body:await r.text()};
          }},request);
          if(result.kind==='reply')replies.push(result.response);
          return result;
        }finally{inflight--;}
      },
    });
    if(recovery==='capture-review'){
      await driver.inspect('capture',{progress:p});assert.equal(driver.state.review?.kind,'capture');
      driver.setAck(true);await driver.confirmCapture();
    }else await driver.resume(p);
    const resumed=replies.find(r=>r.disposition==='applied'&&r.progress?.sequence===p.sequence+1)!;
    assert.ok(resumed,'the UI must accept the real resume envelope before continuing');
    assert.equal(resumed.progress?.state,'pending');assert.equal(resumed.progress?.worker,'unsettled');assert.equal(resumed.progress?.recovery,'continue');
    const resumeAt=requests.findIndex(r=>r.action==='resume');
    assert.deepEqual(requests[resumeAt+1],{version:1,action:'advance',operationId,expectedSequence:p.sequence+1,step:p.step});
    assert.equal(driver.state.progress?.state,'complete');assert.equal(driver.state.outcome,null);
    assert.equal(maxInflight,1);assert.equal(f.capture(),true);
    assert.ok(replies.every(r=>r.accounting.securitySpawns===0));
  }finally{await f.close();}
});

test('HTTP validation, unknown operation and stale step refusals preserve fixed envelopes and same-target progress',async()=>{
  const f=await fixture();try{
    for(const body of [{version:3,action:'status'},{version:1,action:'status',secret:'not accepted'},{version:1,action:'advance',operationId,expectedSequence:-1,step:{name:'enable',batch:0}}]){
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
    const list=await readList(f.host,{});assert.ok(list.ok&&list.read===null,'starting contention remains a no-data observation, including its echoed health refusal');
    const setupRead=await f.http('/v1/setup');assert.equal(setupRead.status,503);assert.deepEqual(setupRead.body,{error:'managed-step-unsettled'},'status never joins an active mutation');
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
    fs.writeFileSync(migrationFile(f.env),'corrupt',{mode:0o600});
    const first=await f.step({version:1,action:'inspect'});assert.equal(first.status,200);
    const corrupt=await f.step({version:1,action:'inspect',cursor:first.body.inspection!.cursor!});assert.equal(corrupt.status,409);assert.equal(corrupt.body.error!.code,'managed-journal-unsupported');assert.equal(corrupt.body.error!.stage,'managed-state');
    fs.writeFileSync(migrationFile(f.env),bytes);
    fs.unlinkSync(path.join(path.dirname(migrationFile(f.env)),'.ownership.json'));
    const marker=await f.step({version:1,action:'status',operationId});assert.equal(marker.status,409);assert.equal(marker.body.error!.code,'managed-binding-invalid');
  }finally{await f.close();}
});

test('HTTP pre-effect deadline exhaustion is a bounded refusal, not partial success',async()=>{
  const f=await fixture();try{
    const p=(await f.begin()).body.progress!,before=fs.readFileSync(migrationFile(f.env));
    f.fault({clockOffset:18000});
    const r=await f.advance(p);assert.equal(r.status,503);assert.equal(r.body.error!.code,'managed-step-deadline');
    assert.ok(r.body.progress===null||r.body.progress.sequence===p.sequence);assert.deepEqual(fs.readFileSync(migrationFile(f.env)),before);assert.equal(f.capture(),true);
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
