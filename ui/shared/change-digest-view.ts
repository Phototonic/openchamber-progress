// "Since you last reviewed" section above Revisions in full-page History (docs/ui.md). Text only;
// recorded titles land through textContent. All async state and action authority stay in
// change-digest.ts; this file only paints one DigestPanel. No animation, no auto-scroll.
import { mountButton, mountSpinner } from '@openchamber/sdk/ui';
import type { DigestPanel } from './change-digest.ts';
import { digestStatusText, reviewCopy } from './change-digest.ts';
import { age, el, failureCopy, glyph, testid, type Env } from './components.ts';
import { plural } from './format.ts';
import { statusLabel, type Counts, type DigestEvents, type DigestFacet, type DigestFacts, type DigestReason, type DigestReference, type DigestScope, type DigestTask, type DigestView } from './model.ts';
import { resolveLanguage, type InterfaceLanguage } from './i18n.ts';

const RU_FACETS: typeof FACET_LABEL = { completed: 'Выполнено', reopened: 'Больше не выполнено', blocked: 'Сообщено о блокировке', unblocked: 'Блокировка больше не сообщается', added: 'Добавлено', removed: 'Удалено', revised: 'Изменено', skipped: 'Пропущено (исключено из подсчёта)', unskipped: 'Возвращено в подсчёт' };
const facets = (language: InterfaceLanguage) => language === 'ru' ? RU_FACETS : FACET_LABEL;
const EN = { heading: 'Since you last reviewed', loading: 'Loading changes since your last review', refresh: 'Refresh digest', scope: 'Scope', completion: 'Completion', scopeNote: 'Scope changes move the total; they are not completions.', transitions: 'Recorded transitions', nothing: 'Nothing to summarize yet.', reviewed: 'Reviewed', saving: 'Saving…', mark: 'Mark reviewed', invalid: 'This revision can’t be marked reviewed.', historical: 'Historical record only: this task is not in the plan at the reviewed revision.', view: 'View current task', none: 'none', prerequisites: 'Recorded prerequisites', noPrerequisites: 'No prerequisites recorded', group: 'Group', status: 'Status', title: 'Title', before: 'Before', after: 'After', recorded: 'Recorded as', lastRecorded: 'Last recorded as', countSame: 'counted tasks unchanged', countChanged: 'counted tasks changed', doneSame: 'completed count unchanged', doneChanged: 'completed count changed' };
const COPY = {
  en: EN,
  ru: { heading: 'С последнего просмотра', loading: 'Загрузка изменений с последнего просмотра', refresh: 'Обновить изменения', scope: 'Состав', completion: 'Выполнение', scopeNote: 'Изменения состава меняют общее число задач, но не означают выполнение.', transitions: 'Записанные переходы', nothing: 'Пока нечего обобщать.', reviewed: 'Просмотрено', saving: 'Сохранение…', mark: 'Отметить просмотренным', invalid: 'Эту ревизию нельзя отметить просмотренной.', historical: 'Только историческая запись: этой задачи нет в плане на просмотренной ревизии.', view: 'Открыть текущую задачу', none: 'нет', prerequisites: 'Записанные зависимости', noPrerequisites: 'Зависимости не записаны', group: 'Группа', status: 'Статус', title: 'Название', before: 'До', after: 'После', recorded: 'Записано как', lastRecorded: 'Последняя запись', countSame: 'число учитываемых задач не изменилось', countChanged: 'число учитываемых задач изменилось', doneSame: 'число выполненных задач не изменилось', doneChanged: 'число выполненных задач изменилось' },
} satisfies Record<InterfaceLanguage, typeof EN>;

/** Facet names say what was reported, never an inferred cause (an unblocked task is not "solved"). */
export const FACET_LABEL: Record<DigestFacet, string> = {
  completed: 'Completed', reopened: 'No longer done', blocked: 'Reported blocked', unblocked: 'No longer reported blocked',
  added: 'Added', removed: 'Removed', revised: 'Revised', skipped: 'Skipped (left the count)', unskipped: 'Returned to the count',
};
const FACET_ORDER: DigestFacet[] = ['completed', 'reopened', 'blocked', 'unblocked', 'added', 'removed', 'skipped', 'unskipped', 'revised'];
const REASON_TEXT: Record<DigestReason, string> = {
  gap: 'a saved revision in this range is missing',
  'missing-snapshot': 'a saved revision in this range is missing',
  'invalid-snapshot': 'a saved revision is unreadable',
  'revision-bound': 'only the most recent 128 revisions are compared',
  'byte-bound': 'the saved history is too large to compare at once',
};

/** `D/T done (P%)`; a zero total has no percentage (the existing unavailable-percentage rule). */
export function countsText(c: Counts, language: InterfaceLanguage = 'en') {
  if (language === 'ru') return c.total === 0 ? `нет учитываемых задач${c.skipped ? ` (пропущено: ${c.skipped})` : ''}, процент недоступен` : `${c.done}/${c.total} выполнено (${Math.round((c.done / c.total) * 100)}%)`;
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

export const rangeText = (from: number, to: number, language: InterfaceLanguage = 'en') => language === 'ru' ? (from === to ? `ревизия ${to}` : `ревизии ${from}–${to}`) : (from === to ? `revision ${to}` : `revisions ${from}–${to}`);

/**
 * Coverage and qualification, one sentence each; unknown history is never called zero changes.
 * Lines after the first are qualifications when the digest is not complete (warning tone).
 */
export function coverageText(d: DigestView, language: InterfaceLanguage = 'en'): string[] {
  const i = d.interval;
  if (language === 'ru') {
    const reasons: Record<DigestReason, string> = { gap: 'сохранённая ревизия в этом диапазоне отсутствует', 'missing-snapshot': 'сохранённая ревизия в этом диапазоне отсутствует', 'invalid-snapshot': 'сохранённая ревизия нечитаема', 'revision-bound': 'сравниваются только последние 128 ревизий', 'byte-bound': 'сохранённая история слишком велика для одного сравнения' };
    const reason = [...new Set(d.reasons.map(r => reasons[r]))].join('; ');
    const suffix = reason ? ` (${reason})` : '';
    if (d.availability === 'target-unavailable') return [`Ревизию ${i.to} не удалось прочитать: её изменения нельзя показать или отметить просмотренными.`];
    if (d.availability === 'initial') return ['Первый просмотр — в этом профиле нет сохранённой просмотренной ревизии.', `Показана ревизия ${i.to}. Отметьте её просмотренной для сравнения последующих изменений.`];
    if (d.availability === 'baseline-unavailable') return [`Изменения после просмотренной ревизии ${i.after}, до ревизии ${i.to}.`, `Ревизию ${i.after} больше нельзя прочитать, поэтому итоговые числа нельзя сравнить.`, i.coverageStart! < i.to ? `Показаны только изменения в диапазоне: ${rangeText(i.coverageStart!, i.to, language)}${suffix}.` : `Изменения не удалось сравнить${suffix}.`];
    if (i.after === i.to) return [`После просмотра ревизии ${i.to} новых ревизий нет.`];
    return [`Изменения с ревизии ${i.after} до ревизии ${i.to}.`, ...(!d.complete ? [`Сравнены только ${rangeText(i.coverageStart!, i.to, language)}${suffix}; более ранние изменения этого диапазона не показаны. Итоговые числа по-прежнему сравнивают ревизии ${i.after} и ${i.to}.`] : [])];
  }
  if (d.availability === 'target-unavailable') return [`Revision ${i.to} can’t be read, so its changes can’t be shown or marked reviewed.`];
  if (d.availability === 'initial') return ['Initial view — no saved reviewed revision in this profile.', `Showing revision ${i.to}. Mark reviewed to compare later changes against it.`];
  const out: string[] = [];
  const reasons = [...new Set(d.reasons.map((r) => REASON_TEXT[r]))].join('; ');
  if (d.availability === 'baseline-unavailable') {
    out.push(`Changes since your reviewed revision ${i.after}, up to revision ${i.to}.`);
    out.push(`Revision ${i.after} can’t be read any more, so totals can’t be compared.`);
    out.push(i.coverageStart! < i.to ? `Showing changes recorded in ${rangeText(i.coverageStart!, i.to)} only${reasons ? ` (${reasons})` : ''}.` : `No changes could be compared${reasons ? ` (${reasons})` : ''}.`);
    return out;
  }
  if (i.after === i.to) return [`No new revisions since you reviewed revision ${i.to}.`];
  out.push(`Changes from revision ${i.after} to revision ${i.to}.`);
  if (!d.complete) out.push(`Only ${rangeText(i.coverageStart!, i.to)} could be compared${reasons ? ` (${reasons})` : ''}; earlier changes in this range aren’t shown. The totals still compare revisions ${i.after} and ${i.to}.`);
  return out;
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
  const titles: Record<string, string> = { removed: 'Удалённые задачи', blockers: 'Блокировки', completion: 'Выполнение', added: 'Добавленные задачи', scope: 'Пропущенные или возвращённые', revised: 'Изменённые задачи' };
  return GROUPS.filter((g) => out.has(g.id)).map((g) => ({ ...g, title: language === 'ru' ? titles[g.id] : g.title, tasks: out.get(g.id)! }));
}

const occurrenceText = (e: DigestEvents, language: InterfaceLanguage) => FACET_ORDER.filter((f) => e[f]).map((f) => (e[f] > 1 ? `${facets(language)[f]} ×${e[f]}` : facets(language)[f])).join(' · ');

/**
 * Recorded prerequisite IDs of one side. An empty list (omitted or `[]`) only means none were
 * recorded, never that the task needs nothing.
 */
const prerequisitesText = (f: DigestFacts, language: InterfaceLanguage) => (f.dependencies.length ? `${COPY[language].prerequisites}: ${f.dependencies.join(', ')}` : COPY[language].noPrerequisites);

/** What one recorded adjacent pair changed, from its before/after facts only. */
export function referenceText(r: DigestReference, language: InterfaceLanguage = 'en') {
  const copy = COPY[language];
  const parts = [r.facets.map((f) => facets(language)[f]).join(', ') + '.'];
  const a = r.before, b = r.after;
  const facts = (f: DigestFacts) => `“${f.title}” (${statusLabel(f.status, language)})`;
  // Additions and removals carry the one recorded side's group and prerequisites too.
  const place = (f: DigestFacts) => {
    if (f.parentId !== null) parts.push(`${copy.group} ${f.parentId}.`);
    parts.push(`${prerequisitesText(f, language)}.`);
  };
  if (!a && b) { parts.push(`${copy.recorded} ${facts(b)}.`); place(b); }
  else if (a && !b) { parts.push(`${copy.lastRecorded} ${facts(a)}.`); place(a); }
  else if (a && b) {
    if (a.status !== b.status) parts.push(`${copy.status} ${statusLabel(a.status, language)} → ${statusLabel(b.status, language)}.`);
    if (a.title !== b.title) parts.push(`${copy.title} “${a.title}” → “${b.title}”.`);
    if (a.parentId !== b.parentId) parts.push(`${copy.group} ${a.parentId ?? copy.none} → ${b.parentId ?? copy.none}.`);
    if (a.dependencies.join() !== b.dependencies.join()) parts.push(`${copy.before}: ${prerequisitesText(a, language)}. ${copy.after}: ${prerequisitesText(b, language)}.`);
  }
  return parts.join(' ');
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
  const language = resolveLanguage('auto', env.locale), copy = COPY[language], ru = language === 'ru';
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
  coverageText(digest, language).forEach((line, n) => coverage.append(el('p', n > 0 && !digest.complete && digest.availability !== 'initial' ? 'ap-digest-warn' : '', line)));
  if (digest.interval.coverageEndReportedAt) { const p = el('p', 'ap-note'); p.append(age(digest.interval.coverageEndReportedAt, env, ru ? `Ревизия ${digest.interval.to} сообщена ` : `Revision ${digest.interval.to} reported `)); coverage.append(p); }
  section.append(coverage);

  // Notices that ask for Refresh; never replace the displayed text silently.
  const notices: [string, string][] = [];
  if (panel.needsRefresh) notices.push(['digest-stale', ru ? 'План изменился после загрузки изменений (итог или очистка). Обновите изменения перед отметкой о просмотре.' : 'This plan changed since the digest loaded (outcome or cleanup). Refresh digest before marking it reviewed.']);
  if (panel.elsewhere !== null) notices.push(['digest-elsewhere', ru ? `В другом окне или вкладке просмотрено до ревизии ${panel.elsewhere}. Обновите изменения для сравнения от этой точки.` : `Reviewed through revision ${panel.elsewhere} in another window or tab. Refresh digest to compare from there.`]);
  if (panel.newer !== null) notices.push(['digest-newer', ru ? `Доступны новые изменения (ревизия ${panel.newer}). Обновите изменения, чтобы включить их.` : `Newer changes are available (revision ${panel.newer}). Refresh digest to include them.`]);
  for (const [id, text] of notices) section.append(testid(el('p', 'ap-digest-notice', text), id));

  const { before, after, scope } = digest.counts;
  if (after) {
    const counts = testid(el('div', 'ap-digest-counts'), 'digest-counts');
    counts.dataset.done = String(after.done); counts.dataset.total = String(after.total);
    if (before && scope) {
      counts.append(el('p', 'ap-digest-fraction', `${countsText(before, language)} → ${countsText(after, language)}`));
      const lines = scopeLines(before, after, scope, language);
      const ul = testid(el('ul', 'ap-digest-causes'), 'digest-scope');
      const li = (label: string, items: string[]) => { const n = el('li'); n.append(el('b', '', `${label}: `), document.createTextNode(`${items.join('; ')}.`)); ul.append(n); };
      li(copy.scope, lines.scope);
      li(copy.completion, lines.done);
      counts.append(ul, el('p', 'ap-note', copy.scopeNote));
    } else counts.append(el('p', 'ap-digest-fraction', `${ru ? 'Сейчас' : 'Now'} ${countsText(after, language)}`));
    section.append(counts);
  }

  if (digest.availability === 'comparison' || digest.availability === 'baseline-unavailable') {
    const events = digest.summary.events;
    const range = rangeText(digest.interval.coverageStart!, digest.interval.to, language);
    if (!sum(events) && !digest.tasks.length) {
      section.append(testid(el('p', 'ap-note', digest.interval.after === digest.interval.to ? copy.nothing : ru ? `В диапазоне ${range} нет обобщённых изменений задач. Правки только групп и переходы ожидание ↔ в работе не обобщаются; см. ревизии ниже.` : `No summarized task changes in ${digest.complete ? range : `the compared ${range}`}. Group-only edits and pending ↔ in-progress updates aren’t summarized; see Revisions below.`), 'digest-empty'));
    } else {
      const summary = testid(el('div', 'ap-digest-summary'), 'digest-summary');
      summary.append(el('h4', 'ap-digest-h', copy.transitions));
      const ul = el('ul', 'ap-digest-events');
      for (const f of FACET_ORDER) if (events[f]) { const n = el('li', '', `${facets(language)[f]}: ${events[f]}`); n.dataset.facet = f; ul.append(n); }
      summary.append(ul, el('p', 'ap-note', ru ? `Подсчёт по записанным изменениям, а не по задачам${digest.complete ? '' : `, в сравнённом диапазоне: ${range}`}.` : `Counted per recorded change, not per task${digest.complete ? '' : `, in the compared ${range}`}.`));
      section.append(summary);
      for (const group of groupTasks(digest.tasks, language)) {
        const g = testid(el('section', 'ap-digest-group'), `digest-group-${group.id}`);
        g.append(el('h4', 'ap-digest-h', `${group.title} (${group.tasks.length})`));
        const list = el('ul', 'ap-digest-tasks');
        for (const t of group.tasks) list.append(taskRow(t, env, onViewTask));
        g.append(list);
        section.append(g);
      }
      if (digest.details.omittedTasks || digest.details.truncated) {
        const n = digest.details.omittedTaskCount;
        const text = ru ? (digest.details.omittedTasks ? (n === null || n === 0 ? 'Другие изменённые задачи здесь не перечислены.' : `Здесь не перечислено изменённых задач: ${n}.`) : 'Некоторые более ранние записанные изменения здесь не перечислены.') : digest.details.omittedTasks
          ? (n === null || n === 0 ? 'More changed tasks aren’t listed here.' : `${plural(n, 'more changed task isn’t', 'more changed tasks aren’t')} listed here.`)
          : 'Some older recorded changes aren’t listed here.';
        section.append(testid(el('p', 'ap-note', `${text} ${ru ? 'Числа переходов выше по-прежнему включают их.' : 'The transition counts above still include them.'}`), 'digest-omitted'));
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
  note.textContent = ru ? (!digest.validTarget ? copy.invalid : reviewed ? `В этом профиле просмотрено до ревизии ${Math.max(panel.reviewedThrough ?? 0, digest.interval.to)}.` : digest.availability === 'initial' ? `Отмечает ревизию ${digest.interval.to} просмотренной только в этом профиле браузера и аккаунте. План не меняется.` : !digest.complete ? `Следующее сравнение начнётся с ревизии ${digest.interval.to}; более ранние изменения, которые не удалось сравнить, не будут восстановлены.` : `Отмечает ревизию ${digest.interval.to} просмотренной только в этом профиле браузера и аккаунте, не на других устройствах.`) : !digest.validTarget ? copy.invalid
    : reviewed ? `Reviewed through revision ${Math.max(panel.reviewedThrough ?? 0, digest.interval.to)} in this profile.`
      : digest.availability === 'initial' ? `Marks revision ${digest.interval.to} reviewed in this browser profile and account only. Nothing in the plan changes.`
        : !digest.complete ? `Marking reviewed starts the next comparison at revision ${digest.interval.to}; earlier changes that couldn’t be compared won’t be recovered.`
          : `Marks revision ${digest.interval.to} reviewed in this browser profile and account only, not on other devices.`;
  section.append(note, status);
  return section;
}

function taskRow(t: DigestTask, env: Env, onViewTask: (itemId: string, title: string) => void) {
  const language = resolveLanguage('auto', env.locale), copy = COPY[language], ru = language === 'ru';
  const li = testid(el('li', 'ap-digest-task'), `digest-task-${t.id}`);
  li.dataset.present = String(t.presentAtTarget);
  li.dataset.status = t.status;
  const line = el('div', 'ap-digest-line');
  const statusGlyph = glyph(t.status, language);
  statusGlyph.setAttribute('aria-label', statusLabel(t.status, language));
  line.append(statusGlyph, el('span', 'ap-digest-title', t.title));
  line.append(el('span', 'ap-muted ap-small', t.presentAtTarget ? `${ru ? 'Сейчас' : 'Now'} ${statusLabel(t.status, language)}` : `${ru ? 'Удалено — последний статус' : 'Removed — last'} ${statusLabel(t.status, language)}`));
  li.append(line, el('p', 'ap-digest-facets', occurrenceText(t.occurrences, language)));
  if (!t.presentAtTarget) li.append(el('p', 'ap-note', copy.historical));
  const entry = testid(el('details', 'ap-digest-entry'), `digest-entry-${t.id}`);
  const revs = t.references.map((r) => r.to);
  entry.append(el('summary', '', ru ? `Записанные изменения (ревизии: ${revs.join(', ')})` : `Recorded changes (${revs.length > 1 ? 'revisions' : 'revision'} ${revs.join(', ')})`));
  const ol = el('ol', 'ap-digest-refs');
  for (const r of t.references) {
    const n = testid(el('li'), `digest-history-${t.id}-${r.to}`);
    n.append(el('b', '', `${ru ? 'Ревизия' : 'Revision'} ${r.from} → ${r.to}`), document.createTextNode(' · '), age(r.reportedAt, env), el('p', '', referenceText(r, language)));
    ol.append(n);
  }
  entry.append(ol);
  if (t.omittedReferences) entry.append(el('p', 'ap-note', ru ? `Не перечислено более ранних записанных изменений: ${t.omittedReferences}.` : `${plural(t.omittedReferences, 'earlier recorded change isn’t', 'earlier recorded changes aren’t')} listed.`));
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
