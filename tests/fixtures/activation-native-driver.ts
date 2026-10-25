/** Runs wholly within a fresh network namespace. Public client APIs only. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { networkInterfaces } from 'node:os';
import { OpenCode } from '@opencode/client';
import { ProgressStatus } from '../../plugin/status.ts';
import { Store } from '../../shared/store.ts';
import { ACTIVATION_GUIDANCE, ACTIVATION_HINT } from '../../plugin/activation.ts';
import { RELEASE } from '../../shared/release.ts';

const root = process.argv[2];
assert.notEqual(fs.readlinkSync('/proc/self/ns/net'), process.argv[3], 'must run in independent network namespace');
assert.deepEqual(Object.keys(networkInterfaces()), ['lo'], 'no external interface exists');
const env = {
  PATH: '/usr/bin:/bin', HOME: `${root}/home`, XDG_CONFIG_HOME: `${root}/config`, XDG_DATA_HOME: `${root}/data`,
  XDG_CACHE_HOME: `${root}/cache`, XDG_STATE_HOME: `${root}/state`, XDG_RUNTIME_DIR: `${root}/runtime`, TMPDIR: `${root}/tmp`,
  OPENCODE_PASSWORD: 'synthetic-local-only', DBUS_SESSION_BUS_ADDRESS: 'disabled:', ACTIVATION_EVENTS: `${root}/events.jsonl`,
  ACTIVATION_SDK: `file://${root}/sdk.mjs`,
};
fs.writeFileSync(`${root}/sdk.mjs`, 'export function createActivationFixture() { return {}; }\n');
const binary = '/tmp/opencode/agent-progress-probe-cli/opencode';
const version = spawnSync(binary, ['--version'], { env, encoding: 'utf8' });
assert.equal(version.status, 0); assert.match(version.stdout, /^opencode v2\.1\.4\s*$/);
console.log('runtime-version', version.stdout.trim());
const child = spawn(binary, ['serve', '--hostname', '127.0.0.1', '--port', '18765', '--print-logs', '--log-level', 'debug'], { cwd: `${root}/project`, env, stdio: ['ignore', 'pipe', 'pipe'] });
fs.writeFileSync(`${root}/host-pid`, String(child.pid));
const logs = fs.createWriteStream(`${root}/host.txt`); child.stdout.pipe(logs); child.stderr.pipe(logs);
const client = OpenCode.make({ baseUrl: 'http://127.0.0.1:18765', headers: { authorization: `Basic ${Buffer.from('opencode:synthetic-local-only').toString('base64')}` } });
const location = { directory: `${root}/project` };
const rpc = client.rpc(ProgressStatus);
try {
  const deadline = Date.now() + 15000;
  let status: any;
  while (Date.now() < deadline) {
    assert.equal(child.exitCode, null, 'owned host exited');
    try { status = await rpc.inspect({}, { location, signal: AbortSignal.timeout(1000) }); if (status.toolAvailable) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.equal(status?.toolAvailable, true, 'native plugin must load');
  assert.equal(status.version, RELEASE, 'loaded companion matches the candidate release');
  assert.equal((await client.credential.list()).length, 0, 'fresh host has no credentials');
  const session = await client.session.create({ location, agent: 'build', title: 'Synthetic activation fixture', model: { providerID: 'activation-fixture', id: 'script' }, permissions: [{ action: 'edit', resource: '*', effect: 'allow' }] });
  await client.session.prompt({ sessionID: session.id, text: 'Make a two-step plan for a search feature.' });
  await client.session.wait({ sessionID: session.id }, { signal: AbortSignal.timeout(15000) });
  const events = fs.readFileSync(`${root}/events.jsonl`, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  fs.writeFileSync(`${root}/session.json`, JSON.stringify(session));
  const after = events.filter(e => e.type === 'after');
  assert.equal(after.length, 5, 'scripted choices must reach native executors');
  assert.deepEqual(after.map(e => [e.tool, e.status]), [['write', 'completed'], ['write', 'completed'], ['edit', 'completed'], ['write', 'error'], ['agent_progress_report', 'completed']]);
  for (const event of after) { assert.equal(event.sessionID, session.id); assert.equal(event.agent, session.agent); assert.ok(event.messageID); assert.ok(event.id); }
  const contexts = events.filter(e => e.type === 'context');
  assert.ok(contexts.length >= 6, 'primary context and real tool continuations');
  assert.ok(contexts.every(e => e.sessionID === session.id && e.tools.includes('agent_progress_report')));
  assert.equal(events.some(e => e.type === 'unexpected-http'), false);
  const messages = await client.session.context({ sessionID: session.id });
  for (const event of after) assert.ok(messages.some(m => m.id === event.messageID), 'postwrite message belongs to independently queried host session');
  assert.equal(fs.readFileSync(`${root}/project/docs/plans/search.md`, 'utf8'), '# Search\nThird draft\n');
  const receipt = after[4].result.content;
  assert.equal(JSON.parse(typeof receipt === 'string' ? receipt : receipt.find((p: any) => p.type === 'text').text).rev, 1, 'real report receipt');
  const store = new Store(`${root}/store/progress.sqlite`);
  try { const plan = store.get(status.sourceId, 'native-structured'); assert.equal(plan?.sessionId, session.id); assert.equal(plan?.revision, 1); } finally { store.close(); }
  const childSession = await client.session.create({ location, parentID: session.id, agent: 'explore', title: 'Synthetic restricted child', model: { providerID: 'activation-fixture', id: 'script' } });
  await client.session.prompt({ sessionID: childSession.id, text: 'Consider a two-step search plan.' });
  await client.session.wait({ sessionID: childSession.id }, { signal: AbortSignal.timeout(10000) });
  const allEvents = fs.readFileSync(`${root}/events.jsonl`, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  const hidden = allEvents.find(e => e.type === 'context' && e.sessionID === childSession.id);
  assert.ok(hidden); assert.equal(hidden.agent, 'explore'); assert.equal(hidden.tools.includes('agent_progress_report'), false);
  const outgoing = allEvents.filter(e => e.type === 'driver');
  assert.ok(outgoing.length >= 7);
  assert.ok(outgoing[0].prompt.some((m: any) => m.role === 'user' && JSON.stringify(m.content).includes('Make a two-step plan for a search feature.')));
  assert.equal(outgoing[0].tools.includes('agent_progress_report'), true);
  assert.equal(outgoing.at(-1).tools.includes('agent_progress_report'), false, 'hiding reaches actual synthetic outgoing request');
  const systemText = (request: any) => request.prompt.filter((m: any) => m.role === 'system').map((m: any) => typeof m.content === 'string' ? m.content : JSON.stringify(m.content)).join('\n');
  const primary = outgoing.slice(0, 6).map(systemText);
  for (const text of primary) {
    assert.equal(text.includes(ACTIVATION_GUIDANCE), true, 'PRODUCTION guidance reaches actual outgoing request');
    assert.equal(text.split('# Agent progress (companion)').length - 1, 1, 'one owned section per primary request');
  }
  assert.deepEqual(primary.map(text => text.includes(ACTIVATION_HINT)), [false, true, true, true, false, false], 'native successful operations hint once; failed write and later continuation are base-only');
  assert.equal(systemText(outgoing.at(-1)).includes('# Agent progress (companion)'), false, 'hidden report tool receives no production instruction');
  assert.equal((await client.session.get({sessionID:childSession.id})).parentID, session.id);
  console.log('native-shapes', JSON.stringify(after));
  console.log('effective-tools', JSON.stringify({primary:contexts[0].tools, restrictedChild:hidden.tools}));
  console.log('synthetic-outgoing', JSON.stringify({requests:outgoing.length,neutralPromptObserved:true,primaryReportTool:true,restrictedChildReportTool:false,noManualSkillCalls:true,productionOwnedSections:6,productionHints:primary.map(text => text.includes(ACTIVATION_HINT)),hiddenToolGuidance:false}));
  console.log(JSON.stringify({ nativeHookInvocation: 'PROVED-production-guidance-and-hints', contexts: contexts.length, nativeExecutions: after.length, reportReceiptRevision: 1, credentials: 0, externalTransport: 'network-namespace-no-external-interface', modelCompliance: 'NOT TESTED' }));
} catch (error) {
  if (fs.existsSync(`${root}/events.jsonl`)) console.error('fixture-events', fs.readFileSync(`${root}/events.jsonl`, 'utf8').trim().split('\n').map(line => {const e=JSON.parse(line); return {type:e.type,tool:e.tool,status:e.status,index:e.index};}));
  console.error(JSON.stringify(await client.session.list({}, { signal: AbortSignal.timeout(1000) }).catch(() => 'unavailable')));
  throw error;
} finally {
  if (child.exitCode === null && !child.signalCode) { const exit = once(child, 'exit'); child.kill('SIGTERM'); const timer = setTimeout(() => child.kill('SIGKILL'), 5000); try { await exit; } finally { clearTimeout(timer); } }
  console.log('owned-host-stopped', child.exitCode, child.signalCode);
  if (fs.existsSync(`${root}/events.jsonl`)) {
    const disposed = fs.readFileSync(`${root}/events.jsonl`, 'utf8').trim().split('\n').map(line => JSON.parse(line)).some(e => e.type === 'disposed');
    assert.equal(disposed, true, 'host must invoke the separate observer disposer');
    console.log('test-observer-disposed', disposed);
  }
  logs.end();
}
