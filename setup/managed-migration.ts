import {lstatSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {readBinding,type Binding,verifyStore} from '../shared/binding.ts';
import {managedBindingFile,managedSourceRoots,managedPath,publishPrivateJson,ManagedBindingError} from '../shared/managed-binding.ts';
import {privatePaths,platformSecurityScope,isOwned,PlatformError} from '../shared/platform.ts';
import {Store,canonical,storageError} from '../shared/store.ts';
import {ProgressError} from '../shared/progress.ts';
import {SetupError,migrationBinding,type Targets} from './lifecycle.ts';

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
  const prior=readMigration(env);
  if(prior&&(canonical(prior.binding)!==canonical(record.binding)||prior.legacyInstallId!==record.legacyInstallId))throw new SetupError('managed-migration-conflict');
  publishPrivateJson(migrationFile(env),{...record.binding,migration:{format:1,product:'openchamber-agent-progress-managed',phase:record.phase,legacyInstallId:record.legacyInstallId}},!!prior);
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
export function legacyMigration(env:NodeJS.ProcessEnv):{binding:Binding;targets:Targets}|undefined {
  const roots=managedSourceRoots(env),root=path.join(roots.configRoot,'plugins/agent-progress');
  if(!lstatSync(root,{throwIfNoEntry:false}))return;
  try{
    const b=readBinding(path.join(root,'progress-binding.json'));
    const targets={...roots,storeRoot:path.dirname(b.database),confirmed:true};
    return {binding:migrationBinding(targets),targets};
  }catch(e){throw migrationError(e);}
}
/** Removal can finish before the wrapper writes its next phase. Require its durable same-install receipt. */
export function removalRecorded(record:MigrationRecord) {
  const file=path.join(path.dirname(record.binding.database),'installation-history.jsonl');
  managedPath(file);
  const s=lstatSync(file);
  if(!s.isFile()||s.isSymbolicLink()||!privatePaths([path.dirname(file),file]))throw new SetupError('managed-migration-conflict');
  return readFileSync(file,'utf8').trim().split('\n').some(line=>{
    try{const e=JSON.parse(line);return e.action==='remove-capture'&&e.installId===record.legacyInstallId;}catch{return false;}
  });
}
