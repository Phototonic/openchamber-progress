import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, fork, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../../shared/store.ts';
import { receiptIndexInstalled } from '../../shared/receipt-index.ts';
import { cleanupInstalled } from '../../shared/cleanup.ts';
import { lifecycle, migrationBinding } from '../../setup/lifecycle.ts';
import { durableSnapshot } from './subagent-format-support.ts';
import { fixture } from './subagent-test-support.ts';
import { productionFixture } from '../fixtures/production.ts';

// The cross-plan lookup used by Store.handoff, including its child predicate.
const lookup = "SELECT plan,payload_hash,receipt FROM receipts WHERE source=? AND oid=? AND json_extract(receipt,'$._handoffChild')=? LIMIT 1";
const indexName = 'receipts_source_oid';

test('handoff lookup searches both source and operation ID, not the source prefix alone', () => {
  const f = productionFixture();
  try {
    const detail = f.store.db.prepare(`EXPLAIN QUERY PLAN ${lookup}`).all(f.source.id, 'claim', 'child').map(r => r.detail).join('\n');
    assert.match(detail, /SEARCH receipts USING INDEX receipts_source_oid \(source=\? AND oid=\?\)/);
  } finally { f.cleanup(); }
});

test('creation and activation are atomic and idempotent; ordinary opens and setup inspection never install', () => {
  const f = productionFixture();
  try {
    assert.equal(receiptIndexInstalled(f.store.db), true);
    f.store.db.exec(`DROP INDEX ${indexName}`);
    const before = durableSnapshot(f.store.db), bytes = fs.readFileSync(f.store.file);
    for (const readOnly of [true, false]) {
      const reader = new Store(f.store.file, { readOnly });
      try { assert.equal(reader.list().schemaVersion, 2); assert.equal(reader.subagentRunStorage(), 'absent'); }
      finally { reader.close(); }
    }
    assert.deepEqual(durableSnapshot(f.store.db), before);
    assert.deepEqual(fs.readFileSync(f.store.file), bytes);
    f.store.installSubagentRuns();
    assert.equal(receiptIndexInstalled(f.store.db), true);
    const installed = durableSnapshot(f.store.db), installedBytes = fs.readFileSync(f.store.file);
    f.store.installSubagentRuns();
    assert.deepEqual(durableSnapshot(f.store.db), installed);
    assert.deepEqual(fs.readFileSync(f.store.file), installedBytes);
    for (const [table, rows] of Object.entries(before.data)) assert.deepEqual(installed.data[table], rows);
    assert.equal(f.store.db.prepare('PRAGMA user_version').get()!.user_version, 2);

    // Real setup lifecycle preflight on an owned, synthetic installation.
    const targets = { configRoot: f.source.configRoot, dataRoot: f.source.dataRoot, storeRoot: `${f.root}/setup-store`, confirmed: true };
    lifecycle('install', targets, { plugin: 'export default { setup: async () => {} };', guidance: 'Synthetic guidance.', removal: '// synthetic', version: '1.3.0' });
    const file = `${targets.storeRoot}/progress.sqlite`, setupStore = new Store(file);
    try {
      for (const indexed of [true, false]) {
        if (!indexed) setupStore.db.exec(`DROP INDEX ${indexName}`);
        const snapshot = fs.readFileSync(file);
        assert.equal(lifecycle('inspect', targets).installed, true);
        assert.equal(migrationBinding(targets).database, file);
        assert.deepEqual(fs.readFileSync(file), snapshot);
      }
    } finally { setupStore.close(); }
  } finally { f.cleanup(); }
});

test('owned name collisions refuse without repair on open and activation', () => {
  const definitions = [
    `CREATE TABLE ${indexName}(source TEXT, oid TEXT)`,
    `CREATE VIEW ${indexName} AS SELECT source,oid FROM receipts`,
    `CREATE TRIGGER ${indexName} AFTER INSERT ON receipts BEGIN SELECT 1; END`,
    `CREATE INDEX ${indexName} ON sessions(source,id)`,
    `CREATE INDEX ${indexName} ON receipts(oid,source)`,
    `CREATE UNIQUE INDEX ${indexName} ON receipts(source,oid)`,
    `CREATE INDEX ${indexName} ON receipts(source,oid) WHERE oid!='excluded'`,
    `CREATE INDEX ${indexName} ON receipts(source,lower(oid))`,
    `CREATE INDEX ${indexName} ON receipts(source,oid,plan)`,
    `CREATE INDEX ${indexName} ON receipts(source,oid COLLATE NOCASE)`,
    `CREATE INDEX ${indexName} ON receipts(source,oid DESC)`,
    `CREATE INDEX RECEIPTS_SOURCE_OID ON receipts(source,oid)`,
  ];
  for (const ddl of definitions) {
    const f = productionFixture();
    try {
      f.store.db.exec(`DROP INDEX ${indexName}; ${ddl}`);
      const before = durableSnapshot(f.store.db), bytes = fs.readFileSync(f.store.file);
      for (const readOnly of [false, true]) assert.throws(() => new Store(f.store.file, { readOnly }), { code: 'schema' }, ddl);
      assert.throws(() => f.store.installSubagentRuns(), { code: 'schema' }, ddl);
      assert.deepEqual(durableSnapshot(f.store.db), before);
      assert.deepEqual(fs.readFileSync(f.store.file), bytes);
    } finally { f.cleanup(); }
  }
});

test('semantically identical owned index is accepted without recreation', () => {
  const f = productionFixture();
  try {
    f.store.db.exec(`DROP INDEX ${indexName}; CREATE INDEX "${indexName}" ON "receipts" ("source" ASC, "oid" COLLATE BINARY ASC)`);
    const sql = f.store.db.prepare('SELECT sql FROM sqlite_master WHERE name=?').get(indexName)!.sql;
    f.store.installSubagentRuns();
    assert.equal(f.store.db.prepare('SELECT sql FROM sqlite_master WHERE name=?').get(indexName)!.sql, sql);
  } finally { f.cleanup(); }
});

test('run and cleanup prefix gates still reject unknown indexes and objects', () => {
  const f = productionFixture();
  try {
    f.store.installSubagentRuns();
    f.store.apply({ op: 'start', plan: 'closed', oid: 'start', rev: 0, title: 'Closed', items: [{ id: 'a', title: 'Task', kind: 'task', status: 'done' }] }, f.actor);
    f.store.apply({ op: 'finish', plan: 'closed', oid: 'finish', rev: 1, outcome: 'finished' }, f.actor);
    f.store.cleanup('archive', { storeId: f.store.list().storeId, source: f.source.id, plan: 'closed', rev: 2, cleanupRev: 0, oid: 'archive' });
    assert.equal(cleanupInstalled(f.store.db), true);
    for (const prefix of ['runs', 'cleanup']) for (const kind of ['INDEX', 'TABLE']) {
      const name = `${prefix}_foreign`;
      f.store.db.exec(`CREATE ${kind} ${name}${kind === 'INDEX' ? ' ON receipts(source)' : '(value TEXT)'}`);
      const before = durableSnapshot(f.store.db);
      assert.throws(() => prefix === 'runs' ? f.store.subagentRunStorage() : cleanupInstalled(f.store.db), { code: 'schema' });
      assert.deepEqual(durableSnapshot(f.store.db), before);
      f.store.db.exec(`DROP ${kind} ${name}`);
    }
    // The index must also roll back if the same activation rejects the run schema.
    f.store.db.exec(`DROP INDEX ${indexName}; CREATE TABLE runs_foreign(value TEXT)`);
    const before = durableSnapshot(f.store.db);
    assert.throws(() => f.store.installSubagentRuns(), { code: 'schema' });
    assert.deepEqual(durableSnapshot(f.store.db), before);
  } finally { f.cleanup(); }
});

function message(child: ChildProcess) { return once(child, 'message', { signal: AbortSignal.timeout(10000) }).then(([value]) => value as { phase: string; code?: string }); }
function worker(file: string, mode: string) { return fork(new URL('./receipt-index-worker.ts', import.meta.url), [file, mode], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] }); }
async function kill(child: ChildProcess) {
  if (child.exitCode === null && child.signalCode === null) { const exit = once(child, 'exit'); child.kill('SIGKILL'); await exit; }
}

test('concurrent opens and activations serialize the missing-index check with installation', { timeout: 15000 }, async () => {
  const f = productionFixture(), children: ChildProcess[] = [];
  try {
    f.store.db.exec(`DROP INDEX ${indexName}`);
    for (let i = 0; i < 2; i++) children.push(worker(f.store.file, 'activate'));
    await Promise.all(children.map(child => message(child).then(reply => assert.equal(reply.phase, 'ready'))));
    const replies = children.map(message), exits = children.map(child => once(child, 'exit'));
    for (const child of children) child.send('go');
    for (const reply of await Promise.all(replies)) assert.equal(reply.phase, 'committed');
    await Promise.all(exits);
    assert.equal(receiptIndexInstalled(f.store.db), true);
    assert.equal(f.store.subagentRunStorage(), 'current');
    assert.equal(f.store.db.prepare('PRAGMA integrity_check').get()!.integrity_check, 'ok');
  } finally { await Promise.all(children.map(kill)); f.cleanup(); }
});

test('killed uncommitted index installation rolls back; busy refuses and reactivation recovers', { timeout: 15000 }, async () => {
  const f = productionFixture(); let child: ChildProcess | undefined;
  try {
    f.store.db.exec(`DROP INDEX ${indexName}`);
    const before = durableSnapshot(f.store.db);
    const contender = new Store(f.store.file, { busyMs: 25 });
    try {
      child = worker(f.store.file, 'interrupt'); assert.equal((await message(child)).phase, 'ready');
      const pending = message(child); child.send('go'); assert.equal((await pending).phase, 'index-uncommitted');
      assert.throws(() => contender.installSubagentRuns(), { code: 'busy' });
      await kill(child); child = undefined;
      assert.deepEqual(durableSnapshot(contender.db), before);
      contender.installSubagentRuns();
      assert.equal(receiptIndexInstalled(contender.db), true);
      assert.equal(contender.db.prepare('PRAGMA integrity_check').get()!.integrity_check, 'ok');
      assert.deepEqual(contender.db.prepare('PRAGMA foreign_key_check').all(), []);
    } finally { contender.close(); }
  } finally { if (child) await kill(child); f.cleanup(); }
});

test('real SQLite page-capacity failure during index creation preserves legacy data', () => {
  const f = productionFixture();
  try {
    f.store.db.exec(`DROP INDEX ${indexName}; VACUUM`);
    f.store.db.prepare(`WITH RECURSIVE n(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<1000)
      INSERT INTO receipts SELECT ?, 'plan-'||i, 'operation-'||i, 'synthetic', '{}' FROM n`).run(f.source.id);
    const before = durableSnapshot(f.store.db);
    const pages = f.store.db.prepare('PRAGMA page_count').get()!.page_count;
    f.store.db.exec(`PRAGMA max_page_count=${pages}`);
    assert.throws(() => f.store.installSubagentRuns(), { code: 'storage' });
    assert.deepEqual(durableSnapshot(f.store.db), before);
    f.store.db.exec('PRAGMA max_page_count=1073741823');
    f.store.installSubagentRuns();
    assert.equal(receiptIndexInstalled(f.store.db), true);
    assert.deepEqual(durableSnapshot(f.store.db).data.receipts, before.data.receipts);
  } finally { f.cleanup(); }
});

async function releasedStore(root: string, revision = 'refs/tags/v1.3.0'): Promise<typeof Store> {
  const names = execFileSync('git', ['ls-tree', '-r', '--name-only', revision, 'shared'], { encoding: 'utf8', timeout: 15000 }).trim().split('\n');
  for (const name of names) {
    const file = path.join(root, name); fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, execFileSync('git', ['show', `${revision}:${name}`], { timeout: 15000 }), { mode: 0o600 });
  }
  return (await import(pathToFileURL(path.join(root, 'shared/store.ts')).href)).Store;
}

test('unmodified 1.3.0 creation, writer, combined handoff, reader and cleanup survive upgrade/downgrade/reactivation', async () => {
  const f = productionFixture();
  try {
    const OldStore = await releasedStore(`${f.root}/released`);
    const file = `${f.root}/store/released.sqlite`, old = new OldStore(file, { create: true });
    try {
      old.registerSource(f.source); old.bindReads(f.source.id, true); old.installSubagentRuns();
      assert.equal(receiptIndexInstalled(old.db), false);
      old.apply({ op: 'start', plan: 'plan', oid: 'start', rev: 0, title: 'Synthetic plan', items: [{ id: 'task', title: 'Task', kind: 'task' }] }, f.actor);
      old.apply({ op: 'link', plan: 'plan', oid: 'assign', rev: 1, child: f.child.sessionId, assign: ['task'] }, f.actor, undefined, f.child);
      const before = durableSnapshot(old.db);
      const current = new Store(file);
      try { current.installSubagentRuns(); assert.equal(receiptIndexInstalled(current.db), true); }
      finally { current.close(); }
      assert.deepEqual(durableSnapshot(old.db).data, before.data, 'upgrade does not rewrite durable facts');
      // Already-open 1.3.0 connection writes the combined receipt after migration.
      const report = { op: 'handoff', oid: 'combined', summary: 'Synthetic result', outcome: 'done', taskUpdate: { plan: 'plan', rev: 2, changes: [{ id: 'task', status: 'done' }] } };
      const reply = old.handoff(report, f.child, 1000);
      assert.equal(reply.taskReceipt.rev, 3);
      assert.equal(old.db.prepare(`${lookup.replace('FROM receipts', `FROM receipts INDEXED BY ${indexName}`)}`).get(f.source.id, 'combined', f.child.sessionId)!.plan, 'plan');
      old.close();
      const rollback = new OldStore(file); rollback.bindReads(f.source.id, true);
      try {
        rollback.installSubagentRuns(); assert.equal(rollback.subagentRunStorage(), 'current');
        assert.deepEqual(rollback.handoff(report, f.child, 2000), reply);
        rollback.apply({ op: 'link', plan: 'plan', oid: 'unlink', rev: 3, child: f.child.sessionId, assign: [] }, f.actor, undefined, f.child);
        const { taskUpdate: _, ...bare } = report;
        assert.throws(() => rollback.handoff(bare, f.child, 2100), { code: 'operation-reused' });
        rollback.apply({ op: 'finish', plan: 'plan', oid: 'finish', rev: 4, outcome: 'finished' }, f.actor);
        const request = { storeId: rollback.list().storeId, source: f.source.id, plan: 'plan', rev: 5, cleanupRev: 0, oid: 'archive' };
        rollback.cleanup('archive', request);
        rollback.cleanup('restore', { ...request, cleanupRev: 1, oid: 'restore' });
        rollback.cleanup('delete', { ...request, cleanupRev: 2, oid: 'delete', confirmed: true });
        assert.equal(rollback.db.prepare(`SELECT count(*) n FROM receipts INDEXED BY ${indexName} WHERE source=? AND oid=?`).get(f.source.id, 'combined')!.n, 0);
        assert.equal(receiptIndexInstalled(rollback.db), true);
      } finally { rollback.close(); }
      const reader = new OldStore(file, { readOnly: true });
      try { assert.equal(reader.list().schemaVersion, 2); assert.equal(reader.get(f.source.id, 'plan'), undefined); }
      finally { reader.close(); }
      const upgraded = new Store(file);
      try {
        const before = durableSnapshot(upgraded.db); upgraded.installSubagentRuns();
        assert.deepEqual(durableSnapshot(upgraded.db), before);
        assert.equal(cleanupInstalled(upgraded.db), true);
        assert.equal(upgraded.db.prepare('PRAGMA integrity_check').get()!.integrity_check, 'ok');
      } finally { upgraded.close(); }
    } finally { try { old.close(); } catch { /* closed for downgrade */ } }
  } finally { f.cleanup(); }
});

test('combined then unlink then bare replay still refuses on indexed Store', async () => fixture(async f => {
  assert.equal(receiptIndexInstalled(f.store.db), true);
  f.store.apply({ op: 'link', plan: 'plan-alpha', oid: 'assign', rev: 1, child: 'C1', assign: ['task-1'] }, f.actor(), undefined, f.actor('C1'));
  const report = { op: 'handoff', oid: 'combined', summary: 'Synthetic result', outcome: 'partial', taskUpdate: { plan: 'plan-alpha', rev: 2, changes: [{ id: 'task-1', status: 'done' }] } };
  const receipt = f.store.handoff(report, f.actor('C1'), 1000);
  f.store.apply({ op: 'link', plan: 'plan-alpha', oid: 'unlink', rev: 3, child: 'C1', assign: [] }, f.actor(), undefined, f.actor('C1'));
  const before = durableSnapshot(f.store.db), { taskUpdate: _, ...bare } = report;
  assert.throws(() => f.store.handoff(bare, f.actor('C1'), 2000), { code: 'operation-reused' });
  assert.deepEqual(durableSnapshot(f.store.db), before);
  assert.deepEqual(f.store.handoff(report, f.actor('C1'), 2100), receipt);
}));

test('1k and 50k histories bound indexed candidates and preserve results; timings are diagnostic only', () => {
  const comparison: unknown[] = [];
  for (const history of [1000, 50000]) {
    const f = productionFixture();
    try {
      f.store.bindReads(f.source.id, true); f.store.installSubagentRuns();
      f.store.apply({ op: 'start', plan: 'timing', oid: 'start', rev: 0, title: 'Synthetic', items: [{ id: 'task', title: 'Task', kind: 'task' }] }, f.actor);
      f.store.apply({ op: 'link', plan: 'timing', oid: 'link', rev: 1, child: f.child.sessionId, assign: ['task'] }, f.actor, undefined, f.child);
      f.store.db.exec(`DROP INDEX ${indexName}`);
      f.store.db.prepare(`WITH RECURSIVE n(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<?)
        INSERT INTO receipts SELECT ?, 'history-'||i, 'operation-'||i, 'synthetic', '{}' FROM n`).run(history, f.source.id);
      // Reused operation IDs across plans/children are legitimate. Child filtering
      // remains essential; neither a matching operation alone nor absence in a
      // different source may choose a receipt.
      for (let i = 0; i < 3; i++) f.store.db.prepare('INSERT INTO receipts VALUES(?,?,?,?,?)').run(f.source.id, `reused-${i}`, 'reused', 'synthetic', JSON.stringify({ _handoffChild: `child-${i}`, result: i }));
      f.store.registerSource({ ...f.source, id: 'other-source', configRoot: '/synthetic/other-config', dataRoot: '/synthetic/other-data' });
      f.store.db.prepare('INSERT INTO receipts VALUES(?,?,?,?,?)').run('other-source', 'other-plan', 'reused', 'synthetic', JSON.stringify({ _handoffChild: 'other-child' }));
      const args: [string, string, string][] = [[f.source.id, 'reused', 'child-2'], [f.source.id, 'reused', 'missing-child'], [f.source.id, 'absent', 'child-2'], [f.source.id, 'reused', 'other-child']];
      const report = { op: 'handoff', oid: 'timed-handoff', summary: 'Synthetic result', outcome: 'partial' };
      // Observe the production call site so this regression cannot silently keep
      // testing an obsolete copy of the SQL when handoff changes.
      const prepare = f.store.db.prepare.bind(f.store.db); let observed = '';
      f.store.db.prepare = sql => { if (sql.includes('FROM receipts WHERE source=? AND oid=?')) observed = sql; return prepare(sql); };
      const claim = f.store.handoff(report, f.child, 1000);
      f.store.db.prepare = prepare; assert.equal(observed, lookup);
      const sample = () => {
        const statement = f.store.db.prepare(lookup), plans = args.map(a => f.store.db.prepare(`EXPLAIN QUERY PLAN ${lookup}`).all(...a).map(r => r.detail));
        const start = performance.now();
        for (let i = 0; i < 100; i++) for (const a of args) statement.get(...a);
        const lookupMs = performance.now() - start, writeStart = performance.now();
        for (let i = 0; i < 20; i++) assert.deepEqual(f.store.handoff(report, f.child, 2000 + i), claim);
        const handoffTransactionMs = performance.now() - writeStart;
        // Synthetic rolled-back receipt batch isolates index-maintenance cost
        // without changing the history compared by the before/after assertions.
        const insert = f.store.db.prepare('INSERT INTO receipts VALUES(?,?,?,?,?)'), insertStart = performance.now();
        f.store.db.exec('BEGIN IMMEDIATE');
        try { for (let i = 0; i < 100; i++) insert.run(f.source.id, 'write-cost', `write-${i}`, 'synthetic', '{}'); }
        finally { f.store.db.exec('ROLLBACK'); }
        return { plans, lookupMs, handoffTransactionMs, receiptWriteRollbackMs: performance.now() - insertStart, results: args.map(a => statement.get(...a)) };
      };
      const before = sample(), snapshot = durableSnapshot(f.store.db), pageSize = Number(f.store.db.prepare('PRAGMA page_size').get()!.page_size);
      const pagesBefore = Number(f.store.db.prepare('PRAGMA page_count').get()!.page_count);
      const freeBefore = Number(f.store.db.prepare('PRAGMA freelist_count').get()!.freelist_count);
      const buildStart = performance.now(); f.store.installSubagentRuns(); const buildMs = performance.now() - buildStart;
      const pagesAfter = Number(f.store.db.prepare('PRAGMA page_count').get()!.page_count), after = sample();
      const freeAfter = Number(f.store.db.prepare('PRAGMA freelist_count').get()!.freelist_count);
      assert.deepEqual(after.results, before.results);
      assert.equal(after.results[0]!.plan, 'reused-2'); assert.deepEqual(after.results.slice(1), [undefined, undefined, undefined]);
      assert.deepEqual(durableSnapshot(f.store.db).data, snapshot.data);
      for (const plan of after.plans) assert.match(plan.join('\n'), /SEARCH receipts USING INDEX receipts_source_oid \(source=\? AND oid=\?\)/);
      for (const plan of before.plans) assert.match(plan.join('\n'), /sqlite_autoindex_receipts_1 \(source=\?\)/);

      // Structural work bound, not a wall-clock claim: EQP proves a two-key B-tree
      // range search; that range has only 3 candidates at BOTH history sizes.
      // Count actual residual child evaluations on the unchanged lookup as well.
      const probe = new DatabaseSync(f.store.file, { readOnly: true });
      const evaluated: number[] = [], candidates: number[] = [];
      try {
        let calls = 0;
        probe.function('json_extract', { deterministic: true }, (json, field) => {
          assert.equal(field, '$._handoffChild'); calls++;
          return JSON.parse(String(json))._handoffChild ?? null;
        });
        for (const a of args) {
          candidates.push(Number(probe.prepare('SELECT count(*) AS n FROM receipts WHERE source=? AND oid=?').get(a[0], a[1])!.n));
          calls = 0; assert.deepEqual(probe.prepare(lookup).get(...a), f.store.db.prepare(lookup).get(...a)); evaluated.push(calls);
        }
      } finally { probe.close(); }
      assert.deepEqual(candidates, [3, 3, 0, 3]);
      assert.ok(evaluated.every((count, i) => count <= candidates[i]!));
      assert.equal(evaluated[1], 3, 'a missing child examines only this operation range, not source history');
      comparison.push({ history, sqlite: f.store.db.prepare('SELECT sqlite_version() AS version').get()!.version, queries: 400, handoffTransactions: 20,
        before: { plans: before.plans, lookupMs: before.lookupMs, handoffTransactionMs: before.handoffTransactionMs, receiptWriteRollbackMs: before.receiptWriteRollbackMs },
        after: { plans: after.plans, lookupMs: after.lookupMs, handoffTransactionMs: after.handoffTransactionMs, receiptWriteRollbackMs: after.receiptWriteRollbackMs },
        buildMs, allocatedBytes: (pagesAfter - pagesBefore) * pageSize, indexBytes: (pagesAfter - freeAfter - pagesBefore + freeBefore) * pageSize, candidates, childPredicateEvaluations: evaluated });
    } finally { f.cleanup(); }
  }
  if (process.env.RECEIPT_INDEX_EVIDENCE) {
    fs.mkdirSync(process.env.RECEIPT_INDEX_EVIDENCE, { recursive: true });
    fs.writeFileSync(path.join(process.env.RECEIPT_INDEX_EVIDENCE, 'comparison.json'), JSON.stringify({ node: process.version, comparison }, null, 2) + '\n');
  }
});
