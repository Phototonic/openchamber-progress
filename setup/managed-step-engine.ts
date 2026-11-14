import path from 'node:path';
import {SetupError,type Payload} from './lifecycle.ts';
import {managedSourceRoots,createManagedBindingDirectory} from '../shared/managed-binding.ts';
import {platformSecurityScope,windows,windowsPaths,requirePlatformWriteBoundary,type PlatformRequestBudget} from '../shared/platform.ts';
import {managedJournalProgress,managedRequestDigest,parseManagedStepJournal,type ManagedStepJournal} from './managed-step-journal.ts';
import {readManagedStepJournal,writeManagedStepJournal,upgradeManagedStepJournal} from './managed-migration.ts';
import {validateManagedInspectionReview,type ManagedInspectionSession} from './managed-inspection.ts';
import type {ManagedStepRequest,ManagedStepProgress} from '../shared/managed-steps.ts';

/** Bounded observation only. It does not admit a Store, infer capture, scan
 * legacy payloads, repair metadata or resume an interrupted operation. */
export function observeManagedStep(env:NodeJS.ProcessEnv,operationId?:string):ManagedStepJournal|undefined {
  return platformSecurityScope(()=>{
    const roots=managedSourceRoots(env),root=path.join(roots.dataRoot,'agent-progress-managed');
    if(windows)windowsPaths([roots.configRoot,roots.dataRoot,root,path.join(root,'.ownership.json'),
      path.join(root,'migration.json'),path.join(root,'progress-binding.json')],true);
    const journal=readManagedStepJournal(env);
    if(operationId&&journal?.migration.operationId!==operationId)throw new SetupError('not-found');
    return journal;
  });
}

export interface ManagedBeginResult { disposition:'applied'|'replayed'; progress:ManagedStepProgress }
function replayBegin(env:NodeJS.ProcessEnv,request:Extract<ManagedStepRequest,{action:'begin'}>):ManagedBeginResult {
  const journal=observeManagedStep(env);
  if(!journal)throw new SetupError('managed-inspection-expired');
  const m=journal.migration,receipt=m.receipt;
  if(m.operationId!==request.operationId||m.sequence!==1||!receipt||receipt.expectedSequence!==0||receipt.outcome!=='applied'||
    receipt.requestDigest!==managedRequestDigest(request,journal))throw new SetupError('managed-step-conflict');
  // The receipt is durable; a service restart need not recover an in-memory
  // review nonce. Never repeat prepare or replay its old capture observation.
  return {disposition:'replayed',progress:managedJournalProgress(journal)};
}

/** Initial sequenced action only. Caller holds the cross-process worker fence;
 * all publication stays with the existing managed directory/journal owners.
 * A preview from inspection is not a journal until the begin identity, consent
 * and request receipt have been assigned and the strict parser accepts it. */
export function beginManagedStep(env:NodeJS.ProcessEnv,payload:Payload,request:Extract<ManagedStepRequest,{action:'begin'}>,
  budget:PlatformRequestBudget,session?:ManagedInspectionSession):ManagedBeginResult {
  requirePlatformWriteBoundary();
  if(!session?.review||session.review.expected!==request.expected)return replayBegin(env,request);
  let reviewed:ReturnType<typeof validateManagedInspectionReview>;
  try{reviewed=validateManagedInspectionReview(env,payload,session);}
  catch(error){
    // A lost reply can leave the old in-memory review next to a new durable
    // receipt. Only that exact receipt can override the stale review refusal.
    try{return replayBegin(env,request);}catch{throw error;}
  }
  if(reviewed.operation)return replayBegin(env,request);
  const next=reviewed.candidate,m=next.migration;
  m.operationId=request.operationId;m.consent.reviewDigest=request.expected;
  m.receipt={requestDigest:managedRequestDigest(request,next),expectedSequence:0,sequence:1,step:m.lastCompleted,outcome:'applied'};
  parseManagedStepJournal(JSON.stringify(next));
  const validate=()=>{validateManagedInspectionReview(env,payload,session);};
  if(reviewed.prior){
    // Admission used one batch. Reserve replacement + readback before the
    // format-1 record can change; no directory, capture or removal effect here.
    budget.require(2,6_000);
    upgradeManagedStepJournal(env,next,reviewed.prior,validate);
  }else{
    // The unchanged directory helper costs three launches on a fresh target;
    // journal publication and its readback cost two. At the specified 2.5s
    // planning latency this leaves one second for non-security settlement.
    budget.require(5,13_500);
    createManagedBindingDirectory(env);
    // An unexpectedly slow helper may leave a valid marker/missing journal.
    // Refuse before publication; fresh explicit review can recover that state.
    budget.require(2,6_000);
    writeManagedStepJournal(env,next,undefined,validate);
  }
  return {disposition:'applied',progress:managedJournalProgress(next)};
}
