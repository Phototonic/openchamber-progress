/** C0 diagnostic using the activation driver's public-client/rootless-isolation route. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { networkInterfaces } from 'node:os';
import { createHash } from 'node:crypto';
import { OpenCode } from '@opencode/client';
import { lifecycle } from '../../setup/lifecycle.ts';
import { RELEASE } from '../../shared/release.ts';
import { Store } from '../../shared/store.ts';
import { DISPATCH_OBSERVATION, TRACKER_OBSERVATION } from '../../plugin/activation.ts';

const binary = '/tmp/opencode/agent-progress-probe-cli/opencode';
const root = process.argv[3];
if (process.argv[2] !== '--driver') {
  assert.equal(process.version, 'v24.19.0');
  const fixture = fs.mkdtempSync('/tmp/opencode/proxy-shape-'); fs.chmodSync(fixture, 0o700);
  try {
    for (let dir = path.dirname(fixture);; dir = path.dirname(dir)) {
      for (const name of ['opencode.json', 'opencode.jsonc', '.opencode', 'AGENTS.md', 'CLAUDE.md']) assert.ok(!fs.existsSync(path.join(dir, name)), 'ancestor configuration forbidden');
      if (dir === path.dirname(dir)) break;
    }
    assert.ok(!fs.existsSync('/etc/opencode'));
    for (const name of ['home', 'config/opencode/plugins/observer', 'data/opencode', 'cache', 'state', 'runtime', 'tmp', 'project']) fs.mkdirSync(`${fixture}/${name}`, { recursive: true, mode: 0o700 });
    const build = spawnSync('bun', ['build', 'tests/fixtures/proxy-shape-observer.ts', '--target=node', '--format=esm', `--outfile=${fixture}/config/opencode/plugins/observer/index.js`], { encoding: 'utf8' }); assert.equal(build.status, 0, build.stderr);
    fs.writeFileSync(`${fixture}/config/opencode/plugins/observer/package.json`, JSON.stringify({ name: 'synthetic-proxy-observer', type: 'module', exports: { '.': './index.js' } }));
    fs.writeFileSync(`${fixture}/sdk.mjs`, 'export function createFixture(){return {}}'); fs.writeFileSync(`${fixture}/jobs.json`, '{}');
    let companionSha256: string | undefined;
    if (process.env.PROXY_ACTIVATION === '1') {
      const selected = process.env.ACTIVATION_COMPANION_ENTRY;
      const output = `${fixture}/companion.js`;
      if (selected) fs.copyFileSync(selected, output);
      else assert.equal(spawnSync('bun', ['build', 'plugin/index.ts', '--target=node', '--format=esm', `--outfile=${output}`], { encoding: 'utf8' }).status, 0);
      const payload = fs.readFileSync(output, 'utf8'); companionSha256 = createHash('sha256').update(payload).digest('hex');
      lifecycle('install', { configRoot: `${fixture}/config/opencode`, dataRoot: `${fixture}/data/opencode`, storeRoot: `${fixture}/store`, confirmed: true },
        { plugin: payload, guidance: fs.readFileSync(selected ? path.join(path.dirname(selected), 'SKILL.md') : 'plugin/SKILL.md', 'utf8'), removal: '// synthetic fixture', version: RELEASE });
    }
    const config = { agents: Object.fromEntries(['fixture-worker', 'failure-worker', 'slow-worker'].map(id => [id, { mode: 'subagent', description: 'Synthetic proxy worker' }])), mcp: { servers: { linear: { type: 'local', command: [process.execPath, '--experimental-strip-types', path.resolve('tests/fixtures/proxy-shape-mcp.ts')], codemode: process.env.PROXY_CODEMODE === '1' } } } };
    fs.writeFileSync(`${fixture}/config/opencode/opencode.json`, JSON.stringify(config));
    const child = spawn('/usr/bin/unshare', ['-Urn', '/bin/sh', '-ec', '/usr/sbin/ip link set lo up; exec "$@"', 'proxy-shape', process.execPath, '--experimental-strip-types', path.resolve('tests/fixtures/proxy-shape-probe.ts'), '--driver', fixture, fs.readlinkSync('/proc/self/ns/net')], { env: process.env, detached: true, stdio: 'inherit' });
    const kill = () => { try { process.kill(-child.pid!, 'SIGKILL'); } catch {} };
    const timer = setTimeout(kill, 180000);
    let status; try { [status] = await once(child, 'close'); } finally { clearTimeout(timer); kill(); }
    const records = fs.existsSync(`${fixture}/events.jsonl`) ? fs.readFileSync(`${fixture}/events.jsonl`, 'utf8').trim().split('\n').filter(Boolean).map(s => JSON.parse(s)) : [];
    const evidence = process.env.EVIDENCE!; fs.mkdirSync(evidence, { recursive: true });
    // Entirely synthetic fixture events; normalize opaque IDs and omit any private paths.
    const ids = new Map<string, string>();
    const clean = (value: any): any => typeof value === 'string' ? value.replaceAll(fixture, '<fixture>').replace(/ses_[A-Za-z0-9]+/g, id => { if (!ids.has(id)) ids.set(id, `session-${ids.size + 1}`); return ids.get(id)!; }) : Array.isArray(value) ? value.map(clean) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clean(v)])) : value;
    fs.writeFileSync(`${evidence}/${process.env.PROXY_CODEMODE === '1' ? 'codemode' : 'direct'}.json`, JSON.stringify({ runtime: '2.2.2', nativeSha256: createHash('sha256').update(fs.readFileSync(binary)).digest('hex'), companionSha256, companionMode: process.env.ACTIVATION_COMPANION_ENTRY ? 'verbatim-built' : 'source-built', syntheticOnly: true, externalTrackerCalled: false, typedMetadataReplay: process.env.PROXY_TYPED_REPLAY === '1', driverExit: status, records: clean(records) }, null, 2) + '\n');
    assert.throws(() => process.kill(-child.pid!, 0), (e: any) => e.code === 'ESRCH');
    assert.equal(status, 0, 'native diagnostic driver');
  } finally { fs.rmSync(fixture, { recursive: true, force: true }); }
} else {
  assert.notEqual(fs.readlinkSync('/proc/self/ns/net'), process.argv[4]); assert.deepEqual(Object.keys(networkInterfaces()), ['lo']);
  assert.equal(spawnSync('/usr/sbin/ip', ['route', 'show', 'default'], { encoding: 'utf8' }).stdout.trim(), '');
  const env = { PATH: '/usr/bin:/bin', HOME: `${root}/home`, XDG_CONFIG_HOME: `${root}/config`, XDG_DATA_HOME: `${root}/data`, XDG_CACHE_HOME: `${root}/cache`, XDG_STATE_HOME: `${root}/state`, XDG_RUNTIME_DIR: `${root}/runtime`, TMPDIR: `${root}/tmp`, OPENCODE_PASSWORD: 'synthetic-local-only', DBUS_SESSION_BUS_ADDRESS: 'disabled:', PROXY_SHAPE_ROOT: root };
  assert.equal(spawnSync(binary, ['--version'], { env, encoding: 'utf8' }).stdout.trim(), 'opencode v2.2.2');
  const host = spawn(binary, ['serve', '--hostname', '127.0.0.1', '--port', '18765'], { cwd: `${root}/project`, env, stdio: 'ignore' });
  const client = OpenCode.make({ baseUrl: 'http://127.0.0.1:18765', headers: { authorization: `Basic ${Buffer.from('opencode:synthetic-local-only').toString('base64')}` } });
  const location = { directory: `${root}/project` };
  const records = (): any[] => fs.existsSync(`${root}/events.jsonl`) ? fs.readFileSync(`${root}/events.jsonl`, 'utf8').trim().split('\n').filter(Boolean).map(s => JSON.parse(s)) : [];
  const wait = async (condition: () => Promise<boolean> | boolean, label: string) => { const end = Date.now() + 15000; while (Date.now() < end) { if (await condition()) return; await new Promise(r => setTimeout(r, 25)); } throw new Error(label); };
  const jobs: any = {};
  try {
    await wait(async () => { try { return (await client.model.list({ location })).data.length > 0; } catch { return false; } }, 'host startup');
    assert.equal((await client.credential.list()).length, 0);
    const session = await client.session.create({ location, agent: 'build', title: 'Synthetic C0', model: { providerID: 'proxy-fixture', id: 'script' }, permissions: [{ action: '*', resource: '*', effect: 'allow' }] });
    const snapshot = () => {
      const store = new Store(`${root}/store/progress.sqlite`, { readOnly: true });
      try { return Object.fromEntries(['plans', 'revisions', 'receipts', 'sessions', 'chunks', 'captures', 'contributions'].map(table => [table, store.db.prepare(`SELECT * FROM ${table}`).all()])); } finally { store.close(); }
    };
    const activated = process.env.PROXY_ACTIVATION === '1';
    const beforeHints = activated ? snapshot() : undefined;
    // SDK observation waits for MCP discovery; finish that no-tool request before
    // constructing the next request's immutable Code Mode inventory snapshot.
    await client.session.prompt({ sessionID: session.id, text: 'Synthetic catalog readiness preflight; no tool action.' });
    await client.session.wait({ sessionID: session.id }, { signal: AbortSignal.timeout(15000) });
    let generation = 0;
    const prompt = async (id: string, name: string, input: any, cancel = false) => {
      const slowCount = records().filter(e => e.type === 'slow-entered').length;
      const offset = records().length;
      jobs[session.id] = { generation: ++generation, call: { id, name, input } }; fs.writeFileSync(`${root}/jobs.json`, JSON.stringify(jobs));
      await client.session.prompt({ sessionID: session.id, text: 'Run the next synthetic transport case.' });
      if (cancel) { await wait(() => records().filter(e => e.type === 'slow-entered').length > slowCount, 'slow child admission'); await client.session.interrupt({ sessionID: session.id, resume: false }); }
      await client.session.wait({ sessionID: session.id }, { signal: AbortSignal.timeout(30000) });
      if (activated && id !== 'explicit-report') {
        assert.deepEqual(snapshot(), beforeHints, 'hint-only native steps cannot mutate progress');
        const fresh = records().slice(offset);
        const qualified = fresh.some(e => e.type === 'execute.after' && e.status === 'completed' &&
          (e.tool === 'subagent' || e.tool.startsWith('linear_save_') && e.input.mode?.startsWith('live-shape') && e.input.mode !== 'live-shape-partial' && e.input.mode !== 'live-shape-error'));
        const outgoing = fresh.filter(e => e.type === 'outgoing' && e.sessionID === session.id);
        const hints = outgoing.filter(e => JSON.stringify(e.system).includes(DISPATCH_OBSERVATION) || JSON.stringify(e.system).includes(TRACKER_OBSERVATION));
        assert.equal(hints.length, qualified ? 1 : 0, `conditional actor hint once: ${id}`);
        for (const e of outgoing) {
          const text = JSON.stringify(e.system);
          assert.ok(!text.includes('Synthetic issue') && !text.includes('Synthetic comment') && !text.includes('Synthetic worker complete.'));
        }
        for (const e of fresh.filter(e => e.type === 'outgoing' && e.sessionID !== session.id)) assert.ok(!JSON.stringify(e.system).includes(DISPATCH_OBSERVATION) && !JSON.stringify(e.system).includes(TRACKER_OBSERVATION), 'no child proxy relay');
      }
      console.log('completed-case', id);
    };
    if (process.env.PROXY_CODEMODE === '1') {
      await prompt('catalog-search', 'execute', { code: 'return search({query:"save_issue",limit:10});' });
      await prompt('inner-mutation', 'execute', { code: `return await tools.linear.save_issue({mode:"${process.env.PROXY_TYPED_REPLAY === '1' ? 'live-shape' : 'structured'}"});` });
      assert.ok(records().some(e => e.type === 'execute.after' && e.tool === 'linear_save_issue' && e.id === 'inner-mutation' && e.status === 'completed'), 'real Code Mode inner hook required, not merely completed wrapper');
      if (activated) await prompt('unknown-wrapper-call', 'execute', { code: 'return await tools.linear.unknown_alias({});' });
    } else if (process.env.PROXY_TYPED_REPLAY === '1') {
      if (activated) {
        const input = { agent: 'fixture-worker', description: 'Synthetic worker', prompt: 'Synthetic fixed task.' };
        await prompt('foreground', 'subagent', input);
        await prompt('background', 'subagent', { ...input, agent: 'slow-worker', background: true });
        fs.writeFileSync(`${root}/release`, 'release');
        await prompt('unknown-agent', 'subagent', { ...input, agent: 'missing-worker' });
        await prompt('child-error', 'subagent', { ...input, agent: 'failure-worker' });
        fs.rmSync(`${root}/release`, { force: true });
        await prompt('cancel', 'subagent', { ...input, agent: 'slow-worker' }, true);
        fs.writeFileSync(`${root}/release`, 'release');
      }
      for (const name of ['save_issue', 'save_comment']) {
        for (const mode of ['live-shape', 'live-shape-json-text', 'live-shape-partial', 'live-shape-error']) await prompt(`${name}-${mode}`, `linear_${name}`, { mode });
        const after = records().filter(e => e.type === 'execute.after');
        const shape = after.find(e => e.id === `${name}-live-shape`);
        const text = after.find(e => e.id === `${name}-live-shape-json-text`);
        assert.equal(shape.status, 'completed'); assert.equal(text.status, 'completed');
        assert.deepEqual(shape.result, text.result, 'identical typed metadata after both normalization paths');
        assert.equal(typeof shape.result.output.id, 'string');
        assert.equal(typeof shape.result.output.createdAt, 'string');
        assert.equal(typeof shape.result.output.updatedAt, 'string');
        if (name === 'save_issue') { assert.equal(typeof shape.result.output.uuid, 'string'); assert.equal(shape.result.output.priority.value, 0); assert.ok(Array.isArray(shape.result.output.labels)); }
        else { assert.equal(typeof shape.result.output.author.id, 'string'); assert.ok(Array.isArray(shape.result.output.attachments)); }
        assert.equal(after.find(e => e.id === `${name}-live-shape-partial`).result.output.partial, true);
        assert.equal(after.find(e => e.id === `${name}-live-shape-error`).status, 'error');
      }
    } else {
      const dispatch = { agent: 'fixture-worker', description: 'Synthetic shape dispatch', prompt: 'Synthetic fixed task.' };
      await prompt('foreground', 'subagent', { ...dispatch, background: false, model: 'proxy-fixture/script' });
      const foreground = records().find(e => e.type === 'execute.after' && e.id === 'foreground');
      assert.equal(foreground?.result?.output?.status, 'completed');
      await prompt('resume', 'subagent', { ...dispatch, sessionID: foreground.result.output.sessionID });
      await prompt('background', 'subagent', { ...dispatch, agent: 'slow-worker', background: true });
      fs.writeFileSync(`${root}/release`, 'release');
      await prompt('unknown-agent', 'subagent', { ...dispatch, agent: 'missing-worker' });
      await prompt('child-error', 'subagent', { ...dispatch, agent: 'failure-worker' });
      fs.rmSync(`${root}/release`, { force: true });
      await prompt('cancel', 'subagent', { ...dispatch, agent: 'slow-worker' }, true);
      fs.writeFileSync(`${root}/release`, 'release');
      for (const name of ['save_issue', 'save_comment']) for (const mode of ['structured', 'json-text', 'plain-text', 'error', 'partial', 'rpc-error']) await prompt(`${name}-${mode}`, `linear_${name}`, { mode });
      const after = records().filter(e => e.type === 'execute.after');
      assert.equal(after.find(e => e.id === 'background')?.result?.output?.status, 'running');
      for (const id of ['unknown-agent', 'child-error']) assert.equal(after.find(e => e.id === id)?.status, 'error');
      assert.ok(!after.some(e => e.id === 'cancel' && e.status === 'completed'), 'cancellation must not become a dispatch success');
      for (const name of ['save_issue', 'save_comment']) for (const mode of ['structured', 'json-text', 'plain-text', 'error', 'partial', 'rpc-error']) assert.equal(after.find(e => e.id === `${name}-${mode}`)?.status, mode === 'error' || mode === 'rpc-error' ? 'error' : 'completed');
    }
    if (activated) {
      await prompt('explicit-report', 'agent_progress_report', { op: 'start', plan: 'native-proxy', title: 'Synthetic native proxy proof', oid: 'proxy-start', rev: 0, items: [{ id: 'task-1', title: 'Synthetic task', kind: 'task', status: 'pending' }] });
      const after = snapshot(); assert.equal(after.plans.length, 1); assert.equal(after.receipts.length, 1); assert.equal(after.revisions.length, 1);
    }
    assert.equal(records().some(e => e.type === 'forbidden-http'), false);
  } finally {
    if (host.exitCode === null && !host.signalCode) { const exit = once(host, 'exit'); host.kill('SIGTERM'); const timer = setTimeout(() => host.kill('SIGKILL'), 5000); try { await exit; } finally { clearTimeout(timer); } }
  }
}
