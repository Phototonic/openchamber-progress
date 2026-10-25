/** Packaged payload + Designer's synthetic SDK helper; NO browser/native hook proof. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { lifecycle } from '../../setup/lifecycle.ts';
import { Store, digest } from '../../shared/store.ts';
import { activationFingerprint } from '../../shared/activation.ts';

if (process.argv[2] !== '--worker') {
  const entry = path.resolve(process.argv[2] || 'build/artifacts/agent-progress-companion-0.2.4/build/companion/index.js');
  const root = fs.mkdtempSync('/tmp/opencode/agent-progress-activation-browser-smoke-');
  try {
    const result = spawnSync(process.execPath, ['--experimental-strip-types', fileURLToPath(import.meta.url), '--worker', root, entry], {
      env: { PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`, HOME: `${root}/home`, XDG_CONFIG_HOME: `${root}/config`, XDG_DATA_HOME: `${root}/data`, XDG_CACHE_HOME: `${root}/cache`, XDG_STATE_HOME: `${root}/state`, TMPDIR: root, DBUS_SESSION_BUS_ADDRESS: 'disabled:' },
      encoding: 'utf8', timeout: 10000,
    });
    process.stdout.write(result.stdout); process.stderr.write(result.stderr);
    assert.equal(result.status, 0, 'owned synthetic helper smoke failed');
  } finally { fs.rmSync(root, { recursive: true, force: true }); assert.equal(fs.existsSync(root), false); }
} else {
  const root = process.argv[3], entry = process.argv[4];
  for (const dir of ['home', 'config/opencode', 'data/opencode', 'project', 'cache', 'state']) fs.mkdirSync(`${root}/${dir}`, { recursive: true, mode: 0o700 });
  const plugin = fs.readFileSync(entry, 'utf8');
  const guidance = fs.readFileSync(path.join(path.dirname(entry), 'SKILL.md'));
  lifecycle('install', { configRoot: `${root}/config/opencode`, dataRoot: `${root}/data/opencode`, storeRoot: `${root}/store`, confirmed: true }, { plugin, guidance: guidance.toString('utf8'), removal: '// unused fixture', version: '0.2.4' });
  const binding = JSON.parse(fs.readFileSync(`${root}/config/opencode/plugins/agent-progress/progress-binding.json`, 'utf8'));
  const descriptors = () => fs.readdirSync('/proc/self/fd').filter(fd => { try { return fs.readlinkSync(`/proc/self/fd/${fd}`) === binding.database; } catch { return false; } }).length;
  assert.equal(descriptors(), 0);
  const { loadReportTool } = await import('../browser/real-tool.ts');
  const tool = await loadReportTool(root, { M: { id: 'ses_browser_fixture', location: { directory: `${root}/project` }, agent: 'synthetic-coordinator', projectID: 'fixture' } });
  try {
    assert.equal(descriptors(), 1);
    const receipt = await tool.report('M', { op: 'start', plan: 'synthetic-helper', oid: 'start', rev: 0, title: 'Structured', items: [{ id: 'a', title: 'First', kind: 'task' }, { id: 'b', title: 'Second', kind: 'task' }] });
    assert.equal(receipt.rev, 1);
    assert.equal((await tool.report('M', { op: 'change', plan: 'synthetic-helper', oid: 'change', rev: 'auto', changes: [{ id: 'a', status: 'working' }] })).rev, 2);
  } finally { await tool.dispose(); }
  assert.equal(descriptors(), 0, 'awaited async disposal closes production Store');
  const store = new Store(binding.database);
  let loaded: string | null;
  try { const plan = store.get(binding.source.id, 'synthetic-helper')!; assert.equal(plan.revision, 2); assert.equal(plan.sessionId, 'ses_browser_fixture'); assert.equal(plan.items[0].status, 'working'); assert.equal(plan.document.state, 'unbound'); loaded = store.loadedFingerprint(binding.source.id, binding.installId); assert.equal(loaded, activationFingerprint(binding, Buffer.from(plugin), guidance)); } finally { store.close(); }
  assert.deepEqual(fs.readdirSync(`${root}/project`), []);
  console.log(JSON.stringify({ syntheticBrowserHelperSmoke: true, selectedCompanionSHA256: digest(plugin), selectedGuidanceSHA256: digest(guidance), loadedActivationFingerprint: loaded, fingerprintScope: 'synthetic binding; verified selected bytes, not portable/native proof', realStoreRevision: 2, sourceFree: true, awaitedDisposalClosedStore: true, nativeHooks: 'NOT EXERCISED: Designer helper uses registration stubs', browserLaunched: false, modelRequests: 0 }));
}
