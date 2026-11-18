// Idle-window traffic attribution for the large-library QA driver.
//
// The driver captures how long the request log and the reply log are in the same evaluations that start and stop a timed
// window, and `summarizeWindow` slices both logs between those offsets. Every count the gate compares (cadence, list starts,
// run reads, both inbox forms) comes from the request log, so a request counts by when it was sent: one sent before the window
// and answered inside it is out, one sent inside and answered after it is in. The reply log keeps only what a reply can show:
// status, size and timing.
//
// A refresh starts with a first-page /v1/plans request (no cursor); everything the same frame issues after it, until its next
// first page, belongs to that refresh: continuation pages and /v1/needs-you windows. Requests are taken in the order they were
// sent, never the order replies arrived, so an inbox read that is still in flight when the next refresh starts stays with the
// refresh that sent it. Only refreshes closed by a later first page inside the window are complete: the last one may still be
// sending.
//
// Two routes are kept out of the per-refresh figures. /health is read before its refresh's first page, so it cannot be tied to
// a bucket and the cadence check covers it. A run read can be the automatic follow-up of a run reconciliation, sent after the
// next refresh started; the request log cannot say which refresh caused it, so run reads are counted once per window instead.
export const ATTRIBUTION_METHOD = 'request-order';
export const HEALTH_ROUTE = '/health';
export const RUN_READ_ROUTE = '/v1/subagent-runs';
export const INBOX_ROUTE = '/v1/needs-you';
export interface IssuedRequest { frame: string; path: string; query?: Record<string, unknown> | null }
export interface LoggedReply { frame: string; path: string; bytes: number; status?: number; ms?: number }
export interface InboxForms { needsYouRoute: number; plansFirstWindow: number }
export interface CompleteRefreshes { refreshes: number; traffic: Record<string, number>; inbox: InboxForms }
/** How long each log was when a window started or stopped. */
export interface LogOffsets { requests: number; replies: number }
export interface WindowBounds { start: LogOffsets; stop: LogOffsets }

const isFirstPage = (r: IssuedRequest) => r.path === '/v1/plans' && !r.query?.cursor;

export function attributeRefreshes(requests: readonly IssuedRequest[], frames: readonly string[] = ['page', 'panel']) {
  type Bucket = { traffic: Record<string, number>; needsYouRoute: number; plansFirstWindow: number };
  const listStarts: Record<string, number> = {}, runReads: Record<string, number> = {}, buckets: Record<string, Bucket[]> = {};
  const inbox: Record<string, InboxForms> = {};
  const start = (frame: string) => {
    listStarts[frame] ??= 0; runReads[frame] ??= 0; buckets[frame] ??= []; inbox[frame] ??= { needsYouRoute: 0, plansFirstWindow: 0 };
  };
  for (const frame of frames) start(frame);
  for (const r of requests) {
    start(r.frame);
    const first = isFirstPage(r), refreshes = buckets[r.frame]!;
    // The window's own inbox split counts every request sent inside it, whichever refresh is open.
    if (r.path === INBOX_ROUTE) inbox[r.frame]!.needsYouRoute++;
    else if (first && String(r.query?.needsYou) === '1') inbox[r.frame]!.plansFirstWindow++;
    if (first) { listStarts[r.frame]!++; refreshes.push({ traffic: {}, needsYouRoute: 0, plansFirstWindow: 0 }); }
    if (r.path === RUN_READ_ROUTE) { runReads[r.frame]!++; continue; }
    if (r.path === HEALTH_ROUTE) continue;
    const current = refreshes.at(-1);
    if (!current) continue; // issued by a refresh that started before the window
    current.traffic[r.path] = (current.traffic[r.path] ?? 0) + 1;
    if (r.path === INBOX_ROUTE) current.needsYouRoute++;
    else if (first && String(r.query?.needsYou) === '1') current.plansFirstWindow++;
  }
  const complete: Record<string, CompleteRefreshes> = {};
  for (const [frame, refreshes] of Object.entries(buckets)) {
    const sum: CompleteRefreshes = { refreshes: Math.max(0, refreshes.length - 1), traffic: {}, inbox: { needsYouRoute: 0, plansFirstWindow: 0 } };
    for (const b of refreshes.slice(0, -1)) {
      for (const [path, n] of Object.entries(b.traffic)) sum.traffic[path] = (sum.traffic[path] ?? 0) + n;
      sum.inbox.needsYouRoute += b.needsYouRoute; sum.inbox.plansFirstWindow += b.plansFirstWindow;
    }
    complete[frame] = sum;
  }
  return { listStarts, runReads, inbox, complete };
}

/** Everything one timed window records, from the two logs and the offsets captured when it started and stopped. */
export function summarizeWindow(logs: { requests: readonly IssuedRequest[]; replies: readonly LoggedReply[] }, bounds: WindowBounds, frames?: readonly string[]) {
  const requests = logs.requests.slice(bounds.start.requests, bounds.stop.requests);
  const replies = logs.replies.slice(bounds.start.replies, bounds.stop.replies);
  const sent: Record<string, number> = {}, traffic: Record<string, { count: number; bytes: number }> = {};
  for (const r of requests) sent[`${r.frame} ${r.path}`] = (sent[`${r.frame} ${r.path}`] ?? 0) + 1;
  for (const r of replies) {
    const row = traffic[`${r.frame} ${r.path}`] ??= { count: 0, bytes: 0 };
    row.count++; row.bytes += r.bytes;
  }
  return { attribution: ATTRIBUTION_METHOD, sent, traffic, ...attributeRefreshes(requests, frames) };
}
