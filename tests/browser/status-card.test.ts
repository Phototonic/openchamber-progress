import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as model from '../../ui/shared/model.ts';
import * as scope from '../../ui/shared/scope.ts';
import * as format from '../../ui/shared/format.ts';
import * as i18n from '../../ui/shared/i18n.ts';
import { EMPTY_LIVE } from '../../ui/shared/live.ts';
import { scopeInbox } from '../../ui/shared/inbox.ts';
import { StatusSelection } from '../../ui/status/selection.ts';
import { projectStatus } from '../../ui/status/projection.ts';
import { parsePlansPage } from '../../ui/shared/adapter.ts';
import { at, plansPage, summary, S } from './fixtures.ts';

class Node {
  dataset: Record<string, string> = {};
  attrs: Record<string, string> = {};
  childNodes: (Node | string)[] = [];
  events: Record<string, () => void> = {};
  classList = { add() {} };
  title = '';
  tabIndex = 0;
  tag: string;
  className: string;
  constructor(tag: string, className = '', text = '') { this.tag = tag; this.className = className; if (text) this.childNodes.push(text); }
  append(...n: (Node | string)[]) { this.childNodes.push(...n); }
  prepend(...n: (Node | string)[]) { this.childNodes.unshift(...n); }
  setAttribute(k: string, v: string) { this.attrs[k] = v; }
  removeAttribute(k: string) { delete this.attrs[k]; }
  addEventListener(k: string, cb: () => void) { this.events[k] = cb; }
  querySelector(selector?: string): Node | null { return selector === '.oc-sdk-trigger' ? this.childNodes.find((n): n is Node => n instanceof Node && n.className === 'oc-sdk-trigger') ?? null : null; }
  get textContent(): string { return this.childNodes.map(n => typeof n === 'string' ? n : n.textContent).join(''); }
  *all(): Generator<Node> { yield this; for (const n of this.childNodes) if (typeof n !== 'string') yield* n.all(); }
}
const el = (tag: string, cls = '', text = '') => new Node(tag, cls, text);
const testid = (n: Node, id: string) => { n.dataset.testid = id; return n; };
const hook = (n: Node, id: string) => [...n.all()].find(n => n.dataset.testid === id);
const plan = parsePlansPage(JSON.stringify(plansPage([summary('status', [
  { id: 'W', title: 'Build', kind: 'task', status: 'working' },
  { id: 'D', title: 'Prepare', kind: 'task', status: 'done' },
])]))).data[0];

function harness() {
  let spec: any, options: any;
  const js = ts.transpileModule(readFileSync(new URL('../../ui/status/main.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  runInNewContext(js, { exports: {}, require(name: string) {
    if (name.endsWith('/app.ts')) return { RECENT_SCOPES: 8, startView: (s: any) => { spec = s; } };
    if (name === '@openchamber/sdk/ui') return { mountSelect: (n: Node, o: unknown) => { options = o; n.append(el('button', 'oc-sdk-trigger')); } };
    if (name.endsWith('/components.ts')) return {
      el, testid, allDone() {}, age: (_at: string, _env: unknown, label: string) => el('time', '', label + '2h'),
      emptyBlock: (id: string, text: string) => testid(el('div', '', text), id), loadingBlock: () => testid(el('div'), 'loading'),
      failureBlock: () => testid(el('div'), 'failure'), retryRead: () => () => {},
      button: (n: Node, id: string, text: string, cb: () => void) => { const b = testid(el('button', '', text), id); b.events.click = cb; n.append(b); },
    };
    if (name.endsWith('/model.ts')) return model;
    if (name.endsWith('/scope.ts')) return scope;
    if (name.endsWith('/format.ts')) return format;
    if (name.endsWith('/i18n.ts')) return i18n;
    if (name.endsWith('/primitives.ts')) return { segmentedBar: (_s: unknown, label: string) => { const n = testid(el('div'), 'progress-bar'); n.setAttribute('aria-label', label); return n; } };
    if (name.endsWith('/selection.ts')) return { StatusSelection };
    if (name.endsWith('/projection.ts')) return { projectStatus };
    if (name.endsWith('/inbox.ts')) return { scopeInbox };
    if (name.endsWith('/census-view.ts')) return { runClaim: () => ({}) };
    if (name.endsWith('/census.ts')) return { censusFor: () => null, planFacts: () => null };
    if (name.endsWith('/subagents.ts')) return { rosterFor: (v: any) => v.runs?.roster ?? null };
    return {};
  } });
  const opens: string[] = [];
  let invalidations = 0;
  const vc: any = {
    ui: spec.initialUi(), ctx: {}, identity: 'test', session: { id: S.M }, directory: '/fixture/Alpha',
    read: { plans: [plan], binding: { verified: true }, captureEnabled: true, truncated: false },
    detail: () => null, runs: () => null, live: EMPTY_LIVE,
    env: { locale: 'en', now: Date.parse(at(0)), live: EMPTY_LIVE, boundSource: plan.sourceId, view: { fresh: true, captureEnabled: true } },
    host: { openSurface: async (surface: string) => { opens.push(surface); } },
    invalidate: () => { invalidations++; },
  };
  const paint = () => { const root = el('main'); spec.paint(root, vc); return root; };
  return { vc, paint, opens, options: () => options, refresh: () => spec.refreshed?.(vc), invalidations: () => invalidations };
}

test('unchanged successful refresh reevaluates the one-hour age boundary once', () => {
  const h = harness(), unchanged = h.vc.read;
  h.vc.env.now = Date.parse(plan.reportedAt) + 3_600_000;
  assert.equal(hook(h.paint(), 'status-stale-time'), undefined);
  h.refresh();
  assert.equal(h.invalidations(), 0, 'the exact one-hour boundary is not old');
  h.vc.env.now++;
  h.refresh();
  assert.equal(h.invalidations(), 1, 'unchanged progress must invalidate when age visibility changes');
  assert.ok(hook(h.paint(), 'status-stale-time'));
  h.refresh();
  assert.equal(h.invalidations(), 1, 'later unchanged polls do not keep repainting');
  assert.equal(h.vc.read, unchanged, 'the transition requires no changed progress data');
  h.vc.env.now--;
  h.refresh();
  assert.equal(h.invalidations(), 2, 'a clock correction also removes obsolete age visibility');
  assert.equal(hook(h.paint(), 'status-stale-time'), undefined);
});

test('five compact rows retain whole-plan summary without old rows or fresh timestamps', () => {
  const h = harness(), root = h.paint();
  assert.equal(hook(root, 'counts')?.dataset.total, '2');
  assert.match(hook(root, 'progress-bar')!.attrs['aria-label'], /1.*2.*remaining/i);
  assert.equal(hook(root, 'status-stale-time'), undefined);
  for (const id of ['current-work', 'more-plans', 'subagent-activity', 'state-chip', 'incomplete-counts']) assert.equal(hook(root, id), undefined);
  assert.equal(hook(root, 'status-activity'), undefined, 'no invented activity when every known count is zero');
});

test('only active reports older than one hour show time; recording off takes its place', () => {
  const h = harness();
  h.vc.env.now = Date.parse(plan.reportedAt) + 3_600_000;
  assert.equal(hook(h.paint(), 'status-stale-time'), undefined, 'one-hour boundary');
  h.vc.env.now++;
  assert.ok(hook(h.paint(), 'status-stale-time'));
  h.vc.read.captureEnabled = false;
  const off = h.paint();
  assert.ok(hook(off, 'capture-off')); assert.equal(hook(off, 'status-stale-time'), undefined);
  for (const lifecycle of ['completed', 'cancelled', 'failed']) {
    h.vc.read.plans = [{ ...plan, lifecycle }];
    h.vc.read.captureEnabled = true;
    const root = h.paint();
    assert.equal(hook(root, 'status-stale-time'), undefined);
    assert.equal(hook(root, 'status-activity')!.textContent, model.lifecycleLabel(lifecycle as model.PlanView['lifecycle'], 'en'));
  }
});

test('running/waiting are roster facts, not task-working counts; partial wording survives', () => {
  const h = harness();
  h.vc.runs = () => ({ roster: { summary: [
    { kind: 'waiting', text: '1 waiting on you' }, { kind: 'running', text: '2+ running' }, { kind: 'finished', text: '9 finished' },
  ] } });
  assert.equal(hook(h.paint(), 'status-activity')!.textContent, '2+ running · 1 waiting on you');
});

test('Needs you is scoped across session plans and hidden before counting; zero has no badge', () => {
  const h = harness();
  const row = (id: string, planKey = plan.key) => ({
    planKey, source: plan.sourceId, plan: plan.id, task: { id }, blocker: { state: 'reported', reportedRevision: 1 },
  });
  h.vc.inbox = {
    model: { availability: 'ready', needsYou: [row('visible'), row('hidden'), row('foreign', 'other/key')], alsoBlocked: [], counts: { needsYou: 3, alsoBlocked: 0 }, complete: true },
    device: { hidden: (key: string) => key.includes('"hidden"') }, storeId: 'store',
  };
  let root = h.paint();
  assert.equal(hook(root, 'needs-you-count')!.dataset.count, '1');
  assert.equal(hook(root, 'needs-you-count')!.textContent, '1 needs you');
  hook(root, 'needs-you-count')!.events.click(); assert.equal(h.opens.length, 1);
  h.vc.inbox.model.needsYou = [];
  h.vc.inbox.model.counts.needsYou = 0; h.vc.inbox.model.complete = false;
  root = h.paint();
  for (const locale of ['en', 'ru', 'zh-CN']) {
    h.vc.env.locale = locale;
    for (const complete of [false, true]) {
      h.vc.inbox.model.complete = complete;
      root = h.paint();
      assert.equal(hook(root, 'needs-you-count'), undefined);
      assert.doesNotMatch(root.textContent, /\b0\+/);
    }
  }
});

test('every removed-pager error has a visible non-dismissible home, including closed plans', () => {
  const h = harness();
  h.vc.read.plans = [{ ...plan, lifecycle: 'completed' }];
  h.vc.detail = () => ({ state: 'error' });
  h.vc.runs = () => ({ state: 'error', pageError: true, historyRequestFailed: true });
  h.vc.inbox = { model: { availability: 'invalid', needsYou: [], alsoBlocked: [], counts: { needsYou: 0, alsoBlocked: 0 }, moreFailed: {} } };
  h.vc.failure = { kind: 'unavailable' };
  for (const locale of ['en', 'ru', 'zh-CN']) {
    h.vc.env.locale = locale;
    const root = h.paint();
    for (const id of ['stale-banner', 'status-retry', 'status-detail-unavailable', 'status-inbox-error', 'status-inbox-page-error', 'status-runs-error', 'subagent-page-error', 'status-history-error']) assert.ok(hook(root, id), `${locale}: ${id}`);
    assert.equal(hook(root, 'needs-you-count'), undefined);
    assert.ok(hook(root, 'open-detail'));
  }
});

test('position picker keeps Automatic first and every full title; no more-plans control', () => {
  const h = harness();
  h.vc.read.plans.push({ ...plan, key: 'other/full-title', title: 'A long literal plan title', id: 'other' });
  h.vc.read.truncated = true;
  const root = h.paint();
  assert.equal(h.options().options[0].id, 'automatic');
  assert.ok(h.options().options.some((p: any) => p.label === 'A long literal plan title'));
  const trigger = hook(root, 'status-plan-selector')!.querySelector('.oc-sdk-trigger')!;
  assert.match(trigger.attrs['aria-label'], /\/2\+$/);
  assert.match(trigger.textContent, /\/2\+$/);
  assert.equal(hook(root, 'more-plans'), undefined);
});
