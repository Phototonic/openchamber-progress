// Sub-agent census and observation logic over synthetic workspace snapshots (not native-host proof:
// U1's feasibility evidence covers real SDK records; rendered behaviour is subagent-activity-qa.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { HostClient } from '@openchamber/sdk';
import { EMPTY_LIVE, LiveWorkspace, type LiveSession, type LiveSnapshot } from '../../ui/shared/live.ts';
import { assignmentOf, censusFor, CENSUS_LIMITS, currentFor, FRESH_MS, isComplete, observe, planFacts, updateOf, type Census } from '../../ui/shared/census.ts';
import { parsePlanPage, parsePlansPage } from '../../ui/shared/adapter.ts';
import { participantIndex, type PlanDetail } from '../../ui/shared/model.ts';
import { at, planPage, plansPage, summary } from './fixtures.ts';

const alpha = { id: 'proj-alpha', name: 'Alpha', directory: '/fixture/Alpha' };
const beta = { id: 'proj-beta', name: 'Beta', directory: '/fixture/Beta' };
const rec = (id: string, parentId: string | null, extra: Partial<LiveSession> = {}): LiveSession => ({
  id, title: `Title ${id}`, projectId: alpha.id, directory: alpha.directory, parentId, archivedAt: null, worktree: null,
  activity: 'idle', outcome: null, seenAt: Date.parse(at(0)), seenMono: 1000, ...extra,
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

test('observation: words per state, completed turn is not success, 60 s expiry and lost currency are unknown', () => {
  const running = observe({ activity: 'running', outcome: null, seenMono: 1000 }, 1000 + FRESH_MS - 1, true);
  assert.deepEqual(running, { kind: 'active', label: 'Running', fresh: true, last: null, expiresAt: 1000 + FRESH_MS });
  assert.deepEqual(observe({ activity: 'running', outcome: null, seenMono: 1000 }, 1000 + FRESH_MS, true), { kind: 'unknown', label: 'Unknown now', fresh: false, last: 'Running', expiresAt: null });
  assert.equal(observe({ activity: 'running', outcome: null, seenMono: 1000 }, 1001, false).label, 'Unknown now');
  assert.equal(observe({ activity: 'idle', outcome: 'completed', seenMono: 1000 }, 1001, true).label, 'Turn ended');
  assert.equal(observe({ activity: 'idle', outcome: 'failed', seenMono: 1000 }, 1001, true).label, 'Turn failed');
  assert.equal(observe({ activity: 'waiting-question', outcome: null, seenMono: 1000 }, 1001, true).label, 'Waiting for an answer');
  assert.equal(observe({ activity: 'unknown', outcome: null, seenMono: 1000 }, 1001, true).label, 'State unknown');
  assert.equal(observe({ activity: 'running', outcome: null }, 1001, true).fresh, false);
  for (const o of [observe({ activity: 'idle', outcome: 'completed', seenMono: 0 }, 1, true)]) assert.doesNotMatch(o.label, /success|complete|done/i);
});

test('LiveWorkspace receipts: only a changed activity/outcome renews a session; restart starts again', async () => {
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
  const seen = (id: string) => ws.snapshot.sessions.get(alpha.id)!.records.find((r) => r.id === id)!.seenMono!;
  emit([raw('A', 'idle'), raw('C1', 'running'), raw('C2', 'running')]);
  const first = seen('C1');
  await new Promise((r) => setTimeout(r, 5));
  emit([raw('A', 'idle'), raw('C1', 'running', { title: 'Renamed' }), raw('C2', 'running')]);
  assert.equal(seen('C1'), first, 'a title-only update is not an observation');
  emit([raw('A', 'idle'), raw('C1', 'running'), raw('C2', 'idle', { outcome: 'failed' })]);
  assert.equal(seen('C1'), first, 'another child changing does not refresh C1');
  assert.ok(seen('C2') > first);
  emit([raw('A', 'idle'), raw('C1', 'idle', { outcome: 'completed' }), raw('C2', 'idle', { outcome: 'failed' })]);
  assert.ok(seen('C1') > first);
  assert.deepEqual(ws.snapshot.sessions.get(alpha.id)!.coverage, [{ directory: alpha.directory, state: 'ready' }]);
  ws.restart(); await flush();
  assert.equal(ws.snapshot.sessions.size, 0, 'restart drops receipts until fresh host snapshots arrive');
  ws.dispose();
});

test('periodic loading → ready reloads of the same subscription never renew; expiry fires at 60 s; a real change renews', async () => {
  // Fake clocks (the native host reloads the same stream about every 45 s with unchanged values).
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
    const raw = (id: string, parentId: string | null, activity: string) => ({ id, title: id, projectId: alpha.id, directory: alpha.directory, parentId, createdAt: 1, updatedAt: 1, archivedAt: null, worktree: null, activity, outcome: null, items: [] });
    const ready = [{ directory: alpha.directory, state: 'ready' }];
    const emit = (state: string, c1 = 'idle', coverage: object[] = ready) => calls.findLast((c) => c.kind === 'sessions')!.cb({ kind: 'sessions', projectId: alpha.id, state, coverage, sessions: state === 'ready' ? [raw('A', null, 'idle'), raw('C1', 'A', c1)] : [] });
    const reload = (c1 = 'idle') => { emit('loading', c1, [{ directory: alpha.directory, state: 'loading' }]); emit('ready', c1); };
    const c1Now = () => {
      const c = censusFor('A', alpha.directory, ws.snapshot);
      assert.equal(c.state, 'ready');
      const r = (c as Extract<Census, { state: 'ready' }>).rows.find((x) => x.id === 'C1')!;
      return observe(r, clock, currentFor(c));
    };
    emit('ready');
    const start = clock;
    assert.equal(c1Now().fresh, true);
    clock = start + 45_000; emit('loading', 'idle', [{ directory: alpha.directory, state: 'loading' }]);
    // While the reload is loading, the rows stay listed (no flicker to "Checking…") but nothing is current.
    assert.deepEqual(censusFor('A', alpha.directory, ws.snapshot).state, 'ready');
    assert.equal(c1Now().fresh, false);
    emit('ready');
    assert.equal(ws.snapshot.sessions.get(alpha.id)!.records.find((r) => r.id === 'C1')!.seenMono, start, 'unchanged reload keeps the receipt');
    assert.equal(c1Now().fresh, true);
    clock = start + FRESH_MS - 1; assert.equal(c1Now().fresh, true);
    clock = start + FRESH_MS; assert.equal(c1Now().label, 'Unknown now', 'expiry fires at 60 s despite the reload');
    clock = start + 90_000; reload();
    clock = start + 135_000; reload();
    clock = start + 150_000;
    assert.deepEqual(c1Now(), { kind: 'unknown', label: 'Unknown now', fresh: false, last: 'Idle', expiresAt: null }, 'still unknown after 150 s of reloads');
    // An error phase on the same subscription is not an observation either.
    emit('error'); assert.equal(censusFor('A', alpha.directory, ws.snapshot).state, 'unavailable');
    clock = start + 155_000; emit('ready'); assert.equal(c1Now().fresh, false);
    // A genuine change renews; a reload carrying the changed value afterwards does not renew again.
    clock = start + 160_000; reload('running');
    assert.equal(c1Now().label, 'Running');
    clock = start + 200_000; reload('running');
    clock = start + 160_000 + FRESH_MS; assert.equal(c1Now().label, 'Unknown now');
    // A new subscription (restart / context change) observes again from its first snapshot.
    ws.restart(); await flush();
    calls.findLast((c) => c.kind === 'projects')!.cb({ state: 'ready', projects: [alpha] }); await flush();
    ws.want([alpha.id]); await flush();
    emit('ready', 'running');
    assert.equal(c1Now().fresh, true);
    ws.dispose();
  } finally { performance.now = realNow; Date.now = realDate; }
});

// Recorded facts from the plan shown: a frozen v2 detail with one assigned, one relayed, one bound.
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

test('assignment, update and observation stay separate facts; unknown detail is never unassigned', () => {
  const d = detail([{ ...items[0], assignmentBinding: binding('task-1') }, items[1], items[2]]);
  const facts = planFacts(plan, { state: 'ready', value: d });
  assert.deepEqual(assignmentOf('C1', facts), { state: 'assigned', count: 2, fromDelegation: 1 });
  assert.deepEqual(assignmentOf('C2', facts), { state: 'unassigned' });
  assert.deepEqual(updateOf('C2', facts), { state: 'relayed', at: at(1) });
  assert.deepEqual(updateOf('C1', facts), { state: 'none' });
  assert.deepEqual(assignmentOf('C2', planFacts(plan, { state: 'loading' })), { state: 'unknown' });
  assert.deepEqual(assignmentOf('C2', planFacts(plan, { state: 'ready', value: { ...d, revision: 2 } })), { state: 'unknown' }, 'a lagging revision is not complete');
  assert.deepEqual(assignmentOf('C2', planFacts(null, null)), { state: 'no-plan' });
  // Observation never adds a participant: the filter index is built from recorded facts only.
  assert.deepEqual(participantIndex(plan, d).sessions, ['A', 'C1', 'C2']);
});

test('adapter keeps only current, matching delegation provenance; absence still shows the assignment', () => {
  const kept = detail([{ ...items[0], assignmentBinding: binding('task-1') }, items[1], items[2]]);
  assert.equal(kept.items[0].delegation?.childSessionId, 'C1');
  assert.equal(kept.items[0].assigneeSessionId, 'C1');
  for (const bad of [binding('task-1', { validAtRevision: 2 }), binding('task-1', { childSessionId: 'C2' }), binding('task-1', { coordinatorSessionId: 'B' }), binding('task-2'), binding('task-1', { prompt: 'x' }), binding('task-1', { boundRevision: 4 }), 'nonsense']) {
    const d = detail([{ ...items[0], assignmentBinding: bad }, items[1], items[2]]);
    assert.equal(d.items[0].delegation, undefined, JSON.stringify(bad));
    assert.equal(d.items[0].assigneeSessionId, 'C1');
    assert.deepEqual(assignmentOf('C1', planFacts(plan, { state: 'ready', value: d })), { state: 'assigned', count: 2, fromDelegation: 0 });
  }
});
