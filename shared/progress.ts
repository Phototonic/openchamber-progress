/** Frozen production v2 DTO. Probe v1 types are historical fixtures only. */
export const VERSION = 2 as const;
export const LIMITS = { requestBytes: 16_384, documentBytes: 262_144, pageSize: 20, maxPageSize: 50, chunkItems: 50, chunks: 32, planItems: 1000, responseBytes: 1_048_576 } as const;
export type Status = 'pending' | 'working' | 'blocked' | 'done' | 'skipped';
export type Lifecycle = 'active' | 'finished' | 'cancelled' | 'failed';
export type Code = 'invalid' | 'not-found' | 'conflict' | 'operation-reused' | 'assignment' | 'source-unverified' | 'closed' | 'unfinished' | 'disabled' | 'busy' | 'storage' | 'corrupt' | 'schema' | 'binding' | 'stage-incomplete';
export type ValidationHint = typeof VALIDATION_HINTS[keyof typeof VALIDATION_HINTS];
export class ProgressError extends Error {
  readonly code: Code; readonly revision?: number; readonly hint?: ValidationHint;
  constructor(code: Code, revision?: number, hint?: ValidationHint) { super(code); this.code = code; this.revision = revision; if(code === 'invalid') this.hint = hint; }
}
export function requireProgress(value: unknown, code: Code = 'invalid', revision?: number): asserts value { if (!value) throw new ProgressError(code, revision); }
export interface Item { id: string; title: string; kind: 'task' | 'group'; status: Status; parentId?: string; dependencies?: string[]; assigneeSessionId?: string; reporterSessionId?: string }
export type ItemInput = Omit<Item, 'status' | 'assigneeSessionId' | 'reporterSessionId'> & { status?: Status };
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
export interface PlanSummary { id: string; sourceId: string; title: string; sessionId: string; revision: number; structuralRevision: number; lifecycle: Lifecycle; reportedAt: string; directory: string; projectId?: string; counts: Counts; working: string[]; document: DocumentRef }
export interface PlanState extends Omit<PlanSummary, 'counts' | 'working'> { items: Item[]; links: { sessionId: string; itemIds: string[] }[] }
export interface Envelope { protocolVersion: 2; schemaVersion: 2; storeId: string; sources: Source[]; sourceBinding: { sourceId: string | null; verified: boolean }; captureEnabled: boolean; coverage: 'recorded-only'; diagnostics: string[] }
export interface Page<T> { data: T[]; nextCursor: string | null }
/** Response-only reported-working history; absent item entries mean no proven interval. */
export interface PlanTiming { readAt: string; items: Record<string, { since: string; kind: 'exact' | 'lower-bound' }> }
export interface PlanRead { plan: PlanSummary; items: Page<Item>; contributions: Page<Contribution>; links: PlanState['links']; timing?: PlanTiming }
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
  op: 'start' | 'read' | 'change' | 'revise' | 'stage' | 'commit' | 'link' | 'bind' | 'finish';
  plan: string; oid?: string; rev?: number; title?: string; items?: ItemInput[];
  changes?: { id: string; status: Status }[]; child?: string; assign?: string[]; attributed?: string;
  source?: string; confirm?: boolean; outcome?: 'finished' | 'cancelled' | 'failed'; reopen?: boolean;
  upload?: string; chunk?: number; chunks?: number; page?: number;
}
export function identifier(value: unknown): value is string { return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/.test(value); }
export function parseRequest(value: unknown): Request {
  validRequest(value && typeof value === 'object' && !Array.isArray(value), 'request');
  const r = value as Request;
  const fields: Record<Request['op'], string[]> = {
    start: ['title','items','source'], read: ['page'], change: ['changes','attributed'], revise: ['title','items','reopen'],
    stage: ['upload','chunk','items','reopen'], commit: ['upload','chunks','title','reopen'], link: ['child','assign'], bind: ['source','confirm'], finish: ['outcome'],
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
      validRequest(i && Object.keys(i).every(k => ['id','title','kind','status','parentId','dependencies'].includes(k)) && identifier(i.id) && typeof i.title === 'string' && i.title.trim().length > 0 && i.title.length <= 512 && ['task','group'].includes(i.kind), 'items');
      if (i.status !== undefined) validRequest(['pending','working','blocked','done','skipped'].includes(i.status), 'items');
      if (i.parentId !== undefined) validRequest(identifier(i.parentId), 'items');
      if (i.dependencies !== undefined) validRequest(Array.isArray(i.dependencies) && i.dependencies.length <= 16 && i.dependencies.every(identifier), 'items');
    }
  }
  if (r.changes !== undefined) requireProgress(Array.isArray(r.changes) && r.changes.length > 0 && r.changes.length <= 50 && r.changes.every(c => c && Object.keys(c).every(k => ['id','status'].includes(k)) && identifier(c.id) && ['pending','working','blocked','done','skipped'].includes(c.status)));
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
  requireProgress(r.op !== 'bind' || !!r.source);
  requireProgress(r.op !== 'finish' || !!r.outcome);
  return JSON.parse(JSON.stringify(r)) as Request;
}
export const REPORT_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['op','plan'], properties: {
    op: { type: 'string', enum: ['start','read','change','revise','stage','commit','link','bind','finish'], description: 'New start requires plan, title, items, oid and rev:0. Every mutation requires oid and expected rev. Read accepts only op, concrete plan and optional page.' },
    plan: { type: 'string', description: 'One concrete stable plan identifier: 1-80 letters, digits, _, ., : or -, starting with a letter or digit. No wildcard/list syntax.' }, oid: { type: 'string', description: 'Required for every mutation; omit for read. Fresh identifier for each new mutation; reuse only to retry identical input.' }, rev: { type: 'integer', minimum: 0, description: 'Required for every mutation; omit for read. New start uses 0. Read current revision before updating; use the returned rev.' },
    title: { type: 'string', description: 'Required for start: nonempty plan title, at most 256 characters.' }, items: { type: 'array', maxItems: 50, description: 'Required for start: complete structure with stable item IDs, titles and kinds. Large structures use stage/commit. Empty/all-skipped plans cannot finish successfully.', items: { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' }, kind: { enum: ['task','group'] }, status: { enum: ['pending','working','blocked','done','skipped'] }, parentId: { type: 'string' }, dependencies: { type: 'array', items: { type: 'string' } } }, required: ['id','title','kind'], additionalProperties: false } },
    changes: { type: 'array', maxItems: 50, items: { type: 'object', properties: { id: { type: 'string' }, status: { enum: ['pending','working','blocked','done','skipped'] } }, required: ['id','status'], additionalProperties: false } },
    child: { type: 'string' }, assign: { type: 'array', items: { type: 'string' } }, attributed: { type: 'string' }, source: { type: 'string' }, confirm: { type: 'boolean' }, outcome: { enum: ['finished','cancelled','failed'] }, reopen: { type: 'boolean' }, upload: { type: 'string' }, chunk: { type: 'integer' }, chunks: { type: 'integer' }, page: { type: 'integer' },
  },
} as const;

/** Tool-only recovery text. Constant allowlist: never interpolate rejected input. */
const VALIDATION_HINTS = {
  request: 'Send one request object.',
  op: 'Use a supported op: start, read, change, revise, stage, commit, link, bind or finish.',
  plan: 'Use one concrete plan identifier (1-80 letters, digits, _, ., : or -, starting with a letter or digit); read does not accept wildcards.',
  fields: 'Remove unsupported fields for this op. Read accepts only op, plan and optional page; mutations also require oid and rev.',
  oid: 'Every mutation requires oid: a fresh identifier (1-80 letters, digits, _, ., : or -, starting with a letter or digit). Reuse only for an identical retry.',
  rev: 'Every mutation requires rev: a nonnegative safe integer. Use rev:0 for a new start; read the current revision before updating.',
  title: 'Use a nonempty title of at most 256 characters.',
  source: 'Optional source must be a nonempty path string of at most 4096 characters without NUL.',
  items: 'Items must be an array of at most 50 entries, each with id, nonempty title (at most 512 characters) and kind task or group; use valid statuses and identifiers.',
  start: 'Start requires title and items, plus oid and rev. Use rev:0 for a new plan and include the complete item structure.',
} as const;
function validRequest(value: unknown, hint: keyof typeof VALIDATION_HINTS): asserts value { if (!value) throw new ProgressError('invalid', undefined, VALIDATION_HINTS[hint]); }
