// Sub-agent runs revision 1: one bounded visit per eligible section (a plan in scope). The frame's
// existing visible list poll re-reads the first useful page; nothing here owns a timer. A retired
// visit (plan → no plan, other root/plan/store, hidden, disposed) can neither repaint, continue
// paging nor ask for history reconciliation.
import type { ReconcileRequest, RunRead, RunRequest, RunRow } from '../../shared/subagent-runs.ts';
import { readRuns, requestReconcile, dismissRunLoss, type ReadFailure, type ServiceHost } from './source.ts';
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
export type LossDismissalState = 'idle' | 'pending' | 'success' | 'error' | 'conflict';
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
  /** A continuation cursor is held: the service has said more rows exist beyond those loaded. */
  continuation: boolean;
  paging: boolean;
  pageError: boolean;
  /** Earlier rows the reader asked to see (0: the default amount); kept across repaints. */
  shown: number;
  reconciling: boolean;
  failure: ReadFailure | null;
  /**
   * The automatic history request of this root failed and will not be repeated automatically
   * (attempts exhausted, or a non-transient failure): offer the manual Retry.
   */
  historyRequestFailed: boolean;
  /** Per-visit execution baselines (subagents.ts); a new visit starts fresh, which is stricter. */
  baselines: ExecutionBaselines;
  /** Shows `step` more of the earlier list, reading further pages only when `loaded` runs out. */
  showMore: (visible: number, loaded: number, step: number) => void;
  retryHistory: () => void;
  /** Explicit, read-bound action. Surfaces decide whether to render a control. */
  dismissLoss: () => void;
  lossDismissal: LossDismissalState;
  lossDismissalFailure: ReadFailure | null;
}
interface Visit {
  key: string; claim: RunsClaim; state: RunsState; read: RunRead | null; more: RunRow[];
  cursor: string | null; phase: 'useful' | 'history' | 'done'; paging: boolean; pageError: boolean;
  shown: number; loading: boolean; epoch: number; pageEpoch: number; reconciling: boolean; failure: ReadFailure | null; baselines: ExecutionBaselines;
  mutationEpoch: number; controlEpoch: number; lossDismissal: LossDismissalState; lossDismissalFailure: ReadFailure | null;
}
/** Roots whose automatic history pass this frame already asked for (bounded; the service coalesces too). */
const ASKED_LIMIT = 64;
/** Automatic history requests per root and frame; failures back off over the existing poll (1, then 2 polls). */
const AUTO_ATTEMPTS = 3;
/** Failures worth asking again: the service or link was busy or briefly unavailable. */
const TRANSIENT = new Set(['busy', 'unavailable', 'disconnected', 'paused']);
/** `skip`: polls to wait before the next automatic attempt; `failed`: no more automatic attempts. */
interface Asked { state: 'pending' | 'done' | 'waiting' | 'failed'; attempts: number; skip: number }

export class RunsController {
  private visit: Visit | null = null;
  private claimed = false;
  private readonly asked = new Map<string, Asked>();
  private readonly host: RunsHost;
  constructor(host: RunsHost) { this.host = host; }
  beginPaint() { this.claimed = false; }
  /** A paint without an eligible section retires the visit and drops any held reply. */
  endPaint() { if (!this.claimed) this.retire(); }
  retire() { this.visit = null; }
  /** Hidden frame: in-flight replies are dropped; data stays for the next visible paint. */
  hidden() { if (this.visit) { this.visit.epoch++; this.visit.pageEpoch++; this.visit.mutationEpoch++; this.visit.controlEpoch++; this.visit.lossDismissal = 'idle'; this.visit.lossDismissalFailure = null; this.visit.loading = false; this.visit.paging = false; this.visit.reconciling = false; } }
  /** The frame's visible list poll: re-read the first useful page of the current visit. */
  poll() { const v = this.visit; if (v && v.claim.capable && !v.loading && this.host.visible()) void this.load(v); }

  claim(c: RunsClaim): RunsPanel {
    this.claimed = true;
    const key = JSON.stringify([c.owner, c.request, c.capable, c.captureEnabled]);
    if (!this.visit || this.visit.key !== key) {
      this.visit = { key, claim: c, state: c.capable ? 'loading' : 'unavailable', read: null, more: [], cursor: null, phase: 'useful', paging: false, pageError: false, shown: 0, loading: false, epoch: 0, pageEpoch: 0, reconciling: false, failure: null, baselines: new ExecutionBaselines(), mutationEpoch: 0, controlEpoch: 0, lossDismissal: 'idle', lossDismissalFailure: null };
      if (c.capable && this.host.visible()) void this.load(this.visit);
    }
    const v = this.visit;
    const live = () => this.visit === v && this.host.visible();
    const reading = v.read, controlEpoch = ++v.controlEpoch;
    return {
      state: v.state, read: v.read, featured: v.read?.data ?? [], more: v.more,
      hasMore: v.state === 'ready' && v.phase !== 'done', continuation: v.state === 'ready' && v.phase !== 'done' && v.cursor !== null, paging: v.paging, pageError: v.pageError, shown: v.shown,
      reconciling: v.reconciling, failure: v.failure, baselines: v.baselines,
      historyRequestFailed: this.asked.get(this.rootKey(v) ?? '')?.state === 'failed',
      showMore: (visible, loaded, step) => {
        if (!live() || v.lossDismissal === 'pending') return;
        v.shown = visible + step;
        // Read on demand only when the loaded rows run out.
        if (v.shown > loaded && v.phase !== 'done' && !v.paging) void this.page(v, v.shown - loaded);
        else this.host.changed();
      },
      retryHistory: () => { if (live()) void this.reconcile(v, v.read?.recovery.token ?? undefined, true); },
      lossDismissal: v.lossDismissal, lossDismissalFailure: v.lossDismissalFailure,
      dismissLoss: () => {
        // An identical poll replaces the snapshot without repainting. Bind to the painted fence,
        // not object identity, while retiring controls from earlier paints and changed detections.
        if (live() && controlEpoch === v.controlEpoch && reading?.runFormat === v.read?.runFormat
          && reading?.capture.lossNotice?.sequence === v.read?.capture.lossNotice?.sequence) void this.dismissLoss(v);
      },
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
    // A pre-mutation snapshot must never roll back an acknowledged fence or newer detection.
    if (v.read && read.revision < v.read.revision) return;
    // The server read time moves on every read; it is not a change worth a repaint.
    const same = (a: RunRead) => JSON.stringify({ ...a, readAt: 0 });
    const changed = !v.read || v.state !== 'ready' || same(v.read) !== same(read);
    // A newer run-data revision invalidates continuation cursors: paging starts again.
    if (v.read && v.read.revision !== read.revision) { v.more = []; v.phase = 'useful'; v.pageEpoch++; v.paging = false; v.pageError = false; v.shown = 0; }
    if (v.phase === 'useful' && !v.more.length) v.cursor = read.nextCursor;
    v.read = read; v.state = read.availability === 'ready' ? 'ready' : 'unavailable'; v.failure = null;
    if (v.lossDismissal === 'success' && read.capture.lossNotice?.attention) v.lossDismissal = 'idle';
    if (changed) this.host.changed();
    this.autoReconcile(v);
  }

  private rootKey(v: Visit) { const r = v.read; return r ? JSON.stringify([v.claim.owner, r.storeId, r.source, r.root]) : null; }

  /** Mutation fences both kinds of reads and drops revision-bound continuation cursors. */
  private invalidateReads(v: Visit) {
    v.epoch++; v.loading = false; v.pageEpoch++; v.paging = false; v.pageError = false;
    v.cursor = null; v.more = []; v.phase = 'useful'; v.shown = 0;
    if (v.read) v.read = { ...v.read, nextCursor: null };
  }

  private async dismissLoss(v: Visit) {
    const read = v.read, notice = read?.capture.lossNotice;
    if (v.state !== 'ready' || read?.runFormat !== 2 || !notice?.attention || v.lossDismissal === 'pending') return;
    const q = v.claim.request;
    const request = { storeId: q.storeId, binding: { ...q.binding }, source: q.source, root: q.root, observedLossSequence: notice.sequence };
    const epoch = ++v.mutationEpoch;
    const own = () => this.visit === v && v.mutationEpoch === epoch && this.host.visible();
    this.invalidateReads(v); v.controlEpoch++; v.lossDismissal = 'pending'; v.lossDismissalFailure = null; this.host.changed();
    const result = await dismissRunLoss(this.host.service(own), request);
    if (!own()) return;
    this.invalidateReads(v);
    if (result.ok) {
      const ack = result.value, current = v.read!;
      // At equal revision prefer the later service observation (attention may age out).
      if (ack.revision > current.revision || ack.revision === current.revision && ack.readAt >= current.readAt) {
        v.read = { ...current, revision: ack.revision, readAt: ack.readAt, capture: ack.capture };
      }
      v.lossDismissal = v.read!.capture.lossNotice?.attention ? 'idle' : 'success';
    } else {
      v.lossDismissal = result.conflict ? 'conflict' : 'error'; v.lossDismissalFailure = result.failure;
    }
    this.host.changed();
    // Ordinary owner refresh; no new cadence or cross-frame channel.
    void this.load(v);
  }

  /**
   * One automatic metadata-only history pass per root and frame, only with capture on. A transient
   * failure is asked again on a later visible poll (backed off, at most AUTO_ATTEMPTS in all); once
   * those are spent, or after a non-transient failure, the manual Retry is offered instead.
   */
  private autoReconcile(v: Visit) {
    const r = v.read;
    if (!r || r.availability !== 'ready' || r.recovery.state !== 'not-requested' || !r.capture.enabled || !v.claim.captureEnabled) return;
    const root = this.rootKey(v)!;
    const a = this.asked.get(root);
    if (a && a.state !== 'waiting') return;
    if (a && a.skip > 0) { a.skip--; return; }
    if (!a) { this.asked.set(root, { state: 'pending', attempts: 0, skip: 0 }); if (this.asked.size > ASKED_LIMIT) this.asked.delete(this.asked.keys().next().value!); }
    void this.reconcile(v);
  }

  private async reconcile(v: Visit, token?: string, manual = false) {
    if (v.reconciling || !v.read) return;
    const root = this.rootKey(v)!;
    const a = this.asked.get(root) ?? { state: 'pending' as const, attempts: 0, skip: 0 };
    a.state = 'pending'; if (!manual) a.attempts++;
    this.asked.set(root, a);
    const q = v.claim.request;
    const body: ReconcileRequest = { storeId: q.storeId, binding: q.binding, source: q.source, root: q.root, ...(token ? { token } : {}) };
    v.reconciling = true; this.host.changed();
    const own = () => this.visit === v && this.host.visible();
    const r = await requestReconcile(this.host.service(own), body);
    // The outcome belongs to the root, even when this visit has meanwhile retired.
    if (r.ok) a.state = 'done';
    else if (manual || !TRANSIENT.has(r.failure.kind) || a.attempts >= AUTO_ATTEMPTS) a.state = 'failed';
    else { a.state = 'waiting'; a.skip = 2 ** (a.attempts - 1); }
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
    if (v.read && r.value.revision !== v.read.revision) { this.invalidateReads(v); this.host.changed(); void this.load(v); return; }
    const seen = new Set([...(v.read?.data ?? []), ...v.more].map((x) => x.id));
    const fresh = r.value.data.filter((x) => !seen.has(x.id));
    v.more = [...v.more, ...fresh];
    v.cursor = r.value.nextCursor;
    if (!v.cursor) v.phase = phase === 'useful' ? 'history' : 'done';
    this.host.changed();
    if (fresh.length < need && v.phase !== 'done') void this.page(v, need - fresh.length, budget - 1);
  }
}
