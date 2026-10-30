import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './subagent-test-support.ts';
import { parseReportRequest } from '../../shared/progress.ts';
import { Store } from '../../shared/store.ts';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec=promisify(execFile);
const key={source:'source-alpha',parent:'A',message:'message-1',call:'call-1'};
const start={source:'source-alpha',child:'C1',id:'event-start',sequence:10,at:2000,state:'running' as const,errorType:null,interruptionReason:null};
const read=(f:any,extra={})=>f.store.subagentRuns({storeId:f.store.list().storeId,binding:{sourceId:f.source.id,verified:true},source:f.source.id,root:'A',plan:'plan-alpha',cleanupRev:0,...extra});

for(const state of ['succeeded','failed','interrupted'] as const)for(const reason of state==='interrupted'?['user','shutdown','superseded','inactivity'] as const:[null])test(`out-of-order native ${state}/${reason} joins terminal-before-start-before-after safely`,async()=>{
  await fixture(async f=>{
    const before=f.plan();f.store.beforeRun(key,f.actor(),'subagent',{},1000);
    f.store.observeExecution({...start,state,id:'event-end',sequence:11,at:3000,errorType:state==='failed'?'SyntheticError':null,interruptionReason:reason});f.store.observeExecution(start);
    f.store.afterRun(key,0,f.actor('C1'),'returned');const r=read(f).data[0];assert.equal(r.ran.state,state);assert.equal(r.ran.interruptionReason,reason);assert.equal(r.ran.startedAt,2000);assert.equal(r.ran.endedAt,3000);
    f.store.observeExecution({...start,id:'old-start',sequence:1,at:1});assert.deepEqual(read(f).data[0],r);assert.deepEqual(f.plan(),before);
  });
});

test('missing starts, clock anomalies, old outcomes and same-child competitors never certify completion',async()=>{
  await fixture(async f=>{
    f.store.beforeRun(key,f.actor(),'subagent',{},1000);f.store.afterRun(key,0,f.actor('C1'),'returned');
    f.store.observeExecution({...start,state:'succeeded',id:'missing-start-terminal',sequence:11,at:3000});assert.equal(read(f).data[0].ran.state,'unknown');
    f.store.observeExecution({...start,at:4000});assert.equal(read(f).data[0].ran.state,'running');assert.equal(read(f).data[0].ran.endedAt,null);
    const second={...key,call:'call-2',message:'message-2'};f.store.beforeRun(second,f.actor(),'subagent',{},5000);f.store.afterRun(second,0,f.actor('C1'),'returned');
    f.store.observeExecution({...start,id:'second-start',sequence:12,at:6000});f.store.observeExecution({...start,state:'succeeded',id:'second-end',sequence:13,at:7000});assert.equal(read(f).data.find((r:any)=>r.dispatch.callId==='call-2').ran.state,'unknown');
  });
});

test('sequential same-child dispatches are distinct while old terminal evidence is never reused',async()=>{
  await fixture(async f=>{
    f.store.beforeRun(key,f.actor(),'subagent',{},1000);f.store.observeExecution(start);f.store.observeExecution({...start,state:'succeeded',sequence:11,id:'first-end',at:3000});f.store.afterRun(key,0,f.actor('C1'),'returned');
    const second={...key,call:'call-2',message:'message-2'};f.store.beforeRun(second,f.actor(),'subagent',{},4000);f.store.afterRun(second,0,f.actor('C1'),'returned');assert.equal(read(f).data[0].ran.state,'unknown');
    f.store.observeExecution({...start,sequence:12,id:'second-start',at:5000});f.store.observeExecution({...start,state:'interrupted',sequence:13,id:'second-end',at:6000,interruptionReason:'user'});
    const v=read(f);assert.equal(v.counts.children,1);assert.equal(v.counts.runs,2);assert.equal(v.data[0].ran.state,'interrupted');assert.equal(v.data[1].ran.state,'succeeded');
  });
});

test('Q1 context does not create assignment; explicit intent selects a plan; nested context stays distinct',async()=>{
  await fixture(async f=>{
    f.seed('plan-beta');f.store.beforeRun(key,f.actor(),'subagent',{},1000);assert.equal(read(f).data.length,0);assert.equal(read(f,{view:'history'}).data[0].planContext,null);
    f.declare(f.request({oid:'choose-beta',plan:'plan-beta'}));const k={...key,call:'chosen'};f.store.beforeRun(k,f.actor(),'subagent',{},1100);f.store.afterRun(k,0,f.actor('C1'),'returned');
    const row=f.store.subagentRuns({storeId:f.store.list().storeId,binding:{sourceId:f.source.id,verified:true},source:f.source.id,root:'A',plan:'plan-beta',cleanupRev:0}).data[0]!;assert.equal(row.planContext!.plan,'plan-beta');assert.equal(row.accepted!.items[0]!.status,'pending');assert.equal(f.store.get(f.source.id,'plan-alpha')!.revision,1);
    f.store.beforeRun({...key,parent:'C1',call:'nested'},f.actor('C1'),'subagent',{},1200);const nested=f.store.db.prepare("SELECT payload FROM runs_rows WHERE parent='C1'").get()!;assert.equal(JSON.parse(String(nested.payload)).planContext.plan,'plan-beta');
  });
});

test('nested plan-only context requires a current proven incoming interval, never a historical unresolved dispatch',async()=>{
  await fixture(async f=>{
    f.store.beforeRun(key,f.actor(),'subagent',{},1000);f.store.afterRun(key,0,f.actor('C1'),'returned');
    f.store.beforeRun({...key,parent:'C1',call:'before-start'},f.actor('C1'),'subagent',{},1500);
    assert.equal(JSON.parse(String(f.store.db.prepare("SELECT payload FROM runs_rows WHERE call='before-start'").get()!.payload)).planContext,null);
    f.store.observeExecution(start);f.store.beforeRun({...key,parent:'C1',call:'during-run'},f.actor('C1'),'subagent',{},2500);
    assert.equal(JSON.parse(String(f.store.db.prepare("SELECT payload FROM runs_rows WHERE call='during-run'").get()!.payload)).planContext.plan,'plan-alpha');
    f.store.observeExecution({...start,sequence:12,id:'later-start',at:6000});f.store.beforeRun({...key,parent:'C1',call:'later-unassociated'},f.actor('C1'),'subagent',{},7000);
    assert.equal(JSON.parse(String(f.store.db.prepare("SELECT payload FROM runs_rows WHERE call='later-unassociated'").get()!.payload)).planContext,null);assert.equal(f.plan().revision,1);
  });
});

test('plan-free handoff before parent after attaches once; claim done leaves explicit task blocked',async()=>{
  await fixture(async f=>{
    f.store.apply({op:'change',plan:'plan-alpha',oid:'blocked',rev:1,changes:[{id:'task-1',status:'blocked'}]},f.actor());f.declare();
    f.store.beforeRun(key,f.actor(),'subagent',{},1000);f.store.observeExecution(start);
    const req={op:'handoff',oid:'claim',outcome:'done',summary:'<literal> Safe result'};
    const claim=f.store.handoff(req,f.actor('C1'),2500);assert.equal(claim.handoff.association,'session-only');assert.deepEqual(f.store.handoff(req,f.actor('C1'),2600),claim);
    f.store.observeExecution({...start,state:'succeeded',id:'end',sequence:11,at:3000});f.store.afterRun(key,0,f.actor('C1'),'returned');
    const v=read(f).data[0];assert.equal(v.claimed.association,'execution');assert.equal(v.claimed.summary,req.summary);assert.equal(v.ran.state,'succeeded');assert.equal(v.accepted.items[0].status,'blocked');
    assert.deepEqual(f.store.handoff(req,f.actor('C1'),3100).handoff,v.claimed);assert.throws(()=>f.store.handoff({...req,summary:'altered'},f.actor('C1'),3100),/operation-reused/);assert.throws(()=>f.store.handoff({...req,oid:'another'},f.actor('C1'),3100),/conflict/);
  });
});

test('handoff grammar, caller authentication, capacity and capture controls fail closed',async()=>{
  const good={op:'handoff',oid:'claim',outcome:'partial',summary:'x'.repeat(200)};assert.deepEqual(parseReportRequest(good),good);
  for(const summary of ['','   ','x'.repeat(201),'line\nline','line\rline','nul\0','line\u2028line'])assert.throws(()=>parseReportRequest({...good,summary}),/invalid/);
  for(const extra of ['plan','rev','child','attributed','source','task','sessionId'])assert.throws(()=>parseReportRequest({...good,[extra]:'forged'}),/invalid/);
  await fixture(async f=>{
    assert.throws(()=>f.store.handoff(good,f.actor()),/assignment/);assert.throws(()=>f.store.handoff(good,{...f.actor('C1'),ancestry:null}),/assignment/);assert.throws(()=>f.store.handoff(good,{...f.actor('C1'),sourceId:'other'}),/source-unverified/);
    f.store.setEnabled(false);assert.throws(()=>f.store.handoff(good,f.actor('C1')),/disabled/);f.store.setEnabled(true);assert.equal(f.store.handoff(good,f.actor('C1')).handoff.association,'session-only');assert.equal(f.plan().revision,1);
  });
});

test('independent writers atomically reserve only the first admitted dispatch and persisted receipt never rearms',async()=>{
  await fixture(async f=>{
    const req=f.request();f.declare(req);
    const script=`import {Store} from ${JSON.stringify(new URL('../../shared/store.ts',import.meta.url).href)};const s=new Store(process.argv[1]);s.bindReads('source-alpha',true);s.beforeRun(JSON.parse(process.argv[2]),JSON.parse(process.argv[3]),'subagent',{},1000);s.close();`;
    await Promise.all([1,2].map(n=>exec(process.execPath,['--experimental-strip-types','--input-type=module','-e',script,f.store.file,JSON.stringify({...key,call:'call-'+n}),JSON.stringify(f.actor())])));
    const id=String(f.store.db.prepare('SELECT dispatch FROM runs_intents').get()!.dispatch);const call=String(f.store.db.prepare('SELECT call FROM runs_rows WHERE id=?').get(id)!.call);
    f.store.afterRun({...key,call},0,f.actor('C1'),'returned');const other=call==='call-1'?'call-2':'call-1';f.store.afterRun({...key,call:other},0,f.actor('C2'),'returned');
    assert.equal(f.plan().items[0]!.assignmentBinding!.callId,call);assert.equal(f.plan().revision,2);await f.reload();assert.equal(f.declare(req).delegation.state,'bound');
  });
});

test('terminal-first pruning never resurrects a callback or pruned authored claim',async()=>{
  await fixture(async f=>{
    f.store.beforeRun(key,f.actor(),'subagent',{},1000);f.store.observeExecution(start);f.store.afterRun(key,0,f.actor('C1'),'returned');
    const req={op:'handoff',oid:'claim',summary:'Safe authored result',outcome:'done'};f.store.handoff(req,f.actor('C1'),2500);f.store.observeExecution({...start,state:'succeeded',id:'end',sequence:11,at:3000});
    const template=String(f.store.db.prepare('SELECT payload FROM runs_rows LIMIT 1').get()!.payload);
    f.store.db.prepare(`WITH RECURSIVE n(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<1023) INSERT INTO runs_rows SELECT 'protected-'||i,'source-alpha','A',NULL,'message-other','call-other-'||i,0,0,5000,json_set(?,'$.id','protected-'||i,'$.claimed',json('null'),'$.childSessionId',json('null'),'$.ran.state','unknown') FROM n`).run(template);
    f.store.beforeRun({...key,call:'new'},f.actor(),'subagent',{},6000);assert.equal(read(f).counts.runs,1024);assert.equal(f.store.db.prepare('SELECT count(*) n FROM runs_retired').get()!.n,1);
    f.store.afterRun(key,0,f.actor('C1'),'returned');f.store.observeExecution({...start,state:'succeeded',id:'end',sequence:11,at:3000});assert.throws(()=>f.store.handoff(req,f.actor('C1'),7000),/not-found/);assert.equal(read(f).counts.runs,1024);
    const reopened=new Store(f.store.file,{readOnly:true});try{assert.equal(reopened.subagentRunsAvailable(),true);}finally{reopened.close();}
  });
});

test('an interrupted parent retires its unconfirmed dispatch without poisoning subsequent native intervals',async()=>{
  await fixture(async f=>{
    f.declare();f.store.beforeRun(key,f.actor(),'subagent',{},1000);
    f.store.observeExecution({...start,child:'A',state:'interrupted',sequence:20,id:'parent-interrupt',at:3000,interruptionReason:'user'});
    const next={...key,call:'next',message:'next-message'};f.store.beforeRun(next,f.actor(),'subagent',{},4000);f.store.observeExecution({...start,at:5000});f.store.observeExecution({...start,state:'succeeded',id:'next-end',sequence:11,at:6000});f.store.afterRun(next,0,f.actor('C1'),'returned');
    assert.equal(read(f).data.find((r:any)=>r.dispatch.callId==='next').ran.state,'succeeded');assert.equal(f.plan().revision,1);assert.equal(f.declare().delegation.state,'retired');
  });
});

test('binding write fault preserves the dispatch but atomically rolls back link/provenance and retires intent',async()=>{
  await fixture(async f=>{
    const req=f.request();f.declare(req);f.store.beforeRun(key,f.actor(),'subagent',{},1000);
    f.store.db.exec("CREATE TRIGGER synthetic_binding_fault BEFORE INSERT ON revisions WHEN NEW.revision=2 BEGIN SELECT RAISE(ABORT,'synthetic'); END");
    f.store.afterRun(key,0,f.actor('C1'),'returned');assert.equal(f.plan().revision,1);assert.equal(f.plan().links.length,0);assert.equal(read(f).data[0].ran.dispatchState,'returned');assert.equal(f.declare(req).delegation.state,'retired');
    f.store.db.exec('DROP TRIGGER synthetic_binding_fault');f.store.afterRun(key,0,f.actor('C1'),'returned');assert.equal(f.plan().revision,1);
  });
});

for(const phase of ['reservation','binding'])for(const edge of ['before','after'])test(`process crash ${edge} COMMIT during ${phase} preserves atomic durable authority`,async()=>{
  await fixture(async f=>{
    const req=f.request();f.declare(req);if(phase==='binding')f.store.beforeRun(key,f.actor(),'subagent',{},1000);
    const script=`import {Store} from ${JSON.stringify(new URL('../../shared/store.ts',import.meta.url).href)};const s=new Store(process.argv[1]);s.bindReads('source-alpha',true);const exec=s.db.exec.bind(s.db);s.db.exec=sql=>{if(sql==='COMMIT'&&${JSON.stringify(edge)}==='before')process.exit(0);const r=exec(sql);if(sql==='COMMIT'&&${JSON.stringify(edge)}==='after')process.exit(0);return r;};const key=${JSON.stringify(key)};${phase==='reservation'?`s.beforeRun(key,${JSON.stringify(f.actor())},'subagent',{},1000);`:`s.afterRun(key,0,${JSON.stringify(f.actor('C1'))},'returned');`}`;
    await exec(process.execPath,['--experimental-strip-types','--input-type=module','-e',script,f.store.file]);
    const state=f.declare(req).delegation.state;
    assert.equal(state,phase==='reservation'?(edge==='before'?'pending':'reserved'):(edge==='before'?'reserved':'bound'));
    assert.equal(f.plan().revision,phase==='binding'&&edge==='after'?2:1);
    assert.equal(f.store.db.prepare('PRAGMA integrity_check').get()!.integrity_check,'ok');assert.deepEqual(f.store.db.prepare('PRAGMA foreign_key_check').all(),[]);
  });
});

test('cleanup removes plan association/intent while independent run and authored claim survive',async()=>{
  await fixture(async f=>{
    const req=f.request();f.declare(req);f.store.beforeRun(key,f.actor(),'subagent',{},1000);f.store.observeExecution(start);f.store.handoff({op:'handoff',oid:'claim',summary:'Safe independent claim',outcome:'partial'},f.actor('C1'),2500);f.store.afterRun(key,0,f.actor('C1'),'returned');
    f.store.apply({op:'change',plan:'plan-alpha',oid:'done',rev:2,changes:[{id:'task-1',status:'done'},{id:'task-2',status:'done'}]},f.actor());f.store.apply({op:'finish',plan:'plan-alpha',oid:'finish',rev:3,outcome:'finished'},f.actor());
    f.store.cleanup('delete',{storeId:f.store.list().storeId,source:f.source.id,plan:'plan-alpha',rev:4,cleanupRev:0,oid:'delete',confirmed:true});
    const v=read(f,{plan:undefined,cleanupRev:undefined});assert.equal(v.data[0].planContext,null);assert.equal(v.data[0].claimed.summary,'Safe independent claim');assert.equal(v.data[0].accepted,null);assert.equal(f.store.db.prepare('SELECT count(*) n FROM runs_intents').get()!.n,0);
    assert.throws(()=>f.declare(req),/not-found/);f.store.afterRun(key,0,f.actor('C1'),'returned');assert.equal(f.store.get(f.source.id,'plan-alpha'),undefined);
  });
});

test('staged claim and unmatched-event capacity refuse rather than evict authority; malformed persisted rows fail closed',async()=>{
  await fixture(async f=>{
    for(let n=0;n<256;n++)f.store.handoff({op:'handoff',oid:`claim-${n}`,summary:'Safe staged claim',outcome:'partial'},{...f.actor('C1'),sessionId:`staged-${n}`},1000);
    assert.throws(()=>f.store.handoff({op:'handoff',oid:'over-cap',summary:'Safe staged claim',outcome:'partial'},{...f.actor('C1'),sessionId:'staged-over'},1000),/busy/);assert.equal(f.store.db.prepare('SELECT count(*) n FROM runs_claims').get()!.n,256);
    for(let n=0;n<257;n++)f.store.observeExecution({...start,child:`unmatched-${n}`});assert.equal(f.store.db.prepare('SELECT count(*) n FROM runs_candidates').get()!.n,256);assert.equal(read(f).capture.loss,true);
    f.store.beforeRun(key,f.actor(),'subagent',{},1000);f.store.db.exec("UPDATE runs_rows SET payload=json_set(payload,'$.prompt','SYNTHETIC_PRIVATE_CANARY')");assert.throws(()=>read(f),/corrupt/);
  });
});
