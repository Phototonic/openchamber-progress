import type { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { identifier, requireProgress as need, type Actor, type Request, type HandoffRequest, type Receipt } from './progress.ts';
import { cleanupInstalled, cleanupState } from './cleanup.ts';
import { canonical } from './canonical.ts';

/** Sub-agent runs revision 1. Neither a run nor a claim is task-report authority. */
export const RUN_LIMITS = Object.freeze({ parent:1024, total:16384, candidates:256, candidateAdoptionMs:300000, observationEpochs:32, jobs:64, claims:256, intents:128, page:50, dtoBytes:4096, responseBytes:262144, queryBytes:16384, cursorBytes:4096, traversal:2000, depth:32, calls:64, elapsedMs:10000 });
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
interface StartEvidence { event:ExecutionObservation; epochs:number[]; ambiguous?:boolean }
interface Candidate { start:ExecutionObservation|null; end:ExecutionObservation|null; startEpoch?:number; endEpoch?:number; startEpochs?:number[]; endEpochs?:number[]; startEvidence?:Record<string,StartEvidence>; ambiguous?:boolean }
export interface RecoveryJob { source:string; root:string; generation:number; claim:string; requestId:string }

const definitions:Record<string,string> = {
  runs_format:'CREATE TABLE runs_format(singleton INTEGER PRIMARY KEY CHECK(singleton=1), version INTEGER NOT NULL CHECK(version=1), revision INTEGER NOT NULL, generation INTEGER NOT NULL, loss INTEGER NOT NULL CHECK(loss IN(0,1)))',
  runs_observation_epoch:'CREATE TABLE runs_observation_epoch(singleton INTEGER PRIMARY KEY CHECK(singleton=1), epoch INTEGER NOT NULL, invalid_through INTEGER NOT NULL)',
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
  runs_capture_epoch:`CREATE TRIGGER runs_capture_epoch AFTER UPDATE OF enabled ON meta WHEN NEW.enabled != OLD.enabled BEGIN UPDATE runs_format SET generation=generation+1,revision=revision+1 WHERE singleton=1; UPDATE runs_observation_epoch SET invalid_through=epoch,epoch=epoch+1 WHERE singleton=1; UPDATE runs_jobs SET state='failed',claim=NULL,token=lower(hex(randomblob(16))),reason='capture-disabled' WHERE state IN('pending','running'); DELETE FROM runs_candidates; UPDATE receipts SET receipt=json_set(receipt,'$.delegation.state','retired','$.delegation.reason','capture-disabled') WHERE EXISTS(SELECT 1 FROM runs_intents i WHERE i.source=receipts.source AND i.plan=receipts.plan AND i.oid=receipts.oid); DELETE FROM runs_intents; END`,
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
  const epochs=db.prepare('SELECT * FROM runs_observation_epoch').all();
  need(epochs.length===1&&epochs[0].singleton===1&&integer(epochs[0].epoch)&&integer(epochs[0].invalid_through)&&Number(epochs[0].invalid_through)<=Number(epochs[0].epoch),'schema');
  return true;
}
/** Caller owns BEGIN IMMEDIATE. Reads never call this. */
export function installRuns(db:DatabaseSync) {
  // Explicit companion activation may upgrade only the exact prior extension.
  // GET/read-only opens never migrate, and foreign/partial schemas still fail.
  const installed=db.prepare("SELECT name,sql FROM sqlite_master WHERE name GLOB 'runs_*'").all();
  if(installed.length&&!installed.some(r=>r.name==='runs_observation_epoch')){
    const prior={...definitions};delete prior.runs_observation_epoch;
    prior.runs_capture_epoch=prior.runs_capture_epoch!.replace(' UPDATE runs_observation_epoch SET invalid_through=epoch,epoch=epoch+1 WHERE singleton=1;','');
    need(installed.length===Object.keys(prior).length&&installed.every(r=>typeof r.name==='string'&&prior[r.name]!==undefined&&normalized(String(r.sql))===normalized(prior[r.name]!)),'schema');
    db.exec(definitions.runs_observation_epoch!);db.exec('INSERT INTO runs_observation_epoch VALUES(1,0,0)');
    db.exec('DROP TRIGGER runs_capture_epoch');db.exec(definitions.runs_capture_epoch!);
  }
  if(runsInstalled(db))return;
  for(const sql of Object.values(definitions))db.exec(sql);
  db.exec('INSERT INTO runs_format VALUES(1,1,0,0,0)');
  db.exec('INSERT INTO runs_observation_epoch VALUES(1,0,0)');
}
export function runControl(db:DatabaseSync) {
  need(runsInstalled(db),'schema');
  const r=db.prepare('SELECT enabled,generation FROM meta JOIN runs_format USING(singleton)').get()!;
  return {enabled:r.enabled===1,generation:Number(r.generation)};
}
function bump(db:DatabaseSync) { db.exec('UPDATE runs_format SET revision=revision+1 WHERE singleton=1'); }
function loss(db:DatabaseSync) { db.exec('UPDATE runs_format SET loss=1,revision=revision+1 WHERE singleton=1'); }
export function observationEpoch(db:DatabaseSync):number {return Number(db.prepare('SELECT epoch FROM runs_observation_epoch WHERE singleton=1').get()!.epoch);}
export function observationInterrupted(db:DatabaseSync,epoch:number):boolean {return epoch<=Number(db.prepare('SELECT invalid_through FROM runs_observation_epoch WHERE singleton=1').get()!.invalid_through);}
/** Allocate durable stream identity; separate observers retain their own token. */
export function beginObservation(db:DatabaseSync):number {db.exec('UPDATE runs_observation_epoch SET epoch=epoch+1 WHERE singleton=1');bump(db);return observationEpoch(db);}
export function runCaptureUnavailable(db:DatabaseSync) { if(runsInstalled(db)){db.exec('UPDATE runs_observation_epoch SET invalid_through=epoch,epoch=epoch+1 WHERE singleton=1');loss(db);} }
function claimValue(value:unknown):NonNullable<RunRow['claimed']> {
  need(obj(value)&&Object.keys(value).length===6&&Object.keys(value).every(k=>['oid','outcome','summary','reportedAt','sessionId','association'].includes(k))&&identifier(value.oid)&&identifier(value.sessionId)&&['done','partial','blocked'].includes(value.outcome)&&typeof value.summary==='string'&&value.summary.trim().length>0&&value.summary.length<=200&&!/[\u0000\r\n\u2028\u2029]/.test(value.summary)&&integer(value.reportedAt)&&['execution','session-only'].includes(value.association),'corrupt');
  return {oid:value.oid,outcome:value.outcome,summary:value.summary,reportedAt:value.reportedAt,sessionId:value.sessionId,association:value.association};
}
type ClaimFence=[string,string];
type StartEvent=[string,number];
function startEvent(value:unknown):StartEvent {
  need(Array.isArray(value)&&value.length===2&&identifier(value[0])&&integer(value[1]),'corrupt');return value as StartEvent;
}
function epochList(value:unknown):number[] {
  need(Array.isArray(value)&&value.length<=RUN_LIMITS.observationEpochs&&value.every(integer)&&new Set(value).size===value.length,'corrupt');return value as number[];
}
function eventEpochs(c:Candidate,kind:'start'|'end'):number[] {
  const list=c[kind==='start'?'startEpochs':'endEpochs'],single=c[kind==='start'?'startEpoch':'endEpoch'];
  return list!==undefined?epochList(list):single!==undefined?epochList([single]):[];
}
function candidateStarts(c:Candidate):StartEvidence[] {
  return [...Object.values(c.startEvidence??{}),...(c.start?[{event:c.start,epochs:eventEpochs(c,'start'),ambiguous:c.ambiguous}]:[])].sort((a,b)=>a.event.sequence-b.event.sequence);
}
function dropCandidateStart(c:Candidate,id:string) {
  if(c.start?.id===id){c.start=null;c.ambiguous=false;}
  if(c.startEvidence)delete c.startEvidence[id];
}
function mergeEpochs(db:DatabaseSync,known:number[],observed:number[]):number[] {
  const merged=[...new Set([...known,...observed])];
  if(merged.length>RUN_LIMITS.observationEpochs){runCaptureUnavailable(db);return known;}
  return merged;
}
function runEventEpochs(db:DatabaseSync,r:RunRow,kind:'start'|'end'):number[] {
  const value=db.prepare(`SELECT json_extract(payload,'$._${kind}Epochs') AS epochs,json_extract(payload,'$._epoch') AS epoch FROM runs_rows WHERE id=?`).get(r.id);
  return value?.epochs?epochList(JSON.parse(String(value.epochs))):integer(value?.epoch)?[Number(value.epoch)]:[];
}
function claimFence(value:unknown):ClaimFence {
  need(Array.isArray(value)&&value.length===2&&identifier(value[0])&&typeof value[1]==='string'&&/^[a-f0-9]{64}$/.test(value[1]),'corrupt');
  return value as ClaimFence;
}
function row(value:unknown):RunRow {
  need(typeof value==='string'&&Buffer.byteLength(value)<=RUN_LIMITS.dtoBytes,'corrupt');
  let r:RunRow&{_retiredClaim?:unknown;_startEvent?:unknown;_epoch?:unknown;_startEpochs?:unknown;_endEpochs?:unknown;_refresh?:unknown};try{r=JSON.parse(value);}catch{need(false,'corrupt');}
  need(obj(r!)&&identifier(r.id)&&identifier(r.source)&&identifier(r.parentSessionId)&&(r.childSessionId===null||identifier(r.childSessionId))&&obj(r.ran)&&['unknown','running','succeeded','failed','interrupted'].includes(r.ran.state),'corrupt');
  if(Object.hasOwn(r,'_retiredClaim')){need(r.childSessionId!==null,'corrupt');claimFence(r._retiredClaim);delete r._retiredClaim;}
  if(Object.hasOwn(r,'_startEvent')){need(r.childSessionId!==null&&r.ran.startedAt!==null,'corrupt');startEvent(r._startEvent);delete r._startEvent;}
  if(Object.hasOwn(r,'_epoch')){need(integer(r._epoch),'corrupt');delete r._epoch;}
  for(const key of ['_startEpochs','_endEpochs'] as const)if(Object.hasOwn(r,key)){epochList(r[key]);delete r[key];}
  if(Object.hasOwn(r,'_refresh')){need(Array.isArray(r._refresh)&&r._refresh.length===2&&integer(r._refresh[0])&&typeof r._refresh[1]==='boolean','corrupt');delete r._refresh;}
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
function save(db:DatabaseSync,r:RunRow,retiredClaim?:ClaimFence,provenStart?:StartEvent,evidence?:{start?:number[];end?:number[]}) {
  const existing=db.prepare("SELECT json_extract(payload,'$._retiredClaim') AS fence,json_extract(payload,'$._startEvent') AS start,json_extract(payload,'$._epoch') AS epoch,json_extract(payload,'$._startEpochs') AS start_epochs,json_extract(payload,'$._endEpochs') AS end_epochs,json_extract(payload,'$.ran.eventId') AS event,json_extract(payload,'$._refresh') AS refresh FROM runs_rows WHERE id=?").get(r.id);
  const fence=retiredClaim??(existing?.fence?claimFence(JSON.parse(String(existing.fence))):undefined);
  const start=provenStart??(existing?.start?startEvent(JSON.parse(String(existing.start))):undefined);
  const startEpochs=evidence?.start??(existing?.start_epochs?epochList(JSON.parse(String(existing.start_epochs))):undefined);
  const endEpochs=r.ran.endedAt===null?undefined:evidence?.end??(existing?.event===r.ran.eventId&&existing?.end_epochs?epochList(JSON.parse(String(existing.end_epochs))):undefined);
  const text=JSON.stringify({...r,...(fence?{_retiredClaim:fence}:{}),...(start?{_startEvent:start}:{}),...(existing?.epoch!==null&&existing?.epoch!==undefined?{_epoch:existing.epoch}:{}),...(startEpochs?{_startEpochs:startEpochs}:{}),...(endEpochs?{_endEpochs:endEpochs}:{}),...(existing?.refresh?{_refresh:JSON.parse(String(existing.refresh))}:{})});need(Buffer.byteLength(text)<=RUN_LIMITS.dtoBytes,'invalid');
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
    const dropped=JSON.parse(String(victim.payload))._retiredClaim as ClaimFence|undefined;
    if((r.claimed||dropped)&&r.childSessionId) {
      // A bounded retirement fence rejects a pruned handoff retry. If safety
      // fences use the entire budget, admission refuses rather than dropping one.
      const fences=new Map<string,string>(dropped?[dropped]:[]);
      if(r.claimed)fences.set(r.claimed.oid,hash([r.claimed.outcome,r.claimed.summary]));
      if(retainedCount(db)+fences.size-1>RUN_LIMITS.total){loss(db);return false;}
      for(const [oid,digest] of fences)db.prepare('INSERT INTO runs_retired VALUES(?,?,?,?,?) ON CONFLICT(source,child,oid) DO UPDATE SET execution=max(execution,excluded.execution)').run(r.source,r.childSessionId,r.ran.sequence??0,oid,digest);
    }
    db.prepare('DELETE FROM runs_rows WHERE id=?').run(victim.id);loss(db);
  }
  return false;
}
export function metadataString(v:unknown,max:number):string|null { return typeof v==='string'?v.replace(/[\u0000\r\n\t\u2028\u2029]/g,' ').slice(0,max)||null:null; }
export function safeErrorType(v:unknown):string { return typeof v==='string'&&/^[A-Za-z0-9_.:-]{1,80}$/.test(v)?v:'unknown'; }
function hash(v:unknown) {return createHash('sha256').update(canonical(v)).digest('hex');}
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
function claimFits(db:DatabaseSync,r:RunRow,claim:NonNullable<RunRow['claimed']>,start=provenStart(db,r)) {
  if(!start||claim.reportedAt<start.at||r.ran.endedAt!==null&&claim.reportedAt>r.ran.endedAt)return false;
  const next=nextStart(db,start);
  return !next||next.at>=start.at&&claim.reportedAt<next.at;
}
function claimOwners(db:DatabaseSync,source:string,child:string,claim:NonNullable<RunRow['claimed']>) {
  return db.prepare(`SELECT payload FROM runs_rows WHERE source=? AND child=? AND message IS NOT NULL
    AND json_extract(payload,'$.ran.startedAt')<=? AND (json_extract(payload,'$.ran.endedAt') IS NULL OR json_extract(payload,'$.ran.endedAt')>=?)
    ORDER BY coalesce(json_extract(payload,'$._startEvent[1]'),CASE WHEN json_extract(payload,'$.ran.state')='running' THEN json_extract(payload,'$.ran.sequence') END) DESC LIMIT 2`).all(source,child,claim.reportedAt,claim.reportedAt).map(v=>row(v.payload)).filter(r=>claimFits(db,r,claim));
}
function attachClaim(db:DatabaseSync,r:RunRow) {
  if(!r.childSessionId||r.ran.startedAt===null||r.claimed)return;
  const claims=db.prepare('SELECT * FROM runs_claims WHERE source=? AND child=? LIMIT 2').all(r.source,r.childSessionId);
  const matching=claims.filter(c=>claimFits(db,r,claimValue(JSON.parse(String(c.payload))))&&(Number(c.execution)===0||Number(c.execution)<=Number(r.ran.sequence)));
  if(matching.length!==1)return;
  const claim=claimValue(JSON.parse(String(matching[0]!.payload))),owners=claimOwners(db,r.source,r.childSessionId,claim);
  if(owners.length!==1||owners[0]!.id!==r.id)return;
  r.claimed={...claim,association:'execution'};save(db,r);db.prepare('DELETE FROM runs_claims WHERE source=? AND child=? AND execution=?').run(r.source,r.childSessionId,matching[0]!.execution!);
}
function reassociateClaims(db:DatabaseSync,source:string,child:string) {
  for(const staged of db.prepare('SELECT payload FROM runs_claims WHERE source=? AND child=? LIMIT ?').all(source,child,RUN_LIMITS.claims)){
    const claim=claimValue(JSON.parse(String(staged.payload)));
    const owners=claimOwners(db,source,child,claim);
    if(owners.length===1)attachClaim(db,owners[0]!);
  }
}
export function handoff(db:DatabaseSync,r:HandoffRequest,actor:Actor,now:number) {
  need(runControl(db).enabled,'disabled');need(actor.verifiedSource&&identifier(actor.parentId)&&actor.ancestry?.[0]===actor.parentId&&actor.ancestry.length<=32,'assignment');
  need(db.prepare('SELECT verified FROM sources WHERE id=?').get(actor.sourceId)?.verified===1,'source-unverified');
  const existing=db.prepare("SELECT payload FROM runs_rows WHERE source=? AND child=? AND json_extract(payload,'$.claimed.oid')=? LIMIT 1").get(actor.sourceId,actor.sessionId,r.oid);
  if(existing){const claim=row(existing.payload).claimed!;need(hash([claim.outcome,claim.summary])===claimHash(r),'operation-reused');return {handoff:claim};}
  const oldClaim=db.prepare('SELECT hash FROM runs_retired WHERE source=? AND child=? AND oid=?').get(actor.sourceId,actor.sessionId,r.oid)
    ??db.prepare("SELECT json_extract(payload,'$._retiredClaim[1]') AS hash FROM runs_rows WHERE source=? AND child=? AND json_extract(payload,'$._retiredClaim[0]')=? LIMIT 1").get(actor.sourceId,actor.sessionId,r.oid);
  if(oldClaim){need(oldClaim.hash===claimHash(r),'operation-reused');need(false,'not-found');}
  const retired=db.prepare('SELECT max(execution) AS execution FROM runs_retired WHERE source=? AND child=?').get(actor.sourceId,actor.sessionId);
  const c=candidate(db,actor.sourceId,actor.sessionId);
  const retained=db.prepare("SELECT json_extract(payload,'$.ran.sequence') AS seq,json_extract(payload,'$.ran.startedAt') AS started_at FROM runs_rows WHERE source=? AND child=? AND json_extract(payload,'$.ran.state')='running' ORDER BY at DESC LIMIT 1").get(actor.sourceId,actor.sessionId);
  const execution=c?.start?.sequence??Number(retained?.seq??0);
  const staged=db.prepare('SELECT oid,hash,payload FROM runs_claims WHERE source=? AND child=? AND (execution=? OR oid=?) LIMIT 1').get(actor.sourceId,actor.sessionId,execution,r.oid);
  if(staged){need(staged.oid===r.oid,'conflict');need(staged.hash===claimHash(r),'operation-reused');return {handoff:claimValue(JSON.parse(String(staged.payload)))};}
  const runs=db.prepare('SELECT payload FROM runs_rows WHERE source=? AND child=? ORDER BY at DESC LIMIT 2').all(actor.sourceId,actor.sessionId).map(v=>row(v.payload));
  const current=claimOwners(db,actor.sourceId,actor.sessionId,{oid:r.oid,outcome:r.outcome,summary:r.summary,reportedAt:now,sessionId:actor.sessionId,association:'session-only'});
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
export function beforeRun(db:DatabaseSync,k:DispatchKey,actor:Actor,tool:'subagent'|'task',input:unknown,at:number,epoch=observationEpoch(db)) {
  validKey(k);need(integer(at)&&integer(epoch));const control=runControl(db);if(!control.enabled)return;
  need(actor.verifiedSource&&actor.sourceId===k.source&&actor.sessionId===k.parent&&actor.ancestry!==null,'binding');
  need(db.prepare('SELECT verified FROM sources WHERE id=?').get(k.source)?.verified===1,'binding');
  const id=keyId(k);if(db.prepare('SELECT 1 FROM runs_rows WHERE id=?').get(id))return;
  if(!capacity(db,k))return;
  const i=obj(input)?input:{};
  const intent=tool==='subagent'?activeIntent(db,k.source,k.parent):null;
  const r:RunRow={id,kind:'dispatch',source:k.source,parentSessionId:k.parent,childSessionId:null,tool,agent:metadataString(i.agent,80),description:metadataString(i.description??i.title,200),dispatch:{messageId:k.message,callId:k.call,at},planContext:intent&&!intent.dispatch?{plan:intent.request.plan,revision:intent.request.rev!,observedAt:at}:associatedPlan(db,actor,at),ran:{state:'unknown',dispatchState:'pending',startedAt:null,endedAt:null,updatedAt:at,provenance:'dispatch',eventId:null,sequence:null,errorType:null,interruptionReason:null},claimed:null,accepted:null};
  db.prepare('INSERT INTO runs_rows VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,k.source,k.parent,null,k.message,k.call,control.generation,0,at,JSON.stringify({...r,_epoch:epoch}));
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
  if(!r.dispatch||!r.childSessionId||!c.start||c.ambiguous||c.start.at<r.dispatch.at)return false;
  if(r.ran.startedAt!==null&&r.ran.startedAt!==c.start.at)return false;
  // Only calls admitted by the candidate's start could own an unassociated
  // interval. Once its start is proven, later pending calls cannot block its end.
  if(r.ran.startedAt===null){
    const generation=runControl(db).generation;
    // Capture gaps cannot prove which later execution belongs to an old call.
    // Terminal routing separately requires continuity across generation changes.
    const stored=db.prepare("SELECT generation,json_extract(payload,'$._epoch') AS epoch FROM runs_rows WHERE id=?").get(r.id);
    if(stored?.generation!==generation||!integer(stored.epoch)||!eventEpochs(c,'start').includes(stored.epoch))return false;
    const staged=candidate(db,r.source,r.childSessionId);
    if(staged&&candidateStarts(staged).some(s=>s.event.sequence<c.start!.sequence&&s.event.at>=r.dispatch!.at&&!db.prepare("SELECT 1 FROM runs_rows WHERE source=? AND child=? AND json_extract(payload,'$._startEvent[0]')=? LIMIT 1").get(r.source,r.childSessionId,s.event.id)))return false;
    if(db.prepare("SELECT 1 FROM runs_rows WHERE source=? AND parent=? AND id!=? AND generation=? AND json_extract(payload,'$._epoch')=? AND child IS NULL AND json_extract(payload,'$.tool')='subagent' AND json_extract(payload,'$.ran.dispatchState')='pending' AND at<=? LIMIT 1").get(r.source,r.parentSessionId,r.id,generation,stored.epoch!,c.start.at))return false;
    // Only still-unassociated calls can compete for a new start. A proven
    // earlier interval is not a competitor, nor can a start be reused.
    if(db.prepare(`SELECT 1 FROM (SELECT terminal,at,generation,json_extract(payload,'$._epoch') AS epoch,json_extract(payload,'$.ran.startedAt') AS started,
      coalesce(json_extract(payload,'$._startEvent[1]'),CASE WHEN json_extract(payload,'$.ran.state')='running' THEN json_extract(payload,'$.ran.sequence') END) AS sequence
      FROM runs_rows WHERE source=? AND child=? AND message IS NOT NULL AND id!=?)
       WHERE (terminal=0 AND generation=? AND epoch=? AND started IS NULL AND at<=?) OR sequence=? OR (sequence>? AND started<?) OR (sequence<? AND started>?) LIMIT 1`).get(r.source,r.childSessionId,r.id,generation,stored.epoch!,c.start.at,c.start.sequence,c.start.sequence,c.start.at,c.start.sequence,c.start.at))return false;
  }
  const e=c.end&&c.end.sequence>c.start.sequence&&c.end.at>=c.start.at?c.end:c.start;
  if(r.ran.endedAt!==null){if(e===c.start||e.sequence>=Number(r.ran.sequence))return false;}
  else if(r.ran.sequence!==null&&e.sequence<=r.ran.sequence){attachClaim(db,r);return false;}
  recomputeInterval(db,r,c.start,e===c.start?null:e,{start:eventEpochs(c,'start'),end:eventEpochs(c,'end')});return true;
}
/** The only writer of interval bounds: validate host chronology and claims together. */
function recomputeInterval(db:DatabaseSync,r:RunRow,start:ExecutionObservation,end:ExecutionObservation|null,evidence?:{start?:number[];end?:number[]}):ExecutionObservation|null {
  const next=nextStart(db,start);
  const wrongOwner=end&&(end.sequence<=start.sequence||next&&end.sequence>=next.sequence);
  const badClock=next&&next.at<start.at||end&&(end.at<start.at||!wrongOwner&&next&&end.at>next.at);
  if(badClock)loss(db);
  const displaced=end&&(wrongOwner||badClock)?end:null;
  if(displaced)end=null;
  const e=end??start;
  // Refining bounds cannot clear an unresolved capture-gap outcome. Only a
  // terminal with proven ownership may replace it with a known outcome.
  const state=!end&&r.ran.startedAt!==null&&r.ran.state==='unknown'?'unknown':e.state;
  r.ran={...r.ran,state,startedAt:start.at,endedAt:end?.at??null,updatedAt:e.at,provenance:'native-event',eventId:e.id,sequence:e.sequence,errorType:e.errorType,interruptionReason:e.interruptionReason};
  let retiredClaim:ClaimFence|undefined;
  let restaged=false;
  if(r.claimed&&!claimFits(db,r,r.claimed,start)){
    // Host terminal facts take priority over an invalid claim association.
    // Restage only in spare capacity; never prune runs or reject the terminal
    // to retain this lower-priority claim. Slot/operation conflicts also lose
    // only this claim, with the existing bounded capture-loss disclosure.
    const claim={...r.claimed,association:'session-only' as const};
    const room=Number(db.prepare('SELECT count(*) AS n FROM runs_claims').get()!.n)<RUN_LIMITS.claims&&retainedCount(db)<RUN_LIMITS.total;
    restaged=room&&Boolean(db.prepare('INSERT INTO runs_claims VALUES(?,?,?,?,?,?) ON CONFLICT DO NOTHING').run(r.source,r.childSessionId,0,claim.oid,hash([claim.outcome,claim.summary]),JSON.stringify(claim)).changes);
    if(!restaged){
      // Reuse the affected row's storage: one compact fence is smaller than
      // the removed claim and requires no free bookkeeping slot.
      retiredClaim=[claim.oid,hash([claim.outcome,claim.summary])];loss(db);
    }
    r.claimed=null;
  }
  save(db,r,retiredClaim,[start.id,start.sequence],evidence);attachClaim(db,r);
  if(restaged)reassociateClaims(db,r.source,start.child);
  return displaced;
}

function provenStart(db:DatabaseSync,r:RunRow):ExecutionObservation|null {
  const stored=db.prepare("SELECT json_extract(payload,'$._startEvent') AS start FROM runs_rows WHERE id=?").get(r.id);
  const proof=stored?.start?startEvent(JSON.parse(String(stored.start))):r.ran.state==='running'&&r.ran.eventId&&r.ran.sequence!==null?[r.ran.eventId,r.ran.sequence] as StartEvent:null;
  return proof&&r.childSessionId&&r.ran.startedAt!==null?{source:r.source,child:r.childSessionId,id:proof[0],sequence:proof[1],at:r.ran.startedAt,state:'running',errorType:null,interruptionReason:null}:null;
}
function provenEnd(r:RunRow):ExecutionObservation|null {
  return r.childSessionId&&r.ran.endedAt!==null&&r.ran.eventId&&r.ran.sequence!==null&&['succeeded','failed','interrupted'].includes(r.ran.state)?{source:r.source,child:r.childSessionId,id:r.ran.eventId,sequence:r.ran.sequence,at:r.ran.endedAt,state:r.ran.state as ExecutionObservation['state'],errorType:r.ran.errorType,interruptionReason:r.ran.interruptionReason}:null;
}
function nextStart(db:DatabaseSync,start:ExecutionObservation):ExecutionObservation|null {
  const stored=db.prepare(`SELECT payload,coalesce(json_extract(payload,'$._startEvent[1]'),CASE WHEN json_extract(payload,'$.ran.state')='running' THEN json_extract(payload,'$.ran.sequence') END) AS sequence
    FROM runs_rows WHERE source=? AND child=? AND message IS NOT NULL AND sequence>? ORDER BY sequence LIMIT 1`).get(start.source,start.child,start.sequence);
  const known=stored?provenStart(db,row(stored.payload)):null,c=candidate(db,start.source,start.child),pending=c&&candidateStarts(c).find(s=>s.event.sequence>start.sequence)?.event;
  return pending&&pending.sequence>start.sequence&&(!known||pending.sequence<known.sequence)?pending:known;
}
function routeTerminal(db:DatabaseSync,e:ExecutionObservation,observed:number[]):{handled:boolean;displaced?:ExecutionObservation;displacedEpochs?:number[]} {
  const rows=db.prepare(`SELECT payload,generation,json_extract(payload,'$._epoch') AS epoch,coalesce(json_extract(payload,'$._startEvent[1]'),CASE WHEN json_extract(payload,'$.ran.state')='running' THEN json_extract(payload,'$.ran.sequence') END) AS sequence
    FROM runs_rows WHERE source=? AND child=? AND message IS NOT NULL AND sequence<? ORDER BY sequence DESC LIMIT 2`).all(e.source,e.child,e.sequence);
  const r=rows[0]&&row(rows[0].payload),start=r&&provenStart(db,r);
  if(!r||!start)return {handled:false};
  if(rows[1]?.sequence===start.sequence){loss(db);return {handled:false};}
  // An observed later start is an interval boundary even while its dispatch
  // identity is unresolved. A later dispatch alone is not execution evidence.
  const pending=candidate(db,e.source,e.child)?.start;
  if(pending&&pending.sequence>start.sequence&&pending.sequence<e.sequence){if(pending.at>e.at)loss(db);return {handled:false};}
  const next=nextStart(db,start);
  if(next&&next.sequence<=e.sequence){loss(db);return {handled:false};}
  if(e.at<start.at||next&&(next.at<start.at||e.at>next.at)){loss(db);return {handled:false};}
  const prior=provenEnd(r);
  if(prior?.sequence===e.sequence){
    if(prior.id!==e.id){loss(db);return {handled:false};}
    const known=runEventEpochs(db,r,'end'),merged=mergeEpochs(db,known,observed);
    if(merged.length!==known.length)save(db,r,undefined,undefined,{end:merged});
    return {handled:true};
  }
  if(prior&&prior.sequence<e.sequence)return {handled:false};
  // Capture settings alone do not prove observation continuity across a reload
  // or subscription loss. Adjacent durable sequence numbers are positive proof;
  // ordinary session events also consume sequence, so never assume adjacency.
  const startEpochs=runEventEpochs(db,r,'start');
  if((rows[0]!.generation!==runControl(db).generation||!observed.some(epoch=>startEpochs.includes(epoch)))&&e.sequence!==start.sequence+1){
    if(r.ran.endedAt===null&&r.ran.state!=='unknown'){r.ran.state='unknown';save(db,r);}
    refreshGapOutcome(db,r,e);
    loss(db);return {handled:false};
  }
  const priorEpochs=prior?runEventEpochs(db,r,'end'):undefined;
  return adopt(db,r,{start,end:e,startEpochs,endEpochs:observed})?{handled:true,...(prior?{displaced:prior,displacedEpochs:priorEpochs}:{})}:{handled:false};
}
function correlate(db:DatabaseSync,source:string,child:string) {
  const c=candidate(db,source,child);if(!c)return;
  for(const evidence of candidateStarts(c)){
    const start=evidence.event,epochs=evidence.epochs;
    if(evidence.ambiguous)continue;
    const owners=epochs.length?db.prepare(`SELECT payload FROM runs_rows WHERE source=? AND child=? AND generation=? AND json_extract(payload,'$._epoch') IN (${epochs.map(()=>'?').join(',')}) AND message IS NOT NULL AND terminal=0
      AND json_extract(payload,'$.ran.startedAt') IS NULL AND at<=? LIMIT 2`).all(source,child,runControl(db).generation,...epochs,start.at):[];
    if(owners.length===1&&adopt(db,row(owners[0]!.payload),{start,end:null,startEpochs:epochs}))dropCandidateStart(c,start.id);
  }
  while(c.end){const routed=routeTerminal(db,c.end,eventEpochs(c,'end'));if(!routed.handled)break;c.end=routed.displaced??null;c.endEpochs=routed.displacedEpochs;c.endEpoch=undefined;}
  if(!candidateStarts(c).length&&!c.end)db.prepare('DELETE FROM runs_candidates WHERE source=? AND child=?').run(source,child);
  else db.prepare('UPDATE runs_candidates SET payload=? WHERE source=? AND child=?').run(JSON.stringify(c),source,child);
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
  for(const other of db.prepare('SELECT DISTINCT child FROM runs_rows WHERE source=? AND parent=? AND child IS NOT NULL AND terminal=0 LIMIT 1024').all(k.source,k.parent))correlate(db,k.source,String(other.child));
}
export function observeExecution(db:DatabaseSync,e:ExecutionObservation,epoch=observationEpoch(db)) {
  const control=runControl(db);if(!control.enabled)return;
  need(integer(epoch)&&identifier(e.source)&&identifier(e.child)&&identifier(e.id)&&integer(e.sequence)&&integer(e.at)&&['running','succeeded','failed','interrupted'].includes(e.state),'invalid');
  e={source:e.source,child:e.child,id:e.id,sequence:e.sequence,at:e.at,state:e.state,errorType:e.state==='failed'?safeErrorType(e.errorType):null,interruptionReason:e.state==='interrupted'&&['user','shutdown','superseded','inactivity'].includes(String(e.interruptionReason))?e.interruptionReason:e.state==='interrupted'?'unknown':null};
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
  const c=candidate(db,e.source,e.child)??{start:null,end:null};
  let refine:RunRow|undefined;
  let routed=false;
  if(e.state!=='running'){
    const result=routeTerminal(db,e,[epoch]);routed=result.handled;
    if(routed){if(c.end?.sequence===e.sequence)c.end=null;if(result.displaced&&(!c.end||result.displaced.sequence>c.end.sequence)){c.end=result.displaced;c.endEpochs=result.displacedEpochs;c.endEpoch=undefined;}}
  }else{
    const retained=db.prepare(`SELECT payload FROM runs_rows WHERE source=? AND child=? AND message IS NOT NULL AND
      coalesce(json_extract(payload,'$._startEvent[1]'),CASE WHEN json_extract(payload,'$.ran.state')='running' THEN json_extract(payload,'$.ran.sequence') END)=? LIMIT 1`).get(e.source,e.child,e.sequence);
    if(retained){
      const r=row(retained.payload),proof=provenStart(db,r)!;
      if(proof.id!==e.id||proof.at!==e.at){loss(db);return;}
      const known=runEventEpochs(db,r,'start'),merged=mergeEpochs(db,known,[epoch]);
      if(merged.length!==known.length)save(db,r,undefined,undefined,{start:merged});
      correlate(db,e.source,e.child);return;
    }
    // Every new start refines the previous sequence interval, regardless of
    // timestamp ordering or whether that interval has a terminal yet.
    const previous=db.prepare(`SELECT payload,coalesce(json_extract(payload,'$._startEvent[1]'),CASE WHEN json_extract(payload,'$.ran.state')='running' THEN json_extract(payload,'$.ran.sequence') END) AS sequence
      FROM runs_rows WHERE source=? AND child=? AND message IS NOT NULL AND sequence<? ORDER BY sequence DESC LIMIT 2`).all(e.source,e.child,e.sequence);
    if(previous[0]&&previous[1]?.sequence!==previous[0].sequence)refine=row(previous[0].payload);
    else if(previous.length>1)loss(db);
    // Old orphan starts that precede retained proof and every possible call
    // cannot own an interval here, and must not poison a future fresh start.
    if(!refine&&db.prepare(`SELECT 1 FROM runs_rows WHERE source=? AND child=? AND json_extract(payload,'$.ran.startedAt')>?
      AND coalesce(json_extract(payload,'$._startEvent[1]'),CASE WHEN json_extract(payload,'$.ran.state')='running' THEN json_extract(payload,'$.ran.sequence') END)>? LIMIT 1`).get(e.source,e.child,e.at,e.sequence)
      &&!db.prepare(`SELECT 1 FROM runs_rows WHERE source=? AND terminal=0 AND at<=? AND json_extract(payload,'$.ran.startedAt') IS NULL
        AND (child=? OR (child IS NULL AND json_extract(payload,'$.tool')='subagent')) LIMIT 1`).get(e.source,e.at,e.child)){correlate(db,e.source,e.child);return;}
  }
  if(!routed){
    const archived=e.state==='running'&&c.startEvidence&&Object.hasOwn(c.startEvidence,e.id)?c.startEvidence[e.id]:undefined;
    const duplicate=e.state==='running'?c.start?.id===e.id||!!archived:c.end?.id===e.id;
    if(duplicate){
      const stored=e.state==='running'?archived?.event??c.start!:c.end!;
      if(stored.sequence!==e.sequence||stored.at!==e.at||stored.state!==e.state){loss(db);return;}
      if(archived)archived.epochs=mergeEpochs(db,archived.epochs,[epoch]);
      else if(e.state==='running')c.startEpochs=mergeEpochs(db,eventEpochs(c,'start'),[epoch]);
      else c.endEpochs=mergeEpochs(db,eventEpochs(c,'end'),[epoch]);
    }else{
    const latest=Math.max(c.start?.sequence??-1,c.end?.sequence??-1);
    if(e.state!=='running'&&e.sequence<=latest)return;
    if(e.state==='running'){
      if(c.start&&e.sequence<c.start.sequence){
        c.startEvidence??=Object.create(null) as Record<string,StartEvidence>;
        c.startEvidence[e.id]={event:e,epochs:[epoch]};
      }else{
      if(c.start){
        c.startEvidence??=Object.create(null) as Record<string,StartEvidence>;
        c.startEvidence[c.start.id]={event:c.start,epochs:eventEpochs(c,'start'),ambiguous:c.ambiguous};
      }
      if(c.start&&!eventEpochs(c,'start').includes(epoch)){c.start=e;c.end=c.end&&c.end.sequence>e.sequence?c.end:null;c.ambiguous=false;loss(db);}
      else if(c.start&&c.end){if(e.sequence>c.end.sequence)c.end=null;c.start=e;c.ambiguous=false;}
      else if(!c.start)c.start=e;
      else {c.ambiguous=true;if(c.startEvidence)for(const s of Object.values(c.startEvidence))s.ambiguous=true;c.start=e;c.end=null;}
      c.startEpoch=epoch;
      c.startEpochs=[epoch];
      }
    }else {c.end=e;c.endEpoch=epoch;c.endEpochs=[epoch];}
    }
  }
  if(!candidateStarts(c).length&&!c.end){db.prepare('DELETE FROM runs_candidates WHERE source=? AND child=?').run(e.source,e.child);return;}
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
    if(!victim){runCaptureUnavailable(db);return observationEpoch(db);}
    if(!victim.root&&!victim.stale){
      runCaptureUnavailable(db);epoch=observationEpoch(db);
      if(e.state==='running'){c.startEpoch=epoch;c.startEpochs=[epoch];}else {c.endEpoch=epoch;c.endEpochs=[epoch];}
    }
    db.prepare('DELETE FROM runs_candidates WHERE source=? AND child=?').run(victim.source!,victim.child!);
  }
  // Re-project even typed callers: never serialize a host event or error object.
  const project=(v:ExecutionObservation|null)=>v?{source:e.source,child:e.child,id:v.id,sequence:v.sequence,at:v.at,state:v.state,errorType:v.state==='failed'?safeErrorType(v.errorType):null,interruptionReason:v.state==='interrupted'&&['user','shutdown','superseded','inactivity'].includes(String(v.interruptionReason))?v.interruptionReason:v.state==='interrupted'?'unknown':null}:null;
  const safe={start:project(c.start),end:project(c.end),startEpochs:c.start?eventEpochs(c,'start'):undefined,endEpochs:c.end?eventEpochs(c,'end'):undefined,startEvidence:c.startEvidence?Object.fromEntries(Object.entries(c.startEvidence).map(([id,s])=>[id,{event:project(s.event),epochs:epochList(s.epochs),ambiguous:s.ambiguous??false}])):undefined,ambiguous:c.ambiguous??false} as Candidate;
  if(Buffer.byteLength(JSON.stringify(safe))>RUN_LIMITS.dtoBytes){runCaptureUnavailable(db);return observationEpoch(db);}
  db.prepare('INSERT INTO runs_candidates VALUES(?,?,?,?) ON CONFLICT(source,child) DO UPDATE SET generation=excluded.generation,payload=excluded.payload').run(e.source,e.child,control.generation,JSON.stringify(safe));
  if(refine){
    const start=provenStart(db,refine)!;
    const endEpochs=runEventEpochs(db,refine,'end');
    const displaced=recomputeInterval(db,refine,start,provenEnd(refine));
    if(displaced){
      const held=candidate(db,e.source,e.child)!;
      if(!held.end||displaced.sequence>held.end.sequence){held.end=displaced;held.endEpochs=endEpochs;held.endEpoch=undefined;}
      else if(displaced.sequence!==held.end.sequence)loss(db);
      db.prepare('UPDATE runs_candidates SET payload=? WHERE source=? AND child=?').run(JSON.stringify(held),e.source,e.child);
    }
  }
  correlate(db,e.source,e.child);
  return epoch;
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
    const contributed=db.prepare("SELECT 1 FROM contributions WHERE source=? AND plan=? AND json_extract(payload,'$.attributedSessionId')=? LIMIT 1").get(r.source,r.plan,r.root);
    need(plan.owner===r.root||plan.linked===1||incoming||contributed,'not-found');
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
/** One demand per new rejected terminal; reuse the bounded parent recovery job. */
function refreshGapOutcome(db:DatabaseSync,r:RunRow,e:ExecutionObservation) {
  const previous=db.prepare("SELECT json_extract(payload,'$._refresh[0]') AS sequence FROM runs_rows WHERE id=?").get(r.id);
  if(integer(previous?.sequence)&&previous.sequence>=e.sequence)return;
  const marker=JSON.stringify([e.sequence,true]);
  if(Number(db.prepare("SELECT length(CAST(json_set(payload,'$._refresh',json(?)) AS BLOB)) AS bytes FROM runs_rows WHERE id=?").get(marker,r.id)!.bytes)>RUN_LIMITS.dtoBytes)return;
  const old=db.prepare('SELECT state FROM runs_jobs WHERE source=? AND root=?').get(r.source,r.parentSessionId);
  if(!old||!['pending','running'].includes(String(old.state))){
    if(Number(db.prepare("SELECT count(*) AS n FROM runs_jobs WHERE state IN('pending','running')").get()!.n)>=RUN_LIMITS.jobs)return;
    if(!old&&!capacity(db))return;
    db.prepare("INSERT INTO runs_jobs VALUES(?,?,?,?,'pending',NULL,NULL,NULL) ON CONFLICT(source,root) DO UPDATE SET request_id=excluded.request_id,generation=excluded.generation,state='pending',claim=NULL,token=NULL,reason=NULL").run(r.source,r.parentSessionId,randomUUID(),runControl(db).generation);
  }
  // A pending job has not begun its new metadata scan. A running job might have
  // already visited this child: retain the demand until it finishes, then do one
  // fresh follow-up. The per-run marker survives replay and completed recovery.
  if(old?.state!=='running')db.prepare('DELETE FROM runs_recovery_work WHERE source=? AND root=?').run(r.source,r.parentSessionId);
  db.prepare("UPDATE runs_rows SET payload=json_set(payload,'$._refresh',json(?)) WHERE id=?").run(marker,r.id);bump(db);
}
export function recoveryMaintenance(db:DatabaseSync,source:string,directory:string,producer:string,now:number) {
  if(!runControl(db).enabled)return;
  const location=hash(directory),lease=db.prepare('SELECT producer,at FROM runs_recovery_lease WHERE source=? AND location=?').get(source,location);
  if(lease&&lease.producer!==producer&&now-Number(lease.at)<10000)return;
  if(!lease&&!capacity(db))return;
  if(!lease||lease.producer!==producer) {
    db.prepare("UPDATE runs_jobs SET state='partial',claim=NULL,reason='capture-unavailable',token=? WHERE source=? AND state='running' AND root IN(SELECT id FROM sessions WHERE source=? AND json_extract(actor,'$.directory')=?)").run(randomUUID(),source,source,directory);
    // One recovery attempt for retained unresolved dispatches per producer. This
    // reads metadata only; outcomes remain separate historical-session facts.
    const roots=db.prepare("SELECT DISTINCT parent FROM runs_rows WHERE source=? AND terminal=0 AND child IS NOT NULL AND parent IN(SELECT id FROM sessions WHERE source=? AND json_extract(actor,'$.directory')=?) LIMIT 64").all(source,source,directory);
    for(const r of roots){
      const old=db.prepare('SELECT state FROM runs_jobs WHERE source=? AND root=?').get(source,r.parent!);
      if(old&&['pending','running'].includes(String(old.state)))continue;
      if(Number(db.prepare("SELECT count(*) AS n FROM runs_jobs WHERE state IN('pending','running')").get()!.n)>=RUN_LIMITS.jobs)break;
      if(!old&&!capacity(db))break;
      // A new observation producer needs fresh latest-session metadata, not a
      // settled traversal's seen set. Explicit continuations still retain theirs.
      if(old)db.prepare('DELETE FROM runs_recovery_work WHERE source=? AND root=?').run(source,r.parent!);
      db.prepare("INSERT INTO runs_jobs VALUES(?,?,?,?,'pending',NULL,NULL,NULL) ON CONFLICT(source,root) DO UPDATE SET request_id=excluded.request_id,generation=excluded.generation,state='pending',claim=NULL,token=NULL,reason=NULL").run(source,r.parent!,randomUUID(),runControl(db).generation);
    }
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
  const claim=randomUUID();db.prepare("UPDATE runs_jobs SET state='running',claim=? WHERE source=? AND root=?").run(claim,source,root);
  db.prepare("UPDATE runs_rows SET payload=json_set(payload,'$._refresh[1]',json('false')) WHERE source=? AND parent=? AND json_extract(payload,'$._refresh[1]')=1").run(source,root);
  bump(db);return {source,root,generation:c.generation,claim,requestId:String(r.request_id)};
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
  const id=hash(['history',j.source,s.id]),existing=db.prepare('SELECT at,payload FROM runs_rows WHERE id=?').get(id);
  if(existing){
    const previous=row(existing.payload);
    // A newer reliable session summary can resolve historical uncertainty, not
    // identify which dispatch execution ended. Never regress or re-stamp history.
    if(previous.parentSessionId!==s.parent||existing.at!==s.createdAt||s.updatedAt<=previous.ran.updatedAt||s.idleAt===null||s.idleAt<s.createdAt||s.idleAt>s.updatedAt||s.idleAt<(previous.ran.endedAt??0)||!['succeeded','failed','interrupted'].includes(String(s.outcome)))return;
    previous.ran={...previous.ran,state:s.outcome!,endedAt:s.idleAt,updatedAt:s.updatedAt};save(db,previous);return;
  }
  if(!capacity(db,{source:j.source,parent:s.parent}))return;
  const ended=s.idleAt!==null&&s.idleAt>=s.createdAt?s.idleAt:null;
  const r:RunRow={id,kind:'historical-session',source:j.source,parentSessionId:s.parent,childSessionId:s.id,tool:null,agent:metadataString(s.agent,80),description:metadataString(s.title,200),dispatch:null,planContext:null,ran:{state:ended!==null&&['succeeded','failed','interrupted'].includes(String(s.outcome))?s.outcome!:'unknown',dispatchState:'historical',startedAt:null,endedAt:ended,updatedAt:s.updatedAt,provenance:'native-session',eventId:null,sequence:null,errorType:null,interruptionReason:null},claimed:null,accepted:null};
  db.prepare('INSERT INTO runs_rows VALUES(?,?,?,?,NULL,NULL,?,?,?,?)').run(id,j.source,s.parent,s.id,j.generation,Number(['succeeded','failed','interrupted'].includes(r.ran.state)),s.createdAt,JSON.stringify(r));bump(db);
}
export function finishRecovery(db:DatabaseSync,j:RecoveryJob,state:'complete'|'partial'|'failed') {
  if(!recoveryAlive(db,j))return;
  if(db.prepare("SELECT 1 FROM runs_rows WHERE source=? AND parent=? AND json_extract(payload,'$._refresh[1]')=1 LIMIT 1").get(j.source,j.root)){
    db.prepare("UPDATE runs_jobs SET request_id=?,state='pending',claim=NULL,token=NULL,reason=NULL WHERE source=? AND root=?").run(randomUUID(),j.source,j.root);
    db.prepare('DELETE FROM runs_recovery_work WHERE source=? AND root=?').run(j.source,j.root);bump(db);return;
  }
  db.prepare('UPDATE runs_jobs SET state=?,claim=NULL,token=?,reason=? WHERE source=? AND root=?').run(state,state==='complete'?null:randomUUID(),state==='partial'?'budget':state==='failed'?'capture-unavailable':null,j.source,j.root);bump(db);
  if(state==='complete')db.prepare('DELETE FROM runs_recovery_work WHERE source=? AND root=?').run(j.source,j.root);
}
