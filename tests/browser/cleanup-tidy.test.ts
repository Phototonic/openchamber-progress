import test from 'node:test';
import assert from 'node:assert/strict';
import { launchCleanupService } from '../fixtures/cleanup-service.ts';
import { readList, readCleanupListPage, cleanupSearchReader, cleanupCall, type ServiceHost } from '../../ui/shared/source.ts';
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
