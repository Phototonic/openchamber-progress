import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { Store } from '../../shared/store.ts';
import { RUN_LIMITS } from '../../shared/subagent-runs.ts';
import { fixture } from './subagent-test-support.ts';
import { seedRunReadFixture } from '../fixtures/subagent-activity-runs.ts';

const request=(f:any,extra={})=>({storeId:f.store.list().storeId,binding:{sourceId:f.source.id,verified:true},source:f.source.id,root:'A',plan:'plan-alpha',cleanupRev:0,...extra});
const key={source:'source-alpha',parent:'A',message:'message-1',call:'call-1'};
const start={source:'source-alpha',child:'C1',id:'event-start',sequence:10,at:2000,state:'running' as const,errorType:null,interruptionReason:null};

test('real Store fixture freezes bounded distinct run/session counts and native provenance',()=>{
  const root=fs.mkdtempSync('/tmp/opencode/run-fixture-');fs.chmodSync(root,0o700);
  const f=seedRunReadFixture(path.join(root,'store.sqlite'));
  try{
    const view=f.read();assert.equal(view.subagentRuns,1);assert.equal(view.runFormat,1);assert.equal(view.availability,'ready');
    assert.deepEqual(view.counts,{children:5,runs:4,historicalSessions:1,running:1,succeeded:2,failed:1,interrupted:1,unknown:0});
    assert.equal(view.data.length,4);assert.equal(view.data[0]!.ran.state,'running');assert.equal(view.coverage.complete,true);
    const history=f.store.subagentRuns({...f.request,view:'history'});assert.equal(history.data.length,1);assert.equal(history.data[0]!.kind,'historical-session');assert.equal(history.data[0]!.dispatch,null);assert.equal(history.data[0]!.ran.startedAt,null);
    assert.ok(view.data.every(r=>Buffer.byteLength(JSON.stringify(r))<=RUN_LIMITS.dtoBytes));assert.ok(Buffer.byteLength(JSON.stringify(view))<=RUN_LIMITS.responseBytes);
    assert.equal(f.store.get('source-fixture','plan-fixture')!.items[0]!.status,'blocked');
    const reopened=new Store(f.store.file,{readOnly:true});try{reopened.bindReads('source-fixture',true);assert.deepEqual(reopened.subagentRuns(f.request).data,view.data);}finally{reopened.close();}
  }finally{f.store.close();fs.rmSync(root,{recursive:true,force:true});}
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
    store.db.exec('DROP TABLE runs_foreign');store.installSubagentRuns();store.db.exec('PRAGMA ignore_check_constraints=ON; UPDATE runs_format SET version=2; PRAGMA ignore_check_constraints=OFF');assert.throws(()=>store.subagentRunsAvailable(),/schema/);
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
    const legacy=path.join(path.dirname(f.store.file),'legacy-cleanup');const names=execFileSync('git',['ls-tree','-r','--name-only','e4a38d2','shared'],{encoding:'utf8'}).trim().split('\n');
    for(const name of names){const target=path.join(legacy,name);fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o700});fs.writeFileSync(target,execFileSync('git',['show',`e4a38d2:${name}`]));}
    const script=`import {Store} from ${JSON.stringify(new URL('file://'+path.join(legacy,'shared/store.ts')).href)};const s=new Store(process.argv[1]);s.bindReads('source-alpha',true);const actor=${JSON.stringify(f.actor())};s.apply({op:'change',plan:'plan-alpha',oid:'old-done',rev:1,changes:[{id:'task-1',status:'done'},{id:'task-2',status:'done'}]},actor);s.apply({op:'finish',plan:'plan-alpha',oid:'old-finish',rev:2,outcome:'finished'},actor);s.cleanup('delete',{storeId:s.list().storeId,source:'source-alpha',plan:'plan-alpha',rev:3,cleanupRev:0,oid:'old-delete',confirmed:true});s.close();`;
    execFileSync(process.execPath,['--experimental-strip-types','--input-type=module','-e',script,f.store.file]);
    const result=f.store.subagentRuns(request(f,{plan:undefined,cleanupRev:undefined,view:'history'}));assert.equal(result.data.length,1);assert.equal(result.data[0]!.planContext,null);assert.equal(result.data[0]!.childSessionId,'C1');assert.equal(f.store.get(f.source.id,'plan-alpha'),undefined);assert.equal(f.store.db.prepare('PRAGMA user_version').get()!.user_version,2);assert.deepEqual(f.store.db.prepare('PRAGMA foreign_key_check').all(),[]);
  });
});
