import test from 'node:test';
import assert from 'node:assert/strict';
import { CleanupScan, tidyConfirmation } from '../../ui/shared/cleanup.ts';
import { BoardDerivation, ALL, NO_FILTERS, pageListScope } from '../../ui/shared/scope.ts';
import { freezeLive, inPlace, scopeAvailability } from '../../ui/shared/search.ts';
import { EMPTY_LIVE } from '../../ui/shared/live.ts';
import { parsePlansPage } from '../../ui/shared/adapter.ts';
import { plansPage, summary, SRC, S } from './fixtures.ts';
import { pageHook } from './page-hooks.ts';

// Execute the production page callbacks, with the real board normalization and scan engine.
const hook = pageHook;

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
    const unsupported = await (hook('tidyScan', globals)(vc, 'selection', () => true, false) as CleanupScan).more(() => true);
    assert.deepEqual(unsupported?.targets.map(p => p.request.plan), ['older']);
    assert.equal(unsupported?.excludedActive, 1, 'unsupported active plans are counted outside the target ceiling');
    vc.read = { ...vc.read, plans: [...loaded, ...older], truncated: false };
    assert.equal(hook('tidyScan', globals)(vc, 'board'), null);
    assert.deepEqual(tidyConfirmation(derivedBoard().plans, vc.read.storeId, 'board').targets.map(p => p.request.plan), counted?.targets.map(p => p.request.plan));
  });
}

// A plan's recorded directory outside the discovered roots still belongs to its browse worktree.
function outsideRoots() {
  const owner = { id: S.M, title: '', projectId: 'proj', directory: '/fixture/Proj', parentId: null, archivedAt: null, worktree: null, activity: 'idle' as const, outcome: null };
  const live = { ...EMPTY_LIVE, projectsState: 'ready' as const, projects: [{ id: 'proj', name: 'Proj', directory: '/fixture/Proj' }],
    sessions: new Map([['proj', { state: 'ready' as const, records: [owner] }]]) };
  const plans = parsePlansPage(JSON.stringify(plansPage([
    summary('shown', [], { directory: '/elsewhere/wt' }), summary('older', [], { lifecycle: 'failed', directory: '/elsewhere/wt' }),
  ]))).data;
  const board = new BoardDerivation();
  const vc = {
    ui: { filters: { ...NO_FILTERS, worktree: 'w:/elsewhere/wt' }, archived: false, search: null as null | { criteria: unknown } }, live,
    env: { boundSource: SRC }, read: { ...parsePlansPage(JSON.stringify(plansPage([]))).envelope, plans: plans.slice(0, 1), truncated: true },
    service: () => ({ serviceRequest: async () => { throw Error('Unexpected transport'); } }),
  };
  const derivedBoard = () => board.get({ plans: vc.read.plans, live, filters: vc.ui.filters, bound: SRC, locale: 'en', archived: false, reading: 'board' });
  const globals = {
    isSearching: () => !!vc.ui.search, derivedBoard, ALL, freezeLive, inPlace, scopeAvailability, pageListScope, CleanupScan,
    cleanupSearchReader: () => async () => { throw Error('Unexpected search'); },
    readCleanupListPage: async () => ({ plans, visited: 2, nextCursor: null }),
  };
  return { vc, plans, derivedBoard, globals };
}
test('a truncated browse Tidy follows browse placement for a worktree outside the discovered roots', async () => {
  const { vc, derivedBoard, globals } = outsideRoots();
  assert.equal(derivedBoard().filters.worktree, 'w:/elsewhere/wt', 'the board itself offers this worktree');
  assert.notEqual(scopeAvailability(derivedBoard().filters, freezeLive(vc.live)), 'ok', 'the search-only check cannot classify it');
  const counted = await (hook('tidyScan', globals)(vc, 'board') as CleanupScan).more(() => true);
  assert.deepEqual(counted?.targets.map(p => p.request.plan), ['older']);
});
test('a search scan still refuses locations this window cannot classify', async () => {
  const { vc, globals } = outsideRoots();
  vc.ui.search = { criteria: { q: 'x', source: ALL, session: ALL, lifecycle: ALL, status: ALL, project: 'p:gone', worktree: ALL } };
  await assert.rejects((hook('tidyScan', globals)(vc, 'search') as CleanupScan).more(() => true), { message: 'The selected locations are unavailable.' });
});
