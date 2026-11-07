import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ItemView, PlanDetail, PlanView, ReadingState } from '../../ui/shared/model.ts';
import { progressProjection } from '../../ui/shared/progress-projection.ts';
const plan: PlanView = { key: 'source-example/P', id: 'P', sourceId: 'source-example', title: 'Release example', ownerSessionId: 'M', revision: 1, structuralRevision: 1, lifecycle: 'active', reportedAt: '2026-01-01T00:00:00.000Z', directory: '/fixture/project', counts: null, working: [], document: { state: 'unbound', checklistSynchronized: false, currentFile: 'not checked' } };
const item = (id: string, status: ItemView['status'] = 'pending', patch: Partial<ItemView> = {}): ItemView => ({ id, title: id, kind: 'task', status, ...patch });
const items = [item('D1', 'done'), item('D2', 'done'), item('D3', 'done'), item('W1', 'working'), item('W2', 'working'), item('B1', 'blocked'), item('R1'), item('Q1', 'pending', { dependencies: ['B1'] })];
const detail = (xs = items): PlanDetail => ({ key: plan.key, revision: plan.revision, items: xs, contributions: [], links: [] });
const reading = (patch: Partial<ReadingState> = {}): ReadingState => ({ status: 'all', participant: { kind: 'all' }, cursor: { working: null, blocked: null }, ...patch });

test('canonical attention groups are exclusive, stable recorded order, whole-plan state counts and folded Done', () => {
  const p = progressProjection(plan, detail(), reading())!;
  assert.deepEqual(p.groups.map(g => [g.id, g.rows.map(r => r.item.id)]), [['now', ['W1', 'W2']], ['needs-you', ['B1']], ['up-next', ['R1', 'Q1']], ['done', ['D1', 'D2', 'D3']], ['skipped', []]]);
  assert.equal(new Set(p.order.map(i => i.id)).size, 8);
  assert.equal(p.order.length, 8);
  assert.equal(p.counts.get('done'), 3); assert.equal(p.counts.get('ready'), 1); assert.equal(p.counts.get('waiting'), 1);
  assert.equal(p.groups.find(g => g.id === 'done')!.folded, true);
});

test('filters retain active blockers and ancestor context without claiming they match', () => {
  const p = progressProjection(plan, detail([{ ...item('G'), kind: 'group' }, item('B', 'blocked', { parentId: 'G' }), item('W', 'working')]), reading({ participant: { kind: 'session', sessionId: 'missing' }, state: 'done' }))!;
  assert.equal(p.matching, 0); assert.equal(p.retained, 1); assert.equal(p.hidden, 1);
  assert.equal(p.rows.get('B')!.visibility, 'retained'); assert.equal(p.rows.get('G')!.visibility, 'context');
  assert.equal(p.counts.get('blocked'), 1, 'counts are whole-plan, never match totals');
});

test('Done state filter unfolds Done without mutating reading; skipped stays separate and does not count as Done', () => {
  const r = reading({ state: 'done' });
  const p = progressProjection(plan, detail([...items, item('S', 'skipped')]), r)!;
  assert.equal(p.groups.find(g => g.id === 'done')!.folded, false);
  assert.equal(p.groups.find(g => g.id === 'skipped')!.rows[0].item.id, 'S');
  assert.equal(p.counts.get('done'), 3); assert.equal(p.counts.get('skipped'), 1);
  assert.equal(r.doneOpen, undefined);
});

test('closed/invalid readiness uses reported statuses and ordinary filtering, never retained Needs-you claims', () => {
  for (const [p, d] of [[{ ...plan, lifecycle: 'completed' as const }, detail()], [plan, detail([item('A', 'pending', { dependencies: ['A'] }), item('B', 'blocked')])]] as const) {
    const view = progressProjection(p, d, reading({ state: 'ready' }))!;
    assert.equal(view.guidance, false); assert.equal(view.retained, 0); assert.equal(view.matching, 0);
    assert.equal(view.counts.get('ready'), undefined);
  }
});

test('plan order preserves hierarchy/group metadata; empty/group-only are complete but mismatched detail is not', () => {
  const p = progressProjection(plan, detail([item('G', 'pending', { kind: 'group' }), item('A', 'pending', { parentId: 'G' }), item('W', 'working')]), reading({ order: 'plan' }))!;
  assert.deepEqual(p.order.map(i => i.id), ['G', 'A', 'W']);
  assert.equal(p.tree[0].children[0].item.id, 'A');
  assert.equal(progressProjection(plan, detail([]), reading())!.matching, 0);
  assert.equal(progressProjection(plan, detail([item('G', 'pending', { kind: 'group' })]), reading())!.tree.length, 1);
  assert.equal(progressProjection(plan, { ...detail(), key: 'other/P' }, reading()), null);
  assert.equal(progressProjection(plan, { ...detail(), revision: 2 }, reading()), null);
});
