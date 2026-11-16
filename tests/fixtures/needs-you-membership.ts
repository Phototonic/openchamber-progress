import { once } from 'node:events';
import { createProgressServer } from '../../service/server.ts';
import { productionFixture } from './production.ts';

/** A pre-upgrade-shaped store served unchanged to old and new guests. No migration seam. */
export async function needsYouMembershipIntegration(source: string, session: string, childSession: string) {
  const f = productionFixture(), child = { ...f.actor, sourceId: source, sessionId: childSession, parentId: session, ancestry: [session] };
  const main = { ...f.actor, sourceId: source, sessionId: session };
  f.store.registerSource({ id: source, configRoot: '/fixture/membership/config', dataRoot: '/fixture/membership/data', verified: true });
  f.store.bindReads(source, true);
  let oid = 0;
  const apply = (plan: string, actor: typeof main, request: Record<string, unknown>, linked?: typeof child) =>
    f.store.apply({ plan, rev: f.store.get(source, plan)?.revision ?? 0, oid: `membership-${++oid}`, ...request }, actor, undefined, linked);
  apply('plan-alpha', main, { op: 'start', title: 'Main session plan', items: [
    { id: 'main', title: 'Choose the format', kind: 'task', status: 'blocked', blocker: { category: 'decision', reason: 'Choose CSV or JSON', nextAction: 'Tell the main session' } },
    { id: 'direct', title: 'Ask parent for input', kind: 'task', status: 'blocked', dependencies: ['main'] },
    { id: 'relay', title: 'Review the draft', kind: 'task', status: 'blocked', dependencies: ['main'] },
  ] });
  apply('plan-alpha', main, { op: 'link', child: child.sessionId, assign: ['direct','relay'] }, child);
  apply('plan-alpha', child, { op: 'change', changes: [{ id: 'direct', status: 'blocked', blocker: { category: 'decision', reason: 'Parent must supply the sample', nextAction: 'Parent: attach a sample' } }] });
  apply('plan-alpha', main, { op: 'change', attributed: child.sessionId, changes: [{ id: 'relay', status: 'blocked', blocker: { category: 'review', reason: 'Please review the draft', nextAction: 'Reply to the main session' } }] }, child);
  apply('plan-beta', child, { op: 'start', title: 'Sub-agent plan', items: [
    { id: 'owned', title: 'Ask parent to choose', kind: 'task', status: 'blocked', blocker: { category: 'decision', reason: 'Parent must choose a direction', nextAction: 'Parent: choose A or B' } },
    { id: 'next', title: 'Continue afterwards', kind: 'task', dependencies: ['owned'] },
  ] });
  const dump = () => JSON.stringify(['sqlite_master','sessions','plans','revisions','contributions','receipts','meta'].map(t => f.store.db.prepare(`SELECT * FROM ${t}`).all()));
  const before = dump();
  const server = createProgressServer(f.store, 'synthetic-membership-qa');
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return {
    unchanged: () => dump() === before,
    async request(q: { path: string; query?: Record<string, string> }) {
      const r = await fetch(`${origin}${q.path}?${new URLSearchParams(q.query)}`, { headers: { authorization: 'Bearer synthetic-membership-qa' }, signal: AbortSignal.timeout(5000) });
      return { status: r.status, body: await r.json() as Record<string, unknown> };
    },
    async close() { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); f.cleanup(); },
  };
}
