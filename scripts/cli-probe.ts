/** Public HTTP compatibility probe; no real configuration or credentials.
 * node scripts/cli-probe.ts ROOT CLI PORT
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import path from 'node:path';

const root = path.resolve(process.argv[2] ?? '');
const binary = path.resolve(process.argv[3] ?? '');
const port = Number(process.argv[4]);
if (!root.startsWith('/tmp/opencode/agent-progress-probe-') || !binary.startsWith('/tmp/opencode/') || !Number.isInteger(port) || port < 1024 || port > 65533) throw new Error('isolated-paths-and-port-required');
const env: NodeJS.ProcessEnv = {
  PATH: '/usr/bin:/bin', HOME: path.join(root, 'home'),
  XDG_CONFIG_HOME: path.join(root, 'config'), XDG_DATA_HOME: path.join(root, 'data'),
  XDG_STATE_HOME: path.join(root, 'state'), XDG_CACHE_HOME: path.join(root, 'cache'),
  AGENT_PROGRESS_PROBE_DESCRIPTOR: path.join(root, 'binding.json'),
  OPENCODE_PASSWORD: randomBytes(32).toString('base64url'),
};
const auth = `Basic ${Buffer.from(`opencode:${env.OPENCODE_PASSWORD}`).toString('base64')}`;
type Entry = { id: string; description?: string; activation?: string; [key: string]: unknown };
type Envelope = { data?: Entry[]; [key: string]: unknown };
async function request(route: string, body?: unknown, method?: string, targetPort = port): Promise<Envelope | null> {
  const response = await fetch(`http://127.0.0.1:${targetPort}${route}`, {
    method: method ?? (body === undefined ? 'GET' : 'POST'),
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { authorization: auth, 'content-type': 'application/json' },
    signal: AbortSignal.timeout(20_000),
  });
  if (response.status === 204) return null;
  if (!response.ok) return { httpStatus: response.status, body: await response.text() };
  return await response.json() as Envelope;
}
const pause = () => new Promise(resolve => setTimeout(resolve, 100));
async function waitFor<T>(read: () => Promise<T>, ready: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 10_000;
  while (true) {
    const value = await read();
    if (ready(value) || Date.now() >= deadline) return value;
    await pause();
  }
}
function start(targetPort: number, dataHome = env.XDG_DATA_HOME): ChildProcess {
  // serve prints a temporary password at startup; never retain its output.
  return spawn(binary, ['serve', '--hostname', '127.0.0.1', '--port', String(targetPort)], {
    env: { ...env, XDG_DATA_HOME: dataHome }, cwd: path.join(root, 'projects/Alpha'), stdio: 'ignore',
  });
}
async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
  child.kill('SIGTERM');
  try { await exited; } finally { clearTimeout(timer); }
}
async function ready(child: ChildProcess, targetPort: number) {
  const deadline = Date.now() + 10_000;
  while (true) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error('isolated-cli-exited');
    try { return await request('/api/info', undefined, undefined, targetPort); }
    catch {
      if (Date.now() >= deadline) throw new Error('isolated-cli-not-ready');
      await pause();
    }
  }
}
const selected = (value: Envelope | null) => value?.data?.filter(x => x.id === 'agent-progress-probe') ?? [];
const query = `?${new URLSearchParams({ 'location[directory]': path.join(root, 'projects/Alpha') })}`;
const entry = path.join(root, 'config/opencode/plugins/agent-progress-probe/index.js');
const original = await readFile(entry, 'utf8');
const children: ChildProcess[] = [];
const result: Record<string, unknown> = {};
try {
  const child = start(port); children.push(child);
  result.info = await ready(child, port);
  result.location = await request(`/api/location${query}`);
  const plugins = await waitFor(() => request(`/api/plugin${query}`), value => selected(value).length > 0);
  result.plugins = { ...plugins, data: selected(plugins) };
  const skills = await request(`/api/skill${query}`);
  result.skills = { ...skills, data: selected(skills) };
  const providers = await request(`/api/provider${query}`);
  // IDs/activation only; never settings or credential values.
  result.providers = providers?.data?.map(x => ({ id: x.id, activation: x.activation })) ?? [];
  const created = await request('/api/session', { title: 'Compatibility M', location: { directory: path.join(root, 'projects/Alpha') } });
  result.root = created;
  const sessionId = (created?.data as unknown as { id?: string } | undefined)?.id;
  if (sessionId) {
    result.child = await request('/api/session', { parentID: sessionId, title: 'Compatibility C1' });
    result.move = await request(`/api/session/${sessionId}/move`, { directory: path.join(root, 'projects/Alpha-worktree') });
    result.afterMove = await request(`/api/session/${sessionId}`);
  }
  await writeFile(entry, original.replace('Read before the isolated agent progress compatibility test.', 'Reloaded isolated compatibility probe.'));
  result.reload = await request('/api/location/reload', {}, 'POST');
  const updated = await waitFor(() => request(`/api/skill${query}`), value => selected(value).some(x => x.description === 'Reloaded isolated compatibility probe.'));
  result.updatedSkill = selected(updated);
  await writeFile(entry, original);
  for (const [label, targetPort, dataHome] of [
    ['sameScope', port + 1, env.XDG_DATA_HOME],
    ['unrelatedScope', port + 2, path.join(root, 'unrelated-data')],
  ] as const) {
    const other = start(targetPort, dataHome); children.push(other);
    await ready(other, targetPort);
    const observed = await waitFor(() => request(`/api/plugin${query}`, undefined, undefined, targetPort), value => selected(value).length > 0);
    result[label] = selected(observed);
  }
  // No model prompts/compaction without safe existing-provider authorization.
} finally {
  await writeFile(entry, original);
  await Promise.all(children.map(stop));
  result.processStopped = children.every(child => child.exitCode !== null || child.signalCode !== null);
}
console.log(JSON.stringify(result, null, 2));
