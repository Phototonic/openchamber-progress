import { productionFixture } from './production.ts';
import type { Actor, ItemInput, SearchOptions, SearchWindow } from '../../shared/progress.ts';

export const searchItems: ItemInput[] = [
  { id: 'G', title: 'Context only', kind: 'group' },
  { id: 'G-inner', title: 'Export CSV group', kind: 'group', parentId: 'G' },
  { id: 'T-csv', title: 'Export CSV', kind: 'task', status: 'working', parentId: 'G-inner' },
  { id: 'T-blocked', title: 'Review CSV export', kind: 'task', status: 'blocked', parentId: 'G' },
  { id: 'T-other', title: 'Unrelated', kind: 'task', status: 'blocked' },
  { id: 'T-done', title: 'Completed', kind: 'task', status: 'done' },
  { id: 'T-skip', title: 'Optional', kind: 'task', status: 'skipped' },
];
export function searchFixture(seed = true) {
  const f = productionFixture(); let oid = 0;
  const alpha = { ...f.source, id: 'source-alpha', configRoot: '/fixture/alpha/config', dataRoot: '/fixture/alpha/data' };
  const beta = { ...f.source, id: 'source-beta', configRoot: '/fixture/beta/config', dataRoot: '/fixture/beta/data', verified: false };
  f.store.registerSource(alpha); f.store.registerSource(beta); f.store.bindReads(alpha.id, true);
  const actor = { ...f.actor, sourceId: alpha.id, directory: '/fixture/main', projectId: 'project-alpha' };
  function apply(plan: string, request: Record<string, unknown>, who: Actor = actor, child?: Actor) {
    return f.store.apply({ plan, rev: f.store.get(who.sourceId, plan)?.revision ?? 0, oid: `search-op-${++oid}`, ...request }, who, undefined, child);
  }
  function seedPlan(plan: string, title: string, items: ItemInput[], who = actor) {
    if (items.length <= 50) return apply(plan, { op: 'start', title, items }, who);
    const upload = `upload-${++oid}`;
    for (let n = 0; n < items.length; n += 50) apply(plan, { op: 'stage', upload, chunk: n / 50, items: items.slice(n, n + 50) }, who);
    return apply(plan, { op: 'commit', title, upload, chunks: Math.ceil(items.length / 50) }, who);
  }
  if (seed) {
    seedPlan('P-export', 'Export service', searchItems);
    seedPlan('P-title', 'CSV export rollout', [{ id: 'T-other', title: 'Unrelated', kind: 'task', status: 'blocked' }]);
    seedPlan('P-export', 'Independent report', [{ id: 'T-csv', title: 'Export CSV', kind: 'task', status: 'done' }], { ...actor, sourceId: beta.id });
    seedPlan('P-empty', 'Empty', []); seedPlan('P-group', 'Groups', [{ id: 'G', title: 'Export CSV', kind: 'group' }]);
  }
  const storeId = f.store.search().storeId;
  function scan(options: SearchOptions = {}) {
    const windows: SearchWindow[] = []; let cursor: string | undefined;
    do { const w = f.store.search({ ...options, ...(cursor ? { cursor } : {}) }); windows.push(w); cursor = w.nextCursor ?? undefined; if (windows.length > 10000) throw Error('fixture continuation did not finish'); } while (cursor);
    return windows;
  }
  return { ...f, alpha, beta, actor, apply, seedPlan, storeId, scan };
}

export const libraryId = (n: number) => `P-${String(n).padStart(4, '0')}`;
export function seedSearchLibrary(f: ReturnType<typeof searchFixture>) {
  for (let n = 0; n < 1200; n++) f.seedPlan(libraryId(n), [51, 501, 1001].includes(n) ? `Needle-at-${String(n).padStart(4,'0')}` : 'Ordinary report', [{ id: 'T', title: n % 2 ? 'Ordinary task' : 'Dense match', kind: 'task', status: 'pending' }], { ...f.actor, directory: n < 500 ? '/fixture/other' : '/fixture/main' });
}
