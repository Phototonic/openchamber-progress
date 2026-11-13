/** Bounded native-package HTTP join. Test-only external preload; never edits an artifact. */
import { javascriptLiteral } from '../shared/javascript-literal.ts';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,chmodSync} from 'node:fs';
import path from 'node:path';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import {mock} from 'node:test';
import {Store} from '../shared/store.ts';
import {readBinding} from '../shared/binding.ts';
import {RELEASE} from '../shared/release.ts';
import { managedBindingFile } from '../shared/managed-binding.ts';
import { isolatedEnvironment } from '../tests/fixtures/managed.ts';

const extension=path.resolve(process.argv[2]!);assert.ok(process.argv[2]);
const manifest=JSON.parse(readFileSync(`${extension}/package.json`,'utf8'));
assert.equal(manifest.version,RELEASE);
const root=mkdtempSync('/tmp/opencode/agent-progress-live-package-');
for(const dir of ['home','config/opencode','data/opencode','state','selector'])mkdirSync(`${root}/${dir}`,{recursive:true,mode:0o700});
const entry=`${extension}/build/service/main.js`,hash=()=>createHash('sha256').update(readFileSync(entry)).digest('hex'),originalHash=hash();
const attempts=`${root}/outbound-attempts`;
writeFileSync(attempts,'');
let results:Record<string,unknown>|undefined;
let child:ReturnType<typeof spawn>|undefined;
let phase='readiness';
try{
  const preload=`${root}/preload.mjs`;
  writeFileSync(preload,`// TEST ONLY: block outbound clients; native entry unchanged.\nimport fs from 'node:fs';import http from 'node:http';import https from 'node:https';import net from 'node:net';import {syncBuiltinESMExports} from 'node:module';\nconst blocked=()=>{fs.appendFileSync(${javascriptLiteral(attempts)},'attempt\\n');throw Error('fixture forbids outbound transport');};globalThis.fetch=blocked;http.request=http.get=https.request=https.get=net.connect=net.createConnection=blocked;syncBuiltinESMExports();\n`);
  const reservation=createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');const port=(reservation.address() as {port:number}).port;await new Promise<void>(r=>reservation.close(()=>r()));
  const env=isolatedEnvironment(root),selector=managedBindingFile(env);
  child=spawn(process.execPath,['--import',preload,entry],{cwd:root,env:{...env,OPENCHAMBER_SERVICE_PORT:String(port),OPENCHAMBER_SERVICE_TOKEN:'native-package-fixture-only'},stdio:['ignore','pipe','pipe']});
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
  assert.equal((await request('/v1/extension-update?ref=dev')).status,404);assert.equal((await request('/v1/extension-update',{})).status,405);
  const unavailable=async()=>{
    const before=Date.now(),reply=await json('/v1/extension-update'),after=Date.now();
    assert.deepEqual({...reply,nextCheckAt:undefined},{installedVersion:RELEASE,repository:'Phototonic/openchamber-progress',ref:'main',state:'unknown',checkedAt:null,stale:false,diagnostic:'unavailable',nextCheckAt:undefined});
    assert.ok(Date.parse(reply.nextCheckAt)>=before+3600000&&Date.parse(reply.nextCheckAt)<=after+3600000);
    return reply;
  };
  phase='unconfigured compatibility';await unavailable();
  await Promise.all(Array.from({length:6},()=>unavailable()));await unavailable();
  assert.equal(readFileSync(attempts,'utf8'),'');
  const targets={configRoot:`${root}/config/opencode`,dataRoot:`${root}/data/opencode`,storeRoot:`${root}/store`,confirmed:true};
  phase='fixture managed configuration';
  const review=await(await request('/v1/setup/managed-inspect',{storeRoot:targets.storeRoot})).json();
  const installed=await request('/v1/setup/managed-configure',{storeRoot:targets.storeRoot,confirmed:true,expected:review.delivery.review.expected});assert.equal(installed.status,200);assert.equal((await installed.json()).version,RELEASE);
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
  // A configured but unavailable store cannot suppress the compatibility reply.
  chmodSync(b.database,0o000);
  phase='configured store fault / compatibility';
  try{
    assert.equal((await request('/v1/plans')).status,503);await unavailable();
  }finally{chmodSync(b.database,0o600);}
  assert.equal((await detail('exact')).timing.items.I1.kind,'exact');
  assert.equal(hash(),originalHash,'native production entry was never rewritten');
  results={nativePackagedEntrySha256:originalHash,entryUnmodified:true,testOnlyExternalPreload:true,outboundTransportAttempts:0,unconfiguredUnavailable:true,concurrentCompatibilityReads:true,configuredStoreFailureIndependent:true,timing:['exact-neutral-working','lower-bound','unknown-missing-history','groups-excluded'],protocolVersion:2,schemaVersion:2};
}catch(error){console.error(JSON.stringify({nativePackageVerificationFailedAt:phase}));throw error;}finally{
  if(child&&child.exitCode===null&&!child.signalCode){const exit=once(child,'exit');child.kill('SIGTERM');const timer=setTimeout(()=>child?.kill('SIGKILL'),3000);try{await exit;}finally{clearTimeout(timer);}}
  try{assert.equal(readFileSync(attempts,'utf8'),'','zero outbound attempts through shutdown');}finally{rmSync(root,{recursive:true,force:true});}
}
if(results)console.log(JSON.stringify(results));
