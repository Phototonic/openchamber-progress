import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import type { GuestRequest, GuestRequestResult, HostReadyContext } from '@openchamber/sdk';
import { countItems, type Item, type PlanSummary } from '../../shared/progress.ts';
import { parsePlanPage } from '../../ui/shared/adapter.ts';
import type { ViewContext, ViewSpec } from '../../ui/shared/app.ts';
import { EMPTY_LIVE } from '../../ui/shared/live.ts';
import {
  ALL_PARTICIPANTS, blockedWork, currentWork, jumpTargets, nextJump, participantIndex, participantMatch, participants, relationsOf, statusMatch, subtreeCounts, summarize, taskMatch, taskProjection,
  type ItemNode, type ItemView, type Lifecycle, type ParticipantFilter, type PlanDetail, type PlanView, type TaskProjection,
} from '../../ui/shared/model.ts';
import { readiness } from '../../ui/shared/readiness.ts';
import * as refresh from '../../ui/shared/refresh.ts';
import * as path from '../../ui/shared/path.ts';
import * as cleanup from '../../ui/shared/cleanup.ts';
import * as source from '../../ui/shared/source.ts';
import { HEALTH, setupRead } from './fixtures.ts';
import { CORE_CONTRIBUTIONS, CORE_ITEMS, CORE_LINKS, deepChain, focusEnvelope, focusPage, focusSummary, SA, SB, SC, SD, scaleContributions, scaleItems, SCALE_LINKS, STORE } from './focus-controls-fixtures.ts';

function detailOf(items: Item[] = CORE_ITEMS, summary: PlanSummary = focusSummary(items), contributions: unknown[] = CORE_CONTRIBUTIONS, links: unknown[] = CORE_LINKS): { plan: PlanView; detail: PlanDetail } {
  const page = parsePlanPage(JSON.stringify({ ...focusPage(summary, items, contributions, 0, links), items: { data: items, nextCursor: null }, contributions: { data: contributions, nextCursor: null } }));
  return { plan: page.plan, detail: { key: page.plan.key, revision: page.plan.revision, items: page.items.data, contributions: page.contributions.data, links: page.links } };
}
function deepFreeze<T>(v: T): T { if (v && typeof v === 'object') { Object.freeze(v); for (const x of Object.values(v)) deepFreeze(x); } return v; }
const unfinished = statusMatch('unfinished');
const states = (p: TaskProjection) => Object.fromEntries(p.rows);
const flatten = (nodes: ItemNode[]): ItemView[] => nodes.flatMap((n) => [n.item, ...flatten(n.children)]);
/** Every branch's full counts equal the shared rule over its descendants. */
function assertBranchCounts(p: TaskProjection) {
  const walk = (n: ItemNode) => {
    if (n.children.length) {
      const b = p.branches.get(n.item.id)!;
      const descendants = flatten(n.children);
      assert.deepEqual([b.done, b.total, b.remaining, b.skipped], Object.values(subtreeCounts(descendants)), n.item.id);
      const tasks = descendants.filter((i) => i.kind === 'task');
      assert.deepEqual([b.rows, b.working, b.blocked], [tasks.length, tasks.filter((i) => i.status === 'working').length, tasks.filter((i) => i.status === 'blocked').length], n.item.id);
      assert.equal(b.matching + b.context + b.hidden, b.rows, `${n.item.id}: matching, context and hidden are disjoint`);
    }
    n.children.forEach(walk);
  };
  p.tree.forEach(walk);
}
const branch = (p: TaskProjection, id: string) => { const b = p.branches.get(id)!; return { done: b.done, total: b.total, remaining: b.remaining, skipped: b.skipped, working: b.working, blocked: b.blocked, rows: b.rows, matching: b.matching, context: b.context, hidden: b.hidden }; };

// ---------------------------------------------------------------- projection logic

test('core fixture, Show all: every recorded row, full counts and full branch aggregates', () => {
  const { plan, detail } = detailOf();
  const before = JSON.stringify(detail);
  deepFreeze(detail);
  const all = taskProjection(detail.items, null);
  assert.equal(all.filtered, false);
  assert.ok([...all.rows.values()].every((s) => s === 'match'), 'Show all keeps every row, groups and skipped included');
  assert.equal(all.rows.size, 14);
  assert.deepEqual([all.totals.rows, all.totals.matching, all.totals.context, all.totals.hidden], [10, 10, 0, 0]);
  assert.deepEqual([all.totals.done, all.totals.total, all.totals.remaining, all.totals.skipped], [2, 9, 7, 1]);
  assert.deepEqual(countItems(detail.items), { done: 2, total: 9, remaining: 7, skipped: 1 });
  const s = summarize(plan, detail);
  assert.deepEqual([s.done, s.total, s.remaining, s.skipped, s.working, s.blocked], [2, 9, 7, 1, 2, 2]);
  assert.deepEqual(branch(all, 'G'), { done: 2, total: 5, remaining: 3, skipped: 1, working: 1, blocked: 1, rows: 6, matching: 6, context: 0, hidden: 0 });
  assert.deepEqual(branch(all, 'T'), { done: 0, total: 1, remaining: 1, skipped: 0, working: 0, blocked: 0, rows: 1, matching: 1, context: 0, hidden: 0 });
  assert.deepEqual(branch(all, 'Z'), { done: 0, total: 4, remaining: 4, skipped: 0, working: 1, blocked: 1, rows: 4, matching: 4, context: 0, hidden: 0 });
  assert.equal(all.branches.has('E'), false, 'an empty group has no descendants to summarize');
  assertBranchCounts(all);
  assert.equal(JSON.stringify(detail), before);
});

test('core fixture, Unfinished: 7 matches, T as the one context task, D/S hidden; E hides; full aggregates unchanged', () => {
  const { plan, detail } = detailOf();
  deepFreeze(detail);
  const all = taskProjection(detail.items, null);
  const un = taskProjection(detail.items, unfinished);
  assert.deepEqual(states(un), {
    G: 'context', H: 'context', D: 'hidden', S: 'hidden', W: 'match', B1: 'match', T: 'context', U: 'match',
    E: 'hidden', Z: 'context', L: 'match', R: 'match', X: 'match', N: 'match',
  });
  // N task rows = matching + context + filter-hidden, as disjoint sets; a row count, not the denominator.
  assert.deepEqual([un.totals.rows, un.totals.matching, un.totals.context, un.totals.hidden, un.totals.hiddenWorking, un.totals.hiddenBlocked], [10, 7, 1, 2, 0, 0]);
  assert.deepEqual([un.totals.done, un.totals.total, un.totals.remaining, un.totals.skipped], [2, 9, 7, 1]);
  assert.deepEqual(branch(un, 'G'), { done: 2, total: 5, remaining: 3, skipped: 1, working: 1, blocked: 1, rows: 6, matching: 3, context: 1, hidden: 2 });
  assert.deepEqual(branch(un, 'H'), { done: 1, total: 3, remaining: 2, skipped: 1, working: 1, blocked: 1, rows: 4, matching: 2, context: 0, hidden: 2 });
  assert.deepEqual([branch(un, 'T').matching, branch(un, 'T').hidden], [1, 0]);
  for (const id of ['G', 'H', 'T', 'Z']) {
    const [a, u] = [all.branches.get(id)!, un.branches.get(id)!];
    assert.deepEqual([u.done, u.total, u.remaining, u.skipped, u.working, u.blocked, u.rows], [a.done, a.total, a.remaining, a.skipped, a.working, a.blocked, a.rows], `${id} aggregates ignore the filter`);
  }
  assertBranchCounts(un);
  const s = summarize(plan, detail);
  assert.deepEqual([s.done, s.total, s.remaining, s.skipped], [2, 9, 7, 1], 'plan totals never follow the filter');
  assert.deepEqual(jumpTargets(un, 'working').map((i) => i.id), ['W', 'X']);
  assert.deepEqual(jumpTargets(un, 'blocked').map((i) => i.id), ['B1', 'R']);
});

test('statusMatch: Show all filters nothing; Unfinished is pending/working/blocked only', () => {
  assert.equal(statusMatch('all'), null);
  const item = (status: ItemView['status']): ItemView => ({ id: 'x', title: 'x', kind: 'task', status });
  assert.deepEqual((['pending', 'working', 'blocked', 'done', 'skipped'] as const).map((s) => unfinished!(item(s))), [true, true, true, false, false]);
  // Dependencies never decide membership: a pending task waiting on prerequisites still matches.
  assert.equal(unfinished!({ ...item('pending'), dependencies: ['gone'] }), true);
});

test('variants: all done, all skipped, empty, group-only, orphan roots and a task-parent with an unmatched assignee', () => {
  const tasksAs = (status: ItemView['status']) => CORE_ITEMS.map((i) => (i.kind === 'task' ? { ...i, status } : i));
  for (const status of ['done', 'skipped'] as const) {
    const p = taskProjection(detailOf(tasksAs(status)).detail.items, unfinished);
    assert.deepEqual([p.totals.matching, p.totals.context, p.totals.hidden], [0, 0, 10], status);
    assert.ok([...p.rows.values()].every((s) => s === 'hidden'), `${status}: nothing matches, every branch hides`);
    assert.equal(taskProjection(detailOf(tasksAs(status)).detail.items, null).totals.rows, 10, `${status}: Show all restores every row`);
  }
  const empty = taskProjection([], unfinished);
  assert.deepEqual([empty.tree.length, empty.totals.rows, empty.totals.total], [0, 0, 0]);
  const groups: Item[] = [{ id: 'G', title: 'Only a group', kind: 'group', status: 'working' }, { id: 'G2', title: 'Nested group', kind: 'group', status: 'blocked', parentId: 'G' }];
  const shown = taskProjection(detailOf(groups).detail.items, null);
  assert.deepEqual([shown.totals.rows, shown.rows.get('G'), shown.rows.get('G2')], [0, 'match', 'match'], 'group-only branches stay inspectable in Show all');
  const filtered = taskProjection(detailOf(groups).detail.items, unfinished);
  assert.deepEqual([filtered.rows.get('G'), filtered.rows.get('G2'), filtered.branches.get('G')!.working], ['hidden', 'hidden', 0], 'a group status never counts or matches');
  // An unknown parent stays a root (itemTree); no ancestor is invented.
  const orphan = taskProjection(detailOf([...CORE_ITEMS, { id: 'O', title: 'Orphan', kind: 'task', status: 'blocked', parentId: 'missing' }]).detail.items, unfinished);
  assert.deepEqual([orphan.tree.at(-1)!.item.id, orphan.rows.get('O'), orphan.rows.has('missing')], ['O', 'match', false]);
  // A done task-parent with an assignee is context only, never a match, and keeps only its matching child.
  const assigned = taskProjection(detailOf(CORE_ITEMS.map((i) => (i.id === 'T' ? { ...i, assigneeSessionId: SB } : i))).detail.items, unfinished);
  assert.deepEqual([assigned.rows.get('T'), assigned.rows.get('U')], ['context', 'match']);
});

test('closed lifecycles keep identical predicates; readiness and its inputs are untouched by filtering', () => {
  const { plan, detail } = detailOf();
  deepFreeze(detail);
  const before = readiness(plan, { state: 'ready', value: detail });
  const active = states(taskProjection(detail.items, unfinished));
  for (const lifecycle of ['completed', 'cancelled', 'failed'] as Lifecycle[]) {
    // Cancelled/failed plans can still hold unfinished records: they stay inspectable.
    assert.deepEqual(states(taskProjection(detail.items, unfinished)), active, lifecycle);
    assert.deepEqual(readiness({ ...plan, lifecycle }, { state: 'ready', value: detail }), { state: 'closed' });
  }
  taskProjection(detail.items, unfinished);
  assert.deepEqual(readiness(plan, { state: 'ready', value: detail }), before);
});

test('jumps follow canonical hierarchy order, wrap, and restart when the last target is gone', () => {
  // Recorded order X, W; hierarchy order W (under G, recorded first) then X (under Z).
  const items: Item[] = [
    { id: 'G', title: 'G', kind: 'group', status: 'pending' }, { id: 'Z', title: 'Z', kind: 'group', status: 'pending' },
    { id: 'X', title: 'X', kind: 'task', status: 'working', parentId: 'Z' }, { id: 'W', title: 'W', kind: 'task', status: 'working', parentId: 'G' },
  ];
  const targets = jumpTargets(taskProjection(items, null), 'working');
  assert.deepEqual(targets.map((i) => i.id), ['W', 'X']);
  assert.deepEqual([nextJump(targets, null)?.item.id, nextJump(targets, 'W')?.item.id, nextJump(targets, 'X')?.item.id], ['W', 'X', 'W']);
  assert.deepEqual(nextJump(targets, 'removed')?.index, 0, 'a removed last jump starts again at the first target');
  assert.equal(nextJump([], null), null);
  // Beyond the Now callout's cap of four.
  const many = Array.from({ length: 6 }, (_, n): Item => ({ id: `K${n}`, title: `K${n}`, kind: 'task', status: 'working' }));
  let last: string | null = null; const seen: string[] = [];
  for (let n = 0; n < 7; n++) { last = nextJump(jumpTargets(taskProjection(many, null), 'working'), last)!.item.id; seen.push(last); }
  assert.deepEqual(seen, ['K0', 'K1', 'K2', 'K3', 'K4', 'K5', 'K0']);
});

test('1,000 items (10 groups + 990 tasks): full counts, disjoint row sets and bounded time', () => {
  const { plan, detail } = detailOf(scaleItems(), focusSummary(scaleItems(), { id: 'P-scale' }), scaleContributions(), SCALE_LINKS);
  deepFreeze(detail);
  assert.equal(detail.items.length, 1000);
  const s = summarize(plan, detail);
  assert.deepEqual([s.done, s.total, s.remaining, s.skipped], [198, 792, 594, 198]);
  const started = performance.now();
  const all = taskProjection(detail.items, null);
  const un = taskProjection(detail.items, unfinished);
  const elapsed = performance.now() - started;
  assert.deepEqual([all.totals.rows, all.totals.matching, all.totals.done, all.totals.total, all.totals.remaining, all.totals.skipped], [990, 990, 198, 792, 594, 198]);
  // Context tasks: done/skipped task-parents whose child is unfinished.
  const parents = new Set(detail.items.filter((i) => i.parentId?.startsWith('ST')).map((i) => i.parentId));
  const context = detail.items.filter((i) => parents.has(i.id) && ['done', 'skipped'].includes(i.status) && detail.items.some((c) => c.parentId === i.id && unfinished!(c))).length;
  assert.deepEqual([un.totals.matching, un.totals.context, un.totals.hidden], [594, context, 990 - 594 - context]);
  assert.deepEqual([jumpTargets(un, 'working').length, jumpTargets(un, 'blocked').length], [198, 198]);
  assertBranchCounts(un);
  assert.ok(elapsed < 2000, `two projections took ${Math.round(elapsed)} ms`);
});

test('deep chain within the 1,000-item bound: every ancestor is context, traversal terminates', () => {
  const items = deepChain();
  const un = taskProjection(items, unfinished);
  assert.deepEqual([un.totals.rows, un.totals.matching, un.totals.context, un.totals.hidden], [999, 1, 998, 0]);
  assert.equal(un.rows.get('C0'), 'context');
  assert.equal(un.rows.get('C999'), 'match');
  assert.equal(un.branches.get('C0')!.working, 1);
  assert.equal(un.order.length, 1000);
});

// ---------------------------------------------------------------- participant membership and attribution

const person = (sessionId: string): ParticipantFilter => ({ kind: 'session', sessionId });
const NONE: ParticipantFilter = { kind: 'none' };
/** Matching task IDs of a filter combination, in canonical order. */
function matches(detail: PlanDetail, plan: Pick<PlanView, 'ownerSessionId'>, participant: ParticipantFilter, status: 'all' | 'unfinished' = 'all') {
  const p = taskProjection(detail.items, taskMatch({ status, participant }, participantIndex(plan, detail)));
  return p.order.filter((i) => i.kind === 'task' && p.rows.get(i.id) === 'match').map((i) => i.id);
}

test('core participants: B/C/A/D/No participant recorded follow recorded task relationships only, alone and with Unfinished', () => {
  const { plan, detail } = detailOf();
  const before = JSON.stringify(detail);
  deepFreeze(detail);
  assert.deepEqual(matches(detail, plan, person(SB)), ['D', 'W', 'L', 'R']);
  assert.deepEqual(matches(detail, plan, person(SB), 'unfinished'), ['W', 'L', 'R']);
  assert.deepEqual(matches(detail, plan, person(SC)), ['B1', 'R']);
  // The owner relays for C on R; owning the plan matches none of its other tasks.
  assert.deepEqual(matches(detail, plan, person(SA)), ['R']);
  assert.deepEqual(matches(detail, plan, person(SD)), ['X']);
  assert.deepEqual(matches(detail, plan, NONE), ['S', 'T', 'U', 'N']);
  assert.deepEqual(matches(detail, plan, NONE, 'unfinished'), ['U', 'N']);
  const un = taskProjection(detail.items, taskMatch({ status: 'unfinished', participant: NONE }, participantIndex(plan, detail)));
  assert.deepEqual([un.rows.get('T'), un.rows.get('G'), un.rows.get('Z'), un.rows.get('H'), un.rows.get('E')], ['context', 'context', 'context', 'hidden', 'hidden'], 'ancestors stay as context; nonmatching branches hide');
  assert.deepEqual([un.totals.done, un.totals.total, un.totals.remaining, un.totals.skipped], [2, 9, 7, 1], 'branch totals ignore the filter');
  assert.deepEqual(Object.values(summarize(plan, detail)).slice(0, 4), [2, 9, 7, 1], 'plan totals never follow the participant');
  assert.equal(JSON.stringify(detail), before);
});

test('relationship reasons stay distinct: assignment, link context, direct report, relay child vs relay reporter, reporter with unknown mode', () => {
  const { plan, detail } = detailOf();
  const index = participantIndex(plan, detail);
  const why = (sid: string, id: string) => relationsOf(index, id, person(sid));
  assert.deepEqual([why(SB, 'D'), why(SB, 'W'), why(SB, 'L'), why(SB, 'R')], [['assigned'], ['assigned'], ['linked'], ['direct']]);
  assert.deepEqual([why(SC, 'B1'), why(SC, 'R')], [['assigned'], ['relayed-for']]);
  assert.deepEqual(why(SA, 'R'), ['relayed-by'], 'the relaying reporter is not the attributed child, and neither is an assignee');
  assert.deepEqual(why(SD, 'X'), ['reporter'], 'an item reporter without a contribution keeps its report mode unknown');
  assert.deepEqual(relationsOf(index, 'R', NONE), []);
  // Each task counts once per session, however many relationships or repeated relay records.
  assert.deepEqual(Object.fromEntries(index.taskCount), { B: 4, C: 2, A: 1, D: 1 });
  assert.equal(index.unknownCount, 4);
  // Options include the reporter-only session that the Sessions summary does not list.
  assert.deepEqual(index.sessions, [SA, SB, SC, SD]);
  assert.equal(participants(plan, detail).some((p) => p.sessionId === SD), false);
  // Proven contribution modes replace the unknown-mode label instead of duplicating it.
  const proven = participantIndex(plan, { ...detail, contributions: [...detail.contributions, { revision: 4, reporterSessionId: SD, attributedSessionId: SD, mode: 'direct', itemIds: ['X'] }] });
  assert.deepEqual(relationsOf(proven, 'X', person(SD)), ['direct']);
  const other = participantIndex(plan, { ...detail, contributions: [{ revision: 4, reporterSessionId: 'E', attributedSessionId: 'E', mode: 'direct', itemIds: ['X'] }] });
  assert.deepEqual([relationsOf(other, 'X', person(SD)), relationsOf(other, 'X', person('E'))], [['reporter'], ['direct']], 'another session’s report proves nothing about D’s mode');
  // A direct report whose attributed identity differs keeps both, without assuming they are equal.
  const split = participantIndex(plan, { ...detail, contributions: [{ revision: 4, reporterSessionId: SB, attributedSessionId: SD, mode: 'direct', itemIds: ['N'] }] });
  assert.deepEqual([relationsOf(split, 'N', person(SB)), relationsOf(split, 'N', person(SD))], [['direct'], ['direct-attributed']]);
});

test('participant variants: removed links/reports, group-only link, owner-only, removed IDs, vanished selection and foreign identities', () => {
  const { plan, detail } = detailOf();
  // Removing the link drops B's linked match only.
  assert.deepEqual(matches({ ...detail, links: [] }, plan, person(SB)), ['D', 'W', 'R']);
  assert.deepEqual(matches({ ...detail, links: [] }, plan, NONE), ['S', 'T', 'U', 'L', 'N']);
  // Removing every report: R becomes unknown; owner A stays selectable with no match.
  const noReports = { ...detail, contributions: [] };
  assert.deepEqual([matches(noReports, plan, person(SA)), matches(noReports, plan, NONE)], [[], ['S', 'T', 'U', 'R', 'N']]);
  assert.ok(participantIndex(plan, noReports).sessions.includes(SA));
  // A link naming only a group: no descendant task belongs to that session, the group never matches.
  const groupLink = { ...detail, links: [{ sessionId: 'E', itemIds: ['G', 'H'] }] };
  const gi = participantIndex(plan, groupLink);
  assert.deepEqual([gi.sessions.includes('E'), gi.taskCount.get('E') ?? 0, matches(groupLink, plan, person('E'))], [true, 0, []]);
  assert.equal(taskProjection(groupLink.items, participantMatch(person('E'), gi)).rows.get('G'), 'hidden');
  // A group's own assignee/reporter facts are not inherited by its tasks.
  const groupFacts = { ...detail, items: detail.items.map((i) => (i.id === 'Z' ? { ...i, assigneeSessionId: 'E', reporterSessionId: 'E' } : i)) };
  assert.deepEqual(matches(groupFacts, plan, person('E')), []);
  // Contributions and links naming removed items create no rows and no matches; their sessions stay choosable.
  const removed = { ...detail, contributions: [...detail.contributions, { revision: 9, reporterSessionId: 'F', attributedSessionId: 'F', mode: 'direct' as const, itemIds: ['GONE'] }], links: [...detail.links, { sessionId: 'F', itemIds: ['GONE'] }] };
  const ri = participantIndex(plan, removed);
  const rp = taskProjection(removed.items, participantMatch(person('F'), ri));
  assert.deepEqual([ri.sessions.includes('F'), ri.taskCount.get('F') ?? 0, rp.rows.size, rp.rows.has('GONE'), rp.totals.matching], [true, 0, 14, false, 0]);
  // A chosen session the plan no longer records matches nothing (never silently every task).
  const vanished = taskProjection(detail.items, taskMatch({ status: 'all', participant: person('gone-session') }, participantIndex(plan, detail)));
  assert.deepEqual([vanished.filtered, vanished.totals.matching, vanished.totals.hidden], [true, 0, 10]);
  // Same session IDs in another plan of another source: membership is per detail, never merged.
  const foreign = detailOf(CORE_ITEMS.map((i) => ({ ...i, assigneeSessionId: undefined })), focusSummary(CORE_ITEMS, { sourceId: 'source-focus-other' }), [], []);
  assert.deepEqual(matches(foreign.detail, foreign.plan, person(SB)), []);
  assert.deepEqual(matches(detail, plan, person(SB)), ['D', 'W', 'L', 'R'], 'the first plan is unaffected');
  // Neither filter: null match (Show all + All participants).
  assert.equal(taskMatch({ status: 'all', participant: ALL_PARTICIPANTS }, participantIndex(plan, detail)), null);
});

test('participant filters leave readiness, Now and every input unchanged; 1,000 items stay bounded', () => {
  const { plan, detail } = detailOf();
  deepFreeze(detail);
  const ready = JSON.stringify(readiness(plan, { state: 'ready', value: detail }));
  const now = [currentWork(detail).map((i) => i.id), blockedWork(detail).map((i) => i.id)];
  for (const participant of [person(SA), person(SB), person(SC), person(SD), NONE, person('gone')]) for (const status of ['all', 'unfinished'] as const) taskProjection(detail.items, taskMatch({ status, participant }, participantIndex(plan, detail)));
  assert.equal(JSON.stringify(readiness(plan, { state: 'ready', value: detail })), ready);
  assert.deepEqual([currentWork(detail).map((i) => i.id), blockedWork(detail).map((i) => i.id)], now);
  const scale = detailOf(scaleItems(), focusSummary(scaleItems(), { id: 'P-scale' }), scaleContributions(), SCALE_LINKS);
  deepFreeze(scale.detail);
  const started = performance.now();
  const index = participantIndex(scale.plan, scale.detail);
  const b = taskProjection(scale.detail.items, taskMatch({ status: 'unfinished', participant: person(SB) }, index));
  const none = taskProjection(scale.detail.items, taskMatch({ status: 'all', participant: NONE }, index));
  const elapsed = performance.now() - started;
  // Expected membership straight from the recorded facts (one match per task).
  const tasks = scale.detail.items.filter((i) => i.kind === 'task');
  const related = (i: ItemView) => i.assigneeSessionId === SB || scale.detail.links.some((l) => l.sessionId === SB && l.itemIds.includes(i.id)) || scale.detail.contributions.some((c) => c.itemIds.includes(i.id) && (c.reporterSessionId === SB || c.attributedSessionId === SB));
  assert.equal(b.totals.matching, tasks.filter((i) => related(i) && unfinished!(i)).length);
  const anyFact = (i: ItemView) => !!i.assigneeSessionId || !!i.reporterSessionId || scale.detail.links.some((l) => l.itemIds.includes(i.id)) || scale.detail.contributions.some((c) => c.itemIds.includes(i.id));
  assert.equal(none.totals.matching, tasks.filter((i) => !anyFact(i)).length);
  assert.deepEqual([b.totals.rows, b.totals.done, b.totals.total], [990, 198, 792]);
  assert.ok(elapsed < 2000, `index and two projections took ${Math.round(elapsed)} ms`);
});

// ---------------------------------------------------------------- reading lifecycle in the actual controller

type Route = (q: GuestRequest) => Promise<GuestRequestResult> | GuestRequestResult;
const reply = (body: unknown, status = 200): GuestRequestResult => ({ status, body: JSON.stringify(body) });
const page = (q: GuestRequest) => Number(q.query?.cursor ?? 0);
function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; }
async function settle() { for (let i = 0; i < 8; i++) await new Promise<void>((r) => setImmediate(r)); }

type Ui = { selected: string | null };
function controller(options: { surface?: 'panel' | 'status' } = {}) {
  const listeners: Record<string, (value?: any) => void> = {};
  const requests: GuestRequest[] = [];
  const timers: number[] = [];
  /** Planned timer callbacks (fake clock): `poll()` fires the latest planned list poll. */
  const planned: { fn: () => void; ms: number }[] = [];
  let readStarts = 0;
  let liveChanged: (() => void) | null = null;
  let liveInstance: { snapshot: unknown } | null = null;
  const node = () => ({ dataset: {} as Record<string, string>, firstElementChild: null as any, querySelector: () => null, querySelectorAll: () => [], getAnimations: () => [], setAttribute() {}, append() {}, replaceChildren(child: any) { this.firstElementChild = child; } });
  const mount = node();
  const document = { documentElement: node(), head: node(), visibilityState: 'visible', activeElement: null, getElementById: (id: string) => (id === 'root' ? mount : {}), addEventListener: (name: string, fn: any) => { listeners[`doc:${name}`] = fn; }, scrollingElement: { scrollTop: 0 } };
  let store = STORE;
  // `listRevision`: what the list announces when it lags the service's detail (default: the same).
  const state = { items: CORE_ITEMS, contributions: CORE_CONTRIBUTIONS as unknown[], revision: 5, listRevision: null as number | null, listFails: false, listHold: null as null | ReturnType<typeof deferred<void>> };
  const summary = (revision = state.revision) => focusSummary(state.items, { revision });
  let inFlight = 0; let maxInFlight = 0;
  let route: Route = (q) => reply(focusPage(summary(), state.items, state.contributions, page(q), CORE_LINKS, focusEnvelope({ storeId: store })));
  const svc = async (q: GuestRequest): Promise<GuestRequestResult> => {
    if (q.path === '/health') return reply({ ...HEALTH, planCleanup: 1 });
    if (q.path === '/v1/setup') return reply(setupRead());
    if (q.path === '/v1/plans') {
      inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
      try {
        if (state.listHold) await state.listHold.promise;
        if (state.listFails) return reply({ error: 'busy' }, 503);
        return reply({ ...focusEnvelope({ storeId: store }), data: [SA, SB].includes(q.query?.session as string) ? [summary(state.listRevision ?? state.revision)] : [], nextCursor: null });
      } finally { inFlight--; }
    }
    return route(q);
  };
  const h = { serviceRequest: async (q: GuestRequest) => { requests.push(q); return svc(q); }, storage: { get: async () => undefined, set: async () => {}, delete: async () => {} }, onReady: (fn: any) => { listeners.ready = fn; }, onSession: (fn: any) => { listeners.session = fn; }, onDirectory: (fn: any) => { listeners.directory = fn; } };
  const exports: any = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL('../../ui/shared/app.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports, document, window: { addEventListener: (name: string, fn: any) => { listeners[name] = fn; } }, queueMicrotask, performance, console, setTimeout: (fn: () => void, ms: number) => { timers.push(ms); planned.push({ fn, ms }); return timers.length; }, clearTimeout() {},
    require: (name: string) => {
      if (name === '@openchamber/sdk') return { connectHost: () => h };
      if (name === '@openchamber/sdk/ui') return { applyHostReady() {} };
      // Controller detail-read starts are counted apart from the pages (and internal restarts) they request.
      if (name === './source.ts') return { ...source, readDetail: (...args: Parameters<typeof source.readDetail>) => { readStarts++; return source.readDetail(...args); } };
      if (name === './cleanup.ts') return cleanup;
      if (name === './refresh.ts') return refresh;
      if (name === './path.ts') return path;
      if (name === './components.ts') return { el: node, refreshLabels() {} };
      if (name === './live.ts') return { LiveWorkspace: class { snapshot: unknown = EMPTY_LIVE; sessionSubscriptionCount = 0; constructor(_h: unknown, _n: number, changed: () => void) { liveChanged = changed; liveInstance = this; } start() {} restart() {} want() {} dispose() {} } };
      if (name === './official.ts') return { OfficialMainState: class { check = async () => ({ next: null, apply: () => false }); } };
      return {};
    },
  });
  let vc!: ViewContext<Ui>;
  let paints = 0;
  const spec: ViewSpec<Ui> = {
    surface: options.surface ?? 'panel', maxSessionSubscriptions: 2, initialUi: () => ({ selected: null }),
    scope: ({ session }) => (session ? { session: session.id } : null),
    wantProjects: () => [], wantDetails: (c) => c.read?.plans.slice(0, 1) ?? [],
    reading: (c) => { const p = c.read?.plans[0]; return p && c.session ? { plan: p.key, scope: `rail:${c.session.id}` } : null; },
    paint: (_root, value) => { vc = value; paints++; observed.push(shownDetail(value)); },
  };
  /** What every paint could show: a ready detail only for the plan's own revision (the surfaces' rule). */
  const observed: { listed: number | null; cached: number | null; state: string | null; readiness: string | null }[] = [];
  const shownDetail = (value: ViewContext<Ui>) => { const pl = value.read?.plans[0]; const d = pl ? value.detail(pl) : null; return { listed: pl?.revision ?? null, cached: d?.state === 'ready' ? d.value.revision : null, state: d?.state ?? null, readiness: pl ? readiness(pl, d).state : null }; };
  exports.startView(spec);
  return {
    requests, timers, state, observed, get vc() { return vc; }, get paints() { return paints; }, get maxInFlight() { return maxInFlight; }, get readStarts() { return readStarts; },
    /** Fires the latest planned list poll, as the fake clock reaching it. */
    poll: () => { const t = [...planned].reverse().find((x) => x.ms === 3000 || x.ms === 8000); t?.fn(); },
    /** A live-workspace change (new snapshot): repaints without new data. */
    liveRepaint: (n: number) => { liveInstance!.snapshot = { ...EMPTY_LIVE, capped: n }; liveChanged!(); },
    session: (id: string, title: string) => listeners.session({ id, title }),
    setStore: (s: string) => { store = s; }, setRoute: (r: Route) => { route = r; }, get route() { return route; },
    ready: (id: string | null, account = 'fixture', directory = '/fixture/focus') => listeners.ready({ session: id ? { id } : null, directory, connection: { account }, locale: 'en', surface: options.surface ?? 'panel' } as HostReadyContext),
    directory: (dir: string) => listeners.directory(dir),
    hide: () => { document.visibilityState = 'hidden'; listeners['doc:visibilitychange'](); },
    show: () => { document.visibilityState = 'visible'; listeners['doc:visibilitychange'](); },
    retry: () => vc.retry(), stop: () => listeners.pagehide(),
  };
}
const status = (vc: ViewContext<Ui>) => vc.reading?.status ?? null;

test('reading identity: filters survive repaint, polls and a directory move; session, store and account changes reset them', async () => {
  const c = controller();
  c.ready(SA); await settle();
  assert.equal(status(c.vc), 'all');
  const reads = c.requests.length;
  const painted = c.paints;
  c.vc.reading!.set({ status: 'unfinished' }); await settle();
  assert.equal(status(c.vc), 'unfinished');
  assert.ok(c.paints > painted, 'a filter change repaints');
  assert.equal(c.requests.length, reads, 'a filter change sends nothing and never moves the list scope');
  c.retry(); await settle();
  assert.equal(status(c.vc), 'unfinished', 'a poll keeps the reading');
  c.directory('/fixture/focus/moved'); await settle();
  assert.equal(status(c.vc), 'unfinished', 'same-session directory metadata keeps the reading');
  // A → B (same plan) → A: each visit starts at Show all; an old handle is inert.
  const old = c.vc.reading!;
  c.ready(SB); await settle();
  assert.equal(c.vc.read?.plans[0].id, 'P-focus');
  assert.equal(status(c.vc), 'all');
  old.set({ status: 'unfinished' }); old.remember({ cursor: { working: 'W', blocked: null } }); await settle();
  assert.equal(old.current(), null);
  assert.equal(status(c.vc), 'all', 'a retired reading callback changes nothing');
  c.ready(SA); await settle();
  assert.equal(status(c.vc), 'all', 'returning to A does not restore its old reading');
  // Null session: no reading authority at all.
  c.ready(null); await settle();
  assert.equal(c.vc.reading, null);
  // Equal plan/item IDs under another store or account are a new reading.
  c.ready(SA); await settle();
  c.vc.reading!.set({ status: 'unfinished' }); c.vc.reading!.remember({ cursor: { working: 'X', blocked: null } }); await settle();
  assert.deepEqual({ ...c.vc.reading!.current()!.cursor }, { working: 'X', blocked: null });
  c.setStore('store-replaced'); c.retry(); await settle();
  assert.equal(status(c.vc), 'all', 'store replacement resets the reading');
  c.vc.reading!.set({ status: 'unfinished' }); await settle();
  c.ready(SA, 'other-account'); await settle();
  assert.equal(status(c.vc), 'all', 'an account change resets the reading');
  c.stop();
  assert.equal(c.vc.reading!.current(), null, 'disposal retires the reading');
});

test('participant choice: never preselected from the host session, kept across polls and structure changes, reset with the reading identity', async () => {
  const c = controller();
  c.ready(SB); await settle();
  assert.deepEqual({ ...c.vc.reading!.participant }, { kind: 'all' }, 'the selected host session does not choose the task participant');
  const reads = c.requests.length;
  c.vc.reading!.set({ participant: { kind: 'session', sessionId: SD } }); await settle();
  assert.equal(c.requests.length, reads, 'choosing a participant sends nothing and never changes the list scope');
  // D's only fact disappears in a new revision: still chosen, now matching nothing.
  c.state.items = CORE_ITEMS.map((i) => (i.id === 'X' ? { ...i, reporterSessionId: undefined } : i));
  c.state.revision = 6; c.retry(); await settle();
  assert.deepEqual({ ...c.vc.reading!.participant }, { kind: 'session', sessionId: SD });
  const plan = c.vc.read!.plans[0];
  const d = c.vc.detail(plan);
  assert.equal(d?.state === 'ready' && d.value.revision, 6);
  const index = participantIndex(plan, d!.state === 'ready' ? d!.value : { items: [], links: [], contributions: [] });
  assert.deepEqual([index.sessions.includes(SD), taskProjection(CORE_ITEMS, taskMatch(c.vc.reading!, index)).totals.matching], [false, 0]);
  c.ready(SA); await settle();
  assert.deepEqual({ ...c.vc.reading!.participant }, { kind: 'all' }, 'another session starts at All participants');
  c.ready(SB); await settle();
  assert.deepEqual({ ...c.vc.reading!.participant }, { kind: 'all' }, 'returning does not restore the old choice');
  c.stop();
});

test('a held same-plan revision keeps the reading and never exposes a partial prefix; retired reads continue nothing', async () => {
  const c = controller();
  c.state.items = Array.from({ length: 21 }, (_, n): Item => ({ id: `T${n}`, title: `Task ${n}`, kind: 'task', status: n % 2 ? 'done' : 'pending' }));
  c.state.contributions = Array.from({ length: 45 }, (_, n) => ({ ...CORE_CONTRIBUTIONS[0], revision: n + 1, itemIds: [`T${n % 21}`] }));
  c.ready(SA); await settle();
  const plan = () => c.vc.read!.plans[0];
  const ready = c.vc.detail(plan());
  assert.equal(ready?.state, 'ready');
  const projection = taskProjection(ready!.state === 'ready' ? ready!.value.items : [], unfinished);
  assert.deepEqual([projection.totals.rows, projection.totals.matching], [21, 11], 'contribution pages never become task rows');
  c.vc.reading!.set({ status: 'unfinished' }); await settle();
  // New revision whose second page is held: loading, never a ready prefix; the reading stays.
  const held = deferred<GuestRequestResult>();
  const normal = c.route;
  c.setRoute((q) => (q.path === '/v1/plan' && page(q) === 1 ? held.promise : normal(q)));
  c.state.revision = 6; c.retry(); await settle();
  assert.equal(c.vc.detail(plan())?.state, 'loading');
  assert.equal(status(c.vc), 'unfinished');
  held.resolve(await normal({ path: '/v1/plan', method: 'GET', query: { cursor: '1' } } as GuestRequest)); await settle();
  assert.equal(c.vc.detail(plan())?.state, 'ready');
  assert.equal(status(c.vc), 'unfinished', 'complete detail reconciles under the same reading');
  // A held continuation retired by A → B → null issues no further page and restores nothing.
  const held2 = deferred<GuestRequestResult>();
  c.setRoute((q) => (q.path === '/v1/plan' && page(q) === 1 ? held2.promise : normal(q)));
  c.state.revision = 7; c.retry(); await settle();
  c.ready(SB); await settle(); c.ready(null); await settle();
  const mark = c.requests.length;
  held2.resolve(await normal({ path: '/v1/plan', method: 'GET', query: { cursor: '1' } } as GuestRequest)); await settle();
  assert.equal(c.requests.slice(mark).some((q) => q.path === '/v1/plan'), false);
  assert.equal(c.vc.reading, null);
  c.stop();
});

test('cadence and budgets hold: 3 s / 8 s polling, at most two list reads in flight, bounded detail retry, hidden pause', async () => {
  const c = controller();
  c.state.items = Array.from({ length: 21 }, (_, n): Item => ({ id: `T${n}`, title: `Task ${n}`, kind: 'task', status: 'pending' }));
  c.ready(SA); await settle();
  assert.equal(c.timers.at(-1), 3000);
  c.vc.reading!.set({ status: 'unfinished' }); await settle();
  assert.equal(c.timers.at(-1), 3000, 'a filter change schedules nothing new');
  // Rapid switches with held list replies: latest wins, bounded overlap.
  c.state.listHold = deferred<void>();
  c.ready(SB); c.ready(SA); c.ready(SB); c.ready(SA); await settle();
  const hold = c.state.listHold; c.state.listHold = null; hold.resolve(); await settle();
  assert.ok(c.maxInFlight <= 2, `list reads in flight: ${c.maxInFlight}`);
  c.state.listFails = true; c.retry(); await settle();
  assert.equal(c.timers.at(-1), 8000);
  c.state.listFails = false; c.retry(); await settle();
  // A failed continuation is retried once per successful list refresh, never per paint.
  const normal = c.route;
  c.setRoute((q) => (q.path === '/v1/plan' && page(q) ? reply({ error: 'busy' }, 503) : normal(q)));
  c.state.revision = 9; c.retry(); await settle();
  const details = () => c.requests.filter((q) => q.path === '/v1/plan').length;
  const failed = details();
  c.vc.reading!.set({ status: 'all' }); await settle(); c.vc.reading!.set({ status: 'unfinished' }); await settle();
  assert.equal(details(), failed, 'repaints from reading changes never retry the failed detail');
  assert.equal(c.vc.detail(c.vc.read!.plans[0])?.state, 'error');
  c.retry(); await settle();
  assert.equal(details(), failed + 2, 'the next list refresh retries the detail exactly once');
  // Hidden: no timer is planned; visible again re-reads at once.
  const timers = c.timers.length;
  c.hide();
  assert.equal(c.timers.length, timers);
  const reads = c.requests.length;
  c.show(); await settle();
  assert.ok(c.requests.length > reads);
  c.stop();
  const stopped = c.requests.length;
  c.retry(); await settle();
  assert.equal(c.requests.length, stopped, 'a disposed frame reads nothing');
});

// ---------------------------------------------------------------- detail re-reads when a revision changes during a load
// A revision change during a detail read can return a newer revision than the list announces.
// Detail-read starts (controller) are counted apart from the pages and internal restarts they request.

const RACE_ITEMS: Item[] = Array.from({ length: 21 }, (_, n): Item => ({ id: `T${n}`, title: `Task ${n}`, kind: 'task', status: n % 3 ? 'pending' : 'working' }));
type Harness = ReturnType<typeof controller>;
/** Holds page 2 of the next detail read; `release()` answers it as the service is at that moment. */
function holdSecondPage(c: Harness) {
  const normal = c.route;
  const held = deferred<GuestRequestResult>();
  let waiting = false;
  c.setRoute((q) => { if (q.path === '/v1/plan' && page(q) === 1 && !waiting) { waiting = true; return held.promise; } return normal(q); });
  return {
    get waiting() { return waiting; },
    release: async () => { held.resolve(await normal({ path: '/v1/plan', method: 'GET', query: { cursor: '1' } } as GuestRequest)); },
    fail: () => held.resolve(reply({ error: 'busy' }, 503)),
  };
}
/** 20 repaints without new data: reading changes, live-workspace snapshots and same-session metadata. */
async function repaints(c: Harness, n = 20) {
  const before = c.paints;
  for (let i = 0; i < n; i++) {
    if (i % 3 === 0) c.vc.reading?.set({ status: i % 2 ? 'unfinished' : 'all' });
    else if (i % 3 === 1) c.liveRepaint(i);
    else c.session(SA, `Session title ${i}`);
    await settle();
  }
  assert.ok(c.paints - before >= n, `forced ${c.paints - before} repaints`);
  return c.paints - before;
}
const detailRequests = (c: Harness) => c.requests.filter((q) => q.path === '/v1/plan');
const firstPages = (c: Harness) => detailRequests(c).filter((q) => !q.query?.cursor).length;
/** Per-read paging and internal restarts stay under the existing limits. */
function pagingFacts(c: Harness) {
  const restarts = firstPages(c) - c.readStarts;
  assert.ok(restarts >= 0 && restarts <= c.readStarts * source.MAX_DETAIL_RESTARTS, `internal restarts ${restarts}`);
  assert.ok(detailRequests(c).length <= c.readStarts * (source.MAX_DETAIL_RESTARTS + 1) * source.MAX_DETAIL_PAGES);
  return { readStarts: c.readStarts, detailPageRequests: detailRequests(c).length, internalRestarts: restarts };
}
/** No paint ever shows a detail of another revision than the plan it is painted for. */
const neverMismatched = (c: Harness) => assert.ok(c.observed.every((o) => o.readiness !== 'ready' || o.cached === o.listed), JSON.stringify(c.observed.filter((o) => o.readiness === 'ready' && o.cached !== o.listed)));
const shownRevision = (c: Harness) => { const p = c.vc.read!.plans[0]; const d = c.vc.detail(p); return d?.state === 'ready' && d.value.revision === p.revision ? d.value.revision : null; };

test('re-reads: a detail reply newer than the list is read once, not on every paint; the next list poll converges without a read', async (t) => {
  const c = controller();
  c.state.items = RACE_ITEMS;
  const hold = holdSecondPage(c);
  c.ready(SA); await settle();
  assert.ok(hold.waiting, 'detail page 2 for listed revision 5 is held');
  assert.equal(c.readStarts, 1);
  // The service moves to 6 while the list still announces 5; page 2 now reports 6 (one internal restart).
  c.state.revision = 6; c.state.listRevision = 5;
  await hold.release(); await settle();
  const atResult = detailRequests(c).length;
  assert.deepEqual([c.observed.at(-1)!.listed, c.observed.at(-1)!.cached, c.observed.at(-1)!.readiness], [5, 6, 'loading'], 'the newer detail waits for its list revision');
  const forced = await repaints(c);
  assert.equal(c.readStarts, 1, 'no re-read per paint while the list lags');
  assert.equal(detailRequests(c).length, atResult, 'no detail page requested by repaints');
  // The next fake-clock list poll announces 6: the detail already matches, nothing is re-read.
  c.state.listRevision = null; c.poll(); await settle();
  assert.equal(shownRevision(c), 6);
  assert.ok(c.readStarts <= 1 + 1, 'one initial read plus at most one per observed revision change');
  assert.equal(c.readStarts, 1);
  neverMismatched(c);
  // A later revision change: exactly one re-read, then stable under repaints.
  c.state.revision = 7; c.poll(); await settle();
  assert.equal(shownRevision(c), 7);
  assert.equal(c.readStarts, 2);
  await repaints(c);
  assert.equal(c.readStarts, 2);
  neverMismatched(c);
  t.diagnostic(JSON.stringify({ scenario: 'newer-reply-ahead-of-list+later-change', observedRevisionChanges: 2, forcedRepaints: forced, ...pagingFacts(c) }));
  c.stop();
});

test('re-reads: a revision announced while the old read is held re-reads once after the superseded result lands', async (t) => {
  const c = controller();
  c.state.items = RACE_ITEMS;
  const hold = holdSecondPage(c);
  c.ready(SA); await settle();
  c.state.revision = 6; c.poll(); await settle();
  assert.equal(c.vc.read!.plans[0].revision, 6, 'the list announces 6 while the read for 5 is held');
  assert.equal(c.readStarts, 1, 'the in-flight read is not duplicated');
  // The superseded read completes at 5 (the service had not moved for that page).
  c.state.revision = 5; await hold.release(); c.state.revision = 6; await settle();
  const forced = await repaints(c);
  assert.equal(shownRevision(c), 6);
  assert.equal(c.readStarts, 2, 'initial read plus one re-read for the one observed change');
  neverMismatched(c);
  t.diagnostic(JSON.stringify({ scenario: 'superseded-result-released', observedRevisionChanges: 1, forcedRepaints: forced, ...pagingFacts(c) }));
  c.stop();
});

test('re-reads: a hidden Work Status frame neither polls nor re-reads while the list lags; showing it converges', async (t) => {
  const c = controller({ surface: 'status' });
  c.state.items = RACE_ITEMS;
  const hold = holdSecondPage(c);
  c.ready(SA); await settle();
  // Reported blockers revision 1 (docs/contracts.md, "Detail identity and current attention"):
  // hiding retires in-flight detail reads, so the held page released while hidden continues
  // nothing (no restart page) and paints nothing; becoming visible reads afresh. Before that
  // contract the held read finished in the background and was reused on show (one read start).
  c.hide();
  const lists = () => c.requests.filter((q) => q.path === '/v1/plans').length;
  const listsHidden = lists();
  const detailsHidden = detailRequests(c).length;
  const plannedHidden = c.timers.length;
  c.state.revision = 6; c.state.listRevision = 5;
  await hold.release(); await settle();
  const forced = await repaints(c);
  assert.equal(c.readStarts, 1, 'no read starts while hidden');
  assert.equal(detailRequests(c).length, detailsHidden, 'the retired read requests no continuation or restart page while hidden');
  assert.equal(lists(), listsHidden, 'no hidden poll');
  assert.equal(c.timers.slice(plannedHidden).filter((ms) => ms === 3000 || ms === 8000).length, 0, 'no poll planned while hidden');
  c.state.listRevision = null; c.show(); await settle();
  assert.equal(shownRevision(c), 6);
  assert.equal(c.readStarts, 2, 'showing performs exactly one fresh read');
  neverMismatched(c);
  t.diagnostic(JSON.stringify({ scenario: 'hidden-work-status', observedRevisionChanges: 1, forcedRepaints: forced, hiddenListReads: 0, hiddenDetailPageRequests: 0, readStartsAfterShow: c.readStarts, ...pagingFacts(c) }));
  c.stop();
});

test('re-reads: identity and list-generation retirement stop the held read; nothing continues or lands', async (t) => {
  // List generation: A → null while page 2 is held.
  const c = controller();
  c.state.items = RACE_ITEMS;
  const hold = holdSecondPage(c);
  c.ready(SA); await settle();
  c.state.revision = 6;
  c.ready(null); await settle();
  const mark = c.requests.length;
  await hold.release(); await settle();
  // Live-workspace repaints only: a session event would select a session again.
  for (let i = 0; i < 20; i++) { c.liveRepaint(100 + i); await settle(); }
  assert.equal(c.requests.slice(mark).some((q) => q.path === '/v1/plan'), false, 'a retired read issues no continuation or restart');
  assert.equal(c.readStarts, 1);
  c.stop();
  // Identity: a store replacement with equal IDs retires the held read; the new authority reads once.
  const d = controller();
  d.state.items = RACE_ITEMS;
  const hold2 = holdSecondPage(d);
  d.ready(SA); await settle();
  d.setStore('store-replaced'); d.retry(); await settle();
  assert.equal(d.readStarts, 2, 'the new authority starts its own read');
  const mark2 = d.requests.length;
  d.state.revision = 6;
  await hold2.release(); await settle();
  assert.equal(d.requests.slice(mark2).filter((q) => q.path === '/v1/plan' && !q.query?.cursor).length, 0, 'the retired read neither continues nor restarts');
  await repaints(d);
  assert.equal(d.readStarts, 2);
  neverMismatched(d);
  t.diagnostic(JSON.stringify({ scenario: 'retirement', listGeneration: { readStarts: c.readStarts }, identity: pagingFacts(d) }));
  d.stop();
});

test('re-reads: a failed read stays an error under repaints and is retried once by the next list refresh', async (t) => {
  const c = controller();
  c.state.items = RACE_ITEMS;
  const hold = holdSecondPage(c);
  c.ready(SA); await settle();
  hold.fail(); await settle();
  assert.equal(c.vc.detail(c.vc.read!.plans[0])?.state, 'error');
  const forced = await repaints(c);
  assert.equal(c.readStarts, 1, 'no retry per paint');
  c.poll(); await settle();
  assert.equal(c.readStarts, 2, 'the next list refresh retries exactly once');
  assert.equal(shownRevision(c), 5, 'the retry recovers; no permanent loading');
  await repaints(c);
  assert.equal(c.readStarts, 2);
  t.diagnostic(JSON.stringify({ scenario: 'error-retry', forcedRepaints: forced, ...pagingFacts(c) }));
  c.stop();
});
