/** Actual web 2.7.1 update acceptance; owns only fresh HOME/XDG/network/browser roots. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import dns from 'node:dns/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { networkInterfaces } from 'node:os';
import { createHash } from 'node:crypto';
import { OpenCode } from '@opencode/client';
import { isolatedEnvironment } from './managed.ts';
import { readManagedBinding, managedBindingFile, managedExpectationFile } from '../../shared/managed-binding.ts';
import { Store } from '../../shared/store.ts';
import { nativeUpdatesBrowser } from '../browser/native-extension-updates-qa.ts';
import { requireRuntimeVersion } from './runtime-version.ts';
import { javascriptLiteral as literal } from '../../shared/javascript-literal.ts';

const arg=(name:string)=>{const i=process.argv.indexOf(name);return i<0?undefined:process.argv[i+1];};
const hostModule=arg('--host-module'),binary=arg('--opencode-binary'),chromium=arg('--chromium'),artifacts=arg('--artifacts');
assert.ok(hostModule&&binary&&chromium&&artifacts,'explicit host module, independent CLI, Chromium and artifact directory required');
for(const file of [hostModule,binary,chromium])assert.ok(path.isAbsolute(file)&&fs.statSync(file).isFile());
const serverEntry=path.basename(hostModule)==='install.js'?path.resolve(path.dirname(hostModule),'../../index.js'):hostModule;
const hostDir=path.resolve(path.dirname(serverEntry),'lib/guests');
assert.equal(JSON.parse(fs.readFileSync(path.resolve(path.dirname(serverEntry),'../package.json'),'utf8')).version,'2.7.1');
const output=path.resolve(artifacts);fs.mkdirSync(output,{recursive:true});
const write=(name:string,value:unknown)=>fs.writeFileSync(`${output}/${name}.json`,JSON.stringify(value,null,2)+'\n');
const hash=(file:string)=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const entries=['build/service/main.js','build/setup/main.js','build/companion/index.js','build/companion/package.json','build/companion/SKILL.md','background/main.js',...['panel','status','page'].map(s=>`ui/${s}/main.js`)];

if(arg('--fallback-server')) {
  let server:any,stopping=false;
  process.once('SIGTERM',async()=>{if(stopping)return;stopping=true;await server?.stop();process.exit(0);});
  try{
    const lookup=dns.lookup;dns.lookup=(async(name:string,options:any)=>name==='native-updates-fixture.example'?[{address:'93.184.216.34',family:4}]:lookup(name,options)) as typeof dns.lookup;
    const {startWebUiServer}=await import(pathToFileURL(serverEntry).href);server=await startWebUiServer({port:0,host:'127.0.0.1',apiOnly:false,attachSignals:false});
    for(const end=Date.now()+100000;!server.isReady();){assert.ok(Date.now()<end,'fallback ready');await new Promise(r=>setTimeout(r,50));}
    const info=server.getOpenCodeProcessInfo();assert.equal(info.managed,true);fs.writeFileSync(arg('--fallback-server')!,JSON.stringify({webPort:server.getPort(),nativePid:info.pid,nativePort:info.port}));
  }catch{fs.writeFileSync(arg('--fallback-server')!,JSON.stringify({failed:true}));await server?.stop();process.exit(1);}
}else if(!arg('--worker')) {
  const root=fs.mkdtempSync('/tmp/opencode/native-extension-updates-host-');let child:ReturnType<typeof spawn>|undefined;
  try {
    const env=isolatedEnvironment(root);
    assert.equal(fs.existsSync('/etc/opencode'),false,'system config disallows fixture');
    for(let dir=path.dirname(root);;dir=path.dirname(dir)){for(const name of ['opencode.json','opencode.jsonc','.opencode','AGENTS.md','CLAUDE.md'])assert.equal(fs.existsSync(path.join(dir,name)),false,'ancestor config disallows fixture');if(dir===path.dirname(dir))break;}
    const version=spawnSync(binary,['--version'],{env,encoding:'utf8',timeout:15000});assert.equal(version.status,0);assert.equal(requireRuntimeVersion('opencode',version.stdout),'2.2.7');
    for(const dir of ['project/docs/plans','config/opencode/plugins/managed-fixture','data/opencode','work'])fs.mkdirSync(`${root}/${dir}`,{recursive:true,mode:0o700});
    const tracked=spawnSync('/usr/bin/git',['ls-files','-z'],{encoding:'utf8',timeout:10000});assert.equal(tracked.status,0);
    for(const file of tracked.stdout.split('\0').filter(Boolean)){assert.ok(!path.isAbsolute(file)&&!file.split('/').includes('..'));fs.mkdirSync(path.dirname(`${root}/work/${file}`),{recursive:true});fs.copyFileSync(file,`${root}/work/${file}`);}
    const observer=`${root}/config/opencode/plugins/managed-fixture`;
    const built=spawnSync('bun',['build','tests/fixtures/managed-companion-observer.ts','--target=node','--format=esm',`--outfile=${observer}/index.js`],{encoding:'utf8',timeout:30000});assert.equal(built.status,0);
    fs.writeFileSync(`${observer}/package.json`,JSON.stringify({name:'synthetic-managed-observer',type:'module',exports:{'.':'./index.js'}}));
    fs.writeFileSync(`${root}/sdk.mjs`,'export function createManagedFixture(){return {}}\n');fs.writeFileSync(`${root}/events.jsonl`,'');
    fs.writeFileSync(`${root}/project/docs/plans/synthetic.md`,'# Managed acceptance\nTwo synthetic tasks.\n');
    for(const dir of [`${root}/home/.config/openchamber`,`${root}/config/openchamber`]){fs.mkdirSync(dir,{recursive:true,mode:0o700});fs.writeFileSync(`${dir}/settings.json`,JSON.stringify({projects:[{id:'fixture-project',path:`${root}/project`,label:'Synthetic project',addedAt:1,lastOpenedAt:1}],activeProjectId:'fixture-project'}));}
    const log=fs.openSync(`${root}/worker.log`,'w');
    try{child=spawn('/usr/bin/unshare',['-Urn','/bin/sh','-ec','/usr/sbin/ip link set lo up; test -z "$(/usr/sbin/ip route show default)"; exec "$@"','native-updates-fixture',process.execPath,'--experimental-strip-types',fileURLToPath(import.meta.url),...process.argv.slice(2),'--worker',root,'--parent-network',fs.readlinkSync('/proc/self/ns/net')],{env:{...env,OPENCODE_BINARY:binary,OPENCHAMBER_RELAY_HOST:'off',MANAGED_FIXTURE_ROOT:root,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_SYSTEM:'/dev/null',GIT_TERMINAL_PROMPT:'0',GIT_ASKPASS:'/bin/false'},detached:true,stdio:['ignore',log,log]});}finally{fs.closeSync(log);}
    const kill=()=>{try{process.kill(-child!.pid!,'SIGKILL');}catch(e){if((e as NodeJS.ErrnoException).code!=='ESRCH')throw e;}};
    const timer=setTimeout(kill,850000);let code:number|null;
    try{[code]=await once(child,'exit');}finally{clearTimeout(timer);kill();}
    assert.equal(code,0,'native update acceptance failed; see sanitized results.json');
  }finally{
    if(child?.pid)try{process.kill(-child.pid,'SIGKILL');}catch(e){if((e as NodeJS.ErrnoException).code!=='ESRCH')throw e;}
    const owned=fs.existsSync(`${root}/owned-pids.json`)?JSON.parse(fs.readFileSync(`${root}/owned-pids.json`,'utf8')) as number[]:[];
    for(const pid of owned){if(!fs.existsSync(`/proc/${pid}/environ`))continue;const vars=fs.readFileSync(`/proc/${pid}/environ`,'utf8').split('\0');assert.ok(vars.includes(`HOME=${root}/home`),'refuse uncertain process identity');try{process.kill(pid,'SIGKILL');}catch(e){if((e as NodeJS.ErrnoException).code!=='ESRCH')throw e;}}
    // Wait only for owned processes to disappear, not an arbitrary sleep.
    for(const end=Date.now()+5000;owned.some(pid=>fs.existsSync(`/proc/${pid}`))&&Date.now()<end;)await new Promise(r=>setTimeout(r,25));
    const remaining=owned.filter(pid=>fs.existsSync(`/proc/${pid}`));
    const groupGone=!child?.pid||(()=>{try{process.kill(-child.pid,0);return false;}catch{return true;}})();
    write('cleanup',{remainingOwnedProcesses:remaining.length,remainingOwnedListeners:remaining.length===0&&groupGone?0:'unknown',ownedProcessGroupGone:groupGone,rootRemoved:true,liveProfilesUsed:false});
    fs.rmSync(root,{recursive:true,force:true});assert.equal(remaining.length,0,'owned cleanup incomplete');
  }
}else {
  const root=arg('--worker')!,env=process.env,work=`${root}/work`,bare=`${root}/remote.git`,id='agent-progress-probe';
  assert.notEqual(fs.readlinkSync('/proc/self/ns/net'),arg('--parent-network'));assert.deepEqual(Object.keys(networkInterfaces()),['lo']);assert.equal(env.HOME,`${root}/home`);
  const results:any={pass:false,host:'2.7.1',scope:'Linux web; local bare Git mapping; no public Git reachability or desktop certification',checks:[],bundles:Object.fromEntries(entries.map(e=>[e,hash(e)]))};
  const check=(id:string,pass:boolean)=>{results.checks.push({id,pass});write('results',results);assert.ok(pass,id);};
  const wait=async<T>(fn:()=>Promise<T>,ok:(v:T)=>boolean,label:string,ms=20000)=>{for(const end=Date.now()+ms;;){let v:T|undefined;try{v=await fn();}catch{}if(v!==undefined&&ok(v))return v;assert.ok(Date.now()<end,label);await new Promise(r=>setTimeout(r,50));}};
  const git=(args:string[],cwd=work)=>{assert.ok(cwd===root||cwd.startsWith(root+'/'));const r=spawnSync('/usr/bin/git',['-c','credential.helper=','-c','core.hooksPath=/dev/null',...args],{cwd,env,encoding:'utf8',timeout:30000,maxBuffer:4000000});assert.equal(r.status,0,`${args[0]} failed`);return r.stdout.trim();};
  const commit=(message:string)=>{git(['add','--all']);git(['-c','user.name=Package Fixture','-c','user.email=package-fixture@example.invalid','commit','-m',message]);return git(['rev-parse','HEAD']);};
  let server:any,browser:Awaited<ReturnType<typeof nativeUpdatesBrowser>>|undefined,store:Store|undefined,phase='prepare';const owned:number[]=[];
  const remember=(pid:number)=>{owned.push(pid);fs.writeFileSync(`${root}/owned-pids.json`,JSON.stringify(owned));};
  const source='https://native-updates-fixture.example/fixture/progress.git',commands=`${root}/git-commands.jsonl`;
  const operations=()=>fs.existsSync(commands)?fs.readFileSync(commands,'utf8').trim().split('\n').filter(Boolean).map(s=>JSON.parse(s)):[];
  const fetches=()=>operations().filter(c=>c.op==='fetch').length;
  const originalLookup=dns.lookup;
  try {
    // Explicit fixture-only DNS seam; only one origin is mapped and all host
    // public-address policy executes unchanged. Namespace has no egress.
    dns.lookup=(async(name:string,options:any)=>{if(name==='native-updates-fixture.example')return [{address:'93.184.216.34',family:4}];return originalLookup(name,options);}) as typeof dns.lookup;
    git(['init','--initial-branch=main']);const manifest=JSON.parse(fs.readFileSync(`${work}/package.json`,'utf8')),baseline=manifest.version;
    const next=(n:number)=>{const [a,b,c]=baseline.split('.').map(Number);return `${a}.${b}.${c+n}`;};
    const publishRefs=(...refs:string[])=>git(['fetch','--no-tags',work,...refs.map(ref=>{const full=`refs/${ref===`v${baseline}`?'tags':'heads'}/${ref}`;return `${full}:${full}`;})],bare);
    const initial=commit('Synthetic baseline');git(['tag',`v${baseline}`]);git(['branch','dev']);git(['init','--bare','--initial-branch=main',bare],root);git(['remote','add','origin',`file://${bare}`]);publishRefs('main','dev',`v${baseline}`);
    const wrapper=`${root}/fixture-git.cjs`;
    fs.writeFileSync(wrapper,`#!${process.execPath}\n`+`
const fs=require('node:fs'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const root=${literal(root)},source=${literal(source)},bare=${literal(`file://${bare}`)},args=process.argv.slice(2);let i=0;while(args[i]==='-c')i+=2;const op=args[i];assert.ok(['clone','fetch','show'].includes(op));
if(op!=='show'){assert.ok(args.includes('http.followRedirects=false'));assert.ok(args.includes('http.curloptResolve=native-updates-fixture.example:443:93.184.216.34'));}
if(op==='clone'){const p=args.indexOf('--');assert.equal(args[p+1],source);assert.ok(args[p+2].startsWith(root+'/'));args[p+1]=bare;}
else{assert.ok(process.cwd().startsWith(root+'/'));if(op==='fetch'){assert.equal(spawnSync('/usr/bin/git',['config','--get','remote.origin.url'],{encoding:'utf8'}).stdout.trim(),bare);assert.equal(args[args.indexOf('--')+1],'origin');}else assert.deepEqual(args,['show','FETCH_HEAD:package.json']);}
fs.appendFileSync(${literal(commands)},JSON.stringify({op,ref:op==='fetch'?args.at(-1):null})+'\\n');
const r=spawnSync('/usr/bin/git',['-c','credential.helper=','-c','core.hooksPath=/dev/null',...args],{env:process.env,stdio:'inherit'});process.exit(r.status??1);
`);fs.chmodSync(wrapper,0o700);process.env.OPENCHAMBER_GIT_BINARY=wrapper;
    const buildVersion=(version:string,added=false)=>{
      const m=JSON.parse(fs.readFileSync(`${work}/package.json`,'utf8'));m.version=version;if(added)m.openchamber.contributes.capabilities=['sessions','model'];fs.writeFileSync(`${work}/package.json`,JSON.stringify(m,null,2)+'\n');
      const release=`${work}/shared/release.ts`;fs.writeFileSync(release,fs.readFileSync(release,'utf8').replace(/export const RELEASE = '[^']+'/,`export const RELEASE = '${version}'`));
      fs.symlinkSync(fileURLToPath(new URL('../../node_modules',import.meta.url)),`${work}/node_modules`,'dir');
      try{const built=spawnSync('bun',['scripts/build.ts'],{cwd:work,env,encoding:'utf8',timeout:30000});assert.equal(built.status,0,'synthetic version build');}finally{fs.rmSync(`${work}/node_modules`);}
      assert.equal(JSON.parse(fs.readFileSync(`${work}/build/companion/package.json`,'utf8')).version,version);
      const revision=commit(`Synthetic built ${version}`);publishRefs(git(['branch','--show-current']));(results.fixtureBuilds??=[]).push({version,revision,bundles:Object.fromEntries(entries.map(e=>[e,hash(`${work}/${e}`)]))});return revision;
    };
    write('versions',{host:'2.7.1',opencode:'2.2.7',node:process.version,bun:spawnSync('bun',['--version'],{encoding:'utf8',timeout:5000}).stdout.trim(),chromium:spawnSync(chromium,['--version'],{env,encoding:'utf8',timeout:5000}).stdout.trim(),sourceRevision:spawnSync('/usr/bin/git',['rev-parse','HEAD'],{encoding:'utf8',timeout:5000}).stdout.trim(),candidateBundles:results.bundles,fixtureInitialCommit:initial,seams:['fixture-only DNS and constrained Git executable mapping to local bare remote','synthetic version builds in disposable projection','local scripted provider; no paid model']});
    phase='start-host';const {startWebUiServer}=await import(pathToFileURL(serverEntry).href);server=await startWebUiServer({port:0,host:'127.0.0.1',apiOnly:false,attachSignals:false});await wait(async()=>server.isReady(),Boolean,'owned host ready',100000);
    const info=server.getOpenCodeProcessInfo();assert.equal(info.managed,true);remember(info.pid);
    const vars=Object.fromEntries(fs.readFileSync(`/proc/${info.pid}/environ`,'utf8').split('\0').filter(Boolean).map(v=>{const i=v.indexOf('=');return[v.slice(0,i),v.slice(i+1)];}));assert.equal(vars.HOME,env.HOME);
    const headers={authorization:`Basic ${Buffer.from(`opencode:${vars.OPENCODE_PASSWORD||vars.OPENCODE_SERVER_PASSWORD}`).toString('base64')}`},url=`http://127.0.0.1:${server.getPort()}`,location={directory:`${root}/project`};
    const client=OpenCode.make({baseUrl:`http://127.0.0.1:${info.port}`,headers});
    const api=async(method:string,route:string,body?:unknown)=>{const r=await fetch(url+route,{method,headers:{'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)});assert.ok(r.ok,`owned ${method} ${route} status ${r.status}`);const text=await r.text();return text?JSON.parse(text):null;};
    const service=async(route:string)=>{const r=await api('POST',`/api/guests/${id}/service/request`,{method:'GET',path:route});return {status:r.status,body:JSON.parse(r.body)};};
    const row=async()=> (await api('GET','/api/guests')).guests.find((g:any)=>g.id===id);
    const inventory=()=>client.plugin.list({location} as any,{signal:AbortSignal.timeout(3000)});
    const active=()=>wait(inventory,v=>v.data.some(p=>p.id==='agent-progress'&&p.state.status==='active'),'managed plugin active');
    await wait(inventory,v=>v.data.some(p=>p.id==='managed-fixture-observer'&&p.state.status==='active'),'observer ready');check('empty-credentials',(await client.credential.list()).length===0);
    const nativeRuntime=fs.readFileSync(`${root}/events.jsonl`,'utf8').split('\n').filter(Boolean).map(s=>JSON.parse(s)).find(e=>e.type==='observer-ready');write('native-runtime',{node:nativeRuntime?.node??null,bun:nativeRuntime?.bun??null,hostFiles:Object.fromEntries(['updates.js','install.js','routes.js'].map(f=>[f,hash(`${hostDir}/${f}`)]))});
    const session=(title:string)=>client.session.create({location,agent:'build',title,model:{providerID:'managed-fixture',id:'script'},permissions:[{action:'*',resource:'*',effect:'allow'}]});
    await session('Setup fixture');phase='real-ui-git-install';browser=await nativeUpdatesBrowser({chromium,root,artifacts:output,url});await browser.install(source);await active();
    check('unconfigured-after-install',(await service('/v1/setup')).body.delivery.configuration==='unconfigured'&&!fs.existsSync(managedBindingFile(env)));await browser.openRail();await wait(()=>browser!.guest('panel','!!document.querySelector("[data-testid=setup-inspect]")'),Boolean,'visible unconfigured Setup');await browser.shot('unconfigured-en');await browser.language('panel','ru');await browser.shot('unconfigured-ru');await browser.language('panel','en');
    await browser.configure();const binding=readManagedBinding(env);assert.ok(binding);store=new Store(binding.database);
    const main=await session('Managed acceptance');await browser.selectSession('Managed acceptance');
    const prompt=async(input:any)=>{fs.writeFileSync(`${root}/step.json`,JSON.stringify({name:'agent_progress_report',input}));await client.session.prompt({sessionID:main.id,text:'Run the synthetic local fixture.'},{signal:AbortSignal.timeout(15000)});await client.session.wait({sessionID:main.id},{signal:AbortSignal.timeout(20000)});};
    await prompt({op:'start',plan:'P-managed',oid:'start',rev:0,title:'Managed acceptance plan',source:'docs/plans/synthetic.md',items:[{id:'a',title:'First task',kind:'task',status:'done'},{id:'b',title:'Second task',kind:'task',status:'working'}]});results.beforeViews=await browser.views(1,2,1);
    for(const name of ['rail','status','board'])fs.copyFileSync(`${output}/${name}-r1.png`,`${output}/${name}-en.png`);
    await browser.language('page','ru');await browser.views(1,2,1);for(const name of ['rail','status','board'])fs.copyFileSync(`${output}/${name}-r1.png`,`${output}/${name}-ru.png`);
    const {readServicePid}=await import(pathToFileURL(`${hostDir}/service.js`).href);
    const contextsBefore=await browser.contexts(),beforeRow=await row(),serviceBefore=readServicePid(id);assert.ok(serviceBefore);remember(serviceBefore);
    const persist=`${root}/home/.config/openchamber/extensions.json`,auth=`${root}/home/.config/openchamber/guest-auth.json`;
    const {readExtensionStore}=await import(pathToFileURL(`${hostDir}/persist.js`).href);
    const {patchGuestAuth,getGuestAuth}=await import(pathToFileURL(`${hostDir}/auth-store.js`).href);
    // No shipping integration exists: seed ONLY synthetic account/settings via
    // the published store API; this does not certify OAuth or real accounts.
    await patchGuestAuth(id,{account:'Synthetic account',settings:{'fixture-choice':'retained'}},auth);const authBefore=await getGuestAuth(id,auth);let trustBefore=await readExtensionStore(persist);
    // Non-Git packages use real host install endpoints but contain no service,
    // capabilities or plugin. They are fixture-only, not product manifest edits.
    for(const kind of ['folder','zip']){
      const dir=`${root}/native-${kind}`,guestId=`native-${kind}-fixture`;fs.mkdirSync(dir);
      fs.writeFileSync(`${dir}/package.json`,JSON.stringify({name:guestId,version:'1.0.0',openchamber:{apiVersion:1,contributes:{panel:{id:guestId,name:`Native ${kind} fixture`,entry:'index.html',icon:'checkbox-circle'}}}}));fs.writeFileSync(`${dir}/index.html`,'<!doctype html><html><body>Synthetic non-Git fixture</body></html>');
      let installPath=dir;if(kind==='zip'){installPath=`${root}/native-fixture.zip`;const zipped=spawnSync('/usr/bin/zip',['-qr',installPath,'.'],{cwd:dir,env,timeout:10000});assert.equal(zipped.status,0);}
      await api('POST','/api/guests',{path:installPath});
    }
    trustBefore=await readExtensionStore(persist);
    phase='cache-browser';await browser.settings();let n=fetches();await browser.check();check('explicit-check-fetches',fetches()>n);n=fetches();await browser.close();await browser.settings();check('reopen-inside-ttl-cached',fetches()===n);const cadence:any={reopenFetches:0,explicitFetches:true,ttlMs:3600000};
    const nonGit=(await api('GET','/api/guests')).guests.filter((g:any)=>g.id.startsWith('native-'));check('folder-zip-no-git-offer',nonGit.length===2&&nonGit.every((g:any)=>g.source!=='git'&&!g.update));await browser.shot('folder-zip-no-offer');write('non-git',{cards:nonGit.map((g:any)=>({id:g.id,source:g.source,update:g.update??null})),installBoundary:'real host path/ZIP install endpoints; inert test-only packages; no Git discovery',gitEquivalentReplacementRetentionTested:false});
    // Same-version commit changes real selected-ref bytes, not version.
    fs.writeFileSync(`${work}/fixture-marker.txt`,'same-version changed bytes\n');commit('Synthetic same-version change');publishRefs('main');await browser.check();check('same-version-no-offer',!(await row()).update);
    phase='higher-version-update';const builtRevision=buildVersion(next(1));await browser.check();await browser.available();check('check-does-not-install',(await row()).version===baseline);await browser.update(next(1),false);
    check('native-update-installed',(await row()).version===next(1));assert.deepEqual(await readExtensionStore(persist),trustBefore,'grants/scopes/storage/paused unchanged');assert.deepEqual(await getGuestAuth(id,auth),authBefore);
    await browser.close();await active();const afterSetup=await service('/v1/setup'),serviceAfter=readServicePid(id);assert.ok(serviceAfter);remember(serviceAfter);check('service-generation-replaced',serviceBefore!==serviceAfter&&!fs.existsSync(`/proc/${serviceBefore}`));check('binding-retained',JSON.stringify(readManagedBinding(env))===JSON.stringify(binding));check('history-retained',store.history(binding.source.id,'P-managed').data.length===1);
    results.afterViews=await browser.views(1,2,1);const contextsAfter=await browser.contexts();
    check('device-language-retained',!!await browser.guest('page','document.querySelector("[data-testid=interface-language] button")?.textContent.includes("Русский")'));await browser.language('page','en');
    check('loaded-board-context-replaced',contextsBefore.page!==null&&contextsAfter.page!==null&&contextsBefore.page!==contextsAfter.page);
    write('lifecycle',{beforePackageRevision:beforeRow.revision??0,afterPackageRevision:(await row()).revision??0,contextsBefore,contextsAfter,managedObservation:afterSetup.body.delivery?.observation,matchingReportCounts:true,serviceGenerationReplaced:true,previousServiceExited:true,newServiceOnAccess:true,fixtureBuiltRevision:builtRevision,frameBoundary:'board continuously mounted at replacement; rail/status checked on subsequent access',callerOwnedConfig:'separate fallback.json from fresh processes after the browser journey'});
    write('retention',{samePermissions:{grants:true,scopes:true,pausedFlag:true,storageIdentity:true,syntheticAccount:true,syntheticSettings:true,privateBinding:true,history:true,deviceLanguage:true},accountInput:'published host auth-store API seed; no integration/OAuth setup',language:'real SDK device-storage preference selected in UI before update; Russian retained after remount'});
    // Exercise paused state independently: disabled remains disabled after replacement.
    await api('PUT',`/api/guests/${id}/enabled`,{enabled:false});const paused=await readExtensionStore(persist);const {updateGuest,checkAllGuestUpdates,clearGuestUpdateCache,UPDATE_CHECK_TTL_MS}=await import(pathToFileURL(`${hostDir}/updates.js`).href);const {listInstalledGuests}=await import(pathToFileURL(`${hostDir}/catalog.js`).href);
    const guest=(await listInstalledGuests({persistPath:persist})).find((g:any)=>g.id===id);assert.ok(guest);const repeated=await updateGuest({guest,origin:guest.gitOrigin,persistPath:persist,openchamberVersion:'2.7.1',gitBinary:wrapper});check('paused-explicit-module-update',repeated.ok);assert.deepEqual(await readExtensionStore(persist),paused);await api('PUT',`/api/guests/${id}/enabled`,{enabled:true});await active();
    phase='clock-seam';clearGuestUpdateCache(persist);const now=Date.now();await checkAllGuestUpdates({persistPath:persist,gitBinary:wrapper,now});n=fetches();await checkAllGuestUpdates({persistPath:persist,gitBinary:wrapper,now:now+UPDATE_CHECK_TTL_MS-1});check('module-clock-before-ttl-cached',fetches()===n);await checkAllGuestUpdates({persistPath:persist,gitBinary:wrapper,now:now+UPDATE_CHECK_TTL_MS});check('module-clock-at-ttl-fetches',fetches()>n);cadence.clockSeam={beforeBoundaryFetches:0,atBoundaryFetches:fetches()-n,elapsedBrowserHour:false};
    phase='added-capability-deferral';buildVersion(next(2),true);await browser.settings();await browser.check();await browser.update(next(2),true);await browser.defer();const deferred=await row();write('approval',{deferred:{version:deferred.version,capabilities:deferred.capabilities,enabled:deferred.enabled}});check('deferred-bytes-already-replaced',deferred.version===next(2));check('unapproved-capability-not-granted',!deferred.capabilities.granted.includes('model'));
    // Empty input is also invalid AFTER approval, so even a broken permission
    // gate cannot accidentally launch generation during this denial probe.
    const refused=await fetch(`${url}/api/guests/${id}/generate`,{method:'POST',headers:{'content-type':'application/json'},body:'{}',signal:AbortSignal.timeout(3000)}),refusal=await refused.json();check('unapproved-capability-use-refused',refused.status===400&&refusal.error==='NOT_GRANTED');
    await browser.approve();const approved=await row();check('approved-capability-granted',approved.capabilities.granted.includes('model'));write('approval',{deferred:{version:deferred.version,capabilities:deferred.capabilities,enabled:deferred.enabled,capabilityUse:{status:refused.status,error:refusal.error}},approved:{version:approved.version,capabilities:approved.capabilities},deferralIsRollback:false,generationInvoked:false});
    await browser.close();await active();await prompt({op:'change',plan:'P-managed',oid:'after-update',rev:1,changes:[{id:'b',status:'done'}]});results.finalViews=await browser.views(2,2,2);
    phase='managed-observations';
    const reload=async()=>{
      const sessions=await client.session.list({limit:100},{signal:AbortSignal.timeout(3000)});
      for(const s of sessions.data){const dir=s.location.directory;if(dir.startsWith(`${root}/home/.config/openchamber/chats/`)){assert.equal(path.resolve(dir),dir);fs.mkdirSync(dir,{recursive:true,mode:0o700});}}
      for(const dir of browser!.observedChatDirectories()){assert.ok(dir.startsWith(`${root}/home/.config/openchamber/chats/`)&&path.resolve(dir)===dir);fs.mkdirSync(dir,{recursive:true,mode:0o700});}
      const r=await fetch(`http://127.0.0.1:${info.port}/api/location/reload?${new URLSearchParams({'location[directory]':location.directory})}`,{method:'POST',headers:{...headers,'content-type':'application/json'},body:'{}',signal:AbortSignal.timeout(15000)});assert.ok(r.ok,'explicit owned location reload');await r.arrayBuffer();await active();
    };
    const installed=(await readExtensionStore(persist)).paths.find((p:string)=>p.includes('/extensions/agent-progress-probe'));assert.ok(installed);
    const companion=`${installed}/build/companion/index.js`,companionBytes=fs.readFileSync(companion),expectation=managedExpectationFile(binding),expectedBytes=fs.readFileSync(expectation);
    const observationShots=async(name:string)=>{await browser!.setupShot(`${name}-en`,'[data-testid="managed-load-observation"]');await browser!.language('page','ru');await browser!.shot(`${name}-ru`);await browser!.language('page','en');};
    try{
      // Labelled filesystem-fault seam, NOT a naturally occurring update state.
      fs.writeFileSync(expectation,'invalid synthetic expectation');check('unknown-on-unreadable-expectation',(await service('/v1/setup')).body.delivery.observation==='unknown');await observationShots('managed-unknown');
    }finally{fs.writeFileSync(expectation,expectedBytes);}
    try{
      // Keep the service's baseline alive while explicit reload loads changed
      // same-version companion bytes. This is warning-only integrity evidence.
      fs.appendFileSync(companion,'\n// Synthetic loaded-byte difference\n');await reload();
      await prompt({op:'revise',plan:'P-managed',oid:'different-report',rev:2,title:'Managed acceptance plan'});check('different-load-still-reports',(await service('/v1/setup')).body.delivery.observation==='different'&&store.get(binding.source.id,'P-managed')?.revision===3);await observationShots('managed-different');
    }finally{fs.writeFileSync(companion,companionBytes);await reload();}
    write('observations',{nativePostUpdate:afterSetup.body.delivery.observation,unknown:{observed:true,seam:'invalid synthetic expectation file; not spontaneous update behavior'},different:{observed:true,seam:'appended fixture companion comment plus explicit owned location reload with old service baseline',reportRevision:3,warningOnly:true},gracefulCancellationGuaranteed:false});
    phase='service-failure';const serviceEntry=`${installed}/build/service/main.js`,serviceBytes=fs.readFileSync(serviceEntry);const {stopGuestService}=await import(pathToFileURL(`${hostDir}/service.js`).href);
    try{
      await stopGuestService(id);fs.writeFileSync(serviceEntry,'throw new Error("Synthetic owned service failure");\n');await browser.stateShot('service-failure-en','[data-testid="state-unavailable"]');await browser.language('page','ru');await browser.shot('service-failure-ru');await browser.language('page','en');
    }finally{await stopGuestService(id);fs.writeFileSync(serviceEntry,serviceBytes);}
    check('service-fault-retains-history',store.history(binding.source.id,'P-managed').data.length===3);
    write('requests',{gitOperations:operations(),cache:cadence,extensionUpdateRequests:browser.routeRequests(),externalProviderRequests:fs.readFileSync(`${root}/events.jsonl`,'utf8').split('\n').filter(l=>l.includes('forbidden-http')).length,publicReachabilityProven:false});
    check('no-provider-transport',!fs.readFileSync(`${root}/events.jsonl`,'utf8').includes('forbidden-http'));check('empty-final-credentials',(await client.credential.list()).length===0);await browser.noNotices();
    check('no-uncaught-browser-exceptions',browser.console().exceptions===0);
    results.hostJourneyPassed=true;results.screenshots=browser.screenshots();const updateRequests=browser.routeRequests();
    await browser.stop();browser=undefined;await server.stop();server=undefined;
    phase='caller-owned-config-update';const caller=`${root}/caller-config.json`;fs.writeFileSync(caller,'{}',{mode:0o600});let generation=0,fallbackClient!:ReturnType<typeof OpenCode.make>,fallbackUrl='';
    const fallbackApi=async(method:string,route:string,body?:unknown)=>{const r=await fetch(fallbackUrl+route,{method,headers:{'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)});assert.ok(r.ok,`owned fallback request ${r.status}`);return r.json();};
    const fallbackSetup=async()=>{const r=await fallbackApi('POST',`/api/guests/${id}/service/request`,{method:'GET',path:'/v1/setup'});assert.equal(r.status,200);return JSON.parse(r.body);};
    const startFallback=async()=>{
      const infoFile=`${root}/fallback-${generation++}.json`,child=spawn(process.execPath,['--experimental-strip-types',fileURLToPath(import.meta.url),...process.argv.slice(2),'--fallback-server',infoFile],{env:{...env,OPENCODE_CONFIG:caller},stdio:'ignore'});remember(child.pid!);
      server={stop:async()=>{if(child.exitCode!==null||child.signalCode)return;const done=once(child,'exit');child.kill('SIGTERM');const timer=setTimeout(()=>child.kill('SIGKILL'),5000);try{await done;}finally{clearTimeout(timer);}}};
      await wait(async()=>fs.existsSync(infoFile),Boolean,'fresh fallback server process',110000);const info=JSON.parse(fs.readFileSync(infoFile,'utf8'));assert.equal(info.failed,undefined);remember(info.nativePid);
      const raw=Object.fromEntries(fs.readFileSync(`/proc/${info.nativePid}/environ`,'utf8').split('\0').filter(Boolean).map(v=>{const i=v.indexOf('=');return[v.slice(0,i),v.slice(i+1)];}));assert.equal(raw.HOME,env.HOME);assert.equal(raw.OPENCODE_CONFIG,caller);
      fallbackClient=OpenCode.make({baseUrl:`http://127.0.0.1:${info.nativePort}`,headers:{authorization:`Basic ${Buffer.from(`opencode:${raw.OPENCODE_PASSWORD||raw.OPENCODE_SERVER_PASSWORD}`).toString('base64')}`}});fallbackUrl=`http://127.0.0.1:${info.webPort}`;
      await wait(()=>fallbackClient.plugin.list({location} as any),v=>v.data.some(p=>p.id==='agent-progress'&&p.state.status==='active'),'caller-config plugin warmed');check('fallback-no-credentials',(await fallbackClient.credential.list()).length===0);
    };
    await startFallback();const fallbackBefore=await fallbackSetup();buildVersion(next(3),true);await fallbackApi('POST',`/api/guests/${id}/update`);const fallbackAfter=await fallbackSetup();
    const fallbackSession=await fallbackClient.session.create({location,agent:'build',title:'Synthetic caller config',model:{providerID:'managed-fixture',id:'script'},permissions:[{action:'*',resource:'*',effect:'allow'}]});
    const fallbackPrompt=async(rev:number)=>{fs.writeFileSync(`${root}/step.json`,JSON.stringify({name:'agent_progress_report',input:{op:rev===0?'start':'revise',plan:'P-fallback-update',oid:`caller-${rev}`,rev,title:'Synthetic caller config plan',...(rev===0?{items:[{id:'a',title:'Synthetic task',kind:'task'}]}:{})}}));await fallbackClient.session.prompt({sessionID:fallbackSession.id,text:'Run the synthetic local fixture.'},{signal:AbortSignal.timeout(15000)});await fallbackClient.session.wait({sessionID:fallbackSession.id},{signal:AbortSignal.timeout(20000)});};
    await fallbackPrompt(0);const fallbackAfterTurn=await fallbackSetup();check('fallback-report-works',store.get(binding.source.id,'P-fallback-update')?.revision===1);
    await server.stop();server=undefined;await startFallback();await fallbackPrompt(1);const fallbackRestarted=await fallbackSetup();check('fallback-explicit-restart-matches',fallbackRestarted.delivery.observation==='matching');check('caller-config-not-edited',fs.readFileSync(caller,'utf8')==='{}');check('fallback-history-retained',store.history(binding.source.id,'P-managed').data.length===3&&store.history(binding.source.id,'P-fallback-update').data.length===2);
    write('fallback',{boundary:'real API Git replacement on separate caller-owned-config host processes; no UI consent shortcut (unchanged approved capabilities)',beforeVersion:next(2),afterVersion:next(3),beforeObservation:fallbackBefore.delivery.observation,afterReplacementObservation:fallbackAfter.delivery.observation,afterNextTurnObservation:fallbackAfterTurn.delivery.observation,afterExplicitRestartObservation:fallbackRestarted.delivery.observation,callerConfigUnchanged:true,retainedMainHistoryRevisions:3,fallbackHistoryRevisions:2,automaticRestartPerformed:false});
    check('fallback-no-provider-transport',!fs.readFileSync(`${root}/events.jsonl`,'utf8').includes('forbidden-http'));
    results.limits=['Final merged-byte QA required; this execution records supplied bundle hashes','Ref matrix and failed-update preservation use separate actual installer gate','Desktop/Windows/macOS not tested','Continuously loaded board remount measured; rail/status read again on subsequent access; no all-session cancellation guarantee'];
    check('no-retired-route-requests',updateRequests===0);results.pass=true;phase='complete';
  }catch(e){results.failure=e instanceof Error?e.message.split('\n')[0].replaceAll(root,'<fixture>').slice(0,256):'fixture failure';await browser?.failure();throw e;}
  finally{results.phase=phase;write('results',results);dns.lookup=originalLookup;store?.close();await browser?.stop();await server?.stop();process.exit(results.pass?0:1);}
}
