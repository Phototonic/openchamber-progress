import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { javascriptLiteral } from '../../shared/javascript-literal.ts';

test('search QA guest and wait programs treat frame names as data', async () => {
  // Exercise the actual templates without starting Chromium or fixture services.
  const source = readFileSync(new URL('./plan-task-search-qa.ts', import.meta.url), 'utf8');
  const guest = source.match(/const guest = .*evaluate<T>\((`[^\n]+`)\);/)?.[1];
  const wait = source.match(/const at = await evaluate<number \| null>\((`[^\n]+`)\);/)?.[1];
  assert.ok(guest); assert.ok(wait);
  const cases: Array<[string, string | number]> = [[guest, 'fixture-document'], [wait, 0]];
  for (const f of ['panel', `panel');globalThis.injected=true;//`, 'quote"\\\n\u2028</script>']) {
    for (const [template, expected] of cases) {
      const program = runInNewContext(template, { f, code: 'return d;', cond: 'true', ms: 100, javascriptLiteral });
      const context = {
        injected: false, performance: { now: () => 0 },
        frame: (name: string) => {
          assert.equal(name, f);
          return { contentWindow: { document: 'fixture-document' } };
        },
      };
      assert.equal(await runInNewContext(program, context), expected);
      assert.equal(context.injected, false);
    }
  }
});

test('selected plan selectors remain literal data after removing the row prefix', () => {
  const source = readFileSync(new URL('./plan-task-search-qa.ts', import.meta.url), 'utf8');
  const template = source.match(/await wait\('page', (`[^\n]+`), 'selected plan rendered'\)/)?.[1];
  assert.ok(template);
  for (const chosen of ['plan-row-fixture', `plan-row-');globalThis.injected=true;//`]) {
    const program = runInNewContext(template, { chosen, javascriptLiteral });
    const selectors: string[] = [];
    const context = { injected: false, d: { querySelector: (selector: string) => {
      selectors.push(selector);
      return { getAttribute: () => 'true' };
    } } };
    runInNewContext(program, context);
    assert.equal(context.injected, false);
    assert.deepEqual(selectors, [
      `[data-testid="${chosen}"]`,
      `[data-testid="plan-detail"] article[data-testid="plan-${chosen.replace('plan-row-', '')}"]`,
    ]);
  }
});
