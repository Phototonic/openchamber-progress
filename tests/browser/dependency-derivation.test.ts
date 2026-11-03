import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PlanGraphItem } from '../../shared/progress.ts';
import type { ItemView } from '../../ui/shared/model.ts';
import { deriveDependencies, invalidDependencyReason, type DependencyItem, type DependencyDerivation } from '../../ui/shared/dependency-derivation.ts';
import { READY_ITEMS } from './ready-tasks-fixtures.ts';

const task = (id: string, dependencies?: readonly string[], status: DependencyItem['status'] = 'pending'): DependencyItem => ({ id, kind: 'task', status, dependencies });
const group = (id: string, dependencies?: readonly string[]): DependencyItem => ({ id, kind: 'group', status: 'pending', dependencies });
function valid(items: readonly DependencyItem[]) {
  const result = deriveDependencies(items);
  assert.equal(result.state, 'valid');
  return result as Extract<DependencyDerivation, { state: 'valid' }>;
}
const members = (actual: ReadonlySet<string> | null, expected: string[]) => assert.deepEqual(actual, new Set(expected));
const depths = (r: ReturnType<typeof valid>) => new Map([...r.tasks].map(([id, t]) => [id, t.depth]));
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.freeze(value); for (const v of Object.values(value)) freeze(v); }
  return value;
}

test('U01 — frozen detail and graph inputs share fixture decisions without casts or mutation', () => {
  const detail: readonly ItemView[] = freeze(READY_ITEMS.map((i) => ({ ...i, dependencies: i.dependencies?.slice() })));
  const graph: readonly PlanGraphItem[] = freeze(detail.map((i) => ({ id: i.id, kind: i.kind, status: i.status, parentId: null, dependencies: [...i.dependencies ?? []] })));
  const before = JSON.stringify([detail, graph]);
  const a = valid(detail), b = valid(graph);
  assert.deepEqual(a.tasks, b.tasks);
  assert.deepEqual([...a.tasks].map(([id, t]) => [id, t.group]), [
    ['D', null], ['R', 'ready'], ['W', 'waiting'], ['S', null], ['K', 'skipped'], ['B', 'blocked'], ['X', null], ['I', 'ready'],
  ]);
  assert.equal(a.tasks.has('G'), false);
  assert.equal(JSON.stringify([detail, graph]), before);
});

test('U02 — blocked/skipped precedence, excluded statuses and direct readiness versus upstream depth', () => {
  for (const deps of [undefined, [], ['D'], ['S'], ['missing'], ['G'], ['S', 'missing']]) {
    const r = valid([task('B', deps, 'blocked'), task('D', [], 'done'), task('S', [], 'skipped'), group('G')]);
    assert.equal(r.tasks.get('B')!.group, 'blocked');
    assert.equal(r.tasks.get('B')!.incomplete, !!deps?.some((id) => id === 'missing' || id === 'G'));
    assert.equal(r.tasks.get('B')!.prerequisites.length, deps?.length ?? 0);
  }
  const r = valid([task('S', [], 'skipped'), task('K', ['S', 'gone']), task('X', ['gone'], 'done'), task('Y', ['X']), task('W', ['gone'], 'working')]);
  assert.equal(r.tasks.get('K')!.group, 'skipped');
  assert.equal(r.tasks.get('K')!.incomplete, true);
  assert.equal(r.tasks.get('Y')!.group, 'ready');
  assert.equal(r.tasks.get('Y')!.depth, null);
  for (const id of ['S', 'X', 'W']) assert.equal(r.tasks.get(id)!.group, null);
});

test('U03 — empty, groups-only, isolated, omitted/empty and repeated recorded references', () => {
  for (const items of [[], [group('G')]]) {
    const r = valid(items);
    assert.equal(r.tasks.size, 0);
    assert.equal(r.upstream('G'), null);
  }
  const omitted = valid([task('I')]), empty = valid([task('I', [])]);
  assert.deepEqual(omitted.tasks, empty.tasks);
  assert.equal(omitted.tasks.get('I')!.depth, 0);
  members(omitted.upstream('I'), []);
  members(omitted.downstream('I'), []);
  const r = valid([task('X'), task('Y', ['X', 'X'])]);
  assert.deepEqual(r.tasks.get('Y')!.prerequisites, [{ kind: 'task', id: 'X', status: 'pending' }, { kind: 'task', id: 'X', status: 'pending' }]);
  members(r.tasks.get('X')!.unlocksNext, ['Y']);
  members(r.upstream('Y'), ['X']);
  members(r.downstream('X'), ['Y']);
});

test('U04 — immediate unlocks and literal change-only-X counterfactual', () => {
  for (const status of ['pending', 'working', 'blocked', 'skipped'] as const) {
    const items = [task('X', [], status), task('D', [], 'done'), task('Y', ['X', 'X', 'D']), task('Z', ['Y'])];
    const r = valid(items);
    members(r.tasks.get('X')!.unlocksNext, ['Y']);
    members(r.tasks.get('Y')!.unlocksNext, ['Z']);
    for (const [id, t] of r.tasks) for (const unlocked of t.unlocksNext) {
      const changed = valid(items.map((i) => i.id === id ? { ...i, status: 'done' } : i));
      assert.equal(changed.tasks.get(unlocked)!.group, 'ready');
    }
  }
  for (const status of ['blocked', 'working', 'done', 'skipped'] as const) {
    members(valid([task('X'), task('Y', ['X'], status)]).tasks.get('X')!.unlocksNext, []);
  }
  for (const second of [task('S', [], 'skipped'), task('S'), group('S')]) {
    const r = valid([task('X'), second, task('Y', ['X', 'S'])]);
    members(r.tasks.get('X')!.unlocksNext, []);
  }
  members(valid([task('X'), task('Y', ['X', 'gone'])]).tasks.get('X')!.unlocksNext, []);
  members(valid([task('X', [], 'done'), task('Y', ['X'])]).tasks.get('X')!.unlocksNext, []);
});

test('U05 — dependency-first longest path, not input order, statuses or hierarchy', () => {
  const items: PlanGraphItem[] = [
    { ...task('J', ['A', 'C']), dependencies: ['A', 'C'], parentId: null },
    { ...task('C', ['B']), dependencies: ['B'], parentId: null },
    { ...task('B', ['A']), dependencies: ['A'], parentId: null },
    { ...task('A'), dependencies: [], parentId: null },
    { ...task('I'), dependencies: [], parentId: null },
  ];
  const expected = new Map([['J', 3], ['C', 2], ['B', 1], ['A', 0], ['I', 0]]);
  assert.deepEqual(depths(valid(items)), expected);
  const changed = items.map((i, n): PlanGraphItem => ({ ...i, status: n % 2 ? 'skipped' : 'done', parentId: 'G' }));
  assert.deepEqual(depths(valid([...changed, { id: 'G', kind: 'group', status: 'done', parentId: null, dependencies: [] }])), expected);
});

test('U06 — groups/missing/removed IDs never become task vertices; unknown depth propagates', () => {
  const items: ItemView[] = [
    { id: 'A', title: 'A', kind: 'task', status: 'done' },
    { id: 'G', title: 'G', kind: 'group', status: 'pending', dependencies: ['A'] },
    { id: 'C', title: 'C', kind: 'task', status: 'pending', parentId: 'G' },
    { id: 'B', title: 'B', kind: 'task', status: 'done', dependencies: ['G', 'gone'] },
    { id: 'D', title: 'D', kind: 'task', status: 'skipped', dependencies: ['B'] },
    { id: 'E', title: 'E', kind: 'task', status: 'pending', dependencies: ['D'] },
    { id: 'F', title: 'F', kind: 'task', status: 'pending', dependencies: ['A'] },
  ];
  const r = valid(items);
  assert.deepEqual(depths(r), new Map([['A', 0], ['C', 0], ['B', null], ['D', null], ['E', null], ['F', 1]]));
  assert.deepEqual(r.tasks.get('B')!.prerequisites, [{ kind: 'not-task', id: 'G' }, { kind: 'unresolved', id: 'gone' }]);
  members(r.upstream('C'), []);
  members(r.downstream('A'), ['F']);
  members(r.upstream('E'), ['D', 'B']);
  assert.equal(r.tasks.has('G'), false);
  const removed = valid(items.filter((i) => i.id !== 'A'));
  assert.equal(removed.tasks.has('A'), false);
  assert.equal(removed.tasks.get('F')!.depth, null);
  assert.deepEqual(removed.tasks.get('F')!.prerequisites, [{ kind: 'unresolved', id: 'A' }]);
  members(removed.upstream('F'), []);
});

test('U07 — directional closures deduplicate the diamond, retain all statuses and distinguish unknown', () => {
  const r = valid([task('A', [], 'done'), task('B', ['A', 'A'], 'skipped'), task('C', ['A'], 'working'), task('D', ['B', 'C']), task('I'), group('G')]);
  members(r.upstream('D'), ['A', 'B', 'C']);
  members(r.downstream('A'), ['B', 'C', 'D']);
  members(r.upstream('B'), ['A']);
  members(r.downstream('B'), ['D']);
  members(r.upstream('A'), []);
  members(r.downstream('D'), []);
  for (const method of [r.upstream, r.downstream]) {
    members(method('I'), []);
    assert.equal(method('G'), null);
    assert.equal(method('gone'), null);
  }
});

test('U08 — invalid graph is atomic, with duplicate > self > cycle priority including group edges', () => {
  const cycle = [task('A', ['B'], 'done'), task('B', ['A'], 'done')];
  const cases: [DependencyItem[], 'duplicate-id' | 'self-dependency' | 'cycle'][] = [
    [[task('A'), group('A')], 'duplicate-id'],
    [[task('S', ['S'])], 'self-dependency'],
    [cycle, 'cycle'],
    [[task('I'), ...cycle], 'cycle'],
    [[task('A', ['G']), group('G', ['A'])], 'cycle'],
    [[...cycle, task('S', ['S'])], 'self-dependency'],
    [[...cycle, task('S', ['S']), group('A')], 'duplicate-id'],
  ];
  for (const [items, reason] of cases) {
    assert.equal(invalidDependencyReason(items), reason);
    assert.deepEqual(deriveDependencies(items), { state: 'invalid', reason });
  }
});

test('U09 — supported 1000-task bounds, fresh closure sets and owned snapshot data', () => {
  const chain = freeze(Array.from({ length: 1000 }, (_, n) => task(`T${n}`, n ? [`T${n - 1}`] : [])));
  const r = valid(chain);
  assert.equal(r.tasks.get('T999')!.depth, 999);
  const up = r.upstream('T999')!;
  assert.equal(up.size, 999);
  assert.equal(r.downstream('T0')!.size, 999);
  members(r.upstream('T1'), ['T0']);
  assert.deepEqual(r.upstream('T999'), up);
  assert.notEqual(r.upstream('T999'), up);
  const fan = freeze(Array.from({ length: 1000 }, (_, n) => task(`F${n}`, n ? ['F0', ...Array.from({ length: Math.min(15, n - 1) }, (_, j) => `F${n - j - 1}`)] : [])));
  const f = valid(fan);
  assert.equal(f.downstream('F0')!.size, 999);
  assert.equal(f.upstream('F999')!.size, 999);
  assert.equal(f.tasks.get('F999')!.depth, 999);
  const mutable = [{ id: 'A', kind: 'task' as const, status: 'pending' as const, dependencies: [] as string[] }, { id: 'B', kind: 'task' as const, status: 'pending' as const, dependencies: ['A'] }];
  const owned = valid(mutable);
  mutable[1].dependencies.length = 0;
  mutable[0].id = 'changed';
  members(owned.upstream('B'), ['A']);
  members(owned.downstream('A'), ['B']);
  assert.equal(owned.tasks.get('B')!.depth, 1);
  assert.deepEqual(owned.tasks.get('B')!.prerequisites, [{ kind: 'task', id: 'A', status: 'pending' }]);
});

test('U10 — same IDs across independent snapshots do not retain status, topology or identity', () => {
  const first = valid([task('A'), task('B', ['A'])]);
  const second = valid([task('A', ['B'], 'done'), task('B')]);
  const removed = valid([task('B', ['A'])]);
  const reused = valid([task('A', [], 'skipped'), task('B')]);
  assert.equal(first.tasks.get('B')!.group, 'waiting');
  assert.equal(second.tasks.get('B')!.group, 'ready');
  members(first.upstream('B'), ['A']);
  members(second.upstream('A'), ['B']);
  members(second.upstream('B'), []);
  assert.equal(removed.upstream('A'), null);
  assert.equal(removed.tasks.get('B')!.depth, null);
  assert.equal(reused.tasks.get('A')!.status, 'skipped');
  members(reused.downstream('A'), []);
  assert.equal(first.tasks.get('B')!.depth, 1);
  members(first.tasks.get('A')!.unlocksNext, ['B']);
});
