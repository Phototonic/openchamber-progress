import {Worker,isMainThread,parentPort,workerData} from 'node:worker_threads';
import {type Socket} from 'node:net';
import {randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {SetupController} from './setup-controller.ts';
import {PlatformRequestBudget,withPlatformRequestBudget,writerTargetPort} from '../shared/platform.ts';
import {MANAGED_STEP_LIMITS,managedStepRequest,type ManagedStepAccounting,type ManagedStepResponse,type ManagedStepRequest} from '../shared/managed-steps.ts';
import {type ManagedSetupAction} from '../shared/progress.ts';
import {canonical,digest} from '../shared/store.ts';
import type {Payload,Action} from '../setup/lifecycle.ts';
import {inspectManagedStep,type ManagedInspectionSession} from '../setup/managed-inspection.ts';
import {beginManagedStep,observeManagedStep,advanceManagedStep,controlManagedStep} from '../setup/managed-step-engine.ts';
import {managedJournalProgress,sameManagedStep,type ManagedStepJournal} from '../setup/managed-step-journal.ts';
import {managedDiagnostic,ManagedStepFailure} from '../setup/managed-diagnostic.ts';
import {observeManagedSetup,controlManagedCapture} from '../setup/managed-observation.ts';
import {setupWriterTargets,acquireWriterSlots} from './writer-fence.ts';
export {withSetupWriter} from './writer-fence.ts';

/** Private service/worker transport, never an HTTP request or client-selected entry.
 * All mutation paths must use the same writer boundary and perform their fresh
 * validation before any effect. The busy flag alone is NOT the writer fence. */
export type SetupWorkerRequest =
  | {action:'health'|'status';descriptor?:string|null}
  | {action:'capture';enabled:boolean;descriptor?:string|null}
  | {action:'managed-step';body:unknown}
  | {action:'run';name:Action|ManagedSetupAction;body:unknown};
export type SetupWorkerResult =
  | {ok:true;value:unknown;accounting:ManagedStepAccounting;health?:SetupWorkerHealth;descriptor?:string|null}
  | {ok:false;code:string;accounting:ManagedStepAccounting;refusal?:ManagedStepResponse};
export interface SetupWorkerHealth {state:string;ready:boolean;sqlite:boolean;diagnostics:string[];subagentRuns:boolean}
interface SetupWorkerInput {
  kind:'agent-progress-setup-request';
  requestId:string;
  env:NodeJS.ProcessEnv;
  payload:Payload;
  request:SetupWorkerRequest;
  startedAt:bigint;
  counter:SharedArrayBuffer;
  fence:{port:number;nonce:string;targets:string[]};
  inspection?:ManagedInspectionSession;
  journal?:ManagedStepJournal;
}
/** Private fields travel only through workerData/parentPort, never HTTP. */
type SetupWorkerMessage={requestId:string;result:SetupWorkerResult;inspection?:ManagedInspectionSession;journal?:ManagedStepJournal};

export function isSetupRequestWorker():boolean {
  return !isMainThread&&workerData?.kind==='agent-progress-setup-request';
}
const diagnostic=managedDiagnostic;

/** Correlate a settled effect with the exact admitted operation/sequence/step.
 * Transport requestId alone cannot protect against a misrouted engine result. */
export function correlatedManagedReply(request:ManagedStepRequest,value:ManagedStepResponse):boolean {
  try {
  if(!value||value.version!==1||!['applied','replayed','observed','refused'].includes(value.disposition))return false;
  const p=value.progress;
  if('operationId' in request&&request.operationId&&p&&p.operationId!==request.operationId)return false;
  if(value.disposition==='refused')return !!value.error;
  if(request.action==='inspect'||request.action==='status')return value.disposition==='observed'&&value.error===null&&
    !(request.action==='status'&&request.operationId&&!p);
  if(!p||!['applied','replayed'].includes(value.disposition)||p.sequence!==(request.action==='begin'?1:request.expectedSequence+1))return false;
  if(value.error)return value.disposition==='replayed'&&p.state==='failed'&&request.action==='advance'&&sameManagedStep(p.step,request.step);
  if(request.action==='begin')return sameManagedStep(p.lastCompleted,{name:'prepare',batch:0});
  if(request.action==='advance')return sameManagedStep(p.lastCompleted,request.step);
  return p.state===(request.action==='resume'?'pending':request.action==='pause'?'paused':'abandoned');
  }catch{return false;}
}

/** Called only by the guarded existing service entry, in a dedicated worker. */
export function runSetupRequestWorker():void {
  if(!isSetupRequestWorker()||!parentPort)throw new Error('managed-step-unsupported');
  const input=workerData as SetupWorkerInput;
  const budget=new PlatformRequestBudget(input.startedAt,input.counter,input.fence);
  let setup:SetupController|undefined;
  let value:unknown,code:string|undefined;
  let inspection:ManagedInspectionSession|undefined;
  let journal:ManagedStepJournal|undefined;
  let refusal:ManagedStepResponse|undefined;
  let health:SetupWorkerHealth|undefined;
  let descriptor:string|null|undefined;
  try {
    value=withPlatformRequestBudget(budget,()=>{
      setup=new SetupController({env:input.env},()=>input.payload);
      const request=input.request;
      if(request.action==='managed-step'){
        const parsed=managedStepRequest(request.body);
        if(!parsed)throw Object.assign(new Error('invalid'),{code:'invalid'});
        if(parsed.action==='begin'){
          const begun=beginManagedStep(input.env,input.payload,parsed,budget,input.inspection);
          journal=begun.journal;
          return {version:1,disposition:begun.disposition,progress:begun.progress,inspection:null,error:null,
            accounting:{securitySpawns:budget.securitySpawns,elapsedMs:budget.elapsedMs}} satisfies ManagedStepResponse;
        }
        if(parsed.action==='status'){
          journal=observeManagedStep(input.env,parsed.operationId);
          return {version:1,disposition:'observed',inspection:null,progress:journal?managedJournalProgress(journal):null,error:null,
            accounting:{securitySpawns:budget.securitySpawns,elapsedMs:budget.elapsedMs}} satisfies ManagedStepResponse;
        }
        if(parsed.action==='advance'||parsed.action==='pause'||parsed.action==='abandon'||parsed.action==='resume'){
          const hint=input.journal??input.inspection?.operation;
          const changed=parsed.action==='advance'?advanceManagedStep(input.env,input.payload,parsed,budget,hint):
            controlManagedStep(input.env,input.payload,parsed,budget,hint,input.inspection);
          journal=changed.journal;
          return {version:1,disposition:changed.disposition,progress:changed.progress,inspection:null,error:changed.error,
            accounting:{securitySpawns:budget.securitySpawns,elapsedMs:budget.elapsedMs}} satisfies ManagedStepResponse;
        }
        if(parsed.action!=='inspect')throw Object.assign(new Error('managed-step-unsupported'),{code:'managed-step-unsupported'});
        if(parsed.cursor&&(!input.inspection||input.inspection.cursor!==parsed.cursor))
          throw Object.assign(new Error('managed-inspection-expired'),{code:'managed-inspection-expired'});
        const inspected=inspectManagedStep(input.env,input.payload,parsed.cursor?input.inspection:undefined,parsed.storeRoot);
        inspection=inspected.session;
        journal=inspection.operation;
        return {version:1,disposition:'observed',inspection:inspected.inspection,progress:inspected.progress,error:null,
          accounting:{securitySpawns:budget.securitySpawns,elapsedMs:budget.elapsedMs}} satisfies ManagedStepResponse;
      }
      if(request.action==='health')return setup.health();
      if(request.action==='status'){
        const observed=observeManagedSetup(input.env,request.descriptor);journal=observed.journal;descriptor=observed.descriptor;
        const ready=observed.status.configured&&observed.status.verified;
        health={state:ready?'ready':observed.status.diagnostics.length?'refused':'unconfigured',ready,sqlite:ready,diagnostics:observed.status.diagnostics,subagentRuns:observed.subagentRuns};
        return observed.status;
      }
      if(request.action==='capture'){const observed=controlManagedCapture(input.env,request.enabled,request.descriptor);descriptor=observed.descriptor;return observed.value;}
      if(request.action==='run')return setup.run(request.name,request.body);
      throw Object.assign(new Error('managed-step-unsupported'),{code:'managed-step-unsupported'});
    });
    budget.require();
  } catch(error) {
    code=diagnostic(error);
    if(input.request.action==='managed-step'){
      const parsed=managedStepRequest(input.request.body);
      const current=error instanceof ManagedStepFailure?error.journal:journal;
      const sameTarget=current&&parsed&&('operationId' in parsed?parsed.operationId===current.migration.operationId:parsed.action==='inspect'||parsed.action==='status');
      const stage=error instanceof ManagedStepFailure?error.stage:parsed?.action==='advance'?parsed.step.name:parsed?.action==='begin'?'prepare':parsed?.action==='inspect'?'roots':'journal';
      refusal={version:1,disposition:'refused',inspection:null,progress:sameTarget?managedJournalProgress(current):null,
        error:{stage,code},accounting:{securitySpawns:budget.securitySpawns,elapsedMs:budget.elapsedMs}};
    }
  }
  finally {try{setup?.close();}catch(error){code??=diagnostic(error);}}
  const accounting={securitySpawns:budget.securitySpawns,elapsedMs:budget.elapsedMs};
  const result:SetupWorkerResult=code?{ok:false,code,accounting,...(refusal?{refusal:{...refusal,accounting}}:{})}:{ok:true,value,accounting,...(health?{health}:{}),...(descriptor!==undefined?{descriptor}:{})};
  // Never emit exception messages, private worker input or paths on failure.
  if(Buffer.byteLength(JSON.stringify(result))>MANAGED_STEP_LIMITS.responseBytes||
    inspection&&Buffer.byteLength(JSON.stringify(inspection))>MANAGED_STEP_LIMITS.journalBytes||
    journal&&Buffer.byteLength(JSON.stringify(journal))>MANAGED_STEP_LIMITS.journalBytes)
    parentPort.postMessage({requestId:input.requestId,result:{ok:false,code:'managed-step-limit',accounting}} satisfies SetupWorkerMessage);
  else parentPort.postMessage({requestId:input.requestId,result,...(!code&&inspection?{inspection}:{}),...(!code&&journal?{journal}:{})} satisfies SetupWorkerMessage);
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
  private journal?:{context:string;value:ManagedStepJournal};
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
    const journal=this.journal?.context===context?this.journal.value:undefined;
    let targets:string[];
    try{targets=setupWriterTargets(env,journal?.database??saved?.candidate?.database);}
    catch(error){this.active=false;return Promise.resolve(refused(diagnostic(error)));}
    const consumesInspection=request.action==='managed-step'&&managedStepRequest(request.body)?.action!=='status';
    // A continuation is single-use, including a failure/deadline. New inspection
    // replaces it. Unrelated requests do not refresh or export its authority.
    if(this.inspection?.context!==context||consumesInspection)this.inspection=undefined;
    // Optimization claims are consumed on every request. A failed/late worker
    // cannot install stale claims for a later mutation; explicit status restores
    // them read-only. Every accepted hint is freshly validated by the engine.
    this.journal=undefined;
    return new Promise(resolve=>{
      let settled=false,result:SetupWorkerResult|undefined;
      let nextInspection:ManagedInspectionSession|undefined;
      let nextJournal:ManagedStepJournal|undefined;
      const finish=(reply:SetupWorkerResult)=>{if(!settled){settled=true;clearTimeout(timer);resolve(reply);}};
      const remaining=Math.max(0,MANAGED_STEP_LIMITS.responseMs-budget.elapsedMs);
      const timer=setTimeout(()=>finish(refused('managed-step-deadline')),remaining);
      // Separate scope and Store slots also fence distinct discovery roots
      // sharing capture control. Routing claims are checked by the fresh owner.
      const fence={port:writerTargetPort(targets[0]!),nonce:randomBytes(32).toString('hex'),targets};
      const expected=Buffer.from(fence.nonce+'\n');
      const sockets=new Set<Socket>();
      const connection=(socket:Socket)=>{
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
      };
      acquireWriterSlots(targets,connection,()=>{result=refused('managed-step-unsettled');finish(result);}).then(unlock=>{
        const release=(reply:SetupWorkerResult)=>{
          for(const socket of sockets)socket.destroy();
          void unlock().then(()=>{this.active=false;finish(reply);});
        };
        let worker:Worker;
        try {
          budget.require();
          worker=new Worker(this.entry,{workerData:{kind:'agent-progress-setup-request',requestId,env,payload,request,
            startedAt,counter:budget.counter.buffer,fence,...(saved&&consumesInspection?{inspection:saved}:{}),...(journal?{journal}:{})} satisfies SetupWorkerInput});
        } catch(error) {release(refused(diagnostic(error)));return;}
        worker.on('message',(message:SetupWorkerMessage)=>{
          // A received message alone is not worker settlement. Wait for exit.
          if(!message||message.requestId!==requestId||result||!message.result||typeof message.result.ok!=='boolean'){
            result=refused('managed-step-unsettled');nextInspection=undefined;nextJournal=undefined;return;
          }
          result=message.result;nextInspection=message.inspection;nextJournal=message.journal;
          if(result.ok&&request.action==='managed-step'){
            const parsed=managedStepRequest(request.body);
            if(!parsed||!correlatedManagedReply(parsed,result.value as ManagedStepResponse)){
              result=refused('managed-step-unsettled');nextInspection=undefined;nextJournal=undefined;
            }
          }
        });
        worker.once('error',()=>{result=refused('managed-step-unsettled');});
        worker.once('exit',exitCode=>{
          if(exitCode!==0||!result)release(refused('managed-step-unsettled'));
          else if(budget.elapsedMs>=MANAGED_STEP_LIMITS.responseMs)release(refused('managed-step-deadline'));
          else {
            if(!settled&&result.ok&&nextInspection&&request.action==='managed-step')this.inspection={context,session:nextInspection};
            if(!settled&&result.ok&&nextJournal&&(request.action==='managed-step'||request.action==='status'))this.journal={context,value:nextJournal};
            const accounting={securitySpawns:budget.securitySpawns,elapsedMs:budget.elapsedMs};
            release({...result,...(result.ok&&request.action==='managed-step'?{value:{...result.value as ManagedStepResponse,accounting}}:{}),
              ...(!result.ok&&result.refusal?{refusal:{...result.refusal,accounting}}:{}),accounting});
          }
        });
      },error=>{this.active=false;finish(refused(diagnostic(error)));});
    });
  }
}
