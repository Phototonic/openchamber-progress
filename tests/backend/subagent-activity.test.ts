import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, Events, deferred } from './subagent-test-support.ts';
import { parseRequest } from '../../shared/progress.ts';
import plugin from '../../plugin/index.ts';
import { Store } from '../../shared/store.ts';
import { registerDelegation } from '../../plugin/delegation.ts';
import fs from 'node:fs';

test('built-in-shaped and slim-wrapped-shaped evidence use the same fixed binding path',async()=>{
  // Synthetic replays of the shared structured shape, not separate runtime certification.
  for(const implementation of ['built-in','slim-wrapped'])for(const status of ['completed','running'])await fixture(async f=>{
    f.ctx.tool.list=async()=>{throw Error('Implementation inspection is not a binding gate');};
    const r=f.request();f.declare(r);await f.native();await f.before();await f.after('call-1','message-1','C1',status);await f.close();
    assert.equal(f.plan().revision,2,`${implementation} ${status}`);assert.equal(f.declare(r).delegation.state,'bound');
  });
  await fixture(async f=>{f.declare();await f.before();await f.after();await f.close();assert.equal(f.plan().revision,2,'structured return and verified ancestry no longer require a message-wide census');});
});

test('registered production entry declares without document permission, routes caller authority, and binds gate-complete evidence', {timeout:5000},async t=>{
  const committed=deferred();const originalAfter=Store.prototype.afterRun;
  t.mock.method(Store.prototype,'afterRun',function(this:Store,...args:Parameters<Store['afterRun']>){const result=originalAfter.apply(this,args);if(this.get('source-alpha','plan-alpha')?.revision===2)committed.resolve();return result;});
  const root=fs.mkdtempSync('/tmp/opencode/subagent-entry-');
  for(const p of ['config/opencode','data/opencode','store','project'])fs.mkdirSync(`${root}/${p}`,{recursive:true,mode:0o700});
  const source={id:'source-alpha',verified:true,configRoot:`${root}/config/opencode`,dataRoot:`${root}/data/opencode`};
  const store=new Store(`${root}/store/progress.sqlite`,{create:true});store.registerSource(source);store.bindReads(source.id,true);
  const binding=`${root}/binding.json`;fs.writeFileSync(binding,JSON.stringify({protocolVersion:2,schemaVersion:2,installId:'fixture',version:'0.0.0',database:store.file,storeId:store.list().storeId,source}),{mode:0o600});
  const saved=new Map<string,string|undefined>();
  for(const [key,value] of Object.entries({AGENT_PROGRESS_BINDING:binding,XDG_CONFIG_HOME:`${root}/config`,XDG_DATA_HOME:`${root}/data`,OPENCODE_DB:undefined,OPENCODE_CONFIG_DIR:undefined})) {saved.set(key,process.env[key]);if(value===undefined)delete process.env[key];else process.env[key]=value;}
  const streams=new Set<Events>(),hooks=new Map<string,Set<any>>();let tool:any,dispose:(()=>Promise<void>)|undefined;
  const ctx:any={
    location:{directory:`${root}/project`},
    session:{get:async({sessionID}:any)=>({id:sessionID,parentID:sessionID==='C1'?'A':null,agent:'synthetic',projectID:'alpha',location:{directory:`${root}/project`}}),hook:async()=>({dispose:async()=>{}})},
    event:{subscribe:({signal}:any)=>{const stream=new Events();streams.add(stream);signal.addEventListener('abort',()=>stream.close(),{once:true});return stream;}},
    tool:{transform:async(cb:any)=>cb({namespace(){},add(t:any){tool=t;}}),list:async()=>[],hook:async(name:string,cb:any)=>{const set=hooks.get(name)??new Set();hooks.set(name,set);set.add(cb);return {dispose:async()=>{set.delete(cb);}};}},
    skill:{transform:async(cb:any)=>cb({add(){}})},rpc:{register:async()=>{}},permission:{assert:async()=>{throw Error('Declaration/binding must not read documents');}},
  };
  const report=async(r:any,sessionID='A')=>JSON.parse((await tool.execute(r,{sessionID,agent:'synthetic'})).content);
  const emit=async(type:string,data:any)=>{await Promise.all([...streams].map(stream=>stream.push({type:`session.${type}`,location:ctx.location,durable:{aggregateID:'A',seq:1},data:{sessionID:'A',assistantMessageID:'message-1',...data}})));};
  try {
    dispose=await plugin.setup(ctx) as ()=>Promise<void>;
    assert.equal((await report({op:'start',plan:'plan-alpha',rev:0,oid:'start',title:'Synthetic',items:[{id:'task-1',title:'Task',kind:'task'}]})).rev,1);
    const declaration={op:'delegate',plan:'plan-alpha',rev:1,oid:'declare',assign:['task-1']};
    assert.equal((await report(declaration,'C1')).error,'assignment');
    assert.equal((await report(declaration)).delegation.state,'pending');
    assert.equal(store.get(source.id,'plan-alpha')!.revision,1);
    await emit('tool.input.started',{id:'call-1',name:'subagent'});await emit('tool.called',{id:'call-1'});
    const call={sessionID:'A',messageID:'message-1',id:'call-1',tool:'subagent',agent:'synthetic'};
    for(const cb of hooks.get('execute.before')!)await cb(call);
    for(const cb of hooks.get('execute.after')!)await cb({...call,status:'completed',result:{output:{sessionID:'C1',status:'running'}}});
    await emit('step.ended',{});
    await committed.promise;
    assert.equal((await report(declaration)).delegation.state,'bound');
    await dispose();dispose=undefined;
    assert.equal(store.get(source.id,'plan-alpha')!.revision,2);assert.deepEqual(store.get(source.id,'plan-alpha')!.links,[{sessionId:'C1',itemIds:['task-1']}]);
    assert.ok([...hooks.values()].every(set=>set.size===0));
  } finally {for(const s of streams)s.close();await dispose?.();store.close();for(const[k,v]of saved){if(v===undefined)delete process.env[k];else process.env[k]=v;}fs.rmSync(root,{recursive:true,force:true});}
});

test('declaration is durable, authorized, non-reporting and single-use; second declaration conflicts without replacing',async()=>{
  await fixture(async f=>{
    const before=f.plan(),r=f.request();
    const reply=f.declare(r);assert.equal(reply.delegation.state,'pending');assert.equal(reply.delegation.lostOnRestart,false);
    assert.deepEqual(f.plan(),before);assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM receipts').get()!.n,2);
    assert.deepEqual(f.declare(r),reply);
    assert.throws(()=>f.declare({...r,assign:['task-2']}),/operation-reused/);
    assert.throws(()=>f.declare(f.request({oid:'different'})),/conflict/);
    assert.equal(f.declare(r).delegation.state,'pending');
    f.declare(f.request({oid:'cancel',assign:[]}));f.declare(f.request({oid:'fresh'}));f.declare(f.request({oid:'cancel-again',assign:[]}));
    await f.complete();assert.equal(f.plan().revision,1);
    assert.throws(()=>f.declare(f.request({oid:'child'}),f.actor('C1')),/assignment/);
    for(const assign of [['missing'],['group'],['task-1','task-1'],Array(51).fill('task-1')])assert.throws(()=>f.declare(f.request({oid:'invalid',assign})));
    assert.throws(()=>f.declare(f.request({oid:'stale',rev:0})),/conflict/);
    for(const field of ['child','parent','source','actor','callId','assignmentBinding'])assert.throws(()=>parseRequest({...r,[field]:'forged'}),/invalid/);
    assert.throws(()=>f.declare(f.request({oid:'unverified'}),{...f.actor(),verifiedSource:false}),/source-unverified/);
  });
});

test('no TTL expiry; capture off/on fences durable authority, including old writer control changes',async()=>{
  for(const invalidate of ['ttl','control'])await fixture(async f=>{
    const r=f.request();f.declare(r);await f.native();await f.before();await f.after();
    if(invalidate==='ttl')f.advance(300_000);
    if(invalidate==='control'){f.store.db.exec('UPDATE meta SET enabled=0;UPDATE meta SET enabled=1');}
    await f.close();assert.equal(f.plan().revision,invalidate==='ttl'?2:1);
    if(invalidate==='control')assert.equal(f.declare(r).delegation.state,'retired');
  });
});

test('durable receipt retries do not expire or replace another plan intent',async()=>{
  await fixture(async f=>{
    f.seed('plan-beta');f.declare();
    assert.throws(()=>f.declare({op:'delegate',plan:'plan-beta',rev:1,oid:'other',assign:['task-2']}),/conflict/);
    await f.complete();assert.equal(f.plan().revision,2);
    for(let n=0;n<10;n++)f.declare(f.request({oid:`cancel-${n}`,assign:[]}));
    f.advance(300_000);assert.equal(f.declare(f.request({oid:'fresh',assign:['task-2']})).delegation.state,'pending');
  });
});

test('restart retains pending declaration and retry recognition without rearming a bound receipt',async()=>{
  await fixture(async f=>{
    const r=f.request();f.declare(r);await f.native();await f.before();await f.after();
    await f.binding.settled();await f.reload();await f.close();assert.equal(f.plan().revision,2);
    await f.after();await f.close();assert.equal(f.plan().revision,2);
    await f.reload();assert.equal(f.plan().items[0]!.assignmentBinding!.childSessionId,'C1');
  });
});

test('pending parent cap reserves capacity before acceptance',async()=>{
  await fixture(async f=>{
    for(let n=0;n<128;n++) {
      const id=`parent-${n}`,plan=`plan-${n}`;f.records.set(id,{id,parentID:null});f.seed(plan,id);
      f.declare({op:'delegate',plan,oid:'declare',rev:1,assign:['task-1']},f.actor(id));
    }
    assert.throws(()=>f.declare(),/busy/);await f.complete();assert.equal(f.plan().revision,1);
  });
});

test('partial delegation setup disposes successful hooks; retained callbacks cannot affect tools or write later',async()=>{
  await fixture(async f=>{
    await f.restart();let disposed=0,callback:any;
    const sentinel=new Error('Synthetic registration failure');
    f.ctx.tool.hook=async(name:string,cb:any)=>{if(name==='execute.after')throw sentinel;callback=cb;return {dispose:async()=>{disposed++;}};};
    await assert.rejects(()=>registerDelegation(f.ctx,{store:f.store,sourceId:f.source.id,identity:async()=>f.actor('C1')}),e=>e===sentinel);
    assert.equal(disposed,1);
    await callback({tool:'subagent',sessionID:'A',messageID:'message-1',id:'call-1'});
    assert.equal(f.plan().revision,1);assert.deepEqual(f.plan().links,[]);
  });
});
