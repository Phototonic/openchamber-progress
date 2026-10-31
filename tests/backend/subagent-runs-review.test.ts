import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../../shared/store.ts';
import type { RunRow } from '../../shared/subagent-runs.ts';
import { fixture, deferred } from './subagent-test-support.ts';

const key={source:'source-alpha',parent:'A',message:'message',call:'call'};
const start={source:'source-alpha',child:'C1',id:'start',sequence:10,at:2000,state:'running' as const,errorType:null,interruptionReason:null};
const read=(f:any)=>f.store.subagentRuns({storeId:f.store.list().storeId,binding:{sourceId:f.source.id,verified:true},source:f.source.id,root:'A',plan:'plan-alpha',cleanupRev:0});

test('review a proven execution completes while a later dispatch remains pending',async()=>{
  for(const adopted of [true,false])await fixture(async f=>{
    f.store.beforeRun(key,f.actor(),'subagent',{},1000);
    if(adopted)f.store.afterRun(key,0,f.actor('C1'),'returned');
    f.store.observeExecution(start);
    if(adopted)assert.equal(read(f).data[0]!.ran.state,'running');
    const later={...key,message:'later-message',call:'later-call'};
    f.store.beforeRun(later,f.actor(),'subagent',{},2500);
    f.store.observeExecution({...start,id:'end',sequence:11,at:3000,state:'succeeded'});
    if(!adopted)f.store.afterRun(key,0,f.actor('C1'),'returned');
    const result=read(f),completed=result.data.find((r:RunRow)=>r.childSessionId==='C1')!;
    assert.equal(completed.ran.state,'succeeded');assert.equal(completed.ran.startedAt,2000);assert.equal(completed.ran.endedAt,3000);
    assert.equal(result.data.find((r:RunRow)=>r.dispatch?.callId==='later-call')!.ran.dispatchState,'pending','no later callback is needed to finish the proven execution');
  });
});

test('review large valid accumulated snapshots still project accepted tasks',async()=>{
  await fixture(async f=>{
    const plan='large-plan',items=Array.from({length:350},(_,i)=>({id:`task-${i}`,title:'Task',kind:'task' as const}));
    for(let chunk=0;chunk<7;chunk++)f.store.apply({op:'stage',plan,oid:`large-stage-${chunk}`,rev:0,upload:'large-upload',chunk,items:items.slice(chunk*50,(chunk+1)*50)},f.actor());
    f.store.apply({op:'commit',plan,oid:'large-start',rev:0,title:'Large plan',upload:'large-upload',chunks:7},f.actor());
    let rev=1;
    for(let offset=0;offset<items.length;offset+=4){
      f.store.apply({op:'change',plan,oid:`block-${offset}`,rev,changes:items.slice(offset,offset+4).map(i=>({id:i.id,status:'blocked',blocker:{reason:'界'.repeat(512),nextAction:'界'.repeat(512)}}))},f.actor());rev++;
    }
    assert.ok(Number(f.store.db.prepare('SELECT length(CAST(snapshot AS BLOB)) n FROM plans WHERE id=?').get(plan)!.n)>1048576);
    const request={storeId:f.store.list().storeId,binding:{sourceId:f.source.id,verified:true},source:f.source.id,root:'A',plan,cleanupRev:0};
    assert.deepEqual(f.store.subagentRuns(request).data,[],'valid empty plan-scoped run reads must succeed');
    f.store.apply({op:'link',plan,oid:'large-link',rev,child:'C1',assign:['task-0']},f.actor(),undefined,f.actor('C1'));rev++;
    f.store.beforeRun(key,f.actor(),'subagent',{},1000);f.store.afterRun(key,0,f.actor('C1'),'returned');
    const run=f.store.subagentRuns(request).data[0]!;
    assert.deepEqual(run.accepted,{plan,revision:rev,items:[{id:'task-0',status:'blocked'}],omittedItems:0});
  });
});

test('review unrelated execution candidates cannot permanently starve verified children across reopen',async()=>{
  await fixture(async f=>{
    // The oldest slot belongs to an unresolved verified dispatch and must not
    // be reclaimed in preference to unrelated observations.
    const protectedKey={...key,call:'protected'};
    f.store.beforeRun(protectedKey,f.actor(),'subagent',{},1000);f.store.afterRun(protectedKey,0,f.actor('C2'),'returned');
    f.store.observeExecution({...start,child:'C2'});f.store.observeExecution({...start,child:'C2',id:'ambiguous-start',sequence:12,at:2100});
    for(let i=0;i<256;i++)f.store.observeExecution({...start,child:`unassociated-${i}`,id:`unassociated-start-${i}`});
    const file=f.store.file;
    const reopened=new Store(file);reopened.bindReads(f.source.id,true);
    try{
      // Keep the start-before-dispatch race: both events precede even the before hook.
      reopened.observeExecution(start);reopened.observeExecution({...start,id:'end',sequence:11,at:3000,state:'succeeded'});
      reopened.beforeRun(key,f.actor(),'subagent',{},1000);reopened.afterRun(key,0,f.actor('C1'),'returned');
      const run=read({...f,store:reopened}).data.find((r:RunRow)=>r.childSessionId==='C1')!;assert.equal(run.ran.state,'succeeded');assert.equal(run.ran.startedAt,2000);assert.equal(run.ran.endedAt,3000);
      assert.ok(Number(reopened.db.prepare('SELECT count(*) n FROM runs_candidates').get()!.n)<=256);
      assert.ok(reopened.db.prepare("SELECT 1 FROM runs_candidates WHERE child='C2'").get(),'unresolved verified candidate remains protected');
      assert.equal(read({...f,store:reopened}).capture.loss,true,'reclaimed observations must disclose capture loss');
    }finally{reopened.close();}
  });
});

test('review 320 verified root executions do not cause capture loss before a real child outcome',async()=>{
  await fixture(async f=>{
    for(let i=0;i<320;i++){
      const id=`root-${i}`,at=10000+i*60000;
      const actor={...f.actor(),sessionId:id};
      // Native before-hook identity is persisted by the production capture path.
      f.store.beforeRun({...key,parent:id,call:`root-call-${i}`},actor,'task',{},at);
      f.store.observeExecution({...start,child:id,id:`root-start-${i}`,at,sequence:1});
      f.store.observeExecution({...start,child:id,id:`root-end-${i}`,at:at+1000,sequence:2,state:'succeeded'});
    }
    f.store.beforeRun(key,f.actor(),'subagent',{},20000000);
    f.store.observeExecution({...start,at:20000001});f.store.observeExecution({...start,id:'end',sequence:11,at:20000002,state:'succeeded'});
    f.store.afterRun(key,0,f.actor('C1'),'returned');
    const result=read(f);assert.equal(result.data[0]!.ran.state,'succeeded');
    assert.equal(result.capture.loss,false,'normal verified root activity must not latch capture loss');
    assert.equal(f.store.db.prepare('SELECT count(*) n FROM runs_candidates').get()!.n,0);
  });
});

test('review legacy root candidates are reclaimed silently before possibly adoptable candidates',async()=>{
  await fixture(async f=>{
    // Model candidates persisted by the earlier producer: put the known root
    // last so silent reclamation must prefer it, not just take the oldest slot.
    f.store.db.prepare(`WITH RECURSIVE n(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<256)
      INSERT INTO runs_candidates SELECT 'source-alpha',CASE WHEN i=256 THEN 'A' ELSE 'unassociated-'||i END,0,
      json_object('start',json(json_set(?,'$.child',CASE WHEN i=256 THEN 'A' ELSE 'unassociated-'||i END)),'end',NULL) FROM n`).run(JSON.stringify(start));
    f.store.observeExecution(start);f.store.observeExecution({...start,id:'end',sequence:11,at:3000,state:'succeeded'});
    f.store.beforeRun(key,f.actor(),'subagent',{},1000);f.store.afterRun(key,0,f.actor('C1'),'returned');
    const result=read(f);assert.equal(result.data[0]!.ran.state,'succeeded');assert.equal(result.capture.loss,false);
    assert.equal(f.store.db.prepare("SELECT count(*) n FROM runs_candidates WHERE child GLOB 'unassociated-*'").get()!.n,255);
  });
});

test('review 320 completed unknown roots expire silently before a verified child outcome',async()=>{
  await fixture(async f=>{
    const window=5*60*1000,step=window+2000;
    for(let i=0;i<320;i++){
      const child=`unknown-root-${i}`,at=1000+i*step;
      f.store.observeExecution({...start,child,id:`unknown-start-${i}`,at,sequence:1});
      f.store.observeExecution({...start,child,id:`unknown-end-${i}`,at:at+1000,sequence:2,state:'succeeded'});
    }
    assert.equal(f.store.db.prepare("SELECT count(*) n FROM sessions WHERE id GLOB 'unknown-root-*'").get()!.n,0);
    const at=1000+321*step;
    f.store.beforeRun(key,f.actor(),'subagent',{},at);
    f.store.observeExecution({...start,at:at+1});f.store.observeExecution({...start,id:'end',sequence:11,at:at+2,state:'succeeded'});
    f.store.afterRun(key,0,f.actor('C1'),'returned');
    const result=read(f);assert.equal(result.data[0]!.ran.state,'succeeded');assert.equal(result.capture.loss,false);
    assert.ok(Number(f.store.db.prepare('SELECT count(*) n FROM runs_candidates').get()!.n)<=256);
  });
});

test('review terminal expiry prefers stale victims but fresh terminals and start-only eviction still disclose loss',async()=>{
  for(const kind of ['stale','fresh','start-only'] as const)await fixture(async f=>{
    const at=1000000,window=5*60*1000;
    // Put the terminal last: stale reclamation must prefer it over older starts.
    // At the exact window boundary the terminal remains fresh.
    const end={...start,id:'end',sequence:11,state:'succeeded',at:kind==='stale'?at-window-1:at-window};
    f.store.db.prepare(`WITH RECURSIVE n(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<256)
      INSERT INTO runs_candidates SELECT 'source-alpha','unassociated-'||i,0,
      json_object('start',json(json_set(?,'$.child','unassociated-'||i)),
        'end',CASE WHEN ?='fresh' OR (i=256 AND ?='stale') THEN json(json_set(?,'$.child','unassociated-'||i)) ELSE NULL END) FROM n`).run(JSON.stringify(start),kind,kind,JSON.stringify(end));
    f.store.observeExecution({...start,at});
    assert.equal(read(f).capture.loss,kind!=='stale');
    const victim=kind==='stale'?'unassociated-256':'unassociated-1';
    assert.equal(f.store.db.prepare('SELECT count(*) n FROM runs_candidates WHERE child=?').get(victim)!.n,0);
  });
});

test('review unknown historical summaries do not compete with resumed dispatch execution',async()=>{
  for(const early of [false,true]){
  await fixture(async f=>{
    const request={storeId:f.store.list().storeId,binding:{sourceId:f.source.id,verified:true},source:f.source.id,root:'A'};
    f.store.requestRunReconciliation(request);const job=f.store.claimRunRecovery(f.source.id,'A')!;
    f.store.publishRunHistory(job,{id:'C1',parent:'A',agent:null,title:null,createdAt:100,updatedAt:200,idleAt:null,outcome:null});f.store.finishRunRecovery(job,'complete');
    f.store.beforeRun(key,f.actor(),'subagent',{},1000);
    const execution=()=>{f.store.observeExecution(start);f.store.observeExecution({...start,id:'end',sequence:11,at:3000,state:'succeeded'});};
    if(early)execution();f.store.afterRun(key,0,f.actor('C1'),'returned');if(!early)execution();
    const result=read(f);assert.equal(result.data.find((r:RunRow)=>r.kind==='dispatch')!.ran.state,'succeeded');
    assert.equal(result.counts.runs,1);assert.equal(result.counts.historicalSessions,1);assert.equal(result.counts.children,1);assert.equal(result.counts.succeeded,1);assert.equal(result.counts.unknown,1);
    const history=f.store.subagentRuns({...request,view:'history'}).data.find(r=>r.kind==='historical-session')!;
    assert.equal(history.ran.state,'unknown','a later execution does not certify old session history');
  });
  }
});
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
