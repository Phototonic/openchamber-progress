import test from 'node:test';
import assert from 'node:assert/strict';
import { PlanSelection, selectionConfirmation, selectionCopy, CleanupScan, runTidy, type CleanupPlan } from '../../ui/shared/cleanup.ts';

const plan = (id: string, lifecycle: CleanupPlan['lifecycle'] = 'active'): CleanupPlan =>
  ({ key: id, id, title: id, sourceId: 'fixture', revision: 1, lifecycle });

test('selection is a reading-local rule with exclusions; refresh prunes only departed known plans', () => {
  const s = new PlanSelection();
  const a = plan('a'), b = plan('b');
  s.reconcile('one', [a, b], true);
  s.toggle(a); assert.equal(s.count, 1);
  s.reconcile('one', [a, b], true); assert.equal(s.has(a.key), true);
  s.selectAll(); s.toggle(a);
  assert.equal(s.has('not-loaded'), true);
  assert.equal(s.has(a.key), false);
  assert.equal(s.count, 1); assert.equal(s.incomplete, true);
  s.reconcile('one', [a], false); assert.equal(s.count, 0);
  s.reconcile('two', [a, b], false); assert.equal(s.mode, false);
  assert.equal(s.has(b.key), false);
});

test('selection scan includes active and unloaded plans, respecting exclusions', async () => {
  const s = new PlanSelection(); const a = plan('a'), b = plan('b', 'completed');
  s.reconcile('one', [a], true); s.selectAll(); s.toggle(a);
  const includes = s.snapshot().includes;
  const scan = new CleanupScan('scope', 'store', false, async () => ({
    plans: [a, b, plan('unloaded')], visited: 3, nextCursor: null,
  }), false, 50, includes);
  const c = await scan.more(() => true);
  assert.deepEqual(c?.targets.map(t => t.key), ['b', 'unloaded']);
});

test('confirmation excludes unsupported active cleanup, but never active Restore', () => {
  const plans = [plan('active'), plan('closed', 'completed')];
  const c = selectionConfirmation(plans, 'store', 'scope', false, 'archive', false);
  assert.equal(c.activeCount, 1); assert.equal(c.excludedActive, 1);
  assert.deepEqual(c.targets.map(t => t.key), ['closed']);
  const restore = selectionConfirmation(plans.map(p => ({ ...p, cleanup: { state: 'archived', revision: 1 } })), 'store', 'scope', true, 'restore', false);
  assert.equal(restore.targets.length, 2); assert.equal(restore.excludedActive, 0);
});

test('mixed selection acknowledges only active Archive/Delete, never Restore or Undo', async () => {
  const c = selectionConfirmation([plan('active'), plan('closed', 'completed')], 'store', 'scope', false, 'archive', true);
  for (const action of ['archive', 'delete', 'restore'] as const) {
    const requests: any[] = [];
    const result = await runTidy({ serviceRequest: async q => {
      const r = JSON.parse(q.body!); requests.push(r);
      return { status: 200, body: JSON.stringify({ ...r, cleanup: { state: action === 'archive' ? 'archived' : action === 'delete' ? 'deleted' : 'visible', revision: r.cleanupRev + 1 } }) };
    } }, action, c.targets, () => true, undefined, true);
    assert.equal(result.succeeded.length, 2);
    assert.deepEqual(requests.map(r => r.active), action === 'restore' ? [undefined, undefined] : [true, undefined]);
  }
});

test('departed search results are removed without clearing the other selected pages', () => {
  const s = new PlanSelection(), a = plan('a'), b = plan('b');
  s.reconcile('search', [a], true); s.toggle(a);
  s.reconcile('search', [b], true); s.toggle(b);
  s.forget([a.key]);
  assert.equal(s.count, 1); assert.equal(s.has(b.key), true);
  assert.equal(s.has(a.key), false);
  s.selectAll(); s.toggle(b);
  for (const locale of ['en', 'ru', 'zh-CN']) assert(!selectionCopy(locale).count(s.count, s.incomplete).includes('0+'));
});
