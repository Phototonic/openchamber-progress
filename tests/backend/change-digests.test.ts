import test from 'node:test';
import assert from 'node:assert/strict';
import { compareTasks, endpointCounts, validateDigestSnapshot, type DigestSnapshot } from '../../shared/change-digest.ts';
import type { Item, ItemInput } from '../../shared/progress.ts';
import { digestFixture, digestItems } from '../fixtures/change-digests.ts';

test('P-digest r1→r6 retains transient blockers, suppresses fresh-oid duplicates and receipt replay', () => {
  const f = digestFixture(); try {
    const before = f.store.get(f.source.id, 'P-digest');
    f.throughSix(); const d = f.read(1, 6);
    assert.equal(f.store.get(f.source.id, 'P-digest')!.revision, 6);
    assert.equal(d.complete, true); assert.equal(d.availability, 'comparison');
    assert.deepEqual(d.summary.events, { added: 1, removed: 0, revised: 0, completed: 1, reopened: 0, blocked: 1, unblocked: 1, skipped: 0, unskipped: 0 });
    assert.deepEqual(d.counts.before, { done: 1, total: 2, remaining: 1, skipped: 1 });
    assert.deepEqual(d.counts.after, { done: 2, total: 3, remaining: 1, skipped: 1 });
    assert.deepEqual(d.tasks.map(t => t.id), ['D', 'B']);
    assert.deepEqual(d.tasks[1].references.map(r => r.to), [5, 4, 2]);
    assert.equal(d.counts.scope!.addedCounted, 1); assert.equal(d.counts.scope!.completed, 1);
    assert.deepEqual(JSON.parse(String(f.store.db.prepare('SELECT snapshot FROM revisions WHERE revision=1').get()!.snapshot)), before);
    assert.equal(f.read(6).tasks.length, 0); assert.equal(f.read(6).complete, true);
    const initial = f.read(); assert.equal(initial.availability, 'initial'); assert.equal(initial.counts.before, null); assert.equal(initial.summary.events.added, 0);
  } finally { f.cleanup(); }
});

const task = (id: string, status: Item['status'] = 'working', rest: Partial<Item> = {}): Item => ({ id, title: id, kind: 'task', status, ...rest });
const snapshot = (items: Item[], revision = 1): DigestSnapshot => ({ id: 'P', sourceId: 'source-fixture', revision, structuralRevision: 1, lifecycle: 'active', reportedAt: '2026-01-01T00:00:00.000Z', items });
test('classification uses ID and kind; structural sets and scope causes are independent of status', () => {
  const cases: [string, Item[], Item[], string[]][] = [
    ['already done addition', [], [task('A', 'done')], ['added']],
    ['blocked addition', [], [task('A', 'blocked')], ['added', 'blocked']],
    ['done removal', [task('A', 'done')], [], ['removed']],
    ['blocked removal', [task('A', 'blocked')], [], ['removed']],
    ['task to group', [task('A', 'done')], [task('A', 'done', { kind: 'group' })], ['removed']],
    ['group to task', [task('A', 'done', { kind: 'group' })], [task('A', 'done')], ['added']],
    ['title', [task('A')], [task('A', 'working', { title: 'Revised' })], ['revised']],
    ['parent', [task('A')], [task('A', 'working', { parentId: 'G' })], ['revised']],
    ['dependency set', [task('A')], [task('A', 'working', { dependencies: ['B'] })], ['revised']],
    ['dependency order', [task('A', 'working', { dependencies: ['B', 'C'] })], [task('A', 'working', { dependencies: ['C', 'B'] })], []],
    ['skip blocked', [task('A', 'blocked')], [task('A', 'skipped')], ['unblocked', 'skipped']],
    ['unskip', [task('A', 'skipped')], [task('A')], ['unskipped']],
    ['ordinary progress', [task('A', 'pending')], [task('A')], []],
    ['group only', [task('G', 'working', { kind: 'group' })], [task('G', 'done', { kind: 'group', title: 'Changed' })], []],
  ];
  for (const [name, a, b, expected] of cases) {
    const before = snapshot(a), after = snapshot(b, 2), frozen = JSON.stringify([before, after]);
    assert.deepEqual(compareTasks(before, after).flatMap(c => c.reference.facets), expected, name);
    assert.equal(JSON.stringify([before, after]), frozen, name);
    const c = endpointCounts(before, after), s = c.scope!;
    assert.equal(c.after!.total - c.before!.total, s.addedCounted - s.removedCounted - s.skipped + s.unskipped, name);
    assert.equal(c.after!.done - c.before!.done, s.addedDone - s.removedDone + s.completed - s.reopened, name);
  }
  assert.equal(endpointCounts(snapshot([task('G', 'done', { kind: 'group' })]), snapshot([task('A', 'skipped')])).after!.total, 0);
});

test('reopen cycles, added-then-removed, skip cycles, and staged commit retain real transitions', () => {
  const f = digestFixture(); try {
    f.change('done'); f.change('working'); f.change('done');
    let items: ItemInput[] = [...digestItems.map(i => i.id === 'B' ? { ...i, status: 'done' as const } : i), { id: 'D', title: 'Already done', kind: 'task', status: 'done' }];
    f.revise(items); items = items.filter(i => i.id !== 'D'); f.revise(items);
    f.change('skipped'); f.change('working');
    const d = f.read(1);
    assert.equal(d.summary.events.completed, 2); assert.equal(d.summary.events.reopened, 2);
    assert.equal(d.summary.events.added, 1); assert.equal(d.summary.events.removed, 1);
    assert.equal(d.summary.events.skipped, 1); assert.equal(d.summary.events.unskipped, 1);
    const oldRevision = f.store.get(f.source.id, 'P-digest')!.revision;
    f.apply({ op: 'stage', upload: 'upload', chunk: 0, items: [{ id: 'X', title: 'Staged', kind: 'task' }] });
    assert.equal(f.store.get(f.source.id, 'P-digest')!.revision, oldRevision);
    assert.equal(f.read(oldRevision).summary.events.added, 0);
    f.apply({ op: 'commit', upload: 'upload', chunks: 1 });
    assert.equal(f.read(oldRevision).summary.events.added, 1);
  } finally { f.cleanup(); }
});

test('denominator 1/2→1/3→1/2 explains scope without inventing completions', () => {
  const f = digestFixture(); try {
    f.revise([...digestItems, { id: 'D', title: 'New work', kind: 'task' }]);
    const grow = f.read(1); assert.equal(grow.counts.before!.total, 2); assert.equal(grow.counts.after!.total, 3); assert.equal(grow.counts.scope!.addedCounted, 1);
    f.revise(digestItems); const shrink = f.read(2); assert.equal(shrink.counts.after!.total, 2); assert.equal(shrink.counts.scope!.removedCounted, 1);
    const both = f.read(1); assert.equal(both.summary.events.added, 1); assert.equal(both.summary.events.removed, 1); assert.equal(both.summary.events.completed, 0); assert.equal(both.counts.before!.done, both.counts.after!.done);
  } finally { f.cleanup(); }
});

test('snapshot validation rejects identity, structural metadata, duplicates, cycles and unbounded facts', () => {
  const p = snapshot([task('A')]); assert(validateDigestSnapshot(p, p.sourceId, p.id, 1));
  for (const bad of [{ ...p, sourceId: 'other' }, { ...p, revision: 2 }, { ...p, structuralRevision: 0 }, { ...p, items: [task('A'), task('A')] }, { ...p, items: [task('A', 'working', { title: 'x'.repeat(513) })] }, { ...p, items: [task('A', 'working', { dependencies: ['A'] })] }, { ...p, items: [task('A', 'working', { parentId: 'A', kind: 'group' })] }]) assert.equal(validateDigestSnapshot(bad, p.sourceId, p.id, 1), null);
});
