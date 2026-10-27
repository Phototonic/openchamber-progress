// Work Status only: explicit reported work, never live agent activity or inferred completion.
import { orderPlans, type PlanView } from '../shared/model.ts';
import { RecentMemory } from '../shared/refresh.ts';
import type { Scope } from '../shared/scope.ts';

export function automaticPlan(scope: Scope): PlanView | null {
  if (scope.kind === 'none') return null;
  const working = scope.plans.filter((p) => p.lifecycle === 'active' && p.working.length > 0);
  return orderPlans(working)[0] ?? scope.plans[0] ?? null;
}

/** Frame-local choices, bounded like the read cache. No async storage restoration to race clicks. */
export class StatusSelection {
  private choices: RecentMemory<string | null>;
  private authority = '';
  private context = '';
  private generation = 0;
  constructor(limit = 8) { this.choices = new RecentMemory(limit); }

  enter(authority: string, session: string | null, _directory: string | null) {
    if (authority !== this.authority) { this.choices.clear(); this.authority = authority; }
    const context = JSON.stringify([authority, session]);
    if (context !== this.context) { this.context = context; this.generation++; }
    return this.generation;
  }

  choose(generation: number, key: string | null) {
    if (generation !== this.generation) return false; // retired picker/context
    this.choices.set(this.context, key);
    return true;
  }

  resolve(scope: Scope) {
    const selected = this.choices.get(this.context);
    const manual = scope.kind === 'none' ? null : scope.plans.find((p) => p.key === selected);
    // A removed choice becomes Automatic permanently, not a dormant selection that may reappear.
    if (selected && !manual) this.choices.set(this.context, null);
    return { plan: manual ?? automaticPlan(scope), selected: manual?.key ?? null };
  }
  forget(keys: Set<string>) { this.choices.deleteWhere((key) => !!key && keys.has(key)); }
}
