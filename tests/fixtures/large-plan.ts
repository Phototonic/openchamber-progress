import type { Counts, ItemInput, Status } from '../../shared/progress.ts';
import type { searchFixture } from './plan-task-search.ts';

export const LARGE_PLAN_ID = 'P-large-dependencies';
export const LARGE_PLAN_TITLE = 'Synthetic dependency plan';
export const LARGE_PLAN_SEED = 0x4c504631;
export const LARGE_PLAN_VERSION = 'large-plan-v1';
export type LargePlanStepId = 'S0' | 'S1' | 'S2' | 'S3' | 'S4' | 'S5' | 'S6' | 'S7' | 'S8';
export type LargePlanItem = ItemInput & { status: Status };
export interface LargePlanStep {
  id: LargePlanStepId;
  name: string;
  class: 'status-only' | 'metadata-only' | 'structural';
  revision: number;
  structuralRevision: number;
  title: string;
  items: LargePlanItem[];
  counts: Counts;
  itemCount: number;
  edgeCount: number;
  affectedIds: string[];
  edgeChanges: { id: string; removed: string[]; added: string[] }[];
  parentChanges: { id: string; from: string | null; to: string | null }[];
}
const pad = (n: number) => String(n).padStart(2, '0');
const taskId = (layer: number, column: number) => `T-${pad(layer)}-${pad(column)}`;
const statuses: Status[] = ['pending', 'working', 'blocked', 'done', 'skipped'];
const anchors: Record<string, Status> = {
  'T-00-00': 'pending', 'T-01-00': 'pending', 'T-01-01': 'pending', 'T-01-02': 'pending',
  'T-00-01': 'done', 'T-00-02': 'done', 'T-00-04': 'done', 'T-00-48': 'done', 'T-19-48': 'done',
  'T-00-03': 'skipped', 'T-01-03': 'blocked',
};

/** Fixed topology; seed changes only the unreserved status placement. */
export function generateLargePlan(seed = LARGE_PLAN_SEED): LargePlanItem[] {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw Error('Expected a uint32 seed');
  const totals = { pending: 588, working: 98, blocked: 98, done: 147, skipped: 49 };
  for (const status of Object.values(anchors)) totals[status]--;
  const pool = statuses.flatMap(status => Array<Status>(totals[status]).fill(status));
  let state = seed >>> 0;
  for (let i = pool.length - 1; i > 0; i--) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const j = Math.floor(state / 0x100000000 * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const items: LargePlanItem[] = []; let next = 0;
  for (let layer = 0; layer < 20; layer++) {
    const group = `G-${pad(layer)}`;
    items.push({ id: group, title: `Synthetic group ${pad(layer)}`, kind: 'group', status: 'pending', ...(layer % 5 ? { parentId: `G-${pad(layer - layer % 5)}` } : {}) });
    for (let column = 0; column < 49; column++) {
      const id = taskId(layer, column);
      const dependencies = layer ? [taskId(layer - 1, column), taskId(layer - 1, (column + 1) % 49)] : [];
      if (column === 0 && [4, 7, 10, 13, 16, 19].includes(layer)) for (let c = 2; c <= 15; c++) dependencies.push(taskId(layer - 1, c));
      if (layer >= 2 && [20, 21, 22].includes(column)) dependencies.push('T-00-48');
      items.push({ id, title: `Synthetic task ${pad(layer)}-${pad(column)}`, kind: 'task', status: anchors[id] ?? pool[next++], parentId: group, dependencies });
    }
  }
  return items;
}

/** Ordered authored projection: excludes timestamps, attribution and store-local identity. */
export function largePlanProjection(items: readonly ItemInput[]): LargePlanItem[] {
  return items.map(i => ({ id: i.id, title: i.title, kind: i.kind, status: i.status ?? 'pending', ...(i.parentId ? { parentId: i.parentId } : {}), dependencies: [...(i.dependencies ?? [])] }));
}

/** Pure expected checkpoints, independently usable without SQLite or a browser. */
export function largePlanSteps(seed = LARGE_PLAN_SEED): LargePlanStep[] {
  let items = generateLargePlan(seed), title = LARGE_PLAN_TITLE;
  const steps: LargePlanStep[] = [];
  function add(id: LargePlanStepId, name: string, kind: LargePlanStep['class'], structuralRevision: number, affectedIds: string[]) {
    const tasks = items.filter(i => i.kind === 'task');
    const done = tasks.filter(i => i.status === 'done').length, skipped = tasks.filter(i => i.status === 'skipped').length;
    const previous = new Map(steps.at(-1)?.items.map(i => [i.id, i]) ?? []);
    const current = new Map(items.map(i => [i.id, i]));
    const edgeChanges: LargePlanStep['edgeChanges'] = [], parentChanges: LargePlanStep['parentChanges'] = [];
    if (steps.length) for (const itemId of affectedIds) {
      const before = previous.get(itemId), after = current.get(itemId);
      const removed = (before?.dependencies ?? []).filter(d => !after?.dependencies?.includes(d));
      const added = (after?.dependencies ?? []).filter(d => !before?.dependencies?.includes(d));
      if (removed.length || added.length) edgeChanges.push({ id: itemId, removed, added });
      if ((before?.parentId ?? null) !== (after?.parentId ?? null)) parentChanges.push({ id: itemId, from: before?.parentId ?? null, to: after?.parentId ?? null });
    }
    steps.push({ id, name, class: kind, revision: steps.length + 1, structuralRevision, title, items: largePlanProjection(items), counts: { done, total: tasks.length - skipped, remaining: tasks.length - skipped - done, skipped }, itemCount: items.length, edgeCount: items.reduce((n, i) => n + (i.dependencies?.length ?? 0), 0), affectedIds, edgeChanges, parentChanges });
  }
  const change = (id: string, status: Status) => { items.find(i => i.id === id)!.status = status; };
  add('S0', 'seed', 'structural', 1, []);
  change('T-00-00', 'working'); add('S1', 'start-root', 'status-only', 1, ['T-00-00']);
  change('T-00-00', 'done'); change('T-00-03', 'done'); change('T-01-03', 'pending');
  add('S2', 'complete-prerequisites', 'status-only', 1, ['T-00-00', 'T-00-03', 'T-01-03']);
  const batch = [...Array.from({ length: 49 }, (_, c) => taskId(8, c)), 'T-09-00'];
  for (const id of batch) { const item = items.find(i => i.id === id)!; item.status = statuses[(statuses.indexOf(item.status) + 1) % statuses.length]; }
  add('S3', 'status-batch', 'status-only', 1, batch);
  title = 'Synthetic dependency plan revised'; add('S4', 'title-only', 'metadata-only', 2, []);
  const moved = items.find(i => i.id === 'T-10-24')!;
  moved.title = 'Synthetic task moved'; moved.parentId = 'G-11'; moved.dependencies = moved.dependencies!.map(d => d === 'T-09-25' ? 'T-08-25' : d);
  const a = items.indexOf(moved), b = items.findIndex(i => i.id === 'T-10-25');
  [items[a], items[b]] = [items[b], items[a]];
  add('S5', 'reshape', 'structural', 3, ['T-10-24', 'T-10-25']);
  const leafIndex = items.findIndex(i => i.id === 'T-19-48'), leaf = items[leafIndex];
  items = items.filter(i => i.id !== leaf.id); add('S6', 'remove-leaf', 'structural', 4, [leaf.id]);
  items.splice(leafIndex, 0, { ...leaf, status: 'pending' }); add('S7', 'reuse-leaf-ID', 'structural', 5, [leaf.id]);
  change(leaf.id, 'working'); add('S8', 'start-reintroduced', 'status-only', 5, [leaf.id]);
  return steps;
}

export type LargePlanOperations = Pick<ReturnType<typeof searchFixture>, 'seedPlan' | 'apply' | 'store' | 'actor'>;
/** No retries/reset: seed once, then advance one named committed checkpoint at a time. */
export function createLargePlanReplay(f: LargePlanOperations, seed = LARGE_PLAN_SEED) {
  const steps = largePlanSteps(seed); let index = -1;
  function assertCurrent() {
    const plan = f.store.get(f.actor.sourceId, LARGE_PLAN_ID);
    const expected = steps[index];
    if (index === -1 ? plan !== undefined : !plan || plan.revision !== expected.revision || plan.structuralRevision !== expected.structuralRevision || plan.title !== expected.title || JSON.stringify(largePlanProjection(plan.items)) !== JSON.stringify(expected.items)) throw Error('Unexpected large-plan starting checkpoint');
  }
  function advance(id: LargePlanStepId): LargePlanStep {
    if (steps[index + 1]?.id !== id) throw Error('Large-plan steps must advance in order');
    assertCurrent(); const step = steps[index + 1];
    if (id === 'S0' || ['S5', 'S6', 'S7'].includes(id)) {
      const input: ItemInput[] = step.items.map(i => {
        const copy: ItemInput = { ...i, dependencies: [...(i.dependencies ?? [])] };
        if (id === 'S7' && i.id === 'T-19-48') delete copy.status;
        return copy;
      });
      f.seedPlan(LARGE_PLAN_ID, step.title, input);
    } else if (id === 'S4') f.apply(LARGE_PLAN_ID, { op: 'revise', title: step.title });
    else f.apply(LARGE_PLAN_ID, { op: 'change', changes: step.affectedIds.map(itemId => ({ id: itemId, status: step.items.find(i => i.id === itemId)!.status })) });
    index++; assertCurrent(); return step;
  }
  return { steps, seed: () => advance('S0'), advance };
}
