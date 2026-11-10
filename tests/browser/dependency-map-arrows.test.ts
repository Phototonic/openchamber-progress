// Dependency-map arrow state: pure classification, picture eligibility, motion permission, the
// rendering-cost bounds and the waiting-inspector sentence (docs/ui.md, Dependency map › Arrows).
// Rendered behaviour (beads, bar, phase, fallback in the browser) is in dependency-map-final-qa.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveDependencies } from '../../ui/shared/dependency-derivation.ts';
import {
  arrowCue, arrowCuesEligible, arrowFlowCount, arrowMotionFallback, mapMotionPermitted, MAP_MOTION_LIMITS,
  prerequisiteCounts, prerequisiteStates, readinessText,
} from '../../ui/shared/dependency-map-view.ts';

type Status = 'pending' | 'working' | 'blocked' | 'done' | 'skipped';
const STATUSES: Status[] = ['pending', 'working', 'blocked', 'done', 'skipped'];

test('arrow cue: the reviewed prerequisite × dependent table, by reported endpoint status only', () => {
  // Rows: prerequisite; columns: dependent (pending, working, blocked, done, skipped).
  const table: Record<Status, (string | null)[]> = {
    pending: [null, null, null, null, null],
    working: ['working', null, 'working', null, null],
    blocked: ['blocked', 'blocked', 'blocked', null, null],
    done: [null, null, null, null, null],
    skipped: [null, null, null, null, null],
  };
  for (const from of STATUSES) for (const [n, to] of STATUSES.entries()) assert.equal(arrowCue(from, to), table[from][n], `${from} → ${to}`);
  assert.equal(arrowCue(undefined, 'pending'), null);
  assert.equal(arrowCue('working', undefined), null);
});

test('arrow cue: direction matters (a pending prerequisite of a working task is never a flow)', () => {
  assert.equal(arrowCue('working', 'pending'), 'working');
  assert.equal(arrowCue('pending', 'working'), null);
  assert.equal(arrowCue('blocked', 'pending'), 'blocked');
  assert.equal(arrowCue('pending', 'blocked'), null);
});

test('eligible pictures: active, unarchived, current and ready only', () => {
  const ready = { state: 'ready' as const, current: true };
  assert.equal(arrowCuesEligible({ lifecycle: 'active' }, ready), true);
  assert.equal(arrowCuesEligible({ lifecycle: 'active', cleanup: { state: 'visible', revision: 2 } }, ready), true);
  for (const lifecycle of ['completed', 'cancelled', 'failed'] as const) assert.equal(arrowCuesEligible({ lifecycle }, ready), false, lifecycle);
  assert.equal(arrowCuesEligible({ lifecycle: 'active', cleanup: { state: 'archived', revision: 1 } }, ready), false, 'archived with an active lifecycle');
  // Read failure / superseded / still matching: the retained picture loses every new cue.
  for (const state of ['error', 'updating', 'loading', 'unavailable', 'not-found'] as const) assert.equal(arrowCuesEligible({ lifecycle: 'active' }, { state, current: false }), false, state);
  assert.equal(arrowCuesEligible({ lifecycle: 'active' }, { state: 'ready', current: false }), false, 'stale emphasis on a non-current ready picture');
});

const picture = (opts: { lifecycle?: 'active' | 'completed'; archived?: boolean; statuses?: Status[] } = {}) => ({
  state: 'ready' as const, current: true,
  picture: { detail: { plan: { lifecycle: opts.lifecycle ?? 'active', ...(opts.archived ? { cleanup: { state: 'archived' as const, revision: 1 } } : {}) }, detail: { items: (opts.statuses ?? ['working', 'pending']).map((status, n) => ({ id: `T${n}`, kind: 'task' as const, status })) } } },
}) as unknown as Parameters<typeof mapMotionPermitted>[0];
const fresh = { fresh: true, captureEnabled: true };

test('motion permission: affirmative only with every non-cost gate; defaults off', () => {
  assert.equal(mapMotionPermitted(picture(), fresh, true, true), true);
  assert.equal(mapMotionPermitted(picture(), fresh, false, true), false, 'Map not shown');
  assert.equal(mapMotionPermitted(picture(), fresh, true, false), false, 'hidden frame');
  assert.equal(mapMotionPermitted(picture(), { fresh: false, captureEnabled: true }, true, true), false, 'latest read not successful');
  assert.equal(mapMotionPermitted(picture(), { fresh: true, captureEnabled: false }, true, true), false, 'capture off');
  assert.equal(mapMotionPermitted(picture({ statuses: ['blocked', 'pending'] }), fresh, true, true), false, 'nothing reported working');
  assert.equal(mapMotionPermitted(picture({ lifecycle: 'completed' }), fresh, true, true), false, 'closed plan');
  assert.equal(mapMotionPermitted(picture({ archived: true }), fresh, true, true), false, 'archived plan');
  assert.equal(mapMotionPermitted({ ...picture(), current: false, state: 'updating' } as Parameters<typeof mapMotionPermitted>[0], fresh, true, true), false, 'superseded picture');
  assert.equal(mapMotionPermitted({ state: 'loading', current: false, picture: null }, fresh, true, true), false, 'no picture');
});

test('cost bounds: shipped limits stay inside the contract and are inclusive at the boundary', () => {
  assert.ok(MAP_MOTION_LIMITS.arrows <= 300 && MAP_MOTION_LIMITS.flows <= 24 && MAP_MOTION_LIMITS.zoom >= 0.5, JSON.stringify(MAP_MOTION_LIMITS));
  // The reference mid-size plan (100 tasks, 180 arrows, 12 eligible flows) at 75% must still animate.
  assert.equal(arrowMotionFallback({ arrows: 180, flows: 12, zoom: 0.75 }), null);
  const { arrows, flows, zoom } = MAP_MOTION_LIMITS;
  assert.equal(arrowMotionFallback({ arrows, flows, zoom }), null, 'at every limit');
  assert.equal(arrowMotionFallback({ arrows: arrows - 1, flows: flows - 1, zoom: zoom + 0.01 }), null, 'below every limit');
  assert.equal(arrowMotionFallback({ arrows: arrows + 1, flows, zoom }), 'arrows');
  assert.equal(arrowMotionFallback({ arrows, flows: flows + 1, zoom }), 'flows');
  assert.equal(arrowMotionFallback({ arrows, flows, zoom: zoom - 0.001 }), 'zoom');
  assert.equal(arrowMotionFallback({ arrows, flows, zoom: Number.NaN }), 'zoom', 'unknown zoom never moves');
  // The outer bounds hold for any tighter choice too.
  assert.equal(arrowMotionFallback({ arrows: 301, flows: 1, zoom: 1 }, { arrows: 300, flows: 24, zoom: 0.5 }), 'arrows');
  assert.equal(arrowMotionFallback({ arrows: 10, flows: 25, zoom: 1 }, { arrows: 300, flows: 24, zoom: 0.5 }), 'flows');
  assert.equal(arrowMotionFallback({ arrows: 10, flows: 1, zoom: 0.49 }, { arrows: 300, flows: 24, zoom: 0.5 }), 'zoom');
});

test('flow count: visible endpoints and the selection chain only; filters cannot bypass the full-plan arrow ceiling', () => {
  const status: Record<string, Status> = { W1: 'working', W2: 'working', P1: 'pending', P2: 'pending', B: 'blocked', K: 'working', D: 'done' };
  const edges = [['W1', 'P1'], ['W1', 'B'], ['W2', 'P2'], ['W1', 'K'], ['B', 'P2'], ['W2', 'D']] as const;
  const all = () => true;
  assert.equal(arrowFlowCount(edges, id => status[id], all, null), 3, 'working → pending/blocked only');
  assert.equal(arrowFlowCount(edges, id => status[id], id => id !== 'P2', null), 2, 'a hidden endpoint removes the flow');
  assert.equal(arrowFlowCount(edges, id => status[id], all, (a, z) => a === 'W1' && z === 'P1'), 1, 'chain only while selected');
  // A filtered view still reports the FULL plan's arrows to the bound: here 301 recorded arrows, 1 visible flow.
  const many = Array.from({ length: 301 }, (_, n) => [`X${n}`, `Y${n}`] as const);
  const visibleFlows = arrowFlowCount([['W1', 'P1']], id => status[id], all, null);
  assert.equal(arrowMotionFallback({ arrows: [...many].length, flows: visibleFlows, zoom: 1 }), 'arrows');
});

// Waiting-task inspector sentence.
const titles = (id: string) => `Task ${id}`;
const item = (id: string, status: Status = 'pending') => ({ id, title: titles(id), kind: 'task' as const, status }) as unknown as Parameters<typeof readinessText>[0];
function facts(items: { id: string; status: Status; dependencies?: string[] }[]) {
  const d = deriveDependencies(items.map(i => ({ ...i, kind: 'task' as const })));
  assert.equal(d.state, 'valid');
  return d.state === 'valid' ? d.tasks : new Map();
}

test('waiting summary: unfinished direct prerequisites with nonzero working/blocked parts', () => {
  const f = facts([{ id: 'A', status: 'working' }, { id: 'B', status: 'blocked' }, { id: 'C', status: 'pending' }, { id: 'X', status: 'done' }, { id: 'T', status: 'pending', dependencies: ['A', 'B', 'C', 'X'] }]);
  assert.equal(readinessText(item('T'), f.get('T'), true, true, titles, true), 'Waiting on 3 unfinished recorded prerequisites: 1 reported working, 1 explicitly blocked.');
  // Without arrow-state eligibility (e.g. an archived plan) the sentence stays as it was.
  assert.equal(readinessText(item('T'), f.get('T'), true, true, titles, false), 'Waiting on 3 unfinished recorded prerequisites.');
});

test('waiting summary: each direct prerequisite once, zero parts omitted, singular wording, no transitive or group relationships', () => {
  const f = facts([{ id: 'R', status: 'working' }, { id: 'A', status: 'working', dependencies: ['R'] }, { id: 'T', status: 'pending', dependencies: ['A', 'A'] }]);
  assert.deepEqual(prerequisiteCounts(f.get('T')), { unfinished: 1, working: 1, blocked: 0 });
  assert.equal(readinessText(item('T'), f.get('T'), true, true, titles, true), 'Waiting on 1 unfinished recorded prerequisite: 1 reported working.');
  const g = deriveDependencies([{ id: 'G', kind: 'group', status: 'pending' }, { id: 'B', kind: 'task', status: 'blocked' }, { id: 'T', kind: 'task', status: 'pending', dependencies: ['G', 'B'] }]);
  assert.equal(g.state, 'valid');
  if (g.state === 'valid') assert.deepEqual(prerequisiteCounts(g.tasks.get('T')), { unfinished: 2, working: 0, blocked: 1 }, 'a group prerequisite is unfinished but never working/blocked');
  assert.equal(prerequisiteStates({ working: 0, blocked: 0 }), '');
  assert.equal(prerequisiteStates({ working: 2, blocked: 0 }), '2 reported working');
  const none = facts([{ id: 'P', status: 'pending' }, { id: 'T', status: 'pending', dependencies: ['P'] }]);
  assert.equal(readinessText(item('T'), none.get('T'), true, true, titles, true), 'Waiting on 1 unfinished recorded prerequisite.');
});

test('waiting summary: the skipped warning stays and the summary joins it', () => {
  const f = facts([{ id: 'S', status: 'skipped' }, { id: 'W', status: 'working' }, { id: 'T', status: 'pending', dependencies: ['S', 'W'] }]);
  assert.equal(readinessText(item('T'), f.get('T'), true, true, titles, true), 'Waiting: a recorded prerequisite was skipped (Task S), and skipped work never counts as done. Its unfinished recorded prerequisites include 1 reported working.');
  const only = facts([{ id: 'S', status: 'skipped' }, { id: 'T', status: 'pending', dependencies: ['S'] }]);
  assert.equal(readinessText(item('T'), only.get('T'), true, true, titles, true), 'Waiting: a recorded prerequisite was skipped (Task S), and skipped work never counts as done.');
});

test('waiting summary: nothing new without current guidance or on a closed plan', () => {
  const f = facts([{ id: 'A', status: 'working' }, { id: 'T', status: 'pending', dependencies: ['A'] }]);
  assert.equal(readinessText(item('T'), f.get('T'), false, true, titles, false), 'Reported pending. Readiness is hidden until the current revision is matched.');
  assert.equal(readinessText(item('T'), f.get('T'), false, false, titles, false), 'Reported pending when the plan closed.');
  assert.equal(readinessText(item('T', 'blocked'), f.get('T'), true, true, titles, true), '');
});
