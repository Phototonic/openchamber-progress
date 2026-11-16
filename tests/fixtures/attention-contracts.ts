import type { NeedsYouWindow } from '../../shared/needs-you.ts';
import type { DelegationDisposition, DelegationView } from '../../shared/delegation-view.ts';

/** Synthetic wire examples shared by independent service/UI lanes; never proof of real binding. */
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
const at = '2026-01-01T00:00:00.000Z';
const identity = { source: 'source-alpha', plan: 'plan-alpha', revision: 3, structuralRevision: 1, cleanup: { state: 'visible' as const, revision: 0 } };
const binding = { sourceId: 'source-alpha', verified: true as const };
export const INBOX_WINDOW: NeedsYouWindow = freeze({
  protocolVersion: 2, schemaVersion: 2, needsYouInbox: 1, storeId: 'store-fixture', sourceBinding: binding, readAt: at, captureEnabled: true,
  rows: [{
    ...identity, planTitle: 'Release example', coordinatorSessionId: 'coordinator-alpha', mainSessionKind: 'top-level',
    task: { id: 'task-a', title: 'Choose a direction', kind: 'task', status: 'blocked' },
    ancestors: [], omittedAncestors: 0, group: 'needs-you',
    blocker: { state: 'reported', annotation: { category: 'decision', reason: 'Choose <one> option', nextAction: 'Review the alternatives', reportedRevision: 2, validAtRevision: 3, reportedAt: at, reporterSessionId: 'coordinator-alpha', attributedSessionId: 'coordinator-alpha', mode: 'direct' } },
    timing: { readAt: at, since: at, kind: 'lower-bound' },
  }],
  counts: { needsYou: 1, alsoBlocked: 0 }, nextCursor: null,
  coverage: { kind: 'observed-current', complete: true, exhausted: true, gapped: false, skippedRecords: 0, reasons: [] },
  work: { planSlots: 2, inspectedItems: 1, inputBytes: 1024, outputBytes: 2048 },
});
export const INBOX_PARTIAL: NeedsYouWindow = freeze({
  ...structuredClone(INBOX_WINDOW), nextCursor: 'opaque-fixture-continuation',
  coverage: { kind: 'observed-current', complete: false, exhausted: false, gapped: false, skippedRecords: 0, reasons: [] },
});
export const INBOX_EMPTY: NeedsYouWindow = freeze({ ...structuredClone(INBOX_WINDOW), rows: [], counts: { needsYou: 0, alsoBlocked: 0 } });
/** Frozen upgrade examples: wire grouping stays category-only under capability revision 1. */
export const INBOX_MEMBERSHIP: NeedsYouWindow = freeze({
  ...structuredClone(INBOX_WINDOW),
  rows: [
    { ...structuredClone(INBOX_WINDOW.rows[0]), task: { id: 'main', title: 'Main decision', kind: 'task', status: 'blocked' } },
    ...(['direct', 'handoff', 'relay', 'subagent-plan', 'unknown-plan'] as const).map(id => {
      const row = structuredClone(INBOX_WINDOW.rows[0]);
      row.task.id = id; row.task.title = id;
      if (row.blocker.state !== 'reported') throw new Error('fixture annotation');
      if (id === 'direct' || id === 'handoff') {
        row.blocker.annotation.reporterSessionId = 'child-alpha';
        row.blocker.annotation.attributedSessionId = 'child-alpha';
      } else if (id === 'relay') {
        row.blocker.annotation.mode = 'parent-relay';
        row.blocker.annotation.attributedSessionId = 'child-alpha';
      } else row.mainSessionKind = id === 'subagent-plan' ? 'subagent' : 'unknown';
      return row;
    }),
  ],
  counts: { needsYou: 6, alsoBlocked: 0 },
});
export const INBOX_LEGACY: NeedsYouWindow = freeze({
  ...structuredClone(INBOX_WINDOW),
  rows: INBOX_WINDOW.rows.map(({ mainSessionKind: _kind, ...row }) => structuredClone(row)),
});
const declaration = { oid: 'declaration-fixture', coordinatorSessionId: 'coordinator-alpha', declaredRevision: 2, taskIds: ['task-a'], dispatch: null };
const view = (token: string, disposition: DelegationDisposition): DelegationView => freeze({
  ...identity, protocolVersion: 2, schemaVersion: 2, delegationIntent: 1, storeId: 'store-fixture', sourceBinding: binding,
  readAt: at, token, result: { availability: 'ready', complete: true, disposition },
});
export const INTENT_PENDING = view('intent-pending', { state: 'pending', eligible: true, declaration });
export const INTENT_RESERVED = view('intent-reserved', { state: 'reserved', eligible: true, declaration: { ...declaration, dispatch: { tool: 'subagent', messageId: 'message-fixture', callId: 'call-fixture' } } });
export const INTENT_CANCELLED = view('intent-cancelled', { state: 'cancelled', declaration, reason: 'cancelled' });
export const INTENT_REFUSED = view('intent-refused', { state: 'refused', declaration, reason: 'relevant-change', recovery: 'redeclare-or-link' });
export const INTENT_UNAVAILABLE: DelegationView = freeze({
  ...structuredClone(INTENT_PENDING), token: 'intent-unavailable',
  result: { availability: 'unavailable', complete: false, reason: 'budget' },
});
