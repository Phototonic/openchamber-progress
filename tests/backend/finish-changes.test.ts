import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { productionFixture } from '../fixtures/production.ts';
import { Store } from '../../shared/store.ts';
import { parseRequest } from '../../shared/progress.ts';

const items = [{id:'g',title:'Group',kind:'group'}, ...['a','b'].map(id=>({id,title:id,kind:'task'}))];
const changes = [{id:'a',status:'done'},{id:'b',status:'done'}];
const finish = {op:'finish',plan:'final',oid:'finish',rev:1,outcome:'finished',changes};
function start(f:ReturnType<typeof productionFixture>) {
  f.store.apply({op:'start',plan:'final',oid:'start',rev:0,title:'Final tasks',items},f.actor);
}
function evidence(f:ReturnType<typeof productionFixture>) {
  return {plan:f.store.get(f.source.id,'final'),tables:Object.fromEntries(['plans','revisions','receipts','contributions','captures','sessions'].map(table=>[table,f.store.db.prepare(`SELECT * FROM ${table}`).all()]))};
}

test('atomic finish records direct task contribution and one nonstructural revision; full-input replay survives reopen',()=>{
  const f=productionFixture();try{
    start(f);const receipt=f.store.apply(finish,f.actor);
    assert.deepEqual(receipt,{plan:'final',rev:2,structuralRev:1,changed:['a','b']});
    const p=f.store.detail(f.source.id,'final');
    assert.equal(p.plan.lifecycle,'finished');assert.equal(p.plan.counts.remaining,0);
    assert.ok(p.items.data.filter(i=>i.kind==='task').every(i=>i.status==='done'&&i.reporterSessionId===f.actor.sessionId));
    assert.equal(p.items.data[0].status,'pending','group unchanged');
    const contribution=p.contributions.data.at(-1)!;
    assert.deepEqual(contribution.itemIds,['a','b']);assert.equal(contribution.mode,'direct');
    assert.equal(contribution.reporterSessionId,f.actor.sessionId);assert.equal(contribution.attributedSessionId,f.actor.sessionId);
    const after=evidence(f);assert.deepEqual(f.store.apply(structuredClone(finish),f.actor),receipt);assert.deepEqual(evidence(f),after);
    for(const altered of [{...finish,changes:undefined},{...finish,changes:[{id:'a',status:'skipped'},changes[1]]},{...finish,outcome:'cancelled'},{...finish,rev:2},{...finish,changes:[...changes].reverse()}]) {
      assert.throws(()=>f.store.apply(altered,f.actor),{code:'operation-reused'});assert.deepEqual(evidence(f),after);
    }
    assert.throws(()=>f.store.apply(finish,f.child),{code:'operation-reused'});
    f.store.apply({op:'revise',plan:'final',oid:'reopen',rev:2,title:'Continue',reopen:true},f.actor);
    const reopened=evidence(f);assert.deepEqual(f.store.apply(finish,f.actor),receipt);assert.deepEqual(evidence(f),reopened);
  }finally{f.cleanup();}
});

for(const outcome of ['cancelled','failed'])test(`${outcome} retains explicit unfinished statuses and historical blocker rules`,()=>{
  const f=productionFixture();try{
    start(f);
    f.store.apply({op:'change',plan:'final',oid:'block',rev:1,changes:[{id:'a',status:'blocked',blocker:{reason:'Choose a format',nextAction:'Select one'}}]},f.actor);
    f.store.apply({...finish,rev:2,outcome,changes:[{id:'b',status:'working'}]},f.actor);
    const p=f.store.get(f.source.id,'final')!;assert.equal(p.lifecycle,outcome);
    assert.deepEqual(p.items.slice(1).map(i=>i.status),['blocked','working']);assert.equal(p.items[1].blocker,undefined);
    const historical=JSON.parse(String(f.store.db.prepare('SELECT snapshot FROM revisions WHERE source=? AND plan=? AND revision=2').get(f.source.id,'final')!.snapshot));
    assert.equal(historical.items[1].blocker.reason,'Choose a format');
  }finally{f.cleanup();}
});

test('all refusal paths leave plan, receipts, contributions and captures unchanged',()=>{
  const f=productionFixture();try{
    start(f);const before=evidence(f);
    const attempts:[object,string][]=[
      [{changes:[changes[0]]},'unfinished'],
      [{changes:changes.map(c=>({...c,status:'skipped'}))},'unfinished'],
      [{changes:[changes[0],{id:'g',status:'done'}]},'invalid'],
      [{changes:[changes[0],{id:'missing',status:'done'}]},'invalid'],
      [{changes:[changes[0],changes[0]]},'invalid'],
      [{changes:[{id:'a',status:'done',blocker:{reason:'Wrong status'}}]},'invalid'],
      [{attributed:f.child.sessionId},'invalid'],[{rev:0},'conflict'],
    ];
    for(const [override,code] of attempts){
      assert.throws(()=>f.store.apply({...finish,...override},f.actor),(e:any)=>e.code===code&&(code!=='conflict'||e.revision===1));
      assert.deepEqual(evidence(f),before);
    }
    f.store.apply({op:'link',plan:'final',oid:'link',rev:1,child:f.child.sessionId,assign:['a','b']},f.actor,undefined,f.child);
    const linked=evidence(f);assert.throws(()=>f.store.apply({...finish,rev:2},f.child),{code:'assignment'});assert.deepEqual(evidence(f),linked);
    f.store.setEnabled(false);assert.throws(()=>f.store.apply({...finish,rev:2},f.actor),{code:'disabled'});assert.deepEqual(evidence(f),linked);
  }finally{f.cleanup();}
});

test('failed receipt insertion rolls back the task changes, lifecycle and contribution',()=>{
  const f=productionFixture();try{
    start(f);const before=evidence(f);
    f.store.db.exec("CREATE TEMP TRIGGER reject_finish BEFORE INSERT ON receipts WHEN NEW.oid='finish' BEGIN SELECT RAISE(ABORT,'synthetic failure'); END");
    assert.throws(()=>f.store.apply(finish,f.actor));assert.deepEqual(evidence(f),before);
    f.store.db.exec('DROP TRIGGER reject_finish');assert.equal(f.store.apply(finish,f.actor).rev,2);
  }finally{f.cleanup();}
});

for(const winner of ['finish','change'])test(`independent connections serialize ${winner} first with visible conflict`,()=>{
  const f=productionFixture();let other:Store|undefined;try{
    start(f);other=new Store(f.store.file);
    const change={op:'change',plan:'final',oid:'other-change',rev:1,changes:[{id:'a',status:'working'}]};
    if(winner==='finish'){
      f.store.apply(finish,f.actor);const before=evidence(f);
      assert.throws(()=>other!.apply(change,f.actor),(e:any)=>e.code==='conflict'&&e.revision===2);assert.deepEqual(evidence(f),before);
      assert.throws(()=>other!.apply({...change,rev:2},f.actor),{code:'closed'});
    }else{
      other.apply(change,f.actor);const before=evidence(f);
      assert.throws(()=>f.store.apply(finish,f.actor),(e:any)=>e.code==='conflict'&&e.revision===2);assert.deepEqual(evidence(f),before);
      assert.equal(f.store.apply({...finish,oid:'fresh-finish',rev:2},f.actor).rev,3);
    }
  }finally{other?.close();f.cleanup();}
});

test('finish parser shares change limits and optional omission, without accepting relay fields',()=>{
  assert.deepEqual(parseRequest(finish),finish);
  const {changes:_,...ordinary}=finish;assert.deepEqual(parseRequest(ordinary),ordinary);
  const fifty=Array.from({length:50},(_,i)=>({id:`task-${i}`,status:'done'}));
  assert.equal(parseRequest({...finish,changes:fifty}).changes!.length,50);
  for(const changes of [[],[...fifty,{id:'extra',status:'done'}],[{id:'a',status:'done',title:'rename'}],[{id:'a',status:'blocked',blocker:{reason:'x'.repeat(513)}}],[{id:'a',status:'blocked',blocker:{reason:'\0'}}]]){
    assert.throws(()=>parseRequest({...finish,changes}),{code:'invalid'});
  }
  assert.throws(()=>parseRequest({...finish,attributed:'child'}),{code:'invalid'});
});

test('unmodified released parser refuses combined input; released Store remains an ordinary writer',async()=>{
  const f=productionFixture();try{
    const base='refs/tags/v1.3.0',root=path.join(f.root,'released');
    const names=execFileSync('git',['ls-tree','-r','--name-only',base,'shared'],{encoding:'utf8',timeout:15000}).trim().split('\n');
    for(const name of names){const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});fs.writeFileSync(file,execFileSync('git',['show',`${base}:${name}`],{timeout:15000}));}
    const old=await import(pathToFileURL(path.join(root,'shared/progress.ts')).href);
    assert.throws(()=>old.parseRequest(finish),{code:'invalid'});
    start(f);const {Store:OldStore}=await import(pathToFileURL(path.join(root,'shared/store.ts')).href);const writer=new OldStore(f.store.file);
    try{
      const before=evidence(f);assert.throws(()=>writer.apply(finish,f.actor),{code:'invalid'});assert.deepEqual(evidence(f),before);
      writer.apply({op:'change',plan:'final',oid:'legacy-change',rev:1,changes:[changes[0]]},f.actor);
      f.store.apply({...finish,rev:2,changes:[changes[1]]},f.actor);
      assert.equal(writer.get(f.source.id,'final').lifecycle,'finished');
      writer.apply({op:'revise',plan:'final',oid:'legacy-reopen',rev:3,title:'Continue',reopen:true},f.actor);
      writer.apply({op:'finish',plan:'final',oid:'legacy-finish',rev:4,outcome:'finished'},f.actor);
      assert.equal(f.store.get(f.source.id,'final')!.revision,5);
    }finally{writer.close();}
  }finally{f.cleanup();}
});
