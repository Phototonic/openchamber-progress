/** Disposable actual-web-host acceptance. Dependencies are provisioned before isolation. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { networkInterfaces } from 'node:os';
import { createHash } from 'node:crypto';
import { OpenCode } from '@opencode/client';
import { isolatedEnvironment } from './managed.ts';
import { managedBindingFile, readManagedBinding, managedExpectationFile } from '../../shared/managed-binding.ts';
import { Store } from '../../shared/store.ts';
import { lifecycle } from '../../setup/lifecycle.ts';
import { managedBrowser } from '../browser/managed-companion-qa.ts';
import { requireRuntimeVersion } from './runtime-version.ts';

const arg=(name:string)=>{const i=process.argv.indexOf(name);return i<0?undefined:process.argv[i+1];};
const hostModule=arg('--host-module'),binary=arg('--opencode-binary'),chromium=arg('--chromium'),artifacts=arg('--artifacts');
assert.ok(hostModule&&binary&&chromium&&artifacts,'explicit --host-module, --opencode-binary, --chromium and --artifacts required');
for(const file of [hostModule,binary,chromium])assert.ok(path.isAbsolute(file)&&fs.statSync(file).isFile(),'explicit provisioned file required');
const serverEntry=path.basename(hostModule)==='install.js'?path.resolve(path.dirname(hostModule),'../../index.js'):hostModule;
assert.equal(JSON.parse(fs.readFileSync(path.resolve(path.dirname(serverEntry),'../package.json'),'utf8')).version,'2.7.1');
const output=path.resolve(artifacts);fs.mkdirSync(output,{recursive:true});
const hashes=()=>Object.fromEntries(['build/service/main.js','build/setup/main.js','build/companion/index.js','build/companion/SKILL.md','build/companion/package.json','background/main.js',...['panel','status','page'].map(s=>`ui/${s}/main.js`)].map(file=>[file,createHash('sha256').update(fs.readFileSync(file)).digest('hex')]));
const write=(name:string,value:unknown)=>fs.writeFileSync(`${output}/${name}.json`,JSON.stringify(value,null,2)+'\n');

if(arg('--server-worker')) {
  // Restarts use a fresh importer/process, not mutable module-level host state.
  let ownedServer:any,stopping=false;
  process.once('SIGTERM',async()=>{if(stopping)return;stopping=true;await ownedServer?.stop();process.exit(0);});
  try {
    const {startWebUiServer}=await import(pathToFileURL(serverEntry).href);
    ownedServer=await startWebUiServer({port:0,host:'127.0.0.1',apiOnly:false,attachSignals:false});
    for(const end=Date.now()+90000;!ownedServer.isReady();){assert.ok(Date.now()<end,'owned host readiness');await new Promise(r=>setTimeout(r,50));}
    const info=ownedServer.getOpenCodeProcessInfo();assert.equal(info.managed,true);
    fs.writeFileSync(arg('--server-worker')!,JSON.stringify({webPort:ownedServer.getPort(),nativePid:info.pid,nativePort:info.port}));
  }catch{fs.writeFileSync(arg('--server-worker')!,JSON.stringify({failed:true}));await ownedServer?.stop().catch(()=>{});process.exit(1);}
}else if(!arg('--worker')) {
  const root=fs.mkdtempSync('/tmp/opencode/managed-companion-host-');
  let child:ReturnType<typeof spawn>|undefined;
  try {
    const env=isolatedEnvironment(root);
    const version=spawnSync(binary,['--version'],{env,encoding:'utf8',timeout:15000});assert.equal(version.status,0);assert.equal(requireRuntimeVersion('opencode',version.stdout),'2.2.7');
    assert.equal(fs.existsSync('/etc/opencode'),false,'system configuration disallows fixture');
    for(let dir=path.dirname(root);;dir=path.dirname(dir)){for(const name of ['opencode.json','opencode.jsonc','.opencode','AGENTS.md','CLAUDE.md'])assert.equal(fs.existsSync(path.join(dir,name)),false,'ancestor configuration disallows fixture');if(dir===path.dirname(dir))break;}
    for(const dir of ['project/docs/plans','config/opencode/plugins/managed-fixture','data/opencode','extension'])fs.mkdirSync(`${root}/${dir}`,{recursive:true,mode:0o700});
    const files=['package.json','build/service/main.js','build/setup/main.js',...['index.js','package.json','SKILL.md'].map(f=>`build/companion/${f}`),...['background',...['panel','status','page'].map(s=>`ui/${s}`)].flatMap(s=>[`${s}/index.html`,`${s}/main.js`])];
    for(const file of files){fs.mkdirSync(path.dirname(`${root}/extension/${file}`),{recursive:true,mode:0o700});fs.copyFileSync(file,`${root}/extension/${file}`);}
    const observer=`${root}/config/opencode/plugins/managed-fixture`;
    const build=spawnSync('bun',['build','tests/fixtures/managed-companion-observer.ts','--target=node','--format=esm',`--outfile=${observer}/index.js`],{encoding:'utf8',timeout:30000});assert.equal(build.status,0,'fixture observer build');
    fs.writeFileSync(`${observer}/package.json`,JSON.stringify({name:'synthetic-managed-observer',type:'module',exports:{'.':'./index.js'}}));
    fs.writeFileSync(`${root}/sdk.mjs`,'export function createManagedFixture(){return {}}\n');fs.writeFileSync(`${root}/events.jsonl`,'');
    fs.writeFileSync(`${root}/project/docs/plans/synthetic.md`,'# Managed acceptance\nTwo synthetic tasks.\n');
    // Fixture workspace metadata only; no extension registration or binding is pre-seeded.
    for(const dir of [`${root}/home/.config/openchamber`,`${root}/config/openchamber`]){fs.mkdirSync(dir,{recursive:true,mode:0o700});fs.writeFileSync(`${dir}/settings.json`,JSON.stringify({projects:[{id:'fixture-project',path:`${root}/project`,label:'Synthetic project',addedAt:1,lastOpenedAt:1}],activeProjectId:'fixture-project'}));}
    const log=fs.openSync(`${root}/worker.log`,'w');
    try{child=spawn('/usr/bin/unshare',['-Urn','/bin/sh','-ec','/usr/sbin/ip link set lo up; test -z "$(/usr/sbin/ip route show default)"; exec "$@"','managed-fixture',process.execPath,'--experimental-strip-types',fileURLToPath(import.meta.url),...process.argv.slice(2),'--worker',root,'--parent-network',fs.readlinkSync('/proc/self/ns/net')],{cwd:process.cwd(),env:{...env,OPENCODE_BINARY:binary,OPENCHAMBER_RELAY_HOST:'off',MANAGED_FIXTURE_ROOT:root},detached:true,stdio:['ignore',log,log]});}finally{fs.closeSync(log);}
    const kill=()=>{try{process.kill(-child!.pid!,'SIGKILL');}catch(e){if((e as NodeJS.ErrnoException).code!=='ESRCH')throw e;}};
    const timer=setTimeout(kill,850000);let code:number|null;
    try{[code]=await once(child,'exit');}finally{clearTimeout(timer);kill();}
    assert.equal(code,0,'managed host acceptance failed; see fixed-stage results');
  }finally{
    if(child?.pid)try{process.kill(-child.pid,'SIGKILL');}catch(e){if((e as NodeJS.ErrnoException).code!=='ESRCH')throw e;}
    const owned=fs.existsSync(`${root}/owned-pids.json`)?JSON.parse(fs.readFileSync(`${root}/owned-pids.json`,'utf8')) as number[]:[];
    for(const pid of owned){
      if(!fs.existsSync(`/proc/${pid}/environ`))continue;
      // Check the exact synthetic HOME before signaling a recorded owned child.
      const vars=fs.readFileSync(`/proc/${pid}/environ`,'utf8').split('\0');assert.ok(vars.includes(`HOME=${root}/home`),'refuse uncertain process identity');
      process.kill(pid,'SIGKILL');
    }
    const remaining=owned.filter(pid=>fs.existsSync(`/proc/${pid}`));
    write('cleanup',{ownedProcessGroupGone:!child?.pid||(()=>{try{process.kill(-child.pid,0);return false;}catch{return true;}})(),remainingOwnedProcesses:remaining.length,remainingOwnedListeners:remaining.length===0?0:'unknown',liveProfilesUsed:false});
    fs.rmSync(root,{recursive:true,force:true});assert.equal(remaining.length,0,'owned process cleanup incomplete');
  }
}else {
  const root=arg('--worker')!,env=process.env,extension=`${root}/extension`,id='agent-progress-probe';
  assert.notEqual(fs.readlinkSync('/proc/self/ns/net'),arg('--parent-network'));assert.deepEqual(Object.keys(networkInterfaces()),['lo']);
  assert.equal(env.HOME,`${root}/home`);assert.equal(env.AGENT_PROGRESS_BINDING,undefined);assert.equal(env.OPENCODE_CONFIG,undefined);assert.equal(env.OPENCODE_CONFIG_CONTENT,undefined);
  assert.equal(fs.existsSync(managedBindingFile(env)),false,'normal discovery has no pre-seeded descriptor');
  const results:any={host:'2.7.1',opencode:'2.2.7',node:process.version,scope:'Linux web, rootless loopback namespace, credential-free scripted provider',bundles:hashes(),checks:[],pass:false};
  const check=(id:string,pass:boolean)=>{results.checks.push({id,pass});assert.ok(pass,id);};
  const wait=async<T>(fn:()=>Promise<T>,ok:(v:T)=>boolean,label:string,ms=20000)=>{for(const end=Date.now()+ms;;){let v:T|undefined;try{v=await fn();}catch{}if(v!==undefined&&ok(v))return v;assert.ok(Date.now()<end,label);await new Promise(r=>setTimeout(r,50));}};
  let server:any,browser:Awaited<ReturnType<typeof managedBrowser>>|undefined,plain:ReturnType<typeof spawn>|undefined,store:Store|undefined,phase='host-start';
  const owned:number[]=[];
  const remember=(pid:number)=>{owned.push(pid);fs.writeFileSync(`${root}/owned-pids.json`,JSON.stringify(owned));};
  const records=()=>fs.readFileSync(`${root}/events.jsonl`,'utf8').trim().split('\n').filter(Boolean).map(s=>JSON.parse(s));
  try {
    const {startWebUiServer}=await import(pathToFileURL(serverEntry).href);
    server=await startWebUiServer({port:0,host:'127.0.0.1',apiOnly:false,attachSignals:false});
    await wait(async()=>server.isReady(),Boolean,'actual web host ready',100000);
    const info=server.getOpenCodeProcessInfo();assert.equal(info.managed,true);remember(info.pid);
    const raw=Object.fromEntries(fs.readFileSync(`/proc/${info.pid}/environ`,'utf8').split('\0').filter(Boolean).map(v=>{const i=v.indexOf('=');return[v.slice(0,i),v.slice(i+1)];}));
    assert.equal(raw.HOME,env.HOME);assert.equal(raw.XDG_DATA_HOME,env.XDG_DATA_HOME);assert.equal(raw.AGENT_PROGRESS_BINDING,undefined);
    const headers={authorization:`Basic ${Buffer.from(`opencode:${raw.OPENCODE_PASSWORD||raw.OPENCODE_SERVER_PASSWORD}`).toString('base64')}`};
    const client=OpenCode.make({baseUrl:`http://127.0.0.1:${info.port}`,headers}),location={directory:`${root}/project`},url=`http://127.0.0.1:${server.getPort()}`;
    const inventory=()=>client.plugin.list({location} as any,{signal:AbortSignal.timeout(3000)});
    const active=()=>wait(inventory,v=>v.data.some(p=>p.id==='agent-progress'&&p.state.status==='active'),'managed plugin active');
    const absent=()=>wait(inventory,v=>!v.data.some(p=>p.id==='agent-progress'),'managed plugin retired');
    const reload=async()=>{
      // The web UI creates blank draft sessions before their chat directories.
      // Materialize only paths returned by the owned native session inventory,
      // fenced to this fixture's host chat root, before a native location reload.
      const sessions=await client.session.list({limit:100},{signal:AbortSignal.timeout(3000)});
      for(const s of sessions.data){const directory=s.location.directory;if(directory.startsWith(`${root}/home/.config/openchamber/chats/`)){assert.equal(path.resolve(directory),directory);fs.mkdirSync(directory,{recursive:true,mode:0o700});}}
      for(const directory of browser?.observedChatDirectories()??[]){assert.equal(path.resolve(directory),directory);assert.ok(directory.startsWith(`${root}/home/.config/openchamber/chats/`));fs.mkdirSync(directory,{recursive:true,mode:0o700});}
      const r=await fetch(`http://127.0.0.1:${info.port}/api/location/reload?${new URLSearchParams({'location[directory]':location.directory})}`,{method:'POST',headers:{...headers,'content-type':'application/json'},body:'{}',signal:AbortSignal.timeout(15000)});if(!r.ok){const body=await r.json().catch(()=>({}));write('reload-failure',{status:r.status,type:typeof body.type==='string'?body.type:null,message:typeof body.message==='string'?body.message.replaceAll(root,'<fixture>').split('\n')[0].slice(0,256):null});}assert.ok(r.ok,`explicit owned location reload status-${r.status}`);await r.arrayBuffer();
    };
    const api=async(method:string,route:string,body?:unknown)=>{const r=await fetch(url+route,{method,headers:{'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)});assert.ok(r.ok,'owned host request');const text=await r.text();return text?JSON.parse(text):null;};
    const service=async(route:string,body?:unknown)=>{const r=await api('POST',`/api/guests/${id}/service/request`,{method:body===undefined?'GET':'POST',path:route,...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:r.status,body:JSON.parse(r.body)};};
    const action=async(name:string)=>{const review=await service('/v1/setup/managed-inspect',{});assert.equal(review.status,200);return service(`/v1/setup/${name}`,{confirmed:true,expected:review.body.delivery.review.expected});};
    const prompt=async(sessionID:string,step?:unknown)=>{if(step)fs.writeFileSync(`${root}/step.json`,JSON.stringify(step));await client.session.prompt({sessionID,text:'Run the synthetic local fixture.'},{signal:AbortSignal.timeout(15000)});await client.session.wait({sessionID},{signal:AbortSignal.timeout(20000)});};
    const session=(title:string,permissions:any[]=[{action:'*',resource:'*',effect:'allow'}])=>client.session.create({location,agent:'build',title,model:{providerID:'managed-fixture',id:'script'},permissions});
    await wait(inventory,v=>v.data.some(p=>p.id==='managed-fixture-observer'&&p.state.status==='active'),'scripted observer active');check('no-credentials',(await client.credential.list()).length===0);
    await session('Setup fixture');
    phase='real-ui-install-approval';browser=await managedBrowser({chromium,root,artifacts:output,url});await browser.install(extension);await active();
    check('approval-before-configuration',(await service('/v1/setup')).body.delivery.configuration==='unconfigured'&&!fs.existsSync(managedBindingFile(env)));
    phase='real-ui-configuration';await browser.configure();const b=readManagedBinding(env);assert.ok(b);store=new Store(b.database);
    phase='scripted-report-three-views';const main=await session('Managed acceptance');await browser.selectSession('Managed acceptance');
    await prompt(main.id,{name:'agent_progress_report',input:{op:'start',plan:'P-managed',oid:'start',rev:0,title:'Managed acceptance plan',source:'docs/plans/synthetic.md',items:[{id:'a',title:'First task',kind:'task',status:'done'},{id:'b',title:'Second task',kind:'task',status:'working'}]}});
    check('real-session-report',store.get(b.source.id,'P-managed')?.revision===1);results.views=[await browser.views(1,2,1)];
    await prompt(main.id,{name:'agent_progress_report',input:{op:'change',plan:'P-managed',oid:'change',rev:1,changes:[{id:'b',status:'done'}]}});check('real-session-change',store.get(b.source.id,'P-managed')?.revision===2);results.views.push(await browser.views(2,2,2));
    phase='restricted-child';const child=await client.session.create({location,parentID:main.id,agent:'build',title:'Restricted child',model:{providerID:'managed-fixture',id:'script'},permissions:[{action:'*',resource:'*',effect:'allow'},{action:'agent_progress_report',resource:'*',effect:'deny'}]});
    await prompt(child.id);const restricted=records().filter(e=>e.type==='context'&&e.session===child.id);check('restricted-child-no-authority',restricted.length>0&&restricted.every(e=>!e.reportTool&&e.guidance===0));
    phase='disable';
    await api('PUT',`/api/guests/${id}/enabled`,{enabled:false});await absent();
    const start=records().length;await prompt(main.id);check('disabled-guidance-retired',records().slice(start).filter(e=>e.type==='outgoing').every(e=>!e.reportTool&&e.guidance===0));
    phase='reenable';await api('PUT',`/api/guests/${id}/enabled`,{enabled:true});await active();
    await prompt(main.id,{name:'agent_progress_report',input:{op:'revise',plan:'P-managed',oid:'reenabled',rev:2,title:'Managed acceptance plan'}});check('reenabled-later-revision',store.get(b.source.id,'P-managed')?.revision===3);
    write('lifecycle',{disableRetired:true,reenabledRevision:3,historyRetained:true,gracefulCancellationGuaranteed:false});
    phase='same-version-integrity-warning';const original=fs.readFileSync(`${extension}/build/companion/index.js`);fs.appendFileSync(`${extension}/build/companion/index.js`,'\n// Synthetic same-version integrity fixture\n');
    // Keep the service generation/baseline running while loading changed native bytes.
    await reload();await active();
    await prompt(main.id,{name:'agent_progress_report',input:{op:'revise',plan:'P-managed',oid:'warning-report',rev:3,title:'Managed acceptance plan'}});
    const warning=await service('/v1/setup');check('integrity-warns-and-reports',warning.body.delivery.observation==='different'&&store.get(b.source.id,'P-managed')?.revision===4);
    await browser.warning();write('integrity',{sameVersion:true,observation:warning.body.delivery.observation,authorizedRevision:4,warningOnly:true});fs.writeFileSync(`${extension}/build/companion/index.js`,original);
    phase='plain-terminal-reach';const plainEnv:NodeJS.ProcessEnv={...env,OPENCODE_PASSWORD:'synthetic-plain-only'};delete plainEnv.OPENCODE_CONFIG;delete plainEnv.OPENCODE_CONFIG_CONTENT;
    plain=spawn(binary,['serve','--hostname','127.0.0.1','--port','18768'],{cwd:`${root}/project`,env:plainEnv,stdio:'ignore'});remember(plain.pid!);
    const plainClient=OpenCode.make({baseUrl:'http://127.0.0.1:18768',headers:{authorization:`Basic ${Buffer.from('opencode:synthetic-plain-only').toString('base64')}`}});
    const plainList=await wait(()=>plainClient.plugin.list({location} as any),v=>v.data.some(p=>p.id==='managed-fixture-observer'&&p.state.status==='active'),'plain runtime warm');check('plain-terminal-lacks-managed-plugin',!plainList.data.some(p=>p.id==='agent-progress'));
    const plainExit=once(plain,'exit');plain.kill('SIGTERM');await plainExit;plain=undefined;
    phase='remove-retain-history';await api('DELETE',`/api/guests/${id}`);await absent();check('removed-history-retained',store.get(b.source.id,'P-managed')?.revision===4);store.close();store=undefined;
    const retained=new Store(b.database,{readOnly:true});try{check('removed-read-only-history',retained.history(b.source.id,'P-managed').data.length===4);}finally{retained.close();}
    check('no-remote-provider-access',!records().some(e=>e.type==='forbidden-http'));check('no-uncaught-browser-exceptions',browser.console().exceptions===0);
    phase='legacy-coexistence-and-migration';
    const targets={configRoot:b.source.configRoot,dataRoot:b.source.dataRoot,storeRoot:path.dirname(b.database),confirmed:true};
    const payload={plugin:original.toString(),guidance:fs.readFileSync(`${extension}/build/companion/SKILL.md`,'utf8'),removal:fs.readFileSync(`${extension}/build/setup/main.js`,'utf8'),version:JSON.parse(fs.readFileSync(`${extension}/package.json`,'utf8')).version};
    const register=async()=>{await api('POST','/api/guests',{path:extension});const rows=await api('GET','/api/guests');await api('PUT',`/api/guests/${id}/capabilities`,{granted:rows.guests.find((g:any)=>g.id===id).capabilities.requested});};
    lifecycle('install',targets,payload);await reload();await active();
    await register();await prompt(main.id,{name:'agent_progress_report',input:{op:'start',plan:'P-legacy',oid:'legacy-start',rev:0,title:'Synthetic legacy capture',source:'docs/plans/synthetic.md',items:[{id:'a',title:'Legacy task',kind:'task',status:'working'}]}});
    const legacyRead=new Store(b.database,{readOnly:true});
    try{check('legacy-one-real-capture',Number(legacyRead.db.prepare('SELECT count(*) AS n FROM captures WHERE plan=?').get('P-legacy')!.n)===1);}finally{legacyRead.close();}
    check('legacy-not-managed-success',(await service('/v1/setup')).body.delivery.migration==='available');
    await browser.setupShot('legacy-migration','[data-testid="setup-migrate"]');
    const legacyRoot=`${targets.configRoot}/plugins/agent-progress`,ownership=`${legacyRoot}/.ownership.json`,ownedBytes=fs.readFileSync(ownership);
    fs.writeFileSync(ownership,'modified synthetic ownership');
    try{
      check('modified-ownership-refused',(await action('managed-migrate')).status===409&&(await service('/v1/setup')).body.delivery.migration==='conflict');
      check('conflict-enable-refused',(await action('managed-enable')).status===409);
      await browser.setupShot('conflict-capture-off-review-available','[data-testid="setup-disable"]');
      check('conflict-confirmed-capture-off',(await action('managed-disable')).status===200&&(await service('/v1/setup')).body.captureEnabled===false);
      check('modified-files-not-repaired',fs.readFileSync(ownership,'utf8')==='modified synthetic ownership');
    }finally{fs.writeFileSync(ownership,ownedBytes);}
    lifecycle('remove-capture',targets);
    const otherTargets={...targets,storeRoot:`${root}/other-store`};lifecycle('install',otherTargets,payload);
    const other=new Store(`${root}/other-store/progress.sqlite`,{readOnly:true});const otherBefore=other.list().captureEnabled;other.close();const selectorBefore=fs.readFileSync(managedBindingFile(env)),otherOwned=fs.readFileSync(ownership);
    check('different-store-refused',(await action('managed-migrate')).status===409);
    check('different-store-selection-preserved',fs.readFileSync(managedBindingFile(env)).equals(selectorBefore)&&fs.readFileSync(ownership).equals(otherOwned));
    const otherAfter=new Store(`${root}/other-store/progress.sqlite`,{readOnly:true});try{check('different-store-capture-preserved',otherAfter.list().captureEnabled===otherBefore);}finally{otherAfter.close();}
    lifecycle('remove-capture',otherTargets);lifecycle('install',targets,payload);await reload();
    // Corrupt only fixture-owned expectation metadata. Feasibility must now fail
    // before disabling capture or removing verified legacy discovery.
    // Restore the exact known fixture bytes as explicit test-side operator recovery.
    const expectationFile=managedExpectationFile(b),expectationBytes=fs.readFileSync(expectationFile),captureBefore=(await service('/v1/setup')).body.captureEnabled;let partial:{status:number;body:any};
    fs.writeFileSync(expectationFile,'invalid synthetic expectation');
    try{partial=await action('managed-migrate');}finally{fs.writeFileSync(expectationFile,expectationBytes);}
    check('expectation-preflight-preserves-legacy',[409,503].includes(partial.status)&&(await service('/v1/setup')).body.delivery.migration==='available'&&(await service('/v1/setup')).body.captureEnabled===captureBefore&&fs.existsSync(legacyRoot));
    await browser.setupShot('migration-preflight','[data-testid="setup-migrate"]');
    const switched=await action('managed-migrate');check('same-target-explicit-retry',switched.status===200&&switched.body.delivery.migration==='complete');
    const selected=readManagedBinding(env);assert.ok(selected);check('migration-retains-store-source',selected.storeId===b.storeId&&selected.source.id===b.source.id&&!fs.existsSync(legacyRoot));
    await reload();await active();await prompt(main.id,{name:'agent_progress_report',input:{op:'revise',plan:'P-managed',oid:'migrated',rev:4,title:'Managed acceptance plan'}});
    const migratedRead=new Store(selected.database,{readOnly:true});try{check('migration-retains-history',migratedRead.get(b.source.id,'P-managed')?.revision===5&&migratedRead.get(b.source.id,'P-legacy')?.revision===1);}finally{migratedRead.close();}
    write('migration',{legacyOneCapture:true,modifiedOwnershipRefused:true,differentStoreRefusedWithoutSelectionChange:true,preflightStatus:partial.status,expectationFailureBoundary:'before-capture-disable-and-legacy-removal',fixtureOperatorRecovery:'restored exact known expectation bytes',sameTargetExplicitRetry:true,storeSourceRetained:true,historyRetained:true,postRemovalPublicationFailure:'portable migration regression; not injected into host',midUnlinkConflict:'portable lifecycle regression; not injected into host removal'});
    await browser.setupShot('migrated','[data-testid="setup-disable"]');
    // Do the held-session race last in this native generation: the documented
    // cancellation caveat can also leave native location reload unavailable.
    phase='disable-held-permission';const held=await session('Held permission',[{action:'*',resource:'*',effect:'allow'},{action:'read',resource:'*',effect:'ask'}]);
    fs.writeFileSync(`${root}/step.json`,JSON.stringify({name:'agent_progress_report',input:{op:'start',plan:'P-held',oid:'held',rev:0,title:'Held report',source:'docs/plans/synthetic.md',items:[{id:'a',title:'Held work',kind:'task'}]}}));
    await client.session.prompt({sessionID:held.id,text:'Run the synthetic held report.'});const permission=await wait(()=>client.permission.list({sessionID:held.id}),v=>v.length>0,'document permission held');
    await api('PUT',`/api/guests/${id}/enabled`,{enabled:false});await absent();await client.permission.reply({sessionID:held.id,requestID:permission[0].id,decision:'once'}).catch(()=>{});
    let interruption=false;try{await client.session.wait({sessionID:held.id},{signal:AbortSignal.timeout(5000)});}catch{interruption=true;await client.session.interrupt({sessionID:held.id,resume:false}).catch(()=>{});}
    const heldRead=new Store(selected.database,{readOnly:true});try{check('no-late-held-report',heldRead.get(b.source.id,'P-held')===undefined);check('no-late-held-capture',Number(heldRead.db.prepare('SELECT count(*) AS n FROM captures WHERE plan=?').get('P-held')!.n)===0);}finally{heldRead.close();}
    await api('PUT',`/api/guests/${id}/enabled`,{enabled:true});await active();await prompt(main.id,{name:'agent_progress_report',input:{op:'revise',plan:'P-managed',oid:'after-held',rev:5,title:'Managed acceptance plan'}});
    await api('DELETE',`/api/guests/${id}`);await absent();const finalRead=new Store(selected.database,{readOnly:true});try{check('held-reenable-remove-retains-history',finalRead.get(b.source.id,'P-managed')?.revision===6);}finally{finalRead.close();}
    write('lifecycle',{disableRetired:true,reenabledRevision:3,firstRemovalRetainedRevision:4,migrationRetainedRevision:5,heldReportCommitted:false,heldCaptureCommitted:false,sessionInterrupted:interruption,heldReenabledRevision:6,removalRetainedHistory:true,gracefulCancellationGuaranteed:false});

    check('no-uncaught-final-browser-exceptions',browser.console().exceptions===0);
    phase='caller-owned-config-fallback';results.screenshots=browser.screenshots();await browser.stop();browser=undefined;await server.stop();server=undefined;
    const caller=`${root}/caller-config.json`;fs.writeFileSync(caller,'{}',{mode:0o600});process.env.OPENCODE_CONFIG=caller;
    let fallbackClient!:ReturnType<typeof OpenCode.make>,fallbackUrl:string;
    let restart=0;
    const startFallback=async()=>{
      const infoFile=`${root}/fallback-${restart++}.json`;
      const child=spawn(process.execPath,['--experimental-strip-types',fileURLToPath(import.meta.url),...process.argv.slice(2),'--server-worker',infoFile],{env:{...env,OPENCODE_CONFIG:caller},stdio:'ignore'});remember(child.pid!);
      server={stop:async()=>{if(child.exitCode!==null||child.signalCode)return;const done=once(child,'exit');child.kill('SIGTERM');const timer=setTimeout(()=>child.kill('SIGKILL'),5000);try{await done;}finally{clearTimeout(timer);}}};
      await Promise.race([wait(async()=>fs.existsSync(infoFile),Boolean,'owned fallback host ready',100000),once(child,'exit').then(()=>{throw new Error('owned fallback host exited before readiness');})]);
      const ownedInfo=JSON.parse(fs.readFileSync(infoFile,'utf8'));assert.equal(ownedInfo.failed,undefined,'owned fallback host startup failed');remember(ownedInfo.nativePid);
      const vars=Object.fromEntries(fs.readFileSync(`/proc/${ownedInfo.nativePid}/environ`,'utf8').split('\0').filter(Boolean).map(v=>{const i=v.indexOf('=');return[v.slice(0,i),v.slice(i+1)];}));assert.equal(vars.HOME,env.HOME);assert.equal(vars.OPENCODE_CONFIG,caller);
      fallbackClient=OpenCode.make({baseUrl:`http://127.0.0.1:${ownedInfo.nativePort}`,headers:{authorization:`Basic ${Buffer.from(`opencode:${vars.OPENCODE_PASSWORD||vars.OPENCODE_SERVER_PASSWORD}`).toString('base64')}`}});fallbackUrl=`http://127.0.0.1:${ownedInfo.webPort}`;
      await wait(()=>fallbackClient.plugin.list({location} as any),v=>v.data.some(p=>p.id==='managed-fixture-observer'&&p.state.status==='active'),'fallback observer warmed');
    };
    const fallbackApi=async(method:string,route:string,body?:unknown)=>{const r=await fetch(fallbackUrl+route,{method,headers:{'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)});assert.ok(r.ok,'owned fallback request');const text=await r.text();return text?JSON.parse(text):null;};
    const fallbackInventory=()=>fallbackClient.plugin.list({location} as any,{signal:AbortSignal.timeout(3000)});
    await startFallback();await fallbackApi('POST','/api/guests',{path:extension});const fallbackRows=await fallbackApi('GET','/api/guests');await fallbackApi('PUT',`/api/guests/${id}/capabilities`,{granted:fallbackRows.guests.find((g:any)=>g.id===id).capabilities.requested});
    check('fallback-install-awaits-explicit-restart',!(await fallbackInventory()).data.some(p=>p.id==='agent-progress'));
    await server.stop();server=undefined;await startFallback();await wait(fallbackInventory,v=>v.data.some(p=>p.id==='agent-progress'&&p.state.status==='active'),'fallback active after restart');
    const fallbackSession=await fallbackClient.session.create({location,agent:'build',title:'Synthetic fallback',model:{providerID:'managed-fixture',id:'script'},permissions:[{action:'*',resource:'*',effect:'allow'}]});
    const fallbackPrompt=async(input:unknown)=>{fs.writeFileSync(`${root}/step.json`,JSON.stringify({name:'agent_progress_report',input}));await fallbackClient.session.prompt({sessionID:fallbackSession.id,text:'Run the synthetic fallback fixture.'});await fallbackClient.session.wait({sessionID:fallbackSession.id},{signal:AbortSignal.timeout(20000)});};
    await fallbackPrompt({op:'start',plan:'P-fallback',oid:'fallback-start',rev:0,title:'Synthetic fallback plan',items:[{id:'a',title:'Fallback task',kind:'task'}]});
    await fallbackApi('PUT',`/api/guests/${id}/enabled`,{enabled:false});check('fallback-toggle-is-not-live-stop',(await fallbackInventory()).data.some(p=>p.id==='agent-progress'&&p.state.status==='active'));
    await fallbackPrompt({op:'revise',plan:'P-fallback',oid:'fallback-disabled',rev:1,title:'Synthetic fallback plan'});
    await server.stop();server=undefined;await startFallback();check('fallback-explicit-restart-retires',!(await fallbackInventory()).data.some(p=>p.id==='agent-progress'));
    const fallbackHistory=new Store(selected.database,{readOnly:true});try{check('fallback-history-retained',fallbackHistory.get(selected.source.id,'P-fallback')?.revision===2);}finally{fallbackHistory.close();}
    await fallbackApi('DELETE',`/api/guests/${id}`);check('caller-config-not-edited',fs.readFileSync(caller,'utf8')==='{}');
    check('no-final-credentials',(await fallbackClient.credential.list()).length===0);check('no-final-remote-provider-access',!records().some(e=>e.type==='forbidden-http'));
    write('fallback',{callerOwnedConfig:true,installRequiredExplicitRestart:true,disableAloneRetainedPlugin:true,disabledRuntimeCouldReport:true,explicitRestartRetired:true,callerConfigUnchanged:true,historyRetained:true});
    results.pass=true;results.phase='complete';results.limits=['Linux web only; no Windows/Electron managed-host certification','mid-unlink conflict covered by portable lifecycle regression, not host fault injection','held-permission session may require explicit interruption'];write('results',results);
  }catch(e){results.pass=false;results.phase=phase;results.failureClass=e instanceof assert.AssertionError?'assertion':'runtime';results.failure=e instanceof Error?e.message.split('\n')[0].replaceAll(root,'<fixture>').slice(0,256):'fixture failure';write('results',results);await browser?.failure();throw e;}
  finally{
    store?.close();await browser?.stop();
    if(plain&&plain.exitCode===null){const done=once(plain,'exit');plain.kill('SIGTERM');const timer=setTimeout(()=>plain?.kill('SIGKILL'),3000);try{await done;}finally{clearTimeout(timer);}}
    await server?.stop();
    // The published host retains module-level timers after stop. This is our
    // disposable worker only; do not wait for or signal any external host.
    process.exit(results.pass?0:1);
  }
}
