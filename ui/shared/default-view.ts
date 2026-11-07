// Presentation only. Callers supply their existing complete/current detail guard and reading key.
import type { ItemView } from './model.ts';
import type { PlanView } from './model.ts';
import type { ViewContext } from './app.ts';

export type DetailView = 'list' | 'map' | 'document' | 'history';
export type GraphCapability = 'unknown' | 'unsupported' | 'supported';
export interface ViewDecision { view: DetailView; pending: boolean; explicit: boolean }

/** Recorded task→task presence, not readiness/graph validity or proof of no prerequisites. */
export function hasTaskEdge(items: readonly Pick<ItemView, 'id' | 'kind' | 'dependencies'>[]): boolean {
  const tasks = new Set(items.filter(i => i.kind === 'task').map(i => i.id));
  return items.some(i => i.kind === 'task' && i.dependencies?.some(id => tasks.has(id)));
}

export function viewReadingKey<U>(vc: Pick<ViewContext<U>, 'ctx' | 'identity'>, scope: string, plan: Pick<PlanView, 'key' | 'cleanup'>): string {
  return JSON.stringify([vc.ctx.connection?.account ?? '', vc.identity, scope, plan.key, plan.cleanup?.state ?? 'visible', plan.cleanup?.revision ?? 0]);
}

/** Resolve only from the existing guarded complete-detail cache; never starts a read. */
export function resolveDefaultView<U>(choice: DefaultViewChoice, vc: ViewContext<U>, scope: string, plan: PlanView | null) {
  if (!plan) { choice.reset(); return choice.current; }
  const cached = vc.detailResult(plan), result = cached?.result;
  const items = cached?.current() && result?.ok && result.plan.key === plan.key && result.plan.revision === plan.revision
    && (result.plan.cleanup?.revision ?? 0) === (plan.cleanup?.revision ?? 0) ? result.detail.items : null;
  const capability = !vc.health?.ready ? 'unknown' : vc.health.planGraph === 1 ? 'supported' : 'unsupported';
  return choice.resolve(viewReadingKey(vc, scope, plan), capability, items);
}

/** One frame's one reading. No per-plan memory, persistence, reads, timers or focus effects. */
export class DefaultViewChoice {
  private key: string | null = null;
  private value: ViewDecision = { view: 'list', pending: true, explicit: false };

  get current(): Readonly<ViewDecision> { return this.value; }
  reset() { this.key = null; this.value = { view: 'list', pending: true, explicit: false }; }
  identify(key: string) {
    if (this.key !== key) { this.reset(); this.key = key; }
    return this.current;
  }
  /** Activation, including reactivating the provisional List/Progress button. */
  choose(key: string, view: DetailView): Readonly<ViewDecision> {
    if (key !== this.key) return this.current; // a detached old control cannot claim a new reading
    this.value = { view, pending: false, explicit: true };
    return this.current;
  }
  /** `items=null` means no complete matching detail, including a failed read; not an empty plan. */
  resolve(key: string, capability: GraphCapability, items: readonly ItemView[] | null): Readonly<ViewDecision> {
    this.identify(key);
    if (!this.value.pending) return this.current;
    if (capability === 'unsupported') this.value = { view: 'list', pending: false, explicit: false };
    else if (capability === 'supported' && items !== null) this.value = { view: hasTaskEdge(items) ? 'map' : 'list', pending: false, explicit: false };
    return this.current;
  }
}
