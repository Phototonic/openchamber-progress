/** Isolated production regression preparation; no installed profile or generated output writes. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { Store } from '../../shared/store.ts';
import { RELEASE } from '../../shared/release.ts';

export async function runNativeRegression() {
  const backendOnly=process.env.SUBAGENT_ACTIVITY_BACKEND_ONLY==='1';
  assert.equal(process.version, 'v24.19.0');
  const binary = process.env.OPENCODE_BINARY;
  assert.ok(binary && fs.realpathSync(binary) === '/tmp/opencode/agent-progress-probe-cli/opencode', 'explicit independent binary required');
  const evidence = path.resolve(process.env.EVIDENCE ?? 'evidence/subagent-activity');
  fs.mkdirSync(evidence, { recursive: true });
  const evidenceFile = `${evidence}/${process.env.ACTIVATION_COMPANION_ENTRY ? 'built-native' : 'native'}.json`;
  const previous = fs.existsSync(evidenceFile) ? JSON.parse(fs.readFileSync(evidenceFile, 'utf8')) : undefined;
  const hash = (file: string) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  assert.equal(JSON.parse(fs.readFileSync('node_modules/@opencode/plugin/package.json', 'utf8')).version, '2.1.4');
  assert.equal(JSON.parse(fs.readFileSync('node_modules/@openchamber/sdk/package.json', 'utf8')).version, '2.5.1');
  const result: any = { phase: 'regression', runtime: '2.2.2', node: process.version, sdk: '2.5.1', hashes: Object.fromEntries([binary, 'bun.lock', 'tests/fixtures/subagent-activity-regression.ts', 'tests/fixtures/subagent-activity-integration-driver.ts', 'tests/fixtures/subagent-activity-observer.ts', 'tests/browser/subagent-activity-native.ts', 'tests/browser/subagent-activity-host.ts', 'ui/shared/app.ts', 'ui/shared/live.ts', 'ui/shared/census.ts', 'ui/shared/census-view.ts'].map(file => [file === binary ? 'nativeRuntime' : file, hash(file)])), modes: [], pass: false };
  const profiles = process.env.SUBAGENT_ACTIVITY_PROFILES?.split(',') ?? ['builtin', 'slim'];
  result.backendOnly=backendOnly;
  assert.ok(profiles.length && profiles.every(p => ['builtin', 'slim'].includes(p)) && new Set(profiles).size === profiles.length);
  try {
    for (const mode of profiles) {
      const report: any = { mode, pass: false };
      const root = fs.mkdtempSync('/tmp/opencode/subagent-activity-'); fs.chmodSync(root, 0o700);
      try {
        for (let dir = path.dirname(root);; dir = path.dirname(dir)) {
          for (const name of ['opencode.json', 'opencode.jsonc', '.opencode', 'AGENTS.md', 'CLAUDE.md']) assert.ok(!fs.existsSync(path.join(dir, name)), 'ancestor configuration forbidden');
          if (dir === path.dirname(dir)) break;
        }
        assert.ok(!fs.existsSync('/etc/opencode'));
        for (const dir of ['config/opencode/plugins/observer', 'config/opencode/plugins/companion', 'config/openchamber', 'data/opencode', 'openchamber', 'guest', 'home', 'cache', 'state', 'runtime', 'tmp', 'Alpha', 'Beta', 'store', 'screenshots']) fs.mkdirSync(`${root}/${dir}`, { recursive: true, mode: 0o700 });
        const display = process.env.WAYLAND_DISPLAY;
        const socket = display && (path.isAbsolute(display) ? display : process.env.XDG_RUNTIME_DIR && path.join(process.env.XDG_RUNTIME_DIR, display));
        assert.ok(socket && fs.statSync(socket).isSocket(), 'authorized Wayland transport required');
        const env: Record<string, string> = { PATH: '/usr/bin:/bin', HOME: `${root}/home`, XDG_CONFIG_HOME: `${root}/config`, XDG_DATA_HOME: `${root}/data`, XDG_CACHE_HOME: `${root}/cache`, XDG_STATE_HOME: `${root}/state`, XDG_RUNTIME_DIR: `${root}/runtime`, TMPDIR: `${root}/tmp`, OPENCODE_BINARY: binary, ACTIVITY_WAYLAND_SOCKET: socket, AGENT_PROGRESS_BINDING: `${root}/binding.json` };
        assert.equal(spawnSync(binary, ['--version'], { env, encoding: 'utf8' }).stdout.trim(), 'opencode v2.2.2');
        if(backendOnly)env.SUBAGENT_ACTIVITY_BACKEND_ONLY='1';
        const source = { id: 'source-alpha', configRoot: `${root}/config/opencode`, dataRoot: `${root}/data/opencode`, verified: true };
        const store = new Store(`${root}/store/progress.sqlite`, { create: true });
        try { store.registerSource(source); fs.writeFileSync(`${root}/binding.json`, JSON.stringify({ protocolVersion: 2, schemaVersion: 2, installId: 'synthetic-activity', version: RELEASE, database: store.file, storeId: store.list({ limit: 1 }).storeId, source }), { mode: 0o600 }); } finally { store.close(); }
        const build = (entry: string, output: string) => { const r = spawnSync('bun', ['build', entry, '--target=node', '--format=esm', `--outfile=${output}`], { encoding: 'utf8' }); assert.equal(r.status, 0, `temporary build: ${entry}`); return hash(output); };
        const original = path.resolve(process.env.ACTIVATION_COMPANION_ENTRY || 'plugin/index.ts');
        const target = `${root}/config/opencode/plugins/companion/index.js`;
        if (process.env.ACTIVATION_COMPANION_ENTRY) fs.copyFileSync(original, target); else build(original, target);
        report.companionMode = process.env.ACTIVATION_COMPANION_ENTRY ? 'verbatim-built' : 'source-built';
        report.companionSha256 = hash(target);
        if (process.env.ACTIVATION_COMPANION_ENTRY) assert.equal(hash(original), hash(target));
        const guidance = process.env.ACTIVATION_COMPANION_ENTRY ? path.join(path.dirname(original), 'SKILL.md') : 'plugin/SKILL.md';
        fs.copyFileSync(guidance, `${path.dirname(target)}/SKILL.md`); report.guidanceSha256 = hash(guidance);
        report.observerSha256 = build('tests/fixtures/subagent-activity-observer.ts', `${root}/config/opencode/plugins/observer/index.js`);
        for (const name of ['observer', 'companion']) fs.writeFileSync(`${root}/config/opencode/plugins/${name}/package.json`, JSON.stringify({ name: `synthetic-${name}`, type: 'module', exports: { '.': './index.js' } }));
        fs.writeFileSync(`${root}/config/opencode/opencode.json`, JSON.stringify({ agents: Object.fromEntries(['restricted-worker', 'slow-worker','reporting-worker','failing-worker'].map(id => [id, { mode: 'subagent', description: 'Synthetic restricted worker', permissions: [{ action: '*', resource: '*', effect: 'deny' },...(id==='reporting-worker'?[{action:'agent_progress_report',resource:'*',effect:'allow'}]:[])] }])) }));
        if (mode === 'slim') {
          const slim = path.join(process.env.HOME!, '.bun/install/cache/oh-my-opencode-slim@2.2.25@@@1');
          assert.equal(JSON.parse(fs.readFileSync(`${slim}/package.json`, 'utf8')).version, '2.2.25');
          fs.mkdirSync(`${root}/config/opencode/plugins/slim`);
          fs.copyFileSync(`${slim}/dist/server/index.js`, `${root}/config/opencode/plugins/slim/implementation.mjs`);
          report.slimSha256 = hash(`${slim}/dist/server/index.js`);
          build('tests/fixtures/subagent-activity-slim.ts', `${root}/config/opencode/plugins/slim/server.js`);
          fs.writeFileSync(`${root}/config/opencode/plugins/slim/package.json`, JSON.stringify({ name: 'synthetic-slim', type: 'module', exports: { '.': './server.js' } }));
        }
        fs.writeFileSync(`${root}/jobs.json`, '{}'); fs.writeFileSync(`${root}/sdk.mjs`, 'export function createActivityFixture(){return {}}');
        fs.writeFileSync(`${root}/production-regression`, 'synthetic fault case enabled');
        // Actual production guests, temporary outputs only. The service wrapper
        // supplies the existing authenticated API, not mocked response bodies.
        report.guestHashes = {};
        if(!backendOnly){
        for (const surface of ['panel', 'status', 'page']) {
          fs.mkdirSync(`${root}/guest/ui/${surface}`, { recursive: true });
          fs.copyFileSync(`ui/${surface}/index.html`, `${root}/guest/ui/${surface}/index.html`);
          const built = spawnSync('bun', ['run', 'bundle:guest', `ui/${surface}/main.ts`, `${root}/guest/ui/${surface}/main.js`], { encoding: 'utf8' });
          assert.equal(built.status, 0, `temporary ${surface} guest build`);
          report.guestHashes[surface] = hash(`${root}/guest/ui/${surface}/main.js`);
        }
        report.serviceSha256 = build('tests/fixtures/subagent-activity-service.ts', `${root}/guest/service.js`);
        report.hostSha256 = hash('/tmp/opencode/agent-progress-t4-appimage/squashfs-root/resources/app.asar');
        fs.writeFileSync(`${root}/guest/package.json`, JSON.stringify({ name: 'synthetic-native-progress', version: '1.0.0', type: 'module', openchamber: { apiVersion: 1, engines: { openchamber: '>=2.5.1' }, contributes: { panel: { id: 'activity-probe', name: 'Activity probe', icon: 'checkbox-circle', entry: 'ui/panel/index.html' }, statusSection: { entry: 'ui/status/index.html', title: 'Activity probe', height: 160 }, page: { entry: 'ui/page/index.html', title: 'Activity probe' }, attach: false, capabilities: ['sessions'], service: { entry: 'service.js', runtime: 'host', permissions: {} } } } }));
        for (const dir of ['config/openchamber', 'openchamber']) {
          fs.writeFileSync(`${root}/${dir}/extensions.json`, JSON.stringify({ paths: [`${root}/guest`], capabilityGrants: { 'activity-probe': ['sessions', 'service'] }, capabilityScopes: { 'activity-probe': { service: { exec: [], sockets: [] } } } }));
          fs.writeFileSync(`${root}/${dir}/settings.json`, JSON.stringify({ projects: ['Alpha', 'Beta'].map(name => ({ id: `project-${name.toLowerCase()}`, path: `${root}/${name}`, label: name, addedAt: 1, lastOpenedAt: 1 })), activeProjectId: 'project-alpha' }));
        }
        }
        const child = spawn('/usr/bin/unshare', ['-Urn', '/bin/sh', '-ec', '/usr/sbin/ip link set lo up; test -z "$(/usr/sbin/ip route show default)"; exec "$@"', 'activity-regression', process.execPath, '--experimental-strip-types', path.resolve('tests/fixtures/subagent-activity-integration-driver.ts'), root, fs.readlinkSync('/proc/self/ns/net'), mode], { env, detached: true, stdio: 'ignore' });
        const kill = () => { try { process.kill(-child.pid!, 'SIGKILL'); } catch {} };
        const timer = setTimeout(kill, 290000);
        let status; try { [status] = await once(child, 'close'); } finally { clearTimeout(timer); kill(); }
        if (fs.existsSync(`${root}/report.json`)) Object.assign(report, JSON.parse(fs.readFileSync(`${root}/report.json`, 'utf8')));
        report.driverExit = status;
        assert.throws(() => process.kill(-child.pid!, 0), (e: any) => e.code === 'ESRCH'); report.processGroupGone = true;
        if (fs.existsSync(`${root}/host-pid`)) { assert.throws(() => process.kill(Number(fs.readFileSync(`${root}/host-pid`, 'utf8')), 0), (e: any) => e.code === 'ESRCH'); report.hostPidGone = true; }
        fs.mkdirSync(`${evidence}/screenshots`, { recursive: true });
        for (const name of fs.readdirSync(`${root}/screenshots`)) { assert.match(name, /^native-[\w-]+\.png$/); fs.copyFileSync(`${root}/screenshots/${name}`, `${evidence}/screenshots/${name}`); }
      } catch (e) { report.pass = false; report.failure = e instanceof assert.AssertionError ? 'Preparation or cleanup assertion failed' : 'Preparation or cleanup unavailable'; }
      finally { fs.rmSync(root, { recursive: true, force: true }); report.fixtureRemoved = !fs.existsSync(root); result.modes.push(report); }
    }
    result.pass = result.modes.every((m: any) => m.pass && m.driverExit === 0 && m.processGroupGone && m.fixtureRemoved);
  } finally {
    result.attempts = [...(previous?.attempts ?? (previous ? [previous] : [])), structuredClone(result)];
    fs.writeFileSync(evidenceFile, JSON.stringify(result, null, 2) + '\n');
  }
  assert.equal(result.pass, true, 'Production native regression failed; see sanitized native evidence');
}
