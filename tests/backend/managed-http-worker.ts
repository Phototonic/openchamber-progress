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
if(fault.spentSpawns)Atomics.store(new Int32Array(workerData.counter),0,fault.spentSpawns);
if(fault.hold){
  fs.writeFileSync(workerData.env.TEST_READY_FILE,'ready',{mode:0o600});
  const deadline=Date.now()+10_000;
  while(!fs.existsSync(workerData.env.TEST_RELEASE_FILE)&&Date.now()<deadline)Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);
}
if(fault.clockOffset){const clock=process.hrtime.bigint;process.hrtime.bigint=()=>clock()+BigInt(fault.clockOffset)*1_000_000n;}
if(workerData.env.TEST_WINDOWS==='1'){
  process.env.SystemRoot='C:\\Windows';
  cp.spawnSync=((_command:string,_args:string[],options:cp.SpawnSyncOptionsWithStringEncoding):cp.SpawnSyncReturns<string>=>{
    if(fault.securityError)return {pid:1,output:[],stdout:JSON.stringify({error:fault.securityError}),stderr:'',status:1,signal:null};
    const input=JSON.parse(String(options.input));for(const p of input.create)fs.mkdirSync(p,{mode:0o700});
    return {pid:1,output:[],stdout:JSON.stringify(input.paths.map(()=>({owned:true,private:true,reparse:false,unsafeParent:false}))),stderr:'',status:0,signal:null};
  }) as unknown as typeof cp.spawnSync;
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
syncBuiltinESMExports();
const {runSetupRequestWorker}=await import('../../service/request-worker.ts');
runSetupRequestWorker();
