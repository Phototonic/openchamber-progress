// Usage: node --experimental-strip-types tests/browser/large-library-gate.ts <before> <after-1> <after-2> <after-3>
// Each argument is an artifact directory containing large-library-qa.ts results.json.
// Exit status: 0 when every budget passed, 1 when a budget failed, 2 when none failed but a budget could not be compared.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ATTRIBUTION_METHOD, HEALTH_ROUTE, INBOX_ROUTE, type CompleteRefreshes } from './refresh-attribution.ts';
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
// A row is a passed or failed budget, a budget that could not be compared (unverified), or information that never changes the exit.
type Row = { name: string; before: number | null; after: number | null; budget: string; status: 'pass' | 'fail' | 'unverified' | 'informational'; note?: string };
const rows: Row[] = [];
const info = (name: string) => rows.push({ name, before: null, after: null, budget: 'informational', status: 'informational' });
function check(name: string, read: (r: any) => number, limit: number, minimum = false) {
  const value = median(after.map(read));
  rows.push({ name, before: read(before), after: value, budget: `${minimum ? '>=' : '<='} ${limit}`, status: (minimum ? value >= limit : value <= limit) ? 'pass' : 'fail' });
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
  if (after.some(r => !r.scrollbar.find((v: any) => v.mode === mode)?.same)) rows.push({ name: `Scrollbar ${mode} element continuity`, before: 0, after: 0, budget: 'same connected element in all runs', status: 'fail' });
  if (after.some(r => !r.scrollbar.find((v: any) => v.mode === mode)?.reportArrived)) throw Error(`Reported change did not arrive during ${mode} scrollbar drag`);
}
for (const label of ['idle', 'selection', 'drag', 'wheel-pan', 'key-zoom']) {
  check(`Rail ${label} long tasks`, r => measurement(r, 'panel', label).longTasks.count, 0);
  check(`Rail ${label} p99 frame gap (ms)`, r => measurement(r, 'panel', label).frames.p99, 50);
}
// Idle polling. A refresh starts with a first-page list read; /health is read once per refresh. Each window's own elapsed
// time (at the product cadence, ui/shared/app.ts REFRESH_MS) sets the allowed count, +/- one boundary tick, and both
// surfaces must pass within the same run, so one healthy surface cannot cover for a stalled or doubled one. Every count comes
// from the request log inside the window's offsets (the artifact's `sent`, `listStarts`, `runReads` and `inbox` figures), by
// when a request was sent.
//
// Per-refresh budgets compare complete refreshes: the driver attributes every request to the refresh whose first page started
// it and counts only refreshes that a later first page closed inside the window, so a refresh split by the window edge counts on
// neither side of the ratio. An artifact is comparable that way only when it names the attribution method and completed at least
// one refresh. A budget whose baseline or candidates rest on anything else (a single list start, wall-clock counts, an older
// driver that bucketed replies) is unverified, not passed. The form of the inbox read carried by the list read is compared on its
// own, per list start, which is comparable in any window. Run reads are shown per window and judged by no one.
const REFRESH_MS = 3000;
const idle = (r: any, surface: string) => measurement(r, surface, 'idle');
// Older artifacts recorded reply counts only; a current one records what was sent. The row names any run that falls back.
const sentCount = (r: any, surface: string, route: string): number => {
  const window = idle(r, surface), key = `${surface} ${route}`;
  return window.sent ? window.sent[key] ?? 0 : window.traffic[key]?.count ?? 0;
};
const listStarts = (r: any, surface: string): number | undefined => idle(r, surface).listStarts?.[surface];
const recorded = (r: any) => idle(r, 'page').complete?.page as CompleteRefreshes | undefined;
const labelled = (r: any) => idle(r, 'page').attribution === ATTRIBUTION_METHOD;
// Zero complete refreshes (a window with a single list start, or a stalled baseline) is insufficient evidence, not a zero budget.
const settled = (r: any): CompleteRefreshes | undefined => labelled(r) && (recorded(r)?.refreshes ?? 0) >= 1 && recorded(r)?.inbox ? recorded(r) : undefined;
const why = (r: any) => !labelled(r) ? 'attribution method not recorded (an older driver, which may have bucketed replies)'
  : `no complete refresh inside its idle window (${listStarts(r, 'page') ?? 0} list start${listStarts(r, 'page') === 1 ? '' : 's'})`;
const names = ['baseline', ...after.map((_, n) => `run ${n + 1}`)];
const all = [before, ...after];
{
  const noLog = after.map((r, n) => idle(r, 'page').sent && idle(r, 'panel').sent ? null : `run ${n + 1}`).filter(Boolean);
  if (noLog.length) info(`Idle counts for ${noLog.join(', ')} come from replies: the artifact predates the request-log counts`);
}
const startsFallback: string[] = [];
after.forEach((r, n) => {
  const violations: string[] = [];
  for (const surface of ['page', 'panel']) {
    const window = idle(r, surface).elapsed / REFRESH_MS, min = Math.floor(window) - 1, max = Math.ceil(window);
    const within = (what: string, count: number, upper = true) => { if (count < min || (upper && count > max)) violations.push(`${surface} ${what} ${count} outside ${min}-${max}`); };
    within(HEALTH_ROUTE, sentCount(r, surface, HEALTH_ROUTE));
    const starts = listStarts(r, surface);
    if (starts === undefined) { startsFallback.push(`run ${n + 1} ${surface}`); within('/v1/plans reads', sentCount(r, surface, '/v1/plans'), false); }
    else within('list starts', starts);
  }
  rows.push({ name: `Idle cadence, run ${n + 1}: page and rail /health and list starts${violations.length ? ` (${violations.join('; ')})` : ''}`, before: 0, after: violations.length, budget: '== 0', status: violations.length === 0 ? 'pass' : 'fail' });
});
if (startsFallback.length) info(`Idle list starts not recorded (${startsFallback.join(', ')}): counted /v1/plans reads against the lower bound only`);
/**
 * Compare a figure the baseline and at least two candidates carry on the same denominator; otherwise report it unverified and
 * say which artifacts are missing. `read` returns undefined when an artifact does not carry the figure.
 */
function budget(name: string, read: (r: any) => number | undefined, missing: (r: any) => string) {
  const base = read(before);
  const carrying = after.filter(r => read(r) !== undefined);
  if (base === undefined || carrying.length < 2) {
    const reasons = all.filter(r => read(r) === undefined).map(r => `${names[all.indexOf(r)]}: ${missing(r)}`);
    rows.push({ name, before: null, after: null, budget: 'comparable figures from the baseline and two candidates', status: 'unverified', note: reasons.join('; ') });
    return;
  }
  const value = median(carrying.map(r => read(r)!));
  rows.push({ name, before: base, after: value, budget: `<= ${base}`, status: value <= base ? 'pass' : 'fail',
    ...carrying.length < after.length ? { note: `compared over ${carrying.map(r => names[all.indexOf(r)]).join(', ')}; ${after.filter(r => read(r) === undefined).map(r => `${names[all.indexOf(r)]}: ${missing(r)}`).join('; ')}` } : {} });
}
// Which artifacts do not rest on complete refreshes, and why, once, for the reader.
for (const r of all) if (!settled(r)) info(`${names[all.indexOf(r)]} figures per refresh are not comparable: ${why(r)}`);
const perRefresh = (figure: (done: CompleteRefreshes) => number) => (r: any) => { const done = settled(r); return done ? figure(done) / done.refreshes : undefined; };
budget('Idle /v1/plans requests/refresh', perRefresh(done => done.traffic['/v1/plans'] ?? 0), why);
budget('Idle /v1/needs-you requests/refresh', perRefresh(done => done.traffic[INBOX_ROUTE] ?? 0), why);
// Both inbox forms together, per complete refresh: the standalone route and the first window carried by /v1/plans?needsYou=1.
budget('Idle inbox requests/refresh (/v1/needs-you + /v1/plans?needsYou=1)', perRefresh(done => done.inbox.needsYouRoute + done.inbox.plansFirstWindow), why);
// The form carried by the list read, per list start: a list start either carried it or did not, so the figure has no error at
// the window edge and any artifact with list starts and the wall-clock split can be compared, in any window.
budget('Idle list-carried inbox windows per list start (/v1/plans?needsYou=1)', r => {
  const form = idle(r, 'page').inbox?.page, starts = listStarts(r, 'page');
  return form && starts ? form.plansFirstWindow / starts : undefined;
}, r => listStarts(r, 'page') ? 'no inbox split recorded' : 'no list starts recorded');
{
  // Run reads cannot be tied to the refresh that caused them (the request log holds no cause), so each window's count is shown
  // beside its list starts and judged by no one. This row never changes the exit.
  const figure = (r: any, surface: string) => `${idle(r, surface).runReads?.[surface] ?? 'not recorded'} over ${listStarts(r, surface) ?? 'not recorded'} list starts`;
  rows.push({
    name: 'Idle run reads per window (not compared)', before: null, after: null, budget: 'informational', status: 'informational',
    note: all.map(r => `${names[all.indexOf(r)]} page ${figure(r, 'page')}, rail ${figure(r, 'panel')}`).join('; '),
  });
}
for (const r of after) if (r.errors?.length) throw Error('Browser errors reported');
for (const r of after) {
  if (!r.search?.passed) throw Error('Search continuation did not preserve the pressed control/focus across refresh and announce its result once');
  if (!r.keyboard?.focusedListbox || !r.keyboard?.activeOption) throw Error('Keyboard listbox state did not survive refresh');
  if (r.responsive?.length !== 5 || r.responsive.some((v: any) => v.overflow || v.zeroBadges || !v.filters?.open || v.filters.overflow || (v.width < 820 && !v.planPicker))) throw Error('Responsive board/count observations failed');
}
const failed = rows.filter(r => r.status === 'fail').map(r => r.name), unverified = rows.filter(r => r.status === 'unverified').map(r => r.name);
console.log(JSON.stringify({ passed: !failed.length && !unverified.length, failed, unverified, rows }, null, 2));
if (unverified.length) console.error(`Not compared (unverified), so neither passed nor failed: ${unverified.join('; ')}`);
if (failed.length) console.error(`Failed: ${failed.join('; ')}`);
process.exitCode = failed.length ? 1 : unverified.length ? 2 : 0;
