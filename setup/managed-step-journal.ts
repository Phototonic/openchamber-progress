/** Private durable contract, NOT an HTTP DTO. No writer/parser is implemented here. */
import type { Binding } from '../shared/binding.ts';
import type { ManagedCaptureObservation, ManagedEffectState, ManagedOperationState, ManagedStepDiagnostic, ManagedStepRef } from '../shared/managed-steps.ts';

/** Claims only: fresh path/ACL/object/hash validation is mandatory before use. */
export interface ManagedPathClaim {
  path: string;
  kind: 'directory' | 'file' | 'absent';
  /** Native identity represented as strings, never lossy JS integer inode values. */
  object: { device: string; inode: string; birthNs: string } | null;
  /** SHA-256 of file bytes; null for directories/absence. No ACL verdict is persisted. */
  digest: string | null;
}

export interface ManagedStepReceipt {
  /** Digest of canonical full request, binding and consent; never a bearer token. */
  requestDigest: string;
  expectedSequence: number;
  sequence: number;
  step: ManagedStepRef | null;
  outcome: 'applied' | 'failed';
}

export interface ManagedStepIntent {
  requestDigest: string;
  expectedSequence: number;
  step: ManagedStepRef;
  effect: Exclude<ManagedEffectState, 'none'>;
  /** Exact pre/post claims for this one effect. Absent alone is never proof of removal. */
  before: ManagedPathClaim[];
  after: ManagedPathClaim[];
  captureBefore: ManagedCaptureObservation;
  /** Null for original consent; otherwise the one-use reviewed-resume sequence. */
  captureReviewSequence: number | null;
}

/** Retained even after renewed intent settles; a review never erases uncertain effects. */
export interface ManagedCaptureRenewal {
  reviewDigest: string;
  sequence: number;
  priorIntent: ManagedStepIntent;
}

/** Receipt evidence proves prior removal only; it never authorizes deleting remaining files. */
export type ManagedLegacyEvidence =
  | { kind: 'manifest'; ownership: string; ownershipDigest: string; claims: ManagedPathClaim[] }
  | { kind: 'removal-receipt'; ownership: null; ownershipDigest: null; claims: ManagedPathClaim[];
      receipt: { history: ManagedPathClaim; entry: string } };

/** Stored at the existing managed migration.json location. Keeping the Binding
 * envelope and raising migration.format makes the format-1 reader refuse, not
 * mistake unfinished steps for absence or a resumable old monolithic migration. */
export interface ManagedStepJournal extends Binding {
  migration: {
    format: 2;
    product: 'openchamber-agent-progress-managed';
    /** Conservative old coarse phase; never complete before reconciliation. */
    phase: 'pending' | 'removed' | 'complete';
    legacyInstallId: string;
    operationId: string;
    sequence: number;
    state: ManagedOperationState;
    step: ManagedStepRef | null;
    lastCompleted: ManagedStepRef | null;
    consent: { reviewDigest: string; targetDigest: string; planDigest: string };
    /** Reviewed package bytes; a restart/update cannot silently change them. */
    expectation: { version: string; fingerprint: string };
    /** Ordered frozen one-effect plan; bounded by the journal byte limit. */
    plan: ManagedStepRef[];
    /** Original bytes when available; otherwise explicit owner-validated removal evidence.
     * Parsing uses the existing lifecycle owner's validation, never trust-by-copy. */
    legacy: ManagedLegacyEvidence;
    /** Append-only, bounded by journalBytes; no renewed effect if evidence cannot fit. */
    captureRenewals: ManagedCaptureRenewal[];
    /** At most one current unresolved effect and one most recently settled request. */
    intent: ManagedStepIntent | null;
    receipt: ManagedStepReceipt | null;
    capture: ManagedCaptureObservation;
    diagnostic: ManagedStepDiagnostic | null;
  };
}
