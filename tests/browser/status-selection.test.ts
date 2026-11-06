import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import type { ViewContext, ViewSpec } from '../../ui/shared/app.ts';
import * as liveModule from '../../ui/shared/live.ts';
const { EMPTY_LIVE } = liveModule;
import type { PlanView } from '../../ui/shared/model.ts';
import * as scopeModule from '../../ui/shared/scope.ts';
import { automaticPlan, StatusSelection } from '../../ui/status/selection.ts';
import { parsePlansPage } from '../../ui/shared/adapter.ts';
import { at, plansPage, summary, S } from './fixtures.ts';
import { HeightSync } from '../../ui/shared/height.ts';

const [execution, acceptance] = parsePlansPage(JSON.stringify(plansPage([
  summary('execution', [{ id: 'task', kind: 'task', status: 'working', title: 'Implement feature' }], { title: 'Execution plan', reportedAt: at(10) }),
  summary('acceptance', [{ id: 'task', kind: 'task', status: 'pending', title: 'Verify feature' }], { title: 'Acceptance plan', reportedAt: at(1) }),
]))).data;
const scoped = (plans: PlanView[]) => scopeModule.contextScope(plans, S.M, '/fixture/Alpha');

// Capture the actual entry's controller contract without starting a DOM/host connection.
// Rendering and real picker events are covered by the current-bundle Chromium fixture.
type Ui = { selection: StatusSelection };
function statusSpec(globals: Record<string, unknown> = {}, heightModule: object = {}) {
  let spec!: ViewSpec<Ui>;
  const js = ts.transpileModule(readFileSync(new URL('../../ui/status/main.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  runInNewContext(js, { ...globals, exports: {}, require: (name: string) => {
    if (name === '../shared/app.ts') return { RECENT_SCOPES: 8, startView: (value: ViewSpec<Ui>) => { spec = value; } };
    if (name === '../shared/scope.ts') return scopeModule;
    if (name === '../shared/live.ts') return liveModule;
    if (name === './selection.ts') return { StatusSelection };
    if (name === '../shared/height.ts') return heightModule;
    return {}; // rendering-only imports are deliberately not executed here
  } });
  return spec;
}

test('actual Status height: each disclosure layout requests once; repaints and retirement cannot leak listeners', () => {
  const page = new EventTarget(), document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  const jobs: { fn: () => void; live: boolean }[] = [], sent: number[] = [];
  let frame = 24;
  const spec = statusSpec({ document, innerHeight: frame, addEventListener: page.addEventListener.bind(page) }, {
    HeightSync: class extends HeightSync {
      constructor(host: ConstructorParameters<typeof HeightSync>[0]) { super({ ...host, actual: () => frame }); }
    },
    afterAnimationFrames: (_n: number, fn: () => void) => { const j = { fn, live: true }; jobs.push(j); return () => { j.live = false; }; },
  });
  const vc = { host: { setHeight: async (h: number) => { sent.push(h); frame = h; } } } as ViewContext<Ui>;
  const root = () => Object.assign(new EventTarget(), { isConnected: true, height: 200, getBoundingClientRect() { return { height: this.height }; } });
  let previous = root();
  for (let i = 0; i < 5; i++) {
    previous.isConnected = false;
    const current = root();
    spec.afterPaint!(current as unknown as HTMLElement, vc);
    const start = sent.length;
    current.dispatchEvent(new Event('toggle')); // restored open state, already measured by paint
    assert.equal(sent.length, start);
    current.height = 340;
    current.dispatchEvent(new Event('toggle'));
    assert.deepEqual(sent.slice(start), [340]);
    previous.height = 500; previous.dispatchEvent(new Event('toggle'));
    assert.equal(sent.length, start + 1, 'detached prior root cannot send');
    previous = current;
  }
  page.dispatchEvent(new Event('pagehide'));
  const count = sent.length;
  previous.height = 400; previous.dispatchEvent(new Event('toggle'));
  for (const job of jobs) job.fn(); // even delivery after cancellation cannot send
  assert.equal(sent.length, count);
  assert.equal(jobs.filter(j => j.live).length, 0);
});

test('actual Work Status loads older explicit working plan, not the newer pending plan', () => {
  const spec = statusSpec();
  const vc = { ctx: { connection: { account: 'synthetic' } }, identity: 'store|source|true', read: { plans: [acceptance, execution] }, session: { id: S.M, busy: false }, directory: execution.directory, ui: spec.initialUi() } as ViewContext<Ui>;
  assert.equal(spec.wantDetails(vc)[0].key, execution.key);
  const scope = scoped([execution, acceptance]);
  assert.notEqual(scope.kind, 'none');
  if (scope.kind !== 'none') assert.equal(scopeModule.pickPlan(scope.plans, null)?.key, acceptance.key, 'rail fallback is unchanged');
});

test('Automatic uses latest working report and stable key tie, never completion counts or live activity', () => {
  const newer = { ...execution, id: 'newer', key: 'src-local/newer', reportedAt: at(2) };
  const tie = { ...newer, id: 'a', key: 'src-local/a' };
  const finished = { ...acceptance, lifecycle: 'completed' as const, working: ['old-task'] };
  assert.equal(automaticPlan(scoped([finished, execution, newer]))?.key, newer.key);
  assert.equal(automaticPlan(scoped([newer, tie, execution]))?.key, tie.key);
  assert.equal(execution.lifecycle, 'active');
});

test('Automatic preserves existing pending/blocked and terminal fallback, empty and unscoped states', () => {
  const pending = { ...execution, working: [] };
  assert.equal(automaticPlan(scoped([pending, acceptance]))?.key, acceptance.key);
  const terminal = { ...acceptance, lifecycle: 'cancelled' as const };
  assert.equal(automaticPlan(scoped([terminal, pending]))?.key, pending.key);
  assert.equal(automaticPlan(scoped([{ ...pending, lifecycle: 'completed' }, terminal]))?.key, terminal.key);
  assert.equal(automaticPlan(scoped([])), null);
  assert.equal(automaticPlan({ kind: 'none' }), null);
});

test('manual pending/finished choice stays through reports and new working plans; Automatic restores priority', () => {
  const selection = new StatusSelection();
  const generation = selection.enter('account|store|source|true', S.M, execution.directory);
  selection.choose(generation, acceptance.key);
  const newest = { ...execution, key: 'src-local/newest', reportedAt: at(0) };
  assert.equal(selection.resolve(scoped([newest, execution, acceptance])).plan?.key, acceptance.key);
  assert.equal(selection.resolve(scoped([newest, { ...acceptance, lifecycle: 'completed' }])).plan?.lifecycle, 'completed');
  selection.choose(generation, null);
  assert.equal(selection.resolve(scoped([newest, acceptance])).plan?.key, newest.key);
  assert.equal(selection.resolve(scoped([newest, acceptance])).selected, null);
});

test('removed manual choice becomes Automatic and cannot resurrect when the plan returns', () => {
  const selection = new StatusSelection();
  selection.choose(selection.enter('authority', S.M, execution.directory), acceptance.key);
  assert.equal(selection.resolve(scoped([execution])).selected, null);
  assert.equal(selection.resolve(scoped([acceptance, execution])).plan?.key, execution.key);
});

test('choices follow session across moves and clear on authority change; retired picker cannot select', () => {
  const selection = new StatusSelection();
  const original = selection.enter('store|source|true', S.M, execution.directory);
  selection.choose(original, acceptance.key);
  selection.enter('store|source|true', S.U, execution.directory);
  assert.equal(selection.resolve(scoped([execution, acceptance])).selected, null);
  assert.equal(selection.choose(original, acceptance.key), false);
  selection.enter('store|source|true', S.M, '/fixture/Beta');
  assert.equal(selection.resolve(scoped([execution, acceptance])).selected, acceptance.key);
  selection.enter('store|source|true', S.M, execution.directory);
  assert.equal(selection.resolve(scoped([execution, acceptance])).selected, acceptance.key);
  selection.enter('store|source|false', S.M, execution.directory);
  assert.equal(selection.resolve(scoped([execution, acceptance])).selected, null);
  selection.enter('store|other-source|true', S.M, execution.directory);
  selection.enter('store|source|true', S.M, execution.directory);
  assert.equal(selection.resolve(scoped([execution, acceptance])).selected, null);
});

test('returning from no session restores only the manual plan, never an old picker generation', () => {
  const selection = new StatusSelection();
  const old = selection.enter('account|store|source|true', S.M, execution.directory);
  selection.choose(old, acceptance.key);
  selection.enter('account|store|source|true', null, execution.directory);
  const returned = selection.enter('account|store|source|true', S.M, '/fixture/Moved');
  assert.notEqual(returned, old);
  assert.equal(selection.resolve(scoped([execution, acceptance])).selected, acceptance.key);
  assert.equal(selection.choose(old, execution.key), false);
  assert.equal(selection.enter('account|store|source|true', S.M, '/fixture/Enriched'), returned);
  assert.equal(selection.resolve(scoped([execution, acceptance])).selected, acceptance.key);
});

test('equal plan IDs across sources and authority changes cannot transfer a manual choice or late callback', () => {
  const selection = new StatusSelection();
  const other = { ...execution, sourceId: 'source-other', key: `source-other/${execution.id}`, working: [] };
  const generation = selection.enter('account-A|store-A|source|true', S.M, execution.directory);
  selection.choose(generation, other.key);
  assert.equal(selection.resolve(scoped([execution, other])).plan, other);
  selection.enter('account-B|store-B|source|true', S.M, execution.directory);
  assert.equal(selection.resolve(scoped([execution, other])).selected, null);
  assert.equal(selection.resolve(scoped([execution, other])).plan, execution);
  assert.equal(selection.choose(generation, other.key), false);
});

test('actual Work Status details and first project enrichment follow a manual fourth plan within the existing cap', () => {
  const spec = statusSpec();
  const projects = ['a', 'b', 'c', 'd'].map((id) => ({ id, name: id, directory: `/synthetic/${id}` }));
  const plans = projects.map((p, i) => ({ ...acceptance, key: `src-local/${p.id}`, id: p.id, directory: p.directory, reportedAt: at(i) }));
  const vc = { ctx: { connection: { account: 'synthetic' } }, identity: 'authority', read: { plans }, session: { id: S.M }, directory: '/synthetic', live: { ...EMPTY_LIVE, projectsState: 'ready', projects }, ui: spec.initialUi() } as ViewContext<Ui>;
  spec.onContext!(vc);
  const generation = vc.ui.selection.enter(JSON.stringify(['synthetic', 'authority']), S.M, vc.directory);
  vc.ui.selection.choose(generation, plans[3].key);
  assert.equal(spec.wantDetails(vc)[0].key, plans[3].key);
  assert.equal(spec.wantProjects(vc)[0], projects[3].id);
  assert.equal(spec.maxSessionSubscriptions, 2);
  // Sub-agents: the selected session's own project leads, even when it reported no plan there.
  const own = { ...vc, read: { plans: [] }, directory: projects[1].directory } as unknown as ViewContext<Ui>;
  assert.deepEqual([...spec.wantProjects(own)], [projects[1].id]);
});
