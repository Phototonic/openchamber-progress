// Contract checkpoint only; service projection and rendered inbox tests belong to their owners.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NEEDS_YOU_LIMITS, supportsNeedsYou, type NeedsYouRow } from '../../shared/needs-you.ts';
import { INBOX_WINDOW, INBOX_PARTIAL, INBOX_EMPTY } from '../fixtures/attention-contracts.ts';

test('inbox revision negotiation fails closed on absent, malformed and unknown capabilities', () => {
  for (const value of [undefined, null, false, true, 0, 2, '1', {}, []]) assert.equal(supportsNeedsYou(value), false);
  assert.equal(supportsNeedsYou(1), true);
});

test('frozen inbox wire examples distinguish complete empty from continuable observed counts', () => {
  const complete = JSON.parse(JSON.stringify(INBOX_WINDOW));
  assert.deepEqual(complete, INBOX_WINDOW);
  assert.equal(complete.sourceBinding.verified, true);
  assert.equal(complete.rows[0].source, complete.sourceBinding.sourceId);
  assert.equal(complete.rows[0].blocker.state, 'reported');
  if (complete.rows[0].blocker.state !== 'reported') throw new Error('reported fixture expected');
  assert.equal(complete.rows[0].blocker.annotation.validAtRevision, complete.rows[0].revision);
  assert.equal(complete.rows[0].timing?.kind, 'lower-bound');
  assert.equal(INBOX_EMPTY.coverage.complete, true);
  assert.deepEqual(INBOX_EMPTY.counts, { needsYou: 0, alsoBlocked: 0 });
  assert.equal(INBOX_PARTIAL.coverage.complete, false);
  assert.ok(INBOX_PARTIAL.nextCursor);
  assert.equal(INBOX_PARTIAL.counts.needsYou, 1);
  assert.ok(Object.isFrozen(INBOX_WINDOW.rows[0].blocker));
  assert.throws(() => { INBOX_WINDOW.rows[0].task.title = 'changed'; }, TypeError);
});

test('inbox bounds retain bounded search admission and shared history budgets', () => {
  assert.equal(NEEDS_YOU_LIMITS.plans, 64);
  assert.equal(NEEDS_YOU_LIMITS.rows, 50);
  assert.equal(NEEDS_YOU_LIMITS.responseBytes, 256 * 1024);
  assert.equal(NEEDS_YOU_LIMITS.cursorBytes, 4096);
  assert.equal(NEEDS_YOU_LIMITS.timingSnapshotVisits, 128);
  assert.equal(NEEDS_YOU_LIMITS.timingInputBytes, 8 * 1024 * 1024);
  // Fixed safe unknown/invalid forms; no annotation payload is needed to represent malformed data.
  const unknown: NeedsYouRow = { ...structuredClone(INBOX_WINDOW.rows[0]), group: 'also-blocked', blocker: { state: 'invalid' } };
  assert.deepEqual(unknown.blocker, { state: 'invalid' });
});
