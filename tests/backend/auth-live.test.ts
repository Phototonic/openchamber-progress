import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { createDisposable } from '../../scripts/auth-transfer.ts';
import { sourceClient, selectZaiKey } from '../../scripts/auth-source.ts';
import { destinationClient, runRootWithCopy } from '../../scripts/auth-live.ts';
import { callbacks, readState, METHODS, PROVIDER, DEFAULT_MODEL, ROUTE, type Ledger } from '../fixtures/auth-guard.ts';
import { Credential } from '@opencode/schema/credential';
import { Schema } from 'effect';

const SECRET = 'SYNTHETIC-SECRET-DO-NOT-LOG';
const sourceEntry = () => ({ id: 'cred_source', integrationID: PROVIDER, label: 'PRIVATE-SOURCE-LABEL', active: true, value: { type: 'key' as const, key: SECRET } });
function fixture(mode = 'success') {
  const abort = new AbortController(); const calls: { host: string; method: string; route: string }[] = [];
  let saved: any; let creates = 0; let hardStop: boolean | undefined; let disposed = false;
  const wire = async (url: string, init: RequestInit) => {
    const u = new URL(url); const method = init.method!;
    calls.push({ host: u.host, method, route: u.pathname });
    const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
    if (u.port === '30001') {
      assert.equal(method, 'GET'); assert.equal(u.pathname, '/api/credential');
      return json({ data: [{ ...sourceEntry(), value: mode === 'oauth' ? { type: 'oauth', methodID: 'synthetic', access: SECRET, refresh: SECRET, expires: 0 } : { ...sourceEntry().value, ...(mode === 'empty-key' ? { key: '' } : {}) } }] });
    }
    if (u.pathname === '/api/credential') {
      if (method === 'GET') return json({ data: saved ? [saved] : [] });
      assert.equal(method, 'POST'); creates++;
      const input = JSON.parse(init.body as string);
      assert.equal(input.label.startsWith('m1-isolated-'), true);
      assert.deepEqual(Object.keys(input.value).sort(), ['key', 'type']);
      assert.equal(input.integrationID, PROVIDER);
      saved = { ...input, id: 'cred_destination', active: true };
      if (mode === 'cancel') abort.abort();
      if (mode === 'unknown') { saved = undefined; throw new Error(`${SECRET} unknown reply`); }
      if (mode === 'ambiguous') throw new Error(`${SECRET} lost reply`);
      return json({ data: saved });
    }
    if (u.pathname === '/api/credential/cred_destination') {
      assert.equal(method, 'DELETE');
      if (mode === 'cleanup') throw new Error(SECRET);
      saved = undefined; return new Response(null, { status: 204 });
    }
    if (u.pathname === '/api/model') return json({ data: mode === 'catalog-missing' ? [] : [{ providerID: PROVIDER, id: DEFAULT_MODEL, capabilities: { tools: true } }] });
    if (u.pathname.endsWith('/wait') && mode === 'wait-timeout') throw new DOMException(SECRET, 'TimeoutError');
    if (u.pathname.endsWith('/context')) return json({ data: [{ id: 'msg_input', type: 'user' }, { type: 'assistant', content: ['inspect', 'report'].map(operation => ({ type: 'tool', name: 'agent_progress_report', state: { status: 'completed', input: { operation, operationId: 'm1-root-1', expectedRevision: 0 }, content: [{ type: 'text', text: JSON.stringify(operation === 'inspect' ? { callerSessionId: 'ses_root', callerAgent: 'build', session: { id: 'ses_root' }, sqlite: true } : { revision: 1, replay: false }) }] } })) }] });
    if (mode === 'provider') throw new Error(`Authorization: Bearer ${SECRET}`);
    assert.ok(['/api/session/ses_root/prompt', '/api/experimental/session/ses_root/wait'].includes(u.pathname));
    return json({ data: u.pathname.endsWith('/prompt') ? { id: 'msg_input' } : {} });
  };
  const source = sourceClient({ endpoint: 'http://127.0.0.1:30001', pid: 101, root: '/synthetic/source' }, SECRET, wire, abort.signal);
  const destination = destinationClient('http://127.0.0.1:30002', SECRET, wire, abort.signal);
  return { calls, get creates() { return creates; }, get saved() { return saved; }, get stopped() { return hardStop; }, get disposed() { return disposed; },
    run: (deadline = Date.now() + 60_000) => runRootWithCopy({ source, destination, endpoint: 'http://127.0.0.1:30002', pid: 102, root: '/synthetic/fresh', sessionID: 'ses_root', modelID: DEFAULT_MODEL, deadline, signal: abort.signal, assertReady() { if (mode === 'ledger' && saved) throw new Error(SECRET); }, async stop(hard) { hardStop = hard; }, dispose() { disposed = true; } }),
  };
}
test('concrete key transfer uses one GET-only source, minimal projection, one create and local cleanup', async () => {
  const f = fixture(); const r = await f.run();
  assert.equal(r.failure, null); assert.equal(r.completedProgressCalls, 2); assert.equal(f.creates, 1);
  assert.equal(r.sessionHadErrorPart, false); assert.deepEqual(r.assistantToolCounts, { agent_progress_report: 2 });
  assert.equal(f.saved, undefined); assert.equal(f.stopped, false); assert.equal(f.disposed, true);
  assert.deepEqual(f.calls.filter(c => c.host.endsWith(':30001')).map(c => [c.method, c.route]), [['GET', '/api/credential']]);
  for (const forbidden of [SECRET, 'PRIVATE-SOURCE-LABEL', 'PRIVATE-ACCOUNT', 'cred_source']) assert.equal(JSON.stringify(r).includes(forbidden), false);
});
test('OAuth, empty key and pre-import deadline refuse without create', async () => {
  for (const mode of ['oauth', 'empty-key', 'deadline']) {
    const f = fixture(mode); const r = await f.run(mode === 'deadline' ? Date.now() - 1 : undefined);
    assert.ok(r.failure); assert.equal(f.creates, 0); assert.equal(f.disposed, true);
  }
  assert.throws(() => selectZaiKey([sourceEntry(), { ...sourceEntry(), id: 'cred_other' }].map(v => Schema.decodeUnknownSync(Credential.Entry)(v))), /selection/);
  assert.throws(() => selectZaiKey([{ ...sourceEntry(), integrationID: 'openai' }].map(v => Schema.decodeUnknownSync(Credential.Entry)(v))), /selection/);
});
test('ambiguous import reconciles destination only, never retries or proceeds to inference', async () => {
  const f = fixture('ambiguous'); const r = await f.run();
  assert.equal(r.failure, 'import-ambiguous'); assert.equal(f.creates, 1); assert.equal(f.saved, undefined);
  assert.equal(f.calls.some(c => c.route.endsWith('/prompt')), false); assert.equal(f.stopped, false);
  const unknown = fixture('unknown'); const uncertain = await unknown.run();
  assert.equal(uncertain.failure, 'cleanup'); assert.equal(unknown.creates, 1); assert.equal(unknown.stopped, true); assert.equal(unknown.disposed, true);
});
test('cancellation/provider errors still remove; cleanup uncertainty hard stops; only fixed codes escape', async () => {
  for (const mode of ['cancel', 'provider', 'cleanup']) {
    const f = fixture(mode); const r = await f.run();
    assert.ok(r.failure); assert.equal(f.creates, 1); assert.equal(f.disposed, true);
    assert.equal(f.calls.some(c => c.method === 'DELETE'), true);
    assert.equal(f.stopped, mode === 'cleanup'); assert.equal(JSON.stringify(r).includes(SECRET), false);
  }
});
test('GET capability has no generic request/mutation and suppresses secret errors/redirects', async () => {
  const source = sourceClient({ endpoint: 'http://127.0.0.1:30001', pid: 101, root: '/synthetic/source' }, SECRET, async (_u, init) => { assert.equal(init.method, 'GET'); throw new Error(SECRET); }, new AbortController().signal);
  assert.deepEqual(Object.keys(source).sort(), ['endpoint', 'info', 'list', 'models', 'pid', 'root', 'schema']);
  for (const call of [source.info, source.schema, source.list, source.models]) await assert.rejects(call, e => e instanceof Error && e.message === 'source-http');
  const redirect = sourceClient({ endpoint: 'http://127.0.0.1:30001', pid: 101, root: '/synthetic/source' }, SECRET, async () => Response.redirect('https://invalid.example/'), new AbortController().signal);
  await assert.rejects(redirect.list, /source-http/);
});
test('source model GET is plain read-only and projects only z.ai model metadata', async () => {
  const source = sourceClient({ endpoint: 'http://127.0.0.1:30001', pid: 101, root: '/synthetic/source' }, SECRET, async (url, init) => {
    assert.equal(url, 'http://127.0.0.1:30001/api/model'); assert.equal(init.method, 'GET'); assert.equal(init.redirect, 'error');
    assert.deepEqual(Object.keys(init.headers as object), ['authorization']);
    return new Response(JSON.stringify({ data: [{ providerID: PROVIDER, id: DEFAULT_MODEL, capabilities: { tools: true }, unused: SECRET }, { providerID: 'other', id: 'other', capabilities: { tools: true } }] }));
  }, new AbortController().signal);
  assert.deepEqual(await source.models(), [{ providerID: PROVIDER, id: DEFAULT_MODEL, capabilities: { tools: true } }]);
});
test('destination must expose the chosen source-derived tools model after import, or remove and stop', async () => {
  const f = fixture('catalog-missing'); const r = await f.run();
  assert.equal(r.failure, 'selection'); assert.equal(r.imported, true); assert.equal(f.saved, undefined);
  assert.equal(f.calls.some(c => c.route.endsWith('/prompt')), false); assert.equal(f.disposed, true);
});
test('wait failure keeps its sanitized stage across cleanup; ledger refusal has its own code', async () => {
  const f = fixture('wait-timeout'); const r = await f.run();
  assert.equal(r.failure, 'destination'); assert.equal(r.destinationStage, 'wait');
  assert.equal(r.sessionHadErrorPart, null); assert.equal(r.assistantToolCounts, null);
  assert.equal(f.saved, undefined); assert.equal(f.disposed, true); assert.equal(f.creates, 1);
  assert.equal(JSON.stringify(r).includes(SECRET), false);
  const ledger = fixture('ledger'); const refused = await ledger.run();
  assert.equal(refused.failure, 'ledger'); assert.equal(ledger.saved, undefined); assert.equal(ledger.disposed, true);
  assert.equal(ledger.calls.some(c => c.route.endsWith('/prompt')), false);
});
test('live registered guards cap all role admissions, narrow tools without additions, bind session and count HTTP', async () => {
  const owned = createDisposable(); const dir = `${owned.root}/Alpha`; const model = { providerID: PROVIDER, id: DEFAULT_MODEL };
  writeFileSync(`${owned.root}/guard-state.json`, JSON.stringify({ pid: process.pid, locations: [dir], armed: true, deadline: Date.now() + 60_000, dispatches: 0, activations: { [dir]: { methods: [...METHODS], refresh: {}, authorize: {} } }, shaped: {}, retriesDenied: 0, live: { sessionID: 'ses_root', admissions: 0, toolSnapshots: 0, failed: false } } satisfies Ledger), { mode: 0o600 });
  try {
    const hooks = callbacks(owned.root); const event = { model, sessionID: 'ses_root', agent: 'build', kind: 'primary' };
    const shape = { model, options: {}, tools: { agent_progress_report: {}, shell: {}, read: {}, skill: {}, task: {} } };
    hooks.shape('primary', shape); assert.deepEqual(Object.keys(shape.tools), ['agent_progress_report']);
    const restricted = { model, options: {}, tools: { shell: {} } }; hooks.shape('primary', restricted); assert.deepEqual(restricted.tools, {});
    assert.throws(() => hooks.model({ ...event, sessionID: 'ses_child' }), /m1-role-refused/);
    for (let i = 0; i < 6; i++) hooks.model({ ...event, kind: ['primary', 'title', 'compaction', 'generate'][i % 4] });
    assert.throws(() => hooks.model(event), /m1-action-cap/);
    for (let i = 0; i < 12; i++) await hooks.http({ ...event, request: new Request(ROUTE, { method: 'POST', body: JSON.stringify({ model: model.id, max_tokens: 900 }) }) });
    await assert.rejects(() => hooks.http({ ...event, request: new Request(ROUTE, { method: 'POST', body: JSON.stringify({ model: model.id, max_tokens: 900 }) }) }), /m1-dispatch-cap/);
    assert.equal(readState(owned.root).dispatches, 12);
    hooks.response({ kind: 'primary', response: new Response(SECRET, { status: 200 }) });
    hooks.response({ kind: 'primary', response: new Response(SECRET, { status: 429 }) });
    hooks.retry({ decision: { retry: true } });
    const state = readState(owned.root);
    assert.deepEqual(state.httpStatuses, [{ kind: 'primary', status: 200 }, { kind: 'primary', status: 429 }]);
    assert.equal(state.live?.failed, true); assert.equal(state.retriesDenied, 1);
    assert.equal(JSON.stringify(state).includes(SECRET), false);
  } finally { owned.dispose(); }
});
