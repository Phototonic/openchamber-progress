import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { destinationClient } from '../../scripts/auth-live.ts';
import { runSubtests, type Scenario, type Metrics, type SubtestResult } from '../../scripts/auth-subtests.ts';
import { createDisposable } from '../../scripts/auth-transfer.ts';
import { callbacks, readState, changeState, PROVIDER, DEFAULT_MODEL, METHODS, type Ledger } from '../fixtures/auth-guard.ts';

function fixture(mode = '') {
  const metrics: Metrics = { admissions: 0, dispatches: 0, toolSnapshots: 0, httpStatuses: [], admissionKinds: {}, dispatchKinds: {} };
  const results: SubtestResult[] = []; let directory = '/fixture/Alpha'; let moved = false; let inputID = ''; let compact = false;
  let prompt = ''; let sid = ''; let serial = 0;
  const calls: string[] = [];
  function count(kind: string, n: number) {
    metrics.admissions += n; metrics.dispatches += n; if (kind === 'primary') metrics.toolSnapshots += n;
    metrics.admissionKinds[kind] = (metrics.admissionKinds[kind] ?? 0) + n;
    metrics.dispatchKinds[kind] = (metrics.dispatchKinds[kind] ?? 0) + n;
    metrics.httpStatuses.push(...Array.from({ length: n }, () => ({ kind, status: 200 })));
  }
  const d = destinationClient('http://127.0.0.1:30002', 'SYNTHETIC-SECRET', async (url, init) => {
    const route = new URL(url).pathname; calls.push(route);
    const json = (data: unknown) => new Response(JSON.stringify({ data }));
    sid = route.includes('ses_child') ? 'ses_child' : 'ses_root';
    if (route.endsWith('/move')) { directory = JSON.parse(init.body as string).directory; moved = true; return new Response(null, { status: 204 }); }
    if (route.endsWith('/prompt')) {
      prompt = JSON.parse(init.body as string).text; compact = false; inputID = `msg_${++serial}`;
      count('primary', prompt.includes('operation inspect') ? 3 : mode === 'budget' ? 3 : 2);
      return json({ id: inputID });
    }
    if (route.endsWith('/compact')) { compact = true; inputID = `msg_${++serial}`; count('compaction', 1); return json({ id: inputID }); }
    if (route.endsWith('/wait')) return new Response(null, { status: 204 });
    assert.equal(route.endsWith('/context'), true);
    if (compact) return json([{ id: inputID, type: 'compaction', status: mode === 'compaction-failed' ? 'failed' : 'completed', ...(mode === 'compaction-failed' ? { error: { message: 'SYNTHETIC-SECRET' } } : {}) }]);
    const op = prompt.match(/operationId ([\w-]+)/)![1]; const expected = Number(prompt.match(/expectedRevision (\d+)/)![1]);
    const identity = { callerSessionId: sid, callerAgent: sid === 'ses_child' ? 'general' : 'build', sqlite: true,
      session: { id: sid, ...(sid === 'ses_child' ? { parentID: mode === 'parent' ? 'ses_wrong' : 'ses_root' } : {}), location: { directory: sid === 'ses_child' ? '/fixture/Native' : mode === 'directory' ? '/fixture/Alpha' : directory } },
      instanceLocation: { directory: sid === 'ses_child' ? '/fixture/Native' : directory } };
    const operations = prompt.includes('operation inspect') ? ['inspect', 'report'] : ['report'];
    return json([{ id: 'msg_old', type: 'assistant', content: [] }, { id: inputID, type: 'user' }, { type: 'assistant', content: operations.map(operation => ({ type: 'tool', name: 'agent_progress_report', state: { status: 'completed', input: { operation, operationId: op, expectedRevision: expected }, content: [{ type: 'text', text: JSON.stringify(operation === 'inspect' ? identity : { revision: expected + 1, replay: mode === 'replay' }) }] } })) }]);
  }, new AbortController().signal);
  return { results, metrics, calls, get moved() { return moved; }, run(scenario: Scenario) { return runSubtests({ scenario, destination: d, rootID: 'ses_root', childID: 'ses_child', rootDirectory: '/fixture/Alpha', nativeDirectory: '/fixture/Native', moveDirectory: '/fixture/Move', boundary() {}, snapshot: () => structuredClone(metrics), moveBinding() {}, results }); } };
}
test('native parent/directory attribution and move revision continuity fit six shared admissions', async () => {
  const f = fixture(); assert.equal(await f.run('native-move'), 4);
  assert.equal(f.metrics.admissions, 6); assert.equal(f.moved, true);
  assert.deepEqual(f.results.map(r => [r.name, r.pass, r.completedProgressCalls]), [['native-child', true, 2], ['move-attribution', true, 2]]);
  assert.equal(JSON.stringify(f.results).includes('ses_root'), false); assert.equal(JSON.stringify(f.results).includes('/fixture/'), false);
});
test('stale parent/location or replayed receipt refuses without later subtests', async () => {
  for (const mode of ['parent', 'directory', 'replay']) {
    const f = fixture(mode); await assert.rejects(() => f.run('native-move'), /action/);
    assert.equal(f.results.at(-1)?.pass, false); assert.equal(f.results.at(-1)?.failureCode, 'action');
    if (mode !== 'directory') assert.equal(f.moved, false);
  }
});
test('manual compaction completion and fresh resume receipt use compaction kind within six admissions', async () => {
  const f = fixture(); assert.equal(await f.run('compaction'), 3);
  assert.equal(f.metrics.admissions, 6);
  assert.deepEqual(f.results.map(r => r.name), ['compaction-baseline', 'manual-compaction', 'compaction-resume']);
  assert.deepEqual(f.results[1].dispatchKinds, { compaction: 1 });
  const failed = fixture('compaction-failed'); await assert.rejects(() => failed.run('compaction'), /action/);
  assert.equal(failed.results.length, 2); assert.equal(failed.results[1].sessionHadErrorPart, true);
  assert.equal(JSON.stringify(failed.results).includes('SYNTHETIC-SECRET'), false);
});
test('reserve check refuses resume before submitting a prompt that cannot fit', async () => {
  const f = fixture('budget'); await assert.rejects(() => f.run('compaction'), /ledger/);
  assert.equal(f.metrics.admissions, 4); assert.equal(f.results.at(-1)?.counters.admissions, 0);
});
test('live guard binds both sessions to prewarmed locations and follows only controlled root move', () => {
  const owned = createDisposable(); const locations = ['Alpha', 'Native', 'Move'].map(n => `${owned.root}/${n}`);
  writeFileSync(`${owned.root}/guard-state.json`, JSON.stringify({ pid: process.pid, locations, armed: true, deadline: Date.now() + 60_000, dispatches: 0, activations: Object.fromEntries(locations.map(d => [d, { methods: [...METHODS], refresh: {}, authorize: {} }])), shaped: {}, retriesDenied: 0,
    live: { sessionID: 'ses_root', admissions: 0, toolSnapshots: 0, failed: false, bindings: { ses_root: { agent: 'build', directory: locations[0] }, ses_child: { agent: 'general', directory: locations[1] } } } } satisfies Ledger), { mode: 0o600 });
  try {
    const root = callbacks(owned.root, locations[0]); const native = callbacks(owned.root, locations[1]);
    const event = { model: { providerID: PROVIDER, id: DEFAULT_MODEL }, sessionID: 'ses_child', agent: 'general', kind: 'primary' };
    native.model(event); assert.throws(() => root.model(event), /m1-location-refused/);
    assert.throws(() => native.model({ ...event, agent: 'build' }), /m1-location-refused/);
    changeState(owned.root, s => { s.live!.bindings!.ses_root.directory = locations[2]; });
    const moved = { ...event, sessionID: 'ses_root', agent: 'build' };
    assert.throws(() => root.model(moved), /m1-location-refused/);
    callbacks(owned.root, locations[2]).model(moved);
    assert.deepEqual(readState(owned.root).admissionKinds, { primary: 2 });
  } finally { owned.dispose(); }
});
