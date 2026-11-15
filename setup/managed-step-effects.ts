import {lstatSync,readFileSync,readdirSync} from 'node:fs';
import path from 'node:path';
import {Store,canonical,digest} from '../shared/store.ts';
import {verifyStore} from '../shared/binding.ts';
import {activationFingerprint} from '../shared/activation.ts';
import {managedBindingFile,managedExpectationFile,managedPath,publishPrivateJson,readManagedBinding,readManagedExpectation} from '../shared/managed-binding.ts';
import {platformSecurityScope,requirePlatformWriteBoundary,windows,windowsPaths,privatePaths} from '../shared/platform.ts';
import {MANAGED_STEP_LIMITS,type ManagedCaptureObservation} from '../shared/managed-steps.ts';
import {SetupError,validateMigrationRemoval,removeMigrationFile,migrationRemovalRecordClaims,recordMigrationRemoval,migrationRemovalRecorded,migrationRemovalComplete,type Payload} from './lifecycle.ts';
import {managedJournalBinding,type ManagedStepJournal,type ManagedPathClaim,type ManagedStepIntent} from './managed-step-journal.ts';
import {managedJournalPaths,readManagedStepJournal,readRemovalReceipt,validatePublishedManagedIntent} from './managed-migration.ts';

function need(value:unknown,code='managed-step-conflict'):asserts value {if(!value)throw new SetupError(code);}
function snapshot(file:string) {
  const s=lstatSync(file,{bigint:true});
  return [s.dev,s.ino,s.birthtimeNs,s.size,s.mtimeNs,s.ctimeNs,s.mode,s.nlink].join(':');
}
/** Only fixed publication paths, after the complete known-path admission batch. */
function fileClaim(file:string):ManagedPathClaim {
  managedPath(file,true);const s=lstatSync(file,{bigint:true,throwIfNoEntry:false});
  if(!s)return {path:file,kind:'absent',object:null,digest:null};
  need(s.isFile()&&!s.isSymbolicLink()&&s.nlink===1n&&privatePaths([path.dirname(file),file]),'managed-migration-conflict');
  need(s.size<=BigInt(MANAGED_STEP_LIMITS.journalBytes),'managed-step-limit');
  const before=[s.dev,s.ino,s.birthtimeNs,s.size,s.mtimeNs,s.ctimeNs,s.mode,s.nlink].join(':'),hash=digest(readFileSync(file));
  need(before===snapshot(file),'managed-migration-conflict');
  return {path:file,kind:'file',object:{device:String(s.dev),inode:String(s.ino),birthNs:String(s.birthtimeNs)},digest:hash};
}
function expectation(journal:ManagedStepJournal) {
  return {format:1 as const,storeId:journal.storeId,sourceId:journal.source.id,installId:journal.installId,...journal.migration.expectation};
}
function completed(journal:ManagedStepJournal,name:string) {
  const m=journal.migration;return m.plan.findIndex(s=>s.name===name)<=m.plan.findIndex(s=>canonical(s)===canonical(m.lastCompleted));
}
function observeCapture(journal:ManagedStepJournal):ManagedCaptureObservation {
  const store=new Store(journal.database,{readOnly:true});
  try{verifyStore(store,journal);store.subagentRunStorage();return {state:store.list({limit:1}).captureEnabled?'on':'off',observedAt:new Date().toISOString()};}
  finally{store.close();}
}

/** Fresh full target admission. The supplied journal is a claim, not authority;
 * compare it to the private current record in this same scope. No effect here. */
export function validateManagedStepTarget(env:NodeJS.ProcessEnv,payload:Payload,journal:ManagedStepJournal) {
  return platformSecurityScope(()=>{
    if(windows)windowsPaths(managedJournalPaths(journal),true);
    const current=readManagedStepJournal(env);need(current&&canonical(current)===canonical(journal));
    const m=journal.migration,binding=managedJournalBinding(journal);
    need(payload.plugin&&payload.guidance&&payload.version===m.expectation.version&&
      activationFingerprint({...binding,version:payload.version},Buffer.from(payload.plugin),Buffer.from(payload.guidance))===m.expectation.fingerprint,'managed-review-stale');
    const selector=managedBindingFile(env),expectedFile=managedExpectationFile(journal);
    for(const file of [selector,expectedFile]){
      need(!readdirSync(path.dirname(file)).some(n=>n.startsWith(path.basename(file)+'.stage-')),'managed-migration-conflict');
      fileClaim(file); // Include hard-link and bounded-file checks before the existing readers.
    }
    const selected=readManagedBinding(env),expected=readManagedExpectation(journal);
    need(!selected||canonical(selected)===canonical(binding),'managed-selection-conflict');
    if(completed(journal,'expectation'))need(expected&&canonical(expected)===canonical(expectation(journal)),'managed-review-stale');
    if(completed(journal,'publish-binding'))need(selected,'managed-migration-conflict');
    let capture:ManagedCaptureObservation;
    if(m.legacy.kind==='manifest'){
      capture=validateMigrationRemoval(journal).capture;
      if(completed(journal,'record-removal'))need(migrationRemovalComplete(journal),'managed-migration-conflict');
    }else{
      need(readRemovalReceipt({binding,phase:'removed',legacyInstallId:m.legacyInstallId},m.legacy.receipt),'managed-migration-conflict');
      capture=observeCapture(journal);
    }
    return capture;
  });
}

/** Freeze one effect's before/after claims, while admission is still read-only. */
export function managedStepEffectClaims(env:NodeJS.ProcessEnv,payload:Payload,journal:ManagedStepJournal):Pick<ManagedStepIntent,'before'|'after'|'captureBefore'> {
  return platformSecurityScope(()=>{
    const captureBefore=validateManagedStepTarget(env,payload,journal),m=journal.migration;
    need(m.step&&m.step.name!=='prepare'&&!m.intent);
    if(m.step.name==='record-removal'){
      const claims=migrationRemovalRecordClaims(journal);return {before:claims.before,after:claims.after,captureBefore:claims.capture};
    }
    if(['remove-selector','remove-discovery'].includes(m.step.name)){
      const layout=validateMigrationRemoval(journal),file=layout.file(m.step);need(file&&captureBefore.state==='off');
      return {before:[layout.claims.get(file)!],after:[{path:file,kind:'absent',object:null,digest:null}],captureBefore};
    }
    if(m.step.name==='expectation'||m.step.name==='publish-binding'){
      const file=m.step.name==='expectation'?managedExpectationFile(journal):managedBindingFile(env),before=fileClaim(file);
      const value=m.step.name==='expectation'?expectation(journal):managedJournalBinding(journal);
      // Existing identical selections are reconciled, never rewritten merely
      // to impose JSON key ordering or manufacture a new file identity.
      const after=m.step.name==='publish-binding'&&before.kind==='file'?before:
        {path:file,kind:'file' as const,object:null,digest:digest(JSON.stringify(value))};
      return {before:[before],after:[after],captureBefore};
    }
    return {before:[],after:[],captureBefore};
  });
}

function matchesAfter(actual:ManagedPathClaim,expected:ManagedPathClaim) {
  return actual.path===expected.path&&actual.kind===expected.kind&&actual.digest===expected.digest&&
    (expected.object===null&&expected.kind==='file'||canonical(actual.object)===canonical(expected.object));
}
function publication(journal:ManagedStepJournal,env:NodeJS.ProcessEnv) {
  const m=journal.migration,intent=m.intent!;need(m.step?.name==='expectation'||m.step?.name==='publish-binding');
  const isExpectation=m.step.name==='expectation',file=isExpectation?managedExpectationFile(journal):managedBindingFile(env);
  const value=isExpectation?expectation(journal):managedJournalBinding(journal),actual=fileClaim(file);
  need(intent.before.length===1&&intent.after.length===1&&intent.before[0]!.path===file&&intent.after[0]!.path===file);
  const after=intent.after[0]!;
  // The journal cannot nominate different publication bytes. Existing binding
  // bytes may be canonically equivalent, but their exact before claim is kept.
  if(!isExpectation&&intent.before[0]!.kind==='file')need(canonical(after)===canonical(intent.before[0]));
  else need(after.kind==='file'&&after.object===null&&after.digest===digest(JSON.stringify(value)));
  const committed=matchesAfter(actual,after);
  if(!committed)need(canonical(actual)===canonical(intent.before[0]),'managed-migration-conflict');
  return {file,value,committed,replace:isExpectation&&actual.kind==='file'};
}

/** Read-only evidence for the CURRENT durable intent. Capture with an opposite
 * bit is ambiguous, not permission to repeat a disable/enable. */
export function managedStepEffectCommitted(env:NodeJS.ProcessEnv,payload:Payload,journal:ManagedStepJournal) {
  return platformSecurityScope(()=>{
    const capture=validateManagedStepTarget(env,payload,journal),m=journal.migration;
    need(m.intent&&m.step);
    // Resume retains the intent in pending state. Projection is read-only and
    // used only by lifecycle evidence checks which require a running intent;
    // actual effects still admit the exact running journal below.
    const evidence=structuredClone(journal);evidence.migration.state='running';
    if(m.state==='running')validatePublishedManagedIntent(env,journal);
    let committed:boolean;
    if(m.step.name==='expectation'||m.step.name==='publish-binding')committed=publication(journal,env).committed;
    else if(m.step.name==='record-removal')committed=migrationRemovalRecorded(evidence);
    else if(m.step.name==='remove-selector'||m.step.name==='remove-discovery'){
      const layout=validateMigrationRemoval(journal),file=layout.file(m.step);need(file&&layout.intentFor(file));
      committed=!lstatSync(file,{throwIfNoEntry:false});
    }else{
      need(m.intent.before.length===0&&m.intent.after.length===0);
      committed=m.step.name==='reconcile'||capture.state===(m.step.name==='enable'?'on':'off');
    }
    return {committed,capture};
  });
}

/** One effect only. The caller has published running+intent under its worker
 * fence. Capture may execute ONLY on a newly published intent, not a retry. */
export function applyManagedStepEffect(env:NodeJS.ProcessEnv,payload:Payload,journal:ManagedStepJournal,freshCapture=false):void {
  requirePlatformWriteBoundary();
  const m=journal.migration;
  need(m.state==='running'&&m.intent&&m.step);
  if(m.step?.name==='record-removal'){
    recordMigrationRemoval(journal,()=>{validateManagedStepTarget(env,payload,journal);validatePublishedManagedIntent(env,journal);});return;
  }
  if(m.step?.name==='remove-selector'||m.step?.name==='remove-discovery'){
    removeMigrationFile(journal,()=>{validateManagedStepTarget(env,payload,journal);validatePublishedManagedIntent(env,journal);});return;
  }
  let store:Store|undefined;
  try{
    const prepared=platformSecurityScope(()=>{
      const result=managedStepEffectCommitted(env,payload,journal);
      if(result.committed)return;
      if(m.step?.name==='expectation'||m.step?.name==='publish-binding')return publication(journal,env);
      need(freshCapture&&['enable','disable'].includes(m.step?.name??''),'managed-step-unsettled');
      need(result.capture.state===m.intent!.captureBefore.state,'managed-step-unsettled');
      store=new Store(journal.database);verifyStore(store,journal);store.subagentRunStorage();
      return;
    });
    requirePlatformWriteBoundary();
    if(prepared)publishPrivateJson(prepared.file,prepared.value,prepared.replace);
    else if(store)store.setEnabled(m.step!.name==='enable');
  }finally{store?.close();}
}
