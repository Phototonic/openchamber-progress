import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { resolveLanguage } from '../../ui/shared/i18n.ts';
import * as model from '../../ui/shared/model.ts';
import * as scope from '../../ui/shared/scope.ts';
import * as live from '../../ui/shared/live.ts';
import * as inbox from '../../ui/shared/inbox.ts';
import * as defaultView from '../../ui/shared/default-view.ts';
import * as cleanup from '../../ui/shared/cleanup.ts';
import { formatCount, plural } from '../../ui/shared/format.ts';
import { queryProblem } from '../../ui/shared/search.ts';
import { parsePlansPage } from '../../ui/shared/adapter.ts';
import { chipLabel } from '../../ui/shared/search-view.ts';
import { criteriaKey } from '../../ui/shared/search.ts';
import { plansPage, summary } from './fixtures.ts';
import { CompactInbox } from '../../ui/shared/inbox-view.ts';
import * as quiet from '../../ui/shared/quiet-plans.ts';

function surfaceHarness(surface: string, overrides: Record<string, object> = {}) {
  let spec: any;
  const nodes: any[] = [];
  const shells: any[] = [], maps: any[] = [], lists: any[] = [];
  const frameWindow = { innerWidth: 390, addEventListener() {} };
  const el = (_tag: string, _class = '', text = ''): any => ({ text, dataset: {}, classList: { add() {} }, childNodes: [], append(...children: any[]) { this.childNodes.push(...children); nodes.push(...children); }, setAttribute() {}, addEventListener() {}, querySelector: () => null, querySelectorAll: () => [] });
  const components = { el, allDone: () => {}, ProgressShell: class {
      activePanel: string | null = null; selected: string | null = null;
      constructor() { shells.push(this); }
      reconcile(_vc: any, plan: any) { const selected = plan?.key ?? null; if (selected !== this.selected) { this.selected = selected; this.activePanel = null; } }
      paint(_root: any, vc: any, plan: any) { this.reconcile(vc, plan); return !!this.activePanel; }
      reset() { this.selected = null; this.activePanel = null; }
    },
    narrowSurface: () => frameWindow.innerWidth < 320,
    planPicker: (options: any) => { const node = el('div'); node.dataset.testid = 'plan-selector'; node.options = options; nodes.push(node); return node; },
    planDetail: (...args: any[]) => { lists.push(args); return el('article'); }, surfaceViewSwitch: () => el('div'),
    quietAge: () => null,
    testid: (node: any, id: string) => { node.dataset ??= {}; node.dataset.testid = id; return node; },
    emptyBlock: (_id: string, title: string, text: string) => ({ text: `${title} ${text}` }), languageBlock: () => ({ text: '' }),
    button: (_p: any, id: string, text: string, click?: () => void) => nodes.push({ text, dataset: { testid: id }, click }), recoveredHeading: (root: any) => root.recovered ?? null, detailsBlock: () => ({ text: '' }), failureFacts: () => [],
    failureBlock: () => ({ text: 'Read failed' }), retryRead: () => () => {}, loadingBlock: () => ({ text: 'Loading' }) };
  const noopController = class { beginPaint() {} claim() { return {}; } };
  const js = ts.transpileModule(readFileSync(new URL(`../../ui/${surface}/main.ts`, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports: any = {};
  const exposed = surface === 'status' ? 'statusProgress, messages' : surface === 'page' ? 'planList, labelsFor, boardTop, currentTask, surface, footer' : 'picker';
  const historyIntent = surface === 'page' ? `exports.historyIntent = (key,stage='detail') => { pendingTask = { key, item:'I1', title:'Fixture task', stage, origin:stage==='detail'?'history':'search' }; }; exports.surfacePanel = kind => { shell.activePanel = kind; }; exports.pendingIntent = () => pendingTask; exports.boardContext = vc => { frame = vc; };` : '';
  runInNewContext(`${js}\nObject.assign(exports, { ${exposed} });\n${historyIntent}`, { exports, document: { addEventListener() {}, getElementById: () => null }, window: frameWindow, require: (path: string) => {
    if (overrides[path]) return overrides[path];
    if (path.endsWith('/app.ts')) return { startView: (value: any) => { spec = value; } };
    if (path.endsWith('/i18n.ts')) return { resolveLanguage };
    if (path.endsWith('/model.ts')) return model;
    if (path.endsWith('/scope.ts')) return scope;
    if (path.endsWith('/quiet-plans.ts')) return quiet;
    if (path.endsWith('/live.ts')) return live;
    if (path.endsWith('/inbox.ts')) return inbox;
    if (path.endsWith('/format.ts')) return { formatCount, plural };
    if (path.endsWith('/primitives.ts')) return { segmentedBar: (_s: any, label: string) => ({ text: label }), stateChip: ({ count, label }: any) => count ? { text: `${count} ${label}` } : null, warningLine: (text: string) => ({ text }), icon: () => ({ text: '' }) };
    if (path === '@openchamber/sdk/ui') return { mountList(_holder: any, options: any) { nodes.push(...options.items.map((item: any) => ({ text: item.title }))); } };
    if (path.endsWith('/components.ts')) return components;
    if (path.endsWith('/dependency-map-view.ts')) return { createMapFrame: () => ({ sync(...args: any[]) { maps.push(args); }, paint() { nodes.push({ dataset: { testid: 'painted-map' } }); }, listTargets() {} }) };
    if (path.endsWith('/default-view.ts')) return defaultView;
    if (path.endsWith('/cleanup.ts')) return cleanup;
    if (path.endsWith('/refresh.ts')) return { RecentMemory: class {} };
    if (path.endsWith('/search.ts')) return { SearchController: noopController };
    if (path.endsWith('/capture-comparison.ts')) return { CaptureController: noopController };
    if (path.endsWith('/reporting-health.ts')) return { ReportingHealth: noopController };
    if (path.endsWith('/reporting-health-view.ts')) return { reportingHealthBlock: () => ({ text: '' }) };
    if (path.endsWith('/cleanup-view.ts')) return { cleanupNotice: () => null, cleanupBlock: () => el('div') };
    if (path.endsWith('/setup.ts')) return { setupBlock: () => ({ text: '' }), reloadNote: () => null };
    if (path.endsWith('/census-view.ts')) return { runClaim: () => null, subagentsBlock: () => null };
    if (path.endsWith('/subagents.ts')) return { rosterFor: () => null };
    if (path.endsWith('/census.ts')) return { censusFor: () => null, planFacts: () => null };
    if (path.endsWith('/inbox-view.ts')) return { CompactInbox, hiddenInboxAction: () => [], inboxSection: (inbox: unknown, _env: unknown, options: unknown) => ({ dataset: { testid: 'needs-you-inbox' }, inbox, options }) };
    return {};
  } });
  return { spec, nodes, exports, shells, maps, lists, window: frameWindow, rendered: () => nodes.map(n => n?.text ?? '').join(' ') };
}

function shellContext() {
  const items = [{ id: 'A', title: 'First', kind: 'task' as const, status: 'done' as const }, { id: 'B', title: 'Second', kind: 'task' as const, status: 'pending' as const, dependencies: ['A'] }];
  const plan = parsePlansPage(JSON.stringify(plansPage([summary('P-shell', items)]))).data[0]!;
  const vc: any = {
    ctx: { connection: { account: 'fixture' } }, identity: 'fixture', session: { id: plan.ownerSessionId },
    ui: { filters: scope.NO_FILTERS, selected: plan.key, tab: 'progress', presentation: 'list', archived: false, search: null },
    read: { plans: [plan], binding: { verified: true }, captureEnabled: true }, health: { ready: true, planGraph: 1 },
    quiet: { hide: true }, live: live.EMPTY_LIVE, env: { locale: 'en', now: 0, live: live.EMPTY_LIVE, boundSource: plan.sourceId, unverifiedSources: new Set() },
    detailResult: () => ({ current: () => true, result: { ok: true, plan, detail: { items } } }),
    detail: () => null, summary: () => null, document: () => null,
  };
  return { vc, plan };
}

test('board without a selected plan keeps the held source-wide inbox reachable', () => {
  const h = surfaceHarness('page'), { vc } = shellContext();
  vc.read.plans = []; vc.ui.selected = null; vc.ui.archived = true;
  vc.inbox = { marker: 'source-wide' };
  h.exports.footer({ append: (...nodes: any[]) => h.nodes.push(...nodes) }, vc, null);
  const inbox = h.nodes.find(n => n?.dataset?.testid === 'needs-you-inbox');
  assert.equal(inbox?.inbox, vc.inbox);
  assert.equal(inbox?.options.keys.size, 0, 'no selected plan stays in an empty current scope; the component offers other plans explicitly');
  assert.equal(inbox?.options.state.all, false);
});

for (const surface of ['panel', 'page']) test(`${surface}: a settled automatic Map survives resizing below 320px`, () => {
  const h = surfaceHarness(surface), { vc } = shellContext();
  Object.assign(vc.ui, h.spec.prepareUi(vc));
  assert.equal(surface === 'page' ? vc.ui.tab : vc.ui.presentation, 'map');
  h.window.innerWidth = 280;
  Object.assign(vc.ui, h.spec.prepareUi(vc));
  assert.equal(surface === 'page' ? vc.ui.tab : vc.ui.presentation, 'map');
  const fresh = surfaceHarness(surface);
  fresh.window.innerWidth = 280;
  vc.ui.tab = 'progress'; vc.ui.presentation = 'list';
  Object.assign(vc.ui, fresh.spec.prepareUi(vc));
  assert.equal(surface === 'page' ? vc.ui.tab : vc.ui.presentation, surface === 'page' ? 'progress' : 'list', 'a new narrow reading still starts on List');
});

test('board search never offers the browse-only plan picker', () => {
  const h = surfaceHarness('page', { '../shared/search.ts': { SearchController: class { key = 'run'; view() { return { run: 1 }; } } } });
  const { vc, plan } = shellContext();
  vc.read.plans.push({ ...plan, id: 'another', key: `${plan.sourceId}/another` });
  vc.health.planTaskSearch = 1;
  vc.ui.search = { key: 'run', owner: JSON.stringify(['fixture', 'fixture']) };
  h.exports.surface({ append() {} }, vc, plan);
  assert.equal(h.nodes.some(n => n?.dataset?.testid === 'plan-selector'), false);
});

test('rail reconciles a previous plan panel before choosing the cached plan Map mount', () => {
  const h = surfaceHarness('panel'), { vc, plan } = shellContext();
  h.shells[0].selected = `${plan.sourceId}/previous`;
  h.shells[0].activePanel = 'document';
  vc.ui.presentation = 'map';
  h.spec.paint({ append: (...nodes: any[]) => h.nodes.push(...nodes) }, vc);
  assert.equal(h.maps.at(-1)[3], true, 'selected Map is active for the new plan on its first paint');
  assert.equal(h.nodes.some(n => n?.dataset?.testid === 'painted-map'), true);
  assert.equal(h.lists.length, 0, 'must not render List under a pressed Map switch');
});

test('leaving History cancels a delayed current-task reveal before it can read or navigate', () => {
  const h = surfaceHarness('page');
  const plan = parsePlansPage(JSON.stringify(plansPage([summary('P-history', [])]))).data[0]!;
  h.exports.historyIntent(plan.key);
  h.exports.currentTask({}, {
    ui: { search: null, filters: scope.NO_FILTERS, selected: plan.key, tab: 'progress' },
    env: { live: live.EMPTY_LIVE, boundSource: plan.sourceId }, read: { plans: [plan] },
    detail() { throw Error('A closed History panel must not resume its task reveal'); },
    setUi() { throw Error('A closed History panel must not navigate'); },
  });
  assert.equal(h.exports.pendingIntent(), null);
});
test('opening a replacement panel cancels pending search and list reveals', () => {
  const h = surfaceHarness('page');
  for (const stage of ['search', 'reveal']) {
    h.exports.historyIntent('fixture-plan', stage);
    h.exports.surfacePanel('document');
    h.exports.currentTask({}, {});
    assert.equal(h.exports.pendingIntent(), null);
  }
});

for (const surface of ['panel', 'status', 'page']) test(`QA-R ${surface}: current source render has no update notice in pending, setup and failed views`, () => {
  const h = surfaceHarness(surface);
  for (const locale of ['en', 'ru']) for (const state of ['pending', 'unconfigured', 'failed']) {
    h.nodes.length = 0;
    const vc = { ui: { presentation: 'list', tab: 'progress', archived: false, filters: {}, search: null },
      env: { locale }, quiet: { hide: true }, language: {}, session: null, health: state === 'pending' ? null : { ready: false },
      failure: state === 'failed' ? { kind: 'unavailable' } : null, setup: {}, ctx: {}, identity: 'test', sessionSubscriptions: 0 };
    // A stale old availability cannot supply presentation authority to a new entry.
    Object.defineProperty(vc, 'officialMain', { get() { throw Error('Retired metadata consumed'); } });
    h.spec.paint({ append: (...children: any[]) => h.nodes.push(...children) }, vc);
    assert.ok(!h.nodes.some(n => /extension-update/.test(n?.dataset?.testid ?? '')));
    assert.doesNotMatch(h.rendered(), /Official main|официальной main/);
  }
});

for (const surface of ['panel', 'status', 'page']) test(`${surface}: actual empty render follows language without changing state`, () => {
  const { spec, nodes, rendered } = surfaceHarness(surface);
  const ui = { presentation: 'list', tab: 'progress', archived: false, filters: {}, search: null };
  const vc = { ui, env: { locale: 'ru' }, quiet: { hide: true }, language: {}, session: null, health: { ready: false }, setup: {}, ctx: {}, identity: 'test', sessionSubscriptions: 0 };
  // Setup itself belongs to the shared setup renderer; this test covers entry-owned content.
  spec.paint({ append: (...children: any[]) => nodes.push(...children) }, vc);
  assert.match(rendered(), surface === 'page' ? /Текущие планы/ : /Сессия не выбрана/);
  nodes.length = 0;
  vc.env.locale = 'en';
  spec.paint({ append: (...children: any[]) => nodes.push(...children) }, vc);
  assert.match(rendered(), surface === 'page' ? /Current plans/ : /No session selected/);
  assert.doesNotMatch(rendered(), /Сессия не выбрана|Текущие планы/);
  assert.equal(vc.ui, ui);
});

test('panel: a pinned scope offers a localized Show current session that hands focus off before resetting', () => {
  const h = surfaceHarness('panel');
  const copy = { en: ['Progress for selected session: Session A', 'Show current session', 'Showing the current session'], ru: ['Прогресс выбранной сессии: Сессия A', 'Показать текущую сессию', 'Показана текущая сессия'] } as const;
  for (const locale of ['en', 'ru'] as const) for (const state of [null, 'checking', 'unavailable', 'invalid']) {
    h.nodes.length = 0;
    const calls: string[] = []; let handoff: any = null;
    const vc = { ui: { presentation: 'list', selected: null }, env: { locale }, language: {}, session: state === 'invalid' ? null : { id: 'A' }, live: live.EMPTY_LIVE,
      progressAction: true, progressContext: state, progressReset: () => calls.push('reset'), handoff: (value: any) => { calls.push('handoff'); handoff = value; },
      read: null, failure: null, health: null, setup: {}, ctx: {}, identity: 'test', sessionSubscriptions: 0 };
    h.spec.paint({ append: (...children: any[]) => h.nodes.push(...children) }, vc);
    const line = h.nodes.find(n => n?.dataset?.testid === 'session-action-scope');
    assert.ok(line, `${locale}/${state}: labelled pinned-scope line`);
    assert.equal(h.nodes.some(n => n?.text === copy[locale][0]), state !== 'invalid', `${locale}/${state}: honest scope label`);
    const reset = h.nodes.find(n => n?.dataset?.testid === 'session-action-reset');
    assert.equal(reset?.text, copy[locale][1], `${locale}/${state}: reset offered beside the label`);
    reset.click();
    assert.deepEqual(calls, ['handoff', 'reset'], 'hand-off is requested before the scope changes');
    assert.equal(handoff.notice(null, locale), copy[locale][2]);
    const heading = { testid: 'empty-state' }, retry = { testid: 'retry' };
    assert.equal(handoff.heading({ recovered: heading, querySelector: () => retry }), heading, 'resulting state heading first');
    assert.equal(handoff.heading({ querySelector: (s: string) => s === '[role="alert"] button' ? retry : null }), retry, 'a failed read lands on its Try again');
  }
  h.nodes.length = 0;
  h.spec.paint({ append: (...children: any[]) => h.nodes.push(...children) }, { ui: { presentation: 'list', selected: null }, env: { locale: 'en' }, language: {}, session: { id: 'B' }, live: live.EMPTY_LIVE, progressAction: false, read: null, failure: null, health: null, setup: {}, ctx: {}, identity: 'test', sessionSubscriptions: 0 });
  assert.equal(h.nodes.some(n => /^session-action-/.test(n?.dataset?.testid ?? '')), false, 'ordinary opening has no pinned line or reset');
});

test('status fraction and accessible whole-plan summary rerender without chips', () => {
  const h = surfaceHarness('status');
  const projection = { summary: { total: 8, done: 3, remaining: 4, skipped: 1, working: 1, blocked: 1 }, reported: { working: 1, blocked: 1, skipped: 1, pending: 3 }, ready: 2, waiting: 1, detailUnavailable: true, readiness: { state: 'invalid' } };
  h.exports.statusProgress(projection, { lifecycle: 'active' }, 'ru');
  assert.match(h.rendered(), /выполнено, осталось: 4, пропущено: 1/);
  assert.match(h.rendered(), /1 заблокировано/);
  assert.doesNotMatch(h.rendered(), /готово к работе/);
  assert.equal(h.nodes.some(n => n.dataset?.testid === 'state-chip'), false);
  h.nodes.length = 0;
  h.exports.statusProgress(projection, { lifecycle: 'active' }, 'en');
  assert.match(h.rendered(), /done, 4 remaining, 1 skipped/);
  assert.match(h.rendered(), /1 blocked/);
  assert.doesNotMatch(h.rendered(), /2 ready/);
  assert.doesNotMatch(h.rendered(), /needs you/);
});

test('status quantities group Russian thousands but keep English and machine counts raw', () => {
  const h = surfaceHarness('status');
  const projection = { summary: { total: 3030, done: 1000, remaining: 1030, skipped: 1000, working: 1000, blocked: 1000 }, reported: null, ready: null, waiting: null };
  for (const [locale, done, total, remaining] of [['ru', '1\u00a0000', '3\u00a0030', '1\u00a0030'], ['en', '1000', '3030', '1030']]) {
    h.nodes.length = 0;
    h.exports.statusProgress(projection, { lifecycle: 'completed' }, locale);
    assert.ok(h.nodes.some(n => n.text === done));
    assert.ok(h.nodes.some(n => n.text === `/${total}`));
    assert.ok(h.rendered().includes(locale === 'ru' ? `осталось: ${remaining}, пропущено: ${done}` : `${remaining} remaining, ${done} skipped`));
    assert.ok(h.rendered().includes(`${done} ${locale === 'ru' ? 'в работе' : 'in progress'}`));
    const counts = h.nodes.find(n => n.dataset?.total === '3030');
    assert.equal(counts.dataset.done, '1000');
    assert.equal(counts.dataset.remaining, '1030');
    const copy = h.exports.messages[locale];
    for (const text of [copy.working(1000), copy.picker('Title1000', false, 1000), copy.more(1000), copy.moreAria(1000)]) assert.ok(text.includes(done));
    assert.ok(copy.picker('Title1000', false, 1000).includes('Title1000'));
  }
});

test('board finished folds translate without changing source-qualified grouping and fold state', () => {
  const h = surfaceHarness('page');
  const plans = parsePlansPage(JSON.stringify(plansPage([summary('done-plan', [], { title: 'User title unchanged', lifecycle: 'finished' })]))).data;
  const env = { locale: 'ru', live: live.EMPTY_LIVE, boundSource: null, unverifiedSources: new Set() };
  const { vc } = shellContext();
  vc.read.plans = plans; vc.env = env;
  h.exports.boardContext(vc);
  const key = scope.placeOf(plans[0], env.live, env.boundSource).projectKey;
  const board = { key: 'reading', finished: new Map([[key, true]]) };
  h.exports.planList(plans, plans[0], env, () => {}, false, board);
  assert.match(h.rendered(), /Завершённые · 1/);
  assert.match(h.rendered(), /Загружено завершённых или отменённых планов: 1/);
  assert.match(h.rendered(), /User title unchanged/);
  assert.equal(h.nodes.find(n => n.dataset?.project === key && 'hidden' in n)?.hidden, false);
  h.nodes.length = 0;
  env.locale = 'en';
  h.exports.planList(plans, plans[0], env, () => {}, false, board);
  assert.match(h.rendered(), /Finished · 1/);
  assert.equal(board.finished.get(key), true);
});

test('held search validation reasons translate at repaint, leaving the invalid query unchanged', () => {
  const problems: string[] = [];
  const h = surfaceHarness('page', {
    '../shared/search.ts': { SearchController: class {}, queryProblem },
    '../shared/search-view.ts': { scopeLine: () => null, boardBar: (hooks: any) => { problems.push(hooks.search.problem); return {}; } },
  });
  const problem = { kind: 'query', q: 'user\0query' };
  const ui = { filters: scope.NO_FILTERS, draft: { lifecycle: scope.ALL, status: scope.ALL, source: scope.ALL }, archived: false, search: null, problem };
  const vc = { ctx: {}, identity: 'test', env: { locale: 'en' }, ui };
  h.exports.boardTop(vc, null, {}, null, true);
  vc.env.locale = 'ru';
  h.exports.boardTop(vc, null, {}, null, true);
  assert.match(problems[0], /unsupported character/);
  assert.match(problems[1], /неподдерживаемый символ/);
  assert.equal(ui.problem, problem);
  assert.equal(problem.q, 'user\0query');
});

test('search choice names use identity, not English or Russian unavailable suffixes', () => {
  const h = surfaceHarness('page');
  for (const locale of ['en', 'ru']) {
    const vc = { read: { plans: [] }, env: { locale, live: { ...live.EMPTY_LIVE, projects: [{ id: 'known', name: 'Project (not available here)' }] }, boundSource: null } };
    const f = { project: 'p:known', worktree: scope.ALL, session: scope.ALL };
    assert.equal(h.exports.labelsFor(vc, f).project, 'Project (not available here)');
    assert.equal(h.exports.labelsFor(vc, { ...f, project: 'missing' }, { project: 'Saved project' }).project, 'Saved project');
  }
});

test('submitted built-in location labels translate, while literal session titles survive disappearance', () => {
  const h = surfaceHarness('page');
  const plans = [{ ownerSessionId: 'foo', directory: '/example', sourceId: 'source-alpha' }];
  const vc = { read: { plans }, env: { locale: 'en', boundSource: 'source-alpha', live: { ...live.EMPTY_LIVE, projects: [{ id: 'alpha', name: 'Alpha', directory: '/example' }] } } };
  const f = { project: 'p:alpha', worktree: 'root:alpha', session: 'foo' };
  const labels = h.exports.labelsFor(vc, f);
  const c: any = { ...f, q: 'user query', source: scope.ALL, lifecycle: scope.ALL, status: scope.ALL, archived: false, labels };
  const key = criteriaKey(c);
  assert.equal(key, criteriaKey({ ...c, labels: {} }), 'presentation origins do not enter the query/location key');
  assert.equal(chipLabel('worktree', c), 'Worktree: Main checkout');
  assert.equal(chipLabel('session', c), 'Session: Session foo');
  assert.equal(chipLabel('worktree', c, 'ru'), 'Рабочее дерево: Основная рабочая копия');
  assert.equal(chipLabel('session', c, 'ru'), 'Сессия: Сессия foo');
  assert.equal(criteriaKey(c), key);
  for (const title of ['Session foo', 'Main checkout', 'Сессия foo']) {
    vc.env.live = { ...vc.env.live, sessions: new Map([['alpha', { state: 'ready', records: [{ id: 'foo', title, directory: '/example' }] }]]) } as any;
    const named = h.exports.labelsFor(vc, f);
    assert.equal(criteriaKey({ ...c, labels: named }), key);
    assert.equal(chipLabel('session', { ...c, labels: named }, 'ru'), `Сессия: ${title}`);
    vc.env.live = { ...vc.env.live, sessions: new Map() };
    assert.equal(chipLabel('session', { ...c, labels: h.exports.labelsFor(vc, f, named) }, 'ru'), `Сессия: ${title}`);
    vc.read.plans = [];
    const retained = h.exports.labelsFor(vc, f, named);
    assert.equal(chipLabel('session', { ...c, labels: retained }, 'ru'), `Сессия: ${title}`);
    vc.read.plans = plans;
  }
});

test('submitted child titles come from the retained loading options, not ready-only sessions', () => {
  const h = surfaceHarness('page');
  const plans = [{ ownerSessionId: 'parent', directory: '/example', sourceId: 'source-alpha' }];
  const f = { project: 'p:alpha', worktree: 'root:alpha', session: 'child' };
  for (const title of ['Release QA', 'Session foo', 'Main checkout']) {
    const snapshot = {
      ...live.EMPTY_LIVE,
      projects: [{ id: 'alpha', name: 'Alpha', directory: '/example' }],
      sessions: new Map([['alpha', { state: 'loading', reload: { complete: true }, records: [{ id: 'child', parentId: 'parent', title, directory: '/example', projectId: 'alpha' }] }]]),
    };
    const vc = { read: { plans }, env: { locale: 'en', boundSource: 'source-alpha', live: snapshot } };
    const labels = h.exports.labelsFor(vc, f);
    const c: any = { ...f, q: 'user query', source: scope.ALL, lifecycle: scope.ALL, status: scope.ALL, archived: false, labels };
    const key = criteriaKey(c);
    assert.equal(chipLabel('session', c), `Session: ${title}`);
    assert.equal(chipLabel('session', c, 'ru'), `Сессия: ${title}`);
    assert.notEqual(labels.sessionGenerated, true);
    vc.env.live = { ...snapshot, sessions: new Map() };
    vc.read.plans = [];
    const retained = h.exports.labelsFor(vc, f, labels);
    assert.equal(chipLabel('session', { ...c, labels: retained }, 'ru'), `Сессия: ${title}`);
    assert.equal(criteriaKey({ ...c, labels: retained }), key);
  }
});

test('unverified owners keep generated labels and cannot contribute live children', () => {
  const h = surfaceHarness('page');
  const plans = [{ ownerSessionId: 'parent', directory: '/example', sourceId: 'source-alpha' }];
  const snapshot: any = {
    ...live.EMPTY_LIVE,
    sessions: new Map([['alpha', { state: 'ready', records: [
      { id: 'parent', title: 'Private host title', directory: '/example', projectId: 'alpha' },
      { id: 'child', parentId: 'parent', title: 'Release QA', directory: '/example', projectId: 'alpha' },
    ] }]]),
  };
  for (const boundSource of [null, 'source-other']) {
    const f = { ...scope.NO_FILTERS, session: 'parent' };
    const vc = { read: { plans }, env: { locale: 'en', boundSource, live: snapshot } };
    const labels = h.exports.labelsFor(vc, f);
    assert.equal(chipLabel('session', { ...f, labels } as any, 'ru'), 'Сессия: Сессия parent');
    const options = scope.filterOptions(plans as any, snapshot, scope.NO_FILTERS, plans as any, boundSource);
    assert.deepEqual(options.sessions.map(o => o.id).sort(), [scope.ALL, 'parent']);
    assert.equal(h.exports.labelsFor(vc, scope.NO_FILTERS).session, undefined);
  }
});

test('choosing a result-only session never reuses the previous session title', () => {
  const h = surfaceHarness('page');
  const plans = [{ ownerSessionId: 'A', directory: '/example', sourceId: 'source-alpha' }];
  const snapshot: any = { ...live.EMPTY_LIVE, sessions: new Map([['alpha', { state: 'ready', records: [
    { id: 'A', title: 'Owner A', directory: '/example', projectId: 'alpha' },
  ] }]]) };
  const vc = { read: { plans }, env: { locale: 'en', boundSource: 'source-alpha', live: snapshot } };
  const before = { ...scope.NO_FILTERS, session: 'A' };
  const previous = h.exports.labelsFor(vc, before);
  const retained = JSON.stringify(previous);
  const result = { ownerSessionId: 'B', directory: '/example', sourceId: 'source-alpha' };
  const choices = scope.searchFilterOptions([...plans, result] as any, snapshot, before, previous, 'source-alpha', 'en');
  const selected = choices.sessions.find(o => o.id === 'B');
  assert.equal(selected?.label, 'Session B');
  const next = { ...before, session: 'B' };
  for (const option of [selected, undefined]) {
    const labels = h.exports.labelsFor(vc, next, previous, option);
    const criteria: any = { ...next, q: 'user query', source: scope.ALL, lifecycle: scope.ALL, status: scope.ALL, archived: false, labels };
    assert.equal(labels.sessionId, 'B');
    assert.equal(chipLabel('session', criteria, 'en'), 'Session: Session B');
    assert.equal(chipLabel('session', criteria, 'ru'), 'Сессия: Сессия B');
    assert.equal(criteriaKey(criteria), criteriaKey({ ...criteria, labels: {} }));
  }
  assert.equal(JSON.stringify(previous), retained);
});

test('the selected option retains its literal title only for the matching session identity', () => {
  const h = surfaceHarness('page');
  const vc = { read: { plans: [] }, env: { locale: 'ru', boundSource: 'source-alpha', live: live.EMPTY_LIVE } };
  const f = { ...scope.NO_FILTERS, session: 'B' };
  const previous = { sessionId: 'A', session: 'Owner A', sessionGenerated: false };
  const selected = { id: 'B', label: 'Owner B <literal>', sessionGenerated: false };
  const labels = h.exports.labelsFor(vc, f, previous, selected);
  assert.equal(chipLabel('session', { ...f, labels } as any, 'ru'), 'Сессия: Owner B <literal>');
  const kept = h.exports.labelsFor(vc, f, labels);
  assert.equal(chipLabel('session', { ...f, labels: kept } as any, 'ru'), 'Сессия: Owner B <literal>');
  const changed = h.exports.labelsFor(vc, { ...f, session: 'C' }, labels);
  assert.equal(chipLabel('session', { ...f, session: 'C', labels: changed } as any, 'ru'), 'Сессия: Сессия C');
  assert.equal(h.exports.labelsFor(vc, scope.NO_FILTERS, labels).session, undefined);
});
