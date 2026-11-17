// Simplified Chinese: language resolution, shared preference, model labels and fixed UI copy.
// Only extension-owned text is translated; user titles, session names and machine fields stay literal.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { languageMessages, resolveLanguage } from '../../ui/shared/i18n.ts';
import { LanguageController, type LanguageStorageValue } from '../../ui/shared/language.ts';
import { documentStateText, lifecycleLabel, statusLabel, summaryText } from '../../ui/shared/model.ts';
import { elapsedText, formatCount, relativeAge } from '../../ui/shared/format.ts';
import { cleanupFeedback } from '../../ui/shared/cleanup.ts';
import { digestStatusText } from '../../ui/shared/change-digest.ts';
import { searchStatusText } from '../../ui/shared/search.ts';
import { managedCopy, managedErrorText, managedStepCopy } from '../../ui/shared/managed-copy.ts';
import { inboxCopy } from '../../ui/shared/inbox-view.ts';
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
  // An explicit choice survives a later English host locale.
  controller.ready('en-US', true); await settle();
  assert.equal(controller.snapshot().language, 'zh-CN');
  controller.dispose();
  // A new frame reads the saved Chinese choice from device storage.
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
  assert.match(cleanupFeedback({ kind: 'restore' }, 'zh-CN'), /状态和历史记录不变/);
  assert.match(cleanupFeedback({ kind: 'error', code: 'busy' }, 'zh-CN'), /存储正忙/);
  assert.match(searchStatusText({ kind: 'retired' }, 'zh-CN'), /失效/);
  assert.equal(searchStatusText({ kind: 'message', en: 'EN', ru: 'RU', 'zh-CN': '中文消息' }, 'zh-CN'), '中文消息');
  assert.match(searchStatusText({ kind: 'removed', count: 2 }, 'zh-CN'), /2 条结果/);
  assert.equal(digestStatusText({ kind: 'saving' }, 'zh-CN'), '正在保存审阅…');
  assert.match(digestStatusText({ kind: 'saved', revision: 3 }, 'zh-CN'), /修订 3/);
  assert.equal(reportingCopyText('copied', 'zh-CN'), '已复制。');
  assert.equal(managedCopy('zh-CN').title, '设置 Agent Progress');
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

test('every InterfaceLanguage-typed catalog includes Simplified Chinese', () => {
  const roots = ['ui', 'shared', 'background'];
  let catalogs = 0;
  for (const root of roots) for (const entry of readdirSync(root, { recursive: true, encoding: 'utf8' })) {
    if (!entry.endsWith('.ts')) continue;
    const path = join(root, entry);
    const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node) => {
      if (ts.isVariableDeclaration(node) && node.initializer) {
        const init = node.initializer;
        const type = node.type ?? (ts.isSatisfiesExpression(init) ? init.type : undefined);
        const value = ts.isSatisfiesExpression(init) ? init.expression : init;
        if (type && /Record<InterfaceLanguage\s*,/.test(type.getText(source)) && ts.isObjectLiteralExpression(value)) {
          catalogs++;
          assert.ok(value.properties.some(p => p.name && (ts.isStringLiteral(p.name) || ts.isIdentifier(p.name)) && p.name.text === 'zh-CN'), `${path}: ${node.name.getText(source)}`);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  assert.ok(catalogs > 0, 'the catalog scan must find the typed catalogs');
});

test('1.4.0 Chinese inbox, delegation and Setup copy preserves reported-state boundaries', () => {
  assert.equal(inboxCopy('zh-CN').heading, '需要你处理');
  assert.match(inboxCopy('zh-CN').alsoNote, /其他受阻任务/);
  const components = readFileSync(new URL('../../ui/shared/components.ts', import.meta.url), 'utf8');
  assert.ok(components.includes("'Next sub-agent will take this': '下一个子智能体将接手此任务'"));
  assert.ok(components.includes('工作尚未开始，也尚未分配子智能体。'));
  const zh = managedStepCopy('zh-CN'), en = managedStepCopy('en');
  assert.deepEqual(Object.keys(zh.stages).sort(), Object.keys(en.stages).sort());
  assert.deepEqual(Object.keys(zh.errors).sort(), Object.keys(en.errors).sort());
  assert.equal(managedErrorText('managed-step-port-busy', 'zh-CN'), '其他程序正在使用协调端口。请关闭该程序后重试。');
  assert.match(zh.errors['managed-step-deadline'], /可能已部分完成/);
});
