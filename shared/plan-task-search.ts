import type { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { cleanupInstalled, cleanupState } from './cleanup.ts';
import { validateDigestSnapshot } from './change-digest.ts';
import { SEARCH_LIMITS as L, identifier, requireProgress as need, countItems, type PlanState, type SearchOptions, type SearchIdentity, type SearchWindow, type SearchHit, type SearchKey, type SearchState, type SearchGap } from './progress.ts';

const normalize = (s: string) => s.normalize('NFC').toLowerCase().normalize('NFC');
export function searchTokens(q: string): string[] {
  need(typeof q === 'string' && Array.from(q).length <= L.queryPoints && !q.includes('\0'));
  const tokens = normalize(q).trim().split(/\s+/u).filter(Boolean); need(tokens.length <= L.tokens); return tokens;
}
export function searchMatches(tokens: string[], title: string, id: string): boolean {
  const t = normalize(title), key = normalize(id); return tokens.every(word => t.includes(word) || key.includes(word));
}
const safe = (n: unknown, min = 0): n is number => Number.isSafeInteger(n) && Number(n) >= min;
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
interface Position { source: string; plan: string; revision: number; cleanup: number; member: number; offset: number; counted: boolean; phase: 'membership' | 'hits' }
interface Cursor { v: 1; identity: string; fingerprint: string; after: SearchKey | null; pending: Position | null; gapped: boolean }
const fields = (v: object, keys: string[]) => Object.keys(v).length === keys.length && Object.keys(v).every(k => keys.includes(k));
function parseCursor(text: string): Cursor {
  need(typeof text === 'string' && Buffer.byteLength(text) <= L.cursorBytes && /^[A-Za-z0-9_-]+$/.test(text));
  let c: Cursor; try { c = JSON.parse(Buffer.from(text, 'base64url').toString('utf8')); } catch { need(false); }
  need(c! && fields(c!, ['v','identity','fingerprint','after','pending','gapped']) && c!.v === 1 && typeof c!.identity === 'string' && /^[a-f0-9]{64}$/.test(c!.identity) && typeof c!.fingerprint === 'string' && /^[a-f0-9]{64}$/.test(c!.fingerprint) && typeof c!.gapped === 'boolean');
  const key = (v: SearchKey) => v && fields(v, ['source','plan']) && identifier(v.source) && identifier(v.plan);
  need(c!.after === null || key(c!.after));
  const p = c!.pending;
  need(p === null || p && fields(p, ['source','plan','revision','cleanup','member','offset','counted','phase']) && identifier(p.source) && identifier(p.plan) && safe(p.revision, 1) && safe(p.cleanup) && safe(p.member) && p.member <= p.revision && safe(p.offset) && p.offset <= 1000 && typeof p.counted === 'boolean' && typeof p.phase === 'string' && ['membership','hits'].includes(p.phase) && (p.phase !== 'membership' || p.offset === 0 && !p.counted));
  return c!;
}
export function searchIdentity(db: DatabaseSync, binding: SearchIdentity['sourceBinding']): SearchIdentity {
  return { protocolVersion: 2, schemaVersion: 2, planTaskSearch: 1, storeId: String(db.prepare('SELECT store_id FROM meta WHERE singleton=1').get()!.store_id), sourceBinding: { ...binding } };
}
function cleanup(db: DatabaseSync, installed: boolean, source: string, plan: string) {
  const c = installed ? cleanupState(db, source, plan) : undefined;
  return { state: (c?.state ?? 'visible') as 'visible' | 'archived' | 'deleted', revision: Number(c?.generation ?? 0) };
}
function validPlan(value: unknown, source: string, id: string, revision: number): PlanState | null {
  const p = value as PlanState;
  if (!validateDigestSnapshot(value, source, id, revision) || typeof p.title !== 'string' || !p.title.trim() || p.title.length > 256 || !identifier(p.sessionId) || typeof p.directory !== 'string' || p.directory.length > 4096 || p.directory.includes('\0') || p.projectId !== undefined && (typeof p.projectId !== 'string' || p.projectId.length > 4096) || !Array.isArray(p.links) || p.links.length > 64 || p.links.some(l => !l || !identifier(l.sessionId) || !Array.isArray(l.itemIds) || l.itemIds.length > 1000 || !l.itemIds.every(identifier))) return null;
  return p;
}
function context(p: PlanState, item: PlanState['items'][number]) {
  const byId = new Map(p.items.map(i => [i.id, i])); const ancestors: { id: string; title: string }[] = [];
  let parent = item.parentId;
  while (parent) { const a = byId.get(parent)!; ancestors.unshift({ id: a.id, title: a.title }); parent = a.parentId; }
  const omittedAncestors = Math.max(0, ancestors.length - L.ancestors);
  return { ancestors: omittedAncestors ? [ancestors[0], ...ancestors.slice(-(L.ancestors - 1))] : ancestors, omittedAncestors };
}

/** Caller owns one read transaction. All expensive predicates follow raw keyset selection. */
export function searchWindow(db: DatabaseSync, binding: SearchIdentity['sourceBinding'], options: SearchOptions = {}): SearchWindow {
  need(Object.keys(options).every(k => ['q','source','session','lifecycle','status','archived','limit','cursor'].includes(k)));
  const tokens = searchTokens(options.q ?? ''), limit = options.limit ?? 20, archived = options.archived ?? 'exclude';
  need(Number.isInteger(limit) && limit > 0 && limit <= L.hits && ['exclude','only'].includes(archived));
  for (const key of ['source','session'] as const) need(options[key] === undefined || identifier(options[key]));
  need(options.lifecycle === undefined || ['active','finished','cancelled','failed'].includes(options.lifecycle));
  need(options.status === undefined || ['pending','working','blocked','done','skipped'].includes(options.status));
  const identity = searchIdentity(db, binding), identityHash = hash(identity), fingerprint = hash([options.q ?? '', options.source ?? null, options.session ?? null, options.lifecycle ?? null, options.status ?? null, archived, limit]);
  const c: Cursor = options.cursor === undefined ? { v: 1, identity: identityHash, fingerprint, after: null, pending: null, gapped: false } : parseCursor(options.cursor);
  need(c.identity === identityHash && c.fingerprint === fingerprint, 'conflict');
  need(!options.source || (!c.after || c.after.source === options.source) && (!c.pending || c.pending.source === options.source));
  const installed = cleanupInstalled(db);
  const r: SearchWindow = { ...identity, fingerprint, hits: [], counts: { matchedPlans: 0, matchingTasks: 0 }, nextCursor: null, exhausted: false, coverage: { kind: 'recorded-current', asSearched: true, gapped: c.gapped, skippedRecords: 0, reasons: [] }, work: { planSlots: 0, inspectedItems: 0, membershipRows: 0, inputBytes: 0, outputHits: 0, outputBytes: 0 } };
  const gap = (reason: SearchGap) => { c.gapped = r.coverage.gapped = true; r.coverage.skippedRecords++; if (!r.coverage.reasons.includes(reason)) r.coverage.reasons.push(reason); };
  const advance = (source: string, plan: string) => { c.after = { source, plan }; c.pending = null; };
  // Reserve bounded envelope/cursor space before accepting a hit. No hit is trimmed after advancing.
  let hitBytes = 0;
  while (r.work.planSlots < L.plans && r.hits.length < limit) {
    const pending = c.pending;
    const row = pending ? db.prepare('SELECT source,id,revision,length(CAST(snapshot AS BLOB)) AS bytes FROM plans WHERE source=? AND id=?').get(pending.source, pending.plan) : options.source ? db.prepare('SELECT source,id,revision,length(CAST(snapshot AS BLOB)) AS bytes FROM plans WHERE source=? AND id>? ORDER BY id LIMIT 1').get(options.source, c.after?.plan ?? '') : db.prepare('SELECT source,id,revision,length(CAST(snapshot AS BLOB)) AS bytes FROM plans WHERE (source,id)>(?,?) ORDER BY source,id LIMIT 1').get(c.after?.source ?? '', c.after?.plan ?? '');
    r.work.planSlots++;
    if (!row) { need(!pending, 'conflict'); r.exhausted = true; break; }
    const source = String(row.source), id = String(row.id), revision = Number(row.revision), state = cleanup(db, installed, source, id);
    if (pending) need(pending.revision === revision && pending.cleanup === state.revision && state.state !== 'deleted', 'conflict');
    // Corrupt address keys cannot safely become a bounded continuation token.
    need(identifier(source) && identifier(id), 'corrupt');
    if (!safe(revision, 1)) { gap('invalid-snapshot'); advance(source, id); continue; }
    if (state.state === 'deleted' || (state.state === 'archived') !== (archived === 'only')) { advance(source, id); continue; }
    const bytes = Number(row.bytes);
    if (bytes > L.inputBytes) { gap('oversized-snapshot'); advance(source, id); continue; }
    if (r.work.inputBytes + bytes > L.inputBytes) break;
    const text = db.prepare('SELECT snapshot FROM plans WHERE source=? AND id=?').get(source, id)!.snapshot;
    r.work.inputBytes += bytes;
    let p: PlanState | null = null; try { p = validPlan(JSON.parse(String(text)), source, id, revision); } catch { /* fixed coverage reason */ }
    if (!p) { gap('invalid-snapshot'); advance(source, id); continue; }
    r.work.inspectedItems += p.items.length;
    if (options.lifecycle && options.lifecycle !== p.lifecycle) { advance(source, id); continue; }
    const pos: Position = pending ?? { source, plan: id, revision, cleanup: state.revision, member: 0, offset: 0, counted: false, phase: 'membership' };
    if (options.session && pos.phase === 'membership' && p.sessionId !== options.session && !p.links.some(l => l.sessionId === options.session)) {
      let member = false, finished = false, invalid = false;
      while (r.work.membershipRows < L.membershipRows) {
        const m = db.prepare('SELECT revision,length(CAST(payload AS BLOB)) AS bytes FROM contributions WHERE source=? AND plan=? AND revision>? AND revision<=? ORDER BY revision LIMIT 1').get(source, id, pos.member, revision);
        if (!m) { finished = true; break; }
        r.work.membershipRows++;
        const size = Number(m.bytes);
        if (size + bytes > L.inputBytes) { gap('oversized-membership'); invalid = true; break; }
        if (r.work.inputBytes + size > L.inputBytes) break;
        const payload = db.prepare('SELECT payload FROM contributions WHERE source=? AND plan=? AND revision=?').get(source, id, m.revision!)!.payload;
        r.work.inputBytes += size;
        let v; try { v = JSON.parse(String(payload)); } catch { /* classified below */ }
        if (!v || v.revision !== m.revision || !identifier(v.attributedSessionId)) { gap('invalid-membership'); invalid = true; break; }
        pos.member = Number(m.revision);
        if (v.attributedSessionId === options.session) { member = true; break; }
      }
      if (invalid || finished && !member) { advance(source, id); continue; }
      if (!member) { c.pending = pos; break; }
    }
    pos.phase = 'hits';
    const planMatched = searchMatches(tokens, p.title, p.id);
    const matches = p.items.filter(i => i.kind === 'task' && (!options.status || i.status === options.status) && searchMatches(tokens, i.title, i.id));
    if (!matches.length && (!planMatched || options.status)) { advance(source, id); continue; }
    const tasks = matches.length ? matches : [null];
    const sourceVerified = Boolean(db.prepare('SELECT verified FROM sources WHERE id=?').get(source)?.verified);
    const plan: SearchHit['plan'] = { id, sourceId: source, title: p.title, sessionId: p.sessionId, revision, structuralRevision: p.structuralRevision, lifecycle: p.lifecycle, reportedAt: p.reportedAt, directory: p.directory, ...(p.projectId === undefined ? {} : { projectId: p.projectId }), counts: countItems(p.items), cleanup: state as SearchHit['plan']['cleanup'], sourceVerified };
    need(pos.offset < tasks.length);
    while (pos.offset < tasks.length && r.hits.length < limit) {
      const task = tasks[pos.offset];
      const hit: SearchHit = { plan, planMatched, task: task ? { id: task.id, title: task.title, status: task.status } : null, ...(task ? context(p, task) : { ancestors: [], omittedAncestors: 0 }), continued: pos.counted, classified: pos.counted ? null : { matchedPlans: 1, matchingTasks: matches.length } };
      const size = Buffer.byteLength(JSON.stringify(hit)) + 1;
      if (hitBytes + size > L.responseBytes - 16 * 1024) break;
      if (!pos.counted) { r.counts.matchedPlans++; r.counts.matchingTasks += matches.length; pos.counted = true; }
      hitBytes += size; r.hits.push(hit); pos.offset++;
    }
    if (pos.offset < tasks.length) { c.pending = pos; break; }
    advance(source, id);
  }
  r.nextCursor = r.exhausted ? null : Buffer.from(JSON.stringify(c)).toString('base64url');
  need(r.nextCursor === null || Buffer.byteLength(r.nextCursor) <= L.cursorBytes);
  r.work.outputHits = r.hits.length;
  // Include the work counter's own final encoded width.
  for (let n = 0; n < 3; n++) r.work.outputBytes = Buffer.byteLength(JSON.stringify(r));
  need(r.work.outputBytes <= L.responseBytes);
  return r;
}

export function searchState(db: DatabaseSync, binding: SearchIdentity['sourceBinding'], storeId: string, keys: SearchKey[]): SearchState {
  need(identifier(storeId) && Array.isArray(keys) && keys.length > 0 && keys.length <= L.stateKeys && keys.every(k => k && fields(k, ['source','plan']) && identifier(k.source) && identifier(k.plan)));
  need(new Set(keys.map(k => JSON.stringify([k.source,k.plan]))).size === keys.length);
  const identity = searchIdentity(db, binding); need(identity.storeId === storeId, 'conflict');
  const installed = cleanupInstalled(db);
  return { ...identity, data: keys.map(k => {
    const row = db.prepare('SELECT revision FROM plans WHERE source=? AND id=?').get(k.source, k.plan), state = cleanup(db, installed, k.source, k.plan);
    need(!row || safe(row.revision, 1), 'corrupt');
    return { ...k, exists: !!row && state.state !== 'deleted', revision: row ? Number(row.revision) : null, cleanup: state };
  }) };
}
