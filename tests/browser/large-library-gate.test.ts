// The large-library gate must judge idle polling against the refresh cadence, not against its own /health count.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

type Traffic = Record<string, { count: number; bytes: number }>;
const row = (count: number) => ({ count, bytes: count * 100 });
// A 16 s idle window at the 3 s cadence: 5 refreshes, ten list reads each on the page, one on the rail.
const idle = (surface: 'page' | 'panel', split: boolean, scale = 1, health = 5): any => ({
  surface, label: 'idle', elapsed: 16000, longTasks: { count: 0, total: surface === 'page' ? 0 : 0, max: 0 }, frames: { p99: 16, max: 20 },
  traffic: {
    [`${surface} /health`]: row(health * scale), [`${surface} /v1/plans`]: row((surface === 'page' ? 50 : 5) * scale),
    [`${surface} /v1/needs-you`]: row(4 * scale), [`${surface} /v1/subagent-runs`]: row(5 * scale),
  } as Traffic,
  ...(split ? { inbox: { [surface]: { needsYouRoute: 4 * scale, plansFirstWindow: 5 * scale } } } : {}),
});
const others = (surface: 'page' | 'panel') => ['drag', 'wheel-pan', 'selection', 'key-zoom'].map(label => ({
  surface, label, elapsed: 1000, longTasks: { count: 0, total: 0, max: 0 }, frames: { p99: 16, max: 20 }, traffic: {},
}));
function results(opts: { before?: boolean; split?: boolean; scale?: number; health?: number; inboxScale?: number } = {}) {
  const split = opts.split ?? true, scale = opts.scale ?? 1;
  const page = idle('page', split, scale, opts.health), panel = idle('panel', split, scale, opts.health);
  if (opts.inboxScale && split) page.inbox.page.plansFirstWindow *= opts.inboxScale;
  if (opts.before) page.longTasks = { count: 8, total: 5000, max: 900 };
  return {
    measurements: [page, panel, ...others('page'), ...others('panel')],
    scrollbar: ['paused', 'inside', 'outside'].map(mode => ({ mode, distance: 100, same: true, reportArrived: true })),
    errors: [], search: { passed: true }, keyboard: { focusedListbox: true, activeOption: true },
    responsive: Array.from({ length: 5 }, () => ({ width: 1000, overflow: false, zeroBadges: false, filters: { open: true, overflow: false } })),
  };
}
function gate(after: Parameters<typeof results>[0], before: Parameters<typeof results>[0] = {}): { status: number | null; failed: string[]; error: string } {
  const scratch = mkdtempSync(join(tmpdir(), 'large-library-gate-'));
  try {
    const dirs = [{ ...before, before: true }, after, after, after].map((o, i) => {
      const dir = join(scratch, String(i)); mkdirSync(dir); writeFileSync(join(dir, 'results.json'), JSON.stringify(results(o))); return dir;
    });
    const run = spawnSync(process.execPath, ['--experimental-strip-types', 'tests/browser/large-library-gate.ts', ...dirs], { encoding: 'utf8' });
    const report = run.stdout ? JSON.parse(run.stdout) : null;
    return { status: run.status, failed: (report?.rows ?? []).filter((r: any) => !r.pass).map((r: any) => r.name as string), error: run.stderr };
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}

test('unchanged idle polling passes, with or without the inbox form split', () => {
  const run = gate({});
  assert.equal(run.status, 0, run.error);
  assert.deepEqual(run.failed, []);
  assert.equal(gate({ split: false }, { split: false }).status, 0);
});

test('uniformly doubled idle polling fails even though every route keeps its ratio to /health', () => {
  const run = gate({ scale: 2 });
  assert.equal(run.status, 1);
  assert.ok(run.failed.some(n => /refreshes completed \(max\)/.test(n)), run.failed.join('\n'));
  assert.ok(run.failed.some(n => n === 'Idle /v1/plans requests/refresh'), run.failed.join('\n'));
});

test('a window with no refreshes fails instead of passing on zero requests', () => {
  const run = gate({ scale: 0 });
  assert.equal(run.status, 1);
  assert.ok(run.failed.some(n => /refreshes completed \(min\)/.test(n)), run.failed.join('\n'));
});

test('inbox work carried by /v1/plans?needsYou=1 is counted, not only /v1/needs-you', () => {
  const run = gate({ inboxScale: 3 });
  assert.equal(run.status, 1);
  assert.deepEqual(run.failed, ['Idle inbox requests/refresh (/v1/needs-you + /v1/plans?needsYou=1)']);
});
