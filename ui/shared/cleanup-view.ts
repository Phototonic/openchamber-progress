import { button, el, offerPlanActions, testid } from './components.ts';
import type { ViewContext } from './app.ts';
import type { PlanView } from './model.ts';
import { cleanupClosed, cleanupFeedback, tidyCopy, selectionCopy, type PlanSelection, type TidyState } from './cleanup.ts';
import { resolveLanguage } from './i18n.ts';

const en = {
  heading: 'Delete this plan permanently?',
  effect: 'Removes its stored tasks, history and copied document. The original file stays untouched. This cannot be undone.',
  privacy: 'A minimal replay guard remains. This is not secure erasure: the first-use recovery backup, SQLite files and other backups may retain content.',
  cancel: 'Cancel', deleting: 'Deleting…', delete: 'Delete permanently', deleteMenu: 'Delete permanently…',
  restorePlan: 'Restore plan', archivePlan: 'Archive plan', restore: 'Restore', archive: 'Archive',
  archived: 'Archived · restoring preserves its status and history.',
  help: 'Archive hides this closed plan. Find and restore it in Archived plans on the full page.',
};
const ru: typeof en = {
  heading: 'Удалить этот план навсегда?',
  effect: 'Будут удалены сохранённые задачи, история и копия документа. Исходный файл не изменится. Это действие нельзя отменить.',
  privacy: 'Минимальная защита от повторного выполнения остаётся. Это не гарантированное стирание: резервная копия восстановления при первом использовании, файлы SQLite и другие резервные копии могут сохранять содержимое.',
  cancel: 'Отмена', deleting: 'Удаление…', delete: 'Удалить навсегда', deleteMenu: 'Удалить навсегда…',
  restorePlan: 'Восстановить план', archivePlan: 'Архивировать план', restore: 'Восстановить', archive: 'Архивировать',
  archived: 'В архиве · восстановление сохраняет статус и историю.',
  help: 'Архивирование скрывает закрытый план. Найти и восстановить его можно в архиве планов на полной странице.',
};
const zh: typeof en = {
  heading: '永久删除此计划？',
  effect: '将移除存储中的任务、历史和文档副本。原始文件保持不变，此操作无法撤销。',
  privacy: '仍会保留最小的重放防护记录。这不是安全擦除：首次使用的恢复备份、SQLite 文件及其他备份可能仍保留内容。',
  cancel: '取消', deleting: '正在删除…', delete: '永久删除', deleteMenu: '永久删除…',
  restorePlan: '恢复计划', archivePlan: '归档计划', restore: '恢复', archive: '归档',
  archived: '已归档 · 恢复后状态和历史记录不变。',
  help: '归档会隐藏此已结束的计划，可在全屏页面的“已归档计划”中查找并恢复。',
};

/** An inline confirmation, not a modal. Cancel gets focus; Enter never defaults to delete. */
export function cleanupBlock<U>(vc: ViewContext<U>, plan: PlanView) {
  const language = resolveLanguage('auto', vc.env.locale);
  const text = language === 'ru' ? ru : language === 'zh-CN' ? zh : en;
  const box = testid(el('section', 'ap-cleanup'), 'cleanup-actions');
  if (!vc.health?.planCleanup || !cleanupClosed(plan) && plan.cleanup?.state !== 'archived') return box;
  const state = vc.cleanup;
  const disabled = state.pending || !!vc.failure;
  if (state.target?.key === plan.key) {
    const confirm = testid(el('div', 'ap-cleanup-confirm'), 'cleanup-confirm');
    confirm.setAttribute('role', 'group');
    confirm.setAttribute('aria-labelledby', 'cleanup-heading');
    const heading = el('h3', '', text.heading); heading.id = 'cleanup-heading';
    confirm.append(heading, el('p', 'ap-cleanup-title', state.target.title), el('p', '', text.effect), el('p', 'ap-note', text.privacy));
    const actions = el('div', 'ap-row');
    button(actions, 'cleanup-cancel', text.cancel, vc.cancelCleanup, 'outline', state.pending);
    button(actions, 'cleanup-confirm-delete', state.pending ? text.deleting : text.delete, vc.confirmDelete, 'destructive', disabled);
    confirm.append(actions);
    confirm.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !state.pending) { event.preventDefault(); vc.cancelCleanup(); } });
    box.append(confirm);
    // The confirmation opens below the plan from ⋯ at its top; Cancel takes focus without
    // scrolling, so bring the confirmation into view once per opened confirmation.
    if (!shown.has(state.target)) {
      shown.add(state.target);
      requestAnimationFrame(() => { if (confirm.isConnected) confirm.scrollIntoView({ block: 'nearest' }); });
    }
  } else {
    const archived = plan.cleanup?.state === 'archived';
    const run = () => vc.runCleanup(archived ? 'restore' : 'archive', plan);
    // Secondary actions live in the plan's ⋯ (docs/ui.md Closed-plan cleanup). The ⋯ holder takes
    // the `cleanup-delete` hook, so a cancelled confirmation returns focus to the surviving opener.
    const inMenu = offerPlanActions(vc.reading, plan, [
      { id: archived ? 'cleanup-restore' : 'cleanup-archive', label: archived ? text.restorePlan : text.archivePlan, run, disabled },
      { id: 'cleanup-delete', label: text.deleteMenu, run: () => vc.requestDelete(plan), disabled: disabled || !cleanupClosed(plan) && vc.health.planCleanupActive !== 1, destructive: true },
    ], 'cleanup-delete');
    if (!inMenu) {
      // A view without the plan's ⋯ (Map, Document, History) keeps the visible buttons.
      const actions = el('div', 'ap-row ap-between');
      button(actions, archived ? 'cleanup-restore' : 'cleanup-archive', archived ? text.restore : text.archive, run, 'outline', disabled);
      button(actions, 'cleanup-delete', text.deleteMenu, () => vc.requestDelete(plan), 'ghost', disabled);
      box.append(actions);
    }
    // State, not explanation: an archived plan says so. What Archive does is in its own result notice.
    if (archived) box.append(el('p', 'ap-note', text.archived));
    else if (!inMenu) box.append(el('p', 'ap-note', text.help));
  }
  return box;
}

/** Confirmations already scrolled into view (the controller's target object, one per request). */
const shown = new WeakSet<object>();

export function cleanupNotice<U>(vc: ViewContext<U>) {
  const tidy = tidyBlock(vc);
  if (!vc.cleanup.message) return tidy;
  const box = testid(el('div', vc.cleanup.error ? 'ap-cleanup-error' : 'ap-note'), vc.cleanup.error ? 'cleanup-error' : 'cleanup-notice');
  box.tabIndex = -1;
  box.setAttribute('role', vc.cleanup.error ? 'alert' : 'status');
  box.textContent = cleanupFeedback(vc.cleanup.message, vc.env.locale);
  const wrapper = el('div'); wrapper.append(tidy, box); return wrapper;
}

// Keep the polite live region across root replacement. Only new result text mutates it,
// so ordinary paints do not re-announce the same action.
let tidyLive: HTMLElement | null = null;
export interface TidyControls {
  cancel: () => void;
  archive: () => void;
  deleteStep?: () => void;
  delete?: () => void;
  more?: () => void;
  stop?: () => void;
  undo: () => void;
  retry: () => void;
}
function tidyBlock<U>(vc: ViewContext<U>) {
  return tidyPanel(vc.cleanup.tidy, vc.env.locale, {
    cancel: vc.cancelTidy, archive: vc.confirmTidy, undo: vc.undoTidy, retry: vc.retryTidy,
    deleteStep: vc.deleteTidy, delete: vc.confirmTidyDelete, more: vc.moreTidy, stop: vc.stopTidy,
  }, vc.cleanup.pending || !!vc.failure || vc.health?.planCleanup !== 1);
}
/** Panel rendering is independent of the board's controller and paint path. */
export function tidyPanel(state: TidyState | undefined, locale: string, controls: TidyControls, disabled = false) {
  const box = testid(el('section', 'ap-cleanup'), 'tidy-actions');
  const text = tidyCopy(locale);
  const selection = selectionCopy(locale);
  const language = resolveLanguage('auto', locale);
  const deletion = language === 'ru' ? ru : language === 'zh-CN' ? zh : en;
  box.addEventListener('keydown', event => {
    if (event.key === 'Escape' && (state?.counting || state?.countFailed)) { event.preventDefault(); controls.cancel(); }
  });
  tidyLive ??= testid(el('p', 'ap-note'), 'tidy-result');
  tidyLive.setAttribute('role', 'status');
  tidyLive.setAttribute('aria-atomic', 'true');
  const result = state?.result;
  // Progress is visible but not live: only start/result are announced, never each plan.
  const message = state?.progress ? text.progress(0, state.progress.total, state.progress.action)
    : result ? text.result(result.succeeded.length, result.total, result.action) : '';
  if (tidyLive.textContent !== message) tidyLive.textContent = message;
  tidyLive.className = state?.progress ? 'ap-sr' : 'ap-note';
  box.append(tidyLive);
  if (state?.progress) {
    box.append(testid(el('p', '', text.progress(state.progress.done, state.progress.total, state.progress.action)), 'tidy-progress'));
    if (controls.stop) button(box, 'tidy-stop', text.stop, controls.stop, 'outline');
  } else if (state?.counting) {
    box.append(testid(el('p', '', state.selection ? selection.counting : text.counting), 'tidy-counting'));
    button(box, 'tidy-cancel', text.cancel, controls.cancel, 'outline');
  } else if (state?.countFailed) {
    box.append(el('p', '', text.countFailed));
    button(box, 'tidy-cancel', text.cancel, controls.cancel, 'outline');
    button(box, 'tidy-retry', text.retry, controls.retry, 'outline', disabled);
  } else if (state?.confirmation) {
    const c = state.confirmation;
    const confirm = testid(el('div', 'ap-cleanup-confirm'), 'tidy-confirm');
    confirm.setAttribute('role', 'group'); confirm.setAttribute('aria-labelledby', 'tidy-heading');
    const line = c.selection ? c.deleting ? selection.deleteHeading(c.targets.length, c.activeCount ?? 0, !!c.excludedActive)
      : selection.scope(c.targets.length, c.limited, c.unchecked, c.selection === 'restore' ? 0 : c.activeCount, !!c.excludedActive)
      : c.deleting ? text.deleteHeading(c.targets.length)
      : c.limited ? text.limited(c.targets.length, c.matching) : c.unchecked ? text.unchecked(c.targets.length, c.matching)
      : !c.targets.length ? text.empty : c.matching ? text.matching(c.targets.length) : text.heading(c.targets.length);
    const heading = el('p', '', line); heading.id = 'tidy-heading';
    confirm.append(heading);
    if (c.deleting) {
      const details = el('details');
      details.append(el('summary', '', text.details), el('p', '', deletion.effect), el('p', 'ap-note', deletion.privacy));
      confirm.append(details);
    }
    const actions = el('div', 'ap-row');
    button(actions, 'tidy-cancel', text.cancel, controls.cancel, 'outline');
    if (c.targets.length) {
      if (c.deleting) {
        if (controls.delete) button(actions, 'tidy-confirm-delete', text.deleteConfirm(c.targets.length), controls.delete, 'destructive', disabled);
      } else {
        if (c.selection || !c.archived) button(actions, 'tidy-confirm-archive', c.selection ? selection.confirm(c.targets.length, c.selection === 'restore' ? 'restore' : 'archive') : text.confirm(c.targets.length), controls.archive, 'outline', disabled);
        if (!c.selection && controls.deleteStep) button(actions, 'tidy-delete', text.deleteMenu, controls.deleteStep, 'outline', disabled);
      }
    }
    if (c.unchecked && (!c.deleting || c.selection) && controls.more) button(actions, 'tidy-check-more', text.checkMore, controls.more, 'outline', disabled);
    confirm.append(actions);
    confirm.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); controls.cancel(); }
      // Native buttons still activate when explicitly focused; no default form action.
      if (event.key === 'Enter' && event.target === confirm) event.preventDefault();
    });
    box.append(confirm);
    if (!shown.has(c)) {
      shown.add(c);
      requestAnimationFrame(() => { if (confirm.isConnected) confirm.scrollIntoView({ block: 'nearest' }); });
    }
  } else if (result) {
    const actions = el('div', 'ap-row');
    if (result.action === 'archive' && result.succeeded.length) button(actions, 'tidy-undo', text.undo, controls.undo, 'outline', disabled);
    if (result.succeeded.length < result.total) button(actions, 'tidy-retry', text.retry, result.action === 'restore' && state.selection !== 'restore' ? controls.undo : controls.retry, 'outline', disabled);
    box.append(actions);
  }
  return box;
}

let selectionLive: HTMLElement | null = null;
/** The count region survives paint; changing a row mutates its text just once. */
export function selectionBar(selection: PlanSelection, locale: string, archived: boolean, changed: () => void,
  action: (action: 'archive' | 'restore' | 'delete') => void, disabled = false) {
  const text = selectionCopy(locale), tidy = tidyCopy(locale);
  const bar = testid(el('div', 'ap-row ap-selection-bar'), 'selection-bar');
  button(bar, 'selection-mode', selection.mode ? text.done : text.select, () => {
    selection.clear(); selection.mode = !selection.mode; changed();
  }, 'outline', disabled);
  if (!selection.mode) return bar;
  button(bar, 'selection-all', text.all, () => { selection.selectAll(); changed(); }, 'outline', disabled);
  selectionLive ??= testid(el('span', 'ap-note'), 'selection-count');
  selectionLive.setAttribute('role', 'status'); selectionLive.setAttribute('aria-atomic', 'true');
  const count = text.count(selection.count, selection.incomplete);
  if (selectionLive.textContent !== count) selectionLive.textContent = count;
  bar.append(selectionLive);
  if (selection.count || selection.incomplete) {
    const primary = archived ? 'restore' : 'archive';
    button(bar, `selection-${primary}`, text[primary], () => action(primary), 'outline', disabled);
    button(bar, 'selection-delete', tidy.deleteMenu, () => action('delete'), 'outline', disabled);
    button(bar, 'selection-clear', text.clear, () => { selection.clear(); changed(); }, 'ghost', disabled);
  }
  return bar;
}
