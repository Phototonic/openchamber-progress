// View model shared by all three surfaces. The wire format lives only in adapter.ts.
import { countItems } from '../../shared/progress.ts';
import { directoryKey } from './path.ts';

export type ItemStatus = 'pending' | 'working' | 'blocked' | 'done' | 'skipped';
export type Lifecycle = 'active' | 'completed' | 'cancelled' | 'failed';
export type DocumentState = 'unbound' | 'captured' | 'denied' | 'missing' | 'moved' | 'oversized' | 'non-text' | 'unavailable' | 'changed-during-read';

export interface Counts { done: number; total: number; remaining: number; skipped: number }

export interface ItemView {
  id: string;
  title: string;
  kind: 'group' | 'task';
  status: ItemStatus;
  parentId?: string;
  dependencies?: string[];
  assigneeSessionId?: string;
  reporterSessionId?: string;
}

export interface ContributionView {
  revision: number;
  reporterSessionId: string;
  reporterAgent?: string;
  attributedSessionId: string;
  mode: 'direct' | 'parent-relay';
  itemIds: string[];
  reportedAt?: string;
}

export interface DocumentRefView {
  state: DocumentState;
  path?: string;
  captureId?: number;
  hash?: string;
  capturedAt?: string;
  checkedAt?: string;
  checklistSynchronized: boolean;
  currentFile: string;
}

export interface SourceView { id: string; verified: boolean; configRoot?: string; dataRoot?: string }

/** List-level plan (PlanSummary). Detail arrives separately and on demand. */
export interface PlanView {
  /** `${sourceId}/${id}`: plan IDs are unique only within a source. */
  key: string;
  id: string;
  sourceId: string;
  title: string;
  ownerSessionId: string;
  revision: number;
  structuralRevision: number;
  lifecycle: Lifecycle;
  reportedAt: string;
  /** Last reported directory/project: recorded metadata, not live SDK labels. */
  directory: string;
  projectId?: string;
  /** Server counts (groups and skipped excluded from total). */
  counts: Counts | null;
  /** IDs of working items; titles need the detail read. */
  working: string[];
  document: DocumentRefView;
}

export interface PlanDetail {
  key: string;
  revision: number;
  items: ItemView[];
  contributions: ContributionView[];
  links: { sessionId: string; itemIds: string[] }[];
  /**
   * Reported-working intervals by task ID, for this revision (docs/contracts.md). Absent: the
   * service gave no timing (older service or unreadable), so no elapsed claim at all. A working
   * task without an entry has an unknown start, never zero.
   */
  timing?: Record<string, ElapsedAnchor>;
}

/**
 * One task's reported-working interval, anchored to the service clock: `readAt - since` at the
 * reply, then advanced by the local monotonic clock from `receivedAt` (never browser wall time).
 * `lower-bound`: the start is earlier than `since` and unknown.
 */
export interface ElapsedAnchor { kind: 'exact' | 'lower-bound'; since: string; elapsedAtRead: number; receivedAt: number }

/** Milliseconds since the task was reported in progress, at monotonic time `mono`. */
export const elapsedAt = (a: ElapsedAnchor, mono: number) => a.elapsedAtRead + Math.max(0, mono - a.receivedAt);

export interface DocumentBody { key: string; captureId?: number; text: string | null; historical: boolean; ref: DocumentRefView }
export interface HistoryEntry { revision: number; structuralRevision: number; lifecycle: Lifecycle; reportedAt: string }

export interface StoreRead {
  storeId: string;
  sources: SourceView[];
  binding: { sourceId: string | null; verified: boolean };
  captureEnabled: boolean;
  coverage: string;
  diagnostics: string[];
  plans: PlanView[];
  /** More pages exist than this frame loaded. */
  truncated: boolean;
}

export interface HealthView { ready: boolean; sqlite: boolean; node?: string; diagnostics: string[] }

export interface SetupTargets { configRoot: string; dataRoot: string; storeRoot: string }
/**
 * Prefill hint for one folder (unconfigured Linux service only). `resolved`: the service observed an
 * owned directory there; `candidate`: a usual default, not found or not confirmed. Neither verifies
 * the OpenCode setup. `null`: unknown.
 */
export interface SetupSuggestion { value: string; state: 'resolved' | 'candidate' }
export type SetupSuggestions = Record<keyof SetupTargets, SetupSuggestion | null>;
/**
 * Bundled companion compared with the selected installed one (configured, verified, installed only).
 * `current`: same files, not just the same version label. `available`: different files, bundled
 * version the same or higher. `newer-installed`: the installed version is higher. `rootVersion` is
 * the folder's loader/remove utility from when the companion was installed; updates keep it. Absent: no claim.
 */
/**
 * What the official repository's main branch advertises (GET /v1/extension-update). `available`
 * names only official main: not the source this extension was actually installed from, not a
 * bundled or installed version. `checkedAt` is the last successful check; `stale` means a later
 * check failed and this is older knowledge.
 */
export interface OfficialMainView {
  installedVersion: string;
  state: 'available' | 'not-newer' | 'unknown';
  checkedAt: string | null;
  stale: boolean;
  candidateVersion?: string;
  diagnostic: 'ok' | 'unavailable' | 'rate-limited' | 'invalid-manifest' | 'invalid-response' | 'redirect' | 'too-large' | 'timeout' | 'shutdown';
  nextCheckAt: string;
}

export interface CompanionUpdateView { state: 'current' | 'available' | 'newer-installed'; candidateVersion: string; rootVersion: string | null }
export interface SetupView {
  configured: boolean;
  verified: boolean;
  installed: boolean;
  captureEnabled: boolean | null;
  targets: SetupTargets | null;
  version: string | null;
  activation: string;
  historyRetained: boolean;
  diagnostics: string[];
  recovery: { stagedPackages: number; stagedActivations: number; stagedReleases: number } | null;
  action?: string;
  /** Unconfigured replies only; absent when the service has none (unsupported host, older service). */
  suggestions?: SetupSuggestions;
  /** Absent when the service makes no comparison (older service, not installed, unverified, errors). */
  update?: CompanionUpdateView;
}

export interface PlanSummary extends Counts { working: number; blocked: number; percent: number | null }

/**
 * One count rule for every surface: server counts for the plan; the shared countItems
 * (same rule) for detail subtrees. working/blocked come from detail when loaded.
 */
export function summarize(plan: Pick<PlanView, 'counts' | 'working'> | null, detail?: Pick<PlanDetail, 'items'> | null): PlanSummary {
  const c = plan?.counts ?? (detail ? countItems(detail.items) : { done: 0, total: 0, remaining: 0, skipped: 0 });
  const tasks = detail ? detail.items.filter((i) => i.kind === 'task') : [];
  return {
    ...c,
    working: detail ? tasks.filter((i) => i.status === 'working').length : plan?.working.length ?? 0,
    blocked: tasks.filter((i) => i.status === 'blocked').length,
    percent: c.total ? Math.round((c.done / c.total) * 100) : null,
  };
}

export const subtreeCounts = (items: ItemView[]) => countItems(items);

/**
 * Whether a plan's reported in-progress work may move (bar sheen, status-text and dot pulse).
 * Motion means "recorded as in progress" only: an active plan with working tasks, in a view whose
 * last read succeeded with capture on. Stale, failed and capture-off views stay static. It never
 * reads report age or live session state.
 */
export const showsLiveness = (lifecycle: Lifecycle, s: Pick<PlanSummary, 'working'>, view: { fresh: boolean; captureEnabled: boolean }) =>
  lifecycle === 'active' && s.working > 0 && view.fresh && view.captureEnabled;

export function summaryText(s: Counts) {
  if (s.total === 0) return s.skipped ? `No tasks left to count · ${s.skipped} skipped` : 'No tasks reported';
  const parts = [`${s.done} of ${s.total} done`, `${s.remaining} remaining`];
  if (s.skipped) parts.push(`${s.skipped} skipped`);
  return parts.join(' · ');
}

export interface ItemNode { item: ItemView; children: ItemNode[] }

/** Hierarchy; an item whose parent is unknown stays at the top level. Cycles are cut. */
export function itemTree(items: ItemView[]): ItemNode[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const build = (item: ItemView, seen: Set<string>): ItemNode => {
    const next = new Set(seen).add(item.id);
    return { item, children: items.filter((c) => c.parentId === item.id && !next.has(c.id)).map((c) => build(c, next)) };
  };
  return items.filter((i) => !i.parentId || !byId.has(i.parentId) || i.parentId === i.id).map((i) => build(i, new Set()));
}

export const currentWork = (detail: PlanDetail) => detail.items.filter((i) => i.kind === 'task' && i.status === 'working');
export const blockedWork = (detail: PlanDetail) => detail.items.filter((i) => i.kind === 'task' && i.status === 'blocked');

/** Sessions involved, main first. Assignment comes from links and item assignees; relays keep both sides. */
export interface Participant { sessionId: string; role: 'main' | 'child'; assigned: number; relayed: boolean; reporterAgents: string[] }

export function participants(plan: PlanView, detail: PlanDetail | null): Participant[] {
  const list: Participant[] = [{ sessionId: plan.ownerSessionId, role: 'main', assigned: 0, relayed: false, reporterAgents: [] }];
  const get = (id: string) => {
    let p = list.find((x) => x.sessionId === id);
    if (!p) { p = { sessionId: id, role: 'child', assigned: 0, relayed: false, reporterAgents: [] }; list.push(p); }
    return p;
  };
  if (!detail) return list;
  const assigned = new Map<string, Set<string>>();
  const add = (sid: string, itemId: string) => { if (!assigned.has(sid)) assigned.set(sid, new Set()); assigned.get(sid)!.add(itemId); };
  for (const l of detail.links) for (const i of l.itemIds) add(l.sessionId, i);
  for (const item of detail.items) if (item.kind === 'task' && item.assigneeSessionId) add(item.assigneeSessionId, item.id);
  for (const [sid, ids] of assigned) if (sid !== plan.ownerSessionId) get(sid).assigned = ids.size;
  for (const c of detail.contributions) {
    const p = get(c.attributedSessionId);
    if (c.mode === 'parent-relay') p.relayed = true;
    if (c.reporterAgent && !p.reporterAgents.includes(c.reporterAgent)) p.reporterAgents.push(c.reporterAgent);
  }
  return list;
}

const within = (dir: string, root: string) => {
  const a = directoryKey(dir);
  const b = directoryKey(root);
  return Boolean(a && b) && (a === b || a.startsWith(b.endsWith('/') ? b : `${b}/`));
};
export { within as directoryWithin };

/** Most relevant first: active plans by latest report, then finished ones. */
export function orderPlans<T extends Pick<PlanView, 'lifecycle' | 'reportedAt' | 'key'>>(plans: T[]) {
  return [...plans].sort((a, b) => (a.lifecycle === 'active' ? 0 : 1) - (b.lifecycle === 'active' ? 0 : 1) || b.reportedAt.localeCompare(a.reportedAt) || a.key.localeCompare(b.key));
}

export const LIFECYCLE_LABEL: Record<Lifecycle, string> = { active: 'In progress', completed: 'Finished', cancelled: 'Cancelled', failed: 'Failed' };
export const STATUS_LABEL: Record<ItemStatus, string> = { pending: 'Pending', working: 'In progress', blocked: 'Blocked', done: 'Done', skipped: 'Skipped' };

export const DOCUMENT_STATE_TEXT: Record<DocumentState, string> = {
  unbound: 'No plan document is linked to this plan.',
  captured: '',
  denied: 'The agent was not allowed to read the plan document at the last report.',
  missing: 'The plan document was missing at the last report.',
  moved: 'The plan document moved since it was linked; the agent needs to link it again.',
  oversized: 'The plan document is larger than the capture limit, so it was not captured.',
  'non-text': 'The plan document is not plain text, so it was not captured.',
  unavailable: 'The plan document could not be read on this system.',
  'changed-during-read': 'The plan document changed while it was being read; it will be captured at a later report.',
};
