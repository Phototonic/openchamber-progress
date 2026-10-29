// Live SDK enrichment: current labels, location and activity for recorded plans.
// SDK lists are incomplete in-memory coverage, so every lookup says whether it is covered.
import type { HostClient } from '@openchamber/sdk';
import { directoryWithin } from './model.ts';
import { directoryKey } from './path.ts';

// Mirrors of the SDK workspace types (not re-exported from the package entry).
export type LoadState = 'loading' | 'ready' | 'error';
export type Activity = 'unknown' | 'idle' | 'running' | 'retrying' | 'waiting-permission' | 'waiting-question';
export interface LiveProject { id: string; name: string; directory: string }
export interface LiveWorktree { directory: string; name: string; branch: string }
export interface KnownWorktree extends LiveWorktree { status: 'ready' | 'pending' | 'invalid' | 'missing' }
export interface LiveSession {
  id: string; title: string; projectId: string; directory: string; parentId: string | null;
  archivedAt: number | null; worktree: LiveWorktree | null; activity: Activity; outcome: 'completed' | 'failed' | null;
  /** Host creation time: display order only, never an activity time. */
  createdAt?: number;
  /**
   * Receipt of this session's last qualifying observation in this subscription: wall time for the
   * label, monotonic time for expiry. Only a changed activity/outcome (or the first record after
   * subscribing) qualifies; title, other-session and unchanged callbacks keep the old receipt.
   */
  seenAt?: number;
  seenMono?: number;
}
export interface DirectoryCoverage { directory: string; state: LoadState }

export interface LiveSnapshot {
  projectsState: LoadState | 'off';
  projects: LiveProject[];
  worktrees: Map<string, { state: LoadState; records: KnownWorktree[] }>;
  /** `coverage`: the host's per-directory session coverage; absent from older fixtures/hosts. */
  sessions: Map<string, { state: LoadState; records: LiveSession[]; coverage?: DirectoryCoverage[] }>;
  /** Projects that wanted live coverage but were left out by the subscription cap. */
  capped: string[];
}

export const EMPTY_LIVE: LiveSnapshot = { projectsState: 'off', projects: [], worktrees: new Map(), sessions: new Map(), capped: [] };

export type Coverage =
  | { kind: 'live'; session: LiveSession; project?: LiveProject }
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'not-seen'; project?: LiveProject }
  | { kind: 'untracked' };

/** SDK path IDs and captured repository IDs are different namespaces. Only an exact
 * configured checkout or a ready, unambiguous worktree establishes membership. Broad
 * containment (notably Home) cannot establish ownership of an unknown checkout. */
export function projectFor(directory: string, snap: LiveSnapshot): LiveProject | undefined {
  if (!directory) return undefined;
  const dir = directoryKey(directory);
  const matches = snap.projects.filter((p) => {
    if (dir === directoryKey(p.directory)) return true;
    const trees = snap.worktrees.get(p.id);
    return trees?.state === 'ready' && trees.records.some((w) => w.status === 'ready' && directoryWithin(dir, w.directory));
  });
  return matches.length === 1 ? matches[0] : undefined;
}

export function findSession(id: string, snap: LiveSnapshot): LiveSession | undefined {
  let found: LiveSession | undefined;
  for (const entry of snap.sessions.values()) {
    if (entry.state !== 'ready') continue;
    const hit = entry.records.find((r) => r.id === id);
    if (hit && found && (hit.projectId !== found.projectId || directoryKey(hit.directory) !== directoryKey(found.directory))) return undefined;
    if (hit) found = hit;
  }
  return found;
}

/** One resolver for board membership and the session streams that can enrich it. */
export function planProject(sessionId: string, directory: string, snap: LiveSnapshot) {
  const session = findSession(sessionId, snap);
  return (session ? snap.projects.find((p) => p.id === session.projectId) : undefined) ?? projectFor(directory, snap);
}

export function coverageFor(sessionId: string, directory: string, snap: LiveSnapshot): Coverage {
  const session = findSession(sessionId, snap);
  if (session) return { kind: 'live', session, project: snap.projects.find((p) => p.id === session.projectId) };
  if (snap.projectsState === 'loading') return { kind: 'loading' };
  if (snap.projectsState === 'error') return { kind: 'error' };
  const project = projectFor(directory, snap);
  const entry = project ? snap.sessions.get(project.id) : undefined;
  if (!project && snap.projects.some((p) => snap.worktrees.get(p.id)?.state === 'loading')) return { kind: 'loading' };
  if (!project && snap.projects.some((p) => snap.worktrees.get(p.id)?.state === 'error')) return { kind: 'error' };
  if (!project || !entry) return { kind: 'untracked' };
  if (entry.state === 'loading') return { kind: 'loading' };
  if (entry.state === 'error') return { kind: 'error' };
  return { kind: 'not-seen', project };
}

/** Navigation only to a session this host currently lists; anything else has no target. */
export const canNavigate = (c: Coverage): c is Extract<Coverage, { kind: 'live' }> => c.kind === 'live';

/**
 * Navigation needs both: the plan's source is the service's verified binding, and the
 * session is in this host's current SDK coverage. Anything else stays readable only.
 */
export const canOpen = (planSourceId: string, boundSource: string | null, c: Coverage) => boundSource !== null && planSourceId === boundSource && canNavigate(c);

export const ACTIVITY_LABEL: Record<Activity, string> = {
  running: 'Running', retrying: 'Retrying', 'waiting-permission': 'Waiting for permission', 'waiting-question': 'Waiting for an answer', idle: 'Idle', unknown: 'State unknown',
};
export const ACTIVITY_TONE: Record<Activity, 'info' | 'warning' | 'neutral'> = {
  running: 'info', retrying: 'warning', 'waiting-permission': 'warning', 'waiting-question': 'warning', idle: 'neutral', unknown: 'neutral',
};

/** Plain-language live state for a session, distinct from task progress. */
export function liveLabel(c: Coverage): { label: string; tone: 'info' | 'warning' | 'neutral'; activity?: Activity } {
  if (c.kind === 'live') return { label: ACTIVITY_LABEL[c.session.activity], tone: ACTIVITY_TONE[c.session.activity], activity: c.session.activity };
  if (c.kind === 'loading') return { label: 'Checking…', tone: 'neutral' };
  if (c.kind === 'error') return { label: 'Live state unavailable', tone: 'neutral' };
  if (c.kind === 'untracked') return { label: 'Live state unavailable', tone: 'neutral' };
  return { label: 'Not open in this window', tone: 'neutral' };
}

/** Retained receipts per session stream: the host lists at most 2,000 sessions. */
const SEEN_LIMIT = 4000;

type Unsub = () => void;
type Subscription = { release: Promise<Unsub | null> };
type WorkspaceHost = Pick<HostClient, 'onProjects' | 'onWorktrees' | 'onSessions'>;

/**
 * One projects stream, at most maxSessions session streams, and the remaining slots
 * (of 32) for configured-project worktree discovery. Discovery never opens projects or
 * subscribes to all sessions. Unwatched projects remain unknown, not negative evidence.
 */
export class LiveWorkspace {
  private snap: LiveSnapshot = { ...EMPTY_LIVE, worktrees: new Map(), sessions: new Map() };
  private projectsSub: Subscription | null = null;
  private subs = new Map<string, Subscription>();
  private trees = new Map<string, Subscription>();
  private disposed = false;
  private started = false;
  private wanted: string[] = [];
  private queued = false;
  private releasing: Promise<unknown>[] = [];
  private host: WorkspaceHost;
  private maxSessions: number;
  private onChange: () => void;

  constructor(host: WorkspaceHost, maxSessions: number, onChange: () => void) {
    this.host = host;
    this.maxSessions = Math.max(0, Math.min(16, maxSessions));
    this.onChange = onChange;
  }

  get snapshot() { return this.snap; }
  get subscriptionCount() { return (this.projectsSub ? 1 : 0) + this.subs.size + this.trees.size; }
  get sessionSubscriptionCount() { return this.subs.size; }

  start() {
    if (this.started || this.disposed) return;
    this.started = true;
    this.snap = { ...this.snap, projectsState: 'loading' };
    this.queue();
  }

  /** Subscribe to exactly these projects' sessions (first `maxSessions` of them). */
  want(projectIds: string[]) {
    if (this.disposed) return;
    this.wanted = [...new Set(projectIds)];
    this.queue();
  }

  private release(sub: Subscription) {
    this.releasing.push(sub.release.then((u) => u?.()));
  }

  /** Wait for old unsubscribe promises before replacing their slots, including restarts.
   * Tokens invalidate callbacks immediately, even if the host resolves cleanup late. */
  private queue() {
    if (this.queued) return;
    this.queued = true;
    queueMicrotask(async () => {
      while (this.releasing.length) await Promise.allSettled(this.releasing.splice(0));
      this.queued = false;
      if (!this.started || this.disposed) return;
      this.reconcile();
    });
  }

  private reconcile() {
    if (!this.projectsSub) {
      const sub: Subscription = { release: Promise.resolve(null) };
      this.projectsSub = sub;
      sub.release = this.host.onProjects((s) => {
        if (this.projectsSub !== sub) return;
        // A reused path ID with a changed root is a different discovery scope.
        for (const p of this.snap.projects) if (!s.projects.some((n) => n.id === p.id && directoryKey(n.directory) === directoryKey(p.directory)) || s.state !== 'ready') this.drop(p.id);
        this.snap = { ...this.snap, projectsState: s.state, projects: s.state === 'ready' ? s.projects : [] };
        this.queue(); this.onChange();
      }).catch(() => {
        if (this.projectsSub === sub) {
          for (const p of this.snap.projects) this.drop(p.id);
          this.snap = { ...this.snap, projectsState: 'error', projects: [] };
          this.queue(); this.onChange();
        }
        return null;
      });
    }
    const projects = this.snap.projects;
    const discover = projects.slice(0, 31 - this.maxSessions).map((p) => p.id);
    const wanted = this.wanted.filter((id) => projects.some((p) => p.id === id));
    const keep = wanted.slice(0, this.maxSessions);
    const capped = wanted.slice(this.maxSessions);
    let changed = capped.join() !== this.snap.capped.join();
    this.snap.capped = capped;
    for (const [id, sub] of this.subs) if (!keep.includes(id)) {
      this.subs.delete(id); this.snap.sessions.delete(id); this.release(sub); changed = true;
    }
    for (const [id, sub] of this.trees) if (!discover.includes(id)) {
      this.trees.delete(id); this.snap.worktrees.delete(id); this.release(sub); changed = true;
    }
    if (this.releasing.length) { this.queue(); if (changed) this.onChange(); return; }
    for (const id of discover) if (!this.trees.has(id)) {
      const sub: Subscription = { release: Promise.resolve(null) };
      this.trees.set(id, sub);
      this.snap.worktrees.set(id, { state: 'loading', records: [] }); changed = true;
      sub.release = this.host.onWorktrees(id, (s) => {
        if (this.trees.get(id) !== sub) return;
        const previous = this.snap.worktrees.get(id);
        const records = s.state === 'ready' ? s.worktrees : [];
        const membership = (rows: KnownWorktree[]) => JSON.stringify(rows.map((w) => [w.directory, w.status]));
        const changed = previous?.state !== s.state || membership(previous?.records ?? []) !== membership(records);
        this.snap.worktrees.set(id, { state: s.state, records });
        // Membership removal must not leave stale session enrichment claiming ownership.
        const sessionSub = this.subs.get(id);
        if (changed && sessionSub) { this.subs.delete(id); this.snap.sessions.delete(id); this.release(sessionSub); }
        this.queue(); this.onChange();
      }).catch(() => {
        if (this.trees.get(id) === sub) {
          this.snap.worktrees.set(id, { state: 'error', records: [] });
          const sessionSub = this.subs.get(id);
          if (sessionSub) { this.subs.delete(id); this.snap.sessions.delete(id); this.release(sessionSub); }
          this.queue(); this.onChange();
        }
        return null;
      });
    }
    if (this.releasing.length) { this.queue(); if (changed) this.onChange(); return; }
    for (const id of keep) if (!this.subs.has(id)) {
      const sub: Subscription = { release: Promise.resolve(null) };
      this.subs.set(id, sub);
      this.snap.sessions.set(id, { state: 'loading', records: [] }); changed = true;
      // Per-subscription receipts. A new subscription (restart, context change, refusal) starts with
      // none, so a first appearance is an observation. Within one subscription only a changed
      // activity/outcome renews a session: the host's periodic loading → ready reload, an error
      // phase, a disappearance and an unchanged ready snapshot all keep the earlier receipt.
      const seen = new Map<string, { sig: string; at: number; mono: number }>();
      let lastReady: LiveSession[] | null = null;
      sub.release = this.host.onSessions(id, (s) => {
        if (this.subs.get(id) !== sub) return;
        const coverage = Array.isArray(s.coverage) ? s.coverage.map((c) => ({ directory: c.directory, state: c.state })) : undefined;
        if (s.state !== 'ready') {
          // A reload keeps the last ready rows (as not current, census.ts); a failure shows none.
          this.snap.sessions.set(id, { state: s.state, records: s.state === 'loading' && lastReady ? lastReady : [], coverage });
          this.onChange();
          return;
        }
        const at = Date.now(), mono = performance.now();
        const current = new Set<string>();
        const records = s.sessions.map((r): LiveSession => {
          const sig = `${r.activity}|${r.outcome}`;
          const before = seen.get(r.id);
          const receipt = before && before.sig === sig ? before : { sig, at, mono };
          seen.set(r.id, receipt); current.add(r.id);
          return { id: r.id, title: r.title, projectId: r.projectId, directory: r.directory, parentId: r.parentId, archivedAt: r.archivedAt, worktree: r.worktree ? { directory: r.worktree.directory, name: r.worktree.name, branch: r.worktree.branch } : null, activity: r.activity, outcome: r.outcome, createdAt: Number.isFinite(r.createdAt) ? r.createdAt : undefined, seenAt: receipt.at, seenMono: receipt.mono };
        });
        // Bounded: receipts of sessions no longer listed go once the map outgrows the host's cap.
        if (seen.size > SEEN_LIMIT) for (const key of seen.keys()) if (!current.has(key)) seen.delete(key);
        lastReady = records;
        // Absent coverage (an older host) cannot establish a complete census.
        this.snap.sessions.set(id, { state: 'ready', records, coverage });
        this.onChange();
      }).catch(() => {
        if (this.subs.get(id) === sub) { this.snap.sessions.set(id, { state: 'error', records: [] }); this.onChange(); }
        return null;
      });
    }
    if (changed) this.onChange();
  }

  private drop(id: string) {
    for (const map of [this.subs, this.trees]) {
      const sub = map.get(id);
      if (sub) { map.delete(id); this.release(sub); }
    }
    this.snap.sessions.delete(id); this.snap.worktrees.delete(id);
  }

  /**
   * Re-subscribe everything. The host may drop a frame's workspace subscriptions on a context
   * change (session navigation) without telling the guest, so callers restart on those changes.
   */
  restart() {
    if (this.disposed) return;
    this.clear();
    this.started = false;
    this.start();
    this.onChange();
  }

  private clear() {
    for (const id of new Set([...this.subs.keys(), ...this.trees.keys()])) this.drop(id);
    if (this.projectsSub) this.release(this.projectsSub);
    this.projectsSub = null;
    this.snap = { ...EMPTY_LIVE, worktrees: new Map(), sessions: new Map() };
  }

  dispose() {
    this.disposed = true;
    this.clear();
    this.queue();
  }
}

/** A short, stable label for a session id when the host has no title for it. */
export function sessionLabel(id: string, snap: LiveSnapshot) {
  const s = findSession(id, snap);
  if (s?.title) return s.title;
  const short = id.length > 10 ? `…${id.slice(-6)}` : id;
  return `Session ${short}`;
}
