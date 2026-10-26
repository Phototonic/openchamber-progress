import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { HostClient } from '@openchamber/sdk';
import { EMPTY_LIVE, LiveWorkspace, coverageFor, liveLabel, type KnownWorktree, type LiveSnapshot } from '../../ui/shared/live.ts';
import { applyFilters, filterOptions, NO_FILTERS, placeOf, projectsFor } from '../../ui/shared/scope.ts';
import { parsePlansPage } from '../../ui/shared/adapter.ts';
import { plansPage, summary } from './fixtures.ts';

const home = { id: 'path_home', name: 'Home', directory: '/synthetic/home' };
const a = { id: 'path_a', name: 'Project A', directory: '/synthetic/home/projects/a' };
const b = { id: 'path_b', name: 'Project B', directory: '/synthetic/home/projects/b' };
const projects = [home, a, b];
const wa: KnownWorktree = { directory: '/synthetic/home/worktrees/a/topic', name: 'Feature A', branch: 'topic', status: 'ready' };
const wb: KnownWorktree = { ...wa, directory: '/synthetic/home/worktrees/b/topic', name: 'Feature B' };
const plans = parsePlansPage(JSON.stringify(plansPage([
  summary('main', [], { sessionId: 'main', directory: a.directory, projectId: 'repo_a' }),
  summary('work-a', [], { sessionId: 'work-a', directory: wa.directory, projectId: 'repo_a' }),
  summary('work-b', [], { sessionId: 'work-b', directory: wb.directory, projectId: 'repo_b' }),
]))).data;
const snap = (): LiveSnapshot => ({ ...EMPTY_LIVE, projectsState: 'ready', projects, sessions: new Map(), worktrees: new Map([
  [home.id, { state: 'ready', records: [] }], [a.id, { state: 'ready', records: [wa] }], [b.id, { state: 'ready', records: [wb] }],
]) });
const flush = () => new Promise<void>((r) => setImmediate(r));

test('external worktrees use SDK ownership for groups, filters AND subscription bootstrap, not repository-ID equality or Home containment', () => {
  const live = snap();
  assert.deepEqual(plans.map((p) => placeOf(p, live).projectKey), ['p:path_a', 'p:path_a', 'p:path_b']);
  assert.deepEqual(projectsFor(plans, live, wb.directory), [b.id, a.id]);
  assert.equal(placeOf(plans[0], live).worktreeLabel, 'Main checkout');
  assert.equal(placeOf(plans[1], live).worktreeLabel, 'Feature A');
  const options = filterOptions(plans, live, NO_FILTERS);
  assert.deepEqual(options.projects.map((p) => p.label), ['All projects', 'Project A', 'Project B']);
  assert.deepEqual(applyFilters(plans, live, { ...NO_FILTERS, project: 'p:path_a', worktree: `w:${wa.directory}` }).map((p) => p.id), ['work-a']);
});

test('unknown, pending, missing, invalid, failed and ambiguous discovery never invent Home ownership', () => {
  for (const status of ['pending', 'missing', 'invalid'] as const) {
    const live = snap(); live.worktrees.set(a.id, { state: 'ready', records: [{ ...wa, status }] });
    assert.equal(placeOf(plans[1], live).projectKey, `d:${wa.directory}`);
    assert.deepEqual(projectsFor([plans[1]], live), []);
  }
  for (const state of ['loading', 'error'] as const) {
    const live = snap(); live.worktrees.set(a.id, { state, records: [wa] });
    assert.equal(placeOf(plans[1], live).projectKey, `d:${wa.directory}`);
    assert.equal(coverageFor('work-a', wa.directory, live).kind, state);
  }
  const live = snap(); live.worktrees.delete(a.id);
  assert.equal(liveLabel(coverageFor('work-a', wa.directory, live)).label, 'Live state unavailable');
  live.worktrees.set(a.id, { state: 'ready', records: [wa] });
  live.worktrees.set(b.id, { state: 'ready', records: [wa, wb] });
  assert.equal(placeOf(plans[1], live).projectKey, `d:${wa.directory}`);
  assert.deepEqual(projectsFor([plans[1]], live), []);
});

function harness(max = 16) {
  const active = new Map<number, string>();
  const calls: { kind: string; id: string; cb: (s: any) => void }[] = [];
  let peak = 0, seq = 0;
  const subscribe = (kind: string, id: string, cb: (s: any) => void) => {
    const key = ++seq; active.set(key, `${kind}:${id}`); peak = Math.max(peak, active.size);
    calls.push({ kind, id, cb });
    return Promise.resolve(() => { active.delete(key); });
  };
  const host = {
    onProjects: (cb) => subscribe('projects', '', cb),
    onWorktrees: (id, cb) => subscribe('worktrees', id, cb),
    onSessions: (id, cb) => subscribe('sessions', id, cb),
  } satisfies Pick<HostClient, 'onProjects' | 'onWorktrees' | 'onSessions'>;
  const ws = new LiveWorkspace(host, max, () => {});
  const emit = (kind: string, id: string, value: object) => {
    const call = calls.findLast((c) => c.kind === kind && c.id === id);
    assert.ok(call, `${kind}:${id} subscribed`); call.cb(value);
  };
  const trees = (id: string, records: KnownWorktree[], state = 'ready') => emit('worktrees', id, { state, worktrees: records });
  return { ws, calls, active, emit, trees, get peak() { return peak; } };
}

test('membership arrives without new reports, updates/removes, selects only owning session streams and ignores retired callbacks', async () => {
  const h = harness(); h.ws.start(); await flush();
  h.emit('projects', '', { state: 'ready', projects }); await flush();
  h.ws.want(projectsFor(plans, h.ws.snapshot)); await flush();
  assert.deepEqual([...h.active.values()].filter((s) => s.startsWith('sessions:')), ['sessions:path_a']);
  h.trees(home.id, []); h.trees(a.id, [wa]); h.trees(b.id, [wb]); await flush();
  h.ws.want(projectsFor(plans, h.ws.snapshot)); await flush();
  assert.deepEqual(projectsFor(plans, h.ws.snapshot), [a.id, b.id]);
  assert.equal(placeOf(plans[2], h.ws.snapshot).projectLabel, b.name);
  const oldSession = h.calls.findLast((c) => c.kind === 'sessions' && c.id === b.id)!;
  const record = { id: 'work-b', title: 'External B', projectId: b.id, directory: wb.directory, parentId: null, archivedAt: null, worktree: wb, activity: 'idle' as const, outcome: null };
  oldSession.cb({ state: 'ready', sessions: [record] });
  assert.equal(coverageFor('work-b', wb.directory, h.ws.snapshot).kind, 'live');
  assert.equal(liveLabel(coverageFor('work-b', wb.directory, h.ws.snapshot)).label, 'Idle');
  assert.deepEqual(projectsFor([plans[2]], h.ws.snapshot), [b.id]);
  h.trees(b.id, []); h.ws.want(projectsFor(plans, h.ws.snapshot)); await flush();
  oldSession.cb({ state: 'ready', sessions: [{ id: 'work-b', projectId: b.id }] });
  assert.equal(placeOf(plans[2], h.ws.snapshot).projectKey, `d:${wb.directory}`);
  assert.ok(!h.ws.snapshot.sessions.has(b.id));
  h.trees(a.id, [wa, wb]); h.ws.want(projectsFor(plans, h.ws.snapshot)); await flush();
  assert.equal(placeOf(plans[2], h.ws.snapshot).projectLabel, a.name);
  const oldTree = h.calls.find((c) => c.kind === 'worktrees' && c.id === a.id)!;
  const oldProjects = h.calls[0];
  h.ws.restart();
  assert.equal(h.ws.snapshot.worktrees.size, 0);
  oldTree.cb({ state: 'ready', worktrees: [wa] }); oldProjects.cb({ state: 'ready', projects });
  assert.equal(h.ws.snapshot.projects.length, 0);
  await flush(); h.emit('projects', '', { state: 'ready', projects: [home] }); await flush();
  assert.equal(placeOf(plans[1], h.ws.snapshot).projectKey, `d:${wa.directory}`);
  h.ws.dispose(); await flush(); assert.equal(h.active.size, 0);
  h.emit('projects', '', { state: 'ready', projects }); await flush(); assert.equal(h.active.size, 0);
});

test('project removal and discovery cap keep unknown ownership honest; total host subscriptions never exceed 32', async () => {
  const h = harness(); h.ws.start(); await flush();
  const many = Array.from({ length: 40 }, (_, i) => ({ id: `p${i}`, name: `Project ${i}`, directory: `/synthetic/p${i}` }));
  h.emit('projects', '', { state: 'ready', projects: many });
  h.ws.want(many.map((p) => p.id)); await flush();
  assert.equal(h.ws.subscriptionCount, 32); assert.equal(h.peak, 32);
  assert.equal(h.ws.snapshot.worktrees.size, 15); assert.equal(h.ws.snapshot.capped.length, 24);
  const retired = h.calls.find((c) => c.kind === 'worktrees' && c.id === 'p0')!;
  h.emit('projects', '', { state: 'ready', projects: many.slice(20) }); await flush();
  retired.cb({ state: 'ready', worktrees: [wa] });
  assert.ok(!h.ws.snapshot.worktrees.has('p0')); assert.ok(h.peak <= 32);
  h.ws.restart(); await flush(); h.emit('projects', '', { state: 'ready', projects: many }); await flush();
  assert.ok(h.peak <= 32);
  h.ws.dispose(); await flush(); assert.equal(h.active.size, 0);
});

test('rejected discovery is an unavailable state; late project rejection after restart cannot overwrite new coverage', async () => {
  let rejectOld!: (e: Error) => void;
  let cb!: (s: any) => void;
  let n = 0;
  const host = {
    onProjects: (next: (s: any) => void) => { cb = next; return ++n === 1 ? new Promise<() => void>((_, reject) => { rejectOld = reject; }) : Promise.resolve(() => {}); },
    onWorktrees: async () => { throw new Error('unavailable'); },
    onSessions: async () => () => {},
  };
  const ws = new LiveWorkspace(host, 2, () => {}); ws.start(); await flush();
  cb({ state: 'ready', projects }); await flush();
  assert.equal(coverageFor('work-a', wa.directory, ws.snapshot).kind, 'error');
  ws.restart(); rejectOld(new Error('retired')); await flush();
  cb({ state: 'ready', projects: [a] }); await flush();
  assert.equal(ws.snapshot.projectsState, 'ready'); assert.deepEqual(ws.snapshot.projects, [a]);
  ws.dispose(); await flush();
});

test('late worktree subscriptions release on dispose and cannot repopulate retired membership', async () => {
  let project!: (s: any) => void, tree!: (s: any) => void, resolve!: (u: () => void) => void;
  let released = 0;
  const ws = new LiveWorkspace({
    onProjects: async (cb) => { project = cb; return () => {}; },
    onWorktrees: (_id, cb) => { tree = cb; return new Promise((r) => { resolve = r; }); },
    onSessions: async () => () => {},
  }, 16, () => {});
  ws.start(); await flush(); project({ state: 'ready', projects: [a] }); await flush();
  ws.dispose(); tree({ state: 'ready', worktrees: [wa] }); resolve(() => { released++; }); await flush();
  assert.equal(released, 1); assert.equal(ws.snapshot.worktrees.size, 0); assert.equal(ws.subscriptionCount, 0);
});
