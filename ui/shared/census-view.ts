// Sub-agents section for rail, Work Status and the full page. Three facts stay apart on every row:
// assignment (recorded task facts of the plan shown), reported updates (direct or relayed), and what
// OpenChamber observes now. Words and shapes carry each state; colour only reinforces it.
import { age, el, testid, type Env } from './components.ts';
import { clockTime, plural } from './format.ts';
import { assignmentOf, CENSUS_LIMITS, currentFor, isComplete, observe, UNKNOWN_NOW, updateOf, type Census, type CensusGap, type ObservedRow, type PlanFacts } from './census.ts';

export type CensusSurface = 'panel' | 'status' | 'page';

export interface CensusView {
  surface: CensusSurface;
  census: Census;
  facts: PlanFacts;
  /** The bound OpenCode setup is verified; otherwise no census is shown or navigable. */
  verified: boolean;
  captureEnabled: boolean;
  env: Env;
}

/** Rows shown before the overflow disclosure (the rest stay listed inside it, up to the A5 cap). */
const VISIBLE: Record<CensusSurface, number> = { panel: 8, status: 3, page: 12 };

const GAP_TEXT: Record<CensusGap, string> = {
  coverage: 'some folders of this project are still loading or unavailable',
  records: `this project has more than ${CENSUS_LIMITS.records} sessions`,
  depth: `sub-agents nest deeper than ${CENSUS_LIMITS.depth} levels`,
  rows: `only the first ${CENSUS_LIMITS.rows} are listed`,
  conflict: 'some session records conflict, so they and their sub-agents are left out',
  cycle: 'this session’s parent links loop back to it, so its sub-agents can’t be verified',
};

const cyclic = (c: Census) => c.state === 'ready' && c.gaps.includes('cycle');
const label = (r: ObservedRow) => r.title.trim() || `Session …${r.id.slice(-6)}`;

/** One observed-activity mark; expires in place (components.ts refreshLabels) while fresh. */
function observation(r: ObservedRow, env: Env, current: boolean, compact: boolean) {
  const o = observe(r, env.mono, current);
  const n = el('span', 'ap-obs');
  n.dataset.state = o.kind;
  const mark = el('span', 'ap-obs-mark');
  mark.setAttribute('aria-hidden', 'true');
  const word = compact && o.kind === 'waiting' ? 'Waiting' : o.label;
  // Work Status keeps one short word; the last observed state stays in the rail and page.
  n.append(mark, el('span', 'ap-obs-label', word), el('span', 'ap-obs-last', o.last && !compact ? ` · last seen ${o.last.toLowerCase()}` : ''));
  if (o.expiresAt !== null) {
    n.dataset.expires = String(o.expiresAt);
    n.dataset.staleLabel = UNKNOWN_NOW;
    n.dataset.staleLast = compact ? '' : ` · last seen ${word.toLowerCase()}`;
  }
  if (r.seenAt !== undefined) {
    const iso = new Date(r.seenAt).toISOString();
    if (compact) n.title = `${o.fresh ? 'Seen' : 'Last seen'} at ${clockTime(r.seenAt, env.locale)}`;
    else n.append(age(iso, env, o.fresh ? ' · seen ' : ' · '));
  }
  return n;
}

function assignmentText(sessionId: string, facts: PlanFacts, compact: boolean) {
  const a = assignmentOf(sessionId, facts);
  if (a.state === 'no-plan') return { key: 'no-plan', text: compact ? 'No task recorded here' : 'Observed child · no task assignment recorded here' };
  if (a.state === 'unknown') return { key: 'unknown', text: 'Assignment unknown', title: 'The plan’s task list has not loaded, so assignment can’t be checked.' };
  if (a.state === 'unassigned') return { key: 'unassigned', text: compact ? 'Unassigned here' : 'Unassigned in this plan' };
  const tasks = compact ? `Assigned ${a.count}` : `Assigned ${plural(a.count, 'task', 'tasks')}`;
  const from = !a.fromDelegation || compact ? '' : a.fromDelegation === a.count ? ' · from its delegation' : ` · ${a.fromDelegation} from its delegation`;
  return { key: 'assigned', text: `${tasks}${from}` };
}

function updateNode(sessionId: string, facts: PlanFacts, env: Env, compact: boolean) {
  const u = updateOf(sessionId, facts);
  if (u.state === 'unknown' || (u.state === 'none' && facts.kind !== 'complete')) return null;
  const n = el('span', 'ap-obs-update');
  n.dataset.update = u.state;
  if (u.state === 'none') { n.textContent = compact ? 'no update' : 'No update reported'; return n; }
  n.textContent = u.state === 'relayed' ? (compact ? 'relayed update' : 'Update relayed by parent') : (compact ? 'reported' : 'Reported an update');
  if (u.at && !compact) n.append(' · ', age(u.at, env));
  return n;
}

function openButton(r: ObservedRow, env: Env) {
  if (!env.openSession) return null;
  const b = testid(el('button', 'ap-link', 'Open'), `open-observed-${r.id}`);
  b.type = 'button';
  b.setAttribute('aria-label', `Open session ${label(r)}`);
  const open = env.openSession;
  b.addEventListener('click', () => open(r.id));
  return b;
}

function rowNode(r: ObservedRow, parent: string | null, v: CensusView, current: boolean, root: boolean) {
  const compact = v.surface === 'status';
  const li = testid(el('li', 'ap-obs-row'), `observed-session-${r.id}`);
  li.dataset.depth = String(r.depth);
  li.dataset.role = root ? 'root' : 'child';
  li.style.setProperty('--depth', String(Math.min(r.depth, 6)));
  li.setAttribute('aria-level', String(r.depth + 1));
  const head = el('div', 'ap-obs-head');
  const title = el('span', 'ap-obs-title', label(r));
  title.title = label(r);
  head.append(title);
  if (root) head.append(el('span', 'ap-obs-tag', v.surface === 'page' ? 'Main session' : 'This session'));
  else if (parent && r.depth > 1) head.append(el('span', 'ap-sr', `, started by ${parent}`));
  if (r.archived) head.append(el('span', 'ap-obs-tag', 'Archived'));
  if (compact) head.append(observation(r, v.env, current, true));
  // Navigation: verified setup, a host-listed session with verified ancestry, and not the session
  // already open here.
  else if (v.verified && !(root && (v.surface !== 'page' || cyclic(v.census)))) { const b = openButton(r, v.env); if (b) head.append(b); }
  li.append(head);
  if (compact) {
    if (!root) {
      const line = el('div', 'ap-obs-sub');
      const a = assignmentText(r.id, v.facts, true);
      const fact = el('span', 'ap-obs-assign', a.text);
      fact.dataset.assignment = a.key;
      line.append(fact);
      const u = updateNode(r.id, v.facts, v.env, true);
      if (u) line.append(u);
      li.append(line);
    }
    return li;
  }
  const facts = el('dl', 'ap-obs-facts');
  const add = (term: string, value: Node, hook: string) => { const d = el('div'); d.dataset.fact = hook; d.append(el('dt', '', term)); const dd = el('dd'); dd.append(value); d.append(dd); facts.append(d); };
  add('Now', observation(r, v.env, current, false), 'now');
  if (!root) {
    const a = assignmentText(r.id, v.facts, false);
    const node = el('span', 'ap-obs-assign', a.text);
    node.dataset.assignment = a.key;
    if (a.title) node.title = a.title;
    add('Tasks', node, 'assignment');
    const u = updateNode(r.id, v.facts, v.env, false);
    if (u) add('Updates', u, 'update');
  }
  li.append(facts);
  return li;
}

function coverageNote(c: Census, verified: boolean): string | null {
  if (!verified) return 'Sub-agents are shown once this view is connected to a verified OpenCode setup.';
  switch (c.state) {
    case 'none': return null;
    case 'loading': return 'Checking for sub-agents…';
    case 'unavailable':
      return c.reason === 'not-watched' ? 'Sub-agents aren’t listed: this window already follows as many projects as it can.'
        : c.reason === 'no-project' ? 'Sub-agents can’t be listed: this session’s project isn’t in OpenChamber’s project list here.'
          : 'Sub-agents can’t be listed right now: OpenChamber didn’t share this project’s sessions.';
    case 'not-seen': return 'This session isn’t in OpenChamber’s current session list, so its sub-agents can’t be shown.';
    case 'ready': {
      if (!c.gaps.length) return c.rows.length ? null : 'No sub-agents seen for this session.';
      const reasons = c.gaps.map((g) => GAP_TEXT[g]);
      return `${c.rows.length ? 'This list may be incomplete' : 'No sub-agents seen so far, but the list may be incomplete'}: ${reasons.join('; ')}.`;
    }
  }
}

/**
 * The section, or null when it has nothing to say on this surface (no root; Work Status without
 * any observed sub-agent, which keeps the compact section for reported progress).
 */
export function censusBlock(v: CensusView): HTMLElement | null {
  const c = v.census;
  if (c.state === 'none') return null;
  const compact = v.surface === 'status';
  const rows = v.verified && c.state === 'ready' ? c.rows : [];
  if (compact && !rows.length) return null;
  const section = testid(el('section', `ap-section ap-census`), 'subagent-activity');
  section.dataset.state = !v.verified ? 'unverified' : c.state;
  section.dataset.complete = String(v.verified && isComplete(c));
  section.setAttribute('aria-label', 'Sub-agents');
  const head = el('div', 'ap-census-head');
  head.append(el(v.surface === 'page' ? 'h3' : 'h2', 'ap-h', 'Sub-agents'));
  if (c.state === 'ready' && v.verified) head.append(testid(el('span', 'ap-note', c.gaps.length ? `${c.rows.length + c.omitted} seen so far` : plural(c.rows.length, 'seen', 'seen')), 'subagent-count'));
  section.append(head);
  if (v.surface === 'page') section.append(el('p', 'ap-note', 'Observed now in this window, not part of the plan’s recorded history.'));
  const note = coverageNote(c, v.verified);
  if (note) {
    const p = testid(el('p', c.state === 'ready' && c.gaps.length ? 'ap-doc-warn' : 'ap-note', note), 'subagent-coverage');
    if (c.state === 'ready') p.dataset.gaps = c.gaps.join(' ');
    section.append(p);
  }
  if (!v.captureEnabled && v.verified && c.state === 'ready') {
    section.append(testid(el('p', 'ap-note', compact ? 'Capture off: observations only, no new task links.' : 'Capture is off: these are OpenChamber observations only. New delegations aren’t linked to tasks, and tasks show their last report.'), 'subagent-capture-off'));
  }
  if (!v.verified || c.state !== 'ready') return section;
  const current = currentFor(c);
  const titles = new Map([[c.root.id, label(c.root)], ...c.rows.map((r) => [r.id, label(r)] as const)]);
  const list = el('ul', 'ap-obs-list');
  list.setAttribute('aria-label', 'Session and its sub-agents');
  list.append(rowNode(c.root, null, v, current, true));
  const shown = VISIBLE[v.surface];
  for (const r of rows.slice(0, shown)) list.append(rowNode(r, titles.get(r.parentId ?? '') ?? null, v, current, false));
  section.append(list);
  const rest = rows.slice(shown);
  if (rest.length || c.omitted) {
    const more = testid(el('details', 'ap-obs-more'), 'observed-more');
    const total = rest.length + c.omitted;
    more.append(el('summary', '', `${plural(total, 'more sub-agent', 'more sub-agents')}`));
    if (rest.length) {
      const extra = el('ul', 'ap-obs-list');
      extra.setAttribute('aria-label', 'More sub-agents');
      for (const r of rest) extra.append(rowNode(r, titles.get(r.parentId ?? '') ?? null, v, current, false));
      more.append(extra);
    }
    if (c.omitted) more.append(testid(el('p', 'ap-note', `${plural(c.omitted, 'more sub-agent is', 'more sub-agents are')} not listed here.`), 'observed-omitted'));
    section.append(more);
  }
  return section;
}
