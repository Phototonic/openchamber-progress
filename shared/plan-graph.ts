import { identifier, ProgressError, type PlanGraphItem } from './progress.ts';

export const GRAPH_LIMITS = { inputBytes: 8 * 1024 * 1024, queryBytes: 16 * 1024, items: 1000, dependencies: 16 } as const;
export const graphInteger = (v: unknown, min = 0): v is number => Number.isSafeInteger(v) && Number(v) >= min;
export const graphRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
export function graphCheck(v: unknown): asserts v { if (!v) throw new ProgressError('corrupt'); }

/** Validate recorded facts only. Snapshot annotations are deliberately not inspected. */
export function graphItems(value: unknown, wire = false): PlanGraphItem[] {
  graphCheck(Array.isArray(value) && value.length <= GRAPH_LIMITS.items);
  const items = value.map((v): PlanGraphItem => {
    graphCheck(graphRecord(v));
    if (wire) graphCheck(Object.keys(v).length === 5 && Object.keys(v).every(k => ['id','kind','status','parentId','dependencies'].includes(k)));
    graphCheck(identifier(v.id) && (v.kind === 'task' || v.kind === 'group') && typeof v.status === 'string' && ['pending','working','blocked','done','skipped'].includes(v.status));
    const parentId = !wire && v.parentId === undefined ? null : v.parentId;
    const dependencies = !wire && v.dependencies === undefined ? [] : v.dependencies;
    graphCheck(parentId === null || identifier(parentId));
    graphCheck(Array.isArray(dependencies) && dependencies.length <= GRAPH_LIMITS.dependencies && dependencies.every(identifier));
    return { id: v.id, kind: v.kind, status: v.status as PlanGraphItem['status'], parentId, dependencies: [...dependencies] };
  });
  const byId = new Map(items.map(i => [i.id, i]));
  graphCheck(byId.size === items.length);
  for (const item of items) {
    graphCheck(item.parentId === null || byId.get(item.parentId)?.kind === 'group');
    graphCheck(item.dependencies.every(id => id !== item.id && byId.get(id)?.kind === 'task'));
  }
  // Iterative walks avoid call-stack dependence at the supported item bound.
  for (const edges of [(i: PlanGraphItem) => i.parentId === null ? [] : [i.parentId], (i: PlanGraphItem) => i.dependencies]) {
    const done = new Set<string>();
    for (const item of items) {
      const visiting = new Set<string>();
      const stack: { id: string; exit: boolean }[] = [{ id: item.id, exit: false }];
      while (stack.length) {
        const frame = stack.pop()!;
        if (frame.exit) { visiting.delete(frame.id); done.add(frame.id); continue; }
        if (done.has(frame.id)) continue;
        graphCheck(!visiting.has(frame.id)); visiting.add(frame.id);
        stack.push({ id: frame.id, exit: true });
        for (const id of edges(byId.get(frame.id)!)) stack.push({ id, exit: false });
      }
    }
  }
  return items;
}
