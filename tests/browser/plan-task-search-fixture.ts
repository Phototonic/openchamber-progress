// Board-search browser-logic fixture: the accepted backend fixture behind a REAL in-process HTTP
// service (createProgressServer + disposable SQLite), a guest-shaped relay with a request log, and
// labelled seams: held replies and a frozen synthetic SDK workspace snapshot. Synthetic data only.
import { once } from 'node:events';
import type { GuestRequest, GuestRequestResult } from '@openchamber/sdk';
import { createProgressServer } from '../../service/server.ts';
import type { LiveSnapshot } from '../../ui/shared/live.ts';
import { searchFixture } from '../fixtures/plan-task-search.ts';
import { deferred } from './change-digests-fixture.ts';

export { deferred };
export type Fixture = ReturnType<typeof searchFixture>;

/** Real service over the search fixture; `seed:false` leaves the store empty for a custom library. */
export async function searchBackend(seed = true) {
  const f = searchFixture(seed);
  const server = createProgressServer(f.store, 'fixture-only'); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  let oid = 0;
  const relay = async (q: GuestRequest): Promise<GuestRequestResult> => {
    if (q.path === '/v1/extension-update' || q.path === '/v1/setup') return { status: 404, body: '{"error":"not-found"}' };
    const qs = new URLSearchParams(q.query ?? {}).toString();
    const r = await fetch(base + q.path + (qs ? `?${qs}` : ''), { method: q.method, headers: { authorization: 'Bearer fixture-only', ...(q.body ? { 'content-type': 'application/json' } : {}) }, ...(q.body ? { body: q.body } : {}) });
    return { status: r.status, body: await r.text() };
  };
  const revision = (source: string, plan: string) => f.store.get(source, plan)!.revision;
  const cleanupRev = (source: string, plan: string) => f.store.detail(source, plan).plan.cleanup?.revision ?? 0;
  /** Completes every open task through production writes, then reports the plan finished. */
  function finish(plan: string, source = f.alpha.id) {
    const who = source === f.alpha.id ? f.actor : { ...f.actor, sourceId: source };
    const open = f.store.get(source, plan)!.items.filter((i) => i.kind === 'task' && i.status !== 'done' && i.status !== 'skipped');
    if (open.length) f.apply(plan, { op: 'change', changes: open.map((i) => ({ id: i.id, status: 'done' })) }, who);
    f.apply(plan, { op: 'finish', outcome: 'finished' }, who);
  }
  /** Real cleanup through the service (finishing an active plan first when needed). */
  async function act(action: 'archive' | 'restore' | 'delete', plan: string, source = f.alpha.id) {
    if (f.store.get(source, plan)!.lifecycle === 'active') finish(plan, source);
    const r = await relay({ method: 'POST', path: `/v1/plan/${action}`, body: JSON.stringify({ storeId: f.storeId, source, plan, rev: revision(source, plan), cleanupRev: cleanupRev(source, plan), oid: `search-cleanup-${++oid}`, ...(action === 'delete' ? { confirmed: true } : {}) }) });
    if (r.status !== 200) throw new Error(`${action} ${plan}: ${r.status} ${r.body}`);
  }
  return { f, relay, act, finish, stop: async () => { server.close(); server.closeAllConnections(); f.cleanup(); } };
}
export type Backend = Awaited<ReturnType<typeof searchBackend>>;

/** Logged guest proxy; `hold(path)` holds the next matching reply (the request reaches the service). */
export function searchProxy(b: Pick<Backend, 'relay'>) {
  const log: { path: string; query: Record<string, string> | null; at: number }[] = [];
  let holds: { path: string; gate: ReturnType<typeof deferred<void>> }[] = [];
  let inflight = 0, peak = 0;
  return {
    log,
    get peak() { return peak; },
    hold(path: string) { const gate = deferred(); holds.push({ path, gate }); return gate.resolve; },
    serviceRequest: async (q: GuestRequest) => {
      log.push({ path: q.path, query: (q.query as Record<string, string>) ?? null, at: log.length });
      inflight++; peak = Math.max(peak, inflight);
      try {
        const hold = holds.find((h) => h.path === q.path);
        const reply = b.relay(q);
        if (hold) { holds = holds.filter((h) => h !== hold); const r = await reply; await hold.gate.promise; return r; }
        return await reply;
      } finally { inflight--; }
    },
    count: (path: string) => log.filter((l) => l.path === path).length,
  };
}
export type SearchProxy = ReturnType<typeof searchProxy>;

/** Synthetic settled SDK workspace: two configured checkouts that match the fixture's recorded directories. */
export function workspace(extra: Partial<LiveSnapshot> = {}): LiveSnapshot {
  return {
    projectsState: 'ready',
    projects: [{ id: 'alpha', name: 'Alpha', directory: '/fixture/main' }, { id: 'other', name: 'Other', directory: '/fixture/other' }],
    worktrees: new Map(), sessions: new Map(), capped: [], ...extra,
  };
}

export async function until(cond: () => boolean, what: string, ms = 8000) {
  const end = Date.now() + ms;
  while (!cond()) { if (Date.now() > end) throw new Error(`timed out: ${what}`); await new Promise((r) => setTimeout(r, 5)); }
}
export const settle = async () => { for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r)); await new Promise((r) => setTimeout(r, 20)); for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r)); };
