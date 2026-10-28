// V4 (units): production change-digest parser over REAL backend DTOs (Store.changeDigest), the
// device checkpoint protocol over a synthetic SDK device namespace, and the digest text rules.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { digestQuery, parseChangeDigest, parseHealth } from '../../ui/shared/adapter.ts';
import { canonicalIdentity, checkpointKey, CheckpointStore, contextHash, sha256Hex, type CheckpointIdentity } from '../../ui/shared/change-digest-checkpoint.ts';
import { countsText, coverageText, groupTasks, referenceText, scopeLines } from '../../ui/shared/change-digest-view.ts';
import { readChangeDigest } from '../../ui/shared/source.ts';
import type { DigestRequest } from '../../ui/shared/model.ts';
import { digestFixture, digestItems } from '../fixtures/change-digests.ts';
import { HEALTH } from './fixtures.ts';
import { Device } from './change-digests-fixture.ts';

function real(after: number | undefined, to: number, mutate?: (f: ReturnType<typeof digestFixture>) => void) {
  const f = digestFixture(); f.throughSix(); mutate?.(f);
  try {
    const request: DigestRequest = { storeId: f.storeId, source: f.source.id, plan: 'P-digest', to, cleanupRev: 0, after: after ?? null };
    return { request, body: JSON.stringify(f.read(after, to)) };
  } finally { f.cleanup(); }
}

test('capability is explicit: absent or malformed planChangeDigests is unavailable, never an empty digest', () => {
  for (const planChangeDigests of [undefined, 0, true, '1', 2]) assert.equal(parseHealth(JSON.stringify({ ...HEALTH, planChangeDigests })).planChangeDigests, undefined);
  assert.equal(parseHealth(JSON.stringify({ ...HEALTH, planChangeDigests: 1 })).planChangeDigests, 1);
});

test('real comparison DTO parses with pinned identity; query carries exactly the frozen fields', () => {
  const { request, body } = real(1, 6);
  const d = parseChangeDigest(body, request);
  assert.equal(d.availability, 'comparison'); assert.equal(d.complete, true); assert.equal(d.interval.to, 6); assert.equal(d.interval.after, 1);
  assert.deepEqual([d.summary.events.blocked, d.summary.events.unblocked, d.summary.events.completed, d.summary.events.added], [1, 1, 1, 1]);
  assert.deepEqual(d.counts.before, { done: 1, total: 2, remaining: 1, skipped: 1 }); assert.deepEqual(d.counts.after, { done: 2, total: 3, remaining: 1, skipped: 1 });
  assert.equal(d.interval.currentLifecycle, 'active');
  assert.deepEqual(Object.keys(digestQuery(request)!).sort(), ['after', 'cleanupRev', 'plan', 'source', 'storeId', 'to']);
  assert.deepEqual(Object.keys(digestQuery({ ...request, after: null })!).sort(), ['cleanupRev', 'plan', 'source', 'storeId', 'to']);
  const initial = real(undefined, 6);
  assert.equal(parseChangeDigest(initial.body, initial.request).availability, 'initial');
});

test('mismatched store, source, plan, target, baseline or cleanup and malformed coverage are refused', () => {
  const { request, body } = real(1, 6);
  for (const patch of [{ storeId: 'other' }, { source: 'other' }, { plan: 'P-other' }, { to: 5 }, { after: 2 }, { after: null }, { cleanupRev: 1 }] as Partial<DigestRequest>[]) {
    assert.throws(() => parseChangeDigest(body, { ...request, ...patch }), Error, JSON.stringify(patch));
  }
  const v = JSON.parse(body);
  const broken: [string, (x: any) => void][] = [
    ['protocol', (x) => { x.protocolVersion = 3; }],
    ['coverage outside interval', (x) => { x.interval.coverageStart = 0; }],
    ['coverage end', (x) => { x.interval.coverageEnd = 5; }],
    ['unknown availability', (x) => { x.availability = 'maybe'; }],
    ['unknown reason', (x) => { x.reasons = ['other']; }],
    ['comparison without baseline counts', (x) => { x.counts.before = null; }],
    ['inconsistent counts', (x) => { x.counts.after.done = 9; }],
    ['events missing facet', (x) => { delete x.summary.events.revised; }],
    ['unit', (x) => { x.summary.unit = 'tasks'; }],
    ['non-adjacent reference', (x) => { x.tasks[0].references[0].to += 1; }],
    ['row beyond target', (x) => { x.tasks[0].latestRevision = 7; }],
    ['duplicate row', (x) => { x.tasks.push(x.tasks[0]); }],
    ['target flag', (x) => { x.validTarget = false; }],
    ['binding shape', (x) => { x.sourceBinding = { sourceId: 1, verified: true }; }],
    ['cleanup state', (x) => { x.cleanup.state = 'deleted'; }],
  ];
  for (const [name, mutate] of broken) { const x = structuredClone(v); mutate(x); assert.throws(() => parseChangeDigest(JSON.stringify(x), request), Error, name); }
});

test('initial, baseline-unavailable and target-unavailable stay distinct; unknown history is never zero', () => {
  const missingBaseline = real(1, 6, (f) => { f.store.db.prepare('DELETE FROM contributions WHERE revision=1').run(); f.store.db.prepare('DELETE FROM revisions WHERE revision=1').run(); });
  const b = parseChangeDigest(missingBaseline.body, missingBaseline.request);
  assert.equal(b.availability, 'baseline-unavailable'); assert.equal(b.counts.before, null); assert.equal(b.complete, false);
  assert.match(coverageText(b).join(' '), /Revision 1 can’t be read any more, so totals can’t be compared/);
  assert.doesNotMatch(coverageText(b).join(' '), /Initial view/);
  const gap = real(1, 6, (f) => { f.store.db.prepare('DELETE FROM contributions WHERE revision=3').run(); f.store.db.prepare('DELETE FROM revisions WHERE revision=3').run(); });
  const g = parseChangeDigest(gap.body, gap.request);
  assert.equal(g.availability, 'comparison'); assert.equal(g.complete, false); assert.ok(g.reasons.includes('missing-snapshot'));
  assert.match(coverageText(g).join(' '), /Only revisions \d–6 could be compared .*The totals still compare revisions 1 and 6/);
  const target = real(1, 6, (f) => { f.store.db.prepare('DELETE FROM contributions WHERE revision=6').run(); f.store.db.prepare('DELETE FROM revisions WHERE revision=6').run(); });
  const t = parseChangeDigest(target.body, target.request);
  assert.equal(t.availability, 'target-unavailable'); assert.equal(t.validTarget, false);
  assert.match(coverageText(t)[0], /can’t be read, so its changes can’t be shown or marked reviewed/);
  const initial = real(undefined, 6);
  assert.deepEqual(coverageText(parseChangeDigest(initial.body, initial.request)), ['Initial view — no saved reviewed revision in this profile.', 'Showing revision 6. Mark reviewed to compare later changes against it.']);
});

test('older service (404) and capability-less reads classify as failures, not empty comparisons', async () => {
  const { request } = real(1, 6);
  const r = await readChangeDigest({ serviceRequest: async () => ({ status: 404, body: '{"error":"not-found"}' }) }, request);
  assert.equal(r.ok, false); assert.equal(!r.ok && r.status, 404);
  const c = await readChangeDigest({ serviceRequest: async () => ({ status: 409, body: '{"error":"conflict"}' }) }, request);
  assert.equal(!c.ok && c.status, 409);
});

test('scope explanation keeps denominators apart from completion; zero total has no percentage', () => {
  assert.equal(countsText({ done: 1, total: 2, remaining: 1, skipped: 0 }), '1/2 done (50%)');
  assert.equal(countsText({ done: 1, total: 3, remaining: 2, skipped: 0 }), '1/3 done (33%)');
  assert.equal(countsText({ done: 0, total: 0, remaining: 0, skipped: 2 }), 'no counted tasks (2 skipped), no percentage');
  const s = { addedCounted: 1, removedCounted: 0, skipped: 0, unskipped: 0, addedDone: 0, removedDone: 0, completed: 0, reopened: 0 };
  assert.deepEqual(scopeLines({ done: 1, total: 2, remaining: 1, skipped: 0 }, { done: 1, total: 3, remaining: 2, skipped: 0 }, s), { scope: ['1 counted task added'], done: ['completed count unchanged'] });
  const { request, body } = real(1, 6);
  const d = parseChangeDigest(body, request);
  assert.deepEqual(scopeLines(d.counts.before!, d.counts.after!, d.counts.scope!), { scope: ['1 counted task added'], done: ['1 existing task now done'] });
  // B: reported blocked then cleared then completed is ONE row with all facets, grouped as a blocker.
  const groups = groupTasks(d.tasks);
  assert.equal(groups.find((x) => x.id === 'blockers')!.tasks[0].id, 'B');
  assert.equal(groups.find((x) => x.id === 'added')!.tasks[0].id, 'D');
  assert.match(referenceText(d.tasks.find((t) => t.id === 'B')!.references.at(-1)!), /^Reported blocked\. Status In progress → Blocked\.$/);
});

test('recorded detail of added and removed tasks keeps the recorded group and prerequisites', () => {
  const facts = { title: 'Publish build', status: 'blocked' as const, parentId: 'G-release', dependencies: ['T-build', 'T-sign'] };
  const removed = referenceText({ from: 4, to: 5, reportedAt: '2026-10-27T09:00:00.000Z', facets: ['removed'], before: facts, after: null });
  assert.equal(removed, 'Removed. Last recorded as “Publish build” (Blocked). Group G-release. Prerequisites T-build, T-sign.');
  const added = referenceText({ from: 1, to: 2, reportedAt: '2026-10-27T09:00:00.000Z', facets: ['added', 'blocked'], before: null, after: facts });
  assert.equal(added, 'Added, Reported blocked. Recorded as “Publish build” (Blocked). Group G-release. Prerequisites T-build, T-sign.');
  // No group and no prerequisites recorded: nothing invented.
  assert.equal(referenceText({ from: 1, to: 2, reportedAt: '2026-10-27T09:00:00.000Z', facets: ['added'], before: null, after: { ...facts, status: 'pending', parentId: null, dependencies: [] } }), 'Added. Recorded as “Publish build” (Pending).');
  // A real removed grouped task with prerequisites, through the actual backend and parser.
  const { request, body } = real(7, 8, (f) => {
    f.revise([...digestItems.map((i) => (i.id === 'B' ? { ...i, status: 'done' as const } : i)), { id: 'D', title: 'Added task', kind: 'task' }, { id: 'E', title: 'Grouped follow-up', kind: 'task', parentId: 'G', dependencies: ['A', 'D'] }]);
    f.revise([...digestItems.map((i) => (i.id === 'B' ? { ...i, status: 'done' as const } : i)), { id: 'D', title: 'Added task', kind: 'task' }]);
  });
  const d = parseChangeDigest(body, request);
  const e = d.tasks.find((t) => t.id === 'E')!;
  assert.equal(e.presentAtTarget, false);
  assert.equal(referenceText(e.references[0]), 'Removed. Last recorded as “Grouped follow-up” (Pending). Group G. Prerequisites A, D.');
});

// ---------------------------------------------------------------- checkpoint protocol

const ID: CheckpointIdentity = { integrationAccount: 'account-example', storeId: 'store-example', binding: { sourceId: 'source-example', verified: true }, source: 'source-example', plan: 'P-example' };
const store = (device: Device, supported = true) => new CheckpointStore(device.storage() as never, () => supported);

test('keys are bounded, versioned and revision-addressed; values hold version, identity and revision only', async () => {
  assert.equal(sha256Hex('abc'), createHash('sha256').update('abc').digest('hex'));
  const long = 'x'.repeat(5000) + '計画';
  assert.equal(sha256Hex(long), createHash('sha256').update(long).digest('hex'));
  const key = checkpointKey({ ...ID, plan: 'P'.repeat(128), integrationAccount: 'a'.repeat(512) }, Number.MAX_SAFE_INTEGER);
  assert.ok(key.length <= 128, String(key.length));
  const d = new Device(); const s = store(d);
  assert.deepEqual(await s.read(ID), { state: 'absent' });
  assert.deepEqual(await s.write(ID, 8), { ok: true });
  assert.deepEqual([...d.map.keys()], [checkpointKey(ID, 8)]);
  assert.deepEqual(d.map.get(checkpointKey(ID, 8)), { v: 1, id: canonicalIdentity(ID), revision: 8 });
  assert.deepEqual(await s.read(ID), { state: 'saved', revision: 8 });
  assert.equal(d.instance.length, 0, 'never instance storage');
});

test('the integration-account name preserves version-1 markers and older writes cannot rewind them', async () => {
  // Frozen stored representation, independent of the production serializer. This value is an
  // integration label, not proof that the people using the profile are different users.
  const legacyIdentity = '["agent-progress.review",1,"account-example","store-example","source-example",true,"source-example","P-example"]';
  const legacyPrefix = `rv1.${createHash('sha256').update(legacyIdentity).digest('hex')}`;
  const d = new Device(); const s = store(d);
  const legacyValue = { v: 1, id: legacyIdentity, revision: 8 };
  d.map.set(`${legacyPrefix}.8`, legacyValue);
  assert.equal(canonicalIdentity(ID), legacyIdentity);
  assert.deepEqual(await s.read(ID), { state: 'saved', revision: 8 });
  assert.deepEqual(await s.write(ID, 10), { ok: true });
  assert.deepEqual(d.map.get(`${legacyPrefix}.10`), { v: 1, id: legacyIdentity, revision: 10 });
  // An older frame can finish a previously dispatched write after the newer frame.
  d.map.set(`${legacyPrefix}.8`, legacyValue);
  assert.deepEqual(await s.read(ID), { state: 'saved', revision: 10 });
});

test('identity partitioning: integration account (incl. absent sentinel), store, binding, source, plan and device namespace never cross', async () => {
  const d = new Device(); const s = store(d);
  await s.write(ID, 10);
  const others: CheckpointIdentity[] = [
    { ...ID, integrationAccount: 'account-other' }, { ...ID, integrationAccount: null }, { ...ID, storeId: 'store-other' },
    { ...ID, binding: { sourceId: 'source-other', verified: true } }, { ...ID, binding: { sourceId: 'source-example', verified: false } }, { ...ID, binding: { sourceId: null, verified: false } },
    { ...ID, source: 'source-other' }, { ...ID, plan: 'P-other' },
  ];
  for (const o of others) { assert.notEqual(contextHash(o), contextHash(ID)); assert.deepEqual(await s.read(o), { state: 'absent' }, JSON.stringify(o)); }
  assert.equal(contextHash({ ...ID, integrationAccount: '' }), contextHash({ ...ID, integrationAccount: null }), 'empty integration account uses the explicit absent sentinel');
  assert.deepEqual(await store(new Device()).read(ID), { state: 'absent' }, 'another installation/device namespace');
  // A colliding key with another identity's value is malformed, never adopted.
  d.map.set(checkpointKey(ID, 11), { v: 1, id: canonicalIdentity({ ...ID, plan: 'P-other' }), revision: 11 });
  assert.deepEqual(await s.read(ID), { state: 'unavailable', reason: 'malformed' });
});

test('two windows interleave revisions 8 and 10 in both orders and across crash gaps: reopening reads 10, never 8', async () => {
  // Order A: 10 completes first, the held older write of 8 lands afterwards.
  {
    const d = new Device(); const a = store(d), b = store(d);
    const release = d.hold('set', /\.8$/);
    const old = a.write(ID, 8);
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(await b.write(ID, 10), { ok: true });
    release(); assert.deepEqual(await old, { ok: true });
    assert.deepEqual(await store(d).read(ID), { state: 'saved', revision: 10 });
    assert.ok(d.map.has(checkpointKey(ID, 10)), 'compaction of 8 never deletes the newer key');
  }
  // Order B: 8 then 10; compaction leaves only 10.
  {
    const d = new Device();
    await store(d).write(ID, 8); await store(d).write(ID, 10);
    assert.deepEqual([...d.map.keys()], [checkpointKey(ID, 10)]);
    assert.deepEqual(await store(d).read(ID), { state: 'saved', revision: 10 });
  }
  // Crash gap: 10 recorded, compaction fails; redundant 8 remains inert.
  {
    const d = new Device();
    await store(d).write(ID, 8); d.fail('delete', 'HOST_UNAVAILABLE');
    assert.deepEqual(await store(d).write(ID, 10), { ok: true });
    assert.equal(d.map.size, 2);
    assert.deepEqual(await store(d).read(ID), { state: 'saved', revision: 10 });
  }
  // Same target concurrently: idempotent single key and value.
  {
    const d = new Device(); const r1 = d.hold('set'); const r2 = d.hold('set');
    const w1 = store(d).write(ID, 10), w2 = store(d).write(ID, 10);
    await new Promise((r) => setImmediate(r)); r1(); r2();
    assert.deepEqual(await Promise.all([w1, w2]), [{ ok: true }, { ok: true }]);
    assert.deepEqual([...d.map.keys()], [checkpointKey(ID, 10)]);
  }
  // Compaction never touches another context or an unknown format.
  {
    const d = new Device(); const other = { ...ID, plan: 'P-other' };
    d.map.set('rail-plan:session-example', 'P-example'); d.map.set('rv2.future.1', {});
    await store(d).write(other, 3); await store(d).write(ID, 4); await store(d).write(ID, 5);
    assert.deepEqual([...d.map.keys()].sort(), [checkpointKey(other, 3), checkpointKey(ID, 5), 'rail-plan:session-example', 'rv2.future.1'].sort());
  }
});

test('failures are unavailable, never absent; failed writes keep the prior acknowledgement', async () => {
  assert.deepEqual(await store(new Device(), false).read(ID), { state: 'unavailable', reason: 'unsupported' });
  const unsupported = new Device(); assert.deepEqual(await store(unsupported, false).write(ID, 3), { ok: false, reason: 'unsupported' }); assert.equal(unsupported.log.length, 0);
  const denied = new Device(); denied.fail('keys', 'DENIED'); assert.deepEqual(await store(denied).read(ID), { state: 'unavailable', reason: 'denied' });
  const sdk = new Device(); sdk.fail('keys', 'UNSUPPORTED'); assert.deepEqual(await store(sdk).read(ID), { state: 'unavailable', reason: 'unsupported' });
  const full = new Device(); await store(full).write(ID, 4);
  for (let i = 0; full.map.size < 2000; i++) full.map.set(`other-${i}`, 1);
  assert.deepEqual(await store(full).write(ID, 9), { ok: false, reason: 'quota' });
  assert.deepEqual(await store(full).read(ID), { state: 'saved', revision: 4 }, 'quota preserves the old baseline; nothing evicted');
  assert.equal(full.map.size, 2000);
  const bad = new Device(); await store(bad).write(ID, 4); bad.map.set(checkpointKey(ID, 6), { v: 1, id: canonicalIdentity(ID), revision: 6, title: 'leaked' });
  assert.deepEqual(await store(bad).read(ID), { state: 'unavailable', reason: 'malformed' }, 'malformed highest record is not skipped');
  const many = new Device(); for (let i = 0; i < 2001; i++) many.map.set(`k${i}`, 1);
  assert.deepEqual(await store(many).read(ID), { state: 'unavailable', reason: 'failed' }, 'key list beyond the SDK bound is not trusted');
});

test('a highest key removed between keys() and get() permits one bounded reread', async () => {
  const d = new Device(); const s = store(d);
  await s.write(ID, 5); d.map.set(checkpointKey(ID, 9), { v: 1, id: canonicalIdentity(ID), revision: 9 });
  const release = d.hold('get', /\.9$/);
  const pending = s.read(ID);
  await new Promise((r) => setImmediate(r));
  d.map.delete(checkpointKey(ID, 9)); release();
  assert.deepEqual(await pending, { state: 'saved', revision: 5 });
  // Persistent disagreement (the highest key keeps vanishing) is unavailable, not zero or a loop.
  const p = new Device();
  p.map.set(checkpointKey(ID, 9), { v: 1, id: canonicalIdentity(ID), revision: 9 });
  const flaky = p.storage(); let gets = 0;
  const shim = { ...flaky, get: async () => { gets++; return undefined; } };
  assert.deepEqual(await new CheckpointStore(shim as never, () => true).read(ID), { state: 'unavailable', reason: 'disagreement' });
  assert.equal(gets, 2);
});

test('forget removes only this context’s markers', async () => {
  const d = new Device(); const s = store(d);
  await s.write(ID, 3); await s.write({ ...ID, plan: 'P-other' }, 7);
  await s.forget(ID);
  assert.deepEqual(await s.read(ID), { state: 'absent' });
  assert.deepEqual(await s.read({ ...ID, plan: 'P-other' }), { state: 'saved', revision: 7 });
});
