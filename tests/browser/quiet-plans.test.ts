import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEVICE_VIEW_KEY, DeviceViewState, QUIET_VIEW_RECORD } from '../../ui/shared/device-view-state.ts';
import { admitsQuiet, quietDays, quietLabel } from '../../ui/shared/quiet-plans.ts';
import type { LanguageStorageValue } from '../../ui/shared/language.ts';

test('quiet classification uses whole elapsed days, re-evaluated at the supplied clock', () => {
  const day = 86_400_000;
  const now = Date.parse('2026-04-21T10:00:00.000Z');
  const plan = (age: number) => ({ lifecycle: 'active', reportedAt: new Date(now - age).toISOString() });
  assert.equal(quietDays(plan(7 * day - 60_000), now), null);
  assert.equal(quietDays(plan(7 * day), now), 7);
  assert.equal(quietDays(plan(9.9 * day), now), 9);
  assert.equal(quietDays(plan(-1), now), null);
  assert.equal(quietDays({ ...plan(9 * day), reportedAt: '2026-04-01' }, now), null);
  assert.equal(quietDays({ ...plan(9 * day), lifecycle: 'cancelled' }, now), null);
  assert.equal(admitsQuiet(plan(7 * day), true, now - 1), true);
  assert.equal(admitsQuiet(plan(7 * day), true, now), false);
  assert.equal(admitsQuiet(plan(7 * day), false, now), true);
  assert.equal(admitsQuiet(plan(0), true, now), true);
  assert.match(quietLabel(21, 'ru'), /день$/);
  assert.match(quietLabel(22, 'ru'), /дня$/);
  assert.match(quietLabel(25, 'ru'), /дней$/);
});

test('quiet preference saves independently, converges on refresh and fails without claiming a save', async () => {
  const original = { v: 1, hidden: [], expanded: { panel: true }, dismissed: {} };
  const records = new Map<string, unknown>([[DEVICE_VIEW_KEY, original]]);
  let fail = false;
  const storage = {
    async get(k: string) { return records.get(k) as LanguageStorageValue | undefined; },
    async set(k: string, v: LanguageStorageValue) { if (fail) throw Error('unavailable'); records.set(k, v); },
  };
  const rail = new DeviceViewState(storage, () => {});
  const board = new DeviceViewState(storage, () => {});
  await rail.refresh(true); await board.refresh(true);
  assert.equal(rail.quiet.hide, true);
  assert.equal(await rail.setQuiet(false), true);
  assert.equal(board.quiet.hide, true);
  await board.refresh(true);
  assert.equal(board.quiet.hide, false);
  assert.equal(records.get(DEVICE_VIEW_KEY), original);
  fail = true;
  assert.equal(await rail.setQuiet(true), false);
  assert.equal(rail.quiet.hide, false);
  assert.equal(rail.quiet.error, 'write');
  records.set(QUIET_VIEW_RECORD, { v: 1, hide: false, extra: true });
  await rail.refresh(true);
  assert.equal(rail.quiet.hide, true);
  assert.equal(rail.quiet.error, 'read');
  assert.deepEqual(records.get(QUIET_VIEW_RECORD), { v: 1, hide: false, extra: true });
  assert.equal(rail.expanded('panel'), true);
  await rail.refresh(false);
  assert.equal(await rail.setQuiet(false), true);
  assert.equal(rail.quiet.hide, false);
  assert.equal(rail.quiet.supported, false);
});
