import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn,spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { OpenCode } from '@opencode/client';
import { ProgressStatus } from '../../plugin/status.ts';
import { lifecycle } from '../../setup/lifecycle.ts';

test('pinned runtime rolls back partial native hook/RPC registrations; failed setup leaves no SQLite handle and recovers',{timeout:45000},async()=>{
  const root=fs.mkdtempSync('/tmp/opencode/agent-progress-plugin-failure-runtime-');let child:ReturnType<typeof spawn>|undefined;
  try{
    for(let dir=path.dirname(root);;dir=path.dirname(dir)){for(const name of ['opencode.json','opencode.jsonc','.opencode/opencode.json','.opencode/opencode.jsonc'])assert.equal(fs.existsSync(path.join(dir,name)),false,'ancestor config not allowed');if(dir===path.dirname(dir))break;}
    assert.equal(fs.existsSync('/etc/opencode'),false,'system config not allowed');
    for(const name of ['config/opencode','data/opencode','home','cache','state','runtime','tmp','project'])fs.mkdirSync(`${root}/${name}`,{recursive:true,mode:0o700});
    const wrapper=`import original from ${JSON.stringify(path.resolve('plugin/index.ts'))};
import {existsSync,appendFileSync,readFileSync} from 'node:fs';
export default {...original,async setup(ctx){
 const fails=stage=>existsSync(process.env.PERF_FAILURE_MARKER)&&readFileSync(process.env.PERF_FAILURE_MARKER,'utf8')===stage;
 const hook=domain=>async(...args)=>{const result=await ctx[domain].hook(...args);if(fails(domain))throw new Error('synthetic post-hook-registration failure');return result;};
 const rpc={...ctx.rpc,register:async(...args)=>{const result=await ctx.rpc.register(...args);if(fails('rpc'))throw new Error('synthetic post-registration failure');return result;}};
 try{return await original.setup({...ctx,tool:{...ctx.tool,hook:hook('tool')},session:{...ctx.session,hook:hook('session')},rpc});}catch(error){appendFileSync(process.env.PERF_FAILURE_EVENTS,'failure\\n');throw error;}
}};`;
    fs.writeFileSync(`${root}/entry.ts`,wrapper);
    assert.equal(spawnSync('bun',['build',`${root}/entry.ts`,'--target=node','--format=esm',`--outfile=${root}/plugin.js`],{stdio:'ignore'}).status,0);
    lifecycle('install',{configRoot:`${root}/config/opencode`,dataRoot:`${root}/data/opencode`,storeRoot:`${root}/store`,confirmed:true},{plugin:fs.readFileSync(`${root}/plugin.js`,'utf8'),guidance:fs.readFileSync('plugin/SKILL.md','utf8'),removal:'// unused fixture',version:'0.2.2'});
    fs.writeFileSync(`${root}/fail`,'tool');
    const reservation=createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');const port=(reservation.address() as any).port;await new Promise<void>(resolve=>reservation.close(()=>resolve()));
    const env={PATH:'/usr/bin:/bin',HOME:`${root}/home`,XDG_CONFIG_HOME:`${root}/config`,XDG_DATA_HOME:`${root}/data`,XDG_CACHE_HOME:`${root}/cache`,XDG_STATE_HOME:`${root}/state`,XDG_RUNTIME_DIR:`${root}/runtime`,TMPDIR:`${root}/tmp`,OPENCODE_PASSWORD:'synthetic-local-only',DBUS_SESSION_BUS_ADDRESS:'disabled:',PERF_FAILURE_MARKER:`${root}/fail`,PERF_FAILURE_EVENTS:`${root}/events`};
    const binary='/tmp/opencode/agent-progress-probe-cli/opencode';assert.ok(fs.existsSync(binary));
    child=spawn(binary,['serve','--hostname','127.0.0.1','--port',String(port)],{cwd:`${root}/project`,env,stdio:'ignore'});
    const headers={authorization:`Basic ${Buffer.from('opencode:synthetic-local-only').toString('base64')}`};
    const baseUrl=`http://127.0.0.1:${port}`;const client=OpenCode.make({baseUrl,headers});const location={directory:`${root}/project`};const rpc=client.rpc(ProgressStatus);
    const fds=()=>fs.readdirSync(`/proc/${child!.pid}/fd`).filter(fd=>{try{return fs.readlinkSync(`/proc/${child!.pid}/fd/${fd}`)===`${root}/store/progress.sqlite`;}catch{return false;}}).length;
    async function inventory(expected:'failed'|'active',failures:number){const end=Date.now()+15000;while(Date.now()<end){assert.equal(child!.exitCode,null);try{
      const list=await client.plugin.list({location} as any,{signal:AbortSignal.timeout(1000)});
      const p=list.data.find(p=>p.id==='agent-progress');const count=fs.existsSync(`${root}/events`)?fs.readFileSync(`${root}/events`,'utf8').trim().split('\n').length:0;
      if(p?.state.status===expected&&count===failures)return;
    }catch{}await new Promise(resolve=>setTimeout(resolve,50));}throw new Error('fixture inventory timeout');}
    const reload=async()=>{const r=await fetch(`${baseUrl}/api/location/reload?${new URLSearchParams({'location[directory]':location.directory})}`,{method:'POST',headers:{...headers,'content-type':'application/json'},body:'{}',signal:AbortSignal.timeout(5000)});assert.ok(r.ok);await r.arrayBuffer();};
    for(let failure=1;failure<=3;failure++){
      if(failure>1){fs.writeFileSync(`${root}/fail`,failure===2?'session':'rpc');await reload();}await inventory('failed',failure);
      assert.equal(fds(),0,'failed real runtime activation leaked SQLite');
      const skills=await(await fetch(`${baseUrl}/api/skill?${new URLSearchParams({'location[directory]':location.directory})}`,{headers,signal:AbortSignal.timeout(2000)})).json();
      assert.equal(skills.data.some((s:any)=>s.id==='agent-progress'),false,'host must roll back partial skill transform');
      await assert.rejects(()=>rpc.inspect({}, {location,signal:AbortSignal.timeout(2000)}),'partial status RPC must be unavailable');
    }
    fs.rmSync(`${root}/fail`);await reload();await inventory('active',3);
    const active:any=await rpc.inspect({}, {location,signal:AbortSignal.timeout(2000)});assert.equal(active.toolAvailable,true);assert.equal(active.codemodeDisabled,true);assert.equal(fds(),1);
    await reload();await inventory('active',3);assert.equal(fds(),1,'successful reload must dispose old connection');
  }finally{
    if(child&&child.exitCode===null&&!child.signalCode){const exit=once(child,'exit');child.kill('SIGTERM');const timer=setTimeout(()=>child?.kill('SIGKILL'),5000);try{await exit;}finally{clearTimeout(timer);}}
    fs.rmSync(root,{recursive:true,force:true});
  }
});
