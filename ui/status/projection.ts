// Work Status presentation facts from its existing selected-plan detail cache.
// No reads, ranking, host state, map consumer, timers or persisted choices.
import { blockedWork, currentWork, summarize, type ItemStatus, type ItemView, type PlanDetail, type PlanSummary, type PlanView } from '../shared/model.ts';
import { attention, readiness, type Attention, type Readiness } from '../shared/readiness.ts';

export type StatusDetail = Parameters<typeof readiness>[1];
export interface StatusProjection {
  /** Only complete detail of this exact source/plan key and progress revision. */
  detail: PlanDetail | null;
  /** Detail read failure is independent of readiness, including on closed plans. */
  detailUnavailable: boolean;
  /** Authoritative whole-plan totals; never replaced with filtered/focus counts. */
  summary: PlanSummary;
  /** Null is unavailable, not a zero count. Groups are never tasks. */
  reported: Record<ItemStatus, number> | null;
  readiness: Readiness;
  attention: Attention;
  /** Guidance counts exist only for active, complete, valid detail. */
  ready: number | null;
  waiting: number | null;
  /** First explicit blocked task, then first reported working task, in recorded order. */
  focus: ItemView[];
}

/** `detail` must come from the frame controller's selected-plan cache (which owns
 * complete pagination, account/store/binding/cleanup retirement). This helper
 * additionally rejects mismatched key/revision; it never requests missing data.
 */
export function projectStatus(plan: PlanView, detail: StatusDetail, view: { fresh: boolean; captureEnabled: boolean }): StatusProjection {
  const complete = detail?.state === 'ready' && detail.value.key === plan.key && detail.value.revision === plan.revision ? detail.value : null;
  const r = readiness(plan, detail);
  let reported: StatusProjection['reported'] = null;
  const focus: ItemView[] = [];
  if (complete) {
    reported = { pending: 0, working: 0, blocked: 0, done: 0, skipped: 0 };
    for (const item of complete.items) if (item.kind === 'task') reported[item.status]++;
    const blocked = blockedWork(complete)[0], working = currentWork(complete)[0];
    if (blocked) focus.push(blocked);
    if (working) focus.push(working);
  }
  return {
    detail: complete, detailUnavailable: detail?.state === 'error', summary: summarize(plan, complete), reported, readiness: r, attention: attention(r, view),
    ready: r.state === 'ready' ? r.groups.ready.length : null,
    // A pending task with a skipped prerequisite still waits; it is not a skipped task.
    waiting: r.state === 'ready' ? r.groups.waiting.length + r.groups.skipped.length : null,
    focus,
  };
}
