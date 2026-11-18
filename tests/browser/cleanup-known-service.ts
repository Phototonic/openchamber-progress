// A scripted service for search-state (batch lookups) and plan (head reads) lookups of named plans.
import { parsePlansPage } from '../../ui/shared/adapter.ts';
import type { ServiceHost, KnownPlan } from '../../ui/shared/source.ts';
import { envelope, plansPage, planPage, summary, SRC } from './fixtures.ts';
import type { PlanSummary } from '../../shared/progress.ts';

export const identity = { storeId: 'store-1', binding: { sourceId: SRC, verified: true } };
export const view = (rows: PlanSummary[]) => parsePlansPage(JSON.stringify(plansPage(rows))).data as KnownPlan[];
export const stateRow = (k: { source: string; plan: string }, revision: number | null, state = 'visible') =>
  ({ source: k.source, plan: k.plan, exists: revision !== null, revision, cleanup: { state: revision === null ? 'deleted' : state, revision: 0 } });
export interface Script {
  revisions: Map<string, number | null>;
  head?: (plan: string) => { status: number; body: string };
  state?: (keys: { source: string; plan: string }[]) => { status: number; body: string } | null;
}
/** A scripted service for search-state (batch lookups) and plan (head reads), recording every request. */
export function service(script: Script, plans: PlanSummary[]) {
  const requests: { path: string; query?: Record<string, string> }[] = [];
  const host: ServiceHost = { serviceRequest: async q => {
    requests.push({ path: q.path, query: q.query as Record<string, string> | undefined });
    if (q.path === '/v1/search-state') {
      const keys = JSON.parse(q.query!.keys) as { source: string; plan: string }[];
      const custom = script.state?.(keys);
      if (custom) return custom;
      return { status: 200, body: JSON.stringify({ ...envelope(), planTaskSearch: 1, data: keys.map(k => stateRow(k, script.revisions.get(k.plan) ?? null)) }) };
    }
    if (q.path === '/v1/plan') {
      const id = q.query!.plan;
      if (script.head) return script.head(id);
      const plan = plans.find(p => p.id === id);
      if (!plan) return { status: 404, body: '{"error":"not-found"}' };
      return { status: 200, body: JSON.stringify(planPage({ ...plan, revision: script.revisions.get(id) ?? plan.revision }, [], [])) };
    }
    return { status: 404, body: '{"error":"not-found"}' };
  } };
  return { host, requests };
}
export const closed = (id: string, extra: Partial<PlanSummary> = {}) => summary(id, [], { lifecycle: 'finished', ...extra });

