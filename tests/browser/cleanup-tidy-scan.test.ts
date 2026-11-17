import test from 'node:test';
import assert from 'node:assert/strict';
import { CleanupScan, TIDY_LIMIT, tidyConfirmation, runTidy } from '../../ui/shared/cleanup.ts';
import { parsePlansPage } from '../../ui/shared/adapter.ts';
import { plansPage, summary } from './fixtures.ts';

const plans = (n: number, lifecycle: 'finished' | 'active' | 'cancelled' | 'failed' = 'finished') => parsePlansPage(JSON.stringify(plansPage(
  Array.from({ length: n }, (_, i) => summary(`p-${i}`, [], { lifecycle })),
))).data;

test('Tidy includes failed plans, excludes in-progress and follows the current archive view', () => {
  const closed = [...plans(1), ...plans(1, 'failed'), ...plans(1, 'cancelled')];
  assert.equal(tidyConfirmation([...closed, ...plans(1, 'active')], 'store', 'reading').targets.length, 3);
  assert.equal(tidyConfirmation(closed.map(p => ({ ...p, cleanup: { state: 'archived' as const, revision: 1 } })), 'store', 'reading', true).targets.length, 3);
  assert.equal(TIDY_LIMIT, 1000);
});

test('Check more continues the same bounded scan, without re-reading checked pages', async () => {
  const cursors: (string | null)[] = [];
  const scan = new CleanupScan('reading', 'store', false, async cursor => {
    cursors.push(cursor);
    const offset = Number(cursor ?? 0);
    return { plans: plans(50, offset < 2000 ? 'active' : 'failed').map((p, i) => ({ ...p, key: `s/${offset + i}`, id: `p-${offset + i}` })),
      visited: 50, nextCursor: offset >= 2050 ? null : String(offset + 50) };
  });
  const first = await scan.more(() => true);
  assert.equal(first?.total, 0);
  assert.equal(first?.unchecked, true);
  assert.equal(cursors.length, 40);
  const second = await scan.more(() => true);
  assert.equal(second?.total, 100);
  assert.equal(second?.unchecked, false);
  assert.equal(cursors[40], '2000');
  assert.equal(new Set(cursors).size, cursors.length);
});

test('retirement discards held scans; collecting targets stops at the confirmation ceiling', async () => {
  let current = true;
  const retired = new CleanupScan('reading', 'store', false, async () => {
    current = false;
    return { plans: plans(50), visited: 50, nextCursor: 'next' };
  });
  assert.equal(await retired.more(() => current), null);
  let reads = 0;
  const capped = new CleanupScan('reading', 'store', false, async () => {
    const offset = reads++ * 50;
    return { plans: plans(50).map((p, i) => ({ ...p, key: `s/${offset + i}` })), visited: 50, nextCursor: String(reads) };
  });
  const c = await capped.more(() => true);
  assert.equal(c?.targets.length, 1000);
  assert.equal(c?.limited, true);
  assert.equal(reads, 20);
});

test('task-heavy search pauses after 40 windows and Check more resumes without repeating windows', async () => {
  const candidates = plans(3);
  const cursors: (string | null)[] = [];
  const scan = new CleanupScan('search', 'store', false, async cursor => {
    cursors.push(cursor);
    const window = Number(cursor ?? 0);
    // Twenty task-hit windows for each plan, each using only one backend plan slot.
    return { plans: [candidates[Math.floor(window / 20)]], visited: 1,
      nextCursor: window === 59 ? null : String(window + 1) };
  }, true, 64);
  const first = await scan.more(() => true);
  assert.equal(cursors.length, 40);
  assert.equal(first?.targets.length, 2);
  assert.equal(first?.unchecked, true);
  const second = await scan.more(() => true);
  assert.equal(second?.targets.length, 3);
  assert.equal(second?.unchecked, false);
  assert.equal(cursors[40], '40');
  assert.equal(new Set(cursors).size, 60);
});

test('shared run engine strips acknowledgement for closed targets, skips active Tidy targets and stops after in-flight receipt', async () => {
  const targets = tidyConfirmation(plans(3), 'store', 'reading').targets;
  let current = true;
  const bodies: any[] = [];
  const result = await runTidy({ serviceRequest: async q => {
    const body = JSON.parse(q.body!); bodies.push(body); current = false;
    return { status: 200, body: JSON.stringify({ ...body, cleanup: { state: 'deleted', revision: body.cleanupRev + 1 } }) };
  } }, 'delete', targets, () => current);
  assert.equal(result.succeeded.length, 1);
  assert.equal(result.remaining.length, 2);
  assert.equal(bodies[0].active, undefined);
});
