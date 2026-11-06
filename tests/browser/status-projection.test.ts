import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectStatus } from '../../ui/status/projection.ts';
import type { ItemView, PlanDetail, PlanView } from '../../ui/shared/model.ts';

const current = { fresh: true, captureEnabled: true };
const plan: PlanView = {
  key: 'source-status/P-status', id: 'P-status', sourceId: 'source-status', title: 'Release report', ownerSessionId: 'M',
  revision: 3, structuralRevision: 1, lifecycle: 'active', reportedAt: '2026-01-01T00:00:00Z', directory: '/fixture/status',
  counts: { done: 1, total: 5, remaining: 4, skipped: 1 }, working: ['W1'],
  document: { state: 'unbound', checklistSynchronized: false, currentFile: 'unavailable' },
};
const task = (id: string, status: ItemView['status'], dependencies?: string[]): ItemView => ({ id, title: id, kind: 'task', status, ...(dependencies ? { dependencies } : {}) });
const items: ItemView[] = [
  { id: 'G', title: 'Recorded context', kind: 'group', status: 'pending' },
  task('D1', 'done'), task('W1', 'working'), task('B1', 'blocked'), task('R1', 'pending'), task('Q1', 'pending', ['B1']), task('S1', 'skipped'),
];
const detail = (rows = items): PlanDetail => ({ key: plan.key, revision: plan.revision, items: rows, contributions: [], links: [] });

test('Status reuses complete-detail readiness and full-plan totals, with blocked then working focus', () => {
  const d = detail(), p = projectStatus(plan, { state: 'ready', value: d }, current);
  assert.equal(p.detail, d);
  assert.deepEqual(p.summary, { ...plan.counts, working: 1, blocked: 1, percent: 20 });
  assert.deepEqual(p.reported, { pending: 2, working: 1, blocked: 1, done: 1, skipped: 1 });
  assert.equal(p.ready, 1); assert.equal(p.waiting, 1);
  assert.equal(p.attention.state === 'ready' && p.attention.qualifier, 'current');
  assert.deepEqual(p.focus.map(i => i.id), ['B1', 'W1']);
  assert.equal(p.focus[0], d.items[3], 'focus rows keep the accepted task objects and timing/provenance');
});

test('missing/loading/failed/mismatched detail cannot manufacture zero blockers or readiness', () => {
  const cases = [null, { state: 'loading' as const }, { state: 'error' as const },
    { state: 'ready' as const, value: { ...detail(), key: 'other-source/P-status' } },
    { state: 'ready' as const, value: { ...detail(), revision: plan.revision - 1 } }];
  for (const d of cases) {
    const p = projectStatus(plan, d, current);
    assert.equal(p.detail, null); assert.equal(p.reported, null);
    assert.equal(p.ready, null); assert.equal(p.waiting, null); assert.deepEqual(p.focus, []);
    assert.equal(p.summary.total, plan.counts!.total);
    assert.equal(p.summary.working, 1, 'the existing list-level working count remains only a reported count');
    assert.equal(p.readiness.state, d?.state === 'error' ? 'unavailable' : 'loading');
  }
});

test('closed and invalid detail retains reported facts without active readiness claims', () => {
  for (const lifecycle of ['completed', 'cancelled', 'failed'] as const) {
    const p = projectStatus({ ...plan, lifecycle }, { state: 'ready', value: detail() }, current);
    assert.equal(p.readiness.state, 'closed'); assert.equal(p.ready, null); assert.equal(p.waiting, null);
    assert.equal(p.reported!.pending, 2); assert.deepEqual(p.focus.map(i => i.id), ['B1', 'W1']);
  }
  const p = projectStatus(plan, { state: 'ready', value: detail([task('A', 'pending', ['B']), task('B', 'pending', ['A']), task('B1', 'blocked')]) }, current);
  assert.equal(p.readiness.state, 'invalid'); assert.equal(p.ready, null); assert.equal(p.waiting, null);
  assert.deepEqual(p.focus.map(i => i.id), ['B1']);
});

test('closed-plan detail failure stays visible independently of closed readiness and valid summary totals', () => {
  for (const lifecycle of ['completed', 'cancelled', 'failed'] as const) {
    const closed = { ...plan, lifecycle };
    const p = projectStatus(closed, { state: 'error' }, current);
    assert.ok('detailUnavailable' in p && p.detailUnavailable === true, `${lifecycle}: the detail failure must not be hidden by closed readiness`);
    assert.equal(p.readiness.state, 'closed');
    assert.equal(p.summary.done, plan.counts!.done); assert.equal(p.summary.total, plan.counts!.total);
    assert.equal(p.detail, null); assert.equal(p.reported, null); assert.deepEqual(p.focus, []);
    assert.equal(p.ready, null); assert.equal(p.waiting, null);
    for (const d of [null, { state: 'loading' as const }, { state: 'ready' as const, value: detail() }]) {
      const available = projectStatus(closed, d, current);
      assert.ok('detailUnavailable' in available && available.detailUnavailable === false, 'only a failed read claims unavailable');
    }
  }
});

test('skipped prerequisite is Waiting, skipped task stays separate, blockers keep precedence', () => {
  const p = projectStatus(plan, { state: 'ready', value: detail([task('S', 'skipped'), task('P', 'pending', ['S']), task('B', 'blocked', ['S'])]) }, current);
  assert.equal(p.ready, 0); assert.equal(p.waiting, 1);
  assert.equal(p.reported!.skipped, 1); assert.equal(p.reported!.blocked, 1);
  assert.deepEqual(p.focus.map(i => i.id), ['B']);
});

test('focus is at most two distinct tasks, first in recorded order, never group or done rows', () => {
  const rows = [{ id: 'G', title: 'Group', kind: 'group' as const, status: 'blocked' as const }, task('W2', 'working'), task('B2', 'blocked'), task('B1', 'blocked'), task('W1', 'working'), task('D', 'done')];
  const p = projectStatus(plan, { state: 'ready', value: detail(rows) }, current);
  assert.deepEqual(p.focus.map(i => i.id), ['B2', 'W2']);
  assert.equal(new Set(p.focus.map(i => i.id)).size, p.focus.length);
});

test('stale and capture-off counts remain qualified recorded facts, never current advice', () => {
  for (const [view, qualifier] of [[{ fresh: false, captureEnabled: true }, 'stale'], [{ fresh: true, captureEnabled: false }, 'capture-off']] as const) {
    const p = projectStatus(plan, { state: 'ready', value: detail() }, view);
    assert.equal(p.attention.state === 'ready' && p.attention.qualifier, qualifier);
    assert.equal(p.ready, 1); assert.equal(p.waiting, 1);
  }
});

test('empty/group-only and missing server counts use existing count rules without a false percent', () => {
  const p = projectStatus({ ...plan, counts: null, working: [] }, { state: 'ready', value: detail([{ id: 'G', title: 'Context', kind: 'group', status: 'pending' }]) }, current);
  assert.equal(p.summary.total, 0); assert.equal(p.summary.percent, null);
  assert.equal(p.ready, 0); assert.equal(p.waiting, 0); assert.deepEqual(p.focus, []);
});
