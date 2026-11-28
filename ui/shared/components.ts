// DOM building blocks shared by the three surfaces. Every string lands through textContent.
import { mountBadge, mountBanner, mountButton, mountEmpty, mountSelect, mountSpinner, type MenuItem, type SelectOption, type Tone } from '@openchamber/sdk/ui';
import type { Loadable, ReadingView, SummaryView, ViewContext } from './app.ts';
import { languageMessages, resolveLanguage, type InterfaceLanguage } from './i18n.ts';
import { deriveDependencies } from './dependency-derivation.ts';
import { isMarkdownDocument, parseDocumentMarkdown, renderDocumentMarkdown } from './document-markdown.ts';
import { absoluteTime, baseName, clockTime, elapsedText, formatCount, relativeAge } from './format.ts';
import { canOpen, coverageFor, EMPTY_LIVE, liveLabel, sessionLabel, type Coverage, type LiveSnapshot } from './live.ts';
import { assignment, attention, blockedWait, reportsFor, type Attention, type InvalidReason, type Prerequisite, type ReadinessEntry } from './readiness.ts';
import {
  ALL_PARTICIPANTS, documentStateText, elapsedAt, jumpTargets, lifecycleLabel, nextJump, participantIndex, participants, relationsOf, showsLiveness, statusLabel, summarize, summaryText, taskProjection,
  type BlockerCategory, type DocumentBody, type HistoryEntry, type ItemNode, type ItemView, type JumpKind, type ParticipantFilter, type ParticipantIndex, type PlanActivityView, type PlanDetail, type PlanSummary, type PlanView, type ProgressState, type Relation, type StoreRead, type TaskProjection,
} from './model.ts';
import { icon, infoDisclosure, moreMenu, planActions, segmentedBar, stateChip, stateChips, statusMark, warningBadge, warningLine, type InfoHandle } from './primitives.ts';
import { CheckpointStore } from './change-digest-checkpoint.ts';
import { progressProjection, type ProgressProjection, type ProgressRow, type ProgressSection } from './progress-projection.ts';
import { placeOf } from './scope.ts';
import type { ReadFailure } from './source.ts';
import type { DeviceView, IntentRefusal } from './model.ts';
import { currentIntent, type CurrentIntent } from './intent.ts';
import { quietCopy, quietDays, quietLabel } from './quiet-plans.ts';
import type { MoreMenuItem } from './primitives.ts';
import { cancelCopy } from './plan-user-cancel.ts';
import type { DetailView } from './default-view.ts';

/** `applyDeviceHooks` (phone-layout.ts) applies these to the document element from the host's ready
 * device hints; CSS remains responsive without hints.
 * Content/map owners consume the same attributes/variables, never introduce another layout owner.
 */
export const PHONE_LAYOUT_HOOKS = Object.freeze({
  formFactor: 'data-device-form-factor', pointer: 'data-device-pointer',
  safeTop: '--ap-safe-top', safeRight: '--ap-safe-right', safeBottom: '--ap-safe-bottom',
  safeLeft: '--ap-safe-left', keyboard: '--ap-keyboard-height',
});
export const ATTENTION_HOOKS = Object.freeze({
  inbox: 'needs-you-inbox', count: 'needs-you-count', alsoBlocked: 'also-blocked', pending: 'delegation-pending', refused: 'delegation-refused',
});

// Keys are the existing English copy; only these fixed messages are translated, never user text.
const RUSSIAN = {
  'time unknown': 'время неизвестно', 'at least {time}': 'не менее {time}',
  'The progress service could not tell when this task was reported in progress.': 'Сервис прогресса не смог определить, когда задача была отмечена как выполняемая.',
  'Reported in progress at {at}': 'Отмечена как выполняемая: {at}',
  'Observed in progress by {at}; start unknown': 'Наблюдалась в работе к {at}; начало неизвестно',
  '{n} in progress': '{n} в работе', '{n} blocked': '{n} заблокировано',
  ' done, {n} remaining': ' выполнено, осталось: {n}',
  'from another OpenCode setup': 'из другой установки OpenCode', 'Open session': 'Открыть сессию',
  'OpenCode install not connected': 'Установка OpenCode не подключена',
  'Updated ': 'Обновлено ', 'From another OpenCode setup': 'Из другой установки OpenCode', 'Unverified OpenCode setup': 'Непроверенная установка OpenCode',
  '{n} plans': 'Планов: {n}', 'Plan {index} of {count}: {title}. Choose another plan': 'План {index} из {count}: {title}. Выбрать другой план',
  '{index} of {count}': '{index} из {count}', 'Plan ': 'План ',
  'Assigned to this session': 'Назначена этой сессии', 'Reported directly by this session': 'Отчёт напрямую от этой сессии',
  'Direct report attributed to this session': 'Прямой отчёт отнесён к этой сессии', 'Reported for this session': 'Отчёт за эту сессию',
  'Relayed by this session': 'Передан этой сессией', 'Recorded reporter · report mode unavailable': 'Записанный автор отчёта · режим отчёта недоступен',
  'Linked to this session · not an assignment': 'Связана с этой сессией · не назначение',
  'No participant recorded': 'Участник не записан', 'no participant recorded': 'участник не записан',
  'All participants': 'Все участники', 'main session · ': 'основная сессия · ', 'no longer recorded': 'больше не записана', 'Participant': 'Участник',
  'Jump to in progress': 'К задачам в работе', 'No tasks in progress': 'Нет задач в работе', 'In progress': 'В работе',
  'Jump to reported in progress': 'К отмеченным как выполняемые', 'No tasks reported in progress': 'Нет отмеченных как выполняемые задач', 'Reported in progress': 'По отчёту в работе',
  'Jump to blocked': 'К заблокированным', 'No blocked tasks': 'Нет заблокированных задач', 'Blocked': 'Заблокировано',
  'Jump to reported blocked': 'К отмеченным как заблокированные', 'No tasks reported blocked': 'Нет отмеченных как заблокированные задач', 'Reported blocked': 'По отчёту заблокировано',
  'Sessions': 'Сессии', 'Main session': 'Основная сессия', 'Child session': 'Дочерняя сессия', '{n} assigned': 'Назначено: {n}',
  'reports relayed by the main session': 'отчёты переданы основной сессией',
  'Loading {what}': 'Загрузка: {what}', '{what} could not be loaded. {failure}.': 'Не удалось загрузить: {what}. {failure}.', 'Try again': 'Попробовать снова',
  'Plan document': 'Документ плана', 'No earlier capture is available.': 'Предыдущего снимка нет.', 'the document': 'документ',
  'The captured text is not available.': 'Текст снимка недоступен.',
  'A newer capture was recorded while this loaded. This is the earlier capture.': 'Во время загрузки записан новый снимок. Здесь показан предыдущий.',
  'Captured ': 'Снимок сделан ', 'Last good capture ': 'Последний успешный снимок ',
  'This is the last successful capture, not the current file.': 'Это последний успешный снимок, а не текущий файл.',
  'The task list was confirmed against this capture. The current file has not been rechecked since.': 'Список задач сверен с этим снимком. Текущий файл с тех пор не проверялся.',
  'The current file has not been rechecked since this capture.': 'Текущий файл не проверялся с момента этого снимка.',
  'That task is no longer shown in this plan.': 'Эта задача больше не отображается в плане.',
  'Showing all tasks so this task is visible.': 'Показаны все задачи, чтобы была видна эта задача.',
  'Show prerequisite: {title}': 'Показать предпосылку: {title}', 'A group, not a task: it can’t count as done': 'Это группа, а не задача: её нельзя считать выполненной',
  'Prerequisite task unavailable': 'Задача-предпосылка недоступна',
  'Decision': 'Решение', 'Dependency': 'Зависимость', 'Review': 'Проверка', 'External': 'Внешнее', 'Other': 'Другое',
  'Wait category: ': 'Категория ожидания: ', 'Category unknown': 'Категория неизвестна', 'The report used a category this version doesn’t recognize.': 'В отчёте указана категория, неизвестная этой версии.',
  'Unknown': 'Неизвестно', 'Unavailable': 'Недоступно',
  'The progress service couldn’t tell when this task was reported blocked.': 'Сервис прогресса не смог определить, когда задача была отмечена как заблокированная.',
  'This progress service doesn’t report waiting times.': 'Этот сервис прогресса не сообщает время ожидания.',
  'Reported blocked at {at}. Counts reported status, not activity.': 'Отмечена как заблокированная: {at}. Учитывается записанный статус, а не активность.',
  'Already reported blocked at {at}; the start is earlier and unknown.': 'Уже была отмечена как заблокированная: {at}; начало раньше и неизвестно.',
  'No reported blockers.': 'Нет записанных блокировок.',
  'No reported blockers in the last successful read. This may be out of date.': 'В последнем успешном чтении блокировок нет. Данные могут быть устаревшими.',
  'No reported blockers were recorded. Capture is off, so newer reports aren’t recorded.': 'Блокировки не записаны. Сбор отключён, новые отчёты не записываются.',
  'two tasks share an ID': 'две задачи имеют один ID', 'a task lists itself as a prerequisite': 'задача указывает себя как предпосылку', 'some tasks list each other as prerequisites': 'задачи указывают друг друга как предпосылки',
  'Now': 'Сейчас', 'Reported working': 'По отчёту в работе', 'Up next': 'Далее', 'Pending': 'Ожидает', 'Done': 'Выполнено', 'Skipped': 'Пропущено',
  'in progress': 'в работе', 'blocked': 'заблокировано', 'ready': 'готово', 'waiting': 'ожидает предпосылок', 'pending': 'ожидает', 'done': 'выполнено', 'skipped': 'пропущено',
  'Ready to start': 'Готова к началу', 'Waiting on prerequisites': 'Ожидает предпосылок',
  'Filter tasks by state': 'Фильтр задач по состоянию', 'About these counts': 'Об этих количествах',
  'Counts cover every task in this plan, whatever filter is shown.': 'Количество учитывает все задачи плана независимо от фильтра.',
  'Ready and waiting come from recorded prerequisites only. Other prerequisites may not be recorded, and “No prerequisites recorded” doesn’t mean there are none. Ready is not permission to start.': 'Готовность и ожидание определяются только записанными предпосылками. Другие предпосылки могут быть не записаны; «Предпосылки не записаны» не означает их отсутствия. Готовность не является разрешением начать.',
  'Blocked lists every task reported as blocked. Each stays there until an agent reports otherwise; a wait can be for another session or person. Needs you shows only reported decision and review waits.': '«Заблокировано» показывает все задачи, отмеченные как заблокированные. Они остаются здесь до нового отчёта агента; ожидание может относиться к другой сессии или человеку. «Нужно ваше участие» показывает только ожидающие решения и проверки.',
  'Counts cover every task in this plan, whatever filter is shown. They are the statuses last reported; a closed plan, or one whose recorded prerequisites can’t be read, gets no ready or waiting advice.': 'Количество учитывает все задачи плана независимо от фильтра. Это последние записанные статусы; для закрытого плана или нечитаемых предпосылок советы о готовности и ожидании не даются.',
  'Readiness is unavailable for this report: {reason}. The tasks are shown as reported.': 'Готовность для этого отчёта недоступна: {reason}. Задачи показаны как записано.',
  'Last reported readiness. It may be out of date and isn’t a current recommendation.': 'Последняя записанная готовность. Она может быть устаревшей и не является текущей рекомендацией.',
  'Capture is off: these are the last reported blockers, not current guidance.': 'Сбор отключён: это последние записанные блокировки, а не текущие рекомендации.',
  'Some recorded prerequisites aren’t in this plan, so the tasks that need them can’t be shown as ready.': 'Некоторых записанных предпосылок нет в плане; зависящие от них задачи нельзя показать готовыми.',
  ' (no tasks have this state now)': ' (сейчас нет задач в этом состоянии)', 'Unfinished': 'Незавершённые', 'Participant {name}': 'Участник: {name}',
  '{filter}: {matching} of {tasks}': '{filter}: {matching} из {tasks}', '{tasks} kept in view': 'Оставлены на виду: {tasks}', '{n} shown for context': 'Для контекста: {n}',
  'Clear filters': 'Сбросить фильтры', 'Task filters cleared, so focus moved to Tasks.': 'Фильтры задач сброшены, фокус перенесён к задачам.',
  'No tasks match the filter. Blocked tasks stay listed below.': 'Нет задач по фильтру. Заблокированные задачи остаются ниже.', 'No tasks match the filter.': 'Нет задач по фильтру.',
  'This plan no longer records {name} on any task.': 'В плане больше нет задач с участником {name}.',
  'They are still in the plan, and the counts above cover every task.': 'Они остаются в плане, а количество выше учитывает все задачи.', 'Clear task filters': 'Сбросить фильтры задач',
  'Ready': 'Готова', 'Waits on {n}': 'Ожидает: {n}', 'Reported details couldn’t be read': 'Не удалось прочитать записанные сведения',
  'Status': 'Статус', 'Details': 'Подробности', 'Reason': 'Причина', 'Next step': 'Следующий шаг', 'Reported wait': 'Ожидание по отчёту',
  'Needs first': 'Сначала нужны', 'About prerequisites of {title}': 'О предпосылках задачи {title}',
  'Only prerequisites an agent recorded are listed. Others may not be recorded, so “No prerequisites recorded” doesn’t mean there are none.': 'Показаны только предпосылки, записанные агентом. Другие могут быть не записаны, поэтому «Предпосылки не записаны» не означает их отсутствия.',
  'A blocked task doesn’t mean anyone must act; it stays blocked until an agent reports otherwise.': 'Блокировка задачи не означает, что кто-то обязан действовать; она сохраняется до нового отчёта агента.',
  'No prerequisites recorded': 'Предпосылки не записаны', 'Prerequisites of {title}': 'Предпосылки задачи {title}', 'a group': 'группа', 'unavailable': 'недоступно',
  'A recorded prerequisite is unavailable, so this task can’t be shown as ready.': 'Записанная предпосылка недоступна, поэтому задачу нельзя показать готовой.',
  'Tasks {title} would unlock': 'Задачи, которые разблокирует {title}', 'Show task: {title}': 'Показать задачу: {title}',
  'Unlocks': 'Разблокирует', 'About what {title} unlocks': 'О том, что разблокирует {title}',
  'If this task is reported done, each task listed would have every recorded prerequisite done. From recorded prerequisites only; not permission to start.': 'Если эта задача будет отмечена выполненной, у каждой задачи в списке будут выполнены все записанные предпосылки. Только по записанным предпосылкам; это не разрешение начать.',
  'Group': 'Группа', 'Parent group unavailable': 'Родительская группа недоступна', 'Assignee': 'Исполнитель', 'Not recorded': 'Не записан',
  'Linked to ': 'Связана с ', ' · {state} (no recorded assignment)': ' · {state} (назначение не записано)',
  '; linked to {names} (no recorded assignment)': '; связана с {names} (назначение не записано)',
  'the selected session': 'выбранная сессия', 'The selected session': 'Выбранная сессия',
  'reported by {reporter} for {attributed}': 'передан сессией {reporter} за {attributed}', 'reported directly by {reporter}': 'напрямую от сессии {reporter}',
  'Details and task {report}': 'Сведения и задача: {report}', 'Details {report}': 'Сведения: {report}', 'Task {report}': 'Задача: {report}',
  'Last reported by {name} · report mode unavailable': 'Последний отчёт от {name} · режим отчёта недоступен', 'Reported': 'По отчёту',
  'Copy details…': 'Копировать сведения…', 'Review before sharing: this is the recorded text exactly as shown.': 'Проверьте перед отправкой: это записанный текст в точности как показано.',
  'Task details (read-only)': 'Сведения о задаче (только чтение)', 'Copied.': 'Скопировано.', 'Clipboard unavailable. Select and copy the text above.': 'Буфер обмена недоступен. Выделите и скопируйте текст выше.',
  'Copy': 'Копировать', 'Close': 'Закрыть', 'kept in view': 'оставлена на виду', 'shown for context': 'показана для контекста',
  'Last reported: ': 'По последнему отчёту: ', '{tasks} hidden by filters': 'Скрыты фильтрами: {tasks}', '{tasks} shown for context': 'Для контекста: {tasks}', '{tasks} folded': 'Свёрнуты: {tasks}',
  'Tasks': 'Задачи', 'This plan has no tasks yet.': 'В этом плане пока нет задач.', 'No task rows are recorded in this plan, only groups.': 'В плане записаны только группы, без задач.',
  'Tasks in {title}, in plan order': 'Задачи плана {title} в порядке плана',
  'Task view': 'Вид задач', 'Show tasks': 'Показать задачи', 'Show all': 'Показать все', 'Order': 'Порядок', 'By attention': 'По вниманию', 'Plan order': 'Порядок плана',
  'Expand all': 'Развернуть все', 'Collapse all': 'Свернуть все', 'Copy progress update…': 'Копировать сводку прогресса…', 'Copy handoff…': 'Копировать передачу работы…',
  'Task view options…': 'Параметры вида задач…', 'Show by attention': 'Показать по вниманию', 'Show in plan order': 'Показать в порядке плана', 'Expand all tasks': 'Развернуть все задачи', 'Collapse all tasks': 'Свернуть все задачи',
  'tasks': 'задачи', 'history': 'история', 'Plan summaries': 'Сводки плана', 'Progress update preview': 'Предпросмотр сводки прогресса', 'Handoff preview': 'Предпросмотр передачи работы',
  'Review the Markdown, then copy it.': 'Проверьте Markdown, затем скопируйте.', 'Markdown preview (read-only)': 'Предпросмотр Markdown (только чтение)',
  'Copy Markdown': 'Копировать Markdown', 'Retry': 'Повторить', 'Preview summary only': 'Только краткая сводка',
  'Revisions': 'Ревизии', 'plan reported': 'план записан', 'tasks revised': 'задачи изменены', 'outcome reported': 'результат записан', 'progress update': 'обновление прогресса',
  'Revision {n}': 'Ревизия {n}', 'Only the first {n} revisions are shown.': 'Показаны только первые {n} ревизий.',
  'Capture is turned off; no new reports are recorded.': 'Сбор отключён; новые отчёты не записываются.', 'Some recorded sources are not verified.': 'Некоторые записанные источники не проверены.',
  'This service is not bound to a verified OpenCode setup.': 'Этот сервис не привязан к проверенной установке OpenCode.', 'Showing an earlier document capture.': 'Показан предыдущий снимок документа.',
  'Plan': 'План', 'Revision': 'Ревизия', '{revision} (structure {structure})': '{revision} (структура {structure})', 'Last reported location': 'Последнее записанное расположение',
  'Plan source': 'Источник плана', 'Document source': 'Источник документа', 'Document state': 'Состояние документа', ', task list confirmed': ', список задач подтверждён',
  'Document capture': 'Снимок документа', 'Document checked': 'Документ проверен', 'Store': 'Хранилище', 'Bound source': 'Привязанный источник',
  ' (verified)': ' (проверен)', ' (not verified)': ' (не проверен)', 'None': 'Нет', 'Recorded source': 'Записанный источник', 'Capture': 'Сбор', 'On': 'Включён', 'Off': 'Выключен', 'Coverage': 'Охват',
  'Loading progress': 'Загрузка прогресса', 'Setup is needed': 'Нужна настройка', 'Progress loaded again': 'Прогресс снова загружен',
  'Showing progress from {time}': 'Показан прогресс на {time}', '{failure}. This may be out of date.': '{failure}. Данные могут быть устаревшими.', 'Last refresh error': 'Ошибка последнего обновления',
  'Next sub-agent will take this': 'Следующий субагент возьмёт эту задачу', 'Sub-agent handoff refused': 'Передача субагенту отклонена', 'Sub-agent handoff': 'Передача субагенту',
  'Waiting for the next sub-agent the coordinator starts. No work has started, and no sub-agent is assigned yet.': 'Ждёт следующего субагента, которого запустит координатор. Работа не начата, субагент пока не назначен.',
  'Not applied: the plan changed after the handoff was planned.': 'Не применена: план изменился после того, как передачу запланировали.',
  'Not applied: the plan’s task structure changed.': 'Не применена: изменилась структура задач плана.',
  'Not applied: the plan was closed.': 'Не применена: план закрыт.',
  'Not applied: the task’s assignment changed.': 'Не применена: изменилось назначение задачи.',
  'Not applied: the change couldn’t be checked.': 'Не применена: изменения не удалось проверить.',
  'Not applied: the progress service refused it.': 'Не применена: сервис прогресса её отклонил.',
  'The coordinator can plan the handoff again for the current plan, or link the task to a session.': 'Координатор может снова запланировать передачу для текущего плана или связать задачу с сессией.',
} as const;
type CopyKey = keyof typeof RUSSIAN;
const CHINESE: Record<CopyKey, string> = {
  'time unknown': '时间未知', 'at least {time}': '至少 {time}',
  'The progress service could not tell when this task was reported in progress.': '进度服务无法确定此任务何时被报告为进行中。',
  'Reported in progress at {at}': '报告为进行中：{at}',
  'Observed in progress by {at}; start unknown': '截至 {at} 观察到进行中；开始时间未知',
  '{n} in progress': '{n} 项进行中', '{n} blocked': '{n} 项受阻',
  ' done, {n} remaining': ' 已完成，剩余 {n}',
  'from another OpenCode setup': '来自其他 OpenCode 安装', 'Open session': '打开会话',
  'OpenCode install not connected': 'OpenCode 安装未连接',
  'Updated ': '更新于 ', 'From another OpenCode setup': '来自其他 OpenCode 配置', 'Unverified OpenCode setup': '未经验证的 OpenCode 配置',
  '{n} plans': '{n} 个计划', 'Plan {index} of {count}: {title}. Choose another plan': '第 {index} 个计划，共 {count} 个：{title}。选择其他计划',
  '{index} of {count}': '{index} / {count}', 'Plan ': '计划 ',
  'Assigned to this session': '已分配给此会话', 'Reported directly by this session': '由此会话直接报告',
  'Direct report attributed to this session': '归属于此会话的直接报告', 'Reported for this session': '为此会话报告',
  'Relayed by this session': '由此会话转述', 'Recorded reporter · report mode unavailable': '已记录报告者 · 报告模式不可用',
  'Linked to this session · not an assignment': '关联到此会话 · 并非分配',
  'No participant recorded': '未记录参与者', 'no participant recorded': '未记录参与者',
  'All participants': '所有参与者', 'main session · ': '主会话 · ', 'no longer recorded': '已不再记录', 'Participant': '参与者',
  'Jump to in progress': '跳转到进行中的任务', 'No tasks in progress': '没有进行中的任务', 'In progress': '进行中',
  'Jump to reported in progress': '跳转到报告为进行中的任务', 'No tasks reported in progress': '没有报告为进行中的任务', 'Reported in progress': '报告为进行中',
  'Jump to blocked': '跳转到受阻任务', 'No blocked tasks': '没有受阻任务', 'Blocked': '受阻',
  'Jump to reported blocked': '跳转到报告为受阻的任务', 'No tasks reported blocked': '没有报告为受阻的任务', 'Reported blocked': '报告为受阻',
  'Sessions': '会话', 'Main session': '主会话', 'Child session': '子会话', '{n} assigned': '已分配 {n} 项',
  'reports relayed by the main session': '报告由主会话转述',
  'Loading {what}': '正在加载{what}', '{what} could not be loaded. {failure}.': '无法加载{what}。{failure}。', 'Try again': '重试',
  'Plan document': '计划文档', 'No earlier capture is available.': '没有可用的较早采集。', 'the document': '文档',
  'The captured text is not available.': '已采集的文本不可用。',
  'A newer capture was recorded while this loaded. This is the earlier capture.': '加载期间记录了较新的采集；此处显示的是较早的采集。',
  'Captured ': '采集于 ', 'Last good capture ': '上次成功采集于 ',
  'This is the last successful capture, not the current file.': '这是上次成功的采集，不是当前文件。',
  'The task list was confirmed against this capture. The current file has not been rechecked since.': '任务列表已针对本次采集确认，此后尚未重新检查当前文件。',
  'The current file has not been rechecked since this capture.': '本次采集后尚未重新检查当前文件。',
  'That task is no longer shown in this plan.': '此计划中已不再显示该任务。',
  'Showing all tasks so this task is visible.': '已显示全部任务，以便查看此任务。',
  'Show prerequisite: {title}': '显示前置任务：{title}', 'A group, not a task: it can’t count as done': '这是分组而非任务，不能计为已完成',
  'Prerequisite task unavailable': '前置任务不可用',
  'Decision': '决策', 'Dependency': '依赖', 'Review': '审阅', 'External': '外部', 'Other': '其他',
  'Wait category: ': '等待类别：', 'Category unknown': '类别未知', 'The report used a category this version doesn’t recognize.': '报告使用了此版本无法识别的类别。',
  'Unknown': '未知', 'Unavailable': '不可用',
  'The progress service couldn’t tell when this task was reported blocked.': '进度服务无法确定此任务何时被报告为受阻。',
  'This progress service doesn’t report waiting times.': '此进度服务不报告等待时长。',
  'Reported blocked at {at}. Counts reported status, not activity.': '报告为受阻：{at}。计入的是报告状态，而非活动。',
  'Already reported blocked at {at}; the start is earlier and unknown.': '此前已报告为受阻：{at}；开始时间更早且未知。',
  'No reported blockers.': '没有报告的阻塞。',
  'No reported blockers in the last successful read. This may be out of date.': '上次成功读取时没有报告的阻塞，信息可能已过期。',
  'No reported blockers were recorded. Capture is off, so newer reports aren’t recorded.': '没有记录报告的阻塞。采集已关闭，因此不会记录较新的报告。',
  'two tasks share an ID': '两个任务共用一个 ID', 'a task lists itself as a prerequisite': '任务将自身列为前置任务', 'some tasks list each other as prerequisites': '部分任务互相列为前置任务',
  'Now': '当前', 'Reported working': '报告为进行中', 'Up next': '接下来', 'Pending': '未开始', 'Done': '已完成', 'Skipped': '已跳过',
  'in progress': '进行中', 'blocked': '受阻', 'ready': '就绪', 'waiting': '等待中', 'pending': '未开始', 'done': '已完成', 'skipped': '已跳过',
  'Ready to start': '可以开始', 'Waiting on prerequisites': '等待前置任务',
  'Filter tasks by state': '按状态筛选任务', 'About these counts': '关于这些计数',
  'Counts cover every task in this plan, whatever filter is shown.': '无论显示何种筛选条件，计数均涵盖此计划中的所有任务。',
  'Ready and waiting come from recorded prerequisites only. Other prerequisites may not be recorded, and “No prerequisites recorded” doesn’t mean there are none. Ready is not permission to start.': '就绪和等待仅依据已记录的前置任务。其他前置任务可能未记录，“未记录前置任务”不代表不存在。就绪并非开始许可。',
  'Blocked lists every task reported as blocked. Each stays there until an agent reports otherwise; a wait can be for another session or person. Needs you shows only reported decision and review waits.': '“受阻”列出所有报告为受阻的任务，直到智能体另行报告；等待对象可能是其他会话或人员。“需要你处理”仅显示报告中等待决策和审阅的事项。',
  'Counts cover every task in this plan, whatever filter is shown. They are the statuses last reported; a closed plan, or one whose recorded prerequisites can’t be read, gets no ready or waiting advice.': '无论显示何种筛选条件，计数均涵盖此计划中的所有任务。这些是上次报告的状态；已关闭的计划或无法读取已记录前置任务的计划不会获得就绪或等待建议。',
  'Readiness is unavailable for this report: {reason}. The tasks are shown as reported.': '此报告的就绪状态不可用：{reason}。任务按报告内容显示。',
  'Last reported readiness. It may be out of date and isn’t a current recommendation.': '这是上次报告的就绪状态，可能已过期，并非当前建议。',
  'Capture is off: these are the last reported blockers, not current guidance.': '采集已关闭：这些是上次报告的阻塞，并非当前建议。',
  'Some recorded prerequisites aren’t in this plan, so the tasks that need them can’t be shown as ready.': '部分已记录的前置任务不在此计划中，因此依赖它们的任务不能显示为就绪。',
  ' (no tasks have this state now)': '（当前没有任务处于此状态）', 'Unfinished': '未完成', 'Participant {name}': '参与者 {name}',
  '{filter}: {matching} of {tasks}': '{filter}：{matching} / {tasks}', '{tasks} kept in view': '保留显示：{tasks}', '{n} shown for context': '作为上下文显示 {n} 项',
  'Clear filters': '清除筛选', 'Task filters cleared, so focus moved to Tasks.': '已清除任务筛选，焦点已移至任务。',
  'No tasks match the filter. Blocked tasks stay listed below.': '没有任务符合筛选条件。受阻任务仍列在下方。', 'No tasks match the filter.': '没有任务符合筛选条件。',
  'This plan no longer records {name} on any task.': '此计划已不再在任何任务中记录 {name}。',
  'They are still in the plan, and the counts above cover every task.': '它们仍在计划中，上方计数涵盖所有任务。', 'Clear task filters': '清除任务筛选',
  'Ready': '就绪', 'Waits on {n}': '等待 {n} 项前置任务', 'Reported details couldn’t be read': '无法读取报告的详情',
  'Status': '状态', 'Details': '详情', 'Reason': '原因', 'Next step': '下一步', 'Reported wait': '报告的等待时长',
  'Needs first': '前置需求', 'About prerequisites of {title}': '关于 {title} 的前置任务',
  'Only prerequisites an agent recorded are listed. Others may not be recorded, so “No prerequisites recorded” doesn’t mean there are none.': '这里只列出智能体记录的前置任务。其他前置任务可能未记录，因此“未记录前置任务”不代表不存在。',
  'A blocked task doesn’t mean anyone must act; it stays blocked until an agent reports otherwise.': '任务受阻不意味着必须有人采取行动；它会保持受阻，直到智能体另行报告。',
  'No prerequisites recorded': '未记录前置任务', 'Prerequisites of {title}': '{title} 的前置任务', 'a group': '分组', 'unavailable': '不可用',
  'A recorded prerequisite is unavailable, so this task can’t be shown as ready.': '已记录的前置任务不可用，因此此任务不能显示为就绪。',
  'Tasks {title} would unlock': '{title} 将解锁的任务', 'Show task: {title}': '显示任务：{title}',
  'Unlocks': '解锁', 'About what {title} unlocks': '关于 {title} 解锁的任务',
  'If this task is reported done, each task listed would have every recorded prerequisite done. From recorded prerequisites only; not permission to start.': '如果此任务被报告为已完成，列出的每项任务的所有已记录前置任务都将完成。仅依据已记录的前置任务，并非开始许可。',
  'Group': '分组', 'Parent group unavailable': '上级分组不可用', 'Assignee': '负责人', 'Not recorded': '未记录',
  'Linked to ': '关联到 ', ' · {state} (no recorded assignment)': ' · {state}（未记录分配）',
  '; linked to {names} (no recorded assignment)': '；关联到 {names}（未记录分配）',
  'the selected session': '所选会话', 'The selected session': '所选会话',
  'reported by {reporter} for {attributed}': '由 {reporter} 为 {attributed} 报告', 'reported directly by {reporter}': '由 {reporter} 直接报告',
  'Details and task {report}': '详情与任务：{report}', 'Details {report}': '详情：{report}', 'Task {report}': '任务：{report}',
  'Last reported by {name} · report mode unavailable': '上次报告者：{name} · 报告模式不可用', 'Reported': '报告',
  'Copy details…': '复制详情…', 'Review before sharing: this is the recorded text exactly as shown.': '分享前请检查：这是与显示内容完全一致的记录文本。',
  'Task details (read-only)': '任务详情（只读）', 'Copied.': '已复制。', 'Clipboard unavailable. Select and copy the text above.': '剪贴板不可用，请选择并复制上方文本。',
  'Copy': '复制', 'Close': '关闭', 'kept in view': '保留显示', 'shown for context': '作为上下文显示',
  'Last reported: ': '上次报告：', '{tasks} hidden by filters': '被筛选隐藏：{tasks}', '{tasks} shown for context': '作为上下文显示：{tasks}', '{tasks} folded': '已折叠：{tasks}',
  'Tasks': '任务', 'This plan has no tasks yet.': '此计划尚无任务。', 'No task rows are recorded in this plan, only groups.': '此计划没有记录任务行，只有分组。',
  'Tasks in {title}, in plan order': '{title} 中按计划顺序排列的任务',
  'Task view': '任务视图', 'Show tasks': '显示任务', 'Show all': '显示全部', 'Order': '顺序', 'By attention': '按关注程度', 'Plan order': '计划顺序',
  'Expand all': '全部展开', 'Collapse all': '全部折叠', 'Copy progress update…': '复制进度更新…', 'Copy handoff…': '复制交接内容…',
  'Task view options…': '任务视图选项…', 'Show by attention': '按关注程度显示', 'Show in plan order': '按计划顺序显示', 'Expand all tasks': '展开所有任务', 'Collapse all tasks': '折叠所有任务',
  'tasks': '任务', 'history': '历史记录', 'Plan summaries': '计划摘要', 'Progress update preview': '进度更新预览', 'Handoff preview': '交接内容预览',
  'Review the Markdown, then copy it.': '请检查 Markdown 后再复制。', 'Markdown preview (read-only)': 'Markdown 预览（只读）',
  'Copy Markdown': '复制 Markdown', 'Retry': '重试', 'Preview summary only': '仅预览摘要',
  'Revisions': '修订记录', 'plan reported': '已报告计划', 'tasks revised': '任务已修订', 'outcome reported': '已报告结果', 'progress update': '进度更新',
  'Revision {n}': '修订 {n}', 'Only the first {n} revisions are shown.': '仅显示前 {n} 个修订。',
  'Capture is turned off; no new reports are recorded.': '采集已关闭；不会记录新报告。', 'Some recorded sources are not verified.': '部分已记录的来源未经验证。',
  'This service is not bound to a verified OpenCode setup.': '此服务未绑定到经过验证的 OpenCode 配置。', 'Showing an earlier document capture.': '显示较早的文档采集。',
  'Plan': '计划', 'Revision': '修订', '{revision} (structure {structure})': '{revision}（结构 {structure}）', 'Last reported location': '上次报告的位置',
  'Plan source': '计划来源', 'Document source': '文档来源', 'Document state': '文档状态', ', task list confirmed': '，任务列表已确认',
  'Document capture': '文档采集', 'Document checked': '文档检查时间', 'Store': '存储', 'Bound source': '绑定来源',
  ' (verified)': '（已验证）', ' (not verified)': '（未经验证）', 'None': '无', 'Recorded source': '记录的来源', 'Capture': '采集', 'On': '开启', 'Off': '关闭', 'Coverage': '覆盖范围',
  'Loading progress': '正在加载进度', 'Setup is needed': '需要设置', 'Progress loaded again': '进度已重新加载',
  'Showing progress from {time}': '显示 {time} 的进度', '{failure}. This may be out of date.': '{failure}。信息可能已过期。', 'Last refresh error': '上次刷新错误',
  'Next sub-agent will take this': '下一个子智能体将接手此任务', 'Sub-agent handoff refused': '子智能体交接被拒绝', 'Sub-agent handoff': '子智能体交接',
  'Waiting for the next sub-agent the coordinator starts. No work has started, and no sub-agent is assigned yet.': '等待协调者启动下一个子智能体。工作尚未开始，也尚未分配子智能体。',
  'Not applied: the plan changed after the handoff was planned.': '未生效：交接安排后计划发生了变化。',
  'Not applied: the plan’s task structure changed.': '未生效：计划的任务结构发生了变化。',
  'Not applied: the plan was closed.': '未生效：计划已关闭。',
  'Not applied: the task’s assignment changed.': '未生效：任务分配发生了变化。',
  'Not applied: the change couldn’t be checked.': '未生效：无法检查变更。',
  'Not applied: the progress service refused it.': '未生效：进度服务拒绝了交接。',
  'The coordinator can plan the handoff again for the current plan, or link the task to a session.': '协调者可以按当前计划重新安排交接，或将任务关联到会话。',
};
// English phrases are stable message keys, not necessarily the displayed English wording.
// Keep changed messages together so all three languages carry the same meaning.
type MessageTranslations = Record<InterfaceLanguage, string>;
const PLAIN_COPY: Partial<Record<CopyKey, MessageTranslations>> = {
  'From another OpenCode setup': { en: 'From another OpenCode install; its sessions can’t be opened here.', ru: 'Из другой установки OpenCode; её сессии нельзя открыть здесь.', 'zh-CN': '来自其他 OpenCode 安装，无法在此打开其会话。' },
  'Reported in progress at {at}': { en: 'In progress since {at}', ru: 'В работе с {at}', 'zh-CN': '自 {at} 起进行中' },
  'Observed in progress by {at}; start unknown': { en: 'In progress by {at}; start unknown', ru: 'В работе к {at}; начало неизвестно', 'zh-CN': '{at} 时已在进行中，开始时间未知' },
  'The progress service could not tell when this task was reported in progress.': { en: 'Start time unknown.', ru: 'Время начала неизвестно.', 'zh-CN': '开始时间未知。' },
  'The progress service couldn’t tell when this task was reported blocked.': { en: 'Wait time unknown.', ru: 'Время ожидания неизвестно.', 'zh-CN': '等待时间未知。' },
  'This progress service doesn’t report waiting times.': { en: 'Wait time unavailable.', ru: 'Время ожидания недоступно.', 'zh-CN': '等待时间不可用。' },
  'Reported blocked at {at}. Counts reported status, not activity.': { en: 'Blocked since {at}', ru: 'Заблокирована с {at}', 'zh-CN': '自 {at} 起受阻' },
  'Already reported blocked at {at}; the start is earlier and unknown.': { en: 'Already blocked at {at}; start unknown.', ru: 'Уже заблокирована к {at}; начало неизвестно.', 'zh-CN': '{at} 时已受阻，开始时间未知。' },
  'Reported working': { en: 'In progress', ru: 'В работе', 'zh-CN': '进行中' },
  'Reported in progress': { en: 'In progress', ru: 'В работе', 'zh-CN': '进行中' },
  'Reported blocked': { en: 'Blocked', ru: 'Заблокировано', 'zh-CN': '受阻' },
  'Jump to reported in progress': { en: 'Jump to in progress', ru: 'К задачам в работе', 'zh-CN': '跳转到进行中的任务' },
  'No tasks reported in progress': { en: 'No tasks in progress', ru: 'Нет задач в работе', 'zh-CN': '没有进行中的任务' },
  'Jump to reported blocked': { en: 'Jump to blocked', ru: 'К заблокированным', 'zh-CN': '跳转到受阻任务' },
  'No tasks reported blocked': { en: 'No blocked tasks', ru: 'Нет заблокированных задач', 'zh-CN': '没有受阻任务' },
  'Reported details couldn’t be read': { en: 'Couldn’t load task details; try again.', ru: 'Не удалось загрузить сведения о задаче; попробуйте снова.', 'zh-CN': '无法加载任务详情，请重试。' },
  'Last reported: ': { en: 'Last update: ', ru: 'Последнее обновление: ', 'zh-CN': '上次更新：' },
  'Reported wait': { en: 'Waiting', ru: 'Ожидание', 'zh-CN': '等待中' },
  'Reason': { en: 'Why', ru: 'Почему', 'zh-CN': '原因' },
  'Capture is turned off; no new reports are recorded.': { en: 'Recording is off; new progress isn’t saved.', ru: 'Запись выключена; новый прогресс не сохраняется.', 'zh-CN': '记录已关闭，新进度不会保存。' },
  'No participant recorded': { en: 'No participant listed', ru: 'Участник не указан', 'zh-CN': '未列出参与者' },
  'No task rows are recorded in this plan, only groups.': { en: 'This plan has groups, but no tasks yet.', ru: 'В плане есть группы, но пока нет задач.', 'zh-CN': '此计划有分组，但还没有任务。' },
  'Revisions': { en: 'Updates', ru: 'Обновления', 'zh-CN': '更新' },
  'Revision {n}': { en: 'Update {n}', ru: 'Обновление {n}', 'zh-CN': '更新 {n}' },
  'Only the first {n} revisions are shown.': { en: 'Older updates are not shown.', ru: 'Более ранние обновления не показаны.', 'zh-CN': '未显示较早的更新。' },
  'plan reported': { en: 'plan shared', ru: 'план добавлен', 'zh-CN': '已分享计划' },
  'outcome reported': { en: 'plan closed', ru: 'план закрыт', 'zh-CN': '计划已关闭' },
};
const COPY: Record<InterfaceLanguage, Record<CopyKey, string>> = {
  en: Object.fromEntries(Object.keys(RUSSIAN).map(key => [key, key])) as Record<CopyKey, string>, ru: RUSSIAN, 'zh-CN': CHINESE,
};
function say(key: CopyKey, locale = 'en', values: Record<string, string | number> = {}) {
  const language = resolveLanguage('auto', locale);
  return (PLAIN_COPY[key]?.[language] ?? COPY[language][key]).replace(/\{(\w+)\}/g, (_, name: string) => typeof values[name] === 'number' ? displayCount(values[name], language) : String(values[name]));
}
const displayCount = (n: number, locale: InterfaceLanguage) => locale === 'en' ? String(n) : formatCount(n, locale);
const COUNT_WORDS: Record<InterfaceLanguage, Record<'task' | 'blocked' | 'more', [string, string, string]>> = {
  en: { task: ['task', 'tasks', 'tasks'], blocked: ['blocked task', 'blocked tasks', 'blocked tasks'], more: ['more session', 'more sessions', 'more sessions'] },
  ru: { task: ['задача', 'задачи', 'задач'], blocked: ['заблокированная задача', 'заблокированные задачи', 'заблокированных задач'], more: ['дополнительная сессия', 'дополнительные сессии', 'дополнительных сессий'] },
  'zh-CN': { task: ['个任务', '个任务', '个任务'], blocked: ['个受阻任务', '个受阻任务', '个受阻任务'], more: ['个其他会话', '个其他会话', '个其他会话'] },
};
function countText(n: number, kind: keyof typeof COUNT_WORDS.en, locale: InterfaceLanguage) {
  const form = new Intl.PluralRules(locale).select(n);
  return `${displayCount(n, locale)} ${COUNT_WORDS[locale][kind][form === 'one' ? 0 : form === 'few' ? 1 : 2]}`;
}
const taskCount = (n: number, locale: InterfaceLanguage) => countText(n, 'task', locale);
const moreSessions = (n: number, locale: InterfaceLanguage) => countText(n, 'more', locale);

export interface Env {
  device?: DeviceView;
  locale: InterfaceLanguage;
  now: number;
  /** Monotonic time of this paint (performance.now), for elapsed labels. */
  mono: number;
  live: LiveSnapshot;
  /** The service's verified source binding, or null. Navigation requires a match. */
  boundSource: string | null;
  /** Recorded sources the store does not mark verified; their plans show an unverified identity. */
  unverifiedSources: ReadonlySet<string>;
  /** The last read succeeded and capture is on; together with an active plan this gates motion. */
  view: { fresh: boolean; captureEnabled: boolean };
  openSession?: (sessionId: string) => void;
  openDocumentUrl?: (url: string) => void;
  /** For explicit activation of an admitted live session link. */
  openLinkedWorkUrl?: (url: string) => void;
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

export const testid = <T extends HTMLElement>(node: T, id: string) => { node.dataset.testid = id; return node; };

/** The preference lives outside the plan and remains available when progress cannot load. */
export function languageBlock(language: ViewContext<unknown>['language'], locale: string) {
  const copy = languageMessages(resolveLanguage('auto', locale));
  const wrap = testid(el('div', 'ap-language'), 'interface-language');
  const select = el('div');
  mountSelect(select, { label: copy.label, value: language.preference,
    options: [{ id: 'auto', label: copy.automatic }, { id: 'en', label: 'English' }, { id: 'ru', label: 'Русский' }, { id: 'zh-CN', label: '简体中文' }],
    disabled: !language.supported || language.pending,
    onChange: (value) => { if (value === 'auto' || value === 'en' || value === 'ru' || value === 'zh-CN') language.choose(value); },
  });
  wrap.append(select);
  const message = !language.supported ? copy.unsupported : language.pending ? copy.saving
    : language.writeError ? copy.saveFailed : language.readError ? copy.readFailed : language.saveStatus === 'saved' ? copy.saved : '';
  if (message) {
    const status = testid(el('p', 'ap-note', message), 'interface-language-status');
    status.id = 'interface-language-status';
    status.setAttribute('role', 'status');
    select.querySelector('button')?.setAttribute('aria-describedby', status.id);
    wrap.append(status);
  }
  return wrap;
}

export function age(iso: string, env: Env, prefix = '', compact = false) {
  const t = el('time');
  t.dateTime = iso;
  t.dataset.age = prefix;
  if (compact) t.dataset.ageCompact = '';
  t.title = absoluteTime(iso, env.locale);
  t.textContent = `${prefix}${relativeAge(iso, env.now, env.locale, compact ? 'narrow' : 'long')}`;
  return t;
}

export function quietAge(plan: Pick<PlanView, 'lifecycle' | 'reportedAt'>, env: Env) {
  const days = quietDays(plan, env.now);
  if (days === null) return null;
  const node = testid(el('time', 'ap-note', quietLabel(days, env.locale)), 'quiet-plan-age');
  node.dateTime = plan.reportedAt;
  node.title = absoluteTime(plan.reportedAt, env.locale);
  return node;
}

export function quietNotice<U>(vc: ViewContext<U>) {
  const t = quietCopy(vc.env.locale), q = vc.quiet;
  // Without device storage the switch itself says the choice is frame-local (quietCheck).
  const text = q.saving ? t.saving : q.error ? t[q.error] : '';
  if (!text) return null;
  const box = testid(el('div', 'ap-note'), 'quiet-filter-note');
  const status = el('span', '', text); status.setAttribute('role', 'status'); box.append(status);
  if (q.error === 'read' && !q.saving) button(box, 'quiet-filter-retry', t.retry, q.retry, 'ghost');
  return box;
}

export function quietEmpty<U>(vc: ViewContext<U>) {
  const t = quietCopy(vc.env.locale);
  const box = testid(el('div', 'ap-panel'), 'quiet-plans-empty');
  box.append(el('p', '', t.empty));
  button(box, 'quiet-show-all', t.show, () => { void vc.quiet.choose(false); }, 'outline', vc.quiet.saving);
  return box;
}

export function quietCheck<U>(vc: ViewContext<U>) {
  const label = el('label', 'ap-quiet-check');
  const control = testid(el('input', 'ap-sr'), 'quiet-plan-filter');
  control.type = 'checkbox'; control.checked = vc.quiet.hide; control.disabled = vc.quiet.saving;
  control.setAttribute('role', 'switch');
  const t = quietCopy(vc.env.locale);
  // The seven-day rule, plus the frame-local caveat when the host has no device storage. The
  // tooltip shows it to pointer users; a hidden description (not the name) carries it to
  // assistive technology.
  const stop = resolveLanguage('auto', vc.env.locale) === 'zh-CN' ? '。' : '. ';
  const about = vc.quiet.supported ? t.filter : `${t.filter}${stop}${t.unsupported}`;
  label.title = about;
  const description = testid(el('span', '', about), 'quiet-plan-filter-description');
  description.id = 'ap-quiet-description'; description.hidden = true;
  control.setAttribute('aria-describedby', description.id);
  control.addEventListener('change', () => { const choice = control.checked; control.checked = vc.quiet.hide; void vc.quiet.choose(choice); });
  const track = el('span', 'ap-quiet-track'); track.setAttribute('aria-hidden', 'true');
  const short = { en: 'Hide quiet', ru: 'Скрыть без отчётов', 'zh-CN': '隐藏久未更新' }[resolveLanguage('auto', vc.env.locale)];
  label.append(control, track, el('span', '', short), description);
  return label;
}

const elapsedLabelText = (kind: string | undefined, ms: number, locale = 'en') => {
  const text = elapsedText(ms, locale);
  return text === null ? say('time unknown', locale) : kind === 'lower-bound' ? `${text}+` : text;
};

/**
 * How long a working task has been reported in progress, for the Now callout and Work Status.
 * Only for a working task of an active plan whose reply carried timing; a missing entry says the
 * start is unknown instead of showing zero. Ticks in place (refreshLabels).
 */
export function elapsedLabel(plan: PlanView, item: ItemView, detail: PlanDetail, env: Env) {
  if (plan.lifecycle !== 'active' || item.kind !== 'task' || item.status !== 'working' || !detail.timing) return null;
  const a = detail.timing[item.id];
  const t = testid(el('time', 'ap-elapsed'), `elapsed-${item.id}`);
  if (!a) {
    t.dataset.kind = 'unknown';
    t.dataset.elapsedUnknown = 'working';
    t.textContent = say('time unknown', env.locale);
    t.title = say('The progress service could not tell when this task was reported in progress.', env.locale);
    return t;
  }
  t.dateTime = a.since;
  t.dataset.kind = a.kind;
  t.dataset.elapsed = String(a.elapsedAtRead);
  t.dataset.received = String(a.receivedAt);
  const at = absoluteTime(a.since, env.locale);
  t.title = say(a.kind === 'exact' ? 'Reported in progress at {at}' : 'Observed in progress by {at}; start unknown', env.locale, { at });
  t.textContent = elapsedLabelText(a.kind, elapsedAt(a, env.mono), env.locale);
  return t;
}

/**
 * Re-labels every age and elapsed time in place without repainting the view; text changes only
 * when the label differs. Elapsed time comes from each label's anchor, not from counted ticks.
 */
export function refreshLabels(root: ParentNode, locale: string, now = Date.now(), mono = performance.now()) {
  // Only time text moves here. Activity and run state never change from elapsed time: no label
  // expires, so a steady Running row stays Running until the host reports something else.
  for (const t of root.querySelectorAll<HTMLTimeElement>('time[data-age]')) {
    const text = `${t.dataset.age ?? ''}${relativeAge(t.dateTime, now, locale, t.dataset.ageCompact !== undefined ? 'narrow' : 'long')}`;
    if (t.textContent !== text) t.textContent = text;
    t.title = absoluteTime(t.dateTime, locale);
  }
  for (const t of root.querySelectorAll<HTMLTimeElement>('time[data-elapsed]')) {
    const text = elapsedLabelText(t.dataset.kind, Number(t.dataset.elapsed) + Math.max(0, mono - Number(t.dataset.received)), locale);
    if (t.textContent !== text) t.textContent = text;
    const at = absoluteTime(t.dateTime, locale);
    t.title = say(t.dataset.blockedTime !== undefined
      ? t.dataset.kind === 'exact' ? 'Reported blocked at {at}. Counts reported status, not activity.' : 'Already reported blocked at {at}; the start is earlier and unknown.'
      : t.dataset.kind === 'exact' ? 'Reported in progress at {at}' : 'Observed in progress by {at}; start unknown', locale, { at });
  }
  for (const t of root.querySelectorAll<HTMLElement>('[data-elapsed-unknown]')) {
    const kind = t.dataset.elapsedUnknown;
    t.textContent = say(kind === 'working' ? 'time unknown' : kind === 'unknown' ? 'Unknown' : 'Unavailable', locale);
    t.title = say(kind === 'working' ? 'The progress service could not tell when this task was reported in progress.'
      : kind === 'unknown' ? 'The progress service couldn’t tell when this task was reported blocked.' : 'This progress service doesn’t report waiting times.', locale);
  }
}

/** Blue in-progress status text; `data-text` feeds its decorative pulse overlay (style.ts). */
function workingText(text: string) {
  const t = el('span', 'ap-working-text', text);
  t.dataset.text = text;
  return t;
}

/**
 * A task's status mark (primitives.ts), named for assistive technology. Keeps the `ap-glyph` row
 * hook; a working task is "Reported working", never "Running".
 */
export function glyph(status: ItemView['status'], locale = 'en') {
  return statusMark(status, { className: 'ap-glyph', locale });
}

export function chip(state: string, tone: 'info' | 'warning' | 'neutral', name?: string) {
  const c = el('span', 'ap-chip');
  const dot = el('span', 'ap-dot');
  dot.dataset.tone = tone;
  dot.setAttribute('aria-hidden', 'true');
  c.append(dot);
  if (name) c.append(el('b', '', name), el('span', 'ap-chip-state', state));
  else c.append(el('b', '', state));
  return c;
}

export function lifecycleBadge(plan: PlanView, locale: InterfaceLanguage = 'en') {
  const b = el('span');
  const tone: Tone = plan.lifecycle === 'completed' ? 'success' : plan.lifecycle === 'failed' ? 'error' : 'neutral';
  mountBadge(b, { label: lifecycleLabel(plan.lifecycle, locale), tone });
  return b;
}

/** The bar's spoken summary: done of total, remaining, skipped (never counted as done), then working and blocked. */
const barLabel = (s: PlanSummary, locale: InterfaceLanguage) => {
  const sep = locale === 'zh-CN' ? ' · ' : ', ';
  return `${summaryText(s, locale)}${s.working ? `${sep}${say('{n} in progress', locale, { n: s.working })}` : ''}${s.blocked ? `${sep}${say('{n} blocked', locale, { n: s.blocked })}` : ''}`;
};

/**
 * Every task done (a nonzero total, nothing remaining, none skipped: skipped is never done): the
 * count gets `data-all-done`, the success colour and a decorative done mark, like the kit's finished
 * progress caption. The count's own words and the bar's name already say it, so nothing new is spoken.
 */
export function allDone(counts: HTMLElement, s: Pick<PlanSummary, 'total' | 'remaining' | 'skipped'>) {
  if (!(s.total > 0 && s.remaining === 0 && s.skipped === 0)) return;
  counts.dataset.allDone = 'true';
  counts.prepend(statusMark('done', { decorative: true, className: 'ap-done-mark' }));
}

/**
 * The at-a-glance progress line: done/total and the segmented bar. The state chips (stateChipRow)
 * are its legend. `compact` keeps Work Status's one-line counts.
 */
export function progressBlock(s: PlanSummary, compact = false, locale: InterfaceLanguage = 'en') {
  const wrap = el('div', compact ? 'ap-progress' : 'ap-progress ap-progress-line');
  const counts = testid(el('div', compact ? 'ap-row' : 'ap-fraction'), 'counts');
  counts.dataset.done = String(s.done);
  counts.dataset.total = String(s.total);
  counts.dataset.remaining = String(s.remaining);
  counts.dataset.skipped = String(s.skipped);
  if (compact) {
    const line = el('span', '', summaryText(s, locale));
    if (s.working) line.append(' · ', workingText(say('{n} in progress', locale, { n: s.working })));
    if (s.blocked) line.append(` · ${say('{n} blocked', locale, { n: s.blocked })}`);
    counts.append(line);
  } else if (s.total === 0) counts.append(el('span', 'ap-muted', summaryText(s, locale)));
  else {
    const n = el('strong', '', displayCount(s.done, locale));
    counts.append(n, el('span', 'ap-fraction-total', `/${displayCount(s.total, locale)}`), el('span', 'ap-sr', say(' done, {n} remaining', locale, { n: s.remaining })));
    allDone(counts, s);
  }
  wrap.append(counts);
  const bar = segmentedBar(s, barLabel(s, locale));
  if (bar) wrap.append(bar);
  return wrap;
}

export function planLocation(plan: PlanView, live: LiveSnapshot, bound?: string | null, locale: InterfaceLanguage = 'en') {
  const place = placeOf(plan, live, bound, locale);
  return place.worktreeKey.startsWith('root:') || place.worktreeLabel === place.projectLabel ? place.projectLabel : `${place.projectLabel} · ${place.worktreeLabel}`;
}

/**
 * Host session titles and live state belong only to plans of the verified bound source; a foreign
 * or unverified plan's same-ID session must not borrow them (Readiness, Task view, rows, Sessions).
 */
const trustedSource = (plan: PlanView, env: Env) => env.boundSource !== null && plan.sourceId === env.boundSource;

function sessionChip(plan: PlanView, sessionId: string, env: Env) {
  const trusted = trustedSource(plan, env);
  const cov = coverageFor(sessionId, plan.directory, trusted ? env.live : EMPTY_LIVE);
  const l = trusted ? liveLabel(cov, env.locale) : { label: say('from another OpenCode setup', env.locale), tone: 'neutral' as const };
  return { cov, node: chip(l.label, l.tone, recordedLabel(plan, env)(sessionId)) };
}

function navButton(plan: PlanView, sessionId: string, cov: Coverage, env: Env) {
  if (!env.openSession || !canOpen(plan.sourceId, env.boundSource, cov)) return null;
  const b = testid(el('button', 'ap-link', say('Open session', env.locale)), `open-session-${sessionId}`);
  b.type = 'button';
  const open = env.openSession;
  b.addEventListener('click', () => open(sessionId));
  return b;
}

/** A ⋯ plan-actions entry supplied by a surface (for example the rail's Details). */
export interface PlanAction { id: string; label: string; run: () => void; disabled?: boolean; destructive?: boolean }

/**
 * The plan header: one title (the rail's title-picker trigger sits beside it), lifecycle, the ⋯
 * plan actions and an optional ⓘ; then one compact meta line. Source warnings stay visible.
 */
export function planHeader(plan: PlanView, env: Env, headingLevel: 'h2' | 'h3' = 'h2', o: { picker?: HTMLElement | null; actions?: HTMLElement | null; info?: HTMLElement | null } = {}) {
  const head = el('header', 'ap-plan-head');
  const top = el('div', 'ap-plan-top');
  const lead = el('div', 'ap-plan-lead');
  // Owning heading of a recovered read (docs/ui.md Restoration): a focus target, never a Tab stop.
  const title = testid(el(headingLevel, 'ap-plan-title', plan.title), 'plan-title');
  title.tabIndex = -1;
  lead.append(title);
  if (o.picker) {
    // The title reads as the picker: a pointer press on it opens the same native trigger.
    title.classList.add('ap-plan-title-pick');
    title.addEventListener('click', () => o.picker!.querySelector<HTMLButtonElement>('.oc-sdk-trigger')?.click());
    lead.append(o.picker);
  }
  top.append(lead);
  if (plan.lifecycle !== 'active') top.append(lifecycleBadge(plan, env.locale));
  if (o.info) top.append(o.info);
  if (o.actions) top.append(o.actions);
  const meta = el('div', 'ap-meta');
  meta.append(el('span', '', planLocation(plan, env.live, env.boundSource, env.locale)), age(plan.reportedAt, env, say('Updated ', env.locale)));
  if (env.boundSource !== null && plan.sourceId !== env.boundSource) meta.append(testid(warningBadge(say('From another OpenCode setup', env.locale), 'info'), 'other-source'));
  if (env.unverifiedSources.has(plan.sourceId)) meta.append(testid(warningBadge(say('Unverified OpenCode setup', env.locale)), 'unverified-source'));
  head.append(top, meta);
  return head;
}

const SHELL_COPY = {
  en: { more: 'More', back: 'Back', document: 'Plan document', history: 'History', sessions: 'Sessions', setup: 'Setup', troubleshooting: 'Troubleshooting', language: 'Language', automatic: 'Automatic (OpenChamber)', unsupported: "Follows OpenChamber’s language on this version.", progress: 'Copy progress update…', handoff: 'Copy handoff note…', advanced: 'Advanced details', newHistory: 'More, new history', help: 'Help & filters', all: 'Show all', unfinished: 'Unfinished', pending: 'not started', working: 'in progress', blocked: 'blocked', skipped: 'skipped', done: 'All done' },
  ru: { more: 'Ещё', back: 'Назад', document: 'Документ плана', history: 'История', sessions: 'Сессии', setup: 'Настройка', troubleshooting: 'Устранение неполадок', language: 'Язык', automatic: 'Автоматически (OpenChamber)', unsupported: 'В этой версии используется язык OpenChamber.', progress: 'Скопировать прогресс…', handoff: 'Скопировать заметку для передачи…', advanced: 'Дополнительные сведения', newHistory: 'Ещё, есть новая история', help: 'Справка и фильтры', all: 'Показать всё', unfinished: 'Незавершённые', pending: 'не начато', working: 'в работе', blocked: 'заблокировано', skipped: 'пропущено', done: 'Всё выполнено' },
  'zh-CN': { more: '更多', back: '返回', document: '计划文档', history: '历史', sessions: '会话', setup: '设置', troubleshooting: '故障排查', language: '语言', automatic: '自动（OpenChamber）', unsupported: '此版本跟随 OpenChamber 的语言。', progress: '复制进度更新…', handoff: '复制交接备注…', advanced: '高级详情', newHistory: '更多，有新历史', help: '帮助与筛选', all: '显示全部', unfinished: '未完成', pending: '未开始', working: '进行中', blocked: '受阻', skipped: '已跳过', done: '全部完成' },
} satisfies Record<InterfaceLanguage, Record<string, string>>;
export const shellCopy = (locale: string) => {
  const language = resolveLanguage('auto', locale);
  return { ...SHELL_COPY[language], settings: { en: 'Settings', ru: 'Настройки', 'zh-CN': '设置' }[language] };
};
export type SurfacePanel = 'sessions' | 'setup' | 'troubleshooting';
/** Hidden same-origin fixture/host frames can report a provisional 300 px viewport.
 * Do not turn that unallocated size into a latched choice. Cross-origin guests have no
 * frameElement and use their ordinary allocated viewport. */
export function narrowSurface() {
  return window.innerWidth > 0 && window.innerWidth < 320 && window.frameElement?.getBoundingClientRect().width !== 0;
}

/** One frame's plan header, Settings and More menus, and temporary panels. */
export class ProgressShell {
  private key = '';
  private panel: SurfacePanel | null = null;
  private closePanel: ((kind: SurfacePanel) => void) | undefined;
  private setPanel(panel: SurfacePanel | null) {
    const previous = this.panel;
    this.panel = panel;
    if (previous && previous !== panel) this.closePanel?.(previous);
  }
  private menu: ReturnType<typeof moreMenu> | null = null;
  private settings: ReturnType<typeof moreMenu> | null = null;
  private focus: 'heading' | 'more' | 'settings' | 'document' | 'document-heading' | null = null;
  private previousView: Exclude<DetailView, 'document'> = 'list';
  private review: { key: string; revision: number | null } | null = null;
  private newHistory = false;
  reset(keepSetup = false) {
    // Same-reading data refreshes (including capture changes) keep Setup usable.
    // Reconcile still closes Setup and More if the account, authority or selection changes.
    if (keepSetup && this.panel === 'setup') this.closePanel?.('setup');
    else { this.setPanel(null); this.closePanel = undefined; }
    if (!keepSetup) { this.key = ''; this.menu?.dispose(); this.menu = null; this.settings?.dispose(); this.settings = null; }
    this.review = null; this.newHistory = false; this.focus = null; this.previousView = 'list';
  }
  get activePanel() { return this.panel; }
  /** Reconcile selection before callers decide which view is active, not only during paint. */
  reconcile<U>(vc: ViewContext<U>, plan: PlanView | null, options: { board?: boolean; scope?: string } = {}) {
    const key = JSON.stringify([vc.ctx.connection?.account, vc.identity, options.board ? null : vc.session?.id, options.scope, plan?.key]);
    if (key !== this.key) { this.reset(); this.key = key; }
  }
  showView<U>(vc: ViewContext<U>) { this.setPanel(null); vc.setUi({}); }
  visit(view: DetailView, next: DetailView) {
    if (next === 'document' && view !== 'document') {
      this.previousView = view;
      this.focus = 'document-heading';
    }
  }
  documentBack(change: (view: DetailView) => void) {
    return () => { this.focus = 'document'; change(this.previousView); };
  }
  switchView(view: DetailView, change: (view: DetailView) => void, locale: string) {
    const key = this.key;
    return surfaceViewSwitch(view, next => { if (this.key === key) { this.visit(view, next); change(next); } }, locale, this.newHistory);
  }
  reviewedThrough(revision: number | null) { if (this.review && revision !== null) this.review.revision = revision; }
  /** Called after root replacement, not before (focus must land on a connected control). */
  afterPaint(root: HTMLElement) {
    if (this.menu && !root.contains(this.menu.root)) { this.menu.dispose(); this.menu = null; }
    if (this.settings && !root.contains(this.settings.root)) { this.settings.dispose(); this.settings = null; }
    this.menu?.refresh();
    this.settings?.refresh();
    const target = this.focus && {
      heading: '[data-testid="surface-panel-heading"]', more: '[data-testid="more-trigger"]', settings: '[data-testid="settings-trigger"]',
      document: '[data-testid="plan-view-document"] button', 'document-heading': '[data-testid="document-heading"]',
    }[this.focus];
    this.focus = null;
    if (target) root.querySelector<HTMLElement>(target)?.focus({ preventScroll: true });
  }
  private open<U>(vc: ViewContext<U>, kind: SurfacePanel, key: string, openPanel?: (kind: SurfacePanel) => void) {
    if (this.key !== key) return;
    this.setPanel(kind); this.focus = 'heading'; openPanel?.(kind); vc.setUi({});
  }
  settingsButton<U>(vc: ViewContext<U>, openPanel?: (kind: SurfacePanel) => void) {
    const t = shellCopy(vc.env.locale), key = this.key;
    const lm = languageMessages(resolveLanguage('auto', vc.env.locale));
    const languageStatus = vc.language.pending ? lm.saving : vc.language.writeError ? lm.saveFailed : vc.language.readError ? lm.readFailed : vc.language.saveStatus === 'saved' ? lm.saved : '';
    const options = {
      label: t.settings, settings: true, onOpen: () => this.menu?.close(),
      items: [{ id: 'language', label: t.language + ' ›' }, { id: 'setup', label: t.setup }, { id: 'troubleshooting', label: t.troubleshooting }],
      onSelect: (id: string) => { if (id === 'setup' || id === 'troubleshooting') this.open(vc, id, key, openPanel); },
      languageLabel: t.language, automatic: t.automatic, unsupported: t.unsupported, languageStatus, language: vc.language,
    };
    const settings = this.settings ??= moreMenu(options);
    settings.setOptions(options);
    const holder = testid(el('div', 'ap-actions-hold'), 'surface-settings');
    settings.mount(holder);
    return holder;
  }
  paint<U>(root: HTMLElement, vc: ViewContext<U>, plan: PlanView | null, options: {
    board?: boolean; scope?: string; picker?: HTMLElement | null;
    /** Rail only: More goes into `railActions`; Copy update and Handoff note into `railSummaries` (the Hide quiet row). */
    railActions?: HTMLElement; railSummaries?: HTMLElement;
    renderPanel: (kind: SurfacePanel) => HTMLElement;
    closePanel?: (kind: SurfacePanel) => void;
  }) {
    this.reconcile(vc, plan, options);
    this.closePanel = options.closePanel;
    const key = this.key;
    const t = shellCopy(vc.env.locale);
    const detail = plan ? vc.detail(plan) : null;
    const cancellation = plan ? vc.cancelPlan(plan) : null;
    const ready = detail?.state === 'ready' && detail.value.revision === plan?.revision ? detail.value : null;
    const items: MoreMenuItem[] = [], runs = new Map<string, () => void>();
    const add = (id: string, label: string, run: () => void) => { items.push({ id, label }); runs.set(id, run); };
    const summary = plan ? vc.summary(plan) : null;
    if (plan) {
      const count = participants(plan, ready).length;
      add('sessions', count > 1 ? `${t.sessions} (${displayCount(count, vc.env.locale)})` : t.sessions, () => this.open(vc, 'sessions', key));
    }
    if (cancellation?.eligible && !cancellation.confirmation) add('finish-cancelled', cancelCopy(vc.env.locale).action, cancellation.open);
    const reviewKey = options.board && plan && vc.read && vc.ctx.features?.deviceStorage === true ? JSON.stringify([key, vc.read.storeId, vc.read.binding, vc.refreshSerial]) : null;
    if (reviewKey && this.review?.key !== reviewKey) {
      this.review = { key: reviewKey, revision: this.review?.revision ?? null };
      const identity = { integrationAccount: vc.ctx.connection?.account || null, storeId: vc.read!.storeId, binding: vc.read!.binding, source: plan!.sourceId, plan: plan!.id };
      void new CheckpointStore(vc.storage, () => vc.ctx.features?.deviceStorage === true).read(identity).then(saved => {
        if (this.key !== key || this.review?.key !== reviewKey) return;
        const revision = saved.state === 'saved' ? saved.revision : null;
        if (this.review.revision !== revision) { this.review.revision = revision; vc.setUi({}); }
      });
    }
    this.newHistory = !!(plan && reviewKey && this.review?.revision != null && this.review.revision < plan.revision);
    if (plan) {
      const menuOptions: Parameters<typeof moreMenu>[0] = { label: t.more, items, onOpen: () => this.settings?.close(), onSelect: id => runs.get(id)?.(), languageLabel: t.language, automatic: t.automatic, unsupported: t.unsupported, language: vc.language };
      const menu = this.menu ??= moreMenu(menuOptions);
      menu.setOptions(menuOptions);
      const holder = testid(el('div', 'ap-actions-hold'), 'surface-more');
      const summaries = options.railActions ? el('div', 'ap-rail-summaries') : holder;
      if (summary) {
        const labels = { en: ['Copy update', 'Handoff note'], ru: ['Копировать отчёт', 'Заметка для передачи'], 'zh-CN': ['复制更新', '交接备注'] }[resolveLanguage('auto', vc.env.locale)];
        for (const [i, mode] of (['progress', 'handoff'] as const).entries()) {
          const opener = `summary-open-${mode}`;
          button(summaries, opener, labels[i]!, () => summary.open(mode, opener), mode === 'progress' ? 'default' : 'outline');
        }
      }
      menu.mount(options.railActions ?? holder);
      const head = planHeader(plan, vc.env, 'h2', { picker: options.picker, actions: options.railActions ? null : holder });
      head.dataset.testid = 'surface-header';
      // Rail has no location row. Board keeps location and the gated main-session action.
      const meta = head.querySelector<HTMLElement>('.ap-meta')!;
      meta.replaceChildren();
      if (options.board) {
        meta.append(el('span', '', planLocation(plan, vc.live, vc.env.boundSource, vc.env.locale)), el('span', '', say('Main session', vc.env.locale)));
        const nav = navButton(plan, plan.ownerSessionId, coverageFor(plan.ownerSessionId, plan.directory, vc.live), vc.env); if (nav) meta.append(nav);
      }
      const quiet = quietAge(plan, vc.env);
      if (quiet) meta.append(quiet);
      else if (plan.lifecycle === 'active' && vc.env.now - Date.parse(plan.reportedAt) > 3_600_000) meta.append(age(plan.reportedAt, vc.env, say('Updated ', vc.env.locale)));
      if (plan.sourceId !== vc.env.boundSource) meta.append(warningBadge(say('From another OpenCode setup', vc.env.locale), 'info'));
      if (vc.env.unverifiedSources.has(plan.sourceId)) meta.append(warningBadge(say('OpenCode install not connected', vc.env.locale)));
      const linked = linkedWorkChips(plan, vc.env);
      if (linked) meta.append(linked);
      root.append(head);
      if (summary && options.railActions) (options.railSummaries ?? root).append(summaries);
      const s = summarize(plan, ready);
      root.append(progressBlock(s, false, vc.env.locale));
      const legend = testid(el('p', 'ap-progress-legend'), 'progress-legend');
      // The progress denominator already excludes skipped tasks.
      const pending = ready ? Math.max(0, s.total - s.done - s.working - s.blocked) : 0;
      legend.textContent = s.total > 0 && s.remaining === 0 && !s.skipped ? t.done : [[s.working, t.working], [s.blocked, t.blocked], [pending, t.pending], [s.skipped, t.skipped]].filter(([n]) => Number(n) > 0).map(([n, word]) => `${displayCount(Number(n), vc.env.locale)} ${word}`).join(' · ');
      root.append(legend);
      if (summary) { const preview = summaryBlock(summary, vc.env.locale); if (preview) root.append(preview); }
    }
    const confirmation = cancellation?.confirmation;
    if (confirmation) {
      const copy = cancelCopy(vc.env.locale);
      const box = testid(el('section', 'ap-panel'), 'plan-cancel-confirmation');
      const heading = el('h3', 'ap-h', copy.heading(confirmation.title));
      heading.id = 'ap-plan-cancel-heading';
      box.setAttribute('aria-labelledby', heading.id);
      box.append(heading, el('p', '', copy.explain));
      const actions = el('div', 'ap-row');
      button(actions, 'plan-cancel-keep', copy.keep, confirmation.keep, 'outline', confirmation.pending);
      button(actions, 'plan-cancel-confirm', copy.action, () => { void confirmation.confirm(); }, 'destructive', confirmation.pending);
      box.append(actions);
      if (confirmation.pending) {
        const status = el('p', 'ap-note', copy.pending);
        status.setAttribute('role', 'status'); box.append(status);
      }
      box.addEventListener('keydown', e => {
        if (e.key === 'Escape' && !confirmation.pending) { e.preventDefault(); e.stopPropagation(); confirmation.keep(); }
      });
      root.append(box);
    }
    if (!this.panel) return false;
    const kind = this.panel;
    const box = testid(el('section', 'ap-panel ap-surface-panel'), `surface-panel-${kind}`);
    box.setAttribute('aria-label', t[kind]);
    const back = () => { if (this.key !== key) return; this.setPanel(null); this.focus = kind === 'sessions' ? 'more' : 'settings'; vc.setUi({}); };
    button(box, 'surface-panel-back', t.back, back, 'ghost');
    const h = testid(el('h2', 'ap-h', t[kind]), 'surface-panel-heading'); h.tabIndex = -1;
    box.append(h, options.renderPanel(kind));
    box.addEventListener('keydown', e => { if (e.key === 'Escape' && !e.defaultPrevented && !(e.target as Element).closest('[role="menu"],[role="listbox"]')) { e.preventDefault(); back(); } });
    root.append(box);
    return true;
  }
}

/** Shared List help/filter mount. Map owns its corresponding help control. */
export function listFilters(reading: ReadingView | null, locale: string) {
  const t = shellCopy(locale), box = testid(el('details', 'ap-list-help'), 'list-help-filters');
  box.append(el('summary', '', t.help));
  if (reading) for (const [id, label] of [['all', t.all], ['unfinished', t.unfinished]] as const) {
    const b = button(box, `list-filter-${id}`, label, () => reading.set({ status: id }), 'ghost').querySelector('button');
    b?.setAttribute('aria-pressed', String(reading.status === id));
  }
  return box;
}

export function surfaceViewSwitch(view: DetailView, change: (view: DetailView) => void, locale: string, newHistory = false) {
  const language = resolveLanguage('auto', locale);
  const names = { en: ['Map', 'List', 'Plan view'], ru: ['Карта', 'Список', 'Вид плана'], 'zh-CN': ['依赖图', '列表', '计划视图'] }[language];
  const box = testid(el('div', 'ap-surface-view-switch'), 'plan-view');
  box.setAttribute('role', 'group'); box.setAttribute('aria-label', names[2]!);
  const t = shellCopy(locale);
  const documentLabel = { en: 'Document', ru: 'Документ', 'zh-CN': '文档' }[language];
  for (const [mode, label] of [['map', names[0]!], ['list', names[1]!], ['document', documentLabel], ['history', t.history]] as const) {
    const holder = button(box, `plan-view-${mode}`, label, () => change(mode), view === mode ? 'outline' : 'ghost');
    const b = holder.querySelector('button')!;
    b.setAttribute('aria-pressed', String(view === mode)); b.setAttribute('data-map-focus-owner', '');
    if (mode === 'history' && newHistory) {
      b.setAttribute('aria-label', { en: 'History, new revisions', ru: 'История, новые версии', 'zh-CN': '历史，有新版本' }[language]);
      const dot = testid(el('span', 'ap-history-dot'), 'history-new'); dot.setAttribute('aria-hidden', 'true'); b.append(dot);
    }
  }
  return box;
}

export function documentView(owner: HTMLElement, locale: string, back: () => void, documentBlock: HTMLElement, comparison?: HTMLElement) {
  const box = testid(el('section', 'ap-document-view'), 'document-view');
  const head = el('header', 'ap-document-heading');
  button(head, 'document-back', shellCopy(locale).back, back, 'ghost');
  const fallback = { en: 'Document', ru: 'Документ', 'zh-CN': '文档' }[resolveLanguage('auto', locale)];
  const title = testid(el('h3', 'ap-doc-title', documentBlock.dataset.captureName || fallback), 'document-heading');
  title.tabIndex = -1;
  head.append(title);
  box.append(head, documentBlock);
  if (comparison) box.append(comparison);
  owner.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || event.defaultPrevented || (event.target as Element).closest('[role="menu"],[role="listbox"]')) return;
    event.preventDefault(); back();
  });
  return box;
}

/**
 * The rail's title-picker: the SDK select, shown as "⌄ 1 of 3" beside the plan title. Its name
 * says which plan of how many is shown; every option keeps its full title in the popup.
 */
export function planPicker(o: { title: string; index: number; count: number; incomplete?: boolean; value: string; options: SelectOption[]; onChange: (key: string) => void; standalone?: boolean; locale?: string }) {
  const count = o.incomplete ? `${displayCount(o.count, resolveLanguage('auto', o.locale ?? 'en'))}+` : o.count;
  const holder = testid(el('div', 'ap-picker ap-title-picker'), 'plan-selector');
  mountSelect(holder, { label: say('{n} plans', o.locale, { n: count }), value: o.value, options: o.options, onChange: o.onChange });
  const trigger = holder.querySelector<HTMLButtonElement>('.oc-sdk-trigger');
  if (trigger) {
    trigger.removeAttribute('aria-labelledby');
    trigger.setAttribute('aria-label', say('Plan {index} of {count}: {title}. Choose another plan', o.locale, { index: o.index, count, title: o.title }));
    trigger.prepend(el('span', 'ap-title-picker-hint', `${o.standalone ? say('Plan ', o.locale) : ''}${say('{index} of {count}', o.locale, { index: o.index, count })}`));
  }
  return holder;
}

const assigneeOf = (item: ItemView, detail: PlanDetail) => item.assigneeSessionId ?? detail.links.find((l) => l.itemIds.includes(item.id))?.sessionId;

/** The participant filter of one paint, with the plan's recorded relationships. */
interface Attribution { filter: ParticipantFilter; index: ParticipantIndex }

const RELATION_TEXT: Record<Relation, CopyKey> = {
  assigned: 'Assigned to this session',
  direct: 'Reported directly by this session',
  'direct-attributed': 'Direct report attributed to this session',
  'relayed-for': 'Reported for this session',
  'relayed-by': 'Relayed by this session',
  reporter: 'Recorded reporter · report mode unavailable',
  linked: 'Linked to this session · not an assignment',
};

/** Why a matching row matches the participant filter: every recorded relationship, once each. */
function reasonsLine(item: ItemView, who: Attribution, locale: InterfaceLanguage) {
  const relations = relationsOf(who.index, item.id, who.filter);
  const line = testid(el('span', 'ap-reasons'), `reasons-${item.id}`);
  line.dataset.relations = who.filter.kind === 'none' ? 'none' : relations.join(' ');
  if (who.filter.kind === 'none') line.append(el('span', '', say('No participant recorded', locale)));
  for (const r of relations) line.append(el('span', '', say(RELATION_TEXT[r], locale)));
  return line;
}

/**
 * Session names from the current host only for a plan of the verified bound source; a foreign or
 * unverified same-ID session keeps a plain recorded-session label.
 */
export function recordedLabel(plan: PlanView, env: Env) {
  const live = trustedSource(plan, env) ? env.live : EMPTY_LIVE;
  return (id: string) => sessionLabel(id, live, env.locale);
}

const participantKey = (f: ParticipantFilter) => (f.kind === 'session' ? `s:${f.sessionId}` : f.kind);
/** The filter as words, for the summary and the empty state. */
const participantText = (f: ParticipantFilter, label: (id: string) => string, locale: InterfaceLanguage) => (f.kind === 'session' ? label(f.sessionId) : f.kind === 'none' ? say('no participant recorded', locale) : '');

/**
 * Participant choice: All participants, every session this plan records (owner, assignees,
 * links, reporters and attributed sessions, including report-only ones) and No participant
 * recorded. A chosen session the plan no longer records stays chosen, marked unavailable.
 */
function participantSelect(plan: PlanView, reading: ReadingView, who: Attribution, label: (id: string) => string, locale: InterfaceLanguage) {
  const { index, filter } = who;
  const tasks = (n: number) => taskCount(n, locale);
  const options: SelectOption[] = [{ id: 'all', label: say('All participants', locale) }];
  for (const id of index.sessions) options.push({ id: `s:${id}`, label: label(id), hint: `${id === plan.ownerSessionId ? say('main session · ', locale) : ''}${tasks(index.taskCount.get(id) ?? 0)}` });
  const missing = filter.kind === 'session' && !index.sessions.includes(filter.sessionId);
  if (missing) options.push({ id: `s:${filter.sessionId}`, label: label(filter.sessionId), hint: say('no longer recorded', locale) });
  options.push({ id: 'none', label: say('No participant recorded', locale), hint: tasks(index.unknownCount) });
  const holder = testid(el('div', 'ap-focus-participant'), 'focus-participant');
  holder.dataset.participant = participantKey(filter);
  holder.dataset.available = String(!missing);
  mountSelect(holder, {
    label: say('Participant', locale), value: participantKey(filter), options,
    onChange: (id) => reading.set({ participant: id === 'all' || id === 'none' ? { kind: id } : { kind: 'session', sessionId: id.slice(2) } }),
  });
  return holder;
}

/** Every task filter back to its default (Show all, All participants, no state chip). */
const CLEARED = { status: 'all', participant: ALL_PARTICIPANTS, state: null } as const;

/** Plan article of the current paint that holds `control`, for this exact plan, source and revision. */
function articleOf(control: HTMLElement, plan: PlanView) {
  const article = control.closest<HTMLElement>('article.ap-plan');
  return article?.isConnected && article.dataset.testid === `plan-${plan.id}` && article.dataset.source === plan.sourceId && article.dataset.revision === String(plan.revision) ? article : null;
}

/** Expand all / Collapse all: every task disclosure of this plan (filtered branches too), nothing else. */
function setDisclosures(control: HTMLElement, plan: PlanView, reading: ReadingView, open: boolean) {
  const article = articleOf(control, plan);
  if (!article || !reading.current()) return;
  reading.remember({ doneOpen: open, skippedOpen: open });
  for (const d of article.querySelectorAll<HTMLDetailsElement>('ul.ap-items details.ap-group, ul.ap-items details.ap-fold')) if (d.open !== open) d.open = open;
}

const JUMP_COPY: Record<JumpKind, { active: [CopyKey, CopyKey, CopyKey]; closed: [CopyKey, CopyKey, CopyKey] }> = {
  // [button with targets, button without, notice prefix]
  working: { active: ['Jump to in progress', 'No tasks in progress', 'In progress'], closed: ['Jump to reported in progress', 'No tasks reported in progress', 'Reported in progress'] },
  blocked: { active: ['Jump to blocked', 'No blocked tasks', 'Blocked'], closed: ['Jump to reported blocked', 'No tasks reported blocked', 'Reported blocked'] },
};

/** Next reported working/blocked task of the whole plan, in hierarchy order, wrapping. */
function jump(control: HTMLElement, plan: PlanView, kind: JumpKind, targets: ItemView[], reading: ReadingView, label: CopyKey) {
  const article = articleOf(control, plan);
  const state = reading.current();
  const next = article && state ? nextJump(targets, state.cursor[kind]) : null;
  if (!article || !state || !next) return;
  reading.remember({ cursor: { ...state.cursor, [kind]: next.item.id } });
  revealTask(article, plan, next.item.id, locale => `${say(label, locale)}${targets.length > 1 ? ` ${say('{index} of {count}', locale, { index: next.index + 1, count: targets.length })}` : ''}: ${next.item.title}`);
}

/** Session facts the host reports, named in the interface language. */
const HOST_LINK_LABELS: Record<InterfaceLanguage, { agent: string; issue: string; change: string; more: string }> = {
  en: { agent: 'Host-reported agent', issue: 'Host-linked issue', change: 'Host-linked change', more: 'More links are available in the host.' },
  ru: { agent: 'Агент по данным хоста', issue: 'Задача, связанная в хосте', change: 'Изменение, связанное в хосте', more: 'В хосте есть другие связи.' },
  'zh-CN': { agent: '宿主报告的智能体', issue: '宿主关联的问题', change: '宿主关联的变更', more: '宿主中还有更多关联。' },
};

const LINKED_WORK_COPY: Record<InterfaceLanguage, { label: string; more: string }> = {
  en: { label: 'Linked in OpenChamber', more: 'and more' },
  ru: { label: 'Связано в OpenChamber', more: 'и другие' },
  'zh-CN': { label: 'OpenChamber 中的关联', more: '还有更多' },
};
let linkedWorkIds = 0;

/**
 * Header chips for the selected plan's own main session: only its verified, unambiguous current
 * host session (never the visible chat or a participant), and only links with an admitted address.
 * Titles stay literal text; activation hands the address to the host opener, nothing else.
 */
export function linkedWorkChips(plan: PlanView, env: Env): HTMLElement | null {
  const open = env.openLinkedWorkUrl;
  if (!open || !trustedSource(plan, env) || env.unverifiedSources?.has(plan.sourceId)) return null;
  const cov = coverageFor(plan.ownerSessionId, plan.directory, env.live);
  if (cov.kind !== 'live') return null;
  const links = (cov.session.links ?? []).filter((link): link is typeof link & { url: string } => typeof link.url === 'string' && !!link.url);
  if (!links.length) return null;
  const copy = LINKED_WORK_COPY[env.locale], kinds = HOST_LINK_LABELS[env.locale];
  const group = testid(el('span', 'ap-work-links'), 'linked-work');
  const label = el('span', 'ap-work-links-label', copy.label);
  label.id = `ap-linked-work-${++linkedWorkIds}`;
  group.setAttribute('role', 'group');
  group.setAttribute('aria-labelledby', label.id);
  group.append(label);
  for (const link of links) {
    const b = testid(el('button', 'ap-work-link'), 'linked-work-link');
    b.type = 'button';
    b.dataset.kind = link.kind;
    // Focus identity across repaints: the admitted address this chip opens, so a repaint can
    // return focus only to a chip that opens the same address, never to a sibling.
    b.dataset.focusKey = link.url;
    // The visible title is shortened only by CSS; the spoken name keeps the kind and full title.
    b.title = link.title;
    b.append(icon(link.kind), el('span', 'ap-sr', `${kinds[link.kind]}: `), el('span', 'ap-work-link-title', link.title));
    const url = link.url;
    b.addEventListener('click', () => open(url));
    group.append(b);
  }
  if (cov.session.moreLinks) group.append(testid(el('span', 'ap-work-links-more', copy.more), 'linked-work-more'));
  return group;
}

/**
 * Who is involved. `compact`: one footer row for the main session (live state and a verified Open),
 * and a count of the other sessions, whose full facts are in the Sessions panel (⋯ → Sessions).
 * The full list carries no heading of its own: the Sessions panel that holds it is the one heading.
 */
export function peopleBlock(plan: PlanView, detail: PlanDetail | null, env: Env, compact = false, openAll?: () => void) {
  const list = participants(plan, detail);
  const section = testid(el('section', compact ? 'ap-section ap-sessions' : 'ap-section'), 'contributors');
  const wrap = el('div', 'ap-people');
  for (const p of compact ? list.slice(0, 1) : list) {
    const { cov, node } = sessionChip(plan, p.sessionId, env);
    const row = testid(el('div', 'ap-person'), `contributor-${p.sessionId}`);
    row.dataset.role = p.role;
    row.append(node, navButton(plan, p.sessionId, cov, env) ?? el('span'));
    const facts = [say(p.role === 'main' ? 'Main session' : 'Child session', env.locale)];
    if (p.assigned) facts.push(say('{n} assigned', env.locale, { n: p.assigned }));
    if (p.relayed) facts.push(say('reports relayed by the main session', env.locale));
    row.append(el('span', 'ap-small ap-muted', facts.join(' · ')));
    if (!compact && trustedSource(plan, env) && cov.kind === 'live') {
      const host = cov.session;
      const labels = HOST_LINK_LABELS[env.locale];
      if (host.agent) row.append(testid(el('p', 'ap-small ap-muted', `${labels.agent}: ${host.agent}`), 'session-host-agent'));
      for (const link of host.links ?? []) row.append(testid(el('p', 'ap-small ap-muted', `${labels[link.kind]}: ${link.title}`), 'session-host-link'));
      if (host.moreLinks) row.append(el('p', 'ap-small ap-muted', labels.more));
    }
    wrap.append(row);
  }
  section.append(wrap);
  if (compact && list.length > 1 && openAll) {
    const more = testid(el('button', 'ap-link ap-sessions-more', moreSessions(list.length - 1, env.locale)), 'sessions-more');
    more.type = 'button';
    more.addEventListener('click', openAll);
    section.append(more);
  }
  return section;
}

/** Plain loading/error line for an on-demand part of a view. */
export function partState(id: string, what: string, value: Loadable<unknown> | null, retry?: () => void, locale: InterfaceLanguage = 'en') {
  const slot = testid(el('div', 'ap-row ap-note'), id);
  slot.setAttribute('role', 'status');
  if (!value || value.state === 'loading') {
    mountSpinner(slot, { size: 'sm', label: say('Loading {what}', locale, { what }) });
  } else if (value.state === 'error') {
    slot.append(el('span', '', say('{what} could not be loaded. {failure}.', locale, { what: `${what[0].toUpperCase()}${what.slice(1)}`, failure: failureCopy(value.failure.kind, locale).title })));
    if (retry) {
      const b = el('button', 'ap-link', say('Try again', locale));
      b.type = 'button';
      b.addEventListener('click', retry);
      slot.append(b);
    }
  }
  return slot;
}

/**
 * Read-only captured document, fetched on demand, without loading document assets.
 * A retained earlier capture stays readable when the latest read failed.
 */
export function documentBlock(plan: PlanView, env: Env, mode: 'disclosure' | 'inline', doc: { get: () => Loadable<DocumentBody> | null; request: () => void }) {
  const ref = plan.document;
  const wrap = testid(el(mode === 'disclosure' ? 'details' : 'section', 'ap-doc'), `document-${plan.id}`);
  wrap.dataset.state = ref.state;
  const label = `${say('Plan document', env.locale)}${ref.path ? ` · ${baseName(ref.path)}` : ''}`;
  if (mode === 'disclosure') wrap.append(el('summary', '', label));
  if (ref.state === 'unbound') { wrap.append(el('p', 'ap-note', documentStateText('unbound', env.locale))); return wrap; }
  if (ref.state !== 'captured') wrap.append(testid(el('p', 'ap-doc-warn', documentStateText(ref.state, env.locale)), 'document-state'));
  if (ref.captureId === undefined) {
    if (ref.state !== 'captured') wrap.append(el('p', 'ap-note', say('No earlier capture is available.', env.locale)));
    return wrap;
  }
  const body = el('div', 'ap-doc-body');
  const fill = () => {
    body.replaceChildren();
    const value = doc.get();
    if (!value || value.state !== 'ready') { body.append(partState('document-loading', say('the document', env.locale), value, doc.request, env.locale)); return; }
    const d = value.value;
    if (d.ref.path) wrap.dataset.captureName = baseName(d.ref.path);
    if (d.text === null) { body.append(el('p', 'ap-note', say('The captured text is not available.', env.locale))); return; }
    const tokens = isMarkdownDocument(d.ref.path) ? parseDocumentMarkdown(d.text) : null;
    const preview = testid(tokens ? el('div', 'ap-doc-markdown') : el('pre'), 'document-text');
    preview.tabIndex = 0;
    preview.dataset.scrollKey = `doc-${plan.key}-${d.captureId ?? d.ref.captureId ?? ''}`;
    if (tokens) renderDocumentMarkdown(preview, tokens, env.locale, env.openDocumentUrl);
    else preview.textContent = d.text;
    if (d.historical) body.append(testid(el('p', 'ap-doc-warn', say('A newer capture was recorded while this loaded. This is the earlier capture.', env.locale)), 'document-historical'));
    const language = resolveLanguage('auto', env.locale);
    const labels = {
      en: ['Saved ', 'Last good capture · ', 'Current file not rechecked', 'Task list confirmed', 'Not the current file'],
      ru: ['Сохранено ', 'Последний успешный снимок · ', 'Текущий файл не перепроверен', 'Список задач сверен', 'Не текущий файл'],
      'zh-CN': ['保存于', '上次成功采集 · ', '当前文件未复查', '任务列表已确认', '不是当前文件'],
    }[language];
    const note = el('p', 'ap-note ap-doc-facts');
    if (d.ref.capturedAt) note.append(age(d.ref.capturedAt, env, ref.state === 'captured' ? labels[0] : labels[1], true));
    if (d.ref.checklistSynchronized) note.append(el('span', '', labels[3]));
    note.append(el('span', '', ref.state === 'captured' ? labels[2] : labels[4]));
    body.append(note);
    body.append(preview);
  };
  if (mode === 'disclosure') {
    wrap.addEventListener('toggle', () => {
      if ((wrap as HTMLDetailsElement).open) { if (wrap.dataset.languageRestore !== 'true') doc.request(); fill(); }
      else delete wrap.dataset.languageRestore;
    });
    if (doc.get()) fill();
  } else { if (!doc.get()) doc.request(); fill(); }
  wrap.append(body);
  return wrap;
}

/** Task-reading state of each painted plan article (planDetail), for in-detail navigation. */
const READINGS = new WeakMap<Element, ReadingView>();

/**
 * Local in-detail navigation: reveal and focus the canonical task row of the plan article that
 * holds the control. A control from a replaced paint (detached) or another plan, source or
 * revision does nothing. No route, request or session action.
 */
function showTask(control: HTMLElement, plan: PlanView, itemId: string) {
  const article = articleOf(control, plan);
  if (article) revealTask(article, plan, itemId, '');
}

/**
 * The one navigation path (prerequisite links, jumps, History and search hand-offs). It searches
 * the whole plan: a target a task filter hides clears every task filter once and is revealed after
 * that repaint, announced as such. Opens its fold and ancestors, focuses the row and scrolls it
 * into view once, instantly.
 */
function revealTask(article: HTMLElement, plan: PlanView, itemId: string, message: string | ((locale: InterfaceLanguage) => string), afterReveal?: (article: HTMLElement) => void) {
  const locale = resolveLanguage('auto', article.dataset.locale ?? 'en');
  const target = [...article.querySelectorAll<HTMLElement>('[data-testid^="item-"]')].find((n) => n.tagName === 'LI' && n.dataset.testid === `item-${itemId}`);
  const notice = article.querySelector<HTMLElement>('[data-testid="focus-notice"]');
  if (!target) { if (notice) notice.textContent = say('That task is no longer shown in this plan.', locale); return; }
  const reading = READINGS.get(article);
  // A row kept only as context, or a blocker kept in view, is not a filter match either, so an
  // explicit reveal shows the whole plan again (a matching target keeps the filters).
  if (target.closest('[hidden]') || target.dataset.focus === 'context' || target.dataset.focus === 'retained') {
    if (!reading) return;
    reading.set(CLEARED, (root) => {
      const next = [...root.querySelectorAll<HTMLElement>('article.ap-plan')].find((a) => a.dataset.testid === article.dataset.testid && a.dataset.source === article.dataset.source && a.dataset.revision === article.dataset.revision);
      if (next) revealTask(next, plan, itemId, locale => `${say('Showing all tasks so this task is visible.', locale)}${message ? ` ${typeof message === 'function' ? message(locale) : message}` : ''}`, afterReveal);
    });
    return;
  }
  if (notice) notice.textContent = '';
  // Opening a Done/Skipped fold records it in the reading (its toggle listener), so it stays open.
  for (let d = target.parentElement?.closest('details'); d && article.contains(d); d = d.parentElement?.closest('details')) if (!d.open) d.open = true;
  target.dataset.navTarget = '';
  target.addEventListener('blur', () => { delete target.dataset.navTarget; }, { once: true });
  target.focus({ preventScroll: true });
  target.scrollIntoView({ block: 'center', behavior: 'instant' });
  if (notice && message) notice.textContent = typeof message === 'function' ? message(locale) : message;
  afterReveal?.(article);
}

/**
 * History's "View current task": the same canonical reveal path, inside this plan's painted reading
 * article (same plan ID, source and revision), never a same-ID task elsewhere.
 * The optional completion runs after task focus, including a filter-clearing repaint.
 */
export function revealCurrentTask(article: HTMLElement, plan: PlanView, itemId: string, message: string, afterReveal?: (article: HTMLElement) => void) {
  if (articleOf(article, plan)) revealTask(article, plan, itemId, message, afterReveal);
}

function navLink(plan: PlanView, itemId: string, text: string, name: string) {
  const b = el('button', 'ap-link ap-ready-link', text);
  b.type = 'button';
  b.setAttribute('aria-label', name);
  b.dataset.target = itemId;
  b.addEventListener('click', () => showTask(b, plan, itemId));
  return b;
}

/** Status glyph whose meaning is spoken by the adjacent status text instead. */
const quietGlyph = (status: ItemView['status'], locale: InterfaceLanguage) => statusMark(status, { decorative: true, className: 'ap-glyph', locale });

function prerequisiteRow(plan: PlanView, p: Prerequisite, locale: InterfaceLanguage) {
  const li = el('li', 'ap-ready-dep');
  li.dataset.dep = p.id;
  li.dataset.depState = p.kind === 'task' ? p.status : p.kind;
  if (p.kind === 'task') li.append(quietGlyph(p.status, locale), navLink(plan, p.id, p.title, say('Show prerequisite: {title}', locale, { title: p.title })), el('span', 'ap-muted', statusLabel(p.status, locale)));
  else if (p.kind === 'not-task') li.append(el('span', 'ap-ready-ref', p.title), el('span', 'ap-doc-warn', say('A group, not a task: it can’t count as done', locale)));
  else li.append(el('code', 'ap-ready-ref', p.id), el('span', 'ap-doc-warn', say('Prerequisite task unavailable', locale)));
  return li;
}

const CATEGORY_LABEL: Record<BlockerCategory, CopyKey> = { decision: 'Decision', dependency: 'Dependency', review: 'Review', external: 'External', other: 'Other' };

/** The reported wait category as a label, never a filter; an unrecognized one stays unknown. */
function categoryTag(item: ItemView, locale: InterfaceLanguage) {
  const category = item.reportedBlocker?.state === 'reported' ? item.reportedBlocker.category : null;
  const known = category && category !== 'unclassified' ? category : null;
  const tag = testid(el('span', 'ap-ny-cat'), `needs-you-category-${item.id}`);
  tag.dataset.category = known ?? (category === 'unclassified' ? 'unclassified' : 'unknown');
  tag.append(el('span', 'ap-sr', say('Wait category: ', locale)), say(known ? CATEGORY_LABEL[known] : 'Category unknown', locale));
  if (category === 'unclassified') tag.title = say('The report used a category this version doesn’t recognize.', locale);
  return tag;
}

/**
 * How long the task has been reported blocked, from the reply's blocked timing anchored to the
 * service clock and advanced by the frame's label ticker (refreshLabels). Unknown and unavailable
 * never read as zero; this is reported status, not real-world waiting or activity. `hook`: the
 * row's expanded facts carry the test hook; its one-line copy on the collapsed row does not.
 */
function blockedWaitLabel(item: ItemView, detail: PlanDetail, env: Env, hook = true) {
  const w = blockedWait(detail, item);
  if (w.kind === 'unknown' || w.kind === 'unavailable') {
    const s = el('span', 'ap-elapsed', say(w.kind === 'unknown' ? 'Unknown' : 'Unavailable', env.locale));
    if (hook) testid(s, `blocked-elapsed-${item.id}`);
    s.dataset.kind = 'unknown';
    s.dataset.timing = w.kind;
    s.dataset.elapsedUnknown = w.kind;
    s.title = say(w.kind === 'unknown' ? 'The progress service couldn’t tell when this task was reported blocked.' : 'This progress service doesn’t report waiting times.', env.locale);
    return s;
  }
  const a = w.anchor;
  const t = el('time', 'ap-elapsed');
  if (hook) testid(t, `blocked-elapsed-${item.id}`);
  t.dateTime = a.since;
  Object.assign(t.dataset, { kind: a.kind, timing: a.kind, elapsed: String(a.elapsedAtRead), received: String(a.receivedAt) });
  const at = absoluteTime(a.since, env.locale);
  t.dataset.blockedTime = '';
  t.title = say(a.kind === 'exact' ? 'Reported blocked at {at}. Counts reported status, not activity.' : 'Already reported blocked at {at}; the start is earlier and unknown.', env.locale, { at });
  t.textContent = elapsedLabelText(a.kind, elapsedAt(a, env.mono), env.locale);
  return t;
}

/** What an empty Needs you may claim: only a current read with capture on is "no reported blockers". */
const NEEDS_YOU_EMPTY: Record<Extract<Attention, { state: 'ready' }>['qualifier'], CopyKey> = {
  current: 'No reported blockers.',
  stale: 'No reported blockers in the last successful read. This may be out of date.',
  'capture-off': 'No reported blockers were recorded. Capture is off, so newer reports aren’t recorded.',
};
const INVALID_COPY: Record<InvalidReason, CopyKey> = {
  'duplicate-id': 'two tasks share an ID',
  'self-dependency': 'a task lists itself as a prerequisite',
  cycle: 'some tasks list each other as prerequisites',
};

export interface DetailHooks {
  detail: Loadable<PlanDetail> | null;
  activity?: PlanActivityView | null;
  summary?: SummaryView | null;
  retryDetail?: () => void;
  document: { get: () => Loadable<DocumentBody> | null; request: () => void };
}

/** One painted plan detail: everything a row, chip or panel needs, computed once per paint. */
interface Paint {
  plan: PlanView;
  detail: PlanDetail;
  env: Env;
  proj: ProgressProjection;
  reading: ReadingView | null;
  compareSession: string | null;
  byId: Map<string, ItemView>;
  entries: Map<string, ReadinessEntry>;
  /** Unlocks next per task; only for an active plan with valid recorded dependencies. */
  unlocks: ReadonlyMap<string, ReadonlySet<string>> | null;
  who: Attribution | null;
  label: (id: string) => string;
  trusted: boolean;
  /** Waiting-delegation notes of this paint (intent.ts); display only. Absent: none. */
  intent?: CurrentIntent;
}

/** Group titles: guidance for an active plan's complete valid detail, reported statuses otherwise. */
const GROUP_TITLE: Record<ProgressSection, [guided: CopyKey, reported: CopyKey]> = {
  now: ['Now', 'Reported working'],
  // Every reported blocker; only decision/review waits are Needs you (the source-wide inbox).
  'needs-you': ['Blocked', 'Reported blocked'],
  'up-next': ['Up next', 'Pending'],
  done: ['Done', 'Done'],
  skipped: ['Skipped', 'Skipped'],
};

/** Chip words, in display order. A chip is a whole-plan count, never a filtered total. */
const CHIP_WORD: [ProgressState, CopyKey, CopyKey][] = [
  // [state, guided word, reported word]
  ['working', 'in progress', 'in progress'],
  ['blocked', 'blocked', 'blocked'],
  ['ready', 'ready', 'ready'],
  ['waiting', 'waiting', 'waiting'],
  ['pending', 'pending', 'pending'],
  ['done', 'done', 'done'],
  ['skipped', 'skipped', 'skipped'],
];
const STATE_WORD: Record<ProgressState, CopyKey> = { working: 'In progress', blocked: 'Blocked', ready: 'Ready to start', waiting: 'Waiting on prerequisites', pending: 'Pending', done: 'Done', skipped: 'Skipped' };

/** Frame-local, never stored: which ⓘ explanations and plan panels are open, and a task copy preview. */
const openInfo = new Set<string>();
// Handles belong to a DOM paint, not to its persistent open-state key. Keep the
// current owner after commit too: task facts can create explanations on toggle.
let infoPaint: HTMLElement | null = null;
const infoHandles = new Map<HTMLElement | null, Set<InfoHandle>>();
export function beginInfoPaint(root: HTMLElement) { infoPaint = root; infoHandles.set(root, new Set()); }
/** Called after replacement, before focus restoration. Disposing is not a user close. */
export function commitInfoPaint(root: HTMLElement) {
  for (const [owner, handles] of infoHandles) if (owner !== root) {
    for (const handle of handles) handle.dispose();
    infoHandles.delete(owner);
  }
}
/** Release an in-place subtree before removing it; open-state keys remain reading-local. */
export function disposeInfoWithin(root: HTMLElement) {
  for (const handles of infoHandles.values()) for (const handle of handles) {
    if (!root.contains(handle.root)) continue;
    handle.dispose();
    handles.delete(handle);
  }
}
type PanelKind = 'task-view' | 'document' | 'sessions';
let panel: { plan: string; kind: PanelKind } | null = null;
let copy: { plan: string; item: string; generation: number; status: 'copied' | 'failed' | ''; text?: string } | null = null;
let copyGeneration = 0;
let readingEpoch = 0;
/** Called by the reading owner, including transitions that never paint a plan detail. */
export function retireReadingUi() {
  readingEpoch++;
  for (const handles of infoHandles.values()) for (const handle of handles) handle.dispose();
  infoHandles.clear();
  infoPaint = null;
  openInfo.clear();
  panel = null;
  copy = null;
}

/** An ⓘ explanation whose open state survives this frame's repaints (same key), never stored. */
export function info(key: string, label: string, content: string | string[] | Node) {
  const epoch = readingEpoch;
  const owner = infoPaint;
  const h = infoDisclosure({ label, content, open: openInfo.has(key), onToggle: (open) => { if (epoch !== readingEpoch || owner !== infoPaint) return; if (open) openInfo.add(key); else openInfo.delete(key); } });
  h.root.dataset.info = key;
  let handles = infoHandles.get(infoPaint);
  if (!handles) infoHandles.set(infoPaint, handles = new Set());
  handles.add(h);
  return h.root;
}

/** Repaint this reading, then run `then` once on the new root. */
const repaint = (p: Paint, then?: (root: HTMLElement) => void) => p.reading?.set({}, then);
const articleIn = (root: HTMLElement, plan: PlanView) => [...root.querySelectorAll<HTMLElement>('article.ap-plan[data-reading]')].find((a) => a.dataset.testid === `plan-${plan.id}` && a.dataset.source === plan.sourceId) ?? null;
const focusIn = (plan: PlanView, selector: string) => (root: HTMLElement) => articleIn(root, plan)?.querySelector<HTMLElement>(selector)?.focus({ preventScroll: true });

/** State chips: legend and filter (one state at a time; choosing it again clears it). Zero chips are absent. */
function stateChipRow(p: Paint) {
  const { proj, reading } = p;
  const selected = reading?.state ?? null;
  const chips = CHIP_WORD.map(([state, guided, reported]) => stateChip({
    state, count: proj.counts.get(state) ?? 0, label: say(proj.guidance ? guided : reported, p.env.locale), pressed: selected === state, locale: p.env.locale,
    onToggle: reading ? () => reading.set({ state: selected === state ? null : state }, focusIn(p.plan, `[data-testid="state-chip"][data-state="${state}"]`)) : undefined,
  }));
  const group = stateChips(say('Filter tasks by state', p.env.locale), chips);
  if (!group) return null;
  const row = el('div', 'ap-chip-row');
  row.append(group);
  // The explanation follows the last chip in the same wrapping flow.
  group.append(info(`${p.plan.key}|counts`, say('About these counts', p.env.locale), (proj.guidance
    ? ['Counts cover every task in this plan, whatever filter is shown.', 'Ready and waiting come from recorded prerequisites only. Other prerequisites may not be recorded, and “No prerequisites recorded” doesn’t mean there are none. Ready is not permission to start.', 'Blocked lists every task reported as blocked. Each stays there until an agent reports otherwise; a wait can be for another session or person. Needs you shows only reported decision and review waits.'] as const
    : ['Counts cover every task in this plan, whatever filter is shown. They are the statuses last reported; a closed plan, or one whose recorded prerequisites can’t be read, gets no ready or waiting advice.'] as const).map(key => say(key, p.env.locale))));
  return row;
}

/** Concrete qualifications, always visible as compact lines (never behind ⓘ). */
function qualifiers(p: Pick<Paint, 'proj' | 'plan' | 'env'>) {
  const box = testid(el('div', 'ap-quals'), 'progress-qualifiers');
  const r = p.proj.readiness;
  box.dataset.readiness = r.state;
  if (r.state === 'invalid') { box.dataset.reason = r.reason; box.append(testid(warningLine(say('Readiness is unavailable for this report: {reason}. The tasks are shown as reported.', p.env.locale, { reason: say(INVALID_COPY[r.reason], p.env.locale) })), 'readiness-invalid')); }
  if (r.state !== 'ready') return box;
  const a = attention(r, p.env.view) as Extract<Attention, { state: 'ready' }>;
  box.dataset.qualifier = a.qualifier;
  if (!p.env.view.fresh) { box.dataset.stale = 'true'; box.append(testid(warningLine(say('Last reported readiness. It may be out of date and isn’t a current recommendation.', p.env.locale)), 'readiness-stale')); }
  if (!a.rows.length && a.qualifier !== 'current') box.append(testid(warningLine(say(NEEDS_YOU_EMPTY[a.qualifier], p.env.locale)), 'needs-you-empty'));
  else if (a.rows.length && a.qualifier === 'capture-off') box.append(testid(warningLine(say('Capture is off: these are the last reported blockers, not current guidance.', p.env.locale)), 'needs-you-qualifier'));
  if (r.incomplete) box.append(testid(warningLine(say('Some recorded prerequisites aren’t in this plan, so the tasks that need them can’t be shown as ready.', p.env.locale)), 'readiness-incomplete'));
  return box;
}

/** The filter line: what an active filter shows, kept blockers counted apart, and one Clear. */
function filterLine(p: Paint) {
  const { proj, reading } = p;
  const line = testid(el('div', 'ap-filter-line'), 'focus-summary');
  const tasks = [...proj.rows.values()].filter((r) => r.item.kind === 'task').length;
  Object.assign(line.dataset, { rows: String(tasks), matching: String(proj.matching), retained: String(proj.retained), context: String(proj.context), hidden: String(proj.hidden) });
  if (!proj.filtered || !reading) return line;
  const parts: string[] = [];
  if (reading.state) parts.push(`${say(STATE_WORD[reading.state], p.env.locale)}${(proj.counts.get(reading.state) ?? 0) === 0 ? say(' (no tasks have this state now)', p.env.locale) : ''}`);
  if (reading.status === 'unfinished') parts.push(say('Unfinished', p.env.locale));
  if (reading.participant.kind !== 'all' && p.who) parts.push(reading.participant.kind === 'none' ? say('No participant recorded', p.env.locale) : say('Participant {name}', p.env.locale, { name: participantText(reading.participant, p.label, p.env.locale) }));
  const text = el('span', 'ap-filter-text', say('{filter}: {matching} of {tasks}', p.env.locale, { filter: parts.join(' · '), matching: proj.matching, tasks: taskCount(tasks, p.env.locale) }));
  line.append(text);
  if (proj.retained) line.append(el('span', 'ap-filter-kept', say('{tasks} kept in view', p.env.locale, { tasks: countText(proj.retained, 'blocked', p.env.locale) })));
  if (proj.context) line.append(el('span', 'ap-muted', say('{n} shown for context', p.env.locale, { n: proj.context })));
  button(line, 'focus-clear-filters', say('Clear filters', p.env.locale), () => clearFilters(p), 'ghost');
  return line;
}

/** Clear every task filter; the button leaves, so focus goes to the Tasks heading once with a short notice. */
function clearFilters(p: Paint) {
  p.reading?.set(CLEARED, (root) => {
    const active = document.activeElement;
    if (!document.hasFocus() || (active && active !== document.body)) return;
    const article = articleIn(root, p.plan);
    const heading = article?.querySelector<HTMLElement>('.ap-tasks-h');
    if (!heading) return;
    heading.focus({ preventScroll: true });
    const notice = article!.querySelector<HTMLElement>('[data-testid="focus-notice"]');
    if (notice) notice.textContent = say('Task filters cleared, so focus moved to Tasks.', resolveLanguage('auto', article!.dataset.locale ?? 'en'));
  });
}

/** No task matches: full counts and controls stay; kept blockers stay listed; one action clears. */
function noMatches(p: Paint) {
  const box = testid(el('div', 'ap-focus-empty'), 'focus-empty');
  box.append(el('p', '', say(p.proj.retained ? 'No tasks match the filter. Blocked tasks stay listed below.' : 'No tasks match the filter.', p.env.locale)));
  const f = p.reading?.participant;
  if (f?.kind === 'session' && p.who && !p.who.index.sessions.includes(f.sessionId)) box.append(el('p', 'ap-note', say('This plan no longer records {name} on any task.', p.env.locale, { name: participantText(f, p.label, p.env.locale) })));
  box.append(el('p', 'ap-note', say('They are still in the plan, and the counts above cover every task.', p.env.locale)));
  button(box, 'focus-clear', say('Clear task filters', p.env.locale), () => clearFilters(p), 'outline');
  return box;
}

/** The right-hand line of a collapsed row: elapsed, reported wait, readiness word. */
function rowMeta(p: Paint, row: ProgressRow) {
  const { item } = row;
  const meta = el('span', 'ap-trow-meta');
  if (item.status === 'working') { const e = elapsedLabel(p.plan, item, p.detail, p.env); if (e) meta.append(e); }
  else if (item.status === 'blocked' && p.proj.guidance) meta.append(categoryTag(item, p.env.locale), blockedWaitLabel(item, p.detail, p.env, false));
  else if (row.state === 'ready') { const w = el('span', 'ap-trow-ready', say('Ready', p.env.locale)); w.setAttribute('aria-hidden', 'true'); meta.append(w); }
  else if (row.state === 'waiting') {
    const open = (item.dependencies ?? []).filter((id) => p.byId.get(id)?.status !== 'done').length;
    if (open) meta.append(el('span', 'ap-muted', say('Waits on {n}', p.env.locale, { n: open })));
  }
  if (item.status === 'blocked' && item.reportedBlocker?.state === 'invalid') meta.append(testid(warningLine(say('Reported details couldn’t be read', p.env.locale), 'warning', 'span'), `task-blocker-warning-${item.id}`));
  return meta.childNodes.length ? meta : null;
}

/** Recorded prerequisites of any task, in recorded order (done ones too); never inferred. */
function prerequisitesOf(p: Paint, item: ItemView): Prerequisite[] {
  const entry = p.entries.get(item.id);
  if (entry) return entry.prerequisites;
  return (item.dependencies ?? []).map((id): Prerequisite => {
    const dep = p.byId.get(id);
    return !dep ? { kind: 'unresolved', id } : dep.kind === 'task' ? { kind: 'task', id, status: dep.status, title: dep.title } : { kind: 'not-task', id, title: dep.title };
  });
}

/**
 * The expanded facts of one task, each labelled, and their plain text for Copy details. Reason,
 * next step and wait for a reported blocker; recorded prerequisites (with what "none recorded"
 * means behind ⓘ); Unlocks next; group; assignee (or "Not recorded"); every distinct report.
 */
function rowFacts(p: Paint, row: ProgressRow) {
  const { item } = row;
  const locale = p.env.locale;
  const dl = testid(el('dl', 'ap-rfacts'), `task-facts-${item.id}`);
  const text: [string, string][] = [];
  const add = (term: string | Node, value: Node | string, plain: string, id?: string) => {
    const pair = el('div');
    const dt = el('dt');
    dt.append(term);
    const dd = el('dd');
    if (id) testid(dd, id);
    dd.append(value);
    pair.append(dt, dd);
    dl.append(pair);
    // A term with an ⓘ copies as its own word, never the explanation's text.
    text.push([typeof term === 'string' ? term : (term as HTMLElement).dataset?.term ?? '', plain]);
    return dd;
  };
  text.push([say('Status', locale), row.state ? say(STATE_WORD[row.state], locale) : statusLabel(item.status, locale)]);
  // Reported blocker details: the same facts and hooks as before, now in the row.
  if (item.status === 'blocked') {
    const b = item.reportedBlocker;
    const reported = b?.state === 'reported' ? b : null;
    dl.dataset.details = b ? b.state : 'unknown';
    testid(dl, `needs-you-facts-${item.id}`);
    const unknown = (dd: HTMLElement, is: boolean) => { if (is) { dd.dataset.unknown = ''; dd.classList.add('ap-ny-unknown'); } };
    if (b?.state === 'invalid') unknown(add(say('Details', locale), say('Reported details couldn’t be read', locale), say('Reported details couldn’t be read', locale), `needs-you-details-${item.id}`), true);
    else {
      unknown(add(say('Reason', locale), reported?.reason ?? say('Unknown', locale), reported?.reason ?? say('Unknown', locale), `needs-you-reason-${item.id}`), !reported?.reason);
      unknown(add(say('Next step', locale), reported?.nextAction ?? say('Unknown', locale), reported?.nextAction ?? say('Unknown', locale), `needs-you-next-${item.id}`), !reported?.nextAction);
    }
    const wait = blockedWaitLabel(item, p.detail, p.env);
    add(say('Reported wait', locale), wait, wait.textContent ?? '', `needs-you-wait-${item.id}`);
  }
  if (item.status === 'working') { const e = elapsedLabel(p.plan, item, p.detail, p.env); if (e) { testid(e, `task-elapsed-${item.id}`); add(say('Reported working', locale), e, e.textContent ?? ''); } }
  const intent = p.intent?.tasks.get(item.id);
  if (intent) {
    const lines = intent.state === 'waiting' ? [say('Waiting for the next sub-agent the coordinator starts. No work has started, and no sub-agent is assigned yet.', locale)]
      : [say(REFUSAL_COPY[intent.reason], locale), say('The coordinator can plan the handoff again for the current plan, or link the task to a session.', locale)];
    const holder = el('span', 'ap-intent-fact');
    for (const line of lines) holder.append(el('span', '', line));
    add(say('Sub-agent handoff', locale), holder, lines.join(' '), `delegation-fact-${item.id}`).dataset.intent = intent.state;
  }
  // Needs first: every recorded prerequisite in recorded order, including done ones.
  const prereqs = prerequisitesOf(p, item);
  const needsTerm = el('span', 'ap-rfacts-term');
  needsTerm.dataset.term = say('Needs first', locale);
  needsTerm.append(say('Needs first', locale), info(`${p.plan.key}|needs|${item.id}`, say('About prerequisites of {title}', locale, { title: item.title }), [say('Only prerequisites an agent recorded are listed. Others may not be recorded, so “No prerequisites recorded” doesn’t mean there are none.', locale), say('A blocked task doesn’t mean anyone must act; it stays blocked until an agent reports otherwise.', locale)]));
  if (!prereqs.length) add(needsTerm, el('span', 'ap-ready-none', say('No prerequisites recorded', locale)), say('No prerequisites recorded', locale));
  else {
    const ul = el('ul', 'ap-ready-deps');
    ul.setAttribute('aria-label', say('Prerequisites of {title}', locale, { title: item.title }));
    for (const pr of prereqs) ul.append(prerequisiteRow(p.plan, pr, locale));
    add(needsTerm, ul, prereqs.map((pr) => pr.kind === 'task' ? `${pr.title} (${statusLabel(pr.status, locale)})` : pr.kind === 'not-task' ? `${pr.title} (${say('a group', locale)})` : `${pr.id} (${say('unavailable', locale)})`).join('; '));
  }
  if (p.entries.get(item.id)?.incomplete) dl.append(el('p', 'ap-doc-warn', say('A recorded prerequisite is unavailable, so this task can’t be shown as ready.', locale)));
  // Unlocks next: tasks whose last unfinished recorded prerequisite this is (if it were reported done).
  const unlocks = [...p.unlocks?.get(item.id) ?? []].map((id) => p.byId.get(id)).filter((i): i is ItemView => !!i);
  if (unlocks.length) {
    const ul = el('ul', 'ap-ready-deps');
    ul.setAttribute('aria-label', say('Tasks {title} would unlock', locale, { title: item.title }));
    for (const u of unlocks) { const li = el('li', 'ap-ready-dep'); li.append(quietGlyph(u.status, locale), navLink(p.plan, u.id, u.title, say('Show task: {title}', locale, { title: u.title })), el('span', 'ap-muted', statusLabel(u.status, locale))); ul.append(li); }
    const term = el('span', 'ap-rfacts-term');
    term.dataset.term = say('Unlocks', locale);
    term.append(say('Unlocks', locale), info(`${p.plan.key}|unlocks|${item.id}`, say('About what {title} unlocks', locale, { title: item.title }), say('If this task is reported done, each task listed would have every recorded prerequisite done. From recorded prerequisites only; not permission to start.', locale)));
    add(term, ul, unlocks.map((u) => u.title).join('; '));
  }
  // Group context (attention order shows tasks outside their hierarchy).
  if (item.parentId) {
    const parent = p.byId.get(item.parentId);
    add(say('Group', locale), parent ? parent.title : say('Parent group unavailable', locale), parent ? parent.title : say('Parent group unavailable', locale));
  }
  // Assignee: recorded assignment only; a link is context, never an assignment.
  const state = (id: string) => (p.trusted ? liveLabel(coverageFor(id, p.plan.directory, p.env.live), locale).label : say('from another OpenCode setup', locale));
  const who = assignment({ assigneeSessionId: item.assigneeSessionId ?? null }, p.compareSession, p.plan.sourceId, p.env.boundSource);
  const linked = item.assigneeSessionId ? [] : [...new Set(p.detail.links.filter((l) => l.itemIds.includes(item.id)).map((l) => l.sessionId))];
  if (who.kind === 'none') {
    const dd = add(say('Assignee', locale), say('Not recorded', locale), say('Not recorded', locale), `task-assignee-${item.id}`);
    dd.dataset.assignment = 'none';
    if (linked.length) {
      const holder = testid(el('span', 'ap-ready-links'), `readiness-link-${item.id}`);
      for (const id of linked) { const line = el('span', 'ap-ready-who'); line.dataset.session = id; line.append(say('Linked to ', locale), el('b', '', p.label(id)), say(' · {state} (no recorded assignment)', locale, { state: state(id) })); holder.append(line); }
      dd.append(holder);
      text[text.length - 1][1] += say('; linked to {names} (no recorded assignment)', locale, { names: linked.map(p.label).join(', ') });
    }
  } else {
    const name = who.kind === 'selected' ? say('the selected session', locale) : p.label(who.sessionId);
    const holder = testid(el('span', 'ap-ready-who'), `readiness-assignee-${item.id}`);
    holder.append(el('b', '', who.kind === 'selected' ? say('The selected session', locale) : name), who.kind === 'other' ? ` · ${state(who.sessionId)}` : '');
    const dd = add(say('Assignee', locale), holder, holder.textContent ?? '', `task-assignee-${item.id}`);
    dd.dataset.assignment = who.kind;
  }
  // Provenance: blocker-detail authorship and each distinct task report, joined only when the
  // recorded tuples (mode, reporter, attributed session) are the same, never by name alone.
  const lines: { text: string; report?: string; blocker?: string }[] = [];
  const b = item.status === 'blocked' && item.reportedBlocker?.state === 'reported' ? item.reportedBlocker : null;
  const reports = reportsFor(item.id, p.detail.contributions);
  const describe = (mode: string, reporter: string, attributed: string) => reportPhrase(mode, reporter, attributed, p.label, locale);
  let joined = false;
  if (b) {
    const same = reports.find((r) => r.mode === b.mode && r.reporterSessionId === b.reporterSessionId && r.attributedSessionId === b.attributedSessionId);
    if (same && reports.length === 1) { lines.push({ text: say('Details and task {report}', locale, { report: describe(b.mode, b.reporterSessionId, b.attributedSessionId) }), report: same.mode, blocker: b.mode }); joined = true; }
    else lines.push({ text: say('Details {report}', locale, { report: describe(b.mode, b.reporterSessionId, b.attributedSessionId) }), blocker: b.mode });
  }
  if (!joined) for (const r of reports) lines.push({ text: say('Task {report}', locale, { report: describe(r.mode, r.reporterSessionId, r.attributedSessionId) }), report: r.mode });
  if (!reports.length && item.reporterSessionId) lines.push({ text: say('Last reported by {name} · report mode unavailable', locale, { name: p.label(item.reporterSessionId) }), report: 'reporter' });
  if (lines.length) {
    const holder = el('span', 'ap-rfacts-lines');
    for (const l of lines) {
      const s = el('span', '', l.text);
      if (l.report) s.dataset.report = l.report;
      if (l.blocker) { testid(s, `needs-you-source-${item.id}`); s.dataset.blockerReport = l.blocker; }
      holder.append(s);
    }
    add(say('Reported', locale), holder, lines.map((l) => l.text).join('; '));
  }
  if (p.who && p.who.filter.kind !== 'all' && row.visibility === 'match') add(say('Participant', locale), reasonsLine(item, p.who, locale), relationsOf(p.who.index, item.id, p.who.filter).map((r) => say(RELATION_TEXT[r], locale)).join('; ') || say('No participant recorded', locale));
  return { dl, text };
}

/** Copy details: a local preview of this row's displayed facts, explicit copy, manual-copy recovery. */
function copyBox(p: Paint, item: ItemView, text: [string, string][]) {
  const holder = el('div', 'ap-rcopy');
  const open = copy?.plan === p.plan.key && copy.item === item.id;
  if (!open) {
    const b = testid(el('button', 'ap-rcopy-open', say('Copy details…', p.env.locale)), `task-copy-${item.id}`);
    b.type = 'button';
    b.prepend(icon('copy'));
    b.addEventListener('click', () => { if (!p.reading?.current()) return; copy = { plan: p.plan.key, item: item.id, generation: ++copyGeneration, status: '' }; repaint(p, focusIn(p.plan, `[data-testid="task-copy-text-${CSS.escape(item.id)}"]`)); });
    holder.append(b);
    return holder;
  }
  const body = [item.title, ...text.map(([k, v]) => `${k}: ${v}`)].join('\n');
  // A changed displayed text is a new preview generation, even within one reading.
  // A held clipboard write for the old text may finish, but cannot confirm this text.
  if (copy!.text !== body) copy = { plan: p.plan.key, item: item.id, generation: ++copyGeneration, status: '', text: body };
  const box = testid(el('div', 'ap-summary-preview ap-rcopy-preview'), `task-copy-preview-${item.id}`);
  const status = testid(el('p', 'ap-note', say(copy!.status === 'copied' ? 'Copied.' : copy!.status === 'failed' ? 'Clipboard unavailable. Select and copy the text above.' : 'Review before sharing: this is the recorded text exactly as shown.', p.env.locale)), `task-copy-status-${item.id}`);
  status.setAttribute('role', 'status');
  const label = el('label', 'ap-summary-label', say('Task details (read-only)', p.env.locale));
  const area = testid(el('textarea', 'ap-summary-text'), `task-copy-text-${item.id}`);
  area.readOnly = true; area.value = body; area.rows = Math.min(10, body.split('\n').length + 1); area.spellcheck = false;
  area.dataset.taskCopyGeneration = String(copy!.generation);
  label.append(area);
  const controls = el('div', 'ap-row');
  const preview = copy;
  const finish = (ok: boolean) => { if (!preview || copy !== preview || !p.reading?.current()) return; preview.status = ok ? 'copied' : 'failed'; repaint(p); };
  button(controls, `task-copy-confirm-${item.id}`, say('Copy', p.env.locale), () => {
    if (copy !== preview || !p.reading?.current()) return;
    try { const c = globalThis.navigator?.clipboard; if (!c?.writeText) { finish(false); return; } void c.writeText(body).then(() => finish(true), () => finish(false)); } catch { finish(false); }
  }, 'outline');
  button(controls, `task-copy-close-${item.id}`, say('Close', p.env.locale), () => { if (copy !== preview || !p.reading?.current()) return; copy = null; repaint(p, focusIn(p.plan, `[data-testid="task-copy-${CSS.escape(item.id)}"]`)); }, 'ghost');
  box.append(status, label, controls);
  holder.append(box);
  return holder;
}

const REFUSAL_COPY: Record<IntentRefusal, CopyKey> = {
  changed: 'Not applied: the plan changed after the handoff was planned.', structure: 'Not applied: the plan’s task structure changed.',
  closed: 'Not applied: the plan was closed.', assignment: 'Not applied: the task’s assignment changed.',
  unverified: 'Not applied: the change couldn’t be checked.', other: 'Not applied: the progress service refused it.',
};

/**
 * The faint waiting-delegation line under a task title, part of the row's summary (so a collapsed
 * row reads it with the title). Display only: never a status, assignment, activity or control.
 */
function intentNote(p: Paint, itemId: string) {
  const intent = p.intent?.tasks.get(itemId);
  if (!intent) return null;
  const waiting = intent.state === 'waiting';
  const line = testid(el('span', 'ap-intent'), waiting ? ATTENTION_HOOKS.pending : ATTENTION_HOOKS.refused);
  line.dataset.intent = intent.state;
  if (!waiting) { line.dataset.reason = intent.reason; line.append(icon('warning')); }
  line.append(el('span', 'ap-intent-text', say(waiting ? 'Next sub-agent will take this' : 'Sub-agent handoff refused', p.env.locale)));
  return line;
}

/** One canonical task row: `li[item-ID]` (the programmatic target) and its expandable facts. */
function taskRow(p: Paint, row: ProgressRow, children: HTMLElement | null = null): HTMLLIElement {
  const { item } = row;
  const li = testid(el('li', 'ap-trow-li'), `item-${item.id}`);
  li.dataset.status = item.status;
  if (row.state) li.dataset.state = row.state;
  if (p.proj.filtered) li.dataset.focus = row.visibility;
  if (row.visibility === 'hidden') li.hidden = true;
  // A named, programmatically focusable destination for in-detail navigation (not a tab stop).
  li.tabIndex = -1;
  const details = testid(el('details', 'ap-group ap-trow'), `item-toggle-${item.id}`);
  // A task with children (plan order) starts open, like a branch; a plain row starts closed.
  details.open = !!children;
  const summary = el('summary', 'ap-trow-line');
  const mark = statusMark(row.state ?? item.status, { className: 'ap-glyph', locale: p.env.locale });
  summary.append(mark, el('span', 'ap-trow-title', item.title));
  if (row.visibility === 'retained') summary.append(el('span', 'ap-context', say('kept in view', p.env.locale)));
  else if (row.visibility === 'context') summary.append(el('span', 'ap-context', say('shown for context', p.env.locale)));
  // Time/wait and the chevron wrap together, so neither is left alone on a line.
  const end = el('span', 'ap-trow-end');
  const meta = rowMeta(p, row);
  if (meta) end.append(meta);
  end.append(icon('chevron-down'));
  summary.append(end);
  const note = intentNote(p, item.id);
  if (note) summary.append(note);
  // The facts exist only while the row is open: a collapsed row (and its focused canonical `li`)
  // reads as its line alone (status, title, time/wait/readiness word), never the expanded facts or
  // their ⓘ explanations. Built fresh on open (this paint's controls), removed on close.
  const body = el('div', 'ap-trow-body');
  const fill = () => {
    if (!details.open) { disposeInfoWithin(body); body.replaceChildren(); return; }
    if (body.childNodes.length) return;
    const { dl, text } = rowFacts(p, row);
    body.append(dl);
  };
  details.addEventListener('toggle', fill);
  fill();
  details.append(summary, body);
  if (children) details.append(children);
  li.append(details);
  return li;
}

/** Plan order: the recorded hierarchy (groups with their counts), each task its one canonical row. */
function treeRow(p: Paint, node: ItemNode, branches: TaskProjection['branches']): HTMLLIElement {
  const { item } = node;
  const row = p.proj.rows.get(item.id) ?? { item, state: null, section: null, visibility: 'match' as const };
  const kids = node.children.length ? el('ul', 'ap-tree') : null;
  for (const c of node.children) kids!.append(treeRow(p, c, branches));
  if (item.kind === 'task') {
    const li = taskRow(p, row, kids);
    if (kids) { const b = branches.get(item.id); if (b) branchCounts(li, b, p.plan.lifecycle, p.env.locale); }
    return li;
  }
  const li = testid(el('li', 'ap-trow-li'), `group-${item.id}`);
  li.dataset.status = item.status;
  if (p.proj.filtered) li.dataset.focus = row.visibility;
  if (row.visibility === 'hidden') li.hidden = true;
  const b = branches.get(item.id);
  if (b) Object.assign(li.dataset, { working: String(b.working), blocked: String(b.blocked) });
  const details = testid(el('details', 'ap-group ap-tgroup'), `group-toggle-${item.id}`);
  details.open = true;
  const summary = el('summary');
  summary.append(el('span', 'ap-grow', item.title));
  details.append(summary);
  if (kids) details.append(kids);
  li.append(details);
  if (b) branchCounts(li, b, p.plan.lifecycle, p.env.locale);
  return li;
}

/** Filter exclusion and disclosure folding are distinct from full descendant progress. */
function branchCounts(li: HTMLElement, counts: NonNullable<ReturnType<TaskProjection['branches']['get']>>, lifecycle: PlanView['lifecycle'], locale: InterfaceLanguage) {
  const details = li.querySelector<HTMLDetailsElement>(':scope > details');
  const summary = details?.querySelector(':scope > summary');
  if (!details || !summary) return;
  Object.assign(li.dataset, { working: String(counts.working), blocked: String(counts.blocked), filterHidden: String(counts.hidden) });
  summary.append(el('span', 'ap-count', counts.total ? `${displayCount(counts.done, locale)}/${displayCount(counts.total, locale)}` : ''));
  if (counts.working || counts.blocked) {
    const progress = el('span', 'ap-branch');
    if (lifecycle !== 'active') progress.append(say('Last reported: ', locale));
    if (counts.working) { const s = el('span', '', say('{n} in progress', locale, { n: counts.working })); s.dataset.k = 'working'; progress.append(s); }
    if (counts.blocked) { const s = el('span', '', say('{n} blocked', locale, { n: counts.blocked })); s.dataset.k = 'blocked'; progress.append(s); }
    summary.append(progress);
  }
  const line = el('span', 'ap-branch ap-muted');
  summary.append(line);
  const update = () => {
    const folded = details.open ? 0 : counts.rows - counts.hidden;
    li.dataset.folded = String(folded);
    const parts = [];
    if (counts.hidden) parts.push(say('{tasks} hidden by filters', locale, { tasks: taskCount(counts.hidden, locale) }));
    if (counts.context) parts.push(say('{tasks} shown for context', locale, { tasks: taskCount(counts.context, locale) }));
    if (folded) parts.push(say('{tasks} folded', locale, { tasks: taskCount(folded, locale) }));
    line.textContent = parts.join(' · ');
    line.hidden = !parts.length;
  };
  details.addEventListener('toggle', update);
  update();
}

/**
 * The attention groups: Now, Needs you, Up next, then Done and Skipped folded. One `ul.ap-items`
 * root holds every canonical row (the reading's restoration root); a group with no shown rows is
 * hidden, never drawn empty. Done/Skipped folds belong to the reading (doneOpen/skippedOpen): their
 * hook sits on the owning wrapper, not on the `details`, so the generic disclosure memory leaves them alone.
 */
function attentionList(p: Paint, ul: HTMLElement) {
  for (const g of p.proj.groups) {
    if (!g.rows.length) continue;
    const li = el('li', 'ap-pgroup');
    li.setAttribute('role', 'none');
    const shown = g.rows.filter((r) => r.visibility !== 'hidden').length;
    if (!shown) li.hidden = true;
    const box = testid(el('div', 'ap-pgroup-box'), `progress-group-${g.id}`);
    box.dataset.count = String(g.rows.length);
    box.dataset.shown = String(shown);
    const title = say(GROUP_TITLE[g.id][p.proj.guidance ? 0 : 1], p.env.locale);
    const rows = el('ul', 'ap-pgroup-rows');
    rows.setAttribute('aria-label', title);
    for (const r of g.rows) rows.append(taskRow(p, r));
    if (g.id === 'done' || g.id === 'skipped') {
      const fold = el('details', 'ap-fold');
      fold.open = !g.folded;
      box.dataset.folded = String(g.folded);
      const summary = el('summary', 'ap-pgroup-h');
      summary.append(icon('chevron-down'), `${title} · ${displayCount(g.rows.length, p.env.locale)}`);
      fold.append(summary, rows);
      const field = g.id === 'done' ? 'doneOpen' : 'skippedOpen';
      // Record only a change from how this paint drew it (a person or a reveal), not the
      // browser's own toggle for the initial state, so a chip-opened fold doesn't stay open after.
      let drawn = fold.open;
      fold.addEventListener('toggle', () => { if (fold.open === drawn) return; drawn = fold.open; if (p.reading?.current()) p.reading.remember({ [field]: fold.open }); });
      box.append(fold);
    } else {
      box.append(el('h4', 'ap-pgroup-h', title), rows);
    }
    li.append(box);
    ul.append(li);
  }
}

/** Tasks heading: visually quiet, the programmatic focus fallback of task-reading restoration (app.ts). */
function tasksHeading(locale: InterfaceLanguage) {
  const h = el('h3', 'ap-tasks-h', say('Tasks', locale));
  h.tabIndex = -1;
  return h;
}

/**
 * The one canonical task list of a complete detail: attention groups (default) or the recorded
 * hierarchy (plan order), never both. Filtered-out rows stay materialized with `hidden`.
 */
function taskList(p: Paint) {
  const section = el('section', 'ap-section ap-tasks');
  // Painted from complete detail, even without task rows (app.ts: not a loading gap).
  section.dataset.complete = '';
  section.dataset.readiness = p.proj.readiness.state;
  section.append(tasksHeading(p.env.locale));
  const notice = testid(el('p', 'ap-note ap-focus-notice'), 'focus-notice');
  notice.setAttribute('role', 'status');
  section.append(filterLine(p), notice);
  if (!p.detail.items.length) { section.append(el('p', 'ap-note', say('This plan has no tasks yet.', p.env.locale))); return section; }
  const taskCount = p.detail.items.filter((i) => i.kind === 'task').length;
  if (!taskCount) section.append(testid(el('p', 'ap-note', say('No task rows are recorded in this plan, only groups.', p.env.locale)), 'focus-no-tasks'));
  else if (p.proj.filtered && !p.proj.matching) section.append(noMatches(p));
  const ul = testid(el('ul', 'ap-items'), `items-${p.plan.id}`);
  // Group-only plans and Plan order show the recorded hierarchy; otherwise attention groups.
  const plan = p.reading?.order === 'plan' || !taskCount;
  ul.dataset.order = plan ? 'plan' : 'attention';
  if (plan) {
    ul.setAttribute('aria-label', say('Tasks in {title}, in plan order', p.env.locale, { title: p.plan.title }));
    const { branches } = taskProjection(p.detail.items, p.proj.filtered ? i => { const v = p.proj.rows.get(i.id)?.visibility; return v === 'match' || v === 'retained'; } : null);
    for (const node of p.proj.tree) ul.append(treeRow(p, node, branches));
  } else {
    ul.setAttribute('role', 'none');
    attentionList(p, ul);
  }
  section.append(ul);
  return section;
}

/** Task view options (⋯ → Task view): the bulk and filter controls, in an ordinary labelled region. */
function taskViewPanel(p: Paint) {
  const reading = p.reading!;
  const box = testid(el('section', 'ap-panel ap-focus'), 'focus-controls');
  box.setAttribute('aria-label', say('Task view', p.env.locale));
  const head = el('div', 'ap-panel-head');
  const h = testid(el('h3', 'ap-h ap-panel-h', say('Task view', p.env.locale)), 'task-view-heading');
  h.tabIndex = -1;
  head.append(h);
  button(head, 'task-view-close', say('Close', p.env.locale), () => closePanel(p), 'ghost');
  box.append(head);
  escapeCloses(box, p);
  const bar = el('div', 'ap-focus-bar');
  const pair = (id: string, label: CopyKey, entries: [string, CopyKey, boolean, () => void][]) => {
    const set = testid(el('div', 'ap-focus-set'), id);
    set.setAttribute('role', 'group');
    set.setAttribute('aria-label', say(label, p.env.locale));
    for (const [hook, text, pressed, run] of entries) button(set, hook, say(text, p.env.locale), run, pressed ? 'outline' : 'ghost').querySelector('button')?.setAttribute('aria-pressed', String(pressed));
    return set;
  };
  const modes = pair('focus-mode', 'Show tasks', [['focus-mode-all', 'Show all', reading.status === 'all', () => reading.set({ status: 'all' })], ['focus-mode-unfinished', 'Unfinished', reading.status === 'unfinished', () => reading.set({ status: 'unfinished' })]]);
  modes.dataset.mode = reading.status;
  const order = reading.order ?? 'attention';
  const orders = pair('focus-order', 'Order', [['focus-order-attention', 'By attention', order === 'attention', () => reading.set({ order: 'attention' })], ['focus-order-plan', 'Plan order', order === 'plan', () => reading.set({ order: 'plan' })]]);
  orders.dataset.order = order;
  bar.append(modes, orders);
  if (p.who) bar.append(participantSelect(p.plan, reading, p.who, p.label, p.env.locale));
  const bulk = el('div', 'ap-focus-set');
  for (const [id, label, open] of [['focus-expand-all', 'Expand all', true], ['focus-collapse-all', 'Collapse all', false]] as const) {
    const holder: HTMLElement = button(bulk, id, say(label, p.env.locale), () => setDisclosures(holder, p.plan, reading, open), 'ghost');
  }
  const jumps = el('div', 'ap-focus-set');
  const hierarchy = taskProjection(p.detail.items, null);
  for (const kind of ['working', 'blocked'] as const) {
    const targets = jumpTargets(hierarchy, kind);
    const words = JUMP_COPY[kind][p.plan.lifecycle === 'active' ? 'active' : 'closed'].map(key => say(key, p.env.locale));
    const holder: HTMLElement = button(jumps, `focus-jump-${kind}`, targets.length ? `${words[0]} (${displayCount(targets.length, p.env.locale)})` : words[1], () => jump(holder, p.plan, kind, targets, reading, JUMP_COPY[kind][p.plan.lifecycle === 'active' ? 'active' : 'closed'][2]), 'ghost', !targets.length);
    holder.dataset.count = String(targets.length);
  }
  bar.append(bulk, jumps);
  box.append(bar);
  return box;
}

/** Escape closes a plan panel (focus returns to ⋯), unless a popup inside it already used the key. */
function escapeCloses(box: HTMLElement, p: Paint) {
  box.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); closePanel(p); } });
}

function closePanel(p: Paint) {
  if (!p.reading?.current()) return;
  panel = null;
  repaint(p, focusIn(p.plan, '[data-testid="plan-actions"] button'));
}
function openPanel(p: Paint, kind: PanelKind) {
  if (!p.reading?.current()) return;
  panel = { plan: p.plan.key, kind };
  repaint(p, focusIn(p.plan, `[data-testid="plan-panel-${kind}"] .ap-panel-h, [data-testid="task-view-heading"]`));
}

/** A plan panel opened from ⋯: a labelled region with a heading focus target and Close. */
function plainPanel(p: Paint, kind: PanelKind, title: string, content: HTMLElement) {
  const box = testid(el('section', 'ap-panel'), `plan-panel-${kind}`);
  box.setAttribute('aria-label', title);
  const head = el('div', 'ap-panel-head');
  const h = el('h3', 'ap-h ap-panel-h', title);
  h.tabIndex = -1;
  head.append(h);
  button(head, `plan-panel-${kind}-close`, say('Close', p.env.locale), () => closePanel(p), 'ghost');
  box.append(head, content);
  escapeCloses(box, p);
  return box;
}

/** ⋯ → Sessions: every participant under the panel's single Sessions heading. */
function sessionsPanel(p: Paint) {
  return plainPanel(p, 'sessions', say('Sessions', p.env.locale), peopleBlock(p.plan, p.detail, p.env));
}

/** The ⋯ plan actions: copies, task view, order, document, sessions and any surface entries. */
function planMenu(p: Paint | null, plan: PlanView, hooks: DetailHooks, docMode: 'disclosure' | 'inline' | 'omit', extra: PlanAction[], fallback: { reading: ReadingView | null }, locale: InterfaceLanguage) {
  const items: MenuItem[] = [];
  const runs = new Map<string, () => void>();
  const add = (id: string, label: CopyKey, run: () => void, disabled = false) => { items.push({ id, label: say(label, locale), disabled }); runs.set(id, run); };
  const summary = hooks.summary;
  if (summary) {
    add('summary-progress', 'Copy progress update…', () => summary.open('progress'));
    add('summary-handoff', 'Copy handoff…', () => summary.open('handoff'));
  }
  if (p?.reading) {
    if (items.length) items.push({ separator: true });
    const r = p.reading;
    add('task-view', 'Task view options…', () => openPanel(p, 'task-view'));
    add('order', r.order === 'plan' ? 'Show by attention' : 'Show in plan order', () => r.set({ order: r.order === 'plan' ? 'attention' : 'plan' }));
    add('expand-all', 'Expand all tasks', () => { const a = document.querySelector<HTMLElement>(`article.ap-plan[data-testid="plan-${CSS.escape(plan.id)}"][data-source="${CSS.escape(plan.sourceId)}"]`); if (a) setDisclosures(a, plan, r, true); });
    add('collapse-all', 'Collapse all tasks', () => { const a = document.querySelector<HTMLElement>(`article.ap-plan[data-testid="plan-${CSS.escape(plan.id)}"][data-source="${CSS.escape(plan.sourceId)}"]`); if (a) setDisclosures(a, plan, r, false); });
  }
  const panels: MenuItem[] = [];
  if (docMode === 'disclosure' && p) { panels.push({ id: 'document', label: say('Plan document', locale) }); runs.set('document', () => openPanel(p, 'document')); }
  if (p && fallback.reading) { panels.push({ id: 'sessions', label: say('Sessions', locale) }); runs.set('sessions', () => openPanel(p, 'sessions')); }
  for (const a of extra) { panels.push({ id: a.id, label: a.label, disabled: a.disabled }); runs.set(a.id, a.run); }
  if (panels.length) { if (items.length) items.push({ separator: true }); items.push(...panels); }
  const holder = el('span', 'ap-actions-hold');
  if (items.length) holder.append(planActions({ items, locale, onSelect: (id) => runs.get(id)?.() }).root);
  return holder;
}

/**
 * `compareSession`: the session assignments compare with (rail: the selected host session;
 * board: an explicit session filter). Null keeps neutral assignee labels.
 * `picker`: the rail's title-picker. `actions`: surface-specific ⋯ entries. `info`: an ⓘ for the
 * header (for example the rail's contributing-session note). `pending`: the frame's default view is
 * still being decided (docs/ui.md Default view): only the loading placeholder, never complete rows.
 */
export function planDetail(plan: PlanView, env: Env, hooks: DetailHooks, options: { document: 'disclosure' | 'inline' | 'omit'; heading?: 'h2' | 'h3'; compareSession?: string | null; reading?: ReadingView | null; picker?: HTMLElement | null; actions?: PlanAction[]; info?: HTMLElement | null; pending?: boolean; shell?: boolean }) {
  const root = testid(el('article', 'ap-plan'), `plan-${plan.id}`);
  root.dataset.lifecycle = plan.lifecycle;
  root.dataset.source = plan.sourceId;
  root.dataset.revision = String(plan.revision);
  root.dataset.locale = env.locale;
  const reading = options.reading ?? null;
  // Its task disclosures, logical focus and anchor follow this reading identity (app.ts).
  if (reading) { root.dataset.reading = ''; READINGS.set(root, reading); }
  if (panel && panel.plan !== plan.key) panel = null;
  if (copy && copy.plan !== plan.key) copy = null;
  const value = hooks.detail?.state === 'ready' && hooks.detail.value.revision === plan.revision ? hooks.detail.value : null;
  const ready = options.pending ? null : value;
  const proj = ready && reading ? progressProjection(plan, ready, reading) : ready ? progressProjection(plan, ready, { status: 'all', participant: ALL_PARTICIPANTS, cursor: { working: null, blocked: null } }) : null;
  const summary = summarize(plan, ready);
  if (showsLiveness(plan.lifecycle, summary, env.view)) root.dataset.motion = 'on';
  let paint: Paint | null = null;
  if (ready && proj) {
    const r = proj.readiness;
    const entries = new Map<string, ReadinessEntry>();
    if (r.state === 'ready') for (const list of Object.values(r.groups)) for (const e of list) entries.set(e.item.id, e);
    const derived = proj.guidance ? deriveDependencies(ready.items) : null;
    const index = reading ? participantIndex(plan, ready) : null;
    paint = {
      plan, detail: ready, env, proj, reading, compareSession: options.compareSession ?? null,
      byId: new Map(ready.items.map((i) => [i.id, i])), entries,
      unlocks: derived?.state === 'valid' ? new Map([...derived.tasks].map(([id, t]) => [id, t.unlocksNext])) : null,
      who: reading && index ? { filter: reading.participant, index } : null,
      label: recordedLabel(plan, env), trusted: trustedSource(plan, env),
      intent: currentIntent(plan, ready),
    };
    root.dataset.delegation = paint.intent!.state;
  }
  if (!options.shell) {
    const menu = planMenu(paint, plan, hooks, options.document, options.actions ?? [], { reading }, env.locale);
    root.append(planHeader(plan, env, options.heading, { picker: options.picker, actions: menu, info: options.info }));
    root.append(progressBlock(summary, false, env.locale));
    if (hooks.summary) { const s = summaryBlock(hooks.summary, env.locale); if (s) root.append(s); }
  }
  if (paint && panel?.plan === plan.key) {
    if (panel.kind === 'task-view' && reading) root.append(taskViewPanel(paint));
    else if (panel.kind === 'document' && options.document === 'disclosure') root.append(plainPanel(paint, 'document', say('Plan document', env.locale), documentBlock(plan, env, 'inline', hooks.document)));
    else if (panel.kind === 'sessions') root.append(sessionsPanel(paint));
  }
  if (paint) root.append(listFilters(reading, env.locale), taskList(paint));
  else {
    // No task controls until complete matching detail exists: loading or failed is never "no matches".
    const tasks = el('section', 'ap-section ap-tasks');
    tasks.append(tasksHeading(env.locale), partState('detail-loading', say('tasks', env.locale), hooks.detail?.state === 'error' ? hooks.detail : null, hooks.retryDetail, env.locale));
    root.append(tasks);
  }
  if (hooks.activity) root.append(planActivityBlock(plan, hooks.activity, env));
  // One compact session row; the Sessions panel holds every participant.
  if (!options.shell && !(panel?.plan === plan.key && panel.kind === 'sessions')) root.append(peopleBlock(plan, ready, env, true, paint ? () => openPanel(paint!, 'sessions') : undefined));
  if (options.document === 'inline') root.append(documentBlock(plan, env, 'inline', hooks.document));
  return root;
}

/**
 * The summary preview, opened from ⋯ (Copy progress update / Copy handoff). Plain selectable
 * Markdown; async state and all action authority stay in the controller. Null while closed.
 */
function summaryBlock(view: SummaryView, locale: InterfaceLanguage) {
  const state = view.preview;
  if (!state) return null;
  const section = el('section', 'ap-summary');
  section.setAttribute('aria-label', say('Plan summaries', locale));
  const action = (parent: HTMLElement, id: string, label: string, run: () => void, disabled = false) => {
    const holder = button(parent, id, label, run, 'outline', disabled);
    // Hooks and focus belong to the native control, not the kit's wrapper.
    delete holder.dataset.testid;
    const control = holder.querySelector('button');
    if (control) control.dataset.testid = id;
    return control;
  };
  const box = testid(el('div', 'ap-summary-preview'), 'summary-preview');
  box.append(el('h3', 'ap-h', say(state.mode === 'progress' ? 'Progress update preview' : 'Handoff preview', locale)));
  const status = testid(el('p', 'ap-note', state.status || state.message || say('Review the Markdown, then copy it.', locale)), 'summary-status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.setAttribute('aria-atomic', 'true');
  box.append(status);
  if (state.status && state.message) box.append(el('p', 'ap-note', state.message));
  if (state.text !== null) {
    const label = el('label', 'ap-summary-label', say('Markdown preview (read-only)', locale));
    const text = testid(el('textarea', 'ap-summary-text'), 'summary-text');
    text.readOnly = true; text.value = state.text; text.rows = 12; text.spellcheck = false;
    text.dataset.generation = String(state.generation);
    label.append(text); box.append(label);
  }
  const controls = el('div', 'ap-row');
  action(controls, 'summary-copy', say('Copy Markdown', locale), view.copy, state.text === null || state.copying);
  if (state.canRetry) action(controls, 'summary-retry', say('Retry', locale), view.retry);
  if (state.canSummaryOnly) action(controls, 'summary-only', say('Preview summary only', locale), view.summaryOnly);
  // The summary owner returns focus to the original opener.
  const close = action(controls, 'summary-close', say('Close', locale), () => {
    close?.closest('article.ap-plan')?.querySelector<HTMLElement>('[data-testid="plan-actions"] button')?.focus({ preventScroll: true });
    view.close();
  });
  box.append(controls); section.append(box);
  return section;
}

function revisionNumber(n: number, locale: InterfaceLanguage) {
  return el('span', 'ap-history-rev', say('Revision {n}', locale, { n: String(n) }));
}
function revisionTime(iso: string, env: Env, absolute = false) {
  const time = age(iso, env);
  if (absolute) { delete time.dataset.age; time.textContent = time.title; }
  return time;
}
function userCancellation(locale: InterfaceLanguage) { return el('span', 'ap-muted', cancelCopy(locale).history); }
function reportPhrase(mode: string, reporter: string, attributed: string, label: (id: string) => string, locale: InterfaceLanguage) {
  return say(mode === 'parent-relay' ? 'reported by {reporter} for {attributed}' : 'reported directly by {reporter}', locale, {
    reporter: label(reporter), attributed: label(attributed),
  });
}

const ACTIVITY_EN = {
  title: 'Activity', older: 'Older updates', newer: 'Newer updates', coordinator: 'Coordinator', child: 'Sub-agent',
  loading: 'Loading activity…', failed: 'Activity is unavailable.', noIds: 'No task IDs reported',
  unavailable: 'Report details unavailable', newReports: 'New updates are available. Close and reopen Activity to see them.',
  taskIds: (ids: string) => `Task IDs: ${ids}`, range: (newest: number, oldest: number) => `Showing updates ${oldest}–${newest}`,
};
const ACTIVITY_COPY: Record<InterfaceLanguage, typeof ACTIVITY_EN> = {
  en: ACTIVITY_EN,
  ru: {
    title: 'Активность', older: 'Более ранние обновления', newer: 'Более поздние обновления', coordinator: 'Координатор', child: 'Субагент',
    loading: 'Загрузка обновлений…', failed: 'Не удалось загрузить обновления.', noIds: 'Идентификаторы задач не указаны',
    unavailable: 'Сведения об отчёте недоступны', newReports: 'Есть новые обновления. Закройте и снова откройте раздел «Активность», чтобы увидеть их.',
    taskIds: ids => `Идентификаторы задач: ${ids}`, range: (newest, oldest) => `Показаны обновления ${oldest}–${newest}`,
  },
  'zh-CN': {
    title: '活动', older: '较早的更新', newer: '较新的更新', coordinator: '协调者', child: '子代理',
    loading: '正在加载活动…', failed: '无法加载活动。', noIds: '未报告任务 ID',
    unavailable: '报告详情不可用', newReports: '有新的更新。请关闭并重新打开“活动”查看。',
    taskIds: ids => `任务 ID：${ids}`, range: (newest, oldest) => `显示第 ${oldest}–${newest} 次更新`,
  },
};

export function planActivityBlock(plan: PlanView, view: PlanActivityView, env: Env) {
  const { locale } = env, t = ACTIVITY_COPY[locale], state = view.value;
  const expanded = state.state !== 'closed';
  const section = testid(el('section', 'ap-activity ap-section'), 'plan-activity');
  const heading = el('h3', 'ap-h');
  const toggle = testid(el('button', 'ap-activity-toggle', t.title), 'activity-toggle');
  toggle.type = 'button';
  toggle.setAttribute('aria-expanded', String(expanded));
  toggle.setAttribute('aria-controls', 'ap-activity-body');
  toggle.addEventListener('click', () => view.act(expanded ? 'close' : 'open'));
  heading.append(toggle);
  const body = el('div', 'ap-activity-body');
  body.id = 'ap-activity-body';
  body.hidden = !expanded;
  section.append(heading, body);
  if (!expanded) return section;

  const status = el('p', 'ap-note', state.state === 'loading' ? t.loading : state.state === 'failure' ? t.failed
    : t.range(state.through, state.rows.at(-1)!.revision));
  status.id = 'ap-activity-status';
  status.setAttribute('role', 'status');
  body.append(status);
  if (plan.revision > state.pin) body.append(el('p', 'ap-note', t.newReports));
  const controls = el('div', 'ap-activity-controls');
  const pageButton = (action: 'newer' | 'older', name: string, enabled: boolean) => {
    const b = testid(el('button', 'ap-activity-button', name), `activity-${action}`);
    b.type = 'button';
    b.setAttribute('aria-disabled', String(!enabled));
    b.setAttribute('aria-describedby', status.id);
    // Keep keyboard focus at the same control as its page is replaced, including
    // at the first/last page where the control becomes unavailable.
    b.addEventListener('click', () => { if (enabled) view.act(action); });
    controls.append(b);
  };
  pageButton('newer', t.newer, state.state === 'ready' && state.through < state.pin);
  pageButton('older', t.older, state.state === 'ready' && state.nextThrough !== null);
  if (state.state === 'failure') {
    const retry = testid(el('button', 'ap-activity-button', say('Try again', locale)), 'activity-retry');
    retry.type = 'button';
    retry.addEventListener('click', () => { toggle.focus({ preventScroll: true }); view.act('retry'); });
    controls.append(retry);
  }
  body.append(controls);
  if (state.state === 'ready') {
    const rows = el('ul', 'ap-history');
    const label = recordedLabel(plan, env);
    for (const row of state.rows) {
      const li = testid(el('li', 'ap-history-row'), `activity-revision-${row.revision}`);
      li.append(revisionNumber(row.revision, locale), revisionTime(row.reportedAt, env, true));
      if (row.kind === 'user') li.append(userCancellation(locale));
      else if (row.kind === 'unavailable') li.append(el('span', 'ap-muted', t.unavailable));
      else {
        const who = row.reporterSessionId === plan.ownerSessionId ? t.coordinator : t.child;
        li.append(el('span', 'ap-activity-report', `${who} · ${reportPhrase(row.mode, row.reporterSessionId, row.attributedSessionId, label, locale)}`));
        li.append(el('span', 'ap-activity-report ap-muted', row.itemIds.length ? t.taskIds(row.itemIds.join(', ')) : t.noIds));
      }
      rows.append(li);
    }
    body.append(rows);
  }
  return section;
}

export function historyBlock(plan: PlanView, value: Loadable<{ entries: HistoryEntry[]; truncated: boolean }> | null, env: Env, retry?: () => void) {
  const section = testid(el('section', 'ap-section'), `history-${plan.id}`);
  section.append(el('h3', 'ap-h', say('Revisions', env.locale)));
  if (!value || value.state !== 'ready') { section.append(partState('history-loading', say('history', env.locale), value, retry, env.locale)); return section; }
  const ul = el('ul', 'ap-history');
  const entries = value.value.entries;
  const kind = (i: number) => say(entries[i].revision === 1 ? 'plan reported' : i === 0 ? 'progress update' : entries[i].structuralRevision !== entries[i - 1].structuralRevision ? 'tasks revised' : entries[i].lifecycle !== entries[i - 1].lifecycle ? 'outcome reported' : 'progress update', env.locale);
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    const li = testid(el('li', 'ap-history-row'), `revision-${e.revision}`);
    li.append(revisionNumber(e.revision, env.locale), e.actor === 'user' ? userCancellation(env.locale) : el('span', 'ap-muted', kind(i)));
    if (e.lifecycle !== 'active' && e.actor !== 'user') li.append(el('span', 'ap-muted', lifecycleLabel(e.lifecycle, env.locale)));
    li.append(revisionTime(e.reportedAt, env));
    ul.append(li);
  }
  section.append(ul);
  if (value.value.truncated) section.append(el('p', 'ap-note', say('Only the first {n} revisions are shown.', env.locale, { n: entries.length })));
  return section;
}

const DIAGNOSTIC_TEXT: Record<string, CopyKey> = {
  'capture-disabled': 'Capture is turned off; no new reports are recorded.',
  'source-unverified': 'Some recorded sources are not verified.',
  'host-source-binding-unverified': 'This service is not bound to a verified OpenCode setup.',
  'historical-capture': 'Showing an earlier document capture.',
};

/** Diagnostics live here, collapsed, after the progress story. */
export function detailsBlock(read: StoreRead | null, plan: PlanView | null, extra: [string, string][], env: Env) {
  const d = testid(el('details', 'ap-details'), 'details');
  d.append(el('summary', '', say('Details', env.locale)));
  const facts = el('dl', 'ap-facts');
  const add = (k: string, v: string, mono = false) => facts.append(el('dt', '', k), el('dd', mono ? 'ap-mono' : '', v));
  if (plan) {
    add(say('Plan', env.locale), plan.id, true);
    add(say('Revision', env.locale), say('{revision} (structure {structure})', env.locale, { revision: String(plan.revision), structure: String(plan.structuralRevision) }));
    add(say('Reported', env.locale), absoluteTime(plan.reportedAt, env.locale));
    if (plan.directory) add(say('Last reported location', env.locale), plan.directory, true);
    add(say('Main session', env.locale), plan.ownerSessionId, true);
    add(say('Plan source', env.locale), plan.sourceId, true);
    if (plan.document.path) add(say('Document source', env.locale), plan.document.path, true);
    add(say('Document state', env.locale), `${plan.document.state}${plan.document.checklistSynchronized ? say(', task list confirmed', env.locale) : ''}`);
    if (plan.document.captureId !== undefined) add(say('Document capture', env.locale), `#${plan.document.captureId}${plan.document.hash ? ` · ${plan.document.hash}` : ''}`, true);
    if (plan.document.checkedAt) add(say('Document checked', env.locale), absoluteTime(plan.document.checkedAt, env.locale));
  }
  if (read) {
    add(say('Store', env.locale), read.storeId, true);
    add(say('Bound source', env.locale), read.binding.sourceId ? `${read.binding.sourceId}${say(read.binding.verified ? ' (verified)' : ' (not verified)', env.locale)}` : say('None', env.locale), true);
    for (const s of read.sources) add(say('Recorded source', env.locale), `${s.id}${say(s.verified ? ' (verified)' : ' (not verified)', env.locale)}`, true);
    add(say('Capture', env.locale), say(read.captureEnabled ? 'On' : 'Off', env.locale));
    add(say('Coverage', env.locale), read.coverage);
  }
  for (const [k, v] of extra) add(k, v);
  d.append(facts);
  if (read?.diagnostics.length) {
    const ul = el('ul');
    for (const line of read.diagnostics) ul.append(el('li', '', DIAGNOSTIC_TEXT[line] ? say(DIAGNOSTIC_TEXT[line], env.locale) : line));
    d.append(ul);
  }
  return d;
}

/** Content of Troubleshooting's single Advanced details fold, not another disclosure.
 * Keeps every former Details fact and the complete held report provenance; no new reads. */
export function advancedDetails<U>(vc: ViewContext<U>, plan: PlanView | null, extra: [string, string][]) {
  const legacy = detailsBlock(vc.read, plan, extra, vc.env);
  const body = el('div'); body.append(...[...legacy.children].slice(1));
  if (vc.read?.truncated) body.append(el('p', 'ap-note', `${say('Coverage', vc.env.locale)}: truncated`));
  const value = plan ? vc.detail(plan) : null;
  if (!plan || value?.state !== 'ready' || value.value.revision !== plan.revision) return body;
  const detail = value.value;
  const proj = progressProjection(plan, detail, vc.reading ?? { status: 'all', participant: ALL_PARTICIPANTS, cursor: { working: null, blocked: null } });
  if (proj) body.append(qualifiers({ proj, plan, env: vc.env }));
  const facts = testid(el('dl', 'ap-facts'), 'advanced-report-authorship');
  const add = (label: string, value: string) => facts.append(el('dt', '', label), el('dd', '', value));
  const label = recordedLabel(plan, vc.env);
  for (const item of detail.items) {
    if (item.assigneeSessionId) add(item.title, `${say('Assignee', vc.env.locale)}: ${label(item.assigneeSessionId)}`);
    if (item.delegation) {
      const b = item.delegation;
      add(item.title, `${label(b.coordinatorSessionId)} → ${label(b.childSessionId)} · ${say('Revision', vc.env.locale)}: ${b.boundRevision}–${b.validAtRevision}`);
    }
    for (const link of detail.links.filter(link => link.itemIds.includes(item.id))) add(item.title, `${say('Linked to ', vc.env.locale)}${label(link.sessionId)}`);
    if (item.reporterSessionId) add(item.title, `${say('Reported', vc.env.locale)}: ${label(item.reporterSessionId)}`);
    const b = item.reportedBlocker;
    if (b?.state === 'reported') add(item.title, `${say('Details', vc.env.locale)}: ${label(b.reporterSessionId)} · ${b.mode} · ${label(b.attributedSessionId)}`);
  }
  for (const report of detail.contributions) add(say('Reported', vc.env.locale), `${label(report.reporterSessionId)} · ${report.mode} · ${label(report.attributedSessionId)} · ${report.itemIds.join(', ')} · ${report.revision}${report.reportedAt ? ` · ${absoluteTime(report.reportedAt, vc.env.locale)}` : ''}`);
  body.append(facts);
  return body;
}

export const FAILURE_COPY: Record<ReadFailure['kind'], { title: string; body: string }> = {
  'not-approved': { title: 'Progress needs permission', body: 'Allow this extension in Settings → Extensions to show agent progress.' },
  paused: { title: 'Progress is paused', body: 'This extension is paused in Settings → Extensions.' },
  disconnected: { title: 'Lost connection to OpenChamber', body: 'Progress will update again when the connection returns.' },
  unavailable: { title: 'Progress is not responding', body: 'Try again in a moment.' },
  busy: { title: 'Progress is busy', body: 'Try again shortly.' },
  damaged: { title: 'Progress data is damaged', body: 'Nothing was reset; follow the setup guide to recover it.' },
  incompatible: { title: 'Progress data needs an update', body: 'Update Agent Progress in OpenChamber.' },
  invalid: { title: 'Progress could not be read', body: 'The progress service sent a reply this view could not use.' },
  'not-found': { title: 'That plan is no longer available', body: 'Choose another plan.' },
  'setup-lost': { title: 'Progress setup can’t be read right now', body: 'Check Setup; nothing was changed or deleted.' },
  'setup-refused': { title: 'Progress couldn’t verify this setup', body: 'Open Settings → Setup to see what needs attention.' },
};
const FAILURES: Record<InterfaceLanguage, typeof FAILURE_COPY> = {
  en: FAILURE_COPY,
  ru: {
    'not-approved': { title: 'Прогрессу нужно разрешение', body: 'Разрешите это расширение в Settings → Extensions, чтобы показать прогресс агентов.' },
    paused: { title: 'Прогресс приостановлен', body: 'Это расширение приостановлено в Settings → Extensions.' },
    disconnected: { title: 'Соединение с OpenChamber потеряно', body: 'Прогресс снова начнёт обновляться после восстановления соединения.' },
    unavailable: { title: 'Прогресс не отвечает', body: 'Повторите попытку чуть позже.' },
    busy: { title: 'Прогресс занят', body: 'Повторите попытку чуть позже.' },
    damaged: { title: 'Данные прогресса повреждены', body: 'Ничего не сброшено; следуйте руководству по восстановлению.' },
    incompatible: { title: 'Данные прогресса требуют обновления', body: 'Обновите Agent Progress в OpenChamber.' },
    invalid: { title: 'Не удалось прочитать прогресс', body: 'Сервис прогресса прислал ответ, который это представление не смогло использовать.' },
    'not-found': { title: 'Этот план больше недоступен', body: 'Выберите другой план.' },
    'setup-lost': { title: 'Сейчас не удаётся прочитать настройки прогресса', body: 'Проверьте настройку; ничего не изменено и не удалено.' },
    'setup-refused': { title: 'Не удалось проверить настройку прогресса', body: 'Откройте «Настройки» → «Настройка», чтобы узнать причину.' },
  },
  'zh-CN': {
    'not-approved': { title: '进度需要权限', body: '请在设置 → 扩展中允许此扩展，以显示智能体进度。' },
    paused: { title: '进度已暂停', body: '此扩展已在设置 → 扩展中暂停。' },
    disconnected: { title: '与 OpenChamber 的连接已断开', body: '连接恢复后进度会再次更新。' },
    unavailable: { title: '进度未响应', body: '请稍后重试。' },
    busy: { title: '进度正忙', body: '请稍后重试。' },
    damaged: { title: '进度数据已损坏', body: '未重置任何内容，请按照设置指南恢复。' },
    incompatible: { title: '进度数据需要更新', body: '请在 OpenChamber 中更新 Agent Progress。' },
    invalid: { title: '无法读取进度', body: '进度服务返回了此视图无法使用的响应。' },
    'not-found': { title: '该计划已不再可用', body: '请选择其他计划。' },
    'setup-lost': { title: '暂时无法读取进度设置', body: '请检查设置，未更改或删除任何内容。' },
    'setup-refused': { title: '无法验证进度设置', body: '请从齿轮菜单打开「设置」查看原因。' },
  },
};
export const failureCopy = (kind: ReadFailure['kind'], locale: InterfaceLanguage = 'en') => FAILURES[locale][kind];

export function loadingBlock(locale: InterfaceLanguage = 'en') {
  const slot = testid(el('div', 'ap-row'), 'state-loading');
  slot.setAttribute('role', 'status');
  mountSpinner(slot, { label: say('Loading progress', locale) });
  return slot;
}

/**
 * Owning section heading of a recovered read (docs/ui.md Restoration): the board's list heading, the
 * read plan's title, Work Status's featured plan, else the empty or unscoped state.
 */
export const recoveredHeading = (root: HTMLElement) => root.querySelector<HTMLElement>('[data-testid="plan-list-heading"], [data-testid="plan-title"], [data-testid="status-plan-title"], [data-testid="empty-state"], [data-testid="unscoped-state"], [data-testid="setup-needed"], [data-testid="setup-status-heading"]');
/** Try again on a failed or stale read: the banner leaves on success, so focus goes to the owning heading once. */
export const retryRead = (vc: { handoff: (h: { heading: (root: HTMLElement) => HTMLElement | null; notice: (heading: HTMLElement, locale?: InterfaceLanguage) => string }) => void; retry: () => void; env?: Pick<Env, 'locale'> }, locale: InterfaceLanguage = 'en') => () => {
  // A service that answers but is not set up recovers into its setup state, not into progress.
  vc.handoff({ heading: recoveredHeading, notice: (h, currentLocale = vc.env?.locale ?? locale) => say(/^setup-/.test(h.dataset.testid ?? '') ? 'Setup is needed' : 'Progress loaded again', currentLocale) });
  vc.retry();
};

export function failureBlock(failure: ReadFailure, onRetry?: () => void, locale: InterfaceLanguage = 'en') {
  const slot = testid(el('div'), `state-${failure.kind}`);
  slot.setAttribute('role', 'alert');
  const copy = failureCopy(failure.kind, locale);
  mountBanner(slot, { tone: failure.kind === 'disconnected' || failure.kind === 'paused' || failure.kind === 'busy' ? 'warning' : 'error', title: copy.title, body: copy.body, action: onRetry ? { label: say('Try again', locale), onClick: onRetry } : undefined });
  return slot;
}

/** Last good data stays visible, plainly marked as not current. */
export function staleBlock(failure: ReadFailure, lastGoodAt: number, locale: InterfaceLanguage, onRetry: () => void) {
  const slot = testid(el('div'), 'stale-banner');
  slot.setAttribute('role', 'status');
  mountBanner(slot, { tone: 'warning', title: say('Showing progress from {time}', locale, { time: clockTime(lastGoodAt, locale) }), body: say('{failure}. This may be out of date.', locale, { failure: failureCopy(failure.kind, locale).title }), action: { label: say('Try again', locale), onClick: onRetry } });
  return slot;
}

/** Authoritative empty or unscoped state; compact for Work Status, centered kit empty elsewhere. */
export function emptyBlock(id: string, title: string, body: string, compact = false, action?: { label: string; onClick: () => void }) {
  const box = testid(el('div', compact ? 'ap-section' : 'ap-empty'), id);
  box.setAttribute('role', 'status');
  box.tabIndex = -1; // a recovered read's owning section when no plan is shown (docs/ui.md Restoration)
  box.dataset.handoffName = title;
  if (compact) {
    box.append(el('p', '', title), el('p', 'ap-note', body));
    if (action) button(box, `${id}-action`, action.label, action.onClick, 'ghost');
  } else mountEmpty(box, { title, body, action });
  return box;
}

export const failureFacts = (failure: ReadFailure | null, locale: InterfaceLanguage = 'en'): [string, string][] => (failure ? [[say('Last refresh error', locale), `${failure.code}: ${failureCopy(failure.kind, locale).title}`]] : []);

export function button(parent: Element, id: string, label: string, onClick: () => void, variant: 'ghost' | 'outline' | 'secondary' | 'default' | 'destructive' = 'outline', disabled = false) {
  const holder = testid(el('span'), id);
  mountButton(holder, { label, variant, size: variant === 'default' || variant === 'destructive' ? 'sm' : 'xs', onClick, disabled });
  parent.append(holder);
  return holder;
}
