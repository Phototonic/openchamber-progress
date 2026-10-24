/** Bounded no-model diagnostics: fresh independent OpenCode only; NEVER managed service discovery. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn,spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { OpenCode } from '@opencode/client';
import { Rpc } from '@opencode/plugin/rpc';
import { lifecycle } from '../setup/lifecycle.ts';
import { SetupController } from '../service/setup-controller.ts';
import { createProgressServer } from '../service/server.ts';

const binary='/tmp/opencode/agent-progress-probe-cli/opencode';
const root=fs.mkdtempSync('/tmp/opencode/agent-progress-performance-runtime-');
const hz=Number(spawnSync('getconf',['CLK_TCK'],{encoding:'utf8'}).stdout.trim());
assert.ok(hz>0);
function sample(pid:number){
  const stat=fs.readFileSync(`/proc/${pid}/stat`,'utf8').split(') ')[1]!.split(' ');
  const status=fs.readFileSync(`/proc/${pid}/status`,'utf8');
  const fds=fs.readdirSync(`/proc/${pid}/fd`);let sqliteFDs=0;
  for(const fd of fds){try{if(fs.readlinkSync(`/proc/${pid}/fd/${fd}`).startsWith(root)&&/progress\.sqlite(?:-|$)/.test(fs.readlinkSync(`/proc/${pid}/fd/${fd}`)))sqliteFDs++;}catch{}}
  return {at:performance.now(),cpuMs:(Number(stat[11])+Number(stat[12]))*1000/hz,rssKB:Number(status.match(/^VmRSS:\s+(\d+)/m)?.[1]??0),threads:Number(status.match(/^Threads:\s+(\d+)/m)?.[1]??0),fds:fds.length,progressSqliteFDs:sqliteFDs};
}
const diagnostic=Rpc.define({id:'agent-progress-performance-diagnostic',methods:{probe:{input:{type:'object',additionalProperties:true},output:{type:'object',additionalProperties:true}}},events:{}});
const output:any[]=[];
try{
  assert.ok(fs.existsSync(binary));
  // Refuse inherited project/system config rather than read it.
  for(let dir=path.dirname(root);;dir=path.dirname(dir)){
    for(const name of ['opencode.json','opencode.jsonc','.opencode/opencode.json','.opencode/opencode.jsonc'])assert.equal(fs.existsSync(path.join(dir,name)),false,'ancestor config disallows isolated run');
    if(dir===path.dirname(dir))break;
  }
  assert.equal(fs.existsSync('/etc/opencode'),false,'system config disallows isolated run');
  // Wrapper records only lifecycle counts/resources and permits a no-model call into the actual report callback.
  // Production files are imported unchanged. This does not claim full host tool-dispatch fidelity.
  const entry=`import original from ${JSON.stringify(path.resolve(process.env.AGENT_PROGRESS_PERF_ENTRY??'plugin/index.ts'))};
import {Rpc} from ${JSON.stringify(path.resolve('node_modules/@opencode/plugin/dist/rpc.js'))};
import {appendFileSync} from 'node:fs';
const log=(event)=>appendFileSync(process.env.AGENT_PROGRESS_PERF_EVENTS,JSON.stringify({event})+'\\n');
const contract=Rpc.define({id:'agent-progress-performance-diagnostic',methods:{probe:{input:{type:'object',additionalProperties:true},output:{type:'object',additionalProperties:true}}},events:{}});
export default {...original,async setup(ctx){
 log('setup');let execute;let transforms=0;let hooks=0;const t=performance.now();
 const tool=new Proxy(ctx.tool,{get(target,key){if(key!=='transform')return Reflect.get(target,key);return (callback)=>target.transform(editor=>callback(new Proxy(editor,{get(e,k){if(k!=='add')return typeof e[k]==='function'?e[k].bind(e):e[k];return spec=>{if(spec.name==='report')execute=spec.execute;return e.add(spec);};}})));}});
 const dispose=process.env.AGENT_PROGRESS_PERF_LOAD_ONLY==='1'?()=>{}:await original.setup({...ctx,tool});
 log('ready');const setupMs=performance.now()-t;
 await ctx.rpc.register(contract,{probe:async(input)=>{if(input.request){const t=performance.now();const result=await execute(input.request,{sessionID:input.sessionID,agent:'diagnostic',messageID:'msg_diagnostic',id:'tool_diagnostic'});return {reportMs:performance.now()-t,result};}return {setupMs,resources:typeof process.getActiveResourcesInfo==='function'?process.getActiveResourcesInfo():null,handles:typeof process._getActiveHandles==='function'?process._getActiveHandles().length:null};}});
 return async()=>{await dispose?.();log('cleanup');};
}};`;
  // Resolve package's actual export instead of assuming its internal filename.
  const resolved=import.meta.resolve('@opencode/plugin/rpc');
  fs.writeFileSync(`${root}/entry.ts`,entry.replace(JSON.stringify(path.resolve('node_modules/@opencode/plugin/dist/rpc.js')),JSON.stringify(new URL(resolved).pathname)));
  const built=spawnSync('bun',['build',`${root}/entry.ts`,'--target=node','--format=esm',`--outfile=${root}/plugin.js`],{encoding:'utf8'});
  assert.equal(built.status,0,'diagnostic wrapper build failed');
  const payload={plugin:fs.readFileSync(`${root}/plugin.js`,'utf8'),guidance:fs.readFileSync('plugin/SKILL.md','utf8'),removal:fs.readFileSync('build/setup/main.js','utf8'),version:'0.2.2'};
  for(const mode of process.env.AGENT_PROGRESS_PERF_QUICK==='1'?['companion']:['baseline','load-only','companion']){
    const companion=mode!=='baseline';const active=mode==='companion';
    const dir=`${root}/${mode}`;
    for(const name of ['config/opencode','data/opencode','home','cache','state','runtime','tmp','project'])fs.mkdirSync(`${dir}/${name}`,{recursive:true,mode:0o700});
    let child:ReturnType<typeof spawn>|undefined;let setup:SetupController|undefined;let server:ReturnType<typeof createProgressServer>|undefined;
    try{
      if(companion){lifecycle('install',{configRoot:`${dir}/config/opencode`,dataRoot:`${dir}/data/opencode`,storeRoot:`${dir}/store`,confirmed:true},payload);fs.copyFileSync(`${dir}/config/opencode/plugins/agent-progress/progress-binding.json`,`${dir}/service-binding.json`);setup=new SetupController(`${dir}/service-binding.json`,()=>payload);}
      const env={PATH:'/usr/bin:/bin',HOME:`${dir}/home`,XDG_CONFIG_HOME:`${dir}/config`,XDG_DATA_HOME:`${dir}/data`,XDG_CACHE_HOME:`${dir}/cache`,XDG_STATE_HOME:`${dir}/state`,XDG_RUNTIME_DIR:`${dir}/runtime`,TMPDIR:`${dir}/tmp`,OPENCODE_PASSWORD:'synthetic-local-only',DBUS_SESSION_BUS_ADDRESS:'disabled:',AGENT_PROGRESS_PERF_EVENTS:`${dir}/events.jsonl`,AGENT_PROGRESS_PERF_LOAD_ONLY:mode==='load-only'?'1':'0'};
      const reservation=createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');const port=(reservation.address() as any).port;await new Promise<void>(resolve=>reservation.close(()=>resolve()));
      const start=performance.now();child=spawn(binary,['serve','--hostname','127.0.0.1','--port',String(port)],{cwd:`${dir}/project`,env,stdio:'ignore'});
      let spawnFailed=false;child.once('error',()=>{spawnFailed=true;});
      const headers={authorization:`Basic ${Buffer.from('opencode:synthetic-local-only').toString('base64')}`};
      const baseUrl=`http://127.0.0.1:${port}`;const client=OpenCode.make({baseUrl,headers});const location={directory:`${dir}/project`};
      const rpc=client.rpc(diagnostic);
      let ready=false;const end=Date.now()+15000;
      while(Date.now()<end){assert.equal(spawnFailed,false);assert.equal(child.exitCode,null,'owned runtime exited');try{
        if(companion)await rpc.probe({}, {location,signal:AbortSignal.timeout(500)});
        else await client.session.list({location} as any,{signal:AbortSignal.timeout(500)});
        ready=true;break;
      }catch{}await new Promise(resolve=>setTimeout(resolve,50));}
      assert.ok(ready,'isolated runtime readiness timed out');const readyMs=performance.now()-start;
      const phases:any[]=[];
      async function phase(name:string,action:()=>Promise<unknown>){console.error(`${companion?'companion':'baseline'}:${name}:start`);const before=sample(child!.pid!);const ownCpu=process.cpuUsage();const ownRss=process.memoryUsage().rss;const t=performance.now();await action();const after=sample(child!.pid!);const ownDelta=process.cpuUsage(ownCpu);phases.push({name,elapsedMs:performance.now()-t,cpuDeltaMs:after.cpuMs-before.cpuMs,before,after,harnessAndService:{cpuMs:(ownDelta.user+ownDelta.system)/1000,rssBefore:ownRss,rssAfter:process.memoryUsage().rss}});console.error(`${companion?'companion':'baseline'}:${name}:done`);}
      const idle=async()=>{for(let i=0;i<3;i++)await phase(`idle-window-${i}`,()=>new Promise(resolve=>setTimeout(resolve,2000)));};
      await idle();
      const sessions=[];for(let i=0;i<3;i++)sessions.push(await client.session.create({location} as any,{signal:AbortSignal.timeout(3000)}));
      if(active){
        const status=await client.rpc((await import('../plugin/status.ts')).ProgressStatus).inspect({}, {location,signal:AbortSignal.timeout(2000)}) as any;
        assert.equal(status.toolAvailable,true);assert.equal(status.codemodeDisabled,true);
        const skills=await(await fetch(`${baseUrl}/api/skill?${new URLSearchParams({'location[directory]':location.directory})}`,{headers,signal:AbortSignal.timeout(2000)})).json();
        assert.ok(skills.data.some((s:any)=>s.id==='agent-progress'&&s.content.includes('canonical planner')),'real runtime skill registration');
      }
      await phase('60-session-get-switches',async()=>{for(let i=0;i<60;i++)await client.session.get({sessionID:sessions[i%3]!.id},{signal:AbortSignal.timeout(3000)});});
      const setupEventsAfterSessionSwitches=companion?fs.readFileSync(`${dir}/events.jsonl`,'utf8').trim().split('\n').map(line=>JSON.parse(line).event):[];
      let reports:any[]=[];let pluginProbe:any=null;
      if(companion)pluginProbe=await rpc.probe({}, {location,signal:AbortSignal.timeout(2000)});
      if(active){
        await phase('20-actual-plugin-report-callbacks-no-model',async()=>{for(let i=0;i<20;i++){
          const result:any=await rpc.probe({sessionID:sessions[0]!.id,request:{op:'start',plan:`perf${i}`,oid:`start${i}`,rev:0,title:'Synthetic diagnostic',items:[{id:'a',kind:'task',title:'Synthetic task'}]}},{location,signal:AbortSignal.timeout(2000)});
          assert.equal(JSON.parse(result.result.content).rev,1,'actual plugin report must commit');reports.push(result.reportMs);
        }});
      }
      const reloadSamples:any[]=[];
      for(let batch=0;batch<(active&&process.env.AGENT_PROGRESS_PERF_QUICK!=='1'?3:1);batch++){
      await phase(`10-explicit-location-reloads-batch-${batch}`,async()=>{for(let i=0;i<10;i++){
          const r=await fetch(`${baseUrl}/api/location/reload?${new URLSearchParams({'location[directory]':location.directory})}`,{method:'POST',headers:{...headers,'content-type':'application/json'},body:'{}',signal:AbortSignal.timeout(5000)});assert.ok(r.ok);await r.arrayBuffer();
          if(companion)await rpc.probe({}, {location,signal:AbortSignal.timeout(2000)});
          else await client.session.list({location} as any,{signal:AbortSignal.timeout(2000)});
          reloadSamples.push(sample(child!.pid!));
        }});
      await phase('post-reload-idle-1',()=>new Promise(resolve=>setTimeout(resolve,2000)));
      await phase('post-reload-idle-2',()=>new Promise(resolve=>setTimeout(resolve,2000)));
      }
      if(active){
        server=createProgressServer(undefined,'synthetic-service-only',undefined,setup);let requests=0;server.on('request',()=>requests++);server.listen(0,'127.0.0.1');await once(server,'listening');const servicePort=(server.address() as any).port;
        await phase('20-three-surface-frame-replays-NOT-actual-UI',async()=>{for(let i=0;i<20;i++)for(let frame=0;frame<3;frame++)for(const route of ['/v1/setup','/v1/plans','/v1/plans?session='+sessions[i%3]!.id]){
          const r=await fetch(`http://127.0.0.1:${servicePort}${route}`,{headers:{authorization:'Bearer synthetic-service-only'}});assert.ok(r.ok);await r.arrayBuffer();
        }});
        phases.at(-1).serviceRequests=requests;
        await phase('UI-traffic-stopped-companion-remains-idle',()=>new Promise(resolve=>setTimeout(resolve,4000)));
        phases.at(-1).additionalServiceRequests=requests-180;
        assert.equal(requests,180,'service should not initiate its own HTTP reads');
        // UI removal must not be mistaken for companion removal. Stop only the owned
        // fixture service/selector connection; the separately loaded plugin stays up.
        await phase('fixture-host-service-stopped-companion-report-still-works',async()=>{
          await new Promise<void>(resolve=>server!.close(()=>resolve()));setup!.close();
          const result:any=await rpc.probe({sessionID:sessions[0]!.id,request:{op:'start',plan:'after-host-removal',oid:'after-host-removal-start',rev:0,title:'Synthetic persistence control',items:[{id:'a',kind:'task',title:'Synthetic task'}]}},{location,signal:AbortSignal.timeout(2000)});
          assert.equal(JSON.parse(result.result.content).rev,1,'independent companion must still report after fixture host service stops');
        });
        await phase('fixture-host-absent-companion-idle-4s',()=>new Promise(resolve=>setTimeout(resolve,4000)));
        phases.at(-1).additionalServiceRequests=requests-180;
        const soakMs=Number(process.env.AGENT_PROGRESS_PERF_SOAK_MS??0);
        assert.ok(Number.isFinite(soakMs)&&soakMs>=0&&soakMs<=180_000,'bounded diagnostic soak');
        for(let elapsed=0;elapsed<soakMs;elapsed+=20_000){
          await phase(`low-load-soak-${elapsed/20_000}`,async()=>{
            const result:any=await rpc.probe({sessionID:sessions[0]!.id,request:{op:'read',plan:'after-host-removal'}},{location,signal:AbortSignal.timeout(2000)});
            assert.equal(JSON.parse(result.result.content).rev,1);
            await new Promise(resolve=>setTimeout(resolve,Math.min(20_000,soakMs-elapsed)));
          });
        }
      }
      const events=companion?fs.readFileSync(`${dir}/events.jsonl`,'utf8').trim().split('\n').map(line=>JSON.parse(line).event):[];
      output.push({mode:active?'companion-and-controlled-service-replay':companion?'same-bundle-load-only-no-production-setup':'no-extension-no-companion',readyMs,phases,reloadSamples,pluginProbe,reportMs:reports,setupsAfterSessionSwitches:setupEventsAfterSessionSwitches.filter(x=>x==='setup').length,lifecycle:{setups:events.filter(x=>x==='setup').length,ready:events.filter(x=>x==='ready').length,cleanups:events.filter(x=>x==='cleanup').length},limits:['no actual OpenChamber renderer/extension host; replay is not UI+companion result','proc CPU uses interval deltas, clock tick granularity','wrapper calls real report callback with actual session identity but bypasses host model/tool dispatch','diagnostic wrapper adds one RPC and lifecycle markers; resources are process-wide; Bun active handles/resources may be incomplete']});
    }finally{
      if(server?.listening)await new Promise<void>(resolve=>server!.close(()=>resolve()));setup?.close();
      if(child&&child.exitCode===null&&!child.signalCode){const exit=once(child,'exit');child.kill('SIGTERM');const timer=setTimeout(()=>child?.kill('SIGKILL'),5000);try{await exit;}finally{clearTimeout(timer);}}
    }
  }
  console.log(JSON.stringify({runtime:'independent-OpenCode-2.1.4',output,cleanup:'all owned child processes stopped and new fixture removed in finally'},null,2));
}finally{fs.rmSync(root,{recursive:true,force:true});}
