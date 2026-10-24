// Designer-owned unit fixtures in the frozen v2 wire shape (shared/progress.ts). Stable IDs,
// controlled clock. Real-service runs seed data through the companion tool instead.
import { countItems, type Contribution, type DocumentRef, type Item, type PlanSummary } from '../../shared/progress.ts';

export const NOW = Date.parse('2026-10-24T12:00:00.000Z');
export const at = (minutesAgo: number, now = NOW) => new Date(now - minutesAgo * 60_000).toISOString();
export const SRC = 'src-local';
export const OTHER_SRC = 'src-other';
export const S = { M: 'ses_fixture_main_M', C1: 'ses_fixture_child_C1', C2: 'ses_fixture_child_C2', U: 'ses_fixture_other_U' };

export const DOCUMENT_TEXT = '# Canonical fixture\n\nUnicode: Привет 🌱 — 日本語\n<script>window.__apInjected = true</script>\n![sentinel](https://invalid.example/no-fetch.png)\n';

export const P1_ITEMS: Item[] = [
  { id: 'G', title: 'Implementation', kind: 'group', status: 'pending' },
  { id: 'I1', title: 'Contract', kind: 'task', parentId: 'G', status: 'done' },
  { id: 'I2', title: 'Probe', kind: 'task', parentId: 'G', status: 'done', reporterSessionId: S.M },
  { id: 'I3', title: 'Native child contribution', kind: 'task', status: 'working', assigneeSessionId: S.C1 },
  { id: 'I4', title: 'Integration', kind: 'task', status: 'pending' },
  { id: 'I5', title: 'Optional experiment', kind: 'task', status: 'skipped' },
];

export const envelope = (extra: Record<string, unknown> = {}) => ({
  protocolVersion: 2, schemaVersion: 2, storeId: 'store-1',
  sources: [{ id: SRC, configRoot: '/cfg', dataRoot: '/data', verified: true }, { id: OTHER_SRC, configRoot: '/cfg2', dataRoot: '/data2', verified: false }],
  sourceBinding: { sourceId: SRC, verified: true }, captureEnabled: true, coverage: 'recorded-only', diagnostics: [], ...extra,
});

export const docRef = (extra: Partial<DocumentRef> = {}): DocumentRef => ({ state: 'captured', path: '/fixture/Alpha/docs/plan.md', captureId: 7, hash: 'sha256:abc', capturedAt: at(42), checkedAt: at(7), checklistSynchronized: true, currentFile: 'not-rechecked', ...extra });

export function summary(id: string, items: Item[], extra: Partial<PlanSummary> = {}): PlanSummary {
  return {
    id, sourceId: SRC, title: `Plan ${id}`, sessionId: S.M, revision: 1, structuralRevision: 1, lifecycle: 'active', reportedAt: at(5),
    directory: '/fixture/Alpha', counts: countItems(items), working: items.filter((i) => i.kind === 'task' && i.status === 'working').map((i) => i.id),
    document: docRef({ state: 'unbound', path: undefined, captureId: undefined, hash: undefined, capturedAt: undefined, checklistSynchronized: false }), ...extra,
  };
}

export const P1 = summary('P1', P1_ITEMS, { title: 'Alpha implementation', revision: 4, structuralRevision: 2, reportedAt: at(7), document: docRef() });
export const P2 = summary('P2', [{ id: 'P2-I1', title: 'Second objective', kind: 'task', status: 'blocked' }], { title: 'Independent later objective', directory: '/fixture/Alpha-worktree', reportedAt: at(2) });
export const P3 = summary('P3', [{ id: 'P3-I1', title: 'Ship it', kind: 'task', status: 'done' }], { title: 'Unrelated work', sessionId: S.U, directory: '/fixture/Beta', lifecycle: 'finished', reportedAt: at(60 * 26) });
export const X1 = summary('X1', [], { title: 'Other setup plan', sourceId: OTHER_SRC, sessionId: S.M });

export const RELAY: Contribution = { revision: 3, reporterSessionId: S.M, reporterAgent: 'build', attributedSessionId: S.C2, mode: 'parent-relay', itemIds: ['I2'], reportedAt: at(8) };

export const plansPage = (data: PlanSummary[], nextCursor: string | null = null, extra: Record<string, unknown> = {}) => ({ ...envelope(extra), data, nextCursor });

export const planPage = (plan: PlanSummary, items: Item[], contributions: Contribution[], next: { items: string | null; contributions: string | null } = { items: null, contributions: null }, links: { sessionId: string; itemIds: string[] }[] = [{ sessionId: S.C1, itemIds: ['I3'] }]) =>
  ({ ...envelope(), plan, items: { data: items, nextCursor: next.items }, contributions: { data: contributions, nextCursor: next.contributions }, links });

export const HEALTH = { ok: true, ready: true, sqlite: true, protocolVersion: 2, schemaVersion: 2, runtime: { node: '24.22.0', bun: null } };
export const HEALTH_UNCONFIGURED = { ok: true, ready: false, sqlite: false, protocolVersion: 2, schemaVersion: 2, runtime: { node: '24.22.0', bun: null }, diagnostics: ['targets-unverified'] };

export const setupRead = (extra: Record<string, unknown> = {}) => ({
  configured: true, verified: true, installed: true, captureEnabled: true,
  targets: { configRoot: '/cfg', dataRoot: '/data', storeRoot: '/store' }, activation: 'unknown', separateLifecycle: true, historyRetained: true,
  diagnostics: [], version: '2.0.0', recovery: { stagedPackages: 0, stagedActivations: 0, stagedReleases: 0 }, ...extra,
});
