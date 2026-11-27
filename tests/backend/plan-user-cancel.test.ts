import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { Store } from '../../shared/store.ts';
import { cleanupFixture } from '../fixtures/cleanup.ts';

function fixture() {
  const f = cleanupFixture();
  f.store.bindReads(f.source.id,true);
  const plan = 'P-active';
  const source = f.source.id;
  const request = (rev: number, oid = 'user-cancel') =>
    ({...f.body(plan,0,oid,rev),binding:{sourceId:source,verified:true},confirmed:true as const});
  const facts = () => Object.fromEntries(['plans','revisions','receipts','contributions','captures','sessions','chunks']
    .map(table=>[table,f.store.db.prepare(`SELECT * FROM ${table}`).all()]));
  return {...f,plan,request,facts};
}

test('cancel retains all task statuses, link, document, and history; replay never closes a reopened plan',()=>{
  const f=fixture(), {store,plan}=f, source=f.source.id;
  try {
    const items=[
      {id:'A',title:'A',kind:'task',status:'working'},
      {id:'B',title:'B',kind:'task',status:'done'},
      {id:'C',title:'C',kind:'task',status:'blocked',blocker:{reason:'Choose a format'}},
      {id:'D',title:'D',kind:'task',status:'pending'},
      {id:'E',title:'E',kind:'task',status:'skipped'},
    ];
    store.apply({op:'revise',plan,oid:'more-items',rev:1,items},f.actor,f.capture());
    store.apply({op:'link',plan,oid:'link',rev:2,child:f.child.sessionId,assign:['D']},f.actor,f.capture(),f.child);
    const original=store.get(source,plan)!, originalFacts=f.facts();
    const history=store.history(source,plan).data;
    const request=f.request(3);
    const receipt=store.cancelPlan(request);
    assert.deepEqual(receipt,{storeId:request.storeId,sourceBinding:request.binding,source,plan,oid:request.oid,
      rev:4,structuralRev:2,lifecycle:'cancelled',actor:'user',reportedAt:receipt.reportedAt});
    assert.equal(new Date(receipt.reportedAt).toISOString(),receipt.reportedAt);
    const expected=structuredClone(original);
    expected.revision++;expected.lifecycle='cancelled';expected.reportedAt=receipt.reportedAt;
    delete expected.items.find(i=>i.id==='C')!.blocker;
    assert.deepEqual(store.get(source,plan),expected);
    const cancelled=f.facts();
    for(const table of ['captures','contributions','sessions','chunks'])assert.deepEqual(cancelled[table],originalFacts[table],table);
    const audit=store.db.prepare('SELECT actor FROM revisions WHERE source=? AND plan=? AND revision=4').get(source,plan)!;
    assert.deepEqual(JSON.parse(String(audit.actor)),{kind:'user',action:'cancel'});
    assert.deepEqual(store.history(source,plan).data,[...history,
      {revision:4,structuralRevision:2,lifecycle:'cancelled',reportedAt:receipt.reportedAt,actor:'user'}]);
    assert.deepEqual(cancelled.revisions!.slice(0,-1),originalFacts.revisions);
    assert.deepEqual(cancelled.receipts!.slice(0,-1),originalFacts.receipts);
    assert.deepEqual(store.cancelPlan(structuredClone(request)),receipt);
    assert.throws(()=>store.cancelPlan({...request,rev:4}),{code:'operation-reused'});
    assert.throws(()=>store.cancelPlan({...request,oid:'link'}),{code:'operation-reused'});
    const late={op:'change',plan,oid:'late',rev:3,changes:[{id:'A',status:'done'}]};
    assert.throws(()=>store.apply(late,f.actor),{code:'conflict'});
    assert.throws(()=>store.apply({...late,rev:4},f.actor),{code:'closed'});
    assert.throws(()=>store.apply({...late,oid:request.oid,rev:4},f.actor),{code:'operation-reused'});
    assert.deepEqual(f.facts(),cancelled);

    store.apply({op:'revise',plan,oid:'reopen-title',rev:4,title:'Continue',reopen:true},f.actor,f.capture());
    assert.equal(store.get(source,plan)!.lifecycle,'active');
    assert.deepEqual(store.get(source,plan)!.items,expected.items);
    const reopened=f.facts();
    assert.deepEqual(store.cancelPlan(request),receipt);
    assert.deepEqual(f.facts(),reopened);
    assert.equal(store.history(source,plan).data[3]!.actor,'user');
  } finally {f.cleanup();}
});

test('stale commit refuses; explicit staging does not reopen, but coordinator commit at the closed revision does',()=>{
  const f=fixture(),{store,plan}=f,source=f.source.id;
  try {
    const items=[{id:'A',title:'Example A',kind:'task'},{id:'B',title:'Example B',kind:'task'}];
    store.apply({op:'stage',plan,oid:'stage-old',rev:1,upload:'old',chunk:0,items},f.actor);
    store.cancelPlan(f.request(1));
    const commit={op:'commit',plan,oid:'continue',rev:2,title:'Continue',upload:'old',chunks:1,reopen:true};
    assert.throws(()=>store.apply({...commit,rev:1},f.actor,f.capture()),{code:'conflict'});
    assert.throws(()=>store.apply(commit,f.actor,f.capture()),{code:'stage-incomplete'});
    store.apply({op:'stage',plan,oid:'stage-reopen',rev:2,upload:'fresh',chunk:0,items,reopen:true},f.actor);
    assert.equal(store.get(source,plan)!.lifecycle,'cancelled');
    store.apply({...commit,upload:'fresh'},f.actor,f.capture());
    const active=store.get(source,plan)!;
    assert.equal(active.lifecycle,'active');
    assert.deepEqual(active.items.map(i=>i.status),['working','done']);
  } finally {f.cleanup();}
});

for(const beforeResult of ['closed','reopened'])test(`a reserved dispatch cannot bind across cancellation (${beforeResult})`,()=>{
  const f=fixture(),{store,plan}=f,source=f.source.id;
  try {
    store.installSubagentRuns();store.installDelegationControl();
    store.declareDelegation({op:'delegate',plan,rev:1,oid:'declare',assign:['A']},f.actor);
    const key={source,parent:f.actor.sessionId,message:'message',call:'call'};
    store.beforeRun(key,f.actor,'subagent',{},1000);
    store.cancelPlan(f.request(1));
    if(beforeResult==='reopened')store.apply({op:'revise',plan,oid:'reopen',rev:2,title:'Continue',reopen:true},f.actor,f.capture());
    const before=store.get(source,plan);
    store.afterRun(key,store.delegationControl().generation,{...f.child,directory:f.actor.directory},'returned');
    assert.deepEqual(store.get(source,plan),before);
    const row=store.db.prepare("SELECT receipt FROM receipts WHERE oid='declare'").get()!;
    assert.equal(JSON.parse(String(row.receipt)).delegation.state,'retired');
  } finally {f.cleanup();}
});

test('receipt insertion fault rolls back snapshot and audit atomically',()=>{
  const f=fixture();
  try {
    const before=f.facts();
    f.store.db.exec("CREATE TEMP TRIGGER refuse_cancel BEFORE INSERT ON receipts WHEN NEW.oid='user-cancel' BEGIN SELECT RAISE(ABORT,'fixture fault'); END");
    assert.throws(()=>f.store.cancelPlan(f.request(1)),{code:'storage'});
    assert.deepEqual(f.facts(),before);
    f.store.db.exec('DROP TRIGGER refuse_cancel');
    assert.equal(f.store.cancelPlan(f.request(1)).rev,2);
  } finally {f.cleanup();}
});

test('released Store reads cancelled detail pages and explicitly reopens without changing the user history',async t=>{
  const base='refs/tags/v1.3.0';
  if(spawnSync('git',['rev-parse','--verify',base],{timeout:15000}).status!==0){
    t.skip('requires local v1.3.0 release tag');return;
  }
  const f=fixture();
  try {
    const {store,plan}=f,source=f.source.id,root=path.join(f.root,'released');
    const names=execFileSync('git',['ls-tree','-r','--name-only',base,'shared'],{encoding:'utf8',timeout:15000}).trim().split('\n');
    for(const name of names){
      const file=path.join(root,name);mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
      writeFileSync(file,execFileSync('git',['show',`${base}:${name}`],{timeout:15000}));
    }
    const {Store:OldStore}:{Store:typeof Store}=await import(pathToFileURL(path.join(root,'shared/store.ts')).href);
    const items=Array.from({length:35},(_,i)=>({id:`task-${i}`,title:`Task ${i}`,kind:'task',status:i===0?'working':'pending'}));
    store.apply({op:'revise',plan,oid:'many-items',rev:1,items},f.actor,f.capture());
    const request=f.request(2),receipt=store.cancelPlan(request);
    using old=disposable(new OldStore(store.file));
    const first=old.store.detail(source,plan);
    assert.equal(first.plan.lifecycle,'cancelled');
    assert.equal(first.plan.sessionId,f.actor.sessionId);
    assert.equal(first.contributions.data.length,2);
    assert.ok(first.items.nextCursor);
    const rest=old.store.detail(source,plan,Number(first.items.nextCursor));
    assert.deepEqual([...first.items.data,...rest.items.data].map(i=>i.id),items.map(i=>i.id));
    const change={op:'change',plan,oid:'legacy-change',rev:3,changes:[{id:'task-0',status:'done'}]};
    assert.throws(()=>old.store.apply(change,f.actor,f.capture()),{code:'closed'});
    old.store.apply({op:'revise',plan,oid:'legacy-reopen',rev:3,title:'Continue',reopen:true},f.actor,f.capture());
    assert.equal(store.get(source,plan)!.lifecycle,'active');
    assert.equal(store.history(source,plan).data[2]!.actor,'user');
    assert.deepEqual(store.cancelPlan(request),receipt);
  } finally {f.cleanup();}
});

function disposable(store:Store){return {store,[Symbol.dispose]:()=>store.close()};}
