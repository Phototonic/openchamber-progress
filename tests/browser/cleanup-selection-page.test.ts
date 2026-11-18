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

// Exercise the production paint's selection reconciliation, including its cache guards.
const source = readFileSync(new URL('../../ui/page/main.ts', import.meta.url), 'utf8');
const start = source.indexOf('// Derive once per list/search page');
const end = source.indexOf('const empty = !v', start);
assert(start >= 0 && end > start);
const code = ts.transpileModule(`(()=>{${source.slice(start, end)}})()`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const file = ts.createSourceFile('page.ts', source, ts.ScriptTarget.Latest, true);
const scope = file.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'selectionScope');
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
    selectionPlans: null, selectionHits: null, selectionHitCount: -1, selectionSearchPlans: [], selectionPage: '' });
  if (scope) runInContext(ts.transpileModule(scope.getText(file),
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
  f.paint(); f.selection.mode = true; f.selection.toggle(plans[0]);
  f.paint();
  assert.equal(f.selection.mode, true, 'capable service keeps the mode');
  f.vc.health = { planCleanup: undefined };
  f.paint();
  assert.equal(f.selection.mode, false);
  assert.equal(f.selection.count, 0);
});
