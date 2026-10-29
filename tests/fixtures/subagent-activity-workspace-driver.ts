/** Real disposable host SDK proof; synthetic native topology, no injected workspace messages. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { networkInterfaces } from 'node:os';
import { OpenCode } from '@opencode/client';
import { startActivityHost } from '../browser/subagent-activity-host.ts';

const root = process.argv[2];
assert.match(root, /^\/tmp\/opencode\/subagent-activity-[A-Za-z0-9]+$/);
assert.notEqual(fs.readlinkSync('/proc/self/ns/net'), process.argv[3]);
assert.deepEqual(Object.keys(networkInterfaces()), ['lo']);
assert.equal(spawnSync('/usr/sbin/ip', ['route', 'show', 'default'], { encoding: 'utf8' }).stdout.trim(), '');
const env = { PATH: '/usr/bin:/bin', HOME: `${root}/home`, XDG_CONFIG_HOME: `${root}/config`, XDG_DATA_HOME: `${root}/data`, XDG_CACHE_HOME: `${root}/cache`, XDG_STATE_HOME: `${root}/state`, XDG_RUNTIME_DIR: `${root}/runtime`, TMPDIR: `${root}/tmp`, OPENCODE_PASSWORD: 'synthetic-local-only', DBUS_SESSION_BUS_ADDRESS: 'disabled:', ACTIVITY_ROOT: root,
  ACTIVITY_WAYLAND_SOCKET: process.env.ACTIVITY_WAYLAND_SOCKET! };
const launch = () => spawn(process.env.OPENCODE_BINARY!, ['serve', '--hostname', '127.0.0.1', '--port', '18767'], { cwd: `${root}/Alpha`, env, stdio: 'ignore' });
let native = launch();
fs.writeFileSync(`${root}/host-pid`, String(native.pid));
const client = OpenCode.make({ baseUrl: 'http://127.0.0.1:18767', headers: { authorization: `Basic ${Buffer.from('opencode:synthetic-local-only').toString('base64')}` } });
const location = { directory: `${root}/Alpha` };
const report: any = { mode: 'workspace', pass: false, isolation: { distinctNetworkNamespace: true, interfaces: ['lo'], defaultRoute: false }, scenarios: {} };
const labels = new Map<string, string>();
const jobs: Record<string, any> = {};
const events = (): any[] => fs.existsSync(`${root}/events.jsonl`) ? fs.readFileSync(`${root}/events.jsonl`, 'utf8').trim().split('\n').filter(Boolean).map(s => JSON.parse(s)) : [];
const wait = async (condition: () => boolean | Promise<boolean>, timeout = 20000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await condition()) return true; await new Promise(r => setTimeout(r, 30)); }
  return false;
};
let host: Awaited<ReturnType<typeof startActivityHost>> | undefined;
let stage = 'startup';
let offset = 0;
const observations: any[] = [];
const capture = async (lists = false) => {
  if (!host?.available) return;
  const all = await host.read(lists);
  for (const e of all.slice(offset)) observations.push({ ...e, phase: stage });
  offset = all.length;
};
const snapshots = () => observations.filter(e => e.type === 'workspace');
const observe = async (predicate: (value: any) => boolean, timeout = 8000) => wait(async () => { await capture(); return snapshots().some(predicate); }, timeout);
const stopNative = async (signal: NodeJS.Signals = 'SIGTERM') => {
  if (native.exitCode !== null || native.signalCode) return;
  const stopped = once(native, 'exit'); native.kill(signal);
  const timer = setTimeout(() => native.kill('SIGKILL'), 5000);
  try { await stopped; } finally { clearTimeout(timer); }
};
try {
  assert.ok(await wait(async () => { try { await client.agent.list({ location }, { signal: AbortSignal.timeout(1000) }); return events().some(e => e.type === 'registered'); } catch { return false; } }), 'native location activation');
  assert.equal((await client.credential.list()).length, 0); report.isolation.credentials = 0;
  const create = async (label: string, directory = location.directory) => {
    const s = await client.session.create({ location: { directory }, agent: 'build', title: `Synthetic ${label}`, model: { providerID: 'activity-fixture', id: 'script' } }); labels.set(s.id, label); return s;
  };
  const a = await create('A'), b = await create('B');
  const beta = await create('Beta-root', `${root}/Beta`);
  stage = 'host-mount';
  host = await startActivityHost(root, env, a.id);
  report.workspaceHost = { available: host.available, reason: host.reason, diagnostics: host.diagnostics, fixtureOnly: true };
  assert.ok(host.available, 'real SDK fixture must mount');
  await capture(true);
  const prompt = async (sessionID: any, job: any, waitForEnd = true) => {
    jobs[sessionID] = job; fs.writeFileSync(`${root}/jobs.json`, JSON.stringify(jobs));
    await client.session.prompt({ sessionID, text: 'Synthetic workspace activity input.' });
    if (waitForEnd) await client.session.wait({ sessionID }, { signal: AbortSignal.timeout(30000) });
    await capture();
  };
  // Only generate the topology needed by SDK proof; do not repeat the accepted
  // built-in resume/parallel/binding matrix in this continuation.
  stage = 'native-children';
  await prompt(a.id, { generation: 'workspace-c1', calls: [{ id: 'workspace-c1', input: { agent: 'restricted-worker', description: 'Synthetic C1', prompt: 'Synthetic workspace fixture.' } }] });
  const first = events().find(e => e.type === 'after' && e.callID === 'workspace-c1'); assert.ok(first?.childID); labels.set(first.childID, 'C1');
  await prompt(a.id, { generation: 'workspace-c2', calls: [{ id: 'workspace-c2', input: { agent: 'restricted-worker', description: 'Synthetic C2', prompt: 'Synthetic workspace fixture.', background: true } }] });
  const second = events().find(e => e.type === 'after' && e.callID === 'workspace-c2'); assert.ok(second?.childID); labels.set(second.childID, 'C2');
  await client.session.wait({ sessionID: second.childID }, { signal: AbortSignal.timeout(30000) });
  const nested = await client.session.create({ parentID: first.childID, location, agent: 'restricted-worker', title: 'Synthetic N1 API fixture', model: { providerID: 'activity-fixture', id: 'script' } }); labels.set(nested.id, 'N1-api-fixture');
  stage = 'lineage-ready';
  assert.ok(await observe(s => s.state === 'ready' && s.coverage.some((c: any) => c.directory === location.directory && c.state === 'ready')
    && s.sessions.some((r: any) => r.id === first.childID && r.parentId === a.id) && s.sessions.some((r: any) => r.id === second.childID && r.parentId === a.id)
    && s.sessions.some((r: any) => r.id === nested.id && r.parentId === first.childID)), 'actual ready SDK lineage');
  await capture(true);
  const alpha = snapshots().findLast(s => s.sessions.some((r: any) => r.id === first.childID));
  const descendants = new Set([a.id]);
  for (let i = 0; i < 32; i++) for (const r of alpha.sessions) if (r.parentId && descendants.has(r.parentId)) descendants.add(r.id);
  report.scenarios.lineage = { C1: alpha.sessions.some((r: any) => r.id === first.childID && r.parentId === a.id), C2: alpha.sessions.some((r: any) => r.id === second.childID && r.parentId === a.id), N1ApiFixture: alpha.sessions.some((r: any) => r.id === nested.id && r.parentId === first.childID), BIsInputButNotDescendant: alpha.sessions.some((r: any) => r.id === b.id) && !descendants.has(b.id), BetaExcludedFromAlpha: !alpha.sessions.some((r: any) => r.id === beta.id) };
  stage = 'unchanged-lists';
  const callbackCount = snapshots().filter(s => s.method === 'onSessions').length;
  await capture(true); await capture(true);
  report.scenarios.unchanged = { callbacksBefore: callbackCount, callbacksAfterTwoReads: snapshots().filter(s => s.method === 'onSessions').length,
    repeatedListsWithoutActivityChanges: snapshots().filter(s => s.phase === stage && s.method === 'listSessions').some(s => s.changedActivityIDs.length === 0) };
  stage = 'C1-running';
  fs.rmSync(`${root}/release`, { force: true });
  await prompt(first.childID, { generation: 'workspace-running', hold: true }, false);
  report.scenarios.running = await observe(s => s.phase === stage && s.sessions.some((r: any) => r.id === first.childID && r.activity === 'running'));
  stage = 'other-child-failed';
  await prompt(second.childID, { generation: 'workspace-failed', fault: true });
  report.scenarios.failed = await observe(s => s.phase === stage && s.sessions.some((r: any) => r.id === second.childID && r.activity === 'idle' && r.outcome === 'failed'));
  report.scenarios.nativeFailedOutcome = (await client.session.get({ sessionID: second.childID })).outcome ?? null;
  report.scenarios.perSession = snapshots().some(s => s.phase === stage && s.method === 'onSessions' && s.changedActivityIDs.includes(second.childID) && !s.changedActivityIDs.includes(first.childID) && s.sessions.some((r: any) => r.id === first.childID && r.activity === 'running'));
  stage = 'C1-completed';
  fs.writeFileSync(`${root}/release`, 'release'); await client.session.wait({ sessionID: first.childID });
  report.scenarios.completed = await observe(s => s.phase === stage && s.sessions.some((r: any) => r.id === first.childID && r.activity === 'idle' && r.outcome === 'completed'));
  report.scenarios.nativeCompletedOutcome = (await client.session.get({ sessionID: first.childID })).outcome ?? null;
  stage = 'title-only';
  const titleBarrier = observations.length;
  await client.session.update({ sessionID: second.childID, title: 'Synthetic C2 metadata-only change' });
  await wait(async () => { await capture(); return observations.slice(titleBarrier).some(e => e.type === 'workspace' && e.method === 'onSessions'); }, 4000);
  report.scenarios.titleOnly = observations.slice(titleBarrier).some(e => e.type === 'workspace' && e.method === 'onSessions' && e.changedActivityIDs.length === 0);
  stage = 'C2-interrupted';
  fs.rmSync(`${root}/release`, { force: true }); await prompt(second.childID, { generation: 'workspace-interrupted', hold: true }, false);
  await observe(s => s.phase === stage && s.sessions.some((r: any) => r.id === second.childID && r.activity === 'running'));
  const interruptBarrier = observations.length;
  await client.session.interrupt({ sessionID: second.childID, resume: false }); fs.writeFileSync(`${root}/release`, 'release'); await client.session.wait({ sessionID: second.childID });
  report.scenarios.interruptedSnapshot = await observe(s => observations.indexOf(s) >= interruptBarrier && s.phase === stage && s.sessions.some((r: any) => r.id === second.childID && r.activity === 'idle'));
  await capture(true);
  report.scenarios.cancellationControl = {
    nativeOutcome: (await client.session.get({ sessionID: second.childID })).outcome ?? null,
    nativeInterruptedEventObserved: events().some(e => e.kind === 'session.execution.interrupted' && e.sessionID === second.childID),
    sdkIdleOutcomes: [...new Set(snapshots().filter(s => observations.indexOf(s) >= interruptBarrier && s.phase === stage).flatMap(s => s.sessions.filter((r: any) => r.id === second.childID && r.activity === 'idle').map((r: any) => r.outcome)))],
  };
  stage = 'waiting-form';
  const form = await client.session.form.create({ sessionID: first.childID, title: 'Synthetic form fixture', fields: [{ type: 'string', key: 'fixture' }] });
  report.scenarios.waitingQuestion = await observe(s => s.phase === stage && s.sessions.some((r: any) => r.id === first.childID && r.activity === 'waiting-question'));
  await client.session.form.cancel({ sessionID: first.childID, formID: form.id });
  stage = 'before-runtime-loss';
  const lossEvents = events().length;
  fs.rmSync(`${root}/release`, { force: true }); await prompt(first.childID, { generation: 'workspace-runtime-loss', hold: true }, false);
  await observe(s => s.phase === stage && s.sessions.some((r: any) => r.id === first.childID && r.activity === 'running'));
  report.scenarios.runtimeLossControl = { nativeActiveBeforeKill: (await client.session.active())[first.childID]?.type === 'running', nativeOutcomeBeforeKill: (await client.session.get({ sessionID: first.childID })).outcome ?? null };
  stage = 'runtime-disconnected';
  await stopNative('SIGKILL'); report.previousHostStopped = true;
  report.scenarios.runtimeLossControl.nativeTerminalObservedBeforeRestart = events().slice(lossEvents).some(e => e.sessionID === first.childID && ['session.execution.succeeded', 'session.execution.failed', 'session.execution.interrupted'].includes(e.kind));
  const disconnectStart = performance.now();
  report.scenarios.disconnectedUnknown = await observe(s => s.phase === stage && s.sessions.some((r: any) => r.id === first.childID && r.activity === 'unknown'), 10000);
  await capture(true);
  const disconnected = snapshots().findLast(s => s.phase === stage && s.sessions.some((r: any) => r.id === first.childID));
  report.scenarios.runtimeLossControl.observedDisconnectedMs = Math.round(performance.now() - disconnectStart);
  report.scenarios.runtimeLossControl.sdkDisconnected = disconnected ? { state: disconnected.state, coverage: disconnected.coverage.map((c: any) => c.state), activity: disconnected.sessions.find((r: any) => r.id === first.childID).activity, outcome: disconnected.sessions.find((r: any) => r.id === first.childID).outcome } : null;
  stage = 'runtime-reconnected';
  native = launch(); fs.writeFileSync(`${root}/host-pid`, String(native.pid));
  assert.ok(await wait(async () => { try { await client.agent.list({ location }, { signal: AbortSignal.timeout(1000) }); return true; } catch { return false; } }));
  report.scenarios.reconnectedSnapshot = await observe(s => s.phase === stage && s.state === 'ready' && s.sessions.some((r: any) => r.id === first.childID && r.parentId === a.id && r.activity !== 'running'), 15000);
  await capture(true);
  const afterRestart = await client.session.get({ sessionID: first.childID });
  report.scenarios.runtimeLossControl.nativeIdentityAndParentRetained = afterRestart.id === first.childID && afterRestart.parentID === a.id;
  report.scenarios.runtimeLossControl.nativeOutcomeAfterRestart = afterRestart.outcome ?? null;
  const reconnected = snapshots().findLast(s => s.phase === stage && s.sessions.some((r: any) => r.id === first.childID));
  report.scenarios.runtimeLossControl.sdkReconnected = reconnected ? { activity: reconnected.sessions.find((r: any) => r.id === first.childID).activity, outcome: reconnected.sessions.find((r: any) => r.id === first.childID).outcome } : null;
  report.pass = true;
} catch {
  report.failure = `Workspace proof stopped at ${stage}; no raw host output retained.`;
  process.exitCode = 1;
} finally {
  try { await capture(true); } catch {}
  await host?.stop(); await stopNative();
  report.hostStopped = native.exitCode !== null || native.signalCode !== null;
  report.observerDisposed = events().some(e => e.type === 'disposed');
  const alias = (directory: string) => directory === `${root}/Alpha` ? 'Alpha' : directory === `${root}/Beta` ? 'Beta' : 'other';
  report.workspace = observations.map(e => {
    const { projectId, sessionID, coverage, sessions, changedActivityIDs, ...safe } = e;
    return { ...safe, ...(sessionID !== undefined ? { session: labels.get(sessionID) ?? null } : {}),
      ...(coverage ? { coverage: coverage.map((c: any) => ({ directory: alias(c.directory), state: c.state })) } : {}),
      ...(changedActivityIDs ? { changedActivity: changedActivityIDs.map((id: string) => labels.get(id) ?? 'other') } : {}),
      ...(sessions ? { sessions: sessions.map((r: any) => ({ session: labels.get(r.id) ?? 'other', parent: r.parentId === null ? null : labels.get(r.parentId) ?? 'other-or-missing', parentFieldPresent: Object.hasOwn(r, 'parentId'), directory: alias(r.directory), activity: r.activity, outcome: r.outcome })) } : {}) };
  });
  report.events = []; // CLI observations are not a substitute for the actual SDK records above.
  fs.writeFileSync(`${root}/report.json`, JSON.stringify(report, null, 2));
}
