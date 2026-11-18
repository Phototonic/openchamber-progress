// The large-library gate must judge idle polling against the refresh cadence, not against its own /health count.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const row = (count: number) => ({ count, bytes: count * 100 });
/**
 * One idle window per surface at the 3 s cadence. Per refresh the board reads one first page plus nine continuation
 * pages, one /v1/needs-you window and one /v1/plans?needsYou=1 window; the rail reads one page.
 */
interface Opt {
  page?: number; rail?: number; elapsed?: number; railElapsed?: number; pagesPerRefresh?: number; pageStarts?: number; railStarts?: number;
  railPlans?: number; firstWindow?: number; split?: boolean; before?: boolean;
}
function results(o: Opt = {}) {
  const page = o.page ?? 5, rail = o.rail ?? 5, split = o.split ?? true;
  const window = (surface: 'page' | 'panel', refreshes: number, elapsed: number, plans: number, starts: number, first: number) => ({
    surface, label: 'idle', elapsed, longTasks: { count: 0, total: o.before && surface === 'page' ? 5000 : 0, max: 0 }, frames: { p99: 16, max: 20 },
    traffic: {
      [`${surface} /health`]: row(refreshes), [`${surface} /v1/plans`]: row(plans), [`${surface} /v1/needs-you`]: row(refreshes), [`${surface} /v1/subagent-runs`]: row(refreshes),
    },
    ...(split ? { listStarts: { [surface]: starts }, inbox: { [surface]: { needsYouRoute: refreshes, plansFirstWindow: first } } } : {}),
  });
  const others = (surface: 'page' | 'panel') => ['drag', 'wheel-pan', 'selection', 'key-zoom'].map(label => ({
    surface, label, elapsed: 1000, longTasks: { count: 0, total: 0, max: 0 }, frames: { p99: 16, max: 20 }, traffic: {},
  }));
  return {
    measurements: [
      window('page', page, o.elapsed ?? 16000, page * (o.pagesPerRefresh ?? 10), o.pageStarts ?? page, page * (o.firstWindow ?? 1)),
      window('panel', rail, o.railElapsed ?? 16000, o.railPlans ?? rail, o.railStarts ?? rail, rail), ...others('page'), ...others('panel'),
    ],
    scrollbar: ['paused', 'inside', 'outside'].map(mode => ({ mode, distance: 100, same: true, reportArrived: true })),
    errors: [], search: { passed: true }, keyboard: { focusedListbox: true, activeOption: true },
    responsive: Array.from({ length: 5 }, () => ({ width: 1000, overflow: false, zeroBadges: false, filters: { open: true, overflow: false } })),
  };
}
/** Run the gate on a baseline and three candidate runs (one option set repeats for all three). */
function gate(after: Opt | [Opt, Opt, Opt], before: Opt = {}): { status: number | null; failed: string[]; error: string } {
  const scratch = mkdtempSync(join(tmpdir(), 'large-library-gate-'));
  try {
    const runs = Array.isArray(after) ? after : [after, after, after];
    const dirs = [{ ...before, before: true }, ...runs].map((o, i) => {
      const dir = join(scratch, String(i)); mkdirSync(dir); writeFileSync(join(dir, 'results.json'), JSON.stringify(results(o))); return dir;
    });
    const run = spawnSync(process.execPath, ['--experimental-strip-types', 'tests/browser/large-library-gate.ts', ...dirs], { encoding: 'utf8' });
    const report = run.stdout ? JSON.parse(run.stdout) : null;
    return { status: run.status, failed: (report?.rows ?? []).filter((r: any) => !r.pass).map((r: any) => r.name as string), error: run.stderr };
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}
const cadence = (failed: string[]) => failed.filter(n => n.startsWith('Idle cadence'));

test('unchanged idle polling passes, with or without the inbox form and list-start counters', () => {
  const run = gate({});
  assert.equal(run.status, 0, run.error);
  assert.deepEqual(run.failed, []);
  const legacy = gate({ split: false }, { split: false });
  assert.equal(legacy.status, 0, legacy.error);
});

test('uniformly doubled idle polling fails even though every route keeps its ratio to /health', () => {
  const run = gate({ page: 10, rail: 10 });
  assert.equal(run.status, 1);
  assert.equal(cadence(run.failed).length, 3, run.failed.join('\n'));
});

test('a window with no refreshes fails instead of passing on zero requests', () => {
  const run = gate({ page: 0, rail: 0 });
  assert.equal(run.status, 1);
  assert.equal(cadence(run.failed).length, 3, run.failed.join('\n'));
});

test('a healthy sixth boundary poll is not extra work per refresh', () => {
  const run = gate({ page: 6, rail: 6 });
  assert.equal(run.status, 0, `${run.error}${run.failed.join('\n')}`);
});

test('extra work per refresh still fails: more continuation pages, more inbox first windows', () => {
  assert.ok(gate({ pagesPerRefresh: 11 }).failed.includes('Idle /v1/plans requests/refresh'));
  assert.deepEqual(gate({ firstWindow: 3 }).failed, ['Idle inbox requests/refresh (/v1/needs-you + /v1/plans?needsYou=1)']);
});

test('each window is judged by its own elapsed time', () => {
  // 20 s holds six or seven ticks, so four replies is too few there although four is fine at 16 s.
  assert.equal(gate({ rail: 4, railStarts: 4 }).status, 0);
  const slow = gate({ rail: 4, railStarts: 4, railElapsed: 20000 });
  assert.equal(slow.status, 1);
  assert.equal(cadence(slow.failed).length, 3);
});

test('page and rail cadence are paired within each run', () => {
  const run = gate([{ page: 0, rail: 5 }, { page: 5, rail: 0 }, { page: 5, rail: 10 }]);
  assert.equal(run.status, 1);
  assert.equal(cadence(run.failed).length, 3, run.failed.join('\n'));
});

test('list starts, not total list pages, set the list cadence on both surfaces', () => {
  // Board: ten pages in one refresh and none in the other four. Rail: five polls but ten list starts.
  const board = gate({ pageStarts: 1 });
  assert.equal(board.status, 1);
  assert.equal(cadence(board.failed).length, 3);
  const rail = gate({ railStarts: 10, railPlans: 10 });
  assert.equal(rail.status, 1);
  assert.equal(cadence(rail.failed).length, 3);
});

test('one legacy candidate does not discard the inbox form split of the others', () => {
  const run = gate([{ firstWindow: 3 }, { firstWindow: 3 }, { split: false }]);
  assert.equal(run.status, 1);
  assert.deepEqual(run.failed.filter(n => n.startsWith('Idle inbox')), ['Idle inbox requests/refresh (/v1/needs-you + /v1/plans?needsYou=1)']);
});

test('a baseline without list starts or the split still compares, and names the fallback', () => {
  const run = gate({}, { split: false });
  assert.equal(run.status, 0, run.error);
  const doubled = gate({ page: 10, rail: 10 }, { split: false });
  assert.equal(doubled.status, 1);
});
