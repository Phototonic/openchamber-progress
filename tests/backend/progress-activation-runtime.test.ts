import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { lifecycle } from '../../setup/lifecycle.ts';
import { RELEASE } from '../../shared/release.ts';
import { Store } from '../../shared/store.ts';

test('C native proxy metadata delivers actor-only hints without implicit reports, including Code Mode', { timeout: 240000 }, async () => {
  for (const codemode of ['0', '1']) {
    const env = { ...process.env, PROXY_ACTIVATION: '1', PROXY_TYPED_REPLAY: '1', PROXY_CODEMODE: codemode,
      EVIDENCE: path.join(process.env.EVIDENCE || '/tmp/opencode/activation-proxy-evidence', 'proxies') };
    const child = spawn(process.execPath, ['--experimental-strip-types', path.resolve('tests/fixtures/proxy-shape-probe.ts')], { env, stdio: 'inherit' });
    const [status] = await once(child, 'close'); assert.equal(status, 0, `proxy runtime mode ${codemode}`);
  }
});

test('progress resume successful host compaction reaches the next primary only', { timeout: 600000 }, async () => {
  const phase = process.env.PROGRESS_RESUME_PHASE;
  const regression = phase === 'regression';
  const evidence = path.resolve(process.env.EVIDENCE || 'evidence/progress-resume-capsule');
  fs.mkdirSync(evidence, { recursive: true });
  const previous = fs.existsSync(path.join(evidence, 'runtime-gate.json')) ? JSON.parse(fs.readFileSync(path.join(evidence, 'runtime-gate.json'), 'utf8')) : undefined;
  const report: any = { phase, productionCapsule: regression, baseline: 'a28284f20b675066d062f0bbf0f6436aaf6b2330', nodeVersion: process.version,
    pluginVersion: JSON.parse(fs.readFileSync('node_modules/@opencode/plugin/package.json', 'utf8')).version, pass: false };
  let root: string | undefined;
  try {
    assert.ok(phase === 'gate' || regression, 'explicit gate or regression phase required');
    assert.equal(process.version, 'v24.19.0');
    assert.equal(report.pluginVersion, '2.1.4');
    const binary = '/tmp/opencode/agent-progress-probe-cli/opencode';
    assert.equal(process.env.OPENCODE_BINARY || binary, binary, 'no launcher/PATH fallback');
    assert.ok(fs.statSync(binary).isFile()); fs.accessSync(binary, fs.constants.X_OK);
    root = fs.mkdtempSync('/tmp/opencode/agent-progress-resume-');
    for (let dir = path.dirname(root);; dir = path.dirname(dir)) {
      for (const name of ['opencode.json', 'opencode.jsonc', '.opencode', 'AGENTS.md', 'CLAUDE.md']) assert.equal(fs.existsSync(path.join(dir, name)), false, 'ancestor configuration forbidden');
      if (dir === path.dirname(dir)) break;
    }
    assert.equal(fs.existsSync('/etc/opencode'), false);
    for (const dir of ['config/opencode/plugins/companion', 'config/opencode/plugins/resume', 'data/opencode', 'home', 'cache', 'state', 'runtime', 'tmp', 'project', 'store']) fs.mkdirSync(`${root}/${dir}`, { recursive: true, mode: 0o700 });
    const env = { PATH: '/usr/bin:/bin', HOME: `${root}/home`, TMPDIR: `${root}/tmp`, XDG_CONFIG_HOME: `${root}/config`, XDG_DATA_HOME: `${root}/data`, XDG_CACHE_HOME: `${root}/cache`, XDG_STATE_HOME: `${root}/state`, XDG_RUNTIME_DIR: `${root}/runtime` };
    const version = spawnSync(binary, ['--version'], { env, encoding: 'utf8' });
    assert.equal(version.status, 0); assert.equal(version.stdout.trim(), 'opencode v2.2.2');
    report.runtimeVersion = version.stdout.trim();
    report.bunVersion = spawnSync('bun', ['--version'], { encoding: 'utf8' }).stdout.trim();
    report.preflight = { freshHomeXdg: true, ancestorConfigurationAbsent: true, explicitIndependentBinary: true };
    const source = { id: 'source-resume-fixture', configRoot: `${root}/config/opencode`, dataRoot: `${root}/data/opencode`, verified: true };
    const store = new Store(`${root}/store/progress.sqlite`, { create: true });
    try {
      store.registerSource(source);
      fs.writeFileSync(`${root}/binding.json`, JSON.stringify({ protocolVersion: 2, schemaVersion: 2, installId: 'synthetic-resume', version: RELEASE, database: store.file, storeId: store.list({ limit: 1 }).storeId, source }), { mode: 0o600 });
    } finally { store.close(); }
    const original = path.resolve(process.env.ACTIVATION_COMPANION_ENTRY || 'plugin/index.ts');
    if (process.env.ACTIVATION_COMPANION_ENTRY) fs.copyFileSync(original, `${root}/config/opencode/plugins/companion/index.js`);
    else {
      const build = spawnSync('bun', ['build', original, '--target=node', '--format=esm', `--outfile=${root}/config/opencode/plugins/companion/index.js`], { encoding: 'utf8' });
      assert.equal(build.status, 0, 'companion fixture compilation');
    }
    report.companionSha256 = createHash('sha256').update(fs.readFileSync(`${root}/config/opencode/plugins/companion/index.js`)).digest('hex');
    if (process.env.ACTIVATION_COMPANION_ENTRY) assert.equal(report.companionSha256, createHash('sha256').update(fs.readFileSync(original)).digest('hex'), 'built companion bytes unchanged');
    report.companionMode = process.env.ACTIVATION_COMPANION_ENTRY ? 'verbatim-built' : 'source-built';
    fs.copyFileSync(process.env.ACTIVATION_COMPANION_ENTRY ? path.join(path.dirname(original), 'SKILL.md') : 'plugin/SKILL.md', `${root}/config/opencode/plugins/companion/SKILL.md`);
    const build = spawnSync('bun', ['build', 'tests/fixtures/progress-resume-observer.ts', '--target=node', '--format=esm', `--outfile=${root}/config/opencode/plugins/resume/index.js`], { encoding: 'utf8' });
    assert.equal(build.status, 0, 'observer fixture compilation');
    for (const name of ['companion', 'resume']) fs.writeFileSync(`${root}/config/opencode/plugins/${name}/package.json`, JSON.stringify({ name: `synthetic-${name}`, type: 'module', exports: { '.': './index.js' } }));
    const child = spawn('/usr/bin/unshare', ['-Urn', '/bin/sh', '-ec', '/usr/sbin/ip link set lo up; test -z "$(/usr/sbin/ip route show default)"; exec "$@"', 'resume-fixture', process.execPath, '--experimental-strip-types', path.resolve('tests/fixtures/progress-resume-driver.ts'), root, fs.readlinkSync('/proc/self/ns/net'), phase!], { env, detached: true, stdio: 'ignore' });
    const killGroup = () => { try { process.kill(-child.pid!, 'SIGKILL'); } catch {} };
    const timer = setTimeout(killGroup, 580000);
    let status: number | null;
    try { [status] = await once(child, 'close'); } finally { clearTimeout(timer); killGroup(); }
    if (fs.existsSync(`${root}/report.json`)) Object.assign(report, JSON.parse(fs.readFileSync(`${root}/report.json`, 'utf8')));
    report.driverExit = status;
    if (fs.existsSync(`${root}/host-pid`)) {
      const pid = Number(fs.readFileSync(`${root}/host-pid`, 'utf8'));
      assert.throws(() => process.kill(pid, 0), (error: any) => error.code === 'ESRCH');
      report.hostPidGone = true;
    }
    assert.throws(() => process.kill(-child.pid!, 0), (error: any) => error.code === 'ESRCH');
    report.namespaceProcessGroupGone = true;
    assert.equal(status, 0, 'isolated runtime gate failed; see sanitized evidence');
    assert.equal(report.pass, true);
  } catch (error) {
    report.pass = false;
    report.failure = report.failure || 'Preflight, isolation, compilation or runtime assertion failed.';
    throw error;
  } finally {
    if (root) { fs.rmSync(root, { recursive: true, force: true }); report.fixtureRemoved = !fs.existsSync(root); }
    if (regression) fs.writeFileSync(path.join(evidence, 'outgoing.json'), JSON.stringify(report, null, 2) + '\n');
    else fs.writeFileSync(path.join(evidence, 'runtime-gate.json'), JSON.stringify(previous?.attempt2
      ? { attempt1: previous.attempt1, attempt2: previous.attempt2, attempt3: report, pass: report.pass }
      : previous ? { attempt1: previous.attempt1 ?? previous, attempt2: report, pass: report.pass } : report, null, 2) + '\n');
  }
});

test('A2 production guidance/hints reach native2.2.2 outgoing requests and real tools without external transport', { timeout: 45000 }, async () => {
  const root = fs.mkdtempSync('/tmp/opencode/agent-progress-activation-');
  try {
    for (let dir = path.dirname(root);; dir = path.dirname(dir)) {
      for (const name of ['opencode.json', 'opencode.jsonc', '.opencode', 'AGENTS.md', 'CLAUDE.md']) assert.equal(fs.existsSync(path.join(dir, name)), false, 'ancestor config/instructions forbidden');
      if (dir === path.dirname(dir)) break;
    }
    assert.equal(fs.existsSync('/etc/opencode'), false);
    for (const dir of ['config/opencode', 'data/opencode', 'home', 'cache', 'state', 'runtime', 'tmp', 'project', 'compiled']) fs.mkdirSync(`${root}/${dir}`, { recursive: true, mode: 0o700 });
    const original = path.resolve(process.env.ACTIVATION_COMPANION_ENTRY || 'plugin/index.ts');
    if (process.env.ACTIVATION_COMPANION_ENTRY) fs.copyFileSync(original, `${root}/compiled/plugin.js`);
    else {
      const build = spawnSync('bun', ['build', original, '--target=node', '--format=esm', `--outfile=${root}/compiled/plugin.js`], { encoding: 'utf8' });
      assert.equal(build.status, 0, build.stderr);
    }
    const payload = fs.readFileSync(`${root}/compiled/plugin.js`, 'utf8');
    const guidance = fs.readFileSync(process.env.ACTIVATION_COMPANION_ENTRY ? path.join(path.dirname(original),'SKILL.md') : 'plugin/SKILL.md', 'utf8');
    lifecycle('install', { configRoot: `${root}/config/opencode`, dataRoot: `${root}/data/opencode`, storeRoot: `${root}/store`, confirmed: true }, { plugin: payload, guidance, removal: '// fixture only', version: RELEASE });
    const ownership = JSON.parse(fs.readFileSync(`${root}/config/opencode/plugins/agent-progress/.ownership.json`, 'utf8'));
    assert.equal(fs.readFileSync(`${root}/store/payloads/${ownership.active}/index.js`, 'utf8'), payload, 'selected companion bytes unchanged by observer');
    assert.equal(fs.readFileSync(`${root}/store/payloads/${ownership.active}/SKILL.md`, 'utf8'), guidance, 'selected packaged skill bytes installed unchanged');
    console.log('selected-companion-sha256', createHash('sha256').update(payload).digest('hex'), process.env.ACTIVATION_COMPANION_ENTRY ? 'verbatim-entry' : 'source-built');
    const observer = `${root}/config/opencode/plugins/activation-observer`;
    fs.mkdirSync(observer, {recursive:true,mode:0o700});
    const buildObserver = spawnSync('bun', ['build', 'tests/fixtures/activation-observer.ts', '--target=node', '--format=esm', `--outfile=${observer}/index.js`], {encoding:'utf8'});
    assert.equal(buildObserver.status, 0, buildObserver.stderr);
    fs.writeFileSync(`${observer}/package.json`, JSON.stringify({name:'activation-observer-fixture',type:'module',exports:{'.':'./index.js'}}));
    const env = { PATH: '/usr/bin:/bin', HOME: `${root}/home`, TMPDIR: `${root}/tmp` };
    const child = spawn('/usr/bin/unshare', ['-Urn', '/bin/sh', '-ec', '/usr/sbin/ip link set lo up; test -z "$(/usr/sbin/ip route show default)"; exec "$@"', 'activation-fixture', process.execPath, '--experimental-strip-types', path.resolve('tests/fixtures/activation-native-driver.ts'), root, fs.readlinkSync('/proc/self/ns/net')], { env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
    const killGroup = () => { try { process.kill(-child.pid!, 'SIGKILL'); } catch {} };
    const timer = setTimeout(killGroup, 35000);
    let status: number | null;
    try { [status] = await once(child, 'close'); } finally { clearTimeout(timer); killGroup(); }
    const result = { status, stdout, stderr };
    // Keep only owned diagnostic files on failure; never inspect other fixtures.
    if (result.status !== 0) console.error('activation owned fixture:', root, result.stdout, result.stderr, fs.existsSync(`${root}/host.txt`) ? fs.readFileSync(`${root}/host.txt`, 'utf8') : '');
    assert.equal(result.status, 0, result.stderr);
    const hostPid = Number(fs.readFileSync(`${root}/host-pid`, 'utf8'));
    assert.throws(() => process.kill(hostPid, 0), (error: any) => error.code === 'ESRCH', 'owned host must be gone before fixture removal');
    console.log(result.stdout.trim());
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    assert.equal(fs.existsSync(root), false, 'owned fixture removed');
  }
});
