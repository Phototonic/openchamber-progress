import {Worker,isMainThread,parentPort,workerData} from 'node:worker_threads';
import {createServer,type Socket} from 'node:net';
import {randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {SetupController} from './setup-controller.ts';
import {PlatformRequestBudget,withPlatformRequestBudget,platformErrorCode} from '../shared/platform.ts';
import {MANAGED_STEP_CODES,MANAGED_STEP_LIMITS,managedStepRequest,type ManagedStepAccounting,type ManagedStepResponse} from '../shared/managed-steps.ts';
import {MANAGED_ACTION_CODES,type ManagedSetupAction} from '../shared/progress.ts';
import {storageError,canonical,digest} from '../shared/store.ts';
import type {Payload,Action} from '../setup/lifecycle.ts';
import {inspectManagedStep,type ManagedInspectionSession} from '../setup/managed-inspection.ts';

/** Private service/worker transport, never an HTTP request or client-selected entry.
 * All mutation paths must use the same writer boundary and perform their fresh
 * validation before any effect. The busy flag alone is NOT the writer fence. */
export type SetupWorkerRequest =
  | {action:'health'|'status'}
  | {action:'managed-step';body:unknown}
  | {action:'run';name:Action|ManagedSetupAction;body:unknown};
export type SetupWorkerResult =
  | {ok:true;value:unknown;accounting:ManagedStepAccounting}
  | {ok:false;code:string;accounting:ManagedStepAccounting};
interface SetupWorkerInput {
  kind:'agent-progress-setup-request';
  requestId:string;
  env:NodeJS.ProcessEnv;
  payload:Payload;
  request:SetupWorkerRequest;
  startedAt:bigint;
  counter:SharedArrayBuffer;
  fence:{port:number;nonce:string};
  inspection?:ManagedInspectionSession;
}
/** Private fields travel only through workerData/parentPort, never HTTP. */
type SetupWorkerMessage={requestId:string;result:SetupWorkerResult;inspection?:ManagedInspectionSession};

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
  let inspection:ManagedInspectionSession|undefined;
  try {
    value=withPlatformRequestBudget(budget,()=>{
      setup=new SetupController({env:input.env},()=>input.payload);
      const request=input.request;
      if(request.action==='managed-step'){
        const parsed=managedStepRequest(request.body);
        if(!parsed)throw Object.assign(new Error('invalid'),{code:'invalid'});
        if(parsed.action!=='inspect')throw Object.assign(new Error('managed-step-unsupported'),{code:'managed-step-unsupported'});
        if(parsed.cursor&&(!input.inspection||input.inspection.cursor!==parsed.cursor))
          throw Object.assign(new Error('managed-inspection-expired'),{code:'managed-inspection-expired'});
        const inspected=inspectManagedStep(input.env,input.payload,parsed.cursor?input.inspection:undefined,parsed.storeRoot);
        inspection=inspected.session;
        return {version:1,disposition:'observed',inspection:inspected.inspection,progress:inspected.progress,error:null,
          accounting:{securitySpawns:budget.securitySpawns,elapsedMs:budget.elapsedMs}} satisfies ManagedStepResponse;
      }
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
  if(Buffer.byteLength(JSON.stringify(result))>MANAGED_STEP_LIMITS.responseBytes||
    inspection&&Buffer.byteLength(JSON.stringify(inspection))>MANAGED_STEP_LIMITS.journalBytes)
    parentPort.postMessage({requestId:input.requestId,result:{ok:false,code:'managed-step-limit',accounting}} satisfies SetupWorkerMessage);
  else parentPort.postMessage({requestId:input.requestId,result,...(!code&&inspection?{inspection}:{})} satisfies SetupWorkerMessage);
  parentPort.close();
}

/** One request at a time, no autonomous continuation and no terminate-on-timeout.
 * A timeout settles the reply, NOT the worker: busy remains true until exit.
 * The TCP writer slot is retained over that whole interval. Windows security
 * children also cross the account-scoped mutex/nonce barrier in platform.ts. */
export class SetupRequestWorker {
  private active=false;
  private readonly entry:URL;
  private inspection?:{context:string;session:ManagedInspectionSession};
  constructor(entry:URL) {this.entry=entry;}
  get busy(){return this.active;}
  run(env:NodeJS.ProcessEnv,payload:Payload,request:SetupWorkerRequest,startedAt=process.hrtime.bigint()):Promise<SetupWorkerResult> {
    const budget=new PlatformRequestBudget(startedAt);
    const refused=(code:string):SetupWorkerResult=>({ok:false,code,accounting:{securitySpawns:budget.securitySpawns,elapsedMs:budget.elapsedMs}});
    if(this.active)return Promise.resolve(refused('managed-step-unsettled'));
    try{budget.require();}catch(error){return Promise.resolve(refused(diagnostic(error)));}
    this.active=true;
    const context=digest(canonical({env,payload})),requestId=randomUUID();
    const saved=this.inspection?.context===context?this.inspection.session:undefined;
    // A continuation is single-use, including a failure/deadline. New inspection
    // replaces it. Unrelated requests do not refresh or export its authority.
    if(this.inspection?.context!==context||request.action==='managed-step')this.inspection=undefined;
    return new Promise(resolve=>{
      let settled=false,launched=false,result:SetupWorkerResult|undefined;
      let nextInspection:ManagedInspectionSession|undefined;
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
      lock.once('error',(error:NodeJS.ErrnoException)=>{
        if(launched){result=refused('managed-step-unsettled');finish(result);}
        else{this.active=false;finish(refused(error.code==='EADDRINUSE'?'managed-step-port-busy':'managed-step-unsettled'));}
      });
      lock.listen({host:'127.0.0.1',port:fence.port,exclusive:true},()=>{
        let worker:Worker;
        try {
          budget.require();
          worker=new Worker(this.entry,{workerData:{kind:'agent-progress-setup-request',requestId,env,payload,request,
            startedAt,counter:budget.counter.buffer,fence,...(saved&&request.action==='managed-step'?{inspection:saved}:{})} satisfies SetupWorkerInput});
          launched=true;
        } catch(error) {release(refused(diagnostic(error)));return;}
        worker.on('message',(message:SetupWorkerMessage)=>{
          // A received message alone is not worker settlement. Wait for exit.
          if(!message||message.requestId!==requestId||result||!message.result||typeof message.result.ok!=='boolean'){
            result=refused('managed-step-unsettled');nextInspection=undefined;return;
          }
          result=message.result;nextInspection=message.inspection;
        });
        worker.once('error',()=>{result=refused('managed-step-unsettled');});
        worker.once('exit',exitCode=>{
          if(exitCode!==0||!result)release(refused('managed-step-unsettled'));
          else if(budget.elapsedMs>=MANAGED_STEP_LIMITS.responseMs)release(refused('managed-step-deadline'));
          else {
            if(!settled&&result.ok&&nextInspection&&request.action==='managed-step')this.inspection={context,session:nextInspection};
            const accounting={securitySpawns:budget.securitySpawns,elapsedMs:budget.elapsedMs};
            release({...result,...(result.ok&&request.action==='managed-step'?{value:{...result.value as ManagedStepResponse,accounting}}:{}),accounting});
          }
        });
      });
    });
  }
}
