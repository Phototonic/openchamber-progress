// Named-plan lookups and offset-paged counts against a scripted service: bounded requests, pinned identity,
// and honest qualification. The scope predicate itself is covered in cleanup-tidy-scope.test.ts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CleanupScan, TIDY_SCAN_WINDOWS } from '../../ui/shared/cleanup.ts';
import { cleanupKnownReader, readCleanupListPage, type ServiceHost } from '../../ui/shared/source.ts';
import { parsePlansPage } from '../../ui/shared/adapter.ts';
import { envelope, plansPage, planPage, SRC } from './fixtures.ts';
import type { PlanSummary } from '../../shared/progress.ts';
import { identity, view, stateRow, service, closed } from './cleanup-known-service.ts';

test('a named batch stays within the encoded query limit, not only 50 keys', async () => {
  const rows = Array.from({ length: 50 }, (_, i) => closed(`${String(i).padStart(2, '0')}${':'.repeat(78)}`, { sourceId: 's'.repeat(80) }));
  const known = view(rows);
  const s = service({ revisions: new Map(rows.map(r => [r.id, r.revision])) }, rows);
  const scan = new CleanupScan('c', identity.storeId, false, cleanupKnownReader(s.host, known, identity), false, 50, () => true);
  const counted = await scan.more(() => true);
  const lookups = s.requests.filter(r => r.path === '/v1/search-state');
  assert.ok(lookups.length > 1, 'split into several lookups');
  for (const r of lookups) assert.ok(new URLSearchParams(r.query).toString().length + 1 <= 16 * 1024, 'every lookup fits the service limit');
  assert.equal(counted?.targets.length, 50);
  assert.equal(counted?.unchecked, false);
});

test('moved revisions are re-read one request at a time within the per-action budget, keeping unfinished plans', async () => {
  const rows = Array.from({ length: 50 }, (_, i) => closed(`P-${i}`));
  const known = view(rows);
  const s = service({ revisions: new Map(rows.map(r => [r.id, r.revision + 1])) }, rows);
  const scan = new CleanupScan('c', identity.storeId, false, cleanupKnownReader(s.host, known, identity), false, 50, () => true);
  const first = await scan.more(() => true);
  assert.ok(s.requests.length <= TIDY_SCAN_WINDOWS, `one action sends at most ${TIDY_SCAN_WINDOWS} requests, sent ${s.requests.length}`);
  assert.equal(first?.unchecked, true, 'unfinished plans are kept for Check more');
  s.requests.length = 0;
  const second = await scan.more(() => true);
  assert.ok(s.requests.length <= TIDY_SCAN_WINDOWS);
  assert.equal(second?.targets.length, 50);
  assert.equal(second?.unchecked, false);
  assert.ok(second!.targets.every(t => t.request.rev === 2), 'each is counted at its current revision');
});

test('a plan whose revision moved is skipped, never adopted, when the predicate cannot be evaluated here', async () => {
  const rows = [closed('P-1'), closed('P-2')];
  const s = service({ revisions: new Map([['P-1', 2], ['P-2', 1]]) }, rows);
  const scan = new CleanupScan('c', identity.storeId, false, cleanupKnownReader(s.host, view(rows), identity, 'skip'), false, 50, () => true);
  const counted = await scan.more(() => true);
  assert.deepEqual(counted?.targets.map(t => t.request.plan), ['P-2']);
  assert.ok(s.requests.every(r => r.path === '/v1/search-state'), 'no head read for the moved plan');
});

test('a head read from another store or binding is refused, not counted', async () => {
  const rows = [closed('P-1')];
  for (const other of [{ storeId: 'store-2' }, { sourceBinding: { sourceId: SRC, verified: false } }]) {
    const s = service({ revisions: new Map([['P-1', 2]]) }, rows);
    const swapped: ServiceHost = { serviceRequest: async q => {
      const reply = await s.host.serviceRequest(q);
      return q.path === '/v1/plan' ? { ...reply, body: JSON.stringify({ ...JSON.parse(reply.body), ...other }) } : reply;
    } };
    const scan = new CleanupScan('c', identity.storeId, false, cleanupKnownReader(swapped, view(rows), identity), false, 50, () => true);
    await assert.rejects(scan.more(() => true), /store or binding changed/);
  }
});

test('a missing head counts as absent only when the pinned lookup confirms it', async () => {
  const rows = [closed('P-1')];
  const gone = service({ revisions: new Map([['P-1', 2]]), head: () => ({ status: 404, body: '{"error":"not-found"}' }) }, rows);
  // The head is missing, and the pinned lookup now agrees the plan is gone.
  let calls = 0;
  gone.host.serviceRequest = ((inner) => async (q: Parameters<ServiceHost['serviceRequest']>[0]) => {
    if (q.path === '/v1/search-state' && ++calls === 2) {
      const keys = JSON.parse(q.query!.keys) as { source: string; plan: string }[];
      return { status: 200, body: JSON.stringify({ ...envelope(), planTaskSearch: 1, data: keys.map(k => stateRow(k, null)) }) };
    }
    return inner(q);
  })(gone.host.serviceRequest);
  const absent = await new CleanupScan('c', identity.storeId, false, cleanupKnownReader(gone.host, view(rows), identity), false, 50, () => true).more(() => true);
  assert.equal(absent?.targets.length, 0);
  // A bare 404 that the pinned lookup contradicts is an inconsistent store, not an absence.
  const odd = service({ revisions: new Map([['P-1', 2]]), head: () => ({ status: 404, body: '{"error":"not-found"}' }) }, rows);
  await assert.rejects(new CleanupScan('c', identity.storeId, false, cleanupKnownReader(odd.host, view(rows), identity), false, 50, () => true).more(() => true));
});

// --- offset-paged browse counts
const pageHost = (pages: (offset: number) => PlanSummary[], requests: string[] = []): ServiceHost => ({ serviceRequest: async q => {
  assert.equal(q.path, '/v1/plans');
  const offset = Number(q.query?.cursor ?? 0);
  requests.push(String(offset));
  const rows = pages(offset);
  return { status: 200, body: JSON.stringify(plansPage(rows, offset === 0 ? '3' : null)) };
} });
async function paged(second: PlanSummary[]) {
  const a = closed('a'), b = closed('b'), c = closed('c');
  const host = pageHost(offset => offset === 0 ? [a, b, c] : second);
  const read = { ...identity, sources: parsePlansPage(JSON.stringify(plansPage([]))).envelope.sources };
  const continuation = {};
  const scan = new CleanupScan('c', identity.storeId, false, cursor => readCleanupListPage(host, { archived: 'exclude' }, cursor, read, continuation));
  return scan.more(() => true);
}
test('a count that crossed an offset page boundary is qualified, because the offsets cannot be proven stable', async () => {
  const done = await paged([closed('c'), closed('d')]);
  assert.equal(done?.targets.length, 4);
  assert.equal(done?.unchecked, false);
  assert.equal(done?.unverified, true, 'never presented as a verified complete count');
});
test('an anchor that changed between pages is counted at its new version, not dropped', async () => {
  const done = await paged([closed('c', { revision: 2 }), closed('d')]);
  const anchor = done?.targets.find(t => t.request.plan === 'c');
  assert.equal(anchor?.request.rev, 2);
  assert.equal(done?.targets.filter(t => t.request.plan === 'c').length, 1);
});
