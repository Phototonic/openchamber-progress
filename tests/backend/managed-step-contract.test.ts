import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { MANAGED_STEP_LIMITS, MANAGED_MIGRATION_STEPS, MANAGED_OPERATION_TRANSITIONS,
  MANAGED_STEP_SPAWN_ALLOCATION, managedStepRequest, type ManagedStepRequest } from '../../shared/managed-steps.ts';
import { managedStepFixtures, managedStepPlan } from '../fixtures/managed-steps.ts';
import type { SetupView } from '../../ui/shared/model.ts';
import type { ManagedDelivery } from '../../shared/progress.ts';
import { createFixtureBinding } from '../fixtures/managed.ts';
import { migrationFile, readMigration, writeMigration } from '../../setup/managed-migration.ts';
import { publishPrivateJson } from '../../shared/managed-binding.ts';

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

test('all effect allocations reserve checkpoints/cleanup within the real-spawn ceiling', () => {
  assert.deepEqual(Object.keys(MANAGED_STEP_SPAWN_ALLOCATION), [...MANAGED_MIGRATION_STEPS]);
  for (const allocation of Object.values(MANAGED_STEP_SPAWN_ALLOCATION)) {
    assert.ok(Object.values(allocation).reduce<number>((sum, n) => sum + n, 0) <= MANAGED_STEP_LIMITS.securitySpawns);
    assert.ok(allocation.checkpoint > 0 && allocation.cleanup > 0);
  }
  assert.ok(MANAGED_STEP_LIMITS.securitySpawns * 2_500 < MANAGED_STEP_LIMITS.workMs);
  assert.ok(MANAGED_STEP_LIMITS.workMs < MANAGED_STEP_LIMITS.responseMs);
  assert.ok(MANAGED_STEP_LIMITS.responseMs < MANAGED_STEP_LIMITS.hostMs);
  // This checks allocation arithmetic only, not actual engine/native spawn counts.
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
void retarget; void unconfirmed;
