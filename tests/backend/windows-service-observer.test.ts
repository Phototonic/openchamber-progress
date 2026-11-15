import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {isolatedEnvironment} from '../fixtures/managed.ts';
import {nativeService,NativeHarnessError,nativeHarnessCode,type Observation} from '../fixtures/windows-service-driver.ts';

test('native observer attributes worker attempts/reads separately from concurrent health',{skip:process.platform==='win32',timeout:15000},async()=>{
  const root=fs.mkdtempSync('/tmp/opencode/native-observer-'),observations:Observation[]=[];
  const service=await nativeService(isolatedEnvironment(root),o=>observations.push(o),'tests/fixtures/windows-observer-probe.mjs');
  try{
    const request=await service.request('/v1/setup/managed-step',{},'probe',{concurrent:true,expectedStatus:200});
    assert.equal(request.counts.queries,2,'both real failed launch attempts count');assert.equal(request.counts.legacyReads,1);assert.equal(request.counts.workers,1);
    assert.equal(observations.find(o=>o.phase==='probe')!.concurrent,true);
    const health=observations.find(o=>o.phase==='probe-health')!;
    assert.equal(health.counts.queries,0);assert.equal(health.counts.legacyReads,0);assert.equal(health.counts.workers,0);
    await service.settings(null,2500);
    const delayed=await service.request('/v1/setup/managed-step',{},'delayed',{concurrent:true,expectedStatus:200});
    assert.equal(delayed.counts.queries,2);assert.ok(delayed.counts.elapsedMs>=5000,'latency injection crosses the worker boundary');
  }finally{await service.stop();fs.rmSync(root,{recursive:true,force:true});}
});

test('observer never holds main-thread spawns and driver refuses concurrency claims on synchronous routes',{skip:process.platform==='win32',timeout:15000},async()=>{
  const root=fs.mkdtempSync('/tmp/opencode/native-observer-main-'),observations:Observation[]=[];
  const service=await nativeService(isolatedEnvironment(root),o=>observations.push(o),'tests/fixtures/windows-observer-probe.mjs');
  try{
    await assert.rejects(service.request('/v1/setup/managed-inspect',{},'fresh',{concurrent:true}),{code:'native-worker-route-required'});
    // Deliberately broken worker fixture spawns on its main thread despite the
    // hold header. It must finish promptly, then refuse the false concurrency
    // claim, rather than waiting for an impossible IPC release notification.
    await assert.rejects(service.request('/v1/setup/managed-step',{mainThread:true},'main-thread',{concurrent:true,limitMs:1500}),{code:'native-assertion-failed'});
    const observed=observations.find(o=>o.phase==='main-thread')!;
    assert.equal(observed.counts.queries,1);assert.equal(observed.counts.workers,0);
    assert.ok(observed.counts.elapsedMs<1500);assert.equal(observed.concurrent,false);
  }finally{await service.stop();fs.rmSync(root,{recursive:true,force:true});}
});

test('native harness failures expose fixed codes, never exception messages or paths',()=>{
  for(const code of ['native-service-exited','native-observer-timeout','native-worker-route-required'] as const)assert.equal(nativeHarnessCode(new NativeHarnessError(code)),code);
  assert.equal(nativeHarnessCode(new assert.AssertionError({message:'private fixture /fixture/secret'})),'native-assertion-failed');
  assert.equal(nativeHarnessCode(Object.assign(new Error('/fixture/private'),{name:'TimeoutError'})),'native-request-timeout');
  assert.equal(nativeHarnessCode(Object.assign(new Error('/fixture/private'),{code:'ENOENT'})),'native-harness-failed');
});
