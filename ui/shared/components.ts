// DOM building blocks shared by the three surfaces. Every string lands through textContent.
import { mountBadge, mountBanner, mountButton, mountEmpty, mountSpinner, type Tone } from '@openchamber/sdk/ui';
import type { Loadable } from './app.ts';
import { absoluteTime, baseName, clockTime, elapsedText, relativeAge } from './format.ts';
import { canOpen, coverageFor, EMPTY_LIVE, liveLabel, sessionLabel, type Coverage, type LiveSnapshot } from './live.ts';
import { assignment, readiness, type InvalidReason, type Prerequisite, type ReadinessEntry, type ReadinessGroup } from './readiness.ts';
import {
  blockedWork, currentWork, DOCUMENT_STATE_TEXT, elapsedAt, itemTree, LIFECYCLE_LABEL, participants, showsLiveness, STATUS_LABEL, subtreeCounts, summarize, summaryText,
  type DocumentBody, type HistoryEntry, type ItemNode, type ItemView, type PlanDetail, type PlanSummary, type PlanView, type StoreRead,
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

export function planLocation(plan: PlanView, live: LiveSnapshot) {
  const place = placeOf(plan, live);
  return place.worktreeLabel === 'Main checkout' || place.worktreeLabel === place.projectLabel ? place.projectLabel : `${place.projectLabel} · ${place.worktreeLabel}`;
}

function sessionChip(sessionId: string, env: Env, directory: string) {
  const cov = coverageFor(sessionId, directory, env.live);
  const l = liveLabel(cov);
  return { cov, node: chip(l.label, l.tone, sessionLabel(sessionId, env.live)) };
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
  meta.append(el('span', '', planLocation(plan, env.live)), age(plan.reportedAt, env, 'Updated '));
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
    if (who && who !== plan.ownerSessionId) row.append(sessionChip(who, env, plan.directory).node);
    box.append(row);
  }
  const rest = working.length + blocked.length - 4;
  if (rest > 0) box.append(el('span', 'ap-note', `and ${rest} more`));
  return box;
}

const assigneeOf = (item: ItemView, detail: PlanDetail) => item.assigneeSessionId ?? detail.links.find((l) => l.itemIds.includes(item.id))?.sessionId;
const flatten = (nodes: ItemNode[]): ItemView[] => nodes.flatMap((n) => [n.item, ...flatten(n.children)]);

function itemRow(node: ItemNode, plan: PlanView, detail: PlanDetail, env: Env): HTMLLIElement {
  const { item } = node;
  const li = testid(el('li'), `${item.kind === 'group' ? 'group' : 'item'}-${item.id}`);
  li.dataset.status = item.status;
  // A named, programmatically focusable destination for in-detail task navigation (not a tab stop).
  if (item.kind === 'task') li.tabIndex = -1;
  if (item.kind === 'group' || node.children.length) {
    const details = el('details', 'ap-group');
    details.open = true;
    details.dataset.testid = `${item.kind === 'group' ? 'group' : 'item'}-toggle-${item.id}`;
    const summary = el('summary');
    const s = subtreeCounts(flatten(node.children));
    if (item.kind === 'task') summary.append(glyph(item.status));
    summary.append(el('span', '', item.title), el('span', 'ap-count', s.total ? `${s.done}/${s.total}` : ''));
    const ul = el('ul');
    for (const c of node.children) ul.append(itemRow(c, plan, detail, env));
    details.append(summary, ul);
    li.append(details);
    return li;
  }
  const row = el('div', 'ap-item');
  row.dataset.status = item.status;
  const body = el('div');
  body.append(el('div', 'ap-item-title', item.title));
  const sub = el('div', 'ap-item-sub');
  const who = assigneeOf(item, detail);
  if (who && who !== plan.ownerSessionId) sub.append(sessionChip(who, env, plan.directory).node);
  for (const c of detail.contributions.filter((x) => x.mode === 'parent-relay' && x.itemIds.includes(item.id))) {
    if (sub.querySelector(`[data-testid="relay-${item.id}"]`)) break;
    sub.append(testid(el('span', '', `Reported by ${sessionLabel(c.reporterSessionId, env.live)} for ${sessionLabel(c.attributedSessionId, env.live)}`), `relay-${item.id}`));
  }
  if (sub.childNodes.length) body.append(sub);
  row.append(glyph(item.status), body);
  li.append(row);
  return li;
}

export function itemList(plan: PlanView, detail: PlanDetail, env: Env) {
  const section = el('section', 'ap-section');
  section.append(el('h3', 'ap-h', 'Tasks'));
  if (!detail.items.length) { section.append(el('p', 'ap-note', 'This plan has no tasks yet.')); return section; }
  const ul = testid(el('ul', 'ap-items'), `items-${plan.id}`);
  ul.setAttribute('aria-label', `Tasks in ${plan.title}`);
  for (const node of itemTree(detail.items)) ul.append(itemRow(node, plan, detail, env));
  section.append(ul);
  return section;
}

/** Who is involved: the main session and its children, live state kept apart from task status. */
export function peopleBlock(plan: PlanView, detail: PlanDetail | null, env: Env) {
  const list = participants(plan, detail);
  const section = testid(el('section', 'ap-section'), 'contributors');
  section.append(el('h3', 'ap-h', list.length > 1 ? 'Sessions' : 'Session'));
  const wrap = el('div', 'ap-people');
  for (const p of list) {
    const { cov, node } = sessionChip(p.sessionId, env, plan.directory);
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

/**
 * Local in-detail navigation: reveal and focus the canonical task row of the plan article that
 * holds the control. A control from a replaced paint (detached) or another plan, source or
 * revision does nothing. No route, request or session action.
 */
function showTask(control: HTMLElement, plan: PlanView, itemId: string) {
  const article = control.closest<HTMLElement>('article.ap-plan');
  if (!article?.isConnected || article.dataset.testid !== `plan-${plan.id}` || article.dataset.source !== plan.sourceId || article.dataset.revision !== String(plan.revision)) return;
  const target = [...article.querySelectorAll<HTMLElement>('[data-testid^="item-"]')].find((n) => n.tagName === 'LI' && n.dataset.testid === `item-${itemId}`);
  const notice = article.querySelector<HTMLElement>('[data-testid="readiness-notice"]');
  if (!target) { if (notice) notice.textContent = 'That task is no longer shown in this plan.'; return; }
  if (notice) notice.textContent = '';
  for (let d = target.parentElement?.closest('details'); d && article.contains(d); d = d.parentElement?.closest('details')) if (!d.open) d.open = true;
  target.dataset.navTarget = '';
  target.addEventListener('blur', () => { delete target.dataset.navTarget; }, { once: true });
  target.focus({ preventScroll: true });
  target.scrollIntoView({ block: 'center', behavior: 'instant' });
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

function readinessEntry(plan: PlanView, entry: ReadinessEntry, env: Env, compareSession: string | null) {
  const { item } = entry;
  const li = testid(el('li', 'ap-ready-entry'), `readiness-entry-${item.id}`);
  Object.assign(li.dataset, { source: plan.sourceId, plan: plan.id, item: item.id, group: entry.group });
  const head = el('div', 'ap-ready-head');
  head.append(glyph(item.status), navLink(plan, item.id, item.title, `Show task: ${item.title}`));
  li.append(head);
  // Labels from the current host only for the verified bound source; a foreign same-ID session
  // must not borrow this host's titles.
  const trusted = env.boundSource !== null && plan.sourceId === env.boundSource;
  const label = (id: string) => sessionLabel(id, trusted ? env.live : EMPTY_LIVE);
  const meta = el('div', 'ap-ready-meta');
  if (entry.parent.kind === 'known') meta.append(el('span', '', `In ${entry.parent.title}`));
  else if (entry.parent.kind === 'unknown') meta.append(el('span', '', 'Parent group unavailable'));
  const who = assignment(entry, compareSession, plan.sourceId, env.boundSource);
  li.dataset.assignment = who.kind;
  if (who.kind === 'none') meta.append(el('span', '', 'No assignee recorded'));
  else if (who.kind === 'selected') meta.append(testid(el('span', '', 'Assigned to the selected session'), `readiness-assignee-${item.id}`));
  else {
    // Plain wrapping text (no truncating chip): the name must stay readable at narrow widths.
    const holder = testid(el('span', 'ap-ready-who'), `readiness-assignee-${item.id}`);
    holder.append('Assigned to ', el('b', '', label(who.sessionId)), ` · ${trusted ? liveLabel(coverageFor(who.sessionId, plan.directory, env.live)).label : 'from another OpenCode setup'}`);
    meta.append(holder);
  }
  for (const r of entry.reports) {
    const text = r.mode === 'parent-relay' ? `Reported by ${label(r.reporterSessionId)} for ${label(r.attributedSessionId)}` : `Reported directly by ${label(r.reporterSessionId)}`;
    const span = el('span', '', text);
    span.dataset.report = r.mode;
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
  blocked: { title: 'Blocked', note: 'Reported as blocked. It stays blocked until an agent reports otherwise.' },
};
const INVALID_COPY: Record<InvalidReason, string> = {
  'duplicate-id': 'two tasks share an ID',
  'self-dependency': 'a task lists itself as a prerequisite',
  cycle: 'some tasks list each other as prerequisites',
};

function readinessGroup(plan: PlanView, group: ReadinessGroup, entries: ReadinessEntry[], env: Env, compareSession: string | null, heading: 'h4' | 'h5' = 'h4') {
  const box = testid(el('div', `ap-ready-group${heading === 'h5' ? ' ap-ready-sub' : ''}`), `readiness-${group}`);
  box.dataset.count = String(entries.length);
  const copy = READINESS_GROUPS[group];
  box.append(el(heading, 'ap-ready-title', `${copy.title} · ${entries.length}`));
  if (copy.note && entries.length) box.append(el('p', 'ap-note', copy.note));
  if (!entries.length) { if (group === 'ready') box.append(el('p', 'ap-note', 'No tasks are ready from the recorded information.')); return box; }
  const ul = el('ul', 'ap-ready-list');
  for (const e of entries) ul.append(readinessEntry(plan, e, env, compareSession));
  box.append(ul);
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
  if (r.state === 'loading') { section.append(el('p', 'ap-note', 'Readiness appears once every task has loaded.')); return section; }
  if (r.state === 'unavailable') { section.append(el('p', 'ap-note', 'Readiness is unavailable because the tasks could not be loaded.')); return section; }
  if (r.state === 'invalid') {
    section.dataset.reason = r.reason;
    section.append(el('p', 'ap-doc-warn', `Readiness is unavailable for this report: ${INVALID_COPY[r.reason]}. The tasks are shown below as reported.`));
    return section;
  }
  section.append(el('p', 'ap-note', 'Based on recorded prerequisites only. Other prerequisites may not be recorded.'));
  if (!env.view.fresh) { section.dataset.stale = 'true'; section.append(el('p', 'ap-doc-warn', 'Last reported readiness. It may be out of date and isn’t a current recommendation.')); }
  if (r.incomplete) section.append(el('p', 'ap-doc-warn', 'Some recorded prerequisites aren’t in this plan, so the tasks that need them can’t be shown as ready.'));
  const notice = testid(el('p', 'ap-note'), 'readiness-notice');
  notice.setAttribute('role', 'status');
  section.append(notice, readinessGroup(plan, 'ready', r.groups.ready, env, compareSession));
  if (r.groups.waiting.length || r.groups.skipped.length) {
    const waiting = readinessGroup(plan, 'waiting', r.groups.waiting, env, compareSession);
    waiting.querySelector('.ap-ready-title')!.textContent = `${READINESS_GROUPS.waiting.title} · ${r.groups.waiting.length + r.groups.skipped.length}`;
    waiting.dataset.count = String(r.groups.waiting.length + r.groups.skipped.length);
    if (r.groups.skipped.length) waiting.append(readinessGroup(plan, 'skipped', r.groups.skipped, env, compareSession, 'h5'));
    section.append(waiting);
  }
  if (r.groups.blocked.length) section.append(readinessGroup(plan, 'blocked', r.groups.blocked, env, compareSession));
  return section;
}

export interface DetailHooks {
  detail: Loadable<PlanDetail> | null;
  retryDetail?: () => void;
  document: { get: () => Loadable<DocumentBody> | null; request: () => void };
}

/**
 * `compareSession`: the session readiness compares recorded assignees with (rail: the selected
 * host session; board: an explicit session filter). Null keeps neutral assignee labels.
 */
export function planDetail(plan: PlanView, env: Env, hooks: DetailHooks, options: { document: 'disclosure' | 'inline' | 'omit'; heading?: 'h2' | 'h3'; compareSession?: string | null }) {
  const root = testid(el('article', 'ap-plan'), `plan-${plan.id}`);
  root.dataset.lifecycle = plan.lifecycle;
  root.dataset.source = plan.sourceId;
  root.dataset.revision = String(plan.revision);
  const ready = hooks.detail?.state === 'ready' && hooks.detail.value.revision === plan.revision ? hooks.detail.value : null;
  const summary = summarize(plan, ready);
  if (showsLiveness(plan.lifecycle, summary, env.view)) root.dataset.motion = 'on';
  root.append(planHeader(plan, env, options.heading), progressBlock(summary));
  if (ready) {
    const now = currentWorkBlock(plan, ready, env);
    if (now) root.append(now);
  }
  const readinessSection = readinessBlock(plan, hooks.detail, env, options.compareSession ?? null);
  if (readinessSection) root.append(readinessSection);
  if (ready) root.append(itemList(plan, ready, env));
  else {
    const tasks = el('section', 'ap-section');
    tasks.append(el('h3', 'ap-h', 'Tasks'), partState('detail-loading', 'tasks', hooks.detail?.state === 'error' ? hooks.detail : null, hooks.retryDetail));
    root.append(tasks);
  }
  root.append(peopleBlock(plan, ready, env));
  if (options.document !== 'omit') root.append(documentBlock(plan, env, options.document, hooks.document));
  return root;
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
