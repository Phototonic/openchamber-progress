import {lstatSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {readBinding,type Binding,verifyStore} from '../shared/binding.ts';
import {managedBindingFile,managedSourceRoots,managedPath,publishPrivateJson,ManagedBindingError} from '../shared/managed-binding.ts';
import {privatePaths,platformSecurityScope,isOwned,PlatformError} from '../shared/platform.ts';
import {Store,canonical,storageError,digest} from '../shared/store.ts';
import {ProgressError} from '../shared/progress.ts';
import {SetupError,migrationBinding,type Targets} from './lifecycle.ts';
import type {ManagedPathClaim} from './managed-step-journal.ts';

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
