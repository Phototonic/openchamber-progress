// Contract checkpoint (frozen wire examples), then the intent UI's adapter, list/detail query
// extension and display gate (lane I2). Controller retirement: delegation-intent-controller.test.ts;
// rendered behaviour: delegation-intent-qa.ts. No actor seeding is claimed to demonstrate dispatch
// or assignment authority: these are synthetic overlays only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DELEGATION_VIEW_LIMITS, supportsDelegationIntent } from '../../shared/delegation-view.ts';
import { INTENT_PENDING, INTENT_RESERVED, INTENT_CANCELLED, INTENT_REFUSED, INTENT_UNAVAILABLE } from '../fixtures/attention-contracts.ts';
import { parseHealth, parseIntent, parsePlanPage, parsePlansPage, type EnvelopeView } from '../../ui/shared/adapter.ts';
import { readDetail, readList } from '../../ui/shared/source.ts';
import { currentIntent } from '../../ui/shared/intent.ts';
import { summarize, type PlanDetail, type PlanView } from '../../ui/shared/model.ts';
import type { GuestRequest, GuestRequestResult } from '@openchamber/sdk';
import { HEALTH, SRC, envelope, planPage, plansPage, summary } from './fixtures.ts';

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

// ---- Intent UI (lane I2): adapter, query extension and display gate ----

type Rec = Record<string, any>;
/** The reply identity the frozen examples belong to (store-fixture / source-alpha / plan-alpha@3). */
const ENV: EnvelopeView = { storeId: 'store-fixture', sources: [{ id: 'source-alpha', verified: true }], binding: { sourceId: 'source-alpha', verified: true }, captureEnabled: true, coverage: 'recorded-only', diagnostics: [] };
const PLAN = {
  key: 'source-alpha/plan-alpha', id: 'plan-alpha', sourceId: 'source-alpha', title: 'Release example', ownerSessionId: 'coordinator-alpha',
  revision: 3, structuralRevision: 1, lifecycle: 'active', reportedAt: '2026-01-01T00:00:00.000Z', directory: '/fixture', counts: null, working: [],
  document: { state: 'unbound', checklistSynchronized: false, currentFile: 'not-rechecked' }, cleanup: { state: 'visible', revision: 0 },
} as PlanView;
const wire = (base: unknown, patch: (v: Rec) => void = () => {}) => { const v = structuredClone(base) as Rec; patch(v); return v; };
const parse = (v: unknown, env = ENV, plan = PLAN) => parseIntent(v, env, plan);

test('each frozen disposition maps to one display state; only pending and reserved wait', () => {
  assert.deepEqual(parse(INTENT_PENDING), { token: 'intent-pending', state: 'waiting', taskIds: ['task-a'] });
  assert.deepEqual(parse(INTENT_RESERVED), { token: 'intent-reserved', state: 'waiting', taskIds: ['task-a'] });
  assert.deepEqual(parse(INTENT_CANCELLED), { token: 'intent-cancelled', state: 'clear' });
  assert.deepEqual(parse(INTENT_REFUSED), { token: 'intent-refused', state: 'refused', taskIds: ['task-a'], reason: 'changed' });
  assert.deepEqual(parse(INTENT_UNAVAILABLE), { token: 'intent-unavailable', state: 'unknown' });
  const declaration = (INTENT_RESERVED.result as Rec).disposition.declaration;
  assert.deepEqual(parse(wire(INTENT_PENDING, (v) => { v.result.disposition = { state: 'none' }; })).state, 'clear');
  assert.deepEqual(parse(wire(INTENT_PENDING, (v) => { v.result.disposition = { state: 'bound', declaration, childSessionId: 'child-alpha', boundRevision: 3 }; })).state, 'clear');
  assert.deepEqual(parse(wire(INTENT_CANCELLED, (v) => { v.result.disposition.state = 'invalidated'; v.result.disposition.reason = 'structural-change'; })).state, 'clear');
});

test('refusal reasons are mapped to fixed copy keys; unknown codes stay generic, never raw text', () => {
  const refused = (reason: string) => parse(wire(INTENT_REFUSED, (v) => { v.result.disposition.reason = reason; }));
  const expected: Record<string, string> = { 'relevant-change': 'changed', conflict: 'changed', 'structural-change': 'structure', closed: 'closed', assignment: 'assignment', 'source-unverified': 'unverified', 'incomplete-proof': 'unverified', 'a <new> code': 'other' };
  for (const [code, reason] of Object.entries(expected)) assert.deepEqual(refused(code), { token: 'intent-refused', state: 'refused', taskIds: ['task-a'], reason });
  assert.equal(refused(' ').state, 'unknown');
  assert.equal(refused('x'.repeat(DELEGATION_VIEW_LIMITS.reasonCodeUnits + 1)).state, 'unknown');
  assert.equal(parse(wire(INTENT_REFUSED, (v) => { v.result.disposition.recovery = 'retry'; })).state, 'unknown');
});

test('doubtful overlays become unknown (no note) and never fail the read they ride on', () => {
  const doubts: [string, Rec | unknown, EnvelopeView?, PlanView?][] = [
    ['other store', wire(INTENT_PENDING, (v) => { v.storeId = 'store-other'; })],
    ['unverified reply binding', INTENT_PENDING, { ...ENV, binding: { sourceId: 'source-alpha', verified: false } }],
    ['other binding', wire(INTENT_PENDING, (v) => { v.sourceBinding.sourceId = 'source-beta'; })],
    ['other source', wire(INTENT_PENDING, (v) => { v.source = 'source-beta'; })],
    ['other plan', wire(INTENT_PENDING, (v) => { v.plan = 'plan-beta'; })],
    ['older revision', wire(INTENT_PENDING, (v) => { v.revision = 2; })],
    ['newer revision', wire(INTENT_PENDING, (v) => { v.revision = 4; })],
    ['other structure', wire(INTENT_PENDING, (v) => { v.structuralRevision = 2; })],
    ['other cleanup generation', wire(INTENT_PENDING, (v) => { v.cleanup.revision = 1; })],
    ['archived plan', INTENT_PENDING, ENV, { ...PLAN, cleanup: { state: 'archived', revision: 0 } }],
    ['ineligible pending', wire(INTENT_PENDING, (v) => { v.result.disposition.eligible = false; })],
    ['pending with a dispatch', wire(INTENT_RESERVED, (v) => { v.result.disposition.state = 'pending'; })],
    ['reserved without a dispatch', wire(INTENT_PENDING, (v) => { v.result.disposition.state = 'reserved'; })],
    ['declared after this revision', wire(INTENT_PENDING, (v) => { v.result.disposition.declaration.declaredRevision = 4; })],
    ['no tasks', wire(INTENT_PENDING, (v) => { v.result.disposition.declaration.taskIds = []; })],
    ['too many tasks', wire(INTENT_PENDING, (v) => { v.result.disposition.declaration.taskIds = Array.from({ length: 51 }, (_, i) => `t-${i}`); })],
    ['duplicate tasks', wire(INTENT_PENDING, (v) => { v.result.disposition.declaration.taskIds = ['task-a', 'task-a']; })],
    ['incomplete ready result', wire(INTENT_PENDING, (v) => { v.result.complete = false; })],
    ['unavailable with a disposition', wire(INTENT_UNAVAILABLE, (v) => { v.result.disposition = { state: 'none' }; })],
    ['unknown unavailable reason', wire(INTENT_UNAVAILABLE, (v) => { v.result.reason = 'later'; })],
    ['unknown state', wire(INTENT_PENDING, (v) => { v.result.disposition.state = 'queued'; })],
    ['other protocol', wire(INTENT_PENDING, (v) => { v.protocolVersion = 3; })],
    ['other overlay revision', wire(INTENT_PENDING, (v) => { v.delegationIntent = 2; })],
  ];
  for (const [what, value, env, plan] of doubts) assert.deepEqual(parse(value, env, plan), { token: (value as Rec).token, state: 'unknown' }, what);
  for (const junk of [null, [], 'pending', 3, { token: '' }, wire(INTENT_PENDING, (v) => { v.token = 'x'.repeat(DELEGATION_VIEW_LIMITS.tokenBytes + 1); })]) assert.deepEqual(parse(junk), { token: null, state: 'unknown' });
});

test('list rows carry an optional token; an unreadable one matches nothing instead of failing the list', () => {
  const row = summary('P1', []);
  const page = (extra: Rec) => parsePlansPage(JSON.stringify(plansPage([{ ...row, ...extra } as never]))).data[0];
  assert.equal('delegationToken' in page({}), false);
  assert.equal(page({ delegationToken: 'tok-1' }).delegationToken, 'tok-1');
  for (const bad of [7, '', 'x'.repeat(DELEGATION_VIEW_LIMITS.tokenBytes + 1), 'a\0b']) assert.equal(page({ delegationToken: bad }).delegationToken, null);
});

test('detail pages keep the overlay optional; a broken overlay never fails the detail', () => {
  const items = [{ id: 'task-a', title: 'A', kind: 'task' as const, status: 'pending' as const }];
  const plan = summary('plan-alpha', items, { revision: 3 });
  const overlay = wire(INTENT_PENDING, (v) => { v.storeId = 'store-1'; v.source = SRC; v.sourceBinding.sourceId = SRC; });
  assert.equal(parsePlanPage(JSON.stringify(planPage(plan, items, []))).intent, undefined);
  assert.deepEqual(parsePlanPage(JSON.stringify({ ...planPage(plan, items, []), delegationIntent: overlay })).intent, { token: 'intent-pending', state: 'waiting', taskIds: ['task-a'] });
  const broken = parsePlanPage(JSON.stringify({ ...planPage(plan, items, []), delegationIntent: { nope: true } }));
  assert.deepEqual(broken.intent, { token: null, state: 'unknown' });
  assert.equal(broken.items.data.length, 1);
});

const detailOf = (intent: PlanDetail['intent'], items: PlanDetail['items'] = [{ id: 'task-a', title: 'A', kind: 'task', status: 'pending' }, { id: 'group-g', title: 'G', kind: 'group', status: 'pending' }], revision = 3): PlanDetail =>
  ({ key: PLAN.key, revision, items, contributions: [], links: [], ...(intent ? { intent } : {}) });
const withToken = (token: string | null | undefined): PlanView => (token === undefined ? PLAN : { ...PLAN, delegationToken: token });

test('a note is painted only from the overlay the current list token names', () => {
  const waiting = { token: 't1', state: 'waiting' as const, taskIds: ['task-a'] };
  assert.equal(currentIntent(withToken('t1'), detailOf(undefined)).state, 'absent');
  assert.equal(currentIntent(withToken(undefined), detailOf(waiting)).state, 'stale', 'no list token: freshness unknown');
  assert.equal(currentIntent(withToken(null), detailOf(waiting)).state, 'stale', 'unreadable list token');
  assert.equal(currentIntent(withToken('t2'), detailOf(waiting)).state, 'stale', 'declaration/cancel moved the token');
  assert.equal(currentIntent(withToken('t1'), detailOf(waiting, undefined, 2)).state, 'stale', 'detail of another revision');
  for (const s of ['absent', 'stale'] as const) assert.equal(currentIntent(withToken(s === 'absent' ? 't1' : 't2'), detailOf(s === 'absent' ? undefined : waiting)).tasks.size, 0);
  const shown = currentIntent(withToken('t1'), detailOf(waiting));
  assert.equal(shown.state, 'waiting');
  assert.deepEqual([...shown.tasks], [['task-a', { state: 'waiting' }]]);
  const refused = currentIntent(withToken('t1'), detailOf({ token: 't1', state: 'refused', taskIds: ['task-a'], reason: 'changed' }));
  assert.deepEqual([...refused.tasks], [['task-a', { state: 'refused', reason: 'changed' }]]);
  assert.equal(currentIntent(withToken('t1'), detailOf({ token: 't1', state: 'clear' })).tasks.size, 0);
  assert.equal(currentIntent(withToken('t1'), detailOf({ token: 't1', state: 'unknown' })).tasks.size, 0);
  // A declared task this detail does not have as a task makes the whole scope doubtful.
  assert.equal(currentIntent(withToken('t1'), detailOf({ ...waiting, taskIds: ['task-a', 'task-gone'] })).state, 'unknown');
  assert.equal(currentIntent(withToken('t1'), detailOf({ ...waiting, taskIds: ['group-g'] })).state, 'unknown');
});

test('the note is display only: plan summary and counts are identical with or without it', () => {
  const waiting = detailOf({ token: 't1', state: 'waiting', taskIds: ['task-a'] });
  assert.deepEqual(summarize(withToken('t1'), waiting), summarize(PLAN, detailOf(undefined)));
});

const ok = (body: unknown): GuestRequestResult => ({ status: 200, body: JSON.stringify(body) });
function service(capable: boolean, log: GuestRequest[]) {
  const items = [{ id: 'task-a', title: 'A', kind: 'task' as const, status: 'pending' as const }];
  const plan = { ...summary('plan-alpha', items, { revision: 3 }), delegationToken: 'intent-pending' };
  const overlay = wire(INTENT_PENDING, (v) => { v.storeId = 'store-1'; v.source = SRC; v.sourceBinding.sourceId = SRC; });
  return {
    serviceRequest: async (q: GuestRequest) => {
      log.push(q);
      if (q.path === '/health') return ok({ ...HEALTH, ...(capable ? { delegationIntent: 1 } : {}) });
      if (q.path === '/v1/plans') return ok(plansPage([plan as never], q.query?.cursor ? null : 'page-2'));
      if (q.path === '/v1/plan') return ok({ ...planPage(plan as never, items, [], q.query?.cursor ? undefined : { items: 'more', contributions: null }), ...(q.query?.delegationIntent === '1' && !q.query?.cursor ? { delegationIntent: overlay } : {}) });
      return { status: 404, body: '{"error":"not-found"}' };
    },
  };
}

test('the overlay is asked for only when advertised and wanted: every list page, first detail page only', async () => {
  const flag = (log: GuestRequest[], path: string) => log.filter((q) => q.path === path).map((q) => `${q.query?.cursor ? 'next' : 'first'}:${q.query?.delegationIntent ?? '-'}`);
  const yes: GuestRequest[] = [];
  const listed = await readList(service(true, yes), { session: 'x' }, 2, undefined, true);
  assert.ok(listed.ok && listed.read);
  assert.equal(listed.read.plans[0].delegationToken, 'intent-pending');
  const detail = await readDetail(service(true, yes), listed.read.plans[0], () => 0, undefined, true);
  assert.deepEqual(flag(yes, '/v1/plans'), ['first:1', 'next:1']);
  assert.deepEqual(flag(yes, '/v1/plan'), ['first:1', 'next:-']);
  assert.ok(detail.ok);
  assert.deepEqual(detail.detail.intent, { token: 'intent-pending', state: 'waiting', taskIds: ['task-a'] });
  assert.equal(currentIntent(listed.read.plans[0], detail.detail).state, 'waiting');
  // Not wanted (Work Status, background) or not advertised (older service): never sent.
  for (const [capable, wanted] of [[true, false], [false, true]] as const) {
    const log: GuestRequest[] = [];
    await readList(service(capable, log), { session: 'x' }, 2, undefined, wanted);
    const d = await readDetail(service(capable, log), { sourceId: SRC, id: 'plan-alpha' }, () => 0, undefined, wanted && capable);
    assert.ok(log.every((q) => q.query?.delegationIntent === undefined), JSON.stringify({ capable, wanted }));
    assert.ok(d.ok);
    assert.equal(d.detail.intent, undefined);
  }
});
