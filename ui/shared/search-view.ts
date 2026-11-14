// Board search DOM (docs/ui.md "Search"): the labelled form, explicit scope, chips, honest counts and
// coverage, grouped results and explicit actions. Untrusted titles land through textContent only.
import { mountSearchField, mountSpinner, type SelectOption } from '@openchamber/sdk/ui';
import { mountLiveSelect } from './live-select.ts';
import { button, el, emptyBlock, failureCopy, glyph, planLocation, testid, type Env } from './components.ts';
import { EMPTY_LIVE, sessionLabel } from './live.ts';
import { icon } from './primitives.ts';
import { formatCount, plural } from './format.ts';
import { lifecycleLabel, statusLabel, type ItemStatus, type Lifecycle, type SearchHitView, type SearchPlanView, type SourceView } from './model.ts';
import { ALL } from './scope.ts';
import { blockedText, breadcrumb, narrowed, queryProblem, searchStatusText, type LocationPart, type SearchCriteria, type SearchGroup, type SearchViewState } from './search.ts';
import { resolveLanguage, type InterfaceLanguage } from './i18n.ts';

const EN = {
  searchPlans: 'Search plans and tasks', searchTitles: 'Search titles and IDs', searchHint: 'Search titles and IDs', filters: 'Filters', close: 'Close', planStatus: 'Plan status', anyPlan: 'Any plan status', taskStatus: 'Task status', anyTask: 'Any task status', source: 'Recorded source', allSources: 'All recorded sources', unverified: 'unverified', unavailable: 'not available here', search: 'Search', constraints: 'Search constraints', clear: 'Clear search and filters', results: 'Search results', retry: 'Retry', removeProject: 'Remove project filter', removeWorktree: 'Remove worktree filter', searching: 'Searching recorded plans', noMatch: 'No plans or tasks match', uncertain: 'No matches in the plans and locations that could be checked', tryOther: 'Try other words, or remove a constraint. Filters and Clear search stay above.', noneYet: 'No matches found yet; more recorded plans remain unchecked.', previous: 'Previous results', next: 'Next results', busy: 'Searching…', refresh: 'Refresh search', more: 'Load more results', continue: 'Continue searching', help: 'Every word must appear in the same plan’s or task’s own title or ID, in any order. Capitalization is ignored; accents are not (café and cafe differ).', apply: 'Plan status, task status and source apply when you search. Location choices apply right away.', pending: 'Not searched yet: these results are for the previous search. Press Search to update them.', unavailableService: 'Search is unavailable with this service version. The board below still lists plans as before.', allPlans: 'all recorded plans in this store', archived: 'archived plans only', current: 'current plans (archived plans excluded)', location: 'in the chosen project or worktree', sessionScope: 'where the chosen session is the owner, linked or a recorded contributor', scopeNote: 'Ordinary board list pages are not the search scope.', words: 'Words', sourceChip: 'Source', project: 'Project', worktree: 'Worktree', session: 'Session', remove: 'Remove', continued: 'Continued from the previous results', planMatch: 'The plan’s own title or ID matches', changed: 'Changed since found', openPlan: 'Open plan', showTask: 'Show task', inside: 'In', setup: 'unverified setup', noTasks: 'no counted tasks', exhausted: 'Every recorded plan in this scope was checked, as searched; reports may change, so this is not a live census.', partial: 'More recorded plans remain unchecked. Counts so far are not totals.', checking: 'Checking that these earlier results are still current…',
};
const COPY = { en: EN, ru: {
  searchPlans: 'Поиск планов и задач', searchTitles: 'Поиск по названиям и ID', searchHint: 'Поиск', filters: 'Фильтры', close: 'Закрыть', planStatus: 'Статус плана', anyPlan: 'Любой статус плана', taskStatus: 'Статус задачи', anyTask: 'Любой статус задачи', source: 'Записанный источник', allSources: 'Все записанные источники', unverified: 'не подтверждён', unavailable: 'недоступно здесь', search: 'Найти', constraints: 'Условия поиска', clear: 'Очистить поиск и фильтры', results: 'Результаты поиска', retry: 'Повторить', removeProject: 'Убрать фильтр проекта', removeWorktree: 'Убрать фильтр рабочего дерева', searching: 'Поиск записанных планов', noMatch: 'Нет подходящих планов или задач', uncertain: 'Нет совпадений среди проверенных планов и расположений', tryOther: 'Попробуйте другие слова или уберите условие. Фильтры и очистка поиска остаются выше.', noneYet: 'Совпадений пока нет; ещё не все записанные планы проверены.', previous: 'Предыдущие результаты', next: 'Следующие результаты', busy: 'Поиск…', refresh: 'Обновить поиск', more: 'Загрузить ещё результаты', continue: 'Продолжить поиск', help: 'Каждое слово должно присутствовать в собственном названии или ID одного плана или задачи, в любом порядке. Регистр не учитывается; диакритика учитывается (café и cafe различаются).', apply: 'Статусы плана, задачи и источник применяются при поиске. Расположения применяются сразу.', pending: 'Поиск ещё не выполнен: это результаты предыдущего поиска. Нажмите «Найти» для обновления.', unavailableService: 'Эта версия сервиса не поддерживает поиск. Список планов ниже работает как прежде.', allPlans: 'всех записанных планов в этом хранилище', archived: 'только архивные планы', current: 'текущие планы (без архивных)', location: 'в выбранном проекте или рабочем дереве', sessionScope: 'где выбранная сессия — владелец, связанная сессия или записанный участник', scopeNote: 'Обычные страницы списка планов не ограничивают область поиска.', words: 'Слова', sourceChip: 'Источник', project: 'Проект', worktree: 'Рабочее дерево', session: 'Сессия', remove: 'Убрать', continued: 'Продолжение предыдущих результатов', planMatch: 'Совпадает собственное название или ID плана', changed: 'Изменилось после поиска', openPlan: 'Открыть план', showTask: 'Показать задачу', inside: 'В', setup: 'настройка не подтверждена', noTasks: 'нет учитываемых задач', exhausted: 'Все записанные планы этой области проверены на момент поиска; отчёты могут меняться, это не живая перепись.', partial: 'Ещё не все записанные планы проверены. Промежуточные числа не являются итоговыми.', checking: 'Проверка актуальности предыдущих результатов…',
} } satisfies Record<InterfaceLanguage, typeof EN>;

export interface SearchDraft { lifecycle: Lifecycle | typeof ALL; status: ItemStatus | typeof ALL; source: string }
export const NO_DRAFT: SearchDraft = { lifecycle: ALL, status: ALL, source: ALL };

/** Constraint a chip removes. Archive mode is the board's own visible choice, never a chip. */
export type ChipKind = 'q' | 'source' | 'lifecycle' | 'status' | 'project' | 'worktree' | 'session';

export interface SearchFormHooks {
  /** Text being edited (not yet searched); survives repaints. */
  text: () => string;
  setText: (q: string) => void;
  draft: SearchDraft;
  setDraft: (patch: Partial<SearchDraft>) => void;
  submit: () => void;
  /** The submitted criteria, or null while browsing. */
  submitted: SearchCriteria | null;
  problem: string | null;
  sources: SourceView[];
  archived: boolean;
}

const LIFECYCLES: Lifecycle[] = ['active', 'completed', 'cancelled', 'failed'];
const STATUSES: ItemStatus[] = ['pending', 'working', 'blocked', 'done', 'skipped'];

/** Whether the form differs from what the shown results were searched for. */
export const draftDiffers = (text: string, draft: SearchDraft, c: SearchCriteria | null) =>
  !!c && (text.trim() !== c.q.trim() || draft.lifecycle !== c.lifecycle || draft.status !== c.status || draft.source !== c.source);

export interface BoardBarHooks {
  /** Reject input from a synchronously retired board paint. */
  current?: () => boolean;
  /** Current plans / Archived plans, always visible beside the search field. */
  modes: HTMLElement;
  /** The search form's hooks; null when this service can't search (only the location filters remain). */
  search: SearchFormHooks | null;
  /** Project / worktree / session selects (immediate browse commit or search rerun), or null. */
  locations: HTMLElement | null;
  /** How many constraints the Filters panel holds now (drafts and locations), for its trigger. */
  active: number;
  /** The explicit scope line (search-scope), shown inside Filters with the help. */
  scope: HTMLElement | null;
  open: boolean;
  /** Open or close the Filters panel; `focus`: where focus goes after the repaint. */
  setOpen: (open: boolean, focus: 'trigger' | 'panel' | null) => void;
}

/**
 * The board bar (docs/ui.md Board search): Current / Archived, one labelled search field and a
 * Filters trigger. Typing changes only the draft (no request, no repaint); Enter in the field
 * submits, never during IME composition. No document-level key handling. Filters is a nonmodal
 * dialog in normal Tab order after its trigger: plan and task status and recorded source (drafts
 * until Search), the location selects (applied on choice), the help and the explicit scope, and
 * Search. It stays in the document while closed (`hidden`), so the field keeps its description.
 */
export function boardBar(h: BoardBarHooks, locale = 'en') {
  const language = resolveLanguage('auto', locale), copy = COPY[language];
  const bar = el('div', 'ap-board-bar');
  bar.append(h.modes);
  const s = h.search;
  const form = testid(el(s ? 'form' : 'div', 'ap-search'), s ? 'search-form' : 'board-filter-bar');
  if (form instanceof HTMLFormElement && s) {
    form.setAttribute('role', 'search');
    form.setAttribute('aria-label', copy.searchPlans);
    form.noValidate = true;
    form.addEventListener('submit', (event) => { event.preventDefault(); s.submit(); });
  }
  const row = el('div', 'ap-search-row');
  let pending = () => {};
  if (s) {
    const field = el('div', 'ap-search-field');
    // Named for assistive technology; the placeholder is a shorter visible hint that fits a phone-width field.
    const label = el('label', 'ap-search-label ap-sr', copy.searchTitles);
    label.htmlFor = 'ap-search-q';
    const holder = testid(el('div'), 'search-query');
    mountSearchField(holder, { value: s.text(), label: copy.searchTitles, placeholder: copy.searchHint, onChange: (q) => { s.setText(q); pending(); } });
    const input = holder.querySelector('input');
    if (input) {
      input.id = 'ap-search-q';
      // The frame's draft text is authoritative (Clear all empties it): no generic typed-field restore.
      input.setAttribute('aria-describedby', 'ap-search-help');
      input.maxLength = 1024;
      input.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        // Enter commits an IME composition; it never submits then.
        if (event.isComposing || event.keyCode === 229) return;
        event.preventDefault();
        s.submit();
      });
    }
    field.append(label, holder);
    row.append(field);
  }
  // The Filters owner holds trigger and panel together (the frame's live-popup seam).
  const owner = el('div', 'ap-filters-owner');
  owner.dataset.livePopup = '';
  const trigger = testid(el('button', 'ap-filters-trigger'), 'board-filters-trigger');
  trigger.type = 'button';
  trigger.setAttribute('aria-haspopup', 'dialog');
  trigger.setAttribute('aria-expanded', String(h.open));
  trigger.setAttribute('aria-controls', 'ap-board-filters');
   trigger.append(icon('filter'), el('span', '', copy.filters));
  if (h.active) { const n = el('span', 'ap-filters-count', language === 'ru' ? formatCount(h.active, language) : String(h.active)); n.setAttribute('aria-hidden', 'true'); trigger.append(n); }
   trigger.setAttribute('aria-label', h.active ? (language === 'ru' ? `Фильтры, активно: ${formatCount(h.active, language)}` : `Filters, ${h.active} active`) : copy.filters);
  trigger.addEventListener('click', () => {
    // Outside pointer dismissal can hide this owner without rebuilding it, so
    // the live expanded state, not this paint's captured `h.open`, is current.
    const open = trigger.getAttribute('aria-expanded') !== 'true';
    h.setOpen(open, open ? 'panel' : null);
  });
  const panel = testid(el('div', 'ap-filters-panel'), 'board-filters');
  panel.id = 'ap-board-filters';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'false');
  panel.setAttribute('aria-labelledby', 'ap-board-filters-h');
  panel.hidden = !h.open;
  const head = el('div', 'ap-filters-head');
  const title = el('h2', 'ap-filters-h', copy.filters);
  title.id = 'ap-board-filters-h';
  title.tabIndex = -1;
  head.append(title);
  button(head, 'board-filters-close', copy.close, () => h.setOpen(false, 'trigger'), 'ghost');
  panel.append(head);
  const grid = el('div', 'ap-filters-grid');
  if (s) {
    const pick = (id: string, name: string, value: string, options: SelectOption[], set: (v: string) => void) => {
      const box = testid(el('div'), id);
      mountLiveSelect(box, { label: name, value, options, onChange: (v) => { set(v); } }, h.current);
      grid.append(box);
    };
    pick('search-lifecycle', copy.planStatus, s.draft.lifecycle, [{ id: ALL, label: copy.anyPlan }, ...LIFECYCLES.map((l) => ({ id: l, label: lifecycleLabel(l, language) }))], (v) => s.setDraft({ lifecycle: v as SearchDraft['lifecycle'] }));
    pick('search-task-status', copy.taskStatus, s.draft.status, [{ id: ALL, label: copy.anyTask }, ...STATUSES.map((t) => ({ id: t, label: statusLabel(t, language) }))], (v) => s.setDraft({ status: v as SearchDraft['status'] }));
    if (s.sources.length > 1 || s.draft.source !== ALL) {
      const known = s.sources.some((x) => x.id === s.draft.source);
      pick('search-source', copy.source, s.draft.source, [{ id: ALL, label: copy.allSources }, ...s.sources.map((x) => ({ id: x.id, label: x.verified ? x.id : `${x.id} (${copy.unverified})` })), ...(known || s.draft.source === ALL ? [] : [{ id: s.draft.source, label: `${s.draft.source} (${copy.unavailable})` }])], (v) => s.setDraft({ source: v }));
    }
  }
  if (h.locations) grid.append(h.locations);
  panel.append(grid);
  if (s) {
    const help = testid(el('p', 'ap-note ap-search-help', copy.help), 'search-help');
    help.id = 'ap-search-help';
    panel.append(help);
  }
  if (h.scope) panel.append(h.scope);
  if (s) {
    const foot = el('div', 'ap-filters-foot');
    foot.append(el('p', 'ap-note', copy.apply));
    const submit = el('div', 'ap-search-submit');
    button(submit, 'search-submit', copy.search, () => { s.submit(); }, 'default');
    foot.append(submit);
    panel.append(foot);
  }
  // Escape closes and returns to the trigger, unless a select inside used the key for its own popup.
  panel.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); h.setOpen(false, 'trigger'); } });
  // Focus moving to a control outside dismisses without taking focus back (an outside press is
  // handled by the owner of the frame's single document listener).
  owner.addEventListener('focusout', (event) => {
    const next = (event as FocusEvent).relatedTarget;
    if (h.open && next instanceof Node && !owner.contains(next)) h.setOpen(false, null);
  });
  owner.append(trigger, panel);
  row.append(owner);
  form.append(row);
  bar.append(form);
  const box = el('div', 'ap-board-bar-wrap');
  box.append(bar);
  if (s?.problem) {
    const p = testid(el('p', 'ap-doc-warn', queryProblem(s.text(), language) ?? s.problem), 'search-problem');
    p.setAttribute('role', 'alert');
    box.append(p);
  }
  if (s) {
    // Visible outside the closed Filters: the shown results are for an earlier search.
    const edit = testid(el('p', 'ap-note', copy.pending), 'search-pending-edit');
    box.append(edit);
    pending = () => { edit.hidden = !draftDiffers(s.text(), s.draft, s.submitted); };
    pending();
  }
  return box;
}

const sourceText = (c: Pick<SearchCriteria, 'source'>, language: InterfaceLanguage) => (c.source === ALL ? COPY[language].allPlans : language === 'ru' ? `планов, записанных источником ${c.source}` : `plans recorded by source ${c.source}`);
/** What is searched, in words; stays visible with zero, failed or unavailable results. */
export function scopeText(c: SearchCriteria, locale = 'en') {
  const language = resolveLanguage('auto', locale), copy = COPY[language];
  const parts = [`${language === 'ru' ? 'Поиск' : 'Searching'} ${sourceText(c, language)}`, c.archived ? copy.archived : copy.current];
  if (narrowed(c)) parts.push(copy.location);
  if (c.session !== ALL) parts.push(copy.sessionScope);
  return `${parts.join(', ')}. ${copy.scopeNote}`;
}
export function scopeLine(c: SearchCriteria | null, archived: boolean, locale = 'en') {
  const language = resolveLanguage('auto', locale);
  const p = testid(el('p', 'ap-note ap-search-scope'), 'search-scope');
  p.textContent = c ? scopeText(c, language) : language === 'ru' ? `Поиск проверяет ${archived ? 'все архивные планы' : 'все текущие планы'}, записанные в хранилище, а не только перечисленные ниже.` : `Search checks ${archived ? 'every archived plan' : 'every current plan'} recorded in this store, not only the plans listed below.`;
  return p;
}

export interface ChipHooks { remove: (kind: ChipKind) => void; clearAll: () => void }
export function chipLabel(kind: ChipKind, c: SearchCriteria, locale = 'en') {
  const language = resolveLanguage('auto', locale), copy = COPY[language];
  if (kind === 'q') return `${copy.words}: ${c.q.trim()}`;
  if (kind === 'source') return `${copy.sourceChip}: ${c.source}`;
  if (kind === 'lifecycle') return `${copy.planStatus}: ${lifecycleLabel(c.lifecycle as Lifecycle, language)}`;
  if (kind === 'status') return `${copy.taskStatus}: ${statusLabel(c.status as ItemStatus, language)}`;
  if (kind === 'project') return `${copy.project}: ${c.labels.project ?? c.project}`;
  if (kind === 'worktree') return `${copy.worktree}: ${c.worktree.startsWith('root:') ? (language === 'ru' ? 'Основная рабочая копия' : 'Main checkout') : c.labels.worktree ?? c.worktree}`;
  return `${copy.session}: ${c.labels.sessionGenerated ? sessionLabel(c.session, EMPTY_LIVE, language) : c.labels.session ?? c.session}`;
}
export const chipsOf = (c: SearchCriteria): ChipKind[] => (['q', 'source', 'lifecycle', 'status', 'project', 'worktree', 'session'] as ChipKind[]).filter((k) => (k === 'q' ? c.q.trim() !== '' : c[k] !== ALL));

/** One removable chip per submitted constraint, then Clear search and filters. */
export function chipsBlock(c: SearchCriteria, unavailable: ReadonlySet<ChipKind>, h: ChipHooks, locale = 'en') {
  const language = resolveLanguage('auto', locale), copy = COPY[language];
  const wrap = testid(el('div', 'ap-search-chips'), 'search-chips');
  wrap.setAttribute('role', 'group');
  wrap.setAttribute('aria-label', copy.constraints);
  const list = el('ul', 'ap-chip-list');
  for (const kind of chipsOf(c)) {
    const li = testid(el('li', 'ap-search-chip'), `search-chip-${kind}`);
    if (unavailable.has(kind)) li.dataset.available = 'false';
    const b = el('button', 'ap-chip-remove');
    b.type = 'button';
    const text = chipLabel(kind, c, language);
    const x = el('span', 'ap-chip-x', '×');
    x.setAttribute('aria-hidden', 'true');
    b.append(el('span', '', unavailable.has(kind) ? `${text} (${copy.unavailable})` : text), x);
    b.setAttribute('aria-label', `${copy.remove} ${text}`);
    b.addEventListener('click', () => h.remove(kind));
    li.append(b);
    list.append(li);
  }
  wrap.append(list);
  button(wrap, 'search-clear', copy.clear, h.clearAll, 'ghost');
  return wrap;
}

let announcer: HTMLElement | null = null;
let announced = 0;
let announcedText = '';
let announcement = 0;
/**
 * One persistent polite region outside the repainted root speaks each explicit outcome once, never
 * per poll or unchanged repaint; language changes refresh its text (new live regions are unreliable).
 */
export function announceSearch(id: number, text: string) {
  if (!id || !text || (id === announced && text === announcedText)) return;
  announced = id;
  announcedText = text;
  const version = ++announcement;
  if (!announcer?.isConnected) {
    announcer = testid(el('p', 'ap-sr'), 'search-announcer');
    announcer.setAttribute('role', 'status'); announcer.setAttribute('aria-live', 'polite'); announcer.setAttribute('aria-atomic', 'true');
    document.body.append(announcer);
  }
  const node = announcer;
  node.textContent = '';
  requestAnimationFrame(() => { if (announcement === version) node.textContent = announcedText; });
}

const plansText = (n: number) => plural(n, 'plan', 'plans');
const tasksText = (n: number) => plural(n, 'matching task', 'matching tasks');

/** Matched plans / matching tasks (accumulated) apart from this page's shown results and context rows. */
export function countsBlock(v: SearchViewState, language: InterfaceLanguage = 'en') {
  const box = testid(el('div', 'ap-search-counts'), 'search-counts');
  const final = v.exhausted && v.countsCurrent && !v.coverage.gapped && !v.stop;
  Object.assign(box.dataset, { matchedPlans: String(v.counts.matchedPlans), matchingTasks: String(v.counts.matchingTasks), shown: String(v.page.hits.length), context: String(v.page.contextRows), final: String(final), current: String(v.countsCurrent) });
  const found = language === 'ru' ? `Планов: ${formatCount(v.counts.matchedPlans, language)} · подходящих задач: ${formatCount(v.counts.matchingTasks, language)}` : `${plansText(v.counts.matchedPlans)} · ${tasksText(v.counts.matchingTasks)}`;
  const lead = language === 'ru' ? `${!v.countsCurrent ? 'Подсчитано до изменения результатов' : final ? 'Найдено' : v.exhausted ? 'Найдено в проверенных планах' : 'Пока найдено'}: ${found}` : !v.countsCurrent ? `Counted before results changed: ${found}` : final ? `Found: ${found}` : v.exhausted ? `Found in the plans that could be checked: ${found}` : `Found so far: ${found}`;
  box.append(el('p', 'ap-search-found', lead));
  const shown = v.page.hits.length;
  box.append(el('p', 'ap-note', language === 'ru' ? `Показано результатов: ${formatCount(shown, language)}, страница ${formatCount(v.page.number, language)}${v.page.contextRows ? ` · строк групп или родителей для контекста: ${formatCount(v.page.contextRows, language)}` : ''}. Числа выполненных и всех задач ниже всегда относятся ко всему плану.` : `Showing ${plural(shown, 'result', 'results')} on page ${v.page.number}${v.page.contextRows ? ` · ${plural(v.page.contextRows, 'group or parent row', 'group or parent rows')} for context` : ''}. Plan done/total counts below always cover the whole plan.`));
  return box;
}

/** Record-scan completeness, skipped records, location interpretation and change qualifiers, kept apart. */
export function coverageBlock(v: SearchViewState, language: InterfaceLanguage = 'en') {
  const copy = COPY[language], ru = language === 'ru';
  const box = testid(el('div', 'ap-note ap-search-coverage'), 'search-coverage');
  box.dataset.state = v.exhausted ? (v.coverage.gapped ? 'gapped' : 'exhausted') : 'partial';
  if (v.coverage.gapped) box.dataset.gapped = 'true';
  const lines: string[] = [];
  lines.push(v.exhausted ? copy.exhausted : copy.partial);
  if (v.coverage.gapped) lines.push(ru ? `Некоторые записанные планы не удалось прочитать (нечитаемы или слишком велики), и они пропущены${v.coverage.skippedRecords ? ` (пока: ${formatCount(v.coverage.skippedRecords, language)})` : ''}, поэтому поиск неполон.` : `Some recorded plans couldn’t be read (unreadable or too large) and were skipped${v.coverage.skippedRecords ? ` (${v.coverage.skippedRecords} so far)` : ''}, so this search is incomplete.`);
  if (narrowed(v.criteria)) {
    // "Searched all" only once the scan is exhausted; a partial scan qualifies locations alone.
    const lead = v.exhausted ? 'Searched all recorded plans; project' : 'Project';
    lines.push(ru ? `${v.exhausted ? 'Проверены все записанные планы; принадлежность' : 'Принадлежность'} к проекту определяется только известными этому окну расположениями${v.discoveryIncomplete ? ', а некоторые здесь ещё неизвестны' : ''}.` : `${lead} membership is limited to locations this window knows${v.discoveryIncomplete ? ', and some are still unknown here' : ''}.`);
  }
  if (v.removed) lines.push(ru ? `Результатов удалено из выдачи из-за архивации, восстановления или удаления планов: ${formatCount(v.removed, language)}.` : `${plural(v.removed, 'result was', 'results were')} removed because ${v.removed === 1 ? 'its plan was' : 'their plans were'} archived, restored or deleted.`);
  if (v.changedKeys) lines.push(ru ? `Планов изменилось после поиска: ${formatCount(v.changedKeys, language)}.` : `${plural(v.changedKeys, 'plan has', 'plans have')} changed since ${v.changedKeys === 1 ? 'it was' : 'they were'} found.`);
  if (!v.page.checked) lines.push(copy.checking);
  for (const line of lines) box.append(el('p', '', line));
  return box;
}

export interface ResultHooks {
  selected: { key: string; item: string | null } | null;
  openPlan: (hit: SearchHitView) => void;
  openTask: (hit: SearchHitView) => void;
}

const hitMeta = (plan: SearchPlanView, env: Env) => {
  const language = resolveLanguage('auto', env.locale), copy = COPY[language], ru = language === 'ru';
  const parts = [plan.id, planLocation({ ...plan, working: [], document: { state: 'unavailable', checklistSynchronized: false, currentFile: 'not-rechecked' } }, env.live, env.boundSource, language)];
  if (plan.lifecycle !== 'active') parts.push(lifecycleLabel(plan.lifecycle, language));
  if (env.boundSource === null || plan.sourceId !== env.boundSource) parts.push(`${ru ? 'источник' : 'source'} ${plan.sourceId}`);
  if (!plan.sourceVerified) parts.push(copy.setup);
  parts.push(plan.counts.total ? `${ru ? formatCount(plan.counts.done, language) : plan.counts.done}/${ru ? formatCount(plan.counts.total, language) : plan.counts.total} ${ru ? 'выполнено (весь план)' : 'done (whole plan)'}` : copy.noTasks);
  return parts.join(' · ');
};

function groupBlock(g: SearchGroup, env: Env, h: ResultHooks) {
  const language = resolveLanguage('auto', env.locale), copy = COPY[language], ru = language === 'ru';
  const section = testid(el('section', 'ap-hit-group'), `search-group-${g.plan.sourceId}/${g.plan.id}`);
  Object.assign(section.dataset, { source: g.plan.sourceId, plan: g.plan.id });
  if (g.changed) section.dataset.changed = 'true';
  const head = testid(el('button', 'ap-hit ap-hit-plan'), `search-plan-${g.plan.sourceId}/${g.plan.id}`);
  head.type = 'button';
  Object.assign(head.dataset, { source: g.plan.sourceId, plan: g.plan.id, kind: 'plan' });
  if (h.selected?.key === g.plan.key && !h.selected.item) head.setAttribute('aria-current', 'true');
  head.append(el('span', 'ap-hit-title', g.plan.title), el('span', 'ap-hit-meta', hitMeta(g.plan, env)));
  const notes: string[] = [];
  if (g.continued) notes.push(copy.continued);
  if (g.planOnly) notes.push(copy.planMatch);
  if (g.changed) notes.push(copy.changed);
  if (notes.length) head.append(el('span', 'ap-hit-note', notes.join(' · ')));
  head.setAttribute('aria-label', `${copy.openPlan}: ${g.plan.title}`);
  head.addEventListener('click', () => h.openPlan(g.hits[0] ?? { plan: g.plan, planMatched: true, task: null, ancestors: [], omittedAncestors: 0, continued: g.continued, classified: null }));
  section.append(head);
  if (g.hits.length) {
    const list = el('ul', 'ap-hit-tasks');
    list.setAttribute('aria-label', ru ? `Подходящие задачи в ${g.plan.title}` : `Matching tasks in ${g.plan.title}`);
    for (const hit of g.hits) {
      const t = hit.task!;
      const li = el('li');
      const b = testid(el('button', 'ap-hit ap-hit-task'), `search-task-${g.plan.sourceId}/${g.plan.id}/${t.id}`);
      b.type = 'button';
      Object.assign(b.dataset, { source: g.plan.sourceId, plan: g.plan.id, item: t.id, status: t.status, kind: 'task' });
      if (h.selected?.key === g.plan.key && h.selected.item === t.id) b.setAttribute('aria-current', 'true');
      const line = el('span', 'ap-hit-line');
      const g1 = glyph(t.status, language); g1.setAttribute('aria-hidden', 'true'); g1.removeAttribute('role'); g1.removeAttribute('aria-label');
      const body = el('span', 'ap-hit-body');
      const head = el('span', 'ap-hit-head');
      head.append(el('span', 'ap-hit-title', t.title), el('span', 'ap-muted', statusLabel(t.status, language)), el('code', 'ap-hit-id', t.id));
      body.append(head);
      const crumb = breadcrumb(hit);
      if (crumb.head.length) {
        const c = testid(el('span', 'ap-hit-context'), 'search-context');
        c.dataset.omitted = String(crumb.omitted);
        const parts = [...crumb.head.map((a) => a.title), ...(crumb.omitted ? [ru ? `… ещё: ${formatCount(crumb.omitted, language)}` : `… ${crumb.omitted} more`] : []), ...crumb.tail.map((a) => a.title)];
        c.textContent = `${copy.inside}: ${parts.join(' › ')}`;
        body.append(c);
      }
      line.append(g1, body);
      b.append(line);
      b.setAttribute('aria-label', `${copy.showTask}: ${t.title}, ${statusLabel(t.status, language)}, ${ru ? 'в плане' : 'in plan'} ${g.plan.title}`);
      b.addEventListener('click', () => h.openTask(hit));
      li.append(b);
      list.append(li);
    }
    section.append(list);
  }
  return section;
}

export interface ActionHooks { more: () => void; retry: () => void; refresh: () => void; page: (delta: -1 | 1) => void; removeLocation: (part: LocationPart) => void; clearAll: () => void }

/** Grouped results for the shown page, with explicit continuation and recovery actions. */
export function resultsBlock(v: SearchViewState, env: Env, h: ResultHooks & ActionHooks) {
  const language = resolveLanguage('auto', env.locale), copy = COPY[language];
  const nav = testid(el('nav', 'ap-plan-list ap-search-results'), 'search-results');
  nav.setAttribute('aria-label', copy.results);
  nav.dataset.scrollKey = 'search-results';
  nav.dataset.run = String(v.run);
  nav.dataset.page = String(v.page.number);
  // Owning heading of the results region, present in every result state (focus target, never a Tab stop).
  const heading = testid(el('h2', 'ap-region-h', copy.results), 'search-results-heading');
  heading.tabIndex = -1;
  nav.append(heading);
  if (v.blocked) {
    const box = testid(el('div', 'ap-search-blocked'), 'search-blocked');
    box.setAttribute('role', 'status');
    box.dataset.reason = v.blocked;
    box.dataset.parts = v.blockedParts.join(' ');
    box.append(el('p', '', blockedText(v.blocked, language)));
    const row = el('div', 'ap-row');
    button(row, 'search-retry', copy.retry, h.retry);
    // Removing an unavailable project also removes its worktree; an unavailable worktree alone keeps the project.
    const part: LocationPart = v.blockedParts.includes('project') ? 'project' : 'worktree';
    const remove = button(row, 'search-remove-location', part === 'project' ? copy.removeProject : copy.removeWorktree, () => h.removeLocation(part));
    remove.dataset.part = part;
    button(row, 'search-clear-blocked', copy.clear, h.clearAll, 'ghost');
    box.append(row);
    nav.append(box);
    return nav;
  }
  if (v.phase === 'loading') {
    const slot = testid(el('div', 'ap-row'), 'search-loading');
    mountSpinner(slot, { label: copy.searching });
    nav.append(slot);
    return nav;
  }
  nav.append(countsBlock(v, language));
  const shown = v.page.hits.length;
  if (!shown) {
    if (v.exhausted && !v.stop) {
      const certain = !v.coverage.gapped && !(narrowed(v.criteria) && v.discoveryIncomplete);
      nav.append(emptyBlock('search-empty', certain ? copy.noMatch : copy.uncertain, copy.tryOther));
    } else if (v.stop === 'paused' || v.stop === 'hidden') {
      nav.append(testid(el('p', 'ap-note', copy.noneYet), 'search-none-yet'));
    }
  }
  for (const g of v.page.groups) nav.append(groupBlock(g, env, h));
  nav.append(coverageBlock(v, language));
  const actions = testid(el('div', 'ap-row ap-search-actions'), 'search-actions');
  if (v.hasPrevious) button(actions, 'search-prev', copy.previous, () => h.page(-1));
  if (v.hasNext) button(actions, 'search-next', copy.next, () => h.page(1));
  if (v.busy) {
    const slot = testid(el('span', 'ap-row'), 'search-loading');
    mountSpinner(slot, { label: copy.busy });
    actions.append(slot);
  } else if (v.stop === 'failed') {
    const copy = failureCopy(v.failure?.kind ?? 'unavailable', language);
    actions.append(testid(el('p', 'ap-doc-warn', language === 'ru' ? `Поиск остановлен: ${copy.title}. Найденные результаты показаны; ошибка не считалась отсутствием совпадений.` : `Searching stopped: ${copy.title}. Results so far are shown; nothing was treated as no match.`), 'search-failed'));
    button(actions, 'search-retry', COPY[language].retry, h.retry);
  } else if (v.stop === 'conflict' || v.stop === 'changed' || v.stop === 'membership' || v.stop === 'retired' || v.stop === 'identity') {
    button(actions, 'search-refresh', copy.refresh, h.refresh);
  } else if (!v.hasNext && v.more) {
    const full = shown >= 50;
    const more = button(actions, 'search-more', full ? copy.more : copy.continue, h.more);
    more.dataset.action = full ? 'more' : 'continue';
  }
  if (actions.childElementCount) nav.append(actions);
  return nav;
}

/** Visible copy of the last explicit outcome; only announceSearch speaks it, once. */
export function statusLine(v: SearchViewState, locale = 'en') {
  const language = resolveLanguage('auto', locale);
  const p = testid(el('p', 'ap-note ap-search-status'), 'search-status');
  p.dataset.stop = v.stop ?? 'none';
  const text = v.status.message ? searchStatusText(v.status.message, language) : v.status.text;
  p.textContent = text;
  announceSearch(v.status.id, text);
  return p;
}

/** Older service: search is plainly unavailable; the board stays as it was. */
export const unavailableNote = (locale = 'en') => testid(el('p', 'ap-note', COPY[resolveLanguage('auto', locale)].unavailableService), 'search-unavailable');
