import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {pathToFileURL} from 'node:url';
import {isolatedEnvironment} from '../fixtures/managed.ts';
import {lifecycle,migrationEvidence} from '../../setup/lifecycle.ts';
import {createManagedBindingDirectory,publishPrivateJson} from '../../shared/managed-binding.ts';
import {writeMigration,migrationFile} from '../../setup/managed-migration.ts';
import {parseManagedStepJournal} from '../../setup/managed-step-journal.ts';
import {inspectManagedStep,validateManagedInspectionReview,type ManagedInspectionSession,inspectManagedFreshStep,
  validateManagedFreshInspectionReview,type ManagedFreshInspectionSession} from '../../setup/managed-inspection.ts';
import {Store} from '../../shared/store.ts';
import {writeManagedStepJournal,readManagedFreshStepJournal,readManagedStepJournal} from '../../setup/managed-migration.ts';
import {managedRequestDigest,parseManagedFreshStepJournal} from '../../setup/managed-step-journal.ts';

const payload={plugin:'// synthetic managed',guidance:'synthetic guidance',removal:'// synthetic removal',version:'1.3.0'};
function fixture(kind:'manifest'|'upgrade'|'receipt'='manifest'){
  const root=fs.mkdtempSync('/tmp/opencode/step-inspection-'),env=isolatedEnvironment(root);
  const targets={configRoot:path.join(env.XDG_CONFIG_HOME!,'opencode'),dataRoot:path.join(env.XDG_DATA_HOME!,'opencode'),storeRoot:path.join(root,'store'),confirmed:true};
  for(const file of [targets.configRoot,targets.dataRoot])fs.mkdirSync(file,{mode:0o700});
  lifecycle('install',targets,{...payload,version:'1.1.1'});
  const evidence=migrationEvidence(targets);
  if(kind!=='manifest'){
    createManagedBindingDirectory(env);
    writeMigration(env,{binding:{...evidence.binding,installId:'managed-synthetic'},legacyInstallId:evidence.binding.installId,phase:'pending'});
    if(kind==='receipt')lifecycle('remove-capture',targets);
  }
  return {root,env,targets,evidence,cleanup(){fs.rmSync(root,{recursive:true,force:true});}};
}
function files(root:string):Record<string,string>{
  const result:Record<string,string>={};
  const visit=(file:string)=>{const s=fs.lstatSync(file);if(s.isDirectory())for(const name of fs.readdirSync(file))visit(path.join(file,name));else result[path.relative(root,file)]=fs.readFileSync(file).toString('hex');};
  visit(root);return result;
}
function inspectAll(f:{env:NodeJS.ProcessEnv},inspect=inspectManagedStep){
  let session:ManagedInspectionSession|undefined;
  for(const stage of ['roots','managed-state','legacy-discovery','legacy-releases','store','review']){
    const result=inspect(f.env,payload,session);session=result.session;
    assert.equal(result.inspection.stage,stage);
    assert.equal(result.inspection.state,stage==='review'?'complete':'incomplete');
  }
  return session!;
}
for(const kind of ['manifest','upgrade','receipt'] as const)test(`bounded ${kind} inspection is read-only and binds a freshly revalidated review`,()=>{
  const f=fixture(kind);try{
    const before=files(f.root),session=inspectAll(f);
    assert.deepEqual(files(f.root),before,'inspection must not create metadata, change capture or initialize a database');
    const checked=validateManagedInspectionReview(f.env,payload,session);
    assert.equal(checked.review.expected,session.review!.expected);
    assert.equal(checked.candidate.migration.legacy.kind,kind==='receipt'?'removal-receipt':'manifest');
    assert.deepEqual(files(f.root),before);
    assert.throws(()=>inspectManagedStep(f.env,payload,session),{code:'managed-inspection-expired'});
    assert.throws(()=>validateManagedInspectionReview(f.env,{...payload,plugin:'// changed package'},session),{code:'managed-review-stale'});
    const store=new Store(f.evidence.binding.database);try{store.setEnabled(checked.capture.state!=='on');}finally{store.close();}
    assert.throws(()=>validateManagedInspectionReview(f.env,payload,session),{code:'managed-review-stale'});
  }finally{f.cleanup();}
});

function freshFixture(){
  const root=fs.mkdtempSync('/tmp/opencode/fresh-inspection-'),env=isolatedEnvironment(root);
  const roots={configRoot:path.join(env.XDG_CONFIG_HOME!,'opencode'),dataRoot:path.join(env.XDG_DATA_HOME!,'opencode')};
  for(const p of Object.values(roots))fs.mkdirSync(p,{mode:0o700});
  return {root,env,roots,storeRoot:path.join(root,'custom store'),cleanup(){fs.rmSync(root,{recursive:true,force:true});}};
}
function inspectFresh(f:{env:NodeJS.ProcessEnv},storeRoot?:string,inspect=inspectManagedFreshStep){
  let session:ManagedFreshInspectionSession|undefined;
  for(const stage of ['roots','managed-state','legacy-discovery','store','review']){
    const r=inspect(f.env,payload,session,session?undefined:storeRoot);session=r.session;
    assert.equal(r.inspection.stage,stage);assert.equal(r.inspection.state,stage==='review'?'complete':'incomplete');
  }
  return session!;
}
for(const kind of ['default','custom','existing-directory','retained-new','retained-reuse'] as const)test(`fresh ${kind} inspection creates nothing and freezes proposed/retained identity`,()=>{
  const f=freshFixture();try{
    const selected=kind==='default'?path.join(f.roots.dataRoot,'openchamber-progress'):f.storeRoot;
    let storeId:string|undefined;
    if(kind!=='default'&&kind!=='custom')fs.mkdirSync(selected,{mode:0o700});
    if(kind.startsWith('retained')){
      const store=new Store(path.join(selected,'progress.sqlite'),{create:true});try{
        store.setEnabled(false);if(kind==='retained-reuse')store.registerSource({id:'retained-source',...f.roots,verified:true});
        // A retained DB larger than the journal limit remains inspectable: no full-file hash.
        store.db.exec('CREATE TABLE retained_history(value BLOB); INSERT INTO retained_history VALUES(zeroblob(1100000))');storeId=store.list().storeId;
      }finally{store.close();}
    }
    const before=files(f.root),session=inspectFresh(f,kind==='default'?undefined:selected),j=session.candidate!,r=session.review!;
    assert.deepEqual(files(f.root),before);assert.equal(r.planKind,'fresh');
    assert.equal(r.storeMode,kind.startsWith('retained')?'retain':'create');assert.equal(r.sourceMode,kind==='retained-reuse'?'reuse':'create');
    assert.equal(r.capturePolicy,kind.startsWith('retained')?'preserve':'enable-new');
    if(storeId)assert.equal(r.storeId,storeId);if(kind==='retained-reuse')assert.equal(r.sourceId,'retained-source');
    const checked=validateManagedFreshInspectionReview(f.env,payload,session);assert.deepEqual(checked.candidate,j);
    assert.equal(checked.review.expected,r.expected);assert.deepEqual(files(f.root),before);
    assert.throws(()=>validateManagedFreshInspectionReview(f.env,{...payload,plugin:'changed'},session),{code:'managed-review-stale'});
    if(kind==='custom'){
      fs.mkdirSync(selected,{mode:0o700});const changed=files(f.root);
      assert.throws(()=>validateManagedFreshInspectionReview(f.env,payload,session),{code:'managed-migration-conflict'});assert.deepEqual(files(f.root),changed);
    }
  }finally{f.cleanup();}
});
test('fresh publication is observable before storage exists and both older journal families refuse it',()=>{
  const f=freshFixture();try{
    const session=inspectFresh(f,f.storeRoot),journal=structuredClone(session.candidate!),m=journal.migration;
    m.consent.reviewDigest=session.review!.expected;
    const begin={version:2,action:'begin',operationId:m.operationId,confirmed:true,expected:m.consent.reviewDigest} as const;
    m.receipt={requestDigest:managedRequestDigest(begin,journal),expectedSequence:0,sequence:1,step:m.lastCompleted,outcome:'applied'};
    parseManagedFreshStepJournal(JSON.stringify(journal));createManagedBindingDirectory(f.env);
    writeManagedStepJournal(f.env,journal,undefined,()=>{validateManagedFreshInspectionReview(f.env,payload,session);});
    const before=files(f.root);assert.equal(fs.existsSync(f.storeRoot),false);assert.deepEqual(readManagedFreshStepJournal(f.env),journal);
    assert.throws(()=>readManagedStepJournal(f.env),{code:'managed-journal-unsupported'});
    const reopened=inspectFresh(f);assert.equal(reopened.operation!.migration.operationId,m.operationId);
    assert.equal(reopened.storeRoot,f.storeRoot);assert.deepEqual(files(f.root),before);
    fs.unlinkSync(migrationFile(f.env));writeManagedStepJournal(f.env,journal);assert.deepEqual(readManagedFreshStepJournal(f.env),journal);
    fs.unlinkSync(path.join(path.dirname(migrationFile(f.env)),'.ownership.json'));
    const refused=files(f.root);assert.throws(()=>readManagedFreshStepJournal(f.env),{code:'managed-binding-invalid'});assert.deepEqual(files(f.root),refused);
  }finally{f.cleanup();}
});
for(const damage of ['sidecar','unmarked','legacy','unverified-source','unknown-journal','foreign-file','capture-change'] as const)test(`fresh review refuses ${damage} without repair or adoption`,()=>{
  const f=freshFixture();try{
    if(damage==='capture-change'||damage==='unverified-source'){
      fs.mkdirSync(f.storeRoot,{mode:0o700});const store=new Store(path.join(f.storeRoot,'progress.sqlite'),{create:true});
      try{if(damage==='unverified-source')store.registerSource({id:'unverified',...f.roots,verified:false});}finally{store.close();}
    }
    if(damage==='sidecar'){fs.mkdirSync(f.storeRoot,{mode:0o700});fs.writeFileSync(path.join(f.storeRoot,'progress.sqlite-wal'),'retained',{mode:0o600});}
    if(damage==='unmarked')fs.mkdirSync(path.join(f.roots.dataRoot,'agent-progress-managed'),{mode:0o700});
    if(damage==='legacy')fs.mkdirSync(path.join(f.roots.configRoot,'plugins','agent-progress'),{recursive:true,mode:0o700});
    if(damage==='unknown-journal'){createManagedBindingDirectory(f.env);publishPrivateJson(migrationFile(f.env),{migration:{format:99}});}
    if(damage==='foreign-file'){fs.mkdirSync(f.storeRoot,{mode:0o700});fs.writeFileSync(path.join(f.storeRoot,'retained'),'retained',{mode:0o600});}
    if(damage==='capture-change'){
      const session=inspectFresh(f,f.storeRoot),store=new Store(path.join(f.storeRoot,'progress.sqlite'));try{store.setEnabled(false);}finally{store.close();}
      const before=files(f.root);assert.throws(()=>validateManagedFreshInspectionReview(f.env,payload,session),{code:'managed-review-stale'});assert.deepEqual(files(f.root),before);
    }else{
      const before=files(f.root);assert.throws(()=>inspectFresh(f,f.storeRoot));assert.deepEqual(files(f.root),before);
    }
  }finally{f.cleanup();}
});

for(const damage of ['manifest','payload','selector','foreign','alias','permissions','identity','source','lock','receipt'] as const)test(`inspection refuses changed ${damage} before confirmation`,()=>{
  const f=fixture(damage==='receipt'?'receipt':'upgrade');try{
    let session:ManagedInspectionSession|undefined;
    for(let i=0;i<3;i++)session=inspectManagedStep(f.env,payload,session).session;
    const legacy=path.join(f.targets.configRoot,'plugins','agent-progress');
    if(damage==='manifest'){
      const file=path.join(legacy,'.ownership.json'),m=JSON.parse(fs.readFileSync(file,'utf8'));m.releases['f'.repeat(64)]=m.releases[m.active];fs.writeFileSync(file,JSON.stringify(m));
    }
    if(damage==='payload')fs.appendFileSync(path.join(f.targets.storeRoot,'payloads',JSON.parse(f.evidence.legacy.ownership).active,'index.js'),'changed');
    if(damage==='selector')fs.appendFileSync(path.join(legacy,'index.js'),'changed');
    if(damage==='foreign')fs.writeFileSync(path.join(legacy,'foreign'),'foreign',{mode:0o600});
    if(damage==='alias')fs.linkSync(path.join(legacy,'index.js'),path.join(f.root,'alias'));
    if(damage==='permissions')fs.chmodSync(path.join(legacy,'index.js'),0o644);
    if(damage==='identity'){
      // Swap after discovery does not grant ownership; full review then binds
      // the freshly observed object, and mutation admission rejects another swap.
      session=inspectManagedStep(f.env,payload,session).session;
      const file=path.join(legacy,'index.js');fs.renameSync(file,`${file}.retained`);fs.copyFileSync(`${file}.retained`,file);fs.unlinkSync(`${file}.retained`);
    }
    if(damage==='source'){
      const store=new Store(f.evidence.binding.database);try{store.db.prepare('UPDATE sources SET verified=0').run();}finally{store.close();}
    }
    if(damage==='lock')fs.writeFileSync(path.join(f.targets.dataRoot,'agent-progress-managed','.configuration-lock'),'retained',{mode:0o600});
    if(damage==='receipt')fs.writeFileSync(path.join(f.targets.storeRoot,'installation-history.jsonl'),'{}\n');
    const before=files(f.root);
    assert.throws(()=>{while(session!.stage<6)session=inspectManagedStep(f.env,payload,session).session;});
    assert.deepEqual(files(f.root),before);
  }finally{f.cleanup();}
});

test('changed roots and a different requested Store cannot continue discovery',()=>{
  const f=fixture();try{
    const session=inspectManagedStep(f.env,payload).session;
    assert.throws(()=>inspectManagedStep({...f.env,XDG_DATA_HOME:path.join(f.root,'other')},payload,session));
    let other=inspectManagedStep(f.env,payload,undefined,path.join(f.root,'different-store')).session;
    other=inspectManagedStep(f.env,payload,other).session;
    assert.throws(()=>inspectManagedStep(f.env,payload,other),{code:'managed-selection-conflict'});
  }finally{f.cleanup();}
});

for(const decision of ['disable','enable'] as const)test(`uncertain ${decision} inspection binds the operation, sequence, full intent and capture decision`,()=>{
  const f=fixture();try{
    const candidate=inspectAll(f).candidate!,m=candidate.migration;
    if(decision==='enable')lifecycle('remove-capture',f.targets);
    const index=m.plan.findIndex(s=>s.name===decision);
    m.state='running';m.sequence=index;m.step=m.plan[index]!;m.lastCompleted=m.plan[index-1]!;
    m.phase=decision==='enable'?'removed':'pending';m.receipt=null;
    m.intent={requestDigest:'a'.repeat(64),expectedSequence:index,step:m.step,effect:'uncertain',before:[],after:[],
      captureBefore:{state:'unknown',observedAt:null},captureReviewSequence:null};
    createManagedBindingDirectory(f.env);publishPrivateJson(migrationFile(f.env),candidate);
    parseManagedStepJournal(JSON.stringify(candidate));
    const before=files(f.root),session=inspectAll(f),review=validateManagedInspectionReview(f.env,payload,session);
    assert.equal(review.operation!.migration.intent!.step.name,decision);
    assert.equal(review.operation!.migration.sequence,index);
    assert.deepEqual(files(f.root),before);
    for(const change of ['operation','sequence','intent'] as const){
      const fresh=inspectAll(f);
      const altered=structuredClone(candidate);
      if(change==='operation')altered.migration.operationId='11111111-1111-4111-8111-111111111111';
      if(change==='sequence')altered.migration.sequence++;
      if(change==='intent')altered.migration.intent!.requestDigest='b'.repeat(64);
      publishPrivateJson(migrationFile(f.env),altered,true);
      assert.throws(()=>validateManagedInspectionReview(f.env,payload,fresh),{code:'managed-review-stale'});
      assert.notEqual(inspectAll(f).review!.expected,fresh.review!.expected);
      publishPrivateJson(migrationFile(f.env),candidate,true);
      // Atomic replacement intentionally changes the journal object. Obtain a
      // new review for each operation snapshot instead of adopting the old one.
    }
  }finally{f.cleanup();}
});

test('oversized discovered sets and history refuse without a truncated review',()=>{
  for(const kind of ['manifest','receipt'] as const){
    const f=fixture(kind);try{
      if(kind==='manifest'){
        const file=path.join(f.targets.configRoot,'plugins','agent-progress','.ownership.json'),m=JSON.parse(fs.readFileSync(file,'utf8'));
        for(let i=0;i<70;i++)m.releases[i.toString(16).padStart(64,'0')]=m.releases[m.active];
        fs.writeFileSync(file,JSON.stringify(m));
      }else fs.appendFileSync(path.join(f.targets.storeRoot,'installation-history.jsonl'),' '.repeat(1_048_576));
      const before=files(f.root);
      assert.throws(()=>inspectAll(f),{code:'managed-step-limit'});assert.deepEqual(files(f.root),before);
    }finally{f.cleanup();}
  }
});

test('each inspection stage and review revalidation start no process on the Windows path',{skip:process.platform==='win32'},async t=>{
  const original=process.env.SystemRoot;
  try{for(const kind of ['manifest','upgrade','receipt','fresh','fresh-retained'] as const){
    const fresh=kind==='fresh'||kind==='fresh-retained',f=fresh?freshFixture():fixture(kind);try{
      const freshRoot=path.join(f.root,'custom store');
      if(kind==='fresh-retained'){
        fs.mkdirSync(freshRoot,{mode:0o700});const retained=new Store(path.join(freshRoot,'progress.sqlite'),{create:true});
        try{retained.setEnabled(false);}finally{retained.close();}
      }
      const source=path.join(f.root,'source');for(const dir of ['shared','setup'])fs.cpSync(path.resolve(dir),path.join(source,dir),{recursive:true});
      const platformFile=path.join(source,'shared/platform.ts');let text=fs.readFileSync(platformFile,'utf8');
      text=text.replace("export const windows = process.platform === 'win32';",'export const windows = true;');
      const start=text.indexOf("  if (value.includes('\\0')",text.indexOf('function windowsPathsInner(')),end=text.indexOf('  let current = clean;',start);
      assert.ok(start>0&&end>start);text=text.slice(0,start)+"  if (!path.isAbsolute(value) || path.resolve(value) !== value) throw new PlatformError('path-unverified');\n  const clean = value;\n"+text.slice(end);fs.writeFileSync(platformFile,text);
      let spawns=0;
      const mock=t.mock.method(cp,'spawnSync',(()=>{spawns++;throw new Error('no permission check may start a process');}) as unknown as typeof cp.spawnSync);syncBuiltinESMExports();process.env.SystemRoot='C:\\Windows';
      try{
        const platform=await import(pathToFileURL(platformFile).href) as typeof import('../../shared/platform.ts');
        const inspection=await import(pathToFileURL(path.join(source,'setup/managed-inspection.ts')).href) as typeof import('../../setup/managed-inspection.ts');
        const run=<T>(call:()=>T)=>{
          const budget=new platform.PlatformRequestBudget();
          const result=platform.withPlatformRequestBudget(budget,call);
          assert.equal(spawns,0);return result;
        };
        const session=fresh?inspectFresh(f,freshRoot,(...args)=>run(()=>inspection.inspectManagedFreshStep(...args))):
          inspectAll(f,(...args)=>run(()=>inspection.inspectManagedStep(...args)));
        const budget=new platform.PlatformRequestBudget();
        platform.withPlatformRequestBudget(budget,()=>fresh?inspection.validateManagedFreshInspectionReview(f.env,payload,session as ManagedFreshInspectionSession):
          inspection.validateManagedInspectionReview(f.env,payload,session as ManagedInspectionSession));
        assert.equal(spawns,0);
      }finally{mock.mock.restore();syncBuiltinESMExports();}
    }finally{f.cleanup();}
  }}finally{if(original===undefined)delete process.env.SystemRoot;else process.env.SystemRoot=original;}
});
