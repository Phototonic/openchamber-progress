import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, deferred } from './subagent-test-support.ts';

for(const status of ['completed','running'])test(`structured ${status} binds only the reserved dispatch, not task progress`,async()=>{
  await fixture(async f=>{
    const before=f.plan(),r=f.request();f.declare(r);await f.before();await f.after('call-1','message-1','C1',status);await f.binding.settled();
    const p=f.plan();assert.equal(p.revision,2);assert.deepEqual(p.links,[{sessionId:'C1',itemIds:['task-1']}]);assert.equal(p.items[0]!.status,before.items[0]!.status);assert.equal(p.items[0]!.reporterSessionId,before.items[0]!.reporterSessionId);assert.equal(p.reportedAt,before.reportedAt);assert.equal(f.declare(r).delegation.state,'bound');
    assert.equal(p.items[0]!.assignmentBinding!.callId,'call-1');
  });
});

for(const shape of ['missing','cycle','depth','foreign-directory','foreign-project','wrong-native-id','wrong-parent'])test(`reserved intent fails closed for ${shape}`,async()=>{
  await fixture(async f=>{
    f.declare();await f.before();const c=f.records.get('C1');
    if(shape==='missing')f.records.delete('A');if(shape==='cycle')f.records.get('A').parentID='C1';
    if(shape==='depth'){let parent='A';for(let n=0;n<33;n++){const id=`ancestor-${n}`;f.records.set(id,{...c,id,parentID:n?'ancestor-'+(n-1):null});parent=id;}f.records.get('A').parentID=parent;}
    if(shape==='foreign-directory')c.location={directory:'/synthetic/beta'};if(shape==='foreign-project')c.projectID='beta';if(shape==='wrong-native-id')c.id='C2';if(shape==='wrong-parent')c.parentID='B';
    await f.after();await f.binding.settled();assert.equal(f.plan().revision,1);assert.equal(f.declare().delegation.state,'retired');
  });
});

for(const child of [undefined,null,{},'invalid child'])test('unproven structured output consumes reservation without content parsing',async()=>{
  await fixture(async f=>{f.declare();await f.before();await f.hooks.get('execute.after')({tool:'subagent',sessionID:'A',messageID:'message-1',id:'call-1',status:'completed',result:{output:{sessionID:child,status:'completed'}}});await f.binding.settled();assert.equal(f.plan().revision,1);assert.equal(f.declare().delegation.state,'retired');await f.complete('C2','message-2');assert.equal(f.plan().revision,1);});
});

test('database admission order wins over result arrival; parallel calls do not retire or steal intent',async()=>{
  await fixture(async f=>{
    f.declare();await f.before('call-first','message-first');await f.before('call-second','message-second');
    await f.after('call-second','message-second','C2');await f.after('call-first','message-first','C1');await f.binding.settled();
    assert.equal(f.plan().items[0]!.assigneeSessionId,'C1');assert.equal(f.plan().items[0]!.assignmentBinding!.callId,'call-first');assert.equal(f.plan().revision,2);
  });
});

test('pending/reserved authority and original operation recognition survive reload without TTL',async()=>{
  await fixture(async f=>{
    const r=f.request();f.declare(r);f.advance(600000);await f.reload();assert.equal(f.declare(r).delegation.state,'pending');
    await f.before();await f.reload();assert.equal(f.declare(r).delegation.state,'reserved');await f.after();await f.binding.settled();assert.equal(f.declare(r).delegation.state,'bound');
    await f.reload();assert.equal(f.declare(r).delegation.state,'bound');await f.complete('C2','message-new');assert.equal(f.plan().revision,2);
  });
});

for(const change of ['revision','cancel','capture','closed','dispose'])test(`held child lookup cannot cross ${change}`,async()=>{
  await fixture(async f=>{
    const r=f.request();f.declare(r);await f.before();const held=deferred<any>(),entered=deferred();f.lookup(async id=>{if(id==='C1'){entered.resolve();return held.promise;}return f.records.get(id);});await f.after();await entered.promise;
    if(change==='revision')f.store.apply({op:'revise',plan:'plan-alpha',oid:'intervening',rev:1,title:'New title'},f.actor());
    if(change==='cancel')f.declare(f.request({oid:'cancel',assign:[]}));if(change==='capture'){f.store.setEnabled(false);f.store.setEnabled(true);}
    if(change==='closed')f.store.apply({op:'finish',plan:'plan-alpha',oid:'finish',rev:1,outcome:'cancelled'},f.actor());if(change==='dispose')await f.restart();
    held.resolve(f.records.get('C1'));await f.binding.settled();assert.equal(f.plan().links.length,0);
    if(change!=='dispose')assert.equal(f.declare(r).delegation.state,'retired');
  });
});

test('explicit links, union assignment and restricted child/parent relay retain existing authority',async()=>{
  await fixture(async f=>{
    f.store.apply({op:'link',plan:'plan-alpha',oid:'explicit',rev:1,child:'C1',assign:['task-1']},f.actor(),undefined,f.actor('C1'));
    f.declare(f.request({assign:['task-2']}));await f.complete();const p=f.plan();assert.deepEqual(p.links,[{sessionId:'C1',itemIds:['task-1','task-2']}]);
    assert.throws(()=>f.store.apply({op:'change',plan:'plan-alpha',oid:'wrong',rev:p.revision,changes:[{id:'task-1',status:'done'}]},f.actor('C2')),/assignment/);
    const before=p.reportedAt;f.store.apply({op:'change',plan:'plan-alpha',oid:'relay',rev:p.revision,attributed:'C1',changes:[{id:'task-2',status:'blocked'}]},f.actor(),undefined,f.actor('C1'));
    assert.equal(f.plan().items[1]!.status,'blocked');assert.equal(f.store.detail(f.source.id,'plan-alpha').contributions.data.at(-1)!.mode,'parent-relay');assert.equal(typeof before,'string');
  });
});
