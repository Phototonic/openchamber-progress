import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import childProcess, { spawnSync } from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { privateDirectory, privatePaths, isOwned, windowsPath, sameWindowsDirectory } from '../../shared/platform.ts';
import { lifecycle, inspect, normalizeTargets, type Payload } from '../../setup/lifecycle.ts';
import { Store } from '../../shared/store.ts';
import { readBinding } from '../../shared/binding.ts';
import { captureDocument } from '../../plugin/document.ts';
import { serviceBindingFile } from '../../service/state.ts';
import { createManagedBindingDirectory, readManagedBinding, managedSourceRoots } from '../../shared/managed-binding.ts';
import { SetupController } from '../../service/setup-controller.ts';
import { setupSuggestions } from '../../service/suggestions.ts';
import type { Actor } from '../../shared/progress.ts';
import { icacls, makeOwnerOnly, readAcl } from '../fixtures/windows-acl.ts';
import { setupLegacy } from '../../plugin/index.ts';

const native = { skip: process.platform !== 'win32', timeout:120000 };
// Use a new root under the drive root so tests never touch an existing shared
// temp folder. Directories get the default inherited permissions of the profile.
const fixtureParent = process.platform==='win32' ? path.join(path.parse(os.tmpdir()).root,`agent-progress-tests-${randomUUID()}`) : os.tmpdir();
if(process.platform==='win32') {
  privateDirectory(fixtureParent);
  after(()=>fs.rmSync(fixtureParent,{recursive:true,force:true}));
}
const payload:Payload={plugin:'export default {id:"synthetic",setup(){}}',guidance:'Synthetic progress fixture',removal:'// synthetic removal fixture',version:'0.2.7'};
function fixture() {
  const root=fs.realpathSync.native(fs.mkdtempSync(path.join(fixtureParent,'agent-progress-windows-')));
  const configRoot=path.join(root,'config ü space'),dataRoot=path.join(root,'data'),storeRoot=path.join(root,'store');
  privateDirectory(configRoot);privateDirectory(dataRoot);
  return {root,targets:{configRoot,dataRoot,storeRoot,confirmed:true},clean(){fs.rmSync(root,{recursive:true,force:true});}};
}
test('Windows creates Unicode directories with default permissions and starts no process',native,t=>{
  const f=fixture();try{
    const spawns=t.mock.method(childProcess,'spawnSync',(()=>{throw new Error('no permission check may start a process');}) as unknown as typeof childProcess.spawnSync);syncBuiltinESMExports();
    try{
      privateDirectory(f.targets.storeRoot);const inherited=path.join(f.targets.storeRoot,'private 文書.txt');fs.writeFileSync(inherited,'synthetic');
      assert.equal(privatePaths([f.targets.storeRoot,inherited]),true);assert.equal(isOwned(f.targets.storeRoot),true);
      assert.equal(windowsPath(inherited),inherited);
      // An existing directory is accepted as it is; a file is not a directory target.
      privateDirectory(f.targets.storeRoot);assert.throws(()=>privateDirectory(inherited),/path-unverified/);
      assert.equal(spawns.mock.callCount(),0);
    }finally{spawns.mock.restore();syncBuiltinESMExports();}
  }finally{f.clean();}
});

test('Windows hard-linked owned files refuse before database, metadata or history mutation',native,async()=>{
  const f=fixture();try{
    const env={XDG_DATA_HOME:path.join(f.root,'shared-data'),XDG_CONFIG_HOME:path.join(f.root,'shared-config')};
    privateDirectory(path.join(env.XDG_DATA_HOME,'opencode'),true);
    const selector=createManagedBindingDirectory(env);
    const controller=new SetupController(selector,()=>payload);try{controller.run('install',f.targets);}finally{controller.close();}
    const packageRoot=path.join(f.targets.configRoot,'plugins','agent-progress'),bindingFile=path.join(packageRoot,'progress-binding.json');
    const binding=readBinding(bindingFile),manifestFile=path.join(packageRoot,'.ownership.json'),manifest=JSON.parse(fs.readFileSync(manifestFile,'utf8'));
    const activeFile=path.join(f.targets.storeRoot,'payloads',manifest.active,'index.js');
    const cases:[string,()=>unknown][]=[
      [binding.database,()=>new Store(binding.database)],
      [bindingFile,()=>readBinding(bindingFile)],
      [manifestFile,()=>lifecycle('disable',f.targets)],
      [activeFile,()=>lifecycle('inspect',f.targets)],
      [path.join(f.targets.storeRoot,'installation-history.jsonl'),()=>lifecycle('remove-capture',f.targets)],
      [selector,()=>readBinding(selector)],
      [path.join(path.dirname(selector),'.ownership.json'),()=>serviceBindingFile(env)],
    ];
    for(const [file,run]of cases){
      const alias=path.join(f.root,`alias-${randomUUID()}`),before=fs.readFileSync(file);fs.linkSync(file,alias);
      try{assert.equal(fs.lstatSync(file).nlink,2);assert.equal(privatePaths([file]),false);assert.throws(run);assert.deepEqual(fs.readFileSync(alias),before);assert.equal(fs.existsSync(path.join(packageRoot,'index.js')),true);}
      finally{fs.unlinkSync(alias);}
    }
    for(const suffix of ['-journal','-wal','-shm']){
      const file=binding.database+suffix,alias=path.join(f.root,`side-alias-${randomUUID()}`);fs.writeFileSync(file,'synthetic side file');fs.linkSync(file,alias);
      try{assert.throws(()=>new Store(binding.database));assert.equal(fs.readFileSync(alias,'utf8'),'synthetic side file');}finally{fs.unlinkSync(alias);fs.unlinkSync(file);}
    }
    const loader=await import(`${new URL(`file:///${path.join(packageRoot,'index.js').replaceAll('\\','/')}`).href}?hardlink`);
    for(const file of [manifestFile,activeFile]){
      const alias=path.join(f.root,`loader-alias-${randomUUID()}`);fs.linkSync(file,alias);
      try{await assert.rejects(()=>loader.default.setup({}),/agent-progress-(?:installation-invalid|payload-modified)/);}finally{fs.unlinkSync(alias);}
    }
  }finally{f.clean();}
});

test('Windows roots with an existing owner-only ACL keep working and their ACLs are never touched',native,t=>{
  const f=fixture();try{
    makeOwnerOnly(f.targets.configRoot);makeOwnerOnly(f.targets.dataRoot);
    const before=[readAcl(f.targets.configRoot),readAcl(f.targets.dataRoot)];
    const spawns=t.mock.method(childProcess,'spawnSync',(()=>{throw new Error('no permission check may start a process');}) as unknown as typeof childProcess.spawnSync);syncBuiltinESMExports();
    try{
      lifecycle('install',f.targets,payload);
      assert.equal(lifecycle('inspect',f.targets).installed,true);
      const binding=readBinding(path.join(f.targets.configRoot,'plugins','agent-progress','progress-binding.json'));
      const store=new Store(binding.database);try{assert.equal(store.list().captureEnabled,true);}finally{store.close();}
      lifecycle('update',f.targets,{...payload,version:'0.3.0'});lifecycle('disable',f.targets);lifecycle('enable',f.targets);
      assert.equal(spawns.mock.callCount(),0);
    }finally{spawns.mock.restore();syncBuiltinESMExports();}
    assert.deepEqual([readAcl(f.targets.configRoot),readAcl(f.targets.dataRoot)],before,'existing ACLs are not applied, repaired or replaced');
  }finally{f.clean();}
});

test('Windows state under an ordinary or widely readable folder is accepted without any ACL check',native,()=>{
  const f=fixture();try{
    fs.mkdirSync(f.targets.storeRoot);icacls(f.targets.storeRoot,['/grant','*S-1-1-0:(OI)(CI)R']);const acl=readAcl(f.targets.storeRoot);
    assert.doesNotThrow(()=>inspect(f.targets));assert.equal(readAcl(f.targets.storeRoot),acl,'an existing ACL is left as found');
    assert.equal(isOwned(f.targets.configRoot),true);
  }finally{f.clean();}
});

test('Windows canonical drive roots, separator/case spellings, aliases and junction refusal',native,()=>{
  const f=fixture();try{
    const root=path.parse(f.root).root;assert.equal(windowsPath(root),fs.realpathSync.native(root));
    const variant=f.targets.configRoot.replaceAll('\\','/')+'//';
    assert.equal(normalizeTargets({...f.targets,configRoot:variant}).configRoot,f.targets.configRoot);
    assert.equal(windowsPath(f.targets.configRoot.toUpperCase()),f.targets.configRoot);
    assert.equal(sameWindowsDirectory(f.targets.configRoot.toUpperCase(),f.targets.configRoot),true);assert.equal(sameWindowsDirectory(f.targets.configRoot,f.targets.dataRoot),false);
    for(const bad of ['\\\\server\\share','\\\\?\\C:\\synthetic','C:relative',f.targets.configRoot+'\\..\\data',f.targets.configRoot+'\\file:stream',f.targets.configRoot+'\\NUL.txt',f.targets.configRoot+'\\trailing.'])assert.throws(()=>windowsPath(bad,true),/path-unverified/);
    const alias=path.join(f.root,'junction');fs.symlinkSync(f.targets.configRoot,alias,'junction');
    assert.throws(()=>windowsPath(alias),/symlink-escape/);assert.throws(()=>inspect({...f.targets,configRoot:alias}),/symlink-escape/);
  }finally{f.clean();}
});

test('Windows lifecycle installs/updates atomically, retains history, recovers interruptions and controls loaded stores',native,()=>{
  const f=fixture();let store:Store|undefined;
  try{
    const start=performance.now();assert.equal(lifecycle('inspect',f.targets).installed,false);assert.equal(fs.existsSync(f.targets.storeRoot),false,'inspect is read-only');
    lifecycle('install',f.targets,payload);
    const binding=readBinding(path.join(f.targets.configRoot,'plugins','agent-progress','progress-binding.json'));
    store=new Store(binding.database);const actor:Actor={sourceId:binding.source.id,sessionId:'synthetic',agent:'build',directory:f.root,parentId:null,ancestry:[],verifiedSource:true};
    store.db.exec('BEGIN IMMEDIATE; UPDATE meta SET enabled=0');
    try{assert.equal(fs.existsSync(binding.database+'-journal'),true);assert.equal(privatePaths([binding.database,binding.database+'-journal']),true);}finally{store.db.exec('ROLLBACK');}
        const request={op:'start',plan:'synthetic',oid:'start',rev:0,title:'Synthetic',items:[{id:'a',title:'Task',kind:'task'}]};
    assert.deepEqual(store.apply(request,actor),store.apply(request,actor));store.apply({op:'change',plan:'synthetic',oid:'change',rev:1,changes:[{id:'a',status:'working'}]},actor);
    lifecycle('disable',f.targets);assert.throws(()=>store!.apply({op:'change',plan:'synthetic',oid:'denied',rev:2,changes:[{id:'a',status:'done'}]},actor),/disabled/);lifecycle('enable',f.targets);
    const manifest=path.join(f.targets.configRoot,'plugins','agent-progress','.ownership.json');const before=fs.readFileSync(manifest);
    assert.throws(()=>lifecycle('update',f.targets,{...payload,version:'0.3.0'},phase=>{if(phase==='before-activation')throw new Error('synthetic-interruption');}),/synthetic-interruption/);
    assert.deepEqual(fs.readFileSync(manifest),before);assert.equal(lifecycle('inspect',f.targets).version,payload.version);
    assert.ok(lifecycle('inspect',f.targets).diagnostics.includes('unreferenced-payloads-retained'));
    assert.throws(()=>lifecycle('update',f.targets,{...payload,version:'0.4.0'},phase=>{if(phase==='release-staged')throw new Error('synthetic-staging-interruption');}),/synthetic-staging-interruption/);
    assert.ok(inspect(f.targets).recovery.stagedReleases>0);
    lifecycle('update',f.targets,{...payload,version:'0.3.0'});assert.equal(lifecycle('inspect',f.targets).version,'0.3.0');
    assert.equal(readBinding(path.join(f.targets.configRoot,'plugins','agent-progress','progress-binding.json')).source.id,binding.source.id);
    assert.equal(store.get(actor.sourceId,'synthetic')!.revision,2);
    const staged=path.join(path.dirname(manifest),`.agent-progress-activation-${randomUUID()}`);fs.writeFileSync(staged,'{"partial":');const selected=fs.readFileSync(manifest);
    assert.equal(inspect(f.targets).recovery.stagedActivations,1);assert.throws(()=>lifecycle('remove-capture',f.targets),/staged-activation-retained/);assert.deepEqual(fs.readFileSync(manifest),selected);assert.equal(fs.existsSync(path.join(path.dirname(manifest),'index.js')),true,'partial selector refusal preserves the runnable installation');
    fs.writeFileSync(staged,selected);
    lifecycle('remove-capture',f.targets);assert.equal(store.list().captureEnabled,false);assert.equal(fs.existsSync(binding.database),true);assert.ok(fs.readFileSync(path.join(f.targets.storeRoot,'installation-history.jsonl'),'utf8').includes('remove-capture'));
    assert.ok(performance.now()-start<120000,'bounded native lifecycle latency');
  }finally{store?.close();f.clean();}
});

test('Windows fresh document capture authorizes before bytes and preserves capture on failure while structured updates continue',native,async t=>{
  const f=fixture();let store:Store|undefined;try{
    privateDirectory(f.targets.storeRoot);store=new Store(path.join(f.targets.storeRoot,'progress.sqlite'),{create:true});
    const source={id:'synthetic-source',configRoot:f.targets.configRoot,dataRoot:f.targets.dataRoot,verified:true};store.registerSource(source);
    const actor:Actor={sourceId:source.id,sessionId:'synthetic',agent:'build',directory:f.root,parentId:null,ancestry:[],verifiedSource:true};
    const file=path.join(f.root,'plan 文書.md');fs.writeFileSync(file,'# First\n- [ ] Synthetic task\n');const authorized:string[]=[];
    const first=await captureDocument(file,f.root,async resource=>{authorized.push(resource);});assert.equal(first.state,'captured');assert.equal(authorized.length,2);
    store.apply({op:'start',plan:'document',oid:'start',rev:0,title:'Synthetic',items:[{id:'a',title:'Task',kind:'task'}]},actor,first);
    const captured=store.document(source.id,'document').text;fs.writeFileSync(file,'# Fresh\n');assert.equal((await captureDocument(file,f.root,async()=>{})).text,'# Fresh\n');
    const original=fs.readSync;let reads=0;const mock=t.mock.method(fs,'readSync',((...args:Parameters<typeof fs.readSync>)=>{reads++;return(original as any)(...args);})as typeof fs.readSync);syncBuiltinESMExports();
    let denied;try{denied=await captureDocument(file,f.root,async()=>{throw new Error('synthetic-denial');});let permissions=0;assert.equal((await captureDocument(file,f.root,async()=>{if(++permissions===2)throw new Error('synthetic-canonical-denial');})).state,'denied');assert.equal(reads,0);}finally{mock.mock.restore();syncBuiltinESMExports();}
    assert.equal(denied.state,'denied');store.apply({op:'change',plan:'document',oid:'change',rev:1,changes:[{id:'a',status:'done'}]},actor,denied);assert.equal(store.document(source.id,'document').text,captured);assert.equal(store.get(source.id,'document')!.items[0]!.status,'done');
    fs.writeFileSync(file,Buffer.alloc(262145,65));assert.equal((await captureDocument(file,f.root,async()=>{})).state,'oversized');
    fs.writeFileSync(file,Buffer.from([0xff,0xfe]));assert.equal((await captureDocument(file,f.root,async()=>{})).state,'non-text');
    assert.equal((await captureDocument(path.join(f.root,'missing.md'),f.root,async()=>{})).state,'missing');
    assert.equal((await captureDocument(f.root,f.root,async()=>{})).state,'non-text');
    fs.writeFileSync(file,'# Stable\n');const realRead=fs.readSync;let changed=false;const mutate=t.mock.method(fs,'readSync',((...args:Parameters<typeof fs.readSync>)=>{const n=(realRead as any)(...args);if(!changed){changed=true;fs.appendFileSync(file,'mutation');}return n;})as typeof fs.readSync);syncBuiltinESMExports();
    try{assert.equal((await captureDocument(file,f.root,async()=>{})).state,'changed-during-read');}finally{mutate.mock.restore();syncBuiltinESMExports();}
    fs.writeFileSync(file,'# Original inode\n');const realOpen=fs.openSync;let documentReads=0;
    const swap=t.mock.method(fs,'openSync',((...args:Parameters<typeof fs.openSync>)=>{if(String(args[0])===file){fs.renameSync(file,file+'.original');fs.writeFileSync(file,'# Replacement inode\n');}return(realOpen as any)(...args);})as typeof fs.openSync);
    const beforeRead=t.mock.method(fs,'readSync',((...args:Parameters<typeof fs.readSync>)=>{documentReads++;return(realRead as any)(...args);})as typeof fs.readSync);syncBuiltinESMExports();
    try{assert.equal((await captureDocument(file,f.root,async()=>{})).state,'changed-during-read');assert.equal(documentReads,0,'a pre-open replacement must refuse before bytes');}finally{swap.mock.restore();beforeRead.mock.restore();syncBuiltinESMExports();}
    const alias=path.join(f.root,'document-junction');fs.symlinkSync(f.root,alias,'junction');assert.equal((await captureDocument(path.join(alias,path.basename(file)),f.root,async()=>{})).state,'changed-during-read');
  }finally{store?.close();f.clean();}
});

test('Windows managed discovery is read-only and state-independent; confirmed setup persists privately',native,t=>{
  const f=fixture();let controller:SetupController|undefined;try{
    const env={HOME:f.root,XDG_DATA_HOME:path.join(f.root,'shared-data'),XDG_CONFIG_HOME:path.join(f.root,'shared-config')};
    const configRoot=path.join(env.XDG_CONFIG_HOME,'opencode'),dataRoot=path.join(env.XDG_DATA_HOME,'opencode');
    privateDirectory(configRoot,true);privateDirectory(dataRoot,true);
    const batch=t.mock.method(childProcess,'spawnSync',(()=>{throw new Error('no permission check may start a process');}) as unknown as typeof childProcess.spawnSync);syncBuiltinESMExports();
    try{
      assert.deepEqual(managedSourceRoots(env),{configRoot,dataRoot});managedSourceRoots(env);
      assert.equal(batch.mock.callCount(),0,'discovery starts no process');
    }finally{batch.mock.restore();syncBuiltinESMExports();}
    const selector=serviceBindingFile(env);
    assert.equal(fs.existsSync(path.dirname(selector)),false);assert.equal(readManagedBinding(env),undefined);
    assert.equal(serviceBindingFile({...env,XDG_STATE_HOME:path.join(f.root,'different-state')}),selector);
    controller=new SetupController({env},()=>payload);
    const review=controller.run('managed-inspect',{storeRoot:f.targets.storeRoot}).delivery!.review!;
    assert.equal(fs.existsSync(path.dirname(selector)),false);
    const status=controller.run('managed-configure',{storeRoot:f.targets.storeRoot,confirmed:true,expected:review.expected});assert.equal(status.configured,true);
    assert.equal(privatePaths([path.dirname(selector),path.join(path.dirname(selector),'.ownership.json')]),true);
    assert.equal(privatePaths([selector]),true);assert.equal(readManagedBinding(env)!.source.configRoot,configRoot);
    {const systemRoot=process.env.SystemRoot;try{process.env.SystemRoot=path.join(f.root,'absent-system');assert.equal(controller.status().configured,true);assert.equal(serviceBindingFile(env),selector);}finally{if(systemRoot===undefined)delete process.env.SystemRoot;else process.env.SystemRoot=systemRoot;}}
    controller.close();controller=new SetupController({env},()=>({...payload,version:'0.3.0'}));assert.equal(controller.status().version,'0.3.0');
    const hints=setupSuggestions({platform:'win32',env:{HOME:f.root,XDG_CONFIG_HOME:path.dirname(f.targets.configRoot),XDG_DATA_HOME:path.dirname(f.targets.dataRoot)},uid:undefined});assert.ok(hints);assert.ok(hints.configRoot?.value.endsWith('opencode'));
    const hostHome=t.mock.method(os,'homedir',()=>f.root);syncBuiltinESMExports();
    try{const fallback=setupSuggestions({platform:'win32',env:{},uid:undefined});assert.equal(fallback?.configRoot?.value,path.join(f.root,'.config','opencode'));assert.ok(!fallback?.configRoot?.value.includes('AppData\\Roaming'));}finally{hostHome.mock.restore();syncBuiltinESMExports();}
    const checked=controller.run('managed-inspect',{}).delivery!.review!;
    controller.run('managed-disable',{confirmed:true,expected:checked.expected});assert.equal(fs.existsSync(selector),true);
  }finally{controller?.close();f.clean();}
});

test('Windows retained legacy plugin binds case aliases by directory identity and rejects a different actual source',native,async()=>{
  const f=fixture();let dispose:(()=>Promise<void>)|undefined;
  const saved=new Map<string,string|undefined>();
  try{
    const configRoot=path.join(f.root,'xdg-config','opencode'),dataRoot=path.join(f.root,'xdg-data','opencode');privateDirectory(configRoot,true);privateDirectory(dataRoot,true);
    lifecycle('install',{...f.targets,configRoot,dataRoot},payload);
    for(const[key,value]of Object.entries({HOME:f.root,AGENT_PROGRESS_BINDING:undefined,XDG_CONFIG_HOME:path.dirname(configRoot).toUpperCase(),XDG_DATA_HOME:path.dirname(dataRoot).toUpperCase(),XDG_STATE_HOME:path.join(f.root,'state'),XDG_CACHE_HOME:path.join(f.root,'cache'),XDG_RUNTIME_DIR:path.join(f.root,'runtime'),OPENCODE_DB:undefined,OPENCODE_CONFIG_DIR:undefined})){
      saved.set(key,process.env[key]);if(value===undefined)delete process.env[key];else process.env[key]=value;
    }
    let execute:any,status:any;
    const ctx:any={session:{hook:async()=>({dispose:async()=>{}}),get:async({sessionID}:{sessionID:string})=>({id:sessionID,location:{directory:f.root},agent:'synthetic'})},skill:{transform:async(callback:any)=>callback({add:()=>{}})},tool:{hook:async()=>({dispose:async()=>{}}),transform:async(callback:any)=>callback({namespace:()=>{},add:(tool:any)=>{execute=tool.execute;}}),list:async()=>[{id:'agent_progress_report',options:{codemode:false}}]},rpc:{register:async(_contract:any,handlers:any)=>{status=handlers.inspect;}}};
    const selector=path.join(configRoot,'plugins','agent-progress','progress-binding.json').toUpperCase();
    dispose=await setupLegacy(ctx,selector) as()=>Promise<void>;assert.equal((await status()).toolAvailable,true);
    const reply=await execute({op:'start',plan:'case-alias',oid:'start',rev:0,title:'Synthetic',items:[{id:'a',title:'Task',kind:'task'}]},{sessionID:'synthetic',agent:'synthetic'});assert.equal(JSON.parse(reply.content).rev,1);
    await dispose();dispose=undefined;
    privateDirectory(path.join(f.root,'different-data','opencode'),true);process.env.XDG_DATA_HOME=path.join(f.root,'different-data');
    await assert.rejects(()=>setupLegacy(ctx,selector) as Promise<unknown>,e=>(e as {code?:string}).code==='binding');
  }finally{await dispose?.();for(const[key,value]of saved){if(value===undefined)delete process.env[key];else process.env[key]=value;}f.clean();}
});

test('Windows directory filters match separator and drive spellings without filesystem reads or directory case folding',native,t=>{
  const f=fixture();let store:Store|undefined;
  try{
    privateDirectory(f.targets.storeRoot);store=new Store(path.join(f.targets.storeRoot,'progress.sqlite'),{create:true});
    const source={id:'directory-source',configRoot:f.targets.configRoot,dataRoot:f.targets.dataRoot,verified:true};store.registerSource(source);
    const nativeDirectory=path.join(f.root,'ProjectCase'),forwardDirectory=nativeDirectory.replaceAll('\\','/'),sibling=nativeDirectory+'-sibling',caseDistinct=path.join(f.root,'projectCase');
    const actor:Actor={sourceId:source.id,sessionId:'native-session',agent:'build',directory:nativeDirectory,parentId:null,ancestry:[],verifiedSource:true};
    for(const[id,directory]of [['native-plan',nativeDirectory],['forward-plan',forwardDirectory],['sibling-plan',sibling],['case-plan',caseDistinct]] as const)store.apply({op:'start',plan:id,oid:id,rev:0,title:'Synthetic',items:[{id:'a',title:'Task',kind:'task'}]},{...actor,sessionId:id,directory});
    const parent={...actor,sessionId:'parent',directory:path.join(f.root,'Coordinator')},child={...actor,sessionId:'child',directory:forwardDirectory,parentId:'parent',ancestry:['parent']};
    store.apply({op:'start',plan:'linked-parent',oid:'parent-start',rev:0,title:'Synthetic',items:[{id:'a',title:'Task',kind:'task'}]},parent);
    store.apply({op:'link',plan:'linked-parent',oid:'parent-link',rev:1,child:child.sessionId,assign:['a']},parent,undefined,child);
    const noFilesystem=()=>{throw new Error('directory-filter-must-not-probe-filesystem');};
    const stat=t.mock.method(fs,'lstatSync',noFilesystem),real=t.mock.method(fs,'realpathSync',noFilesystem),spawn=t.mock.method(childProcess,'spawnSync',noFilesystem);syncBuiltinESMExports();
    try{
      const ids=(directory:string,session?:string)=>store!.list({directory,session}).data.map(p=>p.id);
      const expected=['forward-plan','linked-parent','native-plan'];
      assert.deepEqual(ids(nativeDirectory),expected);assert.deepEqual(ids(forwardDirectory),expected);assert.deepEqual(ids(forwardDirectory[0]!.toLowerCase()+forwardDirectory.slice(1)),expected);
      assert.deepEqual(ids(forwardDirectory,child.sessionId),['linked-parent'],'linked session directory predicates use the same spelling comparison');
      assert.deepEqual(ids(sibling),['sibling-plan']);assert.deepEqual(ids(caseDistinct),['case-plan']);assert.deepEqual(ids(path.join(f.root,'PROJECTCASE')),[]);assert.deepEqual(ids(nativeDirectory+'-other'),[]);assert.deepEqual(ids(path.join(nativeDirectory,'nested')),[]);
      assert.equal(store.detail(source.id,'native-plan').plan.directory,nativeDirectory);assert.equal(store.detail(source.id,'forward-plan').plan.directory,forwardDirectory);
    }finally{stat.mock.restore();real.mock.restore();spawn.mock.restore();syncBuiltinESMExports();}
  }finally{store?.close();f.clean();}
});

test('Windows cleanup snapshots inherit the parent permissions; archive/restore/delete preserve source and directory matching',native,async()=>{
  const f=fixture();let store:Store|undefined;
  try{
    privateDirectory(f.targets.storeRoot);store=new Store(path.join(f.targets.storeRoot,'progress.sqlite'),{create:true});
    const source={id:'cleanup-source',configRoot:f.targets.configRoot,dataRoot:f.targets.dataRoot,verified:true};store.registerSource(source);
    const directory=path.join(f.root,'ProjectCase');
    const actor:Actor={sourceId:source.id,sessionId:'cleanup-session',agent:'build',directory,parentId:null,ancestry:[],verifiedSource:true};
    const file=path.join(f.root,'cleanup 文書.md'),text='# Synthetic finished plan\n';fs.writeFileSync(file,text);
    const capture=await captureDocument(file,f.root,async()=>{});assert.equal(capture.state,'captured');
    store.apply({op:'start',plan:'P-done',oid:'start',rev:0,title:'Synthetic finished plan',source:file,items:[{id:'a',title:'Example',kind:'task',status:'done'}]},actor,capture);
    store.apply({op:'finish',plan:'P-done',oid:'finish',rev:1,outcome:'finished'},actor,capture);
    store.apply({op:'start',plan:'P-active',oid:'active',rev:0,title:'Synthetic active plan',items:[{id:'a',title:'Example',kind:'task',status:'working'}]},actor);
    const detail=store.detail(source.id,'P-done'),history=store.history(source.id,'P-done').data;
    const request={storeId:detail.storeId,source:source.id,plan:'P-done',rev:2,cleanupRev:0,oid:'archive'};
    const variant=directory.replaceAll('\\','/').replace(/^[a-z]:/i,drive=>drive.toLowerCase());
    const before=store.db.prepare('SELECT * FROM revisions ORDER BY source,plan,revision').all();
    store.setEnabled(false);store.cleanup('archive',request);assert.equal(store.list().captureEnabled,false);
    assert.deepEqual(store.db.prepare('SELECT * FROM revisions ORDER BY source,plan,revision').all(),before);
    assert.deepEqual(store.list({directory:variant}).data.map(p=>p.id),['P-active']);
    assert.deepEqual(store.list({directory:variant,session:actor.sessionId,archived:'only'}).data.map(p=>p.id),['P-done']);
    assert.equal(store.list({directory:path.join(f.root,'projectCase'),archived:'only'}).data.length,0,'archive filtering must not case-fold directory names');
    assert.deepEqual(store.history(source.id,'P-done').data,history);assert.equal(store.document(source.id,'P-done',0,detail.plan.document.captureId).text,text);
    const backups=fs.readdirSync(f.targets.storeRoot).filter(name=>name.startsWith('cleanup-backup-'));assert.equal(backups.length,1);
    const backup=path.join(f.targets.storeRoot,backups[0]!);assert.equal(privatePaths([f.targets.storeRoot,backup]),true);assert.equal(fs.lstatSync(backup).nlink,1);
    const snapshot=new Store(backup,{readOnly:true});try{assert.equal(snapshot.get(source.id,'P-done')!.lifecycle,'finished');assert.equal(snapshot.detail(source.id,'P-done').plan.cleanup,undefined);assert.equal(snapshot.db.prepare('PRAGMA integrity_check').get()!.integrity_check,'ok');}finally{snapshot.close();}
    store.cleanup('restore',{...request,cleanupRev:1,oid:'restore'});assert.equal(store.get(source.id,'P-done')!.lifecycle,'finished');assert.deepEqual(store.history(source.id,'P-done').data,history);
    const deletion={...request,cleanupRev:2,oid:'delete',confirmed:true};const receipt=store.cleanup('delete',deletion);
    assert.deepEqual(store.cleanup('delete',deletion),receipt);assert.equal(store.get(source.id,'P-done'),undefined);
    assert.throws(()=>store!.document(source.id,'P-done',0,detail.plan.document.captureId),/not-found/);
    assert.equal(store.get(source.id,'P-active')!.lifecycle,'active');assert.equal(fs.readFileSync(file,'utf8'),text);
    assert.deepEqual(store.db.prepare('PRAGMA foreign_key_check').all(),[]);
    store.close();store=new Store(path.join(f.targets.storeRoot,'progress.sqlite'));assert.deepEqual(store.cleanup('delete',deletion),receipt);
    store.setEnabled(true);assert.throws(()=>store!.apply({op:'start',plan:'P-done',oid:'resurrect',rev:0,title:'No',items:[]},actor),/not-found/);
  }finally{store?.close();f.clean();}
});

test('Windows first cleanup refuses hard-linked state without snapshot or mutation',native,()=>{
  for(const kind of ['database-hardlink'] as const){
    const f=fixture();let store:Store|undefined;
    try{
      privateDirectory(f.targets.storeRoot);const database=path.join(f.targets.storeRoot,'progress.sqlite');store=new Store(database,{create:true});
      const source={id:'cleanup-source',configRoot:f.targets.configRoot,dataRoot:f.targets.dataRoot,verified:true};store.registerSource(source);
      const actor:Actor={sourceId:source.id,sessionId:'cleanup-session',agent:'build',directory:f.root,parentId:null,ancestry:[],verifiedSource:true};
      store.apply({op:'start',plan:'P-done',oid:'start',rev:0,title:'Synthetic',items:[{id:'a',title:'Example',kind:'task',status:'done'}]},actor);
      store.apply({op:'finish',plan:'P-done',oid:'finish',rev:1,outcome:'finished'},actor);
      const request={storeId:store.list().storeId,source:source.id,plan:'P-done',rev:2,cleanupRev:0,oid:'archive'};
      const before=store.db.prepare('SELECT * FROM plans').all();
      if(kind==='database-hardlink')fs.linkSync(database,path.join(f.root,'database-alias.sqlite'));
      assert.throws(()=>store!.cleanup('archive',request),e=>['binding','storage'].includes((e as {code:string}).code));
      assert.deepEqual(store.db.prepare('SELECT * FROM plans').all(),before);
      assert.equal(store.db.prepare("SELECT name FROM sqlite_master WHERE name='cleanup_state'").get(),undefined);
      assert.equal(fs.readdirSync(f.targets.storeRoot).some(name=>name.startsWith('cleanup-backup-')),false);
    }finally{store?.close();f.clean();}
  }
});

test('Windows retained-source lookup skips unavailable history but keeps selected targets strict',native,()=>{
  const f=fixture();let store:Store|undefined;
  try{
    const historicalRoot=path.join(f.root,'historical-a'),retiredRoot=path.join(f.root,'retired-a');
    const a={...f.targets,configRoot:path.join(historicalRoot,'config'),dataRoot:path.join(historicalRoot,'data')};
    const b={...f.targets,configRoot:path.join(f.root,'config-b'),dataRoot:path.join(f.root,'data-b')};
    for(const dir of [a.configRoot,a.dataRoot,b.configRoot,b.dataRoot])privateDirectory(dir,true);
    privateDirectory(f.targets.storeRoot);const database=path.join(f.targets.storeRoot,'progress.sqlite');
    // This valid synthetic source sorts before every subsequently generated UUID.
    const historical={id:'00000000-0000-0000-0000-000000000000',configRoot:a.configRoot,dataRoot:a.dataRoot,verified:true};
    store=new Store(database,{create:true});store.registerSource(historical);store.close();store=undefined;
    lifecycle('install',a,payload);const first=readBinding(path.join(a.configRoot,'plugins','agent-progress','progress-binding.json'));
    assert.equal(first.source.id,historical.id);
    const actor=(sourceId:string,sessionId:string):Actor=>({sourceId,sessionId,agent:'synthetic',directory:f.root,parentId:null,ancestry:[],verifiedSource:true});
    store=new Store(database);store.apply({op:'start',plan:'history-a',oid:'start-a',rev:0,title:'Synthetic A',items:[{id:'a',title:'Task',kind:'task'}]},actor(historical.id,'session-a'));store.close();store=undefined;
    lifecycle('remove-capture',a);fs.renameSync(historicalRoot,retiredRoot);
    lifecycle('install',b,payload);const bindingFile=path.join(b.configRoot,'plugins','agent-progress','progress-binding.json'),second=readBinding(bindingFile);
    assert.notEqual(second.source.id,historical.id);assert.equal(second.storeId,first.storeId);lifecycle('enable',b);
    store=new Store(database);store.apply({op:'start',plan:'history-b',oid:'start-b',rev:0,title:'Synthetic B',items:[{id:'b',title:'Task',kind:'task'}]},actor(second.source.id,'session-b'));store.apply({op:'change',plan:'history-b',oid:'change-b',rev:1,changes:[{id:'b',status:'working'}]},actor(second.source.id,'session-b'));
    assert.equal(store.list().sources[0]!.id,historical.id,'unavailable A must precede B during lookup');store.close();store=undefined;
    lifecycle('remove-capture',b);lifecycle('install',b,payload);assert.equal(readBinding(bindingFile).source.id,second.source.id,'B reuses its namespace after the missing earlier source');
    lifecycle('remove-capture',b);fs.renameSync(retiredRoot,historicalRoot);
    lifecycle('install',b,payload);assert.equal(readBinding(bindingFile).source.id,second.source.id,'a restored historical A is still a nonmatch for B');
    const historyFile=path.join(f.targets.storeRoot,'installation-history.jsonl'),historyBefore=fs.readFileSync(historyFile),bindingBefore=fs.readFileSync(bindingFile);
    assert.throws(()=>lifecycle('install',{...b,configRoot:path.join(f.root,'missing-selected')},payload),/path-unverified/);
    assert.deepEqual(fs.readFileSync(historyFile),historyBefore);assert.deepEqual(fs.readFileSync(bindingFile),bindingBefore);
    store=new Store(database);assert.equal(store.list().sources.length,2);assert.equal(store.get(second.source.id,'history-b')!.revision,2);assert.equal(store.history(second.source.id,'history-b').data.length,2);assert.equal(store.history(historical.id,'history-a').data.length,1);
  }finally{store?.close();f.clean();}
});
