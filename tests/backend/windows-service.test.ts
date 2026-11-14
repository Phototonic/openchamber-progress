import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFileSync,spawn} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:net';
import {pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {privateDirectory,privatePaths} from '../../shared/platform.ts';

// OpenChamber v2.7.1 packages/web/server/lib/guests/service.js:
// 15s startup deadline, 1.5s per authenticated health poll (200ms between polls).
// SDK 2.7.0 GUEST_REQUEST_TIMEOUT_MS is 20s for the separate Setup proxy.
const HEALTH_MS=1250,START_MS=12000,PROXY_MS=20000;
type Counts={queries:number;legacyReads:number;elapsedMs?:number};
type Trace={stage:string;errorClass:string|null;code:string|null;elapsedMs:number;marker:boolean;lock:boolean;expectation:boolean;pendingRecord:boolean;selector:boolean;captureEnabled:boolean|null;migrationPhase:string|null;counts:Record<string,Counts>};
const stages=['managed-state-create','lock','expectation-publication','migration-record','legacy-removal','binding-publication','capture-enable'];
const codes=['windows-security-unavailable','private-permissions','path-unverified','unsafe-parent','symlink-escape','storage','busy','corrupt','schema','binding',
  'EACCES','EPERM','EIO','ENOSPC','EEXIST','EBUSY','ENOENT','ENOTDIR','EROFS','EMFILE','ENFILE',
  'confirmation-required','managed-review-stale','managed-selection-conflict','managed-source-conflict','managed-configuration-busy','managed-migration-required','managed-migration-conflict','managed-migration-pending','managed-binding-invalid','managed-binding-modified','managed-path-unverified','managed-scope-unsupported',
  'store-permissions','ownership-invalid','modified-owned-files','foreign-files','staged-activation-retained','not-installed','collision','invalid','not-found'];

/** Released emitted lifecycle AND Store, not a current-source reconstruction. */
async function released(root:string){
  // Checkout belongs to the runner account; the native test principal is a
  // different non-admin user. Trust only this explicit test checkout for Git
  // object reads, never a global safe-directory wildcard or product ACL change.
  const show=(file:string)=>execFileSync('git',['-c',`safe.directory=${process.cwd()}`,'show',`v1.1.1:${file}`],{encoding:'utf8',maxBuffer:16*1024*1024,timeout:10000});
  const text=show('build/service/main.js'),end=text.lastIndexOf('// service/main.ts\n');assert.ok(end>0);
  const module=path.join(root,'released.mjs');
  fs.writeFileSync(module,text.slice(0,end)+'\nexport {lifecycle,Store,readBinding};\n',{mode:0o600});
  return {api:await import(pathToFileURL(module).href),payload:{version:'1.1.1',plugin:show('build/companion/index.js'),guidance:show('build/companion/SKILL.md'),removal:show('build/setup/main.js')}};
}

async function service(env:NodeJS.ProcessEnv,counts:Record<string,Counts>,prefix=''){
  const reserve=createServer();reserve.listen(0,'127.0.0.1');await once(reserve,'listening');
  const port=(reserve.address() as {port:number}).port;await new Promise<void>(r=>reserve.close(()=>r()));
  const start=performance.now();
  const child=spawn(process.execPath,['--import',pathToFileURL(path.resolve('tests/fixtures/windows-service-observer.mjs')).href,path.resolve('build/service/main.js')],{
    env:{...env,OPENCHAMBER_SERVICE_PORT:String(port),OPENCHAMBER_SERVICE_TOKEN:'fixture-only'},stdio:['ignore','ignore','ignore','ipc'],windowsHide:true});
  const messages:any[]=[];child.on('message',m=>messages.push(m));
  async function message(kind:string){
    const limit=AbortSignal.timeout(START_MS);
    while(true){const index=messages.findIndex(m=>m.kind===kind);if(index>=0)return messages.splice(index,1)[0];
      await once(child,'message',{signal:limit});}
  }
  async function stop(){
    if(!child.pid)return;
    if(child.exitCode===null&&child.signalCode===null){const exit=once(child,'exit');child.kill();const timer=setTimeout(()=>child.kill('SIGKILL'),3000);try{await exit;}finally{clearTimeout(timer);}}
  }
  // Wait long enough to retain a fixed server diagnostic even if the host's
  // separate proxy deadline would have elapsed; assert that budget below.
  const request=async(route:string,body?:unknown,phase=route,timeout=120000)=>{
    const started=performance.now();
    const response=await fetch(`http://127.0.0.1:${port}${route}`,{method:body===undefined?'GET':'POST',headers:{authorization:'Bearer fixture-only','content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(timeout)});
    const value=await response.json();const observation=await message('request');
    counts[prefix+phase]={queries:observation.queries,legacyReads:observation.legacyReads,elapsedMs:Math.round(performance.now()-started)};
    return {response,value};
  };
  try{
    await message('listening');const before=await message('before-listen');counts[prefix+'before-listen']={queries:before.queries,legacyReads:before.legacyReads};
    const {response,value}=await request('/health',undefined,'first-health',HEALTH_MS);
    assert.equal(response.status,200);assert.equal(value.state,'starting');assert.equal(value.ready,false);assert.equal(value.sqlite,false);
    assert.ok(performance.now()-start<START_MS,'child handshake must fit the host startup budget with margin');
    assert.ok(counts[prefix+'first-health']!.elapsedMs!<HEALTH_MS);
    assert.equal(before.queries,0);assert.equal(before.legacyReads,0);
    assert.equal(counts[prefix+'first-health']!.queries,0);assert.equal(counts[prefix+'first-health']!.legacyReads,0);
    return {request,stop,async fault(value:null|'timeout'|'private'){child.send({kind:'fault',value});await message('fault-set');}};
  }catch(e){await stop();throw e;}
}

test('Windows cold built health and released 1.1.1 authenticated migration',{skip:process.platform!=='win32',timeout:360000},async()=>{
  const root=path.join(path.parse(os.tmpdir()).root,`agent-progress-service-${randomUUID()}`);
  const counts:Record<string,Counts>={};
  const trace:Trace={stage:'fixture',errorClass:null,code:null,elapsedMs:0,marker:false,lock:false,expectation:false,pendingRecord:false,selector:false,captureEnabled:null,migrationPhase:null,counts};
  let running:Awaited<ReturnType<typeof service>>|undefined;
  let database='',managed='',storeRoot='';const started=performance.now();
  function emit(){
    trace.elapsedMs=Math.round(performance.now()-started);
    if(managed){trace.marker=fs.existsSync(path.join(managed,'.ownership.json'));trace.lock=fs.existsSync(path.join(managed,'.configuration-lock'));trace.selector=fs.existsSync(path.join(managed,'progress-binding.json'));
      const file=path.join(managed,'migration.json');trace.pendingRecord=fs.existsSync(file);
      if(trace.pendingRecord)try{const phase=JSON.parse(fs.readFileSync(file,'utf8')).migration?.phase;trace.migrationPhase=['pending','removed','complete'].includes(phase)?phase:null;}catch{/* Unknown is not complete. */}}
    if(storeRoot&&fs.existsSync(storeRoot))trace.expectation=fs.readdirSync(storeRoot).some(n=>/^managed-expectation-[a-f0-9]{64}\.json$/.test(n));
    if(database&&fs.existsSync(database))try{const db=new DatabaseSync(database,{readOnly:true});try{const enabled=db.prepare('SELECT enabled FROM meta WHERE singleton=1').get()?.enabled;trace.captureEnabled=enabled===1?true:enabled===0?false:null;}finally{db.close();}}catch{/* Read-only trace cannot repair. */}
    console.log('WINDOWS_MIGRATION_TRACE '+JSON.stringify(trace));
  }
  function proxyBudget(phase:string){
    if(counts[phase]!.elapsedMs!>=PROXY_MS){trace.code='proxy-budget-exceeded';trace.errorClass='timeout';throw new Error('proxy-budget');}
  }
  try{
    privateDirectory(root);
    const home=path.join(root,'home ü space');privateDirectory(home);
    const env:NodeJS.ProcessEnv={HOME:home,USERPROFILE:home,TEMP:path.join(root,'temp'),TMP:path.join(root,'temp')};
    for(const key of ['SystemRoot','SYSTEMROOT','WINDIR'])if(process.env[key])env[key]=process.env[key];
    privateDirectory(env.TEMP!);
    const configRoot=path.join(home,'.config','opencode'),dataRoot=path.join(home,'.local','share','opencode');
    storeRoot=path.join(dataRoot,'openchamber-progress');managed=path.join(dataRoot,'agent-progress-managed');
    for(const dir of [configRoot,dataRoot])privateDirectory(dir,true);
    const old=await released(root);old.api.lifecycle('install',{configRoot,dataRoot,storeRoot,confirmed:true},old.payload);
    const legacyRoot=path.join(configRoot,'plugins','agent-progress'),legacy=old.api.readBinding(path.join(legacyRoot,'progress-binding.json'));
    database=legacy.database;const store=new old.api.Store(database);
    try{store.installSubagentRuns();assert.equal(store.db.prepare('PRAGMA user_version').get().user_version,2);assert.equal(store.db.prepare('SELECT count(*) AS n FROM plans').get().n,0);}finally{store.close();}
    const legacyFiles=fs.readdirSync(legacyRoot).map(name=>[name,fs.readFileSync(path.join(legacyRoot,name))] as const);
    const before=fs.readFileSync(database),payloads=fs.readdirSync(path.join(storeRoot,'payloads'));
    trace.stage='startup';running=await service(env,counts);
    assert.equal(fs.existsSync(managed),false);assert.ok(fs.readFileSync(database).equals(before),'liveness must not open/mutate the legacy database');
    trace.stage='inspect';const inspected=await running.request('/v1/setup/managed-inspect',{},'inspect');
    assert.equal(inspected.response.status,200);assert.equal(inspected.value.delivery.migration,'available');
    assert.ok(counts.inspect!.queries>0);assert.ok(counts.inspect!.legacyReads>0);
    proxyBudget('inspect');
    const review=inspected.value.delivery.review.expected;
    for(const [fault,code]of [['timeout','windows-security-unavailable'],['private','private-permissions']] as const){
      trace.stage='managed-state-create';await running.fault(fault);
      const failure=await running.request('/v1/setup/managed-migrate',{confirmed:true,expected:review},fault);
      assert.equal(failure.response.status,503);assert.equal(failure.value.error,code);
      assert.deepEqual(failure.value.lastAction,{stage:'managed-state-create',code});assert.ok(counts[fault]!.queries>0);
      trace.code=code;trace.errorClass='platform';emit();trace.code=null;trace.errorClass=null;proxyBudget(fault);
      await running.fault(null);
      const status=await running.request('/v1/setup',undefined,`${fault}-status`);
      assert.equal(status.response.status,200);assert.deepEqual(status.value.lastAction,{stage:'managed-state-create',code});
      proxyBudget(`${fault}-status`);
      assert.equal(status.value.delivery.migration,'available');assert.equal(fs.existsSync(managed),false);
      assert.ok(fs.readFileSync(database).equals(before),'pre-disable refusal must preserve every legacy database byte');
      for(const [name,bytes]of legacyFiles)assert.ok(fs.readFileSync(path.join(legacyRoot,name)).equals(bytes),'legacy discovery unchanged');
    }
    trace.stage='managed-state-create';const migrated=await running.request('/v1/setup/managed-migrate',{confirmed:true,expected:review},'migrate');
    if(!migrated.response.ok){
      const action=migrated.value.lastAction;
      assert.ok(action&&stages.includes(action.stage)&&codes.includes(action.code),'migration failure requires a precise fixed stage/code');
      trace.stage=action.stage;trace.code=action.code;
      trace.errorClass=['windows-security-unavailable','private-permissions','path-unverified','unsafe-parent','symlink-escape'].includes(action.code)?'platform':/^[A-Z]+$/.test(action.code)?'filesystem':['storage','busy','corrupt','schema','binding'].includes(action.code)?'storage':'setup';
      throw new Error('native-migration-refused');
    }
    assert.ok(counts.migrate!.queries>0);assert.equal(migrated.value.delivery.migration,'complete');assert.equal(migrated.value.captureEnabled,true);
    trace.stage='capture-enable';proxyBudget('migrate');
    assert.equal(migrated.value.reportingIdentity.storeId,legacy.storeId);assert.equal(migrated.value.reportingIdentity.sourceId,legacy.source.id);
    assert.equal(fs.existsSync(legacyRoot),false);assert.deepEqual(fs.readdirSync(path.join(storeRoot,'payloads')),payloads);
    const selector=path.join(managed,'progress-binding.json'),marker=path.join(managed,'.ownership.json');
    assert.equal(privatePaths([managed,marker,selector]),true);
    const ready=await running.request('/health',undefined,'ready-health',HEALTH_MS);assert.equal(ready.value.ready,true);assert.equal(counts['ready-health']!.queries,0);assert.equal(counts['ready-health']!.legacyReads,0);
    // A fresh process with a selector still starts without admission. A selected
    // hard-link is refused on the data path, not hidden by the liveness snapshot.
    await running.stop();running=await service(env,counts,'selected-');await running.stop();
    const alias=path.join(root,'database-alias.sqlite');fs.linkSync(database,alias);
    running=await service(env,counts,'invalid-');
    try{assert.equal((await running.request('/v1/plans',undefined,'hardlink-read')).response.status,503);
      assert.equal((await running.request('/health',undefined,'refused-health',HEALTH_MS)).value.ready,false);
    }finally{fs.unlinkSync(alias);}
    assert.equal((await running.request('/v1/plans',undefined,'restored-read')).response.status,200);
    trace.stage='complete';
  }catch(e){
    trace.errorClass??='test';
    trace.code??=(e as {name?:string})?.name==='TimeoutError'?'request-timeout':'assertion';
    // Native evidence is below. Never print arbitrary assertion/OS messages,
    // which may include profile paths, database rows or security command text.
    throw new Error('Windows service regression failed; inspect sanitized Windows migration trace.');
  }finally{
    await running?.stop();emit();
    if(fs.existsSync(root))fs.rmSync(root,{recursive:true,force:true});
  }
});
