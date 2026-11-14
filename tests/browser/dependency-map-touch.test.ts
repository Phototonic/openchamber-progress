// Touch gestures on the dependency map: pure controller rules (no DOM). Rendered touch behaviour is
// checked by phone-map-qa.ts in real Chromium with touch emulation (supporting evidence only).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DependencyMapInteraction, MAP_TOUCH, MAP_ZOOM, type MapInteractionCommand, type MapInteractionInput } from '../../ui/shared/dependency-map-interaction.ts';
import { mapCoarsePointer } from '../../ui/shared/dependency-map-view.ts';
import { DependencyMapLayout } from '../../ui/shared/dependency-map-layout.ts';
import type { ItemView } from '../../ui/shared/model.ts';
import { graphItems } from '../../shared/plan-graph.ts';

const metrics = { width: 220, height: 100, columnGap: 70, rowGap: 25 };
const task = (id: string, dependencies: string[] = [], status: ItemView['status'] = 'pending'): ItemView => ({ id, title: id, kind: 'task', status, dependencies });
const items = [task('A', [], 'done'), task('B', ['A'], 'working'), task('C', ['A']), task('D', ['B', 'C'])];
function setup(patch: Partial<MapInteractionInput> = {}) {
  const commands: MapInteractionCommand[] = [];
  const c = new DependencyMapInteraction(command => commands.push(command));
  const input: MapInteractionInput = { identity: 'reading-a', items, layout: new DependencyMapLayout().compute(graphItems(items), metrics, 358), working: ['B'], ready: ['C'], viewport: { width: 358, height: 420 }, status: 'all', ...patch };
  c.identify(input.identity); c.enter(true); c.reconcile(input);
  return { c, commands };
}
const origin = { x: 16, y: 200 };
const touchDown = (c: DependencyMapInteraction, pointerId: number, x: number, y: number, background = true) =>
  c.dispatch({ type: 'pointer-down', pointerId, point: { x, y }, background, primary: true, touch: true, origin });
const move = (c: DependencyMapInteraction, pointerId: number, x: number, y: number) => c.dispatch({ type: 'pointer-move', pointerId, point: { x, y } });
const end = (c: DependencyMapInteraction, pointerId: number, x: number, y: number, cancelled = false) => c.dispatch({ type: 'pointer-end', pointerId, point: { x, y }, cancelled });
const captures = (commands: MapInteractionCommand[]) => commands.flatMap(x => x.type === 'capture' ? [`${x.pointerId}:${x.capture}`] : []);

test('a finger on a card is a tap until it moves past the slop; then it pans without clearing', () => {
  const { c, commands } = setup();
  c.dispatch({ type: 'select', id: 'B' }); commands.length = 0;
  // Tap on a card: no capture (the native click must reach the card), no clear, no pan.
  const before = c.value.transform;
  touchDown(c, 1, 100, 300, false); move(c, 1, 100 + MAP_TOUCH.slop - 1, 300); end(c, 1, 100 + MAP_TOUCH.slop - 1, 300);
  assert.deepEqual(captures(commands), []);
  assert.deepEqual(c.value.transform, before);
  assert.equal(c.value.selected, 'B');
  assert.equal(c.value.dragging, null);
  // Drag from a card: captured once it pans, follows the finger, never clears.
  commands.length = 0;
  touchDown(c, 2, 100, 300, false); move(c, 2, 130, 280); move(c, 2, 160, 260);
  assert.deepEqual(captures(commands), ['2:true']);
  assert.deepEqual([c.value.transform.x - before.x, c.value.transform.y - before.y], [60, -40]);
  end(c, 2, 160, 260);
  assert.equal(c.value.selected, 'B');
  assert.deepEqual(captures(commands), ['2:true', '2:false']);
});

test('a background tap clears once like a click; a background touch pan keeps the selection', () => {
  const { c, commands } = setup();
  c.dispatch({ type: 'select', id: 'B' }); commands.length = 0;
  touchDown(c, 1, 50, 250); move(c, 1, 50 + MAP_TOUCH.slop + 5, 250); end(c, 1, 50 + MAP_TOUCH.slop + 5, 250);
  assert.equal(c.value.selected, 'B');
  // Within the touch slop a background press is still a tap (desktop's 5 px would call it a drag).
  touchDown(c, 2, 50, 250); move(c, 2, 57, 250); end(c, 2, 57, 250);
  assert.equal(c.value.selected, null);
  assert.deepEqual(commands.filter(x => x.type === 'announce').map(x => x.text), ['Selection cleared.']);
  // A cancelled finger (the browser took the gesture) never clears.
  c.dispatch({ type: 'select', id: 'C' });
  touchDown(c, 3, 50, 250); end(c, 3, 50, 250, true);
  assert.equal(c.value.selected, 'C');
});

test('two fingers pinch around their midpoint, clamp, and hand back to a one-finger pan', () => {
  const { c, commands } = setup();
  c.dispatch({ type: 'select', id: 'B' }); commands.length = 0;
  const t0 = c.value.transform;
  touchDown(c, 1, 116, 300, false); touchDown(c, 2, 216, 300);
  assert.equal(c.value.pinching, 2);
  assert.deepEqual(captures(commands), ['1:true', '2:true']);
  // Spread to double the distance around the same midpoint (166,300 client = 150,100 canvas).
  move(c, 1, 66, 300); move(c, 2, 266, 300);
  const t1 = c.value.transform, mid = { x: 150, y: 100 };
  assert.ok(Math.abs(t1.zoom - Math.min(MAP_ZOOM.max, t0.zoom * 2)) < 1e-9, `zoom ${t1.zoom}`);
  // The world point under the midpoint stays under it.
  assert.ok(Math.abs((mid.x - t0.x) / t0.zoom - (mid.x - t1.x) / t1.zoom) < 1e-6);
  assert.ok(Math.abs((mid.y - t0.y) / t0.zoom - (mid.y - t1.y) / t1.zoom) < 1e-6);
  // Never past the shipped maximum, and a pinch alone never goes below MAP_TOUCH.pinchMin.
  move(c, 1, -2000, 300); move(c, 2, 2000, 300);
  assert.equal(c.value.transform.zoom, MAP_ZOOM.max);
  move(c, 1, 165, 300); move(c, 2, 167, 300);
  assert.equal(c.value.transform.zoom, MAP_TOUCH.pinchMin);
  // Lift one finger: the other keeps panning from where it is, with no jump and no clear.
  end(c, 1, 165, 300);
  assert.equal(c.value.pinching, null); assert.equal(c.value.dragging, 2);
  const t2 = c.value.transform;
  move(c, 2, 177, 310);
  assert.deepEqual([c.value.transform.x - t2.x, c.value.transform.y - t2.y], [10, 10]);
  end(c, 2, 177, 310);
  assert.equal(c.value.selected, 'B'); assert.equal(c.value.dragging, null);
  assert.deepEqual(captures(commands).slice(-2), ['1:false', '2:false']);
});

test('a pinch never zooms out further than an existing lower zoom; a third finger is ignored', () => {
  const { c } = setup();
  c.dispatch({ type: 'zoom', factor: 0.05 / c.value.transform.zoom });
  const low = c.value.transform.zoom;
  assert.ok(low < MAP_TOUCH.pinchMin);
  touchDown(c, 1, 100, 300); touchDown(c, 2, 200, 300);
  assert.equal(touchDown(c, 3, 150, 350), false);
  move(c, 1, 140, 300);
  assert.equal(c.value.transform.zoom, low);
  move(c, 1, 0, 300);
  assert.ok(c.value.transform.zoom > low);
  end(c, 2, 200, 300); end(c, 1, 0, 300);
  assert.equal(c.value.dragging, null);
});

test('mouse and pen keep the desktop rules: background-only, primary button, 5 px threshold', () => {
  const { c, commands } = setup();
  c.dispatch({ type: 'select', id: 'B' }); commands.length = 0;
  assert.equal(c.dispatch({ type: 'pointer-down', pointerId: 1, point: { x: 10, y: 10 }, primary: true, background: false }), false);
  assert.equal(c.dispatch({ type: 'pointer-down', pointerId: 1, point: { x: 10, y: 10 }, primary: false, background: true }), false);
  c.dispatch({ type: 'pointer-down', pointerId: 1, point: { x: 10, y: 10 }, primary: true, background: true });
  assert.deepEqual(captures(commands), ['1:true']);
  // A second mouse/pen pointer never pinches.
  assert.equal(c.dispatch({ type: 'pointer-down', pointerId: 2, point: { x: 40, y: 10 }, primary: true, background: true }), false);
  assert.equal(c.value.pinching, null);
  c.dispatch({ type: 'pointer-end', pointerId: 1, point: { x: 16, y: 10 } });
  assert.equal(c.value.selected, 'B');
});

test('coarse pointers frame current work at full size; fine pointers accept 75%', () => {
  const wide = [task('W1', [], 'working'), task('W2', [], 'working'), task('W3', [], 'working'), task('X', ['W1', 'W2', 'W3'])];
  const layout = new DependencyMapLayout().compute(graphItems(wide), metrics, 358);
  const base = { items: wide, layout, working: ['W1', 'W2', 'W3'], ready: [], viewport: { width: 358, height: 300 } };
  const fine = setup(base).c.value.transform.zoom, coarse = setup({ ...base, readable: MAP_TOUCH.readable }).c.value.transform.zoom;
  // Three stacked working cards fit at about 77%: readable enough for a fine pointer, so it frames them all.
  assert.ok(fine >= MAP_ZOOM.readable && fine < MAP_TOUCH.readable, `fine ${fine}`);
  // A coarse pointer centres the first working card at full size instead.
  assert.equal(coarse, MAP_TOUCH.readable);
});

test('coarse pointer: the host hint wins over the media query; absent hint falls back to media', () => {
  const media = (matches: boolean) => () => ({ matches });
  assert.equal(mapCoarsePointer({ formFactor: 'phone', pointer: 'coarse', insets: { top: 0, right: 0, bottom: 0, left: 0 }, keyboard: 0 } as never, media(false)), true);
  assert.equal(mapCoarsePointer({ formFactor: 'desktop', pointer: 'fine', insets: { top: 0, right: 0, bottom: 0, left: 0 }, keyboard: 0 } as never, media(true)), false);
  assert.equal(mapCoarsePointer(undefined, media(true)), true);
  assert.equal(mapCoarsePointer(undefined, media(false)), false);
  assert.equal(mapCoarsePointer(undefined, undefined), false);
});
