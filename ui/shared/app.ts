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
import { connectHost, type HostClient, type HostReadyContext, type SessionSnapshot } from '@openchamber/sdk';
import { applyHostReady } from '@openchamber/sdk/ui';
import type { SetupAction } from './adapter.ts';
import { el, refreshAges, type Env } from './components.ts';
import { LiveWorkspace, type LiveSnapshot } from './live.ts';
import type { DocumentBody, HealthView, HistoryEntry, PlanDetail, PlanView, SetupTargets, SetupView, StoreRead } from './model.ts';
import { RecentMemory, RefreshGate } from './refresh.ts';
import { readDetail, readDocument, readHistory, readList, setupCall, type ListScope, type ReadFailure, type SetupResult } from './source.ts';
import { CSS } from './style.ts';

export const REFRESH_MS = 3000;
export const RETRY_MS = 8000;
export const RECENT_SCOPES = 8;
const AGE_TICK_MS = 30_000;

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
  liveSubscriptions: number;
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
}

export interface ViewSpec<U> {
  surface: Surface;
  /** Session streams this frame may hold; one more is used for projects (host limit 32). */
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
}

const focusKey = (root: HTMLElement) => {
  const active = document.activeElement as HTMLElement | null;
  if (!active || !root.contains(active)) return null;
  const owner = active.closest<HTMLElement>('[data-testid]');
  if (!owner) return null;
  const focusables = [...owner.querySelectorAll<HTMLElement>('button,summary,[tabindex],a,input,select,textarea')];
  return { id: owner.dataset.testid!, index: owner === active ? -1 : focusables.indexOf(active) };
};

const scopeKey = (s: ListScope | null) => (s ? `s:${s.session ?? ''}|d:${s.session ? '' : s.directory ?? ''}` : 'none');

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
  let liveSig = '';
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;
  let renderQueued = false;
  const details = new Map<string, { revision: number; value: Loadable<PlanDetail> }>();
  const documents = new Map<string, Loadable<DocumentBody>>();
  const histories = new Map<string, Loadable<{ entries: HistoryEntry[]; truncated: boolean }>>();
  let setup: Loadable<SetupView> | null = null;
  let detailQueue: Promise<void> = Promise.resolve();
  /** Scope the current read generation is for; context changes that keep it do not re-read. */
  let requestedScope = '';
  const memory = new RecentMemory<{ read: StoreRead; sig: string; health: HealthView; at: number }>(RECENT_SCOPES);
  // Authority of a remembered read: this frame's host account and the service's store + binding.
  // (A frame document belongs to one host server; a runtime switch reloads the frame.)
  const memoryKey = (key: string) => `${ctx?.connection?.account ?? ''}|${identity}#${key}`;

  const bump = () => { versions.data++; schedule(); };
  const resetCaches = () => { details.clear(); documents.clear(); histories.clear(); memory.clear(); };

  /** The list scope changed: show its remembered validated read (if any) until the new read lands. */
  function adoptScope(key: string) {
    if (key === readScope || !identity) return;
    const hit = memory.get(memoryKey(key));
    if (!hit) return; // unknown scope: loading, never another scope's data
    read = hit.read; readScope = key; readSig = hit.sig; health = hit.health; lastGoodAt = hit.at;
    versions.data++;
  }

  const live = new LiveWorkspace(host, spec.maxSessionSubscriptions, () => {
    const sig = JSON.stringify([live.snapshot.projectsState, live.snapshot.projects, [...live.snapshot.sessions], live.snapshot.capped]);
    if (sig !== liveSig) { liveSig = sig; versions.live++; schedule(); }
  });

  const currentScope = () => spec.scope({ session, directory }, ui);
  /** Latest context wins: retire the read only when the list scope really changed. */
  function scopeMoved() {
    const key = scopeKey(currentScope());
    if (key === requestedScope) return false;
    requestedScope = key;
    gate.retire();
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
    const result = await readList(host, scope ?? {}, scope ? undefined : 1);
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
      if (health && health.ready !== nextHealth.ready) { setup = null; loadSetup(); }
      const nextRead = result.read ? { ...result.read, plans: scope ? result.read.plans : [] } : null;
      if (nextRead) {
        const nextIdentity = `${nextRead.storeId}|${nextRead.binding.sourceId ?? ''}|${nextRead.binding.verified}`;
        if (identity && nextIdentity !== identity) { ui = spec.initialUi(); versions.ui++; resetCaches(); }
        identity = nextIdentity;
      }
      const sig = JSON.stringify([key, nextHealth, nextRead]);
      if (sig !== readSig || failure) { readSig = sig; read = nextRead; readScope = key; health = nextHealth; versions.data++; }
      // Only a complete, current-generation list read for a real scope is remembered.
      if (scope && nextRead && identity) memory.set(memoryKey(key), { read: nextRead, sig, health: nextHealth, at: Date.now() });
      // Setup status (reload-required, capture off) is shown on every surface. A pending reload is
      // re-read each refresh so the notice clears once the service observes the loaded companion.
      if (!setup || (setup.state === 'ready' && setup.value.activation === 'reload-required')) loadSetup();
      failure = null;
      lastGoodAt = Date.now();
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

  function loadDetails(plans: PlanView[]) {
    for (const p of plans) {
      const cached = details.get(p.key);
      if (cached && cached.revision === p.revision && cached.value.state !== 'error') continue;
      if (cached && cached.value.state === 'loading') continue;
      details.set(p.key, { revision: p.revision, value: { state: 'loading' } });
      const id = identity;
      detailQueue = detailQueue.then(async () => {
        const result = await readDetail(host, p);
        if (disposed || id !== identity) return;
        details.set(p.key, result.ok ? { revision: result.detail.revision, value: { state: 'ready', value: result.detail } } : { revision: p.revision, value: { state: 'error', failure: result.failure } });
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

  function schedule() {
    if (renderQueued) return;
    renderQueued = true;
    queueMicrotask(() => { renderQueued = false; render(); });
  }

  function context(): ViewContext<U> {
    const env: Env = {
      locale: ctx!.locale, now: Date.now(), live: live.snapshot,
      boundSource: read && read.binding.verified ? read.binding.sourceId : null,
      unverifiedSources: new Set(read ? read.sources.filter((s) => !s.verified).map((s) => s.id) : []),
      // Components offer this only for sessions the host currently lists and the verified bound source.
      openSession: (id) => { void host.openSession(id).catch(() => host.toast({ kind: 'error', message: 'That session could not be opened here.' }).catch(() => {})); },
    };
    return {
      host, ctx: ctx!, session, directory, health, read: readScope === scopeKey(currentScope()) ? read : null, failure, lastGoodAt, live: live.snapshot, env, ui,
      setUi: (patch) => applyUi(patch),
      updateUi: (fn) => applyUi(fn(ui)),
      retry, liveSubscriptions: live.subscriptionCount,
      detail: (p) => { const c = details.get(p.key); return c ? c.value : null; },
      document: (p) => documents.get(docKey(p)) ?? null,
      requestDocument: (p) => {
        const k = docKey(p);
        const existing = documents.get(k);
        if (existing && existing.state !== 'error') return;
        documents.set(k, { state: 'loading' });
        const id = identity;
        void readDocument(host, p).then((r) => {
          if (disposed || id !== identity) return;
          documents.set(k, r.ok ? { state: 'ready', value: r.body } : { state: 'error', failure: r.failure });
          bump();
        });
        bump();
      },
      history: (p) => histories.get(`${p.key}@${p.revision}`) ?? null,
      requestHistory: (p) => {
        const k = `${p.key}@${p.revision}`;
        const existing = histories.get(k);
        if (existing && existing.state !== 'error') return;
        histories.set(k, { state: 'loading' });
        const id = identity;
        void readHistory(host, p).then((r) => {
          if (disposed || id !== identity) return;
          histories.set(k, r.ok ? { state: 'ready', value: { entries: r.entries, truncated: r.truncated } } : { state: 'error', failure: r.failure });
          bump();
        });
        bump();
      },
      setup, requestSetup: loadSetup,
      runSetup: async (action, targets, confirmed) => {
        const r = await setupCall(host, action, targets, confirmed);
        if (r.ok && action !== 'inspect') { setup = { state: 'ready', value: r.setup }; resetCaches(); retry(); }
        bump();
        return r;
      },
      storage: host.storage,
      identity,
    };
  }

  function render() {
    if (!ctx || disposed) return;
    const key = `${versions.data}|${versions.live}|${versions.ui}|${versions.ctx}`;
    if (key === paintedKey) return;
    // A background change must not close a picker the user has open; it paints once the
    // popup closes. A change the user made (UI state) paints immediately.
    if (versions.ui === paintedUi && mount!.querySelector('[aria-expanded="true"]')) {
      setTimeout(schedule, 300);
      return;
    }
    paintedKey = key;
    paintedUi = versions.ui;
    const vc = context();

    const focus = focusKey(mount!);
    const open = new Map([...mount!.querySelectorAll<HTMLDetailsElement>('details[data-testid]')].map((d) => [d.dataset.testid!, d.open]));
    const scrolls = new Map([...mount!.querySelectorAll<HTMLElement>('[data-scroll-key]')].map((n) => [n.dataset.scrollKey!, n.scrollTop]));
    const pageScroll = document.scrollingElement?.scrollTop ?? 0;
    const values = new Map([...mount!.querySelectorAll<HTMLInputElement>('input[data-keep]')].map((n) => [n.dataset.keep!, n.value]));

    const root = el('main', 'ap');
    root.dataset.surface = spec.surface;
    root.dataset.testid = 'progress-root';
    root.setAttribute('aria-busy', String(!vc.read && !failure && !(health && !health.ready)));
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
    for (const n of root.querySelectorAll<HTMLElement>('[data-scroll-key]')) {
      const top = scrolls.get(n.dataset.scrollKey!);
      if (top) n.scrollTop = top;
    }
    if (document.scrollingElement) document.scrollingElement.scrollTop = pageScroll;
    if (focus) {
      const owner = root.querySelector<HTMLElement>(`[data-testid="${CSS_ESCAPE(focus.id)}"]`);
      const target = focus.index < 0 ? owner : owner?.querySelectorAll<HTMLElement>('button,summary,[tabindex],a,input,select,textarea')[focus.index];
      target?.focus({ preventScroll: true });
    }
    live.want(spec.wantProjects(vc));
    if (vc.read) loadDetails(spec.wantDetails(vc));
    spec.afterPaint?.(root, vc);
  }

  const contextChanged = () => {
    versions.ctx++;
    live.restart();
    // The host announces one switch in steps (session, then directory). Only a step that moves the
    // list scope retires the read; the others keep the read already in flight.
    const moved = scopeMoved();
    // While not set up, the read-only setup reply (folder hints) is refreshed on navigation; the
    // form keeps every field the user touched.
    if (setup?.state === 'ready' && !setup.value.configured) loadSetup();
    schedule();
    if (ctx) { spec.onContext?.(context()); if (moved || failure) retry(); }
  };

  host.onReady((next) => {
    applyHostReady(next, document.documentElement);
    if (!document.getElementById('ap-style')) {
      const style = el('style', '', CSS);
      style.id = 'ap-style';
      document.head.append(style);
    }
    const first = !ctx;
    if (!ctx || ctx.locale !== next.locale || ctx.surface !== next.surface) versions.ctx++;
    ctx = next;
    if (first) {
      session = next.session;
      directory = next.directory;
      live.start();
      requestedScope = scopeKey(currentScope());
      spec.onContext?.(context());
      gate.request();
    }
    schedule();
  });
  host.onSession((next) => {
    const changed = next?.id !== session?.id;
    if (changed || next?.title !== session?.title || next?.busy !== session?.busy) versions.ctx++;
    session = next;
    if (changed) contextChanged(); else schedule();
  });
  host.onDirectory((next) => {
    const changed = next !== directory;
    directory = next;
    if (changed) contextChanged();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') retry();
    else if (timer) { clearTimeout(timer); timer = null; }
  });
  const ages = setInterval(() => { if (ctx) refreshAges(mount, ctx.locale); }, AGE_TICK_MS);
  window.addEventListener('pagehide', () => {
    disposed = true;
    gate.stop();
    if (timer) clearTimeout(timer);
    clearInterval(ages);
    live.dispose();
    memory.clear();
  });
}

const CSS_ESCAPE = (s: string) => (globalThis.CSS?.escape ? globalThis.CSS.escape(s) : s.replace(/["\\]/g, '\\$&'));
