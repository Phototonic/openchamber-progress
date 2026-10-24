/** Isolated, no-model candidate endurance diagnostic. Never discovers a live instance. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { OpenCode } from '@opencode/client';
import { Rpc } from '@opencode/plugin/rpc';
import { lifecycle } from '../setup/lifecycle.ts';
import { SetupController } from '../service/setup-controller.ts';
import { createProgressServer } from '../service/server.ts';

const artifact='build/artifacts/agent-progress-companion-0.2.3';
const binary='/tmp/opencode/agent-progress-probe-cli/opencode';
const evidence='evidence/backend/endurance-runtime.json';
const workloadMs=900_000, settlingMs=120_000, cadenceMs=15_000;
const hz=Number(spawnSync('getconf',['CLK_TCK'],{encoding:'utf8'}).stdout.trim());
const hash=(file:string)=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const diagnostic=Rpc.define({id:'agent-progress-endurance-diagnostic',methods:{probe:{input:{type:'object',additionalProperties:true},output:{type:'object',additionalProperties:true}}},events:{}});
const wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
const started=performance.now();
const result:any={artifact,hashes:Object.fromEntries(['build/companion/index.js','build/companion/SKILL.md','build/setup/main.js','package.json'].map(f=>[f,hash(`${artifact}/${f}`)])),runtime:'independent OpenCode 2.1.4',runtimeHash:hash(binary),command:'bun scripts/endurance-runtime.ts',configuration:{workloadMs,settlingMs,cadenceMs},windows:[],failureCycles:[],cleanup:[],limits:['No real OpenChamber renderer/extension host; HTTP replay and stopping a fixture service simulate traffic removal only. Designer owns actual host/UI soak.','Wrapper intercepts real report callback, bypassing model/tool dispatch; production candidate payload bytes remain unchanged.','Two independent runtime fixtures run concurrently; matched no-companion control gets the same session lookup/reload cadence but no progress reports or service reads.','CPU is process-specific /proc tick deltas, not whole-host responsiveness; no forced GC. RSS includes runtime allocator/cache effects.','Bun process-wide active handles/resources may be incomplete; resource inventories are diagnostic rather than exact timer ownership proof.','A bounded 15-minute workload plus two-minute settling window cannot disprove an hours-long leak.']};
// Validate artifact/runtime inputs before allocating a fixture; ignored output is local-only.
fs.mkdirSync(path.dirname(evidence),{recursive:true,mode:0o700});
const root=fs.mkdtempSync('/tmp/opencode/agent-progress-endurance-');
type Fixture={mode:string;dir:string;child:ReturnType<typeof spawn>;client:ReturnType<typeof OpenCode.make>;rpc:any;location:{directory:string};baseUrl:string;headers:Record<string,string>;sessions:any[];counts:{gets:number;reports:number;reloads:number;service:number};};
const fixtures:Fixture[]=[];
result.command='node --experimental-strip-types scripts/endurance-runtime.ts (explicit preinstalled Node 24 binary; node not on shell PATH)';
result.harnessRuntime=process.version;
let server:ReturnType<typeof createProgressServer>|undefined, setup:SetupController|undefined;
let serviceRequests=0,serviceUrl='';
function sample(pid:number){
  const stat=fs.readFileSync(`/proc/${pid}/stat`,'utf8').split(') ')[1]!.split(' ');
  const status=fs.readFileSync(`/proc/${pid}/status`,'utf8');
  const fds=fs.readdirSync(`/proc/${pid}/fd`);let progressSqliteFDs=0;
  for(const fd of fds)try{const target=fs.readlinkSync(`/proc/${pid}/fd/${fd}`);if(target.startsWith(root)&&/progress\.sqlite(?:-|$)/.test(target))progressSqliteFDs++;}catch{}
  return {elapsedMs:performance.now()-started,cpuMs:(Number(stat[11])+Number(stat[12]))*1000/hz,rssKB:Number(status.match(/^VmRSS:\s+(\d+)/m)?.[1]??0),fds:fds.length,progressSqliteFDs,threads:Number(status.match(/^Threads:\s+(\d+)/m)?.[1]??0)};
}
function events(f:Fixture){return fs.existsSync(`${f.dir}/events.jsonl`)?fs.readFileSync(`${f.dir}/events.jsonl`,'utf8').trim().split('\n').filter(Boolean).map(x=>JSON.parse(x)):[];}
function lifecycleCounts(f:Fixture){const e=events(f);return Object.fromEntries(['setup','ready','failure','cleanup'].map(k=>[k,e.filter(x=>x.event===k).length]));}
function record(phase:string,probes?:any[]){
  result.windows.push({phase,elapsedMs:performance.now()-started,fixtures:fixtures.map((f,i)=>({mode:f.mode,...sample(f.child.pid!),lifecycle:lifecycleCounts(f),counts:{...f.counts},probe:probes?.[i]??null})),harness:{...sample(process.pid),memory:process.memoryUsage(),resources:process.getActiveResourcesInfo(),handles:(process as any)._getActiveHandles().length},serviceRequests});
  fs.writeFileSync(evidence,JSON.stringify(result,null,2));
}
async function inventory(f:Fixture,state:'active'|'failed'){
  const end=performance.now()+15_000;
  let last:any;
  while(performance.now()<end){
    assert.equal(f.child.exitCode,null,'owned runtime exited');
    try{const list=await f.client.plugin.list({location:f.location} as any,{signal:AbortSignal.timeout(1000)});last=list.data;if(list.data.find(p=>p.id==='agent-progress')?.state.status===state)return;}catch(error){last=String(error);}
    await wait(50);
  }
  result.lastInventory=JSON.parse(JSON.stringify(last??null).replaceAll(root,'<fixture>').replaceAll(path.resolve('.'),'<repository>'));
  throw new Error('bounded owned plugin inventory readiness timeout');
}
async function probe(f:Fixture,input:any={}){return f.rpc.probe(input,{location:f.location,signal:AbortSignal.timeout(3000)});}
async function reload(f:Fixture){
  const r=await fetch(`${f.baseUrl}/api/location/reload?${new URLSearchParams({'location[directory]':f.location.directory})}`,{method:'POST',headers:{...f.headers,'content-type':'application/json'},body:'{}',signal:AbortSignal.timeout(5000)});
  assert.ok(r.ok);await r.arrayBuffer();f.counts.reloads++;
  if(f.mode==='companion')await inventory(f,fs.existsSync(`${f.dir}/fail`)?'failed':'active');
  else await f.client.session.list({location:f.location} as any,{signal:AbortSignal.timeout(3000)});
}
async function report(f:Fixture,request:any){const r:any=await probe(f,{sessionID:f.sessions[0].id,request});const receipt=JSON.parse(r.result.content);assert.equal(receipt.error,undefined,'real callback returned error');f.counts.reports++;return receipt;}
try{
  assert.ok(hz>0);
  for(let dir=path.dirname(root);;dir=path.dirname(dir)){
    for(const name of ['opencode.json','opencode.jsonc','.opencode/opencode.json','.opencode/opencode.jsonc'])assert.equal(fs.existsSync(path.join(dir,name)),false,'ancestor config disallows isolation');
    if(dir===path.dirname(dir))break;
  }
  assert.equal(fs.existsSync('/etc/opencode'),false,'system config disallows isolation');
  for(const mode of ['baseline','companion']){
    const dir=`${root}/${mode}`;
    for(const name of ['config/opencode','data/opencode','home','cache','state','runtime','tmp','project'])fs.mkdirSync(`${dir}/${name}`,{recursive:true,mode:0o700});
    if(mode==='companion'){
      const payload={plugin:fs.readFileSync(`${artifact}/build/companion/index.js`,'utf8'),guidance:fs.readFileSync(`${artifact}/build/companion/SKILL.md`,'utf8'),removal:fs.readFileSync(`${artifact}/build/setup/main.js`,'utf8'),version:'0.2.3'};
      lifecycle('install',{configRoot:`${dir}/config/opencode`,dataRoot:`${dir}/data/opencode`,storeRoot:`${dir}/store`,confirmed:true},payload);
      const packageRoot=`${dir}/config/opencode/plugins/agent-progress`;
      fs.copyFileSync(`${packageRoot}/progress-binding.json`,`${dir}/service-binding.json`);
      setup=new SetupController(`${dir}/service-binding.json`,()=>payload);
      // Instrument the fixture loader, NOT the immutable artifact payload. The original
      // loader still verifies payload hashes and imports the exact candidate bytes.
      fs.renameSync(`${packageRoot}/index.js`,`${packageRoot}/loader.js`);
      const rpcPath=new URL(import.meta.resolve('@opencode/plugin/rpc')).pathname;
      fs.writeFileSync(`${packageRoot}/index.js`,`import original from './loader.js';
import {Rpc} from ${JSON.stringify(rpcPath)};
import {appendFileSync,existsSync} from 'node:fs';
const contract=Rpc.define({id:'agent-progress-endurance-diagnostic',methods:{probe:{input:{type:'object',additionalProperties:true},output:{type:'object',additionalProperties:true}}},events:{}});
const log=event=>appendFileSync(process.env.ENDURANCE_EVENTS,JSON.stringify({event})+'\\n');
export default {...original,async setup(ctx){
 log('setup');let execute;
 const tool=new Proxy(ctx.tool,{get(target,key){if(key!=='transform')return Reflect.get(target,key);return callback=>target.transform(editor=>callback(new Proxy(editor,{get(e,k){if(k!=='add')return typeof e[k]==='function'?e[k].bind(e):e[k];return spec=>{if(spec.name==='report')execute=spec.execute;return e.add(spec);};}})));}});
 const rpc={...ctx.rpc,register:async(...args)=>{const value=await ctx.rpc.register(...args);if(existsSync(process.env.ENDURANCE_FAIL))throw new Error('synthetic post-registration failure');return value;}};
 let dispose;try{dispose=await original.setup({...ctx,tool,rpc});}catch(error){log('failure');throw error;}
 await ctx.rpc.register(contract,{probe:async input=>input.request?{result:await execute(input.request,{sessionID:input.sessionID,agent:'diagnostic',messageID:'msg_diagnostic',id:'tool_diagnostic'})}:{resources:typeof process.getActiveResourcesInfo==='function'?process.getActiveResourcesInfo():null,handles:typeof process._getActiveHandles==='function'?process._getActiveHandles().length:null}});
 log('ready');return async()=>{await dispose?.();log('cleanup');};
}};`);
      // Keep diagnostic API dependencies self-contained as in performance-runtime.ts;
      // leave the candidate loader external so payload bytes stay untouched.
      const built=spawnSync('bun',['build',`${packageRoot}/index.js`,'--target=node','--format=esm','--external','./loader.js',`--outfile=${dir}/wrapper.js`],{encoding:'utf8'});
      assert.equal(built.status,0,'diagnostic-only wrapper build');
      fs.copyFileSync(`${dir}/wrapper.js`,`${packageRoot}/index.js`);
    }
    const reservation=createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');const port=(reservation.address() as any).port;await new Promise<void>(resolve=>reservation.close(()=>resolve()));
    const env={PATH:'/usr/bin:/bin',HOME:`${dir}/home`,XDG_CONFIG_HOME:`${dir}/config`,XDG_DATA_HOME:`${dir}/data`,XDG_CACHE_HOME:`${dir}/cache`,XDG_STATE_HOME:`${dir}/state`,XDG_RUNTIME_DIR:`${dir}/runtime`,TMPDIR:`${dir}/tmp`,OPENCODE_PASSWORD:'synthetic-local-only',DBUS_SESSION_BUS_ADDRESS:'disabled:',ENDURANCE_EVENTS:`${dir}/events.jsonl`,ENDURANCE_FAIL:`${dir}/fail`};
    const child=spawn(binary,['serve','--hostname','127.0.0.1','--port',String(port)],{cwd:`${dir}/project`,env,stdio:'ignore'});
    const headers={authorization:`Basic ${Buffer.from('opencode:synthetic-local-only').toString('base64')}`};
    const baseUrl=`http://127.0.0.1:${port}`;const client=OpenCode.make({baseUrl,headers});
    const f:Fixture={mode,dir,child,client,rpc:client.rpc(diagnostic),baseUrl,headers,location:{directory:`${dir}/project`},sessions:[],counts:{gets:0,reports:0,reloads:0,service:0}};fixtures.push(f);
    let spawnError=false;child.once('error',()=>{spawnError=true;});
    const end=performance.now()+15_000;let ready=false;
    while(performance.now()<end){assert.equal(spawnError,false);assert.equal(child.exitCode,null);try{await client.session.list({location:f.location} as any,{signal:AbortSignal.timeout(500)});ready=true;break;}catch{}await wait(50);}
    assert.ok(ready,'owned server readiness');
    if(mode==='companion'){await inventory(f,'active');await probe(f);}
    for(let i=0;i<3;i++)f.sessions.push(await client.session.create({location:f.location} as any,{signal:AbortSignal.timeout(3000)}));
  }
  const active=fixtures[1]!;
  for(let i=0;i<3;i++){
    fs.writeFileSync(`${active.dir}/fail`,'synthetic');await reload(active);
    const failed=sample(active.child.pid!);assert.equal(failed.progressSqliteFDs,0,'failed activation must close progress SQLite');
    const skills=await(await fetch(`${active.baseUrl}/api/skill?${new URLSearchParams({'location[directory]':active.location.directory})}`,{headers:active.headers,signal:AbortSignal.timeout(3000)})).json();
    assert.equal(skills.data.some((s:any)=>s.id==='agent-progress'),false,'partial skill registration rollback');
    await assert.rejects(()=>probe(active),'failed diagnostic registration unavailable');
    fs.rmSync(`${active.dir}/fail`);await reload(active);await probe(active);
    const recovered=sample(active.child.pid!);assert.equal(recovered.progressSqliteFDs,1,'single recovered reporter DB');
    result.failureCycles.push({failed,recovered,lifecycle:lifecycleCounts(active)});
  }
  server=createProgressServer(undefined,'synthetic-service-only',undefined,setup);server.on('request',()=>serviceRequests++);server.listen(0,'127.0.0.1');await once(server,'listening');serviceUrl=`http://127.0.0.1:${(server.address() as any).port}`;
  await report(active,{op:'start',plan:'endurance',oid:'start',rev:0,title:'Synthetic bounded endurance',items:[{id:'a',kind:'task',title:'Synthetic task'}]});let rev=1;
  const workStart=performance.now();record('workload-start',await Promise.all(fixtures.map(f=>f.mode==='companion'?probe(f):null)));
  for(let tick=0;tick<workloadMs/cadenceMs;tick++){
    const tickStart=performance.now();
    for(const f of fixtures){
      for(let i=0;i<3;i++){await f.client.session.get({sessionID:f.sessions[(tick+i)%3]!.id},{signal:AbortSignal.timeout(3000)});f.counts.gets++;}
      if((tick+1)%10===0)await reload(f);
    }
    const receipt=await report(active,{op:'change',plan:'endurance',oid:`tick${tick}`,rev,changes:[{id:'a',status:tick%2===0?'working':'pending'}]});rev=receipt.rev;
    for(let frame=0;frame<3;frame++)for(const route of ['/v1/setup','/v1/plans',`/v1/plans?session=${active.sessions[tick%3].id}`]){
      const response=await fetch(`${serviceUrl}${route}`,{headers:{authorization:'Bearer synthetic-service-only'},signal:AbortSignal.timeout(3000)});assert.ok(response.ok);await response.arrayBuffer();active.counts.service++;
    }
    const probes=await Promise.all(fixtures.map(f=>f.mode==='companion'?probe(f):null));
    record(`workload-${tick+1}`,probes);
    assert.ok(performance.now()-tickStart<cadenceMs,'work exceeds low-load cadence; stop rather than pile up');
    // This is measured workload cadence, not a readiness sleep. Readiness above
    // waits on bounded API/plugin states; no fixed delays conceal setup failures.
    await wait(Math.max(0,workStart+(tick+1)*cadenceMs-performance.now()));
  }
  result.workloadElapsedMs=performance.now()-workStart;
  await new Promise<void>(resolve=>server!.close(()=>resolve()));setup!.close();
  const last=await report(active,{op:'read',plan:'endurance'});assert.equal(last.rev,rev,'companion reports after simulated host service removal');
  const stoppedRequests=serviceRequests;const settleStart=performance.now();record('service-stopped-settling-start');
  for(let tick=1;tick<=4;tick++){await wait(Math.max(0,settleStart+tick*30_000-performance.now()));record(`settled-${tick*30}s`);assert.equal(serviceRequests,stoppedRequests);}
  result.settlingElapsedMs=performance.now()-settleStart;
  record('settled-final-probe',await Promise.all(fixtures.map(f=>f.mode==='companion'?probe(f):null)));
  assert.equal(sample(active.child.pid!).progressSqliteFDs,1,'one live reporter after settling');
  const counts=lifecycleCounts(active);assert.equal(counts.setup,counts.ready+counts.failure);assert.equal(counts.ready,counts.cleanup+1,'one active setup, disposed predecessors');
  result.outcome='bounded run passed semantic lifecycle/DB/service invariants; inspect resource trends, not an hours-long cure claim';
}catch(error){result.outcome='failed';result.error=error instanceof Error?error.message.replaceAll(root,'<fixture>'):'unknown';process.exitCode=1;}
finally{
  if(server?.listening)await new Promise<void>(resolve=>server!.close(()=>resolve()));setup?.close();
  for(const f of fixtures){
    let forced=false;
    if(f.child.exitCode===null&&!f.child.signalCode){const exit=once(f.child,'exit');f.child.kill('SIGTERM');const timer=setTimeout(()=>{forced=true;f.child.kill('SIGKILL');},5000);try{await exit;}finally{clearTimeout(timer);}}
    result.cleanup.push({mode:f.mode,exitCode:f.child.exitCode,signal:f.child.signalCode,forced,lifecycle:lifecycleCounts(f),counts:f.counts,procExists:fs.existsSync(`/proc/${f.child.pid}`)});
  }
  fs.rmSync(root,{recursive:true,force:true});result.fixtureRemoved=!fs.existsSync(root);result.totalElapsedMs=performance.now()-started;
  fs.writeFileSync(evidence,JSON.stringify(result,null,2));console.log(JSON.stringify({outcome:result.outcome,evidence,totalElapsedMs:result.totalElapsedMs,cleanup:result.cleanup}));
}
