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
  const texts: string[] = [];
  const node = () => ({ dataset: {}, textContent: '', setAttribute() {}, append() {}, addEventListener() {} });
  const exports: any = {};
  runInNewContext(code, { exports, requestAnimationFrame() {}, require: (name: string) => ({
    './cleanup.ts': cleanup, './i18n.ts': { resolveLanguage },
    './components.ts': { el: (_tag: string, _cls?: string, text?: string) => { if (text !== undefined) texts.push(text); return node(); }, testid: (n: any, id: string) => { n.dataset.testid = id; return n; },
      button: (_parent: any, id: string, _text: string, run: () => void) => buttons.push({ id, run }) },
  } as Record<string, unknown>)[name] });
  return { render: exports.tidyPanel as (state: cleanup.TidyState, locale: string, controls: any) => void, buttons, texts };
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

for (const locale of ['en', 'ru', 'zh-CN']) test(`a permanent-delete confirmation keeps its subset qualification (${locale})`, () => {
  const p: cleanup.CleanupPlan = { key: 'fixture/p', sourceId: 'fixture', id: 'p', title: 'Sample', revision: 1, lifecycle: 'completed' };
  const t = cleanup.tidyCopy(locale), s = cleanup.selectionCopy(locale);
  const base = cleanup.tidyConfirmation([p], 'store', 'scope');
  const lines = (state: cleanup.TidyState) => { const h = panel(); h.render(state, locale, { delete() {}, cancel() {} }); return h.texts; };
  // Tidy: both a confirmed overflow and an unchecked remainder qualify the final step; a complete set does not.
  assert.ok(lines({ context: 'scope', confirmation: { ...base, deleting: true, limited: true } }).includes(t.limited(1, undefined)));
  assert.ok(lines({ context: 'scope', confirmation: { ...base, deleting: true, unchecked: true, matching: true } }).includes(t.unchecked(1, true)));
  assert.ok(!lines({ context: 'scope', confirmation: { ...base, deleting: true } }).some(x => x === t.limited(1, undefined) || x === t.unchecked(1, undefined)));
  // Selection: the same qualification from the selection wording.
  const chosen = cleanup.selectionConfirmation([p], 'store', 'scope', false, 'delete', true);
  assert.ok(lines({ context: 'scope', selection: 'delete', confirmation: { ...chosen, limited: true } }).includes(s.scope(1, true, undefined)));
  assert.ok(lines({ context: 'scope', selection: 'delete', confirmation: { ...chosen, unchecked: true } }).includes(s.scope(1, undefined, true)));
});

for (const locale of ['en', 'ru', 'zh-CN']) test(`a fully read but unverifiable count says plans may have been missed, with no Check more (${locale})`, () => {
  const p: cleanup.CleanupPlan = { key: 'fixture/p', sourceId: 'fixture', id: 'p', title: 'Sample', revision: 1, lifecycle: 'completed' };
  const t = cleanup.tidyCopy(locale);
  const base = cleanup.tidyConfirmation([p], 'store', 'scope');
  for (const deleting of [false, true]) {
    const h = panel(); h.render({ context: 'scope', confirmation: { ...base, unverified: true, deleting } }, locale, { delete() {}, cancel() {}, archive() {}, deleteStep() {}, more() {} });
    assert.ok(h.texts.includes(t.missed(1, false)), `${deleting ? 'final step' : 'count'} qualifies the count`);
    assert.ok(!h.texts.includes(t.unchecked(1, false)), 'it does not claim plans were left unchecked');
    assert.equal(h.buttons.some(b => b.id === 'tidy-check-more'), false);
  }
  assert.notEqual(t.missed(1, false), t.unchecked(1, false));
});
