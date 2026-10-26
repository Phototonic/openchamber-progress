import test from 'node:test';
import assert from 'node:assert/strict';
import { fork, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { readdirSync, readFileSync, lstatSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../../shared/store.ts';
import { cleanupFixture, documentText } from '../fixtures/cleanup.ts';

const code=(expected:string)=>(e:any)=>e.code===expected;
const rows=(s:Store,table:string,source='source-fixture',plan='P-done')=>s.db.prepare(`SELECT * FROM ${table} WHERE source=? AND ${table==='plans'?'id':'plan'}=?`).all(source,plan);
function message(child:ChildProcess){return once(child,'message',{signal:AbortSignal.timeout(10000)}).then(([v])=>v as any);}
function worker(f:ReturnType<typeof cleanupFixture>,mode:string,input:unknown){return fork(new URL('../fixtures/cleanup-worker.ts',import.meta.url),[f.store.file,mode,JSON.stringify(input),JSON.stringify(f.actor),JSON.stringify(f.capture())],{stdio:['ignore','ignore','ignore','ipc']});}
async function kill(child:ChildProcess){const exit=once(child,'exit');child.kill('SIGKILL');await exit;}
function healthy(s:Store){assert.equal(s.db.prepare('PRAGMA integrity_check').get()!.integrity_check,'ok');assert.deepEqual(s.db.prepare('PRAGMA foreign_key_check').all(),[]);}

test('archive/restore preserve snapshots and documents; deletion removes only selected live payloads and permanently fences replay',()=>{
  const f=cleanupFixture();
  try {
    const tables=['plans','revisions','contributions','captures','chunks','receipts'];
    const original=tables.map(t=>rows(f.store,t));const other=tables.map(t=>rows(f.store,t,'source-other'));
    const before=f.store.detail(f.source.id,'P-done');const history=f.store.history(f.source.id,'P-done');const captureId=before.plan.document.captureId!;
    const archived=f.store.cleanup('archive',f.body());assert.equal(archived.cleanup.revision,1);
    assert.deepEqual(f.store.cleanup('archive',f.body()),archived);
    assert.throws(()=>f.store.cleanup('archive',{...f.body(),rev:1}),code('operation-reused'));
    assert.deepEqual(tables.map(t=>rows(f.store,t)),original);
    assert.deepEqual(f.store.detail(f.source.id,'P-done').plan.counts,before.plan.counts);
    assert.deepEqual(f.store.history(f.source.id,'P-done'),history);
    assert.equal(f.store.document(f.source.id,'P-done',0,captureId).text,before.plan.document.captureId?`${documentText}\nRecorded finish\n`:null);
    assert(!f.store.list({source:f.source.id}).data.some(p=>p.id==='P-done'));
    assert.equal(f.store.list({source:f.source.id,archived:'only'}).data[0].id,'P-done');
    assert.throws(()=>f.store.apply(f.starts.get(`${f.source.id}/P-done`),f.actor,f.capture()),code('closed'));
    const restored=f.store.cleanup('restore',f.body('P-done',1,'restore'));
    assert.equal(restored.cleanup.revision,2);assert.equal(f.store.get(f.source.id,'P-done')!.lifecycle,'finished');
    assert.deepEqual(tables.map(t=>rows(f.store,t)),original);
    assert.throws(()=>f.store.cleanup('archive',f.body()),code('conflict'));
    const request={...f.body('P-done',2,'delete'),confirmed:true};const receipt=f.store.cleanup('delete',request);
    assert.equal(receipt.cleanup.state,'deleted');assert.deepEqual(f.store.cleanup('delete',request),receipt);
    for(const t of tables)assert.equal(rows(f.store,t).length,0,t);
    assert.deepEqual(tables.map(t=>rows(f.store,t,'source-other')),other);
    for(const [op,extra]of [['start',{title:'New',items:[]}],['change',{changes:[{id:'A',status:'done'}]}],['stage',{upload:'u',chunk:0,items:[]}],['commit',{upload:'upload',chunks:1,title:'Again',reopen:true}]]as const)for(const oid of ['start-P-done',`fresh-${op}`])assert.throws(()=>f.store.apply({op,plan:'P-done',rev:0,oid,...extra},f.actor),code('not-found'));
    assert.throws(()=>f.store.document(f.source.id,'P-done',0,captureId),code('not-found'));
    assert.throws(()=>f.store.history(f.source.id,'P-done'),code('not-found'));
    assert.equal(readFileSync(f.documentPath,'utf8'),documentText);
    const reopened=new Store(f.store.file);try{assert.deepEqual(reopened.cleanup('delete',request),receipt);assert.equal(reopened.get(f.source.id,'P-done'),undefined);healthy(reopened);}finally{reopened.close();}
    const tombstone=rows(f.store,'cleanup_state')[0];assert.deepEqual(Object.keys(tombstone).sort(),['source','plan','state','generation','oid','request_hash','receipt'].sort());assert(!JSON.stringify(tombstone).includes('Example'));
  }finally{f.cleanup();}
});

test('preflight rejects unsafe inputs without extension/backup; first backup is private and verified; disabled capture stays disabled',()=>{
  const f=cleanupFixture();try{
    const initial=readdirSync(`${f.root}/store`);
    for(const plan of ['P-active','P-cancelled','P-failed'])assert.throws(()=>f.store.cleanup('archive',f.body(plan,0,'x',plan==='P-active'?1:2)),code('closed'));
    for(const value of [{...f.body(),storeId:'wrong'},{...f.body(),rev:1},{...f.body(),cleanupRev:1}])assert.throws(()=>f.store.cleanup('archive',value),code('conflict'));
    for(const value of [{...f.body(),confirmed:false},{...f.body(),extra:true},{...f.body(),plan:['P-done']},{...f.body(),oid:'x'.repeat(81)},{...f.body(),cleanupRev:-1}])assert.throws(()=>f.store.cleanup('delete',value),code('invalid'));
    assert.deepEqual(readdirSync(`${f.root}/store`),initial);assert.equal(f.store.db.prepare("SELECT name FROM sqlite_master WHERE name='cleanup_state'").get(),undefined);
    f.store.setEnabled(false);f.store.cleanup('archive',f.body());assert.equal(f.store.list().captureEnabled,false);
    const backups=readdirSync(`${f.root}/store`).filter(n=>n.startsWith('cleanup-backup-'));assert.equal(backups.length,1);
    const backup=`${f.root}/store/${backups[0]}`;assert.equal(lstatSync(backup).mode&0o777,0o600);
    const db=new DatabaseSync(backup,{readOnly:true});try{assert.equal(db.prepare('PRAGMA integrity_check').get()!.integrity_check,'ok');assert.equal(db.prepare('SELECT count(*) AS n FROM plans').get()!.n,6);assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name='cleanup_state'").get(),undefined);}finally{db.close();}
    healthy(f.store);
  }finally{f.cleanup();}
});

test('immutable legacy Store loaded before activation and opened after activation cannot mutate archived or resurrect deleted keys',async()=>{
  const f=cleanupFixture();const children:ChildProcess[]=[];
  async function legacy(name:string){const child=fork(new URL('../fixtures/cleanup-legacy-writer.ts',import.meta.url),[f.store.file,`${f.root}/${name}`],{stdio:['ignore','ignore','ignore','ipc']});children.push(child);assert.equal((await message(child)).phase,'ready');return child;}
  async function apply(child:ChildProcess,input:any,capture?:unknown){const response=message(child);child.send({input,actor:f.actor,capture});return response;}
  try{
    const before=await legacy('legacy-before');
    const replay=f.starts.get(`${f.source.id}/P-other`);assert((await apply(before,replay,f.capture())).receipt);
    f.store.cleanup('archive',f.body());const after=await legacy('legacy-after');
    const payloads=[{op:'stage',plan:'P-done',rev:2,oid:'late-stage',upload:'late',chunk:0,reopen:true,items:[]},{op:'revise',plan:'P-done',rev:2,oid:'late-reopen',reopen:true,title:'Late'}];
    const preserved=['plans','revisions','contributions','captures','chunks','receipts'].map(t=>rows(f.store,t));
    for(const child of [before,after])for(const input of payloads)assert.equal((await apply(child,input,f.capture('Late capture'))).error,'storage');
    assert.deepEqual(['plans','revisions','contributions','captures','chunks','receipts'].map(t=>rows(f.store,t)),preserved);
    f.store.cleanup('delete',{...f.body('P-done',1,'delete'),confirmed:true});
    for(const child of [before,after]){
      for(const input of [f.starts.get(`${f.source.id}/P-done`),{op:'start',plan:'P-done',rev:0,oid:'new-start',title:'New',source:f.documentPath,items:[]},{op:'change',plan:'P-done',rev:0,oid:'new-change',changes:[{id:'A',status:'done'}]},{op:'stage',plan:'P-done',rev:0,oid:'new-stage',upload:'new',chunk:0,items:[]},{op:'commit',plan:'P-done',rev:0,oid:'new-commit',title:'New',upload:'upload',chunks:1}])assert((await apply(child,input,f.capture('late content'))).error);
      assert((await apply(child,replay,f.capture())).receipt);
      const oid=child===before?'other-before':'other-after';const rev=f.store.get(f.source.id,'P-other')!.revision;
      assert((await apply(child,{op:'revise',plan:'P-other',rev,oid,reopen:true,title:'Unrelated'},f.capture())).receipt);
    }
    for(const t of ['plans','chunks','captures','revisions','contributions','receipts'])assert.equal(rows(f.store,t).length,0,t);
    healthy(f.store);
  }finally{for(const c of children)if(c.connected){const exit=once(c,'exit');c.send({close:true});await exit;}f.cleanup();}
});

test('guards cover inserts and old/new update identities on every legacy payload table',()=>{
  const f=cleanupFixture();try{
    f.store.apply({op:'stage',plan:'P-other',rev:2,oid:'stage-other',upload:'other',chunk:0,reopen:true,items:[]},f.actor);
    f.store.cleanup('archive',f.body());
    for(const table of ['plans','chunks','captures','revisions','contributions','receipts']){
      const key=table==='plans'?'id':'plan';
      assert.throws(()=>f.store.db.prepare(`UPDATE ${table} SET ${key}='escape' WHERE source=? AND ${key}=?`).run(f.source.id,'P-done'),/cleanup-closed/,table);
      assert.throws(()=>f.store.db.prepare(`UPDATE ${table} SET ${key}='P-done' WHERE source=? AND ${key}=?`).run(f.source.id,'P-other'),/cleanup-closed/,table);
      const row=rows(f.store,table)[0];const names=Object.keys(row);assert.throws(()=>f.store.db.prepare(`INSERT INTO ${table}(${names.join(',')}) VALUES(${names.map(()=>'?').join(',')})`).run(...names.map(k=>row[k])),/cleanup-closed/,table);
    }
  }finally{f.cleanup();}
});

test('genuine pre-delete change/stage/commit receipts cannot replay after deletion under new or pinned legacy Store',async()=>{
  const f=cleanupFixture();let child:ChildProcess|undefined;
  try{
    const input=[
      {op:'stage',plan:'P-replay',rev:0,oid:'replay-stage',upload:'replay',chunk:0,items:[{id:'A',title:'Replay example',kind:'task',status:'working'}]},
      {op:'commit',plan:'P-replay',rev:0,oid:'replay-commit',upload:'replay',chunks:1,title:'Replay example'},
      {op:'change',plan:'P-replay',rev:1,oid:'replay-change',changes:[{id:'A',status:'done'}]},
    ];
    for(const r of input)f.store.apply(r,f.actor);
    f.store.apply({op:'finish',plan:'P-replay',rev:2,oid:'replay-finish',outcome:'finished'},f.actor);
    child=fork(new URL('../fixtures/cleanup-legacy-writer.ts',import.meta.url),[f.store.file,`${f.root}/legacy-replay`],{stdio:['ignore','ignore','ignore','ipc']});await message(child);
    f.store.cleanup('delete',{...f.body('P-replay',0,'delete-replay',3),confirmed:true});
    for(const r of input)for(const request of [r,{...r,oid:`fresh-${r.oid}`}]){
      assert.throws(()=>f.store.apply(request,f.actor),code('not-found'));
      const response=message(child);child.send({input:request,actor:f.actor});assert((await response).error);
    }
    for(const table of ['plans','revisions','contributions','captures','chunks','receipts'])assert.equal(rows(f.store,table,f.source.id,'P-replay').length,0,table);
    healthy(f.store);
  }finally{if(child?.connected){const exit=once(child,'exit');child.send({close:true});await exit;}f.cleanup();}
});

test('competing cleanup and reopen processes serialize; two cleanup requests cannot both apply',async()=>{
  const f=cleanupFixture();try{
    const a=worker(f,'normal',{action:'archive',body:f.body()});const b=worker(f,'reopen',{op:'revise',plan:'P-done',rev:2,oid:'race-reopen',title:'Continued',reopen:true});
    const [ar,br]=await Promise.all([message(a),message(b)]);assert.equal(Number(Boolean(ar.receipt))+Number(Boolean(br.receipt)),1);
    const p=f.store.detail(f.source.id,'P-done').plan;assert(p.lifecycle==='active'?!p.cleanup:p.cleanup?.state==='archived');
    const c=worker(f,'normal',{action:'archive',body:f.body('P-other',0,'one')});const d=worker(f,'normal',{action:'delete',body:{...f.body('P-other',0,'two'),confirmed:true}});
    const results=await Promise.all([message(c),message(d)]);assert.equal(results.filter(r=>r.receipt).length,1);assert.equal(results.filter(r=>r.error==='conflict').length,1);healthy(f.store);
  }finally{f.cleanup();}
});

test('kill before commit rolls back; kill after commit preserves receipt; busy and injected disk failure never partially mutate',async()=>{
  const f=cleanupFixture();try{
    f.store.cleanup('archive',f.body('P-other',0,'init')); // initialize before worker TEMP trigger
    const request={action:'delete',body:{...f.body(),confirmed:true}};
    const before=worker(f,'before',request);assert.equal((await message(before)).phase,'before-commit');await kill(before);
    assert(f.store.get(f.source.id,'P-done'));healthy(f.store);
    const held=worker(f,'hold',request);assert.equal((await message(held)).phase,'locked');assert.throws(()=>f.store.cleanup('delete',request.body),code('busy'));await kill(held);
    f.store.db.exec("CREATE TEMP TRIGGER qa_disk BEFORE INSERT ON cleanup_state BEGIN SELECT RAISE(ABORT,'database or disk is full'); END");
    assert.throws(()=>f.store.cleanup('delete',request.body),code('storage'));assert(f.store.get(f.source.id,'P-done'));assert.equal(rows(f.store,'cleanup_state').length,0);f.store.db.exec('DROP TRIGGER qa_disk');
    const after=worker(f,'after',request);assert.equal((await message(after)).phase,'after-commit');await kill(after);
    assert.equal(f.store.cleanup('delete',request.body).cleanup.state,'deleted');assert.equal(f.store.get(f.source.id,'P-done'),undefined);healthy(f.store);
  }finally{f.cleanup();}
});

test('first-use backup and extension DDL failures preserve data; unknown format/guards/base and readonly refuse without reset',()=>{
  const f=cleanupFixture();try{
    const snapshots=f.store.db.prepare('SELECT * FROM plans').all();
    // Fault injection at the snapshot boundary: exclusive empty destination must be removed.
    const prepare=f.store.db.prepare.bind(f.store.db);
    f.store.db.prepare=((sql:string)=>{if(sql==='VACUUM INTO ?')throw Object.assign(new Error('database or disk is full'),{errcode:13});return prepare(sql);}) as typeof f.store.db.prepare;
    assert.throws(()=>f.store.cleanup('archive',f.body()),code('storage'));f.store.db.prepare=prepare;
    assert.equal(readdirSync(`${f.root}/store`).filter(n=>n.startsWith('cleanup-backup-')).length,0);
    assert.deepEqual(f.store.db.prepare('SELECT * FROM plans').all(),snapshots);
    // Real SQLite page-capacity failure during first extension DDL, after snapshot creation.
    const pages=f.store.db.prepare('PRAGMA page_count').get()!.page_count;
    f.store.db.exec(`PRAGMA max_page_count=${pages}`);assert.throws(()=>f.store.cleanup('archive',f.body()),code('storage'));f.store.db.exec('PRAGMA max_page_count=1073741823');
    assert.equal(f.store.db.prepare("SELECT name FROM sqlite_master WHERE name='cleanup_state'").get(),undefined);assert.deepEqual(f.store.db.prepare('SELECT * FROM plans').all(),snapshots);
    const readonly=new Store(f.store.file,{readOnly:true});try{assert.throws(()=>readonly.cleanup('archive',f.body()),code('storage'));assert.equal(readonly.list().schemaVersion,2);}finally{readonly.close();}
    f.store.cleanup('archive',f.body());f.store.db.exec('DROP TRIGGER cleanup_guard_plans_insert');assert.throws(()=>f.store.cleanup('restore',f.body('P-done',1,'restore')),code('schema'));assert.deepEqual(f.store.db.prepare('SELECT * FROM plans').all(),snapshots);
    f.store.db.exec('PRAGMA user_version=3');assert.throws(()=>new Store(f.store.file),code('schema'));assert.throws(()=>f.store.cleanup('restore',f.body('P-done',1,'restore')),code('schema'));assert.deepEqual(f.store.db.prepare('SELECT * FROM plans').all(),snapshots);
  }finally{f.cleanup();}
});

test('future cleanup format refuses without repair, snapshot/reset or version changes',()=>{
  const f=cleanupFixture();try{
    f.store.cleanup('archive',f.body());const before=f.store.db.prepare('SELECT * FROM plans').all();const files=readdirSync(`${f.root}/store`);
    f.store.db.exec('PRAGMA ignore_check_constraints=ON; UPDATE cleanup_format SET version=2; PRAGMA ignore_check_constraints=OFF');
    assert.throws(()=>f.store.cleanup('restore',f.body('P-done',1,'restore')),code('schema'));
    assert.deepEqual(f.store.db.prepare('SELECT * FROM plans').all(),before);assert.deepEqual(readdirSync(`${f.root}/store`),files);
    assert.equal(f.store.db.prepare('PRAGMA user_version').get()!.user_version,2);
    assert.equal(JSON.parse(readFileSync('package.json','utf8')).version,'0.2.7');
  }finally{f.cleanup();}
});
