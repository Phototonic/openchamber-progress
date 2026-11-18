// The large-library gate must judge idle polling against the refresh cadence, not against its own /health count, and must say
// when it cannot compare a budget instead of passing it.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const row = (count: number) => ({ count, bytes: count * 100 });
/**
 * How the artifact was written. `current` has the attribution method, the request-log counts, run reads, the wall-clock inbox
 * split and the complete refreshes. `unlabelled` has the same figures without the method (a driver that bucketed replies).
 * `older` has list starts and a wall-clock inbox split counted from replies, no complete refreshes. `oldest` has reply counts only.
 */
type Format = 'current' | 'unlabelled' | 'older' | 'oldest';
/**
 * One idle window per surface at the 3 s cadence. Per refresh the board reads one first page plus nine continuation pages,
 * one /v1/needs-you window and one /v1/plans?needsYou=1 window (carried by the first page); the rail reads one page. The
 * driver's complete refreshes are the ones a later first page closed, so one fewer than the list starts in the window.
 */
interface Opt {
  page?: number; rail?: number; elapsed?: number; railElapsed?: number; pagesPerRefresh?: number; pageStarts?: number; railStarts?: number;
  railPlans?: number; firstWindow?: number; before?: boolean; format?: Format;
  /** Plan pages sent on the board inside the window, and the plan pages attributed to its complete refreshes. */
  pagePlans?: number; completePlans?: number;
  /** The inbox windows attributed to the complete refreshes (a window opened by the last, still open refresh is not among them). */
  completeInbox?: { needsYouRoute: number; plansFirstWindow: number };
  /** Standalone /v1/needs-you requests and list-carried inbox windows sent on the board inside the window. */
  standalone?: number; bundled?: number;
  /** /health and run reads sent on the board inside the window. */
  health?: number; runReads?: number;
}
function results(o: Opt = {}) {
  const page = o.page ?? 5, rail = o.rail ?? 5, format = o.format ?? 'current';
  const window = (surface: 'page' | 'panel', elapsed: number, plans: number, starts: number, bundled: number, standalone: number, completePlans: number, health: number, runs: number) => {
    const refreshes = Math.max(0, starts - 1);
    const counts = { '/health': health, '/v1/plans': plans, '/v1/needs-you': standalone, '/v1/subagent-runs': runs };
    return {
      surface, label: 'idle', elapsed, longTasks: { count: 0, total: o.before && surface === 'page' ? 5000 : 0, max: 0 }, frames: { p99: 16, max: 20 },
      traffic: Object.fromEntries(Object.entries(counts).map(([route, n]) => [`${surface} ${route}`, row(n)])),
      ...(format === 'current' || format === 'unlabelled' ? {
        ...(format === 'current' ? { attribution: 'request-order' } : {}),
        sent: Object.fromEntries(Object.entries(counts).map(([route, n]) => [`${surface} ${route}`, n])),
        listStarts: { [surface]: starts }, runReads: { [surface]: runs },
        inbox: { [surface]: { needsYouRoute: standalone, plansFirstWindow: bundled } },
        complete: { [surface]: { refreshes, traffic: { '/v1/plans': completePlans, '/v1/needs-you': refreshes }, inbox: o.completeInbox ?? { needsYouRoute: refreshes, plansFirstWindow: Math.round(bundled * refreshes / Math.max(1, starts)) } } },
      } : {}),
      ...(format === 'older' ? { listStarts: { [surface]: starts }, inbox: { [surface]: { needsYouRoute: standalone, plansFirstWindow: bundled } } } : {}),
    };
  };
  const others = (surface: 'page' | 'panel') => ['drag', 'wheel-pan', 'selection', 'key-zoom'].map(label => ({
    surface, label, elapsed: 1000, longTasks: { count: 0, total: 0, max: 0 }, frames: { p99: 16, max: 20 }, traffic: {},
  }));
  const starts = o.pageStarts ?? page, railStarts = o.railStarts ?? rail;
  return {
    measurements: [
      window('page', o.elapsed ?? 16000, o.pagePlans ?? page * (o.pagesPerRefresh ?? 10), starts, o.bundled ?? starts * (o.firstWindow ?? 1), o.standalone ?? starts,
        o.completePlans ?? Math.max(0, starts - 1) * (o.pagesPerRefresh ?? 10), o.health ?? page, o.runReads ?? starts),
      window('panel', o.railElapsed ?? 16000, o.railPlans ?? rail, railStarts, 0, railStarts, Math.max(0, railStarts - 1), rail, railStarts),
      ...others('page'), ...others('panel'),
    ],
    scrollbar: ['paused', 'inside', 'outside'].map(mode => ({ mode, distance: 100, same: true, reportArrived: true })),
    errors: [], search: { passed: true }, keyboard: { focusedListbox: true, activeOption: true },
    responsive: Array.from({ length: 5 }, () => ({ width: 1000, overflow: false, zeroBadges: false, filters: { open: true, overflow: false } })),
  };
}
interface Row { name: string; status: 'pass' | 'fail' | 'unverified' | 'informational'; before: number | null; after: number | null; note?: string }
interface Report { status: number | null; failed: string[]; unverified: string[]; info: string[]; rows: Row[]; summary: { passed: boolean; failed: string[]; unverified: string[] } | null; error: string }
/** Run the gate on a baseline and three candidate runs (one option set repeats for all three). */
function gate(after: Opt | [Opt, Opt, Opt], before: Opt = {}): Report {
  const scratch = mkdtempSync(join(tmpdir(), 'large-library-gate-'));
  try {
    const runs = Array.isArray(after) ? after : [after, after, after];
    const dirs = [{ ...before, before: true }, ...runs].map((o, i) => {
      const dir = join(scratch, String(i)); mkdirSync(dir); writeFileSync(join(dir, 'results.json'), JSON.stringify(results(o))); return dir;
    });
    const run = spawnSync(process.execPath, ['--experimental-strip-types', 'tests/browser/large-library-gate.ts', ...dirs], { encoding: 'utf8' });
    const report = run.stdout ? JSON.parse(run.stdout) : null;
    // Rows carry a status; the previous report shape had a pass flag and an informational budget, which the same checks read.
    const rows: Row[] = (report?.rows ?? []).map((r: any) => ({ ...r, status: r.status ?? (r.budget === 'informational' ? 'informational' : r.pass ? 'pass' : 'fail') }));
    const named = (status: Row['status']) => rows.filter(r => r.status === status).map(r => r.name);
    return { status: run.status, failed: named('fail'), unverified: named('unverified'), info: named('informational'), rows, summary: report?.unverified ? { passed: report.passed, failed: report.failed, unverified: report.unverified } : null, error: run.stderr };
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}
const cadence = (names: string[]) => names.filter(n => n.startsWith('Idle cadence'));
const PLANS = 'Idle /v1/plans requests/refresh', NEEDS_YOU = 'Idle /v1/needs-you requests/refresh';
const COMBINED = 'Idle inbox requests/refresh (/v1/needs-you + /v1/plans?needsYou=1)';
const LIST_CARRIED = 'Idle list-carried inbox windows per list start (/v1/plans?needsYou=1)';
const RUN_READS = 'Idle run reads per window (not compared)';
const perRefresh = [PLANS, NEEDS_YOU, COMBINED];

test('unchanged idle polling passes in the current format and exits zero', () => {
  const run = gate({});
  assert.equal(run.status, 0, run.error);
  assert.deepEqual(run.failed, []);
  assert.deepEqual(run.unverified, []);
  assert.equal(run.summary?.passed, true);
});

test('a baseline or candidates without the inbox split leave the combined budget unverified and the exit non-zero', () => {
  const noSplit = gate({ format: 'oldest' }, { format: 'oldest' });
  assert.equal(noSplit.status, 2, noSplit.error);
  assert.deepEqual(noSplit.failed, []);
  assert.deepEqual(noSplit.unverified.filter(n => n === COMBINED), [COMBINED]);
  assert.equal(noSplit.summary?.passed, false);
  assert.deepEqual(noSplit.summary?.unverified.filter(n => n === COMBINED), [COMBINED]);
  const baseline = gate({}, { format: 'oldest' });
  assert.equal(baseline.status, 2, baseline.error);
  assert.ok(baseline.unverified.includes(COMBINED));
  // The comparisons that can still be made still run.
  assert.ok(baseline.rows.some(r => r.name === 'Page idle long-task total (ms)' && r.status === 'pass'));
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

test('extra work per refresh still fails: more continuation pages, more inbox windows', () => {
  assert.ok(gate({ pagesPerRefresh: 11 }).failed.includes(PLANS));
  assert.deepEqual(gate({ firstWindow: 3 }).failed, [COMBINED, LIST_CARRIED]);
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

test('a candidate without the split does not discard the split of the other two, but one carrying candidate is too few', () => {
  const two = gate([{ firstWindow: 3 }, { firstWindow: 3 }, { format: 'oldest' }]);
  assert.equal(two.status, 1);
  assert.deepEqual(two.failed, [COMBINED, LIST_CARRIED]);
  // An older candidate, a current one and one without a split: only one candidate rests on complete refreshes.
  const mixed = gate([{ format: 'older' }, {}, { format: 'oldest' }]);
  assert.equal(mixed.status, 2, `${mixed.error}${mixed.failed.join('\n')}`);
  assert.deepEqual(mixed.failed, []);
  assert.deepEqual(mixed.unverified.sort(), [...perRefresh].sort());
  // The list-carried form is still compared: the older candidate and the current one both carry it.
  assert.ok(mixed.rows.some(r => r.name === LIST_CARRIED && r.status === 'pass'));
});

test('a refresh split by the window edge counts on neither side of the traffic ratio', () => {
  // 49 board pages over 4 list starts (a refresh's first page fell just before the window): healthy, 10 pages per complete refresh.
  const edge = gate({ pageStarts: 4, pagePlans: 49 });
  assert.equal(edge.status, 0, `${edge.error}${edge.failed.join('\n')}`);
  // 50 pages over 5 starts looks healthy by wall clock, yet the complete refreshes carried 11 pages each.
  const hidden = gate({ completePlans: 44 });
  assert.equal(hidden.status, 1);
  assert.deepEqual(hidden.failed, [PLANS]);
});

test('an artifact whose driver bucketed replies is named and not used as an equivalent complete sample', () => {
  const baseline = gate({}, { format: 'unlabelled' });
  assert.equal(baseline.status, 2, `${baseline.error}${baseline.failed.join('\n')}`);
  assert.deepEqual(baseline.unverified.sort(), [...perRefresh].sort());
  assert.ok(baseline.rows.some(r => /baseline/.test(r.name + (r.note ?? '')) && /attribution method not recorded/.test(r.name + (r.note ?? ''))), JSON.stringify(baseline.rows.filter(r => r.status !== 'pass')));
  const candidate = gate([{}, {}, { format: 'unlabelled' }]);
  assert.ok(candidate.rows.some(r => /run 3/.test(r.name + (r.note ?? '')) && /attribution method not recorded/.test(r.name + (r.note ?? ''))), JSON.stringify(candidate.rows.filter(r => r.status !== 'pass')));
});

test('one candidate that cannot be compared is named and left out; two such candidates leave the budget unverified', () => {
  const one = gate([{}, {}, { format: 'unlabelled' }]);
  assert.equal(one.status, 0, `${one.error}${one.failed.join('\n')}`);
  assert.deepEqual(one.unverified, []);
  const plans = one.rows.find(r => r.name === PLANS);
  assert.equal(plans?.status, 'pass');
  assert.match(plans?.note ?? '', /run 3: attribution method not recorded/);
  const two = gate([{}, { format: 'unlabelled' }, { format: 'unlabelled' }]);
  assert.equal(two.status, 2, `${two.error}${two.failed.join('\n')}`);
  assert.deepEqual(two.unverified.sort(), [...perRefresh].sort());
});

test('a baseline with one list start is unverified for the per-refresh budgets, not compared by its wall-clock count', () => {
  // Nineteen pages over one list start: a candidate at eleven pages per refresh must not pass a ten-page contract against it.
  const run = gate([{}, {}, { pagesPerRefresh: 11 }], { page: 1, pageStarts: 1, pagePlans: 19 });
  assert.equal(run.status, 2, `${run.error}${run.failed.join('\n')}`);
  assert.deepEqual(run.failed, []);
  assert.ok(run.unverified.includes(PLANS), run.unverified.join('\n'));
  assert.ok(run.rows.find(r => r.name === PLANS)?.note?.includes('baseline'), 'the row names the baseline');
  assert.ok(!run.rows.some(r => r.name === PLANS && r.status === 'pass'));
  // The summary names each unverified budget.
  assert.deepEqual(run.summary?.unverified.sort(), [...perRefresh].sort());
});

test('a single list start still has its split compared: an added list-carried inbox window fails', () => {
  const run = gate({}, { page: 1, pageStarts: 1, pagePlans: 10, firstWindow: 0, standalone: 1 });
  assert.equal(run.status, 1, `${run.error}`);
  assert.deepEqual(run.failed, [LIST_CARRIED]);
  assert.deepEqual(run.unverified.sort(), [...perRefresh].sort());
});

test('the list-carried form is compared on its own, so a standalone request at a window edge cannot pay for it', () => {
  // The older baseline counts six standalone requests over five list starts and no list-carried windows. The candidate sends five
  // standalone requests and one list-carried window, opened by the refresh still open at the window's end: the combined figure over
  // complete refreshes is lower than the baseline's, yet one list start in five now carries an inbox window.
  const run = gate({ standalone: 5, bundled: 1, completeInbox: { needsYouRoute: 4, plansFirstWindow: 0 } }, { format: 'older', pageStarts: 5, standalone: 6, firstWindow: 0 });
  assert.deepEqual(run.failed, [LIST_CARRIED]);
  assert.equal(run.status, 1);
  assert.ok(run.unverified.includes(COMBINED));
});

test('the list-carried form is divided by list starts, never by health replies', () => {
  // One list start, two health replies, ten plan replies: the baseline sent one list-carried window per list start.
  const run = gate({}, { page: 2, health: 2, pageStarts: 1, pagePlans: 10, firstWindow: 1 });
  assert.equal(run.rows.find(r => r.name === LIST_CARRIED)?.status, 'pass', JSON.stringify(run.rows.find(r => r.name === LIST_CARRIED)));
  assert.equal(run.rows.find(r => r.name === LIST_CARRIED)?.before, 1);
  // Complete refreshes are divided by refreshes, not health replies: eight health replies in the baseline window, 40 pages over four refreshes.
  const complete = gate({}, { health: 8 });
  assert.equal(complete.status, 0, `${complete.error}${complete.failed.join('\n')}`);
  assert.equal(complete.rows.find(r => r.name === PLANS)?.before, 10);
});

test('an older artifact\'s recorded wall-clock inbox form still sets the list-carried baseline', () => {
  const same = gate({}, { format: 'older' });
  assert.equal(same.status, 2, `${same.error}${same.failed.join('\n')}`);
  assert.deepEqual(same.failed, []);
  assert.ok(same.rows.some(r => r.name === LIST_CARRIED && r.status === 'pass'));
  // The baseline made no list-carried reads; candidates that opt in on every poll add inbox work.
  const more = gate({}, { format: 'older', firstWindow: 0 });
  assert.equal(more.status, 1);
  assert.deepEqual(more.failed, [LIST_CARRIED]);
});

test('run reads are an informational row: counts and list starts for the baseline and each run, and the exit is unchanged', () => {
  for (const [baseline, candidate] of [[5, 5], [0, 40], [40, 0]] as const) {
    const run = gate({ runReads: candidate }, { runReads: baseline });
    assert.equal(run.status, 0, `${run.error}${run.failed.join('\n')}`);
    assert.deepEqual(run.failed, []);
    assert.deepEqual(run.unverified, []);
    const summary = run.rows.find(r => r.name.startsWith(RUN_READS));
    assert.equal(summary?.status, 'informational');
    assert.ok(!run.rows.some(r => r.name.includes('/v1/subagent-runs') && r.status !== 'informational'), 'run reads are not a per-refresh budget');
    const text = `${summary?.name} ${summary?.note ?? ''}`;
    assert.match(text, new RegExp(`baseline page ${baseline} over 5 list starts`));
    for (const n of [1, 2, 3]) assert.match(text, new RegExp(`run ${n} page ${candidate} over 5 list starts`));
  }
});

test('run reads of an older artifact are shown as not recorded', () => {
  const run = gate({}, { format: 'older' });
  const summary = run.rows.find(r => r.name.startsWith(RUN_READS));
  assert.match(`${summary?.name} ${summary?.note ?? ''}`, /baseline page not recorded over 5 list starts/);
});
