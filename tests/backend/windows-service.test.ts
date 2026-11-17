import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {privateDirectory,privatePaths,windowsPath} from '../../shared/platform.ts';
import {Store} from '../../shared/store.ts';
import {MANAGED_INSPECTION_STEPS,MANAGED_MIGRATION_STEPS,MANAGED_FRESH_INSPECTION_STEPS,MANAGED_FRESH_STEPS,MANAGED_STEP_CODES,type ManagedStepRequest,type ManagedStepResponse,type ManagedFreshStepRequest,type ManagedFreshStepResponse} from '../../shared/managed-steps.ts';
import {MANAGED_ACTION_CODES} from '../../shared/progress.ts';
import {nativeService,nativeHarnessCode,HEALTH_MS,type Observation} from '../fixtures/windows-service-driver.ts';

/** Released emitted lifecycle AND Store, not a current-source reconstruction. */
async function released(root:string){
  // Different non-admin principal: trust only this checkout for object reads.
  const show=(file:string)=>execFileSync('git',['-c',`safe.directory=${process.cwd()}`,'show',`v1.1.1:${file}`],{encoding:'utf8',maxBuffer:16*1024*1024,timeout:10000});
  const text=show('build/service/main.js'),end=text.lastIndexOf('// service/main.ts\n');assert.ok(end>0);
  const module=path.join(root,'released.mjs');
  fs.writeFileSync(module,text.slice(0,end)+'\nexport {lifecycle,Store,readBinding};\n',{mode:0o600});
  return {api:await import(pathToFileURL(module).href),payload:{version:'1.1.1',plugin:show('build/companion/index.js'),guidance:show('build/companion/SKILL.md'),removal:show('build/setup/main.js')}};
}
const stages=new Set<string>([...MANAGED_INSPECTION_STEPS,...MANAGED_MIGRATION_STEPS,'journal','lock']);
const codes=new Set<string>([...MANAGED_STEP_CODES,...MANAGED_ACTION_CODES,'managed-action-required','not-found','invalid']);
const fullJourneySkip=process.env.AP_WINDOWS_FULL==='1'?false:'Full Windows journey requires AP_WINDOWS_FULL=1 (promotion, main push, weekly or manual CI).';

// EMPTY runs first: no released installer, selected binding, Store or journal may
// accidentally supply authority to the new-store journey. Retained fixtures use
// only the Store owner, never an install followed by test-owned discovery removal.
for(const fixture of ['empty','empty-custom','empty-delayed','retained-off','retained-on','retained-new'] as const)test(`Windows built fresh steps (${fixture})`,{skip:fixture==='empty-delayed'&&fullJourneySkip||process.platform!=='win32',timeout:600000},async()=>{
  const root=path.join(path.parse(os.tmpdir()).root,`agent-progress-fresh-${randomUUID()}`);
  const retained=fixture.startsWith('retained'),newSource=fixture==='retained-new',custom=fixture==='empty-custom',
    delayed=fixture==='empty-delayed',mode=delayed?'delayed':'undelayed',limitMs=delayed?19999:8000;
  let running:Awaited<ReturnType<typeof nativeService>>|undefined;
  let database='',managed='',storeRoot='',phase='fixture',failed=false;
  const freshStages=new Set<string>([...MANAGED_FRESH_INSPECTION_STEPS,...MANAGED_FRESH_STEPS,'journal','lock']);
  const readDatabase=<T,>(read:(db:DatabaseSync)=>T)=>{const db=new DatabaseSync(database,{readOnly:true});try{return read(db);}finally{db.close();}};
  const capture=()=>readDatabase(db=>{const enabled=db.prepare('SELECT enabled FROM meta WHERE singleton=1').get()?.enabled;assert.ok(enabled===0||enabled===1);return enabled===1;});
  const historySnapshot=(excludeSource?:string)=>readDatabase(db=>Object.fromEntries(['plans','revisions','contributions','receipts','sources'].map(t=>
    [t,db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all().filter(row=>t!=='sources'||row.id!==excludeSource)])));
  function facts(){
    let enabled:boolean|null=null;try{if(database&&fs.existsSync(database))enabled=capture();}catch{/* Unknown is not off. */}
    return {marker:!!managed&&fs.existsSync(path.join(managed,'.ownership.json')),lock:!!managed&&fs.existsSync(path.join(managed,'.configuration-lock')),
      pending:!!managed&&fs.existsSync(path.join(managed,'migration.json')),selector:!!managed&&fs.existsSync(path.join(managed,'progress-binding.json')),
      expectation:!!storeRoot&&fs.existsSync(storeRoot)&&fs.readdirSync(storeRoot).some(n=>/^managed-expectation-[a-f0-9]{64}\.json$/.test(n)),captureEnabled:enabled};
  }
  function observe(o:Observation){
    const error=o.value.error,diagnostic=typeof error==='object'&&error?error:null,p=o.value.progress??o.value.delivery?.freshProgress;
    const stage=diagnostic?.stage??o.value.inspection?.stage??p?.lastCompleted?.name,code=typeof error==='string'?error:diagnostic?.code;
    // Keep the existing prefix/artifact collector; only fixed vocabulary, booleans
    // and numeric observations enter the public trace, never review/identity data.
    console.log('WINDOWS_MIGRATION_TRACE '+JSON.stringify({journey:'fresh',fixture,mode,request:o.phase,stage:freshStages.has(stage)?stage:null,code:codes.has(code)?code:code?'unrecognized-code':null,
      status:o.status,elapsedMs:o.counts.elapsedMs,spawns:o.counts.queries,legacyReads:o.counts.legacyReads,workers:o.counts.workers,concurrentHealth:o.concurrent,
      sequence:Number.isSafeInteger(p?.sequence)?p.sequence:null,state:['pending','running','paused','failed','complete','abandoned'].includes(p?.state)?p.state:null,
      capture:['on','off','unknown'].includes(p?.capture?.state)?p.capture.state:null,...facts()}));
    if(o.phase==='first-health')assert.equal(o.value.managedFreshSteps,1,'built service must advertise fresh support even while starting');
    if(p){
      assert.equal(p.planKind,'fresh');assert.ok(['on','off','unknown'].includes(p.capture.state));
      if(p.capture.state!=='unknown')assert.equal(p.capture.state,capture()?'on':'off','fresh capture projection must match SQLite');
      else assert.equal(p.capture.observedAt,null);
    }
  }
  try{
    privateDirectory(root);const home=path.join(root,'home ü space');privateDirectory(home);
    const env:NodeJS.ProcessEnv={HOME:home,USERPROFILE:home,TEMP:path.join(root,'temp'),TMP:path.join(root,'temp'),
      XDG_CONFIG_HOME:path.join(home,'.config'),XDG_DATA_HOME:path.join(home,'.local','share'),XDG_STATE_HOME:path.join(root,'state'),XDG_CACHE_HOME:path.join(root,'cache'),XDG_RUNTIME_DIR:path.join(root,'runtime')};
    for(const key of ['SystemRoot','SYSTEMROOT','WINDIR'])if(process.env[key])env[key]=process.env[key];
    for(const dir of [env.TEMP!,env.XDG_STATE_HOME!,env.XDG_CACHE_HOME!,env.XDG_RUNTIME_DIR!])privateDirectory(dir);
    const configRoot=path.join(env.XDG_CONFIG_HOME!,'opencode'),dataRoot=path.join(env.XDG_DATA_HOME!,'opencode');
    for(const dir of [configRoot,dataRoot])privateDirectory(dir,true);
    storeRoot=custom?path.join(root,'custom store ü'):path.join(dataRoot,'openchamber-progress');
    managed=path.join(dataRoot,'agent-progress-managed');database=path.join(storeRoot,'progress.sqlite');
    const legacyRoot=path.join(configRoot,'plugins','agent-progress');
    let retainedStoreId:unknown,retainedSourceId:string|undefined,history:unknown;
    if(retained){
      privateDirectory(storeRoot);const store=new Store(database,{create:true});
      try{
        store.installSubagentRuns();retainedSourceId=randomUUID();
        const sourceRoots=newSource?{configRoot:path.join(home,'other-config'),dataRoot:path.join(home,'other-data')}:{configRoot,dataRoot};
        if(newSource)for(const dir of Object.values(sourceRoots))privateDirectory(dir);
        store.registerSource({id:retainedSourceId,configRoot:windowsPath(sourceRoots.configRoot),dataRoot:windowsPath(sourceRoots.dataRoot),verified:true});
        const actor={sourceId:retainedSourceId,sessionId:'native-fixture',agent:'build',directory:'/fixture/native',parentId:null,ancestry:[],verifiedSource:true};
        store.apply({op:'start',plan:'retained',oid:'start',rev:0,title:'Retained native history',items:[{id:'work',title:'Work',kind:'task',status:'pending'}]},actor);
        store.apply({op:'change',plan:'retained',oid:'work',rev:1,changes:[{id:'work',status:'working'}]},actor);
        store.setEnabled(fixture==='retained-on');
      }finally{store.close();}
      retainedStoreId=readDatabase(db=>db.prepare('SELECT store_id FROM meta WHERE singleton=1').get()!.store_id);history=historySnapshot();
    }
    const initialCapture=retained?fixture==='retained-on':null;
    const snapshot=(dir:string):unknown=>fs.readdirSync(dir).sort().map(name=>{const file=path.join(dir,name);return [name,fs.statSync(file).isDirectory()?snapshot(file):createHash('sha256').update(fs.readFileSync(file)).digest('hex')];});
    const before=[snapshot(configRoot),snapshot(dataRoot)];
    const pristine=()=>{
      assert.deepEqual([snapshot(configRoot),snapshot(dataRoot)],before,'read-only inspection/refusal must preserve product files');
      assert.equal(fs.existsSync(managed),false,'inspection/refusal must not create managed state');assert.equal(fs.existsSync(legacyRoot),false);
      if(retained){assert.deepEqual(historySnapshot(),history);assert.equal(capture(),initialCapture);}
      else assert.equal(fs.existsSync(storeRoot),false,'inspection/refusal must not create storage');
    };
    pristine();phase='startup';running=await nativeService(env,observe);pristine();
    const request=async(route:string,body:unknown|undefined,label:string,extra:Parameters<Awaited<ReturnType<typeof nativeService>>['request']>[3]={})=>{
      phase=label;return running!.request(route,body,label,{limitMs,...extra});
    };
    for(const route of ['managed-inspect','managed-configure']){
      const refused=await request(`/v1/setup/${route}`,route==='managed-configure'?{confirmed:true,expected:'a'.repeat(64)}:{},`fresh-old-${route}`,{maxSpawns:0,expectedStatus:409});
      assert.deepEqual(refused.value,{error:'managed-action-required'});assert.equal(refused.counts.workers,0);assert.equal(refused.counts.legacyReads,0);pristine();
    }
    await running.settings(null,delayed?2500:0);
    const step=async(body:ManagedFreshStepRequest,label:string,expectedStatus=200)=>{
      const r=await request('/v1/setup/managed-step',body,`fresh-${label}`,{concurrent:true,expectedStatus});
      const value=r.value as ManagedFreshStepResponse;assert.equal(value.version,2);
      if(expectedStatus===200)assert.equal(value.error,null,`${label}: success must not hide a refusal`);
      return {...r,value};
    };
    const inspect=async()=>{
      let cursor:string|undefined;
      for(const stage of MANAGED_FRESH_INSPECTION_STEPS){
        const r=await step({version:2,action:'inspect',...(cursor?{cursor}:custom?{storeRoot}:{})},`inspect-${stage}`);pristine();
        assert.ok(r.counts.queries>0,'fresh inspection performs real security checks');assert.equal(r.value.inspection?.stage,stage);
        if(stage==='review'){assert.equal(r.value.inspection?.state,'complete');assert.ok(r.value.inspection?.review);return r.value.inspection.review;}
        assert.equal(r.value.inspection?.state,'incomplete');assert.equal(r.value.inspection?.review,undefined);assert.ok(r.value.inspection?.cursor);cursor=r.value.inspection.cursor;
      }
      throw new Error('native-fresh-inspection-incomplete');
    };
    let review=await inspect();
    assert.equal(review.planKind,'fresh');assert.equal(review.storeMode,retained?'retain':'create');assert.equal(review.sourceMode,retained&&!newSource?'reuse':'create');
    assert.equal(review.targets.storeRoot,storeRoot,'review must select the requested default or custom target');
    assert.equal(review.capturePolicy,retained?'preserve':'enable-new');assert.match(review.expected,/^[a-f0-9]{64}$/);
    const expectedNames=retained?['prepare','expectation',...(newSource?['register-source']:[]),'publish-binding','reconcile']:[...MANAGED_FRESH_STEPS];
    assert.deepEqual(review.plan,expectedNames.map(name=>({name,batch:0})));
    if(retained){assert.equal(review.storeId,retainedStoreId);
      if(newSource)assert.notEqual(review.sourceId,retainedSourceId);else assert.equal(review.sourceId,retainedSourceId);
      assert.equal(review.capture.state,initialCapture?'on':'off');}
    const operationId=randomUUID();
    if(fixture==='empty'){
      await running.settings('timeout');
      const refusal=await step({version:2,action:'begin',operationId,confirmed:true,expected:review.expected},'prepare-timeout',503);
      assert.equal(refusal.value.disposition,'refused');assert.deepEqual(refusal.value.error,{stage:'prepare',code:'managed-step-deadline'});assert.ok(refusal.counts.queries>0);pristine();
      await running.settings();review=await inspect();
    }
    const begin:ManagedFreshStepRequest={version:2,action:'begin',operationId,confirmed:true,expected:review.expected};
    let p=(await step(begin,'prepare')).value.progress!;
    assert.equal(p.sequence,1);assert.equal(p.state,'pending');assert.deepEqual(p.lastCompleted,{name:'prepare',batch:0});assert.deepEqual(p.plan,review.plan);
    if(!retained){assert.equal(fs.existsSync(storeRoot),false);assert.equal(p.capture.state,'unknown');}
    const replay=await step(begin,'prepare-retry');assert.equal(replay.value.disposition,'replayed');assert.equal(replay.value.progress?.sequence,p.sequence);
    const pauseResume=async(label:string)=>{
      const current=p,enabled=fs.existsSync(database)?capture():null;
      p=(await step({version:2,action:'pause',operationId,expectedSequence:p.sequence},`pause-${label}`)).value.progress!;
      assert.equal(p.state,'paused');assert.deepEqual(p.step,current.step);
      await running!.stop();running=await nativeService(env,observe);await running.settings(null,delayed?2500:0);
      const reopened=await request('/v1/setup',undefined,`fresh-reopen-${label}`,{concurrent:true,expectedStatus:200});
      assert.equal(reopened.value.delivery.managedFreshSteps,1);assert.equal(reopened.value.delivery.freshProgress.state,'paused');assert.equal(reopened.value.delivery.freshProgress.sequence,p.sequence);
      assert.equal(reopened.value.captureEnabled,enabled);assert.equal(fs.existsSync(database)?capture():null,enabled);
      p=(await step({version:2,action:'resume',operationId,expectedSequence:p.sequence},`resume-${label}`)).value.progress!;
      assert.equal(p.state,'pending');assert.deepEqual(p.step,current.step);
    };
    if(fixture==='empty')await pauseResume('before-store');
    const completed=['prepare'];
    for(let i=0;p.state!=='complete'&&i<MANAGED_FRESH_STEPS.length;i++){
      const current=p;assert.ok(current.step);assert.equal(current.step.batch,0);
      const body:ManagedFreshStepRequest={version:2,action:'advance',operationId,expectedSequence:p.sequence,step:current.step};
      p=(await step(body,current.step.name)).value.progress!;
      assert.equal(p.operationId,operationId);assert.equal(p.sequence,current.sequence+1);assert.deepEqual(p.lastCompleted,current.step);assert.deepEqual(p.plan,review.plan);completed.push(current.step.name);
      if(retained){assert.equal(capture(),initialCapture);assert.deepEqual(historySnapshot(newSource?review.sourceId:undefined),history);}
      else if(fs.existsSync(database))assert.equal(capture(),['enable','reconcile'].includes(current.step.name),'new capture stays off until the explicit enable');
      if(fixture==='empty'&&current.step.name==='create-store'){
        assert.equal(capture(),false);assert.equal(p.capture.state,'off');
        const retry=await step(body,'create-store-retry');assert.equal(retry.value.disposition,'replayed');assert.equal(retry.value.progress?.sequence,p.sequence);
        await pauseResume('capture-off');
      }
    }
    assert.equal(p.state,'complete','fresh setup must really complete, not loop through bounded refusals');assert.equal(p.step,null);assert.deepEqual(completed,expectedNames);
    assert.equal(p.capture.state,retained&&!initialCapture?'off':'on');assert.equal(capture(),retained?initialCapture:true);
    const selected=JSON.parse(fs.readFileSync(path.join(managed,'progress-binding.json'),'utf8'));
    assert.equal(selected.storeId,review.storeId);assert.equal(selected.source.id,review.sourceId);
    assert.equal(readDatabase(db=>db.prepare('SELECT store_id FROM meta WHERE singleton=1').get()!.store_id),review.storeId);
    assert.equal(readDatabase(db=>db.prepare('SELECT COUNT(*) AS n FROM sources WHERE id=? AND verified=1').get(review.sourceId)!.n),1);
    assert.equal(readDatabase(db=>db.prepare('SELECT COUNT(*) AS n FROM sources').get()!.n),newSource?2:1);
    if(custom)assert.equal(fs.existsSync(path.join(dataRoot,'openchamber-progress')),false,'custom selection must not create default storage');
    const status=await request('/v1/setup',undefined,'fresh-complete-status',{concurrent:true,expectedStatus:200});
    assert.equal(status.value.delivery.managedFreshSteps,1);assert.equal(status.value.delivery.freshProgress.state,'complete');assert.equal(status.value.configured,true);
    assert.equal(status.value.captureEnabled,retained?initialCapture:true);assert.equal(status.value.reportingIdentity.storeId,review.storeId);assert.equal(status.value.reportingIdentity.sourceId,review.sourceId);
    assert.equal(fs.existsSync(legacyRoot),false);assert.equal(privatePaths([managed,path.join(managed,'.ownership.json'),path.join(managed,'progress-binding.json'),database]),true);
    const health=await request('/health',undefined,'fresh-ready-health',{limitMs:HEALTH_MS,maxSpawns:0,expectedStatus:200});assert.equal(health.value.ready,true);assert.equal(health.value.managedFreshSteps,1);assert.equal(health.counts.legacyReads,0);assert.equal(health.counts.workers,0);
    phase='complete';
  }catch(error){
    failed=true;throw new Error(`Windows native fresh ${fixture} failed at ${phase} (${nativeHarnessCode(error)}); inspect windows-migration-trace.`);
  }finally{
    await running?.stop();console.log('WINDOWS_MIGRATION_TRACE '+JSON.stringify({journey:'fresh',fixture,mode,request:'summary',stage:phase,failed,serviceSha256:createHash('sha256').update(fs.readFileSync('build/service/main.js')).digest('hex'),...facts()}));
    if(fs.existsSync(root))fs.rmSync(root,{recursive:true,force:true});
  }
});

for(const delayed of [false,true])test(`Windows built released 1.1.1 step migration (${delayed?'2500ms helpers':'undelayed'})`,{skip:fullJourneySkip||process.platform!=='win32',timeout:600000},async()=>{
  const root=path.join(path.parse(os.tmpdir()).root,`agent-progress-service-${randomUUID()}`);
  let running:Awaited<ReturnType<typeof nativeService>>|undefined;
  let database='',managed='',storeRoot='',phase='fixture',failed=false;
  const mode=delayed?'delayed':'undelayed',limitMs=delayed?19999:8000;
  const capture=()=>{const db=new DatabaseSync(database,{readOnly:true});try{const enabled=db.prepare('SELECT enabled FROM meta WHERE singleton=1').get()?.enabled;assert.ok(enabled===0||enabled===1,'capture bit must be readable');return enabled===1;}finally{db.close();}};
  function facts(){
    let enabled:boolean|null=null;try{if(database&&fs.existsSync(database))enabled=capture();}catch{/* Unknown is not off. */}
    return {marker:!!managed&&fs.existsSync(path.join(managed,'.ownership.json')),lock:!!managed&&fs.existsSync(path.join(managed,'.configuration-lock')),
      pending:!!managed&&fs.existsSync(path.join(managed,'migration.json')),selector:!!managed&&fs.existsSync(path.join(managed,'progress-binding.json')),
      expectation:!!storeRoot&&fs.existsSync(storeRoot)&&fs.readdirSync(storeRoot).some(n=>/^managed-expectation-[a-f0-9]{64}\.json$/.test(n)),captureEnabled:enabled};
  }
  function observe(o:Observation){
    const error=o.value.error,diagnostic=typeof error==='object'&&error?error:null,p=o.value.progress??o.value.delivery?.migrationProgress;
    const stage=diagnostic?.stage??o.value.inspection?.stage??p?.lastCompleted?.name;
    const code=typeof error==='string'?error:diagnostic?.code;
    console.log('WINDOWS_MIGRATION_TRACE '+JSON.stringify({mode,request:o.phase,stage:stages.has(stage)?stage:null,code:codes.has(code)?code:code?'unrecognized-code':null,
      status:o.status,elapsedMs:o.counts.elapsedMs,spawns:o.counts.queries,legacyReads:o.counts.legacyReads,workers:o.counts.workers,concurrentHealth:o.concurrent,
      sequence:Number.isSafeInteger(p?.sequence)?p.sequence:null,state:['pending','running','paused','failed','complete','abandoned'].includes(p?.state)?p.state:null,
      capture:['on','off','unknown'].includes(p?.capture?.state)?p.capture.state:null,...facts()}));
    if(p){
      assert.ok(['on','off','unknown'].includes(p.capture.state),'capture observation is explicit');
      if(p.capture.state!=='unknown')assert.equal(p.capture.state,capture()?'on':'off','capture observation must match SQLite');
      else assert.equal(p.capture.observedAt,null,'unknown cannot carry a stale observation time');
    }
  }
  try{
    privateDirectory(root);const home=path.join(root,'home ü space');privateDirectory(home);
    const env:NodeJS.ProcessEnv={HOME:home,USERPROFILE:home,TEMP:path.join(root,'temp'),TMP:path.join(root,'temp'),
      XDG_CONFIG_HOME:path.join(home,'.config'),XDG_DATA_HOME:path.join(home,'.local','share'),XDG_STATE_HOME:path.join(root,'state'),XDG_CACHE_HOME:path.join(root,'cache'),XDG_RUNTIME_DIR:path.join(root,'runtime')};
    for(const key of ['SystemRoot','SYSTEMROOT','WINDIR'])if(process.env[key])env[key]=process.env[key];
    for(const dir of [env.TEMP!,env.XDG_STATE_HOME!,env.XDG_CACHE_HOME!,env.XDG_RUNTIME_DIR!])privateDirectory(dir);
    const configRoot=path.join(env.XDG_CONFIG_HOME!,'opencode'),dataRoot=path.join(env.XDG_DATA_HOME!,'opencode');
    storeRoot=path.join(dataRoot,'openchamber-progress');managed=path.join(dataRoot,'agent-progress-managed');
    for(const dir of [configRoot,dataRoot])privateDirectory(dir,true);
    const old=await released(root);old.api.lifecycle('install',{configRoot,dataRoot,storeRoot,confirmed:true},old.payload);
    const legacyRoot=path.join(configRoot,'plugins','agent-progress'),legacy=old.api.readBinding(path.join(legacyRoot,'progress-binding.json'));
    // Exercise actual selector batches using the released owner's supported
    // retained-activation grammar, with unchanged released manifest bytes.
    for(let i=0;i<2;i++)fs.copyFileSync(path.join(legacyRoot,'.ownership.json'),path.join(legacyRoot,`.agent-progress-activation-${randomUUID()}`));
    database=legacy.database;const store=new old.api.Store(database);
    try{
      store.installSubagentRuns();assert.equal(store.db.prepare('PRAGMA user_version').get().user_version,2);
      const actor={sourceId:legacy.source.id,sessionId:'native-fixture',agent:'build',directory:'/fixture/native',parentId:null,ancestry:[],verifiedSource:true};
      store.apply({op:'start',plan:'retained',oid:'start',rev:0,title:'Retained native history',items:[{id:'work',title:'Work',kind:'task',status:'pending'}]},actor);
      store.apply({op:'change',plan:'retained',oid:'work',rev:1,changes:[{id:'work',status:'working'}]},actor);
    }finally{store.close();}
    const historySnapshot=()=>{const db=new DatabaseSync(database,{readOnly:true});try{return Object.fromEntries(['plans','revisions','contributions','receipts','sources'].map(t=>[t,db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()]));}finally{db.close();}};
    const history=historySnapshot(),historyFile=path.join(storeRoot,'installation-history.jsonl'),installationBefore=fs.readFileSync(historyFile);
    const payloadSnapshot=(dir:string):unknown=>fs.readdirSync(dir).sort().map(name=>{const file=path.join(dir,name);return [name,fs.statSync(file).isDirectory()?payloadSnapshot(file):createHash('sha256').update(fs.readFileSync(file)).digest('hex')];});
    const payloads=payloadSnapshot(path.join(storeRoot,'payloads'));
    const legacyFiles=fs.readdirSync(legacyRoot).map(name=>[name,fs.readFileSync(path.join(legacyRoot,name))] as const),before=fs.readFileSync(database);
    const untouched=()=>{
      assert.deepEqual(fs.readFileSync(database),before,'pre-disable refusal must preserve every database byte');
      assert.deepEqual(fs.readdirSync(legacyRoot).sort(),legacyFiles.map(([name])=>name).sort(),'legacy discovery names unchanged');
      for(const [name,bytes]of legacyFiles)assert.deepEqual(fs.readFileSync(path.join(legacyRoot,name)),bytes,'legacy discovery bytes unchanged');
      assert.deepEqual(fs.readFileSync(historyFile),installationBefore,'refusal must not append history');
    };
    phase='startup';running=await nativeService(env,observe);untouched();assert.equal(fs.existsSync(managed),false);
    const request=async(route:string,body:unknown|undefined,label:string,extra:Parameters<Awaited<ReturnType<typeof nativeService>>['request']>[3]={})=>{
      phase=label;return running!.request(route,body,label,{limitMs,...extra});
    };
    // Both refusals need no security evidence. In particular inspection must
    // not enter the observer's worker-only hold from the synchronous controller.
    for(const route of ['managed-migrate','managed-inspect']){
      const migrate=route==='managed-migrate';
      const refused=await request(`/v1/setup/${route}`,migrate?{confirmed:true,expected:'a'.repeat(64)}:{},`old-${route}`,{limitMs:migrate?HEALTH_MS:8000,maxSpawns:0,expectedStatus:409});
      assert.deepEqual(refused.value,{error:'managed-action-required'});
      assert.equal(refused.counts.workers,0);assert.equal(refused.counts.legacyReads,0);
      untouched();assert.equal(fs.existsSync(managed),false);
    }
    await running.settings(null,delayed?2500:0);
    const step=async(body:ManagedStepRequest,label:string,expectedStatus=200)=>{
      const r=await request('/v1/setup/managed-step',body,label,{concurrent:true,expectedStatus});
      const value=r.value as ManagedStepResponse;assert.equal(value.version,1);
      if(expectedStatus===200)assert.equal(value.error,null,`${label}: successful step must not contain an error`);
      return {...r,value};
    };
    const inspect=async()=>{
      let cursor:string|undefined;
      for(const stage of MANAGED_INSPECTION_STEPS){
        const r=await step({version:1,action:'inspect',...(cursor?{cursor}:{})},`inspect-${stage}`);
        assert.ok(r.counts.queries>0,'native inspection must perform real security checks');
        assert.equal(r.value.inspection?.stage,stage);
        if(stage==='review'){assert.equal(r.value.inspection?.state,'complete');return r.value.inspection!.review!;}
        assert.equal(r.value.inspection?.state,'incomplete');assert.equal(r.value.inspection?.review,undefined);cursor=r.value.inspection!.cursor!;
      }
      throw new Error('native-inspection-incomplete');
    };
    const operationId=randomUUID();let review=await inspect();untouched();assert.equal(fs.existsSync(managed),false);
    if(!delayed){
      for(const [fault,code]of [['timeout','managed-step-deadline'],['private','private-permissions']] as const){
        await running.settings(fault);
        const refusal=await step({version:1,action:'begin',operationId,confirmed:true,expected:review.expected},`prepare-${fault}`,503);
        assert.deepEqual(refusal.value.error,{stage:'prepare',code});assert.equal(refusal.value.disposition,'refused');
        assert.ok(refusal.counts.queries>0);untouched();assert.equal(fs.existsSync(managed),false);
        await running.settings();
        const status=await request('/v1/setup',undefined,`${fault}-status`,{concurrent:true,expectedStatus:200});
        assert.equal(status.value.delivery.migration,'available');assert.equal(status.value.captureEnabled,null,'unselected legacy capture is unknown');
        review=await inspect(); // Refusal consumed the old ephemeral inspection.
      }
      // Late helper outlives the response deadline. No second writer may enter
      // before actual worker exit; no timeout is treated as proof of rollback.
      await running.settings('overrun');
      const late=await request('/v1/setup/managed-step',{version:1,action:'begin',operationId,confirmed:true,expected:review.expected},'prepare-overrun',{concurrent:true,limitMs:19999,expectedStatus:503});
      assert.deepEqual(late.value.error,{stage:'prepare',code:'managed-step-deadline'});untouched();
      const competing=await step({version:1,action:'status'},'late-competing-status',503);
      assert.equal(competing.value.error?.code,'managed-step-unsettled');assert.equal(competing.counts.queries,0);
      await late.waitForWorkerExit();await running.settings();untouched();review=await inspect();
    }
    let p=(await step({version:1,action:'begin',operationId,confirmed:true,expected:review.expected},'prepare')).value.progress!;
    assert.equal(p.sequence,1);assert.deepEqual(p.lastCompleted,{name:'prepare',batch:0});assert.equal(capture(),true);untouched();
    const pauseResume=async(label:string)=>{
      const current=p,enabled=capture();
      p=(await step({version:1,action:'pause',operationId,expectedSequence:p.sequence},`pause-${label}`)).value.progress!;
      assert.equal(p.state,'paused');assert.deepEqual(p.step,current.step);assert.equal(capture(),enabled);
      await running!.stop();running=await nativeService(env,observe);await running.settings(null,delayed?2500:0);
      const status=await request('/v1/setup',undefined,`reopen-${label}`,{concurrent:true,expectedStatus:200});
      assert.equal(status.value.delivery.migrationProgress.state,'paused');assert.equal(status.value.delivery.migrationProgress.sequence,p.sequence);
      assert.equal(status.value.captureEnabled,enabled);assert.equal(capture(),enabled);
      p=(await step({version:1,action:'resume',operationId,expectedSequence:p.sequence},`resume-${label}`)).value.progress!;
      assert.equal(p.state,'pending');assert.deepEqual(p.step,current.step);assert.equal(capture(),enabled);
    };
    await pauseResume('before-disable');
    const completed=[{name:'prepare',batch:0}];
    for(let i=0;p.state!=='complete'&&i<32;i++){
      const current=p,body:ManagedStepRequest={version:1,action:'advance',operationId,expectedSequence:p.sequence,step:p.step!};
      assert.ok(MANAGED_MIGRATION_STEPS.includes(p.step!.name));assert.ok(Number.isSafeInteger(p.step!.batch)&&p.step!.batch>=0&&p.step!.batch<32);
      const label=`${p.step!.name}-${p.step!.batch}`;
      p=(await step(body,label)).value.progress!;
      assert.equal(p.operationId,operationId);assert.equal(p.sequence,current.sequence+1);assert.deepEqual(p.lastCompleted,current.step);completed.push(current.step!);
      const replay=await step(body,`${label}-retry`);assert.equal(replay.value.disposition,'replayed');assert.equal(replay.value.progress!.sequence,p.sequence);
      if(current.step!.name==='disable'){assert.equal(capture(),false);await pauseResume('after-disable');}
      if(!['prepare','expectation','enable','reconcile'].includes(current.step!.name))assert.equal(capture(),false,'capture remains off through removal/publication');
    }
    assert.equal(p.state,'complete','bounded driver must complete, not loop through refusals');assert.equal(p.step,null);assert.equal(p.capture.state,'on');
    assert.deepEqual([...new Set(completed.map(s=>s.name))],MANAGED_MIGRATION_STEPS);
    for(const name of ['remove-selector','remove-discovery']){const batches=completed.filter(s=>s.name===name).map(s=>s.batch);assert.ok(batches.length>1,'exercise multiple removal batches');assert.deepEqual(batches,batches.map((_,i)=>i));}
    const migrated=await request('/v1/setup',undefined,'complete-status',{concurrent:true,expectedStatus:200});
    assert.equal(migrated.value.delivery.migration,'complete');assert.equal(migrated.value.captureEnabled,true);
    assert.equal(migrated.value.reportingIdentity.storeId,legacy.storeId);assert.equal(migrated.value.reportingIdentity.sourceId,legacy.source.id);
    assert.equal(fs.existsSync(legacyRoot),false);assert.deepEqual(historySnapshot(),history);assert.deepEqual(payloadSnapshot(path.join(storeRoot,'payloads')),payloads);
    const installationAfter=fs.readFileSync(historyFile);assert.ok(installationAfter.subarray(0,installationBefore.length).equals(installationBefore));
    const events=installationAfter.toString().trim().split('\n').map(line=>JSON.parse(line));assert.equal(events.filter(e=>e.action==='remove-capture').length,1);
    assert.equal(privatePaths([managed,path.join(managed,'.ownership.json'),path.join(managed,'progress-binding.json')]),true);
    const ready=await request('/health',undefined,'ready-health',{limitMs:HEALTH_MS,maxSpawns:0,expectedStatus:200});assert.equal(ready.value.ready,true);assert.equal(ready.counts.legacyReads,0);
    if(!delayed){
      // Retain selected cold start and hard-link admission/refusal/recovery.
      await running.stop();running=await nativeService(env,observe);await running.stop();
      const alias=path.join(root,'database-alias.sqlite');fs.linkSync(database,alias);running=await nativeService(env,observe);
      try{await request('/v1/plans',undefined,'hardlink-read',{expectedStatus:503});const refused=await request('/health',undefined,'refused-health',{limitMs:HEALTH_MS,maxSpawns:0,expectedStatus:200});assert.equal(refused.value.ready,false);}
      finally{fs.unlinkSync(alias);}
      await request('/v1/plans',undefined,'restored-read',{expectedStatus:200});
    }
    phase='complete';
  }catch(error){
    failed=true;
    // Only fixed test-owned phase and harness code; assertion values can contain
    // private binding/history, so never propagate them into the public CI log.
    throw new Error(`Windows native ${mode} failed at ${phase} (${nativeHarnessCode(error)}); inspect windows-migration-trace.`);
  }finally{
    await running?.stop();console.log('WINDOWS_MIGRATION_TRACE '+JSON.stringify({mode,request:'summary',stage:phase,failed,serviceSha256:createHash('sha256').update(fs.readFileSync('build/service/main.js')).digest('hex'),...facts()}));
    if(fs.existsSync(root))fs.rmSync(root,{recursive:true,force:true});
  }
});
