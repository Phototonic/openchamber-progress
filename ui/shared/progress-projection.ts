// One canonical task projection. Presentation consumes existing recorded/readiness semantics.
import { itemTree, participantIndex, taskMatch, type ItemNode, type ItemView, type PlanDetail, type PlanView, type ProgressState, type ReadingState } from './model.ts';
import { readiness, type Readiness } from './readiness.ts';

export type ProgressSection = 'now' | 'needs-you' | 'up-next' | 'done' | 'skipped';
export interface ProgressRow {
  item: ItemView;
  state: ProgressState | null;
  section: ProgressSection | null;
  visibility: 'match' | 'retained' | 'context' | 'hidden';
}
export interface ProgressGroup { id: ProgressSection; rows: ProgressRow[]; folded: boolean }
export interface ProgressProjection {
  /** Existing hierarchy for plan order/group metadata. Render either this or the groups, not both. */
  tree: ItemNode[];
  /** Task rows only; every task occurs once, including hidden/filter-excluded rows. */
  groups: ProgressGroup[];
  /** All task/group identities, including ancestor context for retained blockers. */
  rows: ReadonlyMap<string, ProgressRow>;
  order: ItemView[];
  readiness: Readiness;
  /** False for closed/invalid readiness: use reported status labels, not Needs you/Ready claims. */
  guidance: boolean;
  counts: ReadonlyMap<ProgressState, number>;
  matching: number;
  retained: number;
  hidden: number;
  context: number;
  filtered: boolean;
}

/** Null is a missing/mismatched complete read, never an authoritative empty list. */
export function progressProjection(plan: PlanView, detail: PlanDetail | null, reading: ReadingState): ProgressProjection | null {
  if (!detail || detail.key !== plan.key || detail.revision !== plan.revision) return null;
  const ready = readiness(plan, { state: 'ready', value: detail });
  const guidance = ready.state === 'ready';
  const states = new Map<string, ProgressState>();
  if (ready.state === 'ready') for (const [group, entries] of Object.entries(ready.groups)) {
    for (const e of entries) states.set(e.item.id, group === 'blocked' ? 'blocked' : group === 'skipped' ? 'waiting' : group as 'ready' | 'waiting');
  }
  const predicate = taskMatch(reading, participantIndex(plan, detail));
  const stateFilter = reading.state ?? null;
  const filtered = predicate !== null || stateFilter !== null;
  const rows = new Map<string, ProgressRow>(), counts = new Map<ProgressState, number>();
  let matching = 0, retained = 0, hidden = 0;
  for (const item of detail.items) {
    const state = item.kind === 'task' ? states.get(item.id) ?? item.status : null;
    const section: ProgressSection | null = item.kind !== 'task' ? null : item.status === 'working' ? 'now' : item.status === 'blocked' ? 'needs-you' : item.status === 'done' ? 'done' : item.status === 'skipped' ? 'skipped' : 'up-next';
    const match = item.kind === 'task' && (!predicate || predicate(item)) && (stateFilter === null || stateFilter === state);
    const keep = item.kind === 'task' && guidance && item.status === 'blocked' && !match;
    const visibility = match ? 'match' : keep ? 'retained' : item.kind === 'group' && !filtered ? 'context' : 'hidden';
    rows.set(item.id, { item, state, section, visibility });
    if (state !== null) {
      counts.set(state, (counts.get(state) ?? 0) + 1);
      if (match) matching++; else if (keep) retained++; else hidden++;
    }
  }
  // Ancestors supply context, not extra filter matches. Stop at already-visible ancestors/cycles.
  for (const row of rows.values()) if (row.visibility === 'match' || row.visibility === 'retained') {
    const seen = new Set<string>();
    let parent = row.item.parentId;
    while (parent && !seen.has(parent)) {
      seen.add(parent);
      const ancestor = rows.get(parent); if (!ancestor) break;
      if (ancestor.visibility !== 'hidden') break;
      ancestor.visibility = 'context'; parent = ancestor.item.parentId;
    }
  }
  const tree = itemTree(detail.items);
  hidden = [...rows.values()].filter(r => r.item.kind === 'task' && r.visibility === 'hidden').length;
  const context = [...rows.values()].filter(r => r.item.kind === 'task' && r.visibility === 'context').length;
  const groups: ProgressGroup[] = (['now', 'needs-you', 'up-next', 'done', 'skipped'] as const).map(id => ({
    id, rows: [...rows.values()].filter(r => r.section === id),
    folded: id === 'done' ? !reading.doneOpen && stateFilter !== 'done' : id === 'skipped' ? !reading.skippedOpen && stateFilter !== 'skipped' : false,
  }));
  const order: ItemView[] = [];
  const visit = (node: ItemNode) => { order.push(node.item); node.children.forEach(visit); };
  if (reading.order === 'plan') tree.forEach(visit);
  else for (const group of groups) order.push(...group.rows.map(r => r.item));
  return { tree, groups, rows, order, readiness: ready, guidance, counts, matching, retained, hidden, context, filtered };
}
