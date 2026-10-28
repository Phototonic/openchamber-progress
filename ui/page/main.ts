import { mountList, mountSelect, mountTabs, type Tone } from '@openchamber/sdk/ui';
import { startView, type ViewContext } from '../shared/app.ts';
import {
  button, detailsBlock, documentBlock, el, emptyBlock, failureBlock, failureFacts, historyBlock, loadingBlock, partState, planDetail, planHeader, recordedLabel, revealCurrentTask, staleBlock, testid, type Env,
} from '../shared/components.ts';
import type { DigestPanel } from '../shared/change-digest.ts';
import { digestBlock } from '../shared/change-digest-view.ts';
import { plural } from '../shared/format.ts';
import { coverageFor, liveLabel } from '../shared/live.ts';
import { LIFECYCLE_LABEL, summarize, type PlanView, type SearchHitView } from '../shared/model.ts';
import {
  ALL, applyFilters, coverageGap, filterOptions, NO_FILTERS, normalizeFilters, pageListScope, pickPlan, placeOf, projectsFor, searchFilterOptions, type Filters, type Option,
} from '../shared/scope.ts';
import { criteriaKey, queryProblem, searchable, SearchController, type SearchCriteria, type SearchViewState } from '../shared/search.ts';
import {
  announceSearch, chipsBlock, NO_DRAFT, resultsBlock, scopeLine, searchForm, statusLine, unavailableNote, type ChipKind, type SearchDraft,
} from '../shared/search-view.ts';
import { officialMainBlock } from '../shared/official.ts';
import { captureOffNote, initialSetupUi, reloadNote, setupBlock, type SetupUi } from '../shared/setup.ts';
import { cleanupBlock, cleanupNotice } from '../shared/cleanup-view.ts';

type Tab = 'progress' | 'document' | 'history';
/** A submitted search: `owner` is the account + store/binding it was submitted under. */
type Submitted = { key: string; owner: string; criteria: SearchCriteria };
/**
 * `reveal`: token of an explicit list selection whose detail is scrolled into view once (narrow layout).
 * `search`: the submitted board search (null: ordinary browsing); `draft`: its unsubmitted selects.
 */
type Ui = { filters: Filters; selected: string | null; tab: Tab; reveal: number; setup: SetupUi; archived: boolean; search: Submitted | null; draft: SearchDraft; problem: string | null };

const visiblePlans = (vc: ViewContext<Ui>) => {
  if (!vc.read) return [];
  const filters = normalizeFilters(vc.read.plans, vc.env.live, vc.ui.filters, vc.env.boundSource);
  return applyFilters(vc.read.plans, vc.env.live, filters, vc.env.boundSource);
};
let reveals = 0;
let revealed = 0;
/**
 * "View current task" from the History digest or a search task hit. `detail`: wait (still on
 * History) for complete current detail of the same plan at the listed revision; a task no longer in
 * it is announced there, keeping the recorded context. `search`: wait on Progress for complete
 * current detail of the hit's plan (same run, identity and archive mode). `reveal`: on Progress,
 * reveal its canonical row once complete detail is painted.
 */
let pendingTask: { key: string; item: string; title: string; stage: 'detail' | 'reveal' | 'search'; run?: number; message: string } | null = null;
let shownDigest: DigestPanel | null = null;

// Board search: one controller per frame. Typing never requests; only explicit actions do.
let frame: ViewContext<Ui> | null = null;
const search = new SearchController({
  service: (current) => (frame ? frame.service(current) : { serviceRequest: () => Promise.reject(new Error('Retired read')) }),
  changed: () => frame?.updateUi(() => ({})),
  visible: () => document.visibilityState !== 'hidden',
});
let submits = 0;
let notices = 0;
/** Unsubmitted search text of one frame identity (account + store/binding); never stored. */
let text = { owner: '', q: '' };
/** Last painted plan of the selected hit, kept across its own revision reload (same run and key only). */
let heldPlan: { run: number; key: string; plan: PlanView } | null = null;
/** Hit the user opened, for `aria-current` in the results. */
let openedHit: { key: string; item: string | null } | null = null;
let caret: [number | null, number | null] | null = null;
/** Plans opened while searching, most recent last (at most three): their part caches are kept with the selection. */
const RECENT_OPENED = 3;
let opened: string[] = [];

const ownerOf = (vc: ViewContext<Ui>) => JSON.stringify([vc.ctx.connection?.account ?? '', vc.identity]);
function draftText(vc: ViewContext<Ui>) {
  if (text.owner !== ownerOf(vc)) text = { owner: ownerOf(vc), q: '' };
  return text.q;
}
const setText = (vc: ViewContext<Ui>, q: string) => { text = { owner: ownerOf(vc), q }; };
const say = (message: string) => announceSearch(--notices, message);

/** Whether the controller still runs this frame identity's submitted search (cheap: no view). */
function isSearching(vc: ViewContext<Ui>) {
  const s = vc.ui.search;
  return !!s && !!vc.read && vc.health?.planTaskSearch === 1 && s.owner === ownerOf(vc) && search.key === s.key;
}
/** The submitted search of this frame identity, when the controller still runs it. */
const searching = (vc: ViewContext<Ui>): SearchViewState | null => (isSearching(vc) ? search.view() : null);

/** Selected search plan: complete current detail metadata (never the search summary itself). */
function searchPlan(vc: ViewContext<Ui>, v: SearchViewState): PlanView | null {
  const request = search.selectedPlan();
  if (!request || request.key !== vc.ui.selected) return null;
  const full = vc.detailPlan(request);
  if (full) {
    // The listed copy of the same revision keeps the summary preview and digest identities.
    const listed = vc.read?.plans.find((p) => p.key === full.key);
    const plan = listed && listed.revision === full.revision && (listed.cleanup?.revision ?? 0) === (full.cleanup?.revision ?? 0) ? listed : full;
    heldPlan = { run: v.run, key: request.key, plan };
    return plan;
  }
  return heldPlan && heldPlan.run === v.run && heldPlan.key === request.key ? heldPlan.plan : null;
}
function selectedPlan(vc: ViewContext<Ui>) {
  const v = searching(vc);
  return v ? searchPlan(vc, v) : pickPlan(visiblePlans(vc), vc.ui.selected);
}

// Fullscreen board: every plan in the connected store, filtered by project/worktree/session.
startView<Ui>({
  surface: 'page',
  maxSessionSubscriptions: 16,
  initialUi: () => ({ filters: NO_FILTERS, selected: null, tab: 'progress', reveal: 0, setup: initialSetupUi(), archived: false, search: null, draft: NO_DRAFT, problem: null }),
  scope: (_ctx, ui) => ({ ...pageListScope(ui.filters), archived: ui.archived ? 'only' : 'exclude' }),
  actionPlan: selectedPlan,
  forgetPlans: (keys, ui) => { if (!keys.has(ui.selected ?? '')) return {}; search.select(null); return { selected: null }; },
  wantProjects: ({ read, live, directory, env }) => (read ? projectsFor(read.plans, live, directory, env.boundSource) : []),
  wantDetails: (vc) => {
    if (isSearching(vc)) { const request = search.selectedPlan(); return request && request.key === vc.ui.selected ? [request] : []; }
    const p = selectedPlan(vc); return p && (vc.ui.tab === 'progress' || pendingTask?.key === p.key) ? [p] : [];
  },
  // Task reading follows the board's own scope and selection (never the host session); the
  // Progress/Document/History tabs of one selection share it. A search run is its own scope.
  reading: (vc) => {
    const p = selectedPlan(vc); if (!p) return null;
    const v = searching(vc);
    return { plan: p.key, scope: v ? `board-search:${v.run}` : `board:${JSON.stringify([vc.ui.archived, vc.ui.filters])}` };
  },
  // While results are shown, the poll revalidates them (and the selection) instead of the list.
  freshness: (vc) => (isSearching(vc) && search.freshKeys().length ? (service) => search.revalidate(service) : null),
  retire: (reason) => { if (reason === 'reset') search.retire(); else if (reason === 'hidden') search.hidden(); else search.dispose(); },
  // Search run + selection, also for plans outside the loaded list: a change retires their part reads.
  partsKey: (vc) => (isSearching(vc) ? JSON.stringify([vc.ui.search!.key, vc.ui.selected]) : null),
  // While searching, part caches hold the selection and the few results opened just before it.
  retainParts: (vc) => (isSearching(vc) ? new Set([...opened, ...(vc.ui.selected ? [vc.ui.selected] : [])]) : null),
  paint(root, vc) {
    frame = vc;
    const { read, failure, env, ui } = vc;
    const old = document.getElementById('ap-search-q') as HTMLInputElement | null;
    caret = old && document.activeElement === old ? [old.selectionStart, old.selectionEnd] : null;
    if (!ui.search && search.active) search.clear();
    root.append(el('h1', 'ap-sr', 'Agent progress'));
    const modes = testid(el('div', 'ap-row'), 'cleanup-modes');
    const mode = (archived: boolean) => { endSearch(); vc.setUi({ archived, selected: null, filters: NO_FILTERS, reveal: 0, search: null, draft: NO_DRAFT, problem: null }); };
    button(modes, 'cleanup-visible', 'Current plans', () => mode(false), ui.archived ? 'ghost' : 'outline');
    button(modes, 'cleanup-archived', 'Archived plans', () => mode(true), ui.archived ? 'outline' : 'ghost', vc.health?.ready === true && !vc.health.planCleanup);
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
    const capable = vc.health?.planTaskSearch === 1;
    const v = capable ? searching(vc) : null;
    if (v) search.membership(env.live);
    root.append(capable ? searchArea(vc, v) : unavailableNote());
    if (v) { searchBoard(root, vc, v); footer(root, vc, selectedPlan(vc)); return; }
    if (!read.plans.length && ui.filters.session === ALL) {
      root.append(emptyBlock('empty-state', ui.archived ? 'No archived plans' : 'No plans recorded here', ui.archived ? 'Finished plans you archive will appear here. Their history stays available.' : 'New reports appear here. Finished work may be in Archived plans.'));
      footer(root, vc, null);
      return;
    }
    const filters = normalizeFilters(read.plans, env.live, ui.filters, env.boundSource);
    const setFilter = (patch: Partial<Filters>) => vc.setUi({ filters: { ...filters, ...patch }, reveal: 0 });
    const options = filterOptions(read.plans, env.live, filters, read.plans, env.boundSource);
    root.append(filterBar(filters, options, setFilter));

    const visible = applyFilters(read.plans, env.live, filters, env.boundSource);
    const plan = pickPlan(visible, ui.selected);
    const board = el('div', 'ap-board');
    board.append(planList(visible, plan, env, (key) => vc.setUi({ selected: key, reveal: ++reveals })));
    const detail = testid(el('section', 'ap-detail'), 'plan-detail');
    detail.setAttribute('aria-label', 'Plan detail');
    if (plan) detailPane(detail, vc, plan, filters.session);
    else detail.append(emptyBlock('filtered-empty', 'No plans match these filters', 'Choose another project, worktree or session.'));
    board.append(detail);
    root.append(board);

    const gap = coverageGap(visible, env.live, env.boundSource);
    const notes: string[] = [];
    if (gap.missing) notes.push(gap.missing === 1
      ? 'Live status is unavailable for 1 plan: its session is not in the current workspace coverage, so it can’t be opened from here.'
      : `Live status is unavailable for ${gap.missing} plans: their sessions are not in the current workspace coverage, so they can’t be opened from here.`);
    if (gap.otherSource) notes.push(`${plural(gap.otherSource, 'plan comes', 'plans come')} from another OpenCode setup, so ${gap.otherSource === 1 ? 'it' : 'they'} can be read but not opened from here.`);
    if (gap.capped) notes.push(`Live status is limited to the first projects; ${plural(gap.capped, 'project is', 'projects are')} not watched.`);
    if (read.truncated) notes.push(capable ? 'Some older plans were not loaded here. Search checks every recorded plan.' : 'Some older plans were not loaded.');
    if (notes.length) {
      const note = testid(el('div', 'ap-note'), 'coverage-note');
      for (const n of notes) note.append(el('p', '', n));
      root.append(note);
    }
    footer(root, vc, plan);
  },
  // An explicit selection reveals its detail once; later paints (polls, task jumps) never scroll back to it.
  afterPaint(root, vc) {
    const input = root.querySelector<HTMLInputElement>('#ap-search-q');
    if (caret && input && document.activeElement === input) input.setSelectionRange(caret[0], caret[1]);
    currentTask(root, vc);
    if (!vc.ui.reveal || vc.ui.reveal === revealed) return;
    revealed = vc.ui.reveal;
    if (window.matchMedia('(min-width: 820px)').matches) return;
    root.querySelector('[data-testid="plan-detail"]')?.scrollIntoView({ block: 'start' });
  },
});

/** Leaves search for ordinary browsing: no run, no reveal, no typed text. */
function endSearch() {
  // The bounded recent set outlives the search (a cache reset clears the caches themselves).
  const previous = frame?.ui.selected;
  if (previous) opened = [...opened.filter((k) => k !== previous), previous].slice(-RECENT_OPENED);
  search.clear(); pendingTask = null; heldPlan = null; openedHit = null;
  if (frame) setText(frame, '');
}

/** Starts a run for these criteria; never for the host session, never without words or a status. */
function runSearch(vc: ViewContext<Ui>, criteria: SearchCriteria) {
  if (!vc.read || vc.health?.planTaskSearch !== 1) return;
  if (!searchable(criteria)) { vc.setUi({ problem: 'Enter words to search, or choose a plan or task status.' }); return; }
  const owner = ownerOf(vc);
  const key = JSON.stringify([owner, criteriaKey(criteria), ++submits]);
  // The recent set survives runs (bounded); the selection being left joins it.
  const previous = vc.ui.selected;
  if (previous) opened = [...opened.filter((k) => k !== previous), previous].slice(-RECENT_OPENED);
  pendingTask = null; heldPlan = null; openedHit = null;
  search.submit(key, criteria, { storeId: vc.read.storeId, binding: vc.read.binding }, vc.live);
  vc.setUi({
    search: { key, owner, criteria }, filters: { project: criteria.project, worktree: criteria.worktree, session: criteria.session },
    draft: { lifecycle: criteria.lifecycle, status: criteria.status, source: criteria.source }, selected: null, problem: null, reveal: 0,
  });
}

/** Board filters the next search uses: the submitted ones while searching, else the shown ones. */
function boardFilters(vc: ViewContext<Ui>): Filters {
  const s = searching(vc)?.criteria;
  if (s) return { project: s.project, worktree: s.worktree, session: s.session };
  return vc.read ? normalizeFilters(vc.read.plans, vc.env.live, vc.ui.filters, vc.env.boundSource) : NO_FILTERS;
}
function labelsFor(vc: ViewContext<Ui>, f: Filters, previous: SearchCriteria['labels'] = {}): SearchCriteria['labels'] {
  const o = searchFilterOptions(vc.read?.plans ?? [], vc.env.live, f, previous, vc.env.boundSource);
  const name = (list: Option[], id: string, old?: string) => (id === ALL ? undefined : list.find((x) => x.id === id && !x.label.endsWith('(not available here)'))?.label ?? old);
  return { project: name(o.projects, f.project, previous.project), worktree: name(o.worktrees, f.worktree, previous.worktree), session: name(o.sessions, f.session, previous.session) };
}

function submitDraft() {
  const vc = frame;
  if (!vc?.read) return;
  const q = draftText(vc);
  const problem = queryProblem(q);
  if (problem) { vc.setUi({ problem }); return; }
  const f = boardFilters(vc);
  const d = vc.ui.draft;
  runSearch(vc, { q: q.trim(), source: d.source, lifecycle: d.lifecycle, status: d.status, ...f, archived: vc.ui.archived, labels: labelsFor(vc, f, vc.ui.search?.criteria.labels) });
}

/** Removing a chip is a deliberate widening: the rest is searched again, or browsing resumes. */
function removeChip(kind: ChipKind) {
  const vc = frame;
  const c = vc ? searching(vc)?.criteria : null;
  if (!vc || !c) return;
  const next: SearchCriteria = { ...c, labels: { ...c.labels } };
  if (kind === 'q') { next.q = ''; setText(vc, ''); }
  else if (kind === 'project') { next.project = ALL; next.worktree = ALL; }
  else next[kind] = ALL;
  if (searchable(next)) { if (kind !== 'q') setText(vc, next.q); runSearch(vc, next); return; }
  endSearch();
  vc.setUi({ search: null, filters: { project: next.project, worktree: next.worktree, session: next.session }, draft: NO_DRAFT, problem: null, selected: null, reveal: 0 });
  say('Search ended. The board shows plans with the remaining filters.');
}
function clearAll() {
  const vc = frame;
  if (!vc) return;
  endSearch();
  vc.setUi({ search: null, filters: NO_FILTERS, draft: NO_DRAFT, problem: null, selected: null, reveal: 0 });
  say(`Search and filters cleared. Showing all ${vc.ui.archived ? 'archived' : 'current'} plans.`);
}

/** Form, explicit scope and (while searching) chips and the last outcome. */
function searchArea(vc: ViewContext<Ui>, v: SearchViewState | null) {
  const area = testid(el('section', 'ap-search-area'), 'search');
  area.setAttribute('aria-label', 'Search');
  const submitted = v?.criteria ?? null;
  area.append(searchForm({
    text: () => draftText(vc), setText: (q) => setText(vc, q),
    draft: vc.ui.draft, setDraft: (patch) => vc.updateUi((u) => ({ draft: { ...u.draft, ...patch } })),
    submit: submitDraft, submitted, problem: vc.ui.problem, sources: vc.read?.sources ?? [], archived: vc.ui.archived,
  }));
  area.append(scopeLine(submitted, vc.ui.archived));
  if (v) {
    const unavailable = new Set<ChipKind>();
    for (const part of v.blockedParts) unavailable.add(part);
    if (v.criteria.source !== ALL && !vc.read?.sources.some((s) => s.id === v.criteria.source)) unavailable.add('source');
    area.append(chipsBlock(v.criteria, unavailable, { remove: removeChip, clearAll }), statusLine(v));
  } else if (vc.ui.filters.project !== ALL || vc.ui.filters.worktree !== ALL || vc.ui.filters.session !== ALL) {
    const row = testid(el('div', 'ap-search-chips'), 'search-chips');
    button(row, 'search-clear', 'Clear search and filters', clearAll, 'ghost');
    area.append(row);
  }
  return area;
}

function searchBoard(root: HTMLElement, vc: ViewContext<Ui>, v: SearchViewState) {
  const { env, ui } = vc;
  const c = v.criteria;
  const f = { project: c.project, worktree: c.worktree, session: c.session };
  // Choices: live locations plus those this frame has seen; never a full-library census.
  const options = searchFilterOptions([...(vc.read?.plans ?? []), ...v.page.hits.map((h) => h.plan)], env.live, f, c.labels, env.boundSource);
  root.append(filterBar(f, options, (patch) => { const next = { ...f, ...patch }; runSearch(vc, { ...c, ...next, labels: labelsFor(vc, next, c.labels) }); }));
  const board = el('div', 'ap-board');
  board.append(resultsBlock(v, env, {
    selected: openedHit && openedHit.key === ui.selected ? openedHit : null,
    openPlan: (hit) => openHit(vc, v, hit, null),
    openTask: (hit) => openHit(vc, v, hit, hit.task),
    more: () => search.more(),
    retry: () => { if (v.blocked) runSearch(vc, c); else search.more(); },
    refresh: () => runSearch(vc, c),
    page: (delta) => { search.showPage(delta); vc.retry(); },
    removeLocation: (part) => removeChip(part),
    clearAll,
  }));
  const detail = testid(el('section', 'ap-detail'), 'plan-detail');
  detail.setAttribute('aria-label', 'Plan detail');
  const request = search.selectedPlan();
  const plan = selectedPlan(vc);
  if (plan) detailPane(detail, vc, plan, c.session !== ALL ? c.session : null);
  else if (request && request.key === ui.selected) {
    const d = vc.detail(request);
    detail.append(partState('detail-loading', 'plan', d?.state === 'error' ? d : null, vc.retry));
  } else detail.append(emptyBlock('search-pick', 'Open a result to read it here', 'Opening a plan or task shows its current plan. It never starts, assigns or completes work.'));
  board.append(detail);
  root.append(board);
}

/** Opening a hit is read-only: select its plan; a task waits for complete current detail, then is revealed once. */
function openHit(vc: ViewContext<Ui>, v: SearchViewState, hit: SearchHitView, task: SearchHitView['task']) {
  search.select(hit.plan.key);
  const previous = vc.ui.selected;
  if (previous && previous !== hit.plan.key) opened = [...opened.filter((k) => k !== previous && k !== hit.plan.key), previous].slice(-RECENT_OPENED);
  openedHit = { key: hit.plan.key, item: task?.id ?? null };
  pendingTask = task ? { key: hit.plan.key, item: task.id, title: task.title, stage: 'search', run: v.run, message: `Search result: ${task.title}` } : null;
  vc.setUi({ selected: hit.plan.key, tab: 'progress', reveal: ++reveals });
}

/** Progress / Document / History of one selected plan (board browsing and search alike). */
function detailPane(detail: HTMLElement, vc: ViewContext<Ui>, plan: PlanView, compareSession: string | null) {
  const { env, ui } = vc;
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
    article.append(planHeader(plan, env));
    // Full-page History only: the digest sits above the existing metadata Revisions.
    const panel = shownDigest = vc.digest(plan);
    if (panel) article.append(digestBlock(panel, env, (item, title) => { pendingTask = { key: plan.key, item, title, stage: 'detail', message: `Current task from History: ${title}` }; panel.announce(`Opening the current task “${title}”…`); }));
    article.append(historyBlock(plan, vc.history(plan), env));
    detail.append(article);
  } else detail.append(planDetail(plan, env, { detail: vc.detail(plan), summary: vc.summary(plan), retryDetail: vc.retry, document: docHooks }, { document: 'omit', compareSession, reading: vc.reading }));
  detail.append(cleanupBlock(vc, plan));
}

function filterBar(filters: Filters, options: { projects: Option[]; worktrees: Option[]; sessions: Option[] }, setFilter: (patch: Partial<Filters>) => void) {
  const bar = testid(el('div', 'ap-filters'), 'filters');
  bar.setAttribute('role', 'group');
  bar.setAttribute('aria-label', 'Filter plans');
  select(bar, 'filter-project', 'Project', filters.project, options.projects, (v) => setFilter({ project: v, worktree: ALL, session: ALL }));
  select(bar, 'filter-worktree', 'Worktree', filters.worktree, options.worktrees, (v) => setFilter({ worktree: v, session: ALL }));
  select(bar, 'filter-session', 'Session', filters.session, options.sessions, (v) => setFilter({ session: v }), true);
  return bar;
}

function currentTask(root: HTMLElement, vc: ViewContext<Ui>) {
  let intent = pendingTask;
  if (!intent) return;
  if (intent.stage === 'search') {
    // Search reveal: the same run and selection, complete current detail, same archive mode.
    const v = searching(vc);
    const request = search.selectedPlan();
    if (!v || v.run !== intent.run || vc.ui.selected !== intent.key || vc.ui.tab !== 'progress' || request?.key !== intent.key) { pendingTask = null; return; }
    const d = vc.detail(request);
    if (!d || d.state === 'loading') return;
    if (d.state === 'error') { pendingTask = null; search.note(v.run, 'The current task list couldn’t be loaded, so the task can’t be shown. Nothing was changed.'); return; }
    const p = selectedPlan(vc);
    if (!p || d.value.revision !== p.revision) return; // wait for this revision's metadata
    if (p.sourceId !== request.sourceId || p.id !== request.id || (p.cleanup?.state === 'archived') !== vc.ui.archived) {
      pendingTask = null; search.note(v.run, `“${intent.title}” can’t be shown here: its plan moved ${vc.ui.archived ? 'out of Archived plans' : 'to Archived plans'}.`); return;
    }
    if (!d.value.items.some((i) => i.kind === 'task' && i.id === intent!.item)) {
      pendingTask = null; search.note(v.run, `“${intent.title}” is no longer in the current plan, so it can’t be shown. The plan stays open to read.`); return;
    }
    intent = pendingTask = { ...intent, stage: 'reveal' };
  }
  const plan = selectedPlan(vc);
  if (!plan || plan.key !== intent.key) { pendingTask = null; return; }
  if (intent.stage === 'detail') {
    if (vc.ui.tab !== 'history') { pendingTask = null; return; }
    const d = vc.detail(plan);
    if (!d || d.state === 'loading') return;
    if (d.state === 'error') { pendingTask = null; shownDigest?.announce('The current task list couldn’t be loaded, so the task can’t be shown. Its recorded changes stay here.'); return; }
    if (d.value.revision !== plan.revision) return; // wait for the list to announce this revision
    if (!d.value.items.some((i) => i.kind === 'task' && i.id === intent.item)) {
      pendingTask = null;
      shownDigest?.announce(`“${intent.title}” is no longer in the current plan, so it can’t be shown there. Its recorded changes stay here.`);
      return;
    }
    pendingTask = { ...intent, stage: 'reveal' };
    vc.setUi({ tab: 'progress' });
    return;
  }
  if (vc.ui.tab !== 'progress') { pendingTask = null; return; }
  const article = [...root.querySelectorAll<HTMLElement>('article.ap-plan[data-reading]')].find((a) => a.dataset.testid === `plan-${plan.id}` && a.dataset.source === plan.sourceId);
  if (!article?.querySelector('.ap-tasks[data-complete]')) return;
  pendingTask = null;
  revealCurrentTask(article, plan, intent.item, intent.message);
}

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
    const place = placeOf(p, env.live, env.boundSource);
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
        const place = placeOf(p, env.live, env.boundSource);
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
