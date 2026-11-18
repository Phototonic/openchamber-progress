import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanupFixture } from '../fixtures/cleanup.ts';
import { delegationView } from '../../service/delegation-view.ts';

test('archive then restore before dispatch cannot revive an unreserved delegation',()=>{
  const f=cleanupFixture();
  try{
    f.store.bindReads(f.source.id,true);f.store.installSubagentRuns();f.store.installDelegationControl();
    const request={op:'delegate',plan:'P-active',rev:1,oid:'declare',assign:['A']};
    f.store.declareDelegation(request,f.actor);
    f.store.cleanup('archive',{...f.body('P-active',0,'cleanup',1),active:true});
    f.store.cleanup('restore',f.body('P-active',1,'restore',1));
    const key={source:f.source.id,parent:'M',message:'message',call:'call'};
    f.store.beforeRun(key,f.actor,'subagent',{},1000);
    f.store.afterRun(key,0,{...f.child,directory:f.actor.directory},'returned');
    assert.equal(f.store.get(f.source.id,'P-active')!.revision,1);
    assert.equal(f.store.get(f.source.id,'P-active')!.items[0].assigneeSessionId,undefined);
    assert.equal(f.store.declareDelegation({...request,oid:'fresh'},f.actor).delegation.state,'pending');
  }finally{f.cleanup();}
});

for(const action of ['archive','delete'] as const){
  test(`delegation replay is fenced before receipt lookup after active ${action}`,()=>{
    const f=cleanupFixture();
    try{
      f.store.bindReads(f.source.id,true);f.store.installSubagentRuns();f.store.installDelegationControl();
      const request={op:'delegate',plan:'P-active',rev:1,oid:'declare',assign:['A']};
      f.store.declareDelegation(request,f.actor);
      f.store.cleanup(action,{...f.body('P-active',0,'cleanup',1),active:true,...(action==='delete'?{confirmed:true}:{})});
      const before=f.store.db.prepare('SELECT total_changes() AS n').get();
      assert.throws(()=>f.store.declareDelegation(request,f.actor),(e:any)=>e.code===(action==='archive'?'closed':'not-found'));
      assert.deepEqual(f.store.db.prepare('SELECT total_changes() AS n').get(),before);
    }finally{f.cleanup();}
  });
  test(`reserved delegation retires safely after active ${action} and restore permits fresh declaration`,()=>{
    const f=cleanupFixture();
    try{
      f.store.bindReads(f.source.id,true);f.store.installSubagentRuns();f.store.installDelegationControl();
      const request={op:'delegate',plan:'P-active',rev:1,oid:'declare',assign:['A']};
      f.store.declareDelegation(request,f.actor);
      const key={source:f.source.id,parent:'M',message:'message',call:'call'};
      f.store.beforeRun(key,f.actor,'subagent',{},1000);
      f.store.cleanup(action,{...f.body('P-active',0,'cleanup',1),active:true,...(action==='delete'?{confirmed:true}:{})});
      const rows=()=>['plans','revisions','contributions','captures','chunks','receipts'].map(t=>f.store.db.prepare(`SELECT * FROM ${t} WHERE source=? AND ${t==='plans'?'id':'plan'}=?`).all(f.source.id,'P-active'));
      const before=rows();
      assert.doesNotThrow(()=>f.store.afterRun(key,0,{...f.child,directory:f.actor.directory},'returned'));
      assert.deepEqual(rows(),before,'settlement cannot write guarded plan payloads');
      assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM runs_intents').get()!.n,0);
      assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM runs_rows').get()!.n,1);
      if(action==='archive'){
        f.store.cleanup('restore',f.body('P-active',1,'restore',1));
        const replay=f.store.declareDelegation(request,f.actor);
        assert.equal(replay.delegation.state,'retired');assert.equal(replay.delegation.reason,'closed');
        assert.deepEqual(rows(),before,'restored retry explains retirement without rewriting the earlier receipt');
        const fresh=f.store.declareDelegation({...request,oid:'fresh'},f.actor);
        assert.equal(fresh.delegation.state,'pending');
      }
    }finally{f.cleanup();}
  });
}

for(const state of ['pending','reserved'] as const)
test(`restore after active archive shows a ${state} delegation as retired in both readers`,()=>{
  const f=cleanupFixture();
  try{
    f.store.bindReads(f.source.id,true);f.store.installSubagentRuns();f.store.installDelegationControl();
    f.store.declareDelegation({op:'delegate',plan:'P-active',rev:1,oid:'declare',assign:['A']},f.actor);
    if(state==='reserved')f.store.beforeRun({source:f.source.id,parent:'M',message:'message',call:'call'},f.actor,'subagent',{},1000);
    f.store.cleanup('archive',{...f.body('P-active',0,'cleanup',1),active:true});
    f.store.cleanup('restore',f.body('P-active',1,'restore',1));
    const receipt=()=>f.store.db.prepare("SELECT receipt FROM receipts WHERE plan='P-active' AND oid='declare'").get()!.receipt;
    const before=receipt();
    const detail=f.store.detail(f.source.id,'P-active');
    const result=delegationView(f.store,detail,detail.plan).view!.result as any;
    assert.equal(result.availability,'ready');
    assert.equal(result.disposition.state,'refused');assert.equal(result.disposition.reason,'closed');assert.equal(result.disposition.recovery,'redeclare-or-link');
    const guidance=f.store.delegationRefusals(f.source.id,'M');
    assert.equal(guidance.complete,true);assert.deepEqual(guidance.refusals.map(r=>[r.plan,r.reason,r.declaration.oid]),[['P-active','closed','declare']]);
    assert.equal(receipt(),before,'the guarded receipt is not rewritten');
    assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM runs_intents').get()!.n,0,'the intent stays inactive');
  }finally{f.cleanup();}
});

test('a never-archived plan that lost its intent is not reported as closed',()=>{
  const f=cleanupFixture();
  try{
    f.store.bindReads(f.source.id,true);f.store.installSubagentRuns();f.store.installDelegationControl();
    f.store.declareDelegation({op:'delegate',plan:'P-active',rev:1,oid:'declare',assign:['A']},f.actor);
    f.store.db.exec('DELETE FROM runs_intents');
    const detail=f.store.detail(f.source.id,'P-active');
    const result=delegationView(f.store,detail,detail.plan).view!.result as any;
    assert.equal(result.availability,'unavailable');assert.equal(result.reason,'invalid');
    const guidance=f.store.delegationRefusals(f.source.id,'M');
    assert.equal(guidance.complete,false);assert.deepEqual(guidance.refusals,[]);
    assert.equal(f.store.declareDelegation({op:'delegate',plan:'P-active',rev:1,oid:'declare',assign:['A']},f.actor).delegation.state,'pending','replay agrees');
  }finally{f.cleanup();}
});

test('the early report refusal has the write path precedence: disabled, then closed',()=>{
  const f=cleanupFixture();
  try{
    f.store.cleanup('archive',{...f.body('P-active',0,'cleanup',1),active:true});
    assert.throws(()=>f.store.assertReportable(f.source.id,'P-active'),(e:any)=>e.code==='closed');
    f.store.setEnabled(false);
    assert.throws(()=>f.store.assertReportable(f.source.id,'P-active'),(e:any)=>e.code==='disabled');
  }finally{f.cleanup();}
});

test('a handoff early refusal checks the source binding before paused capture',()=>{
  const f=cleanupFixture();
  try{
    f.store.setEnabled(false);f.store.bindReads(f.source.id,false);
    assert.throws(()=>f.store.assertReportable(f.source.id,'P-active',true),(e:any)=>e.code==='source-unverified');
    assert.throws(()=>f.store.assertReportable(f.source.id,'P-active'),(e:any)=>e.code==='disabled','an ordinary report keeps its own precedence');
  }finally{f.cleanup();}
});

test('an unlinked dispatch keeps its visible plan when other active plans are archived',()=>{
  const f=cleanupFixture();
  try{
    f.store.bindReads(f.source.id,true);f.store.installSubagentRuns();f.store.installDelegationControl();
    f.seed('P-active-b');f.seed('P-active-c');
    f.store.cleanup('archive',{...f.body('P-active',0,'archive-a',1),active:true});
    f.store.cleanup('archive',{...f.body('P-active-b',0,'archive-b',1),active:true});
    f.store.beforeRun({source:f.source.id,parent:'M',message:'message',call:'call'},f.actor,'subagent',{},1000);
    const row=f.store.db.prepare("SELECT payload FROM runs_rows WHERE call='call'").get()!;
    assert.equal(JSON.parse(String(row.payload)).planContext?.plan,'P-active-c');
  }finally{f.cleanup();}
});

// Receipt evidence: coordinator guidance validates a pending or reserved receipt as the per-plan
// reader does (adapter intentDeclaration) before it reads a cleanup retirement into it.
function restoredReceipt(state:'pending'|'reserved',edit:(receipt:any)=>void,after?:(f:ReturnType<typeof cleanupFixture>)=>void) {
  const f=cleanupFixture();
  try{
    f.store.bindReads(f.source.id,true);f.store.installSubagentRuns();f.store.installDelegationControl();
    f.store.declareDelegation({op:'delegate',plan:'P-active',rev:1,oid:'declare',assign:['A']},f.actor);
    if(state==='reserved')f.store.beforeRun({source:f.source.id,parent:'M',message:'message',call:'call'},f.actor,'subagent',{},1000);
    f.store.cleanup('archive',{...f.body('P-active',0,'cleanup',1),active:true});
    f.store.cleanup('restore',f.body('P-active',1,'restore',1));
    const row=f.store.db.prepare("SELECT receipt FROM receipts WHERE plan='P-active' AND oid='declare'").get()!;
    const receipt=JSON.parse(String(row.receipt));edit(receipt);
    f.store.db.prepare("UPDATE receipts SET receipt=? WHERE plan='P-active' AND oid='declare'").run(JSON.stringify(receipt));
    const before=f.store.db.prepare("SELECT receipt FROM receipts WHERE plan='P-active' AND oid='declare'").get()!.receipt;
    after?.(f);
    const guidance=f.store.delegationRefusals(f.source.id,'M');
    assert.equal(f.store.db.prepare("SELECT receipt FROM receipts WHERE plan='P-active' AND oid='declare'").get()!.receipt,before,'the receipt is never rewritten');
    return guidance;
  }finally{f.cleanup();}
}
const dispatchOf={tool:'subagent',messageId:'message',callId:'call'};

for(const [state,edit,label] of [
  ['reserved',(r:any)=>{r.delegation.declaration.dispatch=null;},'reserved without a dispatch'],
  ['pending',(r:any)=>{r.delegation.declaration.dispatch=dispatchOf;},'pending with a dispatch'],
] as const)
test(`a ${label} receipt makes restored guidance incomplete instead of closed`,()=>{
  const guidance=restoredReceipt(state,edit);
  assert.deepEqual(guidance.refusals,[]);assert.equal(guidance.complete,false);
});

for(const state of ['pending','reserved'] as const)
test(`a ${state} receipt that declares no task makes restored guidance incomplete`,()=>{
  const guidance=restoredReceipt(state,r=>{r.delegation.declaration.taskIds=[];});
  assert.deepEqual(guidance.refusals,[]);assert.equal(guidance.complete,false);
});

for(const state of ['pending','reserved'] as const)
test(`a well-formed ${state} receipt after restore still reports closed and declares a task`,()=>{
  const guidance=restoredReceipt(state,r=>{assert.ok(r.delegation.declaration.taskIds.length>=1);assert.equal(r.delegation.declaration.dispatch!==null,state==='reserved');});
  assert.equal(guidance.complete,true);assert.deepEqual(guidance.refusals.map(r=>[r.plan,r.reason,r.declaration.oid]),[['P-active','closed','declare']]);
});

test('a well-formed restored receipt whose tasks were explicitly linked since yields no refusal',()=>{
  const guidance=restoredReceipt('pending',()=>{},f=>{
    f.store.apply({op:'link',plan:'P-active',oid:'link',rev:f.store.get(f.source.id,'P-active')!.revision,child:'C1',assign:['A']},f.actor,f.capture(),f.child);
  });
  assert.equal(guidance.complete,true);assert.deepEqual(guidance.refusals,[]);
});

test('a bound receipt without a dispatch is skipped without marking guidance incomplete',()=>{
  const guidance=restoredReceipt('pending',r=>{r.delegation.state='bound';r.delegation.declaration.dispatch=null;});
  assert.deepEqual(guidance.refusals,[]);assert.equal(guidance.complete,true);
});

for(const shape of ['empty cancelling declaration','earlier declaration it retired'] as const)
test(`cancellation read as before: the ${shape}`,()=>{
  const f=cleanupFixture();
  try{
    f.store.bindReads(f.source.id,true);f.store.installSubagentRuns();f.store.installDelegationControl();
    f.store.declareDelegation({op:'delegate',plan:'P-active',rev:1,oid:'declare',assign:['A']},f.actor);
    const cancel=f.store.declareDelegation({op:'delegate',plan:'P-active',rev:1,oid:'cancel',assign:[]},f.actor);
    assert.equal(cancel.delegation.state,'retired');assert.equal(cancel.delegation.reason,'cancelled');
    if(shape==='earlier declaration it retired'){
      f.store.db.prepare("DELETE FROM receipts WHERE plan='P-active' AND oid='cancel'").run();
      const earlier=JSON.parse(String(f.store.db.prepare("SELECT receipt FROM receipts WHERE plan='P-active' AND oid='declare'").get()!.receipt));
      assert.equal(earlier.delegation.state,'retired');assert.deepEqual(earlier.delegation.declaration.taskIds,['A'],'the retired declaration keeps its tasks');
    }
    const guidance=f.store.delegationRefusals(f.source.id,'M');
    assert.equal(guidance.complete,true);assert.deepEqual(guidance.refusals,[]);
  }finally{f.cleanup();}
});
