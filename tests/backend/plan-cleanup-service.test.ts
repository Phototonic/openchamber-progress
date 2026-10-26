import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { once } from 'node:events';
import { fork } from 'node:child_process';
import { createProgressServer } from '../../service/server.ts';
import { Store } from '../../shared/store.ts';
import { LIMITS } from '../../shared/progress.ts';
import { launchCleanupService } from '../fixtures/cleanup-service.ts';
import { cleanupFixture } from '../fixtures/cleanup.ts';

test('authenticated real HTTP cleanup validates intent and identity without side effects; archive/restore/delete API and SQL agree',async()=>{
  const f=await launchCleanupService();
  const second=cleanupFixture();
  try {
    const baseline=readdirSync(`${f.root}/store`);
    const health=await(await f.request('/health')).json();assert.equal(health.planCleanup,1);assert.equal(health.schemaVersion,2);
    assert.equal((await f.request('/v1/plans?archived=only')).status,200);assert.equal((await f.request('/v1/plan?source=source-fixture&plan=P-done')).status,200);
    const malformed=[{},[],{...f.body(),extra:'x'},{...f.body(),source:'../x'},{...f.body(),rev:'2'},{...f.body(),oid:'x'.repeat(81)}];
    for(const body of malformed)assert.equal((await f.request('/v1/plan/archive',body)).status,400);
    for(const body of [f.body(),{...f.body(),confirmed:false},{...f.body(),confirmed:'true'}])assert.equal((await f.request('/v1/plan/delete',body)).status,400);
    assert.equal((await f.request('/v1/plan/archive',f.body(),{headers:{authorization:'Bearer wrong'}})).status,401);
    assert.equal((await f.request('/v1/plan/archive')).status,405);
    assert.equal((await f.request('/v1/plan/archive?x=1',f.body())).status,404);
    assert.equal((await f.request('/v1/plans?archived=all')).status,400);
    assert.equal((await f.request('/v1/plans?archived=only&archived=only')).status,404);
    assert.equal((await f.request('/v1/plan/archive',undefined,{method:'POST',body:JSON.stringify({padding:'x'.repeat(LIMITS.requestBytes)})})).status,413);
    for(const body of [{...f.body(),storeId:second.body().storeId},{...f.body(),rev:1},{...f.body(),cleanupRev:1}])assert.equal((await f.request('/v1/plan/archive',body)).status,409);
    assert.equal(second.store.detail(second.source.id,'P-done').plan.cleanup,undefined);
    assert.equal((await f.request('/v1/plan/archive',{...f.body(),source:'missing'})).status,404);
    for(const plan of ['P-active','P-cancelled','P-failed'])assert.equal((await f.request('/v1/plan/archive',f.body(plan,0,'ineligible',plan==='P-active'?1:2))).status,409);
    assert.deepEqual(readdirSync(`${f.root}/store`),baseline);assert.equal(f.store.db.prepare("SELECT name FROM sqlite_master WHERE name='cleanup_state'").get(),undefined);
    const before=f.store.detail(f.source.id,'P-done');const history=f.store.history(f.source.id,'P-done');
    f.store.setEnabled(false);
    const archive=await f.request('/v1/plan/archive',f.body());assert.equal(archive.status,200);const receipt=await archive.json();assert.equal(receipt.cleanup.state,'archived');
    assert.deepEqual(await(await f.request('/v1/plan/archive',f.body())).json(),receipt);
    assert.equal((await f.request('/v1/plan/archive',{...f.body(),rev:1})).status,409);
    assert.equal(f.store.db.prepare('SELECT state FROM cleanup_state WHERE source=? AND plan=?').get(f.source.id,'P-done')!.state,'archived');
    const normal=await(await f.request('/v1/plans?source=source-fixture&limit=50')).json();assert(!normal.data.some((p:any)=>p.id==='P-done'));
    const archived=await(await f.request('/v1/plans?archived=only&source=source-fixture&session=M&directory=%2Ffixture%2FAlpha')).json();assert.equal(archived.data.length,1);assert.equal(archived.data[0].cleanup.revision,1);
    const detail=await(await f.request('/v1/plan?source=source-fixture&plan=P-done')).json();assert.equal(detail.plan.lifecycle,'finished');assert.deepEqual(detail.plan.counts,before.plan.counts);
    assert.equal((await f.request(`/v1/document?source=source-fixture&plan=P-done&capture=${before.plan.document.captureId}`)).status,200);
    assert.deepEqual((await(await f.request('/v1/history?source=source-fixture&plan=P-done')).json()).data,history.data);
    assert.equal((await f.request('/v1/plan/restore',f.body('P-done',1,'restore'))).status,200);
    assert.equal(f.store.get(f.source.id,'P-done')!.lifecycle,'finished');assert.equal(f.store.detail(f.source.id,'P-done').plan.cleanup?.revision,2);
    assert.equal((await f.request('/v1/plan/archive',f.body())).status,409);
    const deletion={...f.body('P-done',2,'delete'),confirmed:true};const deleted=await f.request('/v1/plan/delete',deletion);assert.equal(deleted.status,200);assert.deepEqual(await(await f.request('/v1/plan/delete',deletion)).json(),await deleted.json());
    for(const table of ['plans','chunks','captures','revisions','contributions','receipts'])assert.equal(f.store.db.prepare(`SELECT count(*) AS n FROM ${table} WHERE source=? AND ${table==='plans'?'id':'plan'}=?`).get(f.source.id,'P-done')!.n,0,table);
    for(const route of ['/v1/plan','/v1/history',`/v1/document`])assert.equal((await f.request(`${route}?source=source-fixture&plan=P-done${route==='/v1/document'?`&capture=${before.plan.document.captureId}`:''}`)).status,404);
    assert(f.store.get('source-other','P-done'));assert(f.store.get(f.source.id,'P-other'));assert.equal(f.store.list().captureEnabled,false);
  }finally{second.cleanup();await f.stop();}
});

test('normal and archived filters precede pagination with source/session/directory isolation',async()=>{
  const f=await launchCleanupService();try{
    const all=[];let position:number|undefined=0;while(position!==undefined){const page=f.store.list({source:f.source.id,limit:50,cursor:position});all.push(...page.data.filter(p=>p.lifecycle==='finished'));position=page.nextCursor===null?undefined:Number(page.nextCursor);}
    for(const p of all)assert.equal((await f.request('/v1/plan/archive',f.body(p.id,0,`archive-${p.id}`,p.revision))).status,200);
    const ids:string[]=[];let cursor='0';do{
      const page=await(await f.request(`/v1/plans?archived=only&source=source-fixture&session=M&directory=%2Ffixture%2FAlpha&limit=50&cursor=${cursor}`)).json();ids.push(...page.data.map((p:any)=>p.id));cursor=page.nextCursor;
    }while(cursor!==null);
    assert.equal(ids.length,57);assert.equal(new Set(ids).size,57);
    const normal=await(await f.request('/v1/plans?source=source-fixture&session=M&directory=%2Ffixture%2FAlpha&limit=50')).json();assert.equal(normal.data.length,3);assert.equal(normal.nextCursor,null);
    assert.equal((await(await f.request('/v1/plans?archived=only&source=source-other')).json()).data.length,0);
    assert.equal((await(await f.request('/v1/plans?source=source-other')).json()).data.length,1);
    assert.equal((await(await f.request('/v1/plans?archived=only&session=U')).json()).data.length,0);
    assert.equal((await(await f.request('/v1/plans?archived=only&directory=%2Ffixture%2FElsewhere')).json()).data.length,0);
  }finally{await f.stop();}
});

test('HTTP competing reopen, busy, read-only, and unavailable storage fail safely',async()=>{
  const f=await launchCleanupService(false,false);let held:ReturnType<typeof fork>|undefined;
  try{
    f.store.apply({op:'revise',plan:'P-done',rev:2,oid:'reopen',title:'Continue',reopen:true},f.actor,f.capture());
    assert.equal((await f.request('/v1/plan/delete',{...f.body(),confirmed:true})).status,409);assert.equal(f.store.get(f.source.id,'P-done')!.lifecycle,'active');
    held=fork(new URL('../fixtures/cleanup-worker.ts',import.meta.url),[f.store.file,'hold','{}','{}'],{stdio:['ignore','ignore','ignore','ipc']});await once(held,'message',{signal:AbortSignal.timeout(5000)});
    assert.equal((await f.request('/v1/plan/archive',f.body('P-other'))).status,503);const exit=once(held,'exit');held.kill('SIGKILL');await exit;held=undefined;
    for(const store of [undefined,new Store(f.store.file,{readOnly:true})]){
      const server=createProgressServer(store,'fixture-only','storage');server.listen(0,'127.0.0.1');await once(server,'listening');
      try{const response=await fetch(`http://127.0.0.1:${(server.address()as any).port}/v1/plan/delete`,{method:'POST',headers:{authorization:'Bearer fixture-only'},body:JSON.stringify({...f.body('P-other'),confirmed:true})});assert.equal(response.status,503);assert(f.store.get(f.source.id,'P-other'));}
      finally{await new Promise<void>(resolve=>server.close(()=>resolve()));store?.close();}
    }
  }finally{if(held){const exit=once(held,'exit');held.kill('SIGKILL');await exit;}await f.stop();}
});

test('HTTP cleanup racing an actual independent writer never archives active progress',async()=>{
  const f=await launchCleanupService(false,false);
  try{
    const child=fork(new URL('../fixtures/cleanup-worker.ts',import.meta.url),[f.store.file,'reopen',JSON.stringify({op:'revise',plan:'P-done',rev:2,oid:'race-reopen',title:'Continue',reopen:true}),JSON.stringify(f.actor),JSON.stringify(f.capture())],{stdio:['ignore','ignore','ignore','ipc']});
    const result=once(child,'message',{signal:AbortSignal.timeout(10000)});
    const [response,[writer]]=await Promise.all([f.request('/v1/plan/archive',f.body()),result]);
    const current=f.store.detail(f.source.id,'P-done').plan;
    if(response.ok){assert.equal((writer as any).error,'closed');assert.equal(current.lifecycle,'finished');assert.equal(current.cleanup?.state,'archived');}
    else{assert.equal(response.status,409);assert((writer as any).receipt);assert.equal(current.lifecycle,'active');assert.equal(current.cleanup,undefined);}
  }finally{await f.stop();}
});

// CP-Q5 opt-in: shared final check is run only after source/bundle inputs stabilize.
test('checked-in built service persists archive/delete through restart',{skip:process.env.CP_BUILT_SERVICE!=='1'},async()=>{
  const f=await launchCleanupService(true,false);try{
    assert.equal((await f.request('/v1/plan/archive',f.body())).status,200);
    await f.restart();
    assert.equal((await(await f.request('/v1/plans?archived=only&source=source-fixture')).json()).data[0].id,'P-done');
    assert.equal(f.store.detail(f.source.id,'P-done').plan.cleanup?.state,'archived');
    const deletion={...f.body('P-done',1,'delete'),confirmed:true};assert.equal((await f.request('/v1/plan/delete',deletion)).status,200);
    await f.restart();assert.equal((await f.request('/v1/plan?source=source-fixture&plan=P-done')).status,404);assert.equal((await f.request('/v1/plan/delete',deletion)).status,200);
    const reopened=new Store(f.store.file);try{assert.equal(reopened.get(f.source.id,'P-done'),undefined);assert.equal(reopened.cleanup('delete',deletion).cleanup.state,'deleted');}finally{reopened.close();}
  }finally{await f.stop();}
});
