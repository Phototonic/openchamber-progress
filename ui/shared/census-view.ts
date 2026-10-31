// Sub-agents section for rail, Work Status and the full page (model: subagents.ts). Every row keeps
// three facts apart: Ran (host run facts), Claimed (the child's own optional handoff, labelled as
// reported) and Accepted (task status explicitly reported in this plan). A section exists only with
// a plan in scope and something useful to show. Words and shapes carry each state; colour only
// reinforces it. No label here expires: the frame ticker only moves time text.
import { age, el, testid, type Env } from './components.ts';
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

function rowNode(e: SubagentEntry, env: Env, compact: boolean, withOpen = !compact) {
  const li = testid(el('li', 'ap-obs-row'), `subagent-row-${e.key}`);
  li.dataset.role = 'child';
  li.dataset.depth = String(e.depth);
  if (e.runId) li.dataset.run = e.runId;
  if (e.sessionId) li.dataset.session = e.sessionId;
  li.dataset.ran = e.ran.kind;
  if (e.now) li.dataset.now = e.now.kind;
  if (compact) li.dataset.compact = '';
  li.style.setProperty('--depth', String(Math.min(e.depth, 6)));
  li.setAttribute('aria-level', String(e.depth));
  const head = el('div', 'ap-obs-head');
  const title = el('span', 'ap-obs-title', e.title);
  title.title = e.title;
  head.append(title);
  if (e.parentTitle) head.append(el('span', 'ap-sr', `, started by ${e.parentTitle}`));
  // Work Status keeps one line per row; elsewhere a compact row gives the title its own line.
  const oneLine = compact && !withOpen;
  // A finished run whose child is working again leads with that current word on one-line rows.
  if (oneLine) head.append(e.now ? nowNode(e.now, true) : ranNode(e.ran, env, true));
  if (withOpen) { const b = openButton(e, env); if (b) head.append(b); }
  li.append(head);
  const meta = [e.agent, e.historical ? 'from session history' : null, e.duringPlan ? 'dispatched during this plan' : null].filter((x): x is string => !!x);
  if (compact) {
    const line = el('div', 'ap-obs-sub');
    if (!oneLine) { const r = ranNode(e.ran, env, true); r.dataset.fact = 'ran'; line.append(r); if (e.now) line.append(nowNode(e.now, true)); }
    if (e.claimed) { const c = claimNode(e.claimed, env, true); c.dataset.fact = 'claimed'; line.append(c); }
    if (e.accepted) { const a = el('span', 'ap-obs-assign', acceptedText(e.accepted, true)); a.dataset.fact = 'accepted'; line.append(a); }
    if (line.childElementCount) li.append(line);
    return li;
  }
  if (meta.length) li.append(el('div', 'ap-obs-meta', meta.join(' · ')));
  const facts = el('dl', 'ap-obs-facts');
  const add = (term: string, value: Node, hook: string) => { const d = el('div'); d.dataset.fact = hook; d.append(el('dt', '', term)); const dd = el('dd'); dd.append(value); d.append(dd); facts.append(d); };
  const ran = el('span', 'ap-ran');
  ran.append(ranNode(e.ran, env, false));
  if (e.now) ran.append(el('br'), nowNode(e.now, false));
  add('Ran', ran, 'ran');
  if (e.claimed) add('Claimed', claimNode(e.claimed, env, false), 'claimed');
  if (e.accepted) add('Accepted', el('span', 'ap-obs-assign', acceptedText(e.accepted, false)), 'accepted');
  li.append(facts);
  return li;
}

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

function summaryNode(r: Roster) {
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
  // Counts from host-listed children stop at the census limit: never shown as complete.
  if (r.hostTruncated) p.append(testid(el('span', 'ap-sub-part ap-muted', 'more not checked'), 'subagent-truncated'));
  return p;
}

function notesNode(r: Roster, runs: RunsPanel | null, compact: boolean) {
  const notes = r.notes;
  if (compact) {
    // One short line for genuine unavailability only; detail lives in the rail.
    const n = notes.find((x) => x.kind === 'runs-unavailable' || x.kind === 'runs-error' || x.kind === 'capture-loss' || x.kind === 'host-activity-unavailable' || x.kind === 'host-truncated');
    if (!n) return null;
    const p = testid(el('p', 'ap-note', n.kind === 'capture-loss' ? 'Some runs weren’t recorded.' : n.kind === 'host-activity-unavailable' ? 'Current activity unavailable.' : n.kind === 'host-truncated' ? 'Not every sub-agent is checked.' : 'Run records unavailable.'), 'subagent-coverage');
    p.dataset.notes = n.kind;
    return p;
  }
  if (!notes.length) return null;
  const d = testid(el('details', 'ap-obs-more ap-sub-about'), 'subagent-about');
  d.append(el('summary', '', notes.some((n) => n.kind === 'history-loading') ? 'Loading older history…' : 'About these records'));
  const list = testid(el('ul', 'ap-sub-notes'), 'subagent-coverage');
  list.dataset.notes = notes.map((n) => n.kind).join(' ');
  for (const n of notes) {
    const li = el('li', '', NOTE[n.kind]);
    if (runs && ((n.kind === 'history-partial' || n.kind === 'history-failed') && n.token || n.kind === 'history-request-failed')) {
      const b = testid(el('button', 'ap-link', n.kind === 'history-partial' ? 'Load more history' : 'Retry history'), 'subagent-retry-history');
      b.type = 'button';
      b.disabled = runs.reconciling;
      b.addEventListener('click', () => runs.retryHistory());
      li.append(' ', b);
    }
    list.append(li);
  }
  d.append(list);
  return d;
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

function earlierNode(r: Roster, v: SubagentsView, compact: boolean) {
  if (!r.earlierTotal) return null;
  const step = EARLIER_STEP[v.surface];
  const visible = Math.max(step, v.runs?.shown ?? 0);
  const more = testid(el('details', 'ap-obs-more'), 'observed-more');
  more.append(el('summary', '', `${r.featured.length ? 'Earlier sub-agents' : 'Sub-agents'} · ${r.earlierTotal}`));
  const list = el('ul', 'ap-obs-list');
  list.setAttribute('aria-label', 'Earlier sub-agents');
  for (const e of r.earlier.slice(0, visible)) list.append(rowNode(e, v.env, true, !compact));
  if (list.childElementCount) more.append(list);
  const runs = v.runs;
  const loaded = r.earlier.length;
  const label = earlierPager(r, runs, visible, step);
  if (runs && label) {
    const b = testid(el('button', 'ap-link ap-sub-page', label), 'subagent-more');
    b.type = 'button';
    // Not `disabled`: a disabled button drops keyboard focus mid-read. The controller ignores repeats.
    if (runs.paging) b.setAttribute('aria-disabled', 'true');
    b.addEventListener('click', () => { if (!runs.paging) runs.showMore(Math.min(visible, loaded), loaded, step); });
    more.append(b);
  }
  if (runs?.pageError) more.append(el('p', 'ap-note', 'More rows couldn’t be read. Try again in a moment.'));
  if (compact && !list.childElementCount && !r.canPage) return null;
  return more;
}

/** The section, or null: no plan in scope, an unverified setup, or nothing useful to show. */
export function subagentsBlock(v: SubagentsView): HTMLElement | null {
  const r = rosterFor(v);
  if (!r) return null;
  const compact = v.surface === 'status';
  const section = testid(el('section', 'ap-section ap-census'), 'subagent-activity');
  section.dataset.state = r.recorded ? 'ready' : 'host-only';
  section.dataset.complete = String(r.recorded && !r.soFar && !r.notes.some((n) => n.kind !== 'capture-off' && n.kind !== 'history-off'));
  section.setAttribute('aria-label', 'Sub-agents');
  const head = el('div', 'ap-census-head');
  head.append(el(v.surface === 'page' ? 'h3' : 'h2', 'ap-h', 'Sub-agents'));
  section.append(head);
  if (r.summary.length) section.append(summaryNode(r));
  if (r.featured.length) {
    const list = el('ul', 'ap-obs-list');
    list.setAttribute('aria-label', 'Running, waiting and task-linked sub-agents');
    for (const e of r.featured) list.append(rowNode(e, v.env, compact));
    section.append(list);
  }
  const earlier = earlierNode(r, v, compact);
  if (earlier) section.append(earlier);
  const notes = notesNode(r, v.runs, compact);
  if (notes) section.append(notes);
  return section;
}
