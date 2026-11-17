import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { CleanupScan, tidyConfirmation } from '../../ui/shared/cleanup.ts';
import { BoardDerivation, ALL, NO_FILTERS, pageListScope } from '../../ui/shared/scope.ts';
import { freezeLive, inPlace, scopeAvailability } from '../../ui/shared/search.ts';
import { EMPTY_LIVE } from '../../ui/shared/live.ts';
import { parsePlansPage } from '../../ui/shared/adapter.ts';
import { plansPage, summary, SRC } from './fixtures.ts';

// Execute the production page callbacks, with the real board normalization and scan engine.
const file = ts.createSourceFile('page.ts', readFileSync(new URL('../../ui/page/main.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
function hook(name: string, globals: Record<string, unknown>) {
  let expression = '';
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.getText(file) === 'startView' && ts.isObjectLiteralExpression(node.arguments[0])) {
      const property = node.arguments[0].properties.find(p => ts.isPropertyAssignment(p) && p.name.getText(file) === name);
      if (property && ts.isPropertyAssignment(property)) expression = property.initializer.getText(file);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  assert.ok(expression, name);
  return runInNewContext(ts.transpileModule(`(${expression})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, globals);
}

for (const stale of [{ project: 'd:/fixture/gone' }, { worktree: 'w:/fixture/gone' }]) {
  test(`Tidy uses the displayed normalized scope after the last ${Object.keys(stale)[0]} plan leaves the list`, async () => {
    const loaded = parsePlansPage(JSON.stringify(plansPage([summary('visible', [])]))).data;
    const older = parsePlansPage(JSON.stringify(plansPage([summary('older', [], { lifecycle: 'failed' })]))).data;
    const live = { ...EMPTY_LIVE, projectsState: 'ready' as const };
    const vc = {
      ui: { filters: { ...NO_FILTERS, ...stale }, archived: false }, live,
      env: { boundSource: SRC }, read: { ...parsePlansPage(JSON.stringify(plansPage([]))).envelope, plans: loaded, truncated: true },
      service: () => ({ serviceRequest: async () => { throw Error('Unexpected transport'); } }),
    };
    const board = new BoardDerivation();
    const derivedBoard = () => board.get({ plans: vc.read.plans, live, filters: vc.ui.filters, bound: SRC, locale: 'en', archived: false, reading: 'board' });
    assert.equal(derivedBoard().filters.project, ALL);
    assert.equal(derivedBoard().filters.worktree, ALL);
    const globals = {
      isSearching: () => false, derivedBoard, ALL, freezeLive, inPlace, scopeAvailability, pageListScope, CleanupScan,
      readCleanupListPage: async (_host: unknown, scope: unknown) => {
        assert.equal(JSON.stringify(scope), JSON.stringify({ archived: 'exclude' }));
        return { plans: [...loaded, ...older], visited: 2, nextCursor: null };
      },
    };
    const scan = hook('tidyScan', globals)(vc, 'board') as CleanupScan;
    const counted = await scan.more(() => true);
    assert.deepEqual(counted?.targets.map(p => p.request.plan), ['older']);
    assert.equal(counted?.matching, false);
    assert.equal(hook('tidyMatching', globals)(vc), false);
    const selectionScan = hook('tidyScan', globals)(vc, 'selection', () => true) as CleanupScan;
    const selected = await selectionScan.more(() => true);
    assert.deepEqual(selected?.targets.map(p => p.request.plan), ['visible', 'older'],
      'Select all shares the effective scope and includes in-progress plans');
    vc.read = { ...vc.read, plans: [...loaded, ...older], truncated: false };
    assert.equal(hook('tidyScan', globals)(vc, 'board'), null);
    assert.deepEqual(tidyConfirmation(derivedBoard().plans, vc.read.storeId, 'board').targets.map(p => p.request.plan), counted?.targets.map(p => p.request.plan));
  });
}
