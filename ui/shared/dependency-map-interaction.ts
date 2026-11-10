// Frame-owned reading/interaction state. No DOM, timers, storage or animation.
import { anchorSelection, neighbour, relations, type MapLayout, type Transform } from './dependency-map-layout.ts';
import { statusMatch, type ItemView, type StatusFilter } from './model.ts';

// Fit all must admit even a 1,000-card chain in a narrow rail. Readable initial framing is
// separate from this intentionally tiny overview limit; it falls back to a current-work card.
// `fit` (100%) is the board's framing limit: there Fit all, Focus current work and initial entry never
// magnify past it (the input's `framingMax`); only the zoom controls go above it, up to `max`.
export const MAP_ZOOM = Object.freeze({ min: 0.0001, max: 2, readable: 0.75, step: 1.2, fit: 1 });
/**
 * The wide board's selection panel: over the canvas's right edge while a task is selected, once the
 * board's map is at least `minMap` px wide. `width` is capped at `share` of the canvas; `margin` is
 * its distance from the canvas edges. The rail never has one (its inspector stays stacked).
 */
export const MAP_PANEL = Object.freeze({ minMap: 760, width: 340, share: 0.42, margin: 8 });
/** The panel width for this frame and measured map/canvas width, or 0 for the stacked inspector. */
export function mapPanelWidth(frame: 'board' | 'rail', mapWidth: number, canvasWidth: number): number {
  return frame === 'board' && mapWidth >= MAP_PANEL.minMap && canvasWidth > 0 ? Math.round(Math.min(MAP_PANEL.width, canvasWidth * MAP_PANEL.share)) : 0;
}
export interface MapViewport {
  width: number; height: number;
  /** CSS px of the canvas's right edge covered by the selection panel while a task is selected (0/absent: none). */
  cover?: number;
}
export interface MapPoint { x: number; y: number }
export interface MapInteractionInput {
  /** Use mapReadingKey(claim), including authority/scope/cleanup; never just a plan ID. */
  identity: string;
  layout: MapLayout;
  items: readonly ItemView[];
  /** Current active-picture working and ready tasks, in stored order. Empty for historical pictures. */
  working: readonly string[];
  ready: readonly string[];
  /** False for superseded pictures: pending handoffs wait for the matched current picture. */
  current?: boolean;
  /** False for closed/superseded plans: no readiness recommendation. */
  guidance?: boolean;
  viewport: MapViewport;
  status: StatusFilter;
  /** Highest zoom that framing may choose (Fit all, Focus current work, initial entry). Default `MAP_ZOOM.max`; the board passes `MAP_ZOOM.fit`. */
  framingMax?: number;
}
export interface MapInteractionState {
  readonly identity: string | null;
  readonly transform: Readonly<Transform>;
  readonly selected: string | null;
  readonly roving: string | null;
  readonly status: StatusFilter;
  readonly group: string | null;
  readonly initialFramingDone: boolean;
  readonly active: boolean;
  readonly generation: number;
  readonly dragging: number | null;
}
/** Commands are action-local, not retained messages to replay on paint. Viewport commands should
 * update only the world transform, coalesced by the binding's requestAnimationFrame. Capture must
 * be rebound to a replacement viewport while state.dragging is non-null. No animation is required. */
export type MapInteractionCommand =
  | { type: 'viewport'; transform: Transform }
  | { type: 'selection'; id: string | null }
  | { type: 'filters'; status: StatusFilter; group: string | null }
  | { type: 'announce'; text: string }
  | { type: 'focus'; id: string | null; generation: number; reveal?: boolean }
  | { type: 'capture'; pointerId: number; capture: boolean }
  | { type: 'list'; id: string | null };
export type MapInteractionEvent =
  | { type: 'canvas-focus'; id: string | null }
  | { type: 'select'; id: string; focus?: boolean }
  | { type: 'relation'; id: string }
  | { type: 'key'; key: string; canvas: boolean; modified?: boolean; editable?: boolean }
  | { type: 'fit' | 'current' }
  /** The selection panel's close control: the same clear-selection action as a background click. */
  | { type: 'clear' }
  | { type: 'zoom'; factor: number; point?: MapPoint }
  | { type: 'pan'; x: number; y: number }
  | { type: 'filters'; status?: StatusFilter; group?: string | null }
  | { type: 'pointer-down'; pointerId: number; point: MapPoint; background: boolean; primary: boolean }
  | { type: 'pointer-move'; pointerId: number; point: MapPoint }
  | { type: 'pointer-end'; pointerId: number; point?: MapPoint; cancelled?: boolean };

export function zoomAt(t: Readonly<Transform>, factor: number, point: MapPoint): Transform {
  if (!Number.isFinite(factor) || factor <= 0 || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return { ...t };
  const zoom = Math.max(MAP_ZOOM.min, Math.min(MAP_ZOOM.max, t.zoom * factor));
  const ratio = zoom / t.zoom;
  return { x: point.x - (point.x - t.x) * ratio, y: point.y - (point.y - t.y) * ratio, zoom };
}

export function fitProjection(layout: MapLayout, ids: readonly string[], viewport: MapViewport, inset = 16, max: number = MAP_ZOOM.max): Transform {
  const slots = ids.flatMap(id => { const p = layout.positions.get(id); return p ? [p] : []; });
  if (!slots.length) return { x: inset, y: inset, zoom: 1 };
  const left = Math.min(...slots.map(p => p.x)), top = Math.min(...slots.map(p => p.y));
  const width = Math.max(...slots.map(p => p.x)) + layout.metrics.width - left;
  const height = Math.max(...slots.map(p => p.y)) + layout.metrics.height - top;
  const zoom = Math.max(MAP_ZOOM.min, Math.min(max, MAP_ZOOM.max, (viewport.width - 2 * inset) / width, (viewport.height - 2 * inset) / height));
  return { x: (viewport.width - width * zoom) / 2 - left * zoom, y: (viewport.height - height * zoom) / 2 - top * zoom, zoom };
}
/** The part of the canvas left of the selection panel while `selected` is set (the whole canvas otherwise). */
export function mapRoom(viewport: MapViewport, selected: string | null): MapViewport {
  const cover = selected ? Math.max(0, viewport.cover ?? 0) : 0;
  return cover ? { width: Math.max(1, viewport.width - cover), height: viewport.height } : { width: viewport.width, height: viewport.height };
}

/** One instance per frame, outside the replaced root. Reconcile never announces ordinary polls. */
export class DependencyMapInteraction {
  private input: MapInteractionInput | null = null;
  private state: MapInteractionState = this.empty(0);
  private drag: { id: number; start: MapPoint; point: MapPoint; moved: boolean } | null = null;
  private explicit: { id: string; serial: number } | null = null;
  private consumed = 0;
  private serial = 0;
  private pending: { id: string; generation: number } | null = null;
  private ownsFocus = false;
  private focusedTask: string | null = null;
  private sink: (command: MapInteractionCommand) => void;
  constructor(sink: (command: MapInteractionCommand) => void = () => {}) { this.sink = sink; }
  private empty(generation: number): MapInteractionState { return { identity: null, transform: { x: 0, y: 0, zoom: 1 }, selected: null, roving: null, status: 'all', group: null, initialFramingDone: false, active: false, generation, dragging: null }; }
  get value(): MapInteractionState { return { ...this.state, transform: { ...this.state.transform } }; }
  get visible(): readonly string[] {
    const i = this.input; if (!i) return [];
    const byId = new Map(i.items.map(item => [item.id, item]));
    const matches = statusMatch(this.state.status);
    return i.layout.order.filter(id => {
      const task = byId.get(id); if (!task || (matches && !matches(task))) return false;
      const groups: string[] = [], seen = new Set<string>();
      for (let p = task.parentId; p && !seen.has(p); p = byId.get(p)?.parentId) { seen.add(p); if (byId.get(p)?.kind === 'group') groups.push(p); }
      return this.state.group === null || (this.state.group === '' ? groups.length === 0 : groups.includes(this.state.group));
    });
  }
  hiddenRelations(id: string, direction: 'upstream' | 'downstream'): readonly string[] {
    const visible = new Set(this.visible); return this.input ? relations(this.input.layout, id, direction).filter(n => !visible.has(n)) : [];
  }
  /** Called even in List, before recording explicit task targets. Identity transitions forget all state. */
  identify(identity: string) {
    if (identity === this.state.identity) return;
    this.reset(); this.state = { ...this.state, identity };
  }
  reset() {
    this.endDrag(); this.input = null; this.pending = null; this.explicit = null;
    this.serial = this.consumed = 0; this.ownsFocus = false; this.focusedTask = null;
    this.state = this.empty(this.state.generation + 1);
  }
  /** Explicit canonical reveal/focus or pointer selection only; not passive restored focus. */
  listTarget(id: string) { if (this.state.identity) this.explicit = { id, serial: ++this.serial }; }
  /** Focus ownership must be retired when focus leaves the initiating switch/map, even while loading. */
  focusOwner(owns: boolean) { this.ownsFocus = owns; if (!owns) { this.pending = null; this.focusedTask = null; } }
  enter(ownsFocus: boolean) {
    this.ownsFocus = ownsFocus;
    this.state = { ...this.state, active: true, generation: this.state.generation + 1 };
    if (this.explicit && this.explicit.serial > this.consumed) {
      this.consumed = this.explicit.serial;
      this.pending = { id: this.explicit.id, generation: this.state.generation };
    }
  }
  leave(reveal = false) {
    const id = this.state.selected;
    this.endDrag(); this.pending = null; this.ownsFocus = false; this.focusedTask = null;
    this.state = { ...this.state, active: false, generation: this.state.generation + 1 };
    if (reveal) this.sink({ type: 'list', id });
  }
  reconcile(next: MapInteractionInput) {
    this.identify(next.identity);
    const previous = this.input, oldOrder = previous?.layout.order ?? [];
    const { selected, roving } = this.state, oldSlot = selected ? previous?.layout.positions.get(selected) : undefined;
    this.input = next; this.state = { ...this.state, status: next.status };
    const fallbackFor = (id: string) => {
      const visible = new Set(this.visible), n = oldOrder.indexOf(id);
      return oldOrder.slice(n + 1).find(id => visible.has(id)) ?? oldOrder.slice(0, n).reverse().find(id => visible.has(id)) ?? null;
    };
    let removedRoving = false;
    if (selected && !next.layout.positions.has(selected)) {
      const fallback = fallbackFor(selected);
      this.state = { ...this.state, selected: fallback, roving: fallback };
      this.sink({ type: 'selection', id: fallback });
      if (this.ownsFocus && this.state.active && this.focusedTask === selected) { this.sink({ type: 'announce', text: 'The selected task is no longer recorded. Moved to the next available map target.' }); this.focus(fallback); this.focusedTask = fallback; }
    } else if (roving && !next.layout.positions.has(roving)) {
      // Tab can focus the initial roving card without selecting it. Retire that target too,
      // preserving the prior-order fallback rather than silently choosing the first card.
      this.state = { ...this.state, roving: fallbackFor(roving) };
      removedRoving = true;
    }
    const changed = previous && (previous.layout !== next.layout || previous.viewport.width !== next.viewport.width || previous.viewport.height !== next.viewport.height || (previous.viewport.cover ?? 0) !== (next.viewport.cover ?? 0));
    if (changed) {
      const id = this.state.selected, slot = id ? next.layout.positions.get(id) : undefined;
      if (slot) this.viewport(anchorSelection(oldSlot, slot, this.state.transform, next.layout.metrics, mapRoom(next.viewport, id)));
      // Without selection the world point at the viewport centre stays put, including resize.
      else if (previous.viewport.width !== next.viewport.width || previous.viewport.height !== next.viewport.height) this.viewport({ ...this.state.transform, x: this.state.transform.x + (next.viewport.width - previous.viewport.width) / 2, y: this.state.transform.y + (next.viewport.height - previous.viewport.height) / 2 });
    }
    const focusedOther = this.focusedTask;
    if (focusedOther && focusedOther !== selected && focusedOther !== roving && !next.layout.positions.has(focusedOther)
      && this.ownsFocus && this.state.active) {
      // A focused card that was neither selected nor roving (e.g. pointer-focused) was removed:
      // move focus once, without implying selection.
      const fallback = fallbackFor(focusedOther), slot = fallback ? next.layout.positions.get(fallback) : undefined;
      if (fallback) this.state = { ...this.state, roving: fallback };
      if (slot) this.viewport(anchorSelection(undefined, slot, this.state.transform, next.layout.metrics, mapRoom(next.viewport, this.state.selected)));
      this.sink({ type: 'announce', text: 'The focused task is no longer recorded. Moved to the next available map target.' });
      this.focus(fallback); this.focusedTask = fallback;
    }
    if (removedRoving && this.ownsFocus && this.state.active && this.focusedTask === roving) {
      const fallback = this.state.roving, slot = fallback ? next.layout.positions.get(fallback) : undefined;
      if (slot) this.viewport(anchorSelection(undefined, slot, this.state.transform, next.layout.metrics, mapRoom(next.viewport, this.state.selected)));
      this.sink({ type: 'announce', text: 'The focused task is no longer recorded. Moved to the next available map target.' });
      this.focus(fallback); this.focusedTask = fallback;
    }
    this.consumeTarget();
    if (this.state.active && !this.state.initialFramingDone && next.viewport.width > 0 && next.viewport.height > 0) {
      this.current(); this.state = { ...this.state, initialFramingDone: true };
    }
    this.rove();
  }
  private consumeTarget() {
    if (!this.pending || !this.input || this.input.current === false || !this.state.active) return;
    const p = this.pending; this.pending = null;
    if (this.input.layout.positions.has(p.id)) {
      this.select(p.id, this.ownsFocus && p.generation === this.state.generation, true);
      this.state = { ...this.state, initialFramingDone: true };
    } else if (this.ownsFocus) this.sink({ type: 'announce', text: 'That list task is no longer recorded in this map.' });
  }
  private viewport(transform: Transform) {
    const old = this.state.transform;
    if (old.x === transform.x && old.y === transform.y && old.zoom === transform.zoom) return;
    this.state = { ...this.state, transform }; this.sink({ type: 'viewport', transform: { ...transform } });
  }
  private rove() {
    const ids = this.visible;
    this.state = { ...this.state, roving: this.state.selected && ids.includes(this.state.selected) ? this.state.selected : ids.includes(this.state.roving ?? '') ? this.state.roving : ids[0] ?? null };
  }
  private focus(id: string | null, reveal = true) { this.sink({ type: 'focus', id, generation: this.state.generation, ...(reveal ? {} : { reveal: false }) }); }
  private filters(status: StatusFilter, group: string | null) {
    this.state = { ...this.state, status, group }; this.rove();
    this.sink({ type: 'filters', status, group });
  }
  private select(id: string, focus: boolean, reveal = false) {
    const i = this.input; if (!i?.layout.positions.has(id)) return;
    if (reveal && !this.visible.includes(id)) {
      // Clear only the predicates hiding this target.
      const task = i.items.find(n => n.id === id)!;
      const match = statusMatch(this.state.status);
      const status = !match || match(task) ? this.state.status : 'all';
      const previous = this.state.status; this.state = { ...this.state, status: 'all' };
      const group = this.visible.includes(id) ? this.state.group : null;
      this.state = { ...this.state, status: previous }; this.filters(status, group);
    }
    if (!this.visible.includes(id)) return;
    const changed = this.state.selected !== id;
    this.state = { ...this.state, selected: id, roving: id };
    this.viewport(anchorSelection(undefined, i.layout.positions.get(id)!, this.state.transform, i.layout.metrics, mapRoom(i.viewport, id)));
    if (changed) {
      this.sink({ type: 'selection', id });
      const task = i.items.find(n => n.id === id)!;
      const skipped = task.dependencies?.some(id => i.items.find(n => n.id === id)?.status === 'skipped');
      const state = task.status === 'working' ? 'Reported working' : task.status === 'blocked' ? 'Explicitly blocked' : task.status === 'pending' && i.guidance !== false ? i.ready.includes(id) ? 'Ready, recorded prerequisites only' : skipped ? 'Waiting on a skipped recorded prerequisite' : 'Waiting on recorded prerequisites' : `Reported ${task.status}`;
      const up = relations(i.layout, id, 'upstream').length, down = relations(i.layout, id, 'downstream').length;
      const hidden = this.hiddenRelations(id, 'upstream').length + this.hiddenRelations(id, 'downstream').length;
      this.sink({ type: 'announce', text: `${task.title}. ${state}. ${up} direct prerequisites; ${down} direct dependents.${hidden ? ` ${hidden} relationships hidden by filters.` : ''}` });
    }
    if (focus) this.focus(id);
  }
  private clearSelection(focus: boolean) {
    if (!this.state.selected) return;
    this.pending = null;
    if (focus) this.focus(this.state.roving, false);
    this.state = { ...this.state, selected: null };
    this.sink({ type: 'selection', id: null });
    this.sink({ type: 'announce', text: 'Selection cleared.' });
  }
  private current() {
    const i = this.input; if (!i) return;
    const visible = new Set(this.visible), work = [...i.working, ...i.ready].filter(id => visible.has(id));
    const room = mapRoom(i.viewport, this.state.selected);
    let t = fitProjection(i.layout, work.length ? work : this.visible, room, 16, i.framingMax);
    if (work.length && t.zoom < MAP_ZOOM.readable) {
      const p = i.layout.positions.get(work[0])!;
      // A narrow viewport may require less than the usual readable zoom for a whole card.
      const zoom = Math.min(MAP_ZOOM.readable, Math.max(MAP_ZOOM.min, (room.width - 16) / i.layout.metrics.width));
      t = { zoom, x: room.width / 2 - (p.x + i.layout.metrics.width / 2) * zoom, y: room.height / 2 - (p.y + i.layout.metrics.height / 2) * zoom };
    }
    this.viewport(t);
  }
  private endDrag() { if (this.drag) this.sink({ type: 'capture', pointerId: this.drag.id, capture: false }); this.drag = null; this.state = { ...this.state, dragging: null }; }
  /** Returns whether a scoped keyboard event was handled; binding may preventDefault only then. */
  dispatch(e: MapInteractionEvent): boolean {
    if (!this.state.active || !this.input) return false;
    const i = this.input;
    switch (e.type) {
      case 'canvas-focus': this.focusedTask = e.id; break;
      case 'select': this.pending = null; this.select(e.id, e.focus ?? false); break;
      case 'relation': this.pending = null; this.select(e.id, true, true); break;
      case 'filters': this.filters(e.status ?? this.state.status, e.group === undefined ? this.state.group : e.group); this.sink({ type: 'announce', text: `${this.visible.length} tasks shown. Layout unchanged.` }); break;
      case 'fit': this.viewport(fitProjection(i.layout, this.visible, mapRoom(i.viewport, this.state.selected), 16, i.framingMax)); this.sink({ type: 'announce', text: `Fit all: ${this.visible.length} visible tasks; active filters unchanged.` }); break;
      case 'current': this.current(); this.sink({ type: 'announce', text: 'Focused current reported work; active filters unchanged.' }); break;
      case 'zoom': { const room = mapRoom(i.viewport, this.state.selected); this.viewport(zoomAt(this.state.transform, e.factor, e.point ?? { x: room.width / 2, y: room.height / 2 })); break; }
      case 'clear': this.pending = null; this.clearSelection(true); break;
      case 'pan': if (Number.isFinite(e.x) && Number.isFinite(e.y)) this.viewport({ ...this.state.transform, x: this.state.transform.x + e.x, y: this.state.transform.y + e.y }); break;
      case 'pointer-down': if (!e.primary || !e.background || this.drag) return false; this.drag = { id: e.pointerId, start: { ...e.point }, point: { ...e.point }, moved: false }; this.state = { ...this.state, dragging: e.pointerId }; this.sink({ type: 'capture', pointerId: e.pointerId, capture: true }); break;
      case 'pointer-move': {
        const drag = this.drag; if (drag?.id !== e.pointerId) return false;
        if (!drag.moved && Math.hypot(e.point.x - drag.start.x, e.point.y - drag.start.y) >= 5) drag.moved = true;
        if (drag.moved) { this.dispatch({ type: 'pan', x: e.point.x - drag.point.x, y: e.point.y - drag.point.y }); drag.point = { ...e.point }; }
        break;
      }
      case 'pointer-end': {
        const drag = this.drag; if (drag?.id !== e.pointerId) return false;
        const moved = drag.moved || (e.point && Math.hypot(e.point.x - drag.start.x, e.point.y - drag.start.y) >= 5);
        this.endDrag();
        if (!e.cancelled && !moved) this.clearSelection(true);
        break;
      }
      case 'key': {
        if (!e.canvas || e.modified || e.editable) return false;
        const direction = ({ ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' } as const)[e.key as 'ArrowLeft'];
        // Navigate from the card that actually holds focus (pointer focus need not move roving or select).
        const focused = this.focusedTask && this.visible.includes(this.focusedTask) ? this.focusedTask : null;
        const from = focused ?? this.state.roving;
        if (e.key === 'Escape') this.clearSelection(false);
        else if (direction) { const id = from && neighbour(i.layout, from, new Set(this.visible), direction); if (id) this.select(id, true); }
        else if (e.key === '[' || e.key === ']') { const id = from && relations(i.layout, from, e.key === '[' ? 'upstream' : 'downstream')[0]; if (id) this.select(id, true, true); }
        else if (e.key.toLowerCase() === 'f') this.dispatch({ type: 'fit' });
        else if (e.key === '+' || e.key === '-') this.dispatch({ type: 'zoom', factor: e.key === '+' ? MAP_ZOOM.step : 1 / MAP_ZOOM.step });
        else return false;
      }
    }
    return true;
  }
}
