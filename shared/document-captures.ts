import type { DatabaseSync } from 'node:sqlite';
import { cleanupInstalled, cleanupState } from './cleanup.ts';
import { identifier, requireProgress as need } from './progress.ts';
import { CAPTURE_LIMITS as L, compareCaptureText, type CaptureBinding, type CaptureRequest, type CaptureIdentity, type CaptureEntry, type CaptureCurrent, type CaptureIndex, type CaptureComparison } from './document-comparison.ts';

const integer = (v: unknown, min = 0): v is number => Number.isSafeInteger(v) && Number(v) >= min;
const same = (a: CaptureBinding, b: CaptureBinding) => a.sourceId === b.sourceId && a.verified === b.verified;
export function parseCaptureBinding(value: string | null): CaptureBinding {
  need(value && Buffer.byteLength(value) <= 256);
  let v: CaptureBinding; try { v = JSON.parse(value!); } catch { need(false); }
  need(v! && typeof v === 'object' && Object.keys(v).length === 2 && (v.sourceId === null || identifier(v.sourceId)) && typeof v.verified === 'boolean');
  return { sourceId: v.sourceId, verified: v.verified };
}
const validTime = (v: unknown): v is string => typeof v === 'string' && v.length <= 40 && Number.isFinite(Date.parse(v));
function head(db: DatabaseSync, binding: CaptureBinding, r: CaptureRequest): { identity: CaptureIdentity; current: CaptureCurrent } {
  need(identifier(r.storeId) && identifier(r.source) && identifier(r.plan) && integer(r.cleanupRev));
  need(r.binding && same(binding, r.binding), 'conflict');
  const meta = db.prepare('SELECT CASE WHEN length(store_id)<=80 THEN store_id END AS store_id,enabled FROM meta WHERE singleton=1').get()!;
  need(meta.store_id === r.storeId, 'conflict');
  // Admission precedes JSON parsing in SQLite; only a bounded document reaches JS.
  const row = db.prepare(`SELECT revision, length(CAST(snapshot AS BLOB)) AS bytes,
    CASE WHEN length(CAST(snapshot AS BLOB))<=? AND json_type(snapshot,'$.id')='text' THEN substr(json_extract(snapshot,'$.id'),1,81) END AS snapshot_id,
    CASE WHEN length(CAST(snapshot AS BLOB))<=? AND json_type(snapshot,'$.sourceId')='text' THEN substr(json_extract(snapshot,'$.sourceId'),1,81) END AS snapshot_source,
    CASE WHEN length(CAST(snapshot AS BLOB))<=? AND json_type(snapshot,'$.revision')='integer' THEN json_extract(snapshot,'$.revision') END AS snapshot_revision,
    CASE WHEN length(CAST(snapshot AS BLOB))<=? THEN
      CASE WHEN length(CAST(json_extract(snapshot,'$.document') AS BLOB))<=32768 THEN json_extract(snapshot,'$.document') END
    END AS document FROM plans WHERE source=? AND id=?`).get(L.snapshotBytes, L.snapshotBytes, L.snapshotBytes, L.snapshotBytes, r.source, r.plan);
  need(row, 'not-found'); need(integer(row.revision, 1) && Number(row.bytes) <= L.snapshotBytes, 'corrupt');
  need(row.snapshot_id === r.plan && row.snapshot_source === r.source && row.snapshot_revision === row.revision, 'corrupt');
  const cleanup = (cleanupInstalled(db) ? cleanupState(db, r.source, r.plan) : undefined) ?? { generation: 0, state: 'visible' };
  need(Number(cleanup.generation) === r.cleanupRev && cleanup.state !== 'deleted', 'conflict');
  need(typeof row.document === 'string', 'corrupt');
  let doc: Record<string, unknown>; try { doc = JSON.parse(row.document); } catch { need(false, 'corrupt'); }
  need(doc! && typeof doc === 'object' && !Array.isArray(doc) && ['unbound','captured','denied','missing','moved','oversized','non-text','unavailable','changed-during-read'].includes(String(doc.state)) && typeof doc.checklistSynchronized === 'boolean', 'corrupt');
  for (const key of ['path','canonicalPath']) need(doc[key] === undefined || typeof doc[key] === 'string' && doc[key].length <= 4096, 'corrupt');
  need(doc.captureId === undefined || integer(doc.captureId, 1), 'corrupt');
  need(doc.checkedAt === undefined || validTime(doc.checkedAt), 'corrupt');
  return {
    identity: { ...r, binding: { ...binding }, protocolVersion: 2, schemaVersion: 2, documentCaptureComparison: 1, sourceBinding: { ...binding } },
    current: { revision: Number(row.revision), captureId: doc.captureId as number ?? null, state: String(doc.state), checklistSynchronized: doc.checklistSynchronized, checkedAt: doc.checkedAt as string ?? null, path: doc.path as string ?? null, currentFile: 'not-rechecked', captureEnabled: Boolean(meta.enabled) },
  };
}
// Oversize values become NULL before driver materialization. Discovery never selects bodies.
const projection = `id, revision,
 CASE WHEN length(CAST(source AS BLOB))<=80 THEN source END AS source,
 CASE WHEN length(CAST(plan AS BLOB))<=80 THEN plan END AS plan,
 CASE WHEN length(CAST(hash AS BLOB))=64 THEN hash END AS hash,
 CASE WHEN length(CAST(captured_at AS BLOB))<=40 THEN captured_at END AS captured_at,
 CASE WHEN length(CAST(canonical_path AS BLOB))<=16384 THEN substr(canonical_path,1,4097) END AS canonical_path`;
function entry(row: Record<string, unknown>): CaptureEntry {
  need(integer(row.id, 1) && integer(row.revision, 1) && identifier(row.source) && identifier(row.plan) && typeof row.hash === 'string' && /^[a-f0-9]{64}$/.test(row.hash) && validTime(row.captured_at) && typeof row.canonical_path === 'string' && row.canonical_path.length <= 4096 && !row.canonical_path.includes('\0'), 'corrupt');
  return { id: row.id, revision: row.revision, hash: row.hash, capturedAt: row.captured_at, path: row.canonical_path };
}
interface Cursor { identity: CaptureRequest; ceiling: number; revision: number; before: number }
function decodeCursor(raw: string, r: CaptureRequest): Cursor {
  need(Buffer.byteLength(raw) <= L.cursorBytes && /^[A-Za-z0-9_-]+$/.test(raw));
  let c: Cursor; try { c = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')); } catch { need(false); }
  need(c! && typeof c === 'object' && Object.keys(c).length === 4 && integer(c.ceiling) && c.ceiling < Number.MAX_SAFE_INTEGER && integer(c.revision, 1) && integer(c.before, 1) && c.before <= c.ceiling + 1);
  const i = c.identity; need(i && i.storeId === r.storeId && i.source === r.source && i.plan === r.plan && i.cleanupRev === r.cleanupRev && i.binding && same(i.binding, r.binding), 'conflict');
  return { identity: r, ceiling: c.ceiling, revision: c.revision, before: c.before };
}
export function captureIndex(db: DatabaseSync, binding: CaptureBinding, r: CaptureRequest, cursor?: string): CaptureIndex {
  const h = head(db, binding, r);
  const max = Number(db.prepare('SELECT coalesce(max(id),0) AS id FROM captures').get()!.id);
  need(integer(max) && max < Number.MAX_SAFE_INTEGER, 'corrupt');
  const c = cursor !== undefined ? decodeCursor(cursor, r) : { identity: r, ceiling: max, revision: h.current.revision, before: max + 1 };
  need(c.revision <= h.current.revision, 'conflict');
  const rows = db.prepare(`SELECT ${projection} FROM captures WHERE id<? AND id<=? ORDER BY id DESC LIMIT ?`).all(c.before, c.ceiling, L.rows);
  const out: CaptureIndex = { ...h.identity, data: [], nextCursor: null, exhausted: false, scanned: 0, revision: c.revision, limit: null };
  let before = c.before;
  for (const row of rows) {
    const e = entry(row); // Fail the whole window, including malformed unrelated metadata.
    const qualifies = row.source === r.source && row.plan === r.plan && e.revision <= c.revision;
    if (qualifies) {
      if (out.data.length === L.entries) { out.limit = 'entries'; break; }
      if (Buffer.byteLength(JSON.stringify({ ...out, data: [...out.data, e] })) > L.responseBytes - L.cursorBytes - 1024) { out.limit = 'bytes'; break; }
      out.data.push(e);
    }
    before = e.id; out.scanned++;
  }
  out.exhausted = out.scanned === rows.length && rows.length < L.rows;
  if (!out.exhausted) { out.limit ??= 'rows'; out.nextCursor = Buffer.from(JSON.stringify({ ...c, before })).toString('base64url'); }
  need(Buffer.byteLength(JSON.stringify(out)) <= L.responseBytes, 'corrupt');
  return out;
}
export function captureComparison(db: DatabaseSync, binding: CaptureBinding, r: CaptureRequest, before: number, after: number): CaptureComparison {
  need(integer(before, 1) && integer(after, 1) && before <= after);
  const h = head(db, binding, r);
  const read = (id: number) => {
    const row = db.prepare(`SELECT ${projection},length(CAST(text AS BLOB)) AS bytes FROM captures WHERE id=? AND source=? AND plan=?`).get(id, r.source, r.plan);
    need(row, 'not-found'); return { entry: entry(row), bytes: Number(row.bytes) };
  };
  const a = read(before), b = before === after ? a : read(after);
  const out: CaptureComparison = { ...h.identity, before: a.entry, after: b.entry, current: h.current, result: { state: 'limited', reason: 'bytes' } };
  if (a.bytes <= L.documentBytes && b.bytes <= L.documentBytes && a.bytes >= 0 && b.bytes >= 0) {
    const body = (id: number) => String(db.prepare('SELECT text FROM captures WHERE id=?').get(id)!.text);
    const text = body(before); out.result = compareCaptureText(text, before === after ? text : body(after));
  }
  if (Buffer.byteLength(JSON.stringify(out)) > L.responseBytes) out.result = { state: 'limited', reason: 'output' };
  need(Buffer.byteLength(JSON.stringify(out)) <= L.responseBytes, 'corrupt');
  return out;
}
