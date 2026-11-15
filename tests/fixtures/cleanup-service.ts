import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { createProgressServer } from '../../service/server.ts';
import { RELEASE } from '../../shared/release.ts';
import { cleanupFixture } from './cleanup.ts';
import { isolatedEnvironment, publishFixtureBinding } from './managed.ts';

/** All roots, history and bindings are disposable. No installation or real user config. */
export async function launchCleanupService(built=false,pages=true) {
  const f=cleanupFixture(pages);f.store.bindReads(f.source.id,true);
  let child:ChildProcess|undefined;let server:ReturnType<typeof createProgressServer>|undefined;let spawnBuilt:(()=>ChildProcess)|undefined;
  async function stopChild(){
    if(child&&child.exitCode===null&&!child.signalCode){const exited=once(child,'exit');child.kill('SIGTERM');const timeout=setTimeout(()=>child?.kill('SIGKILL'),3000);try{await exited;}finally{clearTimeout(timeout);}}
  }
  async function stop(){
    await stopChild();
    if(server)await new Promise<void>(resolve=>server!.close(()=>resolve()));
    f.cleanup();
  }
  try {
    let port:number;
    if(built){
      const env=isolatedEnvironment(f.root);
      const roots={configRoot:`${f.root}/config/opencode`,dataRoot:`${f.root}/data/opencode`};
      for(const dir of Object.values(roots))mkdirSync(dir,{recursive:true,mode:0o700});
      f.store.db.prepare('UPDATE sources SET config_root=?,data_root=? WHERE id=?').run(roots.configRoot,roots.dataRoot,f.source.id);
      Object.assign(f.source,roots);
      publishFixtureBinding(env,{protocolVersion:2,schemaVersion:2,installId:'cleanup-fixture',version:RELEASE,database:f.store.file,storeId:f.body().storeId,source:f.source});
      const reservation=createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');port=(reservation.address()as {port:number}).port;await new Promise<void>(resolve=>reservation.close(()=>resolve()));
      spawnBuilt=()=>spawn(process.execPath,[path.resolve('build/service/main.js')],{env:{...env,OPENCHAMBER_SERVICE_PORT:String(port),OPENCHAMBER_SERVICE_TOKEN:'fixture-only'},stdio:'ignore'});child=spawnBuilt();
    }else{
      server=createProgressServer(f.store,'fixture-only');server.listen(0,'127.0.0.1');await once(server,'listening');port=(server.address()as {port:number}).port;
    }
    const url=`http://127.0.0.1:${port}`;
    const request=(route:string,body?:unknown,options:RequestInit={})=>fetch(`${url}${route}`,{method:body===undefined?'GET':'POST',headers:{authorization:'Bearer fixture-only','content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(3000),...options});
    async function waitReady(){const deadline=Date.now()+7000;let ready=false;
    while(Date.now()<deadline){
      if(child&&(child.exitCode!==null||child.signalCode))throw new Error('fixture-service-exited');
      try{const response=await request('/health');const health=await response.json();if(response.ok&&health.ready&&health.planCleanup===1){ready=true;break;}if(response.ok&&health.state==='starting')await request('/v1/plans');}catch{}
      await delay(25);
    }
    if(!ready)throw new Error('fixture-service-readiness');}
    await waitReady();
    const restart=async()=>{if(!spawnBuilt)throw new Error('built-fixture-required');await stopChild();child=spawnBuilt();await waitReady();};
    return {...f,url,request,stop,restart};
  }catch(e){await stop();throw e;}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const fixture=await launchCleanupService(process.argv.includes('--built'));
  console.log(JSON.stringify({ready:true,url:fixture.url,bearer:'fixture-only',source:'source-fixture',finished:fixture.body(),active:'P-active',other:'P-other',built:process.argv.includes('--built')}));
  let stopping=false;const stop=async()=>{if(stopping)return;stopping=true;await fixture.stop();};
  process.on('SIGTERM',stop);process.on('SIGINT',stop);
}
