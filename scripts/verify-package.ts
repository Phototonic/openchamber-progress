/** Artifact-level QA: parser, entries, version agreement, executable lifecycle. */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, cpSync, chmodSync, readdirSync,lstatSync,readlinkSync } from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { parseManifestJson } from '@openchamber/sdk/schemas';
import { VERSION } from '../shared/progress.ts';
import { Store, digest } from '../shared/store.ts';
import { RELEASE } from '../shared/release.ts';

const version=JSON.parse(readFileSync('package.json','utf8')).version;
const base=path.resolve('build/artifacts');
const extension=path.join(base,`agent-progress-extension-${version}`);
const companion=path.join(base,`agent-progress-companion-${version}`);
const root=mkdtempSync('/tmp/opencode/agent-progress-package-');
const clean={PATH:path.dirname(process.execPath)+':/usr/bin:/bin',HOME:`${root}/home`,XDG_CONFIG_HOME:`${root}/config`,XDG_DATA_HOME:`${root}/data`,XDG_CACHE_HOME:`${root}/cache`,XDG_STATE_HOME:`${root}/state`,TMPDIR:root};
for(const dir of ['home','config/opencode','data/opencode','cache','state','store'])mkdirSync(`${root}/${dir}`,{recursive:true,mode:0o700});
let service:ReturnType<typeof spawn>|undefined;
function run(args:string[],options:{env?:NodeJS.ProcessEnv;cwd?:string}={}) {
  const result=spawnSync(process.execPath,args,{encoding:'utf8',env:clean,...options,timeout:15000});
  assert.equal(result.status,0,result.stdout+result.stderr);return result.stdout.trim();
}
function files(root:string):string[]{return readdirSync(root).sort().flatMap(name=>{const file=path.join(root,name);const stat=lstatSync(file);assert.equal(stat.isSymbolicLink(),false,'no packaged symlinks');return stat.isDirectory()?files(file):[file];});}
function snapshot(root:string):unknown {
  const result:Record<string,unknown>={};
  function visit(file:string){const st=lstatSync(file,{bigint:true});result[path.relative(root,file)]={mode:String(st.mode),uid:String(st.uid),size:String(st.size),mtimeNs:String(st.mtimeNs),...(st.isFile()?{hash:digest(readFileSync(file))}:{}),...(st.isSymbolicLink()?{link:readlinkSync(file)}:{})};if(st.isDirectory())for(const name of readdirSync(file).sort())visit(path.join(file,name));}
  visit(root);return result;
}
try {
  assert.equal(version,RELEASE);
  const entriesFile=path.join(base,`entries-${version}.sha256`);const entries=readFileSync(entriesFile,'utf8');
  run(['--experimental-strip-types',path.resolve('scripts/package.ts')]);
  assert.equal(readFileSync(entriesFile,'utf8'),entries,'entry inventories must match across assembly; ZIP timestamps are not canonical');
  console.log(JSON.stringify({entryInventoryDeterministic:true,zipContainerBytesCanonical:false}));
  const manifest=JSON.parse(readFileSync(path.join(extension,'package.json'),'utf8'));
  const parsed=parseManifestJson(JSON.stringify(manifest));assert.equal(parsed.ok,true);
  assert.equal(manifest.version,version);assert.equal(VERSION,2); // Not the release major.
  assert.equal(manifest.openchamber.contributes.panel.id,'agent-progress-probe');
  for(const surface of ['panel','status','page']) {
    for(const name of ['index.html','main.js'])assert.equal(digest(readFileSync(path.join(extension,`ui/${surface}/${name}`))),digest(readFileSync(`ui/${surface}/${name}`)),`${surface}/${name}`);
    const html=readFileSync(path.join(extension,`ui/${surface}/index.html`),'utf8');assert.match(html,/src=["'](?:\.\/)?main\.js["']/);
    const js=readFileSync(path.join(extension,`ui/${surface}/main.js`),'utf8');assert.doesNotMatch(js,/^\s*(?:import\s|export\s)/m);
  }
  for(const artifact of [extension,companion]) {
    const builds=['build/companion/index.js','build/companion/SKILL.md','build/companion/package.json','build/setup/main.js'];
    const expected=['package.json','docs/setup.md',...builds,...(artifact===extension?['build/service/main.js',...['panel','status','page'].flatMap(surface=>[`ui/${surface}/index.html`,`ui/${surface}/main.js`])]:[])].sort();
    assert.deepEqual(files(artifact).map(file=>path.relative(artifact,file)).sort(),expected,'package contains only declared payload; no evidence/instructions/auth/runtime DB');
    const archive=spawnSync('unzip',['-Z','-1',`${artifact}.zip`],{encoding:'utf8'});assert.equal(archive.status,0);
    assert.deepEqual(archive.stdout.trim().split('\n').filter(name=>!name.endsWith('/')).sort(),expected,'ZIP entry allowlist matches folder');
    assert.equal(JSON.parse(readFileSync(path.join(artifact,'package.json'),'utf8')).version,version);
    assert.equal(JSON.parse(readFileSync(path.join(artifact,'build/companion/package.json'),'utf8')).version,version);
    for(const entry of ['build/companion/index.js','build/setup/main.js'])run(['--check',path.join(artifact,entry)]);
  }
  run(['--check',path.join(extension,'build/service/main.js')]);
  console.log(JSON.stringify({manifestParser:true,guestEntries:3,guestBytesUnchanged:true,version,protocolVersion:VERSION,schemaVersion:VERSION,selfContainedSyntax:true}));

  // Exact packaged service, before any companion install. No source controller or DTO mocks.
  const fresh=`${root}/fresh-setup`;for(const dir of ['home/.config/opencode','home/.local/share/opencode','selector'])mkdirSync(`${fresh}/${dir}`,{recursive:true,mode:0o700});
  writeFileSync(`${fresh}/home/.config/opencode/foreign.txt`,'synthetic owner file; preserve bytes\n',{mode:0o600});
  const freshBefore=snapshot(`${fresh}/home`);
  const freshReservation=createServer();freshReservation.listen(0,'127.0.0.1');await once(freshReservation,'listening');const freshPort=(freshReservation.address() as {port:number}).port;await new Promise<void>(resolve=>freshReservation.close(()=>resolve()));
  service=spawn(process.execPath,[path.join(extension,'build/service/main.js')],{env:{PATH:clean.PATH,HOME:`${fresh}/home`,XDG_STATE_HOME:`${fresh}/state`,TMPDIR:root,AGENT_PROGRESS_BINDING:`${fresh}/selector/binding.json`,OPENCHAMBER_SERVICE_PORT:String(freshPort),OPENCHAMBER_SERVICE_TOKEN:'fresh-fixture-only'},cwd:fresh,stdio:'ignore'});
  let freshSpawnError=false;service.once('error',()=>{freshSpawnError=true;});const freshUrl=`http://127.0.0.1:${freshPort}`;const freshHeaders={authorization:'Bearer fresh-fixture-only'};
  const freshDeadline=Date.now()+5000;let suggestions:any;
  while(Date.now()<freshDeadline){assert.equal(freshSpawnError,false);assert.equal(service.exitCode,null);try{const response=await fetch(`${freshUrl}/v1/setup`,{headers:freshHeaders,signal:AbortSignal.timeout(500)});if(response.ok){suggestions=await response.json();break;}}catch{}await new Promise(resolve=>setTimeout(resolve,25));}
  assert.equal(suggestions?.configured,false);assert.equal(suggestions.verified,false);assert.equal(suggestions.targets,null);assert.equal(Object.hasOwn(suggestions,'sourceBinding'),false);
  const suggestedConfig=`${fresh}/home/.config/opencode`,suggestedData=`${fresh}/home/.local/share/opencode`,suggestedStore=`${suggestedData}/openchamber-progress`;
  assert.deepEqual(suggestions.suggestions,{configRoot:{value:suggestedConfig,state:'resolved'},dataRoot:{value:suggestedData,state:'resolved'},storeRoot:{value:suggestedStore,state:'resolved'}});
  const inspected=await fetch(`${freshUrl}/v1/setup/inspect`,{method:'POST',headers:{...freshHeaders,'content-type':'application/json'},body:JSON.stringify({configRoot:suggestedConfig+'//',dataRoot:suggestedData+'/',storeRoot:suggestedStore+'/',confirmed:false})});assert.equal(inspected.status,200);
  const review=await inspected.json();assert.equal(review.verified,false);assert.equal(Object.hasOwn(review,'suggestions'),false);assert.deepEqual(review.targets,{configRoot:suggestedConfig,dataRoot:suggestedData,storeRoot:suggestedStore});
  assert.deepEqual(snapshot(`${fresh}/home`),freshBefore,'packaged GET/inspect must preserve setup targets byte/mtime');assert.equal(existsSync(suggestedStore),false);assert.equal(existsSync(`${fresh}/selector/binding.json`),false);
  const freshExit=once(service,'exit');service.kill('SIGTERM');await freshExit;service=undefined;
  console.log(JSON.stringify({packagedSetupSuggestions:true,packagedInspectReadOnly:true,targetBytesAndMtimesPreserved:true,foreignFilesPreserved:true,suggestionsAreNotIdentity:true}));

  // Execute the companion extracted from its transport, not a source-tree import.
  const unpacked=`${root}/unpacked`;mkdirSync(unpacked);
  assert.equal(spawnSync('unzip',['-q',`${companion}.zip`,'-d',unpacked],{stdio:'pipe'}).status,0);
  const cli=path.join(unpacked,'build/setup/main.js');
  const flags=[`--config-root=${root}/config/opencode`,`--data-root=${root}/data/opencode`,`--store-root=${root}/store`,'--confirm=true'];
  const userConfig=`${root}/config/opencode/opencode.json`;writeFileSync(userConfig,'{"fixture":"unrelated user file"}\n');const original=readFileSync(userConfig);
  const dry=JSON.parse(run([cli,'dry-run',...flags]));assert.equal(dry.writes,false);assert.equal(existsSync(`${root}/store/progress.sqlite`),false);
  const install=JSON.parse(run([cli,'install',...flags]));assert.equal(install.version,version);assert.equal(install.activation,'reload-required');
  const packageRoot=`${root}/config/opencode/plugins/agent-progress`;
  const binding=JSON.parse(readFileSync(`${packageRoot}/progress-binding.json`,'utf8'));
  assert.equal(binding.version,version);assert.equal(binding.protocolVersion,VERSION);assert.equal(binding.schemaVersion,VERSION);
  assert.equal(JSON.parse(readFileSync(`${packageRoot}/package.json`,'utf8')).version,version);
  console.log(run(['--experimental-strip-types',path.resolve('scripts/package-guidance.ts'),root,version]));
  const db=`${root}/store/progress.sqlite`;
  const store=new Store(db);let history:number;
  try {history=store.history(binding.source.id,'packaged').data.length;assert.ok(history>0);}finally{store.close();}
  const update=JSON.parse(run([cli,'update',...flags]));assert.equal(update.version,version);
  const ownership=JSON.parse(readFileSync(`${packageRoot}/.ownership.json`,'utf8'));
  for(const release of Object.values(ownership.releases) as {version:string}[])assert.equal(release.version,version);
  assert.equal(JSON.parse(run([cli,'disable',...flags])).captureEnabled,false);
  const disabled=new Store(db);try {assert.equal(disabled.list().captureEnabled,false);assert.equal(disabled.history(binding.source.id,'packaged').data.length,history);}finally{disabled.close();}
  assert.equal(JSON.parse(run([cli,'enable',...flags])).captureEnabled,true);
  // Launch the packaged extension service with its own descriptor and empty env.
  const localExtension=`${root}/extension`;cpSync(extension,localExtension,{recursive:true});
  cpSync(`${packageRoot}/progress-binding.json`,`${localExtension}/build/service/progress-binding.json`);
  const reservation=createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');const port=(reservation.address()as {port:number}).port;await new Promise<void>(resolve=>reservation.close(()=>resolve()));
  service=spawn(process.execPath,[`${localExtension}/build/service/main.js`],{env:{...clean,OPENCHAMBER_SERVICE_PORT:String(port),OPENCHAMBER_SERVICE_TOKEN:'fixture-only'},stdio:'ignore'});
  let spawnError=false;service.once('error',()=>{spawnError=true;});
  const headers={authorization:'Bearer fixture-only'};const url=`http://127.0.0.1:${port}`;
  const deadline=Date.now()+5000;let health:any;
  while(Date.now()<deadline) {assert.equal(spawnError,false);assert.equal(service.exitCode,null);try {const response=await fetch(`${url}/health`,{headers,signal:AbortSignal.timeout(500)});if(response.ok){health=await response.json();break;}}catch{}await new Promise(resolve=>setTimeout(resolve,25));}
  assert.equal(health?.ready,true);assert.equal(health.protocolVersion,VERSION);
  assert.equal((await fetch(`${url}/health`)).status,401);
  const setup=await(await fetch(`${url}/v1/setup`,{headers})).json();assert.equal(setup.version,version);assert.notEqual(setup.activation,'reload-required');
  const serviceUpdate=await fetch(`${url}/v1/setup/update`,{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({confirmed:true})});
  assert.equal(serviceUpdate.status,200);assert.equal((await serviceUpdate.json()).version,version);
  // Replace the entire extension folder/ZIP content; stable state must survive.
  let previousExit=once(service,'exit');service.kill('SIGTERM');await previousExit;service=undefined;
  rmSync(localExtension,{recursive:true});cpSync(extension,localExtension,{recursive:true});
  assert.equal(existsSync(`${localExtension}/build/service/progress-binding.json`),false);
  service=spawn(process.execPath,[`${localExtension}/build/service/main.js`],{env:{...clean,OPENCHAMBER_SERVICE_PORT:String(port),OPENCHAMBER_SERVICE_TOKEN:'fixture-only'},stdio:'ignore'});
  const restartDeadline=Date.now()+5000;let restarted=false;
  while(Date.now()<restartDeadline){assert.equal(service.exitCode,null);try{const response=await fetch(`${url}/v1/setup`,{headers,signal:AbortSignal.timeout(500)});if(response.ok){const state=await response.json();assert.equal(state.configured,true);assert.notEqual(state.activation,'reload-required');restarted=true;break;}}catch(e){if((e as Error).name==='AssertionError')throw e;}await new Promise(resolve=>setTimeout(resolve,25));}
  assert.equal(restarted,true,'packaged service did not preserve setup after replacement');
  const plans=await(await fetch(`${url}/v1/plans`,{headers})).json();assert.equal(plans.data[0].id,'packaged');assert.equal(plans.schemaVersion,VERSION);assert.equal(plans.storeId,binding.storeId);
  chmodSync(db,0o000);
  const unavailable=await fetch(`${url}/health`,{headers});assert.equal(unavailable.status,503);assert.deepEqual(await unavailable.json(),{error:'storage'});
  const configuredFailure=await(await fetch(`${url}/v1/setup`,{headers})).json();assert.equal(configuredFailure.configured,true);assert.ok(configuredFailure.diagnostics.includes('storage'));
  chmodSync(db,0o600);assert.equal((await(await fetch(`${url}/health`,{headers})).json()).ready,true);
  // The installed standalone removal entry must work after extension absence.
  const exit=once(service,'exit');service.kill('SIGTERM');await exit;service=undefined;rmSync(localExtension,{recursive:true});
  assert.equal(JSON.parse(run([`${packageRoot}/remove.js`,'remove-capture'])).historyRetained,true);
  const retained=new Store(db);try{assert.equal(retained.list().captureEnabled,false);assert.equal(retained.history(binding.source.id,'packaged').data.length,history);}finally{retained.close();}
  assert.equal(existsSync(packageRoot),false);assert.deepEqual(readFileSync(userConfig),original);
  console.log(JSON.stringify({packagedLifecycle:['dry-run','install','update','disable','enable','remove-capture'],historyRetained:true,userFilesUnchanged:true,packagedService:true,packagedServiceRecovery:true,extensionReplacementPreservesSetup:true,reloadSatisfied:true,versionAgreement:true}));

  if(process.env.AGENT_PROGRESS_HOST_MODULE) {
    console.log(run(['--experimental-strip-types',path.resolve('scripts/verify-host-package.ts'),extension],{env:{...clean,AGENT_PROGRESS_HOST_MODULE:process.env.AGENT_PROGRESS_HOST_MODULE}}));
  }else console.log(JSON.stringify({actualHostInstaller:'not-run; set AGENT_PROGRESS_HOST_MODULE for host gate'}));
}finally {
  if(service&&service.exitCode===null&&!service.signalCode){const exit=once(service,'exit');service.kill('SIGTERM');const timer=setTimeout(()=>service?.kill('SIGKILL'),3000);try{await exit;}finally{clearTimeout(timer);}}
  rmSync(root,{recursive:true,force:true});
}
