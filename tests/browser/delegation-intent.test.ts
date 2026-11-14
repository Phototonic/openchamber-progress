// DTO examples only: no actor seeding is claimed to demonstrate dispatch or assignment authority.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DELEGATION_VIEW_LIMITS, supportsDelegationIntent } from '../../shared/delegation-view.ts';
import { INTENT_PENDING, INTENT_RESERVED, INTENT_CANCELLED, INTENT_REFUSED, INTENT_UNAVAILABLE } from '../fixtures/attention-contracts.ts';

test('delegation overlay requires its exact observed capability', () => {
  for (const value of [undefined, null, true, 0, 2, '1', {}]) assert.equal(supportsDelegationIntent(value), false);
  assert.equal(supportsDelegationIntent(1), true);
});

test('frozen intent states carry independent tokens without inventing progress revisions', () => {
  const states = [INTENT_PENDING, INTENT_RESERVED, INTENT_CANCELLED, INTENT_REFUSED, INTENT_UNAVAILABLE];
  assert.equal(new Set(states.map(s => s.revision)).size, 1);
  assert.equal(new Set(states.map(s => s.token)).size, states.length);
  for (const state of states) {
    assert.deepEqual(JSON.parse(JSON.stringify(state)), state);
    assert.ok(Object.isFrozen(state.result));
  }
  assert.equal(INTENT_UNAVAILABLE.result.availability, 'unavailable');
  assert.equal('disposition' in INTENT_UNAVAILABLE.result, false);
  assert.equal(INTENT_REFUSED.result.availability === 'ready' && INTENT_REFUSED.result.disposition.state, 'refused');
  assert.equal(INTENT_PENDING.result.availability === 'ready' && INTENT_PENDING.result.disposition.state, 'pending');
  assert.equal(DELEGATION_VIEW_LIMITS.tasks, 50);
  assert.equal(DELEGATION_VIEW_LIMITS.receipts, 128);
});
