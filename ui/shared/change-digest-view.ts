// "Since you last reviewed" section above Revisions in full-page History (docs/ui.md). Text only;
// recorded titles land through textContent. All async state and action authority stay in
// change-digest.ts; this file only paints one DigestPanel. No animation, no auto-scroll.
import { mountButton, mountSpinner } from '@openchamber/sdk/ui';
import type { DigestPanel } from './change-digest.ts';
import { digestStatusText, reviewCopy } from './change-digest.ts';
import { age, el, failureCopy, glyph, testid, type Env } from './components.ts';
import { plural } from './format.ts';
import { statusLabel, type Counts, type DigestEvents, type DigestFacet, type DigestFacts, type DigestReference, type DigestScope, type DigestTask, type DigestView } from './model.ts';
import { resolveLanguage, type InterfaceLanguage } from './i18n.ts';

const RU_FACETS: typeof FACET_LABEL = { completed: 'Выполнено', reopened: 'Больше не выполнено', blocked: 'Сообщено о блокировке', unblocked: 'Блокировка больше не сообщается', added: 'Добавлено', removed: 'Удалено', revised: 'Изменено', skipped: 'Пропущено (исключено из подсчёта)', unskipped: 'Возвращено в подсчёт' };
const ZH_FACETS: typeof FACET_LABEL = { completed: '已完成', reopened: '不再标记为已完成', blocked: '报告为受阻', unblocked: '不再报告为受阻', added: '新增', removed: '移除', revised: '修订', skipped: '已跳过（移出计数）', unskipped: '重新计入' };
const facets = (language: InterfaceLanguage) => language === 'ru' ? RU_FACETS : language === 'zh-CN' ? ZH_FACETS : FACET_LABEL;
const EN = { heading: 'Since you last reviewed', loading: 'Loading changes since your last review', refresh: 'Refresh digest', scope: 'Scope', completion: 'Completion', scopeNote: 'Scope changes move the total; they are not completions.', transitions: 'Recorded transitions', nothing: 'Nothing to summarize yet.', reviewed: 'Reviewed', saving: 'Saving…', mark: 'Mark reviewed', invalid: 'This revision can’t be marked reviewed.', historical: 'Historical record only: this task is not in the plan at the reviewed revision.', view: 'View current task', none: 'none', prerequisites: 'Recorded prerequisites', noPrerequisites: 'No prerequisites recorded', group: 'Group', status: 'Status', title: 'Title', before: 'Before', after: 'After', recorded: 'Recorded as', lastRecorded: 'Last recorded as', countSame: 'counted tasks unchanged', countChanged: 'counted tasks changed', doneSame: 'completed count unchanged', doneChanged: 'completed count changed' };
const COPY = {
  en: EN,
  ru: { heading: 'С последнего просмотра', loading: 'Загрузка изменений с последнего просмотра', refresh: 'Обновить изменения', scope: 'Состав', completion: 'Выполнение', scopeNote: 'Изменения состава меняют общее число задач, но не означают выполнение.', transitions: 'Записанные переходы', nothing: 'Пока нечего обобщать.', reviewed: 'Просмотрено', saving: 'Сохранение…', mark: 'Отметить просмотренным', invalid: 'Эту ревизию нельзя отметить просмотренной.', historical: 'Только историческая запись: этой задачи нет в плане на просмотренной ревизии.', view: 'Открыть текущую задачу', none: 'нет', prerequisites: 'Записанные зависимости', noPrerequisites: 'Зависимости не записаны', group: 'Группа', status: 'Статус', title: 'Название', before: 'До', after: 'После', recorded: 'Записано как', lastRecorded: 'Последняя запись', countSame: 'число учитываемых задач не изменилось', countChanged: 'число учитываемых задач изменилось', doneSame: 'число выполненных задач не изменилось', doneChanged: 'число выполненных задач изменилось' },
  'zh-CN': { heading: '上次审阅以来', loading: '正在加载上次审阅以来的变更', refresh: '刷新摘要', scope: '范围', completion: '完成情况', scopeNote: '范围变更会改变总数，不代表任务完成。', transitions: '记录的状态变化', nothing: '目前没有可汇总的内容。', reviewed: '已审阅', saving: '正在保存…', mark: '标记为已审阅', invalid: '无法将此修订标记为已审阅。', historical: '仅为历史记录：此任务不在所审阅修订的计划中。', view: '查看当前任务', none: '无', prerequisites: '记录的前置任务', noPrerequisites: '未记录前置任务', group: '分组', status: '状态', title: '标题', before: '之前', after: '之后', recorded: '记录为', lastRecorded: '最后记录为', countSame: '计数任务数不变', countChanged: '计数任务数发生变化', doneSame: '完成数量不变', doneChanged: '完成数量发生变化' },
} satisfies Record<InterfaceLanguage, typeof EN>;

/** Facet names say what was reported, never an inferred cause (an unblocked task is not "solved"). */
export const FACET_LABEL: Record<DigestFacet, string> = {
  completed: 'Completed', reopened: 'No longer done', blocked: 'Reported blocked', unblocked: 'No longer reported blocked',
  added: 'Added', removed: 'Removed', revised: 'Revised', skipped: 'Skipped (left the count)', unskipped: 'Returned to the count',
};
const FACET_ORDER: DigestFacet[] = ['completed', 'reopened', 'blocked', 'unblocked', 'added', 'removed', 'skipped', 'unskipped', 'revised'];

/** `D/T done (P%)`; a zero total has no percentage (the existing unavailable-percentage rule). */
export function countsText(c: Counts, language: InterfaceLanguage = 'en') {
  if (language === 'ru') return c.total === 0 ? `нет учитываемых задач${c.skipped ? ` (пропущено: ${c.skipped})` : ''}, процент недоступен` : `${c.done}/${c.total} выполнено (${Math.round((c.done / c.total) * 100)}%)`;
  if (language === 'zh-CN') return c.total === 0 ? `没有计入的任务${c.skipped ? `（${c.skipped} 项已跳过）` : ''}，无百分比` : `已完成 ${c.done}/${c.total}（${Math.round((c.done / c.total) * 100)}%）`;
  if (c.total === 0) return `no counted tasks${c.skipped ? ` (${c.skipped} skipped)` : ''}, no percentage`;
  return `${c.done}/${c.total} done (${Math.round((c.done / c.total) * 100)}%)`;
}

/**
 * Endpoint count causes, scope kept apart from completion: added/removed/skipped/returned explain
 * the total; completed/reopened/added-done/removed-done explain done. No percentage-point allocation.
 */
export function scopeLines(before: Counts, after: Counts, s: DigestScope, language: InterfaceLanguage = 'en') {
  if (language === 'ru') {
    const scope: string[] = [], done: string[] = [];
    const phrases = { addedCounted: 'Добавлено учитываемых задач', removedCounted: 'Удалено учитываемых задач', skipped: 'Пропущено существующих задач с исключением из подсчёта', unskipped: 'Возвращено пропущенных задач в подсчёт', completed: 'Теперь выполнено существующих задач', reopened: 'Больше не выполнено задач', addedDone: 'Добавлено уже выполненных задач', removedDone: 'Удалено выполненных задач' };
    for (const key of ['addedCounted', 'removedCounted', 'skipped', 'unskipped'] as const) if (s[key]) scope.push(`${phrases[key]}: ${s[key]}`);
    for (const key of ['completed', 'reopened', 'addedDone', 'removedDone'] as const) if (s[key]) done.push(`${phrases[key]}: ${s[key]}`);
    if (!scope.length) scope.push(after.total === before.total ? COPY.ru.countSame : COPY.ru.countChanged);
    if (!done.length) done.push(after.done === before.done ? COPY.ru.doneSame : COPY.ru.doneChanged);
    return { scope, done };
  }
  if (language === 'zh-CN') {
    const scope: string[] = [], done: string[] = [];
    const zcopy = COPY[language];
    if (s.addedCounted) scope.push(`新增 ${s.addedCounted} 项计数任务`);
    if (s.removedCounted) scope.push(`移除 ${s.removedCounted} 项计数任务`);
    if (s.skipped) scope.push(`${s.skipped} 项已有任务被跳过并移出计数`);
    if (s.unskipped) scope.push(`${s.unskipped} 项已跳过任务重新计入`);
    if (!scope.length) scope.push(after.total === before.total ? zcopy.countSame : zcopy.countChanged);
    if (s.completed) done.push(`${s.completed} 项已有任务现已完成`);
    if (s.reopened) done.push(`${s.reopened} 项任务不再完成`);
    if (s.addedDone) done.push(`${s.addedDone} 项新增任务原已完成`);
    if (s.removedDone) done.push(`移除 ${s.removedDone} 项已完成任务`);
    if (!done.length) done.push(after.done === before.done ? zcopy.doneSame : zcopy.doneChanged);
    return { scope, done };
  }
  const scope: string[] = [];
  if (s.addedCounted) scope.push(`${plural(s.addedCounted, 'counted task', 'counted tasks')} added`);
  if (s.removedCounted) scope.push(`${plural(s.removedCounted, 'counted task', 'counted tasks')} removed`);
  if (s.skipped) scope.push(`${plural(s.skipped, 'existing task', 'existing tasks')} skipped, leaving the count`);
  if (s.unskipped) scope.push(`${plural(s.unskipped, 'skipped task', 'skipped tasks')} returned to the count`);
  if (!scope.length) scope.push(after.total === before.total ? 'counted tasks unchanged' : 'counted tasks changed');
  const done: string[] = [];
  if (s.completed) done.push(`${plural(s.completed, 'existing task', 'existing tasks')} now done`);
  if (s.reopened) done.push(`${plural(s.reopened, 'task', 'tasks')} no longer done`);
  if (s.addedDone) done.push(`${plural(s.addedDone, 'added task was', 'added tasks were')} already done`);
  if (s.removedDone) done.push(`${plural(s.removedDone, 'done task', 'done tasks')} removed`);
  if (!done.length) done.push(after.done === before.done ? 'completed count unchanged' : 'completed count changed');
  return { scope, done };
}

export const rangeText = (from: number, to: number, language: InterfaceLanguage = 'en') => language === 'ru' ? (from === to ? `обновление ${to}` : `обновления ${from}–${to}`) : language === 'zh-CN' ? (from === to ? `更新 ${to}` : `更新 ${from}–${to}`) : (from === to ? `update ${to}` : `updates ${from}–${to}`);

/**
 * One calm qualification; unknown history is never called zero changes.
 * Diagnostic bounds remain in Advanced details and the support summary.
 */
export function coverageText(d: DigestView, language: InterfaceLanguage = 'en'): string[] {
  const text = {
    en: { unavailable: 'Couldn’t load these changes; try again.', initial: 'Mark reviewed to compare future changes with this plan.', baseline: 'The earlier plan is unavailable, so totals can’t be compared.', same: 'No changes since your last review.', partial: 'Some earlier changes couldn’t be compared.', complete: 'Changes since your last review.' },
    ru: { unavailable: 'Не удалось загрузить изменения; попробуйте снова.', initial: 'Отметьте план просмотренным, чтобы сравнивать будущие изменения.', baseline: 'Прежний план недоступен, поэтому итоги нельзя сравнить.', same: 'С последнего просмотра изменений нет.', partial: 'Некоторые прежние изменения не удалось сравнить.', complete: 'Изменения с последнего просмотра.' },
    'zh-CN': { unavailable: '无法加载这些变更，请重试。', initial: '标记为已审阅，以便比较今后的变更。', baseline: '较早的计划不可用，无法比较总数。', same: '上次审阅后没有变更。', partial: '部分较早的变更无法比较。', complete: '上次审阅以来的变更。' },
  }[language];
  return [d.availability === 'target-unavailable' ? text.unavailable
    : d.availability === 'initial' ? text.initial
    : d.availability === 'baseline-unavailable' ? text.baseline
    : d.interval.after === d.interval.to ? text.same
    : !d.complete ? text.partial : text.complete];
}

const sum = (e: DigestEvents) => FACET_ORDER.reduce((n, f) => n + e[f], 0);

/** Task groups by most significant reported facet; rows keep the digest's recent-first order. */
const GROUPS: { id: string; title: string; test: (t: DigestTask) => boolean }[] = [
  { id: 'removed', title: 'Removed tasks', test: (t) => !t.presentAtTarget },
  { id: 'blockers', title: 'Blockers', test: (t) => t.occurrences.blocked + t.occurrences.unblocked > 0 },
  { id: 'completion', title: 'Completion', test: (t) => t.occurrences.completed + t.occurrences.reopened > 0 },
  { id: 'added', title: 'Added tasks', test: (t) => t.occurrences.added > 0 },
  { id: 'scope', title: 'Skipped or returned', test: (t) => t.occurrences.skipped + t.occurrences.unskipped > 0 },
  { id: 'revised', title: 'Revised tasks', test: () => true },
];
export function groupTasks(tasks: DigestTask[], language: InterfaceLanguage = 'en') {
  const out = new Map<string, DigestTask[]>();
  for (const t of tasks) {
    const g = GROUPS.find((x) => x.test(t))!;
    out.set(g.id, [...(out.get(g.id) ?? []), t]);
  }
  const ruTitles: Record<string, string> = { removed: 'Удалённые задачи', blockers: 'Блокировки', completion: 'Выполнение', added: 'Добавленные задачи', scope: 'Пропущенные или возвращённые', revised: 'Изменённые задачи' };
  const zhTitles: Record<string, string> = { removed: '已移除任务', blockers: '阻塞情况', completion: '完成情况', added: '新增任务', scope: '已跳过或重新计入', revised: '已修订任务' };
  return GROUPS.filter((g) => out.has(g.id)).map((g) => ({ ...g, title: language === 'ru' ? ruTitles[g.id] : language === 'zh-CN' ? zhTitles[g.id] : g.title, tasks: out.get(g.id)! }));
}

const occurrenceText = (e: DigestEvents, language: InterfaceLanguage) => FACET_ORDER.filter((f) => e[f]).map((f) => (e[f] > 1 ? `${facets(language)[f]} ×${e[f]}` : facets(language)[f])).join(' · ');

/**
 * Recorded prerequisite IDs of one side. An empty list (omitted or `[]`) only means none were
 * recorded, never that the task needs nothing.
 */
const prerequisitesText = (f: DigestFacts, language: InterfaceLanguage) => (f.dependencies.length ? language === 'zh-CN' ? `${COPY[language].prerequisites}：${f.dependencies.join('、')}` : `${COPY[language].prerequisites}: ${f.dependencies.join(', ')}` : COPY[language].noPrerequisites);

/** What one recorded adjacent pair changed, from its before/after facts only. */
export function referenceText(r: DigestReference, language: InterfaceLanguage = 'en') {
  const copy = COPY[language];
  const zh = language === 'zh-CN';
  const stop = zh ? '。' : '.';
  const parts = [r.facets.map((f) => facets(language)[f]).join(zh ? '，' : ', ') + stop];
  const a = r.before, b = r.after;
  const facts = (f: DigestFacts) => zh ? `“${f.title}”（${statusLabel(f.status, language)}）` : `“${f.title}” (${statusLabel(f.status, language)})`;
  // Additions and removals carry the one recorded side's group and prerequisites too.
  const place = (f: DigestFacts) => {
    if (f.parentId !== null) parts.push(`${copy.group} ${f.parentId}${stop}`);
    parts.push(`${prerequisitesText(f, language)}${stop}`);
  };
  if (!a && b) { parts.push(zh ? `${copy.recorded}${facts(b)}${stop}` : `${copy.recorded} ${facts(b)}.`); place(b); }
  else if (a && !b) { parts.push(zh ? `${copy.lastRecorded}${facts(a)}${stop}` : `${copy.lastRecorded} ${facts(a)}.`); place(a); }
  else if (a && b) {
    if (a.status !== b.status) parts.push(`${copy.status} ${statusLabel(a.status, language)} → ${statusLabel(b.status, language)}${stop}`);
    if (a.title !== b.title) parts.push(zh ? `${copy.title}“${a.title}” → “${b.title}”${stop}` : `${copy.title} “${a.title}” → “${b.title}”.`);
    if (a.parentId !== b.parentId) parts.push(`${copy.group} ${a.parentId ?? copy.none} → ${b.parentId ?? copy.none}${stop}`);
    if (a.dependencies.join() !== b.dependencies.join()) parts.push(zh ? `${copy.before}：${prerequisitesText(a, language)}${stop}${copy.after}：${prerequisitesText(b, language)}${stop}` : `${copy.before}: ${prerequisitesText(a, language)}. ${copy.after}: ${prerequisitesText(b, language)}.`);
  }
  return parts.join(zh ? '' : ' ');
}

let announcer: HTMLElement | null = null;
let announced = 0;
let announcedText = '';
let announcement = 0;
/**
 * One persistent polite live region outside the repainted root (repaints replace the root, and a
 * freshly inserted live region is announced unreliably). Each explicit outcome is spoken once; a
 * repaint or poll with unchanged outcome text says nothing; a language change refreshes the text.
 */
export function announceDigest(id: number, text: string) {
  if (!id || !text || (id === announced && text === announcedText)) return;
  announced = id;
  announcedText = text;
  const version = ++announcement;
  if (!announcer?.isConnected) {
    announcer = testid(el('p', 'ap-sr'), 'digest-announcer');
    announcer.setAttribute('role', 'status'); announcer.setAttribute('aria-live', 'polite'); announcer.setAttribute('aria-atomic', 'true');
    document.body.append(announcer);
  }
  const node = announcer;
  node.textContent = '';
  // Next frame, so an identical repeated outcome is still a change for assistive technology.
  requestAnimationFrame(() => { if (announcement === version) node.textContent = announcedText; });
}

/** Native kit button whose hook and focus survive repaints; unavailable controls stay focusable (aria-disabled). */
function action(parent: HTMLElement, id: string, label: string, run: (event: MouseEvent) => void, enabled: boolean, variant: 'outline' | 'default' = 'outline') {
  const holder = el('span');
  mountButton(holder, { label, variant, size: variant === 'default' ? 'sm' : 'xs', onClick: () => {} });
  const b = holder.querySelector('button')!;
  b.dataset.testid = id;
  if (!enabled) b.setAttribute('aria-disabled', 'true');
  b.addEventListener('click', (event) => { if (b.getAttribute('aria-disabled') !== 'true') run(event); });
  parent.append(holder);
  return b;
}

function unavailableText(panel: DigestPanel, language: InterfaceLanguage): { text: string; retry: boolean } {
  const u = panel.unavailable!;
  if (language === 'ru') {
    switch (u.reason) {
      case 'service': return { text: 'Сервис прогресса не поддерживает сравнение ревизий. Обновите расширение и companion, чтобы видеть изменения с последнего просмотра.', retry: false };
      case 'checkpoint': return { text: u.checkpoint === 'unsupported' ? 'Эта версия OpenChamber не может сохранить точку просмотра на устройстве, поэтому изменения с последнего просмотра недоступны. Ревизии ниже остаются доступны.' : `${reviewCopy(u.checkpoint, language)} Изменения с последнего просмотра сейчас недоступны; ничего не изменено.`, retry: u.checkpoint !== 'unsupported' };
      case 'ahead': return { text: `Сохранённая точка просмотра (ревизия ${u.saved}) новее последней ревизии плана (${u.latest}) и не может использоваться. Ничего не изменено.`, retry: true };
      case 'missing': return { text: 'Этот план больше недоступен: просматривать нечего.', retry: false };
      case 'conflict': return { text: 'План изменился во время загрузки изменений. Обновите их для повторной попытки.', retry: true };
      case 'read': return { text: `Не удалось загрузить изменения с последнего просмотра. ${failureCopy(u.failure.kind, language).title}.`, retry: true };
    }
  }
  if (language === 'zh-CN') {
    switch (u.reason) {
      case 'service': return { text: '此进度服务无法比较修订。请更新扩展及其 companion 以查看上次审阅以来的变更。', retry: false };
      case 'checkpoint': return { text: u.checkpoint === 'unsupported' ? '此 OpenChamber 版本无法在此设备记住审阅点，因此无法显示上次审阅以来的变更。下方修订仍可用。' : `${reviewCopy(u.checkpoint, language)}目前无法显示上次审阅以来的变更；没有更改任何内容。`, retry: u.checkpoint !== 'unsupported' };
      case 'ahead': return { text: `保存的审阅点（修订 ${u.saved}）比计划最新修订（${u.latest}）更新，因此无法使用。没有更改任何内容。`, retry: true };
      case 'missing': return { text: '此计划已不可用，无内容可审阅。', retry: false };
      case 'conflict': return { text: '摘要加载期间计划已改变。请刷新摘要重试。', retry: true };
      case 'read': return { text: `无法加载上次审阅以来的变更。${failureCopy(u.failure.kind, language).title}。`, retry: true };
    }
  }
  switch (u.reason) {
    case 'service': return { text: 'This progress service can’t compare revisions. Update the extension and its companion to see changes since your last review.', retry: false };
    case 'checkpoint': return u.checkpoint === 'unsupported'
      ? { text: 'This OpenChamber version can’t remember a review point on this device, so changes since your last review can’t be shown. Revisions below stay available.', retry: false }
      : { text: `${reviewCopy(u.checkpoint)} Changes since your last review can’t be shown right now; nothing was changed.`, retry: true };
    case 'ahead': return { text: `The saved review point (revision ${u.saved}) is newer than this plan’s latest revision (${u.latest}), so it can’t be used. Nothing was changed.`, retry: true };
    case 'missing': return { text: 'This plan is no longer available, so there is nothing to review.', retry: false };
    case 'conflict': return { text: 'This plan changed while its digest loaded. Refresh digest to try again.', retry: true };
    case 'read': return { text: `Changes since your last review couldn’t be loaded. ${failureCopy(u.failure.kind, language).title}.`, retry: true };
  }
}

export function digestBlock(panel: DigestPanel, env: Env, onViewTask: (itemId: string, title: string) => void) {
  const language = resolveLanguage('auto', env.locale), copy = COPY[language], ru = language === 'ru', zh = language === 'zh-CN';
  const section = testid(el('section', 'ap-section ap-digest'), 'change-digest');
  const heading = el('h3', 'ap-h', copy.heading);
  heading.id = 'ap-digest-heading';
  section.setAttribute('aria-labelledby', heading.id);
  section.append(heading);
  const d = panel.digest;
  section.dataset.state = panel.state === 'ready' ? d!.availability : panel.state;
  section.dataset.review = panel.review;
  if (panel.unavailable) section.dataset.reason = panel.unavailable.reason === 'checkpoint' ? `checkpoint-${panel.unavailable.checkpoint}` : panel.unavailable.reason;
  // Visible copy of the last explicit outcome; only announceDigest speaks it, once.
  const statusText = panel.statusMessage ? digestStatusText(panel.statusMessage, language) : panel.status;
  const status = testid(el('p', 'ap-note ap-digest-status', statusText), 'digest-status');
  announceDigest(panel.statusId, statusText);

  if (panel.state === 'loading') {
    const slot = testid(el('div', 'ap-row ap-note'), 'digest-loading');
    mountSpinner(slot, { size: 'sm', label: copy.loading });
    section.append(slot, status);
    return section;
  }
  if (panel.state === 'unavailable') {
    const { text, retry } = unavailableText(panel, language);
    section.append(testid(el('p', 'ap-digest-warn', text), 'digest-unavailable'));
    const row = el('div', 'ap-row');
    if (retry) action(row, 'digest-refresh', copy.refresh, () => panel.refresh(), panel.canRefresh);
    if (row.childNodes.length) section.append(row);
    section.append(status);
    return section;
  }

  const digest = d!;
  section.dataset.to = String(digest.interval.to);
  if (digest.interval.after !== null) section.dataset.after = String(digest.interval.after);
  const coverage = testid(el('div', 'ap-digest-coverage'), 'digest-coverage');
  coverage.dataset.complete = String(digest.complete);
  coverage.dataset.reasons = digest.reasons.join(' ');
  coverageText(digest, language).forEach(line => coverage.append(el('p', 'ap-note', line)));
  if (digest.interval.coverageEndReportedAt) { const p = el('p', 'ap-note'); p.append(age(digest.interval.coverageEndReportedAt, env, ru ? `Ревизия ${digest.interval.to} сообщена ` : zh ? `修订 ${digest.interval.to} 报告于 ` : `Revision ${digest.interval.to} reported `)); coverage.append(p); }
  section.append(coverage);

  // Notices that ask for Refresh; never replace the displayed text silently.
  const notices: [string, string][] = [];
  if (panel.needsRefresh) notices.push(['digest-stale', ru ? 'План изменился после загрузки изменений (итог или очистка). Обновите изменения перед отметкой о просмотре.' : zh ? '摘要加载后计划已改变（结果或清理状态）。标记审阅前请刷新摘要。' : 'This plan changed since the digest loaded (outcome or cleanup). Refresh digest before marking it reviewed.']);
  if (panel.elsewhere !== null) notices.push(['digest-elsewhere', ru ? `В другом окне или вкладке просмотрено до ревизии ${panel.elsewhere}. Обновите изменения для сравнения от этой точки.` : zh ? `另一个窗口或标签页已审阅至修订 ${panel.elsewhere}。请刷新摘要以从该处比较。` : `Reviewed through revision ${panel.elsewhere} in another window or tab. Refresh digest to compare from there.`]);
  if (panel.newer !== null) notices.push(['digest-newer', ru ? `Доступны новые изменения (ревизия ${panel.newer}). Обновите изменения, чтобы включить их.` : zh ? `有更新的变更（修订 ${panel.newer}）。请刷新摘要以包含这些变更。` : `Newer changes are available (revision ${panel.newer}). Refresh digest to include them.`]);
  for (const [id, text] of notices) section.append(testid(el('p', 'ap-digest-notice', text), id));

  const { before, after, scope } = digest.counts;
  if (after) {
    const counts = testid(el('div', 'ap-digest-counts'), 'digest-counts');
    counts.dataset.done = String(after.done); counts.dataset.total = String(after.total);
    if (before && scope) {
      counts.append(el('p', 'ap-digest-fraction', `${countsText(before, language)} → ${countsText(after, language)}`));
      const lines = scopeLines(before, after, scope, language);
      const ul = testid(el('ul', 'ap-digest-causes'), 'digest-scope');
      const li = (label: string, items: string[]) => { const n = el('li'); n.append(el('b', '', zh ? `${label}：` : `${label}: `), document.createTextNode(zh ? `${items.join('；')}。` : `${items.join('; ')}.`)); ul.append(n); };
      li(copy.scope, lines.scope);
      li(copy.completion, lines.done);
      counts.append(ul, el('p', 'ap-note', copy.scopeNote));
    } else counts.append(el('p', 'ap-digest-fraction', `${ru ? 'Сейчас' : zh ? '当前' : 'Now'} ${countsText(after, language)}`));
    section.append(counts);
  }

  if (digest.availability === 'comparison' || digest.availability === 'baseline-unavailable') {
    const events = digest.summary.events;
    const range = rangeText(digest.interval.coverageStart!, digest.interval.to, language);
    if (!sum(events) && !digest.tasks.length) {
      section.append(testid(el('p', 'ap-note', digest.interval.after === digest.interval.to ? copy.nothing : ru ? `В диапазоне ${range} нет обобщённых изменений задач. Правки только групп и переходы ожидание ↔ в работе не обобщаются; см. ревизии ниже.` : zh ? `${digest.complete ? range : `已比较的${range}`}中没有汇总的任务变更。仅分组编辑和待处理 ↔ 进行中变更不计入摘要；请参阅下方修订。` : `No summarized task changes in ${digest.complete ? range : `the compared ${range}`}. Group-only edits and pending ↔ in-progress updates aren’t summarized; see Revisions below.`), 'digest-empty'));
    } else {
      const summary = testid(el('div', 'ap-digest-summary'), 'digest-summary');
      summary.append(el('h4', 'ap-digest-h', copy.transitions));
      const ul = el('ul', 'ap-digest-events');
      for (const f of FACET_ORDER) if (events[f]) { const n = el('li', '', `${facets(language)[f]}${zh ? '：' : ': '}${events[f]}`); n.dataset.facet = f; ul.append(n); }
      summary.append(ul, el('p', 'ap-note', ru ? `Подсчёт по записанным изменениям, а не по задачам${digest.complete ? '' : `, в сравнённом диапазоне: ${range}`}.` : zh ? `按记录的每次变更计数，而非按任务计数${digest.complete ? '' : `；范围为已比较的${range}`}。` : `Counted per recorded change, not per task${digest.complete ? '' : `, in the compared ${range}`}.`));
      section.append(summary);
      for (const group of groupTasks(digest.tasks, language)) {
        const g = testid(el('section', 'ap-digest-group'), `digest-group-${group.id}`);
        g.append(el('h4', 'ap-digest-h', zh ? `${group.title}（${group.tasks.length}）` : `${group.title} (${group.tasks.length})`));
        const list = el('ul', 'ap-digest-tasks');
        for (const t of group.tasks) list.append(taskRow(t, env, onViewTask));
        g.append(list);
        section.append(g);
      }
      if (digest.details.omittedTasks || digest.details.truncated) {
        const n = digest.details.omittedTaskCount;
        const text = ru ? (digest.details.omittedTasks ? (n === null || n === 0 ? 'Другие изменённые задачи здесь не перечислены.' : `Здесь не перечислено изменённых задач: ${n}.`) : 'Некоторые более ранние записанные изменения здесь не перечислены.') : zh ? (digest.details.omittedTasks ? (n === null || n === 0 ? '此处未列出更多已变更任务。' : `此处未列出另外 ${n} 项已变更任务。`) : '此处未列出部分更早的记录变更。') : digest.details.omittedTasks
          ? (n === null || n === 0 ? 'More changed tasks aren’t listed here.' : `${plural(n, 'more changed task isn’t', 'more changed tasks aren’t')} listed here.`)
          : 'Some older recorded changes aren’t listed here.';
        section.append(testid(el('p', 'ap-note', zh ? `${text}上述状态变化计数仍包含这些内容。` : `${text} ${ru ? 'Числа переходов выше по-прежнему включают их.' : 'The transition counts above still include them.'}`), 'digest-omitted'));
      }
    }
  }

  const actions = testid(el('div', 'ap-row ap-digest-actions'), 'digest-actions');
  const reviewed = panel.review === 'saved' || (panel.reviewedThrough !== null && panel.reviewedThrough >= digest.interval.to);
  const mark = action(actions, 'digest-mark-reviewed', reviewed ? copy.reviewed : panel.review === 'pending' ? copy.saving : copy.mark, (event) => panel.markReviewed({ isTrusted: event.isTrusted }), panel.canReview, 'default');
  mark.setAttribute('aria-describedby', 'ap-digest-review-note');
  action(actions, 'digest-refresh', copy.refresh, () => panel.refresh(), panel.canRefresh);
  section.append(actions);
  const note = testid(el('p', 'ap-note'), 'digest-review-note');
  note.id = 'ap-digest-review-note';
  note.textContent = ru ? (!digest.validTarget ? copy.invalid : reviewed ? `В этом профиле просмотрено до ревизии ${Math.max(panel.reviewedThrough ?? 0, digest.interval.to)}.` : digest.availability === 'initial' ? `Отмечает ревизию ${digest.interval.to} просмотренной только в этом профиле браузера и аккаунте. План не меняется.` : !digest.complete ? `Следующее сравнение начнётся с ревизии ${digest.interval.to}; более ранние изменения, которые не удалось сравнить, не будут восстановлены.` : `Отмечает ревизию ${digest.interval.to} просмотренной только в этом профиле браузера и аккаунте, не на других устройствах.`) : zh ? (!digest.validTarget ? copy.invalid : reviewed ? `此配置文件已审阅至修订 ${Math.max(panel.reviewedThrough ?? 0, digest.interval.to)}。` : digest.availability === 'initial' ? `仅在此浏览器配置文件和账户中将修订 ${digest.interval.to} 标记为已审阅。计划不会改变。` : !digest.complete ? `标记审阅后下次从修订 ${digest.interval.to} 开始比较；此前无法比较的变更不会恢复。` : `仅在此浏览器配置文件和账户中将修订 ${digest.interval.to} 标记为已审阅，其他设备不受影响。`) : !digest.validTarget ? copy.invalid
    : reviewed ? `Reviewed through revision ${Math.max(panel.reviewedThrough ?? 0, digest.interval.to)} in this profile.`
      : digest.availability === 'initial' ? `Marks revision ${digest.interval.to} reviewed in this browser profile and account only. Nothing in the plan changes.`
        : !digest.complete ? `Marking reviewed starts the next comparison at revision ${digest.interval.to}; earlier changes that couldn’t be compared won’t be recovered.`
          : `Marks revision ${digest.interval.to} reviewed in this browser profile and account only, not on other devices.`;
  section.append(note, status);
  return section;
}

function taskRow(t: DigestTask, env: Env, onViewTask: (itemId: string, title: string) => void) {
  const language = resolveLanguage('auto', env.locale), copy = COPY[language], ru = language === 'ru', zh = language === 'zh-CN';
  const li = testid(el('li', 'ap-digest-task'), `digest-task-${t.id}`);
  li.dataset.present = String(t.presentAtTarget);
  li.dataset.status = t.status;
  const line = el('div', 'ap-digest-line');
  const statusGlyph = glyph(t.status, language);
  statusGlyph.setAttribute('aria-label', statusLabel(t.status, language));
  line.append(statusGlyph, el('span', 'ap-digest-title', t.title));
  line.append(el('span', 'ap-muted ap-small', t.presentAtTarget ? `${ru ? 'Сейчас' : zh ? '当前' : 'Now'} ${statusLabel(t.status, language)}` : `${ru ? 'Удалено — последний статус' : zh ? '已移除——最后状态' : 'Removed — last'} ${statusLabel(t.status, language)}`));
  li.append(line, el('p', 'ap-digest-facets', occurrenceText(t.occurrences, language)));
  if (!t.presentAtTarget) li.append(el('p', 'ap-note', copy.historical));
  const entry = testid(el('details', 'ap-digest-entry'), `digest-entry-${t.id}`);
  const revs = t.references.map((r) => r.to);
  entry.append(el('summary', '', ru ? `Записанные изменения (ревизии: ${revs.join(', ')})` : zh ? `记录的变更（修订：${revs.join('、')}）` : `Recorded changes (${revs.length > 1 ? 'revisions' : 'revision'} ${revs.join(', ')})`));
  const ol = el('ol', 'ap-digest-refs');
  for (const r of t.references) {
    const n = testid(el('li'), `digest-history-${t.id}-${r.to}`);
    n.append(el('b', '', `${ru ? 'Ревизия' : zh ? '修订' : 'Revision'} ${r.from} → ${r.to}`), document.createTextNode(' · '), age(r.reportedAt, env), el('p', '', referenceText(r, language)));
    ol.append(n);
  }
  entry.append(ol);
  if (t.omittedReferences) entry.append(el('p', 'ap-note', ru ? `Не перечислено более ранних записанных изменений: ${t.omittedReferences}.` : zh ? `未列出 ${t.omittedReferences} 条更早的记录变更。` : `${plural(t.omittedReferences, 'earlier recorded change isn’t', 'earlier recorded changes aren’t')} listed.`));
  li.append(entry);
  if (t.presentAtTarget) {
    const b = el('button', 'ap-link', copy.view);
    b.type = 'button';
    b.dataset.testid = `digest-view-${t.id}`;
    b.setAttribute('aria-label', `${copy.view}: ${t.title}`);
    b.addEventListener('click', () => onViewTask(t.id, t.title));
    li.append(b);
  }
  return li;
}
