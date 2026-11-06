import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DefaultViewChoice, hasTaskEdge, type DetailView } from '../../ui/shared/default-view.ts';
import type { ItemView } from '../../ui/shared/model.ts';
const task = (id: string, dependencies?: string[]): ItemView => ({ id, title: id, kind: 'task', status: 'pending', ...(dependencies ? { dependencies } : {}) });
const edges = [task('A'), task('B', ['A'])];

test('D8 recorded task edge presence includes closed/done/skipped/self/cycle facts, excludes group/dangling references', () => {
  assert.equal(hasTaskEdge(edges), true);
  const terminal: ItemView[] = [{ ...task('A'), status: 'done' }, { ...task('B', ['A']), status: 'skipped' }];
  assert.equal(hasTaskEdge(terminal), true);
  assert.equal(hasTaskEdge([task('A', ['A'])]), true);
  assert.equal(hasTaskEdge([task('A', ['B']), task('B', ['A'])]), true);
  for (const items of [[], [task('A'), task('B')], [task('A', ['missing'])], [{ ...task('G', ['A']), kind: 'group' as const }, task('A')], [{ ...task('G'), kind: 'group' as const }, task('A', ['G'])]]) assert.equal(hasTaskEdge(items), false);
});

test('D8 waits for known capability and complete matching detail; unsupported resolves without detail', () => {
  const choice = new DefaultViewChoice();
  assert.deepEqual(choice.resolve('A', 'unknown', edges), { view: 'list', pending: true, explicit: false });
  assert.equal(choice.resolve('A', 'supported', null).pending, true, 'failed/incomplete detail is not an edgeless plan');
  assert.deepEqual(choice.resolve('A', 'supported', edges), { view: 'map', pending: false, explicit: false });
  assert.equal(choice.resolve('B', 'unsupported', null).view, 'list');
  assert.equal(choice.current.pending, false);
  assert.equal(choice.resolve('C', 'supported', []).view, 'list');
});

test('D8 every explicit choice wins, including reactivating provisional List', () => {
  for (const view of ['list', 'map', 'document', 'history'] as DetailView[]) {
    const choice = new DefaultViewChoice();
    choice.resolve('A', 'unknown', null);
    choice.choose('A', view);
    assert.deepEqual(choice.resolve('A', 'supported', edges), { view, pending: false, explicit: true });
    assert.equal(choice.resolve('A', 'unsupported', []).view, view, 'capability loss does not silently change views');
  }
});

test('D8 automatic defaults latch across revisions/edges; only a different reading or reset recomputes', () => {
  const choice = new DefaultViewChoice();
  assert.equal(choice.resolve('A', 'supported', edges).view, 'map');
  assert.equal(choice.resolve('A', 'supported', []).view, 'map');
  assert.equal(choice.resolve('B', 'supported', []).view, 'list');
  assert.equal(choice.resolve('B', 'supported', edges).view, 'list');
  assert.equal(choice.resolve('A', 'supported', edges).view, 'map', 'A→B→A is a new reading');
  choice.choose('A', 'document');
  choice.reset();
  assert.equal(choice.resolve('A', 'supported', edges).view, 'map');
  choice.resolve('B', 'supported', []);
  choice.choose('A', 'map');
  assert.equal(choice.current.view, 'list', 'a retired control cannot revive its old reading');
});
