import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as i18n from '../../ui/shared/i18n.ts';
import * as format from '../../ui/shared/format.ts';
import * as model from '../../ui/shared/model.ts';
import * as live from '../../ui/shared/live.ts';
import * as scope from '../../ui/shared/scope.ts';
import { parsePlansPage } from '../../ui/shared/adapter.ts';
import { P1, P1_ITEMS, plansPage } from './fixtures.ts';
import * as quiet from '../../ui/shared/quiet-plans.ts';
import * as cancellation from '../../ui/shared/plan-user-cancel.ts';
import { pageFunction, pageHook } from './page-hooks.ts';

class Element {
  dataset: Record<string, string> = {}; attributes: Record<string, string> = {};
  children: Element[] = []; textContent = ''; className = ''; tabIndex = 0;
  classList = { add() {} }; listeners: Record<string, (...args: any[]) => void> = {};
  focused = false;
  tagName: string;
  constructor(tagName: string) { this.tagName = tagName; }
  append(...children: Element[]) { this.children.push(...children); }
  prepend(...children: Element[]) { this.children.unshift(...children); }
  replaceChildren(...children: Element[]) { this.children = children; }
  setAttribute(key: string, value: string) { this.attributes[key] = value; }
  addEventListener(key: string, value: (...args: any[]) => void) { this.listeners[key] = value; }
  focus() { this.focused = true; }
  querySelector(selector: string): Element | null {
    for (const n of this.children) {
      if (n.tagName === selector || (selector[0] === '.' && n.className.split(' ').includes(selector.slice(1)))) return n;
      const found = n.querySelector(selector); if (found) return found;
    }
    return null;
  }
}
function fixture(locale = 'en', saved: number | null = null) {
  const window = { innerWidth: 390, frameElement: null as { getBoundingClientRect(): { width: number } } | null };
  const menus: any[] = [], buttons: any[] = [], checkpointReads: unknown[] = [];
  const exports: any = {};
  const code = ts.transpileModule(readFileSync(new URL('../../ui/shared/components.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  runInNewContext(code, {
    exports, Date, Intl, window, document: { createElement: (tag: string) => new Element(tag) },
    require: (path: string) => ({
      './i18n.ts': i18n, './format.ts': format, './model.ts': model, './live.ts': live, './scope.ts': scope,
      './quiet-plans.ts': quiet, './plan-user-cancel.ts': cancellation,
      './change-digest-checkpoint.ts': { CheckpointStore: class { async read(identity: unknown) { checkpointReads.push(identity); return saved === null ? { state: 'absent' } : { state: 'saved', revision: saved }; } } },
      './primitives.ts': {
        moreMenu(options: any) {
          menus.push(options);
          const root = new Element('div');
          return {
            root, trigger: new Element('button'), setOptions(next: object) { Object.assign(options, next); },
            mount(holder: Element) { holder.append(root); }, refresh() {}, dispose() { options.open = false; },
          };
        },
        segmentedBar: () => new Element('div'), warningBadge: () => new Element('span'), icon: () => new Element('span'),
      },
      '@openchamber/sdk/ui': { mountButton(root: Element, o: any) { const b = new Element('button'); b.textContent = o.label; b.listeners.click = o.onClick; root.append(b); buttons.push(b); } },
    } as Record<string, unknown>)[path] ?? {},
  });
  const plan = parsePlansPage(JSON.stringify(plansPage([P1]))).data[0]!;
  const vc: any = { ctx: { features: { deviceStorage: true }, connection: { account: 'fixture' } }, identity: 'fixture', session: null, refreshSerial: 1,
    env: { locale, now: Date.now(), live: live.EMPTY_LIVE, boundSource: plan.sourceId, unverifiedSources: new Set(), view: { fresh: true, captureEnabled: true } }, live: live.EMPTY_LIVE,
    read: { storeId: 'store', binding: { sourceId: plan.sourceId, verified: true } },
    detail: () => null, summary: () => null, storage: {}, language: { preference: 'auto', supported: true }, reading: {}, setUi() {},
    quiet: { hide: true, supported: true, error: null, saving: false }, cancelPlan: () => null,
  };
  const shell = new exports.ProgressShell();
  const panel = new Element('div');
  const closed: string[] = [];
  const options = {
    board: true, renderPanel: () => panel, closePanel: (kind: string) => closed.push(kind),
  };
  const paint = (p: any = null) => {
    const root = new Element('div');
    shell.reconcile(vc, p, options);
    root.append(shell.settingsButton(vc));
    const opened = shell.paint(root, vc, p, options);
    return { root, opened };
  };
  return { shell, vc, plan, menus, buttons, paint, options, panel, closed, checkpointReads, exports, window };
}
for (const board of [false, true]) test(`${board ? 'board' : 'rail'} keeps More open through a shell repaint`, () => {
  const f = fixture();
  f.options.board = board;
  let eligible = true;
  f.vc.cancelPlan = () => ({ eligible, open() {} });
  f.paint(f.plan);
  const menu = f.menus.at(-1);
  menu.open = true;
  eligible = false;
  f.paint(f.plan);
  assert.equal(f.menus.at(-1), menu);
  assert.equal(menu.open, true, 'the current menu was not dismissed');
  assert.equal(menu.items.some((item: { id?: string }) => item.id === 'finish-cancelled'), false);
  f.vc.identity = 'another-store';
  f.paint(f.plan);
  assert.equal(menu.open, false);
  assert.notEqual(f.menus.at(-1), menu);
});
for (const exit of ['Back', 'Escape', 'showView', 'reset', 'reconcile', 'another panel']) test(`Setup panel retires once on ${exit}, not on repaint`, () => {
  const f = fixture(); f.paint(); f.menus.at(-1).onSelect('setup');
  f.paint(); const { root } = f.paint();
  assert.deepEqual(f.closed, [], 'a same-panel repaint keeps its presentation');
  if (exit === 'Back') f.buttons.at(-1).listeners.click();
  if (exit === 'Escape') {
    const box = root.children.find(n => n.dataset.testid === 'surface-panel-setup')!;
    let prevented = false;
    box.listeners.keydown({ key: 'Escape', defaultPrevented: false, target: { closest: () => null }, preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
  }
  if (exit === 'showView') f.shell.showView(f.vc);
  if (exit === 'reset') f.shell.reset();
  if (exit === 'reconcile') { f.vc.identity = 'new-store'; f.shell.reconcile(f.vc, null, f.options); }
  if (exit === 'another panel') f.menus.at(-1).onSelect('troubleshooting');
  assert.deepEqual(f.closed, ['setup']);
  f.paint();
  assert.deepEqual(f.closed, ['setup'], 'painting the next view does not retire twice');
  f.menus.at(-1).onSelect('setup');
  assert.equal(f.paint().opened, true, 'Setup can reopen after retirement');
});
for (const locale of ['en', 'ru', 'zh-CN']) test(`settings menu remains available without readable plans (${locale})`, () => {
  const f = fixture(locale);
  for (const state of ['empty', 'not-set-up', 'failed']) {
    f.vc.read = null; f.vc.failure = state === 'failed' ? {} : null;
    f.paint();
    const menu = f.menus.at(-1);
    assert.deepEqual(Array.from(menu.items, (i: any) => i.id), ['language', 'setup', 'troubleshooting']);
    assert.notEqual(menu.label, '');
    menu.onSelect('setup');
    assert.equal(f.paint().opened, true, 'panel replaces the reading mount');
    f.buttons.at(-1).listeners.click();
    assert.equal(f.paint().opened, false, 'Back restores the reading');
  }
});
test('same-reading reset retires Setup presentation but keeps the panel, not other panels', () => {
  const f = fixture(); f.paint(); f.menus.at(-1).onSelect('setup'); f.paint();
  f.shell.reset(true);
  assert.deepEqual(f.closed, ['setup'], 'step presentation is retired on the data reset');
  assert.equal(f.paint().opened, true);
  assert.equal(f.shell.activePanel, 'setup');
  f.vc.identity = 'new-authority';
  assert.equal(f.paint().opened, false, 'preservation never crosses authority changes');
  f.menus.at(-1).onSelect('troubleshooting'); f.paint();
  f.shell.reset(true);
  assert.equal(f.paint().opened, false, 'other panels still close on data reset');
});
const walk = (n: Element, out: Element[] = []): Element[] => { out.push(n); n.children.forEach(child => walk(child, out)); return out; };
const linkedSnapshot = (ownerLinks: live.LiveSessionLink[]) => {
  const session = (id: string, parentId: string | null, links: live.LiveSessionLink[]) => ({ id, title: id, projectId: 'alpha', directory: '/fixture/Alpha', parentId, archivedAt: null, worktree: null, activity: 'idle', outcome: null, ...(links.length ? { links } : {}) });
  return { ...live.EMPTY_LIVE, projectsState: 'ready', projects: [{ id: 'alpha', name: 'Alpha', directory: '/fixture/Alpha' }],
    sessions: new Map([['alpha', { state: 'ready', records: [session(P1.sessionId, null, ownerLinks), session('ses_fixture_child_C1', P1.sessionId, [{ title: 'Child-only change', kind: 'change', url: 'https://example.invalid/child' }])] }]]) };
};
for (const board of [false, true]) test(`${board ? 'board' : 'rail'} header shows only the main session's addressable links and drops them on a link-only update`, () => {
  const f = fixture();
  f.options.board = board;
  const opened: string[] = [];
  f.vc.env.openLinkedWorkUrl = (url: string) => opened.push(url);
  f.vc.env.live = linkedSnapshot([
    { title: 'PR #95', kind: 'change', url: 'https://example.invalid/change/95' },
    { title: 'Issue #12', kind: 'issue', url: 'https://example.invalid/issue/12' },
    { title: 'Text-only issue', kind: 'issue' },
  ]);
  const header = () => walk(f.paint(f.plan).root).find(n => n.dataset.testid === 'surface-header')!;
  const chips = (head: Element) => walk(head).filter(n => n.dataset.testid === 'linked-work-link');
  const first = chips(header());
  assert.deepEqual(first.map(b => walk(b).find(n => n.className === 'ap-work-link-title')?.textContent), ['PR #95', 'Issue #12']);
  assert.deepEqual(first.map(b => b.dataset.kind), ['change', 'issue']);
  assert.deepEqual(first.map(b => b.dataset.focusKey), ['https://example.invalid/change/95', 'https://example.invalid/issue/12'], 'each chip has its own focus identity');
  assert.deepEqual(opened, [], 'rendering opens nothing');
  first[1]!.listeners.click();
  assert.deepEqual(opened, ['https://example.invalid/issue/12'], 'one activation, one open');
  f.vc.env.live = linkedSnapshot([]);
  const head = header();
  assert.equal(chips(head).length, 0);
  assert.equal(walk(head).some(n => n.dataset.testid === 'linked-work'), false, 'no empty group or placeholder');
  assert.ok(walk(head).some(n => n.dataset.testid === 'plan-title'), 'the title remains');
});

test('plan and settings menus do not duplicate the four views, summary or cleanup actions', () => {
  const f = fixture();
  f.paint(f.plan);
  const [settings, more] = f.menus;
  assert.deepEqual(Array.from(settings.items, (i: any) => i.id), ['language', 'setup', 'troubleshooting']);
  assert.deepEqual(Array.from(more.items, (i: any) => i.id), ['sessions']);
});

test('rail can mount the checked quiet filter without a selected plan or a menu', () => {
  const f = fixture();
  f.options.board = false;
  let choice: boolean | null = null;
  f.vc.quiet.choose = (hide: boolean) => { choice = hide; };
  f.paint();
  const quiet = f.exports.quietCheck(f.vc);
  const control = quiet.children[0];
  assert.equal(control.checked, true);
  control.checked = false;
  control.listeners.change();
  assert.equal(choice, false);
});

test('More opens an inline confirmation; Escape and Keep do not dispatch', () => {
  const f = fixture('zh-CN');
  f.plan.title = '<Example plan>';
  let open = false, keeps = 0, confirms = 0;
  f.vc.cancelPlan = () => ({
    eligible: true, open: () => { open = true; },
    confirmation: open ? { title: f.plan.title, pending: false,
      keep: () => { keeps++; open = false; }, confirm: () => { confirms++; } } : null,
  });
  f.paint(f.plan);
  assert.ok(f.menus.at(-1).items.some((item: { id?: string }) => item.id === 'finish-cancelled'));
  f.menus.at(-1).onSelect('finish-cancelled');
  let box = f.paint(f.plan).root.children.find(node => node.dataset.testid === 'plan-cancel-confirmation')!;
  assert.ok(box.children[0].textContent.includes('<Example plan>'));
  let stopped = false;
  box.listeners.keydown({ key: 'Escape', preventDefault() {}, stopPropagation() { stopped = true; } });
  assert.equal(stopped, true);
  assert.equal(keeps, 1);
  assert.equal(confirms, 0);
  f.paint(f.plan); f.menus.at(-1).onSelect('finish-cancelled');
  box = f.paint(f.plan).root.children.find(node => node.dataset.testid === 'plan-cancel-confirmation')!;
  const actions = box.children[2].children;
  assert.equal(actions[0].dataset.testid, 'plan-cancel-keep');
  actions[0].children[0].listeners.click();
  assert.equal(keeps, 2);
  assert.equal(confirms, 0);
  f.paint(f.plan); f.menus.at(-1).onSelect('finish-cancelled');
  box = f.paint(f.plan).root.children.find(node => node.dataset.testid === 'plan-cancel-confirmation')!;
  box.children[2].children[1].children[0].listeners.click();
  assert.equal(confirms, 1);
});
test('history dot uses only an existing older device review point, never a digest read', async () => {
  for (const saved of [null, 1, P1.revision]) {
    const f = fixture('en', saved);
    f.paint(f.plan); await Promise.resolve(); f.paint(f.plan);
    assert.equal(f.checkpointReads.length, 1);
    const historyName = () => f.shell.switchView('list', () => {}, 'en').children[3].querySelector('button').attributes['aria-label'];
    assert.equal(historyName(), saved === 1 ? 'History, new revisions' : undefined);
    f.vc.ctx.features.deviceStorage = false; f.paint(f.plan);
    assert.equal(historyName(), undefined);
    assert.equal(f.checkpointReads.length, 1);
  }
});
test('View current task in History schedules a paint and reveals only after current detail', () => {
  const { shell, vc, plan } = fixture();
  let activate: ((item: string, title: string) => void) | undefined;
  let notice = '', needsPaint = false;
  const revealed: string[] = [];
  const task = P1_ITEMS.find(item => item.kind === 'task')!;
  vc.ctx.features.deviceStorage = false;
  vc.ui = { tab: 'history' };
  vc.setUi = (patch: object) => { Object.assign(vc.ui, patch); needsPaint = true; };
  vc.retry = () => {}; // An unchanged service refresh doesn't invalidate the paint.
  vc.requestHistory = () => {};
  vc.history = () => null;
  vc.digest = () => ({ announce: (text: string) => { notice = text; needsPaint = true; } });
  const copy = { opening: (title: string) => `Opening ${title}`, historyTask: (title: string) => title };
  const globals = {
    shell, pendingTask: null, shownDigest: null, copy: () => copy,
    messages: { en: copy, ru: copy, 'zh-CN': copy }, said: (en: string) => en,
    el: (tag: string) => new Element(tag), testid: (n: Element, id: string) => { n.dataset.testid = id; return n; },
    surface: () => false, trusted: () => false, cleanupBlock: () => new Element('div'),
    visiblePlans: () => [plan], readingScope: () => 'fixture', isSearching: () => false, selectedPlan: () => plan,
    compactInbox: null, hiddenInboxAction: () => [], historyBlock: () => new Element('div'),
    digestBlock: (_panel: unknown, _env: unknown, action: typeof activate) => { activate = action; return new Element('div'); },
    chooseTab: (_vc: unknown, tab: string) => vc.setUi({ tab }),
    revealCurrentTask: (_article: unknown, _plan: unknown, item: string) => revealed.push(item),
  };
  pageFunction('detailPane', globals);
  pageFunction('currentTask', globals);
  const { detailPane, currentTask } = globals as typeof globals & {
    detailPane: (root: Element, context: unknown, plan: unknown, session: null) => void;
    currentTask: (root: unknown, context: unknown) => void;
  };
  const wantDetails = pageHook('wantDetails', globals);
  detailPane(new Element('div'), vc, plan, null);
  needsPaint = false;
  activate!(task.id, task.title);
  assert.ok(needsPaint, 'the action must not depend on a changed plan list to request current detail');
  assert.equal(notice, `Opening ${task.title}`);
  assert.equal(wantDetails(vc)[0], plan);
  currentTask(null, vc);
  assert.equal(vc.ui.tab, 'history', 'keep History open until detail is ready');
  vc.detail = () => ({ state: 'ready', value: { revision: plan.revision, items: P1_ITEMS } });
  currentTask(null, vc);
  assert.equal(shell.activePanel, null);
  assert.equal(vc.ui.tab, 'progress');
  const article = { dataset: { testid: `plan-${plan.id}`, source: plan.sourceId }, querySelector: () => ({}) };
  currentTask({ querySelectorAll: () => [article] }, vc);
  assert.deepEqual(revealed, [task.id]);
});
test('panel state is frame-local and resets on plan or authority changes', () => {
  const f = fixture(); f.paint(f.plan); f.menus.at(-1).onSelect('sessions');
  assert.equal(f.paint(f.plan).opened, true);
  f.vc.identity = 'another-store';
  assert.equal(f.paint(f.plan).opened, false);
});
test('shell reconciliation retires another plan panel before view visibility is computed', () => {
  const f = fixture('ru'); f.paint(f.plan);
  const controls = f.shell.switchView('list', () => {}, f.vc.env.locale);
  assert.deepEqual(Array.from(controls.children, (node: Element) => node.querySelector('button')?.textContent), ['Карта', 'Список', 'Документ', 'История']);
  f.menus.at(-1).onSelect('sessions');
  f.shell.reconcile(f.vc, f.plan, f.options);
  assert.equal(f.shell.activePanel, 'sessions', 'a repaint of the same reading keeps its panel');
  f.shell.reconcile(f.vc, { ...f.plan, key: 'source/another-plan' }, f.options);
  assert.equal(f.shell.activePanel, null, 'the new reading is usable before paint');
});
test('narrow default uses an allocated viewport, not a hidden frame provisional width', () => {
  const f = fixture();
  f.window.innerWidth = 280;
  assert.equal(f.exports.narrowSurface(), true);
  f.window.frameElement = { getBoundingClientRect: () => ({ width: 0 }) };
  assert.equal(f.exports.narrowSurface(), false);
  f.window.frameElement = { getBoundingClientRect: () => ({ width: 280 }) };
  assert.equal(f.exports.narrowSurface(), true);
  f.window.innerWidth = 390;
  assert.equal(f.exports.narrowSurface(), false);
});
test('text legend does not subtract skipped tasks twice from the not-started count', () => {
  const f = fixture();
  f.vc.detail = () => ({ state: 'ready', value: { key: f.plan.key, revision: f.plan.revision, items: P1_ITEMS, contributions: [], links: [] } });
  const { root } = f.paint(f.plan);
  assert.match(root.querySelector('.ap-progress-legend')!.textContent, /1 not started/);
  assert.match(root.querySelector('.ap-progress-legend')!.textContent, /1 skipped/);
});
