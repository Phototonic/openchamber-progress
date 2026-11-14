// Needs you inbox presentation: the compact rail/board section, the Work Status line and the
// labelled source-wide reading a row opens. Read-only: no control here changes a task, a plan,
// the host session or the session-action pin. Only fixed copy is translated, never reported text.
import { ATTENTION_HOOKS, button, el, testid, type Env } from './components.ts';
import { absoluteTime, clockTime, elapsedText, formatCount } from './format.ts';
import { resolveLanguage, type InterfaceLanguage } from './i18n.ts';
import { inboxRequest, inboxTarget, type InboxModel, type InboxPanel } from './inbox.ts';
import { elapsedAt, type BlockerCategory, type InboxRowView, type InboxTaskTarget, type ItemView, type PlanDetail, type PlanView } from './model.ts';
import type { Loadable } from './app.ts';
import { icon, warningLine } from './primitives.ts';

/** Needs you rows shown before "Show N more" (loaded rows only; more plans load explicitly). */
export const INBOX_COMPACT = 3;

const forms = (n: number, locale: InterfaceLanguage, one: string, few: string, many: string) => {
  const form = new Intl.PluralRules(locale).select(n);
  return form === 'one' ? one : form === 'few' ? few : many;
};
const num = (n: number, locale: InterfaceLanguage) => (locale === 'en' ? String(n) : formatCount(n, locale));

export const INBOX_COPY = {
  en: {
    heading: 'Needs you',
    scope: 'Decisions and reviews reported in all current plans of this OpenCode setup.',
    tasks: (n: number) => `${n} ${n === 1 ? 'task' : 'tasks'}`,
    atLeastTasks: (n: number) => `at least ${n} ${n === 1 ? 'task' : 'tasks'}`,
    summary: (n: number) => (n === 1 ? '1 task needs you' : `${n} tasks need you`),
    summaryAtLeast: (n: number) => `At least ${n} ${n === 1 ? 'task needs' : 'tasks need'} you`,
    none: 'Nothing needs you right now.',
    noneShort: 'Nothing needs you',
    noneYet: 'Nothing found yet that needs you',
    partial: 'Only some plans have been checked so far, so more may need you.',
    partialNone: 'Nothing found yet. Not every plan has been checked.',
    gapped: 'Some plans couldn’t be read, so this list may be incomplete.',
    capture: 'Capture is off, so newer reports aren’t recorded.',
    stale: (time: string) => `Last checked ${time}. This may be out of date.`,
    unsupported: 'Needs you isn’t available with this progress service version.',
    unverified: 'Needs you is unavailable: this service isn’t linked to a verified OpenCode setup.',
    invalid: 'Needs you couldn’t be read from the progress service.',
    listLabel: 'Tasks that need you',
    alsoListLabel: 'Other blocked tasks',
    more: 'Check more plans', moreLoading: 'Checking more plans…', moreFailed: 'More plans couldn’t be checked right now.', retry: 'Try again',
    restarted: 'The list changed while loading, so it started again from the top.',
    showMore: (n: number) => `Show ${n} more`, showFewer: 'Show fewer',
    also: (n: number, exact: boolean) => `Also blocked · ${exact ? n : `${n}+`}`,
    alsoNote: 'Waiting on something other than you, such as another task or an outside party, or no reason was reported.',
    open: (task: string, plan: string) => `Open ${task} in ${plan}`,
    plan: 'Plan: ', reason: 'Reason', next: 'Next step', unknown: 'Unknown',
    waiting: 'Waiting', waitUnknown: 'Waiting time unknown', waitUnavailable: 'Waiting time unavailable',
    waitExact: (at: string) => `Reported blocked at ${at}. Counts reported status, not activity.`,
    waitLower: (at: string) => `Already reported blocked at ${at}; the start is earlier and unknown.`,
    waitUnknownHelp: 'The progress service couldn’t tell when this task was reported blocked.',
    category: 'Wait category: ',
    categories: { decision: 'Decision', review: 'Review', dependency: 'Dependency', external: 'External', other: 'Other' } as Record<BlockerCategory, string>,
    unclassified: 'Category unknown', unclassifiedHelp: 'The report used a category this version doesn’t recognize.',
    absent: 'No details reported', invalidDetails: 'Reported details couldn’t be read',
    lineAria: (summary: string) => `${summary} across all current plans. Open progress`,
    lineScope: 'all plans',
    readingLabel: 'Opened from Needs you',
    readingNote: 'This is the current plan. Nothing here changes the task.',
    backPanel: 'Back to session progress', backBoard: 'Back to plans',
    revealNeeds: (task: string) => `Needs you: ${task}`, revealAlso: (task: string) => `Also blocked: ${task}`,
    gone: 'This plan is no longer available, so the task can’t be shown.',
    taskGone: (task: string) => `“${task}” is no longer in this plan. The plan stays open to read.`,
    notBlocked: (task: string, status: string) => `“${task}” is no longer blocked. It’s now ${status}.`,
    inactive: 'This plan is no longer active.',
    archived: 'This plan has been archived.',
    otherSetup: 'This plan can no longer be read from this OpenCode setup.',
    loading: 'Loading the current plan…',
    failed: 'The current plan couldn’t be loaded, so the task can’t be shown. Nothing was changed.',
    statuses: { pending: 'pending', working: 'in progress', blocked: 'blocked', done: 'done', skipped: 'skipped' } as Record<ItemView['status'], string>,
  },
  ru: {
    heading: 'Нужно ваше участие',
    scope: 'Решения и проверки из отчётов во всех текущих планах этой установки OpenCode.',
    tasks: (n: number) => `${num(n, 'ru')} ${forms(n, 'ru', 'задача', 'задачи', 'задач')}`,
    atLeastTasks: (n: number) => `не менее ${num(n, 'ru')} ${forms(n, 'ru', 'задачи', 'задач', 'задач')}`,
    summary: (n: number) => `Нужно ваше участие: ${num(n, 'ru')} ${forms(n, 'ru', 'задача', 'задачи', 'задач')}`,
    summaryAtLeast: (n: number) => `Нужно ваше участие: не менее ${num(n, 'ru')} ${forms(n, 'ru', 'задачи', 'задач', 'задач')}`,
    none: 'Сейчас ничего не требует вашего участия.',
    noneShort: 'Ничего не требует вашего участия',
    noneYet: 'Пока не найдено задач, где нужно ваше участие',
    partial: 'Пока проверена только часть планов, поэтому ваше участие может понадобиться ещё где-то.',
    partialNone: 'Пока ничего не найдено. Проверены не все планы.',
    gapped: 'Некоторые планы не удалось прочитать, поэтому список может быть неполным.',
    capture: 'Сбор отключён, поэтому новые отчёты не записываются.',
    stale: (time: string) => `Последняя проверка: ${time}. Данные могут быть устаревшими.`,
    unsupported: 'Раздел «Нужно ваше участие» недоступен в этой версии сервиса прогресса.',
    unverified: 'Раздел «Нужно ваше участие» недоступен: сервис не привязан к проверенной установке OpenCode.',
    invalid: 'Не удалось прочитать раздел «Нужно ваше участие» из сервиса прогресса.',
    listLabel: 'Задачи, где нужно ваше участие',
    alsoListLabel: 'Другие заблокированные задачи',
    more: 'Проверить другие планы', moreLoading: 'Проверяем другие планы…', moreFailed: 'Сейчас не удалось проверить другие планы.', retry: 'Попробовать снова',
    restarted: 'Список изменился во время загрузки, поэтому он начат заново.',
    showMore: (n: number) => `Показать ещё ${num(n, 'ru')}`, showFewer: 'Свернуть',
    also: (n: number, exact: boolean) => `Также заблокировано · ${exact ? num(n, 'ru') : `${num(n, 'ru')}+`}`,
    alsoNote: 'Ожидают не вас: например, другую задачу или внешнюю сторону, либо причина не указана.',
    open: (task: string, plan: string) => `Открыть «${task}» в плане «${plan}»`,
    plan: 'План: ', reason: 'Причина', next: 'Следующий шаг', unknown: 'Неизвестно',
    waiting: 'Ожидает', waitUnknown: 'Время ожидания неизвестно', waitUnavailable: 'Время ожидания недоступно',
    waitExact: (at: string) => `Отмечена как заблокированная: ${at}. Учитывается записанный статус, а не активность.`,
    waitLower: (at: string) => `Уже была отмечена как заблокированная: ${at}; начало раньше и неизвестно.`,
    waitUnknownHelp: 'Сервис прогресса не смог определить, когда задача была отмечена как заблокированная.',
    category: 'Категория ожидания: ',
    categories: { decision: 'Решение', review: 'Проверка', dependency: 'Зависимость', external: 'Внешнее', other: 'Другое' } as Record<BlockerCategory, string>,
    unclassified: 'Категория неизвестна', unclassifiedHelp: 'В отчёте указана категория, неизвестная этой версии.',
    absent: 'Сведения не указаны', invalidDetails: 'Не удалось прочитать записанные сведения',
    lineAria: (summary: string) => `${summary} во всех текущих планах. Открыть прогресс`,
    lineScope: 'все планы',
    readingLabel: 'Открыто из раздела «Нужно ваше участие»',
    readingNote: 'Это текущий план. Здесь ничего не меняет задачу.',
    backPanel: 'Назад к прогрессу сессии', backBoard: 'Назад к планам',
    revealNeeds: (task: string) => `Нужно ваше участие: ${task}`, revealAlso: (task: string) => `Также заблокировано: ${task}`,
    gone: 'Этот план больше недоступен, поэтому задачу показать нельзя.',
    taskGone: (task: string) => `Задачи «${task}» больше нет в этом плане. План остаётся открытым для чтения.`,
    notBlocked: (task: string, status: string) => `Задача «${task}» больше не заблокирована. Сейчас: ${status}.`,
    inactive: 'Этот план больше не активен.',
    archived: 'Этот план перемещён в архив.',
    otherSetup: 'Этот план больше нельзя прочитать из этой установки OpenCode.',
    loading: 'Загрузка текущего плана…',
    failed: 'Не удалось загрузить текущий план, поэтому показать задачу нельзя. Ничего не изменено.',
    statuses: { pending: 'не начата', working: 'в работе', blocked: 'заблокирована', done: 'выполнена', skipped: 'пропущена' } as Record<ItemView['status'], string>,
  },
} satisfies Record<InterfaceLanguage, Record<string, unknown>>;
export const inboxCopy = (locale: string) => INBOX_COPY[resolveLanguage('auto', locale)];

/** The compact count statement: exact only for complete coverage, otherwise a known minimum. */
export function inboxSummary(m: InboxModel, locale: string) {
  const t = inboxCopy(locale), n = m.counts.needsYou;
  if (m.complete) return n ? t.summary(n) : t.noneShort;
  return n ? t.summaryAtLeast(n) : t.noneYet;
}

/** Opening a row: the source-wide reading target and its display facts; never a navigation payload. */
export interface InboxReading {
  token: number;
  target: InboxTaskTarget;
  task: string;
  planTitle: string;
  coordinator: string;
  group: InboxRowView['group'];
  /** Row to return focus to on Back. */
  rowKey: string;
}
let readings = 0;
export function openReading(row: InboxRowView, storeId: string): InboxReading {
  return { token: ++readings, target: inboxTarget(row, storeId), task: row.task.title, planTitle: row.planTitle, coordinator: row.coordinatorSessionId, group: row.group, rowKey: row.rowKey };
}
/**
 * Detail request of a reading (see inboxRequest). A newer revision of the same plan in the latest
 * inbox window re-reads it on the existing cadence; nothing else polls the reading.
 */
export function readingRequest(r: InboxReading, model?: InboxModel | null) {
  const key = `${r.target.source}/${r.target.plan}`;
  let revision = r.target.revision;
  for (const row of [...model?.needsYou ?? [], ...model?.alsoBlocked ?? []]) if (row.planKey === key && row.revision > revision) revision = row.revision;
  return inboxRequest({ ...r.target, revision }, r.planTitle, r.coordinator);
}

function categoryTag(row: InboxRowView, locale: string) {
  const t = inboxCopy(locale), b = row.blocker;
  const tag = testid(el('span', 'ap-ny-cat ap-inbox-cat'), 'needs-you-category');
  const kind = b.state !== 'reported' ? b.state : b.category === null ? 'unknown' : b.category;
  tag.dataset.category = kind;
  const text = b.state !== 'reported' ? (b.state === 'absent' ? t.absent : t.invalidDetails) : b.category === null || b.category === 'unclassified' ? t.unclassified : t.categories[b.category];
  tag.append(el('span', 'ap-sr', t.category), text);
  if (b.state === 'reported' && b.category === 'unclassified') tag.title = t.unclassifiedHelp;
  return tag;
}

/** Waiting time from the window's reported history, anchored like the per-plan wait (label ticker). */
function waitLabel(row: InboxRowView, m: InboxModel, env: Env) {
  const t = inboxCopy(env.locale);
  const wrap = testid(el('span', 'ap-inbox-wait'), 'needs-you-wait');
  const a = row.wait;
  if (!a) {
    // The window carried waiting times but none for this task: unknown. None at all: unavailable.
    const kind = m.timing ? 'unknown' : 'unavailable';
    wrap.dataset.timing = kind;
    const s = el('span', 'ap-muted', kind === 'unknown' ? t.waitUnknown : t.waitUnavailable);
    if (kind === 'unknown') s.title = t.waitUnknownHelp;
    wrap.append(s);
    return wrap;
  }
  wrap.dataset.timing = a.kind;
  const time = el('time', 'ap-elapsed');
  time.dateTime = a.since;
  // Same attributes as the per-plan blocked wait, so the frame's one label ticker advances it.
  Object.assign(time.dataset, { kind: a.kind, elapsed: String(a.elapsedAtRead), received: String(a.receivedAt), blockedTime: '' });
  const at = absoluteTime(a.since, env.locale);
  time.title = a.kind === 'exact' ? t.waitExact(at) : t.waitLower(at);
  const text = elapsedText(elapsedAt(a, env.mono), env.locale);
  time.textContent = text === null ? t.unknown : a.kind === 'lower-bound' ? (resolveLanguage('auto', env.locale) === 'ru' ? `не менее ${text}` : `at least ${text}`) : text;
  wrap.append(el('span', 'ap-muted', `${t.waiting} `), time);
  return wrap;
}

function rowItem(row: InboxRowView, index: number, prefix: string, m: InboxModel, env: Env, open: (row: InboxRowView) => void) {
  const t = inboxCopy(env.locale);
  const li = testid(el('li', 'ap-inbox-row'), 'needs-you-row');
  // Stable identity for focus continuity across polls (the frame matches data-state with the hook).
  li.dataset.state = row.rowKey;
  Object.assign(li.dataset, { row: row.rowKey, source: row.source, plan: row.plan, task: row.task.id, group: row.group, revision: String(row.revision) });
  const id = `ap-inbox-${prefix}${index}`;
  const b = el('button', 'ap-inbox-open');
  b.type = 'button';
  b.setAttribute('aria-label', t.open(row.task.title, row.planTitle));
  b.setAttribute('aria-describedby', `${id}-facts`);
  b.append(el('span', 'ap-inbox-task', row.task.title));
  const plan = el('span', 'ap-inbox-plan');
  plan.append(el('span', 'ap-sr', t.plan), row.planTitle);
  b.append(plan);
  b.addEventListener('click', () => open(row));
  const facts = el('div', 'ap-inbox-facts');
  facts.id = `${id}-facts`;
  const meta = el('div', 'ap-inbox-meta');
  meta.append(categoryTag(row, env.locale), waitLabel(row, m, env));
  facts.append(meta);
  if (row.blocker.state === 'reported') {
    const dl = el('dl', 'ap-inbox-dl');
    const add = (term: string, value: string | null, hook: string) => {
      const pair = el('div');
      const dd = testid(el('dd', value ? '' : 'ap-muted', value ?? t.unknown), hook);
      if (!value) dd.dataset.unknown = '';
      pair.append(el('dt', '', term), dd);
      dl.append(pair);
    };
    add(t.reason, row.blocker.reason, 'needs-you-reason');
    add(t.next, row.blocker.nextAction, 'needs-you-next');
    facts.append(dl);
  }
  li.append(b, facts);
  // The whole row is a pointer target too; the button stays the one keyboard stop.
  li.addEventListener('click', (e) => { if (!(e.target as Element).closest('button,a,summary')) b.click(); });
  return li;
}

function rowList(rows: InboxRowView[], prefix: string, label: string, m: InboxModel, env: Env, open: (row: InboxRowView) => void) {
  const ul = el('ul', 'ap-inbox-list');
  ul.id = `ap-inbox-${prefix}list`;
  ul.setAttribute('aria-label', label);
  rows.forEach((r, i) => ul.append(rowItem(r, i, prefix, m, env, open)));
  return ul;
}

/**
 * The compact source-wide section at the start of the rail and board. `stale`: the time of the
 * last good read while the latest refresh failed. Unsupported, unverified and unreadable inboxes
 * say so instead of an empty claim; a complete empty first group says nothing needs the user.
 */
export function inboxSection(panel: InboxPanel, env: Env, options: { open: (row: InboxRowView) => void; stale: number | null }) {
  const m = panel.model, t = inboxCopy(env.locale), locale = resolveLanguage('auto', env.locale);
  const box = testid(el('section', 'ap-inbox'), ATTENTION_HOOKS.inbox);
  box.dataset.availability = m.availability;
  box.setAttribute('aria-labelledby', 'ap-inbox-h');
  const head = el('div', 'ap-inbox-head');
  const h = testid(el('h2', 'ap-inbox-title'), 'needs-you-heading');
  h.id = 'ap-inbox-h';
  h.tabIndex = -1;
  h.append(el('span', '', t.heading));
  if (m.availability === 'ready') {
    const n = m.counts.needsYou;
    const count = testid(el('span', 'ap-inbox-count'), ATTENTION_HOOKS.count);
    Object.assign(count.dataset, { count: String(n), exact: String(m.complete) });
    if (n) count.dataset.tone = 'attention';
    const shown = el('span', '', m.complete ? num(n, locale) : `${num(n, locale)}+`);
    shown.setAttribute('aria-hidden', 'true');
    count.append(shown, el('span', 'ap-sr', `, ${m.complete ? t.tasks(n) : t.atLeastTasks(n)}`));
    h.append(count);
  }
  head.append(h);
  box.append(head);
  if (m.availability !== 'ready') {
    box.append(testid(warningLine(m.availability === 'unsupported' ? t.unsupported : m.availability === 'unverified' ? t.unverified : t.invalid, 'info', 'p'), 'needs-you-unavailable'));
    return box;
  }
  box.append(el('p', 'ap-note ap-inbox-scope', t.scope));
  const notes = el('div', 'ap-inbox-notes');
  if (options.stale !== null) notes.append(testid(warningLine(t.stale(clockTime(options.stale, env.locale)), 'warning', 'p'), 'needs-you-stale'));
  if (!m.captureEnabled) notes.append(testid(warningLine(t.capture, 'info', 'p'), 'needs-you-capture-off'));
  if (m.restarted) notes.append(testid(warningLine(t.restarted, 'info', 'p'), 'needs-you-restarted'));
  if (m.gapped) notes.append(testid(warningLine(t.gapped, 'warning', 'p'), 'needs-you-gapped'));
  if (notes.childNodes.length) box.append(notes);
  if (!m.needsYou.length) {
    const empty = testid(el('p', 'ap-inbox-empty', m.complete ? t.none : t.partialNone), 'needs-you-empty');
    empty.dataset.complete = String(m.complete);
    box.append(empty);
  } else {
    const shown = m.expanded ? m.needsYou : m.needsYou.slice(0, INBOX_COMPACT);
    const list = rowList(shown, 'n', t.listLabel, m, env, options.open);
    box.append(list);
    const hidden = m.needsYou.length - INBOX_COMPACT;
    if (hidden > 0) {
      const toggle = testid(el('button', 'ap-link ap-inbox-expand', m.expanded ? t.showFewer : t.showMore(hidden)), 'needs-you-expand');
      toggle.type = 'button';
      toggle.setAttribute('aria-expanded', String(m.expanded));
      toggle.setAttribute('aria-controls', list.id);
      toggle.addEventListener('click', () => panel.expand(!m.expanded));
      box.append(toggle);
    }
  }
  if (!m.complete && m.needsYou.length && !m.gapped) box.append(testid(el('p', 'ap-note', t.partial), 'needs-you-partial'));
  if (m.canContinue) {
    const row = testid(el('div', 'ap-row ap-inbox-continue'), 'needs-you-continue');
    if (m.moreFailed) row.append(testid(warningLine(t.moreFailed, 'warning', 'span'), 'needs-you-more-failed'));
    button(row, 'needs-you-more', m.loadingMore ? t.moreLoading : m.moreFailed ? t.retry : t.more, panel.more, 'outline', m.loadingMore);
    if (m.loadingMore) { const s = el('span', 'ap-sr', t.moreLoading); s.setAttribute('role', 'status'); row.append(s); }
    box.append(row);
  }
  if (m.alsoBlocked.length) {
    const also = testid(el('details', 'ap-inbox-also'), ATTENTION_HOOKS.alsoBlocked);
    also.dataset.count = String(m.counts.alsoBlocked);
    const summary = el('summary');
    summary.append(icon('chevron-down'), el('span', '', t.also(m.counts.alsoBlocked, m.complete)));
    also.append(summary, el('p', 'ap-note', t.alsoNote), rowList(m.alsoBlocked, 'a', t.alsoListLabel, m, env, options.open));
    box.append(also);
  }
  return box;
}

/**
 * Work Status entry: one line with the count, opening the rail (where the inbox already is). No
 * line without an advertised, verified, readable inbox; never a guessed zero.
 */
export function statusInboxLine(m: InboxModel, locale: string, open: () => void) {
  if (m.availability !== 'ready') return null;
  const t = inboxCopy(locale);
  const line = testid(el('div', 'ap-inbox-line'), 'needs-you-line');
  Object.assign(line.dataset, { count: String(m.counts.needsYou), complete: String(m.complete) });
  const b = el('button', 'ap-inbox-line-open');
  b.type = 'button';
  const summary = inboxSummary(m, locale);
  b.setAttribute('aria-label', t.lineAria(summary));
  const dot = el('span', 'ap-inbox-dot');
  dot.setAttribute('aria-hidden', 'true');
  if (m.counts.needsYou) dot.dataset.tone = 'attention';
  const count = testid(el('span', 'ap-inbox-line-text', summary), ATTENTION_HOOKS.count);
  Object.assign(count.dataset, { count: String(m.counts.needsYou), exact: String(m.complete) });
  const scope = el('span', 'ap-muted', ` · ${t.lineScope}`);
  scope.setAttribute('aria-hidden', 'true');
  b.append(dot, count, scope);
  b.addEventListener('click', open);
  line.append(b);
  return line;
}

/** What the reading may show for its target right now: revalidated against complete current detail. */
export type ReadingCheck =
  | { kind: 'loading' }
  | { kind: 'failed' }
  | { kind: 'gone' }
  | { kind: 'other-setup' }
  | { kind: 'ready'; plan: PlanView; reveal: boolean; notice: string | null; message: string };

export function checkReading(r: InboxReading, detail: Loadable<PlanDetail> | null, plan: PlanView | null, ctx: { storeId: string | null; boundSource: string | null }, locale: string): ReadingCheck {
  const t = inboxCopy(locale);
  if (ctx.storeId !== r.target.storeId || ctx.boundSource !== r.target.source) return { kind: 'other-setup' };
  if (!detail || detail.state === 'loading') return { kind: 'loading' };
  if (detail.state === 'error') return detail.failure.kind === 'not-found' ? { kind: 'gone' } : { kind: 'failed' };
  if (!plan || plan.key !== `${r.target.source}/${r.target.plan}` || detail.value.revision !== plan.revision) return { kind: 'loading' };
  if (plan.sourceId !== r.target.source) return { kind: 'other-setup' };
  const task = detail.value.items.find((i) => i.kind === 'task' && i.id === r.target.task);
  const message = r.group === 'needs-you' ? t.revealNeeds(r.task) : t.revealAlso(r.task);
  const planNote = plan.cleanup?.state === 'archived' ? t.archived : plan.lifecycle !== 'active' ? t.inactive : null;
  if (!task) return { kind: 'ready', plan, reveal: false, notice: [t.taskGone(r.task), planNote].filter(Boolean).join(' '), message };
  const statusNote = task.status !== 'blocked' ? t.notBlocked(task.title, t.statuses[task.status]) : null;
  return { kind: 'ready', plan, reveal: true, notice: [statusNote, planNote].filter(Boolean).join(' ') || null, message };
}

/** The labelled header of a source-wide reading, with its way back. */
export function readingHeader(r: InboxReading, check: ReadingCheck, surface: 'panel' | 'page', locale: string, back: () => void, retry: () => void) {
  const t = inboxCopy(locale);
  const box = testid(el('section', 'ap-inbox-reading'), 'needs-you-reading');
  box.dataset.check = check.kind;
  box.dataset.source = r.target.source;
  box.dataset.plan = r.target.plan;
  box.dataset.task = r.target.task;
  box.setAttribute('aria-labelledby', 'ap-inbox-reading-h');
  const row = el('div', 'ap-row ap-inbox-reading-bar');
  const backButton = testid(el('button', 'ap-inbox-back'), 'needs-you-back');
  backButton.type = 'button';
  backButton.append(el('span', 'ap-inbox-back-arrow', '←'), el('span', '', surface === 'panel' ? t.backPanel : t.backBoard));
  backButton.querySelector('.ap-inbox-back-arrow')!.setAttribute('aria-hidden', 'true');
  backButton.addEventListener('click', back);
  row.append(backButton);
  box.append(row);
  const h = testid(el('h2', 'ap-inbox-reading-h'), 'needs-you-reading-heading');
  h.id = 'ap-inbox-reading-h';
  h.tabIndex = -1;
  h.append(el('span', 'ap-inbox-reading-label', t.readingLabel), el('span', 'ap-inbox-reading-task', r.task));
  box.append(h, el('p', 'ap-note', t.readingNote));
  const status = testid(el('p', 'ap-inbox-reading-status'), 'needs-you-reading-status');
  status.setAttribute('role', 'status');
  if (check.kind === 'loading') status.textContent = t.loading;
  else if (check.kind === 'gone') status.append(warningLine(t.gone, 'warning', 'span'));
  else if (check.kind === 'other-setup') status.append(warningLine(t.otherSetup, 'warning', 'span'));
  else if (check.kind === 'failed') { status.append(warningLine(t.failed, 'warning', 'span')); button(status, 'needs-you-reading-retry', t.retry, retry, 'outline'); }
  else if (check.notice) status.append(warningLine(check.notice, 'info', 'span'));
  box.append(status);
  return box;
}

/**
 * Frame-local reveal and focus follow-ups of the reading (never stored). The target is revealed
 * once per reading through the canonical task path; Back returns focus to the row it came from.
 */
export class ReadingFocus {
  private revealed = 0;
  private back: string | null = null;
  private opened = 0;
  opening(r: InboxReading) { this.opened = r.token; }
  leaving(r: InboxReading) { this.back = r.rowKey; }
  reset() { this.revealed = 0; this.back = null; this.opened = 0; }
  afterPaint(root: HTMLElement, r: InboxReading | null, check: ReadingCheck | null, reveal: (article: HTMLElement, plan: PlanView, item: string, message: string) => void) {
    const owns = document.hasFocus?.() ?? true;
    if (!r) {
      const key = this.back;
      this.back = null;
      if (key === null || !owns) return;
      const row = [...root.querySelectorAll<HTMLElement>('[data-testid="needs-you-row"]')].find((n) => n.dataset.row === key);
      (row?.querySelector<HTMLElement>('.ap-inbox-open') ?? root.querySelector<HTMLElement>('[data-testid="needs-you-heading"]'))?.focus({ preventScroll: true });
      return;
    }
    if (this.opened === r.token) {
      // The row that opened the reading is gone: land on the reading's heading, not the document.
      this.opened = 0;
      if (owns) root.querySelector<HTMLElement>('[data-testid="needs-you-reading-heading"]')?.focus({ preventScroll: true });
    }
    if (!check || check.kind !== 'ready' || this.revealed === r.token) return;
    const article = [...root.querySelectorAll<HTMLElement>('article.ap-plan[data-reading]')].find((a) => a.dataset.testid === `plan-${check.plan.id}` && a.dataset.source === check.plan.sourceId);
    if (!article?.querySelector('.ap-tasks[data-complete]')) return;
    this.revealed = r.token;
    if (check.reveal) reveal(article, check.plan, r.target.task, check.message);
  }
}
