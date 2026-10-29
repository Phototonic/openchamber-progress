import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createHash } from 'node:crypto';

test('subagent activity isolated native feasibility', { timeout: 660000 }, async t => {
  // Exploratory work is never silently selected by the ordinary regression suite.
  const phase = process.env.SUBAGENT_ACTIVITY_PHASE ?? 'regression';
  if (phase === 'regression') {
    const { runNativeRegression } = await import('../fixtures/subagent-activity-regression.ts');
    await runNativeRegression(); return;
  }
  assert.equal(phase, 'probe', 'explicit probe or regression phase required');
  assert.equal(process.version, 'v24.19.0');
  const binary = process.env.OPENCODE_BINARY;
  assert.ok(binary && path.isAbsolute(binary), 'explicit independent binary required');
  assert.equal(fs.realpathSync(binary), '/tmp/opencode/agent-progress-probe-cli/opencode');
  const evidence = path.resolve(process.env.EVIDENCE ?? 'evidence/subagent-activity');
  fs.mkdirSync(evidence, { recursive: true });
  const previous = fs.existsSync(path.join(evidence, 'signals.json')) ? JSON.parse(fs.readFileSync(path.join(evidence, 'signals.json'), 'utf8')) : undefined;
  const history = previous?.attempts ?? (previous ? [{ invocation: 1, ...previous }] : []);
  const hash = (file: string) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const slim = path.join(process.env.HOME!, '.bun/install/cache/oh-my-opencode-slim@2.2.25@@@1');
  const result: any = { phase, node: process.version, runtime: '2.1.4', plugin: JSON.parse(fs.readFileSync('node_modules/@opencode/plugin/package.json', 'utf8')).version,
    sdk: JSON.parse(fs.readFileSync('node_modules/@openchamber/sdk/package.json', 'utf8')).version,
    hashes: { runtime: hash(binary), observerSource: hash('tests/fixtures/subagent-activity-observer.ts'), workspaceDriver: hash('tests/fixtures/subagent-activity-workspace-driver.ts'), slimDriver: hash('tests/fixtures/subagent-activity-slim-driver.ts'), slimWrapper: hash('tests/fixtures/subagent-activity-slim.ts'), hostObserver: hash('tests/browser/subagent-activity-host.ts'), guest: hash('tests/browser/subagent-activity-guest.ts'), lockfile: hash('bun.lock') }, modes: [] };
  assert.equal(result.plugin, '2.1.4'); assert.equal(result.sdk, '2.5.1');
  let failures = 0;
  const profiles = process.env.SUBAGENT_ACTIVITY_PROFILES?.split(',') ?? ['workspace'];
  assert.ok(profiles.length && profiles.every(p => ['workspace', 'slim'].includes(p)) && new Set(profiles).size === profiles.length, 'bounded continuation profiles only');
  try {
    for (const mode of profiles) {
      const report: any = { mode, pass: false };
      const root = fs.mkdtempSync('/tmp/opencode/subagent-activity-'); fs.chmodSync(root, 0o700);
      try {
        for (let dir = path.dirname(root);; dir = path.dirname(dir)) {
          for (const name of ['opencode.json', 'opencode.jsonc', '.opencode', 'AGENTS.md', 'CLAUDE.md']) assert.equal(fs.existsSync(path.join(dir, name)), false, 'ancestor configuration forbidden');
          if (dir === path.dirname(dir)) break;
        }
        assert.equal(fs.existsSync('/etc/opencode'), false);
        for (const dir of ['config/opencode/plugins/observer', 'config/openchamber', 'openchamber', 'guest', 'home', 'data', 'cache', 'state', 'runtime', 'tmp', 'Alpha', 'Beta', 'store']) fs.mkdirSync(`${root}/${dir}`, { recursive: true, mode: 0o700 });
        const display = process.env.WAYLAND_DISPLAY;
        const runtime = process.env.XDG_RUNTIME_DIR;
        const waylandSocket = display && (path.isAbsolute(display) ? display : runtime ? path.join(runtime, display) : undefined);
        if (mode === 'workspace') assert.ok(waylandSocket && fs.statSync(waylandSocket).isSocket(), 'authorized existing Wayland display transport required');
        const env = { PATH: '/usr/bin:/bin', HOME: `${root}/home`, XDG_CONFIG_HOME: `${root}/config`, XDG_DATA_HOME: `${root}/data`, XDG_CACHE_HOME: `${root}/cache`, XDG_STATE_HOME: `${root}/state`, XDG_RUNTIME_DIR: `${root}/runtime`, TMPDIR: `${root}/tmp`, OPENCODE_BINARY: binary,
          ...(mode === 'workspace' ? { ACTIVITY_WAYLAND_SOCKET: waylandSocket! } : {}) };
        const versionCheck: ReturnType<typeof spawnSync> = spawnSync(binary, ['--version'], { env, encoding: 'utf8' });
        assert.equal(versionCheck.status, 0); assert.equal(versionCheck.stdout.toString().trim(), 'opencode v2.1.4');
        const agents = Object.fromEntries(['nested-worker', 'restricted-worker', 'slow-worker'].map(id => [id, { mode: 'subagent', description: 'Synthetic probe worker', permissions: [{ action: '*', resource: '*', effect: 'deny' }, ...(id === 'nested-worker' ? [{ action: 'subagent', resource: '*', effect: 'allow' }] : [])] }]));
        fs.writeFileSync(`${root}/config/opencode/opencode.json`, JSON.stringify({ agents }));
        if (mode === 'slim') {
          const pkg = JSON.parse(fs.readFileSync(`${slim}/package.json`, 'utf8')); assert.equal(pkg.version, '2.2.25');
          report.slimVersion = pkg.version; report.slimSha256 = hash(`${slim}/dist/server/index.js`);
          fs.mkdirSync(`${root}/config/opencode/plugins/slim`, { recursive: true });
          fs.copyFileSync(`${slim}/dist/server/index.js`, `${root}/config/opencode/plugins/slim/implementation.mjs`);
          const wrapper = spawnSync('bun', ['build', 'tests/fixtures/subagent-activity-slim.ts', '--target=node', '--format=esm', `--outfile=${root}/config/opencode/plugins/slim/server.js`], { encoding: 'utf8' });
          assert.equal(wrapper.status, 0, 'slim observation wrapper compilation');
          report.slimWrapperSha256 = hash(`${root}/config/opencode/plugins/slim/server.js`);
          fs.writeFileSync(`${root}/config/opencode/plugins/slim/package.json`, JSON.stringify({ name: 'synthetic-slim', type: 'module', exports: { '.': './server.js' } }));
        }
        const build = spawnSync('bun', ['build', 'tests/fixtures/subagent-activity-observer.ts', '--target=node', '--format=esm', `--outfile=${root}/config/opencode/plugins/observer/index.js`], { encoding: 'utf8' });
        assert.equal(build.status, 0, 'observer compilation');
        report.observerSha256 = hash(`${root}/config/opencode/plugins/observer/index.js`);
        fs.writeFileSync(`${root}/config/opencode/plugins/observer/package.json`, JSON.stringify({ name: 'synthetic-observer', type: 'module', exports: { '.': './index.js' } }));
        // Direct disposable fixture loading, not an installer/API/UI installation.
        fs.writeFileSync(`${root}/guest/package.json`, JSON.stringify({ name: 'synthetic-activity-probe', version: '1.0.0', type: 'module', openchamber: { apiVersion: 1, engines: { openchamber: '>=2.5.1' }, contributes: { panel: { id: 'activity-probe', name: 'Activity probe', icon: 'checkbox-circle', entry: 'index.html' }, attach: false, capabilities: ['sessions'] } } }));
        fs.writeFileSync(`${root}/guest/index.html`, '<!doctype html><html><body><script type="module" src="./main.js"></script></body></html>');
        const guestBuild = spawnSync('bun', ['build', 'tests/browser/subagent-activity-guest.ts', '--target=browser', '--format=esm', `--outfile=${root}/guest/main.js`], { encoding: 'utf8' });
        assert.equal(guestBuild.status, 0, 'metadata-only guest compilation');
        report.guestSha256 = hash(`${root}/guest/main.js`);
        const hostAsar = '/tmp/opencode/agent-progress-t4-appimage/squashfs-root/resources/app.asar';
        if (fs.existsSync(hostAsar)) report.hostAsarSha256 = hash(hostAsar);
        for (const dir of ['config/openchamber', 'openchamber']) {
          fs.writeFileSync(`${root}/${dir}/extensions.json`, JSON.stringify({ paths: [`${root}/guest`], capabilityGrants: { 'activity-probe': ['sessions'] } }));
          fs.writeFileSync(`${root}/${dir}/settings.json`, JSON.stringify({ projects: ['Alpha', 'Beta'].map(name => ({ id: `project-${name.toLowerCase()}`, path: `${root}/${name}`, label: name, addedAt: 1, lastOpenedAt: 1 })), activeProjectId: 'project-alpha' }));
        }
        fs.writeFileSync(`${root}/sdk.mjs`, 'export function createActivityFixture() { return {}; }\n'); fs.writeFileSync(`${root}/jobs.json`, '{}');
        const child = spawn('/usr/bin/unshare', ['-Urn', '/bin/sh', '-ec', '/usr/sbin/ip link set lo up; test -z "$(/usr/sbin/ip route show default)"; exec "$@"', 'activity-fixture', process.execPath, '--experimental-strip-types', path.resolve(mode === 'workspace' ? 'tests/fixtures/subagent-activity-workspace-driver.ts' : 'tests/fixtures/subagent-activity-slim-driver.ts'), root, fs.readlinkSync('/proc/self/ns/net'), mode], { env, detached: true, stdio: 'ignore' });
        const killGroup = () => { try { process.kill(-child.pid!, 'SIGKILL'); } catch {} };
        const timer = setTimeout(killGroup, 300000);
        let status;
        try { [status] = await once(child, 'close'); } finally { clearTimeout(timer); killGroup(); }
        if (fs.existsSync(`${root}/report.json`)) Object.assign(report, JSON.parse(fs.readFileSync(`${root}/report.json`, 'utf8')));
        report.driverExit = status;
        if (fs.existsSync(`${root}/host-pid`)) {
          const pid = Number(fs.readFileSync(`${root}/host-pid`, 'utf8'));
          assert.throws(() => process.kill(pid, 0), (e: any) => e.code === 'ESRCH'); report.hostPidGone = true;
        }
        assert.throws(() => process.kill(-child.pid!, 0), (e: any) => e.code === 'ESRCH'); report.processGroupGone = true;
        if (status !== 0 || !report.pass) failures++;
      } catch { report.failure = 'Isolated preparation or cleanup prerequisite failed; no raw output retained.'; failures++; }
      finally { fs.rmSync(root, { recursive: true, force: true }); report.fixtureRemoved = !fs.existsSync(root); result.modes.push(report); }
    }
  } finally {
    result.pass = failures === 0;
    result.invocation = history.length + 1;
    result.attempts = [...history, structuredClone(result)];
    fs.writeFileSync(path.join(evidence, 'signals.json'), JSON.stringify(result, null, 2) + '\n');
  }
  assert.equal(failures, 0, 'Native probe failed; see sanitized signals.json. No automatic retry.');
});
