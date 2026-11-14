import { javascriptLiteral } from '../shared/javascript-literal.ts';
import { randomUUID } from 'node:crypto';
import { existsSync, lstatSync, realpathSync, mkdirSync, readFileSync, readdirSync, writeFileSync, renameSync, rmSync, rmdirSync, appendFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { Store, canonical, digest } from '../shared/store.ts';
import { VERSION, type CompanionUpdateRead } from '../shared/progress.ts';
import { type Binding, readBinding, verifyStore } from '../shared/binding.ts';
import { activationFingerprint } from '../shared/activation.ts';
import { windows, windowsPath, windowsPaths, platformSecurityScope, privatePaths, privateDirectory, isOwned, syncFile, syncDirectory, PlatformError, sameWindowsObject, sameWindowsDirectory, requirePlatformWriteBoundary } from '../shared/platform.ts';
import { MANAGED_STEP_LIMITS, type ManagedCaptureObservation, type ManagedStepRef } from '../shared/managed-steps.ts';
import type {ManagedLegacyEvidence,ManagedPathClaim,ManagedStepJournal} from './managed-step-journal.ts';

export interface Targets { configRoot: string; dataRoot: string; storeRoot: string; confirmed: boolean }
/** Trim directory suffixes only; do not resolve traversal or conceal symlinks. */
export function normalizeTargets(targets:Targets):Targets {
  if(windows)try{return platformSecurityScope(()=>{const [configRoot,dataRoot,storeRoot]=windowsPaths([targets.configRoot,targets.dataRoot,targets.storeRoot,path.join(targets.configRoot,'plugins','agent-progress'),path.join(targets.storeRoot,'payloads')],true);return {...targets,configRoot:configRoot!,dataRoot:dataRoot!,storeRoot:storeRoot!};});}catch(e){throw e instanceof PlatformError?new SetupError(e.code):e;}
  const trim=(value:string)=>{const root=path.parse(value).root;while(value.length>root.length&&value.endsWith(path.sep))value=value.slice(0,-1);return value;};
  return {...targets,configRoot:trim(targets.configRoot),dataRoot:trim(targets.dataRoot),storeRoot:trim(targets.storeRoot)};
}
export interface Payload { plugin: string; guidance: string; removal: string; version: string }
type Manifest = { product:'openchamber-agent-progress'; installId:string; active:string; files:Record<string,string>; releases:Record<string,{version:string;files:Record<string,string>}> };
/** Format-2 retains the original manifest bytes, never a reconstructed manifest.
 * Structural validation is separate from fresh owned-file/removal authority. */
export function migrationOwnership(bytes:string):Manifest {
  const invalid=()=>{throw new SetupError('managed-journal-unsupported');};
  const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
  const exact=(v:Record<string,unknown>,names:string[])=>Object.keys(v).length===names.length&&names.every(n=>Object.hasOwn(v,n));
  const hashes=(v:unknown,names:string[])=>object(v)&&exact(v,names)&&Object.values(v).every(h=>typeof h==='string'&&/^[a-f0-9]{64}$/.test(h));
  let m:unknown;try{m=JSON.parse(bytes);}catch{return invalid();}
  if(!object(m)||!exact(m,['product','installId','active','files','releases'])||m.product!=='openchamber-agent-progress'||
    typeof m.installId!=='string'||!m.installId||m.installId.length>256||m.installId.includes('\0')||
    typeof m.active!=='string'||!/^[a-f0-9]{64}$/.test(m.active)||!object(m.releases)||!Object.hasOwn(m.releases,m.active)||
    !hashes(m.files,['SKILL.md','index.js','package.json','progress-binding.json','remove.js']))return invalid();
  for(const [id,r] of Object.entries(m.releases)){
    if(!/^[a-f0-9]{64}$/.test(id)||!object(r)||!exact(r,['version','files'])||typeof r.version!=='string'||
      !/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i.test(r.version)||!hashes(r.files,['SKILL.md','index.js','progress-binding.json']))return invalid();
  }
  return m as unknown as Manifest;
}
export class SetupError extends Error { readonly code: string; constructor(code:string) {super(code);this.code=code;} }
function need(v:unknown,code:string):asserts v {if(!v)throw new SetupError(code);}
function safe(p:string, allowMissing=false) {
  if(windows){try{windowsPath(p,allowMissing);return;}catch(e){throw e instanceof PlatformError?new SetupError(e.code):e;}}
  need(path.isAbsolute(p) && path.resolve(p) === p,'path-unverified');
  let current=p; while(!existsSync(current)) {need(allowMissing,'path-unverified');const parent=path.dirname(current);need(parent!==current,'path-unverified');current=parent;}
  need(realpathSync(current)===current && !lstatSync(current).isSymbolicLink(),'symlink-escape');
}
function fsyncDir(dir:string) {syncDirectory(dir);}
function atomic(file:string, content:string, stagingRoot:string) {
  if(windows)stagingRoot=path.dirname(file);
  const tmp=path.join(stagingRoot,`.agent-progress-activation-${randomUUID()}`);
  try{writeFileSync(tmp,content,{mode:0o600,flag:'wx'});syncFile(tmp);renameSync(tmp,file);fsyncDir(path.dirname(file));}
  finally{if(existsSync(tmp))rmSync(tmp);}
}
function writeFiles(root:string, files:Record<string,string>) {
  privateDirectory(root);
  for(const [name,body]of Object.entries(files)){need(/^[A-Za-z0-9_.-]+$/.test(name),'payload-invalid');writeFileSync(path.join(root,name),body,{mode:0o600,flag:'wx'});syncFile(path.join(root,name));}
  fsyncDir(root);
}
function hashes(files:Record<string,string>){return Object.fromEntries(Object.entries(files).map(([name,body])=>[name,digest(body)]));}
/** Shared by advisory inspection and the fully revalidated mutation path. */
function releasePayload(binding:Binding,payload:Payload) {
  const files={'index.js':payload.plugin,'SKILL.md':payload.guidance,'progress-binding.json':JSON.stringify({...binding,version:payload.version})};
  const releaseHash=hashes(files);
  return {files,releaseHash,release:digest(canonical(releaseHash))};
}
function versionParts(version:string) {
  const match=/^(\d+)\.(\d+)\.(\d+)(?:-([a-z0-9.-]+))?$/i.exec(version);
  return match?{core:match.slice(1,4).map(BigInt),pre:match[4]?.split('.')}:undefined;
}
function compareVersions(a:string,b:string):number|undefined {
  const left=versionParts(a),right=versionParts(b);if(!left||!right)return undefined;
  for(let i=0;i<3;i++)if(left.core[i]!==right.core[i])return left.core[i]! > right.core[i]! ? 1 : -1;
  if(!left.pre||!right.pre)return left.pre? -1:right.pre?1:0;
  for(let i=0;i<Math.max(left.pre.length,right.pre.length);i++){
    const x=left.pre[i],y=right.pre[i];if(x===y)continue;if(x===undefined)return -1;if(y===undefined)return 1;
    const xn=/^\d+$/.test(x),yn=/^\d+$/.test(y);
    if(xn&&yn){if(BigInt(x)!==BigInt(y))return BigInt(x)>BigInt(y)?1:-1;continue;}
    if(xn!==yn)return xn?-1:1;return x>y?1:-1;
  }
  return 0;
}
function updatePreview(o:ReturnType<typeof owned>,payload:Payload):CompanionUpdateRead|undefined {
  const comparison=compareVersions(payload.version,o.manifest.releases[o.manifest.active]!.version);
  if(comparison===undefined||!payload.plugin||!payload.guidance)return undefined;
  const rootPackage=JSON.parse(readFileSync(path.join(o.root,'package.json'),'utf8'));
  return {state:releasePayload(o.binding,payload).release===o.manifest.active?'current':comparison<0?'newer-installed':'available',candidateVersion:payload.version,rootVersion:typeof rootPackage.version==='string'?rootPackage.version:null};
}
function verifyFiles(root:string, expected:Record<string,string>, extras:string[]=[]){
  if(!windows)safe(root);need(lstatSync(root).isDirectory(),'collision');
  need(readdirSync(root).every(name=>Object.hasOwn(expected,name)||extras.includes(name)),'foreign-files');
  const files=Object.keys(expected).map(name=>path.join(root,name));
  if(windows){const extraFiles=extras.map(name=>path.join(root,name)).filter(existsSync),all=[root,...files,...extraFiles];need(windowsPaths(all).every((v,i)=>sameWindowsObject(v,all[i]!))&&privatePaths(all)&&extraFiles.every(p=>lstatSync(p).isFile()),'modified-owned-files');}
  for(const [name,hash]of Object.entries(expected)){const file=path.join(root,name);need(existsSync(file),'modified-owned-files');if(!windows)safe(file);const st=lstatSync(file);need(st.isFile()&&(windows||st.uid===process.getuid?.()&&(st.mode&0o777)===0o600)&&digest(readFileSync(file))===hash,'modified-owned-files');}
}
export function inspect(targets:Targets) {
  return platformSecurityScope(()=>inspectInner(targets));
}
function inspectInner(targets:Targets) {
  targets=normalizeTargets(targets);
  safe(targets.configRoot);safe(targets.dataRoot);safe(targets.storeRoot,true);
  for(const root of [targets.configRoot,targets.dataRoot])need(lstatSync(root).isDirectory()&&isOwned(root),'path-unverified');
  const packageRoot=path.join(targets.configRoot,'plugins','agent-progress');safe(packageRoot,true);
  if(existsSync(targets.storeRoot))need(lstatSync(targets.storeRoot).isDirectory()&&(windows?privatePaths([targets.storeRoot]):(lstatSync(targets.storeRoot).mode&0o777)===0o700),'store-permissions');
  const payloadRoot=path.join(targets.storeRoot,'payloads');safe(payloadRoot,true);if(windows&&existsSync(payloadRoot))need(privatePaths([payloadRoot]),'store-permissions');
  if(windows){const historyFile=path.join(targets.storeRoot,'installation-history.jsonl');safe(historyFile,true);if(existsSync(historyFile))need(lstatSync(historyFile).isFile()&&privatePaths([historyFile]),'store-permissions');}
  return {targets,packageRoot,verified:targets.confirmed,installed:existsSync(packageRoot),version:null as string|null,fingerprint:null as string|null,diagnostics:[] as string[],activation:'unknown' as const,separateLifecycle:true,historyRetained:true,
    recovery:{stagedPackages:readdirSync(windows&&existsSync(path.dirname(packageRoot))?path.dirname(packageRoot):targets.configRoot).filter(n=>n.startsWith('.agent-progress-stage-')).length,stagedActivations:readdirSync(windows&&existsSync(packageRoot)?packageRoot:targets.configRoot).filter(n=>n.startsWith('.agent-progress-activation-')).length,stagedReleases:existsSync(payloadRoot)?readdirSync(payloadRoot).filter(n=>n.startsWith('.staged-')).length:0}};
}
function owned(targets:Targets): {root:string;manifest:Manifest;binding:Binding;staged:string[]} {
  const info=inspect(targets);need(info.installed,'not-installed');
  const manifestFile=path.join(info.packageRoot,'.ownership.json');need(existsSync(manifestFile),'collision');safe(manifestFile);
  if(windows)need(privatePaths([info.packageRoot,manifestFile]),'ownership-invalid');
  let m:Manifest;try{m=JSON.parse(readFileSync(manifestFile,'utf8'));}catch{throw new SetupError('ownership-invalid');}
  need(m.product==='openchamber-agent-progress'&&typeof m.installId==='string'&&/^[a-f0-9]{64}$/.test(m.active)&&m.releases?.[m.active],'collision');
  need(Object.keys(m.files).sort().join(',')==='SKILL.md,index.js,package.json,progress-binding.json,remove.js','ownership-invalid');
  const staged=windows?readdirSync(info.packageRoot).filter(n=>/^\.agent-progress-activation-[a-f0-9-]{36}$/.test(n)):[];
  verifyFiles(info.packageRoot,m.files,['.ownership.json',...staged]);
  const b=readBinding(path.join(info.packageRoot,'progress-binding.json'));
  need(b.installId===m.installId&&(windows?sameWindowsDirectory(b.source.configRoot,targets.configRoot)&&sameWindowsDirectory(b.source.dataRoot,targets.dataRoot)&&sameWindowsDirectory(path.dirname(b.database),targets.storeRoot):b.source.configRoot===targets.configRoot&&b.source.dataRoot===targets.dataRoot&&path.dirname(b.database)===targets.storeRoot),'ownership-invalid');
  for(const [id,release]of Object.entries(m.releases)){
    need(/^[a-f0-9]{64}$/.test(id)&&Object.keys(release.files).sort().join(',')==='SKILL.md,index.js,progress-binding.json','ownership-invalid');
    verifyFiles(path.join(targets.storeRoot,'payloads',id),release.files);
  }
  return {root:info.packageRoot,manifest:m,binding:b,staged};
}
/** Remove only complete same-install selector staging; partial/foreign bytes refuse
 * before any selected payload is removed. Immutable releases remain untouched. */
function removableSelectors(o:ReturnType<typeof owned>) {
  return o.staged.map(name=>{
    const file=path.join(o.root,name);let m:Manifest;
    try{m=JSON.parse(readFileSync(file,'utf8'));}catch{throw new SetupError('staged-activation-retained');}
    need(m.product===o.manifest.product&&m.installId===o.manifest.installId&&canonical(m.files)===canonical(o.manifest.files)&&/^[a-f0-9]{64}$/.test(m.active)&&m.releases?.[m.active]&&Object.entries(o.manifest.releases).every(([id,r])=>canonical(m.releases[id])===canonical(r)),'staged-activation-retained');
    return file;
  });
}
/** Migration preflight repeats every removal check BEFORE its disable-first path. */
export function migrationBinding(targets:Targets) {
  return platformSecurityScope(()=>{
    const o=owned(targets);removableSelectors(o);
    need(o.binding.source.verified&&privatePaths([o.root,path.join(o.root,'.ownership.json')]),'ownership-invalid');
    const store=new Store(o.binding.database,{readOnly:true});
    try{verifyStore(store,o.binding);store.subagentRunStorage();}finally{store.close();}
    const active=path.join(targets.storeRoot,'payloads',o.manifest.active);
    return {binding:o.binding,
      fingerprint:activationFingerprint(readBinding(path.join(active,'progress-binding.json')),readFileSync(path.join(active,'index.js')),readFileSync(path.join(active,'SKILL.md'))),
      ownership:digest(readFileSync(path.join(o.root,'.ownership.json')))};
  });
}

function migrationObject(file:string) {
  const s=lstatSync(file,{bigint:true});
  return {device:String(s.dev),inode:String(s.ino),birthNs:String(s.birthtimeNs)};
}
function migrationSnapshot(file:string) {
  const s=lstatSync(file,{bigint:true});
  return [s.dev,s.ino,s.birthtimeNs,s.size,s.mtimeNs,s.ctimeNs,s.mode,s.nlink].join(':');
}
/** Fresh native claims, not reusable validation. Used only after owned() has
 * validated the original complete installation and its retained releases. */
function migrationClaim(file:string):ManagedPathClaim {
  const s=lstatSync(file),before=migrationSnapshot(file);
  need(!s.isSymbolicLink()&&(s.isDirectory()||s.isFile()&&s.nlink===1),'ownership-invalid');
  const claim:ManagedPathClaim={path:file,kind:s.isDirectory()?'directory':'file',object:migrationObject(file),digest:s.isFile()?digest(readFileSync(file)):null};
  need(before===migrationSnapshot(file),'installation-changed');return claim;
}
function migrationOwnedPaths(targets:Targets,m:Manifest,selectors:string[]) {
  const root=path.join(targets.configRoot,'plugins','agent-progress'),payload=path.join(targets.storeRoot,'payloads');
  return [...new Set([targets.configRoot,targets.dataRoot,targets.storeRoot,root,payload,
    ...Object.keys(m.files).sort().map(name=>path.join(root,name)),path.join(root,'.ownership.json'),...selectors,
    ...Object.entries(m.releases).sort(([a],[b])=>a.localeCompare(b)).flatMap(([id,r])=>[
      path.join(payload,id),...Object.keys(r.files).sort().map(name=>path.join(payload,id,name))])])];
}
/** Full read-only discovery owner for a known target. Inspection may stage its
 * path discovery separately; callers must charge all queries to that request. */
export function migrationEvidence(targets:Targets):{binding:Binding;legacy:Extract<ManagedLegacyEvidence,{kind:'manifest'}>;plan:ManagedStepRef[]} {
  return platformSecurityScope(()=>{
    const o=owned(targets),selectors=removableSelectors(o).sort(),ownership=readFileSync(path.join(o.root,'.ownership.json'),'utf8');
    const m=migrationOwnership(ownership),paths=migrationOwnedPaths(targets,m,selectors);
    if(paths.length>MANAGED_STEP_LIMITS.claimPaths||Buffer.byteLength(ownership)>MANAGED_STEP_LIMITS.journalBytes)throw new SetupError('managed-step-limit');
    need(canonical(m)===canonical(o.manifest)&&o.binding.source.verified&&privatePaths([o.root,path.join(o.root,'.ownership.json')]),'ownership-invalid');
    const store=new Store(o.binding.database,{readOnly:true});
    try{verifyStore(store,o.binding);store.subagentRunStorage();}finally{store.close();}
    return {binding:o.binding,legacy:{kind:'manifest',ownership,ownershipDigest:digest(ownership),claims:paths.map(migrationClaim)},
      plan:migrationRemovalPlan(selectors.length)};
  });
}
function migrationRemovalPlan(selectors:number):ManagedStepRef[] {
  return [{name:'prepare',batch:0},{name:'expectation',batch:0},{name:'disable',batch:0},
    ...Array.from({length:selectors},(_,batch)=>({name:'remove-selector' as const,batch})),
    ...Array.from({length:6},(_,batch)=>({name:'remove-discovery' as const,batch})),
    {name:'record-removal',batch:0},{name:'publish-binding',batch:0},{name:'enable',batch:0},{name:'reconcile',batch:0}];
}
function removalLayout(journal:ManagedStepJournal) {
  const m=journal.migration;need(m.legacy.kind==='manifest','managed-migration-conflict');
  const targets={configRoot:journal.source.configRoot,dataRoot:journal.source.dataRoot,storeRoot:path.dirname(journal.database),confirmed:true};
  const root=path.join(targets.configRoot,'plugins','agent-progress'),manifest=migrationOwnership(m.legacy.ownership);
  need(manifest.installId===m.legacyInstallId&&digest(m.legacy.ownership)===m.legacy.ownershipDigest,'managed-migration-conflict');
  const selectors=m.legacy.claims.filter(c=>path.dirname(c.path)===root&&/^\.agent-progress-activation-[a-f0-9-]{36}$/.test(path.basename(c.path))).map(c=>c.path).sort();
  need(windows||selectors.length===0,'staged-activation-retained');
  const discovery=[...Object.keys(manifest.files).sort().map(name=>path.join(root,name)),path.join(root,'.ownership.json')];
  const paths=migrationOwnedPaths(targets,manifest,selectors),claims=new Map(m.legacy.claims.map(c=>[c.path,c]));
  need(claims.size===m.legacy.claims.length&&canonical(paths)===canonical(m.legacy.claims.map(c=>c.path))&&
    canonical(m.plan)===canonical(migrationRemovalPlan(selectors.length)),'managed-migration-conflict');
  if(paths.length>MANAGED_STEP_LIMITS.claimPaths)throw new SetupError('managed-step-limit');
  const file=(step:ManagedStepRef|null)=>step?.name==='remove-selector'?selectors[step.batch]:step?.name==='remove-discovery'?discovery[step.batch]:undefined;
  const completed=m.plan.findIndex(s=>canonical(s)===canonical(m.lastCompleted));
  need(completed>=0&&canonical(m.step)===canonical(m.plan[completed+1]??null),'managed-step-conflict');
  const removed=new Set(m.plan.slice(0,completed+1).map(file).filter((p):p is string=>!!p));
  const intentFor=(p:string)=>!!m.intent&&canonical(m.intent.step)===canonical(m.step)&&
    m.intent.before.some(c=>c.path===p&&canonical(c)===canonical(claims.get(p)))&&
    m.intent.after.some(c=>c.path===p&&c.kind==='absent'&&c.object===null&&c.digest===null);
  return {targets,root,manifest,selectors,discovery,paths,claims,file,completed,removed,intentFor};
}
/** Full fresh remaining-set validation. Missing files are recognized only from
 * this operation's ordered completion or its exact before/after removal intent.
 * The journal itself grants no ACL/object/Store authority. */
export function validateMigrationRemoval(journal:ManagedStepJournal) {
  return platformSecurityScope(()=>{
    const layout=removalLayout(journal),{targets,root,manifest,selectors,claims,removed,completed}=layout,m=journal.migration;
    const database=journal.database,historyFile=path.join(targets.storeRoot,'installation-history.jsonl');
    const extra=[database,...['-journal','-wal','-shm'].map(s=>database+s),historyFile];
    // All paths come from the structurally checked frozen manifest/claims or
    // fixed Store names. Include ancestors in one new batch; no cached verdict
    // survives the caller's next mutation boundary.
    if(windows)windowsPaths([...layout.paths,...extra],true);
    const rootRemoved=completed>=m.plan.findIndex(s=>s.name==='record-removal');
    const rootMayBeMissing=rootRemoved||m.step?.name==='record-removal'&&layout.intentFor(root);
    for(const claim of claims.values()){
      const s=lstatSync(claim.path,{throwIfNoEntry:false});
      const missingAllowed=removed.has(claim.path)||claim.path===layout.file(m.step)&&layout.intentFor(claim.path)||claim.path===root&&rootMayBeMissing;
      if(!s){need(missingAllowed,'modified-owned-files');continue;}
      need(!removed.has(claim.path)&&!(claim.path===root&&rootRemoved),'installation-changed');
      safe(claim.path);need(canonical(migrationObject(claim.path))===canonical(claim.object),'installation-changed');
      const publicRoot=claim.path===targets.configRoot||claim.path===targets.dataRoot;
      need(!s.isSymbolicLink()&&(claim.kind==='directory'?s.isDirectory():claim.kind==='file'&&s.isFile()&&s.nlink===1)&&
        (publicRoot?isOwned(claim.path):privatePaths([claim.path])),'ownership-invalid');
      if(claim.kind==='file'){
        const before=migrationSnapshot(claim.path);need(digest(readFileSync(claim.path))===claim.digest&&before===migrationSnapshot(claim.path),'modified-owned-files');
      }
    }
    // Saved claims cannot substitute arbitrary hashes for the original owner
    // manifest, even if the current bytes happen to match those altered claims.
    for(const [name,hash]of Object.entries(manifest.files))need(claims.get(path.join(root,name))?.digest===hash,'ownership-invalid');
    need(claims.get(path.join(root,'.ownership.json'))?.digest===m.legacy.ownershipDigest,'ownership-invalid');
    for(const [id,release]of Object.entries(manifest.releases)){
      const releaseRoot=path.join(targets.storeRoot,'payloads',id);
      need(canonical(readdirSync(releaseRoot).sort())===canonical(Object.keys(release.files).sort()),'foreign-files');
      for(const [name,hash]of Object.entries(release.files))need(claims.get(path.join(releaseRoot,name))?.digest===hash,'ownership-invalid');
    }
    if(lstatSync(root,{throwIfNoEntry:false})){
      const allowed=new Set([...layout.discovery,...selectors].filter(p=>!removed.has(p)&&lstatSync(p,{throwIfNoEntry:false})).map(p=>path.basename(p)));
      need(readdirSync(root).every(name=>allowed.has(name)),'foreign-files');
    }
    const binding=readBinding(path.join(targets.storeRoot,'payloads',manifest.active,'progress-binding.json'));
    need(binding.installId===m.legacyInstallId&&binding.database===database&&binding.storeId===journal.storeId&&canonical(binding.source)===canonical(journal.source),'ownership-invalid');
    removableSelectors({root,manifest,binding,staged:selectors.filter(p=>lstatSync(p,{throwIfNoEntry:false})).map(p=>path.basename(p))});
    for(const p of extra){
      const s=lstatSync(p,{throwIfNoEntry:false});if(!s)continue;
      safe(p);need(s.isFile()&&!s.isSymbolicLink()&&s.nlink===1&&privatePaths([p]),'store-permissions');
    }
    const store=new Store(database,{readOnly:true});let enabled:boolean;
    try{verifyStore(store,binding);store.subagentRunStorage();enabled=store.list({limit:1}).captureEnabled;}finally{store.close();}
    const capture:ManagedCaptureObservation={state:enabled?'on':'off',observedAt:new Date().toISOString()};
    return {...layout,capture};
  });
}
/** One lifecycle-owned file effect only. Callers persist its exact intent first
 * under the shared writer fence. Missing current files reconcile; they never
 * authorize deletion of a new object at that path. No Store flag is changed. */
export function removeMigrationFile(journal:ManagedStepJournal):{removed:boolean;capture:ManagedCaptureObservation} {
  requirePlatformWriteBoundary();
  const m=journal.migration;need(m.state==='running'&&m.intent!==null&&['remove-selector','remove-discovery'].includes(m.step?.name??''),'managed-step-conflict');
  const before=validateMigrationRemoval(journal),file=before.file(m.step);
  need(file&&before.intentFor(file)&&before.completed>=2&&before.capture.state==='off','managed-step-conflict');
  if(!lstatSync(file,{throwIfNoEntry:false}))return {removed:false,capture:before.capture};
  requirePlatformWriteBoundary();unlinkSync(file);syncDirectory(path.dirname(file));
  need(!lstatSync(file,{throwIfNoEntry:false}),'managed-step-unsettled');
  // Completion publication must freshly validate the remaining complete set.
  // Do not add a redundant post-effect scan or carry admission's capture bit
  // forward as if it had just been observed after a mutation.
  return {removed:true,capture:{state:'unknown',observedAt:null}};
}

function removalHistory(journal:ManagedStepJournal) {
  const file=path.join(path.dirname(journal.database),'installation-history.jsonl');
  safe(file);const stat=lstatSync(file);
  need(stat.isFile()&&!stat.isSymbolicLink()&&stat.nlink===1&&privatePaths([path.dirname(file),file]),'store-permissions');
  if(stat.size>MANAGED_STEP_LIMITS.journalBytes)throw new SetupError('managed-step-limit');
  const before=migrationSnapshot(file),bytes=readFileSync(file);
  need(before===migrationSnapshot(file),'installation-changed');
  let text:string;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw new SetupError('managed-migration-conflict');}
  // Never append onto an interrupted/ambiguous history line or repair it.
  need(text.length===0||text.endsWith('\n'),'managed-migration-conflict');
  return {file,bytes,text,claim:{path:file,kind:'file' as const,object:migrationObject(file),digest:digest(bytes)}};
}
function removalEvent(journal:ManagedStepJournal,capture:ManagedCaptureObservation) {
  need(capture.state==='off','managed-step-conflict');
  // Frozen intent observation, not retry time. The operation identity makes this
  // exact event distinguishable from an earlier removal of the same install.
  return JSON.stringify({action:'remove-capture',at:capture.observedAt,installId:journal.migration.legacyInstallId,
    operationId:journal.migration.operationId})+'\n';
}
/** Read-only construction of both subeffects' claims. The engine freezes these
 * in the durable intent before directory removal or history append. */
export function migrationRemovalRecordClaims(journal:ManagedStepJournal) {
  return platformSecurityScope(()=>{
    const layout=validateMigrationRemoval(journal),m=journal.migration;
    need(m.step?.name==='record-removal'&&m.intent===null&&layout.capture.state==='off','managed-step-conflict');
    need(readdirSync(layout.root).length===0,'foreign-files');
    const history=removalHistory(journal),event=removalEvent(journal,layout.capture);
    if(history.bytes.length+Buffer.byteLength(event)>MANAGED_STEP_LIMITS.journalBytes)throw new SetupError('managed-step-limit');
    return {before:[layout.claims.get(layout.root)!,history.claim],
      after:[{path:layout.root,kind:'absent' as const,object:null,digest:null},
        {...history.claim,digest:digest(Buffer.concat([history.bytes,Buffer.from(event)]))}],capture:layout.capture};
  });
}
function validateRemovalRecord(journal:ManagedStepJournal) {
  const m=journal.migration,intent=m.intent;
  need(m.state==='running'&&m.step?.name==='record-removal'&&intent&&canonical(intent.step)===canonical(m.step),'managed-step-conflict');
  const layout=validateMigrationRemoval(journal);
  need(layout.intentFor(layout.root)&&layout.capture.state==='off','managed-step-conflict');
  if(lstatSync(layout.root,{throwIfNoEntry:false}))need(readdirSync(layout.root).length===0,'foreign-files');
  const history=removalHistory(journal),event=removalEvent(journal,intent.captureBefore);
  const before=intent.before[1],after=intent.after[1];
  need(intent.before.length===2&&intent.after.length===2&&canonical(intent.before[0])===canonical(layout.claims.get(layout.root))&&
    canonical(intent.after[0])===canonical({path:layout.root,kind:'absent',object:null,digest:null})&&
    before?.path===history.file&&before.kind==='file'&&canonical(before.object)===canonical(history.claim.object)&&
    after?.path===history.file&&after.kind==='file'&&canonical(after.object)===canonical(before.object),'managed-step-conflict');
  // Later appends are permitted only after the exact intent-proven prefix/event
  // in this same file. Neither absence nor a same-install historical event alone
  // is a completion receipt. Partial appends remain an explicit conflict.
  let recorded=false;
  for(let offset=0;offset<history.bytes.length;){
    const end=history.bytes.indexOf(10,offset);need(end>=0,'managed-migration-conflict');
    if(history.bytes.subarray(offset,end+1).equals(Buffer.from(event))){
      need(!recorded&&digest(history.bytes.subarray(0,offset))===before.digest&&
        digest(history.bytes.subarray(0,end+1))===after.digest,'managed-migration-conflict');recorded=true;
    }
    offset=end+1;
  }
  if(!recorded)need(history.claim.digest===before.digest&&
    digest(Buffer.concat([history.bytes,Buffer.from(event)]))===after.digest,'managed-migration-conflict');
  need(!recorded||!lstatSync(layout.root,{throwIfNoEntry:false}),'managed-migration-conflict');
  return {layout,history,event,recorded};
}
/** One reconciled lifecycle unit: empty discovery directory, then exact history
 * event. A fresh scope validates each subeffect; no authority crosses rmdir.
 * validateJournal lets the engine combine durable-intent readback with the first
 * effect batch. It must be read-only and must prebatch any additional paths. */
export function recordMigrationRemoval(journal:ManagedStepJournal,validateJournal?:()=>void):{removed:boolean;recorded:boolean;capture:ManagedCaptureObservation} {
  requirePlatformWriteBoundary();
  let current=platformSecurityScope(()=>{validateJournal?.();return validateRemovalRecord(journal);});
  let removed=false;
  if(lstatSync(current.layout.root,{throwIfNoEntry:false})){
    requirePlatformWriteBoundary();rmdirSync(current.layout.root);syncDirectory(path.dirname(current.layout.root));removed=true;
    // rmdir invalidates the actual security scope. Recheck the retained payloads,
    // roots, Store, capture and history before admitting the second subeffect.
    current=platformSecurityScope(()=>validateRemovalRecord(journal));
  }
  if(!current.recorded){
    requirePlatformWriteBoundary();
    appendFileSync(current.history.file,current.event,{flag:'a',mode:0o600});syncFile(current.history.file);
  }
  // Completion checkpoint validation owns the post-effect read, not a second
  // append or a hidden final scan here. Historical capture is not returned as new.
  return {removed,recorded:!current.recorded,capture:{state:'unknown',observedAt:null}};
}
/** Read-only completion proof, also required inside the journal checkpoint's
 * fresh validation batch. A missing directory without the event is incomplete. */
export function migrationRemovalRecorded(journal:ManagedStepJournal):boolean {
  return platformSecurityScope(()=>validateRemovalRecord(journal).recorded);
}
function history(targets:Targets,event:unknown){const file=path.join(targets.storeRoot,'installation-history.jsonl');safe(file,true);if(windows&&existsSync(file))need(privatePaths([file]),'store-permissions');appendFileSync(file,JSON.stringify(event)+'\n',{mode:0o600});syncFile(file);}
/** Retained sources are candidates, not currently selected target assertions. */
function matchesRetainedSource(source:Binding['source'],targets:Targets) {
  if(!windows)return source.configRoot===targets.configRoot&&source.dataRoot===targets.dataRoot;
  try{return sameWindowsDirectory(source.configRoot,targets.configRoot)&&sameWindowsDirectory(source.dataRoot,targets.dataRoot);}
  catch(e){
    if(e instanceof PlatformError){if(['path-unverified','symlink-escape','unsafe-parent'].includes(e.code))return false;throw e;}
    if(['ENOENT','ENOTDIR','EACCES','EPERM','ELOOP','ENAMETOOLONG'].includes((e as NodeJS.ErrnoException)?.code??''))return false;
    throw e;
  }
}
export type Action='inspect'|'dry-run'|'install'|'update'|'disable'|'enable'|'remove-capture';
export function lifecycle(action:Action,targets:Targets,payload?:Payload, testBoundary?:(name:'release-staged'|'before-activation'|'after-activation')=>void) {
  try{return platformSecurityScope(()=>lifecycleInner(action,targets,payload,testBoundary));}catch(e){throw e instanceof PlatformError?new SetupError(e.code):e;}
}
function lifecycleInner(action:Action,targets:Targets,payload?:Payload, testBoundary?:(name:'release-staged'|'before-activation'|'after-activation')=>void) {
  const info=inspect(targets);
  targets=info.targets;
  if(action==='inspect'||action==='dry-run'){
    const o=info.installed?owned(targets):undefined;
    const payloadRoot=path.join(targets.storeRoot,'payloads');
    const unreferenced=existsSync(payloadRoot)&&readdirSync(payloadRoot).some(id=>{
      if(!/^[a-f0-9]{64}$/.test(id)||o?.manifest.releases[id])return false;
      try{safe(path.join(payloadRoot,id));const b=readBinding(path.join(payloadRoot,id,'progress-binding.json'));return b.source.configRoot===targets.configRoot&&b.source.dataRoot===targets.dataRoot;}
      catch{return !!o;}
    });
    const active=o?path.join(payloadRoot,o.manifest.active):undefined;
    const fingerprint=active?activationFingerprint(readBinding(path.join(active,'progress-binding.json')),readFileSync(path.join(active,'index.js')),readFileSync(path.join(active,'SKILL.md'))):null;
    return {...info,fingerprint,version:o?o.manifest.releases[o.manifest.active].version:null,...(o&&targets.confirmed&&o.binding.source.verified&&payload?{update:updatePreview(o,payload)}:{}),action,writes:false,diagnostics:[...(!targets.confirmed?['targets-unverified']:[]),...(o&&Object.keys(o.manifest.releases).length>1?['rollback-payloads-retained']:[]),...(unreferenced?['unreferenced-payloads-retained']:[]),...(info.recovery.stagedPackages||info.recovery.stagedActivations||info.recovery.stagedReleases?['staged-payloads-present']:[])]};
  }
  need(targets.confirmed,'confirmation-required');
  if(action==='disable'||action==='enable'||action==='remove-capture'){
    const file=path.join(targets.storeRoot,'progress.sqlite');need(existsSync(file),'not-installed');
    const store=new Store(file);
    try{
      if(action==='remove-capture'){
        // Deliberately disable BEFORE validation; modified payload stays untouched.
        const controlBinding=readBinding(path.join(info.packageRoot,'progress-binding.json'));
        need(windows?sameWindowsObject(controlBinding.database,file)&&sameWindowsDirectory(controlBinding.source.configRoot,targets.configRoot)&&sameWindowsDirectory(controlBinding.source.dataRoot,targets.dataRoot):controlBinding.database===file&&controlBinding.source.configRoot===targets.configRoot&&controlBinding.source.dataRoot===targets.dataRoot,'ownership-invalid');verifyStore(store,controlBinding);
        store.setEnabled(false);
        const o=owned(targets);verifyStore(store,o.binding);
        const selectors=removableSelectors(o);
        for(const file of selectors)rmSync(file);
        for(const name of Object.keys(o.manifest.files))rmSync(path.join(o.root,name));
        rmSync(path.join(o.root,'.ownership.json'));rmdirSync(o.root);fsyncDir(path.dirname(o.root));
        // Immutable acknowledged releases and installation history are retained,
        // never indiscriminately pruned with store data.
        history(targets,{action,at:new Date().toISOString(),installId:o.manifest.installId});
      }else{const o=owned(targets);verifyStore(store,o.binding);store.setEnabled(action==='enable');history(targets,{action,at:new Date().toISOString(),installId:o.manifest.installId});}
      return {...info,action,writes:true,captureEnabled:action==='enable',activation:action==='remove-capture'?'removed-reload-may-be-required':'control-applies-to-loaded-instances',historyRetained:true};
    }finally{store.close();}
  }
  need(action==='install'||action==='update','action-invalid');
  need(payload && typeof payload.plugin==='string'&&payload.plugin.length>0&&payload.guidance.length>0&&payload.removal.length>0&&/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i.test(payload.version),'payload-invalid');
  need(action==='update'?info.installed:!info.installed,action==='update'?'not-installed':'collision');
  const old=info.installed?owned(targets):undefined;
  // Pre-managed loaders call default.setup, which is now managed-only. Never
  // switch their selector to new bytes and silently strand a working install.
  if(old&&!readFileSync(path.join(old.root,'index.js'),'utf8').includes('plugin.setupLegacy?'))
    throw new SetupError('legacy-update-requires-managed-migration');
  if(!existsSync(targets.storeRoot))privateDirectory(targets.storeRoot,true);
  const store=new Store(path.join(targets.storeRoot,'progress.sqlite'),{create:true});
  let binding:Binding;
  try{
    if(old){binding={...old.binding,version:payload.version};verifyStore(store,binding);}
    else{
      // Reinstallation reuses the durable same-scope namespace, never process IDs.
      const source=store.list({limit:1}).sources.find(s=>matchesRetainedSource(s,targets))??{id:randomUUID(),configRoot:targets.configRoot,dataRoot:targets.dataRoot,verified:true};
      store.registerSource(source);
      binding={protocolVersion:VERSION,schemaVersion:VERSION,installId:randomUUID(),version:payload.version,database:store.file,storeId:store.list({limit:1}).storeId,source};
    }
  }finally{store.close();}
  const {files,releaseHash,release}=releasePayload(binding,payload);
  const payloadRoot=path.join(targets.storeRoot,'payloads');safe(payloadRoot,true);privateDirectory(payloadRoot,true);
  const releaseRoot=path.join(payloadRoot,release);
  if(existsSync(releaseRoot))verifyFiles(releaseRoot,releaseHash);
  else{const stage=path.join(payloadRoot,`.staged-${randomUUID()}`);writeFiles(stage,files);testBoundary?.('release-staged');renameSync(stage,releaseRoot);fsyncDir(payloadRoot);}
  let manifest:Manifest;
  if(old){manifest={...old.manifest,active:release,releases:{...old.manifest.releases,[release]:{version:payload.version,files:releaseHash}}};}
  else{
    const loader=`import{readFileSync,lstatSync,realpathSync}from'node:fs';import{createHash}from'node:crypto';import{pathToFileURL}from'node:url';import path from'node:path';function same(file){const a=lstatSync(file,{bigint:true}),b=lstatSync(realpathSync(file),{bigint:true});return a.nlink===1n&&a.ino!==0n&&a.dev===b.dev&&a.ino===b.ino;}export default{id:'agent-progress',async setup(ctx){const selector=new URL('./.ownership.json',import.meta.url);if(process.platform==='win32'&&lstatSync(selector,{bigint:true}).nlink>1n)throw new Error('agent-progress-installation-invalid');const m=JSON.parse(readFileSync(selector,'utf8'));if(m.product!=='openchamber-agent-progress'||m.installId!==${javascriptLiteral(binding.installId)}||!/^[a-f0-9]{64}$/.test(m.active)||!m.releases[m.active])throw new Error('agent-progress-installation-invalid');const dir=path.join(${javascriptLiteral(payloadRoot)},m.active);for(const[name,hash]of Object.entries(m.releases[m.active].files)){const file=path.join(dir,name);if(!/^[A-Za-z0-9_.-]+$/.test(name)||(process.platform==='win32'?!same(file):realpathSync(file)!==file)||!lstatSync(file).isFile()||createHash('sha256').update(readFileSync(file)).digest('hex')!==hash)throw new Error('agent-progress-payload-modified');}const plugin=await import(pathToFileURL(path.join(dir,'index.js')).href);return plugin.setupLegacy?plugin.setupLegacy(ctx,path.join(dir,'progress-binding.json')):plugin.default.setup(ctx);}};`;
    const rootFiles={'index.js':loader,'package.json':JSON.stringify({name:'openchamber-agent-progress',version:payload.version,type:'module',exports:{'.':'./index.js'}}),'progress-binding.json':JSON.stringify(binding),'remove.js':payload.removal,'SKILL.md':payload.guidance};
    manifest={product:'openchamber-agent-progress',installId:binding.installId,active:release,files:hashes(rootFiles),releases:{[release]:{version:payload.version,files:releaseHash}}};
    const plugins=path.dirname(info.packageRoot);safe(plugins,true);
    if(windows&&!existsSync(plugins))privateDirectory(plugins,true);
    const stage=path.join(windows?plugins:targets.configRoot,`.agent-progress-stage-${randomUUID()}`);writeFiles(stage,{...rootFiles,'.ownership.json':JSON.stringify(manifest)});
    testBoundary?.('before-activation');
    if(!windows)mkdirSync(plugins,{recursive:true,mode:0o700});
    need(!existsSync(info.packageRoot),'collision');renameSync(stage,info.packageRoot);fsyncDir(plugins);
  }
  if(old){testBoundary?.('before-activation');const current=owned(targets);need(canonical(current.manifest)===canonical(old.manifest),'installation-changed');atomic(path.join(old.root,'.ownership.json'),JSON.stringify(manifest),targets.configRoot);}
  testBoundary?.('after-activation');
  history(targets,{action,at:new Date().toISOString(),installId:binding.installId,active:release,version:payload.version});
  return {...info,installed:true,action,writes:true,activation:'reload-required',active:release,version:payload.version,historyRetained:true};
}
