import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { OpenCode } from '@opencode/client';
import { ProgressStatus } from '../../plugin/status.ts';
import { lifecycle } from '../../setup/lifecycle.ts';
import { Store } from '../../shared/store.ts';
import { requireRuntimeVersion } from '../fixtures/runtime-version.ts';
import { UpgradeProbe } from '../fixtures/subagent-upgrade-probe.ts';
import { releasedRuntime } from './subagent-release-support.ts';
import { durableSnapshot } from './subagent-format-support.ts';
import { readBinding } from '../../shared/binding.ts';
import { publishFixtureBinding } from '../fixtures/managed.ts';
import { javascriptLiteral } from '../../shared/javascript-literal.ts';

async function freePort(){const server=createServer();server.listen(0,'127.0.0.1');await once(server,'listening');const port=(server.address() as {port:number}).port;await new Promise<void>(resolve=>server.close(()=>resolve()));return port;}
async function stop(child:ReturnType<typeof spawn>|undefined){
  if(!child)return;
  if(child.exitCode===null&&!child.signalCode){const exit=once(child,'exit');child.kill('SIGTERM');const timer=setTimeout(()=>child.kill('SIGKILL'),5000);try{await exit;}finally{clearTimeout(timer);}}
  if(child.pid)assert.throws(()=>process.kill(child.pid!,0),(e:any)=>e.code==='ESRCH','owned child must be gone');
}

type Snapshot=ReturnType<typeof durableSnapshot>;
type Boundary='before-reload'|'rollback';
function preservedRunFacts(snapshot:Snapshot,boundary:Boundary){
  // The live 3s drain renews leases and schedules/claims/completes metadata scans.
  // Their leases, jobs and traversal cursors are worker state, not retained facts.
  const workerTables=['runs_recovery_lease','runs_jobs','runs_recovery_work'];
  const data=Object.fromEntries(Object.entries(snapshot.data).filter(([name])=>!workerTables.includes(name)));
  return {schema:snapshot.schema,data:{...data,
    // Recovery claims/completions can bump revision; every other format field,
    // including version, generation and all loss metadata, stays strictly checked.
    runs_format:data.runs_format!.map(({revision,...facts})=>facts),
    // Only rollback disposes the outgoing observer. Keep its invalidation fence
    // strict, but allow the epoch allocator to advance when that observer retires.
    runs_observation_epoch:data.runs_observation_epoch!.map(row=>{
      if(boundary==='before-reload')return row;
      const {epoch,...fence}=row;return fence;
    }),
  }};
}
function assertPreservedRunFacts(before:Snapshot,after:Snapshot,boundary:Boundary){
  assert.deepEqual(preservedRunFacts(after,boundary),preservedRunFacts(before,boundary),`${boundary}: schema and retained facts are preserved`);
  assert.ok(Number(after.data.runs_format![0]!.revision)>=Number(before.data.runs_format![0]!.revision),'live recovery revision never regresses');
  if(boundary==='rollback')assert.ok(Number(after.data.runs_observation_epoch![0]!.epoch)>=Number(before.data.runs_observation_epoch![0]!.epoch),'observer retirement never regresses the epoch');
}

test('released built companion upgrades only on real isolated loader reload and refuses rollback',{timeout:240000},async()=>{
  const root=fs.mkdtempSync('/tmp/opencode/subagent-upgrade-native-');fs.chmodSync(root,0o700);
  const binary='/tmp/opencode/agent-progress-probe-cli/opencode';
  try{
    assert.ok(fs.existsSync(binary),'approved independent runtime required');
    for(let dir=path.dirname(root);;dir=path.dirname(dir)){for(const name of ['opencode.json','opencode.jsonc','.opencode','AGENTS.md','CLAUDE.md'])assert.equal(fs.existsSync(path.join(dir,name)),false,'ancestor configuration forbidden');if(dir===path.dirname(dir))break;}
    assert.equal(fs.existsSync('/etc/opencode'),false,'system config forbidden');
    const legacy=releasedRuntime(root,true);
    const released={plugin:fs.readFileSync(`${legacy}/build/companion/index.js`,'utf8'),guidance:fs.readFileSync(`${legacy}/build/companion/SKILL.md`,'utf8'),removal:fs.readFileSync(`${legacy}/build/setup/main.js`,'utf8'),version:JSON.parse(fs.readFileSync(`${legacy}/build/companion/package.json`,'utf8')).version};
    assert.equal(released.version,'1.0.0');
    const current={plugin:fs.readFileSync('build/companion/index.js','utf8'),guidance:fs.readFileSync('build/companion/SKILL.md','utf8'),removal:fs.readFileSync('build/setup/main.js','utf8'),version:JSON.parse(fs.readFileSync('build/companion/package.json','utf8')).version};
    assert.notEqual(current.plugin,released.plugin,'upgrade requires distinct companion bytes even when package versions match');
    fs.writeFileSync(`${root}/probe.ts`,[
      `import {upgradeProbe} from ${javascriptLiteral(path.resolve('tests/fixtures/subagent-upgrade-probe.ts'))};`,
      `import {Store} from ${javascriptLiteral(`${legacy}/shared/store.ts`)};`,
      `import {createRunCapture} from ${javascriptLiteral(`${legacy}/plugin/subagent-runs.ts`)};`,
      `import {sessionIdentity} from ${javascriptLiteral(`${legacy}/plugin/identity.ts`)};`,
      'export default upgradeProbe(Store,createRunCapture,sessionIdentity);',
    ].join('\n'));
    const build=spawnSync('bun',['build',`${root}/probe.ts`,'--target=node','--format=esm',`--outfile=${root}/probe.js`],{encoding:'utf8',timeout:30000});assert.equal(build.status,0,'temporary diagnostic plugin build');
    for(const loss of [false,true]){
      const dir=`${root}/${loss?'loss':'no-loss'}`;
      for(const name of ['config/opencode/plugins/upgrade-probe','data/opencode','home','cache','state','runtime','tmp','project'])fs.mkdirSync(`${dir}/${name}`,{recursive:true,mode:0o700});
      const env={PATH:'/usr/bin:/bin',HOME:`${dir}/home`,XDG_CONFIG_HOME:`${dir}/config`,XDG_DATA_HOME:`${dir}/data`,XDG_CACHE_HOME:`${dir}/cache`,XDG_STATE_HOME:`${dir}/state`,XDG_RUNTIME_DIR:`${dir}/runtime`,TMPDIR:`${dir}/tmp`,OPENCODE_PASSWORD:'synthetic-upgrade-only',DBUS_SESSION_BUS_ADDRESS:'disabled:',UPGRADE_ROOT:dir};
      const version=spawnSync(binary,['--version'],{env,cwd:`${dir}/project`,encoding:'utf8',timeout:15000});assert.equal(version.status,0);const runtime=requireRuntimeVersion('opencode',version.stdout);
      const targets={configRoot:`${dir}/config/opencode`,dataRoot:`${dir}/data/opencode`,storeRoot:`${dir}/store`,confirmed:true};
      lifecycle('install',targets,released);
      const installedBytes=(payload:typeof current)=>{const ownership=JSON.parse(fs.readFileSync(`${targets.configRoot}/plugins/agent-progress/.ownership.json`,'utf8'));assert.equal(fs.readFileSync(`${targets.storeRoot}/payloads/${ownership.active}/index.js`,'utf8'),payload.plugin);assert.equal(fs.readFileSync(`${targets.storeRoot}/payloads/${ownership.active}/SKILL.md`,'utf8'),payload.guidance);};
      installedBytes(released);
      publishFixtureBinding(env,readBinding(`${targets.configRoot}/plugins/agent-progress/progress-binding.json`));
      fs.copyFileSync(`${root}/probe.js`,`${targets.configRoot}/plugins/upgrade-probe/index.js`);
      fs.writeFileSync(`${targets.configRoot}/plugins/upgrade-probe/package.json`,JSON.stringify({name:'synthetic-upgrade-probe',type:'module',exports:{'.':'./index.js'}}));
      let native:ReturnType<typeof spawn>|undefined,service:ReturnType<typeof spawn>|undefined;
      let store:Store|undefined;
      try{
        const nativePort=await freePort(),servicePort=await freePort();
        native=spawn(binary,['serve','--hostname','127.0.0.1','--port',String(nativePort)],{cwd:`${dir}/project`,env,stdio:'ignore'});
        let nativeError=false;native.once('error',()=>{nativeError=true;});
        const headers={authorization:`Basic ${Buffer.from(`opencode:${env.OPENCODE_PASSWORD}`).toString('base64')}`};
        const baseUrl=`http://127.0.0.1:${nativePort}`,location={directory:`${dir}/project`},client=OpenCode.make({baseUrl,headers});
        const status=client.rpc(ProgressStatus);
        const wait=async<T>(read:()=>Promise<T>,accept:(v:T)=>boolean,label:string):Promise<T>=>{
          const end=Date.now()+15000;while(Date.now()<end){assert.equal(nativeError,false);assert.equal(native!.exitCode,null,'owned runtime exited');try{const value=await read();if(accept(value))return value;}catch{}await delay(25);}throw Error(label);
        };
        const inventory=()=>client.plugin.list({location} as any,{signal:AbortSignal.timeout(1000)});
        const plugin=async(expected:string)=>{const list=await wait(inventory,v=>v.data.some(p=>p.id==='agent-progress'&&p.state.status===expected),'companion inventory timeout');return list.data.find(p=>p.id==='agent-progress')!;};
        await plugin('active');const active:any=await status.inspect({},{location,signal:AbortSignal.timeout(2000)});assert.equal(active.toolAvailable,true);assert.equal(active.codemodeDisabled,true);assert.equal(active.version,'1.0.0');
        assert.equal((await client.credential.list()).length,0,'fresh runtime has no credentials');
        store=new Store(`${targets.storeRoot}/progress.sqlite`);store.bindReads(active.sourceId,true);
        const format=()=>store!.db.prepare('SELECT * FROM runs_format').get()!;
        assert.equal(format().version,1,'real released companion activation creates format 1');
        const seeded:any=await client.rpc(UpgradeProbe).seed({loss},{location,signal:AbortSignal.timeout(10000)});
        const r={storeId:active.storeId,binding:{sourceId:active.sourceId,verified:true},source:active.sourceId,root:seeded.parent};
        const original=store.subagentRuns(r,5000);assert.equal(original.counts.runs,1);assert.equal(original.counts.succeeded,1);assert.equal(original.capture.loss,loss);
        const rows=durableSnapshot(store.db).data.runs_rows;
        // Run the tracked packaged service, pointed only at this disposable binding.
        service=spawn(process.execPath,[path.resolve('build/service/main.js')],{cwd:`${dir}/project`,env:{...env,OPENCHAMBER_SERVICE_PORT:String(servicePort),OPENCHAMBER_SERVICE_TOKEN:'synthetic-service-only'},stdio:'ignore'});
        const serviceRead=async(route:string)=>{const response=await fetch(`http://127.0.0.1:${servicePort}${route}`,{headers:{authorization:'Bearer synthetic-service-only'},signal:AbortSignal.timeout(2000)});assert.equal(response.status,200);return response.json() as Promise<any>;};
        await wait(()=>serviceRead('/health'),v=>v.ready===true,'packaged service not ready');
        const query=new URLSearchParams({storeId:r.storeId,binding:JSON.stringify(r.binding),source:r.source,root:r.root});
        const read=()=>serviceRead(`/v1/subagent-runs?${query}`);
        assert.equal((await read()).runFormat,1);assert.equal(format().version,1);
        const beforeUpdate=durableSnapshot(store.db);
        assert.equal(beforeUpdate.data.plans!.length,1,'the rehearsal preserves a populated plan, not just empty storage');
        lifecycle('update',targets,current);installedBytes(current);
        const beforeReload=await serviceRead('/v1/setup');assert.equal(beforeReload.delivery.observation,'different');
        assert.equal(format().version,1);const readBeforeReload=await read();assert.equal(readBeforeReload.runFormat,1);
        assert.deepEqual(readBeforeReload.data,original.data);assert.deepEqual(readBeforeReload.counts,original.counts);assert.deepEqual(readBeforeReload.capture,original.capture);
        const preReload=durableSnapshot(store.db);
        assertPreservedRunFacts(beforeUpdate,preReload,'before-reload');
        const reload=async()=>{const res=await fetch(`${baseUrl}/api/location/reload?${new URLSearchParams({'location[directory]':location.directory})}`,{method:'POST',headers:{...headers,'content-type':'application/json'},body:'{}',signal:AbortSignal.timeout(10000)});assert.equal(res.ok,true);await res.arrayBuffer();};
        await reload();await plugin('active');
        await wait(()=>serviceRead('/v1/setup'),v=>v.delivery.observation==='matching','current companion not acknowledged');
        const upgraded=await read();assert.equal(format().version,2);assert.deepEqual(upgraded.data,original.data);assert.deepEqual(upgraded.counts,original.counts);assert.equal(upgraded.capture.loss,loss);
        assert.deepEqual(upgraded.capture.lossNotice,{sequence:0,lastLossAt:null,dismissedThrough:0,attention:false});
        const afterUpgrade=durableSnapshot(store.db);assert.deepEqual(afterUpgrade.data.runs_rows,rows);assert.deepEqual(afterUpgrade.data.plans,beforeUpdate.data.plans);
        assert.ok(upgraded.revision>original.revision,'migration and real observer disposal/start retire old revisions');
        lifecycle('update',targets,released);installedBytes(released);assert.equal((await serviceRead('/v1/setup')).delivery.observation,'matching','last load is not current inventory');
        const beforeRollback=durableSnapshot(store.db);
        await reload();const rejected=await plugin('failed');
        assert.equal(String((rejected.state as any).error).split('\n')[0],'Error: schema');
        const rollbackSetup=await serviceRead('/v1/setup');assert.equal(rollbackSetup.delivery.observation,'matching','failed load does not fabricate a new observation');
        const afterRollback=durableSnapshot(store.db);
        assertPreservedRunFacts(beforeRollback,afterRollback,'rollback');
        assert.equal(format().version,2);assert.deepEqual(durableSnapshot(store.db).data.runs_rows,rows);
        const rolledBack=await read();assert.deepEqual(rolledBack.data,upgraded.data);assert.deepEqual(rolledBack.counts,upgraded.counts);assert.deepEqual(rolledBack.capture,upgraded.capture);
        let statusRpcError:string|undefined;
        await assert.rejects(()=>status.inspect({},{location,signal:AbortSignal.timeout(2000)}),(error:any)=>{statusRpcError=error.message;assert.match(error.message,/RPC is unavailable.*agent-progress-status/);return true;},'failed old companion must not expose its status RPC');
        console.log(JSON.stringify({runtime,loss,beforeReload:{activation:beforeReload.activation,runFormat:preReload.data.runs_format![0]!.version},rollback:{status:rejected.state.status,error:String((rejected.state as any).error).split('\n')[0],activation:rollbackSetup.activation,diagnostics:rollbackSetup.diagnostics,statusRpcError,runReadStatus:200,runFormat:format().version}}));
        lifecycle('update',targets,current);await reload();await plugin('active');
        await wait(()=>serviceRead('/v1/setup'),v=>v.delivery.observation==='matching','forward recovery not acknowledged');
        assert.equal((await status.inspect({},{location,signal:AbortSignal.timeout(2000)}) as any).toolAvailable,true);assert.deepEqual((await read()).data,original.data);
        assert.equal((await client.credential.list()).length,0);assert.equal(fs.existsSync(`${dir}/model-attempts`),false,'no model or transport requests');
        assert.equal(store.db.prepare('PRAGMA integrity_check').get()!.integrity_check,'ok');assert.deepEqual(store.db.prepare('PRAGMA foreign_key_check').all(),[]);
      }finally{try{store?.close();}finally{try{await stop(service);}finally{await stop(native);}}assert.equal(fs.existsSync(`${dir}/model-attempts`),false,'no model attempts across reloads');}
    }
  }finally{fs.rmSync(root,{recursive:true,force:true});assert.equal(fs.existsSync(root),false);}
});
