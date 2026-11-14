import { createHash } from 'node:crypto';
import { DELEGATION_VIEW_LIMITS as L, type DelegationDeclaration, type DelegationView } from '../shared/delegation-view.ts';
import { delegationRevision } from '../shared/delegation-validation.ts';
import { activeIntent, runStorageCompatibility } from '../shared/subagent-runs.ts';
import { cleanupInstalled, cleanupState } from '../shared/cleanup.ts';
import { identifier, ProgressError, requireProgress as need, type Envelope, type PlanSummary } from '../shared/progress.ts';
import type { Store } from '../shared/store.ts';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const integer = (value: unknown, min = 0): value is number => Number.isSafeInteger(value) && Number(value) >= min;
const id = (value: unknown): value is string => typeof value === 'string' && value.length <= L.identifierCodeUnits && identifier(value);
const refusalReasons = new Set(['relevant-change','conflict','structural-change','closed','assignment','source-unverified','unverified','incomplete-proof','missing-proof','budget']);
const refusalReason = (reason: unknown) => typeof reason === 'string' && refusalReasons.has(reason) ? reason
  : reason === 'busy' ? 'budget' : reason === 'not-found' ? 'missing-proof' : 'unverified';

function declaration(value: any, oid: string, owner: string, revision: number): DelegationDeclaration | undefined {
  if (!value || value.oid !== oid || !id(value.oid) || value.coordinatorSessionId !== owner || !integer(value.declaredRevision, 1) || value.declaredRevision > revision ||
      !Array.isArray(value.taskIds) || value.taskIds.length > L.tasks || !value.taskIds.every(id) || new Set(value.taskIds).size !== value.taskIds.length ||
      value.dispatch !== null && (!value.dispatch || !['subagent','task'].includes(value.dispatch.tool) || !id(value.dispatch.messageId) || !id(value.dispatch.callId))) return;
  return { oid, coordinatorSessionId: owner, declaredRevision: value.declaredRevision, taskIds: [...value.taskIds],
    dispatch: value.dispatch === null ? null : { tool: value.dispatch.tool, messageId: value.dispatch.messageId, callId: value.dispatch.callId } };
}

/** Service-only read projection. No intent settlement, Store discovery, schema
 * installation or actor lookup. Tokens and overlays use exactly the same read.
 * Each plan admits at most 128 receipts/16 KiB each and the existing bounded
 * history predicate. Incomplete evidence never becomes an eligible intent.
 */
export function delegationView(store: Store, envelope: Envelope, plan: PlanSummary, now = new Date()): { token: string; view?: DelegationView } {
  const identity = [envelope.storeId, envelope.sourceBinding, plan.sourceId, plan.id, plan.sessionId, plan.revision, plan.structuralRevision, plan.cleanup ?? { state: 'visible', revision: 0 }];
  // Ordinary lists can contain other sources. Do not inspect their receipts or
  // pretend that a verified binding for one source verifies another.
  if (!envelope.sourceBinding.verified || envelope.sourceBinding.sourceId !== plan.sourceId)
    return { token: hash([identity, 'unverified']) };
  const db = store.db;
  db.exec('BEGIN');
  try {
    need(Number(db.prepare('PRAGMA user_version').get()!.user_version) === 2, 'schema');
    const meta = db.prepare('SELECT store_id,enabled FROM meta WHERE singleton=1').get()!;
    need(meta.store_id === envelope.storeId && Boolean(meta.enabled) === envelope.captureEnabled && db.prepare('SELECT verified FROM sources WHERE id=?').get(plan.sourceId)?.verified === 1, 'conflict');
    const live = db.prepare("SELECT revision,json_extract(snapshot,'$.structuralRevision') AS structural,json_extract(snapshot,'$.sessionId') AS owner FROM plans WHERE source=? AND id=?").get(plan.sourceId, plan.id);
    const cleanup = cleanupInstalled(db) ? cleanupState(db, plan.sourceId, plan.id) : undefined;
    need(live && live.revision === plan.revision && live.structural === plan.structuralRevision && live.owner === plan.sessionId &&
      (cleanup?.state ?? 'visible') === (plan.cleanup?.state ?? 'visible') && Number(cleanup?.generation ?? 0) === (plan.cleanup?.revision ?? 0), 'conflict');
    const storage = runStorageCompatibility(db);
    const control = storage === 'current' ? db.prepare('SELECT generation,loss,loss_sequence FROM runs_format WHERE singleton=1').get() : undefined;
    const facts: unknown[] = [identity, envelope.captureEnabled, storage, control];
    let result: DelegationView['result'] = { availability: 'unavailable', complete: false, reason: 'legacy' };
    const unavailable = (reason: Extract<DelegationView['result'], { availability: 'unavailable' }>['reason']) => { result = { availability: 'unavailable', complete: false, reason }; };
    if (storage === 'current') {
      const intentRow = db.prepare('SELECT plan,oid,dispatch,length(CAST(payload AS BLOB)) AS bytes,CASE WHEN length(CAST(payload AS BLOB))<=16384 THEN payload END AS payload FROM runs_intents WHERE source=? AND parent=?').get(plan.sourceId, plan.sessionId);
      facts.push(intentRow);
      const rows = db.prepare('SELECT rowid,oid,length(CAST(receipt AS BLOB)) AS bytes,CASE WHEN length(CAST(receipt AS BLOB))<=16384 THEN receipt END AS receipt FROM receipts WHERE source=? AND plan=? ORDER BY rowid DESC LIMIT ?').all(plan.sourceId, plan.id, L.receipts + 1);
      facts.push(rows);
      result = { availability: 'ready', complete: true, disposition: { state: 'none' } };
      let found = false;
      for (const row of rows.slice(0, L.receipts)) {
        if (typeof row.receipt !== 'string') { unavailable('budget'); found = true; break; }
        let r: any; try { r = JSON.parse(row.receipt); } catch { unavailable('invalid'); found = true; break; }
        if (!r || typeof r !== 'object' || Array.isArray(r)) { unavailable('invalid'); found = true; break; }
        const d = r?.delegation;
        if (!d) continue;
        if (d.declaration?.coordinatorSessionId && d.declaration.coordinatorSessionId !== plan.sessionId) continue;
        found = true;
        const a = declaration(d.declaration, String(row.oid), plan.sessionId, plan.revision);
        if (!a) { unavailable(d.declaration ? 'invalid' : 'legacy'); break; }
        if (d.sourceId !== plan.sourceId || r.plan !== plan.id || r.rev !== a.declaredRevision) { unavailable('invalid'); break; }
        const ready = (disposition: Extract<DelegationView['result'], { availability: 'ready' }>['disposition']) => { result = { availability: 'ready', complete: true, disposition }; };
        const refused = (reason: unknown) => ready({ state: 'refused', declaration: a, reason: refusalReason(reason), recovery: 'redeclare-or-link' });
        if (d.state === 'pending' || d.state === 'reserved') {
          if (!a.taskIds.length || (d.state === 'pending') !== (a.dispatch === null) || intentRow?.plan !== plan.id || intentRow.oid !== a.oid || typeof intentRow.payload !== 'string') { unavailable('invalid'); break; }
          try {
            const intent = activeIntent(db, plan.sourceId, plan.sessionId);
            need(intent && intent.caller.sourceId === plan.sourceId && intent.caller.sessionId === plan.sessionId && intent.request.plan === plan.id && intent.request.oid === a.oid && intent.request.rev === a.declaredRevision &&
              JSON.stringify(intent.request.assign) === JSON.stringify(a.taskIds) && (intent.dispatch === null) === (a.dispatch === null) && intent.dispatch === intentRow.dispatch, 'conflict');
            if (a.dispatch) {
              need(d.dispatchId === intent.dispatch, 'binding');
              const dispatch = db.prepare('SELECT message,call FROM runs_rows WHERE id=? AND source=? AND parent=?').get(intent.dispatch!, plan.sourceId, plan.sessionId);
              need(dispatch?.message === a.dispatch.messageId && dispatch.call === a.dispatch.callId, 'binding');
            }
            delegationRevision(db, envelope.sourceBinding, intent);
            ready({ state: d.state, eligible: true, declaration: a });
          } catch (error) {
            if (!(error instanceof ProgressError)) { unavailable('invalid'); break; }
            if (error.code === 'disabled') ready({ state: 'invalidated', declaration: a, reason: 'capture-disabled' });
            else refused(error.code);
          }
        } else if (d.state === 'retired') {
          if (d.reason === 'cancelled') ready({ state: 'cancelled', declaration: a, reason: 'cancelled' });
          else if (d.reason === 'disabled' || d.reason === 'capture-disabled') ready({ state: 'invalidated', declaration: a, reason: 'capture-disabled' });
          else if (a.taskIds.length) refused(d.reason);
          else unavailable('invalid');
        } else if (d.state === 'bound' && a.taskIds.length && a.dispatch && id(d.childSessionId) && d.receipt?.plan === plan.id && integer(d.receipt.rev, a.declaredRevision) && d.receipt.rev <= plan.revision) {
          ready({ state: 'bound', declaration: a, childSessionId: d.childSessionId, boundRevision: d.receipt.rev });
        } else unavailable('invalid');
        break;
      }
      if (!found && (rows.length > L.receipts || intentRow?.plan === plan.id)) unavailable('budget');
      if (!meta.enabled) unavailable('capture-unavailable');
    }
    // Include eligibility in equality, not readAt. Thus history gaps/relevant
    // changes invalidate cached waiting notes even without a declaration write.
    const token = hash([facts, result]);
    const view: DelegationView | undefined = (plan.cleanup?.state ?? 'visible') === 'visible' ? {
      protocolVersion: 2, schemaVersion: 2, delegationIntent: 1, storeId: envelope.storeId,
      sourceBinding: { sourceId: plan.sourceId, verified: true }, source: plan.sourceId, plan: plan.id,
      revision: plan.revision, structuralRevision: plan.structuralRevision, cleanup: { state: 'visible', revision: plan.cleanup?.revision ?? 0 },
      token, readAt: now.toISOString(), result,
    } : undefined;
    db.exec('COMMIT');
    return { token, ...(view ? { view } : {}) };
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
