// "Since you last reviewed" section above Revisions in full-page History (docs/ui.md). Text only;
// recorded titles land through textContent. All async state and action authority stay in
// change-digest.ts; this file only paints one DigestPanel. No animation, no auto-scroll.
import { mountButton, mountSpinner } from '@openchamber/sdk/ui';
import type { DigestPanel } from './change-digest.ts';
import { REVIEW_COPY } from './change-digest.ts';
import { age, el, FAILURE_COPY, glyph, testid, type Env } from './components.ts';
import { plural } from './format.ts';
import { STATUS_LABEL, type Counts, type DigestEvents, type DigestFacet, type DigestFacts, type DigestReason, type DigestReference, type DigestScope, type DigestTask, type DigestView } from './model.ts';

/** Facet names say what was reported, never an inferred cause (an unblocked task is not "solved"). */
export const FACET_LABEL: Record<DigestFacet, string> = {
  completed: 'Completed', reopened: 'No longer done', blocked: 'Reported blocked', unblocked: 'No longer reported blocked',
  added: 'Added', removed: 'Removed', revised: 'Revised', skipped: 'Skipped (left the count)', unskipped: 'Returned to the count',
};
const FACET_ORDER: DigestFacet[] = ['completed', 'reopened', 'blocked', 'unblocked', 'added', 'removed', 'skipped', 'unskipped', 'revised'];
const REASON_TEXT: Record<DigestReason, string> = {
  gap: 'a saved revision in this range is missing',
  'missing-snapshot': 'a saved revision in this range is missing',
  'invalid-snapshot': 'a saved revision is unreadable',
  'revision-bound': 'only the most recent 128 revisions are compared',
  'byte-bound': 'the saved history is too large to compare at once',
};

/** `D/T done (P%)`; a zero total has no percentage (the existing unavailable-percentage rule). */
export function countsText(c: Counts) {
  if (c.total === 0) return `no counted tasks${c.skipped ? ` (${c.skipped} skipped)` : ''}, no percentage`;
  return `${c.done}/${c.total} done (${Math.round((c.done / c.total) * 100)}%)`;
}

/**
 * Endpoint count causes, scope kept apart from completion: added/removed/skipped/returned explain
 * the total; completed/reopened/added-done/removed-done explain done. No percentage-point allocation.
 */
export function scopeLines(before: Counts, after: Counts, s: DigestScope) {
  const scope: string[] = [];
  if (s.addedCounted) scope.push(`${plural(s.addedCounted, 'counted task', 'counted tasks')} added`);
  if (s.removedCounted) scope.push(`${plural(s.removedCounted, 'counted task', 'counted tasks')} removed`);
  if (s.skipped) scope.push(`${plural(s.skipped, 'existing task', 'existing tasks')} skipped, leaving the count`);
  if (s.unskipped) scope.push(`${plural(s.unskipped, 'skipped task', 'skipped tasks')} returned to the count`);
  if (!scope.length) scope.push(after.total === before.total ? 'counted tasks unchanged' : 'counted tasks changed');
  const done: string[] = [];
  if (s.completed) done.push(`${plural(s.completed, 'existing task', 'existing tasks')} now done`);
  if (s.reopened) done.push(`${plural(s.reopened, 'task', 'tasks')} no longer done`);
  if (s.addedDone) done.push(`${plural(s.addedDone, 'added task was', 'added tasks were')} already done`);
  if (s.removedDone) done.push(`${plural(s.removedDone, 'done task', 'done tasks')} removed`);
  if (!done.length) done.push(after.done === before.done ? 'completed count unchanged' : 'completed count changed');
  return { scope, done };
}

export const rangeText = (from: number, to: number) => (from === to ? `revision ${to}` : `revisions ${from}–${to}`);

/**
 * Coverage and qualification, one sentence each; unknown history is never called zero changes.
 * Lines after the first are qualifications when the digest is not complete (warning tone).
 */
export function coverageText(d: DigestView): string[] {
  const i = d.interval;
  if (d.availability === 'target-unavailable') return [`Revision ${i.to} can’t be read, so its changes can’t be shown or marked reviewed.`];
  if (d.availability === 'initial') return ['Initial view — no saved reviewed revision in this profile.', `Showing revision ${i.to}. Mark reviewed to compare later changes against it.`];
  const out: string[] = [];
  const reasons = [...new Set(d.reasons.map((r) => REASON_TEXT[r]))].join('; ');
  if (d.availability === 'baseline-unavailable') {
    out.push(`Changes since your reviewed revision ${i.after}, up to revision ${i.to}.`);
    out.push(`Revision ${i.after} can’t be read any more, so totals can’t be compared.`);
    out.push(i.coverageStart! < i.to ? `Showing changes recorded in ${rangeText(i.coverageStart!, i.to)} only${reasons ? ` (${reasons})` : ''}.` : `No changes could be compared${reasons ? ` (${reasons})` : ''}.`);
    return out;
  }
  if (i.after === i.to) return [`No new revisions since you reviewed revision ${i.to}.`];
  out.push(`Changes from revision ${i.after} to revision ${i.to}.`);
  if (!d.complete) out.push(`Only ${rangeText(i.coverageStart!, i.to)} could be compared${reasons ? ` (${reasons})` : ''}; earlier changes in this range aren’t shown. The totals still compare revisions ${i.after} and ${i.to}.`);
  return out;
}

const sum = (e: DigestEvents) => FACET_ORDER.reduce((n, f) => n + e[f], 0);

/** Task groups by most significant reported facet; rows keep the digest's recent-first order. */
const GROUPS: { id: string; title: string; test: (t: DigestTask) => boolean }[] = [
  { id: 'removed', title: 'Removed tasks', test: (t) => !t.presentAtTarget },
  { id: 'blockers', title: 'Blockers', test: (t) => t.occurrences.blocked + t.occurrences.unblocked > 0 },
  { id: 'completion', title: 'Completion', test: (t) => t.occurrences.completed + t.occurrences.reopened > 0 },
  { id: 'added', title: 'Added tasks', test: (t) => t.occurrences.added > 0 },
  { id: 'scope', title: 'Skipped or returned', test: (t) => t.occurrences.skipped + t.occurrences.unskipped > 0 },
  { id: 'revised', title: 'Revised tasks', test: () => true },
];
export function groupTasks(tasks: DigestTask[]) {
  const out = new Map<string, DigestTask[]>();
  for (const t of tasks) {
    const g = GROUPS.find((x) => x.test(t))!;
    out.set(g.id, [...(out.get(g.id) ?? []), t]);
  }
  return GROUPS.filter((g) => out.has(g.id)).map((g) => ({ ...g, tasks: out.get(g.id)! }));
}

const occurrenceText = (e: DigestEvents) => FACET_ORDER.filter((f) => e[f]).map((f) => (e[f] > 1 ? `${FACET_LABEL[f]} ×${e[f]}` : FACET_LABEL[f])).join(' · ');

/** What one recorded adjacent pair changed, from its before/after facts only. */
export function referenceText(r: DigestReference) {
  const parts = [r.facets.map((f) => FACET_LABEL[f]).join(', ') + '.'];
  const a = r.before, b = r.after;
  const facts = (f: DigestFacts) => `“${f.title}” (${STATUS_LABEL[f.status]})`;
  if (!a && b) parts.push(`Recorded as ${facts(b)}.`);
  else if (a && !b) parts.push(`Last recorded as ${facts(a)}.`);
  else if (a && b) {
    if (a.status !== b.status) parts.push(`Status ${STATUS_LABEL[a.status]} → ${STATUS_LABEL[b.status]}.`);
    if (a.title !== b.title) parts.push(`Title “${a.title}” → “${b.title}”.`);
    if (a.parentId !== b.parentId) parts.push(`Group ${a.parentId ?? 'none'} → ${b.parentId ?? 'none'}.`);
    if (a.dependencies.join() !== b.dependencies.join()) parts.push(`Prerequisites ${a.dependencies.join(', ') || 'none'} → ${b.dependencies.join(', ') || 'none'}.`);
  }
  return parts.join(' ');
}

let announcer: HTMLElement | null = null;
let announced = 0;
/**
 * One persistent polite live region outside the repainted root (repaints replace the root, and a
 * freshly inserted live region is announced unreliably). Each explicit outcome is spoken once; a
 * repaint or poll with the same outcome id says nothing.
 */
export function announceDigest(id: number, text: string) {
  if (!id || !text || id === announced) return;
  announced = id;
  if (!announcer?.isConnected) {
    announcer = testid(el('p', 'ap-sr'), 'digest-announcer');
    announcer.setAttribute('role', 'status'); announcer.setAttribute('aria-live', 'polite'); announcer.setAttribute('aria-atomic', 'true');
    document.body.append(announcer);
  }
  const node = announcer;
  node.textContent = '';
  // Next frame, so an identical repeated outcome is still a change for assistive technology.
  requestAnimationFrame(() => { if (announced === id) node.textContent = text; });
}

/** Native kit button whose hook and focus survive repaints; unavailable controls stay focusable (aria-disabled). */
function action(parent: HTMLElement, id: string, label: string, run: (event: MouseEvent) => void, enabled: boolean, variant: 'outline' | 'default' = 'outline') {
  const holder = el('span');
  mountButton(holder, { label, variant, size: variant === 'default' ? 'sm' : 'xs', onClick: () => {} });
  const b = holder.querySelector('button')!;
  b.dataset.testid = id;
  if (!enabled) b.setAttribute('aria-disabled', 'true');
  b.addEventListener('click', (event) => { if (b.getAttribute('aria-disabled') !== 'true') run(event); });
  parent.append(holder);
  return b;
}

function unavailableText(panel: DigestPanel): { text: string; retry: boolean } {
  const u = panel.unavailable!;
  switch (u.reason) {
    case 'service': return { text: 'This progress service can’t compare revisions. Update the extension and its companion to see changes since your last review.', retry: false };
    case 'checkpoint': return u.checkpoint === 'unsupported'
      ? { text: 'This OpenChamber version can’t remember a review point on this device, so changes since your last review can’t be shown. Revisions below stay available.', retry: false }
      : { text: `${REVIEW_COPY[u.checkpoint]} Changes since your last review can’t be shown right now; nothing was changed.`, retry: true };
    case 'ahead': return { text: `The saved review point (revision ${u.saved}) is newer than this plan’s latest revision (${u.latest}), so it can’t be used. Nothing was changed.`, retry: true };
    case 'missing': return { text: 'This plan is no longer available, so there is nothing to review.', retry: false };
    case 'conflict': return { text: 'This plan changed while its digest loaded. Refresh digest to try again.', retry: true };
    case 'read': return { text: `Changes since your last review couldn’t be loaded. ${FAILURE_COPY[u.failure.kind].title}.`, retry: true };
  }
}

export function digestBlock(panel: DigestPanel, env: Env, onViewTask: (itemId: string, title: string) => void) {
  const section = testid(el('section', 'ap-section ap-digest'), 'change-digest');
  const heading = el('h3', 'ap-h', 'Since you last reviewed');
  heading.id = 'ap-digest-heading';
  section.setAttribute('aria-labelledby', heading.id);
  section.append(heading);
  const d = panel.digest;
  section.dataset.state = panel.state === 'ready' ? d!.availability : panel.state;
  section.dataset.review = panel.review;
  if (panel.unavailable) section.dataset.reason = panel.unavailable.reason === 'checkpoint' ? `checkpoint-${panel.unavailable.checkpoint}` : panel.unavailable.reason;
  // Visible copy of the last explicit outcome; only announceDigest speaks it, once.
  const status = testid(el('p', 'ap-note ap-digest-status', panel.status), 'digest-status');
  announceDigest(panel.statusId, panel.status);

  if (panel.state === 'loading') {
    const slot = testid(el('div', 'ap-row ap-note'), 'digest-loading');
    mountSpinner(slot, { size: 'sm', label: 'Loading changes since your last review' });
    section.append(slot, status);
    return section;
  }
  if (panel.state === 'unavailable') {
    const { text, retry } = unavailableText(panel);
    section.append(testid(el('p', 'ap-digest-warn', text), 'digest-unavailable'));
    const row = el('div', 'ap-row');
    if (retry) action(row, 'digest-refresh', 'Refresh digest', () => panel.refresh(), panel.canRefresh);
    if (row.childNodes.length) section.append(row);
    section.append(status);
    return section;
  }

  const digest = d!;
  section.dataset.to = String(digest.interval.to);
  if (digest.interval.after !== null) section.dataset.after = String(digest.interval.after);
  const coverage = testid(el('div', 'ap-digest-coverage'), 'digest-coverage');
  coverage.dataset.complete = String(digest.complete);
  coverage.dataset.reasons = digest.reasons.join(' ');
  coverageText(digest).forEach((line, n) => coverage.append(el('p', n > 0 && !digest.complete && digest.availability !== 'initial' ? 'ap-digest-warn' : '', line)));
  if (digest.interval.coverageEndReportedAt) { const p = el('p', 'ap-note'); p.append(age(digest.interval.coverageEndReportedAt, env, `Revision ${digest.interval.to} reported `)); coverage.append(p); }
  section.append(coverage);

  // Notices that ask for Refresh; never replace the displayed text silently.
  const notices: [string, string][] = [];
  if (panel.needsRefresh) notices.push(['digest-stale', 'This plan changed since the digest loaded (outcome or cleanup). Refresh digest before marking it reviewed.']);
  if (panel.elsewhere !== null) notices.push(['digest-elsewhere', `Reviewed through revision ${panel.elsewhere} in another window or tab. Refresh digest to compare from there.`]);
  if (panel.newer !== null) notices.push(['digest-newer', `Newer changes are available (revision ${panel.newer}). Refresh digest to include them.`]);
  for (const [id, text] of notices) section.append(testid(el('p', 'ap-digest-notice', text), id));

  const { before, after, scope } = digest.counts;
  if (after) {
    const counts = testid(el('div', 'ap-digest-counts'), 'digest-counts');
    counts.dataset.done = String(after.done); counts.dataset.total = String(after.total);
    if (before && scope) {
      counts.append(el('p', 'ap-digest-fraction', `${countsText(before)} → ${countsText(after)}`));
      const lines = scopeLines(before, after, scope);
      const ul = testid(el('ul', 'ap-digest-causes'), 'digest-scope');
      const li = (label: string, items: string[]) => { const n = el('li'); n.append(el('b', '', `${label}: `), document.createTextNode(`${items.join('; ')}.`)); ul.append(n); };
      li('Scope', lines.scope);
      li('Completion', lines.done);
      counts.append(ul, el('p', 'ap-note', 'Scope changes move the total; they are not completions.'));
    } else counts.append(el('p', 'ap-digest-fraction', `Now ${countsText(after)}`));
    section.append(counts);
  }

  if (digest.availability === 'comparison' || digest.availability === 'baseline-unavailable') {
    const events = digest.summary.events;
    const range = rangeText(digest.interval.coverageStart!, digest.interval.to);
    if (!sum(events) && !digest.tasks.length) {
      section.append(testid(el('p', 'ap-note', digest.interval.after === digest.interval.to ? 'Nothing to summarize yet.' : `No summarized task changes in ${digest.complete ? range : `the compared ${range}`}. Group-only edits and pending ↔ in-progress updates aren’t summarized; see Revisions below.`), 'digest-empty'));
    } else {
      const summary = testid(el('div', 'ap-digest-summary'), 'digest-summary');
      summary.append(el('h4', 'ap-digest-h', 'Recorded transitions'));
      const ul = el('ul', 'ap-digest-events');
      for (const f of FACET_ORDER) if (events[f]) { const n = el('li', '', `${FACET_LABEL[f]}: ${events[f]}`); n.dataset.facet = f; ul.append(n); }
      summary.append(ul, el('p', 'ap-note', `Counted per recorded change, not per task${digest.complete ? '' : `, in the compared ${range}`}.`));
      section.append(summary);
      for (const group of groupTasks(digest.tasks)) {
        const g = testid(el('section', 'ap-digest-group'), `digest-group-${group.id}`);
        g.append(el('h4', 'ap-digest-h', `${group.title} (${group.tasks.length})`));
        const list = el('ul', 'ap-digest-tasks');
        for (const t of group.tasks) list.append(taskRow(t, env, onViewTask));
        g.append(list);
        section.append(g);
      }
      if (digest.details.omittedTasks || digest.details.truncated) {
        const n = digest.details.omittedTaskCount;
        const text = digest.details.omittedTasks
          ? (n === null || n === 0 ? 'More changed tasks aren’t listed here.' : `${plural(n, 'more changed task isn’t', 'more changed tasks aren’t')} listed here.`)
          : 'Some older recorded changes aren’t listed here.';
        section.append(testid(el('p', 'ap-note', `${text} The transition counts above still include them.`), 'digest-omitted'));
      }
    }
  }

  const actions = testid(el('div', 'ap-row ap-digest-actions'), 'digest-actions');
  const reviewed = panel.review === 'saved' || (panel.reviewedThrough !== null && panel.reviewedThrough >= digest.interval.to);
  const mark = action(actions, 'digest-mark-reviewed', reviewed ? 'Reviewed' : panel.review === 'pending' ? 'Saving…' : 'Mark reviewed', (event) => panel.markReviewed({ isTrusted: event.isTrusted }), panel.canReview, 'default');
  mark.setAttribute('aria-describedby', 'ap-digest-review-note');
  action(actions, 'digest-refresh', 'Refresh digest', () => panel.refresh(), panel.canRefresh);
  section.append(actions);
  const note = testid(el('p', 'ap-note'), 'digest-review-note');
  note.id = 'ap-digest-review-note';
  note.textContent = !digest.validTarget ? 'This revision can’t be marked reviewed.'
    : reviewed ? `Reviewed through revision ${Math.max(panel.reviewedThrough ?? 0, digest.interval.to)} in this profile.`
      : digest.availability === 'initial' ? `Marks revision ${digest.interval.to} reviewed in this browser profile and account only. Nothing in the plan changes.`
        : !digest.complete ? `Marking reviewed starts the next comparison at revision ${digest.interval.to}; earlier changes that couldn’t be compared won’t be recovered.`
          : `Marks revision ${digest.interval.to} reviewed in this browser profile and account only, not on other devices.`;
  section.append(note, status);
  return section;
}

function taskRow(t: DigestTask, env: Env, onViewTask: (itemId: string, title: string) => void) {
  const li = testid(el('li', 'ap-digest-task'), `digest-task-${t.id}`);
  li.dataset.present = String(t.presentAtTarget);
  li.dataset.status = t.status;
  const line = el('div', 'ap-digest-line');
  line.append(glyph(t.status), el('span', 'ap-digest-title', t.title));
  line.append(el('span', 'ap-muted ap-small', t.presentAtTarget ? `Now ${STATUS_LABEL[t.status]}` : `Removed — last ${STATUS_LABEL[t.status]}`));
  li.append(line, el('p', 'ap-digest-facets', occurrenceText(t.occurrences)));
  if (!t.presentAtTarget) li.append(el('p', 'ap-note', 'Historical record only: this task is not in the plan at the reviewed revision.'));
  const entry = testid(el('details', 'ap-digest-entry'), `digest-entry-${t.id}`);
  const revs = t.references.map((r) => r.to);
  entry.append(el('summary', '', `Recorded changes (${revs.length > 1 ? 'revisions' : 'revision'} ${revs.join(', ')})`));
  const ol = el('ol', 'ap-digest-refs');
  for (const r of t.references) {
    const n = testid(el('li'), `digest-history-${t.id}-${r.to}`);
    n.append(el('b', '', `Revision ${r.from} → ${r.to}`), document.createTextNode(' · '), age(r.reportedAt, env), el('p', '', referenceText(r)));
    ol.append(n);
  }
  entry.append(ol);
  if (t.omittedReferences) entry.append(el('p', 'ap-note', `${plural(t.omittedReferences, 'earlier recorded change isn’t', 'earlier recorded changes aren’t')} listed.`));
  li.append(entry);
  if (t.presentAtTarget) {
    const b = el('button', 'ap-link', 'View current task');
    b.type = 'button';
    b.dataset.testid = `digest-view-${t.id}`;
    b.setAttribute('aria-label', `View current task: ${t.title}`);
    b.addEventListener('click', () => onViewTask(t.id, t.title));
    li.append(b);
  }
  return li;
}
