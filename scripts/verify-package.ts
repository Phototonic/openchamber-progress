/** Artifact QA: committed entries, managed configuration/migration and retained legacy recovery. */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, cpSync, chmodSync, readdirSync, lstatSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { parseManifestJson } from '@openchamber/sdk/schemas';
import { VERSION } from '../shared/progress.ts';
import { Store, digest } from '../shared/store.ts';
import { readBinding } from '../shared/binding.ts';
import { managedBindingFile } from '../shared/managed-binding.ts';
import { RELEASE } from '../shared/release.ts';
import { verifyCompanionEntry } from './companion-entry.ts';
import { isolatedEnvironment } from '../tests/fixtures/managed.ts';

function files(root:string):string[]{return readdirSync(root).sort().flatMap(name=>{const file=path.join(root,name),stat=lstatSync(file);assert.equal(stat.isSymbolicLink(),false,'no packaged symlinks');return stat.isDirectory()?files(file):[file];});}
function snapshot(root:string):unknown {
  const result:Record<string,unknown>={};
  const walk=(file:string)=>{const s=lstatSync(file,{bigint:true});assert.equal(s.isSymbolicLink(),false);result[path.relative(root,file)]={mode:String(s.mode),uid:String(s.uid),size:String(s.size),mtimeNs:String(s.mtimeNs),...(s.isFile()?{hash:digest(readFileSync(file))}:{})};if(s.isDirectory())for(const name of readdirSync(file).sort())walk(path.join(file,name));};
  walk(root);return result;
}
/** Run before reassembly too: rebuilding must not hide a damaged input package. */
export function verifyPackageContents(artifact:string,kind:'extension'|'companion',sourceRoot=process.cwd()):string[] {
  const builds=['build/companion/index.js','build/companion/SKILL.md','build/companion/package.json','build/setup/main.js'];
  const notices=['LICENSE','THIRD_PARTY_NOTICES.md','licenses/Apache-2.0.txt'];
  const expected=['package.json','docs/setup.md',...notices,...builds,...(kind==='extension'?['build/service/main.js','background/index.html','background/main.js',...['panel','status','page'].flatMap(surface=>[`ui/${surface}/index.html`,`ui/${surface}/main.js`])]:[])].sort();
  assert.deepEqual(files(artifact).map(file=>path.relative(artifact,file)).sort(),expected,'only declared payload; no auth, evidence or runtime state');
  assert.equal(JSON.parse(readFileSync(path.join(sourceRoot,'package.json'),'utf8')).license,'MIT','project license metadata');
  assert.equal(JSON.parse(readFileSync(path.join(artifact,'package.json'),'utf8')).license,'MIT','packaged project license metadata');
  for(const entry of expected.filter(entry=>entry!=='package.json'))assert.equal(digest(readFileSync(path.join(artifact,entry))),digest(readFileSync(path.join(sourceRoot,entry))),`package/source bytes: ${entry}`);
  const archive=spawnSync('unzip',['-Z','-1',`${artifact}.zip`],{encoding:'utf8'});assert.equal(archive.status,0);
  assert.deepEqual(archive.stdout.trim().split('\n').filter(name=>!name.endsWith('/')).sort(),expected,'ZIP entry allowlist matches folder');
  for(const notice of notices){const zipped=spawnSync('unzip',['-p',`${artifact}.zip`,notice],{maxBuffer:1024*1024});assert.equal(zipped.status,0);assert.equal(digest(zipped.stdout),digest(readFileSync(path.join(sourceRoot,notice))),`ZIP/source notice bytes: ${notice}`);}
  return expected;
}

async function verifyPackage() {
  const root=mkdtempSync('/tmp/opencode/agent-progress-package-'),env=isolatedEnvironment(root);
  const extension=path.resolve(`build/artifacts/agent-progress-extension-${RELEASE}`),companion=path.resolve(`build/artifacts/agent-progress-companion-${RELEASE}`);
  let service:ReturnType<typeof spawn>|undefined;
  const run=(args:string[],extra:NodeJS.ProcessEnv={})=>{const r=spawnSync(process.execPath,args,{env:{...env,...extra},encoding:'utf8',timeout:30000});assert.equal(r.status,0,r.stdout+r.stderr);return r.stdout.trim();};
  const stop=async()=>{if(service&&service.exitCode===null&&!service.signalCode){const exit=once(service,'exit');service.kill('SIGTERM');const timer=setTimeout(()=>service?.kill('SIGKILL'),3000);try{await exit;}finally{clearTimeout(timer);}}service=undefined;};
  const launch=async(folder:string,fixtureEnv:NodeJS.ProcessEnv)=>{
    const reservation=createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');const port=(reservation.address() as {port:number}).port;await new Promise<void>(r=>reservation.close(()=>r()));
    service=spawn(process.execPath,[path.join(folder,'build/service/main.js')],{env:{...fixtureEnv,OPENCHAMBER_SERVICE_PORT:String(port),OPENCHAMBER_SERVICE_TOKEN:'package-fixture-only'},cwd:root,stdio:'ignore'});
    const request=(route:string,body?:unknown)=>fetch(`http://127.0.0.1:${port}${route}`,{method:body===undefined?'GET':'POST',headers:{authorization:'Bearer package-fixture-only','content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(3000)});
    for(const deadline=Date.now()+7000;;){assert.equal(service.exitCode,null,'owned service exited');try{if((await request('/health')).ok)break;}catch{}assert.ok(Date.now()<deadline,'service readiness');await new Promise(r=>setTimeout(r,25));}
    const json=async(route:string)=>{const r=await request(route);assert.equal(r.status,200);return r.json();};
    const action=async(name:string,storeRoot?:string)=>{const r=await request('/v1/setup/managed-inspect',storeRoot?{storeRoot}:{});assert.equal(r.status,200);const reviewed=await r.json();return request(`/v1/setup/${name}`,{...(storeRoot?{storeRoot}:{}),confirmed:true,expected:reviewed.delivery.review.expected});};
    return {request,json,action};
  };
  try {
    for(const [artifact,kind] of [[extension,'extension'],[companion,'companion']] as const){
      const expected=verifyPackageContents(artifact,kind),unpacked=`${root}/${kind}`;mkdirSync(unpacked);
      assert.equal(spawnSync('unzip',['-q',`${artifact}.zip`,'-d',unpacked]).status,0);
      for(const entry of expected)assert.equal(digest(readFileSync(path.join(unpacked,entry))),digest(readFileSync(path.join(artifact,entry))),`ZIP/folder bytes: ${entry}`);
      assert.equal(JSON.parse(readFileSync(`${artifact}/package.json`,'utf8')).version,RELEASE);
      assert.equal(JSON.parse(readFileSync(`${artifact}/build/companion/package.json`,'utf8')).version,RELEASE);
      for(const entry of ['build/companion/index.js','build/setup/main.js'])run(['--check',path.join(unpacked,entry)]);
    }
    verifyCompanionEntry(extension);verifyCompanionEntry(`${root}/extension`);
    const manifest=JSON.parse(readFileSync(`${extension}/package.json`,'utf8'));assert.equal(parseManifestJson(JSON.stringify(manifest)).ok,true);assert.equal(VERSION,2);
    assert.equal(manifest.openchamber.contributes.panel.id,'agent-progress-probe');
    for(const surface of ['ui/panel','ui/status','ui/page','background']){assert.match(readFileSync(`${extension}/${surface}/index.html`,'utf8'),/src=["'](?:\.\/)?main\.js["']/);assert.doesNotMatch(readFileSync(`${extension}/${surface}/main.js`,'utf8'),/^\s*(?:import\s|export\s)/m);}
    const inventory=path.resolve(`build/artifacts/entries-${RELEASE}.sha256`),before=readFileSync(inventory,'utf8');run(['--experimental-strip-types',path.resolve('scripts/package.ts')]);assert.equal(readFileSync(inventory,'utf8'),before);
    console.log(run(['--experimental-strip-types',path.resolve('scripts/verify-live-package.ts'),extension]));

    for(const dir of ['config/opencode','data/opencode'])mkdirSync(`${root}/${dir}`,{recursive:true,mode:0o700});
    const unrelated=`${root}/config/opencode/opencode.json`;writeFileSync(unrelated,'{"fixture":"unrelated configuration"}\n',{mode:0o600});const original=readFileSync(unrelated);
    let api=await launch(extension,env);
    assert.equal((await api.json('/v1/setup')).delivery.configuration,'unconfigured');
    const tree=[snapshot(`${root}/config`),snapshot(`${root}/data`)];
    const inspected=await api.request('/v1/setup/managed-inspect',{});assert.equal(inspected.status,200);
    assert.equal(existsSync(path.dirname(managedBindingFile(env))),false);assert.equal(existsSync(`${root}/data/opencode/openchamber-progress`),false);
    assert.deepEqual([snapshot(`${root}/config`),snapshot(`${root}/data`)],tree,'GET/inspect preserve target bytes, modes and mtimes');
    assert.equal((await api.request('/v1/setup/managed-configure',{confirmed:false})).status,400);
    assert.equal((await api.request('/v1/setup/install',{confirmed:true})).status,409,'no production global-install route');
    assert.equal((await api.action('managed-configure')).status,200);
    const b=readBinding(managedBindingFile(env));
    assert.equal(existsSync(`${root}/config/opencode/plugins/agent-progress`),false);
    console.log(run(['--experimental-strip-types',path.resolve('tests/fixtures/managed-report.ts'),extension,root]));
    const reports=await api.json('/v1/plans');assert.equal(reports.storeId,b.storeId);assert.equal(reports.data[0].id,'managed-packaged');
    assert.equal((await api.json('/v1/setup')).delivery.observation,'matching');
    assert.equal((await api.action('managed-disable')).status,200);assert.equal((await api.json('/v1/plans')).captureEnabled,false);
    assert.equal((await api.action('managed-enable')).status,200);
    await stop();const replacement=`${root}/replacement`;cpSync(extension,replacement,{recursive:true});api=await launch(replacement,env);
    assert.equal((await api.json('/v1/plans')).storeId,b.storeId);assert.equal((await api.json('/v1/setup')).configured,true);
    for(const kind of ['permissions','corrupt'] as const){
      const good=readFileSync(b.database);
      if(kind==='permissions')chmodSync(b.database,0o000);else{const bad=Buffer.from(good);bad.write('not-a-sqlite-file',0);writeFileSync(b.database,bad);}
      const damaged=kind==='corrupt'?readFileSync(b.database):good;
      try{const health=await api.json('/health');assert.equal(health.ready,false);assert.ok(health.diagnostics.includes(kind==='permissions'?'storage':'corrupt'));const unavailable=await api.request('/v1/plans');assert.equal(unavailable.status,503);assert.equal((await unavailable.json()).error,kind==='permissions'?'storage':'corrupt');assert.equal((await api.json('/v1/setup')).configured,true);if(kind==='corrupt')assert.deepEqual(readFileSync(b.database),damaged,'corrupt Store reads never reset or repair bytes');}
      finally{if(kind==='permissions')chmodSync(b.database,0o600);else writeFileSync(b.database,good);}
      assert.deepEqual(readFileSync(b.database),good);
      assert.equal((await api.json('/health')).ready,true);
    }
    await stop();rmSync(replacement,{recursive:true});const retained=new Store(b.database,{readOnly:true});try{assert.equal(retained.get(b.source.id,'managed-packaged')!.revision,2);}finally{retained.close();}

    // The standalone archive is retained legacy/recovery support, not the normal install path.
    const legacyRoot=`${root}/legacy`,legacyEnv=isolatedEnvironment(legacyRoot);for(const dir of ['config/opencode','data/opencode'])mkdirSync(`${legacyRoot}/${dir}`,{recursive:true,mode:0o700});
    const flags=[`--config-root=${legacyRoot}/config/opencode`,`--data-root=${legacyRoot}/data/opencode`,`--store-root=${legacyRoot}/store`,'--confirm=true'];
    const cli=`${root}/companion/build/setup/main.js`,legacyRun=(args:string[])=>run(args,legacyEnv);
    assert.equal(JSON.parse(legacyRun([cli,'dry-run',...flags])).writes,false);assert.equal(existsSync(`${legacyRoot}/store/progress.sqlite`),false);
    assert.equal(JSON.parse(legacyRun([cli,'install',...flags])).version,RELEASE);
    console.log(legacyRun(['--experimental-strip-types',path.resolve('scripts/package-guidance.ts'),legacyRoot,RELEASE]));
    const legacyPackage=`${legacyRoot}/config/opencode/plugins/agent-progress`,old=readBinding(`${legacyPackage}/progress-binding.json`),history=new Store(old.database,{readOnly:true});let revisions:number;
    try{revisions=history.history(old.source.id,'packaged').data.length;}finally{history.close();}
    assert.equal(JSON.parse(legacyRun([cli,'update',...flags])).version,RELEASE);
    assert.equal(JSON.parse(legacyRun([cli,'disable',...flags])).captureEnabled,false);assert.equal(JSON.parse(legacyRun([cli,'enable',...flags])).captureEnabled,true);
    api=await launch(extension,legacyEnv);assert.equal((await api.json('/v1/setup')).delivery.migration,'available');
    const ownership=`${legacyPackage}/.ownership.json`,owned=readFileSync(ownership),selection=JSON.parse(owned.toString());
    const payloadFile=path.join(path.dirname(old.database),'payloads',selection.active,'index.js');
    for(const file of [ownership,payloadFile]){
      const bytes=readFileSync(file),historyFile=path.join(path.dirname(old.database),'installation-history.jsonl'),historyBytes=readFileSync(historyFile);writeFileSync(file,'modified fixture');
      try{assert.equal((await api.request('/v1/setup/managed-inspect',{})).status,409);assert.equal((await api.json('/v1/setup')).delivery.migration,'conflict');assert.equal(existsSync(managedBindingFile(legacyEnv)),false);assert.equal(readFileSync(file,'utf8'),'modified fixture');}
      finally{writeFileSync(file,bytes);}
      assert.deepEqual(readFileSync(historyFile),historyBytes);
      const unchanged=new Store(old.database,{readOnly:true});try{assert.equal(unchanged.history(old.source.id,'packaged').data.length,revisions);assert.equal(unchanged.list().captureEnabled,true);}finally{unchanged.close();}
    }
    assert.equal((await api.request('/v1/setup/managed-migrate',{confirmed:false})).status,400);
    assert.equal((await api.action('managed-migrate')).status,200);
    const migrated=readBinding(managedBindingFile(legacyEnv));assert.equal(migrated.storeId,old.storeId);assert.equal(migrated.source.id,old.source.id);assert.equal(existsSync(legacyPackage),false);
    const kept=new Store(migrated.database,{readOnly:true});try{assert.equal(kept.history(old.source.id,'packaged').data.length,revisions);}finally{kept.close();}
    await stop();assert.deepEqual(readFileSync(unrelated),original);
    // Installed legacy removal remains self-contained with no extension present.
    const recoveryRoot=`${root}/standalone-recovery`,recoveryEnv=isolatedEnvironment(recoveryRoot);
    for(const dir of ['config/opencode','data/opencode'])mkdirSync(`${recoveryRoot}/${dir}`,{recursive:true,mode:0o700});
    const recoveryFlags=[`--config-root=${recoveryRoot}/config/opencode`,`--data-root=${recoveryRoot}/data/opencode`,`--store-root=${recoveryRoot}/store`,'--confirm=true'];
    run([cli,'install',...recoveryFlags],recoveryEnv);run(['--experimental-strip-types',path.resolve('scripts/package-guidance.ts'),recoveryRoot,RELEASE],recoveryEnv);
    const recoveryPackage=`${recoveryRoot}/config/opencode/plugins/agent-progress`,recoveryBinding=readBinding(`${recoveryPackage}/progress-binding.json`),recoveryBefore=new Store(recoveryBinding.database,{readOnly:true});let recoveryHistory:number;
    try{recoveryHistory=recoveryBefore.history(recoveryBinding.source.id,'packaged').data.length;}finally{recoveryBefore.close();}
    assert.equal(existsSync(`${recoveryRoot}/extension`),false);
    assert.equal(JSON.parse(run([`${recoveryPackage}/remove.js`,'remove-capture'],recoveryEnv)).historyRetained,true);assert.equal(existsSync(recoveryPackage),false);
    const recoveryAfter=new Store(recoveryBinding.database,{readOnly:true});try{assert.equal(recoveryAfter.list().captureEnabled,false);assert.equal(recoveryAfter.history(recoveryBinding.source.id,'packaged').data.length,recoveryHistory);}finally{recoveryAfter.close();}
    console.log(JSON.stringify({managedPluginFolder:true,folderZipParity:true,consumerBuild:false,entryInventoryDeterministic:true,packagedReadOnlyInspection:true,explicitConfiguration:true,globalInstallRefused:true,managedReport:true,extensionReplacementRetainsIdentity:true,storeRecovery:true,legacyRecoveryArchive:true,fullOwnershipMigration:true,historyRetained:true,version:RELEASE}));
    if(process.env.AGENT_PROGRESS_HOST_MODULE)console.log(run(['--experimental-strip-types',path.resolve('scripts/verify-host-package.ts'),extension],{AGENT_PROGRESS_HOST_MODULE:process.env.AGENT_PROGRESS_HOST_MODULE}));
    else console.log(JSON.stringify({actualHostInstaller:'not-run; explicit isolated host module required'}));
  }finally{await stop();rmSync(root,{recursive:true,force:true});}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)await verifyPackage();
