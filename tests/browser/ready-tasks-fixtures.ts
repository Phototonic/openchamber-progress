// Synthetic readiness fixtures in the frozen v2 wire shape (shared/progress.ts). Shared by the
// logic tests and the browser fixture. Malformed variants are test-only inputs: the service's
// write validation refuses them, so they are never claimed to be accepted production writes.
import { countItems, type Contribution, type Item, type PlanSummary } from '../../shared/progress.ts';
import { at, docRef } from './fixtures.ts';

export const SOURCE = 'source-ready';
export const FOREIGN = 'source-foreign';
export const STORE = 'store-ready';
export const DIRECTORY = '/fixture/ready';
/** Sessions A (main), B and C (child). C is never in live coverage. */
export const SA = 'A', SB = 'B', SC = 'C';

export const LONG_TITLE = 'Independent check — 長い題名でも折り返す · <b>not markup</b> & "quotes" — verify the narrow layout wraps this whole title without horizontal overflow';

/** Group G: D done; R ← D (A); W ← R; S skipped; K ← S, W (C); B blocked ← D; X working; I (no list). */
export const READY_ITEMS: Item[] = [
  { id: 'G', title: 'Release preparation', kind: 'group', status: 'pending' },
  { id: 'D', title: 'Prepare inputs', kind: 'task', status: 'done', parentId: 'G' },
  { id: 'R', title: 'Review the inputs', kind: 'task', status: 'pending', parentId: 'G', dependencies: ['D'], assigneeSessionId: SA },
  { id: 'W', title: 'Write the summary', kind: 'task', status: 'pending', parentId: 'G', dependencies: ['R'] },
  { id: 'S', title: 'Optional benchmark', kind: 'task', status: 'skipped', parentId: 'G' },
  { id: 'K', title: 'Publish the comparison', kind: 'task', status: 'pending', parentId: 'G', dependencies: ['S', 'W'], assigneeSessionId: SC },
  { id: 'B', title: 'Request sign-off', kind: 'task', status: 'blocked', parentId: 'G', dependencies: ['D'] },
  { id: 'X', title: 'Draft release notes', kind: 'task', status: 'working', parentId: 'G' },
  { id: 'I', title: LONG_TITLE, kind: 'task', status: 'pending', parentId: 'G' },
];

/** K: a direct report by C and a relay by A for C (repeated at a later revision); R: direct by A. */
export const READY_CONTRIBUTIONS: Contribution[] = [
  { revision: 1, reporterSessionId: SA, reporterAgent: 'build', attributedSessionId: SA, mode: 'direct', itemIds: ['R'], reportedAt: at(9) },
  { revision: 2, reporterSessionId: SC, reporterAgent: 'build', attributedSessionId: SC, mode: 'direct', itemIds: ['K'], reportedAt: at(8) },
  { revision: 3, reporterSessionId: SA, reporterAgent: 'build', attributedSessionId: SC, mode: 'parent-relay', itemIds: ['K'], reportedAt: at(7) },
  { revision: 4, reporterSessionId: SA, reporterAgent: 'build', attributedSessionId: SC, mode: 'parent-relay', itemIds: ['K', 'K'], reportedAt: at(6) },
];
/** Link fallback for W: must never become a recorded readiness assignee. */
export const READY_LINKS = [{ sessionId: SC, itemIds: ['K'] }, { sessionId: SB, itemIds: ['W'] }];

export const readyEnvelope = (extra: Record<string, unknown> = {}) => ({
  protocolVersion: 2, schemaVersion: 2, storeId: STORE,
  sources: [{ id: SOURCE, configRoot: '/cfg', dataRoot: '/data', verified: true }, { id: FOREIGN, configRoot: '/cfg-foreign', dataRoot: '/data-foreign', verified: false }],
  sourceBinding: { sourceId: SOURCE, verified: true }, captureEnabled: true, coverage: 'recorded-only', diagnostics: [], ...extra,
});

export function readySummary(items: Item[] = READY_ITEMS, extra: Partial<PlanSummary> = {}): PlanSummary {
  return {
    id: 'P-ready', sourceId: SOURCE, title: 'Ready tasks example', sessionId: SA, revision: 3, structuralRevision: 1, lifecycle: 'active', reportedAt: at(4),
    directory: DIRECTORY, counts: countItems(items), working: items.filter((i) => i.kind === 'task' && i.status === 'working').map((i) => i.id),
    document: docRef({ state: 'unbound', path: undefined, captureId: undefined, hash: undefined, capturedAt: undefined, checklistSynchronized: false }), ...extra,
  };
}

/** One `/v1/plan` page at the service page size (20), shared cursor = page number. */
export function readyPage(plan: PlanSummary, items: unknown[], contributions: unknown[], page = 0, links: unknown[] = READY_LINKS, envelope = readyEnvelope()) {
  const size = 20;
  const more = (list: unknown[]) => (list.length > (page + 1) * size ? String(page + 1) : null);
  return {
    ...envelope, plan, links,
    items: { data: items.slice(page * size, (page + 1) * size), nextCursor: more(items) },
    contributions: { data: contributions.slice(page * size, (page + 1) * size), nextCursor: more(contributions) },
  };
}

/** `count` tasks; the first depends on the last (the 20 + 1 boundary for count 21). */
export function boundaryItems(count: number, lastStatus: Item['status'] = 'done'): Item[] {
  return Array.from({ length: count }, (_, i): Item => i === 0
    ? { id: 'T0', title: 'First page task', kind: 'task', status: 'pending', dependencies: [`T${count - 1}`] }
    : { id: `T${i}`, title: i === count - 1 ? 'Final page prerequisite' : `Task ${i}`, kind: 'task', status: i === count - 1 ? lastStatus : 'pending' });
}

/** A same-ID plan for session B and a foreign-source plan reusing plan, item and session IDs. */
export const SAME_ID_ITEMS: Item[] = READY_ITEMS.map((i) => ({ ...i, title: `Other plan · ${i.id}`, status: i.kind === 'task' ? 'pending' : i.status, dependencies: undefined, assigneeSessionId: undefined }));
export const FOREIGN_ITEMS: Item[] = [
  { id: 'R', title: 'Foreign review task', kind: 'task', status: 'pending', assigneeSessionId: SA },
  { id: 'W', title: 'Foreign follow-up', kind: 'task', status: 'pending', dependencies: ['R'] },
];
