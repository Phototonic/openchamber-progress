// Setup client for the bounded managed step protocol (setup/managed-steps.md): wire version 1 for
// migration and the separately negotiated wire version 2 for fresh setup. Strict reply parsing, one
// request at a time, and an explicit user action for every start. The service owns authority,
// freshness, sequence and idempotency; this module never infers them.
import {
  MANAGED_FRESH_INSPECTION_STEPS, MANAGED_FRESH_STEPS, MANAGED_INSPECTION_STEPS, MANAGED_MIGRATION_STEPS, MANAGED_STEP_CODES, MANAGED_STEP_LIMITS,
  MANAGED_STEP_ROUTE, managedFreshPlan, managedFreshStepRequest, managedStepRequest,
  type ManagedCaptureObservation, type ManagedFreshCapturePolicy, type ManagedFreshInspection, type ManagedFreshSourceMode, type ManagedFreshStep,
  type ManagedFreshStepDiagnostic, type ManagedFreshStepProgress, type ManagedFreshStepRef, type ManagedFreshStepRequest, type ManagedFreshStepResponse, type ManagedFreshStoreMode,
  type ManagedInspection, type ManagedInspectionStep, type ManagedMigrationStep, type ManagedSetupStepProgress, type ManagedSetupStepRequest,
  type ManagedSetupStepResponse, type ManagedStepDiagnostic, type ManagedStepProgress, type ManagedStepRef, type ManagedStepRequest, type ManagedStepResponse,
} from '../../shared/managed-steps.ts';
import { MANAGED_ACTION_CODES, type ManagedFreshReview, type ManagedReview } from '../../shared/progress.ts';
import type { ServiceHost } from './source.ts';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
/** Exactly these keys: no missing and no additional field is coerced or dropped. */
const exact = (v: Rec, keys: readonly string[]) => Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const bytes = (s: string) => new TextEncoder().encode(s).length;
const count = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const text = (v: unknown, max: number): v is string => typeof v === 'string' && v.length > 0 && !v.includes('\0') && bytes(v) <= max;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9_.:-]{1,80}$/;
const VERSION = /^[0-9A-Za-z.+-]{1,64}$/;
const REMOVAL: readonly string[] = ['remove-selector', 'remove-discovery'];
const STAGES: readonly string[] = [...MANAGED_MIGRATION_STEPS, ...MANAGED_INSPECTION_STEPS, 'journal', 'lock'];
const FRESH_STAGES: readonly string[] = [...MANAGED_FRESH_STEPS, ...MANAGED_INSPECTION_STEPS, 'journal', 'lock'];
const CODES: readonly string[] = [...MANAGED_STEP_CODES, ...MANAGED_ACTION_CODES];
/** Read-only inspection pages followed for one explicit request before stopping honestly. */
export const MAX_INSPECTION_PAGES = 32;

/** Which negotiated step family a progress, review or request belongs to. Never translated. */
export type StepFamily = 'migration' | 'fresh';
export const isFreshProgress = (p: ManagedSetupStepProgress | null | undefined): p is ManagedFreshStepProgress => !!p && 'planKind' in p;
export const isFreshReview = (r: ManagedReview | ManagedFreshReview): r is ManagedFreshReview => 'planKind' in r;
export const progressFamily = (p: ManagedSetupStepProgress): StepFamily => isFreshProgress(p) ? 'fresh' : 'migration';

function stepRef(v: unknown): ManagedStepRef | undefined {
  if (!isRec(v) || !exact(v, ['name', 'batch']) || !MANAGED_MIGRATION_STEPS.includes(v.name as ManagedMigrationStep) || !count(v.batch)) return;
  if (!REMOVAL.includes(v.name as string) && v.batch !== 0) return;
  return { name: v.name as ManagedMigrationStep, batch: v.batch };
}
function freshStepRef(v: unknown): ManagedFreshStepRef | undefined {
  if (!isRec(v) || !exact(v, ['name', 'batch']) || !MANAGED_FRESH_STEPS.includes(v.name as ManagedFreshStep) || v.batch !== 0) return;
  return { name: v.name as ManagedFreshStep, batch: 0 };
}
function capture(v: unknown): ManagedCaptureObservation | undefined {
  if (!isRec(v) || !exact(v, ['state', 'observedAt'])) return;
  if (v.state === 'unknown') return v.observedAt === null ? { state: 'unknown', observedAt: null } : undefined;
  if ((v.state !== 'on' && v.state !== 'off') || typeof v.observedAt !== 'string' || v.observedAt.length > 40 || !Number.isFinite(Date.parse(v.observedAt))) return;
  return { state: v.state, observedAt: v.observedAt };
}
function diagnostic(v: unknown, stages: readonly string[] = STAGES): ManagedStepDiagnostic | undefined {
  if (!isRec(v) || !exact(v, ['stage', 'code']) || !stages.includes(v.stage as string) || typeof v.code !== 'string' || !CODES.includes(v.code)) return;
  return { stage: v.stage as ManagedStepDiagnostic['stage'], code: v.code };
}
const freshDiagnostic = (v: unknown) => diagnostic(v, FRESH_STAGES) as ManagedFreshStepDiagnostic | undefined;
function targets(v: Rec): ManagedReview['targets'] | undefined {
  const t = v.targets;
  if (!isRec(t) || !exact(t, ['configRoot', 'dataRoot', 'storeRoot'])) return;
  const path = (x: unknown): x is string => text(x, MANAGED_STEP_LIMITS.pathBytes);
  if (!path(t.configRoot) || !path(t.dataRoot) || !path(t.storeRoot)) return;
  return { configRoot: t.configRoot, dataRoot: t.dataRoot, storeRoot: t.storeRoot };
}
function review(v: unknown): ManagedReview | undefined {
  if (!isRec(v) || !exact(v, ['expected', 'targets', 'storeId', 'sourceId']) || typeof v.expected !== 'string' || !DIGEST.test(v.expected)) return;
  const t = targets(v);
  const id = (x: unknown) => x === null || (typeof x === 'string' && ID.test(x));
  if (!t || !id(v.storeId) || !id(v.sourceId)) return;
  return { expected: v.expected, targets: t, storeId: v.storeId as string | null, sourceId: v.sourceId as string | null };
}

interface FreshModes { storeMode: ManagedFreshStoreMode; sourceMode: ManagedFreshSourceMode; capturePolicy: ManagedFreshCapturePolicy; plan: ManagedFreshStepRef[] }
/** Only the four frozen grammars, with the capture policy their store mode implies. */
function freshModes(v: Rec): FreshModes | undefined {
  const storeMode = v.storeMode, sourceMode = v.sourceMode;
  if ((storeMode !== 'create' && storeMode !== 'retain') || (sourceMode !== 'create' && sourceMode !== 'reuse')) return;
  if (v.capturePolicy !== (storeMode === 'create' ? 'enable-new' : 'preserve') || !Array.isArray(v.plan)) return;
  const shown = v.plan.map(freshStepRef);
  for (const missing of [true, false]) {
    let plan: ManagedFreshStepRef[];
    try { plan = managedFreshPlan(storeMode, missing, sourceMode); } catch { continue; }
    if (shown.length === plan.length && shown.every((s, i) => s?.name === plan[i].name)) return { storeMode, sourceMode, capturePolicy: storeMode === 'create' ? 'enable-new' : 'preserve', plan };
  }
}
const FRESH_REVIEW_KEYS = ['expected', 'planKind', 'targets', 'storeId', 'sourceId', 'storeMode', 'sourceMode', 'capturePolicy', 'packageVersion', 'capture', 'plan'] as const;
/** Strict ManagedFreshReview: proposed or retained identities are present; the plan is frozen. */
function freshReview(v: unknown): ManagedFreshReview | undefined {
  if (!isRec(v) || !exact(v, FRESH_REVIEW_KEYS) || v.planKind !== 'fresh' || typeof v.expected !== 'string' || !DIGEST.test(v.expected)) return;
  const t = targets(v), modes = freshModes(v), observed = capture(v.capture);
  if (!t || !modes || !observed || typeof v.storeId !== 'string' || !ID.test(v.storeId) || typeof v.sourceId !== 'string' || !ID.test(v.sourceId)) return;
  if (typeof v.packageVersion !== 'string' || !VERSION.test(v.packageVersion)) return;
  return { expected: v.expected, planKind: 'fresh', targets: t, storeId: v.storeId, sourceId: v.sourceId, ...modes, packageVersion: v.packageVersion, capture: observed };
}

const PROGRESS_KEYS = ['operationId', 'sequence', 'state', 'worker', 'step', 'lastCompleted', 'effect', 'capture', 'diagnostic', 'recovery'] as const;
const FRESH_PROGRESS_KEYS = [...PROGRESS_KEYS, 'planKind', 'plan', 'storeMode', 'sourceMode', 'capturePolicy'] as const;
/** Fields and combinations shared by both families; the step vocabulary is the caller's. */
function progressCommon<R extends { name: string; batch: number }>(v: Rec, ref: (x: unknown) => R | undefined, parseDiagnostic: (x: unknown) => { stage: string; code: string } | undefined, captureSteps: readonly string[]) {
  if (typeof v.operationId !== 'string' || !UUID.test(v.operationId) || !count(v.sequence)) return;
  if (!['pending', 'running', 'paused', 'failed', 'complete', 'abandoned'].includes(v.state as string)) return;
  if (!['idle', 'active', 'unsettled'].includes(v.worker as string) || !['none', 'intent', 'uncertain', 'committed'].includes(v.effect as string)) return;
  if (!['continue', 'resume', 'reconcile', 'review', 'none'].includes(v.recovery as string)) return;
  const step = v.step === null ? null : ref(v.step), last = v.lastCompleted === null ? null : ref(v.lastCompleted), observed = capture(v.capture);
  const diag = v.diagnostic === null ? null : parseDiagnostic(v.diagnostic);
  if (step === undefined || last === undefined || !observed || diag === undefined) return;
  const p = { operationId: v.operationId, sequence: v.sequence, state: v.state as ManagedStepProgress['state'], worker: v.worker as ManagedStepProgress['worker'], step, lastCompleted: last, effect: v.effect as ManagedStepProgress['effect'], capture: observed, diagnostic: diag, recovery: v.recovery as ManagedStepProgress['recovery'] };
  // Step is null only at complete; complete needs no recovery; an active worker is running work.
  if ((p.step === null) !== (p.state === 'complete') || (p.state === 'complete' && p.recovery !== 'none')) return;
  if (p.worker === 'active' && p.state !== 'running') return;
  // A capture review only ever names the current uncertain capture decision.
  if (p.recovery === 'review' && !captureSteps.includes(p.step?.name ?? '')) return;
  return p;
}
/** Strict ManagedStepProgress (version 1): unknown keys, values or inconsistent combinations are refused. */
export function parseManagedStepProgress(v: unknown): ManagedStepProgress | undefined {
  if (!isRec(v) || !exact(v, PROGRESS_KEYS)) return;
  return progressCommon(v, stepRef, x => diagnostic(x), ['enable', 'disable']) as ManagedStepProgress | undefined;
}
/** Strict ManagedFreshStepProgress (version 2): its frozen plan, modes and position must agree. */
export function parseManagedFreshStepProgress(v: unknown): ManagedFreshStepProgress | undefined {
  if (!isRec(v) || !exact(v, FRESH_PROGRESS_KEYS) || v.planKind !== 'fresh') return;
  const modes = freshModes(v), p = progressCommon(v, freshStepRef, freshDiagnostic, ['enable']);
  if (!modes || !p) return;
  // Prepare settles the journal, so a finished step always exists and the next one follows it in the plan.
  const done = p.lastCompleted ? modes.plan.findIndex(s => s.name === p.lastCompleted!.name) : -1;
  if (done < 0 || (modes.plan[done + 1]?.name ?? null) !== (p.step?.name ?? null)) return;
  return { ...p, planKind: 'fresh', ...modes } as ManagedFreshStepProgress;
}

function inspection(v: unknown): ManagedInspection | null | undefined {
  if (v === null) return null;
  if (!isRec(v) || !MANAGED_INSPECTION_STEPS.includes(v.stage as ManagedInspectionStep)) return;
  const stage = v.stage as ManagedInspectionStep;
  if (v.state === 'incomplete') return exact(v, ['state', 'stage', 'cursor']) && text(v.cursor, MANAGED_STEP_LIMITS.cursorBytes) ? { state: 'incomplete', stage, cursor: v.cursor } : undefined;
  if (v.state === 'unavailable') return exact(v, ['state', 'stage', 'cursor']) && v.cursor === null ? { state: 'unavailable', stage, cursor: null } : undefined;
  if (v.state !== 'complete' || stage !== 'review' || !exact(v, ['state', 'stage', 'cursor', 'review']) || v.cursor !== null) return;
  const r = review(v.review);
  return r ? { state: 'complete', stage: 'review', cursor: null, review: r } : undefined;
}
function freshInspection(v: unknown): ManagedFreshInspection | null | undefined {
  if (v === null) return null;
  type Stage = typeof MANAGED_FRESH_INSPECTION_STEPS[number];
  if (!isRec(v) || !MANAGED_FRESH_INSPECTION_STEPS.includes(v.stage as Stage)) return;
  const stage = v.stage as Stage;
  if (v.state === 'incomplete') return exact(v, ['state', 'stage', 'cursor']) && text(v.cursor, MANAGED_STEP_LIMITS.cursorBytes) ? { state: 'incomplete', stage, cursor: v.cursor } : undefined;
  if (v.state === 'unavailable') return exact(v, ['state', 'stage', 'cursor']) && v.cursor === null ? { state: 'unavailable', stage, cursor: null } : undefined;
  if (v.state !== 'complete' || stage !== 'review' || !exact(v, ['state', 'stage', 'cursor', 'review']) || v.cursor !== null) return;
  const r = freshReview(v.review);
  return r ? { state: 'complete', stage: 'review', cursor: null, review: r } : undefined;
}

function envelope(v: Rec) {
  if (!['applied', 'replayed', 'observed', 'refused'].includes(v.disposition as string)) return;
  const a = v.accounting;
  if (!isRec(a) || !exact(a, ['securitySpawns', 'elapsedMs']) || !count(a.securitySpawns) || typeof a.elapsedMs !== 'number' || !Number.isFinite(a.elapsedMs) || a.elapsedMs < 0) return;
  return { disposition: v.disposition as ManagedStepResponse['disposition'], accounting: { securitySpawns: a.securitySpawns, elapsedMs: a.elapsedMs } };
}
const ENVELOPE_KEYS = ['version', 'disposition', 'inspection', 'progress', 'error', 'accounting'] as const;
/** Strict ManagedStepResponse (version 1). Errors override disposition, including failed replays. */
export function parseManagedStepResponse(v: unknown): ManagedStepResponse | undefined {
  if (!isRec(v) || !exact(v, ENVELOPE_KEYS) || v.version !== 1) return;
  const e = envelope(v), i = inspection(v.inspection), p = v.progress === null ? null : parseManagedStepProgress(v.progress);
  const error = v.error === null ? null : diagnostic(v.error);
  if (!e || i === undefined || p === undefined || error === undefined || (e.disposition === 'refused' && error === null)) return;
  return { version: 1, disposition: e.disposition, inspection: i, progress: p, error, accounting: e.accounting };
}
/** Strict ManagedFreshStepResponse (version 2). A version-1 envelope is never translated into it. */
export function parseManagedFreshStepResponse(v: unknown): ManagedFreshStepResponse | undefined {
  if (!isRec(v) || !exact(v, ENVELOPE_KEYS) || v.version !== 2) return;
  const e = envelope(v), i = freshInspection(v.inspection), p = v.progress === null ? null : parseManagedFreshStepProgress(v.progress);
  const error = v.error === null ? null : freshDiagnostic(v.error);
  if (!e || i === undefined || p === undefined || error === undefined || (e.disposition === 'refused' && error === null)) return;
  return { version: 2, disposition: e.disposition, inspection: i, progress: p, error, accounting: e.accounting };
}

const sameRef = (a: { name: string; batch: number } | null, b: { name: string; batch: number } | null) => !!a && !!b && a.name === b.name && a.batch === b.batch;
/** A reply must answer this request: same family, same operation, a coherent sequence and the named step. */
export function replyAnswers(request: ManagedSetupStepRequest, r: ManagedSetupStepResponse): boolean {
  if (r.version !== request.version) return false;
  const p = r.progress;
  const operation = 'operationId' in request ? request.operationId : undefined;
  if (r.error) return !p || !operation || p.operationId === operation;
  if (request.action === 'inspect') return r.inspection !== null;
  if (request.action === 'status') return r.inspection === null && (!operation || p?.operationId === operation);
  if (!p || p.operationId !== operation || r.inspection !== null) return false;
  const expected = request.action === 'begin' ? 0 : request.expectedSequence;
  if (r.disposition === 'applied' && p.sequence !== expected + 1) return false;
  if (r.disposition === 'replayed' && p.sequence !== expected && p.sequence !== expected + 1) return false;
  if (r.disposition === 'observed' && p.sequence < expected) return false;
  if (request.action === 'advance' && r.disposition === 'applied' && !sameRef(p.lastCompleted, request.step) && !sameRef(p.step, request.step)) return false;
  return true;
}

export type StepResult<T extends ManagedSetupStepResponse = ManagedSetupStepResponse> =
  | { kind: 'reply'; status: number; response: T }
  /** A non-envelope service refusal (old route guidance, authentication, method, limits, not found). */
  | { kind: 'http'; status: number; code: string }
  /** No reply arrived: the step may or may not have run. */
  | { kind: 'dropped' }
  /** A reply arrived but is unreadable or does not answer the request: treat its effect as unknown. */
  | { kind: 'invalid' }
  /** The request failed the shared shape check locally; nothing was sent. */
  | { kind: 'not-sent' };

/** One POST to the advertised step route. Never retried, never sent to an old route. A reply is read
 * only in its request's family: a version-1 envelope never answers a version-2 request or vice versa. */
export async function managedStepCall(host: ServiceHost, request: ManagedStepRequest): Promise<StepResult<ManagedStepResponse>>;
export async function managedStepCall(host: ServiceHost, request: ManagedFreshStepRequest): Promise<StepResult<ManagedFreshStepResponse>>;
export async function managedStepCall(host: ServiceHost, request: ManagedSetupStepRequest): Promise<StepResult>;
export async function managedStepCall(host: ServiceHost, request: ManagedSetupStepRequest): Promise<StepResult> {
  const body = JSON.stringify(request);
  const fresh = request.version === 2;
  const shaped = fresh ? managedFreshStepRequest(JSON.parse(body)) : managedStepRequest(JSON.parse(body));
  if (!shaped || bytes(body) > MANAGED_STEP_LIMITS.requestBytes) return { kind: 'not-sent' };
  let result: Awaited<ReturnType<ServiceHost['serviceRequest']>>;
  try { result = await host.serviceRequest({ method: 'POST', path: MANAGED_STEP_ROUTE, body }); }
  catch { return { kind: 'dropped' }; }
  const raw = typeof result.body === 'string' ? result.body : '';
  if (bytes(raw) > MANAGED_STEP_LIMITS.responseBytes) return { kind: 'invalid' };
  let json: unknown;
  try { json = JSON.parse(raw); } catch { return result.status === 200 || result.status >= 500 ? { kind: result.status === 200 ? 'invalid' : 'dropped' } : { kind: 'http', status: result.status, code: `http-${result.status}` }; }
  const response = fresh ? parseManagedFreshStepResponse(json) : parseManagedStepResponse(json);
  if (response) {
    // A replayed failed receipt also uses its error status, never HTTP 200.
    if (response.error ? result.status < 400 || result.status > 599 : result.status !== 200) return { kind: 'invalid' };
    return replyAnswers(request, response) ? { kind: 'reply', status: result.status, response } : { kind: 'invalid' };
  }
  // The other family's envelope is a wrong answer, not a dropped request.
  if (fresh ? parseManagedStepResponse(json) : parseManagedFreshStepResponse(json)) return { kind: 'invalid' };
  if (result.status >= 400 && isRec(json) && typeof json.error === 'string' && /^[A-Za-z][A-Za-z0-9-]{0,63}$/.test(json.error)) return { kind: 'http', status: result.status, code: json.error };
  return { kind: result.status >= 500 ? 'dropped' : 'invalid' };
}

/** Lowercase UUID v4 from getRandomValues (randomUUID needs a secure context). */
export function newOperationId(fill: (b: Uint8Array) => Uint8Array = (b) => crypto.getRandomValues(b)) {
  const b = fill(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** The durable progress to show: strictly newer local settlement, else the refreshed Setup observation.
 * Another family is another operation: the read wins. */
export function currentProgress(local: ManagedSetupStepProgress | null, read: ManagedSetupStepProgress | undefined): ManagedSetupStepProgress | null {
  if (!read) return local;
  if (!local || local.operationId !== read.operationId || progressFamily(local) !== progressFamily(read)) return read;
  return local.sequence > read.sequence ? local : read;
}

/** Plain next action for a stopped operation; the driver itself never chooses to start one. */
export type StepAction = 'continue' | 'resume' | 'review' | 'status' | null;
export function nextAction(p: ManagedSetupStepProgress | null): StepAction {
  if (!p || p.state === 'complete') return null;
  if (p.recovery === 'continue') return p.state === 'pending' ? 'continue' : 'status';
  if (p.recovery === 'resume' || p.recovery === 'reconcile') return 'resume';
  if (p.recovery === 'review') return 'review';
  return 'status';
}
/** Abandon is legal from pending, failed, paused and fenced running; the service still decides. */
export const canAbandon = (p: ManagedSetupStepProgress | null) => !!p && p.state !== 'complete' && p.state !== 'abandoned' && p.worker !== 'active';

export interface StepOutcome { code: string; stage: string | null; /** Effect unknown: only a status check is offered next. */ uncertain: boolean }
export type StepReview =
  | { kind: 'begin'; review: ManagedReview | ManagedFreshReview }
  | { kind: 'capture'; review: ManagedReview | ManagedFreshReview; progress: ManagedSetupStepProgress };
export interface StepUi {
  /** What is in flight or being driven; null when stopped. */
  busy: null | 'inspect' | 'run' | 'control' | 'status';
  progress: ManagedSetupStepProgress | null;
  /** Operation this frame last addressed (a dropped begin can be checked by status). */
  operationId: string | null;
  /** Family of the journey this frame last addressed; selects the wire version for status. */
  family: StepFamily;
  /** Frozen fresh plan confirmed for a begin still in flight (no progress exists yet). */
  starting: ManagedFreshStepRef[] | null;
  inspecting: ManagedInspectionStep | null;
  review: StepReview | null;
  ack: boolean;
  confirm: null | 'pause' | 'abandon';
  /** No further step is queued while a pause/stop confirmation is open or a pause is confirmed. */
  hold: boolean;
  /** Pause confirmed while a step was in flight: send pause once that step settles. */
  pauseAfter: boolean;
  outcome: StepOutcome | null;
}
export const initialStepUi = (): StepUi => ({ busy: null, progress: null, operationId: null, family: 'migration', starting: null, inspecting: null, review: null, ack: false, confirm: null, hold: false, pauseAfter: false, outcome: null });

export type StepStop = { reason: 'review' | 'stopped' | 'complete' | 'held' | 'retired'; progress: ManagedSetupStepProgress | null };
/** `R` narrows what a caller's transport sees. It defaults to version 1 so migration-only callers keep
 * their types; Setup opts into both families. The driver never sends a fresh request for migration progress. */
export interface StepIo<R extends ManagedSetupStepRequest = ManagedStepRequest> {
  /** Send through a guarded proxy that refuses once `current` is false. */
  send: (request: R, current: () => boolean) => Promise<StepResult>;
  /** Host account/surface/session/directory key; null while the frame is hidden or disposed. */
  context: () => string | null;
  /** Repaint; `stop` is set when a run or review settles (focus hand-off). */
  changed: (stop?: StepStop) => void;
  /** One existing Setup status read after durable state may have changed; never a loop. */
  refresh: (complete: boolean) => void;
  operationId?: () => string;
}

const advance = (p: ManagedSetupStepProgress): ManagedSetupStepRequest => isFreshProgress(p)
  ? { version: 2, action: 'advance', operationId: p.operationId, expectedSequence: p.sequence, step: { name: p.step!.name, batch: 0 } }
  : { version: 1, action: 'advance', operationId: p.operationId, expectedSequence: p.sequence, step: { name: p.step!.name, batch: p.step!.batch } };
const control = (action: 'pause' | 'abandon' | 'resume', p: ManagedSetupStepProgress): ManagedSetupStepRequest =>
  isFreshProgress(p) ? { version: 2, action, operationId: p.operationId, expectedSequence: p.sequence } : { version: 1, action, operationId: p.operationId, expectedSequence: p.sequence };
const inspectRequest = (family: StepFamily, page: { storeRoot?: string } | { cursor: string }): ManagedSetupStepRequest =>
  family === 'fresh' ? { version: 2, action: 'inspect', ...page } : { version: 1, action: 'inspect', ...page };
/** A clean, strictly newer pending step continues an explicitly started run.
 * An unsettled worker projection retains the old intent: the engine must reconcile
 * it on the next advance. It is not a reason to strand an accepted resume. */
function advanceable(previous: ManagedSetupStepProgress | null, p: ManagedSetupStepProgress) {
  return p.state === 'pending' && p.recovery === 'continue' && p.step !== null && p.diagnostic === null &&
    (!previous || (previous.operationId === p.operationId && progressFamily(previous) === progressFamily(p) && p.sequence > previous.sequence));
}

/**
 * One frame's step driver for both families. Every run starts from a user action (Confirm, Continue,
 * Resume, a capture decision or Keep going), sends one request at a time and stops at the first reply
 * that is not a clean, strictly newer pending step. No timer, retry or background continuation exists here.
 */
/** The Setup view's single driver, which carries both negotiated families. */
export type SetupStepDriver = StepDriver<ManagedSetupStepRequest>;
export class StepDriver<R extends ManagedSetupStepRequest = ManagedStepRequest> {
  state: StepUi = initialStepUi();
  private attempt = 0;
  private key: string | null = null;
  private seen: string | null = null;
  private readonly io: StepIo<R>;
  constructor(io: StepIo<R>) { this.io = io; }

  private live(a: number) { return a === this.attempt && this.key !== null && this.io.context() === this.key; }
  private begin(busy: NonNullable<StepUi['busy']>, patch: Partial<StepUi> = {}) {
    this.attempt++; this.key = this.io.context();
    this.write({ busy, outcome: null, ...patch });
    return this.attempt;
  }
  private write(patch: Partial<StepUi>, stop?: StepStop) { this.state = { ...this.state, ...patch }; this.io.changed(stop); }
  private async send(a: number, request: ManagedSetupStepRequest): Promise<StepResult | null> {
    const result = await this.io.send(request as R, () => this.live(a));
    if (a !== this.attempt) return null; // superseded: an old reply never restarts anything
    if (!this.live(a)) { this.retire(); return null; }
    return result;
  }
  private stop(outcome: StepOutcome | null, patch: Partial<StepUi> = {}, reason: StepStop['reason'] = 'stopped') {
    this.write({ busy: null, inspecting: null, pauseAfter: false, starting: null, outcome, ...patch }, { reason, progress: patch.progress ?? this.state.progress });
    if (reason !== 'held' && reason !== 'review') this.io.refresh(reason === 'complete');
  }
  private failure(r: StepResult): StepOutcome {
    if (r.kind === 'http') return { code: r.code, stage: null, uncertain: false };
    if (r.kind === 'not-sent') return { code: 'managed-step-request-invalid', stage: null, uncertain: false };
    return { code: r.kind === 'dropped' ? 'managed-step-no-reply' : 'managed-step-reply-invalid', stage: null, uncertain: true };
  }
  /** Adopt a reply's progress for the same operation; returns the progress to continue from, if any. */
  private settle(r: StepResult): { progress: ManagedSetupStepProgress | null; outcome: StepOutcome | null } {
    if (r.kind !== 'reply') return { progress: null, outcome: this.failure(r) };
    const res = r.response, p = res.progress;
    const outcome = res.error ? { code: res.error.code, stage: res.error.stage, uncertain: false } : p?.diagnostic ? { code: p.diagnostic.code, stage: p.diagnostic.stage, uncertain: false } : null;
    if (p) this.state = { ...this.state, progress: p, operationId: p.operationId, family: progressFamily(p), starting: null };
    return { progress: res.error ? null : p, outcome };
  }

  /** Context observed at paint. Any change retires an active attempt; another account starts clean. */
  observe(key: string | null, account: string) {
    const was = this.seen; this.seen = key === null ? was : key;
    // Visibility loss is an event, not just the context at reply time. Latch it
    // now so a hide/show round trip cannot revive a held reply's authority.
    if (key === null) { this.retire(); return; }
    if (key !== null && was !== null && key !== was) {
      const accountChanged = JSON.parse(was)[0] !== account;
      queueMicrotask(() => {
        if (accountChanged) { this.attempt++; this.state = initialStepUi(); this.io.changed(); return; }
        if (this.state.busy) this.retire(); else if (this.state.review || this.state.confirm) this.write({ review: null, ack: false, confirm: null, hold: false });
      });
    }
  }
  /** Stop queuing: the frame closed or its context moved. Durable state is re-read, never continued. */
  retire() {
    if (!this.state.busy) return;
    const inspecting = this.state.busy === 'inspect';
    this.attempt++;
    this.stop(inspecting ? null : { code: 'managed-step-retired', stage: null, uncertain: false }, { hold: false, confirm: null, review: null, ack: false }, 'retired');
  }
  setAck(ack: boolean) { if (!this.state.busy) this.write({ ack }); }
  /** Cancel a review or an inspection in progress: no request is needed and nothing changes. */
  cancelReview() { if (this.state.busy === 'inspect') this.attempt++; this.write({ busy: this.state.busy === 'inspect' ? null : this.state.busy, review: null, ack: false, inspecting: null }, { reason: 'review', progress: this.state.progress }); }

  /** Read-only inspection in one family, following service cursors one page at a time up to a fixed bound.
   * A capture review always uses the family of the progress it describes. */
  async inspect(purpose: 'begin' | 'capture', options: { storeRoot?: string; progress?: ManagedSetupStepProgress | null; family?: StepFamily } = {}) {
    if (this.state.busy) return;
    const basis = options.progress ?? null;
    if (purpose === 'capture' && basis?.recovery !== 'review') return;
    const family: StepFamily = purpose === 'capture' ? progressFamily(basis!) : options.family ?? 'migration';
    const a = this.begin('inspect', { inspecting: null, review: null, ack: false, confirm: null, family });
    let request = inspectRequest(family, purpose === 'begin' && options.storeRoot ? { storeRoot: options.storeRoot } : {});
    for (let page = 1; ; page++) {
      const r = await this.send(a, request);
      if (!r) return;
      if (r.kind !== 'reply') return this.stop({ ...this.failure(r), uncertain: false });
      const res = r.response, p = res.progress;
      if (res.error) return this.stop({ code: res.error.code, stage: res.error.stage, uncertain: false }, p ? { progress: p, operationId: p.operationId, family } : {});
      const i = res.inspection!;
      if (i.state === 'unavailable') return this.stop({ code: 'managed-migration-unavailable', stage: i.stage, uncertain: false });
      if (i.state === 'incomplete') {
        if (page >= MAX_INSPECTION_PAGES) return this.stop({ code: 'managed-inspection-incomplete', stage: i.stage, uncertain: false });
        this.write({ inspecting: i.stage });
        request = inspectRequest(family, { cursor: i.cursor });
        continue;
      }
      if (purpose === 'capture') {
        // The review must describe the same unresolved decision this frame is showing.
        if (!p || !basis || p.operationId !== basis.operationId || p.sequence !== basis.sequence || p.recovery !== 'review' || !sameRef(p.step, basis.step)) {
          return this.stop({ code: 'managed-review-stale', stage: 'review', uncertain: false }, p ? { progress: p, operationId: p.operationId } : {});
        }
        return this.stop(null, { review: { kind: 'capture', review: i.review, progress: p }, progress: p, operationId: p.operationId, ack: false }, 'review');
      }
      // An unfinished operation already exists: show it rather than offering a second consent.
      if (p && p.state !== 'complete') return this.stop(null, { progress: p, operationId: p.operationId });
      return this.stop(null, { review: { kind: 'begin', review: i.review }, ack: false }, 'review');
    }
  }

  /** Confirmed consent for the reviewed journey: begin, then the confirmed run continues step by step. */
  async confirmBegin() {
    const r = this.state.review;
    if (this.state.busy || r?.kind !== 'begin' || !this.state.ack) return;
    const operationId = (this.io.operationId ?? newOperationId)();
    const fresh = isFreshReview(r.review);
    const a = this.begin('run', { review: null, ack: false, operationId, family: fresh ? 'fresh' : 'migration', starting: isFreshReview(r.review) ? r.review.plan : null, hold: false, pauseAfter: false, confirm: null });
    await this.run(a, fresh ? { version: 2, action: 'begin', operationId, confirmed: true, expected: r.review.expected } : { version: 1, action: 'begin', operationId, confirmed: true, expected: r.review.expected }, null);
  }
  /** Explicit Continue for a stopped pending step. */
  async continueRun(p: ManagedSetupStepProgress | null) {
    if (this.state.busy || !p || nextAction(p) !== 'continue') return;
    const a = this.begin('run', { progress: p, operationId: p.operationId, family: progressFamily(p), hold: false, confirm: null });
    await this.run(a, advance(p), p);
  }
  /** Explicit Resume (paused, abandoned, failed or interrupted). The next advance reconciles first. */
  async resume(p: ManagedSetupStepProgress | null) {
    if (this.state.busy || !p || nextAction(p) !== 'resume') return;
    const a = this.begin('run', { progress: p, operationId: p.operationId, family: progressFamily(p), hold: false, confirm: null });
    await this.run(a, control('resume', p), p);
  }
  /** Reviewed resume: fresh consent for exactly the reviewed capture decision. */
  async confirmCapture() {
    const r = this.state.review;
    if (this.state.busy || r?.kind !== 'capture' || !this.state.ack) return;
    const p = r.progress;
    const a = this.begin('run', { review: null, ack: false, progress: p, operationId: p.operationId, family: progressFamily(p), hold: false, confirm: null });
    const request: ManagedSetupStepRequest = isFreshProgress(p)
      ? { version: 2, action: 'resume', operationId: p.operationId, expectedSequence: p.sequence, review: { confirmed: true, expected: r.review.expected, step: 'enable' } }
      : { version: 1, action: 'resume', operationId: p.operationId, expectedSequence: p.sequence, review: { confirmed: true, expected: r.review.expected, step: p.step!.name as 'enable' | 'disable' } };
    await this.run(a, request, p);
  }
  /** A bounded observation of one operation; also the only next action after an unknown reply. */
  async status(p: ManagedSetupStepProgress | null) {
    if (this.state.busy) return;
    const operationId = p?.operationId ?? this.state.operationId;
    const family = p ? progressFamily(p) : this.state.family;
    const a = this.begin('status', { family });
    const ref = operationId ? { operationId } : {};
    const r = await this.send(a, family === 'fresh' ? { version: 2, action: 'status', ...ref } : { version: 1, action: 'status', ...ref });
    if (!r) return;
    if (r.kind === 'http' && r.status === 404) return this.stop(null, { progress: null, operationId: null });
    if (r.kind === 'reply' && !r.response.error && !r.response.progress) return this.stop(null, { progress: null, operationId: null });
    const s = this.settle(r);
    this.stop(s.outcome, {});
  }

  requestPause() { if (this.state.busy === 'run' && !this.state.confirm) this.write({ confirm: 'pause', hold: true }); }
  requestAbandon(p: ManagedSetupStepProgress | null) { if (!this.state.busy && canAbandon(p)) this.write({ confirm: 'abandon', hold: true }); }
  /** Keep going / Cancel. A run that stopped only because of the hold continues by this explicit choice. */
  async cancelConfirm(p: ManagedSetupStepProgress | null) {
    if (!this.state.confirm || this.state.pauseAfter) return;
    const held = this.state.confirm === 'pause' && !this.state.busy;
    this.write({ confirm: null, hold: false });
    if (held && p && nextAction(p) === 'continue') await this.continueRun(p);
  }
  async confirmStop(p: ManagedSetupStepProgress | null) {
    const kind = this.state.confirm;
    if (!kind) return;
    if (kind === 'pause' && this.state.busy === 'run') { this.write({ confirm: null, hold: true, pauseAfter: true }); return; }
    if (!p || this.state.busy || (kind === 'abandon' && !canAbandon(p))) return;
    const a = this.begin('control', { confirm: null, hold: false, progress: p, operationId: p.operationId, family: progressFamily(p) });
    await this.run(a, control(kind, p), p);
  }

  private async run(a: number, first: ManagedSetupStepRequest, before: ManagedSetupStepProgress | null) {
    let request = first, previous = before;
    for (;;) {
      const r = await this.send(a, request);
      if (!r) return;
      const { progress: p, outcome } = this.settle(r);
      const done = { hold: false, confirm: null } as const;
      if (!p || (r.kind === 'reply' && r.response.error)) return this.stop(outcome, done);
      if (request.action === 'pause' || request.action === 'abandon') return this.stop(outcome, done);
      if (p.state === 'complete') return this.stop(outcome, done, 'complete');
      if (this.state.pauseAfter && p.state !== 'paused') {
        // The step in flight has settled; now record the confirmed pause at its sequence.
        request = control('pause', p); previous = p;
        this.write({ busy: 'control', pauseAfter: false });
        continue;
      }
      if (this.state.hold) return this.stop(outcome, {}, 'held');
      if (outcome || !advanceable(previous, p)) return this.stop(outcome, done);
      this.write({});
      previous = p; request = advance(p);
    }
  }
}
