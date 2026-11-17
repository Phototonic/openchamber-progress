import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as cleanup from '../../ui/shared/cleanup.ts';
import { resolveLanguage } from '../../ui/shared/i18n.ts';

const code = ts.transpileModule(readFileSync(new URL('../../ui/shared/cleanup-view.ts', import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function panel() {
  const buttons: { id: string; run: () => void }[] = [];
  const node = () => ({ dataset: {}, textContent: '', setAttribute() {}, append() {}, addEventListener() {} });
  const exports: any = {};
  runInNewContext(code, { exports, requestAnimationFrame() {}, require: (name: string) => ({
    './cleanup.ts': cleanup, './i18n.ts': { resolveLanguage },
    './components.ts': { el: node, testid: (n: any, id: string) => { n.dataset.testid = id; return n; },
      button: (_parent: any, id: string, _text: string, run: () => void) => buttons.push({ id, run }) },
  } as Record<string, unknown>)[name] });
  return { render: exports.tidyPanel as (state: cleanup.TidyState, locale: string, controls: any) => void, buttons };
}

test('a bounded selection Delete confirmation can Check more before its explicit final action', () => {
  const p: cleanup.CleanupPlan = { key: 'fixture/p', sourceId: 'fixture', id: 'p', title: 'Sample', revision: 1, lifecycle: 'active' };
  const confirmation = { ...cleanup.selectionConfirmation([p], 'store', 'scope', false, 'delete', true), unchecked: true };
  const h = panel(); let continued = false, deleted = false;
  h.render({ context: 'scope', selection: 'delete', confirmation }, 'en', {
    more: () => { continued = true; }, delete: () => { deleted = true; }, cancel() {},
  });
  assert.equal(deleted, false);
  h.buttons.find(b => b.id === 'tidy-check-more')!.run();
  assert.equal(continued, true); assert.equal(deleted, false);
  h.buttons.find(b => b.id === 'tidy-confirm-delete')!.run();
  assert.equal(deleted, true);
});

test('failed selection Restore opens a fresh panel, while receipt-bound Undo retries Undo', () => {
  for (const selection of ['restore', 'archive'] as const) {
    const h = panel(); let called = '';
    h.render({ context: 'scope', selection, result: { action: 'restore', attempted: 1, total: 1, succeeded: [], remaining: [] } }, 'en',
      { undo: () => { called = 'undo'; }, retry: () => { called = 'retry'; } });
    h.buttons.find(b => b.id === 'tidy-retry')!.run();
    assert.equal(called, selection === 'restore' ? 'retry' : 'undo');
  }
});
