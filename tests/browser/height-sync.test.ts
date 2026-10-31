// Work Status frame height: the guest re-sends a dropped height a bounded number of times, and never
// re-sends one the host applied (or clamped). Fake host and frame scheduler; no timers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HeightSync, HEIGHT_RETRY_FRAMES } from '../../ui/shared/height.ts';

/**
 * A host frame at `frame` px; `apply(call, h)` decides what the host does with each request. The
 * scheduler RETAINS every queued callback until it runs or is explicitly cancelled, as
 * requestAnimationFrame does, so leaked chains are visible.
 */
function harness(apply: (call: number, h: number) => number | null, frame = 24) {
  const sent: number[] = [];
  const waits: number[] = [];
  const queue: { fn: () => void; live: boolean }[] = [];
  let shown = true;
  const sync = new HeightSync({
    send: async (h) => { sent.push(h); const next = apply(sent.length, h); if (next !== null) frame = next; },
    actual: () => frame,
    visible: () => shown,
    afterFrames: (n, fn) => { waits.push(n); const job = { fn, live: true }; queue.push(job); return () => { job.live = false; }; },
  });
  /** Runs live queued checks in order until none is left (bounded). Paused while hidden, like rAF. */
  const settle = async () => {
    for (let i = 0; i < 20 && shown; i++) {
      const job = queue.find((j) => j.live);
      if (!job) break;
      job.live = false; await Promise.resolve(); job.fn(); await Promise.resolve();
    }
  };
  const pending = () => queue.filter((j) => j.live).length;
  const setVisible = (v: boolean) => { shown = v; if (v) sync.visible(); else sync.hidden(); };
  return { sync, sent, waits, settle, pending, setVisible, frame: () => frame };
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

test('height: many visible paints keep at most one pending check chain', () => {
  const h = harness(() => null);
  for (let i = 0; i < 50; i++) { h.sync.request(100 + i); assert.ok(h.pending() <= 1); }
  assert.equal(h.pending(), 1);
});

test('height: paints while hidden send and schedule nothing; on return only the latest height is sent and checked once', async () => {
  const h = harness((_call, height) => height, 31);
  h.setVisible(false);
  for (let i = 0; i < 50; i++) h.sync.request(100 + i);
  assert.deepEqual(h.sent, [], 'nothing sent while hidden');
  assert.equal(h.pending(), 0, 'nothing queued while hidden');
  h.setVisible(true);
  assert.deepEqual(h.sent, [149], 'the latest height, once');
  assert.equal(h.pending(), 1, 'one check for it');
  await h.settle();
  assert.deepEqual(h.sent, [149]);
  assert.equal(h.pending(), 0);
  assert.equal(h.frame(), 149);
});

test('height: hiding cancels a pending check; on return the latest height is re-sent and checked once', async () => {
  const h = harness((call, height) => (call === 1 ? null : height));
  h.sync.request(200);
  assert.equal(h.pending(), 1);
  h.setVisible(false);
  assert.equal(h.pending(), 0, 'the queued check is cancelled on hide');
  h.sync.request(250); h.sync.request(300);
  assert.deepEqual(h.sent, [200]);
  h.setVisible(true);
  assert.deepEqual(h.sent, [200, 300]);
  assert.equal(h.pending(), 1);
  await h.settle();
  assert.equal(h.frame(), 300);
  assert.equal(h.pending(), 0);
  // Nothing unverified: becoming visible again sends nothing.
  h.setVisible(false); h.setVisible(true);
  assert.deepEqual(h.sent, [200, 300]);
});

test('height: dispose cancels pending work and nothing runs or sends afterwards', async () => {
  const h = harness(() => null);
  h.sync.request(200);
  h.sync.dispose();
  assert.equal(h.pending(), 0);
  h.sync.request(300); h.setVisible(false); h.setVisible(true);
  await h.settle();
  assert.deepEqual(h.sent, [200]);
  assert.equal(h.pending(), 0);
});
