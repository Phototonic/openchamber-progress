// Dependency map renderer (Designer-owned). Shared by the board and the right rail.
// Every recorded string lands through textContent. Geometry comes from the frame owner's full-plan
// layout and is never recomputed or filtered here: filters only hide cards/arrows in place.
// With an interaction binding (S3) the canvas is a pan/zoom viewport with one roving card Tab stop,
// scoped keys, a viewport toolbar, background-drag/wheel panning, relation highlights and one
// persistent per-frame live region. Without one it stays the S2 read-only, natively scrolled view.
import type { MapSnapshot, MapPicture } from './dependency-map.ts';
import type { MapLayout } from './dependency-map-layout.ts';
import type { DerivedTask } from './dependency-derivation.ts';
import { MAP_ZOOM, type MapInteractionCommand, type MapInteractionEvent, type MapInteractionState } from './dependency-map-interaction.ts';
import { button, el, lifecycleBadge, testid } from './components.ts';
import { MAP_CSS } from './dependency-map-style.ts';
import { plural } from './format.ts';
import { EMPTY_LIVE, sessionLabel } from './live.ts';
import { statusMatch, summarize, summaryText, type BlockerView, type ItemView, type StatusFilter } from './model.ts';
import type { MapTaskAttribution } from './dependency-map-attribution.ts';

/** The frame's interaction controller, as the view sees it. The controller lives outside the root. */
export interface MapInteractionBinding {
  /** Live controller snapshot; read at paint and when applying commands. */
  state: () => MapInteractionState;
  /** Returns whether the event was handled (keys: only then is the default prevented). */
  dispatch: (event: MapInteractionEvent) => boolean;
  /** Focus entered (true) or left (false) the map or its view switch within this frame. */
  focusOwner: (owns: boolean) => void;
}

export interface DependencyMapViewInput extends MapSnapshot {
  /** Frame-local, revision-bound assignment/link/report and live-session proof; never layout input.
   * Absent (map or task entry): provenance/activity unavailable, never “unassigned”. Only a proven
   * live entry on a current picture permits the session-only “Assigned session active now”. */
  attribution?: ReadonlyMap<string, MapTaskAttribution>;
  /** Source-safe session label (`recordedLabel(plan, env)`): host titles only for the verified bound
   * source. Absent: plain recorded labels (“Session …”) for every session. */
  label?: (sessionId: string) => string;
  frame: 'board' | 'rail';
  /** Geometry is computed by the frame owner from the FULL picture, never by the view. */
  layout: MapLayout | null;
  facts: MapPicture['facts'] | null;
  status: StatusFilter;
  /** null = all groups; '' = no recorded group; otherwise a recorded group subtree. */
  group: string | null;
  selected: string | null;
  onSelect: (id: string) => void;
  onStatus: (value: StatusFilter) => void;
  onGroup: (id: string | null) => void;
  onRetry: () => void;
  onList: (selected: string | null) => void;
  /**
   * Optional: usable canvas width (CSS px inside the map viewport, excluding world padding), reported
   * when it first becomes known and whenever it changes. Edgeless row packing should use it instead of
   * the frame width; connected layouts ignore it. Never called for status-only repaints.
   */
  onCanvasWidth?: (width: number) => void;
  /** S3 interaction. Absent: the read-only S2 presentation (native scroll, every card a Tab stop). */
  interaction?: MapInteractionBinding;
}
export interface DependencyMapView {
  /** One paint into a (possibly new) host. State/geometry remain frame-owned, not DOM-owned. */
  render: (host: HTMLElement, input: DependencyMapViewInput) => void;
  /** Rebind after root replacement (paints with the last input). */
  mount: (host: HTMLElement) => void;
  update: (input: DependencyMapViewInput) => void;
  /** Apply an action-local controller command: viewport, focus, capture or announcement. */
  command: (command: MapInteractionCommand) => void;
  dispose: () => void;
}
/** QA vocabulary: map-region data-{state,current,revision,tasks,edges,highlight}; map-card-ID
 * data-{task,x,y,status,readiness,unlocks,related}; SVG paths data-{from,to,path}, marker-end;
 * map-{state,viewport,world,inspector,group,status,list,retry,help}; toolbar map-{zoom-in,
 * zoom-out,zoom-level,fit-all,focus-current,pan-left,pan-right,pan-up,pan-down}; one per-frame
 * map-announcer outside the root; plan-view, plan-view-{list,map}. Attribution (S4): card
 * data-{attribution,live}, map-card-who-ID, map-card-live-ID; inspector map-attribution
 * data-{assignment,live} with map-attribution-{assignment,links,reports,live}; map-attribution-help.
 * No data-reading article.
 * These describe semantic facts, not styling or incidental DOM nesting.
 */

/** Card mark: shape + words, colour only reinforces it (style.ts `.ap-map-mark`). */
type Mark = 'working' | 'ready' | 'waiting' | 'waiting-skipped' | 'blocked' | 'done' | 'skipped' | 'pending';
const MARK_TEXT: Record<Mark, string> = {
  working: 'Reported working', ready: 'Ready', waiting: 'Waiting', 'waiting-skipped': 'Waiting on skipped task',
  blocked: 'Explicitly blocked', done: 'Done', skipped: 'Skipped', pending: 'Reported pending',
};
/** World padding around the full-plan layout; slot coordinates (data-x/y) stay unpadded. */
const PAD = 28;
const SVG = 'http://www.w3.org/2000/svg';
let instances = 0;

/**
 * Map CSS lives only with the map (production guests ship none until the map is exposed). One
 * `<style data-map-style>` per document in `<head>`, after the shared sheet and outside every
 * repainted root, so remounts and root replacement neither duplicate nor drop it.
 */
function ensureMapStyle(doc: Document) {
  if (doc.head.querySelector('style[data-map-style]')) return;
  const style = doc.createElement('style');
  style.dataset.mapStyle = '';
  style.textContent = MAP_CSS;
  doc.head.append(style);
}

/**
 * The frame's one polite live region, appended to `<body>` outside every repainted root. Created
 * only by a map-capable frame (Work Status never mounts the view). Repaints never write to it.
 */
function mapAnnouncer(doc: Document) {
  let node = doc.querySelector<HTMLElement>('[data-testid="map-announcer"]');
  if (!node) {
    node = doc.createElement('div');
    node.className = 'ap-sr';
    node.dataset.testid = 'map-announcer';
    node.setAttribute('role', 'status');
    node.setAttribute('aria-live', 'polite');
    node.setAttribute('aria-atomic', 'true');
    doc.body.append(node);
  }
  return node;
}

/**
 * Plan view: List / Map, a pressed-button pair (same look as the list's Show all / Unfinished).
 * Lightweight in-frame switch; no tab or router semantics. Buttons are marked as focus owners so a
 * pending List → Map handoff survives focus staying on the activated switch.
 */
export function planViewSwitch(presentation: 'list' | 'map', onChange: (next: 'list' | 'map') => void) {
  ensureMapStyle(document);
  const group = testid(el('div', 'ap-map-switch'), 'plan-view');
  group.setAttribute('role', 'group');
  const label = el('span', 'ap-map-switch-label', 'Plan view');
  label.id = `ap-plan-view-${++instances}`;
  group.setAttribute('aria-labelledby', label.id);
  const set = el('div', 'ap-map-pair');
  for (const [mode, text] of [['list', 'List'], ['map', 'Map']] as const) {
    const holder = button(set, `plan-view-${mode}`, text, () => { if (mode !== presentation) onChange(mode); }, presentation === mode ? 'outline' : 'ghost');
    const b = holder.querySelector('button');
    b?.setAttribute('aria-pressed', String(presentation === mode));
    b?.setAttribute('data-map-focus-owner', '');
  }
  group.append(label, set);
  return group;
}

const ICONS = {
  'zoom-out': 'M3.5 8h9',
  'zoom-in': 'M3.5 8h9M8 3.5v9',
  fit: 'M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10',
  current: 'M8 1.5v2.5M8 12v2.5M1.5 8H4M12 8h2.5M11 8a3 3 0 1 1-6 0a3 3 0 1 1 6 0',
  left: 'M9.5 3.5 5 8l4.5 4.5',
  right: 'M6.5 3.5 11 8l-4.5 4.5',
  up: 'M3.5 9.5 8 5l4.5 4.5',
  down: 'M3.5 6.5 8 11l4.5-4.5',
} as const;
function icon(name: keyof typeof ICONS) {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('class', 'ap-map-icon'); svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
  const path = document.createElementNS(SVG, 'path');
  path.setAttribute('d', ICONS[name]);
  svg.append(path);
  return svg;
}
const zoomText = (zoom: number) => zoom * 100 < 1 ? 'under 1%' : `${Math.round(zoom * 100)}%`;

function markOf(item: ItemView, fact: DerivedTask | undefined, guidance: boolean): Mark {
  if (item.status !== 'pending') return item.status;
  // Ready/Waiting are recorded-prerequisite guidance: only for an active plan's current picture.
  if (!guidance) return 'pending';
  return fact?.group === 'ready' ? 'ready' : fact?.group === 'skipped' ? 'waiting-skipped' : 'waiting';
}

function mark(kind: Mark) {
  const m = el('span', 'ap-map-mark');
  m.dataset.mark = kind;
  m.setAttribute('aria-hidden', 'true');
  return m;
}

const STATE_COPY = {
  loading: 'Loading the map…',
  unavailable: 'Map unavailable',
  notFound: 'This plan is no longer recorded',
} as const;

export function createDependencyMapView(): DependencyMapView {
  let host: HTMLElement | null = null, input: DependencyMapViewInput | null = null;
  const uid = `ap-map-${++instances}`;
  // Native scroll position of the read-only canvas, kept across root replacement for the same plan only.
  let scroll = { key: '', left: 0, top: 0 };
  let focusCard: string | null = null;
  let observer: ResizeObserver | null = null, canvasWidth = 0;
  // Interactive frame-local presentation: current painted nodes, coalesced viewport frame, a pending
  // generation-bound focus action and the last painted canvas position (screen continuity).
  let viewportNode: HTMLElement | null = null, worldNode: HTMLElement | null = null, zoomNode: HTMLElement | null = null;
  let frame = 0, releasing = false;
  // True from a paint until the owner has finished restoring its pre-paint focus (same turn):
  // that focusin is passive and must not move the viewport.
  let restoring = false;
  // Latest announcement token and its deferred repeat frame, if any.
  let spoken = 0, speakFrame = 0;
  let pendingFocus: { id: string | null; generation: number } | null = null;
  let painted = { key: '', viewport: null as HTMLElement | null };
  let listening: Document | null = null, announcer: HTMLElement | null = null;
  const binding = () => input?.interaction ?? null;

  function announce(text: string) {
    const node = announcer, b = binding(); if (!node || !text || !b) return;
    // A newer message always wins: it cancels any deferred repeat still waiting for its frame.
    const token = ++spoken;
    if (speakFrame) { cancelAnimationFrame(speakFrame); speakFrame = 0; }
    if (node.textContent !== text) { node.textContent = text; return; }
    // Same words again still speak: clear, then set on the next frame. The repeat belongs to this
    // action only: leaving Map, a reading change, retirement or disposal drops it.
    const { identity, generation } = b.state();
    node.textContent = '';
    speakFrame = requestAnimationFrame(() => {
      speakFrame = 0;
      const now = binding()?.state();
      if (token === spoken && announcer === node && now?.active && now.identity === identity && now.generation === generation) node.textContent = text;
    });
  }
  function applyViewport() {
    const b = binding(); if (!b || !worldNode) return;
    const t = b.state().transform;
    // Slot coordinates are unpadded; the world carries PAD of padding on every side.
    worldNode.style.transform = `translate(${t.x - PAD * t.zoom}px,${t.y - PAD * t.zoom}px) scale(${t.zoom})`;
    worldNode.style.setProperty('--ap-map-zoom', String(t.zoom));
    if (zoomNode) zoomNode.textContent = zoomText(t.zoom);
  }
  function scheduleViewport() {
    if (frame) return;
    frame = requestAnimationFrame(() => { frame = 0; applyViewport(); });
  }
  /** Bring a focused card into the guest page vertically (the canvas itself is already panned). */
  function revealInPage(node: HTMLElement) {
    const r = node.getBoundingClientRect(), page = node.ownerDocument.scrollingElement;
    if (!page) return;
    if (r.top < 0) page.scrollTop += r.top - 8;
    else if (r.bottom > innerHeight) page.scrollTop += Math.min(r.top - 8, r.bottom - innerHeight + 8);
  }
  /** `settle`: this is the post-connect pass, after the owner's own focus restoration. */
  function tryFocus(settle: boolean) {
    const b = binding(), want = pendingFocus;
    if (!b || !want || !viewportNode?.isConnected) return false;
    // A newer view/reading generation retires the action; another frame's focus is never taken.
    if (want.generation !== b.state().generation || !document.hasFocus()) { pendingFocus = null; return true; }
    const target = want.id === null ? viewportNode.querySelector<HTMLElement>('[data-map-empty-target]') ?? viewportNode.closest('[data-testid="map-region"]')?.querySelector<HTMLElement>('h2') ?? null
      : viewportNode.querySelector<HTMLElement>(`[data-task="${CSS.escape(want.id)}"]`);
    if (!target) return false;
    if (settle) pendingFocus = null;
    if (target.matches('.ap-map-card')) {
      for (const n of viewportNode.querySelectorAll<HTMLElement>('.ap-map-card[tabindex="0"]')) if (n !== target) n.tabIndex = -1;
      target.tabIndex = 0;
    } else if (target.tagName === 'H2') target.tabIndex = -1;
    applyViewport();
    target.focus({ preventScroll: true });
    revealInPage(target);
    return true;
  }
  function capture(pointerId: number, on: boolean) {
    const v = viewportNode; if (!v) return;
    if (on) { try { v.setPointerCapture(pointerId); v.dataset.dragging = ''; } catch { /* pointer already gone */ } return; }
    delete v.dataset.dragging;
    if (v.hasPointerCapture(pointerId)) { releasing = true; try { v.releasePointerCapture(pointerId); } finally { releasing = false; } }
  }
  // Frame-owned gesture listeners survive root replacement; capture is rebound to each new viewport.
  const onMove = (e: PointerEvent) => { const b = binding(); if (b && b.state().dragging === e.pointerId) b.dispatch({ type: 'pointer-move', pointerId: e.pointerId, point: { x: e.clientX, y: e.clientY } }); };
  const onEnd = (e: PointerEvent) => { const b = binding(); if (b && b.state().dragging === e.pointerId) b.dispatch({ type: 'pointer-end', pointerId: e.pointerId }); };
  const onFocusIn = (e: FocusEvent) => { const t = e.target as Element | null; if (t?.closest) { binding()?.focusOwner(!!t.closest('[data-testid="map-region"],[data-map-focus-owner]')); binding()?.dispatch({ type: 'canvas-focus', id: t.closest<HTMLElement>('[data-testid="map-viewport"] button[data-task]')?.dataset.task ?? null }); } };
  const onBlur = () => binding()?.focusOwner(false);
  function listen(doc: Document) {
    if (listening === doc) return;
    unlisten(); listening = doc;
    doc.addEventListener('pointermove', onMove); doc.addEventListener('pointerup', onEnd); doc.addEventListener('pointercancel', onEnd);
    doc.addEventListener('focusin', onFocusIn); doc.defaultView?.addEventListener('blur', onBlur);
  }
  function unlisten() {
    const doc = listening; if (!doc) return; listening = null;
    doc.removeEventListener('pointermove', onMove); doc.removeEventListener('pointerup', onEnd); doc.removeEventListener('pointercancel', onEnd);
    doc.removeEventListener('focusin', onFocusIn); doc.defaultView?.removeEventListener('blur', onBlur);
  }

  function paint() {
    observer?.disconnect(); observer = null;
    if (!host || !input) return;
    // The owner restores focus synchronously after attaching this paint's root; this microtask runs
    // after that, so the restoration's focusin is recognised as passive.
    restoring = true; queueMicrotask(() => { restoring = false; });
    const v = input, b = v.interaction ?? null;
    if (b) { listen(host.ownerDocument); announcer = mapAnnouncer(host.ownerDocument); }
    const st = b?.state() ?? null;
    // Unavailable/not found never draw a diagram, even when the coordinator still holds an older
    // picture (e.g. replacement detail without usable identity): no stale map presented as Updating.
    const retainedUnavailable = !!v.picture && (v.state === 'unavailable' || v.state === 'not-found');
    const p = retainedUnavailable ? null : v.picture, layout = p ? v.layout : null;
    const region = testid(el('article', 'ap-map'), 'map-region');
    region.dataset.frame = v.frame;
    region.setAttribute('aria-labelledby', `${uid}-title`);
    region.dataset.state = v.state; region.dataset.current = String(v.current);
    region.dataset.revision = String(p?.graph.revision ?? '');
    region.dataset.tasks = String(layout?.order.length ?? 0); region.dataset.edges = String(layout?.edges.length ?? 0);
    if (b) region.dataset.interactive = '';

    const listButton = (parent: Element) => button(parent, 'map-list', 'View as list', () => v.onList(v.selected), 'outline');
    const retryButton = (parent: Element) => button(parent, 'map-retry', 'Try again', v.onRetry, 'outline');

    // ── No diagram: loading, unavailable, not found, failed. View as list always stays reachable.
    if (!p) {
      const head = el('header', 'ap-map-head');
      const top = el('div', 'ap-map-top');
      const titles = el('div', 'ap-map-titles');
      titles.append(el('p', 'ap-h', 'Dependency map'));
      const heading = el('h2', 'ap-plan-title', v.state === 'unavailable' ? STATE_COPY.unavailable : v.state === 'not-found' ? STATE_COPY.notFound : v.state === 'error' ? 'Couldn’t read the map' : v.state === 'updating' ? 'Updating the map…' : STATE_COPY.loading);
      heading.id = `${uid}-title`;
      titles.append(heading);
      const actions = el('div', 'ap-map-actions');
      listButton(actions);
      top.append(titles, actions);
      head.append(top);
      region.append(head);
      const state = testid(el('div', 'ap-map-notice'), 'map-state');
      state.dataset.state = v.state;
      if (v.state === 'unavailable') {
        state.dataset.tone = 'neutral';
        state.append(el('p', '', retainedUnavailable
          ? 'The current plan can’t be matched to a consistent dependency picture, so the earlier map is no longer shown. The task list is unaffected.'
          : 'The progress service can’t provide the recorded prerequisites this map needs, so nothing is drawn. The task list is unaffected.'));
      } else if (v.state === 'not-found') {
        state.dataset.tone = 'neutral';
        state.append(el('p', '', 'The progress store no longer has this plan. Choose another plan or return to the list.'));
      } else if (v.state === 'error') {
        state.dataset.tone = 'warning';
        const row = el('div', 'ap-map-notice-row');
        row.append(el('p', '', 'The dependency map couldn’t be read. Nothing is shown rather than a partial picture.'));
        retryButton(row);
        state.append(row);
      } else {
        state.dataset.tone = 'quiet';
        const row = el('div', 'ap-map-notice-row');
        if (v.state === 'updating') {
          const text = el('p');
          text.append(el('strong', '', 'Updating…'), ' The plan changed while its map was being read. Waiting for a consistent picture; nothing partial is drawn.');
          row.append(text);
          retryButton(row);
        } else row.append(el('p', '', 'Waiting for the complete plan and its recorded prerequisites. Nothing is drawn until both agree.'));
        state.append(row);
      }
      region.append(state);
      viewportNode = worldNode = zoomNode = null; painted = { key: '', viewport: null };
      host.replaceChildren(region);
      return;
    }

    // ── Picture facts (all from one consistent picture)
    const plan = p.detail.plan, items = p.detail.detail.items;
    const byId = new Map(items.map(i => [i.id, i]));
    const tasks = items.filter(i => i.kind === 'task'), groups = items.filter(i => i.kind === 'group');
    const facts = v.facts?.tasks;
    const active = plan.lifecycle === 'active';
    const guidance = active && v.current;
    const ancestors = (id: string) => {
      const out: ItemView[] = []; const seen = new Set<string>([id]);
      for (let i = byId.get(id); i?.parentId && !seen.has(i.parentId);) { seen.add(i.parentId); i = byId.get(i.parentId); if (i) out.unshift(i); }
      return out;
    };
    const groupPath = (id: string) => ancestors(id).filter(g => g.kind === 'group').map(g => g.title);
    const groupIds = new Set(groups.map(g => g.id));
    const groupGone = v.group !== null && v.group !== '' && !groupIds.has(v.group);
    const inGroup = (id: string) => {
      if (v.group === null) return true;
      const chain = ancestors(id).filter(g => g.kind === 'group');
      return v.group === '' ? chain.length === 0 : chain.some(g => g.id === v.group);
    };
    const match = statusMatch(v.status);
    const visible = new Set(tasks.filter(i => (!match || match(i)) && inGroup(i.id)).map(i => i.id));
    const edges = layout?.edges ?? [];
    const shownEdges = edges.filter(([a, b]) => visible.has(a) && visible.has(b));
    const hiddenTasks = (layout?.order.length ?? tasks.length) - [...visible].filter(id => layout?.positions.has(id) ?? true).length;
    const hiddenEdges = edges.length - shownEdges.length;
    const anyRecorded = items.some(i => i.dependencies?.length);
    const groupOwned = groups.filter(g => g.dependencies?.length);
    const unlocking = (id: string) => guidance && byId.get(id)?.status !== 'skipped' ? [...facts?.get(id)?.unlocksNext ?? []] : [];
    const titleOf = (id: string) => byId.get(id)?.title ?? id;
    const sessionName = v.label ?? ((sid: string) => sessionLabel(sid, EMPTY_LIVE));
    const copies = new Map<string, MapAttributionCopy>();
    const attributionOf = (id: string) => {
      let c = copies.get(id);
      if (!c) copies.set(id, c = attributionCopy(v.attribution?.get(id), v.current, p.graph.revision, sessionName));
      return c;
    };
    const anyAttribution = tasks.some(i => attributionOf(i.id).card);
    const selected = v.selected && byId.get(v.selected)?.kind === 'task' ? byId.get(v.selected)! : null;
    // Upstream/downstream emphasis: fresh on-demand closure walks for the selection only.
    const upstreamSet = selected && layout ? v.facts?.upstream(selected.id) ?? null : null;
    const downstreamSet = selected && layout ? v.facts?.downstream(selected.id) ?? null : null;
    const related = (id: string) => upstreamSet?.has(id) ? 'upstream' : downstreamSet?.has(id) ? 'downstream' : null;
    const highlight = !!selected && visible.has(selected.id);
    if (highlight) region.dataset.highlight = 'true';
    const roving = b ? st!.roving && visible.has(st!.roving) ? st!.roving : layout?.order.find(id => visible.has(id)) ?? null : null;

    // ── Header: plan, lifecycle, counts, qualification, View as list
    const head = el('header', 'ap-map-head');
    const top = el('div', 'ap-map-top');
    const titles = el('div', 'ap-map-titles');
    titles.append(el('p', 'ap-h', 'Dependency map'));
    const heading = testid(el('h2', 'ap-plan-title', plan.title), 'map-title');
    heading.id = `${uid}-title`;
    titles.append(heading);
    const meta = el('div', 'ap-meta');
    meta.append(lifecycleBadge(plan), el('span', '', `Revision ${p.graph.revision}`));
    titles.append(meta, testid(el('p', 'ap-map-counts', summaryText(summarize(plan, p.detail.detail))), 'map-counts'));
    const actions = el('div', 'ap-map-actions');
    listButton(actions);
    top.append(titles, actions);
    head.append(top);

    // State line: quiet when current; Updating/failed keep the last consistent picture, labelled.
    const state = testid(el('div', 'ap-map-notice'), 'map-state');
    state.dataset.state = v.state;
    const stateRow = el('div', 'ap-map-notice-row');
    if (v.current && v.state === 'ready') {
      state.dataset.tone = 'none';
      stateRow.append(el('p', 'ap-sr', `Showing revision ${p.graph.revision}.`));
    } else if (v.state === 'error') {
      state.dataset.tone = 'warning';
      stateRow.append(el('p', '', `Couldn’t read the latest map. Showing revision ${p.graph.revision} as last reported; Ready and Unlocks next are hidden until it can be read.`));
      retryButton(stateRow);
    } else {
      state.dataset.tone = 'quiet';
      const text = el('p');
      text.append(el('strong', '', 'Updating…'), ` Showing revision ${p.graph.revision} as last reported. Ready and Unlocks next are hidden until the newer report is matched.`);
      stateRow.append(text);
      retryButton(stateRow);
    }
    state.append(stateRow);

    // Active, current plans: reported working / ready / unlocks-next emphasis. Never on closed plans.
    const summary = testid(el('div', 'ap-map-summary'), 'map-summary');
    if (guidance && tasks.length) {
      const working = tasks.filter(i => i.status === 'working').length;
      const ready = tasks.filter(i => facts?.get(i.id)?.group === 'ready').length;
      const blocked = tasks.filter(i => i.status === 'blocked').length;
      const unlocks = new Set(tasks.flatMap(i => unlocking(i.id)));
      const stats = el('ul', 'ap-map-stats');
      stats.setAttribute('aria-label', 'Current work');
      const stat = (kind: Mark, count: number, text: string) => {
        const li = el('li', 'ap-map-stat'); li.dataset.kind = kind; li.dataset.count = String(count);
        li.append(mark(kind), el('strong', '', String(count)), ` ${text}`);
        stats.append(li);
      };
      stat('working', working, 'reported working');
      stat('ready', ready, 'ready');
      if (blocked) stat('blocked', blocked, 'explicitly blocked');
      if (unlocks.size) {
        const li = el('li', 'ap-map-stat'); li.dataset.kind = 'unlocks'; li.dataset.count = String(unlocks.size);
        li.append(el('span', 'ap-map-unlock-icon'), 'Unlocks next · ', el('strong', '', String(unlocks.size)), ` ${unlocks.size === 1 ? 'task' : 'tasks'}`);
        stats.append(li);
      }
      summary.append(stats);
      // The full definitions sit in the help below the map; the header keeps the one caveat.
      summary.append(el('p', 'ap-note', 'From recorded prerequisites only; neither Ready nor Unlocks next is permission to start.'));
    } else if (!active && tasks.length) {
      summary.append(el('p', 'ap-note', 'This plan is closed. Cards show reported status only, without Ready or Unlocks next guidance.'));
    }

    // Recorded-information qualification and D5 statements.
    const context = testid(el('p', 'ap-map-context'), 'map-context');
    // A taskless plan keeps its explanation AND the dependency statement that is true for it: D5's exact
    // sentence when nothing records prerequisites; group-owned prerequisites get the task-to-task wording.
    if (!tasks.length) context.append(groups.length ? 'No task cards. This plan records only groups; their context is listed below. ' : 'No task cards. This plan has no recorded tasks yet. ');
    if (!anyRecorded) context.append(el('strong', '', 'No prerequisites recorded for this plan'), tasks.length ? '. Cards are placed in list order, without arrows.' : '.');
    else if (!edges.length) context.append(el('strong', '', 'No task-to-task prerequisites recorded'), '. Group prerequisites are listed as group context, never drawn as arrows.');
    else context.append('Arrows run from a recorded prerequisite to the task that depends on it. Recorded information only: not a schedule, and not proof that work ran.');
    head.append(state, summary, context);
    region.append(head);

    // ── Controls: Show all / Unfinished (the list's pressed pair and predicate) and group subtree filter.
    const controls = el('div', 'ap-map-controls');
    controls.setAttribute('role', 'group');
    controls.setAttribute('aria-label', 'Map filters');
    const status = testid(el('div', 'ap-map-pair'), 'map-status');
    status.setAttribute('role', 'group');
    status.setAttribute('aria-label', 'Show tasks');
    status.dataset.mode = v.status;
    for (const [value, label] of [['all', 'Show all'], ['unfinished', 'Unfinished']] as const) {
      const holder = button(status, `map-status-${value}`, label, () => { if (v.status !== value) v.onStatus(value); }, v.status === value ? 'outline' : 'ghost');
      holder.querySelector('button')?.setAttribute('aria-pressed', String(v.status === value));
    }
    const field = (label: string, control: HTMLSelectElement) => { const f = el('label', 'ap-map-field'); f.append(el('span', 'ap-map-field-label', label), control); return f; };
    const group = testid(el('select', 'ap-map-select'), 'map-group');
    const option = (value: string, label: string) => { const o = el('option', '', label); o.value = value; group.append(o); };
    option('*', 'All groups'); option('', 'No group recorded');
    for (const g of groups) option(g.id, [...groupPath(g.id), g.title].join(' › '));
    if (groupGone) option(v.group!, 'Chosen group is no longer recorded');
    group.value = v.group ?? '*'; group.onchange = () => v.onGroup(group.value === '*' ? null : group.value);
    controls.append(status, field('Group', group));
    const hidden = testid(el('p', 'ap-map-hidden'), 'map-hidden');
    Object.assign(hidden.dataset, { tasks: String(hiddenTasks), edges: String(hiddenEdges) });
    if (tasks.length) {
      hidden.textContent = hiddenTasks
        ? `Showing ${visible.size} of ${plural(tasks.length, 'task', 'tasks')} · ${plural(hiddenTasks, 'task', 'tasks')}${hiddenEdges ? ` and ${plural(hiddenEdges, 'arrow', 'arrows')}` : ''} hidden by filters`
        : `Showing all ${plural(tasks.length, 'task', 'tasks')}${edges.length ? ` and ${plural(edges.length, 'arrow', 'arrows')}` : ''}`;
    }
    controls.append(hidden);
    region.append(controls);

    // ── Body: stage (toolbar + canvas) and inspector (beside on a wide board, stacked in the rail)
    const body = el('div', 'ap-map-body');
    const stage = el('div', 'ap-map-stage');
    const viewport = testid(el('div', 'ap-map-viewport'), 'map-viewport');
    viewport.setAttribute('role', 'region');
    viewport.setAttribute('aria-label', 'Task map');
    const scrollKey = `${plan.key}`;
    const helpId = `${uid}-help`;
    let world: HTMLElement | null = null;
    if (b) {
      viewport.dataset.interactive = '';
      viewport.setAttribute('aria-describedby', helpId);
      if (st!.dragging !== null) viewport.dataset.dragging = '';
      const t0 = st!.transform;
      const toolbar = el('div', 'ap-map-toolbar');
      toolbar.setAttribute('role', 'group');
      toolbar.setAttribute('aria-label', 'Map view');
      const tool = (id: string, name: keyof typeof ICONS, label: string, run: () => void, text = false) => {
        const t = testid(el('button', 'ap-map-tool'), id);
        t.type = 'button';
        t.append(icon(name));
        if (text) { t.append(el('span', '', label)); t.dataset.text = ''; } else { t.setAttribute('aria-label', label); t.title = label; }
        t.onclick = run;
        return t;
      };
      const size = () => ({ w: viewportNode?.clientWidth || 320, h: viewportNode?.clientHeight || 240 });
      const zoomBy = (factor: number) => { const bb = binding(); if (bb?.dispatch({ type: 'zoom', factor })) announce(`Zoom ${zoomText(bb.state().transform.zoom)}.`); };
      const panBy = (dx: number, dy: number, where: string) => { const bb = binding(); if (bb?.dispatch({ type: 'pan', x: dx, y: dy })) announce(`View moved ${where}.`); };
      const zoomSet = el('div', 'ap-map-tool-set');
      zoomNode = testid(el('span', 'ap-map-zoom', zoomText(t0.zoom)), 'map-zoom-level');
      zoomNode.setAttribute('aria-label', `Zoom ${zoomText(t0.zoom)}`);
      zoomSet.append(tool('map-zoom-out', 'zoom-out', 'Zoom out', () => zoomBy(1 / MAP_ZOOM.step)), zoomNode, tool('map-zoom-in', 'zoom-in', 'Zoom in', () => zoomBy(MAP_ZOOM.step)));
      // Separate flex items so a narrow rail wraps to two rows, not three.
      const fit = tool('map-fit-all', 'fit', 'Fit all', () => binding()?.dispatch({ type: 'fit' }), true);
      const current = tool('map-focus-current', 'current', 'Focus current work', () => binding()?.dispatch({ type: 'current' }), true);
      const panSet = el('div', 'ap-map-tool-set ap-map-pan');
      const step = () => Math.max(60, Math.round(Math.min(size().w, size().h) * 0.3));
      panSet.append(
        tool('map-pan-left', 'left', 'Pan left', () => panBy(step(), 0, 'left')),
        tool('map-pan-up', 'up', 'Pan up', () => panBy(0, step(), 'up')),
        tool('map-pan-down', 'down', 'Pan down', () => panBy(0, -step(), 'down')),
        tool('map-pan-right', 'right', 'Pan right', () => panBy(-step(), 0, 'right')));
      toolbar.append(zoomSet, fit, current, panSet);
      stage.append(toolbar);

      // Keys only while the canvas (a card or the empty target) owns focus; never modified/browser keys.
      viewport.addEventListener('keydown', e => {
        const target = e.target as HTMLElement, bb = binding();
        const canvas = target === viewport || target.classList.contains('ap-map-card');
        if (!bb || !canvas || e.defaultPrevented || e.isComposing) return;
        const modified = e.ctrlKey || e.metaKey || e.altKey || (e.shiftKey && e.key.startsWith('Arrow'));
        if (!bb.dispatch({ type: 'key', key: e.key, canvas, modified, editable: false })) return;
        e.preventDefault();
        if (e.key === '+' || e.key === '-') announce(`Zoom ${zoomText(bb.state().transform.zoom)}.`);
      });
      // Tab into an off-screen roving card: pan just enough to show it (no selection change). Passive
      // focus restoration after a repaint (e.g. an unchanged poll) never pans: the reader's pan stays.
      viewport.addEventListener('focusin', e => {
        const card = e.target as HTMLElement, bb = binding();
        if (!bb || restoring || !card.classList.contains('ap-map-card')) return;
        const r = card.getBoundingClientRect(), box = viewport.getBoundingClientRect(), inset = 8;
        const shift = (start: number, end: number, lo: number, hi: number) => start < lo + inset ? lo + inset - start : end > hi - inset ? Math.max(lo + inset - start, hi - inset - end) : 0;
        const dx = shift(r.left, r.right, box.left, box.right), dy = shift(r.top, r.bottom, box.top, box.bottom);
        if (dx || dy) { bb.dispatch({ type: 'pan', x: dx, y: dy }); applyViewport(); }
        revealInPage(card);
      });
      // Background drag pans; cards are buttons and never start a drag.
      viewport.addEventListener('pointerdown', e => {
        const bb = binding(); if (!bb) return;
        const background = !(e.target as Element).closest('button,a,select,input,textarea,summary');
        bb.dispatch({ type: 'pointer-down', pointerId: e.pointerId, point: { x: e.clientX, y: e.clientY }, background, primary: e.isPrimary && e.button === 0 && !e.ctrlKey && !e.metaKey });
      });
      viewport.addEventListener('lostpointercapture', e => {
        // Root replacement detaches this node: that loss is rebound, not a gesture end.
        const bb = binding();
        if (!releasing && viewport.isConnected && bb?.state().dragging === e.pointerId) bb.dispatch({ type: 'pointer-end', pointerId: e.pointerId });
      });
      // Wheel/trackpad pans inside the canvas only. Ctrl/Cmd (browser zoom, pinch) is left alone.
      viewport.addEventListener('wheel', e => {
        const bb = binding(); if (!bb || e.ctrlKey || e.metaKey) return;
        const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? viewport.clientHeight : 1;
        const dx = (e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX) * unit, dy = (e.shiftKey && !e.deltaX ? 0 : e.deltaY) * unit;
        if (bb.dispatch({ type: 'pan', x: -dx, y: -dy })) e.preventDefault();
      }, { passive: false });
    } else {
      if (scroll.key !== scrollKey) scroll = { key: scrollKey, left: 0, top: 0 };
      viewport.addEventListener('scroll', () => { scroll = { key: scrollKey, left: viewport.scrollLeft, top: viewport.scrollTop }; }, { passive: true });
    }

    if (layout) {
      const m = layout.metrics;
      world = testid(el('div', 'ap-map-world'), 'map-world');
      const width = layout.width + PAD * 2, height = layout.height + PAD * 2;
      world.style.width = `${width}px`; world.style.height = `${height}px`;
      if (b) {
        const t = st!.transform;
        world.style.transformOrigin = '0 0';
        world.style.transform = `translate(${t.x - PAD * t.zoom}px,${t.y - PAD * t.zoom}px) scale(${t.zoom})`;
        world.style.setProperty('--ap-map-zoom', String(t.zoom));
      }
      const svg = document.createElementNS(SVG, 'svg');
      svg.setAttribute('class', 'ap-map-edges');
      svg.setAttribute('width', String(width)); svg.setAttribute('height', String(height));
      svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
      svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
      const defs = document.createElementNS(SVG, 'defs');
      for (const tone of ['open', 'quiet', 'path'] as const) {
        const marker = document.createElementNS(SVG, 'marker');
        marker.id = `${uid}-arrow-${tone}`;
        marker.setAttribute('class', `ap-map-marker ap-map-marker-${tone}`);
        for (const [k, val] of [['viewBox', '0 0 10 10'], ['refX', '9'], ['refY', '5'], ['markerWidth', '9'], ['markerHeight', '9'], ['markerUnits', 'userSpaceOnUse'], ['orient', 'auto']]) marker.setAttribute(k, val);
        const head = document.createElementNS(SVG, 'path');
        head.setAttribute('d', 'M 0 0.5 L 10 5 L 0 9.5 z');
        head.setAttribute('class', 'ap-map-arrowhead');
        marker.append(head); defs.append(marker);
      }
      svg.append(defs);
      // Spread ports along card sides so converging arrowheads stay distinguishable.
      const ports = (side: 0 | 1) => {
        const by = new Map<string, string[]>();
        for (const e of shownEdges) { const own = e[side], other = e[side ? 0 : 1]; const list = by.get(own) ?? []; list.push(other); by.set(own, list); }
        for (const list of by.values()) list.sort((a, b) => layout.positions.get(a)!.y - layout.positions.get(b)!.y || layout.order.indexOf(a) - layout.order.indexOf(b));
        return (own: string, other: string) => { const list = by.get(own)!; const n = list.length, k = list.indexOf(other); const step = Math.min(14, (m.height - 28) / Math.max(1, n - 1)); return m.height / 2 + (k - (n - 1) / 2) * step; };
      };
      const outPort = ports(0), inPort = ports(1);
      const pitch = m.height + m.rowGap;
      const lastRow = Math.max(0, ...[...layout.positions.values()].map(s => s.row));
      const onPath: SVGPathElement[] = [];
      for (const [from, to] of shownEdges) {
        const a = layout.positions.get(from)!, bb = layout.positions.get(to)!;
        const x1 = a.x + m.width + PAD, y1 = a.y + PAD + outPort(from, to);
        const x2 = bb.x + PAD - 1, y2 = bb.y + PAD + inPort(to, from);
        const dx = Math.max(24, (x2 - x1) * 0.5);
        // Adjacent columns: one curve inside the column gap. Longer spans travel along a row gap
        // (slots share one grid, so it is free of cards in every column) instead of behind cards.
        let d = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
        if (bb.column - a.column > 1) {
          const mid = (y1 + y2) / 2 - PAD;
          const gap = Math.min(lastRow, Math.max(-1, Math.round((mid - m.height - m.rowGap / 2) / pitch)));
          const yc = PAD + gap * pitch + m.height + m.rowGap / 2;
          const xa = x1 + m.columnGap * 0.7, xb = x2 - m.columnGap * 0.7;
          const ka = (xa - x1) / 2, kb = (x2 - xb) / 2;
          d = `M ${x1} ${y1} C ${x1 + ka} ${y1}, ${xa - ka} ${yc}, ${xa} ${yc} L ${xb} ${yc} C ${xb + kb} ${yc}, ${x2 - kb} ${y2}, ${x2} ${y2}`;
        }
        const prereq = byId.get(from)?.status;
        const tone = prereq === 'done' || prereq === 'skipped' ? 'quiet' : 'open';
        const path = document.createElementNS(SVG, 'path');
        path.setAttribute('class', 'ap-map-edge');
        path.dataset.tone = tone;
        if (prereq === 'skipped') path.dataset.skipped = 'true';
        path.setAttribute('data-from', from); path.setAttribute('data-to', to);
        path.setAttribute('d', d);
        // An edge lies on the selection's chain when both ends are in its upstream (or downstream) closure.
        const sel = selected?.id;
        const way = !highlight || !sel ? null : (to === sel || upstreamSet?.has(to)) && upstreamSet?.has(from) ? 'upstream' : (from === sel || downstreamSet?.has(from)) && downstreamSet?.has(to) ? 'downstream' : null;
        if (way) path.dataset.path = way;
        path.setAttribute('marker-end', `url(#${uid}-arrow-${way ? 'path' : tone})`);
        if (way) onPath.push(path); else svg.append(path);
      }
      svg.append(...onPath); // chain arrows paint above the rest
      world.append(svg);

      for (const id of layout.order) {
        if (!visible.has(id)) continue;
        const i = byId.get(id), slot = layout.positions.get(id);
        if (!i || !slot) continue;
        const fact = facts?.get(id), kind = markOf(i, fact, guidance), unlocks = unlocking(id);
        const card = testid(el('button', 'ap-map-card'), `map-card-${id}`);
        card.type = 'button';
        Object.assign(card.dataset, { task: id, x: String(slot.x), y: String(slot.y), status: i.status, readiness: guidance ? fact?.group ?? '' : '', unlocks: unlocks.join(','), mark: kind });
        if (selected?.id === id) card.setAttribute('aria-current', 'true');
        const rel = highlight ? related(id) : null;
        if (rel) card.dataset.related = rel;
        if (b) card.tabIndex = id === roving ? 0 : -1;
        Object.assign(card.style, { left: `${slot.x + PAD}px`, top: `${slot.y + PAD}px`, width: `${m.width}px`, height: `${m.height}px` });
        const path = groupPath(id);
        const prereqs = edges.filter(([, b]) => b === id).length, dependents = edges.filter(([a]) => a === id).length;
        const statusRow = el('span', 'ap-map-card-status');
        statusRow.append(mark(kind), el('span', 'ap-map-card-word', MARK_TEXT[kind]));
        const title = el('span', 'ap-map-card-title', i.title);
        // Attribution line: takes the title's second line inside the same fixed slot (the full title
        // stays in the name and inspector), so its text never moves or resizes anything else.
        const who = attributionOf(id);
        card.dataset.attribution = who.kind;
        if (who.live) card.dataset.live = who.live.kind;
        const foot = el('span', 'ap-map-card-foot');
        foot.append(el('span', 'ap-map-card-group', path.length ? path[path.length - 1] : ''));
        if (unlocks.length) { const u = el('span', 'ap-map-card-unlocks'); u.append(el('span', 'ap-map-unlock-icon'), `Unlocks next · ${unlocks.length}`); foot.append(u); }
        card.append(statusRow, title);
        if (who.card) {
          card.dataset.who = '';
          const line = testid(el('span', 'ap-map-card-who'), `map-card-who-${id}`);
          line.dataset.attribution = who.kind;
          const text = el('span', 'ap-map-card-who-text');
          // Session activity: a small square (status marks are round) placed on the assigned SESSION's
          // name, never beside the task's status words. Inline in this fixed line, so it moves nothing
          // else; its words are in the card's name, the inspector and the map help.
          if (who.live && who.session) {
            const live = testid(el('span', 'ap-map-live-mark'), `map-card-live-${id}`);
            live.dataset.live = who.live.kind; live.setAttribute('aria-hidden', 'true');
            text.append(who.card.slice(0, -who.session.length), live, who.session);
          } else text.textContent = who.card;
          line.append(text);
          card.append(line);
        }
        card.append(foot);
        card.setAttribute('aria-label', [
          i.title, MARK_TEXT[kind], who.card ?? '', who.live ? `${who.live.text}, session activity only` : '',
          path.length ? `Group: ${path.join(' › ')}` : '',
          `${plural(prereqs, 'recorded prerequisite', 'recorded prerequisites')}, ${plural(dependents, 'dependent', 'dependents')}`,
          unlocks.length ? `Unlocks next for ${plural(unlocks.length, 'task', 'tasks')}` : '',
          rel === 'upstream' ? 'Upstream of the selected task' : rel === 'downstream' ? 'Downstream of the selected task' : '',
        ].filter(Boolean).join('. '));
        card.onclick = () => { if (b) b.dispatch({ type: 'select', id }); else v.onSelect(id); };
        world.append(card);
        // Chain tag: a label on the card's top edge, outside its clipped content, so it never competes
        // with status words or chips. Decorative: the card's name carries the same words.
        if (rel) {
          const tag = el('span', 'ap-map-card-rel', rel === 'upstream' ? 'Upstream' : 'Downstream');
          tag.dataset.related = rel; tag.setAttribute('aria-hidden', 'true');
          Object.assign(tag.style, { left: `${slot.x + PAD + m.width - 10}px`, top: `${slot.y + PAD - 8}px` });
          world.append(tag);
        }
      }
      if (!tasks.length || !visible.size) {
        const empty = testid(el('div', 'ap-map-empty'), 'map-empty');
        if (!tasks.length) {
          empty.append(el('p', '', 'No task cards'));
          // One named focus target for an empty canvas.
          if (b) { viewport.tabIndex = 0; viewport.dataset.mapEmptyTarget = ''; viewport.setAttribute('aria-label', 'Task map: no task cards'); }
        } else {
          empty.append(el('p', '', groupGone ? 'The chosen group is no longer recorded.' : 'No tasks match these filters.'));
          const clear = el('div', 'ap-map-actions');
          const holder = button(clear, 'map-clear-filters', 'Show all tasks', () => { if (b) b.dispatch({ type: 'filters', status: 'all', group: null }); else { if (v.status !== 'all') v.onStatus('all'); if (v.group !== null) v.onGroup(null); } }, 'outline');
          holder.querySelector('button')?.setAttribute('data-map-empty-target', '');
          empty.append(clear);
        }
        viewport.append(empty);
      }
      viewport.append(world);
    }
    stage.append(viewport);
    body.append(stage);

    // ── Inspector: literal text only; relationships are explicit records, never inferred.
    const inspector = testid(el('section', 'ap-map-inspector'), 'map-inspector');
    inspector.setAttribute('aria-labelledby', `${uid}-inspector`);
    const ih = el('h3', 'ap-h', 'Selected task'); ih.id = `${uid}-inspector`;
    inspector.append(ih);
    if (!selected) {
      inspector.dataset.selected = '';
      inspector.append(el('p', 'ap-note', tasks.length ? 'Select a card to see its recorded prerequisites, dependents and reported details.' : 'No task cards to inspect.'));
    } else {
      const id = selected.id, fact = facts?.get(id), kind = markOf(selected, fact, guidance);
      inspector.dataset.selected = id;
      const status = el('p', 'ap-map-card-status');
      status.dataset.mark = kind;
      status.append(mark(kind), el('span', 'ap-map-card-word', MARK_TEXT[kind]));
      if (!visible.has(id)) status.append(el('span', 'ap-map-tag', 'Hidden by filters'));
      inspector.append(status, el('p', 'ap-map-inspector-title', selected.title));
      const explain = readinessText(selected, fact, guidance, active, titleOf);
      if (explain) inspector.append(el('p', 'ap-note', explain));
      const factsList = el('dl', 'ap-map-facts');
      const fact2 = (label: string, value: string | Node) => { const d = el('div'); d.append(el('dt', '', label)); const dd = el('dd'); dd.append(value); d.append(dd); factsList.append(d); };
      const path = groupPath(id);
      fact2('Group', path.length ? path.join(' › ') : 'No group recorded');
      if (selected.status === 'blocked') {
        const bl = selected.reportedBlocker;
        fact2('Reason', blockerPart(bl, 'reason'));
        fact2('Next action', blockerPart(bl, 'nextAction'));
      }
      inspector.append(factsList);
      // Who: verified assignment, link-only and unverified context, reports and session activity,
      // each as its own recorded fact. Never “unassigned” for a missing projection.
      const who = attributionOf(id);
      const ws = testid(el('div', 'ap-map-rel ap-map-who'), 'map-attribution');
      Object.assign(ws.dataset, { assignment: who.kind, live: who.live?.kind ?? '' });
      ws.append(el('h4', 'ap-map-rel-h', 'Assignment and activity'));
      const whoList = el('dl', 'ap-map-facts');
      const row = (label: string, testId: string, lines: (string | Node)[], note: string | null = null) => {
        const d = testid(el('div'), testId); d.append(el('dt', '', label));
        const dd = el('dd');
        lines.forEach((line, n) => { if (n) dd.append(el('br')); dd.append(line); });
        if (note) dd.append(el('span', 'ap-map-who-note', note));
        d.append(dd); whoList.append(d);
      };
      row('Assignment', 'map-attribution-assignment', [who.assignment], who.assignmentNote);
      if (who.links.length) row('Links', 'map-attribution-links', who.links);
      if (who.kind !== 'unavailable') row('Reports', 'map-attribution-reports', who.reports.length ? who.reports : ['No reports recorded']);
      let activity: string | Node = who.activity;
      if (who.live) {
        // The mark is decorative here: the words beside it say the same thing.
        const mark = el('span', 'ap-map-live-mark'); mark.dataset.live = who.live.kind; mark.setAttribute('aria-hidden', 'true');
        const words = el('strong', 'ap-map-who-live'); words.dataset.live = who.live.kind;
        words.append(mark, who.live.text);
        activity = words;
      }
      row('Session activity', 'map-attribution-live', [activity], who.activityNote);
      ws.append(whoList);
      inspector.append(ws);
      const relationList = (label: string, ids: readonly string[], none: string, testId: string, kindOf: 'upstream' | 'downstream') => {
        const sec = testid(el('div', 'ap-map-rel'), testId);
        sec.dataset.related = kindOf;
        sec.append(el('h4', 'ap-map-rel-h', `${label} (${ids.length})`));
        if (!ids.length) { sec.append(el('p', 'ap-note', none)); return sec; }
        const ul = el('ul', 'ap-map-rel-list');
        for (const rid of ids) {
          const r = byId.get(rid); if (!r) continue;
          const li = el('li');
          const rk = markOf(r, facts?.get(rid), guidance);
          const btn = testid(el('button', 'ap-map-rel-item'), `map-relation-${rid}`);
          btn.type = 'button';
          btn.append(mark(rk));
          const text = el('span', 'ap-map-rel-text');
          text.append(el('span', 'ap-map-rel-title', r.title));
          const sub = el('span', 'ap-map-rel-sub', MARK_TEXT[rk]);
          if (!visible.has(rid)) sub.append(' · hidden by filters');
          text.append(sub);
          btn.append(text);
          btn.onclick = () => {
            // Reveal only what hides the requested task, then select it and move focus there.
            if (b) { b.dispatch({ type: 'relation', id: rid }); return; }
            if (match && !match(r)) v.onStatus('all');
            if (!inGroup(rid)) v.onGroup(null);
            focusCard = rid; v.onSelect(rid);
          };
          li.append(btn); ul.append(li);
        }
        sec.append(ul);
        return sec;
      };
      const upstream = layout ? edges.filter(([, b]) => b === id).map(([a]) => a) : [];
      const downstream = layout ? edges.filter(([a]) => a === id).map(([, b]) => b) : [];
      const order = (ids: string[]) => layout ? layout.order.filter(n => ids.includes(n)) : ids;
      inspector.append(relationList('Recorded prerequisites', order(upstream), 'None recorded.', 'map-prerequisites', 'upstream'));
      inspector.append(relationList('Dependents', order(downstream), 'No task records this one as a prerequisite.', 'map-dependents', 'downstream'));
      const chain = (upstreamSet?.size ?? 0) + (downstreamSet?.size ?? 0);
      if (highlight && chain) inspector.append(el('p', 'ap-note ap-map-chain', `Highlighted on the map: ${plural(upstreamSet?.size ?? 0, 'upstream task', 'upstream tasks')} it waits on, directly or through others, and ${plural(downstreamSet?.size ?? 0, 'downstream task', 'downstream tasks')} waiting on it.`));
      const unlocks = unlocking(id);
      if (unlocks.length) {
        const u = testid(el('div', 'ap-map-rel'), 'map-unlocks');
        u.append(el('h4', 'ap-map-rel-h', 'Unlocks next'));
        u.append(el('p', 'ap-note', `If reported done, this would satisfy the last unfinished recorded prerequisite for: ${order(unlocks).map(titleOf).join('; ')}. That is not permission to start them.`));
        inspector.append(u);
      }
      // Ancestor groups' own recorded prerequisites: labelled group metadata, never task arrows.
      const owned = ancestors(id).filter(g => g.kind === 'group' && g.dependencies?.length);
      if (owned.length) {
        const g = testid(el('div', 'ap-map-rel'), 'map-group-prerequisites');
        g.append(el('h4', 'ap-map-rel-h', 'Group context'));
        for (const o of owned) g.append(el('p', 'ap-note', `Group “${o.title}” records its own prerequisites: ${(o.dependencies ?? []).map(titleOf).join('; ')}. These belong to the group, not to this task.`));
        inspector.append(g);
      }
      const hiddenRel = [...upstream, ...downstream].filter(r => !visible.has(r)).length;
      if (hiddenRel) inspector.append(el('p', 'ap-note', `${plural(hiddenRel, 'related task is', 'related tasks are')} hidden by the current filters. Choosing one shows it again.`));
    }
    body.append(inspector);
    region.append(body);

    // ── Help: keys (interactive), reading the highlights and the guidance definitions moved from the header.
    if (b || (guidance && tasks.length) || anyAttribution) {
      const help = testid(el('div', 'ap-map-help'), 'map-help');
      help.id = helpId;
      if (b) {
        const keys = el('p', 'ap-map-keys');
        const k = (text: string) => el('kbd', '', text);
        const nowrap = (...parts: (string | Node)[]) => { const n = el('span', 'ap-map-nowrap'); n.append(...parts); return n; };
        keys.append(el('strong', '', 'Keys in the map: '), k('Arrow keys'), ' nearest card · ', k('['), ' first prerequisite · ', k(']'), ' first dependent · ', k('F'), ' fit all · ', nowrap(k('+'), ' ', k('−'), ' zoom'), '. Drag the background or scroll to pan; Tab leaves the map.');
        help.append(keys);
        if (layout && edges.length) help.append(el('p', '', 'Selecting a card marks the tasks it waits on as Upstream (solid outline) and the tasks waiting on it as Downstream (double outline).'));
      }
      if (guidance && tasks.length) help.append(el('p', '', 'Ready: every recorded prerequisite is reported done. Unlocks next: if reported done, a card would satisfy the last unfinished recorded prerequisite of another task.'));
      if (anyAttribution) help.append(testid(el('p', '', 'Assigned to: a verified delegation for this revision. Unverified assignee: recorded, but without a verified delegation. Linked to: a session link, not an assignment. A square before the assigned session’s name: that session is active now (filled) or waiting for input (outlined) in this view’s run records. It doesn’t show which task the session is working on.'), 'map-attribution-help'));
      region.append(help);
    }

    // ── Group context: legal group-owned prerequisites stay inspectable without becoming arrows.
    if (groupOwned.length || (!tasks.length && groups.length)) {
      const details = testid(el('details', 'ap-map-groups'), 'map-group-context');
      if (!tasks.length || !edges.length) details.open = true;
      details.append(el('summary', '', `Group context (${groups.length})`));
      const ul = el('ul', 'ap-map-group-list');
      for (const g of groups) {
        const li = el('li');
        li.append(el('span', 'ap-map-group-name', [...groupPath(g.id), g.title].join(' › ')));
        const deps = g.dependencies ?? [];
        li.append(el('span', 'ap-note', deps.length ? `Records its own prerequisites: ${deps.map(titleOf).join('; ')}` : 'No group prerequisites recorded'));
        ul.append(li);
      }
      details.append(ul, el('p', 'ap-note', 'A group’s prerequisites are group metadata. They are not inherited by its tasks and are never drawn as arrows.'));
      region.append(details);
    }

    // Screen continuity: where the same plan's canvas sat before this repaint (old root still attached).
    const before = b && painted.key === scrollKey && painted.viewport?.isConnected ? painted.viewport.getBoundingClientRect().top : null;
    viewportNode = viewport; worldNode = world; if (!b) zoomNode = null;
    painted = { key: scrollKey, viewport };
    host.replaceChildren(region);
    const restore = () => {
      if (!viewport.isConnected) return false;
      if (b) {
        // A scrolled reader keeps the canvas where it was on screen when header text changes height.
        const page = viewport.ownerDocument.scrollingElement;
        if (before !== null && page && page.scrollTop > 0) { const delta = viewport.getBoundingClientRect().top - before; if (Math.abs(delta) >= 1) page.scrollTop += delta; }
        // An active background drag continues on the replacement canvas.
        const dragging = b.state().dragging;
        if (dragging !== null && !viewport.hasPointerCapture(dragging)) {
          try { viewport.setPointerCapture(dragging); viewport.dataset.dragging = ''; } catch { b.dispatch({ type: 'pointer-end', pointerId: dragging }); }
        }
        tryFocus(true);
        return true;
      }
      if (scroll.left || scroll.top) { viewport.scrollLeft = scroll.left; viewport.scrollTop = scroll.top; }
      if (focusCard) {
        const target = viewport.querySelector<HTMLElement>(`[data-task="${CSS.escape(focusCard)}"]`);
        focusCard = null;
        if (target) { target.focus({ preventScroll: true }); target.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
      }
      return true;
    };
    // The owner attaches the root after paint; restore once it is connected (before display).
    queueMicrotask(() => { if (!restore()) requestAnimationFrame(restore); });
    if (v.onCanvasWidth && typeof ResizeObserver === 'function') {
      const report = v.onCanvasWidth;
      observer = new ResizeObserver(() => {
        const width = Math.floor(viewport.clientWidth - PAD * 2);
        if (width > 0 && width !== canvasWidth) { canvasWidth = width; report(width); }
      });
      observer.observe(viewport);
    }
  }
  return {
    render(next, nextInput) { ensureMapStyle(next.ownerDocument); host = next; input = nextInput; paint(); },
    mount(next) { ensureMapStyle(next.ownerDocument); host = next; paint(); },
    update(next) { input = next; paint(); },
    command(c) {
      switch (c.type) {
        case 'viewport': scheduleViewport(); break;
        case 'announce': announce(c.text); break;
        case 'focus': {
          // Focus now (keyboard moves feel immediate), and again after a repaint in this same turn:
          // the owner restores its pre-paint focus after replacing the root. The action always ends
          // with this turn (after any repaint's restore has run), consumed or not: a missing target
          // or a placeholder paint can never leave it waiting for a later poll.
          const want = pendingFocus = { id: c.id, generation: c.generation };
          tryFocus(false);
          queueMicrotask(() => queueMicrotask(() => { if (pendingFocus === want) pendingFocus = null; }));
          break;
        }
        case 'capture': capture(c.pointerId, c.capture); break;
        default: break; // selection, filters and list reveal are frame state, owned by the frame
      }
    },
    dispose() {
      observer?.disconnect(); observer = null; unlisten();
      if (frame) cancelAnimationFrame(frame); frame = 0;
      if (speakFrame) cancelAnimationFrame(speakFrame); speakFrame = 0; spoken++;
      host = null; input = null; viewportNode = worldNode = zoomNode = null; pendingFocus = null; painted = { key: '', viewport: null };
    },
  };
}

function readinessText(item: ItemView, fact: DerivedTask | undefined, guidance: boolean, active: boolean, titleOf: (id: string) => string): string {
  if (item.status === 'skipped') return 'Skipped work never counts as done for its dependents.';
  if (item.status === 'blocked') return 'An agent reported this task explicitly blocked. It is never shown as ready, whatever its prerequisites.';
  if (item.status !== 'pending') return '';
  if (!active) return 'Reported pending when the plan closed.';
  if (!guidance) return 'Reported pending. Readiness is hidden until the current revision is matched.';
  const open = (fact?.prerequisites ?? []).filter(p => p.kind !== 'task' || p.status !== 'done');
  if (fact?.group === 'ready') return fact.prerequisites.length ? 'Every recorded prerequisite is reported done. Ready describes recorded prerequisites only.' : 'No prerequisites recorded. Ready describes recorded prerequisites only.';
  if (fact?.group === 'skipped') return `Waiting: a recorded prerequisite was skipped (${open.filter(p => p.kind === 'task' && p.status === 'skipped').map(p => titleOf(p.id)).join('; ')}), and skipped work never counts as done.`;
  return `Waiting on ${plural(open.length, 'unfinished recorded prerequisite', 'unfinished recorded prerequisites')}.`;
}

/**
 * Map-only attribution words (stricter than the list): “Assigned to” needs the verified, revision-
 * current delegation; links and an unverified recorded assignee are named as such; a missing
 * projection is “unavailable”, never “unassigned”. Live words are about the assigned SESSION only
 * and appear only with proof on a current picture. Pure: no DOM, so the copy is checkable alone.
 */
export type MapAttributionKind = 'assigned' | 'recorded' | 'linked' | 'none' | 'unavailable';
export interface MapAttributionCopy {
  kind: MapAttributionKind;
  /** Compact card line, or null when the card shows nothing (no assignee/link, or unavailable). */
  card: string | null;
  /** The verified assigned session's label, which ends `card` (where the live mark sits). */
  session: string | null;
  /** Inspector Assignment value and its explanation. */
  assignment: string;
  assignmentNote: string | null;
  links: string[];
  reports: string[];
  /** Proven session activity on a current picture only. */
  live: { kind: 'active' | 'waiting'; text: string } | null;
  activity: string;
  activityNote: string | null;
}
export const LIVE_HEDGE = 'Session activity only: the assigned session is active in this view’s run records, which doesn’t show that it is working on this task.';
export function attributionCopy(a: MapTaskAttribution | undefined, current: boolean, revision: number, label: (id: string) => string): MapAttributionCopy {
  if (!a) return {
    kind: 'unavailable', card: null, session: null, assignment: 'Unavailable in this view',
    assignmentNote: 'Assignment provenance couldn’t be checked for this picture. That doesn’t mean the task is unassigned.',
    links: [], reports: [], live: null, activity: 'Not shown', activityNote: 'Session activity isn’t available in this view.',
  };
  const verified = a.assignment;
  const kind: MapAttributionKind = verified ? 'assigned' : a.recordedAssignee ? 'recorded' : a.links.length ? 'linked' : 'none';
  const more = (n: number) => n > 1 ? ` and ${n - 1} more` : '';
  const card = kind === 'assigned' ? `Assigned to ${label(verified!.childSessionId)}`
    // Qualifier first: a truncated card line must still never read as a verified assignment.
    : kind === 'recorded' ? `Unverified assignee · ${label(a.recordedAssignee!)}`
    : kind === 'linked' ? `Linked to ${label(a.links[0])}${more(a.links.length)} · no verified delegation` : null;
  const assignment = kind === 'assigned' ? `Assigned to ${label(verified!.childSessionId)}`
    : kind === 'recorded' ? `Recorded assignee ${label(a.recordedAssignee!)} · delegation provenance unavailable`
    : 'No assignee recorded';
  const assignmentNote = kind === 'assigned' ? `Verified delegation, current for revision ${verified!.validAtRevision}.`
    : kind === 'recorded' ? 'No verified delegation is recorded for this revision, so the map doesn’t say Assigned. That doesn’t mean the task is unassigned.'
    : kind === 'linked' ? 'Only session links name this task. A link is not an assignment.' : null;
  const links = a.links.map(id => verified && id === verified.childSessionId ? `Linked to ${label(id)}` : `Linked to ${label(id)} · no verified delegation`);
  // One line per distinct reporting identity (mode, reporter, attributed session); repeats by the
  // same identity are counted. Grouping uses session IDs, never display text: two sessions with the
  // same title or a colliding short-ID fallback stay separate lines.
  const lines = new Map<string, { text: string; n: number }>();
  for (const r of a.reports) {
    const relay = r.mode === 'parent-relay';
    const key = JSON.stringify([relay ? 'relay' : 'direct', r.reporterSessionId, relay ? r.attributedSessionId : null]);
    const text = relay ? `Reported by ${label(r.reporterSessionId)} for ${label(r.attributedSessionId)}` : `Reported directly by ${label(r.reporterSessionId)}`;
    const line = lines.get(key); if (line) line.n++; else lines.set(key, { text, n: 1 });
  }
  const reports = [...lines.values()].map(({ text, n }) => n > 1 ? `${text} · ${n} reports` : text);
  if (!reports.length && a.reporter) reports.push(`Last reported by ${label(a.reporter)} · report mode unavailable`);
  const proven = a.live.proven && current && !!verified ? a.live : null;
  const live = proven ? proven.kind === 'active'
    ? { kind: 'active' as const, text: 'Assigned session active now' }
    : { kind: 'waiting' as const, text: 'Assigned session waiting for input now' } : null;
  const reason = a.live.proven ? 'picture-not-current' : a.live.reason;
  const activityNote = live ? LIVE_HEDGE : !current || reason === 'picture-not-current' ? `Hidden while the map shows revision ${revision} as last reported.`
    : reason === 'no-verified-assignment' ? 'Shown only for a verified assignment.'
    : reason === 'run-scope-unavailable' ? 'This view’s run records aren’t available.'
    : reason === 'latest-child-not-proven' ? 'This view’s run records don’t confirm the assigned session’s latest run.'
    : 'The assigned session’s latest recorded run isn’t active now.';
  return { kind, card, session: verified ? label(verified.childSessionId) : null, assignment, assignmentNote, links, reports, live, activity: live ? live.text : 'Not shown', activityNote };
}

function blockerPart(b: BlockerView | undefined, part: 'reason' | 'nextAction'): string {
  if (!b) return 'Not reported';
  if (b.state === 'invalid') return 'Reported details could not be read';
  return b[part] ?? 'Not reported';
}
