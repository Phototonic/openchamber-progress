import path from 'node:path';
import {SetupError,type Payload} from './lifecycle.ts';
import {managedSourceRoots,createManagedBindingDirectory} from '../shared/managed-binding.ts';
import {windows,windowsPaths,STEP_HEADROOM_MS,requirePlatformWriteBoundary,requirePlatformStoreFence,type PlatformRequestBudget} from '../shared/platform.ts';
import {managedJournalProgress,managedFreshJournalProgress,managedRequestDigest,parseManagedStepJournal,parseManagedFreshStepJournal,sameManagedStep,type ManagedStepJournal,type ManagedFreshStepJournal,type ManagedSetupStepJournal,type ManagedCaptureRenewal,type ManagedFreshCaptureRenewal,type ManagedFreshStepIntent} from './managed-step-journal.ts';
import {readManagedStepJournal,readManagedFreshStepJournal,writeManagedStepJournal,upgradeManagedStepJournal,publishManagedStepIntent,managedJournalPaths,observeInitialJournalSave,settleInitialJournalSave} from './managed-migration.ts';
import {ManagedVolumePlacementError,validateManagedInspectionReview,validateManagedFreshInspectionReview,validateManagedFixedPlacement,
  type ManagedInspectionSession,type ManagedFreshInspectionSession} from './managed-inspection.ts';
import {type ManagedSetupStepRequest,type ManagedSetupStepProgress,type ManagedStepDiagnostic,type ManagedFreshStepDiagnostic,type ManagedCaptureObservation} from '../shared/managed-steps.ts';
import {canonical} from '../shared/store.ts';
import {validateManagedStepTarget,validateManagedStepTargetFacts,managedStepEffectClaims,managedStepEffectCommitted,applyManagedStepEffect} from './managed-step-effects.ts';
import {managedDiagnostic,ManagedStepFailure} from './managed-diagnostic.ts';
import type {ManagedVolumeIdentityReader} from './managed-volume-identity.ts';
import {managedVolumeIdentityReader} from './managed-volume-reader.ts';

/** Bounded observation only. It does not admit a Store, infer capture, scan
 * legacy payloads, repair metadata or resume an interrupted operation. */
function readOperation(env:NodeJS.ProcessEnv,version:1|2,observeInitial=false) {
  const roots=managedSourceRoots(env),root=path.join(roots.dataRoot,'agent-progress-managed');
  if(windows)windowsPaths([roots.configRoot,roots.dataRoot,root,path.join(root,'.ownership.json'),
    path.join(root,'migration.json'),path.join(root,'progress-binding.json')],true);
  return (observeInitial?observeInitialJournalSave(env,version)?.journal:undefined)??
    (version===2?readManagedFreshStepJournal(env):readManagedStepJournal(env));
}
export function observeManagedStep(env:NodeJS.ProcessEnv,operationId?:string,version:1|2=1):ManagedSetupStepJournal|undefined {
  const journal=readOperation(env,version,true);
  if(operationId&&journal?.migration.operationId!==operationId)throw new SetupError('not-found');
  return journal;
}

type InspectionSession=ManagedInspectionSession|ManagedFreshInspectionSession;
type Diagnostic=ManagedStepDiagnostic|ManagedFreshStepDiagnostic;
export function managedSetupJournalProgress(journal:ManagedSetupStepJournal,capture?:ManagedCaptureObservation):ManagedSetupStepProgress {
  return journal.migration.format===3?managedFreshJournalProgress(journal as ManagedFreshStepJournal,capture):managedJournalProgress(journal as ManagedStepJournal,capture);
}
function parseJournal(journal:ManagedSetupStepJournal,version:1|2) {
  return version===2?parseManagedFreshStepJournal(JSON.stringify(journal)):parseManagedStepJournal(JSON.stringify(journal));
}
function validateReview(env:NodeJS.ProcessEnv,payload:Payload,session:InspectionSession,read:ManagedVolumeIdentityReader) {
  return 'family' in session?validateManagedFreshInspectionReview(env,payload,session,read):validateManagedInspectionReview(env,payload,session,read);
}
export interface ManagedBeginResult { disposition:'applied'|'replayed'; progress:ManagedSetupStepProgress; journal:ManagedSetupStepJournal }
function replayBegin(env:NodeJS.ProcessEnv,request:Extract<ManagedSetupStepRequest,{action:'begin'}>):ManagedBeginResult {
  const journal=readOperation(env,request.version);
  if(!journal)throw new SetupError('managed-inspection-expired');
  validateBeginReplay(request,journal);
  // The receipt is durable; a service restart need not recover an in-memory
  // review nonce. Never repeat prepare or replay its old capture observation.
  return {disposition:'replayed',progress:managedSetupJournalProgress(journal),journal};
}
function validateBeginReplay(request:Extract<ManagedSetupStepRequest,{action:'begin'}>,journal:ManagedSetupStepJournal) {
  const m=journal.migration,receipt=m.receipt;
  if(m.operationId!==request.operationId||m.sequence!==1||!receipt||receipt.expectedSequence!==0||receipt.outcome!=='applied'||
    receipt.requestDigest!==managedRequestDigest(request,journal))throw new ManagedStepFailure(new SetupError('managed-step-conflict'),'prepare',journal);
}

/** Initial sequenced action only. Caller holds the cross-process worker fence;
 * all publication stays with the existing managed directory/journal owners.
 * A preview from inspection is not a journal until the begin identity, consent
 * and request receipt have been assigned and the strict parser accepts it. */
export function beginManagedStep(env:NodeJS.ProcessEnv,payload:Payload,request:Extract<ManagedSetupStepRequest,{action:'begin'}>,
  budget:PlatformRequestBudget,session?:InspectionSession,read=managedVolumeIdentityReader):ManagedBeginResult {
  requirePlatformWriteBoundary();
  const interrupted=observeInitialJournalSave(env,request.version);
  if(interrupted){
    const {journal}=interrupted;
    validateBeginReplay(request,journal);
    try{recoverInitial(env,payload,budget,interrupted,read);}
    catch(error){throw new ManagedStepFailure(error,'prepare',journal);}
    return replayBegin(env,request);
  }
  // An unrelated inspection cannot revoke an exact durable begin receipt. It
  // grants no authority in this family; only the matching reader may replay it.
  if(session&&(request.version===2)!==('family' in session))return replayBegin(env,request);
  if(!session?.review||session.review.expected!==request.expected)return replayBegin(env,request);
  let reviewed:ReturnType<typeof validateReview>;
  try{reviewed=validateReview(env,payload,session,read);}
  catch(error){
    // A lost reply can leave the old in-memory review next to a new durable
    // receipt. Only that exact receipt can override the stale review refusal.
    try{return replayBegin(env,request);}catch{throw error;}
  }
  if(reviewed.operation)return replayBegin(env,request);
  const next=reviewed.candidate,m=next.migration;
  requirePlatformStoreFence(next.database);
  m.operationId=request.operationId;m.consent.reviewDigest=request.expected;
  m.receipt={requestDigest:managedRequestDigest(request,next),expectedSequence:0,sequence:1,step:m.lastCompleted,outcome:'applied'} as typeof m.receipt;
  parseJournal(next,request.version);
  const validate=()=>{validateReview(env,payload,session,read);};
  if('prior' in reviewed&&reviewed.prior){
    // No directory, capture or removal effect here; refuse near the deadline.
    budget.require(STEP_HEADROOM_MS);
    upgradeManagedStepJournal(env,next as ManagedStepJournal,reviewed.prior,validate,read);
  }else{
    budget.require(STEP_HEADROOM_MS);
    createManagedBindingDirectory(env);
    // A slow disk may leave a valid marker and a missing journal. Refuse before
    // publication; fresh explicit review can recover that state.
    budget.require(STEP_HEADROOM_MS);
    writeManagedStepJournal(env,next,undefined,validate);
  }
  return {disposition:'applied',progress:managedSetupJournalProgress(next),journal:next};
}

/** Private result. journal is an optimization claim for the next worker, NEVER
 * a wire field or cached authority. A cold caller can obtain it via status. */
export interface ManagedMutationResult {
  disposition:'applied'|'replayed'|'refused';
  progress:ManagedSetupStepProgress;
  journal:ManagedSetupStepJournal;
  error:Diagnostic|null;
}
type MutationRequest=Extract<ManagedSetupStepRequest,{action:'advance'|'pause'|'abandon'|'resume'}>;
const unknownCapture={state:'unknown',observedAt:null} as const;
function need(value:unknown,code='managed-step-conflict'):asserts value {if(!value)throw new SetupError(code);}
function loadOperation(env:NodeJS.ProcessEnv,request:MutationRequest,hint?:ManagedSetupStepJournal) {
  if(!hint||(hint.migration.format===3)!==(request.version===2)){
    const current=readOperation(env,request.version);need(current&&current.migration.operationId===request.operationId,'not-found');return current;
  }
  // Only trusted supervisor transport may supply hints. Even there, parse and
  // compare against the private durable record before following the claims.
  const known=parseJournal(hint,request.version);
  if(windows)windowsPaths(managedJournalPaths(known),true);
  const current=request.version===2?readManagedFreshStepJournal(env):readManagedStepJournal(env);need(current&&current.migration.operationId===request.operationId,'not-found');
  // The hint only supplies prebatch paths. Another process may have advanced
  // the same journal; use the freshly read record, never reject valid work or
  // authorize it from the hint. Target validation batches any newly read paths.
  return current;
}
function recoverInitial(env:NodeJS.ProcessEnv,payload:Payload,budget:PlatformRequestBudget,save:NonNullable<ReturnType<typeof observeInitialJournalSave>>,
  read:ManagedVolumeIdentityReader) {
  settleInitialJournalSave(env,save,journal=>{
    validateManagedStepTargetFacts(env,payload,journal,undefined,read,true);
    budget.require(STEP_HEADROOM_MS);
  });
}
function recoverInitialForMutation(env:NodeJS.ProcessEnv,payload:Payload,request:MutationRequest,budget:PlatformRequestBudget,remember:(journal:ManagedSetupStepJournal)=>void,
  read:ManagedVolumeIdentityReader) {
  const save=observeInitialJournalSave(env,request.version);if(!save)return;
  const m=save.journal.migration;
  need(m.operationId===request.operationId,'not-found');
  remember(save.journal);
  need(request.expectedSequence===m.sequence);
  if(request.action==='advance')need(sameManagedStep(request.step,m.step));
  // The checkpoint is pending without any intent; a capture review cannot
  // authorize a resume here. Other lifecycle controls allow pending.
  if(request.action==='resume'&&request.review)throw new SetupError('managed-review-stale');
  recoverInitial(env,payload,budget,save,read);
}
function renewalFor(request:MutationRequest,journal:ManagedSetupStepJournal):ManagedCaptureRenewal|ManagedFreshCaptureRenewal|undefined {
  if(request.action!=='advance')return;
  return journal.migration.captureRenewals.findLast(r=>r.sequence<=request.expectedSequence&&sameManagedStep(r.priorIntent.step,request.step));
}
function result(journal:ManagedSetupStepJournal,disposition:ManagedMutationResult['disposition'],capture:ManagedCaptureObservation=unknownCapture,error:Diagnostic|null=null):ManagedMutationResult {
  return {journal,disposition,progress:managedSetupJournalProgress(journal,capture),error};
}
function replay(request:MutationRequest,journal:ManagedSetupStepJournal):ManagedMutationResult|undefined {
  const receipt=journal.migration.receipt;
  if(receipt?.expectedSequence!==request.expectedSequence)return;
  if(receipt.requestDigest!==managedRequestDigest(request,journal,renewalFor(request,journal)))return;
  return result(journal,'replayed',unknownCapture,receipt.outcome==='failed'?journal.migration.diagnostic:null);
}
function diagnostic(error:unknown,journal:ManagedSetupStepJournal,uncertain=false):Diagnostic {
  const code=managedDiagnostic(error);
  return {stage:journal.migration.step?.name??'journal',code:uncertain&&code==='storage'?'managed-step-unsettled':code};
}

/** Caller holds the cross-process request fence. One advance, no looping into
 * the next step. Retry reconciles intent; capture ambiguity needs fresh review. */
export function advanceManagedStep(env:NodeJS.ProcessEnv,payload:Payload,request:Extract<ManagedSetupStepRequest,{action:'advance'}>,
  budget:PlatformRequestBudget,hint?:ManagedSetupStepJournal,read=managedVolumeIdentityReader):ManagedMutationResult {
  let current:ManagedSetupStepJournal|undefined;
  try{return advance(env,payload,request,budget,hint,journal=>{current=journal;},read);}
  catch(error){throw new ManagedStepFailure(error,request.step.name,current);}
}
function advance(env:NodeJS.ProcessEnv,payload:Payload,request:Extract<ManagedSetupStepRequest,{action:'advance'}>,
  budget:PlatformRequestBudget,hint:ManagedSetupStepJournal|undefined,remember:(journal:ManagedSetupStepJournal)=>void,read:ManagedVolumeIdentityReader):ManagedMutationResult {
  requirePlatformWriteBoundary();
  recoverInitialForMutation(env,payload,request,budget,remember,read);
  let capture:ManagedCaptureObservation=unknownCapture;
  let claims:ReturnType<typeof managedStepEffectClaims>|undefined,evidence:ReturnType<typeof managedStepEffectCommitted>|undefined;
  const prior=(()=>{
    const journal=loadOperation(env,request,hint);
    remember(journal);
    // Receipt replay never needs old payloads/legacy discovery or writes. The
    // projection honestly uses unknown rather than historical capture-on.
    if(!replay(request,journal)){
      const m=journal.migration;
      need(request.expectedSequence===m.sequence&&sameManagedStep(request.step,m.step)&&['pending','running'].includes(m.state));
      if(m.intent){evidence=managedStepEffectCommitted(env,payload,journal,undefined,read);capture=evidence.capture;}
      else {claims=managedStepEffectClaims(env,payload,journal,read);capture=claims.captureBefore;}
    }
    return journal;
  })();
  const repeated=replay(request,prior);if(repeated)return repeated;
  requirePlatformStoreFence(prior.database);
  const m=prior.migration;
  need(request.expectedSequence===m.sequence&&sameManagedStep(request.step,m.step)&&['pending','running'].includes(m.state));
  const renewal=renewalFor(request,prior),requestDigest=managedRequestDigest(request,prior,renewal);
  if(m.state==='running')need(m.intent&&(m.intent.expectedSequence<m.sequence||m.intent.requestDigest===requestDigest));
  let running=structuredClone(prior),freshCapture=false,published=false;
  try{
    if(m.intent){
      // Test the retained effect without claiming a new running state on disk.
      // A pending resumed intent is checked via a read-only projection below.
      if(['enable','disable'].includes(m.step!.name)&&!evidence!.committed){
        need(m.state==='pending'&&renewal&&canonical(renewal.priorIntent)===canonical(m.intent),'managed-step-unsettled');
        running.migration.intent={requestDigest,expectedSequence:m.sequence,step:m.step!,effect:'intent',before:[],after:[],
          captureBefore:capture,captureReviewSequence:renewal.sequence} as typeof running.migration.intent;freshCapture=true;
      }
    }else{
      running.migration.intent={requestDigest,expectedSequence:m.sequence,step:m.step!,effect:'intent',...claims!,captureReviewSequence:null} as typeof running.migration.intent;
      freshCapture=['enable','disable'].includes(m.step!.name);
    }
    running.migration.state='running';running.migration.diagnostic=null;running.migration.capture=capture;
    budget.require(STEP_HEADROOM_MS);
    if(canonical(running)!==canonical(prior)){
      try{publishManagedStepIntent(env,running,prior,()=>{validateManagedStepTarget(env,payload,prior,undefined,read);});}
      catch(error){
        // Atomic rename can succeed before fsync/return fails. Do not report a
        // known pending/no-intent state when publication may already be durable.
        try{
          budget.require();
          const current=(()=>{if(windows)windowsPaths(managedJournalPaths(running),true);return request.version===2?readManagedFreshStepJournal(env):readManagedStepJournal(env);})();
          if(current&&canonical(current)===canonical(running))published=true;
          else if(current&&canonical(current)===canonical(prior))return result(prior,'refused',unknownCapture,diagnostic(error,prior));
          else return result(running,'refused',unknownCapture,diagnostic(error,running,true));
        }catch{return result(running,'refused',unknownCapture,diagnostic(error,running,true));}
        throw error;
      }
    }
    published=true;
    const created=applyManagedStepEffect(env,payload,running,freshCapture,read);
    const next=structuredClone(running),n=next.migration,index=n.plan.findIndex(s=>sameManagedStep(s,n.step));
    n.sequence++;n.lastCompleted=n.step;n.step=n.plan[index+1]??null;n.state=n.step?'pending':'complete';
    if(n.format===2&&n.lastCompleted!.name==='record-removal')n.phase='removed';
    if(n.format===3&&created){
      if(created.directory)n.created.directory=created.directory;
      if(created.database)n.created.database=created.database;
    }
    if(!n.step)n.phase='complete';
    n.intent=null;n.diagnostic=null;n.capture=unknownCapture;
    n.receipt={requestDigest,expectedSequence:m.sequence,sequence:n.sequence,step:n.lastCompleted,outcome:'applied'} as typeof n.receipt;
    writeManagedStepJournal(env,next,running,()=>{
      const evidence=managedStepEffectCommitted(env,payload,running,created,read);need(evidence.committed,'managed-step-unsettled');
      // The public reply uses this fresh observation. Persisted capture remains
      // unknown rather than copying a pre-effect bit into a success checkpoint.
      capture=evidence.capture;
    });
    return result(next,'applied',capture);
  }catch(error){
    const failure=diagnostic(error,running,published);
    if(!published)return result(prior,'refused',unknownCapture,failure);
    // Leave the durable intent for explicit recovery if the reviewed volume
    // stopped verifying. No failure checkpoint on an unproved target.
    if(error instanceof ManagedVolumePlacementError)return result(running,'refused',unknownCapture,failure);
    const failed=structuredClone(running),f=failed.migration;
    f.sequence++;f.state='failed';f.capture=unknownCapture;f.diagnostic=failure;
    f.receipt={requestDigest,expectedSequence:m.sequence,sequence:f.sequence,step:f.step,outcome:'failed'} as typeof f.receipt;
    try{
      // Metadata-only failure settlement cannot assert the failed effect's
      // authority or roll it back. The journal owner still checks private paths,
      // exact current bytes and legal immutable-target evolution.
      budget.require();writeManagedStepJournal(env,failed,running,()=>validateManagedFixedPlacement(running,read));
      return result(failed,'refused',unknownCapture,failure);
    }catch(settlement){return result(running,'refused',unknownCapture,diagnostic(settlement,running,true));}
  }
}

/** Controls retain every unresolved intent. Acquiring the request fence proves
 * no worker is still active; elapsed time alone never authorizes these writes. */
export function controlManagedStep(env:NodeJS.ProcessEnv,payload:Payload,request:Extract<ManagedSetupStepRequest,{action:'pause'|'abandon'|'resume'}>,
  budget:PlatformRequestBudget,hint?:ManagedSetupStepJournal,session?:InspectionSession,read=managedVolumeIdentityReader):ManagedMutationResult {
  let current:ManagedSetupStepJournal|undefined;
  try{return control(env,payload,request,budget,hint,session,journal=>{current=journal;},read);}
  catch(error){throw new ManagedStepFailure(error,request.action==='resume'&&request.review?request.review.step:'lock',current);}
}
function control(env:NodeJS.ProcessEnv,payload:Payload,request:Extract<ManagedSetupStepRequest,{action:'pause'|'abandon'|'resume'}>,
  budget:PlatformRequestBudget,hint:ManagedSetupStepJournal|undefined,session:InspectionSession|undefined,remember:(journal:ManagedSetupStepJournal)=>void,
  read:ManagedVolumeIdentityReader):ManagedMutationResult {
  requirePlatformWriteBoundary();
  recoverInitialForMutation(env,payload,request,budget,remember,read);
  const admitted=(()=>{
    const journal=loadOperation(env,request,hint);
    remember(journal);
    return {journal,capture:replay(request,journal)?unknownCapture:validateManagedStepTarget(env,payload,journal,undefined,read)};
  })();
  const prior=admitted.journal;let capture=admitted.capture;
  const repeated=replay(request,prior);if(repeated)return repeated;
  requirePlatformStoreFence(prior.database);
  const m=prior.migration;
  need(request.expectedSequence===m.sequence);
  const allowed=request.action==='pause'?['pending','failed','running']:request.action==='abandon'?['pending','failed','running','paused']:['pending','paused','failed','abandoned','running'];
  need(allowed.includes(m.state));
  const review=request.action==='resume'?request.review:undefined;
  const captureIntent=m.intent&&['enable','disable'].includes(m.intent.step.name);
  const validateCaptureReview=()=>{
    need(review&&session&&captureIntent&&review.step===m.step?.name&&session.review?.expected===review.expected,'managed-review-stale');
    need((request.version===2)===('family' in session),'managed-review-stale');
    const checked=validateReview(env,payload,session,read);
    need(checked.operation&&canonical(checked.operation)===canonical(prior)&&checked.capture.state!=='unknown','managed-review-stale');
    return checked.capture;
  };
  if(review)capture=validateCaptureReview();
  else if(request.action==='resume'&&captureIntent){
    const renewal=m.captureRenewals.at(-1),authorized=renewal&&canonical(renewal.priorIntent)===canonical(m.intent);
    need(authorized||capture.state===(m.intent!.step.name==='enable'?'on':'off'),'managed-step-unsettled');
  }
  const next=structuredClone(prior),n=next.migration;
  n.sequence++;n.state=request.action==='resume'?'pending':request.action==='pause'?'paused':'abandoned';n.capture=capture;n.diagnostic=null;
  if(review){
    if(n.format===3)n.captureRenewals.push({reviewDigest:review.expected,sequence:n.sequence,priorIntent:structuredClone(m.intent!) as ManagedFreshStepIntent});
    else n.captureRenewals.push({reviewDigest:review.expected,sequence:n.sequence,priorIntent:structuredClone(m.intent!) as ManagedCaptureRenewal['priorIntent']});
  }
  n.receipt={requestDigest:managedRequestDigest(request,prior),expectedSequence:m.sequence,sequence:n.sequence,step:n.step,outcome:'applied'} as typeof n.receipt;
  budget.require();
  writeManagedStepJournal(env,next,prior,()=>{validateManagedStepTarget(env,payload,prior,undefined,read);if(review)validateCaptureReview();});
  return result(next,'applied',capture);
}
