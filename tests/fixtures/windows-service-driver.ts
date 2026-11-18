import assert from 'node:assert/strict';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:net';

export const HEALTH_MS=1250,START_MS=12000;
export type Counts={queries:number;legacyReads:number;elapsedMs:number;workers:number};
export type Observation={phase:string;counts:Counts;value:any;status:number};
type HarnessCode='native-service-exited'|'native-observer-timeout'|'native-assertion-failed'|'native-request-timeout'|'native-harness-failed';
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
 * not response order. In particular a health reply cannot consume step counts.
 * `queries` counts every child-process launch the service makes: it must be 0. */
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
  async function request(route:string,body?:unknown,phase=route,options:{limitMs?:number;expectedStatus?:number;maxSpawns?:number}={}):Promise<{status:number;value:any;counts:Counts;id:string;waitForWorkerExit:()=>Promise<Message>}>{
    const id=String(++sequence),begin=performance.now(),limit=options.limitMs??8000;
    const observed=message('request',id);
    void observed.catch(()=>{}); // IPC may fail before the HTTP response arrives.
    try{
      const response=await fetch(`http://127.0.0.1:${port}${route}`,{method:body===undefined?'GET':'POST',headers:{authorization:'Bearer fixture-only','content-type':'application/json','x-native-request':id},
        ...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(25000)});
      const value=await response.json(),observation=await observed;
      const result={status:response.status,value,counts:{queries:observation.queries,legacyReads:observation.legacyReads,workers:observation.workers,elapsedMs:Math.round(performance.now()-begin)} as Counts};
      observe({...result,phase}); // Trace BEFORE assertions, also on refusals.
      assert.ok(result.counts.elapsedMs<=limit,`${phase}: request exceeded ${limit}ms`);
      assert.ok(result.counts.queries<=(options.maxSpawns??0),`${phase}: the service started a process`);
      if(result.value.accounting)assert.equal(result.counts.queries,result.value.accounting.securitySpawns,`${phase}: independent/engine launch counts disagree`);
      if(options.expectedStatus!==undefined)assert.equal(result.status,options.expectedStatus,`${phase}: unexpected HTTP status`);
      return {...result,id,waitForWorkerExit:async()=>{
        const exited=await message('worker-exit',id);
        assert.equal(exited.queries,result.counts.queries,`${phase}: late worker started a process`);
        return exited;
      }};
    }catch(error){
      throw new NativeHarnessError(nativeHarnessCode(error));
    }finally{cancel('request',id);}
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
    return {request,stop};
  }catch(error){await stop();throw new NativeHarnessError(nativeHarnessCode(error));}
}
