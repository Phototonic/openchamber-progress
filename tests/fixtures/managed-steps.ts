/** Shared backend/Setup-client contract examples. No filesystem access, no timings
 * measured, no bearer tokens. Consumers clone before adding fault conditions. */
import type { ManagedStepProgress, ManagedStepRequest, ManagedStepResponse, ManagedStepRef } from '../../shared/managed-steps.ts';
import type { ManagedStepJournal } from '../../setup/managed-step-journal.ts';
import type { ManagedReview } from '../../shared/progress.ts';

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
  const replies = {
    incomplete: response(null, { inspection: { state: 'incomplete', stage: 'legacy-releases', cursor: 'inspection-example-page-2' } }),
    reviewed: response(null, { inspection: { state: 'complete', stage: 'review', cursor: null, review: managedReview } }),
    prepared: response(progress(), { disposition: 'applied' }),
    disabled: response(disabled, { disposition: 'applied' }),
    pausedBeforeDisable: response(progress({ sequence: 2, state: 'paused', recovery: 'resume' }), { disposition: 'applied' }),
    pausedOff: response({ ...disabled, sequence: 4, state: 'paused', recovery: 'resume' }, { disposition: 'applied' }),
    abandonedOff: response({ ...disabled, sequence: 4, state: 'abandoned', recovery: 'resume' }, { disposition: 'applied' }),
    running: response({ ...disabled, state: 'running', worker: 'active', effect: 'intent', recovery: 'none' }),
    restarted: response({ ...disabled, state: 'running', worker: 'unsettled', effect: 'uncertain', capture: captureUnknown, recovery: 'reconcile' }),
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
      // Opaque bytes here intentionally are NOT a validated legacy manifest.
      // Engine integration replaces them with its real released-fixture manifest.
      legacy: { ownership: '{}', ownershipDigest: 'd'.repeat(64), claims: [] },
      intent: { requestDigest: 'e'.repeat(64), expectedSequence: 3, step: removal, effect: 'intent',
        before: [{ path: '/fixture/config/plugins/agent-progress/index.js', kind: 'file',
          object: { device: '1', inode: '9007199254740993', birthNs: '1' }, digest: 'f'.repeat(64) }],
        after: [{ path: '/fixture/config/plugins/agent-progress/index.js', kind: 'absent', object: null, digest: null }],
        captureBefore: captureOff },
      receipt: { requestDigest: '0'.repeat(64), expectedSequence: 2, sequence: 3, step: { name: 'disable', batch: 0 }, outcome: 'applied' },
      capture: captureOff, diagnostic: null,
    },
  };
  return structuredClone({ requests, replies, journal,
    compatibility: { status: 409, body: { error: 'managed-action-required' }, securitySpawns: 0, migrationWrites: 0 },
  });
}
