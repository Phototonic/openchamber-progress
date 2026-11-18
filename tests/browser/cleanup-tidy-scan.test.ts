import test from 'node:test';
import assert from 'node:assert/strict';
import { CleanupScan, TIDY_LIMIT, tidyConfirmation, runTidy, cleanupRefused, cleanupError } from '../../ui/shared/cleanup.ts';
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
  assert.equal(reads, 21, 'only a further confirmed match establishes that more plans match');
});

test('exactly 1,000 matches followed only by nonmatching plans never claim more plans match', async () => {
  let reads = 0;
  const scan = new CleanupScan('reading', 'store', false, async () => {
    const offset = reads++ * 50;
    const matching = offset < 1000;
    return { plans: plans(50, matching ? 'finished' : 'active').map((p, i) => ({ ...p, key: `s/${offset + i}` })), visited: 50, nextCursor: String(reads) };
  });
  const first = await scan.more(() => true);
  assert.equal(first?.targets.length, 1000);
  assert.equal(first?.limited, false, 'a remaining cursor alone is not a match');
  assert.equal(first?.unchecked, true, 'say that more plans were not checked');
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

type Reply = { ok: true } | { status: number; body: string } | { throws: Error };
const lost = Object.assign(new Error('host timed out'), { code: 'HOST_TIMEOUT' });
/** One scripted reply per plan id; an id with no entry is archived. */
function fakeHost(replies: Record<string, Reply>, onRequest?: (plan: string) => void) {
  const asked: string[] = [];
  return { asked, host: { serviceRequest: async (q: { body?: string }) => {
    const body = JSON.parse(q.body!); asked.push(body.plan); onRequest?.(body.plan);
    const reply = replies[body.plan] ?? { ok: true };
    if ('throws' in reply) throw reply.throws;
    if ('status' in reply) return { status: reply.status, body: reply.body };
    return { status: 200, body: JSON.stringify({ ...body, cleanup: { state: 'archived', revision: body.cleanupRev + 1 } }) };
  } } };
}
const refusal = (status: number, error: string): Reply => ({ status, body: JSON.stringify({ error }) });

const attemptedFailures: [name: string, reply: Reply, unconfirmed: number][] = [
  ['refused as changed', refusal(409, 'conflict'), 0],
  ['refused as closed', refusal(409, 'closed'), 0],
  ['refused as a reused operation', refusal(409, 'operation-reused'), 0],
  ['refused as not found', refusal(404, 'not-found'), 0],
  ['store busy', refusal(503, 'busy'), 0],
  ['lost reply', { throws: lost }, 1],
  ['unreadable receipt', { status: 200, body: 'not a receipt' }, 1],
  ['receipt for another plan', { status: 200, body: JSON.stringify({ storeId: 'store', source: 'other', plan: 'p-1', oid: 'x', cleanup: { state: 'archived', revision: 1 } }) }, 1],
  ['service failure with no known refusal code', refusal(500, 'internal'), 1],
  ['withdrawn store (503 storage)', refusal(503, 'storage'), 1],
  // The fake host's plain rejection stands for an attempt that fails before the service could receive it
  // (a refusal by the frame's own guard): the engine cannot tell it from a lost reply, so it is unconfirmed.
  ['attempt that failed before reaching the service', { throws: new Error('The frame refused the request.') }, 1],
];
for (const [name, reply, unconfirmed] of attemptedFailures) test(`run engine: ${name} is ${unconfirmed ? 'unconfirmed' : 'skipped'}`, async () => {
  const targets = tidyConfirmation(plans(2), 'store', 'reading').targets;
  const result = await runTidy(fakeHost({ 'p-1': reply }).host, 'archive', targets, () => true);
  assert.equal(result.attempted, 2);
  assert.equal(result.succeeded.length, 1);
  assert.equal(result.unconfirmed ?? 0, unconfirmed);
  assert.deepEqual(result.remaining.map(t => t.key), [targets[1].key], 'the plan with no receipt stays in remaining, for Try again');
});

test('refusal classes: only a refusal the service answered is skipped; every other code, a withdrawn store and a lost reply are unconfirmed', () => {
  for (const code of ['conflict', 'closed', 'operation-reused', 'not-found', 'busy']) assert.equal(cleanupRefused(code), true, code);
  for (const code of ['storage', 'internal', 'http-500', 'HOST_TIMEOUT', 'CONTRACT', 'UNKNOWN', '']) assert.equal(cleanupRefused(code), false, code);
  // The single-plan message agrees: a refusal never reads as "may have reached the service".
  for (const code of ['conflict', 'closed', 'operation-reused', 'not-found', 'busy', 'storage', 'HOST_TIMEOUT']) {
    assert.equal(cleanupRefused(code), cleanupError(code) !== cleanupError(''), code);
  }
});

test('run engine: a plan left out before sending or after Stop is skipped, never unconfirmed', async () => {
  const targets = tidyConfirmation(plans(4), 'store', 'reading').targets;
  let current = true;
  const { host, asked } = fakeHost({}, plan => { if (plan === 'p-2') current = false; });
  const result = await runTidy(host, 'archive', targets, () => current, undefined, false, target => target.request.plan !== 'p-1');
  assert.deepEqual(asked, ['p-0', 'p-2'], 'p-1 was left out before sending and p-3 was not sent after Stop');
  assert.equal(result.attempted, 2);
  assert.equal(result.succeeded.length, 2);
  assert.equal(result.unconfirmed ?? 0, 0);
  assert.deepEqual(result.remaining.map(t => t.request.plan), ['p-1', 'p-3']);
  // An in-progress plan that Tidy does not attempt is skipped as well.
  const idle = fakeHost({});
  const skipped = await runTidy(idle.host, 'archive', [{ ...targets[0], lifecycle: 'active' as const }], () => true);
  assert.deepEqual([idle.asked.length, skipped.unconfirmed ?? 0, skipped.remaining.length], [0, 0, 1]);
});

test('run engine: skipped and unconfirmed plans stay in remaining with the generation they were given, and succeeded holds neither', async () => {
  const targets = tidyConfirmation(plans(6), 'store', 'reading').targets;
  let current = true;
  const { host } = fakeHost({ 'p-1': refusal(409, 'conflict'), 'p-2': { throws: lost }, 'p-3': { throws: new Error('x') } }, plan => { if (plan === 'p-3') current = false; });
  const result = await runTidy(host, 'archive', targets, () => current);
  assert.equal(result.total, 6);
  assert.equal(result.attempted, 4);
  assert.deepEqual(result.succeeded.map(t => t.request.plan), ['p-0']);
  assert.equal(result.unconfirmed, 2);
  assert.deepEqual(result.remaining.map(t => t.request.plan), ['p-1', 'p-2', 'p-3', 'p-4', 'p-5']);
  for (const kept of result.remaining) assert.deepEqual(kept.request, targets.find(t => t.key === kept.key)!.request, 'same revision, generation and operation id: nothing is rebound');
  assert.equal(result.succeeded[0].request.cleanupRev, targets[0].request.cleanupRev + 1, 'only a receipt moves the generation');
});
