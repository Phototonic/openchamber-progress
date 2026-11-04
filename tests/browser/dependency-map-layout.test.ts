import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { graphItems } from '../../shared/plan-graph.ts';
import { DependencyMapLayout, anchorSelection, neighbour, relations, type MapLayout } from '../../ui/shared/dependency-map-layout.ts';
import { largePlanSteps } from '../fixtures/large-plan.ts';
import { mapItems, MAP_FIXTURE_VERSION } from '../fixtures/dependency-map.ts';

const metrics = { width: 220, height: 104, columnGap: 48, rowGap: 24 };
function invariant(layout: MapLayout) {
  const slots = new Set<string>();
  for (const p of layout.positions.values()) { const key = `${p.column}:${p.row}`; assert.ok(!slots.has(key)); slots.add(key); }
  for (const [a, b] of layout.edges) assert.ok(layout.positions.get(a)!.column < layout.positions.get(b)!.column);
}
test('deterministic task-only layout, filters/content invariant, invalid input fails closed and pure navigation', () => {
  const input = graphItems(mapItems.map(i => ({ ...i, status: i.status ?? 'pending' }))), cache = new DependencyMapLayout();
  const a = cache.compute(input, metrics, 600); invariant(a);
  assert.equal(a.positions.has('G'), false); assert.equal(a.positions.has('G-inner'), false);
  assert.deepEqual([...a.positions], [...new DependencyMapLayout().compute(input, metrics, 600).positions]);
  assert.ok(a.edges.some(([from, to]) => from === 'A' && to === 'B'));
  const changed = input.map(i => ({ ...i, status: 'done' as const }));
  assert.equal(cache.compute(changed, metrics, 360), a, 'connected resize and status do not move geometry');
  const visible = new Set(['A', 'B']); neighbour(a, 'A', visible, 'right'); assert.equal(cache.compute(input, metrics, 600), a, 'projection filters are not layout inputs');
  assert.deepEqual(relations(a, 'D', 'upstream'), ['B', 'C']); assert.equal(neighbour(a, 'A', new Set(['A']), 'left'), null);
  const t = anchorSelection(a.positions.get('A'), a.positions.get('D')!, { x: -900, y: -800, zoom: 1 }, metrics, { width: 360, height: 400 });
  const p = a.positions.get('D')!; assert.ok(p.x + t.x >= 8); assert.ok(p.x + t.x + metrics.width <= 352); assert.ok(p.y + t.y >= 8);
  for (const bad of [
    [...input, input[0]], input.map(i => i.id === 'A' ? { ...i, dependencies: ['D'] } : i),
    input.map(i => i.id === 'A' ? { ...i, dependencies: ['missing'] } : i), input.map(i => i.id === 'A' ? { ...i, dependencies: ['G'] } : i),
  ]) assert.throws(() => cache.compute(bad, metrics, 600));
  const edgeless = input.filter(i => i.kind === 'task').map(i => ({ ...i, parentId: null, dependencies: [] }));
  const sparse = new DependencyMapLayout(); const packed = sparse.compute(edgeless, metrics, 600); invariant(packed);
  assert.equal(packed.positions.get(edgeless[1].id)!.row, 0); assert.equal(packed.positions.get(edgeless[2].id)!.row, 1);
  assert.equal(sparse.compute(edgeless, metrics, 360).positions.get(edgeless[1].id)!.column, 0);
  assert.equal(new DependencyMapLayout().compute([{ id: 'G', kind: 'group', status: 'pending', parentId: null, dependencies: [] }], metrics, 360).positions.size, 0);
});

test('large-plan S0–S8: exact status/title invariance, retained feasible columns, observed removal forgets reuse', () => {
  const cache = new DependencyMapLayout(), checkpoints: { id: string; moved: string[]; tasks: number }[] = [];
  let previous: MapLayout | null = null;
  for (const step of largePlanSteps()) {
    const layout = cache.compute(graphItems(step.items), metrics, 1100); invariant(layout);
    const moved: string[] = previous ? layout.order.filter(id => previous!.positions.has(id) && JSON.stringify(layout.positions.get(id)) !== JSON.stringify(previous!.positions.get(id))) : [];
    if (['S1', 'S2', 'S3', 'S4', 'S8'].includes(step.id)) { assert.equal(layout, previous); assert.equal(moved.length, 0); }
    if (step.id === 'S5') for (const [id, p] of layout.positions) {
      const old = previous!.positions.get(id); if (!old) continue;
      const incoming = layout.edges.filter(([, b]) => b === id).map(([a]) => layout.positions.get(a)!.column + 1);
      assert.equal(p.column, Math.max(old.column, 0, ...incoming));
    }
    checkpoints.push({ id: step.id, moved, tasks: layout.positions.size }); previous = layout;
  }
  const reuse = new DependencyMapLayout();
  const task = (id: string, dependencies: string[] = []) => ({ id, kind: 'task' as const, status: 'pending' as const, parentId: null, dependencies });
  reuse.compute([task('A'), task('B', ['A']), task('C', ['B'])], metrics, 600);
  const removed = reuse.compute([task('A'), task('B', ['A'])], metrics, 600); assert.equal(removed.positions.has('C'), false);
  const reused = reuse.compute([task('A'), task('B', ['A']), task('C')], metrics, 600); assert.equal(reused.positions.get('C')!.column, 0);
  if (process.env.EVIDENCE) { mkdirSync(process.env.EVIDENCE, { recursive: true }); writeFileSync(`${process.env.EVIDENCE}/results.json`, JSON.stringify({ fixture: MAP_FIXTURE_VERSION, runtime: process.version, passed: true, checks: ['task-only', 'directed-recorded-pairs', 'no-slot-overlap', 'deterministic', 'status-title-filter-invariance', 'conservative-columns', 'observed-removal-reuse', 'invalid-fail-closed', 'anchor-math', 'neighbour-and-relations'], checkpoints, note: 'Pure geometry, not rendered performance or root-repaint interaction proof.' }, null, 2) + '\n'); }
});
