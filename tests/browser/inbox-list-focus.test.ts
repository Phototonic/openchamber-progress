// Exercise the real List reveal callbacks with a filtered reading and replaced paints.
// The compact shell exposes only All/Unfinished; other task-filter states are seeded here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

function moduleAt(name: string, dependencies: Record<string, unknown>, fixture = '') {
  const exports: Record<string, any> = {};
  const code = readFileSync(new URL(`../../ui/shared/${name}.ts`, import.meta.url), 'utf8') + fixture;
  runInNewContext(ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports, require: (id: string) => dependencies[id] ?? {},
  });
  return exports;
}

test('inbox focus is restored after a filtered List reveal finishes its deferred repaint', () => {
  const components = moduleAt('components', { './i18n.ts': { resolveLanguage: () => 'en' } },
    '\nexport const fixtureReadings = READINGS;');
  const inbox = moduleAt('inbox-view', { './components.ts': components });
  const plan = { key: 'source-example/plan-example', id: 'plan-example', sourceId: 'source-example', revision: 1 };
  const row = { planKey: plan.key, plan: plan.id, rowKey: 'row-example', task: { id: 'task-example' } };
  const pending: { patch: Record<string, unknown>; then?: (root: any) => void }[] = [];
  let filtered = true, reveals = 0;
  let current: ReturnType<typeof paint>;
  const document = { activeElement: null as any, querySelectorAll: (selector: string) => current.root.querySelectorAll(selector) };
  const reading = { set: (patch: Record<string, unknown>, then?: (root: any) => void) => pending.push({ patch, then }) };
  function paint() {
    const opener = { focus() { document.activeElement = opener; } };
    const notice = { textContent: '' };
    const target = {
      tagName: 'LI', dataset: { testid: 'item-task-example', navTarget: '' },
      closest: () => filtered ? {} : null,
      parentElement: { closest: () => null },
      addEventListener() {}, focus() { document.activeElement = target; },
      scrollIntoView() { reveals++; },
    };
    const article = {
      isConnected: true, ownerDocument: document,
      dataset: { testid: 'plan-plan-example', source: plan.sourceId, revision: '1', locale: 'en' },
      closest: () => article, contains: () => true,
      querySelectorAll: () => [target], querySelector: () => notice,
    };
    const inboxRow = { dataset: { row: row.rowKey }, querySelector: () => opener };
    const root = { querySelectorAll: (selector: string) => selector === 'article.ap-plan' ? [article] : [inboxRow] };
    components.fixtureReadings.set(article, reading);
    return { root, opener, target, notice };
  }
  current = paint();
  inbox.revealInboxTask(reading, plan, row);
  let paints = 0;
  while (pending.length) {
    assert.ok(++paints <= 2, 'one initial reveal and at most one filter-clearing repaint');
    const { patch, then } = pending.shift()!;
    if (patch.status === 'all') filtered = false;
    current = paint();
    then?.(current.root);
  }
  assert.equal(filtered, false, 'the deferred canonical reveal cleared the hiding filters');
  assert.equal(reveals, 1, 'the canonical task was revealed');
  assert.equal(current.notice.textContent, 'Showing all tasks so this task is visible.');
  assert.equal(document.activeElement, current.opener, 'the final reveal must not leave focus on the task row');
});
