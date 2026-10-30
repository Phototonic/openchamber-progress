import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import { Store } from '../../shared/store.ts';
import { createRunCapture } from '../../plugin/subagent-runs.ts';
import { sessionIdentity } from '../../plugin/identity.ts';
import { createProgressServer } from '../../service/server.ts';
import { fixture, deferred } from './subagent-test-support.ts';

async function serverFixture(run:(f:any)=>Promise<void>) {
  await fixture(async f=>{
    const token=randomUUID(),server=createProgressServer(f.store,token);server.listen(0,'127.0.0.1');await once(server,'listening');
    const address=server.address();assert.ok(address&&typeof address==='object');const base=`http://127.0.0.1:${address.port}`;
    const body={storeId:f.store.list().storeId,binding:{sourceId:f.source.id,verified:true},source:f.source.id,root:'A'};
    const query=(extra:any={})=>new URLSearchParams({...body,binding:JSON.stringify(body.binding),...extra} as Record<string,string>).toString();
    const get=(extra:any={},auth=true)=>fetch(`${base}/v1/subagent-runs?${query(extra)}`,{headers:auth?{authorization:`Bearer ${token}`}:{}});
    const post=(value:any=body,auth=true)=>fetch(`${base}/v1/subagent-runs/reconcile`,{method:'POST',headers:{'content-type':'application/json',...(auth?{authorization:`Bearer ${token}`}:{})},body:JSON.stringify(value)});
    try{await run({...f,token,base,body,query,get,post});}finally{server.closeAllConnections();await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
  });
}

test('authenticated GET and narrow POST → real registered companion → persisted GET',async()=>{
  await serverFixture(async f=>{
    const canary='SYNTHETIC_HISTORY_PRIVATE_METADATA';let calls=0;
    f.ctx.session.context=()=>{throw Error('Transcript method forbidden');};f.ctx.message={list:()=>{throw Error('Transcript method forbidden');}};
    f.ctx.session.list=async(input:any)=>{
      calls++;assert.equal(input.limit,50);assert.equal(input.directory,'/synthetic/alpha');
      return {data:input.parentID==='A'?[{...f.records.get('C1'),title:'Historical explorer',time:{created:1000,updated:3000,idle:2000},outcome:'succeeded',metadata:{canary}}]:[],cursor:{next:null}};
    };
    assert.equal((await f.get({},false)).status,401);assert.equal((await f.post(f.body,false)).status,401);
    const initial=await f.get();assert.equal(initial.status,200);assert.equal(initial.headers.get('cache-control'),'no-store');const v=await initial.json();assert.equal(v.recovery.state,'not-requested');assert.equal(calls,0);
    assert.equal((await f.post()).status,200);assert.equal((await (await f.post()).json()).coalesced,true);
    const pending=await (await f.get()).json();assert.equal(pending.recovery.state,'pending');assert.equal(calls,0);
    await f.binding.drainRuns();assert.equal(calls,2);
    const result=await (await f.get({view:'history'})).json();assert.equal(result.recovery.state,'complete');assert.equal(result.coverage.complete,true);assert.equal(result.counts.children,1);assert.equal(result.counts.runs,0);assert.equal(result.counts.historicalSessions,1);
    assert.equal(result.data[0].ran.state,'succeeded');assert.equal(result.data[0].ran.endedAt,2000);assert.equal(result.data[0].ran.startedAt,null);assert.equal(result.data[0].ran.provenance,'native-session');assert.equal(result.data[0].planContext,null);assert.equal(result.data[0].claimed,null);assert.equal(result.data[0].accepted,null);
    assert.ok(!JSON.stringify(result).includes(canary));assert.equal(f.plan().revision,1);
    assert.equal((await (await f.post()).json()).coalesced,true);await f.binding.drainRuns();assert.equal(calls,2);
    const reopened=await (await f.get({view:'history'})).json();assert.deepEqual(reopened.data,result.data);assert.equal(reopened.revision,result.revision);assert.ok(reopened.readAt>=result.readAt);
  });
});

test('read/control endpoints reject identity mismatch, unknown/duplicate fields, bodies and methods',async()=>{
  await serverFixture(async f=>{
    for(const override of [{storeId:'other'},{source:'other'},{binding:JSON.stringify({sourceId:f.source.id,verified:false})}])assert.equal((await f.get(override)).status,409);
    assert.equal((await f.get({root:'unknown'})).status,404);assert.equal((await f.get({extra:'field'})).status,404);assert.equal((await f.get({view:'arbitrary'})).status,400);assert.equal((await f.get({cursor:'x'.repeat(4097)})).status,400);
    const auth={authorization:`Bearer ${f.token}`};
    assert.equal((await fetch(`${f.base}/v1/subagent-runs?${f.query()}&root=A`,{headers:auth})).status,404);
    assert.equal((await fetch(`${f.base}/v1/subagent-runs?${f.query()}`,{method:'POST',headers:auth})).status,405);
    assert.equal((await fetch(`${f.base}/v1/subagent-runs/reconcile`,{headers:auth})).status,405);
    for(const suffix of [',"root":"A"',',"r\\u006fot":"A"']){
      const raw=JSON.stringify(f.body).slice(0,-1)+suffix+'}';
      assert.equal((await fetch(`${f.base}/v1/subagent-runs/reconcile`,{method:'POST',headers:auth,body:raw})).status,400);
    }
    const bodyStatus=await new Promise<number>((resolve,reject)=>{const req=http.request(`${f.base}/v1/subagent-runs?${f.query()}`,{method:'GET',headers:{...auth,'content-length':'2'}},res=>{res.resume();resolve(res.statusCode!);});req.on('error',reject);req.end('{}');});assert.equal(bodyStatus,400);
    for(const body of [null,{}, {...f.body,extra:true},{...f.body,outcome:'succeeded'}])assert.equal((await f.post(body)).status,400);
    assert.equal((await f.post({...f.body,root:'unknown'})).status,404);assert.equal((await f.post({...f.body,token:'not-offered'})).status,409);
    f.store.setEnabled(false);assert.equal((await f.post()).status,503);assert.equal((await (await f.get()).json()).capture.enabled,false);
  });
});

test('wrong-location companion leaves request pending; disabled held callback cannot publish',async()=>{
  await serverFixture(async f=>{
    await f.post();f.records.get('A').location={directory:'/synthetic/elsewhere'};await f.binding.drainRuns();assert.equal((await (await f.get()).json()).recovery.state,'pending');
    f.records.get('A').location={directory:'/synthetic/alpha'};
    const held=deferred<any>(),entered=deferred();f.ctx.session.list=async()=>{entered.resolve();return held.promise;};
    const draining=f.binding.drainRuns();await entered.promise;
    // A second drain cannot steal the transactional claim or issue another native list.
    await f.binding.drainRuns();f.store.setEnabled(false);f.store.setEnabled(true);
    held.resolve({data:[{...f.records.get('C1'),time:{created:1,updated:3,idle:2},outcome:'succeeded'}],cursor:{next:null}});await draining;
    const result=await (await f.get()).json();assert.equal(result.counts.children,0);assert.equal(result.recovery.state,'failed');assert.equal(result.recovery.reason,'capture-disabled');
  });
});

test('213 historical children plus nested metadata recover through bounded durable continuations without repeats',async()=>{
  await serverFixture(async f=>{
    const children=Array.from({length:213},(_,i)=>({id:`historical-${i}`,parentID:'A',agent:'explorer',title:'Synthetic historical work',projectID:'alpha',location:{directory:'/synthetic/alpha'},time:{created:1000+i,updated:4000+i,idle:3000+i},outcome:i%3===0?'succeeded':i%3===1?'failed':'interrupted'}));
    const visits=new Map<string,number>();let active=0,peak=0,calls=0;
    f.ctx.session.list=async(input:any)=>{
      active++;peak=Math.max(peak,active);calls++;assert.ok(input.limit<=50);const id=input.parentID;visits.set(id,(visits.get(id)??0)+1);
      try{const rows=id==='A'?children:id==='historical-0'?[{...children[0],id:'nested-history',parentID:id}]:[];const offset=Number(input.cursor??0);return {data:rows.slice(offset,offset+50),cursor:{next:offset+50<rows.length?String(offset+50):null}};}finally{active--;}
    };
    await f.post();let result:any;
    for(let attempts=0;attempts<5;attempts++){
      const before=calls;await f.binding.drainRuns();assert.ok(calls-before<=63);
      result=await (await f.get({view:'history'})).json();assert.ok(Buffer.byteLength(JSON.stringify(result))<=262144);assert.ok(result.data.length<=50);
      if(result.recovery.state==='complete')break;assert.equal(result.recovery.state,'partial');assert.ok(result.recovery.token);
      const coalesced=await (await f.post()).json();assert.equal(coalesced.coalesced,true);const beforeIdle=calls;await f.binding.drainRuns();assert.equal(calls,beforeIdle);
      assert.equal((await f.post({...f.body,token:result.recovery.token})).status,200);
    }
    assert.equal(result.recovery.state,'complete');assert.equal(result.counts.children,214);assert.equal(result.counts.historicalSessions,214);assert.equal(result.coverage.complete,true);assert.ok(peak<=2);
    assert.equal(visits.get('A'),5);assert.equal(visits.get('historical-0'),1);assert.equal(visits.get('nested-history'),1);
    const persisted=JSON.stringify(f.store.db.prepare('SELECT payload FROM runs_rows ORDER BY id').all());const count=calls;await f.get();await f.get({view:'history'});await f.post();await f.binding.drainRuns();assert.equal(calls,count);assert.equal(JSON.stringify(f.store.db.prepare('SELECT payload FROM runs_rows ORDER BY id').all()),persisted);
  });
});

test('metadata recovery never treats old idle or a possible unseen resume as a recorded dispatch terminal',async()=>{
  await serverFixture(async f=>{
    const key={source:f.source.id,parent:'A',message:'message',call:'call'};
    f.store.beforeRun(key,f.actor(),'subagent',{},5000);f.store.afterRun(key,0,f.actor('C1'),'returned');f.store.observeExecution({source:f.source.id,child:'C1',id:'start',sequence:1,at:6000,state:'running',errorType:null,interruptionReason:null});
    f.ctx.session.list=async(input:any)=>({data:input.parentID==='A'?[{...f.records.get('C1'),time:{created:1000,updated:9000,idle:2000},outcome:'succeeded'}]:[],cursor:{next:null}});
    await f.post();await f.binding.drainRuns();const result=await (await f.get()).json();assert.equal(result.data[0].ran.state,'running');assert.equal(result.data[0].ran.endedAt,null);assert.equal(f.plan().revision,1);
  });
});

test('failed host lookup is settled once and requires offered retry; concurrent claims cannot duplicate publication',async()=>{
  await serverFixture(async f=>{
    let calls=0;f.ctx.session.list=async()=>{calls++;throw Error('SYNTHETIC_PRIVATE_HOST_ERROR');};await f.post();await f.binding.drainRuns();
    const result=await (await f.get()).json();assert.equal(result.recovery.state,'failed');assert.equal(result.recovery.reason,'capture-unavailable');assert.ok(result.recovery.token);assert.ok(!JSON.stringify(result).includes('SYNTHETIC_PRIVATE_HOST_ERROR'));
    await f.binding.drainRuns();await f.post();await f.binding.drainRuns();assert.equal(calls,1);
    f.ctx.session.list=async()=>({data:[],cursor:{next:null}});await f.post({...f.body,token:result.recovery.token});
    const first=f.store.claimRunRecovery(f.source.id,'A');assert.ok(first);assert.equal(f.store.claimRunRecovery(f.source.id,'A'),null);f.store.finishRunRecovery(first,'complete');assert.equal((await (await f.get()).json()).recovery.state,'complete');
  });
});

test('recovery lease takeover fences a crashed claimant and resumes the bounded durable queue',async()=>{
  await serverFixture(async f=>{
    await f.post();f.store.maintainRunRecovery(f.source.id,'/synthetic/alpha','producer-one',1000);const first=f.store.claimRunRecovery(f.source.id,'A')!;
    f.store.saveRunRecoveryWork(first,{queue:[{id:'A',depth:0}],seen:['A']});
    f.store.maintainRunRecovery(f.source.id,'/synthetic/alpha','producer-two',20000);assert.equal(f.store.runRecoveryAlive(first),false);
    const result=await (await f.get()).json();assert.equal(result.recovery.state,'partial');assert.ok(result.recovery.token);
    await f.post({...f.body,token:result.recovery.token});const second=f.store.claimRunRecovery(f.source.id,'A')!;assert.ok(second);assert.notEqual(second.claim,first.claim);assert.equal(f.store.runRecoveryWork(second).queue[0].id,'A');
    f.store.finishRunRecovery(first,'complete');assert.equal((await (await f.get()).json()).recovery.state,'running');f.store.finishRunRecovery(second,'complete');
  });
});

test('cooperative deadline includes the initial native root lookup and never restarts an automatic loop',async t=>{
  await serverFixture(async f=>{
    let clock=0;t.mock.method(performance,'now',()=>clock);f.lookup(async(id:string)=>{clock=10001;return f.records.get(id);});
    f.ctx.session.list=async()=>{throw Error('No list after exhausted root lookup budget');};await f.post();await f.binding.drainRuns();
    const result=await (await f.get()).json();assert.equal(result.recovery.state,'partial');assert.equal(result.recovery.reason,'budget');assert.equal(result.counts.children,0);assert.ok(result.recovery.token);
    const revision=result.revision;await f.binding.drainRuns();assert.equal((await (await f.get()).json()).revision,revision);
  });
});

test('the 64-job queue cap applies to automatic admission and explicit retry alike',async()=>{
  await serverFixture(async f=>{
    for(let n=0;n<64;n++){
      const id=`root-${n}`;f.store.apply({op:'start',plan:`plan-${n}`,oid:'start',rev:0,title:'Synthetic queue owner',items:[{id:'task',title:'Task',kind:'task'}]},{...f.actor(),sessionId:id});
      assert.equal((await f.post({...f.body,root:id})).status,200);
    }
    assert.equal((await f.post()).status,503);assert.equal(f.store.db.prepare("SELECT count(*) n FROM runs_jobs WHERE state IN('pending','running')").get().n,64);
    const job=f.store.claimRunRecovery(f.source.id,'root-0');f.store.finishRunRecovery(job,'failed');const token=String(f.store.db.prepare("SELECT token FROM runs_jobs WHERE root='root-0'").get().token);
    assert.equal((await f.post()).status,200);assert.equal((await f.post({...f.body,root:'root-0',token})).status,503);
  });
});

test('a 2,000-record stop preserves the unconsumed page tail for an explicit bounded continuation',async t=>{
  await serverFixture(async f=>{
    // Isolate the record/page-tail boundary from the independent 10-second
    // budget. Under parallel load that budget may legitimately stop earlier;
    // the dedicated cooperative-deadline test above owns elapsed-time coverage.
    t.mock.method(performance,'now',()=>0);
    const children=Array.from({length:2001},(_,i)=>({id:`boundary-${i}`,parentID:'A',projectID:'alpha',location:{directory:'/synthetic/alpha'},time:{created:1000+i,updated:5000+i,idle:4000+i},outcome:'succeeded'}));
    const offsets:number[]=[];f.ctx.session.list=async(input:any)=>{if(input.parentID!=='A')return {data:[],cursor:{next:null}};const offset=Number(input.cursor??0);offsets.push(offset);return {data:children.slice(offset,offset+50),cursor:{next:offset+50<children.length?String(offset+50):null}};};
    await f.post();await f.binding.drainRuns();const first=await (await f.get()).json();assert.equal(first.recovery.state,'partial');assert.equal(f.store.db.prepare("SELECT count(*) n FROM runs_rows WHERE child='boundary-2000'").get().n,0);
    await f.post({...f.body,token:first.recovery.token});await f.binding.drainRuns();assert.equal(f.store.db.prepare("SELECT count(*) n FROM runs_rows WHERE child='boundary-2000'").get().n,1);assert.equal(offsets.filter(n=>n===2000).length,2);assert.ok(f.store.db.prepare('SELECT length(CAST(payload AS BLOB)) n FROM runs_recovery_work').get().n<=4194304);
  });
});

test('two actual companion drains on separate connections publish one claimed recovery',async()=>{
  await serverFixture(async f=>{
    const secondStore=new Store(f.store.file);secondStore.bindReads(f.source.id,true);
    const second=createRunCapture(f.ctx,{store:secondStore,sourceId:f.source.id,identity:(id,alive,signal)=>sessionIdentity(f.ctx,f.source,id,'unknown',{alive,signal,sameScope:true})});
    const entered=deferred(),release=deferred();let roots=0,lists=0;
    f.lookup(async(id:string)=>{if(id==='A'){roots++;if(roots===2)entered.resolve();await release.promise;}return f.records.get(id);});
    f.ctx.session.list=async()=>{lists++;return {data:[],cursor:{next:null}};};
    try{
      await f.post();const first=f.binding.drainRuns(),other=second.drain();await entered.promise;release.resolve();await Promise.all([first,other]);
      assert.equal(roots,2);assert.equal(lists,1);assert.equal((await (await f.get()).json()).recovery.state,'complete');
    }finally{release.resolve();second.dispose();secondStore.close();}
  });
});
