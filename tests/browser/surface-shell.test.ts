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
      './change-digest-checkpoint.ts': { CheckpointStore: class { async read(identity: unknown) { checkpointReads.push(identity); return saved === null ? { state: 'absent' } : { state: 'saved', revision: saved }; } } },
      './primitives.ts': {
        moreMenu(options: any) { menus.push(options); return { root: new Element('div'), trigger: new Element('button'), update(items: any[]) { options.items = items; }, dispose() {} }; },
        segmentedBar: () => new Element('div'), warningBadge: () => new Element('span'),
      },
      '@openchamber/sdk/ui': { mountButton(root: Element, o: any) { const b = new Element('button'); b.textContent = o.label; b.listeners.click = o.onClick; root.append(b); buttons.push(b); } },
    } as Record<string, unknown>)[path] ?? {},
  });
  const plan = parsePlansPage(JSON.stringify(plansPage([P1]))).data[0]!;
  const vc: any = { ctx: { features: { deviceStorage: true }, connection: { account: 'fixture' } }, identity: 'fixture', session: null, refreshSerial: 1,
    env: { locale, now: Date.now(), live: live.EMPTY_LIVE, boundSource: plan.sourceId, unverifiedSources: new Set(), view: { fresh: true, captureEnabled: true } }, live: live.EMPTY_LIVE,
    read: { storeId: 'store', binding: { sourceId: plan.sourceId, verified: true } },
    detail: () => null, summary: () => null, storage: {}, language: { preference: 'auto', supported: true }, reading: {}, setUi() {},
  };
  const shell = new exports.ProgressShell();
  const panel = new Element('div');
  const closed: string[] = [];
  const options = { board: true, renderPanel: () => panel, closePanel: (kind: string) => closed.push(kind) };
  const paint = (p: any = null) => { const root = new Element('div'); const opened = shell.paint(root, vc, p, options); return { root, opened }; };
  return { shell, vc, plan, menus, buttons, paint, options, panel, closed, checkpointReads, exports, window };
}
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
test('plan menu is shared with closed-plan cleanup and keeps destructive actions last', () => {
  const f = fixture();
  f.paint(f.plan);
  assert.equal(f.exports.offerPlanActions(f.vc.reading, f.plan, [
    { id: 'archive', label: 'Archive', run() {} }, { id: 'delete', label: 'Delete', destructive: true, run() {} },
  ]), true);
  const ids = f.menus.at(-1).items.filter((i: any) => !i.separator).map((i: any) => i.id);
  assert.deepEqual(Array.from(ids), ['history', 'sessions', 'archive', 'language', 'setup', 'troubleshooting', 'delete']);
});
test('history dot uses only an existing older device review point, never a digest read', async () => {
  for (const saved of [null, 1, P1.revision]) {
    const f = fixture('en', saved);
    f.paint(f.plan); await Promise.resolve(); f.paint(f.plan);
    assert.equal(f.checkpointReads.length, 1);
    assert.equal(f.menus.at(-1).label, saved === 1 ? 'More, new history' : 'More');
    f.vc.ctx.features.deviceStorage = false; f.paint(f.plan);
    assert.equal(f.menus.at(-1).label, 'More');
    assert.equal(f.checkpointReads.length, 1);
  }
});
test('panel state is frame-local and resets on plan or authority changes', () => {
  const f = fixture(); f.paint(f.plan); f.menus.at(-1).onSelect('sessions');
  assert.equal(f.paint(f.plan).opened, true);
  f.vc.identity = 'another-store';
  assert.equal(f.paint(f.plan).opened, false);
});
test('shell reconciliation retires another plan panel before view visibility is computed', () => {
  const f = fixture('ru'); f.paint(f.plan);
  const controls = f.exports.surfaceViewSwitch('list', () => {}, f.vc.env.locale, () => f.shell.openDocument(f.vc));
  assert.deepEqual(Array.from(controls.children, (node: Element) => node.querySelector('button')?.textContent), ['Карта', 'Список', 'Документ плана']);
  f.buttons.at(-1).listeners.click();
  f.shell.reconcile(f.vc, f.plan, f.options);
  assert.equal(f.shell.activePanel, 'document', 'a repaint of the same reading keeps its panel');
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
