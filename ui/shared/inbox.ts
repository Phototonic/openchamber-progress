// Needs you inbox controller: one per frame, owned by the shared frame controller (app.ts).
// - the first window rides on the frame's ordinary list read (no extra request, timer or poll)
// - one continuation per ordinary refresh, up to eight automatic windows per traversal
// - an unchanged window keeps its timing anchors and object, so a poll repaints nothing
// - a changed first window, a 409 or an identity change restarts continuation visibly
// - reported state only: nothing here writes, settles, assigns or navigates the host
import { isNeedsYou, NEEDS_YOU_LIMITS } from '../../shared/needs-you.ts';
import type { InboxRowView, InboxTaskTarget, InboxWindowView, PlanView } from './model.ts';
import { readNeedsYou, type InboxFirst, type ReadFailure, type ServiceHost } from './source.ts';
import { hiddenItemKey, type DeviceViewState } from './device-view-state.ts';

export type InboxAvailability = 'ready' | 'unsupported' | 'unverified' | 'missing' | 'invalid';

/** Everything the inbox view paints; derived, never stored. */
export interface InboxModel {
  availability: InboxAvailability;
  needsYou: InboxRowView[];
  alsoBlocked: InboxRowView[];
  /** Membership counts from distinct held rows (first-window-only during recheck); exact only with `complete`. */
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
  /** A nonfailed bounded recheck is in progress; retained continuation rows may be old. */
  rechecking: boolean;
}

export interface InboxPanel {
  model: InboxModel;
  more: () => void;
  retry: () => void;
  expand: (open: boolean) => void;
  device?: DeviceViewState;
  storeId?: string;
}

/** A held source-wide read is partitioned without another service read. Hidden details are
 * excluded before scope counts, including counts shown beside individual board plans. */
export function scopeInbox(model: InboxModel, keys: ReadonlySet<string> | null, complete: boolean, device?: DeviceViewState, store = '') {
  const hidden = model.needsYou.filter(r => device?.hidden(hiddenItemKey(store, r)));
  const visible = model.needsYou.filter(r => !hidden.includes(r));
  const inside = (r: InboxRowView) => keys === null || keys.has(r.planKey);
  const needsYou = visible.filter(inside), alsoBlocked = model.alsoBlocked.filter(inside);
  // During a changed/failed recheck the controller's count-authoritative rows are the
  // prefix from its refreshed first window. Retained later rows stay readable, not countable.
  const counted = model.needsYou.slice(0, model.counts.needsYou).filter(r => !hidden.includes(r));
  return { model: { ...model, needsYou, alsoBlocked, counts: {
    needsYou: counted.filter(inside).length,
    alsoBlocked: model.alsoBlocked.slice(0, model.counts.alsoBlocked).filter(inside).length,
  }, complete: model.complete && complete },
    hidden: hidden.filter(inside), other: counted.filter(r => !inside(r)).length };
}

const rowSignature = (r: InboxRowView) => [r.rowKey, r.revision, r.structuralRevision, r.cleanupRev, r.planTitle, r.task.title, r.group, r.mainSessionKind, r.coordinatorSessionId, r.blocker, r.ancestors, r.omittedAncestors, r.wait ? [r.wait.kind, r.wait.since] : null];
/** Presentation identity of a window: read time and receipt anchors are excluded on purpose. */
const windowSignature = (w: InboxWindowView) => JSON.stringify([w.storeId, w.sourceId, w.captureEnabled, w.timing, w.rows.map(rowSignature), w.counts, w.nextCursor, w.coverage]);
const firstSignature = (f: InboxFirst) => (f.state === 'ready' ? `ready:${windowSignature(f.window)}` : f.state);
/** Presentation group only; never changes the validated category-only wire group/counts. */
export function inboxGroup(r: InboxRowView): InboxRowView['group'] {
  const b = r.blocker;
  return b.state === 'reported' && isNeedsYou(b.category, b.reporterSessionId, r.coordinatorSessionId, r.mainSessionKind) ? 'needs-you' : 'also-blocked';
}

interface InboxDeps {
  service: (current: () => boolean) => ServiceHost;
  visible: () => boolean;
  changed: () => void;
  mono?: () => number;
  device?: DeviceViewState;
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
  /** Next loaded page to re-read; null means the last traversal finished. */
  private recheck: number | null = null;
  private automatic = 1;
  private authoritative = false;

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
    if (first.state === 'ready' && first.window.rows.every(row => row.mainSessionKind !== undefined)
      && first.window.coverage.complete && first.window.coverage.exhausted && !first.window.coverage.gapped && first.window.nextCursor === null) {
      void this.deps.device?.prune(first.window.storeId, first.window.sourceId, new Set(first.window.rows.filter(row => inboxGroup(row) === 'needs-you').map(row => hiddenItemKey(first.window.storeId, row))));
    }
    if (sig === this.firstSig) {
      if (this.recheck === null && this.pending === null && this.automatic < 8 && this.last()?.nextCursor && !this.failed) {
        this.automatic++; this.readPage(); return true;
      }
      // Keep an explicit request on this unchanged traversal alive, but include its page
      // in the next bounded sweep before allowing its counts to become authoritative.
      if (!this.pages.length && this.pending === null) return false;
      // Count authority is retired immediately, before the asynchronous re-read. Keep rows
      // readable under a rechecking notice, not as silently current reports.
      if (this.recheck === null) this.recheck = 0;
      if (this.pending === null) this.readPage(this.recheck);
      return true;
    }
    this.first = first; this.firstSig = sig;
    this.automatic = 1;
    this.authoritative = false;
    if (this.pages.length || this.pending !== null) {
      // Never splice windows of different traversals: restart visibly from the new first window.
      this.dropPages(true);
    }
    return true;
  }

  /** `reset`: identity/cache reset or disposal; `hidden`: retire in-flight continuation only. */
  retire(reason: 'reset' | 'hidden' | 'dispose') {
    if (reason === 'hidden') {
      this.authoritative = false;
      if (this.pending !== null) { this.pending = null; this.generation++; }
      this.recheck = this.pages.length ? 0 : null;
      return;
    }
    this.reset();
  }

  private reset() {
    this.owner = ''; this.first = null; this.firstSig = ''; this.pages = []; this.pagesBase = '';
    this.pending = null; this.generation++; this.failed = null; this.restarted = false; this.expanded = false;
    this.recheck = null;
    this.automatic = 1; this.authoritative = false;
  }

  private dropPages(restarted: boolean) {
    this.pages = []; this.pagesBase = ''; this.pending = null; this.generation++; this.failed = null;
    this.recheck = null;
    this.restarted = restarted;
    this.automatic = 1; this.authoritative = false;
  }

  private last(): InboxWindowView | null {
    return this.pages.at(-1) ?? (this.first?.state === 'ready' ? this.first.window : null);
  }

  model(): InboxModel | null {
    if (!this.first) return null;
    const empty = { needsYou: [], alsoBlocked: [], counts: { needsYou: 0, alsoBlocked: 0 }, complete: false, gapped: false, captureEnabled: true, timing: false, canContinue: false, loadingMore: false, moreFailed: null, restarted: false, expanded: false, rechecking: false };
    if (this.first.state !== 'ready') return { ...empty, availability: this.first.state };
    const windows = [this.first.window, ...this.pages];
    // Old revision-1 services have category groups but no main-session evidence. Never guess.
    if (windows.some(w => w.rows.some(r => r.mainSessionKind === undefined))) return { ...empty, availability: 'unsupported' };
    const last = windows.at(-1)!;
    const seen = new Set<string>();
    const counts = { needsYou: 0, alsoBlocked: 0 };
    const needsYou: InboxRowView[] = [], alsoBlocked: InboxRowView[] = [];
    for (const w of windows) for (const r of w.rows) {
      if (seen.has(r.rowKey)) continue; // a task is shown once across windows
      seen.add(r.rowKey);
      const primary = inboxGroup(r) === 'needs-you';
      (primary ? needsYou : alsoBlocked).push(r);
      // During a bounded recheck only the refreshed first window's rows support the count.
      if (this.recheck === null || this.authoritative || w === this.first.window) counts[primary ? 'needsYou' : 'alsoBlocked']++;
    }
    // Gaps anywhere in the traversal keep the whole result partial.
    const gapped = windows.some((w) => w.coverage.gapped);
    return {
      availability: 'ready', needsYou, alsoBlocked, counts,
      complete: (this.recheck === null || this.authoritative) && !this.failed && last.coverage.complete && last.coverage.exhausted && !gapped && last.nextCursor === null,
      gapped, captureEnabled: last.captureEnabled, timing: this.first.window.timing,
      canContinue: this.recheck === null && last.nextCursor !== null, loadingMore: this.pending !== null, moreFailed: this.failed, restarted: this.restarted, expanded: this.expanded, rechecking: this.recheck !== null && this.failed === null,
    };
  }

  panel(): InboxPanel | null {
    const model = this.model();
    if (!model) return null;
    const owner = this.owner;
    return {
      model,
      device: this.deps.device,
      storeId: this.first?.state === 'ready' ? this.first.window.storeId : '',
      // Controls painted under another store/binding do nothing.
      more: () => { if (this.owner === owner) this.more(); },
      retry: () => { if (this.owner === owner && this.failed) this.readPage(this.recheck ?? undefined); },
      expand: (open) => { if (this.owner === owner && this.expanded !== open) { this.expanded = open; this.deps.changed(); } },
    };
  }

  /** One explicit continuation window; never automatic, never while hidden or already loading. */
  more() {
    if (this.recheck !== null) return;
    this.readPage();
  }

  /** Replace one loaded page, or append one explicitly requested new page. */
  private readPage(index?: number) {
    const previous = index === undefined ? this.last() : index === 0 ? (this.first?.state === 'ready' ? this.first.window : null) : this.pages[index - 1];
    const last = previous;
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
      if (r.ok) {
        if (index === undefined) this.pages.push(r.window);
        else if (r.window.nextCursor !== this.pages[index]?.nextCursor) this.dropPages(true);
        else {
          if (windowSignature(r.window) !== windowSignature(this.pages[index])) this.authoritative = false;
          this.pages[index] = r.window;
          this.recheck = index + 1 < this.pages.length ? index + 1 : null;
        }
        if (this.recheck === null && this.model()?.complete) {
          this.authoritative = true;
          const windows = [this.first!.state === 'ready' ? this.first!.window : r.window, ...this.pages];
          void this.deps.device?.prune(r.window.storeId, r.window.sourceId, new Set(windows.flatMap(w => w.rows.filter(row => inboxGroup(row) === 'needs-you').map(row => hiddenItemKey(w.storeId, row)))));
        }
      }
      else if (r.status === 409) this.dropPages(true);
      else {
        this.authoritative = false;
        this.failed = r.failure;
        // A failed first append leaves no loaded pages to recheck. Normal explicit retry
        // is still available; failures with retained pages wait for the next refresh.
        if (!this.pages.length) this.recheck = null;
      }
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
