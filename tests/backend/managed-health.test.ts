import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import {once} from 'node:events';
import {SetupController} from '../../service/setup-controller.ts';
import {createProgressServer} from '../../service/server.ts';
import {createFixtureBinding} from '../fixtures/managed.ts';
import {PlatformError} from '../../shared/platform.ts';
import {ManagedBindingError} from '../../shared/managed-binding.ts';

const payload=()=>({plugin:'// Synthetic',guidance:'Synthetic',removal:'// Synthetic',version:'1.3.0'});
test('data, control and capture routes preserve fixed admission refusals',async t=>{
  const root=fs.mkdtempSync('/tmp/opencode/managed-refusal-'),{env}=createFixtureBinding(root);
  const setup=new SetupController({env},payload),server=createProgressServer(undefined,'fixture-only',undefined,setup);
  try{
    server.listen(0,'127.0.0.1');await once(server,'listening');
    const url=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
    for(const error of [new PlatformError('private-permissions'),new PlatformError('windows-security-unavailable'),new ManagedBindingError('managed-binding-modified'),new PlatformError('untrusted-message')]){
      const mock=t.mock.method(fs,'lstatSync',()=>{throw error;});syncBuiltinESMExports();
      try{
        for(const route of ['/v1/plans','/v1/capture/disable','/v1/capture/enable','/v1/document-captures']){
          const r=await fetch(url+route,{method:route.includes('/capture/')?'POST':'GET',headers:{authorization:'Bearer fixture-only'},signal:AbortSignal.timeout(1000)});
          assert.equal(r.status,503);assert.equal((await r.json()).error,error.code==='untrusted-message'?'storage':error.code);
        }
      }finally{mock.mock.restore();syncBuiltinESMExports();}
    }
  }finally{await new Promise<void>(r=>server.close(()=>r()));setup.close();fs.rmSync(root,{recursive:true,force:true});}
});

test('standalone health refuses a missing store even without an unavailable code',async()=>{
  const server=createProgressServer(undefined,'fixture-only');
  try{server.listen(0,'127.0.0.1');await once(server,'listening');
    const r=await fetch(`http://127.0.0.1:${(server.address() as {port:number}).port}/health`,{headers:{authorization:'Bearer fixture-only'},signal:AbortSignal.timeout(1000)});
    assert.equal(r.status,503);assert.deepEqual(await r.json(),{error:'storage'});
  }finally{await new Promise<void>(r=>server.close(()=>r()));}
});
test('a failed candidate attempt is no longer an unchecked starting service',()=>{
  const setup=new SetupController({env:{OPENCODE_DB:'unsupported-fixture'}},payload);
  try{
    assert.equal(setup.health().state,'starting');
    assert.throws(()=>setup.run('managed-migrate',{confirmed:true,expected:'a'.repeat(64)}),/managed-scope-unsupported/);
    assert.notEqual(setup.health().state,'starting');assert.equal(setup.health().ready,false);
  }finally{setup.close();}
});
test('managed constructor and authenticated health do no admission, even with unavailable security',async t=>{
  const root=fs.mkdtempSync('/tmp/opencode/managed-health-');
  const {env,binding}=createFixtureBinding(root);
  let setup:SetupController|undefined;
  const stat=t.mock.method(fs,'lstatSync',()=>{throw new Error('health-must-not-inspect');});syncBuiltinESMExports();
  try{
    setup=new SetupController({env},payload);
    const server=createProgressServer(undefined,'fixture-only',undefined,setup);
    try{
      server.listen(0,'127.0.0.1');await once(server,'listening');
      const url=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
      const get=(route:string,auth=true)=>fetch(url+route,{headers:auth?{authorization:'Bearer fixture-only'}:{},signal:AbortSignal.timeout(1000)});
      assert.equal((await get('/health',false)).status,401);
      const first=await (await get('/health')).json();
      assert.equal(first.state,'starting');assert.equal(first.ready,false);assert.equal(first.sqlite,false);
      assert.equal(stat.mock.callCount(),0);
      stat.mock.restore();syncBuiltinESMExports();
      assert.equal((await get('/v1/plans')).status,200);
      assert.equal((await (await get('/health')).json()).state,'ready');
      fs.chmodSync(binding.database,0o644);
      assert.equal((await get('/v1/plans')).status,503,'snapshot never authorizes a store access');
      const refused=await (await get('/health')).json();assert.equal(refused.ready,false);assert.equal(refused.state,'refused');
      fs.chmodSync(binding.database,0o600);
      assert.equal((await (await get('/health')).json()).ready,false,'health does not retry admission');
      assert.equal((await get('/v1/plans')).status,200);
      assert.equal((await (await get('/health')).json()).ready,true);
    }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
  }finally{stat.mock.restore();syncBuiltinESMExports();setup?.close();fs.rmSync(root,{recursive:true,force:true});}
});
