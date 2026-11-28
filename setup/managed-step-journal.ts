/** Private durable contract, NOT an HTTP DTO. Parsed claims are never authority. */
import type { Binding } from '../shared/binding.ts';
import type { ManagedCaptureObservation, ManagedEffectState, ManagedOperationState, ManagedStepDiagnostic, ManagedStepRef } from '../shared/managed-steps.ts';
import { MANAGED_STEP_LIMITS, MANAGED_MIGRATION_STEPS, MANAGED_INSPECTION_STEPS, MANAGED_STEP_CODES, MANAGED_OPERATION_TRANSITIONS } from '../shared/managed-steps.ts';
import type { ManagedStepRequest, ManagedStepProgress } from '../shared/managed-steps.ts';
import { MANAGED_ACTION_CODES } from '../shared/progress.ts';
import { canonical, digest } from '../shared/store.ts';
import { SetupError, migrationOwnership } from './lifecycle.ts';
import { managedVolumeFixedPaths, type ManagedVolumeIdentityEvidence } from './managed-volume-identity.ts';
import path from 'node:path';
import { MANAGED_FRESH_STEPS, managedFreshPlan, type ManagedFreshStepRef, type ManagedSetupStepRef,
  type ManagedFreshStepRequest, type ManagedFreshStepProgress, type ManagedFreshStepDiagnostic,
  type ManagedFreshStoreMode, type ManagedFreshSourceMode, type ManagedFreshCapturePolicy } from '../shared/managed-steps.ts';

/** Claims only: fresh path/object/hash validation is mandatory before use. */
export interface ManagedPathClaim {
  path: string;
  kind: 'directory' | 'file' | 'absent';
  /** Native identity represented as strings, never lossy JS integer inode values. */
  object: { device: string; inode: string; birthNs: string } | null;
  /** SHA-256 of publication bytes; null for directories/absence and fresh SQLite
   * object-only claims. SQLite contents are validated by Store, never full-file hashing. */
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
export type ManagedLegacyEvidence = (
  | { kind: 'manifest'; ownership: string; ownershipDigest: string; claims: ManagedPathClaim[] }
  | { kind: 'removal-receipt'; ownership: null; ownershipDigest: null; claims: ManagedPathClaim[];
      receipt: { history: ManagedPathClaim; entry: string } }
) & { volumeIdentity?: ManagedVolumeIdentityEvidence };

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

/** Immutable review facts. Native identities/hashes are observations, not authority.
 * Sidecars are always the three fixed SQLite suffixes in journal/wal/shm order. */
export interface ManagedFreshFacts {
  storeMode: ManagedFreshStoreMode;
  sourceMode: ManagedFreshSourceMode;
  capturePolicy: ManagedFreshCapturePolicy;
  directory: ManagedPathClaim;
  database: ManagedPathClaim;
  sidecars: ManagedPathClaim[];
  source: Binding['source'] | null;
  capture: 'on' | 'off' | 'unknown';
  selection: ManagedPathClaim;
  journal: ManagedPathClaim;
  legacy: ManagedPathClaim;
  volumeIdentity?: ManagedVolumeIdentityEvidence;
}
export interface ManagedFreshStepIntent extends Omit<ManagedStepIntent, 'step'> { step: ManagedFreshStepRef }
export interface ManagedFreshStepReceipt extends Omit<ManagedStepReceipt, 'step'> { step: ManagedFreshStepRef | null }
export interface ManagedFreshCaptureRenewal extends Omit<ManagedCaptureRenewal, 'priorIntent'> { priorIntent: ManagedFreshStepIntent }
export interface ManagedFreshStepJournal extends Binding {
  migration: Omit<ManagedStepJournal['migration'], 'format' | 'phase' | 'legacyInstallId' | 'legacy' |
    'plan' | 'step' | 'lastCompleted' | 'intent' | 'receipt' | 'captureRenewals' | 'diagnostic'> & {
    format: 3;
    planKind: 'fresh';
    phase: 'pending' | 'complete';
    fresh: ManagedFreshFacts;
    /** May be filled only when settling the corresponding durable creation intent. */
    created: { directory: ManagedPathClaim | null; database: ManagedPathClaim | null };
    plan: ManagedFreshStepRef[];
    step: ManagedFreshStepRef | null;
    lastCompleted: ManagedFreshStepRef | null;
    intent: ManagedFreshStepIntent | null;
    receipt: ManagedFreshStepReceipt | null;
    captureRenewals: ManagedFreshCaptureRenewal[];
    diagnostic: ManagedFreshStepDiagnostic | null;
  };
}
export type ManagedSetupStepJournal = ManagedStepJournal | ManagedFreshStepJournal;

function need(value:unknown):asserts value {if(!value)throw new SetupError('managed-journal-unsupported');}
function record(value:unknown):asserts value is Record<string,unknown> {
  need(value!==null&&typeof value==='object'&&!Array.isArray(value));
}
function keys(value:unknown,names:string[]):asserts value is Record<string,unknown> {
  record(value);need(Object.keys(value).length===names.length&&names.every(name=>Object.hasOwn(value,name)));
}
function reviewKeys(value:unknown,names:string[]):asserts value is Record<string,unknown> {
  record(value);
  keys(value,Object.hasOwn(value,'volumeIdentity')?[...names,'volumeIdentity']:names);
}
const hash=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const integer=(value:unknown):value is number=>Number.isSafeInteger(value)&&(value as number)>=0;
const text=(value:unknown,max=256):value is string=>typeof value==='string'&&value.length>0&&!value.includes('\0')&&Buffer.byteLength(value)<=max;
const version=(value:unknown)=>text(value)&&/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i.test(value);
function pathname(value:unknown):asserts value is string {
  need(text(value,MANAGED_STEP_LIMITS.pathBytes));
  // Syntax only. Native canonical spelling and ancestors are revalidated
  // by the filesystem owner, never by this portable journal parser.
  const dialect=/^[a-z]:[\\/]/i.test(value)?path.win32:path.posix;
  need(dialect.isAbsolute(value)&&dialect.normalize(value)===value);
}
function volumeIdentity(facts:Record<string,unknown>,binding:Binding,manifestClaims:readonly ManagedPathClaim[]=[]):void {
  if(!Object.hasOwn(facts,'volumeIdentity'))return;
  const value=facts.volumeIdentity;
  keys(value,['version','paths']);
  need(value.version===1&&Array.isArray(value.paths)&&value.paths.length>0);
  if(value.paths.length>MANAGED_STEP_LIMITS.claimPaths)throw new SetupError('managed-step-limit');
  // Manifest claims are still only syntax here: the lifecycle owner independently
  // derives and checks their complete layout before reading those paths.
  const allowed=new Set([...managedVolumeFixedPaths(binding),...manifestClaims.map(c=>c.path)]),seen=new Set<string>();
  for(const entry of value.paths){
    keys(entry,['path','fingerprint']);pathname(entry.path);
    need(allowed.has(entry.path)&&!seen.has(entry.path)&&hash(entry.fingerprint));
    seen.add(entry.path);
  }
}
function capture(value:unknown):asserts value is ManagedCaptureObservation {
  keys(value,['state','observedAt']);
  if(value.state==='unknown')need(value.observedAt===null);
  else {
    need(value.state==='on'||value.state==='off');need(typeof value.observedAt==='string');
    const time=Date.parse(value.observedAt);need(Number.isFinite(time)&&new Date(time).toISOString()===value.observedAt);
  }
}
function step(value:unknown,fresh=false):asserts value is ManagedStepRef {
  keys(value,['name','batch']);need((fresh?MANAGED_FRESH_STEPS:MANAGED_MIGRATION_STEPS).includes(value.name as never)&&integer(value.batch));
  need(['remove-selector','remove-discovery'].includes(value.name as string)||value.batch===0);
}
export function sameManagedStep(a:ManagedSetupStepRef|null,b:ManagedSetupStepRef|null) {
  return a===null||b===null?a===b:a.name===b.name&&a.batch===b.batch;
}
function claims(value:unknown,known:Set<string>,anticipated=false,objectOnly=false):asserts value is ManagedPathClaim[] {
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
      need(claim.kind==='file'&&!objectOnly?hash(claim.digest):claim.digest===null);
    }
  }
}
function intent(value:unknown,known:Set<string>,fresh=false):asserts value is ManagedStepIntent {
  keys(value,['requestDigest','expectedSequence','step','effect','before','after','captureBefore','captureReviewSequence']);
  need(hash(value.requestDigest)&&integer(value.expectedSequence));step(value.step,fresh);
  need(value.step.name!=='prepare'&&['intent','uncertain','committed'].includes(value.effect as string));
  const objectOnly=fresh&&['create-store'].includes(value.step.name);
  claims(value.before,known,false,objectOnly);claims(value.after,known,true,objectOnly);capture(value.captureBefore);
  need(value.captureReviewSequence===null||integer(value.captureReviewSequence)&&value.captureReviewSequence>0&&
    value.captureReviewSequence<=value.expectedSequence&&['enable','disable'].includes(value.step.name));
}
/** Binding projection deliberately excludes migration metadata from target hashes. */
export function managedJournalBinding(journal:Binding):Binding {
  const {protocolVersion,schemaVersion,installId,version,database,storeId,source}=journal;
  return {protocolVersion,schemaVersion,installId,version,database,storeId,source:{...source}};
}
export function managedTargetDigest(journal:ManagedSetupStepJournal):string {
  if(journal.migration.format===3){
    const {planKind,fresh,expectation}=journal.migration;
    return digest(canonical({binding:managedJournalBinding(journal),planKind,fresh,expectation}));
  }
  const {legacyInstallId,legacy,expectation}=journal.migration;
  return digest(canonical({binding:managedJournalBinding(journal),legacyInstallId,legacy,expectation}));
}
/** Caller first validates the full request shape. No fields are projected away. */
export function managedRequestDigest(request:ManagedStepRequest|ManagedFreshStepRequest,journal:ManagedSetupStepJournal,renewal?:ManagedCaptureRenewal|ManagedFreshCaptureRenewal):string {
  return digest(canonical({request,targetDigest:journal.migration.consent.targetDigest,consent:journal.migration.consent,
    ...(renewal?{captureReviewSequence:renewal.sequence,captureReviewDigest:renewal.reviewDigest}:{})}));
}

/** Fresh-only parser. Migration-only readers intentionally continue to reject it. */
export function parseManagedFreshStepJournal(bytes:string|Uint8Array):ManagedFreshStepJournal {
  if(Buffer.byteLength(bytes)>MANAGED_STEP_LIMITS.journalBytes)throw new SetupError('managed-step-limit');
  let raw:unknown;
  try{raw=JSON.parse(typeof bytes==='string'?bytes:new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
  catch{throw new SetupError('managed-journal-unsupported');}
  keys(raw,['protocolVersion','schemaVersion','installId','version','database','storeId','source','migration']);
  need(raw.protocolVersion===2&&raw.schemaVersion===2&&text(raw.installId)&&version(raw.version)&&text(raw.storeId));
  pathname(raw.database);
  const dialect=/^[a-z]:/i.test(raw.database)?path.win32:path.posix,root=dialect.dirname(raw.database);
  need(dialect.basename(raw.database)==='progress.sqlite');
  keys(raw.source,['id','configRoot','dataRoot','verified']);need(text(raw.source.id)&&raw.source.verified===true);
  pathname(raw.source.configRoot);pathname(raw.source.dataRoot);
  const m=raw.migration;
  keys(m,['format','product','planKind','phase','operationId','sequence','state','step','lastCompleted','consent',
    'expectation','plan','fresh','created','captureRenewals','intent','receipt','capture','diagnostic']);
  need(m.format===3&&m.planKind==='fresh'&&m.product==='openchamber-agent-progress-managed');
  need(m.phase==='pending'||m.phase==='complete');
  need(typeof m.operationId==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(m.operationId));
  need(integer(m.sequence)&&m.sequence>=1&&typeof m.state==='string'&&Object.hasOwn(MANAGED_OPERATION_TRANSITIONS,m.state));
  keys(m.consent,['reviewDigest','targetDigest','planDigest']);need(Object.values(m.consent).every(hash));
  keys(m.expectation,['version','fingerprint']);need(version(m.expectation.version)&&hash(m.expectation.fingerprint));
  const f=m.fresh,known=new Set<string>();
  reviewKeys(f,['storeMode','sourceMode','capturePolicy','directory','database','sidecars','source','capture','selection','journal','legacy']);
  need(['create','retain'].includes(f.storeMode as string)&&['create','reuse'].includes(f.sourceMode as string));
  need(f.capturePolicy===(f.storeMode==='create'?'enable-new':'preserve'));
  claims([f.directory,f.selection,f.journal,f.legacy],known);claims([f.database],known,false,true);claims(f.sidecars,known,false,true);
  const facts=f as unknown as ManagedFreshFacts;
  need(facts.directory.path===root&&facts.database.path===raw.database&&facts.directory.kind!=='file');
  need(facts.sidecars.length===3&&facts.sidecars.every((c,i)=>c.path===raw.database+['-journal','-wal','-shm'][i]&&c.kind!=='directory'));
  const managed=dialect.join(raw.source.dataRoot,'agent-progress-managed');
  need(facts.selection.path===dialect.join(managed,'progress-binding.json')&&facts.selection.kind==='absent'&&
    facts.journal.path===dialect.join(managed,'migration.json')&&facts.journal.kind==='absent'&&
    facts.legacy.path===dialect.join(raw.source.configRoot,'plugins','agent-progress')&&facts.legacy.kind==='absent');
  if(facts.storeMode==='create'){
    need(facts.database.kind==='absent'&&facts.sidecars.every(c=>c.kind==='absent')&&facts.sourceMode==='create'&&facts.capture==='unknown');
  }else need(facts.directory.kind==='directory'&&facts.database.kind==='file'&&['on','off'].includes(facts.capture));
  if(facts.sourceMode==='reuse'){
    keys(f.source,['id','configRoot','dataRoot','verified']);need(canonical(f.source)===canonical(raw.source));
  }else need(f.source===null);
  const plan=managedFreshPlan(facts.storeMode,facts.directory.kind==='absent',facts.sourceMode);
  need(canonical(m.plan)===canonical(plan)&&digest(canonical(plan))===m.consent.planDigest);
  step(m.lastCompleted,true);const completed=plan.findIndex(s=>sameManagedStep(s,m.lastCompleted as unknown as ManagedFreshStepRef));need(completed>=0);
  if(m.state==='complete')need(m.step===null&&completed===plan.length-1&&m.phase==='complete'&&m.intent===null&&m.diagnostic===null&&m.sequence>=plan.length);
  else {step(m.step,true);need(sameManagedStep(plan[completed+1]??null,m.step as unknown as ManagedFreshStepRef)&&m.sequence>=completed+1&&m.phase==='pending');}
  keys(m.created,['directory','database']);
  for(const [key,name,kind] of [['directory','store-directory','directory'],['database','create-store','file']] as const){
    const checkpoint=m.created[key],index=plan.findIndex(s=>s.name===name),required=index>=0&&completed>=index;
    need((checkpoint!==null)===required);
    if(checkpoint!==null){claims([checkpoint],known,false,true);const c=checkpoint as ManagedPathClaim;need(c.kind===kind&&c.path===(key==='directory'?root:raw.database));}
  }
  if(m.intent!==null){intent(m.intent,known,true);need(m.intent.expectedSequence<=m.sequence&&sameManagedStep(m.intent.step,m.step as unknown as ManagedFreshStepRef));}
  need(m.state!=='running'||m.intent!==null);need(m.state==='running'||m.receipt!==null);
  if(m.receipt!==null){
    keys(m.receipt,['requestDigest','expectedSequence','sequence','step','outcome']);
    need(hash(m.receipt.requestDigest)&&integer(m.receipt.expectedSequence)&&integer(m.receipt.sequence)&&m.receipt.sequence===m.sequence&&
      m.receipt.sequence===m.receipt.expectedSequence+1&&['applied','failed'].includes(m.receipt.outcome as string));
    if(m.receipt.step!==null)step(m.receipt.step,true);
    const receipt=m.receipt as unknown as ManagedFreshStepReceipt;
    need(sameManagedStep(receipt.step,m.step as unknown as ManagedFreshStepRef|null)||sameManagedStep(receipt.step,m.lastCompleted as unknown as ManagedFreshStepRef));
    if(['paused','abandoned','failed'].includes(m.state))need(sameManagedStep(receipt.step,m.step as unknown as ManagedFreshStepRef));
    if(m.state==='complete')need(sameManagedStep(receipt.step,m.lastCompleted as unknown as ManagedFreshStepRef));
    if(receipt.outcome==='failed')need(m.state==='failed');
  }
  need(Array.isArray(m.captureRenewals));
  let previous=0;const seen=new Map<number,ManagedStepIntent>();
  const renewed=(i:ManagedStepIntent)=>{if(i.captureReviewSequence===null)return;const prior=seen.get(i.captureReviewSequence);
    need(prior&&sameManagedStep(prior.step,i.step)&&prior.requestDigest!==i.requestDigest);};
  for(const renewal of m.captureRenewals){
    keys(renewal,['reviewDigest','sequence','priorIntent']);
    need(hash(renewal.reviewDigest)&&integer(renewal.sequence)&&renewal.sequence>previous&&renewal.sequence<=m.sequence);
    intent(renewal.priorIntent,known,true);const i=renewal.priorIntent;
    need(i.step.name==='enable'&&i.expectedSequence<renewal.sequence&&plan.findIndex(s=>sameManagedStep(s,i.step))<=completed+1&&facts.storeMode==='create');
    renewed(i);previous=renewal.sequence;seen.set(previous,i);
  }
  if(m.intent!==null)renewed(m.intent);
  capture(m.capture);
  if(m.diagnostic!==null){keys(m.diagnostic,['stage','code']);
    need([...MANAGED_FRESH_STEPS,...MANAGED_INSPECTION_STEPS,'journal','lock'].includes(m.diagnostic.stage as never)&&
      [...MANAGED_ACTION_CODES,...MANAGED_STEP_CODES].includes(m.diagnostic.code as string));}
  need(m.state!=='failed'||m.diagnostic!==null);
  const journal=raw as unknown as ManagedFreshStepJournal;
  volumeIdentity(f,journal);
  need(managedTargetDigest(journal)===m.consent.targetDigest);return journal;
}

/** Checkpoint evolution contract; persistence still validates ordinary sequence,
 * receipts, immutable consent/facts and published intent at its write boundary. */
export function validateManagedFreshCreationChange(prior:ManagedFreshStepJournal,next:ManagedFreshStepJournal):void {
  const fail=()=>{throw new SetupError('managed-step-conflict');},a=prior.migration,b=next.migration;
  if(canonical(managedJournalBinding(prior))!==canonical(managedJournalBinding(next))||canonical(a.fresh)!==canonical(b.fresh)||
    canonical(a.consent)!==canonical(b.consent)||canonical(a.expectation)!==canonical(b.expectation)||canonical(a.plan)!==canonical(b.plan)||a.operationId!==b.operationId)fail();
  for(const [key,name] of [['directory','store-directory'],['database','create-store']] as const){
    if(canonical(a.created[key])===canonical(b.created[key]))continue;
    if(a.created[key]!==null||b.created[key]===null||a.state!=='running'||a.intent?.step.name!==name||a.step?.name!==name||
      b.sequence!==a.sequence+1||b.intent!==null||b.lastCompleted?.name!==name||b.state!=='pending'||
      b.receipt?.outcome!=='applied'||b.receipt.expectedSequence!==a.sequence||b.receipt.sequence!==b.sequence||
      a.intent.expectedSequence===a.sequence&&b.receipt.requestDigest!==a.intent.requestDigest)fail();
  }
}

export function managedFreshJournalProgress(journal:ManagedFreshStepJournal,observed:ManagedCaptureObservation={state:'unknown',observedAt:null}):ManagedFreshStepProgress {
  // Projection logic is shared, but the version-1 public vocabulary stays narrow.
  const common=managedJournalProgress(journal as unknown as ManagedStepJournal,observed),m=journal.migration;
  return {...common,planKind:'fresh',plan:structuredClone(m.plan),storeMode:m.fresh.storeMode,sourceMode:m.fresh.sourceMode,
    capturePolicy:m.fresh.capturePolicy,step:m.step&&{...m.step},lastCompleted:m.lastCompleted&&{...m.lastCompleted},diagnostic:m.diagnostic&&{...m.diagnostic}};
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
    reviewKeys(legacy,['kind','ownership','ownershipDigest','claims']);
    need(text(legacy.ownership,MANAGED_STEP_LIMITS.journalBytes)&&hash(legacy.ownershipDigest)&&digest(legacy.ownership)===legacy.ownershipDigest);
    // Structural manifest parsing stays with the lifecycle/removal owner. It is
    // not equivalent to that owner's fresh file/selector/retained-release checks.
    need(migrationOwnership(legacy.ownership).installId===m.legacyInstallId);
  }else{
    reviewKeys(legacy,['kind','ownership','ownershipDigest','claims','receipt']);
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
  m.plan.forEach(value=>step(value));
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
  volumeIdentity(legacy,journal,legacy.kind==='manifest'?legacy.claims:[]);
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
