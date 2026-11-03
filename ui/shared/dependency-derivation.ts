// Pure dependency facts for one complete committed snapshot. No hierarchy or history edges.
import type { PlanGraphItem } from '../../shared/progress.ts';

export type DependencyItem =
  Readonly<Pick<PlanGraphItem, 'id' | 'kind' | 'status'>> & {
    readonly dependencies?: readonly string[];
  };
export type ReadinessGroup = 'ready' | 'waiting' | 'skipped' | 'blocked';
export type InvalidReason = 'duplicate-id' | 'self-dependency' | 'cycle';
export type DependencyPrerequisite =
  | { readonly kind: 'task'; readonly id: string; readonly status: PlanGraphItem['status'] }
  | { readonly kind: 'not-task'; readonly id: string }
  | { readonly kind: 'unresolved'; readonly id: string };
export interface DerivedTask {
  readonly status: PlanGraphItem['status'];
  readonly group: ReadinessGroup | null;
  readonly prerequisites: readonly DependencyPrerequisite[];
  readonly incomplete: boolean;
  readonly depth: number | null;
  readonly unlocksNext: ReadonlySet<string>;
}
export type DependencyDerivation =
  | { readonly state: 'invalid'; readonly reason: InvalidReason }
  | {
      readonly state: 'valid';
      readonly tasks: ReadonlyMap<string, DerivedTask>;
      readonly upstream: (taskId: string) => ReadonlySet<string> | null;
      readonly downstream: (taskId: string) => ReadonlySet<string> | null;
    };

// Validation observes all resolvable recorded edges, including groups. Postorder also supplies
// dependency-first ordering for task depth, without recursion or a second topological walk.
function inspect(items: readonly DependencyItem[]) {
  const byId = new Map<string, DependencyItem>();
  for (const item of items) {
    if (byId.has(item.id)) return { state: 'invalid', reason: 'duplicate-id' } as const;
    byId.set(item.id, item);
  }
  for (const item of items) {
    if (item.dependencies?.includes(item.id)) return { state: 'invalid', reason: 'self-dependency' } as const;
  }
  const colors = new Map<string, 1 | 2>();
  const order: string[] = [];
  for (const start of items) {
    if (colors.has(start.id)) continue;
    const stack: [DependencyItem, number][] = [[start, 0]];
    colors.set(start.id, 1);
    while (stack.length) {
      const top = stack[stack.length - 1];
      const deps = top[0].dependencies ?? [];
      if (top[1] === deps.length) {
        colors.set(top[0].id, 2);
        order.push(top[0].id);
        stack.pop();
        continue;
      }
      const next = byId.get(deps[top[1]++]);
      if (!next) continue;
      const color = colors.get(next.id);
      if (color === 1) return { state: 'invalid', reason: 'cycle' } as const;
      if (color === undefined) { colors.set(next.id, 1); stack.push([next, 0]); }
    }
  }
  return { state: 'valid', byId, order } as const;
}

export function invalidDependencyReason(items: readonly DependencyItem[]): InvalidReason | null {
  const result = inspect(items);
  return result.state === 'invalid' ? result.reason : null;
}

type Task = {
  -readonly [K in keyof DerivedTask]: K extends 'unlocksNext' ? Set<string> : DerivedTask[K];
};

export function deriveDependencies(items: readonly DependencyItem[]): DependencyDerivation {
  const graph = inspect(items);
  if (graph.state === 'invalid') return graph;
  const tasks = new Map<string, Task>();
  const prerequisites = new Map<string, Set<string>>();
  const dependents = new Map<string, Set<string>>();
  for (const item of items) {
    if (item.kind !== 'task') continue;
    prerequisites.set(item.id, new Set());
    dependents.set(item.id, new Set());
  }
  for (const item of items) {
    if (item.kind !== 'task') continue;
    const edges = prerequisites.get(item.id)!;
    const facts = (item.dependencies ?? []).map((id): DependencyPrerequisite => {
      const target = graph.byId.get(id);
      if (!target) return { kind: 'unresolved', id };
      if (target.kind !== 'task') return { kind: 'not-task', id };
      edges.add(id);
      dependents.get(id)!.add(item.id);
      return { kind: 'task', id, status: target.status };
    });
    const incomplete = facts.some((p) => p.kind !== 'task');
    const group = item.status === 'blocked' ? 'blocked'
      : item.status !== 'pending' ? null
      : facts.some((p) => p.kind === 'task' && p.status === 'skipped') ? 'skipped'
      : facts.every((p) => p.kind === 'task' && p.status === 'done') ? 'ready' : 'waiting';
    tasks.set(item.id, { status: item.status, group, prerequisites: facts, incomplete, depth: incomplete ? null : 0, unlocksNext: new Set() });
  }
  for (const [id, task] of tasks) {
    if (task.status !== 'pending' || task.incomplete) continue;
    let only: string | undefined;
    let count = 0;
    for (const dep of prerequisites.get(id)!) {
      if (tasks.get(dep)!.status !== 'done') { only = dep; count++; }
    }
    if (count === 1) tasks.get(only!)!.unlocksNext.add(id);
  }
  for (const id of graph.order) {
    const task = tasks.get(id);
    if (!task || task.incomplete) continue;
    for (const dep of prerequisites.get(id)!) {
      const depth = tasks.get(dep)!.depth;
      if (depth === null) { task.depth = null; break; }
      task.depth = Math.max(task.depth!, depth + 1);
    }
  }
  // Closures own their visited/output set on every call. Capture only owned adjacency/scalars,
  // never the caller's arrays. Construction stores O(V + E), not an all-pairs closure table.
  function closure(id: string, edges: ReadonlyMap<string, ReadonlySet<string>>): ReadonlySet<string> | null {
    if (!edges.has(id)) return null;
    const seen = new Set<string>([id]);
    const stack = [id];
    while (stack.length) {
      for (const next of edges.get(stack.pop()!)!) {
        if (seen.has(next)) continue;
        seen.add(next);
        stack.push(next);
      }
    }
    seen.delete(id);
    return seen;
  }
  return { state: 'valid', tasks, upstream: (id) => closure(id, prerequisites), downstream: (id) => closure(id, dependents) };
}
