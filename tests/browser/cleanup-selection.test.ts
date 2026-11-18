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
  s.forget(new Map<string, number | null>([[a.key, null]]));
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
  selection.forget(new Map<string, number | null>([['a', null]]));
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
  selection.forget(new Map<string, number | null>([['a', null]]));
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
  selection.forget(new Map<string, number | null>([['a', null]]));
  selection.reconcile('scope', [...plans], true, false);
  assert.equal(selection.has('a'), false, 'no evidence that it returned');
  selection.toggle(plans[0]);
  assert.equal(selection.has('a'), true, 'an unpressed row is chosen by a click');
  assert.equal(selection.snapshot().includes(plans[0]), true, 'not recorded as an exclusion');
  selection.forget(new Map<string, number | null>([['a', null]]));
  selection.reconcile('scope', [...plans], true, true);
  assert.equal(selection.has('a'), true, 'a checked page is evidence');
});
test('an Undo receipt clears only the departure, not explicit exclusions', () => {
  const plans = ['a', 'b', 'c'].map(id => plan(id, 'completed'));
  const selection = new PlanSelection();
  selection.reconcile('scope', plans, true); selection.selectAll(); selection.toggle(plans[1]);
  selection.forget(new Map<string, number | null>([['a', null], ['b', null]]));
  selection.returned(['a', 'b']);
  assert.equal(selection.has('a'), true);
  assert.equal(selection.has('b'), false);
  assert.equal(selection.snapshot().includes(plans[0]), true);
});

test('a departed row kept in a cached page is not counted as selected', () => {
  const plans = ['a', 'b'].map(id => plan(id, 'completed'));
  const selection = new PlanSelection();
  selection.reconcile('scope', plans, true); selection.selectAll();
  selection.forget(new Map<string, number | null>([['a', null]]));
  assert.equal(selection.count, 1);
  selection.reconcile('scope', [...plans], true, false);
  assert.equal(selection.count, 1, 'the cached row is known but not selected');
});
test('one click selects a row that was both excluded by the user and taken out by a receipt', () => {
  const plans = ['a', 'b'].map(id => plan(id, 'completed'));
  const selection = new PlanSelection();
  selection.reconcile('scope', plans, true); selection.selectAll();
  selection.toggle(plans[0]);
  selection.forget(new Map<string, number | null>([['a', null]]));
  selection.returned(['a']);
  assert.equal(selection.has('a'), false, 'passive handling keeps the exclusion');
  selection.forget(new Map<string, number | null>([['a', null]]));
  selection.toggle(plans[0]);
  assert.equal(selection.has('a'), true, 'an explicit click selects it in one step');
});

const cleaned = (id: string, revision: number): CleanupPlan => ({ ...plan(id, 'completed'), cleanup: { state: 'visible', revision } });
const departures = (...pairs: [string, number][]) => new Map<string, number | null>(pairs);

test('a departed plan found at a newer cleanup generation than its receipt is counted again; at that generation it is not', () => {
  const plans = ['a', 'b'].map(id => cleaned(id, 1));
  const selection = new PlanSelection();
  selection.reconcile('scope', plans, true); selection.selectAll();
  selection.forget(departures(['a', 3]));
  const rule = selection.snapshot().includes;
  assert.equal(rule(cleaned('a', 3)), false, 'still at the generation the receipt returned');
  assert.equal(rule(cleaned('a', 2)), false, 'an older copy is no evidence');
  assert.equal(rule(cleaned('a', 4)), true, 'restored or archived again elsewhere since');
  assert.equal(rule(cleaned('b', 1)), true, 'another plan is unaffected');
});
test('a departed plan the selection never loaded is counted again from the generation its receipt returned', () => {
  const selection = new PlanSelection();
  selection.reconcile('scope', [cleaned('a', 1)], true); selection.selectAll();
  // Select all archived a plan the page never loaded: only the receipt knows its generation.
  selection.forget(departures(['never-loaded', 7]));
  const rule = selection.snapshot().includes;
  assert.equal(rule(cleaned('never-loaded', 7)), false);
  assert.equal(rule(cleaned('never-loaded', 8)), true);
});
test('a deselected plan stays out at a newer generation, with or without a departure', () => {
  const plans = ['a', 'b'].map(id => cleaned(id, 1));
  const selection = new PlanSelection();
  selection.reconcile('scope', plans, true); selection.selectAll();
  selection.toggle(plans[0]);
  assert.equal(selection.snapshot().includes(cleaned('a', 9)), false, 'deselected only');
  selection.forget(departures(['a', 3]));
  assert.equal(selection.snapshot().includes(cleaned('a', 9)), false, 'deselected and departed');
  selection.returned(['a']);
  assert.equal(selection.snapshot().includes(cleaned('a', 9)), false, 'a receipt ends the departure only');
  selection.selectAll();
  assert.equal(selection.snapshot().includes(cleaned('a', 9)), true, 'Select all again replaces the selection');
});
test('a plan taken out with no generation to compare is not counted again by a count', () => {
  const selection = new PlanSelection();
  selection.reconcile('scope', [cleaned('a', 1)], true); selection.selectAll();
  selection.forget(new Map<string, number | null>([['a', null]]));
  assert.equal(selection.snapshot().includes(cleaned('a', 99)), false);
});
test('a later departure keeps the newer generation and one without a generation never ends by a count', () => {
  const selection = new PlanSelection();
  selection.reconcile('scope', [cleaned('a', 1), cleaned('b', 1)], true); selection.selectAll();
  selection.forget(departures(['a', 5], ['b', 5]));
  selection.forget(departures(['a', 3]));
  selection.forget(new Map<string, number | null>([['b', null]]));
  const rule = selection.snapshot().includes;
  assert.equal(rule(cleaned('a', 4)), false, 'the older reply cannot lower the generation');
  assert.equal(rule(cleaned('a', 6)), true);
  assert.equal(rule(cleaned('b', 99)), false, 'a deleted or vanished plan has no generation to supersede');
});

test('the row, the count and the plans of a snapshot agree with a count on a departed plan known at a newer generation', () => {
  const plans = ['a', 'b'].map(id => cleaned(id, 1));
  const selection = new PlanSelection();
  selection.reconcile('scope', plans, true); selection.selectAll();
  selection.forget(departures(['a', 3]));
  assert.equal(selection.has('a'), false);
  assert.equal(selection.count, 1);
  // A cached page shows the plan at the generation that took it out: still departed.
  selection.reconcile('scope', [cleaned('a', 3), plans[1]], true, false);
  assert.equal(selection.has('a'), false);
  assert.equal(selection.count, 1);
  // A cached page carrying it at a newer generation: the row, the bar count, the snapshot and a scan agree.
  selection.reconcile('scope', [cleaned('a', 4), plans[1]], true, false);
  assert.equal(selection.has('a'), true);
  assert.equal(selection.count, 2);
  const snapshot = selection.snapshot();
  assert.deepEqual(snapshot.plans.map(p => p.key).sort(), ['a', 'b']);
  assert.equal(snapshot.includes(cleaned('a', 4)), true);
  // A deselected plan still stays out everywhere.
  selection.toggle(cleaned('a', 4));
  assert.equal(selection.has('a'), false);
  assert.equal(selection.count, 1);
  assert.equal(selection.snapshot().includes(cleaned('a', 4)), false);
});
