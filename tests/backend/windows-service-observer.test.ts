import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {isolatedEnvironment} from '../fixtures/managed.ts';
import {nativeService,type Observation} from '../fixtures/windows-service-driver.ts';

test('native observer attributes worker attempts/reads separately from concurrent health',{skip:process.platform==='win32',timeout:15000},async()=>{
  const root=fs.mkdtempSync('/tmp/opencode/native-observer-'),observations:Observation[]=[];
  const service=await nativeService(isolatedEnvironment(root),o=>observations.push(o),'tests/fixtures/windows-observer-probe.mjs');
  try{
    const request=await service.request('/probe',{},'probe',{concurrent:true,expectedStatus:200});
    assert.equal(request.counts.queries,2,'both real failed launch attempts count');assert.equal(request.counts.legacyReads,1);assert.equal(request.counts.workers,1);
    assert.equal(observations.find(o=>o.phase==='probe')!.concurrent,true);
    const health=observations.find(o=>o.phase==='probe-health')!;
    assert.equal(health.counts.queries,0);assert.equal(health.counts.legacyReads,0);assert.equal(health.counts.workers,0);
    await service.settings(null,2500);
    const delayed=await service.request('/probe',{},'delayed',{concurrent:true,expectedStatus:200});
    assert.equal(delayed.counts.queries,2);assert.ok(delayed.counts.elapsedMs>=5000,'latency injection crosses the worker boundary');
  }finally{await service.stop();fs.rmSync(root,{recursive:true,force:true});}
});
