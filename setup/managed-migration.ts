import {lstatSync,readFileSync,readdirSync} from 'node:fs';
import path from 'node:path';
import {readBinding,type Binding,verifyStore} from '../shared/binding.ts';
import {managedBindingFile,managedSourceRoots,managedPath,publishPrivateJson,ManagedBindingError,managedExpectationFile} from '../shared/managed-binding.ts';
import {privatePaths,platformSecurityScope,isOwned,PlatformError,requirePlatformWriteBoundary,windows,windowsPaths} from '../shared/platform.ts';
import {Store,canonical,storageError,digest} from '../shared/store.ts';
import {ProgressError} from '../shared/progress.ts';
import {SetupError,migrationBinding,type Targets} from './lifecycle.ts';
import {parseManagedStepJournal,managedJournalBinding,sameManagedStep,type ManagedPathClaim,type ManagedStepJournal} from './managed-step-journal.ts';
import {MANAGED_STEP_LIMITS,MANAGED_OPERATION_TRANSITIONS} from '../shared/managed-steps.ts';

export interface MigrationRecord {
  binding:Binding;
  phase:'pending'|'removed'|'complete';
  legacyInstallId:string;
}
export function migrationFile(env:NodeJS.ProcessEnv){return path.join(path.dirname(managedBindingFile(env)),'migration.json');}
/** A fixed private same-target selection, never a search or recovery authority for foreign bytes. */
export function readMigration(env:NodeJS.ProcessEnv):MigrationRecord|undefined {
  return platformSecurityScope(()=>{
    const file=migrationFile(env);if(!lstatSync(file,{throwIfNoEntry:false}))return;
    managedPath(file);
    if(!privatePaths([path.dirname(file),file]))throw new SetupError('managed-migration-conflict');
    const raw=readBinding(file) as Binding&{migration?:{format:number;product:string;phase:MigrationRecord['phase'];legacyInstallId:string}};
    const m=raw.migration,roots=managedSourceRoots(env);
    if(!m||m.format!==1||m.product!=='openchamber-agent-progress-managed'||!['pending','removed','complete'].includes(m.phase)||
      typeof m.legacyInstallId!=='string'||!m.legacyInstallId||m.legacyInstallId===raw.installId||raw.source.configRoot!==roots.configRoot||raw.source.dataRoot!==roots.dataRoot||!raw.source.verified||
      [roots.configRoot,roots.dataRoot,path.dirname(file)].includes(path.dirname(raw.database))||
      ![roots.configRoot,roots.dataRoot].every(root=>lstatSync(root).isDirectory()&&isOwned(root)))throw new SetupError('managed-migration-conflict');
    const {protocolVersion,schemaVersion,installId,version,database,storeId,source}=raw;
    const binding={protocolVersion,schemaVersion,installId,version,database,storeId,source};
    const store=new Store(database,{readOnly:true});try{verifyStore(store,binding);store.subagentRunStorage();}finally{store.close();}
    return {binding,phase:m.phase,legacyInstallId:m.legacyInstallId};
  });
}
export function writeMigration(env:NodeJS.ProcessEnv,record:MigrationRecord) {
  // One read-only preflight per publication. Never carry its security cache into
  // the write or the next phase's revalidation.
  const {prior,file}=platformSecurityScope(()=>({prior:readMigration(env),file:migrationFile(env)}));
  if(prior&&(canonical(prior.binding)!==canonical(record.binding)||prior.legacyInstallId!==record.legacyInstallId))throw new SetupError('managed-migration-conflict');
  publishPrivateJson(file,{...record.binding,migration:{format:1,product:'openchamber-agent-progress-managed',phase:record.phase,legacyInstallId:record.legacyInstallId}},!!prior);
}
export function sameMigrationTarget(a:Binding,b:Binding) {
  return a.database===b.database&&a.storeId===b.storeId&&canonical(a.source)===canonical(b.source);
}
/** Ownership/identity evidence is distinct from inability to inspect it. */
export function migrationError(e:unknown):SetupError|ProgressError|PlatformError {
  if(e instanceof PlatformError&&e.code==='windows-security-unavailable')return e;
  if(e instanceof SetupError&&e.code==='windows-security-unavailable')return new PlatformError(e.code);
  if(e instanceof ProgressError&&e.code!=='binding')return e;
  if(e instanceof SetupError||e instanceof PlatformError||e instanceof ManagedBindingError||e instanceof SyntaxError||e instanceof ProgressError||
    ['ENOENT','ENOTDIR','ELOOP'].includes((e as NodeJS.ErrnoException)?.code??''))return new SetupError('managed-migration-conflict');
  return storageError(e);
}
/** Canonical legacy location only; the full removal preflight validates it and the actual Store. */
export function legacyMigration(env:NodeJS.ProcessEnv) {
  return platformSecurityScope(()=>legacyMigrationInner(env));
}
function legacyMigrationInner(env:NodeJS.ProcessEnv):({targets:Targets}&ReturnType<typeof migrationBinding>)|undefined {
  const roots=managedSourceRoots(env),root=path.join(roots.configRoot,'plugins/agent-progress');
  if(!lstatSync(root,{throwIfNoEntry:false}))return;
  try{
    const b=readBinding(path.join(root,'progress-binding.json'));
    const targets={...roots,storeRoot:path.dirname(b.database),confirmed:true};
    return {...migrationBinding(targets),targets};
  }catch(e){throw migrationError(e);}
}
/** Removal can finish before the wrapper writes its next phase. Require its durable same-install receipt. */
export function removalRecorded(record:MigrationRecord) {
  return platformSecurityScope(()=>removalRecordedInner(record));
}
function removalRecordedInner(record:MigrationRecord) {
  const file=path.join(path.dirname(record.binding.database),'installation-history.jsonl');
  managedPath(file);
  const s=lstatSync(file);
  if(!s.isFile()||s.isSymbolicLink()||!privatePaths([path.dirname(file),file]))throw new SetupError('managed-migration-conflict');
  return readFileSync(file,'utf8').trim().split('\n').some(line=>{
    try{const e=JSON.parse(line);return e.action==='remove-capture'&&e.installId===record.legacyInstallId;}catch{return false;}
  });
}

export interface ManagedRemovalReceipt { history:ManagedPathClaim; entry:string }
/** Specific retained evidence for format-1 recovery. This read never disables,
 * removes, repairs or appends anything. An earlier true removalRecorded() result
 * is deliberately not accepted as authority, nor is a coarse removed phase. */
export function readRemovalReceipt(record:MigrationRecord,retained?:ManagedRemovalReceipt):ManagedRemovalReceipt|undefined {
  return platformSecurityScope(()=>{
    const b=record.binding;
    const conflict=()=>{throw new SetupError('managed-migration-conflict');};
    if(!b.source.verified||!record.legacyInstallId||record.legacyInstallId===b.installId)conflict();
    for(const root of [b.source.configRoot,b.source.dataRoot,path.dirname(b.database)]){
      managedPath(root);if(!lstatSync(root).isDirectory()||!isOwned(root))conflict();
    }
    const legacy=managedPath(path.join(b.source.configRoot,'plugins/agent-progress'),true);
    // A receipt cannot authorize removing or overlooking remaining discovery.
    if(lstatSync(legacy,{throwIfNoEntry:false}))conflict();
    for(const file of [b.database,...['-journal','-wal','-shm'].map(suffix=>b.database+suffix)]){
      const stat=lstatSync(file,{throwIfNoEntry:false});if(!stat)continue;
      managedPath(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||!privatePaths([file]))conflict();
    }
    const store=new Store(b.database,{readOnly:true});
    try{verifyStore(store,b);store.subagentRunStorage();}finally{store.close();}
    const file=managedPath(path.join(path.dirname(b.database),'installation-history.jsonl'));
    const before=lstatSync(file,{bigint:true});
    if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1n||!privatePaths([path.dirname(file),file]))conflict();
    const object={device:String(before.dev),inode:String(before.ino),birthNs:String(before.birthtimeNs)};
    if(retained&&(retained.history.path!==file||retained.history.kind!=='file'||
      canonical(retained.history.object)!==canonical(object)))conflict();
    const bytes=readFileSync(file),after=lstatSync(file,{bigint:true});
    if([before.dev,before.ino,before.birthtimeNs,before.size,before.mtimeNs,before.ctimeNs,before.nlink].join(':')!==
      [after.dev,after.ino,after.birthtimeNs,after.size,after.mtimeNs,after.ctimeNs,after.nlink].join(':'))conflict();
    let text:string;
    try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw new SetupError('managed-migration-conflict');}
    let entry:string|undefined;
    for(const line of text.split('\n')){
      if(retained&&line!==retained.entry)continue;
      try{const event=JSON.parse(line);if(event?.action==='remove-capture'&&event.installId===record.legacyInstallId){entry=line;break;}}catch{/* Other historical lines grant no authority. */}
    }
    if(!entry){if(retained)conflict();return;}
    // Later appends are allowed only in this same freshly validated owned file
    // with the exact retained event still present. The old hash is a claim, not
    // an ACL verdict or a requirement that unrelated history stop growing.
    return {history:{path:file,kind:'file',object,digest:digest(bytes)},entry};
  });
}

function journalSnapshot(file:string) {
  const s=lstatSync(file,{bigint:true});
  return [s.dev,s.ino,s.birthtimeNs,s.size,s.mtimeNs,s.ctimeNs,s.mode,s.nlink].join(':');
}
/** Known paths are claims, including fixed names that may not exist yet. A fresh
 * batch checks them and their ancestors before any existing owner reads them. */
export function managedJournalPaths(journal:ManagedStepJournal):string[] {
  const root=path.join(journal.source.dataRoot,'agent-progress-managed'),m=journal.migration;
  const paths=[...new Set([journal.source.configRoot,journal.source.dataRoot,path.dirname(journal.database),journal.database,
    ...['-journal','-wal','-shm'].map(s=>journal.database+s),root,path.join(root,'.ownership.json'),path.join(root,'progress-binding.json'),path.join(root,'migration.json'),
    managedExpectationFile(journal),path.join(path.dirname(journal.database),'installation-history.jsonl'),
    ...m.legacy.claims.map(c=>c.path),...(m.legacy.kind==='removal-receipt'?[m.legacy.receipt.history.path]:[]),
    ...(m.intent?[...m.intent.before,...m.intent.after].map(c=>c.path):[])])];
  if(paths.length>MANAGED_STEP_LIMITS.claimPaths)throw new SetupError('managed-step-limit');
  return paths;
}
/** Journal observation, not Store admission. This reader validates the private
 * envelope/roots and consistency only; each engine effect must freshly validate
 * its complete claims, lifecycle ownership and actual Store/source/schema. */
export function readManagedStepJournal(env:NodeJS.ProcessEnv):ManagedStepJournal|undefined {
  return platformSecurityScope(()=>{
    const file=migrationFile(env),root=path.dirname(file);
    if(!lstatSync(root,{throwIfNoEntry:false}))return;
    if(lstatSync(path.join(root,'.ownership.json')).nlink!==1)throw new SetupError('managed-binding-invalid');
    // Never sweep interrupted publication or a retained old configuration lock.
    const names=readdirSync(root);
    if(names.includes('.configuration-lock'))throw new SetupError('managed-configuration-busy');
    if(names.some(name=>name.startsWith('migration.json.stage-')))throw new SetupError('managed-migration-conflict');
    const stat=lstatSync(file,{throwIfNoEntry:false});if(!stat)return;
    managedPath(file);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||!privatePaths([root,file]))throw new SetupError('managed-migration-conflict');
    if(stat.size>MANAGED_STEP_LIMITS.journalBytes)throw new SetupError('managed-step-limit');
    const before=journalSnapshot(file),journal=parseManagedStepJournal(readFileSync(file));
    // Retain the existing Binding owner's native path/identity checks, including
    // actual roots. Parsing the saved claims does not replace those checks.
    const binding=readBinding(file),roots=managedSourceRoots(env);
    if(canonical(managedJournalBinding(binding))!==canonical(managedJournalBinding(journal))||
      journal.source.configRoot!==roots.configRoot||journal.source.dataRoot!==roots.dataRoot||
      [roots.configRoot,roots.dataRoot,root].includes(path.dirname(journal.database))||
      ![roots.configRoot,roots.dataRoot].every(p=>lstatSync(p).isDirectory()&&isOwned(p))||
      before!==journalSnapshot(file))throw new SetupError('managed-migration-conflict');
    return journal;
  });
}

/** Guard journal evolution as well as its syntax. This is not a writer lock or
 * authorization: callers hold the request fence and separately validate effects. */
export function validateManagedJournalChange(prior:ManagedStepJournal,next:ManagedStepJournal):void {
  const fail=()=>{throw new SetupError('managed-step-conflict');};
  const a=prior.migration,b=next.migration;
  if(a.operationId!==b.operationId||canonical(managedJournalBinding(prior))!==canonical(managedJournalBinding(next))||
    canonical(a.consent)!==canonical(b.consent)||canonical(a.expectation)!==canonical(b.expectation)||
    canonical(a.legacy)!==canonical(b.legacy)||canonical(a.plan)!==canonical(b.plan)||a.legacyInstallId!==b.legacyInstallId)fail();
  if(a.state==='complete') {if(canonical(prior)!==canonical(next))fail();return;}
  if(b.sequence!==a.sequence&&b.sequence!==a.sequence+1)fail();
  if(b.sequence===a.sequence+1&&b.state===a.state&&a.state!=='pending')fail();
  if(b.state!==a.state&&!(MANAGED_OPERATION_TRANSITIONS[a.state] as readonly string[]).includes(b.state))fail();
  if(b.captureRenewals.length<a.captureRenewals.length||b.captureRenewals.length>a.captureRenewals.length+1||
    canonical(b.captureRenewals.slice(0,a.captureRenewals.length))!==canonical(a.captureRenewals))fail();
  const added=b.captureRenewals.length>a.captureRenewals.length;
  if(added){
    const renewal=b.captureRenewals.at(-1)!;
    if(b.sequence!==a.sequence+1||b.state!=='pending'||renewal.sequence!==b.sequence||!a.intent||
      canonical(renewal.priorIntent)!==canonical(a.intent)||canonical(b.intent)!==canonical(a.intent)||
      !sameManagedStep(a.step,b.step)||!sameManagedStep(a.lastCompleted,b.lastCompleted))fail();
  }
  if(b.sequence===a.sequence){
    // The only unsequenced write is intent publication/reconciliation. It may
    // never move the plan, erase evidence, settle a receipt or stop the worker.
    if(b.state!=='running'||!b.intent||!sameManagedStep(a.step,b.step)||!sameManagedStep(a.lastCompleted,b.lastCompleted)||
      b.phase!==a.phase||canonical(b.receipt)!==canonical(a.receipt)||added)fail();
    if(a.intent&&canonical(a.intent)!==canonical(b.intent)){
      const renewal=a.captureRenewals.at(-1);
      if(!renewal||canonical(renewal.priorIntent)!==canonical(a.intent)||b.intent!.captureReviewSequence!==renewal.sequence||
        b.intent!.expectedSequence!==a.sequence||b.intent!.requestDigest===a.intent.requestDigest)fail();
    }else if(!a.intent&&b.intent!.expectedSequence!==a.sequence)fail();
    return;
  }
  if(!b.receipt||b.receipt.expectedSequence!==a.sequence||b.receipt.sequence!==b.sequence)fail();
  if(!sameManagedStep(a.lastCompleted,b.lastCompleted)){
    // Only completion of the durable current intent advances the immutable plan.
    if(a.state!=='running'||!a.intent||!sameManagedStep(a.step,b.lastCompleted)||b.intent!==null||
      !['pending','complete'].includes(b.state)||b.receipt!.outcome!=='applied'||
      a.intent.expectedSequence===a.sequence&&b.receipt!.requestDigest!==a.intent.requestDigest||
      !sameManagedStep(b.receipt!.step,a.step)||added)fail();
  }else{
    // Controls and failed settlements retain the unresolved intent verbatim.
    if(!sameManagedStep(a.step,b.step)||b.phase!==a.phase||canonical(a.intent)!==canonical(b.intent)||
      !['pending','paused','abandoned','failed'].includes(b.state))fail();
    if(b.state==='failed'&&b.receipt!.outcome!=='failed'||b.state!=='failed'&&b.receipt!.outcome!=='applied')fail();
  }
}

/** Existing private-file publication only: never create/adopt a directory here.
 * The engine invokes unchanged createManagedBindingDirectory for prepare first.
 * expected is a compare-before-publication claim, not authority or an OS lock. */
export function writeManagedStepJournal(env:NodeJS.ProcessEnv,next:ManagedStepJournal,expected?:ManagedStepJournal,validate?:()=>void):void {
  publishManagedJournal(env,next,expected,validate);
  const written=platformSecurityScope(()=>{if(windows)windowsPaths(managedJournalPaths(next),true);return readManagedStepJournal(env);});
  if(!written||canonical(written)!==canonical(next))throw new SetupError('managed-step-unsettled');
}

/** Publish only an unsequenced intent. Unlike a settled checkpoint, this is not
 * a successful action receipt. The effect owner MUST read it back and compare
 * it in its fresh admission batch before any effect (see recordMigrationRemoval).
 * Combining those reads avoids a redundant launch without reusing authority
 * across a mutation. A crash here leaves running/unsettled, never completion. */
export function publishManagedStepIntent(env:NodeJS.ProcessEnv,next:ManagedStepJournal,expected:ManagedStepJournal,validate:()=>void):void {
  if(next.migration.state!=='running'||!next.migration.intent||next.migration.sequence!==expected.migration.sequence)
    throw new SetupError('managed-step-conflict');
  publishManagedJournal(env,next,expected,validate);
}

/** Read-only exact intent admission; caller may prebatch known paths in this
 * same scope, but must end it before the effect. No prior ACL verdict is used. */
export function validatePublishedManagedIntent(env:NodeJS.ProcessEnv,expected:ManagedStepJournal):void {
  const current=readManagedStepJournal(env);
  if(expected.migration.state!=='running'||!expected.migration.intent||!current||canonical(current)!==canonical(expected))
    throw new SetupError('managed-step-unsettled');
}

function publishManagedJournal(env:NodeJS.ProcessEnv,next:ManagedStepJournal,expected?:ManagedStepJournal,validate?:()=>void):void {
  requirePlatformWriteBoundary();
  // Parse serialized bytes before touching product state (also enforces limits).
  const checked=parseManagedStepJournal(JSON.stringify(next));
  const known=managedJournalPaths(checked);
  const file=platformSecurityScope(()=>{
    if(windows)windowsPaths(known,true);
    const current=readManagedStepJournal(env);
    if(expected? !current||canonical(current)!==canonical(expected):!!current)throw new SetupError('managed-step-conflict');
    if(current)validateManagedJournalChange(current,checked);
    else {
      const m=checked.migration;
      if(m.sequence!==1||m.state!=='pending'||m.intent!==null||m.captureRenewals.length||
        !sameManagedStep(m.lastCompleted,{name:'prepare',batch:0})||!m.receipt||m.receipt.expectedSequence!==0||
        m.receipt.outcome!=='applied'||!sameManagedStep(m.receipt.step,m.lastCompleted))throw new SetupError('managed-step-conflict');
    }
    const file=migrationFile(env),root=path.dirname(file);
    if(!lstatSync(root,{throwIfNoEntry:false})?.isDirectory()||!privatePaths([root]))throw new SetupError('managed-binding-invalid');
    const roots=managedSourceRoots(env);
    if(checked.source.configRoot!==roots.configRoot||checked.source.dataRoot!==roots.dataRoot||
      [roots.configRoot,roots.dataRoot,root].includes(path.dirname(checked.database)))throw new SetupError('managed-migration-conflict');
    // Engine-supplied lifecycle/Store verification shares only this fresh read
    // batch. It is never run under the effect's earlier security scope.
    validate?.();
    return file;
  });
  requirePlatformWriteBoundary();
  publishPrivateJson(file,checked,!!expected);
}
