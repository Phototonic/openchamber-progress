import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as format from '../../ui/shared/format.ts';
import * as search from '../../ui/shared/search.ts';
import { resolveLanguage } from '../../ui/shared/i18n.ts';

function harness() {
  const nodes: any[] = [];
  const el = (_tag: string, _class = '', text = ''): any => ({ textContent: text, dataset: {}, append(...children: any[]) { nodes.push(...children); }, setAttribute() {} });
  const exports: any = {};
  const js = ts.transpileModule(readFileSync(new URL('../../ui/shared/search-view.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  runInNewContext(`${js}\nObject.assign(exports, { hitMeta });`, { exports, require: (path: string) => path === './components.ts' ? { el, testid: (n: any) => n, planLocation: () => 'Location' } : path === './format.ts' ? format : path === './search.ts' ? search : path === './i18n.ts' ? { resolveLanguage } : {} });
  return { exports, nodes, text: () => nodes.map(n => n.textContent).join(' ') };
}

test('search outcomes localize quantities without rewriting literal messages', () => {
  const message = { kind: 'outcome', matchedPlans: 1000, matchingTasks: 2030, exhausted: true, shown: 50 } as const;
  assert.equal(search.searchStatusText(message, 'ru'), 'Найдено планов: 1\u00a0000, подходящих задач: 2\u00a0030.');
  assert.equal(search.searchStatusText(message, 'en'), 'Found 1000 plans, 2030 matching tasks.');
  assert.match(search.searchStatusText({ kind: 'removed', count: 1000 }, 'ru'), /1\u00a0000/);
  assert.match(search.searchStatusText({ ...message, exhausted: false }, 'ru'), /1\u00a0000.*2\u00a0030/);
  assert.equal(search.searchStatusText({ kind: 'message', en: 'literal 1000', ru: 'буквально 1000' }, 'ru'), 'буквально 1000');
});

test('search counts, coverage and whole-plan quantities localize only presentation', () => {
  const h = harness();
  const v = { exhausted: true, countsCurrent: true, counts: { matchedPlans: 1000, matchingTasks: 2030 }, coverage: { gapped: true, skippedRecords: 1000 }, page: { hits: Array(1000), number: 1000, contextRows: 1000, checked: true }, criteria: {}, removed: 1000, changedKeys: 1000 };
  const before = JSON.stringify(v);
  for (const [language, n] of [['ru', '1\u00a0000'], ['en', '1000']]) {
    h.nodes.length = 0;
    const box = h.exports.countsBlock(v, language);
    h.exports.coverageBlock(v, language);
    assert.ok(h.text().includes(language === 'ru' ? `планов: ${n}, подходящих задач: 2\u00a0030` : '1000 plans, 2030 matching tasks'));
    assert.doesNotMatch(h.text(), /страница|для контекста|on page|parent row/);
    assert.ok(h.text().includes(language === 'ru' ? 'Поиск может быть неполным.' : 'Some search results may be missing.'));
    assert.doesNotMatch(h.text(), /пока:|so far|skipped records|Планов изменилось|results were removed/);
    assert.equal(box.dataset.matchedPlans, '1000');
    assert.equal(box.dataset.matchingTasks, '2030');
    assert.equal(box.dataset.context, '1000');
    const meta = h.exports.hitMeta({ id: 'P1000', sourceId: 'S1000', sourceVerified: true, lifecycle: 'active', counts: { done: 1000, total: 2030 } }, { locale: language, boundSource: null });
    assert.ok(meta.includes(language === 'ru' ? `${n}/2\u00a0030` : '1000/2030'));
    assert.ok(meta.includes('P1000'));
    assert.ok(meta.includes('S1000'));
  }
  assert.equal(JSON.stringify(v), before);
});

test('complete search has one count sentence and no completeness notice in every language', () => {
  const h = harness();
  const v: any = { exhausted: true, countsCurrent: true, counts: { matchedPlans: 1, matchingTasks: 1 },
    coverage: { gapped: false }, page: { hits: [{}], number: 1, contextRows: 1, checked: true },
    criteria: { project: 'all', worktree: 'all', session: 'all' }, removed: 0, changedKeys: 0 };
  for (const [language, expected] of [
    ['en', 'Found 1 plan, 1 matching task.'],
    ['ru', 'Найдено планов: 1, подходящих задач: 1.'],
    ['zh-CN', '找到 1 个计划和 1 个匹配任务。'],
  ]) {
    h.nodes.length = 0;
    h.exports.countsBlock(v, language);
    const coverage = h.exports.coverageBlock(v, language);
    assert.equal(h.text(), expected);
    assert.equal(coverage.hidden, true);
    assert.equal(h.exports.qualificationText(v, language), '');
    assert.equal(h.exports.resultText(v, language), search.searchStatusText({
      kind: 'outcome', matchedPlans: 1, matchingTasks: 1, exhausted: true, shown: 1,
    }, language as any));
    for (const patch of [{ exhausted: false }, { coverage: { gapped: true } },
      { discoveryIncomplete: true, criteria: { project: 'Alpha', worktree: 'all', session: 'all' } }]) {
      assert.ok(h.exports.qualificationText({ ...v, ...patch }, language), `${language}: incomplete results stay qualified`);
    }
  }
});
