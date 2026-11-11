import type { DatabaseSync } from 'node:sqlite';

// Frozen format-1 DDL, independent of the production format-2 definitions.
const format='CREATE TABLE runs_format(singleton INTEGER PRIMARY KEY CHECK(singleton=1), version INTEGER NOT NULL CHECK(version=1), revision INTEGER NOT NULL, generation INTEGER NOT NULL, loss INTEGER NOT NULL CHECK(loss IN(0,1)))';
const capture=`CREATE TRIGGER runs_capture_epoch AFTER UPDATE OF enabled ON meta WHEN NEW.enabled != OLD.enabled BEGIN UPDATE runs_format SET generation=generation+1,revision=revision+1 WHERE singleton=1; UPDATE runs_observation_epoch SET invalid_through=epoch,epoch=epoch+1 WHERE singleton=1; UPDATE runs_jobs SET state='failed',claim=NULL,token=lower(hex(randomblob(16))),reason='capture-disabled' WHERE state IN('pending','running'); DELETE FROM runs_candidates; UPDATE receipts SET receipt=json_set(receipt,'$.delegation.state','retired','$.delegation.reason','capture-disabled') WHERE EXISTS(SELECT 1 FROM runs_intents i WHERE i.source=receipts.source AND i.plan=receipts.plan AND i.oid=receipts.oid); DELETE FROM runs_intents; END`;

/** Test-only construction of the genuine predecessor, never a production downgrade. */
export function versionOneFixture(db:DatabaseSync,epochless=false,loss?:0|1) {
  const f=db.prepare('SELECT revision,generation,loss FROM runs_format').get()!;
  db.exec('BEGIN IMMEDIATE');
  try{
    db.exec('DROP TRIGGER runs_capture_epoch; DROP TABLE runs_format');db.exec(format);
    db.prepare('INSERT INTO runs_format VALUES(1,1,?,?,?)').run(f.revision!,f.generation!,loss??f.loss!);
    if(epochless)db.exec('DROP TABLE runs_observation_epoch');
    db.exec(epochless?capture.replace(' UPDATE runs_observation_epoch SET invalid_through=epoch,epoch=epoch+1 WHERE singleton=1;',''):capture);
    db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}
}

/** Schema and all durable values, excluding SQLite's internal bookkeeping. */
export function durableSnapshot(db:DatabaseSync) {
  const schema=db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all();
  const data=Object.fromEntries(schema.filter(r=>r.type==='table').map(r=>[String(r.name),db.prepare(`SELECT * FROM "${String(r.name).replaceAll('"','""')}"`).all()]));
  return {schema,data};
}
