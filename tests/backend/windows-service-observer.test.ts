import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {isolatedEnvironment} from '../fixtures/managed.ts';
import {nativeService,NativeHarnessError,nativeHarnessCode,type Observation} from '../fixtures/windows-service-driver.ts';

test('native observer counts every process launch and legacy read of a worker, separately from health',{skip:process.platform==='win32',timeout:15000},async()=>{
  const root=fs.mkdtempSync('/tmp/opencode/native-observer-'),observations:Observation[]=[];
  const service=await nativeService(isolatedEnvironment(root),o=>observations.push(o),'tests/fixtures/windows-observer-probe.mjs');
  try{
    const request=await service.request('/v1/setup/managed-step',{},'probe',{expectedStatus:200,maxSpawns:2});
    assert.equal(request.counts.queries,2,'both real failed launch attempts count');assert.equal(request.counts.legacyReads,1);assert.equal(request.counts.workers,1);
    const health=await service.request('/health',undefined,'probe-health',{expectedStatus:200});
    assert.equal(health.counts.queries,0);assert.equal(health.counts.legacyReads,0);assert.equal(health.counts.workers,0);
    // The driver's default is zero launches: an unexpected one fails the request.
    await assert.rejects(service.request('/v1/setup/managed-step',{},'unexpected-launch',{expectedStatus:200}),{code:'native-assertion-failed'});
  }finally{await service.stop();fs.rmSync(root,{recursive:true,force:true});}
});

test('observer attributes a main-thread launch to its request, not to a worker',{skip:process.platform==='win32',timeout:15000},async()=>{
  const root=fs.mkdtempSync('/tmp/opencode/native-observer-main-'),observations:Observation[]=[];
  const service=await nativeService(isolatedEnvironment(root),o=>observations.push(o),'tests/fixtures/windows-observer-probe.mjs');
  try{
    await assert.rejects(service.request('/v1/setup/managed-step',{mainThread:true},'main-thread',{limitMs:1500}),{code:'native-assertion-failed'});
    const observed=observations.find(o=>o.phase==='main-thread')!;
    assert.equal(observed.counts.queries,1);assert.equal(observed.counts.workers,0);
    assert.ok(observed.counts.elapsedMs<1500);
  }finally{await service.stop();fs.rmSync(root,{recursive:true,force:true});}
});

test('native harness failures expose fixed codes, never exception messages or paths',()=>{
  for(const code of ['native-service-exited','native-observer-timeout'] as const)assert.equal(nativeHarnessCode(new NativeHarnessError(code)),code);
  assert.equal(nativeHarnessCode(new assert.AssertionError({message:'private fixture /fixture/secret'})),'native-assertion-failed');
  assert.equal(nativeHarnessCode(Object.assign(new Error('/fixture/private'),{name:'TimeoutError'})),'native-request-timeout');
  assert.equal(nativeHarnessCode(Object.assign(new Error('/fixture/private'),{code:'ENOENT'})),'native-harness-failed');
});
