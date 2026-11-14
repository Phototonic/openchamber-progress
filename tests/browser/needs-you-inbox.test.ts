// Contract checkpoint (frozen wire examples), then the inbox UI's adapter, list extension,
// continuation controller and revalidation logic. Rendered behaviour: needs-you-inbox-qa.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NEEDS_YOU_LIMITS, supportsNeedsYou, type NeedsYouRow } from '../../shared/needs-you.ts';
import { INBOX_WINDOW, INBOX_PARTIAL, INBOX_EMPTY } from '../fixtures/attention-contracts.ts';
import { parseNeedsYouWindow, parseHealth } from '../../ui/shared/adapter.ts';
import { readList, readNeedsYou, readSearchState, type ServiceHost } from '../../ui/shared/source.ts';
import { InboxController, inboxRequest } from '../../ui/shared/inbox.ts';
import { checkReading, inboxSummary, readingRequest, ReadingFocus, type InboxReading } from '../../ui/shared/inbox-view.ts';
import type { InboxWindowView, PlanDetail } from '../../ui/shared/model.ts';
import type { GuestRequest, GuestRequestResult } from '@openchamber/sdk';
import { HEALTH, SRC, OTHER_SRC, envelope, plansPage, summary } from './fixtures.ts';

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

// ---- Inbox UI (lane I1): adapter, list extension, continuation controller and view logic ----

type Rec = Record<string, any>;
const STORE = 'store-1';
const PIN = { storeId: STORE, binding: { sourceId: SRC, verified: true } };
const ok = (body: unknown): GuestRequestResult => ({ status: 200, body: JSON.stringify(body) });
/** A wire window in the fixture store/source: `rows` are [plan, task, category | 'absent' | 'invalid' | null]. */
function wire(rows: [string, string, string | null][], extra: Rec = {}): Rec {
  const base = structuredClone(INBOX_WINDOW) as Rec;
  const template = base.rows[0];
  const built = rows.map(([plan, task, category]) => {
    const row = { ...structuredClone(template), source: SRC, plan, planTitle: `Plan ${plan}`, task: { ...template.task, id: task, title: `Task ${task}` } };
    if (category === 'absent' || category === 'invalid') row.blocker = { state: category };
    else { row.blocker = structuredClone(template.blocker); if (category === null) delete row.blocker.annotation.category; else row.blocker.annotation.category = category; }
    row.group = category === 'decision' || category === 'review' ? 'needs-you' : 'also-blocked';
    return row;
  });
  const counts = { needsYou: built.filter((r) => r.group === 'needs-you').length, alsoBlocked: built.filter((r) => r.group === 'also-blocked').length };
  return { ...base, storeId: STORE, sourceBinding: { sourceId: SRC, verified: true }, rows: built, counts, ...extra };
}
const partial = (cursor: string) => ({ nextCursor: cursor, coverage: { kind: 'observed-current', complete: false, exhausted: false, gapped: false, skippedRecords: 0, reasons: [] } });
const parse = (v: Rec, previous: InboxWindowView['counts'] | null = null, timing = true) => parseNeedsYouWindow(v, PIN, previous, timing, 1000);

test('inbox windows are re-validated: identity, category grouping, counts, coverage and timing anchors', () => {
  const w = parse(wire([['plan-alpha', 'a', 'decision'], ['plan-alpha', 'b', 'review'], ['plan-beta', 'c', 'dependency'], ['plan-beta', 'd', 'unclassified'], ['plan-beta', 'e', 'absent'], ['plan-beta', 'f', 'invalid'], ['plan-beta', 'g', null]], { counts: { needsYou: 2, alsoBlocked: 5 } }));
  assert.deepEqual(w.counts, { needsYou: 2, alsoBlocked: 5 });
  assert.deepEqual(w.rows.map((r) => r.group), ['needs-you', 'needs-you', 'also-blocked', 'also-blocked', 'also-blocked', 'also-blocked', 'also-blocked']);
  assert.deepEqual(w.rows[4].blocker, { state: 'absent' });
  assert.equal(w.rows[0].blocker.state === 'reported' && w.rows[0].blocker.reason, 'Choose <one> option', 'reported text stays literal');
  assert.equal(w.rows[0].wait?.kind, 'lower-bound');
  assert.equal(w.rows[0].wait?.receivedAt, 1000, 'monotonic receipt anchor, never browser wall time');
  assert.equal(w.coverage.complete, true);
  const refuse = (v: Rec, why: string, previous: InboxWindowView['counts'] | null = null) => assert.throws(() => parse(v, previous), Error, why);
  refuse({ ...wire([['p', 'a', 'decision']]), storeId: 'store-other' }, 'another store');
  refuse({ ...wire([['p', 'a', 'decision']]), sourceBinding: { sourceId: SRC, verified: false } }, 'unverified binding');
  const foreign = wire([['p', 'a', 'decision']]); foreign.rows[0].source = OTHER_SRC; refuse(foreign, 'equal IDs from another source never leak in');
  const promoted = wire([['p', 'a', 'external']]); promoted.rows[0].group = 'needs-you'; promoted.counts = { needsYou: 1, alsoBlocked: 0 }; refuse(promoted, 'only decision/review are Needs you');
  const demoted = wire([['p', 'a', 'decision']]); demoted.rows[0].group = 'also-blocked'; demoted.counts = { needsYou: 0, alsoBlocked: 1 }; refuse(demoted, 'a decision is never hidden in Also blocked');
  refuse(wire([['p', 'a', 'decision'], ['p', 'a', 'decision']], { counts: { needsYou: 2, alsoBlocked: 0 } }), 'a task appears once');
  refuse(wire([['p', 'a', 'decision']], { counts: { needsYou: 3, alsoBlocked: 0 } }), 'counts must match rows');
  refuse(wire([['p', 'a', 'decision']], { nextCursor: 'more' }), 'complete with a cursor');
  refuse(wire([['p', 'a', 'decision']], { coverage: { kind: 'observed-current', complete: true, exhausted: true, gapped: true, skippedRecords: 1, reasons: ['invalid-snapshot'] } }), 'complete with a gap');
  const long = wire([['p', 'a', 'decision']]); long.rows[0].blocker.annotation.reason = 'x'.repeat(600); refuse(long, 'oversized reported text');
  const stale = wire([['p', 'a', 'decision']]); stale.rows[0].blocker.annotation.validAtRevision = 2; refuse(stale, 'details from an earlier revision');
  const closed = wire([['p', 'a', 'decision']]); closed.rows[0].cleanup = { state: 'archived', revision: 1 }; refuse(closed, 'archived plans are not eligible');
  const group = wire([['p', 'a', 'decision']]); group.rows[0].task.kind = 'group'; refuse(group, 'groups never enter the inbox');
  const leak = wire([['p', 'a', 'absent']]); leak.rows[0].blocker.annotation = { reason: 'hidden' }; refuse(leak, 'unusable details never carry text');
  // Continuation counts are cumulative: they grow by exactly this window's rows.
  const next = wire([['q', 'z', 'review']], { counts: { needsYou: 3, alsoBlocked: 5 } });
  assert.deepEqual(parse(next, { needsYou: 2, alsoBlocked: 5 }).counts, { needsYou: 3, alsoBlocked: 5 });
  refuse(next, 'per-page deltas are not cumulative counts', { needsYou: 0, alsoBlocked: 0 });
  // No timing requested: any supplied is ignored, so the wait is unavailable, never zero.
  assert.equal(parse(wire([['p', 'a', 'decision']]), null, false).rows[0].wait, null);
  const skewed = wire([['p', 'a', 'decision']]); skewed.rows[0].timing.since = '2026-01-02T00:00:00.000Z';
  assert.throws(() => parse(skewed), Error, 'a wait starting after the read is refused');
});

function service(handler: (q: GuestRequest) => GuestRequestResult | Promise<GuestRequestResult>) {
  const calls: GuestRequest[] = [];
  const host: ServiceHost = { serviceRequest: async (q) => { calls.push(q); return handler(q); } };
  return { host, calls };
}
const plans = [summary('plan-alpha', [{ id: 'a', title: 'A', kind: 'task', status: 'blocked' }])];

test('the first window rides on the first list page only when advertised; it never fails the list read', async () => {
  const capable = { ...HEALTH, needsYouInbox: 1 };
  assert.equal(parseHealth(JSON.stringify(capable)).needsYouInbox, 1);
  assert.equal(parseHealth(JSON.stringify({ ...HEALTH, needsYouInbox: 2 })).needsYouInbox, undefined, 'unknown revision is unavailable');
  for (const [demand, timing] of [['rows', '1'], ['count', undefined]] as const) {
    const s = service((q) => q.path === '/health' ? ok(capable) : ok({ ...plansPage(plans, q.query?.cursor ? null : 'page-2'), needsYou: q.query?.cursor ? undefined : wire([['plan-alpha', 'a', 'decision']]) }));
    const r = await readList(s.host, { session: 'ses_fixture_main_M' }, 10, { demand, mono: () => 42 });
    assert.ok(r.ok && r.read && 'inbox' in r);
    const lists = s.calls.filter((q) => q.path === '/v1/plans');
    assert.equal(lists.length, 2);
    assert.equal(lists[0].query?.needsYou, '1');
    assert.equal(lists[0].query?.needsYouTiming, timing, `${demand}: waiting times only for displayed rows`);
    assert.equal(lists[0].query?.session, 'ses_fixture_main_M', 'ordinary list scope is unchanged');
    assert.equal(lists[1].query?.needsYou, undefined, 'never once per list page');
    assert.ok(r.inbox?.state === 'ready' && r.inbox.window.rows[0].task.id === 'a');
    assert.equal(s.calls.some((q) => q.path === '/v1/needs-you'), false, 'no extra request');
  }
  const older = service((q) => q.path === '/health' ? ok(HEALTH) : ok(plansPage(plans)));
  const r1 = await readList(older.host, { session: 'x' }, 10, { demand: 'rows', mono: () => 0 });
  assert.ok(r1.ok && r1.read && r1.inbox?.state === 'unsupported');
  assert.equal(older.calls.find((q) => q.path === '/v1/plans')?.query?.needsYou, undefined, 'an older service is never sent the extension');
  const broken = service((q) => q.path === '/health' ? ok(capable) : ok({ ...plansPage(plans), needsYou: { ...wire([['p', 'a', 'decision']]), counts: { needsYou: 9, alsoBlocked: 0 } } }));
  const r2 = await readList(broken.host, { session: 'x' }, 10, { demand: 'rows', mono: () => 0 });
  assert.ok(r2.ok && r2.read && r2.read.plans.length === 1 && r2.inbox?.state === 'invalid', 'an unreadable summary is unavailable, the list still reads');
  const missing = service((q) => q.path === '/health' ? ok(capable) : ok(plansPage(plans)));
  const r3 = await readList(missing.host, { session: 'x' }, 10, { demand: 'rows', mono: () => 0 });
  assert.ok(r3.ok && r3.read && r3.inbox?.state === 'missing', 'asked but absent is not an empty inbox');
  const unbound = service((q) => q.path === '/health' ? ok(capable) : ok({ ...plansPage(plans, null, { sourceBinding: { sourceId: SRC, verified: false } }), needsYou: wire([['p', 'a', 'decision']]) }));
  const r4 = await readList(unbound.host, { session: 'x' }, 10, { demand: 'rows', mono: () => 0 });
  assert.ok(r4.ok && r4.read && r4.inbox?.state === 'unverified');
  const plain = service((q) => q.path === '/health' ? ok(capable) : ok(plansPage(plans)));
  const r5 = await readList(plain.host, { session: 'x' });
  assert.ok(r5.ok && !('inbox' in r5) && plain.calls.find((q) => q.path === '/v1/plans')?.query?.needsYou === undefined, 'surfaces without the inbox ask for nothing');
});

const settle = async () => { for (let i = 0; i < 8; i++) await new Promise<void>((r) => setImmediate(r)); };
function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; }
const first = (v: Rec) => ({ state: 'ready' as const, window: parse(v) });

test('search freshness carries an optional inbox without making its absence fail freshness', async () => {
  const keys = [{ source: SRC, plan: 'p' }];
  const s = service(() => ok({ ...envelope(), planTaskSearch: 1, data: [{ ...keys[0], exists: true, revision: 3, cleanup: { state: 'visible', revision: 0 } }], needsYou: wire([['p', 'a', 'decision']]) }));
  const r = await readSearchState(s.host, STORE, keys, { demand: 'rows', mono: () => 42 });
  assert.equal(s.calls[0].query?.needsYou, '1');
  assert.equal(s.calls[0].query?.needsYouTiming, '1');
  assert.ok(r.ok && r.inbox?.state === 'ready');
  if (r.ok && r.inbox?.state === 'ready') assert.equal(r.inbox.window.rows[0].wait?.receivedAt, 42);
});

test('a cursor-only first-window change retires held continuation and uses the new cursor', async () => {
  const held = deferred<GuestRequestResult>();
  const s = service(() => held.promise);
  const c = new InboxController({ service: () => s.host, visible: () => true, changed: () => {} });
  c.adopt('owner', first(wire([['p', 'a', 'decision']], partial('old-cursor'))));
  c.more();
  assert.equal(c.adopt('owner', first(wire([['p', 'a', 'decision']], partial('new-cursor')))), true);
  assert.equal(c.model()!.restarted, true);
  held.resolve(ok(wire([['q', 'b', 'review']], { counts: { needsYou: 2, alsoBlocked: 0 } })));
  await settle();
  assert.equal(c.model()!.needsYou.length, 1, 'retired reply cannot splice old pages');
  c.more();
  assert.equal(s.calls.at(-1)?.query?.cursor, 'new-cursor');
});

test('continuation is explicit, pinned and cumulative; held, hidden and moved traversals restart honestly', async () => {
  let held: ReturnType<typeof deferred<GuestRequestResult>> | null = null;
  const s = service((q) => (held = deferred<GuestRequestResult>(), held.promise));
  let visible = true, changes = 0;
  const c = new InboxController({ service: (current) => ({ serviceRequest: (q) => current() ? s.host.serviceRequest(q) : Promise.reject(new Error('Retired read')) }), visible: () => visible, changed: () => { changes++; }, mono: () => 7 });
  const owner = JSON.stringify(['acct', 'store-1|src-local|true']);
  const w1 = wire([['plan-alpha', 'a', 'decision'], ['plan-beta', 'c', 'external']], partial('cursor-1'));
  assert.equal(c.adopt(owner, first(w1)), true);
  assert.equal(c.adopt(owner, first({ ...structuredClone(w1), readAt: '2026-01-01T00:00:09.000Z', rows: w1.rows.map((r: Rec) => ({ ...r, timing: { ...r.timing, readAt: '2026-01-01T00:00:09.000Z' } })) })), false, 'a new read time alone repaints nothing');
  let m = c.model()!;
  assert.equal(m.complete, false); assert.equal(m.canContinue, true);
  assert.equal(inboxSummary(m, 'en'), 'At least 1 task needs you');
  assert.equal(inboxSummary(m, 'ru'), 'Нужно ваше участие: не менее 1 задачи');
  assert.equal(s.calls.length, 0, 'nothing loads more on its own');
  c.panel()!.more();
  assert.equal(s.calls.length, 1);
  const q = s.calls[0];
  assert.equal(q.path, '/v1/needs-you');
  assert.deepEqual({ ...q.query }, { storeId: STORE, binding: JSON.stringify({ sourceId: SRC, verified: true }), source: SRC, cursor: 'cursor-1', limit: '50', timing: '1' });
  c.panel()!.more();
  assert.equal(s.calls.length, 1, 'one continuation at a time');
  assert.equal(c.model()!.loadingMore, true);
  // The next window repeats a row from the first (a task appears once) and adds two more.
  held!.resolve(ok(wire([['plan-alpha', 'a', 'decision'], ['plan-gamma', 'e', 'review']], { counts: { needsYou: 3, alsoBlocked: 1 } })));
  await settle();
  m = c.model()!;
  assert.deepEqual(m.needsYou.map((r) => r.task.id), ['a', 'e']);
  assert.deepEqual(m.counts, { needsYou: 3, alsoBlocked: 1 });
  assert.equal(m.complete, true);
  assert.equal(inboxSummary(m, 'en'), '3 tasks need you');
  assert.equal(inboxSummary(m, 'ru'), 'Нужно ваше участие: 3 задачи');
  // A different first window never splices with pages from the old traversal.
  const w2 = wire([['plan-alpha', 'a', 'decision'], ['plan-beta', 'c', 'external'], ['plan-beta', 'd', 'other']], partial('cursor-2'));
  assert.equal(c.adopt(owner, first(w2)), true);
  m = c.model()!;
  assert.equal(m.restarted, true); assert.deepEqual(m.needsYou.map((r) => r.task.id), ['a']); assert.equal(m.complete, false);
  // A held continuation retired by hiding the frame paints and requests nothing more.
  c.panel()!.more(); assert.equal(s.calls.length, 2);
  c.retire('hidden');
  const before = changes;
  held!.resolve(ok(wire([['plan-z', 'z', 'review']], { counts: { needsYou: 2, alsoBlocked: 2 } })));
  await settle();
  assert.equal(c.model()!.needsYou.length, 1); assert.equal(changes, before);
  visible = false; c.panel()!.more(); assert.equal(s.calls.length, 2, 'never while hidden'); visible = true;
  // 409: the pinned traversal moved; restart instead of retrying the cursor.
  c.panel()!.more(); held!.resolve({ status: 409, body: JSON.stringify({ error: 'conflict' }) }); await settle();
  m = c.model()!; assert.equal(m.restarted, true); assert.equal(m.moreFailed, null); assert.equal(s.calls.length, 3);
  // Other failures keep loaded rows and offer a retry.
  c.panel()!.more(); held!.resolve({ status: 503, body: JSON.stringify({ error: 'busy' }) }); await settle();
  assert.equal(c.model()!.moreFailed?.kind, 'busy'); assert.equal(c.model()!.needsYou.length, 1);
  // Another store/binding forgets everything; a control painted under the old owner does nothing.
  const stale = c.panel()!;
  c.adopt(JSON.stringify(['acct', 'store-2|src-local|true']), { state: 'unsupported' });
  stale.more(); stale.expand(true);
  assert.equal(s.calls.length, 4); assert.equal(c.model()!.availability, 'unsupported');
});

test('readNeedsYou refuses replies for another store or binding and oversized bodies', async () => {
  const request = { storeId: STORE, binding: { sourceId: SRC, verified: true }, source: SRC, cursor: 'c', limit: 50, timing: true };
  const other = service(() => ok({ ...wire([['p', 'a', 'decision']]), storeId: 'store-9' }));
  const r = await readNeedsYou(other.host, request, null, () => 0);
  assert.ok(!r.ok && r.failure.kind === 'invalid');
  const big = service(() => ({ status: 200, body: JSON.stringify({ ...wire([]), pad: 'x'.repeat(300 * 1024) }) }));
  assert.ok(!(await readNeedsYou(big.host, request, null, () => 0)).ok);
});

test('a complete empty first group says nothing needs you, even with Also blocked; partial zero never does', () => {
  const c = new InboxController({ service: () => ({ serviceRequest: () => Promise.reject(new Error('no reads')) }), visible: () => true, changed: () => {} });
  c.adopt('o', first(wire([['p', 'x', 'dependency']])));
  let m = c.model()!;
  assert.equal(m.complete, true); assert.equal(m.needsYou.length, 0); assert.equal(m.alsoBlocked.length, 1);
  assert.equal(inboxSummary(m, 'en'), 'Nothing needs you');
  c.adopt('o', first(wire([['p', 'x', 'dependency']], partial('more'))));
  m = c.model()!;
  assert.equal(inboxSummary(m, 'en'), 'Nothing found yet that needs you');
  assert.equal(inboxSummary(m, 'ru'), 'Пока не найдено задач, где нужно ваше участие');
  c.adopt('o', { state: 'missing' });
  assert.equal(c.model()!.availability, 'missing');
});

test('opening a row revalidates the current plan and task before any reveal; nothing is written', () => {
  const row = parse(wire([['plan-alpha', 'task-a', 'decision']])).rows[0];
  const reading: InboxReading = { token: 1, target: { storeId: STORE, source: SRC, plan: 'plan-alpha', task: 'task-a', revision: 3, cleanupRev: 0 }, task: 'Task task-a', planTitle: 'Plan plan-alpha', coordinator: 'coordinator-alpha', group: 'needs-you', rowKey: row.rowKey };
  const request = readingRequest(reading);
  assert.equal(request.key, `${SRC}/plan-alpha`); assert.equal(request.revision, 3);
  // A newer revision of the same plan in the latest window re-reads on the existing cadence.
  const c = new InboxController({ service: () => ({ serviceRequest: () => Promise.reject(new Error('no reads')) }), visible: () => true, changed: () => {} });
  const newer = wire([['plan-alpha', 'other', 'review']]); newer.rows[0].revision = 5; newer.rows[0].blocker.annotation.validAtRevision = 5;
  c.adopt('o', first(newer));
  assert.equal(readingRequest(reading, c.model()).revision, 5);
  const plan = { ...inboxRequest(reading.target, 'Plan plan-alpha', 'coordinator-alpha'), directory: '/fixture/Alpha' };
  const archived = { ...plan, revision: 6, cleanup: { state: 'archived' as const, revision: 1 } };
  assert.equal(readingRequest(reading, null, archived), archived, 'latest detail remains authoritative after the plan leaves the inbox');
  assert.equal(readingRequest(reading, null, { ...archived, key: `${SRC}/another-plan` }).key, plan.key, 'another plan cannot replace this target');
  const detail = (items: PlanDetail['items'], revision = 3): { state: 'ready'; value: PlanDetail } => ({ state: 'ready', value: { key: plan.key, revision, items, contributions: [], links: [] } });
  const ctx = { storeId: STORE, boundSource: SRC };
  assert.equal(checkReading(reading, null, null, ctx, 'en').kind, 'loading');
  assert.equal(checkReading(reading, { state: 'error', failure: { kind: 'not-found', code: 'not-found', message: '' } }, null, ctx, 'en').kind, 'gone');
  assert.equal(checkReading(reading, { state: 'error', failure: { kind: 'busy', code: 'busy', message: '' } }, null, ctx, 'en').kind, 'failed');
  assert.equal(checkReading(reading, detail([]), plan, { storeId: 'store-2', boundSource: SRC }, 'en').kind, 'other-setup');
  const blocked = checkReading(reading, detail([{ id: 'task-a', title: 'Task task-a', kind: 'task', status: 'blocked' }]), plan, ctx, 'en');
  assert.ok(blocked.kind === 'ready' && blocked.reveal && blocked.notice === null && blocked.message === 'Needs you: Task task-a');
  const resolved = checkReading(reading, detail([{ id: 'task-a', title: 'Task task-a', kind: 'task', status: 'done' }]), plan, ctx, 'ru');
  assert.ok(resolved.kind === 'ready' && resolved.reveal && resolved.notice === 'Задача «Task task-a» больше не заблокирована. Сейчас: выполнена.');
  const gone = checkReading(reading, detail([{ id: 'task-a', title: 'Group', kind: 'group', status: 'pending' }]), { ...plan, lifecycle: 'completed' }, ctx, 'en');
  assert.ok(gone.kind === 'ready' && !gone.reveal && gone.notice === '“Task task-a” is no longer in this plan. The plan stays open to read. This plan is no longer active.');
  assert.equal(checkReading(reading, detail([], 4), plan, ctx, 'en').kind, 'loading', 'detail ahead of its plan metadata waits');
});

test('data-only cache resets never repeat the reading task reveal or focus', () => {
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { hasFocus: () => true } });
  try {
    const r = { token: 9, target: { task: 'task-a' } } as InboxReading;
    const plan = { id: 'plan-alpha', sourceId: SRC } as import('../../ui/shared/model.ts').PlanView;
    const article = { dataset: { testid: 'plan-plan-alpha', source: SRC }, querySelector: () => ({}) };
    const root = { querySelectorAll: () => [article] } as unknown as HTMLElement;
    const focus = new ReadingFocus();
    let reveals = 0;
    const paint = () => focus.afterPaint(root, r, { kind: 'ready', plan, reveal: true, notice: null, message: 'Task' }, () => { reveals++; });
    paint();
    focus.reset('reset');
    paint();
    assert.equal(reveals, 1, 'recovery of the surviving reading must not steal focus again');
    r.token++;
    paint();
    assert.equal(reveals, 2, 'a genuinely new reading still reveals its task');
  } finally {
    if (saved) Object.defineProperty(globalThis, 'document', saved);
    else Reflect.deleteProperty(globalThis, 'document');
  }
});
