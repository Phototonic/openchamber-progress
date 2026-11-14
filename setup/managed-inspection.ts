import {lstatSync,readFileSync,readdirSync} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {type Binding,verifyStore} from '../shared/binding.ts';
import {Store,canonical,digest} from '../shared/store.ts';
import {activationFingerprint} from '../shared/activation.ts';
import {managedSourceRoots,managedBindingFile,managedPath,readManagedBinding,managedExpectationFile} from '../shared/managed-binding.ts';
import {windows,windowsPaths,privatePaths,isOwned,platformSecurityScope} from '../shared/platform.ts';
import {MANAGED_INSPECTION_STEPS,MANAGED_STEP_LIMITS,type ManagedInspection,type ManagedCaptureObservation,type ManagedStepProgress} from '../shared/managed-steps.ts';
import type {ManagedReview} from '../shared/progress.ts';
import {SetupError,discoverMigrationPaths,migrationEvidence,validateMigrationRemoval,type Payload} from './lifecycle.ts';
import {migrationFile,readMigration,readManagedStepJournal,readRemovalReceipt,managedJournalPaths,type MigrationRecord} from './managed-migration.ts';
import {managedJournalBinding,managedJournalProgress,managedTargetDigest,type ManagedStepJournal,type ManagedPathClaim} from './managed-step-journal.ts';

/** Private supervisor/worker state. NEVER accept this object from an HTTP body.
 * Paths and hashes are discovery claims only, not reusable security verdicts. */
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
    need(lstatSync(path.join(root,'.ownership.json')).nlink===1,'managed-binding-invalid');
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
  return platformSecurityScope(()=>{
    need(session.stage===MANAGED_INSPECTION_STEPS.length&&session.review&&session.candidate,'managed-inspection-expired');
    batch(paths(session));sameDiscovery(env,session);
    const observed=validateCandidate(session,payload),review=reviewFor(session,observed);
    need(review.expected===session.review.expected);
    return {candidate:structuredClone(session.candidate),prior:session.prior&&structuredClone(session.prior),
      operation:session.operation&&structuredClone(session.operation),capture:observed,review};
  });
}

/** Exactly one read-only stage. The supervisor supplies prior state, never the
 * caller. Every stage gets a new opaque cursor and a fresh security scope. */
export function inspectManagedStep(env:NodeJS.ProcessEnv,payload:Payload,prior?:ManagedInspectionSession,storeRoot?:string):ManagedInspectionResult {
  return platformSecurityScope(()=>{
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
    batch(paths(session));sameDiscovery(env,session);
    const stage=MANAGED_INSPECTION_STEPS[session.stage]!;
    if(stage==='managed-state'){
      const selected=readManagedBinding(env);
      if(selected)session.binding=selected;
      if(session.record.kind!=='absent'){
        const raw=JSON.parse(readFileSync(session.record.path,'utf8'));
        if(raw?.migration?.format===2)session.operation=readManagedStepJournal(env);
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
  });
}
