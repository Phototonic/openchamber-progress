import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, deferred } from './subagent-test-support.ts';
import { currentBinding } from '../../shared/assignment-binding.ts';
import { Store } from '../../shared/store.ts';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

for(const status of ['completed','running'])test(`one closed dual-census candidate binds ${status} attribution, never task progress`,async()=>{
  await fixture(async f=>{
    const previous=f.plan();const r=f.request();f.declare(r);
    await f.native();await f.before();await f.after('call-1','message-1','C1',status);
    assert.equal(f.plan().revision,1,'after hook does not wait for or anticipate the fence');
    await f.close();const p=f.plan();assert.equal(p.revision,2);assert.equal(p.reportedAt,previous.reportedAt);
    assert.deepEqual(p.items.map(({assignmentBinding,assigneeSessionId,...i})=>i),previous.items);
    assert.deepEqual(p.links,[{sessionId:'C1',itemIds:['task-1']}]);
    const b=p.items[0]!.assignmentBinding!;assert.equal(currentBinding(b,p,'task-1'),true);assert.equal(b.callId,'call-1');assert.equal(b.boundRevision,2);
    assert.equal(f.declare(r).delegation.state,'bound');
    await f.close();await f.after();assert.equal(f.plan().revision,2);
    // Resume the same child adds a task without replacing its existing assignments.
    f.declare(f.request({oid:'second',assign:['task-2']}));await f.complete('C1','message-2');
    assert.deepEqual(f.plan().links,[{sessionId:'C1',itemIds:['task-1','task-2']}]);
    assert.equal(f.plan().items[0]!.assignmentBinding!.callId,'call-1');
  });
});

const failures=['dropped-pair','missing-start','missing-called','wrong-call','wrong-name','wrong-parent-fence','wrong-message-fence','after-only','no-result','bad-child','error','no-fence','step-failed-before','step-failed-after','continuation','late-census','census-fault','hook-fault'] as const;
for(const failure of failures)test(`fail-closed binding: ${failure}`,async()=>{
  await fixture(async f=>{
    f.declare();
    if(failure==='step-failed-before')await f.emit('step.failed');
    if(failure!=='missing-start'&&failure!=='late-census')await f.emit('tool.input.started',{id:'call-1',name:failure==='wrong-name'?'other':'subagent'});
    if(failure!=='missing-called'&&failure!=='late-census')await f.emit('tool.called',{id:failure==='wrong-call'?'call-wrong':'call-1'});
    if(failure!=='after-only')await f.before();
    if(failure==='dropped-pair')await f.native('call-2');
    if(failure==='error')await f.hooks.get('execute.after')({tool:'subagent',id:'call-1',sessionID:'A',messageID:'message-1',status:'error'});
    else if(failure==='no-result')await f.after('call-1','message-1',undefined,'failed');
    else if(failure!=='bad-child')await f.after();else await f.after('call-1','message-1','B');
    if(failure==='step-failed-after')await f.emit('step.failed');
    if(failure==='census-fault'){f.events.error=true;f.events.close();await f.binding.settled();}
    if(failure==='hook-fault')await f.before('');
    if(failure!=='no-fence'&&failure!=='census-fault')await f.close(failure==='wrong-message-fence'||failure==='continuation'?'message-other':'message-1',failure==='wrong-parent-fence'?'B':'A');
    if(failure==='late-census'){await f.native();await f.close();}
    assert.equal(f.plan().revision,1);assert.deepEqual(f.plan().links,[]);
  });
});

test('slim-shaped pre-ack resume refusal has no matching after and cannot bind or repair after its fence',async()=>{
  await fixture(async f=>{
    const request=f.request();f.declare(request);await f.native();
    await f.hooks.get('execute.before')({tool:'subagent',sessionID:'A',messageID:'message-1',id:'call-1',agent:'synthetic',input:{sessionID:'C1'}});
    await f.emit('tool.failed',{id:'call-1'});
    await f.close();assert.equal(f.declare(request).delegation.state,'retired');assert.equal(f.plan().revision,1);
    await f.after();await f.close();assert.deepEqual(f.plan().links,[]);
  });
});

for(const fastFirst of [true,false])test(`parallel candidate ambiguity, completion order fast-first=${fastFirst}`,async()=>{
  await fixture(async f=>{
    f.declare();await f.native();await f.before();
    if(fastFirst)await f.after();
    await f.native('call-2');await f.before('call-2');await f.after('call-2','message-1','C2');
    if(!fastFirst)await f.after();
    await f.close();assert.equal(f.plan().revision,1);
  });
});

test('pre-existing in-flight delegation, duplicate stages, and incomplete after at fence',async()=>{
  for(const oldCall of ['old','call-1'])await fixture(async f=>{
    await f.native(oldCall,'message-old');await f.before(oldCall,'message-old');f.declare();await f.complete();assert.equal(f.plan().revision,1,'a reused call ID in another message is still outstanding');
  });
  await fixture(async f=>{f.declare();await f.native();await f.native();await f.before();await f.before();await f.after();await f.after();await f.close();assert.equal(f.plan().revision,2);});
  await fixture(async f=>{f.declare();await f.native();await f.before();await f.close();await f.after();await f.close();assert.equal(f.plan().revision,1);});
});

for(const observations of ['hooks','native','both'])for(const boundary of ['ended','failed'])test(`unresolved ${observations} survive declaration TTL until step.${boundary}`,async()=>{
  await fixture(async f=>{
    if(observations!=='hooks')await f.native('old','message-old');
    if(observations!=='native')await f.before('old','message-old');
    f.advance(300_001);f.declare();await f.complete();
    assert.equal(f.plan().revision,1,'expiration cannot establish an empty in-flight census');
    await f.emit(`step.${boundary}`,{assistantMessageID:'message-old'});
    f.declare(f.request({oid:'after-terminal'}));await f.complete('C1','message-fresh');
    assert.equal(f.plan().revision,2,'a real terminal boundary permits a fresh declaration to bind');
  });
});

for(const status of ['completed','error'])test(`matching ${status} after resolves expired in-flight evidence, not expired authority`,async()=>{
  await fixture(async f=>{
    const old=f.request();f.declare(old);await f.native('old','message-old');await f.before('old','message-old');f.advance(300_001);
    // Terminal observation remains useful even after the declaration lifetime.
    if(status==='completed')await f.after('old','message-old');
    else await f.hooks.get('execute.after')({tool:'subagent',sessionID:'A',messageID:'message-old',id:'old',status:'error'});
    assert.equal(f.plan().revision,1);
    f.declare(f.request({oid:'fresh'}));await f.complete('C1','message-fresh');assert.equal(f.plan().revision,2);
  });
});

test('unresolved evidence remains bounded across TTL; overflow cannot manufacture empty parent coverage',async()=>{
  await fixture(async f=>{
    for(let n=0;n<256;n++)await f.native(`old-${n}`,'message-old');
    f.advance(300_001);f.declare();await f.native('new','message-new');
    await f.before('new','message-new');await f.after('new','message-new');await f.close('message-new');
    assert.equal(f.plan().revision,1);
    assert.throws(()=>f.declare(f.request({oid:'after-overflow'})),/binding/,'lost coverage is not repaired by eviction');
  });
});

for(const terminal of ['after','ended','failed','after-and-ended'])test(`capture-off retains ${terminal} evidence without assignment or re-enable poisoning`,async()=>{
  await fixture(async f=>{
    const request=f.request();f.declare(request);await f.native('old','message-old');await f.before('old','message-old');
    f.store.setEnabled(false);
    if(terminal==='after'||terminal==='after-and-ended')await f.after('old','message-old');
    if(terminal==='ended'||terminal==='after-and-ended')await f.close('message-old');
    if(terminal==='failed')await f.emit('step.failed',{assistantMessageID:'message-old'});
    assert.equal(f.plan().revision,1);assert.deepEqual(f.plan().links,[]);
    assert.throws(()=>f.declare(f.request({oid:'disabled'})),/disabled/);
    f.store.setEnabled(true);
    assert.equal(f.declare(request).delegation.state,'retired','re-enable cannot resurrect the old intent');
    f.advance(300_001);
    f.declare(f.request({oid:'fresh'}));await f.complete('C1','message-fresh');
    assert.equal(f.plan().revision,2,'a delegation completed while disabled cannot poison later binding');
  });
});

for(const observations of ['hooks','native'])test(`capture-off records new ${observations} without reserving; unresolved calls still block after re-enable`,async()=>{
  await fixture(async f=>{
    f.store.setEnabled(false);
    if(observations==='hooks')await f.before('old','message-old');
    else await f.native('old','message-old');
    assert.throws(()=>f.declare(),/disabled/);
    f.store.setEnabled(true);
    f.declare();await f.complete();assert.equal(f.plan().revision,1,'disabled observation is still evidence of outstanding execution');
    await f.close('message-old');
    f.declare(f.request({oid:'after-terminal'}));await f.complete('C1','message-fresh');assert.equal(f.plan().revision,2);
  });
});

for(const output of [undefined,{},'C1',{sessionId:'C1',status:'completed'},{sessionID:'C1',status:'cancelled'}])test('missing/malformed structured child identity never falls back to text or metadata',async()=>{
  await fixture(async f=>{
    f.declare();await f.native();await f.before();
    await f.hooks.get('execute.after')({tool:'subagent',sessionID:'A',messageID:'message-1',id:'call-1',status:'completed',result:{output,content:'Synthetic sessionID C1',metadata:{sessionID:'C1'}}});
    await f.close();assert.equal(f.plan().revision,1);
  });
});

test('binding observes only allowlisted identities, never called arguments or result text',async()=>{
  await fixture(async f=>{
    f.declare();await f.emit('tool.input.started',{id:'call-1',name:'subagent'});
    const called={id:'call-1'};Object.defineProperty(called,'input',{enumerable:true,get(){throw Error('Called input inspected');}});
    // Define the sentinel on the actual event data, not a spread that reads it in the fixture.
    await f.events.push({type:'session.tool.called',location:f.ctx.location,durable:{aggregateID:'A',seq:2},data:Object.assign(Object.create(called),{sessionID:'A',assistantMessageID:'message-1'})});
    await f.before();
    const result:any={output:{sessionID:'C1',status:'running'}};
    Object.defineProperty(result,'content',{get(){throw Error('Result content inspected');}});
    Object.defineProperty(result.output,'output',{get(){throw Error('Child output inspected');}});
    await f.hooks.get('execute.after')({tool:'subagent',sessionID:'A',messageID:'message-1',id:'call-1',status:'completed',result});
    await f.close();assert.equal(f.plan().revision,2);
  });
});

for(const fault of ['second-candidate','failed','disable','revision','expiry','dispose'])test(`deferred ancestry cannot cross ${fault}`,async()=>{
  await fixture(async f=>{
    const held=deferred<any>(),entered=deferred();
    f.lookup(async id=>{if(id==='C1'){entered.resolve();return held.promise;}return f.records.get(id);});
    f.declare();await f.native();await f.before();await f.after();
    const closing=f.close();await entered.promise;
    if(fault==='second-candidate')await f.native('call-2');
    if(fault==='failed')await f.emit('step.failed');
    if(fault==='disable'){f.store.setEnabled(false);f.store.setEnabled(true);}
    if(fault==='revision')f.store.apply({op:'revise',plan:'plan-alpha',oid:'intervening',rev:1,title:'Revised'},f.actor());
    if(fault==='expiry')f.advance(300_000);
    if(fault==='dispose')await f.restart();
    held.resolve(f.records.get('C1'));await closing;
    assert.equal(f.plan().links.length,0);
    if(fault==='failed'){await f.before();await f.after();await f.close();assert.equal(f.plan().links.length,0,'same-message retry cannot repair failed reservation');}
  });
});

for(const shape of ['missing','cycle','depth','foreign-directory','foreign-project','wrong-native-id','wrong-parent'])test(`ancestry must be complete and scoped: ${shape}`,async()=>{
  await fixture(async f=>{
    const c=f.records.get('C1');
    if(shape==='missing')f.records.delete('A');
    if(shape==='cycle')f.records.get('A').parentID='C1';
    if(shape==='depth'){let parent='A';for(let n=0;n<33;n++){const id=`ancestor-${n}`;f.records.set(id,{...c,id,parentID:n?'ancestor-'+(n-1):null});parent=id;}f.records.get('A').parentID=parent;}
    if(shape==='foreign-directory')f.records.get('A').location={directory:'/synthetic/beta'};
    if(shape==='foreign-project')f.records.get('A').projectID='beta';
    if(shape==='wrong-native-id')c.id='C2';
    if(shape==='wrong-parent')c.parentID='B';
    f.declare();await f.complete();assert.equal(f.plan().revision,1);
  });
});

test('Store additive binding uses existing revision/assignment/receipt guards and invalidates provenance on explicit edits',async()=>{
  await fixture(async f=>{
    const control=f.store.delegationControl();
    const request={op:'link',plan:'plan-alpha',oid:'binding-commit',rev:1,child:'C1',assign:['task-1']};
    const meta={generation:control.generation,messageId:'message-1',callId:'call-1',observedAt:'2026-01-01T00:00:00.000Z'};
    const receipt=f.store.apply(request,f.actor(),undefined,f.actor('C1'),meta);
    assert.deepEqual(f.store.apply(request,f.actor(),undefined,f.actor('C1'),meta),receipt);
    assert.throws(()=>f.store.apply({...request,assign:['task-2']},f.actor(),undefined,f.actor('C1'),meta),/operation-reused/);
    assert.throws(()=>f.store.apply({...request,oid:'race',child:'C2'},f.actor(),undefined,f.actor('C2'),meta),/conflict/);
    assert.throws(()=>f.store.apply({...request,rev:2,oid:'take',child:'C2'},f.actor(),undefined,f.actor('C2'),meta),/assignment/);
    assert.throws(()=>f.store.apply({op:'change',plan:'plan-alpha',rev:2,oid:'unlinked',changes:[{id:'task-1',status:'done'}]},f.actor('C2')),/assignment/);
    f.store.apply({op:'change',plan:'plan-alpha',rev:2,oid:'relay',attributed:'C1',changes:[{id:'task-1',status:'working'}]},f.actor(),undefined,f.actor('C1'));
    assert.equal(f.store.detail(f.source.id,'plan-alpha').contributions.data.at(-1)!.mode,'parent-relay');
    assert.ok(f.plan().items[0]!.assignmentBinding);
    f.store.apply({...request,rev:3,oid:'explicit',assign:['task-1']},f.actor(),undefined,f.actor('C1'));
    assert.equal(f.plan().items[0]!.assignmentBinding,undefined);
  });
});

test('older neutral writer and malformed metadata never recertify optional attribution; persisted assignment survives reopen',async()=>{
  await fixture(async f=>{
    f.declare();await f.complete();const p=f.plan();assert.ok(p.items[0]!.assignmentBinding);
    p.revision++;f.store.db.prepare('UPDATE plans SET revision=?,snapshot=?').run(p.revision,JSON.stringify(p));
    assert.equal(f.plan().items[0]!.assignmentBinding,undefined);
    f.store.apply({op:'revise',plan:p.id,oid:'neutral',rev:p.revision,title:'Neutral'},f.actor());
    assert.equal(f.plan().items[0]!.assignmentBinding,undefined);
    assert.equal(f.plan().items[0]!.assigneeSessionId,'C1');
    const q=f.plan();q.items[0]!.assignmentBinding={...p.items[0]!.assignmentBinding!,validAtRevision:q.revision,childSessionId:'C2'};
    f.store.db.prepare('UPDATE plans SET snapshot=?').run(JSON.stringify(q));
    assert.equal(f.store.detail(f.source.id,p.id).items.data[0]!.assignmentBinding,undefined);
  });
});

test('unmodified legacy v2 writer neutral and link edits invalidate current provenance without schema upgrade',async()=>{
  await fixture(async f=>{
    const root=path.join(path.dirname(f.store.file),'baseline'),baseline='4f582b7f3404088d01531598102833000c23cd87';
    const names=execFileSync('git',['ls-tree','-r','--name-only',baseline,'shared'],{encoding:'utf8'}).trim().split('\n');
    for(const name of names){const target=path.join(root,name);fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o700});fs.writeFileSync(target,execFileSync('git',['show',`${baseline}:${name}`]));}
    const module=await import(pathToFileURL(path.join(root,'shared/store.ts')).href);const legacy:Store=new module.Store(f.store.file);
    try {
      f.declare();await f.complete();
      legacy.apply({op:'revise',plan:'plan-alpha',oid:'old-neutral',rev:2,title:'Old neutral writer'},f.actor());
      assert.equal(f.plan().items[0]!.assignmentBinding,undefined);
      assert.equal(f.plan().items[0]!.assigneeSessionId,'C1');
      f.declare(f.request({oid:'new-attribution',assign:['task-2']}));await f.complete('C1','message-2');
      assert.ok(f.plan().items[1]!.assignmentBinding);
      legacy.apply({op:'link',plan:'plan-alpha',oid:'old-unlink',rev:4,child:'C1',assign:[]},f.actor(),undefined,f.actor('C1'));
      legacy.apply({op:'link',plan:'plan-alpha',oid:'old-reassign',rev:5,child:'C2',assign:['task-2']},f.actor(),undefined,f.actor('C2'));
      assert.equal(f.plan().items[1]!.assignmentBinding,undefined);assert.equal(f.plan().items[1]!.assigneeSessionId,'C2');
      assert.equal(legacy.db.prepare('PRAGMA user_version').get()!.user_version,2);
      legacy.setEnabled(false);legacy.setEnabled(true);assert.equal(f.store.delegationControl().generation,2);
    } finally {legacy.close();}
  });
});

test('ancestry deadline and disposal invalidate a provider ignoring abort without sleeps',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  await fixture(async f=>{
    const held=deferred<any>(),entered=deferred();
    f.lookup(async id=>{if(id==='C1'){entered.resolve();return held.promise;}return f.records.get(id);});
    f.declare();await f.native();await f.before();await f.after();const closing=f.close();await entered.promise;
    f.advance(1000);t.mock.timers.tick(1000);await closing;assert.equal(f.plan().revision,1);
    // A second declaration cannot create another outstanding ancestry lookup for this parent.
    f.declare(f.request({oid:'retry-other'}));await f.complete('C1','message-2');assert.equal(f.plan().revision,1);
    held.resolve(f.records.get('C1'));await f.binding.settled();assert.equal(f.plan().revision,1);
  });
});
