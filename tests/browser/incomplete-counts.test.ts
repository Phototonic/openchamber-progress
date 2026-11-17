import test from 'node:test';
import assert from 'node:assert/strict';
import type { RunRead } from '../../shared/subagent-runs.ts';
import type { RunsPanel } from '../../ui/shared/runs.ts';
import type { InboxPanel } from '../../ui/shared/inbox.ts';
import type { StoreRead } from '../../ui/shared/model.ts';
import { countFacts, countReasonIdentity, emptyCountFacts, type CountFacts } from '../../ui/shared/incomplete-counts.ts';
import { supportSummary, unknownFacts } from '../../ui/shared/reporting-health.ts';
import { DeviceViewState } from '../../ui/shared/device-view-state.ts';
import type { LanguageStorageValue } from '../../ui/shared/language.ts';

const read = (extra: Partial<RunRead> = {}): RunRead => ({
  protocolVersion: 2, schemaVersion: 2, storeId: 'example-store', sourceBinding: { sourceId: 'example-source', verified: true },
  source: 'example-source', root: 'example-root', plan: 'example-plan', cleanupRev: 0, view: 'useful',
  subagentRuns: 1, runFormat: 2, availability: 'ready', readAt: 1000, revision: 1,
  capture: { enabled: true, state: 'last-known', loss: false },
  recovery: { state: 'complete', reason: null, token: null },
  counts: { children: 0, runs: 5, historicalSessions: 2, running: 0, succeeded: 5, failed: 0, interrupted: 0, unknown: 0 },
  coverage: { scope: 'retained', complete: true, reasons: [] }, data: [], nextCursor: null, ...extra,
});
const runs = (r: RunRead) => ({ read: r, featured: [], more: [], reconciling: false }) as unknown as RunsPanel;
test('one canonical reason set, independent of totals, order, paging and language', () => {
  const exact = countFacts(null, null, runs(read()), null);
  assert.deepEqual(exact.reasons, []);
  const partial = read({ capture: { enabled: true, state: 'last-known', loss: true, lossNotice: { lastLossAt: 100, sequence: 2, dismissedThrough: 0, attention: true } }, recovery: { state: 'partial', reason: null, token: 'example' }, coverage: { scope: 'retained', complete: false, reasons: ['capture-loss', 'partial-history', 'traversal-limit'] } });
  const plans = { plans: [], truncated: true } as unknown as StoreRead;
  const inbox = { model: { availability: 'ready', complete: false, gapped: true } } as InboxPanel;
  const f = countFacts(plans, inbox, runs(partial), { state: 'loading', rootId: 'example' });
  assert.deepEqual(f.reasons, ['plans-not-loaded', 'plans-not-checked', 'plans-unreadable', 'history-not-loaded', 'recording-gap', 'run-traversal', 'host-not-checked']);
  assert.equal(countReasonIdentity('example', f), countReasonIdentity('example', { ...f, plans: 45, reasons: [...f.reasons].reverse() }));
  assert.notEqual(countReasonIdentity('example', f), countReasonIdentity('example', { ...f, detection: 3 }));
  assert.notEqual(countReasonIdentity('example', f), countReasonIdentity('another-store', f));
  partial.capture.lossNotice!.attention = false; partial.capture.lossNotice!.dismissedThrough = 2;
  assert.equal(countReasonIdentity('example', f), countReasonIdentity('example', countFacts(plans, inbox, runs(partial), { state: 'loading', rootId: 'example' })), 'acknowledgement does not resurrect the same device note');
});

test('dismissal survives reload; changed reasons and detections return, plus qualification is not stored', async () => {
  let value: LanguageStorageValue | undefined;
  const storage = { get: async () => value, set: async (_key: string, next: LanguageStorageValue) => { value = next; } };
  const device = new DeviceViewState(storage, () => {}); await device.refresh(true);
  const facts: CountFacts = { ...emptyCountFacts(), reasons: ['recording-gap'], detection: 1 };
  const key = countReasonIdentity('example', facts);
  assert(await device.dismiss('panel', key));
  const reloaded = new DeviceViewState(storage, () => {}); await reloaded.refresh(true);
  assert(reloaded.dismissed('panel', key)); assert(!reloaded.dismissed('page', key));
  assert(!reloaded.dismissed('panel', countReasonIdentity('example', { ...facts, detection: 2 })));
  assert(!reloaded.dismissed('panel', countReasonIdentity('example', { ...facts, reasons: ['recording-gap', 'host-not-checked'] })));
  assert.deepEqual(facts.reasons, ['recording-gap']);
});

test('support appends only fixed vocabulary and safe totals, preserving every earlier line', () => {
  const earlier = [
    'Agent progress reporting observations', 'service: unknown', 'scope: unknown', 'installation: unknown', 'loaded: unknown',
    'capture: unknown', 'report: not-checked', 'viewer: unknown', 'version: unknown', 'platform: unknown', 'tools: unknown',
    'Observed states only; no session tool availability or task completion proof.',
  ];
  const facts = { ...emptyCountFacts(), reasons: ['plans-not-loaded', 'private-sentinel'] as any, plans: 7, runs: -1 };
  const summary = supportSummary(unknownFacts(), facts);
  assert.deepEqual(summary.split('\n').slice(0, earlier.length), earlier);
  assert.match(summary, /count-reasons: plans-not-loaded\n/);
  assert.match(summary, /count-records: plans=7; runs=unknown; historical-sessions=0$/);
  assert.doesNotMatch(summary, /private-sentinel/);
});

test('unsupported hosts keep dismissal only in the frame and send no storage request', async () => {
  let calls = 0;
  const storage = { get: async () => { calls++; return undefined; }, set: async () => { calls++; } };
  const device = new DeviceViewState(storage, () => {}); await device.refresh(false);
  assert(await device.dismiss('panel', 'example-reasons')); assert(device.dismissed('panel', 'example-reasons'));
  const next = new DeviceViewState(storage, () => {}); await next.refresh(false);
  assert(!next.dismissed('panel', 'example-reasons')); assert.equal(calls, 0);
});
