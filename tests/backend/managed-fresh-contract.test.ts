import {test} from 'node:test';
import assert from 'node:assert/strict';
import {managedFreshStepRequest,managedStepRequest,managedSetupStepRequest,managedFreshPlan} from '../../shared/managed-steps.ts';
import {managedFreshStepFixtures,observedFreshClaim} from '../fixtures/managed-fresh-steps.ts';
import {managedStepFixtures} from '../fixtures/managed-steps.ts';
import {parseManagedFreshStepJournal,parseManagedStepJournal,managedTargetDigest,managedRequestDigest,
  validateManagedFreshCreationChange,type ManagedFreshStepJournal} from '../../setup/managed-step-journal.ts';
import {canonical,digest} from '../../shared/store.ts';

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
  for(const change of [(j:ManagedFreshStepJournal)=>{j.migration.fresh.directory=j.migration.created.directory!;},
    (j:ManagedFreshStepJournal)=>{j.migration.receipt!.requestDigest='8'.repeat(64);},
    (j:ManagedFreshStepJournal)=>{j.migration.sequence=1;},(j:ManagedFreshStepJournal)=>{j.migration.created.database=observedFreshClaim(j.database,'file');}]){
    const bad=structuredClone(next);change(bad);assert.throws(()=>validateManagedFreshCreationChange(prior,bad),{code:'managed-step-conflict'});
  }
  const replaced=structuredClone(next);replaced.migration.created.directory!.object!.inode='99';
  assert.throws(()=>validateManagedFreshCreationChange(next,replaced),{code:'managed-step-conflict'});
});
