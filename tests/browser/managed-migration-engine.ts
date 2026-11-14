// Synthetic step-protocol responder for Setup client tests and rendered QA. It follows the frozen
// contract's state graph and envelopes closely enough to exercise the client; it is NOT the engine,
// performs no filesystem work and proves nothing about Windows timing or fresh authority.
import type { ManagedStepProgress, ManagedStepRef, ManagedStepRequest, ManagedStepResponse } from '../../shared/managed-steps.ts';
import { managedOperationId, managedReview, managedStepPlan } from '../fixtures/managed-steps.ts';

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
}

export function stepEngine(options: { plan?: ManagedStepRef[]; inspectPages?: number; operationId?: string } = {}) {
  const plan = options.plan ?? managedStepPlan;
  const faults: EngineFaults = { fail: new Set(), drop: new Set(), lose: new Set(), unsettledEnable: false };
  let p: ManagedStepProgress | null = null;
  let page = 0;
  const requests: ManagedStepRequest[] = [];
  let inflight = 0, maxInflight = 0;
  let gate: { at: number; release: () => void; promise: Promise<void> } | null = null;
  const index = (r: ManagedStepRef | null) => r ? plan.findIndex(x => x.name === r.name && x.batch === r.batch) : -1;
  const progress = (patch: Partial<ManagedStepProgress>): ManagedStepProgress => ({ operationId: options.operationId ?? managedOperationId, sequence: 0, state: 'pending', worker: 'idle', step: plan[1], lastCompleted: plan[0], effect: 'none', capture: on, diagnostic: null, recovery: 'continue', ...p, ...patch });
  const reply = (status: number, body: Partial<ManagedStepResponse>) => ({ status, body: JSON.stringify({ version: 1, disposition: 'applied', inspection: null, progress: p, error: null, accounting: { securitySpawns: 3, elapsedMs: 12 }, ...body }) });
  const refuse = (status: number, stage: string, code: string) => reply(status, { disposition: 'refused', error: { stage: stage as never, code } });
  const captureAfter = (done: ManagedStepRef, before: Capture): Capture => done.name === 'disable' ? off : done.name === 'enable' ? on : before;

  function handle(r: ManagedStepRequest): { status: number; body: string } | 'drop' {
    if (r.action === 'inspect') {
      if (p && p.recovery === 'review') return reply(200, { disposition: 'observed', inspection: { state: 'complete', stage: 'review', cursor: null, review: { ...managedReview, expected: CAPTURE_REVIEW } } });
      if (p && p.state !== 'complete') return reply(200, { disposition: 'observed', inspection: { state: 'complete', stage: 'review', cursor: null, review: managedReview } });
      const pages = options.inspectPages ?? 1;
      if (!('cursor' in r && r.cursor)) page = 0;
      page++;
      if (page < pages) return reply(200, { disposition: 'observed', progress: null, inspection: { state: 'incomplete', stage: page === 1 ? 'legacy-discovery' : 'legacy-releases', cursor: `inspection-page-${page + 1}` } });
      return reply(200, { disposition: 'observed', progress: null, inspection: { state: 'complete', stage: 'review', cursor: null, review: managedReview } });
    }
    if (r.action === 'status') return p && (!r.operationId || r.operationId === p.operationId) ? reply(200, { disposition: 'observed' }) : { status: 404, body: '{"error":"not-found"}' };
    if (r.action === 'begin') {
      if (p) return refuse(409, 'journal', 'managed-step-conflict');
      if (r.expected !== managedReview.expected) return refuse(409, 'review', 'managed-review-stale');
      p = progress({ operationId: r.operationId, sequence: 1 });
      return reply(200, {});
    }
    if (!p || r.operationId !== p.operationId) return { status: 404, body: '{"error":"not-found"}' };
    if (r.expectedSequence !== p.sequence) return refuse(409, 'journal', 'managed-step-conflict');
    if (r.action === 'pause' || r.action === 'abandon') {
      if (p.state === 'complete' || p.worker === 'active' || (r.action === 'pause' && p.state === 'abandoned')) return refuse(409, 'journal', 'managed-step-conflict');
      p = progress({ sequence: p.sequence + 1, state: r.action === 'pause' ? 'paused' : 'abandoned', recovery: 'resume' });
      return reply(200, {});
    }
    if (r.action === 'resume') {
      if (p.recovery === 'review' && !r.review) return refuse(503, p.step!.name, 'managed-step-unsettled');
      if (r.review && (p.recovery !== 'review' || r.review.expected !== CAPTURE_REVIEW || r.review.step !== p.step?.name)) return refuse(409, p.step?.name ?? 'review', 'managed-review-stale');
      if (!['pending', 'paused', 'failed', 'abandoned', 'running'].includes(p.state)) return refuse(409, 'journal', 'managed-step-conflict');
      p = progress({ sequence: p.sequence + 1, state: 'pending', worker: 'idle', diagnostic: null, recovery: 'continue' });
      return reply(200, {});
    }
    if (r.action !== 'advance') return refuse(400, 'journal', 'managed-step-conflict');
    if (p.state !== 'pending' || index(r.step) !== index(p.step)) return refuse(409, 'journal', 'managed-step-conflict');
    const step = p.step!, k = key(step);
    if (faults.lose.delete(k)) return 'drop';
    if (faults.fail.delete(k)) {
      p = progress({ sequence: p.sequence + 1, state: 'failed', worker: 'unsettled', effect: 'uncertain', capture: unknown, diagnostic: { stage: step.name, code: 'managed-step-deadline' }, recovery: 'reconcile' });
      return refuse(503, step.name, 'managed-step-deadline');
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
    /** Service restart during a step: retained intent, unsettled worker, capture unknown. */
    restart() { if (p && p.state !== 'complete') p = { ...p, state: 'running', worker: 'unsettled', effect: 'uncertain', capture: unknown, diagnostic: null, recovery: 'reconcile' }; },
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