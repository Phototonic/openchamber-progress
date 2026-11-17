// Dependency map renderer (Designer-owned). Shared by the board and the right rail.
// Every recorded string lands through textContent. Geometry comes from the frame owner's full-plan
// layout and is never recomputed or filtered here: filters only hide cards/arrows in place.
// With an interaction binding (S3) the canvas is a pan/zoom viewport with one roving card Tab stop,
// scoped keys, a viewport toolbar, background-drag/wheel panning, relation highlights and one
// persistent per-frame live region. Without one it stays the S2 read-only, natively scrolled view.
import { DependencyMap, mapReadingKey, type MapClaim, type MapSnapshot, type MapPicture } from './dependency-map.ts';
import { DependencyMapLayout, type MapLayout } from './dependency-map-layout.ts';
import type { DerivedTask } from './dependency-derivation.ts';
import { DependencyMapInteraction, MAP_PANEL, MAP_TOUCH, MAP_ZOOM, fitProjection, mapPanelWidth, mapAnnouncementText, type MapAnnouncement, type MapInteractionCommand, type MapInteractionEvent, type MapInteractionState } from './dependency-map-interaction.ts';
import { mapAttribution } from './dependency-map-attribution.ts';
import { button, el, recordedLabel, revealCurrentTask, testid } from './components.ts';
import type { ViewContext } from './app.ts';
import type { Census } from './census.ts';
import type { RunsPanel } from './runs.ts';
import type { RunRequest } from '../../shared/subagent-runs.ts';
import { MAP_CSS } from './dependency-map-style.ts';
import { resolveLanguage, type InterfaceLanguage } from './i18n.ts';
import { formatCount } from './format.ts';
import { canOpen, coverageFor, EMPTY_LIVE, sessionLabel } from './live.ts';
import { itemNeedsYou, showsLiveness, statusMatch, type BlockerView, type ItemView, type PlanView, type StatusFilter } from './model.ts';
import type { MapTaskAttribution } from './dependency-map-attribution.ts';

/** The frame's interaction controller, as the view sees it. The controller lives outside the root. */
export interface MapInteractionBinding {
  /** Live controller snapshot; read at paint and when applying commands. */
  state: () => MapInteractionState;
  /** Returns whether the event was handled (keys: only then is the default prevented). */
  dispatch: (event: MapInteractionEvent) => boolean;
  /** Focus entered (true) or left (false) the map or its view switch within this frame. */
  focusOwner: (owns: boolean) => void;
}

export interface DependencyMapViewInput extends MapSnapshot {
  /** Created by the shell for this paint, mounted here rather than moved after attachment. */
  viewSwitch?: HTMLElement;
  /** Existing source/host navigation gate; called only for a proven running assignee. */
  sessionAction?: (sessionId: string) => HTMLElement | null;
  language?: InterfaceLanguage;
  /** Frame-local, revision-bound assignment/link/report and live-session proof; never layout input.
   * Absent (map or task entry): provenance/activity unavailable, never “unassigned”. Only a proven
   * live entry on a current picture permits the session-only “Assigned session active now”. */
  attribution?: ReadonlyMap<string, MapTaskAttribution>;
  /** Source-safe session label (`recordedLabel(plan, env)`): host titles only for the verified bound
   * source. Absent: plain recorded labels (“Session …”) for every session. */
  label?: (sessionId: string) => string;
  frame: 'board' | 'rail';
  /** Geometry is computed by the frame owner from the FULL picture, never by the view. */
  layout: MapLayout | null;
  facts: MapPicture['facts'] | null;
  status: StatusFilter;
  /** null = all groups; '' = no recorded group; otherwise a recorded group subtree. */
  group: string | null;
  selected: string | null;
  onSelect: (id: string) => void;
  onStatus: (value: StatusFilter) => void;
  onGroup: (id: string | null) => void;
  onRetry: () => void;
  onList: (selected: string | null) => void;
  /**
   * Optional: usable canvas width (CSS px inside the map viewport, excluding world padding), reported
   * when it first becomes known and whenever it changes. Edgeless row packing should use it instead of
   * the frame width; connected layouts ignore it. Never called for status-only repaints.
   */
  onCanvasWidth?: (width: number) => void;
  /** S3 interaction. Absent: the read-only S2 presentation (native scroll, every card a Tab stop). */
  interaction?: MapInteractionBinding;
  /**
   * Board only, with interaction: the selection panel's width in CSS px (`mapPanelWidth`) once the map
   * is wide enough for it. The inspector then sits over the canvas's right edge while a task is
   * selected and is absent otherwise; the canvas never resizes for it. 0/absent: stacked inspector.
   */
  panel?: number;
  /**
   * Affirmative permission for working-arrow motion from the frame owner (`mapMotionPermitted`):
   * Map shown in a visible frame, an eligible current picture, and the reported-work gate
   * (`showsLiveness`). Absent or false: beads stay stationary. Read-only previews never pass it.
   */
  motion?: boolean;
  /**
   * Coarse primary pointer (`mapCoarsePointer`: the host's optional device hint, else the
   * `(pointer: coarse)` media query). Presentation only: 44 px controls, touch help wording and the
   * region's `data-pointer`. Touch gestures follow each event's own pointer type, never this flag.
   */
  coarse?: boolean;
}
/** The host's pointer hint when it is one the phone layout accepts ('coarse' or 'fine'), else null.
 * Same rule as `applyDeviceHooks`, so the map and the root `data-device-pointer` hook always agree. */
const pointerHint = (device: ViewContext<unknown>['device']): 'coarse' | 'fine' | null => {
  const hint: unknown = device?.pointer;
  return hint === 'coarse' || hint === 'fine' ? hint : null;
};
/** Coarse primary pointer: the host's optional `ready.device.pointer` hint wins; without a usable
 * hint, the `(pointer: coarse)` media query. Never an identity or permission signal. */
export function mapCoarsePointer(device: ViewContext<unknown>['device'], media: ((query: string) => { matches: boolean }) | undefined = globalThis.matchMedia?.bind(globalThis)): boolean {
  const hint = pointerHint(device);
  if (hint) return hint === 'coarse';
  return !!media?.('(pointer: coarse)').matches;
}
export interface DependencyMapView {
  /** One paint into a (possibly new) host. State/geometry remain frame-owned, not DOM-owned. */
  render: (host: HTMLElement, input: DependencyMapViewInput) => void;
  /** Rebind after root replacement (paints with the last input). */
  mount: (host: HTMLElement) => void;
  update: (input: DependencyMapViewInput) => void;
  /** Apply an action-local controller command: viewport, focus, capture or announcement. */
  command: (command: MapInteractionCommand) => void;
  /** Retire delivered and pending speech without removing the persistent live region. */
  clearAnnouncements: () => void;
  /** Close and retire the frame-local help disclosure. */
  clearHelp: () => void;
  /** Hidden, left or disposed: revoke the stored and painted arrow-motion permission in place
   * (no repaint). Only a later paint with fresh permission can restore it. */
  revokeMotion: () => void;
  dispose: () => void;
}
/** QA vocabulary: map-region data-{state,current,revision,tasks,edges,highlight}; map-card-ID
 * data-{task,x,y,status,readiness,unlocks,related}; SVG paths data-{from,to,path}, marker-end;
 * map-{state,viewport,world,inspector,group,status,list,retry,help}; toolbar map-{zoom-in,
 * zoom-out,zoom-level,fit-all,focus-current,pan-left,pan-right,pan-up,pan-down}; one per-frame
 * map-announcer outside the root; plan-view, plan-view-{list,map}. Attribution (S4): card
 * data-{attribution,live}, map-card-who-ID, map-card-live-ID; inspector map-attribution
 * data-{assignment,live} with map-attribution-{assignment,links,reports,live}; map-attribution-help.
 * Wide board: map-inspector data-placement="over" (hidden without a selection) and map-inspector-close.
 * No data-reading article.
 * These describe semantic facts, not styling or incidental DOM nesting.
 */

/** Card mark: shape + words, colour only reinforces it (style.ts `.ap-map-mark`). */
type Mark = 'working' | 'ready' | 'waiting' | 'waiting-skipped' | 'blocked' | 'done' | 'skipped' | 'pending';
const MARK_TEXT: Record<InterfaceLanguage, Record<Mark, string>> = { en: {
  working: 'In progress', ready: 'Ready', waiting: 'Waiting on earlier tasks', 'waiting-skipped': 'Waiting on skipped task',
  blocked: 'Blocked', done: 'Done', skipped: 'Skipped', pending: 'Not started',
}, ru: {
  working: 'В работе', ready: 'Готова', waiting: 'Ждёт предыдущие задачи', 'waiting-skipped': 'Ожидает пропущенную задачу',
  blocked: 'Заблокирована', done: 'Выполнена', skipped: 'Пропущена', pending: 'Не начата',
}, 'zh-CN': {
  working: '进行中', ready: '已就绪', waiting: '等待前置任务', 'waiting-skipped': '等待已跳过的任务',
  blocked: '受阻', done: '已完成', skipped: '已跳过', pending: '未开始',
} };
const EN = {
  planView: 'Plan view', list: 'List', map: 'Map', under: 'under 1%', viewList: 'View as list', retry: 'Try again', heading: 'Dependency map',
  closeDetails: 'Close task details', helpTitle: 'Help and filters', clearKey: ' clear selection · ',
  needsYou: 'Needs you', clearFilters: 'Clear', openSession: 'Open session',
  openingHint: (tasks: string) => `Fit shows all ${tasks}.`,
  stateCounts: (p: string, w: string, b: string, d: string, s: string) => `${p} not started, ${w} in progress, ${b} blocked, ${d} done, ${s} skipped`,
  panHelp: '. Click the background to clear selection; drag it or scroll to pan. Tab leaves the map.',
  touchHelp: 'Touch: tap a card to select it, tap the background to clear the selection, drag with one finger to move the map and pinch with two to zoom. Zoom and Fit are also buttons; keyboard navigation and List are alternatives to dragging.',
  panelHelp: 'Select a card to see its recorded prerequisites, dependents and reported details in a panel at the map’s right edge. Close the panel, press Escape or click the background to clear the selection.',
  arrowKey: 'Arrow key. Blue beads: the prerequisite is reported working and the task it points to is still waiting or blocked. Moving beads are a looping sign of reported work, not progress and not proof that the work is happening now; still beads mean the same (they stop when motion is reduced, on large or zoomed-out maps, and outside a selected task’s chain). A bar before the arrowhead: the prerequisite is explicitly blocked. Dashed: the prerequisite was skipped. Faint: the prerequisite is done. Beads and bars appear only on an active plan’s current picture.',
  blockedSelection: ' An explicitly blocked task is never shown as ready, whatever its prerequisites.',
  verifiedActivity: 'Session activity is shown only for a verified assignment.',
  mapDescription: 'Use arrow keys to navigate cards. Open Help and filters for all map keys.',
  prerequisiteState: (n: string, working: boolean) => `${n} ${working ? 'in progress' : 'blocked'}`,
  unfinishedStates: (states: string) => ` Its unfinished recorded prerequisites include ${states}.`,
  waitingStates: (n: string, states: string) => `Waiting on ${n}${states ? `: ${states}` : ''}.`,
  unavailable: 'Map unavailable', notFound: 'This plan is no longer recorded', error: 'Couldn’t read the map', updatingMap: 'Updating the map…', loading: 'Loading the map…',
  inconsistent: 'The current plan can’t be matched to a consistent dependency picture, so the earlier map is no longer shown. The task list is unaffected.',
  unsupported: 'The progress service can’t provide the recorded prerequisites this map needs, so nothing is drawn. The task list is unaffected.',
  missing: 'The progress store no longer has this plan. Choose another plan or return to the list.',
  failed: 'The dependency map couldn’t be read. Nothing is shown rather than a partial picture.', updating: 'Updating…',
  changed: ' The plan changed while its map was being read. Waiting for a consistent picture; nothing partial is drawn.',
  waitingPicture: 'Waiting for the complete plan and its recorded prerequisites. Nothing is drawn until both agree.',
  revision: (r: number) => `Revision ${r}`, showing: (r: number) => `Showing revision ${r}.`,
  latestFailed: (r: number) => `Couldn’t read the latest map. Showing revision ${r} as last reported; Ready and Unlocks next are hidden until it can be read.`,
  retained: (r: number) => ` Showing revision ${r} as last reported. Ready and Unlocks next are hidden until the newer report is matched.`,
  work: 'Current work', working: 'in progress', ready: 'ready', blocked: 'blocked', unlocks: 'Unlocks next',
  guidance: 'From recorded prerequisites only; neither Ready nor Unlocks next is permission to start.',
  closed: 'This plan is closed. Cards show reported status only, without Ready or Unlocks next guidance.',
  groupsOnly: 'No task cards. This plan records only groups; their context is listed below. ', noTasksYet: 'No task cards. This plan has no recorded tasks yet. ',
  noPrerequisites: 'No prerequisites recorded for this plan', listOrder: '. Cards are placed in list order, without arrows.',
  noTaskPrerequisites: 'No task-to-task prerequisites recorded', groupArrows: '. Group prerequisites are listed as group context, never drawn as arrows.',
  arrows: 'Arrows run from a recorded prerequisite to the task that depends on it. Recorded information only: not a schedule, and not proof that work ran.',
  filters: 'Map filters', showTasks: 'Show tasks', all: 'Show all', unfinished: 'Unfinished', allGroups: 'All groups', noGroup: 'No group recorded', groupGone: 'Chosen group is no longer recorded', group: 'Group',
  filtered: (visible: string, tasks: string, hidden: string, arrows: string) => `Showing ${visible} of ${tasks} · ${hidden}${arrows ? ` and ${arrows}` : ''} hidden by filters`,
  allShown: (tasks: string, arrows: string) => `Showing all ${tasks}${arrows ? ` and ${arrows}` : ''}`,
  taskMap: 'Task map', mapView: 'Map view', zoom: (z: string) => `Zoom ${z}`, zoomOut: 'Zoom out', zoomIn: 'Zoom in', fit: 'Fit all', current: 'Focus current work',
  moved: (where: string) => `View moved ${where}.`, left: 'left', up: 'up', down: 'down', right: 'right', panLeft: 'Pan left', panUp: 'Pan up', panDown: 'Pan down', panRight: 'Pan right',
  sessionOnly: (text: string) => `${text}, session activity only`, groupPath: (path: string) => `Group: ${path}`,
  direct: (up: string, down: string) => `${up}, ${down}`, hiddenRelated: (n: string) => `${n} hidden by filters`, unlocksFor: (n: string) => `Unlocks next for ${n}`,
  relative: (name: string, rel: string) => `${name}. ${rel} of the selected task`, upstream: 'Upstream', downstream: 'Downstream',
  noCards: 'No task cards', emptyMap: 'Task map: no task cards', gone: 'The chosen group is no longer recorded.', noMatches: 'No tasks match these filters.', showAll: 'Show all tasks',
  selected: 'Selected task', select: 'Select a card to see its recorded prerequisites, dependents and reported details.', noInspect: 'No task cards to inspect.', hidden: 'Hidden by filters',
  reason: 'Reason', next: 'Next action', assignmentActivity: 'Assignment and activity', assignment: 'Assignment', links: 'Links', reports: 'Reports', noReports: 'No reports recorded', activity: 'Session activity', hiddenSuffix: ' · hidden by filters',
  prerequisites: 'Recorded prerequisites', none: 'None recorded.', dependents: 'Dependents', noDependents: 'No task records this one as a prerequisite.',
  chain: (up: string, down: string) => `Highlighted on the map: ${up} it waits on, directly or through others, and ${down} waiting on it.`,
  unlockHelp: (titles: string) => `If reported done, this would satisfy the last unfinished recorded prerequisite for: ${titles}. That is not permission to start them.`,
  groupContext: 'Group context', groupHelp: (title: string, deps: string) => `Group “${title}” records its own prerequisites: ${deps}. These belong to the group, not to this task.`,
  hiddenHelp: (n: string) => `${n} hidden by the current filters. Choosing one shows it again.`,
  keys: 'Keys in the map: ', arrowKeys: 'Arrow keys', nearest: ' nearest card · ', firstPrerequisite: ' first prerequisite · ', firstDependent: ' first dependent · ', fitKey: ' fit all · ', zoomKey: ' zoom', drag: '. Drag the background or scroll to pan; Tab leaves the map.',
  selectionHelp: 'Selecting a card marks the tasks it waits on as Upstream (solid outline) and the tasks waiting on it as Downstream (double outline).',
  readinessHelp: 'Ready: every recorded prerequisite is reported done. Unlocks next: if reported done, a card would satisfy the last unfinished recorded prerequisite of another task.',
  attributionHelp: 'Assigned to: a verified delegation for this revision. Unverified assignee: recorded, but without a verified delegation. Linked to: a session link, not an assignment. A square before the assigned session’s name: that session is active now (filled) or waiting for input (outlined) in this view’s run records. It doesn’t show which task the session is working on.',
  groupDeps: (deps: string) => `Records its own prerequisites: ${deps}`, noGroupDeps: 'No group prerequisites recorded', groupMetadata: 'A group’s prerequisites are group metadata. They are not inherited by its tasks and are never drawn as arrows.',
  selectedMapTask: 'Selected map task', skippedHelp: 'Skipped work never counts as done for its dependents.', blockedHelp: 'An agent reported this task explicitly blocked. It is never shown as ready, whatever its prerequisites.',
  closedPending: 'Reported pending when the plan closed.', pendingHelp: 'Reported pending. Readiness is hidden until the current revision is matched.',
  readyDeps: 'Every recorded prerequisite is reported done. Ready describes recorded prerequisites only.', readyNoDeps: 'No prerequisites recorded. Ready describes recorded prerequisites only.',
  skippedDeps: (titles: string) => `Waiting: a recorded prerequisite was skipped (${titles}), and skipped work never counts as done.`, waitingDeps: (n: string) => `Waiting on ${n}.`,
  notReported: 'Not reported', invalid: 'Reported details could not be read',
  counts: {
    task: ['task', 'tasks', 'tasks', 'tasks'], arrow: ['arrow', 'arrows', 'arrows', 'arrows'],
    prerequisite: ['direct recorded prerequisite', 'direct recorded prerequisites', 'direct recorded prerequisites', 'direct recorded prerequisites'],
    dependent: ['direct dependent', 'direct dependents', 'direct dependents', 'direct dependents'], related: ['related task', 'related tasks', 'related tasks', 'related tasks'],
    upstream: ['upstream task', 'upstream tasks', 'upstream tasks', 'upstream tasks'], downstream: ['downstream task', 'downstream tasks', 'downstream tasks', 'downstream tasks'],
    hidden: ['related task is', 'related tasks are', 'related tasks are', 'related tasks are'], unfinished: ['unfinished recorded prerequisite', 'unfinished recorded prerequisites', 'unfinished recorded prerequisites', 'unfinished recorded prerequisites'],
  },
};
const RU: typeof EN = {
  planView: 'Вид плана', list: 'Список', map: 'Карта', under: 'менее 1%', viewList: 'Показать списком', retry: 'Повторить', heading: 'Карта зависимостей',
  closeDetails: 'Закрыть сведения о задаче', helpTitle: 'Справка и фильтры', clearKey: ' снять выбор · ',
  needsYou: 'Нужно ваше участие', clearFilters: 'Сбросить', openSession: 'Открыть сессию',
  openingHint: tasks => `Вместить всё: ${tasks}.`,
  stateCounts: (p, w, b, d, s) => `Не начато: ${p}; в работе: ${w}; заблокировано: ${b}; выполнено: ${d}; пропущено: ${s}`,
  panHelp: '. Нажмите на фон, чтобы снять выбор; перетаскивайте или прокручивайте для сдвига. Tab выводит с карты.',
  touchHelp: 'Касание: коснитесь карточки, чтобы выбрать её, коснитесь фона, чтобы снять выбор, ведите одним пальцем, чтобы сдвинуть карту, и сводите или разводите два пальца для масштаба. Масштаб и вся карта доступны кнопками; вместо перетаскивания можно пользоваться клавишами или списком.',
  panelHelp: 'Выберите карточку, чтобы увидеть записанные зависимости, зависимые задачи и сообщённые сведения в панели справа на карте. Закройте панель, нажмите Escape или на фон, чтобы снять выбор.',
  arrowKey: 'Обозначения стрелок. Синие точки: по отчёту зависимость в работе, а задача, на которую указывает стрелка, ещё ожидает или заблокирована. Движение точек — циклический знак сообщённой работы, а не прогресс или доказательство работы прямо сейчас; неподвижные точки означают то же самое (движение останавливается при уменьшении анимации, на больших или отдалённых картах и вне цепочки выбранной задачи). Черта перед наконечником: зависимость явно заблокирована. Пунктир: зависимость пропущена. Бледная стрелка: зависимость выполнена. Точки и черты появляются только на текущей картине активного плана.',
  blockedSelection: ' Явно заблокированная задача никогда не показывается готовой независимо от зависимостей.',
  verifiedActivity: 'Активность сессии показана только при подтверждённом назначении.',
  mapDescription: 'Перемещайтесь между карточками клавишами стрелок. Все клавиши перечислены в справке и фильтрах.',
  prerequisiteState: (n, working) => `${working ? 'в работе' : 'заблокировано'}: ${n}`,
  unfinishedStates: states => ` Среди незавершённых записанных зависимостей: ${states}.`,
  waitingStates: (n, states) => `Ожидает: ${n}${states ? `; ${states}` : ''}.`,
  unavailable: 'Карта недоступна', notFound: 'Этот план больше не записан', error: 'Не удалось прочитать карту', updatingMap: 'Обновление карты…', loading: 'Загрузка карты…',
  inconsistent: 'Не удалось сопоставить текущий план с согласованной картиной зависимостей, поэтому прежняя карта больше не показана. Список задач не изменён.',
  unsupported: 'Сервис прогресса не предоставляет записанные зависимости, необходимые карте, поэтому ничего не нарисовано. Список задач не изменён.',
  missing: 'В хранилище прогресса больше нет этого плана. Выберите другой план или вернитесь к списку.',
  failed: 'Не удалось прочитать карту зависимостей. Вместо частичной картины ничего не показано.', updating: 'Обновление…',
  changed: ' План изменился во время чтения карты. Ожидание согласованной картины; частичная карта не показана.',
  waitingPicture: 'Ожидание полного плана и его записанных зависимостей. Карта появится, когда они совпадут.',
  revision: r => `Редакция ${r}`, showing: r => `Показана редакция ${r}.`,
  latestFailed: r => `Не удалось прочитать новую карту. Показана редакция ${r} по последнему отчёту; «Готова» и «Открывает далее» скрыты до успешного чтения.`,
  retained: r => ` Показана редакция ${r} по последнему отчёту. «Готова» и «Открывает далее» скрыты до сопоставления нового отчёта.`,
  work: 'Текущая работа', working: 'в работе', ready: 'готовы', blocked: 'заблокированы', unlocks: 'Открывает далее',
  guidance: 'Только по записанным зависимостям; ни «Готова», ни «Открывает далее» не дают разрешения начинать.',
  closed: 'Этот план закрыт. Карточки показывают только сообщённый статус, без подсказок «Готова» и «Открывает далее».',
  groupsOnly: 'Нет карточек задач. В плане записаны только группы; их контекст указан ниже. ', noTasksYet: 'Нет карточек задач. В плане пока не записаны задачи. ',
  noPrerequisites: 'Для этого плана не записаны зависимости', listOrder: '. Карточки расположены в порядке списка, без стрелок.',
  noTaskPrerequisites: 'Зависимости между задачами не записаны', groupArrows: '. Зависимости групп указаны как контекст групп и никогда не рисуются стрелками.',
  arrows: 'Стрелки идут от записанной зависимости к зависящей от неё задаче. Только записанные сведения: не расписание и не доказательство выполнения работы.',
  filters: 'Фильтры карты', showTasks: 'Показать задачи', all: 'Все', unfinished: 'Незавершённые', allGroups: 'Все группы', noGroup: 'Группа не записана', groupGone: 'Выбранная группа больше не записана', group: 'Группа',
  filtered: (visible, tasks, hidden, arrows) => `Всего: ${tasks} · показано: ${visible} · фильтрами скрыто: ${hidden}${arrows ? ` и ${arrows}` : ''}`,
  allShown: (tasks, arrows) => `Показаны все: ${tasks}${arrows ? ` и ${arrows}` : ''}`,
  taskMap: 'Карта задач', mapView: 'Вид карты', zoom: z => `Масштаб ${z}`, zoomOut: 'Уменьшить', zoomIn: 'Увеличить', fit: 'Вместить всё', current: 'Показать текущую работу',
  moved: where => `Карта сдвинута ${where}.`, left: 'влево', up: 'вверх', down: 'вниз', right: 'вправо', panLeft: 'Сдвинуть влево', panUp: 'Сдвинуть вверх', panDown: 'Сдвинуть вниз', panRight: 'Сдвинуть вправо',
  sessionOnly: text => `${text}, только активность сессии`, groupPath: path => `Группа: ${path}`,
  direct: (up, down) => `${up}, ${down}`, hiddenRelated: n => `Фильтрами скрыто: ${n}`, unlocksFor: n => `Открывает далее: ${n}`,
  relative: (name, rel) => `${name}. ${rel} относительно выбранной задачи`, upstream: 'Предшествующие', downstream: 'Последующие',
  noCards: 'Нет карточек задач', emptyMap: 'Карта задач: нет карточек', gone: 'Выбранная группа больше не записана.', noMatches: 'Нет задач по этим фильтрам.', showAll: 'Показать все задачи',
  selected: 'Выбранная задача', select: 'Выберите карточку, чтобы увидеть записанные зависимости, зависимые задачи и сообщённые сведения.', noInspect: 'Нет карточек задач для просмотра.', hidden: 'Скрыта фильтрами',
  reason: 'Причина', next: 'Следующее действие', assignmentActivity: 'Назначение и активность', assignment: 'Назначение', links: 'Связи', reports: 'Отчёты', noReports: 'Отчёты не записаны', activity: 'Активность сессии', hiddenSuffix: ' · скрыта фильтрами',
  prerequisites: 'Записанные зависимости', none: 'Не записаны.', dependents: 'Зависимые задачи', noDependents: 'Ни одна задача не указывает эту как зависимость.',
  chain: (up, down) => `Выделены на карте: ${up}, которых задача ожидает прямо или косвенно, и ${down}, ожидающих её.`,
  unlockHelp: titles => `Если сообщить о выполнении, это закроет последнюю незавершённую записанную зависимость для: ${titles}. Это не разрешение начинать их.`,
  groupContext: 'Контекст групп', groupHelp: (title, deps) => `Группа «${title}» записывает собственные зависимости: ${deps}. Они относятся к группе, а не к этой задаче.`,
  hiddenHelp: n => `Текущими фильтрами скрыто: ${n}. Выбор задачи снова покажет её.`,
  keys: 'Клавиши на карте: ', arrowKeys: 'Стрелки', nearest: ' ближайшая карточка · ', firstPrerequisite: ' первая зависимость · ', firstDependent: ' первая зависимая задача · ', fitKey: ' вместить всё · ', zoomKey: ' масштаб', drag: '. Перетаскивайте фон или прокручивайте для сдвига; Tab выводит с карты.',
  selectionHelp: 'При выборе карточки задачи, которых она ожидает, помечаются как предшествующие (сплошной контур), а ожидающие её — как последующие (двойной контур).',
  readinessHelp: 'Готова: о выполнении каждой записанной зависимости сообщено. Открывает далее: отчёт о выполнении карточки закроет последнюю незавершённую записанную зависимость другой задачи.',
  attributionHelp: 'Назначено: подтверждённое делегирование для этой редакции. Непроверенный исполнитель: записан, но без подтверждённого делегирования. Связь с сессией: не назначение. Квадрат перед именем назначенной сессии: по записям запусков этого представления сессия сейчас активна (закрашен) или ожидает ввода (контур). Это не показывает, над какой задачей работает сессия.',
  groupDeps: deps => `Собственные записанные зависимости: ${deps}`, noGroupDeps: 'Зависимости группы не записаны', groupMetadata: 'Зависимости группы — метаданные группы. Её задачи не наследуют их, и они никогда не рисуются стрелками.',
  selectedMapTask: 'Выбранная задача карты', skippedHelp: 'Пропущенная работа никогда не считается выполненной для зависимых задач.', blockedHelp: 'Агент явно сообщил о блокировке задачи. Она не показывается готовой независимо от зависимостей.',
  closedPending: 'На момент закрытия плана сообщено: ожидает.', pendingHelp: 'Сообщено: ожидает. Готовность скрыта до сопоставления текущей редакции.',
  readyDeps: 'О выполнении каждой записанной зависимости сообщено. «Готова» описывает только записанные зависимости.', readyNoDeps: 'Зависимости не записаны. «Готова» описывает только записанные зависимости.',
  skippedDeps: titles => `Ожидание: записанная зависимость пропущена (${titles}), а пропущенная работа никогда не считается выполненной.`, waitingDeps: n => `Ожидает: ${n}.`,
  notReported: 'Не сообщено', invalid: 'Не удалось прочитать сообщённые сведения',
  counts: {
    task: ['задача', 'задачи', 'задач', 'задачи'], arrow: ['стрелка', 'стрелки', 'стрелок', 'стрелки'],
    prerequisite: ['прямая записанная зависимость', 'прямые записанные зависимости', 'прямых записанных зависимостей', 'прямой записанной зависимости'],
    dependent: ['прямая зависимая задача', 'прямые зависимые задачи', 'прямых зависимых задач', 'прямой зависимой задачи'], related: ['связанная задача', 'связанные задачи', 'связанных задач', 'связанной задачи'],
    upstream: ['предшествующая задача', 'предшествующие задачи', 'предшествующих задач', 'предшествующей задачи'], downstream: ['последующая задача', 'последующие задачи', 'последующих задач', 'последующей задачи'],
    hidden: ['связанная задача', 'связанные задачи', 'связанных задач', 'связанной задачи'], unfinished: ['незавершённая записанная зависимость', 'незавершённые записанные зависимости', 'незавершённых записанных зависимостей', 'незавершённой записанной зависимости'],
  },
};
const ZH: typeof EN = {
  touchHelp: '触控：轻点卡片可选中任务，轻点背景可清除选择；单指拖动可平移，双指捏合可缩放。也可使用缩放和全部适配按钮；键盘导航和列表可替代拖动。',
  planView: '计划视图', list: '列表', map: '依赖图', under: '低于 1%', viewList: '查看列表', retry: '重试', heading: '依赖图',
  closeDetails: '关闭任务详情', helpTitle: '帮助和筛选', clearKey: ' 清除选择 · ',
  needsYou: '需要你处理', clearFilters: '清除', openSession: '打开会话',
  openingHint: tasks => `全部适配可显示所有 ${tasks}。`,
  stateCounts: (p, w, b, d, s) => `未开始 ${p}，进行中 ${w}，受阻 ${b}，已完成 ${d}，已跳过 ${s}`,
  panHelp: '。点击背景可清除选择；拖动背景或滚动可平移。Tab 离开依赖图。',
  panelHelp: '选择卡片，可在依赖图右侧面板查看其已记录的前置任务、后续任务和报告详情。关闭面板、按 Escape 或点击背景可清除选择。',
  arrowKey: '箭头图例。蓝色圆点：前置任务报告为进行中，而箭头指向的任务仍在等待或受阻。移动的圆点循环表示报告中的工作状态，不代表进度，也不能证明工作正在执行；静止圆点含义相同（减少动态效果、大型或缩小的依赖图上，以及所选任务关联链之外会停止移动）。箭头前的横杠：前置任务明确报告为受阻。虚线：前置任务已跳过。淡色：前置任务已完成。圆点和横杠仅显示在活动计划的当前依赖图上。',
  blockedSelection: ' 明确报告为受阻的任务，无论前置任务如何，都不会显示为已就绪。',
  verifiedActivity: '仅对已验证的分配显示会话活动。',
  mapDescription: '使用方向键浏览卡片。打开帮助和筛选可查看全部按键。',
  prerequisiteState: (n, working) => `${n} 个${working ? '进行中' : '受阻'}`,
  unfinishedStates: states => ` 其中未完成的已记录前置任务包括：${states}。`,
  waitingStates: (n, states) => `等待 ${n}${states ? `：${states}` : ''}。`,
  unavailable: '依赖图不可用', notFound: '此计划已无记录', error: '无法读取依赖图', updatingMap: '正在更新依赖图…', loading: '正在加载依赖图…',
  inconsistent: '当前计划无法匹配一致的依赖图，因此不再显示之前的图。任务列表不受影响。',
  unsupported: '进度服务无法提供此依赖图所需的已记录前置任务，因此不绘制任何内容。任务列表不受影响。',
  missing: '进度存储中已没有此计划。请选择其他计划或返回列表。',
  failed: '无法读取依赖图。为避免显示不完整的图，当前不显示任何内容。', updating: '正在更新…',
  changed: ' 读取依赖图时计划发生了变化。正在等待一致的图，不会绘制不完整的内容。',
  waitingPicture: '正在等待完整计划及其已记录的前置任务。两者一致之前不会绘制任何内容。',
  revision: r => `修订 ${r}`, showing: r => `正在显示修订 ${r}。`,
  latestFailed: r => `无法读取最新依赖图。当前显示上次报告的修订 ${r}；读取成功前隐藏“已就绪”和“接下来可解锁”。`,
  retained: r => ` 当前显示上次报告的修订 ${r}。匹配较新报告前隐藏“已就绪”和“接下来可解锁”。`,
  work: '当前工作', working: '进行中', ready: '已就绪', blocked: '受阻', unlocks: '接下来可解锁',
  guidance: '仅依据已记录的前置任务；“已就绪”和“接下来可解锁”均不是开始工作的许可。',
  closed: '此计划已关闭。卡片仅显示报告状态，不显示“已就绪”或“接下来可解锁”提示。',
  groupsOnly: '没有任务卡片。此计划仅记录了分组；其背景信息列于下方。 ', noTasksYet: '没有任务卡片。此计划尚未记录任务。 ',
  noPrerequisites: '此计划未记录前置任务', listOrder: '。卡片按列表顺序排列，没有箭头。',
  noTaskPrerequisites: '未记录任务之间的前置任务', groupArrows: '。分组前置任务列为分组背景信息，不绘制为箭头。',
  arrows: '箭头从已记录的前置任务指向依赖它的任务。这只是已记录的信息，不是日程，也不能证明工作已执行。',
  filters: '依赖图筛选', showTasks: '显示任务', all: '显示全部', unfinished: '未完成', allGroups: '所有分组', noGroup: '未记录分组', groupGone: '所选分组已无记录', group: '分组',
  filtered: (visible, tasks, hidden, arrows) => `显示 ${tasks} 中的 ${visible} · 被筛选条件隐藏 ${hidden}${arrows ? `、${arrows}` : ''}`,
  allShown: (tasks, arrows) => `显示全部 ${tasks}${arrows ? ` 和 ${arrows}` : ''}`,
  taskMap: '任务依赖图', mapView: '依赖图视图', zoom: z => `缩放 ${z}`, zoomOut: '缩小', zoomIn: '放大', fit: '全部适配', current: '聚焦当前工作',
  moved: where => `视图已向${where}移动。`, left: '左', up: '上', down: '下', right: '右', panLeft: '向左平移', panUp: '向上平移', panDown: '向下平移', panRight: '向右平移',
  sessionOnly: text => `${text}，仅表示会话活动`, groupPath: path => `分组：${path}`,
  direct: (up, down) => `${up}，${down}`, hiddenRelated: n => `被筛选条件隐藏 ${n}`, unlocksFor: n => `接下来可解锁 ${n}`,
  relative: (name, rel) => `${name}。所选任务的${rel}`, upstream: '上游', downstream: '下游',
  noCards: '没有任务卡片', emptyMap: '任务依赖图：没有任务卡片', gone: '所选分组已无记录。', noMatches: '没有任务符合这些筛选条件。', showAll: '显示全部任务',
  selected: '所选任务', select: '选择卡片以查看其已记录的前置任务、后续任务和报告详情。', noInspect: '没有可查看的任务卡片。', hidden: '被筛选条件隐藏',
  reason: '原因', next: '下一步', assignmentActivity: '分配和活动', assignment: '分配', links: '关联', reports: '报告', noReports: '未记录报告', activity: '会话活动', hiddenSuffix: ' · 被筛选条件隐藏',
  prerequisites: '已记录的前置任务', none: '未记录。', dependents: '后续任务', noDependents: '没有任务将此任务记录为前置任务。',
  chain: (up, down) => `图中已突出显示：此任务直接或间接等待的 ${up}，以及等待此任务的 ${down}。`,
  unlockHelp: titles => `若报告为已完成，将满足以下任务最后一个未完成的已记录前置任务：${titles}。这不是开始这些任务的许可。`,
  groupContext: '分组背景', groupHelp: (title, deps) => `分组“${title}”记录了自身的前置任务：${deps}。这些属于分组，而非此任务。`,
  hiddenHelp: n => `当前筛选条件隐藏了 ${n}。选择其中一个可重新显示。`,
  keys: '依赖图中的按键：', arrowKeys: '方向键', nearest: ' 最近的卡片 · ', firstPrerequisite: ' 第一个前置任务 · ', firstDependent: ' 第一个后续任务 · ', fitKey: ' 全部适配 · ', zoomKey: ' 缩放', drag: '。拖动背景或滚动可平移；Tab 离开依赖图。',
  selectionHelp: '选择卡片后，它等待的任务标为上游（实线边框），等待它的任务标为下游（双线边框）。',
  readinessHelp: '已就绪：所有已记录的前置任务均报告为已完成。接下来可解锁：若某卡片报告为已完成，将满足另一任务最后一个未完成的已记录前置任务。',
  attributionHelp: '已分配给：此修订中已验证的委派。未验证的受派人：已有记录，但没有已验证的委派。关联至：会话链接，不是分配。受派会话名称前的方块表示此视图的运行记录显示该会话当前活跃（实心）或等待输入（空心）。这不说明会话正在处理哪个任务。',
  groupDeps: deps => `记录了自身的前置任务：${deps}`, noGroupDeps: '未记录分组前置任务', groupMetadata: '分组的前置任务是分组元数据。任务不会继承这些前置任务，它们也不会绘制为箭头。',
  selectedMapTask: '所选依赖图任务', skippedHelp: '跳过的工作对后续任务而言不算已完成。', blockedHelp: '某个智能体明确报告此任务受阻。无论前置任务如何，均不会显示为已就绪。',
  closedPending: '计划关闭时报告为未开始。', pendingHelp: '报告为未开始。匹配当前修订前，已就绪状态会被隐藏。',
  readyDeps: '所有已记录的前置任务均报告为已完成。“已就绪”仅描述已记录的前置任务。', readyNoDeps: '未记录前置任务。“已就绪”仅描述已记录的前置任务。',
  skippedDeps: titles => `等待中：已记录的前置任务被跳过（${titles}），跳过的工作不算已完成。`, waitingDeps: n => `等待 ${n}。`,
  notReported: '未报告', invalid: '无法读取报告的详情',
  counts: {
    task: ['个任务', '个任务', '个任务', '个任务'], arrow: ['条箭头', '条箭头', '条箭头', '条箭头'],
    prerequisite: ['个直接已记录的前置任务', '个直接已记录的前置任务', '个直接已记录的前置任务', '个直接已记录的前置任务'],
    dependent: ['个直接后续任务', '个直接后续任务', '个直接后续任务', '个直接后续任务'], related: ['个关联任务', '个关联任务', '个关联任务', '个关联任务'],
    upstream: ['个上游任务', '个上游任务', '个上游任务', '个上游任务'], downstream: ['个下游任务', '个下游任务', '个下游任务', '个下游任务'],
    hidden: ['个关联任务', '个关联任务', '个关联任务', '个关联任务'], unfinished: ['个未完成的已记录前置任务', '个未完成的已记录前置任务', '个未完成的已记录前置任务', '个未完成的已记录前置任务'],
  },
};
const COPY: Record<InterfaceLanguage, typeof EN> = { en: EN, ru: RU, 'zh-CN': ZH };
function mapNoun(n: number, kind: keyof typeof EN.counts, language: InterfaceLanguage) {
  const category = new Intl.PluralRules(language).select(n);
  const index = ({ one: 0, few: 1, many: 2, other: 3 } as Record<string, number>)[category] ?? 3;
  return COPY[language].counts[kind][index];
}
function mapNumber(n: number, language: InterfaceLanguage) {
  return language === 'en' ? String(n) : formatCount(n, language);
}
function mapCount(n: number, kind: keyof typeof EN.counts, language: InterfaceLanguage) {
  return `${mapNumber(n, language)} ${mapNoun(n, kind, language)}`;
}
/** World padding around the full-plan layout; slot coordinates (data-x/y) stay unpadded. */
const PAD = 28;
const SVG = 'http://www.w3.org/2000/svg';
let instances = 0;

/**
 * Map CSS lives only with the map (Work Status, which never mounts it, ships none). One
 * `<style data-map-style>` per document in `<head>`, after the shared sheet and outside every
 * repainted root, so remounts and root replacement neither duplicate nor drop it.
 */
function ensureMapStyle(doc: Document) {
  if (doc.head.querySelector('style[data-map-style]')) return;
  const style = doc.createElement('style');
  style.dataset.mapStyle = '';
  style.textContent = MAP_CSS;
  doc.head.append(style);
}

/**
 * The frame's one polite live region, appended to `<body>` outside every repainted root. Created
 * only by a map-capable frame (Work Status never mounts the view). Repaints never write to it.
 */
function mapAnnouncer(doc: Document) {
  let node = doc.querySelector<HTMLElement>('[data-testid="map-announcer"]');
  if (!node) {
    node = doc.createElement('div');
    node.className = 'ap-sr';
    node.dataset.testid = 'map-announcer';
    node.setAttribute('role', 'status');
    node.setAttribute('aria-live', 'polite');
    node.setAttribute('aria-atomic', 'true');
    doc.body.append(node);
  }
  return node;
}

/**
 * Plan view: List / Map, a pressed-button pair (same look as the list's Show all / Unfinished).
 * Lightweight in-frame switch; no tab or router semantics. Buttons are marked as focus owners so a
 * pending List → Map handoff survives focus staying on the activated switch.
 */
export function planViewSwitch(presentation: 'list' | 'map', onChange: (next: 'list' | 'map') => void, language: InterfaceLanguage = 'en') {
  const c = COPY[language];
  ensureMapStyle(document);
  const group = testid(el('div', 'ap-map-switch'), 'plan-view');
  group.setAttribute('role', 'group');
  const label = el('span', 'ap-map-switch-label', c.planView);
  label.id = `ap-plan-view-${++instances}`;
  group.setAttribute('aria-labelledby', label.id);
  const set = el('div', 'ap-map-pair');
  for (const [mode, text] of [['list', c.list], ['map', c.map]] as const) {
    const holder = button(set, `plan-view-${mode}`, text, () => onChange(mode), presentation === mode ? 'outline' : 'ghost');
    const b = holder.querySelector('button');
    b?.setAttribute('aria-pressed', String(presentation === mode));
    b?.setAttribute('data-map-focus-owner', '');
  }
  group.append(label, set);
  return group;
}

const ICONS = {
  'zoom-out': 'M3.5 8h9',
  'zoom-in': 'M3.5 8h9M8 3.5v9',
  fit: 'M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10',
  current: 'M8 1.5v2.5M8 12v2.5M1.5 8H4M12 8h2.5M11 8a3 3 0 1 1-6 0a3 3 0 1 1 6 0',
  left: 'M9.5 3.5 5 8l4.5 4.5',
  right: 'M6.5 3.5 11 8l-4.5 4.5',
  up: 'M3.5 9.5 8 5l4.5 4.5',
  down: 'M3.5 6.5 8 11l4.5-4.5',
  close: 'M4 4l8 8M12 4l-8 8',
} as const;
function icon(name: keyof typeof ICONS) {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('class', 'ap-map-icon'); svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
  const path = document.createElementNS(SVG, 'path');
  path.setAttribute('d', ICONS[name]);
  svg.append(path);
  return svg;
}
const zoomText = (zoom: number, language: InterfaceLanguage) => zoom * 100 < 1 ? COPY[language].under : `${Math.round(zoom * 100)}%`;

function markOf(item: ItemView, fact: DerivedTask | undefined, guidance: boolean): Mark {
  if (item.status !== 'pending') return item.status;
  // Ready/Waiting are recorded-prerequisite guidance: only for an active plan's current picture.
  if (!guidance) return 'pending';
  return fact?.group === 'ready' ? 'ready' : fact?.group === 'skipped' ? 'waiting-skipped' : 'waiting';
}

// ── Arrow state (pure; no DOM). One cue per recorded prerequisite → dependent pair, from the
// reported endpoint statuses of the displayed picture only. Never another frame's picture, session
// activity or report age.
type Status = ItemView['status'];
/** `working`: beads; `blocked`: static stop bar; null: the arrow keeps its existing style. */
export type ArrowCue = 'working' | 'blocked' | null;
export function arrowCue(prerequisite: Status | undefined, dependent: Status | undefined): ArrowCue {
  if (prerequisite === 'working') return dependent === 'pending' || dependent === 'blocked' ? 'working' : null;
  if (prerequisite === 'blocked') return dependent === 'pending' || dependent === 'working' || dependent === 'blocked' ? 'blocked' : null;
  return null;
}
/** New cues only for an active, unarchived plan whose displayed picture is current and ready. */
export function arrowCuesEligible(plan: Pick<PlanView, 'lifecycle' | 'cleanup'>, picture: Pick<MapSnapshot, 'state' | 'current'>): boolean {
  return plan.lifecycle === 'active' && (plan.cleanup?.state ?? 'visible') === 'visible' && picture.current && picture.state === 'ready';
}
/**
 * Shipped rendering-cost bounds for arrow motion (docs/ui.md, Dependency map › Arrows). Full-plan
 * task arrows and eligible visible flows are inclusive ceilings; zoom is the inclusive minimum.
 * The contract's outer bounds are 300 arrows, 24 flows and 50% zoom; these may only be tighter.
 */
export const MAP_MOTION_LIMITS = { arrows: 300, flows: 24, zoom: 0.5 } as const;
export type ArrowMotionFallback = 'arrows' | 'flows' | 'zoom';
/** Why otherwise permitted motion falls back to stationary beads, or null within every bound. */
export function arrowMotionFallback(c: { arrows: number; flows: number; zoom: number }, limits: { arrows: number; flows: number; zoom: number } = MAP_MOTION_LIMITS): ArrowMotionFallback | null {
  if (c.arrows > limits.arrows) return 'arrows';
  if (c.flows > limits.flows) return 'flows';
  if (!(c.zoom >= limits.zoom)) return 'zoom';
  return null;
}
/**
 * Eligible visible flows: working arrows whose endpoints are both shown; while a selection
 * highlights a chain, only that chain's working arrows (off-chain beads are stationary anyway).
 */
export function arrowFlowCount(edges: readonly (readonly [string, string])[], status: (id: string) => Status | undefined, visible: (id: string) => boolean, chain: ((from: string, to: string) => boolean) | null): number {
  let n = 0;
  for (const [a, z] of edges) if (visible(a) && visible(z) && arrowCue(status(a), status(z)) === 'working' && (!chain || chain(a, z))) n++;
  return n;
}
/**
 * The frame owner's affirmative motion permission: Map shown in a visible frame, an eligible
 * picture, and the existing reported-work gate (last read succeeded, capture on, something
 * reported working) over the DISPLAYED picture's plan and tasks.
 */
export function mapMotionPermitted(snapshot: Pick<MapSnapshot, 'state' | 'current' | 'picture'>, view: { fresh: boolean; captureEnabled: boolean }, shown: boolean, visible: boolean): boolean {
  const picture = snapshot.picture;
  if (!shown || !visible || !picture) return false;
  const plan = picture.detail.plan;
  if (!arrowCuesEligible(plan, snapshot)) return false;
  const working = picture.detail.detail.items.filter(i => i.kind === 'task' && i.status === 'working').length;
  return showsLiveness(plan.lifecycle, { working }, view);
}
/** A waiting task's direct recorded prerequisites, each counted once (hidden by filters or not). */
export function prerequisiteCounts(fact: Pick<DerivedTask, 'prerequisites'> | undefined) {
  const seen = new Map<string, DerivedTask['prerequisites'][number]>();
  for (const p of fact?.prerequisites ?? []) if (!seen.has(p.id)) seen.set(p.id, p);
  const all = [...seen.values()];
  const task = (s: Status) => all.filter(p => p.kind === 'task' && p.status === s).length;
  return { unfinished: all.filter(p => p.kind !== 'task' || p.status !== 'done').length, working: task('working'), blocked: task('blocked') };
}
/** "1 reported working, 1 explicitly blocked" (zero parts omitted); '' when both are zero. */
export function prerequisiteStates(c: { working: number; blocked: number }, language: InterfaceLanguage = 'en'): string {
  const text = COPY[language];
  return [c.working ? text.prerequisiteState(mapNumber(c.working, language), true) : '', c.blocked ? text.prerequisiteState(mapNumber(c.blocked, language), false) : ''].filter(Boolean).join(language === 'zh-CN' ? '，' : ', ');
}

function mark(kind: Mark) {
  const m = el('span', 'ap-map-mark');
  m.dataset.mark = kind;
  m.setAttribute('aria-hidden', 'true');
  return m;
}

/** Preserve the focused card across the owner's root commit, not merely its focus key.
 * Other nodes use the ordinary paint. The card gets this paint's attributes, contents
 * and click closure, while its native focus/accessibility identity survives the move.
 * Older engines keep the owner's existing logical-focus restoration fallback.
 */
export function preserveMapFocus(previous: HTMLElement, next: HTMLElement) {
  const active = previous.ownerDocument.activeElement;
  if (!(active instanceof HTMLButtonElement) || !previous.contains(active) || !active.matches('.ap-map-card')) return;
  const oldRegion = active.closest<HTMLElement>('[data-map-identity]');
  const region = next.querySelector<HTMLElement>('[data-map-identity]');
  if (!oldRegion?.dataset.mapIdentity || oldRegion.dataset.mapIdentity !== region?.dataset.mapIdentity) return;
  const fresh = region.querySelector<HTMLButtonElement>(`.ap-map-card[data-task="${CSS.escape(active.dataset.task!)}"]`);
  const parent = fresh?.parentElement as (HTMLElement & { moveBefore?: (node: Node, before: Node | null) => void }) | null;
  if (!fresh || !parent || typeof parent.moveBefore !== 'function') return;
  for (const a of [...active.attributes]) if (!fresh.hasAttribute(a.name)) active.removeAttribute(a.name);
  for (const a of [...fresh.attributes]) if (active.getAttribute(a.name) !== a.value) active.setAttribute(a.name, a.value);
  if (active.innerHTML !== fresh.innerHTML) active.replaceChildren(...fresh.childNodes);
  active.onclick = fresh.onclick;
  parent.moveBefore(active, fresh);
  fresh.remove();
}

export function createDependencyMapView(): DependencyMapView {
  let host: HTMLElement | null = null, input: DependencyMapViewInput | null = null;
  const uid = `ap-map-${++instances}`;
  // Native scroll position of the read-only canvas, kept across root replacement for the same plan only.
  let scroll = { key: '', left: 0, top: 0 };
  let focusCard: string | null = null;
  let observer: ResizeObserver | null = null, canvasWidth = 0;
  // Interactive frame-local presentation: current painted nodes, coalesced viewport frame, a pending
  // generation-bound focus action and the last painted canvas position (screen continuity).
  let viewportNode: HTMLElement | null = null, worldNode: HTMLElement | null = null, zoomNode: HTMLElement | null = null;
  let zoomTimer: ReturnType<typeof setTimeout> | undefined;
  const zoomFeedback = () => {
    if (!zoomNode) return;
    clearTimeout(zoomTimer); zoomNode.hidden = false;
    zoomTimer = setTimeout(() => { if (zoomNode) zoomNode.hidden = true; }, 1600);
  };
  // Arrow motion: the painted region and, when this paint was permitted to move beads, its count
  // facts. Zoom is the only bound that changes without a paint (applied with the viewport).
  let regionNode: HTMLElement | null = null, motionCounts: { arrows: number; flows: number } | null = null;
  let frame = 0, releasing = false;
  // True from a paint until the owner has finished restoring its pre-paint focus (same turn):
  // that focusin is passive and must not move the viewport.
  let restoring = false, suppressFocusReveal = false;
  // Latest announcement token and its deferred repeat frame, if any.
  let spoken = 0, speakFrame = 0;
  let pendingFocus: { id: string | null; generation: number; reveal?: boolean } | null = null;
  let painted = { key: '', viewport: null as HTMLElement | null };
  let listening: Document | null = null, announcer: HTMLElement | null = null;
  // Controller speech waits one task (after this turn's focus and any repaint's restore; a timer, not
  // an animation frame, so a throttled window can't hold it back). A
  // selection description is dropped when its own card took focus: the card's name already says
  // it, so it is spoken once (from the focus), not twice. Everything else is spoken.
  let speech: { text: string; message?: MapAnnouncement; selection: string | null; focus: string | null; identity: string | null; generation: number; timer: ReturnType<typeof setTimeout> | undefined } | null = null;
  // The task a `selection` command named in this turn (cleared at the end of the turn), and the
  // card a pointer press just moved focus onto (cleared once its click has dispatched).
  let turnSelection: string | null = null, pointerFocused: string | null = null;
  // Each painted card's name without the selection-relative Upstream/Downstream phrase.
  let baseNames = new Map<string, string>();
  const binding = () => input?.interaction ?? null;
  let helpNode: HTMLDetailsElement | null = null, helpIdentity: string | null = null;
  let removeHelpListeners = () => {};
  let outsidePointer: number | null = null, outsideTimer: ReturnType<typeof setTimeout> | null = null;
  function cancelOutside() { if (outsideTimer !== null) clearTimeout(outsideTimer); outsideTimer = null; outsidePointer = null; }
  function clearHelp() { removeHelpListeners(); removeHelpListeners = () => {}; cancelOutside(); if (helpNode) helpNode.open = false; helpNode = null; helpIdentity = null; }


  function dropSpeech() { if (speech) clearTimeout(speech.timer); speech = null; }
  function clearAnnouncements() {
    dropSpeech(); turnSelection = pointerFocused = null;
    if (speakFrame) cancelAnimationFrame(speakFrame);
    speakFrame = 0; spoken++;
    if (announcer?.textContent) announcer.textContent = '';
  }
  function queueSpeech(text: string, message?: MapAnnouncement) {
    const b = binding(); if (!b || !text) return;
    dropSpeech();
    const { identity, generation } = b.state();
    // Reconcile can emit the first List → Map selection before render supplies its
    // ready picture. Resolve the title at delivery, not against the loading input.
    const item = { text, message, selection: turnSelection, focus: null as string | null, identity, generation, timer: undefined as ReturnType<typeof setTimeout> | undefined };
    if (item.selection && item.selection === pointerFocused) item.focus = item.selection;
    item.timer = setTimeout(() => {
      if (speech !== item) return;
      speech = null;
      const now = binding()?.state();
      if (!now?.active || now.identity !== item.identity || now.generation !== item.generation) return;
      const active = document.activeElement as HTMLElement | null;
      // Only the selection description itself ("<title>. <state>. …") can be dropped.
      if (item.message?.kind === 'selection' && item.selection && item.focus === item.selection && document.hasFocus() && active?.matches('.ap-map-card') && active.dataset.task === item.selection) return;
      announce(item.message ? mapAnnouncementText(item.message, input?.language ?? 'en') : item.text);
    }, 0);
    speech = item;
  }
  /** A keyboard move focuses the card in the current DOM before the repaint: give it its fresh name first. */
  function markSelected(id: string | null) {
    const v = viewportNode; if (!v?.isConnected) return;
    for (const n of v.querySelectorAll<HTMLElement>('.ap-map-card[aria-current="true"]')) n.removeAttribute('aria-current');
    const card = id === null ? null : v.querySelector<HTMLElement>(`.ap-map-card[data-task="${CSS.escape(id)}"]`);
    const name = id === null ? undefined : baseNames.get(id);
    if (card) { card.setAttribute('aria-current', 'true'); if (name) card.setAttribute('aria-label', name); }
  }

  function announce(raw: string) {
    const node = announcer, b = binding(); if (!node || !raw || !b) return;
    const text = raw;
    dropSpeech(); // a direct outcome (zoom, pan) is newer than any queued controller message
    // A newer message always wins: it cancels any deferred repeat still waiting for its frame.
    const token = ++spoken;
    if (speakFrame) { cancelAnimationFrame(speakFrame); speakFrame = 0; }
    if (node.textContent !== text) { node.textContent = text; return; }
    // Same words again still speak: clear, then set on the next frame. The repeat belongs to this
    // action only: leaving Map, a reading change, retirement or disposal drops it.
    const { identity, generation } = b.state();
    node.textContent = '';
    speakFrame = requestAnimationFrame(() => {
      speakFrame = 0;
      const now = binding()?.state();
      if (token === spoken && announcer === node && now?.active && now.identity === identity && now.generation === generation) node.textContent = text;
    });
  }
  function applyViewport() {
    const b = binding(); if (!b || !worldNode) return;
    const t = b.state().transform;
    // Slot coordinates are unpadded; the world carries PAD of padding on every side.
    worldNode.style.transform = `translate(${t.x - PAD * t.zoom}px,${t.y - PAD * t.zoom}px) scale(${t.zoom})`;
    worldNode.style.setProperty('--ap-map-zoom', String(t.zoom));
    if (zoomNode) { const language = input?.language ?? 'en'; zoomNode.textContent = zoomText(t.zoom, language); zoomNode.setAttribute('aria-label', COPY[language].zoom(zoomText(t.zoom, language))); }
    applyMotion(t.zoom);
  }
  /**
   * The map region's own reported-work gate (`data-motion="on"`, style.ts/app.ts phase). Set only
   * while this paint's permission and every cost bound hold; otherwise beads are stationary and no
   * map animation exists. Animations started by setting it join the shared phase (app.ts).
   */
  function applyMotion(zoom: number) {
    const r = regionNode; if (!r) return;
    const fallback = motionCounts ? arrowMotionFallback({ ...motionCounts, zoom }) : null;
    if (motionCounts && !fallback && motionCounts.flows > 0) { if (r.dataset.motion !== 'on') r.dataset.motion = 'on'; } else delete r.dataset.motion;
    if (motionCounts && fallback) r.dataset.motionFallback = fallback; else delete r.dataset.motionFallback;
  }
  function revokeMotion() {
    motionCounts = null;
    if (input?.motion) input = { ...input, motion: false };
    applyMotion(0);
  }
  function scheduleViewport() {
    if (frame) return;
    frame = requestAnimationFrame(() => { frame = 0; applyViewport(); });
  }
  /** Bring a focused card into the guest page vertically (the canvas itself is already panned). */
  function revealInPage(node: HTMLElement) {
    const r = node.getBoundingClientRect(), page = node.ownerDocument.scrollingElement;
    if (!page) return;
    if (r.top < 0) page.scrollTop += r.top - 8;
    else if (r.bottom > innerHeight) page.scrollTop += Math.min(r.top - 8, r.bottom - innerHeight + 8);
  }
  /** `settle`: this is the post-connect pass, after the owner's own focus restoration. */
  function tryFocus(settle: boolean) {
    const b = binding(), want = pendingFocus;
    if (!b || !want || !viewportNode?.isConnected) return false;
    // A newer view/reading generation retires the action; another frame's focus is never taken.
    if (want.generation !== b.state().generation || !document.hasFocus()) { pendingFocus = null; return true; }
    const target = want.id === null ? (viewportNode.matches('[data-map-empty-target]') ? viewportNode : viewportNode.querySelector<HTMLElement>('[data-map-empty-target]')) ?? viewportNode.closest('[data-testid="map-region"]')?.querySelector<HTMLElement>('h2') ?? null
      : viewportNode.querySelector<HTMLElement>(`[data-task="${CSS.escape(want.id)}"]`);
    if (!target) return false;
    if (settle) pendingFocus = null;
    if (target.matches('.ap-map-card')) {
      for (const n of viewportNode.querySelectorAll<HTMLElement>('.ap-map-card[tabindex="0"]')) if (n !== target) n.tabIndex = -1;
      target.tabIndex = 0;
    } else if (target.tagName === 'H2') target.tabIndex = -1;
    applyViewport();
    suppressFocusReveal = want.reveal === false;
    try { target.focus({ preventScroll: true }); } finally { suppressFocusReveal = false; }
    if (want.reveal !== false) revealInPage(target);
    return true;
  }
  function capture(pointerId: number, on: boolean) {
    const v = viewportNode; if (!v) return;
    if (on) { try { v.setPointerCapture(pointerId); v.dataset.dragging = ''; } catch { /* pointer already gone */ } return; }
    delete v.dataset.dragging;
    if (v.hasPointerCapture(pointerId)) { releasing = true; try { v.releasePointerCapture(pointerId); } finally { releasing = false; } }
  }
  // Frame-owned gesture listeners survive root replacement; capture is rebound to each new viewport.
  // A finger that started on the canvas: whether this touch gesture panned or pinched, so the card's
  // native click after it is not also a selection. Keyboard clicks (detail 0) are never suppressed.
  let touchGesture: { starts: Map<number, { x: number; y: number }>; panned: boolean; zoom: number; identity: string | null; generation: number } | null = null, suppressTap = false;
  const gestureOf = (id: number) => { const b = binding()?.state(); return !!b && (b.dragging === id || b.pinching === id); };
  const onMove = (e: PointerEvent) => {
    const start = touchGesture?.starts.get(e.pointerId);
    if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) >= MAP_TOUCH.slop) touchGesture!.panned = true;
    const b = binding(); if (b && gestureOf(e.pointerId)) b.dispatch({ type: 'pointer-move', pointerId: e.pointerId, point: { x: e.clientX, y: e.clientY } });
  };
  const onEnd = (e: PointerEvent) => {
    if (touchGesture?.starts.delete(e.pointerId) && !touchGesture.starts.size) {
      const state = binding()?.state(), zoom = state?.transform.zoom;
      if (e.type === 'pointerup' && state?.active && state.identity === touchGesture.identity && state.generation === touchGesture.generation && zoom !== undefined && zoom !== touchGesture.zoom) {
        const language = input?.language ?? 'en';
        zoomFeedback(); announce(COPY[language].zoom(zoomText(zoom, language)));
      }
      suppressTap = touchGesture.panned; touchGesture = null;
    }
    const b = binding(); if (b && gestureOf(e.pointerId)) b.dispatch({ type: 'pointer-end', pointerId: e.pointerId, point: { x: e.clientX, y: e.clientY }, cancelled: e.type !== 'pointerup' });
  };
  const onFocusIn = (e: FocusEvent) => { const t = e.target as Element | null; if (t?.closest) { binding()?.focusOwner(!!t.closest('[data-testid="map-region"],[data-map-focus-owner]')); binding()?.dispatch({ type: 'canvas-focus', id: t.closest<HTMLElement>('[data-testid="map-viewport"] button[data-task]')?.dataset.task ?? null }); } };
  const onBlur = () => binding()?.focusOwner(false);
  function listen(doc: Document) {
    if (listening === doc) return;
    unlisten(); listening = doc;
    doc.addEventListener('pointermove', onMove); doc.addEventListener('pointerup', onEnd); doc.addEventListener('pointercancel', onEnd);
    doc.addEventListener('focusin', onFocusIn); doc.defaultView?.addEventListener('blur', onBlur);
  }
  function unlisten() {
    const doc = listening; if (!doc) return; listening = null;
    doc.removeEventListener('pointermove', onMove); doc.removeEventListener('pointerup', onEnd); doc.removeEventListener('pointercancel', onEnd);
    doc.removeEventListener('focusin', onFocusIn); doc.defaultView?.removeEventListener('blur', onBlur);
  }

  function paint() {
    observer?.disconnect(); observer = null;
    const previousHelp = helpNode, previousIdentity = helpIdentity;
    const wasOpen = previousHelp?.open ?? false;
    removeHelpListeners(); removeHelpListeners = () => {}; helpNode = null;
    baseNames = new Map();
    if (!host || !input) return;
    // The owner restores focus synchronously after attaching this paint's root; this microtask runs
    // after that, so the restoration's focusin is recognised as passive.
    restoring = true; queueMicrotask(() => { restoring = false; });
    const v = input, b = v.interaction ?? null;
    const language = v.language ?? 'en', c = COPY[language], marks = MARK_TEXT[language];
    const sentenceEnd = language === 'zh-CN' ? '。' : '.';
    const count = (n: number, kind: keyof typeof EN.counts) => mapCount(n, kind, language);
    if (b) { listen(host.ownerDocument); announcer = mapAnnouncer(host.ownerDocument); }
    const st = b?.state() ?? null;
    // Wide board: the selection panel over the canvas's right edge (0: the stacked inspector).
    const panel = b && v.frame === 'board' ? Math.max(0, v.panel ?? 0) : 0;
    // Unavailable/not found never draw a diagram, even when the coordinator still holds an older
    // picture (e.g. replacement detail without usable identity): no stale map presented as Updating.
    const retainedUnavailable = !!v.picture && (v.state === 'unavailable' || v.state === 'not-found');
    const p = retainedUnavailable ? null : v.picture, layout = p ? v.layout : null;
    const region = testid(el('article', 'ap-map'), 'map-region');
    regionNode = region; motionCounts = null;
    region.setAttribute('role', 'region');
    if (st?.identity) region.dataset.mapIdentity = st.identity;
    region.dataset.frame = v.frame;
    region.setAttribute('aria-labelledby', `${uid}-title`);
    region.dataset.state = v.state; region.dataset.current = String(v.current);
    region.dataset.revision = String(p?.graph.revision ?? '');
    region.dataset.tasks = String(layout?.order.length ?? 0); region.dataset.edges = String(layout?.edges.length ?? 0);
    if (b) region.dataset.interactive = '';
    if (v.coarse) region.dataset.pointer = 'coarse';

    const listButton = (parent: Element) => button(parent, 'map-list', c.viewList, () => v.onList(v.selected), 'outline');
    const retryButton = (parent: Element) => button(parent, 'map-retry', c.retry, v.onRetry, 'outline');

    // ── No diagram: loading, unavailable, not found, failed. View as list always stays reachable.
    if (!p) {
      if (v.viewSwitch) region.append(v.viewSwitch);
      const head = el('header', 'ap-map-head');
      const top = el('div', 'ap-map-top');
      const titles = el('div', 'ap-map-titles');
      titles.append(el('p', 'ap-h', c.heading));
      const heading = el('h2', 'ap-plan-title', v.state === 'unavailable' ? c.unavailable : v.state === 'not-found' ? c.notFound : v.state === 'error' ? c.error : v.state === 'updating' ? c.updatingMap : c.loading);
      heading.id = `${uid}-title`;
      titles.append(heading);
      const actions = el('div', 'ap-map-actions');
      listButton(actions);
      top.append(titles, actions);
      head.append(top);
      region.append(head);
      const state = testid(el('div', 'ap-map-notice'), 'map-state');
      state.dataset.state = v.state;
      if (v.state === 'unavailable') {
        state.dataset.tone = 'neutral';
        state.append(el('p', '', retainedUnavailable
          ? c.inconsistent : c.unsupported));
      } else if (v.state === 'not-found') {
        state.dataset.tone = 'neutral';
        state.append(el('p', '', c.missing));
      } else if (v.state === 'error') {
        state.dataset.tone = 'warning';
        const row = el('div', 'ap-map-notice-row');
        row.append(el('p', '', c.failed));
        retryButton(row);
        state.append(row);
      } else {
        state.dataset.tone = 'quiet';
        const row = el('div', 'ap-map-notice-row');
        if (v.state === 'updating') {
          const text = el('p');
          text.append(el('strong', '', c.updating), c.changed);
          row.append(text);
          retryButton(row);
        } else row.append(el('p', '', c.waitingPicture));
        state.append(row);
      }
      region.append(state);
      viewportNode = worldNode = zoomNode = null; painted = { key: '', viewport: null };
      host.replaceChildren(region);
      return;
    }

    // ── Picture facts (all from one consistent picture)
    const plan = p.detail.plan, items = p.detail.detail.items;
    const byId = new Map(items.map(i => [i.id, i]));
    const tasks = items.filter(i => i.kind === 'task'), groups = items.filter(i => i.kind === 'group');
    const stateCount = (status: ItemView['status']) => mapNumber(tasks.filter(i => i.status === status).length, language);
    region.removeAttribute('aria-labelledby');
    region.setAttribute('aria-label', `${plan.title}. ${count(tasks.length, 'task')}. ${c.stateCounts(stateCount('pending'), stateCount('working'), stateCount('blocked'), stateCount('done'), stateCount('skipped'))}`);
    const bound = p.detail.snapshot?.identity.binding;
    const stateWord = (item: ItemView, kind: Mark) => plan.lifecycle === 'active' && v.current && bound?.verified && bound.sourceId === plan.sourceId && itemNeedsYou(plan, item) ? c.needsYou : marks[kind];
    const facts = v.facts?.tasks;
    const active = plan.lifecycle === 'active';
    const guidance = active && v.current;
    const ancestors = (id: string) => {
      const out: ItemView[] = []; const seen = new Set<string>([id]);
      for (let i = byId.get(id); i?.parentId && !seen.has(i.parentId);) { seen.add(i.parentId); i = byId.get(i.parentId); if (i) out.unshift(i); }
      return out;
    };
    const groupPath = (id: string) => ancestors(id).filter(g => g.kind === 'group').map(g => g.title);
    const groupIds = new Set(groups.map(g => g.id));
    const groupGone = v.group !== null && v.group !== '' && !groupIds.has(v.group);
    const inGroup = (id: string) => {
      if (v.group === null) return true;
      const chain = ancestors(id).filter(g => g.kind === 'group');
      return v.group === '' ? chain.length === 0 : chain.some(g => g.id === v.group);
    };
    const match = statusMatch(v.status);
    const visible = new Set(tasks.filter(i => (!match || match(i)) && inGroup(i.id)).map(i => i.id));
    const edges = layout?.edges ?? [];
    const shownEdges = edges.filter(([a, b]) => visible.has(a) && visible.has(b));
    const hiddenTasks = (layout?.order.length ?? tasks.length) - [...visible].filter(id => layout?.positions.has(id) ?? true).length;
    const hiddenEdges = edges.length - shownEdges.length;
    // Direct counts per task, and relationships of a shown task whose other end the filters hide.
    const inCount = new Map<string, number>(), outCount = new Map<string, number>(), hiddenRelCount = new Map<string, number>();
    const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
    for (const [a, z] of edges) { bump(outCount, a); bump(inCount, z); if (visible.has(a) !== visible.has(z)) bump(hiddenRelCount, visible.has(a) ? a : z); }
    const anyRecorded = items.some(i => i.dependencies?.length);
    const groupOwned = groups.filter(g => g.dependencies?.length);
    const unlocking = (id: string) => guidance && byId.get(id)?.status !== 'skipped' ? [...facts?.get(id)?.unlocksNext ?? []] : [];
    const titleOf = (id: string) => byId.get(id)?.title ?? id;
    const sessionName = v.label ?? ((sid: string) => sessionLabel(sid, EMPTY_LIVE, language));
    const copies = new Map<string, MapAttributionCopy>();
    const attributionOf = (id: string) => {
      let c = copies.get(id);
      if (!c) copies.set(id, c = attributionCopy(v.attribution?.get(id), v.current, p.graph.revision, sessionName, language));
      return c;
    };
    const selected = v.selected && byId.get(v.selected)?.kind === 'task' ? byId.get(v.selected)! : null;
    // Upstream/downstream emphasis: fresh on-demand closure walks for the selection only.
    const upstreamSet = selected && layout ? v.facts?.upstream(selected.id) ?? null : null;
    const downstreamSet = selected && layout ? v.facts?.downstream(selected.id) ?? null : null;
    const related = (id: string) => upstreamSet?.has(id) ? 'upstream' : downstreamSet?.has(id) ? 'downstream' : null;
    const highlight = !!selected && visible.has(selected.id);
    if (highlight) region.dataset.highlight = 'true';
    const roving = b ? st!.roving && visible.has(st!.roving) ? st!.roving : layout?.order.find(id => visible.has(id)) ?? null : null;

    // ── State and dependency context; title/progress/counts belong to the shell.
    const head = el('header', 'ap-map-head');
    const heading = testid(el('h2', 'ap-plan-title', plan.title), 'map-title');
    heading.id = `${uid}-title`;
    // The shell already owns the title/progress/counts. Keep the literal title as a stable QA hook,
    // but not another visible or accessible heading.
    heading.hidden = true;
    head.append(heading);

    // State line: quiet when current; Updating/failed keep the last consistent picture, labelled.
    const state = testid(el('div', 'ap-map-notice'), 'map-state');
    state.dataset.state = v.state;
    const stateRow = el('div', 'ap-map-notice-row');
    if (v.current && v.state === 'ready') {
      state.dataset.tone = 'none';
      stateRow.append(el('p', 'ap-sr', c.showing(p.graph.revision)));
    } else if (v.state === 'error') {
      state.dataset.tone = 'warning';
      stateRow.append(el('p', '', c.latestFailed(p.graph.revision)));
      retryButton(stateRow);
    } else {
      state.dataset.tone = 'quiet';
      const text = el('p');
      text.append(el('strong', '', c.updating), c.retained(p.graph.revision));
      stateRow.append(text);
      retryButton(stateRow);
    }
    state.append(stateRow);

    // Recorded-information qualification and D5 statements.
    const context = testid(el('p', 'ap-map-context'), 'map-context');
    // A taskless plan keeps its explanation AND the dependency statement that is true for it: D5's exact
    // sentence when nothing records prerequisites; group-owned prerequisites get the task-to-task wording.
    if (!tasks.length) context.append(groups.length ? c.groupsOnly : c.noTasksYet);
    if (!anyRecorded) context.append(el('strong', '', c.noPrerequisites), tasks.length ? c.listOrder : '.');
    else if (!edges.length) context.append(el('strong', '', c.noTaskPrerequisites), c.groupArrows);
    else context.hidden = true;
    head.append(state, context);
    head.hidden = v.current && v.state === 'ready' && context.hidden;
    region.append(head);

    // ── Controls: Show all / Unfinished (the list's pressed pair and predicate) and group subtree filter.
    const controls = el('div', 'ap-map-controls');
    controls.setAttribute('role', 'group');
    controls.setAttribute('aria-label', c.filters);
    const status = testid(el('div', 'ap-map-pair'), 'map-status');
    status.setAttribute('role', 'group');
    status.setAttribute('aria-label', c.showTasks);
    status.dataset.mode = v.status;
    for (const [value, label] of [['all', c.all], ['unfinished', c.unfinished]] as const) {
      const holder = button(status, `map-status-${value}`, label, () => { if (v.status !== value) v.onStatus(value); }, v.status === value ? 'outline' : 'ghost');
      holder.querySelector('button')?.setAttribute('aria-pressed', String(v.status === value));
    }
    const field = (label: string, control: HTMLSelectElement) => { const f = el('label', 'ap-map-field'); f.append(el('span', 'ap-map-field-label', label), control); return f; };
    const group = testid(el('select', 'ap-map-select'), 'map-group');
    const option = (value: string, label: string) => { const o = el('option', '', label); o.value = value; group.append(o); };
    option('*', c.allGroups); option('', c.noGroup);
    for (const g of groups) option(g.id, [...groupPath(g.id), g.title].join(' › '));
    if (groupGone) option(v.group!, c.groupGone);
    group.value = v.group ?? '*'; group.onchange = () => v.onGroup(group.value === '*' ? null : group.value);
    controls.append(status, field(c.group, group));
    const hidden = testid(el('p', 'ap-map-hidden'), 'map-hidden');
    Object.assign(hidden.dataset, { tasks: String(hiddenTasks), edges: String(hiddenEdges) });
    if (tasks.length) {
      hidden.textContent = hiddenTasks
        ? c.filtered(mapNumber(visible.size, language), count(tasks.length, 'task'), count(hiddenTasks, 'task'), hiddenEdges ? count(hiddenEdges, 'arrow') : '')
        : c.allShown(count(tasks.length, 'task'), edges.length ? count(edges.length, 'arrow') : '');
    }
    controls.append(hidden);
    const filtered = v.status !== 'all' || v.group !== null;
    if (filtered) {
      const line = testid(el('div', 'ap-map-filter-line'), 'map-filter-line');
      line.append(el('span', '', hidden.textContent ?? ''));
      button(line, 'map-filter-clear', c.clearFilters, () => {
        if (b) b.dispatch({ type: 'filters', status: 'all', group: null });
        else { v.onStatus('all'); v.onGroup(null); }
      }, 'ghost');
      region.append(line);
    }

    // ── Body: stage (toolbar + canvas) and inspector (beside on a wide board, stacked in the rail)
    const body = el('div', 'ap-map-body');
    const stage = el('div', 'ap-map-stage');
    const viewport = testid(el('div', 'ap-map-viewport'), 'map-viewport');
    viewport.setAttribute('role', 'region');
    viewport.setAttribute('aria-label', c.taskMap);
    const scrollKey = `${plan.key}`;
    const helpId = `${uid}-help`;
    let world: HTMLElement | null = null;
    let toolbar: HTMLElement | null = null;
    if (layout && b) viewport.style.height = `min(${layout.order.length ? Math.ceil(layout.height * (v.coarse ? 1 : MAP_ZOOM.readable) + 32) : 180}px, ${v.frame === 'rail' || v.coarse ? '300px' : '64vh'})`;
    if (b) {
      viewport.dataset.interactive = '';
      viewport.setAttribute('aria-describedby', helpId);
      if (st!.dragging !== null) viewport.dataset.dragging = '';
      const t0 = st!.transform;
      toolbar = testid(el('div', 'ap-map-toolbar'), 'map-toolbar');
      toolbar.setAttribute('role', 'group');
      toolbar.setAttribute('aria-label', c.mapView);
      const tool = (id: string, name: keyof typeof ICONS, label: string, run: () => void, text = false) => {
        const t = testid(el('button', 'ap-map-tool'), id);
        t.type = 'button';
        t.append(icon(name));
        if (text) { t.append(el('span', '', label)); t.dataset.text = ''; } else { t.setAttribute('aria-label', label); t.title = label; }
        t.onclick = run;
        return t;
      };
      const zoomBy = (factor: number) => { const bb = binding(); if (bb?.dispatch({ type: 'zoom', factor })) { zoomFeedback(); announce(`${c.zoom(zoomText(bb.state().transform.zoom, language))}${sentenceEnd}`); } };
      const zoomSet = el('div', 'ap-map-tool-set');
      zoomNode = testid(el('span', 'ap-map-zoom', zoomText(t0.zoom, language)), 'map-zoom-level');
      zoomNode.hidden = true;
      zoomNode.setAttribute('aria-label', c.zoom(zoomText(t0.zoom, language)));
      zoomSet.append(tool('map-zoom-out', 'zoom-out', c.zoomOut, () => zoomBy(1 / MAP_ZOOM.step)), tool('map-zoom-in', 'zoom-in', c.zoomIn, () => zoomBy(MAP_ZOOM.step)));
      const fit = tool('map-fit-all', 'fit', c.fit, () => binding()?.dispatch({ type: 'fit' }));
      if (v.viewSwitch) toolbar.append(v.viewSwitch);
      toolbar.append(zoomSet, fit, zoomNode);
      stage.append(toolbar);

      // Keys only while the canvas (a card or the empty target) owns focus; never modified/browser keys.
      viewport.addEventListener('keydown', e => {
        const target = e.target as HTMLElement, bb = binding();
        const canvas = target === viewport || target.classList.contains('ap-map-card');
        if (!bb || !canvas || e.defaultPrevented || e.isComposing) return;
        const modified = e.ctrlKey || e.metaKey || e.altKey || (e.shiftKey && e.key.startsWith('Arrow'));
        if (!bb.dispatch({ type: 'key', key: e.key, canvas, modified, editable: false })) return;
        e.preventDefault();
        if (e.key === '+' || e.key === '-') { zoomFeedback(); announce(`${c.zoom(zoomText(bb.state().transform.zoom, language))}${sentenceEnd}`); }
      });
      // Tab into an off-screen roving card: pan just enough to show it (no selection change). Passive
      // focus restoration after a repaint (e.g. an unchanged poll) never pans: the reader's pan stays.
      viewport.addEventListener('focusin', e => {
        const card = e.target as HTMLElement, bb = binding();
        if (!bb || restoring || suppressFocusReveal || !card.classList.contains('ap-map-card')) return;
        const r = card.getBoundingClientRect(), box = viewport.getBoundingClientRect(), inset = 8;
        const shift = (start: number, end: number, lo: number, hi: number) => start < lo + inset ? lo + inset - start : end > hi - inset ? Math.max(lo + inset - start, hi - inset - end) : 0;
        // While the selection panel is open it covers the canvas's right edge: stay clear of it.
        const right = box.right - (panel && bb.state().selected ? panel + MAP_PANEL.margin : 0);
        const dx = shift(r.left, r.right, box.left, right), dy = shift(r.top, r.bottom, box.top, box.bottom);
        if (dx || dy) { bb.dispatch({ type: 'pan', x: dx, y: dy }); applyViewport(); }
        revealInPage(card);
      });
      // Mouse/pen: a background drag pans; cards are buttons and never start a drag. Touch: one finger
      // pans from the background or a card (a tap still selects through the card's click), two pinch.
      // Other controls inside the canvas (Show all tasks) keep their own touch behaviour.
      viewport.addEventListener('pointerdown', e => {
        const bb = binding(); if (!bb) return;
        const control = (e.target as Element).closest('button,a,select,input,textarea,summary');
        const touch = e.pointerType === 'touch';
        if (touch) {
          if (control && !control.classList.contains('ap-map-card')) return;
          if (!touchGesture) { const state = bb.state(); touchGesture = { starts: new Map(), panned: false, zoom: state.transform.zoom, identity: state.identity, generation: state.generation }; suppressTap = false; }
          touchGesture.starts.set(e.pointerId, { x: e.clientX, y: e.clientY });
          if (touchGesture.starts.size > 1) touchGesture.panned = true;
          const box = viewport.getBoundingClientRect();
          bb.dispatch({ type: 'pointer-down', pointerId: e.pointerId, point: { x: e.clientX, y: e.clientY }, background: !control, primary: true, touch: true, origin: { x: box.left, y: box.top } });
          return;
        }
        suppressTap = false;
        bb.dispatch({ type: 'pointer-down', pointerId: e.pointerId, point: { x: e.clientX, y: e.clientY }, background: !control, primary: e.isPrimary && e.button === 0 && !e.ctrlKey && !e.metaKey });
      });
      viewport.addEventListener('lostpointercapture', e => {
        // Root replacement detaches this node: that loss is rebound, not a gesture end. Only the
        // canvas's own capture counts: a card losing a finger's implicit capture to the canvas bubbles here.
        const bb = binding();
        if (e.target === viewport && !releasing && viewport.isConnected && bb && gestureOf(e.pointerId)) bb.dispatch({ type: 'pointer-end', pointerId: e.pointerId, cancelled: true });
      });
      // A long press must never open the platform's callout or text selection over the canvas.
      viewport.addEventListener('contextmenu', e => { if (touchGesture) e.preventDefault(); });
      // Wheel/trackpad pans inside the canvas only. Ctrl/Cmd (browser zoom, pinch) is left alone.
      viewport.addEventListener('wheel', e => {
        const bb = binding(); if (!bb || e.ctrlKey || e.metaKey) return;
        const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? viewport.clientHeight : 1;
        const dx = (e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX) * unit, dy = (e.shiftKey && !e.deltaX ? 0 : e.deltaY) * unit;
        if (bb.dispatch({ type: 'pan', x: -dx, y: -dy })) e.preventDefault();
      }, { passive: false });
    } else {
      if (scroll.key !== scrollKey) scroll = { key: scrollKey, left: 0, top: 0 };
      viewport.addEventListener('scroll', () => { scroll = { key: scrollKey, left: viewport.scrollLeft, top: viewport.scrollTop }; }, { passive: true });
    }

    if (layout) {
      const m = layout.metrics;
      world = testid(el('div', 'ap-map-world'), 'map-world');
      const width = layout.width + PAD * 2, height = layout.height + PAD * 2;
      world.style.width = `${width}px`; world.style.height = `${height}px`;
      if (b) {
        const t = st!.transform;
        world.style.transformOrigin = '0 0';
        world.style.transform = `translate(${t.x - PAD * t.zoom}px,${t.y - PAD * t.zoom}px) scale(${t.zoom})`;
        world.style.setProperty('--ap-map-zoom', String(t.zoom));
      }
      const svg = document.createElementNS(SVG, 'svg');
      svg.setAttribute('class', 'ap-map-edges');
      svg.setAttribute('width', String(width)); svg.setAttribute('height', String(height));
      svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
      svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
      const defs = document.createElementNS(SVG, 'defs');
      // Blocked markers add a stop bar just before the arrowhead (same tip, same 0.9 scale).
      for (const tone of ['open', 'quiet', 'path', 'working', 'blocked', 'blocked-path'] as const) {
        const bar = tone.startsWith('blocked');
        const marker = document.createElementNS(SVG, 'marker');
        marker.id = `${uid}-arrow-${tone}`;
        marker.setAttribute('class', `ap-map-marker ap-map-marker-${tone}`);
        for (const [k, val] of [['viewBox', bar ? '-9 -2 19 14' : '0 0 10 10'], ['refX', '9'], ['refY', '5'], ['markerWidth', bar ? '17.1' : '9'], ['markerHeight', bar ? '12.6' : '9'], ['markerUnits', 'userSpaceOnUse'], ['orient', 'auto']]) marker.setAttribute(k, val);
        const head = document.createElementNS(SVG, 'path');
        head.setAttribute('d', 'M 0 0.5 L 10 5 L 0 9.5 z');
        head.setAttribute('class', 'ap-map-arrowhead');
        marker.append(head);
        if (bar) { const stop = document.createElementNS(SVG, 'path'); stop.setAttribute('d', 'M -8 -1.5 L -4.5 -1.5 L -4.5 11.5 L -8 11.5 z'); stop.setAttribute('class', 'ap-map-stopbar'); marker.append(stop); }
        defs.append(marker);
      }
      svg.append(defs);
      // Working beads that may move live in their own small decorative layer (same size, viewBox and
      // world transform), so a moving dash never invalidates the full arrow drawing. Off-chain beads
      // during a selection are stationary and stay with the static drawing.
      const flowLayer = document.createElementNS(SVG, 'svg');
      flowLayer.setAttribute('class', 'ap-map-edges ap-map-flows');
      for (const k of ['width', 'height', 'viewBox']) flowLayer.setAttribute(k, svg.getAttribute(k)!);
      flowLayer.setAttribute('aria-hidden', 'true'); flowLayer.setAttribute('focusable', 'false');
      const cues = arrowCuesEligible(plan, v);
      // Spread ports along card sides so converging arrowheads stay distinguishable.
      const ports = (side: 0 | 1) => {
        const by = new Map<string, string[]>();
        for (const e of shownEdges) { const own = e[side], other = e[side ? 0 : 1]; const list = by.get(own) ?? []; list.push(other); by.set(own, list); }
        for (const list of by.values()) list.sort((a, b) => layout.positions.get(a)!.y - layout.positions.get(b)!.y || layout.order.indexOf(a) - layout.order.indexOf(b));
        return (own: string, other: string) => { const list = by.get(own)!; const n = list.length, k = list.indexOf(other); const step = Math.min(14, (m.height - 28) / Math.max(1, n - 1)); return m.height / 2 + (k - (n - 1) / 2) * step; };
      };
      const outPort = ports(0), inPort = ports(1);
      const pitch = m.height + m.rowGap;
      const lastRow = Math.max(0, ...[...layout.positions.values()].map(s => s.row));
      const onPath: SVGPathElement[] = [];
      const sel = selected?.id;
      const chainOf = (from: string, to: string) => !highlight || !sel ? null : (to === sel || upstreamSet?.has(to)) && upstreamSet?.has(from) ? 'upstream' as const : (from === sel || downstreamSet?.has(from)) && downstreamSet?.has(to) ? 'downstream' as const : null;
      const flows = cues ? arrowFlowCount(shownEdges, id => byId.get(id)?.status, id => visible.has(id), highlight && sel ? (a, z) => !!chainOf(a, z) : null) : 0;
      for (const [from, to] of shownEdges) {
        const a = layout.positions.get(from)!, bb = layout.positions.get(to)!;
        const x1 = a.x + m.width + PAD, y1 = a.y + PAD + outPort(from, to);
        const x2 = bb.x + PAD - 1, y2 = bb.y + PAD + inPort(to, from);
        const dx = Math.max(24, (x2 - x1) * 0.5);
        // Adjacent columns: one curve inside the column gap. Longer spans travel along a row gap
        // (slots share one grid, so it is free of cards in every column) instead of behind cards.
        let d = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
        if (bb.column - a.column > 1) {
          const mid = (y1 + y2) / 2 - PAD;
          const gap = Math.min(lastRow, Math.max(-1, Math.round((mid - m.height - m.rowGap / 2) / pitch)));
          const yc = PAD + gap * pitch + m.height + m.rowGap / 2;
          const xa = x1 + m.columnGap * 0.7, xb = x2 - m.columnGap * 0.7;
          const ka = (xa - x1) / 2, kb = (x2 - xb) / 2;
          d = `M ${x1} ${y1} C ${x1 + ka} ${y1}, ${xa - ka} ${yc}, ${xa} ${yc} L ${xb} ${yc} C ${xb + kb} ${yc}, ${x2 - kb} ${y2}, ${x2} ${y2}`;
        }
        const prereq = byId.get(from)?.status;
        const tone = prereq === 'done' || prereq === 'skipped' ? 'quiet' : 'open';
        const cue = cues ? arrowCue(prereq, byId.get(to)?.status) : null;
        const path = document.createElementNS(SVG, 'path');
        path.setAttribute('class', 'ap-map-edge');
        path.dataset.tone = tone;
        if (prereq === 'skipped') path.dataset.skipped = 'true';
        if (cue) path.dataset.arrow = cue;
        path.setAttribute('data-from', from); path.setAttribute('data-to', to);
        path.setAttribute('d', d);
        // An edge lies on the selection's chain when both ends are in its upstream (or downstream) closure.
        const way = chainOf(from, to);
        if (way) path.dataset.path = way;
        path.setAttribute('marker-end', `url(#${uid}-arrow-${cue === 'blocked' ? way ? 'blocked-path' : 'blocked' : way ? 'path' : cue ?? tone})`);
        if (way) onPath.push(path); else svg.append(path);
        if (cue === 'working') {
          // Decorative beads over the canonical edge; never data-from/data-to, so counts stay single.
          const bead = document.createElementNS(SVG, 'path');
          bead.setAttribute('class', 'ap-map-bead');
          bead.setAttribute('d', d);
          bead.dataset.flowFrom = from; bead.dataset.flowTo = to;
          if (way) bead.dataset.chain = way;
          if (highlight && !way) svg.append(bead);
          else flowLayer.append(bead);
        }
      }
      svg.append(...onPath); // chain arrows paint above the rest
      world.append(svg);
      if (flowLayer.firstChild) world.append(flowLayer);
      region.dataset.flows = String(flows);
      // Motion needs this paint's affirmative permission and an interactive viewport (zoom bound).
      motionCounts = v.motion === true && cues && b ? { arrows: edges.length, flows } : null;
      applyMotion(st?.transform.zoom ?? 0);

      for (const id of layout.order) {
        if (!visible.has(id)) continue;
        const i = byId.get(id), slot = layout.positions.get(id);
        if (!i || !slot) continue;
        const fact = facts?.get(id), kind = markOf(i, fact, guidance), unlocks = unlocking(id);
        const card = testid(el('button', 'ap-map-card'), `map-card-${id}`);
        card.type = 'button';
        Object.assign(card.dataset, { task: id, x: String(slot.x), y: String(slot.y), status: i.status, readiness: guidance ? fact?.group ?? '' : '', unlocks: unlocks.join(','), mark: kind });
        if (selected?.id === id) card.setAttribute('aria-current', 'true');
        const rel = highlight ? related(id) : null;
        if (rel) card.dataset.related = rel;
        if (b) card.tabIndex = id === roving ? 0 : -1;
        Object.assign(card.style, { left: `${slot.x + PAD}px`, top: `${slot.y + PAD}px`, width: `${m.width}px`, height: `${m.height}px` });
        const path = groupPath(id);
        const prereqs = inCount.get(id) ?? 0, dependents = outCount.get(id) ?? 0, hiddenRel = hiddenRelCount.get(id) ?? 0;
        const statusRow = el('span', 'ap-map-card-status');
        statusRow.append(mark(kind), el('span', 'ap-map-card-word', stateWord(i, kind)));
        const title = el('span', 'ap-map-card-title', i.title);
        // A proven running session gets one line without taking the title's second line.
        const who = attributionOf(id);
        card.dataset.attribution = who.kind;
        if (who.live) card.dataset.live = who.live.kind;
        card.append(statusRow, title);
        if (who.live && who.session) {
          card.dataset.who = '';
          const line = testid(el('span', 'ap-map-card-who'), `map-card-who-${id}`);
          line.dataset.attribution = who.kind;
          const text = el('span', 'ap-map-card-who-text');
          // Session activity: a small square (status marks are round) placed on the assigned SESSION's
          // name, never beside the task's status words. Inline in this fixed line, so it moves nothing
          // else; its words are in the card's name, the inspector and the map help.
          if (who.live && who.session) {
            const live = testid(el('span', 'ap-map-live-mark'), `map-card-live-${id}`);
            live.dataset.live = who.live.kind; live.setAttribute('aria-hidden', 'true');
            text.append(live, who.session);
          }
          line.append(text);
          card.append(line);
        }
        // The card's name is what a screen reader speaks when a selection focuses it (the map
        // announcer then stays quiet), so it carries title, state and direct counts in full.
        const name = [
          i.title, stateWord(i, kind), who.live ? who.session ?? '' : '', who.live ? c.sessionOnly(who.live.text) : '',
          path.length ? c.groupPath(path.join(' › ')) : '',
          c.direct(count(prereqs, 'prerequisite'), count(dependents, 'dependent')),
          hiddenRel ? c.hiddenRelated(count(hiddenRel, 'related')) : '',
          unlocks.length ? c.unlocksFor(count(unlocks.length, 'task')) : '',
        ].filter(Boolean).join(language === 'zh-CN' ? '。' : '. ');
        baseNames.set(id, name);
        card.setAttribute('aria-label', rel ? c.relative(name, rel === 'upstream' ? c.upstream : c.downstream) : name);
        // A click whose press moved focus onto this card has already had its name spoken.
        card.onpointerdown = () => { pointerFocused = document.activeElement === card ? null : id; };
        card.onclick = e => {
          // The click a browser may still deliver after a finger panned or pinched is not a tap.
          if (b && suppressTap && e.detail > 0) { suppressTap = false; pointerFocused = null; return; }
          if (b) b.dispatch({ type: 'select', id }); else v.onSelect(id); pointerFocused = null;
        };
        world.append(card);
        // Chain tag: a label on the card's top edge, outside its clipped content, so it never competes
        // with status words or chips. Decorative: the card's name carries the same words.
        if (rel) {
          const tag = el('span', 'ap-map-card-rel', rel === 'upstream' ? c.upstream : c.downstream);
          tag.dataset.related = rel; tag.setAttribute('aria-hidden', 'true');
          Object.assign(tag.style, { left: `${slot.x + PAD + m.width - 10}px`, top: `${slot.y + PAD - 8}px` });
          world.append(tag);
        }
      }
      if (!tasks.length || !visible.size) {
        const empty = testid(el('div', 'ap-map-empty'), 'map-empty');
        if (!tasks.length) {
          empty.append(el('p', '', c.noCards));
          // One named focus target for an empty canvas.
          if (b) { viewport.tabIndex = 0; viewport.dataset.mapEmptyTarget = ''; viewport.setAttribute('aria-label', c.emptyMap); }
        } else {
          empty.append(el('p', '', groupGone ? c.gone : c.noMatches));
          const clear = el('div', 'ap-map-actions');
          const holder = button(clear, 'map-clear-filters', c.showAll, () => { if (b) b.dispatch({ type: 'filters', status: 'all', group: null }); else { if (v.status !== 'all') v.onStatus('all'); if (v.group !== null) v.onGroup(null); } }, 'outline');
          holder.querySelector('button')?.setAttribute('data-map-empty-target', '');
          empty.append(clear);
        }
        viewport.append(empty);
      }
      viewport.append(world);
    }
    // Wide board: the canvas and the selection panel share one positioned box (the panel sits over
    // the canvas's right edge, after the canvas in DOM and Tab order); otherwise the inspector stacks.
    const canvasBox = panel ? el('div', 'ap-map-canvas') : null;
    if (canvasBox) { canvasBox.append(viewport); stage.append(canvasBox); } else stage.append(viewport);
    body.append(stage);

    // ── Inspector: literal text only; relationships are explicit records, never inferred.
    const inspector = testid(el('section', 'ap-map-inspector'), 'map-inspector');
    inspector.setAttribute('aria-labelledby', `${uid}-inspector`);
    const ih = el('h3', 'ap-h', c.selected); ih.id = `${uid}-inspector`;
    inspector.hidden = !selected;
    if (selected) {
      inspector.tabIndex = 0;
      // Every layout can scroll internally; preserve only this reading's same-task position.
      inspector.dataset.scrollKey = `map-inspector|${st?.identity ?? plan.key}|${selected.id}`;
    }
    if (panel) {
      inspector.dataset.placement = 'over';
      inspector.style.width = `${panel}px`;
      // Shown only with a selection: no empty panel (the hint lives in the map help instead).
      if (!selected) inspector.hidden = true;
      else {
        // A focusable, labelled region so long content scrolls by keyboard; never modal.
        const head = el('div', 'ap-map-inspector-head');
        const close = testid(el('button', 'ap-map-tool ap-map-close'), 'map-inspector-close');
        close.type = 'button';
        close.append(icon('close'));
        close.setAttribute('aria-label', c.closeDetails);
        close.title = c.closeDetails;
        // The same clear-selection action as a background click: “Selection cleared.”, focus to the card.
        close.onclick = () => { binding()?.dispatch({ type: 'clear' }); };
        head.append(ih, close);
        inspector.append(head);
      }
    }
    if (!inspector.firstChild) inspector.append(ih);
    if (!selected) {
      inspector.dataset.selected = '';
      inspector.append(el('p', 'ap-note', tasks.length ? c.select : c.noInspect));
    } else {
      const id = selected.id, fact = facts?.get(id), kind = markOf(selected, fact, guidance);
      inspector.dataset.selected = id;
      const status = el('p', 'ap-map-card-status');
      status.dataset.mark = kind;
      status.append(mark(kind), el('span', 'ap-map-card-word', stateWord(selected, kind)));
      if (!visible.has(id)) status.append(el('span', 'ap-map-tag', c.hidden));
      inspector.append(status, el('p', 'ap-map-inspector-title', selected.title));
      const explain = readinessText(selected, fact, guidance, active, titleOf, arrowCuesEligible(plan, v), language);
      if (explain) inspector.append(el('p', 'ap-note', explain));
      const factsList = el('dl', 'ap-map-facts');
      const fact2 = (label: string, value: string | Node) => { const d = el('div'); d.append(el('dt', '', label)); const dd = el('dd'); dd.append(value); d.append(dd); factsList.append(d); };
      const path = groupPath(id);
      if (selected.status === 'blocked') {
        const bl = selected.reportedBlocker;
        fact2(c.reason, blockerPart(bl, 'reason', language));
        fact2(c.next, blockerPart(bl, 'nextAction', language));
      }
      inspector.append(factsList);
      // Who: verified assignment, link-only and unverified context, reports and session activity,
      // each as its own recorded fact. Never “unassigned” for a missing projection.
      const who = attributionOf(id);
      const ws = testid(el('div', 'ap-map-rel ap-map-who'), 'map-attribution');
      Object.assign(ws.dataset, { assignment: who.kind, live: who.live?.kind ?? '' });
      // Only proven current session activity belongs in the compact summary. Full assignment and
      // report provenance already lives in Troubleshooting → Advanced details.
      const whoList = el('dl', 'ap-map-facts');
      const row = (label: string, testId: string, lines: (string | Node)[], note: string | null = null) => {
        const d = testid(el('div'), testId); d.append(el('dt', '', label));
        const dd = el('dd');
        lines.forEach((line, n) => { if (n) dd.append(el('br')); dd.append(line); });
        if (note) dd.append(el('span', 'ap-map-who-note', note));
        d.append(dd); whoList.append(d);
      };
      let activity: string | Node = who.activity;
      if (who.live) {
        // The mark is decorative here: the words beside it say the same thing.
        const mark = el('span', 'ap-map-live-mark'); mark.dataset.live = who.live.kind; mark.setAttribute('aria-hidden', 'true');
        const words = el('strong', 'ap-map-who-live'); words.dataset.live = who.live.kind;
        words.append(mark, who.live.text);
        activity = words;
      }
      if (who.live && who.session) {
        row(who.session, 'map-attribution-live', [activity]);
        ws.append(whoList);
        const open = v.sessionAction?.(v.attribution?.get(id)?.assignment?.childSessionId ?? '');
        if (open) ws.append(open);
        inspector.append(ws);
      }
      const relationList = (label: string, ids: readonly string[], none: string, testId: string, kindOf: 'upstream' | 'downstream') => {
        const sec = testid(el('div', 'ap-map-rel'), testId);
        sec.dataset.related = kindOf;
        sec.append(el('h4', 'ap-map-rel-h', `${label} (${mapNumber(ids.length, language)})`));
        if (!ids.length) { sec.append(el('p', 'ap-note', none)); return sec; }
        const ul = el('ul', 'ap-map-rel-list');
        for (const rid of ids) {
          const r = byId.get(rid); if (!r) continue;
          const li = el('li');
          const rk = markOf(r, facts?.get(rid), guidance);
          const btn = testid(el('button', 'ap-map-rel-item'), `map-relation-${rid}`);
          btn.type = 'button';
          btn.append(mark(rk));
          const text = el('span', 'ap-map-rel-text');
          text.append(el('span', 'ap-map-rel-title', r.title));
          const sub = el('span', 'ap-map-rel-sub', stateWord(r, rk));
          if (!visible.has(rid)) sub.append(c.hiddenSuffix);
          text.append(sub);
          btn.append(text);
          btn.onclick = () => {
            // Reveal only what hides the requested task, then select it and move focus there.
            if (b) { b.dispatch({ type: 'relation', id: rid }); return; }
            if (match && !match(r)) v.onStatus('all');
            if (!inGroup(rid)) v.onGroup(null);
            focusCard = rid; v.onSelect(rid);
          };
          li.append(btn); ul.append(li);
        }
        sec.append(ul);
        return sec;
      };
      const upstream = layout ? edges.filter(([, b]) => b === id).map(([a]) => a) : [];
      const downstream = layout ? edges.filter(([a]) => a === id).map(([, b]) => b) : [];
      const order = (ids: string[]) => layout ? layout.order.filter(n => ids.includes(n)) : ids;
      inspector.append(relationList(c.prerequisites, order(upstream), c.none, 'map-prerequisites', 'upstream'));
      inspector.append(relationList(c.dependents, order(downstream), c.noDependents, 'map-dependents', 'downstream'));
      const unlocks = unlocking(id);
      if (unlocks.length) {
        const u = testid(el('div', 'ap-map-rel'), 'map-unlocks');
        u.append(el('h4', 'ap-map-rel-h', c.unlocks));
        u.append(el('p', 'ap-note', c.unlockHelp(order(unlocks).map(titleOf).join('; '))));
        inspector.append(u);
      }
      // Ancestor groups' own recorded prerequisites: labelled group metadata, never task arrows.
      const owned = ancestors(id).filter(g => g.kind === 'group' && g.dependencies?.length);
      if (owned.length) {
        const g = testid(el('div', 'ap-map-rel'), 'map-group-prerequisites');
        g.append(el('h4', 'ap-map-rel-h', c.groupContext));
        for (const o of owned) g.append(el('p', 'ap-note', c.groupHelp(o.title, (o.dependencies ?? []).map(titleOf).join('; '))));
        inspector.append(g);
      }
      const hiddenRel = [...upstream, ...downstream].filter(r => !visible.has(r)).length;
      if (hiddenRel) inspector.append(el('p', 'ap-note', c.hiddenHelp(count(hiddenRel, 'hidden'))));
    }
    if (canvasBox) canvasBox.append(inspector); else body.append(inspector);
    region.append(body);

    // A native disclosure needs no global popup machinery. Keep it open across same-reading
    // repaints, and retire its outside listeners on every repaint, leave or disposal.
    const help = testid(el('details', 'ap-map-help'), 'map-help');
    const identity = st?.identity ?? plan.key;
    help.open = !!wasOpen && previousIdentity === identity && (st?.active ?? true);
    const summaryHelp = testid(el('summary', 'ap-map-help-trigger', '?'), 'map-help-trigger');
    summaryHelp.setAttribute('aria-label', c.helpTitle);
    summaryHelp.title = c.helpTitle;
    if (filtered) summaryHelp.dataset.filtered = '';
    help.append(summaryHelp);
    const helpBody = el('div', 'ap-map-help-body');
    if (b) {
      const keys = el('p', 'ap-map-keys');
      const k = (text: string) => el('kbd', '', text);
      const nowrap = (...parts: (string | Node)[]) => { const n = el('span', 'ap-map-nowrap'); n.append(...parts); return n; };
      keys.append(el('strong', '', c.keys), k(c.arrowKeys), c.nearest, k('['), c.firstPrerequisite, k(']'), c.firstDependent, k('Escape'), c.clearKey, k('F'), c.fitKey, nowrap(k('+'), ' ', k('−'), c.zoomKey), c.panHelp);
      helpBody.append(keys);
      if (v.coarse) helpBody.append(testid(el('p', '', c.touchHelp), 'map-touch-help'));
      if (panel) helpBody.append(el('p', '', c.panelHelp));
    }
    helpBody.append(controls, el('p', '', c.arrows));
    helpBody.append(el('p', '', c.select));
    helpBody.append(testid(el('p', '', c.arrowKey), 'map-arrow-key'));
    helpBody.append(el('p', '', `${c.guidance} ${c.readinessHelp}`));
    helpBody.append(el('p', '', c.selectionHelp + c.blockedSelection));
    if (selected && highlight && ((upstreamSet?.size ?? 0) + (downstreamSet?.size ?? 0))) helpBody.append(el('p', 'ap-map-chain', c.chain(count(upstreamSet?.size ?? 0, 'upstream'), count(downstreamSet?.size ?? 0, 'downstream'))));
    if (selected) {
      const who = attributionOf(selected.id);
      if (who.kind === 'assigned' && who.assignmentNote) helpBody.append(el('p', '', who.assignmentNote));
      if (who.live) helpBody.append(el('p', '', ATTRIBUTION[language].hedge));
      else if (who.activityNote === ATTRIBUTION[language].assignmentOnly) helpBody.append(el('p', '', c.verifiedActivity));
    }
    helpBody.append(testid(el('p', '', c.attributionHelp), 'map-attribution-help'));
    help.append(helpBody);
    // Do not collapse on pointerdown: the in-flow disclosure would move the pressed control
    // before pointerup. A click has a fixed target; for canceled/non-click gestures close after
    // pointerup, with the pending action surviving a same-reading repaint.
    const outside = (event: Event) => event.target instanceof Node && !help.contains(event.target);
    const closeOutside = () => { cancelOutside(); if (helpNode?.open && helpIdentity === identity) helpNode.open = false; };
    const onOutsideDown = (event: PointerEvent) => { if (help.open && outside(event)) { cancelOutside(); outsidePointer = event.pointerId; } };
    const onOutsideUp = (event: PointerEvent) => {
      if (outsidePointer !== event.pointerId) return;
      outsidePointer = null;
      outsideTimer = setTimeout(closeOutside, 0);
    };
    const onOutsideCancel = (event: PointerEvent) => { if (outsidePointer === event.pointerId) closeOutside(); };
    const onOutsideClick = (event: MouseEvent) => { if (help.open && outside(event)) closeOutside(); };
    const onHelpKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && help.open) { event.preventDefault(); cancelOutside(); help.open = false; summaryHelp.focus(); } };
    const doc = help.ownerDocument;
    doc.addEventListener('pointerdown', onOutsideDown, true); doc.addEventListener('pointerup', onOutsideUp, true);
    doc.addEventListener('pointercancel', onOutsideCancel, true); doc.addEventListener('click', onOutsideClick, true);
    help.addEventListener('keydown', onHelpKey);
    removeHelpListeners = () => { doc.removeEventListener('pointerdown', onOutsideDown, true); doc.removeEventListener('pointerup', onOutsideUp, true); doc.removeEventListener('pointercancel', onOutsideCancel, true); doc.removeEventListener('click', onOutsideClick, true); help.removeEventListener('keydown', onHelpKey); };
    helpNode = help; helpIdentity = identity;
    if (toolbar) toolbar.append(help); else region.prepend(help);
    if (layout && b && st && st.transform.zoom > fitProjection(layout, [...visible], { width: viewportNode?.clientWidth || 320, height: viewportNode?.clientHeight || 300 }, 16, v.frame === 'board' ? 1 : MAP_ZOOM.max).zoom + .001)
      stage.append(testid(el('p', 'ap-note ap-map-opening-hint', c.openingHint(count(visible.size, 'task'))), 'map-opening-hint'));
    if (b) { const description = el('p', 'ap-sr', c.mapDescription); description.id = helpId; region.append(description); }

    // ── Group context: legal group-owned prerequisites stay inspectable without becoming arrows.
    if (groupOwned.length || (!tasks.length && groups.length)) {
      const details = testid(el('details', 'ap-map-groups'), 'map-group-context');
      if (!tasks.length || !edges.length) details.open = true;
      details.append(el('summary', '', `${c.groupContext} (${mapNumber(groups.length, language)})`));
      const ul = el('ul', 'ap-map-group-list');
      for (const g of groups) {
        const li = el('li');
        li.append(el('span', 'ap-map-group-name', [...groupPath(g.id), g.title].join(' › ')));
        const deps = g.dependencies ?? [];
        li.append(el('span', 'ap-note', deps.length ? c.groupDeps(deps.map(titleOf).join('; ')) : c.noGroupDeps));
        ul.append(li);
      }
      details.append(ul, el('p', 'ap-note', c.groupMetadata));
      region.append(details);
    }

    // Screen continuity: where the same plan's canvas sat before this repaint (old root still attached).
    const before = b && painted.key === scrollKey && painted.viewport?.isConnected ? painted.viewport.getBoundingClientRect().top : null;
    viewportNode = viewport; worldNode = world; if (!b) zoomNode = null;
    painted = { key: scrollKey, viewport };
    host.replaceChildren(region);
    const restore = () => {
      if (!viewport.isConnected) return false;
      if (b) {
        // A scrolled reader keeps the canvas where it was on screen when header text changes height.
        const page = viewport.ownerDocument.scrollingElement;
        if (before !== null && page && page.scrollTop > 0) { const delta = viewport.getBoundingClientRect().top - before; if (Math.abs(delta) >= 1) page.scrollTop += delta; }
        // An active background drag (and a pinch's second finger) continues on the replacement canvas.
        for (const pointer of [b.state().dragging, b.state().pinching]) {
          if (pointer !== null && !viewport.hasPointerCapture(pointer)) {
            try { viewport.setPointerCapture(pointer); viewport.dataset.dragging = ''; } catch { b.dispatch({ type: 'pointer-end', pointerId: pointer, cancelled: true }); }
          }
        }
        tryFocus(true);
        return true;
      }
      if (scroll.left || scroll.top) { viewport.scrollLeft = scroll.left; viewport.scrollTop = scroll.top; }
      if (focusCard) {
        const target = viewport.querySelector<HTMLElement>(`[data-task="${CSS.escape(focusCard)}"]`);
        focusCard = null;
        if (target) { target.focus({ preventScroll: true }); target.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
      }
      return true;
    };
    // The owner attaches the root after paint; restore once it is connected (before display).
    queueMicrotask(() => { if (!restore()) requestAnimationFrame(restore); });
    if (v.onCanvasWidth && typeof ResizeObserver === 'function') {
      const report = v.onCanvasWidth;
      observer = new ResizeObserver(() => {
        const width = Math.floor(viewport.clientWidth - PAD * 2);
        if (width > 0 && width !== canvasWidth) { canvasWidth = width; report(width); }
      });
      observer.observe(viewport);
    }
  }
  return {
    render(next, nextInput) { ensureMapStyle(next.ownerDocument); host = next; input = nextInput; paint(); },
    mount(next) { ensureMapStyle(next.ownerDocument); host = next; paint(); },
    update(next) { input = next; paint(); },
    command(c) {
      switch (c.type) {
        case 'viewport': scheduleViewport(); break;
        case 'selection':
          // Remembered for this turn only, so the following announcement can be matched to it.
          turnSelection = c.id; queueMicrotask(() => { turnSelection = null; });
          markSelected(c.id);
          break;
        case 'announce': queueSpeech(c.text, c.message); break;
        case 'focus': {
          if (speech?.selection && speech.selection === c.id) speech.focus = c.id;
          // Focus now (keyboard moves feel immediate), and again after a repaint in this same turn:
          // the owner restores its pre-paint focus after replacing the root. The action always ends
          // with this turn (after any repaint's restore has run), consumed or not: a missing target
          // or a placeholder paint can never leave it waiting for a later poll.
          const want = pendingFocus = { id: c.id, generation: c.generation, reveal: c.reveal };
          tryFocus(false);
          queueMicrotask(() => queueMicrotask(() => { if (pendingFocus === want) pendingFocus = null; }));
          break;
        }
        case 'capture': capture(c.pointerId, c.capture); break;
        default: break; // filters and list reveal are frame state, owned by the frame
      }
    },
    clearAnnouncements,
    clearHelp,
    revokeMotion,
    dispose() {
      revokeMotion(); regionNode = null;
      observer?.disconnect(); observer = null; unlisten(); clearAnnouncements(); clearHelp();
      if (frame) cancelAnimationFrame(frame); frame = 0;
      clearTimeout(zoomTimer);
      host = null; input = null; viewportNode = worldNode = zoomNode = null; pendingFocus = null; painted = { key: '', viewport: null };
    },
  };
}

/** What one production frame paints into its map host this turn. */
export interface MapFramePaint {
  viewSwitch?: HTMLElement;
  plan: PlanView;
  /** The frame's reading scope: board filters/search run, or `rail:<selected session>`. Never the board's host session. */
  scope: string;
  /** This surface's ONE existing run visit (board: the plan's coordinator; rail: the selected session), or null. */
  runs: { request: RunRequest; panel: RunsPanel | null } | null;
  census: Census;
}
/**
 * One production map frame (board or rail): the frame-local snapshot coordinator, full-plan layout
 * cache, interaction controller and view, all outside the replaced root. The owner calls `sync` on
 * every paint with its reading plan (so explicit list targets belong to the right reading), `paint`
 * only while its Map view is shown, and forwards its controller hooks. Graph reads start only while
 * Map is shown and the frame is visible; leaving Map pauses them. Nothing is stored.
 */
export interface MapFrame<U> {
  /** Every paint. `shown`: this frame's Map view is the one painted now. */
  sync: (vc: ViewContext<U>, plan: PlanView | null, scope: string, shown: boolean) => void;
  /** The user activated Map (call before the UI change, so focus ownership is the activated control's). */
  enter: () => void;
  /** The user left Map without a list reveal (tab or switch). */
  leave: (reveal?: boolean) => void;
  /** Explicit list task focus/reveal or pointer selection in this frame's canonical list. */
  listTargets: (article: HTMLElement) => void;
  /** Explicit task reveal from another control in this reading, without moving keyboard focus. */
  revealTask: (id: string) => boolean;
  paint: (host: HTMLElement, vc: ViewContext<U>, input: MapFramePaint) => void;
  /** `listFocus`: the frame's List control (rail switch / board Progress tab), when nothing else took focus. */
  afterPaint: (root: HTMLElement, vc: ViewContext<U>, plan: PlanView | null, listFocus: (root: HTMLElement) => HTMLElement | null) => void;
  /**
   * Existing successful-refresh cadence: re-pin an unsettled map. Present only while this frame's Map
   * is shown (a painted frame, so its host is ready); otherwise undefined, so the owner's optional
   * `refreshed` hook is skipped entirely, including refreshes that start before the host is ready.
   */
  readonly refreshed: ((vc: ViewContext<U>) => void) | undefined;
  /** A new reading the identity key cannot see (rail session A → B → A): forget everything. */
  resetReading: () => void;
  retire: (reason: 'reset' | 'hidden' | 'dispose') => void;
}
const CARD_METRICS = { width: 220, height: 100, columnGap: 70, rowGap: 25 };

export function createMapFrame<U>(frame: 'board' | 'rail', showList: (vc: ViewContext<U>) => void): MapFrame<U> {
  const view = createDependencyMapView(), geometry = new DependencyMapLayout();
  let latest: ViewContext<U> | null = null, painting = false, shown = false;
  // Measured canvas, kept across root replacement. Until it is measured, a conservative single-card row.
  let canvasWidth = 0, canvasHeight = 400, mapWidth = 0;
  let lastLayout: MapLayout | null = null, lastGraph: MapPicture['graph'] | null = null, packedWidth = 0;
  let awaitingOpeningMeasurement = false;
  // View as list: reveal the map's selected task once in the canonical list of the same reading.
  let reveal: { id: string | null; identity: string | null } | null = null;
  let listTransition: { frame: number; bridge: HTMLElement; tabIndex: string | null } | null = null;
  function cancelListTransition() {
    const pending = listTransition;
    if (!pending) return;
    listTransition = null;
    cancelAnimationFrame(pending.frame);
    if (pending.tabIndex === null) pending.bridge.removeAttribute('tabindex');
    else pending.bridge.setAttribute('tabindex', pending.tabIndex);
  }
  const interaction = new DependencyMapInteraction(command => {
    view.command(command);
    if (command.type === 'selection' && !painting) latest?.setUi({});
    if (command.type === 'filters') { latest?.reading?.set({ status: command.status }); if (!painting) latest?.setUi({}); }
    if (command.type === 'list' && latest) {
      cancelListTransition();
      view.clearAnnouncements(); reveal = { id: command.id, identity: interaction.value.identity };
      const bridge = document.getElementById('root');
      const active = document.activeElement;
      if (frame !== 'rail' || !bridge || !document.hasFocus() || !active?.closest('[data-testid="plan-view-list"],[data-testid="map-list"]')) { showList(latest); return; }
      // The rail replaces the focused opener's ancestors. Orca processes their removal
      // before queued focus events and silently recovers to the new row, swallowing its
      // native name. Leave that subtree through the persistent guest container first.
      // Cross a painted frame: one rAF still runs before paint, and setUi renders in a
      // microtask. This is a DOM/accessibility lifetime boundary, not a speech timer.
      const request = reveal;
      const pending = { frame: 0, bridge, tabIndex: bridge.getAttribute('tabindex') };
      listTransition = pending;
      bridge.tabIndex = -1;
      bridge.focus({ preventScroll: true });
      pending.frame = requestAnimationFrame(() => {
        if (listTransition !== pending) return;
        pending.frame = requestAnimationFrame(() => {
          if (listTransition !== pending) return;
          const current = latest && shown && reveal === request && request.identity === interaction.value.identity && bridge.isConnected && document.hasFocus() && document.activeElement === bridge;
          if (current) showList(latest!);
          else if (reveal === request) reveal = null;
          cancelListTransition();
        });
      });
    }
  });
  const binding: MapInteractionBinding = { state: () => interaction.value, dispatch: event => interaction.dispatch(event), focusOwner: owns => interaction.focusOwner(owns) };
  const map = new DependencyMap(current => latest!.service(current), () => latest?.invalidate());
  const claimOf = (vc: ViewContext<U>, plan: PlanView, scope: string): MapClaim => ({
    account: vc.ctx.connection?.account ?? '', scope, read: vc.read!, plan, detail: vc.detailResult(plan), health: vc.health,
    refreshSerial: vc.refreshSerial, active: shown, visible: document.visibilityState !== 'hidden', failure: vc.failure,
  });
  const forget = () => { cancelListTransition(); view.clearAnnouncements(); view.clearHelp(); map.reset(); geometry.clear(); interaction.reset(); lastLayout = lastGraph = null; packedWidth = 0; canvasWidth = mapWidth = 0; awaitingOpeningMeasurement = false; reveal = null; };
  addEventListener('resize', () => { if (shown) latest?.invalidate(); });
  // Without a host device hint the coarse presentation follows the pointer media query; repaint when it
  // changes (a hint change already repaints through the ready context).
  globalThis.matchMedia?.('(pointer: coarse)').addEventListener?.('change', () => { if (shown && !pointerHint(latest?.device)) latest?.invalidate(); });
  // Hidden retirement leaves a ready picture but retires its pin and interaction.
  // Resume on the existing visible refresh cadence, then stop once active/current.
  // Unavailable pictures do not acquire a perpetual refresh-driven repaint.
  const repin = (vc: ViewContext<U>) => {
    const s = map.value;
    if (shown && document.visibilityState !== 'hidden' && (!interaction.value.active || (s.state === 'ready' && !s.current) || s.state === 'loading' || s.state === 'updating' || s.state === 'error')) vc.invalidate();
  };
  return {
    sync(vc, plan, scope, want) {
      latest = vc;
      if (!plan || !vc.read) { shown = false; forget(); return; }
      shown = want;
      const identity = mapReadingKey(claimOf(vc, plan, scope));
      // Layout retains survivor columns by task ID, so every reading-owned cache
      // must retire together at the full identity boundary, not just interaction.
      if (identity !== interaction.value.identity) forget();
      interaction.identify(identity);
      if (want && !interaction.value.active) interaction.enter(false);
      if (!want) { view.revokeMotion(); view.clearAnnouncements(); view.clearHelp(); if (interaction.value.active) interaction.leave(); map.pause(); }
    },
    enter() { cancelListTransition(); reveal = null; interaction.enter(document.hasFocus()); },
    leave(revealTarget = false) { cancelListTransition(); reveal = null; view.revokeMotion(); view.clearAnnouncements(); view.clearHelp(); interaction.leave(revealTarget); },
    revealTask(id) {
      if (!shown || !latest || !map.value.current) return false;
      interaction.listTarget(id);
      interaction.enter(false);
      latest.setUi({});
      return true;
    },
    listTargets(article) {
      article.addEventListener('pointerdown', e => { const row = (e.target as Element).closest<HTMLElement>('li[data-testid^="item-"]'); if (row) interaction.listTarget(row.dataset.testid!.slice(5)); });
      article.addEventListener('focusin', e => { const row = e.target as HTMLElement; if (row.matches('li[data-nav-target][data-testid^="item-"]')) interaction.listTarget(row.dataset.testid!.slice(5)); });
    },
    paint(host, vc, input) {
      latest = vc;
      map.reconcile(claimOf(vc, input.plan, input.scope));
      const snapshot = map.value;
      const attribution = input.runs ? mapAttribution({ snapshot, request: input.runs.request, runs: input.runs.panel, census: input.census, liveSeq: vc.live.seq ?? 0 }) : new Map();
      const graph = snapshot.picture?.graph ?? null, width = canvasWidth || CARD_METRICS.width;
      const coarse = mapCoarsePointer(vc.device);
      // Same graph: reuse the full-plan layout (edgeless packing only re-packs for a new canvas width).
      // Board selection panel: from the measured map and canvas widths, never from the selection.
      const panel = mapPanelWidth(frame, mapWidth, canvasWidth);
      const reusable = graph === lastGraph && lastLayout && (lastLayout.edges.length > 0 || packedWidth === width);
      const layout = graph && innerWidth > 0 ? reusable ? lastLayout : geometry.compute(graph.items, CARD_METRICS, width) : null;
      // A new edgeless packing changes the content-height frame. Do not consume initial framing
      // (or a list target) with the previous layout's measured height.
      awaitingOpeningMeasurement = !!layout && layout.edges.length === 0 && !interaction.value.initialFramingDone && !reusable;
      lastLayout = layout; lastGraph = graph; packedWidth = width;
      if (layout && snapshot.picture && canvasWidth > 0 && !awaitingOpeningMeasurement) {
        painting = true;
        try {
          const items = snapshot.picture.detail.detail.items, guidance = snapshot.current && snapshot.picture.detail.plan.lifecycle === 'active';
          interaction.reconcile({
            identity: mapReadingKey(claimOf(vc, input.plan, input.scope)), layout, items, current: snapshot.current, guidance,
            working: guidance ? items.filter(n => n.kind === 'task' && n.status === 'working').map(n => n.id) : [],
            needsYou: guidance && snapshot.picture.detail.plan.sourceId === vc.env.boundSource ? items.filter(n => itemNeedsYou(snapshot.picture!.detail.plan, n)).map(n => n.id) : [],
            ready: guidance ? [...snapshot.picture.facts.tasks].filter(([, f]) => f.group === 'ready').map(([id]) => id) : [],
            status: vc.reading?.status ?? 'all', viewport: { width: canvasWidth || CARD_METRICS.width, height: canvasHeight, cover: panel ? panel + MAP_PANEL.margin : 0 },
            // The board's large canvas never frames past 100%; the rail keeps its framing unchanged.
            ...(frame === 'board' ? { framingMax: MAP_ZOOM.fit } : {}),
            // A coarse pointer frames at full size: 75% card text is too small at arm's length.
            ...(coarse ? { readable: MAP_TOUCH.readable } : {}),
          });
        } finally { painting = false; }
      }
      const state = interaction.value;
      host.dataset.canvasWidth = String(canvasWidth);
      view.render(host, {
        viewSwitch: input.viewSwitch,
        sessionAction: id => {
          const env = vc.env;
          if (!id || !env.openSession || !canOpen(input.plan.sourceId, env.boundSource, coverageFor(id, input.plan.directory, env.live))) return null;
          const open = testid(el('button', 'ap-map-tool', COPY[resolveLanguage('auto', env.locale)].openSession), 'map-open-session');
          open.type = 'button'; open.onclick = () => env.openSession?.(id);
          return open;
        },
        ...snapshot, language: resolveLanguage('auto', vc.env.locale), attribution, label: snapshot.picture ? recordedLabel(snapshot.picture.detail.plan, vc.env) : undefined, interaction: binding, frame, layout, panel,
        facts: snapshot.picture?.facts ?? null, status: vc.reading?.status ?? 'all', group: state.group, selected: state.selected,
        onSelect: id => interaction.dispatch({ type: 'select', id }), onStatus: status => interaction.dispatch({ type: 'filters', status }),
        onGroup: group => interaction.dispatch({ type: 'filters', group }), onRetry: () => { map.pause(); vc.setUi({}); vc.retry(); }, onList: () => { view.clearHelp(); interaction.leave(true); },
        motion: mapMotionPermitted(snapshot, vc.env.view, shown, document.visibilityState !== 'hidden'), coarse,
      });
    },
    afterPaint(root, vc, plan, listFocus) {
      latest = vc;
      if (shown) {
        if (!listTransition) reveal = null; // back on Map, unless an explicit departure is crossing paint
        const viewport = root.querySelector<HTMLElement>('[data-testid="map-viewport"]');
        const width = root.querySelector<HTMLElement>('[data-testid="map-region"]')?.clientWidth ?? 0;
        const openingMeasured = awaitingOpeningMeasurement;
        awaitingOpeningMeasurement = false;
        if (viewport && (openingMeasured || viewport.clientWidth !== canvasWidth || viewport.clientHeight !== canvasHeight || width !== mapWidth)) { canvasWidth = viewport.clientWidth; canvasHeight = viewport.clientHeight; mapWidth = width; vc.invalidate(); }
        return;
      }
      const r = reveal; if (!r) return;
      const active = document.activeElement, free = document.hasFocus() && (!active || active === document.body || !active.isConnected || active === listFocus(root) || active === document.getElementById('root'));
      // Another reading, a failed list read or focus the reader moved elsewhere retires it (no delayed theft).
      if (!plan || r.identity !== interaction.value.identity || !free || vc.detail(plan)?.state === 'error') { reveal = null; return; }
      if (r.id !== null) {
        const article = [...root.querySelectorAll<HTMLElement>('article.ap-plan[data-reading]')].find(a => a.dataset.testid === `plan-${plan.id}` && a.dataset.source === plan.sourceId);
        if (!article?.querySelector('.ap-tasks[data-complete]')) return; // wait for this reading's complete list
        reveal = null;
        revealCurrentTask(article, plan, r.id, COPY[resolveLanguage('auto', vc.env.locale)].selectedMapTask);
      } else reveal = null;
      // Nothing took focus (no selection, or the row is gone): the frame's List control, never the body.
      const now = document.activeElement;
      if (!now || now === document.body || !now.isConnected || now === document.getElementById('root')) listFocus(root)?.focus({ preventScroll: true });
    },
    refreshed: repin,
    resetReading: forget,
    retire(reason) {
      cancelListTransition();
      view.revokeMotion();
      if (reason === 'dispose') { map.dispose(); view.dispose(); interaction.reset(); shown = false; }
      else if (reason === 'hidden') { view.clearAnnouncements(); view.clearHelp(); map.pause(); interaction.leave(); }
      else forget();
    },
  };
}

/** `cues`: the picture is eligible for arrow state (active, unarchived, current), so the waiting
 * explanation may also name its reported-working and explicitly blocked direct prerequisites. */
export function readinessText(item: ItemView, fact: DerivedTask | undefined, guidance: boolean, active: boolean, titleOf: (id: string) => string, cues = false, language: InterfaceLanguage = 'en'): string {
  const c = COPY[language];
  if (item.status === 'skipped') return c.skippedHelp;
  if (item.status === 'blocked') return '';
  if (item.status !== 'pending') return '';
  if (!active) return c.closedPending;
  if (!guidance) return c.pendingHelp;
  const counts = prerequisiteCounts(fact), states = cues ? prerequisiteStates(counts, language) : '';
  if (fact?.group === 'ready') return fact.prerequisites.length ? c.readyDeps : c.readyNoDeps;
  if (fact?.group === 'skipped') {
    const skipped = [...new Set(fact.prerequisites.filter(p => p.kind === 'task' && p.status === 'skipped').map(p => p.id))];
    return c.skippedDeps(skipped.map(titleOf).join('; ')) + (states ? c.unfinishedStates(states) : '');
  }
  return c.waitingStates(mapCount(counts.unfinished, 'unfinished', language), states);
}

/**
 * Map-only attribution words (stricter than the list): “Assigned to” needs the verified, revision-
 * current delegation; links and an unverified recorded assignee are named as such; a missing
 * projection is “unavailable”, never “unassigned”. Live words are about the assigned SESSION only
 * and appear only with proof on a current picture. Pure: no DOM, so the copy is checkable alone.
 */
export type MapAttributionKind = 'assigned' | 'recorded' | 'linked' | 'none' | 'unavailable';
export interface MapAttributionCopy {
  kind: MapAttributionKind;
  /** Compact card line, or null when the card shows nothing (no assignee/link, or unavailable). */
  card: string | null;
  /** The verified assigned session's label, which ends `card` (where the live mark sits). */
  session: string | null;
  /** Inspector Assignment value and its explanation. */
  assignment: string;
  assignmentNote: string | null;
  links: string[];
  reports: string[];
  /** Proven session activity on a current picture only. */
  live: { kind: 'active' | 'waiting'; text: string } | null;
  activity: string;
  activityNote: string | null;
}
export const LIVE_HEDGE = 'Session activity only: the assigned session is active in this view’s run records, which doesn’t show that it is working on this task.';
const ATTRIBUTION_EN = {
  unavailable: 'Unavailable in this view', unavailableNote: 'Assignment provenance couldn’t be checked for this picture. That doesn’t mean the task is unassigned.',
  notShown: 'Not shown', activityUnavailable: 'Session activity isn’t available in this view.',
  more: (n: string) => ` and ${n} more`, assigned: (name: string) => `Assigned to ${name}`,
  unverified: (name: string) => `Unverified assignee · ${name}`, linkedCard: (name: string, more: string) => `Linked to ${name}${more} · no verified delegation`,
  recorded: (name: string) => `Recorded assignee ${name} · delegation provenance unavailable`, noAssignee: 'No assignee recorded',
  verified: (r: number) => `Verified delegation, current for revision ${r}.`,
  unverifiedNote: 'No verified delegation is recorded for this revision, so the map doesn’t say Assigned. That doesn’t mean the task is unassigned.',
  linksNote: 'Only session links name this task. A link is not an assignment.', linked: (name: string) => `Linked to ${name}`, unverifiedLink: (name: string) => `Linked to ${name} · no verified delegation`,
  relay: (reporter: string, attributed: string) => `Reported by ${reporter} for ${attributed}`, direct: (reporter: string) => `Reported directly by ${reporter}`,
  reports: (text: string, n: string) => `${text} · ${n} reports`, lastReporter: (name: string) => `Last reported by ${name} · report mode unavailable`,
  active: 'Assigned session active now', waiting: 'Assigned session waiting for input now', hedge: LIVE_HEDGE,
  historical: (r: number) => `Hidden while the map shows revision ${r} as last reported.`,
  assignmentOnly: 'Shown only for a verified assignment.', runsUnavailable: 'This view’s run records aren’t available.', latestUnproven: 'This view’s run records don’t confirm the assigned session’s latest run.', inactive: 'The assigned session’s latest recorded run isn’t active now.',
};
const ATTRIBUTION_RU: typeof ATTRIBUTION_EN = {
  unavailable: 'Недоступно в этом представлении', unavailableNote: 'Происхождение назначения для этой картины проверить не удалось. Это не означает, что задача никому не назначена.',
  notShown: 'Не показано', activityUnavailable: 'Активность сессии недоступна в этом представлении.',
  more: n => ` и ещё ${n}`, assigned: name => `Назначено: ${name}`,
  unverified: name => `Непроверенный исполнитель · ${name}`, linkedCard: (name, more) => `Связь с ${name}${more} · без подтверждённого делегирования`,
  recorded: name => `Записанный исполнитель ${name} · происхождение делегирования недоступно`, noAssignee: 'Исполнитель не записан',
  verified: r => `Подтверждённое делегирование, актуальное для редакции ${r}.`,
  unverifiedNote: 'Для этой редакции не записано подтверждённое делегирование, поэтому карта не говорит «Назначено». Это не означает, что задача никому не назначена.',
  linksNote: 'Задачу называют только связи с сессиями. Связь — не назначение.', linked: name => `Связь с ${name}`, unverifiedLink: name => `Связь с ${name} · без подтверждённого делегирования`,
  relay: (reporter, attributed) => `Сообщено из ${reporter} от имени ${attributed}`, direct: reporter => `Сообщено напрямую из ${reporter}`,
  reports: (text, n) => `${text} · отчётов: ${n}`, lastReporter: name => `Последний отчёт из ${name} · режим отчёта недоступен`,
  active: 'Назначенная сессия сейчас активна', waiting: 'Назначенная сессия сейчас ожидает ввода', hedge: 'Только активность сессии: назначенная сессия активна по записям запусков этого представления. Это не показывает, что она работает над этой задачей.',
  historical: r => `Скрыто, пока карта показывает редакцию ${r} по последнему отчёту.`,
  assignmentOnly: 'Показано только при подтверждённом назначении.', runsUnavailable: 'Записи запусков этого представления недоступны.', latestUnproven: 'Записи запусков этого представления не подтверждают последний запуск назначенной сессии.', inactive: 'Последний записанный запуск назначенной сессии сейчас не активен.',
};
const ATTRIBUTION_ZH: typeof ATTRIBUTION_EN = {
  unavailable: '此视图中不可用', unavailableNote: '无法核验此依赖图的分配来源。这不表示任务未分配。',
  notShown: '未显示', activityUnavailable: '此视图中无法获取会话活动。',
  more: n => `，另有 ${n} 个`, assigned: name => `已分配给 ${name}`,
  unverified: name => `未验证的受派人 · ${name}`, linkedCard: (name, more) => `关联至 ${name}${more} · 无已验证的委派`,
  recorded: name => `已记录的受派人 ${name} · 委派来源不可用`, noAssignee: '未记录受派人',
  verified: r => `已验证的委派，适用于修订 ${r}。`,
  unverifiedNote: '此修订没有已记录的已验证委派，因此依赖图不称为已分配。这不表示任务未分配。',
  linksNote: '只有会话链接提及此任务。链接不等于分配。', linked: name => `关联至 ${name}`, unverifiedLink: name => `关联至 ${name} · 无已验证的委派`,
  relay: (reporter, attributed) => `${reporter} 代 ${attributed} 报告`, direct: reporter => `${reporter} 直接报告`,
  reports: (text, n) => `${text} · ${n} 条报告`, lastReporter: name => `最近由 ${name} 报告 · 报告方式不可用`,
  active: '受派会话当前活跃', waiting: '受派会话当前等待输入', hedge: '仅表示会话活动：此视图的运行记录显示受派会话活跃，但不能证明它正在处理此任务。',
  historical: r => `依赖图显示上次报告的修订 ${r} 时隐藏。`,
  assignmentOnly: '仅对已验证的分配显示。', runsUnavailable: '此视图的运行记录不可用。', latestUnproven: '此视图的运行记录未确认受派会话的最新运行。', inactive: '受派会话最近记录的运行当前并不活跃。',
};
const ATTRIBUTION: Record<InterfaceLanguage, typeof ATTRIBUTION_EN> = { en: ATTRIBUTION_EN, ru: ATTRIBUTION_RU, 'zh-CN': ATTRIBUTION_ZH };
export function attributionCopy(a: MapTaskAttribution | undefined, current: boolean, revision: number, label: (id: string) => string, language: InterfaceLanguage = 'en'): MapAttributionCopy {
  const c = ATTRIBUTION[language];
  if (!a) return {
    kind: 'unavailable', card: null, session: null, assignment: c.unavailable,
    assignmentNote: c.unavailableNote,
    links: [], reports: [], live: null, activity: c.notShown, activityNote: c.activityUnavailable,
  };
  const verified = a.assignment;
  const kind: MapAttributionKind = verified ? 'assigned' : a.recordedAssignee ? 'recorded' : a.links.length ? 'linked' : 'none';
  const more = (n: number) => n > 1 ? c.more(mapNumber(n - 1, language)) : '';
  const card = kind === 'assigned' ? c.assigned(label(verified!.childSessionId))
    // Qualifier first: a truncated card line must still never read as a verified assignment.
    : kind === 'recorded' ? c.unverified(label(a.recordedAssignee!))
    : kind === 'linked' ? c.linkedCard(label(a.links[0]), more(a.links.length)) : null;
  const assignment = kind === 'assigned' ? c.assigned(label(verified!.childSessionId))
    : kind === 'recorded' ? c.recorded(label(a.recordedAssignee!)) : c.noAssignee;
  const assignmentNote = kind === 'assigned' ? c.verified(verified!.validAtRevision)
    : kind === 'recorded' ? c.unverifiedNote : kind === 'linked' ? c.linksNote : null;
  const links = a.links.map(id => verified && id === verified.childSessionId ? c.linked(label(id)) : c.unverifiedLink(label(id)));
  // One line per distinct reporting identity (mode, reporter, attributed session); repeats by the
  // same identity are counted. Grouping uses session IDs, never display text: two sessions with the
  // same title or a colliding short-ID fallback stay separate lines.
  const lines = new Map<string, { text: string; n: number }>();
  for (const r of a.reports) {
    const relay = r.mode === 'parent-relay';
    const key = JSON.stringify([relay ? 'relay' : 'direct', r.reporterSessionId, relay ? r.attributedSessionId : null]);
    const text = relay ? c.relay(label(r.reporterSessionId), label(r.attributedSessionId)) : c.direct(label(r.reporterSessionId));
    const line = lines.get(key); if (line) line.n++; else lines.set(key, { text, n: 1 });
  }
  const reports = [...lines.values()].map(({ text, n }) => n > 1 ? c.reports(text, mapNumber(n, language)) : text);
  if (!reports.length && a.reporter) reports.push(c.lastReporter(label(a.reporter)));
  const proven = a.live.proven && current && !!verified ? a.live : null;
  const live = proven ? proven.kind === 'active'
    ? { kind: 'active' as const, text: c.active }
    : { kind: 'waiting' as const, text: c.waiting } : null;
  const reason = a.live.proven ? 'picture-not-current' : a.live.reason;
  const activityNote = live ? c.hedge : !current || reason === 'picture-not-current' ? c.historical(revision)
    : reason === 'no-verified-assignment' ? c.assignmentOnly
    : reason === 'run-scope-unavailable' ? c.runsUnavailable
    : reason === 'latest-child-not-proven' ? c.latestUnproven : c.inactive;
  return { kind, card, session: verified ? label(verified.childSessionId) : null, assignment, assignmentNote, links, reports, live, activity: live ? live.text : c.notShown, activityNote };
}

function blockerPart(b: BlockerView | undefined, part: 'reason' | 'nextAction', language: InterfaceLanguage): string {
  const c = COPY[language];
  if (!b) return c.notReported;
  if (b.state === 'invalid') return c.invalid;
  return b[part] ?? c.notReported;
}
