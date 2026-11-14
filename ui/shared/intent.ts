// Waiting-delegation notes on task rows (shared/delegation-view.ts, design §4).
// - display only: a note never changes status, counts, assignment, filters or summaries
// - painted only from a validated overlay whose token equals the list row's current token, so a
//   declaration, reservation, cancel or invalidation retires it on the ordinary refresh
// - unknown, unreadable, legacy or mismatched evidence paints nothing: never a guess from activity
import type { IntentRefusal, PlanDetail, PlanView } from './model.ts';

export type TaskIntent = { state: 'waiting' } | { state: 'refused'; reason: IntentRefusal };
/**
 * `absent`: the detail carried no overlay (not asked or older service); `stale`: its token or
 * revision is not the list's current one; `unknown`: incomplete or unusable evidence. Only
 * `waiting` and `refused` carry tasks.
 */
export type IntentState = 'absent' | 'stale' | 'unknown' | 'clear' | 'waiting' | 'refused';
export interface CurrentIntent { state: IntentState; tasks: ReadonlyMap<string, TaskIntent> }

const NONE: ReadonlyMap<string, TaskIntent> = new Map();

export function currentIntent(plan: PlanView, detail: PlanDetail): CurrentIntent {
  const intent = detail.intent;
  if (!intent) return { state: 'absent', tasks: NONE };
  if (detail.revision !== plan.revision || plan.delegationToken == null || intent.token !== plan.delegationToken) return { state: 'stale', tasks: NONE };
  if (intent.state === 'unknown' || intent.state === 'clear') return { state: intent.state, tasks: NONE };
  // Every declared task must be a task of this very detail; otherwise the scope is doubtful.
  const kinds = new Map(detail.items.map((i) => [i.id, i.kind]));
  if (!intent.taskIds.every((id) => kinds.get(id) === 'task')) return { state: 'unknown', tasks: NONE };
  const note: TaskIntent = intent.state === 'waiting' ? { state: 'waiting' } : { state: 'refused', reason: intent.reason };
  return { state: intent.state, tasks: new Map(intent.taskIds.map((id) => [id, note])) };
}

/**
 * Appended after style.ts (phone layout lane) and the inbox styles. Host tokens only; the note
 * sits on its own line under the task title (status mark 16px + row gap 9px).
 */
export const INTENT_CSS = `
.ap-intent{flex:1 0 100%;display:flex;align-items:flex-start;gap:6px;min-width:0;padding-inline-start:25px;font-size:11.5px;line-height:1.4;color:var(--oc-muted);overflow-wrap:anywhere}
.ap-intent-text{min-width:0}
.ap-intent[data-intent="waiting"]::before{content:"";flex:none;width:7px;height:7px;margin-top:4px;border:1.3px dashed currentColor;border-radius:50%}
.ap-intent>.ap-icon{flex:none;width:13px;height:13px;margin-top:1px;color:var(--oc-warning-text,var(--oc-warning))}
.ap-intent-fact{display:flex;flex-direction:column;gap:2px;min-width:0}
`;
