import type { ItemInput } from '../../shared/progress.ts';
import { searchFixture } from './plan-task-search.ts';

export const MAP_FIXTURE_VERSION = 'dependency-map-v1';
export const mapItems: ItemInput[] = [
  { id: 'G', title: 'Recorded context', kind: 'group' },
  { id: 'G-inner', title: 'Inner context', kind: 'group', parentId: 'G' },
  { id: 'A', title: 'Prepare Δ <img src=x onerror=alert(1)>', kind: 'task', status: 'done', parentId: 'G-inner' },
  { id: 'B', title: 'Build a deliberately long Unicode branch — 日本語 — with full inspection context', kind: 'task', status: 'working', dependencies: ['A'] },
  { id: 'C', title: 'Review branch', kind: 'task', dependencies: ['A'] },
  { id: 'D', title: 'Join both unfinished branches', kind: 'task', dependencies: ['B', 'C'] },
  { id: 'E', title: 'Sole remaining prerequisite', kind: 'task', dependencies: ['A', 'B'] },
  { id: 'F', title: 'Explicitly blocked despite done prerequisite', kind: 'task', status: 'blocked', dependencies: ['A'] },
  { id: 'S', title: 'Skipped prerequisite', kind: 'task', status: 'skipped' },
  { id: 'W', title: 'Waiting on skipped work', kind: 'task', dependencies: ['S'] },
  { id: 'I', title: 'Isolated task', kind: 'task' },
];
export function seedMapFixture(f: ReturnType<typeof searchFixture>) {
  f.seedPlan('P-map', 'Dependency map fixture', mapItems);
  f.seedPlan('P-map-none', 'No recorded prerequisites', [{ id: 'A', title: 'First task', kind: 'task' }, { id: 'B', title: 'Second task', kind: 'task' }]);
  f.seedPlan('P-map-groups', 'Group metadata', [{ id: 'G', title: 'Group-owned prerequisite', kind: 'group', dependencies: ['A'] }, { id: 'A', title: 'Independent task', kind: 'task', parentId: 'G' }]);
  f.seedPlan('P-map-empty', 'Empty plan', []);
  f.seedPlan('P-map-finished', 'Finished plan', [{ id: 'A', title: 'Completed task', kind: 'task', status: 'done' }]);
  f.apply('P-map-finished', { op: 'finish', outcome: 'finished' });
  f.seedPlan('P-map', 'Independent source counterpart', mapItems, { ...f.actor, sourceId: f.beta.id });
}
