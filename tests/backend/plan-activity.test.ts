import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { createProgressServer } from '../../service/server.ts';
import { Store } from '../../shared/store.ts';
import { productionFixture } from '../fixtures/production.ts';
import type { Actor, Contribution } from '../../shared/progress.ts';

test('activity windows include user and unavailable rows without shifting attribution or writing data', async () => {
  const f = productionFixture(), { store, actor } = f, source = f.source.id, plan = 'sample';
  const a = { ...f.child, sessionId: 'A' }, b = { ...f.child, sessionId: 'B' };
  const token = 'synthetic-activity-fixture', binding = { sourceId: source, verified: true };
  store.bindReads(source, true);
  const server = createProgressServer(store, token);
  try {
    let rev = 0;
    function apply(request: Record<string, unknown>, who: Actor = actor, child?: Actor) {
      rev = store.apply({ plan, rev, oid: `report-${rev}`, ...request }, who, undefined, child).rev;
    }
    const items = ['X', 'Y', 'Z'].map(id => ({ id, title: id, kind: 'task' }));
    apply({ op: 'start', title: 'Sample', items });
    apply({ op: 'link', child: 'A', assign: ['X', 'Y'] }, actor, a);
    apply({ op: 'link', child: 'B', assign: ['Z'] }, actor, b);
    apply({ op: 'change', changes: [{ id: 'X', status: 'working' }, { id: 'Y', status: 'done' }] }, a);
    apply({ op: 'change', attributed: 'B', changes: [{ id: 'Z', status: 'working' }] }, actor, b);
    apply({ op: 'change', changes: [{ id: 'Z', status: 'done' }] }, b);
    const { storeId } = store.list();
    const cancelled = store.cancelPlan({ storeId, binding, source, plan, rev, cleanupRev: 0, oid: 'user-cancel', confirmed: true });
    rev = cancelled.rev;
    apply({ op: 'revise', title: 'Continue', items: items.slice(1), reopen: true });
    apply({ op: 'finish', outcome: 'cancelled', changes: [{ id: 'Z', status: 'done' }] });
    apply({ op: 'revise', title: 'Continue again', reopen: true });
    const absentTime = store.get(source, plan)!.reportedAt;
    store.db.prepare('DELETE FROM contributions WHERE source=? AND plan=? AND revision=10').run(source, plan);
    while (rev < 27) apply({ op: 'change', changes: [{ id: 'Z', status: 'done' }] });
    // Simulate the older snapshot time actually preserved during automatic binding.
    store.db.prepare(`UPDATE revisions SET snapshot=json_set(snapshot,'$.reportedAt',?) WHERE source=? AND plan=? AND revision=3`)
      .run('2000-01-01T00:00:00.000Z', source, plan);
    const reportRows = new Map(store.db.prepare('SELECT revision,payload FROM contributions WHERE source=? AND plan=?').all(source, plan)
      .map(r => {
        const { reporterAgent: _internal, ...c } = JSON.parse(String(r.payload)) as Contribution;
        return [r.revision, { ...c, kind: 'report' }];
      }));
    const expected = (through: number) => Array.from({ length: Math.min(20, through) }, (_, i) => {
      const revision = through - i;
      if (revision === 7) return { revision, kind: 'user', reportedAt: cancelled.reportedAt };
      if (revision === 10) return { revision, kind: 'unavailable', reportedAt: absentTime };
      return reportRows.get(revision);
    });
    store.setEnabled(false);
    const dump = () => ['plans', 'revisions', 'receipts', 'contributions', 'sessions', 'meta']
      .map(table => store.db.prepare(`SELECT * FROM ${table}`).all());
    const before = dump(), writes = store.db.prepare('SELECT total_changes() AS n').get();
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/history?`;
    const params = `source=${source}&plan=${plan}`, route = `${params}&through=`;
    async function get(q: string, auth = true) {
      const res = await fetch(url + q, { headers: auth ? { authorization: `Bearer ${token}` } : {} });
      return { status: res.status, body: await res.json() };
    }
    for (const through of [8, 27, 7]) {
      assert.deepEqual(await get(route + through), { status: 200, body: {
        protocolVersion: 2, schemaVersion: 2, planActivity: 1, storeId, sourceBinding: binding,
        source, plan, cleanupRev: 0, rows: expected(through), nextThrough: through > 20 ? through - 20 : null,
      } });
    }
    const readOnly = new Store(store.file, { readOnly: true });
    try { assert.deepEqual(readOnly.planActivity(source, plan, 8).rows, expected(8)); }
    finally { readOnly.close(); }
    const plain = await get(`${params}&cursor=5&limit=2`);
    assert.equal(plain.status, 200);
    assert.deepEqual(plain.body.data.map(({ revision, actor }: { revision: number; actor?: string }) => [revision, actor]), [[6, undefined], [7, 'user']]);
    assert.equal(plain.body.nextCursor, '7');
    assert.equal(plain.body.rows, undefined);
    assert.deepEqual(await get(route + '8', false), { status: 401, body: { error: 'unauthorized' } });
    for (const bad of ['', '0', '-1', '1.5', 'NaN', '9007199254740992', '28']) {
      assert.deepEqual(await get(route + bad), { status: 400, body: { error: 'invalid' } });
    }
    for (const extra of ['&cursor=0', '&limit=20', '&through=1']) {
      assert.deepEqual(await get(route + '8' + extra), { status: 404, body: { error: 'not-found' } });
    }
    assert.equal((await get(`source=${source}&plan=missing&through=1`)).status, 404);
    assert.deepEqual(dump(), before);
    assert.deepEqual(store.db.prepare('SELECT total_changes() AS n').get(), writes);
    store.db.prepare(`UPDATE contributions SET payload=json_set(payload,'$.reporterSessionId','B','$.attributedSessionId','B') WHERE source=? AND plan=? AND revision=4`).run(source, plan);
    assert.deepEqual(await get(route + '8'), { status: 503, body: { error: 'corrupt' } });
    store.db.prepare('DELETE FROM revisions WHERE source=? AND plan=? AND revision=10').run(source, plan);
    assert.deepEqual(await get(route + '27'), { status: 503, body: { error: 'corrupt' } });
  } finally {
    if (server.listening) { server.close(); await once(server, 'close'); }
    f.cleanup();
  }
});
