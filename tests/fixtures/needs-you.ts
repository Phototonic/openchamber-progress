import { once } from 'node:events';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createProgressServer } from '../../service/server.ts';
import { RELEASE } from '../../shared/release.ts';
import type { BlockerItemInput, Request } from '../../shared/progress.ts';
import { productionFixture } from './production.ts';

export const attentionItems: BlockerItemInput[] = [
  { id:'group',title:'Format work',kind:'group' },
  { id:'decision',title:'Choose format',kind:'task',parentId:'group',status:'blocked',blocker:{category:'decision',reason:'Choose an output format',nextAction:'Select CSV or JSON'} },
  { id:'dependency',title:'Wait for input',kind:'task',status:'blocked',blocker:{category:'dependency',reason:'Input is not yet available'} },
  { id:'review',title:'Review format',kind:'task',status:'blocked',blocker:{category:'review',nextAction:'Review the format proposal'} },
  { id:'external',title:'External input',kind:'task',status:'blocked',blocker:{category:'external',reason:'<b>Awaiting sample input</b>'} },
  { id:'other',title:'Other wait',kind:'task',status:'blocked',blocker:{category:'other'} },
  { id:'unknown',title:'Unclassified wait',kind:'task',status:'blocked' },
  { id:'prerequisite-wait',title:'Prepare output',kind:'task',status:'pending',dependencies:['decision'] },
  { id:'skipped',title:'Optional output',kind:'task',status:'skipped' },
  ...Array.from({length:18},(_,i)=>({id:`task-${i}`,title:`Additional task ${i}`,kind:'task' as const,status:'pending' as const})),
];

/** Fresh synthetic SQLite roots only. Safe to mutate and dispose in tests. */
export function needsYouFixture() {
  const f = productionFixture(); const child = {...f.child,sessionId:'C'};
  const unrelated = {...f.actor,sessionId:'U'};
  let oid = 0;
  const apply = (r: Partial<Request>, actor = f.actor) => f.store.apply({plan:'P-attention',oid:`fixture-${oid++}`,rev:f.store.get(actor.sourceId,r.plan ?? 'P-attention')?.revision ?? 0,...r},actor,undefined,r.child || r.attributed ? child : undefined);
  apply({op:'start',title:'Reported waits',items:attentionItems});
  apply({op:'link',child:'C',assign:['decision','dependency']});
  apply({op:'change',changes:[{id:'decision',status:'blocked'}]},child);
  apply({op:'change',attributed:'C',changes:[{id:'decision',status:'blocked'}]});
  for(let i=0;i<21;i++) apply({op:'revise',title:`Reported waits ${i}`});
  apply({op:'start',plan:'P-other',title:'Separate plan',items:[{id:'decision',title:'Separate decision',kind:'task',status:'blocked'}]});
  apply({op:'start',plan:'P-finished',title:'Finished fixture',items:[{id:'decision',title:'Finished task',kind:'task',status:'done'}]});
  apply({op:'finish',plan:'P-finished',outcome:'finished'});
  apply({op:'start',plan:'P-lower',title:'Capped reported wait',items:[{id:'decision',title:'Long reported wait',kind:'task',status:'blocked'}]});
  for(let i=0;i<128;i++)apply({op:'revise',plan:'P-lower',title:`Capped reported wait ${i}`});
  apply({op:'start',plan:'P-unknown',title:'Incomplete reported history',items:[{id:'decision',title:'Unknown reported wait',kind:'task',status:'blocked'}]});
  apply({op:'revise',plan:'P-unknown',title:'Incomplete reported history'});
  // Controlled synthetic history for rendered exact / lower-bound / unknown
  // examples. This fixture-only seeding is never used by production readers.
  const base=Date.now()-180*60_000;
  for(const plan of ['P-attention','P-lower','P-unknown']){
    for(const row of f.store.db.prepare('SELECT revision,snapshot FROM revisions WHERE source=? AND plan=?').all(f.source.id,plan)){
      const p=JSON.parse(String(row.snapshot));p.reportedAt=new Date(base+Number(row.revision)*60_000).toISOString();
      for(const item of p.items)if(item.blocker)item.blocker.reportedAt=new Date(base+item.blocker.reportedRevision*60_000).toISOString();
      const snapshot=JSON.stringify(p);
      f.store.db.prepare('UPDATE revisions SET snapshot=? WHERE source=? AND plan=? AND revision=?').run(snapshot,f.source.id,plan,Number(row.revision));
      f.store.db.prepare('UPDATE plans SET snapshot=? WHERE source=? AND id=? AND revision=?').run(snapshot,f.source.id,plan,Number(row.revision));
      const contribution=f.store.db.prepare('SELECT payload FROM contributions WHERE source=? AND plan=? AND revision=?').get(f.source.id,plan,Number(row.revision));
      if(contribution)f.store.db.prepare('UPDATE contributions SET payload=? WHERE source=? AND plan=? AND revision=?').run(JSON.stringify({...JSON.parse(String(contribution.payload)),reportedAt:p.reportedAt}),f.source.id,plan,Number(row.revision));
    }
  }
  f.store.db.prepare('DELETE FROM contributions WHERE source=? AND plan=? AND revision=1').run(f.source.id,'P-unknown');
  f.store.db.prepare('DELETE FROM revisions WHERE source=? AND plan=? AND revision=1').run(f.source.id,'P-unknown');
  const otherSource = {...f.source,id:'source-other',configRoot:`${f.root}/other-config`,dataRoot:`${f.root}/other-data`};
  f.store.registerSource(otherSource);
  apply({op:'start',title:'Separate source',items:[{id:'decision',title:'Separate decision',kind:'task',status:'blocked'}]}, {...f.actor,sourceId:otherSource.id});
  f.store.bindReads(f.source.id,true);
  const body = (plan='P-finished') => {const d=f.store.detail(f.source.id,plan);return {storeId:d.storeId,source:f.source.id,plan,rev:d.plan.revision,cleanupRev:d.plan.cleanup?.revision ?? 0,oid:`cleanup-${oid++}`};};
  return {...f,child,unrelated,otherSource,apply,body};
}

export async function launchNeedsYouService(built=false) {
  const f=needsYouFixture(); let child:ChildProcess|undefined;
  let server:ReturnType<typeof createProgressServer>|undefined;
  const stop=async()=>{
    if(child && child.exitCode === null && !child.signalCode){const exited=once(child,'exit');child.kill('SIGTERM');const timer=setTimeout(()=>child?.kill('SIGKILL'),3000);try{await exited;}finally{clearTimeout(timer);}}
    if(server)await new Promise<void>(resolve=>server!.close(()=>resolve()));
    f.cleanup();
  };
  try {
    let port:number;
    if(built){
      const binding=`${f.root}/binding.json`;
      writeFileSync(binding,JSON.stringify({protocolVersion:2,schemaVersion:2,installId:'needs-you-fixture',version:RELEASE,database:f.store.file,storeId:f.store.list().storeId,source:f.source}),{mode:0o600});
      mkdirSync(`${f.root}/home`,{mode:0o700});
      const reservation=createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');port=(reservation.address() as {port:number}).port;await new Promise<void>(resolve=>reservation.close(()=>resolve()));
      child=spawn(process.execPath,[path.resolve('build/service/main.js')],{env:{PATH:process.env.PATH,HOME:`${f.root}/home`,XDG_CONFIG_HOME:`${f.root}/config`,XDG_DATA_HOME:`${f.root}/data`,XDG_STATE_HOME:`${f.root}/state`,AGENT_PROGRESS_BINDING:binding,OPENCHAMBER_SERVICE_PORT:String(port),OPENCHAMBER_SERVICE_TOKEN:'fixture-only'},stdio:'ignore'});
    } else {server=createProgressServer(f.store,'fixture-only');server.listen(0,'127.0.0.1');await once(server,'listening');port=(server.address() as {port:number}).port;}
    const url=`http://127.0.0.1:${port}`;
    const request=(route:string,body?:unknown,options:RequestInit={})=>fetch(`${url}${route}`,{method:body===undefined?'GET':'POST',headers:{authorization:'Bearer fixture-only','content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(3000),...options});
    const deadline=Date.now()+7000;
    while(true){
      if(child && (child.exitCode !== null || child.signalCode))throw new Error('fixture-service-exited');
      try{const r=await request('/health');if(r.ok && (await r.json()).ready)break;}catch{}
      if(Date.now()>=deadline)throw new Error('fixture-service-readiness');
      await delay(25);
    }
    return {...f,url,request,stop};
  } catch(e){await stop();throw e;}
}

if(process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href){
  const f=await launchNeedsYouService(process.argv.includes('--built'));
  console.log(JSON.stringify({ready:true,url:f.url,bearer:'fixture-only',source:'source-fixture',plan:'P-attention',finished:f.body(),built:process.argv.includes('--built')}));
  let stopping=false;const stop=async()=>{if(!stopping){stopping=true;await f.stop();}};
  process.on('SIGTERM',stop);process.on('SIGINT',stop);
}
