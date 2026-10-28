// The only module that knows the service wire format: frozen production contract v2
// (shared/progress.ts, docs/contracts.md). It validates replies and maps them onto the
// view model. Probe v1 is no longer accepted.
import type {
  ContributionView, DigestEvents, DigestFacet, DigestFacts, DigestReason, DigestReference, DigestRequest, DigestTask, DigestView, DocumentRefView, DocumentState, HealthView, HistoryEntry, ItemStatus, ItemView, Lifecycle, OfficialMainView, PlanView, SetupView, SourceView,
  SearchGap, SearchHitView, SearchKeyView, SearchPlanView, SearchRequest, SearchStateView, SearchWindowView,
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
export const ROUTES = { health: '/health', plans: '/v1/plans', plan: '/v1/plan', document: '/v1/document', history: '/v1/history', changeDigest: '/v1/change-digest', search: '/v1/search', searchState: '/v1/search-state', setup: '/v1/setup', extensionUpdate: '/v1/extension-update' } as const;
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
  return { ready: v.ready, sqlite: v.sqlite === true, node: optStr(runtime.node), diagnostics: Array.isArray(v.diagnostics) ? v.diagnostics.filter(isStr) : [], ...(v.planCleanup === 1 ? { planCleanup: 1 as const } : {}), ...(v.planChangeDigests === 1 ? { planChangeDigests: 1 as const } : {}), ...(v.planTaskSearch === 1 ? { planTaskSearch: 1 as const } : {}) };
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

const FACETS: readonly DigestFacet[] = ['added', 'removed', 'revised', 'completed', 'reopened', 'blocked', 'unblocked', 'skipped', 'unskipped'];
const REASONS: readonly DigestReason[] = ['gap', 'missing-snapshot', 'invalid-snapshot', 'revision-bound', 'byte-bound'];
const AVAILABILITY: readonly DigestView['availability'][] = ['initial', 'comparison', 'baseline-unavailable', 'target-unavailable'];
const DIGEST_ROWS = 50;
const DIGEST_REFERENCES = 4;
const isCount = (v: unknown): v is number => isInt(v) && v >= 0;
const isRevision = (v: unknown): v is number => isInt(v) && v >= 1;
const isIso = (v: unknown): v is string => isStr(v) && !Number.isNaN(Date.parse(v));
const lifecycle = (v: unknown) => LIFECYCLES[String(v)];

/** GET /v1/change-digest query: exactly the frozen fields; `after` only for a saved baseline. */
export const digestQuery = (r: DigestRequest) => query({ storeId: r.storeId, source: r.source, plan: r.plan, to: r.to, cleanupRev: r.cleanupRev, after: r.after });

function digestCounts(v: unknown) {
  if (v === null) return null;
  const c = parseCounts(v);
  check(c.done >= 0 && c.total >= 0 && c.remaining >= 0 && c.skipped >= 0 && c.done + c.remaining === c.total, 'A change digest has inconsistent counts.');
  return c;
}
function digestEvents(v: unknown): DigestEvents {
  check(isRec(v) && Object.keys(v).length === FACETS.length && FACETS.every((f) => isCount(v[f])), 'A change digest has unreadable event counts.');
  return Object.fromEntries(FACETS.map((f) => [f, v[f]])) as DigestEvents;
}
function digestFacts(v: unknown): DigestFacts | null {
  if (v === null) return null;
  check(isRec(v) && isStr(v.title) && STATUSES.includes(v.status as ItemStatus) && (v.parentId === null || isStr(v.parentId)) && Array.isArray(v.dependencies) && v.dependencies.every(isStr), 'A change digest has unreadable recorded facts.');
  return { title: v.title, status: v.status as ItemStatus, parentId: v.parentId as string | null, dependencies: [...(v.dependencies as string[])] };
}

/**
 * GET /v1/change-digest. Every request identity field must come back unchanged (store, source,
 * plan, cleanup generation, pinned target and baseline) and each part must agree with its stated
 * availability; anything else throws, so a reply is never borrowed by another context or turned
 * into an empty comparison. Source binding is checked against the current list by the caller.
 */
export function parseChangeDigest(body: string, request: DigestRequest): DigestView {
  const v: unknown = JSON.parse(body);
  check(isRec(v), 'Change digest reply is not an object.');
  versions(v);
  check(v.storeId === request.storeId && v.source === request.source && v.plan === request.plan, 'The change digest answered for another plan or store.');
  const b = v.sourceBinding;
  check(isRec(b) && (b.sourceId === null || isStr(b.sourceId)) && typeof b.verified === 'boolean', 'The change digest has no source binding.');
  const c = v.cleanup;
  check(isRec(c) && (c.state === 'visible' || c.state === 'archived') && c.revision === request.cleanupRev, 'The change digest answered for another cleanup state.');
  const i = v.interval;
  check(isRec(i) && i.to === request.to && i.after === request.after, 'The change digest answered for another interval.');
  check(isRevision(i.latestRevision) && i.latestRevision >= request.to && lifecycle(i.currentLifecycle), 'The change digest has unreadable live metadata.');
  const availability = v.availability as DigestView['availability'];
  check(AVAILABILITY.includes(availability) && typeof v.complete === 'boolean' && typeof v.validTarget === 'boolean', 'The change digest has an unknown availability.');
  check(Array.isArray(v.reasons) && v.reasons.every((r) => REASONS.includes(r as DigestReason)) && new Set(v.reasons).size === v.reasons.length, 'The change digest has unknown qualifications.');
  const counts = v.counts, summary = v.summary, details = v.details, work = v.work;
  check(isRec(counts) && isRec(summary) && summary.unit === 'transitions' && isRec(details) && isRec(work) && Array.isArray(v.tasks), 'The change digest is incomplete.');
  const before = digestCounts(counts.before), after = digestCounts(counts.after);
  const scope = counts.scope === null ? null : (() => {
    const s = counts.scope;
    const keys = ['addedCounted', 'removedCounted', 'skipped', 'unskipped', 'addedDone', 'removedDone', 'completed', 'reopened'] as const;
    check(isRec(s) && keys.every((k) => isCount(s[k])), 'The change digest has unreadable scope counts.');
    return Object.fromEntries(keys.map((k) => [k, s[k]])) as DigestView['counts']['scope'] & object;
  })();
  const events = digestEvents(summary.events);
  const target = availability !== 'target-unavailable';
  check(target === v.validTarget, 'The change digest contradicts its target availability.');
  if (!target) {
    check(i.targetLifecycle === null && i.coverageStart === null && i.coverageEnd === null && !before && !after && !scope && !v.tasks.length && FACETS.every((f) => events[f] === 0) && !v.complete, 'An unavailable target has comparison data.');
  } else {
    check(lifecycle(i.targetLifecycle) && isIso(i.targetReportedAt) && isRevision(i.coverageStart) && i.coverageEnd === request.to && isIso(i.coverageStartReportedAt) && isIso(i.coverageEndReportedAt) && after, 'The change digest has unreadable coverage.');
    check((i.coverageStart as number) >= (request.after ?? request.to) && (i.coverageStart as number) <= request.to, 'The change digest covers revisions outside its interval.');
  }
  if (availability === 'initial') check(request.after === null && v.complete && !before && !scope && !v.tasks.length && FACETS.every((f) => events[f] === 0), 'An initial digest has comparison data.');
  if (availability === 'comparison') check(request.after !== null && !!before && !!scope && (!v.complete || i.coverageStart === request.after), 'A comparison digest is missing its baseline.');
  if (availability === 'baseline-unavailable') check(request.after !== null && !before && !scope && !v.complete, 'A digest without its baseline claims endpoint counts.');
  check(v.tasks.length <= DIGEST_ROWS, 'The change digest has too many task rows.');
  const ids = new Set<string>();
  const low = target ? (i.coverageStart as number) : request.to;
  const tasks = v.tasks.map((t): DigestTask => {
    check(isRec(t) && isStr(t.id) && t.id.length > 0 && !ids.has(t.id) && isStr(t.title) && STATUSES.includes(t.status as ItemStatus) && typeof t.presentAtTarget === 'boolean', 'A change digest task row is unreadable.');
    ids.add(t.id);
    check(isRevision(t.latestRevision) && t.latestRevision > low && t.latestRevision <= request.to && isCount(t.omittedReferences) && Array.isArray(t.references) && t.references.length >= 1 && t.references.length <= DIGEST_REFERENCES, `Change digest task ${t.id} has unreadable references.`);
    const references = t.references.map((r): DigestReference => {
      check(isRec(r) && isRevision(r.from) && r.to === (r.from as number) + 1 && (r.from as number) >= low && (r.to as number) <= request.to && isIso(r.reportedAt) && Array.isArray(r.facets) && r.facets.length > 0 && r.facets.every((f) => FACETS.includes(f as DigestFacet)), `Change digest task ${t.id} has an unreadable recorded change.`);
      const factsBefore = digestFacts(r.before), factsAfter = digestFacts(r.after);
      check(factsBefore || factsAfter, `Change digest task ${t.id} has a recorded change without facts.`);
      return { from: r.from as number, to: r.to as number, reportedAt: r.reportedAt as string, facets: [...r.facets] as DigestFacet[], before: factsBefore, after: factsAfter };
    });
    return { id: t.id, title: t.title, status: t.status as ItemStatus, presentAtTarget: t.presentAtTarget, latestRevision: t.latestRevision, occurrences: digestEvents(t.occurrences), references, omittedReferences: t.omittedReferences };
  });
  check(typeof details.omittedTasks === 'boolean' && (details.omittedTaskCount === null || isCount(details.omittedTaskCount)) && typeof details.truncated === 'boolean', 'The change digest has unreadable detail limits.');
  check(isCount(work.intervalSnapshots) && isCount(work.baselineLookups) && isCount(work.inputBytes), 'The change digest has unreadable work counters.');
  return {
    protocolVersion: 2, schemaVersion: 2, storeId: request.storeId, sourceBinding: { sourceId: b.sourceId as string | null, verified: b.verified as boolean },
    source: request.source, plan: request.plan, cleanup: { state: c.state as 'visible' | 'archived', revision: request.cleanupRev },
    interval: {
      after: request.after, to: request.to, targetLifecycle: target ? lifecycle(i.targetLifecycle) : null, targetReportedAt: target ? i.targetReportedAt as string : null,
      latestRevision: i.latestRevision, currentLifecycle: lifecycle(i.currentLifecycle), coverageStart: target ? i.coverageStart as number : null, coverageEnd: target ? request.to : null,
      coverageStartReportedAt: target ? i.coverageStartReportedAt as string : null, coverageEndReportedAt: target ? i.coverageEndReportedAt as string : null,
    },
    availability, complete: v.complete, reasons: [...v.reasons] as DigestReason[], validTarget: v.validTarget,
    counts: { before, after, scope }, summary: { unit: 'transitions', events }, tasks,
    details: { omittedTasks: details.omittedTasks, omittedTaskCount: details.omittedTaskCount as number | null, truncated: details.truncated },
    work: { intervalSnapshots: work.intervalSnapshots, baselineLookups: work.baselineLookups, inputBytes: work.inputBytes },
  };
}

const WIRE_LIFECYCLE: Record<Lifecycle, string> = { active: 'active', completed: 'finished', cancelled: 'cancelled', failed: 'failed' };
const GAPS: readonly SearchGap[] = ['invalid-snapshot', 'oversized-snapshot', 'invalid-membership', 'oversized-membership'];
const SEARCH_HITS = 50;
const SEARCH_ANCESTORS = 8;
const SEARCH_STATE_KEYS = 50;
const isHash = (v: unknown): v is string => isStr(v) && /^[0-9a-f]{64}$/.test(v);

/** GET /v1/search query: exactly the frozen fields. A continuation repeats every other field unchanged. */
export const searchQuery = (r: SearchRequest) => query({ q: r.q, source: r.source, session: r.session, lifecycle: r.lifecycle ? WIRE_LIFECYCLE[r.lifecycle] : null, status: r.status, archived: r.archived, limit: r.limit, cursor: r.cursor });
/** GET /v1/search-state query: the store this view reads and 1–50 distinct keys. */
export const searchStateQuery = (storeId: string, keys: SearchKeyView[]) => query({ storeId, keys: JSON.stringify(keys.map((k) => ({ source: k.source, plan: k.plan }))) });

function searchIdentity(v: Rec) {
  versions(v);
  check(v.planTaskSearch === 1, 'The search reply has another contract revision.');
  const b = v.sourceBinding;
  check(isStr(v.storeId) && isRec(b) && (b.sourceId === null || isStr(b.sourceId)) && typeof b.verified === 'boolean', 'The search reply has no store identity.');
  return { storeId: v.storeId, binding: { sourceId: b.sourceId as string | null, verified: b.verified as boolean } };
}

function parseSearchPlan(v: unknown): SearchPlanView {
  check(isRec(v) && isStr(v.id) && isStr(v.sourceId) && isStr(v.title) && isStr(v.sessionId), 'A search result has no plan identity.');
  check(isInt(v.revision) && v.revision >= 1 && isInt(v.structuralRevision) && isStr(v.reportedAt) && isStr(v.directory), `Search plan ${v.id} has no revision, time or location.`);
  const lifecycle = LIFECYCLES[String(v.lifecycle)];
  check(lifecycle, `Search plan ${v.id} has an unknown lifecycle.`);
  const c = v.cleanup;
  check(isRec(c) && (c.state === 'visible' || c.state === 'archived') && isInt(c.revision) && c.revision >= 0 && typeof v.sourceVerified === 'boolean', `Search plan ${v.id} has unreadable cleanup or source metadata.`);
  const counts = parseCounts(v.counts);
  check(counts.done >= 0 && counts.remaining >= 0 && counts.skipped >= 0 && counts.done + counts.remaining === counts.total, `Search plan ${v.id} has inconsistent counts.`);
  return {
    key: `${v.sourceId}/${v.id}`, id: v.id, sourceId: v.sourceId, title: v.title, ownerSessionId: v.sessionId,
    revision: v.revision, structuralRevision: v.structuralRevision, lifecycle, reportedAt: v.reportedAt,
    directory: v.directory, projectId: optStr(v.projectId), counts,
    cleanup: { state: c.state as 'visible' | 'archived', revision: c.revision as number }, sourceVerified: v.sourceVerified,
  };
}

function parseSearchHit(v: unknown, r: SearchRequest): SearchHitView {
  check(isRec(v) && typeof v.planMatched === 'boolean' && typeof v.continued === 'boolean' && Array.isArray(v.ancestors) && isCount(v.omittedAncestors), 'A search result is unreadable.');
  const plan = parseSearchPlan(v.plan);
  const t = v.task;
  check(t === null || (isRec(t) && isStr(t.id) && t.id.length > 0 && isStr(t.title) && STATUSES.includes(t.status as ItemStatus)), `Search result in ${plan.id} has an unreadable task.`);
  // A plan-only hit exists only for the plan's own match without a task-status constraint.
  check(t !== null || (v.planMatched && !r.status), `Search result in ${plan.id} is neither a task nor a plan match.`);
  check(v.ancestors.length <= SEARCH_ANCESTORS && v.ancestors.every((a) => isRec(a) && isStr(a.id) && isStr(a.title)), `Search result in ${plan.id} has unreadable context.`);
  const k = v.classified;
  check(k === null || (isRec(k) && k.matchedPlans === 1 && isCount(k.matchingTasks) && !v.continued), `Search result in ${plan.id} has an unreadable count.`);
  // Every chosen backend filter precedes emission; a reply outside them is not this search.
  check((r.archived === 'only') === (plan.cleanup.state === 'archived'), `Search result ${plan.id} is outside the chosen archive mode.`);
  check((!r.source || plan.sourceId === r.source) && (!r.lifecycle || plan.lifecycle === r.lifecycle) && (!r.status || (t as Rec | null)?.status === r.status), `Search result ${plan.id} is outside the chosen filters.`);
  return {
    plan, planMatched: v.planMatched,
    task: t === null ? null : { id: (t as Rec).id as string, title: (t as Rec).title as string, status: (t as Rec).status as ItemStatus },
    ancestors: (v.ancestors as Rec[]).map((a) => ({ id: a.id as string, title: a.title as string })), omittedAncestors: v.omittedAncestors,
    continued: v.continued, classified: k === null ? null : { matchedPlans: 1, matchingTasks: (k as Rec).matchingTasks as number },
  };
}

/**
 * GET /v1/search: one bounded window. `expect` pins a continuation to the traversal that issued its
 * cursor (store, binding, criteria fingerprint); anything else throws, so a window is never joined
 * to another traversal. The window's own counts must equal its per-plan deltas (never totals).
 */
export function parseSearchWindow(body: string, request: SearchRequest, expect: { storeId: string; binding: { sourceId: string | null; verified: boolean }; fingerprint: string | null }): SearchWindowView {
  const v: unknown = JSON.parse(body);
  check(isRec(v), 'Search reply is not an object.');
  const id = searchIdentity(v);
  check(id.storeId === expect.storeId && id.binding.sourceId === expect.binding.sourceId && id.binding.verified === expect.binding.verified, 'The search answered for another store or binding.');
  check(isHash(v.fingerprint) && (expect.fingerprint === null || v.fingerprint === expect.fingerprint), 'The search answered for other criteria.');
  check(Array.isArray(v.hits) && v.hits.length <= Math.min(request.limit, SEARCH_HITS), 'The search reply has too many results.');
  const hits = v.hits.map((h) => parseSearchHit(h, request));
  const counts = v.counts;
  check(isRec(counts) && isCount(counts.matchedPlans) && isCount(counts.matchingTasks), 'The search reply has unreadable counts.');
  const sum = hits.reduce((s, h) => (h.classified ? { plans: s.plans + 1, tasks: s.tasks + h.classified.matchingTasks } : s), { plans: 0, tasks: 0 });
  check(sum.plans === counts.matchedPlans && sum.tasks === counts.matchingTasks, 'The search reply counts disagree with its results.');
  check((v.nextCursor === null || (isStr(v.nextCursor) && v.nextCursor.length > 0 && v.nextCursor.length <= 4096)) && typeof v.exhausted === 'boolean' && v.exhausted === (v.nextCursor === null), 'The search reply has an unreadable continuation.');
  const c = v.coverage;
  check(isRec(c) && c.kind === 'recorded-current' && c.asSearched === true && typeof c.gapped === 'boolean' && isCount(c.skippedRecords) && Array.isArray(c.reasons) && c.reasons.every((r) => GAPS.includes(r as SearchGap)), 'The search reply has unreadable coverage.');
  check(c.gapped || c.skippedRecords === 0, 'The search reply skipped records without a gap.');
  check(isRec(v.work), 'The search reply has no work counters.');
  return { ...id, fingerprint: v.fingerprint, hits, nextCursor: v.nextCursor as string | null, exhausted: v.exhausted, coverage: { gapped: c.gapped, skippedRecords: c.skippedRecords, reasons: [...new Set(c.reasons as SearchGap[])] } };
}

/** GET /v1/search-state: exactly the requested keys, in order, for the requested store. */
export function parseSearchState(body: string, storeId: string, keys: SearchKeyView[]): SearchStateView {
  const v: unknown = JSON.parse(body);
  check(isRec(v), 'Search freshness reply is not an object.');
  const id = searchIdentity(v);
  check(id.storeId === storeId, 'The search freshness read answered for another store.');
  check(keys.length >= 1 && keys.length <= SEARCH_STATE_KEYS && Array.isArray(v.data) && v.data.length === keys.length, 'The search freshness read answered for other plans.');
  const data = v.data.map((row, i) => {
    const c = isRec(row) ? row.cleanup : null;
    check(isRec(row) && row.source === keys[i].source && row.plan === keys[i].plan && typeof row.exists === 'boolean', 'The search freshness read answered for other plans.');
    check(isRec(c) && (c.state === 'visible' || c.state === 'archived' || c.state === 'deleted') && isCount(c.revision), 'The search freshness read has unreadable cleanup metadata.');
    check(row.exists ? isRevision(row.revision) && c.state !== 'deleted' : row.revision === null || isRevision(row.revision), 'The search freshness read has an unreadable revision.');
    return { source: keys[i].source, plan: keys[i].plan, exists: row.exists, revision: row.revision as number | null, cleanup: { state: c.state as 'visible' | 'archived' | 'deleted', revision: c.revision as number } };
  });
  return { ...id, data };
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
