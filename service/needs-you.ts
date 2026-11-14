import { createHash } from 'node:crypto';
import { countItems, identifier, requireProgress as need, validBlockerAnnotation, type Item, type PlanState } from '../shared/progress.ts';
import { NEEDS_YOU_LIMITS as L, type NeedsYouRequest, type NeedsYouWindow, type NeedsYouRow } from '../shared/needs-you.ts';
import { validateDigestSnapshot } from '../shared/change-digest.ts';
import { cleanupInstalled, cleanupState } from '../shared/cleanup.ts';
import type { Store } from '../shared/store.ts';
import { blockedTiming, type BlockedTimingBudget } from './blocked-timing.ts';

const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const safe = (v: unknown, min = 0): v is number => Number.isSafeInteger(v) && Number(v) >= min;
const fields = (v: object, keys: string[]) => Object.keys(v).length === keys.length && Object.keys(v).every(k => keys.includes(k));
interface Position { plan: string; revision: number; cleanup: number; offset: number }
interface Cursor {
  v: 1; identity: string; after: string; pending: Position | null;
  counts: NeedsYouWindow['counts']; skipped: number; reasons: NeedsYouWindow['coverage']['reasons'];
}
function cursor(text: string): Cursor {
  need(typeof text === 'string' && Buffer.byteLength(text) <= L.cursorBytes && /^[A-Za-z0-9_-]+$/.test(text));
  let c: Cursor; try { c = JSON.parse(Buffer.from(text, 'base64url').toString('utf8')); } catch { need(false); }
  need(c! && fields(c!, ['v','identity','after','pending','counts','skipped','reasons']) && c!.v === 1 && /^[a-f0-9]{64}$/.test(c!.identity) && (c!.after === '' || identifier(c!.after)) && safe(c!.skipped) &&
    c!.counts && fields(c!.counts, ['needsYou','alsoBlocked']) && safe(c!.counts.needsYou) && safe(c!.counts.alsoBlocked) && Array.isArray(c!.reasons) && c!.reasons.length <= 2 &&
    new Set(c!.reasons).size === c!.reasons.length && c!.reasons.every(r => ['invalid-snapshot','oversized-snapshot'].includes(r)) && (c!.skipped > 0) === (c!.reasons.length > 0));
  const p = c!.pending;
  need(p === null || p && fields(p, ['plan','revision','cleanup','offset']) && identifier(p.plan) && p.plan > c!.after && safe(p.revision, 1) && safe(p.cleanup) && safe(p.offset) && p.offset < 1000);
  return c!;
}
function context(p: PlanState, item: Item) {
  const byId = new Map(p.items.map(i => [i.id, i])), ancestors: { id: string; title: string }[] = [];
  let parent = item.parentId;
  while (parent) { const a = byId.get(parent)!; ancestors.unshift({ id: a.id, title: a.title }); parent = a.parentId; }
  const omittedAncestors = Math.max(0, ancestors.length - L.ancestors);
  return { ancestors: omittedAncestors ? [ancestors[0], ...ancestors.slice(-(L.ancestors - 1))] : ancestors, omittedAncestors };
}
function blocker(item: Item, revision: number): NeedsYouRow['blocker'] {
  if (!Object.hasOwn(item, 'blocker')) return { state: 'absent' };
  if (validBlockerAnnotation(item.blocker, revision)) return { state: 'reported', annotation: { ...item.blocker } };
  // Preserve validated prose/provenance for future categories, but never serialize the unknown value.
  const b = item.blocker as unknown as Record<string, unknown>;
  if (b && typeof b === 'object' && !Array.isArray(b) && typeof b.category === 'string' &&
      validBlockerAnnotation({ ...b, category: undefined }, revision)) {
    return { state: 'reported', annotation: { ...b, category: 'unclassified' } as Extract<NeedsYouRow['blocker'], { state: 'reported' }>['annotation'] };
  }
  return { state: 'invalid' };
}

/** Read-only source-wide keyset projection. No Store, source-root or durable inbox discovery. */
export function needsYou(store: Store, request: NeedsYouRequest, now = new Date()): NeedsYouWindow {
  need(request && Object.keys(request).every(k => ['storeId','binding','source','cursor','limit','timing'].includes(k)) && identifier(request.storeId) && identifier(request.source));
  const limit = request.limit ?? L.rows;
  need(Number.isInteger(limit) && limit > 0 && limit <= L.rows && (request.timing === undefined || typeof request.timing === 'boolean'));
  need(request.binding && Object.keys(request.binding).length === 2 && Object.keys(request.binding).every(k => ['sourceId','verified'].includes(k)));
  // Reuse the Store's schema admission/current read-binding owner, with one bounded identity key.
  const observed = store.searchState(request.storeId, [{ source: request.source, plan: 'inbox-identity' }]);
  const binding = observed.sourceBinding;
  need(binding.verified && binding.sourceId === request.source && request.binding.verified === true && request.binding.sourceId === binding.sourceId, 'conflict');
  const identity = hash([request.storeId, binding, request.source, limit, request.timing ?? false]);
  const c: Cursor = request.cursor === undefined ? { v: 1, identity, after: '', pending: null, counts: { needsYou: 0, alsoBlocked: 0 }, skipped: 0, reasons: [] } : cursor(request.cursor);
  need(c.identity === identity, 'conflict');
  const db = store.db;
  db.exec('BEGIN');
  try {
    const meta = db.prepare('SELECT store_id,enabled FROM meta WHERE singleton=1').get()!;
    need(meta.store_id === request.storeId && db.prepare('SELECT verified FROM sources WHERE id=?').get(request.source)?.verified === 1, 'conflict');
    const installed = cleanupInstalled(db);
    const r: NeedsYouWindow = {
      protocolVersion: 2, schemaVersion: 2, needsYouInbox: 1, storeId: request.storeId,
      sourceBinding: { sourceId: request.source, verified: true }, readAt: now.toISOString(), captureEnabled: Boolean(meta.enabled),
      rows: [], counts: c.counts, nextCursor: null,
      coverage: { kind: 'observed-current', complete: false, exhausted: false, gapped: c.skipped > 0, skippedRecords: c.skipped, reasons: c.reasons },
      work: { planSlots: 0, inspectedItems: 0, inputBytes: 0, outputBytes: 0 },
    };
    let rowBytes = 0;
    const timingPlans = new Map<string, PlanState>();
    const advance = (id: string) => { c.after = id; c.pending = null; };
    const gap = (reason: NeedsYouWindow['coverage']['reasons'][number]) => {
      c.skipped++; r.coverage.skippedRecords = c.skipped; r.coverage.gapped = true;
      if (!c.reasons.includes(reason)) c.reasons.push(reason);
    };
    while (r.work.planSlots < L.plans && r.rows.length < limit) {
      const pending = c.pending;
      const row = pending
        ? db.prepare('SELECT id,revision,length(CAST(snapshot AS BLOB)) AS bytes FROM plans WHERE source=? AND id=?').get(request.source, pending.plan)
        : db.prepare('SELECT id,revision,length(CAST(snapshot AS BLOB)) AS bytes FROM plans WHERE source=? AND id>? ORDER BY id LIMIT 1').get(request.source, c.after);
      r.work.planSlots++;
      if (!row) { need(!pending, 'conflict'); r.coverage.exhausted = true; break; }
      const id = String(row.id), revision = Number(row.revision), cleanup = installed ? cleanupState(db, request.source, id) : undefined;
      const generation = Number(cleanup?.generation ?? 0), visible = (cleanup?.state ?? 'visible') === 'visible';
      need(identifier(id), 'corrupt');
      if (pending) need(revision === pending.revision && generation === pending.cleanup && visible, 'conflict');
      if (!visible) { advance(id); continue; }
      const bytes = Number(row.bytes);
      if (bytes > L.inputBytes) { gap('oversized-snapshot'); advance(id); continue; }
      if (r.work.inputBytes + bytes > L.inputBytes) break;
      const text = db.prepare('SELECT snapshot FROM plans WHERE source=? AND id=?').get(request.source, id)!.snapshot;
      r.work.inputBytes += bytes;
      let p: PlanState | undefined;
      try {
        const value = JSON.parse(String(text)) as PlanState;
        if (validateDigestSnapshot(value, request.source, id, revision) && typeof value.title === 'string' && value.title.trim() && value.title.length <= 256 && identifier(value.sessionId)) p = value;
      } catch { /* fixed coverage reason, never malformed prose */ }
      if (!p) { gap('invalid-snapshot'); advance(id); continue; }
      r.work.inspectedItems += p.items.length;
      if (p.lifecycle !== 'active') { need(!pending, 'conflict'); advance(id); continue; }
      const tasks = p.items.filter(i => i.kind === 'task' && i.status === 'blocked');
      const pos = pending ?? { plan: id, revision, cleanup: generation, offset: 0 };
      need(!pending || pos.offset < tasks.length, 'conflict');
      while (pos.offset < tasks.length && r.rows.length < limit) {
        const item = tasks[pos.offset], annotation = blocker(item, revision);
        const primary = annotation.state === 'reported' && ['decision','review'].includes(annotation.annotation.category ?? '');
        const hit: NeedsYouRow = {
          source: request.source, plan: id, revision, structuralRevision: p.structuralRevision, cleanup: { state: 'visible', revision: generation },
          planTitle: p.title, coordinatorSessionId: p.sessionId, task: { id: item.id, title: item.title, kind: 'task', status: 'blocked' },
          ...context(p, item), group: primary ? 'needs-you' : 'also-blocked', blocker: annotation,
        };
        const size = Buffer.byteLength(JSON.stringify(hit)) + 1;
        // Reserve envelope/cursor plus optional timing per displayed row, before advancing.
        if (rowBytes + size > L.responseBytes - 16 * 1024 - limit * 128) break;
        rowBytes += size; r.rows.push(hit); c.counts[primary ? 'needsYou' : 'alsoBlocked']++; pos.offset++;
        if (request.timing) timingPlans.set(id, p);
      }
      if (pos.offset < tasks.length) { c.pending = pos; break; }
      advance(id);
    }
    r.coverage.complete = r.coverage.exhausted && !r.coverage.gapped;
    need(safe(c.counts.needsYou) && safe(c.counts.alsoBlocked) && safe(c.skipped));
    r.nextCursor = r.coverage.exhausted ? null : Buffer.from(JSON.stringify(c)).toString('base64url');
    need(r.nextCursor === null || Buffer.byteLength(r.nextCursor) <= L.cursorBytes);
    const budget: BlockedTimingBudget = { snapshotVisits: L.timingSnapshotVisits, inputBytes: L.timingInputBytes };
    for (const [id, p] of timingPlans) {
      const rows = r.rows.filter(row => row.plan === id);
      const timing = blockedTiming(store, {
        storeId: request.storeId,
        plan: { ...p, counts: countItems(p.items), working: p.items.filter(i => i.kind === 'task' && i.status === 'working').map(i => i.id), cleanup: rows[0].cleanup },
        items: { data: p.items, nextCursor: null },
      }, now, { budget, transaction: 'caller' });
      for (const row of rows) if (timing.items[row.task.id]) row.timing = { readAt: timing.readAt, ...timing.items[row.task.id] };
    }
    for (let i = 0; i < 3; i++) r.work.outputBytes = Buffer.byteLength(JSON.stringify(r));
    need(r.work.outputBytes <= L.responseBytes);
    db.exec('COMMIT');
    return r;
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}
