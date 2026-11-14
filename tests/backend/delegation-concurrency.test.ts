import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './subagent-test-support.ts';
import { Store } from '../../shared/store.ts';
import { activeIntent } from '../../shared/subagent-runs.ts';
import { delegationRevision, DELEGATION_PROOF_LIMITS } from '../../shared/delegation-validation.ts';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const key = { source: 'source-alpha', parent: 'A', message: 'message-a', call: 'call-a' };
const second = { ...key, message: 'message-b', call: 'call-b' };

test('a sibling child report between declaration and dispatch preserves the second assignment', async () => {
  await fixture(async f => {
    f.declare(f.request({ oid: 'declare-a', assign: ['task-1'] }));
    f.store.beforeRun(key, f.actor(), 'subagent', {}, 1000);
    f.store.afterRun(key, 0, f.actor('C1'), 'returned');
    const request = f.request({ oid: 'declare-b', assign: ['task-2'] });
    f.declare(request);
    f.store.apply({ op: 'change', plan: request.plan, oid: 'child-a-working', rev: 2,
      changes: [{ id: 'task-1', status: 'working' }] }, f.actor('C1'));
    f.store.beforeRun(second, f.actor(), 'subagent', {}, 2000);
    f.store.afterRun(second, 0, f.actor('C2'), 'returned');
    assert.equal(f.declare(request).delegation.state, 'bound');
    assert.equal(f.plan().items.find(i => i.id === 'task-2')!.assigneeSessionId, 'C2');
    assert.equal(f.plan().revision, 4);
  });
});

for (const order of ['report-first', 'bind-first', 'report-after-reservation'] as const)
test(`independent Store writers preserve both serialization orders: ${order}`, async () => {
  await fixture(async f => {
    f.declare(f.request({ oid: 'declare-a' }));
    f.store.beforeRun(key, f.actor(), 'subagent', {}, 1000);
    f.store.afterRun(key, 0, f.actor('C1'), 'returned');
    const request = f.request({ oid: 'declare-b', assign: ['task-2'] });
    f.declare(request);
    const writer = new Store(f.store.file);
    writer.bindReads(f.source.id, true);
    const report = (rev: number) => writer.apply({ op: 'change', plan: request.plan, oid: 'child-working', rev,
      changes: [{ id: 'task-1', status: 'working' }] }, f.actor('C1'));
    try {
      if (order === 'report-first') report(2);
      f.store.beforeRun(second, f.actor(), 'subagent', {}, 2000);
      if (order === 'report-after-reservation') report(2);
      const before = f.plan();
      f.store.afterRun(second, 0, f.actor('C2'), 'returned');
      assert.equal(f.plan().reportedAt, before.reportedAt);
      assert.deepEqual(f.plan().items.map(i => [i.id, i.status, i.reporterSessionId]), before.items.map(i => [i.id, i.status, i.reporterSessionId]));
      if (order === 'bind-first') {
        assert.throws(() => report(2), /conflict/); // Ordinary reports still require exact revisions.
        report(3);
      }
      assert.equal(f.declare(request).delegation.state, 'bound');
      assert.equal(f.plan().revision, 4);
      writer.apply({ op: 'change', plan: request.plan, oid: 'second-child-working', rev: 4,
        changes: [{ id: 'task-2', status: 'working' }] }, f.actor('C2'));
      assert.throws(() => writer.apply({ op: 'change', plan: request.plan, oid: 'cross-task', rev: 5,
        changes: [{ id: 'task-1', status: 'done' }] }, f.actor('C2')), /assignment/);
    } finally { writer.close(); }
  });
});

for (const touch of ['status', 'same-status', 'restored', 'blocker', 'structure', 'title', 'close-reopen', 'assignment', 'assignment-restored'] as const)
test(`target or structural changes refuse without partial binding: ${touch}`, async () => {
  await fixture(async f => {
    if (touch === 'blocker') f.store.apply({ op: 'change', plan: 'plan-alpha', oid: 'initial-blocker', rev: 1,
      changes: [{ id: 'task-1', status: 'blocked', blocker: { reason: 'Initial decision' } }] }, f.actor());
    const request = f.request(); f.declare(request);
    f.store.beforeRun(key, f.actor(), 'subagent', {}, 1000);
    const write = (input: object) => f.store.apply({ plan: request.plan, oid: `write-${f.plan().revision}`, rev: f.plan().revision, ...input }, f.actor(), undefined, f.actor('C2'));
    if (touch === 'structure') write({ op: 'revise', items: f.plan().items.map(({ id, title, kind }) => ({ id, title, kind })) });
    else if (touch === 'title') write({ op: 'revise', title: 'New title' });
    else if (touch === 'close-reopen') { write({ op: 'finish', outcome: 'cancelled' }); write({ op: 'revise', title: 'Synthetic plan', reopen: true }); }
    else if (touch.startsWith('assignment')) {
      write({ op: 'link', child: 'C2', assign: ['task-1'] });
      if (touch === 'assignment-restored') write({ op: 'link', child: 'C2', assign: [] });
    } else {
      write({ op: 'change', changes: [{ id: 'task-1', status: touch === 'same-status' ? 'pending' : touch === 'blocker' ? 'blocked' : 'working',
        ...(touch === 'blocker' ? { blocker: { reason: 'Changed decision' } } : {}) }] });
      if (touch === 'restored') write({ op: 'change', changes: [{ id: 'task-1', status: 'pending' }] });
    }
    const before = f.plan(), counts = f.store.db.prepare('SELECT (SELECT count(*) FROM revisions) revisions,(SELECT count(*) FROM contributions) contributions,(SELECT count(*) FROM receipts) receipts').get();
    f.store.afterRun(key, 0, f.actor('C1'), 'returned');
    assert.equal(f.declare(request).delegation.state, 'retired');
    assert.deepEqual(f.plan(), before);
    assert.deepEqual(f.store.db.prepare('SELECT (SELECT count(*) FROM revisions) revisions,(SELECT count(*) FROM contributions) contributions,(SELECT count(*) FROM receipts) receipts').get(), counts);
    assert.throws(() => f.store.apply({ op: 'change', plan: request.plan, oid: 'unbound-report', rev: before.revision,
      changes: [{ id: 'task-1', status: 'working' }] }, f.actor('C1')), /assignment/);
    f.store.beforeRun(second, f.actor(), 'subagent', {}, 2000);
    f.store.afterRun(second, 0, f.actor('C1'), 'returned');
    assert.deepEqual(f.plan(), before); // Refusal never transfers intent.
  });
});

test('mechanical blocker validity rollover is neutral, read proof is read-only, and exact retry never rearms', async () => {
  await fixture(async f => {
    f.store.apply({ op: 'change', plan: 'plan-alpha', oid: 'block-target', rev: 1,
      changes: [{ id: 'task-1', status: 'blocked', blocker: { category: 'review', reason: 'Review output' } }] }, f.actor());
    const request = f.request(), first = f.declare(request);
    assert.deepEqual(f.declare(request), first);
    assert.throws(() => f.declare({ ...request, assign: ['task-2'] }), /operation-reused/);
    assert.throws(() => f.declare({ ...request, oid: 'second-declaration' }), /conflict/);
    f.store.apply({ op: 'change', plan: request.plan, oid: 'sibling-blocker', rev: 2,
      changes: [{ id: 'task-2', status: 'blocked', blocker: { reason: 'Other decision' } }] }, f.actor());
    const before = f.store.db.prepare('SELECT payload FROM runs_intents').get();
    const reader = new Store(f.store.file, { readOnly: true });
    try {
      reader.db.exec('BEGIN');
      assert.equal(delegationRevision(reader.db, { sourceId: f.source.id, verified: true }, activeIntent(reader.db, f.source.id, 'A')!), 3);
      reader.db.exec('COMMIT');
    } finally { reader.close(); }
    assert.deepEqual(f.store.db.prepare('SELECT payload FROM runs_intents').get(), before);
    await f.reload();
    f.store.beforeRun(key, f.actor(), 'subagent', {}, 1000);
    f.store.afterRun(key, 0, f.actor('C1'), 'returned');
    const bound = f.declare(request);
    assert.equal(bound.rev, 2); assert.equal(bound.delegation.receipt.rev, 4);
    assert.equal(f.plan().items[0]!.blocker!.reportedRevision, 2);
    assert.equal(f.plan().items[0]!.blocker!.validAtRevision, 4);
    await f.reload();
    assert.deepEqual(f.declare(request), bound);
    f.store.beforeRun(second, f.actor(), 'subagent', {}, 2000);
    f.store.afterRun(second, 0, f.actor('C2'), 'returned');
    assert.equal(f.plan().revision, 4);
  });
});

for (const reserved of [false, true]) test(`cancel ${reserved ? 'reserved' : 'pending'} intent after unrelated report`, async () => {
  await fixture(async f => {
    const request = f.request(); f.declare(request);
    if (reserved) f.store.beforeRun(key, f.actor(), 'subagent', {}, 1000);
    f.store.apply({ op: 'change', plan: request.plan, oid: 'sibling', rev: 1, changes: [{ id: 'task-2', status: 'working' }] }, f.actor());
    f.declare(f.request({ oid: 'cancel', assign: [] }));
    if (!reserved) f.store.beforeRun(key, f.actor(), 'subagent', {}, 1000);
    f.store.afterRun(key, 0, f.actor('C1'), 'returned');
    assert.equal(f.declare(request).delegation.reason, 'cancelled');
    assert.equal(f.plan().revision, 2); assert.equal(f.plan().links.length, 0);
    f.declare(f.request({ oid: 'fresh' }));
    f.store.beforeRun(second, f.actor(), 'subagent', {}, 2000);
    f.store.afterRun(second, 0, f.actor('C2'), 'returned');
    assert.equal(f.plan().items[0]!.assigneeSessionId, 'C2');
  });
});

for (const fault of ['missing-snapshot', 'missing-contribution', 'corrupt-contribution', 'corrupt-snapshot', 'live-mismatch', 'bytes', 'revisions'] as const)
test(`incomplete historical proof refuses: ${fault}`, async () => {
  await fixture(async f => {
    const request = f.request(); f.declare(request);
    const count = fault === 'revisions' ? DELEGATION_PROOF_LIMITS.snapshots : 2;
    for (let n = 0; n < count; n++) f.store.apply({ op: 'change', plan: request.plan, oid: `sibling-${n}`, rev: n + 1,
      changes: [{ id: 'task-2', status: 'working' }] }, f.actor());
    // Labelled fault injection: no production writer is bypassed except to damage proof.
    if (fault === 'missing-snapshot') { f.store.db.exec('PRAGMA foreign_keys=OFF'); f.store.db.exec('DELETE FROM revisions WHERE revision=2'); f.store.db.exec('PRAGMA foreign_keys=ON'); }
    if (fault === 'missing-contribution') f.store.db.exec('DELETE FROM contributions WHERE revision=2');
    if (fault === 'corrupt-contribution') f.store.db.exec("UPDATE contributions SET payload=json_set(payload,'$.itemIds',json('null')) WHERE revision=2");
    if (fault === 'corrupt-snapshot') f.store.db.exec("UPDATE revisions SET snapshot=json_set(snapshot,'$.sourceId','foreign') WHERE revision=2");
    if (fault === 'live-mismatch') f.store.db.exec("UPDATE revisions SET snapshot=json_set(snapshot,'$.items[1].status','done') WHERE revision=3");
    if (fault === 'bytes') f.store.db.prepare("UPDATE revisions SET snapshot=json_set(snapshot,'$.padding',?) WHERE revision=2").run('x'.repeat(DELEGATION_PROOF_LIMITS.bytes));
    const before = f.plan();
    f.store.beforeRun(key, f.actor(), 'subagent', {}, 1000);
    f.store.afterRun(key, 0, f.actor('C1'), 'returned');
    assert.equal(f.declare(request).delegation.reason, 'conflict');
    assert.deepEqual(f.plan(), before);
  });
});

for (const invalid of ['ancestry', 'source', 'capture', 'other-plan', 'other-task'] as const)
test(`narrow proof never expands authority: ${invalid}`, async () => {
  await fixture(async f => {
    const request = f.request(); f.declare(request);
    f.store.apply({ op: 'change', plan: request.plan, oid: 'sibling', rev: 1, changes: [{ id: 'task-2', status: 'working' }] }, f.actor());
    f.store.beforeRun(key, f.actor(), 'subagent', {}, 1000);
    if (invalid === 'capture') { f.store.setEnabled(false); f.store.setEnabled(true); }
    if (invalid === 'other-plan') {
      f.seed('plan-beta');
      // Corrupt the intent's target while retaining the original declaration receipt.
      f.store.db.exec("UPDATE runs_intents SET payload=json_set(payload,'$.request.plan','plan-beta')");
    }
    if (invalid === 'other-task') f.store.db.exec("UPDATE runs_intents SET payload=json_set(payload,'$.request.assign',json('[\"task-2\"]'))");
    const child = { ...f.actor('C1'), ...(invalid === 'ancestry' ? { ancestry: null } : {}), ...(invalid === 'source' ? { sourceId: 'foreign' } : {}) };
    if (invalid === 'ancestry' || invalid === 'source') {
      assert.throws(() => f.store.afterRun(key, 0, child, 'returned'), /binding/);
      f.store.afterRun(key, 0, undefined, 'unconfirmed');
    } else f.store.afterRun(key, 0, child, 'returned');
    assert.equal(f.plan().links.length, 0); assert.equal(f.plan().revision, 2);
    if (invalid === 'other-plan') assert.equal(f.store.get(f.source.id, 'plan-beta')!.links.length, 0);
  });
});

test('empty contribution scope is insufficient proof even when endpoints look unchanged', async () => {
  await fixture(async f => {
    const request = f.request(); f.declare(request);
    // A no-op link still has no historical authored task scope. Do not infer
    // that it was a disjoint task report from equal endpoint task values.
    f.store.apply({ op: 'link', plan: request.plan, oid: 'neutral-link', rev: 1, child: 'C2', assign: [] }, f.actor(), undefined, f.actor('C2'));
    f.store.beforeRun(key, f.actor(), 'subagent', {}, 1000);
    f.store.afterRun(key, 0, f.actor('C1'), 'returned');
    assert.equal(f.declare(request).delegation.reason, 'conflict');
    assert.equal(f.plan().revision, 2); assert.equal(f.plan().links.length, 0);
  });
});

test('unmodified released writers and intents use retained evidence, never endpoint-only restoration', async () => {
  await fixture(async f => {
    const base = 'refs/tags/v1.3.0', root = path.join(path.dirname(f.store.file), 'released');
    const names = execFileSync('git', ['ls-tree', '-r', '--name-only', base, 'shared'], { encoding: 'utf8', timeout: 15000 }).trim().split('\n');
    for (const name of names) {
      const file = path.join(root, name); fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
      const bytes = execFileSync('git', ['show', `${base}:${name}`], { timeout: 15000 }); fs.writeFileSync(file, bytes);
      assert.deepEqual(fs.readFileSync(file), bytes);
    }
    const { Store: OldStore } = await import(pathToFileURL(path.join(root, 'shared/store.ts')).href);
    const old = new OldStore(f.store.file); old.bindReads(f.source.id, true);
    try {
      const request = f.request(); old.declareDelegation(request, f.actor());
      old.apply({ op: 'change', plan: request.plan, oid: 'old-sibling', rev: 1, changes: [{ id: 'task-2', status: 'working' }] }, f.actor());
      f.store.beforeRun(key, f.actor(), 'subagent', {}, 1000);
      f.store.afterRun(key, 0, f.actor('C1'), 'returned');
      assert.equal(old.declareDelegation(request, f.actor()).delegation.state, 'bound');
      const next = f.request({ oid: 'next', assign: ['task-2'] }); f.declare(next);
      old.apply({ op: 'change', plan: next.plan, oid: 'old-target', rev: 3, changes: [{ id: 'task-2', status: 'done' }] }, f.actor());
      old.apply({ op: 'change', plan: next.plan, oid: 'old-restore', rev: 4, changes: [{ id: 'task-2', status: 'working' }] }, f.actor());
      f.store.beforeRun(second, f.actor(), 'subagent', {}, 2000);
      f.store.afterRun(second, 0, f.actor('C2'), 'returned');
      assert.equal(f.declare(next).delegation.reason, 'conflict');
      assert.equal(f.plan().revision, 5);
    } finally { old.close(); }
  });
});
