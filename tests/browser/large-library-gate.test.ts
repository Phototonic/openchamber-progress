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
 * pages, one /v1/needs-you window and one /v1/plans?needsYou=1 window; the rail reads one page. The driver's complete
 * refreshes are the ones a later first page closed, so one fewer than the list starts in the window.
 */
interface Opt {
  page?: number; rail?: number; elapsed?: number; railElapsed?: number; pagesPerRefresh?: number; pageStarts?: number; railStarts?: number;
  railPlans?: number; firstWindow?: number; split?: boolean; before?: boolean;
  /** Wall-clock /v1/plans replies on the board, and the plan pages the driver attributed to its complete refreshes. */
  pagePlans?: number; completePlans?: number;
}
function results(o: Opt = {}) {
  const page = o.page ?? 5, rail = o.rail ?? 5, split = o.split ?? true;
  const window = (surface: 'page' | 'panel', refreshes: number, elapsed: number, plans: number, starts: number, first: number, completePlans: number) => ({
    surface, label: 'idle', elapsed, longTasks: { count: 0, total: o.before && surface === 'page' ? 5000 : 0, max: 0 }, frames: { p99: 16, max: 20 },
    traffic: {
      [`${surface} /health`]: row(refreshes), [`${surface} /v1/plans`]: row(plans), [`${surface} /v1/needs-you`]: row(refreshes), [`${surface} /v1/subagent-runs`]: row(refreshes),
    },
    ...(split ? {
      listStarts: { [surface]: starts },
      complete: { [surface]: { refreshes: Math.max(0, starts - 1), traffic: { '/v1/plans': completePlans, '/v1/needs-you': Math.max(0, starts - 1), '/v1/subagent-runs': Math.max(0, starts - 1) }, inbox: { needsYouRoute: Math.max(0, starts - 1), plansFirstWindow: Math.round(first * Math.max(0, starts - 1) / Math.max(1, refreshes)) } } },
    } : {}),
  });
  const others = (surface: 'page' | 'panel') => ['drag', 'wheel-pan', 'selection', 'key-zoom'].map(label => ({
    surface, label, elapsed: 1000, longTasks: { count: 0, total: 0, max: 0 }, frames: { p99: 16, max: 20 }, traffic: {},
  }));
  return {
    measurements: [
      window('page', page, o.elapsed ?? 16000, o.pagePlans ?? page * (o.pagesPerRefresh ?? 10), o.pageStarts ?? page, page * (o.firstWindow ?? 1),
        o.completePlans ?? Math.max(0, (o.pageStarts ?? page) - 1) * (o.pagesPerRefresh ?? 10)),
      window('panel', rail, o.railElapsed ?? 16000, o.railPlans ?? rail, o.railStarts ?? rail, rail, Math.max(0, (o.railStarts ?? rail) - 1)),
      ...others('page'), ...others('panel'),
    ],
    scrollbar: ['paused', 'inside', 'outside'].map(mode => ({ mode, distance: 100, same: true, reportArrived: true })),
    errors: [], search: { passed: true }, keyboard: { focusedListbox: true, activeOption: true },
    responsive: Array.from({ length: 5 }, () => ({ width: 1000, overflow: false, zeroBadges: false, filters: { open: true, overflow: false } })),
  };
}
/** Run the gate on a baseline and three candidate runs (one option set repeats for all three). */
function gate(after: Opt | [Opt, Opt, Opt], before: Opt = {}): { status: number | null; failed: string[]; info: string[]; error: string } {
  const scratch = mkdtempSync(join(tmpdir(), 'large-library-gate-'));
  try {
    const runs = Array.isArray(after) ? after : [after, after, after];
    const dirs = [{ ...before, before: true }, ...runs].map((o, i) => {
      const dir = join(scratch, String(i)); mkdirSync(dir); writeFileSync(join(dir, 'results.json'), JSON.stringify(results(o))); return dir;
    });
    const run = spawnSync(process.execPath, ['--experimental-strip-types', 'tests/browser/large-library-gate.ts', ...dirs], { encoding: 'utf8' });
    const report = run.stdout ? JSON.parse(run.stdout) : null;
    const rows: { name: string; pass: boolean; budget: string }[] = report?.rows ?? [];
    return { status: run.status, failed: rows.filter(r => !r.pass).map(r => r.name), info: rows.filter(r => r.budget === 'informational').map(r => r.name), error: run.stderr };
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

test('a refresh split by the window edge counts on neither side of the traffic ratio', () => {
  // 49 board pages over 4 list starts (a refresh's first page fell just before the window): healthy, 10 pages per complete refresh.
  const edge = gate({ pageStarts: 4, pagePlans: 49 });
  assert.equal(edge.status, 0, `${edge.error}${edge.failed.join('\n')}`);
  // 50 pages over 5 starts looks healthy by wall clock, yet the complete refreshes carried 11 pages each.
  const hidden = gate({ completePlans: 44 });
  assert.equal(hidden.status, 1);
  assert.deepEqual(hidden.failed, ['Idle /v1/plans requests/refresh']);
});

test('a legacy baseline still compares, and the report says its denominator fell back to /health', () => {
  const run = gate({}, { split: false });
  assert.equal(run.status, 0, run.error);
  assert.ok(run.info.includes('Baseline traffic per refresh uses its /health count (complete-refresh attribution not recorded)'), run.info.join('\n'));
  assert.ok(run.info.every(n => !/^Candidate traffic/.test(n)));
  const doubled = gate({ page: 10, rail: 10 }, { split: false });
  assert.equal(doubled.status, 1);
  // A candidate without the attribution is reported too.
  const legacy = gate([{}, {}, { split: false }]);
  assert.ok(legacy.info.some(n => /^Candidate traffic per refresh without complete-refresh attribution: run 3 \(\/health count\)/.test(n)), legacy.info.join('\n'));
});
