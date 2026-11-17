// Board search DOM (docs/ui.md "Search"): the labelled form, explicit scope, chips, honest counts and
// coverage, grouped results and explicit actions. Untrusted titles land through textContent only.
import { mountSearchField, mountSpinner, type SelectOption } from '@openchamber/sdk/ui';
import { mountLiveSelect } from './live-select.ts';
import { button, el, emptyBlock, failureCopy, glyph, planLocation, testid, type Env } from './components.ts';
import { EMPTY_LIVE, sessionLabel } from './live.ts';
import { icon } from './primitives.ts';
import { formatCount } from './format.ts';
import { lifecycleLabel, statusLabel, type ItemStatus, type Lifecycle, type SearchHitView, type SearchPlanView, type SourceView } from './model.ts';
import { ALL } from './scope.ts';
import { blockedText, breadcrumb, narrowed, queryProblem, searchStatusText, type LocationPart, type SearchCriteria, type SearchGroup, type SearchViewState } from './search.ts';
import { resolveLanguage, type InterfaceLanguage } from './i18n.ts';

const EN = {
  searchHint: 'Search titles and IDs',
  searchPlans: 'Search plans and tasks', searchTitles: 'Search titles and IDs', filters: 'Filters', close: 'Close', planStatus: 'Plan status', anyPlan: 'Any plan status', taskStatus: 'Task status', anyTask: 'Any task status', source: 'Recorded source', allSources: 'All recorded sources', unverified: 'unverified', unavailable: 'not available here', search: 'Search', constraints: 'Search constraints', clear: 'Clear search and filters', results: 'Search results', retry: 'Retry', removeProject: 'Remove project filter', removeWorktree: 'Remove worktree filter', searching: 'Searching recorded plans', noMatch: 'No plans or tasks match', uncertain: 'No matches in the plans and locations that could be checked', tryOther: 'Try other words, or remove a constraint. Filters and Clear search stay above.', noneYet: 'No matches found yet; more recorded plans remain unchecked.', previous: 'Previous results', next: 'Next results', busy: 'Searching…', refresh: 'Refresh search', more: 'Load more results', continue: 'Continue searching', help: 'Every word must appear in the same plan’s or task’s own title or ID, in any order. Capitalization is ignored; accents are not (café and cafe differ).', apply: 'Plan status, task status and source apply when you search. Location choices apply right away.', pending: 'Not searched yet: these results are for the previous search. Press Search to update them.', unavailableService: 'Search is unavailable with this service version. The board below still lists plans as before.', allPlans: 'all recorded plans in this store', archived: 'archived plans only', current: 'current plans (archived plans excluded)', location: 'in the chosen project or worktree', sessionScope: 'where the chosen session is the owner, linked or a recorded contributor', scopeNote: 'Ordinary board list pages are not the search scope.', words: 'Words', sourceChip: 'Source', project: 'Project', worktree: 'Worktree', session: 'Session', remove: 'Remove', continued: 'Continued from the previous results', planMatch: 'The plan’s own title or ID matches', changed: 'Changed since found', openPlan: 'Open plan', showTask: 'Show task', inside: 'In', setup: 'unverified setup', noTasks: 'no counted tasks', exhausted: 'Every recorded plan in this scope was checked, as searched; reports may change, so this is not a live census.', partial: 'More recorded plans remain unchecked. Counts so far are not totals.', checking: 'Checking that these earlier results are still current…',
};
const COPY = { en: EN, ru: {
  searchHint: 'Поиск',
  searchPlans: 'Поиск планов и задач', searchTitles: 'Поиск по названиям и ID', filters: 'Фильтры', close: 'Закрыть', planStatus: 'Статус плана', anyPlan: 'Любой статус плана', taskStatus: 'Статус задачи', anyTask: 'Любой статус задачи', source: 'Записанный источник', allSources: 'Все записанные источники', unverified: 'не подтверждён', unavailable: 'недоступно здесь', search: 'Найти', constraints: 'Условия поиска', clear: 'Очистить поиск и фильтры', results: 'Результаты поиска', retry: 'Повторить', removeProject: 'Убрать фильтр проекта', removeWorktree: 'Убрать фильтр рабочего дерева', searching: 'Поиск записанных планов', noMatch: 'Нет подходящих планов или задач', uncertain: 'Нет совпадений среди проверенных планов и расположений', tryOther: 'Попробуйте другие слова или уберите условие. Фильтры и очистка поиска остаются выше.', noneYet: 'Совпадений пока нет; ещё не все записанные планы проверены.', previous: 'Предыдущие результаты', next: 'Следующие результаты', busy: 'Поиск…', refresh: 'Обновить поиск', more: 'Загрузить ещё результаты', continue: 'Продолжить поиск', help: 'Каждое слово должно присутствовать в собственном названии или ID одного плана или задачи, в любом порядке. Регистр не учитывается; диакритика учитывается (café и cafe различаются).', apply: 'Статусы плана, задачи и источник применяются при поиске. Расположения применяются сразу.', pending: 'Поиск ещё не выполнен: это результаты предыдущего поиска. Нажмите «Найти» для обновления.', unavailableService: 'Эта версия сервиса не поддерживает поиск. Список планов ниже работает как прежде.', allPlans: 'всех записанных планов в этом хранилище', archived: 'только архивные планы', current: 'текущие планы (без архивных)', location: 'в выбранном проекте или рабочем дереве', sessionScope: 'где выбранная сессия — владелец, связанная сессия или записанный участник', scopeNote: 'Обычные страницы списка планов не ограничивают область поиска.', words: 'Слова', sourceChip: 'Источник', project: 'Проект', worktree: 'Рабочее дерево', session: 'Сессия', remove: 'Убрать', continued: 'Продолжение предыдущих результатов', planMatch: 'Совпадает собственное название или ID плана', changed: 'Изменилось после поиска', openPlan: 'Открыть план', showTask: 'Показать задачу', inside: 'В', setup: 'настройка не подтверждена', noTasks: 'нет учитываемых задач', exhausted: 'Все записанные планы этой области проверены на момент поиска; отчёты могут меняться, это не живая перепись.', partial: 'Ещё не все записанные планы проверены. Промежуточные числа не являются итоговыми.', checking: 'Проверка актуальности предыдущих результатов…',
}, 'zh-CN': {
  searchHint: '搜索',
  searchPlans: '搜索计划和任务', searchTitles: '搜索标题和 ID', filters: '筛选', close: '关闭', planStatus: '计划状态', anyPlan: '任意计划状态', taskStatus: '任务状态', anyTask: '任意任务状态', source: '记录来源', allSources: '所有记录来源', unverified: '未验证', unavailable: '此处不可用', search: '搜索', constraints: '搜索条件', clear: '清除搜索和筛选', results: '搜索结果', retry: '重试', removeProject: '移除项目筛选', removeWorktree: '移除工作树筛选', searching: '正在搜索已记录计划', noMatch: '没有匹配的计划或任务', uncertain: '在可检查的计划和位置中没有匹配项', tryOther: '请尝试其他词语或移除条件。筛选和清除搜索仍位于上方。', noneYet: '尚未找到匹配项；仍有记录的计划尚未检查。', previous: '上一页结果', next: '下一页结果', busy: '正在搜索…', refresh: '刷新搜索', more: '加载更多结果', continue: '继续搜索', help: '每个词都必须出现在同一计划或任务自身的标题或 ID 中，顺序不限。不区分大小写，但区分重音（café 和 cafe 不同）。', apply: '计划状态、任务状态和来源在搜索时生效。位置选择立即生效。', pending: '尚未搜索：这些结果属于上一次搜索。按“搜索”更新结果。', unavailableService: '此服务版本不支持搜索。下方看板仍按原方式列出计划。', allPlans: '此存储中的所有已记录计划', archived: '仅限已归档计划', current: '当前计划（不含已归档计划）', location: '位于所选项目或工作树中', sessionScope: '且所选会话是所有者、关联会话或已记录的贡献者', scopeNote: '普通看板列表页面不是搜索范围。', words: '词语', sourceChip: '来源', project: '项目', worktree: '工作树', session: '会话', remove: '移除', continued: '接续前面的结果', planMatch: '计划自身的标题或 ID 匹配', changed: '找到后已更改', openPlan: '打开计划', showTask: '显示任务', inside: '位于', setup: '设置未验证', noTasks: '没有计数任务', exhausted: '已按搜索条件检查此范围内所有记录的计划；报告可能变化，因此这不是实时统计。', partial: '仍有记录的计划尚未检查。目前的数量不是总数。', checking: '正在检查这些较早的结果是否仍然有效…',
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
    // The kit field is controlled: echo each change back so its clear button shows while there is
    // text, and its clear button and Escape empty the visible text, not only the draft.
    const kit = mountSearchField(holder, { value: s.text(), label: copy.searchTitles, placeholder: copy.searchHint, onChange: (q) => { s.setText(q); kit.update({ value: q }); pending(); } });
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
  if (h.active) { const n = el('span', 'ap-filters-count', language === 'en' ? String(h.active) : formatCount(h.active, language)); n.setAttribute('aria-hidden', 'true'); trigger.append(n); }
   const activeLabel = language === 'ru' ? `Фильтры, активно: ${formatCount(h.active, language)}` : language === 'zh-CN' ? `筛选，${formatCount(h.active, language)} 项生效` : `Filters, ${h.active} active`;
   trigger.setAttribute('aria-label', h.active ? activeLabel : copy.filters);
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
      pick('search-source', copy.source, s.draft.source, [{ id: ALL, label: copy.allSources }, ...s.sources.map((x) => ({ id: x.id, label: x.verified ? x.id : language === 'zh-CN' ? `${x.id}（${copy.unverified}）` : `${x.id} (${copy.unverified})` })), ...(known || s.draft.source === ALL ? [] : [{ id: s.draft.source, label: language === 'zh-CN' ? `${s.draft.source}（${copy.unavailable}）` : `${s.draft.source} (${copy.unavailable})` }])], (v) => s.setDraft({ source: v }));
    }
  }
  grid.append(h.modes);
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

const sourceText = (c: Pick<SearchCriteria, 'source'>, language: InterfaceLanguage) => (c.source === ALL ? COPY[language].allPlans : language === 'ru' ? `планов, записанных источником ${c.source}` : language === 'zh-CN' ? `来源 ${c.source} 记录的计划` : `plans recorded by source ${c.source}`);
/** What is searched, in words; stays visible with zero, failed or unavailable results. */
export function scopeText(c: SearchCriteria, locale = 'en') {
  const language = resolveLanguage('auto', locale), copy = COPY[language];
  const searching = language === 'ru' ? 'Поиск' : language === 'zh-CN' ? '搜索' : 'Searching';
  const parts = [`${searching}${language === 'zh-CN' ? '' : ' '}${sourceText(c, language)}`, c.archived ? copy.archived : copy.current];
  if (narrowed(c)) parts.push(copy.location);
  if (c.session !== ALL) parts.push(copy.sessionScope);
  return `${parts.join(language === 'zh-CN' ? '，' : ', ')}${language === 'zh-CN' ? '。' : '.'}${language === 'zh-CN' ? '' : ' '}${copy.scopeNote}`;
}
export function scopeLine(c: SearchCriteria | null, archived: boolean, locale = 'en') {
  const language = resolveLanguage('auto', locale);
  const p = testid(el('p', 'ap-note ap-search-scope'), 'search-scope');
  p.textContent = c ? scopeText(c, language) : language === 'ru' ? `Поиск проверяет ${archived ? 'все архивные планы' : 'все текущие планы'}, записанные в хранилище, а не только перечисленные ниже.` : language === 'zh-CN' ? `搜索检查此存储中${archived ? '所有已归档计划' : '所有当前计划'}，不限于下方列出的计划。` : `Search checks ${archived ? 'every archived plan' : 'every current plan'} recorded in this store, not only the plans listed below.`;
  return p;
}

export interface ChipHooks { remove: (kind: ChipKind) => void; clearAll: () => void }
export function chipLabel(kind: ChipKind, c: SearchCriteria, locale = 'en') {
  const language = resolveLanguage('auto', locale), copy = COPY[language];
  const sep = language === 'zh-CN' ? '：' : ': ';
  if (kind === 'q') return `${copy.words}${sep}${c.q.trim()}`;
  if (kind === 'source') return `${copy.sourceChip}${sep}${c.source}`;
  if (kind === 'lifecycle') return `${copy.planStatus}${sep}${lifecycleLabel(c.lifecycle as Lifecycle, language)}`;
  if (kind === 'status') return `${copy.taskStatus}${sep}${statusLabel(c.status as ItemStatus, language)}`;
  if (kind === 'project') return `${copy.project}${sep}${c.labels.project ?? c.project}`;
  if (kind === 'worktree') return `${copy.worktree}${sep}${c.worktree.startsWith('root:') ? (language === 'ru' ? 'Основная рабочая копия' : language === 'zh-CN' ? '主检出目录' : 'Main checkout') : c.labels.worktree ?? c.worktree}`;
  return `${copy.session}${sep}${c.labels.sessionGenerated ? sessionLabel(c.session, EMPTY_LIVE, language) : c.labels.session ?? c.session}`;
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
    b.append(el('span', '', unavailable.has(kind) ? (language === 'zh-CN' ? `${text}（${copy.unavailable}）` : `${text} (${copy.unavailable})`) : text), x);
    b.setAttribute('aria-label', language === 'zh-CN' ? `${copy.remove}${text}` : `${copy.remove} ${text}`);
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

export const resultText = (v: SearchViewState, language: InterfaceLanguage) =>
  searchStatusText({ kind: 'outcome', ...v.counts, exhausted: true, shown: v.page.hits.length }, language);

/** Matched plans / matching tasks (accumulated) apart from this page's shown results and context rows. */
export function countsBlock(v: SearchViewState, language: InterfaceLanguage = 'en') {
  const box = testid(el('div', 'ap-search-counts'), 'search-counts');
  const final = v.exhausted && v.countsCurrent && !v.coverage.gapped && !v.stop;
  Object.assign(box.dataset, { matchedPlans: String(v.counts.matchedPlans), matchingTasks: String(v.counts.matchingTasks), shown: String(v.page.hits.length), context: String(v.page.contextRows), final: String(final), current: String(v.countsCurrent) });
  box.append(el('p', 'ap-search-found', resultText(v, language)));
  return box;
}

export function qualificationText(v: SearchViewState, language: InterfaceLanguage): string {
  const text = {
    en: { checking: 'Checking whether these results are still current…', partial: 'Some search results may be missing.', changed: 'Some results changed; refresh the search.' },
    ru: { checking: 'Проверяем, актуальны ли результаты…', partial: 'Поиск может быть неполным.', changed: 'Некоторые результаты изменились; обновите поиск.' },
    'zh-CN': { checking: '正在检查结果是否仍然有效…', partial: '部分搜索结果可能缺失。', changed: '部分结果已更改，请刷新搜索。' },
  }[language];
  return !v.page.checked ? text.checking
    : !v.exhausted || v.coverage.gapped || (narrowed(v.criteria) && v.discoveryIncomplete) ? text.partial
    : !v.countsCurrent || v.removed || v.changedKeys ? text.changed : '';
}

/** One qualification, without diagnostic limits or skipped-record counts. */
export function coverageBlock(v: SearchViewState, language: InterfaceLanguage = 'en') {
  const box = testid(el('div', 'ap-note ap-search-coverage'), 'search-coverage');
  box.dataset.state = v.exhausted ? (v.coverage.gapped ? 'gapped' : 'exhausted') : 'partial';
  if (v.coverage.gapped) box.dataset.gapped = 'true';
  const text = qualificationText(v, language);
  box.hidden = !text;
  if (text) box.append(el('p', '', text));
  return box;
}

export interface ResultHooks {
  selected: { key: string; item: string | null } | null;
  openPlan: (hit: SearchHitView) => void;
  openTask: (hit: SearchHitView) => void;
}

const hitMeta = (plan: SearchPlanView, env: Env) => {
  const language = resolveLanguage('auto', env.locale), copy = COPY[language], ru = language === 'ru', zh = language === 'zh-CN';
  const parts = [plan.id, planLocation({ ...plan, working: [], document: { state: 'unavailable', checklistSynchronized: false, currentFile: 'not-rechecked' } }, env.live, env.boundSource, language)];
  if (plan.lifecycle !== 'active') parts.push(lifecycleLabel(plan.lifecycle, language));
  if (env.boundSource === null || plan.sourceId !== env.boundSource) parts.push(`${ru ? 'источник' : zh ? '来源' : 'source'} ${plan.sourceId}`);
  if (!plan.sourceVerified) parts.push(copy.setup);
  const numbers = language === 'en' ? `${plan.counts.done}/${plan.counts.total}` : `${formatCount(plan.counts.done, language)}/${formatCount(plan.counts.total, language)}`;
  parts.push(plan.counts.total ? `${numbers} ${ru ? 'выполнено (весь план)' : zh ? '已完成（整个计划）' : 'done (whole plan)'}` : copy.noTasks);
  return parts.join(' · ');
};

function groupBlock(g: SearchGroup, env: Env, h: ResultHooks) {
  const language = resolveLanguage('auto', env.locale), copy = COPY[language], ru = language === 'ru', zh = language === 'zh-CN';
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
    list.setAttribute('aria-label', ru ? `Подходящие задачи в ${g.plan.title}` : zh ? `${g.plan.title} 中的匹配任务` : `Matching tasks in ${g.plan.title}`);
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
        const parts = [...crumb.head.map((a) => a.title), ...(crumb.omitted ? [ru ? `… ещё: ${formatCount(crumb.omitted, language)}` : zh ? `… 另有 ${formatCount(crumb.omitted, language)} 项` : `… ${crumb.omitted} more`] : []), ...crumb.tail.map((a) => a.title)];
        c.textContent = `${copy.inside}${zh ? '：' : ': '}${parts.join(' › ')}`;
        body.append(c);
      }
      line.append(g1, body);
      b.append(line);
      b.setAttribute('aria-label', zh ? `${copy.showTask}：${t.title}，${statusLabel(t.status, language)}，位于计划 ${g.plan.title}` : `${copy.showTask}: ${t.title}, ${statusLabel(t.status, language)}, ${ru ? 'в плане' : 'in plan'} ${g.plan.title}`);
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
    actions.append(testid(el('p', 'ap-doc-warn', language === 'ru' ? `Поиск остановлен: ${copy.title}. Найденные результаты показаны; ошибка не считалась отсутствием совпадений.` : language === 'zh-CN' ? `搜索已停止：${copy.title}。目前的结果仍然显示；没有将任何内容视为不匹配。` : `Searching stopped: ${copy.title}. Results so far are shown; nothing was treated as no match.`), 'search-failed'));
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
  const outcome = v.status.message?.kind === 'outcome';
  // Speak the explicit outcome, not mutable page/freshness state: paging rechecks
  // keep this outcome ID and must not turn an ordinary poll into another announcement.
  const text = v.status.message ? searchStatusText(v.status.message, language) : v.status.text;
  // The result count already appears beside the results; only the persistent live region
  // repeats it for an explicit search outcome, never as another visible notice.
  p.hidden = outcome || !text;
  p.textContent = outcome ? '' : text;
  announceSearch(v.status.id, text);
  return p;
}

/** Older service: search is plainly unavailable; the board stays as it was. */
export const unavailableNote = (locale = 'en') => testid(el('p', 'ap-note', COPY[resolveLanguage('auto', locale)].unavailableService), 'search-unavailable');
