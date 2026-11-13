import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import { once } from 'node:events';
import { readFileSync, writeFileSync, readdirSync, lstatSync, chmodSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createProgressServer } from '../../service/server.ts';
import { SetupController } from '../../service/setup-controller.ts';
import { productionFixture } from '../fixtures/production.ts';
import { oldUpdateModule } from '../fixtures/pre-retirement-updates.ts';
import { RELEASE } from '../../shared/release.ts';

const snapshot = (root: string) => Object.fromEntries(readdirSync(root, { recursive: true }).map(String)
  .filter(p => lstatSync(resolve(root, p)).isFile()).map(p => [p, readFileSync(resolve(root, p)).toString('base64')]));
const expected = (now: number) => ({ installedVersion: RELEASE, repository: 'Phototonic/openchamber-progress', ref: 'main',
  state: 'unknown', checkedAt: null, stale: false, diagnostic: 'unavailable', nextCheckAt: new Date(now + 3_600_000).toISOString() });

test('QA-R authenticated retained route is network-free from startup through shutdown, independent of stores', { timeout: 20000 }, async t => {
  const nativeRequest = http.request.bind(http);
  let outbound = 0;
  const blocked = () => { outbound++; throw Error('Outbound transport forbidden'); };
  // Requests into our loopback server use the saved nativeRequest, never these clients.
  const mocks = [mock.method(globalThis, 'fetch', blocked), mock.method(http, 'request', blocked), mock.method(http, 'get', blocked),
    mock.method(https, 'request', blocked), mock.method(https, 'get', blocked)];
  const request = (base: string, options: { path?: string; method?: string; bearer?: string | null; body?: string; chunked?: boolean } = {}) =>
    new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: any }>((resolve, reject) => {
      const headers: Record<string, string> = { ...(options.bearer === null ? {} : { authorization: `Bearer ${options.bearer ?? 'fixture-only'}` }),
        ...(options.body ? options.chunked ? { 'transfer-encoding': 'chunked' } : { 'content-length': String(Buffer.byteLength(options.body)) } : {}) };
      const req = nativeRequest(base + (options.path ?? '/v1/extension-update'), { method: options.method ?? 'GET', headers }, res => {
        let text = ''; res.setEncoding('utf8'); res.on('data', chunk => text += chunk);
        res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body: JSON.parse(text) }));
      });
      req.on('error', reject); req.setTimeout(3000, () => req.destroy(Error('Fixture request timeout'))); req.end(options.body);
    });
  const api: object[] = [];
  try {
    for (const state of ['unconfigured', 'configured', 'unreadable'] as const) {
      const f = productionFixture();
      const setup = new SetupController(`${f.root}/service-binding.json`, () => ({ plugin: 'export default {}', guidance: 'Fixture only', removal: '// fixture', version: RELEASE }));
      if (state !== 'unconfigured') setup.run('install', { configRoot: f.source.configRoot, dataRoot: f.source.dataRoot, storeRoot: `${f.root}/selected-store`, confirmed: true });
      const selected = state === 'unconfigured' ? undefined : setup.current().store!;
      const database = selected?.file;
      if (state === 'unreadable') setup.close();
      writeFileSync(`${f.root}/synthetic-settings.json`, '{"retained":true}');
      const before = snapshot(f.root);
      if (state === 'unreadable') chmodSync(database!, 0o000);
      const originalCurrent = setup.current.bind(setup);
      let lookups = 0;
      setup.current = () => { lookups++; throw Error('Compatibility route must not consult store'); };
      const server = createProgressServer(undefined, 'fixture-only', undefined, setup);
      try {
        server.listen(0, '127.0.0.1'); await once(server, 'listening');
        const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
        const refused = [
          { bearer: null, status: 401, error: 'unauthorized' }, { bearer: 'wrong', status: 401, error: 'unauthorized' },
          { method: 'POST', status: 405, error: 'method-not-allowed' },
          ...['?ref=dev', '?source=x', '?ref=main&ref=dev'].map(query => ({ path: `/v1/extension-update${query}`, status: 404, error: 'not-found' })),
          { body: '{}', status: 400, error: 'body-not-allowed' }, { body: '{}', chunked: true, status: 400, error: 'body-not-allowed' },
        ];
        for (const options of refused) {
          const r = await request(base, options); assert.equal(r.status, options.status); assert.deepEqual(r.body, { error: options.error });
          assert.equal(r.headers['cache-control'], 'no-store');
        }
        for (let round = 0; round < 2; round++) {
          const now = Date.UTC(2026, 0, 1) + round * 4_000_000;
          mock.timers.enable({ apis: ['Date'], now });
          try {
            const replies = await Promise.all(Array.from({ length: 6 }, () => request(base)));
            for (const r of replies) {
              assert.equal(r.status, 200); assert.deepEqual(r.body, expected(now));
              assert.equal(Date.parse(r.body.nextCheckAt) - Date.now(), 3_600_000, 'backoff follows response construction, not a cache');
              assert.equal(r.headers['cache-control'], 'no-store'); assert.equal(r.headers['x-content-type-options'], 'nosniff');
              const old = oldUpdateModule('adapter.ts').parseExtensionUpdate(JSON.stringify(r.body));
              assert.equal(old.state, 'unknown');
              const oldGuest = oldUpdateModule('official.ts');
              const hooks = { officialMain: old, officialMainDismissed: null, env: { locale: 'en' } };
              assert.equal(oldGuest.officialMainBlock(hooks), null); assert.equal(oldGuest.officialMainLine(hooks, () => {}), null);
            }
          } finally { mock.timers.reset(); }
        }
        assert.equal(lookups, 0);
        setup.current = originalCurrent;
        assert.equal((await request(base, { path: '/v1/plans' })).status, state === 'configured' ? 200 : 503, 'normal store reads retain their independent result');
        if (state === 'unreadable') { assert.equal(lstatSync(database!).mode & 0o777, 0); chmodSync(database!, 0o600); }
        assert.deepEqual(snapshot(f.root), before, 'route and refusals preserve synthetic persistent bytes');
        api.push({ state, successfulReads: 12, refusals: refused.length, storeLookups: lookups, outboundAttempts: outbound });
      } finally {
        await new Promise<void>(r => server.close(() => r()));
        if (database) chmodSync(database, 0o600);
        setup.close(); f.cleanup();
      }
    }
    assert.equal(outbound, 0);
    if (process.env.EVIDENCE) { mkdirSync(process.env.EVIDENCE, { recursive: true }); writeFileSync(resolve(process.env.EVIDENCE, 'api.json'), JSON.stringify({ cases: api, outboundAttempts: outbound }, null, 2)); }
  } finally { for (const m of mocks) m.mock.restore(); }
});

test('QA-R service source graph contains no outbound metadata client', () => {
  // The HTTP server is required; HTTP client calls and provider modules are not.
  // Follow runtime relative imports rather than inspecting only the route's text.
  const visited = new Set<string>();
  function visit(file: string) {
    if (visited.has(file)) return; visited.add(file);
    const text = readFileSync(file, 'utf8');
    assert.doesNotMatch(text, /\bfetch\s*\(|\b(?:http|https)\.(?:request|get)\s*\(|api\.github\.com|\b(?:undici|axios|node-fetch)\b/, file);
    for (const match of text.matchAll(/^import\s+(?!type\b)[\s\S]*?from\s*['"]([^'"]+)['"]/gm)) {
      if (match[1]!.startsWith('.')) visit(resolve(file, '..', match[1]!));
    }
  }
  visit(resolve('service/main.ts'));
  assert.ok(visited.has(resolve('service/server.ts')));
});
