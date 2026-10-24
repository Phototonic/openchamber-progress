/** Synthetic-only free-model compatibility probe. No credentials or user content. */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { once } from 'node:events';

const root = '/tmp/opencode/agent-progress-probe-live-t1b';
const binary = '/tmp/opencode/agent-progress-probe-cli/opencode';
const port = 41974;
const phase = process.argv[2] ?? 'catalog';
const password = randomBytes(32).toString('base64url');
const env = { PATH: '/usr/bin:/bin', HOME: `${root}/home`, XDG_CONFIG_HOME: `${root}/config`,
  XDG_DATA_HOME: `${root}/data`, XDG_STATE_HOME: `${root}/state`, XDG_CACHE_HOME: `${root}/cache`,
  AGENT_PROGRESS_PROBE_DESCRIPTOR: `${root}/binding.json`, OPENCODE_PASSWORD: password };
const authorization = `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`;
async function request(route: string, body?: unknown, method?: string, timeout = 20_000): Promise<any> {
  const res = await fetch(`http://127.0.0.1:${port}${route}`, {
    method: method ?? (body === undefined ? 'GET' : 'POST'),
    headers: { authorization, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeout),
  });
  if (res.status === 204) return null;
  const value = await res.json();
  if (!res.ok) throw new Error(`public-api-${res.status}:${JSON.stringify(value)}`);
  return value;
}
const pause = () => new Promise(resolve => setTimeout(resolve, 100));
const child = spawn(binary, ['serve', '--hostname', '127.0.0.1', '--port', String(port)], {
  env, cwd: `${root}/projects/Alpha`, stdio: 'ignore',
});
const result: Record<string, unknown> = { phase, syntheticOnly: true };
const configFile = `${root}/config/opencode/opencode.json`;
const originalConfig = await readFile(configFile, 'utf8');
try {
  const deadline = Date.now() + 10_000;
  while (true) {
    if (child.exitCode !== null) throw new Error('isolated-server-exited');
    try { result.info = await request('/api/info'); break; }
    catch { if (Date.now() >= deadline) throw new Error('isolated-server-not-ready'); await pause(); }
  }
  const query = `?${new URLSearchParams({ 'location[directory]': `${root}/projects/Alpha` })}`;
  let models: any[] = [];
  const settled = Date.now() + 10_000;
  while (true) {
    models = (await request(`/api/model${query}`)).data;
    if (models.some(m => /big.?pickle/i.test(`${m.id} ${m.name}`)) || Date.now() >= settled) break;
    await pause();
  }
  const candidates = models.filter(m => /big.?pickle/i.test(`${m.id} ${m.name}`));
  result.catalog = candidates.map(({ id, modelID, providerID, name, enabled, status, cost, limit, capabilities }) => ({ id, modelID, providerID, name, enabled, status, cost, limit, capabilities }));
  result.agents = (await request(`/api/agent${query}`)).data.map(({ id, mode, model, steps, request, permissions }: any) => ({ id, mode, model, steps, settings: request?.settings, permissions }));
  if (phase !== 'catalog') {
    const chosen = candidates.find(m => m.id === 'big-pickle' && m.providerID === 'opencode');
    if (!chosen?.enabled || chosen.status !== 'active' || !chosen.capabilities.tools || !chosen.cost.length || !chosen.cost.every((c: any) => c.input === 0 && c.output === 0 && c.cache.read === 0 && c.cache.write === 0)) throw new Error('confirmed-free-tool-model-required');
    const model = { providerID: 'opencode', id: 'big-pickle' };
    const config = JSON.parse(originalConfig);
    config.model = 'opencode/big-pickle';
    config.providers = { opencode: { models: { 'big-pickle': { body: { max_tokens: 900 } } } } };
    config.agents = Object.fromEntries(['build', 'general', 'explore', 'compaction', 'title', 'summary'].map(id => [id, { model: 'opencode/big-pickle', ...(id === 'build' || id === 'general' ? { steps: 6 } : {}) }]));
    await writeFile(configFile, JSON.stringify(config));
    await request('/api/location/reload', {});
    if (phase !== 'root') throw new Error('only-catalog-or-one-root-attempt-supported');
    async function run(id: string, text: string) {
      await request(`/api/session/${id}/model`, { model });
      result.admission = await request(`/api/session/${id}/prompt`, { text });
      try { await request(`/api/experimental/session/${id}/wait`, {}, 'POST', 70_000); }
      catch (error) { await request(`/api/session/${id}/interrupt`, { resume: false }); throw error; }
    }
    const created = await request('/api/session', { title: 'Synthetic progress fixture M', model, agent: 'build', location: { directory: `${root}/projects/Alpha` } });
    const id = created.data.id;
    result.syntheticPrompt = 'Synthetic compatibility test only. No file reads, shell, external tools or delegation. Keep fixture objective P1: A done, B working; remember marker PICKLE-P1. First invoke the skill tool for agent-progress-probe. Then call agent_progress_report with operation inspect. Then call agent_progress_report with operation report, operationId pickle-root-1, expectedRevision 0. Reply only OK. Do not infer plan completion.';
    await run(id, String(result.syntheticPrompt));
    result.session = (await request(`/api/session/${id}`)).data;
    result.context = (await request(`/api/session/${id}/context`)).data.map(({ id, type, time, agent, model, content, tokens, cost, finish, error, skill, name, text, summary, status }: any) => ({ id, type, time, agent, model, content, tokens, cost, finish, error: error ? { type: error.type, message: error.message, status: error.status, retryAfterMs: error.retryAfterMs } : undefined, skill, name, ...(type === 'skill' ? { text } : {}), summary, status }));
    result.requestedOutputCap = { providerBody: { max_tokens: 900 }, note: 'Configured through documented model body override; not a captured wire request.' };
  }
} finally {
  await writeFile(configFile, originalConfig);
  if (child.exitCode === null && child.signalCode === null) {
    const exit = once(child, 'exit'); const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
    child.kill('SIGTERM'); try { await exit; } finally { clearTimeout(timer); }
  }
  result.processStopped = true;
  await writeFile(`evidence/compatibility/backend-model-${phase}.json`, JSON.stringify(result, null, 2));
}
console.log(JSON.stringify(result, null, 2));
