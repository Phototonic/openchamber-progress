/** Isolated test worker only. Fault controls are never imported by shipped code. */
import fs from 'node:fs';
import cp from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {workerData} from 'node:worker_threads';

const file=workerData.env.TEST_FAULT_FILE;
const fault=file&&fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{};
process.env.TEST_CRASH_STEP=fault.crashStep??'';
process.env.TEST_CRASH_ORDER=fault.order??'';
process.env.TEST_EFFECT_ERROR=fault.effectError?'1':'';
if(fault.hold){
  fs.writeFileSync(workerData.env.TEST_READY_FILE,'ready',{mode:0o600});
  const deadline=Date.now()+10_000;
  while(!fs.existsSync(workerData.env.TEST_RELEASE_FILE)&&Date.now()<deadline)Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);
}
if(fault.clockOffset){const clock=process.hrtime.bigint;process.hrtime.bigint=()=>clock()+BigInt(fault.clockOffset)*1_000_000n;}
// The projection runs the Windows path on a POSIX host: no permission check
// may start a process, so any attempt fails the request.
cp.spawnSync=(()=>{throw new Error('no permission check may start a process');}) as unknown as typeof cp.spawnSync;
if(fault.unlinkCode){
  const unlink=fs.unlinkSync;
  Object.defineProperty(fs,'unlinkSync',{value:((file:Parameters<typeof unlink>[0])=>{
    if(String(file).includes('migration.json.stage-prepare-'))
      throw Object.assign(new Error('synthetic unlink refusal'),{code:fault.unlinkCode});
    return unlink(file);
  }) as typeof fs.unlinkSync});
}
if(fault.ownerCode){
  const stat=fs.lstatSync,read=fs.readFileSync;let journalRead=false;
  Object.defineProperty(fs,'readFileSync',{value:((p:any,...args:any[])=>{
    const value=(read as any)(p,...args);if(String(p).endsWith('migration.json'))journalRead=true;return value;
  }) as typeof fs.readFileSync});
  Object.defineProperty(fs,'lstatSync',{value:((p:any,...args:any[])=>{
    if(journalRead&&String(p).endsWith('index.js'))throw Object.assign(new Error('not public'),{code:fault.ownerCode});
    return (stat as any)(p,...args);
  }) as typeof fs.lstatSync});
}
if(fault.capture){
  const {Store}=await import('../../shared/store.ts');const set=Store.prototype.setEnabled;
  Store.prototype.setEnabled=function(enabled:boolean){if(fault.capture==='after')set.call(this,enabled);throw new Error('synthetic capture interruption');};
}
if(fault.platformCode){
  const {PlatformError}=await import('../../shared/platform.ts');
  Object.defineProperty(fs,'lstatSync',{value:()=>{throw new PlatformError(fault.platformCode);}});
}
syncBuiltinESMExports();
const {runSetupRequestWorker}=await import('../../service/request-worker.ts');
runSetupRequestWorker();
