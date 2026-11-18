// Usage: node --experimental-strip-types tests/browser/large-library-gate.ts <before> <after-1> <after-2> <after-3>
// Each argument is an artifact directory containing large-library-qa.ts results.json.
import { readFileSync } from 'node:fs';
import path from 'node:path';
const dirs = process.argv.slice(2);
if (dirs.length !== 4) throw Error('Usage: <before> <after-1> <after-2> <after-3>');
const [before, ...after] = dirs.map(dir => JSON.parse(readFileSync(path.join(dir, 'results.json'), 'utf8')));
const measurement = (r: any, surface: string, label: string) => {
  const m = r.measurements.find((m: any) => m.surface === surface && m.label === label);
  if (!m) throw Error(`Missing ${surface} ${label}`);
  return m;
};
if (measurement(before, 'page', 'idle').longTasks.total < 4000 || measurement(before, 'panel', 'idle').longTasks.count !== 0) throw Error('Baseline does not reproduce the reported page stall with a smooth rail');
const median = (values: number[]) => values.slice().sort((a,b) => a-b)[Math.floor(values.length / 2)];
const rows: { name: string; before: number; after: number; budget: string; pass: boolean }[] = [];
function check(name: string, read: (r: any) => number, limit: number, minimum = false) {
  const value = median(after.map(read));
  rows.push({ name, before: read(before), after: value, budget: `${minimum ? '>=' : '<='} ${limit}`, pass: minimum ? value >= limit : value <= limit });
}
for (const [label, field, limit] of [
  ['idle', 'total', 1000], ['idle', 'max', 250], ['drag', 'total', 1000], ['key-zoom', 'max', 250],
] as const) check(`Page ${label} long-task ${field} (ms)`, r => measurement(r, 'page', label).longTasks[field], limit);
for (const label of ['drag', 'wheel-pan']) check(`Page ${label} p99 frame gap (ms)`, r => measurement(r, 'page', label).frames.p99, 150);
check('Page cold selection (ms)', r => measurement(r, 'page', 'selection').elapsed, 1500);
for (const mode of ['inside', 'outside']) {
  check(`Scrollbar ${mode} distance (%)`, r => {
    const control = r.scrollbar.find((v: any) => v.mode === 'paused');
    const live = r.scrollbar.find((v: any) => v.mode === mode);
    if (!(control?.distance > 0) || !live) throw Error('Missing scrollbar control');
    return 100 * live.distance / control.distance;
  }, 90, true);
  if (after.some(r => !r.scrollbar.find((v: any) => v.mode === mode)?.same)) rows.push({ name: `Scrollbar ${mode} element continuity`, before: 0, after: 0, budget: 'same connected element in all runs', pass: false });
  if (after.some(r => !r.scrollbar.find((v: any) => v.mode === mode)?.reportArrived)) throw Error(`Reported change did not arrive during ${mode} scrollbar drag`);
}
for (const label of ['idle', 'selection', 'drag', 'wheel-pan', 'key-zoom']) {
  check(`Rail ${label} long tasks`, r => measurement(r, 'panel', label).longTasks.count, 0);
  check(`Rail ${label} p99 frame gap (ms)`, r => measurement(r, 'panel', label).frames.p99, 50);
}
// Idle polling. A refresh starts with a first-page list read; /health is read once per refresh. Each window's own elapsed
// time (at the product cadence, ui/shared/app.ts REFRESH_MS) sets the allowed count, +/- one boundary tick, and both
// surfaces must pass within the same run, so one healthy surface cannot cover for a stalled or doubled one. Traffic is then
// compared per observed refresh, so a healthy extra boundary poll does not read as extra work. Artifacts from before the
// driver recorded list starts fall back to /health as the refresh count; each fallback is named in its row.
const REFRESH_MS = 3000;
const idle = (r: any, surface: string) => measurement(r, surface, 'idle');
const requests = (r: any, surface: string, route: string) => idle(r, surface).traffic[`${surface} ${route}`]?.count ?? 0;
const listStarts = (r: any, surface: string): number | undefined => idle(r, surface).listStarts?.[surface];
const refreshes = (r: any, surface: string) => Math.max(1, listStarts(r, surface) ?? requests(r, surface, '/health'));
const startsFallback: string[] = [];
after.forEach((r, n) => {
  const violations: string[] = [];
  for (const surface of ['page', 'panel']) {
    const window = idle(r, surface).elapsed / REFRESH_MS, min = Math.floor(window) - 1, max = Math.ceil(window);
    const within = (what: string, count: number, upper = true) => { if (count < min || (upper && count > max)) violations.push(`${surface} ${what} ${count} outside ${min}-${max}`); };
    within('/health', requests(r, surface, '/health'));
    const starts = listStarts(r, surface);
    if (starts === undefined) { startsFallback.push(`run ${n + 1} ${surface}`); within('/v1/plans reads', requests(r, surface, '/v1/plans'), false); }
    else within('list starts', starts);
  }
  rows.push({ name: `Idle cadence, run ${n + 1}: page and rail /health and list starts${violations.length ? ` (${violations.join('; ')})` : ''}`, before: 0, after: violations.length, budget: '== 0', pass: violations.length === 0 });
});
if (startsFallback.length) rows.push({ name: `Idle list starts not recorded (${startsFallback.join(', ')}): counted /v1/plans reads against the lower bound only`, before: 0, after: 0, budget: 'informational', pass: true });
const perRefresh = (read: (r: any) => number) => (r: any) => read(r) / refreshes(r, 'page');
for (const route of ['/v1/plans', '/v1/needs-you', '/v1/subagent-runs']) {
  const read = perRefresh(r => requests(r, 'page', route));
  check(`Idle ${route} requests/refresh`, read, read(before));
}
{
  // Inbox work travels as /v1/needs-you windows and as the first window on /v1/plans?needsYou=1. Compare both forms when the
  // baseline and at least two candidates carry them; otherwise compare the /v1/needs-you route alone and say so.
  const split = (r: any) => idle(r, 'page').inbox?.page;
  const comparable = after.filter(split);
  const both = !!split(before) && comparable.length >= 2;
  const total = (r: any) => both ? split(r).needsYouRoute + split(r).plansFirstWindow : requests(r, 'page', '/v1/needs-you');
  const read = perRefresh(total), value = median((both ? comparable : after).map(read));
  rows.push({
    name: both ? 'Idle inbox requests/refresh (/v1/needs-you + /v1/plans?needsYou=1)'
      : `Idle inbox requests/refresh (/v1/needs-you only: ${split(before) ? 'fewer than two candidates carry' : 'baseline lacks'} the form split)`,
    before: read(before), after: value, budget: `<= ${read(before)}`, pass: value <= read(before),
  });
}
for (const r of after) if (r.errors?.length) throw Error('Browser errors reported');
for (const r of after) {
  if (!r.search?.passed) throw Error('Search continuation did not preserve the pressed control/focus across refresh and announce its result once');
  if (!r.keyboard?.focusedListbox || !r.keyboard?.activeOption) throw Error('Keyboard listbox state did not survive refresh');
  if (r.responsive?.length !== 5 || r.responsive.some((v: any) => v.overflow || v.zeroBadges || !v.filters?.open || v.filters.overflow || (v.width < 820 && !v.planPicker))) throw Error('Responsive board/count observations failed');
}
console.log(JSON.stringify({ passed: rows.every(r => r.pass), rows }, null, 2));
if (rows.some(r => !r.pass)) process.exitCode = 1;
