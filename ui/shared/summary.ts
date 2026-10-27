// Deterministic, recorded-only Markdown. No clock, browser, live sessions or service access.
import { DOCUMENT_STATE_TEXT, LIFECYCLE_LABEL, STATUS_LABEL, type ItemView } from './model.ts';
import { readiness } from './readiness.ts';
import type { CompleteDetailResult, DetailFailureCause, DetailSnapshot } from './source.ts';

/** Escape recorded literals, including multiline/HTML-looking titles, as a single Markdown line. */
export function markdownLiteral(text: string): string {
  return text.replace(/\r\n?|\n|\u2028|\u2029/g, ' ').replace(/[\\`*_{}\[\]()#+.!|>~\-]/g, '\\$&').replace(/&/g, '&amp;').replace(/</g, '&lt;');
}

/** Fixed copy only: service messages and arbitrary diagnostic values are never interpolated. */
export function describeDetailFailure(cause: DetailFailureCause): string {
  switch (cause.kind) {
    case 'revision-restarts': return 'The revision restart budget was exhausted.';
    case 'page-cap': return 'The detail page limit was reached.';
    case 'identity-contract': return 'The detail identity or response contract was refused.';
    case 'unreachable-auth': return 'The service is unreachable, disconnected, or access was refused.';
    case 'not-found': return 'The plan was not found.';
    case 'store': return cause.code === 'unknown' ? 'The progress store is unavailable (HTTP 503).' : `The progress store returned ${cause.code} (HTTP 503).`;
  }
}

const DIAGNOSTIC_TEXT: Record<string, string> = {
  'historical-capture': 'The document snapshot is historical.',
  'capture-disabled': 'Progress capture is disabled.',
  'source-unverified': 'The recorded source is not verified.',
  'host-source-binding-unverified': 'The host source binding is not verified.',
};

function warnings(s: DetailSnapshot): string[] {
  const d = s.plan.document;
  const lines: string[] = [];
  if (!s.captureEnabled) lines.push('Progress capture is disabled.');
  if (d.state !== 'captured') lines.push(DOCUMENT_STATE_TEXT[d.state]);
  if (d.state !== 'captured' && d.captureId !== undefined) lines.push('The last successful document snapshot is retained; the latest capture did not replace it.');
  if (!d.checklistSynchronized) lines.push('The recorded checklist is not synchronized.');
  if (d.captureId !== undefined) lines.push('The current document file has not been rechecked.');
  for (const code of s.diagnostics) lines.push(Object.hasOwn(DIAGNOSTIC_TEXT, code) ? DIAGNOSTIC_TEXT[code] : 'A progress-service diagnostic was recorded; details are unavailable.');
  return [...new Set(lines.filter(Boolean))];
}

function header(s: DetailSnapshot): string[] {
  const p = s.plan, c = p.counts;
  return [
    `Plan: ${markdownLiteral(p.title)} (${markdownLiteral(p.id)})${p.cleanup?.state === 'archived' ? ' (archived)' : ''}`,
    `Lifecycle: ${LIFECYCLE_LABEL[p.lifecycle]}`,
    `Progress: ${c.done}/${c.total} done; ${c.remaining} remaining; ${c.skipped} skipped`,
    `Last report: ${new Date(p.reportedAt).toISOString()}`,
  ];
}

function warningSection(s: DetailSnapshot): string[] {
  const w = warnings(s);
  return w.length ? ['', '## Freshness warnings', ...w.map((line) => `- ${line}`)] : [];
}

function full(result: CompleteDetailResult, handoff: boolean): string | null {
  const s = result.snapshot;
  if (!s || s.plan.key !== result.detail.key || s.plan.revision !== result.detail.revision || s.plan.key !== result.plan.key || s.plan.revision !== result.plan.revision) return null;
  const p = s.plan, d = result.detail;
  const tasks = d.items.filter((i) => i.kind === 'task');
  const working = tasks.filter((i) => i.status === 'working');
  const blocked = tasks.filter((i) => i.status === 'blocked');
  const pending = tasks.filter((i) => i.status === 'pending');
  const lines = header(s);
  if (handoff) lines.push(`Origin session: ${markdownLiteral(p.ownerSessionId)}`, `Coverage: full (revision ${p.revision})`);
  if (working.length + blocked.length + pending.length === p.counts.remaining) lines.push(`Remaining breakdown: ${working.length} working; ${blocked.length} blocked; ${pending.length} pending`);
  const byId = new Map(d.items.map((i) => [i.id, i]));
  // Descriptions report edges, not readiness: still valid on closed/invalid graphs.
  const prerequisites = (item: ItemView) => {
    if (!item.dependencies?.length) return 'No prerequisites recorded';
    return `Recorded prerequisites: ${item.dependencies.map((id) => {
      const target = byId.get(id);
      return !target ? 'Prerequisite task unavailable' : target.kind !== 'task'
        ? `${markdownLiteral(target.title)} (group; not a task prerequisite)`
        : `${markdownLiteral(target.title)} (${STATUS_LABEL[target.status]}${target.status === 'skipped' ? '; does not count as done' : ''})`;
    }).join('; ')}`;
  };
  const section = (title: string, items: ItemView[], empty: string, isBlocked = false) => {
    lines.push('', `## ${title}`);
    if (!items.length) lines.push(empty);
    for (const i of items) lines.push(`- ${markdownLiteral(i.title)}${isBlocked ? ' — no reason recorded' : ''}${handoff ? ` — ${prerequisites(i)}` : ''}`);
  };
  section('Current work', working, 'No current work is recorded.');
  section('Explicitly blocked', blocked, 'No explicitly blocked work is recorded.', true);
  if (handoff) {
    section('Not started', pending.slice(0, 10), 'No not-started work is recorded.');
    if (pending.length > 10) lines.push(`…showing 10 of ${pending.length}`);
    const direct = d.contributions.filter((c) => c.mode === 'direct').length;
    const relayed = d.contributions.filter((c) => c.mode === 'parent-relay').length;
    lines.push('', `Recorded reports: ${direct} direct; ${relayed} parent-relay`);
    const r = readiness(p, { state: 'ready', value: d });
    const next = r.state === 'ready' && !r.incomplete ? r.groups.ready[0] : undefined;
    lines.push('', '## Suggested next step (suggestion, not an authoritative plan step)', next ? markdownLiteral(next.item.title) : 'No ready next step is recorded.');
  }
  lines.push(...warningSection(s));
  return lines.join('\n') + '\n';
}

/** Null means a usable matching first-page summary was not available; never substitute a list row. */
export const formatProgressUpdate = (result: CompleteDetailResult): string | null => full(result, false);
export const formatHandoff = (result: CompleteDetailResult): string | null => full(result, true);

/** Explicit historical fallback only; its input cannot carry partial detail arrays. */
export function formatSummaryOnly(snapshot: DetailSnapshot, cause: DetailFailureCause): string {
  return [...header(snapshot), 'Coverage: summary-only historical snapshot; full detail is unavailable.', `Read failure: ${describeDetailFailure(cause)}`, ...warningSection(snapshot)].join('\n') + '\n';
}
