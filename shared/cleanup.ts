import { DatabaseSync } from 'node:sqlite';
import { randomUUID, createHash } from 'node:crypto';
import { openSync, closeSync, lstatSync, unlinkSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { identifier, ProgressError, requireProgress as need } from './progress.ts';

export type CleanupAction = 'archive' | 'restore' | 'delete';
export interface CleanupRequest { storeId:string; source:string; plan:string; rev:number; cleanupRev:number; oid:string; confirmed?:true }
export interface CleanupReceipt { storeId:string; source:string; plan:string; cleanup:{state:'visible'|'archived'|'deleted';revision:number}; oid:string }
const definitions: Record<string,string> = {
  cleanup_format: 'CREATE TABLE cleanup_format(singleton INTEGER PRIMARY KEY CHECK(singleton=1), version INTEGER NOT NULL CHECK(version=1))',
  cleanup_state: "CREATE TABLE cleanup_state(source TEXT NOT NULL, plan TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN('visible','archived','deleted')), generation INTEGER NOT NULL CHECK(generation>0), oid TEXT NOT NULL, request_hash TEXT NOT NULL, receipt TEXT NOT NULL CHECK(json_valid(receipt)), PRIMARY KEY(source,plan))",
};
for (const table of ['plans','chunks','captures','revisions','contributions','receipts']) {
  const key=table==='plans'?'id':'plan';
  for (const event of ['INSERT','UPDATE']) {
    const name=`cleanup_guard_${table}_${event.toLowerCase()}`;
    const predicate=(row:string)=>`EXISTS(SELECT 1 FROM cleanup_state WHERE source=${row}.source AND plan=${row}.${key} AND state IN('archived','deleted'))`;
    definitions[name]=`CREATE TRIGGER ${name} BEFORE ${event} ON ${table} WHEN ${predicate('NEW')}${event==='UPDATE'?` OR ${predicate('OLD')}`:''} BEGIN SELECT RAISE(ABORT, 'cleanup-closed'); END`;
  }
}
const normalized=(sql:string)=>sql.trim().replace(/\s+/g,' ');

/** Validate, never repair: persistent guards are part of the durable deletion contract. */
export function cleanupInstalled(db:DatabaseSync):boolean {
  need(Number(db.prepare('PRAGMA user_version').get()!.user_version)===2,'schema');
  const rows=db.prepare("SELECT name,sql FROM sqlite_master WHERE name GLOB 'cleanup_*'").all();
  if(!rows.length)return false;
  need(rows.length===Object.keys(definitions).length,'schema');
  for(const row of rows)need(typeof row.name==='string'&&definitions[row.name]!==undefined&&normalized(String(row.sql))===normalized(definitions[row.name]),'schema');
  const format=db.prepare('SELECT * FROM cleanup_format').all();
  need(format.length===1&&format[0].singleton===1&&format[0].version===1,'schema');
  return true;
}
export function cleanupState(db:DatabaseSync,source:string,plan:string) {
  return db.prepare('SELECT * FROM cleanup_state WHERE source=? AND plan=?').get(source,plan);
}
export function parseCleanup(action:CleanupAction,value:unknown):CleanupRequest {
  need(['archive','restore','delete'].includes(action));
  need(value&&typeof value==='object'&&!Array.isArray(value));
  const r=value as CleanupRequest;
  const fields=['storeId','source','plan','rev','cleanupRev','oid',...(action==='delete'?['confirmed']:[])];
  need(Object.keys(r).every(k=>fields.includes(k)));
  need(identifier(r.storeId)&&identifier(r.source)&&identifier(r.plan)&&identifier(r.oid));
  need(Number.isSafeInteger(r.rev)&&r.rev>0&&Number.isSafeInteger(r.cleanupRev)&&r.cleanupRev>=0&&r.cleanupRev<Number.MAX_SAFE_INTEGER);
  need(action!=='delete'||r.confirmed===true);
  return r;
}
function requestHash(action:CleanupAction,r:CleanupRequest) {
  return createHash('sha256').update(JSON.stringify([action,r.storeId,r.source,r.plan,r.rev,r.cleanupRev,r.oid,r.confirmed??false])).digest('hex');
}
/** Called in a read snapshot first, then again under BEGIN IMMEDIATE. */
function preflight(db:DatabaseSync,action:CleanupAction,r:CleanupRequest,installed:boolean):CleanupReceipt|undefined {
  need(db.prepare('SELECT store_id FROM meta WHERE singleton=1').get()?.store_id===r.storeId,'conflict');
  const state=installed?cleanupState(db,r.source,r.plan):undefined;
  if(state?.oid===r.oid){need(state.request_hash===requestHash(action,r),'operation-reused');return JSON.parse(String(state.receipt));}
  need((state?.generation??0)===r.cleanupRev,'conflict');
  const row=db.prepare('SELECT snapshot,revision FROM plans WHERE source=? AND id=?').get(r.source,r.plan);
  need(row&&state?.state!=='deleted','not-found');
  need(row.revision===r.rev,'conflict');
  let p;try{p=JSON.parse(String(row.snapshot));}catch{throw new ProgressError('corrupt');}
  need(p.id===r.plan&&p.sourceId===r.source&&p.revision===r.rev,'corrupt');
  need(p.lifecycle==='finished','closed');
  need(action==='restore'?state?.state==='archived':action==='delete'||!state||state.state==='visible','closed');
}

/** Consistent private recovery material, not a product undo or automatic restore. */
function backup(db:DatabaseSync,file:string) {
  const parent=path.dirname(file);const owned=lstatSync(parent);
  need(owned.isDirectory()&&!owned.isSymbolicLink()&&owned.uid===process.getuid?.()&&(owned.mode&0o777)===0o700&&realpathSync(parent)===parent,'binding');
  const destination=path.join(path.dirname(file),`cleanup-backup-${randomUUID()}.sqlite`);
  const fd=openSync(destination,'wx',0o600);closeSync(fd);
  let copy:DatabaseSync|undefined;
  try {
    db.prepare('VACUUM INTO ?').run(destination);
    const stat=lstatSync(destination);need(stat.isFile()&&!stat.isSymbolicLink()&&stat.uid===process.getuid?.()&&(stat.mode&0o777)===0o600,'binding');
    copy=new DatabaseSync(destination,{readOnly:true});
    need(copy.prepare('PRAGMA integrity_check').get()?.integrity_check==='ok'&&copy.prepare('PRAGMA foreign_key_check').all().length===0,'corrupt');
    need(copy.prepare('PRAGMA user_version').get()?.user_version===2&&copy.prepare('SELECT store_id FROM meta').get()?.store_id===db.prepare('SELECT store_id FROM meta').get()?.store_id,'corrupt');
  } catch(e){copy?.close();copy=undefined;unlinkSync(destination);throw e;} finally{copy?.close();}
}
export function mutateCleanup(db:DatabaseSync,file:string,action:CleanupAction,value:unknown,transaction:<T>(write:boolean,fn:()=>T)=>T):CleanupReceipt {
  const r=parseCleanup(action,value);
  const initial=transaction(false,()=>{const installed=cleanupInstalled(db);return {installed,replay:preflight(db,action,r,installed)};});
  if(initial.replay)return initial.replay;
  if(!initial.installed)backup(db,file);
  return transaction(true,()=>{
    const installed=cleanupInstalled(db);const replay=preflight(db,action,r,installed);if(replay)return replay;
    if(!installed){for(const sql of Object.values(definitions))db.exec(sql);db.exec('INSERT INTO cleanup_format VALUES(1,1)');}
    const receipt:CleanupReceipt={storeId:r.storeId,source:r.source,plan:r.plan,cleanup:{state:action==='archive'?'archived':action==='restore'?'visible':'deleted',revision:r.cleanupRev+1},oid:r.oid};
    db.prepare('INSERT INTO cleanup_state VALUES(?,?,?,?,?,?,?) ON CONFLICT(source,plan) DO UPDATE SET state=excluded.state,generation=excluded.generation,oid=excluded.oid,request_hash=excluded.request_hash,receipt=excluded.receipt').run(r.source,r.plan,receipt.cleanup.state,receipt.cleanup.revision,r.oid,requestHash(action,r),JSON.stringify(receipt));
    if(action==='delete')for(const table of ['contributions','revisions','captures','chunks','receipts','plans'])db.prepare(`DELETE FROM ${table} WHERE source=? AND ${table==='plans'?'id':'plan'}=?`).run(r.source,r.plan);
    return receipt;
  });
}
