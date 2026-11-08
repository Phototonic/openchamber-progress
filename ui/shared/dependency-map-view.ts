// Dependency map renderer (Designer-owned). Shared by the board and the right rail.
// Every recorded string lands through textContent. Geometry comes from the frame owner's full-plan
// layout and is never recomputed or filtered here: filters only hide cards/arrows in place.
// With an interaction binding (S3) the canvas is a pan/zoom viewport with one roving card Tab stop,
// scoped keys, a viewport toolbar, background-drag/wheel panning, relation highlights and one
// persistent per-frame live region. Without one it stays the S2 read-only, natively scrolled view.
import { DependencyMap, mapReadingKey, type MapClaim, type MapSnapshot, type MapPicture } from './dependency-map.ts';
import { DependencyMapLayout, type MapLayout } from './dependency-map-layout.ts';
import type { DerivedTask } from './dependency-derivation.ts';
import { DependencyMapInteraction, MAP_ZOOM, mapAnnouncementText, type MapAnnouncement, type MapInteractionCommand, type MapInteractionEvent, type MapInteractionState } from './dependency-map-interaction.ts';
import { mapAttribution } from './dependency-map-attribution.ts';
import { button, el, lifecycleBadge, recordedLabel, revealCurrentTask, testid } from './components.ts';
import type { ViewContext } from './app.ts';
import type { Census } from './census.ts';
import type { RunsPanel } from './runs.ts';
import type { RunRequest } from '../../shared/subagent-runs.ts';
import { MAP_CSS } from './dependency-map-style.ts';
import { resolveLanguage, type InterfaceLanguage } from './i18n.ts';
import { formatCount } from './format.ts';
import { EMPTY_LIVE, sessionLabel } from './live.ts';
import { statusMatch, summarize, summaryText, type BlockerView, type ItemView, type PlanView, type StatusFilter } from './model.ts';
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
  dispose: () => void;
}
/** QA vocabulary: map-region data-{state,current,revision,tasks,edges,highlight}; map-card-ID
 * data-{task,x,y,status,readiness,unlocks,related}; SVG paths data-{from,to,path}, marker-end;
 * map-{state,viewport,world,inspector,group,status,list,retry,help}; toolbar map-{zoom-in,
 * zoom-out,zoom-level,fit-all,focus-current,pan-left,pan-right,pan-up,pan-down}; one per-frame
 * map-announcer outside the root; plan-view, plan-view-{list,map}. Attribution (S4): card
 * data-{attribution,live}, map-card-who-ID, map-card-live-ID; inspector map-attribution
 * data-{assignment,live} with map-attribution-{assignment,links,reports,live}; map-attribution-help.
 * No data-reading article.
 * These describe semantic facts, not styling or incidental DOM nesting.
 */

/** Card mark: shape + words, colour only reinforces it (style.ts `.ap-map-mark`). */
type Mark = 'working' | 'ready' | 'waiting' | 'waiting-skipped' | 'blocked' | 'done' | 'skipped' | 'pending';
const MARK_TEXT: Record<InterfaceLanguage, Record<Mark, string>> = { en: {
  working: 'Reported working', ready: 'Ready', waiting: 'Waiting', 'waiting-skipped': 'Waiting on skipped task',
  blocked: 'Explicitly blocked', done: 'Done', skipped: 'Skipped', pending: 'Reported pending',
}, ru: {
  working: 'Сообщено: в работе', ready: 'Готова', waiting: 'Ожидает', 'waiting-skipped': 'Ожидает пропущенную задачу',
  blocked: 'Явно заблокирована', done: 'Выполнена', skipped: 'Пропущена', pending: 'Сообщено: ожидает',
} };
const EN = {
  planView: 'Plan view', list: 'List', map: 'Map', under: 'under 1%', viewList: 'View as list', retry: 'Try again', heading: 'Dependency map',
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
  work: 'Current work', working: 'reported working', ready: 'ready', blocked: 'explicitly blocked', unlocks: 'Unlocks next',
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
  work: 'Текущая работа', working: 'в работе по отчётам', ready: 'готовы', blocked: 'явно заблокированы', unlocks: 'Открывает далее',
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
const COPY: Record<InterfaceLanguage, typeof EN> = { en: EN, ru: RU };
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
  let frame = 0, releasing = false;
  // True from a paint until the owner has finished restoring its pre-paint focus (same turn):
  // that focusin is passive and must not move the viewport.
  let restoring = false;
  // Latest announcement token and its deferred repeat frame, if any.
  let spoken = 0, speakFrame = 0;
  let pendingFocus: { id: string | null; generation: number } | null = null;
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
    if (zoomNode) zoomNode.textContent = zoomText(t.zoom, input?.language ?? 'en');
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
    const target = want.id === null ? viewportNode.querySelector<HTMLElement>('[data-map-empty-target]') ?? viewportNode.closest('[data-testid="map-region"]')?.querySelector<HTMLElement>('h2') ?? null
      : viewportNode.querySelector<HTMLElement>(`[data-task="${CSS.escape(want.id)}"]`);
    if (!target) return false;
    if (settle) pendingFocus = null;
    if (target.matches('.ap-map-card')) {
      for (const n of viewportNode.querySelectorAll<HTMLElement>('.ap-map-card[tabindex="0"]')) if (n !== target) n.tabIndex = -1;
      target.tabIndex = 0;
    } else if (target.tagName === 'H2') target.tabIndex = -1;
    applyViewport();
    target.focus({ preventScroll: true });
    revealInPage(target);
    return true;
  }
  function capture(pointerId: number, on: boolean) {
    const v = viewportNode; if (!v) return;
    if (on) { try { v.setPointerCapture(pointerId); v.dataset.dragging = ''; } catch { /* pointer already gone */ } return; }
    delete v.dataset.dragging;
    if (v.hasPointerCapture(pointerId)) { releasing = true; try { v.releasePointerCapture(pointerId); } finally { releasing = false; } }
  }
  // Frame-owned gesture listeners survive root replacement; capture is rebound to each new viewport.
  const onMove = (e: PointerEvent) => { const b = binding(); if (b && b.state().dragging === e.pointerId) b.dispatch({ type: 'pointer-move', pointerId: e.pointerId, point: { x: e.clientX, y: e.clientY } }); };
  const onEnd = (e: PointerEvent) => { const b = binding(); if (b && b.state().dragging === e.pointerId) b.dispatch({ type: 'pointer-end', pointerId: e.pointerId }); };
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
    baseNames = new Map();
    if (!host || !input) return;
    // The owner restores focus synchronously after attaching this paint's root; this microtask runs
    // after that, so the restoration's focusin is recognised as passive.
    restoring = true; queueMicrotask(() => { restoring = false; });
    const v = input, b = v.interaction ?? null;
    const language = v.language ?? 'en', c = COPY[language], marks = MARK_TEXT[language];
    const count = (n: number, kind: keyof typeof EN.counts) => mapCount(n, kind, language);
    if (b) { listen(host.ownerDocument); announcer = mapAnnouncer(host.ownerDocument); }
    const st = b?.state() ?? null;
    // Unavailable/not found never draw a diagram, even when the coordinator still holds an older
    // picture (e.g. replacement detail without usable identity): no stale map presented as Updating.
    const retainedUnavailable = !!v.picture && (v.state === 'unavailable' || v.state === 'not-found');
    const p = retainedUnavailable ? null : v.picture, layout = p ? v.layout : null;
    const region = testid(el('article', 'ap-map'), 'map-region');
    if (st?.identity) region.dataset.mapIdentity = st.identity;
    region.dataset.frame = v.frame;
    region.setAttribute('aria-labelledby', `${uid}-title`);
    region.dataset.state = v.state; region.dataset.current = String(v.current);
    region.dataset.revision = String(p?.graph.revision ?? '');
    region.dataset.tasks = String(layout?.order.length ?? 0); region.dataset.edges = String(layout?.edges.length ?? 0);
    if (b) region.dataset.interactive = '';

    const listButton = (parent: Element) => button(parent, 'map-list', c.viewList, () => v.onList(v.selected), 'outline');
    const retryButton = (parent: Element) => button(parent, 'map-retry', c.retry, v.onRetry, 'outline');

    // ── No diagram: loading, unavailable, not found, failed. View as list always stays reachable.
    if (!p) {
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
    const anyAttribution = tasks.some(i => attributionOf(i.id).card);
    const selected = v.selected && byId.get(v.selected)?.kind === 'task' ? byId.get(v.selected)! : null;
    // Upstream/downstream emphasis: fresh on-demand closure walks for the selection only.
    const upstreamSet = selected && layout ? v.facts?.upstream(selected.id) ?? null : null;
    const downstreamSet = selected && layout ? v.facts?.downstream(selected.id) ?? null : null;
    const related = (id: string) => upstreamSet?.has(id) ? 'upstream' : downstreamSet?.has(id) ? 'downstream' : null;
    const highlight = !!selected && visible.has(selected.id);
    if (highlight) region.dataset.highlight = 'true';
    const roving = b ? st!.roving && visible.has(st!.roving) ? st!.roving : layout?.order.find(id => visible.has(id)) ?? null : null;

    // ── Header: plan, lifecycle, counts, qualification, View as list
    const head = el('header', 'ap-map-head');
    const top = el('div', 'ap-map-top');
    const titles = el('div', 'ap-map-titles');
    titles.append(el('p', 'ap-h', c.heading));
    const heading = testid(el('h2', 'ap-plan-title', plan.title), 'map-title');
    heading.id = `${uid}-title`;
    titles.append(heading);
    const meta = el('div', 'ap-meta');
    meta.append(lifecycleBadge(plan, language), el('span', '', c.revision(p.graph.revision)));
    titles.append(meta, testid(el('p', 'ap-map-counts', summaryText(summarize(plan, p.detail.detail), language)), 'map-counts'));
    const actions = el('div', 'ap-map-actions');
    listButton(actions);
    top.append(titles, actions);
    head.append(top);

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

    // Active, current plans: reported working / ready / unlocks-next emphasis. Never on closed plans.
    const summary = testid(el('div', 'ap-map-summary'), 'map-summary');
    if (guidance && tasks.length) {
      const working = tasks.filter(i => i.status === 'working').length;
      const ready = tasks.filter(i => facts?.get(i.id)?.group === 'ready').length;
      const blocked = tasks.filter(i => i.status === 'blocked').length;
      const unlocks = new Set(tasks.flatMap(i => unlocking(i.id)));
      const stats = el('ul', 'ap-map-stats');
      stats.setAttribute('aria-label', c.work);
      const stat = (kind: Mark, count: number, text: string) => {
        const li = el('li', 'ap-map-stat'); li.dataset.kind = kind; li.dataset.count = String(count);
        li.append(mark(kind), el('strong', '', mapNumber(count, language)), ` ${text}`);
        stats.append(li);
      };
      stat('working', working, c.working);
      stat('ready', ready, c.ready);
      if (blocked) stat('blocked', blocked, c.blocked);
      if (unlocks.size) {
        const li = el('li', 'ap-map-stat'); li.dataset.kind = 'unlocks'; li.dataset.count = String(unlocks.size);
        li.append(el('span', 'ap-map-unlock-icon'), `${c.unlocks} · `, el('strong', '', mapNumber(unlocks.size, language)), ` ${mapNoun(unlocks.size, 'task', language)}`);
        stats.append(li);
      }
      summary.append(stats);
      // The full definitions sit in the help below the map; the header keeps the one caveat.
      summary.append(el('p', 'ap-note', c.guidance));
    } else if (!active && tasks.length) {
      summary.append(el('p', 'ap-note', c.closed));
    }

    // Recorded-information qualification and D5 statements.
    const context = testid(el('p', 'ap-map-context'), 'map-context');
    // A taskless plan keeps its explanation AND the dependency statement that is true for it: D5's exact
    // sentence when nothing records prerequisites; group-owned prerequisites get the task-to-task wording.
    if (!tasks.length) context.append(groups.length ? c.groupsOnly : c.noTasksYet);
    if (!anyRecorded) context.append(el('strong', '', c.noPrerequisites), tasks.length ? c.listOrder : '.');
    else if (!edges.length) context.append(el('strong', '', c.noTaskPrerequisites), c.groupArrows);
    else context.append(c.arrows);
    head.append(state, summary, context);
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
    region.append(controls);

    // ── Body: stage (toolbar + canvas) and inspector (beside on a wide board, stacked in the rail)
    const body = el('div', 'ap-map-body');
    const stage = el('div', 'ap-map-stage');
    const viewport = testid(el('div', 'ap-map-viewport'), 'map-viewport');
    viewport.setAttribute('role', 'region');
    viewport.setAttribute('aria-label', c.taskMap);
    const scrollKey = `${plan.key}`;
    const helpId = `${uid}-help`;
    let world: HTMLElement | null = null;
    if (b) {
      viewport.dataset.interactive = '';
      viewport.setAttribute('aria-describedby', helpId);
      if (st!.dragging !== null) viewport.dataset.dragging = '';
      const t0 = st!.transform;
      const toolbar = el('div', 'ap-map-toolbar');
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
      const size = () => ({ w: viewportNode?.clientWidth || 320, h: viewportNode?.clientHeight || 240 });
      const zoomBy = (factor: number) => { const bb = binding(); if (bb?.dispatch({ type: 'zoom', factor })) announce(`${c.zoom(zoomText(bb.state().transform.zoom, language))}.`); };
      const panBy = (dx: number, dy: number, where: string) => { const bb = binding(); if (bb?.dispatch({ type: 'pan', x: dx, y: dy })) announce(c.moved(where)); };
      const zoomSet = el('div', 'ap-map-tool-set');
      zoomNode = testid(el('span', 'ap-map-zoom', zoomText(t0.zoom, language)), 'map-zoom-level');
      zoomNode.setAttribute('aria-label', c.zoom(zoomText(t0.zoom, language)));
      zoomSet.append(tool('map-zoom-out', 'zoom-out', c.zoomOut, () => zoomBy(1 / MAP_ZOOM.step)), zoomNode, tool('map-zoom-in', 'zoom-in', c.zoomIn, () => zoomBy(MAP_ZOOM.step)));
      // Separate flex items so a narrow rail wraps to two rows, not three.
      const fit = tool('map-fit-all', 'fit', c.fit, () => binding()?.dispatch({ type: 'fit' }), true);
      const current = tool('map-focus-current', 'current', c.current, () => binding()?.dispatch({ type: 'current' }), true);
      const panSet = el('div', 'ap-map-tool-set ap-map-pan');
      const step = () => Math.max(60, Math.round(Math.min(size().w, size().h) * 0.3));
      panSet.append(
        tool('map-pan-left', 'left', c.panLeft, () => panBy(step(), 0, c.left)),
        tool('map-pan-up', 'up', c.panUp, () => panBy(0, step(), c.up)),
        tool('map-pan-down', 'down', c.panDown, () => panBy(0, -step(), c.down)),
        tool('map-pan-right', 'right', c.panRight, () => panBy(-step(), 0, c.right)));
      toolbar.append(zoomSet, fit, current, panSet);
      stage.append(toolbar);

      // Keys only while the canvas (a card or the empty target) owns focus; never modified/browser keys.
      viewport.addEventListener('keydown', e => {
        const target = e.target as HTMLElement, bb = binding();
        const canvas = target === viewport || target.classList.contains('ap-map-card');
        if (!bb || !canvas || e.defaultPrevented || e.isComposing) return;
        const modified = e.ctrlKey || e.metaKey || e.altKey || (e.shiftKey && e.key.startsWith('Arrow'));
        if (!bb.dispatch({ type: 'key', key: e.key, canvas, modified, editable: false })) return;
        e.preventDefault();
        if (e.key === '+' || e.key === '-') announce(`${c.zoom(zoomText(bb.state().transform.zoom, language))}.`);
      });
      // Tab into an off-screen roving card: pan just enough to show it (no selection change). Passive
      // focus restoration after a repaint (e.g. an unchanged poll) never pans: the reader's pan stays.
      viewport.addEventListener('focusin', e => {
        const card = e.target as HTMLElement, bb = binding();
        if (!bb || restoring || !card.classList.contains('ap-map-card')) return;
        const r = card.getBoundingClientRect(), box = viewport.getBoundingClientRect(), inset = 8;
        const shift = (start: number, end: number, lo: number, hi: number) => start < lo + inset ? lo + inset - start : end > hi - inset ? Math.max(lo + inset - start, hi - inset - end) : 0;
        const dx = shift(r.left, r.right, box.left, box.right), dy = shift(r.top, r.bottom, box.top, box.bottom);
        if (dx || dy) { bb.dispatch({ type: 'pan', x: dx, y: dy }); applyViewport(); }
        revealInPage(card);
      });
      // Background drag pans; cards are buttons and never start a drag.
      viewport.addEventListener('pointerdown', e => {
        const bb = binding(); if (!bb) return;
        const background = !(e.target as Element).closest('button,a,select,input,textarea,summary');
        bb.dispatch({ type: 'pointer-down', pointerId: e.pointerId, point: { x: e.clientX, y: e.clientY }, background, primary: e.isPrimary && e.button === 0 && !e.ctrlKey && !e.metaKey });
      });
      viewport.addEventListener('lostpointercapture', e => {
        // Root replacement detaches this node: that loss is rebound, not a gesture end.
        const bb = binding();
        if (!releasing && viewport.isConnected && bb?.state().dragging === e.pointerId) bb.dispatch({ type: 'pointer-end', pointerId: e.pointerId });
      });
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
      for (const tone of ['open', 'quiet', 'path'] as const) {
        const marker = document.createElementNS(SVG, 'marker');
        marker.id = `${uid}-arrow-${tone}`;
        marker.setAttribute('class', `ap-map-marker ap-map-marker-${tone}`);
        for (const [k, val] of [['viewBox', '0 0 10 10'], ['refX', '9'], ['refY', '5'], ['markerWidth', '9'], ['markerHeight', '9'], ['markerUnits', 'userSpaceOnUse'], ['orient', 'auto']]) marker.setAttribute(k, val);
        const head = document.createElementNS(SVG, 'path');
        head.setAttribute('d', 'M 0 0.5 L 10 5 L 0 9.5 z');
        head.setAttribute('class', 'ap-map-arrowhead');
        marker.append(head); defs.append(marker);
      }
      svg.append(defs);
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
        const path = document.createElementNS(SVG, 'path');
        path.setAttribute('class', 'ap-map-edge');
        path.dataset.tone = tone;
        if (prereq === 'skipped') path.dataset.skipped = 'true';
        path.setAttribute('data-from', from); path.setAttribute('data-to', to);
        path.setAttribute('d', d);
        // An edge lies on the selection's chain when both ends are in its upstream (or downstream) closure.
        const sel = selected?.id;
        const way = !highlight || !sel ? null : (to === sel || upstreamSet?.has(to)) && upstreamSet?.has(from) ? 'upstream' : (from === sel || downstreamSet?.has(from)) && downstreamSet?.has(to) ? 'downstream' : null;
        if (way) path.dataset.path = way;
        path.setAttribute('marker-end', `url(#${uid}-arrow-${way ? 'path' : tone})`);
        if (way) onPath.push(path); else svg.append(path);
      }
      svg.append(...onPath); // chain arrows paint above the rest
      world.append(svg);

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
        statusRow.append(mark(kind), el('span', 'ap-map-card-word', marks[kind]));
        const title = el('span', 'ap-map-card-title', i.title);
        // Attribution line: takes the title's second line inside the same fixed slot (the full title
        // stays in the name and inspector), so its text never moves or resizes anything else.
        const who = attributionOf(id);
        card.dataset.attribution = who.kind;
        if (who.live) card.dataset.live = who.live.kind;
        const foot = el('span', 'ap-map-card-foot');
        foot.append(el('span', 'ap-map-card-group', path.length ? path[path.length - 1] : ''));
        if (unlocks.length) { const u = el('span', 'ap-map-card-unlocks'); u.append(el('span', 'ap-map-unlock-icon'), `${c.unlocks} · ${mapNumber(unlocks.length, language)}`); foot.append(u); }
        card.append(statusRow, title);
        if (who.card) {
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
            text.append(who.card.slice(0, -who.session.length), live, who.session);
          } else text.textContent = who.card;
          line.append(text);
          card.append(line);
        }
        card.append(foot);
        // The card's name is what a screen reader speaks when a selection focuses it (the map
        // announcer then stays quiet), so it carries title, state and direct counts in full.
        const name = [
          i.title, marks[kind], who.card ?? '', who.live ? c.sessionOnly(who.live.text) : '',
          path.length ? c.groupPath(path.join(' › ')) : '',
          c.direct(count(prereqs, 'prerequisite'), count(dependents, 'dependent')),
          hiddenRel ? c.hiddenRelated(count(hiddenRel, 'related')) : '',
          unlocks.length ? c.unlocksFor(count(unlocks.length, 'task')) : '',
        ].filter(Boolean).join('. ');
        baseNames.set(id, name);
        card.setAttribute('aria-label', rel ? c.relative(name, rel === 'upstream' ? c.upstream : c.downstream) : name);
        // A click whose press moved focus onto this card has already had its name spoken.
        card.onpointerdown = () => { pointerFocused = document.activeElement === card ? null : id; };
        card.onclick = () => { if (b) b.dispatch({ type: 'select', id }); else v.onSelect(id); pointerFocused = null; };
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
    stage.append(viewport);
    body.append(stage);

    // ── Inspector: literal text only; relationships are explicit records, never inferred.
    const inspector = testid(el('section', 'ap-map-inspector'), 'map-inspector');
    inspector.setAttribute('aria-labelledby', `${uid}-inspector`);
    const ih = el('h3', 'ap-h', c.selected); ih.id = `${uid}-inspector`;
    inspector.append(ih);
    if (!selected) {
      inspector.dataset.selected = '';
      inspector.append(el('p', 'ap-note', tasks.length ? c.select : c.noInspect));
    } else {
      const id = selected.id, fact = facts?.get(id), kind = markOf(selected, fact, guidance);
      inspector.dataset.selected = id;
      const status = el('p', 'ap-map-card-status');
      status.dataset.mark = kind;
      status.append(mark(kind), el('span', 'ap-map-card-word', marks[kind]));
      if (!visible.has(id)) status.append(el('span', 'ap-map-tag', c.hidden));
      inspector.append(status, el('p', 'ap-map-inspector-title', selected.title));
      const explain = readinessText(selected, fact, guidance, active, titleOf, language);
      if (explain) inspector.append(el('p', 'ap-note', explain));
      const factsList = el('dl', 'ap-map-facts');
      const fact2 = (label: string, value: string | Node) => { const d = el('div'); d.append(el('dt', '', label)); const dd = el('dd'); dd.append(value); d.append(dd); factsList.append(d); };
      const path = groupPath(id);
      fact2(c.group, path.length ? path.join(' › ') : c.noGroup);
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
      ws.append(el('h4', 'ap-map-rel-h', c.assignmentActivity));
      const whoList = el('dl', 'ap-map-facts');
      const row = (label: string, testId: string, lines: (string | Node)[], note: string | null = null) => {
        const d = testid(el('div'), testId); d.append(el('dt', '', label));
        const dd = el('dd');
        lines.forEach((line, n) => { if (n) dd.append(el('br')); dd.append(line); });
        if (note) dd.append(el('span', 'ap-map-who-note', note));
        d.append(dd); whoList.append(d);
      };
      row(c.assignment, 'map-attribution-assignment', [who.assignment], who.assignmentNote);
      if (who.links.length) row(c.links, 'map-attribution-links', who.links);
      if (who.kind !== 'unavailable') row(c.reports, 'map-attribution-reports', who.reports.length ? who.reports : [c.noReports]);
      let activity: string | Node = who.activity;
      if (who.live) {
        // The mark is decorative here: the words beside it say the same thing.
        const mark = el('span', 'ap-map-live-mark'); mark.dataset.live = who.live.kind; mark.setAttribute('aria-hidden', 'true');
        const words = el('strong', 'ap-map-who-live'); words.dataset.live = who.live.kind;
        words.append(mark, who.live.text);
        activity = words;
      }
      row(c.activity, 'map-attribution-live', [activity], who.activityNote);
      ws.append(whoList);
      inspector.append(ws);
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
          const sub = el('span', 'ap-map-rel-sub', marks[rk]);
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
      const chain = (upstreamSet?.size ?? 0) + (downstreamSet?.size ?? 0);
      if (highlight && chain) inspector.append(el('p', 'ap-note ap-map-chain', c.chain(count(upstreamSet?.size ?? 0, 'upstream'), count(downstreamSet?.size ?? 0, 'downstream'))));
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
    body.append(inspector);
    region.append(body);

    // ── Help: keys (interactive), reading the highlights and the guidance definitions moved from the header.
    if (b || (guidance && tasks.length) || anyAttribution) {
      const help = testid(el('div', 'ap-map-help'), 'map-help');
      help.id = helpId;
      if (b) {
        const keys = el('p', 'ap-map-keys');
        const k = (text: string) => el('kbd', '', text);
        const nowrap = (...parts: (string | Node)[]) => { const n = el('span', 'ap-map-nowrap'); n.append(...parts); return n; };
        keys.append(el('strong', '', c.keys), k(c.arrowKeys), c.nearest, k('['), c.firstPrerequisite, k(']'), c.firstDependent, k('F'), c.fitKey, nowrap(k('+'), ' ', k('−'), c.zoomKey), c.drag);
        help.append(keys);
        if (layout && edges.length) help.append(el('p', '', c.selectionHelp));
      }
      if (guidance && tasks.length) help.append(el('p', '', c.readinessHelp));
      if (anyAttribution) help.append(testid(el('p', '', c.attributionHelp), 'map-attribution-help'));
      region.append(help);
    }

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
        // An active background drag continues on the replacement canvas.
        const dragging = b.state().dragging;
        if (dragging !== null && !viewport.hasPointerCapture(dragging)) {
          try { viewport.setPointerCapture(dragging); viewport.dataset.dragging = ''; } catch { b.dispatch({ type: 'pointer-end', pointerId: dragging }); }
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
          const want = pendingFocus = { id: c.id, generation: c.generation };
          tryFocus(false);
          queueMicrotask(() => queueMicrotask(() => { if (pendingFocus === want) pendingFocus = null; }));
          break;
        }
        case 'capture': capture(c.pointerId, c.capture); break;
        default: break; // filters and list reveal are frame state, owned by the frame
      }
    },
    clearAnnouncements,
    dispose() {
      observer?.disconnect(); observer = null; unlisten(); clearAnnouncements();
      if (frame) cancelAnimationFrame(frame); frame = 0;
      host = null; input = null; viewportNode = worldNode = zoomNode = null; pendingFocus = null; painted = { key: '', viewport: null };
    },
  };
}

/** What one production frame paints into its map host this turn. */
export interface MapFramePaint {
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
  leave: () => void;
  /** Explicit list task focus/reveal or pointer selection in this frame's canonical list. */
  listTargets: (article: HTMLElement) => void;
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
  let canvasWidth = 0, canvasHeight = 400;
  let lastLayout: MapLayout | null = null, lastGraph: MapPicture['graph'] | null = null, packedWidth = 0;
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
      if (frame !== 'rail' || !bridge || !document.hasFocus() || !active?.closest('[data-testid="map-list"]')) { showList(latest); return; }
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
  const map = new DependencyMap(current => latest!.service(current), () => latest?.setUi({}));
  const claimOf = (vc: ViewContext<U>, plan: PlanView, scope: string): MapClaim => ({
    account: vc.ctx.connection?.account ?? '', scope, read: vc.read!, plan, detail: vc.detailResult(plan), health: vc.health,
    refreshSerial: vc.refreshSerial, active: shown, visible: document.visibilityState !== 'hidden', failure: vc.failure,
  });
  const forget = () => { cancelListTransition(); view.clearAnnouncements(); map.reset(); geometry.clear(); interaction.reset(); lastLayout = lastGraph = null; packedWidth = 0; reveal = null; };
  addEventListener('resize', () => { if (shown) latest?.setUi({}); });
  // Hidden retirement leaves a ready picture but retires its pin and interaction.
  // Resume on the existing visible refresh cadence, then stop once active/current.
  // Unavailable pictures do not acquire a perpetual refresh-driven repaint.
  const repin = (vc: ViewContext<U>) => {
    const s = map.value;
    if (shown && document.visibilityState !== 'hidden' && (!interaction.value.active || (s.state === 'ready' && !s.current) || s.state === 'loading' || s.state === 'updating' || s.state === 'error')) vc.setUi({});
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
      if (!want) { view.clearAnnouncements(); if (interaction.value.active) interaction.leave(); map.pause(); }
    },
    enter() { cancelListTransition(); reveal = null; interaction.enter(document.hasFocus()); },
    leave() { cancelListTransition(); reveal = null; view.clearAnnouncements(); interaction.leave(); },
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
      // Same graph: reuse the full-plan layout (edgeless packing only re-packs for a new canvas width).
      const reusable = graph === lastGraph && lastLayout && (lastLayout.edges.length > 0 || packedWidth === width);
      const layout = graph && innerWidth > 0 ? reusable ? lastLayout : geometry.compute(graph.items, CARD_METRICS, width) : null;
      lastLayout = layout; lastGraph = graph; packedWidth = width;
      if (layout && snapshot.picture) {
        painting = true;
        try {
          const items = snapshot.picture.detail.detail.items, guidance = snapshot.current && snapshot.picture.detail.plan.lifecycle === 'active';
          interaction.reconcile({
            identity: mapReadingKey(claimOf(vc, input.plan, input.scope)), layout, items, current: snapshot.current, guidance,
            working: guidance ? items.filter(n => n.kind === 'task' && n.status === 'working').map(n => n.id) : [],
            ready: guidance ? [...snapshot.picture.facts.tasks].filter(([, f]) => f.group === 'ready').map(([id]) => id) : [],
            status: vc.reading?.status ?? 'all', viewport: { width: canvasWidth || CARD_METRICS.width, height: canvasHeight },
          });
        } finally { painting = false; }
      }
      const state = interaction.value;
      host.dataset.canvasWidth = String(canvasWidth);
      view.render(host, {
        ...snapshot, language: resolveLanguage('auto', vc.env.locale), attribution, label: snapshot.picture ? recordedLabel(snapshot.picture.detail.plan, vc.env) : undefined, interaction: binding, frame, layout,
        facts: snapshot.picture?.facts ?? null, status: vc.reading?.status ?? 'all', group: state.group, selected: state.selected,
        onSelect: id => interaction.dispatch({ type: 'select', id }), onStatus: status => interaction.dispatch({ type: 'filters', status }),
        onGroup: group => interaction.dispatch({ type: 'filters', group }), onRetry: () => { map.pause(); vc.setUi({}); vc.retry(); }, onList: () => interaction.leave(true),
      });
    },
    afterPaint(root, vc, plan, listFocus) {
      latest = vc;
      if (shown) {
        if (!listTransition) reveal = null; // back on Map, unless an explicit departure is crossing paint
        const viewport = root.querySelector<HTMLElement>('[data-testid="map-viewport"]');
        if (viewport && (viewport.clientWidth !== canvasWidth || viewport.clientHeight !== canvasHeight)) { canvasWidth = viewport.clientWidth; canvasHeight = viewport.clientHeight; vc.setUi({}); }
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
      if (reason === 'dispose') { map.dispose(); view.dispose(); interaction.reset(); shown = false; }
      else if (reason === 'hidden') { view.clearAnnouncements(); map.pause(); interaction.leave(); }
      else forget();
    },
  };
}

function readinessText(item: ItemView, fact: DerivedTask | undefined, guidance: boolean, active: boolean, titleOf: (id: string) => string, language: InterfaceLanguage): string {
  const c = COPY[language];
  if (item.status === 'skipped') return c.skippedHelp;
  if (item.status === 'blocked') return c.blockedHelp;
  if (item.status !== 'pending') return '';
  if (!active) return c.closedPending;
  if (!guidance) return c.pendingHelp;
  const open = (fact?.prerequisites ?? []).filter(p => p.kind !== 'task' || p.status !== 'done');
  if (fact?.group === 'ready') return fact.prerequisites.length ? c.readyDeps : c.readyNoDeps;
  if (fact?.group === 'skipped') return c.skippedDeps(open.filter(p => p.kind === 'task' && p.status === 'skipped').map(p => titleOf(p.id)).join('; '));
  return c.waitingDeps(mapCount(open.length, 'unfinished', language));
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
const ATTRIBUTION: Record<InterfaceLanguage, typeof ATTRIBUTION_EN> = { en: ATTRIBUTION_EN, ru: ATTRIBUTION_RU };
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
