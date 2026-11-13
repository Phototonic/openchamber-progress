// Shared by Work Status and explicit session handoffs; no live activity inference.
import { orderPlans, type PlanView } from './model.ts';
import type { Scope } from './scope.ts';

export const railPlanKey = (sessionId: string) => `rail-plan:${sessionId}`;

export function automaticPlan(scope: Scope): PlanView | null {
  if (scope.kind === 'none') return null;
  const working = scope.plans.filter((p) => p.lifecycle === 'active' && p.working.length > 0);
  return orderPlans(working)[0] ?? scope.plans[0] ?? null;
}
