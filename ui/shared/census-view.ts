// Sub-agents section for rail, Work Status and the full page (model: subagents.ts). Every row keeps
// three facts apart: Ran (host run facts), Claimed (the child's own optional handoff, labelled as
// reported) and Accepted (task status explicitly reported in this plan). A section exists only with
// a plan in scope and something useful to show. Words and shapes carry each state; colour only
// reinforces it. No label here expires: the frame ticker only moves time text.
import { age, el, info, testid, type Env } from './components.ts';
import { icon, warningLine, type WarningTone } from './primitives.ts';
import { absoluteTime, elapsedText, plural } from './format.ts';
import { resolveLanguage, type InterfaceLanguage } from './i18n.ts';
import { EARLIER_STEP, rosterFor, type Ran, type Roster, type RosterInput, type RosterNote, type SubagentEntry } from './subagents.ts';
import type { RunsPanel } from './runs.ts';

export interface SubagentsView extends RosterInput { env: Env }

/** Run request of one root with the plan in scope (useful view); the plan's cleanup generation fences it. */
export const runClaim = (read: { storeId: string; binding: { sourceId: string | null; verified: boolean }; captureEnabled: boolean }, root: string, plan: { sourceId: string; id: string; cleanup?: { revision: number } }) => ({
  request: { storeId: read.storeId, binding: { sourceId: read.binding.sourceId, verified: read.binding.verified }, source: plan.sourceId, root, plan: plan.id, cleanupRev: plan.cleanup?.revision ?? 0, view: 'useful' as const },
  captureEnabled: read.captureEnabled,
});

const STATE: Record<Ran['kind'], string> = { active: 'active', waiting: 'waiting', idle: 'idle', finished: 'ended', failed: 'failed', interrupted: 'interrupted', unknown: 'unknown' };
const EN = {
  source: {
  event: 'From the host’s run events.',
  dispatch: 'From the dispatch record; the host has not reported this run’s outcome yet.',
  history: 'From the host’s session history: the session’s last completed run, not a specific dispatch.',
  host: 'What OpenChamber lists for this session now.',
  },
  claim: { done: 'done', partial: 'partly done', blocked: 'blocked' },
  status: { pending: 'pending', working: 'working', blocked: 'blocked', done: 'done', skipped: 'skipped' },
  waiting: 'Waiting on you', after: (d: string) => ` · ${d} after dispatch`, took: (d: string) => ` · took ${d}`,
  nowTip: 'What OpenChamber lists for this session now. Its recorded run above is unchanged.',
  again: (label: string, compact: boolean) => `${label} again${compact ? '' : ' now'}`,
  accepted: (word: string, title: string | null, compact: boolean) => compact ? `task ${word}` : `Task reported ${word}${title ? `: ${title}` : ''}`,
  acceptedMany: (n: number, parts: string, omitted: number, compact: boolean) => compact ? `${n} tasks: ${parts}` : `${plural(n, 'task', 'tasks')} reported: ${parts}${omitted ? `, ${omitted} more` : ''}`,
  claimed: (word: string, compact: boolean) => compact ? `claims ${word}` : `Reported ${word}`,
  unmatched: ' · not matched to one run', open: 'Open', openSession: (title: string) => `Open session ${title}`, startedBy: (title: string) => `started by ${title}`,
  history: 'from session history', during: 'dispatched during this plan', ran: 'Ran', claimedLabel: 'Claimed', acceptedLabel: 'Accepted',
  recordedTip: 'Runs recorded for this session and its sub-agents. A finished run is not a finished task.',
  hostTip: 'Sub-agents OpenChamber lists now; no run records were available.', soFar: 'so far', unchecked: 'more not checked',
  loss: 'Some runs weren’t recorded.', activityUnavailable: 'Current activity unavailable.', notEvery: 'Not every sub-agent is checked.', unavailable: 'Run records unavailable.',
  loadingHistory: 'Loading older history…', about: 'About these records', loadMore: 'Load more history', retry: 'Retry history',
  loading: 'Loading…', showMore: (n: number | null) => n === null ? 'Show more' : `Show ${n} more`,
  other: 'Other records', records: 'Sub-agent records', otherLabel: 'Other sub-agent records', pageError: 'More rows couldn’t be read. Try again in a moment.',
  subagents: 'Sub-agents', aboutLabel: 'About sub-agent records', running: 'Running sub-agents',
  partial: 'Partial', coverage: ' sub-agent coverage',
  lossText: {
    migrated: 'This happened before the update; the date is unknown.', legacy: 'Date unknown.',
    dismiss: 'Dismiss warning', explain: 'Quiets this warning for this store. New recording gaps will warn again.',
    success: 'Warning dismissed.', error: 'Couldn’t dismiss the warning. Try again.',
    conflict: 'A newer recording gap was detected. Review it before dismissing.', recent: 'Recent recording gap.', detected: ' Last detected: ',
  },
  aboutLines: [
    'Ran is what OpenChamber recorded about each run: from the host’s run events, the dispatch record, or the session’s history. A finished run is not a finished task.',
    'Claimed is the sub-agent’s own optional report, shown as it reported it. Accepted is the task status this plan records.',
    'Running is observed by the host for sessions and sub-agents only; tasks are reported working, not running.',
  ],
};
const RU: typeof EN = {
  source: { event: 'По событиям запусков хоста.', dispatch: 'По записи отправки; хост ещё не сообщил результат запуска.', history: 'По истории сессии хоста: последний завершённый запуск сессии, а не конкретная отправка.', host: 'Что OpenChamber сейчас показывает для этой сессии.' },
  claim: { done: 'выполнено', partial: 'частично выполнено', blocked: 'заблокировано' },
  status: { pending: 'ожидает', working: 'в работе', blocked: 'заблокирована', done: 'выполнена', skipped: 'пропущена' },
  waiting: 'Ждёт вас', after: d => ` · ${d} после отправки`, took: d => ` · длительность ${d}`,
  nowTip: 'Что OpenChamber сейчас показывает для этой сессии. Записанный запуск выше не изменён.',
  again: (label, compact) => `${label} снова${compact ? '' : ' сейчас'}`,
  accepted: (word, title, compact) => compact ? `задача: ${word}` : `По отчёту задача ${word}${title ? `: ${title}` : ''}`,
  acceptedMany: (n, parts, omitted, compact) => compact ? `Задачи (${n}): ${parts}` : `По отчётам задачи (${n}): ${parts}${omitted ? `, ещё ${omitted}` : ''}`,
  claimed: (word, compact) => compact ? `заявляет: ${word}` : `Сообщено: ${word}`,
  unmatched: ' · не сопоставлено с отдельным запуском', open: 'Открыть', openSession: title => `Открыть сессию ${title}`, startedBy: title => `запущен из ${title}`,
  history: 'из истории сессии', during: 'отправлен во время этого плана', ran: 'Запуск', claimedLabel: 'Заявлено', acceptedLabel: 'Принято',
  recordedTip: 'Запуски этой сессии и её субагентов. Завершённый запуск не означает выполненную задачу.',
  hostTip: 'Субагенты, которых сейчас показывает OpenChamber; записи запусков недоступны.', soFar: 'на данный момент', unchecked: 'остальные не проверены',
  loss: 'Некоторые запуски не записаны.', activityUnavailable: 'Текущая активность недоступна.', notEvery: 'Проверены не все субагенты.', unavailable: 'Записи запусков недоступны.',
  loadingHistory: 'Загрузка прошлой истории…', about: 'Об этих записях', loadMore: 'Загрузить ещё историю', retry: 'Повторить загрузку истории',
  loading: 'Загрузка…', showMore: n => n === null ? 'Показать ещё' : `Показать ещё ${n}`,
  other: 'Другие записи', records: 'Записи субагентов', otherLabel: 'Другие записи субагентов', pageError: 'Не удалось прочитать следующие строки. Попробуйте чуть позже.',
  subagents: 'Субагенты', aboutLabel: 'О записях субагентов', running: 'Выполняющиеся субагенты',
  partial: 'Неполный', coverage: ' охват субагентов',
  lossText: {
    migrated: 'Это произошло до обновления; дата неизвестна.', legacy: 'Дата неизвестна.',
    dismiss: 'Скрыть предупреждение', explain: 'Убирает предупреждение для этого хранилища. Новые пробелы в записи снова вызовут предупреждение.',
    success: 'Предупреждение скрыто.', error: 'Не удалось скрыть предупреждение. Попробуйте снова.',
    conflict: 'Обнаружен новый пробел в записи. Просмотрите его перед скрытием.', recent: 'Недавний пробел в записи.', detected: ' Последнее обнаружение: ',
  },
  aboutLines: [
    'Запуск — то, что OpenChamber записал о запуске: по событиям хоста, записи отправки или истории сессии. Завершённый запуск не означает выполненную задачу.',
    'Заявлено — необязательный собственный отчёт субагента, показанный как сообщено. Принято — статус задачи, записанный в этом плане.',
    'Хост наблюдает выполнение только сессий и субагентов; для задач статус «в работе» сообщается в отчёте, а не наблюдается хостом.',
  ],
};
const COPY: Record<InterfaceLanguage, typeof EN> = { en: EN, ru: RU };
const iso = (ms: number) => new Date(ms).toISOString();

/** The Ran line: a mark, the state words, its real host time and a justified duration. */
function ranNode(r: Ran, env: Env, compact: boolean) {
  const language = resolveLanguage('auto', env.locale), c = COPY[language];
  const n = el('span', 'ap-obs');
  n.dataset.state = STATE[r.kind];
  n.title = c.source[r.source];
  const mark = el('span', 'ap-obs-mark');
  mark.setAttribute('aria-hidden', 'true');
  n.append(mark, el('span', 'ap-obs-label', compact && r.kind === 'waiting' ? c.waiting : r.label));
  if (r.time) n.append(age(iso(r.time.at), env, compact ? ' · ' : ` · ${r.time.prefix}`));
  if (r.duration && !compact) {
    const d = elapsedText(r.duration.ms, language);
    if (d) n.append(el('span', 'ap-obs-last', r.duration.fromDispatch ? c.after(d) : c.took(d)));
  }
  return n;
}

/** The host's current word for a child whose latest recorded run already ended. */
function nowNode(now: NonNullable<SubagentEntry['now']>, compact: boolean, language: InterfaceLanguage) {
  const c = COPY[language];
  const n = el('span', 'ap-obs ap-obs-now');
  n.dataset.state = now.kind;
  n.title = c.nowTip;
  const mark = el('span', 'ap-obs-mark');
  mark.setAttribute('aria-hidden', 'true');
  n.append(mark, el('span', 'ap-obs-label', compact && now.kind === 'waiting' ? c.waiting : c.again(now.label, compact)));
  return n;
}

function acceptedText(a: NonNullable<SubagentEntry['accepted']>, compact: boolean, language: InterfaceLanguage) {
  const c = COPY[language];
  const word = (s: string) => c.status[s as keyof typeof c.status];
  if (a.tasks.length === 1 && !a.omitted) {
    const t = a.tasks[0];
    return c.accepted(word(t.status), t.title, compact);
  }
  const by = new Map<string, number>();
  for (const t of a.tasks) by.set(t.status, (by.get(t.status) ?? 0) + 1);
  const parts = [...by].map(([s, n]) => `${n} ${word(s)}`).join(', ');
  const n = a.tasks.length + a.omitted;
  return c.acceptedMany(n, parts, a.omitted, compact);
}

function claimNode(c: NonNullable<SubagentEntry['claimed']>, env: Env, compact: boolean) {
  const text = COPY[resolveLanguage('auto', env.locale)];
  const n = el('span', 'ap-claim');
  n.dataset.outcome = c.outcome;
  if (compact) { n.textContent = text.claimed(text.claim[c.outcome], true); return n; }
  n.append(el('span', '', text.claimed(text.claim[c.outcome], false)), el('q', 'ap-claim-text', c.summary), age(iso(c.reportedAt), env, ' · '));
  if (c.association === 'session-only') n.append(el('span', 'ap-obs-last', text.unmatched));
  return n;
}

function openButton(e: SubagentEntry, env: Env) {
  const c = COPY[resolveLanguage('auto', env.locale)];
  if (!env.openSession || !e.openable || !e.sessionId) return null;
  const b = testid(el('button', 'ap-link', c.open), `open-observed-${e.sessionId}`);
  b.type = 'button';
  b.setAttribute('aria-label', c.openSession(e.title));
  const open = env.openSession, id = e.sessionId;
  b.addEventListener('click', () => open(id));
  return b;
}

/**
 * Rail and board: one line per sub-agent (state, title, agent, real time) that expands in place to
 * every recorded fact (Ran / Claimed / Accepted, lineage, source, a verified Open).
 */
function expandRow(e: SubagentEntry, env: Env, agent = true) {
  const language = resolveLanguage('auto', env.locale), c = COPY[language];
  const li = testid(el('li', 'ap-obs-row ap-obs-xrow'), `subagent-row-${e.key}`);
  li.dataset.role = 'child';
  li.dataset.depth = String(e.depth);
  if (e.runId) li.dataset.run = e.runId;
  if (e.sessionId) li.dataset.session = e.sessionId;
  li.dataset.ran = e.ran.kind;
  if (e.now) li.dataset.now = e.now.kind;
  li.style.setProperty('--depth', String(Math.min(e.depth, 6)));
  li.setAttribute('aria-level', String(e.depth));
  const d = testid(el('details', 'ap-obs-x'), `subagent-toggle-${e.key}`);
  const summary = el('summary', 'ap-obs-line');
  const title = el('span', 'ap-obs-title', e.title);
  summary.append(title);
  if (e.parentTitle) summary.append(el('span', 'ap-sr', `, ${c.startedBy(e.parentTitle)}`));
  // Agent, state words with real time, and the chevron wrap together under a long title.
  const end = el('span', 'ap-obs-end');
  // Work Status keeps the agent in the expanded facts only, so a running row fits one line.
  if (e.agent && agent) end.append(el('span', 'ap-obs-agent', e.agent));
  end.append(e.now ? nowNode(e.now, true, language) : ranNode(e.ran, env, true), icon('chevron-down'));
  summary.append(end);
  d.append(summary);
  const body = el('div', 'ap-obs-body');
  const meta = [e.agent, e.historical ? c.history : null, e.duringPlan ? c.during : null, e.parentTitle ? c.startedBy(e.parentTitle) : null].filter((x): x is string => !!x);
  if (meta.length) body.append(el('div', 'ap-obs-meta', meta.join(' · ')));
  const facts = el('dl', 'ap-obs-facts');
  const add = (term: string, value: Node, hook: string) => { const f = el('div'); f.dataset.fact = hook; f.append(el('dt', '', term)); const dd = el('dd'); dd.append(value); f.append(dd); facts.append(f); };
  const ran = el('span', 'ap-ran');
  ran.append(ranNode(e.ran, env, false));
  if (e.now) ran.append(el('br'), nowNode(e.now, false, language));
  add(c.ran, ran, 'ran');
  if (e.claimed) add(c.claimedLabel, claimNode(e.claimed, env, false), 'claimed');
  if (e.accepted) add(c.acceptedLabel, el('span', 'ap-obs-assign', acceptedText(e.accepted, false, language)), 'accepted');
  body.append(facts);
  const open = openButton(e, env);
  if (open) body.append(open);
  d.append(body);
  li.append(d);
  return li;
}

/** Running now, from the host (including a finished run's child running again); everything else folds. */
const running = (e: SubagentEntry) => e.now ? e.now.kind === 'active' : e.ran.kind === 'active';

const NOTE: Record<InterfaceLanguage, Record<RosterNote['kind'], string>> = { en: {
  'runs-unavailable': 'Run records aren’t available from this progress service, so only sub-agents OpenChamber lists now are shown.',
  'runs-error': 'Run records couldn’t be read just now; they’ll be read again on the next refresh.',
  'capture-off': 'Capture is off: new runs aren’t recorded. Earlier records stay readable.',
  'capture-loss': 'Some run information wasn’t recorded.',
  'history-loading': 'Loading older sub-agent history…',
  'history-partial': 'Older history was only partly loaded; counts may be low.',
  'history-failed': 'Older history couldn’t be loaded.',
  'history-request-failed': 'Older history couldn’t be requested.',
  'history-off': 'Older history isn’t loaded while capture is off.',
  'history-unavailable': 'Older history can’t be loaded until the companion is running.',
  'traversal-limit': 'There are more nested sub-agents than are counted here.',
  'host-gaps': 'Some sessions couldn’t be verified as sub-agents of this session, so they’re left out.',
  'host-truncated': 'OpenChamber lists more sub-agents than this view checks (128 rows, 2,000 sessions, 32 levels), so some current activity — including a child waiting on you — may not be shown or counted. Recorded runs are unaffected.',
  'host-activity-unavailable': 'OpenChamber’s session list is reloading or incomplete, so current activity (waiting, running again, idle now) isn’t shown; recorded runs are unchanged.',
}, ru: {
  'runs-unavailable': 'Этот сервис прогресса не предоставляет записи запусков, поэтому показаны только субагенты, которых OpenChamber видит сейчас.',
  'runs-error': 'Не удалось прочитать записи запусков; следующая попытка — при обновлении.',
  'capture-off': 'Запись отключена: новые запуски не сохраняются. Прежние записи доступны.',
  'capture-loss': 'Некоторые сведения о запусках не записаны.',
  'history-loading': 'Загрузка прошлой истории субагентов…',
  'history-partial': 'Прошлая история загружена частично; числа могут быть занижены.',
  'history-failed': 'Не удалось загрузить прошлую историю.',
  'history-request-failed': 'Не удалось запросить прошлую историю.',
  'history-off': 'Прошлая история не загружается, пока запись отключена.',
  'history-unavailable': 'Прошлую историю нельзя загрузить, пока companion не работает.',
  'traversal-limit': 'Вложенных субагентов больше, чем учтено здесь.',
  'host-gaps': 'Родство некоторых сессий с этой сессией не удалось проверить, поэтому они исключены.',
  'host-truncated': 'OpenChamber показывает больше субагентов, чем проверяет это представление (128 строк, 2 000 сессий, 32 уровня). Часть текущей активности — включая ожидание вашего ответа — может быть не показана и не учтена. Записи запусков не изменены.',
  'host-activity-unavailable': 'Список сессий OpenChamber перезагружается или неполон, поэтому текущая активность (ожидание, повторное выполнение, бездействие) не показана; записи запусков не изменены.',
} };

/**
 * Rail and board: routine qualifications go behind the "Partial" cue beside the counts; the others
 * (unavailable or failed reads, capture off, history loading or unavailable, withheld current
 * activity) stay visible lines. Work Status keeps its own one short line (notesNode).
 */
const ROUTINE: ReadonlySet<RosterNote['kind']> = new Set<RosterNote['kind']>(['capture-loss', 'history-partial', 'host-truncated', 'traversal-limit', 'host-gaps', 'history-off']);
export const routineNote = (n: RosterNote) => ROUTINE.has(n.kind);

function summaryNode(r: Roster, compact: boolean, language: InterfaceLanguage) {
  const c = COPY[language];
  const p = testid(el('p', 'ap-sub-summary'), 'subagent-count');
  p.title = r.recorded ? c.recordedTip : c.hostTip;
  for (const s of r.summary) {
    const part = el('span', 'ap-sub-part');
    part.dataset.kind = s.kind;
    const mark = el('span', 'ap-obs-mark');
    mark.setAttribute('aria-hidden', 'true');
    part.append(mark, s.text);
    p.append(part);
  }
  if (r.soFar) p.append(el('span', 'ap-sub-part ap-muted', c.soFar));
  // Counts from host-listed children stop at the census limit: never shown as complete. Rail and
  // board say so through the "Partial" cue instead.
  if (r.hostTruncated && compact) p.append(testid(el('span', 'ap-sub-part ap-muted', c.unchecked), 'subagent-truncated'));
  return p;
}

/**
 * Work Status: one short line for genuine unavailability only; detail lives in the rail. A recording
 * gap counts only while it needs attention (recent and not dismissed); its order among the others
 * is unchanged.
 */
function notesNode(r: Roster, language: InterfaceLanguage) {
  const c = COPY[language];
  const n = r.notes.find((x) => x.kind === 'runs-unavailable' || x.kind === 'runs-error' || x.kind === 'capture-loss' && x.attention || x.kind === 'host-activity-unavailable' || x.kind === 'host-truncated');
  if (!n) return null;
  const p = testid(el('p', 'ap-note', n.kind === 'capture-loss' ? NOTE[language]['capture-loss'] : n.kind === 'host-activity-unavailable' ? c.activityUnavailable : n.kind === 'host-truncated' ? c.notEvery : c.unavailable), 'subagent-coverage');
  p.dataset.notes = n.kind;
  return p;
}

/**
 * The earlier list's pager: its label, or null when there is nothing more to show or read. A held
 * continuation cursor always keeps it: the estimated remainder can be wrong (a host-only row may
 * stand in for an unloaded record), and only reading the next page settles it.
 */
export function earlierPager(r: Pick<Roster, 'earlier' | 'earlierTotal' | 'canPage'>, runs: Pick<RunsPanel, 'paging' | 'continuation'> | null, visible: number, step: number, language: InterfaceLanguage = 'en'): string | null {
  const c = COPY[language];
  const loaded = r.earlier.length;
  const left = r.earlierTotal - Math.min(visible, loaded);
  if (!runs || !((visible < loaded || r.canPage) && left > 0) && !runs.continuation) return null;
  return runs.paging ? c.loading : c.showMore(left > 0 ? Math.min(step, left) : null);
}

/**
 * Rail and board: every record that is not running now, folded under one summary line. Waiting,
 * failed, interrupted, finished, idle and unknown keep their own words; the existing pager reads on.
 */
function recordsNode(r: Roster, v: SubagentsView, rest: SubagentEntry[], agent = true) {
  const language = resolveLanguage('auto', v.env.locale), c = COPY[language];
  const step = EARLIER_STEP[v.surface];
  const visible = Math.max(step, v.runs?.shown ?? 0);
  const total = rest.length + r.earlierTotal;
  const runs = v.runs;
  const label = earlierPager(r, runs, visible, step, language);
  if (!total && !label) return null;
  const more = testid(el('details', 'ap-obs-more'), 'observed-more');
  more.append(el('summary', '', `${r.featured.some(running) ? c.other : c.records} · ${total}`));
  const list = el('ul', 'ap-obs-list');
  list.setAttribute('aria-label', c.otherLabel);
  for (const e of [...rest, ...r.earlier.slice(0, visible)]) list.append(expandRow(e, v.env, agent));
  if (list.childElementCount) more.append(list);
  if (runs && label) {
    const b = testid(el('button', 'ap-link ap-sub-page', label), 'subagent-more');
    b.type = 'button';
    // Not `disabled`: a disabled button drops keyboard focus mid-read. The controller ignores repeats.
    if (runs.paging) b.setAttribute('aria-disabled', 'true');
    const loaded = r.earlier.length;
    b.addEventListener('click', () => { if (!runs.paging) runs.showMore(Math.min(visible, loaded), loaded, step); });
    more.append(b);
  }
  if (runs?.pageError) more.append(el('p', 'ap-note', c.pageError));
  return more;
}

/**
 * One coverage line, with Load more / Retry history where the read offers it. A started request
 * replaces the line and its button with the visible "Loading older sub-agent history…"; the frame's
 * focus restoration then hands focus to the cue or the heading (app.ts, coverage fallback).
 */
function noteItem(n: RosterNote, tone: WarningTone, runs: RunsPanel | null, language: InterfaceLanguage) {
  const c = COPY[language];
  const li = el('li');
  li.append(warningLine(NOTE[language][n.kind], tone, 'span'));
  if (runs && ((n.kind === 'history-partial' || n.kind === 'history-failed') && n.token || n.kind === 'history-request-failed')) {
    const b = testid(el('button', 'ap-link', n.kind === 'history-partial' ? c.loadMore : c.retry), 'subagent-retry-history');
    b.type = 'button';
    // Not `disabled`: a disabled button drops keyboard focus. The controller ignores repeats.
    if (runs.reconciling) b.setAttribute('aria-disabled', 'true');
    b.addEventListener('click', () => { if (!runs.reconciling) runs.retryHistory(); });
    li.append(b);
  }
  return li;
}

/** Rail and board: the notes that stay visible compact lines (the routine ones are behind the cue). */
function coverageNode(notes: RosterNote[], runs: RunsPanel | null, language: InterfaceLanguage) {
  if (!notes.length) return null;
  const list = testid(el('ul', 'ap-sub-notes ap-warn-list'), 'subagent-coverage');
  list.dataset.notes = notes.map((n) => n.kind).join(' ');
  for (const n of notes) list.append(noteItem(n, visibleTone(n), runs, language));
  return list;
}

/** Visible lines keep their tones: information for loading and capture off, a warning otherwise. */
const visibleTone = (n: RosterNote): WarningTone => n.kind === 'history-loading' || n.kind === 'capture-off' ? 'info' : 'warning';
/**
 * Notes behind the cue are routine, so they carry a muted mark. Orange is kept for one case: a
 * recording gap that needs attention (recent and not dismissed, as the service says).
 */
export const cueTone = (n: RosterNote): WarningTone => n.kind === 'capture-loss' && n.attention ? 'warning' : 'neutral';
type LossNote = Extract<RosterNote, { kind: 'capture-loss' }>;
const lossOf = (notes: RosterNote[]) => notes.find((n): n is LossNote => n.kind === 'capture-loss') ?? null;

/**
 * The recording-gap note inside the disclosure: the approved sentence with the stored detection
 * date (never a migration, dismissal or read time), and, while the gap needs attention and the
 * service supports it, Dismiss warning with its explanation and any failure or conflict message.
 * The note stays listed after dismissal or ageing; only its tone and the control change.
 */
function lossItem(n: LossNote, runs: RunsPanel | null, env: Env) {
  const language = resolveLanguage('auto', env.locale), LOSS = COPY[language].lossText;
  const li = testid(noteItem(n, cueTone(n), null, language), 'subagent-loss-note');
  li.dataset.attention = String(n.attention);
  li.dataset.date = n.dateKind;
  const text = li.querySelector('.ap-warn-text')!;
  if (n.dateKind === 'known' && n.lastLossAt !== null) {
    const iso = new Date(n.lastLossAt).toISOString();
    const t = testid(el('time', '', absoluteTime(iso, env.locale)), 'subagent-loss-date');
    t.dateTime = iso;
    text.append(LOSS.detected, t, '.');
  } else text.append(' ', n.dateKind === 'migrated-unknown' ? LOSS.migrated : LOSS.legacy);
  if (!runs || !n.canDismiss) return li;
  const box = el('div', 'ap-sub-dismiss');
  const help = el('span', 'ap-sub-dismiss-help', LOSS.explain);
  help.id = `ap-sub-dismiss-${cueCount}`;
  const b = testid(el('button', 'ap-link', LOSS.dismiss), 'subagent-dismiss-loss');
  b.type = 'button';
  b.setAttribute('aria-describedby', help.id);
  // Not `disabled`: a disabled button drops keyboard focus. The controller ignores repeats.
  const pending = runs.lossDismissal === 'pending';
  if (pending) b.setAttribute('aria-disabled', 'true');
  b.addEventListener('click', () => { if (!pending) runs.dismissLoss(); });
  box.append(b, help);
  // Visible next to the control; spoken once through the frame's announcer (announceLoss).
  if (runs.lossDismissal === 'error' || runs.lossDismissal === 'conflict') {
    const status = testid(warningLine(LOSS[runs.lossDismissal], runs.lossDismissal === 'error' ? 'error' : 'warning', 'p'), 'subagent-dismiss-status');
    status.dataset.state = runs.lossDismissal;
    box.append(status);
  }
  li.append(box);
  return li;
}

let lossAnnouncer: HTMLElement | null = null;
let lossOutcome: unknown = 'idle';
let lossText = '';
let lossGeneration = 0;
/**
 * Dismissal outcomes, spoken once each through one persistent polite live region outside the
 * repainted root (as the digest and search announcers do). Each failure has its own token, so a
 * repeated failure is spoken again; success is never spoken while the gap still needs attention.
 */
function announceLoss(runs: RunsPanel, attention: boolean, language: InterfaceLanguage) {
  const LOSS = COPY[language].lossText;
  const s = runs.lossDismissal;
  const token = s === 'error' || s === 'conflict' ? runs.lossDismissalFailure ?? s : s;
  const text = s === 'success' ? attention ? '' : LOSS.success : s === 'error' || s === 'conflict' ? LOSS[s] : '';
  if (token === lossOutcome && text === lossText) return;
  lossOutcome = token;
  lossText = text;
  const generation = ++lossGeneration;
  if (!text) return;
  if (!lossAnnouncer?.isConnected) {
    lossAnnouncer = testid(el('p', 'ap-sr'), 'subagent-announcer');
    lossAnnouncer.setAttribute('role', 'status'); lossAnnouncer.setAttribute('aria-live', 'polite'); lossAnnouncer.setAttribute('aria-atomic', 'true');
    document.body.append(lossAnnouncer);
  }
  const node = lossAnnouncer;
  node.textContent = '';
  // Next frame, so an identical repeated outcome is still a change for assistive technology.
  requestAnimationFrame(() => { if (lossGeneration === generation) node.textContent = text; });
}

const CUE = 'subagent-coverage-cue';
let cueCount = 0;

/**
 * Rail and board: the muted "Partial" cue after the counts, a native button that expands the
 * routine notes inline below the header (`aria-expanded`/`aria-controls`; closed by default, no
 * hover or popover). The button sits in the counts' wrapping row and the notes below the header,
 * so they cannot share one `details`. Like a `details[data-testid]` across a repaint (app.ts), the open
 * state carries over from the painted cue of the same scope; focus returns through its test ID.
 */
function coverageCue(notes: RosterNote[], runs: RunsPanel | null, scope: string, env: Env) {
  const language = resolveLanguage('auto', env.locale), c = COPY[language];
  const id = `ap-sub-cue-${cueCount += 1}`;
  const button = testid(el('button', 'ap-sub-cue'), CUE);
  button.type = 'button';
  button.dataset.scope = scope;
  // Not the counts' tooltip: the cue's words and its notes say what it means.
  button.title = '';
  button.setAttribute('aria-controls', id);
  // Warning tone only while a recording gap needs attention: a triangle (shape, not just colour)
  // and the description "Recent recording gap."; otherwise muted. The name stays the same.
  const attention = !!lossOf(notes)?.attention;
  button.dataset.tone = attention ? 'warning' : 'neutral';
  // The description is a hidden sibling: it is spoken as the button's description, not its name.
  const recent = attention ? testid(el('span', '', c.lossText.recent), 'subagent-coverage-cue-recent') : null;
  if (recent) {
    recent.id = `${id}-recent`;
    recent.hidden = true;
    button.setAttribute('aria-describedby', recent.id);
    button.append(icon('warning'));
  }
  // Named "Partial sub-agent coverage"; its expanded state says whether the notes are shown.
  button.append(el('span', '', c.partial), el('span', 'ap-sr', c.coverage), icon('chevron-down'));
  const region = testid(el('div', 'ap-sub-cue-notes'), 'subagent-coverage-notes');
  region.id = id;
  region.dataset.notes = notes.map((n) => n.kind).join(' ');
  const list = el('ul', 'ap-sub-notes ap-warn-list');
  for (const n of notes) list.append(n.kind === 'capture-loss' ? lossItem(n, runs, env) : noteItem(n, cueTone(n), runs, language));
  region.append(list);
  const set = (open: boolean) => { button.setAttribute('aria-expanded', String(open)); region.hidden = !open; };
  const painted = document.querySelector<HTMLElement>(`[data-testid="${CUE}"]`);
  set(painted?.dataset.scope === scope && painted.getAttribute('aria-expanded') === 'true');
  button.addEventListener('click', () => set(button.getAttribute('aria-expanded') !== 'true'));
  return { button, recent, region };
}

/** The section, or null: no plan in scope, an unverified setup, or nothing useful to show. */
export function subagentsBlock(v: SubagentsView): HTMLElement | null {
  const language = resolveLanguage('auto', v.env.locale), c = COPY[language];
  const r = rosterFor(v, language);
  if (!r) return null;
  const compact = v.surface === 'status';
  // Every surface: running rows on one line each, every other record folded. Work Status keeps its
  // one short coverage line and no ⓘ (an explanation popover would be clipped by its auto height).
  const section = testid(el('section', 'ap-section ap-census ap-census-calm'), 'subagent-activity');
  section.dataset.state = r.recorded ? 'ready' : 'host-only';
  section.dataset.complete = String(r.recorded && !r.soFar && !r.notes.some((n) => n.kind !== 'capture-off' && n.kind !== 'history-off'));
  section.setAttribute('aria-label', c.subagents);
  const head = el('div', 'ap-census-head');
  const title = el('div', 'ap-census-title');
  const heading = el(v.surface === 'page' ? 'h3' : 'h2', 'ap-h', c.subagents);
  title.append(heading);
  // Rail and board: plan and selected session. A focused coverage control that a repaint removes
  // hands focus on only within the same scope (app.ts, coverage fallback).
  const scope = JSON.stringify([v.plan!.sourceId, v.plan!.id, v.currentSession]);
  if (!compact) {
    section.dataset.scope = scope;
    // Where focus lands when a repaint removes a focused coverage control (never a Tab stop).
    testid(heading, 'subagent-heading').tabIndex = -1;
    title.append(info('subagent-records', c.aboutLabel, c.aboutLines));
  }
  head.append(title);
  const counts = r.summary.length ? summaryNode(r, compact, language) : null;
  if (counts) head.append(counts);
  section.append(head);
  const routine = compact ? [] : r.notes.filter(routineNote);
  if (routine.length) {
    const cue = coverageCue(routine, v.runs, scope, v.env);
    // The last item of the counts' wrapping row, so it stays beside them at any width.
    (counts ?? head).append(cue.button);
    if (cue.recent) (counts ?? head).append(cue.recent);
    section.append(cue.region);
  }
  if (!compact && v.runs) announceLoss(v.runs, !!lossOf(r.notes)?.attention, language);
  const now = r.featured.filter(running);
  if (now.length) {
    const list = el('ul', 'ap-obs-list');
    list.setAttribute('aria-label', c.running);
    for (const e of now) list.append(expandRow(e, v.env, !compact));
    section.append(list);
  }
  const records = recordsNode(r, v, r.featured.filter((e) => !running(e)), !compact);
  if (records) section.append(records);
  const notes = compact ? notesNode(r, language) : coverageNode(r.notes.filter((n) => !routineNote(n)), v.runs, language);
  if (notes) section.append(notes);
  return section;
}
