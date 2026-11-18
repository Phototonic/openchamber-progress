import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import {once} from 'node:events';
import {SetupController} from '../../service/setup-controller.ts';
import {createProgressServer,managedStepHttpStatus} from '../../service/server.ts';
import {createFixtureBinding} from '../fixtures/managed.ts';
import {PlatformError} from '../../shared/platform.ts';
import {ManagedBindingError} from '../../shared/managed-binding.ts';
import {observeManagedSetup} from '../../setup/managed-observation.ts';
import {Store} from '../../shared/store.ts';
import {ProgressError} from '../../shared/progress.ts';
import {SetupError} from '../../setup/lifecycle.ts';
import {parseSetup} from '../../ui/shared/adapter.ts';

test('concurrent starting Setup GETs all return a complete delivery observation',async t=>{
  const root=fs.mkdtempSync('/tmp/opencode/concurrent-setup-'),{env}=createFixtureBinding(root);
  const setup=new SetupController({env},payload),server=createProgressServer(undefined,'fixture-only',undefined,setup);
  try{
    server.listen(0,'127.0.0.1');await once(server,'listening');
    const url=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
    const get=async(route:string)=>{
      const response=await fetch(url+route,{headers:{authorization:'Bearer fixture-only'},signal:AbortSignal.timeout(5000)});
      return {status:response.status,body:await response.text()};
    };
    assert.equal(JSON.parse((await get('/health')).body).state,'starting');
    const replies=await Promise.all(Array.from({length:5},()=>get('/v1/setup')));
    t.diagnostic(JSON.stringify(replies.map(r=>({status:r.status,...(r.status===200?{}:JSON.parse(r.body))}))));
    assert.deepEqual(replies.map(r=>r.status),[200,200,200,200,200]);
    for(const reply of replies){
      const read=parseSetup(reply.body);assert.equal(read.configured,true);assert.equal(read.verified,true);
      assert.equal(read.delivery?.managedMigrationSteps,1);
    }
  }finally{await new Promise<void>(r=>server.close(()=>r()));setup.close();fs.rmSync(root,{recursive:true,force:true});}
});

test('step and compatibility routes share managed configuration, path and scope conflict statuses',async t=>{
  const setup=new SetupController({env:{}},payload),server=createProgressServer(undefined,'fixture-only',undefined,setup);
  try{
    server.listen(0,'127.0.0.1');await once(server,'listening');
    const url=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
    for(const code of ['managed-configuration-busy','managed-path-unverified','managed-scope-unsupported'] as const){
      const mock=t.mock.method(setup,'writerTargets',()=>{throw new ManagedBindingError(code);});
      try{
        const r=await fetch(url+'/v1/setup/managed-inspect',{method:'POST',body:'{}',headers:{authorization:'Bearer fixture-only'},signal:AbortSignal.timeout(1000)});
        assert.equal(r.status,409);assert.deepEqual(await r.json(),{error:code});
        assert.equal(managedStepHttpStatus(code),r.status,code);
      }finally{mock.mock.restore();}
    }
  }finally{await new Promise<void>(r=>server.close(()=>r()));setup.close();}
});

test('bounded Setup projects expected operational errors but rethrows unexpected bugs at either observation boundary',t=>{
  const root=fs.mkdtempSync('/tmp/opencode/managed-observation-'),{env}=createFixtureBinding(root);
  try{
    for(const error of [new ManagedBindingError(),new SetupError('managed-journal-unsupported'),new PlatformError('private-permissions'),new ProgressError('schema'),Object.assign(new Error('private fixture'),{code:'EACCES'})]){
      const mock=t.mock.method(fs,'lstatSync',()=>{throw error;});syncBuiltinESMExports();
      try{const read=observeManagedSetup(env);assert.deepEqual(read.status.diagnostics,[error.code]);assert.equal(read.status.captureEnabled,null);}
      finally{mock.mock.restore();syncBuiltinESMExports();}
    }
    const bug=new TypeError('synthetic implementation bug');
    const stat=t.mock.method(fs,'lstatSync',()=>{throw bug;});syncBuiltinESMExports();
    try{assert.throws(()=>observeManagedSetup(env),e=>e===bug);}
    finally{stat.mock.restore();syncBuiltinESMExports();}
    const list=t.mock.method(Store.prototype,'list',()=>{throw bug;});
    try{assert.throws(()=>observeManagedSetup(env),e=>e===bug);}
    finally{list.mock.restore();}
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

const payload=()=>({plugin:'// Synthetic',guidance:'Synthetic',removal:'// Synthetic',version:'1.3.0'});
test('data routes preserve fixed admission and coordination refusals',async t=>{
  const root=fs.mkdtempSync('/tmp/opencode/managed-refusal-'),{env}=createFixtureBinding(root);
  const setup=new SetupController({env},payload),server=createProgressServer(undefined,'fixture-only',undefined,setup);
  try{
    server.listen(0,'127.0.0.1');await once(server,'listening');
    const url=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
    for(const error of [new PlatformError('private-permissions'),new ManagedBindingError('managed-binding-modified'),new PlatformError('untrusted-message')]){
      const mock=t.mock.method(fs,'lstatSync',()=>{throw error;});syncBuiltinESMExports();
      try{
        // Managed capture now runs in a separate worker, so these main-thread
        // filesystem mocks exercise only data admission. Worker HTTP faults are
        // covered by managed-step-http.test.ts.
        for(const route of ['/v1/plans','/v1/document-captures']){
          const r=await fetch(url+route,{method:route.includes('/capture/')?'POST':'GET',headers:{authorization:'Bearer fixture-only'},signal:AbortSignal.timeout(1000)});
          // Target routing can now detect a changed binding before controller
          // admission; that ownership conflict uses the existing HTTP 409 rule.
          assert.equal(r.status,error instanceof ManagedBindingError?409:503);assert.equal((await r.json()).error,error.code==='untrusted-message'?'storage':error.code);
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
      assert.equal(first.managedMigrationSteps,1);assert.equal(first.needsYouInbox,undefined);assert.equal(first.delegationIntent,undefined);
      assert.equal(stat.mock.callCount(),0);
      stat.mock.restore();syncBuiltinESMExports();
      assert.equal((await get('/v1/plans')).status,200);
      const runs=t.mock.method(Store.prototype,'subagentRunStorage',()=>{throw new Error('health-must-not-query');});
      try{
        const ready=await(await get('/health')).json();assert.equal(ready.state,'ready');
        assert.equal(ready.managedMigrationSteps,1);assert.equal(ready.needsYouInbox,1);assert.equal(ready.delegationIntent,1);
        assert.equal(runs.mock.callCount(),0,'advertising delegation does not query the Store');
      }finally{runs.mock.restore();}
      fs.chmodSync(binding.database,0o644);
      assert.equal((await get('/v1/plans')).status,503,'snapshot never authorizes a store access');
      const refused=await (await get('/health')).json();assert.equal(refused.ready,false);assert.equal(refused.state,'refused');assert.equal(refused.delegationIntent,undefined);
      fs.chmodSync(binding.database,0o600);
      assert.equal((await (await get('/health')).json()).ready,false,'health does not retry admission');
      assert.equal((await get('/v1/plans')).status,200);
      assert.equal((await (await get('/health')).json()).ready,true);
    }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
  }finally{stat.mock.restore();syncBuiltinESMExports();setup?.close();fs.rmSync(root,{recursive:true,force:true});}
});
