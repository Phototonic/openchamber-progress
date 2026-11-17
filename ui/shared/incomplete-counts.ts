import type { StoreRead } from './model.ts';
import type { InboxPanel } from './inbox.ts';
import type { RunsPanel } from './runs.ts';
import type { Census } from './census.ts';

/** Fixed support vocabulary, never session identifiers, paths or agent text. */
export const COUNT_REASONS = ['plans-not-loaded', 'plans-not-checked', 'plans-unreadable', 'runs-unavailable', 'runs-not-loaded', 'history-not-loaded', 'recording-gap', 'run-traversal', 'host-not-checked'] as const;
export type CountReason = typeof COUNT_REASONS[number];
export interface CountFacts {
  reasons: CountReason[];
  detection: number | null;
  lastLossAt: number | null;
  gapDate: 'none' | 'known' | 'migrated-unknown' | 'legacy-unknown';
  plans: number;
  runs: number;
  historicalSessions: number;
}
export const emptyCountFacts = (): CountFacts => ({ reasons: [], detection: null, lastLossAt: null, gapDate: 'none', plans: 0, runs: 0, historicalSessions: 0 });

export function countFacts(read: StoreRead | null, inbox: InboxPanel | null, runs: RunsPanel | null, census: Census | null): CountFacts {
  const f = emptyCountFacts(), reasons = new Set<CountReason>();
  f.plans = read?.plans.length ?? 0;
  if (read?.truncated) reasons.add('plans-not-loaded');
  if (inbox?.model.availability === 'ready' && !inbox.model.complete) reasons.add('plans-not-checked');
  if (inbox?.model.gapped) reasons.add('plans-unreadable');
  if (runs) {
    const r = runs.read;
    if (!r || r.availability !== 'ready') reasons.add('runs-unavailable');
    if (r) {
      const loadedChildren = new Set([...runs.featured, ...runs.more].map(row => row.childSessionId).filter(Boolean)).size;
      if (r.counts.children > loadedChildren) reasons.add('runs-not-loaded');
      f.runs = r.counts.runs; f.historicalSessions = r.counts.historicalSessions;
      if (r.capture.loss) {
        reasons.add('recording-gap'); f.detection = r.capture.lossNotice?.sequence ?? null;
        f.lastLossAt = r.capture.lossNotice?.lastLossAt ?? null;
        f.gapDate = !r.capture.lossNotice ? 'legacy-unknown' : f.lastLossAt === null ? 'migrated-unknown' : 'known';
      }
      if (r.coverage.reasons.includes('traversal-limit')) reasons.add('run-traversal');
      if (r.recovery.state !== 'complete' || runs.reconciling || r.coverage.reasons.some(k => k !== 'capture-loss' && k !== 'traversal-limit')) reasons.add('history-not-loaded');
    }
  }
  if (census && (census.state !== 'ready' || census.gaps.length)) reasons.add('host-not-checked');
  f.reasons = COUNT_REASONS.filter(k => reasons.has(k));
  return f;
}

/** Totals and paging do not change dismissal identity; a new detection does. */
export const countReasonIdentity = (store: string, facts: CountFacts) => JSON.stringify([store, COUNT_REASONS.filter(k => facts.reasons.includes(k)), facts.detection]);
