import type { DatabaseSync } from 'node:sqlite';
import { requireProgress as need } from './progress.ts';

// Physical optimization only: base schema/protocol 2 and receipt bytes stay intact.
// Deliberately outside the exact runs_* and cleanup_* extension namespaces.
const name = 'receipts_source_oid';

/** Absence is supported for legacy/read-only stores. Never repair a foreign name. */
export function receiptIndexInstalled(db: DatabaseSync): boolean {
  const objects = db.prepare('SELECT type,name,tbl_name FROM main.sqlite_master WHERE name=? COLLATE NOCASE').all(name);
  if (!objects.length) return false;
  need(objects.length === 1 && objects[0]!.type === 'index' && objects[0]!.name === name && objects[0]!.tbl_name === 'receipts', 'schema');
  const index = db.prepare("PRAGMA main.index_list('receipts')").all().find(r => r.name === name);
  need(index?.unique === 0 && index.partial === 0 && index.origin === 'c', 'schema');
  const keys = db.prepare("PRAGMA main.index_xinfo('receipts_source_oid')").all().filter(r => r.key === 1);
  need(keys.length === 2 && keys.every((key, i) => key.seqno === i && Number(key.cid) >= 0 && key.name === ['source', 'oid'][i] && key.desc === 0 && key.coll === 'BINARY'), 'schema');
  return true;
}

/** Caller owns BEGIN IMMEDIATE: creation and activation roll back as one unit. */
export function installReceiptIndex(db: DatabaseSync): void {
  if (receiptIndexInstalled(db)) return;
  db.exec('CREATE INDEX receipts_source_oid ON receipts(source, oid)');
  receiptIndexInstalled(db);
}
