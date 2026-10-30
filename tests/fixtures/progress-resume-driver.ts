/** Runs inside the gate's rootless, loopback-only namespace; never uses a managed service. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { networkInterfaces } from 'node:os';
import { OpenCode } from '@opencode/client';
import { ProgressStatus } from '../../plugin/status.ts';
import { runResumeRegression } from './progress-resume-regression.ts';

const root = process.argv[2];
const report: any = { isolation: {}, controls: {}, events: [] };
const records = (): any[] => fs.existsSync(`${root}/events.jsonl`) ? fs.readFileSync(`${root}/events.jsonl`, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
const waitFor = async (condition: () => boolean | Promise<boolean>) => {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error('Gate condition deadline exceeded');
};
assert.notEqual(fs.readlinkSync('/proc/self/ns/net'), process.argv[3]);
assert.deepEqual(Object.keys(networkInterfaces()), ['lo']);
assert.equal(spawnSync('/usr/sbin/ip', ['route', 'show', 'default'], { encoding: 'utf8' }).stdout.trim(), '');
report.isolation = { distinctNetworkNamespace: true, interfaces: ['lo'], defaultRoute: false, rootless: process.getuid?.() === 0 };
const env = {
  PATH: '/usr/bin:/bin', HOME: `${root}/home`, XDG_CONFIG_HOME: `${root}/config`, XDG_DATA_HOME: `${root}/data`,
  XDG_CACHE_HOME: `${root}/cache`, XDG_STATE_HOME: `${root}/state`, XDG_RUNTIME_DIR: `${root}/runtime`, TMPDIR: `${root}/tmp`,
  OPENCODE_PASSWORD: 'synthetic-local-only', DBUS_SESSION_BUS_ADDRESS: 'disabled:',
  AGENT_PROGRESS_BINDING: `${root}/binding.json`, RESUME_EVENTS: `${root}/events.jsonl`, RESUME_SDK: `file://${root}/sdk.mjs`, RESUME_FAIL: `${root}/fail`,
  RESUME_PHASE: process.argv[4],
};
fs.writeFileSync(`${root}/sdk.mjs`, 'export function createResumeFixture() { return {}; }\n');
const binary = '/tmp/opencode/agent-progress-probe-cli/opencode';
const version = spawnSync(binary, ['--version'], { env, encoding: 'utf8' });
assert.equal(version.status, 0); assert.equal(version.stdout.trim(), 'opencode v2.2.2');
report.runtimeVersion = version.stdout.trim();
const child = spawn(binary, ['serve', '--hostname', '127.0.0.1', '--port', '18766'], { cwd: `${root}/project`, env, stdio: 'ignore' });
fs.writeFileSync(`${root}/host-pid`, String(child.pid));
const client = OpenCode.make({ baseUrl: 'http://127.0.0.1:18766', headers: { authorization: `Basic ${Buffer.from('opencode:synthetic-local-only').toString('base64')}` } });
const location = { directory: `${root}/project` };
const rpc = client.rpc(ProgressStatus);
const labels = new Map<string, string>();
let passed = false;
try {
  let status: any;
  await waitFor(async () => {
    assert.equal(child.exitCode, null);
    try { status = await rpc.inspect({}, { location, signal: AbortSignal.timeout(1000) }); return status.toolAvailable && records().some(e => e.type === 'registered'); } catch { return false; }
  });
  assert.equal(status.sourceId, 'source-resume-fixture');
  report.sourceVerifiedByProductionStatus = true;
  assert.equal((await client.credential.list({ signal: AbortSignal.timeout(30000) })).length, 0);
  report.isolation.credentials = 0;
  if (process.argv[4] === 'regression') {
    await runResumeRegression({ client, root, location, report, records, waitFor, labels });
    passed = true;
  } else {
  const session = await client.session.create({ location, agent: 'build', title: 'Synthetic resume fixture', model: { providerID: 'resume-fixture', id: 'script' } });
  labels.set(session.id, 'root');
  assert.equal((await client.session.get({ sessionID: session.id })).location.directory, location.directory);
  const primary = async (text: string) => {
    const before = records().filter(e => e.type === 'dispatch' && e.kind === 'primary').length;
    await client.session.prompt({ sessionID: session.id, text }, { signal: AbortSignal.timeout(30000) });
    await client.session.wait({ sessionID: session.id }, { signal: AbortSignal.timeout(30000) });
    const outgoing = records().filter(e => e.type === 'dispatch' && e.kind === 'primary').slice(before);
    assert.equal(outgoing.length, 1, 'one scripted outgoing primary');
    return outgoing[0].sentinelCount;
  };
  assert.equal(await primary('Begin synthetic resume probe.'), 0);
  assert.equal(await primary('Resume uncompacted synthetic resume probe.'), 0);
  report.controls.uncompacted = true;
  const compact = async (type: string) => {
    const before = records().filter(e => e.type === type).length;
    await client.session.compact({ sessionID: session.id }, { signal: AbortSignal.timeout(30000) });
    await client.session.wait({ sessionID: session.id }, { signal: AbortSignal.timeout(30000) });
    await waitFor(() => records().filter(e => e.type === type).length > before);
  };
  // Reproduce attempt 1's invalid reply first, as the explicit failed-compaction control.
  fs.writeFileSync(`${root}/fail`, 'synthetic');
  await compact('session.compaction.failed');
  const diagnostic = records().find(e => e.type === 'session.compaction.failed');
  assert.equal(diagnostic.failureClassification, 'provider reply rejected: missing required Markdown template heading');
  report.diagnosis = { classification: diagnostic.failureClassification, twoDispatches: records().filter(e => e.type === 'dispatch' && e.kind === 'compaction').length === 2,
    explanation: 'Pinned host validates Markdown headings, then issues one correction request before failing. Not an AISDK transport retry, JSON schema or required tool call.' };
  fs.unlinkSync(`${root}/fail`);
  assert.equal(await primary('Resume after failed synthetic compaction.'), 0);
  report.controls.failedCompaction = true;
  await compact('session.compaction.ended');
  assert.equal(await primary('Resume synthetic resume probe.'), 1);
  assert.equal(await primary('Later synthetic probe.'), 0);
  report.controls.successThenNextPrimaryOnly = true;
  // Each successful repeat has new primary history and delivers a fresh, one-shot sentinel.
  await compact('session.compaction.ended');
  assert.equal(await primary('Resume after first repeated successful compaction.'), 1);
  assert.equal(await primary('Ordinary turn between repeated compactions.'), 0);
  await compact('session.compaction.ended');
  assert.equal(await primary('Resume after second repeated successful compaction.'), 1);
  assert.equal(await primary('Final ordinary synthetic turn.'), 0);
  report.controls.repeatedRealCompactions = true;
  // Separate refusal control: no new primary history after this successful compaction.
  // Failure must retire the already armed opportunity rather than deliver stale recovery.
  await compact('session.compaction.ended');
  const beforeEmpty = records().filter(e => e.type === 'dispatch').length;
  await compact('session.compaction.failed');
  const refusal = records().filter(e => e.type === 'session.compaction.failed').at(-1);
  assert.equal(refusal.failureClassification, 'compaction unavailable: nothing new to compact');
  assert.equal(records().filter(e => e.type === 'dispatch').length, beforeEmpty, 'empty re-compaction never reaches provider');
  assert.equal(await primary('Resume after empty re-compaction refusal.'), 0);
  report.controls.emptyRecompactionArmsNothing = true;
  report.emptyRecompactionClassification = refusal.failureClassification;
  const all = records();
  const lifecycle = all.filter(e => e.type.startsWith('session.compaction.'));
  assert.equal(lifecycle.length, 12, 'six real compactions each have a start and terminal event');
  assert.ok(lifecycle.every(e => e.sourceMatches && e.accepted && e.duplicateRejected));
  report.controls.duplicateMetadataRejected = true;
  assert.equal(all.some(e => ['unexpected-http', 'subscription-failed'].includes(e.type)), false);
  const summaries = all.filter(e => e.type === 'dispatch' && e.kind === 'compaction');
  assert.equal(summaries.length, 6, 'two invalid-template dispatches and one per four successful compactions');
  assert.ok(summaries.every(e => e.sentinelCount === 0));
  report.controls.summarizationUnmodifiedAndSentinelFree = true;
  report.actualReasons = [...new Set(lifecycle.map(e => e.reason))];
  report.controls.subscriptionReplay = 'not exercised';
  report.controls.duplicateMetadataControlScope = 'Immediate test-only resubmission of projected metadata; not host subscription replay proof.';
  passed = true;
  }
} catch {
  report.failure = 'Runtime gate assertion or bounded wait failed; no raw host output retained.';
  process.exitCode = 1;
} finally {
  if (child.exitCode === null && !child.signalCode) {
    const exit = once(child, 'exit');
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
    try { await exit; } finally { clearTimeout(timer); }
  }
  report.hostStopped = child.exitCode !== null || child.signalCode !== null;
  const all = records();
  report.observerDisposed = all.some(e => e.type === 'disposed');
  const ids = new Map<string, number>();
  report.events = all.map(e => {
    const { sessionID, id, eventCreated, ...safe } = e;
    if (id && !ids.has(id)) ids.set(id, ids.size + 1);
    return { ...safe, ...(sessionID ? { session: labels.get(sessionID) ?? 'unknown' } : {}), ...(id ? { event: ids.get(id) } : {}) };
  });
  report.pass = passed && report.hostStopped && report.observerDisposed;
  if (!report.pass) process.exitCode = 1;
  fs.writeFileSync(`${root}/report.json`, JSON.stringify(report, null, 2));
}
