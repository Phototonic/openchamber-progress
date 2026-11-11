// Wide-board selection panel: the controller's geometry contract (DOM-free). The rendered panel,
// close control, Tab order and canvas size are checked in the production final QA (wide board).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DependencyMapInteraction, MAP_PANEL, MAP_ZOOM, fitProjection, mapPanelWidth, mapRoom, type MapInteractionCommand, type MapInteractionInput } from '../../ui/shared/dependency-map-interaction.ts';
import { anchorSelection, DependencyMapLayout } from '../../ui/shared/dependency-map-layout.ts';
import type { ItemView } from '../../ui/shared/model.ts';
import { graphItems } from '../../shared/plan-graph.ts';

const metrics = { width: 220, height: 100, columnGap: 70, rowGap: 25 };
const task = (id: string, dependencies: string[] = [], status: ItemView['status'] = 'pending'): ItemView => ({ id, title: id, kind: 'task', status, dependencies });
// The reported plan's shape: a chain, a fan-out to four, convergence and a final task (8 tasks, 10 arrows, five columns, four rows).
const owner = [task('A', [], 'done'), task('B', ['A'], 'done'), ...['D1', 'D2', 'D3', 'D4'].map(id => task(id, ['B'], 'done')), task('J', ['D1', 'D2', 'D3', 'D4'], 'blocked'), task('E', ['J'])];
const chain = [task('A'), task('B', ['A']), task('C', ['B'])];
const EPS = 1e-6;

/** A frame as the board wires it: the panel and its cover come from the measured widths only. */
function frame(items: ItemView[], width: number, height: number, opts: { frame?: 'board' | 'rail'; mapWidth?: number } = {}) {
  const commands: MapInteractionCommand[] = [], layout = new DependencyMapLayout().compute(graphItems(items), metrics, width);
  const kind = opts.frame ?? 'board', panel = mapPanelWidth(kind, opts.mapWidth ?? width + 2, width);
  const c = new DependencyMapInteraction(command => commands.push(command));
  let input: MapInteractionInput = { identity: 'reading', items, layout, working: [], ready: [], status: 'all', viewport: { width, height, cover: panel ? panel + MAP_PANEL.margin : 0 }, ...(kind === 'board' ? { framingMax: MAP_ZOOM.fit } : {}) };
  c.identify(input.identity); c.enter(true); c.reconcile(input);
  const screen = (id: string) => { const p = layout.positions.get(id)!, t = c.value.transform; return { left: p.x * t.zoom + t.x, right: (p.x + metrics.width) * t.zoom + t.x, top: p.y * t.zoom + t.y, bottom: (p.y + metrics.height) * t.zoom + t.y }; };
  /** Right edge of the canvas part left of the open panel. */
  const room = () => width - (c.value.selected ? input.viewport.cover ?? 0 : 0);
  return { c, commands, layout, panel, screen, room, get input() { return input; }, resize(w: number, h = height, mapWidth = w + 2) { const p = mapPanelWidth(kind, mapWidth, w); input = { ...input, viewport: { width: w, height: h, cover: p ? p + MAP_PANEL.margin : 0 } }; c.reconcile(input); return p; } };
}

test('panel width: wide board only, from the measured map and canvas widths, never wider than its cap', () => {
  assert.equal(mapPanelWidth('board', MAP_PANEL.minMap - 1, 757), 0, 'below the threshold the inspector stays stacked');
  assert.equal(mapPanelWidth('rail', 2000, 1998), 0, 'the rail never has a panel');
  assert.equal(mapPanelWidth('board', 1500, 0), 0, 'unmeasured canvas: stacked');
  const narrow = mapPanelWidth('board', MAP_PANEL.minMap, 758);
  assert.ok(narrow > 0 && narrow <= 758 * MAP_PANEL.share + 0.5, 'at the threshold the panel leaves most of the canvas');
  assert.equal(mapPanelWidth('board', 1512, 1478), MAP_PANEL.width);
  assert.equal(mapPanelWidth('board', 2000, 1964), MAP_PANEL.width);
  assert.deepEqual(mapRoom({ width: 1478, height: 598, cover: 348 }, null), { width: 1478, height: 598 }, 'no selection: the whole canvas');
  assert.deepEqual(mapRoom({ width: 1478, height: 598, cover: 348 }, 'J'), { width: 1130, height: 598 });
});

test('Fit all on the board never magnifies past 100%; the rail keeps its framing limit', () => {
  const small = frame(chain, 1964, 598);
  small.c.dispatch({ type: 'fit' });
  assert.equal(small.c.value.transform.zoom, MAP_ZOOM.fit, 'a three-card chain on a wide board stops at 100%');
  const wide = frame(owner, 1478, 598);
  wide.c.dispatch({ type: 'fit' });
  assert.equal(wide.c.value.transform.zoom, 1, 'the reported plan fits at 100% on a 1920 px board');
  const fifteen = frame(Array.from({ length: 15 }, (_, n) => task(`T${n}`, n ? [`T${Math.floor((n - 1) / 2)}`] : [])), 1478, 598);
  fifteen.c.dispatch({ type: 'fit' });
  assert.deepEqual(fifteen.c.value.transform, fitProjection(fifteen.layout, fifteen.layout.order, { width: 1478, height: 598 }, 16, MAP_ZOOM.fit), 'below the cap Fit all is unchanged');
  const rail = frame([task('A')], 568, 460, { frame: 'rail' });
  rail.c.dispatch({ type: 'fit' });
  assert.ok(rail.c.value.transform.zoom > 1, 'the rail frames as before (no board cap)');
  assert.equal(rail.panel, 0);
});

test('far right: selecting pans just enough to clear the panel, never zooms or re-packs', () => {
  const f = frame(owner, 1478, 598);
  f.c.dispatch({ type: 'fit' });
  const before = f.c.value.transform, slots = JSON.stringify([...f.layout.positions]);
  assert.ok(f.screen('E').right > 1478 - f.panel - MAP_PANEL.margin, 'E starts where the panel will be');
  f.commands.length = 0;
  f.c.dispatch({ type: 'select', id: 'E' });
  const after = f.c.value.transform, e = f.screen('E');
  assert.equal(after.zoom, before.zoom, 'zoom unchanged');
  assert.equal(after.y, before.y, 'vertical position unchanged');
  assert.ok(after.x < before.x, 'the world pans left');
  assert.ok(Math.abs(e.right - (f.room() - 8)) < EPS, 'its right edge lands 8 px left of the panel');
  assert.ok(e.left >= 8 - EPS);
  assert.equal(JSON.stringify([...f.layout.positions]), slots, 'slots are untouched: cards keep their relative places');
  assert.equal(f.commands.filter(n => n.type === 'viewport').length, 1);
  // A card already on screen and clear of the panel does not move the view.
  assert.ok(f.screen('J').left >= 8 && f.screen('J').right <= f.room() - 8);
  f.c.dispatch({ type: 'select', id: 'J' });
  assert.deepEqual(f.c.value.transform, after);
  // Matches the shared anchoring with the panel-reduced canvas.
  const g = frame(owner, 1478, 598); g.c.dispatch({ type: 'fit' }); const t0 = g.c.value.transform;
  g.c.dispatch({ type: 'select', id: 'E' });
  assert.deepEqual(g.c.value.transform, anchorSelection(undefined, g.layout.positions.get('E')!, t0, metrics, { width: 1478 - g.panel - MAP_PANEL.margin, height: 598 }));
});

test('without a panel (narrow board, rail) selection anchoring is unchanged', () => {
  for (const f of [frame(owner, 518, 322), frame(owner, 568, 460, { frame: 'rail' })]) {
    assert.equal(f.panel, 0);
    f.c.dispatch({ type: 'fit' }); const t0 = f.c.value.transform;
    f.c.dispatch({ type: 'select', id: 'E' });
    assert.deepEqual(f.c.value.transform, anchorSelection(undefined, f.layout.positions.get('E')!, t0, metrics, { width: f.input.viewport.width, height: f.input.viewport.height }));
  }
});

test('Fit all and zoom with the panel open stay beside it; closing clears once and moves nothing', () => {
  const f = frame(owner, 1478, 598);
  f.c.dispatch({ type: 'select', id: 'J' });
  f.c.dispatch({ type: 'fit' });
  const t = f.c.value.transform;
  assert.ok(t.zoom <= MAP_ZOOM.fit);
  for (const id of f.layout.order) assert.ok(f.screen(id).right <= f.room() - 16 + EPS && f.screen(id).left >= 16 - EPS, `${id} beside the panel`);
  // Toolbar zoom keeps the centre of the visible part fixed, not a point under the panel.
  const centre = { x: f.room() / 2, y: 299 }, world = { x: (centre.x - t.x) / t.zoom, y: (centre.y - t.y) / t.zoom };
  f.c.dispatch({ type: 'zoom', factor: 1 / MAP_ZOOM.step });
  const z = f.c.value.transform;
  assert.ok(Math.abs((centre.x - z.x) / z.zoom - world.x) < EPS && Math.abs((centre.y - z.y) / z.zoom - world.y) < EPS);
  // The close control: the existing clear-selection action (one announcement, focus back to the card, no pan).
  f.commands.length = 0;
  f.c.dispatch({ type: 'clear' });
  assert.equal(f.c.value.selected, null);
  assert.deepEqual(f.c.value.transform, z, 'closing never moves the view');
  assert.deepEqual(f.commands.filter(n => n.type === 'announce').map(n => n.type === 'announce' && n.text), ['Selection cleared.']);
  assert.ok(f.commands.some(n => n.type === 'focus' && n.id === 'J' && n.reveal === false));
  f.commands.length = 0;
  f.c.dispatch({ type: 'clear' });
  assert.equal(f.commands.length, 0, 'closing with nothing selected is silent');
});

test('a resize with the panel open keeps the selection clear of it', () => {
  const f = frame(owner, 1964, 598);
  f.c.dispatch({ type: 'fit' }); f.c.dispatch({ type: 'select', id: 'E' });
  const zoom = f.c.value.transform.zoom;
  const panel = f.resize(1238);
  assert.ok(panel > 0);
  assert.equal(f.c.value.transform.zoom, zoom, 'a resize never zooms');
  assert.ok(f.screen('E').right <= f.room() - 8 + EPS && f.screen('E').left >= 8 - EPS);
  // Narrow enough to stack: the whole canvas is available again.
  assert.equal(f.resize(700), 0);
  assert.ok(f.screen('E').right <= 700 - 8 + EPS);
});
