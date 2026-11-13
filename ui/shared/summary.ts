// Deterministic, recorded-only Markdown. No clock, browser, live sessions or service access.
import { DOCUMENT_STATE_TEXT, LIFECYCLE_LABEL, STATUS_LABEL, type ItemView } from './model.ts';
import type { InterfaceLanguage } from './i18n.ts';
import { readiness } from './readiness.ts';
import type { CompleteDetailResult, DetailFailureCause, DetailSnapshot } from './source.ts';

/** Escape recorded literals, including multiline/HTML-looking titles, as a single Markdown line. */
export function markdownLiteral(text: string): string {
  return text.replace(/\r\n?|\n|\u2028|\u2029/g, ' ').replace(/[\\`*_{}\[\]()#+.!|>~\-]/g, '\\$&').replace(/&/g, '&amp;').replace(/</g, '&lt;');
}

/** Fixed copy only: service messages and arbitrary diagnostic values are never interpolated. */
export function describeDetailFailure(cause: DetailFailureCause, language: InterfaceLanguage = 'en'): string {
  const t = TEXT[language];
  return cause.kind === 'store' ? cause.code === 'unknown' ? t.storeUnavailable : t.storeFailure(cause.code) : t.failure[cause.kind];
}

const EN = {
  lifecycle: LIFECYCLE_LABEL,
  status: STATUS_LABEL,
  document: DOCUMENT_STATE_TEXT,
  failure: {
    'revision-restarts': 'The revision restart budget was exhausted.',
    'page-cap': 'The detail page limit was reached.',
    'identity-contract': 'The detail identity or response contract was refused.',
    'unreachable-auth': 'The service is unreachable, disconnected, or access was refused.',
    'not-found': 'The plan was not found.',
  },
  storeUnavailable: 'The progress store is unavailable (HTTP 503).',
  storeFailure: (code: string) => `The progress store returned ${code} (HTTP 503).`,
  diagnostics: {
    'historical-capture': 'The document snapshot is historical.',
    'capture-disabled': 'Progress capture is disabled.',
    'source-unverified': 'The recorded source is not verified.',
    'host-source-binding-unverified': 'The host source binding is not verified.',
  },
  unknownDiagnostic: 'A progress-service diagnostic was recorded; details are unavailable.',
  retained: 'The last successful document snapshot is retained; the latest capture did not replace it.',
  unsynchronized: 'The recorded checklist is not synchronized.',
  notRechecked: 'The current document file has not been rechecked.',
  plan: (title: string, id: string, archived: boolean) => `Plan: ${title} (${id})${archived ? ' (archived)' : ''}`,
  lifecycleLine: (label: string) => `Lifecycle: ${label}`,
  progress: (done: number, total: number, remaining: number, skipped: number) => `Progress: ${done}/${total} done; ${remaining} remaining; ${skipped} skipped`,
  lastReport: (time: string) => `Last report: ${time}`,
  origin: (id: string) => `Origin session: ${id}`,
  coverage: (revision: number) => `Coverage: full (revision ${revision})`,
  breakdown: (working: number, blocked: number, pending: number) => `Remaining breakdown: ${working} working; ${blocked} blocked; ${pending} pending`,
  noPrerequisites: 'No prerequisites recorded',
  prerequisites: (values: string) => `Recorded prerequisites: ${values}`,
  unavailablePrerequisite: 'Prerequisite task unavailable',
  groupPrerequisite: (title: string) => `${title} (group; not a task prerequisite)`,
  skipped: '; does not count as done',
  blockerOmitted: ' — blocker details omitted from this summary',
  current: 'Current work',
  noCurrent: 'No current work is recorded.',
  blocked: 'Explicitly blocked',
  noBlocked: 'No explicitly blocked work is recorded.',
  pending: 'Not started',
  noPending: 'No not-started work is recorded.',
  showing: (count: number) => `…showing 10 of ${count}`,
  reports: (direct: number, relayed: number) => `Recorded reports: ${direct} direct; ${relayed} parent-relay`,
  next: 'Suggested next step (suggestion, not an authoritative plan step)',
  noNext: 'No ready next step is recorded.',
  freshness: 'Freshness warnings',
  historical: 'Coverage: summary-only historical snapshot; full detail is unavailable.',
  readFailure: (description: string) => `Read failure: ${description}`,
};

const RU: typeof EN = {
  lifecycle: { active: 'В работе', completed: 'Завершён', cancelled: 'Отменён', failed: 'Не удался' },
  status: { pending: 'Не начато', working: 'В работе', blocked: 'Заблокировано', done: 'Выполнено', skipped: 'Пропущено' },
  document: {
    unbound: 'К этому плану не привязан документ.', captured: '',
    denied: 'При последнем отчёте агенту не разрешили прочитать документ плана.',
    missing: 'При последнем отчёте документ плана отсутствовал.',
    moved: 'Документ плана перемещён после привязки; агенту нужно привязать его снова.',
    oversized: 'Документ плана превышает предел размера снимка, поэтому снимок не создан.',
    'non-text': 'Документ плана не является обычным текстом, поэтому снимок не создан.',
    unavailable: 'Не удалось прочитать документ плана в этой системе.',
    'changed-during-read': 'Документ плана изменился во время чтения; снимок будет создан при следующем отчёте.',
  },
  failure: {
    'revision-restarts': 'Исчерпан лимит перезапусков из-за смены ревизии.',
    'page-cap': 'Достигнут предел страниц подробных сведений.',
    'identity-contract': 'Отклонены идентичность подробных сведений или контракт ответа.',
    'unreachable-auth': 'Сервис недоступен, отключён или отказал в доступе.',
    'not-found': 'План не найден.',
  },
  storeUnavailable: 'Хранилище прогресса недоступно (HTTP 503).',
  storeFailure: (code) => `Хранилище прогресса вернуло ${code} (HTTP 503).`,
  diagnostics: {
    'historical-capture': 'Снимок документа является историческим.',
    'capture-disabled': 'Запись прогресса отключена.',
    'source-unverified': 'Записанный источник не проверен.',
    'host-source-binding-unverified': 'Привязка источника хоста не проверена.',
  },
  unknownDiagnostic: 'Записана диагностика сервиса прогресса; подробности недоступны.',
  retained: 'Последний успешный снимок документа сохранён; последняя попытка создания снимка не заменила его.',
  unsynchronized: 'Записанный контрольный список не синхронизирован.',
  notRechecked: 'Текущий файл документа не проверялся повторно.',
  plan: (title, id, archived) => `План: ${title} (${id})${archived ? ' (в архиве)' : ''}`,
  lifecycleLine: (label) => `Состояние: ${label}`,
  progress: (done, total, remaining, skipped) => `Прогресс: ${done}/${total} выполнено; ${remaining} осталось; ${skipped} пропущено`,
  lastReport: (time) => `Последний отчёт: ${time}`,
  origin: (id) => `Исходная сессия: ${id}`,
  coverage: (revision) => `Полнота: полная (ревизия ${revision})`,
  breakdown: (working, blocked, pending) => `Оставшаяся работа: ${working} в работе; ${blocked} заблокировано; ${pending} не начато`,
  noPrerequisites: 'Предварительные условия не записаны',
  prerequisites: (values) => `Записанные предварительные условия: ${values}`,
  unavailablePrerequisite: 'Задача предварительного условия недоступна',
  groupPrerequisite: (title) => `${title} (группа; не задача предварительного условия)`,
  skipped: '; не считается выполнением',
  blockerOmitted: ' — сведения о блокировке исключены из этой сводки',
  current: 'Текущая работа',
  noCurrent: 'Текущая работа не записана.',
  blocked: 'Явно заблокировано',
  noBlocked: 'Явно заблокированная работа не записана.',
  pending: 'Не начато',
  noPending: 'Неначатая работа не записана.',
  showing: (count) => `…показано 10 из ${count}`,
  reports: (direct, relayed) => `Записанные отчёты: ${direct} напрямую; ${relayed} через родителя`,
  next: 'Предлагаемый следующий шаг (рекомендация, не утверждённый шаг плана)',
  noNext: 'Готовый следующий шаг не записан.',
  freshness: 'Предупреждения об актуальности',
  historical: 'Полнота: только исторический снимок сводки; полные сведения недоступны.',
  readFailure: (description) => `Ошибка чтения: ${description}`,
};
const TEXT: Record<InterfaceLanguage, typeof EN> = { en: EN, ru: RU };

function warnings(s: DetailSnapshot, language: InterfaceLanguage): string[] {
  const t = TEXT[language];
  const d = s.plan.document;
  const lines: string[] = [];
  if (!s.captureEnabled) lines.push(t.diagnostics['capture-disabled']);
  if (d.state !== 'captured') lines.push(t.document[d.state]);
  if (d.state !== 'captured' && d.captureId !== undefined) lines.push(t.retained);
  if (!d.checklistSynchronized) lines.push(t.unsynchronized);
  if (d.captureId !== undefined) lines.push(t.notRechecked);
  for (const code of s.diagnostics) lines.push(Object.hasOwn(t.diagnostics, code) ? t.diagnostics[code as keyof typeof t.diagnostics] : t.unknownDiagnostic);
  return [...new Set(lines.filter(Boolean))];
}

function header(s: DetailSnapshot, language: InterfaceLanguage): string[] {
  const t = TEXT[language];
  const p = s.plan, c = p.counts;
  return [
    t.plan(markdownLiteral(p.title), markdownLiteral(p.id), p.cleanup?.state === 'archived'),
    t.lifecycleLine(t.lifecycle[p.lifecycle]),
    t.progress(c.done, c.total, c.remaining, c.skipped),
    t.lastReport(new Date(p.reportedAt).toISOString()),
  ];
}

function warningSection(s: DetailSnapshot, language: InterfaceLanguage): string[] {
  const w = warnings(s, language);
  return w.length ? ['', `## ${TEXT[language].freshness}`, ...w.map((line) => `- ${line}`)] : [];
}

function full(result: CompleteDetailResult, handoff: boolean, language: InterfaceLanguage): string | null {
  const t = TEXT[language];
  const s = result.snapshot;
  if (!s || s.plan.key !== result.detail.key || s.plan.revision !== result.detail.revision || s.plan.key !== result.plan.key || s.plan.revision !== result.plan.revision) return null;
  const p = s.plan, d = result.detail;
  const tasks = d.items.filter((i) => i.kind === 'task');
  const working = tasks.filter((i) => i.status === 'working');
  const blocked = tasks.filter((i) => i.status === 'blocked');
  const pending = tasks.filter((i) => i.status === 'pending');
  const lines = header(s, language);
  if (handoff) lines.push(t.origin(markdownLiteral(p.ownerSessionId)), t.coverage(p.revision));
  if (working.length + blocked.length + pending.length === p.counts.remaining) lines.push(t.breakdown(working.length, blocked.length, pending.length));
  const byId = new Map(d.items.map((i) => [i.id, i]));
  // Descriptions report edges, not readiness: still valid on closed/invalid graphs.
  const prerequisites = (item: ItemView) => {
    if (!item.dependencies?.length) return t.noPrerequisites;
    return t.prerequisites(item.dependencies.map((id) => {
      const target = byId.get(id);
      return !target ? t.unavailablePrerequisite : target.kind !== 'task'
        ? t.groupPrerequisite(markdownLiteral(target.title))
        : `${markdownLiteral(target.title)} (${t.status[target.status]}${target.status === 'skipped' ? t.skipped : ''})`;
    }).join('; '));
  };
  const section = (title: string, items: ItemView[], empty: string, isBlocked = false) => {
    lines.push('', `## ${title}`);
    if (!items.length) lines.push(empty);
    for (const i of items) lines.push(`- ${markdownLiteral(i.title)}${isBlocked ? t.blockerOmitted : ''}${handoff ? ` — ${prerequisites(i)}` : ''}`);
  };
  section(t.current, working, t.noCurrent);
  section(t.blocked, blocked, t.noBlocked, true);
  if (handoff) {
    section(t.pending, pending.slice(0, 10), t.noPending);
    if (pending.length > 10) lines.push(t.showing(pending.length));
    const direct = d.contributions.filter((c) => c.mode === 'direct').length;
    const relayed = d.contributions.filter((c) => c.mode === 'parent-relay').length;
    lines.push('', t.reports(direct, relayed));
    const r = readiness(p, { state: 'ready', value: d });
    const next = r.state === 'ready' && !r.incomplete ? r.groups.ready[0] : undefined;
    lines.push('', `## ${t.next}`, next ? markdownLiteral(next.item.title) : t.noNext);
  }
  lines.push(...warningSection(s, language));
  return lines.join('\n') + '\n';
}

/** Null means a usable matching first-page summary was not available; never substitute a list row. */
export const formatProgressUpdate = (result: CompleteDetailResult, language: InterfaceLanguage = 'en'): string | null => full(result, false, language);
export const formatHandoff = (result: CompleteDetailResult, language: InterfaceLanguage = 'en'): string | null => full(result, true, language);

/** Explicit historical fallback only; its input cannot carry partial detail arrays. */
export function formatSummaryOnly(snapshot: DetailSnapshot, cause: DetailFailureCause, language: InterfaceLanguage = 'en'): string {
  const t = TEXT[language];
  return [...header(snapshot, language), t.historical, t.readFailure(describeDetailFailure(cause, language)), ...warningSection(snapshot, language)].join('\n') + '\n';
}
