import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { captureFixture } from '../fixtures/document-captures.ts';
import { createProgressServer } from '../../service/server.ts';
import { CaptureController, type CaptureClaim } from '../../ui/shared/capture-comparison.ts';
import { parseCaptureIndex, parseCaptureComparison, parseHealth } from '../../ui/shared/adapter.ts';
import type { ServiceHost } from '../../ui/shared/source.ts';

async function fixture() {
  const f=captureFixture(),a=f.record('First\n'),b=f.record('Second\n'),r=f.request();
  const server=createProgressServer(f.store,'fixture-only');server.listen(0,'127.0.0.1');await once(server,'listening');
  const base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  let visible=true,hold:string|null=null,release:(()=>void)|null=null,fail:string|null=null;const calls:string[]=[];
  const service:ServiceHost={serviceRequest:async q=>{
    calls.push(q.path);const res=await fetch(base+q.path+'?'+new URLSearchParams(q.query),{headers:{authorization:'Bearer fixture-only'}});
    const reply={status:res.status,body:await res.text()};
    if(fail===q.path){fail=null;return {status:503,body:'{"error":"busy"}'};}
    if(hold===q.path){hold=null;await new Promise<void>(resolve=>{release=resolve;});}
    return reply;
  }};
  const controller=new CaptureController({service:current=>({serviceRequest:q=>current()?service.serviceRequest(q):Promise.reject(new Error('retired'))}),visible:()=>visible,changed:()=>{}});
  const claim:CaptureClaim={owner:'account-example',request:r,revision:2,capable:true};
  const panel=()=>controller.claim(claim);
  const until=async(check:()=>boolean)=>{for(let i=0;i<1000;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,2));}throw Error('fixture timeout');};
  return {f,a,b,r,controller,claim,panel,calls,until,hold:(path:string)=>{hold=path;},held:()=>!!release,release:()=>{release?.();release=null;},fail:(path:string)=>{fail=path;},hide:()=>{visible=false;controller.retire();},show:()=>{visible=true;},stop:async()=>{release?.();await new Promise<void>(resolve=>server.close(()=>resolve()));f.cleanup();}};
}

test('comparison is explicit, defaults to newest pair, keeps pins over reports and orders choices',async()=>{
  const x=await fixture();try{
    assert.equal(x.panel().open,false);assert.equal(x.calls.length,0);x.panel().toggle();await x.until(()=>!!x.panel().result);
    assert.deepEqual(x.calls,['/v1/document-captures','/v1/document-comparison']);assert.equal(x.panel().before!.id,x.a);assert.equal(x.panel().after!.id,x.b);
    const next=x.f.record('Third\n');x.claim.revision=3;assert(x.panel().newer);assert.equal(x.panel().after!.id,x.b);assert.equal(x.calls.length,2);
    x.panel().refresh();await x.until(()=>!x.panel().loading);assert(x.panel().entries.some(e=>e.id===next));assert.equal(x.panel().after!.id,x.b);
    x.panel().choose('before',next);x.panel().compare();assert.equal(x.calls.filter(p=>p.endsWith('comparison')).length,1);
    x.panel().choose('after',next);x.panel().compare();await x.until(()=>!!x.panel().result);assert.equal(x.panel().result!.result.state,'equal');
    x.panel().toggle();assert.equal(x.panel().result,null);assert.equal(x.panel().entries.length,0);
  }finally{await x.stop();}
});

test('held pair and discovery replies cannot return after hide, account/source changes or leaving Document',async()=>{
  const x=await fixture();try{
    x.hold('/v1/document-comparison');x.panel().toggle();await x.until(x.held);x.hide();x.show();x.release();await new Promise(r=>setTimeout(r,15));assert.equal(x.panel().result,null);assert(!x.panel().open);
    x.hold('/v1/document-captures');x.panel().toggle();await x.until(x.held);const count=x.calls.length;x.claim.owner='another-account';x.panel();x.release();await new Promise(r=>setTimeout(r,15));assert.equal(x.calls.length,count);assert.equal(x.panel().entries.length,0);
    x.hold('/v1/document-captures');x.panel().toggle();await x.until(x.held);x.controller.beginPaint();x.controller.endPaint();x.release();await new Promise(r=>setTimeout(r,15));assert(!x.panel().open);
    x.claim.capable=false;x.panel().toggle();assert(!x.panel().open);
  }finally{await x.stop();}
});

test('errors retain choices for retry, but a missing capture clears retained bytes and selection',async()=>{
  const x=await fixture();try{
    x.panel().toggle();await x.until(()=>!!x.panel().result);x.fail('/v1/document-comparison');x.panel().compare();await x.until(()=>!!x.panel().comparisonError);assert.equal(x.panel().before!.id,x.a);assert.equal(x.panel().result,null);
    x.panel().compare();await x.until(()=>!!x.panel().result);
    x.f.store.db.prepare('DELETE FROM captures WHERE id=?').run(x.a);x.panel().compare();await x.until(()=>!!x.panel().comparisonError);assert.equal(x.panel().before,null);assert.equal(x.panel().result,null);assert.equal(x.panel().entries.length,0);
  }finally{await x.stop();}
});

test('discovery has a ten-window action limit and preserves selection while older pages replace options',async()=>{
  const x=await fixture();try{
    // Synthetic sparse history inserted directly only to test a large read bound.
    const row=x.f.store.db.prepare('SELECT * FROM captures WHERE id=?').get(x.b)!;
    const insert=x.f.store.db.prepare('INSERT INTO captures(source,plan,revision,hash,text,captured_at,canonical_path) VALUES(?,?,?,?,?,?,?)');
    x.f.store.db.exec('BEGIN');for(let i=0;i<1400;i++)insert.run(row.source,'Other',1,row.hash,row.text,row.captured_at,row.canonical_path);x.f.store.db.exec('COMMIT');
    x.panel().toggle();await x.until(()=>!x.panel().loading);assert.equal(x.calls.length,10);assert(!x.panel().exhausted);assert.equal(x.panel().result,null);
    x.panel().more();await x.until(()=>!!x.panel().result);assert.equal(x.panel().before!.id,x.a);assert.equal(x.panel().after!.id,x.b);assert(x.panel().entries.length<=52);
  }finally{await x.stop();}
});

test('a comparison 404 retires an already successful held discovery response too',async()=>{
  const x=await fixture();try{
    x.panel().toggle();await x.until(()=>!!x.panel().result);
    x.hold('/v1/document-captures');x.panel().refresh();await x.until(x.held);
    x.f.store.db.prepare('DELETE FROM captures WHERE id=?').run(x.a);x.panel().compare();await x.until(()=>!!x.panel().comparisonError);
    const count=x.calls.length;x.release();await new Promise(r=>setTimeout(r,20));
    assert.equal(x.panel().entries.length,0);assert.equal(x.panel().result,null);assert.equal(x.panel().loading,false);assert.equal(x.calls.length,count);
  }finally{await x.stop();}
});

test('adapter rejects mismatched identity, malformed metadata, mixed pairs and invalid diff rows',()=>{
  const f=captureFixture();try{
    const a=f.record('a\r\n'),b=f.record('a\n'),r=f.request(),index=f.store.documentCaptures(r),pair=f.store.documentComparison(r,a,b);
    assert.equal(parseCaptureIndex(JSON.stringify(index),r).data.length,2);assert.equal(parseCaptureComparison(JSON.stringify(pair),r,a,b).result.state,'diff');
    for(const patch of [{sourceBinding:{sourceId:'other',verified:true}},{storeId:'other'},{cleanupRev:1},{documentCaptureComparison:2}])assert.throws(()=>parseCaptureIndex(JSON.stringify({...index,...patch}),r));
    assert.throws(()=>parseCaptureIndex(JSON.stringify({...index,data:[index.data[0],index.data[0]]}),r));
    assert.throws(()=>parseCaptureComparison(JSON.stringify(pair),r,b,a));
    if(pair.result.state==='diff'){const bad=structuredClone(pair);if(bad.result.state==='diff')bad.result.hunks[0].lines[0].oldLine=null;assert.throws(()=>parseCaptureComparison(JSON.stringify(bad),r,a,b));}
    const health={ok:true,ready:true,protocolVersion:2,schemaVersion:2};assert.equal(parseHealth(JSON.stringify(health)).documentCaptureComparison,undefined);assert.equal(parseHealth(JSON.stringify({...health,documentCaptureComparison:1})).documentCaptureComparison,1);
  }finally{f.cleanup();}
});
