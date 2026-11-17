import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as counts from '../../ui/shared/incomplete-counts.ts';
import * as i18n from '../../ui/shared/i18n.ts';
import { EARLIER_STEP } from '../../ui/shared/subagents.ts';
import { DeviceViewState } from '../../ui/shared/device-view-state.ts';
import type { LanguageStorageValue } from '../../ui/shared/language.ts';

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
  assert.match(status.textContent, /Couldn’t load more sub-agents; try again/, 'a failed page is not silent on the indicator-free surface');
  status.hook('subagent-more').handlers.get('click')();
  assert.equal(retries, 1);
  const panel = recordsNode(roster, { surface: 'panel', env: { locale: 'en' }, runs }, []);
  assert.doesNotMatch(panel.textContent, /Couldn’t load more sub-agents; try again/, 'rail uses its separate indicator retry line');
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

test('dismissal survives reload without removing access to the remaining inbox window', async () => {
  const { IncompleteCounts } = load('incomplete-counts-view');
  let stored: LanguageStorageValue | undefined, loaded = false;
  const storage = { get: async () => stored, set: async (_key: string, value: LanguageStorageValue) => { stored = value; } };
  const device = new DeviceViewState(storage, () => {}); await device.refresh(true);
  const facts = { ...counts.emptyCountFacts(), reasons: ['plans-not-checked'] };
  const options = { facts, store: 'example', surface: 'panel', device, runs: null, locale: 'en', lastGoodAt: null, refresh: 1,
    inbox: { model: { canContinue: true }, more: () => { loaded = true; } } };
  const view = new IncompleteCounts(() => {}), root = new Node();
  view.paint(root, options);
  root.hook('incomplete-counts-dismiss')!.handlers.get('click')!();
  for (let i = 0; i < 8; i++) await new Promise<void>(resolve => setImmediate(resolve));
  const reloadedDevice = new DeviceViewState(storage, () => {}); await reloadedDevice.refresh(true);
  const identity = counts.countReasonIdentity('example', facts as counts.CountFacts);
  assert(reloadedDevice.dismissed('panel', identity));
  const reloaded = new IncompleteCounts(() => {}), after = new Node();
  reloaded.paint(after, { ...options, device: reloadedDevice });
  assert.equal(after.hook('incomplete-counts'), null, 'the note stays dismissed');
  assert(after.hook('incomplete-counts-reopen'), 'a quiet keyboard-focusable disclosure still reaches continuation');
  after.hook('incomplete-counts-reopen')!.handlers.get('click')!();
  assert.equal(loaded, false, 'reopening the disclosure does not read a window');
  const expanded = new Node(); reloaded.paint(expanded, { ...options, device: reloadedDevice });
  assert.equal(expanded.hook('incomplete-counts-toggle')!.attrs['aria-expanded'], 'true');
  expanded.hook('incomplete-counts-more')!.handlers.get('click')!();
  assert(loaded);
  assert(reloadedDevice.dismissed('panel', identity), 'explicit reopening does not erase the saved dismissal');
});
