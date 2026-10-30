// Sub-agent roster: what each child ran (host facts), what it claimed (its own optional handoff) and
// what the plan accepted (explicitly reported task status), kept apart. Pure functions over the run
// read (runs.ts), the host census (census.ts) and the plan detail in scope.
// - a plan in scope is required: without one there is no roster, count or prompt at all
// - only running/waiting and task-linked children are featured; the rest is counted and paged
// - times are real host times (event, end, idle, last update); never when this window received them
// - Running never decays with time: only a host terminal event or a different host activity changes it
// - a finished run is not a finished task, and a claim is not acceptance
import type { RunRow } from '../../shared/subagent-runs.ts';
import { observe, type Census, type ObservedRow, type PlanFacts } from './census.ts';
import type { ItemStatus, PlanView } from './model.ts';
import type { RunsPanel } from './runs.ts';

export type RosterSurface = 'panel' | 'status' | 'page';
export type RanKind = 'active' | 'waiting' | 'idle' | 'finished' | 'failed' | 'interrupted' | 'unknown';
export interface Ran {
  kind: RanKind;
  label: string;
  /** Real host time this label refers to (ms), with how to say it; null when none is known. */
  time: { at: number; prefix: string } | null;
  /** Proven execution duration (start → end), or dispatch → end when only that is known. */
  duration: { ms: number; fromDispatch: boolean } | null;
  /** Where the fact comes from, for the label's tooltip. */
  source: 'event' | 'dispatch' | 'history' | 'host';
}
export interface AcceptedTask { id: string; title: string | null; status: ItemStatus }
export interface SubagentEntry {
  key: string;
  runId: string | null;
  sessionId: string | null;
  title: string;
  agent: string | null;
  depth: number;
  parentTitle: string | null;
  ran: Ran;
  /**
   * The host's current activity when it contradicts a finished latest run: the child is working again
   * (resumed outside a recorded dispatch). The recorded run is never rewritten by it.
   */
  now: { kind: 'active' | 'waiting'; label: string } | null;
  claimed: RunRow['claimed'];
  accepted: { tasks: AcceptedTask[]; omitted: number } | null;
  /** Dispatched while this plan was the parent's only open plan: context, never assignment. */
  duringPlan: boolean;
  historical: boolean;
  openable: boolean;
}
export interface SummaryPart { kind: 'waiting' | 'running' | 'finished' | 'failed' | 'interrupted' | 'unknown'; count: number; text: string }
export type RosterNote =
  | { kind: 'runs-unavailable' } | { kind: 'runs-error' } | { kind: 'capture-off' } | { kind: 'capture-loss' }
  | { kind: 'history-loading' } | { kind: 'history-partial'; token: string | null } | { kind: 'history-failed'; token: string | null }
  | { kind: 'history-off' } | { kind: 'history-unavailable' } | { kind: 'traversal-limit' } | { kind: 'host-gaps' };
export interface Roster {
  /** Featured rows: running/waiting first, then task-linked, bounded per surface. */
  featured: SubagentEntry[];
  /** Everything else loaded so far, in order; the disclosure pages through it. */
  earlier: SubagentEntry[];
  /** Earlier rows known to exist (loaded or not). */
  earlierTotal: number;
  summary: SummaryPart[];
  /** The counts cover recorded runs; `false` when the read is unavailable and only host rows are counted. */
  recorded: boolean;
  /** History reconciliation is still running or incomplete, so counts may grow. */
  soFar: boolean;
  notes: RosterNote[];
  canPage: boolean;
}

/**
 * The host transition sequence current when this window first displayed one execution (keyed by
 * run + start or end event). Only host transitions numbered after it are evidence about that
 * execution. Bounded; a forgotten key is re-taken at the current sequence (stricter, never looser).
 */
export class ExecutionBaselines {
  private readonly at = new Map<string, number>();
  baseline(key: string, current: number) {
    let v = this.at.get(key);
    if (v === undefined) { v = current; this.at.set(key, v); if (this.at.size > 2048) this.at.delete(this.at.keys().next().value!); }
    return v;
  }
}

export interface RosterInput {
  surface: RosterSurface;
  /** The plan in scope; null hides the section entirely. */
  plan: PlanView | null;
  facts: PlanFacts;
  /** Host census of the root (selected session, or the page plan's coordinator). */
  census: Census;
  runs: RunsPanel | null;
  verified: boolean;
  /** Rail/Work Status: the session already open here gets no Open button. */
  currentSession: string | null;
  /** The live workspace's current host transition sequence (LiveSnapshot.seq). */
  liveSeq?: number;
}

/** Featured rows before the rest is folded into the disclosure. */
export const FEATURED: Record<RosterSurface, number> = { panel: 6, status: 3, page: 10 };
/** Earlier rows per disclosure step. */
export const EARLIER_STEP: Record<RosterSurface, number> = { panel: 10, status: 5, page: 20 };

const REASON: Record<string, string> = { user: 'stopped by the user', shutdown: 'the host shut down', superseded: 'replaced by a newer run', inactivity: 'inactive too long', unknown: 'reason not recorded' };

const shortId = (id: string) => `…${id.slice(-6)}`;

/** Ran from a recorded run, refined only by the host's current activity for a still-open run. */
/**
 * `idleAfterStart`: the host was seen going active → idle after this window first displayed this
 * execution's start (rosterFor). Without it an idle snapshot may belong to an earlier execution.
 */
export function ranOf(row: RunRow, host: ObservedRow | null, evidence: { idleAfterStart?: boolean } = {}): Ran {
  const r = row.ran;
  const historical = row.kind === 'historical-session';
  const source: Ran['source'] = r.provenance === 'native-event' ? 'event' : r.provenance === 'native-session' ? 'history' : 'dispatch';
  const end = (label: string, kind: RanKind): Ran => {
    const start = r.startedAt ?? (historical ? null : row.dispatch?.at ?? null);
    const duration = r.endedAt !== null && start !== null && r.endedAt >= start ? { ms: r.endedAt - start, fromDispatch: r.startedAt === null } : null;
    return { kind, label, time: r.endedAt !== null ? { at: r.endedAt, prefix: '' } : { at: r.updatedAt, prefix: 'last updated ' }, duration, source };
  };
  if (r.state === 'succeeded') return end('Finished', 'finished');
  if (r.state === 'failed') return end(r.errorType && r.errorType !== 'unknown' ? `Failed: ${r.errorType}` : 'Failed', 'failed');
  if (r.state === 'interrupted') return end(`Interrupted: ${REASON[r.interruptionReason ?? 'unknown']}`, 'interrupted');
  // Open run (or no outcome yet): the host's current activity may say more, never less.
  const o = host ? observe(host) : null;
  const started = r.startedAt !== null ? { at: r.startedAt, prefix: 'started ' } : row.dispatch ? { at: row.dispatch.at, prefix: 'dispatched ' } : null;
  if (o?.kind === 'waiting') return { kind: 'waiting', label: o.label, time: started, duration: null, source: 'host' };
  if (r.state === 'running') {
    // An idle/completed snapshot alone may be the cached result of the child's previous execution:
    // only an active → idle change seen after this execution's start is newer evidence. It updates
    // the word, not the outcome: no end time, no success.
    if (evidence.idleAfterStart && o && (o.kind === 'idle' || o.kind === 'ended' || o.kind === 'failed')) return { kind: 'idle', label: 'Idle now, no outcome reported yet', time: started, duration: null, source: 'host' };
    return { kind: 'active', label: 'Running', time: started, duration: null, source };
  }
  if (o?.kind === 'active') return { kind: 'active', label: o.label, time: started, duration: null, source: 'host' };
  if (historical) return { kind: 'unknown', label: 'Outcome unknown', time: { at: r.updatedAt, prefix: 'last updated ' }, duration: null, source };
  const label = r.dispatchState === 'pending' ? 'Dispatched, not confirmed yet' : r.dispatchState === 'failed-unconfirmed' ? 'Dispatch failed before a run was confirmed' : r.dispatchState === 'unconfirmed' ? 'Not confirmed by the host' : 'No outcome reported';
  return { kind: 'unknown', label, time: started, duration: null, source };
}

/** Ran for a child the host lists now but no run record covers. No time: only the host's word. */
export function hostRan(r: ObservedRow): Ran {
  const o = observe(r);
  const kind: RanKind = o.kind === 'active' ? 'active' : o.kind === 'waiting' ? 'waiting' : o.kind === 'unknown' ? 'unknown' : 'idle';
  return { kind, label: o.label, time: null, duration: null, source: 'host' };
}

const taskTitles = (facts: PlanFacts) => new Map(facts.kind === 'complete' ? facts.detail.items.map((i) => [i.id, i.title] as const) : []);

/** Task facts belong to the child, so only its latest run (or its host-only row) carries them. */
function acceptedOf(row: RunRow | null, sessionId: string | null, plan: PlanView, facts: PlanFacts): SubagentEntry['accepted'] {
  const titles = taskTitles(facts);
  if (row?.accepted && row.accepted.plan === plan.id) {
    if (!row.accepted.items.length && !row.accepted.omittedItems) return null;
    return { tasks: row.accepted.items.map((i) => ({ id: i.id, title: titles.get(i.id) ?? null, status: i.status })), omitted: row.accepted.omittedItems };
  }
  // Explicitly reported task facts of the plan shown, from its complete current-revision detail.
  if (!sessionId || facts.kind !== 'complete') return null;
  const tasks = facts.detail.items.filter((i) => i.kind === 'task' && i.assigneeSessionId === sessionId);
  return tasks.length ? { tasks: tasks.map((i) => ({ id: i.id, title: i.title, status: i.status })), omitted: 0 } : null;
}

const liveKind = (e: SubagentEntry) => e.now?.kind ?? (e.ran.kind === 'active' || e.ran.kind === 'waiting' ? e.ran.kind : null);
const featuredKind = (e: SubagentEntry) => liveKind(e) !== null || (e.ran.kind === 'idle' && e.runId !== null);
const rank = (e: SubagentEntry) => (liveKind(e) === 'waiting' ? 0 : featuredKind(e) ? 1 : 2);
const when = (e: SubagentEntry) => e.ran.time?.at ?? 0;

/** The roster of one root with a plan in scope, or null: nothing to show on this surface. */
export function rosterFor(v: RosterInput): Roster | null {
  if (!v.plan || !v.verified) return null;
  const plan = v.plan;
  const runs = v.runs;
  const runRows = runs?.state === 'ready' ? [...runs.featured, ...runs.more] : [];
  const featuredIds = new Set(runs?.state === 'ready' ? runs.featured.map((r) => r.id) : []);
  const census = v.census.state === 'ready' ? v.census : null;
  const host = new Map((census?.rows ?? []).map((r) => [r.id, r] as const));
  const titles = new Map<string, string>([...(census ? [[census.root.id, census.root.title] as const] : []), ...(census?.rows ?? []).map((r) => [r.id, r.title] as const)]);
  for (const r of runRows) if (r.childSessionId && r.description && !titles.has(r.childSessionId)) titles.set(r.childSessionId, r.description);
  const rootId = census?.rootId ?? null;
  // Host activity belongs to the latest recorded dispatch of that child only.
  const latest = new Map<string, RunRow>();
  for (const r of runRows) if (r.childSessionId) { const l = latest.get(r.childSessionId); if (!l || (r.dispatch?.at ?? r.ran.updatedAt) > (l.dispatch?.at ?? l.ran.updatedAt)) latest.set(r.childSessionId, r); }
  // Only a child ID on the record correlates a run with a host session. A dispatch without one
  // and a new host child stay separate rows, however likely they look like the same work.
  const covered = new Set(latest.keys());
  // Execution-scoped evidence: a host transition counts for an execution only if numbered after the
  // sequence current when this window first displayed that execution's start (or its end). Without
  // baselines nothing qualifies.
  const baselines = runs?.baselines ?? null, seq = v.liveSeq ?? 0;
  const after = (key: string, mark: number | undefined) => !!baselines && baselines.baseline(key, seq) < (mark ?? -1);
  const openable = (id: string | null) => !!id && host.has(id) && id !== v.currentSession;
  const entries: SubagentEntry[] = runRows.map((r) => {
    const sessionId = r.childSessionId;
    const isLatest = !!sessionId && latest.get(sessionId) === r;
    const h = isLatest ? host.get(sessionId!) ?? null : null;
    const nested = r.parentSessionId !== rootId && r.parentSessionId !== v.currentSession;
    const ended = r.ran.state === 'succeeded' || r.ran.state === 'failed' || r.ran.state === 'interrupted';
    const execution = `${r.id}|${ended ? 'end' : 'start'}|${(ended ? r.ran.endedAt : r.ran.startedAt) ?? 'none'}|${r.ran.eventId ?? 'none'}`;
    // Take the baseline at first display, with or without host data yet.
    const idleAfterStart = r.ran.state === 'running' && after(execution, h?.idleSeq);
    // "Again" needs an idle → active change seen after the terminal fact: a still-cached Running
    // snapshot of the same execution is not a resume and is not shown or counted.
    const resumed = ended && after(execution, h?.activeSeq);
    const ran = ranOf(r, h, { idleAfterStart });
    const o = h ? observe(h) : null;
    const now = resumed && o && (o.kind === 'active' || o.kind === 'waiting') ? { kind: o.kind, label: o.label } : null;
    return {
      key: r.id, runId: r.id, sessionId, title: r.description || (sessionId ? titles.get(sessionId) : null) || r.agent || (sessionId ? `Session ${shortId(sessionId)}` : 'Sub-agent'),
      agent: r.agent, depth: h?.depth ?? (nested ? 2 : 1), parentTitle: nested ? titles.get(r.parentSessionId) ?? `Session ${shortId(r.parentSessionId)}` : null,
      ran, now, claimed: r.claimed, accepted: isLatest || !sessionId ? acceptedOf(r, sessionId, plan, v.facts) : null, duringPlan: r.planContext?.plan === plan.id,
      historical: r.kind === 'historical-session', openable: v.verified && openable(sessionId),
    };
  });
  // Children the host lists now without a run record: only when they are active, waiting, or hold
  // explicitly reported tasks of this plan. Idle unlinked ones are history the run read owns.
  const hostOnly: SubagentEntry[] = [];
  for (const h of host.values()) {
    if (covered.has(h.id)) continue;
    const ran = hostRan(h), accepted = acceptedOf(null, h.id, plan, v.facts);
    if (ran.kind !== 'active' && ran.kind !== 'waiting' && !accepted) continue;
    hostOnly.push({ key: `host-${h.id}`, runId: null, sessionId: h.id, title: h.title.trim() || `Session ${shortId(h.id)}`, agent: null, depth: h.depth,
      parentTitle: h.depth > 1 && h.parentId ? titles.get(h.parentId) ?? null : null, ran, now: null, claimed: null, accepted, duringPlan: false, historical: false, openable: v.verified && openable(h.id) });
  }
  // Featured: from the first useful page or the host now; later pages stay in the earlier list.
  const candidates = [...entries.filter((e) => e.runId && featuredIds.has(e.runId)), ...hostOnly];
  const lead = candidates.filter((e) => featuredKind(e) || e.accepted).sort((a, b) => rank(a) - rank(b) || when(b) - when(a));
  const cap = FEATURED[v.surface];
  const featured = lead.slice(0, cap);
  const shown = new Set(featured.map((e) => e.key));
  const earlier = [...lead.slice(cap), ...entries.filter((e) => !shown.has(e.key) && !lead.includes(e))];

  const read = runs?.state === 'ready' ? runs.read : null;
  const waiting = [...featured, ...earlier].filter((e) => liveKind(e) === 'waiting');
  const activeHost = [...entries, ...hostOnly].filter((e) => liveKind(e) !== null && (!e.runId || runRows.find((r) => r.id === e.runId)?.ran.state !== 'running'));
  const pendingShown = [...entries].filter((e) => (e.ran.kind === 'active' || e.ran.kind === 'waiting') && runRows.find((r) => r.id === e.runId)?.ran.state === 'unknown').length;
  const summary: SummaryPart[] = [];
  const add = (kind: SummaryPart['kind'], count: number, text: string) => { if (count > 0) summary.push({ kind, count, text }); };
  add('waiting', waiting.length, `${waiting.length} waiting on you`);
  if (read) {
    const running = Math.max(0, read.counts.running + activeHost.length - waiting.length);
    add('running', running, `${running} running`);
    add('finished', read.counts.succeeded, `${read.counts.succeeded} finished`);
    add('failed', read.counts.failed, `${read.counts.failed} failed`);
    add('interrupted', read.counts.interrupted, `${read.counts.interrupted} interrupted`);
    const unknown = Math.max(0, read.counts.unknown - pendingShown);
    add('unknown', unknown, `${unknown} unknown`);
  } else {
    const running = activeHost.length - waiting.length;
    add('running', running, `${running} running`);
  }

  const notes: RosterNote[] = [];
  if (!runs || runs.state === 'unavailable' || read?.availability === 'unavailable') notes.push({ kind: 'runs-unavailable' });
  else if (runs.state === 'error') notes.push({ kind: 'runs-error' });
  if (read) {
    if (!read.capture.enabled) notes.push({ kind: 'capture-off' });
    if (read.capture.loss) notes.push({ kind: 'capture-loss' });
    const rec = read.recovery;
    if (rec.state === 'pending' || rec.state === 'running' || runs?.reconciling) notes.push({ kind: 'history-loading' });
    else if (rec.state === 'partial') notes.push({ kind: 'history-partial', token: rec.token });
    else if (rec.state === 'failed') notes.push(rec.reason === 'capture-disabled' ? { kind: 'history-off' } : { kind: 'history-failed', token: rec.token });
    else if (rec.state === 'not-requested' && !read.capture.enabled) notes.push({ kind: 'history-off' });
    else if (rec.state === 'unavailable') notes.push({ kind: 'history-unavailable' });
    if (read.coverage.reasons.includes('traversal-limit')) notes.push({ kind: 'traversal-limit' });
  }
  if (census && census.gaps.some((g) => g === 'conflict' || g === 'cycle' || g === 'records' || g === 'depth')) notes.push({ kind: 'host-gaps' });

  const total = read ? read.counts.runs + read.counts.historicalSessions : 0;
  const featuredRuns = featured.filter((e) => e.runId).length;
  const earlierTotal = read ? Math.max(earlier.length, total - featuredRuns) : earlier.length;
  // Nothing useful to show with the plan in scope: no section either. Notes alone (history still
  // loading, an unavailable read) never make one appear.
  if (!featured.length && !earlierTotal && !summary.length) return null;
  const soFar = !!read && (read.recovery.state === 'pending' || read.recovery.state === 'running' || !!runs?.reconciling);
  return { featured, earlier, earlierTotal, summary, recorded: !!read, soFar, notes, canPage: !!runs?.hasMore };
}
