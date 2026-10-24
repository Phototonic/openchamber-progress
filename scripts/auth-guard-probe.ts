/** Shared fresh destination preparation. --live remains review-blocked. */
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, lstatSync, existsSync, readdirSync, realpathSync } from 'node:fs';
import { once } from 'node:events';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OpenCode } from '@opencode/client';
import { createDisposable } from './auth-transfer.ts';
import { Control, METHODS, PROVIDER, DEFAULT_MODEL, changeState, readState, type Ledger } from '../tests/fixtures/auth-guard.ts';
import { LIVE_CLEARANCE, destinationClient, runRootWithCopy } from './auth-live.ts';
import { resolveManagedSource, LiveSafetyError, type Source } from './auth-source.ts';
import { runSubtests, type SubtestResult } from './auth-subtests.ts';

const live = process.argv[2] === '--live' && LIVE_CLEARANCE;
const scenario = process.argv[3] ?? 'root';
if ((process.argv[2] !== '--synthetic' && !live) || !['root', 'native-move', 'compaction'].includes(scenario)) {
  console.log(JSON.stringify({ liveEnabled: false, requiredMode: '--synthetic' })); process.exit(2);
}
process.umask(0o077);
const owned = createDisposable(); const root = owned.root;
const binary = '/tmp/opencode/agent-progress-probe-cli/opencode';
const locations = ['Alpha', 'Native', 'Alpha-worktree'].map(n => `${root}/projects/${n}`);
let modelID = DEFAULT_MODEL;
let source: Source | undefined;
function writeConfig() {
  const model = `${PROVIDER}/${modelID}`;
  const agents = Object.fromEntries(['build', 'plan', 'general', 'explore', 'compaction', 'title', 'summary'].map(id => [id, { model, steps: 3 }]));
  writeFileSync(`${root}/config/opencode/opencode.json`, JSON.stringify({ $schema: 'https://opencode.ai/config.json', update: 'disable', snapshots: false, model, agents }), { mode: 0o600 });
}
let child: ReturnType<typeof spawn> | undefined; let port = 0; let credentialID: string | undefined;
let spawnFailed = false;
let destination: ReturnType<typeof OpenCode.make> | undefined;
let stage = 'prepare'; let failure: string | undefined;
const result: Record<string, unknown> = { syntheticOnly: !live, sourceAccess: false };
const subtests: SubtestResult[] = [];
const abort = new AbortController();
const cancel = () => abort.abort(); process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
class PreparationError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; }
}
function check(value: unknown, code: string): asserts value { if (!value || abort.signal.aborted) throw new PreparationError(code); }
const sleep = () => new Promise(resolve => setTimeout(resolve, 100));
const password = randomBytes(32).toString('base64url');
const headers = { authorization: `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}` };
const env = { PATH: '/usr/bin:/bin', HOME: `${root}/home`, XDG_CONFIG_HOME: `${root}/config`, XDG_DATA_HOME: `${root}/data`, XDG_STATE_HOME: `${root}/state`, XDG_CACHE_HOME: `${root}/cache`, XDG_RUNTIME_DIR: `${root}/runtime`, TMPDIR: `${root}/tmp`, DBUS_SESSION_BUS_ADDRESS: 'disabled:', M1_GUARD_ROOT: root, OPENCODE_PASSWORD: password };
const apiCalls: { method: string; route: string }[] = [];
async function api(route: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') {
  check(Boolean(port), 'no-port');
  apiCalls.push({ method, route: route.split('?')[0].replace(/ses_[^/]+/g, '<synthetic-session>') });
  const response = await fetch(`http://127.0.0.1:${port}${route}`, { method, headers: { ...headers, 'content-type': 'application/json' }, redirect: 'error', body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
  check(response.ok, 'destination-http');
  return response.status === 204 ? null : await response.json();
}
async function stop(hard = false) {
  if (!child || spawnFailed || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit'); const timer = setTimeout(() => child?.kill('SIGKILL'), 10_000);
  child.kill(hard ? 'SIGKILL' : 'SIGTERM'); try { await exited; } finally { clearTimeout(timer); }
}
try {
  for (const dir of ['home', 'config/opencode/plugins/m1-auth-guard', 'data', 'state', 'cache', 'runtime', 'tmp', ...locations.map(d => path.relative(root, d))]) mkdirSync(`${root}/${dir}`, { recursive: true, mode: 0o700 });
  for (let dir = path.dirname(root); ; dir = path.dirname(dir)) {
    for (const name of ['opencode.json', 'opencode.jsonc', '.opencode/opencode.json', '.opencode/opencode.jsonc']) check(!existsSync(path.join(dir, name)), 'ancestor-config');
    if (dir === path.dirname(dir)) break;
  }
  check(!existsSync('/etc/opencode'), 'system-config');
  if (live) {
    stage = 'source-model-catalog'; result.sourceAccess = true;
    source = await resolveManagedSource(abort.signal);
    const selected = (await source.models()).find(m => m.providerID === PROVIDER && m.capabilities.tools);
    if (!selected) throw new LiveSafetyError('selection');
    modelID = selected.id;
  }
  result.model = { providerID: PROVIDER, id: modelID };
  writeConfig();
  writeFileSync(`${root}/guard-state.json`, JSON.stringify({ pid: 0, locations, armed: false, deadline: Date.now() + 120_000, dispatches: 0, activations: {}, shaped: {}, retriesDenied: 0 } satisfies Ledger), { mode: 0o600 });
  const out = `${root}/config/opencode/plugins/m1-auth-guard/index.js`;
  const entry = `${root}/guard-entry.ts`;
  writeFileSync(entry, `export { default } from ${JSON.stringify(fileURLToPath(new URL('../tests/fixtures/auth-guard.ts', import.meta.url)))};`, { mode: 0o600 });
  const built = spawnSync('bun', ['build', entry, '--target=node', '--format=esm', `--outfile=${out}`], { env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: env.HOME, TMPDIR: env.TMPDIR }, stdio: 'ignore' });
  check(built.status === 0, 'fixture-build');
  // Self-contained approved SDK bundle: no file-URL rewriting, dependency symlink,
  // package install or path alias to another profile.
  writeFileSync(`${root}/config/opencode/plugins/m1-auth-guard/package.json`, JSON.stringify({ name: 'm1-auth-guard', version: '0.0.1', type: 'module', exports: { '.': './index.js' } }), { mode: 0o600 });
  {
    const pluginDir = `${root}/config/opencode/plugins/agent-progress-probe`;
    mkdirSync(pluginDir, { mode: 0o700 });
    const progressBuild = spawnSync('bun', ['build', fileURLToPath(new URL('../plugin/index.ts', import.meta.url)), '--target=node', '--format=esm', `--outfile=${pluginDir}/index.js`], { env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: env.HOME, TMPDIR: env.TMPDIR }, stdio: 'ignore' });
    check(progressBuild.status === 0, 'progress-build');
    writeFileSync(`${pluginDir}/package.json`, JSON.stringify({ name: 'agent-progress-probe', version: '0.0.1', type: 'module', exports: { '.': './index.js' } }), { mode: 0o600 });
    const descriptor = `${root}/descriptor.json`;
    writeFileSync(descriptor, JSON.stringify({ database: `${root}/progress.db`, probeOnly: true, dataHome: env.XDG_DATA_HOME, configHome: env.XDG_CONFIG_HOME }), { mode: 0o600 });
    Object.assign(env, { AGENT_PROGRESS_PROBE_DESCRIPTOR: descriptor });
  }
  const paths = execFileSync(binary, ['debug', 'paths'], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const actualPaths = Object.fromEntries(paths.trim().split('\n').map(line => { const [name, ...parts] = line.trim().split(/\s+/); return [name, parts.join(' ')]; }));
  check(Object.values(actualPaths).every(p => p.startsWith(`${root}/`)), 'runtime-path-escape'); result.paths = actualPaths;
  const reservation = createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
  port = (reservation.address() as { port: number }).port; await new Promise<void>(resolve => reservation.close(() => resolve()));
  child = spawn(binary, ['serve', '--hostname', '127.0.0.1', '--port', String(port)], { cwd: locations[0], env, stdio: 'ignore' });
  child.once('error', () => { spawnFailed = true; abort.abort(); });
  check(child.pid, 'spawn'); changeState(root, s => { s.pid = child!.pid!; });
  stage = 'startup';
  const end = Date.now() + 15_000; let info: any;
  while (Date.now() < end) {
    check(child.exitCode === null, 'server-exited');
    try { info = await api('/api/info'); break; } catch { await sleep(); }
  }
  check(info?.pid === child.pid && info.version === '2.1.4', 'server-identity');
  const exe = realpathSync(`/proc/${child.pid}/exe`); check(exe === binary, 'wrong-executable');
  const processEnv = Object.fromEntries(readFileSync(`/proc/${child.pid}/environ`, 'utf8').split('\0').filter(p => p.includes('=')).map(p => [p.slice(0, p.indexOf('=')), p.slice(p.indexOf('=') + 1)]));
  check(['HOME', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME', 'XDG_STATE_HOME', 'XDG_RUNTIME_DIR', 'TMPDIR'].every(k => processEnv[k] === env[k as keyof typeof env]), 'process-scope');
  // Only owned synthetic child environment is inspected; no source process/env.
  result.runtime = { version: info.version, pid: info.pid, independentBinary: true, allowlistedPathsMatched: true };
  const schema = await api('/openapi.json');
  check(schema.paths['/api/credential'].get.operationId === 'credential.list' && schema.paths['/api/credential'].post.operationId === 'credential.create' && schema.paths['/api/credential/{credentialID}'].delete.operationId === 'credential.remove', 'api-schema');
  result.schemaRoutesVerified = true;
  destination = OpenCode.make({ baseUrl: `http://127.0.0.1:${port}`, headers });
  check((await destination.credential.list()).length === 0, 'not-empty'); result.emptyBeforeWarm = true;
  stage = 'model-catalog';
  // Empty providers are availability-gated. Synthetic mode uses the pinned,
  // source-derived metadata snapshot without accessing real source auth.
  changeState(root, s => { s.modelID = modelID; });
  const rpc = destination.rpc(Control);
  const snapshots: unknown[] = [];
  stage = 'prewarm';
  for (const directory of locations) {
    const query = `?${new URLSearchParams({ 'location[directory]': directory })}`;
    await api(`/api/location${query}`);
    const readyBy = Date.now() + 15_000; let active = false;
    while (Date.now() < readyBy) {
      const plugins = await api(`/api/plugin${query}`);
      result.localPluginStates = plugins.data.filter((p: any) => p.source?.type === 'local').map((p: any) => ({ id: p.id, status: p.state.status,
        fixtureErrorCode: typeof p.state.error === 'string' ? p.state.error.match(/m1-[a-z-]+/)?.[0] ?? null : null,
        moduleError: p.state.status === 'failed' ? 'load-or-setup-failed' : null }));
      const guard = plugins.data.find((p: any) => p.id === 'm1-auth-guard');
      if (guard?.state.status === 'active') { active = true; break; }
      if (guard?.state.status === 'failed') break;
      await sleep();
    }
    check(active, 'guard-not-active'); snapshots.push(await rpc.inspect({}, { location: { directory } }));
  }
  check(Object.keys(readState(root).activations).length === locations.length, 'warm-coverage');
  check((await destination.credential.list()).length === 0, 'not-empty-after-warm');
  {
    stage = 'guard-progress-preflight';
    for (const directory of locations) {
      const query = `?${new URLSearchParams({ 'location[directory]': directory })}`;
      const plugins = (await api(`/api/plugin${query}`)).data;
      check(plugins.some((p: any) => p.id === 'agent-progress-probe' && p.state.status === 'active'), 'progress-not-active');
      const snapshot = await rpc.inspect({}, { location: { directory } }) as any;
      check(snapshot.progressToolAvailable && snapshot.narrowedCatalogTools?.length === 1 && snapshot.narrowedCatalogTools[0] === 'agent_progress_report', 'progress-tool-missing');
      const actualAgents = (await api(`/api/agent${query}`)).data;
      if (!live) result.agentBindings = actualAgents.map((a: any) => ({ id: a.id, model: a.model }));
      check(actualAgents.length > 0 && actualAgents.every((a: any) => a.model?.providerID === PROVIDER && a.model?.id === modelID), 'agent-binding');
    }
  }
  let session: any; let childID: string | undefined;
  if (live || scenario !== 'root') {
    stage = 'scenario-root-create';
    session = (await api('/api/session', { title: 'M1 bounded synthetic root', model: { providerID: PROVIDER, id: modelID }, agent: 'build', location: { directory: locations[0] } })).data;
    if (scenario === 'native-move') {
      stage = 'scenario-native-create';
      const createdNative = (await api('/api/session', { title: 'M1 bounded synthetic native', parentID: session.id, model: { providerID: PROVIDER, id: modelID }, agent: 'general' })).data;
      // Native children inherit their parent's location; relocate explicitly
      // through the public API while EMPTY and every target is prewarmed.
      stage = 'scenario-native-move';
      await api(`/api/session/${createdNative.id}/move`, { directory: locations[1] });
      const native = (await api(`/api/session/${createdNative.id}`)).data;
      stage = 'scenario-native-identity';
      result.scenarioSetup = { parentMatches: native.parentID === session.id, nativeDirectoryMatches: native.location?.directory === locations[1] };
      check(native.parentID === session.id, 'native-parent');
      check(native.location?.directory === locations[1], 'native-location'); childID = native.id;
    }
  }
  if (live) {
    const deadline = Date.now() + 90_000;
    changeState(root, s => { s.deadline = deadline; s.armed = true; s.live = { sessionID: session.id, admissions: 0, toolSnapshots: 0, failed: false, bindings: { [session.id]: { agent: 'build', directory: locations[0] }, ...(childID ? { [childID]: { agent: 'general', directory: locations[1] } } : {}) } }; });
    const timer = setTimeout(() => { abort.abort(); child?.kill('SIGKILL'); }, Math.max(0, deadline - Date.now()));
    try {
      // First source metadata/auth access is HERE, never during synthetic mode.
      check(source, 'source-not-attested');
      stage = 'bounded-root';
      result.live = await runRootWithCopy({ source, destination: destinationClient(`http://127.0.0.1:${port}`, password, fetch, abort.signal), endpoint: `http://127.0.0.1:${port}`, pid: child.pid!, root, sessionID: session.id, modelID, deadline, signal: abort.signal,
        assertReady() { check(!abort.signal.aborted && Date.now() < deadline && child?.exitCode === null && child.signalCode === null, 'deadline'); const s = readState(root); check(s.armed && s.live && !s.live.failed && s.live.admissions <= 6 && s.dispatches <= 12 && s.locations.length === 3 && Object.keys(s.activations).length === 3, 'ledger'); },
        stop, dispose() { /* outer finally owns disposal after sanitized counters */ },
        ...(scenario !== 'root' ? { exercise: (destination: ReturnType<typeof destinationClient>, boundary: () => void) => runSubtests({ scenario: scenario as 'native-move' | 'compaction', destination, rootID: session.id, childID, nativeDirectory: locations[1], moveDirectory: locations[2], rootDirectory: locations[0], boundary, results: subtests,
          snapshot() { const s = readState(root); return { admissions: s.live?.admissions ?? 0, dispatches: s.dispatches, toolSnapshots: s.live?.toolSnapshots ?? 0, httpStatuses: s.httpStatuses ?? [], admissionKinds: s.admissionKinds ?? {}, dispatchKinds: s.dispatchKinds ?? {} }; },
          moveBinding() { changeState(root, s => { check(s.live?.bindings && s.locations.includes(locations[2]), 'move-binding'); s.live.bindings[session.id].directory = locations[2]; }); },
        }) } : {}),
      });
      if (scenario !== 'root') {
        (result.live as any).completedProgressCalls = subtests.reduce((n, r) => n + r.completedProgressCalls, 0);
        (result.live as any).skipped = ['slim', 'parent-relay'];
      }
      const s = readState(root); result.counters = { admissions: s.live?.admissions, dispatches: s.dispatches, toolSnapshots: s.live?.toolSnapshots };
      result.failureCode = (result.live as any).failure;
      if (result.failureCode) failure = 'bounded-root';
    } finally { clearTimeout(timer); }
  } else {
  const main = (await api('/api/session', { title: 'M1 synthetic parent', location: { directory: locations[0] } })).data;
  const native = (await api('/api/session', { title: 'M1 synthetic native child', parentID: main.id, agent: 'general' })).data;
  await api(`/api/session/${native.id}/move`, { directory: locations[1] });
  check((await api(`/api/session/${native.id}`)).data.parentID === main.id, 'native-ancestry');
  changeState(root, s => { s.armed = true; }); result.locationsWarmBeforeImport = locations; result.startupSnapshots = snapshots;
  const resolutions: unknown[] = []; const authorizations: unknown[] = [];
  stage = 'fake-expired-resolution';
  for (const methodID of METHODS) {
    const created = await destination.credential.create({ integrationID: 'openai', label: 'M1 SYNTHETIC ONLY', value: { type: 'oauth', methodID, access: 'M1-FAKE-ACCESS-NOT-AUTH', refresh: 'M1-FAKE-REFRESH-NOT-AUTH', expires: 0, metadata: { clientID: 'synthetic-client', m1Synthetic: true } }, activate: true });
    credentialID = created.id;
    check(created.value.type === 'oauth' && created.value.expires === 0 && created.value.methodID === methodID, 'fake-mutated');
    for (const directory of locations) {
      const resolved = await rpc.resolve({ credentialID, method: methodID }, { location: { directory } }) as Record<string, unknown>;
      check(resolved.refused && resolved.guardInvocationsIncreased, 'refresh-guard-not-exercised'); resolutions.push(resolved);
      const denied = await rpc.authorize({ method: methodID }, { location: { directory } }) as Record<string, unknown>;
      check(denied.refused && denied.guardInvocationsIncreased, 'authorize-guard-not-exercised'); authorizations.push({ directory, ...denied });
    }
    await api(`/api/session/${main.id}/move`, { directory: locations[2] });
    const afterMove = await rpc.resolve({ credentialID, method: methodID }, { location: { directory: locations[2] } }) as Record<string, unknown>;
    check(afterMove.refused && afterMove.guardInvocationsIncreased, 'move-guard');
    await destination.credential.remove({ credentialID }); credentialID = undefined;
    check((await destination.credential.list()).length === 0, 'remove-incomplete');
    check(Object.keys(readState(root).activations).length === locations.length, 'unexpected-location');
  }
  result.resolutions = resolutions; result.authorizations = authorizations;
  stage = 'synthetic-hook-pipeline'; const pipeline: unknown[] = [];
  for (let i = 0; i < 13; i++) {
    const kind = ['primary', 'compaction', 'generate', 'title'][i % 4];
    const reply = await rpc.pipeline({ kind }, { location: { directory: locations[i % 3] } }) as Record<string, unknown>;
    check(reply.shapedMaxTokens === 900 && reply.retryDenied && reply.transportCalls === 0 && reply.allowed === (i < 12), 'pipeline-bound'); pipeline.push(reply);
  }
  result.pipeline = pipeline;
  const postRemovalGuards: unknown[] = [];
  for (let i = 0; i < locations.length; i++) {
    const denied = await rpc.authorize({ method: METHODS[i] }, { location: { directory: locations[i] } }) as Record<string, unknown>;
    check(denied.refused && denied.guardInvocationsIncreased, 'guard-removed-before-cleanup');
    postRemovalGuards.push({ directory: locations[i], ...denied });
  }
  result.postRemovalGuards = postRemovalGuards;
  result.finalLedger = readState(root);
  const remaining = await destination.credential.list(); check(remaining.length === 0, 'credential-remains'); result.credentialsRemovedBeforeStop = true;
  const secretFiles: { name: string; mode: number }[] = [];
  function modes(dir: string) { for (const name of readdirSync(dir)) { const file = `${dir}/${name}`; const s = lstatSync(file); check(!s.isSymbolicLink(), 'runtime-symlink'); if (s.isDirectory()) modes(file); else if (/\.db(?:-|$)|sqlite/.test(name)) { check((s.mode & 0o777) === 0o600, 'db-mode'); secretFiles.push({ name, mode: s.mode & 0o777 }); } } }
  modes(`${root}/data`); result.authStoreModes = secretFiles;
  }
} catch (error) { failure = stage; result.failureCode = error instanceof LiveSafetyError ? error.code : null; result.prepFailureCode = error instanceof PreparationError ? error.code : null; if (!live) result.failureLedger = existsSync(`${root}/guard-state.json`) ? readState(root) : null; }
finally {
  // Remove while guards are still installed. On ambiguous/failed removal, kill
  // rather than allowing plugin-unload ordering with credentials present.
  if (credentialID && destination) {
    try { await destination.credential.remove({ credentialID }); credentialID = undefined; }
    catch { child?.kill('SIGKILL'); result.apiCleanupFailed = true; }
  }
  try { await stop(); } catch { failure ??= 'stop'; }
  result.processStopped = !child || spawnFailed || child.exitCode !== null || child.signalCode !== null;
  if (live && existsSync(`${root}/guard-state.json`)) {
    const s = readState(root);
    result.counters = { admissions: s.live?.admissions ?? 0, dispatches: s.dispatches, toolSnapshots: s.live?.toolSnapshots ?? 0 };
    result.httpStatuses = s.httpStatuses ?? [];
    result.retryDenials = s.retriesDenied;
    result.admissionKinds = s.admissionKinds ?? {}; result.dispatchKinds = s.dispatchKinds ?? {};
  }
  if (result.processStopped) { try { owned.dispose(); } catch { failure ??= 'dispose'; } }
  else failure ??= 'stop';
  result.disposed = !existsSync(root); result.failureStage = failure ?? null;
  result.apiCalls = apiCalls; process.off('SIGINT', cancel); process.off('SIGTERM', cancel);
  if (!live) result.modelRequests = 0;
  const diagnostics = result.live as { destinationStage?: string | null; sessionHadErrorPart?: boolean | null; assistantToolCounts?: Record<string, number> | null } | undefined;
  result.destinationStage = diagnostics?.destinationStage ?? null;
  result.sessionHadErrorPart = diagnostics?.sessionHadErrorPart ?? null;
  result.assistantToolCounts = diagnostics?.assistantToolCounts ?? null;
  const evidence = live ? { scenario, model: result.model, live: result.live, subtests, scenarioSetup: result.scenarioSetup, limitations: { slim: 'blocked-not-installed-no-safe-binding', parentRelay: 'not-model-exercised-fixture-only' }, counters: result.counters, admissionKinds: result.admissionKinds ?? {}, dispatchKinds: result.dispatchKinds ?? {}, sourceAccess: result.sourceAccess, failureCode: result.failureCode ?? null, prepFailureCode: result.prepFailureCode ?? null, failureStage: result.failureStage, destinationStage: result.destinationStage, httpStatuses: result.httpStatuses ?? [], retryDenials: result.retryDenials ?? 0, sessionHadErrorPart: result.sessionHadErrorPart, assistantToolCounts: result.assistantToolCounts, processStopped: result.processStopped, disposed: result.disposed } : result;
  try { writeFileSync(live ? (scenario === 'root' ? 'evidence/compatibility/backend-auth-live.json' : `evidence/compatibility/backend-auth-subtests-${scenario}.json`) : 'evidence/compatibility/backend-auth-runtime.json', JSON.stringify(evidence, null, 2)); }
  catch { failure ??= 'evidence'; }
}
console.log(JSON.stringify({ passed: !failure, failureStage: failure ?? null, prepFailureCode: result.prepFailureCode ?? null, processStopped: result.processStopped, disposed: result.disposed, ...(live ? { scenario, subtests, failureCode: result.failureCode ?? null, destinationStage: result.destinationStage, httpStatuses: result.httpStatuses ?? [], retryDenials: result.retryDenials ?? 0, sessionHadErrorPart: result.sessionHadErrorPart, assistantToolCounts: result.assistantToolCounts } : { modelRequests: 0 }) }));
if (failure) process.exitCode = 1;
