import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BoardDerivation, applyFilters, filterOptions, normalizeFilters, NO_FILTERS, partitionBoardPlans, pickPlan, placeOf } from '../../ui/shared/scope.ts';
import { EMPTY_LIVE, findSession, indexedLive, projectFor, type LiveSnapshot, type LiveSession } from '../../ui/shared/live.ts';
import type { PlanView } from '../../ui/shared/model.ts';

const session = (id: string, projectId = 'a', directory = '/fixture/a'): LiveSession => ({ id, projectId, directory, title: id, parentId: null, archivedAt: null, worktree: null, activity: 'idle', outcome: null });
const snapshot = (): LiveSnapshot => ({
  ...EMPTY_LIVE, projectsState: 'ready', projects: [{ id: 'a', name: 'A', directory: '/fixture/a' }, { id: 'b', name: 'B', directory: '/fixture/b' }],
  sessions: new Map([['a', { state: 'ready', records: [session('owner'), session('child')] }]]),
  worktrees: new Map([['a', { state: 'ready', records: [{ directory: '/fixture/tree', name: 'Tree', branch: 'topic', status: 'ready' }] }]]),
});
const plans = [
  { key: 's/one', sourceId: 's', id: 'one', ownerSessionId: 'owner', directory: '/fixture/a', lifecycle: 'active', reportedAt: '2026-01-01' },
  { key: 's/two', sourceId: 's', id: 'two', ownerSessionId: 'absent', directory: '/fixture/tree', lifecycle: 'completed', reportedAt: '2026-01-02' },
  { key: 'other/one', sourceId: 'other', id: 'one', ownerSessionId: 'owner', directory: '/fixture/b', lifecycle: 'failed', reportedAt: '2026-01-03' },
] as PlanView[];

test('indexed lookups equal direct evaluation, including ambiguity and exact checkout membership', () => {
  for (const ambiguous of [false, true]) {
    const live = snapshot();
    live.sessions.set('b', { state: 'ready', records: [session('owner', ambiguous ? 'b' : 'a', ambiguous ? '/fixture/b' : '/fixture/a')] });
    const indexed = indexedLive(live);
    for (const id of ['owner', 'child', 'missing', '']) assert.deepEqual(findSession(id, indexed), findSession(id, live));
    for (const dir of ['/fixture/a', '/fixture/tree/sub', '/fixture/unknown', '/fixture']) assert.deepEqual(projectFor(dir, indexed), projectFor(dir, live));
    for (const bound of ['s', null, undefined]) for (const p of plans) assert.deepEqual(placeOf(p, indexed, bound), placeOf(p, live, bound));
  }
});

test('board derivation equals direct filtering, locations, choices and lifecycle partition', () => {
  const derive = new BoardDerivation(), live = snapshot();
  for (const locale of ['en', 'ru', 'zh-CN'] as const) for (const bound of ['s', null, undefined]) for (const archived of [false, true]) for (const filters of [NO_FILTERS, { project: 'p:a', worktree: 'w:/fixture/tree', session: 'all' }, { project: 'gone', worktree: 'gone', session: 'owner' }]) {
    const input = { plans, live, filters, bound, locale, archived, reading: 'example' };
    const result = derive.get(input);
    const normalized = normalizeFilters(plans, live, filters, bound);
    assert.deepEqual(result.filters, normalized);
    assert.deepEqual(result.plans, applyFilters(plans, live, normalized, bound));
    for (const key of [null, 's/two', 'missing']) assert.equal(result.select(key), pickPlan(result.plans, key));
    assert.deepEqual(result.options(), filterOptions(plans, live, normalized, plans, bound, locale));
    for (const p of plans) assert.deepEqual(result.places.get(p.key), placeOf(p, live, bound, locale));
    assert.deepEqual(result.groups.flatMap(g => [...g.current, ...g.finished]).sort((a,b) => a.key.localeCompare(b.key)), result.plans.slice().sort((a,b) => a.key.localeCompare(b.key)));
    for (const g of result.groups) assert.deepEqual({ current: g.current, finished: g.finished }, partitionBoardPlans(g.plans, archived));
    assert.equal(derive.get(input), result);
  }
});

test('all board inputs retire the previous derivation, including mutations of live map entries', () => {
  const derive = new BoardDerivation(), live = snapshot();
  let input = { plans, live, filters: NO_FILTERS, bound: 's' as string | null, locale: 'en' as 'en' | 'ru', archived: false, reading: 'first' };
  let previous = derive.get(input);
  const changed = () => { const next = derive.get(input); assert.notEqual(next, previous); previous = next; };
  live.sessions.set('a', { state: 'ready', records: [session('new-owner')] }); changed();
  live.worktrees.set('a', { state: 'ready', records: [] }); changed();
  live.projects = [...live.projects]; changed();
  input = { ...input, plans: [...plans] }; changed();
  input = { ...input, bound: null }; changed();
  input = { ...input, filters: { ...NO_FILTERS, project: 'p:b' } }; changed();
  input = { ...input, locale: 'ru' }; changed();
  input = { ...input, archived: true }; changed();
  input = { ...input, reading: 'search-run' }; changed();
});
