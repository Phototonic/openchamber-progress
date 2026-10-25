/** Bounded native-package HTTP join. Test-only external preload; never edits an artifact. */
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,chmodSync} from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import {mock} from 'node:test';
import {Store} from '../shared/store.ts';
import {readBinding} from '../shared/binding.ts';

const extension=path.resolve(process.argv[2]!);assert.ok(process.argv[2]);
const manifest=JSON.parse(readFileSync(`${extension}/package.json`,'utf8'));
assert.equal(manifest.version,'0.2.4');
const root=mkdtempSync('/tmp/opencode/agent-progress-live-package-');
for(const dir of ['home','config/opencode','data/opencode','state','selector'])mkdirSync(`${root}/${dir}`,{recursive:true,mode:0o700});
const entry=`${extension}/build/service/main.js`,hash=()=>createHash('sha256').update(readFileSync(entry)).digest('hex'),originalHash=hash();
let now=Date.now(),status=404,outbound=0;const release=()=>JSON.stringify({...manifest,version:'0.2.5'});
const metadata=http.createServer((req,res)=>{
  assert.equal(req.url,'/manifest');assert.equal(req.method,'GET');assert.equal(req.headers.accept,'application/vnd.github.raw+json');assert.equal(req.headers.authorization,undefined);assert.equal(req.headers.cookie,undefined);
  outbound++;res.writeHead(status,{'content-type':'application/json'});res.end(status===200?release():'inaccessible fixture metadata');
});
let child:ReturnType<typeof spawn>|undefined;
let phase='readiness';
try{
  metadata.listen(0,'127.0.0.1');await once(metadata,'listening');
  const clock=`${root}/clock.json`,preload=`${root}/preload.mjs`;writeFileSync(clock,JSON.stringify({now}));
  const origin=`http://127.0.0.1:${(metadata.address() as {port:number}).port}`;
  writeFileSync(preload,`// TEST ONLY: native entry unchanged; fixed official URL redirected to loopback.\nimport fs from 'node:fs';\nconst native=globalThis.fetch;globalThis.fetch=(input,init)=>{const url=typeof input==='string'?input:input instanceof URL?input.href:input.url;if(url!=='https://api.github.com/repos/Phototonic/openchamber-progress/contents/package.json?ref=main')throw new Error('fixture rejects nonallowlisted URL');return native(${JSON.stringify(origin+'/manifest')},init);};Date.now=()=>JSON.parse(fs.readFileSync(${JSON.stringify(clock)},'utf8')).now;\n`);
  const advance=(ms:number)=>{now+=ms;writeFileSync(clock,JSON.stringify({now}));};
  const reservation=createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');const port=(reservation.address() as {port:number}).port;await new Promise<void>(r=>reservation.close(()=>r()));
  const selector=`${root}/selector/binding.json`;
  child=spawn(process.execPath,['--import',preload,entry],{cwd:root,env:{PATH:process.env.PATH??'/usr/bin:/bin',HOME:`${root}/home`,XDG_CONFIG_HOME:`${root}/config`,XDG_DATA_HOME:`${root}/data`,XDG_STATE_HOME:`${root}/state`,AGENT_PROGRESS_BINDING:selector,OPENCHAMBER_SERVICE_PORT:String(port),OPENCHAMBER_SERVICE_TOKEN:'native-package-fixture-only'},stdio:['ignore','pipe','pipe']});
  let stderr='';child.stderr!.on('data',b=>stderr+=b);
  const base=`http://127.0.0.1:${port}`,headers={authorization:'Bearer native-package-fixture-only','content-type':'application/json'};
  const request=(route:string,body?:unknown)=>fetch(base+route,{method:body===undefined?'GET':'POST',headers,...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(5000)});
  const json=async(route:string)=>{const r=await request(route);assert.equal(r.status,200);return r.json();};
  let ready=false;const deadline=Date.now()+5000;
  while(Date.now()<deadline){assert.equal(child.exitCode,null,stderr);try{if((await request('/health')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,25));}assert.equal(ready,true,stderr);
  assert.equal((await json('/v1/setup')).configured,false);
  phase='route refusals';
  assert.equal((await fetch(base+'/v1/extension-update')).status,401);
  assert.equal((await fetch(base+'/v1/extension-update',{headers:{authorization:'Bearer wrong'}})).status,401);
  assert.equal((await request('/v1/extension-update?ref=dev')).status,404);assert.equal((await request('/v1/extension-update',{})).status,405);assert.equal(outbound,0);
  phase='unconfigured unknown';const unknown=await json('/v1/extension-update');assert.equal(unknown.state,'unknown');assert.equal(unknown.checkedAt,null);assert.equal(unknown.candidateVersion,undefined);assert.equal(unknown.diagnostic,'unavailable');
  status=200;advance(300000);
  phase='available/coalesced cache';const replies=await Promise.all(Array.from({length:6},()=>json('/v1/extension-update'))),available=replies[0];
  assert.equal(available.installedVersion,'0.2.4');assert.equal(available.repository,'Phototonic/openchamber-progress');assert.equal(available.ref,'main');assert.equal(available.state,'available');assert.equal(available.candidateVersion,'0.2.5');assert.equal(available.stale,false);assert.equal(outbound,2,'one retry shared across concurrent frames');
  await json('/v1/extension-update');assert.equal(outbound,2,'packaged cache prevents progress-cadence outbound work');
  const targets={configRoot:`${root}/config/opencode`,dataRoot:`${root}/data/opencode`,storeRoot:`${root}/store`,confirmed:true};
  phase='fixture companion install';const installed=await request('/v1/setup/install',targets);assert.equal(installed.status,200);assert.equal((await installed.json()).version,'0.2.4');
  const b=readBinding(selector),store=new Store(b.database),actor={sourceId:b.source.id,sessionId:'packaged-timing',agent:'build',directory:'/fixture/native-package',parentId:null,ancestry:[],verifiedSource:true};
  const past=Date.now()-4*3600000;let exact:string;
  mock.timers.enable({apis:['Date'],now:past});
  try{
    store.apply({op:'start',plan:'exact',oid:'start',rev:0,title:'Native exact timing',items:[{id:'I1',title:'Work',kind:'task',status:'pending'},{id:'G',title:'Group',kind:'group',status:'working'}]},actor);
    mock.timers.tick(60000);exact=new Date().toISOString();store.apply({op:'change',plan:'exact',oid:'work',rev:1,changes:[{id:'I1',status:'working'}]},actor);
    mock.timers.tick(60000);store.apply({op:'change',plan:'exact',oid:'neutral',rev:2,changes:[{id:'I1',status:'working'}]},actor);
    let rev=store.apply({op:'start',plan:'capped',oid:'start',rev:0,title:'Native lower bound',items:[{id:'I1',title:'Work',kind:'task',status:'working'}]},actor).rev;
    for(let i=1;i<=128;i++){mock.timers.tick(1000);rev=store.apply({op:'revise',plan:'capped',oid:`r${i}`,rev,title:`Neutral ${i}`},actor).rev;}
    store.apply({op:'start',plan:'unknown',oid:'start',rev:0,title:'Isolated missing historical snapshot',items:[{id:'I1',title:'Work',kind:'task',status:'working'}]},actor);
    // Adversarial isolated history only, never a production backfill/write path.
    store.db.prepare('DELETE FROM contributions WHERE source=? AND plan=?').run(b.source.id,'unknown');store.db.prepare('DELETE FROM revisions WHERE source=? AND plan=?').run(b.source.id,'unknown');
    assert.equal(store.db.prepare('PRAGMA user_version').get()!.user_version,2);
  }finally{mock.timers.reset();store.close();}
  const detail=(id:string)=>json(`/v1/plan?source=${b.source.id}&plan=${id}`);
  phase='timing reads';const timed=await detail('exact');assert.deepEqual(timed.timing.items,{I1:{since:exact!,kind:'exact'}});assert.ok(Date.parse(timed.timing.readAt)>=Date.parse(exact!));
  const capped=await detail('capped');assert.equal(capped.timing.items.I1.kind,'lower-bound');assert.equal((await detail('unknown')).timing.items.I1,undefined);
  assert.equal((await detail('exact')).timing.items.I1.since,exact!);
  // A configured but unavailable store cannot suppress the independent metadata reply.
  chmodSync(b.database,0o000);
  phase='configured store fault / retained stale';
  try{
    assert.equal((await request('/v1/plans')).status,503);status=503;advance(3600000);const stale=await json('/v1/extension-update');assert.equal(stale.state,'available');assert.equal(stale.stale,true);assert.equal(stale.checkedAt,available.checkedAt);assert.equal(stale.diagnostic,'unavailable');assert.equal(stale.candidateVersion,'0.2.5');
  }finally{chmodSync(b.database,0o600);}
  assert.equal((await detail('exact')).timing.items.I1.kind,'exact');
  assert.equal(hash(),originalHash,'native production entry was never rewritten');
  console.log(JSON.stringify({nativePackagedEntrySha256:originalHash,entryUnmodified:true,testOnlyExternalPreload:true,logicalFixedOfficialURL:true,outboundMetadataRequests:outbound,unconfiguredUnknown:true,availableCached:true,configuredStoreFailureIndependent:true,staleCandidateRetained:true,timing:['exact-neutral-working','lower-bound','unknown-missing-history','groups-excluded'],protocolVersion:2,schemaVersion:2,liveGitHubRequests:0}));
}catch(error){console.error(JSON.stringify({nativePackageVerificationFailedAt:phase}));throw error;}finally{
  if(child&&child.exitCode===null&&!child.signalCode){const exit=once(child,'exit');child.kill('SIGTERM');const timer=setTimeout(()=>child?.kill('SIGKILL'),3000);try{await exit;}finally{clearTimeout(timer);}}
  metadata.closeAllConnections();if(metadata.listening)await new Promise<void>(r=>metadata.close(()=>r()));rmSync(root,{recursive:true,force:true});
}
