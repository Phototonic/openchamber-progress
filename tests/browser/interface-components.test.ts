import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as i18n from '../../ui/shared/i18n.ts';
import * as format from '../../ui/shared/format.ts';
import * as model from '../../ui/shared/model.ts';
import * as readiness from '../../ui/shared/readiness.ts';
import * as live from '../../ui/shared/live.ts';
import * as scope from '../../ui/shared/scope.ts';

class Element {
  dataset: Record<string, string> = {};
  attributes: Record<string, string> = {};
  children: (Element | string)[] = [];
  listeners: Record<string, () => void> = {};
  className = ''; value = ''; title = ''; dateTime = '';
  classList = { add() {} };
  style: Record<string, string> = {};
  tagName: string;
  constructor(tagName = 'div') { this.tagName = tagName; }
  append(...nodes: (Element | string)[]) { this.children.push(...nodes); }
  prepend(...nodes: (Element | string)[]) { this.children.unshift(...nodes); }
  setAttribute(k: string, v: string) { this.attributes[k] = v; }
  getAttribute(k: string) { return this.attributes[k] ?? null; }
  addEventListener(k: string, run: () => void) { this.listeners[k] = run; }
  replaceChildren(...nodes: (Element | string)[]) { this.children = [...nodes]; }
  get textContent(): string { return this.children.map(n => typeof n === 'string' ? n : n.textContent).join(''); }
  set textContent(text: string) { this.children = [text]; }
  querySelector(selector: string): Element | null {
    for (const n of this.children) if (n instanceof Element) {
      if (selector === n.tagName || (selector === '.oc-sdk-trigger' && n.className === 'oc-sdk-trigger')) return n;
      const found = n.querySelector(selector); if (found) return found;
    }
    return null;
  }
  removeAttribute(k: string) { delete this.attributes[k]; }
  querySelectorAll() { return this.children.filter((n): n is Element => n instanceof Element); }
}

function fixture() {
  const writes: string[] = [];
  const selects: any[] = [];
  const load = (file: string, imports: Record<string, unknown>, extra = '') => {
    const exports: Record<string, any> = {};
    const code = ts.transpileModule(readFileSync(new URL(`../../ui/shared/${file}.ts`, import.meta.url), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    runInNewContext(code + extra, { exports, require: (name: string) => imports[name] ?? {},
      document: { createElement: (tag: string) => new Element(tag), createElementNS: (_: string, tag: string) => new Element(tag) },
      performance: { now: () => 0 }, CSS: { escape: (s: string) => s }, HTMLButtonElement: Element, navigator: { clipboard: { writeText: (text: string) => { writes.push(text); return held.promise; } } },
    });
    return exports;
  };
  let resolve!: () => void;
  const held = { promise: new Promise<void>(done => { resolve = done; }) };
  const primitives = load('primitives', { './i18n.ts': i18n });
  const components = load('components', { './i18n.ts': i18n, './format.ts': format, './model.ts': model, './primitives.ts': primitives,
    './readiness.ts': readiness, './live.ts': live, './scope.ts': scope,
    '@openchamber/sdk/ui': { mountButton: (root: Element, o: any) => { const b = new Element('button'); b.textContent = o.label; b.addEventListener('click', o.onClick); root.append(b); },
      mountBanner: (root: Element, o: any) => root.append(o.title, o.body), mountSpinner: (root: Element, o: any) => root.append(o.label),
      mountBadge: (root: Element, o: any) => root.append(o.label),
      mountSelect: (root: Element, o: any) => { selects.push(o); const b = new Element('button'); b.className = 'oc-sdk-trigger'; b.setAttribute('aria-label', o.label); root.append(b); } },
  }, '\nexports.copyBox = copyBox; exports.rowFacts = rowFacts; exports.participantSelect = participantSelect; exports.sessionsPanel = sessionsPanel;');
  return { components, primitives, resolve, writes, selects };
}

test('actual DOM helpers localize status, failures and elapsed ticker without exposing raw errors', () => {
  const { components: c, primitives: p } = fixture();
  assert.equal(p.statusMark('working', { locale: 'ru' }).getAttribute('aria-label'), 'В работе');
  assert.equal(c.lifecycleBadge({ lifecycle: 'completed' }, 'ru').textContent, model.lifecycleLabel('completed', 'ru'));
  assert.equal(c.loadingBlock('ru').textContent, 'Загрузка прогресса');
  const failure = { kind: 'invalid', code: 'INVALID', message: '<private raw error>' };
  assert.ok(!c.failureFacts(failure, 'ru')[0][1].includes('private'));
  assert.match(c.failureBlock(failure, () => {}, 'ru').textContent, /Не удалось прочитать прогресс/);
  const env = { locale: 'ru', mono: 0 };
  const unknown = c.elapsedLabel({ lifecycle: 'active' }, { id: 'a', kind: 'task', status: 'working' }, { timing: {} }, env);
  assert.equal(unknown.textContent, 'время неизвестно');
  assert.equal(unknown.title, 'Время начала неизвестно.');
});

test('session details show bounded host context as literal localized text only for the bound source', () => {
  const { components: c } = fixture();
  const metadata = live.hostWorkContext({ agent: '<script>agent</script>', links: [{ title: '<img src=x>Linked title', kind: 'change', url: 'https://example.invalid/change', linkedAt: 1 }] });
  const session = { id: 'A', title: 'Host title', directory: '/fixture/Alpha', projectId: 'project', activity: 'idle', ...metadata, moreLinks: true };
  const snapshot = { ...live.EMPTY_LIVE, projectsState: 'ready', sessions: new Map([['project', { state: 'ready', records: [session] }]]) };
  const plan = { sourceId: 'source', directory: '/fixture/Alpha', ownerSessionId: 'A' };
  for (const locale of ['en', 'ru']) {
    const env = { locale, boundSource: 'source', live: snapshot };
    const section = c.peopleBlock(plan, null, env);
    assert.ok(section.textContent.includes(metadata.agent!)); assert.ok(section.textContent.includes(metadata.links![0].title));
    assert.match(section.textContent, locale === 'ru' ? /Агент по данным хоста/ : /Host-reported agent/);
    assert.match(section.textContent, locale === 'ru' ? /Изменение, связанное в хосте/ : /Host-linked change/);
    assert.equal(section.querySelector('img'), null); assert.equal(section.querySelector('script'), null); assert.equal(section.querySelector('a'), null);
    assert.equal(section.textContent.includes('https:'), false);
    assert.equal(c.peopleBlock(plan, null, env, true).textContent.includes(metadata.agent!), false, 'compact session row stays compact');
    assert.equal(c.peopleBlock({ ...plan, sourceId: 'foreign' }, null, env).textContent.includes(metadata.agent!), false, 'same-ID foreign session never borrows host context');
  }
});

test('header links come only from the verified main session, as literal localized buttons that open on activation', () => {
  const { components: c } = fixture();
  const walk = (n: Element | string, out: Element[] = []): Element[] => { if (n instanceof Element) { out.push(n); n.children.forEach(child => walk(child, out)); } return out; };
  const metadata = live.hostWorkContext({ links: [
    { title: '<img src=x onerror=alert(1)>PR #95', kind: 'change', url: 'https://example.invalid/change/95', linkedAt: 1 },
    { title: 'Issue #12', kind: 'issue', url: 'https://example.invalid/issue/12', linkedAt: 2 },
    ...Array.from({ length: 5 }, (_, i) => ({ title: `Extra ${i}`, kind: 'issue', url: `https://example.invalid/extra/${i}`, linkedAt: 3 })),
  ] });
  assert.equal(metadata.moreLinks, true);
  const record = (id: string, projectId: string, extra: object = {}) => ({ id, title: 'Host title', directory: '/fixture/Alpha', projectId, parentId: null, activity: 'idle', ...extra });
  const snapshot = (records: Map<string, object[]>) => ({ ...live.EMPTY_LIVE, projectsState: 'ready', sessions: new Map([...records].map(([p, r]) => [p, { state: 'ready', records: r }])) });
  const owned = snapshot(new Map([['project', [record('A', 'project', metadata), record('C', 'project', { links: [{ title: 'Child link', kind: 'issue', url: 'https://example.invalid/child' }] })]]]));
  const plan = { sourceId: 'source', directory: '/fixture/Alpha', ownerSessionId: 'A' };
  const expected = { en: ['Linked in OpenChamber', 'Host-linked change: ', 'and more'], ru: ['Связано в OpenChamber', 'Изменение, связанное в хосте: ', 'и другие'], 'zh-CN': ['OpenChamber 中的关联', '宿主关联的变更: ', '还有更多'] } as const;
  for (const locale of ['en', 'ru', 'zh-CN'] as const) {
    const opened: string[] = [];
    const env = { locale, boundSource: 'source', unverifiedSources: new Set(), live: owned, openLinkedWorkUrl: (url: string) => opened.push(url) };
    const group = c.linkedWorkChips(plan, env)!;
    const nodes = walk(group);
    const [label, kind, more] = expected[locale];
    assert.equal(group.getAttribute('role'), 'group');
    const named = nodes.find(n => (n as any).id === group.getAttribute('aria-labelledby'));
    assert.equal(named?.textContent, label, `${locale}: visible host label names the group`);
    const buttons = nodes.filter(n => n.dataset.testid === 'linked-work-link');
    assert.equal(buttons.length, 5, `${locale}: the retained five, never the child's link`);
    assert.equal(buttons[0].textContent, `${kind}${metadata.links![0].title}`, `${locale}: spoken kind and literal full title`);
    assert.equal((buttons[0] as any).title, metadata.links![0].title, 'full title on hover');
    assert.equal(nodes.find(n => n.dataset.testid === 'linked-work-more')?.textContent, more, `${locale}: qualification, not a total`);
    assert.ok(!nodes.some(n => ['img', 'script', 'a'].includes(n.tagName)), 'no markup, image or navigable anchor');
    assert.ok(!group.textContent.includes('https:'), 'addresses are not shown');
    assert.deepEqual(opened, []);
    buttons[1].listeners.click();
    assert.deepEqual(opened, ['https://example.invalid/issue/12']);
  }
  const env = { locale: 'en', boundSource: 'source', unverifiedSources: new Set(), live: owned, openLinkedWorkUrl() {} };
  assert.equal(c.linkedWorkChips({ ...plan, sourceId: 'foreign' }, env), null, 'same-ID foreign session');
  assert.equal(c.linkedWorkChips(plan, { ...env, unverifiedSources: new Set(['source']) }), null, 'unverified source');
  assert.equal(c.linkedWorkChips(plan, { ...env, boundSource: null }), null, 'no verified binding');
  assert.equal(c.linkedWorkChips(plan, { ...env, openLinkedWorkUrl: undefined }), null, 'no host opener');
  assert.equal(c.linkedWorkChips({ ...plan, ownerSessionId: 'C2' }, env), null, 'owner not listed');
  const ambiguous = snapshot(new Map([['project', [record('A', 'project', metadata)]], ['other', [record('A', 'other', metadata)]]]));
  assert.equal(c.linkedWorkChips(plan, { ...env, live: ambiguous }), null, 'ambiguous same-spelled session');
  const textOnly = snapshot(new Map([['project', [record('A', 'project', { links: [{ title: 'Text only', kind: 'issue' }] })]]]));
  assert.equal(c.linkedWorkChips(plan, { ...env, live: textOnly }), null, 'no addressable link, no group');
});

test('expanded Sessions panel has one localized heading and keeps every participant and host fact', () => {
  const { components: c } = fixture();
  const metadata = live.hostWorkContext({ agent: 'Host agent', links: [{ title: 'Linked issue', kind: 'issue', url: 'https://example.invalid/issue', linkedAt: 1 }] });
  const session = { id: 'A', title: 'Host title', directory: '/fixture/Alpha', projectId: 'project', activity: 'idle', ...metadata };
  const snapshot = { ...live.EMPTY_LIVE, projectsState: 'ready', sessions: new Map([['project', { state: 'ready', records: [session] }]]) };
  const plan = { key: 'source/plan', sourceId: 'source', directory: '/fixture/Alpha', ownerSessionId: 'A' };
  const detail = { links: [], items: [{ id: 't', kind: 'task', assigneeSessionId: 'C' }], contributions: [{ attributedSessionId: 'C', mode: 'parent-relay' }] };
  const walk = (n: Element | string, out: Element[] = []): Element[] => { if (n instanceof Element) { out.push(n); n.children.forEach(child => walk(child, out)); } return out; };
  for (const locale of ['en', 'ru'] as const) {
    const env = { locale, boundSource: 'source', live: snapshot, mono: 0 };
    const box = c.sessionsPanel({ plan, detail, env });
    const all = walk(box);
    const headings = all.filter(n => /^h[1-6]$/.test(n.tagName));
    const title = locale === 'ru' ? 'Сессии' : 'Sessions';
    assert.equal(headings.length, 1, `${locale}: one section heading`);
    assert.equal(headings[0].textContent, title); assert.equal(box.getAttribute('aria-label'), title);
    assert.equal(box.dataset.testid, 'plan-panel-sessions');
    assert.ok(all.some(n => n.dataset.testid === 'plan-panel-sessions-close'), 'close control unchanged');
    const people = all.filter(n => n.dataset.testid?.startsWith('contributor-')).map(n => n.dataset.testid);
    assert.deepEqual(people, ['contributor-A', 'contributor-C'], 'every participant row kept');
    const text = box.textContent;
    for (const fact of locale === 'ru' ? ['Основная сессия', 'Дочерняя сессия', 'Назначено: 1', 'Агент по данным хоста: Host agent', 'Задача, связанная в хосте: Linked issue'] : ['Main session', 'Child session', '1 assigned', 'reports relayed by the main session', 'Host-reported agent: Host agent', 'Host-linked issue: Linked issue']) assert.ok(text.includes(fact), `${locale}: ${fact}`);
  }
});

test('actual progress and picker preserve counts and literal titles while translating visible and aria copy', () => {
  const { components: c, primitives: p } = fixture();
  const s = { done: 1, total: 5, remaining: 4, skipped: 2, working: 1, blocked: 2 };
  const en = c.progressBlock(s, true, 'en'), ru = c.progressBlock(s, true, 'ru');
  assert.equal(en.textContent, '1 of 5 done · 4 remaining · 2 skipped · 1 in progress · 2 blocked');
  assert.equal(ru.textContent, 'Выполнено: 1 из 5 · Осталось: 4 · Пропущено: 2 · 1 в работе · 2 заблокировано');
  assert.equal(ru.children[0].dataset.total, '5');
  assert.match(ru.children[1].getAttribute('aria-label'), /Выполнено: 1 из 5/);
  const options = { title: '<b>Original plan</b>', index: 2, count: 5, value: 'plan', options: [], onChange() {} };
  const picker = c.planPicker({ ...options, locale: 'ru' }).querySelector('button');
  assert.equal(picker.getAttribute('aria-label'), 'План 2 из 5: <b>Original plan</b>. Выбрать другой план');
  assert.equal(picker.textContent, '2 из 5');
  assert.equal(c.planLocation({ directory: '', ownerSessionId: 'a' }, live.EMPTY_LIVE, undefined, 'ru'), 'Неизвестное расположение');
  assert.equal(p.statusMark('working').getAttribute('aria-label'), 'In progress');
  assert.equal(p.stateChip({ state: 'blocked', count: 0, label: 'Заблокировано', locale: 'ru' }), null);
});

test('participant selector uses Russian plural forms without changing session labels or filter IDs', () => {
  const { components: c, selects } = fixture();
  const forms = ['0 задач', '1 задача', '2 задачи', '5 задач', '11 задач', '21 задача'];
  for (const [i, n] of [0, 1, 2, 5, 11, 21].entries()) {
    c.participantSelect({ ownerSessionId: 'main' }, { set() {} }, {
      filter: { kind: 'all' }, index: { sessions: ['main'], taskCount: new Map([['main', n]]), unknownCount: 0 },
    }, () => 'Original <b>session</b>', 'ru');
    const select = selects.at(-1);
    assert.equal(select.label, 'Участник');
    assert.equal(select.options[1].id, 's:main');
    assert.equal(select.options[1].label, 'Original <b>session</b>');
    assert.equal(select.options[1].hint, `основная сессия · ${forms[i]}`);
  }
});

test('retry handoff formats its semantic notice in the language supplied at completion', () => {
  const { components: c } = fixture();
  let pending: any, retries = 0;
  c.retryRead({ env: { locale: 'en' }, handoff: (h: unknown) => { pending = h; }, retry: () => { retries++; } })();
  assert.equal(retries, 1);
  assert.equal(pending.notice({ dataset: { testid: 'plan-title' } }, 'ru'), 'Прогресс снова загружен');
  assert.equal(pending.notice({ dataset: { testid: 'setup-needed' } }, 'ru'), 'Нужна настройка');
});

test('task copy preview translates labels but keeps literal facts; old completion cannot confirm translated generation', async () => {
  const { components: c, resolve, writes } = fixture();
  let paints = 0;
  const p = { plan: { key: 'source/plan' }, env: { locale: 'en' }, reading: { current: () => true, set: () => { paints++; } } };
  const item = { id: 'task', title: '<b>Mixed title</b>' };
  c.copyBox(p, item, []).children[0].listeners.click();
  const english = c.copyBox(p, item, [['Reason', 'Исходный <script>text</script>']]).children[0];
  const oldArea = english.children[1].children[1];
  english.children[2].children[0].children[0].listeners.click();
  assert.equal(writes[0], oldArea.value, 'clipboard receives the shown English preview exactly');
  p.env.locale = 'ru';
  const russian = c.copyBox(p, item, [['Причина', 'Исходный <script>text</script>']]).children[0];
  const area = russian.children[1].children[1];
  assert.equal(area.value, '<b>Mixed title</b>\nПричина: Исходный <script>text</script>');
  assert.notEqual(area.dataset.taskCopyGeneration, oldArea.dataset.taskCopyGeneration);
  assert.match(russian.children[1].textContent, /Сведения о задаче/);
  const before = paints;
  resolve(); await Promise.resolve(); await Promise.resolve();
  assert.equal(paints, before, 'late English clipboard completion does not repaint/confirm Russian text');
  russian.children[2].children[0].children[0].listeners.click();
  await Promise.resolve(); await Promise.resolve();
  assert.equal(writes[1], area.value, 'explicit Russian Copy receives exactly the translated preview');
});

test('actual expanded task facts keep mixed-language values and recorded provenance on both languages', () => {
  const { components: c } = fixture();
  const item = { id: 'a', kind: 'task', title: '<b>Original title</b>', status: 'blocked', assigneeSessionId: 'session-a',
    dependencies: ['b'], reportedBlocker: { state: 'reported', category: 'review', reason: 'Исходная <img>причина',
      nextAction: 'Original <script>next</script>', mode: 'parent-relay', reporterSessionId: 'main', attributedSessionId: 'session-a' } };
  const detail = { items: [item], links: [], contributions: [] };
  const p = { plan: { key: 'source/plan', sourceId: 'source', lifecycle: 'active' }, detail,
    env: { locale: 'en', boundSource: null }, entries: new Map(), unlocks: null, who: null,
    byId: new Map([['b', { id: 'b', kind: 'task', title: 'Original prerequisite', status: 'done' }]]),
    label: (id: string) => `Original ${id}`, compareSession: null, trusted: false };
  const en = c.rowFacts(p, { item, state: 'blocked', visibility: 'match' });
  p.env.locale = 'ru';
  const ru = c.rowFacts(p, { item, state: 'blocked', visibility: 'match' });
  assert.equal(en.text.find(([k]: string[]) => k === 'Why')[1], item.reportedBlocker.reason);
  assert.equal(ru.text.find(([k]: string[]) => k === 'Почему')[1], item.reportedBlocker.reason);
  assert.equal(ru.text.find(([k]: string[]) => k === 'Следующий шаг')[1], item.reportedBlocker.nextAction);
  assert.equal(en.text.find(([k]: string[]) => k === 'Next step')[1], item.reportedBlocker.nextAction);
  assert.doesNotMatch(en.dl.textContent, /Asks you to/, 'a generic blocked task does not imply it needs the user');
  assert.equal(ru.text.find(([k]: string[]) => k === 'Сначала нужны')[1], `Original prerequisite (${model.statusLabel('done', 'ru')})`);
  assert.match(ru.dl.textContent, /Сведения: передан сессией Original main за Original session-a/);
  assert.equal(en.text.length, ru.text.length, 'same set of facts, no extra export data');
});

test('restored document fills cached error without I/O; explicit reopen and retry still request', () => {
  const { components: c } = fixture();
  let requests = 0;
  const plan = { id: 'plan', key: 'source/plan', document: { state: 'captured', path: 'docs/plan.md', captureId: 1 } };
  const value = { state: 'error', failure: { kind: 'busy', code: 'busy', message: '<raw>' } };
  const doc = c.documentBlock(plan, { locale: 'ru' }, 'disclosure', { get: () => value, request: () => { requests++; } });
  doc.dataset.languageRestore = 'true';
  doc.open = true;
  doc.listeners.toggle(); // synthetic restoration
  doc.listeners.toggle(); // queued native toggle of the same restored-open paint
  assert.equal(requests, 0);
  assert.match(doc.textContent, /Прогресс занят/);
  const body = doc.children[1];
  body.children[0].children[1].listeners.click();
  assert.equal(requests, 1, 'Retry is always explicit authority');
  doc.open = false; doc.listeners.toggle();
  doc.open = true; doc.listeners.toggle();
  assert.equal(requests, 2, 'explicit reopen is not suppressed after close');
  assert.equal(doc.dataset.languageRestore, undefined);
});

test('inline document repaint retains a read error without automatic retry, but Retry remains explicit', () => {
  const { components: c } = fixture();
  let requests = 0;
  let value: any = null;
  const plan = { id: 'plan', key: 'source/plan', document: { state: 'captured', captureId: 1 } };
  const source = { get: () => value, request: () => { requests++; } };
  c.documentBlock(plan, { locale: 'en' }, 'inline', source);
  assert.equal(requests, 1, 'first inline visit starts the read');
  value = { state: 'error', failure: { kind: 'busy', code: 'busy', message: '<raw>' } };
  const english = c.documentBlock(plan, { locale: 'en' }, 'inline', source);
  const russian = c.documentBlock(plan, { locale: 'ru' }, 'inline', source);
  assert.equal(requests, 1, 'data and language repaints keep the cached failure');
  assert.match(english.textContent, /progress is busy/i);
  assert.match(russian.textContent, /Прогресс занят/);
  russian.children[0].children[0].children[1].listeners.click();
  assert.equal(requests, 2, 'explicit Retry starts exactly one additional read');
});

test('ticker relabels anchored elapsed values, unknowns and tooltips using its explicit locale', () => {
  const { components: c } = fixture();
  const timing = { a: { kind: 'lower-bound', since: '2026-01-01T12:00:00Z', elapsedAtRead: 60_000, receivedAt: 0 } };
  const plan = { lifecycle: 'active' }, item = { id: 'a', kind: 'task', status: 'working' };
  const elapsed = c.elapsedLabel(plan, item, { timing }, { locale: 'en', mono: 0 });
  const unknown = c.elapsedLabel(plan, item, { timing: {} }, { locale: 'en', mono: 0 });
  const root = { querySelectorAll: (selector: string) => selector === 'time[data-elapsed]' ? [elapsed]
    : selector === '[data-elapsed-unknown]' ? [unknown] : [] };
  c.refreshLabels(root, 'ru', 0, 60_000);
  assert.equal(elapsed.textContent, '2 мин+');
  assert.match(elapsed.title, /начало неизвестно/);
  assert.equal(unknown.textContent, 'время неизвестно');
  c.refreshLabels(root, 'en', 0, 60_000);
  assert.equal(elapsed.textContent, '2 min+');
  assert.match(elapsed.title, /start unknown/);
  c.refreshLabels(root, 'zh-CN', 0, 60_000);
  assert.equal(elapsed.textContent, '2 分钟+');
});
