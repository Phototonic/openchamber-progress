import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { parsePlansPage } from '../../ui/shared/adapter.ts';
import type * as components from '../../ui/shared/components.ts';
import { EMPTY_LIVE } from '../../ui/shared/live.ts';
import type { InterfaceLanguage } from '../../ui/shared/i18n.ts';
import type { PlanActivityAction } from '../../ui/shared/model.ts';
import { P1, plansPage } from './fixtures.ts';

class Element {
  readonly tagName: string;
  constructor(tagName: string) { this.tagName = tagName; }
  dataset: Record<string, string> = {};
  attributes: Record<string, string> = {};
  textContent = '';
  hidden = false;
  dateTime = '';
  title = '';
  children: Element[] = [];
  listeners: Record<string, () => void> = {};
  append(...children: Element[]) { this.children.push(...children); }
  setAttribute(k: string, v: string) { this.attributes[k] = v; }
  addEventListener(k: string, fn: () => void) { this.listeners[k] = fn; }
  focus() {}
  find(id: string): Element | undefined {
    return this.dataset.testid === id ? this : this.children.map(c => c.find(id)).find(Boolean);
  }
  get text(): string { return [this.textContent, ...this.children.map(c => c.text)].filter(Boolean).join(' '); }
}

const url = new URL('../../ui/shared/components.ts', import.meta.url);
const modules = createRequire(url);
const output = ts.transpileModule(readFileSync(url, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const view = {} as typeof components;
runInNewContext(output, {
  exports: view, document: { createElement: (tag: string) => new Element(tag) },
  require: (name: string) => name === '@openchamber/sdk/ui' || name === './primitives.ts' ? {} : modules(name),
});
const plan = { ...parsePlansPage(JSON.stringify(plansPage([P1]))).data[0], revision: 24 };
const time = '2026-04-22T00:00:00.000Z';
const env = (locale: InterfaceLanguage): components.Env => ({
  locale, now: Date.parse(time), mono: 0, live: EMPTY_LIVE, boundSource: null, unverifiedSources: new Set(),
  view: { fresh: true, captureEnabled: true }, openSession() {},
});
const asElement = (n: HTMLElement) => n as unknown as Element;

test('the disclosure is collapsed by default; pending arrows do not dispatch and retry is explicit', () => {
  const actions: PlanActivityAction[] = [];
  const act = (action: PlanActivityAction) => actions.push(action);
  const paint = (value: Parameters<typeof view.planActivityBlock>[1]['value']) => asElement(view.planActivityBlock(plan, { act, value }, env('en')));
  const closed = paint({ state: 'closed' }), toggle = closed.find('activity-toggle')!;
  assert.equal(toggle.tagName, 'button');
  assert.equal(toggle.attributes['aria-expanded'], 'false');
  assert.equal(closed.find('activity-older'), undefined);
  assert.deepEqual(actions, []);
  toggle.listeners.click();
  const loading = paint({ state: 'loading', through: 23, pin: 23 });
  assert.equal(loading.find('activity-toggle')?.attributes['aria-expanded'], 'true');
  assert.equal(loading.find('activity-older')?.attributes['aria-disabled'], 'true');
  loading.find('activity-older')!.listeners.click();
  loading.find('activity-toggle')!.listeners.click();
  const failed = paint({ state: 'failure', through: 23, pin: 23 });
  assert.match(failed.text, /Activity is unavailable/);
  failed.find('activity-retry')!.listeners.click();
  assert.deepEqual(actions, ['open', 'close', 'retry']);
});

test('rendered rows use History cancellation, literal stored task IDs and localized attribution', () => {
  for (const [locale, title, role, child, cancellation, unavailable, noIds] of [
    ['en', 'Activity', 'Coordinator', 'Sub-agent', 'Cancelled by user', 'Report details unavailable', 'No task IDs reported'],
    ['ru', 'Активность', 'Координатор', 'Субагент', 'Отменён пользователем', 'Сведения об отчёте недоступны', 'Идентификаторы задач не указаны'],
    ['zh-CN', '活动', '协调者', '子代理', '由用户取消', '报告详情不可用', '未报告任务 ID'],
  ] as const) {
    const a = asElement(view.planActivityBlock(plan, {
      value: { state: 'ready', pin: 24, through: 4, nextThrough: null, rows: [
        { kind: 'report', revision: 4, reportedAt: time, mode: 'parent-relay', reporterSessionId: plan.ownerSessionId, attributedSessionId: 'saved-child', itemIds: ['removed-task', 'another-task'] },
        { kind: 'report', revision: 3, reportedAt: time, mode: 'direct', reporterSessionId: 'second-child', attributedSessionId: 'second-child', itemIds: [] },
        { kind: 'unavailable', revision: 2, reportedAt: time },
        { kind: 'user', revision: 1, reportedAt: time },
      ] }, act() {},
    }, env(locale)));
    assert.equal(a.find('activity-toggle')?.text, title);
    const relay = a.find('activity-revision-4')!, direct = a.find('activity-revision-3')!, missing = a.find('activity-revision-2')!, user = a.find('activity-revision-1')!;
    assert.ok(relay.text.includes(role) && relay.text.includes('removed-task, another-task'));
    assert.ok(direct.text.includes(child) && direct.text.includes(noIds));
    assert.equal(missing.children.at(-1)?.text, unavailable);
    assert.equal(user.children.at(-1)?.text, cancellation);
    assert.equal(user.children.find(n => n.tagName === 'time')?.dateTime, time);
    assert.equal(user.children.length, 3);
    assert.equal(missing.children.length, 3);
    const h = asElement(view.historyBlock(plan, { state: 'ready', value: { truncated: false,
      entries: [{ revision: 1, structuralRevision: 1, lifecycle: 'cancelled', actor: 'user', reportedAt: time }],
    } }, env(locale)));
    assert.ok(h.find('revision-1')?.text.includes(cancellation));
  }
});
