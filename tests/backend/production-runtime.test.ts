import{test}from'node:test';import assert from'node:assert/strict';
import{mkdtempSync,mkdirSync,readFileSync,rmSync,existsSync,cpSync}from'node:fs';import path from'node:path';
import{spawn,spawnSync}from'node:child_process';import{once}from'node:events';import{createServer}from'node:net';
import{OpenCode}from'@opencode/client';import{ProgressStatus}from'../../plugin/status.ts';
import{lifecycle,type Targets}from'../../setup/lifecycle.ts';
import{SetupController}from'../../service/setup-controller.ts';

test('QA4 self-contained production install, actual empty2.2.2 plugin activation/update and standalone disable/remove',{timeout:45000},async()=>{
  const root=mkdtempSync('/tmp/opencode/agent-progress-production-runtime-');let child:ReturnType<typeof spawn>|undefined;let setup:SetupController|undefined;
  const binary='/tmp/opencode/agent-progress-probe-cli/opencode';
  try{
    assert.equal(existsSync(binary),true,'approved independent2.2.2 runtime required');
    for(let dir=path.dirname(root);;dir=path.dirname(dir)){for(const name of ['opencode.json','opencode.jsonc','.opencode/opencode.json','.opencode/opencode.jsonc'])assert.equal(existsSync(path.join(dir,name)),false,'ancestor config not allowed');if(dir===path.dirname(dir))break;}
    assert.equal(existsSync('/etc/opencode'),false,'system config not allowed');
    for(const dir of ['config/opencode','data/opencode','home','cache','state','runtime','tmp','project','compiled'])mkdirSync(`${root}/${dir}`,{recursive:true,mode:0o700});
    for(const[entry,out]of[['plugin/index.ts','plugin.js'],['setup/cli.ts','remove.js']])assert.equal(spawnSync('bun',['build',entry,'--target=node','--format=esm',`--outfile=${root}/compiled/${out}`],{stdio:'ignore'}).status,0);
    const payload={plugin:readFileSync(`${root}/compiled/plugin.js`,'utf8'),removal:readFileSync(`${root}/compiled/remove.js`,'utf8'),guidance:readFileSync('plugin/SKILL.md','utf8'),version:'0.2.0'};
    const targets:Targets={configRoot:`${root}/config/opencode`,dataRoot:`${root}/data/opencode`,storeRoot:`${root}/store`,confirmed:true};
    lifecycle('install',targets,payload);
    cpSync(`${targets.configRoot}/plugins/agent-progress/progress-binding.json`,`${root}/service-binding.json`);
    setup=new SetupController(`${root}/service-binding.json`,()=>payload);assert.equal(setup.status().activation,'reload-required');
    const env={PATH:'/usr/bin:/bin',HOME:`${root}/home`,XDG_CONFIG_HOME:`${root}/config`,XDG_DATA_HOME:`${root}/data`,XDG_CACHE_HOME:`${root}/cache`,XDG_STATE_HOME:`${root}/state`,XDG_RUNTIME_DIR:`${root}/runtime`,TMPDIR:`${root}/tmp`,OPENCODE_PASSWORD:'synthetic-local-only-password',DBUS_SESSION_BUS_ADDRESS:'disabled:'};
    const version=spawnSync(binary,['--version'],{env,encoding:'utf8',stdio:['ignore','pipe','ignore']});assert.match(version.stdout,/2\.2\.2/);
    const reservation=createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');const port=(reservation.address()as any).port;await new Promise<void>(resolve=>reservation.close(()=>resolve()));
    child=spawn(binary,['serve','--hostname','127.0.0.1','--port',String(port)],{cwd:`${root}/project`,env,stdio:'ignore'});
    let spawnError=false;child.once('error',()=>{spawnError=true;});
    const headers={authorization:`Basic ${Buffer.from(`opencode:${env.OPENCODE_PASSWORD}`).toString('base64')}`};
    const client=OpenCode.make({baseUrl:`http://127.0.0.1:${port}`,headers});const status=client.rpc(ProgressStatus);
    const location={directory:`${root}/project`};
    async function ready(expected:string){
      const end=Date.now()+15000;
      while(Date.now()<end){assert.equal(spawnError,false);assert.equal(child!.exitCode,null,'owned runtime exited');try{const r=await status.inspect({}, {location,signal:AbortSignal.timeout(1000)})as any;if(r.version===expected&&r.toolAvailable)return r;}catch{}await new Promise(resolve=>setTimeout(resolve,50));}
      throw new Error('production-plugin-not-active');
    }
    const active=await ready('0.2.0');assert.equal(active.protocolVersion,2);assert.equal(active.captureEnabled,true);assert.equal(active.codemodeDisabled,true);
    assert.notEqual(setup.status().activation,'reload-required');
    const skills=await(await fetch(`http://127.0.0.1:${port}/api/skill?${new URLSearchParams({'location[directory]':location.directory})}`,{headers,signal:AbortSignal.timeout(2000)})).json();
    assert.ok(skills.data.some((s:any)=>s.id==='agent-progress'&&typeof s.content==='string'&&s.content.includes('canonical planner')));
    assert.equal((await client.credential.list()).length,0,'no credential or model use');
    lifecycle('update',targets,{...payload,version:'0.3.0'});
    assert.equal(setup.status().activation,'reload-required');
    const reload=await fetch(`http://127.0.0.1:${port}/api/location/reload?${new URLSearchParams({'location[directory]':location.directory})}`,{method:'POST',headers:{...headers,'content-type':'application/json'},body:'{}',signal:AbortSignal.timeout(5000)});assert.equal(reload.ok,true);
    const updated=await ready('0.3.0');assert.equal(updated.storeId,active.storeId);assert.equal(updated.sourceId,active.sourceId);
    assert.notEqual(setup.status().activation,'reload-required');
    const removal=`${targets.configRoot}/plugins/agent-progress/remove.js`;
    const disable=spawnSync(process.execPath,[removal,'disable'],{encoding:'utf8',stdio:['ignore','pipe','ignore']});assert.equal(disable.status,0);assert.equal(JSON.parse(disable.stdout).captureEnabled,false);
    assert.equal((await status.inspect({}, {location,signal:AbortSignal.timeout(2000)})as any).captureEnabled,false);
    const remove=spawnSync(process.execPath,[removal,'remove-capture'],{encoding:'utf8',stdio:['ignore','pipe','ignore']});assert.equal(remove.status,0);assert.equal(JSON.parse(remove.stdout).historyRetained,true);assert.equal(existsSync(`${targets.storeRoot}/progress.sqlite`),true);
  }finally{
    setup?.close();
    if(child&&child.exitCode===null&&!child.signalCode){const exit=once(child,'exit');child.kill('SIGTERM');const timer=setTimeout(()=>child?.kill('SIGKILL'),5000);try{await exit;}finally{clearTimeout(timer);}}
    rmSync(root,{recursive:true,force:true});
  }
});
