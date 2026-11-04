// Read-only dependency map renderer (Designer-owned). Shared by the board and the right rail.
// Every recorded string lands through textContent. Geometry comes from the frame owner's full-plan
// layout and is never recomputed or filtered here: filters only hide cards/arrows in place.
// S2 scope: cards, arrows, header, filters, selection inspector and honest states. Pan/zoom/fit,
// keyboard canvas navigation, framing and announcements belong to later slices.
import type { MapSnapshot, MapPicture } from './dependency-map.ts';
import type { MapLayout } from './dependency-map-layout.ts';
import type { DerivedTask } from './dependency-derivation.ts';
import { button, el, lifecycleBadge, testid } from './components.ts';
import { MAP_CSS } from './dependency-map-style.ts';
import { plural } from './format.ts';
import { statusMatch, summarize, summaryText, type BlockerView, type ItemView, type StatusFilter } from './model.ts';

export interface DependencyMapViewInput extends MapSnapshot {
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
}
export interface DependencyMapView {
  /** Rebind after root replacement. State/geometry remain frame-owned, not DOM-owned. */
  mount: (host: HTMLElement) => void;
  update: (input: DependencyMapViewInput) => void;
  dispose: () => void;
}
/** QA vocabulary: map-region data-{state,current,revision,tasks,edges}; map-card-ID
 * data-{task,x,y,status,readiness,unlocks}; SVG paths data-{from,to}, marker-end;
 * map-{state,viewport,world,inspector,group,status,list,retry}. No data-reading article.
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
  // Native scroll position of the canvas, kept across root replacement for the same plan only.
  let scroll = { key: '', left: 0, top: 0 };
  let focusCard: string | null = null;
  let observer: ResizeObserver | null = null, canvasWidth = 0;

  function paint() {
    observer?.disconnect(); observer = null;
    if (!host || !input) return;
    const v = input;
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
    const selected = v.selected && byId.get(v.selected)?.kind === 'task' ? byId.get(v.selected)! : null;

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
      summary.append(el('p', 'ap-note', 'Ready: every recorded prerequisite is reported done. Unlocks next: if reported done, a card would satisfy the last unfinished recorded prerequisite of another task. Neither is permission to start.'));
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

    // ── Controls: Show all / Unfinished (same predicate as the list) and group subtree filter.
    const controls = el('div', 'ap-map-controls');
    controls.setAttribute('role', 'group');
    controls.setAttribute('aria-label', 'Map filters');
    const field = (label: string, control: HTMLSelectElement) => { const f = el('label', 'ap-map-field'); f.append(el('span', 'ap-map-field-label', label), control); return f; };
    const status = testid(el('select', 'ap-map-select'), 'map-status');
    for (const [value, label] of [['all', 'Show all'], ['unfinished', 'Unfinished']]) { const o = el('option', '', label); o.value = value; status.append(o); }
    status.value = v.status; status.onchange = () => v.onStatus(status.value as StatusFilter);
    const group = testid(el('select', 'ap-map-select'), 'map-group');
    const option = (value: string, label: string) => { const o = el('option', '', label); o.value = value; group.append(o); };
    option('*', 'All groups'); option('', 'No group recorded');
    for (const g of groups) option(g.id, [...groupPath(g.id), g.title].join(' › '));
    if (groupGone) option(v.group!, 'Chosen group is no longer recorded');
    group.value = v.group ?? '*'; group.onchange = () => v.onGroup(group.value === '*' ? null : group.value);
    controls.append(field('Tasks', status), field('Group', group));
    const hidden = testid(el('p', 'ap-map-hidden'), 'map-hidden');
    Object.assign(hidden.dataset, { tasks: String(hiddenTasks), edges: String(hiddenEdges) });
    if (tasks.length) {
      hidden.textContent = hiddenTasks
        ? `Showing ${visible.size} of ${plural(tasks.length, 'task', 'tasks')} · ${plural(hiddenTasks, 'task', 'tasks')}${hiddenEdges ? ` and ${plural(hiddenEdges, 'arrow', 'arrows')}` : ''} hidden by filters`
        : `Showing all ${plural(tasks.length, 'task', 'tasks')}${edges.length ? ` and ${plural(edges.length, 'arrow', 'arrows')}` : ''}`;
    }
    controls.append(hidden);
    region.append(controls);

    // ── Body: canvas + inspector (beside on a wide board, stacked in the rail)
    const body = el('div', 'ap-map-body');
    const viewport = testid(el('div', 'ap-map-viewport'), 'map-viewport');
    viewport.setAttribute('role', 'region');
    viewport.setAttribute('aria-label', 'Task cards');
    const scrollKey = `${plan.key}`;
    if (scroll.key !== scrollKey) scroll = { key: scrollKey, left: 0, top: 0 };
    viewport.addEventListener('scroll', () => { scroll = { key: scrollKey, left: viewport.scrollLeft, top: viewport.scrollTop }; }, { passive: true });

    if (layout) {
      const m = layout.metrics;
      const world = testid(el('div', 'ap-map-world'), 'map-world');
      const width = layout.width + PAD * 2, height = layout.height + PAD * 2;
      world.style.width = `${width}px`; world.style.height = `${height}px`;
      const svg = document.createElementNS(SVG, 'svg');
      svg.setAttribute('class', 'ap-map-edges');
      svg.setAttribute('width', String(width)); svg.setAttribute('height', String(height));
      svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
      svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
      const defs = document.createElementNS(SVG, 'defs');
      for (const tone of ['open', 'quiet'] as const) {
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
      for (const [from, to] of shownEdges) {
        const a = layout.positions.get(from)!, b = layout.positions.get(to)!;
        const x1 = a.x + m.width + PAD, y1 = a.y + PAD + outPort(from, to);
        const x2 = b.x + PAD - 1, y2 = b.y + PAD + inPort(to, from);
        const dx = Math.max(24, (x2 - x1) * 0.5);
        // Adjacent columns: one curve inside the column gap. Longer spans travel along a row gap
        // (slots share one grid, so it is free of cards in every column) instead of behind cards.
        let d = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
        if (b.column - a.column > 1) {
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
        path.setAttribute('marker-end', `url(#${uid}-arrow-${tone})`);
        svg.append(path);
      }
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
        Object.assign(card.style, { left: `${slot.x + PAD}px`, top: `${slot.y + PAD}px`, width: `${m.width}px`, height: `${m.height}px` });
        const path = groupPath(id);
        const prereqs = edges.filter(([, b]) => b === id).length, dependents = edges.filter(([a]) => a === id).length;
        const statusRow = el('span', 'ap-map-card-status');
        statusRow.append(mark(kind), el('span', 'ap-map-card-word', MARK_TEXT[kind]));
        const title = el('span', 'ap-map-card-title', i.title);
        const foot = el('span', 'ap-map-card-foot');
        foot.append(el('span', 'ap-map-card-group', path.length ? path[path.length - 1] : ''));
        if (unlocks.length) { const u = el('span', 'ap-map-card-unlocks'); u.append(el('span', 'ap-map-unlock-icon'), `Unlocks next · ${unlocks.length}`); foot.append(u); }
        card.append(statusRow, title, foot);
        card.setAttribute('aria-label', [
          i.title, MARK_TEXT[kind],
          path.length ? `Group: ${path.join(' › ')}` : '',
          `${plural(prereqs, 'recorded prerequisite', 'recorded prerequisites')}, ${plural(dependents, 'dependent', 'dependents')}`,
          unlocks.length ? `Unlocks next for ${plural(unlocks.length, 'task', 'tasks')}` : '',
        ].filter(Boolean).join('. '));
        card.onclick = () => v.onSelect(id);
        world.append(card);
      }
      if (!tasks.length || !visible.size) {
        const empty = testid(el('div', 'ap-map-empty'), 'map-empty');
        if (!tasks.length) empty.append(el('p', '', 'No task cards'));
        else {
          empty.append(el('p', '', groupGone ? 'The chosen group is no longer recorded.' : 'No tasks match these filters.'));
          const clear = el('div', 'ap-map-actions');
          button(clear, 'map-clear-filters', 'Show all tasks', () => { if (v.status !== 'all') v.onStatus('all'); if (v.group !== null) v.onGroup(null); }, 'outline');
          empty.append(clear);
        }
        viewport.append(empty);
      }
      viewport.append(world);
    }
    body.append(viewport);

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
        const b = selected.reportedBlocker;
        fact2('Reason', blockerPart(b, 'reason'));
        fact2('Next action', blockerPart(b, 'nextAction'));
      }
      inspector.append(factsList);
      const relationList = (label: string, ids: readonly string[], none: string, testId: string) => {
        const sec = testid(el('div', 'ap-map-rel'), testId);
        sec.append(el('h4', 'ap-map-rel-h', `${label} (${ids.length})`));
        if (!ids.length) { sec.append(el('p', 'ap-note', none)); return sec; }
        const ul = el('ul', 'ap-map-rel-list');
        for (const rid of ids) {
          const r = byId.get(rid); if (!r) continue;
          const li = el('li');
          const rk = markOf(r, facts?.get(rid), guidance);
          const b = testid(el('button', 'ap-map-rel-item'), `map-relation-${rid}`);
          b.type = 'button';
          b.append(mark(rk));
          const text = el('span', 'ap-map-rel-text');
          text.append(el('span', 'ap-map-rel-title', r.title));
          const sub = el('span', 'ap-map-rel-sub', MARK_TEXT[rk]);
          if (!visible.has(rid)) sub.append(' · hidden by filters');
          text.append(sub);
          b.append(text);
          b.onclick = () => {
            // Reveal only what hides the requested task, then select it and move focus there.
            if (match && !match(r)) v.onStatus('all');
            if (!inGroup(rid)) v.onGroup(null);
            focusCard = rid; v.onSelect(rid);
          };
          li.append(b); ul.append(li);
        }
        sec.append(ul);
        return sec;
      };
      const upstream = layout ? edges.filter(([, b]) => b === id).map(([a]) => a) : [];
      const downstream = layout ? edges.filter(([a]) => a === id).map(([, b]) => b) : [];
      const order = (ids: string[]) => layout ? layout.order.filter(n => ids.includes(n)) : ids;
      inspector.append(relationList('Recorded prerequisites', order(upstream), 'None recorded.', 'map-prerequisites'));
      inspector.append(relationList('Dependents', order(downstream), 'No task records this one as a prerequisite.', 'map-dependents'));
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

    host.replaceChildren(region);
    const restore = () => {
      if (!viewport.isConnected) return false;
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
    mount(next) { ensureMapStyle(next.ownerDocument); host = next; paint(); },
    update(next) { input = next; paint(); },
    dispose() { observer?.disconnect(); observer = null; host = null; input = null; },
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

function blockerPart(b: BlockerView | undefined, part: 'reason' | 'nextAction'): string {
  if (!b) return 'Not reported';
  if (b.state === 'invalid') return 'Reported details could not be read';
  return b[part] ?? 'Not reported';
}
