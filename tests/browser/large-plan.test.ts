import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { graphItems } from '../../shared/plan-graph.ts';
import { deriveDependencies } from '../../ui/shared/dependency-derivation.ts';
import { largePlanSteps, LARGE_PLAN_SEED, LARGE_PLAN_VERSION } from '../fixtures/large-plan.ts';

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.freeze(value); for (const v of Object.values(value)) freeze(v); }
  return value;
}
function valid(items: Parameters<typeof deriveDependencies>[0]) {
  const result = deriveDependencies(items);
  assert.equal(result.state, 'valid');
  if (result.state !== 'valid') throw Error('Expected complete valid dependency input');
  return result;
}
const probes = ['T-00-00', 'T-10-24', 'T-19-48'];
function facts(result: ReturnType<typeof valid>) {
  return { depths: [...result.tasks].map(([id, t]) => [id, t.depth]), closures: probes.map(id => ({ id, upstream: result.upstream(id), downstream: result.downstream(id) })) };
}
function samples(run: () => unknown) {
  run(); const ms = Array.from({ length: 3 }, () => { const start = performance.now(); run(); return performance.now() - start; });
  const sorted = [...ms].sort((a, b) => a - b);
  return { samples: ms, median: sorted[1], min: sorted[0], max: sorted[2], unit: 'ms' };
}

test('large-plan: frozen complete inputs, actual derivation and replay semantics', () => {
  const steps = freeze(largePlanSteps()), initial = steps[0];
  const detail = freeze(initial.items), graph = freeze(graphItems(detail));
  const before = JSON.stringify({ detail, graph });
  const result = valid(graph), fromDetail = valid(detail);
  assert.deepEqual(facts(result), facts(fromDetail));
  assert.equal(result.tasks.size, 980);
  assert.equal([...result.tasks.keys()].some(id => id.startsWith('G-')), false);
  for (const [id, task] of result.tasks) {
    assert.equal(task.depth, Number(id.slice(2, 4))); assert.equal(task.incomplete, false);
  }
  for (const [id, group] of Object.entries({ 'T-00-00': 'ready', 'T-01-00': 'waiting', 'T-01-01': 'ready', 'T-01-02': 'skipped', 'T-01-03': 'blocked' })) assert.equal(result.tasks.get(id)?.group, group);
  assert.equal(result.tasks.get('T-04-00')?.prerequisites.length, 16);
  assert.equal(graph.filter(i => i.dependencies.includes('T-00-48')).length, 56);
  assert.equal(result.upstream('T-00-00')?.size, 0);
  assert.ok(result.downstream('T-00-00')?.has('T-19-00'));
  assert.equal(result.downstream('T-00-00')?.has('T-00-01'), false);
  assert.ok(result.upstream('T-10-24')?.has('T-09-24'));
  assert.ok(result.upstream('T-10-24')?.has('T-00-24'));
  assert.equal(result.upstream('T-10-24')?.has('T-19-48'), false);
  assert.equal(result.downstream('T-19-48')?.size, 0);
  assert.ok(result.upstream('T-19-48')?.has('T-18-48'));
  assert.ok(result.upstream('T-19-48')?.has('T-18-00'));
  for (const id of probes) for (const closure of [result.upstream(id), result.downstream(id)]) {
    assert.equal(closure?.has(id), false); assert.equal([...closure!].some(i => i.startsWith('G-')), false);
  }
  const checkpoints: unknown[] = [];
  for (let n = 0; n < steps.length; n++) {
    const step = steps[n], current = valid(step.items);
    assert.equal(current.tasks.size, step.id === 'S6' ? 979 : 980);
    if (n) {
      const previous = steps[n - 1], prior = valid(previous.items);
      if (step.class === 'status-only') assert.deepEqual(facts(current), facts(prior));
      if (step.id === 'S4') {
        assert.equal(step.structuralRevision, previous.structuralRevision + 1);
        assert.notEqual(step.title, previous.title);
        assert.deepEqual(graphItems(step.items), graphItems(previous.items));
        assert.deepEqual(facts(current), facts(prior));
      }
      for (const change of step.edgeChanges) {
        const oldEdges = previous.items.find(i => i.id === change.id)?.dependencies ?? [];
        const newEdges = step.items.find(i => i.id === change.id)?.dependencies ?? [];
        assert.deepEqual(oldEdges.filter(i => !newEdges.includes(i)), change.removed);
        assert.deepEqual(newEdges.filter(i => !oldEdges.includes(i)), change.added);
      }
      for (const change of step.parentChanges) {
        assert.equal(previous.items.find(i => i.id === change.id)?.parentId ?? null, change.from);
        assert.equal(step.items.find(i => i.id === change.id)?.parentId ?? null, change.to);
      }
    }
    if (step.id === 'S2') for (const id of ['T-01-00', 'T-01-02', 'T-01-03']) assert.equal(current.tasks.get(id)?.group, 'ready');
    if (step.id === 'S5') {
      assert.deepEqual(step.edgeChanges, [{ id: 'T-10-24', removed: ['T-09-25'], added: ['T-08-25'] }]);
      assert.deepEqual(step.parentChanges, [{ id: 'T-10-24', from: 'G-10', to: 'G-11' }]);
      assert.equal(current.tasks.get('T-10-24')?.depth, 10);
      assert.equal(current.upstream('T-10-24')?.has('T-09-25'), false);
    }
    if (step.id === 'S6') { assert.equal(current.tasks.has('T-19-48'), false); assert.equal(current.upstream('T-19-48'), null); }
    if (step.id === 'S7') assert.equal(current.tasks.get('T-19-48')?.status, 'pending');
    if (step.id === 'S8') assert.equal(current.tasks.get('T-19-48')?.status, 'working');
    checkpoints.push({ id: step.id, tasks: current.tasks.size, revision: step.revision, structuralRevision: step.structuralRevision, manifestMatched: true });
  }
  assert.equal(JSON.stringify({ detail, graph }), before);
  const preparation = samples(() => valid(graph));
  const closures = probes.map(id => ({ id, direction: id === 'T-00-00' ? 'downstream' : 'upstream', ...samples(() => id === 'T-00-00' ? result.downstream(id) : result.upstream(id)) }));
  if (process.env.EVIDENCE) {
    mkdirSync(process.env.EVIDENCE, { recursive: true });
    writeFileSync(`${process.env.EVIDENCE}/summary.json`, JSON.stringify({ format: LARGE_PLAN_VERSION, seed: LARGE_PLAN_SEED, runtime: process.version, checkpoint: 'S0', taskVertices: 980, groupVertices: 0, depthRange: [0, 19], fanIn: 16, hubDirectDependents: 56, frozenInputUnchanged: true, statusOnlyDepthAndSampledClosureInvariant: true, checkpoints, measurements: { interpretation: 'Pure core CPU only; no HTTP or paint; one warm-up and three samples; no latency gate', preparation, closures } }, null, 2) + '\n');
  }
});
