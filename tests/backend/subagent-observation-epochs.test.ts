import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { Store } from '../../shared/store.ts';
import { createRunCapture } from '../../plugin/subagent-runs.ts';
import { fixture } from './subagent-test-support.ts';

const key={source:'source-alpha',parent:'A',message:'message',call:'call'};
const start={source:'source-alpha',child:'C1',id:'start',sequence:10,at:2000,state:'running' as const,errorType:null,interruptionReason:null};
const terminal={...start,id:'resumed-end',sequence:40,at:6000,state:'failed' as const,errorType:'SyntheticError'};
const read=(f:any,view:'useful'|'history'='useful')=>f.store.subagentRuns({storeId:f.store.list().storeId,binding:{sourceId:f.source.id,verified:true},source:f.source.id,root:'A',plan:'plan-alpha',cleanupRev:0,view});
const seed=(f:any)=>{f.store.beforeRun(key,f.actor(),'subagent',{},1000);f.store.afterRun(key,0,f.actor('C1'),'returned');f.store.observeExecution(start);};

test('observation restart gap cannot route a resumed terminal to the retained start',async()=>{
  await fixture(async f=>{
    seed(f);const generation=f.store.runControl().generation;
    // End20 and resume30 occur while this companion is absent.
    await f.reload();assert.equal(f.store.runControl().generation,generation);
    await f.emit('execution.failed',{sessionID:'C1',error:{type:'SyntheticError'}},{id:terminal.id,created:6000,durable:{aggregateID:'C1',seq:40}});
    const result=read(f),run=result.data[0]!;
    assert.equal(run.ran.state,'unknown');assert.equal(run.ran.startedAt,2000);assert.equal(run.ran.endedAt,null);
    assert.equal(run.ran.eventId,'start');assert.equal(run.ran.errorType,null);assert.equal(result.capture.loss,true);
    const reopened=new Store(f.store.file);reopened.bindReads(f.source.id,true);
    try{reopened.observeExecution(terminal);assert.equal(read({...f,store:reopened}).data[0]!.ran.state,'unknown');}finally{reopened.close();}
  });
});

test('observation subscription loss fences terminals even without a capture toggle or reload',async()=>{
  await fixture(async f=>{
    seed(f);const generation=f.store.runControl().generation;
    f.events.error=true;f.events.close();
    const deadline=performance.now()+1000;
    while(!read(f).capture.loss&&performance.now()<deadline)await setImmediate();
    assert.equal(read(f).capture.loss,true,'wait for the subscription failure handler');
    assert.equal(f.store.runControl().generation,generation);
    f.store.observeExecution(terminal);
    assert.equal(read(f).data[0]!.ran.state,'unknown');assert.equal(read(f).data[0]!.ran.endedAt,null);
  });
});

test('observation restart and subscription loss recover the latest outcome through metadata history only',async()=>{
  for(const gap of ['restart','subscription'])await fixture(async f=>{
    seed(f);
    if(gap==='restart'){
      await f.reload();
      await f.emit('execution.failed',{sessionID:'C1',error:{type:'SyntheticError'}},{id:terminal.id,created:6000,durable:{aggregateID:'C1',seq:40}});
    }else{
      f.events.error=true;f.events.close();const deadline=performance.now()+1000;
      while(!read(f).capture.loss&&performance.now()<deadline)await setImmediate();
      assert.equal(read(f).capture.loss,true);f.store.observeExecution(terminal);
    }
    assert.equal(read(f).data[0]!.ran.state,'unknown');
    let calls=0;
    f.ctx.session.context=()=>{throw Error('Transcript forbidden');};f.ctx.message={list:()=>{throw Error('Transcript forbidden');}};
    f.ctx.session.list=async(input:any)=>{calls++;return {data:input.parentID==='A'?[{...f.records.get('C1'),time:{created:1000,updated:6000,idle:6000},outcome:'failed'}]:[],cursor:{next:null}};};
    await f.binding.drainRuns();
    const history=read(f,'history').data.find((r:any)=>r.kind==='historical-session');
    assert.ok(history);assert.equal(history.ran.state,'failed');assert.equal(history.ran.endedAt,6000);
    assert.equal(history.ran.provenance,'native-session');assert.equal(history.ran.eventId,null);
    assert.equal(read(f).data.find((r:any)=>r.kind==='dispatch').ran.state,'unknown','session history cannot certify the original execution');
    const before=calls;await f.binding.drainRuns();assert.equal(calls,before,'no automatic retry loop');
  });
});

test('observation recovery refreshes an older unknown historical summary from reliable newer metadata',async()=>{
  await fixture(async f=>{
    const request={storeId:f.store.list().storeId,binding:{sourceId:f.source.id,verified:true},source:f.source.id,root:'A'};
    f.store.requestRunReconciliation(request);const first=f.store.claimRunRecovery(f.source.id,'A')!;
    f.store.publishRunHistory(first,{id:'C1',parent:'A',agent:null,title:null,createdAt:1000,updatedAt:1500,idleAt:null,outcome:null});
    f.store.publishRunHistory(first,{id:'C1',parent:'A',agent:null,title:null,createdAt:1000,updatedAt:3000,idleAt:5000,outcome:'succeeded'});
    assert.equal(read(f,'history').data[0]!.ran.state,'unknown','a future idle is not a reliable historical outcome');
    f.store.saveRunRecoveryWork(first,{queue:[],seen:['A','C1']});
    f.store.finishRunRecovery(first,'partial');
    seed(f);
    await f.reload();
    f.ctx.session.list=async(input:any)=>({data:input.parentID==='A'?[{...f.records.get('C1'),time:{created:1000,updated:6000,idle:6000},outcome:'failed'}]:[],cursor:{next:null}});
    await f.binding.drainRuns();
    const history=read(f,'history').data.find((r:any)=>r.kind==='historical-session');
    assert.ok(history);assert.equal(history.ran.state,'failed');assert.equal(history.ran.endedAt,6000);assert.equal(history.ran.provenance,'native-session');
  });
});

test('observation staged starts retain their epoch when identity arrives after subscription loss',async()=>{
  await fixture(async f=>{
    f.store.beforeRun(key,f.actor(),'subagent',{},1000);f.store.observeExecution(start);
    f.store.runCaptureUnavailable();f.store.afterRun(key,0,f.actor('C1'),'returned');
    assert.equal(read(f).data[0]!.ran.state,'running','the old observed start remains valid evidence');
    f.store.observeExecution(terminal);
    assert.equal(read(f).data[0]!.ran.state,'unknown');assert.equal(read(f).data[0]!.ran.endedAt,null);
  });
});

test('observation restart preserves strict contiguity but never adopts an unseen old dispatch start',async()=>{
  for(const proven of [false,true])await fixture(async f=>{
    f.store.beforeRun(key,f.actor(),'subagent',{},1000);f.store.afterRun(key,0,f.actor('C1'),'returned');
    if(proven)f.store.observeExecution(start);
    const epoch=f.store.runObservationEpoch();await f.reload();assert.ok(f.store.runObservationEpoch()>epoch);
    if(proven)f.store.observeExecution({...terminal,id:'contiguous-end',sequence:11});
    else {f.store.observeExecution({...start,id:'new-start',sequence:30});f.store.observeExecution(terminal);}
    assert.equal(read(f).data[0]!.ran.state,proven?'failed':'unknown');
    assert.equal(read(f).data[0]!.ran.endedAt,proven?6000:null);
  });
});

test('observation tokens isolate simultaneous observers without invalidating an unbroken stream',async()=>{
  await fixture(async f=>{
    const options={store:f.store,sourceId:f.source.id,identity:async(id:string)=>f.actor(id),now:()=>1000};
    const first=createRunCapture(f.ctx,options),other=createRunCapture(f.ctx,options);
    try{
      const hook={id:key.call,messageID:key.message,sessionID:'A',tool:'subagent'};
      await first.before(hook);first.after({...hook,status:'completed',result:{output:{sessionID:'C1',status:'completed'}}});await first.settled();
      const event=(e:typeof start|typeof terminal)=>({type:`session.execution.${e.state==='running'?'started':e.state}`,id:e.id,created:e.at,durable:{aggregateID:'C1',seq:e.sequence},data:{sessionID:'C1',error:{type:e.errorType}}});
      first.event(event(start));first.event(event(terminal));
      assert.equal(read(f).data[0]!.ran.state,'failed');assert.equal(read(f).capture.loss,false);
    }finally{first.dispose();other.dispose();}
  });
});

test('observation explicit activation upgrades only the exact previous extension and fences epochless starts',async()=>{
  await fixture(async f=>{
    seed(f);await f.restart();
    const trigger=String(f.store.db.prepare("SELECT sql FROM sqlite_master WHERE name='runs_capture_epoch'").get()!.sql).replace(' UPDATE runs_observation_epoch SET invalid_through=epoch,epoch=epoch+1 WHERE singleton=1;','');
    f.store.db.exec('DROP TRIGGER runs_capture_epoch; DROP TABLE runs_observation_epoch');f.store.db.exec(trigger);
    f.store.db.exec("UPDATE runs_rows SET payload=json_remove(payload,'$._epoch')");
    f.store.installSubagentRuns();f.store.beginRunObservation();f.store.observeExecution(terminal);
    assert.equal(read(f).data[0]!.ran.state,'unknown');assert.equal(read(f).capture.loss,true);
  });
});

test('observation candidate admission loss also breaks continuity before the next live terminal',async()=>{
  await fixture(async f=>{
    seed(f);
    const payload=f.store.db.prepare('SELECT payload FROM runs_rows WHERE call=?').get(key.call)!.payload;
    f.store.db.prepare(`WITH RECURSIVE n(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<256)
      INSERT INTO runs_rows SELECT 'protected-'||i,'source-alpha','A','protected-child-'||i,'message','protected-'||i,0,0,1000,
      json_set(?,'$.id','protected-'||i,'$.childSessionId','protected-child-'||i,'$.dispatch.callId','protected-'||i) FROM n`).run(payload);
    f.store.db.prepare(`INSERT INTO runs_candidates SELECT source,child,generation,
      json_object('start',json_set(?,'$.child',child),'end',NULL,'startEpoch',?,'ambiguous',json('false')) FROM runs_rows WHERE id LIKE 'protected-%'`).run(JSON.stringify(start),f.store.runObservationEpoch());
    // All staging slots are protected; losing the observed resume must not make
    // the subsequent terminal look like uninterrupted observation of A.
    await f.emit('execution.started',{sessionID:'C1'},{id:'declined-resume',created:5000,durable:{aggregateID:'C1',seq:30}});
    await f.emit('execution.failed',{sessionID:'C1',error:{type:'SyntheticError'}},{id:terminal.id,created:6000,durable:{aggregateID:'C1',seq:40}});
    const original=read(f).data.find((r:any)=>r.dispatch?.callId===key.call);
    // The response page may be occupied by other retained running facts.
    const stored=JSON.parse(String(f.store.db.prepare('SELECT payload FROM runs_rows WHERE call=?').get(key.call)!.payload));
    assert.equal(stored.ran.state,'unknown');assert.equal(stored.ran.endedAt,null);
    assert.equal(read(f).capture.loss,true);if(original)assert.equal(original.ran.state,'unknown');
  });
});
