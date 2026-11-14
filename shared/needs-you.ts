import { BLOCKER_LIMITS, SEARCH_LIMITS, type BlockerAnnotation, type BlockerCategory, type Envelope } from './progress.ts';

/** Additive read revision 1; no durable inbox, protocol/schema change or report authority. */
export const NEEDS_YOU_LIMITS = Object.freeze({
  plans: SEARCH_LIMITS.plans, rows: SEARCH_LIMITS.hits, ancestors: SEARCH_LIMITS.ancestors,
  inputBytes: SEARCH_LIMITS.inputBytes, responseBytes: SEARCH_LIMITS.responseBytes,
  queryBytes: SEARCH_LIMITS.queryBytes, cursorBytes: SEARCH_LIMITS.cursorBytes,
  timingPlans: SEARCH_LIMITS.hits, timingSnapshotVisits: BLOCKER_LIMITS.snapshotVisits,
  timingInputBytes: BLOCKER_LIMITS.inputBytes, textCodeUnits: BLOCKER_LIMITS.textCodeUnits,
});

/** Health capability: absent, malformed and unknown revisions mean unavailable, not empty. */
export function supportsNeedsYou(value: unknown): value is 1 { return value === 1; }
export interface NeedsYouIdentity {
  protocolVersion: 2; schemaVersion: 2; needsYouInbox: 1; storeId: string;
  sourceBinding: { sourceId: string; verified: true };
}
export interface AttentionPlanIdentity {
  source: string; plan: string; revision: number; structuralRevision: number;
  cleanup: { state: 'visible'; revision: number };
}
/** Caller pins the observed store/binding; a continuation also pins its traversal internally. */
export interface NeedsYouRequest {
  storeId: string; binding: Envelope['sourceBinding']; source: string;
  cursor?: string; limit?: number; timing?: boolean;
}
export type NeedsYouGroup = 'needs-you' | 'also-blocked';
export type InboxBlocker =
  | { state: 'reported'; annotation: Omit<BlockerAnnotation, 'category'> & { category?: BlockerCategory | 'unclassified' } }
  | { state: 'absent' | 'invalid' };
export interface NeedsYouRow extends AttentionPlanIdentity {
  planTitle: string; coordinatorSessionId: string;
  task: { id: string; title: string; kind: 'task'; status: 'blocked' };
  ancestors: { id: string; title: string }[]; omittedAncestors: number;
  group: NeedsYouGroup;
  /** Only validated current annotations; unknown categories stay Also blocked. No raw invalid text. */
  blocker: InboxBlocker;
  /** Absent is unavailable, never zero. Requested for displayed rows only, not compact counts.
   * Timing visit/input budgets above apply across the entire window, not once per row/plan.
   */
  timing?: { readAt: string; since: string; kind: 'exact' | 'lower-bound' };
}
export type NeedsYouGap = 'invalid-snapshot' | 'oversized-snapshot';
export interface NeedsYouWindow extends NeedsYouIdentity {
  readAt: string;
  captureEnabled: boolean;
  rows: NeedsYouRow[];
  /** Cumulative once-per-task counts through this cursor, NOT per-page deltas. Exact only if complete. */
  counts: { needsYou: number; alsoBlocked: number };
  /** Opaque, bounded keyset continuation. Changed pinned records conflict; never splice revisions. */
  nextCursor: string | null;
  coverage: {
    kind: 'observed-current'; complete: boolean; exhausted: boolean; gapped: boolean;
    skippedRecords: number; reasons: NeedsYouGap[];
  };
  work: { planSlots: number; inspectedItems: number; inputBytes: number; outputBytes: number };
}
/** Optional first window only on opted-in first list page / search freshness, once per cycle.
 * Query extension: `needsYou=1`, gated by health.needsYouInbox === 1. Ordinary list scope is unchanged.
 * Explicit open/continuation uses GET /v1/needs-you. Multiple windows are observed data, not an atomic
 * source snapshot. Complete requires exhausted, no cursor and no gaps; otherwise counts are known minima.
 */
export interface NeedsYouExtension { needsYou?: NeedsYouWindow }
