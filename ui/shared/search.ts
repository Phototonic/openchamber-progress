// Board-only plan/task search (docs/ui.md "Search"). DOM-free, so the browser-logic tests drive it
// directly. One controller per board frame; at most one search traversal ("run") is current.
// - explicit actions only: Search, Load more, Continue searching, Retry, Refresh search; each issues
//   at most SEARCH_WINDOWS sequential bounded windows and stops at page fill, exhaustion or failure
// - the board's project/worktree choice is applied with membership frozen at submit, to each
//   window's per-plan candidates BEFORE counting or filling a page; a rejected plan never takes a slot
// - counts accumulate only accepted windows' per-plan deltas (found so far); full-plan totals stay
// - at most SEARCH_PAGES presentation pages of SEARCH_PAGE hits plus one bounded unconsumed buffer
// - freshness: displayed keys + selection, revalidated on the frame's existing poll; a change retires
//   continuation and count authority, missing/archive-moved hits disappear
// - retirement: new criteria, identity reset, cleanup, membership change, hidden frame, disposal; the
//   proxy cannot abort a request, so a retired action can neither paint nor issue another window
import type { ItemStatus, Lifecycle, PlanView, SearchGap, SearchHitView, SearchKeyView, SearchPlanView, SearchRequest } from './model.ts';
import { findSession, type LiveSnapshot } from './live.ts';
import { directoryKey } from './path.ts';
import { directoryWithin } from './model.ts';
import { ALL, placeOf, trustedPlan } from './scope.ts';
import { RefreshGate } from './refresh.ts';
import { readSearchState, readSearchWindow, type ReadFailure, type FreshnessResult, type ServiceHost } from './source.ts';

/** Hits per presentation page and per backend window. */
export const SEARCH_PAGE = 50;
/** Backend windows one explicit action may issue. */
export const SEARCH_WINDOWS = 10;
/** Presentation pages kept for Back/Next; older ones are revisited by searching again. */
export const SEARCH_PAGES = 2;
export const SEARCH_POINTS = 256;
export const SEARCH_TOKENS = 16;
/** Distinct keys per freshness read (frozen contract), at most two reads per poll. */
export const STATE_KEYS = 50;

export interface SearchCriteria {
  q: string;
  source: string;
  lifecycle: Lifecycle | typeof ALL;
  status: ItemStatus | typeof ALL;
  project: string;
  worktree: string;
  session: string;
  archived: boolean;
  /** Names of the chosen project/worktree/session when chosen, so an unavailable choice keeps its name. */
  labels: { project?: string; worktree?: string; session?: string };
}

export const tokens = (q: string) => q.trim().split(/\s+/u).filter(Boolean);
/** Refused rather than truncated (frozen bounds); null when the text can be searched. */
export function queryProblem(q: string): string | null {
  if (q.includes('\0')) return 'Remove the unsupported character from the search text.';
  if ([...q.trim()].length > SEARCH_POINTS) return `Use at most ${SEARCH_POINTS} characters.`;
  if (tokens(q).length > SEARCH_TOKENS) return `Use at most ${SEARCH_TOKENS} words.`;
  return null;
}
/** A search needs words or a narrowing constraint; board filters alone are ordinary browsing. */
export const searchable = (c: Pick<SearchCriteria, 'q' | 'source' | 'lifecycle' | 'status'>) => tokens(c.q).length > 0 || c.source !== ALL || c.lifecycle !== ALL || c.status !== ALL;
export const narrowed = (c: Pick<SearchCriteria, 'project' | 'worktree'>) => c.project !== ALL || c.worktree !== ALL;
/** Criteria identity (names are presentation only). */
export const criteriaKey = (c: SearchCriteria) => JSON.stringify([c.q.trim(), c.source, c.lifecycle, c.status, c.project, c.worktree, c.session, c.archived]);

/** Detached copy: the live workspace mutates its maps in place. */
export function freezeLive(live: LiveSnapshot): LiveSnapshot {
  const copy = <V extends { state: unknown; records: unknown[] }>(m: Map<string, V>) => new Map([...m].map(([k, v]) => [k, { ...v, records: [...v.records] }]));
  return { projectsState: live.projectsState, projects: [...live.projects], worktrees: copy(live.worktrees), sessions: copy(live.sessions), capped: [...live.capped] };
}
/** Distinct candidate owners a run tracks; beyond this every live session record is compared instead. */
export const OWNER_LIMIT = 1000;
/**
 * Facts that can change how a plan this run has seen is classified (no titles or activity): projects,
 * worktree discovery and the subscription cap classify every plan; a live session classifies only the
 * plans it owns, so sessions are compared just for the run's candidate owners (`'all'`: every record,
 * after OWNER_LIMIT). A new unrelated session in the chosen project is therefore not a change. Null
 * while any discovery is still loading.
 */
export function membershipSig(live: LiveSnapshot, owners: ReadonlySet<string> | 'all' = 'all'): string | null {
  if (live.projectsState === 'loading') return null;
  for (const m of [live.worktrees, live.sessions]) for (const v of m.values()) if (v.state === 'loading') return null;
  const sorted = <T>(m: Map<string, T>) => [...m].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const sessions = owners === 'all'
    ? sorted(live.sessions).map(([id, s]) => [id, s.state, s.records.map((r) => [r.id, r.projectId, r.directory, r.worktree?.directory ?? null])])
    : [...owners].sort().map((id) => { const s = findSession(id, live); return [id, s ? [s.projectId, directoryKey(s.directory)] : null]; });
  return JSON.stringify([
    live.projectsState, live.projects.map((p) => [p.id, p.directory]),
    sorted(live.worktrees).map(([id, w]) => [id, w.state, w.records.map((r) => [r.directory, r.status])]),
    [...live.capped].sort(), sessions,
  ]);
}
/** Whether this window's discovery is partial (pending, failed or capped): it qualifies locations, not record coverage. */
export function discoveryIncomplete(live: LiveSnapshot) {
  if (live.projectsState !== 'ready' || live.capped.length) return true;
  for (const m of [live.worktrees, live.sessions]) for (const v of m.values()) if (v.state !== 'ready') return true;
  return false;
}
/**
 * Whether a chosen location can be classified in this window. `missing` is proven absence (settled
 * discovery without it); `loading` is discovery still running; `unknown` is discovery that failed or
 * never ran for the candidate project. Only `ok` lets a narrowed search run; nothing widens to All.
 */
export type ScopeState = 'ok' | 'loading' | 'unknown' | 'missing';
export type LocationPart = 'project' | 'worktree';
const SEVERITY: ScopeState[] = ['ok', 'loading', 'unknown', 'missing'];
const projectState = (id: string, live: LiveSnapshot): ScopeState =>
  live.projects.some((p) => p.id === id) ? 'ok' : live.projectsState === 'loading' ? 'loading' : live.projectsState === 'error' ? 'unknown' : 'missing';
/**
 * A worktree choice (`w:<directory>`) stays classifiable while its directory is a subfolder of the
 * candidate project's checkout, inside one of its ready SDK worktrees, or a ready live session's
 * location there. Ready discovery without any of them proves it removed.
 */
function worktreeState(dir: string, projectChoice: string, live: LiveSnapshot): ScopeState {
  if (live.projectsState === 'loading') return 'loading';
  if (live.projectsState === 'error') return 'unknown';
  const candidates = projectChoice.startsWith('p:') ? live.projects.filter((p) => p.id === projectChoice.slice(2)) : live.projects;
  let pending: ScopeState = 'missing';
  const worse = (s: ScopeState) => { if (s === 'loading' || (s === 'unknown' && pending === 'missing')) pending = s; };
  for (const p of candidates) {
    if (directoryWithin(dir, p.directory)) return 'ok';
    const trees = live.worktrees.get(p.id);
    if (trees?.state === 'ready' && trees.records.some((w) => w.status === 'ready' && directoryWithin(dir, w.directory))) return 'ok';
    const sessions = live.sessions.get(p.id);
    if (sessions?.state === 'ready' && sessions.records.some((r) => directoryKey(r.directory) === dir || (r.worktree && directoryWithin(dir, r.worktree.directory)))) return 'ok';
    worse(!trees ? 'unknown' : trees.state === 'loading' || sessions?.state === 'loading' ? 'loading' : trees.state === 'error' ? 'unknown' : 'missing');
  }
  return pending;
}
/** Per chosen part; recorded-directory (`d:`) choices are always definable. */
export function locationAvailability(c: Pick<SearchCriteria, 'project' | 'worktree'>, live: LiveSnapshot): Record<LocationPart, ScopeState> {
  const project: ScopeState = c.project.startsWith('p:') ? projectState(c.project.slice(2), live) : 'ok';
  const worktree: ScopeState = c.worktree.startsWith('root:') ? projectState(c.worktree.slice(5), live)
    : c.worktree.startsWith('w:') ? (project === 'ok' ? worktreeState(directoryKey(c.worktree.slice(2)), c.project, live) : project) : 'ok';
  return { project, worktree };
}
/** The narrowed search's overall state: the most severe of its chosen parts. */
export function scopeAvailability(c: Pick<SearchCriteria, 'project' | 'worktree'>, live: LiveSnapshot): ScopeState {
  const a = locationAvailability(c, live);
  return SEVERITY[Math.max(SEVERITY.indexOf(a.project), SEVERITY.indexOf(a.worktree))];
}
const inPlace = (c: SearchCriteria, plan: SearchPlanView, live: LiveSnapshot, bound: string | null) => {
  if (!narrowed(c)) return true;
  const place = placeOf(plan, live, bound);
  return (c.project === ALL || place.projectKey === c.project) && (c.worktree === ALL || place.worktreeKey === c.worktree);
};

/** Why a run stopped short of exhaustion. Only `paused`, `failed` and `hidden` can continue the same traversal. */
export type SearchStop = 'paused' | 'failed' | 'hidden' | 'conflict' | 'identity' | 'changed' | 'membership' | 'retired';
export type SearchPhase = 'loading' | 'ready' | 'blocked';
export interface SearchGroup { plan: SearchPlanView; continued: boolean; planOnly: boolean; changed: boolean; hits: SearchHitView[] }
export interface SearchViewState {
  /** Bumps when the run (traversal) is replaced: retained DOM state belongs to one run. */
  run: number;
  criteria: SearchCriteria;
  phase: SearchPhase;
  /** Chosen project/worktree unknown to this window: the narrowed search does not run. */
  blocked: Exclude<ScopeState, 'ok'> | null;
  /** Which chosen parts are not available (their chips are marked; recovery removes them). */
  blockedParts: LocationPart[];
  busy: boolean;
  stop: SearchStop | null;
  failure: ReadFailure | null;
  exhausted: boolean;
  /** Accumulated over accepted windows, after the frozen location choice. */
  counts: { matchedPlans: number; matchingTasks: number };
  /** False once a freshness change retired the traversal's count authority. */
  countsCurrent: boolean;
  coverage: { gapped: boolean; skippedRecords: number; reasons: SearchGap[] };
  windows: number;
  page: { number: number; hits: SearchHitView[]; groups: SearchGroup[]; contextRows: number; checked: boolean };
  hasPrevious: boolean;
  hasNext: boolean;
  /** More matches may exist beyond the shown page (buffered or unchecked). */
  more: boolean;
  removed: number;
  changedKeys: number;
  discoveryIncomplete: boolean;
  status: { id: number; text: string };
}

interface Run {
  id: number;
  key: string;
  criteria: SearchCriteria;
  frozen: LiveSnapshot;
  /** Owners of every candidate this narrowed run has seen (classified or rejected); `'all'` past OWNER_LIMIT. */
  owners: Set<string> | 'all';
  identity: { storeId: string; binding: { sourceId: string | null; verified: boolean } };
  blocked: Exclude<ScopeState, 'ok'> | null;
  blockedParts: LocationPart[];
  fingerprint: string | null;
  cursor: string | null;
  exhausted: boolean;
  matchedPlans: number;
  matchingTasks: number;
  countsCurrent: boolean;
  gapped: boolean;
  skippedRecords: number;
  reasons: Set<SearchGap>;
  /** Accepted hits beyond the frontier page (bounded by one window). */
  buffer: SearchHitView[];
  pages: SearchHitView[][];
  firstPage: number;
  view: number;
  checked: boolean;
  busy: boolean;
  pending: boolean;
  stop: SearchStop | null;
  failure: ReadFailure | null;
  windows: number;
  changed: Set<string>;
  removed: number;
  selected: { key: string; plan: SearchPlanView } | null;
  status: { id: number; text: string };
}

export interface SearchHost {
  /** Guarded proxy: a retired caller can no longer send requests. */
  service: (current: () => boolean) => ServiceHost;
  /** Repaint request after a state change. */
  changed: () => void;
  visible: () => boolean;
}

/** Plain outcome of a narrowed search that did not run; never widened to All. */
export const BLOCKED_TEXT: Record<Exclude<ScopeState, 'ok'>, string> = {
  loading: 'Project or worktree locations are still loading here, so this narrowed search has not run yet.',
  unknown: 'This window couldn’t discover the chosen project’s or worktree’s locations, so this narrowed search can’t run. It was not widened.',
  missing: 'The chosen project or worktree isn’t available in this window, so this narrowed search can’t run. It was not widened.',
};

const placeholderDocument: PlanView['document'] = { state: 'unavailable', checklistSynchronized: false, currentFile: 'not-rechecked' };

export class SearchController {
  private host: SearchHost;
  private run: Run | null = null;
  private runs = 0;
  private statuses = 0;
  private disposed = false;
  /** Freshness generation: hiding and disposal retire an in-flight freshness read, scanning or not. */
  private freshness = 0;
  private readonly gate: RefreshGate;
  constructor(host: SearchHost) {
    this.host = host;
    this.gate = new RefreshGate((generation) => this.action(generation));
  }

  /** Identity of the current run, or null without one. */
  get key() { return this.run?.key ?? null; }
  get active() { return this.run !== null; }
  /** Read-transport overlap is bounded by the gate (one retired plus one current window). */
  get inFlight() { return this.gate.inFlight; }

  /**
   * Starts a new traversal for these criteria (Search, chip removal, filter change, Refresh search).
   * `key` must include every identity part (account, store/binding, criteria) so equal IDs under
   * another identity never share results.
   */
  submit(key: string, criteria: SearchCriteria, identity: Run['identity'], live: LiveSnapshot) {
    if (this.disposed) return;
    this.gate.retire();
    const frozen = freezeLive(live);
    const parts = locationAvailability(criteria, frozen);
    const overall = narrowed(criteria) ? scopeAvailability(criteria, frozen) : 'ok';
    const blocked = overall === 'ok' ? null : overall;
    const blockedParts = (['project', 'worktree'] as const).filter((k) => parts[k] !== 'ok');
    this.run = {
      id: ++this.runs, key, criteria, frozen, owners: new Set(), identity, blocked, blockedParts,
      fingerprint: null, cursor: null, exhausted: false, matchedPlans: 0, matchingTasks: 0, countsCurrent: true,
      gapped: false, skippedRecords: 0, reasons: new Set(), buffer: [], pages: [[]], firstPage: 1, view: 0, checked: true,
      busy: false, pending: false, stop: null, failure: null, windows: 0, changed: new Set(), removed: 0, selected: null,
      status: { id: 0, text: '' },
    };
    if (blocked) { this.say(this.run, BLOCKED_TEXT[blocked]); this.host.changed(); return; }
    this.start(this.run);
  }

  /** Back to ordinary browsing (Clear all, mode switch, identity reset): nothing of the run survives. */
  clear() { this.gate.retire(); this.run = null; this.host.changed(); }

  /**
   * Retires the run's async work and continuation authority, keeping what is shown as explicitly
   * out of date with Refresh search (cleanup, list eviction). A held reply can no longer act.
   */
  retire(reason: 'retired' | 'identity' = 'retired') {
    const r = this.run;
    if (!r) return;
    this.gate.retire();
    if (r.stop === reason) return;
    r.busy = false; r.pending = false; r.stop = reason; r.countsCurrent = false;
    this.say(r, reason === 'identity' ? 'The progress store changed, so these results were retired. Search again.' : 'Plans changed here, so these results were retired. Refresh search to search again.');
    this.host.changed();
  }

  /** Leaving view retires an in-flight action; an explicit Continue resumes from the last accepted window. */
  hidden() {
    this.freshness++;
    const r = this.run;
    if (!r || !r.busy) return;
    this.gate.retire();
    r.busy = false; r.pending = false; r.stop = 'hidden';
    this.host.changed();
  }

  dispose() { this.disposed = true; this.freshness++; this.gate.stop(); this.run = null; }

  /** Load more (a new page), Continue searching (fill this page), Retry (same accepted cursor). */
  more() {
    const r = this.run;
    if (!r || r.busy || r.blocked || !this.continuable(r)) return;
    if (r.view !== r.pages.length - 1) { r.view = r.pages.length - 1; r.checked = false; }
    if (r.pages[r.view].length >= SEARCH_PAGE) {
      r.pages.push([]);
      if (r.pages.length > SEARCH_PAGES) { r.pages.shift(); r.firstPage++; }
      r.view = r.pages.length - 1;
    }
    r.stop = null; r.failure = null;
    this.start(r);
  }

  /** Back/Next within the retained pages; reused pages are revalidated before they count as checked. */
  showPage(delta: -1 | 1) {
    const r = this.run;
    if (!r || r.busy) return;
    const next = r.view + delta;
    if (next < 0 || next >= r.pages.length) return;
    r.view = next; r.checked = false;
    this.host.changed();
  }

  /** The location snapshot changed: a narrowed run cannot mix membership generations. */
  membership(live: LiveSnapshot) {
    const r = this.run;
    if (!r || !narrowed(r.criteria) || r.blocked) return;
    // Only a change that could classify a seen candidate differently counts; unsettled discovery waits.
    const sig = membershipSig(live, r.owners);
    if (sig === null || r.stop === 'membership' || sig === membershipSig(r.frozen, r.owners)) return;
    this.gate.retire();
    r.busy = false; r.pending = false; r.stop = 'membership'; r.countsCurrent = false;
    this.say(r, 'Project or worktree locations changed in this window. Refresh search to use them.');
    this.host.changed();
  }

  /** An explicit outcome of this run (e.g. opening a task that is gone), spoken once. */
  note(run: number, text: string) {
    const r = this.run;
    if (!r || r.id !== run) return;
    this.say(r, text);
    this.host.changed();
  }

  /** Explicit task or plan selection of a hit in the current run. */
  select(key: string | null) {
    const r = this.run;
    if (!r) return;
    if (key === null) { r.selected = null; return; }
    const plan = this.planOf(r, key);
    if (plan) r.selected = { key, plan };
  }
  /** Current-metadata request plan for the selected hit (detail read only; never painted as detail). */
  selectedPlan(): PlanView | null {
    const s = this.run?.selected;
    return s ? { ...s.plan, working: [], document: placeholderDocument } : null;
  }

  /** Displayed distinct plan keys plus the selection: what a poll revalidates (≤ 2 × 50). */
  freshKeys(): SearchKeyView[] {
    const r = this.run;
    if (!r || r.blocked) return [];
    const keys = new Map<string, SearchKeyView>();
    if (r.selected) keys.set(r.selected.key, { source: r.selected.plan.sourceId, plan: r.selected.plan.id });
    for (const h of r.pages[r.view]) keys.set(h.plan.key, { source: h.plan.sourceId, plan: h.plan.id });
    return [...keys.values()].slice(0, STATE_KEYS * 2);
  }

  /**
   * One poll's freshness: authoritative point lookups only. Missing/deleted/archive-moved keys leave
   * every retained page; changed revisions/cleanup generations stay visibly qualified. Either retires
   * continuation and count authority. A failure is stale, never "missing".
   */
  async revalidate(service: ServiceHost): Promise<FreshnessResult> {
    const r = this.run;
    const keys = this.freshKeys();
    const generation = this.freshness;
    // Same run, same freshness generation, visible frame: checked before each batch and each reply.
    const current = () => !this.disposed && this.run === r && generation === this.freshness && this.host.visible();
    if (!r || !keys.length || !current()) return { state: 'retired' };
    const rows = [];
    let captureEnabled = true;
    for (let i = 0; i < keys.length; i += STATE_KEYS) {
      if (!current()) return { state: 'retired' };
      const result = await readSearchState(service, r.identity.storeId, keys.slice(i, i + STATE_KEYS));
      if (!current()) return { state: 'retired' }; // retired meanwhile: its answer owns nothing
      if (!result.ok) return { state: 'failed', failure: result.failure, identity: result.status === 409 };
      const b = result.state.binding;
      if (b.sourceId !== r.identity.binding.sourceId || b.verified !== r.identity.binding.verified) return { state: 'failed', failure: { kind: 'invalid', code: 'CONTRACT', message: 'The source binding changed.' }, identity: true };
      if (i > 0 && captureEnabled !== result.state.captureEnabled) return { state: 'failed', failure: { kind: 'busy', code: 'CAPTURE_CHANGED', message: 'Capture state changed during the freshness read. Try again.' }, identity: false };
      captureEnabled = result.state.captureEnabled;
      rows.push(...result.state.data);
    }
    let gone = 0, moved = 0, reselect = false;
    for (const row of rows) {
      const key = `${row.source}/${row.plan}`;
      const known = this.planOf(r, key);
      if (!known) continue;
      if (!row.exists || row.cleanup.state === 'deleted' || (row.cleanup.state === 'archived') !== r.criteria.archived) { this.drop(r, key); gone++; continue; }
      if (row.revision !== known.revision || row.cleanup.revision !== known.cleanup.revision) {
        if (!r.changed.has(key)) moved++;
        r.changed.add(key);
        // The opened plan follows its current metadata, so its detail is re-read once at the new revision.
        const s = r.selected;
        if (s?.key === key && (s.plan.revision !== row.revision || s.plan.cleanup.revision !== row.cleanup.revision)) { r.selected = { key, plan: { ...s.plan, revision: row.revision!, cleanup: { state: row.cleanup.state, revision: row.cleanup.revision } } }; reselect = true; }
      }
    }
    // Repaint only on a change: an unchanged poll leaves the DOM (focus, scroll, selection) alone.
    const checked = !r.checked && rows.length > 0;
    if (rows.length) r.checked = true;
    if (!gone && !moved) { if (checked || reselect) this.host.changed(); return { state: 'fresh', captureEnabled }; }
    this.gate.retire();
    r.busy = false; r.pending = false; r.countsCurrent = false;
    if (r.stop !== 'retired' && r.stop !== 'identity' && r.stop !== 'membership') r.stop = 'changed';
    this.say(r, gone ? `${gone === 1 ? 'A result was' : `${gone} results were`} archived, restored or deleted, so ${gone === 1 ? 'it was' : 'they were'} removed. Refresh search for current results.` : 'Some results changed since they were found. Refresh search for current results.');
    this.host.changed();
    return { state: 'fresh', captureEnabled };
  }

  /** The current state for painting, or null when not searching. */
  view(): SearchViewState | null {
    const r = this.run;
    if (!r) return null;
    const hits = r.pages[r.view];
    const groups = groupHits(hits, r.changed);
    const context = new Set<string>();
    // Context rows actually shown: the abbreviated breadcrumbs, once per plan and ancestor.
    for (const h of hits) { const b = breadcrumb(h); for (const a of [...b.head, ...b.tail]) context.add(`${h.plan.key}\u0000${a.id}`); }
    return {
      run: r.id, criteria: r.criteria, phase: r.blocked ? 'blocked' : r.busy && !r.windows ? 'loading' : 'ready', blocked: r.blocked, blockedParts: r.blockedParts,
      busy: r.busy, stop: r.stop, failure: r.failure, exhausted: r.exhausted && !r.buffer.length,
      counts: { matchedPlans: r.matchedPlans, matchingTasks: r.matchingTasks }, countsCurrent: r.countsCurrent,
      coverage: { gapped: r.gapped, skippedRecords: r.skippedRecords, reasons: [...r.reasons] }, windows: r.windows,
      page: { number: r.firstPage + r.view, hits, groups, contextRows: context.size, checked: r.checked },
      hasPrevious: r.view > 0, hasNext: r.view < r.pages.length - 1,
      more: r.buffer.length > 0 || !r.exhausted,
      removed: r.removed, changedKeys: r.changed.size,
      discoveryIncomplete: narrowed(r.criteria) && discoveryIncomplete(r.frozen),
      status: r.status,
    };
  }

  /** Whether the same traversal may still continue (never after a change, conflict or retirement). */
  private continuable(r: Run) {
    if (r.stop && r.stop !== 'paused' && r.stop !== 'failed' && r.stop !== 'hidden') return false;
    return r.buffer.length > 0 || !r.exhausted;
  }

  private start(r: Run) {
    r.busy = true; r.pending = true;
    this.host.changed();
    this.gate.request();
  }

  private say(r: Run, text: string) { r.status = { id: ++this.statuses, text }; }

  private planOf(r: Run, key: string): SearchPlanView | null {
    if (r.selected?.key === key) return r.selected.plan;
    for (const page of r.pages) for (const h of page) if (h.plan.key === key) return h.plan;
    for (const h of r.buffer) if (h.plan.key === key) return h.plan;
    return null;
  }

  private drop(r: Run, key: string) {
    const before = r.pages.reduce((n, p) => n + p.length, 0) + r.buffer.length;
    r.pages = r.pages.map((p) => p.filter((h) => h.plan.key !== key));
    r.buffer = r.buffer.filter((h) => h.plan.key !== key);
    r.removed += before - (r.pages.reduce((n, p) => n + p.length, 0) + r.buffer.length);
    r.changed.delete(key);
    if (r.selected?.key === key) r.selected = null;
  }

  private request(r: Run): SearchRequest {
    const c = r.criteria;
    return {
      q: c.q.trim(), source: c.source === ALL ? null : c.source, session: c.session === ALL ? null : c.session,
      lifecycle: c.lifecycle === ALL ? null : c.lifecycle, status: c.status === ALL ? null : c.status,
      archived: c.archived ? 'only' : 'exclude', limit: SEARCH_PAGE, cursor: r.cursor,
    };
  }

  /** One explicit action: drain the buffer, then up to SEARCH_WINDOWS sequential windows. */
  private async action(generation: number) {
    const r = this.run;
    if (!r || !r.pending || this.disposed || generation !== this.gate.current) return;
    r.pending = false;
    const current = () => !this.disposed && this.run === r && generation === this.gate.current;
    const page = r.pages[r.view];
    const bound = r.identity.binding.verified ? r.identity.binding.sourceId : null;
    while (page.length < SEARCH_PAGE && r.buffer.length) page.push(r.buffer.shift()!);
    let windows = 0;
    let failed = false;
    while (page.length < SEARCH_PAGE && !r.exhausted && windows < SEARCH_WINDOWS) {
      if (!this.host.visible()) { r.stop = 'hidden'; break; }
      const result = await readSearchWindow(this.host.service(current), this.request(r), { ...r.identity, fingerprint: r.fingerprint });
      if (!current()) return; // retired: nothing of this reply is accepted
      windows++; r.windows++;
      if (!result.ok) {
        failed = true;
        if (result.status === 409) { r.stop = 'conflict'; r.countsCurrent = false; this.say(r, 'Reports changed while searching, so this search can’t continue. Refresh search to start again.'); }
        else { r.stop = 'failed'; r.failure = result.failure; this.say(r, 'Searching stopped because the progress service didn’t answer. Results found so far are shown; Retry continues.'); }
        break;
      }
      const w = result.window;
      r.fingerprint = w.fingerprint;
      for (const hit of w.hits) {
        // Only verified-source plans are placed by their live owner session, so only their owners count.
        if (narrowed(r.criteria) && r.owners !== 'all' && trustedPlan(hit.plan, bound)) { r.owners.add(hit.plan.ownerSessionId); if (r.owners.size > OWNER_LIMIT) r.owners = 'all'; }
        if (!inPlace(r.criteria, hit.plan, r.frozen, bound)) continue;
        if (hit.classified) { r.matchedPlans += 1; r.matchingTasks += hit.classified.matchingTasks; }
        if (page.length < SEARCH_PAGE) page.push(hit); else r.buffer.push(hit);
      }
      r.gapped ||= w.coverage.gapped;
      r.skippedRecords += w.coverage.skippedRecords;
      for (const reason of w.coverage.reasons) r.reasons.add(reason);
      r.cursor = w.nextCursor; r.exhausted = w.exhausted;
      // Results appear as they are found; the action itself keeps going (bounded) until it stops.
      if (w.hits.length) this.host.changed();
    }
    r.busy = false;
    if (!failed && r.stop !== 'hidden') {
      r.stop = page.length < SEARCH_PAGE && !r.exhausted ? 'paused' : null;
      this.say(r, outcomeText(r, page.length));
    }
    this.host.changed();
  }
}

function outcomeText(r: Run, shown: number) {
  const found = `${r.matchedPlans === 1 ? '1 plan' : `${r.matchedPlans} plans`} and ${r.matchingTasks === 1 ? '1 matching task' : `${r.matchingTasks} matching tasks`}`;
  if (r.exhausted && !r.buffer.length) return r.matchedPlans ? `Search finished: ${found} found, as searched.` : 'Search finished: nothing matched, as searched.';
  if (!shown) return 'No matches found yet; more recorded plans remain unchecked.';
  return `${found} found so far; more recorded plans may match.`;
}

/**
 * Abbreviated ancestor context of a task hit: the root, an explicit omission count, then the two
 * nearest ancestors. Nothing is invented; the full chain is in the plan itself.
 */
export function breadcrumb(hit: Pick<SearchHitView, 'ancestors' | 'omittedAncestors'>) {
  const a = hit.ancestors;
  if (a.length <= 3 && !hit.omittedAncestors) return { head: a, omitted: 0, tail: [] as SearchHitView['ancestors'] };
  const tail = a.slice(Math.max(1, a.length - 2));
  return { head: a.slice(0, 1), omitted: hit.omittedAncestors + (a.length - 1 - tail.length), tail };
}

/** Consecutive hits of one plan form one group (the backend emits plan order, then task order). */
export function groupHits(hits: SearchHitView[], changed: Set<string> = new Set()): SearchGroup[] {
  const groups: SearchGroup[] = [];
  for (const h of hits) {
    const last = groups.at(-1);
    if (last && last.plan.key === h.plan.key) { if (h.task) last.hits.push(h); continue; }
    groups.push({ plan: h.plan, continued: h.continued, planOnly: !h.task, changed: changed.has(h.plan.key), hits: h.task ? [h] : [] });
  }
  return groups;
}
