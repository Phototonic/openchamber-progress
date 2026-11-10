// Synthetic plans for the dependency-map arrow-state QA (docs/ui.md, Dependency map › Arrows).
// Behaviour fixtures only: a small mixed plan covering the state table, the mid-size reference
// (100 tasks, 180 arrows, 12 eligible flows) and plans exactly at / one past the shipped bounds.
import type { ItemInput } from '../../shared/progress.ts';

type Status = 'pending' | 'working' | 'blocked' | 'done' | 'skipped';
const task = (id: string, title: string, status: Status, dependencies?: string[], parentId?: string): ItemInput =>
  ({ id, title, kind: 'task', status, ...(dependencies ? { dependencies } : {}), ...(parentId ? { parentId } : {}) });

/** 14 tasks: a chain of three, a fan-out of four converging on T8, plus one case per table cell. */
export const ARROW_SMALL: ItemInput[] = [
  task('T1', 'Collect requirements', 'done'),
  task('T2', 'Draft the data model', 'done', ['T1']),
  task('T3', 'Agree the API shape', 'done', ['T2']),
  task('T4', 'Build the import job', 'working', ['T3']),
  task('T5', 'Wire the export endpoint', 'blocked', ['T3']),
  task('T6', 'Write the migration', 'done', ['T3']),
  task('T7', 'Add the settings screen', 'pending', ['T3']),
  task('T8', 'End-to-end release check', 'pending', ['T4', 'T5', 'T6', 'T7']),
  task('S', 'Optional benchmark', 'skipped'),
  task('K', 'Compare benchmark results', 'pending', ['S', 'T4']),
  task('T9', 'Tune the import batch size', 'working', ['T4']),
  task('T10', 'Review import permissions', 'blocked', ['T4']),
  task('T11', 'Archive the old export', 'done', ['T5']),
  task('T12', 'Draft export notes', 'working', ['T5']),
];
/** Expected cue per recorded arrow of ARROW_SMALL ('' = existing style). */
export const ARROW_SMALL_CUES: Record<string, '' | 'working' | 'blocked'> = {
  'T1>T2': '', 'T2>T3': '', 'T3>T4': '', 'T3>T5': '', 'T3>T6': '', 'T3>T7': '',
  'T4>T8': 'working', 'T5>T8': 'blocked', 'T6>T8': '', 'T7>T8': '',
  'S>K': '', 'T4>K': 'working', 'T4>T9': '', 'T4>T10': 'working', 'T5>T11': '', 'T5>T12': 'blocked',
};

/**
 * The reference mid-size plan: 10 columns × 10 rows. Each task after the first column depends on the
 * same row and the next row (wrapping) of the previous column: 90 + 90 = 180 arrows. Columns 0–2 are
 * done, column 3 rows 0–5 working (rows 6–9 done), the rest pending: 6 working × 2 dependents = 12 flows.
 */
export function arrowMid(): ItemInput[] {
  const id = (c: number, r: number) => `M-${c}-${r}`;
  const items: ItemInput[] = [];
  for (let c = 0; c < 10; c++) for (let r = 0; r < 10; r++) {
    const status: Status = c < 3 ? 'done' : c === 3 ? (r < 6 ? 'working' : 'done') : 'pending';
    items.push(task(id(c, r), `Reference task ${c}-${r}`, status, c ? [id(c - 1, r), id(c - 1, (r + 1) % 10)] : undefined));
  }
  return items;
}

/** `n` working → pending pairs (n flows, n arrows), split over groups GA (first half) and GB. */
export function arrowFlows(n: number): ItemInput[] {
  const half = Math.ceil(n / 2);
  const items: ItemInput[] = [{ id: 'GA', title: 'First half', kind: 'group' }, { id: 'GB', title: 'Second half', kind: 'group' }];
  for (let i = 0; i < n; i++) {
    const g = i < half ? 'GA' : 'GB';
    items.push(task(`W${i}`, `Working source ${i}`, 'working', undefined, g), task(`P${i}`, `Waiting target ${i}`, 'pending', [`W${i}`], g));
  }
  return items;
}

/** Exactly `n` arrows with one flow: W (working) → H (pending), then H → D1 … D(n−1). Group GW holds W and H. */
export function arrowEdges(n: number): ItemInput[] {
  const items: ItemInput[] = [{ id: 'GW', title: 'Working pair', kind: 'group' }, task('W', 'Working source', 'working', undefined, 'GW'), task('H', 'Hub waiting on it', 'pending', ['W'], 'GW')];
  for (let i = 1; i < n; i++) items.push(task(`D${i}`, `Dependent ${i}`, 'pending', ['H']));
  return items;
}

/** Production writes through the shell's `reportMap` (start, or staged chunks above 50 items). */
export function seedArrowPlan(report: (plan: string, request: Record<string, unknown>) => void, plan: string, title: string, items: ItemInput[]) {
  if (items.length <= 50) { report(plan, { op: 'start', title, items }); return; }
  const upload = `arrows-${plan}`;
  for (let n = 0; n < items.length; n += 50) report(plan, { op: 'stage', upload, chunk: n / 50, items: items.slice(n, n + 50) });
  report(plan, { op: 'commit', title, upload, chunks: Math.ceil(items.length / 50) });
}
