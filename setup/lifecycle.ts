import { randomUUID } from 'node:crypto';
import { existsSync, lstatSync, realpathSync, mkdirSync, readFileSync, readdirSync, writeFileSync, renameSync, rmSync, rmdirSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { Store, canonical, digest } from '../shared/store.ts';
import { VERSION, type CompanionUpdateRead } from '../shared/progress.ts';
import { type Binding, readBinding, verifyStore } from '../shared/binding.ts';
import { activationFingerprint } from '../shared/activation.ts';
import { windows, windowsPath, windowsPaths, platformSecurityScope, privatePaths, privateDirectory, isOwned, syncFile, syncDirectory, PlatformError, sameWindowsObject, sameWindowsDirectory } from '../shared/platform.ts';

export interface Targets { configRoot: string; dataRoot: string; storeRoot: string; confirmed: boolean }
/** Trim directory suffixes only; do not resolve traversal or conceal symlinks. */
export function normalizeTargets(targets:Targets):Targets {
  if(windows)try{return platformSecurityScope(()=>{const [configRoot,dataRoot,storeRoot]=windowsPaths([targets.configRoot,targets.dataRoot,targets.storeRoot,path.join(targets.configRoot,'plugins','agent-progress'),path.join(targets.storeRoot,'payloads')],true);return {...targets,configRoot:configRoot!,dataRoot:dataRoot!,storeRoot:storeRoot!};});}catch(e){throw e instanceof PlatformError?new SetupError(e.code):e;}
  const trim=(value:string)=>{const root=path.parse(value).root;while(value.length>root.length&&value.endsWith(path.sep))value=value.slice(0,-1);return value;};
  return {...targets,configRoot:trim(targets.configRoot),dataRoot:trim(targets.dataRoot),storeRoot:trim(targets.storeRoot)};
}
export interface Payload { plugin: string; guidance: string; removal: string; version: string }
type Manifest = { product:'openchamber-agent-progress'; installId:string; active:string; files:Record<string,string>; releases:Record<string,{version:string;files:Record<string,string>}> };
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
    const loader=`import{readFileSync,lstatSync,realpathSync}from'node:fs';import{createHash}from'node:crypto';import{pathToFileURL}from'node:url';import path from'node:path';function same(file){const a=lstatSync(file,{bigint:true}),b=lstatSync(realpathSync(file),{bigint:true});return a.nlink===1n&&a.ino!==0n&&a.dev===b.dev&&a.ino===b.ino;}export default{id:'agent-progress',async setup(ctx){const selector=new URL('./.ownership.json',import.meta.url);if(process.platform==='win32'&&lstatSync(selector,{bigint:true}).nlink>1n)throw new Error('agent-progress-installation-invalid');const m=JSON.parse(readFileSync(selector,'utf8'));if(m.product!=='openchamber-agent-progress'||m.installId!==${JSON.stringify(binding.installId)}||!/^[a-f0-9]{64}$/.test(m.active)||!m.releases[m.active])throw new Error('agent-progress-installation-invalid');const dir=path.join(${JSON.stringify(payloadRoot)},m.active);for(const[name,hash]of Object.entries(m.releases[m.active].files)){const file=path.join(dir,name);if(!/^[A-Za-z0-9_.-]+$/.test(name)||(process.platform==='win32'?!same(file):realpathSync(file)!==file)||!lstatSync(file).isFile()||createHash('sha256').update(readFileSync(file)).digest('hex')!==hash)throw new Error('agent-progress-payload-modified');}return(await import(pathToFileURL(path.join(dir,'index.js')).href)).default.setup(ctx);}};`;
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
