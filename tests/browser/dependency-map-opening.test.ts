import assert from 'node:assert/strict';
import { test } from 'node:test';
import { graphItems } from '../../shared/plan-graph.ts';
import { DependencyMapLayout } from '../../ui/shared/dependency-map-layout.ts';
import { DependencyMapInteraction, fitProjection, type MapInteractionCommand, type MapInteractionInput } from '../../ui/shared/dependency-map-interaction.ts';
import type { ItemView } from '../../ui/shared/model.ts';
import { arrowMid } from '../fixtures/dependency-map-arrows.ts';
import { generateLargePlan } from '../fixtures/large-plan.ts';

const metrics = { width: 220, height: 100, columnGap: 70, rowGap: 25 };
const task = (id: string, status: ItemView['status'] = 'pending', dependencies: string[] = []): ItemView => ({ id, title: id, kind: 'task', status, dependencies });
function open(items: ItemView[], width: number, height = 300, patch: Partial<MapInteractionInput> = {}) {
  const commands: MapInteractionCommand[] = [];
  const c = new DependencyMapInteraction(command => commands.push(command));
  const input: MapInteractionInput = {
    identity: 'reading', items, layout: new DependencyMapLayout().compute(graphItems(items), metrics, width),
    working: items.filter(i => i.status === 'working').map(i => i.id), ready: [], status: 'all',
    viewport: { width, height }, framingMax: 1, ...patch,
  };
  c.identify(input.identity); c.enter(false); c.reconcile(input);
  return { c, input, commands };
}

test('opening fits a readable whole plan; a standard two-column rail opens at 80%', () => {
  const items = [task('A', 'working'), task('B', 'pending', ['A'])];
  const board = open(items, 930);
  assert.deepEqual(board.c.value.transform, fitProjection(board.input.layout, ['A', 'B'], board.input.viewport, 16, 1));
  // Usable canvas widths, after the standard rail's surrounding padding.
  for (const width of [328, 338, 348, 368]) {
    const rail = open(items, width);
    assert.equal(rail.c.value.transform.zoom, .8);
    assert.equal(rail.c.value.selected, null);
    assert.equal(rail.commands.some(c => c.type === 'focus' || c.type === 'selection'), false);
    const before = rail.c.value.transform;
    rail.c.dispatch({ type: 'pan', x: 23, y: -17 });
    rail.c.reconcile({ ...rail.input, working: ['B'] });
    assert.deepEqual(rail.c.value.transform, { ...before, x: before.x + 23, y: before.y - 17 });
    rail.c.dispatch({ type: 'fit' });
    assert.deepEqual(rail.c.value.transform, fitProjection(rail.input.layout, ['A', 'B'], rail.input.viewport, 16, 1));
  }
});

test('current-work opening uses direct neighbours only and picks working before Needs you then ready in stored order', () => {
  const items = [task('N', 'blocked'), task('W1', 'working'), task('W2', 'working'), task('R'), task('D', 'pending', ['W1']), task('T', 'pending', ['D'])];
  const near = open(items, 930, 300, { needsYou: ['N'] });
  assert.equal(near.c.value.transform.zoom, .8);
  // Work group is too tall: centre W1, not the first blocked item or ready item.
  const slot = near.input.layout.positions.get('W1')!;
  assert.equal(near.c.value.transform.y, 150 - (slot.y + 50) * .8);
  const blocked = open(items, 330, 300, { working: [], needsYou: ['N'], ready: ['R'] });
  const n = blocked.input.layout.positions.get('N')!;
  assert.equal(blocked.c.value.transform.y, 150 - (n.y + 50) * .8);
  const ready = open(items, 330, 300, { working: [], needsYou: [], ready: ['R'] });
  const r = ready.input.layout.positions.get('R')!;
  assert.equal(ready.c.value.transform.y, 150 - (r.y + 50) * .8);
});

test('no current work and closed plans fit all; coarse current work stays full size', () => {
  const items = Array.from({ length: 8 }, (_, n) => task(`T${n}`, n === 4 ? 'working' : 'pending', n ? [`T${n - 1}`] : []));
  for (const patch of [{ working: [], ready: [] }, { guidance: false }]) {
    const f = open(items, 330, 300, patch);
    assert.deepEqual(f.c.value.transform, fitProjection(f.input.layout, f.input.layout.order, f.input.viewport, 16, 1));
  }
  const coarse = open(items, 330, 300, { readable: 1 });
  assert.equal(coarse.c.value.transform.zoom, 1);
});

test('opening threshold includes 70%; current-work framing includes direct neighbours, not transitive ones', () => {
  const pair = [task('A', 'working'), task('B', 'pending', ['A'])];
  assert.equal(open(pair, 389).c.value.transform.zoom, .7);
  assert.equal(open(pair, 388).c.value.transform.zoom, .8);
  const chain = [task('A', 'done'), task('B', 'working', ['A']), task('C', 'pending', ['B']), task('D', 'pending', ['C']), task('E', 'pending', ['D'])];
  const f = open(chain, 750);
  assert.equal(f.c.value.transform.zoom, .8);
  const x = f.input.layout.positions.get('B')!.x + metrics.width / 2;
  assert.equal(f.c.value.transform.x + x * .8, 375);
});

test('reference 100-task and 980-task plans use current work on rail and board; Fit shows all', () => {
  for (const seed of [arrowMid(), generateLargePlan()]) for (const width of [330, 570, 930, 1478]) {
    const f = open(seed.map(i => ({ ...i, status: i.status ?? 'pending' })), width, width > 600 ? 540 : 300);
    assert.equal(f.c.value.transform.zoom, .8);
    assert.equal(f.c.value.selected, null);
    f.c.dispatch({ type: 'fit' });
    assert.deepEqual(f.c.value.transform, fitProjection(f.input.layout, f.input.layout.order, f.input.viewport, 16, 1));
  }
});

test('Focus current work restores opening framing without selection, focus or filter changes and announces once', () => {
  const f = open([task('A', 'working'), task('B', 'pending', ['A']), task('C', 'done')], 330, 540);
  f.c.dispatch({ type: 'filters', status: 'unfinished', group: null });
  f.c.dispatch({ type: 'current' });
  const target = f.c.value.transform;
  f.c.dispatch({ type: 'select', id: 'B' });
  f.c.dispatch({ type: 'fit' });
  f.c.dispatch({ type: 'pan', x: 100, y: -80 });
  f.commands.length = 0;
  f.c.dispatch({ type: 'current' });
  assert.deepEqual(f.c.value.transform, target);
  assert.equal(f.c.value.selected, 'B');
  assert.equal(f.c.value.status, 'unfinished');
  assert.equal(f.c.value.group, null);
  assert.deepEqual(f.commands.filter(c => c.type === 'announce').map(c => c.type === 'announce' && c.message), [{ kind: 'current' }]);
  assert.equal(f.commands.some(c => c.type === 'selection' || c.type === 'focus' || c.type === 'filters'), false);
});
