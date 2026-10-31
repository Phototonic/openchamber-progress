import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RUN_LIMITS } from '../../shared/subagent-runs.ts';
import { fixture } from './subagent-test-support.ts';

const bytes=(value:unknown)=>Buffer.byteLength(JSON.stringify(value));
async function sizedRun(description:string,run:(f:any)=>Promise<void>) {
  await fixture(async f=>{
    const source={...f.source,id:'s'.repeat(80),configRoot:`${f.source.configRoot}/sized`,dataRoot:`${f.source.dataRoot}/sized`};
    f.store.registerSource(source);f.store.bindReads(source.id,true);
    const root={...f.actor(),sourceId:source.id,sessionId:'a'.repeat(80),parentId:null,ancestry:[]};
    const child={...root,sessionId:'c'.repeat(80),parentId:root.sessionId,ancestry:[root.sessionId]},plan='p'.repeat(80),task='i'.repeat(80),n=Number.MAX_SAFE_INTEGER;
    f.store.apply({op:'start',plan,oid:'seed',rev:0,title:'Synthetic plan',items:[{id:task,title:'Task',kind:'task'}]},root);
    const key={source:source.id,parent:root.sessionId,message:'m'.repeat(80),call:'k'.repeat(80)};
    f.store.beforeRun(key,root,'subagent',{agent:'\ud800'.repeat(80),description},n-4);f.store.afterRun(key,0,child,'returned');
    const event={source:source.id,child:child.sessionId,id:'start',sequence:10,at:n-3,state:'running' as const,errorType:null,interruptionReason:null};
    f.store.observeExecution(event);
    f.store.handoff({op:'handoff',oid:'q'.repeat(80),outcome:'partial',summary:'\ud800'.repeat(200)},child,n-2);
    f.store.observeExecution({...event,id:'t'.repeat(80),sequence:11,at:n-1,state:'failed',errorType:'E'.repeat(80)});
    const request={storeId:f.store.list().storeId,binding:{sourceId:source.id,verified:true},source:source.id,root:root.sessionId};
    const stored=()=>JSON.parse(String(f.store.db.prepare('SELECT payload FROM runs_rows WHERE call=?').get(key.call)!.payload));
    await run({...f,root,child,plan,task,request,stored});
  });
}

test('read enrichment budgets the entire accepted envelope on a near-limit supported Store row',async()=>{
  let size=0;await sizedRun('',async f=>{size=bytes(f.stored());});
  for(const target of [4090,RUN_LIMITS.dtoBytes]){
  const padding=target-size+2;
  assert.ok(padding>0&&Math.ceil(padding/6)<=200,'construct the byte boundary using permitted escaped description text');
  const description='\ud800'.repeat(Math.floor(padding/6))+'x'.repeat(padding%6);
  await sizedRun(description,async f=>{
    const stored=f.stored();assert.equal(bytes(stored),target);assert.ok(stored.claimed);assert.ok(stored.planContext);
    assert.equal(f.store.subagentRuns({...f.request,view:'history'}).data.length,1);
    f.store.apply({op:'link',plan:f.plan,oid:'link',rev:1,child:f.child.sessionId,assign:[f.task]},f.root,undefined,f.child);
    const before=JSON.stringify(f.stored());
    for(const selected of [false,true])for(const view of ['useful','history'] as const){
      const result=f.store.subagentRuns({...f.request,view,...(selected?{plan:f.plan,cleanupRev:0}:{})});
      assert.equal(result.data.length,(selected?view==='useful':view==='history')?1:0);
      for(const row of result.data){
        assert.ok(bytes(row)<=RUN_LIMITS.dtoBytes);assert.equal(row.latestForChild,true);assert.deepEqual(row.claimed,stored.claimed);assert.deepEqual(row.planContext,stored.planContext);
        if(selected)assert.ok(row.accepted===null||row.accepted.items.length+row.accepted.omittedItems===1);
      }
    }
    assert.equal(JSON.stringify(f.stored()),before,'read-time budgeting never changes durable facts');
  });
  }
});
