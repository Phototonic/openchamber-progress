import path from 'node:path';
import {SetupError,type Payload} from './lifecycle.ts';
import {managedSourceRoots,createManagedBindingDirectory} from '../shared/managed-binding.ts';
import {platformSecurityScope,windows,windowsPaths,requirePlatformWriteBoundary,requirePlatformStoreFence,type PlatformRequestBudget} from '../shared/platform.ts';
import {managedJournalProgress,managedRequestDigest,parseManagedStepJournal,sameManagedStep,type ManagedStepJournal,type ManagedCaptureRenewal} from './managed-step-journal.ts';
import {readManagedStepJournal,writeManagedStepJournal,upgradeManagedStepJournal,publishManagedStepIntent,managedJournalPaths} from './managed-migration.ts';
import {validateManagedInspectionReview,type ManagedInspectionSession} from './managed-inspection.ts';
import {type ManagedStepRequest,type ManagedStepProgress,type ManagedStepDiagnostic,type ManagedCaptureObservation} from '../shared/managed-steps.ts';
import {canonical} from '../shared/store.ts';
import {validateManagedStepTarget,managedStepEffectClaims,managedStepEffectCommitted,applyManagedStepEffect} from './managed-step-effects.ts';
import {managedDiagnostic,ManagedStepFailure} from './managed-diagnostic.ts';

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

export interface ManagedBeginResult { disposition:'applied'|'replayed'; progress:ManagedStepProgress; journal:ManagedStepJournal }
function replayBegin(env:NodeJS.ProcessEnv,request:Extract<ManagedStepRequest,{action:'begin'}>):ManagedBeginResult {
  const journal=observeManagedStep(env);
  if(!journal)throw new SetupError('managed-inspection-expired');
  const m=journal.migration,receipt=m.receipt;
  if(m.operationId!==request.operationId||m.sequence!==1||!receipt||receipt.expectedSequence!==0||receipt.outcome!=='applied'||
    receipt.requestDigest!==managedRequestDigest(request,journal))throw new ManagedStepFailure(new SetupError('managed-step-conflict'),'prepare',journal);
  // The receipt is durable; a service restart need not recover an in-memory
  // review nonce. Never repeat prepare or replay its old capture observation.
  return {disposition:'replayed',progress:managedJournalProgress(journal),journal};
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
  requirePlatformStoreFence(next.database);
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
  return {disposition:'applied',progress:managedJournalProgress(next),journal:next};
}

/** Private result. journal is an optimization claim for the next worker, NEVER
 * a wire field or cached authority. A cold caller can obtain it via status. */
export interface ManagedMutationResult {
  disposition:'applied'|'replayed'|'refused';
  progress:ManagedStepProgress;
  journal:ManagedStepJournal;
  error:ManagedStepDiagnostic|null;
}
type MutationRequest=Extract<ManagedStepRequest,{action:'advance'|'pause'|'abandon'|'resume'}>;
const unknownCapture={state:'unknown',observedAt:null} as const;
function need(value:unknown,code='managed-step-conflict'):asserts value {if(!value)throw new SetupError(code);}
function loadOperation(env:NodeJS.ProcessEnv,request:MutationRequest,hint?:ManagedStepJournal) {
  if(!hint){const current=observeManagedStep(env,request.operationId);need(current,'not-found');return current;}
  // Only trusted supervisor transport may supply hints. Even there, parse and
  // compare against the private durable record before following the claims.
  const known=parseManagedStepJournal(JSON.stringify(hint));
  return platformSecurityScope(()=>{
    if(windows)windowsPaths(managedJournalPaths(known),true);
    const current=readManagedStepJournal(env);need(current&&current.migration.operationId===request.operationId,'not-found');
    // The hint only supplies prebatch paths. Another process may have advanced
    // the same journal; use the freshly read record, never reject valid work or
    // authorize it from the hint. Target validation batches any newly read paths.
    return current;
  });
}
function renewalFor(request:MutationRequest,journal:ManagedStepJournal):ManagedCaptureRenewal|undefined {
  if(request.action!=='advance')return;
  return journal.migration.captureRenewals.findLast(r=>r.sequence<=request.expectedSequence&&sameManagedStep(r.priorIntent.step,request.step));
}
function result(journal:ManagedStepJournal,disposition:ManagedMutationResult['disposition'],capture:ManagedCaptureObservation=unknownCapture,error:ManagedStepDiagnostic|null=null):ManagedMutationResult {
  return {journal,disposition,progress:managedJournalProgress(journal,capture),error};
}
function replay(request:MutationRequest,journal:ManagedStepJournal):ManagedMutationResult|undefined {
  const receipt=journal.migration.receipt;
  if(receipt?.expectedSequence!==request.expectedSequence)return;
  if(receipt.requestDigest!==managedRequestDigest(request,journal,renewalFor(request,journal)))return;
  return result(journal,'replayed',unknownCapture,receipt.outcome==='failed'?journal.migration.diagnostic:null);
}
function diagnostic(error:unknown,journal:ManagedStepJournal,uncertain=false):ManagedStepDiagnostic {
  const code=managedDiagnostic(error);
  return {stage:journal.migration.step?.name??'journal',code:uncertain&&code==='storage'?'managed-step-unsettled':code};
}

/** Caller holds the cross-process request fence. One advance, no looping into
 * the next step. Retry reconciles intent; capture ambiguity needs fresh review. */
export function advanceManagedStep(env:NodeJS.ProcessEnv,payload:Payload,request:Extract<ManagedStepRequest,{action:'advance'}>,
  budget:PlatformRequestBudget,hint?:ManagedStepJournal):ManagedMutationResult {
  let current:ManagedStepJournal|undefined;
  try{return advance(env,payload,request,budget,hint,journal=>{current=journal;});}
  catch(error){throw new ManagedStepFailure(error,request.step.name,current);}
}
function advance(env:NodeJS.ProcessEnv,payload:Payload,request:Extract<ManagedStepRequest,{action:'advance'}>,
  budget:PlatformRequestBudget,hint:ManagedStepJournal|undefined,remember:(journal:ManagedStepJournal)=>void):ManagedMutationResult {
  requirePlatformWriteBoundary();
  let capture:ManagedCaptureObservation=unknownCapture;
  let claims:ReturnType<typeof managedStepEffectClaims>|undefined,evidence:ReturnType<typeof managedStepEffectCommitted>|undefined;
  const prior=platformSecurityScope(()=>{
    const journal=loadOperation(env,request,hint);
    remember(journal);
    // Receipt replay never needs old payloads/legacy discovery or writes. The
    // projection honestly uses unknown rather than historical capture-on.
    if(!replay(request,journal)){
      const m=journal.migration;
      need(request.expectedSequence===m.sequence&&sameManagedStep(request.step,m.step)&&['pending','running'].includes(m.state));
      if(m.intent){evidence=managedStepEffectCommitted(env,payload,journal);capture=evidence.capture;}
      else {claims=managedStepEffectClaims(env,payload,journal);capture=claims.captureBefore;}
    }
    return journal;
  });
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
          captureBefore:capture,captureReviewSequence:renewal.sequence};freshCapture=true;
      }
    }else{
      running.migration.intent={requestDigest,expectedSequence:m.sequence,step:m.step!,effect:'intent',...claims!,captureReviewSequence:null};
      freshCapture=['enable','disable'].includes(m.step!.name);
    }
    running.migration.state='running';running.migration.diagnostic=null;running.migration.capture=capture;
    // record-removal has two lifecycle subeffects and therefore needs the sixth
    // batch. Reserve publication, effect(s), checkpoint and readback beforehand.
    const remaining=m.step!.name==='record-removal'?5:4;
    budget.require(remaining,remaining*2_500+1_000);
    if(canonical(running)!==canonical(prior)){
      try{publishManagedStepIntent(env,running,prior,()=>{validateManagedStepTarget(env,payload,prior);});}
      catch(error){
        // Atomic rename can succeed before fsync/return fails. Do not report a
        // known pending/no-intent state when publication may already be durable.
        try{
          budget.require(1,3_500);
          const current=platformSecurityScope(()=>{if(windows)windowsPaths(managedJournalPaths(running),true);return readManagedStepJournal(env);});
          if(current&&canonical(current)===canonical(running))published=true;
          else if(current&&canonical(current)===canonical(prior))return result(prior,'refused',unknownCapture,diagnostic(error,prior));
          else return result(running,'refused',unknownCapture,diagnostic(error,running,true));
        }catch{return result(running,'refused',unknownCapture,diagnostic(error,running,true));}
        throw error;
      }
    }
    published=true;
    applyManagedStepEffect(env,payload,running,freshCapture);
    const next=structuredClone(running),n=next.migration,index=n.plan.findIndex(s=>sameManagedStep(s,n.step));
    n.sequence++;n.lastCompleted=n.step;n.step=n.plan[index+1]??null;n.state=n.step?'pending':'complete';
    if(n.lastCompleted!.name==='record-removal')n.phase='removed';
    if(!n.step)n.phase='complete';
    n.intent=null;n.diagnostic=null;n.capture=unknownCapture;
    n.receipt={requestDigest,expectedSequence:m.sequence,sequence:n.sequence,step:n.lastCompleted,outcome:'applied'};
    writeManagedStepJournal(env,next,running,()=>{
      const evidence=managedStepEffectCommitted(env,payload,running);need(evidence.committed,'managed-step-unsettled');
      // The public reply uses this fresh observation. Persisted capture remains
      // unknown rather than copying a pre-effect bit into a success checkpoint.
      capture=evidence.capture;
    });
    return result(next,'applied',capture);
  }catch(error){
    const failure=diagnostic(error,running,published);
    if(!published)return result(prior,'refused',unknownCapture,failure);
    const failed=structuredClone(running),f=failed.migration;
    f.sequence++;f.state='failed';f.capture=unknownCapture;f.diagnostic=failure;
    f.receipt={requestDigest,expectedSequence:m.sequence,sequence:f.sequence,step:f.step,outcome:'failed'};
    try{
      // Metadata-only failure settlement cannot assert the failed effect's
      // authority or roll it back. The journal owner still checks private paths,
      // exact current bytes and legal immutable-target evolution.
      budget.require(2,6_000);writeManagedStepJournal(env,failed,running);
      return result(failed,'refused',unknownCapture,failure);
    }catch(settlement){return result(running,'refused',unknownCapture,diagnostic(settlement,running,true));}
  }
}

/** Controls retain every unresolved intent. Acquiring the request fence proves
 * no worker is still active; elapsed time alone never authorizes these writes. */
export function controlManagedStep(env:NodeJS.ProcessEnv,payload:Payload,request:Extract<ManagedStepRequest,{action:'pause'|'abandon'|'resume'}>,
  budget:PlatformRequestBudget,hint?:ManagedStepJournal,session?:ManagedInspectionSession):ManagedMutationResult {
  let current:ManagedStepJournal|undefined;
  try{return control(env,payload,request,budget,hint,session,journal=>{current=journal;});}
  catch(error){throw new ManagedStepFailure(error,request.action==='resume'&&request.review?request.review.step:'lock',current);}
}
function control(env:NodeJS.ProcessEnv,payload:Payload,request:Extract<ManagedStepRequest,{action:'pause'|'abandon'|'resume'}>,
  budget:PlatformRequestBudget,hint:ManagedStepJournal|undefined,session:ManagedInspectionSession|undefined,remember:(journal:ManagedStepJournal)=>void):ManagedMutationResult {
  requirePlatformWriteBoundary();
  const admitted=platformSecurityScope(()=>{
    const journal=loadOperation(env,request,hint);
    remember(journal);
    return {journal,capture:replay(request,journal)?unknownCapture:validateManagedStepTarget(env,payload,journal)};
  });
  const prior=admitted.journal;let capture=admitted.capture;
  const repeated=replay(request,prior);if(repeated)return repeated;
  requirePlatformStoreFence(prior.database);
  const m=prior.migration;
  need(request.expectedSequence===m.sequence);
  const allowed=request.action==='pause'?['pending','failed','running']:request.action==='abandon'?['pending','failed','running','paused']:['pending','paused','failed','abandoned','running'];
  need(allowed.includes(m.state));
  const review=request.action==='resume'?request.review:undefined;
  const captureIntent=m.intent&&['enable','disable'].includes(m.intent.step.name);
  const validateReview=()=>{
    need(review&&session&&captureIntent&&review.step===m.step?.name&&session.review?.expected===review.expected,'managed-review-stale');
    const checked=validateManagedInspectionReview(env,payload,session);
    need(checked.operation&&canonical(checked.operation)===canonical(prior)&&checked.capture.state!=='unknown','managed-review-stale');
    return checked.capture;
  };
  if(review)capture=validateReview();
  else if(request.action==='resume'&&captureIntent){
    const renewal=m.captureRenewals.at(-1),authorized=renewal&&canonical(renewal.priorIntent)===canonical(m.intent);
    need(authorized||capture.state===(m.intent!.step.name==='enable'?'on':'off'),'managed-step-unsettled');
  }
  const next=structuredClone(prior),n=next.migration;
  n.sequence++;n.state=request.action==='resume'?'pending':request.action==='pause'?'paused':'abandoned';n.capture=capture;n.diagnostic=null;
  if(review)n.captureRenewals.push({reviewDigest:review.expected,sequence:n.sequence,priorIntent:structuredClone(m.intent!)});
  n.receipt={requestDigest:managedRequestDigest(request,prior),expectedSequence:m.sequence,sequence:n.sequence,step:n.step,outcome:'applied'};
  budget.require(2,6_000);
  writeManagedStepJournal(env,next,prior,()=>{validateManagedStepTarget(env,payload,prior);if(review)validateReview();});
  return result(next,'applied',capture);
}
