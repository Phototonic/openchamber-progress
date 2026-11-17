import type { CleanupAction, CleanupRequest } from './adapter.ts';
import type { PlanView } from './model.ts';
import { resolveLanguage } from './i18n.ts';
import { cleanupCall, type ServiceHost } from './source.ts';
import { formatCount, plural } from './format.ts';

const en = {
  changed: 'This plan changed or is no longer available. Progress is being refreshed; review it before trying again.',
  busy: 'The progress store is busy. Nothing was confirmed. Refreshing before you try again.',
  uncertain: 'The action could not be confirmed. It may have reached the service. Refreshing progress; check the plan before trying again.',
  archive: 'Plan archived. Find it in Archived plans on the full page.',
  restore: 'Plan restored. Its status and history are unchanged.',
  delete: 'Stored plan deleted. The original file was not changed.',
};
const ru: typeof en = {
  changed: 'План изменился или больше недоступен. Прогресс обновляется; проверьте его перед повторной попыткой.',
  busy: 'Хранилище прогресса занято. Действие не подтверждено. Обновляем данные перед повторной попыткой.',
  uncertain: 'Действие не удалось подтвердить. Запрос мог дойти до сервиса. Обновляем прогресс; проверьте план перед повторной попыткой.',
  archive: 'План архивирован. Его можно найти в архиве планов на полной странице.',
  restore: 'План восстановлен. Статус и история не изменились.',
  delete: 'Сохранённый план удалён. Исходный файл не изменён.',
};
export type CleanupMessage = { kind: CleanupAction } | { kind: 'error'; code: string };
const zh: typeof en = {
  changed: '此计划已发生变化或不再可用。正在刷新进度；请检查后再试。',
  busy: '进度存储正忙，尚未确认任何操作。正在刷新，请稍后重试。',
  uncertain: '无法确认操作结果，请求可能已到达服务。正在刷新进度；请检查计划后再试。',
  archive: '计划已归档。可在全屏页面的“已归档计划”中查找。',
  restore: '计划已恢复，状态和历史记录不变。',
  delete: '存储中的计划已删除，原始文件未被更改。',
};
export function cleanupFeedback(message: CleanupMessage, locale = 'en') {
  const language = resolveLanguage('auto', locale);
  return message.kind === 'error' ? cleanupError(message.code, locale) : (language === 'ru' ? ru : language === 'zh-CN' ? zh : en)[message.kind];
}

export interface CleanupTarget {
  key: string; title: string; lifecycle: PlanView['lifecycle']; context: string; request: CleanupRequest;
}
export type CleanupPlan = Pick<PlanView, 'key' | 'title' | 'lifecycle' | 'sourceId' | 'id' | 'revision' | 'cleanup'>;
export interface CleanupState {
  target: CleanupTarget | null;
  pending: boolean;
  message: CleanupMessage | null;
  error: boolean;
  tidy?: TidyState;
}
export const initialCleanup = (): CleanupState => ({ target: null, pending: false, message: null, error: false });
export function cleanupTarget(plan: CleanupPlan, storeId: string, context: string): CleanupTarget {
  return { key: plan.key, title: plan.title, lifecycle: plan.lifecycle, context, request: { storeId, source: plan.sourceId, plan: plan.id, rev: plan.revision, cleanupRev: plan.cleanup?.revision ?? 0, oid: crypto.randomUUID() } };
}
export function cleanupClosed(plan: Pick<PlanView, 'lifecycle'>) {
  return ['completed', 'cancelled', 'failed'].includes(plan.lifecycle);
}
export function cleanupMatches(target: CleanupTarget, plan: PlanView | null, storeId: string | undefined, context: string) {
  return !!plan && cleanupClosed(plan) && target.context === context && target.request.storeId === storeId && target.key === plan.key && target.request.rev === plan.revision && target.request.cleanupRev === (plan.cleanup?.revision ?? 0);
}
export function cleanupEligible(action: CleanupAction, plan: PlanView) {
  return cleanupClosed(plan) && (action === 'delete' || (action === 'restore') === (plan.cleanup?.state === 'archived'));
}
export function cleanupError(code: string, locale = 'en') {
  const language = resolveLanguage('auto', locale);
  const text = language === 'ru' ? ru : language === 'zh-CN' ? zh : en;
  if (['conflict', 'closed', 'operation-reused', 'not-found'].includes(code)) return text.changed;
  if (code === 'busy') return text.busy;
  return text.uncertain;
}

export const TIDY_LIMIT = 1000;
export const TIDY_SCAN_LIMIT = 2000;
export interface TidyConfirmation {
  context: string;
  targets: CleanupTarget[];
  total: number;
  archived?: boolean;
  matching?: boolean;
  limited?: boolean;
  unchecked?: boolean;
  deleting?: boolean;
}
export interface TidyResult {
  action: CleanupAction;
  attempted: number;
  total: number;
  succeeded: CleanupTarget[];
  remaining: CleanupTarget[];
}
export interface TidyState {
  context: string;
  confirmation?: TidyConfirmation;
  result?: TidyResult;
  counting?: boolean;
  countFailed?: boolean;
  progress?: { action: CleanupAction; done: number; total: number };
  scan?: CleanupScan;
}
export function tidyEligible(plan: CleanupPlan, archived = false) {
  return cleanupClosed(plan) && (plan.cleanup?.state === 'archived') === archived;
}
/** Use a loaded list only when its scope is complete; otherwise use CleanupScan. */
export function tidyConfirmation(plans: CleanupPlan[], storeId: string, context: string, archived = false): TidyConfirmation {
  const eligible = plans.filter(p => tidyEligible(p, archived));
  return { context, archived, total: Math.min(eligible.length, TIDY_LIMIT), limited: eligible.length > TIDY_LIMIT,
    targets: eligible.slice(0, TIDY_LIMIT).map(p => cleanupTarget(p, storeId, context)) };
}
export interface CleanupScanPage {
  plans: CleanupPlan[];
  /** Work visited by the service, including nonmatches, not the number of hits. */
  visited: number;
  nextCursor: string | null;
}
/** A panel-local traversal. It never mutates the ordinary list or its caches. */
export class CleanupScan {
  private cursor: string | null = null;
  private exhausted = false;
  private overflow = false;
  private busy = false;
  private retired = false;
  private targets = new Map<string, CleanupTarget>();
  readonly context: string;
  private storeId: string;
  private archived: boolean;
  private read: (cursor: string | null, current: () => boolean) => Promise<CleanupScanPage>;
  private matching: boolean;
  private windowBound: number;
  constructor(
    context: string,
    storeId: string,
    archived: boolean,
    read: (cursor: string | null, current: () => boolean) => Promise<CleanupScanPage>,
    matching = false,
    /** Search windows visit at most 64 plans; reserve that before issuing one. */
    windowBound = 50,
  ) {
    this.context = context; this.storeId = storeId; this.archived = archived;
    this.read = read; this.matching = matching; this.windowBound = windowBound;
  }
  cancel() { this.retired = true; }
  async more(current: () => boolean): Promise<TidyConfirmation | null> {
    if (this.busy || this.retired || !current()) return null;
    this.busy = true;
    const active = () => !this.retired && current();
    let visited = 0;
    try {
      while (!this.exhausted && this.targets.size < TIDY_LIMIT && visited + this.windowBound <= TIDY_SCAN_LIMIT) {
        if (!active()) return null;
        const page = await this.read(this.cursor, active);
        if (!active()) return null;
        if (!Number.isSafeInteger(page.visited) || page.visited < 1 || page.visited > this.windowBound ||
          (page.nextCursor !== null && page.nextCursor === this.cursor)) throw new Error('Invalid cleanup scan continuation.');
        visited += page.visited;
        for (const p of page.plans) {
          if (!tidyEligible(p, this.archived) || this.targets.has(p.key)) continue;
          if (this.targets.size >= TIDY_LIMIT) { this.overflow = true; break; }
          this.targets.set(p.key, cleanupTarget(p, this.storeId, this.context));
        }
        this.cursor = page.nextCursor;
        this.exhausted = this.cursor === null;
      }
      return { context: this.context, targets: [...this.targets.values()], total: this.targets.size,
        archived: this.archived, matching: this.matching,
        limited: this.overflow || this.targets.size === TIDY_LIMIT && !this.exhausted,
        unchecked: this.targets.size < TIDY_LIMIT && !this.exhausted };
    } finally { this.busy = false; }
  }
}
/** Shared sequential engine: receipt-bound results, no retries, context/Stop checked before each request.
 * Selection explicitly opts into active targets; Tidy never does. */
export async function runTidy(host: ServiceHost, action: CleanupAction, targets: CleanupTarget[], current: () => boolean,
  progress?: (done: number, total: number) => void, allowActive = false): Promise<TidyResult> {
  const succeeded: CleanupTarget[] = [];
  let attempted = 0;
  for (const target of targets.slice(0, TIDY_LIMIT)) {
    if (!current()) break;
    if (!cleanupClosed(target) && !allowActive) continue;
    attempted++;
    const { active: _active, ...request } = target.request;
    const result = await cleanupCall(host, action, { ...request,
      ...(!cleanupClosed(target) && allowActive && action !== 'restore' ? { active: true as const } : {}) });
    if (result.ok) succeeded.push({
      ...target,
      request: { ...target.request, cleanupRev: result.cleanup.revision, oid: crypto.randomUUID() },
    });
    progress?.(succeeded.length, targets.length);
  }
  const keys = new Set(succeeded.map(t => t.key));
  return { action, attempted, total: targets.length, succeeded, remaining: targets.filter(t => !keys.has(t.key)) };
}

const tidyEn = {
  menu: 'Tidy', heading: (n: number) => `${plural(n, 'closed plan', 'closed plans')} here.`,
  empty: 'No closed plans here.', counting: 'Counting closed plans…', countFailed: 'Could not count plans. Try again.',
  matching: (n: number) => `${plural(n, 'matching closed plan', 'matching closed plans')}.`,
  limited: (n: number, matching = false) => `First ${n} ${matching ? 'matching ' : ''}closed plans; more remain.`,
  unchecked: (n: number, matching = false) => `${plural(n, matching ? 'matching closed plan found' : 'closed plan found', matching ? 'matching closed plans found' : 'closed plans found')}; more plans weren’t checked.`,
  checkMore: 'Check more', stop: 'Stop', details: 'What deletion removes',
  deleteMenu: 'Delete permanently…',
  deleteHeading: (n: number) => `Delete ${plural(n, 'plan', 'plans')}? This cannot be undone.`,
  deleteConfirm: (n: number) => `Delete ${plural(n, 'plan', 'plans')} permanently`,
  cancel: 'Cancel', confirm: (n: number) => `Archive ${plural(n, 'plan', 'plans')}`, pending: 'Archiving…', undo: 'Undo', retry: 'Try again', restoring: 'Restoring…',
  progress: (n: number, total: number, action: CleanupAction) => `${action === 'archive' ? 'Archiving' : action === 'restore' ? 'Restoring' : 'Deleting'}: ${n} of ${total}.`,
  count: (n: number, total: number) => `${n} of ${total} closed plans.`,
  result: (n: number, total: number, action: CleanupAction | boolean) => `${n < total ? `${n} of ${total} plans` : plural(n, 'plan', 'plans')} ${action === true || action === 'restore' ? 'restored' : action === 'delete' ? 'deleted' : 'archived'}${n < total ? `; ${total - n} skipped` : ''}.`,
};
const russianPlans = (n: number, closed = false) => {
  const form = new Intl.PluralRules('ru').select(n);
  return closed ? form === 'one' ? 'закрытый план' : form === 'few' ? 'закрытых плана' : 'закрытых планов'
    : form === 'one' ? 'план' : form === 'few' ? 'плана' : 'планов';
};
const tidyRu: typeof tidyEn = {
  menu: 'Убрать', heading: n => `Здесь ${formatCount(n, 'ru')} ${russianPlans(n, true)}.`,
  empty: 'Здесь нет закрытых планов.', counting: 'Считаем закрытые планы…', countFailed: 'Не удалось посчитать планы. Повторите попытку.',
  matching: n => `Подходящих закрытых планов: ${formatCount(n, 'ru')}.`,
  limited: (n, matching) => `Первые ${formatCount(n, 'ru')} ${matching ? 'подходящих ' : ''}закрытых планов; есть ещё.`,
  unchecked: (n, matching) => `Найдено ${matching ? 'подходящих ' : ''}закрытых планов: ${formatCount(n, 'ru')}; остальные ещё не проверены.`,
  checkMore: 'Проверить ещё', stop: 'Остановить', details: 'Что удаляется',
  deleteMenu: 'Удалить навсегда…',
  deleteHeading: n => `Удалить ${formatCount(n, 'ru')} ${russianPlans(n)}? Это нельзя отменить.`,
  deleteConfirm: n => `Удалить ${formatCount(n, 'ru')} ${russianPlans(n)} навсегда`,
  cancel: 'Отмена', confirm: n => `Архивировать ${formatCount(n, 'ru')} ${russianPlans(n)}`, pending: 'Архивируем…', undo: 'Отменить', retry: 'Повторить', restoring: 'Восстанавливаем…',
  progress: (n, total, action) => `${action === 'archive' ? 'Архивируем' : action === 'restore' ? 'Восстанавливаем' : 'Удаляем'}: ${formatCount(n, 'ru')} из ${formatCount(total, 'ru')}.`,
  count: (n, total) => `${formatCount(n, 'ru')} из ${formatCount(total, 'ru')} закрытых планов.`,
  result: (n, total, action) => `${action === true || action === 'restore' ? 'Восстановлено' : action === 'delete' ? 'Удалено' : 'Архивировано'} ${formatCount(n, 'ru')} из ${formatCount(total, 'ru')}${n < total ? `; пропущено: ${formatCount(total - n, 'ru')}` : ''}.`,
};
const tidyZh: typeof tidyEn = {
  menu: '整理', heading: n => `此处有 ${formatCount(n, 'zh-CN')} 个已关闭的计划。`,
  empty: '此处没有已关闭的计划。', counting: '正在统计已关闭的计划…', countFailed: '无法统计计划，请重试。',
  matching: n => `${formatCount(n, 'zh-CN')} 个匹配的已关闭计划。`,
  limited: (n, matching) => `前 ${formatCount(n, 'zh-CN')} 个${matching ? '匹配的' : ''}已关闭的计划；还有更多。`,
  unchecked: (n, matching) => `找到 ${formatCount(n, 'zh-CN')} 个${matching ? '匹配的' : ''}已关闭的计划；更多计划尚未检查。`,
  checkMore: '检查更多', stop: '停止', details: '删除的内容',
  deleteMenu: '永久删除…',
  deleteHeading: n => `删除 ${formatCount(n, 'zh-CN')} 个计划？此操作无法撤销。`,
  deleteConfirm: n => `永久删除 ${formatCount(n, 'zh-CN')} 个计划`,
  cancel: '取消', confirm: n => `归档 ${formatCount(n, 'zh-CN')} 个计划`, pending: '正在归档…', undo: '撤销', retry: '重试', restoring: '正在恢复…',
  progress: (n, total, action) => `正在${action === 'archive' ? '归档' : action === 'restore' ? '恢复' : '删除'}：${formatCount(n, 'zh-CN')} / ${formatCount(total, 'zh-CN')}。`,
  count: (n, total) => `${formatCount(total, 'zh-CN')} 个已关闭计划中的 ${formatCount(n, 'zh-CN')} 个。`,
  result: (n, total, action) => `已${action === true || action === 'restore' ? '恢复' : action === 'delete' ? '删除' : '归档'} ${formatCount(n, 'zh-CN')} / ${formatCount(total, 'zh-CN')} 个计划${n < total ? `；跳过 ${formatCount(total - n, 'zh-CN')} 个` : ''}。`,
};
export function tidyCopy(locale = 'en') {
  const language = resolveLanguage('auto', locale);
  return language === 'ru' ? tidyRu : language === 'zh-CN' ? tidyZh : tidyEn;
}
