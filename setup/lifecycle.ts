import { randomUUID } from 'node:crypto';
import { existsSync, lstatSync, realpathSync, mkdirSync, readFileSync, readdirSync, writeFileSync, renameSync, rmSync, rmdirSync, openSync, closeSync, fsyncSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { Store, canonical, digest } from '../shared/store.ts';
import { VERSION, type CompanionUpdateRead } from '../shared/progress.ts';
import { type Binding, readBinding, verifyStore } from '../shared/binding.ts';
import { activationFingerprint } from '../shared/activation.ts';

export interface Targets { configRoot: string; dataRoot: string; storeRoot: string; confirmed: boolean }
/** Trim directory suffixes only; do not resolve traversal or conceal symlinks. */
export function normalizeTargets(targets:Targets):Targets {
  const trim=(value:string)=>{const root=path.parse(value).root;while(value.length>root.length&&value.endsWith(path.sep))value=value.slice(0,-1);return value;};
  return {...targets,configRoot:trim(targets.configRoot),dataRoot:trim(targets.dataRoot),storeRoot:trim(targets.storeRoot)};
}
export interface Payload { plugin: string; guidance: string; removal: string; version: string }
type Manifest = { product:'openchamber-agent-progress'; installId:string; active:string; files:Record<string,string>; releases:Record<string,{version:string;files:Record<string,string>}> };
export class SetupError extends Error { readonly code: string; constructor(code:string) {super(code);this.code=code;} }
function need(v:unknown,code:string):asserts v {if(!v)throw new SetupError(code);}
function safe(p:string, allowMissing=false) {
  need(path.isAbsolute(p) && path.resolve(p) === p,'path-unverified');
  let current=p; while(!existsSync(current)) {need(allowMissing,'path-unverified');const parent=path.dirname(current);need(parent!==current,'path-unverified');current=parent;}
  need(realpathSync(current)===current && !lstatSync(current).isSymbolicLink(),'symlink-escape');
}
function fsyncDir(dir:string) {const fd=openSync(dir,'r');try{fsyncSync(fd);}finally{closeSync(fd);}}
function atomic(file:string, content:string, stagingRoot:string) {
  const tmp=path.join(stagingRoot,`.agent-progress-activation-${randomUUID()}`); writeFileSync(tmp,content,{mode:0o600,flag:'wx'});
  const fd=openSync(tmp,'r');try{fsyncSync(fd);}finally{closeSync(fd);}
  renameSync(tmp,file);fsyncDir(path.dirname(file));
}
function writeFiles(root:string, files:Record<string,string>) {
  mkdirSync(root,{mode:0o700});
  for(const [name,body]of Object.entries(files)){need(/^[A-Za-z0-9_.-]+$/.test(name),'payload-invalid');writeFileSync(path.join(root,name),body,{mode:0o600,flag:'wx'});const fd=openSync(path.join(root,name),'r');try{fsyncSync(fd);}finally{closeSync(fd);}}
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
  safe(root);need(lstatSync(root).isDirectory(),'collision');
  need(readdirSync(root).every(name=>Object.hasOwn(expected,name)||extras.includes(name)),'foreign-files');
  for(const [name,hash]of Object.entries(expected)){const file=path.join(root,name);need(existsSync(file),'modified-owned-files');safe(file);const st=lstatSync(file);need(st.isFile()&&st.uid===process.getuid?.()&&(st.mode&0o777)===0o600&&digest(readFileSync(file))===hash,'modified-owned-files');}
}
export function inspect(targets:Targets) {
  targets=normalizeTargets(targets);
  safe(targets.configRoot);safe(targets.dataRoot);safe(targets.storeRoot,true);
  for(const root of [targets.configRoot,targets.dataRoot])need(lstatSync(root).isDirectory()&&lstatSync(root).uid===process.getuid?.(),'path-unverified');
  const packageRoot=path.join(targets.configRoot,'plugins','agent-progress');safe(packageRoot,true);
  if(existsSync(targets.storeRoot))need(lstatSync(targets.storeRoot).isDirectory()&&(lstatSync(targets.storeRoot).mode&0o777)===0o700,'store-permissions');
  const payloadRoot=path.join(targets.storeRoot,'payloads');safe(payloadRoot,true);
  return {targets,packageRoot,verified:targets.confirmed,installed:existsSync(packageRoot),version:null as string|null,fingerprint:null as string|null,diagnostics:[] as string[],activation:'unknown' as const,separateLifecycle:true,historyRetained:true,
    recovery:{stagedPackages:readdirSync(targets.configRoot).filter(n=>n.startsWith('.agent-progress-stage-')).length,stagedActivations:readdirSync(targets.configRoot).filter(n=>n.startsWith('.agent-progress-activation-')).length,stagedReleases:existsSync(payloadRoot)?readdirSync(payloadRoot).filter(n=>n.startsWith('.staged-')).length:0}};
}
function owned(targets:Targets): {root:string;manifest:Manifest;binding:Binding} {
  const info=inspect(targets);need(info.installed,'not-installed');
  const manifestFile=path.join(info.packageRoot,'.ownership.json');need(existsSync(manifestFile),'collision');safe(manifestFile);
  let m:Manifest;try{m=JSON.parse(readFileSync(manifestFile,'utf8'));}catch{throw new SetupError('ownership-invalid');}
  need(m.product==='openchamber-agent-progress'&&typeof m.installId==='string'&&/^[a-f0-9]{64}$/.test(m.active)&&m.releases?.[m.active],'collision');
  need(Object.keys(m.files).sort().join(',')==='SKILL.md,index.js,package.json,progress-binding.json,remove.js','ownership-invalid');
  verifyFiles(info.packageRoot,m.files,['.ownership.json']);
  const b=readBinding(path.join(info.packageRoot,'progress-binding.json'));
  need(b.installId===m.installId&&b.source.configRoot===targets.configRoot&&b.source.dataRoot===targets.dataRoot&&path.dirname(b.database)===targets.storeRoot,'ownership-invalid');
  for(const [id,release]of Object.entries(m.releases)){
    need(/^[a-f0-9]{64}$/.test(id)&&Object.keys(release.files).sort().join(',')==='SKILL.md,index.js,progress-binding.json','ownership-invalid');
    verifyFiles(path.join(targets.storeRoot,'payloads',id),release.files);
  }
  return {root:info.packageRoot,manifest:m,binding:b};
}
function history(targets:Targets,event:unknown){const file=path.join(targets.storeRoot,'installation-history.jsonl');safe(file,true);appendFileSync(file,JSON.stringify(event)+'\n',{mode:0o600});const fd=openSync(file,'r');try{fsyncSync(fd);}finally{closeSync(fd);}}
export type Action='inspect'|'dry-run'|'install'|'update'|'disable'|'enable'|'remove-capture';
export function lifecycle(action:Action,targets:Targets,payload?:Payload, testBoundary?:(name:'release-staged'|'before-activation'|'after-activation')=>void) {
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
        need(controlBinding.database===file&&controlBinding.source.configRoot===targets.configRoot&&controlBinding.source.dataRoot===targets.dataRoot,'ownership-invalid');verifyStore(store,controlBinding);
        store.setEnabled(false);
        const o=owned(targets);verifyStore(store,o.binding);
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
  if(!existsSync(targets.storeRoot))mkdirSync(targets.storeRoot,{recursive:true,mode:0o700});
  const store=new Store(path.join(targets.storeRoot,'progress.sqlite'),{create:true});
  let binding:Binding;
  try{
    if(old){binding={...old.binding,version:payload.version};verifyStore(store,binding);}
    else{
      // Reinstallation reuses the durable same-scope namespace, never process IDs.
      const source=store.list({limit:1}).sources.find(s=>s.configRoot===targets.configRoot&&s.dataRoot===targets.dataRoot)??{id:randomUUID(),configRoot:targets.configRoot,dataRoot:targets.dataRoot,verified:true};
      store.registerSource(source);
      binding={protocolVersion:VERSION,schemaVersion:VERSION,installId:randomUUID(),version:payload.version,database:store.file,storeId:store.list({limit:1}).storeId,source};
    }
  }finally{store.close();}
  const {files,releaseHash,release}=releasePayload(binding,payload);
  const payloadRoot=path.join(targets.storeRoot,'payloads');safe(payloadRoot,true);mkdirSync(payloadRoot,{recursive:true,mode:0o700});
  const releaseRoot=path.join(payloadRoot,release);
  if(existsSync(releaseRoot))verifyFiles(releaseRoot,releaseHash);
  else{const stage=path.join(payloadRoot,`.staged-${randomUUID()}`);writeFiles(stage,files);testBoundary?.('release-staged');renameSync(stage,releaseRoot);fsyncDir(payloadRoot);}
  let manifest:Manifest;
  if(old){manifest={...old.manifest,active:release,releases:{...old.manifest.releases,[release]:{version:payload.version,files:releaseHash}}};}
  else{
    const loader=`import{readFileSync,lstatSync,realpathSync}from'node:fs';import{createHash}from'node:crypto';import{pathToFileURL}from'node:url';import path from'node:path';export default{id:'agent-progress',async setup(ctx){const m=JSON.parse(readFileSync(new URL('./.ownership.json',import.meta.url),'utf8'));if(m.product!=='openchamber-agent-progress'||m.installId!==${JSON.stringify(binding.installId)}||!/^[a-f0-9]{64}$/.test(m.active)||!m.releases[m.active])throw new Error('agent-progress-installation-invalid');const dir=path.join(${JSON.stringify(payloadRoot)},m.active);for(const[name,hash]of Object.entries(m.releases[m.active].files)){const file=path.join(dir,name);if(!/^[A-Za-z0-9_.-]+$/.test(name)||realpathSync(file)!==file||!lstatSync(file).isFile()||createHash('sha256').update(readFileSync(file)).digest('hex')!==hash)throw new Error('agent-progress-payload-modified');}return(await import(pathToFileURL(path.join(dir,'index.js')).href)).default.setup(ctx);}};`;
    const rootFiles={'index.js':loader,'package.json':JSON.stringify({name:'openchamber-agent-progress',version:payload.version,type:'module',exports:{'.':'./index.js'}}),'progress-binding.json':JSON.stringify(binding),'remove.js':payload.removal,'SKILL.md':payload.guidance};
    manifest={product:'openchamber-agent-progress',installId:binding.installId,active:release,files:hashes(rootFiles),releases:{[release]:{version:payload.version,files:releaseHash}}};
    const stage=path.join(targets.configRoot,`.agent-progress-stage-${randomUUID()}`);writeFiles(stage,{...rootFiles,'.ownership.json':JSON.stringify(manifest)});
    testBoundary?.('before-activation');
    const plugins=path.dirname(info.packageRoot);safe(plugins,true);mkdirSync(plugins,{recursive:true,mode:0o700});
    need(!existsSync(info.packageRoot),'collision');renameSync(stage,info.packageRoot);fsyncDir(plugins);
  }
  if(old){testBoundary?.('before-activation');const current=owned(targets);need(canonical(current.manifest)===canonical(old.manifest),'installation-changed');atomic(path.join(old.root,'.ownership.json'),JSON.stringify(manifest),targets.configRoot);}
  testBoundary?.('after-activation');
  history(targets,{action,at:new Date().toISOString(),installId:binding.installId,active:release,version:payload.version});
  return {...info,installed:true,action,writes:true,activation:'reload-required',active:release,version:payload.version,historyRetained:true};
}
