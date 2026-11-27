import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {syncBuiltinESMExports} from 'node:module';
import {managedStepFixtures} from '../fixtures/managed-steps.ts';
import {createFixtureBinding} from '../fixtures/managed.ts';
import {canonical,digest,Store} from '../../shared/store.ts';
import {publishPrivateJson} from '../../shared/managed-binding.ts';
import {parseManagedStepJournal,managedTargetDigest,managedRequestDigest,managedJournalProgress,type ManagedStepJournal} from '../../setup/managed-step-journal.ts';
import {readManagedStepJournal,writeManagedStepJournal,publishManagedStepIntent,validatePublishedManagedIntent,validateManagedJournalChange,migrationFile,readMigration,observeInitialJournalSave,settleInitialJournalSave} from '../../setup/managed-migration.ts';
import {MANAGED_STEP_LIMITS} from '../../shared/managed-steps.ts';

// Wire examples intentionally use placeholder digests. Engine fixtures hash the
// frozen target/plan; changing a binding must not silently reuse placeholder consent.
function hashed(journal:ManagedStepJournal) {
  journal.migration.consent.planDigest=digest(canonical(journal.migration.plan));
  journal.migration.consent.targetDigest=managedTargetDigest(journal);
  return journal;
}
function prepared() {
  const journal=hashed(managedStepFixtures().journal),m=journal.migration;
  Object.assign(m,{sequence:1,state:'pending',step:{name:'expectation',batch:0},lastCompleted:{name:'prepare',batch:0},intent:null,capture:{state:'unknown',observedAt:null}});
  const request=managedStepFixtures().requests.begin;
  m.receipt={requestDigest:managedRequestDigest(request,journal),expectedSequence:0,sequence:1,step:m.lastCompleted,outcome:'applied'};
  return journal;
}
function parsed(journal:ManagedStepJournal) {return parseManagedStepJournal(JSON.stringify(journal));}
function control(prior:ManagedStepJournal,state:'paused'|'abandoned'|'pending'|'failed') {
  const next=structuredClone(prior),m=next.migration;m.sequence++;m.state=state;
  m.receipt={requestDigest:'7'.repeat(64),expectedSequence:prior.migration.sequence,sequence:m.sequence,step:m.step,outcome:state==='failed'?'failed':'applied'};
  if(state==='failed')m.diagnostic={stage:'expectation',code:'managed-step-deadline'};
  else m.diagnostic=null;
  return next;
}
function running(prior:ManagedStepJournal) {
  const next=structuredClone(prior),m=next.migration;m.state='running';
  m.intent={requestDigest:'8'.repeat(64),expectedSequence:m.sequence,step:m.step!,effect:'intent',before:[],after:[],captureBefore:m.capture,captureReviewSequence:null};
  return next;
}
function settled(prior:ManagedStepJournal) {
  const next=structuredClone(prior),m=next.migration,index=m.plan.findIndex(s=>canonical(s)===canonical(m.step));
  m.sequence++;m.state=index===m.plan.length-1?'complete':'pending';m.lastCompleted=m.step;m.step=m.plan[index+1]??null;
  m.receipt={requestDigest:m.intent!.requestDigest,expectedSequence:prior.migration.sequence,sequence:m.sequence,step:m.lastCompleted,outcome:'applied'};
  m.intent=null;return next;
}
function fixture() {
  const root=fs.mkdtempSync('/tmp/opencode/managed-journal-'),{env,binding}=createFixtureBinding(root);
  const journal=hashed({...prepared(),...binding});
  journal.migration.receipt!.requestDigest=managedRequestDigest(managedStepFixtures().requests.begin,journal);
  return {root,env,binding,journal,file:migrationFile(env),cleanup(){fs.rmSync(root,{recursive:true,force:true});}};
}

test('only an intact first journal pair can be observed and reduced to its original single-link file',()=>{
  const f=fixture();try{
    writeManagedStepJournal(f.env,f.journal);
    const bytes=fs.readFileSync(f.file),stage=`${f.file}.stage-prepare-${digest(bytes)}`;
    fs.linkSync(f.file,stage);
    const original=fs.statSync(f.file,{bigint:true});
    assert.equal(original.nlink,2n);assert.equal(fs.statSync(stage,{bigint:true}).ino,original.ino);
    assert.throws(()=>readManagedStepJournal(f.env),{code:'managed-migration-conflict'});
    const save=observeInitialJournalSave(f.env,1)!;assert.deepEqual(save.journal,f.journal);
    assert.equal(fs.statSync(f.file).nlink,2,'observation does not unlink');
    settleInitialJournalSave(f.env,save);
    const final=fs.statSync(f.file,{bigint:true});
    assert.equal(final.ino,original.ino);assert.equal(final.dev,original.dev);assert.equal(final.nlink,1n);
    assert.equal(fs.existsSync(stage),false);assert.deepEqual(fs.readFileSync(f.file),bytes);
    assert.deepEqual(readManagedStepJournal(f.env),f.journal);
  }finally{f.cleanup();}
});

test('initial journal recognizer retains ambiguous links and changed or later records',()=>{
  const f=fixture();try{
    writeManagedStepJournal(f.env,f.journal);
    const bytes=fs.readFileSync(f.file),stage=`${f.file}.stage-prepare-${digest(bytes)}`,other=`${f.file}.stage-other`;
    const refuse=()=>assert.throws(()=>observeInitialJournalSave(f.env),{code:'managed-migration-conflict'});
    fs.linkSync(f.file,other);
    fs.copyFileSync(f.file,stage);
    refuse();assert.notEqual(fs.statSync(stage,{bigint:true}).ino,fs.statSync(f.file,{bigint:true}).ino);
    assert.deepEqual(fs.readFileSync(stage),bytes);assert.deepEqual(fs.readFileSync(other),bytes);
    fs.unlinkSync(stage);refuse();assert.equal(fs.statSync(other).nlink,2);
    fs.renameSync(other,stage);fs.linkSync(f.file,other);refuse();assert.equal(fs.statSync(stage).nlink,3);
    fs.unlinkSync(other);fs.writeFileSync(other,'foreign',{mode:0o600});refuse();assert.equal(fs.readFileSync(other,'utf8'),'foreign');
    fs.unlinkSync(other);const save=observeInitialJournalSave(f.env,1)!;
    const changed=Buffer.concat([bytes,Buffer.from('\n')]);fs.writeFileSync(f.file,changed);
    assert.throws(()=>settleInitialJournalSave(f.env,save),{code:'managed-migration-conflict'});
    assert.deepEqual(fs.readFileSync(stage),changed);assert.deepEqual(fs.readFileSync(f.file),changed);
    fs.unlinkSync(stage);fs.unlinkSync(f.file);fs.writeFileSync(stage,bytes,{mode:0o600});
    assert.throws(()=>readManagedStepJournal(f.env),{code:'managed-migration-conflict'});
    assert.deepEqual(fs.readFileSync(stage),bytes);fs.unlinkSync(stage);
    const later=Buffer.from(JSON.stringify(control(f.journal,'paused'))),laterStage=`${f.file}.stage-prepare-${digest(later)}`;
    fs.writeFileSync(f.file,later,{mode:0o600});fs.linkSync(f.file,laterStage);
    assert.throws(()=>observeInitialJournalSave(f.env),{code:'managed-step-conflict'});
    assert.equal(fs.statSync(laterStage).nlink,2);assert.deepEqual(fs.readFileSync(f.file),later);
  }finally{f.cleanup();}
});

test('initial journal publication preserves an exclusive-stage collision and a replacement of its own stage',t=>{
  const f=fixture(),open=fs.openSync,link=fs.linkSync,rename=fs.renameSync;
  const stage=`${f.file}.stage-prepare-${digest(JSON.stringify(f.journal))}`,saved=`${stage}.saved`;
  try{
    const collision=t.mock.method(fs,'openSync',((file:any,...args:any[])=>{
      if(file===stage){
        const fd=open(stage,'wx',0o600);try{fs.writeFileSync(fd,'pre-existing');}finally{fs.closeSync(fd);}
      }
      return (open as any)(file,...args);
    }) as typeof fs.openSync);
    syncBuiltinESMExports();
    try{assert.throws(()=>writeManagedStepJournal(f.env,f.journal),{code:'EEXIST'});}
    finally{collision.mock.restore();syncBuiltinESMExports();}
    assert.equal(fs.readFileSync(stage,'utf8'),'pre-existing');assert.equal(fs.existsSync(f.file),false);
    fs.unlinkSync(stage);
    const replacement=t.mock.method(fs,'linkSync',((from:any,to:any)=>{
      link(from,to);
      if(from===stage){rename(stage,saved);fs.writeFileSync(stage,'replacement',{mode:0o600,flag:'wx'});}
    }) as typeof fs.linkSync);
    syncBuiltinESMExports();
    try{assert.throws(()=>writeManagedStepJournal(f.env,f.journal),{code:'managed-binding-invalid'});}
    finally{replacement.mock.restore();syncBuiltinESMExports();}
    assert.equal(fs.readFileSync(stage,'utf8'),'replacement');assert.deepEqual(fs.readFileSync(saved),fs.readFileSync(f.file));
  }finally{f.cleanup();}
});

test('journal parser accepts all durable states, retained intents and reviewed capture histories',()=>{
  const f=managedStepFixtures(),initial=prepared();
  const complete=hashed(structuredClone(f.interruptedEnable));
  Object.assign(complete.migration,{sequence:13,state:'complete',phase:'complete',step:null,lastCompleted:{name:'reconcile',batch:0},intent:null,diagnostic:null});
  complete.migration.receipt={requestDigest:'a'.repeat(64),expectedSequence:12,sequence:13,step:complete.migration.lastCompleted,outcome:'applied'};
  const examples=[initial,control(initial,'paused'),control(initial,'abandoned'),control(initial,'failed'),complete,
    f.journal,f.interruptedEnable,f.reviewedJournal,f.renewedRunningJournal,f.pausedJournal,f.removedJournal];
  for(const example of examples){hashed(example);assert.deepEqual(parsed(example),example);}
  assert.equal(parsed(hashed(f.journal)).migration.intent!.before[0]!.object!.inode,'9007199254740993');
});

test('strict journal parser refuses unknown fields, malformed evidence and inconsistent progress',()=>{
  const mutations:Array<(j:any)=>void>=[
    j=>{j.extra=true;},j=>{j.source.extra=true;},j=>{j.source.verified=false;},j=>{j.schemaVersion=3;},
    j=>{j.migration.format=1;},j=>{j.migration.format=3;},j=>{j.migration.extra=true;},j=>{j.migration.state='constructor';},
    j=>{j.migration.operationId='NOT-AN-OPERATION';},j=>{j.migration.sequence=0;},j=>{j.migration.sequence=Number.MAX_SAFE_INTEGER+1;},
    j=>{j.migration.consent.extra=true;},j=>{j.migration.consent.targetDigest='0'.repeat(64);},
    j=>{j.migration.plan.reverse();hashed(j);},j=>{j.migration.plan[3].batch=1;hashed(j);},
    j=>{j.migration.plan.splice(3,1);hashed(j);},j=>{j.migration.step={name:'enable',batch:0};},
    j=>{j.migration.phase='complete';},j=>{j.migration.state='running';},j=>{j.migration.state='complete';},
    j=>{j.migration.capture={state:'unknown',observedAt:'2026-01-01T00:00:00.000Z'};},
    j=>{j.migration.capture={state:'on',observedAt:null};},j=>{j.migration.capture.extra='no';},
    j=>{j.migration.receipt.sequence=2;},j=>{j.migration.receipt.expectedSequence=2;},
    j=>{j.migration.receipt=null;},
    j=>{j.migration.receipt.outcome='failed';},j=>{j.migration.diagnostic={stage:'expectation',code:'/private/raw-error'};},
    j=>{j.migration.legacy.ownership='{}';hashed(j);},j=>{j.migration.legacy.ownershipDigest='0'.repeat(64);hashed(j);},
    j=>{j.migration.legacy.claims=[{path:'/fixture/link',kind:'file',object:null,digest:'a'.repeat(64)}];hashed(j);},
    j=>{j.migration.legacy.claims=[{path:'../relative',kind:'absent',object:null,digest:null}];hashed(j);},
    j=>{j.migration.legacy.claims=[{path:'/fixture/../other',kind:'absent',object:null,digest:null}];hashed(j);},
  ];
  for(const mutate of mutations){const journal=prepared();mutate(journal);assert.throws(()=>parsed(journal),{code:'managed-journal-unsupported'},mutate.toString());}
});

test('journal rejects invalid UTF-8, byte overflow, duplicate claims and combined path overflow',()=>{
  assert.throws(()=>parseManagedStepJournal(new Uint8Array([0xff])),{code:'managed-journal-unsupported'});
  assert.throws(()=>parseManagedStepJournal(' '.repeat(MANAGED_STEP_LIMITS.journalBytes+1)),{code:'managed-step-limit'});
  const j=prepared(),claim={path:'/fixture/file',kind:'absent' as const,object:null,digest:null};
  j.migration.legacy.claims=[claim,claim];hashed(j);assert.throws(()=>parsed(j),{code:'managed-journal-unsupported'});
  j.migration.legacy.claims=Array.from({length:MANAGED_STEP_LIMITS.claimPaths},(_,i)=>({...claim,path:`/fixture/path-${i}`}));
  hashed(j);assert.deepEqual(parsed(j),j);
  const r=running(j);r.migration.intent!.before=[claim];
  assert.throws(()=>parsed(r),{code:'managed-step-limit'});
});

test('request digests retain full content, canonical key order and one-use capture renewal identity',()=>{
  const j=prepared(),a=managedStepFixtures().requests.advance;
  const reordered={step:{batch:a.step.batch,name:a.step.name},expectedSequence:a.expectedSequence,operationId:a.operationId,action:a.action,version:a.version};
  assert.equal(managedRequestDigest(a,j),managedRequestDigest(reordered,j));
  assert.notEqual(managedRequestDigest(a,j),managedRequestDigest({...a,expectedSequence:2},j));
  const renewal=managedStepFixtures().reviewedJournal.migration.captureRenewals[0]!;
  assert.notEqual(managedRequestDigest(a,j),managedRequestDigest(a,j,renewal));
  assert.notEqual(managedRequestDigest(a,j,renewal),managedRequestDigest(a,j,{...renewal,sequence:renewal.sequence+1}));
});

test('publication intents can predict new bytes, but observed claims must retain native identity',()=>{
  const j=running(prepared()),future={path:'/fixture/expectation.json',kind:'file' as const,object:null,digest:'a'.repeat(64)};
  j.migration.intent!.after=[future];assert.deepEqual(parsed(j),j);
  j.migration.intent!.before=[future];assert.throws(()=>parsed(j),{code:'managed-journal-unsupported'});
});

test('journal evolution keeps consent, plan, unresolved effects and terminal state immutable',()=>{
  const p=prepared(),r=running(p),s=settled(r);
  validateManagedJournalChange(parsed(p),parsed(r));validateManagedJournalChange(parsed(r),parsed(s));
  for(const state of ['paused','abandoned','failed','pending'] as const){
    const stopped=control(r,state);validateManagedJournalChange(parsed(r),parsed(stopped));
    assert.deepEqual(stopped.migration.intent,r.migration.intent);
    if(state!=='pending')validateManagedJournalChange(parsed(stopped),parsed(control(stopped,'pending')));
  }
  const forbidden:Array<(j:ManagedStepJournal)=>void>=[
    j=>{j.migration.consent.reviewDigest='f'.repeat(64);},j=>{j.migration.operationId='22222222-2222-4222-8222-222222222222';},
    j=>{j.migration.intent=null;},j=>{j.migration.sequence++;},j=>{j.migration.phase='removed';},
  ];
  for(const mutate of forbidden){const next=control(r,'paused');mutate(next);assert.throws(()=>validateManagedJournalChange(r,next),{code:'managed-step-conflict'});}
  assert.throws(()=>validateManagedJournalChange(p,s),{code:'managed-step-conflict'},'completion requires a durable running intent');
  const complete=structuredClone(s);complete.migration.state='complete';
  assert.throws(()=>validateManagedJournalChange(complete,control(complete,'pending')),{code:'managed-step-conflict'});
  validateManagedJournalChange(complete,structuredClone(complete));
});

test('capture renewal keeps the original decision and binds only its replacement intent',()=>{
  const f=managedStepFixtures(),a=hashed(f.interruptedEnable),b=hashed(f.reviewedJournal),c=hashed(f.renewedRunningJournal);
  validateManagedJournalChange(parsed(a),parsed(b));validateManagedJournalChange(parsed(b),parsed(c));
  const wrong=structuredClone(c);wrong.migration.intent!.captureReviewSequence=null;
  assert.throws(()=>validateManagedJournalChange(b,wrong),{code:'managed-step-conflict'});
  for(const mutate of [(j:ManagedStepJournal)=>{j.migration.captureRenewals=[];},
    (j:ManagedStepJournal)=>{j.migration.captureRenewals[0]!.priorIntent.requestDigest='f'.repeat(64);}]){
    const next=structuredClone(c);mutate(next);assert.throws(()=>validateManagedJournalChange(b,next),{code:'managed-step-conflict'});
  }
  c.migration.intent!.captureReviewSequence=99;assert.throws(()=>parsed(c),{code:'managed-journal-unsupported'});
});

test('cold projection never replays capture-on and signals explicit uncertain capture review',()=>{
  const f=managedStepFixtures();
  assert.equal(managedJournalProgress(prepared()).capture.state,'unknown');
  const current={state:'off',observedAt:'2026-01-02T00:00:00.000Z'} as const;
  assert.deepEqual(managedJournalProgress(f.interruptedEnable,current).capture,current);
  assert.equal(managedJournalProgress(f.interruptedEnable,current).recovery,'review');
  assert.equal(managedJournalProgress(f.interruptedEnable).recovery,'reconcile','unknown capture is not a decision');
  assert.equal(managedJournalProgress(f.reviewedJournal).recovery,'continue');
  assert.equal(managedJournalProgress(f.renewedRunningJournal,current).recovery,'review');
  assert.equal(managedJournalProgress(f.pausedJournal).recovery,'resume');
});

test('private journal publication is no-clobber, compare-before-replace and read-only observation',()=>{
  const f=fixture();try{
    assert.equal(readManagedStepJournal(f.env),undefined);
    const wrong=structuredClone(f.journal);wrong.source.configRoot=wrong.source.dataRoot;hashed(wrong);
    assert.throws(()=>writeManagedStepJournal(f.env,wrong),{code:'managed-migration-conflict'});
    assert.equal(fs.existsSync(f.file),false,'foreign bootstrap is refused before publication');
    writeManagedStepJournal(f.env,f.journal);
    const first=fs.readFileSync(f.file),storeBytes=fs.readFileSync(f.binding.database);
    assert.deepEqual(readManagedStepJournal(f.env),f.journal);
    assert.deepEqual(fs.readFileSync(f.binding.database),storeBytes,'journal observation never opens or writes the Store');
    assert.throws(()=>writeManagedStepJournal(f.env,f.journal),{code:'managed-step-conflict'});
    assert.deepEqual(fs.readFileSync(f.file),first);
    const next=running(f.journal);writeManagedStepJournal(f.env,next,f.journal);
    assert.deepEqual(readManagedStepJournal(f.env),next);
    assert.throws(()=>writeManagedStepJournal(f.env,control(f.journal,'paused'),f.journal),{code:'managed-step-conflict'});
    assert.throws(()=>readMigration(f.env),{code:'managed-migration-conflict'},'older reader fails closed');
  }finally{f.cleanup();}
});

test('publication crashes retain either the prior journal or the durable next checkpoint',t=>{
  for(const after of [false,true]){
    const f=fixture();try{
      writeManagedStepJournal(f.env,f.journal);const next=running(f.journal),rename=fs.renameSync;
      const mock=t.mock.method(fs,'renameSync',((from:any,to:any)=>{
        if(String(to)===f.file){if(after)rename(from,to);throw new Error('synthetic publication interruption');}
        return rename(from,to);
      }) as typeof fs.renameSync);syncBuiltinESMExports();
      try{assert.throws(()=>writeManagedStepJournal(f.env,next,f.journal),/synthetic publication interruption/);}
      finally{mock.mock.restore();syncBuiltinESMExports();}
      assert.deepEqual(readManagedStepJournal(f.env),after?next:f.journal);
      const store=new Store(f.binding.database,{readOnly:true});try{assert.equal(store.list().captureEnabled,true);}finally{store.close();}
    }finally{f.cleanup();}
  }
});

test('unsequenced intent publication requires exact fresh readback and cannot publish a control receipt',()=>{
  const f=fixture();try{
    writeManagedStepJournal(f.env,f.journal);const next=running(f.journal);
    assert.throws(()=>validatePublishedManagedIntent(f.env,next),{code:'managed-step-unsettled'});
    assert.throws(()=>publishManagedStepIntent(f.env,control(f.journal,'paused'),f.journal,()=>{}),{code:'managed-step-conflict'});
    const before=fs.readFileSync(f.file);
    assert.throws(()=>publishManagedStepIntent(f.env,next,f.journal,()=>{throw new Error('synthetic validation refusal');}),/synthetic validation refusal/);
    assert.deepEqual(fs.readFileSync(f.file),before);
    publishManagedStepIntent(f.env,next,f.journal,()=>{});validatePublishedManagedIntent(f.env,next);
    assert.equal(readManagedStepJournal(f.env)!.migration.sequence,f.journal.migration.sequence);
    assert.equal(managedJournalProgress(next).worker,'unsettled');
    const altered=structuredClone(next);altered.migration.intent!.requestDigest='9'.repeat(64);
    assert.throws(()=>validatePublishedManagedIntent(f.env,altered),{code:'managed-step-unsettled'});
  }finally{f.cleanup();}
});

test('missing journal resumes only within a valid marked container; partial or unsafe state is retained',()=>{
  const f=fixture();try{
    // This is the supported valid-marker/missing-journal bootstrap checkpoint.
    writeManagedStepJournal(f.env,f.journal);fs.unlinkSync(f.file);writeManagedStepJournal(f.env,f.journal);
    const bytes=fs.readFileSync(f.file),root=path.dirname(f.file),marker=path.join(root,'.ownership.json');
    fs.writeFileSync(path.join(root,'.configuration-lock'),'retained',{mode:0o600});
    assert.throws(()=>readManagedStepJournal(f.env),{code:'managed-configuration-busy'});
    fs.unlinkSync(path.join(root,'.configuration-lock'));
    fs.writeFileSync(`${f.file}.stage-synthetic`,'retained',{mode:0o600});
    assert.throws(()=>readManagedStepJournal(f.env),{code:'managed-migration-conflict'});
    assert.equal(fs.readFileSync(`${f.file}.stage-synthetic`,'utf8'),'retained');fs.unlinkSync(`${f.file}.stage-synthetic`);
    fs.linkSync(f.file,`${f.file}.alias`);assert.throws(()=>readManagedStepJournal(f.env),{code:'managed-migration-conflict'});fs.unlinkSync(`${f.file}.alias`);
    fs.unlinkSync(marker);assert.throws(()=>readManagedStepJournal(f.env),{code:'managed-binding-invalid'});
    assert.deepEqual(fs.readFileSync(f.file),bytes,'a refused checkpoint is never repaired or deleted');
  }finally{f.cleanup();}
});

test('journal read refuses oversized, changed-target, symlinked and unsupported state without mutation',()=>{
  const f=fixture();try{
    fs.writeFileSync(f.file,' '.repeat(MANAGED_STEP_LIMITS.journalBytes+1),{mode:0o600});
    assert.throws(()=>readManagedStepJournal(f.env),{code:'managed-step-limit'});
    publishPrivateJson(f.file,{...f.journal,migration:{...f.journal.migration,format:99}},true);
    assert.throws(()=>readManagedStepJournal(f.env),{code:'managed-journal-unsupported'});
    const other=hashed(structuredClone(f.journal));other.source.configRoot=other.source.dataRoot;hashed(other);
    publishPrivateJson(f.file,other,true);assert.throws(()=>readManagedStepJournal(f.env),{code:'managed-migration-conflict'});
    fs.unlinkSync(f.file);fs.symlinkSync(path.join(path.dirname(f.file),'progress-binding.json'),f.file);
    assert.throws(()=>readManagedStepJournal(f.env));assert.equal(fs.lstatSync(f.file).isSymbolicLink(),true);
  }finally{f.cleanup();}
});
