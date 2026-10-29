import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../../shared/store.ts';
import { RESUME_LIMITS, type ResumeRequest } from '../../shared/progress-resume.ts';
import type { PlanState } from '../../shared/progress.ts';
import { productionFixture, P1 } from '../fixtures/production.ts';

function fixture() {
  const f = productionFixture();
  f.store.bindReads(f.source.id, true);
  const request: ResumeRequest = { storeId: String(f.store.db.prepare('SELECT store_id FROM meta').get()!.store_id), sourceId: f.source.id, sessionId: 'M', parentId: null, ancestry: [] };
  function seed(id: string, fields: Partial<PlanState> & { padding?: string } = {}) {
    const p: PlanState = { id, sourceId: f.source.id, revision: 1, structuralRevision: 1, lifecycle: 'active', reportedAt: '2026-01-01T00:00:00.000Z', title: `Synthetic ${id}`, sessionId: 'M', directory: '/fixture/Alpha', document: { state: 'unbound', checklistSynchronized: false, currentFile: 'not-rechecked' }, items: [{ id: 'I1', title: 'Private task prose', kind: 'task', status: 'pending' }], links: [], ...fields };
    f.store.db.prepare('INSERT INTO plans VALUES(?,?,?,?) ON CONFLICT(source,id) DO UPDATE SET revision=excluded.revision,snapshot=excluded.snapshot').run(p.sourceId, id, p.revision, JSON.stringify(p));
    return p;
  }
  const read = (overrides: Partial<ResumeRequest> = {}, now = () => 0) => f.store.resumePlans({ ...request, ...overrides }, { now });
  return { ...f, request, seed, read };
}

test('V2 current revision is a pointer, not mutation authority; read is side-effect free', () => {
  const f = fixture();
  try {
    f.store.apply({ op: 'start', plan: 'P-alpha', oid: 'start', rev: 0, title: 'Synthetic alpha', items: P1 }, f.actor);
    f.store.apply({ op: 'revise', plan: 'P-alpha', oid: 'rename', rev: 1, title: 'Synthetic alpha r2' }, f.actor);
    const changes = f.store.db.prepare('SELECT total_changes() AS n').get()!.n;
    const schema = f.store.db.prepare('SELECT name,sql FROM sqlite_master ORDER BY name').all();
    const result = f.read()!;
    assert.deepEqual(result.candidates, [{ sourceId: f.source.id, plan: 'P-alpha', title: 'Synthetic alpha r2', revision: 2, scope: 'coordinator' }]);
    assert.equal(result.incomplete, false); assert.equal(result.omitted, false);
    assert.equal(f.store.detail(f.source.id, 'P-alpha').plan.revision, 2);
    assert.throws(() => f.store.apply({ op: 'change', plan: 'P-alpha', oid: 'stale', rev: 1, changes: [{ id: 'I4', status: 'done' }] }, f.actor), /conflict/);
    assert.equal(f.store.db.prepare('SELECT total_changes() AS n').get()!.n, changes);
    assert.deepEqual(f.store.db.prepare('SELECT name,sql FROM sqlite_master ORDER BY name').all(), schema);
    const ro = new Store(f.store.file, { readOnly: true });
    try { ro.bindReads(f.source.id, true); assert.deepEqual(ro.resumePlans(f.request, { now: () => 0 }), result); } finally { ro.close(); }
  } finally { f.cleanup(); }
});

test('V3 stable active candidates, two/three/four overflow, literal titles and incomplete singleton', () => {
  const f = fixture();
  try {
    f.seed('P-z', { lifecycle: 'finished' });
    f.seed('P-beta'); f.seed('P-alpha', { title: '🌱'.repeat(120) + ' "data"\n' });
    assert.deepEqual(f.read()!.candidates.map(p => p.plan), ['P-alpha', 'P-beta']);
    f.seed('P-gamma'); assert.equal(f.read()!.candidates.length, 3); assert.equal(f.read()!.incomplete, false);
    f.seed('P-delta'); const four = f.read()!;
    assert.deepEqual(four.candidates.map(p => p.plan), ['P-alpha', 'P-beta', 'P-delta']);
    assert.equal(four.omitted, true); assert.equal(four.limit, 'candidates'); assert.equal(four.incomplete, true);
    assert.equal(four.candidates[0].title, '🌱'.repeat(120) + ' "data"\n');
    let calls = 0;
    const limited = f.read({}, () => ++calls >= 4 ? 100 : 0)!;
    assert.equal(limited.candidates.length, 1); assert.equal(limited.incomplete, true); assert.equal(limited.limit, 'time');
  } finally { f.cleanup(); }
});

test('V4 helper requires complete ancestry and consistent current assignments, never independent/history/sibling authority', () => {
  const f = fixture();
  try {
    f.store.apply({ op: 'start', plan: 'P-linked', oid: 'start', rev: 0, title: 'Synthetic linked', items: P1 }, f.actor);
    f.store.apply({ op: 'link', plan: 'P-linked', oid: 'link', rev: 1, child: 'C1', assign: ['I3'] }, f.actor, undefined, f.child);
    f.seed('P-child-owned', { sessionId: 'C1' });
    const result = f.read(f.child)!;
    assert.deepEqual(result.candidates, [{ sourceId: f.source.id, plan: 'P-linked', title: 'Synthetic linked', revision: 2, scope: 'assigned', itemIds: ['I3'] }]);
    assert.equal(JSON.stringify(result.candidates).includes('Native'), false);
    assert.equal(f.read({ ...f.child, sessionId: 'sibling' })!.candidates.length, 0);
    for (const ancestry of [null, [], ['C1', 'M'], ['M', 'M'], Array.from({ length: 33 }, (_, i) => `s${i}`)]) assert.equal(f.read({ ...f.child, ancestry }), null);
    f.store.apply({ op: 'change', plan: 'P-linked', oid: 'contribute', rev: 2, changes: [{ id: 'I3', status: 'done' }] }, f.child);
    f.store.apply({ op: 'link', plan: 'P-linked', oid: 'unlink', rev: 3, child: 'C1', assign: [] }, f.actor, undefined, f.child);
    assert.equal(f.read(f.child)!.candidates.length, 0); // Historical contribution retained.
    f.store.apply({ op: 'link', plan: 'P-linked', oid: 'reassign', rev: 4, child: 'C1', assign: ['I4'] }, f.actor, undefined, f.child);
    assert.deepEqual((f.read(f.child)!.candidates[0] as { itemIds: string[] }).itemIds, ['I4']);
  } finally { f.cleanup(); }
});

test('V4 child scope of 20 is complete; 21 is omitted without prose or partial IDs', () => {
  const f = fixture();
  try {
    for (const count of [20, 21]) {
      const ids = Array.from({ length: count }, (_, i) => `I${i}`);
      f.seed('P-scope', { items: ids.map(id => ({ id, title: 'Hidden task prose', kind: 'task', status: 'pending', assigneeSessionId: 'C1' })), links: [{ sessionId: 'C1', itemIds: ids }] });
      const result = f.read(f.child)!;
      assert.equal(result.candidates.length, count === 20 ? 1 : 0);
      assert.equal(result.omitted, count === 21); assert.equal(result.incomplete, false);
      if (count === 20) assert.deepEqual((result.candidates[0] as { itemIds: string[] }).itemIds, ids);
    }
  } finally { f.cleanup(); }
});

test('V5 active-only root/child, source isolation, missing/unverified binding and disabled control', () => {
  const f = fixture();
  try {
    assert.deepEqual(f.read()!.candidates, []);
    for (const lifecycle of ['finished', 'cancelled', 'failed'] as const) {
      f.seed(`P-${lifecycle}`, { lifecycle, items: [{ id: 'I1', title: 'Hidden', kind: 'task', status: 'pending', assigneeSessionId: 'C1' }], links: [{ sessionId: 'C1', itemIds: ['I1'] }] });
    }
    assert.equal(f.read()!.candidates.length, 0); assert.equal(f.read(f.child)!.candidates.length, 0);
    f.seed('P-other-session', { sessionId: 'unrelated' });
    const sourceB = { ...f.source, id: 'source-B', configRoot: '/fixture/B/config', dataRoot: '/fixture/B/data' };
    f.store.registerSource(sourceB); f.seed('P-alpha', { sourceId: sourceB.id });
    assert.equal(f.read()!.candidates.length, 0);
    f.seed('P-alpha'); assert.equal(f.read()!.candidates.length, 1);
    assert.equal(f.read({ storeId: 'wrong' }), null); assert.equal(f.read({ sourceId: 'source-B' }), null);
    f.store.bindReads(f.source.id, false); assert.equal(f.read(), null);
    f.store.bindReads(f.source.id, true); f.store.setEnabled(false); assert.equal(f.read(), null);
    f.store.setEnabled(true); f.store.db.prepare('UPDATE sources SET verified=0 WHERE id=?').run(f.source.id); assert.equal(f.read(), null);
  } finally { f.cleanup(); }
});

test('V5/V7 archive/delete and unavailable binding cannot supply recovery', () => {
  const f = fixture();
  try {
    f.store.apply({ op: 'start', plan: 'P-done', oid: 'start', rev: 0, title: 'Synthetic closed', items: [{ id: 'I', title: 'Done', kind: 'task', status: 'done' }] }, f.actor);
    f.store.apply({ op: 'finish', plan: 'P-done', oid: 'finish', rev: 1, outcome: 'finished' }, f.actor);
    const body = { storeId: f.request.storeId, source: f.source.id, plan: 'P-done', rev: 2, cleanupRev: 0, oid: 'archive' };
    f.store.cleanup('archive', body); assert.equal(f.read()!.candidates.length, 0);
    f.store.cleanup('delete', { ...body, cleanupRev: 1, oid: 'delete', confirmed: true }); assert.equal(f.read()!.candidates.length, 0);
    const unbound = new Store(f.store.file, { readOnly: true });
    try { assert.equal(unbound.resumePlans(f.request), null); } finally { unbound.close(); }
  } finally { f.cleanup(); }
});

test('V7 slot budget precedes eligibility; no history/contribution/document/source-root scan', () => {
  const f = fixture();
  try {
    for (let i = 0; i < 65; i++) f.seed(`P-${String(i).padStart(3, '0')}`, { sessionId: i === 0 ? 'M' : 'other' });
    // Removing these tables makes accidental broad readers fail rather than merely return no rows.
    for (const table of ['revisions', 'contributions', 'captures', 'sessions']) f.store.db.exec(`DROP TABLE ${table}`);
    const result = f.read()!;
    assert.equal(result.work.planSlots, 64); assert.equal(result.work.snapshots, 64);
    assert.equal(result.candidates.length, 1); assert.equal(result.incomplete, true); assert.equal(result.limit, 'slots');
  } finally { f.cleanup(); }
});

test('V7 SQL byte admission: per-snapshot fail closed, total admitted JSON partial at 8 MiB', () => {
  const f = fixture();
  try {
    f.seed('P-big', { padding: 'x'.repeat(RESUME_LIMITS.snapshotBytes) });
    assert.throws(() => f.read(), /corrupt/);
    f.store.db.exec('DELETE FROM plans');
    const size = RESUME_LIMITS.snapshotBytes - 100;
    for (let i = 0; i < 9; i++) {
      const p = f.seed(`P-${i}`, { sessionId: i === 0 ? 'M' : 'other', padding: '' });
      f.seed(`P-${i}`, { ...p, padding: 'x'.repeat(size - Buffer.byteLength(JSON.stringify({ ...p, padding: '' }))) });
    }
    const result = f.read()!;
    assert.equal(result.limit, 'bytes'); assert.equal(result.incomplete, true); assert.equal(result.candidates.length, 1);
    assert.equal(result.work.snapshots, 8); assert.equal(result.work.inputBytes, size * 8);
  } finally { f.cleanup(); }
});

test('V7 corrupt/contradictory metadata rejects the whole result, including earlier proven candidates', () => {
  const f = fixture();
  try {
    f.seed('P-a');
    const base = f.seed('P-z');
    const bad: unknown[] = [
      { ...base, revision: 2 }, { ...base, sourceId: 'wrong' }, { ...base, lifecycle: 'unknown' },
      { ...base, title: '' }, { ...base, items: [...base.items, ...base.items] },
      { ...base, links: [{ sessionId: 'C1', itemIds: ['missing'] }] },
      { ...base, links: [{ sessionId: 'C1', itemIds: ['I1'] }] },
      { ...base, items: [{ ...base.items[0], assigneeSessionId: 'C1' }] },
      { ...base, links: Array.from({ length: 65 }, (_, i) => ({ sessionId: `C${i}`, itemIds: [] })) },
      { ...base, items: Array.from({ length: 1001 }, (_, i) => ({ ...base.items[0], id: `I${i}` })) },
    ];
    for (const value of bad) {
      f.store.db.prepare('UPDATE plans SET snapshot=? WHERE id=?').run(JSON.stringify(value), 'P-z');
      assert.throws(() => f.read(), /corrupt/);
    }
    f.seed('P-z', { items: Array.from({ length: 1000 }, (_, i) => ({ id: `I${i}`, title: 'Synthetic task', kind: 'task', status: 'pending' })) });
    assert.equal(f.read()!.candidates.length, 2);
  } finally { f.cleanup(); }
});

test('V7 cooperative time boundary discards unproven in-flight candidate and rejects invalid clocks', () => {
  const f = fixture();
  try {
    f.seed('P-a');
    let calls = 0;
    const result = f.read({}, () => ++calls === 3 ? 100 : 0)!;
    assert.equal(result.limit, 'time'); assert.equal(result.candidates.length, 0); assert.equal(result.work.snapshots, 1);
    assert.throws(() => f.read({}, () => NaN), /invalid/);
    const contender = new Store(f.store.file, { busyMs: 25 });
    try {
      contender.bindReads(f.source.id, true); f.store.db.exec('BEGIN EXCLUSIVE');
      assert.throws(() => contender.resumePlans(f.request), /busy/);
    } finally { f.store.db.exec('ROLLBACK'); contender.close(); }
  } finally { f.cleanup(); }
});
