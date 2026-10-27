// Reads through the host proxy. The guest never sees the service port or bearer.
import type { GuestRequest, GuestRequestResult } from '@openchamber/sdk';
import {
  ContractError, errorCode, parseDocumentPage, parseExtensionUpdate, parseHealth, parseHistoryPage, parsePlanPage, parsePlansPage, parseSetup, query, ROUTES, setupBody,
  cleanupBody, parseCleanupReceipt, type CleanupAction, type CleanupRequest, type EnvelopeView, type SetupAction,
} from './adapter.ts';
import type { ContributionView, DocumentBody, HealthView, HistoryEntry, ItemView, OfficialMainView, PlanDetail, PlanView, SetupTargets, SetupView, StoreRead } from './model.ts';

export interface ServiceHost {
  serviceRequest(request: GuestRequest): Promise<GuestRequestResult>;
}

export type FailureKind = 'not-approved' | 'paused' | 'disconnected' | 'unavailable' | 'busy' | 'damaged' | 'incompatible' | 'invalid' | 'not-found' | 'setup-lost';
export interface ReadFailure { kind: FailureKind; code: string; message: string }

/** Bounds per refresh; beyond them the read says it is partial instead of guessing. */
export const MAX_LIST_PAGES = 10;
export const MAX_DETAIL_PAGES = 120;
export const MAX_DETAIL_RESTARTS = 3;
export const MAX_DOCUMENT_PAGES = 32;
export const LIST_LIMIT = 50;

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

class HttpError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(status: number, code: string) { super(`The progress service answered ${code} (HTTP ${status}).`); this.status = status; this.code = code; }
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
  if (code === 'NO_SERVICE' || code === 'NOT_GRANTED') return { kind: 'not-approved', code, message };
  if (code === 'DISABLED') return { kind: 'paused', code, message };
  if (code === 'HOST_UNAVAILABLE' || code === 'DISCONNECTED' || code === 'HOST_TIMEOUT') return { kind: 'disconnected', code, message };
  if (code === 'RESPONSE_TOO_LARGE') return { kind: 'invalid', code, message };
  return { kind: 'unavailable', code, message };
}

async function call(host: ServiceHost, path: string, q?: Record<string, string>, method: 'GET' | 'POST' = 'GET', body?: string) {
  const result = await host.serviceRequest({ method, path, ...(q ? { query: q } : {}), ...(body !== undefined ? { body } : {}) });
  if (result.status !== 200) throw new HttpError(result.status, errorCode(result.body) ?? `http-${result.status}`);
  return result.body;
}

export interface ListScope { session?: string | null; directory?: string | null; archived?: 'exclude' | 'only' }

export type ListResult =
  | { ok: true; health: HealthView; read: StoreRead }
  | { ok: true; health: HealthView; read: null } // service up, not configured: a setup state, not an empty success
  | { ok: false; failure: ReadFailure };

const toRead = (e: EnvelopeView, plans: PlanView[], truncated: boolean): StoreRead => ({
  storeId: e.storeId, sources: e.sources, binding: e.binding, captureEnabled: e.captureEnabled, coverage: e.coverage, diagnostics: e.diagnostics, plans, truncated,
});

/** Null checks health only; {} deliberately reads the unfiltered history board. */
export async function readList(host: ServiceHost, scope: ListScope | null, maxPages = MAX_LIST_PAGES): Promise<ListResult> {
  try {
    const health = parseHealth(await call(host, ROUTES.health));
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

export type DetailResult = { ok: true; plan: PlanView; detail: PlanDetail; restarts: number } | { ok: false; failure: ReadFailure };

/** Store, source binding and requested plan of one detail page; every page of a read must agree. */
const pageIdentity = (page: ReturnType<typeof parsePlanPage>) => JSON.stringify([page.envelope.storeId, page.envelope.binding.sourceId, page.envelope.binding.verified, page.plan.sourceId, page.plan.id]);

/**
 * Full selected-plan detail. Items and contributions page with one cursor (each nested
 * nextCursor is passed back verbatim; stop when both are null). If the plan revision
 * changes between pages, the read restarts rather than mixing revisions. A page from another
 * store, source binding or plan is refused, even at the same revision: never a joined detail.
 */
export async function readDetail(host: ServiceHost, plan: Pick<PlanView, 'sourceId' | 'id'>, mono: () => number = () => performance.now()): Promise<DetailResult> {
  try {
    for (let restarts = 0; restarts <= MAX_DETAIL_RESTARTS; restarts++) {
      const first = parsePlanPage(await call(host, ROUTES.plan, query({ source: plan.sourceId, plan: plan.id })));
      if (first.plan.sourceId !== plan.sourceId || first.plan.id !== plan.id) throw new ContractError('The progress service answered for another plan.');
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
        if (next.plan.revision !== first.plan.revision) { mixed = true; break; }
        if (itemsNext) items.push(...next.items.data);
        if (contribNext) contributions.push(...next.contributions.data);
        itemsNext = itemsNext ? next.items.nextCursor : null;
        contribNext = contribNext ? next.contributions.nextCursor : null;
      }
      if (mixed) continue;
      if (itemsNext || contribNext) throw new ContractError('The plan has more pages than this view reads at once.');
      const timing = first.timing && Object.fromEntries(Object.entries(first.timing.items).map(([id, t]) => [id, { ...t, receivedAt }]));
      return { ok: true, plan: first.plan, restarts, detail: { key: first.plan.key, revision: first.plan.revision, items, contributions, links: first.links, ...(timing ? { timing } : {}) } };
    }
    throw new ContractError('The plan kept changing while it was read.');
  } catch (error) {
    return { ok: false, failure: classify(error) };
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

export type SetupResult = { ok: true; setup: SetupView } | { ok: false; code: string; failure?: ReadFailure };

/** GET /v1/setup (action null) or POST /v1/setup/<action> with only roots/confirmed. */
export async function setupCall(host: ServiceHost, action: SetupAction | null, targets: SetupTargets | null = null, confirmed = false): Promise<SetupResult> {
  try {
    const body = action ? await call(host, `${ROUTES.setup}/${action}`, undefined, 'POST', setupBody(targets, confirmed)) : await call(host, ROUTES.setup);
    return { ok: true, setup: parseSetup(body) };
  } catch (error) {
    if (error instanceof HttpError) return { ok: false, code: error.code };
    const failure = classify(error);
    return { ok: false, code: failure.code, failure };
  }
}

/**
 * What official main advertises, or null when that is unknown: an older service without the route
 * (404), a failed request or an unreadable reply. Never a progress or setup failure.
 */
export async function readExtensionUpdate(host: ServiceHost): Promise<OfficialMainView | null> {
  try { return parseExtensionUpdate(await call(host, ROUTES.extensionUpdate)); } catch { return null; }
}
