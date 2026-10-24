/** Diagnostic only. Real HTTP + source service; no production monkey patches persist. */
import fs from 'node:fs';
import crypto from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { lifecycle } from '../../setup/lifecycle.ts';
import { SetupController } from '../../service/setup-controller.ts';
import { createProgressServer } from '../../service/server.ts';
import { Store,digest } from '../../shared/store.ts';
import { readBinding } from '../../shared/binding.ts';

const root=fs.mkdtempSync('/tmp/opencode/agent-progress-performance-service-');
const saved:Array<()=>void>=[];
let counts:Record<string,number>={};
function bump(k:string,n=1){counts[k]=(counts[k]??0)+n;}
function wrap(obj:any,key:string,fn:(original:any,args:any[])=>any){const original=obj[key];obj[key]=function(...args:any[]){return fn(original.bind(this),args);};saved.push(()=>{obj[key]=original;});}
function snapshot(){return {rss:process.memoryUsage().rss,resources:process.getActiveResourcesInfo().sort(),fds:fs.readdirSync('/proc/self/fd').length};}
const quantile=(a:number[],p:number)=>[...a].sort((a,b)=>a-b)[Math.min(a.length-1,Math.floor(a.length*p))];
let setup:SetupController|undefined;let server:ReturnType<typeof createProgressServer>|undefined;
const results:any[]=[];
try {
  for(const dir of ['config','data'])fs.mkdirSync(`${root}/${dir}`,{mode:0o700});
  const targets={configRoot:`${root}/config`,dataRoot:`${root}/data`,storeRoot:`${root}/store`,confirmed:true};
  const payload={plugin:fs.readFileSync('build/companion/index.js','utf8'),guidance:fs.readFileSync('plugin/SKILL.md','utf8'),removal:fs.readFileSync('build/setup/main.js','utf8'),version:'0.2.2'};
  lifecycle('install',targets,payload);
  fs.copyFileSync(`${root}/config/plugins/agent-progress/progress-binding.json`,`${root}/service-binding.json`);
  setup=new SetupController(`${root}/service-binding.json`,()=>payload);
  server=createProgressServer(undefined,'synthetic-performance-only',undefined,setup);
  server.listen(0,'127.0.0.1');await once(server,'listening');const port=(server.address() as any).port;
  const b=readBinding(`${root}/service-binding.json`);
  // Counts characterize work, not elapsed time; retain identical instrumentation for comparisons.
  for(const key of ['lstatSync','realpathSync','readFileSync'] as const)wrap(fs,key,(original,args)=>{
    const value=original(...args);bump(key);if(key==='readFileSync')bump('fileBytes',Buffer.byteLength(value));return value;
  });
  wrap(crypto,'createHash',(original,args)=>{bump('hashes');return original(...args);});
  wrap(DatabaseSync.prototype,'prepare',(original,args)=>{bump('prepare');if(args[0]==='PRAGMA user_version')bump('opens');return original(...args);});
  wrap(DatabaseSync.prototype,'exec',(original,args)=>{bump('exec');return original(...args);});
  wrap(DatabaseSync.prototype,'close',(original,args)=>{bump('closes');return original(...args);});
  for(const [obj,key] of [[SetupController.prototype,'current'],[SetupController.prototype,'status'],[Store.prototype,'list'],[Store.prototype,'detail'],[Store.prototype,'document'],[Store.prototype,'history']] as const)wrap(obj,key,(original,args)=>{const start=performance.now();try{return original(...args);}finally{bump(`${key}Ms`,performance.now()-start);}});
  syncBuiltinESMExports();
  const get=async(route:string,status=200)=>{const r=await fetch(`http://127.0.0.1:${port}${route}`,{headers:{authorization:'Bearer synthetic-performance-only'}});await r.arrayBuffer();assert.equal(r.status,status);};
  async function measure(name:string,routes:string[],repeats:number){
    counts={};const before=snapshot();const cpu=process.cpuUsage();const start=performance.now();const times:number[]=[];
    for(let i=0;i<repeats;i++){const t=performance.now();for(const route of routes)await get(route);times.push(performance.now()-t);}
    const elapsedMs=performance.now()-start;const usage=process.cpuUsage(cpu);const after=snapshot();
    const row={name,frames:repeats,requests:routes.length*repeats,elapsedMs,p50Ms:quantile(times,.5),p95Ms:quantile(times,.95),cpuMs:(usage.user+usage.system)/1000,work:{...counts},before,after};results.push(row);return row;
  }
  await get('/health');
  for(const plans of [0,200,2000]){
    if(plans){const s=new Store(b.database);const actor={sourceId:b.source.id,verifiedSource:true,sessionId:'ses_perf',directory:`${root}/project`,agent:'diagnostic',ancestry:[],parentId:null};
      for(let i=plans===2000?200:0;i<plans;i++)s.apply({op:'start',plan:`p${i}`,oid:`start${i}`,rev:0,title:'Synthetic plan',items:[{id:'a',title:'Synthetic task',kind:'task'}]},actor);s.close();}
    for(const route of ['/health','/v1/plans','/v1/plans?session=ses_perf','/v1/plans?session=ses_missing','/v1/setup'])await measure(`${plans}-plans:${route}`,[route],20);
  }
  for(const endpoint of ['plan','document','history'])await measure(`2000-plans:/v1/${endpoint}`,[`/v1/${endpoint}?source=${b.source.id}&plan=p0`],20);
  const captureStore=new Store(b.database);const captureText='x'.repeat(262_144);
  captureStore.apply({op:'bind',plan:'p0',oid:'capture',rev:1,source:'synthetic.md'},{sourceId:b.source.id,verifiedSource:true,sessionId:'ses_perf',directory:`${root}/project`,agent:'diagnostic',ancestry:[],parentId:null},{state:'captured',path:`${root}/project/synthetic.md`,canonicalPath:`${root}/project/synthetic.md`,text:captureText,hash:digest(captureText),checkedAt:new Date().toISOString()});captureStore.close();
  await measure('max-256KiB-captured-document-first-page',[`/v1/document?source=${b.source.id}&plan=p0`],20);
  const frame=['/v1/setup','/v1/plans?session=ses_perf','/v1/plans?directory='+encodeURIComponent(`${root}/project`)];
  await measure('one-frame-replay',frame,1);
  await measure('three-surfaces-replay-not-observed-UI',frame.concat(frame,frame),20);
  // Counterfactual: same real server/store queries, but no SetupController refresh on reads.
  const direct=new Store(b.database);direct.bindReads(b.source.id,true);
  const queryPlans=direct.db.prepare("EXPLAIN QUERY PLAN SELECT snapshot FROM plans WHERE json_extract(snapshot,'$.sessionId')=? ORDER BY source,id LIMIT 21").all('ses_missing').map(row=>({detail:row.detail}));
  const oldServer=server;await new Promise<void>(resolve=>oldServer.close(()=>resolve()));
  server=createProgressServer(direct,'synthetic-performance-only');server.listen(port,'127.0.0.1');await once(server,'listening');
  await measure('direct-store-counterfactual:/v1/plans',['/v1/plans'],20);
  await new Promise<void>(resolve=>server!.close(()=>resolve()));direct.close();
  server=createProgressServer(undefined,'synthetic-performance-only',undefined,setup);server.listen(port,'127.0.0.1');await once(server,'listening');
  // Distinct real retained releases, not fake manifest entries; history is a scaling variable.
  for(let i=1;i<8;i++)lifecycle('update',targets,{...payload,plugin:payload.plugin+`\n// diagnostic release ${i}\n`});
  const history=await measure('eight-retained-releases:/v1/setup',['/v1/setup'],20);
  // External fixture replacement: existing handle must not hide corruption; recovery must need no restart.
  fs.renameSync(b.database,b.database+'.saved');fs.writeFileSync(b.database,'not a sqlite database',{mode:0o600});
  counts={};await get('/health',503);await get('/health',503);const failedReadWork={...counts};
  fs.rmSync(b.database);fs.renameSync(b.database+'.saved',b.database);counts={};await get('/health');const recoveredReadWork={...counts};
  const idleBefore=snapshot();const idleCpu=process.cpuUsage();const idleStart=performance.now();
  await new Promise(resolve=>setTimeout(resolve,2000));const idleUsage=process.cpuUsage(idleCpu);
  const idle={durationMs:performance.now()-idleStart,cpuMs:(idleUsage.user+idleUsage.system)/1000,before:idleBefore,after:snapshot()};
  console.log(JSON.stringify({kind:'isolated-source-service',node:process.versions.node,payloadBytes:Buffer.byteLength(payload.plugin),results,queryPlans,recovery:{failedReads:2,failedStatus:503,failedReadWork,recoveredStatus:200,recoveredReadWork},idle,limits:['same process includes fetch client CPU/RSS','warm local filesystem; no renderer/host IPC','frame amplification is controlled replay, not actual UI evidence','query plan shown is a reduced session predicate, not full production query'],cleanup:'finally closes servers/stores and removes only this newly created fixture'},null,2));
  if(process.argv.includes('--assert-reuse'))assert.equal(history.work.opens??0,0,'diagnostic optimization target: settled setup reads should not reopen SQLite (not a pre-existing product contract)');
}finally {
  if(server?.listening)await new Promise<void>(resolve=>server!.close(()=>resolve()));setup?.close();
  for(const restore of saved.reverse())restore();syncBuiltinESMExports();fs.rmSync(root,{recursive:true,force:true});
}
