import {lstatSync,readFileSync,readdirSync} from 'node:fs';
import path from 'node:path';
import {Store,canonical,digest} from '../shared/store.ts';
import {verifyStore} from '../shared/binding.ts';
import {activationFingerprint} from '../shared/activation.ts';
import {managedBindingFile,managedExpectationFile,managedPath,publishPrivateJson,readManagedBinding,readManagedExpectation} from '../shared/managed-binding.ts';
import {platformSecurityScope,requirePlatformWriteBoundary,requirePlatformStoreFence,privateDirectory,windows,windowsPaths,privatePaths} from '../shared/platform.ts';
import {MANAGED_STEP_LIMITS,type ManagedCaptureObservation,type ManagedStepRef} from '../shared/managed-steps.ts';
import {SetupError,validateMigrationRemoval,removeMigrationFile,migrationRemovalRecordClaims,recordMigrationRemoval,migrationRemovalRecorded,migrationRemovalComplete,type Payload} from './lifecycle.ts';
import {managedJournalBinding,type ManagedStepJournal,type ManagedFreshStepJournal,type ManagedSetupStepJournal,type ManagedPathClaim,type ManagedStepIntent} from './managed-step-journal.ts';
import {managedJournalPaths,readManagedStepJournal,readManagedFreshStepJournal,readRemovalReceipt,validatePublishedManagedIntent} from './managed-migration.ts';
import {observeManagedFreshStore} from './managed-inspection.ts';

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
function expectation(journal:ManagedSetupStepJournal) {
  return {format:1 as const,storeId:journal.storeId,sourceId:journal.source.id,installId:journal.installId,...journal.migration.expectation};
}
function completed(journal:ManagedSetupStepJournal,name:string) {
  const m=journal.migration,index=m.plan.findIndex(s=>s.name===name);
  return index>=0&&index<=m.plan.findIndex(s=>canonical(s)===canonical(m.lastCompleted));
}
function observeCapture(journal:ManagedStepJournal):ManagedCaptureObservation {
  const store=new Store(journal.database,{readOnly:true});
  try{verifyStore(store,journal);store.subagentRunStorage();return {state:store.list({limit:1}).captureEnabled?'on':'off',observedAt:new Date().toISOString()};}
  finally{store.close();}
}

/** Fresh full target admission. The supplied journal is a claim, not authority;
 * compare it to the private current record in this same scope. No effect here. */
export type ManagedCreationResult=Partial<ManagedFreshStepJournal['migration']['created']>;
/** Ephemeral result of THIS invocation's exclusive creation, never supplied by
 * a caller or restored from a hint. Fresh completion rechecks its native object. */
function createdObject(file:string,directory=false):ManagedPathClaim {
  const s=lstatSync(file,{bigint:true});
  need(!s.isSymbolicLink()&&(directory?s.isDirectory():s.isFile()&&s.nlink===1n),'managed-migration-conflict');
  return {path:file,kind:directory?'directory':'file',object:{device:String(s.dev),inode:String(s.ino),birthNs:String(s.birthtimeNs)},digest:null};
}
function freshCapture(journal:ManagedFreshStepJournal,created?:ManagedCreationResult) {
  const j=structuredClone(journal),m=j.migration;
  for(const [key,name] of [['directory','store-directory'],['database','create-store']] as const){
    if(!created?.[key])continue;
    need(m.state==='running'&&m.intent?.step.name===name&&m.step?.name===name&&m.created[key]===null);
    m.created[key]=created[key]!;
  }
  return observeManagedFreshStore(j);
}
export function validateManagedStepTarget(env:NodeJS.ProcessEnv,payload:Payload,journal:ManagedSetupStepJournal,created?:ManagedCreationResult) {
  return platformSecurityScope(()=>{
    if(windows)windowsPaths(managedJournalPaths(journal),true);
    const current=journal.migration.format===3?readManagedFreshStepJournal(env):readManagedStepJournal(env);need(current&&canonical(current)===canonical(journal));
    const m=journal.migration,binding=managedJournalBinding(journal);
    need(payload.plugin&&payload.guidance&&payload.version===m.expectation.version&&
      activationFingerprint({...binding,version:payload.version},Buffer.from(payload.plugin),Buffer.from(payload.guidance))===m.expectation.fingerprint,'managed-review-stale');
    const selector=managedBindingFile(env),expectedFile=managedExpectationFile(journal);
    for(const file of [selector,expectedFile]){
      if(lstatSync(path.dirname(file),{throwIfNoEntry:false}))need(!readdirSync(path.dirname(file)).some(n=>n.startsWith(path.basename(file)+'.stage-')),'managed-migration-conflict');
      fileClaim(file); // Include hard-link and bounded-file checks before the existing readers.
    }
    const selected=readManagedBinding(env),expected=readManagedExpectation(journal);
    need(!selected||canonical(selected)===canonical(binding),'managed-selection-conflict');
    if(completed(journal,'expectation'))need(expected&&canonical(expected)===canonical(expectation(journal)),'managed-review-stale');
    if(completed(journal,'publish-binding'))need(selected,'managed-migration-conflict');
    let capture:ManagedCaptureObservation;
    if(m.format===3){
      need(!lstatSync(m.fresh.legacy.path,{throwIfNoEntry:false}),'managed-migration-conflict');
      capture=freshCapture(journal as ManagedFreshStepJournal,created);
      if(m.fresh.storeMode==='create'&&lstatSync(path.dirname(journal.database),{throwIfNoEntry:false})){
        const allowed=new Set([path.basename(journal.database),...['-journal','-wal','-shm'].map(s=>path.basename(journal.database)+s),path.basename(expectedFile)]);
        need(readdirSync(path.dirname(journal.database)).every(n=>allowed.has(n)),'foreign-files');
        // No fresh setup step other than enable can turn capture on. Later
        // manual disable is allowed, including on complete/reconcile replay.
        if(!completed(journal,'enable')&&m.step?.name!=='enable')need(capture.state!=='on','managed-step-unsettled');
      }
      if(expected)need(canonical(expected)===canonical(expectation(journal)),'managed-review-stale');
      if(selected)need(completed(journal,'publish-binding')||m.intent?.step.name==='publish-binding','managed-selection-conflict');
    }else if(m.legacy.kind==='manifest'){
      capture=validateMigrationRemoval(journal as ManagedStepJournal).capture;
      if(completed(journal,'record-removal'))need(migrationRemovalComplete(journal as ManagedStepJournal),'managed-migration-conflict');
    }else{
      need(readRemovalReceipt({binding,phase:'removed',legacyInstallId:m.legacyInstallId},m.legacy.receipt),'managed-migration-conflict');
      capture=observeCapture(journal as ManagedStepJournal);
    }
    return capture;
  });
}

/** Freeze one effect's before/after claims, while admission is still read-only. */
export function managedStepEffectClaims(env:NodeJS.ProcessEnv,payload:Payload,journal:ManagedSetupStepJournal):Pick<ManagedStepIntent,'before'|'after'|'captureBefore'> {
  return platformSecurityScope(()=>{
    const captureBefore=validateManagedStepTarget(env,payload,journal),m=journal.migration;
    need(m.step&&m.step.name!=='prepare'&&!m.intent);
    if(m.format===3&&(m.step.name==='store-directory'||m.step.name==='create-store')){
      const directory=m.step.name==='store-directory',before=directory?m.fresh.directory:m.fresh.database;
      need(before.kind==='absent');
      return {before:[before],after:[{path:before.path,kind:directory?'directory':'file',object:null,digest:null}],captureBefore};
    }
    if(m.step.name==='record-removal'){
      const claims=migrationRemovalRecordClaims(journal as ManagedStepJournal);return {before:claims.before,after:claims.after,captureBefore:claims.capture};
    }
    if(['remove-selector','remove-discovery'].includes(m.step.name)){
      const layout=validateMigrationRemoval(journal as ManagedStepJournal),file=layout.file(m.step as ManagedStepRef);need(file&&captureBefore.state==='off');
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
function publication(journal:ManagedSetupStepJournal,env:NodeJS.ProcessEnv) {
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
export function managedStepEffectCommitted(env:NodeJS.ProcessEnv,payload:Payload,journal:ManagedSetupStepJournal,created?:ManagedCreationResult) {
  return platformSecurityScope(()=>{
    const capture=validateManagedStepTarget(env,payload,journal,created),m=journal.migration;
    need(m.intent&&m.step);
    // Resume retains the intent in pending state. Projection is read-only and
    // used only by lifecycle evidence checks which require a running intent;
    // actual effects still admit the exact running journal below.
    const evidence=structuredClone(journal);evidence.migration.state='running';
    if(m.state==='running')validatePublishedManagedIntent(env,journal);
    let committed:boolean;
    if(m.step.name==='expectation'||m.step.name==='publish-binding')committed=publication(journal,env).committed;
    else if(m.format===3&&['store-directory','create-store'].includes(m.step.name)){
      const directory=m.step.name==='store-directory',file=directory?path.dirname(journal.database):journal.database;
      need(canonical(m.intent.before)===canonical([{path:file,kind:'absent',object:null,digest:null}])&&
        canonical(m.intent.after)===canonical([{path:file,kind:directory?'directory':'file',object:null,digest:null}]));
      // An uncheckpointed directory is deliberately NOT adopted after restart.
      // Only the immediate exclusive-creation result admits that completion.
      committed=directory?!!created?.directory:capture.state==='off';
    }
    else if(m.format===3&&m.step.name==='register-source'){
      need(m.intent.before.length===0&&m.intent.after.length===0);
      const store=new Store(journal.database,{readOnly:true});try{committed=store.list({limit:1}).sources.some(s=>canonical(s)===canonical(journal.source));}finally{store.close();}
    }
    else if(m.step.name==='record-removal')committed=migrationRemovalRecorded(evidence as ManagedStepJournal);
    else if(m.step.name==='remove-selector'||m.step.name==='remove-discovery'){
      const layout=validateMigrationRemoval(journal as ManagedStepJournal),file=layout.file(m.step);need(file&&layout.intentFor(file));
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
export function applyManagedStepEffect(env:NodeJS.ProcessEnv,payload:Payload,journal:ManagedSetupStepJournal,freshCapture=false):ManagedCreationResult|undefined {
  requirePlatformWriteBoundary();
  requirePlatformStoreFence(journal.database);
  const m=journal.migration;
  need(m.state==='running'&&m.intent&&m.step);
  if(m.step?.name==='record-removal'){
    recordMigrationRemoval(journal as ManagedStepJournal,()=>{validateManagedStepTarget(env,payload,journal);validatePublishedManagedIntent(env,journal);});return;
  }
  if(m.step?.name==='remove-selector'||m.step?.name==='remove-discovery'){
    removeMigrationFile(journal as ManagedStepJournal,()=>{validateManagedStepTarget(env,payload,journal);validatePublishedManagedIntent(env,journal);});return;
  }
  const validate=()=>{managedStepEffectCommitted(env,payload,journal);validatePublishedManagedIntent(env,journal);};
  if(m.format===3&&m.step.name==='store-directory'){
    privateDirectory(path.dirname(journal.database),false,{exclusive:true,validate});
    return {directory:createdObject(path.dirname(journal.database),true)};
  }
  if(m.format===3&&m.step.name==='create-store'){
    // Share the existing primitive's preflight; never add an outer scope across
    // its exclusive reservation or inherit pre-create ACL authority.
    let committed=false;
    // The exact retained initialization may already be committed. Do not open
    // it writable as evidence or initialize an existing partial file.
    if(lstatSync(journal.database,{throwIfNoEntry:false})){
      platformSecurityScope(()=>{committed=managedStepEffectCommitted(env,payload,journal).committed;validatePublishedManagedIntent(env,journal);});
      need(committed,'managed-step-unsettled');
    }else {const initialized=Store.createFresh(journal.database,{storeId:journal.storeId,validate});initialized.close();}
    return {database:createdObject(journal.database)};
  }
  let store:Store|undefined;
  try{
    const prepared=platformSecurityScope(()=>{
      const result=managedStepEffectCommitted(env,payload,journal);
      if(result.committed)return;
      if(m.step?.name==='expectation'||m.step?.name==='publish-binding')return publication(journal,env);
      if(m.format===3&&m.step?.name==='register-source'){
        store=new Store(journal.database);store.subagentRunStorage();need(store.list({limit:1}).storeId===journal.storeId,'managed-source-conflict');return;
      }
      need(freshCapture&&['enable','disable'].includes(m.step?.name??''),'managed-step-unsettled');
      need(result.capture.state===m.intent!.captureBefore.state,'managed-step-unsettled');
      store=new Store(journal.database);verifyStore(store,journal);store.subagentRunStorage();
      return;
    });
    requirePlatformWriteBoundary();
    if(prepared)publishPrivateJson(prepared.file,prepared.value,prepared.replace);
    else if(store){if(m.step!.name==='register-source')store.registerSource(journal.source);else store.setEnabled(m.step!.name==='enable');}
  }finally{store?.close();}
}
