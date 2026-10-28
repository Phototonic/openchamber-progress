// Shared frame lifecycle for panel, status and page.
// - latest context wins: a context notification re-reads only when the list scope changes; an
//   obsolete read never blocks the new one (bounded overlap) and its reply is dropped
// - scoped reads carry their scope key and are never shown for another context
// - the last validated read of up to 8 recent scopes is kept per frame, keyed by integration account +
//   store + source binding + scope; returning to one paints it at once and revalidates quietly
// - provisional 3 s polling (8 s after failure), paused while hidden, stopped on dispose
// - selected-plan detail, document and history load on demand and are cached by revision/capture
// - cache identity = frame (host generation) + storeId + source binding; a change resets UI state
// - repaint only on change; focus, scroll and open disclosures survive a repaint
// - task-reading state (filters, jump cursors, task disclosures, logical focus, reading anchor)
//   lives for one reading identity: integration account + store/binding + view scope + plan; never stored
// - one in-place 30 s label ticker (ages, elapsed) while visible and showing such a label
// - official-main version check: at host readiness, then when due (coarse), visible frames only
// - full-page History only: one "Since you last reviewed" visit (change-digest.ts), created lazily;
//   panel/status never construct it, so they start no digest read or checkpoint write
// - board search only (spec.freshness/retire): while results are shown, the same poll revalidates
//   them with one bounded freshness read instead of the list read; every cache reset retires them
import { connectHost, type HostClient, type HostReadyContext, type SessionSnapshot } from '@openchamber/sdk';
import { applyHostReady } from '@openchamber/sdk/ui';
import type { CleanupAction, SetupAction } from './adapter.ts';
import { cleanupEligible, cleanupError, cleanupMatches, cleanupTarget, initialCleanup, type CleanupState, type CleanupTarget } from './cleanup.ts';
import { el, refreshLabels, type Env } from './components.ts';
import { LiveWorkspace, type LiveSnapshot } from './live.ts';
import { OFFICIAL_MAIN_URL } from './config.ts';
import type { DocumentBody, HealthView, HistoryEntry, OfficialMainView, PlanDetail, PlanView, ReadingState, SetupTargets, SetupView, StoreRead } from './model.ts';
import { RecentMemory, RefreshGate } from './refresh.ts';
import { OFFICIAL_MAIN_DISMISSED_KEY, OfficialMainState } from './official.ts';
import { DigestController, type DigestPanel } from './change-digest.ts';
import { CheckpointStore, type CheckpointIdentity } from './change-digest-checkpoint.ts';
import { cleanupCall, readDetail, readDocument, readHistory, readList, setupCall, type DetailResult, type DetailSnapshot, type ListScope, type ReadFailure, type ServiceHost, type SetupResult } from './source.ts';
import { describeDetailFailure, formatHandoff, formatProgressUpdate, formatSummaryOnly } from './summary.ts';
import { CSS } from './style.ts';
import { directoryKey } from './path.ts';

export const REFRESH_MS = 3000;
export const RETRY_MS = 8000;
export const RECENT_SCOPES = 8;
/** Cadence of the one in-place label ticker (ages and whole-minute elapsed times). */
const LABEL_TICK_MS = 30_000;
/**
 * Official-main check cadence for a visible frame: when the service says the next check is due,
 * bounded to 5–60 min (a skewed browser clock only moves it within the bounds). The service
 * caches, coalesces and backs off its single upstream request; this only asks it again.
 */
const MAIN_MIN_MS = 5 * 60_000;
const MAIN_MAX_MS = 60 * 60_000;
// A repaint replaces the root, which would restart each reported-progress animation. Starting them
// at the document timeline's origin keeps one shared phase (they share one period, style.ts), so a
// repaint or a return from hidden shows no jump. Views without motion skip the style read.
function alignMotion(root: Element | null) {
  if (!root?.querySelector('[data-motion="on"]')) return;
  for (const a of root.getAnimations({ subtree: true })) a.startTime = 0;
}
// The browser also restarts animations without a repaint, e.g. when the host shows a hidden frame
// again; those join the shared phase as they start.
document.addEventListener('animationstart', (event) => {
  if (!event.animationName.startsWith('ap-') || !(event.target instanceof Element)) return;
  for (const a of event.target.getAnimations({ subtree: true })) if (a.startTime !== 0) a.startTime = 0;
});

export type Surface = 'panel' | 'status' | 'page';
export type Loadable<T> = { state: 'loading' } | { state: 'ready'; value: T } | { state: 'error'; failure: ReadFailure };

export interface ViewContext<U> {
  host: HostClient;
  ctx: HostReadyContext;
  session: SessionSnapshot | null;
  directory: string | null;
  health: HealthView | null;
  /** Data for the current scope only (null while that scope is loading or not configured). */
  read: StoreRead | null;
  failure: ReadFailure | null;
  lastGoodAt: number | null;
  live: LiveSnapshot;
  env: Env;
  ui: U;
  setUi: (patch: Partial<U>) => void;
  /** Functional update against the latest UI state (safe after an await). */
  updateUi: (fn: (ui: U) => Partial<U>) => void;
  retry: () => void;
  sessionSubscriptions: number;
  detail: (plan: PlanView) => Loadable<PlanDetail> | null;
  document: (plan: PlanView) => Loadable<DocumentBody> | null;
  requestDocument: (plan: PlanView) => void;
  history: (plan: PlanView) => Loadable<{ entries: HistoryEntry[]; truncated: boolean }> | null;
  requestHistory: (plan: PlanView) => void;
  setup: Loadable<SetupView> | null;
  requestSetup: () => void;
  runSetup: (action: SetupAction, targets: SetupTargets | null, confirmed: boolean) => Promise<SetupResult>;
  storage: HostClient['storage'];
  identity: string;
  cleanup: CleanupState;
  requestDelete: (plan: PlanView) => void;
  cancelCleanup: () => void;
  confirmDelete: () => void;
  runCleanup: (action: 'archive' | 'restore', plan: PlanView) => void;
  /** What official main advertises; null while unknown (not checked yet, older service, failure). */
  officialMain: OfficialMainView | null;
  /** Candidate version whose notice the user dismissed. */
  officialMainDismissed: string | null;
  dismissOfficialMain: (version: string) => void;
  openOfficialMain: () => void;
  /** Task-reading state of the plan this view reads in detail; null without a reading identity. */
  reading: ReadingView | null;
  summary: (plan: PlanView) => SummaryView | null;
  /** Full-page History digest of this plan in the current read; null elsewhere (rail, status). */
  digest: (plan: PlanView) => DigestPanel | null;
  /** Proxy whose requests are refused once `current` is false or the frame is disposed. */
  service: (current: () => boolean) => ServiceHost;
  /** Plan metadata of the last complete detail read of this key, or null (not read, loading, failed). */
  detailPlan: (plan: PlanView) => PlanView | null;
}

/** One poll's bounded freshness read in place of the list read; `identity` asks for the list read instead. */
export type Freshness = (service: ServiceHost) => Promise<{ ok: true } | { ok: false; failure: ReadFailure; identity: boolean }>;

export type SummaryMode = 'progress' | 'handoff';
export interface SummaryView {
  preview: { generation: number; mode: SummaryMode; text: string | null; message: string; canRetry: boolean; canSummaryOnly: boolean; copying: boolean; status: string } | null;
  open: (mode: SummaryMode) => void;
  close: () => void;
  copy: () => void;
  retry: () => void;
  summaryOnly: () => void;
}

/** Task-reading controls of one reading identity. A view from a retired identity does nothing. */
export interface ReadingView extends ReadingState {
  /** Latest state of this identity; null once it is retired. */
  current: () => ReadingState | null;
  /** Changes the state and repaints; `then` runs once after that paint, with its root. */
  set: (patch: Partial<ReadingState>, then?: (root: HTMLElement) => void) => void;
  /** Changes the state without a repaint (a jump cursor). */
  remember: (patch: Partial<ReadingState>) => void;
}

export interface ViewSpec<U> {
  surface: Surface;
  /** Session stream budget; remaining host slots are used for worktree discovery (total ≤32). */
  maxSessionSubscriptions: number;
  initialUi: () => U;
  /** Server-side list scope for the current context; null reads health only. */
  scope: (ctx: { session: SessionSnapshot | null; directory: string | null }, ui: U) => ListScope | null;
  wantProjects: (vc: ViewContext<U>) => string[];
  /** Plans whose full detail this view shows right now. */
  wantDetails: (vc: ViewContext<U>) => PlanView[];
  paint: (root: HTMLElement, vc: ViewContext<U>) => void;
  afterPaint?: (root: HTMLElement, vc: ViewContext<U>) => void;
  /** Called after a store/binding identity change and on context changes, e.g. to restore stored UI. */
  onContext?: (vc: ViewContext<U>) => void;
  /** Only rail/page expose cleanup; the selected plan, including document/history tabs. */
  actionPlan?: (vc: ViewContext<U>) => PlanView | null;
  forgetPlans?: (keys: Set<string>, ui: U, vc: ViewContext<U>) => Partial<U>;
  /**
   * The plan this view reads in full detail and the explicit view scope it is read under (rail: the
   * selected session; board: its own list scope, never the host session). Its task-reading state
   * lives exactly as long as this identity; a plan article painted with `data-reading` uses it.
   */
  reading?: (vc: ViewContext<U>) => { plan: string; scope: string } | null;
  /**
   * Board search only: while it returns a read, each poll (same 3 s / 8 s cadence, visible frames
   * only) runs it instead of the list read, as long as the current scope's list read is shown.
   */
  freshness?: (vc: ViewContext<U>) => Freshness | null;
  /**
   * Retirement of view-owned async work: `reset` with every cache reset (store/binding/integration-account
   * change, setup action, cleanup, list eviction), `hidden` when the frame is hidden, `dispose` on pagehide.
   */
  retire?: (reason: 'reset' | 'hidden' | 'dispose') => void;
  /**
   * Board search only: identity of the part-read selection outside the ordinary reading identity
   * (search run + selection, also for plans outside the loaded list). A change retires in-flight
   * detail/document/history reads exactly like a reading change; null leaves that to the reading.
   */
  partsKey?: (vc: ViewContext<U>) => string | null;
  /** Board search only: plan keys whose detail/document/history caches are kept; others are evicted. Null: no bound. */
  retainParts?: (vc: ViewContext<U>) => ReadonlySet<string> | null;
}

const FOCUSABLE = 'button,summary,[tabindex],a,input,select,textarea';
/** Plan identity of a plan article: plan IDs and item IDs repeat across sources and plans. */
const planScope = (n: Element | null | undefined) => {
  const article = n?.closest<HTMLElement>('article[data-testid^="plan-"]');
  return article ? `${article.dataset.testid}|${article.dataset.source ?? ''}` : null;
};
type FocusKey = NonNullable<ReturnType<typeof focusKey>>;
const focusKey = (root: HTMLElement) => {
  const active = document.activeElement as HTMLElement | null;
  if (!active || !root.contains(active)) return null;
  const owner = active.closest<HTMLElement>('[data-testid]');
  if (!owner) return null;
  const focusables = [...owner.querySelectorAll<HTMLElement>(FOCUSABLE)];
  return { id: owner.dataset.testid!, index: owner === active ? -1 : focusables.indexOf(active), plan: planScope(owner), reading: !!active.closest(READING) };
};

// Task-reading restoration inside a plan article painted with `data-reading` (its canonical task
// hierarchy `ul.ap-items`). Its Tasks section carries `data-complete` only when painted from
// complete detail, with or without task rows; a loading or failed paint has no marker. Rows are `li[data-testid]` (item-*/group-*); a branch's summary is
// its disclosure's `summary`.
const READING = 'article[data-reading]';
const TASKS_HEADING = '.ap-tasks-h';
const COMPLETE_TASKS = '.ap-tasks[data-complete]';
/** Logical focus on a canonical row or its summary, with what a fallback needs from the old paint. */
type Logical = { id: string; summary: boolean; ancestors: string[]; order: string[] };
/** A row line in view and its viewport offset, or (no row in view) the raw page scroll to keep across a loading paint. */
type Anchor = { id: string; top: number; next: string[] } | { scroll: number };
const rowsOf = (list: Element) => [...list.querySelectorAll<HTMLElement>('li[data-testid]')];
const summaryOf = (li: Element) => li.querySelector<HTMLElement>(':scope > details > summary');
/** Not hidden by a filter and not folded inside a closed ancestor disclosure. */
function shownRow(li: HTMLElement, list: Element) {
  if (li.closest('[hidden]')) return false;
  for (let d = li.parentElement?.closest('details'); d && list.contains(d); d = d.parentElement?.closest('details')) if (!d.open) return false;
  return true;
}
function logicalOf(active: Element, list: Element): Logical | null {
  const summary = active.tagName === 'SUMMARY' && !!active.parentElement?.matches('details.ap-group');
  const row = summary ? active.parentElement!.parentElement : active.matches('li[data-testid]') ? active : null;
  if (!(row instanceof HTMLElement) || !row.dataset.testid || !list.contains(row)) return null;
  const ancestors: string[] = [];
  for (let li = row.parentElement?.closest<HTMLElement>('li[data-testid]'); li && list.contains(li); li = li.parentElement?.closest<HTMLElement>('li[data-testid]')) ancestors.push(li.dataset.testid!);
  return { id: row.dataset.testid, summary, ancestors, order: rowsOf(list).map((n) => n.dataset.testid!) };
}
/** Row line (a task's own row or a branch summary), so a tall open branch is not the anchor itself. */
const lineOf = (li: Element) => li.querySelector<HTMLElement>(':scope > .ap-item, :scope > details > summary') ?? (li as HTMLElement);
/**
 * First row line that intersects the viewport, while the document is scrolled. None in view (e.g.
 * the reader is in Readiness above the tasks): no anchor, so plain page-scroll preservation stands.
 */
function anchorOf(list: Element): Anchor | null {
  if (!document.scrollingElement?.scrollTop) return null;
  const rows = rowsOf(list);
  const bottom = document.documentElement.clientHeight;
  for (let i = 0; i < rows.length; i++) {
    const r = lineOf(rows[i]).getBoundingClientRect();
    if (r.top >= bottom) return null; // rows are in document order: the rest are below the fold too
    if (r.height > 0 && r.bottom > 0) return { id: rows[i].dataset.testid!, top: r.top, next: rows.slice(i + 1).map((n) => n.dataset.testid!) };
  }
  return null;
}
/** Keeps the anchor row (or the next surviving one) at its old viewport offset, or the raw page scroll. */
function applyAnchor(list: Element, anchor: Anchor) {
  if ('scroll' in anchor) { if (document.scrollingElement && document.scrollingElement.scrollTop !== anchor.scroll) document.scrollingElement.scrollTop = anchor.scroll; return; }
  const rows = new Map(rowsOf(list).map((n) => [n.dataset.testid!, n]));
  for (const id of [anchor.id, ...anchor.next]) {
    const li = rows.get(id);
    const r = li && shownRow(li, list) ? lineOf(li).getBoundingClientRect() : null;
    if (!r?.height) continue;
    const delta = r.top - anchor.top;
    if (Math.abs(delta) >= 1 && document.scrollingElement) document.scrollingElement.scrollTop += delta;
    return;
  }
}
/**
 * Restores logical focus without scrolling: the same row if it is still shown, otherwise the
 * nearest shown ancestor summary, the next then previous shown task in the old reading order,
 * then the Tasks heading; a moved focus gets a short local notice.
 */
function restoreLogical(article: Element, list: Element, want: Logical) {
  const rows = new Map(rowsOf(list).map((n) => [n.dataset.testid!, n]));
  const exact = rows.get(want.id);
  let target: HTMLElement | null = exact && shownRow(exact, list) ? (want.summary ? summaryOf(exact) : null) ?? exact : null;
  const moved = !target;
  for (const id of want.ancestors) {
    if (target) break;
    const li = rows.get(id);
    if (li && shownRow(li, list)) target = summaryOf(li);
  }
  const at = want.order.indexOf(want.id);
  const task = (id: string) => { const li = id.startsWith('item-') ? rows.get(id) : undefined; return li && shownRow(li, list) ? li : null; };
  for (let i = at + 1; !target && i < want.order.length; i++) target = task(want.order[i]);
  for (let i = at - 1; !target && i >= 0; i--) target = task(want.order[i]);
  target ??= article.querySelector<HTMLElement>(TASKS_HEADING);
  target?.focus({ preventScroll: true });
  const notice = article.querySelector('[data-testid="focus-notice"]');
  if (moved && notice) notice.textContent = 'The row you were on is no longer shown, so focus moved to a nearby row.';
}

const scopeKey = (s: ListScope | null) => (s ? `s:${s.session ?? ''}|d:${s.session ? '' : directoryKey(s.directory ?? '')}|a:${s.archived ?? 'exclude'}` : 'none');

export function startView<U>(spec: ViewSpec<U>) {
  const host = connectHost();
  const mount = document.getElementById('root');
  if (!mount) throw new Error('Missing #root');

  let ctx: HostReadyContext | null = null;
  let session: SessionSnapshot | null = null;
  let directory: string | null = null;
  let health: HealthView | null = null;
  let read: StoreRead | null = null;
  let readScope = '';
  let readSig = '';
  let identity = '';
  let failure: ReadFailure | null = null;
  let lastGoodAt: number | null = null;
  let ui = spec.initialUi();
  const versions = { data: 0, live: 0, ui: 0, ctx: 0 };
  let paintedKey = '';
  let paintedUi = -1;
  let contextGeneration = 0;
  let paintedContextGeneration = -1;
  let liveSig = '';
  let timer: ReturnType<typeof setTimeout> | null = null;
  let labelTimer: ReturnType<typeof setTimeout> | null = null;
  const official = new OfficialMainState();
  let mainTimer: ReturnType<typeof setTimeout> | null = null;
  let mainGeneration = 0;
  let mainInFlight = false;
  let mainDueAt = 0;
  let disposed = false;
  let renderQueued = false;
  /**
   * `revision`: of the value (a read may return a newer one than requested). `requested`: the listed
   * revision the read was started for, so a reply ahead of a lagging list is read once, not on every
   * paint until the list catches up. `listRead`: for a failed read, the list read it failed under;
   * it is retried after a newer one. `captureEnabled`: list envelope state at read start;
   * capture toggles change this metadata without advancing either plan revision.
   */
  const details = new Map<string, { revision: number; requested: number; cleanup: number; requestedCleanup: number; captureEnabled: boolean | undefined; generation: number; value: Loadable<PlanDetail>; result?: DetailResult; historical?: DetailSnapshot; listRead?: number }>();
  let listReads = 0;
  const documents = new Map<string, Loadable<DocumentBody>>();
  const histories = new Map<string, Loadable<{ entries: HistoryEntry[]; truncated: boolean }>>();
  let setup: Loadable<SetupView> | null = null;
  let detailQueue: Promise<void> = Promise.resolve();
  let cacheGeneration = 0;
  let cleanup = initialCleanup();
  let cleanupBusy = false;
  let cleanupFocus: string | null = null;
  let digests: DigestController | null = null;
  // connection.account is integration-link state, not an authenticated host-user boundary.
  const digestIdentity = (p: Pick<PlanView, 'sourceId' | 'id'>, r: Pick<StoreRead, 'storeId' | 'binding'>): CheckpointIdentity => ({ integrationAccount: ctx?.connection?.account || null, storeId: r.storeId, binding: { sourceId: r.binding.sourceId, verified: r.binding.verified }, source: p.sourceId, plan: p.id });
  /** Scope the current read generation is for; context changes that keep it do not re-read. */
  let requestedScope = '';
  type PreviewBinding = { selection: string; key: string; plan: PlanView };
  type Preview = NonNullable<SummaryView['preview']> & { binding: PreviewBinding; result?: DetailResult; historical?: DetailSnapshot; summaryOnly?: boolean };
  let preview: Preview | null = null;
  let previewGeneration = 0;
  let previewScopeKey: string | null = null;
  let previewSelection: string | null = null;
  let previewFocus: { selection: string; hook: string; generation?: number } | null = null;
  // A disabled replacement loses focus to body. Recover only that gap: never take focus
  // away from text selection or another control the user reached while the write waited.
  const canReturnCopyFocus = () => !document.activeElement || document.activeElement === document.body || (document.activeElement as HTMLElement).dataset?.testid === 'summary-copy';

  function previewBinding(vc: ViewContext<U>, p: PlanView): PreviewBinding | null {
    const target = spec.reading?.(vc);
    if (disposed || spec.surface === 'status' || !vc.read || !target || target.plan !== p.key || !vc.read.plans.includes(p)) return null;
    const selection = JSON.stringify([ctx?.connection?.account ?? '', identity, spec.surface, target.scope, p.sourceId, p.id]);
    return { selection, key: JSON.stringify([selection, p.revision, p.cleanup?.revision ?? 0, cacheGeneration]), plan: p };
  }
  function currentPreviewBinding(): PreviewBinding | null {
    const vc = context();
    const target = spec.reading?.(vc);
    const p = target && vc.read?.plans.find((p) => p.key === target.plan);
    return p ? previewBinding(vc, p) : null;
  }
  function freshPreview(binding: PreviewBinding, mode: SummaryMode): Preview {
    return { binding, mode, generation: ++previewGeneration, text: null, message: 'Loading complete plan…', canRetry: false, canSummaryOnly: false, copying: false, status: '' };
  }
  /** Synchronous retirement also covers two selection changes before the next paint. */
  function reconcilePreview() {
    let binding = currentPreviewBinding();
    if ((binding?.selection ?? null) !== previewSelection) {
      // An obsolete selected-plan read must not hold the next selection behind its queue,
      // nor issue more continuation pages when a held reply is released.
      if (previewSelection !== null) { retireParts(); binding = currentPreviewBinding(); }
      previewSelection = binding?.selection ?? null;
    }
    if ((binding?.key ?? null) !== previewScopeKey) { previewScopeKey = binding?.key ?? null; previewGeneration++; }
    if (!preview) return;
    if (!binding || binding.selection !== preview.binding.selection) { preview = null; previewFocus = null; previewGeneration++; }
    else if (binding.key !== preview.binding.key) preview = freshPreview(binding, preview.mode);
  }
  function matchesSnapshot(s: DetailSnapshot, p: PlanView) {
    return !!read && s.identity.storeId === read.storeId && s.identity.binding.sourceId === read.binding.sourceId && s.identity.binding.verified === read.binding.verified && s.identity.sourceId === p.sourceId && s.identity.planId === p.id;
  }
  function preparePreview() {
    reconcilePreview();
    const bound = preview;
    if (!bound) return;
    const p = bound.binding.plan;
    const c = details.get(p.key);
    if (!c?.result || c.result === bound.result || c.requested !== p.revision && c.revision !== p.revision) return;
    const r = c.result;
    // A complete read ahead of the list waits for the list, without another read per paint.
    if (r.ok && (r.plan.revision !== p.revision || (r.plan.cleanup?.revision ?? 0) !== (p.cleanup?.revision ?? 0))) return;
    if (currentPreviewBinding()?.key !== bound.binding.key) return;
    // An explicit historical choice stays selectable through further background failures.
    // User actions and binding changes create a fresh preview; a complete read replaces it.
    if (bound.summaryOnly && !r.ok) return;
    // Complete matching cached reads remain reusable; degraded snapshots cannot cross a
    // retired reading generation (including leaving and returning to the same selection).
    const historical = c.generation === cacheGeneration ? r.snapshot ?? c.historical : undefined;
    const valid = historical && matchesSnapshot(historical, p) ? historical : undefined;
    const text = r.ok && r.snapshot && matchesSnapshot(r.snapshot, p) ? (bound.mode === 'progress' ? formatProgressUpdate(r) : formatHandoff(r)) : null;
    // Replacement retires every callback for the previous displayed string, including pending copy feedback.
    preview = { ...bound, generation: ++previewGeneration, result: r, historical: valid, text, summaryOnly: false, copying: false, status: '',
      message: r.ok ? (text === null ? describeDetailFailure({ kind: 'identity-contract' }) : '') : describeDetailFailure(r.cause), canRetry: text === null, canSummaryOnly: !r.ok && !!valid };
  }
  function summaryView(p: PlanView): SummaryView | null {
    reconcilePreview();
    const binding = previewBinding(context(), p);
    if (!binding) return null;
    const bound = preview;
    const generation = previewGeneration;
    const current = () => !disposed && generation === previewGeneration && currentPreviewBinding()?.key === binding.key;
    const active = () => current() && !!bound && preview === bound;
    const shown = bound?.binding.key === binding.key ? bound : null;
    const text = shown?.text ?? null;
    return {
      preview: shown ? { generation: shown.generation, mode: shown.mode, text, message: shown.message, canRetry: shown.canRetry, canSummaryOnly: shown.canSummaryOnly, copying: shown.copying, status: shown.status } : null,
      open: (mode) => { if (current()) { preview = freshPreview(binding, mode); versions.ui++; schedule(); } },
      close: () => {
        if (!active()) return;
        previewFocus = { selection: binding.selection, hook: `summary-${bound!.mode}` };
        preview = null; previewGeneration++; versions.ui++; schedule();
      },
      retry: () => {
        if (!active() || !bound!.canRetry) return;
        // Reuse the existing detail queue; preserve only its validated historical summary.
        preview = freshPreview(binding, bound!.mode); loadDetails([p], true); versions.ui++; schedule(); retry();
      },
      summaryOnly: () => {
        if (!active() || !bound!.canSummaryOnly || !bound!.historical || !bound!.result || bound!.result.ok || !matchesSnapshot(bound!.historical, p)) return;
        preview = { ...bound!, generation: ++previewGeneration, text: formatSummaryOnly(bound!.historical, bound!.result.cause), summaryOnly: true, canSummaryOnly: false, status: '' };
        versions.ui++; schedule();
      },
      copy: () => {
        // The user click authorizes exactly this immutable displayed string, never a later read.
        if (!active() || text === null || bound!.copying) return;
        bound!.copying = true; bound!.status = 'Copying…'; versions.ui++; schedule();
        const finish = (success: boolean) => {
          if (!active()) return; // an OS write cannot be revoked; its retired feedback can be discarded
          bound!.copying = false;
          bound!.status = success ? 'Markdown copied.' : 'Clipboard unavailable. Select and copy the preview text below.';
          if (canReturnCopyFocus()) previewFocus = { selection: binding.selection, hook: 'summary-copy', generation: bound!.generation };
          versions.ui++; schedule();
        };
        try {
          const clipboard = globalThis.navigator?.clipboard;
          if (!clipboard?.writeText) { finish(false); return; }
          void clipboard.writeText(text).then(() => finish(true), () => finish(false));
        } catch { finish(false); }
      },
    };
  }
  /**
   * Task-reading state of the current reading identity (spec.reading). Replaced, never carried
   * over, when the identity changes; cleared with the caches on authority resets and disposal.
   */
  /** `parked`/`parkedControl`: a task row or a task-view control whose focus waits at Tasks during a loading paint. */
  type Reading = { key: string; plan: string; state: ReadingState; open: Map<string, boolean>; anchor: Anchor | null; parked: Logical | null; parkedControl: FocusKey | null; then: ((root: HTMLElement) => void)[] };
  let reading: Reading | null = null;
  /** The reading the current DOM was painted under: only its own paint is harvested. */
  let paintedReading: Reading | null = null;
  const clearReading = () => { reading = null; paintedReading = null; };
  function readingView(): ReadingView | null {
    const bound = reading;
    if (!bound) return null;
    const live = () => !disposed && reading === bound;
    return {
      ...bound.state,
      current: () => (live() ? bound.state : null),
      set: (patch, then) => {
        if (!live()) return;
        bound.state = { ...bound.state, ...patch };
        if (then) bound.then.push(then);
        versions.ui++; schedule();
      },
      remember: (patch) => { if (live()) bound.state = { ...bound.state, ...patch }; },
    };
  }
  const memory = new RecentMemory<{ read: StoreRead; sig: string; health: HealthView; at: number }>(RECENT_SCOPES);
  // Authority of a remembered read: this frame's integration account and the service's store + binding.
  // (A frame document belongs to one host server; a runtime switch reloads the frame.)
  const memoryKey = (key: string) => `${ctx?.connection?.account ?? ''}|${identity}#${key}`;

  const bump = () => { versions.data++; schedule(); };
  const retireParts = () => {
    cacheGeneration++; detailQueue = Promise.resolve();
    if (preview) preview = freshPreview(preview.binding, preview.mode);
    for (const [key, value] of details) if (value.value.state === 'loading') details.delete(key);
    for (const cache of [documents, histories]) for (const [key, value] of cache) if (value.state === 'loading') cache.delete(key);
  };
  const resetCaches = () => { retireParts(); details.clear(); documents.clear(); histories.clear(); memory.clear(); spec.retire?.('reset'); };
  const forgetPlans = (keys: Set<string>) => {
    if (reading && keys.has(reading.plan)) clearReading();
    if (keys.size && spec.forgetPlans) { ui = { ...ui, ...spec.forgetPlans(keys, ui, context()) }; versions.ui++; }
  };

  /** The list scope changed: show its remembered validated read (if any) until the new read lands. */
  function adoptScope(key: string) {
    if (key === readScope || !identity) return;
    const hit = memory.get(memoryKey(key));
    if (!hit) return; // unknown scope: loading, never another scope's data
    read = hit.read; readScope = key; readSig = hit.sig; health = hit.health; lastGoodAt = hit.at;
    versions.data++;
  }

  const live = new LiveWorkspace(host, spec.maxSessionSubscriptions, () => {
    const sig = JSON.stringify([live.snapshot.projectsState, live.snapshot.projects, [...live.snapshot.worktrees], [...live.snapshot.sessions], live.snapshot.capped]);
    if (sig !== liveSig) { liveSig = sig; versions.live++; schedule(); }
  });

  const currentScope = () => spec.scope({ session, directory }, ui);
  // The proxy cannot abort an already sent request. Retired reads must also stop
  // issuing continuation pages after a held health/detail/document reply arrives.
  const guardedHost = (current: () => boolean) => ({
    serviceRequest: (request: Parameters<HostClient['serviceRequest']>[0]) =>
      !disposed && current() ? host.serviceRequest(request) : Promise.reject(new Error('Retired read')),
  });
  /** Latest context wins: retire the read only when the list scope really changed. */
  function scopeMoved() {
    const key = scopeKey(currentScope());
    if (key === requestedScope) return false;
    requestedScope = key;
    gate.retire();
    retireParts();
    read = null; readScope = ''; readSig = ''; failure = null; lastGoodAt = null;
    adoptScope(key);
    return true;
  }
  function applyUi(patch: Partial<U>) {
    ui = { ...ui, ...patch }; versions.ui++; schedule();
    if (scopeMoved()) retry();
    reconcilePreview();
    reconcileParts();
  }
  let partsKey: string | null = null;
  /** A changed part-read selection retires in-flight part reads (no continuation, no queue behind them). */
  function reconcileParts() {
    if (!spec.partsKey || !ctx) return;
    const key = spec.partsKey(context());
    if (key === partsKey) return;
    const before = partsKey;
    partsKey = key;
    if (before !== null || key !== null) retireParts();
  }
  /** Bounded part caches (board search): entries of other plans are dropped; in-flight ones cannot return (identity guard). */
  function retainParts(keep: ReadonlySet<string>) {
    const plan = (k: string) => k.slice(0, k.indexOf('@'));
    for (const k of details.keys()) if (!keep.has(k)) details.delete(k);
    for (const cache of [documents, histories]) for (const k of cache.keys()) if (!keep.has(plan(k))) cache.delete(k);
  }

  const gate = new RefreshGate(async (generation) => {
    const scope = currentScope();
    const key = scopeKey(scope);
    const fresh = read && identity && readScope === key ? spec.freshness?.(context()) ?? null : null;
    if (fresh) {
      const result = await fresh(guardedHost(() => generation === gate.current));
      if (disposed || generation !== gate.current) return;
      if (result.ok) {
        // Counts as a successful refresh: a failed detail is retried once, as after a list read.
        listReads++;
        if (failure || [...details.values()].some((d) => d.value.state === 'error')) versions.data++;
        // Same setup recheck as a list refresh: a pending reload notice clears once the service observes it.
        if (!setup || (setup.state === 'ready' && setup.value.activation === 'reload-required')) loadSetup();
        failure = null; lastGoodAt = Date.now();
        schedule(); plan(REFRESH_MS);
        return;
      }
      if (!result.identity) {
        if (!failure || failure.kind !== result.failure.kind) versions.data++;
        failure = result.failure;
        schedule(); plan(RETRY_MS);
        return;
      }
      // The store or binding moved: the list read below adopts it and resets what belonged to the old one.
    }
    const result = await readList(guardedHost(() => generation === gate.current), scope);
    if (disposed || generation !== gate.current) return; // a retired context owns nothing
    if (result.ok && !result.health.ready && read) {
      // The service no longer finds its setup, but this frame showed data from it: keep that
      // data visibly stale instead of replacing it with a setup form.
      if (health?.ready !== false) { setup = null; loadSetup(); }
      health = result.health;
      if (failure?.kind !== 'setup-lost') versions.data++;
      failure = { kind: 'setup-lost', code: result.health.diagnostics.join(',') || 'not-ready', message: 'The progress service reports that it is not set up.' };
      schedule();
      plan(RETRY_MS);
      return;
    }
    if (result.ok) {
      const nextHealth = result.health;
      let authorityChanged = false;
      if (health && health.ready !== nextHealth.ready) { setup = null; loadSetup(); }
      const nextRead = result.read;
      if (nextRead) {
        const nextIdentity = `${nextRead.storeId}|${nextRead.binding.sourceId ?? ''}|${nextRead.binding.verified}`;
        if (identity && nextIdentity !== identity) { authorityChanged = true; ui = spec.initialUi(); versions.ui++; resetCaches(); clearReading(); cleanup = { ...initialCleanup(), pending: cleanupBusy }; live.restart(); }
        // A complete refreshed scope is authoritative about keys formerly in that scope.
        // Evict all remembered scopes/parts so another session cannot resurrect removed data.
        const previous = memory.get(memoryKey(key))?.read;
        if (previous && !nextRead.truncated && previous.storeId === nextRead.storeId) {
          const changed = new Set(previous.plans.filter((p) => {
            const next = nextRead.plans.find((n) => n.key === p.key);
            return !next || (next.cleanup?.revision ?? 0) !== (p.cleanup?.revision ?? 0);
          }).map((p) => p.key));
          if (changed.size) { resetCaches(); forgetPlans(changed); }
        }
        identity = nextIdentity;
      }
      const sig = JSON.stringify([key, nextHealth, nextRead]);
      if (sig !== readSig || failure) { readSig = sig; read = nextRead; readScope = key; health = nextHealth; versions.data++; }
      // A failed detail is retried once per successful list refresh (poll or Try again), never per paint.
      listReads++;
      if ([...details.values()].some((d) => d.value.state === 'error')) versions.data++;
      // Only a complete, current-generation list read for a real scope is remembered.
      if (scope && nextRead && identity) memory.set(memoryKey(key), { read: nextRead, sig, health: nextHealth, at: Date.now() });
      // Setup status (reload-required, capture off) is shown on every surface. A pending reload is
      // re-read each refresh so the notice clears once the service observes the loaded companion.
      if (!setup || (setup.state === 'ready' && setup.value.activation === 'reload-required')) loadSetup();
      failure = null;
      lastGoodAt = Date.now();
      if (authorityChanged) spec.onContext?.(context());
    } else {
      if (!failure || failure.kind !== result.failure.kind) versions.data++;
      failure = result.failure;
    }
    schedule();
    plan(failure ? RETRY_MS : REFRESH_MS);
  });

  function plan(ms: number) {
    if (timer) clearTimeout(timer);
    timer = null;
    if (disposed || document.visibilityState === 'hidden') return;
    timer = setTimeout(() => gate.request(), ms);
  }
  const retry = () => { if (timer) clearTimeout(timer); gate.request(); };

  const cleanupContext = () => JSON.stringify([ctx?.connection?.account ?? '', identity, session?.id ?? null, directory, scopeKey(currentScope())]);
  function validTarget(target: CleanupTarget) {
    return !disposed && !failure && health?.planCleanup === 1 && cleanupMatches(target, spec.actionPlan?.(context()) ?? null, read?.storeId, cleanupContext());
  }
  function cancelCleanup() {
    if (cleanupBusy) return;
    cleanup = initialCleanup(); cleanupFocus = 'cleanup-delete'; versions.ui++; schedule();
  }
  function requestDelete(plan: PlanView) {
    if (cleanupBusy || !read || !cleanupEligible('delete', plan)) return;
    const target = cleanupTarget(plan, read.storeId, cleanupContext());
    if (!validTarget(target)) return;
    cleanup = { ...initialCleanup(), target }; cleanupFocus = 'cleanup-cancel'; versions.ui++; schedule();
  }
  async function runCleanup(action: CleanupAction, target: CleanupTarget) {
    if (cleanupBusy || !validTarget(target)) { if (!cleanupBusy) cancelCleanup(); return; }
    const selected = spec.actionPlan?.(context());
    if (!selected || !cleanupEligible(action, selected)) return;
    const actionIdentity = identity;
    const actionIntegrationAccount = ctx?.connection?.account;
    const deleted = action === 'delete' && read ? digestIdentity({ sourceId: target.request.source, id: target.request.plan }, { storeId: target.request.storeId, binding: read.binding }) : null;
    cleanupBusy = true; cleanup = { ...cleanup, pending: true, message: null }; versions.ui++; schedule();
    const result = await cleanupCall(host, action, target.request);
    cleanupBusy = false;
    // A confirmed deletion is authoritative for its captured context: retire its review markers.
    if (result.ok && deleted) { if (digests) digests.forget(deleted); else void new CheckpointStore(host.storage, () => ctx?.features?.deviceStorage === true).forget(deleted); }
    if (disposed) return;
    if (identity !== actionIdentity || ctx?.connection?.account !== actionIntegrationAccount) {
      cleanup = initialCleanup(); versions.ui++; schedule(); return;
    }
    const sameContext = target.context === cleanupContext();
    // Also reconcile ambiguous failures. Never replay an action automatically or retain
    // pre-action data as a fresh success; every part/list reply from before this is retired.
    gate.retire(); resetCaches(); forgetPlans(new Set([target.key]));
    read = null; readScope = ''; readSig = ''; failure = null;
    cleanup = { ...initialCleanup(), error: !result.ok, message: sameContext ? (result.ok ? (action === 'archive' ? 'Plan archived. Find it in Archived plans on the full page.' : action === 'restore' ? 'Plan restored. It is still finished; its history is unchanged.' : 'Stored plan deleted. The original file was not changed.') : cleanupError(result.failure.code)) : null };
    cleanupFocus = result.ok ? 'cleanup-notice' : 'cleanup-error'; versions.ui++; versions.data++; schedule(); retry();
  }

  function loadDetails(plans: PlanView[], force = false) {
    for (const p of plans) {
      const cached = details.get(p.key);
      const cleanupRev = p.cleanup?.revision ?? 0;
      const captureEnabled = read?.captureEnabled;
      if (!force && cached && cached.captureEnabled === captureEnabled && (cached.revision === p.revision || cached.requested === p.revision) && (cached.cleanup === cleanupRev || cached.requestedCleanup === cleanupRev) && cached.value.state !== 'error') continue;
      if (cached && cached.value.state === 'loading') continue;
      if (!force && cached && cached.value.state === 'error' && cached.revision === p.revision && cached.requestedCleanup === cleanupRev && cached.listRead === listReads) continue;
      const historical = cached?.generation === cacheGeneration ? cached.result?.snapshot ?? cached.historical : undefined;
      const pending: NonNullable<ReturnType<typeof details.get>> = { revision: p.revision, requested: p.revision, cleanup: cleanupRev, requestedCleanup: cleanupRev, captureEnabled, generation: cacheGeneration, historical, value: { state: 'loading' } };
      details.set(p.key, pending);
      const id = identity;
      const generation = cacheGeneration;
      // Same generation and still this exact pending entry (an evicted read cannot repopulate the cache).
      const own = () => !disposed && id === identity && generation === cacheGeneration && details.get(p.key) === pending;
      detailQueue = detailQueue.then(async () => {
        if (!own()) return;
        let result = await readDetail(guardedHost(own), p);
        if (!own()) return;
        if (result.snapshot && !matchesSnapshot(result.snapshot, p)) result = { ok: false, snapshot: null, cause: { kind: 'identity-contract' }, failure: { kind: 'invalid', code: 'CONTRACT', message: 'The detail reading identity was refused.' } };
        const common = { requested: p.revision, requestedCleanup: cleanupRev, captureEnabled, generation, result, historical };
        details.set(p.key, result.ok ? { ...common, revision: result.detail.revision, cleanup: result.plan.cleanup?.revision ?? 0, value: { state: 'ready', value: result.detail } } : { ...common, revision: p.revision, cleanup: cleanupRev, value: { state: 'error', failure: result.failure }, listRead: listReads });
        bump();
      });
    }
  }

  const docKey = (p: PlanView) => `${p.key}@${p.document.captureId ?? 'none'}:${p.document.state}:${p.revision}`;

  function loadSetup() {
    setup = setup && setup.state === 'ready' ? setup : { state: 'loading' };
    void setupCall(host, null).then((r) => {
      if (disposed) return;
      const next: Loadable<SetupView> = r.ok ? { state: 'ready', value: r.setup } : { state: 'error', failure: r.failure ?? { kind: 'unavailable', code: r.code, message: r.code } };
      const changed = JSON.stringify(next) !== JSON.stringify(setup);
      setup = next;
      if (changed) bump();
    });
  }

  /**
   * Official-main version check. One request per frame at a time; a hidden or disposed frame
   * starts none and drops the reply of a retired one (generation). Independent of setup, store
   * and the progress poll.
   */
  function checkMain() {
    if (disposed || mainInFlight || document.visibilityState === 'hidden') return;
    mainInFlight = true;
    const generation = ++mainGeneration;
    void official.check(host, host.storage).then(({ next, apply }) => {
      if (generation !== mainGeneration) return;
      mainInFlight = false;
      if (disposed) return;
      if (apply()) bump();
      const due = next ? Date.parse(next.nextCheckAt) - Date.now() : MAIN_MIN_MS;
      mainDueAt = performance.now() + Math.min(MAIN_MAX_MS, Math.max(MAIN_MIN_MS, due));
      planMain();
    });
  }
  function planMain() {
    if (mainTimer) clearTimeout(mainTimer);
    mainTimer = null;
    if (disposed || document.visibilityState === 'hidden' || mainInFlight) return;
    mainTimer = setTimeout(checkMain, Math.max(0, mainDueAt - performance.now()));
  }
  /** Leaving view retires the in-flight check; its reply is ignored and a visible frame asks again when due. */
  function retireMain() {
    if (mainTimer) clearTimeout(mainTimer);
    mainTimer = null;
    if (mainInFlight) { mainGeneration++; mainInFlight = false; }
  }

  /**
   * One text-only ticker per frame for age and elapsed labels. It runs only while the frame is
   * visible and shows such a label, never repaints, and each tick recomputes from the labels'
   * own anchors, so a pause loses nothing.
   */
  function planLabels() {
    const wanted = !disposed && document.visibilityState !== 'hidden' && !!mount!.querySelector('time[data-age],time[data-elapsed]');
    if (!wanted) { if (labelTimer) clearTimeout(labelTimer); labelTimer = null; return; }
    labelTimer ??= setTimeout(() => {
      labelTimer = null;
      if (ctx) refreshLabels(mount!, ctx.locale);
      planLabels();
    }, LABEL_TICK_MS);
  }

  function schedule() {
    if (renderQueued) return;
    renderQueued = true;
    queueMicrotask(() => { renderQueued = false; render(); });
  }

  function context(): ViewContext<U> {
    const actionContext = cleanupContext();
    const confirmation = cleanup.target;
    const partGeneration = cacheGeneration;
    const canReadPart = () => !disposed && partGeneration === cacheGeneration && currentScope() !== null && readScope === scopeKey(currentScope());
    const env: Env = {
      locale: ctx!.locale, now: Date.now(), mono: performance.now(), live: live.snapshot,
      boundSource: read && read.binding.verified ? read.binding.sourceId : null,
      unverifiedSources: new Set(read ? read.sources.filter((s) => !s.verified).map((s) => s.id) : []),
      view: { fresh: !failure, captureEnabled: read?.captureEnabled ?? false },
      // Components offer this only for sessions the host currently lists and the verified bound source.
      openSession: (id) => { void host.openSession(id).catch(() => host.toast({ kind: 'error', message: 'That session could not be opened here.' }).catch(() => {})); },
    };
    return {
      host, ctx: ctx!, session, directory, health, read: readScope === scopeKey(currentScope()) ? read : null, failure, lastGoodAt, live: live.snapshot, env, ui,
      setUi: (patch) => applyUi(patch),
      updateUi: (fn) => applyUi(fn(ui)),
      retry, sessionSubscriptions: live.sessionSubscriptionCount,
      detail: (p) => { const c = details.get(p.key); return c ? c.value : null; },
      document: (p) => documents.get(docKey(p)) ?? null,
      requestDocument: (p) => {
        if (!canReadPart()) return;
        const k = docKey(p);
        const existing = documents.get(k);
        if (existing && existing.state !== 'error') return;
        const pending: Loadable<DocumentBody> = { state: 'loading' };
        documents.set(k, pending);
        const id = identity;
        const generation = cacheGeneration;
        const own = () => !disposed && id === identity && generation === cacheGeneration && documents.get(k) === pending;
        void readDocument(guardedHost(own), p).then((r) => {
          if (!own()) return;
          documents.set(k, r.ok ? { state: 'ready', value: r.body } : { state: 'error', failure: r.failure });
          bump();
        });
        bump();
      },
      history: (p) => histories.get(`${p.key}@${p.revision}`) ?? null,
      requestHistory: (p) => {
        if (!canReadPart()) return;
        const k = `${p.key}@${p.revision}`;
        const existing = histories.get(k);
        if (existing && existing.state !== 'error') return;
        const pending: Loadable<{ entries: HistoryEntry[]; truncated: boolean }> = { state: 'loading' };
        histories.set(k, pending);
        const id = identity;
        const generation = cacheGeneration;
        const own = () => !disposed && id === identity && generation === cacheGeneration && histories.get(k) === pending;
        void readHistory(guardedHost(own), p).then((r) => {
          if (!own()) return;
          histories.set(k, r.ok ? { state: 'ready', value: { entries: r.entries, truncated: r.truncated } } : { state: 'error', failure: r.failure });
          bump();
        });
        bump();
      },
      setup, requestSetup: loadSetup,
      runSetup: async (action, targets, confirmed) => {
        const r = await setupCall(host, action, targets, confirmed);
        if (r.ok && action !== 'inspect') { setup = { state: 'ready', value: r.setup }; resetCaches(); clearReading(); retry(); }
        // A refused action may mean the installation changed: re-read setup once, so the update
        // notice reflects the service again rather than the read the action started from.
        if (!r.ok && setup?.state === 'ready' && setup.value.configured) loadSetup();
        bump();
        return r;
      },
      storage: host.storage,
      identity,
      cleanup,
      requestDelete: (plan) => { if (actionContext === cleanupContext()) requestDelete(plan); },
      cancelCleanup: () => { if (confirmation === cleanup.target) cancelCleanup(); },
      // A retired button must never confirm a newer dialog's target.
      confirmDelete: () => { if (confirmation && confirmation === cleanup.target) void runCleanup('delete', confirmation); },
      runCleanup: (action, plan) => { if (read && actionContext === cleanupContext()) void runCleanup(action, cleanupTarget(plan, read.storeId, actionContext)); },
      officialMain: official.value, officialMainDismissed: official.dismissed,
      dismissOfficialMain: (version) => { official.dismiss(version); bump(); void host.storage.set(OFFICIAL_MAIN_DISMISSED_KEY, version).catch(() => {}); },
      openOfficialMain: () => { void host.openUrl(OFFICIAL_MAIN_URL).catch(() => host.toast({ kind: 'error', message: 'The link could not be opened here.' }).catch(() => {})); },
      reading: readingView(),
      summary: summaryView,
      digest: (p) => {
        if (spec.surface !== 'page' || disposed || !read || !identity || readScope !== scopeKey(currentScope()) || !read.plans.includes(p)) return null;
        digests ??= new DigestController({
          service: (current) => guardedHost(current),
          storage: host.storage,
          deviceStorage: () => ctx?.features?.deviceStorage === true,
          visible: () => document.visibilityState !== 'hidden',
          changed: () => { versions.ui++; schedule(); },
        });
        return digests.claim({ identity: digestIdentity(p, read), plan: p, capable: health?.planChangeDigests === 1, fresh: !failure });
      },
      service: (current) => guardedHost(current),
      detailPlan: (p) => { const c = details.get(p.key)?.result; return c?.ok && c.plan.key === p.key ? c.plan : null; },
    };
  }

  function render() {
    if (!ctx || disposed) return;
    const key = `${versions.data}|${versions.live}|${versions.ui}|${versions.ctx}`;
    if (key === paintedKey) return;
    // A background change must not close a picker the user has open; it paints once the
    // popup closes, including same-session metadata. Navigation and authority/UI
    // changes paint immediately; versions.ctx also includes non-navigation updates.
    if (contextGeneration === paintedContextGeneration && versions.ui === paintedUi && mount!.querySelector('[aria-expanded="true"]')) {
      setTimeout(schedule, 300);
      return;
    }
    paintedKey = key;
    paintedUi = versions.ui;
    paintedContextGeneration = contextGeneration;
    if (cleanup.target && !cleanupBusy && !validTarget(cleanup.target)) cleanup = initialCleanup();
    preparePreview();
    let vc = context();

    const focus = focusKey(mount!);
    const oldText = mount!.querySelector<HTMLTextAreaElement>('[data-testid="summary-text"]');
    const textSelection = oldText && preview && oldText.dataset.generation === String(preview.generation) ? { start: oldText.selectionStart, end: oldText.selectionEnd, direction: oldText.selectionDirection, top: oldText.scrollTop } : null;
    // Plan-reading disclosures, logical focus and anchor belong to the reading they were painted
    // under; a loading paint without the task list keeps what an earlier paint recorded.
    let logical: Logical | null = null;
    let onFallback = false;
    /** Focus on a task-view control (outside the task list) of the plan being read. */
    let taskControl = false;
    const oldArticle = mount!.querySelector<HTMLElement>(READING);
    if (reading && paintedReading === reading && oldArticle) {
      for (const d of oldArticle.querySelectorAll<HTMLDetailsElement>('details[data-testid]')) reading.open.set(d.dataset.testid!, d.open);
      const list = oldArticle.querySelector('ul.ap-items');
      const active = document.activeElement;
      // A painted list is authoritative about what is in view; only a loading paint keeps an earlier
      // anchor. With no task row in view (reading Readiness above them), keep the page offset itself.
      if (list) { const top = document.scrollingElement?.scrollTop ?? 0; reading.anchor = anchorOf(list) ?? (top ? { scroll: top } : null); logical = active ? logicalOf(active, list) : null; }
      onFallback = !!active?.matches(TASKS_HEADING) && oldArticle.contains(active);
      taskControl = !logical && !onFallback && !!active?.closest('.ap-tasks') && oldArticle.contains(active);
      if (!onFallback) { reading.parked = null; reading.parkedControl = null; }
    }
    const open = new Map([...mount!.querySelectorAll<HTMLDetailsElement>('details[data-testid]')].filter((d) => !d.closest(READING)).map((d) => [d.dataset.testid!, d.open]));
    const scrolls = new Map([...mount!.querySelectorAll<HTMLElement>('[data-scroll-key]')].map((n) => [n.dataset.scrollKey!, n.scrollTop]));
    const pageScroll = document.scrollingElement?.scrollTop ?? 0;
    const values = new Map([...mount!.querySelectorAll<HTMLInputElement>('input[data-keep]')].map((n) => [n.dataset.keep!, n.value]));

    // Equal plan and item IDs never carry reading state into another integration account, store, binding or scope.
    const target = spec.reading?.(vc) ?? null;
    const readingKey = target ? JSON.stringify([ctx?.connection?.account ?? '', identity, target.scope, target.plan]) : null;
    const sameReading = reading !== null && reading.key === readingKey;
    if (!sameReading) {
      reading = target && readingKey ? { key: readingKey, plan: target.plan, state: { status: 'all', participant: { kind: 'all' }, cursor: { working: null, blocked: null } }, open: new Map(), anchor: null, parked: null, parkedControl: null, then: [] } : null;
      vc = { ...vc, reading: readingView() };
    }

    const root = el('main', 'ap');
    root.dataset.surface = spec.surface;
    root.dataset.testid = 'progress-root';
    root.setAttribute('aria-busy', String(currentScope() !== null && !vc.read && !failure && !(health && !health.ready)));
    digests?.beginPaint();
    spec.paint(root, vc);
    digests?.endPaint();
    const article = reading ? root.querySelector<HTMLElement>(READING) : null;
    const list = article?.querySelector<HTMLElement>('ul.ap-items') ?? null;
    const complete = !!article?.querySelector(COMPLETE_TASKS);
    for (const d of root.querySelectorAll<HTMLDetailsElement>('details[data-testid]')) {
      const was = d.closest(READING) ? reading?.open.get(d.dataset.testid!) : open.get(d.dataset.testid!);
      if (was !== undefined && was !== d.open) { d.open = was; d.dispatchEvent(new Event('toggle')); }
    }
    // Complete detail (even with no task rows) is authoritative about which disclosures still exist.
    if (reading && complete) {
      const present = new Set([...article!.querySelectorAll<HTMLElement>('details[data-testid]')].map((d) => d.dataset.testid!));
      for (const id of reading.open.keys()) if (!present.has(id)) reading.open.delete(id);
    }
    for (const n of root.querySelectorAll<HTMLInputElement>('input[data-keep]')) {
      const v = values.get(n.dataset.keep!);
      if (v !== undefined && n.value !== v && !n.dataset.fixed) n.value = v;
    }
    mount!.replaceChildren(root);
    alignMotion(root);
    for (const n of root.querySelectorAll<HTMLElement>('[data-scroll-key]')) {
      const top = scrolls.get(n.dataset.scrollKey!);
      if (top) n.scrollTop = top;
    }
    if (document.scrollingElement) document.scrollingElement.scrollTop = pageScroll;
    if (sameReading && reading && complete && reading.anchor) { if (list) applyAnchor(list, reading.anchor); reading.anchor = null; }
    // Logical task focus: restored without scrolling, parked at Tasks across a loading gap and
    // brought back only while focus is still parked there.
    let restored = false;
    let back = focus;
    if (sameReading && reading && article) {
      const want = logical ?? (onFallback ? reading.parked : null);
      const toTasks = () => { restored = true; article.querySelector<HTMLElement>(TASKS_HEADING)?.focus({ preventScroll: true }); };
      if (!complete) {
        // Loading or failed: task rows and task-view controls are absent; wait at Tasks.
        if (want) { reading.parked = want; toTasks(); }
        else if (taskControl && focus) { reading.parkedControl = focus; toTasks(); }
      } else if (want && list) { reading.parked = null; restored = true; restoreLogical(article, list, want); }
      else if (onFallback && reading.parkedControl && list) { back = reading.parkedControl; reading.parkedControl = null; }
      else if (want || onFallback || (taskControl && !list)) {
        // Complete detail without the remembered target (e.g. no task rows): nothing stays parked;
        // focus stays at the Tasks heading, the nearby fallback.
        reading.parked = null; reading.parkedControl = null; toTasks();
      }
    }
    if (back && !restored && !(back.reading && !sameReading)) {
      // Focus inside a plan returns only to that same plan (source + ID), never a same-ID item elsewhere.
      const f = back;
      const candidates = [...root.querySelectorAll<HTMLElement>(`[data-testid="${CSS_ESCAPE(f.id)}"]`)];
      const owner = candidates.find((n) => planScope(n) === f.plan);
      const target = f.index < 0 ? owner : owner?.querySelectorAll<HTMLElement>(FOCUSABLE)[f.index];
      target?.focus({ preventScroll: true });
    }
    if (cleanupFocus) {
      const owner = root.querySelector<HTMLElement>(`[data-testid="${cleanupFocus}"]`);
      const target = owner?.querySelector<HTMLElement>('button') ?? owner;
      if (target) { if (target.tagName !== 'BUTTON') target.tabIndex = -1; target.focus({ preventScroll: true }); cleanupFocus = null; }
    }
    const nextText = root.querySelector<HTMLTextAreaElement>('[data-testid="summary-text"]');
    if (nextText && textSelection) { nextText.setSelectionRange(textSelection.start, textSelection.end, textSelection.direction); nextText.scrollTop = textSelection.top; }
    if (previewFocus) {
      const copyCurrent = previewFocus.generation === undefined || (preview?.generation === previewFocus.generation && canReturnCopyFocus());
      if (copyCurrent && currentPreviewBinding()?.selection === previewFocus.selection) root.querySelector<HTMLElement>(`[data-testid="${previewFocus.hook}"]`)?.focus({ preventScroll: true });
      previewFocus = null;
    }
    live.want(spec.wantProjects(vc));
    if (vc.read) loadDetails(spec.wantDetails(vc));
    const keep = spec.retainParts?.(vc);
    if (keep) retainParts(keep);
    spec.afterPaint?.(root, vc);
    paintedReading = reading;
    // One-shot follow-ups of this reading's own state change (e.g. reveal a task once filters clear).
    for (const then of reading?.then.splice(0) ?? []) then(root);
    planLabels();
  }

  const contextChanged = () => {
    contextGeneration++;
    versions.ctx++;
    cleanup = { ...initialCleanup(), pending: cleanupBusy }; cleanupFocus = null;
    live.restart();
    // A full snapshot or incremental event can move context. Duplicate follow-up events
    // are idempotent; directory-only enrichment does not change a session list scope.
    const moved = scopeMoved();
    reconcilePreview();
    // While not set up, the read-only setup reply (folder hints) is refreshed on navigation; the
    // form keeps every field the user touched.
    if (setup?.state === 'ready' && !setup.value.configured) loadSetup();
    schedule();
    if (ctx) { spec.onContext?.(context()); if (moved || failure) retry(); }
  };

  const applyContext = (nextSession: SessionSnapshot | null, nextDirectory: string | null) => {
    const moved = nextSession?.id !== session?.id || nextDirectory !== directory;
    if (nextSession?.title !== session?.title || nextSession?.busy !== session?.busy) versions.ctx++;
    session = nextSession;
    directory = nextDirectory;
    if (moved) contextChanged(); else schedule();
  };

  host.onReady((next) => {
    applyHostReady(next, document.documentElement);
    if (!document.getElementById('ap-style')) {
      const style = el('style', '', CSS);
      style.id = 'ap-style';
      document.head.append(style);
    }
    const first = !ctx;
    const integrationAccountChanged = !!ctx && ctx.connection?.account !== next.connection?.account;
    if (!ctx || ctx.locale !== next.locale || ctx.surface !== next.surface) versions.ctx++;
    ctx = next;
    // Ready is authoritative, not just a theme notification. Adopt both fields before
    // any refresh/onContext callback; later directory/session events repeat this state.
    const nextSession = next.session ?? null;
    const nextDirectory = next.directory ?? null;
    if (integrationAccountChanged) {
      contextGeneration++;
      gate.retire(); resetCaches(); clearReading(); ui = spec.initialUi(); identity = ''; read = null; readScope = ''; readSig = ''; health = null;
      failure = null; lastGoodAt = null;
      cleanup = { ...initialCleanup(), pending: cleanupBusy }; cleanupFocus = null;
      session = nextSession; directory = nextDirectory;
      requestedScope = scopeKey(currentScope());
      versions.ctx++; live.restart(); spec.onContext?.(context()); gate.request();
    }
    if (first) {
      session = nextSession;
      directory = nextDirectory;
      live.start();
      requestedScope = scopeKey(currentScope());
      spec.onContext?.(context());
      gate.request();
      checkMain();
    } else if (!integrationAccountChanged) applyContext(nextSession, nextDirectory);
    schedule();
  });
  host.onSession((next) => {
    applyContext(next ?? null, directory);
  });
  host.onDirectory((next) => {
    applyContext(session, next ?? null);
  });

  // Motion stops while hidden or disposed (style.ts `[data-ap-hidden]`) and resumes on the shared phase.
  const html = document.documentElement;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      delete html.dataset.apHidden;
      alignMotion(mount.firstElementChild);
      if (ctx) refreshLabels(mount, ctx.locale);
      planLabels();
      if (ctx) planMain();
      digests?.visible();
      retry();
    } else {
      html.dataset.apHidden = '';
      digests?.hidden();
      spec.retire?.('hidden');
      if (timer) { clearTimeout(timer); timer = null; }
      planLabels();
      retireMain();
    }
  });
  // Focus return re-reads only the shared review checkpoint of an open digest (coalesced).
  window.addEventListener('focus', () => { digests?.focus(); });
  window.addEventListener('pagehide', () => {
    disposed = true;
    digests?.dispose();
    spec.retire?.('dispose');
    html.dataset.apHidden = '';
    gate.stop();
    if (timer) clearTimeout(timer);
    planLabels();
    retireMain();
    live.dispose();
    memory.clear();
    clearReading();
    preview = null; previewFocus = null; previewGeneration++;
  });
}

const CSS_ESCAPE = (s: string) => (globalThis.CSS?.escape ? globalThis.CSS.escape(s) : s.replace(/["\\]/g, '\\$&'));
