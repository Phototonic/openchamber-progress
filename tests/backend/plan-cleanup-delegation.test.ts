import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanupFixture } from '../fixtures/cleanup.ts';

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
