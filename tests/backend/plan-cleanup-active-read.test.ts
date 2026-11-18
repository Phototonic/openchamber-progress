import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { fork } from 'node:child_process';
import { launchCleanupService } from '../fixtures/cleanup-service.ts';
import { previousCleanup } from '../fixtures/cleanup-previous.ts';

test('active cleanup removes current reads and waiting delegation, preserves runs, and restored work returns',async()=>{
  const f=await launchCleanupService(false,false);
  try{
    const plan='P-active',source=f.source.id;
    f.store.installSubagentRuns();f.store.installDelegationControl();
    f.store.apply({op:'change',plan,rev:1,oid:'decision',changes:[{id:'A',status:'blocked',blocker:{category:'decision',reason:'Choose a format'}}]},f.actor,f.capture());
    f.store.declareDelegation({op:'delegate',plan,rev:2,oid:'declare',assign:['B']},f.actor);
    const params=new URLSearchParams({storeId:f.body().storeId,source,binding:JSON.stringify({sourceId:source,verified:true})});
    async function read(route:string){const response=await f.request(route);assert.equal(response.status,200);return response.json();}
    async function visible(expected:boolean){
      for(const suffix of ['','&session=M','&session=M&delegationIntent=1']){
        const page=await read(`/v1/plans?source=${source}${suffix}`);
        assert.equal(page.data.some((p:any)=>p.id===plan),expected);
      }
      const inbox=await read(`/v1/needs-you?${params}`);
      assert.equal(inbox.rows.some((r:any)=>r.plan===plan),expected);
      assert.equal(inbox.counts.needsYou,expected?1:0);
      const resume=f.store.resumePlans({storeId:f.body().storeId,sourceId:source,sessionId:'M',parentId:null,ancestry:[]},{now:()=>0});
      assert.deepEqual(resume?.candidates.map(p=>p.plan),expected?[plan]:[]);
    }
    await visible(true);
    const pending=await read(`/v1/plan?source=${source}&plan=${plan}&delegationIntent=1`);
    assert.equal(pending.delegationIntent.result.disposition.state,'pending');
    const key={source,parent:'M',message:'synthetic-message',call:'synthetic-call'};
    // Capture the dispatch before cleanup; its reserved intent must not bind afterwards.
    f.store.beforeRun(key,f.actor,'subagent',{},1000);
    const before=f.store.get(source,plan),history=f.store.history(source,plan);
    assert.equal((await f.request('/v1/plan/archive',{...f.body(plan,0,'archive-active',2),active:true})).status,200);
    await visible(false);
    const archived=await read(`/v1/plan?source=${source}&plan=${plan}&delegationIntent=1`);
    assert.equal(archived.delegationIntent,undefined);
    const rows=await read(`/v1/plans?source=${source}&archived=only&session=M`);
    assert.deepEqual(rows.data.map((p:any)=>p.id),[plan]);
    f.store.afterRun(key,0,{...f.child,directory:f.actor.directory},'returned');
    assert.deepEqual(f.store.get(source,plan),before);
    assert.deepEqual(f.store.history(source,plan),history);
    assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM runs_intents').get()!.n,0);
    assert.throws(()=>f.store.declareDelegation({op:'delegate',plan,rev:2,oid:'declare',assign:['B']},f.actor),(e:any)=>e.code==='closed');
    const runs=f.store.db.prepare('SELECT * FROM runs_rows').all();assert.equal(runs.length,1);
    assert.equal((await f.request('/v1/plan/restore',f.body(plan,1,'restore-active',2))).status,200);
    await visible(true);
    // A new pending declaration is invalidated by deletion too, without deleting session runs.
    f.store.declareDelegation({op:'delegate',plan,rev:2,oid:'declare-delete',assign:['B']},f.actor);
    const second={...key,message:'second-message',call:'second-call'};
    f.store.beforeRun(second,f.actor,'subagent',{},2000);
    assert.equal((await f.request('/v1/plan/delete',{...f.body(plan,2,'delete-active',2),active:true,confirmed:true})).status,200);
    f.store.afterRun(second,0,{...f.child,directory:f.actor.directory},'returned');
    await visible(false);
    assert.equal((await f.request(`/v1/plan?source=${source}&plan=${plan}&delegationIntent=1`)).status,404);
    assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM runs_rows').get()!.n,2);
    const retained=f.store.db.prepare('SELECT * FROM runs_rows WHERE id=?').get(String(runs[0].id))!;
    const original=JSON.parse(String(runs[0].payload));
    // The existing deletion trigger clears plan associations, not session-run evidence.
    assert.deepEqual({...retained,payload:JSON.parse(String(retained.payload))},
      {...runs[0],payload:{...original,planContext:null,accepted:null}});
    assert.equal(f.store.get(source,plan),undefined);
  }finally{await f.stop();}
});

test('previous service receipts replay unchanged and rollback leaves active archives readable but refuses restore',async()=>{
  const f=await launchCleanupService(false,false);
  let oldStore:any,server:any;
  try{
    const old=await previousCleanup(`${f.root}/previous`);
    oldStore=new old.Store(f.store.file);oldStore.bindReads(f.source.id,true);
    server=old.createProgressServer(oldStore,'fixture-only');server.listen(0,'127.0.0.1');await once(server,'listening');
    const url=`http://127.0.0.1:${server.address().port}`;
    async function oldRequest(route:string,body?:unknown){
      return fetch(url+route,{method:body?'POST':'GET',headers:{authorization:'Bearer fixture-only'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(3000)});
    }
    const oldHealth=await(await oldRequest('/health')).json();
    assert.equal(oldHealth.planCleanup,1);assert.equal(oldHealth.planCleanupActive,undefined);
    const body=f.body();
    const response=await oldRequest('/v1/plan/archive',body);assert.equal(response.status,200);
    const receipt=await response.json();
    assert.deepEqual(await(await f.request('/v1/plan/archive',body)).json(),receipt);
    assert.equal(f.store.detail(f.source.id,'P-done').plan.cleanup?.revision,1);
    const active={...f.body('P-active',0,'archive-active',1),active:true};
    assert.equal((await oldRequest('/v1/plan/archive',active)).status,400);
    assert.equal((await oldRequest('/v1/plan/archive',f.body('P-active',0,'old-active',1))).status,409);
    assert.equal((await f.request('/v1/plan/archive',active)).status,200);
    const before=f.store.get(f.source.id,'P-active'),history=f.store.history(f.source.id,'P-active');
    const archived=await oldRequest('/v1/plan?source=source-fixture&plan=P-active');
    assert.equal(archived.status,200);assert.equal((await archived.json()).plan.cleanup.state,'archived');
    const refused=await oldRequest('/v1/plan/restore',f.body('P-active',1,'old-restore',1));
    assert.equal(refused.status,409);assert.deepEqual(await refused.json(),{error:'closed'});
    for(const reopened of [false,true]){
      if(reopened){oldStore.close();oldStore=new old.Store(f.store.file);}
      const detail=oldStore.detail(f.source.id,'P-active');assert.equal(detail.plan.lifecycle,'active');assert.equal(detail.plan.cleanup.state,'archived');
      assert.throws(()=>oldStore.cleanup('restore',f.body('P-active',1,'old-restore',1)),(e:any)=>e.code==='closed');
    }
    assert.deepEqual(f.store.get(f.source.id,'P-active'),before);assert.deepEqual(f.store.history(f.source.id,'P-active'),history);
  }finally{
    if(server)await new Promise<void>(resolve=>server.close(()=>resolve()));
    oldStore?.close();await f.stop();
  }
});

test('pre-cleanup writer loaded before and after active archive is fenced by persistent guards',async()=>{
  const f=await launchCleanupService(false,false);
  const children:ReturnType<typeof fork>[]=[];
  const message=(child:ReturnType<typeof fork>)=>once(child,'message',{signal:AbortSignal.timeout(10000)}).then(([v])=>v as any);
  async function legacy(name:string){
    const child=fork(new URL('../fixtures/cleanup-legacy-writer.ts',import.meta.url),[f.store.file,`${f.root}/${name}`],{stdio:['ignore','ignore','ignore','ipc']});
    children.push(child);assert.equal((await message(child)).phase,'ready');return child;
  }
  try{
    const before=await legacy('before');
    assert.equal((await f.request('/v1/plan/archive',{...f.body('P-active',0,'archive-active',1),active:true})).status,200);
    const after=await legacy('after');
    const preserved=f.store.get(f.source.id,'P-active'),history=f.store.history(f.source.id,'P-active');
    for(const child of [before,after])for(const input of [
      {op:'change',plan:'P-active',rev:1,oid:'late',changes:[{id:'A',status:'done'}]},
      {op:'stage',plan:'P-active',rev:1,oid:'late-stage',upload:'late',chunk:0,items:[]},
    ]){
      const reply=message(child);child.send({input,actor:f.actor,capture:f.capture()});assert.equal((await reply).error,'storage');
      assert.deepEqual(f.store.get(f.source.id,'P-active'),preserved);assert.deepEqual(f.store.history(f.source.id,'P-active'),history);
    }
    assert.equal((await f.request('/v1/plan/delete',{...f.body('P-active',1,'delete-active',1),active:true,confirmed:true})).status,200);
    for(const child of [before,after]){
      const reply=message(child);child.send({input:f.starts.get(`${f.source.id}/P-active`),actor:f.actor,capture:f.capture()});assert((await reply).error);
      assert.equal(f.store.get(f.source.id,'P-active'),undefined);
    }
  }finally{
    for(const child of children)if(child.connected){const exit=once(child,'exit');child.send({close:true});await exit;}
    await f.stop();
  }
});
