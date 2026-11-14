import type { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { canonical } from './canonical.ts';
import { currentBinding } from './assignment-binding.ts';
import { DIGEST_LIMITS, validateDigestSnapshot } from './change-digest.ts';
import { cleanupInstalled, cleanupState } from './cleanup.ts';
import { identifier, parseRequest, requireProgress as need, validBlockerAnnotation, type Contribution, type Item, type PlanState } from './progress.ts';
import { runControl, type DurableIntent } from './subagent-runs.ts';

/** Same bounded history admission as change digests. No receipt scan or new storage. */
export const DELEGATION_PROOF_LIMITS = { snapshots: DIGEST_LIMITS.snapshots, bytes: DIGEST_LIMITS.bytes } as const;

function plan(value: unknown, source: string, id: string, revision: number, owner: string): PlanState {
  const p = value as PlanState;
  need(validateDigestSnapshot(p, source, id, revision), 'conflict');
  need(p.sessionId === owner && typeof p.directory === 'string' && p.directory.length <= 4096 &&
    (p.projectId === undefined || typeof p.projectId === 'string') && Array.isArray(p.links) && p.links.length <= 64, 'conflict');
  need(p.lifecycle === 'active', 'closed');
  const sessions = new Set<string>(), assigned = new Map<string, string>();
  const items = new Map(p.items.map(i => [i.id, i]));
  for (const link of p.links) {
    need(link && identifier(link.sessionId) && link.sessionId !== owner && !sessions.has(link.sessionId) &&
      Array.isArray(link.itemIds) && link.itemIds.length > 0 && link.itemIds.length <= 1000, 'conflict');
    sessions.add(link.sessionId);
    for (const id of link.itemIds) {
      need(identifier(id) && !assigned.has(id) && items.get(id)?.kind === 'task' && items.get(id)?.assigneeSessionId === link.sessionId, 'conflict');
      assigned.set(id, link.sessionId);
    }
  }
  for (const item of p.items) if (item.assigneeSessionId !== undefined)
    need(identifier(item.assigneeSessionId) && assigned.get(item.id) === item.assigneeSessionId, 'conflict');
  return p;
}

function taskFacts(item: Item, p: PlanState) {
  const copy = { ...item };
  // Only validated mechanical rollover is neutral. Never erase meaningful
  // blocker/provenance changes or recertify an old writer's stale annotation.
  if (copy.blocker !== undefined) {
    need(item.kind === 'task' && item.status === 'blocked' && validBlockerAnnotation(copy.blocker, p.revision), 'conflict');
    copy.blocker = { ...copy.blocker, validAtRevision: 0 };
  }
  if (copy.assignmentBinding !== undefined) {
    need(currentBinding(copy.assignmentBinding, p, item.id), 'conflict');
    copy.assignmentBinding = { ...copy.assignmentBinding, validAtRevision: 0 };
  }
  return canonical(copy);
}

/** Empty contribution scope alone says nothing about authored targets. A
 * changed single-child link identifies the link writer only after structural
 * and lifecycle operations have been excluded. Its complete old/new scope,
 * plus fresh binding provenance where present, must explain the entire delta.
 * Equal links (including no-op legacy relinks) remain ambiguous and refuse.
 */
function disjointLink(previous: PlanState, next: PlanState, c: Contribution, assigned: string[]) {
  need(c.mode === 'direct' && c.reporterSessionId === previous.sessionId && c.attributedSessionId === previous.sessionId, 'conflict');
  const oldLinks = new Map(previous.links.map(l => [l.sessionId, l]));
  const newLinks = new Map(next.links.map(l => [l.sessionId, l]));
  const changed = [...new Set([...oldLinks.keys(), ...newLinks.keys()])]
    .filter(id => canonical(oldLinks.get(id) ?? null) !== canonical(newLinks.get(id) ?? null));
  need(changed.length === 1, 'conflict');
  const child = changed[0]!, oldLink = oldLinks.get(child), newLink = newLinks.get(child);
  const { itemIds: _old, ...oldFacts } = oldLink ?? { sessionId: child, itemIds: [] };
  const { itemIds: _new, ...newFacts } = newLink ?? { sessionId: child, itemIds: [] };
  need(canonical(oldFacts) === canonical(newFacts), 'conflict');
  const scope = new Set([...(oldLink?.itemIds ?? []), ...(newLink?.itemIds ?? [])]);
  need(scope.size > 0 && assigned.every(id => !scope.has(id)), 'conflict');
  need(canonical(next.links) === canonical([...previous.links.filter(l => l.sessionId !== child), ...(newLink ? [newLink] : [])]), 'conflict');
  const bound = next.items.filter(i => i.assignmentBinding?.boundRevision === next.revision);
  if (bound.length) {
    need(bound.length <= 50 && next.reportedAt === previous.reportedAt && canonical(next.document) === canonical(previous.document), 'conflict');
    const first = bound[0]!.assignmentBinding!;
    for (const item of bound) {
      const b = item.assignmentBinding!;
      need(currentBinding(b, next, item.id) && b.childSessionId === child && b.boundAt === c.reportedAt &&
        b.messageId === first.messageId && b.callId === first.callId && b.observedAt === first.observedAt &&
        previous.items.find(i => i.id === item.id)?.assigneeSessionId === undefined, 'conflict');
    }
    // A binding unions the existing link with newly declared, unassigned tasks.
    // The snapshot's task order need not be the declaration's assignment order.
    need(newLink && newLink.itemIds.length === (oldLink?.itemIds.length ?? 0) + bound.length &&
      (oldLink?.itemIds ?? []).every((id, index) => newLink.itemIds[index] === id) &&
      bound.every(i => newLink.itemIds.includes(i.id)), 'conflict');
  } else need(c.reportedAt === next.reportedAt, 'conflict');
  for (let index = 0; index < previous.items.length; index++) {
    const a = previous.items[index]!, b = next.items[index]!;
    taskFacts(a, previous); // Do not recertify stale optional annotations.
    const expected = structuredClone(a);
    if (scope.has(a.id)) {
      if (newLink?.itemIds.includes(a.id)) expected.assigneeSessionId = child;
      else delete expected.assigneeSessionId;
      if (!bound.length) delete expected.assignmentBinding;
      else if (bound.some(i => i.id === a.id)) expected.assignmentBinding = b.assignmentBinding;
    }
    if (expected.blocker) expected.blocker.validAtRevision = next.revision;
    if (expected.assignmentBinding) expected.assignmentBinding.validAtRevision = next.revision;
    need(taskFacts(expected, next) === taskFacts(b, next), 'conflict');
  }
}

/** Read-only predicate; caller MUST hold the Store transaction through use of
 * the returned revision. It proves intervening disjoint reports and positively
 * identified single-child link/binding transitions. Ambiguous empty scopes
 * retain strict conflict behavior, rather than guessing from equal endpoints.
 * Read projections may use this predicate but must never settle the intent.
 */
export function delegationRevision(db: DatabaseSync, binding: { sourceId: string | null; verified: boolean }, intent: DurableIntent): number {
  const r = parseRequest(intent.request), source = intent.caller.sourceId, owner = intent.caller.sessionId;
  need(r.op === 'delegate' && r.assign!.length > 0 && identifier(source) && identifier(owner), 'conflict');
  // The original receipt, not a reconstructed current request, pins scope and
  // replay identity even when history permits a newer derived-link revision.
  const receipt = db.prepare('SELECT payload_hash FROM receipts WHERE source=? AND plan=? AND oid=?').get(source, r.plan, r.oid!);
  need(receipt?.payload_hash === createHash('sha256').update(canonical([r, source, owner])).digest('hex'), 'conflict');
  need(binding.verified && binding.sourceId === source && db.prepare('SELECT verified FROM sources WHERE id=?').get(source)?.verified === 1, 'source-unverified');
  const control = runControl(db);
  need(control.enabled && control.generation === intent.generation, 'disabled');
  const cleanup = cleanupInstalled(db) ? cleanupState(db, source, r.plan) : undefined;
  need(cleanup?.state !== 'deleted', 'not-found'); need(cleanup?.state !== 'archived', 'closed');
  let bytes = 0;
  const admit = (text: unknown) => {
    need(typeof text === 'string', 'conflict'); bytes += Buffer.byteLength(text);
    need(bytes <= DELEGATION_PROOF_LIMITS.bytes, 'conflict');
    try { return JSON.parse(text); } catch { need(false, 'conflict'); }
  };
  const live = db.prepare('SELECT revision,CASE WHEN length(CAST(snapshot AS BLOB))<=? THEN snapshot END AS snapshot FROM plans WHERE source=? AND id=?')
    .get(DELEGATION_PROOF_LIMITS.bytes, source, r.plan);
  need(live, 'not-found');
  const revision = Number(live.revision);
  const current = plan(admit(live.snapshot), source, r.plan, revision, owner);
  need(r.assign!.every(id => current.items.some(i => i.id === id && i.kind === 'task' && i.assigneeSessionId === undefined)), 'assignment');
  if (revision === r.rev) return revision; // Existing exact-revision/legacy path.
  need(revision > r.rev! && revision - r.rev! < DELEGATION_PROOF_LIMITS.snapshots, 'conflict');
  const snapshot = db.prepare('SELECT CASE WHEN length(CAST(snapshot AS BLOB))<=? THEN snapshot END AS snapshot FROM revisions WHERE source=? AND plan=? AND revision=?');
  const contribution = db.prepare('SELECT CASE WHEN length(CAST(payload AS BLOB))<=? THEN payload END AS payload FROM contributions WHERE source=? AND plan=? AND revision=?');
  let previous: PlanState | undefined;
  for (let rev = r.rev!; rev <= revision; rev++) {
    const next = plan(admit(snapshot.get(DELEGATION_PROOF_LIMITS.bytes - bytes, source, r.plan, rev)?.snapshot), source, r.plan, rev, owner);
    need(next.structuralRevision === current.structuralRevision, 'conflict');
    if (previous) {
      const c = admit(contribution.get(DELEGATION_PROOF_LIMITS.bytes - bytes, source, r.plan, rev)?.payload) as Contribution;
      need(c && c.revision === rev && identifier(c.reporterSessionId) && identifier(c.attributedSessionId) &&
        ['direct','parent-relay'].includes(c.mode) && typeof c.reportedAt === 'string' &&
        Array.isArray(c.itemIds) && c.itemIds.length <= 50 && new Set(c.itemIds).size === c.itemIds.length &&
        c.itemIds.every(id => identifier(id) && !r.assign!.includes(id) && next.items.some(i => i.id === id && i.kind === 'task')), 'conflict');
      need(c.mode === 'direct' ? c.reporterSessionId === c.attributedSessionId : c.reporterSessionId === owner && c.attributedSessionId !== owner, 'conflict');
      if (c.attributedSessionId !== owner) need(previous.links.some(l => l.sessionId === c.attributedSessionId && c.itemIds.every(id => l.itemIds.includes(id))), 'conflict');
      // Compare non-report/assignment plan facts, including unknown fields.
      const { revision: _a, reportedAt: _b, items: _c, document: _d, links: _q, ...before } = previous;
      const { revision: _e, reportedAt: _f, items: _g, document: _h, links: _r, ...after } = next;
      need(canonical(before) === canonical(after) && previous.reportedAt <= next.reportedAt && previous.items.length === next.items.length, 'conflict');
      if (c.itemIds.length === 0) disjointLink(previous, next, c, r.assign!);
      else {
        need(c.reportedAt === next.reportedAt && canonical(previous.links) === canonical(next.links), 'conflict');
        for (let index = 0; index < previous.items.length; index++) {
          const a = previous.items[index]!, b = next.items[index]!;
          const { status: _i, reporterSessionId: _j, blocker: _k, assignmentBinding: _l, ...aStructure } = a;
          const { status: _m, reporterSessionId: _n, blocker: _o, assignmentBinding: _p, ...bStructure } = b;
          need(canonical(aStructure) === canonical(bStructure), 'conflict');
          if (r.assign!.includes(a.id)) need(taskFacts(a, previous) === taskFacts(b, next), 'conflict');
        }
      }
    }
    previous = next;
  }
  need(canonical(previous) === canonical(current), 'conflict');
  return revision;
}
