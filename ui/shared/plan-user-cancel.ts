import type { UserCancelRequest } from '../../shared/user-cancel.ts';
import type { InterfaceLanguage } from './i18n.ts';
import type { HealthView, PlanView, StoreRead } from './model.ts';

export interface CancelPin {
  context: string;
  key: string;
  title: string;
  structuralRev: number;
  request: Omit<UserCancelRequest, 'oid' | 'confirmed'>;
}
interface Confirmation { pin: CancelPin; request: UserCancelRequest; pending: boolean }
export type CancelResult = 'success' | 'changed' | 'ineligible' | 'disabled' | 'refused' | 'uncertain';

const identity = (pin: CancelPin) => JSON.stringify([pin.context, pin.key, pin.structuralRev, pin.request]);

interface CancelDeps {
  pin: () => CancelPin | null;
  send: (r: UserCancelRequest, structuralRev: number) => Promise<CancelResult>;
  changed: (focus?: 'keep' | 'more') => void;
  settled: (r: CancelResult, pin: CancelPin) => void;
  operation: () => string;
  refreshSerial: () => number;
}

export function cancelPin(context: string, health: HealthView | null, read: StoreRead | null, plan: PlanView | null): CancelPin | null {
  if (health?.ready !== true || health.planUserCancel !== 1 || !read?.captureEnabled ||
      !read.binding.verified || !plan || plan.sourceId !== read.binding.sourceId ||
      !read.sources.some(s => s.id === plan.sourceId && s.verified) ||
      plan.lifecycle !== 'active' || plan.cleanup?.state === 'archived' || plan.revision >= Number.MAX_SAFE_INTEGER) return null;
  return {
    context, key: plan.key, title: plan.title, structuralRev: plan.structuralRevision,
    request: { storeId: read.storeId, binding: { ...read.binding }, source: plan.sourceId, plan: plan.id, rev: plan.revision, cleanupRev: plan.cleanup?.revision ?? 0 },
  };
}

/** Confirmation and receipt lifetime; the service, not this UI guard, decides authority. */
export class PlanUserCancel {
  private visit: Confirmation | null = null;
  private dispatched = false;
  private refreshRequired: { key: string; serial: number } | null = null;
  private deps: CancelDeps;
  constructor(deps: CancelDeps) { this.deps = deps; }
  private current(pin: CancelPin) {
    const current = this.deps.pin();
    return current !== null && identity(current) === identity(pin);
  }
  /** Never let an old closure become usable again after navigating away and back. */
  sync() {
    if (this.visit && !this.current(this.visit.pin)) this.retire();
  }
  afterRefresh() {
    this.sync();
    if (!this.refreshRequired || this.deps.refreshSerial() <= this.refreshRequired.serial) return false;
    this.refreshRequired = null;
    return true;
  }
  retire() {
    if (!this.visit) return;
    this.visit = null;
    this.deps.changed();
  }
  view(pin: CancelPin) {
    const canOpen = () => !this.dispatched && this.current(pin) &&
      !(identity(pin) === this.refreshRequired?.key && this.deps.refreshSerial() <= this.refreshRequired.serial);
    const eligible = canOpen();
    const v = this.visit;
    const confirmation = v && identity(v.pin) === identity(pin) && this.current(pin) ? {
      title: v.pin.title, pending: v.pending,
      keep: () => {
        if (this.visit !== v || v.pending) return;
        const current = this.current(v.pin);
        this.visit = null;
        this.deps.changed(current ? 'more' : undefined);
      },
      confirm: () => this.confirm(v),
    } : null;
    return { eligible, confirmation, open: () => {
      if (this.visit || !canOpen()) return;
      this.visit = { pin, request: { ...pin.request, oid: this.deps.operation(), confirmed: true }, pending: false };
      this.deps.changed('keep');
    } };
  }
  private async confirm(v: Confirmation) {
    if (this.visit !== v || v.pending || this.dispatched) return;
    if (!this.current(v.pin)) { this.retire(); return; }
    v.pending = true;
    this.dispatched = true;
    this.deps.changed();
    let result: CancelResult;
    try { result = await this.deps.send(v.request, v.pin.structuralRev); }
    catch { result = 'uncertain'; }
    this.dispatched = false;
    if (this.visit !== v || !this.current(v.pin)) { if (this.visit === v) this.retire(); else this.deps.changed(); return; }
    this.visit = null;
    this.refreshRequired = result === 'success' ? null : { key: identity(v.pin), serial: this.deps.refreshSerial() };
    this.deps.changed('more');
    this.deps.settled(result, v.pin);
  }
}

const COPY = {
  en: {
    action: 'Finish as cancelled', heading: (title: string) => `Finish “${title}” as cancelled?`,
    explain: 'History and unfinished tasks will be kept. The coordinating agent can reopen this plan when you ask. This does not stop running agents.',
    keep: 'Keep plan active', pending: 'Finishing as cancelled…', history: 'Cancelled by user', success: 'Plan cancelled by user.',
    changed: 'This plan changed. Review it again before cancelling.', ineligible: 'This plan can’t be cancelled here. Refresh to see its current state.',
    disabled: 'Recording is off. Turn it on before cancelling this plan.', refused: 'The plan was not cancelled. Try again after refreshing.',
    uncertain: 'Cancellation could not be confirmed. Refresh to check the plan before trying again.',
  },
  ru: {
    action: 'Завершить как отменённый', heading: (title: string) => `Отменить план «${title}»?`,
    explain: 'История и незавершённые задачи сохранятся. Координирующий агент сможет снова открыть план по вашей просьбе. Работающие агенты не остановятся.',
    keep: 'Оставить план активным', pending: 'Отмена плана…', history: 'Отменён пользователем', success: 'План отменён пользователем.',
    changed: 'План изменился. Проверьте его снова перед отменой.', ineligible: 'Здесь нельзя отменить этот план. Обновите страницу, чтобы увидеть его текущее состояние.',
    disabled: 'Запись выключена. Включите её перед отменой плана.', refused: 'План не отменён. Обновите страницу и попробуйте ещё раз.',
    uncertain: 'Не удалось подтвердить отмену. Обновите страницу и проверьте состояние плана, прежде чем повторять попытку.',
  },
  'zh-CN': {
    action: '取消并结束计划', heading: (title: string) => `将“${title}”标记为已取消并结束？`,
    explain: '将保留历史记录和未完成的任务。你可以请协调智能体重新打开此计划。这不会停止正在运行的智能体。',
    keep: '保持计划进行中', pending: '正在取消并结束计划…', history: '由用户取消', success: '计划已由用户取消。',
    changed: '此计划已更改。请重新查看后再取消。', ineligible: '无法在此处取消此计划。请刷新以查看当前状态。',
    disabled: '记录已关闭。请开启记录后再取消此计划。', refused: '计划未取消。请刷新后重试。',
    uncertain: '无法确认计划是否已取消。请刷新并检查计划状态后再试。',
  },
} as const;
export const cancelCopy = (locale: InterfaceLanguage) => COPY[locale];
