import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as i18n from '../../ui/shared/i18n.ts';
import * as format from '../../ui/shared/format.ts';
import * as model from '../../ui/shared/model.ts';

class Element {
  dataset: Record<string, string> = {};
  attributes: Record<string, string> = {};
  children: (Element | string)[] = [];
  writes: string[] = [];
  isConnected = false;
  className = '';
  append(...nodes: (Element | string)[]) {
    this.children.push(...nodes);
    for (const node of nodes) if (node instanceof Element) node.isConnected = this.isConnected;
  }
  setAttribute(key: string, value: string) { this.attributes[key] = value; }
  get textContent(): string { return this.children.map(n => typeof n === 'string' ? n : n.textContent).join(''); }
  set textContent(text: string) { this.writes.push(text); this.children = [text]; }
}

function fixture() {
  const body = new Element(); body.isConnected = true;
  const frames: (() => void)[] = [];
  const load = (file: string, imports: Record<string, unknown>, extra = '') => {
    const exports: Record<string, any> = {};
    const code = ts.transpileModule(readFileSync(new URL(`../../ui/shared/${file}.ts`, import.meta.url), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    runInNewContext(code + extra, { exports, require: (name: string) => imports[name] ?? {},
      document: { body, createElement: () => new Element() }, requestAnimationFrame: (run: () => void) => frames.push(run) });
    return exports;
  };
  const components = load('components', { './i18n.ts': i18n, './format.ts': format, './model.ts': model });
  const census = load('census-view', { './components.ts': components, './i18n.ts': i18n }, '\nexports.announceLoss = announceLoss;');
  return { body, frames, components, announce: census.announceLoss,
    flush: () => { for (const run of frames.splice(0)) run(); } };
}

const englishError = 'Couldn’t dismiss the warning. Try again.';
const russianError = 'Не удалось скрыть предупреждение. Попробуйте снова.';

test('same dismissal token translates the existing live region without repeating identical paints', () => {
  const f = fixture();
  const runs = { lossDismissal: 'error', lossDismissalFailure: {}, dismissLoss() { assert.fail('translation must not dismiss'); } };
  f.announce(runs, true, 'en'); f.flush();
  const node = f.body.children[0] as Element;
  assert.equal(node.textContent, englishError);
  assert.equal(node.attributes['aria-live'], 'polite');
  f.announce(runs, true, 'ru'); f.flush();
  assert.equal(node.textContent, russianError);
  assert.equal(f.body.children.length, 1, 'one persistent region');
  const writes = node.writes.length;
  f.announce(runs, true, 'ru');
  assert.equal(f.frames.length, 0);
  assert.equal(node.writes.length, writes, 'identical paint does not announce again');
});

test('separate failed attempts repeat even when their rendered text is identical', () => {
  const f = fixture();
  const runs = { lossDismissal: 'error', lossDismissalFailure: {} };
  f.announce(runs, true, 'ru'); f.flush();
  const node = f.body.children[0] as Element;
  const writes = node.writes.length;
  runs.lossDismissalFailure = {};
  f.announce(runs, true, 'ru');
  assert.equal(node.textContent, '');
  f.flush();
  assert.deepEqual(node.writes.slice(writes), ['', russianError]);
});

test('reverse RAF delivery cannot restore the previous language for the same outcome token', () => {
  const f = fixture();
  const runs = { lossDismissal: 'error', lossDismissalFailure: {} };
  f.announce(runs, true, 'en');
  f.announce(runs, true, 'ru');
  assert.equal(f.frames.length, 2, 'both language paints schedule their message');
  for (const run of f.frames.splice(0).reverse()) run();
  assert.equal((f.body.children[0] as Element).textContent, russianError);
});

test('an idle outcome retires an already queued failure announcement', () => {
  const f = fixture();
  f.announce({ lossDismissal: 'error', lossDismissalFailure: {} }, true, 'en');
  f.announce({ lossDismissal: 'idle' }, true, 'ru');
  f.flush();
  assert.equal((f.body.children[0] as Element).textContent, '');
});

test('renewed attention retires queued success and a later quiet outcome uses the current language', () => {
  const f = fixture();
  const runs = { lossDismissal: 'success' };
  f.announce(runs, false, 'en');
  f.announce(runs, true, 'en');
  f.flush();
  const node = f.body.children[0] as Element;
  assert.equal(node.textContent, '');
  f.announce(runs, false, 'ru'); f.flush();
  assert.equal(node.textContent, 'Предупреждение скрыто.');
  const writes = node.writes.length;
  f.announce(runs, false, 'ru');
  assert.equal(f.frames.length, 0);
  assert.equal(node.writes.length, writes);
});

test('actual History and Details keep revision IDs raw while real counts retain Russian grouping', () => {
  const { components: c } = fixture();
  const plan = { id: 'plan', revision: 1000, structuralRevision: 11000, reportedAt: '2026-01-01T00:00:00Z',
    ownerSessionId: 'session', sourceId: 'source', document: { state: 'missing' } };
  const entries = Array.from({ length: 1000 }, (_, i) => ({ revision: 1000 + i, structuralRevision: 11000,
    lifecycle: 'active', reportedAt: plan.reportedAt }));
  for (const locale of ['en', 'ru']) {
    const env = { locale, now: Date.parse(plan.reportedAt) };
    const history = c.historyBlock(plan, { state: 'ready', value: { entries, truncated: true } }, env);
    const rows = history.children[1].children;
    assert.equal(rows[0].children[0].textContent, locale === 'ru' ? 'Ревизия 1999' : 'Revision 1999');
    assert.equal(rows.at(-1).children[0].textContent, locale === 'ru' ? 'Ревизия 1000' : 'Revision 1000');
    assert.equal(history.children[2].textContent, locale === 'ru'
      ? 'Показаны только первые 1\u00a0000 ревизий.' : 'Only the first 1000 revisions are shown.');
    const details = c.detailsBlock(null, plan, [], env);
    assert.equal(details.children[1].children[3].textContent, locale === 'ru'
      ? '1000 (структура 11000)' : '1000 (structure 11000)');
  }
  assert.equal(plan.revision, 1000);
  assert.equal(plan.structuralRevision, 11000);
  assert.equal(entries[0].revision, 1000);
});
