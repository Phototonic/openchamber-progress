import { mountList, mountTabs, type Tone } from '@openchamber/sdk/ui';
import { mountLiveSelect, preserveLiveSelects } from '../shared/live-select.ts';
import { startView, type ViewContext } from '../shared/app.ts';
import {
  button, detailsBlock, documentBlock, el, emptyBlock, failureBlock, failureFacts, historyBlock, languageBlock, loadingBlock, partState, planDetail, planHeader, recordedLabel, retryRead, revealCurrentTask, staleBlock, testid, type Env,
} from '../shared/components.ts';
import type { DigestPanel } from '../shared/change-digest.ts';
import { CaptureController } from '../shared/capture-comparison.ts';
import { captureComparisonBlock } from '../shared/capture-comparison-view.ts';
import { digestBlock } from '../shared/change-digest-view.ts';
import { plural } from '../shared/format.ts';
import { coverageFor, liveLabel, planProject } from '../shared/live.ts';
import { censusFor, planFacts } from '../shared/census.ts';
import { runClaim, subagentsBlock } from '../shared/census-view.ts';
import { lifecycleLabel, summarize, type PlanView, type SearchHitView } from '../shared/model.ts';
import { resolveLanguage, type InterfaceLanguage } from '../shared/i18n.ts';
import {
  ALL, applyFilters, coverageGap, filterOptions, NO_FILTERS, normalizeFilters, pageListScope, partitionBoardPlans, pickPlan, placeOf, projectsFor, searchFilterOptions, type Filters, type Option,
} from '../shared/scope.ts';
import { criteriaKey, queryProblem, searchable, SearchController, type SearchCriteria, type SearchViewState } from '../shared/search.ts';
import {
  announceSearch, boardBar, chipsBlock, NO_DRAFT, resultsBlock, scopeLine, statusLine, unavailableNote, type ChipKind, type SearchDraft,
} from '../shared/search-view.ts';
import { officialMainBlock } from '../shared/official.ts';
import { captureOffNote, initialSetupUi, reloadNote, setupBlock, type SetupUi } from '../shared/setup.ts';
import { cleanupBlock, cleanupNotice } from '../shared/cleanup-view.ts';
import { ReportingHealth } from '../shared/reporting-health.ts';
import { reportingHealthBlock } from '../shared/reporting-health-view.ts';
import { createMapFrame, preserveMapFocus } from '../shared/dependency-map-view.ts';
import { DefaultViewChoice, resolveDefaultView, viewReadingKey } from '../shared/default-view.ts';
import { icon, segmentedBar, statusMark, warningLine, type MarkStatus } from '../shared/primitives.ts';

type Tab = 'progress' | 'document' | 'history' | 'map';
const messages = {
  en: {
    heading: 'Agent progress', current: 'Current plans', archived: 'Archived plans', cleanupOff: 'Plan cleanup is unavailable with this service version.', noArchived: 'No archived plans', noPlans: 'No plans recorded here', archivedHelp: 'Finished plans you archive will appear here. Their history stays available.', plansHelp: 'New reports appear here. Finished work may be in Archived plans.', clear: 'Clear search and filters', detail: 'Plan detail', noMatch: 'No plans match these filters', chooseLocation: 'Choose another project, worktree or session.', truncated: 'Some older plans were not loaded.', truncatedSearch: 'Some older plans were not loaded here. Search checks every recorded plan.',
    missing: (n: number) => n === 1 ? 'Live status is unavailable for 1 plan: its session is not in the current workspace coverage, so it can’t be opened from here.' : `Live status is unavailable for ${n} plans: their sessions are not in the current workspace coverage, so they can’t be opened from here.`,
    otherSource: (n: number) => `${plural(n, 'plan comes', 'plans come')} from another OpenCode setup, so ${n === 1 ? 'it' : 'they'} can be read but not opened from here.`,
    capped: (n: number) => `Live status is limited to the first projects; ${plural(n, 'project is', 'projects are')} not watched.`,
    regrouped: 'The plan moved to Finished, so focus moved to this project’s Finished toggle.', emptyQuery: 'Enter words to search, or choose a plan or task status.', removed: 'Filter removed', ended: 'Search ended. The board shows plans with the remaining filters.', cleared: 'Search cleared', clearedAll: (archived: boolean) => `Search and filters cleared. Showing all ${archived ? 'archived' : 'current'} plans.`, search: 'Search', filter: 'Filter plans', updated: 'Results updated', resumed: 'Search resumed', pick: 'Open a result to read it here', pickHelp: 'Opening a plan or task shows its current plan. It never starts, assigns or completes work.', progress: 'Progress', document: 'Document', history: 'History', map: 'Map', project: 'Project', worktree: 'Worktree', session: 'Session', setup: 'Setup', loaded: 'Plans loaded', watched: 'Live sessions watched', inProgress: 'In progress', active: 'Active', unverified: 'Unverified setup', other: 'Other setup', fromOther: 'from another OpenCode setup', plans: 'Plans', listEmpty: 'No plans match.',
    plansIn: (name: string) => `Plans in ${name}`, finishedIn: (name: string) => `Finished and cancelled plans in ${name}`, finished: (n: number) => `Finished · ${n}`, finishedHelp: (n: number) => `${plural(n, 'finished or cancelled plan', 'finished or cancelled plans')} loaded here. Search finds them too.`,
    searchTask: (title: string) => `Search result: ${title}`, historyTask: (title: string) => `Current task from History: ${title}`, opening: (title: string) => `Opening the current task “${title}”…`, taskFailed: 'The current task list couldn’t be loaded, so the task can’t be shown. Nothing was changed.', taskHistoryFailed: 'The current task list couldn’t be loaded, so the task can’t be shown. Its recorded changes stay here.', taskMoved: (title: string, archived: boolean) => `“${title}” can’t be shown here: its plan moved ${archived ? 'out of Archived plans' : 'to Archived plans'}.`, taskGone: (title: string) => `“${title}” is no longer in the current plan, so it can’t be shown. The plan stays open to read.`, historyGone: (title: string) => `“${title}” is no longer in the current plan, so it can’t be shown there. Its recorded changes stay here.`,
  },
  ru: {
    heading: 'Прогресс агента', current: 'Текущие планы', archived: 'Архивные планы', cleanupOff: 'Очистка планов недоступна в этой версии сервиса.', noArchived: 'Архивных планов нет', noPlans: 'Здесь пока нет записанных планов', archivedHelp: 'Здесь появятся завершённые планы, которые вы архивируете. Их история останется доступной.', plansHelp: 'Здесь появляются новые отчёты. Завершённая работа может находиться в архивных планах.', clear: 'Очистить поиск и фильтры', detail: 'Подробности плана', noMatch: 'Нет планов по этим фильтрам', chooseLocation: 'Выберите другой проект, рабочую копию или сессию.', truncated: 'Некоторые старые планы не загружены.', truncatedSearch: 'Некоторые старые планы не загружены здесь. Поиск проверяет все записанные планы.',
    missing: (n: number) => `Планов без живого статуса: ${n}. Их сессии не входят в охват текущего рабочего пространства, поэтому открыть их отсюда нельзя.`, otherSource: (n: number) => `Планов из другой установки OpenCode: ${n}. Их можно читать, но нельзя открыть отсюда.`, capped: (n: number) => `Живой статус ограничен первыми проектами; не отслеживается проектов: ${n}.`,
    regrouped: 'План перемещён в завершённые, поэтому фокус перенесён на переключатель завершённых планов этого проекта.', emptyQuery: 'Введите слова для поиска или выберите статус плана или задачи.', removed: 'Фильтр удалён', ended: 'Поиск завершён. Показаны планы с оставшимися фильтрами.', cleared: 'Поиск очищен', clearedAll: (archived: boolean) => `Поиск и фильтры очищены. Показаны все ${archived ? 'архивные' : 'текущие'} планы.`, search: 'Поиск', filter: 'Фильтрация планов', updated: 'Результаты обновлены', resumed: 'Поиск возобновлён', pick: 'Откройте результат, чтобы прочитать его здесь', pickHelp: 'Открытие плана или задачи показывает текущий план. Это не запускает, не назначает и не завершает работу.', progress: 'Прогресс', document: 'Документ', history: 'История', map: 'Карта', project: 'Проект', worktree: 'Рабочая копия', session: 'Сессия', setup: 'Настройка', loaded: 'Загружено планов', watched: 'Отслеживаемые живые сессии', inProgress: 'В работе', active: 'Активен', unverified: 'Непроверенная установка', other: 'Другая установка', fromOther: 'из другой установки OpenCode', plans: 'Планы', listEmpty: 'Подходящих планов нет.',
    plansIn: (name: string) => `Планы проекта ${name}`, finishedIn: (name: string) => `Завершённые и отменённые планы проекта ${name}`, finished: (n: number) => `Завершённые · ${n}`, finishedHelp: (n: number) => `Загружено завершённых или отменённых планов: ${n}. Поиск также находит их.`,
    searchTask: (title: string) => `Результат поиска: ${title}`, historyTask: (title: string) => `Текущая задача из истории: ${title}`, opening: (title: string) => `Открываем текущую задачу «${title}»…`, taskFailed: 'Не удалось загрузить текущие задачи, поэтому показать задачу нельзя. Ничего не изменено.', taskHistoryFailed: 'Не удалось загрузить текущие задачи, поэтому показать задачу нельзя. Её записанные изменения остаются здесь.', taskMoved: (title: string, archived: boolean) => `Нельзя показать «${title}»: её план ${archived ? 'восстановлен из архива' : 'перемещён в архив'}.`, taskGone: (title: string) => `Задачи «${title}» больше нет в текущем плане, поэтому показать её нельзя. План остаётся открытым для чтения.`, historyGone: (title: string) => `Задачи «${title}» больше нет в текущем плане, поэтому показать её там нельзя. Её записанные изменения остаются здесь.`,
  },
} satisfies Record<InterfaceLanguage, Record<string, string | ((...args: never[]) => string)>>;
const copy = (locale: string) => messages[resolveLanguage('auto', locale)];
type Problem = { kind: 'query'; q: string } | { kind: 'empty' };
/** A submitted search: `owner` is the account + store/binding it was submitted under. */
type Submitted = { key: string; owner: string; criteria: SearchCriteria };
/**
 * `reveal`: token of an explicit list selection whose detail is scrolled into view once (narrow layout).
 * `search`: the submitted board search (null: ordinary browsing); `draft`: its unsubmitted selects.
 */
type Ui = { filters: Filters; selected: string | null; tab: Tab; reveal: number; setup: SetupUi; archived: boolean; search: Submitted | null; draft: SearchDraft; problem: Problem | null };

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
let pendingTask: { key: string; item: string; title: string; stage: 'detail' | 'reveal' | 'search'; run?: number; origin: 'search' | 'history' } | null = null;
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
const captures = new CaptureController({ service: current => frame!.service(current), visible: () => document.visibilityState !== 'hidden', changed: () => frame?.setUi({}) });
const reporting = new ReportingHealth({service:current=>frame!.service(current),visible:()=>document.visibilityState!=='hidden',changed:()=>frame?.setUi({}),copy:async text=>{if(!navigator.clipboard?.writeText)throw new Error('Clipboard unavailable');await navigator.clipboard.writeText(text);}});
function draftText(vc: ViewContext<Ui>) {
  if (text.owner !== ownerOf(vc)) text = { owner: ownerOf(vc), q: '' };
  return text.q;
}
const setText = (vc: ViewContext<Ui>, q: string) => { text = { owner: ownerOf(vc), q }; };
const say = (message: string) => announceSearch(--notices, message);
/**
 * Owning heading of the board's list region (docs/ui.md Board search): Search results while
 * searching, Plans while browsing. Actions whose control leaves the paint hand focus to it once.
 */
const regionHeading = (root: HTMLElement) => root.querySelector<HTMLElement>('[data-testid="search-results-heading"], [data-testid="plan-list-heading"]');
const toRegion = (vc: ViewContext<Ui>, key: 'removed' | 'cleared' | 'updated' | 'resumed') => vc.handoff({ heading: regionHeading, notice: (_heading, locale = vc.env.locale) => copy(locale)[key] });

/** Whether the controller still runs this frame identity's submitted search (cheap: no view). */
function isSearching(vc: ViewContext<Ui>) {
  const s = vc.ui.search;
  return !!s && !!vc.read && vc.health?.planTaskSearch === 1 && s.owner === ownerOf(vc) && search.key === s.key;
}
/** The submitted search of this frame identity, when the controller still runs it. */
const searching = (vc: ViewContext<Ui>): SearchViewState | null => (isSearching(vc) ? search.view(resolveLanguage('auto', vc.env.locale)) : null);

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
/** The board's own reading scope (filters or search run; never the host session). */
function readingScope(vc: ViewContext<Ui>) {
  const v = searching(vc);
  return v ? `board-search:${v.run}` : `board:${JSON.stringify([vc.ui.archived, vc.ui.filters])}`;
}
/** Fourth tab: the dependency map of the selected plan. View as list returns to Progress in this frame. */
const viewChoice = new DefaultViewChoice();
const chooseTab = (vc: ViewContext<Ui>, tab: Tab) => {
  const plan = selectedPlan(vc) ?? (isSearching(vc) ? search.selectedPlan() : null);
  if (plan) viewChoice.choose(viewReadingKey(vc, readingScope(vc), plan), tab === 'progress' ? 'list' : tab);
  vc.setUi({ tab });
};
const boardMap = createMapFrame<Ui>('board', (vc) => chooseTab(vc, 'progress'));
const progressTab = (root: HTMLElement) => root.querySelector<HTMLElement>('[data-testid="detail-tabs"] [role="tab"][data-id="progress"]');

/**
 * Frame-local board disclosures (docs/ui.md Fullscreen page): never stored, never per plan.
 * `finished`: open Finished folds by exact project key, for one board reading (account + store/
 * binding, Current/Archived, board filters, submitted search). `filtersOpen`: the Filters panel,
 * for one account + store/binding and mode, so choosing a location inside it keeps it open.
 * `reveal`: the last explicit selection already given a chance to open its fold.
 */
const board = { key: '', finished: new Map<string, boolean>(), filtersKey: '', filtersOpen: false, reveal: 0 };
let boardEpoch = 0;
/** Where focus goes once after the next paint (the control that acted was replaced). */
let boardFocus: { to: 'trigger' | 'panel' } | { to: 'fold'; project: string; notice?: 'regrouped' } | null = null;
function boardFor(vc: ViewContext<Ui>) {
  const owner = ownerOf(vc);
  const key = JSON.stringify([owner, vc.ui.archived, vc.ui.filters, vc.ui.search?.key ?? null]);
  if (key !== board.key) { board.key = key; board.finished = new Map(); }
  const filtersKey = JSON.stringify([owner, vc.ui.archived]);
  if (filtersKey !== board.filtersKey) { board.filtersKey = filtersKey; board.filtersOpen = false; }
  return board;
}
function resetBoard() { boardEpoch++; board.key = ''; board.finished = new Map(); board.filtersKey = ''; board.filtersOpen = false; board.reveal = 0; boardFocus = null; }
// An outside press may focus/activate another control in this same root. Keep
// that native target connected through click delivery, then dismiss without a
// focus command. Keyboard focus departure still dismisses immediately.
let outsideFiltersPress: string | null = null;
document.addEventListener('pointerdown', (event) => {
  outsideFiltersPress = null;
  if (!board.filtersOpen) return;
  const owner = document.querySelector('.ap-filters-owner');
  if (owner && event.target instanceof Node && owner.contains(event.target)) return;
  outsideFiltersPress = board.filtersKey;
}, true);
const endFiltersPress = () => {
  const key = outsideFiltersPress;
  if (key === null) return;
  requestAnimationFrame(() => {
    if (outsideFiltersPress !== key) return;
    outsideFiltersPress = null;
    if (board.filtersKey === key && board.filtersOpen) {
      board.filtersOpen = false; boardFocus = null;
      // The outside click may just have opened another SDK popup. Close only
      // Filters, not the root/control that received that click.
      const owner = document.querySelector<HTMLElement>('[data-live-popup]');
      if (owner?.dataset.livePopup === key) {
        const panel = owner.querySelector<HTMLElement>('[data-testid="board-filters"]');
        if (panel) panel.hidden = true;
        owner.querySelector('[data-testid="board-filters-trigger"]')?.setAttribute('aria-expanded', 'false');
      }
    }
  });
};
document.addEventListener('pointerup', endFiltersPress, true);
document.addEventListener('pointercancel', endFiltersPress, true);
window.addEventListener('blur', endFiltersPress);

// Fullscreen board: every plan in the connected store, filtered by project/worktree/session.
startView<Ui>({
  surface: 'page',
  maxSessionSubscriptions: 16,
  initialUi: () => ({ filters: NO_FILTERS, selected: null, tab: 'progress', reveal: 0, setup: initialSetupUi(), archived: false, search: null, draft: NO_DRAFT, problem: null }),
  prepareUi: (vc) => {
    const plan = selectedPlan(vc) ?? (isSearching(vc) ? search.selectedPlan() : null);
    const decision = resolveDefaultView(viewChoice, vc, readingScope(vc), plan);
    const tab = decision.view === 'list' ? 'progress' : decision.view;
    return vc.ui.tab === tab ? null : { tab };
  },
  scope: (_ctx, ui) => ({ ...pageListScope(ui.filters), archived: ui.archived ? 'only' : 'exclude' }),
  actionPlan: selectedPlan,
  forgetPlans: (keys, ui) => { if (!keys.has(ui.selected ?? '')) return {}; captures.retire(); reporting.retire(); search.select(null); return { selected: null }; },
  beforeUiChange: (previous, next) => {
    if (JSON.stringify([previous.filters, previous.search?.key]) !== JSON.stringify([next.filters, next.search?.key])) boardEpoch++;
    if (previous.archived !== next.archived) resetBoard();
    const scope = (u: Ui) => JSON.stringify([u.selected,u.tab,u.archived,u.filters,u.search?.key ?? null]);
    if (scope(previous) !== scope(next)) { captures.retire(); reporting.retire(); }
  },
  // The selected plan's coordinator project first: its observed sub-agents (page root, never the host session).
  wantProjects: (vc) => {
    if (!vc.read) return [];
    const p = selectedPlan(vc);
    const own = p && trusted(p, vc.env) ? planProject(p.ownerSessionId, p.directory, vc.live) : undefined;
    return [...new Set([...(own ? [own.id] : []), ...projectsFor(vc.read.plans, vc.live, vc.directory, vc.env.boundSource)])];
  },
  wantDetails: (vc) => {
    if (isSearching(vc)) { const request = search.selectedPlan(); return request && request.key === vc.ui.selected ? [request] : []; }
    const p = selectedPlan(vc); return p && (vc.ui.tab === 'progress' || vc.ui.tab === 'map' || pendingTask?.key === p.key) ? [p] : [];
  },
  // Task reading follows the board's own scope and selection (never the host session); the
  // Progress/Document/History/Map tabs of one selection share it. A search run is its own scope.
  reading: (vc) => {
    const p = selectedPlan(vc); if (!p) return null;
    return { plan: p.key, scope: readingScope(vc) };
  },
  // While results are shown, the poll revalidates them (and the selection) instead of the list.
  freshness: (vc) => (isSearching(vc) && search.freshKeys().length ? (service) => search.revalidate(service) : null),
  // An unsettled map re-pins its graph on the existing refresh cadence (no extra poller); no hook without a shown map.
  get refreshed() { return boardMap.refreshed; },
  retire: (reason) => { if (reason !== 'hidden') { viewChoice.reset(); resetBoard(); } captures.retire(); reporting.retire(); boardMap.retire(reason); if (reason === 'reset') search.retire(); else if (reason === 'hidden') search.hidden(); else search.dispose(); },
  // Search run + selection, also for plans outside the loaded list: a change retires their part reads.
  partsKey: (vc) => (isSearching(vc) ? JSON.stringify([vc.ui.search!.key, vc.ui.selected]) : null),
  // While searching, part caches hold the selection and the few results opened just before it.
  retainParts: (vc) => (isSearching(vc) ? new Set([...opened, ...(vc.ui.selected ? [vc.ui.selected] : [])]) : null),
  paint(root, vc) {
    frame = vc;
    captures.beginPaint();
    const { read, failure, env, ui } = vc;
    const t = copy(env.locale);
    const old = document.getElementById('ap-search-q') as HTMLInputElement | null;
    caret = old && document.activeElement === old ? [old.selectionStart, old.selectionEnd] : null;
    if (!ui.search && search.active) search.clear();
    // The map belongs to the selected plan's reading; graph work runs only while Map is the shown tab.
    const mapPlan = read ? selectedPlan(vc) : null;
    boardMap.sync(vc, mapPlan, readingScope(vc), ui.tab === 'map' && !!mapPlan);
    root.append(el('h1', 'ap-sr', t.heading));
    const modes = testid(el('div', 'ap-row'), 'cleanup-modes');
    const mode = (archived: boolean) => { endSearch(); vc.setUi({ archived, selected: null, filters: NO_FILTERS, reveal: 0, search: null, draft: NO_DRAFT, problem: null }); };
    button(modes, 'cleanup-visible', t.current, () => mode(false), ui.archived ? 'ghost' : 'outline');
    button(modes, 'cleanup-archived', t.archived, () => mode(true), ui.archived ? 'outline' : 'ghost', vc.health?.ready === true && !vc.health.planCleanup);
    modes.querySelectorAll('button').forEach((b, i) => b.setAttribute('aria-pressed', String(i === (ui.archived ? 1 : 0))));
    const notice = cleanupNotice(vc);
    const cleanupOff = vc.health?.ready && !vc.health.planCleanup ? testid(el('p', 'ap-note', t.cleanupOff), 'cleanup-unavailable') : null;
    // The official-main notice does not depend on companion setup or the store.
    const official = officialMainBlock(vc);
    if (!read) {
      root.append(modes);
      if (notice) root.append(notice);
      if (cleanupOff) root.append(cleanupOff);
      if (failure) root.append(failureBlock(failure, retryRead(vc), env.locale));
      else if (vc.health && !vc.health.ready) { if (official) root.append(official); root.append(setupBlock(vc)); }
      else if (!(ui.archived && vc.health?.ready && !vc.health.planCleanup)) root.append(loadingBlock(env.locale));
      footer(root, vc, null);
      return;
    }
    const capable = vc.health?.planTaskSearch === 1;
    const v = capable ? searching(vc) : null;
    if (v) search.membership(env.live);
    const empty = !v && !read.plans.length && ui.filters.session === ALL;
    // Location selects live in Filters: browsing applies them on choice, a search reruns with them.
    let locations: HTMLElement | null = null;
    const filters = normalizeFilters(read.plans, env.live, ui.filters, env.boundSource);
    if (v) {
      const c = v.criteria;
      const f = { project: c.project, worktree: c.worktree, session: c.session };
      // Choices: live locations plus those this frame has seen; never a full-library census.
      const options = searchFilterOptions([...read.plans, ...v.page.hits.map((h) => h.plan)], env.live, f, c.labels, env.boundSource, env.locale);
      locations = filterBar(f, options, (patch) => { const next = { ...f, ...patch }; runSearch(vc, { ...c, ...next, labels: labelsFor(vc, next, c.labels, options.sessions.find(o => o.id === next.session)) }); }, env.locale);
    } else if (!empty) {
      const setFilter = (patch: Partial<Filters>) => vc.setUi({ filters: { ...filters, ...patch }, reveal: 0 });
      locations = filterBar(filters, filterOptions(read.plans, env.live, filters, read.plans, env.boundSource, env.locale), setFilter, env.locale);
    }
    // The bar first (Current / Archived, search, Filters); concrete states right below it.
    root.append(boardTop(vc, v, modes, locations, capable));
    if (notice) root.append(notice);
    if (cleanupOff) root.append(cleanupOff);
    if (failure && vc.lastGoodAt) root.append(staleBlock(failure, vc.lastGoodAt, env.locale, retryRead(vc)));
    const reload = reloadNote(vc);
    if (reload) root.append(reload);
    if (official) root.append(official);
    if (!read.captureEnabled) {
      const note = captureOffNote(vc.setup, env.locale);
      const p = testid(warningLine(note.text), 'capture-off');
      p.dataset.reason = note.reason;
      root.append(p);
    }
    if (v) { root.append(searchStrip(v)); searchBoard(root, vc, v); footer(root, vc, selectedPlan(vc)); return; }
    if (empty) {
      root.append(emptyBlock('empty-state', ui.archived ? t.noArchived : t.noPlans, ui.archived ? t.archivedHelp : t.plansHelp));
      footer(root, vc, null);
      return;
    }
    if (filters.project !== ALL || filters.worktree !== ALL || filters.session !== ALL) {
      const row = testid(el('div', 'ap-search-chips'), 'search-chips');
      button(row, 'search-clear', t.clear, clearAll, 'ghost');
      root.append(row);
    }

    const visible = applyFilters(read.plans, env.live, filters, env.boundSource);
    const plan = pickPlan(visible, ui.selected);
    const b = boardFor(vc);
    // An explicit selection of a plan inside a closed Finished fold opens that fold once (never on polls).
    if (ui.reveal && ui.reveal !== b.reveal) {
      b.reveal = ui.reveal;
      if (plan && !ui.archived && (plan.lifecycle === 'completed' || plan.lifecycle === 'cancelled')) b.finished.set(placeOf(plan, env.live, env.boundSource).projectKey, true);
    }
    const board = el('div', 'ap-board');
    board.append(planList(visible, plan, env, (key) => vc.setUi({ selected: key, reveal: ++reveals }), ui.archived, b));
    const detail = testid(el('section', 'ap-detail'), 'plan-detail');
    detail.setAttribute('aria-label', t.detail);
    if (plan) detailPane(detail, vc, plan, filters.session);
    else detail.append(emptyBlock('filtered-empty', t.noMatch, t.chooseLocation));
    board.append(detail);
    root.append(board);

    const gap = coverageGap(visible, env.live, env.boundSource);
    const notes: string[] = [];
    if (gap.missing) notes.push(t.missing(gap.missing));
    if (gap.otherSource) notes.push(t.otherSource(gap.otherSource));
    if (gap.capped) notes.push(t.capped(gap.capped));
    if (read.truncated) notes.push(capable ? t.truncatedSearch : t.truncated);
    if (notes.length) {
      const note = testid(el('div', 'ap-note'), 'coverage-note');
      for (const n of notes) note.append(el('p', '', n));
      root.append(note);
    }
    footer(root, vc, plan);
  },
  // An explicit selection reveals its detail once; later paints (polls, task jumps) never scroll back to it.
  afterPaint(root, vc) {
    captures.endPaint();
    const input = root.querySelector<HTMLInputElement>('#ap-search-q');
    if (caret && input && document.activeElement === input) input.setSelectionRange(caret[0], caret[1]);
    currentTask(root, vc);
    boardMap.afterPaint(root, vc, vc.read ? selectedPlan(vc) : null, progressTab);
    // Once: the Filters trigger or heading after it closed or opened, or a fold's own toggle (its
    // shared hook would otherwise restore to the first project's).
    const f = boardFocus;
    boardFocus = null;
    if (f) {
      const target = f.to === 'trigger' ? root.querySelector<HTMLElement>('[data-testid="board-filters-trigger"]')
        : f.to === 'panel' ? root.querySelector<HTMLElement>('#ap-board-filters-h')
        : [...root.querySelectorAll<HTMLElement>('[data-testid="board-finished-toggle"]')].find((n) => n.dataset.project === (f.to === 'fold' ? f.project : '')) ?? null;
      target?.focus({ preventScroll: true });
      if (f.to === 'fold' && f.notice && target && document.activeElement === target) say(copy(vc.env.locale)[f.notice]);
    }
    if (!vc.ui.reveal || vc.ui.reveal === revealed) return;
    revealed = vc.ui.reveal;
    if (window.matchMedia('(min-width: 820px)').matches) return;
    root.querySelector('[data-testid="plan-detail"]')?.scrollIntoView({ block: 'start' });
  },
  preserveFocus: (previous, next) => { preserveMapFocus(previous, next); preserveLiveSelects(previous, next); focusRegroupedPlan(previous, next); },
});

/** A poll may move a pointer-focused active row into a closed Finished fold.
 * Preserve the user's fold choice; hand focus to its toggle once instead of
 * asking the generic restorer to focus the hidden replacement row.
 */
function focusRegroupedPlan(previous: HTMLElement, next: HTMLElement) {
  const active = previous.ownerDocument.activeElement as HTMLElement | null;
  if (!document.hasFocus() || !active?.matches('[data-testid^="plan-row-"][data-source][data-lifecycle="active"]') || !previous.contains(active) || active.closest('[hidden]')) return;
  const before = active.closest<HTMLElement>('[data-testid="plan-list"]');
  const list = next.querySelector<HTMLElement>('[data-testid="plan-list"]');
  if (!before || !list || before.dataset.boardReading !== list.dataset.boardReading) return;
  const row = [...list.querySelectorAll<HTMLElement>('[data-testid^="plan-row-"][data-source]')].find(n => n.dataset.testid === active.dataset.testid && n.dataset.source === active.dataset.source);
  const fold = row?.closest<HTMLElement>('[data-testid="board-finished"][hidden]');
  if (!fold?.dataset.project || (row?.dataset.lifecycle !== 'completed' && row?.dataset.lifecycle !== 'cancelled')) return;
  boardFocus = { to: 'fold', project: fold.dataset.project, notice: 'regrouped' };
}

const trusted = (p: PlanView, env: Env) => env.boundSource !== null && p.sourceId === env.boundSource;

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
  if (!searchable(criteria)) { vc.setUi({ problem: { kind: 'empty' } }); return; }
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
function labelsFor(vc: ViewContext<Ui>, f: Filters, previous: SearchCriteria['labels'] = {}, selectedSession?: Option): SearchCriteria['labels'] {
  // Location names omit unavailable decoration; session names retain the selected option's origin.
  const options = (part: keyof Filters) => searchFilterOptions(vc.read?.plans ?? [], vc.env.live, { ...f, [part]: ALL }, previous, vc.env.boundSource, vc.env.locale);
  const name = (list: Option[], id: string, old?: string) => (id === ALL ? undefined : list.find((x) => x.id === id)?.label ?? old);
  const session = selectedSession ?? searchFilterOptions(vc.read?.plans ?? [], vc.env.live, f, previous, vc.env.boundSource, vc.env.locale).sessions.find((x) => x.id === f.session);
  const titled = f.session !== ALL && session && !session.sessionGenerated;
  const retainedTitle = previous.sessionId === f.session && !previous.sessionGenerated ? previous.session : undefined;
  const labels: SearchCriteria['labels'] = {
    project: name(options('project').projects, f.project, previous.project),
    worktree: name(options('worktree').worktrees, f.worktree, previous.worktree),
    session: f.session === ALL ? undefined : titled ? session?.label : retainedTitle ?? session?.label,
  };
  if (f.session !== ALL) {
    labels.sessionId = f.session;
    if (!titled && !retainedTitle) labels.sessionGenerated = true;
  }
  return labels;
}

function submitDraft() {
  const vc = frame;
  if (!vc?.read) return;
  const q = draftText(vc);
  const problem = queryProblem(q, vc.env.locale);
  if (problem) { vc.setUi({ problem: { kind: 'query', q } }); return; }
  const f = boardFilters(vc);
  const d = vc.ui.draft;
  runSearch(vc, { q: q.trim(), source: d.source, lifecycle: d.lifecycle, status: d.status, ...f, archived: vc.ui.archived, labels: labelsFor(vc, f, vc.ui.search?.criteria.labels) });
}

/** Removing a chip is a deliberate widening: the rest is searched again, or browsing resumes. */
function removeChip(kind: ChipKind) {
  const vc = frame;
  const c = vc ? searching(vc)?.criteria : null;
  if (!vc || !c) return;
  toRegion(vc, 'removed');
  const next: SearchCriteria = { ...c, labels: { ...c.labels } };
  if (kind === 'q') { next.q = ''; setText(vc, ''); }
  else if (kind === 'project') { next.project = ALL; next.worktree = ALL; }
  else next[kind] = ALL;
  if (searchable(next)) { if (kind !== 'q') setText(vc, next.q); runSearch(vc, next); return; }
  endSearch();
  vc.setUi({ search: null, filters: { project: next.project, worktree: next.worktree, session: next.session }, draft: NO_DRAFT, problem: null, selected: null, reveal: 0 });
  say(copy(vc.env.locale).ended);
}
function clearAll() {
  const vc = frame;
  if (!vc) return;
  toRegion(vc, 'cleared');
  endSearch();
  vc.setUi({ search: null, filters: NO_FILTERS, draft: NO_DRAFT, problem: null, selected: null, reveal: 0 });
  say(copy(vc.env.locale).clearedAll(vc.ui.archived));
}

/**
 * The board bar: Current / Archived, the search field and Filters (docs/ui.md Board search). A
 * service without search keeps Current / Archived and Filters with the location selects only.
 */
function boardTop(vc: ViewContext<Ui>, v: SearchViewState | null, modes: HTMLElement, locations: HTMLElement | null, capable: boolean) {
  const b = boardFor(vc);
  const filtersKey = b.filtersKey;
  const epoch = boardEpoch;
  const submitted = v?.criteria ?? null;
  const draft = vc.ui.draft;
  const f = submitted ?? vc.ui.filters;
  const active = (capable ? [draft.lifecycle, draft.status, draft.source].filter((x) => x !== ALL).length : 0) + [f.project, f.worktree, f.session].filter((x) => x !== ALL).length;
  // Every callback is bound to the Filters identity it was painted under.
  const setOpen = (open: boolean, focus: 'trigger' | 'panel' | null) => {
    if (!area.isConnected || board.filtersKey !== filtersKey || boardEpoch !== epoch) return;
    if (!open && focus === null && outsideFiltersPress === filtersKey) return;
    if (board.filtersOpen === open && focus === null) return;
    board.filtersOpen = open; boardFocus = focus ? { to: focus } : null; frame?.updateUi(() => ({}));
  };
  const area = testid(el('section', 'ap-search-area'), capable ? 'search' : 'board-bar');
  area.setAttribute('aria-label', capable ? copy(vc.env.locale).search : copy(vc.env.locale).filter);
  area.append(boardBar({
    current: () => area.isConnected && board.filtersKey === filtersKey && boardEpoch === epoch,
    modes, locations, active, open: b.filtersOpen, setOpen,
    scope: capable ? scopeLine(submitted, vc.ui.archived, vc.env.locale) : null,
    search: capable ? {
      text: () => draftText(vc), setText: (q) => setText(vc, q),
      draft, setDraft: (patch) => { if (area.isConnected && board.filtersKey === filtersKey && boardEpoch === epoch) vc.updateUi((u) => ({ draft: { ...u.draft, ...patch } })); },
      // Search from inside Filters closes it and returns focus to its trigger; Enter in the field keeps Filters as it is.
      submit: () => {
        if (!area.isConnected || board.filtersKey !== filtersKey || boardEpoch !== epoch) return;
        const fromPanel = !!document.activeElement?.closest('#ap-board-filters');
        if (fromPanel) { board.filtersOpen = false; boardFocus = { to: 'trigger' }; }
        submitDraft();
        if (fromPanel) frame?.updateUi(() => ({}));
      },
      submitted, problem: vc.ui.problem ? (vc.ui.problem.kind === 'query' ? queryProblem(vc.ui.problem.q, vc.env.locale) : copy(vc.env.locale).emptyQuery) : null, sources: vc.read?.sources ?? [], archived: vc.ui.archived,
    } : null,
  }, vc.env.locale));
  const popup = area.querySelector<HTMLElement>('[data-live-popup]');
  if (popup) popup.dataset.livePopup = filtersKey;
  if (!capable) area.append(unavailableNote(vc.env.locale));
  return area;
}

/** While searching: the removable constraint chips and the last explicit outcome, outside Filters. */
function searchStrip(v: SearchViewState) {
  const vc = frame!;
  const strip = el('div', 'ap-search-strip');
  const unavailable = new Set<ChipKind>();
  for (const part of v.blockedParts) unavailable.add(part);
  if (v.criteria.source !== ALL && !vc.read?.sources.some((s) => s.id === v.criteria.source)) unavailable.add('source');
  strip.append(chipsBlock(v.criteria, unavailable, { remove: removeChip, clearAll }, vc.env.locale), statusLine(v, vc.env.locale));
  return strip;
}

function searchBoard(root: HTMLElement, vc: ViewContext<Ui>, v: SearchViewState) {
  const { env, ui } = vc;
  const c = v.criteria;
  const board = el('div', 'ap-board');
  board.append(resultsBlock(v, env, {
    selected: openedHit && openedHit.key === ui.selected ? openedHit : null,
    openPlan: (hit) => openHit(vc, v, hit, null),
    openTask: (hit) => openHit(vc, v, hit, hit.task),
    more: () => { toRegion(vc, 'updated'); search.more(); },
    retry: () => { toRegion(vc, 'resumed'); if (v.blocked) runSearch(vc, c); else search.more(); },
    refresh: () => runSearch(vc, c),
    page: (delta) => { search.showPage(delta); vc.retry(); },
    removeLocation: (part) => removeChip(part),
    clearAll,
  }));
  const detail = testid(el('section', 'ap-detail'), 'plan-detail');
  detail.setAttribute('aria-label', copy(env.locale).detail);
  const request = search.selectedPlan();
  const plan = selectedPlan(vc);
  if (plan) detailPane(detail, vc, plan, c.session !== ALL ? c.session : null);
  else if (request && request.key === ui.selected) {
    const d = vc.detail(request);
    detail.append(partState('detail-loading', env.locale === 'ru' ? 'план' : 'plan', d?.state === 'error' ? d : null, vc.retry, env.locale));
  } else detail.append(emptyBlock('search-pick', copy(env.locale).pick, copy(env.locale).pickHelp));
  board.append(detail);
  root.append(board);
}

/** Opening a hit is read-only: select its plan; a task waits for complete current detail, then is revealed once. */
function openHit(vc: ViewContext<Ui>, v: SearchViewState, hit: SearchHitView, task: SearchHitView['task']) {
  search.select(hit.plan.key);
  const previous = vc.ui.selected;
  if (previous && previous !== hit.plan.key) opened = [...opened.filter((k) => k !== previous && k !== hit.plan.key), previous].slice(-RECENT_OPENED);
  openedHit = { key: hit.plan.key, item: task?.id ?? null };
  pendingTask = task ? { key: hit.plan.key, item: task.id, title: task.title, stage: 'search', run: v.run, origin: 'search' } : null;
  const request = search.selectedPlan();
  if (request) {
    const key = viewReadingKey(vc, readingScope(vc), request);
    viewChoice.identify(key);
    if (task) viewChoice.choose(key, 'list');
  }
  vc.setUi({ selected: hit.plan.key, tab: 'progress', reveal: ++reveals });
}

/** Progress / Document / History of one selected plan (board browsing and search alike). */
function detailPane(detail: HTMLElement, vc: ViewContext<Ui>, plan: PlanView, compareSession: string | null) {
  const { env, ui } = vc;
  const t = copy(env.locale);
  const tabs = testid(el('div', 'ap-detail-tabs'), 'detail-tabs');
  mountTabs(tabs, {
    items: [{ id: 'progress', label: t.progress }, { id: 'document', label: t.document }, { id: 'history', label: t.history }, { id: 'map', label: t.map }],
    activeId: ui.tab,
    // D8 wiring (S2-H): the active tab comes from the frame's default-view decision (Progress or
    // Map), and every actual tab activation records the explicit choice, including re-activating
    // the provisional Progress tab (a changed-value callback alone does not see that).
    onChange: (id) => { captures.retire(); if (id === 'map') boardMap.enter(); else if (ui.tab === 'map') boardMap.leave(); chooseTab(vc, id as Tab); },
  });
  // SDK changed-value callbacks omit reactivation of the provisional Progress tab.
  // Record that real activation too, before any late complete detail can settle D8.
  const reselect = (event: Event) => {
    if (event instanceof KeyboardEvent && event.key !== 'Enter' && event.key !== ' ') return;
    const tab = (event.target as Element).closest<HTMLElement>('[role="tab"][data-id]');
    if (tab?.dataset.id === ui.tab) chooseTab(vc, ui.tab);
  };
  tabs.addEventListener('click', reselect, true);
  tabs.addEventListener('keydown', reselect, true);
  // The Map tab owns a pending List → Map task handoff while focus stays on it (like the rail's switch).
  tabs.querySelector('[role="tab"][data-id="map"]')?.setAttribute('data-map-focus-owner', '');
  detail.append(tabs);
  const docHooks = { get: () => vc.document(plan), request: () => vc.requestDocument(plan) };
  // One run visit for this plan's verified coordinator, shared by the separate roster and map cards.
  const runRequest = vc.read && (ui.tab === 'progress' || ui.tab === 'map') ? runClaim(vc.read, plan.ownerSessionId, plan) : null;
  const runs = runRequest && trusted(plan, env) ? vc.runs(runRequest) : null;
  const census = trusted(plan, env) ? censusFor(plan.ownerSessionId, plan.directory, vc.live) : null;
  const roster = () => (census && vc.read ? subagentsBlock({
    surface: 'page', plan, census, facts: planFacts(plan, vc.detail(plan), env.boundSource),
    runs, verified: true, currentSession: null, liveSeq: vc.live.seq, env,
  }) : null);
  if (ui.tab === 'map') {
    const host = testid(el('div', 'ap-map-host'), 'map-host');
    detail.append(host);
    boardMap.paint(host, vc, { plan, scope: readingScope(vc), runs: runRequest ? { request: runRequest.request, panel: runs } : null, census: censusFor(plan.ownerSessionId, plan.directory, vc.live) });
    const r = roster(); if (r) detail.append(r);
  } else if (ui.tab === 'document') {
    const article = testid(el('article', 'ap-plan'), `plan-${plan.id}`);
    article.dataset.source = plan.sourceId;
    article.append(planHeader(plan, env), documentBlock(plan, env, 'inline', docHooks));
    if (vc.read) article.append(captureComparisonBlock(captures.claim({
      owner: JSON.stringify([ownerOf(vc),vc.ui.search?.key ?? null,vc.ui.filters]),
      request: { storeId: vc.read.storeId, binding: vc.read.binding, source: plan.sourceId, plan: plan.id, cleanupRev: plan.cleanup?.revision ?? 0 },
      revision: plan.revision, capable: vc.health?.documentCaptureComparison === 1,
    }), env.locale));
    detail.append(article);
  } else if (ui.tab === 'history') {
    const article = testid(el('article', 'ap-plan'), `plan-${plan.id}`);
    article.dataset.source = plan.sourceId;
    vc.requestHistory(plan);
    article.append(planHeader(plan, env));
    // Full-page History only: the digest sits above the existing metadata Revisions.
    const panel = shownDigest = vc.digest(plan);
    if (panel) article.append(digestBlock(panel, env, (item, title) => { pendingTask = { key: plan.key, item, title, stage: 'detail', origin: 'history' }; panel.announce({ kind: 'message', en: messages.en.opening(title), ru: messages.ru.opening(title) }); }));
    article.append(historyBlock(plan, vc.history(plan), env));
    detail.append(article);
  } else {
    // D8 wiring (S2-H): pass `pending: true` while this reading's default view is undecided, so
    // only the loading placeholder paints (no complete rows) until Progress or Map is settled.
    const article = planDetail(plan, env, { detail: vc.detail(plan), summary: vc.summary(plan), retryDetail: vc.retry, document: docHooks }, { document: 'omit', compareSession, reading: vc.reading, pending: viewChoice.current.pending });
    // An explicit task focus/reveal or pointer selection here is what the Map tab opens on.
    boardMap.listTargets(article);
    detail.append(article);
    // Rooted in this plan's verified coordinator session; a plan from another setup borrows nothing.
    const r = roster(); if (r) detail.append(r);
  }
  detail.append(cleanupBlock(vc, plan));
}

function filterBar(filters: Filters, options: { projects: Option[]; worktrees: Option[]; sessions: Option[] }, setFilter: (patch: Partial<Filters>) => void, locale: string) {
  const t = copy(locale);
  const bar = testid(el('div', 'ap-filters'), 'filters');
  bar.setAttribute('role', 'group');
  bar.setAttribute('aria-label', t.filter);
  select(bar, 'filter-project', t.project, filters.project, options.projects, (v) => setFilter({ project: v, worktree: ALL, session: ALL }));
  select(bar, 'filter-worktree', t.worktree, filters.worktree, options.worktrees, (v) => setFilter({ worktree: v, session: ALL }));
  select(bar, 'filter-session', t.session, filters.session, options.sessions, (v) => setFilter({ session: v }), true);
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
    if (d.state === 'error') { pendingTask = null; search.note(v.run, { kind: 'message', en: messages.en.taskFailed, ru: messages.ru.taskFailed }); return; }
    const p = selectedPlan(vc);
    if (!p || d.value.revision !== p.revision) return; // wait for this revision's metadata
    if (p.sourceId !== request.sourceId || p.id !== request.id || (p.cleanup?.state === 'archived') !== vc.ui.archived) {
      pendingTask = null; search.note(v.run, { kind: 'message', en: messages.en.taskMoved(intent.title, vc.ui.archived), ru: messages.ru.taskMoved(intent.title, vc.ui.archived) }); return;
    }
    if (!d.value.items.some((i) => i.kind === 'task' && i.id === intent!.item)) {
      pendingTask = null; search.note(v.run, { kind: 'message', en: messages.en.taskGone(intent.title), ru: messages.ru.taskGone(intent.title) }); return;
    }
    intent = pendingTask = { ...intent, stage: 'reveal' };
  }
  const plan = selectedPlan(vc);
  if (!plan || plan.key !== intent.key) { pendingTask = null; return; }
  if (intent.stage === 'detail') {
    if (vc.ui.tab !== 'history') { pendingTask = null; return; }
    const d = vc.detail(plan);
    if (!d || d.state === 'loading') return;
    if (d.state === 'error') { pendingTask = null; shownDigest?.announce({ kind: 'message', en: messages.en.taskHistoryFailed, ru: messages.ru.taskHistoryFailed }); return; }
    if (d.value.revision !== plan.revision) return; // wait for the list to announce this revision
    if (!d.value.items.some((i) => i.kind === 'task' && i.id === intent.item)) {
      pendingTask = null;
      shownDigest?.announce({ kind: 'message', en: messages.en.historyGone(intent.title), ru: messages.ru.historyGone(intent.title) });
      return;
    }
    pendingTask = { ...intent, stage: 'reveal' };
    chooseTab(vc, 'progress');
    return;
  }
  if (vc.ui.tab !== 'progress') { pendingTask = null; return; }
  const article = [...root.querySelectorAll<HTMLElement>('article.ap-plan[data-reading]')].find((a) => a.dataset.testid === `plan-${plan.id}` && a.dataset.source === plan.sourceId);
  if (!article?.querySelector('.ap-tasks[data-complete]')) return;
  pendingTask = null;
  revealCurrentTask(article, plan, intent.item, intent.origin === 'search' ? copy(vc.env.locale).searchTask(intent.title) : copy(vc.env.locale).historyTask(intent.title));
}

/** Footer zone: collapsed Setup and Details, after the progress story. */
function footer(root: HTMLElement, vc: ViewContext<Ui>, plan: PlanView | null) {
  const t = copy(vc.env.locale);
  const zone = el('div', 'ap-footer');
  const setup = testid(el('details', 'ap-details'), 'setup-section');
  setup.append(el('summary', '', t.setup));
  const body = el('div');
  const fill = () => { body.replaceChildren(setupBlock(vc)); };
  // Filled once per painted disclosure: the browser's own queued `toggle` after the repaint's synchronous
  // one must not rebuild it, which would drop focus placed in it (e.g. a confirmation's Cancel).
  setup.addEventListener('toggle', () => { if (setup.open && !body.firstChild) { if (!vc.setup) vc.requestSetup(); fill(); } });
  setup.append(body);
  zone.append(reportingHealthBlock(reporting.claim({key:JSON.stringify([ownerOf(vc),vc.read?.storeId,vc.read?.binding,vc.read?.captureEnabled,!!vc.failure,plan?.key,vc.ui.filters,vc.ui.archived,vc.ui.search?.key??null]),read:vc.read,plan,stale:!!vc.failure}), vc.env.locale));
  zone.append(setup, detailsBlock(vc.read, plan, [
    [t.loaded, String(vc.read?.plans.length ?? 0)],
    [t.watched, String(vc.sessionSubscriptions)],
    ...failureFacts(vc.failure, vc.env.locale),
  ], vc.env));
  zone.append(languageBlock(vc.language, vc.env.locale));
  root.append(zone);
}

function select(parent: Element, id: string, label: string, value: string, options: Option[], onChange: (v: string) => void, searchable = false) {
  const holder = testid(el('div'), id);
  const epoch = boardEpoch;
  mountLiveSelect(holder, { label, value, options, onChange, searchable: searchable && options.length > 8 }, () => boardEpoch === epoch);
  parent.append(holder);
}

/** A plan's status at a glance: one mark shape per lifecycle (and reported work), named. */
function planMark(p: PlanView, locale: string) {
  const t = copy(locale);
  const kind: MarkStatus = p.lifecycle === 'completed' ? 'done' : p.lifecycle === 'cancelled' ? 'skipped' : p.lifecycle === 'failed' ? 'blocked' : p.working.length ? 'working' : 'pending';
  const label = p.lifecycle === 'active' ? (p.working.length ? t.inProgress : t.active) : lifecycleLabel(p.lifecycle, resolveLanguage('auto', locale));
  const mark = statusMark(kind, { label, className: 'ap-plan-mark', locale });
  mark.dataset.plan = p.lifecycle;
  return mark;
}

/**
 * One project's rows in the kit listbox (keyboard, active descendant, selection), each with its
 * mark, title, whole-plan done/total and a decorative mini bar. Location, owner session and live
 * state are part of the row's name; a closed lifecycle, another or unverified setup stay visible
 * as badges.
 */
function planRows(plans: PlanView[], selected: PlanView | null, env: Env, onSelect: (key: string) => void, label: string) {
  const t = copy(env.locale);
  const holder = el('div', 'ap-plan-rows');
  mountList(holder, {
    ariaLabel: label,
    // Partitions retain this scoped read's objects. A matching key from another
    // list/read must not seed an SDK active option that this list cannot own.
    selectedId: selected && plans.includes(selected) ? selected.key : null,
    onSelect,
    items: plans.map((p) => {
      const s = summarize(p);
      const other = env.boundSource === null || p.sourceId !== env.boundSource;
      const badge: { label: string; tone: Tone } | undefined = p.lifecycle === 'failed' ? { label: lifecycleLabel('failed', env.locale), tone: 'error' }
        : p.lifecycle === 'cancelled' ? { label: lifecycleLabel('cancelled', env.locale), tone: 'neutral' }
        : env.unverifiedSources.has(p.sourceId) ? { label: t.unverified, tone: 'warning' }
        : other ? { label: t.other, tone: 'neutral' } : undefined;
      return { id: p.key, title: p.title, meta: s.total ? `${s.done}/${s.total}` : '—', badge };
    }),
  });
  const rows = holder.querySelectorAll<HTMLElement>('[role="option"]');
  plans.forEach((p, i) => {
    const row = rows[i];
    if (!row) return;
    row.dataset.testid = `plan-row-${p.id}`;
    row.dataset.source = p.sourceId;
    row.dataset.lifecycle = p.lifecycle;
    row.prepend(planMark(p, env.locale));
    const main = row.querySelector<HTMLElement>('.oc-sdk-row-main');
    if (!main) return;
    const s = summarize(p);
    const bar = segmentedBar(s, '');
    if (bar) {
      // Decorative: the row's done/total says it; no second progress-bar hook per row.
      delete bar.dataset.testid;
      bar.removeAttribute('role');
      bar.removeAttribute('aria-label');
      bar.setAttribute('aria-hidden', 'true');
      bar.classList.add('ap-mini-bar');
      main.append(bar);
    }
    const place = placeOf(p, env.live, env.boundSource, env.locale);
    const trustedPlan = trusted(p, env);
    const live = trustedPlan ? liveLabel(coverageFor(p.ownerSessionId, p.directory, env.live), env.locale).label : t.fromOther;
    main.append(el('span', 'ap-sr', `, ${place.worktreeLabel}, ${recordedLabel(p, env)(p.ownerSessionId)}, ${live}`));
  });
  return holder;
}

/**
 * Plans by project. In Current plans each project's Finished and Cancelled plans fold into one
 * "Finished · N" disclosure (D7; failed plans stay prominent); Archived plans shows every row.
 * Folds belong to this board reading; collapsing never deselects, archives or filters.
 */
function planList(plans: PlanView[], selected: PlanView | null, env: Env, onSelect: (key: string) => void, archived: boolean, b: typeof board) {
  const t = copy(env.locale);
  const wrap = testid(el('nav', 'ap-plan-list'), 'plan-list');
  wrap.setAttribute('aria-label', t.plans);
  wrap.dataset.scrollKey = 'plan-list';
  // Owning heading of the list region (focus target after Clear all and similar; never a Tab stop).
  const heading = testid(el('h2', 'ap-region-h', t.plans), 'plan-list-heading');
  heading.tabIndex = -1;
  wrap.append(heading);
  const groups = new Map<string, { label: string; plans: PlanView[] }>();
  for (const p of plans) {
    const place = placeOf(p, env.live, env.boundSource, env.locale);
    const g = groups.get(place.projectKey) ?? { label: place.projectLabel, plans: [] };
    g.plans.push(p);
    groups.set(place.projectKey, g);
  }
  const boardKey = b.key;
  wrap.dataset.boardReading = boardKey;
  let index = 0;
  for (const [key, g] of groups) {
    const n = index++;
    const section = testid(el('section', 'ap-section ap-board-project'), 'board-project');
    section.dataset.project = key;
    section.append(el('h3', 'ap-h', g.label));
    const { current, finished } = partitionBoardPlans(g.plans, archived);
    if (current.length) section.append(planRows(current, selected, env, onSelect, t.plansIn(g.label)));
    if (finished.length) {
      const open = b.finished.get(key) ?? false;
      const id = `ap-finished-${n}`;
      const toggle = testid(el('button', 'ap-fold-toggle'), 'board-finished-toggle');
      toggle.type = 'button';
      toggle.dataset.project = key;
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-controls', id);
      toggle.append(icon('chevron-down'), el('span', '', t.finished(finished.length)));
      const note = el('span', 'ap-sr', t.finishedHelp(finished.length));
      note.id = `${id}-note`;
      toggle.setAttribute('aria-describedby', note.id);
      toggle.addEventListener('click', () => {
        if (board.key !== boardKey) return;
        board.finished.set(key, !open);
        boardFocus = { to: 'fold', project: key };
        frame?.updateUi(() => ({}));
      });
      const fold = testid(el('div', 'ap-board-fold'), 'board-finished');
      fold.id = id;
      fold.dataset.project = key;
      fold.hidden = !open;
      fold.append(planRows(finished, selected, env, onSelect, t.finishedIn(g.label)));
      section.append(toggle, note, fold);
    }
    wrap.append(section);
  }
  if (!plans.length) wrap.append(testid(el('p', 'ap-note', t.listEmpty), 'list-empty'));
  return wrap;
}
