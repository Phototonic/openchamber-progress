/** Frozen production v2 DTO. Probe v1 types are historical fixtures only. */
export const VERSION = 2 as const;
export const LIMITS = { requestBytes: 16_384, documentBytes: 262_144, pageSize: 20, maxPageSize: 50, chunkItems: 50, chunks: 32, planItems: 1000, responseBytes: 1_048_576 } as const;
export type Status = 'pending' | 'working' | 'blocked' | 'done' | 'skipped';
export type Lifecycle = 'active' | 'finished' | 'cancelled' | 'failed';
export type Code = 'invalid' | 'not-found' | 'conflict' | 'operation-reused' | 'assignment' | 'source-unverified' | 'closed' | 'unfinished' | 'disabled' | 'busy' | 'storage' | 'corrupt' | 'schema' | 'binding' | 'stage-incomplete';
export class ProgressError extends Error {
  readonly code: Code; readonly revision?: number;
  constructor(code: Code, revision?: number) { super(code); this.code = code; this.revision = revision; }
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
export interface PlanRead { plan: PlanSummary; items: Page<Item>; contributions: Page<Contribution>; links: PlanState['links'] }
export interface DocumentRead { document: DocumentRef; text: string | null; nextCursor: string | null }
export interface Suggestion { value: string; state: 'resolved' | 'candidate' }
export interface SetupSuggestions { configRoot: Suggestion | null; dataRoot: Suggestion | null; storeRoot: Suggestion | null }
export interface SetupRead {
  configured: boolean; verified: boolean; installed: boolean; captureEnabled: boolean | null;
  targets: { configRoot: string; dataRoot: string; storeRoot: string } | null;
  activation: string; separateLifecycle: true; historyRetained: true; diagnostics: string[];
  version: string | null;
  recovery?: { stagedPackages: number; stagedActivations: number; stagedReleases: number };
  action?: string;
  suggestions?: SetupSuggestions;
}
export interface Receipt { plan: string; rev: number; structuralRev: number; changed?: string[]; staged?: number }
export type Reply = Receipt | { error: Code; rev?: number };
export interface Request {
  op: 'start' | 'read' | 'change' | 'revise' | 'stage' | 'commit' | 'link' | 'bind' | 'finish';
  plan: string; oid?: string; rev?: number; title?: string; items?: ItemInput[];
  changes?: { id: string; status: Status }[]; child?: string; assign?: string[]; attributed?: string;
  source?: string; confirm?: boolean; outcome?: 'finished' | 'cancelled' | 'failed'; reopen?: boolean;
  upload?: string; chunk?: number; chunks?: number; page?: number;
}
export function identifier(value: unknown): value is string { return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/.test(value); }
export function parseRequest(value: unknown): Request {
  requireProgress(value && typeof value === 'object' && !Array.isArray(value));
  const r = value as Request;
  const fields: Record<Request['op'], string[]> = {
    start: ['title','items','source'], read: ['page'], change: ['changes','attributed'], revise: ['title','items','reopen'],
    stage: ['upload','chunk','items','reopen'], commit: ['upload','chunks','title','reopen'], link: ['child','assign'], bind: ['source','confirm'], finish: ['outcome'],
  };
  requireProgress(Object.hasOwn(fields, r.op) && identifier(r.plan));
  const allowed = ['op','plan', ...(r.op === 'read' ? [] : ['oid','rev']), ...fields[r.op]];
  requireProgress(Object.keys(r).every(k => allowed.includes(k)) && Buffer.byteLength(JSON.stringify(r)) <= LIMITS.requestBytes);
  if (r.op !== 'read') requireProgress(identifier(r.oid) && Number.isSafeInteger(r.rev) && r.rev! >= 0);
  if (r.page !== undefined) requireProgress(Number.isSafeInteger(r.page) && r.page >= 0);
  if (r.title !== undefined) requireProgress(typeof r.title === 'string' && r.title.trim().length > 0 && r.title.length <= 256);
  if (r.source !== undefined) requireProgress(typeof r.source === 'string' && r.source.length > 0 && r.source.length <= 4096 && !r.source.includes('\0'));
  for (const f of ['confirm','reopen'] as const) if (r[f] !== undefined) requireProgress(typeof r[f] === 'boolean');
  if (r.items !== undefined) {
    requireProgress(Array.isArray(r.items) && r.items.length <= LIMITS.chunkItems);
    for (const i of r.items) {
      requireProgress(i && Object.keys(i).every(k => ['id','title','kind','status','parentId','dependencies'].includes(k)) && identifier(i.id) && typeof i.title === 'string' && i.title.trim().length > 0 && i.title.length <= 512 && ['task','group'].includes(i.kind));
      if (i.status !== undefined) requireProgress(['pending','working','blocked','done','skipped'].includes(i.status));
      if (i.parentId !== undefined) requireProgress(identifier(i.parentId));
      if (i.dependencies !== undefined) requireProgress(Array.isArray(i.dependencies) && i.dependencies.length <= 16 && i.dependencies.every(identifier));
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
  requireProgress(r.op !== 'start' || (!!r.title && !!r.items));
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
    op: { type: 'string', enum: ['start','read','change','revise','stage','commit','link','bind','finish'] },
    plan: { type: 'string' }, oid: { type: 'string', description: 'Unique mutation ID; reuse only to retry identical input.' }, rev: { type: 'integer', minimum: 0 },
    title: { type: 'string' }, items: { type: 'array', maxItems: 50, items: { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' }, kind: { enum: ['task','group'] }, status: { enum: ['pending','working','blocked','done','skipped'] }, parentId: { type: 'string' }, dependencies: { type: 'array', items: { type: 'string' } } }, required: ['id','title','kind'], additionalProperties: false } },
    changes: { type: 'array', maxItems: 50, items: { type: 'object', properties: { id: { type: 'string' }, status: { enum: ['pending','working','blocked','done','skipped'] } }, required: ['id','status'], additionalProperties: false } },
    child: { type: 'string' }, assign: { type: 'array', items: { type: 'string' } }, attributed: { type: 'string' }, source: { type: 'string' }, confirm: { type: 'boolean' }, outcome: { enum: ['finished','cancelled','failed'] }, reopen: { type: 'boolean' }, upload: { type: 'string' }, chunk: { type: 'integer' }, chunks: { type: 'integer' }, page: { type: 'integer' },
  },
} as const;
