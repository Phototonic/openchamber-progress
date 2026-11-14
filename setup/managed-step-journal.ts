/** Private durable contract, NOT an HTTP DTO. Parsed claims are never authority. */
import type { Binding } from '../shared/binding.ts';
import type { ManagedCaptureObservation, ManagedEffectState, ManagedOperationState, ManagedStepDiagnostic, ManagedStepRef } from '../shared/managed-steps.ts';
import { MANAGED_STEP_LIMITS, MANAGED_MIGRATION_STEPS, MANAGED_INSPECTION_STEPS, MANAGED_STEP_CODES, MANAGED_OPERATION_TRANSITIONS } from '../shared/managed-steps.ts';
import type { ManagedStepRequest, ManagedStepProgress } from '../shared/managed-steps.ts';
import { MANAGED_ACTION_CODES } from '../shared/progress.ts';
import { canonical, digest } from '../shared/store.ts';
import { SetupError, migrationOwnership } from './lifecycle.ts';
import path from 'node:path';

/** Claims only: fresh path/ACL/object/hash validation is mandatory before use. */
export interface ManagedPathClaim {
  path: string;
  kind: 'directory' | 'file' | 'absent';
  /** Native identity represented as strings, never lossy JS integer inode values. */
  object: { device: string; inode: string; birthNs: string } | null;
  /** SHA-256 of file bytes; null for directories/absence. No ACL verdict is persisted. */
  digest: string | null;
}

export interface ManagedStepReceipt {
  /** Digest of canonical full request, binding and consent; never a bearer token. */
  requestDigest: string;
  expectedSequence: number;
  sequence: number;
  step: ManagedStepRef | null;
  outcome: 'applied' | 'failed';
}

export interface ManagedStepIntent {
  requestDigest: string;
  expectedSequence: number;
  step: ManagedStepRef;
  effect: Exclude<ManagedEffectState, 'none'>;
  /** Exact pre/post claims for this one effect. Absent alone is never proof of removal. */
  before: ManagedPathClaim[];
  after: ManagedPathClaim[];
  captureBefore: ManagedCaptureObservation;
  /** Null for original consent; otherwise the one-use reviewed-resume sequence. */
  captureReviewSequence: number | null;
}

/** Retained even after renewed intent settles; a review never erases uncertain effects. */
export interface ManagedCaptureRenewal {
  reviewDigest: string;
  sequence: number;
  priorIntent: ManagedStepIntent;
}

/** Receipt evidence proves prior removal only; it never authorizes deleting remaining files. */
export type ManagedLegacyEvidence =
  | { kind: 'manifest'; ownership: string; ownershipDigest: string; claims: ManagedPathClaim[] }
  | { kind: 'removal-receipt'; ownership: null; ownershipDigest: null; claims: ManagedPathClaim[];
      receipt: { history: ManagedPathClaim; entry: string } };

/** Stored at the existing managed migration.json location. Keeping the Binding
 * envelope and raising migration.format makes the format-1 reader refuse, not
 * mistake unfinished steps for absence or a resumable old monolithic migration. */
export interface ManagedStepJournal extends Binding {
  migration: {
    format: 2;
    product: 'openchamber-agent-progress-managed';
    /** Conservative old coarse phase; never complete before reconciliation. */
    phase: 'pending' | 'removed' | 'complete';
    legacyInstallId: string;
    operationId: string;
    sequence: number;
    state: ManagedOperationState;
    step: ManagedStepRef | null;
    lastCompleted: ManagedStepRef | null;
    consent: { reviewDigest: string; targetDigest: string; planDigest: string };
    /** Reviewed package bytes; a restart/update cannot silently change them. */
    expectation: { version: string; fingerprint: string };
    /** Ordered frozen one-effect plan; bounded by the journal byte limit. */
    plan: ManagedStepRef[];
    /** Original bytes when available; otherwise explicit owner-validated removal evidence.
     * Parsing uses the existing lifecycle owner's validation, never trust-by-copy. */
    legacy: ManagedLegacyEvidence;
    /** Append-only, bounded by journalBytes; no renewed effect if evidence cannot fit. */
    captureRenewals: ManagedCaptureRenewal[];
    /** At most one current unresolved effect and one most recently settled request. */
    intent: ManagedStepIntent | null;
    receipt: ManagedStepReceipt | null;
    capture: ManagedCaptureObservation;
    diagnostic: ManagedStepDiagnostic | null;
  };
}

function need(value:unknown):asserts value {if(!value)throw new SetupError('managed-journal-unsupported');}
function record(value:unknown):asserts value is Record<string,unknown> {
  need(value!==null&&typeof value==='object'&&!Array.isArray(value));
}
function keys(value:unknown,names:string[]):asserts value is Record<string,unknown> {
  record(value);need(Object.keys(value).length===names.length&&names.every(name=>Object.hasOwn(value,name)));
}
const hash=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const integer=(value:unknown):value is number=>Number.isSafeInteger(value)&&(value as number)>=0;
const text=(value:unknown,max=256):value is string=>typeof value==='string'&&value.length>0&&!value.includes('\0')&&Buffer.byteLength(value)<=max;
const version=(value:unknown)=>text(value)&&/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i.test(value);
function pathname(value:unknown):asserts value is string {
  need(text(value,MANAGED_STEP_LIMITS.pathBytes));
  // Syntax only. Native canonical spelling, ancestors and ACLs are revalidated
  // by the filesystem owner, never by this portable journal parser.
  const dialect=/^[a-z]:[\\/]/i.test(value)?path.win32:path.posix;
  need(dialect.isAbsolute(value)&&dialect.normalize(value)===value);
}
function capture(value:unknown):asserts value is ManagedCaptureObservation {
  keys(value,['state','observedAt']);
  if(value.state==='unknown')need(value.observedAt===null);
  else {
    need(value.state==='on'||value.state==='off');need(typeof value.observedAt==='string');
    const time=Date.parse(value.observedAt);need(Number.isFinite(time)&&new Date(time).toISOString()===value.observedAt);
  }
}
function step(value:unknown):asserts value is ManagedStepRef {
  keys(value,['name','batch']);need(MANAGED_MIGRATION_STEPS.includes(value.name as ManagedStepRef['name'])&&integer(value.batch));
  need(['remove-selector','remove-discovery'].includes(value.name as string)||value.batch===0);
}
export function sameManagedStep(a:ManagedStepRef|null,b:ManagedStepRef|null) {
  return a===null||b===null?a===b:a.name===b.name&&a.batch===b.batch;
}
function claims(value:unknown,known:Set<string>,anticipated=false):asserts value is ManagedPathClaim[] {
  need(Array.isArray(value));
  if(value.length>MANAGED_STEP_LIMITS.claimPaths)throw new SetupError('managed-step-limit');
  const local=new Set<string>();
  for(const claim of value){
    keys(claim,['path','kind','object','digest']);pathname(claim.path);
    need(!local.has(claim.path));local.add(claim.path);known.add(claim.path);
    if(known.size>MANAGED_STEP_LIMITS.claimPaths)throw new SetupError('managed-step-limit');
    need(['file','directory','absent'].includes(claim.kind as string));
    if(claim.kind==='absent')need(claim.object===null&&claim.digest===null);
    else {
      // A publication intent can predict bytes, not the native identity of a
      // not-yet-created file. Observed/before claims may never omit identity.
      if(!anticipated||claim.object!==null){
        keys(claim.object,['device','inode','birthNs']);
        for(const id of Object.values(claim.object))need(typeof id==='string'&&/^(0|[1-9]\d{0,39})$/.test(id));
      }
      need(claim.kind==='file'?hash(claim.digest):claim.digest===null);
    }
  }
}
function intent(value:unknown,known:Set<string>):asserts value is ManagedStepIntent {
  keys(value,['requestDigest','expectedSequence','step','effect','before','after','captureBefore','captureReviewSequence']);
  need(hash(value.requestDigest)&&integer(value.expectedSequence));step(value.step);
  need(value.step.name!=='prepare'&&['intent','uncertain','committed'].includes(value.effect as string));
  claims(value.before,known);claims(value.after,known,true);capture(value.captureBefore);
  need(value.captureReviewSequence===null||integer(value.captureReviewSequence)&&value.captureReviewSequence>0&&
    value.captureReviewSequence<=value.expectedSequence&&['enable','disable'].includes(value.step.name));
}
/** Binding projection deliberately excludes migration metadata from target hashes. */
export function managedJournalBinding(journal:Binding):Binding {
  const {protocolVersion,schemaVersion,installId,version,database,storeId,source}=journal;
  return {protocolVersion,schemaVersion,installId,version,database,storeId,source:{...source}};
}
export function managedTargetDigest(journal:ManagedStepJournal):string {
  const {legacyInstallId,legacy,expectation}=journal.migration;
  return digest(canonical({binding:managedJournalBinding(journal),legacyInstallId,legacy,expectation}));
}
/** Caller first validates the full request shape. No fields are projected away. */
export function managedRequestDigest(request:ManagedStepRequest,journal:ManagedStepJournal,renewal?:ManagedCaptureRenewal):string {
  return digest(canonical({request,targetDigest:journal.migration.consent.targetDigest,consent:journal.migration.consent,
    ...(renewal?{captureReviewSequence:renewal.sequence,captureReviewDigest:renewal.reviewDigest}:{})}));
}

/** Strict, bounded syntax/consistency validation only. Does not read any claimed
 * path, validate Store identity or confer removal/capture/publication authority. */
export function parseManagedStepJournal(bytes:string|Uint8Array):ManagedStepJournal {
  if(Buffer.byteLength(bytes)>MANAGED_STEP_LIMITS.journalBytes)throw new SetupError('managed-step-limit');
  let raw:unknown;
  try{raw=JSON.parse(typeof bytes==='string'?bytes:new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
  catch{throw new SetupError('managed-journal-unsupported');}
  keys(raw,['protocolVersion','schemaVersion','installId','version','database','storeId','source','migration']);
  need(raw.protocolVersion===2&&raw.schemaVersion===2&&text(raw.installId)&&version(raw.version)&&text(raw.storeId));
  pathname(raw.database);need((/^[a-z]:/i.test(raw.database)?path.win32:path.posix).basename(raw.database)==='progress.sqlite');
  keys(raw.source,['id','configRoot','dataRoot','verified']);need(text(raw.source.id)&&raw.source.verified===true);
  pathname(raw.source.configRoot);pathname(raw.source.dataRoot);
  const m=raw.migration;
  keys(m,['format','product','phase','legacyInstallId','operationId','sequence','state','step','lastCompleted','consent',
    'expectation','plan','legacy','captureRenewals','intent','receipt','capture','diagnostic']);
  need(m.format===2&&m.product==='openchamber-agent-progress-managed');
  need(['pending','removed','complete'].includes(m.phase as string)&&text(m.legacyInstallId)&&m.legacyInstallId!==raw.installId);
  need(typeof m.operationId==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(m.operationId));
  need(integer(m.sequence)&&m.sequence>=1&&typeof m.state==='string'&&Object.hasOwn(MANAGED_OPERATION_TRANSITIONS,m.state));
  keys(m.consent,['reviewDigest','targetDigest','planDigest']);need(Object.values(m.consent).every(hash));
  keys(m.expectation,['version','fingerprint']);need(version(m.expectation.version)&&hash(m.expectation.fingerprint));
  const known=new Set<string>(),legacy=m.legacy;
  record(legacy);
  if(legacy.kind==='manifest'){
    keys(legacy,['kind','ownership','ownershipDigest','claims']);
    need(text(legacy.ownership,MANAGED_STEP_LIMITS.journalBytes)&&hash(legacy.ownershipDigest)&&digest(legacy.ownership)===legacy.ownershipDigest);
    // Structural manifest parsing stays with the lifecycle/removal owner. It is
    // not equivalent to that owner's fresh file/selector/retained-release checks.
    need(migrationOwnership(legacy.ownership).installId===m.legacyInstallId);
  }else{
    keys(legacy,['kind','ownership','ownershipDigest','claims','receipt']);
    need(legacy.kind==='removal-receipt'&&legacy.ownership===null&&legacy.ownershipDigest===null);
    keys(legacy.receipt,['history','entry']);claims([legacy.receipt.history],known);
    const history=legacy.receipt.history as unknown as ManagedPathClaim;need(history.kind==='file');
    need(text(legacy.receipt.entry,MANAGED_STEP_LIMITS.journalBytes)&&!/[\r\n]/.test(legacy.receipt.entry));
    let event:unknown;try{event=JSON.parse(legacy.receipt.entry);}catch{throw new SetupError('managed-journal-unsupported');}
    record(event);need(event.action==='remove-capture'&&event.installId===m.legacyInstallId);
  }
  claims(legacy.claims,known);
  need(Array.isArray(m.plan));
  if(m.plan.length>MANAGED_STEP_LIMITS.claimPaths+8)throw new SetupError('managed-step-limit');
  m.plan.forEach(step);
  // The grammar, including contiguous zero-based batches and manifest-last
  // discovery, is fixed. It cannot be replaced by a syntactically valid reorder.
  const plan=m.plan as ManagedStepRef[];let index=0;
  const take=(name:ManagedStepRef['name'])=>{need(sameManagedStep(plan[index++]??null,{name,batch:0}));};
  take('prepare');take('expectation');
  if(legacy.kind==='manifest'){
    take('disable');
    for(let batch=0;plan[index]?.name==='remove-selector';batch++)need(plan[index++]!.batch===batch);
    for(let batch=0;batch<6;batch++)need(sameManagedStep(plan[index++]??null,{name:'remove-discovery',batch}));
    take('record-removal');
  }
  take('publish-binding');take('enable');take('reconcile');need(index===plan.length);
  need(digest(canonical(plan))===m.consent.planDigest);
  step(m.lastCompleted);const completed=plan.findIndex(s=>sameManagedStep(s,m.lastCompleted as ManagedStepRef));need(completed>=0);
  if(m.state==='complete'){
    need(m.step===null&&completed===plan.length-1&&m.phase==='complete'&&m.intent===null&&m.diagnostic===null&&m.sequence>=plan.length);
  }else{
    step(m.step);need(sameManagedStep(plan[completed+1]??null,m.step)&&m.sequence>=completed+1);
    need(m.phase===(legacy.kind==='removal-receipt'||completed>=plan.findIndex(s=>s.name==='record-removal')?'removed':'pending'));
  }
  if(m.intent!==null){intent(m.intent,known);need(m.intent.expectedSequence<=m.sequence&&sameManagedStep(m.intent.step,m.step as ManagedStepRef|null));}
  need(m.state!=='running'||m.intent!==null);
  need(m.state==='running'||m.receipt!==null);
  if(m.receipt!==null){
    keys(m.receipt,['requestDigest','expectedSequence','sequence','step','outcome']);
    need(hash(m.receipt.requestDigest)&&integer(m.receipt.expectedSequence)&&integer(m.receipt.sequence)&&
      m.receipt.sequence===m.sequence&&m.receipt.sequence===m.receipt.expectedSequence+1&&['applied','failed'].includes(m.receipt.outcome as string));
    if(m.receipt.step!==null)step(m.receipt.step);
    need(sameManagedStep(m.receipt.step as ManagedStepRef|null,m.step as ManagedStepRef|null)||sameManagedStep(m.receipt.step as ManagedStepRef|null,m.lastCompleted));
    if(['paused','abandoned','failed'].includes(m.state))need(sameManagedStep(m.receipt.step as ManagedStepRef|null,m.step as ManagedStepRef|null));
    if(m.state==='complete')need(sameManagedStep(m.receipt.step as ManagedStepRef|null,m.lastCompleted));
    if(m.receipt.outcome==='failed')need(m.state==='failed');
  }
  need(Array.isArray(m.captureRenewals));
  let previous=0;const renewals=m.captureRenewals as unknown[];
  const seen=new Map<number,ManagedCaptureRenewal>();
  const renewed=(value:ManagedStepIntent)=>{
    if(value.captureReviewSequence===null)return;
    const renewal=seen.get(value.captureReviewSequence);
    need(renewal&&sameManagedStep(renewal.priorIntent.step,value.step)&&renewal.priorIntent.requestDigest!==value.requestDigest);
  };
  for(const renewal of renewals){
    keys(renewal,['reviewDigest','sequence','priorIntent']);
    need(hash(renewal.reviewDigest)&&integer(renewal.sequence)&&renewal.sequence>previous&&renewal.sequence<=m.sequence);
    intent(renewal.priorIntent,known);need(['enable','disable'].includes(renewal.priorIntent.step.name)&&renewal.priorIntent.expectedSequence<renewal.sequence);
    const priorIntent=renewal.priorIntent;
    const decision=plan.findIndex(s=>sameManagedStep(s,priorIntent.step));need(decision>=0&&decision<=completed+1);
    renewed(renewal.priorIntent);previous=renewal.sequence;seen.set(previous,renewal as unknown as ManagedCaptureRenewal);
  }
  if(m.intent!==null)renewed(m.intent as ManagedStepIntent);
  capture(m.capture);
  if(m.diagnostic!==null){
    keys(m.diagnostic,['stage','code']);need([...MANAGED_MIGRATION_STEPS,...MANAGED_INSPECTION_STEPS,'journal','lock'].includes(m.diagnostic.stage as string));
    need([...MANAGED_ACTION_CODES,...MANAGED_STEP_CODES].includes(m.diagnostic.code as string));
  }
  need(m.state!=='failed'||m.diagnostic!==null);
  const journal=raw as unknown as ManagedStepJournal;
  need(managedTargetDigest(journal)===m.consent.targetDigest);
  return journal;
}

/** A persisted capture bit is historical. Cold status/replay must supply a fresh
 * observation or get unknown; projection never opens a Store to guess. */
export function managedJournalProgress(journal:ManagedStepJournal,observed:ManagedCaptureObservation={state:'unknown',observedAt:null}):ManagedStepProgress {
  const m=journal.migration,captureIntent=m.intent&&['enable','disable'].includes(m.intent.step.name);
  const renewal=m.captureRenewals.at(-1),unconsumed=!!renewal&&canonical(renewal.priorIntent)===canonical(m.intent);
  const needsReview=captureIntent&&!unconsumed&&observed.state!=='unknown'&&observed.state!==(m.intent!.step.name==='enable'?'on':'off');
  const recovery=m.state==='complete'?'none':needsReview?'review':
    m.state==='pending'?'continue':['paused','abandoned'].includes(m.state)?'resume':m.intent?'reconcile':'resume';
  return {operationId:m.operationId,sequence:m.sequence,state:m.state,worker:m.intent?'unsettled':'idle',step:m.step&&{...m.step},
    lastCompleted:m.lastCompleted&&{...m.lastCompleted},effect:m.intent?'uncertain':m.receipt?.outcome==='applied'?'committed':'none',
    capture:{...observed},diagnostic:m.diagnostic&&{...m.diagnostic},recovery};
}
