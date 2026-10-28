import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { compareCaptureText, CAPTURE_LIMITS as L } from '../../shared/document-comparison.ts';
import { Store } from '../../shared/store.ts';
import { createProgressServer } from '../../service/server.ts';
import { captureFixture } from '../fixtures/document-captures.ts';

test('line diff is literal, preserves endings and reconstructs inserted/removed/modified Unicode lines', () => {
  for (const [a,b] of [['',''],['','🙂\n'],['first\n',''],['one\ntwo\n','one\nthree\n'],['a\r\n','a\n'],['a\n','a'],['<img src="https://invalid.test/a">\n','<script>bad()</script>\n']]) {
    const r=compareCaptureText(a,b); if(a===b){assert.equal(r.state,'equal');continue;}
    assert.equal(r.state,'diff');if(r.state!=='diff')continue;
    const lines=r.hunks.flatMap(h=>h.lines), body=(kind:'added'|'removed')=>lines.filter(l=>l.kind!==kind).map(l=>l.text+(l.ending==='lf'?'\n':l.ending==='crlf'?'\r\n':'')).join('');
    assert.equal(body('added'),a);assert.equal(body('removed'),b);
  }
  // Exhaustive short sequences exercise ambiguous/repeated-line backtracking.
  const values=['','a\n','b\n','a\nb\n','b\na\n','a\na\n','a\nb\na\n'];
  for(const a of values)for(const b of values){const r=compareCaptureText(a,b);if(r.state!=='diff'){assert.equal(a,b);continue;}const rows=r.hunks.flatMap(h=>h.lines);for(const [excluded,expected] of [['added',a],['removed',b]])assert.equal(rows.filter(l=>l.kind!==excluded).map(l=>l.text+'\n').join(''),expected);}
});

test('diff bounds admit maximum bytes and return explicit limits without partial output',()=>{
  const large='x'.repeat(L.documentBytes-4)+'\nold';
  assert.equal(compareCaptureText(large,large).state,'equal');
  const change=compareCaptureText(large,large.slice(0,-3)+'new');assert.deepEqual(change,{state:'limited',reason:'output'});
  const full=('x'.repeat(127)+'\n').repeat(2048);
  assert.equal(Buffer.byteLength(full),L.documentBytes);
  const fullDiff=compareCaptureText(full,full.slice(0,-2)+'y\n');assert.equal(fullDiff.state,'diff');
  assert.deepEqual(compareCaptureText('x'.repeat(L.documentBytes+1),''),{state:'limited',reason:'bytes'});
  assert.deepEqual(compareCaptureText('\n'.repeat(L.lines+1),''),{state:'limited',reason:'lines'});
  assert.deepEqual(compareCaptureText(Array.from({length:2000},(_,i)=>`a${i}\n`).join(''),Array.from({length:2000},(_,i)=>`b${i}\n`).join('')),{state:'limited',reason:'work'});
  const a=Array.from({length:8000},(_,i)=>`line ${i}\n`).join('');const r=compareCaptureText(a,a.replace('line 4000','changed 4000'));assert.equal(r.state,'diff');if(r.state==='diff'){assert.equal(r.hunks.length,1);assert(r.hunks[0].omittedBefore>0);assert(r.omittedAfter>0);assert.equal(r.added,1);}
});

test('stored captures compare without source reads, retained denied capture and changed path remain explicit',()=>{
  const f=captureFixture();try{
    f.seedPlan('Empty','Empty',[]);assert.equal(f.store.documentCaptures(f.request('Empty')).data.length,0);
    const a=f.record('one\n'),b=f.record('two\n');const r=f.request();
    const index=f.store.documentCaptures(r);assert.deepEqual(index.data.map(e=>e.id),[b,a]);assert(index.exhausted);
    assert.equal(f.store.documentComparison(r,a,b).result.state,'diff');
    f.record('', 'P-captures','/fixture/plan.md','denied');let c=f.store.documentComparison(r,a,b);assert.equal(c.current.state,'denied');assert.equal(c.current.captureId,b);assert.equal(c.current.checklistSynchronized,false);
    const same=f.record('two\n','P-captures','/fixture/moved.md');c=f.store.documentComparison(r,b,same);assert.equal(c.result.state,'equal');assert.notEqual(c.before.path,c.after.path);
    f.store.setEnabled(false);assert.equal(f.store.documentComparison(r,a,b).current.captureEnabled,false);
    assert.throws(()=>f.store.documentComparison(r,b,a),/invalid/);assert.throws(()=>f.store.documentComparison({...r,plan:'Empty'},a,b),/not-found/);
  }finally{f.cleanup();}
});

test('discovery is bounded, pages without omissions, and freezes creation revision across ID reuse',()=>{
  const f=captureFixture();try{
    const first=f.record('initial\n');for(let n=0;n<260;n++)f.record(`other ${n}`,'Other');
    const r=f.request(),w=f.store.documentCaptures(r);assert.equal(w.scanned,128);assert.equal(w.data.length,0);assert(!w.exhausted);assert(w.nextCursor);
    // Remove unrelated high IDs, then force SQLite's normal integer-ID reuse below the ceiling.
    f.store.db.prepare('DELETE FROM captures WHERE plan=?').run('Other');const later=f.record('later\n');assert(later<261);
    const rest=f.store.documentCaptures(r,w.nextCursor!);assert.deepEqual(rest.data.map(x=>x.id),[first]);assert(rest.exhausted);
    for(let n=0;n<120;n++)f.record(`content ${n}`);
    let cursor:string|undefined;const all:number[]=[];do{const page=f.store.documentCaptures(r,cursor);assert(page.scanned<=128);assert(page.data.length<=50);assert(Buffer.byteLength(JSON.stringify(page))<=L.responseBytes);all.push(...page.data.map(e=>e.id));cursor=page.nextCursor??undefined;}while(cursor);
    assert.equal(all.length,122);assert.equal(new Set(all).size,122);
    f.store.bindReads(f.beta.id,false);assert.throws(()=>f.store.documentCaptures(r),/conflict/);
  }finally{f.cleanup();}
});

test('read-only requests leave bytes/schema unchanged and enforce current identity and cleanup',()=>{
  const f=captureFixture();try{
    const a=f.record('a'),b=f.record('b'),r=f.request();const bytes=readFileSync(f.store.file),schema=f.store.db.prepare('SELECT name,sql FROM sqlite_master').all();
    const reader=new Store(f.store.file,{readOnly:true});try{reader.bindReads(f.alpha.id,true);reader.documentCaptures(r);reader.documentComparison(r,a,b);}finally{reader.close();}
    assert.deepEqual(readFileSync(f.store.file),bytes);assert.deepEqual(f.store.db.prepare('SELECT name,sql FROM sqlite_master').all(),schema);
    f.store.apply({op:'finish',plan:r.plan,oid:'finished',rev:2,outcome:'finished'},f.actor,{state:'captured',path:'/fixture/plan.md',canonicalPath:'/fixture/plan.md',text:'b',hash:f.store.get(r.source,r.plan)!.document.hash,checkedAt:'2026-01-02T00:00:00Z'});
    const action=(op:'archive'|'restore'|'delete',cleanupRev:number)=>f.store.cleanup(op,{storeId:r.storeId,source:r.source,plan:r.plan,rev:3,cleanupRev,oid:op,...(op==='delete'?{confirmed:true}:{})});
    action('archive',0);assert.throws(()=>f.store.documentComparison(r,a,b),/conflict/);assert.equal(f.store.documentComparison({...r,cleanupRev:1},a,b).result.state,'diff');action('restore',1);action('delete',2);assert.throws(()=>f.store.documentCaptures({...r,cleanupRev:3}),/not-found/);
  }finally{f.cleanup();}
});

test('corrupt metadata fails the whole window and oversized bodies are never returned',()=>{
  const f=captureFixture();try{
    const a=f.record('a'),b=f.record('b'),r=f.request();
    f.store.db.prepare('UPDATE captures SET canonical_path=? WHERE id=?').run('x'.repeat(100000),a);assert.throws(()=>f.store.documentCaptures(r),/corrupt/);
    f.store.db.prepare('UPDATE captures SET canonical_path=?,text=? WHERE id=?').run('/fixture/plan.md','x'.repeat(L.documentBytes+1),a);assert.deepEqual(f.store.documentComparison(r,a,b).result,{state:'limited',reason:'bytes'});
    f.store.db.prepare("UPDATE plans SET snapshot=json_set(snapshot,'$.padding',?) WHERE id=?").run('x'.repeat(L.snapshotBytes),r.plan);assert.throws(()=>f.store.documentCaptures(r),/corrupt/);
  }finally{f.cleanup();}
});

test('snapshot identity and revision mismatches cannot lend another checklist state to the requested plan',()=>{
  const f=captureFixture();try{
    const a=f.record('a'),b=f.record('b'),r=f.request();
    const original=f.store.db.prepare('SELECT snapshot FROM plans WHERE source=? AND id=?').get(r.source,r.plan)!.snapshot;
    for(const [field,value] of [['id','Other'],['sourceId','source-other'],['revision',999]] as const){
      f.store.db.prepare('UPDATE plans SET snapshot=json_set(?, ?, ?) WHERE source=? AND id=?').run(original,`$.${field}`,value,r.source,r.plan);
      assert.throws(()=>f.store.documentCaptures(r),/corrupt/);assert.throws(()=>f.store.documentComparison(r,a,b),/corrupt/);
    }
  }finally{f.cleanup();}
});

test('HTTP capability, strict query/auth/method validation, pinned identity and no-store',async()=>{
  const f=captureFixture();const a=f.record('a'),b=f.record('b'),r=f.request();const server=createProgressServer(f.store,'fixture-only');server.listen(0,'127.0.0.1');await once(server,'listening');
  const base=`http://127.0.0.1:${(server.address() as {port:number}).port}`,get=(path:string,init:RequestInit={})=>fetch(base+path,{...init,headers:{authorization:'Bearer fixture-only',...init.headers}});
  const query=new URLSearchParams(Object.entries(r).map(([k,v])=>[k,typeof v==='object'?JSON.stringify(v):String(v)]));
  const index='/v1/document-captures?'+query,comparison='/v1/document-comparison?'+query+`&before=${a}&after=${b}`;
  try{
    assert.equal((await(await get('/health')).json()).documentCaptureComparison,1);
    for(const route of [index,comparison]){const res=await get(route);assert.equal(res.status,200);assert.equal(res.headers.get('cache-control'),'no-store');assert.equal((await get(route,{headers:{authorization:'bad'}})).status,401);assert.equal((await get(route,{method:'POST'})).status,405);assert.equal((await get(route+'&extra=1')).status,404);assert.equal((await get(route+'&plan=Other')).status,404);}
    for(const suffix of ['&cursor=bad','&cursor=','&cursor='+'x'.repeat(4097)])assert.equal((await get(index+suffix)).status,400);
    assert.equal((await get(comparison.replace(`before=${a}`,'before=-1'))).status,400);
    f.store.bindReads(f.beta.id,false);assert.equal((await get(index)).status,409);
  }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));f.cleanup();}
});
