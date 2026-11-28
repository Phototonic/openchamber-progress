// Sub-agents section for rail, Work Status and the full page (model: subagents.ts). Every row keeps
// three facts apart: Ran (host run facts), Claimed (the child's own optional handoff, labelled as
// reported) and Accepted (task status explicitly reported in this plan). A section exists only with
// a plan in scope and something useful to show. Words and shapes carry each state; colour only
// reinforces it. No label here expires: the frame ticker only moves time text.
import { age, el, info, testid, type Env } from './components.ts';
import { icon, warningLine, type WarningTone } from './primitives.ts';
import { absoluteTime, elapsedText, formatCount, plural } from './format.ts';
import { resolveLanguage, type InterfaceLanguage } from './i18n.ts';
import { EARLIER_STEP, rosterFor, type Ran, type Roster, type RosterInput, type RosterNote, type SubagentEntry, type SummaryPart } from './subagents.ts';
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
  event: 'Run status from OpenChamber.',
  dispatch: 'OpenChamber hasn’t confirmed the outcome yet.',
  history: 'From the host’s session history: the session’s last completed run, not a specific dispatch.',
  host: 'What OpenChamber lists for this session now.',
  },
  claim: { done: 'done', partial: 'partly done', blocked: 'blocked' },
  status: { pending: 'not started', working: 'in progress', blocked: 'blocked', done: 'done', skipped: 'skipped' },
  waiting: 'Waiting for you', after: (d: string) => ` · ${d} after launch`, took: (d: string) => ` · took ${d}`,
  nowTip: 'What OpenChamber lists for this session now. Its recorded run above is unchanged.',
  notSeen: 'not seen in OpenChamber now',
  again: (label: string, compact: boolean) => `${label} again${compact ? '' : ' now'}`,
  accepted: (word: string, title: string | null, compact: boolean) => compact ? `task ${word}` : `Task ${word}${title ? `: ${title}` : ''}`,
  acceptedMany: (n: number, parts: string, omitted: number, compact: boolean) => `${plural(n, 'task', 'tasks')}: ${parts}${!compact && omitted ? `, ${omitted} more` : ''}`,
  claimed: (word: string, _compact: boolean) => `says ${word}`,
  unmatched: ' · not matched to one run', open: 'Open', openSession: (title: string) => `Open session ${title}`, startedBy: (title: string) => `started by ${title}`,
  history: 'from session history', during: 'requested during this plan', ran: 'Run', claimedLabel: 'Sub-agent', acceptedLabel: 'Task state',
  recordedTip: 'Runs recorded for this session and its sub-agents. A finished run is not a finished task.',
  hostTip: 'Sub-agents OpenChamber lists now; no run records were available.', soFar: 'so far', unchecked: 'more not checked',
  loss: 'Some runs weren’t recorded.', activityUnavailable: 'Current activity unavailable.', notEvery: 'Not every sub-agent is checked.', unavailable: 'Run records unavailable.',
  loadingHistory: 'Loading older history…', about: 'About these records', loadMore: 'Load more history', retry: 'Retry history',
  loading: 'Loading…', showMore: (n: number | null) => n === null ? 'Show more' : `Show ${n} more`,
  other: 'Show more', records: 'Sub-agents', otherLabel: 'Show more sub-agents', pageError: 'Couldn’t load more sub-agents; try again.',
  subagents: 'Sub-agents', aboutLabel: 'About sub-agent records', running: 'Running sub-agents',
  none: 'Nothing running now', noneSeen: 'None seen running',
  partial: 'Partial', coverage: ' sub-agent coverage',
  lossText: {
    migrated: 'This happened before the update; the date is unknown.', legacy: 'Date unknown.',
    dismiss: 'Dismiss warning', explain: 'Quiets this warning for this store. New recording gaps will warn again.',
    success: 'Warning dismissed.', error: 'Couldn’t dismiss the warning. Try again.',
    conflict: 'A newer recording gap was detected. Review it before dismissing.', recent: 'Recent recording gap.', detected: ' Last detected: ',
  },
  aboutLines: [
    'OpenChamber tracks runs, not task completion.',
    'A sub-agent’s “says done” is its own account; the task’s state is separate.',
    'Running describes sessions, while In progress describes tasks.',
  ],
};
const RU: typeof EN = {
  source: { event: 'Состояние запуска из OpenChamber.', dispatch: 'OpenChamber ещё не подтвердил результат.', history: 'Последний завершённый запуск сессии, не обязательно для этой задачи.', host: 'Что OpenChamber сейчас показывает для этой сессии.' },
  claim: { done: 'выполнено', partial: 'частично выполнено', blocked: 'заблокировано' },
  status: { pending: 'ожидает', working: 'в работе', blocked: 'заблокирована', done: 'выполнена', skipped: 'пропущена' },
  waiting: 'Ждёт вас', after: d => ` · ${d} после отправки`, took: d => ` · длительность ${d}`,
  nowTip: 'Что OpenChamber сейчас показывает для этой сессии. Записанный запуск выше не изменён.',
  notSeen: 'сейчас не виден в OpenChamber',
  again: (label, compact) => `${label} снова${compact ? '' : ' сейчас'}`,
  accepted: (word, title, compact) => compact ? `задача: ${word}` : `Задача ${word}${title ? `: ${title}` : ''}`,
  acceptedMany: (n, parts, omitted, compact) => `Задачи (${formatCount(n, 'ru')}): ${parts}${!compact && omitted ? `, ещё ${formatCount(omitted, 'ru')}` : ''}`,
  claimed: (word, _compact) => `говорит: ${word}`,
  unmatched: ' · не сопоставлено с отдельным запуском', open: 'Открыть', openSession: title => `Открыть сессию ${title}`, startedBy: title => `запущен из ${title}`,
  history: 'из истории сессии', during: 'запрошен во время этого плана', ran: 'Запуск', claimedLabel: 'Субагент', acceptedLabel: 'Состояние задачи',
  recordedTip: 'Запуски этой сессии и её субагентов. Завершённый запуск не означает выполненную задачу.',
  hostTip: 'Субагенты, которых сейчас показывает OpenChamber; записи запусков недоступны.', soFar: 'на данный момент', unchecked: 'остальные не проверены',
  loss: 'Некоторые запуски не записаны.', activityUnavailable: 'Текущая активность недоступна.', notEvery: 'Проверены не все субагенты.', unavailable: 'Записи запусков недоступны.',
  loadingHistory: 'Загрузка прошлой истории…', about: 'Об этих записях', loadMore: 'Загрузить ещё историю', retry: 'Повторить загрузку истории',
  loading: 'Загрузка…', showMore: n => n === null ? 'Показать ещё' : `Показать ещё ${n}`,
  other: 'Показать ещё', records: 'Субагенты', otherLabel: 'Показать ещё субагентов', pageError: 'Не удалось загрузить ещё субагентов; попробуйте снова.',
  subagents: 'Субагенты', aboutLabel: 'О записях субагентов', running: 'Выполняющиеся субагенты',
  none: 'Сейчас ничего не выполняется', noneSeen: 'Выполняющихся не видно',
  partial: 'Неполный', coverage: ' охват субагентов',
  lossText: {
    migrated: 'Это произошло до обновления; дата неизвестна.', legacy: 'Дата неизвестна.',
    dismiss: 'Скрыть предупреждение', explain: 'Убирает предупреждение для этого хранилища. Новые пробелы в записи снова вызовут предупреждение.',
    success: 'Предупреждение скрыто.', error: 'Не удалось скрыть предупреждение. Попробуйте снова.',
    conflict: 'Обнаружен новый пробел в записи. Просмотрите его перед скрытием.', recent: 'Недавний пробел в записи.', detected: ' Последнее обнаружение: ',
  },
  aboutLines: [
    'OpenChamber показывает запуски, а не выполнение задач.',
    'Слова субагента «выполнено» и состояние задачи показаны отдельно.',
    '«Выполняется» относится к сессиям, «В работе» — к задачам.',
  ],
};
const ZH: typeof EN = {
  source: { event: 'OpenChamber 提供的运行状态。', dispatch: 'OpenChamber 尚未确认结果。', history: '该会话最后一次完成的运行，不一定属于此任务。', host: 'OpenChamber 当前为此会话列出的状态。' },
  claim: { done: '已完成', partial: '部分完成', blocked: '受阻' },
  status: { pending: '未开始', working: '进行中', blocked: '受阻', done: '已完成', skipped: '已跳过' },
  waiting: '等待你处理', after: d => ` · 派发后 ${d}`, took: d => ` · 耗时 ${d}`,
  nowTip: 'OpenChamber 当前为此会话列出的状态。上方的运行记录不变。',
  notSeen: 'OpenChamber 当前未看到此会话',
  again: (label, compact) => `${label}（再次${compact ? '' : '，当前'}）`,
  accepted: (word, title, compact) => compact ? `任务${word}` : `任务${word}${title ? `：${title}` : ''}`,
  acceptedMany: (n, parts, omitted, compact) => `${formatCount(n, 'zh-CN')} 个任务：${parts}${!compact && omitted ? `，另有 ${formatCount(omitted, 'zh-CN')} 个` : ''}`,
  claimed: (word, _compact) => `自述${word}`,
  unmatched: ' · 未匹配到单次运行', open: '打开', openSession: title => `打开会话 ${title}`, startedBy: title => `由 ${title} 启动`,
  history: '来自会话历史', during: '在此计划期间请求启动', ran: '运行', claimedLabel: '子智能体', acceptedLabel: '任务状态',
  recordedTip: '此会话及其子智能体的运行记录。运行结束不等于任务完成。',
  hostTip: 'OpenChamber 当前列出的子智能体；没有可用的运行记录。', soFar: '截至目前', unchecked: '更多未检查',
  loss: '部分运行未被记录。', activityUnavailable: '当前活动不可用。', notEvery: '并非所有子智能体都已检查。', unavailable: '运行记录不可用。',
  loadingHistory: '正在加载更早的历史…', about: '关于这些记录', loadMore: '加载更多历史', retry: '重试加载历史',
  loading: '加载中…', showMore: n => n === null ? '显示更多' : `再显示 ${n} 条`,
  other: '显示更多', records: '子智能体', otherLabel: '显示更多子智能体', pageError: '无法加载更多子智能体，请重试。',
  subagents: '子智能体', aboutLabel: '关于子智能体记录', running: '运行中的子智能体',
  none: '当前没有运行中的', noneSeen: '未见运行中的',
  partial: '覆盖不完整', coverage: '：子智能体覆盖',
  lossText: {
    migrated: '这发生在更新之前；日期未知。', legacy: '日期未知。',
    dismiss: '忽略警告', explain: '对此进度存储不再显示此警告。新的记录缺口会再次警告。',
    success: '警告已忽略。', error: '无法忽略警告，请重试。',
    conflict: '检测到更新的记录缺口，请先查看再忽略。', recent: '最近的记录缺口。', detected: ' 最后检测于：',
  },
  aboutLines: [
    'OpenChamber 跟踪运行，不代表任务已完成。',
    '子智能体自述的完成情况与任务状态分开显示。',
    '“运行中”描述会话，“进行中”描述任务。',
  ],
};
const COPY: Record<InterfaceLanguage, typeof EN> = { en: EN, ru: RU, 'zh-CN': ZH };
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
  if (r.notSeen) {
    const qualifier = testid(el('span', 'ap-obs-last', ` · ${c.notSeen}`), 'subagent-not-seen');
    qualifier.setAttribute('role', 'note');
    qualifier.setAttribute('aria-label', c.notSeen);
    n.append(qualifier);
  }
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
}, 'zh-CN': {
  'runs-unavailable': '此进度服务不提供运行记录，因此只显示 OpenChamber 当前列出的子智能体。',
  'runs-error': '暂时无法读取运行记录；下次刷新时会再次读取。',
  'capture-off': '采集已关闭：不会记录新的运行。先前的记录仍可查看。',
  'capture-loss': '部分运行信息未被记录。',
  'history-loading': '正在加载更早的子智能体历史…',
  'history-partial': '较早的历史仅部分加载；计数可能偏低。',
  'history-failed': '无法加载较早的历史。',
  'history-request-failed': '无法请求较早的历史。',
  'history-off': '采集关闭时不会加载较早的历史。',
  'history-unavailable': 'companion 运行前无法加载较早的历史。',
  'traversal-limit': '此处的嵌套子智能体数量多于已统计的数量。',
  'host-gaps': '部分会话无法验证为此会话的子智能体，因此未包含在内。',
  'host-truncated': 'OpenChamber 列出的子智能体多于此视图检查的范围（128 行、2,000 个会话、32 层），因此部分当前活动——包括等待你处理的子会话——可能未显示或未计入。运行记录不受影响。',
  'host-activity-unavailable': 'OpenChamber 的会话列表正在重新加载或不完整，因此未显示当前活动（等待、再次运行、当前空闲）；运行记录不变。',
} };

/** Only action-changing states keep their own line; qualifications use the surface-wide note. */
export const separateNote = (n: RosterNote) => n.kind === 'runs-error' || n.kind === 'capture-off';

/** Finished and unknown records are history, not what matters now: they sit behind Show more. */
const LATER: ReadonlySet<SummaryPart['kind']> = new Set(['finished', 'unknown']);

/**
 * One count line. `subagent-count` leads the section with what matters now (waiting, running,
 * failed, interrupted); `subagent-count-more` opens the Show more disclosure with the rest. With
 * nothing current to lead with, the lead says so plainly, never "0+".
 */
function summaryNode(r: Roster, parts: SummaryPart[], language: InterfaceLanguage, later = false) {
  const c = COPY[language];
  const p = testid(el('p', later ? 'ap-sub-summary ap-sub-later' : 'ap-sub-summary'), later ? 'subagent-count-more' : 'subagent-count');
  p.title = r.recorded ? c.recordedTip : c.hostTip;
  const add = (kind: string, text: string) => {
    const part = el('span', 'ap-sub-part');
    part.dataset.kind = kind;
    const mark = el('span', 'ap-obs-mark');
    mark.setAttribute('aria-hidden', 'true');
    part.append(mark, text);
    p.append(part);
  };
  // The model supplies whole translated count strings, including any lower-bound mark.
  for (const s of parts) add(s.kind, s.text);
  if (!parts.length) add('none', r.livePartial ? c.noneSeen : c.none);
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
function recordsNode(r: Roster, v: SubagentsView, rest: SubagentEntry[], agent = true, later: SummaryPart[] = []) {
  const language = resolveLanguage('auto', v.env.locale), c = COPY[language];
  const step = EARLIER_STEP[v.surface];
  const visible = Math.max(step, v.runs?.shown ?? 0);
  const total = rest.length + r.earlierTotal;
  const runs = v.runs;
  const label = earlierPager(r, runs, visible, step, language);
  if (!total && !label && !(v.surface === 'status' && runs?.pageError)) return null;
  const more = testid(el('details', 'ap-obs-more'), 'observed-more');
  const partial = !r.recorded || r.notes.some(n => !['capture-off', 'host-truncated', 'host-gaps', 'host-activity-unavailable'].includes(n.kind));
  more.append(el('summary', '', `${r.featured.some(running) ? c.other : c.records}${total > 0 ? ` · ${total}${partial ? '+' : ''}` : ''}`));
  if (later.length) more.append(summaryNode(r, later, language, true));
  const list = el('ul', 'ap-obs-list');
  list.setAttribute('aria-label', c.otherLabel);
  for (const e of [...rest, ...r.earlier.slice(0, visible)]) list.append(expandRow(e, v.env, agent));
  if (list.childElementCount) more.append(list);
  if (v.surface === 'status' && runs?.pageError) more.append(testid(el('p', 'ap-note', c.pageError), 'subagent-page-error'));
  if (runs && label) {
    const b = testid(el('button', 'ap-link ap-sub-page', label), 'subagent-more');
    b.type = 'button';
    // Not `disabled`: a disabled button drops keyboard focus mid-read. The controller ignores repeats.
    if (runs.paging) b.setAttribute('aria-disabled', 'true');
    const loaded = r.earlier.length;
    b.addEventListener('click', () => { if (!runs.paging) runs.showMore(Math.min(visible, loaded), loaded, step); });
    more.append(b);
  }
  return more;
}

/** Failed reads and recording off stay separate from the dismissible count note. */
function noteItem(n: RosterNote, tone: WarningTone, runs: RunsPanel | null, language: InterfaceLanguage) {
  const c = COPY[language];
  const li = el('li');
  li.append(warningLine(NOTE[language][n.kind], tone, 'span'));
  if (n.kind === 'runs-error' && runs) {
    if (runs.read) li.append(el('time', '', absoluteTime(new Date(runs.read.readAt).toISOString(), language)));
    const retry = testid(el('button', 'ap-link', c.retry), 'subagent-retry-read');
    retry.type = 'button'; retry.addEventListener('click', () => runs.retryRead?.()); li.append(retry);
  }
  return li;
}

/** Non-dismissible action-changing lines on every surface. */
function coverageNode(notes: RosterNote[], runs: RunsPanel | null, language: InterfaceLanguage) {
  if (!notes.length) return null;
  const list = testid(el('ul', 'ap-sub-notes ap-warn-list'), 'subagent-coverage');
  list.dataset.notes = notes.map((n) => n.kind).join(' ');
  for (const n of notes) list.append(noteItem(n, visibleTone(n), runs, language));
  return list;
}

const visibleTone = (n: RosterNote): WarningTone => n.kind === 'capture-off' ? 'info' : 'warning';
/** The section, or null: no plan in scope, an unverified setup, or nothing useful to show. */
export function subagentsBlock(v: SubagentsView): HTMLElement | null {
  const language = resolveLanguage('auto', v.env.locale), c = COPY[language];
  const r = rosterFor(v, language);
  if (!r) return null;
  const compact = v.surface === 'status';
  // Running rows on one line each, every other record folded. Work Status has no indicator.
  const section = testid(el('section', 'ap-section ap-census ap-census-calm'), 'subagent-activity');
  section.dataset.state = r.recorded ? 'ready' : 'host-only';
  if (v.runs?.read) section.dataset.revision = String(v.runs.read.revision);
  section.dataset.complete = String(r.recorded && !r.soFar && !r.summary.some(s => s.partial) && !r.notes.some((n) => n.kind !== 'capture-off' && n.kind !== 'history-off'));
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
  // Lead with what matters now; finished and unknown counts open Show more (kept in the lead only
  // when there is no disclosure to hold them, so no count is ever dropped). The lead line is always
  // there: with no current part, even with no count at all (idle task-linked rows only), it says so.
  let lead = r.summary.filter((s) => !LATER.has(s.kind)), later = r.summary.filter((s) => LATER.has(s.kind));
  const records = recordsNode(r, v, r.featured.filter((e) => !running(e)), !compact, later);
  if (!records) { lead = r.summary; later = []; }
  head.append(summaryNode(r, lead, language));
  section.append(head);
  const now = r.featured.filter(running);
  if (now.length) {
    const list = el('ul', 'ap-obs-list');
    list.setAttribute('aria-label', c.running);
    for (const e of now) list.append(expandRow(e, v.env, !compact));
    section.append(list);
  }
  if (records) section.append(records);
  // The shell already shows recording-off once for the whole surface.
  const notes = coverageNode(r.notes.filter(n => separateNote(n) && n.kind !== 'capture-off'), v.runs, language);
  if (notes) section.append(notes);
  return section;
}
