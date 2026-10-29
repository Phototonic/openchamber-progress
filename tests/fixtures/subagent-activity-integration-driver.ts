/** Scripted provider drives the production report tool/hooks/Store; API assertions use real auth. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { networkInterfaces } from 'node:os';
import { randomUUID } from 'node:crypto';
import { OpenCode } from '@opencode/client';
import { Store } from '../../shared/store.ts';
import { createProgressServer } from '../../service/server.ts';
import { nativeProductionViews } from '../browser/subagent-activity-native.ts';

const root = process.argv[2], mode = process.argv[4];
assert.match(root, /^\/tmp\/opencode\/subagent-activity-[A-Za-z0-9]+$/);
assert.notEqual(fs.readlinkSync('/proc/self/ns/net'), process.argv[3]);
assert.deepEqual(Object.keys(networkInterfaces()), ['lo']);
assert.equal(spawnSync('/usr/sbin/ip', ['route', 'show', 'default'], { encoding: 'utf8' }).stdout.trim(), '');
const env = { PATH: '/usr/bin:/bin', HOME: `${root}/home`, XDG_CONFIG_HOME: `${root}/config`, XDG_DATA_HOME: `${root}/data`, XDG_CACHE_HOME: `${root}/cache`, XDG_STATE_HOME: `${root}/state`, XDG_RUNTIME_DIR: `${root}/runtime`, TMPDIR: `${root}/tmp`, OPENCODE_PASSWORD: 'synthetic-local-only', DBUS_SESSION_BUS_ADDRESS: 'disabled:', ACTIVITY_ROOT: root, AGENT_PROGRESS_BINDING: `${root}/binding.json`, ACTIVITY_WAYLAND_SOCKET: process.env.ACTIVITY_WAYLAND_SOCKET! };
const native = spawn(process.env.OPENCODE_BINARY!, ['serve', '--hostname', '127.0.0.1', '--port', '18767'], { cwd: `${root}/Alpha`, env, stdio: 'ignore' });
fs.writeFileSync(`${root}/host-pid`, String(native.pid));
const client = OpenCode.make({ baseUrl: 'http://127.0.0.1:18767', headers: { authorization: `Basic ${Buffer.from('opencode:synthetic-local-only').toString('base64')}` } });
const location = { directory: `${root}/Alpha` };
const records = (): any[] => fs.existsSync(`${root}/events.jsonl`) ? fs.readFileSync(`${root}/events.jsonl`, 'utf8').trim().split('\n').filter(Boolean).map(s => JSON.parse(s)) : [];
const report: any = { mode, pass: false, isolation: { distinctNetworkNamespace: true, interfaces: ['lo'], defaultRoute: false }, checks: {} };
const wait = async (condition: () => Promise<boolean> | boolean, label: string, timeout = 20000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await condition()) return; await new Promise(r => setTimeout(r, 25)); }
  throw new Error(label);
};
const store = new Store(`${root}/store/progress.sqlite`); store.bindReads('source-alpha', true);
const token = randomUUID(), server = createProgressServer(store, token);
server.listen(18769, '127.0.0.1'); await once(server, 'listening');
const request = (route: string, auth = true) => fetch(`http://127.0.0.1:18769${route}`, { headers: auth ? { authorization: `Bearer ${token}` } : {} });
const read = async (route: string): Promise<any> => { const r = await request(route); assert.equal(r.status, 200); return r.json(); };
const detail = () => read('/v1/plan?source=source-alpha&plan=plan-alpha');
const jobs: Record<string, any> = {};
const labels = new Map<string, string>();
let stage = 'activation';
try {
  await wait(async () => { try { await client.agent.list({ location }, { signal: AbortSignal.timeout(1000) }); return records().some(e => e.type === 'registered'); } catch { return false; } }, stage);
  assert.equal((await client.credential.list()).length, 0); report.isolation.credentials = 0;
  const create = async (label: string, directory = location.directory, parentID?: any) => {
    const s = await client.session.create({ location: { directory }, agent: 'build', title: `Synthetic ${label}`, parentID, model: { providerID: 'activity-fixture', id: 'script' } }); labels.set(s.id, label); return s;
  };
  const a = await create('A'), b = await create('B'); await create('Beta', `${root}/Beta`);
  let generation = 0;
  const prompt = async (sessionID: any, calls: any[], ended = true) => {
    jobs[sessionID] = { generation: String(++generation), calls }; fs.writeFileSync(`${root}/jobs.json`, JSON.stringify(jobs));
    await client.session.prompt({ sessionID, text: 'Synthetic production regression input.' });
    if (ended) await client.session.wait({ sessionID }, { signal: AbortSignal.timeout(30000) });
  };
  const reportTool = async (input: any) => {
    const id = `report-${generation + 1}`;
    await prompt(a.id, [{ id, tool: 'agent_progress_report', input }]);
    assert.ok(records().some(e => e.type === 'report-reply' && e.callID === id && e.status === 'completed' && !e.error), 'real report tool succeeded');
  };
  const spawnCall = (id: string, extra: any = {}) => ({ id, input: { agent: 'restricted-worker', description: `Synthetic ${id}`, prompt: `Synthetic fixed ${id} work.`, ...extra } });
  const childFor = (id: string) => records().find(e => e.type === 'after' && e.callID === id)?.childID;
  stage = 'start';
  await reportTool({ op: 'start', plan: 'plan-alpha', title: 'Synthetic native coordination', oid: 'start-1', rev: 0, items: Array.from({ length: 7 }, (_, i) => ({ id: `task-${i + 1}`, title: `Synthetic task ${i + 1}`, kind: 'task', status: i === 0 ? 'working' : 'pending' })) });
  const initial = await detail(); assert.equal(initial.plan.revision, 1);
  stage = 'unassigned-child';
  await prompt(a.id, [spawnCall('unassigned')]); const c2 = childFor('unassigned'); assert.ok(c2); labels.set(c2, 'C2');
  assert.equal((await read(`/v1/plans?session=${c2}`)).data.length, 0);
  assert.ok(records().some(e => e.type === 'context' && e.sessionID === c2 && e.reportTool === false));
  await prompt(c2, [{ id: 'restricted-report-attempt', tool: 'agent_progress_report', input: { op: 'change', plan: 'plan-alpha', oid: 'restricted-change', rev: 1, changes: [{ id: 'task-1', status: 'done' }] } }]);
  assert.equal((await detail()).plan.revision, 1);
  assert.ok(!records().some(e => e.type === 'report-reply' && e.callID === 'restricted-report-attempt' && e.status === 'completed'));
  report.checks.restrictedNoReportAndNoMembership = true;
  stage = 'explicit-link';
  await prompt(a.id, [spawnCall('explicit-child')]); const c1 = childFor('explicit-child'); assert.ok(c1); labels.set(c1, 'C1');
  await reportTool({ op: 'link', plan: 'plan-alpha', oid: 'explicit-link', rev: 1, child: c1, assign: ['task-1'] });
  assert.equal((await detail()).items.data[0].assignmentBinding, undefined);
  report.checks.explicitLink = true;
  stage = 'declaration';
  const baseline = await detail();
  await reportTool({ op: 'delegate', plan: 'plan-alpha', oid: 'declare-sequential', rev: 2, assign: ['task-2'] });
  assert.equal((await detail()).plan.revision, 2);
  stage = 'sequential-spawn';
  await prompt(a.id, [spawnCall('sequential', mode === 'builtin' ? { sessionID: c1 } : {})]); const bound = childFor('sequential'); assert.ok(bound); labels.set(bound, bound === c1 ? 'C1-bound' : 'C3-bound');
  if (mode === 'builtin') assert.equal(bound, c1);
  await wait(async () => (await detail()).plan.revision === 3, 'binding-commit');
  const assigned = await detail();
  assert.equal(assigned.items.data[0].assigneeSessionId, c1);
  assert.equal(assigned.items.data[1].assigneeSessionId, bound);
  const provenance = assigned.items.data[1].assignmentBinding;
  assert.equal(provenance.childSessionId, bound); assert.equal(provenance.coordinatorSessionId, a.id); assert.equal(provenance.callId, 'sequential'); assert.equal(provenance.boundRevision, 3);
  assert.equal(assigned.items.data.filter((i: any) => i.assignmentBinding).length, 1);
  if (mode === 'builtin') assert.deepEqual(assigned.links, [{ sessionId: c1, itemIds: ['task-1', 'task-2'] }]);
  report.checks.additiveBinding = mode === 'builtin' ? 'same verified child retains explicit task-1 and gains declared task-2' : 'fresh verified child gains task-2; existing child/task-1 link retained';
  const facts = (d: any) => d.items.data.map(({ assigneeSessionId, assignmentBinding, ...i }: any) => i);
  assert.deepEqual(facts(assigned), facts(baseline)); assert.deepEqual(assigned.plan.counts, baseline.plan.counts); assert.equal(assigned.plan.reportedAt, baseline.plan.reportedAt);
  assert.ok(assigned.contributions.data.filter((c: any) => c.revision === 3).every((c: any) => c.itemIds.length === 0 && c.reporterSessionId === a.id));
  assert.equal((await request('/health', false)).status, 401); assert.equal((await read('/health')).schemaVersion, 2);
  assert.equal((await read(`/v1/plans?session=${a.id}`)).data.length, 1); assert.equal((await read(`/v1/plans?session=${bound}`)).data.length, 1); assert.equal((await read(`/v1/plans?session=${b.id}`)).data.length, 0);
  report.checks.sequentialExactlyOneProvenanceAndNoProgressChange = true;
  report.checks.authenticatedAPIAndMembership = true;
  report.apiProof = { authenticatedHealth: true, unauthenticatedStatus: 401, source: 'source-alpha', plan: 'plan-alpha', revision: 3, boundTask: 'task-2', boundChild: bound === c1 ? 'C1' : 'C3', declaringCoordinator: 'A', call: 'sequential', provenanceCount: 1, statusesReportersCountsAndReportedAtUnchanged: true, membership: { A: 1, assignedChild: 1, C2: 0, unrelatedB: 0 } };
  stage = 'resume';
  const beforeResume = await detail();
  await prompt(a.id, [spawnCall('resume', { sessionID: bound })]);
  const resumed = childFor('resume');
  if (mode === 'builtin') assert.equal(resumed, bound);
  else assert.ok(!resumed, 'slim immediate pre-acknowledgement resume remains refused');
  assert.deepEqual((await detail()).links, beforeResume.links);
  assert.equal((await detail()).plan.revision, 3);
  report.checks.resume = mode === 'builtin' ? 'same native ID; no duplicate/transfer' : 'native pre-ack refusal; no binding or transfer; post-ack untested';
  stage = 'parallel';
  await reportTool({ op: 'delegate', plan: 'plan-alpha', oid: 'declare-parallel', rev: 3, assign: ['task-3'] });
  await prompt(a.id, [spawnCall('parallel-one'), spawnCall('parallel-two')]);
  assert.ok(childFor('parallel-one') && childFor('parallel-two'));
  assert.equal((await detail()).plan.revision, 3); report.checks.parallelNoBind = true;
  stage = 'error';
  await reportTool({ op: 'delegate', plan: 'plan-alpha', oid: 'declare-error', rev: 3, assign: ['task-4'] });
  await prompt(a.id, [spawnCall('error', { agent: 'nonexistent-synthetic-agent' })]);
  assert.ok(records().some(e => e.type === 'after' && e.callID === 'error' && e.status === 'error'));
  assert.equal((await detail()).plan.revision, 3); report.checks.errorNoBind = true;
  stage = 'wrong-parent';
  await reportTool({ op: 'delegate', plan: 'plan-alpha', oid: 'declare-wrong', rev: 3, assign: ['task-5'] });
  await prompt(b.id, [spawnCall('wrong-parent')]);
  assert.equal((await detail()).plan.revision, 3);
  await reportTool({ op: 'delegate', plan: 'plan-alpha', oid: 'cancel-wrong', rev: 3, assign: [] });
  report.checks.wrongCallerNoBind = true;
  stage = 'synthetic-wrong-output';
  fs.writeFileSync(`${root}/wrong-child`, b.id);
  await reportTool({ op: 'delegate', plan: 'plan-alpha', oid: 'declare-wrong-output', rev: 3, assign: ['task-5'] });
  await prompt(a.id, [spawnCall('fault-wrong-output')]);
  assert.ok(records().some(e => e.type === 'synthetic-result-fault'));
  assert.equal(childFor('fault-wrong-output'), b.id);
  assert.equal((await detail()).plan.revision, 3);
  report.checks.syntheticWrongReturnedNativeRootNoBind = true;
  stage = 'cancel';
  await reportTool({ op: 'delegate', plan: 'plan-alpha', oid: 'declare-cancel', rev: 3, assign: ['task-6'] });
  await prompt(a.id, [spawnCall('cancelled', { agent: 'slow-worker' })], false);
  await wait(() => records().some(e => e.type === 'before' && e.callID === 'cancelled'), 'cancel-before');
  await client.session.interrupt({ sessionID: a.id, resume: false }); fs.writeFileSync(`${root}/release`, 'release');
  await client.session.wait({ sessionID: a.id }, { signal: AbortSignal.timeout(30000) });
  assert.equal((await detail()).plan.revision, 3); report.checks.nativeCancelNoBind = true;
  const n1 = await create('N1-api-fixture', location.directory, c1);
  const final = await detail();
  assert.deepEqual(facts(final), facts(initial));
  assert.deepEqual((await read('/v1/history?source=source-alpha&plan=plan-alpha')).data.map((r: any) => r.revision), [1, 2, 3]);
  assert.equal((await read(`/v1/plans?session=${n1.id}`)).data.length, 0);
  report.checks.finalNoProgressOrDiscoveryMembershipChange = true;
  if (mode === 'builtin') {
    stage = 'native-production-views'; report.nativeUI = {};
    await nativeProductionViews(root, env, { a: a.id, b: b.id, c1, c2, bound, n1: n1.id }, report.nativeUI, {
      start: async () => {
        fs.rmSync(`${root}/release`, { force: true });
        jobs[bound] = { generation: 'native-renewal', hold: true }; fs.writeFileSync(`${root}/jobs.json`, JSON.stringify(jobs));
        await client.session.prompt({ sessionID: bound, text: 'Synthetic native activity renewal.' });
      },
      stop: async () => { fs.writeFileSync(`${root}/release`, 'release'); await client.session.wait({ sessionID: bound }, { signal: AbortSignal.timeout(30000) }); },
    });
  }
  assert.equal((await detail()).plan.revision, 3);
  report.pass = !report.nativeUI?.defects?.length;
  if (!report.pass) report.failure = { stage: 'native-production-views', kind: 'production-ui-defect' };
} catch (e) {
  report.failure = { stage, kind: e instanceof assert.AssertionError ? 'assertion' : 'bounded-runtime-operation', detail: e instanceof assert.AssertionError ? e.operator : undefined };
} finally {
  server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); store.close();
  if (native.exitCode === null && !native.signalCode) { const exit = once(native, 'exit'); native.kill('SIGTERM'); const timer = setTimeout(() => native.kill('SIGKILL'), 5000); try { await exit; } finally { clearTimeout(timer); } }
  report.hostStopped = native.exitCode !== null || native.signalCode !== null;
  report.eventCounts = Object.fromEntries(['before', 'after', 'report-reply', 'disposed', 'unexpected-http', 'subscription-failed'].map(type => [type, records().filter(e => e.type === type).length]));
  report.reportReplies = records().filter(e => e.type === 'report-reply').map(({ sessionID, ...e }) => ({ ...e, session: labels.get(sessionID) ?? 'other' }));
  report.delegationResults = records().filter(e => e.type === 'before' || e.type === 'after').map(e => ({ stage: e.type, call: e.callID, status: e.status, child: e.childID ? labels.get(e.childID) ?? 'other-native-child' : undefined, verifiedParent: e.native?.parentID === e.sessionID, errorClass: e.errorClass }));
  fs.writeFileSync(`${root}/report.json`, JSON.stringify(report));
}
if (!report.pass) process.exitCode = 1;
