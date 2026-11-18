import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { MANAGED_STEP_LIMITS, MANAGED_MIGRATION_STEPS, MANAGED_OPERATION_TRANSITIONS,
  managedStepRequest, type ManagedStepRequest } from '../../shared/managed-steps.ts';
import { managedStepFixtures, managedStepPlan } from '../fixtures/managed-steps.ts';
import type { SetupView } from '../../ui/shared/model.ts';
import type { ManagedDelivery } from '../../shared/progress.ts';
import { createFixtureBinding } from '../fixtures/managed.ts';
import { migrationFile, readMigration, writeMigration } from '../../setup/managed-migration.ts';
import { publishPrivateJson } from '../../shared/managed-binding.ts';
import { createHash } from 'node:crypto';
import type { ManagedLegacyEvidence } from '../../setup/managed-step-journal.ts';

test('frozen requests survive JSON transport without field dropping or coercion', () => {
  for (const request of Object.values(managedStepFixtures().requests)) {
    const wire: unknown = JSON.parse(JSON.stringify(request));
    assert.deepEqual(managedStepRequest(wire), request);
  }
  assert.ok(managedStepRequest({ version: 1, action: 'inspect', storeRoot: '/fixture/store' }));
});

test('contract rejects mixed inspection, unconfirmed begin and altered control shapes', () => {
  const { requests: r } = managedStepFixtures();
  for (const bad of [null, [], {}, { ...r.begin, version: 2 }, { ...r.begin, confirmed: false },
    { ...r.begin, operationId: 'not-an-operation' }, { ...r.begin, expected: 'not-a-review' },
    { ...r.inspectNext, storeRoot: '/fixture/other' }, { ...r.inspect, cursor: '' },
    { ...r.advance, storeRoot: '/fixture/other' }, { ...r.pause, step: r.advance.step },
    { ...r.status, expectedSequence: 0 }, { ...r.advance, action: 'managed-migrate' },
    { ...r.advance, step: { name: 'expectation', batch: 1 } },
    { ...r.advance, step: { name: 'remove-discovery', batch: 0, path: '/fixture/other' } },
    { ...r.advance, step: { name: 'delete-anything', batch: 0 } },
    { ...r.inspect, storeRoot: 'x\0y' },
  ]) assert.equal(managedStepRequest(bad), undefined, JSON.stringify(bad));
});

test('sequence, batch and UTF-8 bounds reject unsafe numbers and oversized claims', () => {
  const { requests: r } = managedStepFixtures();
  for (const number of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN, '1', null]) {
    assert.equal(managedStepRequest({ ...r.advance, expectedSequence: number }), undefined);
    assert.equal(managedStepRequest({ ...r.advance, step: { name: 'remove-discovery', batch: number } }), undefined);
  }
  const boundary = 'я'.repeat(MANAGED_STEP_LIMITS.cursorBytes / 2);
  assert.ok(managedStepRequest({ ...r.inspectNext, cursor: boundary }));
  assert.equal(managedStepRequest({ ...r.inspectNext, cursor: boundary + 'я' }), undefined);
  assert.equal(managedStepRequest({ ...r.inspect, storeRoot: 'x'.repeat(MANAGED_STEP_LIMITS.pathBytes + 1) }), undefined);
});

test('reviewed resume explicitly confirms only the interrupted capture decision', () => {
  const { requests: r } = managedStepFixtures();
  const review = { confirmed: true, expected: '6'.repeat(64), step: 'enable' };
  const request = { ...r.resume, review };
  assert.deepEqual(managedStepRequest(request), request);
  assert.ok(managedStepRequest({ ...request, review: { ...review, step: 'disable' } }));
  for (const bad of [null, {}, { ...review, confirmed: false }, { ...review, confirmed: undefined },
    { ...review, expected: 'not-a-review' }, { ...review, step: 'publish-binding' },
    { ...review, storeRoot: '/fixture/other' }, { ...review, step: undefined }]) {
    assert.equal(managedStepRequest({ ...request, review: bad }), undefined);
  }
  for (const control of [r.pause, r.abandon, r.advance, r.begin]) {
    assert.equal(managedStepRequest({ ...control, review }), undefined);
  }
});

test('the graph permits stopping a fenced running intent without settling its effect', () => {
  const transitions: readonly string[] = MANAGED_OPERATION_TRANSITIONS.running;
  assert.ok(transitions.includes('paused'));
  assert.ok(transitions.includes('abandoned'));
});

test('review journey retains the old intent and authorizes one new capture intent, not replay', () => {
  const { replies: r, journeys, interruptedEnable, reviewedJournal, renewedRunningJournal } = managedStepFixtures();
  for (const { request, reply } of journeys.captureReview) {
    assert.deepEqual(managedStepRequest(JSON.parse(JSON.stringify(request))), request);
    assert.equal(reply.progress?.operationId, interruptedEnable.migration.operationId);
  }
  for (const refusal of [r.unreviewedResumeRefused, r.staleReviewRefused]) {
    assert.equal(refusal.disposition, 'refused');
    assert.deepEqual(refusal.progress, r.enableUnsettled.progress);
  }
  assert.equal(r.enableUnsettled.progress?.recovery, 'review');
  assert.equal(r.captureResumed.progress?.sequence, r.enableUnsettled.progress!.sequence + 1);
  assert.equal(r.captureResumed.progress?.capture.state, 'off');
  assert.equal(r.captureResumed.progress?.effect, 'uncertain');
  assert.deepEqual(r.captureResumed.progress?.step, r.enableUnsettled.progress?.step);
  assert.deepEqual(r.captureResumeReplay.progress, r.captureResumed.progress);
  assert.deepEqual(reviewedJournal.migration.intent, interruptedEnable.migration.intent);
  assert.deepEqual(reviewedJournal.migration.consent, interruptedEnable.migration.consent);
  assert.deepEqual(reviewedJournal.migration.captureRenewals[0]?.priorIntent, interruptedEnable.migration.intent);
  assert.equal(renewedRunningJournal.migration.intent?.captureReviewSequence, reviewedJournal.migration.sequence);
  assert.deepEqual(renewedRunningJournal.migration.captureRenewals, reviewedJournal.migration.captureRenewals);
  assert.equal(r.renewedEnabled.progress?.sequence, r.captureResumed.progress!.sequence + 1);
  assert.equal(r.renewedReplayAfterDisable.progress?.sequence, r.renewedEnabled.progress?.sequence);
  assert.equal(r.renewedReplayAfterDisable.progress?.capture.state, 'off');
});

test('fenced stop examples retain unresolved work; an active-worker refusal changes nothing', () => {
  const { replies: r, journal, pausedJournal } = managedStepFixtures();
  assert.equal(r.activeControlRefused.disposition, 'refused');
  assert.deepEqual(r.activeControlRefused.progress, r.running.progress);
  for (const reply of [r.pausedRunning, r.abandonedRunning]) {
    assert.equal(reply.progress?.sequence, r.restarted.progress!.sequence + 1);
    assert.equal(reply.progress?.worker, 'unsettled');
    assert.equal(reply.progress?.effect, 'uncertain');
    assert.deepEqual(reply.progress?.step, r.restarted.progress?.step);
    assert.deepEqual(reply.progress?.lastCompleted, r.restarted.progress?.lastCompleted);
  }
  assert.deepEqual(pausedJournal.migration.intent, journal.migration.intent);
  assert.equal(r.resumedRunning.progress?.sequence, r.pausedRunning.progress!.sequence + 1);
  assert.equal(r.resumedRunning.progress?.effect, 'uncertain');
  assert.deepEqual(r.resumedRunning.progress?.step, r.pausedRunning.progress?.step);
});

test('receipt-proven removal honestly lacks a manifest and starts only the remaining plan', () => {
  const { journal, removedJournal, replies } = managedStepFixtures();
  const m = removedJournal.migration;
  assert.equal(m.legacy.kind, 'removal-receipt');
  if (m.legacy.kind !== 'removal-receipt') assert.fail('receipt evidence required');
  assert.equal(m.legacy.ownership, null);
  assert.equal(m.legacy.ownershipDigest, null);
  const entry = JSON.parse(m.legacy.receipt.entry);
  assert.equal(entry.action, 'remove-capture');
  assert.equal(entry.installId, m.legacyInstallId);
  assert.equal(m.phase, 'removed');
  assert.equal(m.sequence, 1);
  assert.equal(m.state, 'pending');
  assert.deepEqual(m.lastCompleted, { name: 'prepare', batch: 0 });
  assert.deepEqual(m.step, { name: 'expectation', batch: 0 });
  assert.deepEqual(m.plan.map(step => step.name), ['prepare', 'expectation', 'publish-binding', 'enable', 'reconcile']);
  assert.equal(m.intent, null);
  assert.deepEqual(m.captureRenewals, []);
  assert.equal(m.capture.state, 'unknown', 'a historical disable does not establish current capture');
  assert.deepEqual(replies.removedPrepared.progress?.capture, m.capture);
  assert.deepEqual(JSON.parse(JSON.stringify(removedJournal)), removedJournal);
  assert.equal(journal.migration.legacy.kind, 'manifest');
  const manifest = journal.migration.legacy.ownership!;
  assert.equal(JSON.parse(manifest).installId, journal.migration.legacyInstallId);
  assert.equal(journal.migration.legacy.ownershipDigest, createHash('sha256').update(manifest).digest('hex'));
});

test('request deadlines stay ordered below the host limit', () => {
  assert.ok(MANAGED_STEP_LIMITS.workMs < MANAGED_STEP_LIMITS.responseMs);
  assert.ok(MANAGED_STEP_LIMITS.responseMs < MANAGED_STEP_LIMITS.hostMs);
});

test('pause and abandonment cannot jump to complete or enable; completion is terminal', () => {
  assert.deepEqual(MANAGED_OPERATION_TRANSITIONS.complete, []);
  for (const state of ['paused', 'failed', 'abandoned'] as const) {
    assert.ok(MANAGED_OPERATION_TRANSITIONS[state].includes('pending'));
    assert.ok(![...MANAGED_OPERATION_TRANSITIONS[state] as readonly string[]].includes('complete'));
    assert.ok(![...MANAGED_OPERATION_TRANSITIONS[state] as readonly string[]].includes('running'));
  }
  assert.equal(managedStepPlan.at(-1)?.name, 'reconcile');
  assert.ok(managedStepPlan.findIndex(s => s.name === 'disable') < managedStepPlan.findIndex(s => s.name === 'remove-discovery'));
  assert.ok(managedStepPlan.findIndex(s => s.name === 'record-removal') < managedStepPlan.findIndex(s => s.name === 'publish-binding'));
  assert.ok(managedStepPlan.findIndex(s => s.name === 'publish-binding') < managedStepPlan.findIndex(s => s.name === 'enable'));
});

test('shared Setup examples distinguish pending capture, uncertainty and read-only replay', () => {
  const { replies, journal, compatibility } = managedStepFixtures();
  assert.equal(replies.incomplete.inspection?.state, 'incomplete');
  assert.equal('review' in replies.incomplete.inspection!, false);
  assert.equal(replies.prepared.progress?.capture.state, 'on');
  assert.equal(replies.pausedOff.progress?.capture.state, 'off');
  assert.equal(replies.restarted.progress?.capture.state, 'unknown');
  assert.equal(replies.restarted.progress?.worker, 'unsettled');
  assert.equal(replies.deadline.progress?.state, 'failed');
  assert.equal(replies.completedReplayAfterDisable.progress?.sequence, replies.complete.progress?.sequence);
  assert.equal(replies.completedReplayAfterDisable.progress?.capture.state, 'off');
  assert.equal(journal.migration.format, 2);
  assert.equal(journal.migration.phase, 'pending');
  assert.equal(journal.migration.intent?.before[0]?.object?.inode, '9007199254740993');
  assert.deepEqual(JSON.parse(JSON.stringify(journal)), journal);
  assert.deepEqual(compatibility, { status: 409, body: { error: 'managed-action-required' }, securitySpawns: 0, migrationWrites: 0 });
  const delivery: ManagedDelivery = { kind: 'managed', revision: 1, configuration: 'unconfigured',
    migration: 'pending', mode: 'unknown', observation: 'unknown', expectedVersion: null,
    managedMigrationSteps: 1, migrationProgress: replies.pausedOff.progress! };
  const view: NonNullable<SetupView['delivery']> = delivery;
  assert.equal(view.migrationProgress?.capture.state, 'off');
  assert.notEqual({ ...delivery, managedMigrationSteps: undefined }.managedMigrationSteps, 1);
});

test('format-1 migration reader refuses a new journal instead of treating it as absent', () => {
  const root = mkdtempSync('/tmp/opencode/managed-step-journal-');
  try {
    const { env, binding } = createFixtureBinding(root);
    writeMigration(env, { binding, phase: 'pending', legacyInstallId: 'legacy-example' });
    assert.equal(readMigration(env)?.phase, 'pending', 'control: the old envelope is readable');
    const journal = { ...managedStepFixtures().journal, ...binding };
    publishPrivateJson(migrationFile(env), journal, true);
    assert.throws(() => readMigration(env), { code: 'managed-migration-conflict' });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// Compile-time contracts are also consumed by the root/UI typechecks.
// @ts-expect-error Inspection continuation cannot retarget the source.
const retarget: ManagedStepRequest = { version: 1, action: 'inspect', cursor: 'page', storeRoot: '/fixture/other' };
// @ts-expect-error Begin always requires explicit confirmation.
const unconfirmed: ManagedStepRequest = { version: 1, action: 'begin', operationId: 'example', expected: 'review' };
// @ts-expect-error Reviewed resume must explicitly confirm the capture decision.
const unconfirmedResume: ManagedStepRequest = { version: 1, action: 'resume', operationId: 'example', expectedSequence: 1, review: { expected: 'review', step: 'enable' } };
// @ts-expect-error Unavailable manifest bytes require the removal-receipt branch and its evidence.
const missingManifest: ManagedLegacyEvidence = { kind: 'manifest', ownership: null, ownershipDigest: null, claims: [] };
// @ts-expect-error Receipt recovery must not invent original manifest bytes.
const inventedManifest: ManagedLegacyEvidence = { kind: 'removal-receipt', ownership: '{}', ownershipDigest: 'digest', claims: [] };
void retarget; void unconfirmed; void unconfirmedResume; void missingManifest; void inventedManifest;
