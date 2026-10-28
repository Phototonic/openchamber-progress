import { LIMITS, type Envelope, type PlanRead, type PlanState, type PlanTiming } from '../shared/progress.ts';
import type { Store } from '../shared/store.ts';

// No cache: detail is revision-driven, and these bounds keep each read finite.
// In particular, never retain a Store across SetupController refresh/close.
export const TIMING_LIMITS = { revisions: 128, bytes: 8 * 1024 * 1024 } as const;

export function taskTiming(store: Store, detail: Envelope & PlanRead, now = new Date()): PlanTiming {
  const result: PlanTiming = { readAt: now.toISOString(), items: {} };
  const { plan } = detail;
  if (plan.lifecycle !== 'active' || !plan.working.length) return result;
  const pending = new Map(plan.working.map(id => [id, '']));
  const derived: PlanTiming['items'] = {};
  let expected = plan.revision, newer = now.getTime(), bytes = 0, scanned = 0;
  let began = false;
  try {
    store.db.exec('BEGIN'); began = true;
    if (store.db.prepare('SELECT store_id FROM meta WHERE singleton=1').get()?.store_id !== detail.storeId) throw new Error('identity');
    const rows = store.db.prepare('SELECT revision,length(CAST(snapshot AS BLOB)) AS bytes,CASE WHEN length(CAST(snapshot AS BLOB))<=? THEN snapshot ELSE NULL END AS snapshot FROM revisions WHERE source=? AND plan=? AND revision=?');
    for (let visits = 0; visits < TIMING_LIMITS.revisions; visits++) {
      const row = rows.get(TIMING_LIMITS.bytes - bytes,plan.sourceId,plan.id,expected);
      if (!row) break;
      bytes += Number(row.bytes);
      if (bytes > TIMING_LIMITS.bytes) break;
      const text = String(row.snapshot);
      const p = JSON.parse(text) as PlanState;
      const time = typeof p.reportedAt === 'string' ? Date.parse(p.reportedAt) : NaN;
      if (row.revision !== expected || p.revision !== expected || p.sourceId !== plan.sourceId || p.id !== plan.id ||
          !Number.isFinite(time) || new Date(time).toISOString() !== p.reportedAt || time > newer || !['active','finished','cancelled','failed'].includes(p.lifecycle) ||
          !Array.isArray(p.items) || p.items.length > LIMITS.planItems || new Set(p.items.map(i => i.id)).size !== p.items.length ||
          p.items.some(i => !i || typeof i.id !== 'string' || !['task','group'].includes(i.kind) || !['pending','working','blocked','done','skipped'].includes(i.status))) throw new Error('history');
      const working = new Set(p.items.filter(i => i.kind === 'task' && i.status === 'working').map(i => i.id));
      if (!scanned && (p.lifecycle !== plan.lifecycle || p.reportedAt !== plan.reportedAt || working.size !== pending.size ||
          [...pending.keys()].some(id => !working.has(id)) || detail.items.data.some(i => {
            const historical = p.items.find(h => h.id === i.id);
            return !historical || historical.kind !== i.kind || historical.status !== i.status;
          }))) throw new Error('current');
      scanned++; expected--; newer = time;
      for (const [id, since] of pending) {
        if (p.lifecycle !== 'active' || !working.has(id)) {
          if (!since) throw new Error('current');
          derived[id] = { since, kind: 'exact' }; pending.delete(id);
        } else pending.set(id, p.reportedAt);
      }
      if (expected === 0) {
        for (const [id, since] of pending) derived[id] = { since, kind: 'exact' };
        pending.clear();
      }
      if (!pending.size) break;
    }
    // Exhaustion before revision 1 is a gap, not a capped interval.
    if (pending.size && scanned < TIMING_LIMITS.revisions && bytes <= TIMING_LIMITS.bytes) throw new Error('gap');
    if (!scanned) throw new Error('missing-current');
    for (const [id, since] of pending) derived[id] = { since, kind: 'lower-bound' };
    store.db.exec('COMMIT'); began = false;
    result.items = derived;
  } catch {
    // Optional timing must never turn incomplete/corrupt history into a start claim.
    if (began) try { store.db.exec('ROLLBACK'); } catch { /* preserve detail */ }
  }
  return result;
}
