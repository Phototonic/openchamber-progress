import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { createProgressServer } from '../../service/server.ts';
import { searchFixture } from '../fixtures/plan-task-search.ts';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Store } from '../../shared/store.ts';
import { launchNeedsYouService } from '../fixtures/needs-you.ts';
import type { Envelope, PlanRead } from '../../shared/progress.ts';

async function fixture() {
  const f = searchFixture(false), token = 'synthetic-inbox-token';
  const server = createProgressServer(f.store, token); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const query = (extra: Record<string, string | undefined> = {}) => new URLSearchParams({ storeId: f.storeId, binding: JSON.stringify({ sourceId: f.alpha.id, verified: true }), source: f.alpha.id, ...Object.fromEntries(Object.entries(extra).filter((entry): entry is [string, string] => entry[1] !== undefined)) });
  async function get(path: string, init: RequestInit = {}) {
    const r = await fetch(base + path, { headers: { authorization: `Bearer ${token}` }, ...init });
    return { status: r.status, headers: r.headers, value: await r.json() as any };
  }
  return { ...f, base, token, query, get, async close() { server.close(); await once(server, 'close'); f.cleanup(); } };
}
const refused = (r: { status: number; value: unknown }, status: number, error: string) => { assert.equal(r.status, status); assert.deepEqual(r.value, { error }); };

test('HTTP authorized source-wide summary preserves normal list scope; read-only navigation and freshness', async () => {
  const f = await fixture();
  try {
    f.seedPlan('plan-alpha', 'Alpha', ['a','b'].map(id => ({ id, title: id, kind: 'task', status: 'blocked' })));
    f.apply('plan-alpha', { op: 'change', changes: [{ id: 'a', status: 'blocked', blocker: { category: 'decision' } }, { id: 'b', status: 'blocked', blocker: { category: 'review' } }] });
    const other = { ...f.actor, sessionId: 'coordinator-beta', directory: '/fixture/other' };
    f.seedPlan('plan-beta', 'Beta', [{ id: 'a', title: 'Other review', kind: 'task', status: 'blocked' }, { id: 'other', title: 'Also blocked', kind: 'task', status: 'blocked' }], other);
    f.apply('plan-beta', { op: 'change', changes: [{ id: 'a', status: 'blocked', blocker: { category: 'review' } }] }, other);
    f.seedPlan('plan-alpha', 'Collision', [{ id: 'a', title: 'Wrong source', kind: 'task', status: 'blocked' }], { ...f.actor, sourceId: f.beta.id });
    f.seedPlan('closed', 'Closed', [{ id: 'a', title: 'Completed work', kind: 'task', status: 'done' }]); f.apply('closed', { op: 'finish', outcome: 'finished' });
    const revision = f.store.get(f.alpha.id, 'closed')!.revision;
    f.store.cleanup('archive', { storeId: f.storeId, source: f.alpha.id, plan: 'closed', rev: revision, cleanupRev: 0, oid: 'archive' });
    const dump = () => ['sqlite_master','plans','revisions','contributions','receipts','meta','cleanup_state'].map(table => f.store.db.prepare(`SELECT * FROM ${table}`).all());
    const before = dump();
    assert.equal((await f.get('/health')).value.needsYouInbox, 1);
    const scoped = `/v1/plans?source=${f.alpha.id}&session=${f.actor.sessionId}&directory=%2Ffixture%2Fmain`;
    const normal = await f.get(scoped), extended = await f.get(scoped + '&needsYou=1');
    assert.equal(extended.status, 200); assert.equal(normal.value.needsYou, undefined);
    const { needsYou: inbox, ...list } = extended.value; assert.deepEqual(list, normal.value);
    assert(inbox.rows.every((r: any) => r.timing === undefined), 'compact counts do not scan timing');
    const timed = await f.get(scoped + '&needsYou=1&needsYouTiming=1');
    assert.equal(timed.status, 200); assert.deepEqual(timed.value.needsYou.counts, inbox.counts);
    assert(timed.value.needsYou.rows.some((r: any) => r.timing?.kind === 'exact'), 'displayed inbox rows request real waiting times');
    assert.deepEqual(list.data.map((p: any) => p.id), ['plan-alpha']);
    assert.deepEqual(inbox.counts, { needsYou: 3, alsoBlocked: 1 }); assert(inbox.coverage.complete);
    assert(inbox.rows.some((r: any) => r.plan === 'plan-beta')); assert(inbox.rows.every((r: any) => r.source === f.alpha.id));
    const direct = await f.get(`/v1/needs-you?${f.query({ timing: '1', limit: '2' })}`);
    assert.equal(direct.status, 200); assert.equal(direct.value.rows.length, 2); assert(direct.value.nextCursor); assert(!direct.value.coverage.complete);
    const continuation = await f.get(`/v1/needs-you?${f.query({ timing: '1', limit: '2', cursor: direct.value.nextCursor })}`);
    assert.equal(continuation.status, 200); assert.equal(continuation.value.rows.length, 2); assert.deepEqual(continuation.value.counts, inbox.counts);
    const exhausted = await f.get(`/v1/needs-you?${f.query({ timing: '1', limit: '2', cursor: continuation.value.nextCursor })}`);
    assert.equal(exhausted.status, 200); assert(exhausted.value.coverage.complete); assert.equal(exhausted.value.nextCursor, null);
    refused(await f.get(`/v1/needs-you?${f.query({ limit: '2', cursor: direct.value.nextCursor })}`), 409, 'conflict');
    assert.equal(direct.headers.get('cache-control'), 'no-store'); assert.equal(direct.headers.get('x-content-type-options'), 'nosniff');
    for (const row of inbox.rows) {
      const detail = await f.get(`/v1/plan?${new URLSearchParams({ source: row.source, plan: row.plan })}`);
      assert.equal(detail.status, 200); assert.equal(detail.value.plan.revision, row.revision);
      assert(detail.value.items.data.some((item: any) => item.id === row.task.id && item.status === 'blocked'));
    }
    const stateQuery = new URLSearchParams({ storeId: f.storeId, keys: JSON.stringify([{ source: f.alpha.id, plan: 'plan-alpha' }]) });
    assert.equal((await f.get(`/v1/search-state?${stateQuery}`)).value.needsYou, undefined);
    const state = await f.get(`/v1/search-state?${stateQuery}&needsYou=1`); assert.equal(state.status, 200); assert.deepEqual(state.value.needsYou.counts, inbox.counts);
    const timedState = await f.get(`/v1/search-state?${stateQuery}&needsYou=1&needsYouTiming=1`);
    assert.equal(timedState.status, 200); assert(timedState.value.needsYou.rows.some((r: any) => r.timing));
    assert.deepEqual(dump(), before, 'all inbox/list/detail/freshness reads leave durable data/schema unchanged');
    f.apply('plan-beta', { op: 'finish', outcome: 'cancelled' }, other);
    assert.deepEqual((await f.get(`/v1/needs-you?${f.query()}`)).value.counts, { needsYou: 2, alsoBlocked: 0 });
    refused(await f.get(scoped + '&cursor=1&needsYou=1'), 400, 'invalid');
  } finally { await f.close(); }
});

test('HTTP refuses unauthorized, malformed, duplicate, body and stale identity requests', async () => {
  const f = await fixture();
  try {
    const path = `/v1/needs-you?${f.query()}`;
    refused(await f.get(path, { headers: {} }), 401, 'unauthorized');
    refused(await f.get(path, { method: 'POST' }), 405, 'method-not-allowed');
    for (const extra of ['&source=source-alpha','&unknown=1']) refused(await f.get(path + extra), 404, 'not-found');
    for (const key of ['source','storeId','binding']) { const q = f.query(); q.delete(key); refused(await f.get(`/v1/needs-you?${q}`), 400, 'invalid'); }
    for (const extra of [{ limit: '0' }, { limit: '51' }, { timing: 'true' }, { cursor: 'garbage' }, { binding: '{}' }]) refused(await f.get(`/v1/needs-you?${f.query(extra)}`), 400, 'invalid');
    for (const extra of [{ storeId: 'other' }, { source: f.beta.id }, { binding: JSON.stringify({ sourceId: f.alpha.id, verified: false }) }]) refused(await f.get(`/v1/needs-you?${f.query(extra)}`), 409, 'conflict');
    refused(await f.get('/v1/plans?needsYou=0'), 400, 'invalid');
    for (const query of ['needsYouTiming=1', 'needsYou=1&needsYouTiming=0', 'needsYou=1&needsYouTiming=true']) refused(await f.get(`/v1/plans?${query}`), 400, 'invalid');
    refused(await f.get('/v1/plans?needsYou=1&needsYouTiming=1&needsYouTiming=1'), 404, 'not-found');
    const bodyReply = await new Promise<{ status: number; value: unknown }>((resolve, reject) => {
      const req = httpRequest(f.base + path, { method: 'GET', headers: { authorization: `Bearer ${f.token}`, 'content-length': '1' } }, res => {
        let text = ''; res.setEncoding('utf8'); res.on('data', chunk => text += chunk); res.on('end', () => resolve({ status: res.statusCode!, value: JSON.parse(text) }));
      }); req.on('error', reject); req.end('x');
    }); refused(bodyReply, 400, 'body-not-allowed');
    f.store.bindReads(f.alpha.id, false); refused(await f.get(path), 409, 'conflict'); refused(await f.get('/v1/plans?needsYou=1'), 409, 'conflict');
    f.store.bindReads(f.alpha.id, true); f.store.db.exec('PRAGMA user_version=3'); refused(await f.get(path), 503, 'schema'); f.store.db.exec('PRAGMA user_version=2');
  } finally { await f.close(); }
});

test('held HTTP response keeps its original identity and continuation conflicts after context switch', async () => {
  const f = await fixture();
  try {
    f.seedPlan('plan-alpha', 'Alpha', ['a','b'].map(id => ({ id, title: id, kind: 'task', status: 'blocked' })));
    // Delay delivery at the response boundary, not computation or storage; no sleeps.
    const server = createProgressServer(f.store, 'held-fixture'); let release!: () => void; let arrived!: () => void;
    const reached = new Promise<void>(resolve => arrived = resolve), gate = new Promise<void>(resolve => release = resolve);
    server.prependListener('request', (_req, res) => { const end = res.end.bind(res); res.end = ((...args: any[]) => { arrived(); void gate.then(() => (end as any)(...args)); return res; }) as typeof res.end; });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    try {
      const pending = fetch(`http://127.0.0.1:${(server.address() as { port: number }).port}/v1/needs-you?${f.query({ limit: '1' })}`, { headers: { authorization: 'Bearer held-fixture' } });
      await reached; f.store.bindReads(f.beta.id, false); release();
      const reply = await pending; assert.equal(reply.status, 200); const value = await reply.json() as any;
      assert.deepEqual(value.sourceBinding, { sourceId: f.alpha.id, verified: true }); assert(value.nextCursor);
      refused(await f.get(`/v1/needs-you?${f.query({ limit: '1', cursor: value.nextCursor })}`), 409, 'conflict');
    } finally { release(); server.close(); await once(server, 'close'); }
  } finally { await f.close(); }
});

const baseline='4f582b7f3404088d01531598102833000c23cd87';
const route='/v1/plan?source=source-fixture&plan=P-attention';

test('V2 authenticated paged detail returns safe annotations with stable identity and no schema/history rewrite',async()=>{
  const f=await launchNeedsYouService();
  try {
    const schema=f.store.db.prepare('SELECT name,sql FROM sqlite_master ORDER BY name').all();
    const snapshots=f.store.db.prepare('SELECT source,plan,revision,snapshot FROM revisions ORDER BY source,plan,revision').all();
    const pages:(Envelope & PlanRead)[]=[];let cursor:string|null='0';
    do{const response=await f.request(`${route}&cursor=${cursor}`);assert.equal(response.status,200);const d=await response.json() as Envelope & PlanRead;pages.push(d);cursor=d.items.nextCursor ?? d.contributions.nextCursor;}while(cursor!==null);
    assert.equal(pages.length,2);const first=pages[0]!;
    assert.equal(pages[1]!.plan.revision,first.plan.revision);assert.equal(pages[1]!.storeId,first.storeId);assert.equal(first.sourceBinding.sourceId,'source-fixture');
    assert.equal(first.protocolVersion,2);assert.equal(first.schemaVersion,2);
    const items=pages.flatMap(p=>p.items.data);assert.equal(items.length,27);assert.equal(new Set(items.map(i=>i.id)).size,items.length);
    assert.equal(pages.flatMap(p=>p.contributions.data).length,25);
    for(const i of items.filter(i=>i.blocker)){assert.equal(i.blocker!.validAtRevision,first.plan.revision);assert.equal(i.blocker!.reportedRevision,1);assert.equal(i.blocker!.reporterSessionId,'M');}
    assert.equal(items.find(i=>i.id==='decision')!.assigneeSessionId,'C');assert.equal(items.find(i=>i.id==='decision')!.blocker?.reason,'Choose an output format');
    assert.equal(items.find(i=>i.id==='external')!.blocker?.reason,'<b>Awaiting sample input</b>');assert.equal(items.find(i=>i.id==='unknown')!.blocker,undefined);
    assert.equal(items.find(i=>i.id==='prerequisite-wait')!.status,'pending');assert.equal(Object.keys(first.blockedTiming!.items).length,6);assert.deepEqual(first.timing?.items,{});
    const lower=await(await f.request('/v1/plan?source=source-fixture&plan=P-lower')).json();assert.equal(lower.blockedTiming.items.decision.kind,'lower-bound');
    const unknown=await(await f.request('/v1/plan?source=source-fixture&plan=P-unknown')).json();assert.deepEqual(unknown.blockedTiming.items,{});
    assert.equal((await f.request(route,undefined,{headers:{}})).status,401);
    assert.equal((await f.request(route,undefined,{headers:{authorization:'Bearer wrong'}})).status,401);
    for(const query of ['source=source-other&plan=P-attention','source=source-fixture&plan=P-other']){
      const d=await(await f.request(`/v1/plan?${query}`)).json();assert.equal(d.items.data[0].blocker,undefined,'same task IDs do not borrow annotations');
    }
    const readonly=new Store(f.store.file,{readOnly:true});try{assert.equal(readonly.detail(f.source.id,'P-attention').items.data[1]!.blocker?.reason,'Choose an output format');}finally{readonly.close();}
    assert.deepEqual(f.store.db.prepare('SELECT name,sql FROM sqlite_master ORDER BY name').all(),schema);
    assert.deepEqual(f.store.db.prepare('SELECT source,plan,revision,snapshot FROM revisions ORDER BY source,plan,revision').all(),snapshots);
    assert.equal(f.store.db.prepare('PRAGMA user_version').get()!.user_version,2);
  } finally {await f.stop();}
});

test('V2 unmodified pinned baseline writer invalidates inherited text; current writer never recertifies it',async()=>{
  const f=await launchNeedsYouService();let legacy:Store|undefined;
  try {
    // Full shared source projection keeps every baseline import unmodified and
    // resolvable. Never replace old guards or splice in the current implementation.
    const root=`${f.root}/baseline`;
    const names=execFileSync('git',['ls-tree','-r','--name-only',baseline,'shared'],{encoding:'utf8'}).trim().split('\n');
    for(const name of names){const content=execFileSync('git',['show',`${baseline}:${name}`]);const file=`${root}/${name}`;mkdirSync(path.dirname(file),{recursive:true,mode:0o700});writeFileSync(file,content,{mode:0o600});assert.deepEqual(readFileSync(file),content);}
    const module=await import(pathToFileURL(`${root}/shared/store.ts`).href);legacy=new module.Store(f.store.file);
    const old=legacy!;
    old.apply({op:'start',plan:'P-legacy',oid:'legacy-start',rev:0,title:'Legacy report',items:[{id:'decision',title:'Legacy task',kind:'task',status:'blocked'}]},f.actor);
    const legacySnapshot=old.db.prepare('SELECT snapshot FROM plans WHERE source=? AND id=?').get(f.source.id,'P-legacy')!.snapshot;
    const legacyRead=await(await f.request('/v1/plan?source=source-fixture&plan=P-legacy')).json();assert.equal(legacyRead.items.data[0].blocker,undefined);assert.equal(legacyRead.schemaVersion,2);assert.equal(old.db.prepare('SELECT snapshot FROM plans WHERE source=? AND id=?').get(f.source.id,'P-legacy')!.snapshot,legacySnapshot,'old schema2 report read needs no rewrite');
    const read=async()=>await(await f.request(route)).json() as Envelope & PlanRead;
    const annotation=async()=>{const d=await read();return d.items.data.find(i=>i.id==='decision')!.blocker;};
    let oid=0;
    const oldApply=(r:Record<string,unknown>)=>old.apply({plan:'P-attention',oid:`old-${oid++}`,rev:f.store.get(f.source.id,'P-attention')!.revision,...r},f.actor);
    const report=()=>f.apply({op:'change',changes:[{id:'decision',status:'blocked',blocker:{reason:'Current safe summary'}}]});
    f.apply({op:'change',changes:[{id:'decision',status:'blocked',blocker:{reason:'Other source summary'}}]},{...f.actor,sourceId:'source-other'});
    for(const operation of [
      {op:'revise',title:'Legacy unrelated title'},
      {op:'change',changes:[{id:'task-0',status:'working'}]},
      {op:'change',changes:[{id:'decision',status:'blocked'}]},
      {op:'revise',items:[{id:'decision',title:'Legacy structure',kind:'task',status:'blocked'}]},
    ]){
      report();const valid=await annotation();assert.ok(valid);
      oldApply(operation);assert.equal(await annotation(),undefined);
      const raw=old.get(f.source.id,'P-attention')!;
      if(raw.items.find(i=>i.id==='decision')?.blocker) assert.notEqual(raw.items.find(i=>i.id==='decision')!.blocker!.validAtRevision,raw.revision,'old writer copied but did not advance marker');
      f.apply({op:'revise',title:'New neutral title'});assert.equal(await annotation(),undefined,'new writer must not recertify stale inherited text');
    }
    report();oldApply({op:'change',changes:[{id:'decision',status:'working'}]});oldApply({op:'change',changes:[{id:'decision',status:'blocked'}]});assert.equal(await annotation(),undefined,'old unblock/reblock cannot revive text');
    f.apply({op:'change',changes:[{id:'decision',status:'blocked'}]});assert.equal(await annotation(),undefined);
    report();assert.equal((await annotation())?.reason,'Current safe summary','explicit report restores known provenance');
    const other=f.store.detail('source-other','P-attention').items.data[0]!.blocker;assert.equal(other?.reason,'Other source summary');assert.equal(other?.validAtRevision,f.store.get('source-other','P-attention')!.revision);
    const schemas=old.db.prepare('PRAGMA user_version').get()!.user_version;assert.equal(schemas,2);
  } finally {legacy?.close();await f.stop();}
});

test('V2 malformed, stale and future optional annotation data is omitted without mutating snapshots',async()=>{
  const f=await launchNeedsYouService();
  try {
    const original=f.store.get(f.source.id,'P-attention')!;const b=original.items[1]!.blocker!;
    for(const bad of [{...b,validAtRevision:1},{...b,reportedRevision:0},{...b,reason:'x'.repeat(513)},{...b,nextAction:'a\0b'},{...b,category:'future'},{...b,reportedAt:'invalid'},{...b,reporterSessionId:'not a session'},{...b,extra:'ignored?'}]){
      const p=structuredClone(original);p.items[1]!.blocker=bad as any;const text=JSON.stringify(p);
      f.store.db.prepare('UPDATE plans SET snapshot=? WHERE source=? AND id=?').run(text,f.source.id,'P-attention');
      const d=await(await f.request(route)).json();assert.equal(d.items.data[1].blocker,undefined);
      assert.equal(f.store.db.prepare('SELECT snapshot FROM plans WHERE source=? AND id=?').get(f.source.id,'P-attention')!.snapshot,text);
    }
    f.apply({op:'revise',title:'No stale recertification'});assert.equal(f.store.get(f.source.id,'P-attention')!.items[1]!.blocker,undefined);
  } finally {await f.stop();}
});

test('V2 cleanup generations, active refusal, concurrent archive/restore/delete and stale writes preserve identity',async()=>{
  const f=await launchNeedsYouService();
  try {
    const before=f.store.get(f.source.id,'P-attention');assert.equal((await f.request('/v1/plan/archive',f.body('P-attention'))).status,409);assert.deepEqual(f.store.get(f.source.id,'P-attention'),before);
    const stale=f.body();const old=await(await f.request('/v1/plan?source=source-fixture&plan=P-finished')).json();
    const archive=await f.request('/v1/plan/archive',stale);assert.equal(archive.status,200);
    assert.equal((await f.request('/v1/plan/restore',f.body())).status,200);
    const restored=await(await f.request('/v1/plan?source=source-fixture&plan=P-finished')).json();assert.equal(restored.plan.revision,old.plan.revision);assert.equal(restored.plan.cleanup.revision,2);assert.equal(restored.plan.lifecycle,'finished');assert.deepEqual(restored.blockedTiming.items,{});
    assert.equal((await f.request('/v1/plan/archive',{...stale,oid:'stale-cleanup'})).status,409);
    const body=f.body();const [a,b]=await Promise.all([f.request('/v1/plan/archive',body),f.request('/v1/plan/delete',{...body,oid:'competing-delete',confirmed:true})]);
    assert.equal([a.status,b.status].filter(s=>s===200).length,1);assert.equal([a.status,b.status].filter(s=>s===409).length,1);
    if(a.ok)assert.equal((await f.request('/v1/plan/delete',{...f.body(),confirmed:true})).status,200);
    assert.equal((await f.request('/v1/plan?source=source-fixture&plan=P-finished')).status,404);assert.ok(f.store.get('source-other','P-attention'));
    const p=f.store.get(f.source.id,'P-attention')!;
    assert.throws(()=>f.store.apply({op:'change',plan:'P-attention',oid:'stale-report',rev:p.revision-1,changes:[{id:'decision',status:'blocked',blocker:{reason:'Stale'}}]},f.actor),{code:'conflict'});
    assert.deepEqual(f.store.get(f.source.id,'P-attention'),p);
  } finally {await f.stop();}
});
