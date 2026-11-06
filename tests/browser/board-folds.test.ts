import { test } from 'node:test';
import assert from 'node:assert/strict';
import { partitionBoardPlans } from '../../ui/shared/scope.ts';
import type { Lifecycle } from '../../ui/shared/model.ts';

const row = (key: string, lifecycle: Lifecycle) => Object.freeze({ key, lifecycle });

test('Current folds completed and cancelled together, retaining failures and original order', () => {
  const plans = Object.freeze([
    row('alpha/shared', 'completed'), row('alpha/active', 'active'),
    row('beta/shared', 'cancelled'), row('alpha/failed', 'failed'),
    row('alpha/last', 'completed'),
  ]);
  const { current, finished } = partitionBoardPlans(plans, false);
  assert.deepEqual(current, [plans[1], plans[3]]);
  assert.deepEqual(finished, [plans[0], plans[2], plans[4]]);
  assert.equal(finished[0], plans[0], 'the projection keeps the authoritative source-qualified object');
  assert.equal(current.length + finished.length, plans.length);
});

test('Archived exposes every lifecycle directly without a Finished fold', () => {
  const plans = [row('s/a', 'active'), row('s/b', 'completed'), row('s/c', 'cancelled'), row('s/d', 'failed')];
  const result = partitionBoardPlans(plans, true);
  assert.deepEqual(result.current, plans);
  assert.deepEqual(result.finished, []);
  assert.notEqual(result.current, plans);
});

test('empty lists remain empty in either browsing mode', () => {
  for (const archived of [false, true]) assert.deepEqual(partitionBoardPlans([], archived), { current: [], finished: [] });
});
