import test from 'node:test';
import assert from 'node:assert/strict';
import { PlanSelection, selectionConfirmation, selectionTargets, selectionCopy, CleanupScan, runTidy, type CleanupPlan } from '../../ui/shared/cleanup.ts';

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

test('unsupported active plans do not consume the loaded selection target ceiling', () => {
  const active = Array.from({ length: 1000 }, (_, n) => plan(`active-${n}`));
  const c = selectionConfirmation([...active, plan('closed', 'completed')], 'store', 'scope', false, 'delete', false);
  assert.deepEqual(c.targets.map(p => p.key), ['closed']);
  assert.equal(c.excludedActive, 1000);
  assert.equal(c.limited, false);
});

test('unsupported active plans do not consume scan targets or prevent Check more', async () => {
  const active = Array.from({ length: 2050 }, (_, n) => plan(`active-${n}`));
  const library = [...active, plan('closed', 'completed')];
  const cursors: (string | null)[] = [];
  const scan = new CleanupScan('scope', 'store', false, async cursor => {
    cursors.push(cursor); const offset = Number(cursor ?? 0), end = Math.min(offset + 50, library.length);
    return { plans: library.slice(offset, end), visited: end - offset, nextCursor: end === library.length ? null : String(end) };
  }, false, 50, () => true, false);
  const first = selectionTargets((await scan.more(() => true))!, 'archive', false);
  assert.equal(first.limited, false);
  assert.equal(first.unchecked, true, 'the plan-slot bound must offer continuation, not an empty terminal ceiling');
  assert.equal(first.excludedActive, 2000);
  const second = selectionTargets((await scan.more(() => true))!, 'archive', false);
  assert.deepEqual(second.targets.map(p => p.key), ['closed']);
  assert.equal(second.excludedActive, 2050);
  assert.equal(second.unchecked, false);
  assert.equal(new Set(cursors).size, cursors.length, 'continuation must not recount excluded plans');
});

test('a receipt-confirmed plan is no longer selected under Select all and does not count', () => {
  const plans = ['a', 'b', 'c'].map(id => plan(id, 'completed'));
  const selection = new PlanSelection();
  selection.reconcile('scope', plans, true); selection.selectAll();
  const earlier = selection.snapshot().includes;
  selection.forget(['a']);
  assert.equal(selection.has('a'), false);
  assert.equal(selection.has('b'), true);
  assert.equal(selection.count, 2);
  const scanRule = selection.snapshot().includes;
  assert.equal(scanRule(plans[0]), false, 'a later scan does not target it again');
  assert.equal(scanRule(plans[1]), true, 'but still admits another matching plan');
  assert.equal(earlier(plans[0]), true, 'a rule captured earlier is unchanged');
});
test('a plan confirmed back in scope after Undo is selected again; an explicit exclusion stays excluded', () => {
  const plans = ['a', 'b', 'c'].map(id => plan(id, 'completed'));
  const selection = new PlanSelection();
  selection.reconcile('scope', plans, true); selection.selectAll();
  selection.toggle(plans[1]);
  selection.forget(['a']);
  selection.reconcile('scope', [...plans], true);
  assert.equal(selection.has('a'), true, 'the receipt departure is cleared when the plan returns');
  assert.equal(selection.has('b'), false, 'the user exclusion is kept');
  assert.equal(selection.count, 2);
  assert.equal(selection.snapshot().includes(plans[0]), true);
});

test('a cached, unchecked page cannot clear a receipt departure; a click on a departed row selects it', () => {
  const plans = ['a', 'b'].map(id => plan(id, 'completed'));
  const selection = new PlanSelection();
  selection.reconcile('scope', plans, true); selection.selectAll();
  selection.forget(['a']);
  selection.reconcile('scope', [...plans], true, false);
  assert.equal(selection.has('a'), false, 'no evidence that it returned');
  selection.toggle(plans[0]);
  assert.equal(selection.has('a'), true, 'an unpressed row is chosen by a click');
  assert.equal(selection.snapshot().includes(plans[0]), true, 'not recorded as an exclusion');
  selection.forget(['a']);
  selection.reconcile('scope', [...plans], true, true);
  assert.equal(selection.has('a'), true, 'a checked page is evidence');
});
test('an Undo receipt clears only the departure, not explicit exclusions', () => {
  const plans = ['a', 'b', 'c'].map(id => plan(id, 'completed'));
  const selection = new PlanSelection();
  selection.reconcile('scope', plans, true); selection.selectAll(); selection.toggle(plans[1]);
  selection.forget(['a', 'b']);
  selection.returned(['a', 'b']);
  assert.equal(selection.has('a'), true);
  assert.equal(selection.has('b'), false);
  assert.equal(selection.snapshot().includes(plans[0]), true);
});
