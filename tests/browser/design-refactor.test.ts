import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchFixture } from '../fixtures/plan-task-search.ts';
import { DESIGN_PLAN, DESIGN_NO_EDGES, DESIGN_SOURCE, seedDesignFixture } from '../fixtures/design-refactor.ts';
import { taskTiming } from '../../service/task-timing.ts';

test('F8 uses recorded blockers and bounded-history exact/lower-bound timing; F8-N removes only edges', () => {
  const f = searchFixture(false);
  try {
    seedDesignFixture(f);
    const edge = f.store.get(DESIGN_SOURCE, DESIGN_PLAN)!;
    const none = f.store.get(DESIGN_SOURCE, DESIGN_NO_EDGES)!;
    assert.equal(edge.items.length, 8);
    assert.equal(edge.items.filter(i => i.status === 'done').length, 3);
    assert.equal(edge.items.find(i => i.id === 'B1')!.blocker?.reason, 'Distribution window has not been confirmed.');
    assert.deepEqual(edge.items.find(i => i.id === 'Q1')!.dependencies, ['B1']);
    assert.ok(none.items.every(i => !i.dependencies?.length));
    for (const plan of [DESIGN_PLAN, DESIGN_NO_EDGES]) {
      const timing = taskTiming(f.store, f.store.detail(DESIGN_SOURCE, plan), new Date());
      assert.equal(timing.items.W1.kind, 'exact');
      assert.equal(timing.items.W2.kind, 'lower-bound');
    }
    const rows = f.store.db.prepare('SELECT payload FROM runs_rows').all().map(r => JSON.parse(String(r.payload)));
    assert.ok(rows.every(r => r.planContext?.plan === DESIGN_PLAN));
    assert.equal(rows.filter(r => r.ran.state === 'running').length, 2);
    assert.equal(rows.filter(r => r.ran.state === 'succeeded').length, 1);
    assert.equal(rows.filter(r => r.ran.state === 'unknown').length, 1);
  } finally { f.cleanup(); }
});

test('F12 local membership is twelve, cancelled included, not conflated with foreign equal IDs or archive', () => {
  const f = searchFixture(false);
  try {
    seedDesignFixture(f, true);
    const rows = f.store.db.prepare('SELECT snapshot FROM plans WHERE source=?').all(DESIGN_SOURCE).map(r => JSON.parse(String(r.snapshot)));
    assert.equal(rows.length, 12);
    assert.equal(rows.filter(p => p.lifecycle === 'active').length, 3);
    assert.equal(rows.filter(p => p.lifecycle === 'finished').length, 8);
    assert.equal(rows.filter(p => p.lifecycle === 'cancelled').length, 1);
    assert.ok(f.store.get(f.beta.id, DESIGN_PLAN));
  } finally { f.cleanup(); }
});
