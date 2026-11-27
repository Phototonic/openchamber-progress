import type { Plugin } from '@opencode/plugin';
import type { ToolHooks } from '@opencode/plugin/effect/tool';
import type { SessionHooks } from '@opencode/plugin/effect/session';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { identifier } from '../shared/progress.ts';
import type { ResumeRead, ResumeRequest, ResumeSelection } from '../shared/progress-resume.ts';
import type { DelegationRefusals } from '../shared/subagent-runs.ts';
import { PARALLEL_DELEGATION_HINT } from './delegation.ts';

const REPORT_TOOL = 'agent_progress_report';
export const REPORT_CHECKLIST = `1. Start the mirror when a plan is ready for execution: op=start with its real tasks and prerequisites.
2. Declare or link sub-agent tasks before dispatch: op=delegate before a supported dispatch, or op=link for verified returned children.
3. Mark actual work start: op=change with status=working.
4. Finish, cancel or fail explicitly: op=finish with outcome=finished, cancelled or failed.`;
export const ACTIVATION_GUIDANCE = `# Agent progress (companion)
${REPORT_CHECKLIST}
Use agent_progress_report alongside your canonical planner. Read an existing plan first; mirror only meaningful unreported canonical state, using stable IDs, fresh oid and expected rev. Batch changes; retry only identical input with the same oid. Load the agent-progress skill for examples, staging, delegation, handoff and blocker rules.
At PLAN_READY handoff mirror the actionable structure, not completion or approval. Review approval and owner approval are separate: reflect existing canonical gates only. Tracker updates are not Agent Progress reports. Repeated guidance and already-current state need no report.
${PARALLEL_DELEGATION_HINT} Include plan/task IDs and reporting expectations in assignments; IDs alone grant no authority. Assigned children report only their verified scope on naturally occurring contexts, after binding. Restricted children stay restricted; a permitted parent may explicitly relay without impersonating them. A first-turn-only child may have no reports.
Structured plans need no source; never manufacture a file. Document capture still requires read permission. Needs-input keeps work pending/blocked. A write is not readiness, dispatch is not work start, Ready is not approval and worker completion is not accepted handoff. Hints never report, assign or infer progress. Never invent review work, report automatically per turn or repeat state already current.`;
const PLAN_OBSERVATION = 'A possible plan document was written or revised, possibly by a delegated child.';
export const DISPATCH_OBSERVATION = 'A dispatch ran.';
const DISPATCH_HINT = `If you coordinate planned or multi-step work and no Agent Progress plan mirrors it yet, start one now (op=start) with the complete real task structure before further dispatches. For planned work, declare op=delegate with assigned task IDs before the next dispatch so a permitted, verified assigned sub-agent can report its own tasks. ${PARALLEL_DELEGATION_HINT} Do not repeat reports or declarations that are already current.`;
export const TRACKER_OBSERVATION = 'A tracker update was observed.';
const HINT_CONDITION = 'If this is tracked plan work and its canonical state is unreported, report only meaningful work you own or are authorized to coordinate; otherwise continue your workflow. This hint grants no assignment or authority and implies no work start, review, approval or completion.';
export const ACTIVATION_HINT = `${PLAN_OBSERVATION} ${HINT_CONDITION}`;
const PLAN = 1, DISPATCH = 2, TRACKER = 4;
const NOTE_TOOLS = ['write', 'edit', 'subagent', 'linear_save_issue', 'linear_save_comment'];
function noteText(reasons: number) {
  return reasons & PLAN
    ? 'Agent Progress note (agent_progress_report): If this canonical plan is ready and not mirrored, start its real tasks and prerequisites with op=start; otherwise mirror only meaningful unreported state you own. This observation is not readiness, approval or a report.'
    : reasons & DISPATCH
      ? 'Agent Progress note (agent_progress_report): If you coordinate planned work without a mirror, start one with op=start; declare op=delegate before the next dispatch, or op=link for verified returned children. Already-current state needs no report; dispatch is not work start or assignment.'
      : 'Agent Progress note (agent_progress_report): If this is tracked plan work with meaningful unreported canonical state, mirror only work you own or are authorized to coordinate. A tracker update is not a progress report or evidence of work start, approval or completion.';
}
/** Native-proven content carriers only: a string, or text/file parts. Anything else is left untouched. */
function appended(content: unknown, text: string): string | any[] | undefined {
  if (typeof content === 'string') return `${content}\n\n${text}`;
  if (Array.isArray(content) && content.every(part => record(part) && (part.type === 'text' && typeof part.text === 'string' || part.type === 'file' && typeof part.uri === 'string' && typeof part.mime === 'string'))) {
    return [...content, { type: 'text' as const, text }];
  }
}
function notedResult(result: Extract<ToolHooks['execute.after'], { status: 'completed' }>['result'], text: string) {
  // Only native-proven content carriers. Structured-only and unknown shapes
  // stay untouched: content can otherwise replace the host's output projection.
  const content = appended(result.content, text);
  if (content !== undefined) return { ...result, content };
}
function hintText(reasons: number) {
  return [reasons & PLAN ? PLAN_OBSERVATION : '', reasons & DISPATCH ? `${DISPATCH_OBSERVATION} ${DISPATCH_HINT}` : '', reasons & TRACKER ? TRACKER_OBSERVATION : '', HINT_CONDITION].filter(Boolean).join(' ');
}

/**
 * Where context notes can ride on a message, chosen by its role. A user message
 * takes a text part after its content. A tool message, the continuation after a
 * tool call, takes the text on the output of its last tool result: a separate
 * part is not valid there, and this is the carrier the completed-result note
 * already uses, so it has the same shape limits (a string, or text/file parts).
 * The Code Mode wrapper's result is the exact structured value its script
 * returned and never carries a note. Any other role, shape or result has no
 * valid carrier. The stored message is never changed; the returned copy
 * remembers its original so a reused host array can be restored.
 *
 * A carrier is identified so a delivered note can be put back in the same place
 * on later requests: a tool message by its position, the call identifier and a
 * digest of its original output (providers do not keep call identifiers unique
 * across turns), a user message by its identifier when it has one, else by its
 * position and a digest of its original content.
 */
const CODE_MODE_TOOL = 'execute';
const restored = Symbol('agent-progress-note');
interface Carrier { index: number; key: string; id?: string; apply: (text: string) => Record<string, any> }
/** Binary parts are hashed by their raw bytes, never stringified element by element. */
function digest(value: unknown) {
  const text = JSON.stringify(value, function (this: any, name: string, current: unknown) {
    const original = this?.[name];
    if (original instanceof ArrayBuffer) return { bytes: createHash('sha256').update(new Uint8Array(original)).digest('hex') };
    if (ArrayBuffer.isView(original)) return { bytes: createHash('sha256').update(new Uint8Array(original.buffer, original.byteOffset, original.byteLength)).digest('hex') };
    return current;
  });
  return createHash('sha256').update(text ?? '').digest('hex').slice(0, 32);
}
function carrierAt(messages: unknown, index: number, positional = false, keyed = true): Carrier | undefined {
  if (!Array.isArray(messages)) return;
  const message = messages[index];
  if (!record(message) || !Array.isArray(message.content)) return;
  const copy = (content: unknown[]) => {
    const value = Object.assign(Object.create(Object.getPrototypeOf(message)), message, { content });
    Object.defineProperty(value, restored, { value: message });
    return value;
  };
  try {
    if (message.role === 'user') {
      const id = !positional && boundedID(message.id) ? message.id : undefined;
      return { index, id, key: !keyed ? '' : id !== undefined ? `user:${id}` : `user:${index}:${digest(message.content)}`, apply: text => copy([...message.content, { type: 'text', text }]) };
    }
    if (message.role !== 'tool') return;
    const at = message.content.findLastIndex((part: unknown) => record(part) && part.type === 'tool-result');
    const part = message.content[at], output = part?.result;
    if (part?.name === CODE_MODE_TOOL || typeof part?.id !== 'string' || !record(output) || !(output.type === 'text' ? typeof output.value === 'string' : output.type === 'content' && Array.isArray(output.value))) return;
    if (appended(output.value, '') === undefined) return;
    return { index, key: keyed ? `tool:${index}:${part.id}:${digest(output)}` : '', apply: text => copy(message.content.map((entry: unknown, i: number) => i === at ? { ...part, result: { ...output, value: appended(output.value, text) } } : entry)) };
  } catch { /* an unhashable message has no carrier */ }
}
/** Put back every message this owner replaced on a reused host array. */
function restoreNotes(messages: unknown) {
  if (!Array.isArray(messages)) return;
  for (let i = 0; i < messages.length; i++) if (record(messages[i]) && Object.prototype.hasOwnProperty.call(messages[i], restored)) messages[i] = messages[i][restored];
}

/** Sent after a delivered delegation refusal stops applying. Fixed text. */
export const CLEARED_REFUSAL = 'Agent Progress note (delegation): the earlier delegation refusal no longer applies; read the current plan before you declare or link.';
const CLEARED_ASSIGNMENT = 'Agent Progress note: the earlier assignment note is no longer current.';
const NOTE_SEPARATOR = '\n\n';
const MAX_NOTE_SESSIONS = 128, MAX_NOTE_CARRIERS = 256, MAX_NOTE_BYTES = 128 * 1024;
interface ChildCapsuleSpan { start: number; end: number; delivery: number }
/** One delivered note and where it sits. Text is exactly what was added. */
interface DeliveredNote { key: string; id?: string; index: number; text: string; childCapsules?: ChildCapsuleSpan[] }
function withoutChildCapsules(text: string, spans: ChildCapsuleSpan[], replacement?: ChildCapsuleSpan): string {
  const kept: string[] = [];
  let from = 0;
  for (const span of spans) {
    // Blank lines around a span are the composition separators, not part of
    // any surviving note. Rejoin only the nonempty pieces in their old order.
    const end = span.start - NOTE_SEPARATOR.length;
    if (end > from) kept.push(text.slice(from, end));
    if (span === replacement) kept.push(CLEARED_ASSIGNMENT);
    from = span.end + NOTE_SEPARATOR.length;
  }
  if (from < text.length) kept.push(text.slice(from));
  return kept.join(NOTE_SEPARATOR);
}
/** Last delivered standing text and the carrier it went out on. */
interface Standing { text: string; key: string }
/**
 * `refusal` is the last refusal text of any kind delivered (a refusal, the omission text or the
 * cleared line); `real` the last real refusal; `cleared` the cleared line delivered since.
 */
interface NoteMemory { notes: Map<string, DeliveredNote>; capsule?: Standing; refusal?: Standing; real?: Standing; cleared?: Standing }
const REFUSAL_HEADER = '## Delegation not applied';

const record = (value: unknown): value is Record<string, any> => typeof value === 'object' && value !== null && !Array.isArray(value);
const boundedID = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 512;
const uuid = (value: unknown) => typeof value === 'string' && /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value);
const iso = (value: unknown) => typeof value === 'string' && /^\d{4}-\d\d-\d\dT/.test(value) && Number.isFinite(Date.parse(value));
const strings = (value: Record<string, any>, fields: string[]) => fields.every(field => typeof value[field] === 'string');
const nullable = (value: Record<string, any>, fields: string[], valid: (v: unknown) => boolean) => fields.every(field => value[field] === undefined || value[field] === null || valid(value[field]));
function failureMarker(value: unknown): boolean {
  return record(value) && ['error', 'isError', 'partial'].some(field => Object.hasOwn(value, field) && value[field] !== false && value[field] !== undefined && value[field] !== null);
}
/** Finite metadata predicates only: never inspect prompt/body/worker text or unwrap content. */
function proxyReason(event: ToolHooks['execute.after']): number {
  if (event.status !== 'completed' || !record(event.input) || !record(event.result) || !record(event.result.output)) return 0;
  const output = event.result.output;
  if ([event, event.result, event.result.metadata, output].some(failureMarker)) return 0;
  if (event.tool === 'subagent') {
    const input = event.input;
    return strings(input, ['agent', 'description', 'prompt'])
      && (input.sessionID === undefined || boundedID(input.sessionID))
      && (input.model === undefined || typeof input.model === 'string')
      && (input.background === undefined || typeof input.background === 'boolean')
      && boundedID(output.sessionID) && (output.status === 'running' || output.status === 'completed') && typeof output.output === 'string' ? DISPATCH : 0;
  }
  if (event.tool === 'linear_save_issue') {
    return strings(output, ['id', 'uuid', 'title', 'status', 'statusType', 'createdAt', 'updatedAt', 'team', 'teamId', 'url', 'gitBranchName', 'createdBy', 'createdById'])
      && /^[A-Z][A-Z0-9]*-\d+$/.test(output.id) && uuid(output.uuid) && iso(output.createdAt) && iso(output.updatedAt)
      && ['unstarted', 'started', 'completed', 'canceled'].includes(output.statusType)
      && record(output.priority) && Number.isInteger(output.priority.value) && output.priority.value >= 0 && output.priority.value <= 4 && typeof output.priority.name === 'string'
      && Array.isArray(output.labels)
      && nullable(output, ['completedAt', 'canceledAt', 'archivedAt', 'startedAt'], iso)
      && nullable(output, ['dueDate', 'slaStartedAt', 'slaMediumRiskAt', 'slaHighRiskAt', 'slaBreachesAt'], v => typeof v === 'string')
      && nullable(output, ['assignee', 'assigneeId', 'project', 'projectId', 'parent'], v => typeof v === 'string' || record(v)) ? TRACKER : 0;
  }
  if (event.tool === 'linear_save_comment') {
    return uuid(output.id) && strings(output, ['body', 'createdAt', 'updatedAt']) && iso(output.createdAt) && iso(output.updatedAt)
      && Array.isArray(output.attachments) && record(output.author) && strings(output.author, ['id', 'name'])
      && nullable(output, ['parentId'], uuid) && nullable(output, ['resolvedAt', 'quotedText'], v => typeof v === 'string')
      && nullable(output, ['onBehalfOf'], record) ? TRACKER : 0;
  }
  return 0;
}

// Lexical metadata only. Neither the path nor any document/diff text is retained.
function possiblePath(value: unknown): value is string {
  if (typeof value !== 'string' || !value || value.length > 4096 || /[\x00-\x1f\x7f]/.test(value)) return false;
  const name = path.basename(value).toLowerCase();
  if (!/\.(md|markdown)$/.test(name) || /^(readme|todo)\.(md|markdown)$/.test(name)) return false;
  return shapedPath(path.normalize(value).split(path.sep));
}
function shapedPath(parts: string[]) {
  // Spec paths have a deliberately narrower shape than ordinary plan folders.
  const spec = parts.lastIndexOf('openspec');
  if (spec !== -1 && parts[spec + 1] === 'changes') {
    return parts.length === spec + 4 && parts[spec + 2] !== 'archive'
      && /^(tasks|proposal)\.md$/i.test(parts.at(-1)!);
  }
  return /^plan\.(md|markdown)$/i.test(parts.at(-1)!) || parts.slice(0, -1).some(part => part === 'plans' || part === '.plans');
}
function planPath(value: string, directory: string) {
  const relative = path.relative(directory, path.resolve(directory, value));
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return false;
  const parts = relative.split(path.sep);
  return shapedPath(parts);
}
function successfulPath(event: ToolHooks['execute.after']): string | undefined {
  if (event.tool !== 'write' && event.tool !== 'edit') return;
  if (event.status !== 'completed' || !record(event.input) || !possiblePath(event.input.path)) return;
  const result = event.result;
  const output = result.output;
  // No successful-partial variant exists for the pinned single-file tools. Also
  // fail closed on an explicit partial marker from an unknown/extended shape.
  if (!record(output) || [event, result, result.metadata, output].some(failureMarker)) return;
  if (event.tool === 'write') {
    if (output.operation === 'write' && typeof output.existed === 'boolean' && typeof output.target === 'string' && typeof output.resource === 'string') return event.input.path;
  } else if (Number.isSafeInteger(output.replacements) && output.replacements > 0 && Array.isArray(output.files) && output.files.length === 1 && typeof output.files[0]?.file === 'string') return event.input.path;
}

type SessionID = Parameters<Plugin.Context['session']['get']>[0]['sessionID'];
export interface ResumeActivation {
  storeId: string;
  read: ResumeRead;
  refusals?: (sessionID:string)=>DelegationRefusals;
  identity: (sessionID: SessionID, alive: () => boolean, signal: AbortSignal) => Promise<Pick<ResumeRequest, 'sourceId' | 'sessionId' | 'parentId' | 'ancestry'>>;
  /** Monotonic clock injection for deadline tests; never persisted. */
  now?: () => number;
}

const REFUSAL_REASONS:Record<string,string>={
  'relevant-change':'the declared tasks changed',
  conflict:'the plan changed and retained history could not prove those changes irrelevant to the declared tasks',
  'structural-change':'the plan structure changed',
  closed:'the plan was closed or archived',
  assignment:'the tasks or native child no longer met assignment requirements',
  'source-unverified':'the source could not be verified',
  unverified:'the dispatch or child identity could not be verified',
  binding:'the dispatch or child identity could not be verified',
  'dispatch-unconfirmed':'the reserved dispatch did not return a verified child',
  'incomplete-proof':'the retained proof was incomplete',
  'missing-proof':'required retained proof was missing',
  budget:'the proof exceeded its bounded lookup budget',
  disabled:'capture was disabled or its generation changed',
  'capture-disabled':'capture was disabled or its generation changed',
  'not-found':'the plan or required evidence was unavailable',
};
/** Fixed prose plus validated IDs only; no task titles, document or tool text. */
export function delegationRefusalText(selection:DelegationRefusals):string {
  if(!selection.refusals.length)return selection.complete?'':'Additional refusal evidence may be unavailable or omitted.';
  const header='## Delegation not applied';
  const recovery='Read current state. To recover, re-declare at the current revision before a new dispatch, or explicitly link the verified returned child session to its tasks. A refusal grants no assignment and changes no task status.';
  const lines:string[]=[];let omitted=!selection.complete;
  for(const refusal of selection.refusals.slice(0,3)){
    const d=refusal.declaration;let tasks=d.taskIds.slice();
    const prefix=`- Plan ${JSON.stringify(refusal.plan)}, declaration ${JSON.stringify(d.oid)} at revision ${d.declaredRevision}`;
    let line='';
    do {
      line=`${prefix}; tasks ${JSON.stringify(tasks)}${tasks.length<d.taskIds.length?' (additional task IDs omitted)':''}: not applied because ${REFUSAL_REASONS[refusal.reason]??'binding could not be safely verified'}.`;
      if(Buffer.byteLength([header,...lines,line,recovery,'Additional refusal evidence may be unavailable or omitted.'].join('\n'))<=4096)break;
      tasks=tasks.slice(0,-1);
    }while(tasks.length);
    if(!tasks.length){omitted=true;break;}
    lines.push(line);
  }
  omitted ||= lines.length<selection.refusals.length;
  return [header,...lines,recovery,...(omitted?['Additional refusal evidence may be unavailable or omitted.']:[])].join('\n');
}

function resumeText(selection: ResumeSelection, assignedOnly = false): string {
  let candidates = selection.candidates.slice(0, 3);
  let omitted = selection.omitted || selection.candidates.length > 3;
  while (candidates.length) {
    const unconfirmed = selection.incomplete || omitted || candidates.length !== 1;
    const text = [
      assignedOnly ? '## Assigned task reporting — current recorded scope' : unconfirmed ? '## Progress resume — unconfirmed candidates' : '## Progress resume — recorded pointer',
      'Read current state before any mutation, including after a conflict. This selects no action and grants no new permission.',
      ...(assignedOnly ? ['Report actual working changes; report blocked with a safe reason and next action when known; report done only for your assigned work. Use fresh operation IDs and the revision from a fresh read. Never alter structure, siblings or plan lifecycle. An optional handoff taskUpdate explicitly commits final statuses with the claim; outcome alone changes no tasks. Repeated guidance needs no report.'] : []),
      ...(unconfirmed ? ['Read and confirm a target before reporting.'] : []),
      ...(selection.incomplete || omitted ? ['Additional eligible candidates may exist; discovery or output is incomplete.'] : []),
      'Progress source IDs below are namespace metadata, not the tool’s document-path source argument.',
      ...candidates.map(p => `- source ${p.sourceId}; plan ${p.plan}; title ${JSON.stringify(p.title)}; last-known revision ${p.revision}. Read: agent_progress_report ${JSON.stringify({ op: 'read', plan: p.plan })}` +
        (p.scope === 'assigned' ? `\n  Assigned-only scope: ${JSON.stringify(p.itemIds)}. Contribute only these assigned item IDs; no broader scope is implied.` : '')),
    ].join('\n');
    if (Buffer.byteLength(text, 'utf8') <= 4096) return text;
    candidates = candidates.slice(0, -1); omitted = true;
  }
  return '';
}

/** Advisory only; optional bounded read projection, never executor/receipt/capture/mutation access. */
export async function registerActivation(ctx: Plugin.Context, source: { id: string; verified: boolean }, enabled: () => boolean, recovery?: ResumeActivation, onContext?: (handler:(event:SessionHooks['context'])=>Promise<void>)=>void) {
  const pending = new Map<string, number>(); // max128; low bits=context, high bits=result
  const recent = new Set<string>(); // max256 qualifying source/session/message/call IDs
  const eligibility = new Map<string, Set<string>>(); // latest context, max128 sessions
  const noted = new Set<string>(); // max256 source/session/model-message IDs
  const memories = new Map<string, NoteMemory>(); // delivered context notes; max128 sessions, least recently used first
  let capsuleDelivery = 0; // capsule order, independent of later hints/refusals on the same carrier
  const owned = Symbol('agent-progress-section');
  // The section is fixed text: it must be byte-identical on every request, or
  // a provider's prompt cache misses from this point on. Anything that varies
  // per request rides a message instead and stays there (see `carrierAt`).
  function section() {
    const part = { type: 'text' as const, text: ACTIVATION_GUIDANCE };
    Object.defineProperty(part, owned, { value: true });
    return part;
  }
  const registrations: Array<{ dispose(): Promise<void> }> = [];
  let disposed = false;
  let disableEpoch = 0; // invalidates in-flight lookups when disable is observed
  type Compaction = {
    seq: number; fence: number; pending: boolean;
    start?: { reason: 'auto' | 'manual'; created: number };
    firstHook?: number; lastHook?: number; ambiguous?: boolean;
  };
  const compactions = new Map<string, Compaction>(); // max128; identities only, never plan payloads
  const replay = new Set<string>(); // max256 source/session/event identities
  let eventFloor = Date.now(); // eviction/reload must not reconstruct old attempts
  let binding = JSON.stringify([source.id, source.verified, recovery?.storeId]);
  let recoveryAvailable = false, lookupBusy = false;
  let stopRecovery: (() => Promise<void>) | undefined;
  let held: AbortController | undefined;
  function retireRecovery() {
    eventFloor = Math.max(eventFloor, Date.now());
    // A clock rollback must not erase a newer retained retirement boundary.
    for (const attempt of compactions.values()) eventFloor = Math.max(eventFloor, attempt.fence);
    compactions.clear(); held?.abort();
  }
  function control() {
    const current = JSON.stringify([source.id, source.verified, recovery?.storeId]);
    if (current !== binding) { binding = current; retireRecovery(); pending.clear(); eligibility.clear(); noted.clear(); memories.clear(); disableEpoch++; }
    try { if (enabled() === true) return true; } catch { /* unavailable control is not enabled */ }
    pending.clear(); eligibility.clear(); noted.clear(); memories.clear(); retireRecovery(); disableEpoch++; return false;
  }
  function remember(set: Set<string>, key: string, cap: number) {
    set.add(key);
    if (set.size > cap) set.delete(set.values().next().value!);
  }
  function flag(recipient: string, reason: number) {
    pending.set(recipient, (pending.get(recipient) ?? 0) | reason | reason << 3);
    if (pending.size > 128) pending.delete(pending.keys().next().value!);
  }
  const key = (sessionID: string) => JSON.stringify([source.id, sessionID]);
  function retain(sessionKey: string, attempt: Compaction, created: number) {
    compactions.delete(sessionKey); compactions.set(sessionKey, attempt);
    if (compactions.size > 128) {
      const oldest = compactions.keys().next().value!;
      // Removing a tombstone must not erase a newer primary-retirement fence.
      eventFloor = Math.max(eventFloor, created, compactions.get(oldest)!.fence);
      compactions.delete(oldest);
    }
  }
  function clearWindow(attempt: Compaction) {
    delete attempt.start; delete attempt.firstHook; delete attempt.lastHook; delete attempt.ambiguous;
  }
  async function session(sessionID: Parameters<Plugin.Context['session']['get']>[0]['sessionID']) {
    const value = await ctx.session.get({ sessionID });
    // Conditional copy needs no plan scan; reporting still performs
    // its unchanged authoritative ancestry/assignment checks at the executor.
    return value.id === sessionID && path.isAbsolute(value.location.directory) ? value : undefined;
  }
  async function projectDirectories(projectID: NonNullable<Awaited<ReturnType<typeof session>>>['projectID']) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const list = await Promise.race([ctx.worktree.list({ projectID }), new Promise<undefined>(resolve => { timer = setTimeout(() => resolve(undefined), 1000); })]);
      return Array.isArray(list) && list.every(entry => record(entry) && typeof entry.directory === 'string' && path.isAbsolute(entry.directory))
        ? list.map(entry => path.resolve(entry.directory)) : [];
    } catch { return []; }
    finally { if (timer !== undefined) clearTimeout(timer); }
  }
  async function dispose() {
    disposed = true; pending.clear(); recent.clear(); eligibility.clear(); noted.clear(); memories.clear(); retireRecovery(); replay.clear();
    await stopRecovery?.();
    for (const registration of registrations.splice(0)) {
      try { await registration.dispose(); } catch { /* host scope also owns cleanup */ }
    }
  }
  try {
    registrations.push(await ctx.tool.hook('execute.after', async event => {
      try {
        if (disposed || !source.verified) return;
        const candidate = successfulPath(event);
        const proxy = proxyReason(event);
        if ((!candidate && !proxy) || !boundedID(event.sessionID) || !boundedID(event.messageID) || !boundedID(event.id)) return;
        const call = JSON.stringify([source.id, event.sessionID, event.messageID, event.id]);
        if (recent.has(call) || !control()) return;
        const epoch = disableEpoch;
        const caller = await session(event.sessionID);
        if (disposed || epoch !== disableEpoch || !control() || !caller || recent.has(call)) return;
        let directories: string[] | undefined;
        const listedDirectories = async () => directories ??= boundedID(caller.projectID) ? await projectDirectories(caller.projectID) : [];
        if (candidate && !planPath(candidate, caller.location.directory)
          && !(await listedDirectories()).some(directory => planPath(path.resolve(caller.location.directory, candidate), directory))) return;
        let parentID: string | undefined;
        if (candidate && boundedID(caller.parentID) && caller.parentID !== caller.id) {
          try {
            const parent = await session(caller.parentID);
            if (parent && boundedID(caller.projectID) && parent.projectID === caller.projectID
              && (path.resolve(parent.location.directory) === path.resolve(caller.location.directory)
                || (await listedDirectories()).includes(path.resolve(parent.location.directory)))
              && parent.parentID !== parent.id && parent.parentID !== caller.id) parentID = parent.id;
          } catch { /* an unverifiable parent cannot remove the independent writer hint */ }
        }
        // Resolve recipients before one synchronous commit. Concurrent duplicate
        // callbacks must not repopulate either flag after an intervening delivery.
        if (disposed || epoch !== disableEpoch || !control() || recent.has(call)) return;
        remember(recent, call, 256);
        flag(key(event.sessionID), candidate ? PLAN : proxy);
        if (parentID) flag(key(parentID), PLAN);
        const sessionKey = key(event.sessionID), step = JSON.stringify([source.id, event.sessionID, event.messageID]);
        if (event.status === 'completed' && eligibility.get(sessionKey)?.has(event.tool) && !noted.has(step)) {
          const replacement = notedResult(event.result, noteText((pending.get(sessionKey) ?? 0) >> 3));
          if (replacement) {
            event.result = replacement;
            remember(noted, step, 256);
            pending.set(sessionKey, (pending.get(sessionKey) ?? 0) & 7);
          }
        }
      } catch { /* observation must never fail or change the original tool */ }
    }));
    const context = async (event:SessionHooks['context']) => {
      const removeOwned = () => {
        for (let i = event.system.length - 1; i >= 0; i--) if (Object.prototype.hasOwnProperty.call(event.system[i], owned)) event.system.splice(i, 1);
        restoreNotes(event.messages);
      };
      try {
        // A reused host array may carry an old section or note, never a reusable
        // payload: drop both and rebuild from this request alone.
        restoreNotes(event.messages);
        for (let i = 0; i < event.system.length; i++) if (Object.prototype.hasOwnProperty.call(event.system[i], owned)) event.system[i] = section();
        if (disposed) { removeOwned(); return; }
        if (!boundedID(event.sessionID)) return;
        const sessionKey = key(event.sessionID);
        // Do not reuse permission evidence across an unverified/failed context.
        const effective = new Set<string>();
        eligibility.set(sessionKey, effective);
        if (eligibility.size > 128) eligibility.delete(eligibility.keys().next().value!);
        const active = control();
        const attempt = compactions.get(sessionKey) ?? { seq: 0, fence: eventFloor, pending: false };
        const armed = attempt?.pending === true;
        // Consume incomplete evidence too, before any await. Delayed stream parts
        // created before this primary cannot backfill a later turn.
        attempt.pending = false; clearWindow(attempt);
        attempt.fence = Math.max(attempt.fence, Date.now());
        if (recovery && active) retain(sessionKey, attempt, attempt.fence);
        if (!source.verified || !Object.prototype.hasOwnProperty.call(event.tools, REPORT_TOOL) || !active) {
          pending.delete(sessionKey); removeOwned(); return;
        }
        const epoch = disableEpoch;
        const caller = await session(event.sessionID);
        if (disposed || epoch !== disableEpoch) { removeOwned(); return; }
        if (!caller || !control()) { pending.delete(sessionKey); removeOwned(); return; }
        let capsule = '';
        let childCapsule = false, clearChildCapsules = false;
        // A new note needs a carrier valid for the latest message's role. Without one
        // nothing new is computed or consumed: the hint stays pending and an armed capsule
        // stays armed for the next request that has a carrier. Delivered notes are still
        // put back in place.
        const carried = Array.isArray(event.messages) && carrierAt(event.messages, event.messages.length - 1, false, false) !== undefined; // validity only; the keyed carrier is taken once after the awaits
        const rearm = () => { if (armed && compactions.get(sessionKey) === attempt) attempt.pending = true; };
        if (!carried) rearm();
        // Ordinary coordinators do not scan plans. Children reuse the bounded,
        // read-only identity/projection owner on naturally occurring contexts.
        const assignedOnly = !armed && !!caller.parentID;
        if (carried && (armed && recoveryAvailable || assignedOnly) && recovery && !lookupBusy && compactions.get(sessionKey) === attempt) {
          const controller = new AbortController(); held = controller;
          const now = recovery.now ?? (() => performance.now());
          const deadline = now() + 1000;
          const alive = () => !controller.signal.aborted && !disposed && (assignedOnly || recoveryAvailable) && control() && epoch === disableEpoch && source.verified && compactions.get(sessionKey) === attempt && now() < deadline;
          let timer: ReturnType<typeof setTimeout> | undefined;
          lookupBusy = true;
          const lookup = (async () => {
            try {
              if (!alive()) return null;
              const identity = await recovery.identity(event.sessionID, alive, controller.signal);
              return alive() ? identity : null;
            } catch { return null; }
            finally { lookupBusy = false; if (held === controller) held = undefined; }
          })();
          try {
            // A provider ignoring abort may leave one request outstanding, never another ancestry hop.
            const identity = await Promise.race([lookup, new Promise<null>(resolve => {
              timer = setTimeout(() => { controller.abort(); resolve(null); }, 1000);
            })]);
            if (identity && alive() && Object.prototype.hasOwnProperty.call(event.tools, REPORT_TOOL) && identity.sourceId === source.id && identity.sessionId === event.sessionID) {
              const selection = recovery.read({ storeId: recovery.storeId, sourceId: identity.sourceId, sessionId: identity.sessionId, parentId: identity.parentId, ancestry: identity.ancestry });
              if (selection && selection.storeId === recovery.storeId && selection.sourceId === source.id && selection.sessionId === event.sessionID) {
                childCapsule = identity.parentId !== null;
                clearChildCapsules = childCapsule && identity.parentId === caller.parentID && identity.ancestry !== null
                  && !selection.incomplete && !selection.omitted && selection.candidates.length === 0;
                capsule = resumeText(assignedOnly ? {...selection,candidates:selection.candidates.filter(p=>p.scope==='assigned')} : selection, assignedOnly);
              }
            }
          } catch { /* optional recovery faults preserve eligible base guidance */ }
          finally { if (timer !== undefined) clearTimeout(timer); controller.abort(); }
        }
        if (disposed || !control() || epoch !== disableEpoch || !source.verified || !Object.prototype.hasOwnProperty.call(event.tools, REPORT_TOOL)) { removeOwned(); return; }
        // 'failed' adds nothing; 'cleared' is a successful, complete read that found no refusal.
        let refusal='',refusalRead:'failed'|'read'|'cleared'='failed';
        try {
          const selection=carried?recovery?.refusals?.(event.sessionID):undefined;
          if(selection?.sourceId===source.id&&selection.sessionId===event.sessionID){
            refusal=delegationRefusalText(selection);refusalRead=refusal?'read':'cleared';
          }
        } catch { refusal='';refusalRead='failed'; /* Optional bounded receipt read never enables a report or blocks guidance. */ }
        if(disposed||!control()||epoch!==disableEpoch||!source.verified||!Object.prototype.hasOwnProperty.call(event.tools,REPORT_TOOL)){removeOwned();return;}
        if (eligibility.get(sessionKey) === effective) for (const tool of NOTE_TOOLS) {
          if (Object.prototype.hasOwnProperty.call(event.tools, tool)) effective.add(tool);
        }
        // The section is the fixed guidance and nothing else, whatever this request carries.
        const existing = event.system.findIndex(part => Object.prototype.hasOwnProperty.call(part, owned));
        if (existing !== -1) event.system[existing] = section(); else event.system.push(section());
        const hint = (pending.get(sessionKey) ?? 0) & 7;
        // One synchronous step from here: compare with the last delivery, add every note and
        // then record the memory, so concurrent requests each record their own carrier and a
        // failure while adding leaves no phantom note.
        const messages = event.messages;
        // An overlapping request on a reused array may have added its copies since the top.
        restoreNotes(messages);
        const current = memories.get(sessionKey);
        const notes = new Map(current?.notes);
        let { capsule: lastCapsule, refusal: lastRefusal, real: lastReal, cleared: lastCleared } = current ?? {} as NoteMemory;
        const ids = new Map<string, number>();
        if (Array.isArray(messages)) messages.forEach((message, i) => { if (record(message) && message.role === 'user' && boundedID(message.id) && !ids.has(message.id)) ids.set(message.id, i); });
        const placed = new Map<string, Carrier>(); // remembered notes whose carrier this request still holds
        for (const note of notes.values()) {
          // A shared user identifier: the position the note was delivered at wins.
          const at = note.id === undefined ? note.index : record(messages?.[note.index]) && messages[note.index].id === note.id ? note.index : ids.get(note.id) ?? -1;
          const found = carrierAt(messages, at);
          if (found?.key === note.key) placed.set(note.key, found);
        }
        let latest = Array.isArray(messages) ? carrierAt(messages, messages.length - 1) : undefined;
        // A user identifier shared with a message that already holds a note is not this message's key.
        if (latest?.id !== undefined && placed.has(latest.key) && placed.get(latest.key)!.index !== latest.index) latest = carrierAt(messages, messages.length - 1, true);
        if (clearChildCapsules) {
          let replacement: ChildCapsuleSpan | undefined;
          for (const [noteKey] of placed) {
            const span = notes.get(noteKey)!.childCapsules?.at(-1);
            if (span && (!replacement || span.delivery > replacement.delivery)) replacement = span;
          }
          for (const [noteKey, note] of notes) {
            if (!note.childCapsules) continue;
            const text = withoutChildCapsules(note.text, note.childCapsules, replacement);
            if (text) notes.set(noteKey, { ...note, text, childCapsules: undefined });
            else { notes.delete(noteKey); placed.delete(noteKey); }
          }
          lastCapsule = undefined;
        }
        let consumed = false, recorded = false;
        if (!latest) rearm(); // the hint stays pending; an armed capsule stays armed; capsule and refusal are read again next request
        else {
          const before = notes.get(latest.key);
          const hintNote = hint ? hintText(hint) : '';
          const due: string[] = hintNote ? [hintNote] : [];
          const standing = (last: Standing | undefined, text: string) => !last || last.text !== text || !placed.has(last.key);
          const capsuleDue = !!capsule && standing(lastCapsule, capsule);
          if (capsuleDue) due.push(capsule);
          let refusalDue: string | undefined;
          if (refusalRead === 'read' && standing(lastRefusal, refusal)) refusalDue = refusal;
          else if (refusalRead === 'cleared' && lastReal && placed.has(lastReal.key) && !(lastCleared && placed.has(lastCleared.key))) refusalDue = CLEARED_REFUSAL;
          if (refusalDue !== undefined) due.push(refusalDue);
          const text = [...(before ? [before.text] : []), ...(due.length ? [due.join(NOTE_SEPARATOR)] : [])].join(NOTE_SEPARATOR);
          if (!due.length || Buffer.byteLength(text) <= MAX_NOTE_BYTES) {
            if (due.length) {
              // A later note on a carrier follows the earlier ones; it is also the newest.
              const capsuleStart = (before ? before.text.length + NOTE_SEPARATOR.length : 0)
                + (hintNote ? hintNote.length + NOTE_SEPARATOR.length : 0);
              const childCapsules = capsuleDue && childCapsule
                ? [...(before?.childCapsules ?? []), { start: capsuleStart, end: capsuleStart + capsule.length, delivery: ++capsuleDelivery }]
                : before?.childCapsules;
              notes.delete(latest.key);
              notes.set(latest.key, { key: latest.key, id: latest.id, index: latest.index, text, childCapsules });
              placed.set(latest.key, latest);
              if (capsuleDue) lastCapsule = { text: capsule, key: latest.key };
              if (refusalDue !== undefined) {
                lastRefusal = { text: refusalDue, key: latest.key };
                if (refusalDue === CLEARED_REFUSAL) lastCleared = lastRefusal;
                else if (refusalDue.startsWith(REFUSAL_HEADER)) { lastReal = lastRefusal; lastCleared = undefined; }
              }
              recorded = true;
            }
            consumed = true;
          } else rearm(); // too large for this carrier: the armed capsule waits for another
        }
        // Bound: carriers absent from this request go first, then the oldest.
        let bytes = 0;
        for (const note of notes.values()) bytes += Buffer.byteLength(note.text);
        while (notes.size > MAX_NOTE_CARRIERS || bytes > MAX_NOTE_BYTES) {
          const victim = [...notes.values()].find(note => !placed.has(note.key)) ?? notes.values().next().value!;
          notes.delete(victim.key); placed.delete(victim.key); bytes -= Buffer.byteLength(victim.text);
        }
        for (const [noteKey, carrier] of placed) messages[carrier.index] = carrier.apply(notes.get(noteKey)!.text) as typeof messages[number];
        // Applied: now record. A session's memory exists only once it holds a note.
        if (current || recorded) {
          memories.delete(sessionKey);
          memories.set(sessionKey, { notes, capsule: lastCapsule, refusal: lastRefusal, real: lastReal, cleared: lastCleared });
          if (memories.size > MAX_NOTE_SESSIONS) memories.delete(memories.keys().next().value!);
        }
        if (consumed) {
          const remaining = (pending.get(sessionKey) ?? 0) & ~7;
          if (remaining) pending.set(sessionKey, remaining); else pending.delete(sessionKey);
        }
      } catch { pending.delete(key(event.sessionID)); eligibility.delete(key(event.sessionID)); try { removeOwned(); } catch { /* malformed/immutable host context */ } }
    };
    registrations.push(await ctx.session.hook('context',context));
    onContext?.(context);
    if (recovery) {
      const abort = new AbortController();
      let registration: { dispose(): Promise<void> } | undefined;
      let events: Promise<void> | undefined;
      stopRecovery = async () => { abort.abort(); await events; };
      try {
        const stream = ctx.event.subscribe({ signal: abort.signal });
        if (!stream || typeof stream[Symbol.asyncIterator] !== 'function') throw new Error('unsupported');
        registration = await ctx.session.hook('compaction', event => {
          // Observe metadata only; never inspect/change summaries, messages, tools or result.
          if (disposed || !control() || !source.verified || !boundedID(event.sessionID) || !identifier(event.sessionID)) return;
          const sessionKey = key(event.sessionID), observed = Date.now();
          const attempt = { ...(compactions.get(sessionKey) ?? { seq: 0, fence: eventFloor, pending: false }) };
          if (!Number.isFinite(observed) || observed <= Math.max(eventFloor, attempt.fence)) {
            attempt.pending = false; clearWindow(attempt);
            retain(sessionKey, attempt, eventFloor); return;
          }
          // A new observation after completion supersedes, never revives, it.
          attempt.pending = false;
          if (attempt.lastHook !== undefined && observed < attempt.lastHook) attempt.ambiguous = true;
          attempt.firstHook ??= observed; attempt.lastHook = observed;
          retain(sessionKey, attempt, observed);
        });
        recoveryAvailable = true;
        events = (async () => {
          try {
            for await (const event of stream) {
              if (disposed || !control() || !source.verified) continue;
              if (event.type !== 'session.compaction.started' && event.type !== 'session.compaction.ended' && event.type !== 'session.compaction.failed') continue;
              const { sessionID, reason } = event.data;
              if (!identifier(sessionID) || !boundedID(event.id) || !Number.isSafeInteger(event.durable.seq) || event.durable.seq < 1 || event.durable.aggregateID !== sessionID || !Number.isFinite(event.created) || event.location?.directory !== ctx.location.directory || (reason !== 'auto' && reason !== 'manual')) continue;
              const sessionKey = key(sessionID);
              // Timestamps are not unique: a cap-advanced floor may also reject a
              // retained session's failure. Retire its old attempt, never arm it.
              if (event.created <= eventFloor) {
                eventFloor = Math.max(eventFloor, compactions.get(sessionKey)?.fence ?? eventFloor);
                compactions.delete(sessionKey); continue;
              }
              const eventKey = JSON.stringify([sessionKey, event.id]);
              const previous = compactions.get(sessionKey);
              if (replay.has(eventKey) || previous && event.durable.seq <= previous.seq) continue;
              remember(replay, eventKey, 256);
              const started = event.type === 'session.compaction.started';
              const ended = event.type === 'session.compaction.ended';
              const next: Compaction = { ...(previous ?? { seq: 0, fence: eventFloor, pending: false }) };
              next.seq = event.durable.seq;
              next.pending = false;
              if (event.created <= next.fence || event.created > Date.now()) {
                clearWindow(next);
              } else if (started) {
                if (next.start) next.ambiguous = true; // no shared attempt token: crossed starts decline
                next.start = { reason, created: event.created };
              } else {
                next.pending = ended && !next.ambiguous && next.start?.reason === reason &&
                  next.firstHook !== undefined && next.lastHook !== undefined &&
                  next.start.created < next.firstHook && next.firstHook <= next.lastHook && next.lastHook < event.created;
                clearWindow(next);
                next.fence = Math.max(next.fence, event.created);
              }
              retain(sessionKey, next, event.created);
            }
          } catch { /* unavailable optional subscription: generic activation stays registered */ }
          finally { recoveryAvailable = false; retireRecovery(); try { await registration?.dispose(); } catch { /* optional cleanup */ } }
        })();
      } catch {
        abort.abort(); recoveryAvailable = false; retireRecovery();
        try { await registration?.dispose(); } catch { /* optional cleanup */ }
      }
    }
    return dispose;
  } catch (error) { await dispose(); throw error; }
}
