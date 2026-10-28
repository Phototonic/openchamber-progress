import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { blockedTiming } from '../../service/blocked-timing.ts';
import { createProgressServer } from '../../service/server.ts';
import { BLOCKER_LIMITS, type Request, type Envelope, type PlanRead } from '../../shared/progress.ts';
import { productionFixture } from '../fixtures/production.ts';
import { attentionItems } from '../fixtures/needs-you.ts';

const at=(minute:number)=>new Date(Date.UTC(2026,0,1,0,minute));
const single=[{id:'decision',title:'Choose format',kind:'task' as const,status:'blocked' as const}];
async function http(f:ReturnType<typeof productionFixture>){
  const server=createProgressServer(f.store,'fixture-only');server.listen(0,'127.0.0.1');await once(server,'listening');
  const read=async(plan='P-attention',cursor=0)=>{const r=await fetch(`http://127.0.0.1:${(server.address() as {port:number}).port}/v1/plan?source=source-fixture&plan=${plan}&cursor=${cursor}`,{headers:{authorization:'Bearer fixture-only'}});assert.equal(r.status,200);return await r.json() as Envelope & PlanRead;};
  return {read,stop:()=>new Promise<void>(resolve=>server.close(()=>resolve()))};
}

test('V2t actual HTTP exact blocked intervals survive repeats/relay/reason edits and reset at status/lifecycle/identity boundaries',async t=>{
  t.mock.timers.enable({apis:['Date'],now:at(0)});
  const f=productionFixture(), h=await http(f);let rev=0,oid=0;const child={...f.child,sessionId:'C'};
  const apply=(r:Partial<Request>)=>rev=f.store.apply({plan:'P-attention',oid:`timing-${oid++}`,rev,...r},f.actor,undefined,r.child || r.attributed ? child : undefined).rev;
  const check=async(minute:number|null)=>{const d=await h.read();assert.deepEqual(d.blockedTiming?.items.decision,minute===null?undefined:{since:at(minute).toISOString(),kind:'exact'});return d;};
  try {
    apply({op:'start',title:'Reported waits',items:attentionItems.map(i=>{if(i.id!=='decision')return i;const {blocker,...item}=i;return {...item,status:'pending'};})});await check(null);
    t.mock.timers.setTime(at(1).getTime());apply({op:'change',changes:[{id:'decision',status:'blocked',blocker:{category:'decision',reason:'Choose an output format'}}]});await check(1);
    t.mock.timers.setTime(at(2).getTime());apply({op:'change',changes:[{id:'decision',status:'blocked'}]});apply({op:'link',child:'C',assign:['decision']});apply({op:'change',attributed:'C',changes:[{id:'decision',status:'blocked'}]});
    t.mock.timers.setTime(at(3).getTime());apply({op:'change',changes:[{id:'decision',status:'blocked',blocker:{reason:'Choose the format after review'}}]});apply({op:'revise',title:'Neutral title',reopen:true});
    t.mock.timers.setTime(at(6).getTime());const d=await check(1);assert.equal(d.blockedTiming?.readAt,at(6).toISOString());assert.equal(d.items.nextCursor,'1');assert.equal(Object.keys(d.blockedTiming!.items).length,6);assert.deepEqual(d.timing?.items,{});
    const page=await h.read('P-attention',1);assert.equal(page.plan.revision,d.plan.revision);assert.deepEqual(page.blockedTiming,d.blockedTiming,'whole-plan intervals, not page prefix');
    assert.equal(f.store.detail(f.source.id,'P-attention').blockedTiming,undefined,'tool/store reads do not gain service timing');
    const done=d.plan.counts.done;
    t.mock.timers.setTime(at(7).getTime());apply({op:'change',changes:[{id:'decision',status:'working'}]});await check(null);assert.equal((await h.read()).timing?.items.decision?.since,at(7).toISOString());
    t.mock.timers.setTime(at(8).getTime());apply({op:'change',changes:[{id:'decision',status:'blocked'}]});assert.equal((await check(8)).plan.counts.done,done);
    t.mock.timers.setTime(at(9).getTime());apply({op:'finish',outcome:'cancelled'});assert.deepEqual((await check(null)).blockedTiming?.items,{});
    t.mock.timers.setTime(at(10).getTime());apply({op:'revise',title:'Reopened',reopen:true});await check(10);
    t.mock.timers.setTime(at(11).getTime());apply({op:'revise',items:[{id:'other',title:'Other task',kind:'task'}]});await check(null);
    t.mock.timers.setTime(at(12).getTime());apply({op:'revise',items:single});await check(12);
    t.mock.timers.setTime(at(13).getTime());apply({op:'revise',items:[{...single[0]!,kind:'group'}]});await check(null);
    t.mock.timers.setTime(at(14).getTime());apply({op:'revise',items:single});await check(14);
    f.store.apply({op:'start',plan:'P-created',oid:'created',rev:0,title:'Created blocked',items:single},f.actor);assert.equal((await h.read('P-created')).blockedTiming?.items.decision?.since,at(14).toISOString());
  } finally {await h.stop();f.cleanup();}
});

test('V2t actual HTTP capped suffix and SQL admission prove bounded scan/text, oversized current is unknown',async t=>{
  t.mock.timers.enable({apis:['Date'],now:at(0)});
  const f=productionFixture(),h=await http(f);
  try {
    let rev=f.store.apply({op:'start',plan:'P-attention',oid:'start',rev:0,title:'Capped interval',items:single},f.actor).rev;
    for(let i=1;i<=128;i++){t.mock.timers.setTime(at(i).getTime());rev=f.store.apply({op:'revise',plan:'P-attention',oid:`revision-${i}`,rev,title:`Revision ${i}`},f.actor).rev;}
    t.mock.timers.setTime(at(1000).getTime());
    const original=f.store.db.prepare.bind(f.store.db);let visits=0,admitted=0,rejected=0;
    f.store.db.prepare=((sql:string)=>{const statement=original(sql);if(sql.includes('AS bytes,CASE') && sql.includes('FROM revisions')){const get=statement.get.bind(statement);statement.get=((...args:any[])=>{visits++;const row=get(...args);if(row?.snapshot===null)rejected++;else if(row?.snapshot)admitted+=Buffer.byteLength(String(row.snapshot));return row;}) as typeof statement.get;}return statement;}) as typeof f.store.db.prepare;
    const capped=await h.read();assert.deepEqual(capped.blockedTiming?.items,{decision:{since:at(1).toISOString(),kind:'lower-bound'}});assert.equal(visits,128);assert.ok(admitted<=BLOCKER_LIMITS.inputBytes);
    // Preserve exact bytes for restoration; padding belongs only to adversarial
    // fixture snapshots, never normal request input or a stored timing field.
    const rows=original('SELECT revision,snapshot FROM revisions WHERE plan=? ORDER BY revision DESC LIMIT 12').all('P-attention');
    for(const row of rows)original('UPDATE revisions SET snapshot=? WHERE plan=? AND revision=?').run(JSON.stringify({...JSON.parse(String(row.snapshot)),padding:'x'.repeat(1024*1024)}),'P-attention',Number(row.revision));
    visits=admitted=rejected=0;const bounded=await h.read();assert.equal(bounded.blockedTiming?.items.decision?.kind,'lower-bound');assert.ok(visits<128);assert.ok(admitted<=BLOCKER_LIMITS.inputBytes);assert.equal(rejected,1,'budget-crossing text is NULL before it reaches JavaScript');
    const current=rows[0]!;original('UPDATE revisions SET snapshot=? WHERE plan=? AND revision=?').run(JSON.stringify({...JSON.parse(String(current.snapshot)),padding:'x'.repeat(BLOCKER_LIMITS.inputBytes)}),'P-attention',rev);
    visits=admitted=rejected=0;assert.deepEqual((await h.read()).blockedTiming?.items,{});assert.equal(visits,1);assert.equal(admitted,0);assert.equal(rejected,1);
  } finally {await h.stop();f.cleanup();}
});

test('V2t actual HTTP gaps, corrupt/future/regressing history and current mismatches are unknown without backfill',async t=>{
  t.mock.timers.enable({apis:['Date'],now:at(0)});
  const f=productionFixture(),h=await http(f);
  try {
    f.store.apply({op:'start',plan:'P-attention',oid:'start',rev:0,title:'History validation',items:single},f.actor);
    t.mock.timers.setTime(at(1).getTime());f.store.apply({op:'revise',plan:'P-attention',oid:'rename',rev:1,title:'Neutral rename'},f.actor);
    t.mock.timers.setTime(at(6).getTime());
    const rows=f.store.db.prepare('SELECT * FROM revisions ORDER BY revision').all();const current=JSON.parse(String(rows[1]!.snapshot));
    const replace=(value:unknown,revision=2)=>f.store.db.prepare('UPDATE revisions SET snapshot=? WHERE revision=?').run(JSON.stringify(value),revision);
    for(const p of ['invalid',{...current,reportedAt:'invalid'},{...current,reportedAt:'2026-02-30T00:00:00.000Z'},{...current,reportedAt:at(7).toISOString()},{...current,id:'other-plan'},{...current,sourceId:'other-source'},{...current,items:[]},{...current,items:[...single,...single]},{...current,items:[{...single[0],kind:'unknown'}]},{...current,structuralRevision:0}]){
      replace(p);assert.deepEqual((await h.read()).blockedTiming?.items,{});
    }
    replace(current);replace({...JSON.parse(String(rows[0]!.snapshot)),reportedAt:at(2).toISOString()},1);assert.deepEqual((await h.read()).blockedTiming?.items,{});
    replace(JSON.parse(String(rows[0]!.snapshot)),1);
    const baselineCount=f.store.db.prepare('SELECT count(*) AS n FROM revisions').get()!.n;
    f.store.db.prepare('DELETE FROM contributions WHERE revision=1').run();f.store.db.prepare('DELETE FROM revisions WHERE revision=1').run();assert.deepEqual((await h.read()).blockedTiming?.items,{});assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM revisions').get()!.n,Number(baselineCount)-1);
    f.store.db.prepare('DELETE FROM contributions WHERE revision=2').run();f.store.db.prepare('DELETE FROM revisions WHERE revision=2').run();assert.deepEqual((await h.read()).blockedTiming?.items,{});
  } finally {await h.stop();f.cleanup();}
});

for(const scenario of [{name:'regression',structural:false,older:2},{name:'jump greater than one',structural:true,older:1}]){
  test(`V2t actual HTTP adjacent structural-revision ${scenario.name} is unknown without a start claim`,async t=>{
    t.mock.timers.enable({apis:['Date'],now:at(0)});
    const f=productionFixture(),h=await http(f);
    try {
      f.store.apply({op:'start',plan:'P-attention',oid:'start',rev:0,title:'Structural history',items:single},f.actor);
      for(let rev=1;rev<=2;rev++){
        t.mock.timers.setTime(at(rev).getTime());f.store.apply({plan:'P-attention',oid:`revision-${rev}`,rev,...(scenario.structural?{op:'revise',title:`Revision ${rev}`,items:single}:{op:'change',changes:[{id:'decision',status:'blocked'}]})},f.actor);
      }
      t.mock.timers.setTime(at(6).getTime());
      assert.deepEqual((await h.read()).blockedTiming?.items,{decision:{since:at(0).toISOString(),kind:'exact'}});
      const row=f.store.db.prepare('SELECT snapshot FROM revisions WHERE revision=2').get()!;
      f.store.db.prepare('UPDATE revisions SET snapshot=? WHERE revision=2').run(JSON.stringify({...JSON.parse(String(row.snapshot)),structuralRevision:scenario.older}));
      assert.deepEqual((await h.read()).blockedTiming?.items,{});
    } finally {await h.stop();f.cleanup();}
  });
}

test('V2t pinned detail survives later progress writes but refuses store/source/page/cleanup identity mismatches',async t=>{
  t.mock.timers.enable({apis:['Date'],now:at(0)});
  const f=productionFixture(),other=productionFixture();let h:Awaited<ReturnType<typeof http>>|undefined;
  try {
    f.store.apply({op:'start',plan:'P-attention',oid:'start',rev:0,title:'Pinned waits',items:attentionItems},f.actor);
    const original=f.store.detail.bind(f.store);let mutated=false;
    f.store.detail=(...args)=>{const detail=original(...args);if(!mutated){mutated=true;t.mock.timers.setTime(at(1).getTime());f.store.apply({op:'change',plan:'P-attention',oid:'after-detail',rev:1,changes:[{id:'decision',status:'pending'}]},f.actor);}return detail;};
    h=await http(f);const old=await h.read();assert.equal(old.plan.revision,1);assert.equal(old.blockedTiming?.items.decision?.since,at(0).toISOString());
    const next=await h.read('P-attention',1);assert.equal(next.plan.revision,2);assert.equal(next.blockedTiming?.items.decision,undefined,'mixed detail revisions must be restarted by the consumer');
    assert.deepEqual(blockedTiming(other.store,old).items,{});
    assert.deepEqual(blockedTiming(f.store,{...old,plan:{...old.plan,sourceId:'source-other'}}).items,{});
    assert.deepEqual(blockedTiming(f.store,{...old,items:{data:[{...old.items.data[1]!,title:'Mismatched page'}],nextCursor:null}}).items,{});
    assert.deepEqual(blockedTiming(f.store,{...old,plan:{...old.plan,cleanup:{state:'visible',revision:1}}}).items,{});
    const oldService=original(f.source.id,'P-attention');assert.equal(oldService.blockedTiming,undefined,'missing optional timing remains representable as unavailable');
  } finally {await h?.stop();f.cleanup();other.cleanup();}
});

test('V2t one current snapshot serves 1000 task entries, never one scan per task/page',t=>{
  t.mock.timers.enable({apis:['Date'],now:at(0)});
  const f=productionFixture();
  try {
    for(let chunk=0;chunk<20;chunk++)f.store.apply({op:'stage',plan:'P-attention',oid:`stage-${chunk}`,rev:0,upload:'maximum',chunk,items:Array.from({length:50},(_,i)=>({id:`task-${chunk*50+i}`,title:'Reported wait',kind:'task',status:'blocked'}))},f.actor);
    f.store.apply({op:'commit',plan:'P-attention',oid:'commit',rev:0,upload:'maximum',chunks:20,title:'Maximum plan'},f.actor);
    const detail=f.store.detail(f.source.id,'P-attention',49);
    const timing=blockedTiming(f.store,detail,at(6));assert.equal(Object.keys(timing.items).length,1000);assert.equal(timing.items['task-999']?.kind,'exact');assert.equal(detail.items.data.length,20);
    const before=f.store.db.prepare('SELECT snapshot FROM plans').get()!.snapshot;blockedTiming(f.store,detail,at(7));assert.equal(f.store.db.prepare('SELECT snapshot FROM plans').get()!.snapshot,before);
  } finally {f.cleanup();}
});
