import { openProbeStore, report } from '../../shared/probe-store.ts';
const [file, mode, id] = process.argv.slice(2);
const db = openProbeStore(file);
if (mode === 'hold') {
  db.exec('BEGIN IMMEDIATE');
  db.prepare('INSERT INTO reports VALUES(100,?,?)').run('uncommitted', 'never acknowledge');
  process.send?.('locked');
  setInterval(() => {}, 1000);
} else {
  try { process.send?.({ ok: true, ...report(db, id, 0, 'worker') }); }
  catch (e) { process.send?.({ ok: false, error: String(e) }); }
  db.close();
}
