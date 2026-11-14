// Setup client for the bounded managed-migration step protocol (setup/managed-steps.md).
// Strict reply parsing, one request at a time, and an explicit user action for every start.
// The service owns authority, freshness, sequence and idempotency; this module never infers them.
import {
  MANAGED_INSPECTION_STEPS, MANAGED_MIGRATION_STEPS, MANAGED_STEP_CODES, MANAGED_STEP_LIMITS, MANAGED_STEP_ROUTE, managedStepRequest,
  type ManagedCaptureObservation, type ManagedInspection, type ManagedInspectionStep, type ManagedMigrationStep, type ManagedStepDiagnostic,
  type ManagedStepProgress, type ManagedStepRef, type ManagedStepRequest, type ManagedStepResponse,
} from '../../shared/managed-steps.ts';
import { MANAGED_ACTION_CODES, type ManagedReview } from '../../shared/progress.ts';
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
const REMOVAL: readonly string[] = ['remove-selector', 'remove-discovery'];
const STAGES: readonly string[] = [...MANAGED_MIGRATION_STEPS, ...MANAGED_INSPECTION_STEPS, 'journal', 'lock'];
const CODES: readonly string[] = [...MANAGED_STEP_CODES, ...MANAGED_ACTION_CODES];
/** Read-only inspection pages followed for one explicit request before stopping honestly. */
export const MAX_INSPECTION_PAGES = 32;

function stepRef(v: unknown): ManagedStepRef | undefined {
  if (!isRec(v) || !exact(v, ['name', 'batch']) || !MANAGED_MIGRATION_STEPS.includes(v.name as ManagedMigrationStep) || !count(v.batch)) return;
  if (!REMOVAL.includes(v.name as string) && v.batch !== 0) return;
  return { name: v.name as ManagedMigrationStep, batch: v.batch };
}
const ref = (v: unknown) => v === null ? null : stepRef(v);
function capture(v: unknown): ManagedCaptureObservation | undefined {
  if (!isRec(v) || !exact(v, ['state', 'observedAt'])) return;
  if (v.state === 'unknown') return v.observedAt === null ? { state: 'unknown', observedAt: null } : undefined;
  if ((v.state !== 'on' && v.state !== 'off') || typeof v.observedAt !== 'string' || v.observedAt.length > 40 || !Number.isFinite(Date.parse(v.observedAt))) return;
  return { state: v.state, observedAt: v.observedAt };
}
function diagnostic(v: unknown): ManagedStepDiagnostic | undefined {
  if (!isRec(v) || !exact(v, ['stage', 'code']) || !STAGES.includes(v.stage as string) || typeof v.code !== 'string' || !CODES.includes(v.code)) return;
  return { stage: v.stage as ManagedStepDiagnostic['stage'], code: v.code };
}
function review(v: unknown): ManagedReview | undefined {
  if (!isRec(v) || !exact(v, ['expected', 'targets', 'storeId', 'sourceId']) || typeof v.expected !== 'string' || !DIGEST.test(v.expected)) return;
  const t = v.targets;
  if (!isRec(t) || !exact(t, ['configRoot', 'dataRoot', 'storeRoot'])) return;
  const path = (x: unknown): x is string => text(x, MANAGED_STEP_LIMITS.pathBytes);
  const id = (x: unknown) => x === null || (typeof x === 'string' && /^[A-Za-z0-9_.:-]{1,80}$/.test(x));
  if (!path(t.configRoot) || !path(t.dataRoot) || !path(t.storeRoot) || !id(v.storeId) || !id(v.sourceId)) return;
  return { expected: v.expected, targets: { configRoot: t.configRoot, dataRoot: t.dataRoot, storeRoot: t.storeRoot }, storeId: v.storeId as string | null, sourceId: v.sourceId as string | null };
}

const PROGRESS_KEYS = ['operationId', 'sequence', 'state', 'worker', 'step', 'lastCompleted', 'effect', 'capture', 'diagnostic', 'recovery'] as const;
/** Strict ManagedStepProgress: unknown keys, values or inconsistent combinations are refused. */
export function parseManagedStepProgress(v: unknown): ManagedStepProgress | undefined {
  if (!isRec(v) || !exact(v, PROGRESS_KEYS) || typeof v.operationId !== 'string' || !UUID.test(v.operationId) || !count(v.sequence)) return;
  if (!['pending', 'running', 'paused', 'failed', 'complete', 'abandoned'].includes(v.state as string)) return;
  if (!['idle', 'active', 'unsettled'].includes(v.worker as string) || !['none', 'intent', 'uncertain', 'committed'].includes(v.effect as string)) return;
  if (!['continue', 'resume', 'reconcile', 'review', 'none'].includes(v.recovery as string)) return;
  const step = ref(v.step), last = ref(v.lastCompleted), observed = capture(v.capture);
  const diag = v.diagnostic === null ? null : diagnostic(v.diagnostic);
  if (step === undefined || last === undefined || !observed || diag === undefined) return;
  const p = { operationId: v.operationId, sequence: v.sequence, state: v.state, worker: v.worker, step, lastCompleted: last, effect: v.effect, capture: observed, diagnostic: diag, recovery: v.recovery } as ManagedStepProgress;
  // Step is null only at complete; complete needs no recovery; an active worker is running work.
  if ((p.step === null) !== (p.state === 'complete') || (p.state === 'complete' && p.recovery !== 'none')) return;
  if (p.worker === 'active' && p.state !== 'running') return;
  // A capture review only ever names the current uncertain enable/disable decision.
  if (p.recovery === 'review' && p.step?.name !== 'enable' && p.step?.name !== 'disable') return;
  return p;
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

/** Strict ManagedStepResponse. A refusal always carries its fixed diagnostic and nothing else does. */
export function parseManagedStepResponse(v: unknown): ManagedStepResponse | undefined {
  if (!isRec(v) || !exact(v, ['version', 'disposition', 'inspection', 'progress', 'error', 'accounting']) || v.version !== 1) return;
  if (!['applied', 'replayed', 'observed', 'refused'].includes(v.disposition as string)) return;
  const i = inspection(v.inspection), p = v.progress === null ? null : parseManagedStepProgress(v.progress);
  const error = v.error === null ? null : diagnostic(v.error);
  const a = v.accounting;
  if (i === undefined || p === undefined || error === undefined || !isRec(a) || !exact(a, ['securitySpawns', 'elapsedMs']) || !count(a.securitySpawns) || !count(a.elapsedMs)) return;
  if ((v.disposition === 'refused') !== (error !== null)) return;
  return { version: 1, disposition: v.disposition as ManagedStepResponse['disposition'], inspection: i, progress: p, error, accounting: { securitySpawns: a.securitySpawns, elapsedMs: a.elapsedMs } };
}

const sameRef = (a: ManagedStepRef | null, b: ManagedStepRef | null) => !!a && !!b && a.name === b.name && a.batch === b.batch;
/** A reply must answer this request: same operation, a coherent sequence and the named step. */
export function replyAnswers(request: ManagedStepRequest, r: ManagedStepResponse): boolean {
  const p = r.progress;
  const operation = 'operationId' in request ? request.operationId : undefined;
  if (r.disposition === 'refused') return !p || !operation || p.operationId === operation;
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

export type StepResult =
  | { kind: 'reply'; status: number; response: ManagedStepResponse }
  /** A non-envelope service refusal (old route guidance, authentication, method, limits, not found). */
  | { kind: 'http'; status: number; code: string }
  /** No reply arrived: the step may or may not have run. */
  | { kind: 'dropped' }
  /** A reply arrived but is unreadable or does not answer the request: treat its effect as unknown. */
  | { kind: 'invalid' }
  /** The request failed the shared shape check locally; nothing was sent. */
  | { kind: 'not-sent' };

/** One POST to the advertised step route. Never retried, never sent to the old migration route. */
export async function managedStepCall(host: ServiceHost, request: ManagedStepRequest): Promise<StepResult> {
  const body = JSON.stringify(request);
  if (!managedStepRequest(JSON.parse(body)) || bytes(body) > MANAGED_STEP_LIMITS.requestBytes) return { kind: 'not-sent' };
  let result: Awaited<ReturnType<ServiceHost['serviceRequest']>>;
  try { result = await host.serviceRequest({ method: 'POST', path: MANAGED_STEP_ROUTE, body }); }
  catch { return { kind: 'dropped' }; }
  const raw = typeof result.body === 'string' ? result.body : '';
  if (bytes(raw) > MANAGED_STEP_LIMITS.responseBytes) return { kind: 'invalid' };
  let json: unknown;
  try { json = JSON.parse(raw); } catch { return result.status === 200 || result.status >= 500 ? { kind: result.status === 200 ? 'invalid' : 'dropped' } : { kind: 'http', status: result.status, code: `http-${result.status}` }; }
  const response = parseManagedStepResponse(json);
  if (response) {
    // Success is HTTP 200 only; a refusal envelope uses its error status.
    const refused = response.disposition === 'refused';
    if (refused ? result.status < 400 || result.status > 599 : result.status !== 200) return { kind: 'invalid' };
    return replyAnswers(request, response) ? { kind: 'reply', status: result.status, response } : { kind: 'invalid' };
  }
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

/** The durable progress to show: this frame's newer reply, else the Setup status read. */
export function currentProgress(local: ManagedStepProgress | null, read: ManagedStepProgress | undefined): ManagedStepProgress | null {
  if (!read) return local;
  if (!local || local.operationId !== read.operationId) return read;
  return local.sequence >= read.sequence ? local : read;
}

/** Plain next action for a stopped operation; the driver itself never chooses to start one. */
export type StepAction = 'continue' | 'resume' | 'review' | 'status' | null;
export function nextAction(p: ManagedStepProgress | null): StepAction {
  if (!p || p.state === 'complete') return null;
  if (p.recovery === 'continue') return p.state === 'pending' && p.worker === 'idle' ? 'continue' : 'status';
  if (p.recovery === 'resume' || p.recovery === 'reconcile') return 'resume';
  if (p.recovery === 'review') return 'review';
  return 'status';
}
/** Abandon is legal from pending, failed, paused and fenced running; the service still decides. */
export const canAbandon = (p: ManagedStepProgress | null) => !!p && p.state !== 'complete' && p.state !== 'abandoned' && p.worker !== 'active';

export interface StepOutcome { code: string; stage: string | null; /** Effect unknown: only a status check is offered next. */ uncertain: boolean }
export interface StepUi {
  /** What is in flight or being driven; null when stopped. */
  busy: null | 'inspect' | 'run' | 'control' | 'status';
  progress: ManagedStepProgress | null;
  /** Operation this frame last addressed (a dropped begin can be checked by status). */
  operationId: string | null;
  inspecting: ManagedInspectionStep | null;
  review: null | { kind: 'begin'; review: ManagedReview } | { kind: 'capture'; review: ManagedReview; progress: ManagedStepProgress };
  ack: boolean;
  confirm: null | 'pause' | 'abandon';
  /** No further step is queued while a pause/stop confirmation is open or a pause is confirmed. */
  hold: boolean;
  /** Pause confirmed while a step was in flight: send pause once that step settles. */
  pauseAfter: boolean;
  outcome: StepOutcome | null;
}
export const initialStepUi = (): StepUi => ({ busy: null, progress: null, operationId: null, inspecting: null, review: null, ack: false, confirm: null, hold: false, pauseAfter: false, outcome: null });

export type StepStop = { reason: 'review' | 'stopped' | 'complete' | 'held' | 'retired'; progress: ManagedStepProgress | null };
export interface StepIo {
  /** Send through a guarded proxy that refuses once `current` is false. */
  send: (request: ManagedStepRequest, current: () => boolean) => Promise<StepResult>;
  /** Host account/surface/session/directory key; null while the frame is hidden or disposed. */
  context: () => string | null;
  /** Repaint; `stop` is set when a run or review settles (focus hand-off). */
  changed: (stop?: StepStop) => void;
  /** One existing Setup status read after durable state may have changed; never a loop. */
  refresh: (complete: boolean) => void;
  operationId?: () => string;
}

const advance = (p: ManagedStepProgress): ManagedStepRequest => ({ version: 1, action: 'advance', operationId: p.operationId, expectedSequence: p.sequence, step: { name: p.step!.name, batch: p.step!.batch } });
const control = (action: 'pause' | 'abandon' | 'resume', p: ManagedStepProgress): ManagedStepRequest => ({ version: 1, action, operationId: p.operationId, expectedSequence: p.sequence });
/** Only a settled, clean, strictly newer pending step continues an explicitly started run. */
function advanceable(previous: ManagedStepProgress | null, p: ManagedStepProgress) {
  return p.state === 'pending' && p.recovery === 'continue' && p.worker === 'idle' && p.step !== null && p.diagnostic === null &&
    (!previous || (previous.operationId === p.operationId && p.sequence > previous.sequence));
}

/**
 * One frame's step driver. Every run starts from a user action (Confirm, Continue, Resume, a capture
 * decision or Keep going), sends one request at a time and stops at the first reply that is not a clean,
 * strictly newer pending step. No timer, retry or background continuation exists here.
 */
export class StepDriver {
  state: StepUi = initialStepUi();
  private attempt = 0;
  private key: string | null = null;
  private seen: string | null = null;
  private readonly io: StepIo;
  constructor(io: StepIo) { this.io = io; }

  private live(a: number) { return a === this.attempt && this.key !== null && this.io.context() === this.key; }
  private begin(busy: NonNullable<StepUi['busy']>, patch: Partial<StepUi> = {}) {
    this.attempt++; this.key = this.io.context();
    this.write({ busy, outcome: null, ...patch });
    return this.attempt;
  }
  private write(patch: Partial<StepUi>, stop?: StepStop) { this.state = { ...this.state, ...patch }; this.io.changed(stop); }
  private async send(a: number, request: ManagedStepRequest): Promise<StepResult | null> {
    const result = await this.io.send(request, () => this.live(a));
    if (a !== this.attempt) return null; // superseded: an old reply never restarts anything
    if (!this.live(a)) { this.retire(); return null; }
    return result;
  }
  private stop(outcome: StepOutcome | null, patch: Partial<StepUi> = {}, reason: StepStop['reason'] = 'stopped') {
    this.write({ busy: null, inspecting: null, pauseAfter: false, outcome, ...patch }, { reason, progress: patch.progress ?? this.state.progress });
    if (reason !== 'held' && reason !== 'review') this.io.refresh(reason === 'complete');
  }
  private failure(r: StepResult): StepOutcome {
    if (r.kind === 'http') return { code: r.code, stage: null, uncertain: false };
    if (r.kind === 'not-sent') return { code: 'managed-step-request-invalid', stage: null, uncertain: false };
    return { code: r.kind === 'dropped' ? 'managed-step-no-reply' : 'managed-step-reply-invalid', stage: null, uncertain: true };
  }
  /** Adopt a reply's progress for the same operation; returns the progress to continue from, if any. */
  private settle(r: StepResult): { progress: ManagedStepProgress | null; outcome: StepOutcome | null } {
    if (r.kind !== 'reply') return { progress: null, outcome: this.failure(r) };
    const res = r.response, p = res.progress;
    const outcome = res.error ? { code: res.error.code, stage: res.error.stage, uncertain: false } : p?.diagnostic ? { code: p.diagnostic.code, stage: p.diagnostic.stage, uncertain: false } : null;
    if (p) this.state = { ...this.state, progress: p, operationId: p.operationId };
    return { progress: res.disposition === 'refused' ? null : p, outcome };
  }

  /** Context observed at paint. Any change retires an active attempt; another account starts clean. */
  observe(key: string | null, account: string) {
    const was = this.seen; this.seen = key === null ? was : key;
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

  /** Read-only inspection, following service cursors one page at a time up to a fixed bound. */
  async inspect(purpose: 'begin' | 'capture', options: { storeRoot?: string; progress?: ManagedStepProgress | null } = {}) {
    if (this.state.busy) return;
    const basis = options.progress ?? null;
    if (purpose === 'capture' && basis?.recovery !== 'review') return;
    const a = this.begin('inspect', { inspecting: null, review: null, ack: false, confirm: null });
    let request: ManagedStepRequest = { version: 1, action: 'inspect', ...(purpose === 'begin' && options.storeRoot ? { storeRoot: options.storeRoot } : {}) };
    for (let page = 1; ; page++) {
      const r = await this.send(a, request);
      if (!r) return;
      if (r.kind !== 'reply') return this.stop({ ...this.failure(r), uncertain: false });
      const res = r.response, p = res.progress;
      if (res.error) return this.stop({ code: res.error.code, stage: res.error.stage, uncertain: false }, p ? { progress: p, operationId: p.operationId } : {});
      const i = res.inspection!;
      if (i.state === 'unavailable') return this.stop({ code: 'managed-migration-unavailable', stage: i.stage, uncertain: false });
      if (i.state === 'incomplete') {
        if (page >= MAX_INSPECTION_PAGES) return this.stop({ code: 'managed-inspection-incomplete', stage: i.stage, uncertain: false });
        this.write({ inspecting: i.stage });
        request = { version: 1, action: 'inspect', cursor: i.cursor };
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

  /** Confirmed consent for the reviewed switch: begin, then the confirmed run continues step by step. */
  async confirmBegin() {
    const r = this.state.review;
    if (this.state.busy || r?.kind !== 'begin' || !this.state.ack) return;
    const operationId = (this.io.operationId ?? newOperationId)();
    const a = this.begin('run', { review: null, ack: false, operationId, hold: false, pauseAfter: false, confirm: null });
    await this.run(a, { version: 1, action: 'begin', operationId, confirmed: true, expected: r.review.expected }, null);
  }
  /** Explicit Continue for a stopped pending step. */
  async continueRun(p: ManagedStepProgress | null) {
    if (this.state.busy || !p || nextAction(p) !== 'continue') return;
    const a = this.begin('run', { progress: p, operationId: p.operationId, hold: false, confirm: null });
    await this.run(a, advance(p), p);
  }
  /** Explicit Resume (paused, abandoned, failed or interrupted). The next advance reconciles first. */
  async resume(p: ManagedStepProgress | null) {
    if (this.state.busy || !p || nextAction(p) !== 'resume') return;
    const a = this.begin('run', { progress: p, operationId: p.operationId, hold: false, confirm: null });
    await this.run(a, control('resume', p), p);
  }
  /** Reviewed resume: fresh consent for exactly the reviewed enable/disable decision. */
  async confirmCapture() {
    const r = this.state.review;
    if (this.state.busy || r?.kind !== 'capture' || !this.state.ack) return;
    const p = r.progress, step = p.step!.name as 'enable' | 'disable';
    const a = this.begin('run', { review: null, ack: false, progress: p, operationId: p.operationId, hold: false, confirm: null });
    await this.run(a, { version: 1, action: 'resume', operationId: p.operationId, expectedSequence: p.sequence, review: { confirmed: true, expected: r.review.expected, step } }, p);
  }
  /** A bounded observation of one operation; also the only next action after an unknown reply. */
  async status(p: ManagedStepProgress | null) {
    if (this.state.busy) return;
    const operationId = p?.operationId ?? this.state.operationId;
    const a = this.begin('status');
    const r = await this.send(a, { version: 1, action: 'status', ...(operationId ? { operationId } : {}) });
    if (!r) return;
    if (r.kind === 'http' && r.status === 404) return this.stop(null, { progress: null, operationId: null });
    if (r.kind === 'reply' && r.response.disposition !== 'refused' && !r.response.progress) return this.stop(null, { progress: null, operationId: null });
    const s = this.settle(r);
    this.stop(s.outcome, {});
  }

  requestPause() { if (this.state.busy === 'run' && !this.state.confirm) this.write({ confirm: 'pause', hold: true }); }
  requestAbandon(p: ManagedStepProgress | null) { if (!this.state.busy && canAbandon(p)) this.write({ confirm: 'abandon', hold: true }); }
  /** Keep going / Cancel. A run that stopped only because of the hold continues by this explicit choice. */
  async cancelConfirm(p: ManagedStepProgress | null) {
    if (!this.state.confirm || this.state.pauseAfter) return;
    const held = this.state.confirm === 'pause' && !this.state.busy;
    this.write({ confirm: null, hold: false });
    if (held && p && nextAction(p) === 'continue') await this.continueRun(p);
  }
  async confirmStop(p: ManagedStepProgress | null) {
    const kind = this.state.confirm;
    if (!kind) return;
    if (kind === 'pause' && this.state.busy === 'run') { this.write({ confirm: null, hold: true, pauseAfter: true }); return; }
    if (!p || this.state.busy || (kind === 'abandon' && !canAbandon(p))) return;
    const a = this.begin('control', { confirm: null, hold: false, progress: p, operationId: p.operationId });
    await this.run(a, control(kind, p), p);
  }

  private async run(a: number, first: ManagedStepRequest, before: ManagedStepProgress | null) {
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
