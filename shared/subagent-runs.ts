import type { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { identifier, requireProgress as need, type Actor, type Request, type HandoffRequest, type Receipt } from './progress.ts';
import { cleanupInstalled, cleanupState } from './cleanup.ts';

/** Sub-agent runs revision 1. Neither a run nor a claim is task-report authority. */
export const RUN_LIMITS = Object.freeze({ parent:1024, total:16384, candidates:256, candidateAdoptionMs:300000, jobs:64, claims:256, intents:128, page:50, dtoBytes:4096, responseBytes:262144, queryBytes:16384, cursorBytes:4096, traversal:2000, depth:32, calls:64, elapsedMs:10000 });
export type RunBinding = { sourceId:string|null; verified:boolean };
export type RunState = 'unknown'|'running'|'succeeded'|'failed'|'interrupted';
export type RunReason = 'user'|'shutdown'|'superseded'|'inactivity'|'unknown';
export interface RunRequest { storeId:string; binding:RunBinding; source:string; root:string; plan?:string; cleanupRev?:number; view?:'useful'|'history'; cursor?:string }
export interface ReconcileRequest { storeId:string; binding:RunBinding; source:string; root:string; token?:string }
/** JSON.parse alone silently accepts duplicate keys, including escaped spellings. */
export function parseReconcileBody(text:string):ReconcileRequest {
  let value:ReconcileRequest;try{value=JSON.parse(text);}catch{need(false);}
  const stack:Array<Set<string>>=[];
  for(let i=0;i<text.length;i++) {
    const ch=text[i];
    if(ch==='{')stack.push(new Set());
    else if(ch==='}')stack.pop();
    else if(ch==='"') {
      const start=i++;for(;i<text.length;i++){if(text[i]==='\\'){i++;continue;}if(text[i]==='"')break;}
      let next=i+1;while(/\s/.test(text[next]??'')&&next<text.length)next++;
      if(text[next]===':'){const key=JSON.parse(text.slice(start,i+1)) as string;const keys=stack.at(-1);need(keys&&!keys.has(key));keys.add(key);}
    }
  }
  need(obj(value!)&&Object.keys(value).every(k=>['storeId','binding','source','root','token'].includes(k)));
  return value;
}
export interface RunRow {
  id:string; kind:'dispatch'|'historical-session'; source:string; parentSessionId:string; childSessionId:string|null;
  tool:'subagent'|'task'|null; agent:string|null; description:string|null;
  dispatch:{ messageId:string; callId:string; at:number }|null;
  planContext:{ plan:string; revision:number; observedAt:number }|null;
  ran:{ state:RunState; dispatchState:'pending'|'returned'|'failed-unconfirmed'|'unconfirmed'|'historical'; startedAt:number|null; endedAt:number|null; updatedAt:number; provenance:'dispatch'|'native-event'|'native-session'; eventId:string|null; sequence:number|null; errorType:string|null; interruptionReason:RunReason|null };
  claimed:{ oid:string; outcome:'done'|'partial'|'blocked'; summary:string; reportedAt:number; sessionId:string; association:'execution'|'session-only' }|null;
  accepted:{ plan:string; revision:number; items:Array<{id:string; status:'pending'|'working'|'blocked'|'done'|'skipped'}>; omittedItems:number }|null;
}
export type RecoveryState = 'not-requested'|'pending'|'running'|'complete'|'partial'|'failed'|'unavailable';
export interface RunRead {
  protocolVersion:2; schemaVersion:2; storeId:string; sourceBinding:RunBinding; source:string; root:string;
  plan:string|null; cleanupRev:number|null; view:'useful'|'history'; subagentRuns:1|null; runFormat:1|null;
  availability:'ready'|'unavailable'; readAt:number; revision:number;
  capture:{ enabled:boolean; state:'last-known'|'unavailable'; loss:boolean };
  recovery:{ state:RecoveryState; reason:'budget'|'capture-disabled'|'capture-unavailable'|null; token:string|null };
  counts:{ children:number; runs:number; historicalSessions:number; running:number; succeeded:number; failed:number; interrupted:number; unknown:number };
  coverage:{ scope:'retained'; complete:boolean; reasons:Array<'legacy-unavailable'|'history-not-reconciled'|'partial-history'|'capture-loss'|'traversal-limit'> };
  data:RunRow[]; nextCursor:string|null;
}
export interface DispatchKey { source:string; parent:string; message:string; call:string }
export interface ExecutionObservation { source:string; child:string; id:string; sequence:number; at:number; state:Exclude<RunState,'unknown'>; errorType:string|null; interruptionReason:RunReason|null }
interface Candidate { start:ExecutionObservation|null; end:ExecutionObservation|null; ambiguous?:boolean }
export interface RecoveryJob { source:string; root:string; generation:number; claim:string; requestId:string }

const definitions:Record<string,string> = {
  runs_format:'CREATE TABLE runs_format(singleton INTEGER PRIMARY KEY CHECK(singleton=1), version INTEGER NOT NULL CHECK(version=1), revision INTEGER NOT NULL, generation INTEGER NOT NULL, loss INTEGER NOT NULL CHECK(loss IN(0,1)))',
  runs_rows:"CREATE TABLE runs_rows(id TEXT PRIMARY KEY, source TEXT NOT NULL, parent TEXT NOT NULL, child TEXT, message TEXT, call TEXT, generation INTEGER NOT NULL, terminal INTEGER NOT NULL CHECK(terminal IN(0,1)), at INTEGER NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload) AND length(CAST(payload AS BLOB))<=4096), UNIQUE(source,parent,message,call))",
  runs_parent:'CREATE INDEX runs_parent ON runs_rows(source,parent,at)',
  runs_child:'CREATE INDEX runs_child ON runs_rows(source,child,at)',
  runs_candidates:'CREATE TABLE runs_candidates(source TEXT NOT NULL, child TEXT NOT NULL, generation INTEGER NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload) AND length(CAST(payload AS BLOB))<=4096), PRIMARY KEY(source,child))',
  runs_jobs:"CREATE TABLE runs_jobs(source TEXT NOT NULL, root TEXT NOT NULL, request_id TEXT NOT NULL, generation INTEGER NOT NULL, state TEXT NOT NULL CHECK(state IN('pending','running','complete','partial','failed')), claim TEXT, token TEXT, reason TEXT, PRIMARY KEY(source,root))",
  runs_intents:"CREATE TABLE runs_intents(source TEXT NOT NULL, parent TEXT NOT NULL, plan TEXT NOT NULL, oid TEXT NOT NULL, generation INTEGER NOT NULL, dispatch TEXT, payload TEXT NOT NULL CHECK(json_valid(payload) AND length(CAST(payload AS BLOB))<=16384), PRIMARY KEY(source,parent))",
  runs_claims:'CREATE TABLE runs_claims(source TEXT NOT NULL, child TEXT NOT NULL, execution INTEGER NOT NULL, oid TEXT NOT NULL, hash TEXT NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload) AND length(CAST(payload AS BLOB))<=2048), PRIMARY KEY(source,child,execution), UNIQUE(source,child,oid))',
  runs_retired:'CREATE TABLE runs_retired(source TEXT NOT NULL, child TEXT NOT NULL, execution INTEGER NOT NULL, oid TEXT NOT NULL, hash TEXT NOT NULL, PRIMARY KEY(source,child,oid))',
  runs_recovery_work:'CREATE TABLE runs_recovery_work(source TEXT NOT NULL, root TEXT NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload) AND length(CAST(payload AS BLOB))<=4194304), PRIMARY KEY(source,root))',
  runs_recovery_lease:'CREATE TABLE runs_recovery_lease(source TEXT NOT NULL, location TEXT NOT NULL, producer TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY(source,location))',
  runs_capture_epoch:`CREATE TRIGGER runs_capture_epoch AFTER UPDATE OF enabled ON meta WHEN NEW.enabled != OLD.enabled BEGIN UPDATE runs_format SET generation=generation+1,revision=revision+1 WHERE singleton=1; UPDATE runs_jobs SET state='failed',claim=NULL,token=lower(hex(randomblob(16))),reason='capture-disabled' WHERE state IN('pending','running'); DELETE FROM runs_candidates; UPDATE receipts SET receipt=json_set(receipt,'$.delegation.state','retired','$.delegation.reason','capture-disabled') WHERE EXISTS(SELECT 1 FROM runs_intents i WHERE i.source=receipts.source AND i.plan=receipts.plan AND i.oid=receipts.oid); DELETE FROM runs_intents; END`,
  runs_plan_delete:"CREATE TRIGGER runs_plan_delete AFTER DELETE ON plans BEGIN UPDATE runs_rows SET payload=json_set(payload,'$.planContext',json('null'),'$.accepted',json('null')) WHERE source=OLD.source AND (json_extract(payload,'$.planContext.plan')=OLD.id OR json_extract(payload,'$.accepted.plan')=OLD.id); UPDATE runs_format SET revision=revision+1 WHERE singleton=1; END",
  runs_intent_delete:"CREATE TRIGGER runs_intent_delete BEFORE DELETE ON plans BEGIN DELETE FROM runs_intents WHERE source=OLD.source AND plan=OLD.id; END",
  runs_intent_close:"CREATE TRIGGER runs_intent_close AFTER UPDATE ON plans WHEN json_extract(NEW.snapshot,'$.lifecycle')!='active' BEGIN UPDATE receipts SET receipt=json_set(receipt,'$.delegation.state','retired','$.delegation.reason','closed') WHERE source=NEW.source AND plan=NEW.id AND oid IN(SELECT oid FROM runs_intents WHERE source=NEW.source AND plan=NEW.id); DELETE FROM runs_intents WHERE source=NEW.source AND plan=NEW.id; END",
  runs_progress_change:'CREATE TRIGGER runs_progress_change AFTER UPDATE ON plans BEGIN UPDATE runs_format SET revision=revision+1 WHERE singleton=1; END',
};
const normalized=(s:string)=>s.trim().replace(/\s+/g,' ');
const integer=(v:unknown):v is number=>Number.isSafeInteger(v)&&Number(v)>=0;
const obj=(v:unknown):v is Record<string,any>=>!!v&&typeof v==='object'&&!Array.isArray(v);
export function runsInstalled(db:DatabaseSync):boolean {
  const rows=db.prepare("SELECT name,sql FROM sqlite_master WHERE name GLOB 'runs_*'").all();
  if(!rows.length)return false;
  need(rows.length===Object.keys(definitions).length,'schema');
  for(const r of rows)need(typeof r.name==='string'&&definitions[r.name]!==undefined&&normalized(String(r.sql))===normalized(definitions[r.name]),'schema');
  const f=db.prepare('SELECT * FROM runs_format').all();
  need(f.length===1&&f[0].singleton===1&&f[0].version===1&&integer(f[0].revision)&&integer(f[0].generation)&&[0,1].includes(Number(f[0].loss)),'schema');
  return true;
}
/** Caller owns BEGIN IMMEDIATE. Reads never call this. */
export function installRuns(db:DatabaseSync) {
  if(runsInstalled(db))return;
  for(const sql of Object.values(definitions))db.exec(sql);
  db.exec('INSERT INTO runs_format VALUES(1,1,0,0,0)');
}
export function runControl(db:DatabaseSync) {
  need(runsInstalled(db),'schema');
  const r=db.prepare('SELECT enabled,generation FROM meta JOIN runs_format USING(singleton)').get()!;
  return {enabled:r.enabled===1,generation:Number(r.generation)};
}
function bump(db:DatabaseSync) { db.exec('UPDATE runs_format SET revision=revision+1 WHERE singleton=1'); }
function loss(db:DatabaseSync) { db.exec('UPDATE runs_format SET loss=1,revision=revision+1 WHERE singleton=1'); }
export function runCaptureUnavailable(db:DatabaseSync) { if(runsInstalled(db))loss(db); }
function claimValue(value:unknown):NonNullable<RunRow['claimed']> {
  need(obj(value)&&Object.keys(value).length===6&&Object.keys(value).every(k=>['oid','outcome','summary','reportedAt','sessionId','association'].includes(k))&&identifier(value.oid)&&identifier(value.sessionId)&&['done','partial','blocked'].includes(value.outcome)&&typeof value.summary==='string'&&value.summary.trim().length>0&&value.summary.length<=200&&!/[\u0000\r\n\u2028\u2029]/.test(value.summary)&&integer(value.reportedAt)&&['execution','session-only'].includes(value.association),'corrupt');
  return {oid:value.oid,outcome:value.outcome,summary:value.summary,reportedAt:value.reportedAt,sessionId:value.sessionId,association:value.association};
}
function row(value:unknown):RunRow {
  need(typeof value==='string'&&Buffer.byteLength(value)<=RUN_LIMITS.dtoBytes,'corrupt');
  let r:RunRow;try{r=JSON.parse(value);}catch{need(false,'corrupt');}
  need(obj(r!)&&identifier(r.id)&&identifier(r.source)&&identifier(r.parentSessionId)&&(r.childSessionId===null||identifier(r.childSessionId))&&obj(r.ran)&&['unknown','running','succeeded','failed','interrupted'].includes(r.ran.state),'corrupt');
  const keys=(v:unknown,allowed:string[])=>obj(v)&&Object.keys(v).length===allowed.length&&Object.keys(v).every(k=>allowed.includes(k));
  const time=(v:unknown)=>v===null||integer(v);
  need(keys(r,['id','kind','source','parentSessionId','childSessionId','tool','agent','description','dispatch','planContext','ran','claimed','accepted'])&&['dispatch','historical-session'].includes(r.kind)&&[null,'subagent','task'].includes(r.tool)&&(r.agent===null||typeof r.agent==='string'&&r.agent.length<=80)&&(r.description===null||typeof r.description==='string'&&r.description.length<=200),'corrupt');
  need(r.dispatch===null||keys(r.dispatch,['messageId','callId','at'])&&identifier(r.dispatch.messageId)&&identifier(r.dispatch.callId)&&integer(r.dispatch.at),'corrupt');
  need(r.planContext===null||keys(r.planContext,['plan','revision','observedAt'])&&identifier(r.planContext.plan)&&integer(r.planContext.revision)&&integer(r.planContext.observedAt),'corrupt');
  need(keys(r.ran,['state','dispatchState','startedAt','endedAt','updatedAt','provenance','eventId','sequence','errorType','interruptionReason'])&&['pending','returned','failed-unconfirmed','unconfirmed','historical'].includes(r.ran.dispatchState)&&['dispatch','native-event','native-session'].includes(r.ran.provenance)&&time(r.ran.startedAt)&&time(r.ran.endedAt)&&integer(r.ran.updatedAt)&&(r.ran.eventId===null||identifier(r.ran.eventId))&&time(r.ran.sequence)&&(r.ran.errorType===null||r.ran.errorType===safeErrorType(r.ran.errorType))&&[null,'user','shutdown','superseded','inactivity','unknown'].includes(r.ran.interruptionReason),'corrupt');
  if(r.claimed)claimValue(r.claimed);
  if(r.accepted)need(keys(r.accepted,['plan','revision','items','omittedItems'])&&identifier(r.accepted.plan)&&integer(r.accepted.revision)&&integer(r.accepted.omittedItems)&&Array.isArray(r.accepted.items)&&r.accepted.items.length<=50&&r.accepted.items.every(i=>keys(i,['id','status'])&&identifier(i.id)&&['pending','working','blocked','done','skipped'].includes(i.status)),'corrupt');
  return r;
}
function save(db:DatabaseSync,r:RunRow) {
  const text=JSON.stringify(r);need(Buffer.byteLength(text)<=RUN_LIMITS.dtoBytes,'invalid');
  row(text);
  db.prepare('UPDATE runs_rows SET child=?,terminal=?,payload=? WHERE id=?').run(r.childSessionId,Number(['succeeded','failed','interrupted'].includes(r.ran.state)||r.ran.dispatchState==='failed-unconfirmed'||r.ran.dispatchState==='unconfirmed'&&r.childSessionId===null),text,r.id);bump(db);
}
function retainedCount(db:DatabaseSync):number {
  return Number(db.prepare('SELECT (SELECT count(*) FROM runs_rows)+(SELECT count(*) FROM runs_jobs)+(SELECT count(*) FROM runs_retired)+(SELECT count(*) FROM runs_recovery_lease)+(SELECT count(*) FROM runs_claims)+(SELECT count(*) FROM runs_recovery_work) AS n').get()!.n);
}
function capacity(db:DatabaseSync,parent?:{source:string;parent:string}):boolean {
  for(let attempts=0;attempts<4;attempts++) {
    const fullParent=parent&&Number(db.prepare('SELECT count(*) AS n FROM runs_rows WHERE source=? AND parent=?').get(parent.source,parent.parent)!.n)>=RUN_LIMITS.parent;
    if(!fullParent&&retainedCount(db)<RUN_LIMITS.total)return true;
    // A retained row also carries a verified ancestry edge. Never remove the
    // last copy while outgoing retained rows still rely on it for root scope.
    const victim=db.prepare(`SELECT id,source,child,payload FROM runs_rows WHERE terminal=1 AND NOT EXISTS(SELECT 1 FROM runs_intents i WHERE i.dispatch=runs_rows.id)
      AND (child IS NULL OR NOT EXISTS(SELECT 1 FROM runs_rows d WHERE d.source=runs_rows.source AND d.parent=runs_rows.child)
        OR EXISTS(SELECT 1 FROM runs_rows edge WHERE edge.source=runs_rows.source AND edge.parent=runs_rows.parent AND edge.child=runs_rows.child AND edge.id!=runs_rows.id))
      ${fullParent?'AND source=? AND parent=?':''} ORDER BY at,id LIMIT 1`).get(...(fullParent?[parent!.source,parent!.parent]:[]));
    if(!victim){loss(db);return false;}
    const r=row(victim.payload);
    if(r.claimed&&r.childSessionId) {
      // A bounded retirement fence rejects a pruned handoff retry. If safety
      // fences use the entire budget, admission refuses rather than dropping one.
      db.prepare('INSERT INTO runs_retired VALUES(?,?,?,?,?) ON CONFLICT(source,child,oid) DO UPDATE SET execution=max(execution,excluded.execution)').run(r.source,r.childSessionId,r.ran.sequence??0,r.claimed.oid,hash([r.claimed.outcome,r.claimed.summary]));
    }
    db.prepare('DELETE FROM runs_rows WHERE id=?').run(victim.id);loss(db);
  }
  return false;
}
export function metadataString(v:unknown,max:number):string|null { return typeof v==='string'?v.replace(/[\u0000\r\n\t\u2028\u2029]/g,' ').slice(0,max)||null:null; }
export function safeErrorType(v:unknown):string { return typeof v==='string'&&/^[A-Za-z0-9_.:-]{1,80}$/.test(v)?v:'unknown'; }
function hash(v:unknown) {return createHash('sha256').update(JSON.stringify(v)).digest('hex');}
function keyId(k:DispatchKey){return hash([k.source,k.parent,k.message,k.call]);}
function validKey(k:DispatchKey){need([k.source,k.parent,k.message,k.call].every(identifier));}
function captureIdentity(db:DatabaseSync,actor:Actor) {
  // sessions also participates in directory-filtered progress reads. Passive
  // capture may add a new unreported identity, never refresh reported identity
  // or repair a missing participant row and thereby alter progress visibility.
  if(db.prepare('SELECT 1 FROM sessions WHERE source=? AND id=?').get(actor.sourceId,actor.sessionId))return;
  const participant=db.prepare(`SELECT 1 FROM plans WHERE source=? AND (json_extract(snapshot,'$.sessionId')=?
    OR EXISTS(SELECT 1 FROM json_each(snapshot,'$.links') l WHERE json_extract(l.value,'$.sessionId')=?))
    UNION ALL SELECT 1 FROM contributions WHERE source=? AND json_extract(payload,'$.attributedSessionId')=? LIMIT 1`).get(actor.sourceId,actor.sessionId,actor.sessionId,actor.sourceId,actor.sessionId);
  if(!participant)db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(actor.sourceId,actor.sessionId,JSON.stringify(actor));
}
export interface DurableIntent { request:Request; caller:Pick<Actor,'sourceId'|'sessionId'>; generation:number; bindOid:string; dispatch:string|null }
export function activeIntent(db:DatabaseSync,source:string,parent:string):DurableIntent|null {
  const r=db.prepare('SELECT dispatch,CASE WHEN length(CAST(payload AS BLOB))<=16384 THEN payload END AS payload FROM runs_intents WHERE source=? AND parent=?').get(source,parent);
  if(!r)return null;need(typeof r.payload==='string','corrupt');return {...JSON.parse(r.payload),dispatch:r.dispatch} as DurableIntent;
}
function intentDisposition(db:DatabaseSync,i:DurableIntent,state:'pending'|'reserved'|'retired'|'bound',reason?:string,dispatch?:string,receipt?:Receipt) {
  const reply={plan:i.request.plan,rev:i.request.rev,delegation:{state,memoryOnly:false,lostOnRestart:false,requires:'supported-next-delegation',...(dispatch?{dispatchId:dispatch}:{}),...(reason?{reason}:{}),...(receipt?{receipt}:{})}};
  db.prepare('UPDATE receipts SET receipt=? WHERE source=? AND plan=? AND oid=?').run(JSON.stringify(reply),i.caller.sourceId,i.request.plan,i.request.oid!);return reply;
}
export function declareIntent(db:DatabaseSync,r:Request,actor:Actor,validate:()=>void) {
  const c=runControl(db);need(c.enabled,'disabled');const payloadHash=hash([r,actor.sourceId,actor.sessionId]);
  const old=db.prepare('SELECT payload_hash,receipt FROM receipts WHERE source=? AND plan=? AND oid=?').get(actor.sourceId,r.plan,r.oid!);
  if(old){need(old.payload_hash===payloadHash,'operation-reused');return JSON.parse(String(old.receipt));}
  validate();const current=activeIntent(db,actor.sourceId,actor.sessionId);
  if(r.assign!.length)need(!current,'conflict');
  else if(current){intentDisposition(db,current,'retired','cancelled',current.dispatch??undefined);db.prepare('DELETE FROM runs_intents WHERE source=? AND parent=?').run(actor.sourceId,actor.sessionId);}
  need(!r.assign!.length||Number(db.prepare('SELECT count(*) AS n FROM runs_intents').get()!.n)<RUN_LIMITS.intents,'busy');
  const i:DurableIntent={request:r,caller:{sourceId:actor.sourceId,sessionId:actor.sessionId},generation:c.generation,bindOid:`binding-${randomUUID()}`,dispatch:null};
  db.prepare('INSERT INTO receipts VALUES(?,?,?,?,?)').run(actor.sourceId,r.plan,r.oid!,payloadHash,'{}');
  if(r.assign!.length)db.prepare('INSERT INTO runs_intents VALUES(?,?,?,?,?,NULL,?)').run(actor.sourceId,actor.sessionId,r.plan,r.oid!,c.generation,JSON.stringify(i));
  return intentDisposition(db,i,r.assign!.length?'pending':'retired',r.assign!.length?undefined:'cancelled');
}
export function reservedIntent(db:DatabaseSync,k:DispatchKey):DurableIntent|null {const i=activeIntent(db,k.source,k.parent);return i?.dispatch===keyId(k)?i:null;}
export function settleIntent(db:DatabaseSync,i:DurableIntent,receipt?:Receipt,reason?:string) {
  intentDisposition(db,i,receipt?'bound':'retired',reason,i.dispatch??undefined,receipt);db.prepare('DELETE FROM runs_intents WHERE source=? AND parent=? AND dispatch=?').run(i.caller.sourceId,i.caller.sessionId,i.dispatch!);
}
function claimHash(r:HandoffRequest){return hash([r.outcome,r.summary]);}
function attachClaim(db:DatabaseSync,r:RunRow) {
  if(!r.childSessionId||r.ran.startedAt===null||r.claimed)return;
  const claims=db.prepare('SELECT * FROM runs_claims WHERE source=? AND child=? LIMIT 2').all(r.source,r.childSessionId);
  const matching=claims.filter(c=>{const claim=JSON.parse(String(c.payload));return claim.reportedAt>=r.ran.startedAt!&&(r.ran.endedAt===null||claim.reportedAt<=r.ran.endedAt)&& (Number(c.execution)===0||Number(c.execution)<=Number(r.ran.sequence));});
  if(matching.length!==1)return;
  const others=db.prepare("SELECT 1 FROM runs_rows WHERE source=? AND child=? AND id!=? AND json_extract(payload,'$.ran.startedAt')<=? AND (json_extract(payload,'$.ran.endedAt') IS NULL OR json_extract(payload,'$.ran.endedAt')>=?) LIMIT 1").get(r.source,r.childSessionId,r.id,JSON.parse(String(matching[0]!.payload)).reportedAt,JSON.parse(String(matching[0]!.payload)).reportedAt);
  if(others)return;
  const claim=JSON.parse(String(matching[0]!.payload));r.claimed={...claim,association:'execution'};save(db,r);db.prepare('DELETE FROM runs_claims WHERE source=? AND child=? AND execution=?').run(r.source,r.childSessionId,matching[0]!.execution!);
}
export function handoff(db:DatabaseSync,r:HandoffRequest,actor:Actor,now:number) {
  need(runControl(db).enabled,'disabled');need(actor.verifiedSource&&identifier(actor.parentId)&&actor.ancestry?.[0]===actor.parentId&&actor.ancestry.length<=32,'assignment');
  need(db.prepare('SELECT verified FROM sources WHERE id=?').get(actor.sourceId)?.verified===1,'source-unverified');
  const existing=db.prepare("SELECT payload FROM runs_rows WHERE source=? AND child=? AND json_extract(payload,'$.claimed.oid')=? LIMIT 1").get(actor.sourceId,actor.sessionId,r.oid);
  if(existing){const claim=row(existing.payload).claimed!;need(hash([claim.outcome,claim.summary])===claimHash(r),'operation-reused');return {handoff:claim};}
  const oldClaim=db.prepare('SELECT hash FROM runs_retired WHERE source=? AND child=? AND oid=?').get(actor.sourceId,actor.sessionId,r.oid);
  if(oldClaim){need(oldClaim.hash===claimHash(r),'operation-reused');need(false,'not-found');}
  const retired=db.prepare('SELECT max(execution) AS execution FROM runs_retired WHERE source=? AND child=?').get(actor.sourceId,actor.sessionId);
  const c=candidate(db,actor.sourceId,actor.sessionId);
  const retained=db.prepare("SELECT json_extract(payload,'$.ran.sequence') AS seq,json_extract(payload,'$.ran.startedAt') AS started_at FROM runs_rows WHERE source=? AND child=? AND json_extract(payload,'$.ran.state')='running' ORDER BY at DESC LIMIT 1").get(actor.sourceId,actor.sessionId);
  const execution=c?.start?.sequence??Number(retained?.seq??0);
  const staged=db.prepare('SELECT oid,hash,payload FROM runs_claims WHERE source=? AND child=? AND (execution=? OR oid=?) LIMIT 1').get(actor.sourceId,actor.sessionId,execution,r.oid);
  if(staged){need(staged.oid===r.oid,'conflict');need(staged.hash===claimHash(r),'operation-reused');return {handoff:claimValue(JSON.parse(String(staged.payload)))};}
  const runs=db.prepare('SELECT payload FROM runs_rows WHERE source=? AND child=? ORDER BY at DESC LIMIT 2').all(actor.sourceId,actor.sessionId).map(v=>row(v.payload));
  const current=runs.filter(v=>v.ran.startedAt!==null&&v.ran.startedAt<=now&&(v.ran.endedAt===null||now<=v.ran.endedAt));
  const currentStart=c?.start?.at??retained?.started_at??runs.find(v=>v.ran.startedAt!==null)?.ran.startedAt;
  if(current.some(v=>v.claimed)||runs.some(v=>v.claimed&&currentStart===v.ran.startedAt))need(false,'conflict');
  if(retired?.execution!==null&&retired?.execution!==undefined&&execution<=Number(retired.execution))need(false,'not-found');
  need(Number(db.prepare('SELECT count(*) AS n FROM runs_claims').get()!.n)<RUN_LIMITS.claims&&capacity(db),'busy');
  const claim:NonNullable<RunRow['claimed']>={oid:r.oid,outcome:r.outcome,summary:r.summary,reportedAt:now,sessionId:actor.sessionId,association:'session-only'};
  db.prepare('INSERT INTO runs_claims VALUES(?,?,?,?,?,?)').run(actor.sourceId,actor.sessionId,execution,r.oid,claimHash(r),JSON.stringify(claim));
  if(current.length===1){attachClaim(db,current[0]!);if(current[0]!.claimed)return {handoff:current[0]!.claimed};}
  bump(db);return {handoff:claim};
}
function associatedPlan(db:DatabaseSync,actor:Actor,at:number):RunRow['planContext'] {
  // Bounded complete discovery: historical contributions never count as context.
  const p=db.prepare(`SELECT id,revision FROM plans WHERE source=? AND json_extract(snapshot,'$.lifecycle')='active' AND
    (json_extract(snapshot,'$.sessionId')=? OR EXISTS(SELECT 1 FROM json_each(snapshot,'$.links') l WHERE json_extract(l.value,'$.sessionId')=? AND json_array_length(json_extract(l.value,'$.itemIds'))>0)) LIMIT 3`).all(actor.sourceId,actor.sessionId,actor.sessionId);
  const eligible=p.filter(r=>!cleanupInstalled(db)||!['archived','deleted'].includes(String(cleanupState(db,actor.sourceId,String(r.id))?.state)));
  if(p.length>=3)return null;
  const incoming=db.prepare(`SELECT json_extract(payload,'$.planContext.plan') AS plan FROM runs_rows r WHERE source=? AND child=? AND terminal=0 AND json_extract(payload,'$.ran.state')='running' AND json_extract(payload,'$.planContext.plan') IS NOT NULL
    AND (SELECT loss FROM runs_format)=0 AND NOT EXISTS(SELECT 1 FROM runs_candidates c WHERE c.source=r.source AND c.child=r.child AND json_extract(c.payload,'$.start.at')!=json_extract(r.payload,'$.ran.startedAt')) LIMIT 2`).all(actor.sourceId,actor.sessionId);
  if(incoming.length===1){const plan=db.prepare("SELECT id,revision FROM plans WHERE source=? AND id=? AND json_extract(snapshot,'$.lifecycle')='active'").get(actor.sourceId,String(incoming[0]!.plan));if(plan&&(!cleanupInstalled(db)||!['archived','deleted'].includes(String(cleanupState(db,actor.sourceId,String(plan.id))?.state))))eligible.push(plan);}
  const unique=new Map(eligible.map(r=>[String(r.id),r]));const only=[...unique.values()][0];
  return unique.size===1?{plan:String(only!.id),revision:Number(only!.revision),observedAt:at}:null;
}
export function beforeRun(db:DatabaseSync,k:DispatchKey,actor:Actor,tool:'subagent'|'task',input:unknown,at:number) {
  validKey(k);need(integer(at));const control=runControl(db);if(!control.enabled)return;
  need(actor.verifiedSource&&actor.sourceId===k.source&&actor.sessionId===k.parent&&actor.ancestry!==null,'binding');
  need(db.prepare('SELECT verified FROM sources WHERE id=?').get(k.source)?.verified===1,'binding');
  const id=keyId(k);if(db.prepare('SELECT 1 FROM runs_rows WHERE id=?').get(id))return;
  if(!capacity(db,k))return;
  const i=obj(input)?input:{};
  const intent=tool==='subagent'?activeIntent(db,k.source,k.parent):null;
  const r:RunRow={id,kind:'dispatch',source:k.source,parentSessionId:k.parent,childSessionId:null,tool,agent:metadataString(i.agent,80),description:metadataString(i.description??i.title,200),dispatch:{messageId:k.message,callId:k.call,at},planContext:intent&&!intent.dispatch?{plan:intent.request.plan,revision:intent.request.rev!,observedAt:at}:associatedPlan(db,actor,at),ran:{state:'unknown',dispatchState:'pending',startedAt:null,endedAt:null,updatedAt:at,provenance:'dispatch',eventId:null,sequence:null,errorType:null,interruptionReason:null},claimed:null,accepted:null};
  db.prepare('INSERT INTO runs_rows VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,k.source,k.parent,null,k.message,k.call,control.generation,0,at,JSON.stringify(r));
  if(intent&&!intent.dispatch){db.prepare('UPDATE runs_intents SET dispatch=? WHERE source=? AND parent=? AND dispatch IS NULL').run(id,k.source,k.parent);intentDisposition(db,intent,'reserved',undefined,id);}
  // Use the existing session owner, without exposing the filesystem location in DTOs.
  captureIdentity(db,actor);bump(db);
}
function candidate(db:DatabaseSync,source:string,child:string):Candidate|null {
  const r=db.prepare('SELECT CASE WHEN length(CAST(payload AS BLOB))<=4096 THEN payload END AS payload FROM runs_candidates WHERE source=? AND child=?').get(source,child);
  if(!r)return null;need(typeof r.payload==='string','corrupt');return JSON.parse(r.payload) as Candidate;
}
// Missing/unverified identity is not evidence of root status: early child
// events must still be staged before the after hook verifies their ancestry.
const verifiedRootIdentity=`json_extract(s.actor,'$.verifiedSource')=1
  AND json_extract(s.actor,'$.sourceId')=s.source AND json_extract(s.actor,'$.sessionId')=s.id
  AND json_type(s.actor,'$.parentId')='null' AND json_type(s.actor,'$.ancestry')='array'
  AND json_array_length(s.actor,'$.ancestry')=0`;
function adopt(db:DatabaseSync,r:RunRow,c:Candidate) {
  if(!r.dispatch||!r.childSessionId||!c.start||c.ambiguous||c.start.at<r.dispatch.at)return;
  if(r.ran.startedAt!==null&&r.ran.startedAt!==c.start.at)return;
  // Only calls admitted by the candidate's start could own an unassociated
  // interval. Once its start is proven, later pending calls cannot block its end.
  if(r.ran.startedAt===null&&db.prepare("SELECT 1 FROM runs_rows WHERE source=? AND parent=? AND id!=? AND child IS NULL AND json_extract(payload,'$.tool')='subagent' AND json_extract(payload,'$.ran.dispatchState')='pending' AND at<=? LIMIT 1").get(r.source,r.parentSessionId,r.id,c.start.at))return;
  // Competing dispatches are not disambiguated from a shared child ID alone.
  const competing=db.prepare("SELECT id FROM runs_rows WHERE source=? AND child=? AND message IS NOT NULL AND id!=? AND (terminal=0 OR at>=?) LIMIT 1").get(r.source,r.childSessionId,r.id,r.dispatch.at);
  if(competing)return;
  if(r.ran.sequence!==null&&(c.end?.sequence??c.start.sequence)<=r.ran.sequence){attachClaim(db,r);return;}
  const e=c.end&&c.end.sequence>c.start.sequence&&c.end.at>=c.start.at?c.end:c.start;
  if(r.ran.endedAt!==null)return;
  r.ran={...r.ran,state:e.state,startedAt:c.start.at,endedAt:e===c.start?null:e.at,updatedAt:e.at,provenance:'native-event',eventId:e.id,sequence:e.sequence,errorType:e.errorType,interruptionReason:e.interruptionReason};
  if(r.claimed&&r.ran.endedAt!==null&&(r.claimed.reportedAt<r.ran.startedAt!||r.claimed.reportedAt>r.ran.endedAt)){
    // Host terminal facts take priority over an invalid claim association.
    // Restage only in spare capacity; never prune runs or reject the terminal
    // to retain this lower-priority claim. Slot/operation conflicts also lose
    // only this claim, with the existing bounded capture-loss disclosure.
    const claim={...r.claimed,association:'session-only' as const};
    const room=Number(db.prepare('SELECT count(*) AS n FROM runs_claims').get()!.n)<RUN_LIMITS.claims&&retainedCount(db)<RUN_LIMITS.total;
    if(!room||!db.prepare('INSERT INTO runs_claims VALUES(?,?,?,?,?,?) ON CONFLICT DO NOTHING').run(r.source,r.childSessionId,0,claim.oid,hash([claim.outcome,claim.summary]),JSON.stringify(claim)).changes)loss(db);
    r.claimed=null;
  }
  save(db,r);attachClaim(db,r);
  db.prepare('DELETE FROM runs_candidates WHERE source=? AND child=?').run(r.source,r.childSessionId);
}
export function afterRun(db:DatabaseSync,k:DispatchKey,generation:number,child:Actor|undefined,disposition:'returned'|'failed-unconfirmed'|'unconfirmed') {
  validKey(k);const c=runControl(db);if(!c.enabled||c.generation!==generation)return;
  const stored=db.prepare('SELECT generation,payload FROM runs_rows WHERE id=?').get(keyId(k));if(!stored||stored.generation!==generation)return;
  const r=row(stored.payload);if(r.ran.dispatchState!=='pending'&&!(r.ran.dispatchState==='unconfirmed'&&r.childSessionId===null&&child)){if(child&&r.childSessionId!==child.sessionId)loss(db);return;}
  if(child){
    const parent=db.prepare('SELECT actor FROM sessions WHERE source=? AND id=?').get(k.source,k.parent);need(parent&&typeof parent.actor==='string','binding');const actor=JSON.parse(parent.actor) as Actor;
    need(r.tool==='subagent'&&child.verifiedSource&&child.sourceId===k.source&&identifier(child.sessionId)&&child.parentId===k.parent&&child.ancestry?.[0]===k.parent&&child.directory===actor.directory&&child.projectId===actor.projectId,'binding');r.childSessionId=child.sessionId;
  }
  r.ran.dispatchState=disposition;save(db,r);
  if(child)captureIdentity(db,child);
  for(const other of db.prepare('SELECT payload FROM runs_rows WHERE source=? AND parent=? AND child IS NOT NULL AND terminal=0 LIMIT 1024').all(k.source,k.parent)){const r=row(other.payload);const c=candidate(db,k.source,r.childSessionId!);if(c)adopt(db,r,c);}
}
export function observeExecution(db:DatabaseSync,e:ExecutionObservation) {
  const control=runControl(db);if(!control.enabled)return;
  need(identifier(e.source)&&identifier(e.child)&&identifier(e.id)&&integer(e.sequence)&&integer(e.at)&&['running','succeeded','failed','interrupted'].includes(e.state),'invalid');
  if(e.state==='failed'||e.state==='interrupted') {
    for(const pending of db.prepare("SELECT payload FROM runs_rows WHERE source=? AND parent=? AND child IS NULL AND at<=? AND json_extract(payload,'$.ran.dispatchState')='pending' LIMIT 1024").all(e.source,e.child,e.at)) {
      const r=row(pending.payload);r.ran.dispatchState='unconfirmed';save(db,r);
      const i=activeIntent(db,e.source,e.child);if(i?.dispatch===r.id)settleIntent(db,i,undefined,'parent-execution-ended');
    }
  }
  // Root terminal events above still retire their pending dispatch authority,
  // but a verified root cannot itself be adopted as an immediate child.
  if(db.prepare(`SELECT 1 FROM sessions s WHERE s.source=? AND s.id=? AND ${verifiedRootIdentity}`).get(e.source,e.child)){
    db.prepare('DELETE FROM runs_candidates WHERE source=? AND child=?').run(e.source,e.child);return;
  }
  const known=db.prepare("SELECT payload FROM runs_rows WHERE source=? AND child=? AND json_extract(payload,'$.ran.sequence') IS NOT NULL ORDER BY json_extract(payload,'$.ran.sequence') DESC LIMIT 1").get(e.source,e.child);
  const previous=known?row(known.payload):undefined;
  if(previous?.ran.sequence!==null&&previous?.ran.sequence!==undefined&&e.sequence<=previous.ran.sequence)return;
  const retainedStart:ExecutionObservation|null=previous?.ran.state==='running'&&previous.ran.eventId&&previous.ran.startedAt!==null?{source:e.source,child:e.child,id:previous.ran.eventId,sequence:previous.ran.sequence!,at:previous.ran.startedAt,state:'running',errorType:null,interruptionReason:null}:null;
  const c=candidate(db,e.source,e.child)??{start:retainedStart,end:null};
  const latest=Math.max(c.start?.sequence??-1,c.end?.sequence??-1);
  if(e.sequence<=latest&&!(e.state==='running'&&!c.start&&c.end&&e.sequence<c.end.sequence))return;
  if(e.state==='running'){
    if(c.start&&c.end&&e.sequence>c.end.sequence){c.start=e;c.end=null;c.ambiguous=false;}
    else if(!c.start)c.start=e;
    else {c.ambiguous=true;c.start=e;c.end=null;}
  }else c.end=e;
  if(!candidate(db,e.source,e.child)&&Number(db.prepare('SELECT count(*) AS n FROM runs_candidates').get()!.n)>=RUN_LIMITS.candidates){
    // Root candidates and expired completed staging are silent victims.
    // Compare same-source host event times, not receipt/wall-clock age; never
    // silently expire a start-only interval or an unresolved verified dispatch.
    const victim=db.prepare(`SELECT c.source,c.child,coalesce((${verifiedRootIdentity}),0) AS root,
      coalesce((c.source=? AND json_extract(c.payload,'$.end.state') IN ('succeeded','failed','interrupted')
        AND json_type(c.payload,'$.end.at')='integer' AND json_extract(c.payload,'$.end.at')<?),0) AS stale
      FROM runs_candidates c LEFT JOIN sessions s ON s.source=c.source AND s.id=c.child WHERE NOT EXISTS
      (SELECT 1 FROM runs_rows r WHERE r.source=c.source AND r.child=c.child AND r.message IS NOT NULL AND r.terminal=0)
      ORDER BY root DESC,stale DESC,c.rowid LIMIT 1`).get(e.source,e.at-RUN_LIMITS.candidateAdoptionMs);
    if(!victim){loss(db);return;}if(!victim.root&&!victim.stale)loss(db);
    db.prepare('DELETE FROM runs_candidates WHERE source=? AND child=?').run(victim.source!,victim.child!);
  }
  // Re-project even typed callers: never serialize a host event or error object.
  const project=(v:ExecutionObservation|null)=>v?{source:e.source,child:e.child,id:v.id,sequence:v.sequence,at:v.at,state:v.state,errorType:v.state==='failed'?safeErrorType(v.errorType):null,interruptionReason:v.state==='interrupted'&&['user','shutdown','superseded','inactivity'].includes(String(v.interruptionReason))?v.interruptionReason:v.state==='interrupted'?'unknown':null}:null;
  const safe={start:project(c.start),end:project(c.end),ambiguous:c.ambiguous??false} as Candidate;
  db.prepare('INSERT INTO runs_candidates VALUES(?,?,?,?) ON CONFLICT(source,child) DO UPDATE SET generation=excluded.generation,payload=excluded.payload').run(e.source,e.child,control.generation,JSON.stringify(safe));
  const rows=db.prepare('SELECT payload FROM runs_rows WHERE source=? AND child=? AND message IS NOT NULL AND terminal=0 LIMIT 2').all(e.source,e.child);
  if(rows.length===1)adopt(db,row(rows[0]!.payload),safe);
}

function identity(db:DatabaseSync,binding:RunBinding,r:RunRequest|ReconcileRequest) {
  need(identifier(r.storeId)&&identifier(r.source)&&identifier(r.root));
  need(obj(r.binding)&&Object.keys(r.binding).length===2&&r.binding.sourceId===binding.sourceId&&r.binding.verified===binding.verified&&binding.sourceId===r.source&&binding.verified,'conflict');
  const m=db.prepare('SELECT store_id,enabled FROM meta WHERE singleton=1').get()!;need(m.store_id===r.storeId,'conflict');
  need(db.prepare('SELECT verified FROM sources WHERE id=?').get(r.source)?.verified===1,'binding');
  // Only roots already verified by the native companion/task reporting are admitted.
  need(db.prepare('SELECT 1 FROM sessions WHERE source=? AND id=?').get(r.source,r.root),'not-found');
  return m;
}
function scopedParents(db:DatabaseSync,source:string,root:string) {
  const ids=new Set([root]);let frontier=[root],complete=true;
  for(let depth=0;frontier.length&&depth<RUN_LIMITS.depth;depth++){
    const next:string[]=[];
    for(const parent of frontier){
      const children=db.prepare('SELECT DISTINCT child FROM runs_rows WHERE source=? AND parent=? AND child IS NOT NULL LIMIT ?').all(source,parent,RUN_LIMITS.traversal+1);
      for(const r of children){const id=String(r.child);if(ids.has(id))continue;if(ids.size>=RUN_LIMITS.traversal){complete=false;break;}ids.add(id);next.push(id);}
    }
    frontier=next;if(depth===RUN_LIMITS.depth-1&&next.length)complete=false;
  }
  return {ids:[...ids],complete};
}
export function readRuns(db:DatabaseSync,binding:RunBinding,r:RunRequest,now=Date.now()):RunRead {
  const m=identity(db,binding,r);need(r.view===undefined||r.view==='useful'||r.view==='history');
  need((r.plan===undefined)===(r.cleanupRev===undefined));
  if(r.plan!==undefined){
    need(identifier(r.plan)&&integer(r.cleanupRev));
    const plan=db.prepare(`SELECT json_extract(snapshot,'$.sessionId') AS owner,
      EXISTS(SELECT 1 FROM json_each(snapshot,'$.links') l WHERE json_extract(l.value,'$.sessionId')=?) AS linked FROM plans WHERE source=? AND id=?`).get(r.root,r.source,r.plan);
    need(plan,'not-found');const incoming=runsInstalled(db)&&db.prepare("SELECT 1 FROM runs_rows WHERE source=? AND child=? AND json_extract(payload,'$.planContext.plan')=? LIMIT 1").get(r.source,r.root,r.plan);
    need(plan.owner===r.root||plan.linked===1||incoming,'not-found');
    const state=cleanupInstalled(db)?cleanupState(db,r.source,r.plan):undefined;need((state?.generation??0)===r.cleanupRev&&state?.state!=='deleted','conflict');
  }
  const installed=runsInstalled(db),f=installed?db.prepare('SELECT revision,loss FROM runs_format').get():undefined;
  const job=installed?db.prepare('SELECT state,CASE WHEN length(CAST(token AS BLOB))<=80 THEN token END AS token,CASE WHEN length(CAST(reason AS BLOB))<=80 THEN reason END AS reason,length(CAST(token AS BLOB)) AS token_bytes,length(CAST(reason AS BLOB)) AS reason_bytes FROM runs_jobs WHERE source=? AND root=?').get(r.source,r.root):undefined;
  if(job)need(['pending','running','complete','partial','failed'].includes(String(job.state))&&(job.token_bytes===null||Number(job.token_bytes)<=80)&&(job.reason_bytes===null||Number(job.reason_bytes)<=80)&&[null,'budget','capture-disabled','capture-unavailable'].includes(job.reason as any)&&(job.token===null||identifier(job.token)),'corrupt');
  const out:RunRead={protocolVersion:2,schemaVersion:2,storeId:r.storeId,sourceBinding:{...binding},source:r.source,root:r.root,plan:r.plan??null,cleanupRev:r.cleanupRev??null,view:r.view??'useful',subagentRuns:installed?1:null,runFormat:installed?1:null,availability:installed?'ready':'unavailable',readAt:now,revision:Number(f?.revision??0),capture:{enabled:m.enabled===1,state:installed?'last-known':'unavailable',loss:f?.loss===1},recovery:{state:job?.state as RecoveryState??(installed?'not-requested':'unavailable'),reason:job?.reason as RunRead['recovery']['reason']??null,token:job?.token as string??null},counts:{children:0,runs:0,historicalSessions:0,running:0,succeeded:0,failed:0,interrupted:0,unknown:0},coverage:{scope:'retained',complete:false,reasons:installed?[]:['legacy-unavailable']},data:[],nextCursor:null};
  if(!installed)return out;
  if(!job||job.state!=='complete')out.coverage.reasons.push(job&&['partial','failed'].includes(String(job.state))?'partial-history':'history-not-reconciled');
  if(f?.loss===1)out.coverage.reasons.push('capture-loss');
  const scope=scopedParents(db,r.source,r.root);if(!scope.complete)out.coverage.reasons.push('traversal-limit');
  const placeholders=scope.ids.map(()=>'?').join(',');
  const where=`source=? AND parent IN (${placeholders})`;
  const args=[r.source,...scope.ids];
  const counts=db.prepare(`SELECT count(DISTINCT child) AS children,sum(message IS NOT NULL) AS runs,sum(message IS NULL) AS history,
    sum(json_extract(payload,'$.ran.state')='running') AS running,sum(json_extract(payload,'$.ran.state')='succeeded') AS succeeded,
    sum(json_extract(payload,'$.ran.state')='failed') AS failed,sum(json_extract(payload,'$.ran.state')='interrupted') AS interrupted,sum(json_extract(payload,'$.ran.state')='unknown') AS unknown FROM runs_rows WHERE ${where}`).get(...args)!;
  for(const key of ['children','runs','running','succeeded','failed','interrupted','unknown'] as const)out.counts[key]=Number(counts[key]??0);out.counts.historicalSessions=Number(counts.history??0);
  const useful="coalesce((json_extract(payload,'$.ran.state')='running' OR (? IS NOT NULL AND (json_extract(payload,'$.planContext.plan')=? OR json_extract(payload,'$.accepted.plan')=? OR EXISTS(SELECT 1 FROM plans p,json_each(p.snapshot,'$.links') l WHERE p.source=runs_rows.source AND p.id=? AND json_extract(l.value,'$.sessionId')=runs_rows.child)))),0)";
  const selection=`${where} AND ${out.view==='history'?'NOT ':''}${useful}`;
  const identityKey=hash([r.storeId,binding,r.source,r.root,r.plan??null,r.cleanupRev??null,out.view]);
  let offset=0;
  if(r.cursor){need(Buffer.byteLength(r.cursor)<=RUN_LIMITS.cursorBytes&&/^[A-Za-z0-9_-]+$/.test(r.cursor));let c;try{c=JSON.parse(Buffer.from(r.cursor,'base64url').toString('utf8'));}catch{need(false);}need(obj(c)&&Object.keys(c).length===3&&c.key===identityKey&&c.revision===out.revision&&integer(c.offset)&&c.offset<=RUN_LIMITS.total,'conflict');offset=c.offset;}
  const rows=db.prepare(`SELECT CASE WHEN length(CAST(payload AS BLOB))<=4096 THEN payload END AS payload FROM runs_rows WHERE ${selection} ORDER BY (json_extract(payload,'$.ran.state')='running') DESC,at DESC,id LIMIT ? OFFSET ?`).all(...args,r.plan??null,r.plan??null,r.plan??null,r.plan??null,RUN_LIMITS.page+1,offset);
  out.data=rows.slice(0,RUN_LIMITS.page).map(v=>row(v.payload));
  if(r.plan){
    // Request/response byte limits are not stored-snapshot invariants: blocker
    // details can accumulate across valid bounded writes. Project only facts
    // needed for accepted tasks, retaining the supported structural bounds.
    const snapshot=db.prepare(`SELECT CASE WHEN json_type(snapshot,'$.items')='array' AND json_array_length(snapshot,'$.items')<=1000
      AND json_type(snapshot,'$.links')='array' AND json_array_length(snapshot,'$.links')<=64 THEN
      json_object('revision',json_extract(snapshot,'$.revision'),'links',json_extract(snapshot,'$.links'),
        'items',json((SELECT json_group_array(json_object('id',json_extract(i.value,'$.id'),'kind',json_extract(i.value,'$.kind'),
          'status',json_extract(i.value,'$.status'),'assigneeSessionId',json_extract(i.value,'$.assigneeSessionId')))
          FROM json_each(snapshot,'$.items') i))) END AS snapshot FROM plans WHERE source=? AND id=?`).get(r.source,r.plan);
    need(typeof snapshot?.snapshot==='string','corrupt');const p=JSON.parse(snapshot.snapshot);
    need(Array.isArray(p.items)&&p.items.length<=1000&&Array.isArray(p.links)&&p.links.length<=64,'corrupt');
    for(const run of out.data){
      const linked=p.links.find((l:any)=>l.sessionId===run.childSessionId);if(!linked)continue;
      need(Array.isArray(linked.itemIds)&&linked.itemIds.length<=1000,'corrupt');
      const facts=p.items.filter((i:any)=>i.kind==='task'&&i.assigneeSessionId===run.childSessionId&&linked.itemIds.includes(i.id)).map((i:any)=>({id:i.id,status:i.status}));
      run.accepted={plan:r.plan,revision:p.revision,items:facts.slice(0,50),omittedItems:Math.max(0,facts.length-50)};
      while(run.accepted.items.length&&Buffer.byteLength(JSON.stringify(run))>RUN_LIMITS.dtoBytes){run.accepted.items.pop();run.accepted.omittedItems++;}
      row(JSON.stringify(run));
    }
  }
  if(rows.length>RUN_LIMITS.page)out.nextCursor=Buffer.from(JSON.stringify({key:identityKey,revision:out.revision,offset:offset+RUN_LIMITS.page})).toString('base64url');
  out.coverage.complete=out.coverage.reasons.length===0;
  need(Buffer.byteLength(JSON.stringify(out))<=RUN_LIMITS.responseBytes,'corrupt');return out;
}
export function requestReconciliation(db:DatabaseSync,binding:RunBinding,r:ReconcileRequest) {
  need(obj(r)&&Object.keys(r).every(k=>['storeId','binding','source','root','token'].includes(k)));identity(db,binding,r);const c=runControl(db);need(c.enabled,'disabled');
  const old=db.prepare('SELECT state,token FROM runs_jobs WHERE source=? AND root=?').get(r.source,r.root);
  if(old&&!r.token)return {state:String(old.state),coalesced:true};
  if(r.token){need(identifier(r.token)&&old?.token===r.token&&['partial','failed'].includes(String(old?.state)),'conflict');}
  need(Number(db.prepare("SELECT count(*) AS n FROM runs_jobs WHERE state IN('pending','running')").get()!.n)<RUN_LIMITS.jobs,'busy');
  if(!old)need(capacity(db),'busy');
  db.prepare("INSERT INTO runs_jobs VALUES(?,?,?,?,'pending',NULL,NULL,NULL) ON CONFLICT(source,root) DO UPDATE SET request_id=excluded.request_id,generation=excluded.generation,state='pending',claim=NULL,token=NULL,reason=NULL").run(r.source,r.root,randomUUID(),c.generation);bump(db);
  return {state:'pending',coalesced:false};
}
export function pendingRecovery(db:DatabaseSync,source:string):string|null {
  if(!runControl(db).enabled)return null;return db.prepare("SELECT root FROM runs_jobs WHERE source=? AND state='pending' ORDER BY rowid LIMIT 1").get(source)?.root as string??null;
}
export interface RecoveryWork { queue:Array<{id:string;depth:number;cursor?:string}>; seen:string[] }
export function recoveryWork(db:DatabaseSync,j:RecoveryJob):RecoveryWork {
  const r=db.prepare('SELECT CASE WHEN length(CAST(payload AS BLOB))<=4194304 THEN payload END AS payload FROM runs_recovery_work WHERE source=? AND root=?').get(j.source,j.root);
  if(!r)return {queue:[{id:j.root,depth:0}],seen:[j.root]};need(typeof r.payload==='string','corrupt');const w=JSON.parse(r.payload) as RecoveryWork;
  need(Array.isArray(w.queue)&&w.queue.length<=RUN_LIMITS.total&&Array.isArray(w.seen)&&w.seen.length<=RUN_LIMITS.total&&w.seen.every(identifier)&&w.queue.every(n=>identifier(n.id)&&integer(n.depth)&&n.depth<=32&&(n.cursor===undefined||typeof n.cursor==='string'&&Buffer.byteLength(n.cursor)<=4096)),'corrupt');return w;
}
export function saveRecoveryWork(db:DatabaseSync,j:RecoveryJob,w:RecoveryWork) {
  if(!recoveryAlive(db,j))return;const payload=JSON.stringify(w);need(Buffer.byteLength(payload)<=4194304&&w.seen.length<=RUN_LIMITS.total&&w.queue.length<=RUN_LIMITS.total,'busy');
  if(!db.prepare('SELECT 1 FROM runs_recovery_work WHERE source=? AND root=?').get(j.source,j.root))need(capacity(db),'busy');
  db.prepare('INSERT INTO runs_recovery_work VALUES(?,?,?) ON CONFLICT(source,root) DO UPDATE SET payload=excluded.payload').run(j.source,j.root,payload);
}
export function recoveryMaintenance(db:DatabaseSync,source:string,directory:string,producer:string,now:number) {
  if(!runControl(db).enabled)return;
  const location=hash(directory),lease=db.prepare('SELECT producer,at FROM runs_recovery_lease WHERE source=? AND location=?').get(source,location);
  if(lease&&lease.producer!==producer&&now-Number(lease.at)<10000)return;
  if(!lease&&!capacity(db))return;
  if(!lease||lease.producer!==producer) {
    db.prepare("UPDATE runs_jobs SET state='partial',claim=NULL,reason='capture-unavailable',token=? WHERE source=? AND state='running' AND root IN(SELECT id FROM sessions WHERE source=? AND json_extract(actor,'$.directory')=?)").run(randomUUID(),source,source,directory);
    // One recovery attempt for retained unresolved dispatches per producer. This
    // reads metadata only and never changes the retained last-known Running fact.
    const roots=db.prepare("SELECT DISTINCT parent FROM runs_rows WHERE source=? AND terminal=0 AND child IS NOT NULL AND parent IN(SELECT id FROM sessions WHERE source=? AND json_extract(actor,'$.directory')=?) LIMIT 64").all(source,source,directory);
    for(const r of roots){const old=db.prepare('SELECT state FROM runs_jobs WHERE source=? AND root=?').get(source,r.parent!);if(old&&['pending','running'].includes(String(old.state)))continue;if(Number(db.prepare("SELECT count(*) AS n FROM runs_jobs WHERE state IN('pending','running')").get()!.n)>=RUN_LIMITS.jobs)break;if(!old&&!capacity(db))break;db.prepare("INSERT INTO runs_jobs VALUES(?,?,?,?,'pending',NULL,NULL,NULL) ON CONFLICT(source,root) DO UPDATE SET request_id=excluded.request_id,generation=excluded.generation,state='pending',claim=NULL,token=NULL,reason=NULL").run(source,r.parent!,randomUUID(),runControl(db).generation);}
  }
  db.prepare('INSERT INTO runs_recovery_lease VALUES(?,?,?,?) ON CONFLICT(source,location) DO UPDATE SET producer=excluded.producer,at=excluded.at').run(source,location,producer,now);
}
export function pendingRecoveryAt(db:DatabaseSync,source:string,directory:string):string|null {
  if(!runControl(db).enabled)return null;
  return db.prepare("SELECT root FROM runs_jobs WHERE source=? AND state='pending' AND root IN(SELECT id FROM sessions WHERE source=? AND json_extract(actor,'$.directory')=?) ORDER BY rowid LIMIT 1").get(source,source,directory)?.root as string??null;
}
export function claimRecovery(db:DatabaseSync,source:string,root:string):RecoveryJob|null {
  const c=runControl(db);if(!c.enabled)return null;
  const r=db.prepare("SELECT request_id,generation FROM runs_jobs WHERE source=? AND root=? AND state='pending'").get(source,root);if(!r||r.generation!==c.generation)return null;
  const claim=randomUUID();db.prepare("UPDATE runs_jobs SET state='running',claim=? WHERE source=? AND root=?").run(claim,source,root);bump(db);return {source,root,generation:c.generation,claim,requestId:String(r.request_id)};
}
export function recoveryAlive(db:DatabaseSync,j:RecoveryJob) {
  const c=runControl(db);return c.enabled&&c.generation===j.generation&&!!db.prepare("SELECT 1 FROM runs_jobs WHERE source=? AND root=? AND request_id=? AND claim=? AND state='running'").get(j.source,j.root,j.requestId,j.claim);
}
export interface HistoricalSession { id:string; parent:string; agent:string|null; title:string|null; createdAt:number; updatedAt:number; idleAt:number|null; outcome:'succeeded'|'failed'|'interrupted'|null }
export function publishHistory(db:DatabaseSync,j:RecoveryJob,s:HistoricalSession) {
  if(!recoveryAlive(db,j))return;
  need(identifier(s.id)&&identifier(s.parent)&&integer(s.createdAt)&&integer(s.updatedAt)&&(s.idleAt===null||integer(s.idleAt)));
  const recorded=db.prepare('SELECT payload FROM runs_rows WHERE source=? AND child=? AND message IS NOT NULL ORDER BY at DESC LIMIT 2').all(j.source,s.id).map(v=>row(v.payload));
  if(recorded.length){
    // Metadata has no execution ID. Even a newer idle could belong to an unseen
    // resumed execution. Never certify a dispatch from that ambiguous observation.
    if(s.idleAt===null||s.outcome===null||recorded.some(r=>r.ran.endedAt===s.idleAt&&r.ran.state===s.outcome))return;
  }
  const id=hash(['history',j.source,s.id]);if(db.prepare('SELECT 1 FROM runs_rows WHERE id=?').get(id))return;
  if(!capacity(db,{source:j.source,parent:s.parent}))return;
  const ended=s.idleAt!==null&&s.idleAt>=s.createdAt?s.idleAt:null;
  const r:RunRow={id,kind:'historical-session',source:j.source,parentSessionId:s.parent,childSessionId:s.id,tool:null,agent:metadataString(s.agent,80),description:metadataString(s.title,200),dispatch:null,planContext:null,ran:{state:ended!==null&&['succeeded','failed','interrupted'].includes(String(s.outcome))?s.outcome!:'unknown',dispatchState:'historical',startedAt:null,endedAt:ended,updatedAt:s.updatedAt,provenance:'native-session',eventId:null,sequence:null,errorType:null,interruptionReason:null},claimed:null,accepted:null};
  db.prepare('INSERT INTO runs_rows VALUES(?,?,?,?,NULL,NULL,?,?,?,?)').run(id,j.source,s.parent,s.id,j.generation,Number(['succeeded','failed','interrupted'].includes(r.ran.state)),s.createdAt,JSON.stringify(r));bump(db);
}
export function finishRecovery(db:DatabaseSync,j:RecoveryJob,state:'complete'|'partial'|'failed') {
  if(!recoveryAlive(db,j))return;
  db.prepare('UPDATE runs_jobs SET state=?,claim=NULL,token=?,reason=? WHERE source=? AND root=?').run(state,state==='complete'?null:randomUUID(),state==='partial'?'budget':state==='failed'?'capture-unavailable':null,j.source,j.root);bump(db);
  if(state==='complete')db.prepare('DELETE FROM runs_recovery_work WHERE source=? AND root=?').run(j.source,j.root);
}
