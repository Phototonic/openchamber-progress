import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { createProgressServer } from '../../service/server.ts';
import { resolveMention, menuText } from '../../service/mentions.ts';
import { Store } from '../../shared/store.ts';
import { mentionFixture, seedMentionLibrary } from '../fixtures/plan-mentions.ts';

async function serve(store?:Store){
  const start=performance.now(),server=createProgressServer(store,'fixture-only');server.listen(0,'127.0.0.1');await once(server,'listening');
  const base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  const request=(path:string,body?:unknown,init:RequestInit={})=>fetch(base+path,{method:body===undefined?'GET':'POST',body:body===undefined?undefined:JSON.stringify(body),...init,headers:{authorization:'Bearer fixture-only',...init.headers}});
  return {server,request,coldStartMs:performance.now()-start,stop:()=>new Promise<void>(resolve=>server.close(()=>resolve()))};
}
const search=(s:Awaited<ReturnType<typeof serve>>,query='',directory:string|null='/fixture/main')=>s.request('/mentions/search',{query,directory});
const resolve=(s:Awaited<ReturnType<typeof serve>>,id='source-alpha/P')=>s.request('/mentions/resolve',{id});
function evidence(file:string,data:unknown){if(process.env.EVIDENCE){mkdirSync(process.env.EVIDENCE,{recursive:true});writeFileSync(`${process.env.EVIDENCE}/${file}`,JSON.stringify(data,null,2)+'\n');}}

test('authenticated POST reads: strict requests, fixed errors, source-qualified rows, pure complete English resolve',async()=>{
  const f=mentionFixture();f.seed('P','Compose fixture');f.seed('P','Compose fixture',{...f.actor,sourceId:f.beta.id});f.seed('P','Compose fixture',{...f.actor,sourceId:f.other.id});
  const s=await serve(f.store);
  try{
    const before=readFileSync(f.store.file);
    assert.equal((await(await s.request('/health')).json()).planComposerHandoff,1);
    const response=await search(s,'compose');assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');const rows=(await response.json()).items;
    assert.equal(rows.length,3);assert.equal(new Set(rows.map((r:any)=>r.id)).size,3);
    assert(rows.find((r:any)=>r.id==='source-beta/P').subtitle.includes('Unverified OpenCode setup'));
    assert(rows.find((r:any)=>r.id==='source-other/P').subtitle.includes('From another OpenCode setup'));
    assert.equal((await(await search(s,'Task-only needle')).json()).items.length,0);
    const good=await resolve(s);assert.equal(good.status,200);const {text}=await good.json();assert(text.includes('Review before sending'));assert(text.includes('Reported as of'));assert(text.includes('source\\-alpha/P'));assert(text.length<=16000);
    assert.equal((await(await resolve(s)).json()).text,text);
    assert((await(await resolve(s,'source-beta/P')).json()).text.includes('Unverified OpenCode setup'));
    assert((await(await resolve(s,'source-other/P')).json()).text.includes('From another OpenCode setup'));
    for(const path of ['/mentions/search','/mentions/resolve']){
      assert.equal((await s.request(path)).status,405);
      assert.equal((await s.request(path,{}, {headers:{authorization:'Bearer wrong'}})).status,401);
      assert.equal((await s.request(path+'?x=1',{})).status,400);
      assert.equal((await s.request(path,{}, {body:'{'})).status,400);
      assert.equal((await s.request(path,{}, {body:Buffer.from([0xff])})).status,400);
      assert.equal((await s.request(path,{}, {body:'x'.repeat(16385)})).status,413);
    }
    for(const body of [{},{query:'x'},{query:'x',directory:null,extra:1},{query:'x'.repeat(201),directory:null},{query:'x',directory:'a'.repeat(4097)},{query:'x',directory:'\0'},null,[]])assert.equal((await s.request('/mentions/search',body)).status,400);
    for(const id of ['P','a/b/c','*/P','a/','/P'])assert.equal((await resolve(s,id)).status,400);
    assert.equal((await s.request('/mentions/resolve',{id:'source-alpha/P',extra:1})).status,400);
    assert.equal((await resolve(s,'source-alpha/missing')).status,404);
    assert.deepEqual(readFileSync(f.store.file),before,'reads leave all logical and physical store state unchanged');
    // Neither route is allowed to reach the document/history owners.
    f.store.document=()=>{throw Error('document read');};f.store.history=()=>{throw Error('history read');};
    assert.equal((await search(s)).status,200);assert.equal((await resolve(s)).status,200);
    f.store.bindReads(f.alpha.id,false);assert((await(await resolve(s)).json()).text.includes('Unverified OpenCode setup'));
    evidence('mentions-api.json',{authenticatedHttp:true,strictErrors:true,readOnlyBytes:true,completeEnglishResolve:true,sourceCollisions:true,documentHistoryTimingReads:false,rows});
  }finally{await s.stop();f.cleanup();}
  const unavailable=await serve();try{assert.equal((await search(unavailable)).status,503);assert.equal((await resolve(unavailable)).status,503);}finally{await unavailable.stop();}
});

test('ranking: exact directory, unambiguous bound-source project, other locations; active then report then binary key',async()=>{
  const f=mentionFixture();const fixed='2026-01-01T00:00:00.000Z';
  f.seed('A','Rank',f.actor);f.seed('B','Rank',f.actor);f.apply('B',{op:'finish',outcome:'cancelled'});
  f.seed('Z','Rank',{...f.actor,directory:'/fixture/project-location'});
  f.seed('D','Rank',{...f.actor,directory:'/fixture/unrelated',projectId:'other'});
  f.seed('E','Rank',{...f.actor,directory:'/fixture/main-prefix',projectId:'other'});
  f.seed('F','Rank',{...f.actor,sourceId:f.other.id,directory:'/fixture/project-location'});
  // Recorded session identities remain in both locations; source matches are never inferred across setups.
  f.seed('G','Context',{...f.actor,sessionId:'directory-context'});
  f.store.db.prepare("UPDATE plans SET snapshot=json_set(snapshot,'$.reportedAt',?)").run(fixed);
  const s=await serve(f.store);try{
    const ids=(await(await search(s,'Rank')).json()).items.map((r:any)=>r.id);
    assert.deepEqual(ids,['source-alpha/A','source-alpha/B','source-alpha/Z','source-alpha/D','source-alpha/E','source-other/F']);
    f.seed('Missing-context','Context',{...f.actor,sessionId:'missing-project',projectId:undefined});
    const fallback=['source-alpha/A','source-alpha/B','source-alpha/D','source-alpha/E','source-alpha/Z','source-other/F'];
    assert.deepEqual((await(await search(s,'Rank')).json()).items.map((r:any)=>r.id),fallback,'missing project metadata refuses project inference');
    f.apply('Missing-context',{op:'revise',title:'Context'},{...f.actor,sessionId:'missing-project'});
    f.seed('H','Context',{...f.actor,sessionId:'ambiguous-context',projectId:'second-project'});
    assert.deepEqual((await(await search(s,'Rank')).json()).items.map((r:any)=>r.id),fallback,'ambiguous association falls back to directory and stable keys');
    f.seed('AA','Rank',f.actor);
    assert.deepEqual((await(await search(s,'Rank')).json()).items.slice(0,3).map((r:any)=>r.id),['source-alpha/AA','source-alpha/A','source-alpha/B'],'newer active reports rank ahead of older active reports within the same directory');
    assert.equal((await(await search(s,'Rank',null)).json()).items.at(-1).id,'source-alpha/B');
    const long='x'.repeat(118)+'😀'.repeat(30);const shortened=menuText(long);assert(shortened.endsWith('…'));assert(shortened.length<=120);assert(!/[\uD800-\uDBFF]…$/.test(shortened));assert.equal(menuText('a\n<b>\t c'),'a <b> c');
  }finally{await s.stop();f.cleanup();}
});

test('complete paging, changed identities, revision churn, partial contributions and cleanup refuse instead of guessing',async()=>{
  const f=mentionFixture();f.seed('P','Paged',f.actor,Array.from({length:45},(_,n)=>({id:`T${n}`,title:`Task ${n}`,kind:'task',status:'pending'})));
  for(let n=0;n<24;n++)f.apply('P',{op:'change',changes:[{id:'T0',status:n%2?'working':'pending'}]});
  const s=await serve(f.store),original=f.store.mentionDetail.bind(f.store);
  try{
    assert.equal((await resolve(s)).status,200);
    for(const fault of ['store','binding','key','partial','churn','page-cap','formatter-null'] as const){
      f.store.mentionDetail=(source,id,page=0)=>{const r=original(source,id,page);if(fault==='partial')r.contributions.nextCursor=null;if(fault==='page-cap')r.contributions.nextCursor=String(page+1);if(fault==='formatter-null')r.plan.title='x'.repeat(17000);if(page){if(fault==='store')r.storeId='other-store';if(fault==='binding')r.sourceBinding.verified=false;if(fault==='key')r.plan.id='wrong';if(fault==='churn')r.plan.revision++;}return r;};
      const response=await resolve(s);assert([409,503].includes(response.status),fault);assert.equal((await response.json()).text,undefined);
    }
    f.store.mentionDetail=original;
    // A real committed revision between pages restarts and returns the new report.
    let changed=false;
    f.store.mentionDetail=(source,id,page=0)=>{if(page&&!changed){changed=true;f.apply('P',{op:'change',changes:[{id:'T1',status:'done'}]});}return original(source,id,page);};
    const restarted=await resolve(s);assert.equal(restarted.status,200);assert((await restarted.json()).text.includes(`Revision: ${f.store.get(f.alpha.id,'P')!.revision}`));
    f.store.mentionDetail=original;
    let reads=0;f.store.mentionDetail=(...args)=>{reads++;return original(...args);};
    await assert.rejects(resolveMention(f.store,'source-alpha/P',()=>reads<1),{code:'storage'});assert.equal(reads,1,'retirement stops before another page');
    assert.throws(()=>f.store.mentionCandidates(null,()=>false),{code:'storage'});
    let disconnect=()=>{};reads=0;
    s.server.once('request',req=>{disconnect=()=>req.socket.destroy();});
    f.store.mentionDetail=(...args)=>{reads++;const page=original(...args);disconnect();return page;};
    await assert.rejects(resolve(s));assert.equal(reads,1,'disconnected HTTP requests cease further detail work');
    f.store.mentionDetail=original;
    f.apply('P',{op:'change',changes:Array.from({length:45},(_,n)=>({id:`T${n}`,status:'done'}))});
    f.apply('P',{op:'finish',outcome:'finished'});
    for(const [action,cleanupRev] of [['archive',0],['restore',1],['delete',2]] as const){
      f.store.cleanup(action,{storeId:f.storeId,source:f.alpha.id,plan:'P',rev:f.store.get(f.alpha.id,'P')!.revision,cleanupRev,oid:action,...(action==='delete'?{confirmed:true}:{})});
      assert.equal((await resolve(s)).status,action==='restore'?200:404);
    }
  }finally{await s.stop();f.cleanup();}
});

test('session lookup: owner, currently linked child, historical contributor, unrelated and source collision',async()=>{
  const f=mentionFixture();f.seed('P','Session fixture');
  f.apply('P',{op:'link',child:f.historical.sessionId,assign:['T']},f.actor,f.historical);
  f.apply('P',{op:'change',attributed:f.historical.sessionId,changes:[{id:'T',status:'pending'}]},f.actor,f.historical);
  f.apply('P',{op:'link',child:f.historical.sessionId,assign:[]},f.actor,f.historical);
  f.apply('P',{op:'link',child:f.child.sessionId,assign:['T']},f.actor,f.child);
  f.seed('P','Other setup',{...f.actor,sourceId:f.other.id});
  const s=await serve(f.store);try{
    for(const session of [f.actor.sessionId,f.child.sessionId,f.historical.sessionId,'unrelated']){
      const response=await s.request('/v1/plans?source=source-alpha&session='+session);assert.equal(response.status,200);const r=await response.json();assert.equal(r.nextCursor,null);assert.deepEqual(r.data.map((p:any)=>p.id),session==='unrelated'?[]:['P']);assert(r.data.every((p:any)=>p.sourceId===f.alpha.id));
    }
    assert.equal((await(await s.request('/v1/plans?session='+f.actor.sessionId)).json()).data.length,2,'same-spelled session in another setup requires bound-source filtering');
  }finally{await s.stop();f.cleanup();}
});

test('additive Store seams preserve ordinary detail/list paging and legacy input admission',async()=>{
  const f=mentionFixture();f.seed('P','Legacy detail',f.actor,Array.from({length:45},(_,n)=>({id:`T${n}`,title:`Task ${n}`,kind:'task',status:'pending'})));
  try{
    const before=readFileSync(f.store.file),list=f.store.list(),pages=[0,1,2].map(page=>f.store.detail(f.alpha.id,'P',page));
    assert.deepEqual(pages.map(p=>p.items.data.length),[20,20,5]);
    assert.deepEqual(pages.map(p=>p.items.nextCursor),['1','2',null]);
    assert(pages.every(p=>!('assembly' in p)));
    for(let page=0;page<3;page++){
      const {assembly,...bounded}=f.store.mentionDetail(f.alpha.id,'P',page);
      assert.equal(assembly?.itemCount,45);assert.deepEqual(bounded,pages[page]);
    }
    f.store.mentionCandidates('/fixture/main');await resolveMention(f.store,'source-alpha/P',()=>true);
    assert.deepEqual(f.store.list(),list);assert.deepEqual([0,1,2].map(page=>f.store.detail(f.alpha.id,'P',page)),pages);assert.deepEqual(readFileSync(f.store.file),before);
    // A read-only legacy store needs no schema or capture change to use the new seam.
    const reader=new Store(f.store.file,{readOnly:true});try{reader.bindReads(f.alpha.id,true);assert.equal((await resolveMention(reader,'source-alpha/P',()=>true)).text.length>0,true);}finally{reader.close();}
    // Fault-only expanded records demonstrate that mention admission never becomes
    // a new rejection boundary for existing companion/UI detail or list callers.
    f.store.db.prepare("UPDATE contributions SET payload=json_set(payload,'$.padding',?) WHERE plan='P'").run('x'.repeat(16385));
    assert.equal(f.store.detail(f.alpha.id,'P').contributions.data.length,1);
    assert.throws(()=>f.store.mentionDetail(f.alpha.id,'P'),{code:'storage'});
    f.store.db.prepare("UPDATE contributions SET payload=json_remove(payload,'$.padding') WHERE plan='P'").run();
    f.store.db.prepare("UPDATE plans SET snapshot=json_set(snapshot,'$.padding',?) WHERE id='P'").run('x'.repeat(1024*1024));
    assert.equal(f.store.detail(f.alpha.id,'P').items.data.length,20);assert.equal(f.store.list().data.length,1);
    assert.throws(()=>f.store.mentionDetail(f.alpha.id,'P'),{code:'storage'});
  }finally{f.cleanup();}
});

test('bounded scan and representative warm sequential/concurrent latency: 450 plans and 1700 tasks',async t=>{
  const f=mentionFixture();seedMentionLibrary(f);const s=await serve(f.store);
  try{
    const cold=performance.now();assert.equal((await search(s)).status,200);const coldRequestMs=performance.now()-cold;
    for(const q of ['', 'matching','no-match'])await search(s,q);
    const samples:{query:string;ms:number}[]=[];
    async function measured(query:string){const start=performance.now(),res=await search(s,query);assert.equal(res.status,200);const rows=(await res.json()).items;assert(rows.length<=20);assert.equal(new Set(rows.map((r:any)=>r.id)).size,rows.length);if(query==='no-match')assert.equal(rows.length,0);samples.push({query,ms:performance.now()-start});}
    for(let n=0;n<20;n++)await measured(['','matching','no-match'][n%3]);
    for(let burst=0;burst<2;burst++)await Promise.all(['','match','ordinary','no-match'].map(measured));
    const seq=samples.slice(0,20).map(r=>r.ms).sort((a,b)=>a-b),p95=seq[Math.ceil(seq.length*.95)-1],max=Math.max(...samples.map(r=>r.ms));
    assert(p95<1000,`warm p95 ${p95}`);assert(max<2000,`maximum ${max}`);
    const read=f.store.mentionCandidates('/fixture/main');assert(read.work.planSlots<=512);assert(read.work.inputBytes<=16*1024*1024);assert.equal(read.limited,false);
    const report={runtime:{node:process.versions.node,platform:process.platform,arch:process.arch},fixture:{plans:450,tasks:1700},coldStartMs:s.coldStartMs,coldRequestMs,warmP95Ms:p95,maxRequestMs:max,samples,work:read.work,bounds:{plans:512,sessions:512,snapshotBytes:1048576,totalBytes:16777216,cooperativeMs:500}};
    evidence('performance.json',report);t.diagnostic(JSON.stringify(report));
    // Labelled fault input: oversized snapshots are skipped before driver materialization.
    f.store.db.prepare("UPDATE plans SET snapshot=json_set(snapshot,'$.padding',?) WHERE id='P-0000'").run('x'.repeat(1024*1024));
    assert((await(await search(s)).json()).items.every((r:any)=>r.subtitle.includes('Limited search')));
    for(let n=450;n<520;n++)f.seed(`P-${n}`,'Extra');
    const capped=f.store.mentionCandidates(null);assert.equal(capped.work.planSlots,512);assert(capped.limited);
    await assert.rejects(resolveMention(f.store,'source-alpha/P-0000',()=>true),{code:'storage'});
    // Individually admissible input can still exhaust the shared 16 MiB budget.
    f.store.db.prepare("UPDATE plans SET snapshot=json_set(snapshot,'$.padding',?) WHERE source='source-alpha'").run('x'.repeat(800000));
    const byteBound=f.store.mentionCandidates(null);assert(byteBound.limited);assert(byteBound.work.inputBytes<=16*1024*1024);assert(byteBound.work.planSlots<512);
  }finally{await s.stop();f.cleanup();}
});
