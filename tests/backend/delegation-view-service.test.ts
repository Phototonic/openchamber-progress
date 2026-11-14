import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createProgressServer } from '../../service/server.ts';
import { delegationView } from '../../service/delegation-view.ts';
import { Store } from '../../shared/store.ts';
import { DELEGATION_VIEW_LIMITS as L, type DelegationView } from '../../shared/delegation-view.ts';
import { fixture, type makeFixture } from './subagent-test-support.ts';
import { searchFixture } from '../fixtures/plan-task-search.ts';

const key = { source: 'source-alpha', parent: 'A', message: 'message-a', call: 'call-a' };
const route = '/v1/plan?source=source-alpha&plan=plan-alpha';
type Fixture = Awaited<ReturnType<typeof makeFixture>>;
async function httpFixture(run: (f: Fixture & { get: (path: string, authorized?: boolean) => Promise<any>; inspect: () => Promise<DelegationView> }) => Promise<void>) {
  await fixture(async f => {
    const server = createProgressServer(f.store, 'synthetic-delegation-token');
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    async function get(path: string, authorized = true) {
      const response = await fetch(base + path, { headers: authorized ? { authorization: 'Bearer synthetic-delegation-token' } : {} });
      return { status: response.status, value: await response.json(), headers: response.headers };
    }
    async function inspect() {
      const list = await get('/v1/plans?source=source-alpha&delegationIntent=1'), detail = await get(route + '&delegationIntent=1');
      assert.equal(list.status, 200); assert.equal(detail.status, 200);
      const d = detail.value, overlay: DelegationView = d.delegationIntent;
      assert(overlay); assert.equal(overlay.token, list.value.data.find((p: any) => p.id === 'plan-alpha').delegationToken);
      assert(Buffer.byteLength(overlay.token) > 0 && Buffer.byteLength(overlay.token) <= 4096);
      assert.equal(overlay.storeId, d.storeId); assert.deepEqual(overlay.sourceBinding, d.sourceBinding);
      assert.equal(overlay.source, d.plan.sourceId); assert.equal(overlay.plan, d.plan.id);
      assert.equal(overlay.revision, d.plan.revision); assert.equal(overlay.structuralRevision, d.plan.structuralRevision);
      assert.deepEqual(overlay.cleanup, d.plan.cleanup ?? { state: 'visible', revision: 0 });
      return overlay;
    }
    try { await run({ ...f, get, inspect }); }
    finally { server.close(); await once(server, 'close'); }
  });
}
function disposition(view: DelegationView) {
  assert.equal(view.result.availability, 'ready');
  assert(view.result.availability === 'ready'); return view.result.disposition;
}

test('capability, opt-in, declaration/reservation/binding and independent tokens are read-only', async () => httpFixture(async f => {
  assert.equal((await f.get('/health')).value.delegationIntent, 1);
  assert.equal((await f.get(route)).value.delegationIntent, undefined);
  assert.equal((await f.get('/v1/plans')).value.data[0].delegationToken, undefined);
  const before = f.plan(), none = await f.inspect(); assert.equal(disposition(none).state, 'none');
  f.declare(); const pending = await f.inspect(), p = disposition(pending);
  assert.equal(p.state, 'pending'); assert(p.state === 'pending'); assert.equal(p.eligible, true);
  assert.equal(p.declaration.dispatch, null); assert.deepEqual(p.declaration.taskIds, ['task-1']);
  assert.equal(p.declaration.coordinatorSessionId, 'A'); assert.equal(p.declaration.declaredRevision, before.revision);
  assert.notEqual(pending.token, none.token); assert.deepEqual(f.plan(), before);
  f.store.beforeRun(key, f.actor(), 'subagent', {}, 1000);
  const reserved = await f.inspect(), r = disposition(reserved); assert.equal(r.state, 'reserved'); assert(r.state === 'reserved');
  assert.deepEqual(r.declaration.dispatch, { tool: 'subagent', messageId: key.message, callId: key.call });
  assert.notEqual(reserved.token, pending.token); assert.deepEqual(f.plan(), before);
  f.store.afterRun(key, 0, f.actor('C1'), 'returned');
  const bound = await f.inspect(), b = disposition(bound); assert.equal(b.state, 'bound'); assert(b.state === 'bound');
  assert.equal(b.childSessionId, 'C1'); assert.equal(b.boundRevision, f.plan().revision); assert.notEqual(bound.token, reserved.token);
  const schema = f.store.db.prepare('SELECT name,sql FROM sqlite_master ORDER BY name').all();
  const changes = f.store.db.prepare('SELECT total_changes() AS n').get();
  assert.equal((await f.inspect()).token, bound.token);
  const reader = new Store(f.store.file, { readOnly: true }); reader.bindReads(f.source.id, true);
  try {
    const detail = reader.detail(f.source.id, 'plan-alpha');
    assert.deepEqual(delegationView(reader, detail, detail.plan).view?.result, bound.result);
    assert.equal(reader.db.prepare('SELECT total_changes() AS n').get()!.n, 0);
  } finally { reader.close(); }
  assert.deepEqual(f.store.db.prepare('SELECT total_changes() AS n').get(), changes);
  assert.deepEqual(f.store.db.prepare('SELECT name,sql FROM sqlite_master ORDER BY name').all(), schema);
}));

test('cancel/redeclare changes tokens without progress and does not resurrect an old refusal', async () => httpFixture(async f => {
  const revision = f.plan().revision;
  f.declare(); const first = await f.inspect();
  f.declare(f.request({ oid: 'cancel', assign: [] }));
  const cancelled = await f.inspect(); assert.equal(disposition(cancelled).state, 'cancelled'); assert.notEqual(cancelled.token, first.token);
  f.declare(f.request({ oid: 'second' })); const pending = await f.inspect();
  assert.equal(disposition(pending).state, 'pending'); assert.notEqual(pending.token, cancelled.token);
  f.store.beforeRun(key, f.actor(), 'subagent', {}, 1000); f.store.afterRun(key, 0, undefined, 'unconfirmed');
  const refused = await f.inspect(); assert.equal(disposition(refused).state, 'refused'); assert.notEqual(refused.token, pending.token);
  f.declare(f.request({ oid: 'third' })); assert.equal(disposition(await f.inspect()).state, 'pending');
  assert.equal(f.plan().revision, revision); assert.equal(f.plan().items[0]!.assigneeSessionId, undefined);
}));

for (const change of ['unrelated', 'target', 'structure', 'missing-proof', 'closed', 'capture'] as const)
test(`waiting eligibility and freshness follow retained proof: ${change}`, async () => httpFixture(async f => {
  f.declare(); const pending = await f.inspect();
  if (change === 'unrelated' || change === 'target' || change === 'missing-proof') {
    f.store.apply({ op: 'change', plan: 'plan-alpha', oid: 'change', rev: 1, changes: [{ id: change === 'target' ? 'task-1' : 'task-2', status: 'working' }] }, f.actor());
    if (change === 'missing-proof') f.store.db.exec('DELETE FROM contributions WHERE revision=2');
  } else if (change === 'structure') f.store.apply({ op: 'revise', plan: 'plan-alpha', oid: 'structure', rev: 1, title: 'Changed structure' }, f.actor());
  else if (change === 'closed') f.store.apply({ op: 'finish', plan: 'plan-alpha', oid: 'close', rev: 1, outcome: 'cancelled' }, f.actor());
  else { f.store.setEnabled(false); f.store.setEnabled(true); }
  const changes = f.store.db.prepare('SELECT total_changes() AS n').get();
  const view = await f.inspect(), d = disposition(view);
  assert.notEqual(view.token, pending.token);
  assert.equal(d.state, change === 'unrelated' ? 'pending' : change === 'capture' ? 'invalidated' : 'refused');
  if (d.state === 'refused') { assert.equal(d.recovery, 'redeclare-or-link'); assert(['conflict','closed','structural-change','relevant-change','missing-proof'].includes(d.reason)); }
  assert.deepEqual(f.store.db.prepare('SELECT total_changes() AS n').get(), changes);
  if (change === 'target' || change === 'missing-proof') assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM runs_intents').get()!.n, 1, 'read refusal never consumes intent');
}));

for (const reason of ['relevant-change','conflict','structural-change','closed','assignment','source-unverified','unverified','incomplete-proof','missing-proof','budget','dispatch-unconfirmed','binding','parent-execution-ended','storage'] as const)
test(`retired receipt maps fixed refusal and recovery: ${reason}`, async () => httpFixture(async f => {
  f.declare(); f.store.beforeRun(key, f.actor(), 'subagent', {}, 1000); f.store.afterRun(key, 0, undefined, 'unconfirmed');
  f.store.db.prepare("UPDATE receipts SET receipt=json_set(receipt,'$.delegation.reason',?) WHERE oid='declare'").run(reason);
  const d = disposition(await f.inspect()); assert.equal(d.state, 'refused'); assert(d.state === 'refused');
  assert.equal(d.reason, ['dispatch-unconfirmed','binding','parent-execution-ended','storage'].includes(reason) ? 'unverified' : reason);
  assert.equal(d.recovery, 'redeclare-or-link');
}));

test('legacy/malformed/oversized receipts suppress older evidence; bounded window is not absence', async () => httpFixture(async f => {
  f.declare(); f.store.beforeRun(key, f.actor(), 'subagent', {}, 1000); f.store.afterRun(key, 0, undefined, 'unconfirmed');
  f.declare(f.request({ oid: 'new' }));
  const original = f.store.db.prepare("SELECT receipt FROM receipts WHERE oid='new'").get()!.receipt;
  for (const [alter, reason] of [
    ["json_remove(receipt,'$.delegation.declaration')", 'legacy'],
    ["json_set(receipt,'$.delegation.declaration.taskIds',json('[\"task-1\",\"task-1\"]'))", 'invalid'],
    ["json_set(receipt,'$.delegation.declaration.declaredRevision',999)", 'invalid'],
    ["json_set(receipt,'$.delegation.declaration.dispatch',json('{}'))", 'invalid'],
  ]) {
    f.store.db.prepare(`UPDATE receipts SET receipt=${alter} WHERE oid='new'`).run();
    const result = (await f.inspect()).result; assert.deepEqual(result, { availability: 'unavailable', complete: false, reason });
    f.store.db.prepare("UPDATE receipts SET receipt=? WHERE oid='new'").run(original!);
  }
  f.store.db.prepare("UPDATE receipts SET receipt=json_set(receipt,'$.padding',?) WHERE oid='new'").run('x'.repeat(17000));
  assert.deepEqual((await f.inspect()).result, { availability: 'unavailable', complete: false, reason: 'budget' });
  f.store.db.prepare("UPDATE receipts SET receipt=? WHERE oid='new'").run(original!);
  for (let n = 0; n <= L.receipts; n++) f.store.apply({ op: 'change', plan: 'plan-alpha', oid: `noise-${n}`, rev: n + 1, changes: [{ id: 'task-2', status: 'working' }] }, f.actor());
  assert.deepEqual((await f.inspect()).result, { availability: 'unavailable', complete: false, reason: 'budget' });
}));

test('source/coordinator isolation, list pages and strict first-detail opt-in', async () => httpFixture(async f => {
  f.seed('plan-beta', 'B'); f.declare();
  f.declare(f.request({ plan: 'plan-beta', oid: 'other' }), f.actor('B'));
  const normal = await f.get('/v1/plans?source=source-alpha&session=A');
  const extended = await f.get('/v1/plans?source=source-alpha&session=A&delegationIntent=1');
  assert.deepEqual(extended.value.data.map(({ delegationToken: _token, ...p }: any) => p), normal.value.data);
  const first = await f.get('/v1/plans?source=source-alpha&limit=1&delegationIntent=1');
  const next = await f.get(`/v1/plans?source=source-alpha&limit=1&cursor=${first.value.nextCursor}&delegationIntent=1`);
  assert(first.value.data[0].delegationToken); assert(next.value.data[0].delegationToken);
  const other = (await f.get('/v1/plan?source=source-alpha&plan=plan-beta&delegationIntent=1')).value.delegationIntent;
  const otherDisposition = disposition(other); assert.equal(otherDisposition.state, 'pending'); assert(otherDisposition.state === 'pending');
  assert.equal(otherDisposition.declaration.coordinatorSessionId, 'B');
  const foreign = { ...f.actor(), sourceId: 'source-beta' };
  f.store.registerSource({ id: foreign.sourceId, configRoot: '/synthetic/beta/config', dataRoot: '/synthetic/beta/data', verified: true });
  f.store.apply({ op: 'start', plan: 'plan-alpha', oid: 'foreign-start', rev: 0, title: 'Independent source', items: [{ id: 'task-1', title: 'Independent task', kind: 'task' }] }, foreign);
  f.store.bindReads(foreign.sourceId, true);
  f.store.declareDelegation({ ...f.request({ oid: 'foreign-declare' }), rev: 1 }, foreign);
  f.store.bindReads(f.source.id, true);
  const foreignDetail = await f.get('/v1/plan?source=source-beta&plan=plan-alpha&delegationIntent=1');
  assert.equal(foreignDetail.value.delegationIntent, undefined);
  const allSources = (await f.get('/v1/plans?delegationIntent=1')).value.data;
  assert(allSources.every((p: any) => typeof p.delegationToken === 'string' && p.delegationToken.length > 0));
  assert.notEqual(allSources.find((p: any) => p.sourceId === 'source-beta').delegationToken, allSources.find((p: any) => p.sourceId === 'source-alpha' && p.id === 'plan-alpha').delegationToken);
  assert.equal((await f.get(route + '&delegationIntent=1', false)).status, 401);
  for (const suffix of ['&delegationIntent=0','&delegationIntent=true','&delegationIntent=1&cursor=1']) assert.equal((await f.get(route + suffix)).status, 400);
  assert.equal((await f.get(route + '&delegationIntent=1&delegationIntent=1')).status, 404);
  f.store.bindReads(f.source.id, false);
  assert.equal((await f.get(route + '&delegationIntent=1')).value.delegationIntent, undefined);
  f.store.bindReads(f.source.id, true);
  f.store.setEnabled(false);
  assert.deepEqual((await f.inspect()).result, { availability: 'unavailable', complete: false, reason: 'capture-unavailable' });
}));

test('archive omits visible-only overlay; restore pins new cleanup generation; deletion gives no detail', async () => httpFixture(async f => {
  f.declare();
  f.store.apply({ op: 'change', plan: 'plan-alpha', oid: 'complete-tasks', rev: 1, changes: ['task-1','task-2'].map(id => ({ id, status: 'done' })) }, f.actor());
  f.store.apply({ op: 'finish', plan: 'plan-alpha', oid: 'finish', rev: 2, outcome: 'finished' }, f.actor());
  const closed = await f.inspect(); assert.equal(disposition(closed).state, 'refused');
  const request = { storeId: closed.storeId, source: f.source.id, plan: 'plan-alpha', rev: f.plan().revision, cleanupRev: 0, oid: 'archive' };
  f.store.cleanup('archive', request);
  const archived = await f.get(route + '&delegationIntent=1'); assert.equal(archived.status, 200); assert.equal(archived.value.delegationIntent, undefined);
  const archivedList = await f.get('/v1/plans?archived=only&delegationIntent=1');
  assert(archivedList.value.data[0].delegationToken); assert.notEqual(archivedList.value.data[0].delegationToken, closed.token);
  f.store.cleanup('restore', { ...request, oid: 'restore', cleanupRev: 1 });
  const restored = await f.inspect(); assert.deepEqual(restored.cleanup, { state: 'visible', revision: 2 }); assert.notEqual(restored.token, closed.token);
  f.store.cleanup('delete', { ...request, oid: 'delete', cleanupRev: 2, confirmed: true });
  assert.equal((await f.get(route + '&delegationIntent=1')).status, 404);
}));

test('missing run storage is explicit legacy, never empty or installed by an HTTP read', async () => {
  const f = searchFixture(false); f.seedPlan('plan-alpha', 'Example', [{ id: 'task-1', title: 'Example task', kind: 'task' }]);
  const server = createProgressServer(f.store, 'synthetic-legacy-token'); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const schema = f.store.db.prepare('SELECT name,sql FROM sqlite_master ORDER BY name').all();
    const response = await fetch(`http://127.0.0.1:${(server.address() as { port: number }).port}${route}&delegationIntent=1`, { headers: { authorization: 'Bearer synthetic-legacy-token' } });
    assert.equal(response.status, 200); const value = await response.json() as any;
    assert.deepEqual(value.delegationIntent.result, { availability: 'unavailable', complete: false, reason: 'legacy' });
    assert.deepEqual(f.store.db.prepare('SELECT name,sql FROM sqlite_master ORDER BY name').all(), schema);
  } finally { server.close(); await once(server, 'close'); f.cleanup(); }
});

test('concurrently changed plan identity refuses projection rather than mixing snapshots', async () => httpFixture(async f => {
  f.declare(); const detail = f.store.detail(f.source.id, 'plan-alpha');
  f.store.apply({ op: 'change', plan: 'plan-alpha', oid: 'after-detail', rev: 1, changes: [{ id: 'task-2', status: 'working' }] }, f.actor());
  assert.throws(() => delegationView(f.store, detail, detail.plan), { code: 'conflict' });
  const current = await f.inspect(); assert.equal(current.revision, 2); assert.equal(disposition(current).state, 'pending');
}));

test('held reply retains original identity and the next source binding retires overlay', async () => httpFixture(async f => {
  f.declare();
  const server = createProgressServer(f.store, 'synthetic-held-token');
  let release!: () => void, arrived!: () => void;
  const gate = new Promise<void>(resolve => release = resolve), reached = new Promise<void>(resolve => arrived = resolve);
  server.prependListener('request', (_req, res) => { const end = res.end.bind(res); res.end = ((...args: any[]) => { arrived(); void gate.then(() => (end as any)(...args)); return res; }) as typeof res.end; });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const pending = fetch(`http://127.0.0.1:${(server.address() as { port: number }).port}${route}&delegationIntent=1`, { headers: { authorization: 'Bearer synthetic-held-token' } });
    await reached; f.store.bindReads(f.source.id, false); release();
    const d = await (await pending).json() as any;
    assert.deepEqual(d.delegationIntent.sourceBinding, d.sourceBinding); assert.equal(disposition(d.delegationIntent).state, 'pending');
    assert.equal((await f.get(route + '&delegationIntent=1')).value.delegationIntent, undefined);
  } finally { release(); server.close(); await once(server, 'close'); }
}));
