import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { chmodSync, readFileSync } from 'node:fs';
import { SetupController } from '../../service/setup-controller.ts';
import { createProgressServer } from '../../service/server.ts';
import { productionFixture, P1 } from '../fixtures/production.ts';

const payload=()=>({plugin:'export default {}',guidance:'Keep canonical planner',removal:'// fixture',version:'0.2.0'});
function configured() {
  const f=productionFixture();const binding=`${f.root}/service-binding.json`;
  const targets={configRoot:f.source.configRoot,dataRoot:f.source.dataRoot,storeRoot:`${f.root}/store`,confirmed:true};
  const installer=new SetupController(binding,payload);
  installer.run('install',targets);installer.close();
  f.store.apply({op:'start',plan:'P1',oid:'start',rev:0,title:'Retained',items:P1},f.actor);
  return {...f,binding,targets};
}
async function serve(setup:SetupController,run:(get:(route:string)=>Promise<Response>)=>Promise<void>) {
  const server=createProgressServer(undefined,'fixture-only',undefined,setup);
  try {server.listen(0,'127.0.0.1');await once(server,'listening');
    const url=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
    await run(route=>fetch(`${url}${route}`,{headers:{authorization:'Bearer fixture-only'}}));
  }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));setup.close();}
}
test('configured unreadable store reports storage failure without losing configuration or recovery authority',async()=>{
  const f=configured();const descriptor=readFileSync(f.binding);
  chmodSync(f.store.file,0o000);const setup=new SetupController(f.binding,payload);
  try {await serve(setup,async get=>{
    const health=await get('/health');assert.equal(health.status,503);assert.deepEqual(await health.json(),{error:'storage'});
    const status=await(await get('/v1/setup')).json();assert.equal(status.configured,true);assert.equal(status.captureEnabled,null);
    assert.ok(status.diagnostics.includes('storage'));assert.ok(!status.diagnostics.includes('service-binding-collision'));
    assert.deepEqual(status.targets,{configRoot:f.targets.configRoot,dataRoot:f.targets.dataRoot,storeRoot:f.targets.storeRoot});
    assert.equal((await get('/v1/plans')).status,503);
    assert.deepEqual(readFileSync(f.binding),descriptor);
    chmodSync(f.store.file,0o600);
    assert.doesNotThrow(()=>setup.run('update',f.targets));
  });}finally{chmodSync(f.store.file,0o600);f.cleanup();}
});
test('configured unreadable store recovers without restart on health, setup and reads',async()=>{
  for(const route of ['/health','/v1/setup','/v1/plans']) {
    const f=configured();chmodSync(f.store.file,0o000);const setup=new SetupController(f.binding,payload);
    try {await serve(setup,async get=>{
      await get(route);chmodSync(f.store.file,0o600);
      const response=await get(route);assert.equal(response.status,200,route);const body=await response.json();
      if(route==='/health')assert.equal(body.ready,true,route);
      else if(route==='/v1/setup'){assert.equal(body.configured,true);assert.equal(body.captureEnabled,true);assert.ok(!body.diagnostics.includes('storage'));}
      else {assert.equal(body.data[0].id,'P1');assert.equal(body.storeId,f.store.list().storeId);}
    });}finally{chmodSync(f.store.file,0o600);f.cleanup();}
  }
});
test('pending reload remains visible across service restart after install and update',()=>{
  const f=configured();
  try {
    for(const action of ['install','update']) {
      const setup=new SetupController(f.binding,payload);
      try {assert.equal(setup.status().activation,'reload-required',`restart after ${action}`);
        setup.run('disable',{confirmed:true});assert.equal(setup.status().activation,'reload-required');
        setup.run('enable',{confirmed:true});assert.equal(setup.status().activation,'reload-required');
        if(action==='install')setup.run('update',f.targets);
      }finally{setup.close();}
    }
  }finally{f.cleanup();}
});
