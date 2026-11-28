import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {managedFreshStepRequest,managedStepRequest,managedSetupStepRequest,managedFreshPlan,MANAGED_STEP_LIMITS} from '../../shared/managed-steps.ts';
import {absentFreshClaim,managedFreshStepFixtures,observedFreshClaim} from '../fixtures/managed-fresh-steps.ts';
import {managedStepFixtures} from '../fixtures/managed-steps.ts';
import {releasedManagedJournal} from '../fixtures/released-managed-journal.ts';
import {createFixtureBinding} from '../fixtures/managed.ts';
import {parseManagedFreshStepJournal,parseManagedStepJournal,managedTargetDigest,managedRequestDigest,
  validateManagedFreshCreationChange,type ManagedFreshStepJournal} from '../../setup/managed-step-journal.ts';
import {canonical,digest} from '../../shared/store.ts';
import {migrationFile,readManagedFreshStepJournal} from '../../setup/managed-migration.ts';
import {compareManagedHistoricalObject,compareManagedVolumePlacement,type ManagedVolumeIdentityEvidence,
  type ManagedVolumeIdentityReader} from '../../setup/managed-volume-identity.ts';

function parse(j:ManagedFreshStepJournal){return parseManagedFreshStepJournal(JSON.stringify(j));}
function hash(j:ManagedFreshStepJournal){j.migration.consent.targetDigest=managedTargetDigest(j);j.migration.consent.planDigest=digest(canonical(j.migration.plan));}
test('separately negotiated fresh requests never widen the migration vocabulary',()=>{
  const f=managedFreshStepFixtures();
  for(const r of Object.values(f.requests)){
    assert.deepEqual(managedFreshStepRequest(JSON.parse(JSON.stringify(r))),r);
    assert.deepEqual(managedSetupStepRequest(r),r);assert.equal(managedStepRequest(r),undefined);
  }
  for(const r of Object.values(managedStepFixtures().requests))assert.equal(managedFreshStepRequest(r),undefined);
  for(const bad of [{...f.requests.begin,storeId:'replacement'},{...f.requests.begin,confirmed:false},
    {...f.requests.begin,version:3},{...f.requests.advance,step:{name:'disable',batch:0}},
    {...f.requests.advance,step:{name:'create-store',batch:1}},{...f.requests.advance,expectedSequence:-1},
    {...f.requests.inspectNext,storeRoot:'/fixture/other'},
    {...f.requests.reviewedResume,review:{...f.requests.reviewedResume.review,step:'disable'}}])assert.equal(managedFreshStepRequest(bad),undefined);
});
test('four frozen fresh plans disclose creation and never change retained capture',()=>{
  const cases=[['create',true,'create'],['create',false,'create'],['retain',false,'create'],['retain',false,'reuse']] as const;
  for(const [store,missing,source] of cases){
    const f=managedFreshStepFixtures(store,missing,source);assert.deepEqual(parse(f.journal),f.journal);
    assert.equal(f.plan.some(s=>s.name==='store-directory'),missing);
    assert.equal(f.plan.some(s=>s.name==='create-store'),store==='create');
    assert.equal(f.plan.some(s=>s.name==='register-source'),source==='create');
    assert.equal(f.plan.some(s=>s.name==='enable'),store==='create');
    assert.equal(f.replies.prepared.progress?.planKind,'fresh');
    assert.equal(f.replies.prepared.progress?.capture.state,'unknown');
    assert.ok(f.plan.findIndex(s=>s.name==='expectation')<f.plan.findIndex(s=>s.name==='publish-binding'));
  }
  assert.throws(()=>managedFreshPlan('retain',true,'reuse'));
  assert.throws(()=>managedFreshPlan('create',false,'reuse'));
});
test('journal families fail closed, with no fabricated legacy evidence',()=>{
  const f=managedFreshStepFixtures();assert.throws(()=>parseManagedStepJournal(JSON.stringify(f.journal)),{code:'managed-journal-unsupported'});
  assert.throws(()=>parseManagedFreshStepJournal(JSON.stringify(managedStepFixtures().journal)),{code:'managed-journal-unsupported'});
  const changes:Array<(j:any)=>void>=[j=>j.migration.legacyInstallId='invented',j=>j.migration.phase='removed',j=>j.migration.planKind='migration',
    j=>j.migration.fresh.capturePolicy='preserve',j=>j.migration.fresh.sourceMode='reuse',j=>j.migration.fresh.capture='off',
    j=>j.migration.fresh.database.object={device:'1',inode:'2',birthNs:'1'},j=>j.migration.fresh.sidecars.pop(),
    j=>j.migration.fresh.selection.path='/fixture/other',j=>j.migration.fresh.directory.kind='file',
    j=>j.migration.plan.reverse(),j=>j.migration.created.directory=observedFreshClaim('/fixture/store','directory'),
    j=>j.migration.fresh.source={...j.source,verified:false}];
  for(const change of changes){const j=structuredClone(f.journal);change(j);hash(j);assert.throws(()=>parse(j),{code:'managed-journal-unsupported'},change.toString());}
});
test('fresh consent digests bind every creation choice and frozen identity but not completion observations',()=>{
  const j=managedFreshStepFixtures().journal,original=managedTargetDigest(j),request=managedFreshStepFixtures().requests.begin;
  for(const change of [(n:ManagedFreshStepJournal)=>{n.storeId='other';},(n:ManagedFreshStepJournal)=>{n.source.id='other';},
    (n:ManagedFreshStepJournal)=>{n.migration.fresh.directory=observedFreshClaim('/fixture/store','directory');},
    (n:ManagedFreshStepJournal)=>{n.migration.expectation.fingerprint='8'.repeat(64);}]){
    const n=structuredClone(j);change(n);assert.notEqual(managedTargetDigest(n),original);
  }
  const n=structuredClone(j);n.migration.created.directory=observedFreshClaim('/fixture/store','directory');assert.equal(managedTargetDigest(n),original);
  assert.notEqual(managedRequestDigest(request,j),managedRequestDigest({...request,version:1},j));
});

test('released and current fresh readers agree on old bytes; rollback refuses enriched state',async()=>{
  const root=fs.mkdtempSync('/tmp/opencode/managed-fresh-contract-');
  try{
    const {env,binding}=createFixtureBinding(root),file=migrationFile(env),managed=path.dirname(file);
    const j={...managedFreshStepFixtures('retain',false,'reuse').journal,...binding},m=j.migration,f=m.fresh;
    f.directory=observedFreshClaim(path.dirname(binding.database),'directory');
    f.database={...observedFreshClaim(binding.database,'file'),digest:null};
    f.sidecars=['-journal','-wal','-shm'].map(s=>absentFreshClaim(binding.database+s));
    f.source=binding.source;f.selection=absentFreshClaim(path.join(managed,'progress-binding.json'));
    f.journal=absentFreshClaim(file);f.legacy=absentFreshClaim(path.join(binding.source.configRoot,'plugins','agent-progress'));
    hash(j);
    const old=await releasedManagedJournal(path.join(root,'release')),bytes=Buffer.from(JSON.stringify(j));
    fs.writeFileSync(file,bytes,{mode:0o600});
    assert.deepEqual(old.readManagedFreshStepJournal(env),j);
    assert.deepEqual(readManagedFreshStepJournal(env),j);
    assert.deepEqual(fs.readFileSync(file),bytes);
    f.volumeIdentity={version:1,paths:[{path:j.database,fingerprint:'a'.repeat(64)}]};
    hash(j);
    const assertEnriched=()=>{
      const enriched=Buffer.from(JSON.stringify(j));
      fs.writeFileSync(file,enriched);
      assert.deepEqual(readManagedFreshStepJournal(env),j);
      assert.throws(()=>old.readManagedFreshStepJournal(env),{code:'managed-journal-unsupported'});
      const {status}=old.observeManagedSetup(env);
      assert.equal(status.configured,false);assert.equal(status.verified,false);
      assert.equal(status.delivery?.migration,'unavailable');
      assert.ok(status.diagnostics.includes('managed-journal-unsupported'));
      assert.deepEqual(fs.readFileSync(file),enriched);
    };
    assertEnriched();
    Object.assign(m,{phase:'complete',state:'complete',step:null,lastCompleted:m.plan.at(-1),sequence:m.plan.length});
    m.receipt={requestDigest:'7'.repeat(64),expectedSequence:m.sequence-1,sequence:m.sequence,step:m.lastCompleted,outcome:'applied'};
    assertEnriched();
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('fresh witnesses cannot be removed or changed and accept only bounded known fields and paths',()=>{
  const j=managedFreshStepFixtures().journal,f=j.migration.fresh;
  f.volumeIdentity={version:1,paths:[{path:f.directory.path,fingerprint:'a'.repeat(64)}]};
  hash(j);parse(j);
  for(const change of [
    (n:ManagedFreshStepJournal)=>{delete n.migration.fresh.volumeIdentity;},
    (n:ManagedFreshStepJournal)=>{n.migration.fresh.volumeIdentity!.paths[0]!.fingerprint='b'.repeat(64);},
  ]){
    const n=structuredClone(j);change(n);
    assert.throws(()=>parse(n),{code:'managed-journal-unsupported'});
    hash(n);parse(n);
    assert.throws(()=>validateManagedFreshCreationChange(j,n),{code:'managed-step-conflict'});
  }
  for(const invalid of [null,{version:2,paths:f.volumeIdentity.paths},{version:1,paths:[]},
    {...f.volumeIdentity,extra:true},{...f.volumeIdentity,paths:[...f.volumeIdentity.paths,...f.volumeIdentity.paths]},
    {...f.volumeIdentity,paths:[{path:'/fixture/unreviewed',fingerprint:'a'.repeat(64)}]},
    {...f.volumeIdentity,paths:[{path:f.directory.path,fingerprint:'A'.repeat(64)}]},
    {...f.volumeIdentity,paths:[{path:f.directory.path,fingerprint:'a'.repeat(64),containingMount:'/fixture'}]}]){
    const n=structuredClone(j);
    n.migration.fresh.volumeIdentity=invalid as typeof f.volumeIdentity;
    hash(n);assert.throws(()=>parse(n),{code:'managed-journal-unsupported'});
  }
  const n=structuredClone(j);n.migration.fresh.volumeIdentity!.paths=Array.from(
    {length:MANAGED_STEP_LIMITS.claimPaths+1},()=>f.volumeIdentity!.paths[0]!);
  hash(n);assert.throws(()=>parse(n),{code:'managed-step-limit'});
});

test('historical object comparison requires positive per-path proof even when the device is reused',()=>{
  const saved=observedFreshClaim('/fixture/store','directory'),fingerprint='a'.repeat(64);
  const evidence:ManagedVolumeIdentityEvidence={version:1,paths:[{path:saved.path,fingerprint}]};
  const renumbered={...saved,object:{...saved.object!,device:'2'}};
  const read:ManagedVolumeIdentityReader=target=>{
    assert.ok(target===saved||target===renumbered);
    return {kind:'verified',fingerprint};
  };
  const unavailable:ManagedVolumeIdentityReader=()=>({kind:'unavailable'});
  const unexpected:ManagedVolumeIdentityReader=()=>{throw Error('unanchored or incompatible objects never read proof');};
  assert.equal(compareManagedHistoricalObject(saved,renumbered,evidence,read),'same');
  assert.equal(compareManagedHistoricalObject(saved,saved,evidence,()=>({kind:'verified',fingerprint:'b'.repeat(64)})),'different');
  assert.equal(compareManagedHistoricalObject(saved,saved,evidence,unavailable),'unavailable');
  assert.equal(compareManagedHistoricalObject(saved,renumbered,evidence,unavailable),'unavailable');
  assert.equal(compareManagedHistoricalObject(saved,saved,undefined,unexpected),'same');
  assert.equal(compareManagedHistoricalObject(saved,renumbered,undefined,unexpected),'different');
  const other=observedFreshClaim('/fixture/other-store','directory');
  assert.equal(compareManagedHistoricalObject(other,{...renumbered,path:other.path},evidence,unexpected),'different');
  for(const live of [{...renumbered,path:other.path},{...renumbered,kind:'file' as const},{...renumbered,object:null},
    {...renumbered,object:{...renumbered.object,inode:'0'}},{...renumbered,object:{...renumbered.object,birthNs:'0'}}]){
    assert.equal(compareManagedHistoricalObject(saved,live,evidence,unexpected),'different');
  }
  const absent=absentFreshClaim(saved.path);
  assert.equal(compareManagedHistoricalObject(absent,renumbered,evidence,unexpected),'different');
  assert.equal(compareManagedHistoricalObject(absent,absent,evidence,unavailable),'unavailable');
  assert.equal(compareManagedVolumePlacement(renumbered,evidence,read),'same');
});

test('only completion of its durable creation intent may fill a checkpoint; target facts never evolve',()=>{
  const prior=managedFreshStepFixtures().journal,m=prior.migration;m.state='running';
  m.intent={requestDigest:'7'.repeat(64),expectedSequence:1,step:m.step!,effect:'intent',before:[m.fresh.directory],
    after:[{path:'/fixture/store',kind:'directory',object:null,digest:null}],captureBefore:m.capture,captureReviewSequence:null};
  parse(prior);
  const next=structuredClone(prior),n=next.migration;
  Object.assign(n,{sequence:2,state:'pending',lastCompleted:m.step,step:m.plan[2],intent:null});
  n.created.directory=observedFreshClaim('/fixture/store','directory');
  n.receipt={requestDigest:m.intent.requestDigest,expectedSequence:1,sequence:2,step:m.step,outcome:'applied'};
  parse(next);validateManagedFreshCreationChange(prior,next);
  const resumed=structuredClone(prior);resumed.migration.sequence=3;
  const reconciled=structuredClone(next);reconciled.migration.sequence=4;
  reconciled.migration.receipt={...n.receipt!,requestDigest:'9'.repeat(64),expectedSequence:3,sequence:4};
  validateManagedFreshCreationChange(resumed,reconciled);
  for(const change of [(j:ManagedFreshStepJournal)=>{j.migration.fresh.directory=j.migration.created.directory!;},
    (j:ManagedFreshStepJournal)=>{j.migration.receipt!.requestDigest='8'.repeat(64);},
    (j:ManagedFreshStepJournal)=>{j.migration.sequence=1;},(j:ManagedFreshStepJournal)=>{j.migration.created.database=observedFreshClaim(j.database,'file');}]){
    const bad=structuredClone(next);change(bad);assert.throws(()=>validateManagedFreshCreationChange(prior,bad),{code:'managed-step-conflict'});
  }
  const replaced=structuredClone(next);replaced.migration.created.directory!.object!.inode='99';
  assert.throws(()=>validateManagedFreshCreationChange(next,replaced),{code:'managed-step-conflict'});
});
