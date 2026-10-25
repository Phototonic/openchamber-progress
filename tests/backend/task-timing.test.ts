import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { Store } from '../../shared/store.ts';
import { createProgressServer } from '../../service/server.ts';
import { taskTiming, TIMING_LIMITS } from '../../service/task-timing.ts';
import { productionFixture } from '../fixtures/production.ts';
import { SetupController } from '../../service/setup-controller.ts';
import { writeFileSync } from 'node:fs';
import type { Envelope, PlanRead, Request } from '../../shared/progress.ts';

const at = (minute: number) => new Date(Date.UTC(2026, 0, 1, 0, minute));
const items = [{id:'I1',title:'First',kind:'task' as const,status:'working' as const}, {id:'I2',title:'Other',kind:'task' as const}];

test('QA-T authenticated HTTP derives continuous intervals from real v2 writes, replay and reopen', async t => {
  t.mock.timers.enable({apis:['Date'],now:at(0)});
  const f=productionFixture(), server=createProgressServer(f.store,'fixture-only');
  let rev=0, oid=0;
  const apply=(r:Partial<Request>)=>f.store.apply({plan:'P1',oid:`o${oid++}`,rev,...r},f.actor).rev;
  try {
    server.listen(0,'127.0.0.1'); await once(server,'listening');
    const url=`http://127.0.0.1:${(server.address() as any).port}/v1/plan?source=${f.source.id}&plan=P1`;
    const read=async()=>{const r=await fetch(url,{headers:{authorization:'Bearer fixture-only'}});assert.equal(r.status,200);return await r.json() as Envelope & PlanRead;};
    const check=async(minute:number|null)=>{
      const d=await read();assert.equal(d.schemaVersion,2);assert.equal(d.protocolVersion,2);
      assert.deepEqual(d.timing?.items,minute===null?{}:{I1:{since:at(minute).toISOString(),kind:'exact'}});
      return d;
    };
    rev=apply({op:'start',title:'Timing',items:items.map(i=>({...i,status:'pending'}))}); await check(null);
    t.mock.timers.setTime(at(1).getTime());rev=apply({op:'change',changes:[{id:'I1',status:'working'}]}); await check(1);
    t.mock.timers.setTime(at(2).getTime());rev=apply({op:'change',changes:[{id:'I1',status:'working'}]}); await check(1);
    t.mock.timers.setTime(at(3).getTime());rev=apply({op:'change',changes:[{id:'I2',status:'blocked'}]});
    rev=f.store.apply({op:'link',plan:'P1',oid:'link',rev,child:f.child.sessionId,assign:['I1']},f.actor,undefined,f.child).rev;
    const relay={op:'change',plan:'P1',oid:'relay',rev,attributed:f.child.sessionId,changes:[{id:'I1',status:'working'}]} as const;
    rev=f.store.apply({...relay,changes:[...relay.changes]},f.actor,undefined,f.child).rev;
    assert.equal(f.store.apply({...relay,changes:[...relay.changes]},f.actor,undefined,f.child).rev,rev);
    rev=apply({op:'revise',title:'Renamed',reopen:true,items:[items[1]!,items[0]!]}); await check(1);
    t.mock.timers.setTime(at(4).getTime());rev=apply({op:'change',changes:[{id:'I1',status:'blocked'}]}); await check(null);
    rev=apply({op:'change',changes:[{id:'I1',status:'working'}]}); await check(4);
    rev=apply({op:'finish',outcome:'cancelled'}); await check(null);
    t.mock.timers.setTime(at(5).getTime());rev=apply({op:'revise',title:'Reopen',reopen:true}); await check(5);
    rev=apply({op:'revise',items:[items[1]!]}); await check(null);
    t.mock.timers.setTime(at(6).getTime());rev=apply({op:'revise',items});const before=await check(6);
    t.mock.timers.setTime(at(7).getTime());const after=await check(6);
    assert.notEqual(before.timing?.readAt,after.timing?.readAt);
    assert.equal(f.store.detail(f.source.id,'P1').timing,undefined,'stored/capture read remains unchanged');
    const reopened=new Store(f.store.file);
    try {assert.deepEqual(taskTiming(reopened,reopened.detail(f.source.id,'P1')).items,after.timing?.items);} finally {reopened.close();}
    assert.equal((await fetch(url)).status,401);
    assert.equal((await fetch(url,{headers:{authorization:'Bearer wrong'}})).status,401);
    assert.equal((await fetch(url,{method:'POST',headers:{authorization:'Bearer fixture-only'}})).status,405);
  } finally {await new Promise<void>(resolve=>server.close(()=>resolve()));f.cleanup();}
});

test('QA-T creation, bounded history and unknown corrupt/gapped chronology without backfill', t=>{
  t.mock.timers.enable({apis:['Date'],now:at(0)});
  const f=productionFixture();
  try {
    let rev=f.store.apply({op:'start',plan:'P1',oid:'start',rev:0,title:'Created working',items:[...items,{id:'G',title:'Group',kind:'group',status:'working'}]},f.actor).rev;
    const read=()=>taskTiming(f.store,f.store.detail(f.source.id,'P1'),at(1000));
    assert.deepEqual(read().items,{I1:{since:at(0).toISOString(),kind:'exact'}});
    for(let i=1;i<=TIMING_LIMITS.revisions;i++){
      t.mock.timers.setTime(at(i).getTime());rev=f.store.apply({op:'revise',plan:'P1',oid:`r${i}`,rev,title:`Title ${i}`},f.actor).rev;
    }
    assert.deepEqual(read().items,{I1:{since:at(1).toISOString(),kind:'lower-bound'}});
    const before=f.store.db.prepare('SELECT count(*) AS n FROM revisions').get()!.n;
    const current=f.store.db.prepare('SELECT snapshot FROM revisions WHERE revision=?').get(rev)!.snapshot as string;
    const change=(snapshot:unknown)=>f.store.db.prepare('UPDATE revisions SET snapshot=? WHERE revision=?').run(JSON.stringify(snapshot),rev);
    for(const reportedAt of ['invalid','2026-02-30T00:00:00.000Z',at(1001).toISOString()]){
      change({...JSON.parse(current),reportedAt});assert.deepEqual(read().items,{});
    }
    change({...JSON.parse(current),items:[]});assert.deepEqual(read().items,{});
    change(JSON.parse(current));
    const older=f.store.db.prepare('SELECT snapshot FROM revisions WHERE revision=?').get(rev-1)!.snapshot as string;
    f.store.db.prepare('UPDATE revisions SET snapshot=? WHERE revision=?').run(JSON.stringify({...JSON.parse(older),reportedAt:at(999).toISOString()}),rev-1);
    assert.deepEqual(read().items,{},'backwards chronology is unknown');
    f.store.db.prepare('UPDATE revisions SET snapshot=? WHERE revision=?').run(older,rev-1);
    f.store.db.prepare('DELETE FROM contributions WHERE revision=?').run(rev-1);
    f.store.db.prepare('DELETE FROM revisions WHERE revision=?').run(rev-1);assert.deepEqual(read().items,{});
    assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM revisions').get()!.n,Number(before)-1);
    f.store.db.prepare('DELETE FROM contributions WHERE revision=?').run(rev);
    f.store.db.prepare('DELETE FROM revisions WHERE revision=?').run(rev);assert.deepEqual(read().items,{});
  } finally {f.cleanup();}
});

test('QA-T pinned concurrent writes and page revisions, source/plan/store identity and fresh reads',t=>{
  t.mock.timers.enable({apis:['Date'],now:at(0)});
  const f=productionFixture(), other=productionFixture();
  try {
    const many=Array.from({length:25},(_,i)=>({id:`I${i+1}`,title:`Item ${i}`,kind:'task' as const,status:'working' as const}));
    f.store.apply({op:'start',plan:'P1',oid:'start',rev:0,title:'Paged',items:many},f.actor);
    const page0=f.store.detail(f.source.id,'P1');
    // A real new revision between Store.detail's transaction and the timing read.
    t.mock.timers.setTime(at(1).getTime());f.store.apply({op:'change',plan:'P1',oid:'block',rev:1,changes:[{id:'I1',status:'blocked'}]},f.actor);
    const timing0=taskTiming(f.store,page0);
    assert.equal(timing0.items.I1?.since,at(0).toISOString());
    const page1=f.store.detail(f.source.id,'P1',1), timing1=taskTiming(f.store,page1);
    assert.notEqual(page0.plan.revision,page1.plan.revision,'consumer must restart mismatched pages');
    assert.equal(timing1.items.I1,undefined);
    assert.equal(Object.keys(timing0.items).length,25,'one scan serves all pages');
    assert.equal(Object.keys(timing1.items).length,24);
    other.store.apply({op:'start',plan:'P1',oid:'start',rev:0,title:'Other database',items},other.actor);
    assert.deepEqual(taskTiming(other.store,page0).items,{},'store identity cannot cross');
    assert.deepEqual(taskTiming(f.store,{...page0,plan:{...page0.plan,sourceId:'other'}}).items,{});
    f.store.apply({op:'start',plan:'P2',oid:'start',rev:0,title:'Other plan',items},f.actor);
    assert.equal(taskTiming(f.store,f.store.detail(f.source.id,'P2')).items.I1?.since,at(1).toISOString());
    const source={...f.source,id:'source-other',configRoot:`${f.root}/other-config`,dataRoot:`${f.root}/other-data`};f.store.registerSource(source);
    f.store.apply({op:'start',plan:'P1',oid:'start',rev:0,title:'Other source',items},{...f.actor,sourceId:source.id});
    assert.equal(taskTiming(f.store,f.store.detail(source.id,'P1')).items.I1?.since,at(1).toISOString());
    // No derived cache or handles survive: even same-revision isolated corruption is re-read.
    f.store.db.prepare('DELETE FROM contributions WHERE source=? AND plan=?').run(source.id,'P1');
    f.store.db.prepare('DELETE FROM revisions WHERE source=? AND plan=?').run(source.id,'P1');
    assert.deepEqual(taskTiming(f.store,f.store.detail(source.id,'P1')).items,{});
  } finally {f.cleanup();other.cleanup();}
});

test('QA-T byte budget yields only a lower bound and oversized current yields unknown',t=>{
  t.mock.timers.enable({apis:['Date'],now:at(0)});
  const f=productionFixture();
  try {
    let rev=f.store.apply({op:'start',plan:'P1',oid:'start',rev:0,title:'Byte bound',items},f.actor).rev;
    for(let i=1;i<12;i++) {t.mock.timers.setTime(at(i).getTime());rev=f.store.apply({op:'revise',plan:'P1',oid:`r${i}`,rev,title:`Revision ${i}`},f.actor).rev;}
    // Adversarial isolated snapshots only, never production database rewriting.
    for(const row of f.store.db.prepare('SELECT revision,snapshot FROM revisions').all())
      f.store.db.prepare('UPDATE revisions SET snapshot=? WHERE revision=?').run(JSON.stringify({...JSON.parse(String(row.snapshot)),padding:'x'.repeat(1024*1024)}),Number(row.revision));
    assert.deepEqual(taskTiming(f.store,f.store.detail(f.source.id,'P1'),at(20)).items,{I1:{since:at(5).toISOString(),kind:'lower-bound'}});
    const current=JSON.parse(String(f.store.db.prepare('SELECT snapshot FROM revisions WHERE revision=?').get(rev)!.snapshot));
    f.store.db.prepare('UPDATE revisions SET snapshot=? WHERE revision=?').run(JSON.stringify({...current,padding:'x'.repeat(TIMING_LIMITS.bytes)}),rev);
    assert.deepEqual(taskTiming(f.store,f.store.detail(f.source.id,'P1'),at(20)).items,{});
  }finally{f.cleanup();}
});

test('QA-T actual HTTP pinning and controller close/reopen/new-service recovery',async t=>{
  t.mock.timers.enable({apis:['Date'],now:at(0)});
  const f=productionFixture(), binding=`${f.root}/binding.json`;
  f.store.apply({op:'start',plan:'P1',oid:'start',rev:0,title:'HTTP pinned',items},f.actor);
  writeFileSync(binding,JSON.stringify({protocolVersion:2,schemaVersion:2,installId:'fixture',version:'0.2.4',database:f.store.file,storeId:f.store.list().storeId,source:f.source}),{mode:0o600});
  let setup=new SetupController(binding,()=>{throw new Error('not needed');});
  const original=f.store.detail.bind(f.store);
  f.store.detail=(...args)=>{
    const d=original(...args);
    t.mock.timers.setTime(at(1).getTime());
    f.store.apply({op:'change',plan:'P1',oid:'between',rev:1,changes:[{id:'I1',status:'blocked'}]},f.actor);
    return d;
  };
  let server=createProgressServer(f.store,'fixture-only');
  const read=async()=>{
    server.listen(0,'127.0.0.1');await once(server,'listening');
    const r=await fetch(`http://127.0.0.1:${(server.address() as any).port}/v1/plan?source=${f.source.id}&plan=P1`,{headers:{authorization:'Bearer fixture-only'}});
    assert.equal(r.status,200);return await r.json() as Envelope & PlanRead;
  };
  const stop=()=>new Promise<void>(resolve=>server.close(()=>resolve()));
  try {
    const pinned=await read();assert.equal(pinned.plan.revision,1);assert.equal(pinned.timing?.items.I1?.since,at(0).toISOString());await stop();
    f.store.detail=original;
    f.store.apply({op:'change',plan:'P1',oid:'again',rev:2,changes:[{id:'I1',status:'working'}]},f.actor);
    server=createProgressServer(undefined,'fixture-only',undefined,setup);
    const recovered=await read();assert.equal(recovered.timing?.items.I1?.since,at(1).toISOString());
    const oldHandle=setup.current().store!;setup.current();assert.throws(()=>oldHandle.db.prepare('SELECT 1'));
    await stop();setup.close();
    setup=new SetupController(binding,()=>{throw new Error('not needed');});
    server=createProgressServer(undefined,'fixture-only',undefined,setup);
    const fresh=await read();assert.deepEqual(fresh.timing?.items,recovered.timing?.items);
  }finally{if(server.listening)await stop();setup.close();f.cleanup();}
});
