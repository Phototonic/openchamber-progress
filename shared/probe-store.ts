import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { plans } from '../tests/fixtures/plans.ts';
import type { ProbeRead } from './contract.ts';

/** Deliberately tiny crash/concurrency affordance, NOT the T3 storage engine. */
export function openProbeStore(file: string) {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(file);
  chmodSync(file, 0o600);
  db.exec('PRAGMA busy_timeout=1000');
  const version = Number(db.prepare('PRAGMA user_version').get()?.user_version);
  if (version !== 0 && version !== 1) { db.close(); throw new Error('unsupported-schema'); }
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec('CREATE TABLE IF NOT EXISTS identity (singleton INTEGER PRIMARY KEY CHECK(singleton=1), store_id TEXT NOT NULL, source_id TEXT NOT NULL); CREATE TABLE IF NOT EXISTS reports (revision INTEGER PRIMARY KEY, operation_id TEXT UNIQUE NOT NULL, payload TEXT NOT NULL); PRAGMA user_version=1');
    db.prepare('INSERT OR IGNORE INTO identity VALUES(1,?,?)').run(randomUUID(), randomUUID());
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); db.close(); throw e; }
  return db;
}
export function snapshot(db: DatabaseSync): ProbeRead {
  const id = db.prepare('SELECT * FROM identity WHERE singleton=1').get()!;
  return { protocolVersion: 1, schemaVersion: 1, storeId: String(id.store_id), sourceId: String(id.source_id),
    sourceBinding: 'unverified-explicit-probe', coverage: 'fixture-only', plans: plans(), nextCursor: null,
    diagnostics: ['Compatibility fixture, not captured live progress.', 'Source scope, assignment and live coverage are not verified.'] };
}
export function report(db: DatabaseSync, operationId: string, expected: number, payload: string) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const prior = db.prepare('SELECT * FROM reports WHERE operation_id=?').get(operationId);
    if (prior) {
      if (prior.payload !== payload) throw new Error('operation-reused');
      db.exec('COMMIT'); return { revision: Number(prior.revision), replay: true };
    }
    const rev = Number(db.prepare('SELECT COALESCE(MAX(revision),0) AS n FROM reports').get()!.n);
    if (rev !== expected) throw new Error(`conflict:${rev}`);
    db.prepare('INSERT INTO reports VALUES(?,?,?)').run(rev + 1, operationId, payload);
    db.exec('COMMIT'); return { revision: rev + 1, replay: false };
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}
