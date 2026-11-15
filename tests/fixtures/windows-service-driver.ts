import assert from 'node:assert/strict';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:net';

export const HEALTH_MS=1250,START_MS=12000;
export type Counts={queries:number;legacyReads:number;elapsedMs:number;workers:number};
export type Observation={phase:string;counts:Counts;value:any;status:number;concurrent:boolean};
type HarnessCode='native-service-exited'|'native-observer-timeout'|'native-worker-route-required'|'native-assertion-failed'|'native-request-timeout'|'native-harness-failed';
export class NativeHarnessError extends Error {
  readonly code:HarnessCode;
  constructor(code:HarnessCode){super(code);this.code=code;}
}
/** Fixed test-owned diagnostics only, never an OS error's text, cause or path. */
export function nativeHarnessCode(error:unknown):HarnessCode {
  if(error instanceof NativeHarnessError)return error.code;
  if(error instanceof Error&&error.name==='AssertionError')return 'native-assertion-failed';
  if(error instanceof Error&&['TimeoutError','AbortError'].includes(error.name))return 'native-request-timeout';
  return 'native-harness-failed';
}

/** Authenticated real HTTP; independent preload IPC is correlated by request ID,
 * not response order. In particular a health reply cannot consume step counts. */
export async function nativeService(env:NodeJS.ProcessEnv,observe:(value:Observation)=>void,entry='build/service/main.js'){
  const reserve=createServer();reserve.listen(0,'127.0.0.1');await once(reserve,'listening');
  const port=(reserve.address() as {port:number}).port;await new Promise<void>(r=>reserve.close(()=>r()));
  const started=performance.now();
  const child=spawn(process.execPath,['--import',pathToFileURL(path.resolve('tests/fixtures/windows-service-observer.mjs')).href,path.resolve(entry)],{
    env:{...env,OPENCHAMBER_SERVICE_PORT:String(port),OPENCHAMBER_SERVICE_TOKEN:'fixture-only'},stdio:['ignore','ignore','ignore','ipc'],windowsHide:true});
  type Message={kind:string;id?:string;[key:string]:any};
  const queued=new Map<string,Message>(),waiters=new Map<string,{resolve:(m:Message)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
  const key=(kind:string,id='')=>`${kind}:${id}`;
  child.on('message',(m:Message)=>{const k=key(m.kind,m.id),w=waiters.get(k);if(w){clearTimeout(w.timer);waiters.delete(k);w.resolve(m);}else queued.set(k,m);});
  child.on('exit',()=>{for(const w of waiters.values()){clearTimeout(w.timer);w.reject(new NativeHarnessError('native-service-exited'));}waiters.clear();});
  function message(kind:string,id='',ms=25000){
    const k=key(kind,id),ready=queued.get(k);if(ready){queued.delete(k);return Promise.resolve(ready);}
    return new Promise<Message>((resolve,reject)=>{const timer=setTimeout(()=>{waiters.delete(k);reject(new NativeHarnessError('native-observer-timeout'));},ms);waiters.set(k,{resolve,reject,timer});});
  }
  function cancel(kind:string,id:string){const k=key(kind,id),w=waiters.get(k);if(w){clearTimeout(w.timer);waiters.delete(k);}}
  let sequence=0;
  async function request(route:string,body?:unknown,phase=route,options:{concurrent?:boolean;limitMs?:number;expectedStatus?:number;maxSpawns?:number}={}):Promise<{status:number;value:any;counts:Counts;id:string;waitForWorkerExit:()=>Promise<Message>}>{
    // A synchronous compatibility route cannot answer health while its own
    // thread is held. Never pretend that it is a worker concurrency check.
    if(options.concurrent&&!['/v1/setup','/v1/setup/managed-step','/v1/capture/enable','/v1/capture/disable'].includes(route))throw new NativeHarnessError('native-worker-route-required');
    const id=String(++sequence),begin=performance.now(),limit=options.limitMs??8000;
    const observed=message('request',id);let settled=false,concurrent=false;
    void observed.catch(()=>{}); // IPC may fail before the HTTP response arrives.
    const pending=(async()=>{
      const response=await fetch(`http://127.0.0.1:${port}${route}`,{method:body===undefined?'GET':'POST',headers:{authorization:'Bearer fixture-only','content-type':'application/json','x-native-request':id,...(options.concurrent?{'x-native-hold':'1'}:{})},
        ...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(25000)});
      const value=await response.json(),observation=await observed;
      return {status:response.status,value,counts:{queries:observation.queries,legacyReads:observation.legacyReads,workers:observation.workers,elapsedMs:Math.round(performance.now()-begin)} as Counts};
    })();
    // Attach a rejection handler immediately, including while awaiting the hold.
    const finished=pending.then(()=>{settled=true;return false;},()=>{settled=true;return false;});
    try{
      if(options.concurrent){
        const held=await Promise.race([message('held',id).then(()=>true),finished]);
        if(held){
          try{
            assert.equal(settled,false,'step must still be held while health is requested');
            const health=await request('/health',undefined,`${phase}-health`,{limitMs:HEALTH_MS,maxSpawns:0,expectedStatus:200});
            assert.equal(health.counts.legacyReads,0,'concurrent health must not inspect legacy files');
            assert.equal(health.counts.workers,0,'concurrent health must not launch a worker');
            assert.equal(settled,false,'health must finish before the held step is released');concurrent=true;
          }finally{child.send({kind:'release',id});}
        }else cancel('held',id);
      }
      const result=await pending;
      observe({...result,phase,concurrent}); // Trace BEFORE assertions, also on refusals.
      assert.ok(result.counts.elapsedMs<=limit,`${phase}: request exceeded ${limit}ms`);
      assert.ok(result.counts.queries<=(options.maxSpawns??6),`${phase}: actual security spawn ceiling exceeded`);
      if(result.value.accounting)assert.equal(result.counts.queries,result.value.accounting.securitySpawns,`${phase}: independent/engine spawn counts disagree`);
      if(options.expectedStatus!==undefined)assert.equal(result.status,options.expectedStatus,`${phase}: unexpected HTTP status`);
      if(options.concurrent&&result.counts.queries>0)assert.ok(concurrent,`${phase}: missing concurrent health evidence`);
      return {...result,id,waitForWorkerExit:async()=>{
        const exited=await message('worker-exit',id);
        assert.equal(exited.queries,result.counts.queries,`${phase}: late worker launched unaccounted security work`);
        return exited;
      }};
    }catch(error){
      // Settle any pending promise before teardown; never leave an unhandled
      // HTTP/IPC failure obscuring the sanitized native trace.
      if(!settled){child.send({kind:'release',id});await pending.catch(()=>{});}
      throw new NativeHarnessError(nativeHarnessCode(error));
    }finally{cancel('held',id);cancel('request',id);}
  }
  async function stop(){
    if(child.exitCode===null&&child.signalCode===null){const exit=once(child,'exit');child.kill();const timer=setTimeout(()=>child.kill('SIGKILL'),3000);try{await exit;}finally{clearTimeout(timer);}}
    for(const w of waiters.values())clearTimeout(w.timer);waiters.clear();
  }
  try{
    await message('listening','',START_MS);const before=await message('before-listen');
    assert.equal(before.queries,0);assert.equal(before.legacyReads,0);
    const health=await request('/health',undefined,'first-health',{limitMs:HEALTH_MS,maxSpawns:0,expectedStatus:200});
    assert.equal(health.value.state,'starting');assert.equal(health.value.ready,false);assert.equal(health.value.sqlite,false);
    assert.equal(health.value.managedMigrationSteps,1);assert.equal(health.counts.legacyReads,0);
    assert.ok(performance.now()-started<START_MS,'child handshake exceeded startup budget');
    return {request,stop,async settings(fault:null|'timeout'|'private'|'overrun'=null,latencyMs=0){child.send({kind:'settings',fault,latencyMs});await message('settings-set');}};
  }catch(error){await stop();throw new NativeHarnessError(nativeHarnessCode(error));}
}
