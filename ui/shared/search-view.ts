// Board search DOM (docs/ui.md "Search"): the labelled form, explicit scope, chips, honest counts and
// coverage, grouped results and explicit actions. Untrusted titles land through textContent only.
import { mountSearchField, mountSelect, mountSpinner, type SelectOption } from '@openchamber/sdk/ui';
import { button, el, emptyBlock, FAILURE_COPY, glyph, planLocation, testid, type Env } from './components.ts';
import { plural } from './format.ts';
import { LIFECYCLE_LABEL, STATUS_LABEL, type ItemStatus, type Lifecycle, type SearchHitView, type SearchPlanView, type SourceView } from './model.ts';
import { ALL } from './scope.ts';
import { BLOCKED_TEXT, breadcrumb, narrowed, type LocationPart, type SearchCriteria, type SearchGroup, type SearchViewState } from './search.ts';

export interface SearchDraft { lifecycle: Lifecycle | typeof ALL; status: ItemStatus | typeof ALL; source: string }
export const NO_DRAFT: SearchDraft = { lifecycle: ALL, status: ALL, source: ALL };

/** Constraint a chip removes. Archive mode is the board's own visible choice, never a chip. */
export type ChipKind = 'q' | 'source' | 'lifecycle' | 'status' | 'project' | 'worktree' | 'session';

export interface SearchFormHooks {
  /** Text being edited (not yet searched); survives repaints. */
  text: () => string;
  setText: (q: string) => void;
  draft: SearchDraft;
  setDraft: (patch: Partial<SearchDraft>) => void;
  submit: () => void;
  /** The submitted criteria, or null while browsing. */
  submitted: SearchCriteria | null;
  problem: string | null;
  sources: SourceView[];
  archived: boolean;
}

const LIFECYCLES: Lifecycle[] = ['active', 'completed', 'cancelled', 'failed'];
const STATUSES: ItemStatus[] = ['pending', 'working', 'blocked', 'done', 'skipped'];

/** Whether the form differs from what the shown results were searched for. */
export const draftDiffers = (text: string, draft: SearchDraft, c: SearchCriteria | null) =>
  !!c && (text.trim() !== c.q.trim() || draft.lifecycle !== c.lifecycle || draft.status !== c.status || draft.source !== c.source);

/**
 * Labelled search form. Typing changes only the draft (no request, no repaint); Search or Enter in
 * the field submits, never during IME composition. No document-level key handling.
 */
export function searchForm(h: SearchFormHooks) {
  const form = testid(el('form', 'ap-search'), 'search-form');
  form.setAttribute('role', 'search');
  form.setAttribute('aria-label', 'Search plans and tasks');
  form.noValidate = true;
  form.addEventListener('submit', (event) => { event.preventDefault(); h.submit(); });
  const row = el('div', 'ap-search-row');
  const field = el('div', 'ap-search-field');
  const label = el('label', 'ap-search-label', 'Search titles and IDs');
  label.htmlFor = 'ap-search-q';
  const holder = testid(el('div'), 'search-query');
  mountSearchField(holder, { value: h.text(), label: 'Search titles and IDs', placeholder: 'Words from a plan or task title, or an ID', onChange: (q) => { h.setText(q); pending(); } });
  const input = holder.querySelector('input');
  if (input) {
    input.id = 'ap-search-q';
    // The frame's draft text is authoritative (Clear all empties it): no generic typed-field restore.
    input.setAttribute('aria-describedby', 'ap-search-help');
    input.maxLength = 1024;
    input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      // Enter commits an IME composition; it never submits then.
      if (event.isComposing || event.keyCode === 229) return;
      event.preventDefault();
      h.submit();
    });
  }
  field.append(label, holder);
  const help = el('p', 'ap-note ap-search-help', 'Every word must appear in the same plan’s or task’s own title or ID, in any order. Capitalization is ignored; accents are not (café and cafe differ).');
  help.id = 'ap-search-help';
  testid(help, 'search-help');
  row.append(field);
  const filters = el('div', 'ap-search-filters');
  const pick = (id: string, name: string, value: string, options: SelectOption[], set: (v: string) => void) => {
    const box = testid(el('div'), id);
    mountSelect(box, { label: name, value, options, onChange: (v) => { set(v); } });
    filters.append(box);
  };
  pick('search-lifecycle', 'Plan status', h.draft.lifecycle, [{ id: ALL, label: 'Any plan status' }, ...LIFECYCLES.map((l) => ({ id: l, label: LIFECYCLE_LABEL[l] }))], (v) => h.setDraft({ lifecycle: v as SearchDraft['lifecycle'] }));
  pick('search-task-status', 'Task status', h.draft.status, [{ id: ALL, label: 'Any task status' }, ...STATUSES.map((s) => ({ id: s, label: STATUS_LABEL[s] }))], (v) => h.setDraft({ status: v as SearchDraft['status'] }));
  if (h.sources.length > 1 || h.draft.source !== ALL) {
    const known = h.sources.some((s) => s.id === h.draft.source);
    pick('search-source', 'Recorded source', h.draft.source, [{ id: ALL, label: 'All recorded sources' }, ...h.sources.map((s) => ({ id: s.id, label: s.verified ? s.id : `${s.id} (unverified)` })), ...(known || h.draft.source === ALL ? [] : [{ id: h.draft.source, label: `${h.draft.source} (not available here)` }])], (v) => h.setDraft({ source: v }));
  }
  const submit = el('div', 'ap-search-submit');
  button(submit, 'search-submit', 'Search', () => h.submit(), 'default');
  filters.append(submit);
  row.append(filters);
  form.append(row, help);
  if (h.problem) {
    const p = testid(el('p', 'ap-doc-warn', h.problem), 'search-problem');
    p.setAttribute('role', 'alert');
    form.append(p);
  }
  const edit = testid(el('p', 'ap-note', 'Not searched yet: these results are for the previous search. Press Search to update them.'), 'search-pending-edit');
  form.append(edit);
  const pending = () => { edit.hidden = !draftDiffers(h.text(), h.draft, h.submitted); };
  pending();
  return form;
}

const sourceText = (c: Pick<SearchCriteria, 'source'>) => (c.source === ALL ? 'all recorded plans in this store' : `plans recorded by source ${c.source}`);
/** What is searched, in words; stays visible with zero, failed or unavailable results. */
export function scopeText(c: SearchCriteria) {
  const parts = [`Searching ${sourceText(c)}`, c.archived ? 'archived plans only' : 'current plans (archived plans excluded)'];
  if (narrowed(c)) parts.push('in the chosen project or worktree');
  if (c.session !== ALL) parts.push('where the chosen session is the owner, linked or a recorded contributor');
  return `${parts.join(', ')}. Ordinary board list pages are not the search scope.`;
}
export function scopeLine(c: SearchCriteria | null, archived: boolean) {
  const p = testid(el('p', 'ap-note ap-search-scope'), 'search-scope');
  p.textContent = c ? scopeText(c) : `Search checks ${archived ? 'every archived plan' : 'every current plan'} recorded in this store, not only the plans listed below.`;
  return p;
}

export interface ChipHooks { remove: (kind: ChipKind) => void; clearAll: () => void }
export function chipLabel(kind: ChipKind, c: SearchCriteria) {
  if (kind === 'q') return `Words: ${c.q.trim()}`;
  if (kind === 'source') return `Source: ${c.source}`;
  if (kind === 'lifecycle') return `Plan status: ${LIFECYCLE_LABEL[c.lifecycle as Lifecycle]}`;
  if (kind === 'status') return `Task status: ${STATUS_LABEL[c.status as ItemStatus]}`;
  if (kind === 'project') return `Project: ${c.labels.project ?? c.project}`;
  if (kind === 'worktree') return `Worktree: ${c.labels.worktree ?? c.worktree}`;
  return `Session: ${c.labels.session ?? c.session}`;
}
export const chipsOf = (c: SearchCriteria): ChipKind[] => (['q', 'source', 'lifecycle', 'status', 'project', 'worktree', 'session'] as ChipKind[]).filter((k) => (k === 'q' ? c.q.trim() !== '' : c[k] !== ALL));

/** One removable chip per submitted constraint, then Clear search and filters. */
export function chipsBlock(c: SearchCriteria, unavailable: ReadonlySet<ChipKind>, h: ChipHooks) {
  const wrap = testid(el('div', 'ap-search-chips'), 'search-chips');
  wrap.setAttribute('role', 'group');
  wrap.setAttribute('aria-label', 'Search constraints');
  const list = el('ul', 'ap-chip-list');
  for (const kind of chipsOf(c)) {
    const li = testid(el('li', 'ap-search-chip'), `search-chip-${kind}`);
    if (unavailable.has(kind)) li.dataset.available = 'false';
    const b = el('button', 'ap-chip-remove');
    b.type = 'button';
    const text = chipLabel(kind, c);
    const x = el('span', 'ap-chip-x', '×');
    x.setAttribute('aria-hidden', 'true');
    b.append(el('span', '', unavailable.has(kind) ? `${text} (not available here)` : text), x);
    b.setAttribute('aria-label', `Remove ${text}`);
    b.addEventListener('click', () => h.remove(kind));
    li.append(b);
    list.append(li);
  }
  wrap.append(list);
  button(wrap, 'search-clear', 'Clear search and filters', h.clearAll, 'ghost');
  return wrap;
}

let announcer: HTMLElement | null = null;
let announced = 0;
/**
 * One persistent polite region outside the repainted root speaks each explicit outcome once, never
 * per poll or repaint (a freshly inserted live region is announced unreliably).
 */
export function announceSearch(id: number, text: string) {
  if (!id || !text || id === announced) return;
  announced = id;
  if (!announcer?.isConnected) {
    announcer = testid(el('p', 'ap-sr'), 'search-announcer');
    announcer.setAttribute('role', 'status'); announcer.setAttribute('aria-live', 'polite'); announcer.setAttribute('aria-atomic', 'true');
    document.body.append(announcer);
  }
  const node = announcer;
  node.textContent = '';
  requestAnimationFrame(() => { if (announced === id) node.textContent = text; });
}

const plansText = (n: number) => plural(n, 'plan', 'plans');
const tasksText = (n: number) => plural(n, 'matching task', 'matching tasks');

/** Matched plans / matching tasks (accumulated) apart from this page's shown results and context rows. */
export function countsBlock(v: SearchViewState) {
  const box = testid(el('div', 'ap-search-counts'), 'search-counts');
  const final = v.exhausted && v.countsCurrent && !v.coverage.gapped && !v.stop;
  Object.assign(box.dataset, { matchedPlans: String(v.counts.matchedPlans), matchingTasks: String(v.counts.matchingTasks), shown: String(v.page.hits.length), context: String(v.page.contextRows), final: String(final), current: String(v.countsCurrent) });
  const found = `${plansText(v.counts.matchedPlans)} · ${tasksText(v.counts.matchingTasks)}`;
  const lead = !v.countsCurrent ? `Counted before results changed: ${found}` : final ? `Found: ${found}` : v.exhausted ? `Found in the plans that could be checked: ${found}` : `Found so far: ${found}`;
  box.append(el('p', 'ap-search-found', lead));
  const shown = v.page.hits.length;
  box.append(el('p', 'ap-note', `Showing ${plural(shown, 'result', 'results')} on page ${v.page.number}${v.page.contextRows ? ` · ${plural(v.page.contextRows, 'group or parent row', 'group or parent rows')} for context` : ''}. Plan done/total counts below always cover the whole plan.`));
  return box;
}

/** Record-scan completeness, skipped records, location interpretation and change qualifiers, kept apart. */
export function coverageBlock(v: SearchViewState) {
  const box = testid(el('div', 'ap-note ap-search-coverage'), 'search-coverage');
  box.dataset.state = v.exhausted ? (v.coverage.gapped ? 'gapped' : 'exhausted') : 'partial';
  if (v.coverage.gapped) box.dataset.gapped = 'true';
  const lines: string[] = [];
  lines.push(v.exhausted ? 'Every recorded plan in this scope was checked, as searched; reports may change, so this is not a live census.' : 'More recorded plans remain unchecked. Counts so far are not totals.');
  if (v.coverage.gapped) lines.push(`Some recorded plans couldn’t be read (unreadable or too large) and were skipped${v.coverage.skippedRecords ? ` (${v.coverage.skippedRecords} so far)` : ''}, so this search is incomplete.`);
  if (narrowed(v.criteria)) {
    // "Searched all" only once the scan is exhausted; a partial scan qualifies locations alone.
    const lead = v.exhausted ? 'Searched all recorded plans; project' : 'Project';
    lines.push(`${lead} membership is limited to locations this window knows${v.discoveryIncomplete ? ', and some are still unknown here' : ''}.`);
  }
  if (v.removed) lines.push(`${plural(v.removed, 'result was', 'results were')} removed because ${v.removed === 1 ? 'its plan was' : 'their plans were'} archived, restored or deleted.`);
  if (v.changedKeys) lines.push(`${plural(v.changedKeys, 'plan has', 'plans have')} changed since ${v.changedKeys === 1 ? 'it was' : 'they were'} found.`);
  if (!v.page.checked) lines.push('Checking that these earlier results are still current…');
  for (const line of lines) box.append(el('p', '', line));
  return box;
}

export interface ResultHooks {
  selected: { key: string; item: string | null } | null;
  openPlan: (hit: SearchHitView) => void;
  openTask: (hit: SearchHitView) => void;
}

const hitMeta = (plan: SearchPlanView, env: Env) => {
  const parts = [plan.id, planLocation({ ...plan, working: [], document: { state: 'unavailable', checklistSynchronized: false, currentFile: 'not-rechecked' } }, env.live, env.boundSource)];
  if (plan.lifecycle !== 'active') parts.push(LIFECYCLE_LABEL[plan.lifecycle]);
  if (env.boundSource === null || plan.sourceId !== env.boundSource) parts.push(`source ${plan.sourceId}`);
  if (!plan.sourceVerified) parts.push('unverified setup');
  parts.push(plan.counts.total ? `${plan.counts.done}/${plan.counts.total} done (whole plan)` : 'no counted tasks');
  return parts.join(' · ');
};

function groupBlock(g: SearchGroup, env: Env, h: ResultHooks) {
  const section = testid(el('section', 'ap-hit-group'), `search-group-${g.plan.sourceId}/${g.plan.id}`);
  Object.assign(section.dataset, { source: g.plan.sourceId, plan: g.plan.id });
  if (g.changed) section.dataset.changed = 'true';
  const head = testid(el('button', 'ap-hit ap-hit-plan'), `search-plan-${g.plan.sourceId}/${g.plan.id}`);
  head.type = 'button';
  Object.assign(head.dataset, { source: g.plan.sourceId, plan: g.plan.id, kind: 'plan' });
  if (h.selected?.key === g.plan.key && !h.selected.item) head.setAttribute('aria-current', 'true');
  head.append(el('span', 'ap-hit-title', g.plan.title), el('span', 'ap-hit-meta', hitMeta(g.plan, env)));
  const notes: string[] = [];
  if (g.continued) notes.push('Continued from the previous results');
  if (g.planOnly) notes.push('The plan’s own title or ID matches');
  if (g.changed) notes.push('Changed since found');
  if (notes.length) head.append(el('span', 'ap-hit-note', notes.join(' · ')));
  head.setAttribute('aria-label', `Open plan: ${g.plan.title}`);
  head.addEventListener('click', () => h.openPlan(g.hits[0] ?? { plan: g.plan, planMatched: true, task: null, ancestors: [], omittedAncestors: 0, continued: g.continued, classified: null }));
  section.append(head);
  if (g.hits.length) {
    const list = el('ul', 'ap-hit-tasks');
    list.setAttribute('aria-label', `Matching tasks in ${g.plan.title}`);
    for (const hit of g.hits) {
      const t = hit.task!;
      const li = el('li');
      const b = testid(el('button', 'ap-hit ap-hit-task'), `search-task-${g.plan.sourceId}/${g.plan.id}/${t.id}`);
      b.type = 'button';
      Object.assign(b.dataset, { source: g.plan.sourceId, plan: g.plan.id, item: t.id, status: t.status, kind: 'task' });
      if (h.selected?.key === g.plan.key && h.selected.item === t.id) b.setAttribute('aria-current', 'true');
      const line = el('span', 'ap-hit-line');
      const g1 = glyph(t.status); g1.setAttribute('aria-hidden', 'true'); g1.removeAttribute('role'); g1.removeAttribute('aria-label');
      const body = el('span', 'ap-hit-body');
      const head = el('span', 'ap-hit-head');
      head.append(el('span', 'ap-hit-title', t.title), el('span', 'ap-muted', STATUS_LABEL[t.status]), el('code', 'ap-hit-id', t.id));
      body.append(head);
      const crumb = breadcrumb(hit);
      if (crumb.head.length) {
        const c = testid(el('span', 'ap-hit-context'), 'search-context');
        c.dataset.omitted = String(crumb.omitted);
        const parts = [...crumb.head.map((a) => a.title), ...(crumb.omitted ? [`… ${crumb.omitted} more`] : []), ...crumb.tail.map((a) => a.title)];
        c.textContent = `In: ${parts.join(' › ')}`;
        body.append(c);
      }
      line.append(g1, body);
      b.append(line);
      b.setAttribute('aria-label', `Show task: ${t.title}, ${STATUS_LABEL[t.status]}, in plan ${g.plan.title}`);
      b.addEventListener('click', () => h.openTask(hit));
      li.append(b);
      list.append(li);
    }
    section.append(list);
  }
  return section;
}

export interface ActionHooks { more: () => void; retry: () => void; refresh: () => void; page: (delta: -1 | 1) => void; removeLocation: (part: LocationPart) => void; clearAll: () => void }

/** Grouped results for the shown page, with explicit continuation and recovery actions. */
export function resultsBlock(v: SearchViewState, env: Env, h: ResultHooks & ActionHooks) {
  const nav = testid(el('nav', 'ap-plan-list ap-search-results'), 'search-results');
  nav.setAttribute('aria-label', 'Search results');
  nav.dataset.scrollKey = 'search-results';
  nav.dataset.run = String(v.run);
  nav.dataset.page = String(v.page.number);
  if (v.blocked) {
    const box = testid(el('div', 'ap-search-blocked'), 'search-blocked');
    box.setAttribute('role', 'status');
    box.dataset.reason = v.blocked;
    box.dataset.parts = v.blockedParts.join(' ');
    box.append(el('p', '', BLOCKED_TEXT[v.blocked]));
    const row = el('div', 'ap-row');
    button(row, 'search-retry', 'Retry', h.retry);
    // Removing an unavailable project also removes its worktree; an unavailable worktree alone keeps the project.
    const part: LocationPart = v.blockedParts.includes('project') ? 'project' : 'worktree';
    const remove = button(row, 'search-remove-location', part === 'project' ? 'Remove project filter' : 'Remove worktree filter', () => h.removeLocation(part));
    remove.dataset.part = part;
    button(row, 'search-clear-blocked', 'Clear search and filters', h.clearAll, 'ghost');
    box.append(row);
    nav.append(box);
    return nav;
  }
  if (v.phase === 'loading') {
    const slot = testid(el('div', 'ap-row'), 'search-loading');
    mountSpinner(slot, { label: 'Searching recorded plans' });
    nav.append(slot);
    return nav;
  }
  nav.append(countsBlock(v));
  const shown = v.page.hits.length;
  if (!shown) {
    if (v.exhausted && !v.stop) {
      const certain = !v.coverage.gapped && !(narrowed(v.criteria) && v.discoveryIncomplete);
      nav.append(emptyBlock('search-empty', certain ? 'No plans or tasks match' : 'No matches in the plans and locations that could be checked', 'Try other words, or remove a constraint. Filters and Clear search stay above.'));
    } else if (v.stop === 'paused' || v.stop === 'hidden') {
      nav.append(testid(el('p', 'ap-note', 'No matches found yet; more recorded plans remain unchecked.'), 'search-none-yet'));
    }
  }
  for (const g of v.page.groups) nav.append(groupBlock(g, env, h));
  nav.append(coverageBlock(v));
  const actions = testid(el('div', 'ap-row ap-search-actions'), 'search-actions');
  if (v.hasPrevious) button(actions, 'search-prev', 'Previous results', () => h.page(-1));
  if (v.hasNext) button(actions, 'search-next', 'Next results', () => h.page(1));
  if (v.busy) {
    const slot = testid(el('span', 'ap-row'), 'search-loading');
    mountSpinner(slot, { label: 'Searching…' });
    actions.append(slot);
  } else if (v.stop === 'failed') {
    const copy = v.failure ? FAILURE_COPY[v.failure.kind] : FAILURE_COPY.unavailable;
    actions.append(testid(el('p', 'ap-doc-warn', `Searching stopped: ${copy.title}. Results so far are shown; nothing was treated as no match.`), 'search-failed'));
    button(actions, 'search-retry', 'Retry', h.retry);
  } else if (v.stop === 'conflict' || v.stop === 'changed' || v.stop === 'membership' || v.stop === 'retired' || v.stop === 'identity') {
    button(actions, 'search-refresh', 'Refresh search', h.refresh);
  } else if (!v.hasNext && v.more) {
    const full = shown >= 50;
    const more = button(actions, 'search-more', full ? 'Load more results' : 'Continue searching', h.more);
    more.dataset.action = full ? 'more' : 'continue';
  }
  if (actions.childElementCount) nav.append(actions);
  return nav;
}

/** Visible copy of the last explicit outcome; only announceSearch speaks it, once. */
export function statusLine(v: SearchViewState) {
  const p = testid(el('p', 'ap-note ap-search-status'), 'search-status');
  p.dataset.stop = v.stop ?? 'none';
  p.textContent = v.status.text;
  announceSearch(v.status.id, v.status.text);
  return p;
}

/** Older service: search is plainly unavailable; the board stays as it was. */
export const unavailableNote = () => testid(el('p', 'ap-note', 'Search is unavailable with this service version. The board below still lists plans as before.'), 'search-unavailable');
