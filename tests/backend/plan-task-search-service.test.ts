import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { createProgressServer } from '../../service/server.ts';
import { Store } from '../../shared/store.ts';
import { SEARCH_LIMITS as L, type SearchWindow, type SearchOptions, type ItemInput } from '../../shared/progress.ts';
import { searchFixture, seedSearchLibrary, libraryId } from '../fixtures/plan-task-search.ts';

async function serve(store?: Store) {
  const server=createProgressServer(store,'fixture-only');server.listen(0,'127.0.0.1');await once(server,'listening');
  const base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  return {server,get:(route:string,init?:RequestInit)=>fetch(base+route,{...init,headers:{authorization:'Bearer fixture-only',...init?.headers}}),stop:()=>new Promise<void>(resolve=>server.close(()=>resolve()))};
}
const route=(path:string,values:Record<string,unknown>)=>path+'?'+new URLSearchParams(Object.entries(values).map(([k,v])=>[k,typeof v==='object'?JSON.stringify(v):String(v)]));
const searchRoute=(options:SearchOptions={})=>route('/v1/search',options as Record<string,unknown>);
function bounds(w:SearchWindow){assert(w.work.planSlots<=64);assert(w.work.membershipRows<=128);assert(w.work.inputBytes<=L.inputBytes);assert(w.hits.length<=50);assert(w.work.outputBytes<=L.responseBytes);assert.equal(w.work.outputBytes,Buffer.byteLength(JSON.stringify(w)));assert.equal(w.exhausted,w.nextCursor===null);}
async function window(s:Awaited<ReturnType<typeof serve>>,options:SearchOptions={}){const res=await s.get(searchRoute(options));assert.equal(res.status,200);const w:SearchWindow=await res.json();bounds(w);return w;}

test('actual HTTP: capability, frozen DTO, strict errors, read-only store and unavailable service',async()=>{
  const f=searchFixture(),s=await serve(f.store);try{
    assert.equal((await(await s.get('/health')).json()).planTaskSearch,1);
    const bytes=readFileSync(f.store.file);const w=await window(s,{q:'export csv',limit:1});
    assert.equal(w.planTaskSearch,1);assert.equal(w.storeId,f.storeId);assert.deepEqual(w.sourceBinding,{sourceId:f.alpha.id,verified:true});assert.equal(w.hits[0].plan.sourceVerified,true);assert.equal(w.hits[0].classified!.matchingTasks,2);
    const path=searchRoute({q:'export csv',limit:1});
    assert.equal((await s.get(path,{headers:{authorization:'Bearer wrong'}})).status,401);assert.equal((await s.get(path,{method:'POST'})).status,405);
    assert.equal((await s.get(path,{method:'POST',body:'{}'})).status,405);
    for(const suffix of ['&unknown=1','&q=other'])assert.equal((await s.get(path+suffix)).status,404);
    for(const opts of [{q:'x'.repeat(257)},{q:Array(17).fill('x').join(' ')},{limit:0},{limit:51},{limit:1.2},{status:'unknown'},{lifecycle:'unknown'},{archived:'include'},{source:'*'},{cursor:'bad'},{cursor:'x'.repeat(4097)}])assert.equal((await s.get(route('/v1/search',opts))).status,400);
    assert.equal((await s.get('/v1/search?q='+('x'.repeat(16385)))).status,400);
    assert.equal((await s.get(searchRoute({q:'other',limit:1,cursor:w.nextCursor!}))).status,409);
    const c=JSON.parse(Buffer.from(w.nextCursor!,'base64url').toString());c.identity='0'.repeat(64);assert.equal((await s.get(searchRoute({q:'export csv',limit:1,cursor:Buffer.from(JSON.stringify(c)).toString('base64url')}))).status,409);
    for(const field of ['identity','fingerprint']){
      const malformed={...JSON.parse(Buffer.from(w.nextCursor!,'base64url').toString()),[field]:{toString:null}};
      const response=await s.get(searchRoute({q:'export csv',limit:1,cursor:Buffer.from(JSON.stringify(malformed)).toString('base64url')}));
      assert.equal(response.status,400);assert.deepEqual(await response.json(),{error:'invalid'});
    }
    const keys=[{source:f.alpha.id,plan:'P-export'},{source:f.beta.id,plan:'missing'}];const stateRoute=route('/v1/search-state',{storeId:f.storeId,keys});
    const state=await(await s.get(stateRoute)).json();assert.equal(state.data.length,2);assert.equal(state.data[0].exists,true);assert.equal(state.data[1].exists,false);assert.equal(state.data[1].revision,null);
    for(const bad of [[],Array(51).fill(keys[0]),[keys[0],keys[0]],[{...keys[0],extra:1}],null])assert.equal((await s.get(route('/v1/search-state',{storeId:f.storeId,keys:bad}))).status,400);
    assert.equal((await s.get(route('/v1/search-state',{storeId:'wrong',keys}))).status,409);
    assert.equal((await s.get(stateRoute+'&keys=[]')).status,404);assert.equal((await s.get('/v1/search-state?storeId='+f.storeId+'&keys=broken')).status,400);
    assert.deepEqual(readFileSync(f.store.file),bytes);
    const reader=new Store(f.store.file,{readOnly:true}),rs=await serve(reader);try{assert.equal((await window(rs,{q:'export csv'})).hits.length,4);}finally{await rs.stop();reader.close();}
    const unavailable=await serve();try{assert.equal((await unavailable.get(path)).status,503);}finally{await unavailable.stop();}
    // Old contracts remain available, without search redefining list/session behavior.
    assert.equal((await s.get('/v1/plans')).status,200);assert.equal((await s.get('/v1/plan?source=source-alpha&plan=P-export')).status,200);
  }finally{await s.stop();f.cleanup();}
});

test('actual HTTP scale: three post-warmup samples, 1200-plan library and 1000-task plans',async t=>{
  const f=searchFixture(false);seedSearchLibrary(f);
  f.seedPlan('Z-large','Large plan',Array.from({length:1000},(_,n)=>({id:`T${n}`,title:'Scale needle',kind:'task',status:n%2?'working':'done'})));
  const chain:ItemInput[]=Array.from({length:1000},(_,n)=>({id:`G${n}`,title:n===999?'Deep needle':'Context',kind:n===999?'task':'group',...(n?{parentId:`G${n-1}`}:{})}));f.seedPlan('Z-deep','Deep plan',chain);
  const s=await serve(f.store);try{
    const measurements:Record<string,unknown>[]=[];
    async function scan(q:string){const start=performance.now();let cursor:string|undefined,requests=0,hits=0,plans=0,tasks=0,bytes=0,inspectedItems=0,planSlots=0,membershipRows=0,inputBytes=0,maxSlots=0,maxInput=0,maxOutput=0,firstHitMs:number|null=null;let first:SearchWindow|undefined;const ids:string[]=[],windowMs:number[]=[];
      do{const before=performance.now();const w=await window(s,{q,limit:50,...(cursor?{cursor}:{})});windowMs.push(performance.now()-before);if(w.hits.length&&!first){first=w;firstHitMs=performance.now()-start;}requests++;hits+=w.hits.length;plans+=w.counts.matchedPlans;tasks+=w.counts.matchingTasks;bytes+=w.work.outputBytes;inspectedItems+=w.work.inspectedItems;planSlots+=w.work.planSlots;membershipRows+=w.work.membershipRows;inputBytes+=w.work.inputBytes;maxSlots=Math.max(maxSlots,w.work.planSlots);maxInput=Math.max(maxInput,w.work.inputBytes);maxOutput=Math.max(maxOutput,w.work.outputBytes);ids.push(...w.hits.map(h=>h.plan.id));cursor=w.nextCursor??undefined;assert(requests<100);}while(cursor);
      windowMs.sort((a,b)=>a-b);return {q,requests,hits,matchedPlans:plans,matchingTasks:tasks,responseBytes:bytes,inspectedItems,planSlots,membershipRows,inputBytes,maxSlots,maxInput,maxOutput,firstHitMs,windowMedianMs:windowMs[Math.floor(windowMs.length/2)],windowMaxMs:windowMs.at(-1),durationMs:performance.now()-start,first,ids};}
    for(const q of ['Needle-at-0051','Needle-at-0501','Needle-at-1001','Dense match','Scale needle','Deep needle']){
      await scan(q);const samples=[];for(let n=0;n<3;n++){const r=await scan(q);samples.push(r);if(q.startsWith('Needle-at-')){assert.deepEqual(r.ids,[libraryId(Number(q.split('-').at(-1)))]);}if(q==='Scale needle'){assert.equal(r.hits,1000);assert.equal(r.matchingTasks,1000);assert.equal(r.matchedPlans,1);}}
      const durations=samples.map(r=>r.durationMs).sort((a,b)=>a-b);const {first,ids,...facts}=samples[0];measurements.push({...facts,durationMs:undefined,durationMsSamples:samples.map(r=>r.durationMs),medianMs:durations[1],rangeMs:[durations[0],durations[2]]});
    }
    const scale=await scan('Scale needle');const example=scale.first!;
    const deep=await scan('Deep needle');assert.equal(deep.first!.hits[0].omittedAncestors,991);
    const beyond=route('/v1/search-state',{storeId:f.storeId,keys:[{source:f.alpha.id,plan:libraryId(1001)}]});assert.equal((await(await s.get(beyond)).json()).data[0].exists,true);
    // Current metadata point read is independent of ordinary list prefix coverage.
    f.apply(libraryId(1001),{op:'change',changes:[{id:'T',status:'done'}]});f.apply(libraryId(1001),{op:'finish',outcome:'finished'});
    const rev=f.store.get(f.alpha.id,libraryId(1001))!.revision;f.store.cleanup('delete',{storeId:f.storeId,source:f.alpha.id,plan:libraryId(1001),rev,cleanupRev:0,oid:'delete-scale',confirmed:true});const stateExample=await(await s.get(beyond)).json();assert.equal(stateExample.data[0].exists,false);
    const artifact={contract:'planTaskSearch:1',runtime:{node:process.versions.node},cases:{authenticatedHttp:true,strictErrors:true,keysetBeyond500:true,stateBeyond500:true,taskContinuation:true,deepContext:true},measurements,example,stateExample};
    if(process.env.EVIDENCE){mkdirSync(process.env.EVIDENCE,{recursive:true});writeFileSync(process.env.EVIDENCE+'/api.json',JSON.stringify(artifact,null,2)+'\n');}
    t.diagnostic(JSON.stringify({measurements}));
  }finally{await s.stop();f.cleanup();}
});

test('output byte boundary resumes first un-emitted task; fault-injected large snapshots and membership never exceed input bounds',async()=>{
  const f=searchFixture(false);try{
    const items:ItemInput[]=Array.from({length:1000},(_,n)=>({id:`I${n}`,title:'Context',kind:n<900?'group':'task',...(n?{parentId:n<900?`I${n-1}`:'I899'}:{})}));f.seedPlan('P-large','Large',items);
    // Labelled fault injection: expand valid item titles/record metadata beyond staged request capacities.
    const p=f.store.get(f.alpha.id,'P-large')!;p.items=p.items.map(i=>({...i,title:'漢'.repeat(512)}));p.directory='/fixture/'+('d'.repeat(4000));f.store.db.prepare('UPDATE plans SET snapshot=? WHERE id=?').run(JSON.stringify(p),'P-large');
    const s=await serve(f.store);try{
      async function scanMax(){const start=performance.now();let cursor:string|undefined;const ids:string[]=[];let count=0,bytePaused=false,requests=0,maxOutput=0,maxInput=0;
        do{const w=await window(s,{q:'漢',limit:50,...(cursor?{cursor}:{})});requests++;if(w.hits.length<50&&!w.exhausted)bytePaused=true;ids.push(...w.hits.map(h=>h.task!.id));count+=w.counts.matchingTasks;maxOutput=Math.max(maxOutput,w.work.outputBytes);maxInput=Math.max(maxInput,w.work.inputBytes);cursor=w.nextCursor??undefined;}while(cursor);
        assert(bytePaused);assert.equal(ids.length,100);assert.equal(new Set(ids).size,100);assert.equal(count,100);return {requests,hits:ids.length,maxOutput,maxInput,durationMs:performance.now()-start};}
      await scanMax();const samples=[];for(let n=0;n<3;n++)samples.push(await scanMax());
      if(process.env.EVIDENCE){mkdirSync(process.env.EVIDENCE,{recursive:true});const file=process.env.EVIDENCE+'/api.json';const artifact=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):{contract:'planTaskSearch:1'};artifact.maximumTitleFaultInjection={label:'SQL-expanded valid 1000-item snapshot, 900 groups/100 tasks, maximal UTF-8 item titles and long location',samples};writeFileSync(file,JSON.stringify(artifact,null,2)+'\n');}
      // Individually bounded records can exhaust the cumulative byte window, then resume.
      for(let n=0;n<10;n++){f.seedPlan(`Q${n}`,'Padded',[{id:'T',title:'Small',kind:'task'}]);f.store.db.prepare("UPDATE plans SET snapshot=json_set(snapshot,'$.padding',?) WHERE id=?").run('x'.repeat(1024*1024),`Q${n}`);}
      const first=await window(s,{q:'Small'});assert(!first.exhausted);assert(first.work.inputBytes<L.inputBytes);const next=await window(s,{q:'Small',cursor:first.nextCursor!});assert(next.hits.length>0);
      // A contribution too large to coexist with its snapshot is disclosed once, never an endless cursor.
      f.store.db.prepare("UPDATE contributions SET payload=json_set(payload,'$.padding',?) WHERE plan='P-large'").run('x'.repeat(L.inputBytes));
      const gap=await window(s,{q:'漢',session:'absent'});assert(gap.coverage.reasons.includes('oversized-membership'));
    }finally{await s.stop();}
  }finally{f.cleanup();}
});

test('real search/state honor archive/restore at unchanged revision and reject pinned deleted plans',async()=>{
  const f=searchFixture(false);f.seedPlan('P','Finished',[{id:'T1',title:'Match',kind:'task',status:'done'},{id:'T2',title:'Match',kind:'task',status:'done'}]);f.apply('P',{op:'finish',outcome:'finished'});const s=await serve(f.store);
  try{
    const before=await window(s,{q:'Match',limit:1});const rev=before.hits[0].plan.revision;const keys=[{source:f.alpha.id,plan:'P'}];
    const state=async()=>{const res=await s.get(route('/v1/search-state',{storeId:f.storeId,keys}));assert.equal(res.status,200);return(await res.json()).data[0];};
    for(const [action,cleanupRev] of [['archive',0],['restore',1],['delete',2]] as const){
      const res=await s.get('/v1/plan/'+action,{method:'POST',body:JSON.stringify({storeId:f.storeId,source:f.alpha.id,plan:'P',rev,cleanupRev,oid:action,...(action==='delete'?{confirmed:true}:{})})});assert.equal(res.status,200);
      const now=await state();assert.equal(now.cleanup.revision,cleanupRev+1);assert.equal(now.exists,action!=='delete');if(action!=='delete')assert.equal(now.revision,rev);
      assert.equal((await s.get(searchRoute({q:'Match',limit:1,cursor:before.nextCursor!}))).status,409);
      if(action==='archive'){assert.equal((await window(s)).hits.length,0);assert.equal((await window(s,{archived:'only'})).hits.length,2);}
    }
  }finally{await s.stop();f.cleanup();}
});

test('search freshness returns capture state even when plan revision does not change', async () => {
  const f=searchFixture(),s=await serve(f.store);
  try {
    const path=route('/v1/search-state',{storeId:f.storeId,keys:[{source:f.alpha.id,plan:'P-export'}]});
    const before=await (await s.get(path)).json();
    assert.equal(before.captureEnabled,true);
    for(const enabled of [false,true]) {
      f.store.setEnabled(enabled);
      const response=await s.get(path);assert.equal(response.status,200);
      const state=await response.json();assert.equal(state.captureEnabled,enabled);
      assert.deepEqual(state.data,before.data,'capture state does not change plan revisions or cleanup');
    }
  } finally { await s.stop();f.cleanup(); }
});
