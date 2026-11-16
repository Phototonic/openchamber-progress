/** Frozen migration protocol; no filesystem authority or execution in this module.
 * See setup/managed-steps.md. Advertise only when the complete engine is available. */
import type { ManagedReview, ManagedFreshReview } from './progress.ts';

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

/** Fresh is a separately negotiated family. Never widen the version-1 vocabulary. */
export const MANAGED_FRESH_STEP_VERSION = 2;
export const MANAGED_FRESH_INSPECTION_STEPS = ['roots', 'managed-state', 'legacy-discovery', 'store', 'review'] as const;
export const MANAGED_FRESH_STEPS = ['prepare', 'store-directory', 'create-store', 'expectation',
  'register-source', 'publish-binding', 'enable', 'reconcile'] as const;
export type ManagedFreshStep = typeof MANAGED_FRESH_STEPS[number];
export interface ManagedFreshStepRef { name: ManagedFreshStep; batch: 0 }
export type ManagedSetupStepRef = ManagedStepRef | ManagedFreshStepRef;
export type ManagedFreshStoreMode = 'create' | 'retain';
export type ManagedFreshSourceMode = 'create' | 'reuse';
export type ManagedFreshCapturePolicy = 'enable-new' | 'preserve';
/** Specific grammars only, not an extensible plan registry. */
export function managedFreshPlan(storeMode: ManagedFreshStoreMode, directoryMissing: boolean,
  sourceMode: ManagedFreshSourceMode): ManagedFreshStepRef[] {
  if (storeMode === 'retain' && directoryMissing || storeMode === 'create' && sourceMode !== 'create')
    throw new Error('managed-step-conflict');
  const names: ManagedFreshStep[] = ['prepare'];
  if (storeMode === 'create') { if (directoryMissing) names.push('store-directory'); names.push('create-store'); }
  names.push('expectation');
  if (sourceMode === 'create') names.push('register-source');
  names.push('publish-binding');
  if (storeMode === 'create') names.push('enable');
  names.push('reconcile');
  return names.map(name => ({ name, batch: 0 }));
}

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
  'managed-step-port-busy',
] as const;
export type ManagedStepCode = typeof MANAGED_STEP_CODES[number];
export interface ManagedStepDiagnostic {
  stage: ManagedMigrationStep | ManagedInspectionStep | 'journal' | 'lock';
  /** Must be in MANAGED_STEP_CODES or MANAGED_ACTION_CODES, never an exception message. */
  code: string;
}
export interface ManagedFreshStepDiagnostic extends Omit<ManagedStepDiagnostic, 'stage'> {
  stage: ManagedFreshStep | ManagedInspectionStep | 'journal' | 'lock';
}

export interface ManagedOperationRef { operationId: string; expectedSequence: number }
/** Fresh consent for this interrupted capture decision only, not a new target/plan. */
export interface ManagedCaptureReview { confirmed: true; expected: string; step: 'enable' | 'disable' }
export type ManagedStepRequest =
  | { version: 1; action: 'inspect'; storeRoot?: string; cursor?: never }
  | { version: 1; action: 'inspect'; cursor: string; storeRoot?: never }
  | { version: 1; action: 'begin'; operationId: string; confirmed: true; expected: string }
  | ({ version: 1; action: 'advance'; step: ManagedStepRef } & ManagedOperationRef)
  | ({ version: 1; action: 'pause' | 'abandon' } & ManagedOperationRef)
  | ({ version: 1; action: 'resume'; review?: ManagedCaptureReview } & ManagedOperationRef)
  | { version: 1; action: 'status'; operationId?: string };

export type ManagedFreshStepRequest =
  | { version: 2; action: 'inspect'; storeRoot?: string; cursor?: never }
  | { version: 2; action: 'inspect'; cursor: string; storeRoot?: never }
  | { version: 2; action: 'begin'; operationId: string; confirmed: true; expected: string }
  | ({ version: 2; action: 'advance'; step: ManagedFreshStepRef } & ManagedOperationRef)
  | ({ version: 2; action: 'pause' | 'abandon' } & ManagedOperationRef)
  | ({ version: 2; action: 'resume'; review?: ManagedCaptureReview & { step: 'enable' } } & ManagedOperationRef)
  | { version: 2; action: 'status'; operationId?: string };
export type ManagedSetupStepRequest = ManagedStepRequest | ManagedFreshStepRequest;

/** Shape validation only. HTTP owns raw-byte limits; the engine owns authority,
 * freshness, sequence and full-payload idempotency. Never coerce/drop fields. */
export function managedStepRequest(value: unknown): ManagedStepRequest | undefined {
  return parseStepRequest(value, 1) as ManagedStepRequest | undefined;
}
export function managedFreshStepRequest(value: unknown): ManagedFreshStepRequest | undefined {
  return parseStepRequest(value, 2) as ManagedFreshStepRequest | undefined;
}
export function managedSetupStepRequest(value: unknown): ManagedSetupStepRequest | undefined {
  return managedStepRequest(value) ?? managedFreshStepRequest(value);
}
function parseStepRequest(value: unknown, version: 1 | 2): ManagedSetupStepRequest | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const r = value as Record<string, unknown>;
  const keys = (allowed: string[]) => Object.keys(r).every(k => allowed.includes(k));
  const text = (v: unknown, max: number): v is string => typeof v === 'string' && v.length > 0 &&
    !v.includes('\0') && new TextEncoder().encode(v).length <= max;
  const uuid = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v);
  const digest = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
  const integer = (v: unknown) => Number.isSafeInteger(v) && (v as number) >= 0;
  if (r.version !== version) return;
  if (r.action === 'inspect') {
    if (!keys(['version', 'action', 'cursor', 'storeRoot'])) return;
    if (Object.hasOwn(r, 'cursor')) {
      if (Object.hasOwn(r, 'storeRoot') || !text(r.cursor, MANAGED_STEP_LIMITS.cursorBytes)) return;
    } else if (Object.hasOwn(r, 'storeRoot') && !text(r.storeRoot, MANAGED_STEP_LIMITS.pathBytes)) return;
  } else if (r.action === 'begin') {
    if (!keys(['version', 'action', 'operationId', 'confirmed', 'expected']) || !uuid(r.operationId) ||
      r.confirmed !== true || !digest(r.expected)) return;
  } else if (r.action === 'status') {
    if (!keys(['version', 'action', 'operationId']) || Object.hasOwn(r, 'operationId') && !uuid(r.operationId)) return;
  } else if (['advance', 'pause', 'resume', 'abandon'].includes(r.action as string)) {
    if (!keys(['version', 'action', 'operationId', 'expectedSequence', ...(r.action === 'advance' ? ['step'] : r.action === 'resume' ? ['review'] : [])]) ||
      !uuid(r.operationId) || !integer(r.expectedSequence)) return;
    if (r.action === 'resume' && Object.hasOwn(r, 'review')) {
      const review = r.review;
      if (!review || typeof review !== 'object' || Array.isArray(review)) return;
      const c = review as Record<string, unknown>;
      if (!Object.keys(c).every(k => ['confirmed', 'expected', 'step'].includes(k)) ||
        c.confirmed !== true || !digest(c.expected) || !(version === 1 ? ['enable', 'disable'] : ['enable']).includes(c.step as string)) return;
    }
    if (r.action === 'advance') {
      const s = r.step;
      if (!s || typeof s !== 'object' || Array.isArray(s)) return;
      const step = s as Record<string, unknown>;
      if (!Object.keys(step).every(k => ['name', 'batch'].includes(k)) ||
        !(version === 1 ? MANAGED_MIGRATION_STEPS : MANAGED_FRESH_STEPS).includes(step.name as never) || !integer(step.batch) ||
        !['remove-selector', 'remove-discovery'].includes(step.name as string) && step.batch !== 0) return;
    }
  } else return;
  return r as unknown as ManagedSetupStepRequest;
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

export interface ManagedFreshStepProgress extends Omit<ManagedStepProgress, 'step' | 'lastCompleted' | 'diagnostic'> {
  planKind: 'fresh';
  plan: ManagedFreshStepRef[];
  storeMode: ManagedFreshStoreMode;
  sourceMode: ManagedFreshSourceMode;
  capturePolicy: ManagedFreshCapturePolicy;
  step: ManagedFreshStepRef | null;
  lastCompleted: ManagedFreshStepRef | null;
  diagnostic: ManagedFreshStepDiagnostic | null;
}
export type ManagedFreshInspection =
  | { state: 'incomplete'; stage: typeof MANAGED_FRESH_INSPECTION_STEPS[number]; cursor: string; review?: never }
  | { state: 'complete'; stage: 'review'; cursor: null; review: ManagedFreshReview }
  | { state: 'unavailable'; stage: typeof MANAGED_FRESH_INSPECTION_STEPS[number]; cursor: null; review?: never };
export interface ManagedFreshStepResponse extends Omit<ManagedStepResponse, 'version' | 'inspection' | 'progress' | 'error'> {
  version: 2;
  inspection: ManagedFreshInspection | null;
  progress: ManagedFreshStepProgress | null;
  error: ManagedFreshStepDiagnostic | null;
}
export type ManagedSetupStepResponse = ManagedStepResponse | ManagedFreshStepResponse;
export type ManagedSetupStepProgress = ManagedStepProgress | ManagedFreshStepProgress;

/** Normative state graph, not an execution helper. Same-state journal checkpoints are allowed.
 * Running -> paused/abandoned requires a positively fenced worker; retain unresolved intent.
 * An active/unfenceable worker refuses controls without a transition or sequence increment.
 * Only explicit resume returns stopped states to pending. Complete never runs enable again. */
export const MANAGED_OPERATION_TRANSITIONS = {
  pending: ['running', 'paused', 'abandoned', 'failed'],
  running: ['pending', 'paused', 'abandoned', 'failed', 'complete'],
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
