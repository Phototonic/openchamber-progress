import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import type { ViewContext, ViewSpec } from '../../ui/shared/app.ts';
import { EMPTY_LIVE } from '../../ui/shared/live.ts';
import type { PlanView } from '../../ui/shared/model.ts';
import * as scopeModule from '../../ui/shared/scope.ts';
import { automaticPlan, StatusSelection } from '../../ui/status/selection.ts';
import { parsePlansPage } from '../../ui/shared/adapter.ts';
import { at, plansPage, summary, S } from './fixtures.ts';

const [execution, acceptance] = parsePlansPage(JSON.stringify(plansPage([
  summary('execution', [{ id: 'task', kind: 'task', status: 'working', title: 'Implement feature' }], { title: 'Execution plan', reportedAt: at(10) }),
  summary('acceptance', [{ id: 'task', kind: 'task', status: 'pending', title: 'Verify feature' }], { title: 'Acceptance plan', reportedAt: at(1) }),
]))).data;
const scoped = (plans: PlanView[]) => scopeModule.contextScope(plans, S.M, '/fixture/Alpha');

// Capture the actual entry's controller contract without starting a DOM/host connection.
// Rendering and real picker events are covered by the current-bundle Chromium fixture.
type Ui = { selection: StatusSelection };
function statusSpec() {
  let spec!: ViewSpec<Ui>;
  const js = ts.transpileModule(readFileSync(new URL('../../ui/status/main.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  runInNewContext(js, { exports: {}, require: (name: string) => {
    if (name === '../shared/app.ts') return { RECENT_SCOPES: 8, startView: (value: ViewSpec<Ui>) => { spec = value; } };
    if (name === '../shared/scope.ts') return scopeModule;
    if (name === './selection.ts') return { StatusSelection };
    return {}; // rendering-only imports are deliberately not executed here
  } });
  return spec;
}

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
});
