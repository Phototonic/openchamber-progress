import {test} from 'node:test';
import assert from 'node:assert/strict';
import {writeFileSync,readFileSync,symlinkSync,unlinkSync,mkdirSync} from 'node:fs';
import {productionFixture,P1} from '../fixtures/production.ts';
import {parseRequest,LIMITS} from '../../shared/progress.ts';
import {captureDocument} from '../../plugin/document.ts';
import type {ItemInput,Receipt} from '../../shared/progress.ts';

function historicalPlan(f:ReturnType<typeof productionFixture>,plan:string,revision:number):NonNullable<ReturnType<typeof f.store.get>> {
  return JSON.parse(String(f.store.db.prepare('SELECT snapshot FROM revisions WHERE source=? AND plan=? AND revision=?').get(f.actor.sourceId,plan,revision)!.snapshot));
}

// Both publication paths use the current committed snapshot for retention.
function replaceItems(f:ReturnType<typeof productionFixture>,plan:string,mode:'revise'|'commit',items:ItemInput[],oid:string) {
  const {store:s,actor:a}=f;const before=s.get(a.sourceId,plan)!;
  const history=s.history(a.sourceId,plan).data;
  let receipt:Receipt;
  if(mode==='revise')receipt=s.apply({op:'revise',plan,oid,rev:before.revision,items},a);
  else {
    const staged=s.apply({op:'stage',plan,oid:`${oid}-stage`,rev:before.revision,upload:oid,chunk:0,items},a);
    assert.equal(staged.rev,before.revision);assert.equal(staged.structuralRev,before.structuralRevision);
    assert.deepEqual(s.get(a.sourceId,plan)!.items,before.items);
    assert.deepEqual(s.get(a.sourceId,plan)!.links,before.links);
    assert.deepEqual(s.history(a.sourceId,plan).data,history);
    receipt=s.apply({op:'commit',plan,oid,rev:before.revision,upload:oid,chunks:1},a);
  }
  const after=s.get(a.sourceId,plan)!;
  assert.equal(receipt.rev,before.revision+1);assert.equal(receipt.structuralRev,before.structuralRevision+1);
  assert.equal(after.revision,receipt.rev);assert.equal(after.structuralRevision,receipt.structuralRev);
  assert.equal(s.history(a.sourceId,plan).data.length,history.length+1);
  return after;
}

for(const mode of ['revise','commit'] as const){
  test(`item identity: ${mode} retains by ID across rename, reorder and reparent, not by kind`,()=>{
    const f=productionFixture();try{
      const {store:s,actor:a,child:c}=f;const plan='retained';
      s.apply({op:'start',plan,oid:'start',rev:0,title:'Identity',items:[
        {id:'group-a',title:'First',kind:'group'},{id:'group-b',title:'Second',kind:'group'},
        {id:'task-a',title:'Original',kind:'task',parentId:'group-a',dependencies:['task-b']},
        {id:'task-b',title:'Other',kind:'task',status:'pending'}]},a);
      s.apply({op:'link',plan,oid:'link',rev:1,child:c.sessionId,assign:['task-a']},a,undefined,c);
      s.apply({op:'change',plan,oid:'child-done',rev:2,changes:[{id:'task-a',status:'done'}]},c);
      const replacement:ItemInput[]=[{id:'task-b',title:'Other',kind:'task',status:'working'},
        {id:'group-b',title:'Second',kind:'group'},
        {id:'task-a',title:'Renamed',kind:'task',parentId:'group-b'},
        {id:'group-a',title:'First',kind:'group'}];
      const retained=replaceItems(f,plan,mode,replacement,'replace');
      assert.deepEqual(retained.items.map(i=>i.id),replacement.map(i=>i.id));
      const task=retained.items.find(i=>i.id==='task-a')!;
      assert.equal(task.title,'Renamed');assert.equal(task.parentId,'group-b');assert.equal(task.dependencies,undefined);
      assert.equal(task.status,'done');assert.equal(task.assigneeSessionId,c.sessionId);assert.equal(task.reporterSessionId,c.sessionId);
      assert.equal(retained.items.find(i=>i.id==='task-b')!.status,'working');
      const explicit=replaceItems(f,plan,mode,replacement.map(i=>i.id==='task-a'?{...i,status:'working'}:i),'explicit');
      assert.equal(explicit.items.find(i=>i.id==='task-a')!.status,'working');
      assert.equal(explicit.items.find(i=>i.id==='task-a')!.reporterSessionId,a.sessionId);
      const converted=replaceItems(f,plan,mode,[{id:'task-a',title:'Now a group',kind:'group'}],'convert');
      assert.equal(converted.items[0].kind,'group');assert.equal(converted.items[0].status,'working');
      assert.equal(converted.items[0].parentId,undefined);assert.equal(converted.items[0].assigneeSessionId,undefined);
      assert.deepEqual(converted.links,[]);
    }finally{f.cleanup();}
  });

  test(`item identity: ${mode} removal and reuse do not resurrect historical state`,()=>{
    const f=productionFixture();try{
      const {store:s,actor:a,child:c}=f;const plan='reused';
      s.apply({op:'start',plan,oid:'start',rev:0,title:'Identity',items:[
        {id:'task-a',title:'Original',kind:'task',status:'done'},{id:'task-b',title:'Survivor',kind:'task'}]},a);
      s.apply({op:'link',plan,oid:'link',rev:1,child:c.sessionId,assign:['task-a']},a,undefined,c);
      const original=historicalPlan(f,plan,2);
      const removed=replaceItems(f,plan,mode,[{id:'task-b',title:'Survivor',kind:'task'}],'remove');
      assert.deepEqual(removed.items.map(i=>i.id),['task-b']);assert.equal(removed.items[0].status,'pending');assert.deepEqual(removed.links,[]);
      const history=s.history(a.sourceId,plan).data;
      assert.throws(()=>s.apply({op:'change',plan,oid:'absent',rev:removed.revision,changes:[{id:'task-a',status:'done'}]},a),{code:'invalid'});
      assert.deepEqual(s.get(a.sourceId,plan),removed);assert.deepEqual(s.history(a.sourceId,plan).data,history);
      const reused=replaceItems(f,plan,mode,[{id:'task-b',title:'Survivor',kind:'task'},
        {id:'task-a',title:'New work',kind:'task'}],'reuse');
      const task=reused.items.find(i=>i.id==='task-a')!;
      assert.equal(task.title,'New work');assert.equal(task.status,'pending');assert.equal(task.reporterSessionId,a.sessionId);
      assert.equal(task.assigneeSessionId,undefined);assert.deepEqual(reused.links,[]);
      const old=historicalPlan(f,plan,2).items.find(i=>i.id==='task-a')!;
      assert.equal(old.title,'Original');assert.equal(old.status,'done');assert.equal(old.assigneeSessionId,c.sessionId);
      assert.deepEqual(historicalPlan(f,plan,2),original);
      assert.deepEqual(historicalPlan(f,plan,removed.revision).items.map(i=>i.id),['task-b']);
    }finally{f.cleanup();}
  });
}

test('revision counters follow operations through replay, rejection, finish and explicit reopen',()=>{
  const f=productionFixture();try{
    const {store:s,actor:a,child:c}=f;const plan='counters';
    const task={id:'task-a',title:'Work',kind:'task'};
    const check=(rev:number,structuralRev:number,lifecycle='active',receipt?:Receipt)=>{
      const p=s.get(a.sourceId,plan)!;
      assert.equal(p.revision,rev);assert.equal(p.structuralRevision,structuralRev);assert.equal(p.lifecycle,lifecycle);
      assert.deepEqual(p.items.map(i=>[i.id,i.status]),[['task-a','done']]);
      const history=s.history(a.sourceId,plan).data;
      assert.equal(history.length,rev);
      assert.deepEqual(history.map(p=>p.revision),Array.from({length:rev},(_,i)=>i+1));
      assert.equal(history.at(-1)!.structuralRevision,structuralRev);assert.equal(history.at(-1)!.lifecycle,lifecycle);
      if(receipt){assert.equal(receipt.rev,rev);assert.equal(receipt.structuralRev,structuralRev);}
    };
    const apply=(request:Record<string,unknown>,rev:number,structuralRev:number,lifecycle='active')=>{
      const receipt=s.apply({plan,...request},a,undefined,request.op==='link'?c:undefined);
      check(rev,structuralRev,lifecycle,receipt);return receipt;
    };
    const reject=(request:Record<string,unknown>,code:string,rev:number,structuralRev:number,lifecycle='active')=>{
      const before=s.get(a.sourceId,plan);const history=s.history(a.sourceId,plan).data;
      assert.throws(()=>s.apply({plan,...request},a),{code});
      check(rev,structuralRev,lifecycle);assert.deepEqual(s.get(a.sourceId,plan),before);assert.deepEqual(s.history(a.sourceId,plan).data,history);
    };
    apply({op:'start',oid:'start',rev:0,title:'Identity',items:[{...task,status:'done'}]},1,1);
    apply({op:'change',oid:'same-status',rev:1,changes:[{id:task.id,status:'done'}]},2,1);
    apply({op:'link',oid:'link',rev:2,child:c.sessionId,assign:[task.id]},3,1);
    const titleOnly={op:'revise',oid:'same-title',rev:3,title:'Identity'};
    const originalReceipt=apply(titleOnly,4,2);
    apply({op:'revise',oid:'equivalent',rev:4,items:[task]},5,3);
    const beforeStage=s.history(a.sourceId,plan).data;
    apply({op:'stage',oid:'stage',rev:5,upload:'same',chunk:0,items:[task]},5,3);
    assert.deepEqual(s.history(a.sourceId,plan).data,beforeStage);
    apply({op:'commit',oid:'commit',rev:5,upload:'same',chunks:1},6,4);
    apply({op:'finish',oid:'finished',rev:6,outcome:'finished'},7,4,'finished');
    reject({op:'change',oid:'closed-change',rev:7,changes:[{id:task.id,status:'done'}]},'closed',7,4,'finished');
    reject({op:'revise',oid:'closed-revise',rev:7,title:'Identity'},'closed',7,4,'finished');
    apply({op:'revise',oid:'reopen',rev:7,title:'Identity',reopen:true},8,5);
    const head=s.get(a.sourceId,plan);const history=s.history(a.sourceId,plan).data;
    assert.deepEqual(s.apply({plan,...titleOnly},a),originalReceipt);
    check(8,5);assert.deepEqual(s.get(a.sourceId,plan),head);assert.deepEqual(s.history(a.sourceId,plan).data,history);
    apply({op:'finish',oid:'cancelled',rev:8,outcome:'cancelled'},9,5,'cancelled');
    const stage={op:'stage',rev:9,upload:'closed',chunk:0,items:[task]};
    reject({...stage,oid:'closed-stage'},'closed',9,5,'cancelled');
    const closedHistory=s.history(a.sourceId,plan).data;
    apply({...stage,oid:'reopen-stage',reopen:true},9,5,'cancelled');
    assert.deepEqual(s.history(a.sourceId,plan).data,closedHistory);
    reject({op:'commit',oid:'closed-commit',rev:9,upload:'closed',chunks:1},'closed',9,5,'cancelled');
    apply({op:'commit',oid:'reopen-commit',rev:9,upload:'closed',chunks:1,reopen:true},10,6);
    apply({op:'finish',oid:'failed',rev:10,outcome:'failed'},11,6,'failed');
    apply({op:'revise',oid:'reopen-failed',rev:11,title:'Identity',reopen:true},12,7);
    const source=`${f.root}/synthetic-plan.md`;
    const bound=s.apply({op:'bind',plan,oid:'bind',rev:12,source},a,{state:'missing',path:source,checkedAt:'2026-01-01T00:00:00Z'});
    check(13,7,'active',bound);assert.equal(s.get(a.sourceId,plan)!.document.state,'missing');
    check(13,7);
    reject({op:'change',oid:'stale',rev:12,changes:[{id:task.id,status:'done'}]},'conflict',13,7);
    reject({...titleOnly,title:'Altered'},'operation-reused',13,7);
  }finally{f.cleanup();}
});

test('QA2 P1/P2/P3 counts, delegation/relay, revisions, finish and independent source identities',()=>{
  const f=productionFixture();try{
    const {store:s,actor:m,child:c}=f;
    const start={op:'start',plan:'P1',oid:'start',rev:0,title:'Alpha',items:P1};
    const receipt=s.apply(start,m);assert.deepEqual(s.apply(start,m),receipt);
    assert.throws(()=>s.apply({...start,title:'altered'},m),/operation-reused/);
    s.apply({op:'start',plan:'P2',oid:'start2',rev:0,title:'Independent',items:[]},m);
    s.apply({op:'start',plan:'P3',oid:'start3',rev:0,title:'Beta',items:[]},{...m,sessionId:'U',directory:'/fixture/Beta',projectId:'Beta'});
    assert.deepEqual(s.detail(m.sourceId,'P1').plan.counts,{done:2,total:4,remaining:2,skipped:1});
    assert.equal(s.list().data.length,3);assert.equal(s.list({directory:'/fixture/Beta'}).data[0].id,'P3');
    assert.throws(()=>s.apply({op:'link',plan:'P1',oid:'bad-link',rev:1,child:'C1',assign:['I3']},m,{state:'unbound',path:'',checkedAt:''},{...c,ancestry:null}),/assignment/);
    s.apply({op:'link',plan:'P1',oid:'link',rev:1,child:'C1',assign:['I3']},m,undefined,c);
    assert.equal(s.list({session:'C1'}).data[0].id,'P1');
    assert.equal(s.list({directory:c.directory}).data[0].id,'P1');
    assert.throws(()=>s.apply({op:'change',plan:'P1',oid:'invalid-child',rev:2,changes:[{id:'I4',status:'done'}]},c),/assignment/);
    assert.throws(()=>s.apply({op:'change',plan:'P1',oid:'invalid-batch',rev:2,changes:[{id:'I3',status:'done'},{id:'absent',status:'done'}]},m),/invalid/);
    assert.equal(s.get(m.sourceId,'P1')!.items.find(i=>i.id==='I3')!.status,'working');
    s.apply({op:'change',plan:'P1',oid:'child',rev:2,changes:[{id:'I3',status:'done'}]},c);
    assert.throws(()=>s.apply({op:'change',plan:'P1',oid:'conflict',rev:2,changes:[{id:'I4',status:'done'}]},m),(e:any)=>e.code==='conflict'&&e.revision===3);
    s.apply({op:'link',plan:'P1',oid:'relink',rev:3,child:'C1',assign:['I4']},m,undefined,c);
    s.apply({op:'change',plan:'P1',oid:'relay',rev:4,attributed:'C1',changes:[{id:'I4',status:'done'}]},m,undefined,c);
    assert.deepEqual(s.detail(m.sourceId,'P1').plan.counts,{done:4,total:4,remaining:0,skipped:1});
    assert.equal(s.detail(m.sourceId,'P1').contributions.data.at(-1)!.mode,'parent-relay');
    s.apply({op:'revise',plan:'P1',oid:'move-retitle',rev:5,title:'Moved'}, {...m,directory:'/fixture/Alpha-worktree'});
    assert.equal(s.get(m.sourceId,'P1')!.directory,'/fixture/Alpha-worktree');
    assert.equal(s.history(m.sourceId,'P1').data.length,6);
    s.apply({op:'finish',plan:'P1',oid:'finish',rev:6,outcome:'finished'},m);
    assert.throws(()=>s.apply({op:'change',plan:'P1',oid:'late',rev:7,changes:[{id:'I4',status:'working'}]},c),/closed/);
    s.apply({op:'revise',plan:'P1',oid:'reopen',rev:7,title:'Continue',reopen:true},m);
    assert.equal(s.get(m.sourceId,'P1')!.lifecycle,'active');
    assert.throws(()=>s.apply({op:'finish',plan:'P2',oid:'empty-finish',rev:1,outcome:'finished'},m),/unfinished/);
    s.apply({op:'finish',plan:'P2',oid:'cancel',rev:1,outcome:'cancelled'},m);
    s.apply({op:'finish',plan:'P3',oid:'fail',rev:1,outcome:'failed'},{...m,sessionId:'U'});
    assert.equal(s.list().data.find(p=>p.id==='P3')!.lifecycle,'failed');
  }finally{f.cleanup();}
});
test('unknown ancestry stays independent; unverified linking, invalid tree and all-skipped success refuse',()=>{
  const f=productionFixture();try{
    const s=f.store;const m=f.actor;const child={...f.child,ancestry:null};
    s.apply({op:'start',plan:'unlinked',oid:'independent',rev:0,title:'Unlinked',items:[]},child);
    assert.equal(s.detail(m.sourceId,'unlinked').plan.sessionId,'C1');
    assert.throws(()=>s.apply({op:'start',plan:'bad',oid:'bad',rev:0,title:'Bad',items:[{id:'a',title:'Cycle',kind:'group',parentId:'a'}]},m),/invalid/);
    s.apply({op:'start',plan:'skipped',oid:'skipped',rev:0,title:'Skipped',items:[{id:'i',title:'Skip',kind:'task',status:'skipped'}]},m);
    assert.throws(()=>s.apply({op:'finish',plan:'skipped',oid:'finish',rev:1,outcome:'finished'},m),/unfinished/);
    assert.throws(()=>s.apply({op:'link',plan:'skipped',oid:'link',rev:1,child:'C1',assign:['i']},{...m,verifiedSource:false},undefined,f.child),/source-unverified/);
    assert.throws(()=>s.apply({op:'change',plan:'skipped',oid:'relay',rev:1,attributed:'C1',changes:[{id:'i',status:'done'}]},m,undefined,f.child),/assignment/);
    assert.equal(s.detail(m.sourceId,'skipped').plan.revision,1);
  }finally{f.cleanup();}
});
test('QA2 fixture parent relay C2 never adds work or infers completion from activity',()=>{
  const f=productionFixture();try{
    const {store:s,actor:m}=f;const child={...f.child,sessionId:'C2',agent:'restricted-fixture'};
    s.apply({op:'start',plan:'P1',oid:'start',rev:0,title:'Fixture P1',items:P1},m);
    s.apply({op:'link',plan:'P1',oid:'link',rev:1,child:'C2',assign:['I2']},m,undefined,child);
    s.apply({op:'change',plan:'P1',oid:'relay',rev:2,attributed:'C2',changes:[{id:'I2',status:'done'}]},m,undefined,child);
    const p=s.detail(m.sourceId,'P1');assert.deepEqual(p.plan.counts,{done:2,total:4,remaining:2,skipped:1});assert.equal(p.plan.lifecycle,'active');
    assert.equal(p.contributions.data.at(-1)!.reporterSessionId,'M');assert.equal(p.contributions.data.at(-1)!.attributedSessionId,'C2');
    assert.throws(()=>parseRequest({op:'change',plan:'P1',oid:'idle',rev:3,changes:[{id:'I3',status:'done'}],activity:'idle'}),/invalid/);
  }finally{f.cleanup();}
});
for(const key of ['title','parentId'])test(`change items reject unsupported ${key} with invalid`,()=>{
  assert.throws(()=>parseRequest({op:'change',plan:'P1',oid:'change',rev:1,changes:[{id:'I3',status:'working',[key]:'Changed'}]}),{code:'invalid'});
});
test('change accepts a valid changes-only batch',()=>{
  const request={op:'change',plan:'P1',oid:'change',rev:1,changes:[{id:'I3',status:'working'},{id:'I4',status:'done'}]};
  assert.deepEqual(parseRequest(request),request);
});
test('chunked full structure publishes only after complete atomic commit; pagination and status preservation',()=>{
  const f=productionFixture();try{
    const {store:s,actor:a}=f;
    const first=Array.from({length:30},(_,i)=>({id:`I${i}`,title:`Task ${i}`,kind:'task',status:i===0?'done':'pending'}));
    const unpublished=()=>{
      assert.equal(s.get(a.sourceId,'large'),undefined);
      assert.equal(s.db.prepare('SELECT count(*) AS n FROM revisions WHERE source=? AND plan=?').get(a.sourceId,'large')!.n,0);
      assert.throws(()=>s.history(a.sourceId,'large'),{code:'not-found'});
    };
    assert.deepEqual(s.apply({op:'stage',plan:'large',oid:'s0',rev:0,upload:'u',chunk:0,items:first},a),{plan:'large',rev:0,structuralRev:0,staged:0});
    unpublished();
    assert.throws(()=>s.apply({op:'commit',plan:'large',oid:'incomplete',rev:0,upload:'u',chunks:2,title:'Long'},a),/stage-incomplete/);
    unpublished();
    assert.deepEqual(s.apply({op:'stage',plan:'large',oid:'s1',rev:0,upload:'u',chunk:1,items:[{id:'last',title:'Last',kind:'task'}]},a),{plan:'large',rev:0,structuralRev:0,staged:1});
    unpublished();
    assert.deepEqual(s.apply({op:'commit',plan:'large',oid:'commit',rev:0,upload:'u',chunks:2,title:'Long'},a),{plan:'large',rev:1,structuralRev:1});
    assert.equal(s.get(a.sourceId,'large')!.revision,1);assert.equal(s.get(a.sourceId,'large')!.structuralRevision,1);
    assert.equal(s.history(a.sourceId,'large').data.length,1);
    assert.equal(s.detail(a.sourceId,'large').items.data.length,20);assert.equal(s.detail(a.sourceId,'large',1).items.data.length,11);
    s.apply({op:'revise',plan:'large',oid:'revise',rev:1,items:[{id:'I0',title:'Renamed',kind:'task'}]},a);
    assert.equal(s.get(a.sourceId,'large')!.items[0].status,'done');
    const old=historicalPlan(f,'large',1);assert.equal(old.items.length,31);
    assert.throws(()=>parseRequest({op:'change',plan:'large',oid:'huge',rev:2,changes:[],unknown:1}),/invalid/);
    s.apply({op:'finish',plan:'large',oid:'cancel',rev:2,outcome:'cancelled'},a);
    const closedHistory=s.history(a.sourceId,'large').data;
    assert.deepEqual(s.apply({op:'stage',plan:'large',oid:'reopen-stage',rev:3,upload:'new',chunk:0,items:[{id:'I0',title:'Continued',kind:'task'}],reopen:true},a),{plan:'large',rev:3,structuralRev:2,staged:0});
    assert.equal(s.get(a.sourceId,'large')!.lifecycle,'cancelled');
    assert.equal(s.get(a.sourceId,'large')!.revision,3);assert.equal(s.get(a.sourceId,'large')!.structuralRevision,2);
    assert.deepEqual(s.history(a.sourceId,'large').data,closedHistory);
    assert.deepEqual(s.apply({op:'commit',plan:'large',oid:'reopen-commit',rev:3,upload:'new',chunks:1,reopen:true},a),{plan:'large',rev:4,structuralRev:3});
    assert.equal(s.get(a.sourceId,'large')!.revision,4);assert.equal(s.get(a.sourceId,'large')!.structuralRevision,3);
    assert.equal(s.history(a.sourceId,'large').data.length,closedHistory.length+1);
    assert.equal(s.get(a.sourceId,'large')!.lifecycle,'active');
    s.setEnabled(false);assert.throws(()=>s.apply({op:'revise',plan:'large',oid:'disabled',rev:4,title:'No'},a),/disabled/);
  }finally{f.cleanup();}
});
test('permission-aware capture, canonical target checks, full Unicode pagination, failed reads still commit changes',async()=>{
  const f=productionFixture();try{
    const file=`${f.root}/plan.md`;const text='Привет 🌱\n'.repeat(3000);writeFileSync(file,text);
    const resources:string[]=[];const cap=await captureDocument(file,f.root,async p=>{resources.push(p);});
    assert.equal(cap.state,'captured');assert.equal(cap.text,text);assert.deepEqual(resources,[file,file]);
    const {store:s,actor:a}=f;s.apply({op:'start',plan:'doc',oid:'start',rev:0,title:'Document',items:[{id:'i',title:'Work',kind:'task'}],source:file},a,cap);
    const originalCapture=s.document(a.sourceId,'doc').document.captureId!;
    let body='';let cursor=0;for(;;){const page=s.document(a.sourceId,'doc',cursor,originalCapture);body+=page.text??'';if(page.nextCursor===null)break;cursor=Number(page.nextCursor);}assert.equal(body,text);
    const denied=await captureDocument(file,f.root,async()=>{throw new Error('private');},s.get(a.sourceId,'doc')!.document);
    assert.equal(denied.state,'denied');s.apply({op:'change',plan:'doc',oid:'denied',rev:1,changes:[{id:'i',status:'done'}]},a,denied);
    assert.equal(s.detail(a.sourceId,'doc').plan.counts.done,1);assert.equal(s.document(a.sourceId,'doc').document.state,'denied');assert.ok(s.document(a.sourceId,'doc').text);
    writeFileSync(file,'Changed');const changed=await captureDocument(file,f.root,async()=>{});
    s.apply({op:'revise',plan:'doc',oid:'retitle',rev:2,title:'Title only'},a,changed);assert.equal(s.get(a.sourceId,'doc')!.document.checklistSynchronized,false);
    assert.ok(s.document(a.sourceId,'doc',0,originalCapture).diagnostics.includes('historical-capture'));
    assert.notEqual(s.document(a.sourceId,'doc').document.captureId,originalCapture);
    assert.equal(s.document(a.sourceId,'doc',0,originalCapture).text,Array.from(text).slice(0,16_384).join(''));
    s.apply({op:'revise',plan:'doc',oid:'move',rev:3,title:'Moved'}, {...a,directory:'/fixture/Moved'},changed);
    assert.equal(s.get(a.sourceId,'doc')!.document.path,file);
    assert.equal(s.db.prepare('SELECT count(*) AS n FROM captures').get()!.n,2);
    const other=`${f.root}/other.md`;writeFileSync(other,'Other');const link=`${f.root}/link.md`;symlinkSync(file,link);
    assert.equal((await captureDocument(link,f.root,async p=>{if(p===file)throw new Error();})).state,'denied');
    const linked=await captureDocument(link,f.root,async()=>{});unlinkSync(link);symlinkSync(other,link);
    assert.equal((await captureDocument(link,f.root,async()=>{},{state:'captured',canonicalPath:linked.canonicalPath,checklistSynchronized:true,currentFile:'not-rechecked'})).state,'moved');
    assert.equal((await captureDocument(`${f.root}/missing`,f.root,async()=>{})).state,'missing');
    writeFileSync(other,Buffer.alloc(LIMITS.documentBytes+1));assert.equal((await captureDocument(other,f.root,async()=>{})).state,'oversized');
    writeFileSync(other,Buffer.from([0xff,0]));assert.equal((await captureDocument(other,f.root,async()=>{})).state,'non-text');
    const race=`${f.root}/race.md`;writeFileSync(race,'Before');
    const result=await captureDocument(race,f.root,async p=>{if(p===race){unlinkSync(race);symlinkSync(other,race);}});
    assert.notEqual(result.state,'captured');
  }finally{f.cleanup();}
});
