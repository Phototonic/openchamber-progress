import {test} from 'node:test';
import assert from 'node:assert/strict';
import {writeFileSync,readFileSync,symlinkSync,unlinkSync,mkdirSync} from 'node:fs';
import {productionFixture,P1} from '../fixtures/production.ts';
import {parseRequest,LIMITS} from '../../shared/progress.ts';
import {captureDocument} from '../../plugin/document.ts';

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
    s.apply({op:'stage',plan:'large',oid:'s0',rev:0,upload:'u',chunk:0,items:first},a);
    assert.equal(s.get(a.sourceId,'large'),undefined);
    assert.throws(()=>s.apply({op:'commit',plan:'large',oid:'incomplete',rev:0,upload:'u',chunks:2,title:'Long'},a),/stage-incomplete/);
    s.apply({op:'stage',plan:'large',oid:'s1',rev:0,upload:'u',chunk:1,items:[{id:'last',title:'Last',kind:'task'}]},a);
    s.apply({op:'commit',plan:'large',oid:'commit',rev:0,upload:'u',chunks:2,title:'Long'},a);
    assert.equal(s.detail(a.sourceId,'large').items.data.length,20);assert.equal(s.detail(a.sourceId,'large',1).items.data.length,11);
    s.apply({op:'revise',plan:'large',oid:'revise',rev:1,items:[{id:'I0',title:'Renamed',kind:'task'}]},a);
    assert.equal(s.get(a.sourceId,'large')!.items[0].status,'done');
    const old=JSON.parse(String(s.db.prepare('SELECT snapshot FROM revisions WHERE plan=? AND revision=1').get('large')!.snapshot));assert.equal(old.items.length,31);
    assert.throws(()=>parseRequest({op:'change',plan:'large',oid:'huge',rev:2,changes:[],unknown:1}),/invalid/);
    s.apply({op:'finish',plan:'large',oid:'cancel',rev:2,outcome:'cancelled'},a);
    s.apply({op:'stage',plan:'large',oid:'reopen-stage',rev:3,upload:'new',chunk:0,items:[{id:'I0',title:'Continued',kind:'task'}],reopen:true},a);
    assert.equal(s.get(a.sourceId,'large')!.lifecycle,'cancelled');
    s.apply({op:'commit',plan:'large',oid:'reopen-commit',rev:3,upload:'new',chunks:1,reopen:true},a);
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
