import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, deferred } from './subagent-test-support.ts';

const key={source:'source-alpha',parent:'A',message:'message',call:'call'};
const start={source:'source-alpha',child:'C1',id:'start',sequence:10,at:2000,state:'running' as const,errorType:null,interruptionReason:null};
const read=(f:any)=>f.store.subagentRuns({storeId:f.store.list().storeId,binding:{sourceId:f.source.id,verified:true},source:f.source.id,root:'A',plan:'plan-alpha',cleanupRev:0});
function fillProtectedParent(f:any,n=1023) {
  const template=String(f.store.db.prepare('SELECT payload FROM runs_rows ORDER BY rowid LIMIT 1').get()!.payload);
  f.store.db.prepare(`WITH RECURSIVE n(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<?)
    INSERT INTO runs_rows SELECT 'protected-'||i,'source-alpha','A',NULL,'protected-message','protected-call-'||i,0,0,10000,
    json_set(?,'$.id','protected-'||i,'$.parentSessionId','A','$.childSessionId',json('null'),'$.ran.state','unknown','$.ran.dispatchState','pending','$.ran.startedAt',json('null'),'$.ran.endedAt',json('null'),'$.claimed',json('null')) FROM n`).run(n,template);
}

test('review P1 unknown historical activity is protected at capacity, not assumed inactive',async()=>{
  await fixture(async f=>{
    const r={storeId:f.store.list().storeId,binding:{sourceId:f.source.id,verified:true},source:f.source.id,root:'A'};
    f.store.requestRunReconciliation(r);const job=f.store.claimRunRecovery(f.source.id,'A')!;
    f.store.publishRunHistory(job,{id:'C1',parent:'A',agent:null,title:null,createdAt:1000,updatedAt:2000,idleAt:null,outcome:null});f.store.finishRunRecovery(job,'complete');
    fillProtectedParent(f);f.store.beforeRun(key,f.actor(),'subagent',{},3000);
    assert.equal(f.store.db.prepare("SELECT count(*) n FROM runs_rows WHERE child='C1'").get()!.n,1);
    assert.equal(f.store.db.prepare("SELECT count(*) n FROM runs_rows WHERE call='call'").get()!.n,0);assert.equal(read(f).capture.loss,true);
  });
});

test('review P1 pruning a completed ancestor cannot disconnect a retained running descendant',async()=>{
  await fixture(async f=>{
    f.store.beforeRun(key,f.actor(),'subagent',{},1000);f.store.observeExecution(start);f.store.observeExecution({...start,id:'end',sequence:11,at:3000,state:'succeeded'});f.store.afterRun(key,0,f.actor('C1'),'returned');
    const nested={...key,parent:'C1',call:'nested'};f.store.beforeRun(nested,f.actor('C1'),'subagent',{},4000);
    f.store.afterRun(nested,0,{...f.actor('C1'),sessionId:'N1',parentId:'C1',ancestry:['C1','A']},'returned');f.store.observeExecution({...start,child:'N1',id:'nested-start',sequence:1,at:5000});
    const before=read(f);assert.equal(before.counts.running,1);fillProtectedParent(f);
    f.store.beforeRun({...key,call:'pressure'},f.actor(),'subagent',{},6000);
    const after=read(f);assert.equal(after.counts.running,1);assert.ok(after.data.some((r:any)=>r.childSessionId==='N1'&&r.ran.state==='running'));
    assert.equal(f.store.db.prepare("SELECT count(*) n FROM runs_rows WHERE call='pressure'").get()!.n,0);
  });
});

test('review P2 lookup saturation settles a declined reserved after-hook before reload',async()=>{
  await fixture(async f=>{
    for(const call of ['held-1','held-2'])await f.before(call,call);
    const declaration=f.request();f.declare(declaration);await f.before('reserved','reserved');
    const held=deferred<any>();let entered=0;const both=deferred();f.lookup(async id=>{if(id==='C1'){entered++;if(entered===2)both.resolve();return held.promise;}return f.records.get(id);});
    try {
      await f.after('held-1','held-1');await f.after('held-2','held-2');await both.promise;
      await f.after('reserved','reserved');
      assert.equal(f.declare(declaration).delegation.state,'retired');
      assert.equal(JSON.parse(String(f.store.db.prepare("SELECT payload FROM runs_rows WHERE call='reserved'").get()!.payload)).ran.dispatchState,'unconfirmed');
      await f.reload();assert.equal(f.declare(declaration).delegation.state,'retired');assert.equal(f.declare(f.request({oid:'next-declaration'})).delegation.state,'pending');
    }finally{held.resolve(f.records.get('C1'));await f.binding.settled();}
  });
});

test('review P1 redundant ancestry edges remain prunable but their last retained copy is protected',async()=>{
  await fixture(async f=>{
    for(const [call,at,sequence] of [['first',1000,10],['second',4000,12]] as const){
      const k={...key,call};f.store.beforeRun(k,f.actor(),'subagent',{},at);f.store.observeExecution({...start,id:`start-${call}`,at:at+100,sequence});f.store.observeExecution({...start,id:`end-${call}`,at:at+200,sequence:sequence+1,state:'succeeded'});f.store.afterRun(k,0,f.actor('C1'),'returned');
    }
    const nested={...key,parent:'C1',call:'nested'};f.store.beforeRun(nested,f.actor('C1'),'subagent',{},6000);f.store.afterRun(nested,0,{...f.actor('C1'),sessionId:'N1',parentId:'C1',ancestry:['C1','A']},'returned');f.store.observeExecution({...start,child:'N1',id:'nested-start',sequence:1,at:7000});
    fillProtectedParent(f,1022);f.store.beforeRun({...key,call:'admitted'},f.actor(),'subagent',{},8000);
    assert.equal(f.store.db.prepare("SELECT count(*) n FROM runs_rows WHERE parent='A' AND child='C1'").get()!.n,1);assert.equal(read(f).counts.running,1);
    f.store.beforeRun({...key,call:'declined'},f.actor(),'subagent',{},9000);assert.equal(f.store.db.prepare("SELECT count(*) n FROM runs_rows WHERE call='declined'").get()!.n,0);assert.equal(read(f).counts.running,1);
  });
});

test('review P2 resumed execution can claim once after its start candidate is adopted',async()=>{
  await fixture(async f=>{
    f.store.beforeRun(key,f.actor(),'subagent',{},1000);f.store.afterRun(key,0,f.actor('C1'),'returned');f.store.observeExecution(start);
    const first={op:'handoff',oid:'claim-first',summary:'First execution result',outcome:'done'};const receipt=f.store.handoff(first,f.actor('C1'),2500);
    f.store.observeExecution({...start,state:'succeeded',id:'end',sequence:11,at:3000});
    const second={...key,call:'resume',message:'resume-message'};f.store.beforeRun(second,f.actor(),'subagent',{},4000);f.store.afterRun(second,0,f.actor('C1'),'returned');f.store.observeExecution({...start,id:'resume-start',sequence:12,at:5000});
    assert.equal(f.store.db.prepare('SELECT count(*) n FROM runs_candidates').get()!.n,0);
    const claim={op:'handoff',oid:'claim-second',summary:'Second execution result',outcome:'partial'};
    assert.equal(f.store.handoff(claim,f.actor('C1'),5500).handoff.summary,claim.summary);
    assert.throws(()=>f.store.handoff({...claim,oid:'another'},f.actor('C1'),5501),/conflict/);
    assert.deepEqual(f.store.handoff(first,f.actor('C1'),5502),receipt);
  });
});

test('review privacy durable intent stores only caller IDs, not a duplicate Actor snapshot',async()=>{
  await fixture(async f=>{
    f.declare();const text=String(f.store.db.prepare('SELECT payload FROM runs_intents').get()!.payload);const payload=JSON.parse(text);
    assert.ok(!text.includes(f.actor().directory));assert.ok(!text.includes('directory'));assert.ok(!text.includes('projectId'));assert.ok(!text.includes('ancestry'));
    assert.deepEqual(payload.caller,{sourceId:f.source.id,sessionId:'A'});
    await f.reload();await f.complete();assert.equal(f.plan().revision,2);assert.equal(f.plan().items[0]!.assigneeSessionId,'C1');
  });
});

test('review privacy binding revalidates caller IDs against the existing identity owner',async()=>{
  await fixture(async f=>{
    const r=f.request();f.declare(r);f.store.beforeRun(key,f.actor(),'subagent',{},1000);
    f.store.db.prepare('UPDATE sessions SET actor=? WHERE source=? AND id=?').run(JSON.stringify({...f.actor(),sourceId:'different-source'}),f.source.id,'A');
    f.store.afterRun(key,0,f.actor('C1'),'returned');assert.equal(f.plan().revision,1);assert.equal(f.declare(r).delegation.state,'retired');assert.equal(f.store.db.prepare('SELECT count(*) n FROM runs_intents').get()!.n,0);
  });
});

test('hint-only capture cannot rewrite reported identity and silently change directory-filtered plans',async()=>{
  await fixture(async f=>{
    const directory='/synthetic/moved';const before=f.store.list({directory});const detail=f.store.detail(f.source.id,'plan-alpha');
    const identities=f.store.db.prepare('SELECT * FROM sessions ORDER BY source,id').all();
    f.store.beforeRun(key,{...f.actor(),directory,agent:'different-native-agent'},'subagent',{},1000);
    assert.deepEqual(f.store.list({directory}),before);assert.deepEqual(f.store.detail(f.source.id,'plan-alpha'),detail);assert.deepEqual(f.store.db.prepare('SELECT * FROM sessions ORDER BY source,id').all(),identities);
  });
});

test('hint-only identity insertion cannot repair a missing reported participant and grant directory visibility',async()=>{
  await fixture(async f=>{
    const other=f.actor('B');other.directory='/synthetic/other';f.seed('other-plan','B');
    // Synthetic legacy state: the participant was explicitly linked in another
    // directory, but its canonical identity row is missing. Capture is not a report.
    f.store.apply({op:'link',plan:'other-plan',oid:'link',rev:1,child:'C1',assign:['task-1']},other,undefined,{...f.actor('C1'),directory:other.directory,ancestry:['A','B']});
    f.store.db.prepare('DELETE FROM sessions WHERE source=? AND id=?').run(f.source.id,'C1');
    const before=f.store.list({source:f.source.id,directory:'/synthetic/alpha'});const detail=f.store.detail(f.source.id,'other-plan');
    f.store.beforeRun(key,f.actor(),'subagent',{},1000);f.store.afterRun(key,0,f.actor('C1'),'returned');
    assert.deepEqual(f.store.list({source:f.source.id,directory:'/synthetic/alpha'}),before);assert.deepEqual(f.store.detail(f.source.id,'other-plan'),detail);assert.equal(f.store.db.prepare("SELECT count(*) n FROM sessions WHERE id='C1'").get()!.n,0);
  });
});
