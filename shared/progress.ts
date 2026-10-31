/** Frozen production v2 DTO. Probe v1 types are historical fixtures only. */
export const VERSION = 2 as const;
export type { ChangeDigest, DigestTask, DigestReference, DigestFacts, DigestEvents, DigestFacet, DigestReason, DigestScope } from './change-digest.ts';
export const LIMITS = { requestBytes: 16_384, documentBytes: 262_144, pageSize: 20, maxPageSize: 50, chunkItems: 50, chunks: 32, planItems: 1000, responseBytes: 1_048_576 } as const;
export type Status = 'pending' | 'working' | 'blocked' | 'done' | 'skipped';
/** Additive v2 blocker contract revision 1; protocol/schema remain 2. */
export const BLOCKER_LIMITS = { textCodeUnits: 512, snapshotVisits: 128, inputBytes: 8 * 1024 * 1024, taskEntries: 1000 } as const;
export type BlockerCategory = 'decision' | 'dependency' | 'review' | 'external' | 'other';
/** Complete replacement on a blocked task; null clears, omission retains only verified-current data. */
export interface BlockerInput { category?: BlockerCategory; reason?: string; nextAction?: string }
/** Server-authored provenance. Trust only when validAtRevision equals the enclosing revision. */
export interface BlockerAnnotation extends BlockerInput {
  reportedRevision: number; reportedAt: string; reporterSessionId: string;
  attributedSessionId: string; mode: 'direct' | 'parent-relay'; validAtRevision: number;
}
export type Lifecycle = 'active' | 'finished' | 'cancelled' | 'failed';
export type Code = 'invalid' | 'not-found' | 'conflict' | 'operation-reused' | 'assignment' | 'source-unverified' | 'closed' | 'unfinished' | 'disabled' | 'busy' | 'storage' | 'corrupt' | 'schema' | 'binding' | 'stage-incomplete';
export type ValidationHint = typeof VALIDATION_HINTS[keyof typeof VALIDATION_HINTS];
export class ProgressError extends Error {
  readonly code: Code; readonly revision?: number; readonly hint?: ValidationHint;
  constructor(code: Code, revision?: number, hint?: ValidationHint) { super(code); this.code = code; this.revision = revision; if(code === 'invalid') this.hint = hint; }
}
export function requireProgress(value: unknown, code: Code = 'invalid', revision?: number): asserts value { if (!value) throw new ProgressError(code, revision); }
/** Optional server-authored attribution, not a progress report or completion. */
export interface AssignmentBinding { coordinatorSessionId: string; childSessionId: string; planId: string; itemId: string; tool: 'subagent'; messageId: string; callId: string; observedAt: string; boundAt: string; boundRevision: number; validAtRevision: number }
export interface Item { id: string; title: string; kind: 'task' | 'group'; status: Status; parentId?: string; dependencies?: string[]; assigneeSessionId?: string; reporterSessionId?: string; blocker?: BlockerAnnotation; assignmentBinding?: AssignmentBinding }
export type ItemInput = Omit<Item, 'status' | 'assigneeSessionId' | 'reporterSessionId' | 'blocker' | 'assignmentBinding'> & { status?: Status };
/** Deliberate annotation input; stored provenance is never caller supplied. */
export type BlockerItemInput = ItemInput & { blocker?: BlockerInput | null };
export interface BlockerChangeInput { id: string; status: Status; blocker?: BlockerInput | null }
export interface Actor { sourceId: string; sessionId: string; agent: string; directory: string; projectId?: string; parentId: string | null; ancestry: string[] | null; verifiedSource: boolean }
export interface Source { id: string; configRoot: string; dataRoot: string; verified: boolean }
export type DocumentState = 'unbound' | 'captured' | 'denied' | 'missing' | 'moved' | 'oversized' | 'non-text' | 'unavailable' | 'changed-during-read';
export interface Capture { state: DocumentState; path: string; canonicalPath?: string; text?: string; hash?: string; checkedAt: string }
export interface DocumentRef { state: DocumentState; path?: string; canonicalPath?: string; captureId?: number; hash?: string; capturedAt?: string; checkedAt?: string; checklistSynchronized: boolean; currentFile: 'not-rechecked' }
export interface Counts { done: number; total: number; remaining: number; skipped: number }
export function countItems(items: readonly Item[]): Counts {
  const leaves = items.filter(i => i.kind === 'task');
  const done = leaves.filter(i => i.status === 'done').length; const skipped = leaves.filter(i => i.status === 'skipped').length;
  return { done, total: leaves.length - skipped, remaining: leaves.length - skipped - done, skipped };
}
export interface Contribution { revision: number; reporterSessionId: string; reporterAgent: string; attributedSessionId: string; mode: 'direct' | 'parent-relay'; itemIds: string[]; reportedAt: string }
export interface PlanSummary { id: string; sourceId: string; title: string; sessionId: string; revision: number; structuralRevision: number; lifecycle: Lifecycle; reportedAt: string; directory: string; projectId?: string; counts: Counts; working: string[]; document: DocumentRef; cleanup?: {state:'visible'|'archived';revision:number} }
export interface PlanState extends Omit<PlanSummary, 'counts' | 'working'> { items: Item[]; links: { sessionId: string; itemIds: string[] }[] }
export interface Envelope { protocolVersion: 2; schemaVersion: 2; storeId: string; sources: Source[]; sourceBinding: { sourceId: string | null; verified: boolean }; captureEnabled: boolean; coverage: 'recorded-only'; diagnostics: string[] }
export interface Page<T> { data: T[]; nextCursor: string | null }
/** Additive v2 search contract revision 1. No schema or report-tool change. */
export const SEARCH_LIMITS = { plans: 64, membershipRows: 128, inputBytes: 8 * 1024 * 1024, hits: 50, ancestors: 8, responseBytes: 256 * 1024, queryBytes: 16 * 1024, queryPoints: 256, tokens: 16, cursorBytes: 4096, stateKeys: 50 } as const;
export interface SearchOptions { q?: string; source?: string; session?: string; lifecycle?: Lifecycle; status?: Status; archived?: 'exclude' | 'only'; limit?: number; cursor?: string }
export interface SearchKey { source: string; plan: string }
export interface SearchIdentity { protocolVersion: 2; schemaVersion: 2; planTaskSearch: 1; storeId: string; sourceBinding: Envelope['sourceBinding'] }
export interface SearchPlan extends Omit<PlanSummary, 'working' | 'document'> { cleanup: { state: 'visible' | 'archived'; revision: number }; sourceVerified: boolean }
export interface SearchHit { plan: SearchPlan; planMatched: boolean; task: { id: string; title: string; status: Status } | null; ancestors: { id: string; title: string }[]; omittedAncestors: number; continued: boolean; classified: { matchedPlans: 1; matchingTasks: number } | null }
export type SearchGap = 'invalid-snapshot' | 'oversized-snapshot' | 'invalid-membership' | 'oversized-membership';
export interface SearchWindow extends SearchIdentity {
  fingerprint: string; hits: SearchHit[];
  /** Fully classified qualifying plans only; applied once, even across task pages. */
  counts: { matchedPlans: number; matchingTasks: number };
  nextCursor: string | null; exhausted: boolean;
  coverage: { kind: 'recorded-current'; asSearched: true; gapped: boolean; skippedRecords: number; reasons: SearchGap[] };
  work: { planSlots: number; inspectedItems: number; membershipRows: number; inputBytes: number; outputHits: number; outputBytes: number };
}
export interface SearchState extends SearchIdentity { captureEnabled: boolean; data: (SearchKey & { exists: boolean; revision: number | null; cleanup: { state: 'visible' | 'archived' | 'deleted'; revision: number } })[] }
/** Response-only reported-working history; absent item entries mean no proven interval. */
export interface PlanTiming { readAt: string; items: Record<string, { since: string; kind: 'exact' | 'lower-bound' }> }
/** Response-only reported-blocked history, never working time. Missing/unusable entries are unknown. */
export interface BlockedTiming { readAt: string; items: Record<string, { since: string; kind: 'exact' | 'lower-bound' }> }
export interface PlanRead { plan: PlanSummary; items: Page<Item>; contributions: Page<Contribution>; links: PlanState['links']; timing?: PlanTiming; blockedTiming?: BlockedTiming }
export interface DocumentRead { document: DocumentRef; text: string | null; nextCursor: string | null }
/** Official-main metadata only; not actual installation provenance or bundle audit. */
export interface ExtensionUpdateRead {
  installedVersion: string;
  repository: 'Phototonic/openchamber-progress';
  ref: 'main';
  state: 'available' | 'not-newer' | 'unknown';
  checkedAt: string | null;
  stale: boolean;
  candidateVersion?: string;
  diagnostic: 'ok' | 'unavailable' | 'rate-limited' | 'invalid-manifest' | 'invalid-response' | 'redirect' | 'too-large' | 'timeout' | 'shutdown';
  nextCheckAt: string;
}
export interface Suggestion { value: string; state: 'resolved' | 'candidate' }
export interface SetupSuggestions { configRoot: Suggestion | null; dataRoot: Suggestion | null; storeRoot: Suggestion | null }
export interface CompanionUpdateRead {
  state: 'current' | 'available' | 'newer-installed';
  candidateVersion: string;
  rootVersion: string | null;
}
export interface SetupRead {
  reportingIdentity?: { storeId: string; sourceId: string; verified: boolean };
  configured: boolean; verified: boolean; installed: boolean; captureEnabled: boolean | null;
  targets: { configRoot: string; dataRoot: string; storeRoot: string } | null;
  activation: string; separateLifecycle: true; historyRetained: true; diagnostics: string[];
  version: string | null;
  recovery?: { stagedPackages: number; stagedActivations: number; stagedReleases: number };
  action?: string;
  suggestions?: SetupSuggestions;
  update?: CompanionUpdateRead;
}
export interface Receipt { plan: string; rev: number; structuralRev: number; changed?: string[]; staged?: number }
export type Reply = Receipt | { error: Code; rev?: number; hint?: ValidationHint };
export interface Request {
  op: 'start' | 'read' | 'change' | 'revise' | 'stage' | 'commit' | 'link' | 'delegate' | 'bind' | 'finish';
  plan: string; oid?: string; rev?: number; title?: string; items?: BlockerItemInput[];
  changes?: BlockerChangeInput[]; child?: string; assign?: string[]; attributed?: string;
  source?: string; confirm?: boolean; outcome?: 'finished' | 'cancelled' | 'failed'; reopen?: boolean;
  upload?: string; chunk?: number; chunks?: number; page?: number;
}
export type BlockerRequest = Request;
export interface HandoffRequest { op:'handoff'; oid:string; summary:string; outcome:'done'|'partial'|'blocked' }
export function identifier(value: unknown): value is string { return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/.test(value); }
const BLOCKER_CATEGORIES: readonly string[] = ['decision','dependency','review','external','other'];
function blockerText(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0 && value.length <= BLOCKER_LIMITS.textCodeUnits && !value.includes('\0'); }
export function validBlockerInput(value: unknown): value is BlockerInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const b = value as Record<string, unknown>;
  return Object.keys(b).every(k => ['category','reason','nextAction'].includes(k)) &&
    (b.category === undefined || typeof b.category === 'string' && BLOCKER_CATEGORIES.includes(b.category)) &&
    (b.reason === undefined || blockerText(b.reason)) && (b.nextAction === undefined || blockerText(b.nextAction));
}
/** Read validation does not rewrite snapshots. Future categories cannot certify a known annotation. */
export function validBlockerAnnotation(value: unknown, revision: number): value is BlockerAnnotation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const b = value as Record<string, unknown>;
  return Object.keys(b).every(k => ['category','reason','nextAction','reportedRevision','reportedAt','reporterSessionId','attributedSessionId','mode','validAtRevision'].includes(k)) &&
    (b.category === undefined || typeof b.category === 'string' && BLOCKER_CATEGORIES.includes(b.category)) &&
    (b.reason === undefined || blockerText(b.reason)) && (b.nextAction === undefined || blockerText(b.nextAction)) &&
    Number.isSafeInteger(b.reportedRevision) && Number(b.reportedRevision) > 0 && Number(b.reportedRevision) <= revision &&
    Number.isSafeInteger(b.validAtRevision) && b.validAtRevision === revision &&
    typeof b.reportedAt === 'string' && Number.isFinite(Date.parse(b.reportedAt)) && new Date(b.reportedAt).toISOString() === b.reportedAt &&
    identifier(b.reporterSessionId) && identifier(b.attributedSessionId) &&
    (b.mode === 'direct' && b.reporterSessionId === b.attributedSessionId || b.mode === 'parent-relay' && b.reporterSessionId !== b.attributedSessionId);
}
export function parseRequest(value:unknown):Request {const r=parseReportRequest(value);requireProgress(r.op!=='handoff');return r;}
export function parseReportRequest(value: unknown): Request|HandoffRequest {
  validRequest(value && typeof value === 'object' && !Array.isArray(value), 'request');
  if((value as {op?:unknown}).op==='handoff') {
    const r=value as HandoffRequest;
    requireProgress(Object.keys(r).every(k=>['op','oid','summary','outcome'].includes(k))&&identifier(r.oid)&&typeof r.summary==='string'&&r.summary.trim().length>0&&r.summary.length<=200&&!/[\u0000\r\n\u2028\u2029]/.test(r.summary)&&['done','partial','blocked'].includes(r.outcome)&&Buffer.byteLength(JSON.stringify(r))<=LIMITS.requestBytes);
    return {op:'handoff',oid:r.oid,summary:r.summary,outcome:r.outcome};
  }
  const r = value as Request;
  const fields: Record<Request['op'], string[]> = {
    start: ['title','items','source'], read: ['page'], change: ['changes','attributed'], revise: ['title','items','reopen'],
    stage: ['upload','chunk','items','reopen'], commit: ['upload','chunks','title','reopen'], link: ['child','assign'], delegate: ['assign'], bind: ['source','confirm'], finish: ['outcome'],
  };
  validRequest(Object.hasOwn(fields, r.op), 'op');
  validRequest(identifier(r.plan), 'plan');
  const allowed = ['op','plan', ...(r.op === 'read' ? [] : ['oid','rev']), ...fields[r.op]];
  validRequest(Object.keys(r).every(k => allowed.includes(k)), 'fields');
  requireProgress(Buffer.byteLength(JSON.stringify(r)) <= LIMITS.requestBytes);
  if (r.op !== 'read') {
    validRequest(identifier(r.oid), 'oid');
    validRequest(Number.isSafeInteger(r.rev) && r.rev! >= 0, 'rev');
  }
  if (r.page !== undefined) requireProgress(Number.isSafeInteger(r.page) && r.page >= 0);
  if (r.title !== undefined) validRequest(typeof r.title === 'string' && r.title.trim().length > 0 && r.title.length <= 256, 'title');
  if (r.source !== undefined) validRequest(typeof r.source === 'string' && r.source.length > 0 && r.source.length <= 4096 && !r.source.includes('\0'), 'source');
  for (const f of ['confirm','reopen'] as const) if (r[f] !== undefined) requireProgress(typeof r[f] === 'boolean');
  if (r.items !== undefined) {
    validRequest(Array.isArray(r.items) && r.items.length <= LIMITS.chunkItems, 'items');
    for (const i of r.items) {
      validRequest(i && Object.keys(i).every(k => ['id','title','kind','status','parentId','dependencies','blocker'].includes(k)) && identifier(i.id) && typeof i.title === 'string' && i.title.trim().length > 0 && i.title.length <= 512 && ['task','group'].includes(i.kind), 'items');
      if (i.status !== undefined) validRequest(['pending','working','blocked','done','skipped'].includes(i.status), 'items');
      if (i.parentId !== undefined) validRequest(identifier(i.parentId), 'items');
      if (i.dependencies !== undefined) validRequest(Array.isArray(i.dependencies) && i.dependencies.length <= 16 && i.dependencies.every(identifier), 'items');
      if (Object.hasOwn(i, 'blocker')) requireProgress(i.kind === 'task' && (i.blocker === null || validBlockerInput(i.blocker)) && (i.blocker === null || i.status === undefined || i.status === 'blocked'));
    }
  }
  if (r.changes !== undefined) requireProgress(Array.isArray(r.changes) && r.changes.length > 0 && r.changes.length <= 50 && r.changes.every(c => c && Object.keys(c).every(k => ['id','status','blocker'].includes(k)) && identifier(c.id) && ['pending','working','blocked','done','skipped'].includes(c.status) && (!Object.hasOwn(c,'blocker') || c.blocker === null || c.status === 'blocked' && validBlockerInput(c.blocker))));
  if (r.child !== undefined) requireProgress(identifier(r.child));
  if (r.attributed !== undefined) requireProgress(identifier(r.attributed));
  if (r.assign !== undefined) requireProgress(Array.isArray(r.assign) && r.assign.length <= LIMITS.planItems && r.assign.every(identifier));
  if (r.upload !== undefined) requireProgress(identifier(r.upload));
  if (r.chunk !== undefined) requireProgress(Number.isInteger(r.chunk) && r.chunk >= 0 && r.chunk < LIMITS.chunks);
  if (r.chunks !== undefined) requireProgress(Number.isInteger(r.chunks) && r.chunks > 0 && r.chunks <= LIMITS.chunks);
  if (r.outcome !== undefined) requireProgress(['finished','cancelled','failed'].includes(r.outcome));
  validRequest(r.op !== 'start' || (!!r.title && !!r.items), 'start');
  requireProgress(r.op !== 'change' || !!r.changes);
  requireProgress(r.op !== 'revise' || !!r.items || !!r.title);
  requireProgress(r.op !== 'stage' || (!!r.upload && r.chunk !== undefined && !!r.items));
  requireProgress(r.op !== 'commit' || (!!r.upload && !!r.chunks));
  requireProgress(r.op !== 'link' || (!!r.child && !!r.assign));
  requireProgress(r.op !== 'delegate' || (Array.isArray(r.assign) && r.assign.length <= 50 && new Set(r.assign).size === r.assign.length));
  requireProgress(r.op !== 'bind' || !!r.source);
  requireProgress(r.op !== 'finish' || !!r.outcome);
  return JSON.parse(JSON.stringify(r)) as Request;
}
export const BLOCKER_SCHEMA = { anyOf: [{ type: 'null' }, { type: 'object', additionalProperties: false, properties: { category: { type: 'string', enum: ['decision','dependency','review','external','other'] }, reason: { type: 'string', minLength: 1, maxLength: 512 }, nextAction: { type: 'string', minLength: 1, maxLength: 512 } } }], description: 'Blocked tasks only. Optional complete replacement: category, nonblank reason and nextAction (each at most 512 JS code units, no NUL). Null clears details, not status; omit to retain only verified-current details.' } as const;
export const REPORT_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['op'], properties: {
    op: { type: 'string', enum: ['start','read','change','revise','stage','commit','link','delegate','bind','finish','handoff'], description: 'Plan operations require plan; mutations require oid/rev. Handoff is plan-free: only op, oid, summary and outcome done/partial/blocked. Delegate persists next-dispatch intent, not assignment. Read accepts only op, plan and optional page.' },
    plan: { type: 'string', description: 'Plan operations only; omit for handoff. One stable identifier: 1-80 letters, digits, _, ., : or -, starting with a letter or digit. No wildcard/list syntax.' }, oid: { type: 'string', description: 'Required for every mutation; omit for read. Fresh identifier for each new mutation; reuse only to retry identical input.' }, rev: { type: 'integer', minimum: 0, description: 'Required for plan mutations; omit for read and handoff. New start uses 0. Read current revision before updating; use the returned rev.' },
    title: { type: 'string', description: 'Required for start: nonempty plan title, at most 256 characters.' }, items: { type: 'array', maxItems: 50, description: 'Required for start: complete structure with stable item IDs, titles and kinds. Large structures use stage/commit. Empty/all-skipped plans cannot finish successfully.', items: { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' }, kind: { enum: ['task','group'] }, status: { enum: ['pending','working','blocked','done','skipped'] }, parentId: { type: 'string' }, dependencies: { type: 'array', items: { type: 'string' } }, blocker: BLOCKER_SCHEMA }, required: ['id','title','kind'], additionalProperties: false } },
    changes: { type: 'array', maxItems: 50, items: { type: 'object', properties: { id: { type: 'string' }, status: { enum: ['pending','working','blocked','done','skipped'] }, blocker: BLOCKER_SCHEMA }, required: ['id','status'], additionalProperties: false } },
    child: { type: 'string' }, assign: { type: 'array', items: { type: 'string' } }, attributed: { type: 'string' }, source: { type: 'string' }, confirm: { type: 'boolean' }, outcome: { enum: ['finished','cancelled','failed','done','partial','blocked'] }, summary:{type:'string',minLength:1,maxLength:200,description:'Handoff only: one safe nonblank line; no NUL/newlines. Literal rendering is not secret redaction.'}, reopen: { type: 'boolean' }, upload: { type: 'string' }, chunk: { type: 'integer' }, chunks: { type: 'integer' }, page: { type: 'integer' },
  },
} as const;

/** Tool-only recovery text. Constant allowlist: never interpolate rejected input. */
const VALIDATION_HINTS = {
  request: 'Send one request object.',
  op: 'Use a supported op: start, read, change, revise, stage, commit, link, delegate, bind, finish or handoff.',
  plan: 'Use one concrete plan identifier (1-80 letters, digits, _, ., : or -, starting with a letter or digit); read does not accept wildcards.',
  fields: 'Remove unsupported fields for this op. Read accepts only op, plan and optional 0-based page; omit page for a compact summary without items, or set page for paged detail. Mutations also require oid and rev.',
  oid: 'Every mutation requires oid: a fresh identifier (1-80 letters, digits, _, ., : or -, starting with a letter or digit). Reuse only for an identical retry.',
  rev: 'Every mutation requires rev: a nonnegative safe integer. Use rev:0 for a new start; read the current revision before updating.',
  title: 'Use a nonempty title of at most 256 characters.',
  source: 'Optional source must be a nonempty path string of at most 4096 characters without NUL.',
  items: 'Items must be an array of at most 50 entries, each with id, nonempty title (at most 512 characters) and kind task or group; use valid statuses and identifiers.',
  start: 'Start requires title and items, plus oid and rev. Use rev:0 for a new plan and include the complete item structure.',
} as const;
function validRequest(value: unknown, hint: keyof typeof VALIDATION_HINTS): asserts value { if (!value) throw new ProgressError('invalid', undefined, VALIDATION_HINTS[hint]); }
