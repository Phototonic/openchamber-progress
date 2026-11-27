import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import type { GuestRequest, GuestRequestResult } from '@openchamber/sdk';
import ts from 'typescript';
import { LIMITS, type PlanActivityRow } from '../../shared/progress.ts';
import { EMPTY_LIVE } from '../../ui/shared/live.ts';
import type { ViewContext, ViewSpec } from '../../ui/shared/app.ts';
import type { PlanActivityView } from '../../ui/shared/model.ts';
import { readPlanActivity } from '../../ui/shared/source.ts';
import { appCountsModules } from './app-counts-stub.ts';
import { envelope, HEALTH, P1, setupRead } from './fixtures.ts';

const reply = (body: unknown, status = 200) => ({ body: JSON.stringify(body), status });
const binding = { ...envelope({}).sourceBinding };
const { storeId } = envelope({});
const time = '2026-04-22T00:00:00.000Z';
const source = P1.sourceId;
const report = (revision: number): PlanActivityRow => ({ revision, reportedAt: time, kind: 'report',
  mode: 'direct', reporterSessionId: 'M', attributedSessionId: 'M', itemIds: ['recorded-id'] });
const windowFor = (through: number, from = source, cleanupRev = 0) => ({
  protocolVersion: 2, schemaVersion: 2, planActivity: 1, storeId, sourceBinding: binding, source: from,
  plan: P1.id, cleanupRev, nextThrough: through > LIMITS.pageSize ? through - LIMITS.pageSize : null,
  rows: Array.from({ length: Math.min(LIMITS.pageSize, through) }, (_, i): PlanActivityRow => {
    const revision = through - i;
    // Revision 7 is a user cancellation; revision 9 is an agent's cancelled
    // outcome, which stays an ordinary report; revision 10 has no contribution.
    if (revision === 7 || revision === 10) return { revision, reportedAt: time, kind: revision === 7 ? 'user' : 'unavailable' };
    return report(revision);
  }),
});

test('the single activity read validates identity, ordering, continuation and attribution', async () => {
  const r = { storeId, source, binding, plan: P1.id, cleanupRev: 0, through: 10 };
  const w = windowFor(r.through);
  let wire = reply(w), requests = 0;
  const read = () => readPlanActivity({ async serviceRequest(q) {
    requests++;
    assert.deepEqual(q, { method: 'GET', path: '/v1/history', query: { source, plan: P1.id, through: '10' } });
    return wire;
  } }, r);
  const result = await read();
  assert.ok(result.ok);
  assert.deepEqual(result.rows.slice(0, 4), [w.rows[0], report(9), report(8), w.rows[3]]);
  assert.equal(result.rows[0].kind, 'unavailable');
  assert.equal(result.rows[3].kind, 'user');
  const faults = [{ source: 'other' }, { plan: 'other' }, { storeId: 'other' }, { cleanupRev: 1 },
    { sourceBinding: { ...binding, verified: !binding.verified } }, { nextThrough: 1 },
    { rows: w.rows.slice(1) }, { rows: [...w.rows].reverse() }, { rows: [{ ...w.rows[0], reporterSessionId: 'M' }, ...w.rows.slice(1)] },
    { rows: [w.rows[0], { ...w.rows[1], mode: 'parent-relay' }, ...w.rows.slice(2)] }];
  for (const fault of faults) {
    wire = reply({ ...w, ...fault });
    assert.deepEqual(await read(), { ok: false });
  }
  assert.equal(requests, faults.length + 1);
});

const app = new URL('../../ui/shared/app.ts', import.meta.url);
const appText = ts.transpileModule(readFileSync(app, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
async function settle() { await new Promise<void>(resolve => setImmediate(resolve)); }
type Ui = { selected: number; list: boolean };

/** Real frame controller and adapter, with only DOM and host transports stubbed. */
function frame() {
  const node = () => ({ dataset: {}, querySelector: () => null, querySelectorAll: () => [], replaceChildren() {}, append() {}, setAttribute() {} });
  const listeners: Record<string, (v?: any) => void> = {};
  const doc = { documentElement: node(), head: node(), body: node(), visibilityState: 'visible', activeElement: null,
    getElementById: () => node(), addEventListener: (name: string, fn: any) => { listeners[name] = fn; } };
  const other = 'other-source';
  let revision = 263, cleanupRev = 0, reads = 0;
  const calls: GuestRequest[] = [], completed: Array<(value: GuestRequestResult) => void> = [];
  const host = {
    serviceRequest(q: GuestRequest) {
      if (q.path === '/health') return Promise.resolve(reply(HEALTH));
      if (q.path === '/v1/setup') return Promise.resolve(reply(setupRead()));
      if (q.path === '/v1/plans') {
        reads++;
        const data = [{ ...P1, revision, cleanup: { state: 'visible', revision: cleanupRev } }, { ...P1, sourceId: other }];
        return Promise.resolve(reply({ ...envelope({ data: q.query?.archived === 'only' ? [] : data, nextCursor: null }),
          sources: [...envelope({}).sources, { id: other, verified: true }] }));
      }
      assert.equal(q.path, '/v1/history');
      calls.push(q);
      return new Promise<GuestRequestResult>(resolve => completed.push(resolve));
    },
    storage: { get: async () => undefined, set: async () => {}, delete: async () => {} },
    onItem() {}, onConnection() {},
    onReady: (fn: any) => { listeners.ready = fn; }, onSession() {}, onDirectory() {},
  };
  const modules = createRequire(app);
  const exports: { startView?: (spec: ViewSpec<Ui>) => void } = {};
  runInNewContext(appText, { exports, AbortController, document: doc, performance, console, queueMicrotask,
    window: { addEventListener: (name: string, fn: any) => { listeners[name] = fn; } },
    setTimeout: () => 1, clearTimeout() {},
    require(name: string) {
      if (name in appCountsModules) return appCountsModules[name];
      if (name === '@openchamber/sdk') return { connectHost: () => host };
      if (name === '@openchamber/sdk/ui') return { applyHostReady() {} };
      if (name === './phone-layout.ts') return { applyDeviceHooks() {} };
      if (name === './setup.ts') return { retireSetupSteps() {} };
      if (name === './components.ts') return { el: node, refreshLabels() {}, retireReadingUi() {}, beginInfoPaint() {}, commitInfoPaint() {} };
      if (name === './live.ts') return { LiveWorkspace: class { snapshot = EMPTY_LIVE; start() {} restart() {} want() {} dispose() {} } };
      return modules(name);
    },
  });
  let vc!: ViewContext<Ui>, view: PlanActivityView | null = null;
  exports.startView!({
    surface: 'page', maxSessionSubscriptions: 0, initialUi: () => ({ selected: 0, list: true }),
    scope: () => ({}), wantProjects: () => [], wantDetails: () => [],
    reading: c => { const p = c.read?.plans[c.ui.selected]; return p ? { plan: p.key, scope: 'fixture' } : null; },
    paint: (_root, c) => {
      vc = c;
      const p = c.read?.plans[c.ui.selected];
      view = c.ui.list && p ? c.planActivity(p) : null;
    },
  });
  return {
    get vc() { return vc; }, get view() { return view; }, get reads() { return reads; }, calls,
    append: () => { revision++; vc.retry(); },
    cleanupChanged: () => { cleanupRev++; vc.retry(); },
    select: (selected: number) => vc.setUi({ selected }),
    showList: (list: boolean) => vc.setUi({ list }),
    hide: () => { doc.visibilityState = 'hidden'; listeners.visibilitychange(); },
    show: () => { doc.visibilityState = 'visible'; listeners.visibilitychange(); },
    ready: () => listeners.ready({ session: null, directory: null, connection: { account: 'example' }, locale: 'en', surface: 'page' }),
    stop: () => listeners.pagehide(),
    release: (i: number, status = 200) => {
      const q = calls[i].query!;
      completed[i](status === 200 ? reply(windowFor(Number(q.through), q.source, cleanupRev)) : reply({ error: 'not-found' }, status));
    },
  };
}

test('one on-demand page, pinned across ordinary refresh, navigable back to revision one', async () => {
  const f = frame();
  try {
    f.ready(); await settle();
    assert.equal(f.view?.value.state, 'closed');
    assert.equal(f.calls.length, 0);
    const open = f.view!;
    open.act('open'); open.act('open'); open.act('older');
    await settle();
    assert.equal(f.view?.value.state, 'loading');
    assert.equal(f.calls.length, 1);
    f.release(0); await settle();
    const first = f.view!.value;
    assert.equal(first.state, 'ready');
    assert.deepEqual(first.rows.map(r => r.revision), Array.from({ length: 20 }, (_, i) => 263 - i));
    const before = f.reads;
    f.append(); await settle();
    assert.ok(f.reads > before);
    assert.equal(f.view?.value, first);
    assert.equal(f.calls.length, 1);
    let cursor = 263;
    while (cursor > 20) {
      cursor -= 20;
      f.view!.act('older');
      const i = f.calls.length - 1;
      assert.equal(f.calls[i].query?.through, String(cursor));
      f.release(i); await settle();
    }
    const oldest = f.view!.value;
    assert.ok(oldest.state === 'ready' && oldest.nextThrough === null && oldest.rows.at(-1)?.revision === 1);
    f.view!.act('newer'); f.release(f.calls.length - 1); await settle();
    assert.equal(f.calls.at(-1)?.query?.through, '23');
    f.view!.act('close'); await settle();
    f.view!.act('open');
    assert.equal(f.calls.at(-1)?.query?.through, '264');
  } finally { f.stop(); }
});

test('legacy error stays local; a closed, switched, hidden or cleanup-changed visit ignores held replies', async () => {
  const f = frame();
  try {
    f.ready(); await settle();
    f.view!.act('open'); f.release(0, 404); await settle();
    assert.equal(f.view?.value.state, 'failure');
    assert.equal(f.vc.read?.plans.length, 2);
    assert.equal(f.calls.length, 1);
    f.view!.act('retry'); await settle();
    f.select(1); await settle();
    f.release(1); await settle();
    assert.equal(f.view?.value.state, 'closed');
    for (const retire of [() => f.view!.act('close'), () => f.showList(false), () => f.hide(), () => f.cleanupChanged()]) {
      f.view!.act('open'); await settle();
      const i = f.calls.length - 1;
      retire(); await settle();
      f.release(i); await settle();
      f.showList(true); f.show();
      await settle();
      assert.equal(f.view?.value.state, 'closed');
    }
  } finally { f.stop(); }
});
