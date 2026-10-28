import { BLOCKER_LIMITS, countItems, type BlockedTiming, type Envelope, type PlanRead } from '../shared/progress.ts';
import { validateDigestSnapshot } from '../shared/change-digest.ts';
import { cleanupInstalled, cleanupState } from '../shared/cleanup.ts';
import type { Store } from '../shared/store.ts';

/** One bounded, revision-pinned scan for the whole plan; never a task/page cache. */
export function blockedTiming(store: Store, detail: Envelope & PlanRead, now = new Date()): BlockedTiming {
  const result: BlockedTiming = { readAt: now.toISOString(), items: {} };
  const { plan } = detail;
  if (plan.lifecycle !== 'active') return result;
  let began = false;
  try {
    store.db.exec('BEGIN'); began = true;
    if (store.db.prepare('SELECT store_id FROM meta WHERE singleton=1').get()?.store_id !== detail.storeId) throw new Error('identity');
    const live = store.db.prepare('SELECT revision FROM plans WHERE source=? AND id=?').get(plan.sourceId,plan.id);
    if (!live || Number(live.revision) < plan.revision) throw new Error('identity');
    const state = cleanupInstalled(store.db) ? cleanupState(store.db,plan.sourceId,plan.id) : undefined;
    if ((state?.state ?? 'visible') !== (plan.cleanup?.state ?? 'visible') || Number(state?.generation ?? 0) !== (plan.cleanup?.revision ?? 0)) throw new Error('cleanup');
    const pending = new Map<string,string>();
    const derived: BlockedTiming['items'] = {};
    let expected = plan.revision, newerTime = now.getTime(), newerStructural: number | undefined, bytes = 0, accepted = 0;
    // Admission happens in SQL before text crosses the SQLite/JS boundary.
    const load = store.db.prepare('SELECT length(CAST(snapshot AS BLOB)) AS bytes,CASE WHEN length(CAST(snapshot AS BLOB))<=? THEN snapshot ELSE NULL END AS snapshot FROM revisions WHERE source=? AND plan=? AND revision=?');
    for (let visits = 0; visits < BLOCKER_LIMITS.snapshotVisits; visits++) {
      const remaining = BLOCKER_LIMITS.inputBytes - bytes;
      const row = load.get(remaining,plan.sourceId,plan.id,expected);
      if (!row) throw new Error('gap');
      if (Number(row.bytes) > remaining) break;
      bytes += Number(row.bytes);
      const p = validateDigestSnapshot(JSON.parse(String(row.snapshot)),plan.sourceId,plan.id,expected);
      if (!p) throw new Error('history');
      const time = Date.parse(p.reportedAt);
      if (time > newerTime || newerStructural !== undefined && (p.structuralRevision > newerStructural || newerStructural - p.structuralRevision > 1)) throw new Error('chronology');
      const blocked = new Set(p.items.filter(i => i.kind === 'task' && i.status === 'blocked').map(i => i.id));
      if (!accepted) {
        if (p.lifecycle !== plan.lifecycle || p.reportedAt !== plan.reportedAt || p.structuralRevision !== plan.structuralRevision ||
            JSON.stringify(countItems(p.items)) !== JSON.stringify(plan.counts) || detail.items.data.some(i => {
              const h = p.items.find(h => h.id === i.id);
              return !h || h.kind !== i.kind || h.status !== i.status || h.title !== i.title || h.parentId !== i.parentId || JSON.stringify(h.dependencies ?? []) !== JSON.stringify(i.dependencies ?? []);
            })) throw new Error('current');
        for (const id of blocked) pending.set(id,'');
      }
      accepted++; expected--; newerTime = time; newerStructural = p.structuralRevision;
      for (const [id,since] of pending) {
        if (p.lifecycle !== 'active' || !blocked.has(id)) {
          if (!since) throw new Error('current');
          derived[id] = { since,kind:'exact' }; pending.delete(id);
        } else pending.set(id,p.reportedAt);
      }
      if (expected === 0) {
        for (const [id,since] of pending) derived[id] = { since,kind:'exact' };
        pending.clear();
      }
      if (!pending.size) break;
    }
    if (!accepted) throw new Error('missing-current');
    for (const [id,since] of pending) derived[id] = { since,kind:'lower-bound' };
    store.db.exec('COMMIT'); began = false;
    result.items = derived;
  } catch {
    // Invalid history makes no start claim; it never changes reports or detail.
    if (began) try { store.db.exec('ROLLBACK'); } catch { /* retain original detail */ }
  }
  return result;
}
