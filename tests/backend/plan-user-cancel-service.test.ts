import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import { createProgressServer } from '../../service/server.ts';
import { Store } from '../../shared/store.ts';
import { launchCleanupService } from '../fixtures/cleanup-service.ts';

const route='/v1/plan/cancel';
function request(f:Awaited<ReturnType<typeof launchCleanupService>>,rev=1){
  return {...f.body('P-active',0,'user-cancel',rev),binding:{sourceId:f.source.id,verified:true},confirmed:true};
}
async function refusal(response:Response,status:number,code:string){
  assert.equal(response.status,status);
  assert.match(response.headers.get('content-type')??'',/^application\/json/);
  assert.equal(response.headers.get('cache-control'),'no-store');
  assert.equal(response.headers.get('x-content-type-options'),'nosniff');
  assert.deepEqual(await response.json(),{error:code});
}

test('built managed service advertises cancel and persists the user history through fresh admission',async()=>{
  const f=await launchCleanupService(true,false);
  try {
    const response=await f.request('/health');
    assert.equal((await response.json()).planUserCancel,1);
    const body=request(f);
    const r=await f.request(route,body);
    assert.equal(r.status,200);
    const receipt=await r.json();
    assert.deepEqual(receipt,{storeId:body.storeId,sourceBinding:body.binding,source:body.source,plan:body.plan,
      oid:body.oid,rev:2,structuralRev:1,lifecycle:'cancelled',actor:'user',reportedAt:receipt.reportedAt});
    const history=await (await f.request(`/v1/history?source=${body.source}&plan=${body.plan}&cursor=1&limit=1`)).json();
    assert.deepEqual(history.data,[{revision:2,structuralRevision:1,lifecycle:'cancelled',reportedAt:receipt.reportedAt,actor:'user'}]);
    assert.deepEqual(await (await f.request(route,body)).json(),receipt);
    await refusal(await f.request(route,{...body,oid:'new-cancel',rev:2}),409,'closed');
  } finally {await f.stop();}
});

test('cancel HTTP refuses malformed, unauthorized, stale, unverified, paused and unavailable requests',async()=>{
  const f=await launchCleanupService(false,false);
  try {
    const body=request(f);
    const before=['plans','revisions','receipts'].map(table=>f.store.db.prepare(`SELECT count(*) AS n FROM ${table}`).get()!.n);
    await refusal(await f.request(route,body,{headers:{}}),401,'unauthorized');
    await refusal(await f.request(route),405,'method-not-allowed');
    await refusal(await f.request(`${route}?source=other`,body),400,'invalid');
    for(const invalid of [
      {...body,actor:{kind:'user',action:'cancel'}},
      {...body,session:'M'},
      {...body,changes:[]},
      {...body,outcome:'finished'},
      {...body,binding:{...body.binding,extra:true}},
      {...body,confirmed:false},
      {...body,rev:0},
    ])await refusal(await f.request(route,invalid),400,'invalid');
    await refusal(await f.request(route,body,{body:'{'}),400,'invalid');
    await refusal(await f.request(route,body,{body:Buffer.from([0xc0,0xaf])}),400,'invalid');
    const text=JSON.stringify(body), limit=16_384;
    await refusal(await f.request(route,body,{body:text+' '.repeat(limit+1-Buffer.byteLength(text))}),413,'request-too-large');
    await refusal(await f.request(route,{...body,storeId:'other-store'}),409,'binding');
    await refusal(await f.request(route,{...body,source:'source-other'}),409,'source-unverified');
    await refusal(await f.request(route,{...body,plan:'missing'}),404,'not-found');
    await refusal(await f.request(route,{...body,plan:'P-done',rev:2}),409,'closed');
    f.store.bindReads(body.source,false);
    await refusal(await f.request(route,body),409,'binding');
    await refusal(await f.request(route,{...body,binding:{...body.binding,verified:false}}),409,'source-unverified');
    f.store.bindReads(body.source,true);
    // An already-admitted Store still rechecks the persisted source row.
    f.store.db.prepare('UPDATE sources SET verified=0 WHERE id=?').run(body.source);
    await refusal(await f.request(route,body),409,'source-unverified');
    f.store.db.prepare('UPDATE sources SET verified=1 WHERE id=?').run(body.source);
    f.store.setEnabled(false);
    await refusal(await f.request(route,body),409,'disabled');
    f.store.setEnabled(true);
    assert.deepEqual(['plans','revisions','receipts'].map(table=>f.store.db.prepare(`SELECT count(*) AS n FROM ${table}`).get()!.n),before);
    assert.equal(f.store.get(body.source,body.plan)!.lifecycle,'active');
    assert.equal((await f.request(route,body,{body:text+' '.repeat(limit-Buffer.byteLength(text))})).status,200);
    f.store.setEnabled(false);
    await refusal(await f.request(route,body),409,'disabled');
    f.store.setEnabled(true);
    assert.equal((await f.request('/v1/plan/archive',f.body(body.plan,0,'archive',2))).status,200);
    await refusal(await f.request(route,body),409,'closed');
    assert.equal((await f.request('/v1/plan/delete',{...f.body(body.plan,1,'delete',2),confirmed:true})).status,200);
    await refusal(await f.request(route,body),404,'not-found');
  } finally {await f.stop();}
  const server=createProgressServer(undefined,'fixture-only','schema').listen(0,'127.0.0.1');
  try {
    await once(server,'listening');
    const port=(server.address() as {port:number}).port;
    await refusal(await fetch(`http://127.0.0.1:${port}${route}`,{
      headers:{authorization:'Bearer fixture-only'},method:'POST',
      body:JSON.stringify(request(f)),signal:AbortSignal.timeout(3000),
    }),503,'schema');
  } finally {await new Promise<void>(resolve=>server.close(()=>resolve()));}
});

test('competing reports and cleanup serialize without silently rebasing a reviewed cancel',async()=>{
  const f=await launchCleanupService(false,false);
  let other:Store|undefined;
  try {
    const body=request(f);
    other=new Store(f.store.file);
    const cancelPending=f.request(route,body);
    other.apply({op:'change',plan:body.plan,oid:'report-first',rev:1,changes:[{id:'A',status:'done'}]},f.actor,f.capture());
    await refusal(await cancelPending,409,'conflict');
    const reviewed=request(f,2);
    const [cancel,archive]=await Promise.all([f.request(route,reviewed),
      f.request('/v1/plan/archive',{...f.body(body.plan,0,'race-archive',2),active:true})]);
    if(cancel.status===200){
      await refusal(archive,409,'conflict');
      assert.equal(f.store.get(body.source,body.plan)!.revision,3);
      assert.equal(f.store.get(body.source,body.plan)!.lifecycle,'cancelled');
      assert.throws(()=>other!.apply({op:'change',plan:body.plan,oid:'late',rev:2,changes:[{id:'A',status:'working'}]},f.actor,f.capture()),{code:'conflict'});
    }else{
      assert.equal(archive.status,200);
      await refusal(cancel,409,'closed');
      assert.equal(f.store.get(body.source,body.plan)!.lifecycle,'active');
      assert.equal((await f.request('/v1/plan/restore',f.body(body.plan,1,'race-restore',2))).status,200);
      await refusal(await f.request(route,reviewed),409,'conflict');
    }
    const p=f.store.get(body.source,body.plan)!;
    assert.equal(p.items[0]!.status,'done');
  } finally {other?.close();await f.stop();}
});
