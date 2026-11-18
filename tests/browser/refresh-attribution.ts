// Idle-window traffic attribution for the large-library QA driver. A refresh starts with a first-page /v1/plans request
// (no cursor); everything the same frame issues after it, until its next first page, belongs to that refresh: continuation
// pages, /v1/needs-you windows and run reads. Requests are taken in the order they were issued, never the order replies
// arrived, so an inbox or run read that is still in flight when the next refresh starts stays with the refresh that sent it.
// Only refreshes closed by a later first page inside the window are complete: the last one may still be sending.
export interface IssuedRequest { frame: string; path: string; query?: Record<string, unknown> | null }
export interface CompleteRefreshes { refreshes: number; traffic: Record<string, number>; inbox: { needsYouRoute: number; plansFirstWindow: number } }

export function attributeRefreshes(requests: readonly IssuedRequest[], frames: readonly string[] = ['page', 'panel']) {
  type Bucket = { traffic: Record<string, number>; needsYouRoute: number; plansFirstWindow: number };
  const listStarts: Record<string, number> = {}, buckets: Record<string, Bucket[]> = {};
  for (const frame of frames) { listStarts[frame] = 0; buckets[frame] = []; }
  for (const r of requests) {
    const refreshes = buckets[r.frame] ??= [];
    const first = r.path === '/v1/plans' && !r.query?.cursor;
    if (first) { listStarts[r.frame] = (listStarts[r.frame] ?? 0) + 1; refreshes.push({ traffic: {}, needsYouRoute: 0, plansFirstWindow: 0 }); }
    const current = refreshes.at(-1);
    if (!current) continue; // issued by a refresh that started before the window
    current.traffic[r.path] = (current.traffic[r.path] ?? 0) + 1;
    if (r.path === '/v1/needs-you') current.needsYouRoute++;
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
  return { listStarts, complete };
}
