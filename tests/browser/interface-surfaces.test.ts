import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { resolveLanguage } from '../../ui/shared/i18n.ts';
import * as model from '../../ui/shared/model.ts';
import * as scope from '../../ui/shared/scope.ts';
import * as live from '../../ui/shared/live.ts';
import { plural } from '../../ui/shared/format.ts';
import { queryProblem } from '../../ui/shared/search.ts';
import { parsePlansPage } from '../../ui/shared/adapter.ts';
import { chipLabel } from '../../ui/shared/search-view.ts';
import { criteriaKey } from '../../ui/shared/search.ts';
import { plansPage, summary } from './fixtures.ts';

function surfaceHarness(surface: string, overrides: Record<string, object> = {}) {
  let spec: any;
  const nodes: any[] = [];
  const el = (_tag: string, _class = '', text = ''): any => ({ text, dataset: {}, childNodes: [], append(...children: any[]) { this.childNodes.push(...children); nodes.push(...children); }, setAttribute() {}, addEventListener() {}, querySelector: () => null, querySelectorAll: () => [] });
  const components = { el, testid: (node: any) => node, emptyBlock: (_id: string, title: string, text: string) => ({ text: `${title} ${text}` }), languageBlock: () => ({ text: '' }), button: (_p: any, _id: string, text: string) => nodes.push({ text }), detailsBlock: () => ({ text: '' }), failureFacts: () => [] };
  const noopController = class { beginPaint() {} claim() { return {}; } };
  const js = ts.transpileModule(readFileSync(new URL(`../../ui/${surface}/main.ts`, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports: any = {};
  const exposed = surface === 'status' ? 'statusProgress, qualifiers' : surface === 'page' ? 'planList, labelsFor, boardTop' : 'picker';
  runInNewContext(`${js}\nObject.assign(exports, { ${exposed} });`, { exports, document: { addEventListener() {}, getElementById: () => null }, window: { addEventListener() {} }, require: (path: string) => {
    if (overrides[path]) return overrides[path];
    if (path.endsWith('/app.ts')) return { startView: (value: any) => { spec = value; } };
    if (path.endsWith('/i18n.ts')) return { resolveLanguage };
    if (path.endsWith('/model.ts')) return model;
    if (path.endsWith('/scope.ts')) return scope;
    if (path.endsWith('/live.ts')) return live;
    if (path.endsWith('/format.ts')) return { plural };
    if (path.endsWith('/primitives.ts')) return { segmentedBar: (_s: any, label: string) => ({ text: label }), stateChip: ({ count, label }: any) => count ? { text: `${count} ${label}` } : null, warningLine: (text: string) => ({ text }), icon: () => ({ text: '' }) };
    if (path === '@openchamber/sdk/ui') return { mountList(_holder: any, options: any) { nodes.push(...options.items.map((item: any) => ({ text: item.title }))); } };
    if (path.endsWith('/components.ts')) return components;
    if (path.endsWith('/dependency-map-view.ts')) return { createMapFrame: () => ({ sync() {} }) };
    if (path.endsWith('/default-view.ts')) return { DefaultViewChoice: class {} };
    if (path.endsWith('/refresh.ts')) return { RecentMemory: class {} };
    if (path.endsWith('/search.ts')) return { SearchController: noopController };
    if (path.endsWith('/capture-comparison.ts')) return { CaptureController: noopController };
    if (path.endsWith('/reporting-health.ts')) return { ReportingHealth: noopController };
    if (path.endsWith('/reporting-health-view.ts')) return { reportingHealthBlock: () => ({ text: '' }) };
    if (path.endsWith('/cleanup-view.ts')) return { cleanupNotice: () => null };
    if (path.endsWith('/setup.ts')) return { setupBlock: () => ({ text: '' }) };
    if (path.endsWith('/official.ts')) return { officialMainBlock: () => null, officialMainLine: () => null };
    return {};
  } });
  return { spec, nodes, exports, rendered: () => nodes.map(n => n?.text ?? '').join(' ') };
}

for (const surface of ['panel', 'status', 'page']) test(`${surface}: actual empty render follows language without changing state`, () => {
  const { spec, nodes, rendered } = surfaceHarness(surface);
  const ui = { presentation: 'list', tab: 'progress', archived: false, filters: {}, search: null };
  const vc = { ui, env: { locale: 'ru' }, language: {}, session: null, health: { ready: false }, setup: {}, ctx: {}, identity: 'test', sessionSubscriptions: 0 };
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

test('status counts, readiness chips and qualifiers rerender in Russian and English', () => {
  const h = surfaceHarness('status');
  const projection = { summary: { total: 8, done: 3, remaining: 4, skipped: 1, working: 1, blocked: 1 }, reported: { working: 1, blocked: 1, skipped: 1, pending: 3 }, ready: 2, waiting: 1, detailUnavailable: true, readiness: { state: 'invalid' } };
  h.exports.statusProgress(projection, { lifecycle: 'active' }, 'ru');
  h.exports.qualifiers(projection, false, '12:30', 'ru');
  assert.match(h.rendered(), /выполнено, осталось: 4, пропущено: 1/);
  assert.match(h.rendered(), /нужно ваше участие/);
  assert.match(h.rendered(), /готово к работе/);
  assert.match(h.rendered(), /Не обновлялось с 12:30/);
  assert.match(h.rendered(), /Готовность и ожидание недоступны/);
  h.nodes.length = 0;
  h.exports.statusProgress(projection, { lifecycle: 'active' }, 'en');
  assert.match(h.rendered(), /done, 4 remaining, 1 skipped/);
  assert.match(h.rendered(), /needs you/);
});

test('board finished folds translate without changing source-qualified grouping and fold state', () => {
  const h = surfaceHarness('page');
  const plans = parsePlansPage(JSON.stringify(plansPage([summary('done-plan', [], { title: 'User title unchanged', lifecycle: 'finished' })]))).data;
  const env = { locale: 'ru', live: live.EMPTY_LIVE, boundSource: null, unverifiedSources: new Set() };
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
