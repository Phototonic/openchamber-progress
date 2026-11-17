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
export interface CleanupState {
  target: CleanupTarget | null;
  pending: boolean;
  message: CleanupMessage | null;
  error: boolean;
  tidy?: TidyState;
}
export const initialCleanup = (): CleanupState => ({ target: null, pending: false, message: null, error: false });
export function cleanupTarget(plan: PlanView, storeId: string, context: string): CleanupTarget {
  return { key: plan.key, title: plan.title, lifecycle: plan.lifecycle, context, request: { storeId, source: plan.sourceId, plan: plan.id, rev: plan.revision, cleanupRev: plan.cleanup?.revision ?? 0, oid: crypto.randomUUID() } };
}
export function cleanupClosed(plan: PlanView) {
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

export const TIDY_LIMIT = 50;
export interface TidyConfirmation {
  context: string;
  targets: CleanupTarget[];
  total: number;
}
export interface TidyResult {
  action: 'archive' | 'restore';
  attempted: number;
  total: number;
  succeeded: CleanupTarget[];
  remaining: CleanupTarget[];
}
export interface TidyState {
  context: string;
  confirmation?: TidyConfirmation;
  result?: TidyResult;
}
export function tidyEligible(plan: PlanView) {
  return (plan.lifecycle === 'completed' || plan.lifecycle === 'cancelled') && cleanupEligible('archive', plan);
}
/** Only the surface's already listed plans, never a wider library or search. */
export function tidyConfirmation(plans: PlanView[], storeId: string, context: string): TidyConfirmation {
  const eligible = plans.filter(tidyEligible);
  return { context, total: eligible.length, targets: eligible.slice(0, TIDY_LIMIT).map(p => cleanupTarget(p, storeId, context)) };
}
/** No delete path, no blind retries, and a context check before every request. */
export async function runTidy(host: ServiceHost, action: 'archive' | 'restore', targets: CleanupTarget[], current: () => boolean): Promise<TidyResult> {
  const succeeded: CleanupTarget[] = [];
  let attempted = 0;
  for (const target of targets.slice(0, TIDY_LIMIT)) {
    if (!current()) break;
    attempted++;
    const result = await cleanupCall(host, action, target.request);
    if (result.ok) succeeded.push({
      ...target,
      request: { ...target.request, cleanupRev: result.cleanup.revision, oid: crypto.randomUUID() },
    });
  }
  const keys = new Set(succeeded.map(t => t.key));
  return { action, attempted, total: targets.length, succeeded, remaining: targets.filter(t => !keys.has(t.key)) };
}

const tidyEn = {
  menu: 'Archive closed plans…',
  heading: (n: number) => `Archive ${plural(n, 'closed plan', 'closed plans')}?`,
  failed: 'Failed plans are kept. You can archive them one at a time.',
  effect: 'You can restore them at any time; their status and history stay unchanged.',
  cancel: 'Cancel', confirm: (n: number) => `Archive ${plural(n, 'plan', 'plans')}`, pending: 'Archiving…', undo: 'Undo', retry: 'Try again', restoring: 'Restoring…',
  count: (n: number, total: number) => `They move to Archived plans on the board${n < total ? `; this batch includes ${n} of ${total} closed plans` : ''}.`,
  result: (n: number, total: number, restore: boolean) => `${n < total ? `${n} of ${total} plans` : plural(n, 'plan', 'plans')} ${restore ? 'restored' : 'archived'}.${n < total ? ` ${total - n} could not be confirmed; check the plans before trying again.` : ''}`,
};
const russianPlans = (n: number, closed = false) => {
  const form = new Intl.PluralRules('ru').select(n);
  return closed ? form === 'one' ? 'закрытый план' : form === 'few' ? 'закрытых плана' : 'закрытых планов'
    : form === 'one' ? 'план' : form === 'few' ? 'плана' : 'планов';
};
const tidyRu: typeof tidyEn = {
  menu: 'Архивировать закрытые планы…',
  heading: n => `Архивировать ${formatCount(n, 'ru')} ${russianPlans(n, true)}?`,
  failed: 'Планы с ошибкой останутся. Их можно архивировать по одному.',
  effect: 'Их можно восстановить в любое время; статус и история не изменятся.',
  cancel: 'Отмена', confirm: n => `Архивировать ${formatCount(n, 'ru')} ${russianPlans(n)}`, pending: 'Архивируем…', undo: 'Отменить', retry: 'Повторить', restoring: 'Восстанавливаем…',
  count: (n, total) => `Они переместятся в архивные планы на доске${n < total ? `; в этой группе ${formatCount(n, 'ru')} из ${formatCount(total, 'ru')} закрытых планов` : ''}.`,
  result: (n, total, restore) => `${restore ? 'Восстановлено' : 'Архивировано'} ${n < total ? `${formatCount(n, 'ru')} из ${formatCount(total, 'ru')} планов` : `${formatCount(n, 'ru')} ${russianPlans(n)}`}.${n < total ? ` Не удалось подтвердить результат для ${formatCount(total - n, 'ru')}; проверьте планы перед повторной попыткой.` : ''}`,
};
const tidyZh: typeof tidyEn = {
  menu: '归档已关闭的计划…', heading: n => `归档 ${formatCount(n, 'zh-CN')} 个已关闭的计划？`,
  failed: '失败的计划会保留，可逐个归档。',
  effect: '你可以随时恢复，计划状态和历史记录保持不变。',
  cancel: '取消', confirm: n => `归档 ${formatCount(n, 'zh-CN')} 个计划`, pending: '正在归档…', undo: '撤销', retry: '重试', restoring: '正在恢复…',
  count: (n, total) => `它们将移至看板上的已归档计划${n < total ? `，本批处理 ${formatCount(total, 'zh-CN')} 个已关闭计划中的 ${formatCount(n, 'zh-CN')} 个` : ''}。`,
  result: (n, total, restore) => `已${restore ? '恢复' : '归档'} ${n < total ? `${formatCount(total, 'zh-CN')} 个计划中的 ${formatCount(n, 'zh-CN')} 个` : `${formatCount(n, 'zh-CN')} 个计划`}。${n < total ? `有 ${formatCount(total - n, 'zh-CN')} 个计划的操作结果无法确认，请检查后再试。` : ''}`,
};
export function tidyCopy(locale = 'en') {
  const language = resolveLanguage('auto', locale);
  return language === 'ru' ? tidyRu : language === 'zh-CN' ? tidyZh : tidyEn;
}
