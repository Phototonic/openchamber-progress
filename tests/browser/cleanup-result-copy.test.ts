import test from 'node:test';
import assert from 'node:assert/strict';
import { tidyCopy } from '../../ui/shared/cleanup.ts';

/** Skipped only, unconfirmed only, both, and nothing refused: what the run result line says, per language and action. */
type Row = [n: number, total: number, unconfirmed: number | undefined, text: string];
const rows: Record<string, Record<'archive' | 'restore' | 'delete', Row[]>> = {
  en: {
    archive: [
      [128, 128, undefined, '128 plans archived.'],
      [126, 128, undefined, '126 of 128 plans archived; 2 skipped.'],
      [126, 128, 0, '126 of 128 plans archived; 2 skipped.'],
      [126, 128, 2, '126 of 128 plans archived; 2 could not be confirmed and may have been archived.'],
      [127, 128, 1, '127 of 128 plans archived; 1 could not be confirmed and may have been archived.'],
      [125, 128, 2, '125 of 128 plans archived; 1 skipped; 2 could not be confirmed and may have been archived.'],
    ],
    restore: [
      [3, 4, 1, '3 of 4 plans restored; 1 could not be confirmed and may have been restored.'],
      [1, 4, 2, '1 of 4 plans restored; 1 skipped; 2 could not be confirmed and may have been restored.'],
      [2, 4, undefined, '2 of 4 plans restored; 2 skipped.'],
    ],
    delete: [
      [3, 4, 1, '3 of 4 plans deleted; 1 could not be confirmed and may have been deleted.'],
      [0, 4, 3, '0 of 4 plans deleted; 1 skipped; 3 could not be confirmed and may have been deleted.'],
    ],
  },
  ru: {
    archive: [
      [128, 128, undefined, 'Архивировано 128 из 128.'],
      [126, 128, undefined, 'Архивировано 126 из 128; пропущено: 2.'],
      [126, 128, 2, 'Архивировано 126 из 128; 2 плана не удалось подтвердить: возможно, они архивированы.'],
      [127, 128, 1, 'Архивировано 127 из 128; 1 план не удалось подтвердить: возможно, он архивирован.'],
      [120, 128, 5, 'Архивировано 120 из 128; пропущено: 3; 5 планов не удалось подтвердить: возможно, они архивированы.'],
      [100, 128, 21, 'Архивировано 100 из 128; пропущено: 7; 21 план не удалось подтвердить: возможно, они архивированы.'],
      [100, 128, 11, 'Архивировано 100 из 128; пропущено: 17; 11 планов не удалось подтвердить: возможно, они архивированы.'],
    ],
    restore: [
      [3, 4, 1, 'Восстановлено 3 из 4; 1 план не удалось подтвердить: возможно, он восстановлен.'],
      [1, 4, 2, 'Восстановлено 1 из 4; пропущено: 1; 2 плана не удалось подтвердить: возможно, они восстановлены.'],
      [0, 31, 31, 'Восстановлено 0 из 31; 31 план не удалось подтвердить: возможно, они восстановлены.'],
    ],
    delete: [
      [3, 4, 1, 'Удалено 3 из 4; 1 план не удалось подтвердить: возможно, он удалён.'],
      [0, 131, 101, 'Удалено 0 из 131; пропущено: 30; 101 план не удалось подтвердить: возможно, они удалены.'],
      [0, 26, 21, 'Удалено 0 из 26; пропущено: 5; 21 план не удалось подтвердить: возможно, они удалены.'],
      [0, 14, 11, 'Удалено 0 из 14; пропущено: 3; 11 планов не удалось подтвердить: возможно, они удалены.'],
    ],
  },
  'zh-CN': {
    archive: [
      [128, 128, undefined, '已归档 128 / 128 个计划。'],
      [126, 128, undefined, '已归档 126 / 128 个计划；跳过 2 个。'],
      [126, 128, 2, '已归档 126 / 128 个计划；2 个无法确认，可能已归档。'],
      [125, 128, 2, '已归档 125 / 128 个计划；跳过 1 个；2 个无法确认，可能已归档。'],
    ],
    restore: [
      [3, 4, 1, '已恢复 3 / 4 个计划；1 个无法确认，可能已恢复。'],
      [1, 4, 2, '已恢复 1 / 4 个计划；跳过 1 个；2 个无法确认，可能已恢复。'],
    ],
    delete: [
      [3, 4, 1, '已删除 3 / 4 个计划；1 个无法确认，可能已删除。'],
    ],
  },
};

for (const [locale, actions] of Object.entries(rows)) for (const [action, list] of Object.entries(actions) as [keyof typeof actions, Row[]][]) {
  test(`result line: ${action} in ${locale} says skipped and unconfirmed plans apart, in one sentence`, () => {
    const t = tidyCopy(locale);
    for (const [n, total, unconfirmed, text] of list) {
      assert.equal(t.result(n, total, action, unconfirmed), text);
      assert.equal(text.match(/[.。]/g)?.length, 1, 'one sentence, so one announcement');
    }
  });
}

test('result line: the three-argument call and the restore flag keep their meaning', () => {
  const t = tidyCopy('en');
  assert.equal(t.result(4, 4, false), '4 plans archived.');
  assert.equal(t.result(3, 4, true), '3 of 4 plans restored; 1 skipped.');
  assert.equal(t.result(3, 4, true, 1), '3 of 4 plans restored; 1 could not be confirmed and may have been restored.');
  assert.match(t.result(0, 4, false), /0 of 4.*4 skipped/);
  // Stop leaves plans unsent: they read as skipped, which the rendered driver waits for.
  assert.match(t.result(2, 4, 'archive', 0), /skipped/);
});

test('result line: a count that cannot add up never reports a negative skipped count', () => {
  for (const locale of ['en', 'ru', 'zh-CN']) assert.doesNotMatch(tidyCopy(locale).result(1, 2, 'archive', 5), /-\d/);
});
