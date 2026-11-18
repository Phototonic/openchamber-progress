import test from 'node:test';
import assert from 'node:assert/strict';
import { launchCleanupService } from '../fixtures/cleanup-service.ts';
import { readList, readCleanupListPage, cleanupKnownReader, cleanupSearchReader, cleanupCall, type ServiceHost } from '../../ui/shared/source.ts';
import { CleanupScan, runTidy, tidyConfirmation, tidyCopy, TIDY_LIMIT } from '../../ui/shared/cleanup.ts';

test('Tidy archives all closed outcomes; Undo restores precisely its receipts without changing history', async () => {
  const f = await launchCleanupService(false);
  try {
    const paths: string[] = [];
    let inflight = 0, maxInflight = 0;
    const host: ServiceHost = { serviceRequest: async q => {
      inflight++; maxInflight = Math.max(maxInflight, inflight); paths.push(q.path);
      try {
        const r = await f.request(q.path + (q.query ? '?' + new URLSearchParams(q.query) : ''), q.body ? JSON.parse(q.body) : undefined);
        return { status: r.status, body: await r.text() };
      } finally { inflight--; }
    } };
    const listed = await readList(host, { archived: 'exclude' });
    assert.ok(listed.ok && listed.read);
    const before = new Map(listed.read.plans.map(p => [p.key, { lifecycle: p.lifecycle, history: f.store.history(p.sourceId, p.id).data }]));
    const confirm = tidyConfirmation(listed.read.plans, listed.read.storeId, 'board');
    assert.ok(confirm.total <= TIDY_LIMIT);
    assert.equal(confirm.targets.length, confirm.total);
    assert.ok(confirm.targets.some(t => t.lifecycle === 'failed'));
    assert.ok(confirm.targets.every(t => t.lifecycle !== 'active'));
    const result = await runTidy(host, 'archive', confirm.targets, () => true);
    assert.equal(result.succeeded.length, confirm.total);
    assert.equal(f.store.detail('source-fixture', 'P-failed').plan.cleanup?.state, 'archived');
    const undo = await runTidy(host, 'restore', result.succeeded, () => true);
    assert.equal(undo.succeeded.length, confirm.total);
    assert.equal(maxInflight, 1);
    assert.equal(paths.some(p => p.endsWith('/delete')), false);
    for (const t of confirm.targets) {
      assert.equal(f.store.detail(t.request.source, t.request.plan).plan.cleanup?.state, 'visible');
      assert.deepEqual(f.store.history(t.request.source, t.request.plan).data, before.get(t.key)!.history);
      assert.equal(f.store.get(t.request.source, t.request.plan)!.lifecycle, t.lifecycle === 'completed' ? 'finished' : t.lifecycle);
    }
  } finally { await f.stop(); }
});

test('separate list/search scans include unloaded closed plans and delete uses only per-plan receipts', async () => {
  const f = await launchCleanupService(false);
  try {
    const requests: { path: string; body?: string }[] = [];
    const host: ServiceHost = { serviceRequest: async q => {
      requests.push(q);
      const r = await f.request(q.path + (q.query ? '?' + new URLSearchParams(q.query) : ''), q.body ? JSON.parse(q.body) : undefined);
      return { status: r.status, body: await r.text() };
    } };
    const listed = await readList(host, { archived: 'exclude' }, 1);
    assert.ok(listed.ok && listed.read?.truncated);
    const read = listed.read;
    requests.length = 0;
    const scan = new CleanupScan('board', read.storeId, false,
      cursor => readCleanupListPage(host, { archived: 'exclude' }, cursor, read));
    const counted = await scan.more(() => true);
    assert.equal(counted?.targets.length, 60);
    assert.equal(requests.every(q => q.path === '/v1/plans'), true, 'counting neither refreshes health nor writes');
    const reader = cleanupSearchReader(host, { q: 'P-page-', source: null, session: null, lifecycle: null, status: null, archived: 'exclude', limit: 50 }, read);
    const search = new CleanupScan('search', read.storeId, false, reader, true, 64);
    const matches = await search.more(() => true);
    assert.equal(matches?.targets.length, 55);
    assert.equal(matches?.matching, true);
    assert.equal(read.plans.length, 50, 'scan did not populate the ordinary list');
    requests.length = 0;
    const deleted = await runTidy(host, 'delete', matches!.targets, () => true);
    assert.equal(deleted.succeeded.length, 55);
    assert.ok(requests.every(q => q.path === '/v1/plan/delete' && !('active' in JSON.parse(q.body!))));
    assert.equal(f.store.get('source-fixture', 'P-active')?.lifecycle, 'active');
    assert.equal(f.store.get('source-fixture', 'P-failed')?.lifecycle, 'failed');
  } finally { await f.stop(); }
});

test('a list that shifts between pages retires the count instead of silently skipping plans', async () => {
  const f = await launchCleanupService(false);
  try {
    const raw: ServiceHost = { serviceRequest: async q => {
      const r = await f.request(q.path + (q.query ? '?' + new URLSearchParams(q.query) : ''), q.body ? JSON.parse(q.body) : undefined);
      return { status: r.status, body: await r.text() };
    } };
    const listed = await readList(raw, { archived: 'exclude' }, 1);
    assert.ok(listed.ok && listed.read?.truncated);
    const read = listed.read;
    const counted = tidyConfirmation(read.plans, read.storeId, 'board').targets[0];
    assert.ok(counted, 'a closed plan on the first page is counted first');
    let reads = 0;
    // Another frame archives that already-counted plan before the second page is read.
    const host: ServiceHost = { serviceRequest: async q => {
      if (q.path === '/v1/plans' && ++reads === 2) assert.ok((await cleanupCall(raw, 'archive', counted.request)).ok);
      return raw.serviceRequest(q);
    } };
    const continuation = {};
    const scan = new CleanupScan('board', read.storeId, false,
      cursor => readCleanupListPage(host, { archived: 'exclude' }, cursor, read, continuation));
    await assert.rejects(scan.more(() => true), /changed/);
    // Without a change the same guarded traversal still completes and sees every closed plan once.
    reads = -1000;
    const starts: string[] = [];
    const watching: ServiceHost = { serviceRequest: async q => { if (q.path === '/v1/plans') starts.push(String(q.query?.cursor ?? '')); return host.serviceRequest(q); } };
    const reused = {};
    const stable = new CleanupScan('board', read.storeId, false,
      cursor => readCleanupListPage(watching, { archived: 'exclude' }, cursor, read, reused));
    const all = await stable.more(() => true);
    assert.equal(all?.unchecked, false);
    assert.ok(starts.length > 1, 'the traversal crossed a page boundary');
    // The first page ended at cursor N; the next starts one row early to re-read that plan.
    const firstPage = await readCleanupListPage(raw, { archived: 'exclude' }, null, read);
    assert.equal(starts[1], String(Number(firstPage.nextCursor) - 1));
    assert.ok(all!.targets.every(t => t.where), 'overlapped pages keep the placement facts');
    assert.equal(new Set(all?.targets.map(t => t.key)).size, all?.targets.length);
    const whole = await readList(raw, { archived: 'exclude' }, 20);
    assert.ok(whole.ok && whole.read);
    assert.equal(all?.targets.length, tidyConfirmation(whole.read.plans, read.storeId, 'board').targets.length);
  } finally { await f.stop(); }
});

test('named plans are validated by point lookups, not by walking the library', async () => {
  const f = await launchCleanupService(false, false);
  try {
    const paths: string[] = [];
    const raw: ServiceHost = { serviceRequest: async q => {
      paths.push(q.path);
      const r = await f.request(q.path + (q.query ? '?' + new URLSearchParams(q.query) : ''), q.body ? JSON.parse(q.body) : undefined);
      return { status: r.status, body: await r.text() };
    } };
    const listed = await readList(raw, { archived: 'exclude' }, 20);
    assert.ok(listed.ok && listed.read);
    const read = listed.read;
    const named = ['P-done', 'P-other', 'P-cancelled', 'P-failed', 'P-active'].map(id => read.plans.find(p => p.id === id)!);
    assert.ok(named.every(Boolean));
    // Another frame changes four of them after they were chosen.
    const byId = (id: string) => tidyConfirmation(named.filter(p => p.id === id), read.storeId, 'x').targets[0];
    assert.ok((await cleanupCall(raw, 'archive', byId('P-cancelled').request)).ok);
    assert.equal((await runTidy(raw, 'delete', [byId('P-failed')], () => true)).succeeded.length, 1);
    f.store.apply({ op: 'revise', plan: 'P-other', rev: 2, oid: 'reopen-other', reopen: true,
      items: [{ id: 'A', title: 'More work', kind: 'task', status: 'working' }] }, f.actor, f.capture());
    paths.length = 0;
    const scan = new CleanupScan('selection', read.storeId, false, cleanupKnownReader(raw, named, read), false, 50, () => true);
    const counted = await scan.more(() => true);
    assert.deepEqual(counted?.targets.map(t => t.request.plan).sort(), ['P-active', 'P-done', 'P-other']);
    assert.equal(counted?.unchecked, false);
    const other = counted!.targets.find(t => t.request.plan === 'P-other')!;
    assert.notEqual(other.request.rev, named.find(p => p.id === 'P-other')!.revision);
    assert.equal(other.request.rev, f.store.get('source-fixture', 'P-other')!.revision, 'a moved plan is counted at its current revision');
    assert.equal(other.lifecycle, 'active');
    // Unmoved and re-read plans alike keep the placement facts the per-target scope check needs.
    assert.ok(counted!.targets.every(t => typeof t.where?.owner === 'string' && typeof t.where.directory === 'string'), 'placement carried');
    assert.ok(paths.every(p => p === '/v1/search-state' || p === '/v1/plan'), `no list or search walk: ${paths.join()}`);
    assert.equal(paths.filter(p => p === '/v1/search-state').length, 1);
  } finally { await f.stop(); }
});

test('filtered-out plans, changed generations and context changes are not blindly archived or restored', async () => {
  const f = await launchCleanupService(false);
  try {
    const paths: string[] = [];
    const host: ServiceHost = { serviceRequest: async q => {
      paths.push(q.path);
      const r = await f.request(q.path + (q.query ? '?' + new URLSearchParams(q.query) : ''), q.body ? JSON.parse(q.body) : undefined);
      return { status: r.status, body: await r.text() };
    } };
    const listed = await readList(host, { archived: 'exclude' });
    assert.ok(listed.ok && listed.read);
    const plans = listed.read.plans.filter(p => p.sourceId === 'source-fixture' && ['P-done', 'P-other', 'P-cancelled', 'P-failed', 'P-active'].includes(p.id));
    const filtered = plans.filter(p => p.id !== 'P-done');
    const c = tidyConfirmation(filtered, listed.read.storeId, 'filtered-board');
    assert.deepEqual(c.targets.map(t => t.request.plan).sort(), ['P-cancelled', 'P-failed', 'P-other']);
    const changed = c.targets.find(t => t.request.plan === 'P-other')!;
    assert.ok((await cleanupCall(host, 'archive', { ...changed.request, oid: crypto.randomUUID() })).ok);
    paths.length = 0;
    const r = await runTidy(host, 'archive', c.targets, () => true);
    assert.equal(r.succeeded.length, 2); assert.equal(r.remaining.length, 1);
    assert.equal(paths.length, 3, 'no automatic retry of the conflict');
    assert.equal(f.store.detail('source-fixture', 'P-done').plan.cleanup?.state ?? 'visible', 'visible');
    assert.equal(f.store.detail('source-fixture', 'P-active').plan.cleanup?.state ?? 'visible', 'visible');
    for (const target of r.succeeded) assert.ok((await cleanupCall(host, 'restore', { ...target.request, oid: crypto.randomUUID() })).ok);
    const undo = await runTidy(host, 'restore', r.succeeded, () => true);
    assert.equal(undo.succeeded.length, 0, 'a moved receipt cannot restore again');
    paths.length = 0;
    let current = true;
    const stopped = await runTidy({ serviceRequest: async q => { const reply = await host.serviceRequest(q); current = false; return reply; } }, 'archive', c.targets, () => current);
    assert.equal(stopped.attempted, 1); assert.equal(paths.length, 1);
    assert.equal((await runTidy(host, 'archive', c.targets, () => false)).attempted, 0);
    for (const locale of ['en', 'ru', 'zh-CN']) assert.ok(tidyCopy(locale).count(c.targets.length, c.total));
  } finally { await f.stop(); }
});

test('a counted plan reopened by its agent is skipped without acknowledgement or retry', async () => {
  const f = await launchCleanupService(false, false);
  try {
    const bodies: unknown[] = [];
    const host: ServiceHost = { serviceRequest: async q => {
      if (q.body) bodies.push(JSON.parse(q.body));
      const r = await f.request(q.path + (q.query ? '?' + new URLSearchParams(q.query) : ''), q.body ? JSON.parse(q.body) : undefined);
      return { status: r.status, body: await r.text() };
    } };
    const listed = await readList(host, { archived: 'exclude' });
    assert.ok(listed.ok && listed.read);
    const target = tidyConfirmation(listed.read.plans.filter(p => p.id === 'P-other'), listed.read.storeId, 'board');
    f.store.apply({ op: 'revise', plan: 'P-other', rev: 2, oid: 'reopen-other', reopen: true,
      items: [{ id: 'A', title: 'More work', kind: 'task', status: 'working' }] }, f.actor, f.capture());
    const result = await runTidy(host, 'archive', target.targets, () => true);
    assert.equal(result.succeeded.length, 0);
    assert.equal(result.remaining.length, 1);
    assert.equal(bodies.length, 1);
    assert.equal('active' in (bodies[0] as object), false);
    assert.equal(f.store.get('source-fixture', 'P-other')?.lifecycle, 'active');
  } finally { await f.stop(); }
});

/** A host that lets chosen plans' requests reach the service, then loses the reply. */
function lossyHost(f: Awaited<ReturnType<typeof launchCleanupService>>, loseReplyFor: Set<string>): ServiceHost {
  return { serviceRequest: async q => {
    const r = await f.request(q.path + (q.query ? '?' + new URLSearchParams(q.query) : ''), q.body ? JSON.parse(q.body) : undefined);
    const body = await r.text();
    if (q.body && loseReplyFor.has(JSON.parse(q.body).plan)) throw Object.assign(new Error('host timed out'), { code: 'HOST_TIMEOUT' });
    return { status: r.status, body };
  } };
}
async function closedTargets(f: Awaited<ReturnType<typeof launchCleanupService>>, ids: string[]) {
  const read = await readList(lossyHost(f, new Set()), { archived: 'exclude' });
  assert.ok(read.ok && read.read);
  const targets = tidyConfirmation(read.read.plans.filter(p => p.sourceId === 'source-fixture' && ids.includes(p.id)), read.read.storeId, 'board').targets;
  assert.deepEqual(targets.map(t => t.request.plan).sort(), [...ids].sort());
  return targets;
}

test('against the cleanup service: a refusal is skipped, a lost reply is unconfirmed and applied, and Undo takes receipts only', async () => {
  const f = await launchCleanupService(false);
  try {
    const targets = await closedTargets(f, ['P-done', 'P-other', 'P-cancelled', 'P-failed']);
    const [, changed] = targets;
    assert.ok((await cleanupCall(lossyHost(f, new Set()), 'archive', { ...changed.request, oid: crypto.randomUUID() })).ok, 'another cleanup moves this plan first');
    const lostPlan = targets[2].request.plan;
    const result = await runTidy(lossyHost(f, new Set([lostPlan])), 'archive', targets, () => true);
    assert.equal(result.succeeded.length, 2);
    assert.equal(result.unconfirmed, 1, 'the refusal as changed is skipped; only the lost reply is unconfirmed');
    assert.deepEqual(result.remaining.map(t => t.request.plan).sort(), [changed.request.plan, lostPlan].sort());
    assert.equal(f.store.detail('source-fixture', lostPlan).plan.cleanup?.state, 'archived', 'the unconfirmed plan was in fact archived');
    const undo = await runTidy(lossyHost(f, new Set()), 'restore', result.succeeded, () => true);
    assert.equal(undo.succeeded.length, 2);
    assert.equal(f.store.detail('source-fixture', lostPlan).plan.cleanup?.state, 'archived', 'Undo never restores a plan it holds no receipt for');
  } finally { await f.stop(); }
});

test('a restore whose reply was lost, sent again with the same request, returns the saved receipt and restores once', async () => {
  const f = await launchCleanupService(false);
  try {
    const targets = await closedTargets(f, ['P-done', 'P-failed']);
    const archived = await runTidy(lossyHost(f, new Set()), 'archive', targets, () => true);
    assert.equal(archived.succeeded.length, 2);
    const lostPlan = archived.succeeded[1].request.plan;
    const first = await runTidy(lossyHost(f, new Set([lostPlan])), 'restore', archived.succeeded, () => true);
    assert.equal(first.succeeded.length, 1);
    assert.equal(first.unconfirmed, 1);
    assert.deepEqual(first.remaining.map(t => t.request), [archived.succeeded[1].request], 'the remaining restore keeps its request and receipt generation');
    const generation = f.store.detail('source-fixture', lostPlan).plan.cleanup?.revision;
    const again = await runTidy(lossyHost(f, new Set()), 'restore', first.remaining, () => true);
    assert.equal(again.succeeded.length, 1, 'the applied restore is confirmed, not refused');
    assert.equal(again.unconfirmed ?? 0, 0);
    assert.equal(f.store.detail('source-fixture', lostPlan).plan.cleanup?.state, 'visible');
    assert.equal(f.store.detail('source-fixture', lostPlan).plan.cleanup?.revision, generation, 'restored once: the generation did not move again');
  } finally { await f.stop(); }
});

test('a repeated restore after another cleanup of the plan is a conflict and counts as skipped', async () => {
  const f = await launchCleanupService(false);
  try {
    const targets = await closedTargets(f, ['P-done']);
    const archived = await runTidy(lossyHost(f, new Set()), 'archive', targets, () => true);
    const [receipt] = archived.succeeded;
    const first = await runTidy(lossyHost(f, new Set([receipt.request.plan])), 'restore', archived.succeeded, () => true);
    assert.equal(first.unconfirmed, 1);
    // The restore was applied; another cleanup archives the plan again before the repeat.
    const host = lossyHost(f, new Set());
    const moved = await cleanupCall(host, 'archive', { ...receipt.request, cleanupRev: receipt.request.cleanupRev + 1, oid: crypto.randomUUID() });
    assert.ok(moved.ok);
    const again = await runTidy(host, 'restore', first.remaining, () => true);
    assert.equal(again.succeeded.length, 0);
    assert.equal(again.unconfirmed ?? 0, 0, 'refused because the generation moved: skipped');
    assert.equal(again.remaining.length, 1);
    assert.equal(f.store.detail('source-fixture', receipt.request.plan).plan.cleanup?.state, 'archived', 'left as the other cleanup made it');
  } finally { await f.stop(); }
});
