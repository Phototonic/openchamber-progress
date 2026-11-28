import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEVICE_VIEW_KEY, DeviceViewState, hiddenItemKey } from '../../ui/shared/device-view-state.ts';
import type { LanguageStorageValue } from '../../ui/shared/language.ts';
import { parseNeedsYouWindow } from '../../ui/shared/adapter.ts';
import { INBOX_MEMBERSHIP, INBOX_LEGACY } from '../fixtures/attention-contracts.ts';
import { scopeInbox, InboxController } from '../../ui/shared/inbox.ts';
import { replyFrame } from '../../ui/shared/inbox-view.ts';

function fixture(initial?: LanguageStorageValue) {
  let value = initial, sets = 0, gets = 0, fail = false;
  const scopes: string[] = [];
  const storage = {
    async get(key: string, options: { scope: 'device' }) { assert.equal(key, DEVICE_VIEW_KEY); scopes.push(options.scope); gets++; return structuredClone(value); },
    async set(key: string, next: LanguageStorageValue, options: { scope: 'device' }) { assert.equal(key, DEVICE_VIEW_KEY); scopes.push(options.scope); sets++; if (fail) throw Error('refused'); value = structuredClone(next); },
  };
  return { state: new DeviceViewState(storage, () => {}), storage, value: () => value, counts: () => ({ sets, gets }), fail: () => { fail = true; }, scopes };
}
const key = (n: number) => JSON.stringify(['store-example', 'source-example', 'plan-example', `task-${n}`, 1]);

test('device view defaults and unsupported host send no storage requests', async () => {
  const f = fixture();
  await f.state.refresh(false);
  assert.equal(f.state.expanded('panel'), false);
  assert.equal(f.state.expanded('page'), false);
  assert.equal(f.state.canHide, false);
  assert.equal(await f.state.hide(key(1)), false);
  await f.state.setExpanded('panel', true);
  await f.state.dismiss('panel', 'store/reasons');
  assert.equal(f.state.expanded('panel'), true);
  assert.equal(f.state.dismissed('panel', 'store/reasons'), true);
  assert.deepEqual(f.counts(), { sets: 0, gets: 0 });
});
test('device writes are confirmed, bounded, retained on reload and pruned only for the traversed store', async () => {
  const f = fixture();
  await f.state.refresh(true);
  await f.state.setExpanded('panel', true);
  await f.state.dismiss('page', 'store/reasons');
  for (let n = 0; n <= 200; n++) assert.equal(await f.state.hide(key(n)), true);
  assert.equal(f.state.hidden(key(0)), false);
  assert.equal(f.state.hidden(key(200)), true);
  const next = new DeviceViewState(f.storage, () => {});
  await next.refresh(true);
  assert.equal(next.expanded('panel'), true);
  assert.equal(next.dismissed('page', 'store/reasons'), true);
  assert.equal(next.dismissed('page', 'store/new-reasons'), false);
  await next.prune('other-store', 'source-example', new Set());
  assert.equal(next.hidden(key(200)), true);
  await next.prune('store-example', 'other-source', new Set());
  assert.equal(next.hidden(key(200)), true, 'a complete traversal of another source proves nothing about this hidden item');
  await next.prune('store-example', 'source-example', new Set([key(200)]));
  assert.equal(next.hidden(key(199)), false);
  assert.equal(next.hidden(key(200)), true);
  assert.ok(f.scopes.every(scope => scope === 'device'));
});
test('malformed device records fail closed without repair; failed writes never hide or confirm expansion', async () => {
  for (const value of [null, {}, { v: 2 }, { v: 1, hidden: ['bad'], expanded: {}, dismissed: {} }, { v: 1, hidden: [], expanded: { other: true }, dismissed: {} }] as LanguageStorageValue[]) {
    const f = fixture(value); await f.state.refresh(true);
    assert.equal(f.state.error, 'read'); assert.equal(f.state.canHide, false);
    assert.equal(await f.state.hide(key(1)), false);
    assert.equal(f.counts().sets, 0);
    assert.equal(f.state.expanded('panel'), false);
  }
  const f = fixture(); await f.state.refresh(true); f.fail();
  assert.equal(await f.state.hide(key(1)), false);
  assert.equal(f.state.hidden(key(1)), false);
  assert.equal(await f.state.setExpanded('panel', true), false);
  assert.equal(f.state.expanded('panel'), false);
  assert.equal(f.state.error, 'write');
});
test('hidden identity follows details revision, not unrelated plan revision or another store', async () => {
  const w = parseNeedsYouWindow(structuredClone(INBOX_MEMBERSHIP), { storeId: INBOX_MEMBERSHIP.storeId, binding: INBOX_MEMBERSHIP.sourceBinding }, null, true, 1);
  const row = w.rows[0], f = fixture(); await f.state.refresh(true);
  await f.state.hide(hiddenItemKey(w.storeId, row));
  assert.equal(f.state.hidden(hiddenItemKey(w.storeId, { ...row, revision: row.revision + 1 })), true);
  assert.equal(f.state.hidden(hiddenItemKey('other-store', row)), false);
  assert.equal(f.state.hidden(hiddenItemKey(w.storeId, { ...row, blocker: row.blocker.state === 'reported' ? { ...row.blocker, reportedRevision: row.blocker.reportedRevision + 1 } : row.blocker })), false);
});
test('session, selected-plan and explicit all scopes use one held read, membership and hidden state', async () => {
  const w = parseNeedsYouWindow(structuredClone(INBOX_MEMBERSHIP), { storeId: INBOX_MEMBERSHIP.storeId, binding: INBOX_MEMBERSHIP.sourceBinding }, null, true, 1);
  const ctl = new InboxController({ service: () => { throw Error('no second read'); }, changed: () => {}, visible: () => true });
  ctl.adopt('owner', { state: 'ready', window: w });
  const all = ctl.model()!;
  assert.equal(all.counts.needsYou, 2);
  assert.equal(scopeInbox(all, new Set(), true).model.counts.needsYou, 0);
  assert.equal(scopeInbox(all, new Set(), true).other, 2);
  assert.equal(scopeInbox(all, new Set([w.rows[0].planKey]), false).model.complete, false);
  const f = fixture(); await f.state.refresh(true); await f.state.hide(hiddenItemKey(w.storeId, all.needsYou[0]));
  const scoped = scopeInbox(all, null, true, f.state, w.storeId);
  assert.equal(scoped.model.counts.needsYou, 1);
  assert.equal(scoped.hidden.length, 1);
  for (const locale of ['en', 'ru', 'zh-CN']) {
    const reply = replyFrame(all.needsYou[0], locale);
    assert.ok(reply.includes(all.needsYou[0].task.title));
    assert.ok(reply.includes(all.needsYou[0].planTitle));
    assert.ok(reply.endsWith('\n\n'));
  }
});

test('device actions and pruning wait for an in-flight read; revoked support retires a pending write', async () => {
  let value: LanguageStorageValue | undefined, gate: Promise<void> | null = null;
  let writes = 0, changes = 0;
  const state = new DeviceViewState({
    async get() { if (gate) await gate; return structuredClone(value); },
    async set(_key, next) { writes++; value = structuredClone(next); },
  }, () => { changes++; });
  await state.refresh(true);
  const baseline = changes;
  await state.refresh(true);
  assert.equal(changes, baseline, 'unchanged preferences do not force a frame repaint');
  await state.hide(key(1));
  let release!: () => void;
  gate = new Promise<void>(resolve => { release = resolve; });
  const reading = state.refresh(true);
  const pruning = state.prune('store-example', 'source-example', new Set());
  assert.equal(state.hidden(key(1)), true);
  release(); await reading; await pruning;
  assert.equal(state.hidden(key(1)), false, 'a slow preference read cannot silently discard complete-traversal pruning');
  gate = new Promise<void>(resolve => { release = resolve; });
  const before = writes;
  const saving = state.setExpanded('panel', true);
  await state.refresh(false);
  release(); await saving;
  assert.equal(writes, before, 'no set is sent after support is revoked during its prerequisite get');
  assert.equal(state.expanded('panel'), false);
  assert.equal(state.canHide, false);
});

test('an older service without membership evidence cannot prune hidden choices', () => {
  let prunes = 0;
  const state = new class extends DeviceViewState {
    override async prune(_store: string, _source: string, _keys: Set<string>) { prunes++; return false; }
  }({ async get() { return undefined; }, async set() {} }, () => {});
  const ctl = new InboxController({ device: state, service: () => { throw Error('no request'); }, visible: () => true, changed: () => {} });
  const pin = { storeId: INBOX_MEMBERSHIP.storeId, binding: INBOX_MEMBERSHIP.sourceBinding };
  ctl.adopt('owner', { state: 'ready', window: parseNeedsYouWindow(INBOX_LEGACY, pin, null, false, 0) });
  assert.equal(ctl.model()!.availability, 'unsupported');
  assert.equal(prunes, 0, 'an unavailable membership read establishes no stale hidden identities');
  ctl.adopt('owner', { state: 'ready', window: parseNeedsYouWindow(INBOX_MEMBERSHIP, pin, null, false, 0) });
  assert.equal(prunes, 1, 'a complete positively classified traversal can prune');
});
