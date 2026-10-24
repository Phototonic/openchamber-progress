import{test}from'node:test';import assert from'node:assert/strict';import{once}from'node:events';
import{createProgressServer}from'../../service/server.ts';import{productionFixture,P1}from'../fixtures/production.ts';
import{SetupController}from'../../service/setup-controller.ts';import{writeFileSync,readFileSync,existsSync}from'node:fs';
test('QA2/QA4 production real HTTP paging, bounded document reads, host auth/method/path/control refusals',{timeout:15000},async()=>{
  const f=productionFixture();const token='temporary-fixture-bearer';const server=createProgressServer(f.store,token);
  try{
    f.store.apply({op:'start',plan:'P1',oid:'start',rev:0,title:'Alpha',items:P1},f.actor);
    for(let i=0;i<24;i++)f.store.apply({op:'start',plan:`P${i+2}`,oid:`start${i+2}`,rev:0,title:`Plan ${i}`,items:[]},f.actor);
    server.listen(0,'127.0.0.1');await once(server,'listening');const url=`http://127.0.0.1:${(server.address()as any).port}`;const headers={authorization:`Bearer ${token}`};
    assert.equal((await fetch(`${url}/health`)).status,401);assert.equal((await fetch(`${url}/health`,{headers:{authorization:'Bearer wrong'}})).status,401);
    assert.equal((await fetch(`${url}/health`,{headers})).status,200);
    const first=await(await fetch(`${url}/v1/plans`,{headers})).json();assert.equal(first.data.length,20);assert.equal(first.nextCursor,'20');assert.equal(first.coverage,'recorded-only');
    const next=await(await fetch(`${url}/v1/plans?cursor=${first.nextCursor}`,{headers})).json();assert.equal(next.data.length,5);assert.equal(next.nextCursor,null);
    const detail=await(await fetch(`${url}/v1/plan?source=${f.source.id}&plan=P1`,{headers})).json();assert.deepEqual(detail.plan.counts,{done:2,total:4,remaining:2,skipped:1});assert.equal(JSON.stringify(detail).includes(token),false);
    assert.equal((await fetch(`${url}/v1/plan?source=${f.source.id}&plan=P1&cursor=1`,{headers})).status,200);
    assert.equal((await fetch(`${url}/v1/plan?source=${f.source.id}&plan=P1&page=1`,{headers})).status,404);
    assert.equal((await fetch(`${url}/v1/document?source=${f.source.id}&plan=P1`,{headers})).status,200);
    assert.equal((await fetch(`${url}/v1/plans?path=/etc/passwd`,{headers})).status,404);
    assert.equal((await fetch(`${url}/v1/plans?limit=2&limit=3`,{headers})).status,404);
    assert.equal((await fetch(`${url}/v1/plans?limit=999`,{headers})).status,400);
    assert.equal((await fetch(`${url}/v1/plans`,{method:'POST',headers})).status,405);
    assert.equal((await fetch(`${url}/v1/capture/disable`,{method:'POST',headers,body:'{}'})).status,400);
    assert.equal((await fetch(`${url}/v1/capture/disable`,{method:'POST',headers})).status,200);
    assert.throws(()=>f.store.apply({op:'revise',plan:'P1',oid:'disabled',rev:1,title:'No'},f.actor),/disabled/);
    assert.equal((await fetch(`${url}/v1/capture/enable`,{method:'POST',headers})).status,200);
  }finally{if(server.listening)await new Promise<void>(resolve=>server.close(()=>resolve()));f.cleanup();}
});
test('QA4 real HTTP setup bootstrap/inspect/install/controls/removal and modified descriptor refusal',{timeout:15000},async()=>{
  const f=productionFixture();const binding=`${f.root}/service-binding.json`;
  const setup=new SetupController(binding,()=>({plugin:'export default {id:"fixture",setup:async()=>{}}',guidance:'Keep planner',removal:'// fixture-only',version:'0.2.0'}),undefined,{platform:'linux',env:{},uid:process.getuid?.()});
  const server=createProgressServer(undefined,'fixture-only',undefined,setup);
  try{
    server.listen(0,'127.0.0.1');await once(server,'listening');const url=`http://127.0.0.1:${(server.address()as any).port}`;const headers={authorization:'Bearer fixture-only','content-type':'application/json'};
    const post=(action:string,body:unknown)=>fetch(`${url}/v1/setup/${action}`,{method:'POST',headers,body:JSON.stringify(body)});
    const health=await(await fetch(`${url}/health`,{headers})).json();assert.equal(health.ready,false);
    const state=await(await fetch(`${url}/v1/setup`,{headers})).json();assert.equal(state.verified,false);assert.equal(state.targets,null);
    const targets={configRoot:f.source.configRoot,dataRoot:f.source.dataRoot,storeRoot:`${f.root}/store`};
    assert.equal((await post('inspect',targets)).status,200);assert.equal(existsSync(binding),false);
    assert.equal((await post('install',targets)).status,400);
    const installed=await post('install',{...targets,confirmed:true});assert.equal(installed.status,200);const body=await installed.json();assert.equal(body.activation,'reload-required');assert.equal(body.version,'0.2.0');assert.equal(body.separateLifecycle,true);
    const plans=await(await fetch(`${url}/v1/plans`,{headers})).json();assert.deepEqual(plans.sourceBinding,{sourceId:f.source.id,verified:true});assert.equal(plans.storeId,f.store.list().storeId);
    assert.equal((await post('disable',{confirmed:true})).status,200);assert.equal(f.store.list().captureEnabled,false);
    assert.equal((await post('enable',{confirmed:true})).status,200);assert.equal(f.store.list().captureEnabled,true);
    assert.equal((await post('inspect',{path:'/etc/passwd'})).status,400);
    assert.equal((await fetch(`${url}/v1/setup/install`,{method:'POST',headers,body:'x'.repeat(16_385)})).status,413);
    const descriptor=readFileSync(binding);writeFileSync(binding,'user-modified');
    const refused=await post('update',{confirmed:true});assert.equal(refused.status,409);assert.equal((await refused.json()).error,'service-binding-modified');assert.equal(readFileSync(binding,'utf8'),'user-modified');writeFileSync(binding,descriptor);
    assert.equal((await post('remove-capture',{confirmed:true})).status,200);assert.equal(f.store.list().captureEnabled,false);
    const retained=await(await fetch(`${url}/v1/setup`,{headers})).json();assert.equal(retained.installed,false);assert.equal(retained.historyRetained,true);
    assert.equal((await fetch(`${url}/v1/capture/enable`,{method:'POST',headers})).status,409);
    assert.equal(existsSync(f.store.file),true);
  }finally{if(server.listening)await new Promise<void>(resolve=>server.close(()=>resolve()));setup.close();f.cleanup();}
});
test('unavailable/corrupt store diagnoses with503 behind the same bearer, never an empty success',{timeout:10000},async()=>{
  const server=createProgressServer(undefined,'fixture-only','corrupt');
  try{server.listen(0,'127.0.0.1');await once(server,'listening');const url=`http://127.0.0.1:${(server.address()as any).port}`;
    assert.equal((await fetch(`${url}/health`)).status,401);
    const r=await fetch(`${url}/health`,{headers:{authorization:'Bearer fixture-only'}});assert.equal(r.status,503);assert.deepEqual(await r.json(),{error:'corrupt'});
  }finally{if(server.listening)await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
test('failed post-install binding persistence preserves foreign descriptor and disables capture',()=>{
  const f=productionFixture();const binding=`${f.root}/service-binding.json`;
  const setup=new SetupController(binding,()=>{writeFileSync(binding,'foreign-descriptor',{mode:0o600});return{plugin:'export default {}',guidance:'fixture',removal:'// fixture',version:'0.2.0'};});
  try{
    assert.throws(()=>setup.run('install',{configRoot:f.source.configRoot,dataRoot:f.source.dataRoot,storeRoot:`${f.root}/store`,confirmed:true}),/service-binding-unavailable-capture-disabled/);
    assert.equal(readFileSync(binding,'utf8'),'foreign-descriptor');assert.equal(f.store.list().captureEnabled,false);
  }finally{setup.close();f.cleanup();}
});
