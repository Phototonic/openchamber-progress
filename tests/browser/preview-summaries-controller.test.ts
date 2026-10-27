import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import type { GuestRequest, GuestRequestResult } from '@openchamber/sdk';
import type { SummaryView, ViewContext, ViewSpec } from '../../ui/shared/app.ts';
import * as source from '../../ui/shared/source.ts';
import * as summaries from '../../ui/shared/summary.ts';
import * as cleanup from '../../ui/shared/cleanup.ts';
import * as refresh from '../../ui/shared/refresh.ts';
import * as path from '../../ui/shared/path.ts';
import { EMPTY_LIVE } from '../../ui/shared/live.ts';
import { EXPECTED_HANDOFF, EXPECTED_PROGRESS, SUMMARY_ITEMS, pagedSummaryItems, summaryEnvelope, summaryPage, summaryPlan, summaryReports } from '../fixtures/preview-summaries.ts';
import { HEALTH, setupRead } from './fixtures.ts';

const reply = (body: unknown, status = 200): GuestRequestResult => ({ status, body: JSON.stringify(body) });
type Route = (q: GuestRequest) => Promise<GuestRequestResult> | GuestRequestResult;
function deferred<T>() { let resolve!: (v: T) => void; let reject!: (e: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
async function settle() { for (let i = 0; i < 8; i++) await new Promise<void>((r) => setImmediate(r)); }
type Ui = { selected: string | null; filter: string; archived: boolean };

/** Actual controller and real read parser, deterministic held replies/clipboard. DOM mechanics,
 * visual layout and real user activation belong to current-bundle browser QA, not this harness. */
function controller(surface: 'panel' | 'page' | 'status' = 'panel') {
  const listeners: Record<string, (v?: any) => void> = {};
  const requests: GuestRequest[] = [];
  const writes: string[] = [];
  let write: ((text: string) => Promise<void>) | null = async () => {};
  const navigator = { clipboard: { writeText: (text: string) => { writes.push(text); return write!(text); } } as { writeText: (text: string) => Promise<void> } | undefined };
  // Minimal focus/textarea seam: replacing a focused subtree sends focus to body, and
  // disabled native controls cannot receive it. Real input and layout remain browser QA.
  class FocusNode {
    dataset: Record<string, string> = {};
    children: FocusNode[] = [];
    disabled = false;
    value = '';
    selectionStart = 0;
    selectionEnd = 0;
    selectionDirection = 'none';
    scrollTop = 0;
    get firstElementChild() { return this.children[0] ?? null; }
    contains(n: FocusNode | null): boolean { return !!n && (n === this || this.children.some((child) => child.contains(n))); }
    querySelectorAll(selector: string): FocusNode[] {
      const id = /^\[data-testid="([^"]+)"\]$/.exec(selector)?.[1];
      return this.children.flatMap((child) => [...(id && child.dataset.testid === id ? [child] : []), ...child.querySelectorAll(selector)]);
    }
    querySelector(selector: string) { return this.querySelectorAll(selector)[0] ?? null; }
    closest(selector: string) { return selector === '[data-testid]' && this.dataset.testid ? this : null; }
    focus() { if (!this.disabled) document.activeElement = this; }
    setSelectionRange(start: number, end: number, direction: string) { this.selectionStart = start; this.selectionEnd = end; this.selectionDirection = direction; }
    getAnimations() { return []; }
    setAttribute() {}
    append(...children: FocusNode[]) { this.children.push(...children); }
    replaceChildren(child: FocusNode) { if (this.contains(document.activeElement)) document.activeElement = document.body; this.children = [child]; }
  }
  const node = () => new FocusNode();
  const mount = node();
  const body = node();
  const document = { documentElement: node(), head: node(), body, visibilityState: 'visible', activeElement: body as FocusNode | null, getElementById: (id: string) => id === 'root' ? mount : {}, addEventListener() {}, scrollingElement: { scrollTop: 0 } };
  const state = { items: SUMMARY_ITEMS, reports: summaryReports(), rows: [summaryPlan()], envelope: summaryEnvelope(), listFails: false };
  let detail: Route = (q) => {
    const p = state.rows.find((p) => p.id === q.query?.plan && p.sourceId === q.query?.source);
    return p ? reply(summaryPage(state.items, state.reports, Number(q.query?.cursor ?? 0), p, state.envelope)) : reply({ error: 'not-found' }, 404);
  };
  let readStarts = 0;
  const host = {
    serviceRequest: async (q: GuestRequest) => {
      requests.push(q);
      if (q.path === '/health') return reply({ ...HEALTH, planCleanup: 1 });
      if (q.path === '/v1/setup') return reply(setupRead());
      if (q.path === '/v1/plans') return state.listFails ? reply({ error: 'busy' }, 503) : reply({ ...state.envelope, data: state.rows.filter((p) => (p.cleanup?.state === 'archived') === (q.query?.archived === 'only')), nextCursor: null });
      if (q.path === '/v1/plan') return detail(q);
      return reply({ error: 'not-found' }, 404);
    },
    storage: { get: async () => undefined, set: async () => {}, delete: async () => {} },
    onReady: (fn: any) => { listeners.ready = fn; }, onSession: (fn: any) => { listeners.session = fn; }, onDirectory: (fn: any) => { listeners.directory = fn; },
  };
  const exports: any = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL('../../ui/shared/app.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports, document, navigator, window: { addEventListener: (name: string, fn: any) => { listeners[name] = fn; } }, queueMicrotask, performance, console, setTimeout: () => 1, clearTimeout() {},
    require: (name: string) => {
      if (name === '@openchamber/sdk') return { connectHost: () => host };
      if (name === '@openchamber/sdk/ui') return { applyHostReady() {} };
      if (name === './source.ts') return { ...source, readDetail: (...args: Parameters<typeof source.readDetail>) => { readStarts++; return source.readDetail(...args); } };
      if (name === './summary.ts') return summaries;
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
  let view: SummaryView | null = null;
  const selected = (c: ViewContext<Ui>) => c.read?.plans.find((p) => p.key === c.ui.selected) ?? c.read?.plans[0] ?? null;
  const spec: ViewSpec<Ui> = {
    surface, maxSessionSubscriptions: 2, initialUi: () => ({ selected: null, filter: 'all', archived: false }),
    scope: ({ session }, ui) => surface === 'page' ? { archived: ui.archived ? 'only' : 'exclude', session: ui.filter === 'all' ? null : ui.filter } : session ? { session: session.id } : null,
    wantProjects: () => [], wantDetails: (c) => { const p = selected(c); return p ? [p] : []; }, actionPlan: selected,
    forgetPlans: (keys, ui) => keys.has(ui.selected ?? '') ? { selected: null } : {},
    reading: (c) => { const p = selected(c); return p ? { plan: p.key, scope: surface === 'page' ? JSON.stringify([c.ui.filter, c.ui.archived]) : `rail:${c.session?.id}` } : null; },
    paint: (root, c) => {
      vc = c; const p = selected(c); view = p ? c.summary(p) : null;
      if (!view) return;
      const control = (id: string) => { const n = node(); n.dataset.testid = id; (root as unknown as FocusNode).append(n); return n; };
      control('summary-progress'); control('summary-handoff');
      if (!view.preview) return;
      control('summary-copy').disabled = view.preview.copying || view.preview.text === null;
      control('summary-close');
      if (view.preview.text !== null) {
        const text = control('summary-text'); text.value = view.preview.text; text.dataset.generation = String(view.preview.generation);
      }
    },
  };
  exports.startView(spec);
  return {
    state, requests, writes, listeners, get vc() { return vc; }, get view() { return view; }, get readStarts() { return readStarts; },
    control: (id: string) => mount.querySelector(`[data-testid="${id}"]`)!,
    get focused() { return document.activeElement?.dataset.testid ?? 'body'; },
    ready: (session: string | null = 'A', account = 'example') => listeners.ready({ session: session ? { id: session } : null, directory: null, connection: { account }, locale: 'en', surface }),
    route: (r: Route) => { detail = r; }, get normal() { return detail; },
    clipboard: (fn: ((text: string) => Promise<void>) | null) => { write = fn; if (!fn) navigator.clipboard = undefined; },
    stop: () => listeners.pagehide(),
  };
}

test('opening is preview-only; each format copies exactly the displayed complete text after resolution', async () => {
  const c = controller(); c.ready(); await settle();
  for (const [mode, expected] of [['progress', EXPECTED_PROGRESS], ['handoff', EXPECTED_HANDOFF]] as const) {
    const count = c.writes.length;
    c.view!.open(mode); await settle();
    assert.equal(c.view!.preview!.text, expected);
    assert.equal(c.writes.length, count);
    const held = deferred<void>(); c.clipboard(() => held.promise);
    c.view!.copy(); assert.equal(c.writes.at(-1), expected); await settle();
    assert.equal(c.view!.preview!.status, 'Copying…');
    held.resolve(); await settle(); assert.equal(c.view!.preview!.status, 'Markdown copied.');
  }
  assert.equal(c.requests.some((q) => q.method !== 'GET' || ['/v1/document', '/v1/history'].includes(q.path)), false);
  c.stop();
});

test('clipboard rejection, synchronous throw and absence leave identical selectable text; never success', async () => {
  for (const write of [async () => { throw new Error('denied'); }, () => { throw new Error('unsupported'); }, null]) {
    const c = controller(); c.ready(); await settle(); c.view!.open('progress'); await settle();
    const text = c.view!.preview!.text; c.clipboard(write); c.view!.copy(); await settle();
    assert.equal(c.view!.preview!.text, text);
    assert.match(c.view!.preview!.status, /Select and copy/);
    assert.equal(c.view!.preview!.copying, false); c.stop();
  }
});

test('held unequal continuation streams cannot copy a partial prefix; whole plan ignores task filters', async () => {
  const c = controller(); c.state.items = pagedSummaryItems(); c.state.reports = summaryReports(45); c.state.rows = [summaryPlan(c.state.items)];
  const held = deferred<GuestRequestResult>(); const normal = c.normal;
  c.route((q) => q.query?.cursor === '1' ? held.promise : normal(q)); c.ready(); await settle();
  c.view!.open('handoff'); await settle(); const old = c.view!;
  assert.equal(old.preview!.text, null); old.copy(); assert.equal(c.writes.length, 0);
  held.resolve(await normal({ method: 'GET', path: '/v1/plan', query: { source: c.state.rows[0].sourceId, plan: c.state.rows[0].id, cursor: '1' } })); await settle();
  assert.match(c.view!.preview!.text!, /5 direct; 40 parent-relay/);
  assert.match(c.view!.preview!.text!, /showing 10 of 20/);
  const text = c.view!.preview!.text;
  c.vc.reading!.set({ status: 'unfinished', participant: { kind: 'none' } }); await settle();
  assert.equal(c.view!.preview!.text, text); old.copy(); assert.equal(c.writes.length, 0); c.stop();
});

test('failure after validated first page offers explicit historical fallback; initial failure is retry-only', async () => {
  for (const firstPage of [false, true]) {
    const c = controller(); c.state.items = pagedSummaryItems(); c.state.rows = [summaryPlan(c.state.items)];
    const normal = c.normal;
    c.route((q) => !firstPage || q.query?.cursor ? reply({ error: 'busy' }, 503) : normal(q));
    c.ready(); await settle(); c.view!.open('handoff'); await settle();
    assert.equal(c.view!.preview!.text, null); assert.match(c.view!.preview!.message, /busy \(HTTP 503\)/);
    assert.equal(c.view!.preview!.canSummaryOnly, firstPage);
    c.view!.summaryOnly(); await settle();
    if (firstPage) {
      assert.match(c.view!.preview!.text!, /summary-only historical snapshot/);
      assert.doesNotMatch(c.view!.preview!.text!, /Origin session|Current work|Suggested next step|Recorded reports|Remaining breakdown/);
      c.view!.copy(); await settle(); assert.equal(c.writes[0], c.view!.preview!.text);
    } else assert.equal(c.view!.preview!.text, null);
    c.route(normal); c.view!.retry(); await settle(); assert.match(c.view!.preview!.text!, /Coverage: full/); c.stop();
  }
});

test('new progress revision retires full preview; same-identity earlier first-page snapshot stays explicitly historical on failure', async () => {
  const c = controller(); c.ready(); await settle(); c.view!.open('progress'); await settle(); const old = c.view!;
  const held = deferred<GuestRequestResult>(); c.route(() => held.promise);
  c.state.rows = [{ ...c.state.rows[0], revision: 8 }]; c.vc.retry(); await settle();
  assert.equal(c.view!.preview!.text, null); old.copy(); assert.equal(c.writes.length, 0);
  held.resolve(reply({ error: 'unavailable' }, 503)); await settle();
  assert.equal(c.view!.preview!.canSummaryOnly, true);
  c.view!.summaryOnly(); await settle(); assert.match(c.view!.preview!.text!, /historical snapshot/);
  assert.match(c.view!.preview!.text!, /unavailable \(HTTP 503\)/); c.stop();
});

test('cleanup-only revisions refresh previews; archive selection is readable and restore removes the archive label', async () => {
  const c = controller('page'); c.state.rows = [summaryPlan(SUMMARY_ITEMS, { lifecycle: 'finished', cleanup: { state: 'visible', revision: 0 } })];
  c.ready(); await settle(); c.view!.open('handoff'); await settle(); const old = c.view!; const starts = c.readStarts;
  c.state.rows = [{ ...c.state.rows[0], cleanup: { state: 'visible', revision: 1 } }]; c.vc.retry(); await settle();
  assert.equal(c.readStarts, starts + 1); assert.ok(c.view!.preview!.text); old.copy(); assert.equal(c.writes.length, 0);
  c.state.rows = [{ ...c.state.rows[0], cleanup: { state: 'archived', revision: 2 } }]; c.vc.retry(); await settle();
  assert.equal(c.view, null);
  c.vc.setUi({ archived: true }); await settle(); c.view!.open('handoff'); await settle(); assert.match(c.view!.preview!.text!, /\(archived\)/);
  c.view!.copy(); await settle(); assert.match(c.writes[0], /\(archived\)/);
  c.state.rows = [{ ...c.state.rows[0], cleanup: { state: 'visible', revision: 3 } }]; c.vc.setUi({ archived: false }); await settle();
  c.view!.open('progress'); await settle(); assert.doesNotMatch(c.view!.preview!.text!, /\(archived\)/); c.stop();
});

test('actual not-found during a held read is not revision churn; list removal retires it without inferring deletion', async () => {
  const c = controller(); c.state.items = pagedSummaryItems(); c.state.rows = [summaryPlan(c.state.items)];
  const held = deferred<GuestRequestResult>(); const normal = c.normal;
  c.route((q) => q.query?.cursor ? held.promise : normal(q)); c.ready(); await settle(); c.view!.open('progress'); await settle();
  held.resolve(reply({ error: 'not-found' }, 404)); await settle();
  assert.equal(c.view!.preview!.message, 'The plan was not found.'); assert.equal(c.view!.preview!.text, null);
  const old = c.view!; c.state.rows = []; c.vc.retry(); await settle();
  old.summaryOnly(); old.copy(); old.retry(); assert.equal(c.writes.length, 0); assert.equal(c.view, null); c.stop();
});

test('rail A/B/null retires held reads and callbacks, including closed-preview opening handles', async () => {
  const c = controller(); c.ready(); await settle(); const opener = c.view!;
  c.ready('B'); c.ready('A'); await settle(); opener.open('progress'); await settle(); assert.equal(c.view!.preview, null);
  c.state.items = pagedSummaryItems(); c.state.rows = [summaryPlan(c.state.items, { revision: 8 })];
  const held = deferred<GuestRequestResult>(); const normal = c.normal;
  c.route((q) => q.query?.cursor ? held.promise : normal(q)); c.vc.retry(); await settle(); c.view!.open('handoff'); await settle(); const old = c.view!;
  c.ready('B'); await settle(); c.ready(null); await settle(); const mark = c.requests.length;
  old.copy(); old.retry(); old.summaryOnly(); old.open('progress');
  held.resolve(reply(summaryPage(c.state.items, summaryReports(45), 1, c.state.rows[0]))); await settle();
  assert.equal(c.requests.slice(mark).some((q) => q.path === '/v1/plan'), false);
  assert.equal(c.view, null); assert.equal(c.writes.length, 0); c.stop();
});

test('board follows explicit plan/source/filter, never host A/B/null notifications', async () => {
  const c = controller('page'); c.state.rows.push(summaryPlan(SUMMARY_ITEMS, { sourceId: 'other-source', title: 'Other source plan' }), summaryPlan(SUMMARY_ITEMS, { id: 'P-other', title: 'Other plan' }));
  c.ready(); await settle(); c.view!.open('handoff'); await settle();
  const text = c.view!.preview!.text; const stable = c.view!; const count = c.readStarts;
  c.ready('B'); c.ready(null); c.listeners.directory('Synthetic project'); await settle();
  assert.equal(c.view!.preview!.text, text); assert.equal(c.readStarts, count); stable.copy(); await settle(); assert.equal(c.writes[0], text);
  for (const index of [1, 2, 0]) {
    const old = c.view!; c.vc.setUi({ selected: c.vc.read!.plans[index].key }); old.copy(); await settle();
    assert.equal(c.view!.preview, null); c.view!.open('progress'); await settle();
    assert.match(c.view!.preview!.text!, new RegExp(c.state.rows[index].title));
  }
  const old = c.view!; c.vc.setUi({ filter: 'B' }); old.copy(); await settle(); assert.equal(c.view!.preview, null);
  assert.equal(c.writes.length, 1); c.stop();
});

test('switching source while its continuation is held releases the queue and retires further pages', async () => {
  const c = controller('page'); c.state.items = pagedSummaryItems(45); c.state.rows = [summaryPlan(c.state.items), summaryPlan(c.state.items, { sourceId: 'other-source', title: 'Other source plan' })];
  const held = deferred<GuestRequestResult>(); const normal = c.normal;
  c.route((q) => q.query?.source === c.state.rows[0].sourceId && q.query.cursor === '1' ? held.promise : normal(q));
  c.ready(); await settle(); c.view!.open('handoff'); await settle(); const old = c.view!;
  c.vc.setUi({ selected: c.vc.read!.plans[1].key }); await settle(); c.view!.open('handoff'); await settle();
  assert.match(c.view!.preview!.text!, /Other source plan/);
  const mark = c.requests.length;
  held.resolve(await normal({ method: 'GET', path: '/v1/plan', query: { source: c.state.rows[0].sourceId, plan: c.state.rows[0].id, cursor: '1' } })); await settle();
  old.copy(); old.summaryOnly(); old.retry(); old.close();
  assert.equal(c.requests.slice(mark).some((q) => q.path === '/v1/plan'), false);
  assert.equal(c.writes.length, 0); assert.match(c.view!.preview!.text!, /Other source plan/); c.stop();
});

test('store, binding and account changes retire old snapshots, callbacks and held results', async () => {
  for (const change of ['store', 'binding', 'account'] as const) {
    const c = controller('page'); c.ready(); await settle(); c.view!.open('progress'); await settle(); const old = c.view!;
    const held = deferred<GuestRequestResult>(); c.route(() => held.promise); c.state.rows = [{ ...c.state.rows[0], revision: 8 }]; c.vc.retry(); await settle();
    if (change === 'store') c.state.envelope = summaryEnvelope({ storeId: 'other-store' });
    if (change === 'binding') c.state.envelope = summaryEnvelope({ sourceBinding: { sourceId: 'other-binding', verified: false } });
    if (change === 'account') c.ready('A', 'other-account'); else c.vc.retry();
    await settle(); old.copy(); old.summaryOnly();
    held.resolve(reply(summaryPage())); await settle();
    assert.equal(c.writes.length, 0); assert.equal(c.view!.preview, null);
    c.view!.open('handoff'); await settle();
    if (change !== 'account') { assert.equal(c.view!.preview!.text, null); assert.equal(c.view!.preview!.canSummaryOnly, false); assert.match(c.view!.preview!.message, /identity/); }
    c.stop();
  }
});

test('historical summary-only snapshots do not survive leaving a reading identity, even on return', async () => {
  const c = controller(); c.state.items = pagedSummaryItems(); c.state.rows = [summaryPlan(c.state.items)];
  const normal = c.normal;
  c.route((q) => q.query?.cursor ? reply({ error: 'busy' }, 503) : normal(q));
  c.ready(); await settle(); c.view!.open('handoff'); await settle();
  assert.equal(c.view!.preview!.canSummaryOnly, true); const old = c.view!;
  c.route(() => reply({ error: 'unavailable' }, 503));
  c.ready('B'); await settle(); c.ready('A'); await settle(); c.view!.open('handoff'); await settle();
  assert.equal(c.view!.preview!.canSummaryOnly, false);
  old.summaryOnly(); old.copy(); assert.equal(c.writes.length, 0); c.stop();
});

test('clipboard already authorized cannot be revoked, but retired completion gives no feedback or new authority', async () => {
  for (const boundary of ['selection', 'revision', 'close', 'dispose'] as const) {
    const c = controller('page'); c.state.rows.push(summaryPlan(SUMMARY_ITEMS, { id: 'P-other' })); c.ready(); await settle(); c.view!.open('progress'); await settle();
    const held = deferred<void>(); c.clipboard(() => held.promise); const old = c.view!; const text = old.preview!.text;
    old.copy(); assert.equal(c.writes[0], text);
    if (boundary === 'selection') c.vc.setUi({ selected: c.vc.read!.plans[1].key });
    if (boundary === 'revision') { c.state.rows[0] = { ...c.state.rows[0], revision: 8 }; c.vc.retry(); }
    if (boundary === 'close') old.close();
    if (boundary === 'dispose') c.stop();
    await settle(); held.resolve(); await settle(); old.copy(); old.open('handoff'); await settle();
    assert.equal(c.writes.length, 1); assert.notEqual(c.view?.preview?.status, 'Markdown copied.');
    if (boundary !== 'dispose') c.stop();
  }
});

test('detail ahead of list waits without repaint-driven reads; Work Status exposes no preview controller', async () => {
  const c = controller(); c.route(() => reply(summaryPage(SUMMARY_ITEMS, summaryReports(), 0, summaryPlan(SUMMARY_ITEMS, { revision: 8 }))));
  c.ready(); await settle(); c.view!.open('progress'); await settle(); assert.equal(c.view!.preview!.text, null);
  const starts = c.readStarts;
  for (let i = 0; i < 3; i++) { c.vc.setUi({ selected: null }); await settle(); }
  assert.equal(c.readStarts, starts);
  c.state.rows = [{ ...c.state.rows[0], revision: 8 }]; c.vc.retry(); await settle(); assert.ok(c.view!.preview!.text); assert.equal(c.readStarts, starts); c.stop();
  const status = controller('status'); status.ready(); await settle(); assert.equal(status.view, null); status.stop();
  const statusSource = readFileSync(new URL('../../ui/status/main.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(statusSource, /summary-progress|summary-handoff|\.summary\(|planDetail\(/);
});

test('copy completion restores the disabled control focus on success and failure without stealing textarea focus', async () => {
  for (const outcome of ['success', 'failure', 'textarea'] as const) {
    const c = controller(); c.ready(); await settle(); c.view!.open('progress'); await settle();
    const held = deferred<void>(); c.clipboard(() => held.promise);
    c.control('summary-copy').focus(); c.view!.copy(); await settle();
    assert.equal(c.control('summary-copy').disabled, true);
    assert.equal(c.focused, 'body', 'the disabled replacement cannot take focus');
    if (outcome === 'textarea') {
      const text = c.control('summary-text'); text.focus(); text.setSelectionRange(5, 23, 'forward'); text.scrollTop = 64;
      c.vc.setUi({ selected: null }); await settle();
    }
    if (outcome === 'failure') held.reject(new Error('denied')); else held.resolve();
    await settle();
    assert.equal(c.control('summary-copy').disabled, false);
    assert.equal(c.focused, outcome === 'textarea' ? 'summary-text' : 'summary-copy');
    if (outcome === 'textarea') {
      const text = c.control('summary-text'); assert.deepEqual([text.selectionStart, text.selectionEnd, text.scrollTop], [5, 23, 64]);
    }
    c.stop();
  }
});

test('retired copy completion cannot steal Close focus or focus a replacement preview', async () => {
  for (const boundary of ['close', 'scope'] as const) {
    const c = controller('page'); c.ready(); await settle(); c.view!.open('handoff'); await settle();
    const held = deferred<void>(); c.clipboard(() => held.promise);
    c.control('summary-copy').focus(); c.view!.copy(); await settle();
    if (boundary === 'close') { c.control('summary-close').focus(); c.view!.close(); }
    else c.vc.setUi({ filter: 'B' });
    await settle();
    assert.equal(c.focused, boundary === 'close' ? 'summary-handoff' : 'body');
    c.view!.open('progress'); await settle();
    held.resolve(); await settle();
    assert.equal(c.focused, boundary === 'close' ? 'summary-handoff' : 'body');
    assert.equal(c.view!.preview!.status, ''); assert.equal(c.writes.length, 1); c.stop();
  }
});

test('chosen summary-only text survives another failed refresh, advances on success and retires on scope change', async () => {
  const c = controller('page'); c.state.items = pagedSummaryItems(); c.state.rows = [summaryPlan(c.state.items)];
  const normal = c.normal;
  c.route((q) => q.query?.cursor ? reply({ error: 'busy' }, 503) : normal(q));
  c.ready(); await settle(); c.view!.open('handoff'); await settle(); c.view!.summaryOnly(); await settle();
  const chosen = c.view!.preview!; const old = c.view!;
  const text = c.control('summary-text'); text.focus(); text.setSelectionRange(3, 18, 'forward'); text.scrollTop = 42;
  c.route(() => reply({ error: 'unavailable' }, 503));
  const starts = c.readStarts; c.vc.retry(); await settle(); assert.ok(c.readStarts > starts);
  assert.equal(c.view!.preview!.text, chosen.text);
  assert.equal(c.view!.preview!.generation, chosen.generation);
  assert.equal(c.control('summary-copy').disabled, false);
  assert.deepEqual([c.control('summary-text').selectionStart, c.control('summary-text').selectionEnd, c.control('summary-text').scrollTop], [3, 18, 42]);
  old.copy(); await settle(); assert.equal(c.writes[0], chosen.text);
  c.route(normal); c.vc.retry(); await settle(); assert.match(c.view!.preview!.text!, /Coverage: full/);
  const full = c.view!; c.vc.setUi({ filter: 'B' }); await settle(); assert.equal(c.view!.preview, null);
  old.copy(); full.copy(); assert.equal(c.writes.length, 1); c.stop();
});
