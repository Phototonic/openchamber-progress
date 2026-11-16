import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as counts from '../../ui/shared/incomplete-counts.ts';
import * as i18n from '../../ui/shared/i18n.ts';
import { EARLIER_STEP } from '../../ui/shared/subagents.ts';

class Node {
  dataset: Record<string, string> = {};
  attrs: Record<string, string> = {};
  children: (Node | string)[] = [];
  parent: Node | null = null;
  handlers = new Map<string, () => void>();
  tag: string;
  className: string;
  constructor(tag = 'div', className = '', text = '') { this.tag = tag; this.className = className; if (text) this.children.push(text); }
  append(...children: (Node | string)[]) { this.children.push(...children); for (const n of children) if (n instanceof Node) n.parent = this; }
  setAttribute(key: string, value: string) { this.attrs[key] = value; }
  addEventListener(name: string, fn: () => void) { this.handlers.set(name, fn); }
  get textContent(): string { return this.children.map(n => typeof n === 'string' ? n : n.textContent).join(''); }
  set textContent(text: string) { this.children = [text]; }
  get childElementCount() { return this.children.filter(n => n instanceof Node).length; }
  contains(n: Node): boolean { return this === n || this.children.some(c => c instanceof Node && c.contains(n)); }
  matches(selector: string): boolean { return selector.split(',').some(s => s === 'main' ? this.tag === 'main' : s === '[data-count-scope]' ? this.dataset.countScope !== undefined : s === `[data-testid="${this.dataset.testid}"]`); }
  closest(selector: string): Node | null { return this.matches(selector) ? this : this.parent?.closest(selector) ?? null; }
  querySelector(selector: string): Node | null {
    for (const child of this.children) if (child instanceof Node) {
      if (child.matches(selector)) return child;
      const found = child.querySelector(selector); if (found) return found;
    }
    return null;
  }
  hook(id: string) { return this.querySelector(`[data-testid="${id}"]`); }
}
const components = {
  el: (tag: string, cls = '', text = '') => new Node(tag, cls, text),
  testid: (node: Node, id: string) => { node.dataset.testid = id; return node; },
};
function load(file: string, extra = '') {
  const exports: any = {};
  const imports: Record<string, unknown> = {
    './components.ts': components, './i18n.ts': i18n, './incomplete-counts.ts': counts,
    './subagents.ts': { EARLIER_STEP }, './format.ts': { absoluteTime: () => 'a known time' },
  };
  const code = ts.transpileModule(readFileSync(new URL(`../../ui/shared/${file}.ts`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  runInNewContext(code + extra, { exports, require: (name: string) => imports[name] ?? {},
    document: { body: new Node('body'), addEventListener() {} }, requestAnimationFrame() {} });
  return exports;
}

test('Retry targets the failed source, independently of normal Load more priority', () => {
  const { IncompleteCounts } = load('incomplete-counts-view');
  for (const failure of ['page', 'history', 'recovery', 'inbox']) {
    const calls: string[] = [];
    const root = new Node();
    const runs = {
      read: { readAt: 1000, capture: {}, recovery: { state: failure === 'recovery' ? 'failed' : 'partial', reason: 'budget' } },
      pageError: failure === 'page', historyRequestFailed: failure === 'history', hasMore: true,
      loadMore: () => calls.push('page'), retryHistory: () => calls.push('history'),
    };
    const inbox = { model: { moreFailed: failure === 'inbox', canContinue: true },
      more: () => calls.push('inbox-more'), retry: () => calls.push('inbox-retry') };
    new IncompleteCounts(() => {}).paint(root, {
      facts: { ...counts.emptyCountFacts(), reasons: ['history-not-loaded'] }, store: 'example', surface: 'panel',
      device: null, runs, inbox, locale: 'en', lastGoodAt: null, refresh: 1,
    });
    root.hook('incomplete-counts-retry')!.handlers.get('click')!();
    assert.deepEqual(calls, [failure === 'page' ? 'page' : failure === 'inbox' ? 'inbox-retry' : 'history'], failure);
  }
});

test('Work Status keeps a failed-page explanation beside its working pagination action', () => {
  const { recordsNode } = load('census-view', '\nexports.recordsNode = recordsNode;');
  let retries = 0;
  const roster = { earlier: [], earlierTotal: 1, canPage: true, recorded: true, notes: [], featured: [] };
  const runs = { pageError: true, continuation: true, showMore: () => retries++ };
  const status = recordsNode(roster, { surface: 'status', env: { locale: 'en' }, runs }, []);
  assert.match(status.textContent, /More rows couldn’t be read/, 'a failed page is not silent on the indicator-free surface');
  status.hook('subagent-more').handlers.get('click')();
  assert.equal(retries, 1);
  const panel = recordsNode(roster, { surface: 'panel', env: { locale: 'en' }, runs }, []);
  assert.doesNotMatch(panel.textContent, /More rows couldn’t be read/, 'rail uses its separate indicator retry line');
});

test('removed count controls capture scope from the painted main, not its mount', () => {
  const { coverageFocus, coverageLanding } = load('app', '\nexports.coverageFocus = coverageFocus; exports.coverageLanding = coverageLanding;');
  const mount = new Node(), main = new Node('main'), dismiss = new Node('button');
  main.dataset.countScope = 'same-reading'; dismiss.dataset.testid = 'incomplete-counts-dismiss';
  main.append(dismiss); mount.append(main);
  const from = coverageFocus(mount, dismiss);
  assert.equal(from?.scope, 'same-reading');
  const next = new Node('main'), menu = new Node('button');
  next.dataset.countScope = 'same-reading'; menu.dataset.testid = 'more-trigger'; next.append(menu);
  assert.equal(coverageLanding(next, from), menu);
  next.dataset.countScope = 'other-reading';
  assert.equal(coverageLanding(next, from), null);
  assert.equal(coverageFocus(mount, new Node('button')), null, 'external focus is never moved');
});
