import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { javascriptLiteral } from '../../shared/javascript-literal.ts';

test('JavaScript literals round-trip JSON data without HTML delimiters or line separators', () => {
  const hostile = '</ScRiPt><script>globalThis.injected=true</script><!-- " \' \\ \n\r\t\0\u2028\u2029 日本語';
  for (const value of [hostile, { [hostile]: [hostile, null, true, 42] }, null, false, 0]) {
    const literal = javascriptLiteral(value);
    assert.doesNotMatch(literal, /[<>\u2028\u2029]/);
    assert.deepEqual(JSON.parse(literal), value);
    const context = { injected: false, result: undefined };
    runInNewContext(`result = ${literal};`, context);
    assert.equal(context.injected, false);
    assert.deepEqual(JSON.parse(JSON.stringify(context.result)), value);
  }
});

test('values without a JSON representation fail rather than producing executable source', () => {
  for (const value of [undefined, () => {}, Symbol('fixture')]) {
    assert.throws(() => javascriptLiteral(value), TypeError);
  }
});
