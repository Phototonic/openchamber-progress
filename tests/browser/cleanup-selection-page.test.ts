import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { PlanSelection, selectionConfirmation } from '../../ui/shared/cleanup.ts';
import { BoardDerivation, NO_FILTERS, ALL } from '../../ui/shared/scope.ts';
import { EMPTY_LIVE } from '../../ui/shared/live.ts';
import { parsePlansPage } from '../../ui/shared/adapter.ts';
import { plansPage, summary, SRC } from './fixtures.ts';
import { pageHook } from './page-hooks.ts';

// Exercise the production paint's selection reconciliation, including its cache guards.
const source = readFileSync(new URL('../../ui/page/main.ts', import.meta.url), 'utf8');
const start = source.indexOf('// Derive once per list/search page');
const end = source.indexOf('const empty = !v', start);
assert(start >= 0 && end > start);
const code = ts.transpileModule(`(()=>{${source.slice(start, end)}})()`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const file = ts.createSourceFile('page.ts', source, ts.ScriptTarget.Latest, true);
const fn = (name: string) => file.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name);
const scope = fn('selectionScope');
const endWithoutCleanup = fn('endSelectionWithoutCleanup');
const plans = parsePlansPage(JSON.stringify(plansPage([
  summary('alpha', [], { directory: '/fixture/Alpha', lifecycle: 'finished' }),
  summary('beta', [], { directory: '/fixture/Beta', lifecycle: 'finished' }),
]))).data;

function frame() {
  const selection = new PlanSelection(), board = new BoardDerivation();
  const vc = {
    identity: 'fixture', health: { planCleanup: 1 as 1 | undefined }, ctx: { connection: { account: 'fixture' } },
    ui: { filters: { ...NO_FILTERS }, archived: false, search: null as null | { key: string } },
    read: { plans, truncated: false },
    env: { live: { ...EMPTY_LIVE, projectsState: 'ready' as const }, boundSource: SRC },
  };
  const derivedBoard = () => board.get({ plans: vc.read.plans, live: vc.env.live, filters: vc.ui.filters,
    bound: SRC, locale: 'en', archived: false, reading: 'fixture' });
  const globals = createContext({ vc, ui: vc.ui, read: vc.read, selection, derivedBoard,
    visiblePlans: () => derivedBoard().plans, ownerOf: () => 'fixture', v: null,
    isSearching: () => !!vc.ui.search,
    selectionPlans: null, selectionHits: null, selectionHitCount: -1, selectionSearchPlans: [], selectionEpoch: 0 });
  for (const node of [scope, endWithoutCleanup]) if (node) runInContext(ts.transpileModule(node.getText(file),
    { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, globals);
  return { vc, selection, derivedBoard, globals,
    paint() { globals.read = vc.read; runInContext(code, globals); } };
}

for (const kind of ['project', 'worktree'] as const) test(`Select all cannot widen after its effective ${kind} disappears`, () => {
  const f = frame();
  const place = f.derivedBoard().places.get(plans[0].key)!;
  f.vc.ui.filters[kind] = kind === 'project' ? place.projectKey : place.worktreeKey;
  assert.notEqual(f.derivedBoard().filters[kind], ALL);
  f.paint(); f.selection.mode = true; f.selection.selectAll();
  assert.equal(f.selection.count, 1);
  f.vc.read = { plans: [plans[1]], truncated: false };
  assert.equal(f.derivedBoard().filters[kind], ALL);
  f.paint();
  const next = selectionConfirmation(f.selection.snapshot().plans, 'store', 'reading', false, 'delete', true);
  assert.equal(next.targets.length, 0, 'another location must require a new selection gesture');
  assert.equal(f.selection.all, false);
  assert.equal(f.selection.mode, false);
});

test('Select all counts newly appended hits in the same search page array, deduplicating task hits', () => {
  const f = frame();
  const hits: { plan: typeof plans[number] }[] = [];
  f.vc.ui.search = { key: 'search' };
  f.globals.v = { page: { hits, number: 1, checked: true }, criteria: { ...NO_FILTERS } };
  f.paint(); f.selection.mode = true; f.selection.selectAll();
  hits.push({ plan: plans[0] }); f.paint();
  assert.equal(f.selection.count, 1);
  hits.push({ plan: plans[0] }, { plan: plans[1] }); f.paint();
  assert.equal(f.selection.count, 2);
  assert.equal(f.selection.snapshot().plans.length, 2);
});

for (const searching of [false, true]) test(`Select mode ends when the service stops offering cleanup (${searching ? 'search results' : 'browse'})`, () => {
  const f = frame();
  if (searching) { f.vc.ui.search = { key: 'search' }; f.globals.v = { page: { hits: [], number: 1, checked: true }, criteria: { ...NO_FILTERS } }; }
  const paintTop = () => runInContext('endSelectionWithoutCleanup(vc)', f.globals);
  f.paint(); f.selection.mode = true; f.selection.toggle(plans[0]);
  paintTop(); f.paint();
  assert.equal(f.selection.mode, true, 'capable service keeps the mode');
  assert.equal(f.globals.selectionEpoch, 0);
  f.vc.health = { planCleanup: undefined };
  paintTop(); f.paint();
  assert.equal(f.selection.mode, false);
  assert.equal(f.selection.count, 0);
  assert.equal(f.globals.selectionEpoch, 0, 'ending the mode leaves a finished result bound to its scope; the controller retires pending counts');
});
// The production paint, driven with a null read (Archived on a service without cleanup): anything the paint
// builds beyond its selection handling is a no-op stub, so only real page state is observed.
test('the production paint ends Select mode on an Archived read-less frame without cleanup support', () => {
  const selection = new PlanSelection();
  selection.reconcile('archived', [], false); selection.mode = true; selection.toggle(plans[0]);
  const stub: any = new Proxy(function () {}, { get: (_t, k) => (k === Symbol.toPrimitive ? () => '' : stub), apply: () => stub, construct: () => stub });
  const base: Record<string | symbol, unknown> = { selection, selectionEpoch: 0, document: { getElementById: () => null, activeElement: null }, caret: null };
  const sandbox = new Proxy(base, { has: () => true, get: (t, k) => (k in t ? t[k] : k in globalThis ? (globalThis as any)[k] : stub) });
  createContext(sandbox);
  if (endWithoutCleanup) runInContext(ts.transpileModule(endWithoutCleanup.getText(file), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, sandbox);
  const paint = pageHook('paint', sandbox);
  const vc = { read: null, failure: null, ui: { archived: true, search: null, filters: { ...NO_FILTERS } }, health: { ready: true }, env: { locale: 'en' }, inbox: null, identity: 'fixture' };
  paint({ append() {} }, vc);
  assert.equal(selection.mode, false);
  assert.equal(selection.count, 0);
  assert.equal(base.selectionEpoch, 0);
});

test('a cached search page does not reselect a plan a receipt took out; a checked one does', () => {
  const f = frame();
  const hits: { plan: typeof plans[number] }[] = [{ plan: plans[0] }, { plan: plans[1] }];
  f.vc.ui.search = { key: 'search' };
  const page = { hits, number: 1, checked: true };
  f.globals.v = { page, criteria: { ...NO_FILTERS } };
  f.paint(); f.selection.mode = true; f.selection.selectAll();
  f.selection.forget([plans[0].key]);
  page.checked = false; f.globals.v = { page: { ...page, hits: [...hits] }, criteria: { ...NO_FILTERS } };
  f.paint();
  assert.equal(f.selection.has(plans[0].key), false, 'an unverified cached page is not evidence');
  f.globals.v = { page: { ...page, hits: [...hits], checked: true }, criteria: { ...NO_FILTERS } };
  f.paint();
  assert.equal(f.selection.has(plans[0].key), true);
});

// The page's own search host: a plan a freshness reply shows gone reaches the selection however the page is painted.
function searchHost(selection: PlanSelection) {
  let host: { gone?: (plans: ReadonlyMap<string, number | null>) => void } | undefined;
  const declaration = file.statements.flatMap(n => ts.isVariableStatement(n) ? [...n.declarationList.declarations] : [])
    .find(d => ts.isIdentifier(d.name) && d.name.text === 'search');
  assert.ok(declaration?.initializer, 'the page constructs its search controller');
  const globals = createContext({ SearchController: class { constructor(h: typeof host) { host = h; } }, frame: null, document: { visibilityState: 'visible' }, selection });
  runInContext(ts.transpileModule(`(${declaration.initializer.getText(file)})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, globals);
  assert.ok(host, 'the controller received its host');
  return host;
}
test('a plan a freshness reply shows gone leaves the selection with that reply\'s generation, whatever page is painted', () => {
  const rows = ['a', 'b'].map(id => ({ ...plans[0], key: id, id, cleanup: { state: 'visible' as const, revision: 1 } }));
  const selection = new PlanSelection();
  selection.reconcile('scope', rows, true); selection.mode = true; selection.selectAll();
  const host = searchHost(selection);
  assert.equal(typeof host.gone, 'function', 'the host passes departures on');
  host.gone!(new Map<string, number | null>([['a', 3]]));
  assert.equal(selection.has('a'), false);
  assert.equal(selection.count, 1);
  assert.equal(selection.snapshot().includes({ ...rows[0], cleanup: { state: 'visible', revision: 3 } }), false);
  assert.equal(selection.snapshot().includes({ ...rows[0], cleanup: { state: 'visible', revision: 4 } }), true, 'restored elsewhere since');
});
