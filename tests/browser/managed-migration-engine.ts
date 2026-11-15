// Synthetic step-protocol responders for Setup client tests and rendered QA: version-1 migration
// (stepEngine) and version-2 fresh setup (freshEngine). They follow the frozen contract's state graph
// and envelopes closely enough to exercise the client; they are NOT the engine, perform no filesystem
// work and prove nothing about Windows timing or fresh authority.
import { MANAGED_FRESH_INSPECTION_STEPS, managedFreshStepRequest, type ManagedFreshStepProgress, type ManagedFreshStepRef, type ManagedFreshStepRequest, type ManagedFreshStepResponse,
  type ManagedStepProgress, type ManagedStepRef, type ManagedStepRequest, type ManagedStepResponse } from '../../shared/managed-steps.ts';
import { managedOperationId, managedReview, managedStepPlan } from '../fixtures/managed-steps.ts';
import { managedFreshStepFixtures } from '../fixtures/managed-fresh-steps.ts';

type Capture = ManagedStepProgress['capture'];
const on: Capture = { state: 'on', observedAt: '2026-01-01T00:00:00.000Z' };
const off: Capture = { state: 'off', observedAt: '2026-01-01T00:00:01.000Z' };
const unknown: Capture = { state: 'unknown', observedAt: null };
const key = (r: ManagedStepRef) => `${r.name}:${r.batch}`;
export const CAPTURE_REVIEW = '6'.repeat(64);

export interface EngineFaults {
  /** Steps whose first advance fails at the deadline with an uncertain effect. */
  fail: Set<string>;
  /** Steps whose effect commits but whose reply is lost. */
  drop: Set<string>;
  /** Steps whose request is lost before it reaches the service (no effect). */
  lose: Set<string>;
  /** The first enable is left uncertain and needs a reviewed resume. */
  unsettledEnable: boolean;
  /** Return a failed receipt rather than a new failure for these steps. */
  failedReplay: Set<string>;
  /** A worker exits with its intent unresolved, before settling a receipt. */
  crash: Set<string>;
  /** The effect failed and its failure checkpoint could not be published. */
  settlement: Set<string>;
  /** Refuse the next request because the cross-process coordination port is occupied. */
  portBusy: boolean;
}

export function stepEngine(options: { plan?: ManagedStepRef[]; inspectPages?: number; operationId?: string } = {}) {
  const plan = options.plan ?? managedStepPlan;
  const faults: EngineFaults = { fail: new Set(), drop: new Set(), lose: new Set(), unsettledEnable: false, failedReplay: new Set(), crash: new Set(), settlement: new Set(), portBusy: false };
  let p: ManagedStepProgress | null = null;
  let page = 0;
  const requests: ManagedStepRequest[] = [];
  let inflight = 0, maxInflight = 0;
  let gate: { at: number; release: () => void; promise: Promise<void> } | null = null;
  const index = (r: ManagedStepRef | null) => r ? plan.findIndex(x => x.name === r.name && x.batch === r.batch) : -1;
  const progress = (patch: Partial<ManagedStepProgress>): ManagedStepProgress => ({ operationId: options.operationId ?? managedOperationId, sequence: 0, state: 'pending', worker: 'idle', step: plan[1], lastCompleted: plan[0], effect: 'none', capture: on, diagnostic: null, recovery: 'continue', ...p, ...patch });
  const reply = (status: number, body: Partial<ManagedStepResponse>) => ({ status, body: JSON.stringify({ version: 1, disposition: 'applied', inspection: null, progress: p, error: null, accounting: { securitySpawns: 3, elapsedMs: 12.5 }, ...body }) });
  const refuse = (status: number, stage: string, code: string) => reply(status, { disposition: 'refused', error: { stage: stage as never, code } });
  const captureAfter = (done: ManagedStepRef, before: Capture): Capture => done.name === 'disable' ? off : done.name === 'enable' ? on : before;

  function handle(r: ManagedStepRequest): { status: number; body: string } | 'drop' {
    if (faults.portBusy) { faults.portBusy = false; return refuse(503, 'lock', 'managed-step-port-busy'); }
    if (r.action === 'inspect') {
      if (p && p.recovery === 'review') return reply(200, { disposition: 'observed', inspection: { state: 'complete', stage: 'review', cursor: null, review: { ...managedReview, expected: CAPTURE_REVIEW } } });
      if (p && p.state !== 'complete') return reply(200, { disposition: 'observed', inspection: { state: 'complete', stage: 'review', cursor: null, review: managedReview } });
      const pages = options.inspectPages ?? 1;
      if (!('cursor' in r && r.cursor)) page = 0;
      page++;
      if (page < pages) return reply(200, { disposition: 'observed', progress: null, inspection: { state: 'incomplete', stage: page === 1 ? 'legacy-discovery' : 'legacy-releases', cursor: `inspection-page-${page + 1}` } });
      return reply(200, { disposition: 'observed', progress: null, inspection: { state: 'complete', stage: 'review', cursor: null, review: managedReview } });
    }
    if (r.action === 'status') return !r.operationId || r.operationId === p?.operationId ? reply(200, { disposition: 'observed', progress: p ? { ...p, capture: unknown } : null }) : { status: 404, body: '{"error":"not-found"}' };
    if (r.action === 'begin') {
      if (p) return refuse(409, 'journal', 'managed-step-conflict');
      if (r.expected !== managedReview.expected) return refuse(409, 'review', 'managed-review-stale');
      p = progress({ operationId: r.operationId, sequence: 1 });
      return reply(200, {});
    }
    if (!p || r.operationId !== p.operationId) return { status: 404, body: '{"error":"not-found"}' };
    if (r.expectedSequence !== p.sequence) return refuse(409, 'journal', 'managed-step-conflict');
    if (r.action === 'pause' || r.action === 'abandon') {
      if (p.worker === 'active') return refuse(503, 'lock', 'managed-step-unsettled');
      const allowed = r.action === 'pause' ? ['pending', 'failed', 'running'] : ['pending', 'failed', 'running', 'paused'];
      if (!allowed.includes(p.state)) return refuse(409, 'journal', 'managed-step-conflict');
      p = progress({ sequence: p.sequence + 1, state: r.action === 'pause' ? 'paused' : 'abandoned', recovery: 'resume' });
      return reply(200, {});
    }
    if (r.action === 'resume') {
      if (p.worker === 'active') return refuse(503, 'lock', 'managed-step-unsettled');
      if (p.recovery === 'review' && !r.review) return refuse(503, p.step!.name, 'managed-step-unsettled');
      if (r.review && (p.recovery !== 'review' || r.review.expected !== CAPTURE_REVIEW || r.review.step !== p.step?.name)) return refuse(409, p.step?.name ?? 'review', 'managed-review-stale');
      if (!['pending', 'paused', 'failed', 'abandoned', 'running'].includes(p.state)) return refuse(409, 'journal', 'managed-step-conflict');
      // Controls retain unresolved intent. Pending/continue means the NEXT advance
      // must reconcile it, not that the old effect is settled or the worker idle.
      p = progress({ sequence: p.sequence + 1, state: 'pending', diagnostic: null, recovery: 'continue' });
      return reply(200, {});
    }
    if (r.action !== 'advance') return refuse(400, 'journal', 'managed-step-conflict');
    if (p.state !== 'pending' || index(r.step) !== index(p.step)) return refuse(409, 'journal', 'managed-step-conflict');
    const step = p.step!, k = key(step);
    if (faults.lose.delete(k)) return 'drop';
    const crash = faults.crash.delete(k), settlement = faults.settlement.delete(k);
    if (crash || settlement) {
      p = progress({ state: 'running', worker: 'unsettled', effect: 'uncertain', capture: unknown,
        diagnostic: settlement ? { stage: step.name, code: 'managed-step-deadline' } : null, recovery: 'reconcile' });
      return crash ? 'drop' : refuse(503, step.name, 'managed-step-deadline');
    }
    const failedReplay = faults.failedReplay.delete(k);
    if (faults.fail.delete(k) || failedReplay) {
      p = progress({ sequence: p.sequence + 1, state: 'failed', worker: 'unsettled', effect: 'uncertain', capture: unknown, diagnostic: { stage: step.name, code: 'managed-step-deadline' }, recovery: 'reconcile' });
      return failedReplay ? reply(503, { disposition: 'replayed', error: p.diagnostic }) : refuse(503, step.name, 'managed-step-deadline');
    }
    if (step.name === 'enable' && faults.unsettledEnable) {
      faults.unsettledEnable = false;
      p = progress({ state: 'running', worker: 'unsettled', effect: 'uncertain', capture: off, diagnostic: { stage: 'enable', code: 'managed-step-unsettled' }, recovery: 'review' });
      return refuse(503, 'enable', 'managed-step-unsettled');
    }
    const next = plan[index(step) + 1] ?? null;
    p = next
      ? progress({ sequence: p.sequence + 1, state: 'pending', worker: 'idle', step: next, lastCompleted: step, effect: 'committed', capture: captureAfter(step, p.capture), diagnostic: null, recovery: 'continue' })
      : progress({ sequence: p.sequence + 1, state: 'complete', worker: 'idle', step: null, lastCompleted: step, effect: 'committed', capture: on, diagnostic: null, recovery: 'none' });
    return faults.drop.delete(k) ? 'drop' : reply(200, {});
  }

  async function request(body: string) {
    const r = JSON.parse(body) as ManagedStepRequest;
    requests.push(r);
    inflight++; maxInflight = Math.max(maxInflight, inflight);
    try {
      if (gate && gate.at === requests.length) await gate.promise;
      return handle(r);
    } finally { inflight--; }
  }

  return {
    plan, faults, requests,
    get progress() { return p; },
    set progress(value: ManagedStepProgress | null) { p = value; },
    maxInflight: () => maxInflight,
    /** Cold observation preserves intent/state; a restart never invents an effect. */
    restart() { if (p) p = { ...p, capture: unknown }; },
    /** Hold the reply of the n-th request (1-based) until released. */
    hold(at: number) { let release!: () => void; const promise = new Promise<void>(r => { release = r; }); gate = { at, release, promise }; return () => release(); },
    request,
    /** A ServiceHost answering only the step route. */
    host: {
      serviceRequest: async (q: { method: string; path: string; body?: string }) => {
        if (q.method !== 'POST' || q.path !== '/v1/setup/managed-step') return { status: 404, body: '{"error":"not-found"}' };
        const result = await request(q.body ?? '{}');
        if (result === 'drop') throw Object.assign(new Error('timeout'), { code: 'HOST_TIMEOUT' });
        return result;
      },
    },
  };
}

export interface FreshOptions {
  storeMode?: 'create' | 'retain'; directoryMissing?: boolean; sourceMode?: 'create' | 'reuse';
  /** The retained store's own capture setting; fresh setup never changes it. */
  retainedCapture?: 'on' | 'off';
  inspectPages?: number; operationId?: string;
}
/**
 * Version-2 fresh responder. Review, plan, modes and the first progress come from the frozen contract
 * fixtures (tests/fixtures/managed-fresh-steps.ts); later progress only moves position, sequence,
 * state and capture inside that shape. Every request must pass the shared version-2 shape check:
 * anything else (including a version-1 request) is recorded as a violation and answered 400.
 */
export function freshEngine(options: FreshOptions = {}) {
  const storeMode = options.storeMode ?? 'create', sourceMode = options.sourceMode ?? (storeMode === 'create' ? 'create' : 'reuse');
  const fixture = managedFreshStepFixtures(storeMode, options.directoryMissing ?? storeMode === 'create', sourceMode);
  const plan = fixture.plan;
  const retained: Capture | null = storeMode === 'retain' ? (options.retainedCapture ?? 'off') === 'on' ? on : off : null;
  // A retained review reports the store's observed setting; a store that does not exist yet stays unknown.
  const review = { ...fixture.review, capture: retained ?? unknown };
  const first = fixture.replies.prepared.progress!;
  const faults: EngineFaults = { fail: new Set(), drop: new Set(), lose: new Set(), unsettledEnable: false, failedReplay: new Set(), crash: new Set(), settlement: new Set(), portBusy: false };
  let p: ManagedFreshStepProgress | null = null;
  let page = 0;
  const requests: ManagedFreshStepRequest[] = [];
  const violations: unknown[] = [];
  let inflight = 0, maxInflight = 0;
  let gate: { at: number; release: () => void; promise: Promise<void> } | null = null;
  const index = (r: ManagedFreshStepRef | null) => r ? plan.findIndex(x => x.name === r.name) : -1;
  const progress = (patch: Partial<ManagedFreshStepProgress>): ManagedFreshStepProgress => ({ ...structuredClone(first), operationId: options.operationId ?? first.operationId, ...p, ...patch });
  const reply = (status: number, body: Partial<ManagedFreshStepResponse>) => ({ status, body: JSON.stringify({ version: 2, disposition: 'applied', inspection: null, progress: p, error: null, accounting: { securitySpawns: 4, elapsedMs: 9.5 }, ...body }) });
  const refuse = (status: number, stage: string, code: string) => reply(status, { disposition: 'refused', error: { stage: stage as never, code } });
  // New stores start off once created and turn on only at enable; retained capture never moves.
  const captureAfter = (done: ManagedFreshStepRef, before: Capture): Capture => retained ?? (done.name === 'create-store' ? off : done.name === 'enable' ? on : before);

  function handle(r: ManagedFreshStepRequest): { status: number; body: string } | 'drop' {
    if (faults.portBusy) { faults.portBusy = false; return refuse(503, 'lock', 'managed-step-port-busy'); }
    if (r.action === 'inspect') {
      if (p && p.recovery === 'review') return reply(200, { disposition: 'observed', inspection: { state: 'complete', stage: 'review', cursor: null, review: { ...review, expected: CAPTURE_REVIEW, capture: p.capture } } });
      if (p && p.state !== 'complete') return reply(200, { disposition: 'observed', inspection: { state: 'complete', stage: 'review', cursor: null, review } });
      const pages = options.inspectPages ?? 1;
      if (!('cursor' in r && r.cursor)) page = 0;
      page++;
      if (page < pages) return reply(200, { disposition: 'observed', progress: null, inspection: { state: 'incomplete', stage: MANAGED_FRESH_INSPECTION_STEPS[Math.min(page, 3)], cursor: `fresh-page-${page + 1}` } });
      return reply(200, { disposition: 'observed', progress: null, inspection: { state: 'complete', stage: 'review', cursor: null, review } });
    }
    if (r.action === 'status') return !r.operationId || r.operationId === p?.operationId ? reply(200, { disposition: 'observed', progress: p }) : { status: 404, body: '{"error":"not-found"}' };
    if (r.action === 'begin') {
      if (p) return refuse(409, 'journal', 'managed-step-conflict');
      if (r.expected !== review.expected) return refuse(409, 'review', 'managed-review-stale');
      p = progress({ operationId: r.operationId, sequence: 1 });
      return reply(200, {});
    }
    if (!p || r.operationId !== p.operationId) return { status: 404, body: '{"error":"not-found"}' };
    if (r.expectedSequence !== p.sequence) return refuse(409, 'journal', 'managed-step-conflict');
    if (r.action === 'pause' || r.action === 'abandon') {
      if (p.worker === 'active') return refuse(503, 'lock', 'managed-step-unsettled');
      const allowed = r.action === 'pause' ? ['pending', 'failed', 'running'] : ['pending', 'failed', 'running', 'paused'];
      if (!allowed.includes(p.state)) return refuse(409, 'journal', 'managed-step-conflict');
      p = progress({ sequence: p.sequence + 1, state: r.action === 'pause' ? 'paused' : 'abandoned', recovery: 'resume' });
      return reply(200, {});
    }
    if (r.action === 'resume') {
      if (p.worker === 'active') return refuse(503, 'lock', 'managed-step-unsettled');
      if (p.recovery === 'review' && !r.review) return refuse(503, p.step!.name, 'managed-step-unsettled');
      if (r.review && (p.recovery !== 'review' || r.review.expected !== CAPTURE_REVIEW || r.review.step !== p.step?.name)) return refuse(409, p.step?.name ?? 'review', 'managed-review-stale');
      if (!['pending', 'paused', 'failed', 'abandoned', 'running'].includes(p.state)) return refuse(409, 'journal', 'managed-step-conflict');
      p = progress({ sequence: p.sequence + 1, state: 'pending', diagnostic: null, recovery: 'continue' });
      return reply(200, {});
    }
    if (r.action !== 'advance') return refuse(400, 'journal', 'managed-step-conflict');
    if (p.state !== 'pending' || index(r.step) !== index(p.step)) return refuse(409, 'journal', 'managed-step-conflict');
    const step = p.step!, k = `${step.name}:0`;
    if (faults.lose.delete(k)) return 'drop';
    const crash = faults.crash.delete(k), settlement = faults.settlement.delete(k);
    if (crash || settlement) {
      p = progress({ state: 'running', worker: 'unsettled', effect: 'uncertain', diagnostic: settlement ? { stage: step.name, code: 'managed-step-deadline' } : null, recovery: 'reconcile' });
      return crash ? 'drop' : refuse(503, step.name, 'managed-step-deadline');
    }
    const failedReplay = faults.failedReplay.delete(k);
    if (faults.fail.delete(k) || failedReplay) {
      p = progress({ sequence: p.sequence + 1, state: 'failed', worker: 'unsettled', effect: 'uncertain', diagnostic: { stage: step.name, code: 'managed-step-deadline' }, recovery: 'reconcile' });
      return failedReplay ? reply(503, { disposition: 'replayed', error: p.diagnostic }) : refuse(503, step.name, 'managed-step-deadline');
    }
    if (step.name === 'enable' && faults.unsettledEnable) {
      faults.unsettledEnable = false;
      p = progress({ state: 'running', worker: 'unsettled', effect: 'uncertain', capture: off, diagnostic: { stage: 'enable', code: 'managed-step-unsettled' }, recovery: 'review' });
      return refuse(503, 'enable', 'managed-step-unsettled');
    }
    const next = plan[index(step) + 1] ?? null;
    p = next
      ? progress({ sequence: p.sequence + 1, state: 'pending', worker: 'idle', step: next, lastCompleted: step, effect: 'committed', capture: captureAfter(step, p.capture), diagnostic: null, recovery: 'continue' })
      : progress({ sequence: p.sequence + 1, state: 'complete', worker: 'idle', step: null, lastCompleted: step, effect: 'committed', capture: captureAfter(step, p.capture), diagnostic: null, recovery: 'none' });
    return faults.drop.delete(k) ? 'drop' : reply(200, {});
  }

  async function request(body: string) {
    const parsed = JSON.parse(body);
    const r = managedFreshStepRequest(parsed);
    if (!r) { violations.push(parsed); return { status: 400, body: '{"error":"managed-step-unsupported"}' }; }
    requests.push(r);
    inflight++; maxInflight = Math.max(maxInflight, inflight);
    try {
      if (gate && gate.at === requests.length) await gate.promise;
      return handle(r);
    } finally { inflight--; }
  }

  return {
    plan, review, faults, requests, violations, storeMode, sourceMode, retained,
    get progress() { return p; },
    set progress(value: ManagedFreshStepProgress | null) { p = value; },
    maxInflight: () => maxInflight,
    /** Cold observation preserves intent/state; a store that is not proven yet reads unknown. */
    restart() { if (p && !retained) p = { ...p, capture: unknown }; },
    hold(at: number) { let release!: () => void; const promise = new Promise<void>(r => { release = r; }); gate = { at, release, promise }; return () => release(); },
    request,
    host: {
      serviceRequest: async (q: { method: string; path: string; body?: string }) => {
        if (q.method !== 'POST' || q.path !== '/v1/setup/managed-step') return { status: 404, body: '{"error":"not-found"}' };
        const result = await request(q.body ?? '{}');
        if (result === 'drop') throw Object.assign(new Error('timeout'), { code: 'HOST_TIMEOUT' });
        return result;
      },
    },
  };
}
