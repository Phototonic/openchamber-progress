import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {isolatedEnvironment} from '../fixtures/managed.ts';
import {lifecycle,migrationEvidence,SetupError} from '../../setup/lifecycle.ts';
import {createManagedBindingDirectory,managedBindingFile,managedExpectationFile} from '../../shared/managed-binding.ts';
import {readManagedStepJournal,readManagedFreshStepJournal,migrationFile,writeMigration} from '../../setup/managed-migration.ts';
import {inspectManagedStep,inspectManagedFreshStep,type ManagedInspectionSession,type ManagedFreshInspectionSession} from '../../setup/managed-inspection.ts';
import {beginManagedStep,advanceManagedStep,controlManagedStep} from '../../setup/managed-step-engine.ts';
import {PlatformRequestBudget,withPlatformRequestBudget,writerTarget} from '../../shared/platform.ts';
import {Store,digest} from '../../shared/store.ts';
import {observeManagedSetup} from '../../setup/managed-observation.ts';
import {nextAction} from '../../ui/shared/setup-steps.ts';
import type {ManagedStepRequest,ManagedFreshStepRequest} from '../../shared/managed-steps.ts';

const payload={plugin:'// synthetic managed',guidance:'synthetic guidance',removal:'// synthetic removal',version:'1.3.0'};
function freshFixture(kind:'absent'|'directory'|'new-source'|'reuse'='absent',enabled=false){
  const root=fs.mkdtempSync('/tmp/opencode/fresh-engine-'),env=isolatedEnvironment(root);
  const roots={configRoot:path.join(env.XDG_CONFIG_HOME!,'opencode'),dataRoot:path.join(env.XDG_DATA_HOME!,'opencode')};
  for(const p of Object.values(roots))fs.mkdirSync(p,{mode:0o700});
  const storeRoot=path.join(root,'custom store ü'),database=path.join(storeRoot,'progress.sqlite');
  if(kind!=='absent')fs.mkdirSync(storeRoot,{mode:0o700});
  if(kind==='new-source'||kind==='reuse'){
    const store=new Store(database,{create:true});try{
      store.registerSource({id:'retained-other',configRoot:path.join(root,'other-config'),dataRoot:path.join(root,'other-data'),verified:true});
      store.apply({op:'start',plan:'retained-plan',oid:'retained-start',rev:0,title:'Retained work',items:[{id:'task',title:'Retained task',kind:'task',status:'working'}]},
        {sourceId:'retained-other',sessionId:'retained-session',agent:'build',directory:'/fixture/project',projectId:'fixture-project',parentId:null,ancestry:[],verifiedSource:true});
      store.setEnabled(enabled);
      if(kind==='reuse')store.registerSource({id:'retained-source',...roots,verified:true});
    }finally{store.close();}
    fs.writeFileSync(path.join(storeRoot,'installation-history.jsonl'),JSON.stringify({action:'retained-history',installId:'retained-install'})+'\n',{mode:0o600});
  }
  const review=()=>{let s:ManagedFreshInspectionSession|undefined;for(let i=0;i<5;i++)s=inspectManagedFreshStep(env,payload,s,s?undefined:storeRoot).session;return s!;};
  const journal=()=>readManagedFreshStepJournal(env)!;
  const begin=(session=review())=>{const budget=new PlatformRequestBudget();return withPlatformRequestBudget(budget,()=>beginManagedStep(env,payload,
    {version:2,action:'begin',operationId:'11111111-1111-4111-8111-111111111111',confirmed:true,expected:session.review!.expected},budget,session));};
  const request=():Extract<ManagedFreshStepRequest,{action:'advance'}>=>{const m=journal().migration;return {version:2,action:'advance',operationId:m.operationId,expectedSequence:m.sequence,step:m.step!};};
  const advance=(r=request())=>{const budget=new PlatformRequestBudget();return withPlatformRequestBudget(budget,()=>advanceManagedStep(env,payload,r,budget,journal()));};
  const control=(action:'pause'|'resume'|'abandon',session?:ManagedFreshInspectionSession)=>{
    const j=journal(),budget=new PlatformRequestBudget(),r:Extract<ManagedFreshStepRequest,{action:'pause'|'resume'|'abandon'}>={version:2,action,operationId:j.migration.operationId,expectedSequence:j.migration.sequence,
      ...(session?{review:{confirmed:true,step:'enable',expected:session.review!.expected}}:{})};
    return withPlatformRequestBudget(budget,()=>controlManagedStep(env,payload,r,budget,j,session));
  };
  const until=(name:string)=>{while(journal().migration.step?.name!==name){const r=advance();assert.equal(r.disposition,'applied',JSON.stringify(r.error));}};
  const capture=(enabled?:boolean)=>{const s=new Store(database);try{if(enabled!==undefined)s.setEnabled(enabled);return s.list().captureEnabled;}finally{s.close();}};
  return {root,env,roots,storeRoot,database,review,journal,begin,request,advance,control,until,capture,cleanup(){fs.rmSync(root,{recursive:true,force:true});}};
}

for(const kind of ['absent','directory','new-source','reuse'] as const)for(const enabled of [false,true])test(`fresh ${kind} completes its frozen plan and preserves retained capture ${enabled}`,()=>{
  const f=freshFixture(kind,enabled);try{
    const review=f.review(),initial=review.candidate!,old=fs.existsSync(f.database)?fs.readFileSync(f.database):null;
    const retained=()=>{const s=new Store(f.database,{readOnly:true});try{return ['plans','revisions','receipts','sessions','captures','contributions'].map(table=>s.db.prepare(`SELECT * FROM ${table}`).all());}finally{s.close();}};
    const oldData=old?retained():null,history=old?fs.readFileSync(path.join(f.storeRoot,'installation-history.jsonl')):null;
    assert.equal(fs.existsSync(managedBindingFile(f.env)),false);assert.equal(fs.existsSync(migrationFile(f.env)),false);
    if(old)assert.deepEqual(fs.readFileSync(f.database),old);else assert.equal(fs.existsSync(f.database),false);
    f.begin(review);assert.equal(fs.existsSync(f.database),!!old);
    let last:ReturnType<typeof f.request>|undefined;
    while(f.journal().migration.state!=='complete'){
      const r=f.request(),reply=f.advance(r);last=r;assert.equal(reply.disposition,'applied',JSON.stringify(reply.error));
      assert.deepEqual(f.journal().migration.consent.targetDigest,initial.migration.consent.targetDigest);
      assert.equal(f.journal().storeId,initial.storeId);assert.deepEqual(f.journal().source,initial.source);
      const bytes=fs.readFileSync(migrationFile(f.env));assert.equal(f.advance(r).disposition,'replayed');assert.deepEqual(fs.readFileSync(migrationFile(f.env)),bytes);
      if(!['new-source','reuse'].includes(kind)&&!['enable','reconcile'].includes(r.step.name)&&fs.existsSync(f.database))assert.equal(f.capture(),false);
    }
    assert.equal(f.capture(),kind==='new-source'||kind==='reuse'?enabled:true);
    if(old){assert.deepEqual(retained(),oldData);assert.deepEqual(fs.readFileSync(path.join(f.storeRoot,'installation-history.jsonl')),history);}
    const s=new Store(f.database,{readOnly:true});try{assert.equal(s.list().sources.length,kind==='new-source'||kind==='reuse'?2:1);}finally{s.close();}
    f.capture(false);assert.equal(f.advance(last!).disposition,'replayed');assert.equal(f.capture(),false);
  }finally{f.cleanup();}
});

for(const boundary of ['intent','completion'] as const)for(const after of [false,true])test(`fresh every step ${boundary} interruption ${after?'after':'before'} journal publication`,t=>{
  for(const name of ['store-directory','create-store','expectation','register-source','publish-binding','enable','reconcile']){
    const f=freshFixture();try{
      f.begin();f.until(name);
      const request=f.request(),file=migrationFile(f.env),rename=fs.renameSync;let tripped=false;
      const mock=t.mock.method(fs,'renameSync',((from:any,to:any)=>{
        if(String(to)===file&&!tripped){const n=JSON.parse(fs.readFileSync(from,'utf8')).migration;
          if(boundary==='intent'?n.state==='running':n.lastCompleted?.name===request.step.name){tripped=true;if(after)rename(from,to);throw new Error('synthetic interruption');}}
        return rename(from,to);
      }) as typeof fs.renameSync);syncBuiltinESMExports();
      try{assert.equal(f.advance(request).disposition,'refused');}finally{mock.mock.restore();syncBuiltinESMExports();}
      assert.equal(tripped,true);
      const m=f.journal().migration;
      if(m.lastCompleted?.name===request.step.name){assert.equal(f.advance(request).disposition,'replayed');continue;}
      if(boundary==='completion'&&!after&&request.step.name==='store-directory'){
        assert.equal(fs.existsSync(f.storeRoot),true);assert.throws(()=>f.control('resume'),{code:'managed-migration-conflict'});
        const status=observeManagedSetup(f.env).status;
        assert.equal(status.delivery!.migration,'unavailable');
        assert.equal(status.delivery!.freshProgress,undefined);
        assert.equal(status.delivery!.planKind,'fresh');
        assert.deepEqual(status.diagnostics,['managed-migration-conflict']);
        assert.equal(fs.existsSync(f.database),false);continue; // retained, manual-diagnosis boundary
      }
      if(m.intent){if(request.step.name==='enable'&&!f.capture())f.control('resume',f.review());else f.control('resume');}
      assert.equal(f.advance().disposition,'applied');
    }finally{f.cleanup();}
  }
});

test('fresh initialized database with an uncheckpointed orphan sidecar refuses read-only reconciliation',t=>{
  const f=freshFixture();try{
    f.begin();f.until('create-store');const rename=fs.renameSync,file=migrationFile(f.env);
    const mock=t.mock.method(fs,'renameSync',((from:any,to:any)=>{
      if(String(to)===file&&JSON.parse(fs.readFileSync(from,'utf8')).migration.lastCompleted?.name==='create-store'){
        fs.writeFileSync(f.database+'-wal','orphan',{mode:0o600});throw new Error('synthetic checkpoint interruption');
      }
      return rename(from,to);
    }) as typeof fs.renameSync);syncBuiltinESMExports();
    try{assert.equal(f.advance().disposition,'refused');}finally{mock.mock.restore();syncBuiltinESMExports();}
    assert.equal(f.journal().migration.created.database,null);
    const db=fs.readFileSync(f.database),wal=fs.readFileSync(f.database+'-wal'),journal=fs.readFileSync(file);
    assert.throws(()=>f.control('resume'),{code:'managed-migration-conflict'});
    assert.deepEqual(fs.readFileSync(f.database),db);assert.deepEqual(fs.readFileSync(f.database+'-wal'),wal);assert.deepEqual(fs.readFileSync(file),journal);
  }finally{f.cleanup();}
});

test('fresh checkpointed database permits legitimate live WAL sidecars during normal operation',()=>{
  const f=freshFixture();try{
    f.begin();f.until('expectation');const live=new Store(f.database);
    try{
      live.db.exec('PRAGMA journal_mode=WAL');live.setEnabled(false);
      assert.equal(fs.existsSync(f.database+'-wal'),true);
      assert.equal(observeManagedSetup(f.env).status.delivery!.freshProgress!.capture.state,'off');
      assert.equal(f.advance().disposition,'applied');
    }finally{live.close();}
  }finally{f.cleanup();}
});

for(const complete of [false,true])test(`fresh ${complete?'complete':'checkpointed pending'} observation retains progress on a transient Store read failure`,t=>{
  const f=freshFixture();try{
    f.begin();f.until('expectation');
    if(complete)while(f.journal().migration.state!=='complete')assert.equal(f.advance().disposition,'applied');
    const journal=fs.readFileSync(migrationFile(f.env)),database=fs.readFileSync(f.database);
    assert.ok(f.journal().migration.created.database);
    const mock=t.mock.method(Store.prototype,'list',()=>{throw Object.assign(new Error('synthetic read failure'),{code:complete?'EACCES':'EBUSY'});});
    let status:ReturnType<typeof observeManagedSetup>['status'];
    try{status=observeManagedSetup(f.env).status;}finally{mock.mock.restore();}
    assert.equal(mock.mock.callCount(),1);
    assert.equal(status.delivery!.migration,complete?'complete':'pending');
    assert.equal(status.delivery!.freshProgress!.state,complete?'complete':'pending');
    assert.equal(nextAction(status.delivery!.freshProgress!),complete?null:'continue');
    assert.equal(status.delivery!.freshProgress!.capture.state,'unknown');
    assert.equal(status.captureEnabled,null);assert.equal(status.verified,false);
    assert.deepEqual(status.diagnostics,[complete?'EACCES':'EBUSY']);
    assert.deepEqual(fs.readFileSync(migrationFile(f.env)),journal);
    assert.deepEqual(fs.readFileSync(f.database),database);
  }finally{f.cleanup();}
});

test('a trusted hint from the other family falls back to the durable requested family',()=>{
  const fresh=freshFixture(),legacy=fixture();try{
    fresh.begin();
    for(const [env,journal,hint,version] of [[fresh.env,fresh.journal(),legacy.journal(),2],[legacy.env,legacy.journal(),fresh.journal(),1]] as const){
      const budget=new PlatformRequestBudget(),m=journal.migration;
      const reply=withPlatformRequestBudget(budget,()=>controlManagedStep(env,payload,
        {version,action:'pause',operationId:m.operationId,expectedSequence:m.sequence},budget,hint));
      assert.equal(reply.disposition,'applied');assert.equal(reply.progress.state,'paused');
      assert.equal(reply.journal.migration.format,journal.migration.format);
    }
  }finally{fresh.cleanup();legacy.cleanup();}
});

test('fresh paused pre-store operation remains unknown and requires explicit continuation; wrong family refuses',()=>{
  const f=freshFixture();try{
    f.begin();const before=f.journal(),bytes=fs.readFileSync(migrationFile(f.env));
    const budget=new PlatformRequestBudget();assert.throws(()=>withPlatformRequestBudget(budget,()=>advanceManagedStep(f.env,payload,
      {version:1,action:'advance',operationId:before.migration.operationId,expectedSequence:1,step:{name:'expectation',batch:0}},budget,before)),{code:'managed-journal-unsupported'});
    assert.deepEqual(fs.readFileSync(migrationFile(f.env)),bytes);
    assert.equal(f.control('pause').progress.capture.state,'unknown');assert.throws(()=>f.advance(),{code:'managed-step-conflict'});
    assert.equal(fs.existsSync(f.storeRoot),false);f.control('resume');assert.equal(f.advance().disposition,'applied');
  }finally{f.cleanup();}
});

for(const after of [false,true])test(`fresh uncertain enable ${after?'after':'before'} effect uses single-use capture review`,t=>{
  const f=freshFixture();try{
    f.begin();f.until('enable');const set=Store.prototype.setEnabled;
    const mock=t.mock.method(Store.prototype,'setEnabled',function(this:Store,v:boolean){if(after)set.call(this,v);throw new Error('synthetic interruption');});
    try{assert.equal(f.advance().disposition,'refused');}finally{mock.mock.restore();}
    if(after)f.control('resume');else{assert.throws(()=>f.control('resume'),{code:'managed-step-unsettled'});f.control('resume',f.review());}
    assert.equal(f.advance().disposition,'applied');assert.equal(f.capture(),true);
    f.capture(false);assert.equal(f.advance().disposition,'applied');assert.equal(f.capture(),false);
  }finally{f.cleanup();}
});

test('fresh reserved partial database is retained and never reopened to repair initialization',t=>{
  const f=freshFixture();try{
    f.begin();f.until('create-store');const exec=DatabaseSync.prototype.exec;
    const mock=t.mock.method(DatabaseSync.prototype,'exec',function(this:DatabaseSync,sql:string){if(sql.includes('CREATE TABLE meta'))throw new Error('synthetic initialization interruption');return exec.call(this,sql);});
    try{assert.equal(f.advance().disposition,'refused');}finally{mock.mock.restore();}
    const partial=fs.readFileSync(f.database),journal=fs.readFileSync(migrationFile(f.env));
    assert.equal(f.journal().migration.intent!.step.name,'create-store');assert.equal(f.journal().migration.created.database,null);
    assert.throws(()=>f.control('resume'));assert.throws(()=>f.advance());
    assert.deepEqual(fs.readFileSync(f.database),partial);assert.deepEqual(fs.readFileSync(migrationFile(f.env)),journal);
    assert.equal(fs.existsSync(managedBindingFile(f.env)),false);
  }finally{f.cleanup();}
});

for(const after of [false,true])test(`fresh prepare interrupted ${after?'after':'before'} marker publication retains its bootstrap boundary`,t=>{
  const f=freshFixture();try{
    const session=f.review(),marker=path.join(f.roots.dataRoot,'agent-progress-managed','.ownership.json'),write=fs.writeFileSync;
    const mock=t.mock.method(fs,'writeFileSync',((file:any,...args:any[])=>{
      if(String(file)===marker){if(after)(write as any)(file,...args);throw new Error('synthetic marker interruption');}
      return (write as any)(file,...args);
    }) as typeof fs.writeFileSync);syncBuiltinESMExports();
    try{assert.throws(()=>f.begin(session),/synthetic marker interruption/);}finally{mock.mock.restore();syncBuiltinESMExports();}
    assert.equal(fs.existsSync(path.dirname(marker)),true);assert.equal(fs.existsSync(path.join(path.dirname(marker),'migration.json')),false);assert.equal(fs.existsSync(f.storeRoot),false);
    if(after){assert.equal(f.begin().disposition,'applied');assert.equal(f.journal().migration.sequence,1);}
    else {
      assert.throws(()=>f.review(),{code:'managed-binding-invalid'});assert.equal(fs.readdirSync(path.dirname(marker)).length,0);
      const status=observeManagedSetup(f.env).status;
      assert.equal(status.delivery!.planKind,'fresh');assert.deepEqual(status.diagnostics,['managed-binding-invalid']);
    }
    assert.equal(fs.existsSync(f.database),false);
  }finally{f.cleanup();}
});

test('fresh prepare publishes without a retained stage when birthtime follows ctime',t=>{
  const f=freshFixture();try{
    const session=f.review(),file=migrationFile(f.env),stagePrefix=`${file}.stage-prepare-`;
    const {openSync,fstatSync,lstatSync}=fs;
    let stageFd:number|undefined;
    // Keep real filesystem identity; model ctime ticks using write/link state
    // so the regression doesn't depend on the native filesystem clock.
    const fallback=(stat:fs.BigIntStats)=>{
      stat.birthtimeNs=stat.ctimeNs=stat.size===0n?1n:1n+stat.nlink;
      return stat;
    };
    const open=t.mock.method(fs,'openSync',((name,...args)=>{
      const fd=openSync(name,...args);
      if(String(name).startsWith(stagePrefix))stageFd=fd;
      return fd;
    }) as typeof openSync);
    const fstat=t.mock.method(fs,'fstatSync',((fd,options)=>{
      const stat=fstatSync(fd,options);
      return fd===stageFd&&options?.bigint?fallback(stat as fs.BigIntStats):stat;
    }) as typeof fstatSync);
    const lstat=t.mock.method(fs,'lstatSync',((name,options)=>{
      const stat=lstatSync(name,options);
      return stat&&options?.bigint&&String(name).startsWith(stagePrefix)?fallback(stat as fs.BigIntStats):stat;
    }) as typeof lstatSync);
    syncBuiltinESMExports();
    try{assert.equal(f.begin(session).disposition,'applied');}
    finally{lstat.mock.restore();fstat.mock.restore();open.mock.restore();syncBuiltinESMExports();}
    assert.equal(f.journal().migration.sequence,1);
    assert.equal(fs.lstatSync(file).nlink,1);
    assert.deepEqual(fs.readdirSync(path.dirname(file)).sort(),['.ownership.json','migration.json']);
    assert.equal(fs.existsSync(f.storeRoot),false);
  }finally{f.cleanup();}
});

test('cold fresh begin settles a retained first journal when birthtime follows ctime',t=>{
  const f=freshFixture();try{
    const session=f.review(),{operationId}=f.begin(session).progress;
    const request={version:2,action:'begin',operationId,confirmed:true,expected:session.review!.expected} as const;
    const file=migrationFile(f.env),bytes=fs.readFileSync(file),stage=`${file}.stage-prepare-${digest(bytes)}`;
    fs.linkSync(file,stage);
    const {fstatSync,lstatSync}=fs,first=lstatSync(file,{bigint:true});
    // Model the statx fallback on the real journal inode. The link count
    // provides a deterministic ctime change when recovery removes the stage.
    const fallback=(stat:fs.BigIntStats)=>{
      if(stat.dev===first.dev&&stat.ino===first.ino)stat.birthtimeNs=stat.ctimeNs=stat.nlink;
      return stat;
    };
    const fstat=t.mock.method(fs,'fstatSync',((fd,options)=>{
      const stat=fstatSync(fd,options);
      return options?.bigint?fallback(stat as fs.BigIntStats):stat;
    }) as typeof fstatSync);
    const lstat=t.mock.method(fs,'lstatSync',((name,options)=>{
      const stat=lstatSync(name,options);
      return stat&&options?.bigint?fallback(stat as fs.BigIntStats):stat;
    }) as typeof lstatSync);
    syncBuiltinESMExports();
    try{
      const targets=[writerTarget('scope',f.roots.dataRoot),writerTarget('store',f.storeRoot)];
      const budget=new PlatformRequestBudget(undefined,{targets});
      const retry=withPlatformRequestBudget(budget,()=>beginManagedStep(f.env,payload,request,budget));
      assert.equal(retry.disposition,'replayed');assert.equal(retry.progress.sequence,1);
      const final=fs.lstatSync(file,{bigint:true});
      assert.equal(final.dev,first.dev);assert.equal(final.ino,first.ino);assert.equal(final.nlink,1n);
      assert.deepEqual(fs.readFileSync(file),bytes);
      assert.equal(fs.existsSync(stage),false);assert.equal(fs.existsSync(f.storeRoot),false);
    }finally{lstat.mock.restore();fstat.mock.restore();syncBuiltinESMExports();}
  }finally{f.cleanup();}
});

for(const publication of ['journal','expectation','binding'] as const)for(const linked of [false,true])test(`fresh ${publication} retained ${linked?'two-link':'stage'} publication refuses without cleanup`,()=>{
  const f=freshFixture();try{
    f.begin();if(publication!=='journal')f.until(publication==='expectation'?'register-source':'enable');
    const j=f.journal(),request=f.request(),file=publication==='journal'?migrationFile(f.env):publication==='expectation'?managedExpectationFile(j):managedBindingFile(f.env),stage=file+'.stage-retained';
    if(linked)fs.linkSync(file,stage);else fs.writeFileSync(stage,'retained stage',{mode:0o600});
    const bytes=fs.readFileSync(migrationFile(f.env)),stageBytes=fs.readFileSync(stage),budget=new PlatformRequestBudget();
    assert.throws(()=>withPlatformRequestBudget(budget,()=>advanceManagedStep(f.env,payload,request,budget,j)));
    assert.deepEqual(fs.readFileSync(migrationFile(f.env)),bytes);assert.deepEqual(fs.readFileSync(stage),stageBytes);
    if(linked)assert.equal(fs.lstatSync(file).nlink,2);
  }finally{f.cleanup();}
});

test('a retained first fresh save requires both writer slots and matching package before an explicit control',()=>{
  const f=freshFixture();try{
    const p=f.begin().progress,file=migrationFile(f.env),bytes=fs.readFileSync(file),stage=`${file}.stage-prepare-${digest(bytes)}`;
    fs.linkSync(file,stage);
    const scope=writerTarget('scope',f.roots.dataRoot),store=writerTarget('store',f.storeRoot);
    const pause={version:2,action:'pause',operationId:p.operationId,expectedSequence:p.sequence} as const;
    const control=(targets:string[],current=payload)=>{
      const budget=new PlatformRequestBudget(undefined,{targets});
      return withPlatformRequestBudget(budget,()=>controlManagedStep(f.env,current,pause,budget));
    };
    assert.throws(()=>control([scope]),{code:'managed-step-conflict'});
    assert.throws(()=>control([store]),{code:'managed-step-conflict'});
    assert.throws(()=>control([scope,store],{...payload,plugin:'// different synthetic bytes'}),{code:'managed-review-stale'});
    assert.deepEqual(fs.readFileSync(file),bytes);assert.deepEqual(fs.readFileSync(stage),bytes);assert.equal(fs.statSync(stage).nlink,2);
    const paused=control([scope,store]);
    assert.equal(paused.disposition,'applied');assert.equal(paused.progress.sequence,2);assert.equal(paused.progress.state,'paused');
    assert.equal(fs.existsSync(stage),false);assert.equal(fs.existsSync(f.storeRoot),false);
  }finally{f.cleanup();}
});

for(const damage of ['unexpected-directory','orphan-sidecar','directory-replaced','database-replaced','database-missing','source-conflict','expectation','selector','legacy','package'] as const)test(`fresh target ${damage} refuses without changing retained state`,()=>{
  const f=freshFixture();try{
    f.begin();
    if(damage!=='unexpected-directory')f.until(damage==='orphan-sidecar'||damage==='directory-replaced'?'create-store':damage==='source-conflict'?'register-source':'enable');
    if(damage==='unexpected-directory')fs.mkdirSync(f.storeRoot,{mode:0o700});
    if(damage==='orphan-sidecar')fs.writeFileSync(f.database+'-wal','orphan',{mode:0o600});
    if(damage==='directory-replaced'){fs.renameSync(f.storeRoot,f.storeRoot+'.retained');fs.mkdirSync(f.storeRoot,{mode:0o700});}
    if(damage==='database-replaced'){fs.renameSync(f.database,f.database+'.retained');fs.copyFileSync(f.database+'.retained',f.database);fs.chmodSync(f.database,0o600);}
    if(damage==='database-missing')fs.renameSync(f.database,f.database+'.retained');
    if(damage==='source-conflict'){const s=new Store(f.database);try{s.registerSource({...f.journal().source,id:'conflicting-source'});}finally{s.close();}}
    if(damage==='expectation')fs.appendFileSync(managedExpectationFile(f.journal()),'changed');
    if(damage==='selector')fs.appendFileSync(managedBindingFile(f.env),'changed');
    if(damage==='legacy')fs.mkdirSync(path.join(f.roots.configRoot,'plugins','agent-progress'),{recursive:true,mode:0o700});
    const bytes=fs.readFileSync(migrationFile(f.env)),db=fs.existsSync(f.database)?fs.readFileSync(f.database):null,budget=new PlatformRequestBudget();
    const run=()=>withPlatformRequestBudget(budget,()=>advanceManagedStep(f.env,damage==='package'?{...payload,plugin:'changed'}:payload,f.request(),budget,f.journal()));
    if(damage==='expectation')assert.throws(run,{code:'managed-migration-conflict'});else assert.throws(run);
    assert.deepEqual(fs.readFileSync(migrationFile(f.env)),bytes);if(db)assert.deepEqual(fs.readFileSync(f.database),db);else assert.equal(fs.existsSync(f.database),false);
  }finally{f.cleanup();}
});

test('fresh repeated uncertain enable needs another review and cannot reuse stale or consumed consent',t=>{
  const f=freshFixture();try{
    f.begin();f.until('enable');
    const interrupt=()=>{const mock=t.mock.method(Store.prototype,'setEnabled',()=>{throw new Error('synthetic capture interruption');});try{assert.equal(f.advance().disposition,'refused');}finally{mock.mock.restore();}};
    interrupt();const first=f.review();f.control('resume',first);interrupt();
    const bytes=fs.readFileSync(migrationFile(f.env));assert.throws(()=>f.control('resume'),{code:'managed-step-unsettled'});
    assert.throws(()=>f.control('resume',first),{code:'managed-review-stale'});assert.deepEqual(fs.readFileSync(migrationFile(f.env)),bytes);
    const second=f.review();f.capture(true);assert.throws(()=>f.control('resume',second),{code:'managed-review-stale'});f.capture(false);
    f.control('resume',f.review());assert.equal(f.journal().migration.captureRenewals.length,2);assert.equal(f.advance().disposition,'applied');
    f.capture(false);assert.equal(f.advance().disposition,'applied');assert.equal(f.capture(),false);
  }finally{f.cleanup();}
});
function fixture(receipt=false){
  const root=fs.mkdtempSync('/tmp/opencode/step-engine-'),env=isolatedEnvironment(root);
  const targets={configRoot:path.join(env.XDG_CONFIG_HOME!,'opencode'),dataRoot:path.join(env.XDG_DATA_HOME!,'opencode'),storeRoot:path.join(root,'store'),confirmed:true};
  for(const file of [targets.configRoot,targets.dataRoot])fs.mkdirSync(file,{mode:0o700});
  lifecycle('install',targets,{...payload,version:'1.1.1'});
  if(receipt){
    const evidence=migrationEvidence(targets);createManagedBindingDirectory(env);
    writeMigration(env,{binding:{...evidence.binding,installId:'managed-synthetic'},legacyInstallId:evidence.binding.installId,phase:'pending'});
    lifecycle('remove-capture',targets);
  }
  const review=()=>{let session:ManagedInspectionSession|undefined;for(let i=0;i<6;i++)session=inspectManagedStep(env,payload,session).session;return session!;};
  const session=review(),budget=new PlatformRequestBudget();
  withPlatformRequestBudget(budget,()=>beginManagedStep(env,payload,{version:1,action:'begin',operationId:'11111111-1111-4111-8111-111111111111',confirmed:true,expected:session.review!.expected},budget,session));
  const journal=()=>readManagedStepJournal(env)!;
  const request=():Extract<ManagedStepRequest,{action:'advance'}>=>{const m=journal().migration;return {version:1,action:'advance',operationId:m.operationId,expectedSequence:m.sequence,step:m.step!};};
  const advance=(r=request())=>{const budget=new PlatformRequestBudget();return withPlatformRequestBudget(budget,()=>advanceManagedStep(env,payload,r,budget,journal()));};
  const control=(action:'pause'|'resume'|'abandon',review?:Extract<ManagedStepRequest,{action:'resume'}>['review'],session?:ManagedInspectionSession)=>{
    const current=journal(),budget=new PlatformRequestBudget();
    const request:Extract<ManagedStepRequest,{action:'pause'|'resume'|'abandon'}>={version:1,action,operationId:current.migration.operationId,expectedSequence:current.migration.sequence,...(review?{review}:{})};
    return withPlatformRequestBudget(budget,()=>controlManagedStep(env,payload,request,budget,current,session));
  };
  const until=(step:string)=>{while(journal().migration.step?.name!==step){const result=advance();assert.equal(result.disposition,'applied',JSON.stringify(result.error));}};
  const capture=(enabled?:boolean)=>{const store=new Store(journal().database);try{if(enabled!==undefined)store.setEnabled(enabled);return store.list().captureEnabled;}finally{store.close();}};
  return {root,env,targets,journal,review,request,advance,control,until,capture,cleanup(){fs.rmSync(root,{recursive:true,force:true});}};
}

for(const unreadable of [false,true])test(`receipt migration with ${unreadable?'an unreadable journal and ':''}a corrupt selector is not labelled fresh`,()=>{
  const f=fixture(true);try{
    assert.equal(fs.existsSync(path.join(f.targets.configRoot,'plugins','agent-progress')),false);
    const file=migrationFile(f.env);
    if(unreadable)fs.writeFileSync(file,'invalid json');
    fs.writeFileSync(managedBindingFile(f.env),'invalid selector',{mode:0o600});
    const journal=fs.readFileSync(file),selector=fs.readFileSync(managedBindingFile(f.env));
    const status=observeManagedSetup(f.env).status;
    assert.equal(status.delivery!.configuration,'invalid');assert.equal(status.delivery!.migration,'unavailable');
    assert.equal(status.delivery!.planKind,undefined);
    assert.equal(status.delivery!.freshProgress,undefined);
    assert.deepEqual(fs.readFileSync(file),journal);assert.deepEqual(fs.readFileSync(managedBindingFile(f.env)),selector);
  }finally{f.cleanup();}
});

test('a fresh record keeps its own family when the selector is corrupt',()=>{
  const f=freshFixture();try{
    f.begin();f.until('enable');fs.writeFileSync(managedBindingFile(f.env),'invalid selector');
    const status=observeManagedSetup(f.env).status;
    assert.equal(status.delivery!.configuration,'invalid');assert.equal(status.delivery!.planKind,'fresh');
    assert.equal(status.delivery!.freshProgress,undefined);
  }finally{f.cleanup();}
});

for(const receipt of [false,true])test(`${receipt?'receipt':'manifest'} engine completes one effect per request, retains identity/history and replays terminal completion`,()=>{
  const f=fixture(receipt);try{
    const initial=f.journal(),history=path.join(f.targets.storeRoot,'installation-history.jsonl'),before=fs.readFileSync(history);
    const steps:string[]=[];let last:ReturnType<typeof f.request>|undefined;
    while(f.journal().migration.state!=='complete'){
      const request=f.request(),prior=f.journal(),result=f.advance(request);last=request;
      assert.equal(result.disposition,'applied',JSON.stringify(result.error));assert.equal(result.error,null);
      const next=f.journal();steps.push(request.step.name);
      assert.equal(next.migration.sequence,prior.migration.sequence+1);assert.deepEqual(next.migration.lastCompleted,request.step);
      assert.deepEqual(next.migration.consent,initial.migration.consent);assert.equal(next.storeId,initial.storeId);assert.deepEqual(next.source,initial.source);
      const bytes=fs.readFileSync(migrationFile(f.env));assert.equal(f.advance(request).disposition,'replayed');assert.deepEqual(fs.readFileSync(migrationFile(f.env)),bytes);
      assert.equal(f.advance(request).progress.capture.state,'unknown');
    }
    assert.deepEqual(steps,initial.migration.plan.slice(1).map(s=>s.name));assert.equal(f.capture(),true);
    assert.equal(fs.existsSync(managedBindingFile(f.env)),true);assert.equal(fs.existsSync(managedExpectationFile(initial)),true);
    const after=fs.readFileSync(history);assert.deepEqual(after.subarray(0,before.length),before);
    assert.equal(after.subarray(before.length).toString().trim().split('\n').filter(Boolean).length,receipt?0:1);
    f.capture(false);assert.equal(f.advance(last!).disposition,'replayed');assert.equal(f.capture(),false);
    assert.throws(()=>f.control('resume'),{code:'managed-step-conflict'});
    assert.throws(()=>f.advance({...last!,expectedSequence:f.journal().migration.sequence}),{code:'managed-step-conflict'});
    assert.equal(f.journal().migration.format,2);assert.equal(f.journal().migration.phase,'complete');
  }finally{f.cleanup();}
});

test('controls are sequenced, effect-free and exactly replayable; stale/reordered requests refuse',()=>{
  const f=fixture();try{
    for(const stage of ['expectation','remove-discovery']){
      f.until(stage);const prior=f.journal(),capture=f.capture(),bytes=fs.readFileSync(prior.database);
      const paused=f.control('pause');assert.equal(paused.progress.state,'paused');assert.equal(paused.progress.sequence,prior.migration.sequence+1);
      assert.equal(f.capture(),capture);assert.deepEqual(fs.readFileSync(prior.database),bytes);
      assert.throws(()=>f.advance(),{code:'managed-step-conflict'});assert.throws(()=>f.control('pause'),{code:'managed-step-conflict'});
      const abandoned=f.control('abandon');assert.equal(abandoned.progress.state,'abandoned');
      assert.throws(()=>f.control('abandon'),{code:'managed-step-conflict'});assert.throws(()=>f.control('pause'),{code:'managed-step-conflict'});
      const resumed=f.control('resume');assert.equal(resumed.progress.state,'pending');assert.deepEqual(resumed.progress.step,prior.migration.step);
      assert.equal(f.capture(),capture);assert.deepEqual(fs.readFileSync(prior.database),bytes);
    }
    const request=f.request(),bytes=fs.readFileSync(migrationFile(f.env));
    for(const changed of [{...request,expectedSequence:request.expectedSequence-1},{...request,expectedSequence:request.expectedSequence+1},
      {...request,step:{name:'enable' as const,batch:0}},{...request,operationId:'22222222-2222-4222-8222-222222222222'}])assert.throws(()=>f.advance(changed));
    assert.deepEqual(fs.readFileSync(migrationFile(f.env)),bytes);
    const prior=f.journal(),control={version:1 as const,action:'pause' as const,operationId:request.operationId,expectedSequence:request.expectedSequence};
    f.control('pause');const budget=new PlatformRequestBudget();
    const replay=withPlatformRequestBudget(budget,()=>controlManagedStep(f.env,payload,control,budget,f.journal()));
    assert.equal(replay.disposition,'replayed');assert.equal(replay.progress.sequence,prior.migration.sequence+1);
  }finally{f.cleanup();}
});

for(const step of ['disable','enable'] as const)for(const after of [false,true])test(`${step} interruption ${after?'after':'before'} capture requires evidence or single-use re-consent`,t=>{
  const f=fixture();try{
    f.until(step);const request=f.request(),set=Store.prototype.setEnabled;let effects=0;
    const mock=t.mock.method(Store.prototype,'setEnabled',function(this:Store,enabled:boolean){if(after){set.call(this,enabled);effects++;}throw new Error('synthetic interruption');});
    let failed:ReturnType<typeof f.advance>;
    try{failed=f.advance();}finally{mock.mock.restore();}
    assert.equal(failed.disposition,'refused');assert.equal(f.journal().migration.state,'failed');
    assert.equal(f.advance(request).disposition,'replayed','failed settlement is replayed without executing the effect');
    if(after){
      f.control('resume');assert.equal(f.advance().disposition,'applied');assert.equal(effects,1);
    }else{
      const intent=structuredClone(f.journal().migration.intent),consent=structuredClone(f.journal().migration.consent);
      assert.throws(()=>f.control('resume'),{code:'managed-step-unsettled'});
      const session=f.review();
      assert.throws(()=>f.control('resume',{confirmed:true,step,expected:'f'.repeat(64)},session),{code:'managed-review-stale'});
      const reviewedRequest={version:1 as const,action:'resume' as const,operationId:request.operationId,expectedSequence:f.journal().migration.sequence,
        review:{confirmed:true as const,step,expected:session.review!.expected}};
      f.control('resume',reviewedRequest.review,session);
      assert.deepEqual(f.journal().migration.intent,intent);assert.deepEqual(f.journal().migration.consent,consent);assert.equal(f.journal().migration.captureRenewals.length,1);
      const budget=new PlatformRequestBudget();
      assert.equal(withPlatformRequestBudget(budget,()=>controlManagedStep(f.env,payload,reviewedRequest,budget,f.journal())).disposition,'replayed','lost reviewed-resume reply needs no live token');
      f.control('pause');f.control('resume'); // Controls retain but cannot multiply this permission.
      const renewed=f.request();assert.equal(f.advance().disposition,'applied');assert.equal(f.journal().migration.captureRenewals.length,1);
      f.capture(step!=='enable');assert.equal(f.advance(renewed).disposition,'replayed');assert.equal(f.capture(),step!=='enable');
    }
  }finally{f.cleanup();}
});

for(const boundary of ['intent','completion'] as const)for(const after of [false,true])test(`every step survives ${boundary} journal interruption ${after?'after':'before'} publication`,t=>{
  const f=fixture();try{
    while(f.journal().migration.state!=='complete'){
      const request=f.request(),journalFile=migrationFile(f.env),rename=fs.renameSync;let tripped=false;
      const mock=t.mock.method(fs,'renameSync',((from:any,to:any)=>{
        if(String(to)===journalFile&&!tripped){
          const next=JSON.parse(fs.readFileSync(from,'utf8'));
          if(boundary==='intent'?next.migration.state==='running':next.migration.lastCompleted?.name===request.step.name&&next.migration.lastCompleted.batch===request.step.batch){
            tripped=true;if(after)rename(from,to);throw new Error('synthetic interruption');
          }
        }
        return rename(from,to);
      }) as typeof fs.renameSync);syncBuiltinESMExports();
      try{assert.equal(f.advance(request).disposition,'refused');}finally{mock.mock.restore();syncBuiltinESMExports();}
      assert.equal(tripped,true);
      const current=f.journal();
      if(current.migration.lastCompleted?.name===request.step.name&&current.migration.lastCompleted.batch===request.step.batch){
        assert.equal(f.advance(request).disposition,'replayed');continue;
      }
      if(current.migration.intent){
        const captureStep=['enable','disable'].includes(request.step.name),ambiguous=captureStep&&f.capture()!==(request.step.name==='enable');
        if(ambiguous){const review=f.review();f.control('resume',{confirmed:true,step:request.step.name as 'enable'|'disable',expected:review.review!.expected},review);}
        else f.control('resume');
      }
      const recovered=f.advance();assert.equal(recovered.disposition,'applied',JSON.stringify(recovered.error));
    }
    assert.equal(f.capture(),true);
    const events=fs.readFileSync(path.join(f.targets.storeRoot,'installation-history.jsonl'),'utf8').trim().split('\n').map(line=>JSON.parse(line));
    assert.equal(events.filter(e=>e.operationId===f.journal().migration.operationId).length,1);
  }finally{f.cleanup();}
});

test('fresh target changes refuse before effect admission and complete removal requires retained history',()=>{
  for(const damage of ['payload','expectation','history','selector','legacy'] as const){
    const f=fixture();try{
      if(damage==='history'||damage==='selector')f.until('enable');else f.until('disable');
      const journal=f.journal(),bytes=fs.readFileSync(migrationFile(f.env));
      if(damage==='expectation')fs.appendFileSync(managedExpectationFile(journal),'invalid');
      if(damage==='selector')fs.appendFileSync(managedBindingFile(f.env),'invalid');
      if(damage==='legacy')fs.appendFileSync(path.join(f.targets.configRoot,'plugins/agent-progress/index.js'),'changed');
      if(damage==='history'){
        const file=path.join(f.targets.storeRoot,'installation-history.jsonl');
        fs.writeFileSync(file,fs.readFileSync(file,'utf8').split('\n').filter(line=>!line.includes(journal.migration.operationId)).join('\n'));
      }
      const budget=new PlatformRequestBudget();
      assert.throws(()=>withPlatformRequestBudget(budget,()=>advanceManagedStep(f.env,damage==='payload'?{...payload,plugin:'changed'}:payload,f.request(),budget,journal)));
      assert.deepEqual(fs.readFileSync(migrationFile(f.env)),bytes);
    }finally{f.cleanup();}
  }
});

test('a second ambiguous capture interruption cannot reuse a consumed renewal',t=>{
  const f=fixture();try{
    f.until('enable');
    const interrupt=()=>{
      const mock=t.mock.method(Store.prototype,'setEnabled',()=>{throw new Error('synthetic interruption');});
      try{assert.equal(f.advance().disposition,'refused');}finally{mock.mock.restore();}
    };
    interrupt();const firstIntent=structuredClone(f.journal().migration.intent);
    const review=f.review();f.control('resume',{confirmed:true,step:'enable',expected:review.review!.expected},review);
    const old=f.request();interrupt();
    const consumed=f.journal();assert.ok(consumed.migration.intent!.captureReviewSequence);
    assert.deepEqual(consumed.migration.captureRenewals[0]!.priorIntent,firstIntent);
    const bytes=fs.readFileSync(migrationFile(f.env));
    assert.throws(()=>f.control('resume'),{code:'managed-step-unsettled'});
    assert.throws(()=>f.control('resume',{confirmed:true,step:'enable',expected:review.review!.expected},review),{code:'managed-review-stale'});
    assert.deepEqual(fs.readFileSync(migrationFile(f.env)),bytes);
    const fresh=f.review();f.control('resume',{confirmed:true,step:'enable',expected:fresh.review!.expected},fresh);
    assert.equal(f.journal().migration.captureRenewals.length,2);
    assert.throws(()=>f.advance(old),{code:'managed-step-conflict'},'old advance cannot consume fresh consent');
    assert.equal(f.advance().disposition,'applied');assert.equal(f.capture(),true);
    assert.equal(f.journal().migration.captureRenewals.length,2);
  }finally{f.cleanup();}
});

for(const action of ['pause','abandon','resume'] as const)test(`fenced running intent supports ${action} without capture or removal`,t=>{
  const f=fixture();try{
    // Leave a durable running expectation intent, simulating process loss after
    // publication. Expire the deadline so this request cannot settle a failure.
    const prior=f.journal(),started=process.hrtime.bigint(),budget=new PlatformRequestBudget(started),rename=fs.renameSync,file=migrationFile(f.env);
    let expired=false;
    const clock=t.mock.method(process.hrtime,'bigint',()=>expired?started+18_000_000_000n:started);
    const mock=t.mock.method(fs,'renameSync',((from:any,to:any)=>{
      rename(from,to);if(String(to)===file){expired=true;throw new Error('synthetic interruption');}
    }) as typeof fs.renameSync);syncBuiltinESMExports();
    try{assert.equal(withPlatformRequestBudget(budget,()=>advanceManagedStep(f.env,payload,f.request(),budget,prior)).disposition,'refused');}
    finally{mock.mock.restore();clock.mock.restore();syncBuiltinESMExports();}
    const running=f.journal();assert.equal(running.migration.state,'running');
    const database=fs.readFileSync(running.database),history=fs.readFileSync(path.join(f.targets.storeRoot,'installation-history.jsonl'));
    const reply=f.control(action),next=f.journal();
    assert.equal(reply.disposition,'applied');assert.equal(next.migration.state,action==='resume'?'pending':action==='pause'?'paused':'abandoned');
    assert.equal(next.migration.sequence,running.migration.sequence+1);assert.deepEqual(next.migration.intent,running.migration.intent);
    assert.equal(reply.progress.worker,'unsettled');assert.equal(reply.progress.effect,'uncertain');
    assert.deepEqual(fs.readFileSync(running.database),database);assert.deepEqual(fs.readFileSync(path.join(f.targets.storeRoot,'installation-history.jsonl')),history);
    assert.equal(fs.existsSync(managedExpectationFile(running)),false);
  }finally{f.cleanup();}
});

test('advance refuses an exhausted deadline before intent and any effect',()=>{
  const f=fixture();try{
    // An already expired budget, used directly: the engine's own check before the
    // intent is published refuses, ahead of any intent or effect.
    const budget=new PlatformRequestBudget(process.hrtime.bigint()-18_000_000_000n),before=fs.readFileSync(migrationFile(f.env));
    const reply=advanceManagedStep(f.env,payload,f.request(),budget,f.journal());
    assert.equal(reply.disposition,'refused');assert.equal(reply.error!.code,'managed-step-deadline');
    assert.deepEqual(fs.readFileSync(migrationFile(f.env)),before);assert.equal(fs.existsSync(managedExpectationFile(f.journal())),false);
  }finally{f.cleanup();}
});
test('advance refuses inside the headroom before intent and any effect',()=>{
  const f=fixture();try{
    // A budget with only one second left, used directly: the engine's own check before the
    // intent is published refuses, ahead of any intent or effect.
    const budget=new PlatformRequestBudget(process.hrtime.bigint()-16_000_000_000n),before=fs.readFileSync(migrationFile(f.env));
    const reply=advanceManagedStep(f.env,payload,f.request(),budget,f.journal());
    assert.equal(reply.disposition,'refused');assert.equal(reply.error!.code,'managed-step-deadline');
    assert.deepEqual(fs.readFileSync(migrationFile(f.env)),before);assert.equal(fs.existsSync(managedExpectationFile(f.journal())),false);
  }finally{f.cleanup();}
});

test('failed settlement surfaces a journal conflict instead of swallowing it as the effect error',t=>{
  const f=fixture();try{
    f.until('disable');const rename=fs.renameSync,file=migrationFile(f.env);
    const capture=t.mock.method(Store.prototype,'setEnabled',()=>{throw new Error('synthetic effect failure');});
    const checkpoint=t.mock.method(fs,'renameSync',((from:any,to:any)=>{
      if(String(to)===file&&JSON.parse(fs.readFileSync(from,'utf8')).migration.state==='failed')throw new SetupError('managed-step-conflict');
      return rename(from,to);
    }) as typeof fs.renameSync);syncBuiltinESMExports();
    try{const reply=f.advance();assert.equal(reply.disposition,'refused');assert.equal(reply.error!.code,'managed-step-conflict');assert.equal(reply.progress.worker,'unsettled');}
    finally{capture.mock.restore();checkpoint.mock.restore();syncBuiltinESMExports();}
    assert.equal(f.journal().migration.state,'running');assert.equal(f.capture(),true);
  }finally{f.cleanup();}
});

test('every integrated effect and control starts no process on the Windows path',{skip:process.platform==='win32'},async t=>{
  const f=fixture(),originalSystemRoot=process.env.SystemRoot;
  try{
    const source=path.join(f.root,'source');for(const dir of ['shared','setup'])fs.cpSync(path.resolve(dir),path.join(source,dir),{recursive:true});
    const file=path.join(source,'shared/platform.ts');let text=fs.readFileSync(file,'utf8');
    text=text.replace("export const windows = process.platform === 'win32';",'export const windows = true;');
    const start=text.indexOf("  if (value.includes('\\0')",text.indexOf('function windowsPathsInner(')),end=text.indexOf('  let current = clean;',start);
    assert.ok(start>0&&end>start);text=text.slice(0,start)+"  if (!path.isAbsolute(value) || path.resolve(value) !== value) throw new PlatformError('path-unverified');\n  const clean = value;\n"+text.slice(end);fs.writeFileSync(file,text);
    let spawns=0;
    const mock=t.mock.method(cp,'spawnSync',(()=>{spawns++;throw new Error('no permission check may start a process');}) as unknown as typeof cp.spawnSync);syncBuiltinESMExports();process.env.SystemRoot='C:\\Windows';
    try{
      const platform=await import(pathToFileURL(file).href) as typeof import('../../shared/platform.ts');
      const engine=await import(pathToFileURL(path.join(source,'setup/managed-step-engine.ts')).href) as typeof import('../../setup/managed-step-engine.ts');
      for(const action of ['pause','abandon','resume'] as const){
        const prior=f.journal(),budget=new platform.PlatformRequestBudget();
        const request={version:1 as const,action,operationId:prior.migration.operationId,expectedSequence:prior.migration.sequence};
        const reply=platform.withPlatformRequestBudget(budget,()=>engine.controlManagedStep(f.env,payload,request,budget,prior));
        assert.equal(reply.disposition,'applied');assert.equal(spawns,0);
      }
      while(f.journal().migration.state!=='complete'){
        const prior=f.journal(),request=f.request(),budget=new platform.PlatformRequestBudget();
        const reply=platform.withPlatformRequestBudget(budget,()=>engine.advanceManagedStep(f.env,payload,request,budget,prior));
        assert.equal(reply.disposition,'applied',`${request.step.name}: ${JSON.stringify(reply.error)}`);assert.equal(spawns,0);
        const replayBudget=new platform.PlatformRequestBudget();
        assert.equal(platform.withPlatformRequestBudget(replayBudget,()=>engine.advanceManagedStep(f.env,payload,request,replayBudget,reply.journal)).disposition,'replayed');
        assert.equal(spawns,0);
      }
    }finally{mock.mock.restore();syncBuiltinESMExports();}
  }finally{if(originalSystemRoot===undefined)delete process.env.SystemRoot;else process.env.SystemRoot=originalSystemRoot;f.cleanup();}
});

test('full fresh engine starts no process for creation, settlement, replay or control on the Windows path',{skip:process.platform==='win32'},async t=>{
  const sourceRoot=fs.mkdtempSync('/tmp/opencode/fresh-engine-counts-'),systemRoot=process.env.SystemRoot;
  // The projected Windows path creates ordinary directories; a restrictive umask
  // keeps the POSIX-side fixture readers satisfied.
  const umask=process.umask(0o077);
  try{
    const source=path.join(sourceRoot,'source');for(const dir of ['shared','setup'])fs.cpSync(path.resolve(dir),path.join(source,dir),{recursive:true});
    const file=path.join(source,'shared/platform.ts');let text=fs.readFileSync(file,'utf8');
    text=text.replace("export const windows = process.platform === 'win32';",'export const windows = true;');
    const start=text.indexOf("  if (value.includes('\\0')",text.indexOf('function windowsPathsInner(')),end=text.indexOf('  let current = clean;',start);
    assert.ok(start>0&&end>start);text=text.slice(0,start)+"  if (!path.isAbsolute(value) || path.resolve(value) !== value) throw new PlatformError('path-unverified');\n  const clean = value;\n"+text.slice(end);fs.writeFileSync(file,text);
    let spawns=0;
    const mock=t.mock.method(cp,'spawnSync',(()=>{spawns++;throw new Error('no permission check may start a process');}) as unknown as typeof cp.spawnSync);syncBuiltinESMExports();process.env.SystemRoot='C:\\Windows';
    try{
      const platform=await import(pathToFileURL(file).href) as typeof import('../../shared/platform.ts');
      const engine=await import(pathToFileURL(path.join(source,'setup/managed-step-engine.ts')).href) as typeof import('../../setup/managed-step-engine.ts');
      const run=<T>(name:string,fn:(budget:InstanceType<typeof platform.PlatformRequestBudget>)=>T)=>{
        const budget=new platform.PlatformRequestBudget();try{return platform.withPlatformRequestBudget(budget,()=>fn(budget));}
        finally{assert.equal(spawns,0,name);}
      };
      const begin=(f:ReturnType<typeof freshFixture>)=>{const session=f.review();return run('prepare',b=>engine.beginManagedStep(f.env,payload,{version:2,action:'begin',operationId:'11111111-1111-4111-8111-111111111111',confirmed:true,expected:session.review!.expected},b,session));};
      const advance=(f:ReturnType<typeof freshFixture>)=>run(f.request().step.name,b=>engine.advanceManagedStep(f.env,payload,f.request(),b,f.journal()));
      for(const kind of ['absent','directory','new-source','reuse'] as const){const f=freshFixture(kind,true);try{
        begin(f);
        while(f.journal().migration.state!=='complete'){
          const request=f.request();assert.equal(advance(f).disposition,'applied',request.step.name);
          assert.equal(run('replay',b=>engine.advanceManagedStep(f.env,payload,request,b,f.journal())).disposition,'replayed');
          if(f.journal().migration.state!=='complete')for(const action of ['pause','abandon','resume'] as const){
            const j=f.journal();assert.equal(run(action,b=>engine.controlManagedStep(f.env,payload,{version:2,action,operationId:j.migration.operationId,expectedSequence:j.migration.sequence},b,j)).disposition,'applied');
          }
        }
      }finally{f.cleanup();}}
    }finally{mock.mock.restore();syncBuiltinESMExports();}
  }finally{process.umask(umask);if(systemRoot===undefined)delete process.env.SystemRoot;else process.env.SystemRoot=systemRoot;fs.rmSync(sourceRoot,{recursive:true,force:true});}
});
