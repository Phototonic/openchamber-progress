// Sub-agent census, roster and run-read logic over synthetic workspace snapshots and the real-Store
// run fixture (not native-host proof; rendered behaviour is subagent-activity-qa.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { HostClient } from '@openchamber/sdk';
import { EMPTY_LIVE, LiveWorkspace, type LiveSession, type LiveSnapshot } from '../../ui/shared/live.ts';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { stripTypeScriptTypes } from 'node:module';
import { censusFor, CENSUS_LIMITS, currentFor, isComplete, observe, planFacts, type Census } from '../../ui/shared/census.ts';
import { parsePlanPage, parsePlansPage, parseRunRead, parseDismissLossReply } from '../../ui/shared/adapter.ts';
import { participantIndex, type PlanDetail, type PlanView } from '../../ui/shared/model.ts';
import { refreshLabels } from '../../ui/shared/components.ts';
import { RunsController, type RunsPanel } from '../../ui/shared/runs.ts';
import { EARLIER_STEP, ExecutionBaselines, rosterFor, ranOf, type RosterInput } from '../../ui/shared/subagents.ts';
import { cueTone, earlierPager, routineNote } from '../../ui/shared/census-view.ts';
import type { DismissLossReply, DismissLossRequest, RunRead, RunRequest, RunRow } from '../../shared/subagent-runs.ts';
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
test('Russian pager uses its explicit language without changing pagination', () => {
  const roster = { earlier: [], earlierTotal: 21, canPage: true };
  assert.equal(earlierPager(roster, { paging: false, continuation: false }, 0, 5, 'ru'), 'Показать ещё 5');
  assert.equal(earlierPager(roster, { paging: true, continuation: false }, 0, 5, 'ru'), 'Загрузка…');
});

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
  } as RunRow; // `latestForChild` stays unset unless given; readOf marks it as the service would.
}
/**
 * Returns copies with `latestForChild` set where it is unset, as the service marks its retained scope
 * (here: the rows given): one row per child by dispatch over historical, start-or-dispatch, dispatch
 * time, sequence; childless rows false. An explicit mark is kept.
 */
function markLatest(rows: RunRow[]): RunRow[] {
  const key = (r: RunRow) => r.dispatch ? [1, r.ran.startedAt ?? r.dispatch.at, r.dispatch.at, r.ran.sequence ?? -1] : [0, r.ran.endedAt ?? r.ran.updatedAt, 0, -1];
  const cmp = (a: RunRow, b: RunRow) => { const x = key(a), y = key(b); for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };
  const best = new Map<string, RunRow>();
  for (const r of rows) if (r.childSessionId) { const b = best.get(r.childSessionId); if (!b || cmp(r, b) > 0) best.set(r.childSessionId, r); }
  return rows.map((r) => r.latestForChild === undefined ? { ...r, latestForChild: !!r.childSessionId && best.get(r.childSessionId) === r } : r);
}
function readOf(rows: RunRow[], counts: Partial<RunRead['counts']> = {}, extra: Partial<RunRead> = {}): RunRead {
  rows = markLatest(rows);
  // As the service counts them: distinct non-null child IDs (a dispatch without one is no child yet).
  const c = { children: new Set(rows.map((r) => r.childSessionId).filter(Boolean)).size, runs: rows.length, historicalSessions: 0, running: 0, succeeded: 0, failed: 0, interrupted: 0, unknown: 0 };
  for (const r of rows) c[r.ran.state]++;
  return { protocolVersion: 2, schemaVersion: 2, storeId: 'store-1', sourceBinding: { sourceId: plan.sourceId, verified: true }, source: plan.sourceId, root: 'A', plan: plan.id, cleanupRev: 0, view: 'useful', subagentRuns: 1, runFormat: 1, availability: 'ready', readAt: T0 + 200_000, revision: 7,
    capture: { enabled: true, state: 'last-known', loss: false }, recovery: { state: 'complete', reason: null, token: null }, counts: { ...c, ...counts },
    coverage: { scope: 'retained', complete: true, reasons: [] }, data: rows, nextCursor: null, ...extra };
}
const panel = (read: RunRead | null, more: RunRow[] = [], extra: Partial<RunsPanel> = {}): RunsPanel => ({ state: read ? 'ready' : 'unavailable', read, featured: read?.data ?? [], more, hasMore: false, paging: false, pageError: false, shown: 0, reconciling: false, failure: null, historyRequestFailed: false, continuation: false, baselines: new ExecutionBaselines(), showMore() {}, retryHistory() {}, dismissLoss() {}, lossDismissal: 'idle', lossDismissalFailure: null, ...extra });
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

test('Russian run copy keeps times, machine error codes and host evidence unchanged', () => {
  const failed = run('failed', { ran: { errorType: 'SyntheticFailure' } });
  assert.equal(ranOf(failed, null, {}, 'ru').label, 'Ошибка: SyntheticFailure');
  const stopped = run('interrupted', { ran: { interruptionReason: 'user' } });
  assert.equal(ranOf(stopped, null, {}, 'ru').label, 'Прерван: остановлен пользователем');
  const running = run('running');
  const host = { id: 'K', parentId: 'A', depth: 1, title: 'Literal title', activity: 'waiting-permission' as const, outcome: null, archived: false };
  const en = ranOf(running, host), ru = ranOf(running, host, {}, 'ru');
  assert.equal(ru.label, 'Ожидает разрешения');
  assert.equal(ru.time?.prefix, 'начат ');
  assert.deepEqual({ ...ru, label: en.label, time: en.time }, en);
  assert.equal(ru.time?.at, en.time?.at);
  assert.equal(ranOf(running, { ...host, activity: 'idle' }, {}, 'ru').label, 'Выполняется');
});

test('language-only roster paint preserves recorded identity, claimed text, acceptance and counts', () => {
  const child = run('succeeded', { childSessionId: 'C1', description: '<Literal title>', claimed: { oid: 'h-ru', outcome: 'done', summary: '<Literal handoff>', reportedAt: T0 + 126_000, sessionId: 'C1', association: 'execution' } });
  const facts = planFacts(plan, { state: 'ready', value: detail([items[0], items[1]]) }, plan.sourceId);
  const v = input({ facts, runs: panel(readOf([child])) });
  const en = rosterFor(v)!, ru = rosterFor(v, 'ru')!;
  const a = en.featured.find(e => e.sessionId === 'C1')!, b = ru.featured.find(e => e.sessionId === 'C1')!;
  assert.equal(b.ran.label, 'Завершён');
  assert.equal(b.title, '<Literal title>');
  assert.equal(b.claimed?.summary, '<Literal handoff>');
  assert.deepEqual(b.accepted, a.accepted);
  assert.deepEqual(ru.summary.map(({ kind, count }) => [kind, count]), en.summary.map(({ kind, count }) => [kind, count]));
  assert.deepEqual(ru.notes, en.notes);
  assert.equal(ru.earlierTotal, en.earlierTotal);
  assert.equal(b.key, a.key);
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

// Recording-gap protocol and visit races: all service replies are explicitly released, never timed.
function lossRead(sequence = 1, dismissedThrough = 0, age = 0): RunRead {
  return readOf([run('running')], {}, { runFormat: 2, revision: 7 + sequence + dismissedThrough, readAt: T0 + age,
    capture: { enabled: true, state: 'last-known', loss: true, lossNotice: { sequence, dismissedThrough, lastLossAt: sequence ? T0 : null, attention: sequence > dismissedThrough && sequence > 0 && Math.max(0, age) < 86_400_000 } },
    coverage: { scope: 'retained', complete: false, reasons: ['capture-loss'] } });
}
const lossRequest = (r: RunRead): RunRequest => ({ storeId: r.storeId, binding: r.sourceBinding, source: r.source, root: r.root, plan: r.plan!, cleanupRev: r.cleanupRev!, view: 'useful' });
const dismissalRequest = (r: RunRead): DismissLossRequest => { const { storeId, binding, source, root } = lossRequest(r); return { storeId, binding, source, root, observedLossSequence: r.capture.lossNotice!.sequence }; };
function lossAck(r: RunRead, sequence = r.capture.lossNotice!.sequence, coalesced = false): DismissLossReply {
  return { protocolVersion: 2, schemaVersion: 2, runFormat: 2, storeId: r.storeId, sourceBinding: r.sourceBinding, source: r.source, root: r.root, revision: r.revision, readAt: r.readAt, capture: r.capture, acknowledgedLossSequence: sequence, coalesced };
}
const settleLoss = async () => { for (let i = 0; i < 4; i++) await new Promise<void>((resolve) => setImmediate(resolve)); };
function lossHarness(base = lossRead()) {
  const requests: { q: any; resolve: (r: { status: number; body: string }) => void }[] = [];
  let visible = true, paints = 0;
  const ctl = new RunsController({ visible: () => visible, changed: () => { paints++; }, service: () => ({ serviceRequest: (q) => new Promise((resolve) => { requests.push({ q, resolve }); }) }) });
  const claim = { owner: 'account-a', request: lossRequest(base), capable: true, captureEnabled: true };
  const paint = () => { ctl.beginPaint(); const p = ctl.claim(claim); ctl.endPaint(); return p; };
  const take = (method = 'GET') => { const i = requests.findIndex((x) => x.q.method === method); assert.notEqual(i, -1, `expected ${method}`); return requests.splice(i, 1)[0]; };
  const reply = async (held: ReturnType<typeof take>, value: unknown, status = 200) => { held.resolve({ status, body: JSON.stringify(value) }); await settleLoss(); };
  return { ctl, claim, paint, take, reply, requests, paints: () => paints, hide: () => { visible = false; ctl.hidden(); }, show: () => { visible = true; } };
}

test('recording gaps: format-2 metadata is mandatory and internally consistent; legacy absence is not a migrated date', () => {
  const recent = lossRead(), q = lossRequest(recent);
  const parse = (r: RunRead) => parseRunRead(JSON.stringify(r), q);
  assert.deepEqual(parse(recent).capture.lossNotice, recent.capture.lossNotice);
  const badNotices = [undefined, null, { sequence: -1 }, { sequence: 1.5 }, { sequence: Number.MAX_SAFE_INTEGER + 1 },
    { dismissedThrough: 2 }, { dismissedThrough: -1 }, { lastLossAt: -1 }, { lastLossAt: 8_640_000_000_000_001 },
    { lastLossAt: 1.5 }, { lastLossAt: null }, { attention: false }, { attention: 'true' },
    { sequence: 0, lastLossAt: null, dismissedThrough: 1, attention: false }, { sequence: 0, attention: false }];
  for (const bad of badNotices) {
    const r = structuredClone(recent);
    r.capture.lossNotice = bad && typeof bad === 'object' ? { ...r.capture.lossNotice!, ...bad } as any : bad as any;
    assert.throws(() => parse(r), JSON.stringify(bad));
  }
  assert.throws(() => parse({ ...recent, capture: { ...recent.capture, lossNotice: {} as any } }));
  for (const change of [ { runFormat: 1 }, { runFormat: null }, { runFormat: 3 }, { availability: 'unavailable', subagentRuns: null },
    { capture: { ...recent.capture, loss: false } }, { coverage: { scope: 'retained', complete: true, reasons: [] } } ]) {
    assert.throws(() => parse({ ...recent, ...change } as RunRead));
  }
  const none = readOf([]); none.runFormat = 2;
  none.capture.lossNotice = { sequence: 0, lastLossAt: null, dismissedThrough: 0, attention: false };
  assert.equal(parse(none).capture.lossNotice!.sequence, 0);
  const migrated = parse(lossRead(0));
  const legacy = { ...recent, runFormat: 1 as const, capture: { enabled: true, state: 'last-known' as const, loss: true } };
  assert.equal(parse(legacy).capture.lossNotice, undefined);
  for (const [r, dateKind] of [[migrated, 'migrated-unknown'], [parse(legacy), 'legacy-unknown']] as const) {
    const note = rosterFor(input({ runs: panel(r) }))!.notes.find((n) => n.kind === 'capture-loss')!;
    assert.deepEqual(note, { kind: 'capture-loss', lastLossAt: null, dateKind, attention: false, canDismiss: false });
  }
  const unavailable = { ...none, runFormat: null, subagentRuns: null, availability: 'unavailable', capture: { enabled: true, state: 'unavailable', loss: false } } as RunRead;
  assert.equal(parse(unavailable).availability, 'unavailable');
  assert.throws(() => parse({ ...unavailable, runFormat: 2 }));
});

test('the unmodified preceding guest adapter accepts new-service format-2 replies and retains permanent loss', async () => {
  // The released adapter is byte-identical to the pre-format-2 adapter, unlike the unavailable feature commit.
  const source = execFileSync('git', ['show', 'refs/tags/v1.0.0:ui/shared/adapter.ts'], { encoding: 'utf8' });
  const js = stripTypeScriptTypes(source).replace(/from '(\.[^']+)'/g, (_match, specifier) => `from '${new URL(specifier, new URL('../../ui/shared/adapter.ts', import.meta.url)).href}'`);
  const oldGuest = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
  for (const r of [lossRead(), lossRead(1, 1), lossRead(0)]) {
    const read = oldGuest.parseRunRead(JSON.stringify(r), lossRequest(r));
    assert.equal(read.capture.loss, true); assert.equal(read.coverage.complete, false);
    assert.ok(read.coverage.reasons.includes('capture-loss'));
  }
});

test('recording gaps: attention follows server readAt across the 24-hour boundary and reversed time, not browser Date.now', () => {
  const original = Date.now; Date.now = () => T0 + 999 * 86_400_000;
  try {
    for (const [age, attention] of [[-1, true], [86_399_999, true], [86_400_000, false]] as const) {
      const r = lossRead(1, 0, age), parsed = parseRunRead(JSON.stringify(r), lossRequest(r));
      const note = rosterFor(input({ runs: panel(parsed) }))!.notes.find((n) => n.kind === 'capture-loss')!;
      assert.equal(note.attention, attention); assert.equal(note.canDismiss, attention);
      assert.equal(note.lastLossAt, T0); assert.equal(note.dateKind, 'known');
      assert.equal(parsed.coverage.complete, false);
    }
    const dismissed = lossRead(1, 1, -1);
    assert.equal(parseRunRead(JSON.stringify(dismissed), lossRequest(dismissed)).capture.lossNotice!.attention, false);
  } finally { Date.now = original; }
});

test('recording-gap acknowledgements: validate identity, fence, state, attention and envelope instead of trusting HTTP success', () => {
  const r = lossRead(1, 1), q = dismissalRequest(r), ack = lossAck(r);
  const parse = (v: unknown) => parseDismissLossReply(JSON.stringify(v), q);
  assert.deepEqual(parse(ack), ack);
  for (const change of [{ protocolVersion: 1 }, { schemaVersion: 1 }, { runFormat: 1 }, { storeId: 'other-store' }, { source: 'other-source' },
    { root: 'other-root' }, { sourceBinding: { ...r.sourceBinding, verified: false } }, { acknowledgedLossSequence: 2 },
    { revision: -1 }, { readAt: 1.5 }, { coalesced: null }, { capture: { ...r.capture, lossNotice: undefined } },
    { capture: { ...r.capture, lossNotice: { ...r.capture.lossNotice!, dismissedThrough: 0, attention: true } } },
    { capture: { ...r.capture, lossNotice: { ...r.capture.lossNotice!, attention: true } } }]) assert.throws(() => parse({ ...ack, ...change }));
  const newer = lossRead(2, 1);
  assert.equal(parse(lossAck(newer, 1, true)).capture.lossNotice!.attention, true, 'a successful duplicate can still warn');
  assert.throws(() => parse(lossAck(newer, 1, false)), 'a non-coalesced acknowledgement cannot claim a newer sequence');
});

test('dismissal immediately applies acknowledged metadata, preserves counts and loss, blocks duplicates and refreshes normally', async () => {
  const base = lossRead(); base.capture.enabled = false;
  const h = lossHarness(base); h.paint(); await h.reply(h.take(), base);
  const before = h.paint(), paints = h.paints();
  before.dismissLoss(); before.dismissLoss();
  assert.equal(h.paint().lossDismissal, 'pending'); assert.ok(h.paints() > paints);
  assert.equal(h.requests.length, 1);
  const post = h.take('POST'); assert.equal(post.q.path, '/v1/subagent-runs/dismiss-loss');
  assert.deepEqual(JSON.parse(post.q.body), dismissalRequest(base)); assert.equal(post.q.query, undefined);
  const dismissed = { ...base, revision: base.revision + 1, capture: { ...base.capture, lossNotice: { ...base.capture.lossNotice!, dismissedThrough: 1, attention: false } } };
  await h.reply(post, lossAck(dismissed));
  const immediate = h.paint();
  assert.equal(immediate.lossDismissal, 'success'); assert.equal(immediate.read!.capture.lossNotice!.attention, false);
  assert.deepEqual(immediate.read!.counts, before.read!.counts); assert.deepEqual(immediate.featured, before.featured);
  assert.equal(immediate.read!.capture.loss, true); assert.equal(immediate.read!.coverage.complete, false);
  assert.ok(notesOf(immediate).includes('capture-loss'));
  assert.equal(h.take().q.method, 'GET', 'ack starts the existing first-page refresh');
  before.dismissLoss(); assert.equal(h.requests.length, 0, 'detached control cannot resubmit');
});

test('dismissal retires held pre-write reads, pages and cursors; a stale read cannot restore attention', async () => {
  const base = lossRead(); base.nextCursor = 'old-cursor';
  const h = lossHarness(base); h.paint(); await h.reply(h.take(), base);
  h.ctl.poll(); const oldRead = h.take();
  h.paint().showMore(0, 0, 10); const oldPage = h.take();
  h.paint().dismissLoss(); const post = h.take('POST');
  assert.equal(h.paint().continuation, false); assert.equal(h.paint().paging, false);
  const dismissed = lossRead(1, 1);
  await h.reply(post, lossAck(dismissed)); const refresh = h.take();
  await h.reply(oldRead, base); await h.reply(oldPage, { ...base, data: [run('succeeded')] });
  assert.equal(h.paint().read!.capture.lossNotice!.attention, false); assert.deepEqual(h.paint().more, []);
  assert.equal(h.paint().continuation, false);
  await h.reply(refresh, base); // even a fresh request answered by an older snapshot cannot roll back revision
  assert.equal(h.paint().read!.revision, dismissed.revision);
});

test('a delayed acknowledgement never suppresses a newer loss already read, including a successful duplicate with attention', async () => {
  for (const duplicate of [false, true]) {
    const base = lossRead(), h = lossHarness(base); h.paint(); await h.reply(h.take(), base);
    h.paint().dismissLoss(); const post = h.take('POST');
    h.ctl.poll(); const newer = lossRead(3, 1); await h.reply(h.take(), newer);
    const ack = duplicate ? lossAck(lossRead(2, 1), 1, true) : lossAck(lossRead(1, 1));
    await h.reply(post, ack);
    assert.equal(h.paint().read!.capture.lossNotice!.sequence, 3);
    assert.equal(h.paint().read!.capture.lossNotice!.attention, true);
    assert.equal(h.paint().lossDismissal, 'idle');
  }
  const base = lossRead(), h = lossHarness(base); h.paint(); await h.reply(h.take(), base);
  h.paint().dismissLoss(); await h.reply(h.take('POST'), lossAck(lossRead(2, 1), 1, true));
  assert.equal(h.paint().read!.capture.lossNotice!.sequence, 2, 'apply a newer successful duplicate without quieting it');
  assert.equal(h.paint().lossDismissal, 'idle');
});

test('at equal revision, a delayed acknowledgement cannot replace a later service observation of attention', async () => {
  const base = lossRead(), h = lossHarness(base); h.paint(); await h.reply(h.take(), base);
  h.paint().dismissLoss(); const post = h.take('POST');
  const newer = lossRead(2, 1, 86_400_000); h.ctl.poll(); await h.reply(h.take(), newer);
  const earlier = { ...newer, readAt: T0, capture: { ...newer.capture, lossNotice: { ...newer.capture.lossNotice!, attention: true } } };
  await h.reply(post, lossAck(earlier, 1, true));
  assert.equal(h.paint().read!.capture.lossNotice!.attention, false);
  assert.equal(h.paint().read!.readAt, newer.readAt);
});

test('dismissal distinguishes stale-sequence conflict, retryable failure and malformed success without hiding loss', async () => {
  for (const [status, value, state] of [[409, { error: 'conflict' }, 'conflict'], [503, { error: 'busy' }, 'error'], [200, {}, 'error']] as const) {
    const base = lossRead(), h = lossHarness(base); h.paint(); await h.reply(h.take(), base);
    h.paint().dismissLoss(); await h.reply(h.take('POST'), value, status);
    assert.equal(h.paint().lossDismissal, state); assert.ok(h.paint().lossDismissalFailure);
    assert.equal(h.paint().read!.capture.lossNotice!.attention, true);
    await h.reply(h.take(), base);
    h.paint().dismissLoss(); assert.equal(h.take('POST').q.method, 'POST', 'explicit retry remains possible');
  }
});

test('store, binding, account, root, absent-section and hidden visits retire dismissal results and detached controls', async () => {
  for (const change of ['store', 'binding', 'account', 'root', 'absent', 'hidden', 'disposed']) {
    const base = lossRead(), h = lossHarness(base); h.paint(); await h.reply(h.take(), base);
    const detached = h.paint(); detached.dismissLoss(); const post = h.take('POST');
    if (change === 'store') h.claim.request = { ...h.claim.request, storeId: 'store-2' };
    if (change === 'binding') h.claim.request = { ...h.claim.request, binding: { sourceId: 'source-2', verified: true } };
    if (change === 'account') h.claim.owner = 'account-b';
    if (change === 'root') h.claim.request = { ...h.claim.request, root: 'B' };
    if (change === 'absent') { h.ctl.beginPaint(); h.ctl.endPaint(); }
    else if (change === 'disposed') h.ctl.retire();
    else if (change === 'hidden') h.hide();
    else h.paint();
    const paints = h.paints();
    await h.reply(post, lossAck(lossRead(1, 1)));
    assert.equal(h.paints(), paints, change);
    if (change === 'hidden') h.show();
    const n = h.requests.length; detached.dismissLoss();
    assert.equal(h.requests.length, n, `${change}: detached action sends nothing`);
    assert.equal(JSON.parse(post.q.body).storeId, base.storeId, 'sent write keeps captured identity');
  }
});

test('legacy and migrated unknown gaps offer no dismissal request; ordinary refresh repaints age-out without revision changes', async () => {
  for (const r of [lossRead(0), { ...lossRead(), runFormat: 1 as const, capture: { enabled: true, state: 'last-known' as const, loss: true } }]) {
    const h = lossHarness(r); h.paint(); await h.reply(h.take(), r);
    h.paint().dismissLoss(); assert.equal(h.requests.length, 0);
  }
  const recent = lossRead(1, 0, 86_399_999), h = lossHarness(recent); h.paint(); await h.reply(h.take(), recent);
  const paints = h.paints(); h.ctl.poll(); const old = { ...recent, readAt: T0 + 86_400_000, capture: { ...recent.capture, lossNotice: { ...recent.capture.lossNotice!, attention: false } } };
  await h.reply(h.take(), old);
  assert.ok(h.paints() > paints); assert.equal(h.paint().read!.revision, recent.revision);
  assert.equal(h.paint().read!.capture.lossNotice!.attention, false);
});

test('an unchanged poll keeps the painted dismissal usable, but a newer detection or a replacement paint retires that control', async () => {
  for (const change of ['identical-poll', 'new-loss', 'replacement-paint']) {
    const base = lossRead(), h = lossHarness(base); h.paint(); await h.reply(h.take(), base);
    const control = h.paint();
    if (change === 'replacement-paint') h.paint();
    else {
      const paints = h.paints(); h.ctl.poll();
      await h.reply(h.take(), change === 'new-loss' ? lossRead(2) : { ...base, readAt: base.readAt + 1 });
      if (change === 'identical-poll') assert.equal(h.paints(), paints, 'no repaint for server read time alone');
    }
    control.dismissLoss();
    assert.equal(h.requests.length, change === 'identical-poll' ? 1 : 0, change);
  }
});

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
  const rows = markLatest(kids.map((k) => run('running', { childSessionId: k })));
  const read = readOf(rows.slice(0, 50), { running: 51, runs: 51, children: 51 }, { nextCursor: 'next' });
  const census = (last: LiveSession['activity']) => censusFor('A', alpha.directory, snap([rec('A', null), ...kids.map((k, i) => rec(k, 'A', { activity: i === 50 ? last : 'running' }))]));
  const texts = (r: ReturnType<typeof rosterFor>) => r!.summary.map((s) => s.text);
  // First page only: K50 is recorded but not loaded, so the host row must not add a 52nd.
  const first = rosterFor(input({ census: census('running'), runs: panel(read, [], { hasMore: true }) }))!;
  assert.deepEqual(texts(first), ['51 running']);
  // Loading the remaining row changes nothing: K50 was already in the recorded total.
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

test('host row limit: a truncated host census is disclosed and host-only counts are not presented as complete', () => {
  const kids = (n: number, last: LiveSession['activity']) => [rec('A', null), ...Array.from({ length: n }, (_, i) => rec(`H${i}`, 'A', { createdAt: i, activity: i === n - 1 ? last : 'running' }))];
  const empty = readOf([]);
  const over = rosterFor(input({ census: censusFor('A', alpha.directory, snap(kids(129, 'waiting-question'))), runs: panel(empty) }))!;
  assert.ok(over.notes.some((n) => n.kind === 'host-truncated'), 'the row limit is disclosed');
  assert.equal(over.hostTruncated, true, 'host-only counts are marked incomplete');
  // At the limit exactly: nothing truncated, nothing said.
  const at = rosterFor(input({ census: censusFor('A', alpha.directory, snap(kids(128, 'waiting-question'))), runs: panel(empty) }))!;
  assert.ok(!at.notes.some((n) => n.kind === 'host-truncated'));
  assert.equal(at.hostTruncated, false);
  assert.deepEqual(at.summary.map((s) => s.text), ['1 waiting on you', '127 running']);
});

test('coverage cue: routine notes go behind the rail/board "Partial" cue; unavailability, failures, loading and capture off stay visible', () => {
  const kinds = (r: ReturnType<typeof rosterFor>) => r!.notes.filter(routineNote).map((n) => n.kind);
  const visible = (r: ReturnType<typeof rosterFor>) => r!.notes.filter((n) => !routineNote(n)).map((n) => n.kind);
  const kids = [rec('A', null), ...Array.from({ length: 129 }, (_, i) => rec(`H${i}`, 'A', { createdAt: i, activity: 'running' }))];
  // Storage loss, partly loaded history and a hit host limit: all routine, nothing visible.
  const routine = rosterFor(input({ census: censusFor('A', alpha.directory, snap(kids)), runs: panel(readOf([run('succeeded')], {}, { capture: { enabled: true, state: 'last-known', loss: true }, recovery: { state: 'partial', reason: null, token: 't' } })) }))!;
  assert.deepEqual(kinds(routine), ['capture-loss', 'history-partial', 'host-truncated']);
  assert.deepEqual(visible(routine), []);
  // Capture off and history off: capture off stays a visible line, history off is routine.
  const off = rosterFor(input({ runs: panel(readOf([run('succeeded')], {}, { capture: { enabled: false, state: 'last-known', loss: false }, recovery: { state: 'not-requested', reason: null, token: null } })) }))!;
  assert.deepEqual([visible(off), kinds(off)], [['capture-off'], ['history-off']]);
  // A complete read says nothing: no cue at all.
  assert.deepEqual(rosterFor(input({ runs: panel(readOf([run('succeeded')])) }))!.notes, []);
  // The agreed split for every note kind.
  // Behind the cue nothing is orange: every routine note has the neutral tone.
  for (const kind of ['capture-loss', 'history-partial', 'host-truncated', 'traversal-limit', 'host-gaps', 'history-off'] as const) {
    assert.equal(routineNote({ kind } as Parameters<typeof routineNote>[0]), true, kind);
    assert.equal(cueTone({ kind } as Parameters<typeof cueTone>[0]), 'neutral', kind);
  }
  for (const kind of ['runs-unavailable', 'runs-error', 'history-failed', 'history-request-failed', 'host-activity-unavailable', 'capture-off', 'history-loading', 'history-unavailable'] as const) assert.equal(routineNote({ kind } as Parameters<typeof routineNote>[0]), false, kind);
});

test('recording gap: attention and dismissal come from the service; the gap stays listed, routine and incomplete', () => {
  const at = T0 + 200_000; // readOf's service read time
  const notice = (n: { sequence: number; lastLossAt: number | null; dismissedThrough: number }) => ({ ...n, attention: n.lastLossAt !== null && Math.max(0, at - n.lastLossAt) < 86_400_000 && n.sequence > n.dismissedThrough });
  const read = (format: 1 | 2, n?: Parameters<typeof notice>[0]) => readOf([run('succeeded')], {}, {
    runFormat: format, capture: { enabled: true, state: 'last-known', loss: true, ...(n ? { lossNotice: notice(n) } : {}) },
    coverage: { scope: 'retained', complete: false, reasons: ['capture-loss'] },
  } as Partial<RunRead>);
  const loss = (r: RunRead) => {
    const roster = rosterFor(input({ runs: panel(r) }))!;
    const n = roster.notes.find((x) => x.kind === 'capture-loss');
    assert.ok(n && n.kind === 'capture-loss', 'the gap is always listed while loss is recorded');
    assert.ok(routineNote(n), 'behind the Partial cue, never a visible line');
    return { lastLossAt: n.lastLossAt, dateKind: n.dateKind, attention: n.attention, canDismiss: n.canDismiss, tone: cueTone(n) };
  };
  // Recent and undismissed: warning tone, its stored date, dismissable.
  assert.deepEqual(loss(read(2, { sequence: 3, lastLossAt: at - 60_000, dismissedThrough: 2 })), { lastLossAt: at - 60_000, dateKind: 'known', attention: true, canDismiss: true, tone: 'warning' });
  // Exactly 24 hours old, or dismissed: muted, the same date kept, no control.
  assert.deepEqual(loss(read(2, { sequence: 3, lastLossAt: at - 86_400_000, dismissedThrough: 2 })), { lastLossAt: at - 86_400_000, dateKind: 'known', attention: false, canDismiss: false, tone: 'neutral' });
  assert.deepEqual(loss(read(2, { sequence: 3, lastLossAt: at - 60_000, dismissedThrough: 3 })), { lastLossAt: at - 60_000, dateKind: 'known', attention: false, canDismiss: false, tone: 'neutral' });
  // Migrated before dates were kept, and an older service without the metadata: unknown, muted.
  assert.deepEqual(loss(read(2, { sequence: 0, lastLossAt: null, dismissedThrough: 0 })), { lastLossAt: null, dateKind: 'migrated-unknown', attention: false, canDismiss: false, tone: 'neutral' });
  assert.deepEqual(loss(read(1)), { lastLossAt: null, dateKind: 'legacy-unknown', attention: false, canDismiss: false, tone: 'neutral' });
  // The seam: only an attended gap is orange; every other routine note stays neutral.
  for (const kind of ['history-partial', 'host-truncated', 'traversal-limit', 'host-gaps', 'history-off'] as const) assert.equal(cueTone({ kind } as Parameters<typeof cueTone>[0]), 'neutral');
});

test('pager: stays while a continuation cursor exists, even when the estimate says nothing is left (all surfaces)', () => {
  const kids = Array.from({ length: 51 }, (_, i) => `K${i}`);
  const rows = markLatest(kids.map((k) => run('running', { childSessionId: k })));
  const read = readOf(rows.slice(0, 50), { running: 51, runs: 51, children: 51 }, { nextCursor: 'next' });
  const census = censusFor('A', alpha.directory, snap([rec('A', null), ...kids.map((k) => rec(k, 'A', { activity: 'running' }))]));
  for (const surface of ['panel', 'status', 'page'] as const) {
    const runs = panel(read, [], { hasMore: true, continuation: true });
    const r = rosterFor(input({ surface, census, runs }))!;
    const all = r.earlier.length;
    // Everything loaded is visible: the 51st record exists only behind the cursor.
    assert.ok(earlierPager(r, runs, all, EARLIER_STEP[surface]), `${surface}: pager offered while the cursor exists`);
    // Once nothing more can be read and everything loaded is shown, no pager.
    const done = panel(read, [rows[50]], { hasMore: false, continuation: false });
    const rd = rosterFor(input({ surface, census, runs: done }))!;
    assert.equal(earlierPager(rd, done, rd.earlier.length, EARLIER_STEP[surface]), null, `${surface}: no pager when exhausted`);
  }
});

test('latest run per child: a historical summary\'s later session update never displaces a dispatch record', () => {
  // Resumed child K: dispatch at 5000, proven start at 6000; recovery returned an older outcome
  // (idle at 2000) whose session-wide update time is 9000. The host says K waits for an answer.
  const tasks = { plan: plan.id, revision: 3, items: [{ id: 'task-1', status: 'working' as const }], omittedItems: 0 };
  const live = run('running', { childSessionId: 'K', dispatch: { messageId: 'm', callId: 'c', at: 5000 }, accepted: tasks, ran: { startedAt: 6000, updatedAt: 6000, endedAt: null } });
  const past = run('succeeded', { kind: 'historical-session', childSessionId: 'K', dispatch: null, planContext: null, accepted: tasks, ran: { dispatchState: 'historical', provenance: 'native-session', startedAt: null, endedAt: 2000, updatedAt: 9000 } });
  const census = censusFor('A', alpha.directory, snap([rec('A', null), rec('K', 'A', { activity: 'waiting-question' })]));
  for (const rows of [[live, past], [past, live]]) {
    const r = rosterFor(input({ census, runs: panel(readOf(rows)) }))!;
    const all = [...r.featured, ...r.earlier];
    const cur = all.find((e) => e.runId === live.id)!, hist = all.find((e) => e.runId === past.id)!;
    assert.deepEqual(r.summary.map((s) => s.text), ['1 waiting on you', '1 finished'], 'the dispatch keeps the current waiting state');
    assert.equal(cur.ran.kind, 'waiting');
    assert.ok(cur.accepted, 'task facts stay on the dispatch record');
    assert.equal(hist.accepted, null);
    assert.equal(hist.ran.label, 'Finished', 'the historical row keeps only its own recorded outcome');
  }
  // A historical row is the latest only when no dispatch record exists for that child.
  const alone = rosterFor(input({ census: censusFor('A', alpha.directory, snap([rec('A', null), rec('K', 'A', { activity: 'running' })])), runs: panel(readOf([past])) }))!;
  assert.ok([...alone.featured, ...alone.earlier].find((e) => e.runId === past.id)!.accepted, 'historical row carries the tasks when it is all there is');
  // Between dispatch records, execution evidence decides: a later proven start wins over a later dispatch time.
  const a = run('succeeded', { childSessionId: 'J', dispatch: { messageId: 'm1', callId: 'c1', at: 1000 }, accepted: tasks, ran: { startedAt: 8000, endedAt: 8500, updatedAt: 8500, sequence: 4 } });
  const b = run('unknown', { childSessionId: 'J', dispatch: { messageId: 'm2', callId: 'c2', at: 3000 }, accepted: tasks, ran: { dispatchState: 'returned', startedAt: null, endedAt: null, updatedAt: 3000, sequence: null } });
  const jr = rosterFor(input({ census: censusFor('A', alpha.directory, snap([rec('A', null), rec('J', 'A', { activity: 'idle' })])), runs: panel(readOf([a, b])) }))!;
  const ja = [...jr.featured, ...jr.earlier];
  assert.ok(ja.find((e) => e.runId === a.id)!.accepted && !ja.find((e) => e.runId === b.id)!.accepted, 'the run with the latest execution evidence is the child\'s latest');
});

test('latest run per child: the service\'s latestForChild decides, also when the latest row is on an unloaded page', () => {
  // 50 running records on page 1; a newer succeeded dispatch for K0 sits on page 2. K0 is
  // host-listed waiting for an answer. The service marks rows across the full retained scope.
  const tasks = { plan: plan.id, revision: 3, items: [{ id: 'task-1', status: 'working' as const }], omittedItems: 0 };
  const page1 = Array.from({ length: 50 }, (_, i) => run('running', { childSessionId: `K${i}`, dispatch: { messageId: `m${i}`, callId: `c${i}`, at: 1000 }, accepted: i === 0 ? tasks : null, ran: { startedAt: 1100, endedAt: null, updatedAt: 1100 }, latestForChild: i !== 0 }));
  const newer = run('succeeded', { childSessionId: 'K0', dispatch: { messageId: 'mz', callId: 'cz', at: 5000 }, accepted: tasks, ran: { startedAt: 5100, endedAt: 6000, updatedAt: 6000 }, latestForChild: true });
  const read = readOf(page1, { running: 50, succeeded: 1, runs: 51, children: 50 }, { nextCursor: 'next' });
  const census = censusFor('A', alpha.directory, snap([rec('A', null), ...page1.map((r, i) => rec(r.childSessionId!, 'A', { activity: i === 0 ? 'waiting-question' : 'running' }))]));
  const texts = (p: RunsPanel) => rosterFor(input({ census, runs: p }))!.summary.map((s) => s.text);
  const k0 = (p: RunsPanel) => [...rosterFor(input({ census, runs: p }))!.featured, ...rosterFor(input({ census, runs: p }))!.earlier].filter((e) => e.sessionId === 'K0');
  // Page 1 only: K0's latest is not loaded, so no loaded K0 row gets its host word or tasks.
  const first = panel(read, [], { hasMore: true, continuation: true });
  assert.deepEqual(texts(first), ['50 running', '1 finished'], 'no "waiting on you" from a stale record');
  assert.ok(k0(first).every((e) => e.ran.kind !== 'waiting' && e.accepted === null && e.now === null));
  // Loading page 2 changes nothing at a glance: the summary is the same, and K0's tasks sit on its latest row.
  const both = panel(read, [newer]);
  assert.deepEqual(texts(both), ['50 running', '1 finished']);
  const rows = k0(both);
  assert.ok(rows.find((e) => e.runId === newer.id)!.accepted, 'tasks on the latest row once loaded');
  assert.equal(rows.find((e) => e.runId === page1[0].id)!.accepted, null);
});

test('latest run per child: a payload without latestForChild withholds per-child refinements instead of guessing', () => {
  const tasks = { plan: plan.id, revision: 3, items: [{ id: 'task-1', status: 'working' as const }], omittedItems: 0 };
  // Passed as data directly, past readOf's marking: an older service's row without the field.
  const older = run('running', { childSessionId: 'K', accepted: tasks });
  const r = rosterFor(input({ census: censusFor('A', alpha.directory, snap([rec('A', null), rec('K', 'A', { activity: 'waiting-question' })])), runs: panel({ ...readOf([]), data: [older], counts: { ...readOf([]).counts, running: 1, runs: 1, children: 1 } }) }))!;
  const e = [...r.featured, ...r.earlier].find((x) => x.runId === older.id)!;
  assert.deepEqual([e.ran.kind, e.ran.label, e.accepted], ['active', 'Running', null], 'recorded Running stays; no host word or tasks without the field');
  assert.deepEqual(r.summary.map((s) => s.text), ['1 running']);
  // An inconsistent payload (two rows marked latest for one child) is treated the same way.
  const a = run('running', { childSessionId: 'J', latestForChild: true, accepted: tasks }), b = run('succeeded', { childSessionId: 'J', latestForChild: true, accepted: tasks });
  const rj = rosterFor(input({ census: censusFor('A', alpha.directory, snap([rec('A', null), rec('J', 'A', { activity: 'waiting-question' })])), runs: panel(readOf([a, b])) }))!;
  assert.ok([...rj.featured, ...rj.earlier].filter((x) => x.sessionId === 'J').every((x) => x.accepted === null && x.ran.kind !== 'waiting'));
});
