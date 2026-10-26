import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import childProcess, { spawnSync } from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { privateDirectory, privatePaths, isOwned, windowsPath, platformSecurityScope, windowsSecurity, sameWindowsDirectory, windowsDaclValidationScript, windowsPowerShellBootstrap } from '../../shared/platform.ts';
import { lifecycle, inspect, normalizeTargets, type Payload } from '../../setup/lifecycle.ts';
import { Store } from '../../shared/store.ts';
import { readBinding } from '../../shared/binding.ts';
import { captureDocument } from '../../plugin/document.ts';
import { serviceBindingFile } from '../../service/state.ts';
import { SetupController } from '../../service/setup-controller.ts';
import { setupSuggestions } from '../../service/suggestions.ts';
import type { Actor } from '../../shared/progress.ts';
import plugin from '../../plugin/index.ts';

const native = { skip: process.platform !== 'win32', timeout:120000 };
// OS/profile temp ancestors may permit unrelated accounts to replace children.
// Use a new private root; never repair ACLs on an existing shared temp folder.
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
/** Synthetic ACL fixtures only; no profile or external resource access. */
function changeAcl(file:string,kind:'public'|'readonly'|'deny'|'foreign'|'modify-parent'|'create-child'|'callback') {
  const script=String.raw`
$ErrorActionPreference='Stop'
[Console]::InputEncoding=[Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
try {
  $r=[Console]::In.ReadToEnd()|ConvertFrom-Json
  $u=[Security.Principal.WindowsIdentity]::GetCurrent().User
  if([IO.Directory]::Exists($r.file)){$a=[IO.Directory]::GetAccessControl($r.file)}else{$a=[IO.File]::GetAccessControl($r.file)}
  if($r.kind -eq 'callback'){
    $raw=[Security.AccessControl.RawSecurityDescriptor]::new($a.GetSecurityDescriptorBinaryForm(),0)
    $ace=[Security.AccessControl.CommonAce]::new([Security.AccessControl.AceFlags]::None,[Security.AccessControl.AceQualifier]::AccessAllowed,2032127,$u,$true,$null)
    $raw.DiscretionaryAcl.InsertAce(0,$ace)
    $binary=[byte[]]::new($raw.BinaryLength);$raw.GetBinaryForm($binary,0);$a.SetSecurityDescriptorBinaryForm($binary)
  }
  elseif($r.kind -eq 'foreign'){$a.SetOwner([Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'))}
  else {
    if($r.kind -eq 'public'){$sid=[Security.Principal.SecurityIdentifier]::new('S-1-1-0');$rights='ReadAndExecute';$type='Allow'}
    elseif($r.kind -eq 'modify-parent'){$sid=[Security.Principal.SecurityIdentifier]::new('S-1-1-0');$rights='Modify';$type='Allow'}
    elseif($r.kind -eq 'create-child'){$sid=[Security.Principal.SecurityIdentifier]::new('S-1-1-0');$rights='ReadAndExecute,CreateDirectories,CreateFiles';$type='Allow'}
    elseif($r.kind -eq 'deny'){$sid=$u;$rights='Write';$type='Deny'}
    else {$sid=$u;$rights='ReadAndExecute';$type='Allow';foreach($rule in $a.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])){if($rule.IdentityReference.Value -eq $u.Value){[void]$a.RemoveAccessRuleSpecific($rule)}}}
    $rule=[Security.AccessControl.FileSystemAccessRule]::new($sid,$rights,'None','None',$type)
    $a.AddAccessRule($rule)
  }
  if([IO.Directory]::Exists($r.file)){[IO.Directory]::SetAccessControl($r.file,$a)}else{[IO.File]::SetAccessControl($r.file,$a)}
  if($r.kind -eq 'callback'){
    if([IO.Directory]::Exists($r.file)){$actual=[IO.Directory]::GetAccessControl($r.file)}else{$actual=[IO.File]::GetAccessControl($r.file)}
    $check=[Security.AccessControl.RawSecurityDescriptor]::new($actual.GetSecurityDescriptorBinaryForm(),0)
    if(-not $actual.AreAccessRulesCanonical -or -not @($check.DiscretionaryAcl | Where-Object {$_ -is [Security.AccessControl.CommonAce] -and $_.IsCallback}).Count){exit 1}
  }
  [Console]::Out.Write('ok')
}catch{exit 1}
`;
  const r=spawnSync(path.join(process.env.SystemRoot!,'System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoLogo','-NoProfile','-NonInteractive','-Command',script],{input:JSON.stringify({file,kind}),encoding:'utf8',windowsHide:true,timeout:10000,maxBuffer:65536});
  return r.status===0&&r.stdout==='ok';
}

test('Windows atomically private Unicode directories, inherited files, ACL refusals and cache invalidation',native,t=>{
  const f=fixture();try{
    privateDirectory(f.targets.storeRoot);const inherited=path.join(f.targets.storeRoot,'private 文書.txt');fs.writeFileSync(inherited,'synthetic');
    assert.equal(platformSecurityScope(()=>privatePaths([f.targets.storeRoot,inherited])),true);
    const realSpawn=childProcess.spawnSync;let observedModulePath:string|undefined;
    const spy=t.mock.method(childProcess,'spawnSync',((...args:Parameters<typeof childProcess.spawnSync>)=>{observedModulePath=(args[2] as {env?:NodeJS.ProcessEnv})?.env?.PSModulePath;return(realSpawn as any)(...args);})as typeof childProcess.spawnSync);syncBuiltinESMExports();
    try{assert.equal(privatePaths([inherited]),true);assert.equal(observedModulePath,path.join(process.env.SystemRoot!,'System32','WindowsPowerShell','v1.0','Modules'));}finally{spy.mock.restore();syncBuiltinESMExports();}
    assert.equal(isOwned(f.targets.storeRoot),true);
    platformSecurityScope(()=>{
      assert.equal(privatePaths([inherited]),true);assert.equal(changeAcl(inherited,'public'),true);
      assert.equal(privatePaths([inherited]),false,'an ACL mutation cannot reuse a cached private pass');
    });
    const before=fs.readFileSync(inherited);assert.equal(changeAcl(f.targets.storeRoot,'public'),true);assert.throws(()=>privateDirectory(f.targets.storeRoot),/private-permissions/);assert.deepEqual(fs.readFileSync(inherited),before);
    for(const kind of ['readonly','deny'] as const){const dir=path.join(f.root,kind);privateDirectory(dir);assert.equal(changeAcl(dir,kind),true);assert.equal(privatePaths([dir]),false,`${kind} ACL must refuse`);}
    const saved=process.env.SystemRoot;try{process.env.SystemRoot=path.join(f.root,'absent-system');assert.throws(()=>platformSecurityScope(()=>windowsSecurity([f.targets.configRoot])),/windows-security-unavailable/);}finally{process.env.SystemRoot=saved;}
  }finally{f.clean();}
});

test('Windows unsupported callback ACEs preserve owner observation but refuse private and ancestor ACL policy',native,async t=>{
  const f=fixture();try{
    const parent=path.join(f.root,'callback-parent');privateDirectory(parent);const child=path.join(parent,'private-child');privateDirectory(child);const file=path.join(child,'callback-file.txt');fs.writeFileSync(file,'synthetic');
    if(!changeAcl(file,'callback')){t.skip('Windows/.NET refused a canonical callback ACE fixture.');return;}
    assert.equal(isOwned(file),true,'unsupported DACL forms do not change the observed owner');assert.equal(privatePaths([file]),false,'GetAccessRules omission cannot produce a private pass');
    await t.test('unsupported ancestor',childTest=>{
      if(!changeAcl(parent,'callback')){childTest.skip('Windows/.NET refused a canonical callback ACE on a directory.');return;}
      assert.equal(isOwned(parent),true);assert.throws(()=>windowsPath(child),/unsafe-parent/);
    });
  }finally{f.clean();}
});

test('Windows PowerShell uses only the explicit built-in JSON module after startup expansion',native,()=>{
  const script=String.raw`
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
${windowsPowerShellBootstrap}
$module=(Get-Command ConvertFrom-Json).Module.Path
[Console]::Out.Write((ConvertTo-Json -Compress -InputObject @{path=($env:PSModulePath -eq $PSHOME+'\Modules');builtin=$module.StartsWith($PSHOME+'\Modules\Microsoft.PowerShell.Utility\',[StringComparison]::OrdinalIgnoreCase);autoload=($PSModuleAutoLoadingPreference -eq 'None')}))
`;
  const result=spawnSync(path.join(process.env.SystemRoot!,'System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoLogo','-NoProfile','-NonInteractive','-Command',script],{env:{SystemRoot:process.env.SystemRoot,PSModulePath:path.join(fixtureParent,'caller-modules')},encoding:'utf8',windowsHide:true,timeout:10000,maxBuffer:65536});
  assert.equal(result.status,0);assert.deepEqual(JSON.parse(result.stdout),{path:true,builtin:true,autoload:true});
});

test('Windows raw descriptor policy rejects null, callback, object and audit ACE forms using public .NET descriptors',native,()=>{
  const script=String.raw`
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
${windowsDaclValidationScript}
$user=[Security.Principal.WindowsIdentity]::GetCurrent().User
function Check-Dacl($dacl) {
  $raw=[Security.AccessControl.RawSecurityDescriptor]::new([Security.AccessControl.ControlFlags]::DiscretionaryAclPresent,$user,$user,$null,$dacl)
  $bytes=[byte[]]::new($raw.BinaryLength);$raw.GetBinaryForm($bytes,0)
  return Test-OrdinaryDacl $bytes
}
$ordinary=[Security.AccessControl.RawAcl]::new(2,1)
$ordinary.InsertAce(0,[Security.AccessControl.CommonAce]::new([Security.AccessControl.AceFlags]::None,[Security.AccessControl.AceQualifier]::AccessAllowed,2032127,$user,$false,$null))
$callback=[Security.AccessControl.RawAcl]::new(2,1)
$callback.InsertAce(0,[Security.AccessControl.CommonAce]::new([Security.AccessControl.AceFlags]::None,[Security.AccessControl.AceQualifier]::AccessAllowed,2032127,$user,$true,$null))
$object=[Security.AccessControl.RawAcl]::new(4,1)
$object.InsertAce(0,[Security.AccessControl.ObjectAce]::new([Security.AccessControl.AceFlags]::None,[Security.AccessControl.AceQualifier]::AccessAllowed,2032127,$user,[Security.AccessControl.ObjectAceFlags]::None,[Guid]::Empty,[Guid]::Empty,$false,$null))
$audit=[Security.AccessControl.RawAcl]::new(2,1)
$audit.InsertAce(0,[Security.AccessControl.CommonAce]::new([Security.AccessControl.AceFlags]::SuccessfulAccess,[Security.AccessControl.AceQualifier]::SystemAudit,2032127,$user,$false,$null))
[Console]::Out.Write((ConvertTo-Json -Compress -InputObject @{ordinary=(Check-Dacl $ordinary);nullDacl=(Check-Dacl $null);callback=(Check-Dacl $callback);object=(Check-Dacl $object);audit=(Check-Dacl $audit)}))
`;
  const result=spawnSync(path.join(process.env.SystemRoot!,'System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoLogo','-NoProfile','-NonInteractive','-Command',script],{encoding:'utf8',windowsHide:true,timeout:10000,maxBuffer:65536});
  assert.equal(result.status,0,'public .NET descriptor fixtures must execute');assert.deepEqual(JSON.parse(result.stdout),{ordinary:true,nullDacl:false,callback:false,object:false,audit:false});
});

test('Windows ancestor owner policy rejects implicit foreign DACL control',native,()=>{
  const script=String.raw`
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
${windowsDaclValidationScript}
$user=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$results=@()
foreach($owner in @($user,'S-1-5-18','S-1-5-32-544','S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464','S-1-5-21-123-456-789-1001')) {
  # A harmless read-only DACL cannot remove the owner's implicit WRITE_DAC.
  $acl=[Security.AccessControl.DirectorySecurity]::new()
  $acl.SetOwner([Security.Principal.SecurityIdentifier]::new($owner))
  $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($user),'ReadAndExecute','Allow'))
  $results += Test-TrustedAncestorOwner ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value) $user
}
[Console]::Out.Write((ConvertTo-Json -Compress -InputObject $results))
`;
  const result=spawnSync(path.join(process.env.SystemRoot!,'System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoLogo','-NoProfile','-NonInteractive','-Command',script],{encoding:'utf8',windowsHide:true,timeout:10000,maxBuffer:65536});
  assert.equal(result.status,0,'public .NET owner fixtures must execute');assert.deepEqual(JSON.parse(result.stdout),[true,true,true,true,false]);
});

test('Windows hard-linked owned files refuse before database, metadata or history mutation',native,async()=>{
  const f=fixture();try{
    const selector=serviceBindingFile({XDG_STATE_HOME:path.join(f.root,'state')});
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
      [path.join(path.dirname(selector),'.ownership.json'),()=>serviceBindingFile({XDG_STATE_HOME:path.join(f.root,'state')})],
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

test('Windows existing permissive/foreign roots are read-only refusals; current owner is required',native,async t=>{
  const f=fixture();try{
    fs.mkdirSync(f.targets.storeRoot);assert.equal(changeAcl(f.targets.storeRoot,'public'),true);const sentinel=path.join(f.targets.storeRoot,'foreign.txt');fs.writeFileSync(sentinel,'preserve');
    assert.throws(()=>inspect(f.targets),/store-permissions/);assert.equal(fs.readFileSync(sentinel,'utf8'),'preserve');assert.equal(privatePaths([f.targets.storeRoot]),false);
    await t.test('foreign owner',child=>{
      const dir=path.join(f.root,'foreign-owner');privateDirectory(dir);
      if(!changeAcl(dir,'foreign')){child.skip('Account cannot assign a foreign owner; real foreign-owner fixture unavailable.');return;}
      assert.equal(isOwned(dir),false);assert.equal(privatePaths([dir]),false);assert.throws(()=>inspect({...f.targets,configRoot:dir}),/path-unverified/);
    });
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

test('Windows ancestor replacement rights refuse private state while ordinary authorized source reads remain usable',native,async()=>{
  const f=fixture();try{
    const shared=path.join(f.root,'shared-parent');fs.mkdirSync(shared);assert.equal(changeAcl(shared,'create-child'),true);
    const child=path.join(shared,'private-child');privateDirectory(child);fs.writeFileSync(path.join(child,'synthetic.txt'),'preserve');assert.equal(privatePaths([child]),true);
    assert.equal(windowsPath(child),child,'shared read/create-child permissions do not permit replacing a private child');
    assert.equal(changeAcl(shared,'modify-parent'),true);assert.equal(privatePaths([child]),true,'the child DACL alone cannot establish a safe ancestor chain');
    const source=path.join(shared,'ordinary-source.md');fs.writeFileSync(source,'# Authorized ordinary source\n');assert.equal((await captureDocument(source,f.root,async()=>{})).state,'captured','explicitly authorized ordinary documents do not need a private ancestor ACL');
    assert.throws(()=>windowsPath(child),/unsafe-parent/);assert.throws(()=>privateDirectory(path.join(shared,'new-private-child')),/unsafe-parent/);assert.equal(fs.existsSync(path.join(shared,'new-private-child')),false);
    assert.throws(()=>inspect({...f.targets,storeRoot:child}),/unsafe-parent/);assert.equal(fs.readFileSync(path.join(child,'synthetic.txt'),'utf8'),'preserve');
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
    const side=binding.database+'-wal';fs.writeFileSync(side,'synthetic foreign side file');assert.equal(changeAcl(side,'public'),true);try{assert.throws(()=>new Store(binding.database),/binding/);}finally{fs.rmSync(side);}
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

test('Windows service state and SetupController persist privately; host/XDG suggestions remain unverified',native,t=>{
  const f=fixture();let controller:SetupController|undefined;try{
    const selector=serviceBindingFile({XDG_STATE_HOME:path.join(f.root,'state')});
    assert.equal(privatePaths([path.dirname(selector),path.join(path.dirname(selector),'.ownership.json')]),true);
    controller=new SetupController(selector,()=>payload);
    const status=controller.run('install',f.targets);assert.equal(status.configured,true);assert.equal(privatePaths([selector]),true);assert.equal(readBinding(selector).source.configRoot,f.targets.configRoot);
    const systemRoot=process.env.SystemRoot;try{process.env.SystemRoot=path.join(f.root,'absent-system');assert.ok(controller.status().diagnostics.includes('windows-security-unavailable'));assert.throws(()=>serviceBindingFile({XDG_STATE_HOME:path.join(f.root,'state')}),/windows-security-unavailable/);}finally{if(systemRoot===undefined)delete process.env.SystemRoot;else process.env.SystemRoot=systemRoot;}
    controller.close();controller=new SetupController(selector,()=>({...payload,version:'0.3.0'}));controller.run('update',f.targets);assert.equal(controller.status().version,'0.3.0');
    const hints=setupSuggestions({platform:'win32',env:{HOME:f.root,XDG_CONFIG_HOME:path.dirname(f.targets.configRoot),XDG_DATA_HOME:path.dirname(f.targets.dataRoot)},uid:undefined});assert.ok(hints);assert.ok(hints.configRoot?.value.endsWith('opencode'));
    const hostHome=t.mock.method(os,'homedir',()=>f.root);syncBuiltinESMExports();
    try{const fallback=setupSuggestions({platform:'win32',env:{},uid:undefined});assert.equal(fallback?.configRoot?.value,path.join(f.root,'.config','opencode'));assert.ok(!fallback?.configRoot?.value.includes('AppData\\Roaming'));}finally{hostHome.mock.restore();syncBuiltinESMExports();}
    controller.run('remove-capture',f.targets);assert.equal(fs.existsSync(selector),true);
  }finally{controller?.close();f.clean();}
});

test('Windows plugin binds case aliases by directory identity and rejects a different actual source',native,async()=>{
  const f=fixture();let dispose:(()=>Promise<void>)|undefined;
  const saved=new Map<string,string|undefined>();
  try{
    const configRoot=path.join(f.root,'xdg-config','opencode'),dataRoot=path.join(f.root,'xdg-data','opencode');privateDirectory(configRoot,true);privateDirectory(dataRoot,true);
    lifecycle('install',{...f.targets,configRoot,dataRoot},payload);
    for(const[key,value]of Object.entries({AGENT_PROGRESS_BINDING:path.join(configRoot,'plugins','agent-progress','progress-binding.json').toUpperCase(),XDG_CONFIG_HOME:path.dirname(configRoot).toUpperCase(),XDG_DATA_HOME:path.dirname(dataRoot).toUpperCase(),OPENCODE_DB:undefined,OPENCODE_CONFIG_DIR:undefined})){
      saved.set(key,process.env[key]);if(value===undefined)delete process.env[key];else process.env[key]=value;
    }
    let execute:any,status:any;
    const ctx:any={session:{hook:async()=>({dispose:async()=>{}}),get:async({sessionID}:{sessionID:string})=>({id:sessionID,location:{directory:f.root},agent:'synthetic'})},skill:{transform:async(callback:any)=>callback({add:()=>{}})},tool:{hook:async()=>({dispose:async()=>{}}),transform:async(callback:any)=>callback({namespace:()=>{},add:(tool:any)=>{execute=tool.execute;}}),list:async()=>[{id:'agent_progress_report',options:{codemode:false}}]},rpc:{register:async(_contract:any,handlers:any)=>{status=handlers.inspect;}}};
    dispose=await plugin.setup(ctx) as()=>Promise<void>;assert.equal((await status()).toolAvailable,true);
    const reply=await execute({op:'start',plan:'case-alias',oid:'start',rev:0,title:'Synthetic',items:[{id:'a',title:'Task',kind:'task'}]},{sessionID:'synthetic',agent:'synthetic'});assert.equal(JSON.parse(reply.content).rev,1);
    await dispose();dispose=undefined;
    privateDirectory(path.join(f.root,'different-data','opencode'),true);process.env.XDG_DATA_HOME=path.join(f.root,'different-data');
    await assert.rejects(()=>plugin.setup(ctx) as Promise<unknown>,e=>(e as {code?:string}).code==='binding');
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

test('Windows retained-source lookup skips unavailable history but keeps selected targets and security failures strict',native,t=>{
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
    lifecycle('remove-capture',b);fs.renameSync(retiredRoot,historicalRoot);assert.equal(changeAcl(historicalRoot,'modify-parent'),true);
    const realSpawn=childProcess.spawnSync;let historicalSecurityProbe=false;
    const blocked=t.mock.method(childProcess,'spawnSync',((...args:Parameters<typeof childProcess.spawnSync>)=>{
      const input=(args[2] as {input?:unknown})?.input;
      if(typeof input==='string'&&(JSON.parse(input) as {paths?:string[]}).paths?.includes(a.configRoot)){historicalSecurityProbe=true;return{pid:0,output:[],stdout:'',stderr:'',status:1,signal:null};}
      return(realSpawn as any)(...args);
    })as typeof childProcess.spawnSync);syncBuiltinESMExports();
    try{assert.throws(()=>lifecycle('install',b,payload),/windows-security-unavailable/);assert.equal(historicalSecurityProbe,true);assert.equal(fs.existsSync(bindingFile),false);}finally{blocked.mock.restore();syncBuiltinESMExports();}
    lifecycle('install',b,payload);assert.equal(readBinding(bindingFile).source.id,second.source.id,'unsafe historical A is also a nonmatch');
    const historyFile=path.join(f.targets.storeRoot,'installation-history.jsonl'),historyBefore=fs.readFileSync(historyFile),bindingBefore=fs.readFileSync(bindingFile);
    assert.throws(()=>lifecycle('install',{...b,configRoot:path.join(f.root,'missing-selected')},payload),/path-unverified/);
    assert.throws(()=>lifecycle('install',a,payload),/unsafe-parent/);assert.deepEqual(fs.readFileSync(historyFile),historyBefore);assert.deepEqual(fs.readFileSync(bindingFile),bindingBefore);
    store=new Store(database);assert.equal(store.list().sources.length,2);assert.equal(store.get(second.source.id,'history-b')!.revision,2);assert.equal(store.history(second.source.id,'history-b').data.length,2);assert.equal(store.history(historical.id,'history-a').data.length,1);
  }finally{store?.close();f.clean();}
});
