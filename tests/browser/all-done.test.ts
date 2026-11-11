import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as model from '../../ui/shared/model.ts';
import { summaryText, type PlanSummary, type PlanView } from '../../ui/shared/model.ts';
import * as format from '../../ui/shared/format.ts';
import * as i18n from '../../ui/shared/i18n.ts';
import * as live from '../../ui/shared/live.ts';
import * as scope from '../../ui/shared/scope.ts';
import { StatusSelection } from '../../ui/status/selection.ts';
import { projectStatus } from '../../ui/status/projection.ts';
import type { ViewSpec, ViewContext } from '../../ui/shared/app.ts';

// The small DOM seam used by the browser-model tests: execute the actual view
// builders, retaining children, data hooks and attributes rather than HTML/CSS.
class Node {
  children: Node[] = [];
  dataset: Record<string, string> = {};
  attrs: Record<string, string> = {};
  style: Record<string, string> = {};
  className = '';
  textContent = '';
  setAttribute(k: string, v: string) { this.attrs[k] = String(v); }
  getAttribute(k: string) { return this.attrs[k] ?? null; }
  append(...nodes: (Node | string)[]) {
    for (const n of nodes) if (typeof n === 'string') this.textContent += n; else this.children.push(n);
  }
  prepend(n: Node) { this.children.unshift(n); }
  replaceChildren(...nodes: Node[]) { this.children = []; this.append(...nodes); }
  get childNodes() { return this.children; }
  *descendants(): Generator<Node> { for (const c of this.children) { yield c; yield* c.descendants(); } }
}

function fixture() {
  const document = { createElement: () => new Node(), createElementNS: () => new Node() };
  const load = (file: string, require: (name: string) => unknown) => {
    const exports: Record<string, any> = {};
    runInNewContext(ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText, { exports, require, document });
    return exports;
  };
  const primitives = load('../../ui/shared/primitives.ts', () => ({}));
  const components = load('../../ui/shared/components.ts', (name) => {
    if (name === './primitives.ts') return primitives;
    if (name === './model.ts') return model;
    if (name === './format.ts') return format;
    if (name === './i18n.ts') return i18n;
    return {};
  });
  type Ui = { selection: StatusSelection };
  let spec!: ViewSpec<Ui>;
  // Capture the real entry's controller contract as in status-selection.test.ts.
  // Only the unrelated SDK action and official-update line are inert here.
  load('../../ui/status/main.ts', (name) => {
    if (name === '../shared/app.ts') return { RECENT_SCOPES: 8, startView: (value: ViewSpec<Ui>) => { spec = value; } };
    if (name === '../shared/components.ts') return { ...components, button() {} };
    if (name === '../shared/primitives.ts') return primitives;
    if (name === '../shared/model.ts') return model;
    if (name === '../shared/format.ts') return format;
    if (name === '../shared/i18n.ts') return i18n;
    if (name === '../shared/live.ts') return live;
    if (name === '../shared/scope.ts') return scope;
    if (name === './selection.ts') return { StatusSelection };
    if (name === './projection.ts') return { projectStatus };
    if (name === '../shared/official.ts') return { officialMainLine: () => null };
    return {};
  });
  const ui = spec.initialUi();
  let revision = 0;
  const status = (s: PlanSummary) => {
    const plan: PlanView = {
      key: 'source-status/P-status', id: 'P-status', sourceId: 'source-status', title: 'Completion report', ownerSessionId: 'M',
      revision: ++revision, structuralRevision: 1, lifecycle: 'active', reportedAt: '2026-01-01T00:00:00Z', directory: '/fixture/status',
      counts: s, working: [],
      document: { state: 'unbound', checklistSynchronized: false, currentFile: 'unavailable' },
    };
    const root = new Node();
    spec.paint(root as unknown as HTMLElement, {
      ui, ctx: {}, identity: 'fixture-store', session: { id: 'M' }, directory: plan.directory,
      read: { plans: [plan], captureEnabled: true, binding: { verified: false } },
      detail: () => null, failure: null,
      env: { locale: 'en', now: Date.parse(plan.reportedAt), live: live.EMPTY_LIVE, view: { fresh: true, captureEnabled: true } },
    } as unknown as ViewContext<Ui>);
    return root;
  };
  return { progress: components.progressBlock as (s: PlanSummary, compact?: boolean) => Node, status };
}

const summary = (done: number, remaining = 0, skipped = 0): PlanSummary => ({
  done, total: done + remaining, remaining, skipped, working: 0, blocked: 0,
  percent: done + remaining ? Math.round(done / (done + remaining) * 100) : null,
});
const hooks = (root: Node, id: string) => [...root.descendants()].filter((n) => n.dataset.testid === id);

function assertCompletion(root: Node, marked: boolean) {
  const countsHooks = hooks(root, 'counts');
  assert.equal(countsHooks.length, 1);
  const [counts] = countsHooks;
  assert.equal(counts.dataset.allDone, marked ? 'true' : undefined);
  const marks = hooks(counts, 'status-mark');
  assert.equal(marks.length, marked ? 1 : 0);
  if (marked) {
    assert.equal(marks[0].dataset.status, 'done');
    assert.equal(marks[0].getAttribute('aria-hidden'), 'true');
    assert.equal(marks[0].getAttribute('role'), null);
    assert.equal(marks[0].getAttribute('aria-label'), null);
  }
}

for (const view of ['progress', 'status'] as const) {
  for (const [name, s, marked] of [
    ['every task done, none skipped', summary(3), true],
    ['no remaining work but a skipped task', summary(3, 0, 1), false],
    ['mixed plan with remaining work', { ...summary(1, 2), working: 1, blocked: 1 }, false],
    ['zero tasks', summary(0), false],
  ] as const) {
    test(`${view} all-done: ${name}`, () => {
      assertCompletion(fixture()[view](s), marked);
    });
  }

  test(`${view} refresh: reopening a task removes completion from the next paint`, () => {
    const render = fixture()[view];
    const mount = new Node();
    mount.replaceChildren(render(summary(3)));
    assertCompletion(mount, true);
    const [previousCounts] = hooks(mount, 'counts');
    mount.replaceChildren(render(summary(2, 1)));
    assertCompletion(mount, false);
    assert.notEqual(hooks(mount, 'counts')[0], previousCounts, 'the next paint rebuilds counts');
  });
}

test('done progress line: decorative mark leaves the bar summary unchanged', () => {
  const render = fixture().progress;
  const s = summary(3);
  const marked = render(s);
  // The compact progress block renders the same summary without the caption mark.
  const unmarked = render(s, true);
  assert.equal(hooks(marked, 'status-mark').length, 1);
  assert.equal(hooks(unmarked, 'status-mark').length, 0);
  const [bar] = hooks(marked, 'progress-bar');
  const [plainBar] = hooks(unmarked, 'progress-bar');
  assert.ok(bar);
  assert.ok(plainBar);
  assert.equal(bar.getAttribute('role'), 'img');
  assert.equal(plainBar.getAttribute('role'), 'img');
  assert.equal(bar.getAttribute('aria-label'), summaryText(s));
  assert.equal(bar.getAttribute('aria-label'), plainBar.getAttribute('aria-label'));
  assert.equal(hooks(marked, 'status-mark')[0].getAttribute('aria-hidden'), 'true');
});
