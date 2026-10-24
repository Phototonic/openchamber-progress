import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createDisposable } from '../../scripts/auth-transfer.ts';
import { LIVE_CLEARANCE } from '../../scripts/auth-live.ts';
import { callbacks, readState, changeState, METHODS, PROVIDER, DEFAULT_MODEL, ROUTE, type Ledger } from '../fixtures/auth-guard.ts';

function fixture() {
  const owned = createDisposable(); const locations = ['Alpha', 'Native', 'Move'].map(n => `${owned.root}/${n}`);
  writeFileSync(`${owned.root}/guard-state.json`, JSON.stringify({ pid: process.pid, locations, armed: true, deadline: Date.now() + 60_000, dispatches: 0,
    activations: Object.fromEntries(locations.map(dir => [dir, { methods: [...METHODS], refresh: {}, authorize: {} }])), shaped: {}, retriesDenied: 0 } satisfies Ledger), { mode: 0o600 });
  return { owned, hooks: callbacks(owned.root) };
}
const model = { providerID: PROVIDER, id: DEFAULT_MODEL };
test('registered shaping callback restores900 after omission for each auxiliary/primary kind', () => {
  const { owned, hooks } = fixture();
  try {
    for (const kind of ['primary', 'compaction', 'generate', 'title']) {
      const event = { model, options: {} as Record<string, unknown> };
      hooks.shape(kind, event); assert.equal(event.options.maxTokens, 900);
    }
    assert.throws(() => hooks.shape('primary', { model: { ...model, providerID: 'opencode' }, options: {} }), /m1-model-refused/);
  } finally { owned.dispose(); }
});
test('HTTP guard refuses absent/oversized/conflicting caps, wrong route and compression before counting', async () => {
  const { owned, hooks } = fixture();
  const sentinel = 'SYNTHETIC-BODY-SENTINEL';
  try {
    for (const variant of ['absent', 'oversized', 'conflict', 'route', 'compressed'] as const) {
      const body = { messages: [{ role: 'user', content: sentinel }], ...(variant === 'absent' ? {} : { max_tokens: variant === 'oversized' ? 901 : 900 }), ...(variant === 'conflict' ? { max_output_tokens: 900 } : {}) };
      let error = '';
      try { await hooks.http({ model, request: new Request(variant === 'route' ? 'https://api.openai.com/v1/responses' : ROUTE, {
        method: 'POST', headers: { 'content-type': 'application/json', ...(variant === 'compressed' ? { 'content-encoding': 'zstd' } : {}) }, body: JSON.stringify(body),
      }) }); } catch (e) { error = (e as Error).message; }
      assert.equal(error.startsWith('m1-'), true); assert.equal(error.includes(sentinel), false);
      assert.equal(readState(owned.root).dispatches, 0);
    }
    await hooks.http({ model, request: new Request(ROUTE, { method: 'POST', body: JSON.stringify({ messages: [{ role: 'user', content: sentinel }], max_tokens: 900 }) }) });
    assert.equal(readState(owned.root).dispatches, 1);
  } finally { owned.dispose(); }
});
test('retry always denied; deadline stops shape and dispatch; live invocation stays out of suite', async (t) => {
  const { owned, hooks } = fixture();
  try {
    const event = { decision: { retry: true } }; hooks.retry(event); assert.equal(event.decision.retry, false);
    changeState(owned.root, s => { s.deadline = Date.now() - 1; });
    assert.throws(() => hooks.shape('primary', { model, options: {} }), /m1-deadline/);
    await assert.rejects(() => hooks.http({ model, request: new Request(ROUTE, { method: 'POST', body: '{"max_tokens":900}' }) }), /m1-deadline/);
    if (!LIVE_CLEARANCE) {
      const run = spawnSync(process.execPath, ['scripts/auth-guard-probe.ts', '--live'], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin' } });
      assert.equal(run.status, 2); assert.equal(run.stdout.includes('"liveEnabled":false'), true);
      assert.equal(run.stderr, '');
    } else t.diagnostic('Live invocation intentionally untested in-suite while clearance is enabled.');
  } finally { owned.dispose(); }
});
