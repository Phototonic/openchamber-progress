import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as format from '../../ui/shared/format.ts';
import * as model from '../../ui/shared/model.ts';
import { resolveLanguage } from '../../ui/shared/i18n.ts';

// Execute the production renderer without loading SDK widgets or a browser.
function harness() {
  const nodes: any[] = [];
  const el = (tag: string, className = '', text = ''): any => {
    const node = {
      tag, className, dataset: {}, style: {}, childNodes: [] as any[], textContent: text,
      append(...children: any[]) { this.childNodes.push(...children); },
      replaceChildren(...children: any[]) { this.childNodes = children; },
      setAttribute() {}, addEventListener() {}, querySelector: () => null,
      isConnected: true,
    };
    nodes.push(node);
    return node;
  };
  const document = { head: { querySelector: () => ({}) } };
  const exports: any = {};
  const js = ts.transpileModule(readFileSync(new URL('../../ui/shared/dependency-map-view.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  runInNewContext(`${js}\nexports.mapCount = mapCount;`, {
    exports, document, queueMicrotask: () => {},
    require: (path: string) => {
      if (path === './format.ts') return format;
      if (path === './model.ts') return model;
      if (path === './i18n.ts') return { resolveLanguage };
      if (path === './components.ts') return {
        el, testid: (node: any, id: string) => { node.dataset.testid = id; return node; },
        lifecycleBadge: () => el('span'), button: (parent: any) => { const node = el('span'); parent.append(node); return node; },
      };
      return {};
    },
  });
  return { exports, nodes, host: Object.assign(el('main'), { ownerDocument: document }) };
}

for (const language of ['ru', 'en'] as const)
  for (const [n, kind, ru, en] of [[1000, 'task', 'задач', 'tasks'], [11000, 'arrow', 'стрелок', 'arrows']] as const)
    test(`${language}: actual map count formats ${n} ${kind} without changing English`, () => {
      const { exports } = harness();
      const number = language === 'ru' ? new Intl.NumberFormat('ru').format(n) : String(n);
      assert.equal(exports.mapCount(n, kind, language), `${number} ${language === 'ru' ? ru : en}`);
    });

for (const language of ['ru', 'en'] as const) for (const status of ['working', 'pending', 'blocked'] as const)
  test(`${language}: rendered ${status} stat localizes 1000 while data-count and revision stay raw`, () => {
    const { exports, nodes, host } = harness();
    const items = Array.from({ length: 1000 }, (_, n) => ({ id: `task-${n}`, title: `Task ${n}`, kind: 'task', status, dependencies: [] }));
    const tasks = new Map(items.map(item => [item.id, { group: status === 'pending' ? 'ready' : status, unlocksNext: [] }]));
    const plan = { key: 'plan', title: 'Recorded title', lifecycle: 'active', counts: { total: 1000, [status]: 1000 } };
    exports.createDependencyMapView().render(host, {
      language, state: 'ready', current: true, frame: 'board', layout: null, facts: { tasks },
      picture: { detail: { plan, detail: { items } }, graph: { revision: 11000 } },
      status: 'all', group: null, selected: null,
    });
    const stat = nodes.find(node => node.dataset.kind === (status === 'pending' ? 'ready' : status));
    assert.equal(stat.dataset.count, '1000');
    assert.equal(stat.childNodes.find((node: any) => node?.tag === 'strong').textContent,
      language === 'ru' ? '1\u00a0000' : '1000');
    assert.equal(nodes.find(node => node.dataset.testid === 'map-region').dataset.revision, '11000');
    const hidden = nodes.find(node => node.dataset.testid === 'map-hidden');
    assert.equal(hidden.textContent, language === 'ru' ? 'Показаны все: 1\u00a0000 задач' : 'Showing all 1000 tasks');
  });
