import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { summaryText, type PlanSummary } from '../../ui/shared/model.ts';

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
    if (name === './model.ts') return { summaryText };
    return {};
  });
  return components.progressBlock as (s: PlanSummary, compact?: boolean) => Node;
}

const summary = (done: number, remaining = 0, skipped = 0): PlanSummary => ({
  done, total: done + remaining, remaining, skipped, working: 0, blocked: 0,
  percent: done + remaining ? Math.round(done / (done + remaining) * 100) : null,
});
const hooks = (root: Node, id: string) => [...root.descendants()].filter((n) => n.dataset.testid === id);

for (const [name, s, marked] of [
  ['every task done, none skipped', summary(3), true],
  ['no remaining work but a skipped task', summary(3, 0, 1), false],
  ['mixed plan with remaining work', { ...summary(1, 2), working: 1, blocked: 1 }, false],
  ['zero tasks', summary(0), false],
] as const) {
  test(`progress line all-done: ${name}`, () => {
    const root = fixture()(s);
    const [counts] = hooks(root, 'counts');
    assert.ok(counts);
    assert.equal(counts.dataset.allDone, marked ? 'true' : undefined);
    const marks = hooks(counts, 'status-mark');
    assert.equal(marks.length, marked ? 1 : 0);
    if (marked) {
      assert.equal(marks[0].dataset.status, 'done');
      assert.equal(marks[0].getAttribute('aria-hidden'), 'true');
      assert.equal(marks[0].getAttribute('role'), null);
      assert.equal(marks[0].getAttribute('aria-label'), null);
    }
  });
}

test('done progress line: decorative mark leaves the bar summary unchanged', () => {
  const render = fixture();
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
