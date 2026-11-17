// Needs you inbox presentation: the compact rail/board section, the Work Status line and the
// labelled source-wide reading a row opens. Read-only: no control here changes a task, a plan,
// the host session or the session-action pin. Only fixed copy is translated, never reported text.
import { ATTENTION_HOOKS, button, el, revealCurrentTask, testid, type Env } from './components.ts';
import { absoluteTime, clockTime, elapsedText, formatCount } from './format.ts';
import { resolveLanguage, type InterfaceLanguage } from './i18n.ts';
import { inboxGroup, inboxRequest, inboxTarget, scopeInbox, type InboxModel, type InboxPanel } from './inbox.ts';
import { hiddenItemKey, type ViewSurface } from './device-view-state.ts';
import { canOpen, coverageFor } from './live.ts';
import { elapsedAt, itemNeedsYou, type BlockerCategory, type InboxRowView, type InboxTaskTarget, type ItemView, type PlanDetail, type PlanView } from './model.ts';
import type { Loadable, ReadingView } from './app.ts';
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
    atLeastTasks: (n: number) => `${n}+ tasks`,
    summary: (n: number) => (n === 1 ? '1 task needs you' : `${n} tasks need you`),
    summaryAtLeast: (n: number) => `${n}+ tasks need you`,
    none: 'Nothing needs you right now.',
    noneShort: 'Nothing needs you',
    noneYet: 'Nothing found yet that needs you',
    partial: 'Only some plans have been checked so far, so more may need you.',
    partialNone: 'Nothing found yet. Not every plan has been checked.',
    gapped: 'Some plans couldn’t be read, so this list may be incomplete.',
    capture: 'Recording is off; new progress isn’t saved.',
    stale: (time: string) => `Not updated since ${time}; try again.`,
    unsupported: 'Needs you isn’t available; update the extension and service together.',
    unverified: 'Check the OpenCode connection in Setup.',
    invalid: 'Couldn’t check what needs you; try again.',
    listLabel: 'Tasks that need you',
    alsoListLabel: 'Other blocked tasks',
    more: 'Check more plans', moreLoading: 'Checking more plans…', moreFailed: 'More plans couldn’t be checked right now.', retry: 'Try again',
    restarted: 'The list changed while loading, so it started again from the top.',
    rechecking: 'Rechecking loaded plans. Later rows may be out of date; counts include only the first checked window until this finishes.',
    recheckWaiting: 'Waiting for the next refresh to recheck loaded plans. Later rows may be out of date; counts include only the first checked window.',
    showMore: (n: number) => `Show ${n} more`, showFewer: 'Show fewer',
    also: (n: number, exact: boolean) => `${n}${exact ? '' : '+'} more blocked on other work`,
    alsoNote: 'Other blocked work, including sub-agent requests to their parent.',
    open: (task: string, plan: string) => `Open ${task} in ${plan}`,
    plan: 'Plan: ', reason: 'Why', next: 'Asks you to', nextOther: 'Next step', unknown: 'Unknown',
    waiting: 'Waiting', waitUnknown: 'Waiting time unknown', waitUnavailable: 'Waiting time unavailable',
    waitExact: (at: string) => `Blocked since ${at}`,
    waitLower: (at: string) => `Already blocked at ${at}; start unknown.`,
    waitUnknownHelp: 'Wait time unknown.',
    category: 'Wait category: ',
    categories: { decision: 'Decision', review: 'Review', dependency: 'Dependency', external: 'External', other: 'Other' } as Record<BlockerCategory, string>,
    unclassified: 'Category unknown', unclassifiedHelp: 'The report used a category this version doesn’t recognize.',
    absent: 'No details reported', invalidDetails: 'Reported details couldn’t be read',
    lineAria: (summary: string) => `${summary} in this session. Open progress`,
    lineScope: 'this session',
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
    atLeastTasks: (n: number) => `${num(n, 'ru')}+ задач`,
    summary: (n: number) => `Нужно ваше участие: ${num(n, 'ru')} ${forms(n, 'ru', 'задача', 'задачи', 'задач')}`,
    summaryAtLeast: (n: number) => `Нужно ваше участие: ${num(n, 'ru')}+`,
    none: 'Сейчас ничего не требует вашего участия.',
    noneShort: 'Ничего не требует вашего участия',
    noneYet: 'Пока не найдено задач, где нужно ваше участие',
    partial: 'Пока проверена только часть планов, поэтому ваше участие может понадобиться ещё где-то.',
    partialNone: 'Пока ничего не найдено. Проверены не все планы.',
    gapped: 'Некоторые планы не удалось прочитать, поэтому список может быть неполным.',
    capture: 'Запись выключена; новый прогресс не сохраняется.',
    stale: (time: string) => `Не обновлялось с ${time}; попробуйте снова.`,
    unsupported: 'Раздел «Нужно ваше участие» недоступен; обновите расширение и сервис вместе.',
    unverified: 'Проверьте подключение OpenCode в настройке.',
    invalid: 'Не удалось проверить, где нужно ваше участие; попробуйте снова.',
    listLabel: 'Задачи, где нужно ваше участие',
    alsoListLabel: 'Другие заблокированные задачи',
    more: 'Проверить другие планы', moreLoading: 'Проверяем другие планы…', moreFailed: 'Сейчас не удалось проверить другие планы.', retry: 'Попробовать снова',
    restarted: 'Список изменился во время загрузки, поэтому он начат заново.',
    rechecking: 'Повторно проверяем загруженные планы. Дальние строки могут быть устаревшими; до завершения счётчики учитывают только первое проверенное окно.',
    recheckWaiting: 'Ждём следующего обновления, чтобы повторно проверить загруженные планы. Дальние строки могут быть устаревшими; счётчики учитывают только первое проверенное окно.',
    showMore: (n: number) => `Показать ещё ${num(n, 'ru')}`, showFewer: 'Свернуть',
    also: (n: number, exact: boolean) => `Ещё заблокировано другой работой: ${num(n, 'ru')}${exact ? '' : '+'}`,
    alsoNote: 'Другие заблокированные задачи, включая запросы субагентов к родительской сессии.',
    open: (task: string, plan: string) => `Открыть «${task}» в плане «${plan}»`,
    plan: 'План: ', reason: 'Почему', next: 'Что нужно сделать', nextOther: 'Следующий шаг', unknown: 'Неизвестно',
    waiting: 'Ожидает', waitUnknown: 'Время ожидания неизвестно', waitUnavailable: 'Время ожидания недоступно',
    waitExact: (at: string) => `Заблокирована с ${at}`,
    waitLower: (at: string) => `Уже заблокирована к ${at}; начало неизвестно.`,
    waitUnknownHelp: 'Время ожидания неизвестно.',
    category: 'Категория ожидания: ',
    categories: { decision: 'Решение', review: 'Проверка', dependency: 'Зависимость', external: 'Внешнее', other: 'Другое' } as Record<BlockerCategory, string>,
    unclassified: 'Категория неизвестна', unclassifiedHelp: 'В отчёте указана категория, неизвестная этой версии.',
    absent: 'Сведения не указаны', invalidDetails: 'Не удалось прочитать записанные сведения',
    lineAria: (summary: string) => `${summary} в этой сессии. Открыть прогресс`,
    lineScope: 'эта сессия',
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
  'zh-CN': {
    heading: '需要你处理',
    scope: '此 OpenCode 配置所有当前计划中报告的决策和审阅事项。',
    tasks: (n: number) => `${num(n, 'zh-CN')} 个任务`,
    atLeastTasks: (n: number) => `${num(n, 'zh-CN')}+ 个任务`,
    summary: (n: number) => `${num(n, 'zh-CN')} 个任务需要你处理`,
    summaryAtLeast: (n: number) => `${num(n, 'zh-CN')}+ 个任务需要你处理`,
    none: '目前没有需要你处理的事项。', noneShort: '没有需要你处理的事项', noneYet: '尚未找到需要你处理的事项',
    partial: '目前只检查了部分计划，可能还有其他事项需要你处理。',
    partialNone: '尚未找到事项。并非所有计划都已检查。',
    gapped: '部分计划无法读取，此列表可能不完整。',
    capture: '记录已关闭，新进度不会保存。',
    stale: (time: string) => `自 ${time} 起尚未更新，请重试。`,
    unsupported: '“需要你处理”不可用；请同时更新扩展和服务。',
    unverified: '请在设置中检查 OpenCode 连接。',
    invalid: '无法检查需要你处理的事项，请重试。',
    listLabel: '需要你处理的任务', alsoListLabel: '其他受阻任务',
    more: '检查更多计划', moreLoading: '正在检查更多计划…', moreFailed: '暂时无法检查更多计划。', retry: '重试',
    restarted: '加载期间列表发生变化，已从头开始读取。',
    rechecking: '正在重新检查已加载的计划。后续行可能已过期；完成前计数仅涵盖首个已检查窗口。',
    recheckWaiting: '等待下次刷新以重新检查已加载的计划。后续行可能已过期；计数仅涵盖首个已检查窗口。',
    showMore: (n: number) => `再显示 ${num(n, 'zh-CN')} 项`, showFewer: '收起',
    also: (n: number, exact: boolean) => `${num(n, 'zh-CN')}${exact ? '' : '+'} 项因其他工作受阻`,
    alsoNote: '其他受阻任务，包括子智能体向父会话提出的请求。',
    open: (task: string, plan: string) => `打开“${plan}”中的“${task}”`,
    plan: '计划：', reason: '原因', next: '需要你做的事', nextOther: '下一步', unknown: '未知',
    waiting: '等待中', waitUnknown: '等待时长未知', waitUnavailable: '等待时长不可用',
    waitExact: (at: string) => `自 ${at} 起受阻`,
    waitLower: (at: string) => `${at} 时已受阻，开始时间未知。`,
    waitUnknownHelp: '等待时间未知。',
    category: '等待类别：',
    categories: { decision: '决策', review: '审阅', dependency: '依赖', external: '外部', other: '其他' } as Record<BlockerCategory, string>,
    unclassified: '类别未知', unclassifiedHelp: '报告使用了此版本无法识别的类别。',
    absent: '未报告详情', invalidDetails: '无法读取报告的详情',
    lineAria: (summary: string) => `${summary}，限此会话。打开进度`, lineScope: '此会话',
    readingLabel: '从“需要你处理”打开', readingNote: '这是当前计划。此处的操作不会更改任务。',
    backPanel: '返回会话进度', backBoard: '返回计划',
    revealNeeds: (task: string) => `需要你处理：${task}`, revealAlso: (task: string) => `其他受阻任务：${task}`,
    gone: '此计划已不可用，无法显示任务。',
    taskGone: (task: string) => `“${task}”已不在此计划中。计划仍保持打开，可继续阅读。`,
    notBlocked: (task: string, status: string) => `“${task}”已不再受阻，当前状态为${status}。`,
    inactive: '此计划已不再活跃。', archived: '此计划已归档。', otherSetup: '无法再从此 OpenCode 配置读取该计划。',
    loading: '正在加载当前计划…', failed: '无法加载当前计划，因此无法显示任务。未做任何更改。',
    statuses: { pending: '未开始', working: '进行中', blocked: '受阻', done: '已完成', skipped: '已跳过' } as Record<ItemView['status'], string>,
  },
} satisfies Record<InterfaceLanguage, Record<string, unknown>>;
export const inboxCopy = (locale: string) => INBOX_COPY[resolveLanguage('auto', locale)];

const COMPACT_COPY = {
  en: { session: 'This session', plan: 'This plan', all: 'All plans', open: 'Open session', unavailable: 'This session is not available here.', copy: 'Copy reply', copied: 'Copied; paste it in the session’s message box, then edit and send.', fallback: 'Copy this reply frame:', hide: 'Hide', undo: 'Undo hide', unhide: 'Show again', savedFailed: 'Could not save this choice on this device.', readFailed: 'Could not read saved choices on this device.', other: (n: string) => `${n} need you in other plans`, hidden: (n: number) => `Hidden items · ${n}`, reply: (task: string, plan: string) => `Reply about “${task}” in “${plan}”:\n\n` },
  ru: { session: 'Эта сессия', plan: 'Этот план', all: 'Все планы', open: 'Открыть сессию', unavailable: 'Эта сессия здесь недоступна.', copy: 'Скопировать ответ', copied: 'Скопировано; вставьте в поле сообщения сессии, затем измените и отправьте.', fallback: 'Скопируйте шаблон ответа:', hide: 'Скрыть', undo: 'Отменить скрытие', unhide: 'Показать снова', savedFailed: 'Не удалось сохранить выбор на этом устройстве.', readFailed: 'Не удалось прочитать сохранённый выбор на этом устройстве.', other: (n: string) => `Нужно ваше участие в других планах: ${n}`, hidden: (n: number) => `Скрытые задачи · ${n}`, reply: (task: string, plan: string) => `Ответ по задаче «${task}» в плане «${plan}»:\n\n` },
  'zh-CN': { session: '此会话', plan: '此计划', all: '所有计划', open: '打开会话', unavailable: '此会话在这里不可用。', copy: '复制回复', copied: '已复制，请粘贴到会话输入框，编辑后发送。', fallback: '复制此回复模板：', hide: '隐藏', undo: '撤销隐藏', unhide: '重新显示', savedFailed: '无法在此设备上保存选择。', readFailed: '无法读取此设备上保存的选择。', other: (n: string) => `其他计划中有 ${n} 项需要你处理`, hidden: (n: number) => `已隐藏事项 · ${n}`, reply: (task: string, plan: string) => `关于“${plan}”中“${task}”的回复：\n\n` },
};
export const compactInboxCopy = (locale: string) => COMPACT_COPY[resolveLanguage('auto', locale)];
export const replyFrame = (row: InboxRowView, locale: string) => compactInboxCopy(locale).reply(row.task.title, row.planTitle);
const hiddenNotice = (locale: string) => ({
  en: 'Hidden on this device until this task changes.',
  ru: 'Скрыто на этом устройстве, пока задача не изменится.',
  'zh-CN': '已在此设备上隐藏，任务更改后将重新显示。',
})[resolveLanguage('auto', locale)];
export function revealInboxTask(reading: ReadingView | null, plan: PlanView | null, row: InboxRowView, revealMap?: (id: string) => boolean) {
  if (!plan || plan.key !== row.planKey) return;
  if (revealMap?.(row.task.id)) return;
  const restoreFocus = (root: ParentNode) => {
    // Use the final paint: a filtered List reveal may schedule another reading.set.
    [...root.querySelectorAll<HTMLElement>('[data-testid="needs-you-row"]')].find(n => n.dataset.row === row.rowKey)?.querySelector<HTMLElement>('.ap-inbox-open')?.focus({ preventScroll: true });
  };
  reading?.set({}, root => {
    const article = [...root.querySelectorAll<HTMLElement>('article.ap-plan')].find(n => n.dataset.testid === `plan-${row.plan}`);
    if (article) revealCurrentTask(article, plan, row.task.id, '', revealed => restoreFocus(revealed.ownerDocument));
    else restoreFocus(root);
  });
}

interface InboxReplyCopy {
  text: string;
  result: 'idle' | 'copied' | 'fallback';
  pending: boolean;
  preview: HTMLTextAreaElement | null;
  selection: { start: number; end: number; direction: 'forward' | 'backward' | 'none'; top: number } | null;
}

/** Every non-device state stays frame-local and is retired on scope/installation change. */
export class CompactInbox {
  private identity = '';
  private openedRow: string | null = null;
  private copy: InboxReplyCopy | null = null;
  all = false;
  get opened() { return this.openedRow; }
  set opened(row: string | null) {
    if (row !== this.openedRow) this.copy = null;
    this.openedRow = row;
  }
  replyCopy(row: string, text: string): InboxReplyCopy | null {
    if (row !== this.opened) return null;
    if (!this.copy || this.copy.text !== text) this.copy = { text, result: 'idle', pending: false, preview: null, selection: null };
    return this.copy;
  }
  currentCopy(copy: InboxReplyCopy) { return this.copy === copy; }
  showHidden = false;
  undo: string | null = null;
  expanded: boolean | null = null;
  matches(identity: string) { return this.identity === identity; }
  reconcile(identity: string) {
    if (identity === this.identity) return;
    this.identity = identity; this.all = false; this.opened = null; this.showHidden = false; this.undo = null; this.expanded = null;
  }
}

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
  return { token: ++readings, target: inboxTarget(row, storeId), task: row.task.title, planTitle: row.planTitle, coordinator: row.coordinatorSessionId, group: inboxGroup(row), rowKey: row.rowKey };
}
/**
 * Detail request of a reading (see inboxRequest). Keep current detail metadata even after the
 * plan leaves the inbox; the frame revalidates its head on the existing refresh cadence.
 */
export function readingRequest(r: InboxReading, model?: InboxModel | null, latest?: PlanView | null) {
  const key = `${r.target.source}/${r.target.plan}`;
  let revision = r.target.revision;
  for (const row of [...model?.needsYou ?? [], ...model?.alsoBlocked ?? []]) if (row.planKey === key && row.revision > revision) revision = row.revision;
  const request = inboxRequest({ ...r.target, revision }, r.planTitle, r.coordinator);
  return latest?.key === key && latest.revision >= revision && (latest.cleanup?.revision ?? 0) >= r.target.cleanupRev ? latest : request;
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
  time.textContent = text === null ? t.unknown : a.kind === 'lower-bound' ? `${text}+` : text;
  wrap.append(el('span', 'ap-muted', `${t.waiting} `), time);
  return wrap;
}

function rowItem(row: InboxRowView, index: number, prefix: string, m: InboxModel, env: Env, open: (row: InboxRowView) => void) {
  const t = inboxCopy(env.locale);
  const li = testid(el('li', 'ap-inbox-row'), 'needs-you-row');
  // Stable identity for focus continuity across polls (the frame matches data-state with the hook).
  li.dataset.state = row.rowKey;
  Object.assign(li.dataset, { row: row.rowKey, source: row.source, plan: row.plan, task: row.task.id, group: inboxGroup(row), revision: String(row.revision) });
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
    add(inboxGroup(row) === 'needs-you' ? t.next : t.nextOther, row.blocker.nextAction, 'needs-you-next');
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

export interface CompactInboxOptions {
  open: (row: InboxRowView) => void;
  stale: number | null;
  state: CompactInbox;
  surface: ViewSurface;
  keys: ReadonlySet<string>;
  scopeComplete: boolean;
  identity: string;
  changed: () => void;
  focus: (hook: string) => void;
  plans: PlanView[];
  shownPlan?: string | null;
  retry?: () => void;
}
export function hiddenInboxAction(panel: InboxPanel | null, state: CompactInbox, locale: string, changed: () => void, surface: ViewSurface) {
  const n = panel?.model.needsYou.filter(row => panel.device?.hidden(hiddenItemKey(panel.storeId ?? '', row))).length ?? 0;
  return n ? [{ id: 'needs-you-hidden', label: compactInboxCopy(locale).hidden(n), run: () => { state.showHidden = true; state.expanded = true; void panel?.device?.setExpanded(surface, true); changed(); } }] : [];
}

/** One disclosure, scoped rows and one in-place reading. No task or host composer writes. */
export function inboxSection(panel: InboxPanel, env: Env, options: CompactInboxOptions) {
  const { state, surface } = options, device = panel.device;
  state.reconcile(options.identity);
  const t = inboxCopy(env.locale), c = compactInboxCopy(env.locale);
  const isHidden = (row: InboxRowView) => device?.hidden(hiddenItemKey(panel.storeId ?? '', row)) ?? false;
  const m = scopeInbox(panel.model, state.all ? null : options.keys, options.stale === null && (state.all || options.scopeComplete), device, panel.storeId).model;
  const other = scopeInbox(panel.model, options.keys, options.scopeComplete, device, panel.storeId).other;
  const hidden = panel.model.needsYou.filter(isHidden);
  if (state.opened && !m.needsYou.some(row => row.rowKey === state.opened)) state.opened = null;
  if (state.undo && !device?.hidden(state.undo)) state.undo = null;
  const expanded = state.expanded ?? device?.expanded(surface) ?? surface === 'page';
  const box = testid(el('section', 'ap-inbox ap-inbox-compact'), ATTENTION_HOOKS.inbox);
  box.dataset.availability = m.availability;
  if (surface === 'panel' && m.availability === 'ready' && m.complete && !m.counts.needsYou && !other && !hidden.length && options.stale === null && !device?.error) box.hidden = true;
  box.setAttribute('aria-labelledby', 'ap-inbox-h');
  const toggle = testid(el('button', 'ap-inbox-toggle'), 'needs-you-toggle');
  toggle.type = 'button'; toggle.id = 'ap-inbox-h';
  toggle.setAttribute('aria-expanded', String(expanded)); toggle.setAttribute('aria-controls', 'ap-inbox-content');
  toggle.append(el('span', '', t.heading));
  if (m.availability === 'ready') {
    const count = testid(el('span', 'ap-inbox-count', `${m.counts.needsYou}${m.complete ? '' : '+'}`), ATTENTION_HOOKS.count);
    Object.assign(count.dataset, { count: String(m.counts.needsYou), exact: String(m.complete) });
    if (m.counts.needsYou) count.dataset.tone = 'attention';
    if (m.loadingMore || m.rechecking) count.setAttribute('aria-busy', 'true');
    toggle.append(count);
    const oldest = m.needsYou.filter(row => row.wait).sort((a, b) => elapsedAt(b.wait!, env.mono) - elapsedAt(a.wait!, env.mono))[0];
    if (oldest) {
      const minimum = !m.complete && oldest.wait ? { ...oldest, wait: { ...oldest.wait, kind: 'lower-bound' as const } } : oldest;
      const wait = waitLabel(minimum, m, env); wait.classList.add('ap-inbox-oldest'); toggle.append(wait);
    }
  }
  toggle.addEventListener('click', () => {
    if (device && device.error !== 'read') void device.setExpanded(surface, !expanded).then(ok => { if (ok && state.matches(options.identity)) { state.expanded = null; options.changed(); } }); else state.expanded = !expanded;
    options.changed();
  });
  const h = testid(el('h2', 'ap-inbox-title'), 'needs-you-heading'); h.append(toggle); box.append(h);
  if (m.availability !== 'ready') {
    box.append(testid(warningLine(m.availability === 'unsupported' ? t.unsupported : m.availability === 'unverified' ? t.unverified : t.invalid, 'info', 'p'), 'needs-you-unavailable'));
    if (options.retry) button(box, 'needs-you-retry', t.retry, options.retry, 'ghost');
    return box;
  }
  if (options.stale !== null) {
    box.append(testid(warningLine(t.stale(clockTime(options.stale, env.locale)), 'warning', 'p'), 'needs-you-stale'));
    if (options.retry) button(box, 'needs-you-retry', t.retry, options.retry, 'ghost');
  }
  // Recording state belongs to the surface's one non-dismissible recording line.
  if (!m.counts.needsYou && !state.all && other) button(box, 'needs-you-other-plans', c.other(`${other}${panel.model.complete && options.stale === null ? '' : '+'}`), () => { state.all = true; state.expanded = true; void device?.setExpanded(surface, true); options.changed(); }, 'ghost');
  const body = testid(el('div', 'ap-inbox-content'), 'needs-you-content'); body.id = 'ap-inbox-content'; body.hidden = !expanded;
  box.append(body);
  const scopes = testid(el('div', 'ap-row ap-inbox-scopes'), 'needs-you-scope');
  for (const [all, label] of [[false, surface === 'panel' ? c.session : c.plan], [true, c.all]] as const) {
    const b = button(scopes, `needs-you-scope-${all ? 'all' : 'current'}`, label, () => { state.all = all; state.opened = null; options.changed(); }, 'ghost');
    b.querySelector('button')!.setAttribute('aria-pressed', String(state.all === all));
  }
  body.append(scopes);
  if (device?.error) {
    box.append(testid(warningLine(device.error === 'read' ? c.readFailed : c.savedFailed, 'warning', 'p'), 'needs-you-device-error'));
    button(box, 'needs-you-device-retry', t.retry, () => { void device.refresh(true); }, 'ghost');
  }
  if (!m.needsYou.length) body.append(testid(el('p', 'ap-inbox-empty', m.complete ? t.none : t.noneYet), 'needs-you-empty'));
  const list = el('ul', 'ap-inbox-list'); list.setAttribute('aria-label', t.listLabel); body.append(list);
  for (const row of m.needsYou) {
    const hook = `needs-you-open-${row.rowKey}`;
    const li = testid(el('li', 'ap-inbox-row'), 'needs-you-row');
    Object.assign(li.dataset, { row: row.rowKey, task: row.task.id, plan: row.plan, group: 'needs-you', revision: String(row.revision), info: `inbox:${row.rowKey}` });
    const open = testid(el('button', 'ap-inbox-open'), hook); open.type = 'button';
    open.append(el('span', 'ap-inbox-task', row.task.title));
    if (state.all) open.append(el('span', 'ap-inbox-plan', row.planTitle));
    const meta = el('span', 'ap-inbox-line-meta'); meta.append(categoryTag(row, env.locale), waitLabel(row, m, env)); open.append(meta);
    open.setAttribute('aria-expanded', String(state.opened === row.rowKey));
    const detailsId = `ap-inbox-details-${list.childElementCount}`; open.setAttribute('aria-controls', detailsId);
    open.addEventListener('click', () => { state.opened = state.opened === row.rowKey ? null : row.rowKey; if (state.opened) options.open(row); options.changed(); });
    li.append(open);
    const facts = el('div', 'ap-inbox-facts'); facts.id = detailsId; facts.hidden = state.opened !== row.rowKey;
    li.addEventListener('keydown', e => { if (e.key === 'Escape' && state.opened === row.rowKey) { e.preventDefault(); e.stopPropagation(); state.opened = null; options.focus(hook); options.changed(); } });
    if (!state.all) facts.append(el('p', 'ap-inbox-plan', row.planTitle));
    if (row.blocker.state === 'reported') {
      for (const [label, value, id] of [[t.reason, row.blocker.reason, 'needs-you-reason'], [t.next, row.blocker.nextAction, 'needs-you-next']] as const) {
        facts.append(el('span', 'ap-muted', label), testid(el('blockquote', 'ap-inbox-quote', value ?? t.unknown), id));
      }
    }
    const actions = el('div', 'ap-row ap-inbox-actions');
    const directory = options.plans.find(p => p.key === row.planKey)?.directory ?? '';
    if (env.openSession && canOpen(row.source, env.boundSource, coverageFor(row.coordinatorSessionId, directory, env.live))) {
      button(actions, 'needs-you-open-session', c.open, () => env.openSession!(row.coordinatorSessionId), 'outline');
    } else facts.append(testid(el('p', 'ap-note', c.unavailable), 'needs-you-session-unavailable'));
    const status = testid(el('p', 'ap-note'), 'needs-you-copy-status'); status.setAttribute('role', 'status');
    const text = replyFrame(row, env.locale), copy = state.replyCopy(row.rowKey, text);
    if (copy?.result === 'fallback' && copy.preview?.isConnected) {
      const previous = copy.preview;
      copy.selection = { start: previous.selectionStart, end: previous.selectionEnd, direction: previous.selectionDirection, top: previous.scrollTop };
    }
    status.textContent = copy?.result === 'copied' ? c.copied : copy?.result === 'fallback' ? c.fallback : '';
    const fallback = testid(el('textarea', 'ap-input'), 'needs-you-copy-fallback'); fallback.readOnly = true; fallback.hidden = copy?.result !== 'fallback'; fallback.value = text; fallback.setAttribute('aria-label', c.fallback);
    if (copy) {
      copy.preview = fallback;
      if (copy.selection) {
        fallback.setSelectionRange(copy.selection.start, copy.selection.end, copy.selection.direction);
        fallback.scrollTop = copy.selection.top;
      }
    }
    button(actions, 'needs-you-copy-reply', c.copy, () => {
      if (!copy || !state.currentCopy(copy) || copy.pending) return;
      copy.pending = true;
      options.changed();
      void (async () => {
        let copied = false;
        try { await navigator.clipboard.writeText(text); copied = true; } catch {}
        // Closing/reopening the item or changing its reply retires the old completion.
        if (!state.currentCopy(copy)) return;
        copy.pending = false;
        copy.result = copied ? 'copied' : 'fallback';
        if (!copied) {
          copy.selection = { start: 0, end: text.length, direction: 'none', top: 0 };
          // A pending request may span several paints; select the latest preview, not
          // the node captured by the Copy button's original closure.
          const preview = copy.preview;
          if (preview?.isConnected) { preview.hidden = false; preview.focus(); preview.select(); }
        }
        options.changed();
      })();
    }, 'outline', copy?.pending ?? false);
    if (device?.canHide) button(actions, 'needs-you-hide', c.hide, () => {
      const key = hiddenItemKey(panel.storeId ?? '', row);
      options.focus('needs-you-toggle');
      void device.hide(key).then(ok => { if (ok && state.matches(options.identity)) { state.undo = key; state.opened = null; options.changed(); } });
    }, 'ghost');
    facts.append(actions, status, fallback); li.append(facts); list.append(li);
  }
  if (state.undo) {
    const notice = testid(el('p', 'ap-note', hiddenNotice(env.locale)), 'needs-you-hidden-notice'); notice.setAttribute('role', 'status'); body.append(notice);
    button(body, 'needs-you-undo-hide', c.undo, () => { void device?.unhide(state.undo!).then(ok => { if (ok) { state.undo = null; options.changed(); } }); }, 'ghost');
  }
  if (hidden.length) {
    const b = button(body, 'needs-you-hidden-count', c.hidden(hidden.length), () => { state.showHidden = !state.showHidden; options.changed(); }, 'ghost');
    b.querySelector('button')!.setAttribute('aria-expanded', String(state.showHidden));
    if (state.showHidden) for (const row of hidden) {
      const line = testid(el('div', 'ap-inbox-hidden-row'), 'needs-you-hidden-row');
      line.dataset.info = hiddenItemKey(panel.storeId ?? '', row);
      line.append(el('span', '', `${row.task.title} · ${row.planTitle}`));
      button(line, 'needs-you-unhide', c.unhide, () => { void device?.unhide(hiddenItemKey(panel.storeId ?? '', row)); }, 'ghost'); body.append(line);
    }
  }
  if (m.alsoBlocked.length) {
    const also = el('div', 'ap-note'); also.dataset.count = String(m.counts.alsoBlocked);
    const row = m.alsoBlocked.find(r => r.planKey === options.shownPlan);
    if (row) button(also, ATTENTION_HOOKS.alsoBlocked, t.also(m.counts.alsoBlocked, m.complete), () => options.open(row), 'ghost');
    else { also.dataset.testid = ATTENTION_HOOKS.alsoBlocked; also.textContent = t.also(m.counts.alsoBlocked, m.complete); }
    body.append(also);
  }
  return box;
}

/**
 * Work Status entry: one line with the count, opening the rail (where the inbox already is). No
 * line without an advertised, verified, readable inbox; never a guessed zero.
 */
export function statusInboxLine(m: InboxModel, locale: string, open: () => void, stale: number | null = null) {
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
  if (stale !== null) line.append(testid(warningLine(t.stale(clockTime(stale, locale)), 'warning', 'p'), 'needs-you-stale'));
  if (!m.captureEnabled) line.append(testid(warningLine(t.capture, 'info', 'p'), 'needs-you-capture-off'));
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
  const message = task && itemNeedsYou(plan, task) ? t.revealNeeds(r.task) : t.revealAlso(r.task);
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
  reset(reason: 'reset' | 'hidden' | 'dispose' = 'dispose') {
    // Data caches can be retired while the same reading survives. Recovery must
    // not reveal its task again or steal focus from the reader's current control.
    if (reason === 'reset') return;
    this.revealed = 0; this.back = null; this.opened = 0;
  }
  afterPaint(root: HTMLElement, r: InboxReading | null, check: ReadingCheck | null, reveal: (article: HTMLElement, plan: PlanView, item: string, message: string) => void) {
    const owns = document.hasFocus?.() ?? true;
    if (!r) {
      const key = this.back;
      this.back = null;
      if (key === null || !owns) return;
      const row = [...root.querySelectorAll<HTMLElement>('[data-testid="needs-you-row"]')].find((n) => n.dataset.row === key);
      const disclosure = row?.closest('details');
      if (disclosure) disclosure.open = true;
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
