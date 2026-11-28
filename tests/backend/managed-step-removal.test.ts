import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {syncBuiltinESMExports} from 'node:module';
import cp from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {lifecycle,migrationEvidence,validateMigrationRemoval,removeMigrationFile,migrationRemovalRecordClaims,recordMigrationRemoval,migrationRemovalRecorded,migrationRemovalComplete} from '../../setup/lifecycle.ts';
import {Store,canonical,digest} from '../../shared/store.ts';
import {parseManagedStepJournal,managedTargetDigest,type ManagedStepJournal} from '../../setup/managed-step-journal.ts';
import {isolatedEnvironment} from '../fixtures/managed.ts';
import {createManagedBindingDirectory,publishPrivateJson} from '../../shared/managed-binding.ts';
import {migrationFile} from '../../setup/managed-migration.ts';
import type {ManagedVolumeIdentityReader} from '../../setup/managed-volume-identity.ts';

function fixture(){
  const root=fs.mkdtempSync('/tmp/opencode/step-removal-'),env=isolatedEnvironment(root);
  const targets={configRoot:path.join(env.XDG_CONFIG_HOME!,'opencode'),dataRoot:path.join(env.XDG_DATA_HOME!,'opencode'),storeRoot:path.join(root,'store'),confirmed:true};
  for(const dir of [targets.configRoot,targets.dataRoot])fs.mkdirSync(dir,{mode:0o700});
  lifecycle('install',targets,{plugin:'// synthetic plugin',guidance:'synthetic guidance',removal:'// synthetic remover',version:'1.1.1'});
  const evidence=migrationEvidence(targets),binding={...evidence.binding,installId:'managed-synthetic',version:'1.3.0'};
  const journal:ManagedStepJournal={...binding,migration:{format:2,product:'openchamber-agent-progress-managed',phase:'pending',legacyInstallId:evidence.binding.installId,
    operationId:'11111111-1111-4111-8111-111111111111',sequence:3,state:'pending',step:evidence.plan[3]!,lastCompleted:evidence.plan[2]!,
    consent:{reviewDigest:'1'.repeat(64),targetDigest:'2'.repeat(64),planDigest:digest(canonical(evidence.plan))},expectation:{version:'1.3.0',fingerprint:'3'.repeat(64)},
    plan:evidence.plan,legacy:evidence.legacy,captureRenewals:[],intent:null,
    receipt:{requestDigest:'5'.repeat(64),expectedSequence:2,sequence:3,step:{name:'disable',batch:0},outcome:'applied'},
    capture:{state:'off',observedAt:'2026-01-01T00:00:00.000Z'},diagnostic:null}};
  journal.migration.consent.targetDigest=managedTargetDigest(journal);
  const store=new Store(binding.database);store.setEnabled(false);
  const legacyRoot=path.join(targets.configRoot,'plugins','agent-progress'),history=path.join(targets.storeRoot,'installation-history.jsonl');
  return {root,env,targets,journal,legacyRoot,history,store,cleanup(){store.close();fs.rmSync(root,{recursive:true,force:true});}};
}
function authorize(journal:ManagedStepJournal,read?:ManagedVolumeIdentityReader){
  const layout=validateMigrationRemoval(journal,read),file=layout.file(journal.migration.step)!;
  const m=journal.migration;m.state='running';m.capture=layout.capture;
  m.intent={requestDigest:'4'.repeat(64),expectedSequence:m.sequence,step:m.step!,effect:'intent',before:[layout.claims.get(file)!],
    after:[{path:file,kind:'absent',object:null,digest:null}],captureBefore:layout.capture,captureReviewSequence:null};
  return file;
}
function complete(journal:ManagedStepJournal){
  const m=journal.migration,index=m.plan.findIndex(s=>canonical(s)===canonical(m.step));
  m.receipt={requestDigest:m.intent!.requestDigest,expectedSequence:m.sequence,sequence:++m.sequence,step:m.step,outcome:'applied'};
  if(m.step?.name==='record-removal')m.phase='removed';
  m.lastCompleted=m.step;m.step=m.plan[index+1]!;m.intent=null;m.state='pending';
  parseManagedStepJournal(JSON.stringify(journal));
}
function readyRecord(journal:ManagedStepJournal,read?:ManagedVolumeIdentityReader){
  while(journal.migration.step!.name==='remove-discovery'){authorize(journal,read);removeMigrationFile(journal,undefined,read);complete(journal);}
}
function authorizeRecord(journal:ManagedStepJournal,read?:ManagedVolumeIdentityReader){
  const claims=migrationRemovalRecordClaims(journal,read),m=journal.migration;
  m.state='running';m.intent={requestDigest:'6'.repeat(64),expectedSequence:m.sequence,step:m.step!,effect:'intent',
    before:claims.before,after:claims.after,captureBefore:claims.capture,captureReviewSequence:null};
  parseManagedStepJournal(JSON.stringify(journal));
}

function volumeFixture(f:ReturnType<typeof fixture>,renumber:boolean){
  // Independent proofs for discovery, retained Store and its history. A swap
  // can change just one target's proof without changing any lstat/byte facts.
  const m=f.journal.migration,paths=[
    ...m.legacy.claims.map(c=>{
      if(renumber&&c.object)c.object.device=String(BigInt(c.object.device)+1n);
      return {path:c.path,fingerprint:(c.path.startsWith(f.targets.storeRoot+path.sep)||c.path===f.targets.storeRoot?'b':'a').repeat(64)};
    }),
    {path:f.journal.database,fingerprint:'b'.repeat(64)},
    {path:f.history,fingerprint:'c'.repeat(64)},
  ];
  m.legacy.volumeIdentity={version:1,paths};
  m.consent.targetDigest=managedTargetDigest(f.journal);
  const observed=new Map(paths.map(p=>[p.path,p.fingerprint]));
  const read:ManagedVolumeIdentityReader=({path})=>{
    const fingerprint=observed.get(path);
    return fingerprint?{kind:'verified',fingerprint}:{kind:'unavailable'};
  };
  return {observed,read};
}

test('matching proofs after renumbering reconcile removal and exact history despite later appends',()=>{
  const f=fixture();try{
    const {observed,read}=volumeFixture(f,true);
    const priorHistory=fs.readFileSync(f.history);
    const file=authorize(f.journal,read);
    assert.throws(()=>removeMigrationFile(f.journal),{code:'installation-changed'});
    assert.ok(fs.existsSync(file));
    assert.equal(removeMigrationFile(f.journal,undefined,read).removed,true);
    assert.equal(removeMigrationFile(f.journal,undefined,read).removed,false);
    complete(f.journal);readyRecord(f.journal,read);authorizeRecord(f.journal,read);
    // Simulate an interruption with history's original device captured in the
    // intent. Its before and after claims must still agree exactly.
    const {before,after}=f.journal.migration.intent!;
    const saved=before[1]!.object!,afterLive=after[1]!.object!;
    before[1]!.object={...saved,device:String(BigInt(saved.device)+1n)};
    assert.throws(()=>recordMigrationRemoval(f.journal,undefined,read),{code:'managed-step-conflict'});
    assert.ok(fs.existsSync(f.legacyRoot));
    assert.deepEqual(fs.readFileSync(f.history),priorHistory);
    after[1]!.object={...afterLive,device:before[1]!.object!.device};
    assert.equal(recordMigrationRemoval(f.journal,undefined,read).recorded,true);
    const prefix=fs.readFileSync(f.history);
    assert.deepEqual(prefix.subarray(0,priorHistory.length),priorHistory);
    assert.equal(prefix.subarray(priorHistory.length).toString().trim().split('\n').length,1);
    fs.appendFileSync(f.history,'{"action":"later"}\n');
    const appended=fs.readFileSync(f.history);
    assert.equal(migrationRemovalRecorded(f.journal,read),true);
    assert.equal(recordMigrationRemoval(f.journal,undefined,read).recorded,false);
    assert.deepEqual(fs.readFileSync(f.history),appended);
    complete(f.journal);
    assert.equal(migrationRemovalComplete(f.journal,read),true);
    observed.set(f.history,'e'.repeat(64));
    assert.throws(()=>migrationRemovalComplete(f.journal,read),{code:'installation-changed'});
    assert.deepEqual(fs.readFileSync(f.history),appended);
    assert.equal(fs.existsSync(f.legacyRoot),false);
  }finally{f.cleanup();}
});

for(const proof of ['different','unavailable'] as const)test(`removal refuses ${proof} proof on just its target despite a reused device`,()=>{
  const f=fixture();try{
    const {observed,read}=volumeFixture(f,false);
    const first=authorize(f.journal,read);removeMigrationFile(f.journal,undefined,read);complete(f.journal);
    const next=authorize(f.journal,read),bytes=fs.readFileSync(next),history=fs.readFileSync(f.history),prior=structuredClone(f.journal);
    if(proof==='different')observed.set(next,'d'.repeat(64));else observed.delete(next);
    assert.throws(()=>removeMigrationFile(f.journal,undefined,read),{code:'installation-changed'});
    assert.deepEqual(fs.readFileSync(next),bytes);
    assert.equal(fs.existsSync(first),false);
    assert.deepEqual(fs.readFileSync(f.history),history);
    assert.deepEqual(f.journal,prior);
  }finally{f.cleanup();}
});

test('a history-only swap between rmdir and append refuses without undoing the directory removal',t=>{
  const f=fixture();try{
    const {observed,read}=volumeFixture(f,false);
    readyRecord(f.journal,read);authorizeRecord(f.journal,read);
    const original=fs.rmdirSync,bytes=fs.readFileSync(f.history),prior=structuredClone(f.journal);
    const mock=t.mock.method(fs,'rmdirSync',((p:any,options:any)=>{
      original(p,options);if(String(p)===f.legacyRoot)observed.set(f.history,'e'.repeat(64));
    }) as typeof fs.rmdirSync);syncBuiltinESMExports();
    try{assert.throws(()=>recordMigrationRemoval(f.journal,undefined,read),{code:'installation-changed'});}
    finally{mock.mock.restore();syncBuiltinESMExports();}
    assert.equal(fs.existsSync(f.legacyRoot),false);
    assert.deepEqual(fs.readFileSync(f.history),bytes);
    assert.deepEqual(f.journal,prior);
    observed.set(f.history,'c'.repeat(64));
    assert.equal(recordMigrationRemoval(f.journal,undefined,read).removed,false);
    assert.equal(migrationRemovalRecorded(f.journal,read),true);
  }finally{f.cleanup();}
});

test('lifecycle owner removes one frozen file at a time, keeps manifest last, retains payloads/history',()=>{
  const f=fixture();try{
    const original=fs.readFileSync(f.history),released=f.journal.migration.legacy.claims.filter(c=>c.kind==='file'&&c.path.includes(`${path.sep}payloads${path.sep}`));
    const removed:string[]=[];
    while(f.journal.migration.step!.name==='remove-discovery'){
      const file=authorize(f.journal),before=fs.readdirSync(f.legacyRoot);
      assert.deepEqual(removeMigrationFile(f.journal).removed,true);
      assert.equal(fs.readdirSync(f.legacyRoot).length,before.length-1);removed.push(path.basename(file));
      assert.equal(f.store.list().captureEnabled,false);assert.deepEqual(fs.readFileSync(f.history),original);
      for(const c of released)assert.equal(digest(fs.readFileSync(c.path)),c.digest);
      complete(f.journal);
    }
    assert.equal(removed.length,6);assert.equal(removed.at(-1),'.ownership.json');
    assert.equal(f.journal.migration.step!.name,'record-removal');assert.deepEqual(fs.readdirSync(f.legacyRoot),[]);
    validateMigrationRemoval(f.journal);
  }finally{f.cleanup();}
});

for(const afterEffect of [false,true])test(`each discovery file reconciles interruption ${afterEffect?'after':'before'} unlink without a second effect`,t=>{
  const f=fixture();try{
    for(let batch=0;batch<6;batch++){
      const file=authorize(f.journal),prior=structuredClone(f.journal),unlink=fs.unlinkSync;let effects=0;
      const mock=t.mock.method(fs,'unlinkSync',((p:any)=>{
        if(String(p)===file){if(afterEffect){unlink(p);effects++;}throw new Error('synthetic interruption');}
        return unlink(p);
      }) as typeof fs.unlinkSync);syncBuiltinESMExports();
      try{assert.throws(()=>removeMigrationFile(f.journal),/synthetic interruption/);}
      finally{mock.mock.restore();syncBuiltinESMExports();}
      assert.deepEqual(f.journal,prior,'effect owner never claims a journal checkpoint');
      const result=removeMigrationFile(f.journal);if(result.removed)effects++;
      assert.equal(effects,1);assert.equal(fs.existsSync(file),false);
      assert.equal(removeMigrationFile(f.journal).removed,false,'same intent replay observes absence, never unlinks twice');
      complete(f.journal);
    }
  }finally{f.cleanup();}
});

test('missing files without the current intent or completed same-operation evidence refuse',()=>{
  const f=fixture();try{
    const file=validateMigrationRemoval(f.journal).file(f.journal.migration.step)!;fs.unlinkSync(file);
    assert.throws(()=>validateMigrationRemoval(f.journal),{code:'modified-owned-files'});
    assert.throws(()=>removeMigrationFile(f.journal),{code:'managed-step-conflict'});
  }finally{f.cleanup();}
});

test('removal requires durable exact intent and fresh off capture',()=>{
  const f=fixture();try{
    assert.throws(()=>removeMigrationFile(f.journal),{code:'managed-step-conflict'});
    const file=authorize(f.journal);f.store.setEnabled(true);
    assert.throws(()=>removeMigrationFile(f.journal),{code:'managed-step-conflict'});assert.equal(fs.existsSync(file),true);
    f.store.setEnabled(false);
    const before=f.journal.migration.intent!.before;f.journal.migration.intent!.before=[];
    assert.throws(()=>removeMigrationFile(f.journal),{code:'managed-step-conflict'});f.journal.migration.intent!.before=before;
    f.journal.migration.intent!.after[0]!.path=path.join(f.legacyRoot,'other');
    assert.throws(()=>removeMigrationFile(f.journal),{code:'managed-step-conflict'});assert.equal(fs.existsSync(file),true);
  }finally{f.cleanup();}
});

for(const damage of ['bytes','object','link','foreign-discovery','foreign-release','manifest','store-source','plan'] as const){
  test(`fresh remaining-set validation refuses changed ${damage} before deletion`,()=>{
    const f=fixture();try{
      const file=authorize(f.journal),bytes=fs.readFileSync(file);
      if(damage==='bytes')fs.appendFileSync(file,'changed');
      if(damage==='object'){fs.renameSync(file,`${file}.old`);fs.writeFileSync(file,bytes,{mode:0o600});fs.unlinkSync(`${file}.old`);}
      if(damage==='link')fs.linkSync(file,path.join(f.root,'alias'));
      if(damage==='foreign-discovery')fs.writeFileSync(path.join(f.legacyRoot,'foreign'),'foreign',{mode:0o600});
      if(damage==='foreign-release'){
        const payload=f.journal.migration.legacy.claims.find(c=>c.kind==='file'&&c.path.includes(`${path.sep}payloads${path.sep}`))!;
        fs.writeFileSync(path.join(path.dirname(payload.path),'foreign'),'foreign',{mode:0o600});
      }
      if(damage==='manifest')fs.appendFileSync(path.join(f.legacyRoot,'.ownership.json'),' ');
      if(damage==='store-source')f.journal.source.id='other-source';
      if(damage==='plan')f.journal.migration.plan[3]!.batch=1;
      assert.throws(()=>removeMigrationFile(f.journal));assert.equal(fs.existsSync(file),true,'refusal precedes unlink');
      assert.equal(f.store.list().captureEnabled,false);
    }finally{f.cleanup();}
  });
}

test('completed removal evidence never authorizes deleting a replacement at an earlier path',()=>{
  const f=fixture();try{
    const first=authorize(f.journal),bytes=fs.readFileSync(first);removeMigrationFile(f.journal);complete(f.journal);
    fs.writeFileSync(first,bytes,{mode:0o600});
    assert.throws(()=>validateMigrationRemoval(f.journal),{code:'installation-changed'});
    assert.equal(fs.existsSync(first),true);
  }finally{f.cleanup();}
});

test('record-removal removes only the empty owned directory and appends its exact event once',()=>{
  const f=fixture();try{
    readyRecord(f.journal);const history=fs.readFileSync(f.history);authorizeRecord(f.journal);
    assert.equal(migrationRemovalRecorded(f.journal),false);
    assert.deepEqual(recordMigrationRemoval(f.journal),{removed:true,recorded:true,capture:{state:'unknown',observedAt:null}});
    assert.equal(fs.existsSync(f.legacyRoot),false);assert.equal(migrationRemovalRecorded(f.journal),true);
    const appended=fs.readFileSync(f.history);assert.deepEqual(appended.subarray(0,history.length),history);
    const event=JSON.parse(appended.subarray(history.length).toString());
    assert.equal(event.action,'remove-capture');assert.equal(event.installId,f.journal.migration.legacyInstallId);
    assert.equal(event.operationId,f.journal.migration.operationId);assert.equal(event.at,f.journal.migration.intent!.captureBefore.observedAt);
    assert.deepEqual(recordMigrationRemoval(f.journal),{removed:false,recorded:false,capture:{state:'unknown',observedAt:null}});
    assert.deepEqual(fs.readFileSync(f.history),appended);assert.equal(f.store.list().captureEnabled,false);
    complete(f.journal);validateMigrationRemoval(f.journal);
    for(const c of f.journal.migration.legacy.claims.filter(c=>c.kind==='file'&&c.path.includes(`${path.sep}payloads${path.sep}`)))
      assert.equal(digest(fs.readFileSync(c.path)),c.digest);
  }finally{f.cleanup();}
});

for(const boundary of ['rmdir','append'] as const)for(const afterEffect of [false,true]){
  test(`record-removal reconciles interruption ${afterEffect?'after':'before'} ${boundary}`,t=>{
    const f=fixture();try{
      readyRecord(f.journal);authorizeRecord(f.journal);const prior=structuredClone(f.journal),history=fs.readFileSync(f.history);
      const original=boundary==='rmdir'?fs.rmdirSync:fs.appendFileSync;
      const mock=t.mock.method(fs,boundary==='rmdir'?'rmdirSync':'appendFileSync',((...args:any[])=>{
        if(String(args[0])===(boundary==='rmdir'?f.legacyRoot:f.history)){
          if(afterEffect)(original as any)(...args);throw new Error('synthetic interruption');
        }
        return (original as any)(...args);
      }) as any);syncBuiltinESMExports();
      try{assert.throws(()=>recordMigrationRemoval(f.journal),/synthetic interruption/);}
      finally{mock.mock.restore();syncBuiltinESMExports();}
      assert.deepEqual(f.journal,prior,'effect owner never settles the journal');
      recordMigrationRemoval(f.journal);assert.equal(migrationRemovalRecorded(f.journal),true);
      const bytes=fs.readFileSync(f.history);assert.deepEqual(bytes.subarray(0,history.length),history);
      assert.equal(bytes.subarray(history.length).toString().trim().split('\n').length,1);
      recordMigrationRemoval(f.journal);assert.deepEqual(fs.readFileSync(f.history),bytes);
    }finally{f.cleanup();}
  });
}

for(const damage of ['foreign-directory','replacement-directory','history-link','history-replaced','history-changed','partial-history','capture-on','no-intent','wrong-event'] as const){
  test(`record-removal refuses ${damage} before either subeffect`,()=>{
    const f=fixture();try{
      readyRecord(f.journal);authorizeRecord(f.journal);
      if(damage==='foreign-directory')fs.writeFileSync(path.join(f.legacyRoot,'foreign'),'foreign');
      if(damage==='replacement-directory'){fs.renameSync(f.legacyRoot,`${f.legacyRoot}.retained`);fs.mkdirSync(f.legacyRoot,{mode:0o700});}
      if(damage==='history-link')fs.linkSync(f.history,path.join(f.root,'alias'));
      if(damage==='history-replaced'){fs.renameSync(f.history,`${f.history}.retained`);fs.copyFileSync(`${f.history}.retained`,f.history);fs.chmodSync(f.history,0o600);}
      if(damage==='history-changed')fs.appendFileSync(f.history,'{}\n');
      if(damage==='partial-history')fs.appendFileSync(f.history,'{');
      if(damage==='capture-on')f.store.setEnabled(true);
      if(damage==='no-intent')f.journal.migration.intent=null;
      if(damage==='wrong-event')f.journal.migration.intent!.after[1]!.digest='0'.repeat(64);
      const before=fs.readFileSync(f.history);
      assert.throws(()=>recordMigrationRemoval(f.journal));assert.equal(fs.existsSync(f.legacyRoot),true);
      assert.deepEqual(fs.readFileSync(f.history),before);
    }finally{f.cleanup();}
  });
}

test('record-removal revalidates after rmdir; missing directory does not imply a history event',t=>{
  const f=fixture();try{
    readyRecord(f.journal);authorizeRecord(f.journal);const history=fs.readFileSync(f.history),original=fs.rmdirSync;
    const mock=t.mock.method(fs,'rmdirSync',((p:any,options:any)=>{
      original(p,options);if(String(p)===f.legacyRoot)f.store.setEnabled(true);
    }) as typeof fs.rmdirSync);syncBuiltinESMExports();
    try{assert.throws(()=>recordMigrationRemoval(f.journal),{code:'managed-step-conflict'});}
    finally{mock.mock.restore();syncBuiltinESMExports();}
    assert.equal(fs.existsSync(f.legacyRoot),false);assert.deepEqual(fs.readFileSync(f.history),history);
    f.store.setEnabled(false);assert.equal(migrationRemovalRecorded(f.journal),false);
    recordMigrationRemoval(f.journal);assert.equal(migrationRemovalRecorded(f.journal),true);
  }finally{f.cleanup();}
});

test('record-removal tolerates later history appends only after its own exact event in the same file',()=>{
  const f=fixture();try{
    readyRecord(f.journal);authorizeRecord(f.journal);recordMigrationRemoval(f.journal);
    fs.appendFileSync(f.history,JSON.stringify({action:'unrelated',installId:'other-install'})+'\n');const history=fs.readFileSync(f.history);
    assert.equal(migrationRemovalRecorded(f.journal),true);assert.equal(recordMigrationRemoval(f.journal).recorded,false);
    assert.deepEqual(fs.readFileSync(f.history),history);
    // Even an exact duplicate of our event is ambiguous, not a second receipt.
    fs.appendFileSync(f.history,history.toString().trim().split('\n').at(-2)!+'\n');
    assert.throws(()=>recordMigrationRemoval(f.journal),{code:'managed-migration-conflict'});
  }finally{f.cleanup();}
});

test('each one-file removal request and its journal publications start no process on the Windows path', {skip:process.platform==='win32'},async t=>{
  const f=fixture(),originalSystemRoot=process.env.SystemRoot;
  try{
    // Source projection preserves the actual publication owners. Only the OS
    // path dialect is substituted, so this is portable evidence that nothing
    // starts a process, not native Windows evidence.
    const source=path.join(f.root,'source');
    for(const dir of ['shared','setup'])fs.cpSync(path.resolve(dir),path.join(source,dir),{recursive:true});
    const platformFile=path.join(source,'shared/platform.ts');let text=fs.readFileSync(platformFile,'utf8');
    text=text.replace("export const windows = process.platform === 'win32';",'export const windows = true;');
    const start=text.indexOf("  if (value.includes('\\0')",text.indexOf('function windowsPathsInner(')),end=text.indexOf('  let current = clean;',start);
    assert.ok(start>0&&end>start);
    text=text.slice(0,start)+"  if (!path.isAbsolute(value) || path.resolve(value) !== value) throw new PlatformError('path-unverified');\n  const clean = value;\n"+text.slice(end);
    fs.writeFileSync(platformFile,text);
    createManagedBindingDirectory(f.env);publishPrivateJson(migrationFile(f.env),f.journal);
    let spawns=0;
    t.mock.method(cp,'spawnSync',(()=>{spawns++;throw new Error('no permission check may start a process');}) as unknown as typeof cp.spawnSync);syncBuiltinESMExports();process.env.SystemRoot='C:\\Windows';
    const platform=await import(pathToFileURL(platformFile).href) as typeof import('../../shared/platform.ts');
    const owner=await import(pathToFileURL(path.join(source,'setup/lifecycle.ts')).href) as typeof import('../../setup/lifecycle.ts');
    const migration=await import(pathToFileURL(path.join(source,'setup/managed-migration.ts')).href) as typeof import('../../setup/managed-migration.ts');
    for(let batch=0;batch<6;batch++){
      const budget=new platform.PlatformRequestBudget();
      platform.withPlatformRequestBudget(budget,()=>{
        platform.windowsPaths(migration.managedJournalPaths(f.journal),true);
        const prior=migration.readManagedStepJournal(f.env)!;owner.validateMigrationRemoval(prior);
        const intent=structuredClone(prior),layoutFile=path.join(f.legacyRoot,[...Object.keys(JSON.parse(prior.migration.legacy.ownership!).files).sort(),'.ownership.json'][batch]!);
        intent.migration.state='running';intent.migration.intent={requestDigest:'4'.repeat(64),expectedSequence:prior.migration.sequence,step:prior.migration.step!,effect:'intent',
          before:[prior.migration.legacy.claims.find(c=>c.path===layoutFile)!],after:[{path:layoutFile,kind:'absent',object:null,digest:null}],captureBefore:prior.migration.capture,captureReviewSequence:null};
        migration.writeManagedStepJournal(f.env,intent,prior,()=>{owner.validateMigrationRemoval(prior);});
        assert.equal(owner.removeMigrationFile(intent).removed,true);
        const next=structuredClone(intent);complete(next);next.migration.capture={state:'unknown',observedAt:null};
        migration.writeManagedStepJournal(f.env,next,intent,()=>{owner.validateMigrationRemoval(intent);});
        f.journal=next;
      });
      assert.equal(spawns,0,`discovery batch ${batch}`);
    }
    const budget=new platform.PlatformRequestBudget();
    platform.withPlatformRequestBudget(budget,()=>{
      platform.windowsPaths(migration.managedJournalPaths(f.journal),true);
      const prior=migration.readManagedStepJournal(f.env)!,claims=owner.migrationRemovalRecordClaims(prior);
      const intent=structuredClone(prior);
      intent.migration.state='running';intent.migration.intent={requestDigest:'6'.repeat(64),expectedSequence:prior.migration.sequence,step:prior.migration.step!,effect:'intent',
        before:claims.before,after:claims.after,captureBefore:claims.capture,captureReviewSequence:null};
      migration.publishManagedStepIntent(f.env,intent,prior,()=>{owner.validateMigrationRemoval(prior);});
      const validateIntent=()=>{
        platform.windowsPaths(migration.managedJournalPaths(intent),true);migration.validatePublishedManagedIntent(f.env,intent);
      };
      assert.deepEqual(owner.recordMigrationRemoval(intent,validateIntent),{removed:true,recorded:true,capture:{state:'unknown',observedAt:null}});
      const next=structuredClone(intent);complete(next);next.migration.capture={state:'unknown',observedAt:null};
      migration.writeManagedStepJournal(f.env,next,intent,()=>{assert.equal(owner.migrationRemovalRecorded(intent),true);});
      f.journal=next;
    });
    assert.equal(spawns,0);
  }finally{
    t.mock.restoreAll();syncBuiltinESMExports();
    if(originalSystemRoot===undefined)delete process.env.SystemRoot;else process.env.SystemRoot=originalSystemRoot;
    f.cleanup();
  }
});
