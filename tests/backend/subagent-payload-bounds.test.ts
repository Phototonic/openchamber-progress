import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RUN_LIMITS } from '../../shared/subagent-runs.ts';
import { fixture } from './subagent-test-support.ts';

const key={source:'source-alpha',parent:'A',message:'message',call:'call'};
const start={source:'source-alpha',child:'C1',id:'start',sequence:10,at:2000,state:'running' as const,errorType:null,interruptionReason:null};
const end={...start,id:'terminal-with-a-longer-event-identity',sequence:20,at:3000,state:'succeeded' as const};
const bytes=(value:unknown)=>Buffer.byteLength(JSON.stringify(value));
const stored=(f:any)=>JSON.parse(String(f.store.db.prepare('SELECT payload FROM runs_rows WHERE call=?').get(key.call).payload));
const put=(f:any,value:any)=>f.store.db.prepare('UPDATE runs_rows SET payload=? WHERE call=?').run(JSON.stringify(value),key.call);
const read=(f:any)=>f.store.subagentRuns({storeId:f.store.list().storeId,binding:{sourceId:f.source.id,verified:true},source:f.source.id,root:'A',plan:'plan-alpha',cleanupRev:0});
function fillRow(value:any,target:number=RUN_LIMITS.dtoBytes) {
  value.description='';value.accepted={plan:'plan-alpha',revision:1,items:[],omittedItems:0};
  while(target-bytes(value)>200){
    const id=`padding-${value.accepted.items.length}-`.padEnd(80,'x');
    value.accepted.items.push({id,status:'pending'});
  }
  value.description='x'.repeat(target-bytes(value));assert.equal(bytes(value),target);
  return value;
}
function dispatch(f:any,observe=true) {
  f.store.beforeRun(key,f.actor(),'subagent',{},1000);f.store.afterRun(key,0,f.actor('C1'),'returned');
  if(observe)f.store.observeExecution(start);
}

test('payload-bound refresh admission at 4096 bytes can be claimed and settled without a retry loop',async()=>{
  for(const legacy of [false,true])await fixture(async f=>{
    dispatch(f);await f.reload();
    const terminal={...end,id:'post-restart-terminal',sequence:40,at:6000};
    f.store.observeExecution(terminal);
    const value=stored(f),marker=value._refresh;delete value._refresh;
    const growth=bytes({...value,_refresh:marker})-bytes(value);
    put(f,fillRow(value,RUN_LIMITS.dtoBytes-growth));
    f.store.observeExecution(terminal);
    assert.equal(bytes(stored(f)),RUN_LIMITS.dtoBytes,'exercise the actual admission boundary');
    if(legacy){const old=stored(f);old._refresh[1]=true;put(f,fillRow(old));}
    assert.equal(read(f).recovery.state,'pending');
    const job=f.store.claimRunRecovery(f.source.id,'A');assert.ok(job,'the marker transition must not exceed the row limit');
    assert.equal(stored(f)._refresh[1],0);assert.ok(bytes(stored(f))<=RUN_LIMITS.dtoBytes);
    f.store.finishRunRecovery(job,'complete');
    assert.equal(read(f).recovery.state,'complete');assert.equal(f.store.claimRunRecovery(f.source.id,'A'),null);
  });
});

test('payload-bound epoch overflow drops continuity proof without losing authored claims or retirement fences',async()=>{
  await fixture(async f=>{
    const source={...f.source,id:'s'.repeat(80),configRoot:`${f.source.configRoot}/sized`,dataRoot:`${f.source.dataRoot}/sized`},rootId='a'.repeat(80),childId='c'.repeat(80),plan='p'.repeat(80);
    f.store.registerSource(source);f.store.bindReads(source.id,true);
    const root={...f.actor(),sourceId:source.id,sessionId:rootId,parentId:null,ancestry:[]};
    const child={...root,sessionId:childId,parentId:rootId,ancestry:[rootId]};
    f.store.apply({op:'start',plan,oid:'seed',rev:0,title:'Synthetic plan',items:[{id:'task',title:'Task',kind:'task'}]},root);
    const dispatchKey={source:source.id,parent:rootId,message:'m'.repeat(80),call:'k'.repeat(80)},n=Number.MAX_SAFE_INTEGER;
    f.store.beforeRun(dispatchKey,root,'subagent',{},n-2);f.store.afterRun(dispatchKey,0,child,'returned');
    const observed={source:source.id,child:childId,id:'e'.repeat(80),sequence:n-2,at:n-1,state:'running' as const,errorType:null,interruptionReason:null};
    f.store.observeExecution(observed);
    const report={op:'handoff',oid:'q'.repeat(80),summary:'\ud800'.repeat(200),outcome:'partial'};
    f.store.handoff(report,child,n-1);
    const terminal={...observed,id:'t'.repeat(80),sequence:n-1,at:n,state:'failed' as const,errorType:'E'.repeat(80)};
    f.store.observeExecution(terminal);
    const load=()=>JSON.parse(String(f.store.db.prepare('SELECT payload FROM runs_rows WHERE call=?').get(dispatchKey.call)!.payload));
    const value=load(),epoch=value._epoch,high=n-1000;
    value.agent=null;value.description=null;value.accepted=null;
    value._retiredClaim=['r'.repeat(80),'f'.repeat(64)];value._refresh=[n,0];
    value._startEpochs=[epoch,...Array.from({length:31},(_,i)=>high+i)];value._endEpochs=[epoch];
    while(value._endEpochs.length<32&&bytes({...value,_endEpochs:[...value._endEpochs,high+value._endEpochs.length]})<=RUN_LIMITS.dtoBytes)value._endEpochs.push(high+value._endEpochs.length);
    assert.ok(value._endEpochs.length<32,'one more valid epoch exercises the byte budget, not the count cap');
    const next=high+value._endEpochs.length;
    f.store.db.prepare('UPDATE runs_rows SET payload=? WHERE call=?').run(JSON.stringify(value),dispatchKey.call);
    f.store.db.prepare('UPDATE runs_observation_epoch SET epoch=?').run(high+100);
    f.store.observeExecution(terminal,next);
    const result=load();assert.equal(result.ran.state,'failed');assert.equal(result.claimed.summary,report.summary);
    assert.deepEqual(result._retiredClaim,value._retiredClaim);assert.deepEqual(result._startEvent,value._startEvent);
    assert.equal(result._epoch,epoch);assert.ok(bytes(result)<=RUN_LIMITS.dtoBytes);
    assert.ok(result._startEpochs.some((epoch:number)=>result._claimEpochs.includes(epoch)),'an execution claim retains minimum continuity proof');assert.deepEqual(result._endEpochs,[]);
    const response=f.store.subagentRuns({storeId:f.store.list().storeId,binding:{sourceId:source.id,verified:true},source:source.id,root:rootId,plan,cleanupRev:0});
    assert.equal(response.capture.loss,true);
  });
});

for(const phase of ['start','epoch','terminal'] as const)test(`payload-bound ${phase} metadata growth drops optional data instead of aborting the observation`,async()=>{
  await fixture(async f=>{
    dispatch(f,phase!=='start');const epoch=stored(f)._epoch;
    put(f,fillRow(stored(f)));
    if(phase==='start')f.store.observeExecution(start);
    else if(phase==='epoch')f.store.observeExecution(start,f.store.beginRunObservation());
    else f.store.observeExecution(end);
    const value=stored(f),result=read(f);
    assert.equal(value.ran.state,phase==='terminal'?'succeeded':'running');
    assert.equal(value.ran.endedAt,phase==='terminal'?3000:null);
    assert.equal(value._epoch,epoch,'the dispatch epoch is immutable');
    assert.deepEqual(value._startEvent,[start.id,start.sequence],'start identity is not dropped to make room');
    assert.ok(bytes(value)<=RUN_LIMITS.dtoBytes);assert.equal(result.capture.loss,true);
  });
});

test('payload-bound claim retirement preserves its retry fence while a larger terminal still applies',async()=>{
  await fixture(async f=>{
    dispatch(f);
    const report={op:'handoff',oid:'retired-report',summary:'Synthetic claim',outcome:'partial'};
    const claim=f.store.handoff(report,f.actor('C1'),4000).handoff;
    put(f,fillRow(stored(f)));
    f.store.db.prepare(`WITH RECURSIVE n(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<256)
      INSERT INTO runs_claims SELECT 'source-alpha','staged-'||i,0,'staged-'||i,'synthetic',
      json_set(?,'$.oid','staged-'||i,'$.sessionId','staged-'||i,'$.association','session-only') FROM n`).run(JSON.stringify(claim));
    f.store.observeExecution({...end,id:'e'.repeat(80),errorType:null});
    const value=stored(f);assert.equal(value.ran.state,'succeeded');assert.equal(value.claimed,null);
    assert.equal(value._retiredClaim[0],report.oid);assert.ok(bytes(value)<=RUN_LIMITS.dtoBytes);
    assert.equal(read(f).capture.loss,true);
    assert.throws(()=>f.store.handoff(report,f.actor('C1'),7000),/not-found/);
    assert.throws(()=>f.store.handoff({...report,summary:'Changed claim'},f.actor('C1'),7000),/operation-reused/);
  });
});

test('payload-bound candidate refinement drops oversized displaced evidence instead of rolling back forever',async()=>{
  await fixture(async f=>{
    dispatch(f);f.store.observeExecution({...end,id:'early-resumed-end',sequence:40,at:6000});
    const epoch=f.store.runObservationEpoch(),resumed={...start,id:'resumed-start',sequence:30,at:5000};
    const evidence=Object.fromEntries(Array.from({length:5},(_,i)=>{
      const id=`padding-${i}-`.padEnd(80,'x');
      return [id,{event:{...start,id,sequence:i+1,at:1},epochs:Array.from({length:32},(_,j)=>9007199254700000+j),ambiguous:false}];
    }));
    const candidate={start:null,end:null,startEvidence:evidence,ambiguous:false};
    const added=bytes({...candidate,start:resumed,startEpochs:[epoch]})-bytes(candidate);
    const target=RUN_LIMITS.dtoBytes-added-8;
    for(const value of Object.values(evidence))for(let i=0;i<value.epochs.length&&bytes(candidate)>target;i++){
      const digits=16-Math.min(13,bytes(candidate)-target);value.epochs[i]=Number('1'.repeat(digits))+i;
    }
    assert.equal(bytes(candidate),target);
    f.store.db.prepare('INSERT INTO runs_candidates VALUES(?,?,?,?)').run(f.source.id,'C1',0,JSON.stringify(candidate));
    f.store.observeExecution(resumed);
    assert.equal(stored(f).ran.state,'running','interval refinement commits despite lost displaced staging');
    assert.equal(stored(f).ran.endedAt,null);assert.equal(read(f).capture.loss,true);
    assert.equal(f.store.db.prepare('SELECT 1 FROM runs_candidates WHERE child=?').get('C1'),undefined);
  });
});
