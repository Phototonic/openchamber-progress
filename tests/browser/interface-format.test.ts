import { test } from 'node:test';
import assert from 'node:assert/strict';
import { absoluteTime, clockTime, elapsedText, formatCount, relativeAge } from '../../ui/shared/format.ts';

const NOW = Date.parse('2026-11-07T12:00:00.000Z');

test('Russian relative labels include recent and unknown times, not English fallbacks', () => {
  assert.equal(relativeAge(new Date(NOW).toISOString(), NOW, 'ru'), 'только что');
  assert.equal(relativeAge('invalid', NOW, 'ru'), 'в неизвестное время');
  assert.equal(relativeAge(new Date(NOW - 120_000).toISOString(), NOW, 'ru'), '2 минуты назад');
  assert.equal(relativeAge('invalid', NOW, 'invalid locale'), 'at an unknown time');
});

test('Russian elapsed values keep whole-minute calculations and choose day forms', () => {
  for (const n of [0, 1, 2, 5, 11, 21]) {
    assert.equal(elapsedText(n * 60_000, 'ru'), n ? `${n} мин` : '<1 мин');
  }
  for (const [days, form] of [[1, 'день'], [2, 'дня'], [5, 'дней'], [11, 'дней'], [21, 'день']] as const) {
    assert.equal(elapsedText(days * 86_400_000 + 3_600_000, 'ru'), `${days} ${form} 1 ч`);
  }
  assert.equal(elapsedText(3_900_000, 'ru'), '1 ч 5 мин');
  for (const bad of [-1, NaN, Infinity]) assert.equal(elapsedText(bad, 'ru'), null);
  assert.equal(elapsedText(3_900_000), '1 h 5 min');
});

test('displayed dates and numbers use the explicit locale without changing source values', () => {
  const iso = new Date(NOW).toISOString();
  assert.equal(absoluteTime(iso, 'ru'), new Intl.DateTimeFormat('ru', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(NOW)));
  assert.equal(clockTime(NOW, 'ru'), new Intl.DateTimeFormat('ru', { timeStyle: 'short' }).format(new Date(NOW)));
  assert.equal(formatCount(12_345, 'ru'), '12\u00a0345');
  assert.equal(formatCount(12_345, 'en'), '12,345');
  assert.equal(absoluteTime('invalid', 'ru'), 'invalid');
  assert.equal(iso, '2026-11-07T12:00:00.000Z');
});
