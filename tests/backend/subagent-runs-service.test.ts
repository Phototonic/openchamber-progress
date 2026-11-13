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
import { versionOneFixture, durableSnapshot } from './subagent-format-support.ts';

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

test('managed authority fences recovery before native reads and across held root/page awaits',async()=>{
  for(const boundary of ['before','root','page','root-error'] as const)await serverFixture(async f=>{
    const entered=deferred(),held=deferred<any>();let roots=0,pages=0;
    f.ctx.session.get=async()=>{roots++;if(boundary==='root'||boundary==='root-error'){entered.resolve();await held.promise;if(boundary==='root-error')throw Error('Synthetic failure');}return f.records.get('A');};
    f.ctx.session.list=async()=>{pages++;entered.resolve();return await held.promise;};
    await f.post();
    if(boundary==='before')f.retireAuthority();
    const pending=f.binding.drainRuns();
    if(boundary!=='before'){await entered.promise;f.retireAuthority();}
    const before=durableSnapshot(f.store.db);
    held.resolve({data:[{...f.records.get('C1'),time:{created:1000,updated:2000}}],cursor:{next:null}});
    await pending;await f.binding.drainRuns();
    assert.deepEqual(durableSnapshot(f.store.db),before,'retired recovery publishes no history or failure metadata');
    assert.equal(roots,boundary==='before'?0:1);assert.equal(pages,boundary==='page'?1:0);
  });
});

test('authenticated dismissal validates identity and bounds, fences races and persists store-wide while capture is off',async t=>{
  const now=1_800_000_000_000;t.mock.method(Date,'now',()=>now);
  await serverFixture(async f=>{
    f.seed('other-plan','B');f.store.runCaptureUnavailable();
    const route='/v1/subagent-runs/dismiss-loss',body={...f.body,observedLossSequence:1};
    const send=(value:any=body,options:{auth?:boolean;raw?:boolean;method?:string;route?:string}={})=>fetch(`${f.base}${options.route??route}`,{method:options.method??'POST',headers:{'content-type':'application/json',...(options.auth===false?{}:{authorization:`Bearer ${f.token}`})},...(options.method==='GET'?{}:{body:options.raw?value:JSON.stringify(value)})});
    const refusal=async(value:any,status:number,error:string,options={})=>{
      const before=durableSnapshot(f.store.db),res=await send(value,options);assert.equal(res.status,status);assert.deepEqual(await res.json(),{error});assert.deepEqual(durableSnapshot(f.store.db),before);
    };
    await refusal(body,401,'unauthorized',{auth:false});await refusal(body,405,'method-not-allowed',{method:'GET'});await refusal(body,404,'not-found',{route:`${route}?extra=1`});
    for(const value of [{...body,storeId:'other'},{...body,source:'other'},{...body,binding:{sourceId:f.source.id,verified:false}},{...body,binding:{sourceId:'other',verified:true}},{...body,binding:{...body.binding,extra:1}}])await refusal(value,409,'conflict');
    await refusal({...body,root:'unknown'},404,'not-found');
    for(const observedLossSequence of [0,-1,1.5,Number.MAX_SAFE_INTEGER+1,'1',null])await refusal({...body,observedLossSequence},400,'invalid');
    for(const value of [{...body,extra:1},{...body,observedLossSequence:undefined},{...body,root:''},null,[]])await refusal(value,400,'invalid');
    const text=JSON.stringify(body);
    for(const raw of ['{',text.replace('"observedLossSequence":1','"observedLossSequence":1,"observedLossSequence":1'),text.replace('"observedLossSequence":1','"observedLossSequence":1,"observedLossSequen\\u0063e":1'),text.replace('"verified":true','"verified":true,"verif\\u0069ed":true'),Buffer.from([0xff])])await refusal(raw,400,'invalid',{raw:true});
    await refusal(' '.repeat(16*1024+1),413,'request-too-large',{raw:true});
    await refusal({...body,observedLossSequence:2},409,'conflict');
    f.store.runCaptureUnavailable();await refusal(body,409,'conflict');
    f.store.setEnabled(false);const before=durableSnapshot(f.store.db),res=await send({...body,observedLossSequence:2});assert.equal(res.status,200);const reply=await res.json();
    assert.deepEqual(reply,{protocolVersion:2,schemaVersion:2,runFormat:2,storeId:body.storeId,sourceBinding:body.binding,source:body.source,root:body.root,revision:Number(before.data.runs_format![0]!.revision)+1,readAt:now,capture:{enabled:false,state:'last-known',loss:true,lossNotice:{sequence:2,lastLossAt:now,dismissedThrough:2,attention:false}},acknowledgedLossSequence:2,coalesced:false});
    const after=durableSnapshot(f.store.db);for(const [table,rows] of Object.entries(before.data))if(table!=='runs_format')assert.deepEqual(after.data[table],rows,table);
    const retry=await send({...body,observedLossSequence:2});assert.equal(retry.status,200);assert.equal((await retry.json()).coalesced,true);assert.deepEqual(durableSnapshot(f.store.db),after);
    const get=await f.get({root:'B'});assert.equal(get.status,200);const read=await get.json();assert.deepEqual(read.capture,reply.capture);assert.equal(read.coverage.complete,false);assert.ok(read.coverage.reasons.includes('capture-loss'));
    f.store.runCaptureUnavailable();const late=await send({...body,observedLossSequence:2});assert.equal(late.status,200);const current=await late.json();assert.equal(current.coalesced,true);assert.equal(current.capture.lossNotice.attention,true);assert.equal(current.capture.lossNotice.sequence,3);
    const ro=new Store(f.store.file,{readOnly:true});try{ro.bindReads(f.source.id,true);assert.equal(ro.subagentRuns({...f.body,root:'B'},now).capture.lossNotice!.dismissedThrough,2);}finally{ro.close();}
  });
});

test('format-1 service reads and health never migrate; both run mutation routes refuse until activation',async()=>{
  await serverFixture(async f=>{
    versionOneFixture(f.store.db,false,1);const before=durableSnapshot(f.store.db);
    const get=await f.get();assert.equal(get.status,200);const read=await get.json();assert.equal(read.runFormat,1);assert.equal(read.capture.lossNotice,undefined);
    const headers={authorization:`Bearer ${f.token}`,'content-type':'application/json'};
    assert.equal((await fetch(`${f.base}/health`,{headers})).status,200);
    for(const [route,body] of [['reconcile',f.body],['dismiss-loss',{...f.body,observedLossSequence:1}]] as const){const res=await fetch(`${f.base}/v1/subagent-runs/${route}`,{method:'POST',headers,body:JSON.stringify(body)});assert.equal(res.status,503);assert.deepEqual(await res.json(),{error:'schema'});}
    assert.deepEqual(durableSnapshot(f.store.db),before);f.store.installSubagentRuns();const upgraded=await (await f.get()).json();assert.equal(upgraded.runFormat,2);assert.deepEqual(upgraded.capture.lossNotice,{sequence:0,lastLossAt:null,dismissedThrough:0,attention:false});
  });
});

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

test('latestForChild covers unloaded pages and both views rather than promoting an older running execution',async()=>{
  await serverFixture(async f=>{
    const seed=(childId:string,call:string,at:number,sequence:number,finished=false)=>{
      const key={source:f.source.id,parent:'A',message:call,call},child={...f.actor('C1'),sessionId:childId};
      f.store.beforeRun(key,f.actor(),'subagent',{},at);f.store.afterRun(key,0,child,'returned');
      const start={source:f.source.id,child:childId,id:`${call}-start`,sequence,at:at+1,state:'running',errorType:null,interruptionReason:null};
      f.store.observeExecution(start);if(finished)f.store.observeExecution({...start,id:`${call}-end`,sequence:sequence+1,at:at+2,state:'succeeded'});
    };
    seed('C1','old-running',1000,10);
    for(let i=0;i<50;i++)seed(`filler-${i}`,`filler-${i}`,100+i,1);
    seed('C1','new-finished',4000,30,true);
    const first=await (await f.get({plan:'plan-alpha',cleanupRev:'0'})).json();
    assert.equal(first.data.length,50);assert.ok(first.nextCursor);
    const old=first.data.find((r:any)=>r.dispatch.callId==='old-running');assert.ok(old);assert.equal(old.latestForChild,false);
    assert.ok(!first.data.some((r:any)=>r.dispatch.callId==='new-finished'));
    const next=await (await f.get({plan:'plan-alpha',cleanupRev:'0',cursor:first.nextCursor})).json();
    assert.equal(next.data.find((r:any)=>r.dispatch.callId==='new-finished').latestForChild,true);
    const useful=await (await f.get()).json(),history=await (await f.get({view:'history'})).json();
    assert.equal(useful.data.find((r:any)=>r.dispatch.callId==='old-running').latestForChild,false);
    assert.equal(history.data.find((r:any)=>r.dispatch.callId==='new-finished').latestForChild,true);
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
