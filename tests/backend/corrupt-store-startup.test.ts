import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,cpSync,chmodSync,readdirSync } from 'node:fs';
import path from 'node:path';
import { spawn,spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import { createProgressServer } from '../../service/server.ts';
import { SetupController } from '../../service/setup-controller.ts';
import { serviceBindingFile } from '../../service/state.ts';
import { lifecycle } from '../../setup/lifecycle.ts';
import { Store, digest } from '../../shared/store.ts';
import { readBinding } from '../../shared/binding.ts';
import type { Actor } from '../../shared/progress.ts';
import { releasedRuntime } from './subagent-release-support.ts';
import { versionOneFixture } from './subagent-format-support.ts';
import { createManagedBindingDirectory } from '../../shared/managed-binding.ts';
import { isolatedEnvironment } from '../fixtures/managed.ts';

/** Fixed diagnostics only: no paths, exceptions or rejected values in health or error bodies. */
const fixedCodes=(values:string[])=>values.every(v=>/^[a-z0-9-]+$/.test(v));

function installationBytes(f:ReturnType<typeof fixture>) {
  const files:Record<string,string>={};
  const walk=(root:string,relative:string)=>{
    for(const entry of readdirSync(root,{withFileTypes:true})){
      const file=path.join(root,entry.name),key=`${relative}/${entry.name}`;
      if(entry.isDirectory())walk(file,key);else files[key]=digest(readFileSync(file));
    }
  };
  walk(f.targets.configRoot,'config');walk(f.targets.storeRoot,'store');
  files.binding=digest(readFileSync(serviceBindingFile(f.env)));
  return files;
}

function futureRunFormat(database:string) {
  const writer=new Store(database);
  try{
    writer.installSubagentRuns();
    const ddl=String(writer.db.prepare("SELECT sql FROM sqlite_master WHERE name='runs_format'").get()!.sql);
    writer.db.exec('BEGIN IMMEDIATE; DROP TABLE runs_format');
    writer.db.exec(ddl.replace('CHECK(version=2)','CHECK(version=3)'));
    writer.db.exec('INSERT INTO runs_format VALUES(1,3,0,0,0,NULL,0,0); COMMIT');
  }finally{writer.close();}
}

function fixture() {
  const root=mkdtempSync('/tmp/opencode/agent-progress-corrupt-startup-');
  for(const dir of ['home','state','config/opencode','data/opencode','store','compiled/companion','compiled/setup','compiled/service'])mkdirSync(`${root}/${dir}`,{recursive:true,mode:0o700});
  for(const [entry,output]of [['plugin/index.ts','companion/index.js'],['setup/cli.ts','setup/main.js'],['service/main.ts','service/main.js']])assert.equal(spawnSync('bun',['build',entry,'--target=node','--format=esm',`--outfile=${root}/compiled/${output}`],{stdio:'ignore'}).status,0);
  cpSync('plugin/SKILL.md',`${root}/compiled/companion/SKILL.md`);
  const targets={configRoot:`${root}/config/opencode`,dataRoot:`${root}/data/opencode`,storeRoot:`${root}/store`,confirmed:true};
  const env=isolatedEnvironment(root);
  const payload={plugin:readFileSync(`${root}/compiled/companion/index.js`,'utf8'),guidance:readFileSync('plugin/SKILL.md','utf8'),removal:readFileSync(`${root}/compiled/setup/main.js`,'utf8'),version:JSON.parse(readFileSync('package.json','utf8')).version};
  lifecycle('install',targets,payload);
  const installed=readBinding(path.join(targets.configRoot,'plugins/agent-progress/progress-binding.json'));
  cpSync(path.join(targets.configRoot,'plugins/agent-progress/progress-binding.json'),createManagedBindingDirectory(env));
  // Explicit legacy utility regressions keep their injected controller; production main is managed.
  const legacyEntry=`import {readFileSync} from 'node:fs';import {createProgressServer} from ${JSON.stringify(path.resolve('service/server.ts'))};import {SetupController} from ${JSON.stringify(path.resolve('service/setup-controller.ts'))};const setup=new SetupController(${JSON.stringify(serviceBindingFile(env))},()=>({...JSON.parse(readFileSync(${JSON.stringify(root+'/payload.json')},'utf8')),plugin:readFileSync(new URL('../companion/index.js',import.meta.url),'utf8')}));const server=createProgressServer(undefined,process.env.OPENCHAMBER_SERVICE_TOKEN,undefined,setup);server.listen(Number(process.env.OPENCHAMBER_SERVICE_PORT),'127.0.0.1');process.on('SIGTERM',()=>server.close(()=>{setup.close();process.exit(0)}));`;
  writeFileSync(`${root}/legacy-service.ts`,legacyEntry);writeFileSync(`${root}/payload.json`,JSON.stringify(payload));
  assert.equal(spawnSync('bun',['build',`${root}/legacy-service.ts`,'--target=node','--format=esm',`--outfile=${root}/compiled/service/legacy-fixture.js`],{stdio:'ignore'}).status,0);
  const database=path.join(targets.storeRoot,'progress.sqlite');
  const actor:Actor={sourceId:installed.source.id,sessionId:'M',agent:'build',directory:'/fixture/Alpha',projectId:'Alpha',parentId:null,ancestry:[],verifiedSource:true};
  const seed=()=>{const store=new Store(database);try{store.apply({op:'start',plan:'P1',oid:'seed-start',rev:0,title:'Last good report',items:[{id:'t1',title:'Only task',kind:'task',status:'working'}]},actor);}finally{store.close();}};
  return {root,targets,env,payload,database,actor,seed,clean(){rmSync(root,{recursive:true,force:true});}};
}

/** Mirrors the host rule: the service counts as started once /health answers HTTP 200. */
async function serve(f:ReturnType<typeof fixture>,legacyFixture=false) {
  const extension=`${f.root}/extension`;mkdirSync(extension,{recursive:true});cpSync(`${f.root}/compiled`,`${extension}/build`,{recursive:true});writeFileSync(`${extension}/package.json`,'{"type":"module"}');
  const reservation=createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');const port=(reservation.address() as {port:number}).port;await new Promise<void>(resolve=>reservation.close(()=>resolve()));
  const child=spawn(process.execPath,[`${extension}/build/service/${legacyFixture?'legacy-fixture':'main'}.js`],{env:{...f.env,OPENCHAMBER_SERVICE_PORT:String(port),OPENCHAMBER_SERVICE_TOKEN:'fixture-only'},stdio:'ignore'});
  let spawnError=false;child.once('error',()=>{spawnError=true;});
  const request=(route:string,body?:unknown)=>fetch(`http://127.0.0.1:${port}${route}`,{method:body===undefined?'GET':'POST',headers:{authorization:'Bearer fixture-only','content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(8000)});
  async function start(){const deadline=Date.now()+8000;let last:unknown;while(Date.now()<deadline){assert.equal(spawnError,false);assert.equal(child.exitCode,null);try{const response=await request('/health');if(response.ok)return (await response.json()) as Record<string,unknown>;}catch(e){last=e;}await new Promise(resolve=>setTimeout(resolve,25));}throw new Error(`service-start ${String(last)}`);}
  async function stop(){if(child.exitCode===null&&!child.signalCode){const exit=once(child,'exit');child.kill('SIGTERM');const timer=setTimeout(()=>child.kill('SIGKILL'),3000);try{await exit;}finally{clearTimeout(timer);}}}
  return {request,start,stop};
}

test('packaged corrupt-store startup becomes ready, answers fixed corrupt 503s and preserves bytes',async()=>{
  const f=fixture();f.seed();
  const good=readFileSync(f.database);
  const broken=Buffer.from(good);broken.write('not-a-sqlite-file',0);writeFileSync(f.database,broken);
  const running=await serve(f);
  try {
    const health=await running.start();
    assert.equal(health.ok,true);assert.equal(health.ready,false);assert.equal(health.sqlite,false);
    const diagnostics=health.diagnostics as string[];assert.ok(diagnostics.includes('corrupt'));assert.equal(fixedCodes(diagnostics),true);

    const plans=await running.request('/v1/plans');assert.equal(plans.status,503);assert.deepEqual(await plans.json(),{error:'corrupt'});
    const detail=await running.request(`/v1/plan?source=${f.actor.sourceId}&plan=P1`);assert.equal(detail.status,503);assert.deepEqual(await detail.json(),{error:'corrupt'});
    const history=await running.request(`/v1/history?source=${f.actor.sourceId}&plan=P1`);assert.equal(history.status,503);assert.deepEqual(await history.json(),{error:'corrupt'});

    const setup=await running.request('/v1/setup');assert.equal(setup.status,200);const state=await setup.json() as {configured:boolean;captureEnabled:null;diagnostics:string[];targets:unknown};
    assert.equal(state.configured,true);assert.equal(state.captureEnabled,null);assert.ok(state.diagnostics.includes('corrupt'));assert.equal(fixedCodes(state.diagnostics),true);
    assert.deepEqual(state.targets,{configRoot:f.targets.configRoot,dataRoot:f.targets.dataRoot,storeRoot:f.targets.storeRoot});

    // The damaged store itself is never opened for writing or rewritten.
    assert.deepEqual(readFileSync(f.database),broken);

    // Restoring the file recovers in place: same process, last-good data readable.
    writeFileSync(f.database,good);
    const recovered=await running.request('/health');assert.equal(recovered.status,200);assert.equal(((await recovered.json()) as {ready:boolean}).ready,true);
    const list=await running.request('/v1/plans');assert.equal(list.status,200);const envelope=await list.json() as {storeId:string;data:{id:string}[]};
    assert.equal(envelope.data.length,1);assert.equal(envelope.data[0]!.id,'P1');
    const roundtrip=await running.request(`/v1/plan?source=${f.actor.sourceId}&plan=P1`);assert.equal(roundtrip.status,200);
  }finally{await running.stop();f.clean();}
});

test('packaged service admits recorded epoch-bearing format 1 without migrating on reads',async t=>{
  const f=fixture();f.seed();
  const writer=new Store(f.database);
  writer.installSubagentRuns();
  writer.beforeRun({source:f.actor.sourceId,parent:'M',message:'legacy-message',call:'legacy-call'},f.actor,'subagent',{description:'Recorded legacy dispatch'},1000);
  versionOneFixture(writer.db);
  writer.close();
  const before=readFileSync(f.database);
  const binding=readBinding(path.join(f.targets.configRoot,'plugins/agent-progress/progress-binding.json'));
  const query=new URLSearchParams({storeId:binding.storeId,binding:JSON.stringify({sourceId:f.actor.sourceId,verified:true}),source:f.actor.sourceId,root:'M'});
  const running=await serve(f);
  try{
    await running.start();
    const response=await running.request('/health');const health=await response.json();
    t.diagnostic(`format-1 health ${response.status} ${JSON.stringify(health)}`);
    assert.equal(response.status,200);assert.equal(health.ready,true);assert.equal(health.sqlite,true);assert.equal(health.subagentRuns,1);
    assert.ok(!(health.diagnostics??[]).includes('schema'));
    const setup=await running.request('/v1/setup');const state=await setup.json();
    t.diagnostic(`format-1 setup ${setup.status} ${JSON.stringify({...state,targets:'fixture targets',reportingIdentity:'fixture identity'})}`);
    assert.equal(setup.status,200);assert.equal(state.configured,true);assert.equal(state.verified,true);assert.equal(state.installed,false);assert.equal(state.delivery.kind,'managed');assert.equal(state.captureEnabled,true);
    assert.deepEqual(state.diagnostics,[]);
    assert.deepEqual(state.reportingIdentity,{storeId:binding.storeId,sourceId:f.actor.sourceId,verified:true});
    const plan=await running.request(`/v1/plan?source=${f.actor.sourceId}&plan=P1`);const detail=await plan.json();
    assert.equal(plan.status,200);assert.equal(detail.plan.id,'P1');assert.equal(detail.plan.title,'Last good report');assert.equal(detail.items.data[0].id,'t1');
    const runs=await running.request(`/v1/subagent-runs?${query}`);const read=await runs.json();
    t.diagnostic(`format-1 runs ${runs.status} ${JSON.stringify(read)}`);
    assert.equal(runs.status,200);assert.equal(read.runFormat,1);assert.equal(read.counts.runs,1);
    // Without a plan filter, useful features running rows only. This pending
    // dispatch remains counted and is loaded by the guest's history paging.
    assert.deepEqual(read.data,[]);
    const history=await running.request(`/v1/subagent-runs?${query}&view=history`);const archive=await history.json();
    t.diagnostic(`format-1 history ${history.status} ${JSON.stringify(archive)}`);
    assert.equal(history.status,200);assert.equal(archive.runFormat,1);assert.equal(archive.counts.runs,1);assert.equal(archive.data.length,1);
    assert.equal(archive.data[0].dispatch.callId,'legacy-call');assert.equal(archive.data[0].description,'Recorded legacy dispatch');
    assert.equal(archive.data[0].ran.state,'unknown');assert.equal(archive.data[0].ran.dispatchState,'pending');
    assert.deepEqual(readFileSync(f.database),before);
  }finally{await running.stop();f.clean();}
});

for(const kind of ['base schema','run format'] as const)test(`packaged future ${kind} store stays host-ready without changing bytes`,async t=>{
  const f=fixture();f.seed();
  const writer=new Store(f.database);
  if(kind==='base schema')writer.db.exec('PRAGMA user_version=999');
  else {
    writer.installSubagentRuns();
    const ddl=String(writer.db.prepare("SELECT sql FROM sqlite_master WHERE name='runs_format'").get()!.sql);
    writer.db.exec('BEGIN IMMEDIATE; DROP TABLE runs_format');
    writer.db.exec(ddl.replace('CHECK(version=2)','CHECK(version=3)'));
    writer.db.exec('INSERT INTO runs_format VALUES(1,3,0,0,0,NULL,0,0); COMMIT');
  }
  writer.close();
  const future=readFileSync(f.database);
  const binding=readBinding(path.join(f.targets.configRoot,'plugins/agent-progress/progress-binding.json'));
  const runQuery=new URLSearchParams({storeId:binding.storeId,binding:JSON.stringify({sourceId:f.actor.sourceId,verified:true}),source:f.actor.sourceId,root:'M'});
  const running=await serve(f);
  try {
    // Probe even non-ready replies so a host-readiness failure is explicit.
    let healthResponse:Response|undefined;
    const deadline=Date.now()+8000;
    while(Date.now()<deadline){try{healthResponse=await running.request('/health');break;}catch{await new Promise(resolve=>setTimeout(resolve,25));}}
    assert.ok(healthResponse);
    const health=await healthResponse.json();
    t.diagnostic(`health ${healthResponse.status} ${JSON.stringify(health)}`);
    const replies:Array<{status:number;body:unknown}> = [];
    const plans=await running.request('/v1/plans');const plansBody=await plans.json();
    t.diagnostic(`plans ${plans.status} ${JSON.stringify(plansBody)}`);
    replies.push({status:plans.status,body:plansBody});
    for(const route of [`/v1/plan?source=${f.actor.sourceId}&plan=P1`,`/v1/subagent-runs?${runQuery}`]){
      const reply=await running.request(route);const body=await reply.json();
      t.diagnostic(`${route.split('?')[0]} ${reply.status} ${JSON.stringify(body)}`);
      replies.push({status:reply.status,body});
    }
    const setup=await running.request('/v1/setup');const state=await setup.json();
    t.diagnostic(`setup ${setup.status} ${JSON.stringify({...state,targets:'fixture targets'})}`);
    assert.equal(healthResponse.status,200);
    assert.equal(health.ok,true);assert.equal(health.ready,false);assert.equal(health.sqlite,false);
    const diagnostics=health.diagnostics as string[];assert.ok(diagnostics.includes('schema'));assert.equal(fixedCodes(diagnostics),true);
    for(const reply of replies){assert.equal(reply.status,503);assert.deepEqual(reply.body,{error:'schema'});}
    assert.equal(setup.status,200);assert.equal(state.configured,true);assert.equal(state.captureEnabled,null);assert.ok(state.diagnostics.includes('schema'));
    assert.equal((await running.request('/health')).status,200);
    assert.deepEqual(readFileSync(f.database),future);
  }finally{await running.stop();f.clean();}
});

for(const action of ['update','install'] as const)test(`packaged ${action} refuses future run storage before changing installation or capture`,async t=>{
  const f=fixture();f.seed();
  if(action==='install')rmSync(path.join(f.targets.configRoot,'plugins/agent-progress'),{recursive:true,force:true});
  writeFileSync(`${f.root}/compiled/companion/index.js`,`${f.payload.plugin}\n// Synthetic replacement payload\n`);
  futureRunFormat(f.database);
  const before=installationBytes(f),running=await serve(f,true);
  try{
    await running.start();
    const initial=await(await running.request('/v1/setup')).json();
    const response=await running.request(`/v1/setup/${action}`,f.targets),body=await response.json();
    const probe=new DatabaseSync(f.database,{readOnly:true});
    let enabled:unknown;try{enabled=probe.prepare('SELECT enabled FROM meta').get()!.enabled;}finally{probe.close();}
    const after=installationBytes(f);
    t.diagnostic(`${action} ${response.status} ${JSON.stringify(body)} captureEnabled=${enabled} selectionChanged=${before['config/plugins/agent-progress/.ownership.json']!==after['config/plugins/agent-progress/.ownership.json']} bindingChanged=${before.binding!==after.binding} storeChanged=${before['store/progress.sqlite']!==after['store/progress.sqlite']}`);
    assert.equal(response.status,503);assert.deepEqual(body,{error:'schema'});assert.equal(enabled,1);
    assert.deepEqual(after,before);
    const health=await running.request('/health');assert.equal(health.status,200);assert.ok((await health.json()).diagnostics.includes('schema'));
    const status=await running.request('/v1/setup');assert.equal(status.status,200);const state=await status.json();
    assert.equal(state.activation,initial.activation);assert.equal(state.installed,initial.installed);assert.ok(state.diagnostics.includes('schema'));
  }finally{await running.stop();f.clean();}
});

test('epochless format 1 keeps compiled service, setup and plans available without admitting run reads',async t=>{
  const f=fixture();f.seed();
  const writer=new Store(f.database);writer.installSubagentRuns();
  versionOneFixture(writer.db,true);writer.close();
  const before=readFileSync(f.database),binding=readBinding(path.join(f.targets.configRoot,'plugins/agent-progress/progress-binding.json'));
  const query=new URLSearchParams({storeId:binding.storeId,binding:JSON.stringify({sourceId:f.actor.sourceId,verified:true}),source:f.actor.sourceId,root:'M'});
  const running=await serve(f);
  try{
    await running.start();
    const health=await running.request('/health'),healthBody=await health.json();
    const setup=await running.request('/v1/setup'),state=await setup.json();
    const plan=await running.request(`/v1/plan?source=${f.actor.sourceId}&plan=P1`),detail=await plan.json();
    const runs=await running.request(`/v1/subagent-runs?${query}`),runBody=await runs.json();
    t.diagnostic(`epochless health ${health.status} ${JSON.stringify(healthBody)}`);
    t.diagnostic(`epochless setup ${setup.status} ${JSON.stringify({...state,targets:'fixture targets',...(state.reportingIdentity?{reportingIdentity:'fixture identity'}:{})})}`);
    t.diagnostic(`epochless plan ${plan.status} ${JSON.stringify(plan.status===200?{id:detail.plan.id}:detail)} runs ${runs.status} ${JSON.stringify(runBody)}`);
    assert.equal(health.status,200);assert.equal(healthBody.ready,true);assert.equal(healthBody.subagentRuns,undefined);assert.ok(!(healthBody.diagnostics??[]).includes('schema'));
    assert.equal(setup.status,200);assert.equal(state.captureEnabled,true);assert.deepEqual(state.diagnostics,[]);
    assert.equal(plan.status,200);assert.equal(detail.plan.id,'P1');
    assert.equal(runs.status,503);assert.deepEqual(runBody,{error:'schema'});
    assert.deepEqual(readFileSync(f.database),before);
  }finally{await running.stop();f.clean();}
});

for(const action of ['update','install'] as const)test(`packaged ${action} accepts an exact epochless activation input without migrating it`,async t=>{
  const f=fixture();f.seed();
  if(action==='install')rmSync(path.join(f.targets.configRoot,'plugins/agent-progress'),{recursive:true,force:true});
  writeFileSync(`${f.root}/compiled/companion/index.js`,`${f.payload.plugin}\n// Synthetic replacement payload\n`);
  const writer=new Store(f.database);writer.installSubagentRuns();versionOneFixture(writer.db,true);writer.close();
  const before=readFileSync(f.database),files=installationBytes(f),running=await serve(f,true);
  try{
    await running.start();
    const reply=await running.request(`/v1/setup/${action}`,f.targets),state=await reply.json();
    t.diagnostic(`epochless ${action} ${reply.status} ${JSON.stringify(reply.status===200?{configured:state.configured,captureEnabled:state.captureEnabled,activation:state.activation,diagnostics:state.diagnostics}:state)}`);
    assert.equal(reply.status,200);assert.equal(state.configured,true);assert.equal(state.installed,true);assert.equal(state.captureEnabled,true);assert.ok(!state.diagnostics.includes('schema'));assert.equal(state.activation,'reload-required');
    assert.notEqual(installationBytes(f)['config/plugins/agent-progress/.ownership.json'],files['config/plugins/agent-progress/.ownership.json']);
    assert.deepEqual(readBinding(serviceBindingFile(f.env)),readBinding(path.join(f.targets.configRoot,'plugins/agent-progress/progress-binding.json')));
    assert.deepEqual(readFileSync(f.database),before);
    if(action==='update'){
      const activated=spawnSync(process.execPath,['--experimental-strip-types',path.resolve('tests/fixtures/activation.ts'),`${f.targets.configRoot}/plugins/agent-progress/index.js`],{env:f.env,encoding:'utf8',timeout:10000});
      assert.equal(activated.status,0,activated.stderr);
      const health=await running.request('/health');assert.equal(health.status,200);assert.equal((await health.json()).subagentRuns,1);
      const store=new Store(f.database);try{assert.equal(store.subagentRunStorage(),'current');}finally{store.close();}
    }
  }finally{await running.stop();f.clean();}
});

test('schema race after payload selection never disables capture or writes unsupported storage',t=>{
  const f=fixture();f.seed();
  const setup=new SetupController(serviceBindingFile(f.env),()=>({...f.payload,plugin:`${f.payload.plugin}\n// Synthetic replacement payload\n`}));
  const load=(setup as any).load;let future:Buffer|undefined;
  const mocked=t.mock.method(setup as any,'load',function(this:SetupController,b:unknown){
    futureRunFormat(f.database);future=readFileSync(f.database);return load.call(this,b);
  });
  try{
    const before=installationBytes(f);
    assert.throws(()=>setup.run('update',f.targets),(e:any)=>{t.diagnostic(`post-selection refusal ${e.code}`);return e.code==='schema';});
    mocked.mock.restore();
    assert.ok(future);assert.deepEqual(readFileSync(f.database),future);
    const after=installationBytes(f);assert.notEqual(after['config/plugins/agent-progress/.ownership.json'],before['config/plugins/agent-progress/.ownership.json']);
    assert.equal(setup.current().store,undefined);assert.equal(setup.current().error,'schema');assert.ok(setup.status().diagnostics.includes('schema'));
    assert.deepEqual(readFileSync(f.database),future);
  }finally{setup.close();f.clean();}
});

for(const epochless of [false,true])test(`binding persistence failure after selection still disables supported capture (epochless=${epochless})`,t=>{
  const f=fixture();f.seed();
  const writer=new Store(f.database);writer.installSubagentRuns();if(epochless)versionOneFixture(writer.db,true);writer.close();
  const setup=new SetupController(serviceBindingFile(f.env),()=>({...f.payload,plugin:`${f.payload.plugin}\n// Synthetic replacement payload\n`}));
  t.mock.method(setup as any,'persist',()=>{throw new Error('Synthetic binding persistence failure');});
  try{
    assert.throws(()=>setup.run('update',f.targets),(e:any)=>e.code==='service-binding-unavailable-capture-disabled');
    const store=new Store(f.database);try{assert.equal(store.list().captureEnabled,false);}finally{store.close();}
  }finally{setup.close();f.clean();}
});

test('fallback rechecks schema atomically when another connection upgrades before its capture write',t=>{
  const f=fixture();f.seed();
  const setup=new SetupController(serviceBindingFile(f.env),()=>({...f.payload,plugin:`${f.payload.plugin}\n// Synthetic replacement payload\n`}));
  let failed=false,upgraded=false,future:Buffer|undefined;
  t.mock.method(setup as any,'persist',()=>{failed=true;throw new Error('Synthetic binding persistence failure');});
  const list=Store.prototype.list;
  t.mock.method(Store.prototype,'list',function(this:Store,...args:Parameters<Store['list']>){
    const value=list.apply(this,args);
    if(failed){
      const exec=this.db.exec.bind(this.db);
      t.mock.method(this.db,'exec',(sql:string)=>{
        // With the old two-step guard this is after classification committed;
        // with the atomic method it is before the guarded transaction starts.
        if(sql==='BEGIN IMMEDIATE'&&!upgraded){futureRunFormat(f.database);future=readFileSync(f.database);upgraded=true;}
        return exec(sql);
      });
    }
    return value;
  });
  try{
    let failure:any;try{setup.run('update',f.targets);}catch(e){failure=e;}
    assert.equal(upgraded,true);assert.ok(future);
    t.diagnostic(`interleaved fallback ${failure?.code} storeChanged=${!readFileSync(f.database).equals(future)}`);
    assert.equal(failure?.code,'schema');assert.deepEqual(readFileSync(f.database),future);
  }finally{setup.close();f.clean();}
});

test('binding persistence failure racing a schema upgrade cannot disable unsupported capture',t=>{
  const f=fixture();f.seed();
  const setup=new SetupController(serviceBindingFile(f.env),()=>({...f.payload,plugin:`${f.payload.plugin}\n// Synthetic replacement payload\n`}));
  let future:Buffer|undefined;
  t.mock.method(setup as any,'persist',()=>{
    futureRunFormat(f.database);future=readFileSync(f.database);throw new Error('Synthetic binding persistence failure');
  });
  try{
    assert.throws(()=>setup.run('update',f.targets),(e:any)=>e.code==='schema');
    assert.ok(future);assert.deepEqual(readFileSync(f.database),future);
    assert.equal(setup.current().error,'schema');assert.equal(setup.current().store,undefined);
  }finally{setup.close();f.clean();}
});

test('released v1.0.0 on format 2 remains alive but fails host health readiness and companion activation',async t=>{
  const f=fixture();f.seed();
  const writer=new Store(f.database);writer.installSubagentRuns();writer.close();
  const before=readFileSync(f.database),legacy=releasedRuntime(f.root);
  assert.equal(spawnSync('bun',['build',`${legacy}/service/main.ts`,'--target=node','--format=esm',`--outfile=${f.root}/compiled/service/main.js`],{stdio:'ignore'}).status,0);
  assert.equal(spawnSync('bun',['build',`${legacy}/plugin/index.ts`,'--target=node','--format=esm',`--outfile=${f.root}/legacy-plugin/index.js`],{stdio:'ignore'}).status,0);
  cpSync(path.join(f.targets.configRoot,'plugins/agent-progress/progress-binding.json'),`${f.root}/legacy-plugin/progress-binding.json`);
  f.env.AGENT_PROGRESS_BINDING=`${f.root}/legacy-plugin/progress-binding.json`; // Released code's explicit legacy selector, never managed fallback.
  writeFileSync(`${f.root}/legacy-plugin/package.json`,'{"type":"module"}');
  const running=await serve(f);
  try{
    const deadline=Date.now()+8000;let response:Response|undefined;
    while(Date.now()<deadline){try{response=await running.request('/health');break;}catch{await new Promise(resolve=>setTimeout(resolve,25));}}
    assert.ok(response);const health=await response.json();t.diagnostic(`release health ${response.status} ${JSON.stringify(health)}`);
    assert.equal(response.status,503);assert.deepEqual(health,{error:'schema'});
    const binding=readBinding(`${f.root}/legacy-plugin/progress-binding.json`);
    const query=new URLSearchParams({storeId:binding.storeId,binding:JSON.stringify({sourceId:f.actor.sourceId,verified:true}),source:f.actor.sourceId,root:'M'});
    for(const route of ['/v1/setup',`/v1/plan?source=${f.actor.sourceId}&plan=P1`,`/v1/subagent-runs?${query}`]){
      const reply=await running.request(route);const body=await reply.json();
      t.diagnostic(`release ${route.split('?')[0]} ${reply.status} ${JSON.stringify(route==='/v1/setup'?{...body,targets:'fixture targets',reportingIdentity:'fixture identity'}:route.startsWith('/v1/plan?')?{plan:body.plan.id}:body)}`);
      assert.equal(reply.status,route.startsWith('/v1/subagent-runs')?503:200);
      if(reply.status===503)assert.deepEqual(body,{error:'schema'});
    }
    assert.deepEqual(readFileSync(f.database),before);
    const activation=spawnSync(process.execPath,['--experimental-strip-types',path.resolve('tests/fixtures/activation.ts'),`${f.root}/legacy-plugin/index.js`],{env:f.env,encoding:'utf8',timeout:10000});
    assert.equal(activation.status,1);assert.match(activation.stderr,/Error: schema/);t.diagnostic('release companion activation exit 1: Error: schema');
  }finally{await running.stop();f.clean();}
});

test('packaged unreadable store startup stays ready and answers fixed storage 503s',async()=>{
  const f=fixture();f.seed();chmodSync(f.database,0o000);
  const running=await serve(f);
  try {
    const health=await running.start();
    assert.equal(health.ok,true);assert.equal(health.ready,false);assert.equal(health.sqlite,false);
    const diagnostics=health.diagnostics as string[];assert.ok(diagnostics.includes('storage'));assert.equal(fixedCodes(diagnostics),true);
    const plans=await running.request('/v1/plans');assert.equal(plans.status,503);assert.deepEqual(await plans.json(),{error:'storage'});
    chmodSync(f.database,0o600);
    const recovered=await running.request('/health');assert.equal(recovered.status,200);assert.equal(((await recovered.json()) as {ready:boolean}).ready,true);
  }finally{chmodSync(f.database,0o600);await running.stop();f.clean();}
});

test('configured busy store keeps health ready with fixed busy 503s and recovers without restart',async()=>{
  const f=fixture();f.seed();
  const setup=new SetupController(serviceBindingFile(f.env),()=>f.payload);
  const server=createProgressServer(undefined,'fixture-only',undefined,setup);
  const hold=new DatabaseSync(f.database);
  try {
    server.listen(0,'127.0.0.1');await once(server,'listening');
    const url=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
    const get=async(route:string)=>fetch(`${url}${route}`,{headers:{authorization:'Bearer fixture-only'},signal:AbortSignal.timeout(15000)});
    assert.equal(((await (await get('/health')).json()) as {ready:boolean}).ready,true);
    hold.exec('BEGIN EXCLUSIVE');
    const health=await get('/health');assert.equal(health.status,200);const body=await health.json() as {ok:boolean;ready:boolean;sqlite:boolean;diagnostics:string[]};
    assert.equal(body.ok,true);assert.equal(body.ready,false);assert.equal(body.sqlite,false);assert.ok(body.diagnostics.includes('busy'));assert.equal(fixedCodes(body.diagnostics),true);
    const plans=await get('/v1/plans');assert.equal(plans.status,503);assert.deepEqual(await plans.json(),{error:'busy'});
    hold.exec('COMMIT');hold.close();
    const recovered=await get('/health');assert.equal(recovered.status,200);assert.equal(((await recovered.json()) as {ready:boolean}).ready,true);
    const list=await get('/v1/plans');assert.equal(list.status,200);assert.equal(((await list.json()) as {data:{id:string}[]}).data[0]!.id,'P1');
  }finally{try{hold.close();}catch{}await new Promise<void>(resolve=>server.close(()=>resolve()));setup.close();f.clean();}
});
