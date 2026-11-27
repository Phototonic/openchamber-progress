import {lstatSync,readFileSync,readdirSync} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {type Binding,verifyStore} from '../shared/binding.ts';
import {Store,canonical,digest} from '../shared/store.ts';
import {activationFingerprint} from '../shared/activation.ts';
import {managedSourceRoots,managedBindingFile,managedPath,readManagedBinding,managedExpectationFile,managedDefaultStoreRoot} from '../shared/managed-binding.ts';
import {windows,windowsPaths,privatePaths,isOwned} from '../shared/platform.ts';
import {MANAGED_INSPECTION_STEPS,MANAGED_STEP_LIMITS,type ManagedInspection,type ManagedCaptureObservation,type ManagedStepProgress} from '../shared/managed-steps.ts';
import type {ManagedReview} from '../shared/progress.ts';
import {SetupError,discoverMigrationPaths,migrationEvidence,validateMigrationRemoval,type Payload} from './lifecycle.ts';
import {migrationFile,readMigration,readManagedStepJournal,readRemovalReceipt,managedJournalPaths,type MigrationRecord} from './managed-migration.ts';
import {managedJournalBinding,managedJournalProgress,managedTargetDigest,type ManagedStepJournal,type ManagedPathClaim} from './managed-step-journal.ts';
import {ManagedStepFailure} from './managed-diagnostic.ts';
import {MANAGED_FRESH_INSPECTION_STEPS,managedFreshPlan,type ManagedFreshInspection,type ManagedFreshStepProgress} from '../shared/managed-steps.ts';
import type {ManagedFreshReview} from '../shared/progress.ts';
import {readManagedFreshStepJournal} from './managed-migration.ts';
import {managedFreshJournalProgress,type ManagedFreshStepJournal} from './managed-step-journal.ts';

/** Private supervisor/worker state. NEVER accept this object from an HTTP body.
 * Paths and hashes are discovery claims only, not reusable verdicts. */
export interface ManagedInspectionSession {
  nonce:string;
  cursor:string;
  stage:number;
  storeRoot?:string;
  roots:{configRoot:string;dataRoot:string};
  selection:ManagedPathClaim;
  record:ManagedPathClaim;
  binding?:Binding;
  prior?:MigrationRecord;
  operation?:ManagedStepJournal;
  discovered?:ReturnType<typeof discoverMigrationPaths>;
  candidate?:ManagedStepJournal;
  review?:ManagedReview;
}
export interface ManagedInspectionResult {
  inspection:ManagedInspection;
  progress:ManagedStepProgress|null;
  session:ManagedInspectionSession;
}
function need(value:unknown,code='managed-review-stale'):asserts value {if(!value)throw new SetupError(code);}
function batch(paths:string[]) {
  const unique=[...new Set(paths)];
  if(unique.length>MANAGED_STEP_LIMITS.claimPaths)throw new SetupError('managed-step-limit');
  if(windows)windowsPaths(unique,true);
}
function snapshot(file:string) {
  const s=lstatSync(file,{bigint:true});
  return [s.dev,s.ino,s.birthtimeNs,s.size,s.mtimeNs,s.ctimeNs,s.mode,s.nlink].join(':');
}
/** This reads only fixed discovery files, never the database's contents. */
function claim(file:string):ManagedPathClaim {
  managedPath(file,true);const s=lstatSync(file,{bigint:true,throwIfNoEntry:false});
  if(!s)return {path:file,kind:'absent',object:null,digest:null};
  need(s.isFile()&&!s.isSymbolicLink()&&s.nlink===1n&&privatePaths([path.dirname(file),file]),'managed-migration-conflict');
  if(s.size>BigInt(MANAGED_STEP_LIMITS.journalBytes))throw new SetupError('managed-step-limit');
  const before=snapshot(file),hash=digest(readFileSync(file));
  need(before===snapshot(file));
  return {path:file,kind:'file',object:{device:String(s.dev),inode:String(s.ino),birthNs:String(s.birthtimeNs)},digest:hash};
}
function basePaths(roots:ManagedInspectionSession['roots']) {
  const root=path.join(roots.dataRoot,'agent-progress-managed');
  return [roots.configRoot,roots.dataRoot,root,path.join(root,'.ownership.json'),path.join(root,'progress-binding.json'),path.join(root,'migration.json')];
}
function storePaths(binding:Binding) {
  return [path.dirname(binding.database),binding.database,...['-journal','-wal','-shm'].map(s=>binding.database+s),
    managedExpectationFile(binding),path.join(path.dirname(binding.database),'installation-history.jsonl')];
}
function paths(session:ManagedInspectionSession) {
  return [...basePaths(session.roots),...(session.candidate?managedJournalPaths(session.candidate):
    session.operation?managedJournalPaths(session.operation):session.prior?storePaths(session.prior.binding):session.binding?storePaths(session.binding):[]),
    ...(session.discovered?[...session.discovered.paths,...storePaths(session.discovered.binding)]:[])];
}
function container(env:NodeJS.ProcessEnv) {
  const file=managedBindingFile(env),root=path.dirname(file);
  if(lstatSync(root,{throwIfNoEntry:false})){
    const names=readdirSync(root);
    need(!names.includes('.configuration-lock'),'managed-configuration-busy');
    need(!names.some(n=>n.startsWith('migration.json.stage-')||n.startsWith('progress-binding.json.stage-')),'managed-migration-conflict');
    need(lstatSync(path.join(root,'.ownership.json'),{throwIfNoEntry:false})?.nlink===1,'managed-binding-invalid');
  }
  return file;
}
function sameDiscovery(env:NodeJS.ProcessEnv,session:ManagedInspectionSession) {
  need(canonical(managedSourceRoots(env))===canonical(session.roots));
  for(const root of Object.values(session.roots))need(lstatSync(root).isDirectory()&&isOwned(root),'path-unverified');
  need(canonical(claim(container(env)))===canonical(session.selection));
  need(canonical(claim(migrationFile(env)))===canonical(session.record));
}
function capture(binding:Binding):ManagedCaptureObservation {
  const store=new Store(binding.database,{readOnly:true});
  try{verifyStore(store,binding);store.subagentRunStorage();return {state:store.list({limit:1}).captureEnabled?'on':'off',observedAt:new Date().toISOString()};}
  finally{store.close();}
}
function expectation(binding:Binding,payload:Payload) {
  need(payload.plugin&&payload.guidance&&/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i.test(payload.version),'payload-invalid');
  return {version:payload.version,fingerprint:activationFingerprint({...managedJournalBinding(binding),version:payload.version},Buffer.from(payload.plugin),Buffer.from(payload.guidance))};
}
function validateCandidate(session:ManagedInspectionSession,payload:Payload):ManagedCaptureObservation {
  const candidate=session.candidate!;
  need(canonical(candidate.migration.expectation)===canonical(expectation(candidate,payload)));
  if(candidate.migration.legacy.kind==='manifest')return validateMigrationRemoval(candidate).capture;
  need(!!readRemovalReceipt({binding:managedJournalBinding(candidate),phase:'removed',legacyInstallId:candidate.migration.legacyInstallId},candidate.migration.legacy.receipt));
  return capture(candidate);
}
function reviewFor(session:ManagedInspectionSession,observed:ManagedCaptureObservation):ManagedReview {
  const journal=session.candidate!;
  const s=lstatSync(journal.database,{bigint:true});
  // The full operation includes its sequence, intent, decision and renewals.
  // Observation time is incidental; the freshly observed capture bit is not.
  const expected=digest(canonical({nonce:session.nonce,targetDigest:managedTargetDigest(journal),plan:journal.migration.plan,
    operation:session.operation??null,selection:session.selection,record:session.record,
    database:{device:String(s.dev),inode:String(s.ino),birthNs:String(s.birthtimeNs)},capture:observed.state}));
  return {expected,targets:{...session.roots,storeRoot:path.dirname(journal.database)},storeId:journal.storeId,sourceId:journal.source.id};
}
/** Mutation admission calls this again under its OWN fresh batch/fence. An
 * opaque token alone, or a worker's earlier observation, never authorizes it. */
export function validateManagedInspectionReview(env:NodeJS.ProcessEnv,payload:Payload,session:ManagedInspectionSession) {
  need(session.stage===MANAGED_INSPECTION_STEPS.length&&session.review&&session.candidate,'managed-inspection-expired');
  batch(paths(session));sameDiscovery(env,session);
  const observed=validateCandidate(session,payload),review=reviewFor(session,observed);
  need(review.expected===session.review.expected);
  return {candidate:structuredClone(session.candidate),prior:session.prior&&structuredClone(session.prior),
    operation:session.operation&&structuredClone(session.operation),capture:observed,review};
}

/** Exactly one read-only stage. The supervisor supplies prior state, never the
 * caller. Every stage gets a new opaque cursor and revalidates its paths. */
export function inspectManagedStep(env:NodeJS.ProcessEnv,payload:Payload,prior?:ManagedInspectionSession,storeRoot?:string):ManagedInspectionResult {
  let stage:typeof MANAGED_INSPECTION_STEPS[number]='roots',known:ManagedStepJournal|undefined;
  try{
    let session:ManagedInspectionSession;
    if(!prior){
      const roots=managedSourceRoots(env);batch(basePaths(roots));
      for(const root of Object.values(roots))need(lstatSync(root).isDirectory()&&isOwned(root),'path-unverified');
      const file=container(env);
      session={nonce:randomUUID(),cursor:randomUUID(),stage:1,roots,selection:claim(file),record:claim(migrationFile(env)),
        ...(storeRoot!==undefined?{storeRoot:managedPath(storeRoot,true)}:{})};
      return {session,progress:null,inspection:{state:'incomplete',stage:'roots',cursor:session.cursor}};
    }
    session=structuredClone(prior);
    need(session.stage>0&&session.stage<MANAGED_INSPECTION_STEPS.length,'managed-inspection-expired');
    stage=MANAGED_INSPECTION_STEPS[session.stage]!;
    batch(paths(session));sameDiscovery(env,session);
    known=session.operation;
    if(stage==='managed-state'){
      const selected=readManagedBinding(env);
      if(selected)session.binding=selected;
      if(session.record.kind!=='absent'){
        let raw: {migration?:{format?:unknown}};
        try{raw=JSON.parse(readFileSync(session.record.path,'utf8'));}
        catch{throw new SetupError('managed-journal-unsupported');}
        if(raw?.migration?.format===2){session.operation=readManagedStepJournal(env);known=session.operation;}
        else if(raw?.migration?.format===1)session.prior=readMigration(env);
        else throw new SetupError('managed-journal-unsupported');
      }
      const retained=session.operation??session.prior?.binding;
      need(!selected||!retained||canonical(selected)===canonical(managedJournalBinding(retained)),'managed-migration-conflict');
      need(session.prior?.phase!=='complete','managed-step-conflict');
      if(retained&&session.storeRoot!==undefined)need(session.storeRoot===path.dirname(retained.database),'managed-selection-conflict');
    }else if(stage==='legacy-discovery'){
      if(session.operation)session.candidate=structuredClone(session.operation);
      else {
        const legacy=path.join(session.roots.configRoot,'plugins','agent-progress');managedPath(legacy,true);
        if(lstatSync(legacy,{throwIfNoEntry:false})){
          session.discovered=discoverMigrationPaths(session.roots);
          if(session.binding)need(session.binding.installId!==session.discovered.binding.installId&&
            session.binding.database===session.discovered.binding.database&&session.binding.storeId===session.discovered.binding.storeId&&
            canonical(session.binding.source)===canonical(session.discovered.binding.source),'managed-migration-conflict');
          if(session.storeRoot!==undefined)need(session.storeRoot===path.dirname(session.discovered.binding.database),'managed-selection-conflict');
          if(session.prior)need(session.prior.legacyInstallId===session.discovered.binding.installId&&
            session.prior.binding.database===session.discovered.binding.database&&session.prior.binding.storeId===session.discovered.binding.storeId&&
            canonical(session.prior.binding.source)===canonical(session.discovered.binding.source),'managed-migration-conflict');
        }else need(session.prior,'managed-migration-required');
      }
      // Refuse excessive discovered sets before issuing confirmation, not after
      // a truncated successful review. Ancestors are deduplicated by platform.
      if(new Set(paths(session)).size>MANAGED_STEP_LIMITS.claimPaths)throw new SetupError('managed-step-limit');
    }else if(stage==='legacy-releases'){
      if(session.candidate)validateCandidate(session,payload);
      else {
        const discovered=session.discovered;
        let evidence:ReturnType<typeof migrationEvidence>|undefined;
        if(discovered){
          // Compare the freshly read fixed manifest before owned() follows any
          // release paths. A changed discovered set requires new inspection.
          const current=discoverMigrationPaths(session.roots);need(canonical(current)===canonical(discovered));
          evidence=migrationEvidence({...session.roots,storeRoot:path.dirname(discovered.binding.database),confirmed:true});
          need(evidence.legacy.ownership===discovered.ownership);
        }
        const binding=session.prior?.binding??session.binding??{...evidence!.binding,installId:`managed-${digest(JSON.stringify([evidence!.binding.storeId,evidence!.binding.source]))}`,version:payload.version};
        const receipt=!evidence&&session.prior?readRemovalReceipt(session.prior):undefined;
        need(evidence||receipt,'managed-migration-conflict');
        const legacy=evidence?.legacy??{kind:'removal-receipt' as const,ownership:null,ownershipDigest:null,
          claims:[{path:path.join(session.roots.configRoot,'plugins','agent-progress'),kind:'absent' as const,object:null,digest:null}],receipt:receipt!};
        const plan=evidence?.plan??(['prepare','expectation','publish-binding','enable','reconcile'] as const).map(name=>({name,batch:0}));
        // A preview only: no operation is admitted and no receipt is persisted.
        session.candidate={...binding,migration:{format:2,product:'openchamber-agent-progress-managed',phase:evidence?'pending':'removed',
          legacyInstallId:session.prior?.legacyInstallId??evidence!.binding.installId,operationId:session.nonce,sequence:1,state:'pending',
          step:plan[1]!,lastCompleted:plan[0]!,consent:{reviewDigest:'0'.repeat(64),targetDigest:'0'.repeat(64),planDigest:digest(canonical(plan))},
          expectation:expectation(binding,payload),plan,legacy,captureRenewals:[],intent:null,receipt:null,capture:{state:'unknown',observedAt:null},diagnostic:null}};
        session.candidate.migration.consent.targetDigest=managedTargetDigest(session.candidate);
        // Includes managed expectation paths not present in legacy discovery.
        if(new Set(paths(session)).size>MANAGED_STEP_LIMITS.claimPaths)throw new SetupError('managed-step-limit');
      }
    }else if(stage==='store'){
      validateCandidate(session,payload);
      // Also retain a stable schema/identity observation before the final review.
      capture(session.candidate!);
    }else if(stage==='review'){
      const observed=validateCandidate(session,payload);
      session.review=reviewFor(session,observed);session.stage++;session.cursor=randomUUID();
      return {session,inspection:{state:'complete',stage:'review',cursor:null,review:session.review},
        progress:session.operation?managedJournalProgress(session.operation,observed):null};
    }
    session.stage++;session.cursor=randomUUID();
    return {session,progress:session.operation?managedJournalProgress(session.operation):null,inspection:{state:'incomplete',stage,cursor:session.cursor}};
  }catch(error){throw new ManagedStepFailure(error,stage,known);}
}

export interface ManagedFreshInspectionSession {
  family:2;
  nonce:string;
  cursor:string;
  stage:number;
  storeRoot:string;
  explicitStoreRoot?:true;
  roots:{configRoot:string;dataRoot:string};
  selection:ManagedPathClaim;
  record:ManagedPathClaim;
  operation?:ManagedFreshStepJournal;
  candidate?:ManagedFreshStepJournal;
  review?:ManagedFreshReview;
}
export interface ManagedFreshInspectionResult {
  inspection:ManagedFreshInspection;
  progress:ManagedFreshStepProgress|null;
  session:ManagedFreshInspectionSession;
}

/** Bounded native-object observation, not a hash of an arbitrarily large DB. */
export function managedFreshObjectClaim(file:string,directory=false):ManagedPathClaim {
  managedPath(file,true);const s=lstatSync(file,{bigint:true,throwIfNoEntry:false});
  if(!s)return {path:file,kind:'absent',object:null,digest:null};
  need(!s.isSymbolicLink()&&(directory?s.isDirectory():s.isFile()&&s.nlink===1n)&&privatePaths([file]),'managed-migration-conflict');
  return {path:file,kind:directory?'directory':'file',object:{device:String(s.dev),inode:String(s.ino),birthNs:String(s.birthtimeNs)},digest:null};
}
function freshPaths(s:ManagedFreshInspectionSession) {
  return [...basePaths(s.roots),s.storeRoot,path.join(s.storeRoot,'progress.sqlite'),
    ...['-journal','-wal','-shm'].map(x=>path.join(s.storeRoot,'progress.sqlite')+x),
    path.join(s.roots.configRoot,'plugins','agent-progress'),...(s.candidate?managedJournalPaths(s.candidate):[])];
}
function freshDiscovery(env:NodeJS.ProcessEnv,s:ManagedFreshInspectionSession) {
  need(canonical(managedSourceRoots(env))===canonical(s.roots));
  for(const root of Object.values(s.roots))need(lstatSync(root).isDirectory()&&isOwned(root),'path-unverified');
  need(canonical(claim(container(env)))===canonical(s.selection));
  need(canonical(claim(migrationFile(env)))===canonical(s.record));
  const legacy=managedPath(path.join(s.roots.configRoot,'plugins','agent-progress'),true);
  need(!lstatSync(legacy,{throwIfNoEntry:false}),'managed-migration-required');
}
/** Fresh read-only Store observation; missing storage is allowed ONLY before its
 * completion. Exact initialization can reconcile from the retained creation intent. */
export function observeManagedFreshStore(j:ManagedFreshStepJournal,mode:'strict'|'selected-status'='strict'):ManagedCaptureObservation {
  const m=j.migration,f=m.fresh,dir=managedFreshObjectClaim(path.dirname(j.database),true),db=managedFreshObjectClaim(j.database);
  const sidecars=f.sidecars.map(c=>managedFreshObjectClaim(c.path));
  const expectedDir=m.created.directory??f.directory,expectedDb=m.created.database??f.database;
  // Only completed status may compare against historical evidence without the
  // device number. This projection is never saved or used for step validation.
  const ignoreDevice=mode==='selected-status'&&m.state==='complete';
  const comparable=(object:ManagedPathClaim['object'])=>ignoreDevice&&object?{...object,device:'0'}:object;
  const directory=(claim:ManagedPathClaim)=>({...claim,object:comparable(claim.object)});
  need(canonical(directory(dir))===canonical(directory(expectedDir)),'managed-migration-conflict');
  if(db.kind==='absent'){
    need(expectedDb.kind==='absent'&&sidecars.every(c=>c.kind==='absent'),'managed-migration-conflict');
    if(dir.kind==='directory')need(readdirSync(dir.path).length===0,'foreign-files');
    return {state:'unknown',observedAt:null};
  }
  const initialized=expectedDb.kind==='absent';
  if(initialized)need(m.intent?.step.name==='create-store'&&sidecars.every(c=>c.kind==='absent'),'managed-migration-conflict');
  else need(canonical(comparable(db.object))===canonical(comparable(expectedDb.object)),'managed-migration-conflict');
  const store=new Store(j.database,{readOnly:true});
  try{
    store.subagentRunStorage();const e=store.list({limit:1});need(e.storeId===j.storeId,'managed-source-conflict');
    const matching=e.sources.filter(s=>s.id===j.source.id||s.configRoot===j.source.configRoot&&s.dataRoot===j.source.dataRoot);
    need(matching.length<=1&&matching.every(s=>canonical(s)===canonical(j.source)),'managed-source-conflict');
    const completed=m.plan.findIndex(s=>s.name==='register-source'),last=m.plan.findIndex(s=>canonical(s)===canonical(m.lastCompleted));
    const registered=f.sourceMode==='reuse'||completed>=0&&last>=completed;
    if(registered)need(matching.length===1,'managed-source-conflict');
    else if(matching.length)need(m.intent?.step.name==='register-source','managed-source-conflict');
    // Creation evidence stays strict throughout unfinished intent recovery.
    // Complete is terminal: unrelated sources and later capture changes are valid.
    if(f.storeMode==='create'&&m.state!=='complete'){
      need(e.sources.length===matching.length,'managed-source-conflict');
      if(initialized)need(e.sources.length===0&&!e.captureEnabled,'managed-migration-conflict');
    }
    return {state:e.captureEnabled?'on':'off',observedAt:new Date().toISOString()};
  }finally{store.close();}
}
function freshReview(s:ManagedFreshInspectionSession,observed:ManagedCaptureObservation):ManagedFreshReview {
  const j=s.candidate!,m=j.migration,f=m.fresh;
  const expected=digest(canonical({nonce:s.nonce,planKind:'fresh',targetDigest:managedTargetDigest(j),planDigest:m.consent.planDigest,
    selection:s.selection,record:s.record,operation:s.operation??null,capture:observed.state}));
  return {expected,planKind:'fresh',targets:{...s.roots,storeRoot:s.storeRoot},storeId:j.storeId,sourceId:j.source.id,
    storeMode:f.storeMode,sourceMode:f.sourceMode,capturePolicy:f.capturePolicy,packageVersion:m.expectation.version,capture:observed,plan:structuredClone(m.plan)};
}
export function validateManagedFreshInspectionReview(env:NodeJS.ProcessEnv,payload:Payload,s:ManagedFreshInspectionSession) {
  need(s.family===2&&s.stage===MANAGED_FRESH_INSPECTION_STEPS.length&&s.review&&s.candidate,'managed-inspection-expired');
  batch(freshPaths(s));freshDiscovery(env,s);
  const j=s.candidate;
  need(canonical(j.migration.expectation)===canonical(expectation(j,payload)));
  if(s.operation)need(canonical(readManagedFreshStepJournal(env))===canonical(s.operation));
  const observed=observeManagedFreshStore(j),review=freshReview(s,observed);
  need(review.expected===s.review.expected);
  return {candidate:structuredClone(j),operation:s.operation&&structuredClone(s.operation),capture:observed,review};
}

/** Fresh pages share the existing inspection owner, private cursor transport and
 * review nonce rules. No filesystem/DB/source/binding write occurs here. */
export function inspectManagedFreshStep(env:NodeJS.ProcessEnv,payload:Payload,prior?:ManagedFreshInspectionSession,storeRoot?:string):ManagedFreshInspectionResult {
  let s:ManagedFreshInspectionSession;
  if(!prior){
    const roots=managedSourceRoots(env),selected=storeRoot??managedDefaultStoreRoot(roots.dataRoot);
    batch([...basePaths(roots),selected]);const target=managedPath(selected,true);
    need(![roots.configRoot,roots.dataRoot,path.join(roots.dataRoot,'agent-progress-managed')].includes(target),'managed-selection-conflict');
    for(const root of Object.values(roots))need(lstatSync(root).isDirectory()&&isOwned(root),'path-unverified');
    s={family:2,nonce:randomUUID(),cursor:randomUUID(),stage:1,roots,storeRoot:target,...(storeRoot!==undefined?{explicitStoreRoot:true as const}:{}),selection:claim(container(env)),record:claim(migrationFile(env))};
    return {session:s,progress:null,inspection:{state:'incomplete',stage:'roots',cursor:s.cursor}};
  }
  s=structuredClone(prior);need(s.family===2&&s.stage>0&&s.stage<MANAGED_FRESH_INSPECTION_STEPS.length,'managed-inspection-expired');
  const stage=MANAGED_FRESH_INSPECTION_STEPS[s.stage]!;batch(freshPaths(s));
  // Existing operations may have published a selector since the initial review;
  // this inspection freezes the CURRENT descriptor/journal claims per session.
  need(canonical(managedSourceRoots(env))===canonical(s.roots));
  need(canonical(claim(container(env)))===canonical(s.selection)&&canonical(claim(migrationFile(env)))===canonical(s.record));
  if(stage==='managed-state'){
    if(s.record.kind==='file'){
      s.operation=readManagedFreshStepJournal(env);need(s.operation,'managed-journal-unsupported');
      if(s.explicitStoreRoot)need(s.storeRoot===path.dirname(s.operation.database),'managed-selection-conflict');
      s.storeRoot=path.dirname(s.operation.database);s.candidate=structuredClone(s.operation);
    }else need(s.selection.kind==='absent','managed-step-conflict');
  }else if(stage==='legacy-discovery')freshDiscovery(env,s);
  else if(stage==='store'){
    if(!s.operation){
      const database=path.join(s.storeRoot,'progress.sqlite'),directory=managedFreshObjectClaim(s.storeRoot,true),db=managedFreshObjectClaim(database);
      const sidecars=['-journal','-wal','-shm'].map(x=>managedFreshObjectClaim(database+x));
      let storeId:string=randomUUID(),source:Binding['source']={id:randomUUID(),...s.roots,verified:true},sourceMode:'create'|'reuse'='create',captureState:'unknown'|'on'|'off'='unknown';
      if(db.kind==='absent'){
        need(sidecars.every(c=>c.kind==='absent'),'managed-migration-conflict');
        if(directory.kind==='directory')need(readdirSync(s.storeRoot).length===0,'foreign-files');
        else need(lstatSync(path.dirname(s.storeRoot),{throwIfNoEntry:false})?.isDirectory(),'managed-path-unverified');
      }else{
        const store=new Store(database,{readOnly:true});try{
          store.subagentRunStorage();const e=store.list({limit:1});storeId=e.storeId;captureState=e.captureEnabled?'on':'off';
          const matches=e.sources.filter(x=>x.configRoot===s.roots.configRoot&&x.dataRoot===s.roots.dataRoot);
          need(matches.length<=1&&matches.every(x=>x.verified),'managed-source-conflict');
          if(matches[0]){source={...matches[0]};sourceMode='reuse';}
          need(!e.sources.some(x=>x.id===source.id&&canonical(x)!==canonical(source)),'managed-source-conflict');
        }finally{store.close();}
      }
      const storeMode=db.kind==='absent'?'create':'retain',plan=managedFreshPlan(storeMode,directory.kind==='absent',sourceMode);
      const binding:Binding={protocolVersion:2,schemaVersion:2,installId:`managed-${digest(JSON.stringify([storeId,source]))}`,version:payload.version,database,storeId,source};
      s.candidate={...binding,migration:{format:3,planKind:'fresh',product:'openchamber-agent-progress-managed',phase:'pending',
        operationId:s.nonce,sequence:1,state:'pending',step:plan[1]!,lastCompleted:plan[0]!,
        consent:{reviewDigest:'0'.repeat(64),targetDigest:'0'.repeat(64),planDigest:digest(canonical(plan))},expectation:expectation(binding,payload),plan,
        fresh:{storeMode,sourceMode,capturePolicy:storeMode==='create'?'enable-new':'preserve',directory,database:db,sidecars,
          source:sourceMode==='reuse'?source:null,capture:captureState,selection:s.selection,journal:s.record,
          legacy:{path:path.join(s.roots.configRoot,'plugins','agent-progress'),kind:'absent',object:null,digest:null}},
        created:{directory:null,database:null},intent:null,receipt:null,captureRenewals:[],capture:{state:'unknown',observedAt:null},diagnostic:null}};
      s.candidate.migration.consent.targetDigest=managedTargetDigest(s.candidate);
    }
    observeManagedFreshStore(s.candidate!);
  }else if(stage==='review'){
    need(s.candidate,'managed-inspection-expired');freshDiscovery(env,s);
    need(canonical(s.candidate.migration.expectation)===canonical(expectation(s.candidate,payload)));
    const observed=observeManagedFreshStore(s.candidate);s.review=freshReview(s,observed);s.stage++;s.cursor=randomUUID();
    return {session:s,inspection:{state:'complete',stage:'review',cursor:null,review:s.review},
      progress:s.operation?managedFreshJournalProgress(s.operation,observed):null};
  }
  s.stage++;s.cursor=randomUUID();
  return {session:s,inspection:{state:'incomplete',stage,cursor:s.cursor},progress:s.operation?managedFreshJournalProgress(s.operation):null};
}
