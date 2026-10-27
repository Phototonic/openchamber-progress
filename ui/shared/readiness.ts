// Task readiness: a pure, read-only projection of one active plan's complete detail.
// Only recorded direct prerequisites count. Nothing here changes item status, counts or
// assignments, and nothing is inferred from activity, age, ancestry, titles or directories.
import type { ContributionView, ItemStatus, ItemView, Lifecycle, PlanDetail } from './model.ts';

export type ReadinessGroup = 'ready' | 'waiting' | 'skipped' | 'blocked';

/**
 * One recorded prerequisite as the detail describes it. `task`: a task in this plan with its
 * reported status. `not-task`: the ID names a group, which can never satisfy a task prerequisite.
 * `unresolved`: no item in this plan has that ID; there is no title and no destination.
 */
export type Prerequisite =
  | { kind: 'task'; id: string; title: string; status: ItemStatus }
  | { kind: 'not-task'; id: string; title: string }
  | { kind: 'unresolved'; id: string };

/** Parent context: top level, a known parent, or a recorded parent this detail does not contain. */
export type ParentContext = { kind: 'none' } | { kind: 'known'; id: string; title: string } | { kind: 'unknown'; id: string };

/** Who reported this task, as recorded. A relay names both its reporter and the attributed child. */
export interface ReportView { mode: ContributionView['mode']; reporterSessionId: string; attributedSessionId: string }

export interface ReadinessEntry {
  item: ItemView;
  group: ReadinessGroup;
  parent: ParentContext;
  /** Every recorded prerequisite in recorded order, including done ones. */
  prerequisites: Prerequisite[];
  /** `omitted` and `empty` both read as "No prerequisites recorded", never "none exist". */
  recorded: 'omitted' | 'empty' | 'listed';
  /** A recorded prerequisite could not be resolved to a task of this plan. */
  incomplete: boolean;
  /** Recorded assignee only (`assigneeSessionId`), never a link, owner or reporter fallback. */
  assigneeSessionId: string | null;
  /**
   * Sessions the plan's session links associate with this task, only when no assignee is recorded.
   * Context for display, never an assignment: `assignment()` ignores it.
   */
  linkedSessionIds: string[];
  reports: ReportView[];
}

export type InvalidReason = 'duplicate-id' | 'self-dependency' | 'cycle';

export type Readiness =
  /** Finished, cancelled or failed: no readiness section at all. */
  | { state: 'closed' }
  /** Detail missing, pending or for another plan/revision: nothing to classify yet. */
  | { state: 'loading' }
  /** Detail read failed (including cap exhaustion and exhausted restarts). */
  | { state: 'unavailable' }
  /** The snapshot's relations are inconsistent; no task can be classified from it. */
  | { state: 'invalid'; reason: InvalidReason }
  | { state: 'ready'; key: string; revision: number; groups: Record<ReadinessGroup, ReadinessEntry[]>; incomplete: boolean };

type DetailState = { state: 'loading' } | { state: 'ready'; value: PlanDetail } | { state: 'error' };

/** First structural problem that makes readiness unavailable, or null. Bounded O(items + edges). */
export function invalidReason(items: readonly ItemView[]): InvalidReason | null {
  const byId = new Map<string, ItemView>();
  for (const item of items) {
    if (byId.has(item.id)) return 'duplicate-id';
    byId.set(item.id, item);
  }
  for (const item of items) if (item.dependencies?.includes(item.id)) return 'self-dependency';
  // Iterative depth-first search over resolvable edges; unresolved IDs are reported per entry.
  const state = new Map<string, 1 | 2>();
  for (const start of items) {
    if (state.has(start.id)) continue;
    const stack: [ItemView, number][] = [[start, 0]];
    state.set(start.id, 1);
    while (stack.length) {
      const top = stack[stack.length - 1];
      const deps = top[0].dependencies ?? [];
      if (top[1] >= deps.length) { state.set(top[0].id, 2); stack.pop(); continue; }
      const next = byId.get(deps[top[1]++]);
      if (!next) continue;
      const seen = state.get(next.id);
      if (seen === 1) return 'cycle';
      if (seen === undefined) { state.set(next.id, 1); stack.push([next, 0]); }
    }
  }
  return null;
}

/**
 * Classify the tasks of the selected plan from its complete, matching detail. Precedence:
 * closed plan → no section; missing/pending/mismatched/failed detail → no list; invalid snapshot
 * → unavailable; groups and working/done/skipped tasks → excluded; reported `blocked` → blocked;
 * a pending task with any skipped prerequisite → skipped waiting (with all its reasons); any other
 * prerequisite not explicitly done → waiting; otherwise ready (from recorded prerequisites only).
 */
export function readiness(plan: { key: string; revision: number; lifecycle: Lifecycle }, detail: DetailState | null): Readiness {
  if (plan.lifecycle !== 'active') return { state: 'closed' };
  if (!detail || detail.state === 'loading') return { state: 'loading' };
  if (detail.state === 'error') return { state: 'unavailable' };
  const d = detail.value;
  if (d.key !== plan.key || d.revision !== plan.revision) return { state: 'loading' };
  const invalid = invalidReason(d.items);
  if (invalid) return { state: 'invalid', reason: invalid };
  const byId = new Map(d.items.map((i) => [i.id, i]));
  const groups: Record<ReadinessGroup, ReadinessEntry[]> = { ready: [], waiting: [], skipped: [], blocked: [] };
  let incomplete = false;
  for (const item of d.items) {
    if (item.kind !== 'task' || (item.status !== 'pending' && item.status !== 'blocked')) continue;
    const prerequisites = (item.dependencies ?? []).map((id): Prerequisite => {
      const target = byId.get(id);
      if (!target) return { kind: 'unresolved', id };
      return target.kind === 'task' ? { kind: 'task', id, title: target.title, status: target.status } : { kind: 'not-task', id, title: target.title };
    });
    const entryIncomplete = prerequisites.some((p) => p.kind !== 'task');
    const group: ReadinessGroup = item.status === 'blocked' ? 'blocked'
      : prerequisites.some((p) => p.kind === 'task' && p.status === 'skipped') ? 'skipped'
      : prerequisites.every((p) => p.kind === 'task' && p.status === 'done') ? 'ready' : 'waiting';
    incomplete ||= entryIncomplete;
    groups[group].push({
      item, group, prerequisites, incomplete: entryIncomplete,
      parent: parentOf(item, byId),
      recorded: item.dependencies === undefined ? 'omitted' : item.dependencies.length ? 'listed' : 'empty',
      assigneeSessionId: item.assigneeSessionId ?? null,
      linkedSessionIds: item.assigneeSessionId ? [] : [...new Set(d.links.filter((l) => l.itemIds.includes(item.id)).map((l) => l.sessionId))],
      reports: reportsFor(item.id, d.contributions),
    });
  }
  return { state: 'ready', key: d.key, revision: d.revision, groups, incomplete };
}

function parentOf(item: ItemView, byId: Map<string, ItemView>): ParentContext {
  if (!item.parentId) return { kind: 'none' };
  const parent = byId.get(item.parentId);
  return parent ? { kind: 'known', id: parent.id, title: parent.title } : { kind: 'unknown', id: item.parentId };
}

/** Distinct recorded reports for one task; repeated contributions never add entries or tasks. */
export function reportsFor(itemId: string, contributions: readonly ContributionView[]): ReportView[] {
  const out: ReportView[] = [];
  for (const c of contributions) {
    if (!c.itemIds.includes(itemId)) continue;
    if (out.some((r) => r.mode === c.mode && r.reporterSessionId === c.reporterSessionId && r.attributedSessionId === c.attributedSessionId)) continue;
    out.push({ mode: c.mode, reporterSessionId: c.reporterSessionId, attributedSessionId: c.attributedSessionId });
  }
  return out;
}

/**
 * How a recorded assignee relates to the surface's comparison session (rail: its selected host
 * session; board: an explicit session filter, else none). "selected" needs the same recorded
 * session ID and a plan from the verified bound source; anything else stays a neutral label.
 */
export function assignment(entry: Pick<ReadinessEntry, 'assigneeSessionId'>, compareSession: string | null, planSourceId: string, boundSource: string | null): { kind: 'none' } | { kind: 'selected'; sessionId: string } | { kind: 'other'; sessionId: string } {
  const id = entry.assigneeSessionId;
  if (!id) return { kind: 'none' };
  return compareSession !== null && id === compareSession && boundSource !== null && planSourceId === boundSource ? { kind: 'selected', sessionId: id } : { kind: 'other', sessionId: id };
}
