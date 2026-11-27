import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAN_USER_CANCEL_PATH, type UserCancelRequest } from '../../shared/user-cancel.ts';
import { parseHealth, parseHistoryPage, parsePlansPage } from '../../ui/shared/adapter.ts';
import { cancelPin, PlanUserCancel, type CancelPin, type CancelResult } from '../../ui/shared/plan-user-cancel.ts';
import { userCancelCall } from '../../ui/shared/source.ts';
import { P1, plansPage } from './fixtures.ts';

const iso = '2026-04-22T00:00:00.000Z';
const healthBody = { protocolVersion: 2, schemaVersion: 2, ok: true, ready: true, planUserCancel: 1 };
const listed = parsePlansPage(JSON.stringify(plansPage([P1])));
const plan = { ...listed.data[0]!, sourceId: 'example', lifecycle: 'active' as const, cleanup: { state: 'visible' as const, revision: 3 } };
const binding = { sourceId: 'example', verified: true };
const read = { ...listed.envelope, coverage: 'recorded-only' as const, binding, sources: [{ id: 'example', verified: true }], plans: [plan], captureEnabled: true, truncated: false };
const health = parseHealth(JSON.stringify(healthBody));
const pin = cancelPin('example-context', health, read, plan)!;
const request = { ...pin.request, oid: 'operation-example', confirmed: true as const };
const receipt = ({ storeId, source, plan, oid, binding, rev }: UserCancelRequest) => ({
  storeId, source, plan, oid, sourceBinding: binding, rev: rev + 1, structuralRev: pin.structuralRev, reportedAt: iso, lifecycle: 'cancelled', actor: 'user',
});

test('only the ready capability and a fresh eligible plan yield a cancellation pin', () => {
  assert.ok(pin);
  assert.equal(cancelPin('scope', parseHealth(JSON.stringify({ ...healthBody, planUserCancel: undefined })), read, plan), null);
  assert.equal(parseHealth(JSON.stringify({ ...healthBody, ready: false })).planUserCancel, undefined);
  assert.equal(cancelPin('scope', health, { ...read, captureEnabled: false }, plan), null);
  assert.equal(cancelPin('scope', health, { ...read, binding: { ...binding, verified: false } }, plan), null);
  assert.equal(cancelPin('scope', health, { ...read, sources: [{ id: 'example', verified: false }] }, plan), null);
  assert.equal(cancelPin('scope', health, read, { ...plan, sourceId: 'other' }), null);
  assert.equal(cancelPin('scope', health, read, { ...plan, lifecycle: 'cancelled' }), null);
  assert.equal(cancelPin('scope', health, read, { ...plan, cleanup: { state: 'archived', revision: 4 } }), null);
});

test('the UI sends one fixed confirmed DTO and distinguishes validated success, refusal and uncertainty', async () => {
  const wire = { status: 200, body: JSON.stringify(receipt(request)) };
  const dispatched: unknown[] = [];
  const host = { async serviceRequest(q: unknown) { dispatched.push(q); return wire; } };
  assert.equal(await userCancelCall(host, request, pin.structuralRev), 'success');
  assert.deepEqual(dispatched, [{ method: 'POST', path: PLAN_USER_CANCEL_PATH, body: JSON.stringify(request) }]);
  for (const altered of [{ actor: 'agent' }, { rev: request.rev }, { structuralRev: pin.structuralRev + 1 },
    { oid: 'another' }, { sourceBinding: { ...binding, verified: false } }, { reportedAt: 'later' }]) {
    wire.body = JSON.stringify({ ...receipt(request), ...altered });
    assert.equal(await userCancelCall(host, request, pin.structuralRev), 'uncertain');
  }
  for (const [status, code, result] of [[409, 'disabled', 'disabled'], [409, 'closed', 'changed'],
    [404, 'not-found', 'ineligible'], [503, 'storage', 'refused'], [503, 'proxy-response', 'uncertain']] as const) {
    wire.status = status; wire.body = JSON.stringify({ error: code });
    assert.equal(await userCancelCall(host, request, pin.structuralRev), result);
  }
  assert.equal(await userCancelCall({ async serviceRequest() { throw Error('connection lost'); } }, request, pin.structuralRev), 'uncertain');
});

function fixture() {
  let current: CancelPin | null = pin, serial = 0;
  const settled: CancelResult[] = [], calls: UserCancelRequest[] = [], focus: unknown[] = [];
  let resolve!: (result: CancelResult) => void;
  const reply = { promise: new Promise<CancelResult>(done => { resolve = done; }), resolve };
  const controller = new PlanUserCancel({
    pin: () => current, operation: () => request.oid, refreshSerial: () => serial, changed: v => { focus.push(v); },
    send: r => { calls.push(r); return reply.promise; }, settled: r => { settled.push(r); },
  });
  const view = () => controller.view(pin);
  const open = () => { view().open(); return view().confirmation!; };
  return { controller, reply, focus, calls, settled, open, view,
    setCurrent: (value: CancelPin | null) => { current = value; controller.sync(); },
    refresh: () => { serial++; controller.afterRefresh(); } };
}

test('opening and keeping the plan active send nothing; stale closures cannot confirm', async () => {
  const f = fixture();
  const first = f.open();
  assert.equal(f.focus.at(-1), 'keep');
  first.keep();
  assert.equal(f.focus.at(-1), 'more');
  await first.confirm();
  const second = f.open();
  f.setCurrent({ ...pin, request: { ...pin.request, rev: pin.request.rev + 1 } });
  f.setCurrent(pin);
  await second.confirm();
  assert.deepEqual(f.calls, []);
  assert.equal(f.view().confirmation, null);
});

test('duplicates and late acknowledgements cannot affect a new reading', async () => {
  const f = fixture();
  const visit = f.open();
  const pending = visit.confirm();
  assert.equal(f.view().confirmation?.pending, true);
  await visit.confirm();
  assert.deepEqual(f.calls, [request]);
  f.setCurrent({ ...pin, context: 'another-reading' });
  f.setCurrent(pin);
  assert.equal(f.view().confirmation, null);
  f.reply.resolve('success');
  await pending;
  assert.deepEqual(f.settled, []);
});

test('an uncertain reply is not acknowledged or retried; another action needs a new reading', async () => {
  const f = fixture(), visit = f.open();
  const pending = visit.confirm();
  f.reply.resolve('uncertain');
  await pending;
  assert.deepEqual(f.settled, ['uncertain']);
  assert.equal(f.view().eligible, false);
  f.view().open();
  assert.equal(f.view().confirmation, null);
  assert.deepEqual(f.calls, [request]);
  f.refresh();
  assert.equal(f.view().eligible, true);
});

test('history projects user attribution only for its fixed cancellation discriminator', () => {
  const rows = [
    { revision: 1, structuralRevision: 1, lifecycle: 'active', reportedAt: iso, actor: 'user' },
    { revision: 2, structuralRevision: 1, lifecycle: 'cancelled', reportedAt: iso, actor: 'user' },
    { revision: 3, structuralRevision: 2, lifecycle: 'active', reportedAt: iso },
    { revision: 4, structuralRevision: 2, lifecycle: 'cancelled', reportedAt: iso, actor: { kind: 'user', action: 'cancel' } },
  ];
  const result = parseHistoryPage(JSON.stringify({ ...plansPage([]), data: rows }));
  assert.deepEqual(result.data.map(row => row.actor), [undefined, 'user', undefined, undefined]);
});
