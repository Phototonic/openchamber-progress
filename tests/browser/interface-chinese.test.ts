// 简体中文界面：语言解析、共享偏好、模型状态、时间格式与各视图固定文案。
// 只检查扩展自有文案；用户标题、会话名与机器字段不翻译。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { languageMessages, resolveLanguage } from '../../ui/shared/i18n.ts';
import { LanguageController, type LanguageStorageValue } from '../../ui/shared/language.ts';
import { documentStateText, lifecycleLabel, statusLabel, summaryText } from '../../ui/shared/model.ts';
import { elapsedText, formatCount, relativeAge } from '../../ui/shared/format.ts';
import { cleanupFeedback } from '../../ui/shared/cleanup.ts';
import { digestStatusText } from '../../ui/shared/change-digest.ts';
import { searchStatusText } from '../../ui/shared/search.ts';
import { managedCopy, managedErrorText } from '../../ui/shared/managed-copy.ts';
import { reportingCopyText } from '../../ui/shared/reporting-health.ts';
import { referenceText } from '../../ui/shared/change-digest-view.ts';
import type { DigestFacet } from '../../shared/change-digest.ts';

async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); }

test('Chinese host locales resolve to one Simplified Chinese catalog and explicit choices win', () => {
  for (const locale of ['zh', 'zh-CN', 'zh-Hans', 'zh-SG', 'zh-Hant-TW']) assert.equal(resolveLanguage('auto', locale), 'zh-CN');
  for (const locale of ['en', 'de-DE', 'ru-RU', '', 'zh_CN', 'not a tag']) assert.equal(resolveLanguage('auto', locale) === 'zh-CN', false);
  for (const locale of ['en', 'ru-RU', 'de-DE', 'invalid_locale']) assert.equal(resolveLanguage('zh-CN', locale), 'zh-CN');
  assert.equal(languageMessages('zh-CN').label, '语言');
  assert.equal(languageMessages('zh-CN').saved, '语言已保存。');
});

test('the shared device preference saves and reopens Simplified Chinese without a server write', async () => {
  let value: LanguageStorageValue | undefined;
  const writes: { key: string; value: LanguageStorageValue; scope: string }[] = [];
  const controller = new LanguageController({ storage: {
    get: async (key: string, options: { scope: 'device' }) => { assert.equal(key, 'interface-language.v1'); assert.equal(options.scope, 'device'); return value; },
    set: async (key: string, next: LanguageStorageValue, options: { scope: 'device' }) => { writes.push({ key, value: next, scope: options.scope }); value = next; },
  }, changed: () => {} });
  controller.ready('en', true); await settle();
  assert.equal(controller.snapshot().language, 'en');
  controller.choose('zh-CN'); await settle();
  assert.deepEqual(writes, [{ key: 'interface-language.v1', value: { v: 1, preference: 'zh-CN' }, scope: 'device' }]);
  assert.equal(controller.snapshot().language, 'zh-CN');
  // 宿主语言随后切换为英文时，显式选择仍然生效。
  controller.ready('en-US', true); await settle();
  assert.equal(controller.snapshot().language, 'zh-CN');
  controller.dispose();
  // 重新打开视图：新的控制器从设备存储读回已保存的中文选择。
  const reopened = new LanguageController({ storage: {
    get: async () => value,
    set: async () => { throw new Error('read-only'); },
  }, changed: () => {} });
  reopened.ready('en-US', true); await settle();
  assert.equal(reopened.snapshot().preference, 'zh-CN');
  assert.equal(reopened.snapshot().language, 'zh-CN');
  assert.equal(reopened.snapshot().readError, null);
  reopened.dispose();
});

test('task, lifecycle, document and count labels stay distinct in Chinese', () => {
  assert.equal(statusLabel('working', 'zh-CN'), '进行中');
  assert.equal(statusLabel('blocked', 'zh-CN'), '受阻');
  assert.equal(statusLabel('done', 'zh-CN'), '已完成');
  assert.equal(lifecycleLabel('completed', 'zh-CN'), '已结束');
  assert.equal(lifecycleLabel('cancelled', 'zh-CN'), '已取消');
  assert.match(documentStateText('moved', 'zh-CN'), /移动/);
  assert.equal(summaryText({ done: 2, total: 5, remaining: 3, skipped: 0 }, 'zh-CN'), '已完成 2 / 5 · 剩余 3');
  assert.equal(summaryText({ done: 0, total: 0, remaining: 0, skipped: 4 }, 'zh-CN'), '没有剩余可计数任务 · 已跳过 4');
});

test('dates, durations and counts use Chinese Intl output', () => {
  assert.equal(relativeAge('not-a-time', 0, 'zh-CN'), '时间未知');
  assert.equal(elapsedText(0, 'zh-CN'), '<1 分钟');
  assert.equal(elapsedText(125 * 60_000, 'zh-CN'), '2 小时 5 分钟');
  assert.equal(formatCount(1000, 'zh-CN'), '1,000');
});

test('cleanup, search, digest and health feedback are Chinese without changing meaning', () => {
  assert.match(cleanupFeedback({ kind: 'archive' }, 'zh-CN'), /已归档/);
  assert.match(cleanupFeedback({ kind: 'restore' }, 'zh-CN'), /已结束状态/);
  assert.match(cleanupFeedback({ kind: 'error', code: 'busy' }, 'zh-CN'), /存储正忙/);
  assert.match(searchStatusText({ kind: 'retired' }, 'zh-CN'), /失效/);
  assert.equal(searchStatusText({ kind: 'message', en: 'EN', ru: 'RU', 'zh-CN': '中文消息' }, 'zh-CN'), '中文消息');
  assert.match(searchStatusText({ kind: 'removed', count: 2 }, 'zh-CN'), /2 条结果/);
  assert.equal(digestStatusText({ kind: 'saving' }, 'zh-CN'), '正在保存审阅…');
  assert.match(digestStatusText({ kind: 'saved', revision: 3 }, 'zh-CN'), /修订 3/);
  assert.equal(reportingCopyText('copied', 'zh-CN'), '已复制。');
  assert.equal(managedCopy('zh-CN').title, '扩展受管采集');
  assert.match(managedErrorText('managed-migration-conflict', 'zh-CN')!, /冲突/);
  assert.equal(managedErrorText('unknown-code', 'zh-CN'), null);
});

test('Chinese never replaces English or Russian copy for the same fixed messages', () => {
  assert.equal(statusLabel('working', 'en'), 'In progress');
  assert.equal(lifecycleLabel('completed', 'ru'), 'Завершён');
  assert.equal(cleanupFeedback({ kind: 'archive' }, 'en'), 'Plan archived. Find it in Archived plans on the full page.');
  assert.equal(searchStatusText({ kind: 'retired' }, 'ru').startsWith('Планы изменились'), true);
});
test('recorded transitions state the fact, not an inferred resolution', () => {
  const facts = (status: 'blocked' | 'done' | 'skipped') => ({ title: '记录的任务', status, parentId: null, dependencies: [] });
  const reference = (facets: DigestFacet[], before: ReturnType<typeof facts>, after: ReturnType<typeof facts>) =>
    referenceText({ from: 1, to: 2, reportedAt: '2026-10-27T09:00:00.000Z', facets, before, after }, 'zh-CN');
  const unblocked = reference(['unblocked', 'skipped'], facts('blocked'), facts('skipped'));
  assert.match(unblocked, /不再报告为受阻/);
  assert.doesNotMatch(unblocked, /解除/);
  const reopened = reference(['reopened', 'skipped'], facts('done'), facts('skipped'));
  assert.match(reopened, /不再标记为已完成/);
  assert.doesNotMatch(reopened, /重新打开/);
  assert.match(reference(['blocked'], facts('skipped'), facts('blocked')), /报告为受阻/);
});
