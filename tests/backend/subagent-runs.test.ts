import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { Store } from '../../shared/store.ts';
import { RUN_LIMITS } from '../../shared/subagent-runs.ts';
import { fixture } from './subagent-test-support.ts';
import { seedRunReadFixture } from '../fixtures/subagent-activity-runs.ts';
import { versionOneFixture, durableSnapshot } from './subagent-format-support.ts';
import { releasedRuntime } from './subagent-release-support.ts';

const request=(f:any,extra={})=>({storeId:f.store.list().storeId,binding:{sourceId:f.source.id,verified:true},source:f.source.id,root:'A',plan:'plan-alpha',cleanupRev:0,...extra});
const key={source:'source-alpha',parent:'A',message:'message-1',call:'call-1'};
const start={source:'source-alpha',child:'C1',id:'event-start',sequence:10,at:2000,state:'running' as const,errorType:null,interruptionReason:null};

for(const epochless of [false,true])for(const loss of [0,1] as const)test(`format-1 activation preserves evidence: epochless=${epochless}, loss=${loss}`,async()=>{
  await fixture(async f=>{
    f.store.beforeRun(key,f.actor(),'subagent',{},1000);f.store.afterRun(key,0,f.actor('C1'),'returned');f.store.observeExecution(start);
    f.store.declareDelegation(f.request(),f.actor());
    const {plan,cleanupRev,...r}=request(f);f.store.requestRunReconciliation(r);
    f.store.observeExecution({...start,child:'C2',id:'other-start'});
    f.store.handoff({op:'handoff',oid:'migration-claim',summary:'Retained claim',outcome:'done'},f.actor('C2'),2001);
    f.store.maintainRunRecovery(f.source.id,f.actor().directory,'migration-producer',3000);
    const job=f.store.claimRunRecovery(f.source.id,'A')!;f.store.saveRunRecoveryWork(job,{queue:[{id:'A',depth:0}],seen:['A']});
    f.store.db.prepare('INSERT INTO runs_retired VALUES(?,?,?,?,?)').run(f.source.id,'retired-child',1,'retired-claim','synthetic-hash');
    versionOneFixture(f.store.db,epochless,loss);
    const before=durableSnapshot(f.store.db),old=before.data.runs_format![0]!;
    const ro=new Store(f.store.file,{readOnly:true});
    try{
      ro.bindReads(f.source.id,true);
      if(epochless)assert.throws(()=>ro.subagentRuns(r),/schema/);
      else {const v=ro.subagentRuns(r);assert.equal(v.runFormat,1);assert.equal(v.capture.loss,Boolean(loss));assert.equal(v.capture.lossNotice,undefined);}
    }finally{ro.close();}
    if(!epochless){
      assert.throws(()=>f.store.requestRunReconciliation(r),/schema/);
      assert.throws(()=>f.store.dismissRunLoss({...r,observedLossSequence:1}),/schema/);
      assert.throws(()=>f.store.beginRunObservation(),/schema/);
      assert.throws(()=>f.store.runCaptureUnavailable(),/schema/);
      assert.throws(()=>f.store.beforeRun({...key,call:'refused'},f.actor(),'subagent',{},2000),/schema/);
    }
    assert.deepEqual(durableSnapshot(f.store.db),before,'reads and refused writes leave v1 untouched');
    f.store.installSubagentRuns();const after=durableSnapshot(f.store.db);
    for(const [table,rows] of Object.entries(before.data))if(table!=='runs_format')assert.deepEqual(after.data[table],rows,table);
    const v=f.store.subagentRuns(r,5000);assert.equal(v.runFormat,2);assert.equal(v.revision,Number(old.revision)+1);assert.equal(v.capture.loss,Boolean(loss));
    assert.deepEqual(v.capture.lossNotice,{sequence:0,lastLossAt:null,dismissedThrough:0,attention:false});
    assert.equal(v.coverage.reasons.includes('capture-loss'),Boolean(loss));assert.equal(f.store.runControl().generation,old.generation);
    f.store.installSubagentRuns();assert.deepEqual(durableSnapshot(f.store.db),after,'repeat activation is a no-op');
    assert.equal(f.store.db.prepare('PRAGMA integrity_check').get()!.integrity_check,'ok');assert.deepEqual(f.store.db.prepare('PRAGMA foreign_key_check').all(),[]);
  });
});

test('format singleton replacement rolls back at every destructive boundary',async()=>{
  for(const epochless of [false,true])for(const point of ['DROP TABLE runs_format','CREATE TABLE runs_format','INSERT INTO runs_format','CREATE TRIGGER runs_capture_epoch','COMMIT'])await fixture(async f=>{
    f.store.beforeRun(key,f.actor(),'subagent',{},1000);versionOneFixture(f.store.db,epochless,1);
    const before=durableSnapshot(f.store.db),exec=f.store.db.exec.bind(f.store.db),prepare=f.store.db.prepare.bind(f.store.db);
    f.store.db.exec=(sql:string)=>{if(sql.startsWith(point))throw Error('Synthetic migration fault');return exec(sql);};
    f.store.db.prepare=(sql:string)=>{if(sql.startsWith(point))throw Error('Synthetic migration fault');return prepare(sql);};
    try{assert.throws(()=>f.store.installSubagentRuns(),/storage/);}finally{f.store.db.exec=exec;f.store.db.prepare=prepare;}
    assert.deepEqual(durableSnapshot(f.store.db),before,'schema, triggers and all values roll back; no staging objects');
    f.store.installSubagentRuns();assert.equal(f.store.subagentRuns(request(f)).runFormat,2);
  });
});

test('migration and dismissal retire cursors; corrupt v1 singleton is refused before any DDL',async()=>{
  await fixture(async f=>{
    for(let n=0;n<51;n++)f.store.beforeRun({...key,call:`migration-${n}`},f.actor(),'subagent',{},1000+n);
    versionOneFixture(f.store.db,false,1);const r=request(f),first=f.store.subagentRuns(r);assert.ok(first.nextCursor);
    f.store.installSubagentRuns();assert.throws(()=>f.store.subagentRuns({...r,cursor:first.nextCursor!}),/conflict/);
    f.store.runCaptureUnavailable();const gap=f.store.subagentRuns(r);assert.ok(gap.nextCursor);
    const {plan,cleanupRev,...identity}=r;f.store.dismissRunLoss({...identity,observedLossSequence:1});
    assert.throws(()=>f.store.subagentRuns({...r,cursor:gap.nextCursor!}),/conflict/);
    const current=f.store.subagentRuns(r);f.store.dismissRunLoss({...identity,observedLossSequence:1});assert.equal(f.store.subagentRuns({...r,cursor:current.nextCursor!}).data.length,1,'no-op retry preserves current cursor');
  });
  for(const epochless of [false,true])await fixture(async f=>{
    versionOneFixture(f.store.db,epochless,1);f.store.db.exec('UPDATE runs_format SET revision=-1');const before=durableSnapshot(f.store.db);
    assert.throws(()=>f.store.installSubagentRuns(),/schema/);assert.deepEqual(durableSnapshot(f.store.db),before);
  });
});

test('loss notice uses backend wall time, exact boundary, reversal and safe persisted state',async t=>{
  let now=1_800_000_000_000;t.mock.method(Date,'now',()=>now);
  await fixture(async f=>{
    const r=request(f),read=()=>f.store.subagentRuns(r,now);
    assert.deepEqual(read().capture.lossNotice,{sequence:0,lastLossAt:null,dismissedThrough:0,attention:false});
    f.store.beforeRun(key,f.actor(),'subagent',{},1);f.store.afterRun(key,0,f.actor('C1'),'returned');
    f.store.observeExecution(start);const original=read();f.store.observeExecution(start);
    assert.deepEqual(read(),original,'ordinary duplicate is not a loss');
    f.store.runCaptureUnavailable();const detected=read();assert.equal(detected.capture.lossNotice!.lastLossAt,now);
    const stored=durableSnapshot(f.store.db);
    const exec=f.store.db.exec.bind(f.store.db);f.store.db.exec=(sql:string)=>{if(sql==='COMMIT')throw Error('Synthetic loss commit fault');return exec(sql);};
    try{assert.throws(()=>f.store.runCaptureUnavailable(),/storage/);}finally{f.store.db.exec=exec;}
    assert.deepEqual(durableSnapshot(f.store.db),stored,'failed detection commits no time, sequence or epoch');
    for(const [delta,attention] of [[0,true],[86_399_999,true],[86_400_000,false],[-1,true]] as const){
      const v=f.store.subagentRuns(r,now+delta);assert.equal(v.capture.lossNotice!.attention,attention);assert.equal(v.revision,detected.revision);assert.equal(v.coverage.complete,false);assert.ok(v.coverage.reasons.includes('capture-loss'));
      assert.deepEqual(v.data,detected.data);assert.deepEqual(v.counts,detected.counts);
    }
    assert.deepEqual(durableSnapshot(f.store.db),stored,'time passage is read-only');
    const ro=new Store(f.store.file,{readOnly:true});try{ro.bindReads(f.source.id,true);assert.deepEqual(ro.subagentRuns(r,now).capture,detected.capture);}finally{ro.close();}
    const {plan,cleanupRev,...identity}=r;f.store.dismissRunLoss({...identity,observedLossSequence:1},now);
    assert.equal(f.store.subagentRuns(r,now-1).capture.lossNotice!.attention,false);
    f.store.runCaptureUnavailable();assert.deepEqual(read().capture.lossNotice,{sequence:2,lastLossAt:now,dismissedThrough:1,attention:true});
    now--;f.store.runCaptureUnavailable();assert.deepEqual(read().capture.lossNotice,{sequence:3,lastLossAt:now,dismissedThrough:1,attention:true});
    f.store.db.prepare('UPDATE runs_format SET loss_sequence=?,dismissed_loss_sequence=0').run(Number.MAX_SAFE_INTEGER);
    const max=durableSnapshot(f.store.db);assert.throws(()=>f.store.runCaptureUnavailable(),/schema/);assert.deepEqual(durableSnapshot(f.store.db),max);
    f.store.db.exec('UPDATE runs_format SET loss_sequence=1');
    for(const at of [-1,0.5,8_640_000_000_000_001]){f.store.db.prepare('UPDATE runs_format SET last_loss_at=?').run(at);assert.throws(()=>read(),/schema/);}
    f.store.db.prepare('UPDATE runs_format SET last_loss_at=?').run(8_640_000_000_000_000);assert.equal(read().capture.lossNotice!.attention,true);
    for(const sql of ['loss_sequence=-1','loss_sequence=0','dismissed_loss_sequence=2','loss=0','last_loss_at=NULL']){
      f.store.db.exec(`UPDATE runs_format SET ${sql}`);assert.throws(()=>read(),/schema/);f.store.db.exec('UPDATE runs_format SET loss_sequence=1,dismissed_loss_sequence=0,loss=1,last_loss_at=8640000000000000');
    }
  });
});

test('two connections serialize dismissal fences in both commit orders without changing facts or work',async t=>{
  const now=1_800_000_000_000;t.mock.method(Date,'now',()=>now);
  await fixture(async f=>{
    f.seed('other-plan','B');f.store.beforeRun(key,f.actor(),'subagent',{},1000);
    const {plan,cleanupRev,...r}=request(f),other=new Store(f.store.file);other.bindReads(f.source.id,true);
    try{
      f.store.requestRunReconciliation(r);f.store.runCaptureUnavailable();const before=durableSnapshot(f.store.db);
      const ack=(n:number)=>other.dismissRunLoss({...r,observedLossSequence:n},now);
      // Detection first: a held old, unacknowledged fence must conflict.
      f.store.runCaptureUnavailable();const newer=durableSnapshot(f.store.db);
      assert.throws(()=>ack(1),/conflict/);assert.throws(()=>ack(3),/conflict/);assert.deepEqual(durableSnapshot(f.store.db),newer);
      const reply=ack(2);assert.equal(reply.coalesced,false);assert.equal(reply.capture.lossNotice!.attention,false);
      const dismissed=durableSnapshot(f.store.db);assert.equal(ack(2).coalesced,true);assert.deepEqual(durableSnapshot(f.store.db),dismissed);
      // Dismissal first: an equal-time detection gets a strictly newer fence.
      f.store.runCaptureUnavailable();const later=durableSnapshot(f.store.db);const retry=ack(2);
      assert.equal(retry.coalesced,true);assert.equal(retry.acknowledgedLossSequence,2);assert.equal(retry.capture.lossNotice!.sequence,3);assert.equal(retry.capture.lossNotice!.attention,true);assert.deepEqual(durableSnapshot(f.store.db),later);
      f.store.setEnabled(false);const disabled=ack(3);assert.equal(disabled.capture.enabled,false);assert.equal(disabled.capture.loss,true);
      assert.equal(other.subagentRuns({...r,root:'B'},now).capture.lossNotice!.dismissedThrough,3);
      // The acknowledgement itself touches only the format singleton.
      const beforeAck=durableSnapshot(f.store.db);f.store.runCaptureUnavailable();const gap=durableSnapshot(f.store.db);ack(4);
      const afterAck=durableSnapshot(f.store.db);for(const [table,rows] of Object.entries(gap.data))if(table!=='runs_format')assert.deepEqual(afterAck.data[table],rows,table);
      assert.deepEqual(afterAck.data.plans,before.data.plans);assert.deepEqual(afterAck.data.runs_rows,beforeAck.data.runs_rows);
      // A failed commit leaves the checkpoint/revision and all other state intact.
      f.store.runCaptureUnavailable();const failed=durableSnapshot(f.store.db),exec=other.db.exec.bind(other.db);
      other.db.exec=(sql:string)=>{if(sql==='COMMIT')throw Error('Synthetic commit fault');return exec(sql);};
      try{assert.throws(()=>ack(5),/storage/);}finally{other.db.exec=exec;}
      assert.deepEqual(durableSnapshot(f.store.db),failed);assert.equal(ack(5).coalesced,false);
    }finally{other.close();}
    const reopened=new Store(f.store.file,{readOnly:true});try{reopened.bindReads(f.source.id,true);assert.equal(reopened.subagentRuns(r,now).capture.lossNotice!.dismissedThrough,5);}finally{reopened.close();}
  });
});

test('unmodified released v1.0.0 runtime refuses upgraded writes; an already-running observer only advances epochs/revision on reconnect/dispose',async()=>{
  await fixture(async f=>{
    f.store.beforeRun(key,f.actor(),'subagent',{},1000);
    for(let n=0;n<50;n++)f.store.beforeRun({...key,call:`old-observer-${n}`},f.actor(),'subagent',{},1000+n);
    await f.restart();versionOneFixture(f.store.db,false,1);
    const legacy=releasedRuntime(path.dirname(f.store.file));
    const {plan,cleanupRev,...r}=request(f);
    const script=`import assert from 'node:assert/strict';import {once} from 'node:events';import {randomUUID} from 'node:crypto';
      import {Store} from './shared/store.ts';import {createProgressServer} from './service/server.ts';import {createRunCapture} from './plugin/subagent-runs.ts';
      const s=new Store(process.argv[1]);s.bindReads('source-alpha',true);const r=JSON.parse(process.argv[2]),upgraded=process.argv[3]==='upgraded';
      if(process.argv[3]==='observer'){
        const {Store:CurrentStore}=await import(process.argv[4]);
        const capture=createRunCapture({location:{directory:'/synthetic/alpha'}},{store:s,sourceId:r.source,identity:async()=>{throw Error('No identity lookup expected');}});
        const current=new CurrentStore(process.argv[1]);current.bindReads(r.source,true);
        try{
          current.installSubagentRuns();current.runCaptureUnavailable();current.dismissRunLoss({...r,observedLossSequence:1});current.runCaptureUnavailable();
          const reading={...r,view:'history'},before=current.subagentRuns(reading),format=current.db.prepare('SELECT * FROM runs_format').get(),epoch=current.db.prepare('SELECT * FROM runs_observation_epoch').get();
          assert.ok(before.nextCursor);assert.equal(before.capture.lossNotice.sequence,2);assert.equal(before.capture.lossNotice.dismissedThrough,1);
          assert.throws(()=>capture.observationStarted(),/schema/);capture.dispose();
          const after=current.subagentRuns(reading);
          assert.deepEqual({...current.db.prepare('SELECT * FROM runs_format').get()},{...format,revision:format.revision+2});
          assert.deepEqual({...current.db.prepare('SELECT * FROM runs_observation_epoch').get()},{...epoch,epoch:epoch.epoch+2});
          assert.deepEqual(after.capture,before.capture);assert.deepEqual(after.data,before.data);assert.deepEqual(after.counts,before.counts);assert.deepEqual(after.coverage,before.coverage);
          assert.equal(after.coverage.complete,false);assert.ok(after.coverage.reasons.includes('capture-loss'));assert.throws(()=>current.subagentRuns({...reading,cursor:before.nextCursor}),/conflict/);
          assert.throws(()=>s.runCaptureUnavailable(),/schema/);assert.throws(()=>s.runControl(),/schema/);
          // The retired old observer is inert; the matching writer remains usable.
          capture.dispose();assert.equal(current.runObservationEpoch(),epoch.epoch+2);
          const epochBeforeReload=current.runObservationEpoch();current.beginRunObservation();assert.equal(current.runObservationEpoch(),epochBeforeReload+1);
          assert.deepEqual(current.subagentRuns(reading).capture,before.capture);
        }finally{capture.dispose();current.close();s.close();}
        process.exit(0);
      }
      if(upgraded){for(const action of [()=>s.subagentRuns(r),()=>s.installSubagentRuns(),()=>s.beforeRun(${JSON.stringify(key)},${JSON.stringify(f.actor())},'subagent',{},1000),()=>s.requestRunReconciliation(r)])assert.throws(action,/schema/);}
      else {assert.equal(s.subagentRuns(r).runFormat,1);assert.equal(s.subagentRuns(r).capture.loss,true);assert.equal(s.runControl().enabled,true);s.installSubagentRuns();}
      const token=randomUUID(),server=createProgressServer(s,token);server.listen(0,'127.0.0.1');await once(server,'listening');
      try{const res=await fetch('http://127.0.0.1:'+server.address().port+'/health',{headers:{authorization:'Bearer '+token}});assert.equal(res.status,upgraded?503:200);if(upgraded)assert.deepEqual(await res.json(),{error:'schema'});}
      finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));s.close();}`;
    const old=(mode:string)=>execFileSync(process.execPath,['--experimental-strip-types','--input-type=module','-e',script,f.store.file,JSON.stringify(r),mode,new URL('../../shared/store.ts',import.meta.url).href],{cwd:legacy,timeout:15000,stdio:'pipe'});
    const before=durableSnapshot(f.store.db);old('original');assert.deepEqual(durableSnapshot(f.store.db),before);
    const exec=f.store.db.exec.bind(f.store.db);f.store.db.exec=(sql:string)=>{if(sql==='COMMIT')throw Error('Synthetic migration commit fault');return exec(sql);};
    try{assert.throws(()=>f.store.installSubagentRuns(),/storage/);}finally{f.store.db.exec=exec;}
    old('rollback');assert.deepEqual(durableSnapshot(f.store.db),before);
    f.store.installSubagentRuns();const migrated=durableSnapshot(f.store.db);old('upgraded');assert.deepEqual(durableSnapshot(f.store.db),migrated);
    assert.equal(f.store.subagentRuns(r).runFormat,2);f.store.runCaptureUnavailable();assert.equal(f.store.subagentRuns(r).capture.lossNotice!.sequence,1);
    assert.equal(f.store.db.prepare('PRAGMA integrity_check').get()!.integrity_check,'ok');assert.deepEqual(f.store.db.prepare('PRAGMA foreign_key_check').all(),[]);
    versionOneFixture(f.store.db,false,1);old('observer');assert.equal(f.store.subagentRuns(r).capture.lossNotice!.dismissedThrough,1);
  });
});

test('released v1.0.0 creates populated stores that upgrade without losing run evidence',()=>{
  const root=fs.mkdtempSync('/tmp/opencode/released-run-upgrade-');fs.chmodSync(root,0o700);
  try{
    const legacy=releasedRuntime(root);
    for(const loss of [false,true]){
      const file=path.join(root,`release-${loss}.sqlite`);
      const script=`import assert from 'node:assert/strict';
        import {Store} from './shared/store.ts';import {registerDelegation} from './plugin/delegation.ts';
        const s=new Store(process.argv[1],{create:true});
        const root=process.argv[2],source='source-alpha';s.registerSource({id:source,configRoot:root,dataRoot:root,verified:true});s.bindReads(source,true);
        const actor=(id='A')=>({sourceId:source,sessionId:id,agent:'synthetic',directory:'/synthetic/alpha',projectId:'alpha',parentId:id==='A'?null:'A',ancestry:id==='A'?[]:['A'],verifiedSource:true});
        s.apply({op:'start',plan:'plan-alpha',oid:'start',rev:0,title:'Released plan',items:[{id:'task-1',title:'First',kind:'task'}]},actor());
        const hooks=new Map();
        const binding=await registerDelegation({location:{directory:'/synthetic/alpha'},tool:{hook:async(name,fn)=>{hooks.set(name,fn);return {dispose:async()=>{}};}},event:{subscribe:({signal})=>({async *[Symbol.asyncIterator](){await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));}})}},{store:s,sourceId:source,identity:async id=>actor(id)});
        try{
          for(const [i,child] of ['C1','C2'].entries()){
            const event={tool:'subagent',sessionID:'A',messageID:'message-'+i,id:'call-'+i,input:{agent:'explorer',description:'Released run'}};
            await hooks.get('execute.before')(event);
            await hooks.get('execute.after')({...event,status:'completed',result:{output:{sessionID:child,status:'completed'}}});await binding.settledRuns();
            const start={source,child,id:'start-'+i,sequence:1,at:Date.now()+1000,state:'running',errorType:null,interruptionReason:null};s.observeExecution(start);
            if(i===0)s.observeExecution({...start,id:'end-'+i,sequence:2,at:start.at+100,state:'succeeded'});
          }
          if(process.argv[3]==='true')s.runCaptureUnavailable();
        }finally{await binding.dispose();}
        const r={storeId:s.list().storeId,binding:{sourceId:source,verified:true},source,root:'A',plan:'plan-alpha',cleanupRev:0};
        const view=s.subagentRuns(r,5000);assert.equal(view.runFormat,1);assert.equal(view.capture.loss,process.argv[3]==='true');
        console.log(JSON.stringify({r,view}));s.close();`;
      const original=JSON.parse(execFileSync(process.execPath,['--experimental-strip-types','--input-type=module','-e',script,file,root,String(loss)],{cwd:legacy,encoding:'utf8',timeout:15000,stdio:'pipe'}));
      const store=new Store(file);store.bindReads('source-alpha',true);
      try{
        const before=durableSnapshot(store.db);
        assert.equal(before.data.runs_format![0]!.version,1);
        // Prove the frozen fixture is the schema actually installed by the release.
        const copy=path.join(root,`fixture-${loss}.sqlite`);fs.copyFileSync(file,copy);
        const frozen=new Store(copy);try{versionOneFixture(frozen.db,false,loss?1:0);assert.deepEqual(durableSnapshot(frozen.db),before);}finally{frozen.close();}
        store.installSubagentRuns();const migrated=durableSnapshot(store.db),view=store.subagentRuns(original.r,5000);
        for(const [table,rows] of Object.entries(before.data))if(table!=='runs_format')assert.deepEqual(migrated.data[table],rows,table);
        assert.equal(view.runFormat,2);assert.equal(view.revision,original.view.revision+1);
        assert.deepEqual(view.data,original.view.data);assert.deepEqual(view.counts,original.view.counts);
        assert.equal(view.counts.runs,2);assert.equal(view.counts.succeeded,1);assert.equal(view.counts.running,1);
        assert.equal(view.capture.loss,loss);assert.deepEqual(view.capture.lossNotice,{sequence:0,lastLossAt:null,dismissedThrough:0,attention:false});
        assert.equal(view.coverage.reasons.includes('capture-loss'),loss);
        store.installSubagentRuns();assert.deepEqual(durableSnapshot(store.db),migrated,'repeat activation is a no-op');
        const ro=new Store(file,{readOnly:true});try{ro.bindReads('source-alpha',true);assert.deepEqual(ro.subagentRuns(original.r,5000),view);}finally{ro.close();}
        execFileSync(process.execPath,['--experimental-strip-types','--input-type=module','-e',`import assert from 'node:assert/strict';import {Store} from './shared/store.ts';
          const s=new Store(process.argv[1]);s.bindReads('source-alpha',true);const r=JSON.parse(process.argv[2]),{plan,cleanupRev,...identity}=r;
          try{for(const action of [()=>s.subagentRuns(r),()=>s.installSubagentRuns(),()=>s.runCaptureUnavailable(),()=>s.requestRunReconciliation(identity),()=>s.beforeRun(${JSON.stringify(key)},${JSON.stringify({sourceId:'source-alpha',sessionId:'A',agent:'synthetic',directory:'/synthetic/alpha',projectId:'alpha',parentId:null,ancestry:[],verifiedSource:true})},'subagent',{},2000)])assert.throws(action,/schema/);}finally{s.close();}`,file,JSON.stringify(original.r)],{cwd:legacy,timeout:15000,stdio:'pipe',encoding:'utf8'});
        assert.deepEqual(durableSnapshot(store.db),migrated,'released reads and writes refuse without mutation');
        assert.equal(store.db.prepare('PRAGMA integrity_check').get()!.integrity_check,'ok');assert.deepEqual(store.db.prepare('PRAGMA foreign_key_check').all(),[]);
      }finally{store.close();}
    }
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('real Store fixture freezes bounded distinct run/session counts and native provenance',()=>{
  const root=fs.mkdtempSync('/tmp/opencode/run-fixture-');fs.chmodSync(root,0o700);
  const f=seedRunReadFixture(path.join(root,'store.sqlite'));
  try{
    const view=f.read();assert.equal(view.subagentRuns,1);assert.equal(view.runFormat,2);assert.equal(view.availability,'ready');
    assert.deepEqual(view.counts,{children:5,runs:4,historicalSessions:1,running:1,succeeded:2,failed:1,interrupted:1,unknown:0});
    assert.equal(view.data.length,4);assert.equal(view.data[0]!.ran.state,'running');assert.equal(view.coverage.complete,true);
    const history=f.store.subagentRuns({...f.request,view:'history'});assert.equal(history.data.length,1);assert.equal(history.data[0]!.kind,'historical-session');assert.equal(history.data[0]!.dispatch,null);assert.equal(history.data[0]!.ran.startedAt,null);
    const all=[...view.data,...history.data];assert.ok(all.every(r=>r.latestForChild===true));assert.deepEqual(all.map(r=>r.childSessionId).sort(),f.latestChildIds.slice().sort());
    assert.ok(f.store.db.prepare('SELECT payload FROM runs_rows').all().every(v=>!Object.hasOwn(JSON.parse(String(v.payload)),'latestForChild')),'latest selection is never persisted');
    assert.ok(view.data.every(r=>Buffer.byteLength(JSON.stringify(r))<=RUN_LIMITS.dtoBytes));assert.ok(Buffer.byteLength(JSON.stringify(view))<=RUN_LIMITS.responseBytes);
    assert.equal(f.store.get('source-fixture','plan-fixture')!.items[0]!.status,'blocked');
    const reopened=new Store(f.store.file,{readOnly:true});try{reopened.bindReads('source-fixture',true);assert.deepEqual(reopened.subagentRuns(f.request).data,view.data);}finally{reopened.close();}
  }finally{f.store.close();fs.rmSync(root,{recursive:true,force:true});}
});

test('latestForChild prefers dispatch evidence to newer session summaries and leaves childless rows false',async()=>{
  await fixture(async f=>{
    f.store.beforeRun(key,f.actor(),'subagent',{},1000);f.store.afterRun(key,0,f.actor('C1'),'returned');
    f.store.observeExecution(start);f.store.observeExecution({...start,id:'end',sequence:11,at:3000,state:'succeeded'});
    const newer={...key,call:'newer-unproven'};
    f.store.beforeRun(newer,f.actor(),'subagent',{},4000);f.store.afterRun(newer,0,f.actor('C1'),'returned');
    f.store.beforeRun({...key,call:'childless'},f.actor(),'subagent',{},10000);
    const {plan,cleanupRev,...r}=request(f);
    f.store.requestRunReconciliation(r);const job=f.store.claimRunRecovery(f.source.id,'A')!;
    for(const id of ['C1','C2'])f.store.publishRunHistory(job,{id,parent:'A',agent:'explorer',title:'Synthetic history',createdAt:500,updatedAt:9000,idleAt:8000,outcome:'succeeded'});
    f.store.finishRunRecovery(job,'complete');
    const all=[...f.store.subagentRuns(r).data,...f.store.subagentRuns({...r,view:'history'}).data];
    assert.equal(all.find(row=>row.dispatch?.callId==='childless')!.latestForChild,false);
    const c1=all.filter(row=>row.childSessionId==='C1');assert.equal(c1.length,3);
    assert.deepEqual(c1.filter(row=>row.latestForChild).map(row=>row.dispatch?.callId),['newer-unproven']);
    assert.equal(all.find(row=>row.childSessionId==='C2')!.latestForChild,true);
  });
});

test('terminal before after adopts only the verified interval; replay does not alter plan facts',async()=>{
  await fixture(async f=>{
    const before=f.plan();f.store.beforeRun(key,f.actor(),'subagent',{agent:'explorer',description:'Safe description'},1000);
    f.store.observeExecution(start);f.store.observeExecution({...start,id:'event-end',sequence:11,at:3000,state:'succeeded'});
    assert.equal(f.store.subagentRuns(request(f)).data[0]!.childSessionId,null);
    f.store.afterRun(key,f.store.runControl().generation,f.actor('C1'),'returned');
    const r=f.store.subagentRuns(request(f)).data[0]!;assert.equal(r.ran.state,'succeeded');assert.equal(r.ran.startedAt,2000);assert.equal(r.ran.endedAt,3000);assert.equal(r.ran.provenance,'native-event');
    f.store.observeExecution(start);f.store.afterRun(key,f.store.runControl().generation,f.actor('C2'),'returned');
    assert.deepEqual(f.store.subagentRuns(request(f)).data[0],r);assert.deepEqual(f.plan(),before);
  });
});

test('Running has no age expiry; applicable terminal changes only the run, with safe error type',async()=>{
  await fixture(async f=>{
    f.store.beforeRun(key,f.actor(),'subagent',{},1000);f.store.afterRun(key,0,f.actor('C1'),'returned');f.store.observeExecution(start);
    const original=f.store.subagentRuns(request(f),2000).data[0]!;
    for(const elapsed of [59999,60000,180000])assert.deepEqual(f.store.subagentRuns(request(f),2000+elapsed).data[0],original);
    f.store.observeExecution({...start,id:'failure',sequence:11,at:182001,state:'failed',errorType:'unsafe error text'});
    const r=f.store.subagentRuns(request(f)).data[0]!;assert.equal(r.ran.state,'failed');assert.equal(r.ran.errorType,'unknown');assert.equal(f.plan().revision,1);
  });
});

test('strict source, child, project and plan identity; passive capture is plan-independent',async()=>{
  await fixture(async f=>{
    f.store.beforeRun(key,f.actor(),'subagent',{},1000);
    for(const child of [{...f.actor('C1'),sourceId:'other'},{...f.actor('C1'),projectId:'other'},{...f.actor('C1'),parentId:'B'},{...f.actor('C1'),ancestry:null}])assert.throws(()=>f.store.afterRun(key,0,child,'returned'),/binding/);
    assert.throws(()=>f.store.subagentRuns(request(f,{root:'unknown'})),/not-found/);
    assert.throws(()=>f.store.subagentRuns(request(f,{source:'other'})),/conflict/);
    assert.throws(()=>f.store.subagentRuns(request(f,{storeId:'other'})),/conflict/);
    assert.throws(()=>f.store.subagentRuns(request(f,{cleanupRev:1})),/conflict/);
    f.store.beforeRun({...key,parent:'B'},f.actor('B'),'subagent',{},1000);
    const v=f.store.subagentRuns(request(f,{root:'B',plan:undefined,cleanupRev:undefined,view:'history'}));assert.equal(v.counts.runs,1);assert.equal(v.data[0]!.planContext,null);
  });
});

test('capture generation fences a held after callback and recovery publication',async()=>{
  await fixture(async f=>{
    f.store.beforeRun(key,f.actor(),'subagent',{},1000);const generation=f.store.runControl().generation;
    const r=request(f);f.store.requestRunReconciliation({storeId:r.storeId,binding:r.binding,source:r.source,root:r.root});const job=f.store.claimRunRecovery(f.source.id,'A')!;
    f.store.setEnabled(false);f.store.setEnabled(true);f.store.afterRun(key,generation,f.actor('C1'),'returned');
    assert.equal(f.store.subagentRuns(request(f)).data[0]!.childSessionId,null);assert.equal(f.store.runRecoveryAlive(job),false);
    f.store.publishRunHistory(job,{id:'old',parent:'A',agent:null,title:null,createdAt:1,updatedAt:2,idleAt:2,outcome:'succeeded'});
    assert.equal(f.store.subagentRuns(request(f)).counts.children,0);
  });
});

test('extension absence is unavailable, read-only reads never initialize; base writer remains usable',async()=>{
  const dir=fs.mkdtempSync('/tmp/opencode/run-legacy-');fs.chmodSync(dir,0o700);const file=path.join(dir,'store.sqlite');
  const store=new Store(file,{create:true});
  const source={id:'source-legacy',configRoot:'/synthetic/config',dataRoot:'/synthetic/data',verified:true};
  const actor={sourceId:source.id,sessionId:'root',directory:'/synthetic/project',projectId:'project',agent:'synthetic',parentId:null,ancestry:[],verifiedSource:true};
  try{
    store.registerSource(source);store.bindReads(source.id,true);store.apply({op:'start',plan:'plan',oid:'start',rev:0,title:'Legacy',items:[{id:'task',title:'Task',kind:'task'}]},actor);
    const r={storeId:store.list().storeId,binding:{sourceId:source.id,verified:true},source:source.id,root:'root'};
    const ro=new Store(file,{readOnly:true});try{ro.bindReads(source.id,true);assert.equal(ro.subagentRuns(r).availability,'unavailable');assert.equal(ro.subagentRunsAvailable(),false);}finally{ro.close();}
    assert.equal(store.db.prepare("SELECT count(*) n FROM sqlite_master WHERE name GLOB 'runs_*'").get()!.n,0);
    const oldSnapshot=store.get(source.id,'plan');store.installSubagentRuns();assert.deepEqual(store.get(source.id,'plan'),oldSnapshot);assert.equal(store.db.prepare('PRAGMA user_version').get()!.user_version,2);
    versionOneFixture(store.db);store.installSubagentRuns();
    // Load the unmodified approved base writer in a separate Node process.
    const base='e4a38d2';const names=execFileSync('git',['ls-tree','-r','--name-only',base,'shared'],{encoding:'utf8'}).trim().split('\n');
    const legacy=path.join(dir,'baseline');for(const name of names){const target=path.join(legacy,name);fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o700});fs.writeFileSync(target,execFileSync('git',['show',`${base}:${name}`]));}
    execFileSync(process.execPath,['--experimental-strip-types','--input-type=module','-e',`import {Store} from ${JSON.stringify(new URL('file://'+path.join(legacy,'shared/store.ts')).href)};const s=new Store(${JSON.stringify(file)});s.bindReads('source-legacy',true);s.apply({op:'change',plan:'plan',oid:'old-write',rev:1,changes:[{id:'task',status:'working'}]},${JSON.stringify(actor)});s.setEnabled(false);s.setEnabled(true);s.close();`]);
    assert.equal(store.get(source.id,'plan')!.revision,2);assert.equal(store.runControl().generation,2);assert.equal(store.subagentRuns(r).availability,'ready');
    assert.equal(store.db.prepare('PRAGMA integrity_check').get()!.integrity_check,'ok');assert.deepEqual(store.db.prepare('PRAGMA foreign_key_check').all(),[]);
  }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('partial/future extension definitions fail closed without repair',async()=>{
  const dir=fs.mkdtempSync('/tmp/opencode/run-schema-');fs.chmodSync(dir,0o700);const store=new Store(path.join(dir,'store.sqlite'),{create:true});
  try{
    store.db.exec('CREATE TABLE runs_foreign(value TEXT)');assert.throws(()=>store.installSubagentRuns(),/schema/);
    assert.equal(store.db.prepare("SELECT count(*) n FROM sqlite_master WHERE name GLOB 'runs_*'").get()!.n,1);
    store.db.exec('DROP TABLE runs_foreign');store.installSubagentRuns();store.db.exec('PRAGMA ignore_check_constraints=ON; UPDATE runs_format SET version=3; PRAGMA ignore_check_constraints=OFF');assert.throws(()=>store.subagentRunsAvailable(),/schema/);
  }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('DDL and observation faults roll back the whole transaction without changing progress',async()=>{
  const dir=fs.mkdtempSync('/tmp/opencode/run-rollback-');fs.chmodSync(dir,0o700);const store=new Store(path.join(dir,'store.sqlite'),{create:true});
  try{
    const exec=store.db.exec.bind(store.db);store.db.exec=(sql:string)=>{if(sql.startsWith('CREATE INDEX runs_child'))throw Error('Synthetic DDL fault');return exec(sql);};
    assert.throws(()=>store.installSubagentRuns(),/storage/);store.db.exec=exec;assert.equal(store.subagentRunsAvailable(),false);store.installSubagentRuns();
    store.db.exec("CREATE TRIGGER synthetic_fail BEFORE INSERT ON runs_rows BEGIN SELECT RAISE(ABORT,'synthetic'); END");
    const a={sourceId:'source',sessionId:'root',agent:'synthetic',directory:'/synthetic/project',projectId:'p',parentId:null,ancestry:[],verifiedSource:true};store.registerSource({id:'source',configRoot:'/synthetic/config',dataRoot:'/synthetic/data',verified:true});
    assert.throws(()=>store.beforeRun({source:'source',parent:'root',message:'message',call:'call'},a,'subagent',{},1),/storage/);assert.equal(store.db.prepare('SELECT count(*) n FROM runs_rows').get()!.n,0);assert.equal(store.db.prepare('SELECT revision FROM runs_format').get()!.revision,0);
  }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('registered producer projects only allowlisted metadata, terminal-before-after works without handoff',async()=>{
  await fixture(async f=>{
    const canary='SYNTHETIC_NONALLOWLISTED_CANARY';const at=Date.now()+1000;
    await f.hooks.get('execute.before')({...f.ctx,tool:'subagent',sessionID:'A',messageID:'message-1',id:'call-1',agent:'caller-not-child',input:{agent:'explorer',description:'<literal> safe description',prompt:canary,extra:canary}});
    const emit=(type:string,id:string,seq:number,time:number,data:any={})=>f.events.push({type:`session.execution.${type}`,id,created:time,location:f.ctx.location,durable:{aggregateID:'C1',seq},data:{sessionID:'C1',...data},metadata:{canary}});
    await emit('started','event-start',1,at);await emit('failed','event-end',2,at+100,{error:{type:'SyntheticFailure',message:canary,response:{body:canary}}});
    await f.hooks.get('execute.after')({tool:'subagent',sessionID:'A',messageID:'message-1',id:'call-1',status:'completed',result:{output:{sessionID:'C1',status:'completed',output:canary},content:canary}});await f.binding.settledRuns();
    const v=f.store.subagentRuns(request(f));assert.equal(v.data[0]!.ran.state,'failed');assert.equal(v.data[0]!.agent,'explorer');assert.equal(v.data[0]!.description,'<literal> safe description');assert.equal(v.data[0]!.claimed,null);
    const content=['runs_rows','runs_candidates','runs_jobs'].map(table=>JSON.stringify(f.store.db.prepare(`SELECT * FROM ${table}`).all())).join('');assert.ok(!content.includes(canary));assert.ok(!JSON.stringify(v).includes(canary));assert.equal(f.plan().revision,1);
  });
});

test('bounded pagination covers retained scope, cursor is identity/revision bound, resumes count one child',async()=>{
  await fixture(async f=>{
    for(let n=0;n<55;n++)f.store.beforeRun({...key,call:`call-${n}`},f.actor(),'subagent',{description:'x'.repeat(201),agent:'x'.repeat(81)},1000+n);
    const first=f.store.subagentRuns(request(f));assert.equal(first.counts.runs,55);assert.equal(first.data.length,50);assert.ok(first.nextCursor);assert.equal(first.data[0]!.description!.length,200);assert.equal(first.data[0]!.agent!.length,80);
    const second=f.store.subagentRuns(request(f,{cursor:first.nextCursor}));assert.equal(second.data.length,5);assert.equal(second.nextCursor,null);assert.equal(new Set([...first.data,...second.data].map(r=>r.id)).size,55);
    assert.throws(()=>f.store.subagentRuns(request(f,{view:'history',cursor:first.nextCursor})),/conflict/);
    f.store.afterRun({...key,call:'call-0'},0,f.actor('C1'),'returned');f.store.afterRun({...key,call:'call-1'},0,f.actor('C1'),'returned');
    assert.equal(f.store.subagentRuns(request(f)).counts.children,1);assert.throws(()=>f.store.subagentRuns(request(f,{cursor:first.nextCursor})),/conflict/);
  });
});

test('per-parent and store caps refuse protected-only admission with visible capture loss',async()=>{
  await fixture(async f=>{
    f.store.beforeRun(key,f.actor(),'subagent',{},1000);
    const template=String(f.store.db.prepare('SELECT payload FROM runs_rows LIMIT 1').get()!.payload);
    f.store.db.prepare(`WITH RECURSIVE n(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<1023)
      INSERT INTO runs_rows SELECT 'capacity-'||i,'source-alpha','A',NULL,'capacity-message','capacity-call-'||i,0,0,1000,json_set(?,'$.id','capacity-'||i) FROM n`).run(template);
    f.store.beforeRun({...key,call:'refused-parent'},f.actor(),'subagent',{},1001);
    assert.equal(f.store.subagentRuns(request(f)).counts.runs,1024);assert.equal(f.store.subagentRuns(request(f)).capture.loss,true);
    f.store.db.prepare(`WITH RECURSIVE n(i) AS (VALUES(1024) UNION ALL SELECT i+1 FROM n WHERE i<16383)
      INSERT INTO runs_rows SELECT 'capacity-'||i,'source-alpha','other-'||(i/1024),NULL,'capacity-message','capacity-call-'||i,0,0,1000,json_set(?,'$.id','capacity-'||i,'$.parentSessionId','other-'||(i/1024)) FROM n`).run(template);
    f.store.beforeRun({...key,parent:'B',call:'refused-total'},f.actor('B'),'subagent',{},1001);
    assert.equal(f.store.db.prepare('SELECT count(*) n FROM runs_rows').get()!.n,16384);
    assert.equal(f.store.db.prepare("SELECT count(*) n FROM runs_rows WHERE parent='B'").get()!.n,0);
  });
});

test('task is unconfirmed, completed hook output is not success, and a missing callback never inserts',async()=>{
  await fixture(async f=>{
    await f.before('call-task','message-task','A','task');await f.after('call-task','message-task','C1','completed','A','task');await f.binding.settledRuns();
    const v=f.store.subagentRuns(request(f));assert.equal(v.data[0]!.childSessionId,null);assert.equal(v.data[0]!.ran.state,'unknown');assert.equal(v.data[0]!.ran.dispatchState,'unconfirmed');
    f.store.afterRun({...key,call:'missing'},0,f.actor('C1'),'returned');assert.equal(f.store.subagentRuns(request(f)).counts.runs,1);
  });
});

test('native optional-location execution events attach only after verified child lineage; wrong location refuses',async()=>{
  await fixture(async f=>{
    await f.before();const at=Date.now()+1000;
    const emit=(state:string,sequence:number,location?:unknown)=>f.events.push({type:`session.execution.${state}`,id:`event-${sequence}`,created:at+sequence,durable:{aggregateID:'C1',seq:sequence},data:{sessionID:'C1'},...(location===undefined?{}:{location})});
    await emit('started',1);await emit('succeeded',2);await f.after();await f.binding.settled();
    assert.equal(f.store.subagentRuns(request(f)).data[0]!.ran.state,'succeeded');
    await emit('failed',3,{directory:'/synthetic/other'});assert.equal(f.store.subagentRuns(request(f)).data[0]!.ran.state,'succeeded');
  });
});

test('unmodified legacy cleanup in another process preserves run facts while removing their plan association',async()=>{
  await fixture(async f=>{
    f.store.beforeRun(key,f.actor(),'subagent',{},1000);f.store.afterRun(key,0,f.actor('C1'),'returned');
    versionOneFixture(f.store.db);f.store.installSubagentRuns();
    const legacy=path.join(path.dirname(f.store.file),'legacy-cleanup');const names=execFileSync('git',['ls-tree','-r','--name-only','e4a38d2','shared'],{encoding:'utf8'}).trim().split('\n');
    for(const name of names){const target=path.join(legacy,name);fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o700});fs.writeFileSync(target,execFileSync('git',['show',`e4a38d2:${name}`]));}
    const script=`import {Store} from ${JSON.stringify(new URL('file://'+path.join(legacy,'shared/store.ts')).href)};const s=new Store(process.argv[1]);s.bindReads('source-alpha',true);const actor=${JSON.stringify(f.actor())};s.apply({op:'change',plan:'plan-alpha',oid:'old-done',rev:1,changes:[{id:'task-1',status:'done'},{id:'task-2',status:'done'}]},actor);s.apply({op:'finish',plan:'plan-alpha',oid:'old-finish',rev:2,outcome:'finished'},actor);s.cleanup('delete',{storeId:s.list().storeId,source:'source-alpha',plan:'plan-alpha',rev:3,cleanupRev:0,oid:'old-delete',confirmed:true});s.close();`;
    execFileSync(process.execPath,['--experimental-strip-types','--input-type=module','-e',script,f.store.file]);
    const result=f.store.subagentRuns(request(f,{plan:undefined,cleanupRev:undefined,view:'history'}));assert.equal(result.data.length,1);assert.equal(result.data[0]!.planContext,null);assert.equal(result.data[0]!.childSessionId,'C1');assert.equal(f.store.get(f.source.id,'plan-alpha'),undefined);assert.equal(f.store.db.prepare('PRAGMA user_version').get()!.user_version,2);assert.deepEqual(f.store.db.prepare('PRAGMA foreign_key_check').all(),[]);
  });
});
