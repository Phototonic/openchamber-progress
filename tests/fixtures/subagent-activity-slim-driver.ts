/** Slim-only continuation: no accepted built-in matrix rerun or production Store dependency. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { networkInterfaces } from 'node:os';
import { OpenCode } from '@opencode/client';

const root = process.argv[2];
assert.match(root, /^\/tmp\/opencode\/subagent-activity-[A-Za-z0-9]+$/);
assert.notEqual(fs.readlinkSync('/proc/self/ns/net'), process.argv[3]);
assert.deepEqual(Object.keys(networkInterfaces()), ['lo']);
assert.equal(spawnSync('/usr/sbin/ip', ['route', 'show', 'default'], { encoding: 'utf8' }).stdout.trim(), '');
const env = { PATH: '/usr/bin:/bin', HOME: `${root}/home`, XDG_CONFIG_HOME: `${root}/config`, XDG_DATA_HOME: `${root}/data`, XDG_CACHE_HOME: `${root}/cache`, XDG_STATE_HOME: `${root}/state`, XDG_RUNTIME_DIR: `${root}/runtime`, TMPDIR: `${root}/tmp`, OPENCODE_PASSWORD: 'synthetic-local-only', DBUS_SESSION_BUS_ADDRESS: 'disabled:', ACTIVITY_ROOT: root };
const native = spawn(process.env.OPENCODE_BINARY!, ['serve', '--hostname', '127.0.0.1', '--port', '18767'], { cwd: `${root}/Alpha`, env, stdio: 'ignore' });
fs.writeFileSync(`${root}/host-pid`, String(native.pid));
const client = OpenCode.make({ baseUrl: 'http://127.0.0.1:18767', headers: { authorization: `Basic ${Buffer.from('opencode:synthetic-local-only').toString('base64')}` } });
const location = { directory: `${root}/Alpha` };
const records = (): any[] => fs.existsSync(`${root}/events.jsonl`) ? fs.readFileSync(`${root}/events.jsonl`, 'utf8').trim().split('\n').filter(Boolean).map(s => JSON.parse(s)) : [];
const report: any = { mode: 'slim', pass: false, isolation: { distinctNetworkNamespace: true, interfaces: ['lo'], defaultRoute: false }, scenarios: {} };
const labels = new Map<string, string>();
const wait = async (condition: () => boolean | Promise<boolean>) => {
  const end = Date.now() + 25000;
  while (Date.now() < end) { if (await condition()) return true; await new Promise(r => setTimeout(r, 30)); }
  return false;
};
let stage = 'startup';
try {
  assert.ok(await wait(async () => { try { await client.agent.list({ location }, { signal: AbortSignal.timeout(1000) }); return records().some(e => e.type === 'registered'); } catch { return false; } }));
  assert.equal((await client.credential.list()).length, 0); report.isolation.credentials = 0;
  const inventory = await client.plugin.list({ location });
  report.plugins = inventory.data.map(p => ({ id: ['oh-my-opencode-slim', 'subagent-activity-probe'].includes(p.id ?? '') ? p.id : 'other', status: p.state.status }));
  const setup = records().find(e => e.type === 'slim-phase' && e.phase === 'setup-completed');
  report.activation = { entryLoaded: records().some(e => e.type === 'slim-phase' && e.phase === 'entry-loaded'), setupCompleted: Boolean(setup), registeredBefore: setup?.hooks?.['execute.before'] ?? 0, registeredAfter: setup?.hooks?.['execute.after'] ?? 0 };
  assert.ok(report.activation.entryLoaded && report.activation.setupCompleted && report.activation.registeredBefore > 0, 'slim activation prerequisite; no unverified matrix fallback');
  const a = await client.session.create({ location, agent: 'build', title: 'Synthetic slim fixture', model: { providerID: 'activity-fixture', id: 'script' } }); labels.set(a.id, 'A');
  const call = (id: string, agent: string, extra: object = {}) => ({ id, input: { agent, description: `Synthetic ${id}`, prompt: `Synthetic isolated ${id} input.`, ...extra } });
  const prompt = async (generation: number, calls: any[]) => {
    fs.writeFileSync(`${root}/jobs.json`, JSON.stringify({ [a.id]: { generation, calls } }));
    await client.session.prompt({ sessionID: a.id, text: 'Synthetic slim probe input.' });
    await client.session.wait({ sessionID: a.id }, { signal: AbortSignal.timeout(30000) });
  };
  stage = 'foreground'; await prompt(1, [call('slim-foreground', 'restricted-worker')]);
  const first = records().find(e => e.type === 'after' && e.callID === 'slim-foreground');
  if (first?.childID) labels.set(first.childID, 'C1');
  report.scenarios.foreground = Boolean(first?.childID && first.native?.parentID === a.id && first.native.complete);
  stage = 'background'; await prompt(2, [call('slim-background', 'restricted-worker', { background: true })]);
  const background = records().find(e => e.type === 'after' && e.callID === 'slim-background');
  if (background?.childID) { labels.set(background.childID, 'C2'); await client.session.wait({ sessionID: background.childID }, { signal: AbortSignal.timeout(30000) }); }
  report.scenarios.background = Boolean(background?.childID && background.native?.parentID === a.id && background.native.complete);
  stage = 'resume';
  if (first?.childID) {
    await prompt(3, [call('slim-resume', 'restricted-worker', { sessionID: first.childID })]);
    const resume = records().find(e => e.type === 'after' && e.callID === 'slim-resume');
    report.scenarios.resumeSameID = Boolean(resume?.childID && resume.childID === first.childID && resume.native?.parentID === a.id);
  } else report.scenarios.resume = 'not-exercised-without-verified-child';
  stage = 'competing'; await prompt(4, [call('parallel-slow', 'slow-worker'), call('parallel-fast', 'restricted-worker')]);
  report.scenarios.competingResults = records().filter(e => e.type === 'after' && e.callID?.startsWith('parallel-')).map(e => ({ call: e.callID, status: e.status, verifiedNativeChild: Boolean(e.childID && e.native?.parentID === a.id) }));
  const before = records().filter(e => e.type === 'before');
  report.scenarios.missingAfter = before.filter(e => !records().some(a => a.type === 'after' && a.callID === e.callID && a.sessionID === e.sessionID)).map(e => e.callID);
  report.effectiveTool = records().filter(e => e.type === 'slim-phase' && e.phase === 'effective-tool').map(({ type, phase, ...value }) => value);
  report.slimHooksActuallyCalled = records().filter(e => e.type === 'slim-phase' && e.phase === 'hook-called').length;
  report.pass = true;
} catch {
  report.failure = `Slim continuation stopped at ${stage}; raw errors/host output discarded.`; process.exitCode = 1;
} finally {
  if (native.exitCode === null && !native.signalCode) {
    const done = once(native, 'exit'); native.kill('SIGTERM'); const timer = setTimeout(() => native.kill('SIGKILL'), 5000);
    try { await done; } finally { clearTimeout(timer); }
  }
  const all = records();
  for (const e of all) for (const id of [e.sessionID, e.childID, e.parentID, e.native?.id, e.native?.parentID, ...(e.native?.ancestry ?? [])]) if (id && !labels.has(id)) labels.set(id, `other-${labels.size + 1}`);
  const messages = new Map<string, string>();
  report.events = all.map(e => {
    const { sessionID, childID, parentID, native, messageID, resumeID, delegationSchema, ...safe } = e;
    if (messageID && !messages.has(messageID)) messages.set(messageID, `message-${messages.size + 1}`);
    return { ...safe, ...(sessionID ? { session: labels.get(sessionID) } : {}), ...(childID ? { child: labels.get(childID) } : {}), ...(parentID ? { parent: labels.get(parentID) } : {}),
      ...(native ? { native: { session: labels.get(native.id), parent: labels.get(native.parentID), ancestry: native.ancestry?.map((id: string) => labels.get(id)), complete: native.complete, sameDirectory: native.sameDirectory, outcome: native.outcome } } : {}),
      ...(messageID ? { message: messages.get(messageID) } : {}), ...(resumeID ? { resume: labels.get(resumeID) } : {}),
      ...(delegationSchema ? { delegationSchema: { type: delegationSchema.type, required: delegationSchema.required, properties: Object.keys(delegationSchema.properties ?? {}) } } : {}) };
  });
  report.hostStopped = native.exitCode !== null || native.signalCode !== null;
  report.observerDisposed = all.some(e => e.type === 'disposed');
  report.externalRequests = all.filter(e => e.type === 'unexpected-http').length;
  report.pass = report.pass && report.hostStopped && report.observerDisposed && report.externalRequests === 0;
  if (!report.pass) process.exitCode = 1;
  fs.writeFileSync(`${root}/report.json`, JSON.stringify(report, null, 2));
}
