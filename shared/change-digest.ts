import { countItems, identifier, LIMITS, type Counts, type Item, type Lifecycle, type Status } from './progress.ts';

export const DIGEST_LIMITS = { snapshots: 128, bytes: 8 * 1024 * 1024, tasks: 50, references: 4, responseBytes: 256 * 1024 } as const;
export type DigestFacet = 'added' | 'removed' | 'revised' | 'completed' | 'reopened' | 'blocked' | 'unblocked' | 'skipped' | 'unskipped';
export type DigestReason = 'gap' | 'missing-snapshot' | 'invalid-snapshot' | 'revision-bound' | 'byte-bound';
export type DigestEvents = Record<DigestFacet, number>;
export interface DigestFacts { title: string; status: Status; parentId: string | null; dependencies: string[] }
export interface DigestReference { from: number; to: number; reportedAt: string; facets: DigestFacet[]; before: DigestFacts | null; after: DigestFacts | null }
export interface DigestTask { id: string; title: string; status: Status; presentAtTarget: boolean; latestRevision: number; occurrences: DigestEvents; references: DigestReference[]; omittedReferences: number }
export interface DigestSnapshot { id: string; sourceId: string; revision: number; structuralRevision: number; lifecycle: Lifecycle; reportedAt: string; items: Item[] }
export interface DigestScope {
  addedCounted: number; removedCounted: number; skipped: number; unskipped: number;
  addedDone: number; removedDone: number; completed: number; reopened: number;
}
export interface ChangeDigest {
  protocolVersion: 2; schemaVersion: 2; storeId: string;
  sourceBinding: { sourceId: string | null; verified: boolean };
  source: string; plan: string; cleanup: { state: 'visible' | 'archived'; revision: number };
  interval: { after: number | null; to: number; targetLifecycle: Lifecycle | null; targetReportedAt: string | null; latestRevision: number; currentLifecycle: Lifecycle; coverageStart: number | null; coverageEnd: number | null; coverageStartReportedAt: string | null; coverageEndReportedAt: string | null };
  availability: 'initial' | 'comparison' | 'baseline-unavailable' | 'target-unavailable';
  complete: boolean; reasons: DigestReason[]; validTarget: boolean;
  counts: { before: Counts | null; after: Counts | null; scope: DigestScope | null };
  summary: { unit: 'transitions'; events: DigestEvents };
  tasks: DigestTask[];
  details: { omittedTasks: boolean; omittedTaskCount: number | null; truncated: boolean };
  work: { intervalSnapshots: number; baselineLookups: number; inputBytes: number };
}
export function emptyEvents(): DigestEvents { return { added: 0, removed: 0, revised: 0, completed: 0, reopened: 0, blocked: 0, unblocked: 0, skipped: 0, unskipped: 0 }; }
const facts = (i: Item): DigestFacts => ({ title: i.title, status: i.status, parentId: i.parentId ?? null, dependencies: [...new Set(i.dependencies ?? [])].sort() });
const tasks = (p: DigestSnapshot) => new Map(p.items.filter(i => i.kind === 'task').map(i => [i.id, i]));
export function compareTasks(before: DigestSnapshot, after: DigestSnapshot): { id: string; reference: DigestReference }[] {
  const a = tasks(before), b = tasks(after), changes: { id: string; reference: DigestReference }[] = [];
  for (const id of [...new Set([...a.keys(), ...b.keys()])].sort()) {
    const old = a.get(id), next = b.get(id), facets: DigestFacet[] = [];
    if (!old) { facets.push('added'); if (next!.status === 'blocked') facets.push('blocked'); }
    else if (!next) facets.push('removed');
    else {
      if (old.status !== 'done' && next.status === 'done') facets.push('completed');
      if (old.status === 'done' && next.status !== 'done') facets.push('reopened');
      if (old.status !== 'blocked' && next.status === 'blocked') facets.push('blocked');
      if (old.status === 'blocked' && next.status !== 'blocked') facets.push('unblocked');
      if (old.status !== 'skipped' && next.status === 'skipped') facets.push('skipped');
      if (old.status === 'skipped' && next.status !== 'skipped') facets.push('unskipped');
      const x = facts(old), y = facts(next);
      if (x.title !== y.title || x.parentId !== y.parentId || JSON.stringify(x.dependencies) !== JSON.stringify(y.dependencies)) facets.push('revised');
    }
    if (facets.length) changes.push({ id, reference: { from: before.revision, to: after.revision, reportedAt: after.reportedAt, facets, before: old ? facts(old) : null, after: next ? facts(next) : null } });
  }
  return changes;
}
/** Endpoint causes are independent of the proven transition suffix. */
export function endpointCounts(before: DigestSnapshot, after: DigestSnapshot): ChangeDigest['counts'] {
  const scope: DigestScope = { addedCounted: 0, removedCounted: 0, skipped: 0, unskipped: 0, addedDone: 0, removedDone: 0, completed: 0, reopened: 0 };
  const a = tasks(before), b = tasks(after);
  for (const id of new Set([...a.keys(), ...b.keys()])) {
    const old = a.get(id), next = b.get(id);
    if (!old) { if (next!.status !== 'skipped') scope.addedCounted++; if (next!.status === 'done') scope.addedDone++; }
    else if (!next) { if (old.status !== 'skipped') scope.removedCounted++; if (old.status === 'done') scope.removedDone++; }
    else {
      if (old.status !== 'skipped' && next.status === 'skipped') scope.skipped++;
      if (old.status === 'skipped' && next.status !== 'skipped') scope.unskipped++;
      if (old.status !== 'done' && next.status === 'done') scope.completed++;
      if (old.status === 'done' && next.status !== 'done') scope.reopened++;
    }
  }
  return { before: countItems(before.items), after: countItems(after.items), scope };
}
/** Descending adjacent pairs only; retains identities for the most recent 50 tasks. */
export function aggregatePair(result: ChangeDigest, before: DigestSnapshot, after: DigestSnapshot, target: DigestSnapshot) {
  for (const { id, reference } of compareTasks(before, after)) {
    for (const facet of reference.facets) result.summary.events[facet]++;
    let row = result.tasks.find(t => t.id === id);
    if (!row && result.tasks.length >= DIGEST_LIMITS.tasks) { result.details.omittedTasks = true; result.details.omittedTaskCount = null; result.details.truncated = true; continue; }
    if (!row) {
      const atTarget = target.items.find(i => i.id === id && i.kind === 'task');
      const latest = atTarget ?? reference.after ?? reference.before!;
      row = { id, title: latest.title, status: latest.status, presentAtTarget: !!atTarget, latestRevision: after.revision, occurrences: emptyEvents(), references: [], omittedReferences: 0 };
      result.tasks.push(row);
    }
    for (const facet of reference.facets) row.occurrences[facet]++;
    if (row.references.length < DIGEST_LIMITS.references) row.references.push(reference);
    else { row.omittedReferences++; result.details.truncated = true; }
  }
}
/** Reject JSON-valid but unusable history. Only bounded, public comparison facts escape. */
export function validateDigestSnapshot(value: unknown, source: string, plan: string, revision: number): DigestSnapshot | null {
  try {
    const p = value as DigestSnapshot;
    if (!p || p.id !== plan || p.sourceId !== source || p.revision !== revision || !Number.isSafeInteger(revision) || revision < 1 || !Number.isSafeInteger(p.structuralRevision) || p.structuralRevision < 1 || p.structuralRevision > revision || !['active','finished','cancelled','failed'].includes(p.lifecycle) || typeof p.reportedAt !== 'string' || !Number.isFinite(Date.parse(p.reportedAt)) || new Date(p.reportedAt).toISOString() !== p.reportedAt || !Array.isArray(p.items) || p.items.length > LIMITS.planItems) return null;
    const byId = new Map<string, Item>();
    for (const i of p.items) {
      if (!i || !identifier(i.id) || byId.has(i.id) || typeof i.title !== 'string' || !i.title.trim() || i.title.length > 512 || !['task','group'].includes(i.kind) || !['pending','working','blocked','done','skipped'].includes(i.status) || i.parentId !== undefined && !identifier(i.parentId) || i.dependencies !== undefined && (!Array.isArray(i.dependencies) || i.dependencies.length > 16 || !i.dependencies.every(identifier))) return null;
      byId.set(i.id, i);
    }
    for (const i of p.items) {
      if (i.parentId !== undefined && byId.get(i.parentId)?.kind !== 'group' || (i.dependencies ?? []).some(id => id === i.id || byId.get(id)?.kind !== 'task')) return null;
      const seen = new Set([i.id]); let parent = i.parentId;
      while (parent) { if (seen.has(parent)) return null; seen.add(parent); parent = byId.get(parent)?.parentId; }
    }
    const visiting = new Set<string>(), visited = new Set<string>();
    const visit = (id: string): boolean => { if (visited.has(id)) return true; if (visiting.has(id)) return false; visiting.add(id); for (const dep of byId.get(id)?.dependencies ?? []) if (!visit(dep)) return false; visiting.delete(id); visited.add(id); return true; };
    if (!p.items.every(i => visit(i.id))) return null;
    return { id: p.id, sourceId: p.sourceId, revision, structuralRevision: p.structuralRevision, lifecycle: p.lifecycle, reportedAt: p.reportedAt, items: p.items.map(i => ({ id: i.id, title: i.title, kind: i.kind, status: i.status, ...(i.parentId !== undefined ? { parentId: i.parentId } : {}), ...(i.dependencies ? { dependencies: [...i.dependencies] } : {}) })) };
  } catch { return null; }
}
export function capDigest(result: ChangeDigest): ChangeDigest {
  // Counts and summary survive detail trimming. UTF-8 bytes, not string length.
  while (Buffer.byteLength(JSON.stringify(result)) > DIGEST_LIMITS.responseBytes && result.tasks.length) {
    result.tasks.pop(); result.details.truncated = true; result.details.omittedTasks = true;
    if (result.details.omittedTaskCount !== null) result.details.omittedTaskCount++;
  }
  return result;
}
