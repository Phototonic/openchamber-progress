import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import type { GuestRequest, GuestRequestResult, HostReadyContext } from '@openchamber/sdk';
import { parsePlanPage } from '../../ui/shared/adapter.ts';
import type { ViewContext, ViewSpec } from '../../ui/shared/app.ts';
import { EMPTY_LIVE } from '../../ui/shared/live.ts';
import { elapsedAt, type PlanDetail } from '../../ui/shared/model.ts';
import { attention, blockedWait, readiness, type Readiness } from '../../ui/shared/readiness.ts';
import { formatHandoff, formatProgressUpdate } from '../../ui/shared/summary.ts';
import * as refresh from '../../ui/shared/refresh.ts';
import * as path from '../../ui/shared/path.ts';
import * as cleanup from '../../ui/shared/cleanup.ts';
import * as source from '../../ui/shared/source.ts';
import { launchNeedsYouService } from '../fixtures/needs-you.ts';

type Fixture = Awaited<ReturnType<typeof launchNeedsYouService>>;
type Rec = Record<string, any>;
const ATTENTION = ['decision', 'dependency', 'review', 'external', 'other', 'unknown'];
const FRESH = { fresh: true, captureEnabled: true };

/** Guest proxy onto the real disposable service; `edit` may rewrite a reply body (older/odd services). */
function proxy(f: Fixture, edit?: (body: Rec, q: GuestRequest) => Rec | void) {
  const calls: GuestRequest[] = [];
  return {
    calls,
    serviceRequest: async (q: GuestRequest): Promise<GuestRequestResult> => {
      calls.push(q);
      const qs = new URLSearchParams(q.query ?? {}).toString();
      const r = await f.request(`${q.path}${qs ? `?${qs}` : ''}`);
      const text = await r.text();
      if (!edit || r.status !== 200) return { status: r.status, body: text };
      const body = JSON.parse(text);
      return { status: 200, body: JSON.stringify(edit(body, q) ?? body) };
    },
  };
}
const target = (plan: string, sourceId = 'source-fixture') => ({ sourceId, id: plan });
async function complete(h: source.ServiceHost, plan: string, sourceId?: string, mono?: () => number) {
  const res = await source.readDetail(h, target(plan, sourceId), mono);
  assert.ok(res.ok, `complete detail for ${plan}`);
  return res;
}
const ready = (r: Readiness) => { assert.equal(r.state, 'ready'); return r as Extract<Readiness, { state: 'ready' }>; };
const rows = (r: Readiness) => ready(r).groups.blocked;
const wire = async (f: Fixture, plan = 'P-attention') => await (await f.request(`/v1/plan?source=source-fixture&plan=${plan}`)).json() as Rec;

test('real paged detail: one Needs you row per reported blocked task, stored order, honest unknowns and provenance', async () => {
  const f = await launchNeedsYouService();
  try {
    const h = proxy(f);
    const res = await complete(h, 'P-attention');
    assert.equal(h.calls.length, 2, 'both detail pages, one cursor');
    assert.equal(res.detail.items.length, 27);
    const r = readiness(res.plan, { state: 'ready', value: res.detail });
    const list = rows(r);
    assert.deepEqual(list.map((e) => e.item.id), ATTENTION, 'stored order; prerequisite waits, groups and skipped tasks are not blockers');
    assert.ok(ready(r).groups.waiting.some((e) => e.item.id === 'prerequisite-wait'));
    assert.equal(new Set(Object.values(ready(r).groups).flat().map((e) => e.item.id)).size, Object.values(ready(r).groups).flat().length, 'no duplicate task rows');
    const by = Object.fromEntries(list.map((e) => [e.item.id, e]));
    const first = await wire(f);
    // Annotations map field-for-field from the service's current, validated annotation.
    for (const raw of first.items.data.filter((i: Rec) => i.blocker)) {
      const b = by[raw.id].item.reportedBlocker;
      assert.equal(b?.state, 'reported', raw.id);
      if (b?.state !== 'reported') continue;
      assert.deepEqual([b.category, b.reason, b.nextAction, b.reporterSessionId, b.attributedSessionId, b.mode, b.reportedRevision, b.reportedAt],
        [raw.blocker.category ?? null, raw.blocker.reason ?? null, raw.blocker.nextAction ?? null, raw.blocker.reporterSessionId, raw.blocker.attributedSessionId, raw.blocker.mode, raw.blocker.reportedRevision, raw.blocker.reportedAt]);
    }
    const d = by.decision.item.reportedBlocker;
    assert.ok(d?.state === 'reported' && d.category === 'decision' && d.reason === 'Choose an output format' && d.nextAction === 'Select CSV or JSON');
    // Later status-only reports by C and the M→C relay never become the details' author.
    assert.ok(d.mode === 'direct' && d.reporterSessionId === 'M');
    assert.ok(by.decision.reports.some((x) => x.mode === 'direct' && x.reporterSessionId === 'C'), 'C\'s status-only report stays report context');
    assert.ok(by.decision.reports.some((x) => x.mode === 'parent-relay' && x.reporterSessionId === 'M' && x.attributedSessionId === 'C'), 'relay kept as distinct report context');
    assert.equal(by.decision.assigneeSessionId, 'C', 'responsibility only from the recorded assignee');
    assert.equal(by.review.assigneeSessionId, null);
    const external = by.external.item.reportedBlocker;
    assert.ok(external?.state === 'reported' && external.reason === '<b>Awaiting sample input</b>', 'literal text, never parsed');
    const other = by.other.item.reportedBlocker;
    assert.ok(other?.state === 'reported' && other.category === 'other' && other.reason === null && other.nextAction === null, 'missing parts are explicit unknowns');
    assert.equal(by.unknown.item.reportedBlocker, undefined, 'no annotation: details unknown, not empty success');
    assert.equal(ready(r).groups.waiting.find((e) => e.item.id === 'prerequisite-wait')?.item.reportedBlocker, undefined);
    // Same task IDs in another plan or source never borrow these details.
    for (const [plan, src] of [['P-attention', 'source-other'], ['P-other', 'source-fixture']] as const) {
      const other = await complete(proxy(f), plan, src);
      const e = rows(readiness(other.plan, { state: 'ready', value: other.detail }));
      assert.deepEqual(e.map((x) => [x.item.id, x.item.reportedBlocker]), [['decision', undefined]], `${src}/${plan}`);
    }
    // Finished plans have no current attention at all.
    const finished = await complete(proxy(f), 'P-finished');
    assert.deepEqual(attention(readiness(finished.plan, { state: 'ready', value: finished.detail }), FRESH), { state: 'closed' });
  } finally { await f.stop(); }
});

test('reported waits: exact / lower-bound / unknown from blocked timing, anchored to server readAt and the local receipt', async () => {
  const f = await launchNeedsYouService();
  try {
    const res = await complete(proxy(f), 'P-attention', undefined, () => 5_000);
    const raw = (await wire(f)).blockedTiming;
    for (const e of rows(readiness(res.plan, { state: 'ready', value: res.detail }))) {
      const w = blockedWait(res.detail, e.item);
      assert.equal(w.kind, raw.items[e.item.id]?.kind ?? 'unknown', e.item.id);
      if (w.kind !== 'exact' && w.kind !== 'lower-bound') continue;
      assert.equal(w.anchor.receivedAt, 5_000, 'local monotonic receipt anchor');
      assert.ok(w.anchor.elapsedAtRead >= 0);
      // After receipt only monotonic time advances it; never browser wall time.
      assert.equal(elapsedAt(w.anchor, 5_000 + 60_000), w.anchor.elapsedAtRead + 60_000);
      assert.equal(elapsedAt(w.anchor, 4_000), w.anchor.elapsedAtRead, 'a monotonic step back never shortens below the server value');
    }
    const decision = res.detail.blockedTiming!.decision;
    assert.equal(decision.kind, 'exact');
    // Elapsed at read is exactly that reply's server readAt − since, unaffected by a skewed browser clock.
    const body = await wire(f);
    const realNow = Date.now;
    Date.now = () => realNow() + 7 * 86_400_000;
    let again;
    try { again = parsePlanPage(JSON.stringify(body)).blockedTiming!.get('decision')!; } finally { Date.now = realNow; }
    assert.equal(again.since, decision.since);
    assert.equal(again.elapsedAtRead, Date.parse(body.blockedTiming.readAt) - Date.parse(body.blockedTiming.items.decision.since));
    const lower = await complete(proxy(f), 'P-lower');
    assert.equal(blockedWait(lower.detail, lower.detail.items[0]).kind, 'lower-bound');
    const unknown = await complete(proxy(f), 'P-unknown');
    assert.equal(blockedWait(unknown.detail, unknown.detail.items[0]).kind, 'unknown', 'present timing, no entry: unknown, never zero');
    // An older service without blockedTiming: unavailable for every row.
    const old = await complete(proxy(f, (b) => { delete b.blockedTiming; }), 'P-attention');
    assert.equal(old.detail.blockedTiming, undefined);
    assert.ok(rows(readiness(old.plan, { state: 'ready', value: old.detail })).every((e) => blockedWait(old.detail, e.item).kind === 'unavailable'));
  } finally { await f.stop(); }
});

test('adapter re-validates annotations: stale markers are unknown, malformed content is a fixed invalid state, future categories unclassified', async () => {
  const f = await launchNeedsYouService();
  try {
    const base = await wire(f);
    const rev = base.plan.revision as number;
    const decision = base.items.data.find((i: Rec) => i.id === 'decision');
    const parse = (blocker: unknown, patch: Rec = {}) => {
      const body = structuredClone(base);
      const item = body.items.data.find((i: Rec) => i.id === 'decision');
      Object.assign(item, patch);
      if (blocker === undefined) delete item.blocker; else item.blocker = blocker;
      return parsePlanPage(JSON.stringify(body)).items.data.find((i) => i.id === 'decision')!.reportedBlocker;
    };
    const good = decision.blocker as Rec;
    assert.equal(parse(good)?.state, 'reported');
    assert.equal(parse({ ...good, validAtRevision: rev - 1 }), undefined, 'older-revision marker passed through by an older service');
    assert.equal(parse(null), undefined);
    assert.equal(parse(undefined), undefined);
    assert.equal(parse(good, { status: 'pending' }), undefined, 'only blocked tasks carry details');
    const unclassified = parse({ ...good, category: 'legal-review' });
    assert.ok(unclassified?.state === 'reported' && unclassified.category === 'unclassified' && unclassified.reason === good.reason);
    const invalid: [string, unknown][] = [
      ['future marker', { ...good, validAtRevision: rev + 1 }],
      ['missing marker', (({ validAtRevision, ...x }) => x)(good)],
      ['blank reason', { ...good, reason: '   ' }],
      ['oversized reason', { ...good, reason: 'x'.repeat(513) }],
      ['NUL action', { ...good, nextAction: 'a\0b' }],
      ['numeric category', { ...good, category: 3 }],
      ['extra key', { ...good, note: 'x' }],
      ['relay to self', { ...good, mode: 'parent-relay' }],
      ['direct to other', { ...good, attributedSessionId: 'C' }],
      ['unknown mode', { ...good, mode: 'proxy' }],
      ['bad session id', { ...good, reporterSessionId: '../M', attributedSessionId: '../M' }],
      ['non-canonical time', { ...good, reportedAt: '2026-01-01' }],
      ['report after marker', { ...good, reportedRevision: rev + 1 }],
      ['array', [good]],
      ['string', 'Choose an output format'],
    ];
    for (const [what, value] of invalid) {
      const v = parse(value);
      assert.deepEqual(v, { state: 'invalid' }, what);
      assert.ok(!JSON.stringify(v).includes('Choose'), `${what}: rejected text is not kept`);
    }
    // An exactly-512 code-unit reason is valid; bounds are not truncation.
    const max = parse({ ...good, reason: 'y'.repeat(512) });
    assert.ok(max?.state === 'reported' && max.reason?.length === 512);
    // Blocked timing: prototype keys, malformed/future entries and oversize maps never become claims.
    const timing = (blockedTiming: unknown, id = 'decision') => {
      const body = structuredClone(base);
      body.blockedTiming = blockedTiming;
      const page = parsePlanPage(JSON.stringify(body));
      const detail: Pick<PlanDetail, 'blockedTiming'> = page.blockedTiming ? { blockedTiming: Object.fromEntries([...page.blockedTiming].map(([k, t]) => [k, { ...t, receivedAt: 0 }])) } : {};
      return blockedWait(detail, { id, kind: 'task', status: 'blocked' }).kind;
    };
    const readAt = base.blockedTiming.readAt;
    assert.equal(timing({ readAt, items: {} }, 'constructor'), 'unknown', 'inherited object keys are not entries');
    assert.equal(timing({ readAt, items: { decision: { since: '2999-01-01T00:00:00.000Z', kind: 'exact' } } }), 'unknown', 'future start');
    assert.equal(timing({ readAt, items: { decision: { since: readAt, kind: 'approximate' } } }), 'unknown');
    assert.equal(timing({ readAt: 'yesterday', items: {} }), 'unavailable');
    assert.equal(timing({ readAt, items: Object.fromEntries(Array.from({ length: 1001 }, (_, i) => [`t${i}`, { since: readAt, kind: 'exact' }])) }), 'unavailable');
    assert.equal(timing({ readAt, items: { decision: { since: readAt, kind: 'exact' } } }), 'exact');
    assert.equal(blockedWait({ blockedTiming: { decision: { kind: 'exact', since: readAt, elapsedAtRead: 0, receivedAt: 0 } } }, { id: 'decision', kind: 'task', status: 'working' }).kind, 'unknown', 'timing never applies to a task no longer blocked');
  } finally { await f.stop(); }
});

test('attention claims: only a complete current read may say "no reported blockers"; loading, failed and closed make no claim', () => {
  const plan = { key: 's/p', revision: 2, lifecycle: 'active' as const };
  const empty: PlanDetail = { key: 's/p', revision: 2, items: [{ id: 't', title: 'T', kind: 'task', status: 'pending' }], contributions: [], links: [] };
  const r = readiness(plan, { state: 'ready', value: empty });
  assert.deepEqual(attention(r, FRESH), { state: 'ready', rows: [], qualifier: 'current' });
  assert.equal((attention(r, { fresh: false, captureEnabled: true }) as Rec).qualifier, 'stale');
  assert.equal((attention(r, { fresh: true, captureEnabled: false }) as Rec).qualifier, 'capture-off');
  assert.equal((attention(r, { fresh: false, captureEnabled: false }) as Rec).qualifier, 'stale');
  assert.deepEqual(attention(readiness(plan, { state: 'loading' }), FRESH), { state: 'loading' });
  assert.deepEqual(attention(readiness(plan, null), FRESH), { state: 'loading' });
  assert.deepEqual(attention(readiness(plan, { state: 'error' }), FRESH), { state: 'unavailable' });
  assert.deepEqual(attention(readiness({ ...plan, revision: 3 }, { state: 'ready', value: empty }), FRESH), { state: 'loading' }, 'an older revision never answers');
  for (const lifecycle of ['completed', 'cancelled', 'failed'] as const) assert.deepEqual(attention(readiness({ ...plan, lifecycle }, { state: 'ready', value: empty }), FRESH), { state: 'closed' });
  // Unblocking (blocked → pending) leaves attention without counting the task as done.
  const blocked = { ...empty, items: [{ id: 't', title: 'T', kind: 'task' as const, status: 'blocked' as const }] };
  assert.equal((attention(readiness(plan, { state: 'ready', value: blocked }), FRESH) as Rec).rows.length, 1);
  // Item reporter without any contribution: an honest fallback, never a report mode.
  const fallback = readiness(plan, { state: 'ready', value: { ...blocked, items: [{ ...blocked.items[0], reporterSessionId: 'M' }] } });
  assert.equal(rows(fallback)[0].reporterFallback, 'M');
});

test('a cleanup generation change between detail pages restarts the read; persistent churn fails, never joins pages', async () => {
  const f = await launchNeedsYouService();
  try {
    const once = proxy(f, (b, q) => { if (q.query?.cursor && once.calls.length === 2) b.plan.cleanup = { state: 'visible', revision: 7 }; });
    const res = await source.readDetail(once, target('P-attention'));
    assert.ok(res.ok && res.restarts === 1, 'one restart after the mixed page');
    assert.equal(once.calls.filter((q) => !q.query?.cursor).length, 2);
    let generation = 0;
    const churn = proxy(f, (b, q) => { if (q.query?.cursor) b.plan.cleanup = { state: 'visible', revision: ++generation }; });
    const failed = await source.readDetail(churn, target('P-attention'));
    assert.ok(!failed.ok && failed.cause.kind === 'revision-restarts');
    assert.equal(churn.calls.length, (source.MAX_DETAIL_RESTARTS + 1) * 2, 'bounded: one continuation per attempt');
  } finally { await f.stop(); }
});

test('summary exports omit blocker details, provenance and waits, and say so', async () => {
  const f = await launchNeedsYouService();
  try {
    const res = await complete(proxy(f), 'P-attention');
    for (const text of [formatProgressUpdate(res), formatHandoff(res)]) {
      assert.ok(text);
      assert.match(text, /Choose format — blocker details omitted from this summary/);
      assert.doesNotMatch(text, /no reason recorded/);
      for (const secret of ['Choose an output format', 'Select CSV or JSON', 'Awaiting sample input', 'Review the format proposal', 'Input is not yet available', 'Details reported']) assert.ok(!text.includes(secret), secret);
      assert.doesNotMatch(text, /at least|\b\d+ (min|h|days?)\b/, 'no waiting durations');
    }
  } finally { await f.stop(); }
});

/**
 * Minimal element model for the controller's own focus-restoration path: compound selectors (tag,
 * .class, [attr], [attr="v"], [attr^="v"]) joined by descendant spaces or commas, closest/matches,
 * and focus bookkeeping that, like a browser, drops focus to body when its element is detached.
 */
class Node {
  tagName: string; className = ''; parentElement: Node | null = null; children: Node[] = []; dataset: Record<string, string> = {};
  attrs: Record<string, string> = {}; textContent = ''; open = false; #tab: number | null = null;
  doc: { activeElement: Node | null; body: Node | null };
  constructor(tag: string, doc: { activeElement: Node | null; body: Node | null }) { this.tagName = tag.toUpperCase(); this.doc = doc; }
  get tabIndex() { return this.#tab ?? -1; }
  set tabIndex(v: number) { this.#tab = v; }
  get firstElementChild() { return this.children[0] ?? null; }
  attr(name: string) {
    if (name.startsWith('data-')) return this.dataset[name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())];
    if (name === 'tabindex') return this.#tab === null ? undefined : String(this.#tab);
    if (name === 'class') return this.className;
    return this.attrs[name];
  }
  setAttribute(k: string, v: string) { this.attrs[k] = String(v); }
  getAttribute(k: string) { return this.attr(k) ?? null; }
  removeAttribute(k: string) { delete this.attrs[k]; }
  append(...nodes: (Node | string)[]) { for (const n of nodes) if (typeof n !== 'string') { n.parentElement = this; this.children.push(n); } else this.textContent += n; }
  replaceChildren(...nodes: Node[]) {
    for (const c of this.children) c.parentElement = null;
    this.children = []; this.append(...nodes);
    const a = this.doc.activeElement;
    if (a && !this.doc.body?.contains(a)) this.doc.activeElement = this.doc.body;
  }
  contains(n: Node | null): boolean { for (let x = n; x; x = x.parentElement) if (x === this) return true; return false; }
  *descendants(): Generator<Node> { for (const c of this.children) { yield c; yield* c.descendants(); } }
  #compound(sel: string) {
    const m = /^([a-z0-9]+)?((?:\.[\w-]+|\[[^\]]+\])*)$/i.exec(sel.trim());
    if (!m) throw new Error(`unsupported selector ${sel}`);
    if (m[1] && m[1].toUpperCase() !== this.tagName) return false;
    for (const part of m[2].match(/\.[\w-]+|\[[^\]]+\]/g) ?? []) {
      if (part[0] === '.') { if (!this.className.split(' ').includes(part.slice(1))) return false; continue; }
      const a = /^\[([\w-]+)(?:(\^?=)"([^"]*)")?\]$/.exec(part)!;
      const v = this.attr(a[1]);
      if (v === undefined || (a[2] === '=' && v !== a[3]) || (a[2] === '^=' && !v.startsWith(a[3]))) return false;
    }
    return true;
  }
  matches(sel: string): boolean {
    return sel.split(',').some((one) => {
      const parts = one.trim().split(/\s+/);
      if (!this.#compound(parts.at(-1)!)) return false;
      let i = parts.length - 2;
      for (let x = this.parentElement; x && i >= 0; x = x.parentElement) if (x.#compound(parts[i])) i--;
      return i < 0;
    });
  }
  closest(sel: string) { for (let x: Node | null = this; x; x = x.parentElement) if (x.matches(sel)) return x; return null; }
  querySelectorAll(sel: string) { return [...this.descendants()].filter((n) => n.matches(sel)); }
  querySelector(sel: string) { return this.querySelectorAll(sel)[0] ?? null; }
  focus() { this.doc.activeElement = this; }
  getAnimations() { return []; }
  getBoundingClientRect() { return { top: 0, bottom: 0, height: 0, left: 0, right: 0, width: 0 }; }
  addEventListener() {} dispatchEvent() { return true; }
}

/** Rail-like paint of the selected plan: Readiness with a Show task button, then Tasks (complete only with matching detail). */
function railPaint(make: (tag: string, cls?: string) => Node, root: Node, vc: ViewContext<Ui>) {
  const p = vc.read?.plans.find((x) => x.id === 'P-attention');
  if (!p) return;
  const d = vc.detail(p);
  const complete = d?.state === 'ready' && d.value.revision === p.revision;
  const article = make('article', 'ap-plan');
  Object.assign(article.dataset, { testid: `plan-${p.id}`, source: p.sourceId, revision: String(p.revision), reading: '' });
  const ready = make('section', 'ap-section ap-readiness'); ready.dataset.testid = 'readiness'; ready.dataset.state = complete ? 'ready' : 'loading';
  // Like readiness: the entry exists only while its task is pending or blocked.
  const dependency = d?.state === 'ready' ? d.value.items.find((i) => i.id === 'dependency') : undefined;
  if (complete && (dependency?.status === 'blocked' || dependency?.status === 'pending')) {
    const entry = make('li', 'ap-ready-entry'); entry.dataset.testid = 'readiness-entry-dependency';
    const head = make('div', 'ap-ready-head'); const button = make('button', 'ap-link ap-ready-link'); button.setAttribute('aria-label', 'Show task: Wait for input');
    head.append(button); entry.append(head); ready.append(entry);
  }
  const tasks = make('section', 'ap-section ap-tasks'); if (complete) tasks.dataset.complete = '';
  const heading = make('h3', 'ap-h ap-tasks-h'); heading.tabIndex = -1; tasks.append(heading);
  if (complete) { const ul = make('ul', 'ap-items'); ul.dataset.testid = `items-${p.id}`; tasks.append(ul); }
  article.append(ready, tasks); root.append(article);
}

// The actual shared controller against the real service: cached anchors and retired held replies.
type Ui = Record<string, never>;
function controller(f: Fixture, hold: { when: (q: GuestRequest) => boolean; gate: Promise<void> } | null = null, options: { dom?: boolean } = {}) {
  const listeners: Record<string, (value?: any) => void> = {};
  const docListeners: Record<string, () => void> = {};
  const requests: GuestRequest[] = [];
  const paints: string[] = [];
  const focusDoc = { activeElement: null as Node | null, body: null as Node | null };
  const make = (tag: string, cls = '') => { const n = new Node(tag, focusDoc); n.className = cls; return n; };
  const stub = () => ({ dataset: {} as Record<string, string>, firstElementChild: null as any, querySelector: () => null, querySelectorAll: () => [], getAnimations: () => [], setAttribute() {}, append() {}, replaceChildren(child: any) { this.firstElementChild = child; } });
  const node: (tag?: string, cls?: string) => any = options.dom ? (tag = 'div', cls = '') => make(tag, cls) : stub;
  const body = options.dom ? make('body') : null;
  const mount = node('div');
  if (body) { body.append(mount); focusDoc.body = body; focusDoc.activeElement = body; }
  const document = {
    documentElement: node('html'), head: node('head'), visibilityState: 'visible',
    get activeElement() { return focusDoc.activeElement; },
    getElementById: (id: string) => (id === 'root' ? mount : {}), addEventListener: (name: string, fn: () => void) => { docListeners[name] = fn; }, scrollingElement: { scrollTop: 0 },
  };
  const real = proxy(f);
  const state = { hold };
  const h = {
    serviceRequest: async (q: GuestRequest) => { requests.push(q); if (state.hold?.when(q)) await state.hold.gate; return real.serviceRequest(q); },
    storage: { get: async () => undefined, set: async () => {}, delete: async () => {} }, onReady: (fn: any) => { listeners.ready = fn; }, onSession: (fn: any) => { listeners.session = fn; }, onDirectory: (fn: any) => { listeners.directory = fn; },
  };
  const exports: any = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL('../../ui/shared/app.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports, document, window: { addEventListener: (name: string, fn: any) => { listeners[name] = fn; } }, queueMicrotask, performance, console, setTimeout: () => 1, clearTimeout() {}, HTMLElement: Node, Element: Node,
    require: (name: string) => {
      if (name === '@openchamber/sdk') return { connectHost: () => h };
      if (name === '@openchamber/sdk/ui') return { applyHostReady() {} };
      if (name === './source.ts') return source;
      if (name === './cleanup.ts') return cleanup;
      if (name === './refresh.ts') return refresh;
      if (name === './path.ts') return path;
      if (name === './components.ts') return { el: node, refreshLabels() {} };
      if (name === './live.ts') return { LiveWorkspace: class { snapshot = EMPTY_LIVE; sessionSubscriptionCount = 0; start() {} restart() {} want() {} dispose() {} } };
      if (name === './official.ts') return { OfficialMainState: class { check = async () => ({ next: null, apply: () => false }); } };
      return {};
    },
  });
  let vc!: ViewContext<Ui>;
  const spec: ViewSpec<Ui> = {
    surface: 'panel', maxSessionSubscriptions: 2, initialUi: () => ({}),
    scope: ({ session }) => (session ? { session: session.id } : null),
    wantProjects: () => [], wantDetails: (c) => c.read?.plans.filter((p) => p.id === 'P-attention') ?? [],
    reading: (c) => { const p = c.read?.plans.find((x) => x.id === 'P-attention'); return p && c.session ? { plan: p.key, scope: `rail:${c.session.id}` } : null; },
    paint: (root, value) => {
      vc = value;
      if (!options.dom) return;
      railPaint(make, root as unknown as Node, value);
      paints.push((root as unknown as Node).querySelector('[data-testid="readiness"]')?.dataset.state ?? 'none');
    },
  };
  exports.startView(spec);
  const visibility = (state: 'hidden' | 'visible') => { document.visibilityState = state; docListeners.visibilitychange?.(); };
  return {
    requests, state, paints, mount: mount as Node, get active() { return focusDoc.activeElement; }, get vc() { return vc; },
    ready: (id: string | null) => listeners.ready({ session: id ? { id } : null, directory: '/fixture/Alpha', connection: { account: 'fixture' }, locale: 'en', surface: 'panel' } as HostReadyContext),
    retry: () => vc.retry(), stop: () => listeners.pagehide(), hide: () => visibility('hidden'), show: () => visibility('visible'),
  };
}
async function until(what: string, ok: () => boolean) {
  for (let i = 0; i < 400 && !ok(); i++) await new Promise<void>((r) => setTimeout(r, 5));
  assert.ok(ok(), what);
}
const attentionIn = (vc: ViewContext<Ui> | undefined) => { const p = vc?.read?.plans.find((x) => x.id === 'P-attention'); return vc && p ? attention(readiness(p, vc.detail(p)), FRESH) : null; };
const anchorIn = (vc: ViewContext<Ui> | undefined) => { const p = vc?.read?.plans.find((x) => x.id === 'P-attention'); const d = vc && p ? vc.detail(p) : null; return d?.state === 'ready' ? d.value.blockedTiming?.decision : undefined; };

test('actual controller: cached revisits and polls keep the receipt anchor; a new revision brings a new one', async () => {
  const f = await launchNeedsYouService();
  const c = controller(f);
  try {
    c.ready('M');
    await until('rail M shows Needs you', () => attentionIn(c.vc)?.state === 'ready');
    assert.deepEqual((attentionIn(c.vc) as Rec).rows.map((e: Rec) => e.item.id), ATTENTION);
    const first = anchorIn(c.vc)!;
    assert.equal(first.kind, 'exact');
    // M → U → M: U never inherits M's attention; M's cached detail keeps its anchor.
    c.ready('U');
    await until('U list read', () => !!c.vc?.read && !c.vc.read.plans.some((p) => p.id === 'P-attention'));
    assert.equal(attentionIn(c.vc), null);
    c.ready('M');
    await until('M again', () => attentionIn(c.vc)?.state === 'ready');
    c.retry(); await until('poll settled', () => attentionIn(c.vc)?.state === 'ready');
    assert.equal(anchorIn(c.vc), first, 'same anchor object: no reread, no reset');
    // An explicit unblock is a new revision: a fresh reply, a fresh anchor, one fewer row; nothing is done.
    f.apply({ op: 'change', changes: [{ id: 'decision', status: 'pending' }] });
    c.retry();
    await until('new revision read', () => { const a = attentionIn(c.vc); return a?.state === 'ready' && !a.rows.some((e) => e.item.id === 'decision'); });
    assert.deepEqual((attentionIn(c.vc) as Rec).rows.map((e: Rec) => e.item.id), ATTENTION.slice(1));
    assert.equal(anchorIn(c.vc), undefined, 'no timing entry for a task no longer blocked');
    const p = c.vc.read!.plans.find((x) => x.id === 'P-attention')!;
    assert.equal(p.counts?.done, 0, 'unblocking never completes the task');
  } finally { c.stop(); await f.stop(); }
});

test('actual controller: a held continuation retired by a session switch sends nothing further and restores no attention', async () => {
  const f = await launchNeedsYouService();
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const c = controller(f, { when: (q) => q.path === '/v1/plan' && !!q.query?.cursor, gate });
  try {
    c.ready('M');
    await until('continuation held', () => c.requests.some((q) => q.path === '/v1/plan' && q.query?.cursor));
    assert.deepEqual(attentionIn(c.vc), { state: 'loading' }, 'a held page is loading, never a partial Needs you');
    c.ready(null);
    c.ready('U');
    await until('U list read', () => !!c.vc?.read && !c.vc.read.plans.some((p) => p.id === 'P-attention'));
    const mark = c.requests.length;
    release();
    await new Promise<void>((r) => setTimeout(r, 50));
    assert.equal(c.requests.slice(mark).some((q) => q.path === '/v1/plan'), false, 'no further continuation after retirement');
    assert.equal(attentionIn(c.vc), null, 'U never shows M\'s attention');
  } finally { c.stop(); await f.stop(); }
});

test('actual controller: hide retires a held detail read; released while hidden it requests no continuation, visible re-reads', async () => {
  const f = await launchNeedsYouService();
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const c = controller(f);
  try {
    c.ready('M');
    await until('rail M shows Needs you', () => attentionIn(c.vc)?.state === 'ready');
    const anchor = anchorIn(c.vc)!;
    // Hold the next first page, cause a new revision, then hide before releasing it.
    let held = false;
    c.state.hold = { when: (q) => !held && q.path === '/v1/plan' && !q.query?.cursor && (held = true), gate };
    const revision = (f.apply({ op: 'revise', title: 'Reported waits held' }), f.store.get(f.source.id, 'P-attention')!.revision);
    c.retry();
    await until('first page held', () => held);
    c.hide();
    const mark = c.requests.length;
    release();
    await new Promise<void>((r) => setTimeout(r, 100));
    assert.deepEqual(c.requests.slice(mark).filter((q) => q.path === '/v1/plan').map((q) => q.query?.cursor ?? 'first'), [], 'no continuation page while hidden');
    assert.deepEqual(attentionIn(c.vc), { state: 'loading' }, 'the retired reply restores no attention');
    // Visible again: the existing refresh reads the new revision, complete and current.
    c.show();
    await until('visible re-read', () => { const p = c.vc.read?.plans.find((x) => x.id === 'P-attention'); const d = p && c.vc.detail(p); return d?.state === 'ready' && d.value.revision === revision; });
    const pages = c.requests.slice(mark).filter((q) => q.path === '/v1/plan');
    assert.ok(pages.some((q) => !q.query?.cursor) && pages.some((q) => q.query?.cursor), 'a fresh complete read after becoming visible');
    assert.deepEqual((attentionIn(c.vc) as Rec).rows.map((e: Rec) => e.item.id), ATTENTION);
    assert.equal(anchorIn(c.vc)!.since, anchor.since, 'same reported interval at the new revision');
  } finally { c.stop(); await f.stop(); }
});

test('actual controller: a revision bump repaints through loading and returns focus to the same readiness entry', async () => {
  const f = await launchNeedsYouService();
  const c = controller(f, null, { dom: true });
  try {
    c.ready('M');
    const button = () => c.mount.querySelector('[data-testid="readiness-entry-dependency"] button');
    await until('complete rail paint', () => !!button());
    const before = button()!;
    before.focus();
    c.paints.length = 0;
    f.apply({ op: 'revise', title: 'Reported waits focus' });
    const revision = String(f.store.get(f.source.id, 'P-attention')!.revision);
    c.retry();
    await until('repainted complete at the new revision', () => c.mount.querySelector('article')?.dataset.revision === revision && !!button());
    assert.ok(c.paints.includes('loading'), 'the bump painted readiness as loading in between');
    const after = button()!;
    assert.notEqual(after, before, 'a new paint');
    assert.equal(c.active, after, 'focus returned to the same entry\'s Show task button');
    assert.ok(c.mount.contains(c.active));
    // Same-revision repaints keep it too (unchanged behaviour).
    c.retry();
    await new Promise<void>((r) => setTimeout(r, 50));
    assert.equal(c.active?.getAttribute('aria-label'), 'Show task: Wait for input');
  } finally { c.stop(); await f.stop(); }
});

test('actual controller: when the focused readiness entry is gone after a revision bump, focus lands on the new Tasks heading', async () => {
  const f = await launchNeedsYouService();
  const c = controller(f, null, { dom: true });
  try {
    c.ready('M');
    const button = () => c.mount.querySelector('[data-testid="readiness-entry-dependency"] button');
    await until('complete rail paint', () => !!button());
    button()!.focus();
    const oldHeading = c.mount.querySelector('.ap-tasks-h');
    c.paints.length = 0;
    // Reported working: the task leaves readiness entirely, so its entry is gone.
    f.apply({ op: 'change', changes: [{ id: 'dependency', status: 'working' }] });
    const revision = String(f.store.get(f.source.id, 'P-attention')!.revision);
    c.retry();
    await until('complete repaint without the entry', () => c.mount.querySelector('article')?.dataset.revision === revision && !!c.mount.querySelector('.ap-tasks[data-complete]'));
    assert.ok(c.paints.includes('loading'), 'the bump painted readiness as loading in between');
    assert.equal(button(), null, 'the entry is gone');
    const heading = c.mount.querySelector('.ap-tasks-h');
    assert.notEqual(heading, oldHeading, 'a new paint');
    assert.equal(c.active, heading, 'focus is on the new paint\'s Tasks heading, not the body');
  } finally { c.stop(); await f.stop(); }
});
