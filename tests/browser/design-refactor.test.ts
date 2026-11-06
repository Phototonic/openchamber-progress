import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchFixture } from '../fixtures/plan-task-search.ts';
import { DESIGN_PLAN, DESIGN_NO_EDGES, DESIGN_SOURCE, seedDesignFixture } from '../fixtures/design-refactor.ts';
import { taskTiming } from '../../service/task-timing.ts';
import { parsePlansPage } from '../../ui/shared/adapter.ts';
import { partitionBoardPlans, placeOf } from '../../ui/shared/scope.ts';
import { EMPTY_LIVE } from '../../ui/shared/live.ts';
import { DefaultViewChoice, viewReadingKey } from '../../ui/shared/default-view.ts';
import type { HostReadyContext } from '@openchamber/sdk';

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

test('F12 has exactly twelve rows across two projects: three current and nine completed/cancelled', () => {
  const f = searchFixture(false);
  try {
    seedDesignFixture(f, true);
    const rows = f.store.db.prepare('SELECT snapshot FROM plans WHERE source=?').all(DESIGN_SOURCE).map(r => JSON.parse(String(r.snapshot)));
    assert.equal(rows.length, 12);
    assert.equal(rows.filter(p => p.lifecycle === 'active').length, 3);
    assert.equal(rows.filter(p => p.lifecycle === 'finished').length, 8);
    assert.equal(rows.filter(p => p.lifecycle === 'cancelled').length, 1);
    const plans = parsePlansPage(JSON.stringify(f.store.list())).data;
    assert.equal(plans.length, 12, 'foreign/failed variants must not inflate the quiet board fixture');
    const projects = new Map<string, typeof plans>();
    for (const plan of plans) {
      const project = placeOf(plan, EMPTY_LIVE).projectKey;
      projects.set(project, [...projects.get(project) ?? [], plan]);
    }
    assert.equal(projects.size, 2);
    const counts = [...projects.values()].map(group => {
      const { current, finished } = partitionBoardPlans(group, false);
      assert.ok(finished.every(p => p.cleanup?.state !== 'archived'));
      assert.deepEqual(new Set([...current, ...finished]), new Set(group));
      return [current.length, finished.length];
    });
    assert.deepEqual(counts.sort((a, b) => b[0] - a[0]), [[2, 7], [1, 2]]);
    assert.equal(plans.filter(p => p.lifecycle === 'cancelled').length, 1);
    assert.equal(f.store.list({ archived: 'only' }).data.length, 0);
    const hits = f.scan({ q: 'release', source: DESIGN_SOURCE }).flatMap(w => w.hits);
    const matched = new Set(hits.map(h => h.plan.id));
    assert.equal(matched.size, 12, 'search includes folded plans without expanding their project');
    for (const plan of plans) assert.ok(matched.has(plan.id));
  } finally { f.cleanup(); }
});

test('F12 foreign equal-ID and failed variants preserve source identity and failure prominence', () => {
  const f = searchFixture(false);
  try {
    const { actor } = seedDesignFixture(f, true, true);
    f.seedPlan('P-release-failed', 'Release failed record', [{ id: 'D1', title: 'Release preparation', kind: 'task', status: 'pending' }], actor);
    f.apply('P-release-failed', { op: 'finish', outcome: 'failed' }, actor);
    const plans = parsePlansPage(JSON.stringify(f.store.list())).data;
    assert.equal(plans.length, 14, 'boundary variants are explicit additions, not part of twelve');
    const { current, finished } = partitionBoardPlans(plans, false);
    assert.ok(current.some(p => p.id === 'P-release-failed' && p.lifecycle === 'failed'));
    assert.equal(finished.length, 9);
    assert.deepEqual(new Set(current.filter(p => p.id === DESIGN_PLAN).map(p => p.key)), new Set([`${DESIGN_SOURCE}/${DESIGN_PLAN}`, `${f.beta.id}/${DESIGN_PLAN}`]));
    const results = f.scan({ q: 'release' }).flatMap(w => w.hits);
    assert.deepEqual(new Set(results.filter(h => h.plan.id === DESIGN_PLAN).map(h => h.plan.sourceId)), new Set([DESIGN_SOURCE, f.beta.id]));
    assert.ok(results.some(h => h.plan.id === 'P-release-failed' && h.plan.lifecycle === 'failed'));
  } finally { f.cleanup(); }
});

test('closed and archived recorded edges still choose Map; task-hit intent wins within that reading', () => {
  const f = searchFixture(false);
  try {
    const { actor } = seedDesignFixture(f);
    const items = [
      { id: 'A', title: 'Release prepared', kind: 'task' as const, status: 'done' as const },
      { id: 'B', title: 'Release checked', kind: 'task' as const, status: 'done' as const, dependencies: ['A'] },
    ];
    for (const outcome of ['finished', 'cancelled', 'failed'] as const) {
      const id = `P-release-edge-${outcome}`;
      f.seedPlan(id, `Release ${outcome} edge record`, items, actor);
      f.apply(id, { op: 'finish', outcome }, actor);
      let plan = parsePlansPage(JSON.stringify(f.store.list())).data.find(p => p.id === id)!;
      assert.equal(partitionBoardPlans([plan], false).finished.length, outcome === 'failed' ? 0 : 1);
      // This pure key helper consumes only connection.account from the host context.
      const vc = { ctx: { connection: { account: 'fixture' } } as HostReadyContext, identity: 'fixture-store-binding' };
      let key = viewReadingKey(vc, 'board-current', plan);
      const choice = new DefaultViewChoice();
      assert.equal(choice.resolve(key, 'supported', items).view, 'map', 'lifecycle is not an edge-presence predicate');
      key = viewReadingKey(vc, 'board-search:task-run', plan);
      choice.identify(key);
      choice.choose(key, 'list');
      assert.equal(choice.resolve(key, 'supported', items).view, 'list', 'late complete detail cannot override the explicit task hit');
      if (outcome !== 'finished') continue; // archive eligibility is unchanged
      const oldKey = key;
      f.store.cleanup('archive', { storeId: f.storeId, source: DESIGN_SOURCE, plan: id, rev: plan.revision, cleanupRev: plan.cleanup?.revision ?? 0, oid: 'design-edge-archive' });
      assert.ok(!f.store.list().data.some(p => p.id === id));
      plan = parsePlansPage(JSON.stringify(f.store.list({ archived: 'only' }))).data[0];
      assert.equal(plan.id, id);
      assert.deepEqual(partitionBoardPlans([plan], true), { current: [plan], finished: [] });
      key = viewReadingKey(vc, 'board-archived', plan);
      assert.notEqual(key, oldKey);
      assert.equal(choice.resolve(key, 'supported', items).view, 'map', 'Archived starts its own view decision');
      const hits = f.scan({ q: 'release', archived: 'only' }).flatMap(w => w.hits);
      assert.ok(hits.length && hits.every(h => h.plan.id === id));
    }
  } finally { f.cleanup(); }
});
