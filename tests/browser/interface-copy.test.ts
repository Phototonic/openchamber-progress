import { test } from 'node:test';
import assert from 'node:assert/strict';
import { internalCopy } from './interface-copy.ts';

test('rendered copy guard covers the three catalogs, but leaves agent text literal', () => {
  for (const text of ['Reported working', 'progress store', 'verified binding', 'Охват', 'источника', 'По отчёту', 'явно заблокировано', '采集', '报告为进行中', '修订']) {
    assert.ok(internalCopy(text).length, text);
  }
  const title = 'Review source bindings · 检查来源';
  assert.deepEqual(internalCopy(`In progress · ${title}`, [title]), []);
  assert.deepEqual(internalCopy(`In progress · ${title.replace(' · ', '\n· ')}`, [title]), []);
  for (const text of ['In progress · Blocked · Done', 'В работе · Заблокировано · Выполнено', '进行中 · 受阻 · 已完成',
    'Older updates are not shown.', 'Более ранние обновления не показаны.', '未显示较早的更新。']) assert.deepEqual(internalCopy(text), []);
});
