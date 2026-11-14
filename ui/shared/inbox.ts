// Needs you inbox controller: one per frame, owned by the shared frame controller (app.ts).
// - the first window rides on the frame's ordinary list read (no extra request, timer or poll)
// - more windows load only on an explicit "Check more plans", pinned to store + verified binding
// - an unchanged window keeps its timing anchors and object, so a poll repaints nothing
// - a changed first window, a 409 or an identity change restarts continuation visibly
// - reported state only: nothing here writes, settles, assigns or navigates the host
import { NEEDS_YOU_LIMITS } from '../../shared/needs-you.ts';
import type { InboxRowView, InboxTaskTarget, InboxWindowView, PlanView } from './model.ts';
import { readNeedsYou, type InboxFirst, type ReadFailure, type ServiceHost } from './source.ts';

export type InboxAvailability = 'ready' | 'unsupported' | 'unverified' | 'missing' | 'invalid';

/** Everything the inbox view paints; derived, never stored. */
export interface InboxModel {
  availability: InboxAvailability;
  needsYou: InboxRowView[];
  alsoBlocked: InboxRowView[];
  /** Cumulative counts through the last loaded window; exact only with `complete`. */
  counts: { needsYou: number; alsoBlocked: number };
  complete: boolean;
  gapped: boolean;
  captureEnabled: boolean;
  /** Whether the window carried waiting times (displayed rows only). */
  timing: boolean;
  canContinue: boolean;
  loadingMore: boolean;
  moreFailed: ReadFailure | null;
  /** The traversal moved under a continuation, so it started again from the top. */
  restarted: boolean;
  /** Display-only: whether loaded rows beyond the compact limit are shown. */
  expanded: boolean;
}

export interface InboxPanel {
  model: InboxModel;
  more: () => void;
  expand: (open: boolean) => void;
}

const rowSignature = (r: InboxRowView) => [r.rowKey, r.revision, r.structuralRevision, r.cleanupRev, r.planTitle, r.task.title, r.group, r.blocker, r.ancestors, r.omittedAncestors, r.wait ? [r.wait.kind, r.wait.since] : null];
/** Presentation identity of a window: read time and receipt anchors are excluded on purpose. */
const windowSignature = (w: InboxWindowView) => JSON.stringify([w.storeId, w.sourceId, w.captureEnabled, w.timing, w.rows.map(rowSignature), w.counts, w.nextCursor, w.coverage]);
const firstSignature = (f: InboxFirst) => (f.state === 'ready' ? `ready:${windowSignature(f.window)}` : f.state);

interface InboxDeps {
  service: (current: () => boolean) => ServiceHost;
  visible: () => boolean;
  changed: () => void;
  mono?: () => number;
}

export class InboxController {
  private owner = '';
  private first: InboxFirst | null = null;
  private firstSig = '';
  private pages: InboxWindowView[] = [];
  /** First-window signature the loaded pages continue; a different first window drops them. */
  private pagesBase = '';
  private pending: number | null = null;
  private generation = 0;
  private failed: ReadFailure | null = null;
  private restarted = false;
  private expanded = false;

  private readonly deps: InboxDeps;
  constructor(deps: InboxDeps) { this.deps = deps; }

  /**
   * A successful list read of this frame. Returns whether anything shown changed. `owner` is the
   * integration account + store/binding identity; a different owner forgets everything first.
   */
  adopt(owner: string, first: InboxFirst | undefined): boolean {
    if (owner !== this.owner) { this.reset(); this.owner = owner; }
    if (!first) return false;
    const sig = firstSignature(first);
    if (sig === this.firstSig) return false;
    this.first = first; this.firstSig = sig;
    if (this.pages.length || this.pending !== null) {
      // Never splice windows of different traversals: restart visibly from the new first window.
      this.dropPages(true);
    }
    return true;
  }

  /** `reset`: identity/cache reset or disposal; `hidden`: retire in-flight continuation only. */
  retire(reason: 'reset' | 'hidden' | 'dispose') {
    if (reason === 'hidden') { if (this.pending !== null) { this.pending = null; this.generation++; } return; }
    this.reset();
  }

  private reset() {
    this.owner = ''; this.first = null; this.firstSig = ''; this.pages = []; this.pagesBase = '';
    this.pending = null; this.generation++; this.failed = null; this.restarted = false; this.expanded = false;
  }

  private dropPages(restarted: boolean) {
    this.pages = []; this.pagesBase = ''; this.pending = null; this.generation++; this.failed = null;
    this.restarted = restarted;
  }

  private last(): InboxWindowView | null {
    return this.pages.at(-1) ?? (this.first?.state === 'ready' ? this.first.window : null);
  }

  model(): InboxModel | null {
    if (!this.first) return null;
    const empty = { needsYou: [], alsoBlocked: [], counts: { needsYou: 0, alsoBlocked: 0 }, complete: false, gapped: false, captureEnabled: true, timing: false, canContinue: false, loadingMore: false, moreFailed: null, restarted: false, expanded: false };
    if (this.first.state !== 'ready') return { ...empty, availability: this.first.state };
    const windows = [this.first.window, ...this.pages];
    const last = windows.at(-1)!;
    const seen = new Set<string>();
    const needsYou: InboxRowView[] = [], alsoBlocked: InboxRowView[] = [];
    for (const w of windows) for (const r of w.rows) {
      if (seen.has(r.rowKey)) continue; // a task is shown once across windows
      seen.add(r.rowKey);
      (r.group === 'needs-you' ? needsYou : alsoBlocked).push(r);
    }
    // Gaps anywhere in the traversal keep the whole result partial.
    const gapped = windows.some((w) => w.coverage.gapped);
    return {
      availability: 'ready', needsYou, alsoBlocked, counts: last.counts,
      complete: last.coverage.complete && last.coverage.exhausted && !gapped && last.nextCursor === null,
      gapped, captureEnabled: last.captureEnabled, timing: this.first.window.timing,
      canContinue: last.nextCursor !== null, loadingMore: this.pending !== null, moreFailed: this.failed, restarted: this.restarted, expanded: this.expanded,
    };
  }

  panel(): InboxPanel | null {
    const model = this.model();
    if (!model) return null;
    const owner = this.owner;
    return {
      model,
      // Controls painted under another store/binding do nothing.
      more: () => { if (this.owner === owner) this.more(); },
      expand: (open) => { if (this.owner === owner && this.expanded !== open) { this.expanded = open; this.deps.changed(); } },
    };
  }

  /** One explicit continuation window; never automatic, never while hidden or already loading. */
  more() {
    const last = this.last();
    if (!last || !last.nextCursor || this.pending !== null || !this.deps.visible() || this.first?.state !== 'ready') return;
    const generation = ++this.generation;
    this.pending = generation;
    this.failed = null;
    this.restarted = false;
    if (!this.pages.length) this.pagesBase = this.firstSig;
    const base = this.pagesBase;
    const current = () => this.pending === generation && this.generation === generation && this.pagesBase === base;
    const request = { storeId: last.storeId, binding: { sourceId: last.sourceId, verified: true as const }, source: last.sourceId, cursor: last.nextCursor, limit: NEEDS_YOU_LIMITS.rows, timing: last.timing };
    this.deps.changed();
    void readNeedsYou(this.deps.service(current), request, last.counts, this.deps.mono).then((r) => {
      if (!current()) return;
      this.pending = null;
      if (r.ok) this.pages.push(r.window);
      else if (r.status === 409) this.dropPages(true);
      else this.failed = r.failure;
      this.deps.changed();
    });
  }
}

/** The ephemeral reveal target of a row, pinned to the observed store (model.ts InboxTaskTarget). */
export const inboxTarget = (row: InboxRowView, storeId: string): InboxTaskTarget => ({ storeId, source: row.source, plan: row.plan, task: row.task.id, revision: row.revision, cleanupRev: row.cleanupRev });

/**
 * Detail-read request for a target: identity and revision only. It is never painted as a plan;
 * the complete detail read's own plan metadata is (and revalidates the row).
 */
export function inboxRequest(target: InboxTaskTarget, title: string, owner: string): PlanView {
  return {
    key: `${target.source}/${target.plan}`, id: target.plan, sourceId: target.source, title, ownerSessionId: owner,
    revision: target.revision, structuralRevision: 0, lifecycle: 'active', reportedAt: new Date(0).toISOString(), directory: '',
    counts: null, working: [], cleanup: { state: 'visible', revision: target.cleanupRev },
    document: { state: 'unbound', checklistSynchronized: false, currentFile: 'not-rechecked' },
  };
}
