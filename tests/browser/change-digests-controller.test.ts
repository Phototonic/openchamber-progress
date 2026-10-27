// V4 (controller races): the actual startView/app.ts and digest controller in a VM, over a REAL
// in-process HTTP service (createProgressServer + disposable SQLite) and a synthetic SDK device
// namespace shared by several frames. Held service replies and storage operations are labelled
// seams. DOM, layout and real user activation belong to the current-bundle browser driver.
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import type { GuestRequest, GuestRequestResult } from '@openchamber/sdk';
import type { ViewContext, ViewSpec } from '../../ui/shared/app.ts';
import type { DigestPanel } from '../../ui/shared/change-digest.ts';
import * as digestModule from '../../ui/shared/change-digest.ts';
import * as checkpoint from '../../ui/shared/change-digest-checkpoint.ts';
import * as source from '../../ui/shared/source.ts';
import * as summaries from '../../ui/shared/summary.ts';
import * as cleanup from '../../ui/shared/cleanup.ts';
import * as refresh from '../../ui/shared/refresh.ts';
import * as path from '../../ui/shared/path.ts';
import { EMPTY_LIVE } from '../../ui/shared/live.ts';
import { createProgressServer } from '../../service/server.ts';
import { digestFixture, digestItems } from '../fixtures/change-digests.ts';
import { deferred, Device } from './change-digests-fixture.ts';

const APP = ts.transpileModule(readFileSync(new URL('../../ui/shared/app.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

/** Real service over the digest fixture; plus a finished plan that cleanup actions accept. */
async function backend() {
  const f = digestFixture();
  f.store.apply({ op: 'start', plan: 'P-done', rev: 0, oid: 'done-start', title: 'Finished example', items: [{ id: 'X', title: 'Only task', kind: 'task', status: 'done' }] }, f.actor);
  f.store.apply({ op: 'finish', plan: 'P-done', rev: 1, oid: 'done-finish', outcome: 'finished' }, f.actor);
  const server = createProgressServer(f.store, 'fixture-only'); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  let oid = 0;
  const relay = async (q: GuestRequest): Promise<GuestRequestResult> => {
    if (q.path === '/v1/extension-update' || q.path === '/v1/setup') return { status: 404, body: '{"error":"not-found"}' };
    const qs = new URLSearchParams(q.query ?? {}).toString();
    const r = await fetch(base + q.path + (qs ? `?${qs}` : ''), { method: q.method, headers: { authorization: 'Bearer fixture-only', ...(q.body ? { 'content-type': 'application/json' } : {}) }, ...(q.body ? { body: q.body } : {}) });
    return { status: r.status, body: await r.text() };
  };
  const revision = (plan = 'P-digest') => f.store.get(f.source.id, plan)!.revision;
  const cleanupRev = (plan: string) => f.store.detail(f.source.id, plan).plan.cleanup?.revision ?? 0;
  async function act(action: 'archive' | 'restore' | 'delete', plan: string) {
    const r = await relay({ method: 'POST', path: `/v1/plan/${action}`, body: JSON.stringify({ storeId: f.storeId, source: f.source.id, plan, rev: revision(plan), cleanupRev: cleanupRev(plan), oid: `cleanup-${++oid}`, ...(action === 'delete' ? { confirmed: true } : {}) }) });
    assert.equal(r.status, 200, `${action} ${plan}: ${r.body}`);
  }
  return { f, relay, revision, act, stop: async () => { server.close(); server.closeAllConnections(); f.cleanup(); } };
}
type Backend = Awaited<ReturnType<typeof backend>>;

/** Shared service proxy with a request log and held replies (the request reaches the service; the reply waits). */
function proxy(b: Backend) {
  const log: { frame: string; path: string; query: Record<string, string> | null; method: string }[] = [];
  let holds: { frame?: string; path: string; before: boolean; gate: ReturnType<typeof deferred<void>> }[] = [];
  let target = b.relay;
  return {
    log,
    retarget: (relay: Backend['relay']) => { target = relay; },
    /** `before`: hold the request itself (it reaches the service when released); otherwise hold its reply. */
    hold(path: string, frame?: string, before = false) { const gate = deferred(); holds.push({ frame, path, before, gate }); return gate.resolve; },
    call: async (frame: string, q: GuestRequest) => {
      log.push({ frame, path: q.path, query: (q.query as Record<string, string>) ?? null, method: q.method });
      const hold = holds.find((h) => h.path === q.path && (!h.frame || h.frame === frame));
      if (hold?.before) { holds = holds.filter((h) => h !== hold); await hold.gate.promise; return target(q); }
      const reply = target(q);
      if (hold) { holds = holds.filter((h) => h !== hold); const r = await reply; await hold.gate.promise; return r; }
      return reply;
    },
    count: (path: string, frame?: string) => log.filter((l) => l.path === path && (!frame || l.frame === frame)).length,
  };
}
type Proxy = ReturnType<typeof proxy>;

type Ui = { selected: string | null; tab: 'progress' | 'history'; filter: string; archived: boolean };
async function until(cond: () => boolean, what: string, ms = 4000) {
  const end = Date.now() + ms;
  while (!cond()) { if (Date.now() > end) throw new Error(`timed out: ${what}`); await new Promise((r) => setTimeout(r, 5)); }
}
const settle = async () => { for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r)); await new Promise((r) => setTimeout(r, 20)); for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r)); };

function frame(label: string, svc: Proxy, device: Device, options: { account?: string; features?: boolean; surface?: 'page' | 'panel' | 'status' } = {}) {
  const surface = options.surface ?? 'page';
  const listeners: Record<string, (v?: any) => void> = {};
  const docListeners: Record<string, () => void> = {};
  class Node {
    dataset: Record<string, string> = {}; children: Node[] = [];
    get firstElementChild() { return this.children[0] ?? null; }
    contains(n: unknown): boolean { return n === this || this.children.some((c) => c.contains(n)); }
    querySelectorAll(): Node[] { return []; }
    querySelector() { return null; }
    closest() { return null; }
    focus() {} getAnimations() { return []; } setAttribute() {} append(...c: Node[]) { this.children.push(...c); } replaceChildren(c: Node) { this.children = [c]; }
  }
  const node = () => new Node();
  const mount = node();
  const document = { documentElement: node(), head: node(), body: node(), visibilityState: 'visible', activeElement: null, getElementById: (id: string) => (id === 'root' ? mount : {}), addEventListener: (name: string, fn: () => void) => { docListeners[name] = fn; }, scrollingElement: { scrollTop: 0 } };
  let account = options.account ?? 'account-example';
  const host = {
    serviceRequest: (q: GuestRequest) => svc.call(label, q),
    storage: device.storage(),
    onReady: (fn: any) => { listeners.ready = fn; }, onSession: (fn: any) => { listeners.session = fn; }, onDirectory: (fn: any) => { listeners.directory = fn; },
    openSession: async () => {}, toast: async () => {},
  };
  const exports: any = {};
  runInNewContext(APP, {
    exports, document, navigator: {}, crypto: globalThis.crypto, queueMicrotask, performance, console, setTimeout: () => 1, clearTimeout() {},
    window: { addEventListener: (name: string, fn: any) => { listeners[name] = fn; } },
    require: (name: string) => {
      if (name === '@openchamber/sdk') return { connectHost: () => host };
      if (name === '@openchamber/sdk/ui') return { applyHostReady() {} };
      if (name === './source.ts') return source;
      if (name === './summary.ts') return summaries;
      if (name === './cleanup.ts') return cleanup;
      if (name === './refresh.ts') return refresh;
      if (name === './path.ts') return path;
      if (name === './change-digest.ts') return digestModule;
      if (name === './change-digest-checkpoint.ts') return checkpoint;
      if (name === './components.ts') return { el: node, refreshLabels() {} };
      if (name === './live.ts') return { LiveWorkspace: class { snapshot = EMPTY_LIVE; sessionSubscriptionCount = 0; start() {} restart() {} want() {} dispose() {} } };
      if (name === './official.ts') return { OfficialMainState: class { check = async () => ({ next: null, apply: () => false }); } };
      return {};
    },
  });
  let vc!: ViewContext<Ui>;
  let panel: DigestPanel | null = null;
  let paints = 0;
  const selected = (c: ViewContext<Ui>) => c.read?.plans.find((p) => p.key === c.ui.selected) ?? null;
  const spec: ViewSpec<Ui> = {
    surface, maxSessionSubscriptions: 2,
    initialUi: () => ({ selected: null, tab: 'progress', filter: 'all', archived: false }),
    scope: (_c, ui) => ({ archived: ui.archived ? 'only' : 'exclude', session: ui.filter === 'all' ? null : ui.filter }),
    wantProjects: () => [], wantDetails: () => [], actionPlan: selected,
    forgetPlans: (keys, ui) => (keys.has(ui.selected ?? '') ? { selected: null } : {}),
    reading: (c) => { const p = selected(c); return p ? { plan: p.key, scope: JSON.stringify([c.ui.filter, c.ui.archived]) } : null; },
    paint: (_root, c) => {
      paints++; vc = c;
      const p = selected(c);
      // Panel/status ask too, to prove they get nothing; the page asks only on its History tab.
      panel = p && (surface !== 'page' || c.ui.tab === 'history') ? c.digest(p) : null;
    },
  };
  exports.startView(spec);
  const ready = () => listeners.ready({ session: null, directory: null, connection: { connected: true, account }, locale: 'en', surface, settings: {}, item: null, theme: {}, ...(options.features === false ? {} : { features: { deviceStorage: true } }) });
  ready();
  return {
    get vc() { return vc; }, get panel() { return panel; }, get paints() { return paints; },
    open: async (plan = 'P-digest', archived = false, tab: Ui['tab'] = 'history') => {
      await until(() => !!vc, `${label} painted`);
      if (vc.ui.archived !== archived) vc.setUi({ archived, selected: null });
      await until(() => !!vc.read?.plans.some((p) => p.id === plan) && vc.ui.archived === archived, `${label}: ${plan} listed`);
      vc.setUi({ selected: vc.read!.plans.find((p) => p.id === plan)!.key, tab });
      await until(() => vc.ui.tab === tab && !!vc.read, `${label} selected`);
    },
    /** Explicit Refresh, waiting for its own new sequence (not the panel painted before it). */
    refresh: async () => { const before = panel; panel!.refresh(); await until(() => panel !== before && panel?.state !== 'loading', `${label} refreshed`); },
    poll: async () => { vc.retry(); await settle(); },
    hide: () => { document.visibilityState = 'hidden'; docListeners.visibilitychange(); },
    show: () => { document.visibilityState = 'visible'; docListeners.visibilitychange(); },
    focus: () => listeners.focus(),
    stop: () => listeners.pagehide(),
    account: (next: string) => { account = next; ready(); },
  };
}
type Frame = ReturnType<typeof frame>;
const ready = (f: Frame) => until(() => f.panel?.state === 'ready', 'digest ready');
const trusted = { isTrusted: true };

async function fixture(run: (b: Backend, svc: Proxy, device: Device) => Promise<void>) {
  const b = await backend();
  try { await run(b, proxy(b), new Device()); } finally { await b.stop(); }
}
const keysOf = (device: Device) => [...device.map.keys()];
const revisionsOf = (device: Device) => [...device.map.values()].map((v: any) => v.revision).sort((a, b) => a - b);

test('initial view is not zero changes; polls/idle/focus never acknowledge; only a trusted Mark reviewed writes the displayed target', async () => {
  await fixture(async (b, svc, device) => {
    const a = frame('A', svc, device);
    await a.open(); await ready(a);
    assert.equal(a.panel!.digest!.availability, 'initial');
    assert.equal(svc.log.filter((l) => l.path === '/v1/change-digest')[0].query!.after, undefined, 'no invented baseline');
    for (let i = 0; i < 3; i++) await a.poll();
    a.focus(); a.hide(); a.show(); await settle();
    a.panel!.markReviewed({ isTrusted: false }); await settle();
    assert.equal(device.writes().length, 0, 'mount, polls, hidden/visible, focus and untrusted activation write nothing');
    assert.equal(svc.count('/v1/change-digest'), 1, 'unchanged polls and focus return start no digest scan');
    assert.ok(a.panel!.canReview);
    const plans = svc.count('/v1/plan');
    a.panel!.markReviewed(trusted);
    await until(() => a.panel!.review === 'saved', 'saved');
    const preflight = svc.log.filter((l) => l.path === '/v1/plan').slice(plans);
    assert.equal(preflight.length, 1, 'one bounded live preflight'); assert.equal(preflight[0].query!.cursor, undefined, 'first page only');
    assert.deepEqual(revisionsOf(device), [1]);
    const stored = JSON.stringify([...device.map.values()]);
    for (const title of ['Digest example', 'First task', 'Second task', 'Work']) assert.ok(!stored.includes(title), 'no task or plan content persisted');
    assert.deepEqual(Object.keys([...device.map.values()][0] as object).sort(), ['id', 'revision', 'v']);
    assert.equal(device.instance.filter((i) => i.op === 'set').length, 0, 'never instance storage');
    assert.match(a.panel!.status, /Marked reviewed through revision 1/);
    a.stop();
  });
});

test('since-reviewed digest after real mutations; transient blocker kept; replay/same-status adds nothing; Refresh is one coalesced sequence', async () => {
  await fixture(async (b, svc, device) => {
    const a = frame('A', svc, device);
    await a.open(); await ready(a); a.panel!.markReviewed(trusted); await until(() => a.panel!.review === 'saved', 'saved');
    b.f.throughSix();
    await a.poll();
    assert.equal(a.panel!.newer, 6, 'a new revision only offers Refresh');
    assert.equal(a.panel!.digest!.interval.to, 1, 'pinned interval unchanged under the reader');
    assert.equal(svc.count('/v1/change-digest'), 1);
    const before = { digest: svc.count('/v1/change-digest'), keys: device.log.filter((l) => l.op === 'keys').length };
    const shown = a.panel!;
    shown.refresh(); shown.refresh(); a.panel?.refresh();
    await until(() => a.panel !== shown && a.panel!.state === 'ready', 'refreshed');
    assert.equal(svc.count('/v1/change-digest') - before.digest, 1, 'repeated activation while loading coalesces into one sequence');
    assert.equal(device.log.filter((l) => l.op === 'keys').length - before.keys, 1, 'one checkpoint read per sequence');
    const d = a.panel!.digest!;
    assert.equal(d.availability, 'comparison'); assert.equal(d.interval.after, 1); assert.equal(d.interval.to, 6);
    assert.deepEqual([d.summary.events.blocked, d.summary.events.unblocked, d.summary.events.completed, d.summary.events.added], [1, 1, 1, 1]);
    assert.equal(a.panel!.status, 'Digest refreshed.');
    assert.equal(device.writes().length, 1, 'refresh writes nothing');
    a.stop();
  });
});

test('two windows share one device/account checkpoint: interleaved 8/10 acknowledgements reopen at 10; other namespace/account stay initial; filter-only change keeps the baseline', async () => {
  await fixture(async (b, svc, device) => {
    for (let i = 0; i < 7; i++) b.f.change(i % 2 ? 'working' : 'pending');
    assert.equal(b.revision(), 8);
    const a = frame('A', svc, device); await a.open(); await ready(a);
    assert.equal(a.panel!.digest!.interval.to, 8);
    b.f.change('working'); b.f.change('blocked');
    const w = frame('B', svc, device); await w.open(); await ready(w);
    assert.equal(w.panel!.digest!.interval.to, 10);
    // B acknowledges 10 while A's older write of 8 is held after dispatch.
    const release = device.hold('set', /\.8$/);
    a.panel!.markReviewed(trusted);
    await until(() => device.holds.length === 0, 'A write dispatched');
    w.panel!.markReviewed(trusted); await until(() => w.panel!.review === 'saved', 'B saved');
    release(); await until(() => a.panel!.review === 'saved', 'A saved');
    assert.deepEqual(revisionsOf(device), [8, 10], 'the older writer cannot overwrite or compact the newer key');
    // A's focus return notices the newer acknowledgement without rewriting its displayed text.
    a.focus(); await until(() => a.panel!.elsewhere === 10, 'A sees newer review');
    assert.equal(a.panel!.digest!.interval.to, 8); assert.equal(a.panel!.canReview, false);
    // Reopening History in a fresh window reads 10, never 8.
    const c = frame('C', svc, device); await c.open(); await ready(c);
    assert.equal(c.panel!.digest!.interval.after, 10);
    // A stale window cannot rewind: its acknowledgement of 8 reports "already reviewed".
    const stale = frame('D', svc, device); await stale.open(); await ready(stale);
    // Other account and other device namespace: initial, not borrowed.
    const other = frame('E', svc, device, { account: 'account-other' }); await other.open(); await ready(other);
    assert.equal(other.panel!.digest!.availability, 'initial');
    const elsewhere = frame('F', svc, new Device()); await elsewhere.open(); await ready(elsewhere);
    assert.equal(elsewhere.panel!.digest!.availability, 'initial');
    // Board session filter only: the visit's baseline is the same shared checkpoint.
    c.vc.setUi({ filter: b.f.actor.sessionId }); await settle(); await ready(c);
    const last = svc.log.filter((l) => l.path === '/v1/change-digest' && l.frame === 'C').at(-1)!;
    assert.equal(last.query!.after, '10', 'filter change reads the same baseline');
    for (const f of [a, w, c, stale, other, elsewhere]) f.stop();
  });
});

test('held digest replies across plan, account and store switches cannot paint or enable detached controls', async () => {
  await fixture(async (b, svc, device) => {
    const a = frame('A', svc, device);
    // Plan switch.
    const release = svc.hold('/v1/change-digest', 'A');
    await a.open(); await until(() => svc.count('/v1/change-digest') === 1, 'held');
    const loading = a.panel!;
    await a.open('P-done'); await ready(a);
    assert.equal(a.panel!.digest!.plan, 'P-done');
    release(); await settle();
    assert.equal(a.panel!.digest!.plan, 'P-done', 'retired P-digest reply never paints');
    loading.markReviewed(trusted); loading.refresh(); await settle();
    assert.equal(device.writes().length, 0, 'detached controls inert');
    // Account switch with a held reply.
    const ready1 = a.panel!;
    const release2 = svc.hold('/v1/change-digest', 'A');
    ready1.refresh(); await until(() => a.panel!.state === 'loading', 'refreshing');
    a.account('account-other'); await settle();
    release2(); await settle();
    assert.equal(a.panel, null, 'account change resets selection; no old content');
    ready1.markReviewed(trusted); await settle();
    assert.equal(device.writes().length, 0);
    // Store switch: a different store identity resets the frame.
    const other = await backend();
    try {
      await a.open('P-digest'); await ready(a);
      const old = a.panel!;
      svc.retarget(other.relay); await a.poll();
      assert.equal(a.panel, null, 'store identity change retires the visit');
      old.markReviewed(trusted); await settle();
      assert.equal(device.writes().length, 0);
    } finally { svc.retarget(b.relay); await other.stop(); }
    a.stop();
  });
});

test('hidden and disposed frames start nothing, and a held reply across hiding cannot acknowledge', async () => {
  await fixture(async (b, svc, device) => {
    const a = frame('A', svc, device);
    const release = svc.hold('/v1/change-digest', 'A');
    await a.open(); await until(() => svc.count('/v1/change-digest') === 1, 'held');
    a.hide(); b.f.change('working'); release(); await settle();
    assert.equal(a.panel!.state, 'loading', 'retired by hiding, not painted');
    a.vc.retry(); await settle();
    assert.equal(svc.count('/v1/change-digest'), 1, 'hidden frame starts no digest read');
    a.show(); await ready(a);
    assert.equal(a.panel!.digest!.interval.to, 2, 'restart on return pins the current revision');
    assert.equal(device.writes().length, 0);
    const held = svc.hold('/v1/change-digest', 'A');
    a.panel!.refresh(); await until(() => a.panel!.state === 'loading', 'loading');
    const panel = a.panel!;
    a.stop(); held(); await settle();
    panel.markReviewed(trusted); panel.refresh(); await settle();
    assert.equal(device.writes().length, 0, 'disposed: nothing written');
    assert.equal(svc.count('/v1/change-digest'), 3, 'disposed: no further reads');
  });
});

test('hiding retires an undispatched review: a held preflight released after hide → show writes nothing; a fresh activation works; a dispatched write may finish', async () => {
  await fixture(async (b, svc, device) => {
    const a = frame('A', svc, device);
    await a.open(); await ready(a);
    const activated = a.panel!;
    const hold = svc.hold('/v1/plan', 'A');
    activated.markReviewed(trusted);
    await until(() => a.panel!.review === 'pending', 'pending');
    await until(() => svc.count('/v1/plan', 'A') === 1, 'preflight sent');
    a.hide();
    await until(() => a.panel!.review === 'idle', 'review retired by hiding');
    assert.match(a.panel!.status, /hidden/);
    a.show(); await settle();
    hold(); await settle(); await new Promise((r) => setTimeout(r, 50)); await settle();
    assert.equal(device.writes().length, 0, 'released preflight after hide → show dispatches no write');
    assert.equal(a.panel!.review, 'idle');
    activated.markReviewed(trusted); await settle();
    assert.equal(device.writes().length, 0, 'the pre-hide panel cannot act again');
    assert.equal(a.panel!.canReview, true);
    // A fresh trusted activation after showing the frame works.
    a.panel!.markReviewed(trusted);
    await until(() => a.panel!.review === 'saved', 'fresh activation saved');
    assert.deepEqual(revisionsOf(device), [1]);
    // A write already dispatched to storage when the frame hides finishes under its captured target.
    b.f.change('blocked'); await a.poll(); await a.refresh();
    const release = device.hold('set');
    a.panel!.markReviewed(trusted);
    await until(() => device.holds.length === 0, 'write dispatched');
    a.hide(); release();
    await until(() => a.panel!.review === 'saved', 'dispatched write finished');
    a.show(); await settle();
    assert.deepEqual(revisionsOf(device), [2]);
    a.stop();
  });
});

test('changed progress while reviewing saves only the displayed target', async () => {
  await fixture(async (b, svc, device) => {
    const a = frame('A', svc, device);
    await a.open(); await ready(a);
    const hold = svc.hold('/v1/plan', 'A');
    a.panel!.markReviewed(trusted);
    await until(() => a.panel!.review === 'pending', 'pending');
    b.f.change('blocked');
    hold(); await until(() => a.panel!.review === 'saved', 'saved');
    assert.deepEqual(revisionsOf(device), [1], 'T saved, T+1 left for the next interval');
    await a.poll(); assert.equal(a.panel!.newer, 2);
    a.stop();
  });
});

test('archive/restore change cleanup identity but keep the shared baseline; reopen requires Refresh; delete with a held reply retires and forgets', async () => {
  await fixture(async (b, svc, device) => {
    const a = frame('A', svc, device);
    await a.open('P-done'); await ready(a);
    a.panel!.markReviewed(trusted); await until(() => a.panel!.review === 'saved', 'saved');
    const shown = a.panel!;
    await b.act('archive', 'P-done'); await a.poll();
    shown.markReviewed(trusted); await settle();
    await a.open('P-done', true); await ready(a);
    assert.equal(a.panel!.digest!.cleanup.state, 'archived'); assert.equal(a.panel!.digest!.interval.after, 2, 'archived inspection keeps the baseline');
    await b.act('restore', 'P-done'); await a.poll();
    await a.open('P-done'); await ready(a);
    // Reopen: same plan identity and checkpoint; lifecycle change retires actions until Refresh.
    b.f.store.apply({ op: 'revise', plan: 'P-done', rev: b.revision('P-done'), oid: 'reopen', reopen: true, items: [{ id: 'X', title: 'Only task', kind: 'task', status: 'working' }] }, b.f.actor);
    const done = () => b.f.store.apply({ op: 'change', plan: 'P-done', rev: b.revision('P-done'), oid: 'done-again', changes: [{ id: 'X', status: 'done' }] }, b.f.actor);
    await a.poll();
    assert.equal(a.panel!.needsRefresh, true); assert.equal(a.panel!.canReview, false);
    await a.refresh();
    assert.equal(a.panel!.digest!.interval.after, 2); assert.equal(a.panel!.digest!.summary.events.reopened, 1);
    assert.equal(a.panel!.canReview, true);
    // Delete while a pre-delete digest reply is held (captured historical data only).
    const finish = () => b.f.store.apply({ op: 'finish', plan: 'P-done', rev: b.revision('P-done'), oid: 'finish-2', outcome: 'finished' }, b.f.actor);
    done(); finish(); await a.poll(); await a.refresh();
    const held = svc.hold('/v1/change-digest', 'A');
    const before = a.panel!; before.refresh(); await until(() => svc.log.filter((l) => l.path === '/v1/change-digest').length >= 5, 'refresh dispatched');
    await b.act('delete', 'P-done'); await a.poll();
    held(); await settle();
    assert.equal(a.panel, null, 'deleted plan leaves the list; held reply cannot resurrect it');
    before.markReviewed(trusted); await settle();
    assert.equal(device.writes().length, 1, 'no acknowledgement of a deleted plan');
    a.stop();
  });
});

test('deletion elsewhere during Mark reviewed: a post-delete preflight forgets markers; a pre-delete reply cannot authorize once deletion is observed', async () => {
  const reopenAndFinish = (b: Backend, n: number) => {
    b.f.store.apply({ op: 'revise', plan: 'P-done', rev: b.revision('P-done'), oid: `reopen-${n}`, reopen: true, items: [{ id: 'X', title: 'Only task', kind: 'task', status: 'done' }] }, b.f.actor);
    b.f.store.apply({ op: 'finish', plan: 'P-done', rev: b.revision('P-done'), oid: `refinish-${n}`, outcome: 'finished' }, b.f.actor);
  };
  // (a) The preflight request reaches the service after deletion: 404, no write, markers forgotten.
  await fixture(async (b, svc, device) => {
    const a = frame('A', svc, device);
    await a.open('P-done'); await ready(a); a.panel!.markReviewed(trusted); await until(() => a.panel!.review === 'saved', 'saved');
    reopenAndFinish(b, 1); await a.poll(); await a.refresh();
    const hold = svc.hold('/v1/plan', 'A', true);
    a.panel!.markReviewed(trusted); await until(() => a.panel!.review === 'pending', 'pending');
    await b.act('delete', 'P-done');
    hold(); await until(() => a.panel?.state === 'unavailable', 'retired');
    assert.equal(a.panel!.unavailable!.reason, 'missing');
    await until(() => device.map.size === 0, 'markers forgotten');
    assert.equal(device.writes().length, 1, 'only the earlier, pre-delete acknowledgement was ever written');
    a.stop();
  });
  // (b) A preflight reply captured before deletion is released only after this frame's list
  // observed the deletion: the visit is retired, so the captured reply authorizes nothing.
  await fixture(async (b, svc, device) => {
    const a = frame('A', svc, device);
    await a.open('P-done'); await ready(a);
    const hold = svc.hold('/v1/plan', 'A');
    a.panel!.markReviewed(trusted); await until(() => a.panel!.review === 'pending', 'pending');
    await until(() => svc.count('/v1/plan', 'A') === 1, 'preflight answered by the service');
    await b.act('delete', 'P-done'); await a.poll();
    assert.equal(a.panel, null, 'deleted plan leaves the list');
    hold(); await settle();
    assert.equal(device.writes().length, 0, 'held pre-delete reply never acknowledges a deleted plan');
    a.stop();
  });
});

test('unsupported device storage, denied/quota/malformed records and an older service are unavailable, never initial', async () => {
  await fixture(async (b, svc, device) => {
    const a = frame('A', svc, device, { features: false });
    await a.open(); await until(() => a.panel?.state === 'unavailable', 'unavailable');
    assert.deepEqual(a.panel!.unavailable, { reason: 'checkpoint', checkpoint: 'unsupported' });
    assert.equal(device.log.length + device.instance.length, 0, 'no storage call of any scope');
    assert.equal(svc.count('/v1/change-digest'), 0);
    a.stop();
    const denied = new Device(); denied.fail('keys', 'DENIED');
    const d = frame('D', svc, denied); await d.open(); await until(() => d.panel?.state === 'unavailable', 'denied');
    assert.deepEqual(d.panel!.unavailable, { reason: 'checkpoint', checkpoint: 'denied' });
    d.stop();
    // Quota on write: failure announced, previous baseline unchanged, retryable.
    const q = frame('Q', svc, device); await q.open(); await ready(q);
    device.fail('set', 'HOST_REJECTED', 'Storage quota exceeded', undefined, true);
    q.panel!.markReviewed(trusted); await until(() => q.panel!.review === 'failed', 'failed');
    assert.match(q.panel!.status, /full.*previous review point is unchanged/);
    assert.equal(device.map.size, 0); assert.equal(q.panel!.canReview, true);
    q.panel!.markReviewed(trusted); await until(() => q.panel!.review === 'saved', 'retry saved');
    q.stop();
    // Malformed highest record: unavailable; Mark reviewed never overwrites it.
    const key = [...device.map.keys()][0].replace(/\.\d+$/, '.99');
    device.map.set(key, { v: 1, id: 'tampered', revision: 99 });
    const m = frame('M', svc, device); await m.open(); await until(() => m.panel?.state === 'unavailable', 'malformed');
    assert.deepEqual(m.panel!.unavailable, { reason: 'checkpoint', checkpoint: 'malformed' });
    m.stop();
  });
  // Older service: capability absent → unavailable and zero digest requests.
  await fixture(async (b, svc, device) => {
    const relay = b.relay;
    svc.retarget(async (q) => { const r = await relay(q); if (q.path === '/health') { const h = JSON.parse(r.body); delete h.planChangeDigests; return { ...r, body: JSON.stringify(h) }; } return r; });
    const a = frame('A', svc, device); await a.open(); await until(() => a.panel?.state === 'unavailable', 'service');
    assert.deepEqual(a.panel!.unavailable, { reason: 'service' });
    assert.equal(svc.count('/v1/change-digest'), 0); assert.equal(device.log.length, 0);
    a.stop();
  });
});

test('History closed and panel/status surfaces: zero digest requests and checkpoint work through polls', async () => {
  await fixture(async (b, svc, device) => {
    const page = frame('page', svc, device);
    await page.open('P-digest', false, 'progress');
    const rail = frame('panel', svc, device, { surface: 'panel' });
    const status = frame('status', svc, device, { surface: 'status' });
    await until(() => !!rail.vc?.read && !!status.vc?.read, 'surfaces read');
    rail.vc.setUi({ selected: rail.vc.read!.plans[0].key }); status.vc.setUi({ selected: status.vc.read!.plans[0].key });
    for (let i = 0; i < 4; i++) { b.f.change(i % 2 ? 'working' : 'pending'); await page.poll(); await rail.poll(); await status.poll(); }
    assert.equal(svc.count('/v1/change-digest'), 0);
    assert.equal(device.log.length, 0, 'no checkpoint reads or writes');
    assert.equal(rail.panel, null); assert.equal(status.panel, null);
    for (const f of [page, rail, status]) f.stop();
  });
});
