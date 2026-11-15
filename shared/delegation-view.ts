import { BLOCKER_LIMITS, SEARCH_LIMITS, type Envelope } from './progress.ts';
import type { AttentionPlanIdentity } from './needs-you.ts';

/** Read admission only, not new storage limits or a replacement for transaction-local proof. */
export const DELEGATION_VIEW_LIMITS = Object.freeze({
  receipts: 128, tasks: 50, identifierCodeUnits: 200, reasonCodeUnits: BLOCKER_LIMITS.textCodeUnits,
  inputBytes: SEARCH_LIMITS.inputBytes, responseBytes: SEARCH_LIMITS.responseBytes,
  tokenBytes: SEARCH_LIMITS.cursorBytes,
});
export function supportsDelegationIntent(value: unknown): value is 1 { return value === 1; }
export interface DelegationViewRequest {
  storeId: string; binding: Envelope['sourceBinding']; source: string; plan: string;
  revision: number; cleanupRev: number; token: string;
}
export interface DelegationDeclaration {
  oid: string; coordinatorSessionId: string; declaredRevision: number; taskIds: string[];
  /** Verified dispatch identity when reserved/bound, not child authority by itself. */
  dispatch: { tool: 'subagent' | 'task'; messageId: string; callId: string } | null;
}
export type DelegationDisposition =
  | { state: 'none' }
  | { state: 'pending' | 'reserved'; eligible: true; declaration: DelegationDeclaration }
  | { state: 'bound'; declaration: DelegationDeclaration; childSessionId: string; boundRevision: number }
  | { state: 'cancelled' | 'invalidated'; declaration: DelegationDeclaration; reason: string }
  | { state: 'refused'; declaration: DelegationDeclaration; reason: string; recovery: 'redeclare-or-link' };
export interface DelegationView extends AttentionPlanIdentity {
  protocolVersion: 2; schemaVersion: 2; delegationIntent: 1; storeId: string;
  sourceBinding: { sourceId: string; verified: true };
  /** Opaque equality token covers declaration/reservation/cancel/disposition/eligibility/capture.
   * Independent of progress revision. A changed list token retires cached detail before rendering.
   */
  token: string;
  readAt: string;
  /** No disposition on incomplete/unverifiable evidence: never infer successful binding or absence. */
  result:
    | { availability: 'ready'; complete: true; disposition: DelegationDisposition }
    | { availability: 'unavailable'; complete: false; reason: 'budget' | 'legacy' | 'unverified' | 'invalid' | 'capture-unavailable' };
}
/** List metadata and optional detail overlay. Missing fields on old services mean no pending note.
 * health.delegationIntent === 1 gates requesting `delegationIntent=1` on existing list/detail reads.
 * Reads never settle intents, grant authority, dispatch or mutate status. Strict RunRow stays unchanged.
 */
export interface DelegationListExtension { delegationToken?: string }
export interface DelegationDetailExtension { delegationIntent?: DelegationView }
