import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { once } from 'node:events';
import { fork } from 'node:child_process';
import { createProgressServer } from '../../service/server.ts';
import { Store } from '../../shared/store.ts';
import { LIMITS } from '../../shared/progress.ts';
import { launchCleanupService } from '../fixtures/cleanup-service.ts';
import { cleanupFixture } from '../fixtures/cleanup.ts';

test('active acknowledgement is literal, lifecycle-specific, revision-fenced and part of replay identity',async()=>{
  const f=await launchCleanupService(false,false);
  try{
    assert.equal((await(await f.request('/health')).json()).planCleanupActive,1);
    const snapshot=()=>['plans','revisions','contributions','captures','chunks','receipts'].map(t=>f.store.db.prepare(`SELECT * FROM ${t} ORDER BY source,${t==='plans'?'id':'plan'}`).all());
    async function refused(action:string,body:unknown,error:string,status=409){
      const before=snapshot();
      const response=await f.request(`/v1/plan/${action}`,body);
      assert.equal(response.status,status);assert.deepEqual(await response.json(),{error});
      assert.deepEqual(snapshot(),before);
    }
    const active={...f.body('P-active',0,'active-archive',1),active:true};
    for(const action of ['archive','delete']){
      const body={...active,...(action==='delete'?{confirmed:true}:{})};
      const {active:_ack,...oldBody}=body;
      await refused(action,oldBody,'closed');
      for(const value of [false,1,'true',null])await refused(action,{...body,active:value},'invalid',400);
      for(const plan of ['P-done','P-cancelled','P-failed'])await refused(action,{...body,plan,rev:2},'closed');
      for(const patch of [{rev:2},{cleanupRev:1}])await refused(action,{...body,...patch},'conflict');
    }
    await refused('delete',active,'invalid',400);
    await refused('restore',active,'invalid',400);
    const before=f.store.get(f.source.id,'P-active'),history=f.store.history(f.source.id,'P-active');
    const response=await f.request('/v1/plan/archive',active);assert.equal(response.status,200);
    const receipt=await response.json();
    assert.deepEqual(await(await f.request('/v1/plan/archive',active)).json(),receipt);
    const {active:_ack,...without}=active;await refused('archive',without,'operation-reused');
    assert.deepEqual(f.store.get(f.source.id,'P-active'),before);assert.deepEqual(f.store.history(f.source.id,'P-active'),history);
    await refused('restore',{...f.body('P-active',1,'restore-active',1),active:true},'invalid',400);
    assert.equal((await f.request('/v1/plan/restore',f.body('P-active',1,'restore-active',1))).status,200);
    assert.deepEqual(f.store.get(f.source.id,'P-active'),before);
    f.store.apply({op:'finish',plan:'P-active',rev:1,oid:'finish-active',outcome:'cancelled'},f.actor,f.capture());
    await refused('archive',{...active,oid:'stale-after-finish',cleanupRev:2},'conflict');
    await refused('delete',{...active,oid:'stale-delete',cleanupRev:2,confirmed:true},'conflict');
    assert.equal((await f.request('/v1/plan/archive',f.body('P-active',2,'closed-archive',2))).status,200);
    await refused('archive',{...f.body('P-active',2,'closed-archive',2),active:true},'operation-reused');
  }finally{await f.stop();}
});

test('archived active work fences every production report before replay; restore resumes it and delete removes staged work permanently',async()=>{
  const f=await launchCleanupService(false,false);
  const plan='P-active';
  try{
    f.store.installSubagentRuns();f.store.installDelegationControl();
    f.store.apply({op:'link',plan,rev:1,oid:'link-child',child:f.child.sessionId,assign:['A']},f.actor,f.capture(),f.child);
    const earlier={op:'change',plan,rev:2,oid:'earlier-report',changes:[{id:'A',status:'working'}]};
    f.store.apply(earlier,f.child,f.capture());
    const handoff={op:'handoff',oid:'earlier-handoff',summary:'Work continues',outcome:'partial',taskUpdate:{plan,rev:3,changes:[{id:'A',status:'working'}]}};
    f.store.handoff(handoff,f.child,Date.now(),undefined,f.capture());
    const declaration={op:'delegate',plan,rev:4,oid:'waiting',assign:['B']};
    f.store.declareDelegation(declaration,f.actor);
    f.store.apply({op:'stage',plan,rev:4,oid:'inflight-stage',upload:'inflight',chunk:0,items:[{id:'A',title:'Staged work',kind:'task'}]},f.actor,f.capture());
    const before=f.store.get(f.source.id,plan),history=f.store.history(f.source.id,plan);
    const reportInputs=[
      f.starts.get(`${f.source.id}/${plan}`),
      earlier,
      {op:'change',changes:[{id:'A',status:'done'}]},
      {op:'revise',title:'Continue',reopen:true},
      {op:'stage',upload:'late',chunk:0,items:[]},
      {op:'commit',upload:'inflight',chunks:1,title:'Continue',reopen:true},
      {op:'link',child:f.child.sessionId,assign:['B']},
      {op:'bind',source:f.documentPath,confirm:true},
      {op:'finish',outcome:'cancelled'},
    ].map((r:any,i)=>({plan,rev:4,oid:`late-${i}`,...r}));
    function payloads(){return ['plans','chunks','captures','revisions','contributions','receipts'].map(t=>f.store.db.prepare(`SELECT * FROM ${t} WHERE source=? AND ${t==='plans'?'id':'plan'}=?`).all(f.source.id,plan));}
    function fenced(error:string){
      const original=payloads();
      for(const r of reportInputs){
        assert.throws(()=>f.store.apply(r,r.oid===earlier.oid?f.child:f.actor,f.capture(),f.child),(e:any)=>e.code===error,r.op);
        assert.deepEqual(payloads(),original,r.op);
      }
      for(const request of [declaration,{...declaration,oid:'late-delegate'}]){
        assert.throws(()=>f.store.declareDelegation(request,f.actor),(e:any)=>e.code===error);
        assert.deepEqual(payloads(),original);
      }
      for(const request of [handoff,{...handoff,oid:'late-handoff',taskUpdate:{...handoff.taskUpdate,rev:4}}]){
        assert.throws(()=>f.store.handoff(request,f.child),(e:any)=>e.code===error);
        assert.deepEqual(payloads(),original);
      }
    }
    assert.equal((await f.request('/v1/plan/archive',{...f.body(plan,0,'archive-active',4),active:true})).status,200);
    fenced('closed');
    assert.deepEqual(f.store.get(f.source.id,plan),before);assert.deepEqual(f.store.history(f.source.id,plan),history);
    assert.equal((await f.request('/v1/plan/restore',f.body(plan,1,'restore-active',4))).status,200);
    const resumed=f.store.apply({op:'change',plan,rev:4,oid:'resumed',changes:[{id:'A',status:'working'}]},f.child,f.capture());
    assert.equal(resumed.rev,5);
    const deletion={...f.body(plan,2,'delete-active',5),active:true,confirmed:true};
    const response=await f.request('/v1/plan/delete',deletion);assert.equal(response.status,200);
    assert.deepEqual(await(await f.request('/v1/plan/delete',deletion)).json(),await response.json());
    fenced('not-found');
    for(const rows of payloads())assert.equal(rows.length,0);
    const newStart={...(f.starts.get(`${f.source.id}/${plan}`) as any),plan:'P-independent',oid:'independent'};
    assert.equal(f.store.apply(newStart,f.actor,f.capture()).rev,1);
  }finally{await f.stop();}
});

test('authenticated real HTTP cleanup validates intent and identity without side effects; archive/restore/delete API and SQL agree',async()=>{
  const f=await launchCleanupService();
  const second=cleanupFixture();
  try {
    const baseline=readdirSync(`${f.root}/store`);
    const health=await(await f.request('/health')).json();assert.equal(health.planCleanup,1);assert.equal(health.schemaVersion,2);
    assert.equal((await f.request('/v1/plans?archived=only')).status,200);assert.equal((await f.request('/v1/plan?source=source-fixture&plan=P-done')).status,200);
    const malformed=[{},[],{...f.body(),extra:'x'},{...f.body(),source:'../x'},{...f.body(),rev:'2'},{...f.body(),oid:'x'.repeat(81)}];
    for(const body of malformed)assert.equal((await f.request('/v1/plan/archive',body)).status,400);
    for(const body of [f.body(),{...f.body(),confirmed:false},{...f.body(),confirmed:'true'}])assert.equal((await f.request('/v1/plan/delete',body)).status,400);
    assert.equal((await f.request('/v1/plan/archive',f.body(),{headers:{authorization:'Bearer wrong'}})).status,401);
    assert.equal((await f.request('/v1/plan/archive')).status,405);
    assert.equal((await f.request('/v1/plan/archive?x=1',f.body())).status,404);
    assert.equal((await f.request('/v1/plans?archived=all')).status,400);
    assert.equal((await f.request('/v1/plans?archived=only&archived=only')).status,404);
    assert.equal((await f.request('/v1/plan/archive',undefined,{method:'POST',body:JSON.stringify({padding:'x'.repeat(LIMITS.requestBytes)})})).status,413);
    for(const body of [{...f.body(),storeId:second.body().storeId},{...f.body(),rev:1},{...f.body(),cleanupRev:1}])assert.equal((await f.request('/v1/plan/archive',body)).status,409);
    assert.equal(second.store.detail(second.source.id,'P-done').plan.cleanup,undefined);
    assert.equal((await f.request('/v1/plan/archive',{...f.body(),source:'missing'})).status,404);
    for(const action of ['archive','restore','delete'])assert.equal((await f.request(`/v1/plan/${action}`,{...f.body('P-active',0,`ineligible-${action}`,1),...(action==='delete'?{confirmed:true}:{})})).status,409);
    assert.deepEqual(readdirSync(`${f.root}/store`),baseline);assert.equal(f.store.db.prepare("SELECT name FROM sqlite_master WHERE name='cleanup_state'").get(),undefined);
    const before=f.store.detail(f.source.id,'P-done');const history=f.store.history(f.source.id,'P-done');
    f.store.setEnabled(false);
    const archive=await f.request('/v1/plan/archive',f.body());assert.equal(archive.status,200);const receipt=await archive.json();assert.equal(receipt.cleanup.state,'archived');
    assert.deepEqual(await(await f.request('/v1/plan/archive',f.body())).json(),receipt);
    assert.equal((await f.request('/v1/plan/archive',{...f.body(),rev:1})).status,409);
    assert.equal(f.store.db.prepare('SELECT state FROM cleanup_state WHERE source=? AND plan=?').get(f.source.id,'P-done')!.state,'archived');
    const normal=await(await f.request('/v1/plans?source=source-fixture&limit=50')).json();assert(!normal.data.some((p:any)=>p.id==='P-done'));
    const archived=await(await f.request('/v1/plans?archived=only&source=source-fixture&session=M&directory=%2Ffixture%2FAlpha')).json();assert.equal(archived.data.length,1);assert.equal(archived.data[0].cleanup.revision,1);
    const detail=await(await f.request('/v1/plan?source=source-fixture&plan=P-done')).json();assert.equal(detail.plan.lifecycle,'finished');assert.deepEqual(detail.plan.counts,before.plan.counts);
    assert.equal((await f.request(`/v1/document?source=source-fixture&plan=P-done&capture=${before.plan.document.captureId}`)).status,200);
    assert.deepEqual((await(await f.request('/v1/history?source=source-fixture&plan=P-done')).json()).data,history.data);
    assert.equal((await f.request('/v1/plan/restore',f.body('P-done',1,'restore'))).status,200);
    assert.equal(f.store.get(f.source.id,'P-done')!.lifecycle,'finished');assert.equal(f.store.detail(f.source.id,'P-done').plan.cleanup?.revision,2);
    assert.equal((await f.request('/v1/plan/archive',f.body())).status,409);
    const deletion={...f.body('P-done',2,'delete'),confirmed:true};const deleted=await f.request('/v1/plan/delete',deletion);assert.equal(deleted.status,200);assert.deepEqual(await(await f.request('/v1/plan/delete',deletion)).json(),await deleted.json());
    for(const table of ['plans','chunks','captures','revisions','contributions','receipts'])assert.equal(f.store.db.prepare(`SELECT count(*) AS n FROM ${table} WHERE source=? AND ${table==='plans'?'id':'plan'}=?`).get(f.source.id,'P-done')!.n,0,table);
    for(const route of ['/v1/plan','/v1/history',`/v1/document`])assert.equal((await f.request(`${route}?source=source-fixture&plan=P-done${route==='/v1/document'?`&capture=${before.plan.document.captureId}`:''}`)).status,404);
    assert(f.store.get('source-other','P-done'));assert(f.store.get(f.source.id,'P-other'));assert.equal(f.store.list().captureEnabled,false);
  }finally{second.cleanup();await f.stop();}
});

test('cancelled and failed plans can be archived, restored unchanged and deleted with revision fencing',async()=>{
  const f=await launchCleanupService();
  try{
    for(const lifecycle of ['cancelled','failed']){
      const plan=`P-${lifecycle}`;
      const before=f.store.detail(f.source.id,plan);
      const history=f.store.history(f.source.id,plan);
      for(const [action,generation] of [['archive',0],['restore',1],['delete',2]] as const){
        const body={...f.body(plan,generation,`${lifecycle}-${action}`),...(action==='delete'?{confirmed:true}:{})};
        assert.equal((await f.request(`/v1/plan/${action}`,{...body,rev:1})).status,409);
        assert.equal((await f.request(`/v1/plan/${action}`,body)).status,200);
        if(action!=='delete'){
          const current=f.store.detail(f.source.id,plan);
          assert.equal(current.plan.lifecycle,lifecycle);
          assert.deepEqual(current.plan.counts,before.plan.counts);
          assert.deepEqual(f.store.history(f.source.id,plan),history);
          assert.equal(current.plan.cleanup?.state,action==='archive'?'archived':'visible');
        }else assert.equal(f.store.get(f.source.id,plan),undefined);
      }
    }
  }finally{await f.stop();}
});

test('normal and archived filters precede pagination with source/session/directory isolation',async()=>{
  const f=await launchCleanupService();try{
    const all=[];let position:number|undefined=0;while(position!==undefined){const page=f.store.list({source:f.source.id,limit:50,cursor:position});all.push(...page.data.filter(p=>p.lifecycle==='finished'));position=page.nextCursor===null?undefined:Number(page.nextCursor);}
    for(const p of all)assert.equal((await f.request('/v1/plan/archive',f.body(p.id,0,`archive-${p.id}`,p.revision))).status,200);
    const ids:string[]=[];let cursor='0';do{
      const page=await(await f.request(`/v1/plans?archived=only&source=source-fixture&session=M&directory=%2Ffixture%2FAlpha&limit=50&cursor=${cursor}`)).json();ids.push(...page.data.map((p:any)=>p.id));cursor=page.nextCursor;
    }while(cursor!==null);
    assert.equal(ids.length,57);assert.equal(new Set(ids).size,57);
    const normal=await(await f.request('/v1/plans?source=source-fixture&session=M&directory=%2Ffixture%2FAlpha&limit=50')).json();assert.equal(normal.data.length,3);assert.equal(normal.nextCursor,null);
    assert.equal((await(await f.request('/v1/plans?archived=only&source=source-other')).json()).data.length,0);
    assert.equal((await(await f.request('/v1/plans?source=source-other')).json()).data.length,1);
    assert.equal((await(await f.request('/v1/plans?archived=only&session=U')).json()).data.length,0);
    assert.equal((await(await f.request('/v1/plans?archived=only&directory=%2Ffixture%2FElsewhere')).json()).data.length,0);
  }finally{await f.stop();}
});

test('HTTP competing reopen, busy, read-only, and unavailable storage fail safely',async()=>{
  const f=await launchCleanupService(false,false);let held:ReturnType<typeof fork>|undefined;
  try{
    f.store.apply({op:'revise',plan:'P-done',rev:2,oid:'reopen',title:'Continue',reopen:true},f.actor,f.capture());
    assert.equal((await f.request('/v1/plan/delete',{...f.body(),confirmed:true})).status,409);assert.equal(f.store.get(f.source.id,'P-done')!.lifecycle,'active');
    held=fork(new URL('../fixtures/cleanup-worker.ts',import.meta.url),[f.store.file,'hold','{}','{}'],{stdio:['ignore','ignore','ignore','ipc']});await once(held,'message',{signal:AbortSignal.timeout(5000)});
    assert.equal((await f.request('/v1/plan/archive',f.body('P-other'))).status,503);const exit=once(held,'exit');held.kill('SIGKILL');await exit;held=undefined;
    for(const store of [undefined,new Store(f.store.file,{readOnly:true})]){
      const server=createProgressServer(store,'fixture-only','storage');server.listen(0,'127.0.0.1');await once(server,'listening');
      try{const response=await fetch(`http://127.0.0.1:${(server.address()as any).port}/v1/plan/delete`,{method:'POST',headers:{authorization:'Bearer fixture-only'},body:JSON.stringify({...f.body('P-other'),confirmed:true})});assert.equal(response.status,503);assert(f.store.get(f.source.id,'P-other'));}
      finally{await new Promise<void>(resolve=>server.close(()=>resolve()));store?.close();}
    }
  }finally{if(held){const exit=once(held,'exit');held.kill('SIGKILL');await exit;}await f.stop();}
});

test('HTTP cleanup racing an actual independent writer never archives active progress',async()=>{
  const f=await launchCleanupService(false,false);
  try{
    const child=fork(new URL('../fixtures/cleanup-worker.ts',import.meta.url),[f.store.file,'reopen',JSON.stringify({op:'revise',plan:'P-done',rev:2,oid:'race-reopen',title:'Continue',reopen:true}),JSON.stringify(f.actor),JSON.stringify(f.capture())],{stdio:['ignore','ignore','ignore','ipc']});
    const result=once(child,'message',{signal:AbortSignal.timeout(10000)});
    const [response,[writer]]=await Promise.all([f.request('/v1/plan/archive',f.body()),result]);
    const current=f.store.detail(f.source.id,'P-done').plan;
    if(response.ok){assert.equal((writer as any).error,'closed');assert.equal(current.lifecycle,'finished');assert.equal(current.cleanup?.state,'archived');}
    else{assert.equal(response.status,409);assert((writer as any).receipt);assert.equal(current.lifecycle,'active');assert.equal(current.cleanup,undefined);}
  }finally{await f.stop();}
});

// CP-Q5 opt-in: shared final check is run only after source/bundle inputs stabilize.
test('checked-in built service persists archive/delete through restart',{skip:process.env.CP_BUILT_SERVICE!=='1'},async()=>{
  const f=await launchCleanupService(true,false);try{
    assert.equal((await f.request('/v1/plan/archive',f.body())).status,200);
    await f.restart();
    assert.equal((await(await f.request('/v1/plans?archived=only&source=source-fixture')).json()).data[0].id,'P-done');
    assert.equal(f.store.detail(f.source.id,'P-done').plan.cleanup?.state,'archived');
    const deletion={...f.body('P-done',1,'delete'),confirmed:true};assert.equal((await f.request('/v1/plan/delete',deletion)).status,200);
    await f.restart();assert.equal((await f.request('/v1/plan?source=source-fixture&plan=P-done')).status,404);assert.equal((await f.request('/v1/plan/delete',deletion)).status,200);
    const reopened=new Store(f.store.file);try{assert.equal(reopened.get(f.source.id,'P-done'),undefined);assert.equal(reopened.cleanup('delete',deletion).cleanup.state,'deleted');}finally{reopened.close();}
  }finally{await f.stop();}
});
