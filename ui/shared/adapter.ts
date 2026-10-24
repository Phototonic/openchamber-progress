// The only module that knows the service wire format: frozen production contract v2
// (shared/progress.ts, docs/contracts.md). It validates replies and maps them onto the
// view model. Probe v1 is no longer accepted.
import type {
  ContributionView, DocumentRefView, DocumentState, HealthView, HistoryEntry, ItemStatus, ItemView, Lifecycle, PlanView, SetupView, SourceView,
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
export const ROUTES = { health: '/health', plans: '/v1/plans', plan: '/v1/plan', document: '/v1/document', history: '/v1/history', setup: '/v1/setup' } as const;
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
  return { ready: v.ready, sqlite: v.sqlite === true, node: optStr(runtime.node), diagnostics: Array.isArray(v.diagnostics) ? v.diagnostics.filter(isStr) : [] };
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
  return {
    key: `${v.sourceId}/${v.id}`, id: v.id, sourceId: v.sourceId, title: v.title, ownerSessionId: v.sessionId,
    revision: v.revision, structuralRevision: v.structuralRevision, lifecycle, reportedAt: v.reportedAt,
    directory: v.directory, projectId: optStr(v.projectId),
    counts: v.counts === undefined ? null : parseCounts(v.counts),
    working: Array.isArray(v.working) ? v.working.filter(isStr) : [],
    document: parseDocumentRef(v.document),
  };
}

function parseItem(v: unknown, planId: string): ItemView {
  check(isRec(v) && isStr(v.id) && isStr(v.title), `Plan ${planId} has an item without an id or title.`);
  check(v.kind === 'group' || v.kind === 'task', `Item ${v.id} has an unknown kind.`);
  check(STATUSES.includes(v.status as ItemStatus), `Item ${v.id} has an unknown status.`);
  return {
    id: v.id, title: v.title, kind: v.kind, status: v.status as ItemStatus, parentId: optStr(v.parentId),
    dependencies: Array.isArray(v.dependencies) ? v.dependencies.filter(isStr) : undefined,
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
  return {
    configured: v.configured, verified: v.verified === true, installed: v.installed,
    captureEnabled: typeof v.captureEnabled === 'boolean' ? v.captureEnabled : null,
    targets: t, version: optStr(v.version) ?? null, activation: String(v.activation ?? 'unknown'),
    historyRetained: v.historyRetained === true, diagnostics: Array.isArray(v.diagnostics) ? v.diagnostics.filter(isStr) : [],
    recovery: r ? { stagedPackages: Number(r.stagedPackages) || 0, stagedActivations: Number(r.stagedActivations) || 0, stagedReleases: Number(r.stagedReleases) || 0 } : null,
    action: optStr(v.action),
    ...(s ? { suggestions: { configRoot: hint(s.configRoot), dataRoot: hint(s.dataRoot), storeRoot: hint(s.storeRoot) } } : {}),
  };
}

/** Setup request body: only these keys, all three roots or none (docs/contracts.md). */
export function setupBody(targets: { configRoot: string; dataRoot: string; storeRoot: string } | null, confirmed: boolean) {
  return JSON.stringify({ ...(targets ? { configRoot: targets.configRoot, dataRoot: targets.dataRoot, storeRoot: targets.storeRoot } : {}), ...(confirmed ? { confirmed: true } : {}) });
}
