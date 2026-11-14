import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { needsYou } from '../../service/needs-you.ts';
import { Store } from '../../shared/store.ts';
import { NEEDS_YOU_LIMITS as L, type NeedsYouRequest, type NeedsYouWindow } from '../../shared/needs-you.ts';
import { searchFixture } from '../fixtures/plan-task-search.ts';

function request(f: ReturnType<typeof searchFixture>, extra: Partial<NeedsYouRequest> = {}): NeedsYouRequest {
  return { storeId: f.storeId, binding: { sourceId: f.alpha.id, verified: true }, source: f.alpha.id, ...extra };
}
function bounds(w: NeedsYouWindow) {
  assert(w.work.planSlots <= L.plans); assert(w.work.inputBytes <= L.inputBytes); assert(w.rows.length <= L.rows);
  assert.equal(w.work.outputBytes, Buffer.byteLength(JSON.stringify(w))); assert(w.work.outputBytes <= L.responseBytes);
  assert.equal(w.coverage.exhausted, w.nextCursor === null); assert.equal(w.coverage.complete, w.coverage.exhausted && !w.coverage.gapped);
  assert(w.rows.every(r => r.ancestors.length <= L.ancestors));
}
test('inbox classifies only active reported blocked tasks, source-scoped and literal', () => {
  const f = searchFixture(false);
  try {
    f.seedPlan('plan-alpha', 'Alpha', [
      { id: 'G', title: 'Context', kind: 'group', status: 'blocked' },
      ...['decision','review','dependency','external','other','absent'].map(id => ({ id, title: id, kind: 'task' as const, status: 'blocked' as const, parentId: 'G' })),
      { id: 'pending', title: 'Waiting dependency is not blocked', kind: 'task', dependencies: ['decision'] },
    ]);
    f.apply('plan-alpha', { op: 'change', changes: ['decision','review','dependency','external','other'].map(id => ({ id, status: 'blocked', blocker: { category: id, reason: 'Choose <one> & keep text literal' } })) });
    f.seedPlan('plan-beta', 'Beta', [{ id: 'decision', title: 'Review', kind: 'task', status: 'blocked' }], { ...f.actor, sessionId: 'other-session', directory: '/fixture/other' });
    f.apply('plan-beta', { op: 'change', changes: [{ id: 'decision', status: 'blocked', blocker: { category: 'review' } }] }, { ...f.actor, sessionId: 'other-session', directory: '/fixture/other' });
    f.seedPlan('plan-alpha', 'Collision', [{ id: 'decision', title: 'Other source', kind: 'task', status: 'blocked' }], { ...f.actor, sourceId: f.beta.id });
    f.seedPlan('closed', 'Closed', [{ id: 'decision', title: 'No longer active', kind: 'task', status: 'blocked' }]);
    f.apply('closed', { op: 'finish', outcome: 'cancelled' });
    const w = needsYou(f.store, request(f)); bounds(w);
    assert.deepEqual(w.counts, { needsYou: 3, alsoBlocked: 4 }); assert(w.coverage.complete);
    assert(w.rows.every(r => r.source === f.alpha.id && r.plan !== 'closed'));
    assert.equal(w.rows[0].blocker.state, 'reported');
    if (w.rows[0].blocker.state === 'reported') assert.equal(w.rows[0].blocker.annotation.reason, 'Choose <one> & keep text literal');
    assert.deepEqual(w.rows[0].ancestors, [{ id: 'G', title: 'Context' }]); assert(w.rows.every(r => !r.timing));
    f.apply('plan-alpha', { op: 'change', changes: [{ id: 'decision', status: 'done' }] });
    assert.equal(needsYou(f.store, request(f)).counts.needsYou, 2);
    f.apply('plan-beta', { op: 'revise', items: [] }, { ...f.actor, sessionId: 'other-session', directory: '/fixture/other' });
    assert.equal(needsYou(f.store, request(f)).counts.needsYou, 1);
  } finally { f.cleanup(); }
});

test('future, absent and invalid annotations are honest Also blocked; malformed text never escapes', () => {
  const f = searchFixture(false);
  try {
    f.seedPlan('P', 'Plan', ['future','invalid','absent','stale'].map(id => ({ id, title: id, kind: 'task', status: 'blocked' })));
    f.apply('P', { op: 'change', changes: ['future','invalid','stale'].map(id => ({ id, status: 'blocked', blocker: { category: 'decision', reason: 'Safe literal' } })) });
    const p = f.store.get(f.alpha.id, 'P')!;
    (p.items[0].blocker as any).category = 'future-category';
    (p.items[1].blocker as any).reason = 'unsafe\0text';
    p.items[3].blocker!.validAtRevision--;
    f.store.db.prepare('UPDATE plans SET snapshot=? WHERE source=? AND id=?').run(JSON.stringify(p), f.alpha.id, 'P');
    const w = needsYou(f.store, request(f)); assert.deepEqual(w.counts, { needsYou: 0, alsoBlocked: 4 });
    assert.equal(w.rows[0].blocker.state, 'reported');
    if (w.rows[0].blocker.state === 'reported') assert.equal(w.rows[0].blocker.annotation.category, 'unclassified');
    assert.deepEqual(w.rows.slice(1).map(r => r.blocker.state), ['invalid','absent','invalid']);
    assert(!JSON.stringify(w).includes('unsafe')); assert(!JSON.stringify(w).includes('future-category'));
  } finally { f.cleanup(); }
});

test('keyset continuation reaches >64 plans and >50 hits, with cumulative once-per-task counts', () => {
  const f = searchFixture(false);
  try {
    for (let i = 0; i < 70; i++) f.seedPlan(`P-${String(i).padStart(3, '0')}`, 'Empty', []);
    f.seedPlan('Z-dense', 'Dense', Array.from({ length: 151 }, (_, n) => ({ id: `T${n}`, title: 'Blocked', kind: 'task', status: 'blocked' })));
    let c: string | undefined; const windows: NeedsYouWindow[] = [];
    do { const w = needsYou(f.store, request(f, { cursor: c })); bounds(w); windows.push(w); c = w.nextCursor ?? undefined; assert(windows.length < 10); } while (c);
    assert.equal(windows[0].rows.length, 0); assert(!windows[0].coverage.complete); assert.equal(windows[0].work.planSlots, 64);
    assert.equal(windows.flatMap(w => w.rows).length, 151);
    assert.equal(new Set(windows.flatMap(w => w.rows).map(r => `${r.source}/${r.plan}/${r.task.id}`)).size, 151);
    assert.deepEqual(windows.at(-1)!.counts, { needsYou: 0, alsoBlocked: 151 }); assert(windows.at(-1)!.coverage.complete);
    const dense = needsYou(f.store, request(f, { cursor: windows[0].nextCursor! }));
    f.apply('Z-dense', { op: 'change', changes: [{ id: 'T150', status: 'done' }] });
    assert.throws(() => needsYou(f.store, request(f, { cursor: dense.nextCursor! })), /conflict/);
    assert.throws(() => needsYou(f.store, request(f, { cursor: dense.nextCursor!, limit: 1 })), /conflict/);
  } finally { f.cleanup(); }
});

test('bounded invalid/oversized gaps persist through continuation; read-only reads write neither data nor schema', () => {
  const f = searchFixture(false);
  try {
    f.seedPlan('A-invalid', 'Invalid', []); f.seedPlan('B-large', 'Large', []);
    f.store.db.prepare("UPDATE plans SET snapshot=json_set(snapshot,'$.items',json('[{}]')) WHERE id='A-invalid'").run();
    f.store.db.prepare("UPDATE plans SET snapshot=json_set(snapshot,'$.padding',?) WHERE id='B-large'").run('x'.repeat(L.inputBytes));
    for (let i = 0; i < 65; i++) f.seedPlan(`C-${i}`, 'Empty', []);
    const before = readFileSync(f.store.file), schema = f.store.db.prepare('SELECT * FROM sqlite_master ORDER BY name').all();
    const ro = new Store(f.store.file, { readOnly: true }); ro.bindReads(f.alpha.id, true);
    try {
      const a = needsYou(ro, request(f)); bounds(a); assert.equal(a.coverage.skippedRecords, 2); assert(!a.coverage.exhausted);
      const b = needsYou(ro, request(f, { cursor: a.nextCursor! })); bounds(b); assert(b.coverage.exhausted); assert(!b.coverage.complete);
      assert.deepEqual(b.coverage.reasons, ['invalid-snapshot','oversized-snapshot']); assert.equal(b.coverage.skippedRecords, 2);
      assert.deepEqual(b.counts, { needsYou: 0, alsoBlocked: 0 });
    } finally { ro.close(); }
    assert.deepEqual(readFileSync(f.store.file), before); assert.deepEqual(f.store.db.prepare('SELECT * FROM sqlite_master ORDER BY name').all(), schema);
  } finally { f.cleanup(); }
});

test('empty is complete, capture-off is reported-only, and identity/binding failures never become empty', () => {
  const f = searchFixture(false);
  try {
    const empty = needsYou(f.store, request(f)); bounds(empty); assert(empty.coverage.complete); assert.equal(empty.rows.length, 0);
    f.store.setEnabled(false); assert.equal(needsYou(f.store, request(f)).captureEnabled, false);
    for (const change of [{ storeId: 'other' }, { source: f.beta.id }, { binding: { sourceId: f.alpha.id, verified: false } }]) assert.throws(() => needsYou(f.store, request(f, change)), /conflict/);
    for (const change of [{ limit: 0 }, { limit: 51 }, { cursor: 'garbage' }]) assert.throws(() => needsYou(f.store, request(f, change)), /invalid/);
    f.store.bindReads(f.alpha.id, false); assert.throws(() => needsYou(f.store, request(f)), /conflict/);
  } finally { f.cleanup(); }
});

test('byte-limited input and output windows retain all eligible tasks and bounded ancestor context', () => {
  const f = searchFixture(false);
  try {
    const groups = Array.from({ length: 12 }, (_, n) => ({ id: `G${n}`, title: 'Context '.repeat(64), kind: 'group' as const, ...(n ? { parentId: `G${n - 1}` } : {}) }));
    const tasks = Array.from({ length: 80 }, (_, n) => ({ id: `T${n}`, title: 'Task '.repeat(100), kind: 'task' as const, status: 'blocked' as const, parentId: 'G11' }));
    const items = [...groups, ...tasks];
    for (let n = 0; n < items.length; n += 20) f.apply('P-dense', { op: 'stage', upload: 'dense', chunk: n / 20, items: items.slice(n, n + 20) });
    f.apply('P-dense', { op: 'commit', upload: 'dense', chunks: Math.ceil(items.length / 20), title: 'Dense plan' });
    for (let n = 0; n < tasks.length; n += 10) f.apply('P-dense', { op: 'change', changes: tasks.slice(n, n + 10).map(t => ({ id: t.id, status: 'blocked', blocker: { category: 'decision', reason: 'r'.repeat(512), nextAction: 'n'.repeat(512) } })) });
    let c: string | undefined; const windows: NeedsYouWindow[] = [];
    do { const w = needsYou(f.store, request(f, { cursor: c, timing: true })); bounds(w); windows.push(w); c = w.nextCursor ?? undefined; assert(windows.length < 10); } while (c);
    assert(windows[0].rows.length < 50, 'byte cap, not just row cap, provides a continuation');
    assert.equal(windows.flatMap(w => w.rows).length, 80); assert.equal(windows.at(-1)!.counts.needsYou, 80);
    assert(windows.flatMap(w => w.rows).every(r => r.ancestors.length === 8 && r.omittedAncestors === 4));
    assert.equal(windows[0].rows[0].ancestors[0].id, 'G0'); assert.equal(windows[0].rows[0].ancestors.at(-1)!.id, 'G11');
    f.seedPlan('Q-input', 'Byte boundary', [{ id: 'T', title: 'Blocked', kind: 'task', status: 'blocked' }]);
    for (const id of ['P-dense','Q-input']) f.store.db.prepare("UPDATE plans SET snapshot=json_set(snapshot,'$.padding',?) WHERE id=?").run('x'.repeat(L.inputBytes / 2), id);
    const first = needsYou(f.store, request(f)); bounds(first); assert(first.nextCursor); assert(first.work.inputBytes <= L.inputBytes);
    let next = first;
    for (let n = 0; next.nextCursor && n < 10; n++) { next = needsYou(f.store, request(f, { cursor: next.nextCursor })); bounds(next); }
    assert(next.coverage.complete); assert.deepEqual(next.counts, { needsYou: 80, alsoBlocked: 1 });
  } finally { f.cleanup(); }
});
