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
  /** Placement facts of the counted plan, so a view can check it is still in scope when the request is sent. */
  where?: { owner: string; directory: string };
}
export type CleanupPlan = Pick<PlanView, 'key' | 'title' | 'lifecycle' | 'sourceId' | 'id' | 'revision' | 'cleanup'> & Partial<Pick<PlanView, 'ownerSessionId' | 'directory'>>;
export interface CleanupState {
  target: CleanupTarget | null;
  pending: boolean;
  message: CleanupMessage | null;
  error: boolean;
  tidy?: TidyState;
}
export const initialCleanup = (): CleanupState => ({ target: null, pending: false, message: null, error: false });
export function cleanupTarget(plan: CleanupPlan, storeId: string, context: string): CleanupTarget {
  return { key: plan.key, title: plan.title, lifecycle: plan.lifecycle, context,
    ...(plan.ownerSessionId !== undefined && plan.directory !== undefined ? { where: { owner: plan.ownerSessionId, directory: plan.directory } } : {}), request: { storeId, source: plan.sourceId, plan: plan.id, rev: plan.revision, cleanupRev: plan.cleanup?.revision ?? 0, oid: crypto.randomUUID() } };
}
export function cleanupClosed(plan: Pick<PlanView, 'lifecycle'>) {
  return ['completed', 'cancelled', 'failed'].includes(plan.lifecycle);
}
export function cleanupMatches(target: CleanupTarget, plan: PlanView | null, storeId: string | undefined, context: string) {
  return !!plan && (cleanupClosed(plan) || plan.cleanup?.state === 'archived') && target.context === context && target.request.storeId === storeId && target.key === plan.key && target.request.rev === plan.revision && target.request.cleanupRev === (plan.cleanup?.revision ?? 0);
}
export function cleanupEligible(action: CleanupAction, plan: PlanView) {
  return (cleanupClosed(plan) || plan.cleanup?.state === 'archived') && (action === 'delete' || (action === 'restore') === (plan.cleanup?.state === 'archived'));
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
/** Network round trips per explicit action, even when search continues one task-heavy plan. */
export const TIDY_SCAN_WINDOWS = 40;
export interface TidyConfirmation {
  selection?: CleanupAction;
  activeCount?: number;
  excludedActive?: number;
  context: string;
  targets: CleanupTarget[];
  total: number;
  archived?: boolean;
  matching?: boolean;
  limited?: boolean;
  unchecked?: boolean;
  /** Every page was read, but offsets between pages are not a snapshot: other plans may have been missed. */
  unverified?: boolean;
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
  selectionRequest?: SelectionRequest;
  selection?: CleanupAction;
  /** The remaining plans a Try again is recounting, kept so a failed recount retries the same set. */
  recount?: CleanupTarget[];
  opener?: string;
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
  /** The page followed an offset boundary whose stability cannot be proven. */
  unverified?: boolean;
}
/** A panel-local traversal. It never mutates the ordinary list or its caches. */
export class CleanupScan {
  private cursor: string | null = null;
  private exhausted = false;
  private overflow = false;
  private qualified = false;
  private busy = false;
  private retired = false;
  private targets = new Map<string, CleanupTarget>();
  readonly context: string;
  private storeId: string;
  private archived: boolean;
  private read: (cursor: string | null, current: () => boolean) => Promise<CleanupScanPage>;
  private matching: boolean;
  private windowBound: number;
  private includes?: (plan: CleanupPlan) => boolean;
  private allowActive: boolean;
  private excludedActive = new Set<string>();
  constructor(
    context: string,
    storeId: string,
    archived: boolean,
    read: (cursor: string | null, current: () => boolean) => Promise<CleanupScanPage>,
    matching = false,
    /** Search windows visit at most 64 plans; reserve that before issuing one. */
    windowBound = 50,
    includes?: (plan: CleanupPlan) => boolean,
    allowActive = true,
  ) {
    this.context = context; this.storeId = storeId; this.archived = archived;
    this.read = read; this.matching = matching; this.windowBound = windowBound;
    this.includes = includes;
    this.allowActive = allowActive;
  }
  cancel() { this.retired = true; }
  async more(current: () => boolean): Promise<TidyConfirmation | null> {
    if (this.busy || this.retired || !current()) return null;
    this.busy = true;
    const active = () => !this.retired && current();
    let visited = 0, windows = 0;
    try {
      // A full set keeps scanning until one more match proves overflow, so "more match" is never a guess.
      while (!this.exhausted && !this.overflow && visited + this.windowBound <= TIDY_SCAN_LIMIT && windows < TIDY_SCAN_WINDOWS) {
        if (!active()) return null;
        windows++;
        const page = await this.read(this.cursor, active);
        if (!active()) return null;
        if (!Number.isSafeInteger(page.visited) || page.visited < 1 || page.visited > this.windowBound ||
          (page.nextCursor !== null && page.nextCursor === this.cursor)) throw new Error('Invalid cleanup scan continuation.');
        visited += page.visited;
        if (page.unverified) this.qualified = true;
        for (const p of page.plans) {
          // A plan met again (an overlap anchor) replaces its target when it changed, and is otherwise kept as is.
          const had = this.targets.get(p.key);
          if (had && (had.request.rev !== p.revision || had.request.cleanupRev !== (p.cleanup?.revision ?? 0))) this.targets.delete(p.key);
          if (!(this.includes ? (p.cleanup?.state === 'archived') === this.archived && this.includes(p) : tidyEligible(p, this.archived))) continue;
          if (this.targets.has(p.key) || this.excludedActive.has(p.key)) continue;
          if (!this.allowActive && !cleanupClosed(p)) { this.excludedActive.add(p.key); continue; }
          if (this.targets.size >= TIDY_LIMIT) { this.overflow = true; break; }
          this.targets.set(p.key, cleanupTarget(p, this.storeId, this.context));
        }
        this.cursor = page.nextCursor;
        this.exhausted = this.cursor === null;
      }
      return { context: this.context, targets: [...this.targets.values()], total: this.targets.size,
        ...(this.excludedActive.size ? { excludedActive: this.excludedActive.size } : {}),
        archived: this.archived, matching: this.matching,
        limited: this.overflow, unchecked: !this.overflow && !this.exhausted,
        ...(!this.overflow && this.exhausted && this.qualified ? { unverified: true } : {}) };
    } finally { this.busy = false; }
  }
}
/** Frame-local rule, never persisted. Reconcile only when the reading/list changes, not per paint. */
export class PlanSelection {
  mode = false;
  all = false;
  version = 0;
  private reading = '';
  private known = new Map<string, CleanupPlan>();
  private chosen = new Set<string>();
  private omitted = new Set<string>();
  /** Plans a cleanup receipt took out of scope: not a user choice, so a plan back in scope is selected again. */
  private departed = new Set<string>();
  private partial = false;
  private plans: CleanupPlan[] | null = null;
  private fresh = true;
  private selectedCount = 0;
  private recount() {
    this.selectedCount = this.all ? this.known.size - [...this.omitted].filter(k => this.known.has(k)).length : this.chosen.size;
  }
  /** `fresh`: the plans are verified membership (a list read, a checked search page), not a cached page. */
  reconcile(reading: string, plans: CleanupPlan[], incomplete: boolean, fresh = true) {
    if (reading !== this.reading) {
      this.clear(); this.mode = false; this.known.clear(); this.plans = null; this.reading = reading;
    }
    if (this.plans === plans && this.partial === incomplete && this.fresh === fresh) return;
    this.plans = plans; this.partial = incomplete; this.fresh = fresh;
    if (!incomplete) {
      const keys = new Set(plans.map(p => p.key));
      for (const key of this.chosen) if (!keys.has(key)) this.chosen.delete(key);
      this.known.clear();
    }
    for (const p of plans) { this.known.set(p.key, p); if (fresh) this.departed.delete(p.key); }
    this.recount();
    this.version++;
  }
  has(key: string) { return this.all ? !this.omitted.has(key) && !this.departed.has(key) : this.chosen.has(key); }
  get count() { return this.selectedCount; }
  get incomplete() { return this.all && this.partial; }
  clear() { this.all = false; this.chosen.clear(); this.omitted.clear(); this.departed.clear(); this.selectedCount = 0; this.version++; }
  selectAll() { this.all = true; this.chosen.clear(); this.omitted.clear(); this.departed.clear(); this.selectedCount = this.known.size; this.version++; }
  toggle(p: CleanupPlan) {
    this.known.set(p.key, p);
    // An unpressed departed row is chosen by a click, not recorded as an exclusion.
    if (this.all && this.departed.delete(p.key)) { this.recount(); this.version++; return; }
    const set = this.all ? this.omitted : this.chosen;
    if (set.has(p.key)) set.delete(p.key); else set.add(p.key);
    this.recount();
    this.version++;
  }
  forget(keys: string[]) {
    if (!keys.length) return;
    for (const key of keys) {
      this.known.delete(key); this.chosen.delete(key);
      // A Select all rule must not keep a departed plan pressed or target it in a later scan.
      if (this.all) this.departed.add(key);
    }
    this.recount();
    this.version++;
  }
  /** A receipt put these plans back in view (Undo): they belong to a Select all rule again; exclusions stay. */
  returned(keys: Iterable<string>) {
    let any = false;
    for (const key of keys) if (this.departed.delete(key)) any = true;
    if (any) { this.recount(); this.version++; }
  }
  snapshot(): SelectionRequest {
    const all = this.all, chosen = new Set(this.chosen), omitted = new Set([...this.omitted, ...this.departed]);
    return { all, plans: [...this.known.values()].filter(p => this.has(p.key)),
      includes: p => all ? !omitted.has(p.key) : chosen.has(p.key) };
  }
}
export interface SelectionRequest {
  scope?: string;
  all: boolean;
  plans: CleanupPlan[];
  includes: (plan: CleanupPlan) => boolean;
}
export function selectionTargets(c: TidyConfirmation, action: CleanupAction, active: boolean): TidyConfirmation {
  const activeTargets = c.targets.filter(p => !cleanupClosed(p)).length;
  const activeCount = (c.excludedActive ?? 0) + activeTargets;
  const exclude = action !== 'restore' && !active;
  const excludedActive = (c.excludedActive ?? 0) + (exclude ? activeTargets : 0);
  const targets = exclude ? c.targets.filter(cleanupClosed) : c.targets;
  return { ...c, selection: action, activeCount, excludedActive, targets, total: targets.length, deleting: action === 'delete' };
}
export function selectionConfirmation(plans: CleanupPlan[], storeId: string, context: string, archived: boolean, action: CleanupAction, active: boolean) {
  const matching = plans.filter(p => (p.cleanup?.state === 'archived') === archived);
  const exclude = action !== 'restore' && !active;
  const eligible = exclude ? matching.filter(cleanupClosed) : matching;
  return selectionTargets({ context, archived, targets: eligible.slice(0, TIDY_LIMIT).map(p => cleanupTarget(p, storeId, context)),
    excludedActive: matching.length - eligible.length,
    total: Math.min(eligible.length, TIDY_LIMIT), limited: eligible.length > TIDY_LIMIT }, action, active);
}
/** Shared sequential engine: receipt-bound results, no retries, context/Stop checked before each request.
 * Selection explicitly opts into active targets; Tidy never does. `admit` is asked right before each
 * request: a target it refuses is skipped (counted as remaining), never sent. */
export async function runTidy(host: ServiceHost, action: CleanupAction, targets: CleanupTarget[], current: () => boolean,
  progress?: (done: number, total: number, confirmed?: CleanupTarget) => void, allowActive = false, admit?: (target: CleanupTarget) => boolean): Promise<TidyResult> {
  const succeeded: CleanupTarget[] = [];
  let attempted = 0;
  for (const target of targets.slice(0, TIDY_LIMIT)) {
    if (!current()) break;
    if (!cleanupClosed(target) && !allowActive) continue;
    if (admit && !admit(target)) continue;
    attempted++;
    const { active: _active, ...request } = target.request;
    const result = await cleanupCall(host, action, { ...request,
      ...(!cleanupClosed(target) && allowActive && action !== 'restore' ? { active: true as const } : {}) });
    if (result.ok) succeeded.push({
      ...target,
      request: { ...target.request, cleanupRev: result.cleanup.revision, oid: crypto.randomUUID() },
    });
    // Receipt-dependent side effects belong to this validated target, even if context moved.
    progress?.(succeeded.length, targets.length, result.ok ? succeeded.at(-1) : undefined);
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

const selectionEn = {
  select: 'Select', done: 'Done', all: 'Select all', clear: 'Clear',
  archive: 'Archive', restore: 'Restore', counting: 'Counting selected plans…',
  count: (n: number, more: boolean) => !n && more ? 'Matching plans selected' : `${formatCount(n, 'en')}${more ? '+' : ''} selected`,
  confirm: (n: number, action: 'archive' | 'restore') => `${action === 'archive' ? 'Archive' : 'Restore'} ${plural(n, 'plan', 'plans')}`,
  deleteHeading: (n: number, active: number, excluded: boolean) => `Delete ${plural(n, 'plan', 'plans')}? ${active ? excluded ? `${plural(active, 'in-progress plan', 'in-progress plans')} left out; this cannot be undone.` : `${active} still in progress; this cannot be undone.` : 'This cannot be undone.'}`,
  scope: (n: number, limited?: boolean, unchecked?: boolean, active = 0, excluded = false) => `${limited ? 'First ' : ''}${plural(n, 'selected plan', 'selected plans')}${limited ? '; more remain' : unchecked ? '; more plans weren’t checked' : ''}${active ? excluded ? `; ${plural(active, 'in-progress plan', 'in-progress plans')} left out` : `; ${active} still in progress; updates stop until restored` : ''}.`,
};
const selectionRu: typeof selectionEn = {
  select: 'Выбрать', done: 'Готово', all: 'Выбрать все', clear: 'Снять выбор',
  archive: 'Архивировать', restore: 'Восстановить', counting: 'Считаем выбранные планы…',
  count: (n, more) => !n && more ? 'Выбраны подходящие планы' : `Выбрано: ${formatCount(n, 'ru')}${more ? '+' : ''}`,
  confirm: (n, action) => `${action === 'archive' ? 'Архивировать' : 'Восстановить'} ${formatCount(n, 'ru')} ${russianPlans(n)}`,
  deleteHeading: (n, active, excluded) => `Удалить ${formatCount(n, 'ru')} ${russianPlans(n)}? ${active ? excluded ? `Пропущено активных планов: ${formatCount(active, 'ru')}; это нельзя отменить.` : `Ещё в работе: ${formatCount(active, 'ru')}; это нельзя отменить.` : 'Это нельзя отменить.'}`,
  scope: (n, limited, unchecked, active = 0, excluded = false) => `Выбрано планов: ${formatCount(n, 'ru')}${limited ? '; есть ещё' : unchecked ? '; остальные ещё не проверены' : ''}${active ? excluded ? `; пропущено активных планов: ${formatCount(active, 'ru')}` : `; ещё в работе: ${formatCount(active, 'ru')}, обновления остановятся до восстановления` : ''}.`,
};
const selectionZh: typeof selectionEn = {
  select: '选择', done: '完成', all: '全选', clear: '清除选择',
  archive: '归档', restore: '恢复', counting: '正在统计所选计划…',
  count: (n, more) => !n && more ? '已选择匹配的计划' : `已选 ${formatCount(n, 'zh-CN')}${more ? '+' : ''} 个`,
  confirm: (n, action) => `${action === 'archive' ? '归档' : '恢复'} ${formatCount(n, 'zh-CN')} 个计划`,
  deleteHeading: (n, active, excluded) => `删除 ${formatCount(n, 'zh-CN')} 个计划？${active ? excluded ? `已跳过 ${formatCount(active, 'zh-CN')} 个进行中的计划；` : `${formatCount(active, 'zh-CN')} 个仍在进行中；` : ''}此操作无法撤销。`,
  scope: (n, limited, unchecked, active = 0, excluded = false) => `已选 ${formatCount(n, 'zh-CN')} 个计划${limited ? '；还有更多' : unchecked ? '；更多计划尚未检查' : ''}${active ? excluded ? `；已跳过 ${formatCount(active, 'zh-CN')} 个进行中的计划` : `；${formatCount(active, 'zh-CN')} 个仍在进行中，恢复前将停止接受更新` : ''}。`,
};
export function selectionCopy(locale = 'en') {
  const language = resolveLanguage('auto', locale);
  return language === 'ru' ? selectionRu : language === 'zh-CN' ? selectionZh : selectionEn;
}
