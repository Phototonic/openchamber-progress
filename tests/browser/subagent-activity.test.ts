// Sub-agent census, roster and run-read logic over synthetic workspace snapshots and the real-Store
// run fixture (not native-host proof; rendered behaviour is subagent-activity-qa.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { HostClient } from '@openchamber/sdk';
import { EMPTY_LIVE, LiveWorkspace, type LiveSession, type LiveSnapshot } from '../../ui/shared/live.ts';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { censusFor, CENSUS_LIMITS, currentFor, isComplete, observe, planFacts, type Census } from '../../ui/shared/census.ts';
import { parsePlanPage, parsePlansPage, parseRunRead } from '../../ui/shared/adapter.ts';
import { participantIndex, type PlanDetail, type PlanView } from '../../ui/shared/model.ts';
import { refreshLabels } from '../../ui/shared/components.ts';
import { RunsController, type RunsPanel } from '../../ui/shared/runs.ts';
import { ExecutionBaselines, rosterFor, ranOf, type RosterInput } from '../../ui/shared/subagents.ts';
import type { RunRead, RunRequest, RunRow } from '../../shared/subagent-runs.ts';
import { seedRunReadFixture } from '../fixtures/subagent-activity-runs.ts';
import { at, planPage, plansPage, summary } from './fixtures.ts';

const alpha = { id: 'proj-alpha', name: 'Alpha', directory: '/fixture/Alpha' };
const beta = { id: 'proj-beta', name: 'Beta', directory: '/fixture/Beta' };
const rec = (id: string, parentId: string | null, extra: Partial<LiveSession> = {}): LiveSession => ({
  id, title: `Title ${id}`, projectId: alpha.id, directory: alpha.directory, parentId, archivedAt: null, worktree: null,
  activity: 'idle', outcome: null, ...extra,
});
/** A in Alpha with C1/C2 and N1 under C1; unrelated root B; a Beta root with a lookalike title. */
const ALPHA = [rec('A', null), rec('C2', 'A', { createdAt: 2 }), rec('C1', 'A', { createdAt: 1, activity: 'running' }), rec('N1', 'C1'), rec('B', null), rec('B-child', 'B')];
function snap(records = ALPHA, extra: Partial<LiveSnapshot> = {}, coverage: { directory: string; state: 'ready' | 'loading' | 'error' }[] | null = [{ directory: alpha.directory, state: 'ready' }]): LiveSnapshot {
  return {
    ...EMPTY_LIVE, projectsState: 'ready', projects: [alpha, beta], worktrees: new Map(),
    sessions: new Map([[alpha.id, { state: 'ready', records, coverage: coverage ?? undefined }], [beta.id, { state: 'ready', records: [rec('Beta-root', null, { projectId: beta.id, directory: beta.directory, title: 'Title C1' })], coverage: [] }]]),
    capped: [], ...extra,
  };
}
const ready = (c: Census) => { assert.equal(c.state, 'ready'); return c as Extract<Census, { state: 'ready' }>; };

test('census: exact parentage gives the selected root, direct children in creation order and nested ones; nothing else', () => {
  const c = ready(censusFor('A', alpha.directory, snap()));
  assert.equal(c.root.id, 'A');
  assert.deepEqual(c.rows.map((r) => [r.id, r.depth, r.parentId]), [['C1', 1, 'A'], ['N1', 2, 'C1'], ['C2', 1, 'A']]);
  assert.ok(isComplete(c));
  // A selected child roots its own subtree: no climb to its parent or siblings.
  assert.deepEqual(ready(censusFor('C1', alpha.directory, snap())).rows.map((r) => r.id), ['N1']);
  // B never borrows A's children; the Beta lookalike title never joins Alpha.
  assert.deepEqual(ready(censusFor('B', alpha.directory, snap())).rows.map((r) => r.id), ['B-child']);
  assert.equal(censusFor(null, alpha.directory, snap()).state, 'none');
});

test('census: directory only picks the stream; a root it does not list is not seen, not empty', () => {
  // Directory hint of Beta cannot place A there; A is found by exact ID in Alpha.
  assert.equal(ready(censusFor('A', beta.directory, snap())).project.id, alpha.id);
  assert.equal(censusFor('ghost', alpha.directory, snap()).state, 'not-seen');
  assert.deepEqual(censusFor('ghost', '/elsewhere', snap()), { state: 'unavailable', rootId: 'ghost', reason: 'no-project' });
  // The same ID listed by two projects is not this host's session.
  const twice = snap(); twice.sessions.get(beta.id)!.records.push(rec('A', null, { projectId: beta.id, directory: beta.directory }));
  assert.equal(censusFor('A', alpha.directory, twice).state, 'not-seen');
});

test('census: loading, refused, capped and partial coverage are distinct from a complete empty census', () => {
  assert.equal(censusFor('A', alpha.directory, { ...snap(), projectsState: 'loading' }).state, 'loading');
  assert.deepEqual(censusFor('A', alpha.directory, { ...snap(), projectsState: 'error' }), { state: 'unavailable', rootId: 'A', reason: 'error' });
  const s = snap(); s.sessions.set(alpha.id, { state: 'loading', records: [] });
  assert.equal(censusFor('A', alpha.directory, s).state, 'loading');
  s.sessions.set(alpha.id, { state: 'error', records: [] });
  assert.deepEqual(censusFor('A', alpha.directory, s), { state: 'unavailable', rootId: 'A', reason: 'error' });
  assert.deepEqual(censusFor('A', alpha.directory, snap(ALPHA, { capped: [alpha.id] })), { state: 'unavailable', rootId: 'A', reason: 'not-watched' });
  assert.deepEqual(ready(censusFor('A', alpha.directory, snap(ALPHA, {}, [{ directory: alpha.directory, state: 'loading' }]))).gaps, ['coverage']);
  assert.deepEqual(ready(censusFor('A', alpha.directory, snap(ALPHA, {}, null))).gaps, ['coverage']);
  const lonely = ready(censusFor('B-child', alpha.directory, snap()));
  assert.equal(lonely.rows.length, 0); assert.ok(isComplete(lonely));
  // Currency comes from the stream itself: full coverage is current, partial coverage is not.
  assert.equal(currentFor(censusFor('A', alpha.directory, snap())), true);
  assert.equal(currentFor(censusFor('A', alpha.directory, snap(ALPHA, {}, [{ directory: alpha.directory, state: 'error' }]))), false);
  // The integration link (ready context `connection`) is not an input at all.
  assert.equal(censusFor.length, 3);
});

test('census bounds: record, depth and row caps and conflicting duplicates are visible gaps', () => {
  const chain = [rec('A', null), ...Array.from({ length: CENSUS_LIMITS.depth + 3 }, (_, i) => rec(`D${i}`, i ? `D${i - 1}` : 'A'))];
  const deep = ready(censusFor('A', alpha.directory, snap(chain)));
  assert.equal(deep.rows.length, CENSUS_LIMITS.depth); assert.ok(deep.gaps.includes('depth'));
  const wide = [rec('A', null), ...Array.from({ length: CENSUS_LIMITS.rows + 5 }, (_, i) => rec(`W${i}`, 'A', { createdAt: i }))];
  const many = ready(censusFor('A', alpha.directory, snap(wide)));
  assert.equal(many.rows.length, CENSUS_LIMITS.rows); assert.equal(many.omitted, 5); assert.ok(many.gaps.includes('rows'));
  const huge = [rec('A', null), ...Array.from({ length: CENSUS_LIMITS.records }, (_, i) => rec(`H${i}`, 'X'))];
  assert.ok(ready(censusFor('A', alpha.directory, snap(huge))).gaps.includes('records'));
  const dup = ready(censusFor('A', alpha.directory, snap([...ALPHA, rec('C2', 'B')])));
  assert.deepEqual(dup.rows.map((r) => r.id), ['C1', 'N1']); assert.ok(dup.gaps.includes('conflict'));
});

test('cycles through the selected root expose no descendant and are never complete', () => {
  const cyclic = (records: LiveSession[]) => {
    const c = ready(censusFor('A', alpha.directory, snap(records)));
    assert.deepEqual(c.rows, []); assert.ok(c.gaps.includes('cycle')); assert.equal(isComplete(c), false);
    return c;
  };
  // Self-parented root with otherwise ordinary children.
  cyclic([rec('A', 'A'), rec('C1', 'A'), rec('N1', 'C1')]);
  // Root ↔ child: A's parent is C1 and C1's parent is A.
  cyclic([rec('A', 'C1'), rec('C1', 'A'), rec('N1', 'C1'), rec('C2', 'A')]);
  // A longer loop above the root.
  cyclic([rec('A', 'X'), rec('X', 'Y'), rec('Y', 'A'), rec('C1', 'A')]);
  // A loop above the root that does not contain it leaves the root's own subtree verifiable.
  assert.deepEqual(ready(censusFor('A', alpha.directory, snap([rec('A', 'X'), rec('X', 'Y'), rec('Y', 'X'), rec('C1', 'A')]))).rows.map((r) => r.id), ['C1']);
  // A selected child with an ordinary parent is not a cycle.
  assert.ok(isComplete(censusFor('C1', alpha.directory, snap())));
});

test('descendant identity conflicts leave out that session and its subtree', () => {
  // C1 also listed by Beta's stream as a Beta session: C1 and nested N1 go, C2 stays.
  const twice = snap(); twice.sessions.get(beta.id)!.records.push(rec('C1', null, { projectId: beta.id, directory: beta.directory }));
  const c = ready(censusFor('A', alpha.directory, twice));
  assert.deepEqual(c.rows.map((r) => r.id), ['C2']); assert.ok(c.gaps.includes('conflict')); assert.equal(isComplete(c), false);
  // Same project ID, other directory: still a different identity.
  const moved = snap(); moved.sessions.get(beta.id)!.records.push(rec('C1', 'A', { directory: '/fixture/Elsewhere' }));
  assert.deepEqual(ready(censusFor('A', alpha.directory, moved)).rows.map((r) => r.id), ['C2']);
  // A record in Alpha's stream claiming another project is not verified either.
  const foreign = ready(censusFor('A', alpha.directory, snap([rec('A', null), rec('C1', 'A', { projectId: beta.id }), rec('N1', 'C1'), rec('C2', 'A')])));
  assert.deepEqual(foreign.rows.map((r) => r.id), ['C2']); assert.ok(foreign.gaps.includes('conflict'));
  // The identical identity listed by two streams is one session, not a conflict.
  const same = snap(); same.sessions.get(beta.id)!.records.push(rec('C1', 'A'));
  assert.ok(isComplete(censusFor('A', alpha.directory, same)));
  assert.deepEqual(ready(censusFor('A', alpha.directory, same)).rows.map((r) => r.id), ['C1', 'N1', 'C2']);
});

test('observation: words per state; a completed turn is not success; no time input at all', () => {
  assert.deepEqual(observe({ activity: 'running', outcome: null }), { kind: 'active', label: 'Running' });
  assert.equal(observe({ activity: 'idle', outcome: 'completed' }).label, 'Turn ended');
  assert.equal(observe({ activity: 'idle', outcome: 'failed' }).label, 'Turn failed');
  assert.equal(observe({ activity: 'waiting-question', outcome: null }).label, 'Waiting for an answer');
  assert.equal(observe({ activity: 'unknown', outcome: null }).label, 'State unknown');
  assert.doesNotMatch(observe({ activity: 'idle', outcome: 'completed' }).label, /success|complete|done/i);
  // Defect B: the projection has no clock or receipt parameter that could expire it.
  assert.equal(observe.length, 1);
});

test('LiveWorkspace: snapshots carry no receipt time; identical callbacks change nothing; restart starts again', async () => {
  const calls: { kind: string; id: string; cb: (s: any) => void }[] = [];
  const subscribe = (kind: string, id: string, cb: (s: any) => void) => { calls.push({ kind, id, cb }); return Promise.resolve(() => {}); };
  const host = { onProjects: (cb) => subscribe('projects', '', cb), onWorktrees: (id, cb) => subscribe('worktrees', id, cb), onSessions: (id, cb) => subscribe('sessions', id, cb) } satisfies Pick<HostClient, 'onProjects' | 'onWorktrees' | 'onSessions'>;
  const flush = async () => { for (let i = 0; i < 6; i++) await new Promise<void>((r) => setImmediate(r)); };
  const ws = new LiveWorkspace(host, 2, () => {});
  ws.start(); await flush();
  calls.find((c) => c.kind === 'projects')!.cb({ state: 'ready', projects: [alpha] }); await flush();
  ws.want([alpha.id]); await flush();
  const emit = (sessions: object[]) => calls.findLast((c) => c.kind === 'sessions')!.cb({ kind: 'sessions', projectId: alpha.id, state: 'ready', coverage: [{ directory: alpha.directory, state: 'ready' }], sessions });
  const raw = (id: string, activity: string, extra: object = {}) => ({ id, title: id, projectId: alpha.id, directory: alpha.directory, parentId: id === 'A' ? null : 'A', createdAt: 1, updatedAt: 1, archivedAt: null, worktree: null, activity, outcome: null, items: [], ...extra });
  emit([raw('A', 'idle'), raw('C1', 'running')]);
  const first = JSON.stringify(ws.snapshot.sessions.get(alpha.id));
  assert.ok(!/seen/i.test(first), 'no receipt fields');
  await new Promise((r) => setTimeout(r, 5));
  emit([raw('A', 'idle'), raw('C1', 'running')]);
  assert.equal(JSON.stringify(ws.snapshot.sessions.get(alpha.id)), first, 'an identical later callback is not new evidence');
  ws.restart(); await flush();
  assert.equal(ws.snapshot.sessions.size, 0, 'restart drops rows until fresh host snapshots arrive');
  ws.dispose();
});

test('defect B: a steady Running child stays Running past 60 s through reloads, identical, title and sibling callbacks; only a host change moves it', async () => {
  let clock = 1_000_000;
  const realNow = performance.now, realDate = Date.now;
  performance.now = () => clock; Date.now = () => clock;
  try {
    const calls: { kind: string; cb: (s: any) => void }[] = [];
    const subscribe = (kind: string, cb: (s: any) => void) => { calls.push({ kind, cb }); return Promise.resolve(() => {}); };
    const host = { onProjects: (cb) => subscribe('projects', cb), onWorktrees: (_id, cb) => subscribe('worktrees', cb), onSessions: (_id, cb) => subscribe('sessions', cb) } satisfies Pick<HostClient, 'onProjects' | 'onWorktrees' | 'onSessions'>;
    const flush = async () => { for (let i = 0; i < 6; i++) await new Promise<void>((r) => setImmediate(r)); };
    const ws = new LiveWorkspace(host, 2, () => {});
    ws.start(); await flush();
    calls.find((c) => c.kind === 'projects')!.cb({ state: 'ready', projects: [alpha] }); await flush();
    ws.want([alpha.id]); await flush();
    let title = 'C1', c2 = 'idle';
    const raw = (id: string, parentId: string | null, activity: string, t = id) => ({ id, title: t, projectId: alpha.id, directory: alpha.directory, parentId, createdAt: 1, updatedAt: 1, archivedAt: null, worktree: null, activity, outcome: null, items: [] });
    const ready = [{ directory: alpha.directory, state: 'ready' }];
    const emit = (state: string, c1 = 'running', coverage: object[] = ready) => calls.findLast((c) => c.kind === 'sessions')!.cb({ kind: 'sessions', projectId: alpha.id, state, coverage, sessions: state === 'ready' ? [raw('A', null, 'idle'), raw('C1', 'A', c1, title), raw('C2', 'A', c2)] : [] });
    const roster = () => rosterFor({ surface: 'panel', plan, facts: planFacts(plan, null, plan.sourceId), census: censusFor('A', alpha.directory, ws.snapshot), runs: null, verified: true, currentSession: 'A' });
    const c1 = () => roster()!.featured.find((e) => e.sessionId === 'C1')!.ran;
    emit('ready');
    const start = clock;
    for (const [t, step] of [[59_999, () => emit('ready')], [60_000, () => { emit('loading', 'running', [{ directory: alpha.directory, state: 'loading' }]); emit('ready'); }], [120_000, () => { title = 'Renamed'; emit('ready'); }], [180_000, () => { c2 = 'running'; emit('ready'); }]] as const) {
      clock = start + t; step();
      assert.deepEqual([c1().kind, c1().label], ['active', 'Running'], `still Running at ${t} ms`);
      assert.equal(c1().time, null, 'a host-only row shows no receipt time');
    }
    // Re-entering the view (a new subscription) does not fabricate a start either.
    ws.restart(); await flush();
    calls.findLast((c) => c.kind === 'projects')!.cb({ state: 'ready', projects: [alpha] }); await flush();
    ws.want([alpha.id]); await flush();
    emit('ready');
    assert.deepEqual([c1().label, c1().time], ['Running', null]);
    // A genuine host change moves it at once, without touching recorded task facts.
    emit('ready', 'waiting-permission');
    assert.equal(c1().kind, 'waiting');
    emit('ready', 'idle');
    assert.equal(roster()!.featured.find((e) => e.sessionId === 'C1'), undefined, 'an idle unlinked host-only child is no longer featured');
    // A missing snapshot or refused stream is not a transition: no host activity is claimed.
    emit('error');
    assert.equal(censusFor('A', alpha.directory, ws.snapshot).state, 'unavailable');
    ws.dispose();
  } finally { performance.now = realNow; Date.now = realDate; }
});

test('defect B: the label ticker moves time text only; a Running label is never rewritten by elapsed time', () => {
  // The smallest DOM refreshLabels reads: a ran label and its real start time.
  const label = { textContent: 'Running', dataset: { state: 'active' } };
  const started = Date.parse(at(3));
  const time = { dateTime: new Date(started).toISOString(), dataset: { age: ' · started ' } as Record<string, string>, textContent: ' · started 3 minutes ago' };
  const root = { querySelectorAll: (sel: string) => (sel === 'time[data-age]' ? [time] : sel.includes('[data-expires]') ? [label] : []) } as unknown as ParentNode;
  for (const later of [59_999, 60_000, 180_000]) {
    refreshLabels(root, 'en', started + 180_000 + later, 1_000 + later);
    assert.equal(label.textContent, 'Running');
    assert.equal(label.dataset.state, 'active');
  }
  assert.match(time.textContent, /started 6 minutes ago/);
});

// Recorded facts from the plan shown: a frozen v2 detail with C1 assigned two tasks, C2 relayed.
const items = [
  { id: 'task-1', title: 'Research', kind: 'task' as const, status: 'working' as const, assigneeSessionId: 'C1' },
  { id: 'task-2', title: 'Draft', kind: 'task' as const, status: 'pending' as const, assigneeSessionId: 'C1' },
  { id: 'task-3', title: 'Review', kind: 'task' as const, status: 'pending' as const },
];
const plan = parsePlansPage(JSON.stringify(plansPage([summary('plan-alpha', items, { sessionId: 'A', revision: 3 })]))).data[0];
const binding = (itemId: string, extra: object = {}) => ({ coordinatorSessionId: 'A', childSessionId: 'C1', planId: 'plan-alpha', itemId, tool: 'subagent', messageId: 'msg-1', callId: 'call-1', observedAt: at(3), boundAt: at(3), boundRevision: 2, validAtRevision: 3, ...extra });
function detail(itemsIn: object[]): PlanDetail {
  const page = parsePlanPage(JSON.stringify(planPage(summary('plan-alpha', items, { sessionId: 'A', revision: 3 }), itemsIn as never, [{ revision: 3, reporterSessionId: 'A', reporterAgent: 'build', attributedSessionId: 'C2', mode: 'parent-relay', itemIds: ['task-3'], reportedAt: at(1) }], undefined, [{ sessionId: 'C1', itemIds: ['task-1', 'task-2'] }])));
  return { key: plan.key, revision: page.plan.revision, items: page.items.data, contributions: page.contributions.data, links: page.links };
}

test('adapter keeps only current, matching delegation provenance; absence still shows the assignment', () => {
  const kept = detail([{ ...items[0], assignmentBinding: binding('task-1') }, items[1], items[2]]);
  assert.equal(kept.items[0].delegation?.childSessionId, 'C1');
  assert.equal(kept.items[0].assigneeSessionId, 'C1');
  for (const bad of [binding('task-1', { validAtRevision: 2 }), binding('task-1', { childSessionId: 'C2' }), binding('task-1', { coordinatorSessionId: 'B' }), binding('task-2'), binding('task-1', { prompt: 'x' }), binding('task-1', { boundRevision: 4 }), 'nonsense']) {
    const d = detail([{ ...items[0], assignmentBinding: bad }, items[1], items[2]]);
    assert.equal(d.items[0].delegation, undefined, JSON.stringify(bad));
    assert.equal(d.items[0].assigneeSessionId, 'C1');
  }
});

// ---- Sub-agent runs revision 1: Ran / Claimed / Accepted, plan gating and the real-Store seam ----
const T0 = 1_800_000_000_000;
let n = 0;
function run(state: RunRow['ran']['state'], extra: Partial<Omit<RunRow, 'ran'>> & { ran?: Partial<RunRow['ran']> } = {}): RunRow {
  const id = `run-${++n}`;
  const { ran, ...rest } = extra;
  return {
    id, kind: 'dispatch', source: plan.sourceId, parentSessionId: 'A', childSessionId: `K${n}`, tool: 'subagent', agent: 'explorer', description: `Synthetic job ${n}`,
    dispatch: { messageId: `m-${n}`, callId: `c-${n}`, at: T0 }, planContext: { plan: plan.id, revision: 3, observedAt: T0 },
    ran: { state, dispatchState: 'returned', startedAt: T0 + 100, endedAt: ['succeeded', 'failed', 'interrupted'].includes(state) ? T0 + 125_000 : null, updatedAt: T0 + 125_000, provenance: 'native-event', eventId: `e-${n}`, sequence: 2, errorType: null, interruptionReason: null, ...ran },
    claimed: null, accepted: null, ...rest,
  };
}
function readOf(rows: RunRow[], counts: Partial<RunRead['counts']> = {}, extra: Partial<RunRead> = {}): RunRead {
  // As the service counts them: distinct non-null child IDs (a dispatch without one is no child yet).
  const c = { children: new Set(rows.map((r) => r.childSessionId).filter(Boolean)).size, runs: rows.length, historicalSessions: 0, running: 0, succeeded: 0, failed: 0, interrupted: 0, unknown: 0 };
  for (const r of rows) c[r.ran.state]++;
  return { protocolVersion: 2, schemaVersion: 2, storeId: 'store-1', sourceBinding: { sourceId: plan.sourceId, verified: true }, source: plan.sourceId, root: 'A', plan: plan.id, cleanupRev: 0, view: 'useful', subagentRuns: 1, runFormat: 1, availability: 'ready', readAt: T0 + 200_000, revision: 7,
    capture: { enabled: true, state: 'last-known', loss: false }, recovery: { state: 'complete', reason: null, token: null }, counts: { ...c, ...counts },
    coverage: { scope: 'retained', complete: true, reasons: [] }, data: rows, nextCursor: null, ...extra };
}
const panel = (read: RunRead | null, more: RunRow[] = [], extra: Partial<RunsPanel> = {}): RunsPanel => ({ state: read ? 'ready' : 'unavailable', read, featured: read?.data ?? [], more, hasMore: false, paging: false, pageError: false, shown: 0, reconciling: false, failure: null, historyRequestFailed: false, baselines: new ExecutionBaselines(), showMore() {}, retryHistory() {}, ...extra });
const input = (extra: Partial<RosterInput> = {}): RosterInput => ({ surface: 'panel', plan, facts: planFacts(plan, null, plan.sourceId), census: censusFor('A', alpha.directory, snap()), runs: null, verified: true, currentSession: 'A', ...extra });

test('defect A: no plan in scope means no roster at all, even with running children and run rows', () => {
  const read = readOf([run('running'), run('succeeded')]);
  // Two host children, one running (C1), plus recorded runs: still nothing without a plan.
  for (const surface of ['panel', 'status', 'page'] as const) assert.equal(rosterFor(input({ surface, plan: null, runs: panel(read) })), null, surface);
  assert.equal(rosterFor(input({ plan: null, census: censusFor('A', alpha.directory, snap()) })), null);
  // An unverified setup shows nothing either.
  assert.equal(rosterFor(input({ verified: false, runs: panel(read) })), null);
  // With a plan in scope but nothing useful (no active, no task-linked, no recorded runs): no section.
  assert.equal(rosterFor(input({ census: censusFor('C2', alpha.directory, snap()), currentSession: 'C2', runs: panel(readOf([])) })), null);
  // With a plan in scope and a running child, the section is eligible.
  assert.ok(rosterFor(input({ runs: panel(read) })));
});

test('ran: real host times and justified durations; failed/interrupted/historical stay distinct from finished', () => {
  const ok = ranOf(run('succeeded'), null);
  assert.deepEqual([ok.kind, ok.label, ok.time, ok.duration], ['finished', 'Finished', { at: T0 + 125_000, prefix: '' }, { ms: 124_900, fromDispatch: false }]);
  assert.equal(ranOf(run('failed', { ran: { errorType: 'SyntheticFailure' } }), null).label, 'Failed: SyntheticFailure');
  assert.equal(ranOf(run('failed', { ran: { errorType: 'unknown' } }), null).label, 'Failed');
  for (const [reason, words] of [['user', 'stopped by the user'], ['shutdown', 'the host shut down'], ['superseded', 'replaced by a newer run'], ['inactivity', 'inactive too long'], [null, 'reason not recorded']] as const)
    assert.equal(ranOf(run('interrupted', { ran: { interruptionReason: reason } }), null).label, `Interrupted: ${words}`);
  // Only a dispatch time: duration says so; no start at all: no duration.
  assert.deepEqual(ranOf(run('succeeded', { ran: { startedAt: null } }), null).duration, { ms: 125_000, fromDispatch: true });
  const hist = ranOf(run('unknown', { kind: 'historical-session', dispatch: null, planContext: null, ran: { dispatchState: 'historical', provenance: 'native-session', startedAt: null, updatedAt: T0 - 2 * 86_400_000 } }), null);
  assert.deepEqual([hist.label, hist.time], ['Outcome unknown', { at: T0 - 2 * 86_400_000, prefix: 'last updated ' }], 'a two-day-old session reads as two days old, never just now');
  assert.deepEqual([ranOf(run('running'), null).label, ranOf(run('running'), null).time], ['Running', { at: T0 + 100, prefix: 'started ' }]);
  // A host waiting report refines an open run's words without inventing an end or success.
  const host = (activity: LiveSession['activity'], outcome: LiveSession['outcome'] = null) => ({ id: 'K', parentId: 'A', depth: 1, title: 'K', activity, outcome, archived: false });
  assert.equal(ranOf(run('running'), host('waiting-question')).kind, 'waiting');
  // P1: an idle/completed snapshot alone may be the cached result of the child's previous execution:
  // a native Running row stays Running. Only an active → idle change seen in this subscription moves it.
  for (const [activity, outcome] of [['idle', 'completed'], ['idle', 'failed'], ['idle', null], ['unknown', null]] as const) {
    const kept = ranOf(run('running'), host(activity, outcome));
    assert.deepEqual([kept.kind, kept.label], ['active', 'Running'], `${activity}/${outcome} snapshot without a transition`);
  }
  // Only an active → idle change observed after this execution's start qualifies (rosterFor decides).
  const idle = ranOf(run('running'), host('idle', 'completed'), { idleAfterStart: true });
  assert.deepEqual([idle.kind, idle.label, idle.duration], ['idle', 'Idle now, no outcome reported yet', null]);
  // A host event that already ended a run is never overridden by later host activity.
  assert.equal(ranOf(run('succeeded'), host('running')).label, 'Finished');
  assert.equal(ranOf(run('unknown', { ran: { dispatchState: 'pending', startedAt: null } }), null).label, 'Dispatched, not confirmed yet');
});

test('three layers: a claimed-done child with a blocked task keeps both; finished run is not a finished task', () => {
  const d = detail([items[0], items[1], items[2]]);
  const facts = planFacts(plan, { state: 'ready', value: d }, plan.sourceId);
  const c1 = run('succeeded', { childSessionId: 'C1', claimed: { oid: 'h-1', outcome: 'done', summary: '<b>Literal</b> handoff', reportedAt: T0 + 126_000, sessionId: 'C1', association: 'execution' } });
  const blocked = run('succeeded', { childSessionId: 'C2', accepted: { plan: plan.id, revision: 3, items: [{ id: 'task-3', status: 'blocked' }], omittedItems: 0 } });
  const r = rosterFor(input({ facts, runs: panel(readOf([c1, blocked])) }))!;
  const one = r.featured.find((e) => e.sessionId === 'C1')!;
  assert.equal(one.ran.label, 'Finished');
  assert.equal(one.claimed?.outcome, 'done');
  assert.equal(one.claimed?.summary, '<b>Literal</b> handoff', 'authored text stays literal data');
  assert.deepEqual(one.accepted?.tasks.map((t) => [t.id, t.status]), [['task-1', 'working'], ['task-2', 'pending']], 'tasks keep their reported status');
  const two = r.featured.find((e) => e.sessionId === 'C2')!;
  assert.deepEqual(two.accepted?.tasks, [{ id: 'task-3', title: 'Review', status: 'blocked' }]);
  assert.equal(two.duringPlan, true);
  // Without explicit task facts there is no Accepted line at all (never "unassigned").
  const lone = rosterFor(input({ runs: panel(readOf([run('running', { childSessionId: 'C9' })])) }))!.featured.find((e) => e.sessionId === 'C9')!;
  assert.equal(lone.accepted, null);
  assert.equal(lone.claimed, null);
});

test('many children: only running/waiting and task-linked are featured; the rest is counted, never a cap warning', () => {
  n = 0;
  const finished = Array.from({ length: 150 }, () => run('succeeded'));
  const rows = [run('running', { childSessionId: 'C1' }), ...finished.slice(0, 49)];
  const d = detail([items[0], items[1], items[2]]);
  const read = readOf(rows, { running: 1, succeeded: 152, failed: 2, interrupted: 1, unknown: 0, runs: 156, children: 156 }, { nextCursor: 'next' });
  const r = rosterFor(input({ facts: planFacts(plan, { state: 'ready', value: d }, plan.sourceId), runs: panel(read, [], { hasMore: true }) }))!;
  assert.deepEqual(r.featured.map((e) => e.sessionId), ['C1'], 'one running child (with its tasks) is featured; finished plan-context children are not');
  assert.deepEqual(r.summary.map((s) => s.text), ['1 running', '152 finished', '2 failed', '1 interrupted']);
  assert.equal(r.earlierTotal, 155);
  assert.equal(r.canPage, true);
  assert.ok(!r.notes.length, 'complete coverage: no warning at all');
  // Hundreds of task-linked rows are still bounded per surface.
  const linked = Array.from({ length: 40 }, () => run('succeeded', { accepted: { plan: plan.id, revision: 3, items: [{ id: 'task-1', status: 'done' }], omittedItems: 0 } }));
  assert.equal(rosterFor(input({ surface: 'status', runs: panel(readOf(linked)) }))!.featured.length, 3);
  assert.equal(rosterFor(input({ surface: 'panel', runs: panel(readOf(linked)) }))!.featured.length, 6);
});

test('P6: an unconfirmed dispatch and a new host child stay separate rows; nothing is attached without a child ID', () => {
  const pending = run('unknown', { childSessionId: null, ran: { dispatchState: 'pending', startedAt: null }, dispatch: { messageId: 'm', callId: 'c', at: 0 } });
  // The sole new child of the same parent, created after the dispatch, with explicitly reported tasks.
  const host = snap([rec('A', null), rec('C1', 'A', { activity: 'running', createdAt: 5 })]);
  const d = detail([items[0], items[1], items[2]]);
  const r = rosterFor(input({ census: censusFor('A', alpha.directory, host), facts: planFacts(plan, { state: 'ready', value: d }, plan.sourceId), runs: panel(readOf([pending])) }))!;
  const all = [...r.featured, ...r.earlier];
  const dispatch = all.find((e) => e.runId === pending.id)!;
  const child = all.find((e) => e.sessionId === 'C1')!;
  assert.notEqual(dispatch, child, 'two rows');
  assert.deepEqual([dispatch.sessionId, dispatch.ran.label, dispatch.accepted, dispatch.openable], [null, 'Dispatched, not confirmed yet', null, false], 'the dispatch borrows no activity, tasks or navigation');
  assert.deepEqual([child.runId, child.ran.label, child.title], [null, 'Running', 'Title C1'], 'the host child keeps only its own facts');
  assert.ok(!('paired' in dispatch), 'no pairing field remains');
  assert.deepEqual(r.summary.map((s) => s.text), ['1 running', '1 unknown']);
});

test('P1: a native Running run survives a cached idle snapshot (first in a subscription, reloads, re-entry); a seen active → idle change updates it', async () => {
  const calls: { kind: string; cb: (s: any) => void }[] = [];
  const subscribe = (kind: string, cb: (s: any) => void) => { calls.push({ kind, cb }); return Promise.resolve(() => {}); };
  const hostClient = { onProjects: (cb) => subscribe('projects', cb), onWorktrees: (_id, cb) => subscribe('worktrees', cb), onSessions: (_id, cb) => subscribe('sessions', cb) } satisfies Pick<HostClient, 'onProjects' | 'onWorktrees' | 'onSessions'>;
  const flush = async () => { for (let i = 0; i < 6; i++) await new Promise<void>((r) => setImmediate(r)); };
  const ws = new LiveWorkspace(hostClient, 2, () => {});
  const subscribeAll = async () => { calls.findLast((c) => c.kind === 'projects')!.cb({ state: 'ready', projects: [alpha] }); await flush(); ws.want([alpha.id]); await flush(); };
  ws.start(); await flush(); await subscribeAll();
  const raw = (id: string, parentId: string | null, activity: string, outcome: string | null = null) => ({ id, title: id, projectId: alpha.id, directory: alpha.directory, parentId, createdAt: 1, updatedAt: 1, archivedAt: null, worktree: null, activity, outcome, items: [] });
  const emit = (state: string, activity: string, outcome: string | null = null) => calls.findLast((c) => c.kind === 'sessions')!.cb({ kind: 'sessions', projectId: alpha.id, state, coverage: [{ directory: alpha.directory, state }], sessions: state === 'ready' ? [raw('A', null, 'idle'), raw('K1', 'A', activity, outcome)] : [] });
  const live = run('running', { childSessionId: 'K1' });
  const baselines = new ExecutionBaselines();
  const ran = () => rosterFor(input({ census: censusFor('A', alpha.directory, ws.snapshot), liveSeq: ws.snapshot.seq, runs: panel(readOf([live]), [], { baselines }) }))!.featured.find((e) => e.runId === live.id)!.ran;
  // The previous execution's completed result arrives first: no transition, so Running stays.
  emit('ready', 'idle', 'completed');
  assert.equal(ran().label, 'Running');
  emit('loading', 'idle', 'completed'); emit('ready', 'idle', 'completed');
  assert.equal(ran().label, 'Running', 'an unchanged reload is not a transition');
  // Seen live: running, then idle in the same subscription: newer than the running report.
  emit('ready', 'running');
  assert.equal(ran().label, 'Running');
  emit('ready', 'idle', 'completed');
  assert.deepEqual([ran().kind, ran().label], ['idle', 'Idle now, no outcome reported yet']);
  emit('loading', 'idle', 'completed'); emit('ready', 'idle', 'completed');
  assert.equal(ran().kind, 'idle', 'the seen transition survives a reload of the same subscription');
  // Active again clears it; a new subscription (view re-entry) starts with no transition evidence.
  emit('ready', 'running'); assert.equal(ran().label, 'Running');
  emit('ready', 'idle'); assert.equal(ran().kind, 'idle');
  ws.restart(); await flush(); await subscribeAll();
  emit('ready', 'idle', 'completed');
  assert.equal(ran().label, 'Running', 're-entry with a cached idle result keeps Running');
  ws.dispose();
});

/** One subscription of child K1 under A, with the roster read through shared execution baselines. */
async function oneSubscription() {
  const calls: { kind: string; cb: (s: any) => void }[] = [];
  const subscribe = (kind: string, cb: (s: any) => void) => { calls.push({ kind, cb }); return Promise.resolve(() => {}); };
  const hostClient = { onProjects: (cb) => subscribe('projects', cb), onWorktrees: (_id, cb) => subscribe('worktrees', cb), onSessions: (_id, cb) => subscribe('sessions', cb) } satisfies Pick<HostClient, 'onProjects' | 'onWorktrees' | 'onSessions'>;
  const flush = async () => { for (let i = 0; i < 6; i++) await new Promise<void>((r) => setImmediate(r)); };
  const ws = new LiveWorkspace(hostClient, 2, () => {});
  ws.start(); await flush();
  calls.findLast((c) => c.kind === 'projects')!.cb({ state: 'ready', projects: [alpha] }); await flush(); ws.want([alpha.id]); await flush();
  const raw = (id: string, parentId: string | null, activity: string, outcome: string | null = null) => ({ id, title: id, projectId: alpha.id, directory: alpha.directory, parentId, createdAt: 1, updatedAt: 1, archivedAt: null, worktree: null, activity, outcome, items: [] });
  /** `state`: the stream state; `coverage`: this snapshot's directory coverage. A loading snapshot carries no rows. */
  const emit = (activity: string, outcome: string | null = null, state = 'ready', coverage = state === 'ready' ? 'ready' : 'loading') => calls.findLast((c) => c.kind === 'sessions')!.cb({ kind: 'sessions', projectId: alpha.id, state, coverage: [{ directory: alpha.directory, state: coverage }], sessions: state === 'ready' ? [raw('A', null, 'idle'), raw('K1', 'A', activity, outcome)] : [] });
  const baselines = new ExecutionBaselines();
  const roster = (rows: RunRow[]) => rosterFor(input({ census: censusFor('A', alpha.directory, ws.snapshot), liveSeq: ws.snapshot.seq, runs: panel(readOf(rows), [], { baselines }) }))!;
  return { ws, emit, roster };
}

test('P1: transition evidence is per execution: a previous execution\'s active → idle never ends the next one', async () => {
  const { ws, emit, roster } = await oneSubscription();
  const entry = (rows: RunRow[], id: string) => { const r = roster(rows); return [...r.featured, ...r.earlier].find((e) => e.runId === id)!; };
  // Execution N, seen running then idle in this subscription.
  const first = run('running', { childSessionId: 'K1', ran: { eventId: 'start-N' } });
  emit('running'); assert.equal(entry([first], first.id).ran.label, 'Running');
  emit('idle', 'completed'); assert.equal(entry([first], first.id).ran.kind, 'idle');
  // Execution N+1 has a native start while the SDK still holds N's idle result: Running.
  const next = run('running', { childSessionId: 'K1', ran: { eventId: 'start-N1' }, dispatch: { messageId: 'm2', callId: 'c2', at: T0 + 1_000 } });
  const n1 = () => entry([first, next], next.id).ran;
  assert.deepEqual([n1().kind, n1().label], ['active', 'Running'], 'the earlier execution\'s transition does not qualify');
  emit('idle', 'completed'); assert.equal(n1().label, 'Running', 'an unchanged cached idle is still not evidence');
  // N+1's own active → idle, observed after its start, does.
  emit('running'); assert.equal(n1().label, 'Running');
  emit('idle', 'completed'); assert.deepEqual([n1().kind, n1().label], ['idle', 'Idle now, no outcome reported yet']);
  // A new start event on the same dispatch is a new execution too.
  const resumed = { ...next, ran: { ...next.ran, eventId: 'start-N2', sequence: 3 } };
  assert.equal(entry([first, resumed], resumed.id).ran.label, 'Running');
  ws.dispose();
});

test('adapter: the real-Store revision-1 fixture parses; any identity drift is refused', () => {
  const dir = mkdtempSync(join(tmpdir(), 'subagent-runs-ui-'));
  try {
    const f = seedRunReadFixture(join(dir, 'store.sqlite'));
    const body = JSON.stringify(f.read());
    const parsed = parseRunRead(body, f.request);
    assert.equal(parsed.data.length >= 4, true);
    assert.deepEqual([parsed.counts.running, parsed.counts.failed, parsed.counts.interrupted], [1, 1, 1]);
    const states = new Map(parsed.data.map((r) => [r.description, ranOf(r, null).label]));
    assert.equal(states.get('Synthetic work 2'), 'Failed: SyntheticFailure');
    assert.equal(states.get('Synthetic work 3'), 'Interrupted: stopped by the user');
    for (const drift of [{ root: 'other' }, { plan: 'other-plan' }, { storeId: 'other' }, { view: 'history' as const }, { binding: { sourceId: f.request.source, verified: false } }])
      assert.throws(() => parseRunRead(body, { ...f.request, ...drift }), /identity/, JSON.stringify(drift));
    assert.throws(() => parseRunRead(body.replace('"running"', '"done-ish"'), f.request));
    f.store.close?.();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('runs controller: one visit per eligible paint; retired, hidden and held replies never repaint, page or reconcile', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'subagent-runs-ctl-'));
  try {
    const f = seedRunReadFixture(join(dir, 'store.sqlite'));
    const calls: { method: string; path: string }[] = [];
    const held: (() => void)[] = [];
    let hold = false, visible = true, changed = 0;
    const answer = (q: any) => {
      if (q.path.endsWith('/reconcile')) return { status: 200, body: JSON.stringify(f.store.requestRunReconciliation(JSON.parse(q.body))) };
      const r: RunRequest = { ...q.query, binding: JSON.parse(q.query.binding), ...(q.query.cleanupRev !== undefined ? { cleanupRev: Number(q.query.cleanupRev) } : {}) };
      try { return { status: 200, body: JSON.stringify(f.store.subagentRuns(r, T0)) }; } catch (e: any) { return { status: e.code === 'not-found' ? 404 : 409, body: JSON.stringify({ error: e.code }) }; }
    };
    const host = { serviceRequest: (q: any) => { calls.push({ method: q.method, path: q.path }); return new Promise<any>((resolve) => { const go = () => resolve(answer(q)); if (hold) held.push(go); else go(); }); } };
    const flush = async () => { for (let i = 0; i < 8; i++) await new Promise<void>((r) => setImmediate(r)); };
    const ctl = new RunsController({ service: (current) => ({ serviceRequest: (q) => (current() ? host.serviceRequest(q) : Promise.reject(new Error('Retired read'))) }), visible: () => visible, changed: () => { changed++; } });
    const claim = { owner: 'acct|store', request: f.request, capable: true, captureEnabled: true };
    const paint = (eligible: boolean) => { ctl.beginPaint(); const p = eligible ? ctl.claim(claim) : null; ctl.endPaint(); return p; };
    paint(true); await flush();
    let p = paint(true)!;
    assert.equal(p.state, 'ready');
    assert.equal(calls.filter((c) => c.method === 'GET').length, 1, 'repaints read nothing');
    // The fixture's history is complete: no automatic reconciliation request.
    assert.equal(calls.filter((c) => c.method === 'POST').length, 0);
    // Plan → no plan: the visit retires; a held poll reply cannot repaint.
    hold = true; ctl.poll(); paint(false);
    const before = changed; held.splice(0).forEach((go) => go()); await flush();
    assert.equal(changed, before, 'held reply after retirement is dropped');
    // Hidden: an in-flight reply is dropped too, and nothing polls while hidden.
    hold = true; paint(true); visible = false; ctl.hidden(); const gets = calls.length; ctl.poll(); assert.equal(calls.length, gets);
    const hiddenBefore = changed; held.splice(0).forEach((go) => go()); await flush();
    assert.equal(changed, hiddenBefore);
    hold = false; visible = true; ctl.poll(); await flush();
    p = paint(true)!; assert.equal(p.state, 'ready');
    // Not capable: unavailable, and no request at all.
    const quiet = calls.length; ctl.retire();
    ctl.beginPaint(); assert.equal(ctl.claim({ ...claim, capable: false }).state, 'unavailable'); ctl.endPaint(); await flush();
    assert.equal(calls.length, quiet);
    f.store.close?.();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('runs controller: an unreconciled root asks for history once per frame, not per repaint or poll', async () => {
  const replies: string[] = [];
  const base = readOf([run('succeeded')], {}, { recovery: { state: 'not-requested', reason: null, token: null }, coverage: { scope: 'retained', complete: false, reasons: ['history-not-reconciled'] } });
  const request: RunRequest = { storeId: base.storeId, binding: base.sourceBinding, source: base.source, root: base.root, plan: base.plan!, cleanupRev: 0, view: 'useful' };
  const host = { serviceRequest: async (q: any) => { replies.push(q.method); return { status: 200, body: JSON.stringify(q.method === 'POST' ? { state: 'pending', coalesced: false } : base) }; } };
  const flush = async () => { for (let i = 0; i < 8; i++) await new Promise<void>((r) => setImmediate(r)); };
  const ctl = new RunsController({ service: () => host, visible: () => true, changed: () => {} });
  const claim = { owner: 'o', request, capable: true, captureEnabled: true };
  for (let i = 0; i < 4; i++) { ctl.beginPaint(); ctl.claim(claim); ctl.endPaint(); ctl.poll(); await flush(); }
  assert.equal(replies.filter((m) => m === 'POST').length, 1);
  // Capture off: no automatic request at all.
  const off = new RunsController({ service: () => host, visible: () => true, changed: () => {} });
  replies.length = 0;
  off.beginPaint(); off.claim({ ...claim, owner: 'other', captureEnabled: false }); off.endPaint(); await flush();
  assert.equal(replies.filter((m) => m === 'POST').length, 0);
});

test('repeat dispatches of one child: task facts sit on its latest run only; an empty fact list is no Accepted line', () => {
  const tasks = { plan: plan.id, revision: 3, items: [{ id: 'task-1', status: 'working' as const }], omittedItems: 0 };
  const older = run('succeeded', { childSessionId: 'C2', accepted: tasks, dispatch: { messageId: 'm', callId: 'c-old', at: T0 - 600_000 } });
  const newer = run('succeeded', { childSessionId: 'C2', accepted: tasks, dispatch: { messageId: 'm', callId: 'c-new', at: T0 } });
  const empty = run('succeeded', { childSessionId: 'C9', accepted: { plan: plan.id, revision: 3, items: [], omittedItems: 0 } });
  const r = rosterFor(input({ runs: panel(readOf([older, newer, empty])) }))!;
  const all = [...r.featured, ...r.earlier];
  assert.deepEqual(r.featured.filter((e) => e.runId).map((e) => e.runId), [newer.id], 'one featured row per task-linked child');
  assert.equal(all.find((e) => e.runId === older.id)!.accepted, null);
  assert.equal(all.find((e) => e.runId === empty.id)!.accepted, null);
});

test('P2: a terminal run with the SDK still holding that execution\'s Running snapshot is not "running again"', async () => {
  const { ws, emit, roster } = await oneSubscription();
  const entry = (rows: RunRow[]) => { const r = roster(rows); return { r, e: [...r.featured, ...r.earlier].find((x) => x.runId === rows[0].id)! }; };
  // The same execution: SDK running, then the native terminal event arrives first.
  emit('running');
  const done = run('succeeded', { childSessionId: 'K1' });
  let { r, e } = entry([done]);
  assert.deepEqual([e.ran.label, e.now], ['Finished', null], 'no "again" without post-terminal evidence');
  assert.deepEqual(r.summary.map((s) => s.text), ['1 finished'], 'and not counted as running');
  emit('running'); ({ r, e } = entry([done]));
  assert.equal(e.now, null, 'an unchanged running callback is not a resume');
  // The SDK catches up (idle), then a genuine idle → active change after the terminal fact: a resume.
  emit('idle', 'completed'); ({ r, e } = entry([done])); assert.equal(e.now, null);
  emit('running'); ({ r, e } = entry([done]));
  assert.deepEqual([e.ran.label, e.now], ['Finished', { kind: 'active', label: 'Running' }]);
  assert.deepEqual(r.summary.map((s) => s.text), ['1 running', '1 finished']);
  emit('waiting-question'); ({ r } = entry([done])); assert.equal(r.summary[0].text, '1 waiting on you');
  emit('idle'); ({ r, e } = entry([done]));
  assert.equal(e.now, null);
  assert.equal(r.featured.filter((x) => x.runId).length, 0, 'once idle again it folds back into the earlier list');
  ws.dispose();
});

test('coverage gate: retained host rows during a reload or incomplete coverage give no current activity; recorded Running stays', async () => {
  const records = [rec('A', null), rec('W1', 'A', { activity: 'waiting-permission' }), rec('H1', 'A', { activity: 'running' }), rec('K1', 'A', { activity: 'waiting-question' })];
  const live = run('running', { childSessionId: 'K1' });
  const d = detail([items[0], items[1], items[2]]);
  const facts = planFacts(plan, { state: 'ready', value: d }, plan.sourceId);
  const roster = (coverage: { directory: string; state: 'ready' | 'loading' | 'error' }[] | null) =>
    rosterFor(input({ facts, census: censusFor('A', alpha.directory, snap(records, {}, coverage)), runs: panel(readOf([live])) }))!;
  // Full coverage: the host words are current.
  const full = roster([{ directory: alpha.directory, state: 'ready' }]);
  assert.deepEqual(full.summary.map((s) => s.text), ['2 waiting on you', '1 running']);
  assert.ok(!full.notes.some((n) => n.kind === 'host-activity-unavailable'), 'no note in the normal state');
  for (const coverage of [[{ directory: alpha.directory, state: 'loading' as const }], [{ directory: alpha.directory, state: 'error' as const }], null]) {
    const r = roster(coverage);
    const all = [...r.featured, ...r.earlier];
    assert.ok(!r.summary.some((s) => s.kind === 'waiting'), `no "waiting on you" from retained rows (${JSON.stringify(coverage)})`);
    assert.deepEqual(r.summary.map((s) => s.text), ['1 running'], 'only the recorded Running fact is counted');
    const k1 = all.find((e) => e.runId === live.id)!;
    assert.deepEqual([k1.ran.kind, k1.ran.label], ['active', 'Running'], 'the recorded Running fact does not expire');
    assert.equal(all.find((e) => e.sessionId === 'W1'), undefined, 'a host-only waiting child is not shown as current');
    assert.equal(all.find((e) => e.sessionId === 'H1'), undefined, 'a host-only running child is not shown as current');
    assert.ok(r.notes.some((n) => n.kind === 'host-activity-unavailable'), 'withheld activity is disclosed');
    // Identity stays: navigation to a listed child is unaffected.
    assert.equal(k1.openable, true);
  }
});

test('coverage gate: idle-now and running-again need current coverage too; a task-linked host-only child stays, without a current word', async () => {
  const { ws, emit, roster } = await oneSubscription();
  const done = run('succeeded', { childSessionId: 'K1' });
  emit('idle'); roster([done]);
  emit('running'); assert.ok(roster([done]).featured.find((e) => e.runId === done.id)?.now, 'resumed with coverage');
  // A periodic reload of that complete snapshot keeps it current: still running again.
  emit('running', null, 'loading');
  assert.ok(roster([done]).featured.find((e) => e.runId === done.id)?.now, 'kept through a reload of a complete snapshot');
  // Genuine loss (failed coverage) withholds it: no "again", not counted running.
  emit('running', null, 'ready', 'error');
  const r = roster([done]);
  assert.equal([...r.featured, ...r.earlier].find((e) => e.runId === done.id)!.now, null);
  assert.ok(!r.summary.some((s) => s.kind === 'running'));
  ws.dispose();
  // A host-only child with explicitly reported tasks keeps its row (identity, tasks) but no current word.
  const d = detail([items[0], items[1], items[2]]);
  const host = censusFor('A', alpha.directory, snap([rec('A', null), rec('C1', 'A', { activity: 'running' })], {}, [{ directory: alpha.directory, state: 'loading' }]));
  const c1 = rosterFor(input({ census: host, facts: planFacts(plan, { state: 'ready', value: d }, plan.sourceId), runs: panel(readOf([])) }))!.featured.find((e) => e.sessionId === 'C1')!;
  assert.deepEqual([c1.ran.kind, c1.ran.label, c1.accepted?.tasks.length], ['unknown', 'Current activity unavailable', 2]);
});

test('coverage gate: a same-subscription reload of a complete snapshot stays current; loss, incomplete retained rows and failed reload coverage do not', async () => {
  const { ws, emit, roster } = await oneSubscription();
  const live = run('running', { childSessionId: 'K1' });
  const look = () => { const r = roster([live]); return { waiting: r.summary.some((x) => x.kind === 'waiting'), note: r.notes.some((n) => n.kind === 'host-activity-unavailable'), ran: [...r.featured, ...r.earlier].find((e) => e.runId === live.id)!.ran }; };
  emit('waiting-question');
  assert.deepEqual([look().waiting, look().note], [true, false]);
  // The host's periodic loading → ready reload of the same subscription: rows kept from a complete
  // ready snapshot stay current, with no note; then the ready snapshot arrives as usual.
  emit('waiting-question', null, 'loading');
  assert.deepEqual([look().waiting, look().note, look().ran.label], [true, false, 'Waiting for an answer'], 'no flicker on a periodic reload');
  emit('waiting-question');
  assert.deepEqual([look().waiting, look().note], [true, false]);
  // A reload reporting a failed directory is loss: withheld and disclosed; recorded Running stays.
  emit('waiting-question', null, 'loading', 'error');
  assert.deepEqual([look().waiting, look().note, look().ran.label], [false, true, 'Running']);
  // A ready snapshot that is itself incomplete, and a reload of it, are gated too.
  emit('waiting-question', null, 'ready', 'loading');
  assert.deepEqual([look().waiting, look().note], [false, true]);
  emit('waiting-question', null, 'loading');
  assert.deepEqual([look().waiting, look().note], [false, true], 'retained rows of an incomplete snapshot are not current');
  // A refused stream shows no rows at all, so nothing current.
  emit('waiting-question', null, 'error', 'error');
  assert.equal(look().waiting, false);
  ws.dispose();
});

test('coverage gate: a new subscription has no current activity until its first complete ready snapshot', async () => {
  const { ws, emit, roster } = await oneSubscription();
  const live = run('running', { childSessionId: 'K1' });
  emit('waiting-question', null, 'loading');
  const r = roster([live]);
  assert.ok(!r.summary.some((x) => x.kind === 'waiting'));
  assert.equal([...r.featured, ...r.earlier].find((e) => e.runId === live.id)!.ran.label, 'Running');
  emit('waiting-question');
  assert.ok(roster([live]).summary.some((x) => x.kind === 'waiting'));
  ws.dispose();
});

/** A controller over a fake service whose reconcile POSTs answer from `posts` (last one repeats). */
function historyHarness(posts: { status: number; error?: string }[]) {
  const sent: string[] = [];
  const base = readOf([run('succeeded')], {}, { recovery: { state: 'not-requested', reason: null, token: null }, coverage: { scope: 'retained', complete: false, reasons: ['history-not-reconciled'] } });
  const request: RunRequest = { storeId: base.storeId, binding: base.sourceBinding, source: base.source, root: base.root, plan: base.plan!, cleanupRev: 0, view: 'useful' };
  let i = 0;
  const host = { serviceRequest: async (q: any) => {
    sent.push(q.method);
    if (q.method !== 'POST') return { status: 200, body: JSON.stringify(base) };
    const p = posts[Math.min(i++, posts.length - 1)];
    return p.status === 200 ? { status: 200, body: JSON.stringify({ state: 'pending', coalesced: false }) } : { status: p.status, body: JSON.stringify({ error: p.error }) };
  } };
  const flush = async () => { for (let k = 0; k < 8; k++) await new Promise<void>((r) => setImmediate(r)); };
  const ctl = new RunsController({ service: () => host, visible: () => true, changed: () => {} });
  const claim = { owner: 'o', request, capable: true, captureEnabled: true };
  const paint = () => { ctl.beginPaint(); const p = ctl.claim(claim); ctl.endPaint(); return p; };
  const poll = async () => { ctl.poll(); await flush(); };
  const posted = () => sent.filter((m) => m === 'POST').length;
  return { paint, poll, posted, flush };
}
const notesOf = (p: RunsPanel) => rosterFor(input({ runs: p }))!.notes.map((n) => n.kind);

test('history request: a transient failure of the automatic request is retried on later polls (backed off), then never repeated', async () => {
  const h = historyHarness([{ status: 503, error: 'busy' }, { status: 200 }]);
  h.paint(); await h.flush();
  assert.equal(h.posted(), 1, 'the first automatic request');
  await h.poll();
  assert.equal(h.posted(), 1, 'backed off: not on the very next poll');
  await h.poll();
  assert.equal(h.posted(), 2, 'retried on a later poll');
  for (let k = 0; k < 6; k++) await h.poll();
  assert.equal(h.posted(), 2, 'a successful retry is never repeated, even while the server still says not requested');
  assert.ok(!notesOf(h.paint()).includes('history-request-failed'));
});

test('history request: bounded automatic retries, then the manual Retry; a non-transient failure surfaces it at once', async () => {
  const busy = historyHarness([{ status: 503, error: 'busy' }]);
  busy.paint(); await busy.flush();
  for (let k = 0; k < 20; k++) await busy.poll();
  assert.equal(busy.posted(), 3, 'at most three automatic attempts');
  let p = busy.paint();
  assert.ok(notesOf(p).includes('history-request-failed'), 'exhausted: the manual Retry is offered');
  p.retryHistory(); await busy.flush();
  assert.equal(busy.posted(), 4, 'Retry sends exactly one request');
  for (let k = 0; k < 6; k++) await busy.poll();
  assert.equal(busy.posted(), 4, 'no automatic requests after exhaustion');
  assert.ok(notesOf(busy.paint()).includes('history-request-failed'), 'a failed Retry keeps it available');

  const invalid = historyHarness([{ status: 400, error: 'invalid' }]);
  invalid.paint(); await invalid.flush();
  for (let k = 0; k < 6; k++) await invalid.poll();
  assert.equal(invalid.posted(), 1, 'no automatic retry of a non-transient failure');
  assert.ok(notesOf(invalid.paint()).includes('history-request-failed'));

  // A successful manual Retry clears the offer.
  const once = historyHarness([{ status: 400, error: 'invalid' }, { status: 200 }]);
  once.paint(); await once.flush();
  p = once.paint(); p.retryHistory(); await once.flush();
  assert.equal(once.posted(), 2);
  assert.ok(!notesOf(once.paint()).includes('history-request-failed'));
});

test('summary: a host-listed child that may be an unpaged recorded child is never counted again', () => {
  const kids = Array.from({ length: 51 }, (_, i) => `K${i}`);
  const rows = kids.map((k) => run('running', { childSessionId: k }));
  const read = readOf(rows.slice(0, 50), { running: 51, runs: 51, children: 51 }, { nextCursor: 'next' });
  const census = (last: LiveSession['activity']) => censusFor('A', alpha.directory, snap([rec('A', null), ...kids.map((k, i) => rec(k, 'A', { activity: i === 50 ? last : 'running' }))]));
  const texts = (r: ReturnType<typeof rosterFor>) => r!.summary.map((s) => s.text);
  // First page only: K50 is recorded but not loaded, so the host row must not add a 52nd.
  const first = rosterFor(input({ census: census('running'), runs: panel(read, [], { hasMore: true }) }))!;
  assert.deepEqual(texts(first), ['51 running']);
  // Loading the remaining row changes nothing, because no activity changed.
  assert.deepEqual(texts(rosterFor(input({ census: census('running'), runs: panel(read, [rows[50]]) }))), ['51 running']);
  // Waiting on an unloaded child: listed (waiting first) but not counted twice; once loaded it is
  // counted once, as waiting, and not also as running.
  const unloaded = rosterFor(input({ census: census('waiting-question'), runs: panel(read, [], { hasMore: true }) }))!;
  assert.equal(unloaded.featured[0].sessionId, 'K50', 'still shown, first');
  assert.deepEqual(texts(unloaded), ['51 running'], 'not added to any count while it may be recorded');
  assert.deepEqual(texts(rosterFor(input({ census: census('waiting-question'), runs: panel(read, [rows[50]]) }))), ['1 waiting on you', '50 running']);
  // Every recorded child loaded: a host-only child really is unrecorded and is counted (once).
  const extra = censusFor('A', alpha.directory, snap([rec('A', null), rec('K0', 'A', { activity: 'running' }), rec('X1', 'A', { activity: 'running' }), rec('X2', 'A', { activity: 'waiting-permission' })]));
  assert.deepEqual(texts(rosterFor(input({ census: extra, runs: panel(readOf([rows[0]])) }))), ['1 waiting on you', '2 running']);
});
