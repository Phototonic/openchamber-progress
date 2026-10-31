// Work Status frame height: the guest re-sends a dropped height a bounded number of times, and never
// re-sends one the host applied (or clamped). Fake host and frame scheduler; no timers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HeightSync, HEIGHT_RETRY_FRAMES } from '../../ui/shared/height.ts';

/** A host frame at `frame` px; `apply(call, h)` decides what the host does with each request. */
function harness(apply: (call: number, h: number) => number | null, frame = 24) {
  const sent: number[] = [];
  const waits: number[] = [];
  let pending: (() => void) | null = null;
  const sync = new HeightSync({
    send: async (h) => { sent.push(h); const next = apply(sent.length, h); if (next !== null) frame = next; },
    actual: () => frame,
    afterFrames: (n, fn) => { waits.push(n); pending = fn; },
  });
  /** Runs scheduled checks until none is pending (bounded by the helper itself). */
  const settle = async () => { for (let i = 0; i < 20 && pending; i++) { const fn = pending; pending = null; await Promise.resolve(); fn(); await Promise.resolve(); } };
  return { sync, sent, waits, settle, frame: () => frame };
}

test('height: a host that drops the first request gets it again and the frame recovers', async () => {
  const h = harness((call, height) => (call === 1 ? null : height));
  h.sync.request(364);
  await h.settle();
  assert.deepEqual(h.sent, [364, 364]);
  assert.equal(h.frame(), 364);
});

test('height: an applied request is never sent again', async () => {
  const h = harness((_call, height) => height);
  h.sync.request(364);
  await h.settle();
  assert.deepEqual(h.sent, [364]);
  assert.deepEqual(h.waits, [HEIGHT_RETRY_FRAMES[0]], 'one check, then done');
});

test('height: a clamped request counts as applied (the host changed the frame)', async () => {
  const h = harness((_call, height) => Math.min(height, 320));
  h.sync.request(364);
  await h.settle();
  assert.deepEqual(h.sent, [364]);
  assert.equal(h.frame(), 320);
  // A later paint asking for the same clamped height reports it once, with no re-sends.
  const waits = h.waits.length;
  h.sync.request(364);
  await h.settle();
  assert.deepEqual(h.sent, [364, 364]);
  assert.equal(h.waits.length, waits, 'no further checks');
});

test('height: after a clamp, another height above the cap is not re-sent', async () => {
  const h = harness((_call, height) => Math.min(height, 320), 149);
  h.sync.request(364);
  await h.settle();
  const waits = h.waits.length;
  h.sync.request(361);
  await h.settle();
  assert.deepEqual(h.sent, [364, 361], 'reported once, no re-sends against the cap');
  assert.equal(h.waits.length, waits);
  // A height below the cap is a real change again and is checked.
  h.sync.request(200);
  await h.settle();
  assert.deepEqual(h.sent, [364, 361, 200]);
  assert.equal(h.frame(), 200);
});

test('height: retries are bounded and back off; nothing is sent once they are spent', async () => {
  const h = harness(() => null);
  h.sync.request(364);
  await h.settle();
  assert.deepEqual(h.sent, [364, ...HEIGHT_RETRY_FRAMES.map(() => 364)]);
  assert.deepEqual(h.waits, [...HEIGHT_RETRY_FRAMES]);
  assert.ok(HEIGHT_RETRY_FRAMES.every((n, i) => i === 0 || n > HEIGHT_RETRY_FRAMES[i - 1]), 'backoff grows');
});

test('height: a newer request replaces the pending check; an unchanged height sends nothing new', async () => {
  const h = harness((call, height) => (call === 1 ? null : height));
  h.sync.request(149);
  h.sync.request(364);
  await h.settle();
  assert.deepEqual(h.sent, [149, 364], 'the stale 149 is never retried');
  assert.equal(h.frame(), 364);
  h.sync.request(364);
  await h.settle();
  assert.deepEqual(h.sent, [149, 364, 364], 'a paint still reports its height once (as before)');
});
