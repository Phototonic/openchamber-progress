/** Internal, read-only contract; not a report operation or public discovery API. */
import type { DatabaseSync, SQLOutputValue } from 'node:sqlite';
import { identifier, ProgressError, requireProgress as need, type PlanState } from './progress.ts';
import { validateDigestSnapshot } from './change-digest.ts';
import { cleanupInstalled } from './cleanup.ts';

export const RESUME_LIMITS = { candidates: 3, assignments: 20, planSlots: 64, snapshotBytes: 1_048_576, inputBytes: 8_388_608, scanMs: 100 } as const;
export interface ResumeRequest {
  storeId: string; sourceId: string; sessionId: string;
  /** Complete authoritative ancestry, nearest parent first; null means unknown. */
  parentId: string | null; ancestry: readonly string[] | null;
}
export type ResumeCandidate = { sourceId: string; plan: string; title: string; revision: number } &
  ({ scope: 'coordinator' } | { scope: 'assigned'; itemIds: string[] });
export interface ResumeSelection {
  storeId: string; sourceId: string; sessionId: string;
  candidates: ResumeCandidate[];
  /** Never infer uniqueness when either flag is true. No exact total is known. */
  omitted: boolean; incomplete: boolean;
  limit: 'slots' | 'bytes' | 'time' | 'candidates' | null;
  work: { planSlots: number; snapshots: number; inputBytes: number };
}
/** Activation receives only this callback, not the Store or its executor. */
export type ResumeRead = (request: ResumeRequest) => ResumeSelection | null;

function validPlan(value: unknown, source: string, id: string, revision: number): PlanState {
  const p = value as PlanState;
  need(validateDigestSnapshot(value, source, id, revision), 'corrupt');
  need(typeof p.title === 'string' && !!p.title.trim() && p.title.length <= 256 && !p.title.includes('\0') && identifier(p.sessionId), 'corrupt');
  need(Array.isArray(p.links) && p.links.length <= 64, 'corrupt');
  const sessions = new Set<string>(), assigned = new Map<string, string>();
  const items = new Map(p.items.map(i => [i.id, i]));
  for (const link of p.links) {
    need(link && identifier(link.sessionId) && !sessions.has(link.sessionId) && link.sessionId !== p.sessionId && Array.isArray(link.itemIds) && link.itemIds.length <= 1000, 'corrupt');
    sessions.add(link.sessionId);
    for (const id of link.itemIds) {
      need(identifier(id) && !assigned.has(id) && items.get(id)?.kind === 'task' && items.get(id)?.assigneeSessionId === link.sessionId, 'corrupt');
      assigned.set(id, link.sessionId);
    }
  }
  for (const item of p.items) if (item.assigneeSessionId !== undefined) {
    need(identifier(item.assigneeSessionId) && item.kind === 'task' && assigned.get(item.id) === item.assigneeSessionId, 'corrupt');
  }
  return p; // Keep original validated assignment fields, not the digest projection.
}

/** Caller owns the existing Store read transaction. Clock injection is test-only. */
export function resumeSelection(db: DatabaseSync, binding: { sourceId: string | null; verified: boolean }, r: ResumeRequest, now: () => number = () => performance.now()): ResumeSelection | null {
  if (!identifier(r.storeId) || !identifier(r.sourceId) || !identifier(r.sessionId) || binding.sourceId !== r.sourceId || !binding.verified || !Array.isArray(r.ancestry) || r.ancestry.length > 32 || !r.ancestry.every(identifier) || new Set([r.sessionId, ...r.ancestry]).size !== r.ancestry.length + 1 || (r.parentId === null ? r.ancestry.length !== 0 : !identifier(r.parentId) || r.ancestry[0] !== r.parentId)) return null;
  const meta = db.prepare('SELECT store_id,enabled FROM meta WHERE singleton=1').get();
  const source = db.prepare('SELECT verified FROM sources WHERE id=?').get(r.sourceId);
  need(meta && identifier(meta.store_id) && (meta.enabled === 0 || meta.enabled === 1), 'corrupt');
  if (meta.store_id !== r.storeId || meta.enabled !== 1 || source?.verified !== 1) return null;
  need(Number(db.prepare('PRAGMA busy_timeout').get()!.timeout) <= 1000, 'binding');
  const installed = cleanupInstalled(db);
  const result: ResumeSelection = { storeId: r.storeId, sourceId: r.sourceId, sessionId: r.sessionId, candidates: [], omitted: false, incomplete: false, limit: null, work: { planSlots: 0, snapshots: 0, inputBytes: 0 } };
  const start = now(); let last = start;
  need(Number.isFinite(start), 'invalid');
  const expired = () => { const t = now(); need(Number.isFinite(t) && t >= last, 'invalid'); last = t; return t - start >= RESUME_LIMITS.scanMs; };
  const stop = (limit: ResumeSelection['limit']) => { result.incomplete = true; result.limit = limit; return result; };
  let after: string | null = null;
  while (result.work.planSlots < RESUME_LIMITS.planSlots) {
    if (expired()) return stop('time');
    // Keyset and byte admission precede JSON parsing or membership predicates.
    const row: Record<string, SQLOutputValue> | undefined = db.prepare('SELECT id,revision,length(CAST(snapshot AS BLOB)) AS bytes,CASE WHEN length(CAST(snapshot AS BLOB))<=? THEN snapshot ELSE NULL END AS snapshot FROM plans WHERE source=?' + (after === null ? '' : ' AND id>?') + ' ORDER BY id LIMIT 1').get(Math.min(RESUME_LIMITS.snapshotBytes, RESUME_LIMITS.inputBytes - result.work.inputBytes), r.sourceId, ...(after === null ? [] : [after]));
    result.work.planSlots++;
    if (!row) return result;
    need(identifier(row.id) && Number.isSafeInteger(row.revision) && Number(row.revision) > 0 && Number.isSafeInteger(row.bytes) && Number(row.bytes) > 0, 'corrupt');
    after = row.id;
    need(Number(row.bytes) <= RESUME_LIMITS.snapshotBytes, 'corrupt');
    if (Number(row.bytes) > RESUME_LIMITS.inputBytes - result.work.inputBytes) return stop('bytes');
    result.work.inputBytes += Number(row.bytes); result.work.snapshots++;
    let value: unknown;
    try { value = JSON.parse(String(row.snapshot)); } catch { throw new ProgressError('corrupt'); }
    const p = validPlan(value, r.sourceId, row.id, Number(row.revision));
    const cleanup = installed ? db.prepare('SELECT state,generation FROM cleanup_state WHERE source=? AND plan=?').get(r.sourceId, row.id) : undefined;
    if (cleanup) need(['visible','archived','deleted'].includes(String(cleanup.state)) && Number.isSafeInteger(cleanup.generation) && Number(cleanup.generation) > 0 && cleanup.state !== 'deleted', 'corrupt');
    if (expired()) return stop('time');
    if (cleanup?.state === 'archived' || p.lifecycle !== 'active') continue;
    const pointer = { sourceId: r.sourceId, plan: p.id, title: p.title, revision: p.revision };
    let candidate: ResumeCandidate;
    if (r.parentId === null) {
      if (p.sessionId !== r.sessionId) continue;
      candidate = { ...pointer, scope: 'coordinator' };
    } else {
      const link = p.links.find(l => l.sessionId === r.sessionId);
      if (!r.ancestry.includes(p.sessionId) || !link?.itemIds.length) continue;
      if (link.itemIds.length > RESUME_LIMITS.assignments) { result.omitted = true; continue; }
      candidate = { ...pointer, scope: 'assigned', itemIds: [...link.itemIds] };
    }
    if (result.candidates.length === RESUME_LIMITS.candidates) { result.omitted = true; return stop('candidates'); }
    result.candidates.push(candidate);
  }
  return stop('slots');
}
