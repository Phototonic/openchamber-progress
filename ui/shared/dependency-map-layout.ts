// Full-plan geometry, kept outside the replace-root DOM. No display-filter/status inputs.
import { graphItems } from '../../shared/plan-graph.ts';
import type { PlanGraphItem } from '../../shared/progress.ts';
import { deriveDependencies } from './dependency-derivation.ts';

export interface CardMetrics { width: number; height: number; columnGap: number; rowGap: number }
export interface Slot { readonly column: number; readonly row: number; readonly x: number; readonly y: number }
export interface MapLayout {
  readonly key: string;
  readonly order: readonly string[];
  readonly positions: ReadonlyMap<string, Slot>;
  /** Recorded task pairs only, prerequisite → dependent, visually deduplicated. */
  readonly edges: readonly (readonly [string, string])[];
  readonly width: number;
  readonly height: number;
  readonly metrics: Readonly<CardMetrics>;
}

export class DependencyMapLayout {
  private cached: MapLayout | null = null;
  clear() { this.cached = null; }
  compute(input: readonly PlanGraphItem[], metrics: CardMetrics, viewportWidth: number): MapLayout {
    // Validate even when a geometry key would hit: invalid status/topology never uses a good cache.
    const items = graphItems(input);
    if (![metrics.width, metrics.height, viewportWidth].every(n => Number.isFinite(n) && n > 0)
      || ![metrics.columnGap, metrics.rowGap].every(n => Number.isFinite(n) && n >= 0)) throw Error('Invalid map metrics');
    const facts = deriveDependencies(items);
    if (facts.state !== 'valid') throw Error('Invalid map topology');
    const tasks = items.filter(i => i.kind === 'task');
    const edges = tasks.flatMap(i => [...new Set(i.dependencies)].sort().map(id => [id, i.id] as const));
    const packing = Math.max(1, Math.floor((viewportWidth + metrics.columnGap) / (metrics.width + metrics.columnGap)));
    // Group labels, parents, titles, statuses and structuralRevision are not geometry inputs.
    const key = JSON.stringify([tasks.map(i => [i.id, i.kind]), edges, metrics.width, metrics.height, metrics.columnGap, metrics.rowGap, edges.length ? null : packing]);
    if (this.cached?.key === key) return this.cached;
    const old = this.cached;
    const index = new Map(tasks.map((i, n) => [i.id, n]));
    const columns = new Map<string, number>();
    const rows = new Map<string, number>();
    if (!edges.length) {
      tasks.forEach((i, n) => { columns.set(i.id, n % packing); rows.set(i.id, Math.floor(n / packing)); });
    } else {
      // Shared longest-path facts supply dependency order; constraints can only move a survivor right.
      const ordered = [...tasks].sort((a, b) => facts.tasks.get(a.id)!.depth! - facts.tasks.get(b.id)!.depth! || index.get(a.id)! - index.get(b.id)!);
      for (const i of ordered) columns.set(i.id, Math.max(old?.positions.get(i.id)?.column ?? 0,
        ...i.dependencies.map(d => columns.get(d)! + 1)));
      const buckets = new Map<number, string[]>();
      for (const i of tasks) { const col = columns.get(i.id)!; const bucket = buckets.get(col) ?? []; bucket.push(i.id); buckets.set(col, bucket); }
      if (!old) {
        // At most two deterministic barycenter sweeps. Stored order is the stable tie-break.
        tasks.forEach((i, n) => rows.set(i.id, n));
        const adjacent = [new Map<string, string[]>(), new Map<string, string[]>()];
        for (const [a, b] of edges) { adjacent[0].set(b, [...adjacent[0].get(b) ?? [], a]); adjacent[1].set(a, [...adjacent[1].get(a) ?? [], b]); }
        for (let sweep = 0; sweep < 2; sweep++) {
          const cols = [...buckets.keys()].sort((a, b) => sweep ? b - a : a - b);
          const mean = (id: string) => { const ns = adjacent[sweep].get(id); return ns?.length ? ns.reduce((s, n) => s + rows.get(n)!, 0) / ns.length : rows.get(id)!; };
          for (const col of cols) {
            const bucket = buckets.get(col)!;
            bucket.sort((a, b) => mean(a) - mean(b) || index.get(a)! - index.get(b)! || a.localeCompare(b));
            bucket.forEach((id, n) => rows.set(id, n));
          }
        }
      } else for (const [col, bucket] of buckets) {
        const occupied = new Set<number>();
        // Survivors have first claim on their slots; moved survivors/new tasks use the next free slot.
        for (const id of bucket) {
          const prior = old.positions.get(id);
          if (prior?.column === col && !occupied.has(prior.row)) { rows.set(id, prior.row); occupied.add(prior.row); }
        }
        for (const id of bucket) if (!rows.has(id)) {
          let row = old.positions.get(id)?.row ?? 0;
          while (occupied.has(row)) row++;
          rows.set(id, row); occupied.add(row);
        }
      }
    }
    const positions = new Map(tasks.map(i => [i.id, Object.freeze({ column: columns.get(i.id)!, row: rows.get(i.id)!, x: columns.get(i.id)! * (metrics.width + metrics.columnGap), y: rows.get(i.id)! * (metrics.height + metrics.rowGap) })]));
    this.cached = Object.freeze({ key, order: Object.freeze(tasks.map(i => i.id)), positions, edges: Object.freeze(edges), metrics: Object.freeze({ ...metrics }),
      width: Math.max(0, ...[...positions.values()].map(p => p.x + metrics.width)), height: Math.max(0, ...[...positions.values()].map(p => p.y + metrics.height)) });
    return this.cached;
  }
}

export interface Transform { x: number; y: number; zoom: number }
/** Preserve the selected screen anchor, then clamp just enough to keep the card in the viewport. */
export function anchorSelection(before: Slot | undefined, after: Slot, transform: Transform, metrics: CardMetrics, viewport: { width: number; height: number }, inset = 8): Transform {
  const t = { ...transform };
  if (before) { t.x += (before.x - after.x) * t.zoom; t.y += (before.y - after.y) * t.zoom; }
  const keep = (offset: number, pos: number, size: number, bound: number) => {
    const start = offset + pos * t.zoom, extent = size * t.zoom;
    return offset + (start < inset ? inset - start : start + extent > bound - inset ? Math.max(inset, bound - inset - extent) - start : 0);
  };
  t.x = keep(t.x, after.x, metrics.width, viewport.width); t.y = keep(t.y, after.y, metrics.height, viewport.height);
  return t;
}

export function neighbour(layout: MapLayout, id: string, visible: ReadonlySet<string>, direction: 'left' | 'right' | 'up' | 'down'): string | null {
  const from = layout.positions.get(id); if (!from) return null;
  const candidates = layout.order.filter(n => n !== id && visible.has(n)).map(n => ({ id: n, p: layout.positions.get(n)! }));
  return candidates.filter(({ p }) => direction === 'left' ? p.x < from.x : direction === 'right' ? p.x > from.x : direction === 'up' ? p.y < from.y : p.y > from.y)
    .sort((a, b) => (a.p.x - from.x) ** 2 + (a.p.y - from.y) ** 2 - (b.p.x - from.x) ** 2 - (b.p.y - from.y) ** 2)[0]?.id ?? null;
}
export function relations(layout: MapLayout, id: string, direction: 'upstream' | 'downstream'): readonly string[] {
  const ids = new Set(layout.edges.filter(([a, b]) => direction === 'upstream' ? b === id : a === id).map(([a, b]) => direction === 'upstream' ? a : b));
  return layout.order.filter(n => ids.has(n));
}
