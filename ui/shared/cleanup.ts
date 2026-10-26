import type { CleanupAction, CleanupRequest } from './adapter.ts';
import type { PlanView } from './model.ts';

export interface CleanupTarget {
  key: string; title: string; context: string; request: CleanupRequest;
}
export interface CleanupState {
  target: CleanupTarget | null;
  pending: boolean;
  message: string | null;
  error: boolean;
}
export const initialCleanup = (): CleanupState => ({ target: null, pending: false, message: null, error: false });
export function cleanupTarget(plan: PlanView, storeId: string, context: string): CleanupTarget {
  return { key: plan.key, title: plan.title, context, request: { storeId, source: plan.sourceId, plan: plan.id, rev: plan.revision, cleanupRev: plan.cleanup?.revision ?? 0, oid: crypto.randomUUID() } };
}
export function cleanupMatches(target: CleanupTarget, plan: PlanView | null, storeId: string | undefined, context: string) {
  return !!plan && plan.lifecycle === 'completed' && target.context === context && target.request.storeId === storeId && target.key === plan.key && target.request.rev === plan.revision && target.request.cleanupRev === (plan.cleanup?.revision ?? 0);
}
export function cleanupEligible(action: CleanupAction, plan: PlanView) {
  return plan.lifecycle === 'completed' && (action === 'delete' || (action === 'restore') === (plan.cleanup?.state === 'archived'));
}
export function cleanupError(code: string) {
  if (['conflict', 'closed', 'operation-reused', 'not-found'].includes(code)) return 'This plan changed or is no longer available. Progress is being refreshed; review it before trying again.';
  if (code === 'busy') return 'The progress store is busy. Nothing was confirmed. Refreshing before you try again.';
  return 'The action could not be confirmed. It may have reached the service. Refreshing progress; check the plan before trying again.';
}
