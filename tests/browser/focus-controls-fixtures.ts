// Synthetic focus-control fixtures in the frozen v2 wire shape (shared/progress.ts). Shared by the
// logic/controller tests and the browser fixture. Deliberately synthetic: no real sessions or stores.
import { countItems, type Contribution, type Item, type PlanSummary, type Status } from '../../shared/progress.ts';
import { at, docRef } from './fixtures.ts';

export const SOURCE = 'source-focus';
export const FOREIGN = 'source-focus-other';
export const STORE = 'store-focus';
export const DIRECTORY = '/fixture/focus';
/** Sessions A (main), B, C and D. A and B are in live coverage; C and D are not. */
export const SA = 'A', SB = 'B', SC = 'C', SD = 'D';

/**
 * Core plan P-focus (owner A). G ⊃ H ⊃ {D done (B), S skipped, W working (B), B1 blocked (C)},
 * G ⊃ T done ⊃ U pending; E empty; Z ⊃ {L pending ← D (link B), R blocked, X working (reporter D), N pending}.
 * Full counts 2 done / 9 total / 7 remaining / 1 skipped over 10 task rows.
 */
export const CORE_ITEMS: Item[] = [
  { id: 'G', title: 'Build the release', kind: 'group', status: 'pending' },
  { id: 'H', title: 'Hardening', kind: 'group', status: 'done', parentId: 'G' },
  { id: 'D', title: 'Draft the checklist', kind: 'task', status: 'done', parentId: 'H', assigneeSessionId: SB },
  { id: 'S', title: 'Optional soak test', kind: 'task', status: 'skipped', parentId: 'H' },
  { id: 'W', title: 'Write the migration notes', kind: 'task', status: 'working', parentId: 'H', assigneeSessionId: SB },
  { id: 'B1', title: 'Benchmark the cold start', kind: 'task', status: 'blocked', parentId: 'H', assigneeSessionId: SC },
  { id: 'T', title: 'Tidy the release branch', kind: 'task', status: 'done', parentId: 'G' },
  { id: 'U', title: 'Update the changelog', kind: 'task', status: 'pending', parentId: 'T' },
  { id: 'E', title: 'Empty follow-ups', kind: 'group', status: 'pending' },
  { id: 'Z', title: 'Ship', kind: 'group', status: 'working' },
  { id: 'L', title: 'Label the release', kind: 'task', status: 'pending', parentId: 'Z', dependencies: ['D'] },
  { id: 'R', title: 'Request the review', kind: 'task', status: 'blocked', parentId: 'Z' },
  { id: 'X', title: 'Cross-check the artifacts', kind: 'task', status: 'working', parentId: 'Z', reporterSessionId: SD },
  { id: 'N', title: 'Notify the channel', kind: 'task', status: 'pending', parentId: 'Z' },
];

/** R: a direct report by B, and A relaying for C (recorded twice for deduplication). */
export const CORE_CONTRIBUTIONS: Contribution[] = [
  { revision: 1, reporterSessionId: SB, reporterAgent: 'build', attributedSessionId: SB, mode: 'direct', itemIds: ['R'], reportedAt: at(9) },
  { revision: 2, reporterSessionId: SA, reporterAgent: 'build', attributedSessionId: SC, mode: 'parent-relay', itemIds: ['R'], reportedAt: at(8) },
  { revision: 3, reporterSessionId: SA, reporterAgent: 'build', attributedSessionId: SC, mode: 'parent-relay', itemIds: ['R', 'R'], reportedAt: at(7) },
];
export const CORE_LINKS = [{ sessionId: SB, itemIds: ['L'] }];

/** Six working tasks and one blocked task: more than the Now callout's four rows. */
export const MANY_ITEMS: Item[] = [
  { id: 'Q', title: 'Parallel work', kind: 'group', status: 'pending' },
  ...Array.from({ length: 6 }, (_, n): Item => ({ id: `K${n + 1}`, title: `Parallel task ${n + 1}`, kind: 'task', status: 'working', parentId: 'Q' })),
  { id: 'K7', title: 'Waiting on access', kind: 'task', status: 'blocked', parentId: 'Q' },
  { id: 'K8', title: 'Afterwards', kind: 'task', status: 'pending' },
];

/** Variant plans owned by session V (not live), for closed, empty and group-only states and long untrusted titles. */
export const SV = 'V';
const LONG = 'Überprüfung der Ausgabe — 日本語のタイトル · <b>not markup</b> & a deliberately long task title that has to wrap';
export const CLOSED_ITEMS: Item[] = [
  { id: 'CG', title: `Closed group · ${LONG}`, kind: 'group', status: 'pending' },
  { id: 'C1', title: `Done · ${LONG}`, kind: 'task', status: 'done', parentId: 'CG' },
  { id: 'C2', title: `Still working · ${LONG}`, kind: 'task', status: 'working', parentId: 'CG', assigneeSessionId: SB },
  { id: 'C3', title: 'Still blocked', kind: 'task', status: 'blocked', parentId: 'CG' },
  { id: 'C4', title: 'Never started', kind: 'task', status: 'pending' },
  { id: 'C5', title: 'Dropped', kind: 'task', status: 'skipped' },
];
export const FINISHED_ITEMS: Item[] = [
  { id: 'F0', title: 'Finished group', kind: 'group', status: 'pending' },
  { id: 'F1', title: 'First', kind: 'task', status: 'done', parentId: 'F0' },
  { id: 'F2', title: 'Second', kind: 'task', status: 'done', parentId: 'F0' },
];
export const GROUP_ONLY_ITEMS: Item[] = [
  { id: 'Y0', title: 'Only groups here', kind: 'group', status: 'working' },
  { id: 'Y1', title: 'A nested group', kind: 'group', status: 'blocked', parentId: 'Y0' },
];

/** A task-parent (TP, assigned B) whose own report was relayed by A for C (recorded twice). */
export const RELAY_PARENT_ITEMS: Item[] = [
  { id: 'TP', title: 'Coordinate the release notes', kind: 'task', status: 'working', assigneeSessionId: SB },
  { id: 'TC1', title: 'Collect the changes', kind: 'task', status: 'done', parentId: 'TP' },
  { id: 'TC2', title: 'Check the wording', kind: 'task', status: 'pending', parentId: 'TP' },
];
export const RELAY_PARENT_CONTRIBUTIONS: Contribution[] = [
  { revision: 1, reporterSessionId: SA, reporterAgent: 'build', attributedSessionId: SC, mode: 'parent-relay', itemIds: ['TP'], reportedAt: at(50) },
  { revision: 2, reporterSessionId: SA, reporterAgent: 'build', attributedSessionId: SC, mode: 'parent-relay', itemIds: ['TP', 'TC2'], reportedAt: at(49) },
];

const STATUSES: Status[] = ['pending', 'working', 'blocked', 'done', 'skipped'];

/**
 * Exactly 1,000 items: 10 groups (SG0 ⊃ SG1 ⊃ SG2 ⊃ SG3 nested, SG4–SG9 broad) and 990 tasks cycling
 * the five statuses (198 each); every ninth task is the child of the task before it. Full counts are
 * 198 done / 792 total / 594 remaining / 198 skipped.
 */
export function scaleItems(): Item[] {
  const groups: Item[] = Array.from({ length: 10 }, (_, n) => ({ id: `SG${n}`, title: `Scale group ${n}`, kind: 'group', status: 'pending', ...(n > 0 && n < 4 ? { parentId: `SG${n - 1}` } : {}) }));
  const tasks: Item[] = Array.from({ length: 990 }, (_, n) => ({
    id: `ST${n}`, title: `Scale task ${n}`, kind: 'task', status: STATUSES[n % 5],
    parentId: n % 9 === 4 ? `ST${n - 1}` : `SG${n % 10}`,
    ...(n % 7 === 0 ? { assigneeSessionId: SA } : n % 7 === 1 ? { assigneeSessionId: SB } : {}),
  }));
  return [...groups, ...tasks];
}
/** Repeated direct and relay reports across three contribution pages. */
export const scaleContributions = (): Contribution[] => Array.from({ length: 60 }, (_, n) => n % 2
  ? { revision: n + 1, reporterSessionId: SA, reporterAgent: 'build', attributedSessionId: SC, mode: 'parent-relay', itemIds: [`ST${n * 3}`, `ST${n * 3}`], reportedAt: at(60 - n) }
  : { revision: n + 1, reporterSessionId: SB, reporterAgent: 'build', attributedSessionId: SB, mode: 'direct', itemIds: [`ST${n * 3 + 1}`], reportedAt: at(60 - n) });
export const SCALE_LINKS = [{ sessionId: SB, itemIds: Array.from({ length: 50 }, (_, n) => `ST${n * 5}`) }, { sessionId: SB, itemIds: ['ST0', 'ST5'] }];

/** A 1,000-item chain: one group, then each task the child of the one before (deep ancestry). */
export function deepChain(): Item[] {
  return [{ id: 'C0', title: 'Chain root', kind: 'group', status: 'pending' }, ...Array.from({ length: 999 }, (_, n): Item => ({ id: `C${n + 1}`, title: `Chain ${n + 1}`, kind: 'task', status: n === 998 ? 'working' : 'done', parentId: `C${n}` }))];
}

export const focusEnvelope = (extra: Record<string, unknown> = {}) => ({
  protocolVersion: 2, schemaVersion: 2, storeId: STORE,
  sources: [{ id: SOURCE, configRoot: '/cfg', dataRoot: '/data', verified: true }, { id: FOREIGN, configRoot: '/cfg-other', dataRoot: '/data-other', verified: false }],
  sourceBinding: { sourceId: SOURCE, verified: true }, captureEnabled: true, coverage: 'recorded-only', diagnostics: [], ...extra,
});

export function focusSummary(items: Item[] = CORE_ITEMS, extra: Partial<PlanSummary> = {}): PlanSummary {
  return {
    id: 'P-focus', sourceId: SOURCE, title: 'Focus controls example', sessionId: SA, revision: 5, structuralRevision: 2, lifecycle: 'active', reportedAt: at(3),
    directory: DIRECTORY, counts: countItems(items), working: items.filter((i) => i.kind === 'task' && i.status === 'working').map((i) => i.id),
    document: docRef({ state: 'unbound', path: undefined, captureId: undefined, hash: undefined, capturedAt: undefined, checklistSynchronized: false }), ...extra,
  };
}

/** One `/v1/plan` page at the service page size (20), shared cursor = page number. */
export function focusPage(plan: PlanSummary, items: unknown[], contributions: unknown[], page = 0, links: unknown[] = CORE_LINKS, envelope = focusEnvelope()) {
  const size = 20;
  const more = (list: unknown[]) => (list.length > (page + 1) * size ? String(page + 1) : null);
  return {
    ...envelope, plan, links,
    items: { data: items.slice(page * size, (page + 1) * size), nextCursor: more(items) },
    contributions: { data: contributions.slice(page * size, (page + 1) * size), nextCursor: more(contributions) },
  };
}
