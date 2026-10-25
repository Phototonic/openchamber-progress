import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { lifecycle } from '../../setup/lifecycle.ts';

test('A2 production guidance/hints reach native2.1.4 outgoing requests and real tools without external transport', { timeout: 45000 }, async () => {
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
    lifecycle('install', { configRoot: `${root}/config/opencode`, dataRoot: `${root}/data/opencode`, storeRoot: `${root}/store`, confirmed: true }, { plugin: payload, guidance, removal: '// fixture only', version: '0.2.4' });
    const ownership = JSON.parse(fs.readFileSync(`${root}/config/opencode/plugins/agent-progress/.ownership.json`, 'utf8'));
    assert.equal(fs.readFileSync(`${root}/store/payloads/${ownership.active}/index.js`, 'utf8'), payload, 'selected companion bytes unchanged by observer');
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
