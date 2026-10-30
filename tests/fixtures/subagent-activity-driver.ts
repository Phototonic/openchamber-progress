/** Isolated native driver. Only allowlisted metadata leaves the disposable root. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { networkInterfaces } from 'node:os';
import { OpenCode } from '@opencode/client';
import { startActivityHost } from '../browser/subagent-activity-host.ts';
import { Store } from '../../shared/store.ts';

const root = process.argv[2];
assert.match(root, /^\/tmp\/opencode\/subagent-activity-[A-Za-z0-9]+$/);
assert.notEqual(fs.readlinkSync('/proc/self/ns/net'), process.argv[3]);
assert.deepEqual(Object.keys(networkInterfaces()), ['lo']);
assert.equal(spawnSync('/usr/sbin/ip', ['route', 'show', 'default'], { encoding: 'utf8' }).stdout.trim(), '');
const env = { PATH: '/usr/bin:/bin', HOME: `${root}/home`, XDG_CONFIG_HOME: `${root}/config`, XDG_DATA_HOME: `${root}/data`, XDG_CACHE_HOME: `${root}/cache`, XDG_STATE_HOME: `${root}/state`, XDG_RUNTIME_DIR: `${root}/runtime`, TMPDIR: `${root}/tmp`, OPENCODE_PASSWORD: 'synthetic-local-only', DBUS_SESSION_BUS_ADDRESS: 'disabled:', ACTIVITY_ROOT: root };
const records = (): any[] => fs.existsSync(`${root}/events.jsonl`) ? fs.readFileSync(`${root}/events.jsonl`, 'utf8').trim().split('\n').filter(Boolean).map(s => JSON.parse(s)) : [];
const waitFor = async (condition: () => boolean | Promise<boolean>) => {
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) { if (await condition()) return; await new Promise(resolve => setTimeout(resolve, 25)); }
  throw new Error('Bounded metadata wait expired');
};
const report: any = { mode: process.argv[4], isolation: { distinctNetworkNamespace: true, interfaces: ['lo'], defaultRoute: false }, scenarios: {}, pass: false };
const launch = () => spawn(process.env.OPENCODE_BINARY!, ['serve', '--hostname', '127.0.0.1', '--port', '18767'], { cwd: `${root}/Alpha`, env, stdio: 'ignore' });
let host = launch();
fs.writeFileSync(`${root}/host-pid`, String(host.pid));
const client = OpenCode.make({ baseUrl: 'http://127.0.0.1:18767', headers: { authorization: `Basic ${Buffer.from('opencode:synthetic-local-only').toString('base64')}` } });
const labels = new Map<string, string>();
const jobs: Record<string, any> = {};
const location = { directory: `${root}/Alpha` };
let workspaceHost: Awaited<ReturnType<typeof startActivityHost>> | undefined;
let workspaceObservations: any[] = [];
let activeListenerAbort: AbortController | undefined;
const readWorkspace = async () => {
  if (workspaceHost?.available) { try { workspaceObservations = await workspaceHost.read(); } catch { report.workspaceReadFailed = true; } }
};
let stage = 'startup';
try {
  report.startup = { locationActivationRequested: false, locationActivationSucceeded: false, lastRequestClassification: 'not-requested' };
  await waitFor(async () => {
    assert.equal(host.exitCode, null);
    report.startup.locationActivationRequested = true;
    try {
      await client.agent.list({ location }, { signal: AbortSignal.timeout(1500) });
      report.startup.locationActivationSucceeded = true;
      report.startup.lastRequestClassification = 'success';
    } catch (error: any) {
      report.startup.lastRequestClassification = ['TimeoutError', 'AbortError', 'TypeError'].includes(error?.name) ? error.name : 'request-failed';
    }
    return records().some(e => e.type === 'registered');
  });
  assert.equal((await client.credential.list()).length, 0);
  report.isolation.credentials = 0;
  const inventory = await client.plugin.list({ location });
  report.plugins = inventory.data.map(p => ({ id: p.id, sourceType: p.source.type, status: p.state.status,
    failureClass: p.state.status === 'failed' ? p.state.error.includes('jsdom') ? 'missing-jsdom' : 'unclassified-plugin-failure' : undefined }));
  const create = async (label: string, directory = location.directory) => {
    const session = await client.session.create({ location: { directory }, agent: 'build', title: 'Synthetic activity fixture', model: { providerID: 'activity-fixture', id: 'script' } });
    labels.set(session.id, label); return session;
  };
  const a = await create('A');
  await create('B');
  await create('Beta-root', `${root}/Beta`);
  stage = 'workspace-host';
  if (process.argv[4] === 'builtin') {
    workspaceHost = await startActivityHost(root, env);
    report.workspaceHost = { available: workspaceHost.available, reason: workspaceHost.reason, fixtureOnly: true };
    await readWorkspace();
  }
  const prompt = async (sessionID: any, job: any) => {
    jobs[sessionID] = job; fs.writeFileSync(`${root}/jobs.json`, JSON.stringify(jobs));
    await client.session.prompt({ sessionID, text: 'Synthetic probe step.' }, { signal: AbortSignal.timeout(30000) });
    await client.session.wait({ sessionID }, { signal: AbortSignal.timeout(30000) });
    await readWorkspace();
  };
  const call = (id: string, agent: string, extra: object = {}) => ({ id, input: { agent, description: 'Synthetic child', prompt: 'Synthetic probe step.', ...extra } });
  stage = 'foreground';
  await prompt(a.id, { generation: 1, calls: [call('foreground', 'nested-worker')] });
  const first = records().find(e => e.type === 'after' && e.callID === 'foreground');
  report.scenarios.foreground = Boolean(first?.childID && first.native?.parentID === a.id);
  if (first?.childID) labels.set(first.childID, 'C1');
  const nested = records().find(e => e.type === 'after' && e.callID === 'nested');
  if (nested?.childID) labels.set(nested.childID, 'N1');
  report.scenarios.nested = Boolean(nested?.childID && first?.childID && nested?.native?.parentID === first.childID);
  if (!nested?.childID && first?.childID) {
    const n1 = await client.session.create({ parentID: first.childID, location, agent: 'restricted-worker', title: 'Synthetic nested API fixture', model: { providerID: 'activity-fixture', id: 'script' } });
    labels.set(n1.id, 'N1-api-fixture');
    report.scenarios.nestedApiFixture = { nativeParentage: (await client.session.get({ sessionID: n1.id })).parentID === first.childID, mechanism: 'native session.create fixture, NOT successful nested delegation' };
  }
  stage = 'background';
  await prompt(a.id, { generation: 2, calls: [call('background', 'restricted-worker', { background: true })] });
  const background = records().find(e => e.type === 'after' && e.callID === 'background');
  if (background?.childID) {
    labels.set(background.childID, 'C2');
    await client.session.wait({ sessionID: background.childID }, { signal: AbortSignal.timeout(30000) });
  }
  report.scenarios.background = Boolean(background?.childID && background.native?.parentID === a.id);
  if (first?.childID && background?.childID) {
    const store = new Store(`${root}/store/progress.sqlite`, { create: true });
    try {
      store.registerSource({ id: 'source-alpha', verified: true, configRoot: `${root}/config/opencode`, dataRoot: `${root}/data/opencode` }); store.bindReads('source-alpha', true); store.setEnabled(true);
      const actor = { sessionId: a.id, parentId: null, sourceId: 'source-alpha', verifiedSource: true, directory: location.directory, projectId: a.projectID, agent: 'build', ancestry: [] };
      store.apply({ op: 'start', plan: 'plan-alpha', title: 'Synthetic activity fixture', oid: 'fixture-start', rev: 0, items: ['task-1', 'task-2', 'task-3'].map(id => ({ id, title: 'Synthetic task', kind: 'task', status: 'pending' })) }, actor);
      store.apply({ op: 'link', plan: 'plan-alpha', oid: 'fixture-link', rev: 1, child: first.childID, assign: ['task-1'] }, actor, undefined, { ...actor, sessionId: first.childID, parentId: a.id, ancestry: first.native.ancestry });
      const detail = store.detail('source-alpha', 'plan-alpha');
      report.scenarios.explicitAssignmentFixture = { mechanism: 'real Store, direct synthetic actor fixture; NOT model report dispatch', assignedC1: detail.items.data[0].assigneeSessionId === first.childID, unassignedC2: !detail.links.some(l => l.sessionId === background.childID), statusesUnchanged: detail.items.data.every(i => i.status === 'pending') };
    } finally { store.close(); }
  }
  stage = 'resume';
  if (first?.childID) {
    await prompt(a.id, { generation: 3, calls: [call('resume', 'nested-worker', { sessionID: first.childID })] });
    const resume = records().find(e => e.type === 'after' && e.callID === 'resume');
    report.scenarios.resumeSameID = resume?.childID === first.childID;
  }
  stage = 'parallel';
  await prompt(a.id, { generation: 4, calls: [call('parallel-slow', 'slow-worker'), call('parallel-fast', 'restricted-worker')] });
  report.scenarios.parallel = records().filter(e => e.type === 'after' && e.callID?.startsWith('parallel-')).map(e => e.callID);
  stage = 'late-second';
  await prompt(a.id, { generation: 'late-second', lateSecond: true, calls: [call('stream-first', 'restricted-worker'), call('stream-second', 'restricted-worker')] });
  report.scenarios.lateSecond = records().filter(e => e.type === 'after' && e.callID?.startsWith('stream-')).map(e => e.callID);
  stage = 'error';
  await prompt(a.id, { generation: 5, calls: [call('invalid-agent', 'missing-synthetic-agent')] });
  report.scenarios.errorHook = records().some(e => e.type === 'after' && e.callID === 'invalid-agent' && e.status === 'error');
  stage = 'provider-error';
  await prompt(a.id, { generation: 6, fault: true });
  report.scenarios.failedOutcome = (await client.session.get({ sessionID: a.id })).outcome;
  report.scenarios.providerError = records().some(e => e.type === 'event' && e.kind === 'session.execution.failed' && e.sessionID === a.id);
  stage = 'cancel';
  fs.rmSync(`${root}/release`, { force: true });
  jobs[a.id] = { generation: 7, hold: true }; fs.writeFileSync(`${root}/jobs.json`, JSON.stringify(jobs));
  const pending = client.session.prompt({ sessionID: a.id, text: 'Synthetic cancellation step.' }).catch(() => undefined);
  await waitFor(() => records().some(e => e.type === 'dispatch' && e.sessionID === a.id && e.hold));
  await client.session.interrupt({ sessionID: a.id, resume: false });
  fs.writeFileSync(`${root}/release`, 'release');
  await pending;
  await client.session.wait({ sessionID: a.id }, { signal: AbortSignal.timeout(30000) });
  report.scenarios.cancelOutcome = (await client.session.get({ sessionID: a.id })).outcome;
  await readWorkspace();
  report.scenarios.cancel = records().some(e => e.type === 'event' && e.kind === 'session.execution.interrupted' && e.sessionID === a.id);
  report.scenarios.restrictedNoReport = records().some(e => e.type === 'context' && e.sessionID === background?.childID && !e.reportTool);
  stage = 'waiting-form';
  const form = await client.session.form.create({ sessionID: a.id, title: 'Synthetic activity fixture', fields: [{ type: 'string', key: 'fixture' }] });
  await readWorkspace();
  await client.session.form.cancel({ sessionID: a.id, formID: form.id });
  report.scenarios.nativeFormCreatedAndCancelled = true;
  stage = 'dropped-client-listener';
  const listenerAbort = new AbortController();
  activeListenerAbort = listenerAbort;
  const listenerMetadata: string[] = [];
  let listenerLive = false;
  const listener = (async () => { try { for await (const e of client.event.subscribe({ signal: listenerAbort.signal, onActivity: () => { listenerLive = true; } })) if (e.type.startsWith('session.execution.')) listenerMetadata.push(e.type); } catch {} })();
  let barrier = 0;
  await waitFor(async () => { if (!listenerLive) await client.session.update({ sessionID: a.id, title: `Synthetic listener barrier ${++barrier}` }); return listenerLive; });
  fs.rmSync(`${root}/release`, { force: true });
  jobs[a.id] = { generation: 'lost-terminal', hold: true }; fs.writeFileSync(`${root}/jobs.json`, JSON.stringify(jobs));
  await client.session.prompt({ sessionID: a.id, text: 'Synthetic listener-loss fixture.' });
  await waitFor(() => { const entries = records(); return entries.findLastIndex(e => e.type === 'dispatch' && e.sessionID === a.id && e.hold) > entries.findLastIndex(e => e.kind === 'session.execution.interrupted'); });
  await waitFor(() => listenerMetadata.includes('session.execution.started'));
  report.scenarios.nativeActiveWhileHeld = (await client.session.active())[a.id]?.type === 'running';
  listenerAbort.abort(); await listener;
  fs.writeFileSync(`${root}/release`, 'release');
  await client.session.wait({ sessionID: a.id }, { signal: AbortSignal.timeout(30000) });
  report.scenarios.lostTerminalClient = { listenerStoppedBeforeTerminal: !listenerMetadata.some(t => t === 'session.execution.succeeded'), snapshotOutcome: (await client.session.get({ sessionID: a.id })).outcome,
    scope: 'test client listener disconnected; plugin and host listeners were not deliberately dropped' };
  await readWorkspace();
  stage = 'snapshot-reconnect';
  const beforeReconnect = first?.childID ? await client.session.get({ sessionID: first.childID }) : undefined;
  const oldHost = host;
  const exited = once(oldHost, 'exit'); oldHost.kill('SIGTERM');
  const stopTimer = setTimeout(() => oldHost.kill('SIGKILL'), 5000);
  try { await exited; } finally { clearTimeout(stopTimer); }
  report.previousHostStopped = oldHost.exitCode !== null || oldHost.signalCode !== null;
  await readWorkspace();
  host = launch(); fs.writeFileSync(`${root}/host-pid`, String(host.pid));
  await waitFor(async () => { try { await client.agent.list({ location }, { signal: AbortSignal.timeout(1000) }); return true; } catch { return false; } });
  const afterReconnect = first?.childID ? await client.session.get({ sessionID: first.childID }) : undefined;
  report.scenarios.nativeSnapshotAfterRestart = Boolean(beforeReconnect && afterReconnect && beforeReconnect.id === afterReconnect.id && afterReconnect.parentID === a.id);
  report.scenarios.nativeSnapshotOutcomeAfterRestart = afterReconnect?.outcome;
  await readWorkspace();
  const all = records();
  const boundaries = all.filter(e => e.type === 'event' && e.kind === 'session.step.streamed');
  report.boundaries = boundaries.map(e => {
    const calls = all.filter(c => c.type === 'event' && c.kind === 'session.tool.input.started' && c.sessionID === e.sessionID && c.messageID === e.messageID && c.tool === 'subagent');
    const hooks = all.filter(c => c.type === 'before' && c.sessionID === e.sessionID && c.messageID === e.messageID);
    return { session: labels.get(e.sessionID) ?? 'other', message: e.messageID, callIDs: calls.map(c => c.callID), hookCallIDs: hooks.map(c => c.callID),
      allInputStartsBeforeStreamed: calls.every(c => all.indexOf(c) < all.indexOf(e)), allBeforeHooksAfterStreamed: hooks.every(c => all.indexOf(c) > all.indexOf(e)) };
  }).filter(e => e.callIDs.length);
  assert.ok(report.scenarios.foreground && report.scenarios.background, 'native structured child results required for this probe fixture');
  report.pass = true;
} catch {
  report.failure = `Native probe failed at ${stage}; raw host output discarded.`;
  report.failureClassification = host.exitCode !== null ? 'host-exited' : records().some(e => e.type === 'startup-phase') ? 'observer-setup-incomplete-or-scenario-failed' : 'observer-not-started';
  process.exitCode = 1;
} finally {
  activeListenerAbort?.abort();
  await readWorkspace();
  await workspaceHost?.stop();
  if (host.exitCode === null && !host.signalCode) {
    const exit = once(host, 'exit'); host.kill('SIGTERM');
    const timer = setTimeout(() => host.kill('SIGKILL'), 5000);
    try { await exit; } finally { clearTimeout(timer); }
  }
  report.hostStopped = host.exitCode !== null || host.signalCode !== null;
  const all = records();
  for (const e of all) for (const id of [e.sessionID, e.childID, e.parentID, e.native?.id, e.native?.parentID, ...(e.native?.ancestry ?? [])]) if (id && !labels.has(id)) labels.set(id, `other-${labels.size + 1}`);
  const messages = new Map<string, string>();
  report.events = all.map(e => {
    const { sessionID, childID, parentID, native, messageID, resumeID, delegationSchema, ...safe } = e;
    if (messageID && !messages.has(messageID)) messages.set(messageID, `message-${messages.size + 1}`);
    return { ...safe, ...(sessionID ? { session: labels.get(sessionID) } : {}), ...(childID ? { child: labels.get(childID) } : {}), ...(parentID ? { parent: labels.get(parentID) } : {}),
      ...(native ? { native: { session: labels.get(native.id), parent: labels.get(native.parentID), ancestry: native.ancestry?.map((id: string) => labels.get(id)), complete: native.complete, sameDirectory: native.sameDirectory, outcome: native.outcome } } : {}),
      ...(messageID ? { message: messages.get(messageID) } : {}), ...(resumeID ? { resume: labels.get(resumeID) } : {}),
      ...(delegationSchema ? { delegationSchema: { type: delegationSchema.type, required: delegationSchema.required, properties: Object.fromEntries(Object.entries(delegationSchema.properties ?? {}).map(([k, v]: [string, any]) => [k, { type: v.type, anyOf: v.anyOf?.map((x: any) => ({ type: x.type })) }])) } } : {}) };
  });
  report.boundaries = report.boundaries?.map((b: any) => ({ ...b, message: messages.get(b.message) }));
  report.workspace = workspaceObservations.map(e => ({ ...e,
    ...(e.sessionID !== undefined ? { sessionID: undefined, session: labels.get(e.sessionID) ?? null } : {}),
    ...(e.projectId ? { projectId: undefined, project: workspaceObservations.filter(x => x.type === 'workspace').findIndex(x => x.projectId === e.projectId) } : {}),
    ...(e.coverage ? { coverage: e.coverage.map((c: any) => ({ directory: c.directory === `${root}/Alpha` ? 'Alpha' : c.directory === `${root}/Beta` ? 'Beta' : 'other', state: c.state })) } : {}),
    ...(e.sessions ? { sessions: e.sessions.map((s: any) => ({ session: labels.get(s.id) ?? 'not-in-driver', parent: s.parentId === null ? null : labels.get(s.parentId) ?? 'not-in-driver', directory: s.directory === `${root}/Alpha` ? 'Alpha' : s.directory === `${root}/Beta` ? 'Beta' : 'other', activity: s.activity, outcome: s.outcome })) } : {}) }));
  report.observerDisposed = all.some(e => e.type === 'disposed');
  report.externalRequests = all.filter(e => e.type === 'unexpected-http').length;
  report.pass = report.pass && report.hostStopped && report.observerDisposed && report.externalRequests === 0;
  if (!report.pass) process.exitCode = 1;
  fs.writeFileSync(`${root}/report.json`, JSON.stringify(report, null, 2));
}
