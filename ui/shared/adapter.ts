// The only module that knows the service wire format: frozen production contract v2
// (shared/progress.ts, docs/contracts.md). It validates replies and maps them onto the
// view model. Probe v1 is no longer accepted.
import type {
  ContributionView, DocumentRefView, DocumentState, HealthView, HistoryEntry, ItemStatus, ItemView, Lifecycle, OfficialMainView, PlanView, SetupView, SourceView,
} from './model.ts';

export const SUPPORTED_PROTOCOL = 2;
export const SUPPORTED_SCHEMA = 2;

export class ContractError extends Error {
  readonly incompatible: boolean;
  constructor(message: string, incompatible = false) { super(message); this.name = 'ContractError'; this.incompatible = incompatible; }
}

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const optStr = (v: unknown) => (isStr(v) && v ? v : undefined);
const isInt = (v: unknown): v is number => Number.isSafeInteger(v);
function check(ok: unknown, message: string): asserts ok { if (!ok) throw new ContractError(message); }

const STATUSES: readonly ItemStatus[] = ['pending', 'working', 'blocked', 'done', 'skipped'];
const LIFECYCLES: Record<string, Lifecycle> = { active: 'active', finished: 'completed', cancelled: 'cancelled', failed: 'failed' };
const DOC_STATES: readonly DocumentState[] = ['unbound', 'captured', 'denied', 'missing', 'moved', 'oversized', 'non-text', 'unavailable', 'changed-during-read'];

/** Routes and query names from docs/contracts.md. Cursors are opaque and passed back verbatim. */
export const ROUTES = { health: '/health', plans: '/v1/plans', plan: '/v1/plan', document: '/v1/document', history: '/v1/history', setup: '/v1/setup', extensionUpdate: '/v1/extension-update' } as const;
export const SETUP_ACTIONS = ['inspect', 'install', 'update', 'disable', 'enable', 'remove-capture'] as const;
export type SetupAction = (typeof SETUP_ACTIONS)[number];

export function query(params: Record<string, string | number | null | undefined>) {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined && v !== '') out[k] = String(v);
  return Object.keys(out).length ? out : undefined;
}

function versions(v: Rec) {
  if (v.protocolVersion !== SUPPORTED_PROTOCOL || v.schemaVersion !== SUPPORTED_SCHEMA) {
    throw new ContractError(`Progress service uses protocol ${String(v.protocolVersion)}, schema ${String(v.schemaVersion)}.`, true);
  }
}

export function parseHealth(body: string): HealthView {
  const v: unknown = JSON.parse(body);
  check(isRec(v) && v.ok === true && typeof v.ready === 'boolean', 'The progress service did not report its health.');
  versions(v);
  const runtime = isRec(v.runtime) ? v.runtime : {};
  return { ready: v.ready, sqlite: v.sqlite === true, node: optStr(runtime.node), diagnostics: Array.isArray(v.diagnostics) ? v.diagnostics.filter(isStr) : [], ...(v.planCleanup === 1 ? { planCleanup: 1 as const } : {}) };
}

/** Error body of a non-200 reply: `{error: fixed-code}`. */
export function errorCode(body: string): string | null {
  try { const v: unknown = JSON.parse(body); return isRec(v) && isStr(v.error) ? v.error : null; } catch { return null; }
}

export interface EnvelopeView {
  storeId: string;
  sources: SourceView[];
  binding: { sourceId: string | null; verified: boolean };
  captureEnabled: boolean;
  coverage: string;
  diagnostics: string[];
}

function parseEnvelope(v: Rec): EnvelopeView {
  versions(v);
  check(isStr(v.storeId) && Array.isArray(v.sources) && isRec(v.sourceBinding), 'Progress reply has no store identity.');
  const b = v.sourceBinding;
  return {
    storeId: v.storeId,
    sources: v.sources.map((s) => {
      check(isRec(s) && isStr(s.id) && typeof s.verified === 'boolean', 'Progress reply has an unreadable source.');
      return { id: s.id, verified: s.verified, configRoot: optStr(s.configRoot), dataRoot: optStr(s.dataRoot) };
    }),
    binding: { sourceId: isStr(b.sourceId) ? b.sourceId : null, verified: b.verified === true },
    captureEnabled: v.captureEnabled === true,
    coverage: String(v.coverage ?? 'unknown'),
    diagnostics: Array.isArray(v.diagnostics) ? v.diagnostics.filter(isStr) : [],
  };
}

function parseDocumentRef(v: unknown): DocumentRefView {
  check(isRec(v) && DOC_STATES.includes(v.state as DocumentState) && typeof v.checklistSynchronized === 'boolean', 'A plan has an unreadable document reference.');
  return {
    state: v.state as DocumentState,
    path: optStr(v.path), captureId: isInt(v.captureId) ? v.captureId : undefined, hash: optStr(v.hash),
    capturedAt: optStr(v.capturedAt), checkedAt: optStr(v.checkedAt),
    checklistSynchronized: v.checklistSynchronized, currentFile: String(v.currentFile ?? 'not-rechecked'),
  };
}

function parseCounts(v: unknown) {
  check(isRec(v) && isInt(v.done) && isInt(v.total) && isInt(v.remaining) && isInt(v.skipped), 'A plan has unreadable counts.');
  return { done: v.done, total: v.total, remaining: v.remaining, skipped: v.skipped };
}

function parseSummary(v: unknown): PlanView {
  check(isRec(v) && isStr(v.id) && isStr(v.sourceId) && isStr(v.title) && isStr(v.sessionId), 'A plan has no identity.');
  check(isInt(v.revision) && isInt(v.structuralRevision) && isStr(v.reportedAt) && isStr(v.directory), `Plan ${v.id} has no revision, time or location.`);
  const lifecycle = LIFECYCLES[String(v.lifecycle)];
  check(lifecycle, `Plan ${v.id} has an unknown lifecycle.`);
  if (v.cleanup !== undefined) check(isRec(v.cleanup) && (v.cleanup.state === 'visible' || v.cleanup.state === 'archived') && isInt(v.cleanup.revision) && v.cleanup.revision >= 0, 'A plan has unreadable cleanup metadata.');
  return {
    key: `${v.sourceId}/${v.id}`, id: v.id, sourceId: v.sourceId, title: v.title, ownerSessionId: v.sessionId,
    revision: v.revision, structuralRevision: v.structuralRevision, lifecycle, reportedAt: v.reportedAt,
    directory: v.directory, projectId: optStr(v.projectId),
    counts: v.counts === undefined ? null : parseCounts(v.counts),
    working: Array.isArray(v.working) ? v.working.filter(isStr) : [],
    document: parseDocumentRef(v.document),
    ...(v.cleanup === undefined ? {} : { cleanup: v.cleanup as PlanView['cleanup'] }),
  };
}

function parseItem(v: unknown, planId: string): ItemView {
  check(isRec(v) && isStr(v.id) && isStr(v.title), `Plan ${planId} has an item without an id or title.`);
  check(v.kind === 'group' || v.kind === 'task', `Item ${v.id} has an unknown kind.`);
  check(STATUSES.includes(v.status as ItemStatus), `Item ${v.id} has an unknown status.`);
  // Omitted dependencies are valid; a present but malformed list must not read as "none recorded".
  check(v.dependencies === undefined || (Array.isArray(v.dependencies) && v.dependencies.every((d) => isStr(d) && d.length > 0)), `Item ${v.id} has unreadable dependencies.`);
  return {
    id: v.id, title: v.title, kind: v.kind, status: v.status as ItemStatus, parentId: optStr(v.parentId),
    dependencies: v.dependencies as string[] | undefined,
    assigneeSessionId: optStr(v.assigneeSessionId), reporterSessionId: optStr(v.reporterSessionId),
  };
}

function parseContribution(v: unknown, planId: string): ContributionView {
  check(isRec(v) && isStr(v.reporterSessionId) && isStr(v.attributedSessionId) && Array.isArray(v.itemIds), `Plan ${planId} has an unreadable contribution.`);
  check(v.mode === 'direct' || v.mode === 'parent-relay', `Plan ${planId} has an unknown contribution mode.`);
  return {
    revision: isInt(v.revision) ? v.revision : 0, reporterSessionId: v.reporterSessionId, reporterAgent: optStr(v.reporterAgent),
    attributedSessionId: v.attributedSessionId, mode: v.mode, itemIds: v.itemIds.filter(isStr), reportedAt: optStr(v.reportedAt),
  };
}

function page<T>(v: unknown, parse: (x: unknown) => T, what: string): { data: T[]; nextCursor: string | null } {
  check(isRec(v) && Array.isArray(v.data), `${what} has no data page.`);
  check(v.nextCursor === null || isStr(v.nextCursor), `${what} has an invalid page cursor.`);
  return { data: v.data.map(parse), nextCursor: isStr(v.nextCursor) && v.nextCursor ? v.nextCursor : null };
}

/** GET /v1/plans */
export function parsePlansPage(body: string) {
  const v: unknown = JSON.parse(body);
  check(isRec(v), 'Progress reply is not an object.');
  return { envelope: parseEnvelope(v), ...page(v, parseSummary, 'Plan list') };
}

export interface TimingView { items: Record<string, { kind: 'exact' | 'lower-bound'; since: string; elapsedAtRead: number }> }

/**
 * Optional reported-working timing of a detail reply. It is a claim, so doubt reads as no claim:
 * an absent or unreadable object gives null (no elapsed labels), and an unreadable entry, or one
 * that starts after the reply's own read time, is dropped (that task's start is unknown).
 * Durations use only the service's clock: readAt - since.
 */
export function parseTiming(v: unknown): TimingView | null {
  if (!isRec(v) || !isStr(v.readAt) || !isRec(v.items)) return null;
  const readAt = Date.parse(v.readAt);
  if (Number.isNaN(readAt)) return null;
  const items: TimingView['items'] = {};
  for (const [id, e] of Object.entries(v.items)) {
    if (!isRec(e) || !isStr(e.since) || (e.kind !== 'exact' && e.kind !== 'lower-bound')) continue;
    const since = Date.parse(e.since);
    if (Number.isNaN(since) || since > readAt) continue;
    items[id] = { kind: e.kind, since: e.since, elapsedAtRead: readAt - since };
  }
  return { items };
}

/** GET /v1/plan: one detail page. */
export function parsePlanPage(body: string) {
  const v: unknown = JSON.parse(body);
  check(isRec(v), 'Plan reply is not an object.');
  const plan = parseSummary(v.plan);
  return {
    envelope: parseEnvelope(v),
    plan,
    items: page(v.items, (x) => parseItem(x, plan.id), 'Plan items'),
    contributions: page(v.contributions, (x) => parseContribution(x, plan.id), 'Plan contributions'),
    links: (Array.isArray(v.links) ? v.links : []).map((l) => {
      check(isRec(l) && isStr(l.sessionId) && Array.isArray(l.itemIds), `Plan ${plan.id} has an unreadable assignment link.`);
      return { sessionId: l.sessionId, itemIds: l.itemIds.filter(isStr) };
    }),
    timing: parseTiming(v.timing),
  };
}

/** GET /v1/document: one text page. */
export function parseDocumentPage(body: string) {
  const v: unknown = JSON.parse(body);
  check(isRec(v), 'Document reply is not an object.');
  const envelope = parseEnvelope(v);
  check(v.text === null || isStr(v.text), 'Document reply has unreadable text.');
  check(v.nextCursor === null || isStr(v.nextCursor), 'Document reply has an invalid cursor.');
  return { envelope, document: parseDocumentRef(v.document), text: v.text as string | null, nextCursor: isStr(v.nextCursor) && v.nextCursor ? v.nextCursor : null, historical: envelope.diagnostics.includes('historical-capture') };
}

/** GET /v1/history */
export function parseHistoryPage(body: string) {
  const v: unknown = JSON.parse(body);
  check(isRec(v), 'History reply is not an object.');
  return {
    envelope: parseEnvelope(v),
    ...page(v, (x): HistoryEntry => {
      check(isRec(x) && isInt(x.revision) && isStr(x.reportedAt), 'History has an unreadable revision.');
      return { revision: x.revision, structuralRevision: isInt(x.structuralRevision) ? x.structuralRevision : x.revision, lifecycle: LIFECYCLES[String(x.lifecycle)] ?? 'active', reportedAt: x.reportedAt };
    }, 'History'),
  };
}

/** GET /v1/setup and POST /v1/setup/<action> replies. */
export function parseSetup(body: string): SetupView {
  const v: unknown = JSON.parse(body);
  check(isRec(v) && typeof v.configured === 'boolean' && typeof v.installed === 'boolean' && v.separateLifecycle === true, 'Setup reply is unreadable.');
  const t = isRec(v.targets) && isStr(v.targets.configRoot) && isStr(v.targets.dataRoot) && isStr(v.targets.storeRoot)
    ? { configRoot: v.targets.configRoot, dataRoot: v.targets.dataRoot, storeRoot: v.targets.storeRoot } : null;
  const r = isRec(v.recovery) ? v.recovery : null;
  // Prefill hints are advisory: a malformed field reads as unknown, never as a failed setup reply,
  // and a configured reply's hints are ignored (configured targets take precedence).
  const hint = (x: unknown) => (isRec(x) && isStr(x.value) && x.value.length > 0 && x.value.length <= 4096 && (x.state === 'resolved' || x.state === 'candidate') ? { value: x.value, state: x.state } as const : null);
  const s = !v.configured && isRec(v.suggestions) ? v.suggestions : null;
  // The bundled-companion comparison is a claim, so anything doubtful reads as no comparison: a
  // malformed object, or one on a reply that is not configured, verified and installed with a version.
  const u = isRec(v.update) ? v.update : null;
  const semver = (x: unknown): x is string => isStr(x) && /^[0-9A-Za-z.+-]{1,64}$/.test(x);
  const update = u && v.configured && v.verified === true && v.installed && optStr(v.version)
    && (u.state === 'current' || u.state === 'available' || u.state === 'newer-installed') && semver(u.candidateVersion)
    ? { state: u.state, candidateVersion: u.candidateVersion, rootVersion: semver(u.rootVersion) ? u.rootVersion : null } as const : null;
  return {
    configured: v.configured, verified: v.verified === true, installed: v.installed,
    captureEnabled: typeof v.captureEnabled === 'boolean' ? v.captureEnabled : null,
    targets: t, version: optStr(v.version) ?? null, activation: String(v.activation ?? 'unknown'),
    historyRetained: v.historyRetained === true, diagnostics: Array.isArray(v.diagnostics) ? v.diagnostics.filter(isStr) : [],
    recovery: r ? { stagedPackages: Number(r.stagedPackages) || 0, stagedActivations: Number(r.stagedActivations) || 0, stagedReleases: Number(r.stagedReleases) || 0 } : null,
    action: optStr(v.action),
    ...(s ? { suggestions: { configRoot: hint(s.configRoot), dataRoot: hint(s.dataRoot), storeRoot: hint(s.storeRoot) } } : {}),
    ...(update ? { update } : {}),
  };
}

const STRICT_SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const DIAGNOSTICS: readonly OfficialMainView['diagnostic'][] = ['ok', 'unavailable', 'rate-limited', 'invalid-manifest', 'invalid-response', 'redirect', 'too-large', 'timeout', 'shutdown'];
const isTime = (v: unknown): v is string => isStr(v) && !Number.isNaN(Date.parse(v));

/**
 * GET /v1/extension-update. Every field must match the frozen meaning, including the fixed
 * official repository and branch, and the states must agree with each other (an availability
 * names a candidate; unknown has neither candidate nor last success). Anything else throws; the
 * caller treats that as unknown, never as "up to date".
 */
export function parseExtensionUpdate(body: string): OfficialMainView {
  const v: unknown = JSON.parse(body);
  check(isRec(v), 'Update reply is not an object.');
  const semver = (x: unknown): x is string => isStr(x) && x.length <= 64 && STRICT_SEMVER.test(x);
  check(semver(v.installedVersion) && v.repository === 'Phototonic/openchamber-progress' && v.ref === 'main', 'Update reply names another extension or source.');
  check(v.state === 'available' || v.state === 'not-newer' || v.state === 'unknown', 'Update reply has an unknown state.');
  check((v.checkedAt === null || isTime(v.checkedAt)) && typeof v.stale === 'boolean' && isTime(v.nextCheckAt), 'Update reply has unreadable times.');
  check(v.candidateVersion === undefined || semver(v.candidateVersion), 'Update reply has an unreadable version.');
  check(DIAGNOSTICS.includes(v.diagnostic as OfficialMainView['diagnostic']), 'Update reply has an unknown diagnostic.');
  if (v.state === 'available') check(v.candidateVersion !== undefined && v.checkedAt !== null, 'Update reply announces no version.');
  if (v.state === 'not-newer') check(v.checkedAt !== null, 'Update reply has no successful check.');
  if (v.state === 'unknown') check(v.candidateVersion === undefined && v.checkedAt === null && v.stale === false, 'Update reply contradicts itself.');
  return {
    installedVersion: v.installedVersion, state: v.state, checkedAt: v.checkedAt as string | null, stale: v.stale,
    ...(v.candidateVersion !== undefined ? { candidateVersion: v.candidateVersion as string } : {}),
    diagnostic: v.diagnostic as OfficialMainView['diagnostic'], nextCheckAt: v.nextCheckAt as string,
  };
}

/** Setup request body: only these keys, all three roots or none (docs/contracts.md). */
export function setupBody(targets: { configRoot: string; dataRoot: string; storeRoot: string } | null, confirmed: boolean) {
  return JSON.stringify({ ...(targets ? { configRoot: targets.configRoot, dataRoot: targets.dataRoot, storeRoot: targets.storeRoot } : {}), ...(confirmed ? { confirmed: true } : {}) });
}

export type CleanupAction = 'archive' | 'restore' | 'delete';
export interface CleanupRequest { storeId: string; source: string; plan: string; rev: number; cleanupRev: number; oid: string }
export function cleanupBody(request: CleanupRequest, action: CleanupAction) {
  const { storeId, source, plan, rev, cleanupRev, oid } = request;
  return JSON.stringify({ storeId, source, plan, rev, cleanupRev, oid, ...(action === 'delete' ? { confirmed: true } : {}) });
}
export function parseCleanupReceipt(body: string, request: CleanupRequest, action: CleanupAction) {
  const v: unknown = JSON.parse(body);
  const state = action === 'archive' ? 'archived' : action === 'restore' ? 'visible' : 'deleted';
  check(isRec(v) && v.storeId === request.storeId && v.source === request.source && v.plan === request.plan && v.oid === request.oid && isRec(v.cleanup) && v.cleanup.state === state && v.cleanup.revision === request.cleanupRev + 1, 'The cleanup receipt does not match this action.');
  return { state, revision: request.cleanupRev + 1 };
}
