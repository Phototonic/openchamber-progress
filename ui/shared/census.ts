// Sub-agent census: the explicit root session and its verified native descendants, from current
// workspace metadata only. Pure functions over the live snapshot; app.ts owns subscriptions.
// - lineage is exact parentId only, inside the root's own project stream; never titles, directories
//   or order. Directory metadata may only pick which existing project stream holds the root.
// - observation is not progress: activity says what the host last observed for that session, never
//   that a task advanced, finished or was accepted. A completed turn is "turn ended", not success
//   (native interruption also reports completed).
// - freshness: activity is current for 60 s after its last qualifying receipt (live.ts), and unknown
//   at once when the stream or its coverage is no longer ready. Only the workspace subscription says
//   that; the ready context's `connection` is the integration link, not host transport. No heartbeat
//   exists, so a cached ready snapshot during an outage turns unknown only through this expiry.
// - bounds (A5): 2,000 records visited, depth 32, 128 retained rows; any cap is a visible gap.
import { directoryKey } from './path.ts';
import { planProject, type Activity, type LiveProject, type LiveSession, type LiveSnapshot } from './live.ts';
import type { ItemView, PlanDetail, PlanView } from './model.ts';

export const FRESH_MS = 60_000;
export const CENSUS_LIMITS = { records: 2000, depth: 32, rows: 128 } as const;

/**
 * Why a census is not complete. `coverage`: a directory of the project is still loading, failed or
 * not reported. `records`/`depth`/`rows`: a bound was reached. `conflict`: a duplicate ID, a session
 * of another project, or one another project stream lists with a different identity; that session
 * and its subtree are left out. `cycle`: the root's own parent links loop back to it, so no
 * descendant can be verified and none is listed.
 */
export type CensusGap = 'coverage' | 'records' | 'depth' | 'rows' | 'conflict' | 'cycle';

export interface ObservedRow {
  id: string;
  parentId: string | null;
  /** 0 for the root; 1 for its direct children. */
  depth: number;
  title: string;
  activity: Activity;
  outcome: 'completed' | 'failed' | null;
  archived: boolean;
  seenAt?: number;
  seenMono?: number;
}

export type Census =
  /** No explicit root: draft, null selection, or a page without a selected plan. */
  | { state: 'none' }
  /** Workspace streams are starting or the root's project stream is not open yet. */
  | { state: 'loading'; rootId: string }
  /** The host refused the stream, or the root's project is outside the watched set. */
  | { state: 'unavailable'; rootId: string; reason: 'error' | 'not-watched' | 'no-project' }
  /** The root's project stream is ready but does not list this session (or lists it ambiguously). */
  | { state: 'not-seen'; rootId: string; project: LiveProject }
  | { state: 'ready'; rootId: string; project: LiveProject; root: ObservedRow; rows: ObservedRow[]; omitted: number; gaps: CensusGap[] };

export const isComplete = (c: Census) => c.state === 'ready' && c.gaps.length === 0;

const row = (r: LiveSession, depth: number): ObservedRow => ({
  id: r.id, parentId: r.parentId, depth, title: r.title, activity: r.activity, outcome: r.outcome,
  archived: r.archivedAt !== null, seenAt: r.seenAt, seenMono: r.seenMono,
});

/**
 * The root and its descendants by exact parentId within the root's project stream, in depth-first
 * order (siblings by host creation time, then ID, so rows do not jump on activity changes).
 */
export function censusFor(rootId: string | null | undefined, directory: string | null | undefined, live: LiveSnapshot): Census {
  if (!rootId) return { state: 'none' };
  if (live.projectsState === 'off' || live.projectsState === 'loading') return { state: 'loading', rootId };
  if (live.projectsState === 'error') return { state: 'unavailable', rootId, reason: 'error' };
  const project = planProject(rootId, directory ?? '', live);
  if (!project) return { state: 'unavailable', rootId, reason: 'no-project' };
  if (live.capped.includes(project.id)) return { state: 'unavailable', rootId, reason: 'not-watched' };
  const entry = live.sessions.get(project.id);
  // A loading stream with retained rows is the host reloading the same subscription (live.ts):
  // the rows stay listed, but as partial coverage, so nothing in them is current meanwhile.
  if (!entry || (entry.state === 'loading' && !entry.records.length)) return { state: 'loading', rootId };
  if (entry.state === 'error') return { state: 'unavailable', rootId, reason: 'error' };
  const gaps = new Set<CensusGap>();
  if (entry.state !== 'ready' || !entry.coverage || entry.coverage.some((c) => c.state !== 'ready')) gaps.add('coverage');
  let records = entry.records;
  if (records.length > CENSUS_LIMITS.records) { gaps.add('records'); records = records.slice(0, CENSUS_LIMITS.records); }
  const byId = new Map<string, LiveSession | null>();
  for (const r of records) byId.set(r.id, byId.has(r.id) ? null : r);
  const rootRecord = byId.get(rootId);
  // Identities other project streams give these IDs: the same ID with another project or directory
  // is not one host session, so it gets no row, navigation or assignment here.
  const others = new Map<string, LiveSession[]>();
  for (const [pid, e] of live.sessions) if (pid !== project.id) for (const r of e.records) if (byId.has(r.id)) others.set(r.id, [...(others.get(r.id) ?? []), r]);
  const conflicted = (r: LiveSession) => r.projectId !== project.id || (others.get(r.id) ?? []).some((o) => o.projectId !== r.projectId || directoryKey(o.directory) !== directoryKey(r.directory));
  if (!rootRecord || conflicted(rootRecord)) return { state: 'not-seen', rootId, project };
  // The root's own parent chain must not loop back to it (self-parent included): in a cyclic
  // component no parent link ends at a real root, so no descendant is verified.
  const up = new Set<string>();
  for (let p = rootRecord.parentId; p && !up.has(p); p = byId.get(p)?.parentId ?? null) {
    if (p === rootId) return { state: 'ready', rootId, project, root: row(rootRecord, 0), rows: [], omitted: 0, gaps: [...gaps, 'cycle'] };
    up.add(p);
  }
  const children = new Map<string, LiveSession[]>();
  for (const [id, r] of byId) {
    if (r === null) { gaps.add('conflict'); continue; }
    if (!r.parentId || id === rootId) continue;
    const list = children.get(r.parentId);
    if (list) list.push(r); else children.set(r.parentId, [r]);
  }
  for (const list of children.values()) list.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const rows: ObservedRow[] = [];
  let omitted = 0;
  const visited = new Set([rootId]);
  const visit = (parent: string, depth: number) => {
    for (const child of children.get(parent) ?? []) {
      if (visited.has(child.id)) { gaps.add('conflict'); continue; }
      visited.add(child.id);
      // A conflicting identity leaves out the session and everything under it.
      if (conflicted(child)) { gaps.add('conflict'); continue; }
      if (depth > CENSUS_LIMITS.depth) { gaps.add('depth'); continue; }
      if (rows.length < CENSUS_LIMITS.rows) rows.push(row(child, depth));
      else { omitted++; gaps.add('rows'); }
      visit(child.id, depth + 1);
    }
  };
  visit(rootId, 1);
  return { state: 'ready', rootId, project, root: row(rootRecord, 0), rows, omitted, gaps: [...gaps] };
}

/**
 * What the host last observed for one session. `kind` gives the shape/word, never colour alone.
 * `fresh` false: current activity is unknown; `last` keeps the last observed words for context.
 * `expiresAt` (monotonic): when a fresh label must turn unknown without a repaint.
 */
export type ObservationKind = 'active' | 'waiting' | 'idle' | 'ended' | 'failed' | 'unknown';
export interface Observation { kind: ObservationKind; label: string; fresh: boolean; last: string | null; expiresAt: number | null }

const BASE: Record<Activity, { kind: ObservationKind; label: string }> = {
  running: { kind: 'active', label: 'Running' },
  retrying: { kind: 'active', label: 'Retrying' },
  'waiting-permission': { kind: 'waiting', label: 'Waiting for permission' },
  'waiting-question': { kind: 'waiting', label: 'Waiting for an answer' },
  idle: { kind: 'idle', label: 'Idle' },
  unknown: { kind: 'unknown', label: 'State unknown' },
};

function base(r: Pick<ObservedRow, 'activity' | 'outcome'>) {
  // A finished turn is all the host can tell: cancellation also reports "completed".
  if (r.activity === 'idle' && r.outcome === 'failed') return { kind: 'failed' as const, label: 'Turn failed' };
  if (r.activity === 'idle' && r.outcome === 'completed') return { kind: 'ended' as const, label: 'Turn ended' };
  return BASE[r.activity] ?? BASE.unknown;
}

export const UNKNOWN_NOW = 'Unknown now';

export function observe(r: Pick<ObservedRow, 'activity' | 'outcome' | 'seenMono'>, mono: number, current: boolean): Observation {
  const b = base(r);
  if (b.kind === 'unknown') return { ...b, fresh: false, last: null, expiresAt: null };
  if (!current || r.seenMono === undefined || mono - r.seenMono >= FRESH_MS) return { kind: 'unknown', label: UNKNOWN_NOW, fresh: false, last: b.label, expiresAt: null };
  return { ...b, fresh: true, last: null, expiresAt: r.seenMono + FRESH_MS };
}

/** Rows whose activity may be shown as current: the census stream is ready and fully covered. */
export const currentFor = (c: Census) => c.state === 'ready' && !c.gaps.includes('coverage');

/** One plan's recorded facts this view can compare a child with. */
/** Facts of the plan a view shows, from its complete current-revision detail only. */
export function planFacts(plan: PlanView | null, detail: { state: string; value?: PlanDetail } | null, boundSource: string | null): PlanFacts {
  if (!plan) return { kind: 'no-plan' };
  // Session IDs are only meaningful within one source: another setup's plan can't
  // say anything about this host's children, even when the IDs collide.
  if (boundSource === null || plan.sourceId !== boundSource) return { kind: 'unknown', plan };
  return detail?.state === 'ready' && detail.value && detail.value.revision === plan.revision ? { kind: 'complete', plan, detail: detail.value } : { kind: 'unknown', plan };
}

export type PlanFacts =
  | { kind: 'no-plan' }
  | { kind: 'unknown'; plan: PlanView }
  | { kind: 'complete'; plan: PlanView; detail: PlanDetail };

export type AssignmentFact =
  | { state: 'assigned'; count: number; fromDelegation: number }
  | { state: 'unassigned' }
  | { state: 'unknown' }
  | { state: 'no-plan' };
export type UpdateFact = { state: 'direct' | 'relayed'; at: string | null } | { state: 'none' } | { state: 'unknown' };

/**
 * Assignment from current recorded task facts only (assignee of a task in this plan), with the
 * count bound from a delegation (validated current provenance). Missing or partial detail is
 * unknown, never unassigned; no plan in scope claims nothing about other plans.
 */
export function assignmentOf(sessionId: string, facts: PlanFacts): AssignmentFact {
  if (facts.kind === 'no-plan') return { state: 'no-plan' };
  if (facts.kind === 'unknown') return { state: 'unknown' };
  const tasks = facts.detail.items.filter((i) => i.kind === 'task' && i.assigneeSessionId === sessionId);
  if (!tasks.length) return { state: 'unassigned' };
  return { state: 'assigned', count: tasks.length, fromDelegation: tasks.filter((i) => delegated(i, sessionId, facts.detail.revision)).length };
}

const delegated = (i: ItemView, sessionId: string, revision: number) => !!i.delegation && i.delegation.childSessionId === sessionId && i.delegation.validAtRevision === revision;

/** Report attribution for this session in this plan: its latest direct or parent-relayed update. */
export function updateOf(sessionId: string, facts: PlanFacts): UpdateFact {
  if (facts.kind !== 'complete') return { state: facts.kind === 'no-plan' ? 'none' : 'unknown' };
  let latest: { mode: 'direct' | 'parent-relay'; revision: number; at: string | null } | null = null;
  for (const c of facts.detail.contributions) {
    if (c.attributedSessionId !== sessionId) continue;
    if (!latest || c.revision >= latest.revision) latest = { mode: c.mode, revision: c.revision, at: c.reportedAt ?? null };
  }
  if (latest) return { state: latest.mode === 'parent-relay' ? 'relayed' : 'direct', at: latest.at };
  // A recorded reporter without a contribution still reported directly; its time is unknown.
  if (facts.detail.items.some((i) => i.kind === 'task' && i.reporterSessionId === sessionId)) return { state: 'direct', at: null };
  return { state: 'none' };
}
