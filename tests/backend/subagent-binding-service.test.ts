import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createProgressServer } from '../../service/server.ts';
import { Store } from '../../shared/store.ts';
import { fixture } from './subagent-test-support.ts';

test('authenticated production API exposes one persisted assignment/provenance, not discovery membership or reports',async()=>{
  await fixture(async f=>{
    f.store.apply({op:'change',plan:'plan-alpha',oid:'reported-status',rev:1,changes:[{id:'task-1',status:'working'},{id:'task-2',status:'blocked'}]},f.actor());
    const token=randomUUID(),server=createProgressServer(f.store,token);
    server.listen(0,'127.0.0.1');await once(server,'listening');
    const address=server.address();assert.ok(address && typeof address==='object');const base=`http://127.0.0.1:${address.port}`;
    const request=(route:string,authenticated=true)=>fetch(base+route,{headers:authenticated?{authorization:`Bearer ${token}`}:{}});
    const read=async(route:string)=>{const r=await request(route);assert.equal(r.status,200);return r.json();};
    try {
      assert.equal((await request('/health',false)).status,401);assert.equal((await read('/health')).schemaVersion,2);
      f.declare();assert.equal((await read('/v1/plans?session=C1')).data.length,0);
      const before=await read('/v1/plan?source=source-alpha&plan=plan-alpha');
      await f.complete();const detail=await read('/v1/plan?source=source-alpha&plan=plan-alpha');
      assert.equal((await read('/v1/plans?session=A')).data.length,1);assert.equal((await read('/v1/plans?session=C1')).data.length,1);assert.equal((await read('/v1/plans?session=C2')).data.length,0);
      assert.equal(detail.sourceBinding.sourceId,'source-alpha');assert.equal(detail.sourceBinding.verified,true);assert.equal(detail.plan.revision,3);
      assert.deepEqual(detail.plan.counts,before.plan.counts);assert.equal(detail.plan.reportedAt,before.plan.reportedAt);
      assert.deepEqual(detail.timing.items,before.timing.items);assert.deepEqual(detail.blockedTiming.items,before.blockedTiming.items);
      assert.equal(detail.timing.items['task-1'].kind,'exact');assert.equal(detail.blockedTiming.items['task-2'].kind,'exact');
      assert.deepEqual(detail.items.data.map(({assignmentBinding,assigneeSessionId,...i}:any)=>i),before.items.data);
      assert.equal(detail.items.data[0].assignmentBinding.coordinatorSessionId,'A');assert.equal(detail.items.data[0].assignmentBinding.childSessionId,'C1');assert.equal(detail.items.data[0].assignmentBinding.planId,'plan-alpha');assert.equal(detail.items.data[0].assignmentBinding.itemId,'task-1');assert.equal(detail.items.data[0].assignmentBinding.boundRevision,3);
      assert.deepEqual(detail.links,[{sessionId:'C1',itemIds:['task-1']}]);
      assert.ok(detail.contributions.data.filter((c:any)=>c.revision===3).every((c:any)=>c.itemIds.length===0&&c.reporterSessionId==='A'));
      const history=await read('/v1/history?source=source-alpha&plan=plan-alpha');assert.deepEqual(history.data.map((r:any)=>r.revision),[1,2,3]);
      const reopened=new Store(f.store.file,{readOnly:true});try{assert.equal(reopened.detail(f.source.id,'plan-alpha').items.data[0]!.assignmentBinding!.childSessionId,'C1');}finally{reopened.close();}
      assert.equal(f.store.db.prepare('PRAGMA user_version').get()!.user_version,2);
      assert.equal(f.store.db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name LIKE '%declaration%'").get()!.n,0);
      f.store.registerSource({...f.source,id:'source-beta',configRoot:'/synthetic/beta/config',dataRoot:'/synthetic/beta/data'});
      f.store.apply({op:'start',plan:'plan-alpha',oid:'start',rev:0,title:'Separate source',items:[{id:'task-1',title:'Separate task',kind:'task'}]},{...f.actor(),sourceId:'source-beta'});
      const foreign=await read('/v1/plan?source=source-beta&plan=plan-alpha');
      assert.equal(foreign.items.data[0].assignmentBinding,undefined);assert.equal(foreign.items.data[0].assigneeSessionId,undefined);
      assert.equal((await read('/v1/plan?source=source-alpha&plan=plan-alpha')).items.data[0].assignmentBinding.childSessionId,'C1');
    } finally {server.closeAllConnections();await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
  });
});
