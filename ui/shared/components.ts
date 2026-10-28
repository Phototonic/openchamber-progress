// DOM building blocks shared by the three surfaces. Every string lands through textContent.
import { mountBadge, mountBanner, mountButton, mountEmpty, mountSelect, mountSpinner, type SelectOption, type Tone } from '@openchamber/sdk/ui';
import type { Loadable, ReadingView, SummaryView } from './app.ts';
import { absoluteTime, baseName, clockTime, elapsedText, plural, relativeAge } from './format.ts';
import { canOpen, coverageFor, EMPTY_LIVE, liveLabel, sessionLabel, type Coverage, type LiveSnapshot } from './live.ts';
import { assignment, attention, blockedWait, readiness, type Attention, type InvalidReason, type Prerequisite, type ReadinessEntry, type ReadinessGroup } from './readiness.ts';
import {
  ALL_PARTICIPANTS, blockedWork, currentWork, DOCUMENT_STATE_TEXT, elapsedAt, jumpTargets, LIFECYCLE_LABEL, nextJump, participantIndex, participants, relationsOf, showsLiveness, STATUS_LABEL, summarize, summaryText, taskMatch, taskProjection,
  type BlockerCategory, type BranchSummary, type DocumentBody, type HistoryEntry, type ItemNode, type ItemView, type JumpKind, type ParticipantFilter, type ParticipantIndex, type PlanDetail, type PlanSummary, type PlanView, type Relation, type StoreRead, type TaskProjection,
} from './model.ts';
import { placeOf } from './scope.ts';
import type { ReadFailure } from './source.ts';

export interface Env {
  locale: string;
  now: number;
  /** Monotonic time of this paint (performance.now), for elapsed labels. */
  mono: number;
  live: LiveSnapshot;
  /** The service's verified source binding, or null. Navigation requires a match. */
  boundSource: string | null;
  /** Recorded sources the store does not mark verified; their plans show an unverified identity. */
  unverifiedSources: ReadonlySet<string>;
  /** The last read succeeded and capture is on; together with an active plan this gates motion. */
  view: { fresh: boolean; captureEnabled: boolean };
  openSession?: (sessionId: string) => void;
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

export const testid = <T extends HTMLElement>(node: T, id: string) => { node.dataset.testid = id; return node; };

export function age(iso: string, env: Env, prefix = '') {
  const t = el('time');
  t.dateTime = iso;
  t.dataset.age = prefix;
  t.title = absoluteTime(iso, env.locale);
  t.textContent = `${prefix}${relativeAge(iso, env.now, env.locale)}`;
  return t;
}

const elapsedLabelText = (kind: string | undefined, ms: number) => {
  const text = elapsedText(ms);
  return text === null ? 'time unknown' : kind === 'lower-bound' ? `at least ${text}` : text;
};

/**
 * How long a working task has been reported in progress, for the Now callout and Work Status.
 * Only for a working task of an active plan whose reply carried timing; a missing entry says the
 * start is unknown instead of showing zero. Ticks in place (refreshLabels).
 */
export function elapsedLabel(plan: PlanView, item: ItemView, detail: PlanDetail, env: Env) {
  if (plan.lifecycle !== 'active' || item.kind !== 'task' || item.status !== 'working' || !detail.timing) return null;
  const a = detail.timing[item.id];
  const t = testid(el('time', 'ap-elapsed'), `elapsed-${item.id}`);
  if (!a) {
    t.dataset.kind = 'unknown';
    t.textContent = 'time unknown';
    t.title = 'The progress service could not tell when this task was reported in progress.';
    return t;
  }
  t.dateTime = a.since;
  t.dataset.kind = a.kind;
  t.dataset.elapsed = String(a.elapsedAtRead);
  t.dataset.received = String(a.receivedAt);
  const at = absoluteTime(a.since, env.locale);
  t.title = a.kind === 'exact' ? `Reported in progress at ${at}` : `Observed in progress by ${at}; start unknown`;
  t.textContent = elapsedLabelText(a.kind, elapsedAt(a, env.mono));
  return t;
}

/**
 * Re-labels every age and elapsed time in place without repainting the view; text changes only
 * when the label differs. Elapsed time comes from each label's anchor, not from counted ticks.
 */
export function refreshLabels(root: ParentNode, locale: string, now = Date.now(), mono = performance.now()) {
  for (const t of root.querySelectorAll<HTMLTimeElement>('time[data-age]')) {
    const text = `${t.dataset.age ?? ''}${relativeAge(t.dateTime, now, locale)}`;
    if (t.textContent !== text) t.textContent = text;
  }
  for (const t of root.querySelectorAll<HTMLTimeElement>('time[data-elapsed]')) {
    const text = elapsedLabelText(t.dataset.kind, Number(t.dataset.elapsed) + Math.max(0, mono - Number(t.dataset.received)));
    if (t.textContent !== text) t.textContent = text;
  }
}

/** Blue in-progress status text; `data-text` feeds its decorative pulse overlay (style.ts). */
function workingText(text: string) {
  const t = el('span', 'ap-working-text', text);
  t.dataset.text = text;
  return t;
}

export function glyph(status: ItemView['status']) {
  const g = el('span', 'ap-glyph');
  g.dataset.status = status;
  g.setAttribute('role', 'img');
  g.setAttribute('aria-label', STATUS_LABEL[status]);
  return g;
}

export function chip(state: string, tone: 'info' | 'warning' | 'neutral', name?: string) {
  const c = el('span', 'ap-chip');
  const dot = el('span', 'ap-dot');
  dot.dataset.tone = tone;
  dot.setAttribute('aria-hidden', 'true');
  c.append(dot);
  if (name) c.append(el('b', '', name), el('span', 'ap-chip-state', state));
  else c.append(el('b', '', state));
  return c;
}

export function lifecycleBadge(plan: PlanView) {
  const b = el('span');
  const tone: Tone = plan.lifecycle === 'completed' ? 'success' : plan.lifecycle === 'failed' ? 'error' : 'neutral';
  mountBadge(b, { label: LIFECYCLE_LABEL[plan.lifecycle], tone });
  return b;
}

/** The at-a-glance progress story: big fraction, segmented bar, legend. */
export function progressBlock(s: PlanSummary, compact = false) {
  const wrap = el('div', 'ap-progress');
  const counts = testid(el('div', compact ? 'ap-row' : 'ap-fraction'), 'counts');
  counts.dataset.done = String(s.done);
  counts.dataset.total = String(s.total);
  counts.dataset.remaining = String(s.remaining);
  counts.dataset.skipped = String(s.skipped);
  if (compact) {
    const line = el('span', '', summaryText(s));
    if (s.working) line.append(' · ', workingText(`${s.working} in progress`));
    if (s.blocked) line.append(` · ${s.blocked} blocked`);
    counts.append(line);
  }
  else if (s.total === 0) counts.append(el('span', '', summaryText(s)));
  else counts.append(el('strong', '', `${s.done}/${s.total}`), el('span', '', `done · ${s.remaining} remaining${s.skipped ? ` · ${s.skipped} skipped` : ''}`));
  wrap.append(counts);
  if (s.total > 0) {
    const bar = el('div', 'ap-seg');
    bar.setAttribute('role', 'img');
    bar.setAttribute('aria-label', `${summaryText(s)}${s.working ? `, ${s.working} in progress` : ''}${s.blocked ? `, ${s.blocked} blocked` : ''}`);
    for (const [k, n] of [['done', s.done], ['working', s.working], ['blocked', s.blocked]] as const) {
      if (!n) continue;
      const seg = el('i');
      seg.dataset.k = k;
      seg.style.width = `${(Math.min(n, s.total) / s.total) * 100}%`;
      bar.append(seg);
    }
    wrap.append(bar);
    if (!compact) {
      const legend = el('div', 'ap-legend');
      legend.setAttribute('aria-hidden', 'true');
      const pending = Math.max(0, s.remaining - s.working - s.blocked);
      for (const [k, label, n] of [['done', 'done', s.done], ['working', 'in progress', s.working], ['blocked', 'blocked', s.blocked], ['pending', 'pending', pending]] as const) {
        if (!n) continue;
        const item = el('span');
        item.dataset.k = k;
        item.append(el('i'), k === 'working' ? workingText(`${n} ${label}`) : document.createTextNode(`${n} ${label}`));
        legend.append(item);
      }
      wrap.append(legend);
    }
  }
  return wrap;
}

export function planLocation(plan: PlanView, live: LiveSnapshot, bound?: string | null) {
  const place = placeOf(plan, live, bound);
  return place.worktreeLabel === 'Main checkout' || place.worktreeLabel === place.projectLabel ? place.projectLabel : `${place.projectLabel} · ${place.worktreeLabel}`;
}

/**
 * Host session titles and live state belong only to plans of the verified bound source; a foreign
 * or unverified plan's same-ID session must not borrow them (Readiness, Task view, rows, Sessions).
 */
const trustedSource = (plan: PlanView, env: Env) => env.boundSource !== null && plan.sourceId === env.boundSource;

function sessionChip(plan: PlanView, sessionId: string, env: Env) {
  const trusted = trustedSource(plan, env);
  const cov = coverageFor(sessionId, plan.directory, trusted ? env.live : EMPTY_LIVE);
  const l = trusted ? liveLabel(cov) : { label: 'from another OpenCode setup', tone: 'neutral' as const };
  return { cov, node: chip(l.label, l.tone, recordedLabel(plan, env)(sessionId)) };
}

function navButton(plan: PlanView, sessionId: string, cov: Coverage, env: Env) {
  if (!env.openSession || !canOpen(plan.sourceId, env.boundSource, cov)) return null;
  const b = testid(el('button', 'ap-link', 'Open session'), `open-session-${sessionId}`);
  b.type = 'button';
  const open = env.openSession;
  b.addEventListener('click', () => open(sessionId));
  return b;
}

export function planHeader(plan: PlanView, env: Env, headingLevel: 'h2' | 'h3' = 'h2') {
  const head = el('header', 'ap-plan-head');
  const top = el('div', 'ap-row ap-between');
  top.append(el(headingLevel, 'ap-plan-title ap-grow', plan.title));
  if (plan.lifecycle !== 'active') top.append(lifecycleBadge(plan));
  const meta = el('div', 'ap-meta');
  meta.append(el('span', '', planLocation(plan, env.live, env.boundSource)), age(plan.reportedAt, env, 'Updated '));
  if (env.boundSource !== null && plan.sourceId !== env.boundSource) meta.append(testid(el('span', '', 'From another OpenCode setup'), 'other-source'));
  if (env.unverifiedSources.has(plan.sourceId)) meta.append(testid(el('span', 'ap-doc-warn', 'Unverified OpenCode setup'), 'unverified-source'));
  head.append(top, meta);
  return head;
}

function currentWorkBlock(plan: PlanView, detail: PlanDetail, env: Env) {
  const working = currentWork(detail);
  const blocked = blockedWork(detail);
  if (!working.length && !blocked.length) return null;
  const box = testid(el('section', 'ap-now'), 'current-work');
  box.setAttribute('aria-label', 'Current work');
  box.append(el('span', 'ap-now-label', working.length ? 'Now' : 'Blocked'));
  for (const item of [...working, ...blocked].slice(0, 4)) {
    const row = el('div', 'ap-now-item');
    row.append(glyph(item.status), el('strong', '', item.title));
    const elapsed = elapsedLabel(plan, item, detail, env);
    if (elapsed) row.append(elapsed);
    const who = assigneeOf(item, detail);
    if (who && who !== plan.ownerSessionId) row.append(sessionChip(plan, who, env).node);
    box.append(row);
  }
  const rest = working.length + blocked.length - 4;
  if (rest > 0) box.append(el('span', 'ap-note', `and ${rest} more`));
  return box;
}

const assigneeOf = (item: ItemView, detail: PlanDetail) => item.assigneeSessionId ?? detail.links.find((l) => l.itemIds.includes(item.id))?.sessionId;
const NO_BRANCH: BranchSummary = { done: 0, total: 0, remaining: 0, skipped: 0, working: 0, blocked: 0, rows: 0, matching: 0, context: 0, hidden: 0, hiddenWorking: 0, hiddenBlocked: 0 };

/**
 * A branch's descendant facts, visible even while it is folded: full working/blocked (never
 * filtered), task rows hidden by a filter, and (only while closed, style.ts) the shown rows it folds.
 */
function branchLine(b: BranchSummary, view: TaskProjection, closed: boolean) {
  const line = el('span', 'ap-branch');
  const parts: HTMLElement[] = [];
  if (b.working) { const s = el('span', '', `${b.working} in progress`); s.dataset.k = 'working'; parts.push(s); }
  if (b.blocked) { const s = el('span', '', `${b.blocked} blocked`); s.dataset.k = 'blocked'; parts.push(s); }
  if (closed && parts.length) { const s = el('span', '', 'Last reported:'); s.dataset.k = 'lead'; parts.unshift(s); }
  if (view.filtered && b.hidden) parts.push(el('span', '', `${b.hidden} hidden by filter`));
  const shown = b.matching + b.context;
  if (shown) parts.push(el('span', 'ap-folded', `${plural(shown, 'task', 'tasks')} folded`));
  if (!parts.length) return null;
  line.append(...parts);
  return line;
}

/** The participant filter of one paint, with the plan's recorded relationships. */
interface Attribution { filter: ParticipantFilter; index: ParticipantIndex }

const RELATION_TEXT: Record<Relation, string> = {
  assigned: 'Assigned to this session',
  direct: 'Reported directly by this session',
  'direct-attributed': 'Direct report attributed to this session',
  'relayed-for': 'Reported for this session',
  'relayed-by': 'Relayed by this session',
  reporter: 'Recorded reporter · report mode unavailable',
  linked: 'Linked to this session · not an assignment',
};

/** Why a matching row matches the participant filter: every recorded relationship, once each. */
function reasonsLine(item: ItemView, who: Attribution) {
  const relations = relationsOf(who.index, item.id, who.filter);
  const line = testid(el('span', 'ap-reasons'), `reasons-${item.id}`);
  line.dataset.relations = who.filter.kind === 'none' ? 'none' : relations.join(' ');
  if (who.filter.kind === 'none') line.append(el('span', '', 'No participant recorded'));
  for (const r of relations) line.append(el('span', '', RELATION_TEXT[r]));
  return line;
}

/**
 * A task's recorded people, source-safe: its assignee chip (link fallback, never the owner) and
 * one "Reported by … for …" relay line. A `span` inside a task-parent's summary, else a `div`.
 */
function taskFacts(item: ItemView, plan: PlanView, detail: PlanDetail, env: Env, tag: 'div' | 'span') {
  const sub = el(tag, tag === 'span' ? 'ap-item-sub ap-summary-sub' : 'ap-item-sub');
  const who = assigneeOf(item, detail);
  const label = recordedLabel(plan, env);
  if (who && who !== plan.ownerSessionId) sub.append(sessionChip(plan, who, env).node);
  const relay = detail.contributions.find((x) => x.mode === 'parent-relay' && x.itemIds.includes(item.id));
  if (relay) sub.append(testid(el('span', '', `Reported by ${label(relay.reporterSessionId)} for ${label(relay.attributedSessionId)}`), `relay-${item.id}`));
  return sub.childNodes.length ? sub : null;
}

function itemRow(node: ItemNode, plan: PlanView, detail: PlanDetail, env: Env, view: TaskProjection, by: Attribution | null): HTMLLIElement {
  const { item } = node;
  const li = testid(el('li'), `${item.kind === 'group' ? 'group' : 'item'}-${item.id}`);
  li.dataset.status = item.status;
  // Filtered rows stay materialized in the one canonical tree; hidden ones leave tab and accessibility order.
  const state = view.rows.get(item.id) ?? 'match';
  if (view.filtered) li.dataset.focus = state;
  if (state === 'hidden') li.hidden = true;
  const reasons = by && by.filter.kind !== 'all' && state === 'match' && item.kind === 'task' ? reasonsLine(item, by) : null;
  // A named, programmatically focusable destination for in-detail task navigation (not a tab stop).
  if (item.kind === 'task') li.tabIndex = -1;
  if (item.kind === 'group' || node.children.length) {
    const b = view.branches.get(item.id) ?? NO_BRANCH;
    Object.assign(li.dataset, { working: String(b.working), blocked: String(b.blocked), filterHidden: String(b.hidden), folded: String(b.matching + b.context) });
    const details = el('details', 'ap-group');
    details.open = true;
    details.dataset.testid = `${item.kind === 'group' ? 'group' : 'item'}-toggle-${item.id}`;
    const summary = el('summary');
    if (item.kind === 'task') summary.append(glyph(item.status));
    summary.append(el('span', 'ap-grow', item.title));
    if (state === 'context' && item.kind === 'task') summary.append(el('span', 'ap-context', 'shown for context'));
    summary.append(el('span', 'ap-count', b.total ? `${b.done}/${b.total}` : ''));
    const facts = item.kind === 'task' ? taskFacts(item, plan, detail, env, 'span') : null;
    if (facts) summary.append(facts);
    if (reasons) summary.append(reasons);
    const line = branchLine(b, view, plan.lifecycle !== 'active');
    if (line) summary.append(line);
    const ul = el('ul');
    for (const c of node.children) ul.append(itemRow(c, plan, detail, env, view, by));
    details.append(summary, ul);
    li.append(details);
    return li;
  }
  const row = el('div', 'ap-item');
  row.dataset.status = item.status;
  const body = el('div');
  body.append(el('div', 'ap-item-title', item.title));
  const sub = taskFacts(item, plan, detail, env, 'div');
  if (sub) body.append(sub);
  if (reasons) body.append(reasons);
  row.append(glyph(item.status), body);
  li.append(row);
  return li;
}

/** Tasks heading; also the programmatic focus fallback of task-reading restoration (app.ts). */
function tasksHeading() {
  const h = el('h3', 'ap-h ap-tasks-h', 'Tasks');
  h.tabIndex = -1;
  return h;
}

export function itemList(plan: PlanView, detail: PlanDetail, env: Env, reading: ReadingView | null = null) {
  const section = el('section', 'ap-section ap-tasks');
  // Painted from complete detail, even without task rows (app.ts: not a loading gap).
  section.dataset.complete = '';
  section.append(tasksHeading());
  if (!detail.items.length) { section.append(el('p', 'ap-note', 'This plan has no tasks yet.')); return section; }
  const index = reading ? participantIndex(plan, detail) : null;
  const who = reading && index ? { filter: reading.participant, index } : null;
  const view = taskProjection(detail.items, reading && index ? taskMatch(reading, index) : null);
  const label = recordedLabel(plan, env);
  if (reading && who) section.append(taskControls(plan, view, reading, who, label));
  if (!view.totals.rows) section.append(testid(el('p', 'ap-note', 'No task rows are recorded in this plan, only groups.'), 'focus-no-tasks'));
  else if (reading && who && view.filtered && !view.totals.matching) section.append(noMatches(view, reading, who, label));
  const ul = testid(el('ul', 'ap-items'), `items-${plan.id}`);
  ul.setAttribute('aria-label', `Tasks in ${plan.title}`);
  for (const node of view.tree) ul.append(itemRow(node, plan, detail, env, view, who));
  section.append(ul);
  return section;
}

const JUMP_COPY: Record<JumpKind, { active: [string, string, string]; closed: [string, string, string] }> = {
  // [button with targets, button without, notice prefix]
  working: { active: ['Jump to in progress', 'No tasks in progress', 'In progress'], closed: ['Jump to reported in progress', 'No tasks reported in progress', 'Reported in progress'] },
  blocked: { active: ['Jump to blocked', 'No blocked tasks', 'Blocked'], closed: ['Jump to reported blocked', 'No tasks reported blocked', 'Reported blocked'] },
};

/**
 * Session names from the current host only for a plan of the verified bound source; a foreign or
 * unverified same-ID session keeps a plain recorded-session label.
 */
export function recordedLabel(plan: PlanView, env: Env) {
  const live = trustedSource(plan, env) ? env.live : EMPTY_LIVE;
  return (id: string) => sessionLabel(id, live);
}

const participantKey = (f: ParticipantFilter) => (f.kind === 'session' ? `s:${f.sessionId}` : f.kind);
/** The filter as words, for the summary and the empty state. */
const participantText = (f: ParticipantFilter, label: (id: string) => string) => (f.kind === 'session' ? label(f.sessionId) : f.kind === 'none' ? 'no participant recorded' : '');

/**
 * Participant choice: All participants, every session this plan records (owner, assignees,
 * links, reporters and attributed sessions, including report-only ones) and No participant
 * recorded. A chosen session the plan no longer records stays chosen, marked unavailable.
 */
function participantSelect(plan: PlanView, reading: ReadingView, who: Attribution, label: (id: string) => string) {
  const { index, filter } = who;
  const tasks = (n: number) => plural(n, 'task', 'tasks');
  const options: SelectOption[] = [{ id: 'all', label: 'All participants' }];
  for (const id of index.sessions) options.push({ id: `s:${id}`, label: label(id), hint: `${id === plan.ownerSessionId ? 'main session · ' : ''}${tasks(index.taskCount.get(id) ?? 0)}` });
  const missing = filter.kind === 'session' && !index.sessions.includes(filter.sessionId);
  if (missing) options.push({ id: `s:${filter.sessionId}`, label: label(filter.sessionId), hint: 'no longer recorded' });
  options.push({ id: 'none', label: 'No participant recorded', hint: tasks(index.unknownCount) });
  const holder = testid(el('div', 'ap-focus-participant'), 'focus-participant');
  holder.dataset.participant = participantKey(filter);
  holder.dataset.available = String(!missing);
  mountSelect(holder, {
    label: 'Participant', value: participantKey(filter), options,
    onChange: (id) => reading.set({ participant: id === 'all' || id === 'none' ? { kind: id } : { kind: 'session', sessionId: id.slice(2) } }),
  });
  return holder;
}

/**
 * Task view: Show all / Unfinished, a participant choice, bulk disclosure and whole-plan jumps.
 * Reading-only: nothing here sends a request, stores a preference or changes reported work.
 */
function taskControls(plan: PlanView, view: TaskProjection, reading: ReadingView, who: Attribution, label: (id: string) => string) {
  const box = testid(el('div', 'ap-focus'), 'focus-controls');
  box.setAttribute('role', 'group');
  box.setAttribute('aria-label', 'Task view');
  const bar = el('div', 'ap-focus-bar');
  const modes = testid(el('div', 'ap-focus-set'), 'focus-mode');
  modes.setAttribute('role', 'group');
  modes.setAttribute('aria-label', 'Show tasks');
  modes.dataset.mode = reading.status;
  for (const [status, label] of [['all', 'Show all'], ['unfinished', 'Unfinished']] as const) {
    const holder = button(modes, `focus-mode-${status}`, label, () => reading.set({ status }), reading.status === status ? 'outline' : 'ghost');
    holder.querySelector('button')?.setAttribute('aria-pressed', String(reading.status === status));
  }
  const bulk = el('div', 'ap-focus-set');
  for (const [id, label, open] of [['focus-expand-all', 'Expand all', true], ['focus-collapse-all', 'Collapse all', false]] as const) {
    const holder: HTMLElement = button(bulk, id, label, () => setDisclosures(holder, plan, open), 'ghost');
  }
  const jumps = el('div', 'ap-focus-set');
  for (const kind of ['working', 'blocked'] as const) {
    const targets = jumpTargets(view, kind);
    const copy = JUMP_COPY[kind][plan.lifecycle === 'active' ? 'active' : 'closed'];
    const holder: HTMLElement = button(jumps, `focus-jump-${kind}`, targets.length ? `${copy[0]} (${targets.length})` : copy[1], () => jump(holder, plan, kind, targets, reading, copy[2]), 'ghost', !targets.length);
    holder.dataset.count = String(targets.length);
  }
  bar.append(modes, participantSelect(plan, reading, who, label), bulk, jumps);
  const t = view.totals;
  const summary = testid(el('p', 'ap-note ap-focus-summary'), 'focus-summary');
  Object.assign(summary.dataset, { rows: String(t.rows), matching: String(t.matching), context: String(t.context), hidden: String(t.hidden), hiddenWorking: String(t.hiddenWorking), hiddenBlocked: String(t.hiddenBlocked) });
  if (!view.filtered) summary.textContent = t.rows ? `Showing all ${plural(t.rows, 'task', 'tasks')}.` : '';
  else {
    const hiddenWork = [t.hiddenWorking ? `${t.hiddenWorking} in progress` : '', t.hiddenBlocked ? `${t.hiddenBlocked} blocked` : ''].filter(Boolean).join(', ');
    const whom = who.filter.kind === 'session' ? ` for ${participantText(who.filter, label)}` : who.filter.kind === 'none' ? ' with no participant recorded' : '';
    summary.textContent = `${plural(t.matching, 'matching task', 'matching tasks')}${whom}${t.context ? ` · ${t.context} shown for context` : ''} · ${t.hidden} hidden by filter${hiddenWork ? ` (${hiddenWork})` : ''}. Totals, Now, Readiness and Sessions cover the whole plan.`;
  }
  const notice = testid(el('p', 'ap-note ap-focus-notice'), 'focus-notice');
  notice.setAttribute('role', 'status');
  box.append(bar, summary, notice);
  return box;
}

/** No task matches: header, full totals and controls stay; one action shows every task again. */
function noMatches(view: TaskProjection, reading: ReadingView, who: Attribution, label: (id: string) => string) {
  const box = testid(el('div', 'ap-focus-empty'), 'focus-empty');
  box.append(el('p', '', 'No tasks match the task filter.'));
  if (who.filter.kind === 'session' && !who.index.sessions.includes(who.filter.sessionId)) {
    box.append(el('p', 'ap-note', `This plan no longer records ${participantText(who.filter, label)} on any task.`));
  }
  box.append(el('p', 'ap-note', `${plural(view.totals.hidden, 'task row is', 'task rows are')} hidden by it. They are still in the plan, and the totals above count every task.`));
  button(box, 'focus-clear', 'Clear task filters', () => reading.set(CLEARED), 'outline');
  return box;
}

/** Both task filters back to their defaults. */
const CLEARED = { status: 'all', participant: ALL_PARTICIPANTS } as const;

/** Plan article of the current paint that holds `control`, for this exact plan, source and revision. */
function articleOf(control: HTMLElement, plan: PlanView) {
  const article = control.closest<HTMLElement>('article.ap-plan');
  return article?.isConnected && article.dataset.testid === `plan-${plan.id}` && article.dataset.source === plan.sourceId && article.dataset.revision === String(plan.revision) ? article : null;
}

/** Expand all / Collapse all: every task disclosure of this plan (filtered branches too), nothing else. */
function setDisclosures(control: HTMLElement, plan: PlanView, open: boolean) {
  const article = articleOf(control, plan);
  if (!article) return;
  for (const d of article.querySelectorAll<HTMLDetailsElement>('ul.ap-items details.ap-group')) if (d.open !== open) d.open = open;
}

/** Next reported working/blocked task of the whole plan, in hierarchy order, wrapping. */
function jump(control: HTMLElement, plan: PlanView, kind: JumpKind, targets: ItemView[], reading: ReadingView, label: string) {
  const article = articleOf(control, plan);
  const state = reading.current();
  const next = article && state ? nextJump(targets, state.cursor[kind]) : null;
  if (!article || !state || !next) return;
  reading.remember({ cursor: { ...state.cursor, [kind]: next.item.id } });
  revealTask(article, plan, next.item.id, 'focus-notice', `${label}${targets.length > 1 ? ` ${next.index + 1} of ${targets.length}` : ''}: ${next.item.title}`);
}

/** Who is involved: the main session and its children, live state kept apart from task status. */
export function peopleBlock(plan: PlanView, detail: PlanDetail | null, env: Env) {
  const list = participants(plan, detail);
  const section = testid(el('section', 'ap-section'), 'contributors');
  section.append(el('h3', 'ap-h', list.length > 1 ? 'Sessions' : 'Session'));
  const wrap = el('div', 'ap-people');
  for (const p of list) {
    const { cov, node } = sessionChip(plan, p.sessionId, env);
    const row = testid(el('div', 'ap-person'), `contributor-${p.sessionId}`);
    row.dataset.role = p.role;
    row.append(node, navButton(plan, p.sessionId, cov, env) ?? el('span'));
    const facts = [p.role === 'main' ? 'Main session' : 'Child session'];
    if (p.assigned) facts.push(`${p.assigned} assigned`);
    if (p.relayed) facts.push('reports relayed by the main session');
    row.append(el('span', 'ap-small ap-muted', facts.join(' · ')));
    wrap.append(row);
  }
  section.append(wrap);
  return section;
}

/** Plain loading/error line for an on-demand part of a view. */
export function partState(id: string, what: string, value: Loadable<unknown> | null, retry?: () => void) {
  const slot = testid(el('div', 'ap-row ap-note'), id);
  slot.setAttribute('role', 'status');
  if (!value || value.state === 'loading') {
    mountSpinner(slot, { size: 'sm', label: `Loading ${what}` });
  } else if (value.state === 'error') {
    slot.append(el('span', '', `${what[0].toUpperCase()}${what.slice(1)} could not be loaded. ${FAILURE_COPY[value.failure.kind].title}.`));
    if (retry) {
      const b = el('button', 'ap-link', 'Try again');
      b.type = 'button';
      b.addEventListener('click', retry);
      slot.append(b);
    }
  }
  return slot;
}

/**
 * Read-only captured document, fetched on demand. Text only: never parsed as Markdown/HTML,
 * never fetches assets. A retained earlier capture stays readable when the latest read failed.
 */
export function documentBlock(plan: PlanView, env: Env, mode: 'disclosure' | 'inline', doc: { get: () => Loadable<DocumentBody> | null; request: () => void }) {
  const ref = plan.document;
  const wrap = testid(el(mode === 'disclosure' ? 'details' : 'section', 'ap-doc'), `document-${plan.id}`);
  wrap.dataset.state = ref.state;
  const label = ref.path ? `Plan document · ${baseName(ref.path)}` : 'Plan document';
  if (mode === 'disclosure') wrap.append(el('summary', '', label));
  else wrap.append(el('h3', 'ap-doc-title', label));
  if (ref.state === 'unbound') { wrap.append(el('p', 'ap-note', DOCUMENT_STATE_TEXT.unbound)); return wrap; }
  if (ref.state !== 'captured') wrap.append(testid(el('p', 'ap-doc-warn', DOCUMENT_STATE_TEXT[ref.state]), 'document-state'));
  if (ref.captureId === undefined) {
    if (ref.state !== 'captured') wrap.append(el('p', 'ap-note', 'No earlier capture is available.'));
    return wrap;
  }
  const body = el('div', 'ap-doc-body');
  const fill = () => {
    body.replaceChildren();
    const value = doc.get();
    if (!value || value.state !== 'ready') { body.append(partState('document-loading', 'the document', value, doc.request)); return; }
    const d = value.value;
    if (d.text === null) { body.append(el('p', 'ap-note', 'The captured text is not available.')); return; }
    const pre = testid(el('pre'), 'document-text');
    pre.tabIndex = 0;
    pre.dataset.scrollKey = `doc-${plan.key}`;
    pre.textContent = d.text;
    if (d.historical) body.append(testid(el('p', 'ap-doc-warn', 'A newer capture was recorded while this loaded. This is the earlier capture.'), 'document-historical'));
    body.append(pre);
    const note = el('p', 'ap-note');
    if (d.ref.capturedAt) note.append(age(d.ref.capturedAt, env, ref.state === 'captured' ? 'Captured ' : 'Last good capture '), document.createTextNode('. '));
    note.append(document.createTextNode(ref.state !== 'captured'
      ? 'This is the last successful capture, not the current file.'
      : d.ref.checklistSynchronized ? 'The task list was confirmed against this capture. The current file has not been rechecked since.' : 'The current file has not been rechecked since this capture.'));
    body.append(note);
  };
  if (mode === 'disclosure') {
    wrap.addEventListener('toggle', () => { if ((wrap as HTMLDetailsElement).open) { doc.request(); fill(); } });
    if (doc.get()) fill();
  } else { doc.request(); fill(); }
  wrap.append(body);
  return wrap;
}

/** Task-reading state of each painted plan article (planDetail), for in-detail navigation. */
const READINGS = new WeakMap<Element, ReadingView>();

/**
 * Local in-detail navigation: reveal and focus the canonical task row of the plan article that
 * holds the control. A control from a replaced paint (detached) or another plan, source or
 * revision does nothing. No route, request or session action.
 */
function showTask(control: HTMLElement, plan: PlanView, itemId: string) {
  const article = articleOf(control, plan);
  if (article) revealTask(article, plan, itemId, 'readiness-notice', '');
}

/**
 * The one navigation path (readiness links and jumps). It searches the whole plan: a target a task
 * filter hides clears the filters once and is revealed after that repaint, announced as such.
 * Opens ancestors, focuses the row and scrolls it into view once, instantly.
 */
function revealTask(article: HTMLElement, plan: PlanView, itemId: string, noticeId: 'readiness-notice' | 'focus-notice', message: string) {
  const target = [...article.querySelectorAll<HTMLElement>('[data-testid^="item-"]')].find((n) => n.tagName === 'LI' && n.dataset.testid === `item-${itemId}`);
  const own = article.querySelector<HTMLElement>(`[data-testid="${noticeId}"]`);
  const notice = article.querySelector<HTMLElement>('[data-testid="focus-notice"]');
  if (!target) { if (own) own.textContent = 'That task is no longer shown in this plan.'; return; }
  const reading = READINGS.get(article);
  // A row kept only as context does not match either, so it also shows the whole plan again.
  if (target.closest('[hidden]') || target.dataset.focus === 'context') {
    if (!reading) return;
    reading.set(CLEARED, (root) => {
      const next = [...root.querySelectorAll<HTMLElement>('article.ap-plan')].find((a) => a.dataset.testid === article.dataset.testid && a.dataset.source === article.dataset.source && a.dataset.revision === article.dataset.revision);
      if (next) revealTask(next, plan, itemId, 'focus-notice', `Showing all tasks so this task is visible.${message ? ` ${message}` : ''}`);
    });
    return;
  }
  for (const n of article.querySelectorAll<HTMLElement>('[data-testid="readiness-notice"],[data-testid="focus-notice"]')) n.textContent = '';
  for (let d = target.parentElement?.closest('details'); d && article.contains(d); d = d.parentElement?.closest('details')) if (!d.open) d.open = true;
  target.dataset.navTarget = '';
  target.addEventListener('blur', () => { delete target.dataset.navTarget; }, { once: true });
  target.focus({ preventScroll: true });
  target.scrollIntoView({ block: 'center', behavior: 'instant' });
  if (notice && message) notice.textContent = message;
}

/**
 * History's "View current task": the same canonical reveal path, inside this plan's painted reading
 * article (same plan ID, source and revision), never a same-ID task elsewhere.
 */
export function revealCurrentTask(article: HTMLElement, plan: PlanView, itemId: string, message: string) {
  if (articleOf(article, plan)) revealTask(article, plan, itemId, 'focus-notice', message);
}

function navLink(plan: PlanView, itemId: string, text: string, name: string) {
  const b = el('button', 'ap-link ap-ready-link', text);
  b.type = 'button';
  b.setAttribute('aria-label', name);
  b.dataset.target = itemId;
  b.addEventListener('click', () => showTask(b, plan, itemId));
  return b;
}

/** Status glyph whose meaning is spoken by the adjacent status text instead. */
const quietGlyph = (status: ItemView['status']) => { const g = glyph(status); g.removeAttribute('role'); g.removeAttribute('aria-label'); g.setAttribute('aria-hidden', 'true'); return g; };

function prerequisiteRow(plan: PlanView, p: Prerequisite) {
  const li = el('li', 'ap-ready-dep');
  li.dataset.dep = p.id;
  li.dataset.depState = p.kind === 'task' ? p.status : p.kind;
  if (p.kind === 'task') li.append(quietGlyph(p.status), navLink(plan, p.id, p.title, `Show prerequisite: ${p.title}`), el('span', 'ap-muted', STATUS_LABEL[p.status]));
  else if (p.kind === 'not-task') li.append(el('span', 'ap-ready-ref', p.title), el('span', 'ap-doc-warn', 'A group, not a task: it can’t count as done'));
  else li.append(el('code', 'ap-ready-ref', p.id), el('span', 'ap-doc-warn', 'Prerequisite task unavailable'));
  return li;
}

const CATEGORY_LABEL: Record<BlockerCategory, string> = { decision: 'Decision', dependency: 'Dependency', review: 'Review', external: 'External', other: 'Other' };

/** The reported wait category as a label, never a filter; an unrecognized one stays unknown. */
function categoryTag(item: ItemView) {
  const category = item.reportedBlocker?.state === 'reported' ? item.reportedBlocker.category : null;
  const known = category && category !== 'unclassified' ? category : null;
  const tag = testid(el('span', 'ap-ny-cat'), `needs-you-category-${item.id}`);
  tag.dataset.category = known ?? (category === 'unclassified' ? 'unclassified' : 'unknown');
  tag.append(el('span', 'ap-sr', 'Wait category: '), known ? CATEGORY_LABEL[known] : 'Category unknown');
  if (category === 'unclassified') tag.title = 'The report used a category this version doesn’t recognize.';
  return tag;
}

/**
 * How long the task has been reported blocked, from the reply's blocked timing anchored to the
 * service clock and advanced by the frame's label ticker (refreshLabels). Unknown and unavailable
 * never read as zero; this is reported status, not real-world waiting or activity.
 */
function blockedWaitLabel(item: ItemView, detail: PlanDetail, env: Env) {
  const w = blockedWait(detail, item);
  if (w.kind === 'unknown' || w.kind === 'unavailable') {
    const s = testid(el('span', 'ap-elapsed', w.kind === 'unknown' ? 'Unknown' : 'Unavailable'), `blocked-elapsed-${item.id}`);
    s.dataset.kind = 'unknown';
    s.dataset.timing = w.kind;
    s.title = w.kind === 'unknown' ? 'The progress service couldn’t tell when this task was reported blocked.' : 'This progress service doesn’t report waiting times.';
    return s;
  }
  const a = w.anchor;
  const t = testid(el('time', 'ap-elapsed'), `blocked-elapsed-${item.id}`);
  t.dateTime = a.since;
  Object.assign(t.dataset, { kind: a.kind, timing: a.kind, elapsed: String(a.elapsedAtRead), received: String(a.receivedAt) });
  const at = absoluteTime(a.since, env.locale);
  t.title = a.kind === 'exact' ? `Reported blocked at ${at}. Counts reported status, not activity.` : `Already reported blocked at ${at}; the start is earlier and unknown.`;
  t.textContent = elapsedLabelText(a.kind, elapsedAt(a, env.mono));
  return t;
}

/** Category-independent facts of a Needs you row: reason, next action and reported wait, each explicit when unknown. */
function needsYouFacts(item: ItemView, detail: PlanDetail, env: Env) {
  const b = item.reportedBlocker;
  const reported = b?.state === 'reported' ? b : null;
  const dl = testid(el('dl', 'ap-ny-facts'), `needs-you-facts-${item.id}`);
  dl.dataset.details = b ? b.state : 'unknown';
  const row = (id: string, term: string, value: string | Node, unknown: boolean) => {
    const dd = testid(el('dd', unknown ? 'ap-ny-unknown' : ''), id);
    if (unknown) dd.dataset.unknown = '';
    dd.append(value);
    const pair = el('div');
    pair.append(el('dt', '', term), dd);
    dl.append(pair);
  };
  if (b?.state === 'invalid') row(`needs-you-details-${item.id}`, 'Details', 'Reported details couldn’t be read', true);
  else {
    row(`needs-you-reason-${item.id}`, 'Reason', reported?.reason ?? 'Unknown', !reported?.reason);
    row(`needs-you-next-${item.id}`, 'Next action', reported?.nextAction ?? 'Unknown', !reported?.nextAction);
  }
  row(`needs-you-wait-${item.id}`, 'Reported wait', blockedWaitLabel(item, detail, env), false);
  return dl;
}

function readinessEntry(plan: PlanView, entry: ReadinessEntry, env: Env, compareSession: string | null, detail: PlanDetail) {
  const { item } = entry;
  const needsYou = entry.group === 'blocked';
  const li = testid(el('li', needsYou ? 'ap-ready-entry ap-ny-entry' : 'ap-ready-entry'), `readiness-entry-${item.id}`);
  Object.assign(li.dataset, { source: plan.sourceId, plan: plan.id, item: item.id, group: entry.group });
  const head = el('div', 'ap-ready-head');
  head.append(glyph(item.status), navLink(plan, item.id, item.title, `Show task: ${item.title}`));
  if (needsYou) head.append(categoryTag(item));
  li.append(head);
  if (needsYou) li.append(needsYouFacts(item, detail, env));
  // Labels from the current host only for the verified bound source; a foreign same-ID session
  // must not borrow this host's titles.
  const trusted = trustedSource(plan, env);
  const label = recordedLabel(plan, env);
  const meta = el('div', 'ap-ready-meta');
  if (entry.parent.kind === 'known') meta.append(el('span', '', `In ${entry.parent.title}`));
  else if (entry.parent.kind === 'unknown') meta.append(el('span', '', 'Parent group unavailable'));
  const state = (id: string) => (trusted ? liveLabel(coverageFor(id, plan.directory, env.live)).label : 'from another OpenCode setup');
  const who = assignment(entry, compareSession, plan.sourceId, env.boundSource);
  li.dataset.assignment = who.kind;
  if (who.kind === 'none' && entry.linkedSessionIds.length) {
    // A session link is context only: it is never shown as, or compared like, an assignment.
    li.dataset.linked = entry.linkedSessionIds.join(' ');
    const holder = testid(el('span', 'ap-ready-links'), `readiness-link-${item.id}`);
    for (const id of entry.linkedSessionIds) {
      const line = el('span', 'ap-ready-who');
      line.dataset.session = id;
      line.append('Linked to ', el('b', '', label(id)), ` · ${state(id)} (no recorded assignment)`);
      holder.append(line);
    }
    meta.append(holder);
  } else if (who.kind === 'none') meta.append(el('span', '', 'No assignee recorded'));
  else if (who.kind === 'selected') meta.append(testid(el('span', '', 'Assigned to the selected session'), `readiness-assignee-${item.id}`));
  else {
    // Plain wrapping text (no truncating chip): the name must stay readable at narrow widths.
    const holder = testid(el('span', 'ap-ready-who'), `readiness-assignee-${item.id}`);
    holder.append('Assigned to ', el('b', '', label(who.sessionId)), ` · ${state(who.sessionId)}`);
    meta.append(holder);
  }
  // Who supplied the current details: their own server-recorded provenance, never inferred from
  // the task's report history below (those reporters did not necessarily write this text).
  const b = needsYou && item.reportedBlocker?.state === 'reported' ? item.reportedBlocker : null;
  if (b) {
    const by = testid(el('span', 'ap-ready-who'), `needs-you-source-${item.id}`);
    by.dataset.blockerReport = b.mode;
    if (b.mode === 'parent-relay') by.append('Details reported by ', el('b', '', label(b.reporterSessionId)), ' for ', el('b', '', label(b.attributedSessionId)));
    else by.append('Details reported directly by ', el('b', '', label(b.reporterSessionId)));
    meta.append(by);
  }
  for (const r of entry.reports) {
    const text = r.mode === 'parent-relay' ? `Reported by ${label(r.reporterSessionId)} for ${label(r.attributedSessionId)}` : `Reported directly by ${label(r.reporterSessionId)}`;
    const span = el('span', '', text);
    span.dataset.report = r.mode;
    meta.append(span);
  }
  if (needsYou && entry.reporterFallback) {
    const span = el('span', '', `Last reported by ${label(entry.reporterFallback)} · report mode unavailable`);
    span.dataset.report = 'reporter';
    meta.append(span);
  }
  if (meta.childNodes.length) li.append(meta);
  if (entry.recorded !== 'listed') li.append(el('p', 'ap-ready-none', 'No prerequisites recorded'));
  else {
    const deps = el('ul', 'ap-ready-deps');
    deps.setAttribute('aria-label', `Prerequisites of ${item.title}`);
    for (const p of entry.prerequisites) deps.append(prerequisiteRow(plan, p));
    li.append(deps);
  }
  if (entry.incomplete) li.append(el('p', 'ap-doc-warn', 'A recorded prerequisite is unavailable, so this task can’t be shown as ready.'));
  return li;
}

const READINESS_GROUPS: Record<ReadinessGroup, { title: string; note?: string }> = {
  ready: { title: 'Ready to start' },
  waiting: { title: 'Waiting on prerequisites' },
  skipped: { title: 'Waiting — skipped prerequisite', note: 'A skipped prerequisite doesn’t count as done.' },
  blocked: { title: 'Needs you', note: 'Reported as blocked. Each stays here until an agent reports otherwise. A wait can be for another session or person.' },
};
/** What an empty Needs you may claim: only a current read with capture on is "no reported blockers". */
const NEEDS_YOU_EMPTY: Record<Extract<Attention, { state: 'ready' }>['qualifier'], string> = {
  current: 'No reported blockers.',
  stale: 'No reported blockers in the last successful read. This may be out of date.',
  'capture-off': 'No reported blockers were recorded. Capture is off, so newer reports aren’t recorded.',
};
const INVALID_COPY: Record<InvalidReason, string> = {
  'duplicate-id': 'two tasks share an ID',
  'self-dependency': 'a task lists itself as a prerequisite',
  cycle: 'some tasks list each other as prerequisites',
};

function readinessGroup(plan: PlanView, group: ReadinessGroup, entries: ReadinessEntry[], env: Env, compareSession: string | null, detail: PlanDetail, heading: 'h4' | 'h5' = 'h4') {
  const box = testid(el('div', `ap-ready-group${heading === 'h5' ? ' ap-ready-sub' : ''}`), `readiness-${group}`);
  box.dataset.count = String(entries.length);
  const copy = READINESS_GROUPS[group];
  box.append(el(heading, 'ap-ready-title', `${copy.title} · ${entries.length}`));
  if (copy.note && entries.length) box.append(el('p', 'ap-note', copy.note));
  if (!entries.length) { if (group === 'ready') box.append(el('p', 'ap-note', 'No tasks are ready from the recorded information.')); return box; }
  const ul = el('ul', 'ap-ready-list');
  if (group === 'blocked') ul.setAttribute('aria-label', `Reported blockers in ${plan.title}`);
  for (const e of entries) ul.append(readinessEntry(plan, e, env, compareSession, detail));
  box.append(ul);
  return box;
}

/**
 * Needs you: the readiness Blocked group, renamed and always present for a ready readiness, so an
 * active plan's blocker summary is never hidden by task filters or by an empty list. One row per
 * reported blocked task in stored order; no new action, request or timer.
 */
function needsYouGroup(plan: PlanView, a: Extract<Attention, { state: 'ready' }>, env: Env, compareSession: string | null, detail: PlanDetail) {
  const box = readinessGroup(plan, 'blocked', a.rows, env, compareSession, detail);
  box.classList.add('ap-ny');
  box.dataset.testid = 'needs-you';
  box.dataset.qualifier = a.qualifier;
  if (!a.rows.length) box.append(testid(el('p', a.qualifier === 'current' ? 'ap-note' : 'ap-doc-warn', NEEDS_YOU_EMPTY[a.qualifier]), 'needs-you-empty'));
  else if (a.qualifier === 'capture-off') box.querySelector('.ap-ready-title')!.after(testid(el('p', 'ap-doc-warn', 'Capture is off: these are the last reported blockers, not current guidance.'), 'needs-you-qualifier'));
  return box;
}

/**
 * Read-only readiness of an active plan's tasks, from recorded prerequisites only. Closed plans
 * get nothing; pending, failed or inconsistent detail never shows an empty or ready list.
 */
export function readinessBlock(plan: PlanView, detail: Loadable<PlanDetail> | null, env: Env, compareSession: string | null) {
  const r = readiness(plan, detail);
  if (r.state === 'closed') return null;
  const section = testid(el('section', 'ap-section ap-readiness'), 'readiness');
  section.dataset.state = r.state;
  section.setAttribute('aria-label', 'Task readiness');
  section.append(el('h3', 'ap-h', 'Readiness'));
  // No partial list and no "no reported blockers" claim until every task has loaded.
  if (r.state === 'loading') { section.append(el('p', 'ap-note', 'Readiness and reported blockers appear once every task has loaded.')); return section; }
  if (r.state === 'unavailable') { section.append(el('p', 'ap-note', 'Readiness and reported blockers are unavailable because the tasks could not be loaded.')); return section; }
  if (r.state === 'invalid') {
    section.dataset.reason = r.reason;
    section.append(el('p', 'ap-doc-warn', `Readiness is unavailable for this report: ${INVALID_COPY[r.reason]}. The tasks are shown below as reported.`));
    return section;
  }
  const value = (detail as Extract<Loadable<PlanDetail>, { state: 'ready' }>).value;
  if (!env.view.fresh) { section.dataset.stale = 'true'; section.append(el('p', 'ap-doc-warn', 'Last reported readiness. It may be out of date and isn’t a current recommendation.')); }
  const notice = testid(el('p', 'ap-note'), 'readiness-notice');
  notice.setAttribute('role', 'status');
  // Needs you leads: reported blockers stay in view however long the ready list grows.
  section.append(notice, needsYouGroup(plan, attention(r, env.view) as Extract<Attention, { state: 'ready' }>, env, compareSession, value));
  section.append(el('p', 'ap-note', 'Based on recorded prerequisites only. Other prerequisites may not be recorded.'));
  if (r.incomplete) section.append(el('p', 'ap-doc-warn', 'Some recorded prerequisites aren’t in this plan, so the tasks that need them can’t be shown as ready.'));
  section.append(readinessGroup(plan, 'ready', r.groups.ready, env, compareSession, value));
  if (r.groups.waiting.length || r.groups.skipped.length) {
    const waiting = readinessGroup(plan, 'waiting', r.groups.waiting, env, compareSession, value);
    waiting.querySelector('.ap-ready-title')!.textContent = `${READINESS_GROUPS.waiting.title} · ${r.groups.waiting.length + r.groups.skipped.length}`;
    waiting.dataset.count = String(r.groups.waiting.length + r.groups.skipped.length);
    if (r.groups.skipped.length) waiting.append(readinessGroup(plan, 'skipped', r.groups.skipped, env, compareSession, value, 'h5'));
    section.append(waiting);
  }
  return section;
}

export interface DetailHooks {
  detail: Loadable<PlanDetail> | null;
  summary?: SummaryView | null;
  retryDetail?: () => void;
  document: { get: () => Loadable<DocumentBody> | null; request: () => void };
}

/**
 * `compareSession`: the session readiness compares recorded assignees with (rail: the selected
 * host session; board: an explicit session filter). Null keeps neutral assignee labels.
 */
export function planDetail(plan: PlanView, env: Env, hooks: DetailHooks, options: { document: 'disclosure' | 'inline' | 'omit'; heading?: 'h2' | 'h3'; compareSession?: string | null; reading?: ReadingView | null }) {
  const root = testid(el('article', 'ap-plan'), `plan-${plan.id}`);
  root.dataset.lifecycle = plan.lifecycle;
  root.dataset.source = plan.sourceId;
  root.dataset.revision = String(plan.revision);
  const reading = options.reading ?? null;
  // Its task disclosures, logical focus and anchor follow this reading identity (app.ts).
  if (reading) { root.dataset.reading = ''; READINGS.set(root, reading); }
  const ready = hooks.detail?.state === 'ready' && hooks.detail.value.revision === plan.revision ? hooks.detail.value : null;
  const summary = summarize(plan, ready);
  if (showsLiveness(plan.lifecycle, summary, env.view)) root.dataset.motion = 'on';
  root.append(planHeader(plan, env, options.heading), progressBlock(summary));
  if (hooks.summary) root.append(summaryBlock(hooks.summary));
  if (ready) {
    const now = currentWorkBlock(plan, ready, env);
    if (now) root.append(now);
  }
  const readinessSection = readinessBlock(plan, hooks.detail, env, options.compareSession ?? null);
  if (readinessSection) root.append(readinessSection);
  if (ready) root.append(itemList(plan, ready, env, reading));
  else {
    // No task controls until complete matching detail exists: loading or failed is never "no matches".
    const tasks = el('section', 'ap-section ap-tasks');
    tasks.append(tasksHeading(), partState('detail-loading', 'tasks', hooks.detail?.state === 'error' ? hooks.detail : null, hooks.retryDetail));
    root.append(tasks);
  }
  root.append(peopleBlock(plan, ready, env));
  if (options.document !== 'omit') root.append(documentBlock(plan, env, options.document, hooks.document));
  return root;
}

/** Plain selectable Markdown. Async state and all action authority stay in the controller. */
function summaryBlock(view: SummaryView) {
  const section = el('section', 'ap-summary');
  section.setAttribute('aria-label', 'Plan summaries');
  const actions = el('div', 'ap-row');
  const action = (parent: HTMLElement, id: string, label: string, run: () => void, disabled = false) => {
    const holder = button(parent, id, label, run, 'outline', disabled);
    // Hooks and focus belong to the native control, not the kit's wrapper.
    delete holder.dataset.testid;
    const control = holder.querySelector('button');
    if (control) control.dataset.testid = id;
    return control;
  };
  action(actions, 'summary-progress', 'Copy progress update', () => view.open('progress'));
  action(actions, 'summary-handoff', 'Copy handoff', () => view.open('handoff'));
  section.append(actions);
  const state = view.preview;
  if (!state) return section;
  const box = testid(el('div', 'ap-summary-preview'), 'summary-preview');
  box.append(el('h3', 'ap-h', state.mode === 'progress' ? 'Progress update preview' : 'Handoff preview'));
  const status = testid(el('p', 'ap-note', state.status || state.message || 'Review the Markdown, then copy it.'), 'summary-status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.setAttribute('aria-atomic', 'true');
  box.append(status);
  if (state.status && state.message) box.append(el('p', 'ap-note', state.message));
  if (state.text !== null) {
    const label = el('label', 'ap-summary-label', 'Markdown preview (read-only)');
    const text = testid(el('textarea', 'ap-summary-text'), 'summary-text');
    text.readOnly = true; text.value = state.text; text.rows = 12; text.spellcheck = false;
    text.dataset.generation = String(state.generation);
    label.append(text); box.append(label);
  }
  const controls = el('div', 'ap-row');
  action(controls, 'summary-copy', 'Copy Markdown', view.copy, state.text === null || state.copying);
  if (state.canRetry) action(controls, 'summary-retry', 'Retry', view.retry);
  if (state.canSummaryOnly) action(controls, 'summary-only', 'Preview summary only', view.summaryOnly);
  action(controls, 'summary-close', 'Close', view.close);
  box.append(controls); section.append(box);
  return section;
}

export function historyBlock(plan: PlanView, value: Loadable<{ entries: HistoryEntry[]; truncated: boolean }> | null, env: Env) {
  const section = testid(el('section', 'ap-section'), `history-${plan.id}`);
  section.append(el('h3', 'ap-h', 'Revisions'));
  if (!value || value.state !== 'ready') { section.append(partState('history-loading', 'history', value)); return section; }
  const ul = el('ul', 'ap-history');
  const entries = value.value.entries;
  const kind = (i: number) => (i === 0 ? 'plan reported' : entries[i].structuralRevision !== entries[i - 1].structuralRevision ? 'tasks revised' : entries[i].lifecycle !== entries[i - 1].lifecycle ? 'outcome reported' : 'progress update');
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    const li = testid(el('li', 'ap-history-row'), `revision-${e.revision}`);
    li.append(el('span', 'ap-history-rev', `Revision ${e.revision}`), el('span', 'ap-muted', kind(i)));
    if (e.lifecycle !== 'active') li.append(el('span', 'ap-muted', LIFECYCLE_LABEL[e.lifecycle]));
    li.append(age(e.reportedAt, env));
    ul.append(li);
  }
  section.append(ul);
  if (value.value.truncated) section.append(el('p', 'ap-note', `Only the first ${entries.length} revisions are shown.`));
  return section;
}

const DIAGNOSTIC_TEXT: Record<string, string> = {
  'capture-disabled': 'Capture is turned off; no new reports are recorded.',
  'source-unverified': 'Some recorded sources are not verified.',
  'host-source-binding-unverified': 'This service is not bound to a verified OpenCode setup.',
  'historical-capture': 'Showing an earlier document capture.',
};

/** Diagnostics live here, collapsed, after the progress story. */
export function detailsBlock(read: StoreRead | null, plan: PlanView | null, extra: [string, string][], env: Env) {
  const d = testid(el('details', 'ap-details'), 'details');
  d.append(el('summary', '', 'Details'));
  const facts = el('dl', 'ap-facts');
  const add = (k: string, v: string, mono = false) => facts.append(el('dt', '', k), el('dd', mono ? 'ap-mono' : '', v));
  if (plan) {
    add('Plan', plan.id, true);
    add('Revision', `${plan.revision} (structure ${plan.structuralRevision})`);
    add('Reported', absoluteTime(plan.reportedAt, env.locale));
    if (plan.directory) add('Last reported location', plan.directory, true);
    add('Main session', plan.ownerSessionId, true);
    add('Plan source', plan.sourceId, true);
    if (plan.document.path) add('Document source', plan.document.path, true);
    add('Document state', `${plan.document.state}${plan.document.checklistSynchronized ? ', task list confirmed' : ''}`);
    if (plan.document.captureId !== undefined) add('Document capture', `#${plan.document.captureId}${plan.document.hash ? ` · ${plan.document.hash}` : ''}`, true);
    if (plan.document.checkedAt) add('Document checked', absoluteTime(plan.document.checkedAt, env.locale));
  }
  if (read) {
    add('Store', read.storeId, true);
    add('Bound source', read.binding.sourceId ? `${read.binding.sourceId}${read.binding.verified ? ' (verified)' : ' (not verified)'}` : 'None', true);
    for (const s of read.sources) add('Recorded source', `${s.id}${s.verified ? ' (verified)' : ' (not verified)'}`, true);
    add('Capture', read.captureEnabled ? 'On' : 'Off');
    add('Coverage', read.coverage);
  }
  for (const [k, v] of extra) add(k, v);
  d.append(facts);
  if (read?.diagnostics.length) {
    const ul = el('ul');
    for (const line of read.diagnostics) ul.append(el('li', '', DIAGNOSTIC_TEXT[line] ?? line));
    d.append(ul);
  }
  return d;
}

export const FAILURE_COPY: Record<ReadFailure['kind'], { title: string; body: string }> = {
  'not-approved': { title: 'Progress needs permission', body: 'Allow this extension in Settings → Extensions to show agent progress.' },
  paused: { title: 'Progress is paused', body: 'This extension is paused in Settings → Extensions.' },
  disconnected: { title: 'Lost connection to OpenChamber', body: 'Progress will update again when the connection returns.' },
  unavailable: { title: 'Progress service is not responding', body: 'It may still be starting. Try again in a moment.' },
  busy: { title: 'Progress store is busy', body: 'Another program is writing to it. This view retries shortly.' },
  damaged: { title: 'Progress store is damaged', body: 'It was left untouched. See the setup guide for recovery; nothing was reset.' },
  incompatible: { title: 'Progress data needs an update', body: 'The progress store uses a format this view does not support. Update the extension and its companion.' },
  invalid: { title: 'Progress could not be read', body: 'The progress service sent a reply this view could not use.' },
  'not-found': { title: 'That plan is no longer available', body: 'It may belong to a different store.' },
  'setup-lost': { title: 'Progress setup can’t be read right now', body: 'The extension can no longer open its progress store. Check Setup; nothing was changed or deleted.' },
};

export function loadingBlock() {
  const slot = testid(el('div', 'ap-row'), 'state-loading');
  slot.setAttribute('role', 'status');
  mountSpinner(slot, { label: 'Loading progress' });
  return slot;
}

export function failureBlock(failure: ReadFailure, onRetry: () => void) {
  const slot = testid(el('div'), `state-${failure.kind}`);
  slot.setAttribute('role', 'alert');
  const copy = FAILURE_COPY[failure.kind];
  mountBanner(slot, { tone: failure.kind === 'disconnected' || failure.kind === 'paused' || failure.kind === 'busy' ? 'warning' : 'error', title: copy.title, body: copy.body, action: { label: 'Try again', onClick: onRetry } });
  return slot;
}

/** Last good data stays visible, plainly marked as not current. */
export function staleBlock(failure: ReadFailure, lastGoodAt: number, locale: string, onRetry: () => void) {
  const slot = testid(el('div'), 'stale-banner');
  slot.setAttribute('role', 'status');
  mountBanner(slot, { tone: 'warning', title: `Showing progress from ${clockTime(lastGoodAt, locale)}`, body: `${FAILURE_COPY[failure.kind].title}. This may be out of date.`, action: { label: 'Try again', onClick: onRetry } });
  return slot;
}

/** Authoritative empty or unscoped state; compact for Work Status, centered kit empty elsewhere. */
export function emptyBlock(id: string, title: string, body: string, compact = false, action?: { label: string; onClick: () => void }) {
  const box = testid(el('div', compact ? 'ap-section' : 'ap-empty'), id);
  box.setAttribute('role', 'status');
  if (compact) {
    box.append(el('p', '', title), el('p', 'ap-note', body));
    if (action) button(box, `${id}-action`, action.label, action.onClick, 'ghost');
  } else mountEmpty(box, { title, body, action });
  return box;
}

export const failureFacts = (failure: ReadFailure | null): [string, string][] => (failure ? [['Last refresh error', `${failure.code}: ${failure.message}`]] : []);

export function button(parent: Element, id: string, label: string, onClick: () => void, variant: 'ghost' | 'outline' | 'secondary' | 'default' | 'destructive' = 'outline', disabled = false) {
  const holder = testid(el('span'), id);
  mountButton(holder, { label, variant, size: variant === 'default' || variant === 'destructive' ? 'sm' : 'xs', onClick, disabled });
  parent.append(holder);
  return holder;
}
