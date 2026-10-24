import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { fork, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { openProbeStore, snapshot, report } from '../../shared/probe-store.ts';
import { counts } from '../../shared/contract.ts';
import { parseManifestJson } from '@openchamber/sdk/schemas';

function root() { return mkdtempSync('/tmp/opencode/agent-progress-probe-test-'); }
test('fixture counts exclude group, skipped and relay; independent objectives', () => {
  const r = root(); const db = openProbeStore(`${r}/progress.sqlite`);
  try {
    const view = snapshot(db);
    assert.deepEqual(counts(view.plans[0].items), { done: 2, total: 4, remaining: 2, skipped: 1 });
    assert.equal(view.plans[1].sessionId, view.plans[0].sessionId);
    assert.notEqual(view.plans[0].id, view.plans[1].id);
    assert.equal(view.coverage, 'fixture-only');
  } finally { db.close(); rmSync(r, { recursive: true }); }
});
test('actual SDK parser recognizes all three probe manifest entries and service grants', () => {
  const result = parseManifestJson(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  assert.equal(result.ok, true);
  assert.equal(result.manifest.contributes.panel.entry, 'ui/panel/index.html');
  assert.deepEqual(result.manifest.contributes.capabilities, ['sessions']);
  assert.ok(result.manifest.contributes.service);
  assert.ok(result.manifest.contributes.page);
  assert.ok(result.manifest.contributes.statusSection);
});
test('replay/conflict and shared store identities, unrelated store differs', () => {
  const r = root(); const a = openProbeStore(`${r}/same.sqlite`); const b = openProbeStore(`${r}/same.sqlite`); const c = openProbeStore(`${r}/other.sqlite`);
  try {
    assert.equal(snapshot(a).sourceId, snapshot(b).sourceId);
    assert.notEqual(snapshot(a).sourceId, snapshot(c).sourceId);
    assert.deepEqual(report(a, 'op1', 0, 'payload'), { revision: 1, replay: false });
    assert.deepEqual(report(b, 'op1', 0, 'payload'), { revision: 1, replay: true });
    assert.throws(() => report(b, 'op1', 0, 'altered'), /operation-reused/);
    assert.throws(() => report(b, 'op2', 0, 'payload'), /conflict:1/);
  } finally { a.close(); b.close(); c.close(); rmSync(r, { recursive: true }); }
});
test('two actual writers conflict; killed uncommitted writer leaves committed state', { timeout: 10000 }, async () => {
  const r = root(); const file = `${r}/progress.sqlite`; openProbeStore(file).close();
  function worker(mode: string, id: string) { return fork(new URL('./worker.ts', import.meta.url), [file, mode, id], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] }); }
  const children: ReturnType<typeof worker>[] = [];
  try {
    const a = worker('write', 'a'); const b = worker('write', 'b'); children.push(a, b);
    const exits = [once(a, 'exit'), once(b, 'exit')];
    const messages = await Promise.all([once(a, 'message'), once(b, 'message')]);
    assert.equal(messages.filter(([m]) => m.ok).length, 1);
    assert.match(messages.find(([m]) => !m.ok)![0].error, /conflict:1/);
    await Promise.all(exits);
    const holder = worker('hold', 'h'); children.push(holder);
    await once(holder, 'message'); const killed = once(holder, 'exit'); holder.kill('SIGKILL'); await killed;
    const db = openProbeStore(file);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reports').get()!.n, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM reports WHERE operation_id='uncommitted'").get()!.n, 0);
    db.close();
  } finally { for (const c of children) if (c.exitCode === null && !c.signalCode) c.kill('SIGKILL'); rmSync(r, { recursive: true }); }
});
test('corrupt store is preserved, never reset', () => {
  const r = root(); const f = `${r}/bad.sqlite`; const bytes = Buffer.from('not a sqlite database'); writeFileSync(f, bytes);
  try { assert.throws(() => openProbeStore(f)); assert.deepEqual(readFileSync(f), bytes); }
  finally { rmSync(r, { recursive: true }); }
});
test('real HTTP service auth/health/read; standalone runtime only', { timeout: 10000 }, async () => {
  const r = root(); const descriptor = `${r}/binding.json`; writeFileSync(descriptor, JSON.stringify({ probeOnly: true, database: `${r}/progress.sqlite` }));
  const reservation = createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
  const port = (reservation.address() as { port: number }).port; await new Promise<void>(resolve => reservation.close(() => resolve()));
  const token = randomBytes(24).toString('hex');
  const child = spawn(process.execPath, ['tests/fixtures/probe-service.ts'], { env: { PATH: process.env.PATH, HOME: r, AGENT_PROGRESS_PROBE_DESCRIPTOR: descriptor, OPENCHAMBER_SERVICE_PORT: String(port), OPENCHAMBER_SERVICE_TOKEN: token }, stdio: ['ignore', 'ignore', 'inherit'] });
  const url = `http://127.0.0.1:${port}`;
  const auth = { authorization: `Bearer ${token}` };
  try {
    const end = Date.now() + 5000; let ready = false;
    while (Date.now() < end) {
      if (child.exitCode !== null) throw new Error('service-exited');
      try { ready = (await fetch(`${url}/health`, { headers: auth })).status === 200; if (ready) break; } catch {}
      await new Promise(resolve => setTimeout(resolve, 30));
    }
    assert.equal(ready, true);
    assert.equal((await fetch(`${url}/health`)).status, 401);
    assert.equal((await fetch(`${url}/health`, { headers: { authorization: 'Bearer wrong' } })).status, 401);
    const response = await fetch(`${url}/probe/progress`, { headers: auth }); const body = await response.json();
    assert.equal(body.protocolVersion, 1); assert.equal(body.coverage, 'fixture-only'); assert.equal(body.plans.length, 3);
    assert.equal((await fetch(`${url}/probe/progress?path=/etc/passwd`, { headers: auth })).status, 404);
    assert.equal((await fetch(`${url}/probe/progress`, { method: 'POST', headers: auth })).status, 405);
    assert.equal(JSON.stringify(body).includes(token), false);
  } finally {
    if (child.exitCode === null && child.signalCode === null) { const exit = once(child, 'exit'); child.kill('SIGTERM'); await exit; }
    rmSync(r, { recursive: true });
  }
});
