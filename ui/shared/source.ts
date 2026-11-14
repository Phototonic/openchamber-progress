// Reads through the host proxy. The guest never sees the service port or bearer.
import type { GuestRequest, GuestRequestResult } from '@openchamber/sdk';
import type { DetailSnapshot as SharedDetailSnapshot, DetailFailureCause } from '../../shared/summary-types.ts';
export type { DetailFailureCause } from '../../shared/summary-types.ts';
import { planGraphQuery, parsePlanGraph } from './adapter.ts';
import type { PlanGraphRequest, PlanGraphRead } from './model.ts';
import type { CaptureRequest, CaptureIndex, CaptureComparison } from '../../shared/document-comparison.ts';
import { CAPTURE_ROUTES, captureQuery, parseCaptureIndex, parseCaptureComparison, parseRunRead, reconcileBody, dismissLossBody, parseDismissLossReply, RUN_ROUTES, runQuery } from './adapter.ts';
import type { DismissLossRequest, DismissLossReply, ReconcileRequest, RunRead, RunRequest } from '../../shared/subagent-runs.ts';
import {
  ContractError, errorCode, parseLastAction, parseDocumentPage, parseHealth, parseHistoryPage, parsePlanPage, parsePlansPage, parseSetup, query, ROUTES, setupBody,
  cleanupBody, parseCleanupReceipt, type CleanupAction, type CleanupRequest, type EnvelopeView, type SetupAction,
  digestQuery, parseChangeDigest, parseSearchState, parseSearchWindow, searchQuery, searchStateQuery,
} from './adapter.ts';
import type { DigestRequest, DigestView, ContributionView, DocumentBody, HealthView, HistoryEntry, ItemView, PlanDetail, PlanView, SearchKeyView, SearchRequest, SearchStateView, SearchWindowView, SetupTargets, SetupView, StoreRead } from './model.ts';

export interface ServiceHost {
  serviceRequest(request: GuestRequest): Promise<GuestRequestResult>;
}

export type FailureKind = 'not-approved' | 'paused' | 'disconnected' | 'unavailable' | 'busy' | 'damaged' | 'incompatible' | 'invalid' | 'not-found' | 'setup-lost';
export interface ReadFailure { kind: FailureKind; code: string; message: string }
/** A retired search read supplies neither freshness authority nor capture metadata. */
export type FreshnessResult = { state: 'fresh'; captureEnabled: boolean } | { state: 'retired' } | { state: 'failed'; failure: ReadFailure; identity: boolean };

/** Bounds per refresh; beyond them the read says it is partial instead of guessing. */
export const MAX_LIST_PAGES = 10;
export const MAX_DETAIL_PAGES = 120;
export const MAX_DETAIL_RESTARTS = 3;
export const MAX_DOCUMENT_PAGES = 32;
export const LIST_LIMIT = 50;

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

class HttpError extends Error {
  readonly lastAction?: SetupView['lastAction'];
  readonly code: string;
  readonly status: number;
  constructor(status: number, code: string, body?: string) { super(`The progress service answered ${code} (HTTP ${status}).`); this.status = status; this.code = code; this.lastAction = body ? parseLastAction(body) : undefined; }
}

export function classify(error: unknown): ReadFailure {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof ContractError) return { kind: error.incompatible ? 'incompatible' : 'invalid', code: 'CONTRACT', message };
  if (error instanceof SyntaxError) return { kind: 'invalid', code: 'NOT_JSON', message };
  const code = isRec(error) && typeof error.code === 'string' ? error.code : 'UNKNOWN';
  if (error instanceof HttpError) {
    if (code === 'corrupt') return { kind: 'damaged', code, message };
    if (code === 'schema') return { kind: 'incompatible', code, message };
    if (code === 'busy') return { kind: 'busy', code, message };
    if (code === 'not-found') return { kind: 'not-found', code, message };
    if (code === 'response-too-large' || code === 'invalid') return { kind: 'invalid', code, message };
    return { kind: 'unavailable', code, message };
  }
  // NO_SERVICE means no service entry (not running, or grant state not independently known), so it
  // reads as an outage below; only NOT_GRANTED is a real missing grant worth the permission remedy.
  if (code === 'NOT_GRANTED') return { kind: 'not-approved', code, message };
  if (code === 'DISABLED') return { kind: 'paused', code, message };
  if (code === 'HOST_UNAVAILABLE' || code === 'DISCONNECTED' || code === 'HOST_TIMEOUT') return { kind: 'disconnected', code, message };
  if (code === 'RESPONSE_TOO_LARGE') return { kind: 'invalid', code, message };
  return { kind: 'unavailable', code, message };
}

async function call(host: ServiceHost, path: string, q?: Record<string, string>, method: 'GET' | 'POST' = 'GET', body?: string) {
  const result = await host.serviceRequest({ method, path, ...(q ? { query: q } : {}), ...(body !== undefined ? { body } : {}) });
  if (result.status !== 200) throw new HttpError(result.status, errorCode(result.body) ?? `http-${result.status}`, result.body);
  return result.body;
}

export interface ListScope { session?: string | null; directory?: string | null; archived?: 'exclude' | 'only' }

export type ListResult =
  | { ok: true; health: ReturnType<typeof parseHealth>; read: StoreRead }
  | { ok: true; health: ReturnType<typeof parseHealth>; read: null } // service up, not configured: a setup state, not an empty success
  | { ok: false; failure: ReadFailure };

const toRead = (e: EnvelopeView, plans: PlanView[], truncated: boolean): StoreRead => ({
  storeId: e.storeId, sources: e.sources, binding: e.binding, captureEnabled: e.captureEnabled, coverage: e.coverage, diagnostics: e.diagnostics, plans, truncated,
});

/** Null checks availability without plans; {} deliberately reads the unfiltered history board. */
export async function readList(host: ServiceHost, scope: ListScope | null, maxPages = MAX_LIST_PAGES): Promise<ListResult> {
  try {
    let health = parseHealth(await call(host, ROUTES.health));
    if (!health.ready && (health.state === 'starting' || health.state === 'refused')) {
      // New services separate host liveness from data admission. One explicit
      // Setup read validates/retries; polling health alone cannot do that work.
      // Old services omit state and retain their existing request sequence.
      await call(host, ROUTES.setup);
      health = parseHealth(await call(host, ROUTES.health));
    }
    if (!health.ready) {
      // A configured store that cannot open — or fails binding verification — reports its
      // fixed failure code in health diagnostics. That is a classified failure on every
      // surface, never a setup or empty success; genuinely unconfigured services report
      // setup-flow codes ('targets-unverified' and friends) and keep the null-read path.
      const failed = health.state === 'refused' ? health.diagnostics[0] ?? 'storage'
        : health.diagnostics.find(code => code === 'corrupt' || code === 'schema' || code === 'busy' || code === 'storage' || code === 'binding');
      if (failed) {
        const failure = classify(new HttpError(503, failed));
        return { ok: false, failure: { ...failure, message: failed === 'binding' ? 'The progress service reports its configured store does not match this installation.' : `The progress service reports its store as ${failed}.` } };
      }
    }
    if (!health.ready || scope === null) return { ok: true, health, read: null };
    // An older service cannot establish an empty archive; never send it the new query.
    if (scope.archived === 'only' && !health.planCleanup) return { ok: true, health, read: null };
    const base = { limit: LIST_LIMIT, session: scope.session ?? null, directory: scope.session ? null : scope.directory ?? null, archived: health.planCleanup ? scope.archived ?? 'exclude' : null };
    const first = parsePlansPage(await call(host, ROUTES.plans, query(base)));
    const plans = [...first.data];
    let cursor = first.nextCursor;
    for (let pages = 1; cursor && pages < maxPages; pages++) {
      const next = parsePlansPage(await call(host, ROUTES.plans, query({ ...base, cursor })));
      if (next.envelope.storeId !== first.envelope.storeId) throw new ContractError('The progress store changed while reading pages.');
      if (next.envelope.binding.sourceId !== first.envelope.binding.sourceId || next.envelope.binding.verified !== first.envelope.binding.verified) throw new ContractError('The progress binding changed while reading pages.');
      const verification = (e: EnvelopeView) => JSON.stringify(e.sources.map(s => [s.id, s.verified]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
      if (verification(next.envelope) !== verification(first.envelope)) throw new ContractError('Recorded source verification changed while reading pages.');
      // Offset paging may see newer revisions; keep the newest copy of each plan.
      for (const p of next.data) {
        const at = plans.findIndex((x) => x.key === p.key);
        if (at < 0) plans.push(p); else if (plans[at].revision < p.revision || (plans[at].cleanup?.revision ?? 0) < (p.cleanup?.revision ?? 0)) plans[at] = p;
      }
      cursor = next.nextCursor;
    }
    return { ok: true, health, read: toRead(first.envelope, plans, Boolean(cursor)) };
  } catch (error) {
    return { ok: false, failure: classify(error) };
  }
}

export async function cleanupCall(host: ServiceHost, action: CleanupAction, request: CleanupRequest): Promise<{ ok: true } | { ok: false; failure: ReadFailure }> {
  try {
    const body = await call(host, `${ROUTES.plan}/${action}`, undefined, 'POST', cleanupBody(request, action));
    parseCleanupReceipt(body, request, action);
    return { ok: true };
  } catch (error) { return { ok: false, failure: classify(error) }; }
}

/** First-page facts only. No partial item, report or link arrays are retained here. */
export type DetailSnapshot = SharedDetailSnapshot<PlanView>;
export type CompleteDetailResult = { ok: true; plan: PlanView; detail: PlanDetail; restarts: number; snapshot: DetailSnapshot | null };
export type DetailResult = CompleteDetailResult | { ok: false; failure: ReadFailure; cause: DetailFailureCause; snapshot: DetailSnapshot | null };

class DetailReadError extends ContractError {
  readonly causeKind: 'revision-restarts' | 'page-cap';
  constructor(kind: DetailReadError['causeKind'], message: string) { super(message); this.causeKind = kind; }
}

function detailFailureCause(error: unknown): DetailFailureCause {
  if (error instanceof DetailReadError) return { kind: error.causeKind };
  if (error instanceof ContractError || error instanceof SyntaxError) return { kind: 'identity-contract' };
  if (error instanceof HttpError && error.status === 404 && error.code === 'not-found') return { kind: 'not-found' };
  if (error instanceof HttpError && error.status === 503) {
    const code = error.code;
    return { kind: 'store', code: code === 'unavailable' || code === 'storage' || code === 'binding' || code === 'corrupt' || code === 'schema' || code === 'busy' ? code : 'unknown' };
  }
  if (classify(error).kind === 'invalid' || classify(error).kind === 'incompatible') return { kind: 'identity-contract' };
  return { kind: 'unreachable-auth' };
}

function detailSnapshot(first: ReturnType<typeof parsePlanPage>): DetailSnapshot | null {
  const c = first.plan.counts;
  // Older replies may omit counts. Never manufacture authoritative totals or a timestamp.
  if (!c || Object.values(c).some((n) => n < 0) || c.done + c.remaining !== c.total || Number.isNaN(Date.parse(first.plan.reportedAt))) return null;
  return {
    plan: first.plan as DetailSnapshot['plan'],
    identity: { storeId: first.envelope.storeId, binding: { ...first.envelope.binding }, sourceId: first.plan.sourceId, planId: first.plan.id },
    captureEnabled: first.envelope.captureEnabled, diagnostics: [...first.envelope.diagnostics],
  };
}

/** Store, source binding and requested plan of one detail page; every page of a read must agree. */
const pageIdentity = (page: ReturnType<typeof parsePlanPage>) => JSON.stringify([page.envelope.storeId, page.envelope.binding.sourceId, page.envelope.binding.verified, page.plan.sourceId, page.plan.id]);
/** Cleanup state and generation of one page (absent on older services). */
const cleanupOf = (plan: PlanView) => `${plan.cleanup?.state ?? 'visible'}:${plan.cleanup?.revision ?? 0}`;

/**
 * Full selected-plan detail. Items and contributions page with one cursor (each nested
 * nextCursor is passed back verbatim; stop when both are null). If the plan revision
 * changes between pages, the read restarts rather than mixing revisions. A page from another
 * store, source binding or plan is refused, even at the same revision: never a joined detail.
 */
export async function readDetail(host: ServiceHost, plan: Pick<PlanView, 'sourceId' | 'id'>, mono: () => number = () => performance.now(), expected?: Pick<StoreRead, 'storeId' | 'binding'>): Promise<DetailResult> {
  let snapshot: DetailSnapshot | null = null;
  try {
    for (let restarts = 0; restarts <= MAX_DETAIL_RESTARTS; restarts++) {
      const first = parsePlanPage(await call(host, ROUTES.plan, query({ source: plan.sourceId, plan: plan.id })));
      if (first.plan.sourceId !== plan.sourceId || first.plan.id !== plan.id) throw new ContractError('The progress service answered for another plan.');
      if (expected && (first.envelope.storeId !== expected.storeId || first.envelope.binding.sourceId !== expected.binding.sourceId || first.envelope.binding.verified !== expected.binding.verified
        || !first.envelope.sources.some(s => s.id === plan.sourceId && s.verified))) throw new ContractError('The selected store, binding or recorded source verification changed.');
      snapshot = detailSnapshot(first);
      const identity = pageIdentity(first);
      // Timing covers the whole plan at this revision; anchor it when the reply arrives.
      const receivedAt = mono();
      const items: ItemView[] = [...first.items.data];
      const contributions: ContributionView[] = [...first.contributions.data];
      let itemsNext = first.items.nextCursor;
      let contribNext = first.contributions.nextCursor;
      let mixed = false;
      for (let pages = 1; (itemsNext || contribNext) && pages < MAX_DETAIL_PAGES; pages++) {
        const cursor = itemsNext ?? contribNext!;
        const next = parsePlanPage(await call(host, ROUTES.plan, query({ source: plan.sourceId, plan: plan.id, cursor })));
        if (pageIdentity(next) !== identity) throw new ContractError('The progress store changed while the plan was read.');
        if (expected && !next.envelope.sources.some(s => s.id === plan.sourceId && s.verified)) throw new ContractError('Recorded source verification changed while the plan was read.');
        // A progress revision or cleanup generation change mid-read restarts: never a joined detail.
        if (next.plan.revision !== first.plan.revision || cleanupOf(next.plan) !== cleanupOf(first.plan)) { mixed = true; break; }
        if (itemsNext) items.push(...next.items.data);
        if (contribNext) contributions.push(...next.contributions.data);
        itemsNext = itemsNext ? next.items.nextCursor : null;
        contribNext = contribNext ? next.contributions.nextCursor : null;
      }
      if (mixed) continue;
      if (itemsNext || contribNext) throw new DetailReadError('page-cap', 'The plan has more pages than this view reads at once.');
      const timing = first.timing && Object.fromEntries(Object.entries(first.timing.items).map(([id, t]) => [id, { ...t, receivedAt }]));
      // Same receipt anchor; a cached revisit keeps it, only a new reply supplies a new one.
      const blockedTiming = first.blockedTiming && Object.fromEntries([...first.blockedTiming].map(([id, t]) => [id, { ...t, receivedAt }]));
      return { ok: true, plan: first.plan, restarts, snapshot, detail: { key: first.plan.key, revision: first.plan.revision, items, contributions, links: first.links, ...(timing ? { timing } : {}), ...(blockedTiming ? { blockedTiming } : {}) } };
    }
    throw new DetailReadError('revision-restarts', 'The plan kept changing while it was read.');
  } catch (error) {
    return { ok: false, failure: classify(error), cause: detailFailureCause(error), snapshot };
  }
}

export type DocumentResult = { ok: true; body: DocumentBody } | { ok: false; failure: ReadFailure };

/**
 * On-demand document text. Continuation pages pin the capture ID returned by the first page, so
 * the text is always one capture; if a newer capture lands mid-read, the service answers those
 * pages as historical and the whole body is reported as an earlier capture.
 */
export async function readDocument(host: ServiceHost, plan: Pick<PlanView, 'sourceId' | 'id' | 'key'>): Promise<DocumentResult> {
  try {
    const first = parseDocumentPage(await call(host, ROUTES.document, query({ source: plan.sourceId, plan: plan.id })));
    const captureId = first.document.captureId;
    let text = first.text;
    let cursor = first.nextCursor;
    let historical = first.historical;
    for (let pages = 1; cursor && pages < MAX_DOCUMENT_PAGES; pages++) {
      if (captureId === undefined) throw new ContractError('The document has more pages but no capture to pin them to.');
      const next = parseDocumentPage(await call(host, ROUTES.document, query({ source: plan.sourceId, plan: plan.id, cursor, capture: captureId })));
      text = (text ?? '') + (next.text ?? '');
      historical ||= next.historical;
      cursor = next.nextCursor;
    }
    if (cursor) throw new ContractError('The document is longer than this view reads at once.');
    return { ok: true, body: { key: plan.key, captureId, text, historical, ref: first.document } };
  } catch (error) {
    return { ok: false, failure: classify(error) };
  }
}

export type HistoryResult = { ok: true; entries: HistoryEntry[]; truncated: boolean } | { ok: false; failure: ReadFailure };

export async function readHistory(host: ServiceHost, plan: Pick<PlanView, 'sourceId' | 'id'>, maxPages = 5): Promise<HistoryResult> {
  try {
    const entries: HistoryEntry[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page = parseHistoryPage(await call(host, ROUTES.history, query({ source: plan.sourceId, plan: plan.id, cursor, limit: LIST_LIMIT })));
      entries.push(...page.data);
      cursor = page.nextCursor;
      pages++;
    } while (cursor && pages < maxPages);
    return { ok: true, entries, truncated: Boolean(cursor) };
  } catch (error) {
    return { ok: false, failure: classify(error) };
  }
}

/** `conflict`: store or cleanup generation moved; `not-found`: the plan is missing or deleted. */
export type DigestResult = { ok: true; digest: DigestView } | { ok: false; failure: ReadFailure; status: number | null };

/** One pinned, bounded comparison (GET /v1/change-digest). No continuation, retry or fallback. */
export async function readChangeDigest(host: ServiceHost, request: DigestRequest): Promise<DigestResult> {
  try {
    return { ok: true, digest: parseChangeDigest(await call(host, ROUTES.changeDigest, digestQuery(request)), request) };
  } catch (error) {
    return { ok: false, failure: classify(error), status: error instanceof HttpError ? error.status : null };
  }
}

/** `status` 409 means the store, binding, cursor or a pinned in-plan position moved: refresh, never retry the cursor. */
export type SearchWindowResult = { ok: true; window: SearchWindowView } | { ok: false; failure: ReadFailure; status: number | null };

/** One bounded search window (GET /v1/search). No continuation, retry or fallback here. */
export async function readSearchWindow(host: ServiceHost, request: SearchRequest, expect: Parameters<typeof parseSearchWindow>[2]): Promise<SearchWindowResult> {
  try {
    return { ok: true, window: parseSearchWindow(await call(host, ROUTES.search, searchQuery(request)), request, expect) };
  } catch (error) {
    return { ok: false, failure: classify(error), status: error instanceof HttpError ? error.status : null };
  }
}

export type SearchStateResult = { ok: true; state: SearchStateView } | { ok: false; failure: ReadFailure; status: number | null };

/** Point-lookup freshness of at most 50 displayed keys (GET /v1/search-state). Failure is never "missing". */
export async function readSearchState(host: ServiceHost, storeId: string, keys: SearchKeyView[]): Promise<SearchStateResult> {
  try {
    return { ok: true, state: parseSearchState(await call(host, ROUTES.searchState, searchStateQuery(storeId, keys)), storeId, keys) };
  } catch (error) {
    return { ok: false, failure: classify(error), status: error instanceof HttpError ? error.status : null };
  }
}

export type PlanHeadResult = { ok: true; envelope: EnvelopeView; plan: PlanView } | { ok: false; failure: ReadFailure; status: number | null };

/**
 * Review preflight: the FIRST page of /v1/plan only, validated envelope and plan metadata. Item and
 * contribution cursors are never followed: one bounded live read, not a detail or history download.
 */
export async function readPlanHead(host: ServiceHost, plan: Pick<PlanView, 'sourceId' | 'id'>): Promise<PlanHeadResult> {
  try {
    const first = parsePlanPage(await call(host, ROUTES.plan, query({ source: plan.sourceId, plan: plan.id })));
    if (first.plan.sourceId !== plan.sourceId || first.plan.id !== plan.id) throw new ContractError('The progress service answered for another plan.');
    return { ok: true, envelope: first.envelope, plan: first.plan };
  } catch (error) {
    return { ok: false, failure: classify(error), status: error instanceof HttpError ? error.status : null };
  }
}

export type SetupResult = { ok: true; setup: SetupView } | { ok: false; code: string; failure?: ReadFailure; lastAction?: SetupView['lastAction'] };

/** Managed requests send only storeRoot and reviewed consent; legacy roots remain compatibility-only. */
export async function setupCall(host: ServiceHost, action: SetupAction | null, targets: SetupTargets | null = null, confirmed = false, expected?: string): Promise<SetupResult> {
  try {
    const request = action?.startsWith('managed-') ? JSON.stringify({ ...(targets?.storeRoot ? {storeRoot:targets.storeRoot} : {}), ...(action !== 'managed-inspect' ? {confirmed,expected} : {}) }) : setupBody(targets, confirmed);
    const body = action ? await call(host, `${ROUTES.setup}/${action}`, undefined, 'POST', request) : await call(host, ROUTES.setup);
    return { ok: true, setup: parseSetup(body) };
  } catch (error) {
    if (error instanceof HttpError) return { ok: false, code: error.code, ...(error.lastAction ? {lastAction:error.lastAction} : {}) };
    const failure = classify(error);
    return { ok: false, code: failure.code, failure };
  }
}

export type CaptureRead<T> = { ok: true; value: T } | { ok: false; failure: ReadFailure };
export async function readCaptureIndex(host: ServiceHost, request: CaptureRequest, cursor?: string): Promise<CaptureRead<CaptureIndex>> {
  try { return { ok: true, value: parseCaptureIndex(await call(host, CAPTURE_ROUTES.index, captureQuery(request, { cursor })), request) }; }
  catch (error) { return { ok: false, failure: classify(error) }; }
}
export async function readCaptureComparison(host: ServiceHost, request: CaptureRequest, before: number, after: number): Promise<CaptureRead<CaptureComparison>> {
  try { return { ok: true, value: parseCaptureComparison(await call(host, CAPTURE_ROUTES.comparison, captureQuery(request, { before, after })), request, before, after) }; }
  catch (error) { return { ok: false, failure: classify(error) }; }
}

/** One bounded sub-agent run page; never a census of every child (docs/contracts.md, runs revision 1). */
export async function readRuns(host: ServiceHost, request: RunRequest, cursor?: string): Promise<CaptureRead<RunRead>> {
  try { return { ok: true, value: parseRunRead(await call(host, RUN_ROUTES.read, runQuery(request, cursor)), request) }; }
  catch (error) { return { ok: false, failure: classify(error) }; }
}
/** One explicit store-wide recording-gap acknowledgement, through the same guarded proxy. */
export async function dismissRunLoss(host: ServiceHost, request: DismissLossRequest): Promise<{ ok: true; value: DismissLossReply } | { ok: false; failure: ReadFailure; conflict: boolean }> {
  try { return { ok: true, value: parseDismissLossReply(await call(host, RUN_ROUTES.dismissLoss, undefined, 'POST', dismissLossBody(request)), request) }; }
  catch (error) { return { ok: false, failure: classify(error), conflict: error instanceof HttpError && error.status === 409 }; }
}
/** Asks the companion for one bounded metadata-only history pass; the service coalesces repeats. */
export async function requestReconcile(host: ServiceHost, request: ReconcileRequest): Promise<{ ok: true } | { ok: false; failure: ReadFailure }> {
  try { await call(host, RUN_ROUTES.reconcile, undefined, 'POST', reconcileBody(request)); return { ok: true }; }
  catch (error) { return { ok: false, failure: classify(error) }; }
}
export type PlanGraphResult = { ok: true; graph: PlanGraphRead } | { ok: false; reason: 'unavailable' | 'conflict' | 'not-found' | 'invalid' | 'read-failed'; failure: ReadFailure; status: number | null };

/** One pinned read using already observed capability. No health fetch, retries or fallback. */
export async function readPlanGraph(host: ServiceHost, health: { readonly planGraph?: unknown } | null, expected: Readonly<PlanGraphRequest>): Promise<PlanGraphResult> {
  if (health?.planGraph !== 1) return { ok: false, reason: 'unavailable', failure: { kind: 'unavailable', code: 'GRAPH_UNAVAILABLE', message: 'Plan graph data is unavailable.' }, status: null };
  try {
    // Capture the pin before awaiting the host, even if a caller mutates its own object later.
    const r = { ...expected, binding: { ...expected.binding } };
    const body = await call(host, '/v1/plan-graph', planGraphQuery(r));
    return { ok: true, graph: parsePlanGraph(body, r) };
  } catch (error) {
    const status = error instanceof HttpError ? error.status : null;
    const failure = classify(error);
    return { ok: false, reason: status === 409 ? 'conflict' : status === 404 ? 'not-found' : error instanceof ContractError || failure.kind === 'invalid' || failure.kind === 'incompatible' ? 'invalid' : 'read-failed', failure, status };
  }
}
