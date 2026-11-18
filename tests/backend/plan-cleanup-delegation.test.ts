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
