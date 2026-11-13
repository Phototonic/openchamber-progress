import { button, el, offerPlanActions, testid } from './components.ts';
import type { ViewContext } from './app.ts';
import type { PlanView } from './model.ts';
import { cleanupFeedback } from './cleanup.ts';
import { resolveLanguage } from './i18n.ts';

const en = {
  heading: 'Delete this plan permanently?',
  effect: 'Removes its stored tasks, history and copied document. The original file stays untouched. This cannot be undone.',
  privacy: 'A minimal replay guard remains. This is not secure erasure: the first-use recovery backup, SQLite files and other backups may retain content.',
  cancel: 'Cancel', deleting: 'Deleting…', delete: 'Delete permanently', deleteMenu: 'Delete permanently…',
  restorePlan: 'Restore plan', archivePlan: 'Archive plan', restore: 'Restore', archive: 'Archive',
  archived: 'Archived · restoring keeps this plan finished and preserves its history.',
  help: 'Archive hides this finished plan. Find and restore it in Archived plans on the full page.',
};
const ru: typeof en = {
  heading: 'Удалить этот план навсегда?',
  effect: 'Будут удалены сохранённые задачи, история и копия документа. Исходный файл не изменится. Это действие нельзя отменить.',
  privacy: 'Минимальная защита от повторного выполнения остаётся. Это не гарантированное стирание: резервная копия восстановления при первом использовании, файлы SQLite и другие резервные копии могут сохранять содержимое.',
  cancel: 'Отмена', deleting: 'Удаление…', delete: 'Удалить навсегда', deleteMenu: 'Удалить навсегда…',
  restorePlan: 'Восстановить план', archivePlan: 'Архивировать план', restore: 'Восстановить', archive: 'Архивировать',
  archived: 'В архиве · восстановление сохраняет завершённое состояние плана и его историю.',
  help: 'Архивирование скрывает завершённый план. Найти и восстановить его можно в архиве планов на полной странице.',
};

/** An inline confirmation, not a modal. Cancel gets focus; Enter never defaults to delete. */
export function cleanupBlock<U>(vc: ViewContext<U>, plan: PlanView) {
  const text = resolveLanguage('auto', vc.env.locale) === 'ru' ? ru : en;
  const box = testid(el('section', 'ap-cleanup'), 'cleanup-actions');
  if (!vc.health?.planCleanup || plan.lifecycle !== 'completed') return box;
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
    // Secondary actions live in the plan's ⋯ (docs/ui.md Finished-plan cleanup). The ⋯ holder takes
    // the `cleanup-delete` hook, so a cancelled confirmation returns focus to the surviving opener.
    const inMenu = offerPlanActions(vc.reading, plan, [
      { id: archived ? 'cleanup-restore' : 'cleanup-archive', label: archived ? text.restorePlan : text.archivePlan, run, disabled },
      { id: 'cleanup-delete', label: text.deleteMenu, run: () => vc.requestDelete(plan), disabled, destructive: true },
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
  if (!vc.cleanup.message) return null;
  const box = testid(el('div', vc.cleanup.error ? 'ap-cleanup-error' : 'ap-note'), vc.cleanup.error ? 'cleanup-error' : 'cleanup-notice');
  box.tabIndex = -1;
  box.setAttribute('role', vc.cleanup.error ? 'alert' : 'status');
  box.textContent = cleanupFeedback(vc.cleanup.message, vc.env.locale);
  return box;
}
