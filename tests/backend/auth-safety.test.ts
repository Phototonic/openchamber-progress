import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, lstatSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { Credential } from '@opencode/schema/credential';
import { Schema } from 'effect';
import { createDisposable, clients, LIVE_REVIEW, withTransferredKey, type Binding, type Review, type Transport } from '../../scripts/auth-transfer.ts';

// Only fake values/endpoints. No live endpoint discovery, environment auth or DB.
const SENTINEL = 'SYNTHETIC_PRIVATE_SENTINEL';
const KEY = { type: 'key', key: SENTINEL, metadata: { account: SENTINEL } };
const NOW = 1_000_000;
const SYNTHETIC_REVIEW: Review = { sourceSchema: true, destinationSchema: true, sourceReadNoRefresh: true, removalIsLocal: true, providerRefreshExcluded: true, requestCapsEnforced: true };
function harness(options: { value?: unknown; source401?: boolean; create?: 'lost' | 'unknown' | '401'; removeFails?: boolean; entries?: number } = {}) {
  const sourceRoot = mkdtempSync('/tmp/opencode/agent-progress-probe-auth-source-'); chmodSync(sourceRoot, 0o700);
  const owned = createDisposable();
  const source: Binding = { endpoint: 'http://127.0.0.1:41001', root: sourceRoot, version: '2.1.3', pid: 100, expectedPid: 100 };
  const destination: Binding = { endpoint: 'http://127.0.0.1:41002', root: owned.root, version: '2.1.4', pid: 101, expectedPid: 101 };
  const calls: { side: 'source' | 'destination'; method: string; route: string }[] = [];
  const rows: any[] = []; let body: any; let stopped = false;
  const transport: Transport = async (url, init) => {
    const parsed = new URL(url); const side = parsed.port === '41001' ? 'source' : 'destination';
    const method = init.method!; calls.push({ side, method, route: parsed.pathname });
    assert.equal(init.redirect, 'error');
    if (side === 'source') {
      assert.equal(method, 'GET'); assert.equal(parsed.pathname, '/api/credential');
      if (options.source401) return new Response(SENTINEL, { status: 401 });
      return Response.json({ data: Array.from({ length: options.entries ?? 1 }, (_, i) => ({ id: `cred_source${i}`, integrationID: 'openai', label: SENTINEL, active: true, value: options.value ?? KEY })) });
    }
    if (method === 'GET') return Response.json({ data: rows });
    if (method === 'POST') {
      body = JSON.parse(String(init.body));
      if (options.create === '401') return new Response(SENTINEL, { status: 401 });
      rows.push({ id: 'cred_destination', ...body, active: true });
      if (options.create === 'unknown') { rows[0].label = 'different'; throw new Error(SENTINEL); }
      if (options.create === 'lost') throw new Error(SENTINEL);
      return Response.json({ data: rows[0] });
    }
    if (method === 'DELETE') {
      assert.equal(parsed.pathname, '/api/credential/cred_destination');
      if (options.removeFails) return new Response(SENTINEL, { status: 500 });
      rows.length = 0; return new Response(null, { status: 204 });
    }
    throw new Error(SENTINEL);
  };
  const input = { review: SYNTHETIC_REVIEW, source, destination, owned, transport,
    now: () => NOW, deadline: NOW + 1000, useSynthetic: async () => {}, stopOwned: async () => { stopped = true; } };
  return { input, calls, rows, get body() { return body; }, get stopped() { return stopped; }, clean() { if (existsSync(owned.root)) owned.dispose(); rmSync(sourceRoot, { recursive: true }); } };
}

test('current static review and executable refuse before any source/destination credential request', async () => {
  const h = harness();
  try {
    const result = await withTransferredKey({ ...h.input, review: LIVE_REVIEW });
    assert.equal(result.failure, 'review-blocked'); assert.equal(h.calls.length, 0);
    assert.equal(existsSync(h.input.owned.root), false); assert.equal(h.stopped, true);
    const run = spawnSync(process.execPath, ['scripts/auth-transfer.ts', '--live'], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin' } });
    assert.equal(run.status, 2); assert.equal(run.stdout.includes('"liveTransferEnabled":false'), true);
    assert.equal((run.stdout + run.stderr).includes(SENTINEL), false);
  } finally { h.clean(); }
});
test('actual installed OAuth schema refuses access-only; no fake refresh/expiry adaptation', () => {
  let accepted = true;
  try { Schema.decodeUnknownSync(Credential.Value)({ type: 'oauth', methodID: 'chatgpt-token-sharing', access: SENTINEL, expires: NOW + 1000 }); } catch { accepted = false; }
  assert.equal(accepted, false);
});
test('synthetic key transfer is memory-only, source GET-only, destination ID/label independent and cleanup local', async () => {
  const h = harness();
  try {
    writeFileSync(`${h.input.owned.root}/data/fake-sensitive`, SENTINEL, { mode: 0o600 });
    assert.equal(lstatSync(h.input.owned.root).mode & 0o777, 0o700);
    assert.equal(lstatSync(`${h.input.owned.root}/data/fake-sensitive`).mode & 0o777, 0o600);
    const result = await withTransferredKey(h.input);
    assert.equal(result.imported, true); assert.equal(result.failure, undefined);
    assert.equal(h.calls.filter(x => x.side === 'source').every(x => x.method === 'GET'), true);
    assert.equal(h.calls.filter(x => x.method === 'POST').length, 1);
    assert.equal(h.calls.filter(x => x.method === 'DELETE').length, 1);
    assert.equal(h.body.label === SENTINEL, false); assert.equal('metadata' in h.body.value, false);
    assert.equal('id' in h.body, false); assert.equal(h.rows.length, 0);
    assert.equal(JSON.stringify(result).includes(SENTINEL), false); assert.equal(existsSync(h.input.owned.root), false);
  } finally { h.clean(); }
});
test('same endpoint/root, wrong PID/root, symlink and redirects fail closed', async () => {
  for (const kind of ['endpoint', 'root', 'pid', 'wrong-root', 'symlink', 'redirect', 'redirect-target'] as const) {
    const h = harness();
    try {
      if (kind === 'endpoint') h.input.destination.endpoint = h.input.source.endpoint;
      if (kind === 'root') h.input.source.root = h.input.destination.root;
      if (kind === 'pid') h.input.destination.expectedPid = 999;
      if (kind === 'wrong-root') h.input.destination.root = h.input.source.root;
      if (kind === 'symlink') symlinkSync(h.input.source.root, `${h.input.owned.root}/escape`);
      if (kind === 'redirect') h.input.transport = async () => new Response(null, { status: 302, headers: { location: 'http://127.0.0.1:9999/' } });
      if (kind === 'redirect-target') h.input.transport = async () => { const r = Response.json([]); Object.defineProperty(r, 'url', { value: 'http://127.0.0.1:9999/api/credential' }); return r; };
      const result = await withTransferredKey(h.input);
      assert.equal(Boolean(result.failure), true); assert.equal(h.calls.some(x => x.method === 'POST'), false);
      assert.equal(JSON.stringify(result).includes(SENTINEL), false);
    } finally { h.clean(); }
  }
});
test('expired and nonexpiring OAuth never import; deadline, source401 and ambiguous selection stop', async () => {
  for (const mode of ['expired', 'long-oauth', 'deadline', '401', 'ambiguous'] as const) {
    const h = harness({ ...(mode === '401' ? { source401: true } : {}), ...(mode === 'ambiguous' ? { entries: 2 } : {}),
      ...(['expired', 'long-oauth'].includes(mode) ? { value: { type: 'oauth', methodID: 'chatgpt-token-sharing', access: SENTINEL, refresh: SENTINEL, expires: mode === 'expired' ? NOW - 1 : Number.MAX_SAFE_INTEGER } } : {}) });
    try {
      if (mode === 'deadline') h.input.deadline = NOW;
      const result = await withTransferredKey(h.input);
      assert.equal(result.imported, false); assert.equal(Boolean(result.failure), true);
      assert.equal(h.calls.some(x => x.method === 'POST'), false);
      assert.equal(result.failure, mode === 'expired' ? 'expired' : mode === 'long-oauth' ? 'refresh-unsafe' : mode === 'deadline' ? 'deadline' : mode === '401' ? 'http' : 'selection');
    } finally { h.clean(); }
  }
});
test('ambiguous create never retries; reconcile/remove destination only, unknown ID disposes owned root', async () => {
  for (const mode of ['lost', 'unknown', '401'] as const) {
    const h = harness({ create: mode });
    try {
      const result = await withTransferredKey(h.input);
      assert.equal(result.failure, 'import-ambiguous');
      assert.equal(h.calls.filter(x => x.method === 'POST').length, 1);
      assert.equal(h.calls.filter(x => x.method === 'DELETE').length, mode === 'lost' ? 1 : 0);
      assert.equal(h.calls.filter(x => x.side === 'source').length, 1);
      assert.equal(existsSync(h.input.owned.root), false); assert.equal(JSON.stringify(result).includes(SENTINEL), false);
    } finally { h.clean(); }
  }
});
test('interruption and secret-bearing failure after create still remove; cleanup failure stops/disposes without retry', async () => {
  for (const mode of ['abort', 'error', 'remove-fails'] as const) {
    const h = harness({ removeFails: mode === 'remove-fails' }); const controller = new AbortController();
    try {
      const result = await withTransferredKey({ ...h.input, signal: controller.signal, useSynthetic: async () => { if (mode === 'abort') controller.abort(); if (mode === 'error') throw new Error(SENTINEL); } });
      assert.equal(result.imported, true); assert.equal(result.failure, mode === 'remove-fails' ? 'cleanup' : 'interrupted');
      assert.equal(h.calls.filter(x => x.method === 'DELETE').length, 1); assert.equal(h.stopped, true);
      assert.equal(existsSync(h.input.owned.root), false); assert.equal(JSON.stringify(result).includes(SENTINEL), false);
    } finally { h.clean(); }
  }
});
test('source capability has no mutation method and transport errors have allowlisted codes only', async () => {
  const h = harness();
  try {
    const api = clients(h.input.source, h.input.destination, h.input.owned, h.input.transport);
    assert.equal(Object.keys(api.source).join(','), 'list');
    const result = await withTransferredKey({ ...h.input, transport: async () => { throw new Error(SENTINEL); } });
    assert.equal(result.failure, 'http'); assert.equal(JSON.stringify(result).includes(SENTINEL), false);
  } finally { h.clean(); }
});
