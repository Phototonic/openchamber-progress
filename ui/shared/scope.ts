// Which plans each surface shows. Pure functions over the view model and live snapshot.
// Session and directory scoping is done by the service (its filters include participants);
// project/worktree grouping uses the plan's recorded directory plus live SDK labels.
import { baseName } from './format.ts';
import { coverageFor, planProject, projectFor, sessionLabel, type LiveSnapshot } from './live.ts';
import { orderPlans, type PlanView } from './model.ts';
import type { ListScope } from './source.ts';
import { directoryKey } from './path.ts';

export type Scope =
  | { kind: 'session'; sessionId: string; plans: PlanView[]; owned: number }
  | { kind: 'directory'; directory: string; plans: PlanView[] }
  | { kind: 'none' };

/** Server scope for the rail and Work Status: the session if provided, else the directory. */
export function contextListScope(sessionId: string | null | undefined, directory: string | null | undefined): ListScope | null {
  if (sessionId) return { session: sessionId };
  if (directory) return { directory };
  return null;
}

/** Orders an already server-scoped list: plans the session owns first, then ones it takes part in. */
export function contextScope(plans: PlanView[], sessionId: string | null | undefined, directory: string | null | undefined): Scope {
  if (sessionId) {
    const owned = orderPlans(plans.filter((p) => p.ownerSessionId === sessionId));
    const helping = orderPlans(plans.filter((p) => p.ownerSessionId !== sessionId));
    return { kind: 'session', sessionId, plans: [...owned, ...helping], owned: owned.length };
  }
  if (directory) return { kind: 'directory', directory, plans: orderPlans(plans) };
  return { kind: 'none' };
}

/** Keep the user's choice while it exists; otherwise the most relevant plan. */
export const pickPlan = (plans: PlanView[], selected: string | null | undefined) => plans.find((p) => p.key === selected) ?? plans[0] ?? null;

export interface Place { projectKey: string; projectLabel: string; worktreeKey: string; worktreeLabel: string }

export function placeOf(plan: PlanView, live: LiveSnapshot): Place {
  const cov = coverageFor(plan.ownerSessionId, plan.directory, live);
  const project = planProject(plan.ownerSessionId, plan.directory, live);
  if (!project) {
    const label = plan.directory ? baseName(plan.directory) : 'Unknown location';
    return { projectKey: `d:${directoryKey(plan.directory)}`, projectLabel: label, worktreeKey: `d:${directoryKey(plan.directory)}`, worktreeLabel: label };
  }
  // The plan's recorded directory decides the worktree; live sessions only supply its name.
  const dir = directoryKey(plan.directory || (cov.kind === 'live' ? cov.session.directory : ''));
  if (!dir || dir === directoryKey(project.directory)) return { projectKey: `p:${project.id}`, projectLabel: project.name, worktreeKey: `root:${project.id}`, worktreeLabel: 'Main checkout' };
  const trees = live.worktrees.get(project.id);
  const tree = trees?.state === 'ready' ? trees.records.find((w) => w.status === 'ready' && directoryKey(w.directory) === dir) : undefined;
  let named: string | undefined = tree ? tree.name || tree.branch : undefined;
  for (const entry of live.sessions.values()) {
    const wt = entry.records.find((r) => r.worktree && directoryKey(r.worktree.directory) === dir)?.worktree;
    if (wt) { named = wt.name || wt.branch; break; }
  }
  return { projectKey: `p:${project.id}`, projectLabel: project.name, worktreeKey: `w:${dir}`, worktreeLabel: named ?? baseName(dir) };
}

export interface Filters { project: string; worktree: string; session: string }
export const ALL = 'all';
export const NO_FILTERS: Filters = { project: ALL, worktree: ALL, session: ALL };
export interface Option { id: string; label: string; hint?: string }

/** Page list scope: only the session filter goes to the server (it matches participants). */
export const pageListScope = (f: Filters): ListScope => (f.session !== ALL ? { session: f.session } : {});

export function filterOptions(plans: PlanView[], live: LiveSnapshot, f: Filters, sessionPool: PlanView[] = plans) {
  const places = plans.map((p) => ({ plan: p, place: placeOf(p, live) }));
  const uniq = (list: Option[]) => [...new Map(list.map((o) => [o.id, o])).values()].sort((a, b) => a.label.localeCompare(b.label));
  const projects = uniq(places.map(({ place }) => ({ id: place.projectKey, label: place.projectLabel })))
    .map((o) => ({ ...o, hint: String(places.filter((x) => x.place.projectKey === o.id).length) }));
  const inProject = places.filter((x) => f.project === ALL || x.place.projectKey === f.project);
  const worktrees = uniq(inProject.map(({ place }) => ({ id: place.worktreeKey, label: place.worktreeLabel })))
    .map((o) => ({ ...o, hint: String(inProject.filter((x) => x.place.worktreeKey === o.id).length) }));
  // Sessions: plan owners in the current selection plus their live child sessions; the
  // service then matches creators, assignments and attributed contributions.
  const poolPlaces = sessionPool.map((p) => ({ plan: p, place: placeOf(p, live) }))
    .filter((x) => (f.project === ALL || x.place.projectKey === f.project) && (f.worktree === ALL || x.place.worktreeKey === f.worktree));
  const owners = [...new Set(poolPlaces.map((x) => x.plan.ownerSessionId))];
  const children: Option[] = [];
  for (const entry of live.sessions.values()) for (const r of entry.records) if (r.parentId && owners.includes(r.parentId)) children.push({ id: r.id, label: r.title || sessionLabel(r.id, live), hint: 'child' });
  const sessions = uniq([...owners.map((id) => ({ id, label: sessionLabel(id, live), hint: 'main' })), ...children]);
  if (f.session !== ALL && !sessions.some((o) => o.id === f.session)) sessions.push({ id: f.session, label: sessionLabel(f.session, live) });
  return {
    projects: [{ id: ALL, label: 'All projects', hint: String(plans.length) }, ...projects],
    worktrees: [{ id: ALL, label: 'All worktrees' }, ...worktrees],
    sessions: [{ id: ALL, label: 'All sessions' }, ...sessions],
  };
}

/** Drops project/worktree values that no longer exist (e.g. after a store change). */
export function normalizeFilters(plans: PlanView[], live: LiveSnapshot, f: Filters): Filters {
  const o1 = filterOptions(plans, live, f);
  const project = o1.projects.some((o) => o.id === f.project) ? f.project : ALL;
  const o2 = filterOptions(plans, live, { ...f, project });
  const worktree = o2.worktrees.some((o) => o.id === f.worktree) ? f.worktree : ALL;
  return { project, worktree, session: f.session };
}

/** Client-side project/worktree narrowing of a (possibly session-scoped) server list. */
export function applyFilters(plans: PlanView[], live: LiveSnapshot, f: Filters) {
  return orderPlans(plans.filter((plan) => {
    const place = placeOf(plan, live);
    return (f.project === ALL || place.projectKey === f.project) && (f.worktree === ALL || place.worktreeKey === f.worktree);
  }));
}

/** Projects whose sessions should be watched so these plans get live state. */
export function projectsFor(plans: PlanView[], live: LiveSnapshot, directory?: string | null) {
  const ids: string[] = [];
  if (directory) { const p = projectFor(directory, live); if (p) ids.push(p.id); }
  for (const plan of plans) { const p = planProject(plan.ownerSessionId, plan.directory, live); if (p) ids.push(p.id); }
  return [...new Set(ids)];
}

/** Plans whose main session lacks live coverage or is from another source, for an honest note. */
export function coverageGap(plans: PlanView[], live: LiveSnapshot, boundSource: string | null) {
  let missing = 0;
  let pending = 0;
  let otherSource = 0;
  for (const plan of plans) {
    if (boundSource === null || plan.sourceId !== boundSource) { otherSource++; continue; }
    const c = coverageFor(plan.ownerSessionId, plan.directory, live).kind;
    if (c === 'loading') pending++;
    else if (c !== 'live') missing++;
  }
  return { missing, pending, otherSource, capped: live.capped.length };
}
