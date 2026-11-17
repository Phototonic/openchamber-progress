import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InboxPartition, partitionInbox, planInboxComplete, scopeInbox, type InboxModel } from '../../ui/shared/inbox.ts';
import { DeviceViewState, hiddenItemKey } from '../../ui/shared/device-view-state.ts';
import type { InboxRowView, PlanDetail, PlanView } from '../../ui/shared/model.ts';
import type { LanguageStorageValue } from '../../ui/shared/language.ts';

const row = (planKey: string, id: string): InboxRowView => ({ planKey, source: planKey.split('/')[0], plan: planKey.split('/')[1], task: { id }, blocker: { state: 'reported', reportedRevision: 1 } } as InboxRowView);
test('one-pass partition equals direct evaluation, including hidden and nonauthoritative retained rows', async () => {
  const a = row('s/shared', 'a'), b = row('s/shared', 'b'), foreign = row('other/shared', 'a'), retained = row('s/last', 'old');
  const model: InboxModel = { availability: 'ready', needsYou: [a, b, foreign, retained], alsoBlocked: [row('s/shared', 'c'), row('s/last', 'd')], counts: { needsYou: 3, alsoBlocked: 1 }, complete: false, gapped: false, captureEnabled: true, timing: true, canContinue: true, loadingMore: true, moreFailed: null, restarted: false, expanded: false, rechecking: true };
  let stored: LanguageStorageValue | undefined;
  const device = new DeviceViewState({ get: async () => stored, set: async (_key, value) => { stored = structuredClone(value); } }, () => {});
  await device.refresh(true);
  const cache = new InboxPartition();
  let previous = cache.get(model, device, 'one', 'binding');
  assert.equal(cache.get({ ...model }, device, 'one', 'binding'), previous);
  await device.hide(hiddenItemKey('one', a));
  assert.notEqual(cache.get(model, device, 'one', 'binding'), previous);
  previous = cache.get(model, device, 'one', 'binding');
  assert.notEqual(cache.get(model, device, 'one', 'new-binding'), previous);
  for (const store of ['one', 'two']) {
    await device.hide(hiddenItemKey(store, b));
    const partition = partitionInbox(model, device, store);
    for (const key of ['s/shared', 'other/shared', 's/last', 's/missing']) {
      const direct = scopeInbox(model, new Set([key]), true, device, store);
      const part = partition.get(key);
      assert.deepEqual(part?.needsYou ?? [], direct.model.needsYou);
      assert.deepEqual(part?.alsoBlocked ?? [], direct.model.alsoBlocked);
      assert.deepEqual(part?.hidden ?? [], direct.hidden);
      assert.deepEqual(part?.counts ?? { needsYou: 0, alsoBlocked: 0 }, direct.model.counts);
    }
  }
});

test('only this plan’s unread items qualify its positive badge', () => {
  const plan: PlanView = { key: 's/p', id: 'p', sourceId: 's', title: 'Plan', revision: 7, structuralRevision: 1, ownerSessionId: 'main', mainSessionKind: 'top-level', lifecycle: 'active', reportedAt: '2026-01-01', directory: '/fixture/main', counts: null, working: [], document: { state: 'unbound', checklistSynchronized: false, currentFile: '' } };
  const detail: PlanDetail = { key: plan.key, revision: 7, items: [{ id: 'a', title: 'A', kind: 'task', status: 'blocked', reportedBlocker: { state: 'reported', category: 'decision', reason: null, nextAction: null, reporterSessionId: 'main', attributedSessionId: 'main', mode: 'direct', reportedRevision: 7, reportedAt: '2026-01-01' } }], contributions: [], links: [] };
  const r = { ...row('s/p', 'a'), revision: 7 };
  const model: InboxModel = { availability: 'ready', needsYou: [r], alsoBlocked: [], counts: { needsYou: 1, alsoBlocked: 0 }, complete: false, gapped: false, captureEnabled: true, timing: false, canContinue: true, loadingMore: false, moreFailed: null, restarted: false, expanded: false, rechecking: false };
  const part = partitionInbox(model).get(plan.key);
  assert.equal(planInboxComplete(model, plan, part, detail), true, 'unread other plans cannot raise this known count');
  assert.equal(planInboxComplete(model, plan, part, null), false, 'unknown own detail stays conservative');
  assert.equal(planInboxComplete(model, plan, part, { ...detail, revision: 6 }), false, 'old detail never certifies a current count');
  assert.equal(planInboxComplete(model, plan, part && { ...part, counts: { needsYou: 0, alsoBlocked: 0 } }, detail), false, 'retained rows are not promoted during recheck');
});
