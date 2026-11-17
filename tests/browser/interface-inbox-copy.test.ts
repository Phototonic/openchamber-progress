import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inboxCopy, compactInboxCopy } from '../../ui/shared/inbox-view.ts';
import { tidyCopy } from '../../ui/shared/cleanup.ts';
import { internalCopy } from './interface-copy.ts';

test('Needs you labels and uncertain counts follow the guide in all three languages', () => {
  for (const [locale, why, ask] of [
    ['en', 'Why', 'Asks you to'], ['ru', 'Почему', 'Что нужно сделать'], ['zh-CN', '原因', '需要你做的事'],
  ]) {
    const c = inboxCopy(locale);
    assert.equal(c.reason, why);
    assert.equal(c.next, ask);
    assert.notEqual(c.nextOther, ask, 'a generic blocker must not imply a request to the user');
    for (const n of [1, 2, 5, 1000]) {
      assert.match(c.atLeastTasks(n), /\+/);
      assert.deepEqual(internalCopy(c.atLeastTasks(n)), []);
      assert.deepEqual(internalCopy(c.also(n, false)), []);
    }
    assert.ok(compactInboxCopy(locale).copied.length > 0);
  }
  assert.match(compactInboxCopy('en').copied, /paste.*edit and send/i);
});

test('Tidy names the confirmed count and does not repeat totals after complete success', () => {
  const en = tidyCopy('en');
  assert.equal(en.heading(4), '4 closed plans here.');
  assert.equal(en.confirm(4), 'Archive 4 plans');
  assert.equal(en.result(4, 4, false), '4 plans archived.');
  assert.match(en.result(0, 4, false), /0 of 4.*4 skipped/);
  assert.equal(tidyCopy('ru').heading(1), 'Здесь 1 закрытый план.');
  assert.equal(tidyCopy('ru').heading(2), 'Здесь 2 закрытых плана.');
  assert.equal(tidyCopy('ru').heading(5), 'Здесь 5 закрытых планов.');
  assert.equal(tidyCopy('zh-CN').confirm(4), '归档 4 个计划');
});
