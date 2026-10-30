// Sub-agent runs revision 1: one bounded visit per eligible section (a plan in scope). The frame's
// existing visible list poll re-reads the first useful page; nothing here owns a timer. A retired
// visit (plan → no plan, other root/plan/store, hidden, disposed) can neither repaint, continue
// paging nor ask for history reconciliation.
import type { ReconcileRequest, RunRead, RunRequest, RunRow } from '../../shared/subagent-runs.ts';
import { readRuns, requestReconcile, type ReadFailure, type ServiceHost } from './source.ts';
import { ExecutionBaselines } from './subagents.ts';

export interface RunsClaim {
  /** Integration account + store/binding: part of the retirement identity, not sent. */
  owner: string;
  /** Always the useful view of one root with the plan in scope. */
  request: RunRequest;
  /** The service advertises `subagentRuns:1`; otherwise runs are unavailable, never zero. */
  capable: boolean;
  captureEnabled: boolean;
}
export interface RunsHost { service: (current: () => boolean) => ServiceHost; visible: () => boolean; changed: () => void }
export type RunsState = 'unavailable' | 'loading' | 'ready' | 'not-found' | 'error';
export interface RunsPanel {
  state: RunsState;
  /** First useful page (summary counts, coverage, recovery). */
  read: RunRead | null;
  /** First useful page rows: the only ones that may be featured individually. */
  featured: RunRow[];
  /** Rows loaded by explicit paging (later useful pages, then history), in load order. */
  more: RunRow[];
  /** More rows can be read on request. */
  hasMore: boolean;
  paging: boolean;
  pageError: boolean;
  /** Earlier rows the reader asked to see (0: the default amount); kept across repaints. */
  shown: number;
  reconciling: boolean;
  failure: ReadFailure | null;
  /** Per-visit execution baselines (subagents.ts); a new visit starts fresh, which is stricter. */
  baselines: ExecutionBaselines;
  /** Shows `step` more of the earlier list, reading further pages only when `loaded` runs out. */
  showMore: (visible: number, loaded: number, step: number) => void;
  retryHistory: () => void;
}
interface Visit {
  key: string; claim: RunsClaim; state: RunsState; read: RunRead | null; more: RunRow[];
  cursor: string | null; phase: 'useful' | 'history' | 'done'; paging: boolean; pageError: boolean;
  shown: number; loading: boolean; epoch: number; pageEpoch: number; reconciling: boolean; failure: ReadFailure | null; baselines: ExecutionBaselines;
}
/** Roots whose automatic history pass this frame already asked for (bounded; the service coalesces too). */
const ASKED_LIMIT = 64;

export class RunsController {
  private visit: Visit | null = null;
  private claimed = false;
  private readonly asked: string[] = [];
  private readonly host: RunsHost;
  constructor(host: RunsHost) { this.host = host; }
  beginPaint() { this.claimed = false; }
  /** A paint without an eligible section retires the visit and drops any held reply. */
  endPaint() { if (!this.claimed) this.retire(); }
  retire() { this.visit = null; }
  /** Hidden frame: in-flight replies are dropped; data stays for the next visible paint. */
  hidden() { if (this.visit) { this.visit.epoch++; this.visit.pageEpoch++; this.visit.loading = false; this.visit.paging = false; this.visit.reconciling = false; } }
  /** The frame's visible list poll: re-read the first useful page of the current visit. */
  poll() { const v = this.visit; if (v && v.claim.capable && !v.loading && this.host.visible()) void this.load(v); }

  claim(c: RunsClaim): RunsPanel {
    this.claimed = true;
    const key = JSON.stringify([c.owner, c.request, c.capable, c.captureEnabled]);
    if (!this.visit || this.visit.key !== key) {
      this.visit = { key, claim: c, state: c.capable ? 'loading' : 'unavailable', read: null, more: [], cursor: null, phase: 'useful', paging: false, pageError: false, shown: 0, loading: false, epoch: 0, pageEpoch: 0, reconciling: false, failure: null, baselines: new ExecutionBaselines() };
      if (c.capable && this.host.visible()) void this.load(this.visit);
    }
    const v = this.visit;
    const live = () => this.visit === v && this.host.visible();
    return {
      state: v.state, read: v.read, featured: v.read?.data ?? [], more: v.more,
      hasMore: v.state === 'ready' && v.phase !== 'done', paging: v.paging, pageError: v.pageError, shown: v.shown,
      reconciling: v.reconciling, failure: v.failure, baselines: v.baselines,
      showMore: (visible, loaded, step) => {
        if (!live()) return;
        v.shown = visible + step;
        // Read on demand only when the loaded rows run out.
        if (v.shown > loaded && v.phase !== 'done' && !v.paging) void this.page(v, v.shown - loaded);
        else this.host.changed();
      },
      retryHistory: () => { if (live()) void this.reconcile(v, v.read?.recovery.token ?? undefined); },
    };
  }

  private own(v: Visit) { const epoch = ++v.epoch; return () => this.visit === v && v.epoch === epoch && this.host.visible(); }

  private async load(v: Visit) {
    v.loading = true;
    const own = this.own(v);
    const r = await readRuns(this.host.service(own), v.claim.request);
    if (!own()) return;
    v.loading = false;
    if (!r.ok) {
      // A missing root or plan relation is not zero runs: there are just no run facts to show.
      const state: RunsState = r.failure.kind === 'not-found' ? 'not-found' : v.read ? v.state : 'error';
      if (state !== v.state || v.failure?.code !== r.failure.code) { v.state = state; v.failure = r.failure; this.host.changed(); }
      return;
    }
    const read = r.value;
    // The server read time moves on every read; it is not a change worth a repaint.
    const same = (a: RunRead) => JSON.stringify({ ...a, readAt: 0 });
    const changed = !v.read || v.state !== 'ready' || same(v.read) !== same(read);
    // A newer run-data revision invalidates continuation cursors: paging starts again.
    if (v.read && v.read.revision !== read.revision) { v.more = []; v.phase = 'useful'; v.pageEpoch++; v.paging = false; v.pageError = false; v.shown = 0; }
    if (v.phase === 'useful' && !v.more.length) v.cursor = read.nextCursor;
    v.read = read; v.state = read.availability === 'ready' ? 'ready' : 'unavailable'; v.failure = null;
    if (changed) this.host.changed();
    this.autoReconcile(v);
  }

  /** One automatic metadata-only history pass per root and frame, only with capture on. */
  private autoReconcile(v: Visit) {
    const r = v.read;
    if (!r || r.availability !== 'ready' || r.recovery.state !== 'not-requested' || !r.capture.enabled || !v.claim.captureEnabled) return;
    const root = JSON.stringify([v.claim.owner, r.storeId, r.source, r.root]);
    if (this.asked.includes(root)) return;
    this.asked.push(root);
    if (this.asked.length > ASKED_LIMIT) this.asked.shift();
    void this.reconcile(v);
  }

  private async reconcile(v: Visit, token?: string) {
    if (v.reconciling || !v.read) return;
    const q = v.claim.request;
    const body: ReconcileRequest = { storeId: q.storeId, binding: q.binding, source: q.source, root: q.root, ...(token ? { token } : {}) };
    v.reconciling = true; this.host.changed();
    const own = () => this.visit === v && this.host.visible();
    const r = await requestReconcile(this.host.service(own), body);
    if (!own()) return;
    v.reconciling = false;
    if (r.ok) void this.load(v); else this.host.changed();
  }

  /** Further rows on explicit request only: the rest of the useful view, then the history view. */
  private async page(v: Visit, need: number, budget = 3) {
    if (v.paging || v.phase === 'done' || budget <= 0) return;
    if (v.phase === 'useful' && !v.cursor) v.phase = 'history';
    v.paging = true; v.pageError = false; this.host.changed();
    const epoch = ++v.pageEpoch;
    const own = () => this.visit === v && v.pageEpoch === epoch && this.host.visible();
    const phase = v.phase;
    const r = await readRuns(this.host.service(own), { ...v.claim.request, view: phase }, v.cursor ?? undefined);
    if (!own()) return;
    v.paging = false;
    // A changed run revision refuses the cursor; the next poll restarts paging from the top.
    if (!r.ok) { v.pageError = true; this.host.changed(); return; }
    const seen = new Set([...(v.read?.data ?? []), ...v.more].map((x) => x.id));
    const fresh = r.value.data.filter((x) => !seen.has(x.id));
    v.more = [...v.more, ...fresh];
    v.cursor = r.value.nextCursor;
    if (!v.cursor) v.phase = phase === 'useful' ? 'history' : 'done';
    this.host.changed();
    if (fresh.length < need && v.phase !== 'done') void this.page(v, need - fresh.length, budget - 1);
  }
}
