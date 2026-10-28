import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Store } from '../../shared/store.ts';
import { SEARCH_LIMITS as L, type SearchWindow, type ItemInput } from '../../shared/progress.ts';
import { searchTokens, searchMatches } from '../../shared/plan-task-search.ts';
import { searchFixture, seedSearchLibrary, libraryId } from '../fixtures/plan-task-search.ts';

export function assertBounds(w: SearchWindow) {
  assert(w.work.planSlots <= L.plans); assert(w.work.membershipRows <= L.membershipRows); assert(w.work.inputBytes <= L.inputBytes);
  assert(w.hits.length <= L.hits); assert.equal(w.work.outputHits, w.hits.length); assert.equal(w.work.outputBytes, Buffer.byteLength(JSON.stringify(w)));
  assert(w.work.outputBytes <= L.responseBytes); assert(w.hits.every(h => h.ancestors.length <= L.ancestors));
  assert.equal(w.exhausted, w.nextCursor === null);
}
test('literal all-word Unicode matching, status intersection, grouping and authoritative totals', () => {
  const f = searchFixture(); try {
    const w = f.store.search({ q: 'export csv' }); assertBounds(w);
    assert.deepEqual(w.counts, { matchedPlans: 3, matchingTasks: 3 });
    assert.equal(w.hits.filter(h => h.task === null).length, 1);
    const hit = w.hits.find(h => h.task?.id === 'T-csv' && h.plan.sourceId === f.alpha.id)!;
    assert.deepEqual(hit.plan.counts, { done: 1, total: 4, remaining: 3, skipped: 1 }); assert.equal(hit.ancestors.length, 2);
    const blocked = f.store.search({ q: 'export csv', status: 'blocked' }); assert.deepEqual(blocked.counts, { matchedPlans: 1, matchingTasks: 1 }); assert.equal(blocked.hits[0].task!.id, 'T-blocked');
    assert.equal(f.store.search({ status: 'blocked' }).counts.matchingTasks, 3);
    for (const [q, title, matches] of [['Café','Café',true],['cafe','Café',false],['ПРИВЕТ','Привет',true],['ΚΌΣΜΕ','κόσμε',true],['🙂','🙂',true],['漢','漢字',true],['STRASSE','Straße',false],['%','literal %',true],['*','no wildcard',false],['csv export csv','Export CSV',true],['  \t\n','Anything',true]] as const) assert.equal(searchMatches(searchTokens(q), title, 'T'), matches, q);
    assert(searchMatches(searchTokens('t.a:_-'), 'Unrelated', 'T.a:_-'));
    assert(!searchMatches(searchTokens('export csv'), 'Export', 'T'));
    assert.throws(() => searchTokens('x'.repeat(257))); assert.throws(() => searchTokens(Array(17).fill('x').join(' ')));
    assert.equal(f.store.search({ q: 'missing' }).hits.length, 0);
    assert.equal(f.store.search({ lifecycle: 'finished' }).hits.length, 0);
  } finally { f.cleanup(); }
});

test('1200 plans: keyset windows reach after 50, 500 and 1000; excluded prefixes remain bounded', () => {
  const f = searchFixture(false); try {
    seedSearchLibrary(f);
    for (const n of [51,501,1001]) { const windows = f.scan({ q: `Needle-at-${String(n).padStart(4,'0')}` }); windows.forEach(assertBounds); assert.equal(windows.flatMap(w => w.hits)[0].plan.id, libraryId(n)); assert(windows.length > 10); }
    for (const options of [{ archived: 'only' as const }, { lifecycle: 'finished' as const }, { status: 'blocked' as const }]) { const w = f.store.search(options); assert.equal(w.hits.length, 0); assert.equal(w.work.planSlots, 64); assert.equal(w.exhausted, false); }
    const projected = f.scan({ q: 'Needle' }).flatMap(w => w.hits).filter(h => h.plan.directory === '/fixture/main'); assert.deepEqual(projected.map(h => h.plan.id), [libraryId(501), libraryId(1001)]);
    const dense = f.scan({ q: 'Dense' }); dense.forEach(assertBounds); assert.equal(dense.reduce((n,w) => n+w.counts.matchingTasks,0),600);
  } finally { f.cleanup(); }
});

test('1000-task continuation counts once; deep breadcrumbs; pinned revision and identity conflict', () => {
  const f = searchFixture(false); try {
    f.seedPlan('P-large', 'Large', Array.from({length:1000},(_,n)=>({id:`T${n}`,title:'Match',kind:'task',status:n%2?'done':'working'})));
    const all = f.scan({ q: 'Match' }); all.forEach(assertBounds);
    assert.equal(all.flatMap(w=>w.hits).length,1000); assert.equal(new Set(all.flatMap(w=>w.hits).map(h=>h.task!.id)).size,1000);
    assert.equal(all.reduce((n,w)=>n+w.counts.matchedPlans,0),1); assert.equal(all.reduce((n,w)=>n+w.counts.matchingTasks,0),1000);
    assert.equal(all[1].hits[0].classified,null); assert.equal(all[1].hits[0].continued,true);
    const first=f.store.search({q:'Match'});
    assert.throws(()=>f.store.search({q:'Other',cursor:first.nextCursor!}),/conflict/);
    f.store.bindReads(f.beta.id,false); assert.throws(()=>f.store.search({q:'Match',cursor:first.nextCursor!}),/conflict/); f.store.bindReads(f.alpha.id,true);
    f.apply('P-large',{op:'change',changes:[{id:'T0',status:'done'}]}); assert.throws(()=>f.store.search({q:'Match',cursor:first.nextCursor!}),/conflict/);
    const chain:ItemInput[]=Array.from({length:1000},(_,n)=>({id:`G${n}`,title:n===999?'Deep needle':'Context',kind:n===999?'task':'group',...(n?{parentId:`G${n-1}`}:{})}));
    f.seedPlan('P-deep','Deep',chain); const deep=f.store.search({q:'Deep needle'}).hits[0]; assert.equal(deep.omittedAncestors,991); assert.equal(deep.ancestors[0].id,'G0'); assert.equal(deep.ancestors.at(-1)!.id,'G998');
  } finally {f.cleanup();}
});

test('inclusive session membership resumes after 128 contribution rows without false nonmatch',()=>{
  const f=searchFixture(false); try {
    f.seedPlan('P-member','Membership',[{id:'T',title:'Match',kind:'task'}]);
    for(let n=0;n<130;n++)f.apply('P-member',{op:'change',changes:[{id:'T',status:n%2?'working':'pending'}]});
    const child={...f.actor,sessionId:'child',parentId:f.actor.sessionId,ancestry:[f.actor.sessionId]};
    f.apply('P-member',{op:'link',child:'child',assign:['T']},f.actor,child);
    f.apply('P-member',{op:'change',changes:[{id:'T',status:'blocked'}]},child);
    f.apply('P-member',{op:'link',child:'child',assign:[]},f.actor,child);
    const first=f.store.search({session:'child',q:'Match'});assertBounds(first);assert.equal(first.work.membershipRows,128);assert.equal(first.hits.length,0);assert(!first.exhausted);
    const next=f.store.search({session:'child',q:'Match',cursor:first.nextCursor!});assertBounds(next);assert.equal(next.hits.length,1);
    f.apply('P-member',{op:'change',changes:[{id:'T',status:'done'}]});assert.throws(()=>f.store.search({session:'child',q:'Match',cursor:first.nextCursor!}),/conflict/);
    assert.equal(f.store.search({session:f.actor.sessionId}).work.membershipRows,0);
    assert.equal(f.scan({session:'absent'}).flatMap(w=>w.hits).length,0);
  }finally{f.cleanup();}
});

test('legacy read-only searches do not mutate; invalid/oversized records qualify gaps and continue',()=>{
  const f=searchFixture();try{
    const before=readFileSync(f.store.file);const tables=f.store.db.prepare('SELECT name FROM sqlite_master ORDER BY name').all();
    const reader=new Store(f.store.file,{readOnly:true});try{assertBounds(reader.search());reader.searchState(f.storeId,[{source:f.alpha.id,plan:'P-export'}]);}finally{reader.close();}
    assert.deepEqual(readFileSync(f.store.file),before);assert.deepEqual(f.store.db.prepare('SELECT name FROM sqlite_master ORDER BY name').all(),tables);
    // Explicit fault injection, not a production seeding path.
    f.store.db.prepare("UPDATE plans SET snapshot=json_set(snapshot,'$.items',json('[{}]')) WHERE id='P-empty'").run();
    f.store.db.prepare("UPDATE plans SET snapshot=json_set(snapshot,'$.padding',?) WHERE id='P-group'").run('x'.repeat(L.inputBytes));
    const w=f.store.search({q:'export csv'});assertBounds(w);assert(w.exhausted);assert(w.coverage.gapped);assert.equal(w.coverage.skippedRecords,2);assert.deepEqual(w.coverage.reasons,['invalid-snapshot','oversized-snapshot']);assert.equal(w.hits.length,4);
    assert.throws(()=>f.store.search({cursor:'garbage'}));
    f.store.db.prepare("UPDATE contributions SET payload=json_set(payload,'$.attributedSessionId',null) WHERE plan='P-export'").run();
    const invalid=f.store.search({session:'unrelated'});assert(invalid.coverage.reasons.includes('invalid-membership'));assertBounds(invalid);
  }finally{f.cleanup();}
});

test('freshness explicitly distinguishes missing, archive/restore generation and source collisions',()=>{
  const f=searchFixture(false);try{
    f.seedPlan('P','Finished',[{id:'T',title:'Match',kind:'task',status:'done'},{id:'T2',title:'Match',kind:'task',status:'done'}]);f.apply('P',{op:'finish',outcome:'finished'});
    const keys=[{source:f.alpha.id,plan:'P'},{source:f.beta.id,plan:'P'}];const revision=f.store.get(f.alpha.id,'P')!.revision;
    const action=(a:'archive'|'restore'|'delete',cleanupRev:number)=>f.store.cleanup(a,{storeId:f.storeId,source:f.alpha.id,plan:'P',rev:revision,cleanupRev,oid:a,...(a==='delete'?{confirmed:true}:{})});
    const first=f.store.search({limit:1});action('archive',0);assert.throws(()=>f.store.search({limit:1,cursor:first.nextCursor!}),/conflict/);
    assert.equal(f.store.search().hits.length,0);assert.equal(f.store.search({archived:'only'}).hits.length,2);
    let state=f.store.searchState(f.storeId,keys);assert.equal(state.data[0].revision,revision);assert.equal(state.data[0].cleanup.revision,1);assert.equal(state.data[1].exists,false);
    const reader=new Store(f.store.file,{readOnly:true});try{assert.equal(reader.searchState(f.storeId,keys).data[0].cleanup.revision,1);assert.equal(reader.search({archived:'only'}).hits.length,2);}finally{reader.close();}
    action('restore',1);assert.equal(f.store.searchState(f.storeId,keys).data[0].cleanup.revision,2);
    action('delete',2);state=f.store.searchState(f.storeId,keys);assert.equal(state.data[0].exists,false);assert.equal(state.data[0].cleanup.state,'deleted');assert.equal(state.data[0].cleanup.revision,3);
    assert.throws(()=>f.store.searchState('wrong',keys),/conflict/);assert.throws(()=>f.store.searchState(f.storeId,[keys[0],keys[0]]));
    assert.throws(()=>f.store.searchState(f.storeId,[keys[0],{plan:'P',source:f.alpha.id}]));
  }finally{f.cleanup();}
});

test('lifecycle/source intersection and observed-not-frozen keyset semantics',()=>{
  const f=searchFixture(false);try{
    for(const lifecycle of ['active','finished','cancelled','failed'] as const){const id=`P-${lifecycle}`;f.seedPlan(id,'Match',[{id:'T',title:'Match',kind:'task',status:'done'}]);if(lifecycle!=='active')f.apply(id,{op:'finish',outcome:lifecycle});}
    for(const lifecycle of ['active','finished','cancelled','failed'] as const){const w=f.store.search({lifecycle,source:f.alpha.id});assert.equal(w.counts.matchedPlans,1);assert.equal(w.hits[0].plan.lifecycle,lifecycle);}
    assert.equal(f.store.search({source:f.beta.id}).hits.length,0);
    const first=f.store.search({limit:1});const checked=first.hits[0].plan.id;
    f.seedPlan('A-inserted','Inserted behind cursor',[]);f.apply(checked,{op:'revise',title:'Changed behind cursor',reopen:true});
    const rest=f.scan({limit:1,cursor:first.nextCursor!});assert(!rest.flatMap(w=>w.hits).some(h=>h.plan.id==='A-inserted'));assert(rest.every(w=>w.coverage.asSearched));
    // Unknown cleanup format must fail closed without repair even for the new reads.
    f.store.db.exec('CREATE TABLE cleanup_unknown(value TEXT)');assert.throws(()=>f.store.search(),/schema/);assert.throws(()=>f.store.searchState(f.storeId,[{source:f.alpha.id,plan:checked}]),/schema/);
  }finally{f.cleanup();}
});
