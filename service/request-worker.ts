import {Worker,isMainThread,parentPort,workerData} from 'node:worker_threads';
import {createServer,type Socket} from 'node:net';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {SetupController} from './setup-controller.ts';
import {PlatformRequestBudget,withPlatformRequestBudget,platformErrorCode} from '../shared/platform.ts';
import {MANAGED_STEP_CODES,MANAGED_STEP_LIMITS,type ManagedStepAccounting} from '../shared/managed-steps.ts';
import {MANAGED_ACTION_CODES,type ManagedSetupAction} from '../shared/progress.ts';
import {storageError} from '../shared/store.ts';
import type {Payload,Action} from '../setup/lifecycle.ts';

/** Private service/worker transport, never an HTTP request or client-selected entry.
 * All mutation paths must use the same writer boundary and perform their fresh
 * validation before any effect. The busy flag alone is NOT the writer fence. */
export type SetupWorkerRequest =
  | {action:'health'|'status'}
  | {action:'run';name:Action|ManagedSetupAction;body:unknown};
export type SetupWorkerResult =
  | {ok:true;value:unknown;accounting:ManagedStepAccounting}
  | {ok:false;code:string;accounting:ManagedStepAccounting};
interface SetupWorkerInput {
  kind:'agent-progress-setup-request';
  env:NodeJS.ProcessEnv;
  payload:Payload;
  request:SetupWorkerRequest;
  startedAt:bigint;
  counter:SharedArrayBuffer;
  fence:{port:number;nonce:string};
}

export function isSetupRequestWorker():boolean {
  return !isMainThread&&workerData?.kind==='agent-progress-setup-request';
}
function diagnostic(error:unknown):string {
  const code=(error as {code?:unknown})?.code;
  return typeof code==='string'&&[...MANAGED_ACTION_CODES,...MANAGED_STEP_CODES].includes(code)
    ?code:platformErrorCode(error)??storageError(error).code;
}
/** Called only by the guarded existing service entry, in a dedicated worker. */
export function runSetupRequestWorker():void {
  if(!isSetupRequestWorker()||!parentPort)throw new Error('managed-step-unsupported');
  const input=workerData as SetupWorkerInput;
  const budget=new PlatformRequestBudget(input.startedAt,input.counter,input.fence);
  let setup:SetupController|undefined;
  let value:unknown,code:string|undefined;
  try {
    value=withPlatformRequestBudget(budget,()=>{
      setup=new SetupController({env:input.env},()=>input.payload);
      const request=input.request;
      if(request.action==='health')return setup.health();
      if(request.action==='status')return setup.status();
      if(request.action==='run')return setup.run(request.name,request.body);
      throw Object.assign(new Error('managed-step-unsupported'),{code:'managed-step-unsupported'});
    });
    budget.require();
  } catch(error) {code=diagnostic(error);}
  finally {try{setup?.close();}catch(error){code??=diagnostic(error);}}
  const accounting={securitySpawns:budget.securitySpawns,elapsedMs:budget.elapsedMs};
  const result:SetupWorkerResult=code?{ok:false,code,accounting}:{ok:true,value,accounting};
  // Never emit exception messages, private worker input or paths on failure.
  if(Buffer.byteLength(JSON.stringify(result))>MANAGED_STEP_LIMITS.responseBytes)
    parentPort.postMessage({ok:false,code:'managed-step-limit',accounting} satisfies SetupWorkerResult);
  else parentPort.postMessage(result);
  parentPort.close();
}

/** One request at a time, no autonomous continuation and no terminate-on-timeout.
 * A timeout settles the reply, NOT the worker: busy remains true until exit.
 * The TCP writer slot is retained over that whole interval. Windows security
 * children also cross the account-scoped mutex/nonce barrier in platform.ts. */
export class SetupRequestWorker {
  private active=false;
  private readonly entry:URL;
  constructor(entry:URL) {this.entry=entry;}
  get busy(){return this.active;}
  run(env:NodeJS.ProcessEnv,payload:Payload,request:SetupWorkerRequest,startedAt=process.hrtime.bigint()):Promise<SetupWorkerResult> {
    const budget=new PlatformRequestBudget(startedAt);
    const refused=(code:string):SetupWorkerResult=>({ok:false,code,accounting:{securitySpawns:budget.securitySpawns,elapsedMs:budget.elapsedMs}});
    if(this.active)return Promise.resolve(refused('managed-step-unsettled'));
    try{budget.require();}catch(error){return Promise.resolve(refused(diagnostic(error)));}
    this.active=true;
    return new Promise(resolve=>{
      let settled=false,launched=false,result:SetupWorkerResult|undefined;
      const finish=(reply:SetupWorkerResult)=>{if(!settled){settled=true;clearTimeout(timer);resolve(reply);}};
      const remaining=Math.max(0,MANAGED_STEP_LIMITS.responseMs-budget.elapsedMs);
      const timer=setTimeout(()=>finish(refused('managed-step-deadline')),remaining);
      // A deliberately conservative product-wide writer slot also covers two
      // discovery scopes sharing a Store. Port collision is a refusal, never
      // permission to connect to or take over another listener. No file/lease
      // survives a process crash, and no user think time holds this slot.
      const fence={port:47329,nonce:randomBytes(32).toString('hex')};
      const expected=Buffer.from(fence.nonce+'\n');
      const sockets=new Set<Socket>();
      const lock=createServer(socket=>{
        sockets.add(socket);socket.once('close',()=>sockets.delete(socket));
        socket.setTimeout(1000,()=>socket.destroy());
        let bytes=Buffer.alloc(0);
        socket.on('error',()=>socket.destroy());
        socket.on('data',chunk=>{
          bytes=Buffer.concat([bytes,chunk]);
          if(bytes.length>expected.length){socket.destroy();return;}
          if(bytes.length!==expected.length)return;
          let admitted=false;
          try{budget.require();admitted=timingSafeEqual(bytes,expected);}catch{/* Expired workers receive no new effect admission. */}
          socket.end(admitted?'ok\n':'no\n');
        });
      });
      const release=(reply:SetupWorkerResult)=>{
        for(const socket of sockets)socket.destroy();
        lock.close(()=>{this.active=false;finish(reply);});
      };
      lock.once('error',()=>{
        if(launched){result=refused('managed-step-unsettled');finish(result);}
        else{this.active=false;finish(refused('managed-step-unsettled'));}
      });
      lock.listen({host:'127.0.0.1',port:fence.port,exclusive:true},()=>{
        let worker:Worker;
        try {
          budget.require();
          worker=new Worker(this.entry,{workerData:{kind:'agent-progress-setup-request',env,payload,request,
            startedAt,counter:budget.counter.buffer,fence} satisfies SetupWorkerInput});
          launched=true;
        } catch(error) {release(refused(diagnostic(error)));return;}
        worker.on('message',(message:SetupWorkerResult)=>{
          // A received message alone is not worker settlement. Wait for exit.
          if(message&&typeof message==='object'&&typeof message.ok==='boolean')result=message;
        });
        worker.once('error',()=>{result=refused('managed-step-unsettled');});
        worker.once('exit',exitCode=>{
          if(exitCode!==0||!result)release(refused('managed-step-unsettled'));
          else if(budget.elapsedMs>=MANAGED_STEP_LIMITS.responseMs)release(refused('managed-step-deadline'));
          else release({...result,accounting:{securitySpawns:budget.securitySpawns,elapsedMs:budget.elapsedMs}});
        });
      });
    });
  }
}
