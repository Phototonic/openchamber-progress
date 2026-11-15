import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync,existsSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {once} from 'node:events';
import {fork} from 'node:child_process';
import {createServer,Server} from 'node:net';
import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {SetupRequestWorker,correlatedManagedReply} from '../../service/request-worker.ts';
import {SetupController} from '../../service/setup-controller.ts';
import {lifecycle} from '../../setup/lifecycle.ts';
import type {ManagedStepResponse} from '../../shared/managed-steps.ts';
import {managedStepFixtures} from '../fixtures/managed-steps.ts';
import {setupWriterTargets,acquireWriterSlots} from '../../service/writer-fence.ts';
import {writerTarget,writerTargetPort,PlatformRequestBudget,withPlatformRequestBudget,requirePlatformStoreFence} from '../../shared/platform.ts';

const payload={plugin:'// Synthetic',guidance:'Synthetic',removal:'// Synthetic',version:'1.3.0'};
test('derived writer ports avoid default ephemeral ranges and common service ports',()=>{
  const denied=new Set([25565,26000,...Array.from({length:16},(_,i)=>27015+i),27036,27037,28015,28016,28017,28960]);
  let skipped=0;
  for(let i=0;i<10000;i++){
    const identity=`${i%2?'scope':'store'}:/synthetic/target-${i}`,port=writerTargetPort(identity);
    assert.ok(port>=25000&&port<=28999);assert.ok(port<32768);assert.equal(denied.has(port),false);
    let expected=25000+createHash('sha256').update(identity).digest().readUInt32BE(0)%4000;
    if(denied.has(expected))skipped++;
    while(denied.has(expected))expected=25000+(expected-25000+1)%4000;
    assert.equal(port,expected,'skip forward deterministically without changing target identity');
  }
  assert.ok(skipped>0,'synthetic identities exercise denylist collisions');
});
test('settled replies correlate operation, following sequence and named step; error overrides replay',()=>{
  const fixtures=managedStepFixtures(),request=fixtures.requests.renewedAdvance,reply=fixtures.replies.renewedEnabled;
  assert.equal(correlatedManagedReply(request,reply),true);
  for(const progress of [{...reply.progress!,operationId:'22222222-2222-4222-8222-222222222222'},
    {...reply.progress!,sequence:request.expectedSequence},{...reply.progress!,sequence:request.expectedSequence+2},
    {...reply.progress!,lastCompleted:{name:'disable' as const,batch:0}},{...reply.progress!,lastCompleted:undefined}])
    assert.equal(correlatedManagedReply(request,{...reply,progress} as ManagedStepResponse),false);
  assert.equal(correlatedManagedReply({version:1,action:'advance',operationId:fixtures.journal.migration.operationId,expectedSequence:3,step:{name:'remove-discovery',batch:0}},fixtures.replies.failedReplay),true);
});
function fixture(){
  const root=mkdtempSync('/tmp/opencode/request-worker-');
  const env={HOME:path.join(root,'home'),XDG_CONFIG_HOME:path.join(root,'config'),XDG_DATA_HOME:path.join(root,'data'),XDG_STATE_HOME:path.join(root,'state'),XDG_CACHE_HOME:path.join(root,'cache')};
  for(const dir of Object.values(env))mkdirSync(dir,{mode:0o700});
  return {root,env};
}

test('bounded Setup and capture do not load migration payload; migration still requires it',async()=>{
  const {root,env}=fixture();let loads=0;
  const setup=new SetupController({env},()=>{loads++;throw Object.assign(new Error('synthetic missing payload'),{code:'ENOENT'});});
  try{
    const status=await setup.request({action:'status'});
    assert.ok(status.ok);assert.equal((status.value as {configured:boolean}).configured,false);
    const capture=await setup.request({action:'capture',enabled:false});
    assert.equal(capture.ok,false);if(!capture.ok)assert.equal(capture.code,'binding');
    assert.equal(loads,0);
    await assert.rejects(setup.request({action:'managed-step',body:{version:1,action:'inspect'}}),{code:'ENOENT'});
    assert.equal(loads,1);
  }finally{setup.close();rmSync(root,{recursive:true,force:true});}
});

for(const [name,entry] of [
  ['source',new URL('../../service/main.ts',import.meta.url)],
  ['built',new URL('../../build/service/main.js',import.meta.url)],
] as const){
  test(`${name} worker entry never runs ordinary service bootstrap`,{skip:process.platform==='win32'},async()=>{
    const {root,env}=fixture();
    try {
      const worker=new SetupRequestWorker(entry);
      // Invalid service port/token would make ordinary bootstrap exit with an
      // error. Worker health must neither bind a listener nor inspect roots.
      const result=await worker.run({...env,OPENCHAMBER_SERVICE_PORT:'invalid'},payload,{action:'health'});
      assert.equal(result.ok,true);
      if(result.ok)assert.deepEqual(result.value,{state:'starting',ready:false,sqlite:false,diagnostics:[],subagentRuns:false});
      assert.equal(result.accounting.securitySpawns,0);assert.equal(worker.busy,false);
    } finally {rmSync(root,{recursive:true,force:true});}
  });
}

test('ordinary source service entry still listens before cheap authenticated health',{skip:process.platform==='win32'},async()=>{
  const {root,env}=fixture();
  const reservation=createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');
  const port=(reservation.address() as {port:number}).port;
  await new Promise<void>(resolve=>reservation.close(()=>resolve()));
  const child=fork(new URL('../../service/main.ts',import.meta.url),[],{execArgv:['--experimental-strip-types'],
    env:{...env,OPENCHAMBER_SERVICE_PORT:String(port),OPENCHAMBER_SERVICE_TOKEN:'synthetic-worker-test'},silent:true});
  const exited=once(child,'exit');
  let errorText='';child.stderr?.on('data',chunk=>{errorText+=String(chunk);});
  try {
    const deadline=Date.now()+5000;
    let health:Response|undefined;
    while(Date.now()<deadline&&child.exitCode===null){
      try{health=await fetch(`http://127.0.0.1:${port}/health`,{headers:{authorization:'Bearer synthetic-worker-test'},signal:AbortSignal.timeout(500)});break;}
      catch{await delay(10);}
    }
    assert.ok(health,'service did not become reachable');
    assert.equal(health.status,200);
    const result=await health.json();assert.equal(result.state,'starting');assert.equal(result.ready,false);
    assert.equal(result.sqlite,false);assert.deepEqual(result.diagnostics,[]);
    assert.ok(!errorText.includes('agent-progress-service-unavailable'));
  } finally {child.kill('SIGTERM');await exited;rmSync(root,{recursive:true,force:true});}
});

test('supervisor refuses overlap and uses shared attempt accounting',{skip:process.platform==='win32'},async()=>{
  const {root,env}=fixture();
  try {
    const entry=path.join(root,'held-worker.mjs');
    writeFileSync(entry,`import {parentPort,workerData} from 'node:worker_threads';
parentPort.postMessage({requestId:workerData.requestId,result:{ok:true,value:'synthetic',accounting:{securitySpawns:99,elapsedMs:99}}});
setTimeout(()=>parentPort.close(),50);\n`,{mode:0o600});
    const worker=new SetupRequestWorker(pathToFileURL(entry));
    const first=worker.run(env,payload,{action:'health'});
    assert.equal(worker.busy,true);
    const overlap=await worker.run(env,payload,{action:'health'});
    assert.equal(overlap.ok,false);if(!overlap.ok)assert.equal(overlap.code,'managed-step-unsettled');
    const result=await first;assert.equal(result.ok,true);assert.equal(worker.busy,false);
    assert.equal(result.accounting.securitySpawns,0,'supervisor uses the shared attempt counter, not message accounting');
  }finally{rmSync(root,{recursive:true,force:true});}
});

test('a rejected writer release finishes with a fixed refusal and clears the active worker',{skip:process.platform==='win32',timeout:5000},async t=>{
  const {root,env}=fixture();
  const original=Server.prototype.close;
  let injected=false;
  const close=t.mock.method(Server.prototype,'close',function(this:Server,...args:Parameters<Server['close']>){
    const value=original.apply(this,args);
    if(!injected){injected=true;throw new Error('synthetic private release failure');}
    return value;
  });
  try{
    const worker=new SetupRequestWorker(new URL('../../service/main.ts',import.meta.url));
    const result=await worker.run(env,payload,{action:'health'});
    assert.equal(result.ok,false);if(!result.ok)assert.equal(result.code,'managed-step-unsettled');
    assert.equal(worker.busy,false);
    close.mock.restore();
    assert.equal((await worker.run(env,payload,{action:'health'})).ok,true,'a new request validates and acquires its own slots');
  }finally{close.mock.restore();rmSync(root,{recursive:true,force:true});}
});

test('response deadline does not clear busy or admit another request while the worker still runs',{skip:process.platform==='win32'},async()=>{
  const {root,env}=fixture();
  const gate=path.join(root,'release');
  const workerFile=path.join(root,'gated-worker.mjs');
  writeFileSync(workerFile,`import {parentPort,workerData} from 'node:worker_threads';
import {existsSync} from 'node:fs';
parentPort.postMessage({requestId:workerData.requestId,result:{ok:true,value:'not-settled',accounting:{securitySpawns:0,elapsedMs:0}}});
const poll=setInterval(()=>{if(existsSync(workerData.env.GATE)){clearInterval(poll);parentPort.close();}},10);
setTimeout(()=>{clearInterval(poll);parentPort.close();},5000).unref();\n`,{mode:0o600});
  const worker=new SetupRequestWorker(pathToFileURL(workerFile));
  try {
    const result=await worker.run({...env,GATE:gate},payload,{action:'health'},process.hrtime.bigint()-16_000_000_000n);
    assert.equal(result.ok,false);if(!result.ok)assert.equal(result.code,'managed-step-deadline');
    assert.equal(worker.busy,true,'a reply/message is not worker exit');
    const overlap=await worker.run(env,payload,{action:'health'});
    assert.equal(overlap.ok,false);if(!overlap.ok)assert.equal(overlap.code,'managed-step-unsettled');
  } finally {
    writeFileSync(gate,'release',{mode:0o600});
    const deadline=Date.now()+5000;
    while(worker.busy&&Date.now()<deadline)await delay(10);
    assert.equal(worker.busy,false,'owned worker must settle before fixture cleanup');
    rmSync(root,{recursive:true,force:true});
  }
});

test('writer admission is exclusive across two processes, not only one supervisor',{skip:process.platform==='win32'},async()=>{
  const {root,env}=fixture();
  const gate=path.join(root,'release'),ready=path.join(root,'ready');
  const entry=path.join(root,'holding-worker.mjs'),driver=path.join(root,'contender.mjs');
  writeFileSync(entry,`import {parentPort,workerData} from 'node:worker_threads';
import {existsSync,writeFileSync} from 'node:fs';
writeFileSync(workerData.env.READY,'ready',{mode:0o600});
parentPort.postMessage({requestId:workerData.requestId,result:{ok:true,value:null,accounting:{securitySpawns:0,elapsedMs:0}}});
const poll=setInterval(()=>{if(existsSync(workerData.env.GATE)){clearInterval(poll);parentPort.close();}},10);
setTimeout(()=>{clearInterval(poll);parentPort.close();},10000).unref();\n`,{mode:0o600});
  writeFileSync(driver,`const {SetupRequestWorker}=await import(process.env.HELPER);
const worker=new SetupRequestWorker(new URL(process.env.ENTRY));
const result=await worker.run(process.env, {plugin:'// Synthetic',guidance:'Synthetic',removal:'// Synthetic',version:'1.3.0'}, {action:'health'});
process.send(result,()=>process.disconnect());\n`,{mode:0o600});
  const owner=new SetupRequestWorker(pathToFileURL(entry));
  const holding=owner.run({...env,GATE:gate,READY:ready},payload,{action:'health'});
  try {
    const deadline=Date.now()+5000;
    while(!existsSync(ready)&&Date.now()<deadline)await delay(10);
    assert.ok(existsSync(ready),'first worker owns the writer slot before contention');
    const child=fork(driver,[],{execArgv:['--experimental-strip-types'],silent:true,
      env:{...env,HELPER:new URL('../../service/request-worker.ts',import.meta.url).href,ENTRY:pathToFileURL(entry).href}});
    const exited=once(child,'exit');
    try {
      const [reply]=await once(child,'message',{signal:AbortSignal.timeout(5000)});
      assert.equal(reply.ok,false);assert.equal(reply.code,'managed-step-port-busy');
      assert.equal(reply.accounting.securitySpawns,0);
      await exited;
    } finally {if(child.exitCode===null){child.kill('SIGTERM');await exited;}}
  }finally{
    writeFileSync(gate,'release',{mode:0o600});await holding;
    assert.equal(owner.busy,false);rmSync(root,{recursive:true,force:true});
  }
});

test('an unrelated listener is a refusal and is never taken over',{skip:process.platform==='win32'},async()=>{
  const {root,env}=fixture();
  const listener=createServer();listener.listen({host:'127.0.0.1',port:writerTargetPort(setupWriterTargets(env)[0]!),exclusive:true});await once(listener,'listening');
  try {
    const worker=new SetupRequestWorker(new URL('../../service/main.ts',import.meta.url));
    const result=await worker.run(env,payload,{action:'health'});
    assert.equal(result.ok,false);if(!result.ok)assert.equal(result.code,'managed-step-port-busy');
    assert.equal(result.accounting.securitySpawns,0);assert.equal(listener.listening,true);
    assert.equal(worker.busy,false);
  }finally{await new Promise<void>(resolve=>listener.close(()=>resolve()));rmSync(root,{recursive:true,force:true});}
});

test('target-derived slots permit unrelated targets but fence same scopes and shared Stores',async()=>{
  const a=fixture(),b=fixture();let releaseA:(()=>Promise<void>)|undefined,releaseB:(()=>Promise<void>)|undefined;
  try{
    const first=setupWriterTargets(a.env,path.join(a.root,'store/progress.sqlite')),other=setupWriterTargets(b.env,path.join(b.root,'store/progress.sqlite'));
    assert.equal(writerTargetPort(first[0]!),writerTargetPort(setupWriterTargets(a.env)[0]!));
    assert.notEqual(writerTargetPort(first[0]!),writerTargetPort(other[0]!));
    releaseA=await acquireWriterSlots(first);releaseB=await acquireWriterSlots(other);
    await assert.rejects(acquireWriterSlots(first),{code:'managed-step-port-busy'});
    await releaseB();releaseB=undefined;
    const shared=setupWriterTargets(b.env,path.join(a.root,'store/progress.sqlite'));
    await assert.rejects(acquireWriterSlots(shared),{code:'managed-step-port-busy'},'different discovery roots still serialize shared capture');
    const store=writerTarget('store',path.join(a.root,'store'));
    const budget=new PlatformRequestBudget(process.hrtime.bigint(),new SharedArrayBuffer(4),{port:writerTargetPort(first[0]!),nonce:'a'.repeat(64),targets:first});
    withPlatformRequestBudget(budget,()=>{
      requirePlatformStoreFence(path.join(a.root,'store/progress.sqlite'));
      assert.throws(()=>requirePlatformStoreFence(path.join(b.root,'store/progress.sqlite')),{code:'managed-step-conflict'});
    });
    assert.ok(first.includes(store));
  }finally{await releaseB?.();await releaseA?.();rmSync(a.root,{recursive:true,force:true});rmSync(b.root,{recursive:true,force:true});}
});

for(const [name,entry] of [['source',new URL('../../service/main.ts',import.meta.url)],['built',new URL('../../build/service/main.js',import.meta.url)]] as const){
  test(`${name} supervisor carries private inspection claims between fresh workers`,{skip:process.platform==='win32'},async()=>{
    const {root,env}=fixture();
    try{
      const configRoot=path.join(env.XDG_CONFIG_HOME,'opencode'),dataRoot=path.join(env.XDG_DATA_HOME,'opencode');
      for(const p of [configRoot,dataRoot])mkdirSync(p,{mode:0o700});
      lifecycle('install',{configRoot,dataRoot,storeRoot:path.join(root,'store'),confirmed:true},{...payload,version:'1.1.1'});
      const worker=new SetupRequestWorker(entry);
      let cursor:string|undefined,expected:string|undefined;
      for(const stage of ['roots','managed-state','legacy-discovery','legacy-releases','store','review']){
        const reply=await worker.run(env,payload,{action:'managed-step',body:{version:1,action:'inspect',...(cursor?{cursor}:{})}});
        if(!reply.ok)assert.fail(reply.code);
        const value=reply.value as ManagedStepResponse;
        assert.deepEqual(value.accounting,reply.accounting,'wire accounting includes worker settlement');
        assert.equal(value.inspection!.stage,stage);
        assert.deepEqual(Object.keys(reply).sort(),['accounting','ok','value']);
        assert.ok(!JSON.stringify(reply).includes('ownershipDigest'),'private ownership bytes/claims cannot leak through the public response');
        cursor=value.inspection!.cursor??undefined;
        if(value.inspection!.state==='complete')expected=value.inspection!.review.expected;
        assert.equal(worker.busy,false);
      }
      assert.equal(existsSync(path.join(dataRoot,'agent-progress-managed')),false,'read-only inspection never creates the managed container');
      const status=await worker.run(env,payload,{action:'managed-step',body:{version:1,action:'status'}});
      assert.ok(status.ok);assert.equal((status.value as ManagedStepResponse).progress,null);
      assert.ok((await worker.run(env,undefined,{action:'status'})).ok,'payload-free Setup retains completed review');
      const begin={version:1,action:'begin',operationId:'11111111-1111-4111-8111-111111111111',confirmed:true,expected};
      const prepared=await worker.run(env,payload,{action:'managed-step',body:begin});
      if(!prepared.ok)assert.fail(prepared.code);
      assert.equal((prepared.value as ManagedStepResponse).disposition,'applied');
      assert.equal((prepared.value as ManagedStepResponse).progress!.sequence,1);
      const cold=await new SetupRequestWorker(entry).run(env,payload,{action:'managed-step',body:begin});
      assert.ok(cold.ok);assert.equal((cold.value as ManagedStepResponse).disposition,'replayed');
      const observed=await worker.run(env,payload,{action:'managed-step',body:{version:1,action:'status',operationId:begin.operationId}});
      assert.ok(observed.ok);assert.equal((observed.value as ManagedStepResponse).progress!.capture.state,'unknown');
      let progress=(observed.value as ManagedStepResponse).progress!;
      for(const action of ['pause','resume'] as const){
        const reply=await worker.run(env,payload,{action:'managed-step',body:{version:1,action,operationId:begin.operationId,expectedSequence:progress.sequence}});
        if(!reply.ok)assert.fail(reply.code);
        assert.equal((reply.value as ManagedStepResponse).disposition,'applied');progress=(reply.value as ManagedStepResponse).progress!;
      }
      while(progress.state!=='complete'){
        assert.ok((await worker.run(env,undefined,{action:'status'})).ok,'payload-free Setup refreshes journal hints');
        const request={version:1,action:'advance',operationId:begin.operationId,expectedSequence:progress.sequence,step:progress.step};
        const reply=await worker.run(env,payload,{action:'managed-step',body:request});
        if(!reply.ok)assert.fail(reply.code);
        const value=reply.value as ManagedStepResponse;
        assert.equal(value.disposition,'applied',JSON.stringify(value.error));assert.equal(value.progress!.sequence,progress.sequence+1);
        assert.deepEqual(Object.keys(reply).sort(),['accounting','ok','value']);
        assert.ok(!JSON.stringify(reply).includes('ownershipDigest'),'private journal claims never appear on the wire');
        const replay=await worker.run(env,payload,{action:'managed-step',body:request});
        assert.ok(replay.ok);assert.equal((replay.value as ManagedStepResponse).disposition,'replayed');
        progress=value.progress!;
      }
      const first=await worker.run(env,payload,{action:'managed-step',body:{version:1,action:'inspect'}});
      assert.ok(first.ok);cursor=(first.value as ManagedStepResponse).inspection!.cursor!;
      const continued=await worker.run(env,payload,{action:'managed-step',body:{version:1,action:'inspect',cursor}});
      assert.ok(continued.ok);
      const replay=await worker.run(env,payload,{action:'managed-step',body:{version:1,action:'inspect',cursor}});
      assert.equal(replay.ok,false);if(!replay.ok)assert.equal(replay.code,'managed-inspection-expired');
      const fresh=await worker.run(env,payload,{action:'managed-step',body:{version:1,action:'inspect'}});
      assert.ok(fresh.ok);cursor=(fresh.value as ManagedStepResponse).inspection!.cursor!;
      const restarted=new SetupRequestWorker(entry);
      const expired=await restarted.run(env,payload,{action:'managed-step',body:{version:1,action:'inspect',cursor}});
      assert.equal(expired.ok,false);if(!expired.ok)assert.equal(expired.code,'managed-inspection-expired');
      const changed=await worker.run(env,{...payload,plugin:'// different package'}, {action:'managed-step',body:{version:1,action:'inspect',cursor}});
      assert.equal(changed.ok,false);if(!changed.ok)assert.equal(changed.code,'managed-inspection-expired');
      const forged=await worker.run(env,payload,{action:'managed-step',body:{version:1,action:'inspect',cursor,inspection:{stage:5}}});
      assert.equal(forged.ok,false);
    }finally{rmSync(root,{recursive:true,force:true});}
  });
}

for(const kind of ['mismatched','duplicate'] as const)test(`supervisor refuses ${kind} worker replies`,{skip:process.platform==='win32'},async()=>{
  const {root,env}=fixture();try{
    const entry=path.join(root,'invalid-reply.mjs');
    writeFileSync(entry,`import {parentPort,workerData} from 'node:worker_threads';
const message={requestId:${kind==='mismatched'?"'another-request'":'workerData.requestId'},result:{ok:true,value:null,accounting:{securitySpawns:0,elapsedMs:0}}};
parentPort.postMessage(message);${kind==='duplicate'?'parentPort.postMessage(message);':''}parentPort.close();\n`,{mode:0o600});
    const reply=await new SetupRequestWorker(pathToFileURL(entry)).run(env,payload,{action:'health'});
    assert.equal(reply.ok,false);if(!reply.ok)assert.equal(reply.code,'managed-step-unsettled');
  }finally{rmSync(root,{recursive:true,force:true});}
});
