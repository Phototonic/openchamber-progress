/** Frozen migration protocol; no filesystem authority or execution in this module.
 * See setup/managed-steps.md. Advertise only when the complete engine is available. */
import type { ManagedReview } from './progress.ts';

export const MANAGED_STEP_VERSION = 1;
export const MANAGED_STEP_ROUTE = '/v1/setup/managed-step';
export const MANAGED_STEP_LIMITS = {
  securitySpawns: 6,
  workMs: 17_000,
  responseMs: 18_000,
  hostMs: 20_000,
  runnerMs: 8_000,
  requestBytes: 16_384,
  responseBytes: 65_536,
  journalBytes: 1_048_576,
  cursorBytes: 4_096,
  pathBytes: 4_096,
  claimPaths: 256,
} as const;

export const MANAGED_INSPECTION_STEPS = [
  'roots', 'managed-state', 'legacy-discovery', 'legacy-releases', 'store', 'review',
] as const;
export type ManagedInspectionStep = typeof MANAGED_INSPECTION_STEPS[number];

/** A batch index is service-issued, zero-based and never a caller-selected path. */
export const MANAGED_MIGRATION_STEPS = [
  'prepare', 'expectation', 'disable', 'remove-selector', 'remove-discovery',
  'record-removal', 'publish-binding', 'enable', 'reconcile',
] as const;
export type ManagedMigrationStep = typeof MANAGED_MIGRATION_STEPS[number];
export interface ManagedStepRef { name: ManagedMigrationStep; batch: number }

export type ManagedOperationState = 'pending' | 'running' | 'paused' | 'failed' | 'complete' | 'abandoned';
/** An interrupted running intent is unsettled, not proof a worker still runs. */
export type ManagedWorkerState = 'idle' | 'active' | 'unsettled';
export type ManagedEffectState = 'none' | 'intent' | 'uncertain' | 'committed';
export type ManagedCaptureObservation =
  | { state: 'on' | 'off'; observedAt: string }
  | { state: 'unknown'; observedAt: null };

/** Fixed public diagnostics. Existing migration codes remain allowed separately. */
export const MANAGED_STEP_CODES = [
  'managed-step-deadline', 'managed-step-budget', 'managed-step-conflict',
  'managed-step-unsupported', 'managed-step-limit', 'managed-step-unsettled',
  'managed-journal-unsupported', 'managed-inspection-expired',
] as const;
export type ManagedStepCode = typeof MANAGED_STEP_CODES[number];
export interface ManagedStepDiagnostic {
  stage: ManagedMigrationStep | ManagedInspectionStep | 'journal' | 'lock';
  /** Must be in MANAGED_STEP_CODES or MANAGED_ACTION_CODES, never an exception message. */
  code: string;
}

export interface ManagedOperationRef { operationId: string; expectedSequence: number }
export type ManagedStepRequest =
  | { version: 1; action: 'inspect'; storeRoot?: string; cursor?: never }
  | { version: 1; action: 'inspect'; cursor: string; storeRoot?: never }
  | { version: 1; action: 'begin'; operationId: string; confirmed: true; expected: string }
  | ({ version: 1; action: 'advance'; step: ManagedStepRef } & ManagedOperationRef)
  | ({ version: 1; action: 'pause' | 'resume' | 'abandon' } & ManagedOperationRef)
  | { version: 1; action: 'status'; operationId?: string };

/** Shape validation only. HTTP owns raw-byte limits; the engine owns authority,
 * freshness, sequence and full-payload idempotency. Never coerce/drop fields. */
export function managedStepRequest(value: unknown): ManagedStepRequest | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const r = value as Record<string, unknown>;
  const keys = (allowed: string[]) => Object.keys(r).every(k => allowed.includes(k));
  const text = (v: unknown, max: number): v is string => typeof v === 'string' && v.length > 0 &&
    !v.includes('\0') && new TextEncoder().encode(v).length <= max;
  const uuid = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v);
  const integer = (v: unknown) => Number.isSafeInteger(v) && (v as number) >= 0;
  if (r.version !== 1) return;
  if (r.action === 'inspect') {
    if (!keys(['version', 'action', 'cursor', 'storeRoot'])) return;
    if (Object.hasOwn(r, 'cursor')) {
      if (Object.hasOwn(r, 'storeRoot') || !text(r.cursor, MANAGED_STEP_LIMITS.cursorBytes)) return;
    } else if (Object.hasOwn(r, 'storeRoot') && !text(r.storeRoot, MANAGED_STEP_LIMITS.pathBytes)) return;
  } else if (r.action === 'begin') {
    if (!keys(['version', 'action', 'operationId', 'confirmed', 'expected']) || !uuid(r.operationId) ||
      r.confirmed !== true || typeof r.expected !== 'string' || !/^[a-f0-9]{64}$/.test(r.expected)) return;
  } else if (r.action === 'status') {
    if (!keys(['version', 'action', 'operationId']) || Object.hasOwn(r, 'operationId') && !uuid(r.operationId)) return;
  } else if (['advance', 'pause', 'resume', 'abandon'].includes(r.action as string)) {
    if (!keys(['version', 'action', 'operationId', 'expectedSequence', ...(r.action === 'advance' ? ['step'] : [])]) ||
      !uuid(r.operationId) || !integer(r.expectedSequence)) return;
    if (r.action === 'advance') {
      const s = r.step;
      if (!s || typeof s !== 'object' || Array.isArray(s)) return;
      const step = s as Record<string, unknown>;
      if (!Object.keys(step).every(k => ['name', 'batch'].includes(k)) ||
        !MANAGED_MIGRATION_STEPS.includes(step.name as ManagedMigrationStep) || !integer(step.batch) ||
        !['remove-selector', 'remove-discovery'].includes(step.name as string) && step.batch !== 0) return;
    }
  } else return;
  return r as unknown as ManagedStepRequest;
}

export interface ManagedStepProgress {
  operationId: string;
  sequence: number;
  state: ManagedOperationState;
  worker: ManagedWorkerState;
  /** Current intent or next work. Null only at complete. */
  step: ManagedStepRef | null;
  lastCompleted: ManagedStepRef | null;
  effect: ManagedEffectState;
  capture: ManagedCaptureObservation;
  diagnostic: ManagedStepDiagnostic | null;
  /** Same-target explicit resume/reconciliation is required, never auto-continuation. */
  recovery: 'continue' | 'resume' | 'reconcile' | 'review' | 'none';
}
export type ManagedInspection =
  | { state: 'incomplete'; stage: ManagedInspectionStep; cursor: string; review?: never }
  | { state: 'complete'; stage: 'review'; cursor: null; review: ManagedReview }
  | { state: 'unavailable'; stage: ManagedInspectionStep; cursor: null; review?: never };

/** Counts are for THIS HTTP request, including replay/error/cleanup, not the original attempt. */
export interface ManagedStepAccounting { securitySpawns: number; elapsedMs: number }
export type ManagedStepResponse = {
  version: 1;
  /** Replayed refers to effect/sequence, not a stale capture observation. */
  disposition: 'applied' | 'replayed' | 'observed' | 'refused';
  inspection: ManagedInspection | null;
  progress: ManagedStepProgress | null;
  error: ManagedStepDiagnostic | null;
  accounting: ManagedStepAccounting;
};

/** Normative state graph, not an execution helper. Same-state journal checkpoints are allowed.
 * Only explicit resume returns stopped states to pending. Complete never runs enable again. */
export const MANAGED_OPERATION_TRANSITIONS = {
  pending: ['running', 'paused', 'abandoned', 'failed'],
  running: ['pending', 'failed', 'complete'],
  paused: ['pending', 'abandoned'],
  failed: ['pending', 'paused', 'abandoned'],
  abandoned: ['pending'],
  complete: [],
} as const satisfies Record<ManagedOperationState, readonly ManagedOperationState[]>;

/** Allocation ceilings, NOT measured costs. Retry consumes a spare slot or refuses.
 * Mutation slots include fresh checks for intent, effect and completion; scopes end
 * after each mutation. Cleanup never borrows from the next request's allowance. */
export const MANAGED_STEP_SPAWN_ALLOCATION = {
  prepare: { validation: 2, intent: 0, effect: 1, checkpoint: 2, cleanup: 1 },
  expectation: { validation: 1, intent: 1, effect: 1, checkpoint: 2, cleanup: 1 },
  disable: { validation: 1, intent: 1, effect: 1, checkpoint: 2, cleanup: 1 },
  'remove-selector': { validation: 1, intent: 1, effect: 1, checkpoint: 2, cleanup: 1 },
  'remove-discovery': { validation: 1, intent: 1, effect: 1, checkpoint: 2, cleanup: 1 },
  'record-removal': { validation: 1, intent: 1, effect: 1, checkpoint: 2, cleanup: 1 },
  'publish-binding': { validation: 1, intent: 1, effect: 1, checkpoint: 2, cleanup: 1 },
  enable: { validation: 1, intent: 1, effect: 1, checkpoint: 2, cleanup: 1 },
  reconcile: { validation: 2, intent: 1, effect: 0, checkpoint: 2, cleanup: 1 },
} as const satisfies Record<ManagedMigrationStep, Record<'validation' | 'intent' | 'effect' | 'checkpoint' | 'cleanup', number>>;
