import { mountList, mountSelect, mountTabs, type Tone } from '@openchamber/sdk/ui';
import { startView, type ViewContext } from '../shared/app.ts';
import {
  button, detailsBlock, documentBlock, el, emptyBlock, failureBlock, failureFacts, historyBlock, loadingBlock, planDetail, planHeader, recordedLabel, staleBlock, testid, type Env,
} from '../shared/components.ts';
import { plural } from '../shared/format.ts';
import { coverageFor, liveLabel } from '../shared/live.ts';
import { LIFECYCLE_LABEL, summarize, type PlanView } from '../shared/model.ts';
import {
  ALL, applyFilters, coverageGap, filterOptions, NO_FILTERS, normalizeFilters, pageListScope, pickPlan, placeOf, projectsFor, type Filters, type Option,
} from '../shared/scope.ts';
import { officialMainBlock } from '../shared/official.ts';
import { captureOffNote, initialSetupUi, reloadNote, setupBlock, type SetupUi } from '../shared/setup.ts';
import { cleanupBlock, cleanupNotice } from '../shared/cleanup-view.ts';

type Tab = 'progress' | 'document' | 'history';
/** `reveal`: token of an explicit list selection whose detail is scrolled into view once (narrow layout). */
type Ui = { filters: Filters; selected: string | null; tab: Tab; reveal: number; setup: SetupUi; archived: boolean };

const visiblePlans = (vc: ViewContext<Ui>) => {
  if (!vc.read) return [];
  const filters = normalizeFilters(vc.read.plans, vc.env.live, vc.ui.filters);
  return applyFilters(vc.read.plans, vc.env.live, filters);
};
const selectedPlan = (vc: ViewContext<Ui>) => pickPlan(visiblePlans(vc), vc.ui.selected);
let reveals = 0;
let revealed = 0;

// Fullscreen board: every plan in the connected store, filtered by project/worktree/session.
startView<Ui>({
  surface: 'page',
  maxSessionSubscriptions: 16,
  initialUi: () => ({ filters: NO_FILTERS, selected: null, tab: 'progress', reveal: 0, setup: initialSetupUi(), archived: false }),
  scope: (_ctx, ui) => ({ ...pageListScope(ui.filters), archived: ui.archived ? 'only' : 'exclude' }),
  actionPlan: selectedPlan,
  forgetPlans: (keys, ui) => keys.has(ui.selected ?? '') ? { selected: null } : {},
  wantProjects: ({ read, live, directory }) => (read ? projectsFor(read.plans, live, directory) : []),
  wantDetails: (vc) => { const p = selectedPlan(vc); return p && vc.ui.tab === 'progress' ? [p] : []; },
  // Task reading follows the board's own scope and selection (never the host session); the
  // Progress/Document/History tabs of one selection share it.
  reading: (vc) => { const p = selectedPlan(vc); return p ? { plan: p.key, scope: `board:${JSON.stringify([vc.ui.archived, vc.ui.filters])}` } : null; },
  paint(root, vc) {
    const { read, failure, env, ui } = vc;
    root.append(el('h1', 'ap-sr', 'Agent progress'));
    const modes = testid(el('div', 'ap-row'), 'cleanup-modes');
    button(modes, 'cleanup-visible', 'Current plans', () => vc.setUi({ archived: false, selected: null, filters: NO_FILTERS, reveal: 0 }), ui.archived ? 'ghost' : 'outline');
    button(modes, 'cleanup-archived', 'Archived plans', () => vc.setUi({ archived: true, selected: null, filters: NO_FILTERS, reveal: 0 }), ui.archived ? 'outline' : 'ghost', vc.health?.ready === true && !vc.health.planCleanup);
    modes.querySelectorAll('button').forEach((b, i) => b.setAttribute('aria-pressed', String(i === (ui.archived ? 1 : 0))));
    root.append(modes);
    const notice = cleanupNotice(vc); if (notice) root.append(notice);
    if (vc.health?.ready && !vc.health.planCleanup) root.append(testid(el('p', 'ap-note', 'Plan cleanup is unavailable with this service version.'), 'cleanup-unavailable'));
    // The official-main notice does not depend on companion setup or the store.
    const official = officialMainBlock(vc);
    if (!read) {
      if (failure) root.append(failureBlock(failure, vc.retry));
      else if (vc.health && !vc.health.ready) { if (official) root.append(official); root.append(setupBlock(vc)); }
      else if (!(ui.archived && vc.health?.ready && !vc.health.planCleanup)) root.append(loadingBlock());
      return;
    }
    if (failure && vc.lastGoodAt) root.append(staleBlock(failure, vc.lastGoodAt, env.locale, vc.retry));
    const reload = reloadNote(vc);
    if (reload) root.append(reload);
    if (official) root.append(official);
    if (!read.captureEnabled) {
      const note = captureOffNote(vc.setup);
      const p = testid(el('p', 'ap-doc-warn', note.text), 'capture-off');
      p.dataset.reason = note.reason;
      root.append(p);
    }
    if (!read.plans.length && ui.filters.session === ALL) {
      root.append(emptyBlock('empty-state', ui.archived ? 'No archived plans' : 'No plans recorded here', ui.archived ? 'Finished plans you archive will appear here. Their history stays available.' : 'New reports appear here. Finished work may be in Archived plans.'));
      footer(root, vc, null);
      return;
    }
    const filters = normalizeFilters(read.plans, env.live, ui.filters);
    const setFilter = (patch: Partial<Filters>) => vc.setUi({ filters: { ...filters, ...patch }, reveal: 0 });
    const options = filterOptions(read.plans, env.live, filters);
    const bar = testid(el('div', 'ap-filters'), 'filters');
    bar.setAttribute('role', 'group');
    bar.setAttribute('aria-label', 'Filter plans');
    select(bar, 'filter-project', 'Project', filters.project, options.projects, (v) => setFilter({ project: v, worktree: ALL, session: ALL }));
    select(bar, 'filter-worktree', 'Worktree', filters.worktree, options.worktrees, (v) => setFilter({ worktree: v, session: ALL }));
    select(bar, 'filter-session', 'Session', filters.session, options.sessions, (v) => setFilter({ session: v }), true);
    root.append(bar);

    const visible = applyFilters(read.plans, env.live, filters);
    const plan = pickPlan(visible, ui.selected);
    const board = el('div', 'ap-board');
    board.append(planList(visible, plan, env, (key) => vc.setUi({ selected: key, reveal: ++reveals })));
    const detail = testid(el('section', 'ap-detail'), 'plan-detail');
    detail.setAttribute('aria-label', 'Plan detail');
    if (plan) {
      const tabs = testid(el('div', 'ap-detail-tabs'), 'detail-tabs');
      mountTabs(tabs, { items: [{ id: 'progress', label: 'Progress' }, { id: 'document', label: 'Document' }, { id: 'history', label: 'History' }], activeId: ui.tab, onChange: (id) => vc.setUi({ tab: id as Tab }) });
      detail.append(tabs);
      const docHooks = { get: () => vc.document(plan), request: () => vc.requestDocument(plan) };
      if (ui.tab === 'document') {
        const article = testid(el('article', 'ap-plan'), `plan-${plan.id}`);
        article.dataset.source = plan.sourceId;
        article.append(planHeader(plan, env), documentBlock(plan, env, 'inline', docHooks));
        detail.append(article);
      } else if (ui.tab === 'history') {
        const article = testid(el('article', 'ap-plan'), `plan-${plan.id}`);
        article.dataset.source = plan.sourceId;
        vc.requestHistory(plan);
        article.append(planHeader(plan, env), historyBlock(plan, vc.history(plan), env));
        detail.append(article);
      } else detail.append(planDetail(plan, env, { detail: vc.detail(plan), retryDetail: vc.retry, document: docHooks }, { document: 'omit', compareSession: filters.session !== ALL ? filters.session : null, reading: vc.reading }));
      detail.append(cleanupBlock(vc, plan));
    } else detail.append(emptyBlock('filtered-empty', 'No plans match these filters', 'Choose another project, worktree or session.'));
    board.append(detail);
    root.append(board);

    const gap = coverageGap(visible, env.live, env.boundSource);
    const notes: string[] = [];
    if (gap.missing) notes.push(gap.missing === 1
      ? 'Live status is unavailable for 1 plan: its session is not in the current workspace coverage, so it can’t be opened from here.'
      : `Live status is unavailable for ${gap.missing} plans: their sessions are not in the current workspace coverage, so they can’t be opened from here.`);
    if (gap.otherSource) notes.push(`${plural(gap.otherSource, 'plan comes', 'plans come')} from another OpenCode setup, so ${gap.otherSource === 1 ? 'it' : 'they'} can be read but not opened from here.`);
    if (gap.capped) notes.push(`Live status is limited to the first projects; ${plural(gap.capped, 'project is', 'projects are')} not watched.`);
    if (read.truncated) notes.push('Some older plans were not loaded.');
    if (notes.length) {
      const note = testid(el('div', 'ap-note'), 'coverage-note');
      for (const n of notes) note.append(el('p', '', n));
      root.append(note);
    }
    footer(root, vc, plan);
  },
  // An explicit selection reveals its detail once; later paints (polls, task jumps) never scroll back to it.
  afterPaint(root, vc) {
    if (!vc.ui.reveal || vc.ui.reveal === revealed) return;
    revealed = vc.ui.reveal;
    if (window.matchMedia('(min-width: 820px)').matches) return;
    root.querySelector('[data-testid="plan-detail"]')?.scrollIntoView({ block: 'start' });
  },
});

/** Footer zone: collapsed Setup and Details, after the progress story. */
function footer(root: HTMLElement, vc: ViewContext<Ui>, plan: PlanView | null) {
  const zone = el('div', 'ap-footer');
  const setup = testid(el('details', 'ap-details'), 'setup-section');
  setup.append(el('summary', '', 'Setup'));
  const body = el('div');
  const fill = () => { body.replaceChildren(setupBlock(vc)); };
  setup.addEventListener('toggle', () => { if (setup.open) { if (!vc.setup) vc.requestSetup(); fill(); } });
  setup.append(body);
  zone.append(setup, detailsBlock(vc.read, plan, [
    ['Plans loaded', String(vc.read?.plans.length ?? 0)],
    ['Live sessions watched', String(vc.sessionSubscriptions)],
    ...failureFacts(vc.failure),
  ], vc.env));
  root.append(zone);
}

function select(parent: Element, id: string, label: string, value: string, options: Option[], onChange: (v: string) => void, searchable = false) {
  const holder = testid(el('div'), id);
  mountSelect(holder, { label, value, options, onChange, searchable: searchable && options.length > 8 });
  parent.append(holder);
}

function planList(plans: PlanView[], selected: PlanView | null, env: Env, onSelect: (key: string) => void) {
  const wrap = testid(el('nav', 'ap-plan-list'), 'plan-list');
  wrap.setAttribute('aria-label', 'Plans');
  wrap.dataset.scrollKey = 'plan-list';
  const groups = new Map<string, { label: string; plans: PlanView[] }>();
  for (const p of plans) {
    const place = placeOf(p, env.live);
    const g = groups.get(place.projectKey) ?? { label: place.projectLabel, plans: [] };
    g.plans.push(p);
    groups.set(place.projectKey, g);
  }
  for (const [key, g] of groups) {
    const section = testid(el('section', 'ap-section'), `project-${key}`);
    section.append(el('h2', 'ap-h', g.label));
    const holder = el('div');
    mountList(holder, {
      ariaLabel: `Plans in ${g.label}`,
      selectedId: selected?.key ?? null,
      onSelect,
      items: g.plans.map((p) => {
        const s = summarize(p);
        const place = placeOf(p, env.live);
        const cov = coverageFor(p.ownerSessionId, p.directory, env.live);
        const other = env.boundSource === null || p.sourceId !== env.boundSource;
        const badge: { label: string; tone: Tone } = p.lifecycle !== 'active'
          ? { label: LIFECYCLE_LABEL[p.lifecycle], tone: p.lifecycle === 'completed' ? 'success' : p.lifecycle === 'failed' ? 'error' : 'neutral' }
          : env.unverifiedSources.has(p.sourceId) ? { label: 'Unverified setup', tone: 'warning' }
          : other ? { label: 'Other setup', tone: 'neutral' } : { label: liveLabel(cov).label, tone: liveLabel(cov).tone };
        return { id: p.key, title: p.title, subtitle: `${place.worktreeLabel} · ${recordedLabel(p, env)(p.ownerSessionId)}`, meta: s.total ? `${s.done}/${s.total}` : '—', badge };
      }),
    });
    g.plans.forEach((p, i) => {
      const row = holder.querySelectorAll<HTMLElement>('[role="option"]')[i];
      if (row) { row.dataset.testid = `plan-row-${p.id}`; row.dataset.source = p.sourceId; }
    });
    section.append(holder);
    wrap.append(section);
  }
  if (!plans.length) wrap.append(testid(el('p', 'ap-note', 'No plans match.'), 'list-empty'));
  return wrap;
}
