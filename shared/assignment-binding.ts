import { identifier, type AssignmentBinding, type PlanState } from './progress.ts';

/** Validate on reads and before carrying metadata across a new writer revision. */
export function currentBinding(value: unknown, plan: PlanState, itemId: string): value is AssignmentBinding {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const b = value as AssignmentBinding;
  const item = plan.items.find(i => i.id === itemId);
  const time = (s: unknown) => typeof s === 'string' && Number.isFinite(Date.parse(s)) && new Date(s).toISOString() === s;
  return Object.keys(b).every(k => ['coordinatorSessionId','childSessionId','planId','itemId','tool','messageId','callId','observedAt','boundAt','boundRevision','validAtRevision'].includes(k)) &&
    b.coordinatorSessionId === plan.sessionId && b.planId === plan.id && b.itemId === itemId && b.tool === 'subagent' &&
    identifier(b.childSessionId) && identifier(b.messageId) && identifier(b.callId) && time(b.observedAt) && time(b.boundAt) &&
    Number.isSafeInteger(b.boundRevision) && b.boundRevision > 0 && b.boundRevision <= plan.revision && b.validAtRevision === plan.revision &&
    item?.kind === 'task' && item.assigneeSessionId === b.childSessionId &&
    plan.links.some(l => l.sessionId === b.childSessionId && l.itemIds.includes(itemId));
}
