/** Shared backend/Setup-client contract examples. No filesystem access, no timings
 * measured, no bearer tokens. Consumers clone before adding fault conditions. */
import type { ManagedStepProgress, ManagedStepRequest, ManagedStepResponse, ManagedStepRef } from '../../shared/managed-steps.ts';
import type { ManagedStepJournal } from '../../setup/managed-step-journal.ts';
import type { ManagedReview } from '../../shared/progress.ts';
import { createHash } from 'node:crypto';

export const managedOperationId = '11111111-1111-4111-8111-111111111111';
export const managedReview: ManagedReview = {
  expected: 'a'.repeat(64),
  targets: { configRoot: '/fixture/config', dataRoot: '/fixture/data', storeRoot: '/fixture/store' },
  storeId: 'store-example', sourceId: 'source-example',
};
export const managedStepPlan: ManagedStepRef[] = [
  { name: 'prepare', batch: 0 }, { name: 'expectation', batch: 0 }, { name: 'disable', batch: 0 },
  ...Array.from({ length: 6 }, (_, batch) => ({ name: 'remove-discovery' as const, batch })),
  { name: 'record-removal', batch: 0 }, { name: 'publish-binding', batch: 0 },
  { name: 'enable', batch: 0 }, { name: 'reconcile', batch: 0 },
];
const captureOn = { state: 'on', observedAt: '2026-01-01T00:00:00.000Z' } as const;
const captureOff = { state: 'off', observedAt: '2026-01-01T00:00:01.000Z' } as const;
const captureUnknown = { state: 'unknown', observedAt: null } as const;
const sha256 = (bytes: string) => createHash('sha256').update(bytes).digest('hex');
// Complete synthetic manifest bytes, not a claim that any real files were validated.
const release = '8'.repeat(64);
const fileHashes = (names: string[]) => Object.fromEntries(names.map(name => [name, sha256(`fixture ${name}`)]));
const ownership = JSON.stringify({ product: 'openchamber-agent-progress', installId: 'legacy-example', active: release,
  files: fileHashes(['SKILL.md', 'index.js', 'package.json', 'progress-binding.json', 'remove.js']),
  releases: { [release]: { version: '1.1.1', files: fileHashes(['SKILL.md', 'index.js', 'progress-binding.json']) } } });

function progress(overrides: Partial<ManagedStepProgress> = {}): ManagedStepProgress {
  return { operationId: managedOperationId, sequence: 1, state: 'pending', worker: 'idle',
    step: { name: 'expectation', batch: 0 }, lastCompleted: { name: 'prepare', batch: 0 },
    effect: 'none', capture: captureOn, diagnostic: null, recovery: 'continue', ...overrides };
}
function response(value: ManagedStepProgress | null, overrides: Partial<ManagedStepResponse> = {}): ManagedStepResponse {
  return { version: 1, disposition: 'observed', inspection: null, progress: value, error: null,
    accounting: { securitySpawns: 0, elapsedMs: 0 }, ...overrides };
}

/** Each call returns isolated plain JSON data suitable for either consumer's harness. */
export function managedStepFixtures() {
  const removal = { name: 'remove-discovery', batch: 0 } as const;
  const disabled = progress({ sequence: 3, step: removal, lastCompleted: { name: 'disable', batch: 0 }, capture: captureOff });
  const deadline = { stage: 'remove-discovery', code: 'managed-step-deadline' } as const;
  const complete = progress({ sequence: 13, state: 'complete', step: null,
    lastCompleted: { name: 'reconcile', batch: 0 }, effect: 'committed', capture: captureOn, recovery: 'none' });
  const unsettled = { stage: 'enable', code: 'managed-step-unsettled' } as const;
  const enableUnsettled = progress({ sequence: 11, state: 'running', worker: 'unsettled',
    step: { name: 'enable', batch: 0 }, lastCompleted: { name: 'publish-binding', batch: 0 },
    effect: 'uncertain', capture: captureOff, diagnostic: unsettled, recovery: 'review' });
  const captureReview = { ...managedReview, expected: '6'.repeat(64) };
  const captureResumed = { ...enableUnsettled, sequence: 12, state: 'pending' as const, diagnostic: null, recovery: 'continue' as const };
  const renewedEnabled = progress({ sequence: 13, step: { name: 'reconcile', batch: 0 },
    lastCompleted: { name: 'enable', batch: 0 }, effect: 'committed', capture: captureOn });
  const stoppedRunning = { ...disabled, sequence: 4, worker: 'unsettled' as const, effect: 'uncertain' as const,
    capture: captureUnknown, recovery: 'resume' as const };
  const replies = {
    incomplete: response(null, { inspection: { state: 'incomplete', stage: 'legacy-releases', cursor: 'inspection-example-page-2' } }),
    reviewed: response(null, { inspection: { state: 'complete', stage: 'review', cursor: null, review: managedReview } }),
    prepared: response(progress(), { disposition: 'applied' }),
    removedPrepared: response(progress({ capture: captureUnknown }), { disposition: 'applied' }),
    disabled: response(disabled, { disposition: 'applied' }),
    pausedBeforeDisable: response(progress({ sequence: 2, state: 'paused', recovery: 'resume' }), { disposition: 'applied' }),
    pausedOff: response({ ...disabled, sequence: 4, state: 'paused', recovery: 'resume' }, { disposition: 'applied' }),
    abandonedOff: response({ ...disabled, sequence: 4, state: 'abandoned', recovery: 'resume' }, { disposition: 'applied' }),
    running: response({ ...disabled, state: 'running', worker: 'active', effect: 'intent', recovery: 'none' }),
    restarted: response({ ...disabled, state: 'running', worker: 'unsettled', effect: 'uncertain', capture: captureUnknown, recovery: 'reconcile' }),
    activeControlRefused: response({ ...disabled, state: 'running', worker: 'active', effect: 'intent', recovery: 'none' },
      { disposition: 'refused', error: { stage: 'lock', code: 'managed-step-unsettled' } }),
    pausedRunning: response({ ...stoppedRunning, state: 'paused' }, { disposition: 'applied' }),
    abandonedRunning: response({ ...stoppedRunning, state: 'abandoned' }, { disposition: 'applied' }),
    resumedRunning: response({ ...stoppedRunning, sequence: 5, state: 'pending', recovery: 'continue' }, { disposition: 'applied' }),
    enableUnsettled: response(enableUnsettled),
    unreviewedResumeRefused: response(enableUnsettled, { disposition: 'refused', error: unsettled }),
    staleReviewRefused: response(enableUnsettled, { disposition: 'refused', error: { stage: 'enable', code: 'managed-review-stale' } }),
    captureReviewed: response(enableUnsettled, { inspection: { state: 'complete', stage: 'review', cursor: null, review: captureReview } }),
    captureResumed: response(captureResumed, { disposition: 'applied' }),
    captureResumeReplay: response(captureResumed, { disposition: 'replayed' }),
    renewedEnabled: response(renewedEnabled, { disposition: 'applied' }),
    renewedReplayAfterDisable: response({ ...renewedEnabled, capture: captureOff }, { disposition: 'replayed' }),
    deadline: response({ ...disabled, sequence: 4, state: 'failed', worker: 'unsettled', effect: 'uncertain', capture: captureUnknown,
      diagnostic: deadline, recovery: 'reconcile' }, { disposition: 'refused', error: deadline }),
    complete: response(complete, { disposition: 'applied' }),
    completedReplayAfterDisable: response({ ...complete, capture: captureOff }, { disposition: 'replayed' }),
    unsupportedJournal: response(null, { disposition: 'refused', error: { stage: 'journal', code: 'managed-journal-unsupported' } }),
  } satisfies Record<string, ManagedStepResponse>;
  const requests = {
    inspect: { version: 1, action: 'inspect' },
    inspectNext: { version: 1, action: 'inspect', cursor: 'inspection-example-page-2' },
    begin: { version: 1, action: 'begin', operationId: managedOperationId, confirmed: true, expected: managedReview.expected },
    advance: { version: 1, action: 'advance', operationId: managedOperationId, expectedSequence: 1, step: { name: 'expectation', batch: 0 } },
    pause: { version: 1, action: 'pause', operationId: managedOperationId, expectedSequence: 3 },
    resume: { version: 1, action: 'resume', operationId: managedOperationId, expectedSequence: 4 },
    reviewedResume: { version: 1, action: 'resume', operationId: managedOperationId, expectedSequence: 11,
      review: { confirmed: true, expected: captureReview.expected, step: 'enable' } },
    unreviewedResume: { version: 1, action: 'resume', operationId: managedOperationId, expectedSequence: 11 },
    staleReviewedResume: { version: 1, action: 'resume', operationId: managedOperationId, expectedSequence: 11,
      review: { confirmed: true, expected: managedReview.expected, step: 'enable' } },
    renewedAdvance: { version: 1, action: 'advance', operationId: managedOperationId, expectedSequence: 12, step: { name: 'enable', batch: 0 } },
    abandon: { version: 1, action: 'abandon', operationId: managedOperationId, expectedSequence: 3 },
    status: { version: 1, action: 'status' },
  } satisfies Record<string, ManagedStepRequest>;
  const journal: ManagedStepJournal = {
    protocolVersion: 2, schemaVersion: 2, installId: 'managed-example', version: '1.4.0',
    database: '/fixture/store/progress.sqlite', storeId: 'store-example',
    source: { id: 'source-example', configRoot: '/fixture/config', dataRoot: '/fixture/data', verified: true },
    migration: {
      format: 2, product: 'openchamber-agent-progress-managed', phase: 'pending', legacyInstallId: 'legacy-example',
      operationId: managedOperationId, sequence: 3, state: 'running', step: removal,
      lastCompleted: { name: 'disable', batch: 0 },
      consent: { reviewDigest: managedReview.expected, targetDigest: 'b'.repeat(64), planDigest: 'c'.repeat(64) },
      expectation: { version: '1.4.0', fingerprint: '9'.repeat(64) },
      plan: managedStepPlan,
      legacy: { kind: 'manifest', ownership, ownershipDigest: sha256(ownership), claims: [] },
      captureRenewals: [],
      intent: { requestDigest: 'e'.repeat(64), expectedSequence: 3, step: removal, effect: 'intent',
        before: [{ path: '/fixture/config/plugins/agent-progress/index.js', kind: 'file',
          object: { device: '1', inode: '9007199254740993', birthNs: '1' }, digest: 'f'.repeat(64) }],
        after: [{ path: '/fixture/config/plugins/agent-progress/index.js', kind: 'absent', object: null, digest: null }],
        captureBefore: captureOff, captureReviewSequence: null },
      receipt: { requestDigest: '0'.repeat(64), expectedSequence: 2, sequence: 3, step: { name: 'disable', batch: 0 }, outcome: 'applied' },
      capture: captureOff, diagnostic: null,
    },
  };
  const interruptedEnable: ManagedStepJournal = structuredClone(journal);
  interruptedEnable.migration = { ...interruptedEnable.migration, sequence: 11, phase: 'removed', step: enableUnsettled.step,
    lastCompleted: enableUnsettled.lastCompleted, capture: captureOff, diagnostic: unsettled, receipt: null,
    intent: { requestDigest: '5'.repeat(64), expectedSequence: 11, step: { name: 'enable', batch: 0 },
      effect: 'uncertain', before: [], after: [], captureBefore: captureOff, captureReviewSequence: null } };
  const reviewedJournal: ManagedStepJournal = structuredClone(interruptedEnable);
  reviewedJournal.migration = { ...reviewedJournal.migration, sequence: 12, state: 'pending', diagnostic: null,
    captureRenewals: [{ reviewDigest: captureReview.expected, sequence: 12, priorIntent: interruptedEnable.migration.intent! }],
    receipt: { requestDigest: '4'.repeat(64), expectedSequence: 11, sequence: 12, step: enableUnsettled.step, outcome: 'applied' } };
  const renewedRunningJournal: ManagedStepJournal = structuredClone(reviewedJournal);
  renewedRunningJournal.migration = { ...renewedRunningJournal.migration, state: 'running',
    intent: { ...interruptedEnable.migration.intent!, requestDigest: '7'.repeat(64), expectedSequence: 12,
      effect: 'intent', captureReviewSequence: 12 } };
  const pausedJournal: ManagedStepJournal = structuredClone(journal);
  pausedJournal.migration = { ...pausedJournal.migration, sequence: 4, state: 'paused', capture: captureUnknown,
    receipt: { requestDigest: '3'.repeat(64), expectedSequence: 3, sequence: 4, step: removal, outcome: 'applied' } };
  const entry = JSON.stringify({ action: 'remove-capture', at: '2026-01-01T00:00:00.000Z', installId: 'legacy-example' });
  const removedJournal: ManagedStepJournal = structuredClone(journal);
  removedJournal.migration = { ...removedJournal.migration, phase: 'removed', sequence: 1, state: 'pending',
    step: { name: 'expectation', batch: 0 }, lastCompleted: { name: 'prepare', batch: 0 }, intent: null, capture: captureUnknown,
    plan: (['prepare', 'expectation', 'publish-binding', 'enable', 'reconcile'] as const).map(name => ({ name, batch: 0 })),
    legacy: { kind: 'removal-receipt', ownership: null, ownershipDigest: null,
      claims: [{ path: '/fixture/config/plugins/agent-progress', kind: 'absent', object: null, digest: null }],
      receipt: { entry, history: { path: '/fixture/store/installation-history.jsonl', kind: 'file',
        object: { device: '1', inode: '9007199254740994', birthNs: '1' }, digest: sha256(entry + '\n') } } },
    receipt: { requestDigest: '2'.repeat(64), expectedSequence: 0, sequence: 1, step: { name: 'prepare', batch: 0 }, outcome: 'applied' } };
  return structuredClone({ requests, replies, journal, interruptedEnable, reviewedJournal, renewedRunningJournal, pausedJournal, removedJournal,
    journeys: {
      captureReview: [
        { request: requests.status, reply: replies.enableUnsettled },
        { request: requests.unreviewedResume, reply: replies.unreviewedResumeRefused },
        { request: requests.staleReviewedResume, reply: replies.staleReviewRefused },
        { request: requests.inspect, reply: replies.captureReviewed },
        { request: requests.reviewedResume, reply: replies.captureResumed },
        { request: requests.reviewedResume, reply: replies.captureResumeReplay },
        { request: requests.renewedAdvance, reply: replies.renewedEnabled },
        // An independent user disable occurred before this lost-reply retry.
        { request: requests.renewedAdvance, reply: replies.renewedReplayAfterDisable },
      ],
    },
    compatibility: { status: 409, body: { error: 'managed-action-required' }, securitySpawns: 0, migrationWrites: 0 },
  });
}
