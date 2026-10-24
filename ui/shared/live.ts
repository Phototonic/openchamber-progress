// Live SDK enrichment: current labels, location and activity for recorded plans.
// SDK lists are incomplete in-memory coverage, so every lookup says whether it is covered.
import type { HostClient } from '@openchamber/sdk';
import { directoryWithin } from './model.ts';

// Mirrors of the SDK workspace types (not re-exported from the package entry).
export type LoadState = 'loading' | 'ready' | 'error';
export type Activity = 'unknown' | 'idle' | 'running' | 'retrying' | 'waiting-permission' | 'waiting-question';
export interface LiveProject { id: string; name: string; directory: string }
export interface LiveWorktree { directory: string; name: string; branch: string }
export interface LiveSession {
  id: string; title: string; projectId: string; directory: string; parentId: string | null;
  archivedAt: number | null; worktree: LiveWorktree | null; activity: Activity; outcome: 'completed' | 'failed' | null;
}

export interface LiveSnapshot {
  projectsState: LoadState | 'off';
  projects: LiveProject[];
  sessions: Map<string, { state: LoadState; records: LiveSession[] }>;
  /** Projects that wanted live coverage but were left out by the subscription cap. */
  capped: string[];
}

export const EMPTY_LIVE: LiveSnapshot = { projectsState: 'off', projects: [], sessions: new Map(), capped: [] };

export type Coverage =
  | { kind: 'live'; session: LiveSession; project?: LiveProject }
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'not-seen'; project?: LiveProject }
  | { kind: 'untracked' };

/** Deepest SDK project containing the directory. */
export function projectFor(directory: string, projects: LiveProject[]): LiveProject | undefined {
  if (!directory) return undefined;
  return projects.filter((p) => directoryWithin(directory, p.directory)).sort((a, b) => b.directory.length - a.directory.length)[0];
}

export function findSession(id: string, snap: LiveSnapshot): LiveSession | undefined {
  for (const entry of snap.sessions.values()) {
    const hit = entry.records.find((r) => r.id === id);
    if (hit) return hit;
  }
  return undefined;
}

export function coverageFor(sessionId: string, directory: string, snap: LiveSnapshot): Coverage {
  const session = findSession(sessionId, snap);
  if (session) return { kind: 'live', session, project: snap.projects.find((p) => p.id === session.projectId) };
  if (snap.projectsState === 'loading') return { kind: 'loading' };
  if (snap.projectsState === 'error') return { kind: 'error' };
  const project = projectFor(directory, snap.projects);
  const entry = project ? snap.sessions.get(project.id) : undefined;
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
  return { label: 'Not open in this window', tone: 'neutral' };
}

type Unsub = () => void;

/**
 * Owns this frame's workspace subscriptions: one projects stream plus at most `maxSessions`
 * session streams (the host allows 32 per frame). Promise-returned unsubscribers are kept and
 * released on change or disposal, including ones that resolve after they were dropped.
 */
export class LiveWorkspace {
  private snap: LiveSnapshot = { ...EMPTY_LIVE, sessions: new Map() };
  private projectsUnsub: Promise<Unsub | null> | null = null;
  private subs = new Map<string, Promise<Unsub | null>>();
  private disposed = false;

  private host: Pick<HostClient, 'onProjects' | 'onSessions'>;
  private maxSessions: number;
  private onChange: () => void;

  constructor(host: Pick<HostClient, 'onProjects' | 'onSessions'>, maxSessions: number, onChange: () => void) {
    this.host = host;
    this.maxSessions = maxSessions;
    this.onChange = onChange;
  }

  get snapshot() { return this.snap; }
  get subscriptionCount() { return (this.projectsUnsub ? 1 : 0) + this.subs.size; }

  start() {
    if (this.projectsUnsub || this.disposed) return;
    this.snap = { ...this.snap, projectsState: 'loading' };
    this.projectsUnsub = this.host.onProjects((s) => {
      if (this.disposed) return;
      this.snap = { ...this.snap, projectsState: s.state, projects: s.projects.map(({ id, name, directory }) => ({ id, name, directory })) };
      this.onChange();
    }).catch(() => {
      this.snap = { ...this.snap, projectsState: 'error' };
      this.onChange();
      return null;
    });
  }

  /** Subscribe to exactly these projects' sessions (first `maxSessions` of them). */
  want(projectIds: string[]) {
    if (this.disposed) return;
    const unique = [...new Set(projectIds)];
    const keep = unique.slice(0, this.maxSessions);
    const capped = unique.slice(this.maxSessions);
    for (const [id, sub] of this.subs) {
      if (keep.includes(id)) continue;
      this.subs.delete(id);
      this.snap.sessions.delete(id);
      void sub.then((u) => u?.());
    }
    for (const id of keep) {
      if (this.subs.has(id)) continue;
      this.snap.sessions.set(id, { state: 'loading', records: [] });
      const sub = this.host.onSessions(id, (s) => {
        if (this.disposed || this.subs.get(id) !== sub) return;
        this.snap.sessions.set(id, {
          state: s.state,
          records: s.sessions.map((r) => ({ id: r.id, title: r.title, projectId: r.projectId, directory: r.directory, parentId: r.parentId, archivedAt: r.archivedAt, worktree: r.worktree ? { directory: r.worktree.directory, name: r.worktree.name, branch: r.worktree.branch } : null, activity: r.activity, outcome: r.outcome })),
        });
        this.snap = { ...this.snap };
        this.onChange();
      }).catch(() => {
        if (this.subs.get(id) === sub) { this.snap.sessions.set(id, { state: 'error', records: [] }); this.snap = { ...this.snap }; this.onChange(); }
        return null;
      });
      this.subs.set(id, sub);
    }
    const changedCap = capped.join() !== this.snap.capped.join();
    this.snap = { ...this.snap, capped };
    if (changedCap) this.onChange();
  }

  /**
   * Re-subscribe everything. The host may drop a frame's workspace subscriptions on a context
   * change (session navigation) without telling the guest, so callers restart on those changes.
   */
  restart() {
    if (this.disposed) return;
    const wanted = [...this.subs.keys(), ...this.snap.capped];
    for (const sub of this.subs.values()) void sub.then((u) => u?.());
    this.subs.clear();
    void this.projectsUnsub?.then((u) => u?.());
    this.projectsUnsub = null;
    this.snap = { projectsState: 'off', projects: this.snap.projects, sessions: new Map(), capped: [] };
    this.start();
    this.want(wanted);
  }

  dispose() {
    this.disposed = true;
    for (const sub of this.subs.values()) void sub.then((u) => u?.());
    this.subs.clear();
    void this.projectsUnsub?.then((u) => u?.());
    this.projectsUnsub = null;
  }
}

/** A short, stable label for a session id when the host has no title for it. */
export function sessionLabel(id: string, snap: LiveSnapshot) {
  const s = findSession(id, snap);
  if (s?.title) return s.title;
  const short = id.length > 10 ? `…${id.slice(-6)}` : id;
  return `Session ${short}`;
}
