import { once } from 'node:events';
import { createProgressServer } from '../../service/server.ts';
import type { BlockerItemInput } from '../../shared/progress.ts';
import { productionFixture } from './production.ts';

/** Actual HTTP service and disposable SQLite store; only the SDK host is synthetic. */
export async function inboxIntegration(source: string, plans: { id: string; title: string; session: string; items: BlockerItemInput[] }[]) {
  const f = productionFixture();
  f.store.registerSource({ id: source, configRoot: '/fixture/inbox/config', dataRoot: '/fixture/inbox/data', verified: true }); f.store.bindReads(source, true);
  let oid = 0;
  const apply = (plan: typeof plans[number], request: Record<string, unknown>) => f.store.apply({
    plan: plan.id, rev: f.store.get(source, plan.id)?.revision ?? 0, oid: `inbox-qa-${++oid}`, ...request,
  }, { ...f.actor, sourceId: source, sessionId: plan.session });
  const alpha = plans[0];
  for (const plan of plans) {
    const items = structuredClone(plan.items);
    // An older review wait plus a recently blocked decision exercise the shared history budget.
    if (plan === alpha) { items.find(i => i.id === 'task-a')!.status = 'pending'; delete items.find(i => i.id === 'task-a')!.blocker; }
    apply(plan, { op: 'start', title: plan.title, items });
    if (plan === alpha) {
      for (let n = 0; n < 130; n++) apply(plan, { op: 'revise', title: plan.title });
      apply(plan, { op: 'change', changes: [{ id: 'task-a', status: 'blocked', blocker: plan.items.find(i => i.id === 'task-a')!.blocker }] });
      for (const row of f.store.db.prepare('SELECT revision,snapshot FROM revisions WHERE source=? AND plan=?').all(source, plan.id)) {
        const p = JSON.parse(String(row.snapshot));
        p.reportedAt = new Date(Date.now() - (262 - Number(row.revision)) * 60_000).toISOString();
        const text = JSON.stringify(p);
        f.store.db.prepare('UPDATE revisions SET snapshot=? WHERE source=? AND plan=? AND revision=?').run(text, source, plan.id, Number(row.revision));
        f.store.db.prepare('UPDATE plans SET snapshot=? WHERE source=? AND id=? AND revision=?').run(text, source, plan.id, Number(row.revision));
      }
    }
  }
  // Future category: test the reader's safe unclassified projection, not a supported writer value.
  const gamma = plans[2], snapshot = f.store.get(source, gamma.id)!;
  snapshot.items.find(i => i.id === 'task-h')!.blocker!.category = 'future-category' as never;
  f.store.db.prepare('UPDATE plans SET snapshot=? WHERE source=? AND id=?').run(JSON.stringify(snapshot), source, gamma.id);
  const server = createProgressServer(f.store, 'synthetic-inbox-qa');
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return {
    partial() {
      // 51 blocked rows in one plan leave a revision-pinned mid-plan cursor at the real 50-row bound.
      const items = [...alpha.items, ...Array.from({ length: 49 }, (_, n): BlockerItemInput => ({ id: `filler-${n}`, title: 'Additional reported wait', kind: 'task', status: 'blocked' }))];
      const upload = 'inbox-partial';
      for (let n = 0; n < items.length; n += 50) apply(alpha, { op: 'stage', upload, chunk: n / 50, items: items.slice(n, n + 50) });
      apply(alpha, { op: 'commit', upload, chunks: Math.ceil(items.length / 50) });
    },
    conflict() { apply(alpha, { op: 'revise', title: alpha.title }); },
    empty() {
      for (const plan of plans) apply(plan, { op: 'revise', items: plan.items.map(i => {
        if (i.blocker?.category !== 'decision' && i.blocker?.category !== 'review') return i;
        const { blocker, ...item } = i;
        return { ...item, status: 'done' };
      }) });
    },
    async request(q: { method?: string; path: string; query?: Record<string, string> }) {
      const response = await fetch(`${url}${q.path}?${new URLSearchParams(q.query)}`, { method: q.method, headers: { authorization: 'Bearer synthetic-inbox-qa' }, signal: AbortSignal.timeout(5000) });
      return { status: response.status, body: await response.json() as Record<string, unknown> };
    },
    async close() { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); f.cleanup(); },
  };
}
