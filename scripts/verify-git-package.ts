/** Actual-host Git/ref gate, exclusively in disposable repositories and host roots. */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, cpSync, readFileSync, writeFileSync, existsSync, rmSync, symlinkSync, readdirSync, lstatSync, chmodSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { createHash } from 'node:crypto';
import { RELEASE } from '../shared/release.ts';

const [major,minor,patch]=RELEASE.split('.').map(Number);
const futureVersion=`${major}.${minor}.${patch!+1}`,brokenVersion=`${major}.${minor}.${patch!+2}`,baselineTag=`v${RELEASE}`;

const runtimeEntries=['build/service/main.js','build/companion/index.js','build/companion/package.json','build/companion/SKILL.md','build/setup/main.js'];
const source='https://progress-fixture.example/Phototonic/openchamber-progress.git';
const hostModule=process.env.AGENT_PROGRESS_HOST_MODULE;
assert.ok(hostModule&&path.isAbsolute(hostModule),'explicit isolated host install.js required');

// Re-exec before importing the host: even incidental host state sees only fixture HOME/XDG.
if(process.argv[2]!=='--worker'){
  const candidate=path.resolve(process.argv[2]??'');assert.ok(process.argv[2]&&existsSync(`${candidate}/package.json`),'candidate Git-tree projection required');
  assert.equal(existsSync(`${candidate}/.git`),false,'supply a projection, never a working repository');
  const root=mkdtempSync('/tmp/opencode/agent-progress-git-gate-');
  try{
    for(const dir of ['home','config','data','cache','state','tmp'])mkdirSync(`${root}/${dir}`,{mode:0o700});
    const result=spawnSync(process.execPath,['--experimental-strip-types',fileURLToPath(import.meta.url),'--worker',candidate,root],{
      env:{PATH:process.env.PATH??'/usr/bin:/bin',HOME:`${root}/home`,XDG_CONFIG_HOME:`${root}/config`,XDG_DATA_HOME:`${root}/data`,XDG_CACHE_HOME:`${root}/cache`,XDG_STATE_HOME:`${root}/state`,TMPDIR:`${root}/tmp`,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_SYSTEM:'/dev/null',GIT_TERMINAL_PROMPT:'0',GIT_ASKPASS:'/bin/false',AGENT_PROGRESS_HOST_MODULE:hostModule},
      encoding:'utf8',timeout:120_000,maxBuffer:4_000_000,
    });
    process.stdout.write(result.stdout??'');process.stderr.write(result.stderr??'');assert.equal(result.status,0,'isolated Git gate failed');
  }finally{rmSync(root,{recursive:true,force:true});console.log(JSON.stringify({fixtureCleanup:true,realRepositoryMutated:false}));}
}else{
  const candidate=process.argv[3]!,root=process.argv[4]!,work=`${root}/work`,bare=`${root}/remote.git`;
  const hostDir=path.dirname(hostModule!);
  const {installGuestFromGitSource,downloadZip}=await import(pathToFileURL(hostModule!).href);
  const {parseGitInstallUrl,gitNetworkArgs}=await import(pathToFileURL(`${hostDir}/clone.js`).href);
  const {checkGuestUpdate,updateGuest}=await import(pathToFileURL(`${hostDir}/updates.js`).href);
  const {readExtensionStore,updateExtensionStore}=await import(pathToFileURL(`${hostDir}/persist.js`).href);
  const {listInstalledGuests,invalidateGuestCatalog,inspectGuestPackage}=await import(pathToFileURL(`${hostDir}/catalog.js`).href);
  const hash=(file:string)=>createHash('sha256').update(readFileSync(file)).digest('hex');
  const files=(dir:string):string[]=>readdirSync(dir).sort().flatMap(name=>{
    if(name==='.git')return[];const file=path.join(dir,name),stat=lstatSync(file);assert.equal(stat.isSymbolicLink(),false,`no projection symlink: ${name}`);return stat.isDirectory()?files(file):[file];
  });
  const git=(args:string[],cwd=work)=>{
    assert.ok(cwd===root||cwd.startsWith(`${root}/`),'Git commands stay in fixture');
    const r=spawnSync('/usr/bin/git',['-c','credential.helper=','-c','core.hooksPath=/dev/null',...args],{cwd,env:process.env,encoding:'utf8',timeout:30_000,maxBuffer:4_000_000});
    assert.equal(r.status,0,`${args[0]}: ${r.stderr}`);return r.stdout.trim();
  };
  cpSync(candidate,work,{recursive:true});files(work);
  const originalManifest=readFileSync(`${work}/package.json`),manifest=JSON.parse(originalManifest.toString());
  assert.equal(manifest.version,RELEASE,'fixture baseline is the current private candidate');
  for(const entry of runtimeEntries)assert.equal(lstatSync(`${work}/${entry}`).isFile(),true,entry);
  assert.equal(JSON.parse(readFileSync(`${work}/build/companion/package.json`,'utf8')).version,manifest.version);
  const originalGuests=Object.fromEntries(['panel','status','page'].map(s=>[s,hash(`${work}/ui/${s}/main.js`)]));
  git(['init','--initial-branch=main']);
  // Read-only ignore proof occurs in this disposable repository, never the source repo.
  for(const entry of runtimeEntries){const r=spawnSync('/usr/bin/git',['check-ignore','--no-index',entry],{cwd:work,encoding:'utf8'});assert.equal(r.status,1,`runtime entry ignored: ${entry}`);}
  for(const entry of ['build/artifacts/future.zip','build/service/progress-binding.json','build/service/scratch.js','build/service/.env.example','build/companion/runtime.sqlite','build/setup/scratch.js','node_modules/private','evidence/private','AGENTS.md','.slim/plan','.env.local']){
    const r=spawnSync('/usr/bin/git',['check-ignore','--no-index',entry],{cwd:work,encoding:'utf8'});assert.equal(r.status,0,`local data trackable: ${entry}`);
  }
  const commit=(message:string)=>{git(['add','--all']);git(['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m',message]);return git(['rev-parse','HEAD']);};
  const initial=commit(`Built fixture main ${RELEASE}`);
  assert.deepEqual(git(['ls-files','build']).split('\n').sort(),[...runtimeEntries].sort());
  const inventory=files(work).map(file=>({path:path.relative(work,file),sha256:hash(file)}));
  assert.deepEqual(inventory.map(e=>e.path).sort(),git(['ls-files','-z']).split('\0').filter(Boolean).sort(),'projection contains exactly its intended tracked files');
  for(const entry of inventory)assert.equal(hash(`${candidate}/${entry.path}`),entry.sha256,'initial projection bytes unchanged');
  git(['init','--bare','--initial-branch=main',bare],root);git(['remote','add','origin',`file://${bare}`]);git(['push','origin','main']);
  git(['tag',baselineTag]);git(['branch','custom']);git(['push','origin',baselineTag,'custom']);

  const lookup=async(host:string)=>{assert.equal(host,'progress-fixture.example');return[{address:'93.184.216.34',family:4}];};
  assert.equal(parseGitInstallUrl('https://127.0.0.1/a.git'),null);
  assert.equal(parseGitInstallUrl('https://user:password@progress-fixture.example/a.git'),null);
  assert.equal(await gitNetworkArgs(source,async()=>[{address:'127.0.0.1',family:4}]),null);
  const policy=await gitNetworkArgs(source,lookup);assert.ok(policy.includes('http.followRedirects=false'));assert.ok(policy.some((s:string)=>s.startsWith('http.curloptResolve=')));
  let requests=0;assert.equal(await downloadZip('https://progress-fixture.example/a.zip',{lookup,request:async()=>{requests++;return{status:302,location:'https://127.0.0.1/private.zip',body:null};}}),null);assert.equal(requests,1,'private redirect rejected before request');
  console.log(JSON.stringify({hostNetworkPolicy:true,privateAddressesRejected:true,redirectsNotFollowedByGit:true,fixtureMappingOnly:true}));

  // The awareness reader sees the very same real fixture main manifest as Git.
  const {ExtensionUpdates,OFFICIAL_MANIFEST,UPDATE_LIMITS}=await import('../service/extension-updates.ts');
  const metadata=createHttpServer((_req,res)=>res.end(git(['show','main:package.json'])));
  metadata.listen(0,'127.0.0.1');await once(metadata,'listening');let clock=Date.now();
  const reader=new ExtensionUpdates({now:()=>clock,transport:async(url,init)=>{assert.equal(url,OFFICIAL_MANIFEST);return fetch(`http://127.0.0.1:${(metadata.address() as {port:number}).port}/manifest`,init);}});
  const advertisedMain=async()=>{clock+=UPDATE_LIMITS.successMs;return reader.check();};

  // This executable delegates all results to real Git. It cannot fetch another source.
  const wrapper=`${root}/fixture-git.cjs`,commands=`${root}/git-commands.jsonl`;
  writeFileSync(wrapper,`#!${process.execPath}\n`+`
const fs=require('node:fs'),{spawnSync}=require('node:child_process'),assert=require('node:assert/strict');
const root=${JSON.stringify(root)},source=${JSON.stringify(source)},bare=${JSON.stringify(`file://${bare}`)};
const args=process.argv.slice(2);let i=0;while(args[i]==='-c')i+=2;const op=args[i];assert.ok(['clone','fetch','show'].includes(op));
if(op!=='show'){assert.ok(args.includes('http.followRedirects=false'));assert.ok(args.some(a=>a.startsWith('http.curloptResolve=progress-fixture.example:443:')));}
if(op==='clone'){const pos=args.indexOf('--');assert.equal(args[pos+1],source);assert.ok(args[pos+2].startsWith(root+'/'));args[pos+1]=bare;}
else {assert.ok(process.cwd().startsWith(root+'/'));if(op==='fetch'){const remote=spawnSync('/usr/bin/git',['config','--get','remote.origin.url'],{encoding:'utf8'});assert.equal(remote.stdout.trim(),bare);assert.equal(args[args.indexOf('--')+1],'origin');}else assert.deepEqual(args,['show','FETCH_HEAD:package.json']);}
fs.appendFileSync(${JSON.stringify(commands)},JSON.stringify({op,ref:op==='fetch'?args.at(-1):op==='clone'&&args.includes('--branch')?args[args.indexOf('--branch')+1]:null})+'\\n');
const r=spawnSync('/usr/bin/git',['-c','credential.helper=','-c','core.hooksPath=/dev/null',...args],{env:process.env,stdio:'inherit'});process.exit(r.status??1);
`);chmodSync(wrapper,0o700);
  const parsed=parseGitInstallUrl(source);assert.deepEqual(parsed,{url:source});
  const install=async(suffix:string,ref?:string)=>{
    const url=parseGitInstallUrl(ref?`${source}#${ref}`:source);assert.ok(url);
    const persist=`${root}/${suffix}/extensions.json`;mkdirSync(path.dirname(persist),{mode:0o700});
    const installed=await installGuestFromGitSource(url.url,persist,{ref:url.ref,gitBinary:wrapper,lookup,openchamberVersion:'2.5.1'});assert.equal(installed.ok,true,JSON.stringify(installed));
    const store=await readExtensionStore(persist),copy=store.paths[0];assert.deepEqual(store.gitOrigins[copy],ref?{url:source,ref}:{url:source});
    assert.equal(readFileSync(`${copy}/package.json`,'utf8'),originalManifest.toString(),'host consumes actual root package.json without repair');
    assert.equal(existsSync(`${copy}/node_modules`),false,'consumer has no dependencies');
    for(const entry of runtimeEntries)assert.equal(hash(`${copy}/${entry}`),hash(`${candidate}/${entry}`));
    return{persist,copy,origin:store.gitOrigins[copy]};
  };
  const normal=await install('default'),tag=await install('tag',baselineTag),custom=await install('custom','custom');
  const guest=async(installation:typeof normal)=>{invalidateGuestCatalog(installation.persist);const rows=await listInstalledGuests({persistPath:installation.persist});assert.equal(rows.length,1);return rows[0];};
  const check=async(installation:typeof normal)=>checkGuestUpdate({guest:await guest(installation),origin:installation.origin,gitBinary:wrapper,lookup});
  const serviceSmoke=async(copy:string,version:string)=>{
    const state=mkdtempSync(`${root}/service-`);for(const dir of ['home','state','selector'])mkdirSync(`${state}/${dir}`,{mode:0o700});
    const reservation=createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');const port=(reservation.address() as {port:number}).port;await new Promise<void>(r=>reservation.close(()=>r()));
    const child=spawn(process.execPath,[`${copy}/build/service/main.js`],{cwd:state,env:{...process.env,HOME:`${state}/home`,XDG_STATE_HOME:`${state}/state`,AGENT_PROGRESS_BINDING:`${state}/selector/binding.json`,OPENCHAMBER_SERVICE_PORT:String(port),OPENCHAMBER_SERVICE_TOKEN:'git-fixture-only'},stdio:['ignore','pipe','pipe']});
    const exit=once(child,'exit');let stderr='';child.stderr.on('data',b=>stderr+=b);
    try{
      let ready=false;const deadline=Date.now()+5000;
      while(Date.now()<deadline){assert.equal(child.exitCode,null,stderr);try{const r=await fetch(`http://127.0.0.1:${port}/health`,{headers:{authorization:'Bearer git-fixture-only'},signal:AbortSignal.timeout(500)});if(r.ok){const health:any=await r.json();assert.equal(health.protocolVersion,2);assert.equal(health.ready,false);ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,25));}
      assert.equal(ready,true,stderr);assert.equal(JSON.parse(readFileSync(`${copy}/build/companion/package.json`,'utf8')).version,version);
      console.log(JSON.stringify({installedCloneServiceStarted:true,version,consumerBuild:false,dependencyInstall:false,prepareHook:false}));
    }finally{child.kill('SIGTERM');await exit;}
  };
  await serviceSmoke(normal.copy,RELEASE);
  await updateExtensionStore(normal.persist,(stored:any)=>({...stored,capabilityGrants:{...stored.capabilityGrants,'agent-progress-probe':['sessions','service']},capabilityScopes:{...stored.capabilityScopes,'agent-progress-probe':{service:{exec:[],sockets:[]}}},disabledGuests:{...stored.disabledGuests,'agent-progress-probe':true}}));
  const trust=await readExtensionStore(normal.persist);
  git(['switch','-c','dev']);
  const future={...manifest,version:futureVersion};writeFileSync(`${work}/package.json`,JSON.stringify(future,null,2)+'\n');
  const releaseFile=`${work}/shared/release.ts`,release=readFileSync(releaseFile,'utf8');assert.ok(release.includes(`'${RELEASE}'`));writeFileSync(releaseFile,release.replace(`'${RELEASE}'`,`'${futureVersion}'`));
  const dependencies=fileURLToPath(new URL('../node_modules',import.meta.url));symlinkSync(dependencies,`${work}/node_modules`,'dir');
  try{const built=spawnSync('bun',['scripts/build.ts'],{cwd:work,env:process.env,encoding:'utf8',timeout:30_000});assert.equal(built.status,0,built.stdout+built.stderr);}finally{rmSync(`${work}/node_modules`);}
  for(const surface of ['panel','status','page'])assert.equal(hash(`${work}/ui/${surface}/main.js`),originalGuests[surface]);
  const ready=commit(`Synthetic built dev ${futureVersion}`);git(['push','origin','dev']);
  assert.equal((await check(normal)).available,false,'dev-only version is not a main update');
  assert.equal((await advertisedMain()).state,'not-newer','official-main reader ignores dev-only version');
  assert.equal((await check(tag)).available,false);assert.equal((await check(custom)).available,false);
  assert.equal(JSON.parse(git(['show','main:package.json'])).version,RELEASE);
  assert.equal(JSON.parse(git(['show','dev:package.json'])).version,futureVersion);
  console.log(JSON.stringify({defaultMain:RELEASE,devOnly:futureVersion,defaultUpdate:false,tagUpdate:false,customUpdate:false,githubReleasesConsulted:false}));
  git(['switch','main']);git(['merge','--ff-only','dev']);git(['push','origin','main']);
  assert.equal(git(['rev-parse','main']),ready,'fixture main is the exact built dev projection');
  const advertised=JSON.parse(git(['show','main:package.json'])).version;
  const available=await check(normal);assert.equal(available.available,true);assert.equal(available.version,advertised);
  const official=await advertisedMain();assert.equal(official.state,'available');assert.equal(official.candidateVersion,advertised,'reader and Git main refer to the same manifest');
  assert.equal(JSON.parse(readFileSync(`${normal.copy}/package.json`,'utf8')).version,RELEASE,'checking never installs');
  const updated=await updateGuest({guest:await guest(normal),origin:normal.origin,persistPath:normal.persist,openchamberVersion:'2.5.1',gitBinary:wrapper,lookup});assert.equal(updated.ok,true,JSON.stringify(updated));
  assert.equal(JSON.parse(readFileSync(`${normal.copy}/package.json`,'utf8')).version,futureVersion);assert.deepEqual(await readExtensionStore(normal.persist),trust,'origin/grants/scopes/paused/storage identity retained');
  await serviceSmoke(normal.copy,futureVersion);
  for(const pinned of [tag,custom]){assert.equal((await check(pinned)).available,false);const result=await updateGuest({guest:await guest(pinned),origin:pinned.origin,persistPath:pinned.persist,openchamberVersion:'2.5.1',gitBinary:wrapper,lookup});assert.equal(result.ok,true);assert.equal(JSON.parse(readFileSync(`${pinned.copy}/package.json`,'utf8')).version,RELEASE);}
  console.log(JSON.stringify({mainAdvertisedVersion:advertised,explicitHostUpdate:true,installedVersion:futureVersion,trustAndOriginPreserved:true,tagAndCustomStayed:RELEASE}));
  const beforeFailure=files(normal.copy).map(file=>({path:path.relative(normal.copy,file),sha256:hash(file)}));
  writeFileSync(`${work}/package.json`,JSON.stringify({...future,version:brokenVersion},null,2)+'\n');rmSync(`${work}/build/service/main.js`);commit('Broken manifest-only fixture main');git(['push','origin','main']);
  assert.equal((await check(normal)).available,true,'host metadata discovery is not a runtime audit');
  const manifestOnly=await advertisedMain();assert.equal(manifestOnly.state,'available');assert.equal(manifestOnly.candidateVersion,brokenVersion,'reader advertises metadata, not missing runtime files');
  const inspected=await inspectGuestPackage(work,{openchamberVersion:'2.5.1'});assert.equal(inspected.ok,false,'pre-main host inspection rejects missing service');
  const rejected=await updateGuest({guest:await guest(normal),origin:normal.origin,persistPath:normal.persist,openchamberVersion:'2.5.1',gitBinary:wrapper,lookup});assert.equal(rejected.ok,false);
  const brokenPersist=`${root}/broken/extensions.json`;mkdirSync(path.dirname(brokenPersist));
  assert.equal((await installGuestFromGitSource(source,brokenPersist,{openchamberVersion:'2.5.1',gitBinary:wrapper,lookup})).ok,false,'fresh install also rejects missing runtime');
  assert.deepEqual(files(normal.copy).map(file=>({path:path.relative(normal.copy,file),sha256:hash(file)})),beforeFailure,'failed update preserves installed ordinary files');
  assert.deepEqual(await readExtensionStore(normal.persist),trust);
  await serviceSmoke(normal.copy,futureVersion);
  console.log(JSON.stringify({brokenAdvertisedVersion:brokenVersion,preMainGateRejected:true,hostUpdateRejected:true,previousInstalledBytesPreserved:true}));
  git(['restore','--source',ready,'--','build/service/main.js']);
  const malformed=JSON.parse(readFileSync(`${work}/package.json`,'utf8'));malformed.openchamber.contributes.panel.id='foreign-extension';writeFileSync(`${work}/package.json`,JSON.stringify(malformed));commit('Foreign identity fixture');git(['push','origin','main']);
  assert.equal((await updateGuest({guest:await guest(normal),origin:normal.origin,persistPath:normal.persist,openchamberVersion:'2.5.1',gitBinary:wrapper,lookup})).ok,false);
  assert.equal(JSON.parse(readFileSync(`${normal.copy}/package.json`,'utf8')).version,futureVersion);
  writeFileSync(`${work}/package.json`,'{invalid JSON');commit('Malformed fixture manifest');git(['push','origin','main']);
  assert.equal((await check(normal)).error,'invalid-manifest');
  assert.equal((await updateGuest({guest:await guest(normal),origin:normal.origin,persistPath:normal.persist,openchamberVersion:'2.5.1',gitBinary:wrapper,lookup})).ok,false);
  assert.deepEqual(files(normal.copy).map(file=>({path:path.relative(normal.copy,file),sha256:hash(file)})),beforeFailure);
  const executed=readFileSync(commands,'utf8').trim().split('\n').map(line=>JSON.parse(line));assert.ok(executed.some(c=>c.op==='clone')&&executed.some(c=>c.op==='fetch')&&executed.some(c=>c.op==='show'));
  console.log(JSON.stringify({projectionFiles:inventory.length,initialCommit:initial,runtimeEntries,realGitCommands:executed.length,consumerCommands:[...new Set(executed.map(c=>c.op))],publicReachabilityProven:false,guestFrameEvidence:'separate Designer acceptance',guestBytes:'unchanged supplied projection; caller supplies acceptance and hashes'}));
  reader.close();metadata.closeAllConnections();await new Promise<void>(r=>metadata.close(()=>r()));
}
