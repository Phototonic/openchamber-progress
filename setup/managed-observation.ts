import {lstatSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {readManagedBinding,managedBindingFile,ManagedBindingError,managedSourceRoots,managedExpectationFile,readManagedExpectation} from '../shared/managed-binding.ts';
import {Store,canonical,digest} from '../shared/store.ts';
import {verifyStore,type Binding} from '../shared/binding.ts';
import {platformSecurityScope,requirePlatformWriteBoundary,requirePlatformStoreFence,windows,windowsPaths} from '../shared/platform.ts';
import type {SetupRead} from '../shared/progress.ts';
import {MANAGED_STEP_LIMITS} from '../shared/managed-steps.ts';
import {readManagedStepJournal,readMigration,migrationFile} from './managed-migration.ts';
import {managedJournalBinding,managedJournalProgress,type ManagedStepJournal} from './managed-step-journal.ts';
import {SetupError} from './lifecycle.ts';
import {managedDiagnostic} from './managed-diagnostic.ts';

/** Bounded discovery observation, not a legacy ownership review or admission.
 * Never creates an expectation, opens a writable Store, or scans releases. */
function selected(env:NodeJS.ProcessEnv,expectedDescriptor?:string|null) {
  const binding=readManagedBinding(env),descriptor=binding?digest(readFileSync(managedBindingFile(env))):null;
  if(expectedDescriptor&&descriptor!==expectedDescriptor)throw new ManagedBindingError('managed-binding-modified');
  return {binding,descriptor};
}
function selection(env:NodeJS.ProcessEnv,expectedDescriptor?:string|null) {
  const roots=managedSourceRoots(env),root=path.join(roots.dataRoot,'agent-progress-managed');
  if(windows)windowsPaths([root,path.join(root,'.ownership.json'),path.join(root,'progress-binding.json'),path.join(root,'migration.json'),
    path.join(roots.configRoot,'plugins','agent-progress')],true);
  const {binding,descriptor}=selected(env,expectedDescriptor),file=migrationFile(env),stat=lstatSync(file,{throwIfNoEntry:false});
  let journal:ManagedStepJournal|undefined,prior:ReturnType<typeof readMigration>;
  if(stat){
    if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1)throw new SetupError('managed-binding-invalid');
    if(stat.size>MANAGED_STEP_LIMITS.journalBytes)throw new SetupError('managed-step-limit');
    // The directory/marker has been validated by migrationFile. The strict owner
    // reader validates the selected format before anything is projected or used.
    let format:unknown;try{format=JSON.parse(readFileSync(file,'utf8'))?.migration?.format;}catch{throw new SetupError('managed-journal-unsupported');}
    if(format===2)journal=readManagedStepJournal(env);
    else if(format===1)prior=readMigration(env);
    else throw new SetupError('managed-journal-unsupported');
  }
  const retained=journal?managedJournalBinding(journal):prior?.binding;
  if(binding&&retained&&canonical(binding)!==canonical(retained))throw new SetupError('managed-selection-conflict');
  const legacy=!!lstatSync(path.join(roots.configRoot,'plugins','agent-progress'),{throwIfNoEntry:false});
  return {binding,descriptor,journal,prior,legacy};
}
function storePaths(binding:Binding) {
  if(windows)windowsPaths([path.dirname(binding.database),binding.database,...['-journal','-wal','-shm'].map(s=>binding.database+s),managedExpectationFile(binding)],true);
}
export function observeManagedSetup(env:NodeJS.ProcessEnv,expectedDescriptor?:string|null) {
  try{return readSetup(env,expectedDescriptor);}
  catch(error){
    // Setup must still describe an invalid/unavailable selection. This is not
    // admission, and carries no guessed progress/capture or private file data.
    const status:SetupRead={configured:false,verified:false,installed:false,captureEnabled:null,targets:null,version:null,
      activation:'unknown',separateLifecycle:false,historyRetained:true,diagnostics:[managedDiagnostic(error)],
      delivery:{kind:'managed',revision:1,managedMigrationSteps:1,configuration:'invalid',migration:'unavailable',mode:'unknown',observation:'unknown',expectedVersion:null}};
    return {status,descriptor:undefined,journal:undefined,subagentRuns:false};
  }
}
function readSetup(env:NodeJS.ProcessEnv,expectedDescriptor?:string|null) {
  return platformSecurityScope(()=>{
    const {binding:b,descriptor,journal,prior,legacy}=selection(env,expectedDescriptor);
    const retained=b??journal??prior?.binding;
    const base:SetupRead={configured:!!b,verified:false,installed:false,captureEnabled:null,targets:b?{configRoot:b.source.configRoot,dataRoot:b.source.dataRoot,storeRoot:path.dirname(b.database)}:null,
      version:null,activation:'unknown',separateLifecycle:false,historyRetained:true,diagnostics:[],
      delivery:{kind:'managed',revision:1,managedMigrationSteps:1,configuration:b?'configured':'unconfigured',migration:journal?journal.migration.state==='complete'?legacy?'conflict':'complete':'pending':prior?prior.phase==='complete'?legacy?'conflict':'complete':'pending':legacy?'available':'none',
        mode:'unknown',observation:'unknown',expectedVersion:null}};
    if(journal)base.delivery!.migrationProgress=managedJournalProgress(journal);
    if(!retained)return {status:base,descriptor,journal,subagentRuns:false};
    // Selection is independently validated. A refused Store must not erase it
    // or promote partial observations into capture/identity authority.
    const unavailable=structuredClone(base);
    try{
      storePaths(retained);
      const store=new Store(retained.database,{readOnly:true});
      try{
        verifyStore(store,retained);const runs=store.subagentRunStorage();
        base.captureEnabled=store.list({limit:1}).captureEnabled;
        if(journal)base.delivery!.migrationProgress=managedJournalProgress(journal,{state:base.captureEnabled?'on':'off',observedAt:new Date().toISOString()});
        if(b){
          base.verified=b.source.verified;base.reportingIdentity={storeId:b.storeId,sourceId:b.source.id,verified:b.source.verified};
          const expected=readManagedExpectation(b);
          if(expected){base.version=expected.version;base.delivery!.expectedVersion=expected.version;
            const loaded=store.loadedFingerprint(b.source.id,b.installId);base.delivery!.observation=loaded===null?'not-observed':loaded===expected.fingerprint?'matching':'different';}
        }
        return {status:base,descriptor,journal,subagentRuns:!!b&&['current','previous'].includes(runs)};
      }finally{store.close();}
    }catch(error){
      unavailable.diagnostics=[managedDiagnostic(error)];
      return {status:unavailable,descriptor,journal,subagentRuns:false};
    }
  });
}

/** Ordinary capture-off remains available without full legacy ownership. Enable
 * cannot bypass unfinished migration. The supervisor holds the shared writer
 * fence; the fresh read scope ends before changing the capture bit. */
export function controlManagedCapture(env:NodeJS.ProcessEnv,enabled:boolean,expectedDescriptor?:string|null) {
  requirePlatformWriteBoundary();let store:Store|undefined,descriptor:string|null=null;
  try{
    platformSecurityScope(()=>{
      const current=enabled?selection(env,expectedDescriptor):{...selected(env,expectedDescriptor),journal:undefined,prior:undefined,legacy:false};
      const {binding,journal,prior,legacy}=current;descriptor=current.descriptor;
      if(!binding)throw new SetupError('binding');
      requirePlatformStoreFence(binding.database);
      if(!binding.source.verified)throw new SetupError('source-unverified');
      if(enabled&&(legacy||(journal?journal.migration.state!=='complete':prior?prior.phase!=='complete':false)))throw new SetupError('managed-migration-required');
      storePaths(binding);store=new Store(binding.database);verifyStore(store,binding);store.subagentRunStorage();
    });
    requirePlatformWriteBoundary();store!.setEnabled(enabled);
    return {value:{ok:true,captureEnabled:enabled},descriptor};
  }finally{store?.close();}
}
