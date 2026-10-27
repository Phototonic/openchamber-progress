// "Since you last reviewed": full-page History only (docs/ui.md, Change digests). One active visit
// per frame, for the plan whose History the page paints. Each visit reads the device checkpoint,
// pins ONE interval (saved baseline → listed target) and keeps it through polls and repaints; a
// newer revision only offers Refresh. Only an explicit, trusted Mark reviewed activation on a
// loaded, visible digest writes, and only its displayed target, after one bounded live preflight.
// Generations retire every held reply on leaving History, selection/identity/cleanup changes,
// hidden frames and disposal; a retired callback cannot paint, start work or enable controls.
import { canonicalIdentity, CheckpointStore, type CheckpointFailure, type CheckpointIdentity, type DeviceStorage } from './change-digest-checkpoint.ts';
import type { DigestView, Lifecycle, PlanView } from './model.ts';
import { readChangeDigest, readPlanHead, type ReadFailure, type ServiceHost } from './source.ts';

export type DigestUnavailable =
  | { reason: 'service' }
  | { reason: 'checkpoint'; checkpoint: CheckpointFailure }
  | { reason: 'ahead'; saved: number; latest: number }
  | { reason: 'missing' }
  | { reason: 'conflict' }
  | { reason: 'read'; failure: ReadFailure };
export type ReviewState = 'idle' | 'pending' | 'saved' | 'already' | 'failed' | 'stale';

/** What one paint may show and do. Actions of a retired visit or generation do nothing. */
export interface DigestPanel {
  state: 'loading' | 'unavailable' | 'ready';
  unavailable: DigestUnavailable | null;
  digest: DigestView | null;
  /** Newest revision known beyond the pinned target (listed or live at read), or null. */
  newer: number | null;
  /** A higher acknowledgement recorded after this digest loaded (another window or tab). */
  elsewhere: number | null;
  /** The plan's lifecycle or cleanup moved since this digest was read: refresh before review. */
  needsRefresh: boolean;
  review: ReviewState;
  reviewedThrough: number | null;
  canReview: boolean;
  canRefresh: boolean;
  /** Last explicit outcome (loading, review, navigation); never poll chatter. */
  status: string;
  /** Identity of that outcome: announce once per id, not once per repaint. */
  statusId: number;
  /** Mark reviewed: acts only on a trusted (real keyboard/pointer) activation. */
  markReviewed: (activation: { isTrusted: boolean }) => void;
  refresh: () => void;
  announce: (text: string) => void;
}

export interface DigestClaim {
  identity: CheckpointIdentity;
  plan: PlanView;
  /** The service advertises planChangeDigests:1. */
  capable: boolean;
  /** The current list read succeeded (no stale banner). */
  fresh: boolean;
}

export interface DigestHost {
  /** Service proxy whose requests are refused once `current()` is false (no continuation after retirement). */
  service: (current: () => boolean) => ServiceHost;
  storage: DeviceStorage;
  deviceStorage: () => boolean;
  visible: () => boolean;
  changed: () => void;
}

type Phase = { kind: 'loading' } | { kind: 'unavailable'; why: DigestUnavailable } | { kind: 'ready'; digest: DigestView };
interface Visit {
  key: string;
  identity: CheckpointIdentity;
  plan: PlanView;
  capable: boolean;
  fresh: boolean;
  /** Listed lifecycle when the current sequence started. */
  lifecycle: Lifecycle;
  generation: number;
  phase: Phase;
  review: ReviewState;
  reviewedThrough: number | null;
  elsewhere: number | null;
  needsRefresh: boolean;
  checkpointFailed: boolean;
  status: string;
  /** Changes with every explicit outcome, so the page announces each one exactly once. */
  statusId: number;
  /** Hidden while loading: the sequence was retired and restarts when visible. */
  resume: boolean;
  reloading: boolean;
}

const cleanupOf = (p: PlanView) => `${p.cleanup?.state ?? 'visible'}:${p.cleanup?.revision ?? 0}`;
const sameBinding = (a: CheckpointIdentity['binding'], b: { sourceId: string | null; verified: boolean }) => a.sourceId === b.sourceId && a.verified === b.verified;

export const REVIEW_COPY: Record<CheckpointFailure, string> = {
  unsupported: 'This OpenChamber version can’t save a review point on this device.',
  denied: 'Saving a review point was refused in this profile.',
  quota: 'Storage for this extension is full in this profile, so the review point wasn’t saved.',
  malformed: 'The saved review point in this profile is unreadable.',
  failed: 'The review point in this profile couldn’t be read or saved.',
  disagreement: 'The review point in this profile kept changing while it was read.',
};

export class DigestController {
  private visit: Visit | null = null;
  private statusSeq = 0;
  private claimed = false;
  private generation = 0;
  private disposed = false;
  readonly checkpoints: CheckpointStore;
  /** Diagnostic counters for QA (requests are counted by the host shell; these are local). */
  readonly counts = { sequences: 0, digestReads: 0, preflights: 0, checkpointReads: 0, writes: 0 };

  private readonly host: DigestHost;
  constructor(host: DigestHost) {
    this.host = host;
    this.checkpoints = new CheckpointStore(host.storage, host.deviceStorage);
  }

  /** Every paint: visits not claimed during it are retired at endPaint (leaving History or the plan). */
  beginPaint() { this.claimed = false; }
  endPaint() { if (!this.claimed && this.visit) this.retire(); }

  private retire() { this.visit = null; this.generation++; }
  private say(v: Visit, text: string) { v.status = text; v.statusId = text ? ++this.statusSeq : 0; }

  /**
   * The page paints History of `claim.plan`. Same context: the pinned digest stays; a different
   * account/store/binding/plan or cleanup generation (archive/restore) starts a new visit.
   */
  claim(claim: DigestClaim): DigestPanel {
    this.claimed = true;
    const p = claim.plan;
    const key = JSON.stringify([canonicalIdentity(claim.identity), cleanupOf(p), claim.capable]);
    let v = this.visit;
    if (!v || v.key !== key) {
      this.generation++;
      v = this.visit = {
        key, identity: claim.identity, plan: p, capable: claim.capable, fresh: claim.fresh, lifecycle: p.lifecycle, generation: this.generation,
        phase: { kind: 'loading' }, review: 'idle', reviewedThrough: null, elsewhere: null, needsRefresh: false, checkpointFailed: false, status: '', statusId: 0, resume: false, reloading: false,
      };
      if (this.host.visible() && !this.disposed) void this.start(v, false); else v.resume = true;
    } else {
      v.plan = p; v.fresh = claim.fresh;
      // Reopen/finish keeps identity and checkpoint but retires in-flight display/actions.
      if (p.lifecycle !== v.lifecycle) {
        if (v.phase.kind === 'loading' && !v.resume) void this.start(v, false);
        else if (!v.needsRefresh) {
          v.needsRefresh = true; v.generation = ++this.generation; v.reloading = false;
          if (v.review === 'pending') v.review = 'idle';
          this.say(v, 'This plan’s outcome changed. Refresh the digest before marking it reviewed.');
        }
      }
    }
    return this.panel(v);
  }

  private current(v: Visit, generation: number) {
    return () => !this.disposed && this.visit === v && v.generation === generation && this.host.visible();
  }

  /** History entry or explicit Refresh: checkpoint → (lagging list: one live read) → one pinned digest. */
  private async start(v: Visit, explicit: boolean) {
    const generation = v.generation = ++this.generation;
    const current = this.current(v, generation);
    // A refresh may target the live revision the last read saw, even while the list lags.
    const last = v.phase.kind === 'ready' ? v.phase.digest.interval.latestRevision : 0;
    v.phase = { kind: 'loading' }; v.resume = false; v.reloading = false; v.needsRefresh = false; v.elsewhere = null; v.checkpointFailed = false;
    v.lifecycle = v.plan.lifecycle;
    if (v.review !== 'saved' || explicit) v.review = 'idle';
    this.say(v, explicit ? 'Refreshing changes since your last review…' : '');
    this.counts.sequences++;
    if (!v.capable) { v.phase = { kind: 'unavailable', why: { reason: 'service' } }; return; }
    this.counts.checkpointReads++;
    const saved = await this.checkpoints.read(v.identity);
    if (!current()) return;
    if (saved.state === 'unavailable') return this.settle(v, { kind: 'unavailable', why: { reason: 'checkpoint', checkpoint: saved.reason } });
    const after = saved.state === 'saved' ? saved.revision : null;
    let to = Math.max(v.plan.revision, last);
    if (after !== null && after > to) {
      // A checkpoint ahead of a lagging list: one authoritative metadata read, never a reversed interval.
      this.counts.preflights++;
      const head = await readPlanHead(this.host.service(current), { sourceId: v.identity.source, id: v.identity.plan });
      if (!current()) return;
      if (!head.ok) return this.failed(v, head.status, head.failure);
      if (!this.sameLive(v, head.envelope, head.plan)) return this.settle(v, { kind: 'unavailable', why: { reason: 'conflict' } });
      if (head.plan.revision < after) return this.settle(v, { kind: 'unavailable', why: { reason: 'ahead', saved: after, latest: head.plan.revision } });
      to = head.plan.revision;
    }
    this.counts.digestReads++;
    const r = await readChangeDigest(this.host.service(current), { storeId: v.identity.storeId, source: v.identity.source, plan: v.identity.plan, to, cleanupRev: v.plan.cleanup?.revision ?? 0, after });
    if (!current()) return;
    if (!r.ok) return this.failed(v, r.status, r.failure);
    if (!sameBinding(v.identity.binding, r.digest.sourceBinding) || r.digest.cleanup.state !== (v.plan.cleanup?.state ?? 'visible')) return this.settle(v, { kind: 'unavailable', why: { reason: 'conflict' } });
    v.reviewedThrough = after;
    if (explicit) this.say(v, 'Digest refreshed.');
    this.settle(v, { kind: 'ready', digest: r.digest });
  }

  private settle(v: Visit, phase: Phase) {
    v.phase = phase;
    if (phase.kind !== 'ready' && v.status.startsWith('Refreshing')) this.say(v, '');
    this.host.changed();
  }

  private failed(v: Visit, status: number | null, failure: ReadFailure) {
    if (status === 404 && failure.code === 'not-found') {
      // Authoritative absence of exactly this plan: retire its markers (best effort).
      void this.checkpoints.forget(v.identity);
      return this.settle(v, { kind: 'unavailable', why: { reason: 'missing' } });
    }
    if (status === 409) return this.settle(v, { kind: 'unavailable', why: { reason: 'conflict' } });
    this.settle(v, { kind: 'unavailable', why: { reason: 'read', failure } });
  }

  private sameLive(v: Visit, envelope: { storeId: string; binding: { sourceId: string | null; verified: boolean } }, p: PlanView) {
    return envelope.storeId === v.identity.storeId && sameBinding(v.identity.binding, envelope.binding) && p.sourceId === v.identity.source && p.id === v.identity.plan && cleanupOf(p) === cleanupOf(v.plan);
  }

  /** Visible/focus return: re-read only the checkpoint (coalesced). Displayed text never changes. */
  private async reload(v: Visit) {
    if (v.phase.kind !== 'ready' || v.reloading || v.review === 'pending' || !this.host.visible()) return;
    v.reloading = true;
    const generation = v.generation;
    this.counts.checkpointReads++;
    const saved = await this.checkpoints.read(v.identity);
    if (this.disposed || this.visit !== v || v.generation !== generation) return;
    v.reloading = false;
    const failed = saved.state === 'unavailable';
    const elsewhere = saved.state === 'saved' && saved.revision > Math.max(v.reviewedThrough ?? 0, v.elsewhere ?? 0) ? saved.revision : v.elsewhere;
    if (failed === v.checkpointFailed && elsewhere === v.elsewhere) return;
    v.checkpointFailed = failed; v.elsewhere = elsewhere;
    this.host.changed();
  }

  visible() {
    const v = this.visit;
    if (!v || this.disposed) return;
    if (v.resume) void this.start(v, false); else void this.reload(v);
  }
  focus() { if (this.visit && !this.disposed) void this.reload(this.visit); }
  hidden() {
    const v = this.visit;
    if (!v) return;
    // Hidden frames start nothing; an in-flight sequence is retired and restarts when shown.
    if (v.phase.kind === 'loading') { v.generation = ++this.generation; v.resume = true; }
  }
  dispose() { this.disposed = true; this.retire(); }
  /** Authoritative deletion of a plan (this frame's own confirmed delete). */
  forget(identity: CheckpointIdentity) {
    if (this.visit && canonicalIdentity(this.visit.identity) === canonicalIdentity(identity)) this.retire();
    void this.checkpoints.forget(identity);
  }

  private canReview(v: Visit) {
    if (v.phase.kind !== 'ready' || !v.phase.digest.validTarget || v.needsRefresh || v.checkpointFailed || !v.fresh || v.review === 'pending' || v.review === 'stale') return false;
    const to = v.phase.digest.interval.to;
    return (v.reviewedThrough ?? 0) < to && (v.elsewhere ?? 0) < to;
  }

  private panel(v: Visit): DigestPanel {
    const generation = v.generation;
    const live = () => !this.disposed && this.visit === v && v.generation === generation;
    const digest = v.phase.kind === 'ready' ? v.phase.digest : null;
    const newest = digest ? Math.max(v.plan.revision, digest.interval.latestRevision) : null;
    return {
      state: v.phase.kind, unavailable: v.phase.kind === 'unavailable' ? v.phase.why : null, digest,
      newer: digest && newest !== null && newest > digest.interval.to ? newest : null,
      elsewhere: v.elsewhere, needsRefresh: v.needsRefresh, review: v.review, reviewedThrough: v.reviewedThrough,
      canReview: this.canReview(v) && this.host.visible(),
      canRefresh: v.phase.kind !== 'loading' && v.review !== 'pending',
      status: v.status, statusId: v.statusId,
      markReviewed: (activation) => { if (activation.isTrusted && live()) void this.markReviewed(v, generation); },
      refresh: () => { if (live() && v.phase.kind !== 'loading' && v.review !== 'pending' && this.host.visible()) { void this.start(v, true); this.host.changed(); } },
      announce: (text) => { if (live()) { this.say(v, text); this.host.changed(); } },
    };
  }

  /**
   * Explicit acknowledgement of the DISPLAYED target only. Captures identity/target/cleanup and
   * generation, rechecks the live plan with one first-page read, merges with a newer recorded
   * acknowledgement (never rewinds), then writes. A write already dispatched finishes under its
   * captured identity; a retired completion cannot change this view or mark another context.
   */
  private async markReviewed(v: Visit, generation: number) {
    if (!this.canReview(v) || !this.host.visible() || v.phase.kind !== 'ready') return;
    const digest = v.phase.digest, to = digest.interval.to, identity = v.identity;
    const current = this.current(v, generation);
    v.review = 'pending'; this.say(v, 'Saving your review…'); this.host.changed();
    const abandon = () => { if (this.visit === v && v.generation === generation && v.review === 'pending') { v.review = 'idle'; this.say(v, 'Review not saved. Mark reviewed again when you are ready.'); this.host.changed(); } };
    const stop = (review: ReviewState, status: string) => { v.review = review; this.say(v, status); this.host.changed(); };
    this.counts.preflights++;
    const head = await readPlanHead(this.host.service(current), { sourceId: identity.source, id: identity.plan });
    if (!current()) return abandon();
    if (!head.ok) {
      if (head.status === 404 && head.failure.code === 'not-found') {
        void this.checkpoints.forget(identity);
        v.review = 'idle'; this.say(v, 'This plan is no longer available, so it was not marked reviewed.');
        return this.settle(v, { kind: 'unavailable', why: { reason: 'missing' } });
      }
      return stop('failed', 'The plan couldn’t be checked, so nothing was saved. Try again.');
    }
    if (!this.sameLive(v, head.envelope, head.plan) || head.plan.lifecycle !== digest.interval.currentLifecycle || head.plan.revision < to) {
      v.needsRefresh = true;
      return stop('stale', 'This plan changed since the digest loaded. Refresh the digest before marking it reviewed.');
    }
    this.counts.checkpointReads++;
    const saved = await this.checkpoints.read(identity);
    if (!current()) return abandon();
    if (saved.state === 'unavailable') { v.checkpointFailed = true; return stop('failed', `${REVIEW_COPY[saved.reason]} Your previous review point is unchanged.`); }
    if (saved.state === 'saved' && saved.revision >= to) {
      v.reviewedThrough = saved.revision;
      if (saved.revision > to) v.elsewhere = saved.revision;
      return stop('already', `Already reviewed through revision ${saved.revision}. Refresh the digest to compare from there.`);
    }
    this.counts.writes++;
    const written = await this.checkpoints.write(identity, to);
    if (this.disposed || this.visit !== v || v.generation !== generation) return;
    if (written.ok) { v.reviewedThrough = to; return stop('saved', `Marked reviewed through revision ${to}. Later changes will appear in the next digest.`); }
    stop('failed', `${REVIEW_COPY[written.reason]} Your previous review point is unchanged.`);
  }
}
