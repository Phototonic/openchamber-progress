// Which plans each surface shows. Pure functions over the view model and live snapshot.
// Session and directory scoping is done by the service (its filters include participants);
// project/worktree grouping uses the plan's recorded directory plus live SDK labels.
import { baseName } from './format.ts';
import { coverageFor, EMPTY_LIVE, planProject, projectFor, sessionLabel, type LiveSnapshot } from './live.ts';
import { orderPlans, type PlanView } from './model.ts';
import type { ListScope } from './source.ts';
import { directoryKey } from './path.ts';

export type Scope =
  | { kind: 'session'; sessionId: string; plans: PlanView[]; owned: number }
  | { kind: 'directory'; directory: string; plans: PlanView[] }
  | { kind: 'none' };

/** Sidebar scope is the explicit selected session; directory metadata never broadens it. */
export function contextListScope(sessionId: string | null | undefined, _directory?: string | null): ListScope | null {
  return sessionId ? { session: sessionId } : null;
}

/** Orders an already server-scoped list: plans the session owns first, then ones it takes part in. */
export function contextScope(plans: PlanView[], sessionId: string | null | undefined, _directory?: string | null): Scope {
  if (sessionId) {
    const owned = orderPlans(plans.filter((p) => p.ownerSessionId === sessionId));
    const helping = orderPlans(plans.filter((p) => p.ownerSessionId !== sessionId));
    return { kind: 'session', sessionId, plans: [...owned, ...helping], owned: owned.length };
  }
  return { kind: 'none' };
}

/** Keep the user's choice while it exists; otherwise the most relevant plan. */
export const pickPlan = (plans: PlanView[], selected: string | null | undefined) => plans.find((p) => p.key === selected) ?? plans[0] ?? null;

export interface Place { projectKey: string; projectLabel: string; worktreeKey: string; worktreeLabel: string }

/**
 * The verified bound source (env.boundSource; null when the binding is unverified). Given, only that
 * source's plans may be placed by their live owner session: another setup's same-ID session is not
 * this host's session (Session labels). Omitted: no source rule (callers without a binding).
 */
export type Bound = string | null | undefined;
export const trustedPlan = (plan: { sourceId?: string }, bound: Bound) => bound === undefined || (bound !== null && plan.sourceId === bound);

export function placeOf(plan: Pick<PlanView, 'ownerSessionId' | 'directory'> & { sourceId?: string }, live: LiveSnapshot, bound?: Bound): Place {
  // Other sources use their recorded location only (configured checkouts and discovered worktrees).
  const owner = trustedPlan(plan, bound) ? plan.ownerSessionId : '';
  const cov = coverageFor(owner, plan.directory, live);
  const project = planProject(owner, plan.directory, live);
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

export function filterOptions(plans: PlanView[], live: LiveSnapshot, f: Filters, sessionPool: PlanView[] = plans, bound?: Bound) {
  const places = plans.map((p) => ({ plan: p, place: placeOf(p, live, bound) }));
  const uniq = (list: Option[]) => [...new Map(list.map((o) => [o.id, o])).values()].sort((a, b) => a.label.localeCompare(b.label));
  const projects = uniq(places.map(({ place }) => ({ id: place.projectKey, label: place.projectLabel })))
    .map((o) => ({ ...o, hint: String(places.filter((x) => x.place.projectKey === o.id).length) }));
  const inProject = places.filter((x) => f.project === ALL || x.place.projectKey === f.project);
  const worktrees = uniq(inProject.map(({ place }) => ({ id: place.worktreeKey, label: place.worktreeLabel })))
    .map((o) => ({ ...o, hint: String(inProject.filter((x) => x.place.worktreeKey === o.id).length) }));
  // Sessions: plan owners in the current selection plus their live child sessions; the
  // service then matches creators, assignments and attributed contributions.
  const poolPlaces = sessionPool.map((p) => ({ plan: p, place: placeOf(p, live, bound) }))
    .filter((x) => (f.project === ALL || x.place.projectKey === f.project) && (f.worktree === ALL || x.place.worktreeKey === f.worktree));
  const owners = [...new Set(poolPlaces.map((x) => x.plan.ownerSessionId))];
  // Host titles and live children only for owners of verified-source plans; others keep plain labels.
  const trustedOwners = new Set(poolPlaces.filter((x) => trustedPlan(x.plan, bound)).map((x) => x.plan.ownerSessionId));
  const children: Option[] = [];
  for (const entry of live.sessions.values()) for (const r of entry.records) if (r.parentId && trustedOwners.has(r.parentId)) children.push({ id: r.id, label: r.title || sessionLabel(r.id, live), hint: 'child' });
  const sessions = uniq([...owners.map((id) => ({ id, label: sessionLabel(id, trustedOwners.has(id) ? live : EMPTY_LIVE), hint: 'main' })), ...children]);
  if (f.session !== ALL && !sessions.some((o) => o.id === f.session)) sessions.push({ id: f.session, label: sessionLabel(f.session, live) });
  return {
    projects: [{ id: ALL, label: 'All projects', hint: String(plans.length) }, ...projects],
    worktrees: [{ id: ALL, label: 'All worktrees' }, ...worktrees],
    sessions: [{ id: ALL, label: 'All sessions' }, ...sessions],
  };
}

/**
 * Board filter choices while searching: live projects/worktrees plus locations of plans this frame
 * has seen (loaded list, shown results). No counts: they would describe what is loaded, not the
 * library. A chosen value stays listed even when this window no longer knows it.
 */
export function searchFilterOptions(plans: (Pick<PlanView, 'ownerSessionId' | 'directory'> & { sourceId?: string })[], live: LiveSnapshot, f: Filters, labels: { project?: string; worktree?: string; session?: string } = {}, bound?: Bound) {
  const base = filterOptions(plans as PlanView[], live, f, plans as PlanView[], bound);
  const strip = (o: Option[]) => o.map(({ id, label }) => ({ id, label }));
  const sort = (list: Option[]) => [...new Map(list.map((o) => [o.id, o])).values()].sort((a, b) => a.label.localeCompare(b.label));
  const projects = sort([...strip(base.projects.slice(1)), ...live.projects.map((p) => ({ id: `p:${p.id}`, label: p.name }))]);
  const trees: Option[] = strip(base.worktrees.slice(1));
  if (f.project.startsWith('p:')) {
    const id = f.project.slice(2);
    if (live.projects.some((p) => p.id === id)) trees.push({ id: `root:${id}`, label: 'Main checkout' });
    const known = live.worktrees.get(id);
    if (known?.state === 'ready') for (const w of known.records) if (w.status === 'ready') trees.push({ id: `w:${directoryKey(w.directory)}`, label: w.name || w.branch || baseName(w.directory) });
  }
  const worktrees = sort(trees);
  const sessions = strip(base.sessions.slice(1));
  const keep = (list: Option[], value: string, label: string | undefined) => (value === ALL || list.some((o) => o.id === value) ? list : [...list, { id: value, label: `${label ?? value} (not available here)` }]);
  return {
    projects: [{ id: ALL, label: 'All projects' }, ...keep(projects, f.project, labels.project)],
    worktrees: [{ id: ALL, label: 'All worktrees' }, ...keep(worktrees, f.worktree, labels.worktree)],
    sessions: [{ id: ALL, label: 'All sessions' }, ...keep(sessions, f.session, labels.session)],
  };
}

/** Drops project/worktree values that no longer exist (e.g. after a store change). */
export function normalizeFilters(plans: PlanView[], live: LiveSnapshot, f: Filters, bound?: Bound): Filters {
  const o1 = filterOptions(plans, live, f, plans, bound);
  const project = o1.projects.some((o) => o.id === f.project) ? f.project : ALL;
  const o2 = filterOptions(plans, live, { ...f, project }, plans, bound);
  const worktree = o2.worktrees.some((o) => o.id === f.worktree) ? f.worktree : ALL;
  return { project, worktree, session: f.session };
}

/** Client-side project/worktree narrowing of a (possibly session-scoped) server list. */
export function applyFilters(plans: PlanView[], live: LiveSnapshot, f: Filters, bound?: Bound) {
  return orderPlans(plans.filter((plan) => {
    const place = placeOf(plan, live, bound);
    return (f.project === ALL || place.projectKey === f.project) && (f.worktree === ALL || place.worktreeKey === f.worktree);
  }));
}

/** Projects whose sessions should be watched so these plans get live state. */
export function projectsFor(plans: PlanView[], live: LiveSnapshot, directory?: string | null, bound?: Bound) {
  const ids: string[] = [];
  if (directory) { const p = projectFor(directory, live); if (p) ids.push(p.id); }
  for (const plan of plans) { const p = planProject(trustedPlan(plan, bound) ? plan.ownerSessionId : '', plan.directory, live); if (p) ids.push(p.id); }
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
