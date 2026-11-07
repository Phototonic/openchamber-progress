// Read-only proof projection over this frame's accepted picture and EXISTING run visit.
// No retained attribution, requests, roster caps, task-execution inference or layout inputs.
import type { RunRequest } from '../../shared/subagent-runs.ts';
import type { AssignmentBindingView, ContributionView } from './model.ts';
import type { MapSnapshot } from './dependency-map.ts';
import { currentFor, type Census } from './census.ts';
import type { RunsPanel } from './runs.ts';
import { latestChildRuns, runActivity } from './subagents.ts';

export interface MapTaskAttribution {
  /** Adapter-validated provenance, rechecked against the displayed revision/owner/assignee. */
  readonly assignment: Readonly<AssignmentBindingView> | null;
  readonly recordedAssignee: string | null;
  /** Explicit task links, never inferred assignments (including a link matching the assignee). */
  readonly links: readonly string[];
  readonly reporter: string | null;
  readonly reports: readonly Readonly<ContributionView>[];
  readonly assignmentReason: 'verified' | 'provenance-unavailable' | 'no-assignee-recorded';
  /** Means ONLY the assigned session is running, never that this task is executing. */
  readonly live: { readonly proven: true; readonly runId: string; readonly kind: 'active' | 'waiting' }
    | { readonly proven: false; readonly reason: 'no-verified-assignment' | 'picture-not-current' | 'run-scope-unavailable' | 'latest-child-not-proven' | 'session-not-running' };
}
export interface MapAttributionInput {
  snapshot: MapSnapshot;
  /** Exact claim of this surface's existing visit; rail root stays the selected session. */
  request: RunRequest;
  runs: RunsPanel | null;
  census: Census;
  liveSeq: number;
}

export function mapAttribution(v: MapAttributionInput): ReadonlyMap<string, MapTaskAttribution> {
  const result = new Map<string, MapTaskAttribution>(), picture = v.snapshot.picture;
  if (!picture) return result;
  const { plan, detail, snapshot } = picture.detail, q = v.request, read = v.runs?.read;
  const identity = snapshot?.identity;
  const verified = !!identity && identity.binding.verified && identity.binding.sourceId === plan.sourceId;
  const scope = verified && q.storeId === identity!.storeId && q.source === plan.sourceId && q.plan === plan.id
    && q.binding.verified && q.binding.sourceId === identity!.binding.sourceId && q.cleanupRev === (plan.cleanup?.revision ?? 0)
    && q.view === 'useful' && v.runs?.state === 'ready' && v.runs.failure === null && read?.availability === 'ready'
    && read.storeId === q.storeId && read.source === q.source && read.root === q.root && read.plan === q.plan
    && read.cleanupRev === q.cleanupRev && read.view === q.view && read.sourceBinding.verified === q.binding.verified
    && read.sourceBinding.sourceId === q.binding.sourceId;
  const rows = scope ? [...v.runs!.featured, ...v.runs!.more] : [];
  const latest = latestChildRuns(rows);
  const host = currentFor(v.census) && v.census.state === 'ready' && v.census.rootId === q.root
    ? new Map(v.census.rows.map(r => [r.id, r])) : new Map();
  for (const item of detail.items) {
    if (item.kind !== 'task') continue;
    const b = item.delegation;
    const assignment = verified && b && b.validAtRevision === plan.revision && b.boundRevision <= b.validAtRevision
      && b.coordinatorSessionId === plan.ownerSessionId && b.childSessionId === item.assigneeSessionId ? b : null;
    let live: MapTaskAttribution['live'];
    if (!assignment) live = { proven: false, reason: 'no-verified-assignment' };
    else if (!v.snapshot.current) live = { proven: false, reason: 'picture-not-current' };
    else if (!scope) live = { proven: false, reason: 'run-scope-unavailable' };
    else {
      const row = latest.get(assignment.childSessionId);
      if (!row || row.source !== plan.sourceId) live = { proven: false, reason: 'latest-child-not-proven' };
      else {
        const { ran, now } = runActivity(row, host.get(assignment.childSessionId) ?? null, v.runs!.baselines, v.liveSeq);
        const kind = now?.kind ?? ran.kind;
        live = kind === 'active' || kind === 'waiting' ? { proven: true, runId: row.id, kind } : { proven: false, reason: 'session-not-running' };
      }
    }
    result.set(item.id, {
      assignment, recordedAssignee: item.assigneeSessionId ?? null,
      links: detail.links.filter(l => l.itemIds.includes(item.id)).map(l => l.sessionId),
      reporter: item.reporterSessionId ?? null, reports: detail.contributions.filter(c => c.itemIds.includes(item.id)),
      assignmentReason: assignment ? 'verified' : item.assigneeSessionId ? 'provenance-unavailable' : 'no-assignee-recorded', live,
    });
  }
  return result;
}
