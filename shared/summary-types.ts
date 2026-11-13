// Pure summary input contract. Callers own complete, identity-checked page assembly; no
// document body, timing, paths, blocker details or live session state is consumed here.
export type SummaryLanguage = 'en' | 'ru';
export type SummaryStatus = 'pending' | 'working' | 'blocked' | 'done' | 'skipped';
export type SummaryLifecycle = 'active' | 'completed' | 'cancelled' | 'failed';
export type SummaryDocumentState = 'unbound' | 'captured' | 'denied' | 'missing' | 'moved' | 'oversized' | 'non-text' | 'unavailable' | 'changed-during-read';
export interface SummaryItem {
  id: string; title: string; kind: 'group' | 'task'; status: SummaryStatus;
  dependencies?: string[];
}
export interface SummaryPlan {
  key: string; id: string; sourceId: string; title: string; ownerSessionId: string;
  revision: number; lifecycle: SummaryLifecycle; reportedAt: string;
  counts: { done: number; total: number; remaining: number; skipped: number } | null;
  cleanup?: { state: 'visible' | 'archived'; revision: number };
  document: { state: SummaryDocumentState; captureId?: number; checklistSynchronized: boolean };
}
/** First-page facts only, never partially assembled task/contribution arrays. */
export interface DetailSnapshot<P extends SummaryPlan = SummaryPlan> {
  readonly plan: P & { counts: NonNullable<SummaryPlan['counts']> };
  readonly identity: { readonly storeId: string; readonly binding: { readonly sourceId: string | null; readonly verified: boolean }; readonly sourceId: string; readonly planId: string };
  readonly captureEnabled: boolean;
  readonly diagnostics: readonly string[];
}
export type DetailFailureCause =
  | { kind: 'revision-restarts' | 'page-cap' | 'identity-contract' | 'unreachable-auth' | 'not-found' }
  | { kind: 'store'; code: 'unavailable' | 'storage' | 'binding' | 'corrupt' | 'schema' | 'busy' | 'unknown' };
/** Only complete accepted reads may be passed here. Completeness is not inferred from counts. */
export interface SummaryInput {
  ok: true; plan: SummaryPlan; snapshot: DetailSnapshot | null;
  detail: { key: string; revision: number; items: SummaryItem[]; contributions: { mode: 'direct' | 'parent-relay' }[] };
}
