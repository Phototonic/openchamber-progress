import test from 'node:test';
import assert from 'node:assert/strict';
import { launchCleanupService } from '../fixtures/cleanup-service.ts';
import { readList, cleanupCall, type ServiceHost } from '../../ui/shared/source.ts';
import { runTidy, tidyConfirmation, tidyCopy, TIDY_LIMIT } from '../../ui/shared/cleanup.ts';

test('Tidy caps the listed finished/cancelled set; Undo restores precisely its receipts without changing history', async () => {
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
    assert.ok(confirm.total > TIDY_LIMIT);
    assert.equal(confirm.targets.length, 50);
    assert.ok(confirm.targets.every(t => t.lifecycle === 'completed' || t.lifecycle === 'cancelled'));
    const result = await runTidy(host, 'archive', confirm.targets, () => true);
    assert.equal(result.succeeded.length, 50);
    assert.equal(f.store.detail('source-fixture', 'P-failed').plan.cleanup?.state ?? 'visible', 'visible');
    const undo = await runTidy(host, 'restore', result.succeeded, () => true);
    assert.equal(undo.succeeded.length, 50);
    assert.equal(maxInflight, 1);
    assert.equal(paths.some(p => p.endsWith('/delete')), false);
    for (const t of confirm.targets) {
      assert.equal(f.store.detail(t.request.source, t.request.plan).plan.cleanup?.state, 'visible');
      assert.deepEqual(f.store.history(t.request.source, t.request.plan).data, before.get(t.key)!.history);
      assert.equal(f.store.get(t.request.source, t.request.plan)!.lifecycle, t.lifecycle === 'completed' ? 'finished' : t.lifecycle);
    }
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
    assert.deepEqual(c.targets.map(t => t.request.plan).sort(), ['P-cancelled', 'P-other']);
    const changed = c.targets.find(t => t.request.plan === 'P-other')!;
    assert.ok((await cleanupCall(host, 'archive', { ...changed.request, oid: crypto.randomUUID() })).ok);
    paths.length = 0;
    const r = await runTidy(host, 'archive', c.targets, () => true);
    assert.equal(r.succeeded.length, 1); assert.equal(r.remaining.length, 1);
    assert.equal(paths.length, 2, 'no automatic retry of the conflict');
    assert.equal(f.store.detail('source-fixture', 'P-done').plan.cleanup?.state ?? 'visible', 'visible');
    assert.equal(f.store.detail('source-fixture', 'P-active').plan.cleanup?.state ?? 'visible', 'visible');
    assert.ok((await cleanupCall(host, 'restore', { ...r.succeeded[0].request, oid: crypto.randomUUID() })).ok);
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
