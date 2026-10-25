import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,cpSync,symlinkSync,readlinkSync,renameSync } from 'node:fs';
import path from 'node:path';
import { spawn,spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { SetupController } from '../../service/setup-controller.ts';
import { lifecycle } from '../../setup/lifecycle.ts';
import { serviceBindingFile } from '../../service/state.ts';
import { Store } from '../../shared/store.ts';

function fixture() {
  const root=mkdtempSync('/tmp/opencode/agent-progress-backend-reassembly-');
  for(const dir of ['home','state','config/opencode','data/opencode','compiled/companion','compiled/setup','compiled/service'])mkdirSync(`${root}/${dir}`,{recursive:true,mode:0o700});
  for(const [entry,output]of [['plugin/index.ts','companion/index.js'],['setup/cli.ts','setup/main.js'],['service/main.ts','service/main.js']])assert.equal(spawnSync('bun',['build',entry,'--target=node','--format=esm',`--outfile=${root}/compiled/${output}`],{stdio:'ignore'}).status,0);
  cpSync('plugin/SKILL.md',`${root}/compiled/companion/SKILL.md`);
  const targets={configRoot:`${root}/config/opencode`,dataRoot:`${root}/data/opencode`,storeRoot:`${root}/store`,confirmed:true};
  const env={PATH:path.dirname(process.execPath)+':/usr/bin:/bin',HOME:`${root}/home`,XDG_STATE_HOME:`${root}/state`,XDG_CONFIG_HOME:`${root}/config`,XDG_DATA_HOME:`${root}/data`};
  const payload={plugin:readFileSync(`${root}/compiled/companion/index.js`,'utf8'),guidance:readFileSync('plugin/SKILL.md','utf8'),removal:readFileSync(`${root}/compiled/setup/main.js`,'utf8'),version:JSON.parse(readFileSync('package.json','utf8')).version};
  return {root,targets,env,payload,clean(){rmSync(root,{recursive:true,force:true});}};
}
async function serve(f:ReturnType<typeof fixture>) {
  const extension=`${f.root}/extension`;mkdirSync(extension,{recursive:true});cpSync(`${f.root}/compiled`,`${extension}/build`,{recursive:true});writeFileSync(`${extension}/package.json`,'{"type":"module"}');
  const reservation=createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');const port=(reservation.address() as {port:number}).port;await new Promise<void>(resolve=>reservation.close(()=>resolve()));
  const child=spawn(process.execPath,[`${extension}/build/service/main.js`],{env:{...f.env,OPENCHAMBER_SERVICE_PORT:String(port),OPENCHAMBER_SERVICE_TOKEN:'fixture-only'},stdio:'ignore'});
  let spawnError=false;child.once('error',()=>{spawnError=true;});
  const request=(route:string,body?:unknown)=>fetch(`http://127.0.0.1:${port}${route}`,{method:body===undefined?'GET':'POST',headers:{authorization:'Bearer fixture-only','content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(2000)});
  async function stop(){if(child.exitCode===null&&!child.signalCode){const exit=once(child,'exit');child.kill('SIGTERM');const timer=setTimeout(()=>child.kill('SIGKILL'),3000);try{await exit;}finally{clearTimeout(timer);}}}
  try {const deadline=Date.now()+5000;while(Date.now()<deadline){assert.equal(spawnError,false);assert.equal(child.exitCode,null);try{if((await request('/health')).ok)return {request,stop,extension};}catch{}await new Promise(resolve=>setTimeout(resolve,25));}throw new Error('service-start');}catch(e){await stop();throw e;}
}
test('extension replacement preserves authoritative binding, configured views and store identity',async()=>{
  const f=fixture();let running:Awaited<ReturnType<typeof serve>>|undefined;
  try {
    running=await serve(f);assert.equal((await running.request('/v1/setup/install',f.targets)).status,200);
    const first=await(await running.request('/v1/plans')).json();await running.stop();rmSync(running.extension,{recursive:true});
    running=await serve(f);const health=await(await running.request('/health')).json();assert.equal(health.ready,true);
    const setup=await(await running.request('/v1/setup')).json();assert.equal(setup.configured,true);assert.equal(setup.installed,true);assert.deepEqual(setup.targets,{configRoot:f.targets.configRoot,dataRoot:f.targets.dataRoot,storeRoot:f.targets.storeRoot});
    assert.equal((await(await running.request('/v1/plans')).json()).storeId,first.storeId);
  }finally{await running?.stop();f.clean();}
});
test('reload pending survives restart, clears only after loaded tool observation and renews on changed same-version files',()=>{
  const f=fixture();const binding=`${f.root}/state/service-binding.json`;let payload=f.payload;
  let setup=new SetupController(binding,()=>payload);
  function load(){const result=spawnSync(process.execPath,['--experimental-strip-types',path.resolve('tests/fixtures/activation.ts'),`${f.targets.configRoot}/plugins/agent-progress/index.js`],{env:f.env,encoding:'utf8',timeout:10000});assert.equal(result.status,0,result.stdout+result.stderr);}
  try {
    assert.equal(setup.run('install',f.targets).activation,'reload-required');setup.close();setup=new SetupController(binding,()=>payload);
    assert.equal(setup.status().activation,'reload-required');load();assert.notEqual(setup.status().activation,'reload-required');
    setup.close();setup=new SetupController(binding,()=>payload);assert.notEqual(setup.status().activation,'reload-required');
    payload={...payload,plugin:payload.plugin+'\n// changed same-version payload\n'};
    assert.equal(setup.run('update',f.targets).activation,'reload-required');setup.close();setup=new SetupController(binding,()=>payload);
    assert.equal(setup.status().activation,'reload-required');
    payload={...payload,plugin:payload.plugin+'\n// superseding update\n'};assert.equal(setup.run('update',f.targets).activation,'reload-required');
    load();assert.notEqual(setup.status().activation,'reload-required');
    payload=f.payload;assert.equal(setup.run('update',f.targets).activation,'reload-required');
    load();assert.notEqual(setup.status().activation,'reload-required','historical load is not a current acknowledgement after rollback');
  }finally{setup.close();f.clean();}
});
test('shared store second-source first inspect ignores other-source payloads but retains same-source orphan diagnostic',()=>{
  const f=fixture();try {
    lifecycle('install',f.targets,f.payload);
    for(const dir of ['second-config','second-data'])mkdirSync(`${f.root}/${dir}`,{mode:0o700});
    const second={configRoot:`${f.root}/second-config`,dataRoot:`${f.root}/second-data`,storeRoot:f.targets.storeRoot,confirmed:true};
    assert.equal(lifecycle('inspect',second).diagnostics.includes('unreferenced-payloads-retained'),false);
    lifecycle('install',second,f.payload);
    assert.equal(lifecycle('inspect',f.targets).diagnostics.includes('unreferenced-payloads-retained'),false);
    assert.throws(()=>lifecycle('update',f.targets,{...f.payload,plugin:f.payload.plugin+'\n// interrupted'},phase=>{if(phase==='before-activation')throw new Error('interrupted');}),/interrupted/);
    assert.equal(lifecycle('inspect',f.targets).diagnostics.includes('unreferenced-payloads-retained'),true);
  }finally{f.clean();}
});
test('stable descriptor adopts legacy once, ignores later defaults and refuses foreign/modified/symlink state',()=>{
  const f=fixture();try {
    lifecycle('install',f.targets,f.payload);const legacy=`${f.root}/legacy.json`;cpSync(`${f.targets.configRoot}/plugins/agent-progress/progress-binding.json`,legacy);
    const binding=serviceBindingFile(f.env);let setup=new SetupController(binding,()=>f.payload,legacy);
    assert.equal(setup.status().configured,true);setup.close();writeFileSync(legacy,'foreign legacy default');
    setup=new SetupController(binding,()=>f.payload,legacy);assert.equal(setup.status().configured,true);
    writeFileSync(binding,'user modified');assert.throws(()=>setup.run('update',f.targets),/service-binding-modified/);assert.equal(readFileSync(binding,'utf8'),'user modified');setup.close();
    setup=new SetupController(binding,()=>f.payload,legacy);assert.throws(()=>setup.run('update',f.targets),/service-binding-collision/);setup.close();
    rmSync(binding);symlinkSync(`${f.root}/missing-foreign-file`,binding);
    setup=new SetupController(binding,()=>f.payload,legacy);assert.throws(()=>setup.run('update',f.targets),/service-binding-collision/);setup.close();assert.equal(readlinkSync(binding),`${f.root}/missing-foreign-file`);
    writeFileSync(path.join(path.dirname(binding),'.ownership.json'),'foreign owner');assert.throws(()=>serviceBindingFile(f.env),/service-binding-collision/);
  }finally{f.clean();}
});

test('HTTP bundled comparison uses selected bytes, retains root version and clears activation independently',async()=>{
  const f=fixture();let running:Awaited<ReturnType<typeof serve>>|undefined;
  try {
    lifecycle('install',f.targets,{...f.payload,version:'0.2.2'});
    cpSync(`${f.targets.configRoot}/plugins/agent-progress/progress-binding.json`,serviceBindingFile(f.env));
    const rootPackage=`${f.targets.configRoot}/plugins/agent-progress/package.json`,rootBytes=readFileSync(rootPackage);
    running=await serve(f);
    const status=async()=>await(await running!.request('/v1/setup')).json();
    let state=await status();assert.equal(state.version,'0.2.2');assert.deepEqual(state.update,{state:'available',candidateVersion:f.payload.version,rootVersion:'0.2.2'});
    const reply=await(await running.request('/v1/setup/update',{confirmed:true})).json();
    assert.equal(reply.version,f.payload.version);assert.equal(reply.activation,'reload-required');
    assert.deepEqual(reply.update,{state:'current',candidateVersion:f.payload.version,rootVersion:'0.2.2'});
    assert.deepEqual((await status()).update,reply.update);assert.deepEqual(readFileSync(rootPackage),rootBytes);
    const load=spawnSync(process.execPath,['--experimental-strip-types',path.resolve('tests/fixtures/activation.ts'),`${f.targets.configRoot}/plugins/agent-progress/index.js`],{env:f.env,encoding:'utf8',timeout:10000});
    assert.equal(load.status,0,load.stdout+load.stderr);
    state=await status();assert.equal(state.activation,'control-applies-to-loaded-instances');assert.equal(state.update.state,'current');
    lifecycle('update',f.targets,{...f.payload,plugin:f.payload.plugin+'\n// legitimate same-version rebuild\n'});
    state=await status();assert.equal(state.version,f.payload.version);assert.equal(state.update.state,'available');assert.equal(state.activation,'reload-required');
    lifecycle('update',f.targets,{...f.payload,version:'0.10.0'});
    const manifestFile=`${f.targets.configRoot}/plugins/agent-progress/.ownership.json`,manifestBytes=readFileSync(manifestFile);
    const historyFile=`${f.targets.storeRoot}/installation-history.jsonl`,beforeRead=readFileSync(historyFile);
    state=await status();assert.equal(state.version,'0.10.0');assert.equal(state.update.state,'newer-installed');
    assert.deepEqual(readFileSync(manifestFile),manifestBytes);assert.deepEqual(readFileSync(historyFile),beforeRead);
    // Detection did not silently switch or downgrade the selected release.
    assert.equal(lifecycle('inspect',f.targets).version,'0.10.0');
    assert.equal((await running.request('/v1/setup/update',{confirmed:true})).status,200);
    state=await status();assert.equal(state.version,f.payload.version);assert.equal(state.update.state,'current');
    assert.equal(readFileSync(`${f.targets.storeRoot}/installation-history.jsonl`,'utf8').trim().split('\n').length,5);
  }finally{await running?.stop();f.clean();}
});

test('HTTP comparison omits uncertain states and keeps modified update refusal and history',async()=>{
  const f=fixture();let running:Awaited<ReturnType<typeof serve>>|undefined;
  try {
    running=await serve(f);
    const status=async()=>await(await running!.request('/v1/setup')).json();
    assert.equal(Object.hasOwn(await status(),'update'),false);
    assert.equal((await running.request('/v1/setup/install',f.targets)).status,200);
    const bundled=`${running.extension}/build/companion/index.js`;
    renameSync(bundled,bundled+'.held');
    let state=await status();assert.equal(state.installed,true);assert.equal(Object.hasOwn(state,'update'),false);
    renameSync(bundled+'.held',bundled);
    const database=`${f.targets.storeRoot}/progress.sqlite`;
    renameSync(database,database+'.held');
    state=await status();assert.equal(state.configured,true);assert.equal(state.captureEnabled,null);assert.equal(Object.hasOwn(state,'update'),false);assert.ok(state.diagnostics.includes('storage'));
    renameSync(database+'.held',database);assert.equal((await status()).update.state,'current');
    const ownership=JSON.parse(readFileSync(`${f.targets.configRoot}/plugins/agent-progress/.ownership.json`,'utf8'));
    const plugin=`${f.targets.storeRoot}/payloads/${ownership.active}/index.js`,original=readFileSync(plugin);
    const history=`${f.targets.storeRoot}/installation-history.jsonl`,historyBytes=readFileSync(history);
    writeFileSync(plugin,'modified-owned-payload');
    state=await status();assert.equal(Object.hasOwn(state,'update'),false);assert.ok(state.diagnostics.includes('modified-owned-files'));
    const refused=await running.request('/v1/setup/update',{confirmed:true});assert.equal(refused.status,409);assert.deepEqual(await refused.json(),{error:'modified-owned-files'});
    assert.deepEqual(readFileSync(history),historyBytes);assert.equal(readFileSync(plugin,'utf8'),'modified-owned-payload');
    writeFileSync(plugin,original);
    assert.equal((await running.request('/v1/setup/remove-capture',{confirmed:true})).status,200);
    state=await status();assert.equal(state.installed,false);assert.equal(Object.hasOwn(state,'update'),false);
  }finally{await running?.stop();f.clean();}
});

test('HTTP verified ownership with an unverified source makes no update claim',async()=>{
  const f=fixture();let running:Awaited<ReturnType<typeof serve>>|undefined;
  try {
    mkdirSync(f.targets.storeRoot,{mode:0o700});
    const store=new Store(`${f.targets.storeRoot}/progress.sqlite`,{create:true});
    try{store.registerSource({id:'unverified-fixture',configRoot:f.targets.configRoot,dataRoot:f.targets.dataRoot,verified:false});}finally{store.close();}
    lifecycle('install',f.targets,f.payload);
    cpSync(`${f.targets.configRoot}/plugins/agent-progress/progress-binding.json`,serviceBindingFile(f.env));
    running=await serve(f);const state=await(await running.request('/v1/setup')).json();
    assert.equal(state.installed,true);assert.equal(state.verified,false);assert.equal(state.version,f.payload.version);assert.equal(Object.hasOwn(state,'update'),false);
  }finally{await running?.stop();f.clean();}
});

test('HTTP comparison orders prerelease identifiers and numeric release components',async()=>{
  const f=fixture();let running:Awaited<ReturnType<typeof serve>>|undefined;
  try {
    running=await serve(f);assert.equal((await running.request('/v1/setup/install',f.targets)).status,200);
    const [major,minor,patch]=f.payload.version.split('.').map(Number);
    for(const [version,expected]of [[`${f.payload.version}-rc.10`,'available'],[`${major}.${minor}.${patch!+1}-rc.2`,'newer-installed'],[`${major}.${minor!+1}.0`,'newer-installed']] as const){
      lifecycle('update',f.targets,{...f.payload,version});
      const state=await(await running.request('/v1/setup')).json();assert.equal(state.update.state,expected,version);assert.equal(state.version,version);
    }
  }finally{await running?.stop();f.clean();}
});
