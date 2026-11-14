// Pure validation for the panel's native open-mode item. The app owns its lifetime.
import { projectFor, type LiveSnapshot } from './live.ts';
import { directoryKey } from './path.ts';
import type { StoreRead } from './model.ts';

export type ProgressTarget = { id: string; directory: string };
export type ProgressItem = { kind: 'ordinary' } | { kind: 'invalid' } | { kind: 'target'; target: ProgressTarget };
export type ProgressContextState = 'checking' | 'unavailable' | 'invalid';
const bounded = (v: unknown, max: number): v is string => typeof v === 'string' && !!v.trim() && v.length <= max && !/[\u0000-\u001f\u007f]/u.test(v);

export function progressItem(value: unknown): ProgressItem {
  if (value === null || value === undefined) return { kind: 'ordinary' };
  if (typeof value !== 'object' || Array.isArray(value)) return { kind: 'invalid' };
  const v = value as Record<string, unknown>;
  if (v.kind !== 'session' || v.action !== 'open-progress' || !bounded(v.sessionId, 200) || !bounded(v.directory, 4096)) return { kind: 'invalid' };
  if (!/^(?:\/|[a-z]:[\\/]|\\\\)/iu.test(v.directory)) return { kind: 'invalid' };
  // Titles and transcripts are deliberately not retained or used as identity.
  return { kind: 'target', target: { id: v.sessionId, directory: v.directory } };
}

export function progressTargetState(target: ProgressTarget, live: LiveSnapshot): ProgressContextState | null {
  if (live.projectsState === 'loading' || live.projectsState === 'off') return 'checking';
  if (live.projectsState !== 'ready') return 'unavailable';
  const project = projectFor(target.directory, live);
  if (!project) return [...live.worktrees.values()].some(v => v.state === 'loading') ? 'checking' : 'unavailable';
  const entry = live.sessions.get(project.id);
  if (!entry || entry.state === 'loading') return 'checking';
  if (entry.state !== 'ready') return 'unavailable';
  // Require exactly one current identity, not findSession's first same-ID row.
  const hits = [...live.sessions.values()].filter(v => v.state === 'ready').flatMap(v => v.records).filter(v => v.id === target.id);
  if (hits.length !== 1 || hits[0].projectId !== project.id || directoryKey(hits[0].directory) !== directoryKey(target.directory)) return 'unavailable';
  const coverage = entry.coverage?.filter(v => directoryKey(v.directory) === directoryKey(target.directory));
  return coverage?.length === 1 && coverage[0].state === 'ready' ? null : 'unavailable';
}

/** Source filtering is deliberate: a foreign same-spelled session is not this host target. */
export function progressTargetRead(read: StoreRead): StoreRead | null {
  if (read.truncated || !read.binding.verified || !read.binding.sourceId || !read.sources.some(s => s.id === read.binding.sourceId && s.verified)) return null;
  return { ...read, plans: read.plans.filter(p => p.sourceId === read.binding.sourceId) };
}
