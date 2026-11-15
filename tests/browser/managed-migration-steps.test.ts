// Setup client for the bounded step protocol: strict parsing of the shared contract fixtures,
// negotiation, one-request-at-a-time driving, explicit resume/review/pause/stop, and EN/RU copy.
// Node-level only; rendered layout, focus and themes are covered by managed-migration-qa.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { managedStepFixtures, managedOperationId } from '../fixtures/managed-steps.ts';
import { MANAGED_INSPECTION_STEPS, MANAGED_MIGRATION_STEPS, MANAGED_STEP_CODES, MANAGED_STEP_LIMITS, type ManagedStepProgress, type ManagedStepRequest } from '../../shared/managed-steps.ts';
import { StepDriver, currentProgress, managedStepCall, nextAction, newOperationId, parseManagedStepProgress, parseManagedStepResponse, replyAnswers, type StepIo } from '../../ui/shared/setup-steps.ts';
import { parseSetup } from '../../ui/shared/adapter.ts';
import { managedStepCopy, managedErrorText } from '../../ui/shared/managed-copy.ts';
import { migrationStepText, migrationTitle, setupErrorText } from '../../ui/shared/setup.ts';
import { stepEngine, CAPTURE_REVIEW } from './managed-migration-engine.ts';
import { setupRead } from './fixtures.ts';
import { MANAGED_ACTION_CODES } from '../../shared/progress.ts';

const fx = managedStepFixtures();
const host = (status: number, body: unknown, calls: unknown[] = []) => ({ serviceRequest: async (q: unknown) => { calls.push(q); return { status, body: typeof body === 'string' ? body : JSON.stringify(body) }; } });
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise<void>(r => setImmediate(r)); };

test('every shared contract reply parses exactly; errors override disposition', () => {
  for (const [name, reply] of Object.entries(fx.replies)) {
    const parsed = parseManagedStepResponse(structuredClone(reply));
    assert.deepEqual(parsed, reply, name);
  }
  for (const journey of fx.journeys.captureReview) assert.ok(parseManagedStepResponse(journey.reply));
});

test('real monotonic accounting accepts fractional durations but not invalid durations or fractional spawn counts',()=>{
  const base=fx.replies.prepared;
  const reply=(elapsedMs:unknown,securitySpawns:unknown=1)=>({...base,accounting:{elapsedMs,securitySpawns}});
  for(const ms of [0,0.001,12.5,18000])assert.ok(parseManagedStepResponse(reply(ms)),String(ms));
  for(const ms of [-1,NaN,Infinity,-Infinity,'12',null])assert.equal(parseManagedStepResponse(reply(ms)),undefined,String(ms));
  assert.equal(parseManagedStepResponse(reply(12.5,1.5)),undefined);
});

test('progress and responses fail closed on unknown keys, values and inconsistent combinations', () => {
  const base = fx.replies.disabled.progress!;
  const bad: Record<string, unknown> = {
    extraKey: { ...base, extra: 1 }, missingKey: (({ recovery: _r, ...rest }) => rest)(base),
    upperUuid: { ...base, operationId: 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA' }, negativeSequence: { ...base, sequence: -1 },
    fractionSequence: { ...base, sequence: 1.5 }, unknownState: { ...base, state: 'cancelled' }, unknownWorker: { ...base, worker: 'busy' },
    batchOnFixedStep: { ...base, step: { name: 'disable', batch: 1 } }, unknownStep: { ...base, step: { name: 'cleanup', batch: 0 } },
    stepKeyExtra: { ...base, step: { name: 'remove-discovery', batch: 0, path: '/x' } }, nullStepNotComplete: { ...base, step: null },
    completeWithStep: { ...base, state: 'complete' }, completeWithRecovery: { ...base, state: 'complete', step: null, recovery: 'resume' },
    unknownObservedAt: { ...base, capture: { state: 'unknown', observedAt: '2026-01-01T00:00:00Z' } }, onWithoutTime: { ...base, capture: { state: 'on', observedAt: null } },
    rawCode: { ...base, diagnostic: { stage: 'disable', code: 'EACCES: permission denied, open /private' } }, rawStage: { ...base, diagnostic: { stage: '/fixture/config', code: 'managed-step-deadline' } },
    activeNotRunning: { ...base, worker: 'active' }, reviewNotCapture: { ...base, recovery: 'review' },
  };
  for (const [name, value] of Object.entries(bad)) assert.equal(parseManagedStepProgress(value), undefined, name);
  const reply = fx.replies.deadline;
  for (const [name, value] of Object.entries({
    refusedWithoutError: { ...reply, error: null }, version2: { ...reply, version: 2 },
    extra: { ...reply, message: 'raw' }, accountingNegative: { ...reply, accounting: { securitySpawns: -1, elapsedMs: 0 } },
    incompleteWithoutCursor: { ...fx.replies.incomplete, inspection: { state: 'incomplete', stage: 'store', cursor: null } },
    reviewBadDigest: { ...fx.replies.reviewed, inspection: { ...fx.replies.reviewed.inspection, review: { ...fx.replies.reviewed.inspection!.review, expected: 'A'.repeat(64) } } },
    completeNotReviewStage: { ...fx.replies.reviewed, inspection: { ...fx.replies.reviewed.inspection, stage: 'store' } },
  })) assert.equal(parseManagedStepResponse(value), undefined, name);
});

test('transport: one POST to the step route, status/envelope agreement, honest unknown effects', async () => {
  const calls: any[] = [];
  const ok = await managedStepCall(host(200, fx.replies.prepared, calls), fx.requests.begin);
  assert.equal(ok.kind, 'reply');
  assert.deepEqual(calls.map(c => [c.method, c.path, JSON.parse(c.body)]), [['POST', '/v1/setup/managed-step', fx.requests.begin]]);
  assert.equal((await managedStepCall(host(503, fx.replies.deadline), { ...fx.requests.advance, expectedSequence: 3, step: { name: 'remove-discovery', batch: 0 } })).kind, 'reply');
  assert.equal((await managedStepCall(host(200, fx.replies.deadline), fx.requests.advance)).kind, 'invalid', 'a refusal must not use HTTP 200');
  assert.equal((await managedStepCall(host(409, fx.replies.prepared), fx.requests.begin)).kind, 'invalid', 'a success must use HTTP 200');
  const old = await managedStepCall(host(409, { error: 'managed-action-required' }), fx.requests.begin);
  assert.deepEqual(old, { kind: 'http', status: 409, code: 'managed-action-required' });
  assert.match(setupErrorText('managed-action-required'), /Update the extension and service together/);
  assert.equal((await managedStepCall({ serviceRequest: async () => { throw new Error('HOST_TIMEOUT'); } }, fx.requests.advance)).kind, 'dropped');
  assert.equal((await managedStepCall(host(502, '<html>gateway</html>'), fx.requests.advance)).kind, 'dropped');
  assert.equal((await managedStepCall(host(200, 'x'.repeat(MANAGED_STEP_LIMITS.responseBytes + 1)), fx.requests.status)).kind, 'invalid');
  assert.equal((await managedStepCall(host(200, '{"version":1'), fx.requests.status)).kind, 'invalid');
  // A reply for another operation or a sequence that does not follow the request is not an answer.
  const other = structuredClone(fx.replies.prepared); other.progress!.operationId = '22222222-2222-4222-8222-222222222222';
  assert.equal((await managedStepCall(host(200, other), fx.requests.begin)).kind, 'invalid');
  assert.equal(replyAnswers(fx.requests.advance, fx.replies.disabled), false, 'applied advance at sequence 1 cannot settle at 3');
  assert.equal(replyAnswers(fx.requests.reviewedResume, fx.replies.captureResumed), true);
  assert.equal(replyAnswers(fx.requests.reviewedResume, fx.replies.captureResumeReplay), true);
  assert.equal(replyAnswers(fx.requests.renewedAdvance, fx.replies.renewedReplayAfterDisable), true);
  // Invalid requests are never sent.
  const none: unknown[] = [];
  assert.equal((await managedStepCall(host(200, fx.replies.prepared, none), { ...fx.requests.begin, operationId: 'not-a-uuid' } as ManagedStepRequest)).kind, 'not-sent');
  assert.equal((await managedStepCall(host(200, fx.replies.prepared, none), { ...fx.requests.advance, step: { name: 'disable', batch: 2 } } as ManagedStepRequest)).kind, 'not-sent');
  assert.equal(none.length, 0);
  assert.match(newOperationId(), /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
});

test('negotiation: only the literal capability enables steps; embedded progress is strict', () => {
  const delivery = { kind: 'managed', revision: 1, configuration: 'unconfigured', migration: 'available', mode: 'unknown', observation: 'unknown', expectedVersion: '1.4.0' };
  const read = (d: unknown) => parseSetup(JSON.stringify(setupRead({ separateLifecycle: false, delivery: d })));
  assert.equal(read(delivery).delivery?.managedMigrationSteps, undefined, 'older service: existing flow');
  for (const value of [true, '1', 2, 0]) assert.equal(read({ ...delivery, managedMigrationSteps: value }).delivery?.managedMigrationSteps, undefined, String(value));
  assert.equal(read({ ...delivery, managedMigrationSteps: 1 }).delivery?.managedMigrationSteps, 1);
  const progress = fx.replies.pausedOff.progress;
  assert.deepEqual(read({ ...delivery, managedMigrationSteps: 1, migrationProgress: progress }).delivery?.migrationProgress, progress);
  assert.throws(() => read({ ...delivery, managedMigrationSteps: 1, migrationProgress: { ...progress, extra: true } }), /migration progress/);
  assert.throws(() => read({ ...delivery, migrationProgress: progress }), /migration progress/, 'progress without the capability');
  assert.throws(() => read({ ...delivery, managedMigrationSteps: 1, migrationProgress: null }), /migration progress/);
});

test('failed replay keeps its error, stops the driver and never renders as applied', async () => {
  const request: ManagedStepRequest = { version: 1, action: 'advance', operationId: managedOperationId, expectedSequence: 3, step: { name: 'remove-discovery', batch: 0 } };
  assert.equal((await managedStepCall(host(503, fx.replies.failedReplay), request)).kind, 'reply');
  assert.equal((await managedStepCall(host(200, fx.replies.failedReplay), request)).kind, 'invalid');
  const other = structuredClone(fx.replies.failedReplay);
  other.progress!.operationId = '22222222-2222-4222-8222-222222222222';
  assert.equal((await managedStepCall(host(503, other), request)).kind, 'invalid');
  const calls: unknown[] = [];
  // A failure refreshes status, but must never request the success refresh.
  const refresh: boolean[] = [];
  const stopped = new StepDriver({ send: r => managedStepCall(host(503, fx.replies.failedReplay, calls), r), context: () => 'k', changed: () => {}, refresh: complete => { refresh.push(complete); } });
  await stopped.continueRun(fx.replies.disabled.progress);
  assert.equal(calls.length, 1);
  assert.deepEqual(stopped.state.outcome, { code: 'managed-step-deadline', stage: 'remove-discovery', uncertain: false });
  assert.equal(stopped.state.busy, null);
  assert.equal(migrationTitle(stopped.state.progress!, false), 'failed');
  assert.deepEqual(refresh, [false]);
});

function driverFor(engine: ReturnType<typeof stepEngine>, extra: Partial<StepIo> = {}) {
  const log = { refresh: 0, complete: 0, stops: [] as string[] };
  let context: string | null = '["account","page",null,null]';
  const io: StepIo = {
    send: (request, current) => managedStepCall({ serviceRequest: (q) => current() ? engine.host.serviceRequest(q as never) : Promise.reject(new Error('Retired read')) }, request),
    context: () => context, changed: (stop) => { if (stop) log.stops.push(stop.reason); },
    refresh: (complete) => { log.refresh++; if (complete) log.complete++; }, operationId: () => managedOperationId, ...extra,
  };
  const driver = new StepDriver(io);
  return { driver, log, move: (next: string | null) => { context = next; } };
}
const actions = (engine: ReturnType<typeof stepEngine>) => engine.requests.map(r => r.action === 'advance' ? `advance:${r.step.name}:${r.step.batch}` : r.action === 'inspect' && 'cursor' in r && r.cursor ? 'inspect:next' : r.action);

test('pending continue permits reconciliation regardless of the worker projection, without loosening other states', () => {
  for (const name of ['resumedRunning', 'captureResumed', 'captureResumeReplay'] as const) {
    const p = fx.replies[name].progress!;
    assert.equal(p.worker, 'unsettled');
    assert.equal(nextAction(p), 'continue', name);
    assert.equal(nextAction({ ...p, state: 'running' }), 'status');
    assert.equal(nextAction({ ...p, state: 'failed', recovery: 'reconcile' }), 'resume');
    assert.equal(nextAction({ ...p, recovery: 'none' }), 'status');
  }
});

for (const fault of ['crash', 'settlement', 'fail'] as const) test(`${fault}: explicit resume retains uncertainty and sends the reconciling advance`, async () => {
  const engine = stepEngine();
  engine.faults[fault].add('remove-discovery:0');
  const { driver } = driverFor(engine);
  await driver.inspect('begin'); driver.setAck(true); await driver.confirmBegin();
  await driver.status(driver.state.progress);
  const p = driver.state.progress!;
  assert.equal(p.worker, 'unsettled');
  assert.equal(p.state, fault === 'fail' ? 'failed' : 'running');
  assert.equal(nextAction(p), 'resume');
  const n = engine.requests.length;
  await driver.resume(p);
  assert.deepEqual(actions(engine).slice(n, n + 2), ['resume', 'advance:remove-discovery:0']);
  assert.equal(driver.state.progress?.state, 'complete');
  assert.equal(engine.maxInflight(), 1);
});

test('fenced pause and resume retain the unresolved effect; Continue can reopen the resumed journey', async () => {
  const engine = stepEngine();
  engine.progress = structuredClone(fx.replies.restarted.progress);
  const { driver } = driverFor(engine);
  const paused = await managedStepCall(engine.host, { version: 1, action: 'pause', operationId: managedOperationId, expectedSequence: engine.progress!.sequence });
  assert.equal(paused.kind, 'reply');
  assert.equal(engine.progress?.worker, 'unsettled');
  assert.equal(nextAction(engine.progress), 'resume');
  const resumed = await managedStepCall(engine.host, { version: 1, action: 'resume', operationId: managedOperationId, expectedSequence: engine.progress!.sequence });
  assert.equal(resumed.kind, 'reply');
  assert.equal(engine.progress?.worker, 'unsettled');
  assert.equal(nextAction(engine.progress), 'continue');
  await driver.continueRun(engine.progress);
  assert.equal(actions(engine)[2], 'advance:remove-discovery:0');
  assert.equal(driver.state.progress?.state, 'complete');
});

test('success: inspection pages, explicit consent, then one request at a time to verified completion', async () => {
  const engine = stepEngine({ inspectPages: 3 });
  const { driver, log } = driverFor(engine);
  await driver.inspect('begin', { storeRoot: '/fixture/store' });
  assert.deepEqual(engine.requests[0], { version: 1, action: 'inspect', storeRoot: '/fixture/store' });
  assert.equal(driver.state.review?.kind, 'begin');
  await driver.confirmBegin();
  assert.equal(engine.requests.length, 3, 'no begin without acknowledgement');
  driver.setAck(true);
  await driver.confirmBegin();
  assert.deepEqual(actions(engine), ['inspect', 'inspect:next', 'inspect:next', 'begin', ...engine.plan.slice(1).map(s => `advance:${s.name}:${s.batch}`)]);
  assert.equal(engine.maxInflight(), 1);
  assert.equal(driver.state.progress?.state, 'complete');
  assert.equal(driver.state.progress?.capture.state, 'on');
  assert.equal(driver.state.busy, null);
  assert.equal(log.complete, 1);
  const before = engine.requests.length; await settle();
  assert.equal(engine.requests.length, before, 'no continuation, status loop or retry after completion');
});

test('failure at a middle step stops at once with its stage/code; explicit Resume reconciles and finishes', async () => {
  const engine = stepEngine();
  engine.faults.fail.add('remove-discovery:2');
  const { driver } = driverFor(engine);
  await driver.inspect('begin'); driver.setAck(true); await driver.confirmBegin();
  assert.equal(actions(engine).at(-1), 'advance:remove-discovery:2');
  assert.deepEqual(driver.state.outcome, { code: 'managed-step-deadline', stage: 'remove-discovery', uncertain: false });
  assert.equal(driver.state.progress?.state, 'failed');
  assert.equal(driver.state.progress?.capture.state, 'unknown');
  assert.equal(nextAction(driver.state.progress), 'resume');
  const count = engine.requests.length; await settle();
  assert.equal(engine.requests.length, count, 'no automatic retry');
  await driver.resume(driver.state.progress);
  assert.deepEqual(actions(engine).slice(count, count + 2), ['resume', 'advance:remove-discovery:2']);
  assert.equal(driver.state.progress?.state, 'complete');
  assert.equal(driver.state.outcome, null);
});

test('pause: the step in flight settles, then exactly one pause; Keep going continues explicitly', async () => {
  const engine = stepEngine();
  const release = engine.hold(3); // inspect, begin, then hold the first advance's reply
  const { driver, log } = driverFor(engine);
  await driver.inspect('begin'); driver.setAck(true);
  const running = driver.confirmBegin();
  await settle();
  driver.requestPause();
  assert.equal(driver.state.confirm, 'pause');
  await driver.confirmStop(driver.state.progress);
  assert.equal(driver.state.pauseAfter, true);
  release(); await running;
  assert.deepEqual(actions(engine).slice(-2), ['advance:expectation:0', 'pause']);
  assert.equal(driver.state.progress?.state, 'paused');
  assert.equal(driver.state.progress?.capture.state, 'on', 'paused before disable keeps capture on');
  assert.equal(log.stops.at(-1), 'stopped');
  // Held without confirming: the run stops queuing; Keep going is the explicit continuation.
  await driver.resume(driver.state.progress);
  assert.equal(driver.state.progress?.state, 'complete');
  const second = stepEngine();
  const r2 = second.hold(4);
  const d2 = driverFor(second).driver;
  await d2.inspect('begin'); d2.setAck(true);
  const run2 = d2.confirmBegin(); await settle();
  d2.requestPause(); r2(); await run2;
  assert.equal(d2.state.busy, null); assert.equal(d2.state.confirm, 'pause'); assert.equal(d2.state.hold, true);
  const held = second.requests.length;
  await d2.cancelConfirm(d2.state.progress);
  assert.ok(second.requests.length > held);
  assert.equal(d2.state.progress?.state, 'complete');
});

test('stop (abandon) after capture is off keeps the warning state; Resume is explicit', async () => {
  const engine = stepEngine();
  engine.faults.fail.add('remove-discovery:0');
  const { driver } = driverFor(engine);
  await driver.inspect('begin'); driver.setAck(true); await driver.confirmBegin();
  driver.requestAbandon(driver.state.progress);
  assert.equal(driver.state.confirm, 'abandon');
  await driver.cancelConfirm(driver.state.progress);
  assert.equal(driver.state.confirm, null);
  const before = engine.requests.length;
  assert.equal(before, engine.requests.length, 'cancel sends nothing');
  driver.requestAbandon(driver.state.progress);
  await driver.confirmStop(driver.state.progress);
  assert.equal(actions(engine).at(-1), 'abandon');
  assert.equal(driver.state.progress?.state, 'abandoned');
  assert.notEqual(driver.state.progress?.capture.state, 'on');
  assert.equal(nextAction(driver.state.progress), 'resume');
  await driver.resume(driver.state.progress);
  assert.equal(driver.state.progress?.state, 'complete');
});

test('restart: a reopened frame shows retained progress and continues only after explicit Resume', async () => {
  const engine = stepEngine();
  engine.faults.crash.add('remove-discovery:0');
  const first = driverFor(engine);
  await first.driver.inspect('begin'); first.driver.setAck(true); await first.driver.confirmBegin();
  assert.deepEqual(first.driver.state.outcome, { code: 'managed-step-no-reply', stage: null, uncertain: true });
  engine.restart();
  // New frame: nothing is sent until the user acts; status read supplies the progress.
  const reopened = driverFor(engine);
  const shown = currentProgress(reopened.driver.state.progress, engine.progress!);
  assert.equal(shown?.recovery, 'reconcile'); assert.equal(shown?.capture.state, 'unknown');
  const count = engine.requests.length; await settle();
  assert.equal(engine.requests.length, count);
  await reopened.driver.resume(shown);
  assert.equal(engine.requests[count].action, 'resume');
  assert.equal(reopened.driver.state.progress?.state, 'complete');
});

test('reviewed resume: fresh review of the exact uncertain decision, then one renewed advance', async () => {
  const engine = stepEngine();
  engine.faults.unsettledEnable = true;
  const { driver } = driverFor(engine);
  await driver.inspect('begin'); driver.setAck(true); await driver.confirmBegin();
  assert.deepEqual(driver.state.outcome, { code: 'managed-step-unsettled', stage: 'enable', uncertain: false });
  const p = driver.state.progress!;
  assert.equal(nextAction(p), 'review');
  await driver.resume(p);
  assert.equal(actions(engine).at(-1), 'advance:enable:0', 'ordinary resume is not offered for a capture review');
  await driver.inspect('capture', { progress: p });
  assert.equal(driver.state.review?.kind, 'capture');
  await driver.confirmCapture();
  assert.equal(actions(engine).at(-1), 'inspect', 'no reviewed resume without acknowledgement');
  driver.setAck(true); await driver.confirmCapture();
  const resumeAt = engine.requests.findLastIndex(r => r.action === 'resume');
  assert.deepEqual(engine.requests[resumeAt], { version: 1, action: 'resume', operationId: managedOperationId, expectedSequence: p.sequence, review: { confirmed: true, expected: CAPTURE_REVIEW, step: 'enable' } });
  assert.deepEqual(actions(engine).slice(resumeAt + 1), ['advance:enable:0', 'advance:reconcile:0']);
  assert.equal(driver.state.progress?.state, 'complete');
  // A review describing another sequence is stale: no consent card.
  const stale = stepEngine(); stale.faults.unsettledEnable = true;
  const d = driverFor(stale).driver;
  await d.inspect('begin'); d.setAck(true); await d.confirmBegin();
  const shown = { ...d.state.progress!, sequence: d.state.progress!.sequence - 1 };
  await d.inspect('capture', { progress: shown });
  assert.equal(d.state.review, null);
  assert.equal(d.state.outcome?.code, 'managed-review-stale');
});

test('dropped reply: no repeat; status observes the durable result; retirement ignores late replies', async () => {
  const engine = stepEngine();
  engine.faults.drop.add('expectation:0');
  const { driver } = driverFor(engine);
  await driver.inspect('begin'); driver.setAck(true); await driver.confirmBegin();
  assert.equal(actions(engine).at(-1), 'advance:expectation:0');
  assert.equal(driver.state.outcome?.uncertain, true);
  assert.equal(nextAction(driver.state.progress), 'continue', 'stale local state alone would continue; the UI offers status first');
  await driver.status(driver.state.progress);
  assert.equal(actions(engine).at(-1), 'status');
  assert.equal(driver.state.outcome, null);
  assert.equal(driver.state.progress?.lastCompleted?.name, 'expectation');
  assert.equal(nextAction(driver.state.progress), 'continue');
  const recoveredAt = engine.requests.length;
  await driver.continueRun(driver.state.progress);
  assert.equal(actions(engine)[recoveredAt], 'advance:disable:0');
  assert.equal(driver.state.progress?.state, 'complete');
  // Retirement: context moves while a reply is held; the late reply never queues another step.
  const late = stepEngine();
  const release = late.hold(3);
  const t = driverFor(late);
  await t.driver.inspect('begin'); t.driver.setAck(true);
  const run = t.driver.confirmBegin(); await settle();
  t.move('["account","page","other-session",null]');
  release(); await run; await settle();
  assert.deepEqual(actions(late), ['inspect', 'begin', 'advance:expectation:0'], 'the held step was sent once; nothing follows its late reply');
  assert.equal(t.driver.state.busy, null);
  assert.equal(t.driver.state.outcome?.code, 'managed-step-retired');
  assert.equal(t.log.refresh, 1, 'one status re-read, not a loop');
});

test('no advance without strictly newer settled progress; observed replays stop the run', async () => {
  const replies = [fx.replies.prepared, { ...fx.replies.prepared, disposition: 'replayed' }];
  let n = 0;
  const calls: unknown[] = [];
  const driver = new StepDriver({ send: (r, current) => managedStepCall({ serviceRequest: async (q) => { calls.push(q); assert.ok(current()); const body = r.action === 'inspect' ? fx.replies.reviewed : replies[Math.min(n++, 1)]; return { status: 200, body: JSON.stringify(body) }; } }, r), context: () => 'k', changed: () => {}, refresh: () => {}, operationId: () => managedOperationId });
  await driver.inspect('begin'); driver.setAck(true); await driver.confirmBegin();
  assert.equal(calls.length, 3, 'inspect, begin, one advance whose replay did not move the sequence');
  assert.equal(driver.state.busy, null);
});

test('copy: EN/RU for every stage and code, short step text, no paths', () => {
  const en = managedStepCopy('en'), ru = managedStepCopy('ru');
  for (const stage of [...MANAGED_MIGRATION_STEPS, ...MANAGED_INSPECTION_STEPS, 'journal', 'lock']) {
    assert.ok(en.stages[stage] && ru.stages[stage] && en.stages[stage] !== ru.stages[stage], stage);
  }
  for (const code of [...MANAGED_STEP_CODES, 'managed-step-no-reply', 'managed-step-reply-invalid', 'managed-step-retired', 'managed-inspection-incomplete']) {
    assert.ok(managedErrorText(code, 'en') && managedErrorText(code, 'ru') && managedErrorText(code, 'en') !== managedErrorText(code, 'ru'), code);
  }
  for (const code of MANAGED_ACTION_CODES) {
    assert.doesNotMatch(setupErrorText(code, 'en'), /Setup could not finish/, code);
    assert.notEqual(setupErrorText(code, 'en'), setupErrorText(code, 'ru'), code);
  }
  assert.match(managedErrorText('managed-migration-conflict')!, /installation changed.*Check the folders again before retrying/);
  const strings = (o: unknown): string[] => typeof o === 'string' ? [o] : typeof o === 'function' ? [String((o as (...a: unknown[]) => string)(3, 9, 'X', 2))] : o && typeof o === 'object' ? Object.values(o).flatMap(strings) : [];
  for (const s of [...strings(en), ...strings(ru)]) assert.doesNotMatch(s, /[\\/]|[A-Za-z]:\\/, s);
  const p = fx.replies.disabled.progress!;
  assert.equal(migrationStepText({ ...p, step: { name: 'disable', batch: 0 } }), 'Step 3 of 9: Turning off capture');
  assert.equal(migrationStepText(p, 'ru'), 'Шаг 5 из 9: Удаление старых файлов плагина (часть 1)');
  assert.equal(migrationTitle(fx.replies.pausedOff.progress!, false), 'paused');
  assert.equal(migrationTitle(fx.replies.restarted.progress!, false), 'interrupted');
  assert.equal(migrationTitle(fx.replies.running.progress!, false), 'active');
  assert.equal(migrationTitle(fx.replies.enableUnsettled.progress!, false), 'review');
  assert.equal(migrationTitle(p, true), 'running');
  assert.equal(nextAction(fx.replies.running.progress), 'status');
  assert.equal(nextAction(fx.replies.complete.progress), null);
  assert.equal(nextAction(fx.replies.abandonedOff.progress), 'resume');
  const pr = (patch: Partial<ManagedStepProgress>) => ({ ...p, ...patch });
  assert.equal(currentProgress(pr({ sequence: 5 }), pr({ sequence: 4 }))?.sequence, 5);
  assert.equal(currentProgress(pr({ sequence: 4 }), pr({ sequence: 6 }))?.sequence, 6);
});
