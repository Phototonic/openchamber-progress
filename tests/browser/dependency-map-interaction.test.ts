import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DependencyMapInteraction, MAP_ZOOM, zoomAt, fitProjection, mapAnnouncementText, type MapInteractionCommand, type MapInteractionInput } from '../../ui/shared/dependency-map-interaction.ts';
import { DependencyMapLayout, neighbour } from '../../ui/shared/dependency-map-layout.ts';
import type { ItemView } from '../../ui/shared/model.ts';
import { graphItems } from '../../shared/plan-graph.ts';
import { largePlanSteps } from '../fixtures/large-plan.ts';

const metrics = { width: 220, height: 100, columnGap: 70, rowGap: 25 };
const task = (id: string, dependencies: string[] = [], status: ItemView['status'] = 'pending'): ItemView => ({ id, title: id, kind: 'task', status, dependencies });
const items = [task('A', [], 'done'), task('B', ['A'], 'working'), task('C', ['A']), task('D', ['B', 'C'])];
test('map announcements carry facts and render Russian without changing recorded titles', () => {
  const { c, commands } = setup();
  c.dispatch({ type: 'select', id: 'B' });
  const speech = commands.find(n => n.type === 'announce');
  assert.ok(speech?.type === 'announce' && speech.message?.kind === 'selection');
  assert.match(mapAnnouncementText(speech.message, 'ru'), /^B\. Сообщено: в работе\./);
  for (const [count, word] of [[0, 'задач'], [1, 'задача'], [2, 'задачи'], [5, 'задач'], [11, 'задач'], [21, 'задача']] as const)
    assert.equal(mapAnnouncementText({ kind: 'filters', count }, 'ru'), `Показано: ${count} ${word}. Расположение не изменено.`);
});
test('map announcements format the supported 1000-task count without changing English or facts', () => {
  const filters = Object.freeze({ kind: 'filters' as const, count: 1000 });
  const fit = Object.freeze({ kind: 'fit' as const, count: 1000 });
  assert.equal(mapAnnouncementText(filters, 'ru'), 'Показано: 1\u00a0000 задач. Расположение не изменено.');
  assert.equal(mapAnnouncementText(fit, 'ru'), 'Вся карта: 1\u00a0000 задач в поле зрения; действующие фильтры не изменены.');
  assert.equal(mapAnnouncementText(filters, 'en'), '1000 tasks shown. Layout unchanged.');
  assert.equal(mapAnnouncementText(fit, 'en'), 'Fit all: 1000 visible tasks; active filters unchanged.');
  assert.equal(filters.count, 1000);
  assert.equal(fit.count, 1000);
});
test('Russian map speech distinguishes readiness guidance and reported status; plural messages are whole', () => {
  const selection = { kind: 'selection' as const, title: '<Literal task>', status: 'pending' as const, guidance: true, ready: true, skipped: false, up: 1, down: 2, hidden: 5 };
  assert.equal(mapAnnouncementText(selection, 'ru'), '<Literal task>. Готова, только по записанным зависимостям. Прямые записанные зависимости: 1 зависимость; прямые зависимые задачи: 2 задачи. Фильтрами скрыто: 5 связей.');
  assert.match(mapAnnouncementText({ ...selection, guidance: false }, 'ru'), /Сообщено: ожидает/);
  assert.match(mapAnnouncementText({ ...selection, ready: false, skipped: true }, 'ru'), /Ожидает пропущенную записанную зависимость/);
  assert.match(mapAnnouncementText({ ...selection, status: 'blocked' }, 'ru'), /Явно заблокирована/);
  assert.match(mapAnnouncementText({ ...selection, status: 'done' }, 'ru'), /Сообщено: выполнена/);
  assert.equal(mapAnnouncementText({ kind: 'fit', count: 21 }, 'ru'), 'Вся карта: 21 задача в поле зрения; действующие фильтры не изменены.');
  assert.equal(mapAnnouncementText({ kind: 'filters', count: 1 }), '1 task shown. Layout unchanged.');
  assert.match(mapAnnouncementText({ kind: 'focused-removed' }, 'ru'), /Задача в фокусе больше не записана/);
});
function setup(width = 600) {
  const commands: MapInteractionCommand[] = [], cache = new DependencyMapLayout();
  const c = new DependencyMapInteraction(command => commands.push(command));
  let input: MapInteractionInput = { identity: 'reading-a', items, layout: cache.compute(graphItems(items), metrics, width), working: ['B'], ready: ['C'], viewport: { width, height: 400 }, status: 'all' };
  c.identify(input.identity); c.enter(true); c.reconcile(input);
  return { c, commands, cache, get input() { return input; }, update(patch: Partial<MapInteractionInput>) { input = { ...input, ...patch }; c.reconcile(input); } };
}
test('zoom limits and point anchor; visible fit and readable initial framing without implicit selection', () => {
  const t = { x: -100, y: 20, zoom: 1 }, point = { x: 130, y: 80 };
  const z = zoomAt(t, 1.5, point);
  assert.equal((point.x - t.x) / t.zoom, (point.x - z.x) / z.zoom);
  assert.equal((point.y - t.y) / t.zoom, (point.y - z.y) / z.zoom);
  assert.equal(zoomAt(t, 100, point).zoom, MAP_ZOOM.max); assert.equal(zoomAt(t, .000001, point).zoom, MAP_ZOOM.min);
  const { c, input, update } = setup(360);
  assert.equal(c.value.selected, null); assert.equal(c.value.initialFramingDone, true);
  assert.ok(c.value.transform.zoom >= MAP_ZOOM.readable);
  c.dispatch({ type: 'pan', x: -17, y: 9 }); const before = c.value;
  update({ working: ['D'], ready: [] }); assert.deepEqual(c.value.transform, before.transform);
  c.dispatch({ type: 'filters', status: 'unfinished' }); c.dispatch({ type: 'fit' });
  assert.deepEqual(c.value.transform, fitProjection(input.layout, ['B', 'C', 'D'], input.viewport));
});
test('selection, filter-specific relation reveal, physical navigation and scoped keys', () => {
  const { c, commands, input, update } = setup();
  c.dispatch({ type: 'filters', status: 'unfinished' });
  c.dispatch({ type: 'select', id: 'B' }); assert.deepEqual(c.hiddenRelations('B', 'upstream'), ['A']);
  assert.equal(c.dispatch({ type: 'key', key: '[', canvas: false }), false);
  assert.equal(c.dispatch({ type: 'key', key: '[', canvas: true, modified: true }), false);
  assert.equal(c.dispatch({ type: 'key', key: '[', canvas: true, editable: true }), false);
  c.dispatch({ type: 'key', key: '[', canvas: true }); assert.equal(c.value.selected, 'A'); assert.equal(c.value.status, 'all');
  c.dispatch({ type: 'key', key: ']', canvas: true }); assert.equal(c.value.selected, 'B');
  const before = commands.filter(n => n.type === 'announce').length;
  update({ status: c.value.status }); update({}); assert.equal(commands.filter(n => n.type === 'announce').length, before);
  c.dispatch({ type: 'select', id: 'B' }); assert.equal(commands.filter(n => n.type === 'announce').length, before);
  assert.equal(neighbour(input.layout, 'A', new Set(['A']), 'right'), null);
  // Symmetric equidistant candidates tie by stored order, never wrap.
  const layout = { ...input.layout, order: ['A', 'C', 'B'], positions: new Map([['A', { x: 0, y: 0, row: 0, column: 0 }], ['B', { x: 1, y: 1, row: 1, column: 1 }], ['C', { x: 1, y: -1, row: 0, column: 1 }]]) };
  assert.equal(neighbour(layout, 'A', new Set(layout.order), 'right'), 'C');
  assert.equal(neighbour(layout, 'B', new Set(layout.order), 'right'), null);
});
test('whole-root independence, resize, gesture-over-refresh and no card dragging', () => {
  const { c, input, update, commands } = setup(360);
  c.dispatch({ type: 'select', id: 'D', focus: true }); c.dispatch({ type: 'zoom', factor: 1.1 });
  const zoom = c.value.transform.zoom;
  update({ viewport: { width: 600, height: 400 } }); update({ viewport: input.viewport }); assert.equal(c.value.transform.zoom, zoom);
  assert.equal(c.dispatch({ type: 'pointer-down', pointerId: 1, point: { x: 0, y: 0 }, primary: true, background: false }), false);
  c.dispatch({ type: 'pointer-down', pointerId: 1, point: { x: 10, y: 10 }, primary: true, background: true });
  c.dispatch({ type: 'pointer-move', pointerId: 1, point: { x: 20, y: 30 } });
  const before = c.value.transform; update({}); assert.deepEqual(c.value.transform, before); assert.equal(c.value.dragging, 1);
  c.dispatch({ type: 'pointer-move', pointerId: 1, point: { x: 25, y: 35 } }); assert.equal(c.value.transform.x, before.x + 5);
  c.leave(); assert.equal(c.value.dragging, null); assert.ok(commands.some(n => n.type === 'capture' && !n.capture));
  c.enter(false); assert.equal(c.value.selected, 'D'); assert.equal(c.value.initialFramingDone, true);
  c.identify('reading-b'); assert.equal(c.value.selected, null); assert.equal(c.value.group, null); assert.equal(c.value.status, 'all'); assert.equal(c.value.initialFramingDone, false);
});
test('Tab without selection: removal restores the focused roving target once, next then previous then heading', () => {
  for (const scenario of ['next', 'previous', 'heading', 'unfocused'] as const) {
    const { c, commands, cache, update } = setup();
    const initial = [task('A'), ...(scenario === 'next' || scenario === 'unfocused' ? [task('B'), task('C')] : [])];
    update({ items: initial, layout: cache.compute(graphItems(initial), metrics, 600) });
    // Entry/Tab owns canvas focus but deliberately does not select a task.
    c.focusOwner(scenario !== 'unfocused');
    c.dispatch({ type: 'canvas-focus', id: scenario === 'unfocused' ? null : 'A' });
    assert.equal(c.value.selected, null); assert.equal(c.value.roving, 'A');
    if (scenario === 'previous') {
      const inserted = [task('B'), task('A')];
      update({ items: inserted, layout: cache.compute(graphItems(inserted), metrics, 600) });
      assert.equal(c.value.roving, 'A');
    }
    commands.length = 0;
    const remaining = scenario === 'heading' ? [] : [task('B'), ...(scenario === 'next' || scenario === 'unfocused' ? [task('C')] : [])];
    update({ items: remaining, layout: cache.compute(graphItems(remaining), metrics, 600) });
    const fallback = scenario === 'heading' ? null : 'B';
    assert.equal(c.value.selected, null, 'focus fallback must not manufacture selection');
    assert.equal(c.value.roving, fallback);
    assert.deepEqual(commands.filter(n => n.type === 'focus'), scenario === 'unfocused' ? [] : [{ type: 'focus', id: fallback, generation: c.value.generation }]);
    assert.equal(commands.filter(n => n.type === 'announce').length, scenario === 'unfocused' ? 0 : 1);
    commands.length = 0; update({});
    assert.equal(commands.filter(n => n.type === 'focus' || n.type === 'announce').length, 0, 'ordinary repaints never replay the fallback');
  }
});
test('toolbar or view-switch focus survives roving removal silently, with or without selection', () => {
  for (const selected of [false, true]) {
    const { c, commands, cache, update } = setup();
    const tasks = [task('A'), task('B')];
    update({ items: tasks, layout: cache.compute(graphItems(tasks), metrics, 600) });
    if (selected) c.dispatch({ type: 'select', id: 'A' });
    c.focusOwner(true);
    // The map still owns focus, but a surviving toolbar/switch control is not a canvas card.
    c.dispatch({ type: 'canvas-focus', id: 'A' });
    c.dispatch({ type: 'canvas-focus', id: null });
    commands.length = 0;
    const remaining = [task('B')];
    update({ items: remaining, layout: cache.compute(graphItems(remaining), metrics, 600) });
    assert.equal(c.value.roving, 'B');
    assert.equal(c.value.selected, selected ? 'B' : null);
    assert.equal(commands.filter(n => n.type === 'focus' || n.type === 'announce').length, 0);
    update({});
    assert.equal(commands.filter(n => n.type === 'focus' || n.type === 'announce').length, 0);
  }
});
test('explicit handoff consumed once, loading focus ownership retired, identity clears same IDs', () => {
  const { c, commands, input } = setup();
  c.leave(); c.listTarget('C'); c.enter(true); c.reconcile(input); assert.equal(c.value.selected, 'C');
  c.dispatch({ type: 'select', id: 'D' }); c.leave(); c.enter(false); assert.equal(c.value.selected, 'D');
  c.leave(true); assert.deepEqual(commands.at(-1), { type: 'list', id: 'D' });
  c.identify('new-reading'); c.listTarget('B'); c.enter(true); c.focusOwner(false);
  const f = commands.filter(n => n.type === 'focus').length;
  const other = setup(); c.reconcile({ ...other.input, identity: 'new-reading' });
  assert.equal(c.value.selected, null); assert.equal(commands.filter(n => n.type === 'focus').length, f);
  c.identify('third-reading'); c.enter(true); c.reconcile({ ...other.input, identity: 'third-reading' }); assert.equal(c.value.selected, null);
});
test('three widths S0–S8: hard world/screen status invariance, structural anchor and observed removal', () => {
  for (const width of [1100, 360, 600]) {
    const commands: MapInteractionCommand[] = [], c = new DependencyMapInteraction(command => commands.push(command)), cache = new DependencyMapLayout();
    c.identify('large'); c.enter(true);
    let prior: ReturnType<DependencyMapLayout['compute']> | undefined, transform: typeof c.value.transform | undefined;
    for (const step of largePlanSteps()) {
      const layout = cache.compute(graphItems(step.items), metrics, width);
      c.reconcile({ identity: 'large', items: step.items as ItemView[], layout, working: step.items.filter(n => n.status === 'working').map(n => n.id), ready: [], viewport: { width, height: 400 }, status: 'all' });
      if (['S1', 'S2', 'S3', 'S4', 'S8'].includes(step.id)) { assert.equal(layout, prior); assert.deepEqual(c.value.transform, transform); }
      if (step.id === 'S0') c.dispatch({ type: 'select', id: 'T-10-24', focus: true });
      if (step.id === 'S5') {
        const p = layout.positions.get('T-10-24')!, t = c.value.transform;
        assert.ok(p.x * t.zoom + t.x >= 8); assert.ok((p.x + metrics.width) * t.zoom + t.x <= width - 8 + .001);
        assert.ok(p.y * t.zoom + t.y >= 8); assert.ok((p.y + metrics.height) * t.zoom + t.y <= 392.001);
        c.dispatch({ type: 'select', id: 'T-19-48', focus: true });
        c.dispatch({ type: 'canvas-focus', id: 'T-19-48' });
      }
      if (step.id === 'S6') assert.notEqual(c.value.selected, 'T-19-48');
      if (step.id === 'S7') assert.notEqual(c.value.selected, 'T-19-48');
      prior = layout; transform = c.value.transform;
    }
    assert.equal(commands.filter(n => n.type === 'announce' && n.text.includes('no longer recorded')).length, 1);
  }
});

test('handoff waits for current matching picture, cancels pending focus, and never leaks across identities', () => {
  const { c, input, commands } = setup(); c.leave(); c.listTarget('C'); c.enter(true);
  c.reconcile({ ...input, current: false }); assert.equal(c.value.selected, null);
  const focusCount = commands.filter(n => n.type === 'focus').length;
  c.focusOwner(false); c.reconcile({ ...input, current: true });
  assert.equal(commands.filter(n => n.type === 'focus').length, focusCount);
  c.leave(); c.listTarget('B'); c.enter(true); c.identify('new'); c.enter(false);
  c.reconcile({ ...input, identity: 'new' }); assert.equal(c.value.selected, null);
});

test('relation reveal keeps an unrelated group filter and clears only hiding predicates', () => {
  const { c, input, cache, update } = setup();
  const grouped = [{ id: 'G', title: 'Group', kind: 'group' as const, status: 'pending' as const }, ...items.map(i => ({ ...i, parentId: 'G' }))];
  update({ items: grouped, layout: cache.compute(graphItems(grouped), metrics, 600) });
  c.dispatch({ type: 'filters', group: 'G', status: 'unfinished' });
  c.dispatch({ type: 'relation', id: 'A' }); assert.equal(c.value.group, 'G'); assert.equal(c.value.status, 'all');
  c.dispatch({ type: 'filters', group: 'gone' }); assert.equal(c.visible.length, 0);
  c.reconcile({ ...input, items: grouped, status: 'all' }); assert.equal(c.value.group, 'gone');
  c.dispatch({ type: 'relation', id: 'B' }); assert.equal(c.value.group, null);
});

test('Fit all covers admitted narrow/deep chain and a wide edgeless plan', () => {
  for (const connected of [false, true]) {
    const tasks = Array.from({ length: 1000 }, (_, n) => task(`T${n}`, connected && n ? [`T${n - 1}`] : []));
    const layout = new DependencyMapLayout().compute(graphItems(tasks), metrics, 326);
    const t = fitProjection(layout, layout.order, { width: 326, height: 480 });
    for (const p of layout.positions.values()) {
      assert.ok(p.x * t.zoom + t.x >= 15.99); assert.ok((p.x + metrics.width) * t.zoom + t.x <= 310.01);
      assert.ok(p.y * t.zoom + t.y >= 15.99); assert.ok((p.y + metrics.height) * t.zoom + t.y <= 464.01);
    }
  }
});
test('keys navigate from the actually focused card; its removal moves focus once without selecting', () => {
  // Default items: A → B, A → C, B/C → D. Roving defaults to A; pointer focus lands on C without selection.
  const { c, commands, cache, input, update } = setup();
  c.focusOwner(true);
  c.dispatch({ type: 'canvas-focus', id: 'C' });
  assert.equal(c.value.selected, null); assert.notEqual(c.value.roving, 'C');
  c.dispatch({ type: 'key', key: ']', canvas: true });
  assert.equal(c.value.selected, 'D', '] follows the focused card C, not the roving card');
  const fresh = setup(); fresh.c.focusOwner(true); fresh.c.dispatch({ type: 'canvas-focus', id: 'C' });
  const expected = neighbour(fresh.input.layout, 'C', new Set(['A', 'B', 'C', 'D']), 'up') ?? neighbour(fresh.input.layout, 'C', new Set(['A', 'B', 'C', 'D']), 'left');
  fresh.c.dispatch({ type: 'key', key: neighbour(fresh.input.layout, 'C', new Set(['A', 'B', 'C', 'D']), 'up') ? 'ArrowUp' : 'ArrowLeft', canvas: true });
  assert.equal(fresh.c.value.selected, expected, 'arrows also start from the focused card');
  // Removal of a pointer-focused card that is neither selected nor roving.
  const r = setup(); r.c.focusOwner(true); r.c.dispatch({ type: 'canvas-focus', id: 'C' });
  assert.equal(r.c.value.selected, null); r.commands.length = 0;
  const remaining = items.filter(i => i.id !== 'C').map(i => ({ ...i, dependencies: i.dependencies?.filter(d => d !== 'C') }));
  r.update({ items: remaining, layout: r.cache.compute(graphItems(remaining), metrics, 600) });
  assert.equal(r.c.value.selected, null, 'focus fallback must not manufacture selection');
  assert.equal(r.commands.filter(n => n.type === 'focus').length, 1);
  assert.equal(r.commands.filter(n => n.type === 'announce').length, 1);
  r.commands.length = 0; r.update({});
  assert.equal(r.commands.filter(n => n.type === 'focus' || n.type === 'announce').length, 0, 'never replayed');
  void commands; void cache; void input; void update;
});
