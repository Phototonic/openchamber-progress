import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './subagent-test-support.ts';
import { Store } from '../../shared/store.ts';
import { delegationRefusalText } from '../../plugin/activation.ts';
import { DELEGATION_VIEW_LIMITS } from '../../shared/delegation-view.ts';

const key={source:'source-alpha',parent:'A',message:'message-a',call:'call-a'};
for(const fault of ['target','missing-history','unconfirmed','closed','capture'] as const)
test(`refusal receipt is durable, exactly scoped and read-only: ${fault}`,async()=>fixture(async f=>{
  const declaration=f.request();f.declare(declaration);
  f.store.beforeRun(key,f.actor(),'subagent',{},1000);
  if(fault==='target'||fault==='missing-history'){
    f.store.apply({op:'change',plan:'plan-alpha',oid:'touch',rev:1,changes:[{id:fault==='target'?'task-1':'task-2',status:'working'}]},f.actor());
    if(fault==='missing-history')f.store.db.exec('DELETE FROM contributions WHERE revision=2');
  }
  if(fault==='closed')f.store.apply({op:'finish',plan:'plan-alpha',oid:'close',rev:1,outcome:'cancelled'},f.actor());
  if(fault==='capture'){f.store.setEnabled(false);f.store.setEnabled(true);}
  const before=f.plan();
  f.store.afterRun(key,0,fault==='unconfirmed'?undefined:f.actor('C1'),fault==='unconfirmed'?'unconfirmed':'returned');
  const expected=fault==='target'||fault==='missing-history'?'conflict':fault==='closed'?'closed':fault==='capture'?'capture-disabled':'dispatch-unconfirmed';
  const receipt=f.declare(declaration);
  assert.equal(receipt.delegation.state,'retired');assert.equal(receipt.delegation.reason,expected);
  assert.deepEqual(receipt.delegation.declaration,{oid:'declare',coordinatorSessionId:'A',declaredRevision:1,taskIds:['task-1'],dispatch:{tool:'subagent',messageId:'message-a',callId:'call-a'}});
  assert.deepEqual(f.plan(),before);
  const reader=new Store(f.store.file,{readOnly:true});reader.bindReads(f.source.id,true);
  try{
    const changes=reader.db.prepare('SELECT total_changes() AS n').get();
    const read=reader.delegationRefusals(f.source.id,'A');assert.equal(read.complete,true);assert.equal(read.refusals.length,1);assert.equal(read.refusals[0]!.reason,expected);
    assert.match(delegationRefusalText(read),/declaration "declare"/);
    assert.equal(reader.delegationRefusals(f.source.id,'B').refusals.length,0);
    assert.equal(reader.delegationRefusals('foreign-source','A').refusals.length,0);
    assert.deepEqual(reader.db.prepare('SELECT total_changes() AS n').get(),changes);
  }finally{reader.close();}
  await f.reload();assert.equal(f.store.delegationRefusals(f.source.id,'A').refusals.length,1);
}));

test('cancel/redeclare supersedes the old refusal without rearming its replay',async()=>fixture(async f=>{
  const first=f.request();f.declare(first);f.store.beforeRun(key,f.actor(),'subagent',{},1000);f.store.afterRun(key,0,undefined,'unconfirmed');
  const refused=f.declare(first);
  f.declare(f.request({oid:'new'}));assert.deepEqual(f.declare(first),refused);
  assert.equal(f.store.delegationRefusals(f.source.id,'A').refusals.length,0);
  f.declare(f.request({oid:'cancel',assign:[]}));
  assert.equal(f.store.delegationRefusals(f.source.id,'A').refusals.length,0);
}));

for(const mode of ['link','binding'] as const)
test(`current ${mode} recovery suppresses only fully assigned refusals without changing receipts`,async()=>fixture(async f=>{
  const request=f.request({assign:['task-1','task-2']});f.declare(request);
  f.store.beforeRun(key,f.actor(),'subagent',{},1000);f.store.afterRun(key,0,undefined,'unconfirmed');
  const refused=f.declare(request);
  const link=(oid:string,assign:string[])=>f.store.apply({op:'link',plan:'plan-alpha',oid,rev:f.plan().revision,child:'C1',assign},f.actor(),undefined,f.actor('C1'),
    mode==='binding'?{generation:0,messageId:key.message,callId:key.call,observedAt:new Date(1000).toISOString()}:undefined);
  link('partial',['task-1']);
  assert.equal(f.store.delegationRefusals(f.source.id,'A').refusals.length,1);
  link('recovered',['task-1','task-2']);
  const reader=new Store(f.store.file,{readOnly:true});reader.bindReads(f.source.id,true);
  try{
    const changes=reader.db.prepare('SELECT total_changes() AS n').get();
    assert.deepEqual(reader.delegationRefusals(f.source.id,'A'),{sourceId:f.source.id,sessionId:'A',complete:true,refusals:[]});
    assert.deepEqual(reader.db.prepare('SELECT total_changes() AS n').get(),changes);
  }finally{reader.close();}
  assert.deepEqual(f.declare(request),refused,'recovery does not rewrite or rearm the declaration');
  await f.reload();assert.equal(f.store.delegationRefusals(f.source.id,'A').refusals.length,0);
  f.store.apply({op:'link',plan:'plan-alpha',oid:'unlink',rev:f.plan().revision,child:'C1',assign:[]},f.actor(),undefined,f.actor('C1'));
  assert.equal(f.store.delegationRefusals(f.source.id,'A').refusals.length,1,'suppression follows current assignments only');
}));

test('legacy, malformed and bounded receipt evidence never fabricates a refusal or leaks text',async()=>fixture(async f=>{
  const r=f.request();f.declare(r);f.store.beforeRun(key,f.actor(),'subagent',{},1000);f.store.afterRun(key,0,undefined,'unconfirmed');
  f.store.db.exec("UPDATE receipts SET receipt=json_remove(receipt,'$.delegation.declaration') WHERE oid='declare'");
  assert.deepEqual(f.store.delegationRefusals(f.source.id,'A'),{sourceId:f.source.id,sessionId:'A',complete:false,refusals:[]});
  assert.equal(delegationRefusalText(f.store.delegationRefusals(f.source.id,'A')),'Additional refusal evidence may be unavailable or omitted.');
  for(let n=0;n<=DELEGATION_VIEW_LIMITS.receipts;n++)f.store.apply({op:'change',plan:'plan-alpha',oid:`noise-${n}`,rev:n+1,changes:[{id:'task-2',status:'working'}]},f.actor());
  const bounded=f.store.delegationRefusals(f.source.id,'A');assert.equal(bounded.complete,false);assert.deepEqual(bounded.refusals,[]);
  assert.equal(delegationRefusalText(bounded),'Additional refusal evidence may be unavailable or omitted.');
  assert.equal(delegationRefusalText({...bounded,complete:true}),'');
}));

for(const fault of ['mismatched-link','oversized','malformed'] as const)
test(`unverifiable current assignment does not hide a refusal: ${fault}`,async()=>fixture(async f=>{
  f.declare();f.store.beforeRun(key,f.actor(),'subagent',{},1000);f.store.afterRun(key,0,undefined,'unconfirmed');
  f.store.apply({op:'link',plan:'plan-alpha',oid:'recovery',rev:1,child:'C1',assign:['task-1']},f.actor(),undefined,f.actor('C1'));
  // Labelled fault injection: damage read evidence, never an alternate writer.
  if(fault==='mismatched-link')f.store.db.exec("UPDATE plans SET snapshot=json_set(snapshot,'$.links',json('[]'))");
  if(fault==='oversized')f.store.db.prepare("UPDATE plans SET snapshot=json_set(snapshot,'$.padding',?)").run('x'.repeat(DELEGATION_VIEW_LIMITS.inputBytes));
  if(fault==='malformed')f.store.db.exec("UPDATE plans SET snapshot=json_set(snapshot,'$.items',json('null'))");
  const selection=f.store.delegationRefusals(f.source.id,'A');
  assert.equal(selection.refusals.length,1);
  if(fault!=='mismatched-link')assert.equal(selection.complete,false);
}));

test('malformed newer declaration cannot resurrect an older refusal',async()=>fixture(async f=>{
  f.declare();f.store.beforeRun(key,f.actor(),'subagent',{},1000);f.store.afterRun(key,0,undefined,'unconfirmed');
  f.declare(f.request({oid:'new'}));
  f.store.db.exec("UPDATE receipts SET receipt=json_remove(receipt,'$.delegation.declaration') WHERE oid='new'");
  const read=f.store.delegationRefusals(f.source.id,'A');assert.equal(read.complete,false);assert.deepEqual(read.refusals,[]);
}));

test('refusal context is bounded with explicit task and evidence omissions',()=>{
  const selection={sourceId:'source-alpha',sessionId:'A',complete:false,refusals:Array.from({length:4},(_,n)=>({plan:`plan-${n}`,reason:'untrusted prose must not render',recovery:'redeclare-or-link' as const,declaration:{oid:`declaration-${n}`,coordinatorSessionId:'A',declaredRevision:1,taskIds:Array.from({length:50},(_,i)=>`task-${i}-${'x'.repeat(70)}`),dispatch:null}}))};
  const text=delegationRefusalText(selection);assert.ok(Buffer.byteLength(text)<=4096);assert.match(text,/additional task IDs omitted/);assert.match(text,/Additional refusal evidence/);assert.doesNotMatch(text,/untrusted prose/);
});
