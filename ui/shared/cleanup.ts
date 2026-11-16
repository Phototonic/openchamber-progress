import type { CleanupAction, CleanupRequest } from './adapter.ts';
import type { PlanView } from './model.ts';
import { resolveLanguage } from './i18n.ts';

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
  key: string; title: string; context: string; request: CleanupRequest;
}
export interface CleanupState {
  target: CleanupTarget | null;
  pending: boolean;
  message: CleanupMessage | null;
  error: boolean;
}
export const initialCleanup = (): CleanupState => ({ target: null, pending: false, message: null, error: false });
export function cleanupTarget(plan: PlanView, storeId: string, context: string): CleanupTarget {
  return { key: plan.key, title: plan.title, context, request: { storeId, source: plan.sourceId, plan: plan.id, rev: plan.revision, cleanupRev: plan.cleanup?.revision ?? 0, oid: crypto.randomUUID() } };
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
