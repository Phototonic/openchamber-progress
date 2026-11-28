/** Unprivileged side of scripts/run-setup-btrfs-qa.sh. Each invocation starts
 * a new HTTP controller and real Setup workers; mount metadata is never
 * supplied to them by the fixture. The controller holds the entire raw TAP
 * trace privately and surfaces only case dispositions and counts. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {createProgressServer} from '../../service/server.ts';
import {SetupController} from '../../service/setup-controller.ts';
import {migrationFile,readManagedFreshStepJournal} from '../../setup/managed-migration.ts';
import {managedJournalBinding} from '../../setup/managed-step-journal.ts';
import {managedVolumeIdentityReader} from '../../setup/managed-volume-reader.ts';
import {managedBindingFile,managedSourceRoots,readManagedBinding} from '../../shared/managed-binding.ts';
import type {ManagedFreshStepProgress,ManagedFreshStepRequest,ManagedFreshStepResponse} from '../../shared/managed-steps.ts';
import {digest,Store} from '../../shared/store.ts';

const payload={plugin:'// synthetic managed',guidance:'synthetic guidance',removal:'// synthetic removal',version:'1.3.0'};
const token='synthetic-native-storage';
const fsType={btrfs:0x9123683en,ext4:0xef53n,tmpfs:0x01021994n};
const {AP_BTRFS_PHASE:phase,AP_BTRFS_CONTROL:control}=process.env;
function location(name:string) {
  const value=process.env[name];
  assert.ok(value&&path.isAbsolute(value)&&path.resolve(value)===value,`missing or invalid ${name}`);
  return value;
}

async function httpFixture(env:NodeJS.ProcessEnv) {
  const setup=new SetupController({env},()=>payload);
  const server=createProgressServer(undefined,token,undefined,setup);
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const url=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  const call=async(route:string,body?:ManagedFreshStepRequest,authenticated=true)=>{
    const r=await fetch(url+route,{method:body?'POST':'GET',
      headers:{...(authenticated?{authorization:`Bearer ${token}`} :{}),'content-type':'application/json'},
      body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(22_000)});
    const value=await r.json();
    assert.ok(!JSON.stringify(value).includes('volumeIdentity'),'private witness is not on the wire');
    return {status:r.status,value};
  };
  const step=async(request:ManagedFreshStepRequest)=>{
    const {status,value}=await call('/v1/setup/managed-step',request),body=value as ManagedFreshStepResponse;
    assert.equal(body.version,2);
    assert.equal(body.accounting.securitySpawns,0);
    return {status,body};
  };
  const observe=async()=>{
    const {status,value}=await call('/v1/setup');
    assert.equal(status,200);
    assert.equal(value.delivery.managedFreshSteps,1);
    assert.equal(value.delivery.managedMigrationSteps,1);
    assert.equal(value.delivery.migrationProgress,undefined);
    return value;
  };
  return {call,step,observe,async close(){await new Promise<void>(resolve=>server.close(()=>resolve()));setup.close();}};
}
type Http=Awaited<ReturnType<typeof httpFixture>>;
function applied(result:Awaited<ReturnType<Http['step']>>,previous?:ManagedFreshStepProgress):ManagedFreshStepProgress {
  assert.equal(result.status,200,JSON.stringify(result.body.error));
  assert.equal(result.body.error,null);
  assert.equal(result.body.disposition,'applied');
  const p=result.body.progress;
  assert.ok(p);
  assert.equal(p.planKind,'fresh');
  if(previous){
    assert.equal(p.operationId,previous.operationId);
    assert.equal(p.sequence,previous.sequence+1);
    assert.deepEqual(p.plan,previous.plan);
    assert.equal(p.capturePolicy,previous.capturePolicy);
  }
  return p;
}
function mutation(action:'advance'|'resume'|'pause',p:ManagedFreshStepProgress):ManagedFreshStepRequest {
  const checkpoint={version:2 as const,operationId:p.operationId,expectedSequence:p.sequence};
  if(action==='advance'){assert.ok(p.step);return {...checkpoint,action,step:p.step};}
  return {...checkpoint,action};
}
function facts(stat:fs.BigIntStats) {
  return {device:String(stat.dev),inode:String(stat.ino),birthNs:String(stat.birthtimeNs)};
}
function witness(file:string,kind:'directory'|'file') {
  const stat=fs.lstatSync(file,{bigint:true});
  return managedVolumeIdentityReader({path:file,kind,object:facts(stat)});
}
type FileFacts=null|{object:ReturnType<typeof facts>;metadata:string[]}&
  ({entries:[string,FileFacts][]}|{content:string});
function fileFacts(file:string):FileFacts {
  const stat=fs.lstatSync(file,{bigint:true,throwIfNoEntry:false});
  if(!stat)return null;
  const {size,mtimeNs,ctimeNs,mode,nlink}=stat;
  // Read-only access can legitimately change atime. Everything that could
  // represent an effect (including same-byte rewrites) stays unchanged.
  const metadata=[size,mtimeNs,ctimeNs,mode,nlink].map(String);
  if(stat.isDirectory())return {object:facts(stat),metadata,entries:fs.readdirSync(file).sort().map(name=>[name,fileFacts(path.join(file,name))])};
  assert.ok(stat.isFile());
  return {object:facts(stat),metadata,content:digest(fs.readFileSync(file))};
}
function storeState(database:string) {
  const store=new Store(database,{readOnly:true});
  try{
    const {storeId,sources,captureEnabled}=store.list();
    return {storeId,sources,captureEnabled};
  }finally{store.close();}
}
function pausedStatus(view:Awaited<ReturnType<Http['observe']>>,baseline:Baseline,cause?:string) {
  assert.equal(view.configured,false);
  assert.equal(view.verified,false);
  assert.deepEqual(view.diagnostics,cause?[cause]:[]);
  assert.equal(view.captureEnabled,cause?null:false);
  const p=view.delivery.freshProgress as ManagedFreshStepProgress;
  assert.ok(p);
  assert.equal(p.operationId,baseline.progress.operationId);
  assert.equal(p.sequence,baseline.progress.sequence);
  assert.equal(p.state,'paused');
  assert.deepEqual(p.step,baseline.progress.step);
  assert.deepEqual(p.lastCompleted,baseline.progress.lastCompleted);
  assert.equal(p.capture.state,cause?'unknown':'off');
  assert.equal(p.capturePolicy,baseline.progress.capturePolicy);
  return p;
}
function baselineFor(env:NodeJS.ProcessEnv,root:string,database:string,progress:ManagedFreshStepProgress) {
  const journal=readManagedFreshStepJournal(env);
  assert.ok(journal);
  assert.equal(journal.migration.sequence,progress.sequence);
  assert.equal(fs.existsSync(managedBindingFile(env)),false);
  const state=storeState(database);
  assert.deepEqual(state,{storeId:journal.storeId,sources:[journal.source],captureEnabled:false});
  return {progress,journal,bytes:digest(fs.readFileSync(migrationFile(env))),databaseBytes:digest(fs.readFileSync(database)),
    directory:facts(fs.lstatSync(root,{bigint:true})),database:facts(fs.lstatSync(database,{bigint:true})),state};
}
type Baseline=ReturnType<typeof baselineFor>;

async function seed(http:Http,root:string) {
  let cursor:string|undefined,expected:string|undefined;
  for(let i=0;i<6;i++){
    const {status,body}=await http.step({version:2,action:'inspect',...(cursor?{cursor}:{storeRoot:root})});
    assert.equal(status,200,JSON.stringify(body.error));assert.equal(body.error,null);
    assert.ok(body.inspection);
    if(body.inspection.state==='complete'){
      const review=body.inspection.review;
      assert.equal(review.targets.storeRoot,root);
      assert.equal(review.capturePolicy,'enable-new');
      assert.equal(review.capture.state,'unknown');
      expected=review.expected;break;
    }
    cursor=body.inspection.cursor??undefined;
  }
  assert.ok(expected,'fresh inspection did not complete');
  const operationId=randomUUID();
  let p=applied(await http.step({version:2,action:'begin',operationId,confirmed:true,expected}));
  assert.equal(p.operationId,operationId);
  // Pause after both creation and registration, but before the selector or
  // enable. Refusal must preserve an actual, already registered source.
  for(let i=0;i<p.plan.length&&p.lastCompleted?.name!=='register-source';i++){
    p=applied(await http.step(mutation('advance',p)),p);
  }
  assert.equal(p.lastCompleted?.name,'register-source');
  assert.equal(p.step?.name,'publish-binding');
  p=applied(await http.step(mutation('pause',p)),p);
  assert.equal(p.state,'paused');
  assert.equal(p.capture.state,'off');
  return p;
}

test('native Setup storage phase',async()=>{
  assert.equal(process.platform,'linux');
  assert.ok((process.getuid?.()??0)>0&&(process.geteuid?.()??0)>0,'driver must run unprivileged');
  assert.ok(phase&&['bare-loop','seed','snapshot','copy','original','controls'].includes(phase),'missing or unknown phase');
  assert.ok(phase==='controls'?control&&['ext4','ext4-copy','tmpfs'].includes(control):!control,'invalid control phase');
  const profile=location('AP_BTRFS_PROFILE'),root=location('AP_BTRFS_STORE'),env=process.env;
  const top=location('AP_BTRFS_TOP'),database=path.join(root,'progress.sqlite'),baselineFile=path.join(profile,'baseline.json');
  for(const [key,leaf] of Object.entries({HOME:'home',TMPDIR:'tmp',XDG_CONFIG_HOME:'config',XDG_DATA_HOME:'data',
    XDG_STATE_HOME:'state',XDG_CACHE_HOME:'cache',XDG_RUNTIME_DIR:'runtime'})){
    assert.equal(env[key],path.join(profile,leaf),'expected isolated synthetic environment');
  }
  const expectedFs=phase==='controls'?(control==='tmpfs'?fsType.tmpfs:fsType.ext4):fsType.btrfs;
  assert.equal(BigInt.asUintN(32,fs.statfsSync(root,{bigint:true}).type),expectedFs);
  assert.notEqual(fs.lstatSync(profile,{bigint:true}).dev,fs.lstatSync(root,{bigint:true}).dev);
  const {configRoot,dataRoot}=managedSourceRoots(env);
  for(const dir of [configRoot,dataRoot])fs.mkdirSync(dir,{recursive:true,mode:0o700});
  const beforeEffects=()=>[fileFacts(configRoot),fileFacts(dataRoot),fileFacts(root)];
  const http=await httpFixture(env);
  try{
    if(phase==='seed'||phase==='bare-loop'||phase==='controls'&&control!=='ext4-copy'){
      let p=await seed(http,root);
      const before=baselineFor(env,root,database,p);
      const proof=before.journal.migration.fresh.volumeIdentity;
      if(phase==='seed'){
        assert.equal(proof?.version,1);
        assert.ok(BigInt(before.directory.birthNs)>0n&&BigInt(before.database.birthNs)>0n);
        assert.deepEqual(before.journal.migration.fresh.directory.object,before.directory);
        assert.deepEqual(before.journal.migration.created.database?.object,before.database);
        for(const [file,kind] of [[root,'directory'],[database,'file']] as const){
          const observed=witness(file,kind);
          assert.equal(observed.kind,'verified');
          assert.equal(proof?.paths.find(item=>item.path===file)?.fingerprint,observed.fingerprint);
        }
      }else{
        assert.equal(proof,undefined);
        assert.deepEqual(witness(root,'directory'),{kind:'unavailable'});
        if(phase==='bare-loop')return;
        const effects=beforeEffects();
        p=pausedStatus(await http.observe(),before);
        assert.deepEqual(beforeEffects(),effects);
        p=applied(await http.step(mutation('resume',p)),p);
        assert.equal(p.state,'pending');
        assert.equal(p.capture.state,'off');
        assert.deepEqual(storeState(database),before.state);
        if(control==='tmpfs')return;
        p=applied(await http.step(mutation('pause',p)),p);
      }
      fs.writeFileSync(baselineFile,JSON.stringify(baselineFor(env,root,database,p)),{mode:0o600,flag:'wx'});
      return;
    }

    const baseline=JSON.parse(fs.readFileSync(baselineFile,'utf8')) as Baseline;
    assert.equal(digest(fs.readFileSync(migrationFile(env))),baseline.bytes,'paused journal unchanged across phases');
    assert.deepEqual(readManagedFreshStepJournal(env),baseline.journal);
    assert.equal(fs.existsSync(managedBindingFile(env)),false);
    assert.equal(digest(fs.readFileSync(database)),baseline.databaseBytes);
    assert.deepEqual(storeState(database),baseline.state);
    for(const [file,kind,prior] of [[root,'directory',baseline.directory],[database,'file',baseline.database]] as const){
      const live=facts(fs.lstatSync(file,{bigint:true}));
      assert.equal(live.inode,prior.inode);
      assert.equal(live.birthNs,prior.birthNs);
      if(phase==='original'||control==='ext4-copy')assert.notEqual(live.device,prior.device,'fixture must actually renumber');
      const proof=witness(file,kind);
      if(control==='ext4-copy'){
        assert.equal(baseline.journal.migration.fresh.volumeIdentity,undefined);
        assert.equal(proof.kind,'unavailable');
      }else{
        const saved=baseline.journal.migration.fresh.volumeIdentity?.paths.find(item=>item.path===file)?.fingerprint;
        assert.ok(saved);
        assert.equal(proof.kind,'verified','replacement must have a real proof, not an unavailable observation');
        assert.equal(proof.fingerprint===saved,phase==='original');
      }
    }
    if(phase==='snapshot'){
      // The controller independently verifies actual WWN, FS UUID and subvolid
      // for direct snapshot/copy/original. For the nested probe the containing
      // top-level mount is itself provable, but must not lend that proof.
      assert.equal(witness(top,'directory').kind,'verified');
      const nested=path.join(top,'snapshot','store');
      const nestedStat=fs.lstatSync(nested,{bigint:true});
      assert.equal(String(nestedStat.ino),baseline.directory.inode);
      assert.equal(String(nestedStat.birthtimeNs),baseline.directory.birthNs);
      assert.deepEqual(witness(nested,'directory'),{kind:'unavailable'});
      assert.deepEqual(witness(path.join(nested,'progress.sqlite'),'file'),{kind:'unavailable'});
    }
    const effects=beforeEffects(),cause=phase==='original'?undefined:'managed-migration-conflict';
    let p=pausedStatus(await http.observe(),baseline,cause);
    assert.deepEqual(beforeEffects(),effects,'cold status must not write');
    const request=mutation('resume',p);
    if(cause){
      assert.equal((await http.call('/v1/setup/managed-step',request,false)).status,401);
      for(const request of [mutation('resume',p),mutation('advance',p)]){
        const r=await http.step(request);
        assert.equal(r.status,409);assert.equal(r.body.disposition,'refused');
        // Resume must diagnose placement. Advance is independently gated by
        // the still-paused state and must never get to an effect.
        assert.equal(r.body.error?.code,request.action==='resume'?cause:'managed-step-conflict');
        assert.equal(r.body.progress?.sequence,p.sequence);assert.equal(r.body.progress?.operationId,p.operationId);
        assert.deepEqual(beforeEffects(),effects,'refusal wrote journal, selector, Store or history');
      }
      pausedStatus(await http.observe(),baseline,cause);
      assert.deepEqual(storeState(database),baseline.state);
      assert.deepEqual(beforeEffects(),effects);
      return;
    }
    p=applied(await http.step(request),p);
    assert.equal(p.state,'pending');
    assert.deepEqual(p.lastCompleted,baseline.progress.lastCompleted);
    assert.deepEqual(p.step,baseline.progress.step);
    assert.equal(p.capture.state,'off');
    const compareReplayed=async(request:ManagedFreshStepRequest,p:ManagedFreshStepProgress)=>{
      const effects=beforeEffects(),reply=await http.step(request);
      assert.equal(reply.status,200);assert.equal(reply.body.error,null);assert.equal(reply.body.disposition,'replayed');
      assert.equal(reply.body.progress?.operationId,p.operationId);assert.equal(reply.body.progress?.sequence,p.sequence);
      assert.deepEqual(reply.body.progress?.lastCompleted,p.lastCompleted);
      assert.deepEqual(beforeEffects(),effects,'replay must not repeat any effect');
    };
    await compareReplayed(request,p);
    let enabled=false;
    for(let i=0;i<p.plan.length&&p.state!=='complete';i++){
      const advance=mutation('advance',p),step=p.step;
      p=applied(await http.step(advance),p);
      assert.deepEqual(p.lastCompleted,step);
      if(step?.name==='enable')enabled=true;
      assert.deepEqual(storeState(database),{...baseline.state,captureEnabled:enabled});
      await compareReplayed(advance,p);
    }
    assert.equal(p.state,'complete');
    assert.equal(enabled,true);
    const journal=readManagedFreshStepJournal(env);
    assert.ok(journal);
    assert.equal(journal.migration.operationId,baseline.journal.migration.operationId);
    for(const key of ['consent','fresh','created','plan','expectation','captureRenewals'] as const){
      assert.deepEqual(journal.migration[key],baseline.journal.migration[key]);
    }
    assert.deepEqual(readManagedBinding(env),managedJournalBinding(baseline.journal));
    assert.deepEqual(storeState(database),{...baseline.state,captureEnabled:true});
    const verified=await http.observe();
    assert.deepEqual(verified.diagnostics,[]);
    assert.equal(verified.configured,true);assert.equal(verified.verified,true);assert.equal(verified.captureEnabled,true);
    assert.deepEqual(verified.reportingIdentity,{storeId:journal.storeId,sourceId:journal.source.id,verified:true});
    assert.equal(verified.delivery.freshProgress.state,'complete');
    assert.equal(verified.delivery.freshProgress.sequence,p.sequence);
  }finally{await http.close();}
});
