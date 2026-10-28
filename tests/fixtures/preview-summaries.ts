// Public-safe synthetic inputs shared by pure, service and UI verification.
import { countItems, type Contribution, type Item, type PlanSummary } from '../../shared/progress.ts';

export const SUMMARY_REQUEST = { sourceId: 'source-summary', id: 'P-summary' };
export const SUMMARY_TIME = '2026-10-27T09:14:00.000Z';
export const FORBIDDEN = 'OMITTED_PRIVATE_METADATA';
export const SUMMARY_ITEMS: Item[] = [
  { id: 'group', title: 'Export flow', kind: 'group', status: 'pending' },
  ...['Dry-run export', 'Validate schema', 'Prepare export', 'Check encoding', 'Review mapping'].map((title, i): Item => ({ id: `done-${i}`, title, kind: 'task', status: 'done' })),
  { id: 'skip', title: 'Legacy CSV path', kind: 'task', status: 'skipped' },
  { id: 'working', title: 'Validate import mapping', kind: 'task', status: 'working' },
  { id: 'blocked', title: 'Migrate legacy rows', kind: 'task', status: 'blocked' },
  { id: 'docs', title: 'Update export docs', kind: 'task', status: 'pending', dependencies: ['working'] },
  { id: 'review', title: 'Review rollout checklist', kind: 'task', status: 'pending', dependencies: ['done-0'] },
];

export function summaryReports(count = 7): Contribution[] {
  return Array.from({ length: count }, (_, n) => ({ revision: n + 1, reporterSessionId: FORBIDDEN, reporterAgent: FORBIDDEN, attributedSessionId: FORBIDDEN, mode: n < 5 ? 'direct' : 'parent-relay', itemIds: ['working'], reportedAt: SUMMARY_TIME }));
}

export function summaryPlan(items: Item[] = SUMMARY_ITEMS, extra: Partial<PlanSummary> = {}): PlanSummary {
  return {
    ...SUMMARY_REQUEST, title: 'Add export flow', sessionId: 'session-example', revision: 7, structuralRevision: 1,
    lifecycle: 'active', reportedAt: SUMMARY_TIME, directory: FORBIDDEN, projectId: FORBIDDEN,
    counts: countItems(items), working: items.filter((i) => i.kind === 'task' && i.status === 'working').map((i) => i.id),
    document: { state: 'captured', path: FORBIDDEN, captureId: 17, hash: FORBIDDEN, capturedAt: SUMMARY_TIME, checkedAt: SUMMARY_TIME, checklistSynchronized: true, currentFile: 'not-rechecked' },
    ...extra,
  };
}

export function summaryEnvelope(extra: Record<string, unknown> = {}) {
  return { protocolVersion: 2, schemaVersion: 2, storeId: FORBIDDEN, sources: [{ id: SUMMARY_REQUEST.sourceId, verified: true, configRoot: FORBIDDEN, dataRoot: FORBIDDEN }], sourceBinding: { sourceId: SUMMARY_REQUEST.sourceId, verified: true }, captureEnabled: true, coverage: 'recorded-only', diagnostics: [], ...extra };
}

export function summaryPage(items: Item[] = SUMMARY_ITEMS, reports = summaryReports(), page = 0, plan = summaryPlan(items), envelope = summaryEnvelope()) {
  const slice = <T>(values: T[]) => ({ data: values.slice(page * 20, (page + 1) * 20), nextCursor: values.length > (page + 1) * 20 ? String(page + 1) : null });
  return { ...envelope, plan, items: slice(items), contributions: slice(reports), links: [{ sessionId: FORBIDDEN, itemIds: ['working'] }], body: FORBIDDEN };
}

export function pagedSummaryItems(count = 21): Item[] {
  return Array.from({ length: count }, (_, n) => ({ id: `task-${n}`, title: `Task ${n + 1}`, kind: 'task', status: n === count - 1 ? 'done' : 'pending', ...(n === 0 ? { dependencies: [`task-${count - 1}`] } : {}) }));
}

export const EXPECTED_PROGRESS = `Plan: Add export flow (P\\-summary)
Lifecycle: In progress
Progress: 5/9 done; 4 remaining; 1 skipped
Last report: 2026-10-27T09:14:00.000Z
Remaining breakdown: 1 working; 1 blocked; 2 pending

## Current work
- Validate import mapping

## Explicitly blocked
- Migrate legacy rows — blocker details omitted from this summary

## Freshness warnings
- The current document file has not been rechecked.
`;

export const EXPECTED_HANDOFF = `Plan: Add export flow (P\\-summary)
Lifecycle: In progress
Progress: 5/9 done; 4 remaining; 1 skipped
Last report: 2026-10-27T09:14:00.000Z
Origin session: session\\-example
Coverage: full (revision 7)
Remaining breakdown: 1 working; 1 blocked; 2 pending

## Current work
- Validate import mapping — No prerequisites recorded

## Explicitly blocked
- Migrate legacy rows — blocker details omitted from this summary — No prerequisites recorded

## Not started
- Update export docs — Recorded prerequisites: Validate import mapping (In progress)
- Review rollout checklist — Recorded prerequisites: Dry\\-run export (Done)

Recorded reports: 5 direct; 2 parent-relay

## Suggested next step (suggestion, not an authoritative plan step)
Review rollout checklist

## Freshness warnings
- The current document file has not been rechecked.
`;
