import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { actionablePoint, nativeActions, partialCapture, readyRosterSnapshot, rosterSnapshot, screenshotFrame, screenshotSection, stableScreenshot, type NativeAdapter } from './subagent-activity-harness.ts';

const ids = { a: 'A', b: 'B', c1: 'C1', c2: 'C2', bound: 'C1', n1: 'N1' };
/** The smallest guest DOM rosterSnapshot reads: section, rows with facts, summary parts, plan state. */
function guest() {
  let rows: any[] = [], summary: string[] = [], detail = false, loading = false, state = 'ready', text = '';
  const section = { dataset: { get state() { return state; }, testid: 'subagent-activity' }, get textContent() { return text; },
    querySelectorAll: (s: string) => s.includes('subagent-count') ? summary.map((kind) => ({ dataset: { kind } })) : rows };
  const document = { documentElement: { scrollWidth: 300 }, querySelector: (s: string) => s.includes('subagent-activity') ? section : s.includes('plan-plan-alpha') ? detail : s.includes('detail-loading') ? loading : null };
  const row = (session: string, ran: string, facts: string[], featured = true, extra: object = {}) => ({ dataset: { testid: `subagent-row-run-${session}`, session, run: 'r', ran, depth: '1', ...extra }, closest: () => featured ? null : {}, querySelectorAll: () => facts.map((fact) => ({ dataset: { fact } })) });
  const populate = () => { summary = ['finished']; rows = [row('C1', 'finished', ['ran']), row('C2', 'finished', ['ran'], false)]; };
  const ready = () => { detail = true; loading = false; state = 'ready'; summary = ['finished', 'failed', 'interrupted']; rows = [row('C1', 'finished', ['ran', 'accepted']), row('C2', 'finished', ['ran'], false), row('R', 'finished', ['ran', 'claimed'], false)]; };
  return { evaluate: async (expression: string) => runInNewContext(expression, { document, innerWidth: 360 }), populate, ready, detail: () => { detail = true; },
    invalidate: () => { loading = true; state = 'host-only'; }, noPlan: () => { detail = false; }, say: (t: string) => { text = t; }, wrong: () => { rows[0] = row('C1', 'finished', ['ran', 'accepted'], true, { now: 'active' }); } };
}

/** Controlled clock at the same bounded-predicate seam used by the native host. */
function bounded(steps: (() => void)[], limit = steps.length) {
  return async (condition: () => Promise<boolean>) => {
    for (let tick = 0; tick < limit; tick++) { steps[tick]?.(); if (await condition()) return true; }
    return false;
  };
}
const noSend = async () => { throw new Error('unexpected dispatch'); };
for (const order of ['rows-first', 'detail-first']) test(`roster ready snapshot: ${order}`, async () => {
  const g = guest();
  if (order === 'rows-first') g.populate(); else g.detail();
  const early = await g.evaluate(`(${rosterSnapshot.toString()})(${JSON.stringify(ids)})`);
  assert.equal(early.ready, false);
  const result = await readyRosterSnapshot({ evaluate: g.evaluate, send: noSend, wait: bounded([() => {}, g.ready]) }, 'panel', ids);
  assert.equal(result.ready, true);
  assert.equal(JSON.stringify(result.rows.find((r: any) => r.session === 'C1')?.facts), '["ran","accepted"]');
  assert.equal(result.rows.find((r: any) => r.session === 'C2')?.featured, false);
  assert.ok(result.rows.some((r: any) => r.facts.includes('claimed')));
  assert.equal(JSON.stringify(result.summary), '["finished","failed","interrupted"]');
  assert.notDeepEqual(result, early);
});
for (const state of ['no-accepted', 'host-only', 'no-plan']) test(`roster readiness rejects ${state}`, async () => {
  const g = guest(); g.detail(); g.populate();
  if (state === 'host-only') { g.ready(); g.invalidate(); }
  // Every other fact ready, but no plan article: never a roster to assert.
  if (state === 'no-plan') { g.ready(); g.noPlan(); }
  await assert.rejects(readyRosterSnapshot({ evaluate: g.evaluate, send: noSend, wait: bounded([() => {}]) }, 'panel', ids), /roster-readiness-timeout/);
});
test('invalidation before capture cannot reuse a prior ready roster', async () => {
  const g = guest(); g.ready();
  assert.equal((await g.evaluate(`(${rosterSnapshot.toString()})(${JSON.stringify(ids)})`)).ready, true);
  g.invalidate();
  const result = await readyRosterSnapshot({ evaluate: g.evaluate, send: noSend, wait: bounded([() => {}, g.ready]) }, 'panel', ids);
  assert.equal(result.ready, true);
});
test('removed clutter and prompt/output canaries are reported, not hidden', async () => {
  const g = guest(); g.ready();
  for (const [t, clutter, canary] of [['Finished · 3 minutes ago', false, false], ['Unassigned in this plan', true, false], ['Unknown now · last seen idle', true, false], ['This session · Idle', true, false], ['Synthetic fixed response.', false, true], ['Synthetic unassigned', false, false]] as const) {
    g.say(t);
    const r = await g.evaluate(`(${rosterSnapshot.toString()})(${JSON.stringify(ids)})`);
    assert.equal(JSON.stringify([r.clutter, r.canary]), JSON.stringify([clutter, canary]), t);
  }
});
test('a ready roster with a wrong fact still fails the semantic assertion', async () => {
  const g = guest(); g.ready(); g.wrong();
  const result = await readyRosterSnapshot({ evaluate: g.evaluate, send: noSend, wait: bounded([() => {}]) }, 'panel', ids);
  assert.equal(result.ready, true);
  assert.throws(() => assert.equal(result.rows.find((r: any) => r.session === 'C1')?.now, null));
});
test('ready immediately before deadline succeeds; unresolved at deadline fails', async () => {
  const g = guest();
  assert.equal((await readyRosterSnapshot({ evaluate: g.evaluate, send: noSend, wait: bounded([() => {}, g.ready], 2) }, 'panel', ids)).ready, true);
  const late = guest();
  await assert.rejects(readyRosterSnapshot({ evaluate: late.evaluate, send: noSend, wait: bounded([() => {}, late.ready], 1) }, 'panel', ids), /timeout/);
});

function targetFixture() {
  let blocked = false, hit: any;
  const target: any = { isConnected: true, getAttribute: () => null, parentElement: null, closest: () => blocked ? {} : null, scrollIntoView() {}, getBoundingClientRect: () => ({ left: 10, right: 110, top: 10, bottom: 30 }), contains: (n: any) => n === target || n === child };
  const child: any = { closest: () => target };
  hit = child;
  const style = { display: 'flex', visibility: 'visible', pointerEvents: 'auto', opacity: '1' };
  const sample = (targets: any[] = [target], scroll = false) => runInNewContext(`(${actionablePoint.toString()})(targets,scroll)`, { targets, scroll, getComputedStyle: () => style, innerWidth: 360, innerHeight: 800, document: { elementFromPoint: () => hit } });
  return { target, child, style, sample, block: () => { blocked = true; }, unblock: () => { blocked = false; }, hit: (n: any) => { hit = n; } };
}
for (const kind of ['missing', 'detached', 'zero-size', 'hidden', 'disabled', 'inert', 'pointer-events-none', 'occluded', 'nested-control']) test(`actionability rejects ${kind}`, () => {
  const f = targetFixture();
  if (kind === 'detached') f.target.isConnected = false;
  if (kind === 'zero-size') f.target.getBoundingClientRect = () => ({ left: 0, right: 0, top: 0, bottom: 0 });
  if (kind === 'hidden') f.style.visibility = 'hidden';
  if (kind === 'disabled' || kind === 'inert') f.block();
  if (kind === 'pointer-events-none') f.style.pointerEvents = 'none';
  if (kind === 'occluded') f.hit({});
  if (kind === 'nested-control') f.child.closest = () => f.child;
  assert.equal(f.sample(kind === 'missing' ? [] : [f.target]), null);
});
test('valid descendant hit and later actionable representation are accepted', () => {
  const f = targetFixture();
  assert.deepEqual({ ...f.sample([{ ...f.target, isConnected: false }, f.target]) }, { x: 60, y: 20 });
});
function adapter(points: any[], selected = true, failSend = false) {
  const sends: any[] = [], evaluations: string[] = [];
  const a: NativeAdapter = {
    evaluate: async expression => { evaluations.push(expression); return expression.startsWith('location.href') ? selected : expression.startsWith('document.querySelector') ? false : points.shift() ?? null; },
    send: async (method, params) => { if (failSend) throw new Error('protocol error'); sends.push({ method, params }); },
    wait: bounded([() => {}]),
  };
  return { a, sends, evaluations };
}
test('dispatch uses post-scroll re-resolved geometry and one press/release pair', async () => {
  const f = adapter([{ x: 1, y: 2 }, { x: 3, y: 4 }]);
  await nativeActions(f.a).select('B', 'select B');
  assert.equal(f.sends.length, 2);
  assert.deepEqual(f.sends.map(s => s.params.type), ['mousePressed', 'mouseReleased']);
  assert.ok(f.sends.every(s => s.params.x === 3 && s.params.y === 4));
});
test('disappearing target or non-actionable target never dispatches', async () => {
  for (const points of [[null], [{ x: 1, y: 2 }, null]]) {
    const f = adapter(points);
    await assert.rejects(nativeActions(f.a).click('[]', 'target'), /non-actionable-target/);
    assert.equal(f.sends.length, 0);
  }
});
test('protocol failure propagates', async () => {
  const f = adapter([{ x: 1, y: 2 }, { x: 1, y: 2 }], true, true);
  await assert.rejects(nativeActions(f.a).click('[]', 'target'), /protocol error/);
});
test('successful dispatch without host selection fails before guest assertions', async () => {
  const f = adapter([{ x: 1, y: 2 }, { x: 1, y: 2 }], false);
  await assert.rejects(nativeActions(f.a).select('B', 'select B'), /host-selection-timeout/);
  assert.equal(f.sends.length, 2);
});

test('actionability wait sends no input while an ancestor blocks, then clicks once', async () => {
  const f = targetFixture(); f.block();
  const sends: object[] = [];
  let polls = 0;
  const a: NativeAdapter = {
    evaluate: async () => f.sample(),
    send: async (_method, params) => { sends.push(params!); },
    wait: bounded([
      () => { polls++; assert.equal(sends.length, 0); },
      () => { polls++; assert.equal(sends.length, 0); },
      () => { polls++; assert.equal(sends.length, 0); f.unblock(); },
    ]),
  };
  await nativeActions(a).click('[target]', 'session');
  assert.equal(polls, 3);
  assert.equal(sends.length, 2);
});

test('actionability wait fails at its bound if the ancestor never clears', async () => {
  const f = targetFixture(); f.block();
  let polls = 0;
  const a: NativeAdapter = {
    evaluate: async () => f.sample(), send: noSend,
    wait: bounded([() => { polls++; }, () => { polls++; }]),
  };
  await assert.rejects(nativeActions(a).click('[target]', 'session'), /non-actionable-target/);
  assert.equal(polls, 2);
});

test('disabled dragging does not disable the separate nested selection action', () => {
  const f = targetFixture();
  const attrs: Record<string, string> = { 'aria-disabled': 'true', 'aria-roledescription': 'draggable' };
  f.target.parentElement = { parentElement: null, getAttribute: (key: string) => attrs[key] };
  assert.ok(f.sample());
});

test('own disabled selection and an ordinary disabled ancestor still fail', () => {
  const f = targetFixture();
  f.target.getAttribute = (key: string) => key === 'aria-disabled' ? 'true' : 'draggable';
  assert.equal(f.sample(), null);
  f.target.getAttribute = () => null;
  f.target.parentElement = { parentElement: null, getAttribute: (key: string) => key === 'aria-disabled' ? 'true' : null };
  assert.equal(f.sample(), null);
});

test('screenshot waits for semantic readiness and consecutive stable geometry', async () => {
  const samples = [
    { ready: false, signature: 'loading' },
    { ready: true, signature: 'unknown-old-layout' },
    { ready: true, signature: 'unknown-new-layout' },
    { ready: true, signature: 'unknown-new-layout' },
  ];
  const seen: object[] = [];
  let reads = 0;
  const result = await stableScreenshot({ evaluate: async () => {}, send: noSend, wait: bounded(samples.map(() => () => {})) }, async () => { reads++; return samples.shift()!; }, s => { seen.push(s); });
  assert.equal(result.signature, 'unknown-new-layout');
  assert.equal(reads, 4);
  assert.equal(seen.length, 4);
});

test('screenshot invalidation resets stability; a permanent gap fails boundedly', async () => {
  const samples = [ { ready: true, signature: 'unknown' }, { ready: false, signature: 'unknown' }, { ready: true, signature: 'unknown' } ];
  await assert.rejects(stableScreenshot({ evaluate: async () => {}, send: noSend, wait: bounded(samples.map(() => () => {})) }, async () => samples.shift()!, () => {}), /screenshot-state-not-stable/);
});

test('screenshot protocol failure propagates without retrying observation', async () => {
  let reads = 0;
  await assert.rejects(stableScreenshot({ evaluate: async () => {}, send: noSend, wait: bounded([() => {}, () => {}]) }, async () => { reads++; throw new Error('render handshake failed'); }, () => {}), /handshake failed/);
  assert.equal(reads, 1);
});

test('actual section reader requires a recorded roster, the requested mark and finished rendering', () => {
  let observation = false, animation = false, loaded = true, state = 'ready';
  const section = {
    dataset: { get state() { return state; }, testid: 'subagent-activity' },
    querySelector: () => observation ? { dataset: { state: 'active' } } : null,
    getBoundingClientRect: () => ({ x: 10, y: 20, width: 300, height: 400 }),
    getAnimations: () => animation ? [{ pending: false, playState: 'running', effect: { getTiming: () => ({ iterations: 1 }) } }] : [],
  };
  const document = { querySelector: () => section, visibilityState: 'visible', fonts: { get status() { return loaded ? 'loaded' : 'loading'; } } };
  const read = () => runInNewContext(`(${screenshotSection.toString()})('roster','[data-now="active"]')`, { document, innerHeight: 800 });
  assert.equal(read().ready, false);
  observation = true; assert.equal(read().ready, true);
  state = 'host-only'; assert.equal(read().ready, false, 'a host-only roster is not the recorded state asked for');
  state = 'ready'; animation = true; assert.equal(read().ready, false);
  animation = false; loaded = false; assert.equal(read().ready, false);
  // Any other target (the frame's main, for a view that must have no section) needs no roster state.
  const main = { ...section, dataset: {} };
  const plain = runInNewContext(`(${screenshotSection.toString()})('main',null)`, { document: { querySelector: () => main, visibilityState: 'visible', fonts: { status: 'loaded' } }, innerHeight: 800 });
  assert.equal(plain.ready, true);
});

test('section reader: a section the frame has not grown to fit is not ready, and names a partial capture', () => {
  let viewport = 24;
  const section = { dataset: { state: 'ready', testid: 'subagent-activity' }, querySelector: () => null, getBoundingClientRect: () => ({ x: 3, y: 117, width: 270, height: 204 }), getAnimations: () => [] };
  const read = () => runInNewContext(`(${screenshotSection.toString()})('roster',null)`, { document: { querySelector: () => section, visibilityState: 'visible', fonts: { status: 'loaded' } }, innerHeight: viewport });
  // The failing native run: a 24 px frame around a fully painted 204 px section.
  const small = read();
  assert.deepEqual([small.ready, small.settled, small.fits], [false, true, false]);
  assert.equal(partialCapture('native-status-roster', small), 'native-status-roster: partial capture (frame 24 px, section ends at 321 px)');
  // Once the host grows the frame to fit, it is ready and nothing is reported.
  viewport = 320;
  const grown = read();
  assert.deepEqual([grown.ready, grown.fits], [true, true]);
  assert.equal(partialCapture('native-status-roster', grown, 204, 204), null);
  // A clip shorter than the section (host-side frame smaller than the guest says) also fails.
  assert.match(partialCapture('native-status-roster', grown, 24, 204)!, /partial capture \(clip 24 of 204 px\)/);
  // Not settled yet (still loading): not a partial capture, the wait simply goes on.
  assert.equal(partialCapture('x', { ...small, settled: false }), null);
});

test('actual frame reader rejects a hidden or transitioning frame', () => {
  let blocked = false, animation = false;
  const frame = { src: 'synthetic-frame', parentElement: null, closest: () => blocked ? {} : null,
    getAnimations: () => animation ? [{ pending: true, playState: 'running', effect: { getTiming: () => ({ iterations: 1 }) } }] : [],
    getBoundingClientRect: () => ({ x: 0, y: 48, width: 400, height: 800 }), clientWidth: 400, clientHeight: 800 };
  const document = { querySelectorAll: () => [frame], visibilityState: 'visible' };
  const read = () => runInNewContext(`(${screenshotFrame.toString()})('synthetic-frame')`, { document, getComputedStyle: () => ({ visibility: 'visible' }) });
  assert.equal(read().ready, true);
  animation = true; assert.equal(read().ready, false);
  animation = false; blocked = true; assert.equal(read().ready, false);
});
