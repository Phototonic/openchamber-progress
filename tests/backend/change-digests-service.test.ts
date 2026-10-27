import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFileSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import fs from 'node:fs';
import { createProgressServer } from '../../service/server.ts';
import { Store } from '../../shared/store.ts';
import { DIGEST_LIMITS, type ChangeDigest } from '../../shared/change-digest.ts';
import type { ItemInput } from '../../shared/progress.ts';
import { digestFixture } from '../fixtures/change-digests.ts';

async function serve(store?: Store) {
  const server = createProgressServer(store, 'fixture-only'); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return { server, get: (route: string, init?: RequestInit) => fetch(base + route, { ...init, headers: { authorization: 'Bearer fixture-only', ...init?.headers } }), stop: () => new Promise<void>(resolve => server.close(() => resolve())) };
}
function route(request: Record<string, unknown>) { return '/v1/change-digest?' + new URLSearchParams(Object.entries(request).map(([k, v]) => [k, String(v)])); }
function commit(f: ReturnType<typeof digestFixture>, items: ItemInput[]) {
  const upload = `upload-${f.store.get(f.source.id, 'P-digest')!.revision}`;
  // Eight items fits even maximal UTF-8 titles in the report request budget.
  for (let i = 0; i < items.length; i += 8) f.apply({ op: 'stage', upload, chunk: i / 8, items: items.slice(i, i + 8) });
  f.apply({ op: 'commit', upload, chunks: Math.ceil(items.length / 8) });
}
const digest = async (s: Awaited<ReturnType<typeof serve>>, request: Record<string, unknown>): Promise<ChangeDigest> => { const r = await s.get(route(request)); assert.equal(r.status, 200); return r.json(); };

test('real authenticated HTTP freezes identity, errors, initial and read-only behavior', async () => {
  const f = digestFixture(); f.throughSix(); const s = await serve(f.store);
  try {
    const health = await (await s.get('/health')).json(); assert.equal(health.planChangeDigests, 1);
    const request = f.request(6, 1), path = route(request);
    const before = f.store.db.prepare('SELECT * FROM revisions ORDER BY revision').all();
    const tables = f.store.db.prepare("SELECT name FROM sqlite_master ORDER BY name").all();
    const bytes = readFileSync(f.store.file);
    const d = await digest(s, request);
    assert.equal(d.storeId, f.storeId); assert.deepEqual(d.sourceBinding, { sourceId: f.source.id, verified: true });
    assert.equal(d.source, f.source.id); assert.equal(d.plan, 'P-digest'); assert.equal(d.interval.to, 6); assert.equal(d.interval.after, 1); assert.equal(d.interval.coverageStart, 1); assert.equal(d.interval.coverageEnd, 6);
    assert.equal(d.summary.events.blocked, 1); assert.equal(d.summary.events.unblocked, 1); assert.equal(d.summary.events.completed, 1);
    assert.equal((await s.get(path, { headers: { authorization: 'Bearer wrong' } })).status, 401);
    assert.equal((await s.get(path, { method: 'POST' })).status, 405);
    for (const suffix of ['&unknown=1', '&to=6']) assert.equal((await s.get(path + suffix)).status, 404);
    for (const patch of [{ to: 7 }, { to: 0 }, { after: 7 }, { after: 0 }, { to: '1.5' }, { to: '9007199254740992' }, { cleanupRev: -1 }, { to: '' }]) assert.equal((await s.get(route({ ...request, ...patch }))).status, 400);
    for (const patch of [{ storeId: 'wrong' }, { cleanupRev: 1 }]) assert.equal((await s.get(route({ ...request, ...patch }))).status, 409);
    assert.equal((await s.get(route({ ...request, plan: 'missing' }))).status, 404);
    const { storeId: _, ...missing } = request; assert.equal((await s.get(route(missing))).status, 400);
    const initial = await digest(s, f.request()); assert.equal(initial.availability, 'initial'); assert.equal(initial.counts.before, null); assert.equal(initial.summary.events.added, 0); assert.equal(initial.validTarget, true);
    assert.deepEqual(f.store.db.prepare('SELECT * FROM revisions ORDER BY revision').all(), before);
    assert.deepEqual(f.store.db.prepare('SELECT name FROM sqlite_master ORDER BY name').all(), tables);
    assert.deepEqual(readFileSync(f.store.file), bytes);
    const reader = new Store(f.store.file, { readOnly: true }); const readonly = await serve(reader);
    try { assert.equal((await digest(readonly, request)).complete, true); } finally { await readonly.stop(); reader.close(); }
    const unavailable = await serve(); try { assert.equal((await unavailable.get(path)).status, 503); } finally { await unavailable.stop(); }
    // Revisions above the legacy nine-digit page parser, up to MAX_SAFE_INTEGER.
    const high = Number.MAX_SAFE_INTEGER, p = f.store.get(f.source.id, 'P-digest')!; p.revision = high;
    f.store.db.prepare('UPDATE plans SET revision=?,snapshot=?').run(high, JSON.stringify(p));
    f.store.db.prepare('INSERT INTO revisions SELECT source,plan,?, ?,actor FROM revisions WHERE revision=6').run(high, JSON.stringify(p));
    const max = await digest(s, { ...request, to: high, after: high }); assert.equal(max.interval.to, high); assert.equal(max.complete, true); assert.equal(max.work.intervalSnapshots, 1);
    f.store.db.prepare("UPDATE plans SET snapshot=json_set(snapshot,'$.lifecycle','invalid')").run();
    assert.equal((await s.get(route({ ...request, to: high, after: high }))).status, 503);
  } finally { await s.stop(); f.cleanup(); }
});

test('missing baseline differs from initial; missing/invalid history never bridges the proven suffix', async () => {
  for (const mode of ['baseline', 'gap', 'identity', 'items', 'target', 'oversize-target'] as const) {
    const f = digestFixture(); f.throughSix(); const s = await serve(f.store);
    try {
      if (mode === 'baseline' || mode === 'gap' || mode === 'target') {
        const rev = mode === 'baseline' ? 1 : mode === 'gap' ? 3 : 6;
        f.store.db.prepare('DELETE FROM contributions WHERE revision=?').run(rev);
        f.store.db.prepare('DELETE FROM revisions WHERE revision=?').run(rev);
      } else {
        const rev = mode === 'oversize-target' ? 6 : 3;
        const p = JSON.parse(String(f.store.db.prepare('SELECT snapshot FROM revisions WHERE revision=?').get(rev)!.snapshot));
        if (mode === 'identity') p.sourceId = 'wrong';
        if (mode === 'items') p.items.push(p.items[0]);
        if (mode === 'oversize-target') p.padding = 'x'.repeat(DIGEST_LIMITS.bytes);
        f.store.db.prepare('UPDATE revisions SET snapshot=? WHERE revision=?').run(JSON.stringify(p), rev);
      }
      const d = await digest(s, f.request(6, 1));
      assert.equal(d.complete, false, mode);
      if (mode === 'target' || mode === 'oversize-target') { assert.equal(d.availability, 'target-unavailable'); assert.equal(d.validTarget, false); assert.equal(d.counts.after, null); assert.equal(d.work.inputBytes, 0); }
      else {
        assert.equal(d.validTarget, true);
        assert.equal(d.availability, mode === 'baseline' ? 'baseline-unavailable' : 'comparison');
        assert.equal(d.interval.coverageStart, mode === 'baseline' ? 2 : 4);
        assert.equal(d.summary.events.blocked, 0); assert.equal(d.summary.events.unblocked, mode === 'baseline' ? 1 : 0); assert.equal(d.summary.events.completed, 1);
        assert.equal(d.counts.before === null, mode === 'baseline');
        assert(d.reasons.includes(mode === 'identity' || mode === 'items' ? 'invalid-snapshot' : 'missing-snapshot'));
      }
    } finally { await s.stop(); f.cleanup(); }
  }
});

test('revision and byte budgets stop before oversized input; counts can remain exact', async t => {
  const f = digestFixture(); const s = await serve(f.store);
  try {
    for (let i = 0; i < 140; i++) f.change(i % 2 ? 'working' : 'blocked');
    const d = await digest(s, f.request(141, 1));
    assert.equal(d.work.intervalSnapshots, 128); assert.equal(d.work.baselineLookups, 1); assert(d.reasons.includes('revision-bound')); assert.equal(d.complete, false); assert(d.counts.before); assert.equal(d.interval.coverageStart, 14);
    t.diagnostic(`revision-bound ${JSON.stringify(d.work)} coverageStart=${d.interval.coverageStart}`);
    // Labelled valid large-history fixture: 1,000 maximum-length bounded item facts.
    const items = Array.from({ length: 1000 }, (_, n) => ({ id: `T${n}`, title: '漢'.repeat(512), kind: 'task', status: 'working' }));
    const p = f.store.get(f.source.id, 'P-digest')!;
    for (let rev = 1; rev <= 141; rev++) {
      const snapshot = JSON.stringify({ ...p, revision: rev, structuralRevision: rev, items: items.map(i => ({ ...i, status: rev % 2 ? 'working' : 'blocked' })) });
      f.store.db.prepare('UPDATE revisions SET snapshot=? WHERE revision=?').run(snapshot, rev);
    }
    const big = await digest(s, f.request(141, 1));
    assert(big.reasons.includes('byte-bound')); assert(big.work.inputBytes <= DIGEST_LIMITS.bytes); assert(big.work.intervalSnapshots < 128); assert(big.counts.before); assert.equal(big.complete, false);
    assert(big.details.omittedTasks); assert.equal(big.details.omittedTaskCount, null);
    assert(Buffer.byteLength(JSON.stringify(big)) <= DIGEST_LIMITS.responseBytes);
    t.diagnostic(`byte-bound ${JSON.stringify(big.work)} bodyBytes=${Buffer.byteLength(JSON.stringify(big))}`);
  } finally { await s.stop(); f.cleanup(); }
});

test('row/reference/body caps preserve transition totals and disclose omissions', async t => {
  const f = digestFixture(); const s = await serve(f.store);
  try {
    const items: ItemInput[] = Array.from({ length: 70 }, (_, n) => ({ id: `T${String(n).padStart(2, '0')}`, title: '漢'.repeat(512), kind: 'task', status: 'working' }));
    commit(f, items); const baseline = f.store.get(f.source.id, 'P-digest')!.revision;
    for (let i = 0; i < 6; i++) commit(f, items.map(item => ({ ...item, title: (i % 2 ? '語' : '漢').repeat(512), status: i % 2 ? 'working' : 'blocked' })));
    const d = await digest(s, f.request(undefined, baseline));
    assert.equal(d.summary.events.blocked, 210); assert.equal(d.summary.events.unblocked, 210);
    assert.equal(d.complete, true); assert(d.tasks.length <= 50); assert(d.tasks.length < 50, 'serialized byte cap trims rows');
    assert(d.details.omittedTasks); assert(d.details.truncated); assert.equal(d.details.omittedTaskCount, null);
    assert(d.tasks.every(t => t.references.length === 4 && t.omittedReferences === 2));
    assert(Buffer.byteLength(JSON.stringify(d)) <= DIGEST_LIMITS.responseBytes);
    assert.deepEqual(d.tasks.map(t => t.id), [...d.tasks.map(t => t.id)].sort());
    t.diagnostic(`output-bound rows=${d.tasks.length} bodyBytes=${Buffer.byteLength(JSON.stringify(d))} omittedTasks=${d.details.omittedTasks} omittedTaskCount=${d.details.omittedTaskCount}`);
  } finally { await s.stop(); f.cleanup(); }
});

test('pinned transaction tolerates an independent WAL writer at the snapshot seam', async () => {
  const f = digestFixture(); f.throughSix(); f.store.db.exec('PRAGMA journal_mode=WAL');
  const writer = new Store(f.store.file); const prepare = f.store.db.prepare.bind(f.store.db);
  let wrote = false;
  // Labelled seam after the live existence SELECT established the read snapshot.
  f.store.db.prepare = ((sql: string) => {
    if (!sql.startsWith('SELECT length(CAST(snapshot')) return prepare(sql);
    const statement = prepare(sql), get = statement.get.bind(statement);
    statement.get = ((...args: any[]) => {
      if (!wrote) { wrote = true; writer.apply({ op: 'change', plan: 'P-digest', oid: 'concurrent', rev: 6, changes: [{ id: 'D', status: 'done' }] }, f.actor); }
      return get(...args);
    }) as typeof statement.get;
    return statement;
  }) as typeof f.store.db.prepare;
  const s = await serve(f.store);
  try {
    const d = await digest(s, f.request(6, 1)); assert(wrote); assert.equal(d.interval.to, 6); assert.equal(d.interval.latestRevision, 6); assert.equal(d.counts.after!.done, 2); assert.equal(d.summary.events.completed, 1);
    assert.equal(writer.get(f.source.id, 'P-digest')!.revision, 7);
  } finally { f.store.db.prepare = prepare; await s.stop(); writer.close(); f.cleanup(); }
});

test('archive/restore/reopen preserve baseline; deletion invalidates only that source identity', async () => {
  const f = digestFixture(); const s = await serve(f.store);
  try {
    f.change('done'); f.apply({ op: 'change', changes: [{ id: 'C', status: 'done' }] }); f.apply({ op: 'finish', outcome: 'finished' });
    const cleanup = (action: 'archive' | 'restore' | 'delete', cleanupRev: number) => f.store.cleanup(action, { storeId: f.storeId, source: f.source.id, plan: 'P-digest', rev: f.store.get(f.source.id, 'P-digest')!.revision, cleanupRev, oid: action, ...(action === 'delete' ? { confirmed: true } : {}) });
    cleanup('archive', 0);
    assert.equal((await s.get(route(f.request(4, 1, 0)))).status, 409);
    const archived = await digest(s, f.request(4, 1, 1)); assert.equal(archived.cleanup.state, 'archived'); assert.equal(archived.counts.before!.done, 1);
    cleanup('restore', 1); f.apply({ op: 'revise', title: 'Continue', reopen: true }); f.change('working');
    const reopened = await digest(s, f.request(6, 1, 2)); assert.equal(reopened.interval.currentLifecycle, 'active'); assert.equal(reopened.summary.events.reopened, 1); assert.equal(reopened.counts.before!.done, 1);
    f.store.registerSource({ ...f.source, id: 'source-other', configRoot: '/fixture/other-config', dataRoot: '/fixture/other-data' });
    f.store.apply({ op: 'start', plan: 'P-digest', rev: 0, oid: 'other', title: 'Independent', items: [{ id: 'A', title: 'Other task', kind: 'task' }] }, { ...f.actor, sourceId: 'source-other' });
    // Cleanup intentionally accepts finished plans only, preserving its existing gate.
    f.change('done'); f.apply({ op: 'finish', outcome: 'finished' }); cleanup('delete', 2);
    assert.equal((await s.get(route(f.request(8, 1, 3)))).status, 404);
    const other = await digest(s, { ...f.request(1, undefined, 0), source: 'source-other' }); assert.equal(other.validTarget, true); assert.equal(other.counts.after!.total, 1);
  } finally { await s.stop(); f.cleanup(); }
});

test('a held pre-delete reply remains a captured interval, never authorization for a deleted plan', { timeout: 10000 }, async () => {
  const f = digestFixture(); f.change('done'); f.apply({ op: 'finish', outcome: 'finished' });
  const s = await serve(f.store);
  let captured!: () => void, release!: () => void;
  const held = new Promise<void>(resolve => { captured = resolve; });
  s.server.prependOnceListener('request', (_req, res) => {
    const end = res.end.bind(res);
    res.end = ((...args: any[]) => { let released = false; release = () => { if (!released) { released = true; (end as any)(...args); } }; captured(); return res; }) as typeof res.end;
  });
  try {
    const response = s.get(route(f.request(3, 1))); await held;
    f.store.cleanup('delete', { storeId: f.storeId, source: f.source.id, plan: 'P-digest', rev: 3, cleanupRev: 0, oid: 'delete-held', confirmed: true });
    release(); const old: ChangeDigest = await (await response).json();
    assert.equal(old.interval.to, 3); assert.equal(old.cleanup.revision, 0);
    assert.equal((await s.get(route(f.request(3, 1)))).status, 404);
    assert.equal(f.store.get(f.source.id, 'P-digest'), undefined);
  } finally { release?.(); await s.stop(); f.cleanup(); }
});

test('list never compares; digest reads never capture or read source documents and leave SQL unchanged', async () => {
  const f = digestFixture();
  const document = `${f.root}/synthetic.md`; writeFileSync(document, 'Synthetic source\n');
  f.store.apply({ op: 'bind', plan: 'P-digest', rev: 1, oid: 'bind-document', source: document }, f.actor, { state: 'denied', path: document, checkedAt: new Date().toISOString() });
  const s = await serve(f.store); const originalDigest = f.store.changeDigest.bind(f.store);
  let calls = 0, reads = 0;
  f.store.changeDigest = (...args) => { calls++; return originalDigest(...args); };
  const read = fs.readFileSync, readSync = fs.readSync, open = fs.openSync;
  fs.readFileSync = ((...args: any[]) => { reads++; return (read as any)(...args); }) as typeof fs.readFileSync;
  fs.readSync = ((...args: any[]) => { reads++; return (readSync as any)(...args); }) as typeof fs.readSync;
  fs.openSync = ((...args: any[]) => { reads++; return (open as any)(...args); }) as typeof fs.openSync;
  syncBuiltinESMExports();
  try {
    const sql = () => f.store.db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(r => [r.name, f.store.db.prepare(`SELECT * FROM ${r.name}`).all()]);
    const before = sql();
    for (let i = 0; i < 3; i++) assert.equal((await s.get('/v1/plans')).status, 200);
    assert.equal(calls, 0);
    await digest(s, f.request(2, 1)); assert.equal(calls, 1); assert.equal(reads, 0); assert.deepEqual(sql(), before);
  } finally { fs.readFileSync = read; fs.readSync = readSync; fs.openSync = open; syncBuiltinESMExports(); assert.equal(readFileSync(document, 'utf8'), 'Synthetic source\n'); await s.stop(); f.cleanup(); }
});
