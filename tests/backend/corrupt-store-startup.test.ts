import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,cpSync,chmodSync } from 'node:fs';
import path from 'node:path';
import { spawn,spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import { createProgressServer } from '../../service/server.ts';
import { SetupController } from '../../service/setup-controller.ts';
import { serviceBindingFile } from '../../service/state.ts';
import { lifecycle } from '../../setup/lifecycle.ts';
import { Store } from '../../shared/store.ts';
import { readBinding } from '../../shared/binding.ts';
import type { Actor } from '../../shared/progress.ts';

/** Fixed diagnostics only: no paths, exceptions or rejected values in health or error bodies. */
const fixedCodes=(values:string[])=>values.every(v=>/^[a-z0-9-]+$/.test(v));

function fixture() {
  const root=mkdtempSync('/tmp/opencode/agent-progress-corrupt-startup-');
  for(const dir of ['home','state','config/opencode','data/opencode','store','compiled/companion','compiled/setup','compiled/service'])mkdirSync(`${root}/${dir}`,{recursive:true,mode:0o700});
  for(const [entry,output]of [['plugin/index.ts','companion/index.js'],['setup/cli.ts','setup/main.js'],['service/main.ts','service/main.js']])assert.equal(spawnSync('bun',['build',entry,'--target=node','--format=esm',`--outfile=${root}/compiled/${output}`],{stdio:'ignore'}).status,0);
  cpSync('plugin/SKILL.md',`${root}/compiled/companion/SKILL.md`);
  const targets={configRoot:`${root}/config/opencode`,dataRoot:`${root}/data/opencode`,storeRoot:`${root}/store`,confirmed:true};
  const env={PATH:path.dirname(process.execPath)+':/usr/bin:/bin',HOME:`${root}/home`,XDG_STATE_HOME:`${root}/state`,XDG_CONFIG_HOME:`${root}/config`,XDG_DATA_HOME:`${root}/data`};
  const payload={plugin:readFileSync(`${root}/compiled/companion/index.js`,'utf8'),guidance:readFileSync('plugin/SKILL.md','utf8'),removal:readFileSync(`${root}/compiled/setup/main.js`,'utf8'),version:JSON.parse(readFileSync('package.json','utf8')).version};
  lifecycle('install',targets,payload);
  const installed=readBinding(path.join(targets.configRoot,'plugins/agent-progress/progress-binding.json'));
  cpSync(path.join(targets.configRoot,'plugins/agent-progress/progress-binding.json'),serviceBindingFile(env));
  const database=path.join(targets.storeRoot,'progress.sqlite');
  const actor:Actor={sourceId:installed.source.id,sessionId:'M',agent:'build',directory:'/fixture/Alpha',projectId:'Alpha',parentId:null,ancestry:[],verifiedSource:true};
  const seed=()=>{const store=new Store(database);try{store.apply({op:'start',plan:'P1',oid:'seed-start',rev:0,title:'Last good report',items:[{id:'t1',title:'Only task',kind:'task',status:'working'}]},actor);}finally{store.close();}};
  return {root,targets,env,payload,database,actor,seed,clean(){rmSync(root,{recursive:true,force:true});}};
}

/** Mirrors the host rule: the service counts as started once /health answers HTTP 200. */
async function serve(f:ReturnType<typeof fixture>) {
  const extension=`${f.root}/extension`;mkdirSync(extension,{recursive:true});cpSync(`${f.root}/compiled`,`${extension}/build`,{recursive:true});writeFileSync(`${extension}/package.json`,'{"type":"module"}');
  const reservation=createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');const port=(reservation.address() as {port:number}).port;await new Promise<void>(resolve=>reservation.close(()=>resolve()));
  const child=spawn(process.execPath,[`${extension}/build/service/main.js`],{env:{...f.env,OPENCHAMBER_SERVICE_PORT:String(port),OPENCHAMBER_SERVICE_TOKEN:'fixture-only'},stdio:'ignore'});
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

test('packaged future-schema store startup stays ready and answers fixed schema 503s',async()=>{
  const f=fixture();f.seed();
  const writer=new Store(f.database);writer.db.exec('PRAGMA user_version=999');writer.close();
  const future=readFileSync(f.database);
  const running=await serve(f);
  try {
    const health=await running.start();
    assert.equal(health.ok,true);assert.equal(health.ready,false);assert.equal(health.sqlite,false);
    const diagnostics=health.diagnostics as string[];assert.ok(diagnostics.includes('schema'));assert.equal(fixedCodes(diagnostics),true);
    const plans=await running.request('/v1/plans');assert.equal(plans.status,503);assert.deepEqual(await plans.json(),{error:'schema'});
    assert.deepEqual(readFileSync(f.database),future);
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
