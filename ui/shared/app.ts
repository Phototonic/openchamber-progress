// Shared frame lifecycle for panel, status and page.
// - latest context wins: a context notification re-reads only when the list scope changes; an
//   obsolete read never blocks the new one (bounded overlap) and its reply is dropped
// - scoped reads carry their scope key and are never shown for another context
// - the last validated read of up to 8 recent scopes is kept per frame, keyed by host account +
//   store + source binding + scope; returning to one paints it at once and revalidates quietly
// - provisional 3 s polling (8 s after failure), paused while hidden, stopped on dispose
// - selected-plan detail, document and history load on demand and are cached by revision/capture
// - cache identity = frame (host generation) + storeId + source binding; a change resets UI state
// - repaint only on change; focus, scroll and open disclosures survive a repaint
// - one in-place 30 s label ticker (ages, elapsed) while visible and showing such a label
// - official-main version check: at host readiness, then when due (coarse), visible frames only
import { connectHost, type HostClient, type HostReadyContext, type SessionSnapshot } from '@openchamber/sdk';
import { applyHostReady } from '@openchamber/sdk/ui';
import type { CleanupAction, SetupAction } from './adapter.ts';
import { cleanupEligible, cleanupError, cleanupMatches, cleanupTarget, initialCleanup, type CleanupState, type CleanupTarget } from './cleanup.ts';
import { el, refreshLabels, type Env } from './components.ts';
import { LiveWorkspace, type LiveSnapshot } from './live.ts';
import { OFFICIAL_MAIN_URL } from './config.ts';
import type { DocumentBody, HealthView, HistoryEntry, OfficialMainView, PlanDetail, PlanView, SetupTargets, SetupView, StoreRead } from './model.ts';
import { RecentMemory, RefreshGate } from './refresh.ts';
import { OFFICIAL_MAIN_DISMISSED_KEY, OfficialMainState } from './official.ts';
import { cleanupCall, readDetail, readDocument, readHistory, readList, setupCall, type ListScope, type ReadFailure, type SetupResult } from './source.ts';
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
}

const FOCUSABLE = 'button,summary,[tabindex],a,input,select,textarea';
/** Plan identity of a plan article: plan IDs and item IDs repeat across sources and plans. */
const planScope = (n: Element | null | undefined) => {
  const article = n?.closest<HTMLElement>('article[data-testid^="plan-"]');
  return article ? `${article.dataset.testid}|${article.dataset.source ?? ''}` : null;
};
const focusKey = (root: HTMLElement) => {
  const active = document.activeElement as HTMLElement | null;
  if (!active || !root.contains(active)) return null;
  const owner = active.closest<HTMLElement>('[data-testid]');
  if (!owner) return null;
  const focusables = [...owner.querySelectorAll<HTMLElement>(FOCUSABLE)];
  return { id: owner.dataset.testid!, index: owner === active ? -1 : focusables.indexOf(active), plan: planScope(owner) };
};

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
  /** `listRead`: for a failed read, the list read it failed under; it is retried after a newer one. */
  const details = new Map<string, { revision: number; value: Loadable<PlanDetail>; listRead?: number }>();
  let listReads = 0;
  const documents = new Map<string, Loadable<DocumentBody>>();
  const histories = new Map<string, Loadable<{ entries: HistoryEntry[]; truncated: boolean }>>();
  let setup: Loadable<SetupView> | null = null;
  let detailQueue: Promise<void> = Promise.resolve();
  let cacheGeneration = 0;
  let cleanup = initialCleanup();
  let cleanupBusy = false;
  let cleanupFocus: string | null = null;
  /** Scope the current read generation is for; context changes that keep it do not re-read. */
  let requestedScope = '';
  const memory = new RecentMemory<{ read: StoreRead; sig: string; health: HealthView; at: number }>(RECENT_SCOPES);
  // Authority of a remembered read: this frame's host account and the service's store + binding.
  // (A frame document belongs to one host server; a runtime switch reloads the frame.)
  const memoryKey = (key: string) => `${ctx?.connection?.account ?? ''}|${identity}#${key}`;

  const bump = () => { versions.data++; schedule(); };
  const retireParts = () => {
    cacheGeneration++; detailQueue = Promise.resolve();
    for (const [key, value] of details) if (value.value.state === 'loading') details.delete(key);
    for (const cache of [documents, histories]) for (const [key, value] of cache) if (value.state === 'loading') cache.delete(key);
  };
  const resetCaches = () => { retireParts(); details.clear(); documents.clear(); histories.clear(); memory.clear(); };
  const forgetPlans = (keys: Set<string>) => { if (keys.size && spec.forgetPlans) { ui = { ...ui, ...spec.forgetPlans(keys, ui, context()) }; versions.ui++; } };

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
  }

  const gate = new RefreshGate(async (generation) => {
    const scope = currentScope();
    const key = scopeKey(scope);
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
        if (identity && nextIdentity !== identity) { authorityChanged = true; ui = spec.initialUi(); versions.ui++; resetCaches(); cleanup = { ...initialCleanup(), pending: cleanupBusy }; live.restart(); }
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
    const actionAccount = ctx?.connection?.account;
    cleanupBusy = true; cleanup = { ...cleanup, pending: true, message: null }; versions.ui++; schedule();
    const result = await cleanupCall(host, action, target.request);
    cleanupBusy = false;
    if (disposed) return;
    if (identity !== actionIdentity || ctx?.connection?.account !== actionAccount) {
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

  function loadDetails(plans: PlanView[]) {
    for (const p of plans) {
      const cached = details.get(p.key);
      if (cached && cached.revision === p.revision && cached.value.state !== 'error') continue;
      if (cached && cached.value.state === 'loading') continue;
      if (cached && cached.value.state === 'error' && cached.revision === p.revision && cached.listRead === listReads) continue;
      details.set(p.key, { revision: p.revision, value: { state: 'loading' } });
      const id = identity;
      const generation = cacheGeneration;
      detailQueue = detailQueue.then(async () => {
        if (disposed || id !== identity || generation !== cacheGeneration) return;
        const result = await readDetail(guardedHost(() => generation === cacheGeneration), p);
        if (disposed || id !== identity || generation !== cacheGeneration) return;
        details.set(p.key, result.ok ? { revision: result.detail.revision, value: { state: 'ready', value: result.detail } } : { revision: p.revision, value: { state: 'error', failure: result.failure }, listRead: listReads });
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
        documents.set(k, { state: 'loading' });
        const id = identity;
        const generation = cacheGeneration;
        void readDocument(guardedHost(() => generation === cacheGeneration), p).then((r) => {
          if (disposed || id !== identity || generation !== cacheGeneration) return;
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
        histories.set(k, { state: 'loading' });
        const id = identity;
        const generation = cacheGeneration;
        void readHistory(guardedHost(() => generation === cacheGeneration), p).then((r) => {
          if (disposed || id !== identity || generation !== cacheGeneration) return;
          histories.set(k, r.ok ? { state: 'ready', value: { entries: r.entries, truncated: r.truncated } } : { state: 'error', failure: r.failure });
          bump();
        });
        bump();
      },
      setup, requestSetup: loadSetup,
      runSetup: async (action, targets, confirmed) => {
        const r = await setupCall(host, action, targets, confirmed);
        if (r.ok && action !== 'inspect') { setup = { state: 'ready', value: r.setup }; resetCaches(); retry(); }
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
    const vc = context();

    const focus = focusKey(mount!);
    const open = new Map([...mount!.querySelectorAll<HTMLDetailsElement>('details[data-testid]')].map((d) => [d.dataset.testid!, d.open]));
    const scrolls = new Map([...mount!.querySelectorAll<HTMLElement>('[data-scroll-key]')].map((n) => [n.dataset.scrollKey!, n.scrollTop]));
    const pageScroll = document.scrollingElement?.scrollTop ?? 0;
    const values = new Map([...mount!.querySelectorAll<HTMLInputElement>('input[data-keep]')].map((n) => [n.dataset.keep!, n.value]));

    const root = el('main', 'ap');
    root.dataset.surface = spec.surface;
    root.dataset.testid = 'progress-root';
    root.setAttribute('aria-busy', String(currentScope() !== null && !vc.read && !failure && !(health && !health.ready)));
    spec.paint(root, vc);
    for (const d of root.querySelectorAll<HTMLDetailsElement>('details[data-testid]')) {
      const was = open.get(d.dataset.testid!);
      if (was !== undefined && was !== d.open) { d.open = was; d.dispatchEvent(new Event('toggle')); }
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
    if (focus) {
      // Focus inside a plan returns only to that same plan (source + ID), never a same-ID item elsewhere.
      const candidates = [...root.querySelectorAll<HTMLElement>(`[data-testid="${CSS_ESCAPE(focus.id)}"]`)];
      const owner = candidates.find((n) => planScope(n) === focus.plan);
      const target = focus.index < 0 ? owner : owner?.querySelectorAll<HTMLElement>(FOCUSABLE)[focus.index];
      target?.focus({ preventScroll: true });
    }
    if (cleanupFocus) {
      const owner = root.querySelector<HTMLElement>(`[data-testid="${cleanupFocus}"]`);
      const target = owner?.querySelector<HTMLElement>('button') ?? owner;
      if (target) { if (target.tagName !== 'BUTTON') target.tabIndex = -1; target.focus({ preventScroll: true }); cleanupFocus = null; }
    }
    live.want(spec.wantProjects(vc));
    if (vc.read) loadDetails(spec.wantDetails(vc));
    spec.afterPaint?.(root, vc);
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
    const accountChanged = !!ctx && ctx.connection?.account !== next.connection?.account;
    if (!ctx || ctx.locale !== next.locale || ctx.surface !== next.surface) versions.ctx++;
    ctx = next;
    // Ready is authoritative, not just a theme notification. Adopt both fields before
    // any refresh/onContext callback; later directory/session events repeat this state.
    const nextSession = next.session ?? null;
    const nextDirectory = next.directory ?? null;
    if (accountChanged) {
      contextGeneration++;
      gate.retire(); resetCaches(); ui = spec.initialUi(); identity = ''; read = null; readScope = ''; readSig = ''; health = null;
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
    } else if (!accountChanged) applyContext(nextSession, nextDirectory);
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
      retry();
    } else {
      html.dataset.apHidden = '';
      if (timer) { clearTimeout(timer); timer = null; }
      planLabels();
      retireMain();
    }
  });
  window.addEventListener('pagehide', () => {
    disposed = true;
    html.dataset.apHidden = '';
    gate.stop();
    if (timer) clearTimeout(timer);
    planLabels();
    retireMain();
    live.dispose();
    memory.clear();
  });
}

const CSS_ESCAPE = (s: string) => (globalThis.CSS?.escape ? globalThis.CSS.escape(s) : s.replace(/["\\]/g, '\\$&'));
