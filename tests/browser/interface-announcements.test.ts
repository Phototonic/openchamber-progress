import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { failureCopy, FAILURE_COPY } from '../../ui/shared/components.ts';
import { resolveLanguage } from '../../ui/shared/i18n.ts';
import { narrowed } from '../../ui/shared/search.ts';
import { plural } from '../../ui/shared/format.ts';
import { readChangeDigest, readSearchWindow } from '../../ui/shared/source.ts';

function harness(file: string) {
  const frames: (() => void)[] = [], nodes: any[] = [];
  const el = (_tag: string, _class = '', text = ''): any => ({ textContent: text, dataset: {}, childElementCount: 0, isConnected: true, setAttribute() {}, append(...children: any[]) { nodes.push(...children); this.childElementCount += children.length; } });
  const exports: any = {};
  const js = ts.transpileModule(readFileSync(new URL(`../../ui/shared/${file}.ts`, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  runInNewContext(`${js}\n${file === 'change-digest-view' ? 'exports.unavailableText = unavailableText;' : ''}`, {
    exports, document: { body: { append: (node: any) => nodes.push(node) } }, requestAnimationFrame: (fn: () => void) => frames.push(fn),
    require: (path: string) => path === './components.ts' ? { el, testid: (node: any) => node, failureCopy, FAILURE_COPY, button() {} } : path === './i18n.ts' ? { resolveLanguage } : path === './search.ts' ? { narrowed } : path === './format.ts' ? { plural } : {},
  });
  return { exports, frames, nodes };
}

for (const [file, name] of [['search-view', 'announceSearch'], ['change-digest-view', 'announceDigest']]) {
  test(`${name}: held frames use latest language for the same outcome, without repeat writes`, () => {
    const h = harness(file), announce = h.exports[name];
    announce(1, 'English outcome');
    announce(1, 'Русский результат');
    h.frames.shift()!();
    assert.notEqual(h.nodes[0].textContent, 'English outcome', 'retired callback cannot write stale language');
    while (h.frames.length) h.frames.shift()!();
    const node = h.nodes[0];
    assert.equal(node.textContent, 'Русский результат');
    announce(1, 'English outcome');
    while (h.frames.length) h.frames.shift()!();
    assert.equal(node.textContent, 'English outcome');
    announce(1, 'English outcome');
    assert.equal(h.frames.length, 0);
    assert.equal(node.textContent, 'English outcome');
    announce(2, 'Old outcome'); announce(3, 'Последний результат');
    while (h.frames.length) h.frames.shift()!();
    assert.equal(node.textContent, 'Последний результат');
    assert.equal(h.nodes.length, 1);
  });
}

test('search and digest read warnings preserve distinct safe failure categories in both languages', async () => {
  const search = harness('search-view'), digest = harness('change-digest-view');
  for (const code of ['corrupt', 'schema']) {
    let reads = 0;
    const host = { serviceRequest: async () => { reads++; return { status: 503, body: JSON.stringify({ error: code, message: 'RAW_ERROR_MUST_NOT_APPEAR' }) }; } };
    const s = await readSearchWindow(host, { q: 'query', source: null, session: null, lifecycle: null, status: null, archived: 'exclude', limit: 50, cursor: null }, { storeId: 'store-example', binding: { sourceId: 'source-alpha', verified: true }, fingerprint: null });
    const d = await readChangeDigest(host, { storeId: 'store-example', source: 'source-alpha', plan: 'P-example', to: 2, after: 1, cleanupRev: 0 });
    assert.equal(s.ok, false); assert.equal(d.ok, false);
    if (s.ok || d.ok) throw new Error('Expected classified service failures');
    assert.equal(s.failure.kind, code === 'corrupt' ? 'damaged' : 'incompatible');
    for (const language of ['en', 'ru'] as const) {
      const text = digest.exports.unavailableText({ unavailable: { reason: 'read', failure: d.failure } }, language).text;
      assert.ok(text.includes(failureCopy(s.failure.kind, language).title));
      assert.ok(!text.includes('RAW_ERROR_MUST_NOT_APPEAR'));
    }
    assert.equal(reads, 2, 'translation performs no reads');
  }
  for (const language of ['en', 'ru'] as const) for (const kind of ['damaged', 'incompatible', 'busy', 'not-approved'] as const) {
    const failure = { kind, code: 'SERVICE', message: 'RAW_ERROR_MUST_NOT_APPEAR' };
    const warning = digest.exports.unavailableText({ unavailable: { reason: 'read', failure } }, language).text;
    assert.ok(warning.includes(failureCopy(kind, language).title));
    assert.ok(!warning.includes(failure.message));
    search.nodes.length = 0;
    search.exports.resultsBlock({ criteria: {}, phase: 'ready', stop: 'failed', failure, page: { hits: [], groups: [], number: 1, checked: true }, counts: { matchedPlans: 0, matchingTasks: 0 }, coverage: {}, status: {} }, { locale: language }, {});
    const text = search.nodes.map(n => n.textContent).join(' ');
    assert.ok(text.includes(failureCopy(kind, language).title));
    assert.ok(!text.includes(failure.message));
  }
});
