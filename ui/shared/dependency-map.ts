// Frame-local board/rail consumer of complete cached detail and the existing pinned graph reader.
// No DOM, timers, storage, separate detail stream or attribution projection.
import type { PlanGraphRead } from '../../shared/progress.ts';
import type { HealthView, PlanView, StoreRead } from './model.ts';
import { deriveDependencies, type DependencyDerivation } from './dependency-derivation.ts';
import { RefreshGate } from './refresh.ts';
import { readPlanGraph, type CompleteDetailResult, type DetailResult, type ReadFailure, type ServiceHost } from './source.ts';

export interface MapClaim {
  account: string;
  /** Board filters/search run, or rail selected-session reading. Never board host session. */
  scope: string;
  read: Pick<StoreRead, 'storeId' | 'binding'>;
  plan: PlanView;
  detail: { result: DetailResult; current: () => boolean } | null;
  health: HealthView | null;
  refreshSerial: number;
  active: boolean;
  visible: boolean;
  failure?: ReadFailure | null;
}
export interface MapPicture {
  readonly detail: CompleteDetailResult;
  readonly graph: PlanGraphRead;
  readonly facts: Extract<DependencyDerivation, { state: 'valid' }>;
}
export interface MapSnapshot {
  readonly state: 'loading' | 'ready' | 'updating' | 'unavailable' | 'error' | 'not-found';
  readonly picture: MapPicture | null;
  readonly failure?: ReadFailure;
  /** A renderer must suppress current readiness emphasis and live overlays when false. */
  readonly current: boolean;
}
const cleanup = (p: PlanView) => [p.cleanup?.state ?? 'visible', p.cleanup?.revision ?? 0];
export const mapReadingKey = (c: MapClaim) => JSON.stringify([c.account, c.read.storeId, c.read.binding.sourceId, c.read.binding.verified, c.scope, c.plan.sourceId, c.plan.id, ...cleanup(c.plan)]);
const deps = (xs: readonly string[] | undefined) => [...new Set(xs ?? [])].sort();
const fields = (items: CompleteDetailResult['detail']['items'] | PlanGraphRead['items']) => items.map(i => [i.id, i.kind, i.status, i.parentId ?? null, deps(i.dependencies)]);
const invalid = (): ReadFailure => ({ kind: 'invalid', code: 'MAP_PAIR', message: 'Graph and complete detail do not describe the same reading.' });
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.freeze(value); for (const child of Object.values(value)) freeze(child); }
  return value;
}

function paired(c: MapClaim, d: CompleteDetailResult, g?: PlanGraphRead): boolean {
  const s = d.snapshot, p = d.plan;
  return !!s && s.identity.storeId === c.read.storeId && s.identity.binding.sourceId === c.read.binding.sourceId
    && s.identity.binding.verified === c.read.binding.verified && s.identity.sourceId === c.plan.sourceId && s.identity.planId === c.plan.id
    && p.key === c.plan.key && p.id === c.plan.id && p.sourceId === c.plan.sourceId && d.detail.key === p.key
    && p.revision === c.plan.revision && d.detail.revision === p.revision && p.structuralRevision === c.plan.structuralRevision
    && s.plan.revision === p.revision && s.plan.structuralRevision === p.structuralRevision
    && JSON.stringify(cleanup(s.plan)) === JSON.stringify(cleanup(p))
    && JSON.stringify(cleanup(p)) === JSON.stringify(cleanup(c.plan))
    && (!g || g.structuralRevision === p.structuralRevision && g.cleanup.state === cleanup(p)[0]
      && JSON.stringify(fields(d.detail.items)) === JSON.stringify(fields(g.items)));
}

/** One instance per frame; only accepted picture + one candidate, never a per-plan cache. */
export class DependencyMap {
  private key: string | null = null;
  private generation = 0;
  private attempt: string | null = null;
  private pending: string | null = null;
  private pendingCurrent: (() => boolean) | null = null;
  private settled: string | null = null;
  /** The caller's detail object behind the settled picture; a different same-revision object replaces it. */
  private accepted: CompleteDetailResult | null = null;
  private disposed = false;
  private snapshot: MapSnapshot = { state: 'loading', picture: null, current: false };
  private service: (current: () => boolean) => ServiceHost;
  private changed: () => void;
  private gate: RefreshGate;
  private candidate: (() => Promise<void>) | null = null;
  constructor(service: (current: () => boolean) => ServiceHost, changed: () => void) {
    this.service = service; this.changed = changed;
    this.gate = new RefreshGate(async () => { const run = this.candidate; if (run) await run(); });
  }
  get value(): MapSnapshot { return this.snapshot; }
  /** Leaving Map/hiding retains only the same frame's accepted picture; all continuations retire. */
  pause() { this.generation++; this.gate.retire(); this.candidate = null; this.pending = null; this.pendingCurrent = null; this.attempt = null; this.settled = null; this.accepted = null; this.snapshot = { ...this.snapshot, current: false }; }
  /** Selection/scope/authority/cleanup/eviction boundaries forget every same-ID retention. */
  reset() { this.pause(); this.key = null; this.snapshot = { state: 'loading', picture: null, current: false }; }
  dispose() { this.reset(); this.gate.stop(); this.disposed = true; }
  reconcile(c: MapClaim | null): MapSnapshot {
    if (this.disposed) return this.snapshot;
    if (!c) { this.reset(); return this.snapshot; }
    const key = mapReadingKey(c);
    if (key !== this.key) { this.reset(); this.key = key; }
    if (!c.active || !c.visible) { this.pause(); return this.snapshot; }
    const old = this.snapshot.picture;
    const wait = () => { this.snapshot = { state: old ? 'updating' : 'loading', picture: old, current: false }; return this.snapshot; };
    if (c.failure) { this.pause(); this.snapshot = { state: 'error', picture: old, current: false, failure: c.failure }; return this.snapshot; }
    if (c.health?.planGraph !== 1) {
      this.pause(); this.snapshot = { state: 'unavailable', picture: null, current: false }; return this.snapshot;
    }
    const entry = c.detail, result = entry?.result;
    if (!result) { this.pause(); return wait(); }
    if (!entry.current()) { this.reset(); this.key = key; return this.snapshot; }
    if (!result.ok) {
      this.pause();
      this.snapshot = { state: result.cause.kind === 'not-found' ? 'not-found' : result.cause.kind === 'revision-restarts' ? 'updating' : 'error', picture: result.cause.kind === 'not-found' ? null : old, current: false, failure: result.failure }; return this.snapshot;
    }
    if (!paired(c, result)) {
      this.pause();
      if (!result.snapshot) this.snapshot = { state: 'unavailable', picture: old, current: false };
      else wait();
      return this.snapshot;
    }
    // A capture refresh can replace complete detail at the same revision without a loading
    // claim. A retired entry must not deduplicate the replacement's graph indefinitely.
    if (this.pendingCurrent && !this.pendingCurrent()) this.pause();
    const revision = JSON.stringify([key, result.plan.revision, result.plan.structuralRevision]);
    if (this.settled === revision && old) {
      if (!paired(c, result, old.graph)) { this.snapshot = { state: 'updating', picture: old, current: false, failure: invalid() }; return this.snapshot; }
      // Same revision, replaced detail (e.g. a capture-setting change): reuse the matched graph with
      // a frozen copy of the new detail so snapshot-level fields never stay stale while marked current.
      if (result !== this.accepted) {
        this.accepted = result;
        this.snapshot = { state: 'ready', picture: Object.freeze({ ...old, detail: freeze(structuredClone(result)) }), current: true }; return this.snapshot;
      }
      this.snapshot = { state: 'ready', picture: old, current: true }; return this.snapshot;
    }
    const attempt = JSON.stringify([revision, c.refreshSerial]);
    if (this.pending === revision || this.attempt === attempt) return this.snapshot;
    const generation = ++this.generation;
    this.pending = revision; this.attempt = attempt; wait();
    // Own a deep copy: neither caller mutation nor a new header can alter the displayed picture.
    const detail = freeze(structuredClone(result));
    const expected = { ...c, read: structuredClone(c.read), plan: structuredClone(c.plan) };
    const current = () => !this.disposed && this.key === key && this.generation === generation && entry.current();
    this.pendingCurrent = current;
    this.candidate = async () => {
      if (!current()) return;
      const r = await readPlanGraph(this.service(current), { planGraph: 1 }, {
        storeId: expected.read.storeId, binding: { ...expected.read.binding }, source: expected.plan.sourceId, plan: expected.plan.id,
        revision: detail.plan.revision, cleanupRev: detail.plan.cleanup?.revision ?? 0,
      });
      if (!current()) return;
      this.pending = null; this.pendingCurrent = null; this.candidate = null;
      if (!r.ok) {
        this.snapshot = { state: r.reason === 'conflict' ? 'updating' : r.reason === 'not-found' ? 'not-found' : r.reason === 'unavailable' ? 'unavailable' : 'error', picture: r.reason === 'not-found' ? null : old, current: false, failure: r.failure };
      } else {
        const facts = deriveDependencies(r.graph.items);
        if (!paired(expected, detail, r.graph) || facts.state !== 'valid') this.snapshot = { state: 'updating', picture: old, current: false, failure: invalid() };
        else {
          this.settled = revision; this.accepted = result;
          this.snapshot = { state: 'ready', picture: Object.freeze({ detail, graph: freeze(r.graph), facts }), current: true };
        }
      }
      this.changed();
    };
    this.gate.retire(); this.gate.request();
    return this.snapshot;
  }
}
