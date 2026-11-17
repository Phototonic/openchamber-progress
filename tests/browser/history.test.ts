import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../../shared/store.ts';
import { productionFixture } from '../fixtures/production.ts';
import { readHistory, LIST_LIMIT, type ServiceHost } from '../../ui/shared/source.ts';
import { envelope, P1 } from './fixtures.ts';

// Real writer and row-offset reader: no assumption hidden in a paging mock.
for (const count of [3, 250, 263]) test(`History selects the newest bounded suffix of ${count} committed revisions`, async () => {
  const f = productionFixture();
  try {
    f.store.apply({ op: 'start', plan: 'history', oid: 'start', rev: 0, title: 'History example',
      items: [{ id: 'task', title: 'Example task', kind: 'task' }] }, f.actor);
    for (let rev = 1; rev < count; rev++) f.store.apply({ op: 'change', plan: 'history', oid: `change-${rev}`, rev,
      changes: [{ id: 'task', status: rev % 2 ? 'working' : 'pending' }] }, f.actor);
    const offsets: number[] = [];
    const host: ServiceHost = { async serviceRequest(r) {
      offsets.push(Number(r.query?.cursor ?? 0));
      return { status: 200, body: JSON.stringify(f.store.history(f.source.id, 'history', offsets.at(-1), Number(r.query?.limit))) };
    } };
    const plan = { sourceId: f.source.id, id: 'history', revision: count };
    const result = await readHistory(host, plan);
    assert.ok(result.ok);
    const start = Math.max(0, count - 5 * LIST_LIMIT);
    assert.deepEqual(result.entries.map(e => e.revision), Array.from({ length: count - start }, (_, i) => start + i + 1));
    assert.equal(result.truncated, start > 0);
    assert.equal(offsets[0], start);
    assert.ok(offsets.length <= 5);
    // Read-only and capture-off stores retain the same history.
    f.store.setEnabled(false);
    const reader = new Store(f.store.file, { readOnly: true });
    try { assert.equal(reader.history(f.source.id, 'history', start, 50).data[0].revision, start + 1); }
    finally { reader.close(); }
    // Missing rows are fault-only, but must never produce a false complete state or an older prefix.
    f.store.db.prepare('DELETE FROM contributions WHERE revision=2').run();
    f.store.db.prepare('DELETE FROM revisions WHERE revision=2').run();
    assert.equal((await readHistory(host, plan)).ok, false);
  } finally { f.cleanup(); }
});

test('History pins the listed tail while new reports arrive, without another page or poll', async () => {
  let calls = 0;
  const host: ServiceHost = { async serviceRequest() {
    calls++;
    return { status: 200, body: JSON.stringify(envelope({ data: [1, 2, 3, 4].map(revision => ({
      revision, structuralRevision: 1, lifecycle: 'active', reportedAt: P1.reportedAt,
    })), nextCursor: '4' })) };
  } };
  const result = await readHistory(host, { sourceId: P1.sourceId, id: P1.id, revision: 3 });
  assert.ok(result.ok);
  assert.deepEqual(result.entries.map(e => e.revision), [1, 2, 3]);
  assert.equal(result.truncated, false);
  assert.equal(calls, 1);
});

for (const fault of ['missing-tail', 'empty', 'wrong-cursor'] as const) test(`History fails safely for ${fault}`, async () => {
  let calls = 0;
  const host: ServiceHost = { async serviceRequest() {
    calls++;
    return { status: 200, body: JSON.stringify(envelope({
      data: (fault === 'empty' ? [] : [1, 2]).map(revision => ({
        revision, structuralRevision: 1, lifecycle: 'active', reportedAt: P1.reportedAt,
      })), nextCursor: fault === 'wrong-cursor' ? '50' : null,
    })) };
  } };
  assert.equal((await readHistory(host, { sourceId: P1.sourceId, id: P1.id, revision: 3 })).ok, false);
  assert.equal(calls, 1);
});
