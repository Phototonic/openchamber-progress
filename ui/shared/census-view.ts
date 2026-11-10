// Sub-agents section for rail, Work Status and the full page (model: subagents.ts). Every row keeps
// three facts apart: Ran (host run facts), Claimed (the child's own optional handoff, labelled as
// reported) and Accepted (task status explicitly reported in this plan). A section exists only with
// a plan in scope and something useful to show. Words and shapes carry each state; colour only
// reinforces it. No label here expires: the frame ticker only moves time text.
import { age, el, info, testid, type Env } from './components.ts';
import { icon, warningLine, type WarningTone } from './primitives.ts';
import { elapsedText, plural } from './format.ts';
import { STATUS_LABEL } from './model.ts';
import { EARLIER_STEP, rosterFor, type Ran, type Roster, type RosterInput, type RosterNote, type SubagentEntry } from './subagents.ts';
import type { RunsPanel } from './runs.ts';

export interface SubagentsView extends RosterInput { env: Env }

/** Run request of one root with the plan in scope (useful view); the plan's cleanup generation fences it. */
export const runClaim = (read: { storeId: string; binding: { sourceId: string | null; verified: boolean }; captureEnabled: boolean }, root: string, plan: { sourceId: string; id: string; cleanup?: { revision: number } }) => ({
  request: { storeId: read.storeId, binding: { sourceId: read.binding.sourceId, verified: read.binding.verified }, source: plan.sourceId, root, plan: plan.id, cleanupRev: plan.cleanup?.revision ?? 0, view: 'useful' as const },
  captureEnabled: read.captureEnabled,
});

const STATE: Record<Ran['kind'], string> = { active: 'active', waiting: 'waiting', idle: 'idle', finished: 'ended', failed: 'failed', interrupted: 'interrupted', unknown: 'unknown' };
const SOURCE: Record<Ran['source'], string> = {
  event: 'From the host’s run events.',
  dispatch: 'From the dispatch record; the host has not reported this run’s outcome yet.',
  history: 'From the host’s session history: the session’s last completed run, not a specific dispatch.',
  host: 'What OpenChamber lists for this session now.',
};
const iso = (ms: number) => new Date(ms).toISOString();
const CLAIM: Record<string, string> = { done: 'done', partial: 'partly done', blocked: 'blocked' };

/** The Ran line: a mark, the state words, its real host time and a justified duration. */
function ranNode(r: Ran, env: Env, compact: boolean) {
  const n = el('span', 'ap-obs');
  n.dataset.state = STATE[r.kind];
  n.title = SOURCE[r.source];
  const mark = el('span', 'ap-obs-mark');
  mark.setAttribute('aria-hidden', 'true');
  n.append(mark, el('span', 'ap-obs-label', compact && r.kind === 'waiting' ? 'Waiting on you' : r.label));
  if (r.time) n.append(age(iso(r.time.at), env, compact ? ' · ' : ` · ${r.time.prefix}`));
  if (r.duration && !compact) {
    const d = elapsedText(r.duration.ms);
    if (d) n.append(el('span', 'ap-obs-last', r.duration.fromDispatch ? ` · ${d} after dispatch` : ` · took ${d}`));
  }
  return n;
}

/** The host's current word for a child whose latest recorded run already ended. */
function nowNode(now: NonNullable<SubagentEntry['now']>, compact: boolean) {
  const n = el('span', 'ap-obs ap-obs-now');
  n.dataset.state = now.kind;
  n.title = 'What OpenChamber lists for this session now. Its recorded run above is unchanged.';
  const mark = el('span', 'ap-obs-mark');
  mark.setAttribute('aria-hidden', 'true');
  n.append(mark, el('span', 'ap-obs-label', compact ? (now.kind === 'waiting' ? 'Waiting on you' : `${now.label} again`) : `${now.label} again now`));
  return n;
}

function acceptedText(a: NonNullable<SubagentEntry['accepted']>, compact: boolean) {
  const word = (s: string) => STATUS_LABEL[s as keyof typeof STATUS_LABEL].toLowerCase();
  if (a.tasks.length === 1 && !a.omitted) {
    const t = a.tasks[0];
    return compact ? `task ${word(t.status)}` : `Task reported ${word(t.status)}${t.title ? `: ${t.title}` : ''}`;
  }
  const by = new Map<string, number>();
  for (const t of a.tasks) by.set(t.status, (by.get(t.status) ?? 0) + 1);
  const parts = [...by].map(([s, n]) => `${n} ${word(s)}`).join(', ');
  const n = a.tasks.length + a.omitted;
  return compact ? `${n} tasks: ${parts}` : `${plural(n, 'task', 'tasks')} reported: ${parts}${a.omitted ? `, ${a.omitted} more` : ''}`;
}

function claimNode(c: NonNullable<SubagentEntry['claimed']>, env: Env, compact: boolean) {
  const n = el('span', 'ap-claim');
  n.dataset.outcome = c.outcome;
  if (compact) { n.textContent = `claims ${CLAIM[c.outcome]}`; return n; }
  n.append(el('span', '', `Reported ${CLAIM[c.outcome]}`), el('q', 'ap-claim-text', c.summary), age(iso(c.reportedAt), env, ' · '));
  if (c.association === 'session-only') n.append(el('span', 'ap-obs-last', ' · not matched to one run'));
  return n;
}

function openButton(e: SubagentEntry, env: Env) {
  if (!env.openSession || !e.openable || !e.sessionId) return null;
  const b = testid(el('button', 'ap-link', 'Open'), `open-observed-${e.sessionId}`);
  b.type = 'button';
  b.setAttribute('aria-label', `Open session ${e.title}`);
  const open = env.openSession, id = e.sessionId;
  b.addEventListener('click', () => open(id));
  return b;
}

/**
 * Rail and board: one line per sub-agent (state, title, agent, real time) that expands in place to
 * every recorded fact (Ran / Claimed / Accepted, lineage, source, a verified Open).
 */
function expandRow(e: SubagentEntry, env: Env, agent = true) {
  const li = testid(el('li', 'ap-obs-row ap-obs-xrow'), `subagent-row-${e.key}`);
  li.dataset.role = 'child';
  li.dataset.depth = String(e.depth);
  if (e.runId) li.dataset.run = e.runId;
  if (e.sessionId) li.dataset.session = e.sessionId;
  li.dataset.ran = e.ran.kind;
  if (e.now) li.dataset.now = e.now.kind;
  li.style.setProperty('--depth', String(Math.min(e.depth, 6)));
  li.setAttribute('aria-level', String(e.depth));
  const d = testid(el('details', 'ap-obs-x'), `subagent-toggle-${e.key}`);
  const summary = el('summary', 'ap-obs-line');
  const title = el('span', 'ap-obs-title', e.title);
  summary.append(title);
  if (e.parentTitle) summary.append(el('span', 'ap-sr', `, started by ${e.parentTitle}`));
  // Agent, state words with real time, and the chevron wrap together under a long title.
  const end = el('span', 'ap-obs-end');
  // Work Status keeps the agent in the expanded facts only, so a running row fits one line.
  if (e.agent && agent) end.append(el('span', 'ap-obs-agent', e.agent));
  end.append(e.now ? nowNode(e.now, true) : ranNode(e.ran, env, true), icon('chevron-down'));
  summary.append(end);
  d.append(summary);
  const body = el('div', 'ap-obs-body');
  const meta = [e.agent, e.historical ? 'from session history' : null, e.duringPlan ? 'dispatched during this plan' : null, e.parentTitle ? `started by ${e.parentTitle}` : null].filter((x): x is string => !!x);
  if (meta.length) body.append(el('div', 'ap-obs-meta', meta.join(' · ')));
  const facts = el('dl', 'ap-obs-facts');
  const add = (term: string, value: Node, hook: string) => { const f = el('div'); f.dataset.fact = hook; f.append(el('dt', '', term)); const dd = el('dd'); dd.append(value); f.append(dd); facts.append(f); };
  const ran = el('span', 'ap-ran');
  ran.append(ranNode(e.ran, env, false));
  if (e.now) ran.append(el('br'), nowNode(e.now, false));
  add('Ran', ran, 'ran');
  if (e.claimed) add('Claimed', claimNode(e.claimed, env, false), 'claimed');
  if (e.accepted) add('Accepted', el('span', 'ap-obs-assign', acceptedText(e.accepted, false)), 'accepted');
  body.append(facts);
  const open = openButton(e, env);
  if (open) body.append(open);
  d.append(body);
  li.append(d);
  return li;
}

/** Running now, from the host (including a finished run's child running again); everything else folds. */
const running = (e: SubagentEntry) => e.now ? e.now.kind === 'active' : e.ran.kind === 'active';

const NOTE: Record<RosterNote['kind'], string> = {
  'runs-unavailable': 'Run records aren’t available from this progress service, so only sub-agents OpenChamber lists now are shown.',
  'runs-error': 'Run records couldn’t be read just now; they’ll be read again on the next refresh.',
  'capture-off': 'Capture is off: new runs aren’t recorded. Earlier records stay readable.',
  'capture-loss': 'Some runs weren’t recorded because storage was full or unavailable.',
  'history-loading': 'Loading older sub-agent history…',
  'history-partial': 'Older history was only partly loaded; counts may be low.',
  'history-failed': 'Older history couldn’t be loaded.',
  'history-request-failed': 'Older history couldn’t be requested.',
  'history-off': 'Older history isn’t loaded while capture is off.',
  'history-unavailable': 'Older history can’t be loaded until the companion is running.',
  'traversal-limit': 'There are more nested sub-agents than are counted here.',
  'host-gaps': 'Some sessions couldn’t be verified as sub-agents of this session, so they’re left out.',
  'host-truncated': 'OpenChamber lists more sub-agents than this view checks (128 rows, 2,000 sessions, 32 levels), so some current activity — including a child waiting on you — may not be shown or counted. Recorded runs are unaffected.',
  'host-activity-unavailable': 'OpenChamber’s session list is reloading or incomplete, so current activity (waiting, running again, idle now) isn’t shown; recorded runs are unchanged.',
};

/**
 * Rail and board: routine qualifications go behind the "Partial" cue beside the counts; the others
 * (unavailable or failed reads, capture off, history loading or unavailable, withheld current
 * activity) stay visible lines. Work Status keeps its own one short line (notesNode).
 */
const ROUTINE: ReadonlySet<RosterNote['kind']> = new Set<RosterNote['kind']>(['capture-loss', 'history-partial', 'host-truncated', 'traversal-limit', 'host-gaps', 'history-off']);
export const routineNote = (n: RosterNote) => ROUTINE.has(n.kind);

function summaryNode(r: Roster, compact: boolean) {
  const p = testid(el('p', 'ap-sub-summary'), 'subagent-count');
  p.title = r.recorded ? 'Runs recorded for this session and its sub-agents. A finished run is not a finished task.' : 'Sub-agents OpenChamber lists now; no run records were available.';
  for (const s of r.summary) {
    const part = el('span', 'ap-sub-part');
    part.dataset.kind = s.kind;
    const mark = el('span', 'ap-obs-mark');
    mark.setAttribute('aria-hidden', 'true');
    part.append(mark, s.text);
    p.append(part);
  }
  if (r.soFar) p.append(el('span', 'ap-sub-part ap-muted', 'so far'));
  // Counts from host-listed children stop at the census limit: never shown as complete. Rail and
  // board say so through the "Partial" cue instead.
  if (r.hostTruncated && compact) p.append(testid(el('span', 'ap-sub-part ap-muted', 'more not checked'), 'subagent-truncated'));
  return p;
}

/** Work Status: one short line for genuine unavailability only; detail lives in the rail. */
function notesNode(r: Roster) {
  const n = r.notes.find((x) => x.kind === 'runs-unavailable' || x.kind === 'runs-error' || x.kind === 'capture-loss' || x.kind === 'host-activity-unavailable' || x.kind === 'host-truncated');
  if (!n) return null;
  const p = testid(el('p', 'ap-note', n.kind === 'capture-loss' ? 'Some runs weren’t recorded.' : n.kind === 'host-activity-unavailable' ? 'Current activity unavailable.' : n.kind === 'host-truncated' ? 'Not every sub-agent is checked.' : 'Run records unavailable.'), 'subagent-coverage');
  p.dataset.notes = n.kind;
  return p;
}

/**
 * The earlier list's pager: its label, or null when there is nothing more to show or read. A held
 * continuation cursor always keeps it: the estimated remainder can be wrong (a host-only row may
 * stand in for an unloaded record), and only reading the next page settles it.
 */
export function earlierPager(r: Pick<Roster, 'earlier' | 'earlierTotal' | 'canPage'>, runs: Pick<RunsPanel, 'paging' | 'continuation'> | null, visible: number, step: number): string | null {
  const loaded = r.earlier.length;
  const left = r.earlierTotal - Math.min(visible, loaded);
  if (!runs || !((visible < loaded || r.canPage) && left > 0) && !runs.continuation) return null;
  return runs.paging ? 'Loading…' : left > 0 ? `Show ${Math.min(step, left)} more` : 'Show more';
}

/**
 * Rail and board: every record that is not running now, folded under one summary line. Waiting,
 * failed, interrupted, finished, idle and unknown keep their own words; the existing pager reads on.
 */
function recordsNode(r: Roster, v: SubagentsView, rest: SubagentEntry[], agent = true) {
  const step = EARLIER_STEP[v.surface];
  const visible = Math.max(step, v.runs?.shown ?? 0);
  const total = rest.length + r.earlierTotal;
  const runs = v.runs;
  const label = earlierPager(r, runs, visible, step);
  if (!total && !label) return null;
  const more = testid(el('details', 'ap-obs-more'), 'observed-more');
  more.append(el('summary', '', `${r.featured.some(running) ? 'Other records' : 'Sub-agent records'} · ${total}`));
  const list = el('ul', 'ap-obs-list');
  list.setAttribute('aria-label', 'Other sub-agent records');
  for (const e of [...rest, ...r.earlier.slice(0, visible)]) list.append(expandRow(e, v.env, agent));
  if (list.childElementCount) more.append(list);
  if (runs && label) {
    const b = testid(el('button', 'ap-link ap-sub-page', label), 'subagent-more');
    b.type = 'button';
    // Not `disabled`: a disabled button drops keyboard focus mid-read. The controller ignores repeats.
    if (runs.paging) b.setAttribute('aria-disabled', 'true');
    const loaded = r.earlier.length;
    b.addEventListener('click', () => { if (!runs.paging) runs.showMore(Math.min(visible, loaded), loaded, step); });
    more.append(b);
  }
  if (runs?.pageError) more.append(el('p', 'ap-note', 'More rows couldn’t be read. Try again in a moment.'));
  return more;
}

/**
 * One coverage line, with Load more / Retry history where the read offers it. A started request
 * replaces the line and its button with the visible "Loading older sub-agent history…"; the frame's
 * focus restoration then hands focus to the cue or the heading (app.ts, coverage fallback).
 */
function noteItem(n: RosterNote, tone: WarningTone, runs: RunsPanel | null) {
  const li = el('li');
  li.append(warningLine(NOTE[n.kind], tone, 'span'));
  if (runs && ((n.kind === 'history-partial' || n.kind === 'history-failed') && n.token || n.kind === 'history-request-failed')) {
    const b = testid(el('button', 'ap-link', n.kind === 'history-partial' ? 'Load more history' : 'Retry history'), 'subagent-retry-history');
    b.type = 'button';
    // Not `disabled`: a disabled button drops keyboard focus. The controller ignores repeats.
    if (runs.reconciling) b.setAttribute('aria-disabled', 'true');
    b.addEventListener('click', () => { if (!runs.reconciling) runs.retryHistory(); });
    li.append(b);
  }
  return li;
}

/** Rail and board: the notes that stay visible compact lines (the routine ones are behind the cue). */
function coverageNode(notes: RosterNote[], runs: RunsPanel | null) {
  if (!notes.length) return null;
  const list = testid(el('ul', 'ap-sub-notes ap-warn-list'), 'subagent-coverage');
  list.dataset.notes = notes.map((n) => n.kind).join(' ');
  for (const n of notes) list.append(noteItem(n, visibleTone(n), runs));
  return list;
}

/** Visible lines keep their tones: information for loading and capture off, a warning otherwise. */
const visibleTone = (n: RosterNote): WarningTone => n.kind === 'history-loading' || n.kind === 'capture-off' ? 'info' : 'warning';
/**
 * Notes behind the cue are routine, so they carry a muted mark, never orange. One place decides,
 * so a single note (such as a recent storage loss) can later take the warning tone.
 */
export const cueTone = (_n: RosterNote): WarningTone => 'neutral';

const CUE = 'subagent-coverage-cue';
let cueCount = 0;

/**
 * Rail and board: the muted "Partial" cue after the counts, a native button that expands the
 * routine notes inline below the header (`aria-expanded`/`aria-controls`; closed by default, no
 * hover or popover). The button sits in the counts' wrapping row and the notes below the header,
 * so they cannot share one `details`. Like a `details[data-testid]` across a repaint (app.ts), the open
 * state carries over from the painted cue of the same scope; focus returns through its test ID.
 */
function coverageCue(notes: RosterNote[], runs: RunsPanel | null, scope: string) {
  const id = `ap-sub-cue-${cueCount += 1}`;
  const button = testid(el('button', 'ap-sub-cue'), CUE);
  button.type = 'button';
  button.dataset.scope = scope;
  // Not the counts' tooltip: the cue's words and its notes say what it means.
  button.title = '';
  button.setAttribute('aria-controls', id);
  // Named "Partial sub-agent coverage"; its expanded state says whether the notes are shown.
  button.append(el('span', '', 'Partial'), el('span', 'ap-sr', ' sub-agent coverage'), icon('chevron-down'));
  const region = testid(el('div', 'ap-sub-cue-notes'), 'subagent-coverage-notes');
  region.id = id;
  region.dataset.notes = notes.map((n) => n.kind).join(' ');
  const list = el('ul', 'ap-sub-notes ap-warn-list');
  for (const n of notes) list.append(noteItem(n, cueTone(n), runs));
  region.append(list);
  const set = (open: boolean) => { button.setAttribute('aria-expanded', String(open)); region.hidden = !open; };
  const painted = document.querySelector<HTMLElement>(`[data-testid="${CUE}"]`);
  set(painted?.dataset.scope === scope && painted.getAttribute('aria-expanded') === 'true');
  button.addEventListener('click', () => set(button.getAttribute('aria-expanded') !== 'true'));
  return { button, region };
}

const ABOUT = [
  'Ran is what OpenChamber recorded about each run: from the host’s run events, the dispatch record, or the session’s history. A finished run is not a finished task.',
  'Claimed is the sub-agent’s own optional report, shown as it reported it. Accepted is the task status this plan records.',
  'Running is observed by the host for sessions and sub-agents only; tasks are reported working, not running.',
];

/** The section, or null: no plan in scope, an unverified setup, or nothing useful to show. */
export function subagentsBlock(v: SubagentsView): HTMLElement | null {
  const r = rosterFor(v);
  if (!r) return null;
  const compact = v.surface === 'status';
  // Every surface: running rows on one line each, every other record folded. Work Status keeps its
  // one short coverage line and no ⓘ (an explanation popover would be clipped by its auto height).
  const section = testid(el('section', 'ap-section ap-census ap-census-calm'), 'subagent-activity');
  section.dataset.state = r.recorded ? 'ready' : 'host-only';
  section.dataset.complete = String(r.recorded && !r.soFar && !r.notes.some((n) => n.kind !== 'capture-off' && n.kind !== 'history-off'));
  section.setAttribute('aria-label', 'Sub-agents');
  const head = el('div', 'ap-census-head');
  const title = el('div', 'ap-census-title');
  const heading = el(v.surface === 'page' ? 'h3' : 'h2', 'ap-h', 'Sub-agents');
  title.append(heading);
  // Rail and board: plan and selected session. A focused coverage control that a repaint removes
  // hands focus on only within the same scope (app.ts, coverage fallback).
  const scope = JSON.stringify([v.plan!.sourceId, v.plan!.id, v.currentSession]);
  if (!compact) {
    section.dataset.scope = scope;
    // Where focus lands when a repaint removes a focused coverage control (never a Tab stop).
    testid(heading, 'subagent-heading').tabIndex = -1;
    title.append(info('subagent-records', 'About sub-agent records', ABOUT));
  }
  head.append(title);
  const counts = r.summary.length ? summaryNode(r, compact) : null;
  if (counts) head.append(counts);
  section.append(head);
  const routine = compact ? [] : r.notes.filter(routineNote);
  if (routine.length) {
    const cue = coverageCue(routine, v.runs, scope);
    // The last item of the counts' wrapping row, so it stays beside them at any width.
    (counts ?? head).append(cue.button);
    section.append(cue.region);
  }
  const now = r.featured.filter(running);
  if (now.length) {
    const list = el('ul', 'ap-obs-list');
    list.setAttribute('aria-label', 'Running sub-agents');
    for (const e of now) list.append(expandRow(e, v.env, !compact));
    section.append(list);
  }
  const records = recordsNode(r, v, r.featured.filter((e) => !running(e)), !compact);
  if (records) section.append(records);
  const notes = compact ? notesNode(r) : coverageNode(r.notes.filter((n) => !routineNote(n)), v.runs);
  if (notes) section.append(notes);
  return section;
}
