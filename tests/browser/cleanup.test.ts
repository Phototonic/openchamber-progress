import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanupBody, parseCleanupReceipt, parseHealth, parsePlansPage, type CleanupRequest } from '../../ui/shared/adapter.ts';
import { cleanupEligible, cleanupMatches, cleanupTarget } from '../../ui/shared/cleanup.ts';
import { cleanupCall, readList } from '../../ui/shared/source.ts';
import { RecentMemory } from '../../ui/shared/refresh.ts';
import { StatusSelection } from '../../ui/status/selection.ts';
import { HEALTH, plansPage, summary } from './fixtures.ts';

const plan = parsePlansPage(JSON.stringify(plansPage([summary('finished', [], { lifecycle: 'finished' })]))).data[0];
const request: CleanupRequest = { storeId: 'store-fixture', source: plan.sourceId, plan: plan.id, rev: 2, cleanupRev: 3, oid: 'cleanup-example' };
test('cleanup capability and metadata are explicit and fail closed', () => {
  for (const planCleanup of [undefined, 0, true, '1', 2]) assert.equal(parseHealth(JSON.stringify({ ...HEALTH, planCleanup })).planCleanup, undefined);
  assert.equal(parseHealth(JSON.stringify({ ...HEALTH, planCleanup: 1 })).planCleanup, 1);
  for (const cleanup of [{ state: 'deleted', revision: 1 }, { state: 'archived', revision: -1 }, { state: 'visible', revision: 0.2 }, null]) {
    assert.throws(() => parsePlansPage(JSON.stringify(plansPage([{ ...summary('finished', [], { lifecycle: 'finished' }), cleanup } as never]))));
  }
});
test('cleanup bodies are bounded to the contract; only delete confirms', () => {
  assert.deepEqual(JSON.parse(cleanupBody({ ...request, privatePath: 'not allowed' } as CleanupRequest, 'archive')), request);
  assert.deepEqual(JSON.parse(cleanupBody(request, 'delete')), { ...request, confirmed: true });
  assert.deepEqual(JSON.parse(cleanupBody(request, 'restore')), request);
});
test('success receipt must bind key, store, oid, next generation and requested transition', () => {
  const receipt = { ...request, cleanup: { state: 'archived', revision: 4 } };
  assert.equal(parseCleanupReceipt(JSON.stringify(receipt), request, 'archive').state, 'archived');
  for (const patch of [{ storeId: 'other' }, { source: 'other' }, { plan: 'other' }, { oid: 'other' }, { cleanup: { state: 'visible', revision: 4 } }, { cleanup: { state: 'archived', revision: 3 } }]) assert.throws(() => parseCleanupReceipt(JSON.stringify({ ...receipt, ...patch }), request, 'archive'));
});
test('confirmation binds store, context, key, progress revision and cleanup generation; only finished is eligible', () => {
  const target = cleanupTarget(plan, 'store', 'context');
  assert.equal(cleanupMatches(target, plan, 'store', 'context'), true);
  for (const changed of [null, { ...plan, key: 'other' }, { ...plan, revision: plan.revision + 1 }, { ...plan, cleanup: { state: 'visible' as const, revision: 1 } }, { ...plan, lifecycle: 'active' as const }]) assert.equal(cleanupMatches(target, changed, 'store', 'context'), false);
  assert.equal(cleanupMatches(target, plan, 'other', 'context'), false);
  assert.equal(cleanupMatches(target, plan, 'store', 'other'), false);
  for (const lifecycle of ['active', 'cancelled', 'failed'] as const) for (const action of ['archive', 'restore', 'delete'] as const) assert.equal(cleanupEligible(action, { ...plan, lifecycle }), false);
  assert.equal(cleanupEligible('archive', plan), true);
  assert.equal(cleanupEligible('restore', plan), false);
  assert.equal(cleanupEligible('restore', { ...plan, cleanup: { state: 'archived', revision: 1 } }), true);
});
test('archive query is paged consistently; capability-less service never claims an empty archive', async () => {
  const calls: unknown[] = [];
  const old = await readList({ serviceRequest: async (q) => { calls.push(q); return { status: 200, body: JSON.stringify(HEALTH) }; } }, { archived: 'only' });
  assert.equal(old.ok && old.read, null); assert.equal(calls.length, 1);
  const queries: string[] = [];
  const result = await readList({ serviceRequest: async (q) => {
    if (q.path === '/health') return { status: 200, body: JSON.stringify({ ...HEALTH, planCleanup: 1 }) };
    queries.push(q.query?.archived ?? 'missing');
    return { status: 200, body: JSON.stringify({ ...plansPage([]), nextCursor: queries.length === 1 ? 'second' : null }) };
  } }, { archived: 'only' });
  assert.equal(result.ok, true); assert.deepEqual(queries, ['only', 'only']);
});
test('cleanup refuses conflicts and mismatched receipts without retrying', async () => {
  let count = 0;
  const result = await cleanupCall({ serviceRequest: async () => { count++; return { status: 409, body: '{"error":"conflict"}' }; } }, 'archive', request);
  assert.equal(result.ok, false); assert.equal(count, 1);
  const bad = await cleanupCall({ serviceRequest: async () => ({ status: 200, body: '{}' }) }, 'delete', request);
  assert.equal(bad.ok, false);
});
test('removed keys are evicted from all recent choices, not resurrected by another scope', () => {
  const memory = new RecentMemory<string>(); memory.set('M', plan.key); memory.set('U', plan.key); memory.set('other', 'keep');
  memory.deleteWhere((value) => value === plan.key);
  assert.equal(memory.get('M'), undefined); assert.equal(memory.get('U'), undefined); assert.equal(memory.get('other'), 'keep');
  const selection = new StatusSelection();
  selection.choose(selection.enter('store', 'M', null), plan.key);
  selection.choose(selection.enter('store', 'U', null), plan.key);
  selection.forget(new Set([plan.key])); selection.enter('store', 'M', null);
  assert.equal(selection.resolve({ kind: 'directory', directory: '/fixture', plans: [plan] }).selected, null);
});
