import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './subagent-test-support.ts';

const key={source:'source-alpha',parent:'A',message:'message',call:'call'};
const start={source:'source-alpha',child:'C1',id:'start',sequence:10,at:2000,state:'running' as const,errorType:null,interruptionReason:null};
const report={op:'handoff',oid:'claim',summary:'Synthetic result',outcome:'partial'};
const read=(f:any)=>f.store.subagentRuns({storeId:f.store.list().storeId,binding:{sourceId:f.source.id,verified:true},source:f.source.id,root:'A',plan:'plan-alpha',cleanupRev:0});
const seed=(f:any)=>{f.store.beforeRun(key,f.actor(),'subagent',{},1000);f.store.afterRun(key,0,f.actor('C1'),'returned');f.store.observeExecution(start);};
const gap=(f:any)=>{
  f.store.setEnabled(false);
  f.store.observeExecution({...start,id:'unobserved-end',sequence:20,at:3000,state:'succeeded'});
  f.store.observeExecution({...start,id:'unobserved-resume',sequence:30,at:4000});
  f.store.setEnabled(true);
};
const terminal=(f:any)=>f.store.observeExecution({...start,id:'resumed-end',sequence:40,at:6000,state:'succeeded'});

test('fact continuity keeps a post-gap handoff session-only instead of attaching by timestamp',async()=>{
  await fixture(async f=>{
    seed(f);gap(f);
    const result=f.store.handoff(report,f.actor('C1'),5000);
    assert.equal(result.handoff.association,'session-only');assert.equal(read(f).data[0]!.claimed,null);
    assert.equal(read(f).capture.loss,true);
  });
});

test('fact continuity keeps a post-gap claim unassociated when the resumed terminal arrives later',async()=>{
  await fixture(async f=>{
    seed(f);gap(f);f.store.handoff(report,f.actor('C1'),5000);terminal(f);
    const result=read(f);assert.equal(result.data[0]!.ran.state,'unknown');assert.equal(result.data[0]!.claimed,null);
    const retry=f.store.handoff(report,f.actor('C1'),7000).handoff;
    assert.equal(retry.association,'session-only');assert.equal(retry.reportedAt,5000);assert.equal(result.capture.loss,true);
  });
});

test('fact continuity revalidates an attached claim when an epoch break makes its interval unknown',async()=>{
  for(const full of [false,true])await fixture(async f=>{
    seed(f);assert.equal(f.store.handoff(report,f.actor('C1'),2500).handoff.association,'execution');
    if(full)f.store.db.prepare(`WITH RECURSIVE n(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<256)
      INSERT INTO runs_claims SELECT 'source-alpha','staged-'||i,0,'staged-'||i,'synthetic',
      json_set(?,'$.oid','staged-'||i,'$.sessionId','staged-'||i,'$.association','session-only') FROM n`).run(JSON.stringify(f.store.handoff(report,f.actor('C1'),2500).handoff));
    gap(f);terminal(f);
    assert.equal(read(f).data[0]!.ran.state,'unknown');assert.equal(read(f).data[0]!.claimed,null);assert.equal(read(f).capture.loss,true);
    if(full){
      assert.throws(()=>f.store.handoff(report,f.actor('C1'),7000),/not-found/);
      assert.throws(()=>f.store.handoff({...report,summary:'Changed result'},f.actor('C1'),7000),/operation-reused/);
    }else assert.equal(f.store.handoff(report,f.actor('C1'),7000).handoff.association,'session-only');
  });
});

test('fact continuity still attaches a same-epoch handoff and a same-epoch staged claim normally',async()=>{
  for(const staged of [false,true])await fixture(async f=>{
    if(staged)assert.equal(f.store.handoff(report,f.actor('C1'),2500).handoff.association,'session-only');
    seed(f);
    const result=f.store.handoff(report,f.actor('C1'),staged?2600:2500).handoff;
    assert.equal(result.association,'execution');assert.equal(result.reportedAt,2500);assert.equal(read(f).data[0]!.claimed!.oid,report.oid);
    assert.equal(read(f).capture.loss,false);
  });
});

test('fact continuity preserves staged provenance across reload and retries instead of borrowing the new epoch',async()=>{
  await fixture(async f=>{
    const original=f.store.handoff(report,f.actor('C1'),2500).handoff;
    await f.reload();seed(f);
    assert.deepEqual(f.store.handoff(report,f.actor('C1'),5000).handoff,original);
    assert.equal(read(f).data[0]!.claimed,null);
  });
});

test('fact continuity uses the reporting companion epoch, not another observer allocator token',async()=>{
  await fixture(async f=>{
    const epoch=f.binding.currentEpoch();seed(f);
    f.store.beginRunObservation();
    assert.equal(f.store.handoff(report,f.actor('C1'),2500,epoch).handoff.association,'execution');
  });
});

test('fact continuity refuses interrupted provenance captured before asynchronous identity resolution',async()=>{
  await fixture(async f=>{
    const epoch=f.binding.currentEpoch();seed(f);gap(f);
    assert.equal(f.store.handoff(report,f.actor('C1'),5000,epoch).handoff.association,'session-only');
    assert.equal(read(f).data[0]!.claimed,null);assert.equal(read(f).capture.loss,true);
  });
});

test('fact continuity never invents provenance for legacy staged or attached claims',async()=>{
  for(const attached of [false,true])await fixture(async f=>{
    if(attached)seed(f);
    f.store.handoff(report,f.actor('C1'),2500);
    if(attached)f.store.db.prepare("UPDATE runs_rows SET payload=json_remove(payload,'$._claimEpochs')").run();
    else {
      f.store.db.prepare("UPDATE runs_claims SET payload=json_remove(payload,'$._epochs')").run();seed(f);
    }
    assert.equal(f.store.handoff(report,f.actor('C1'),5000).handoff.association,'session-only');
    assert.equal(read(f).data[0]!.claimed,null);
  });
});
