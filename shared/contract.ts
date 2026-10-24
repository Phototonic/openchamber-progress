/** Compatibility protocol only; not a production progress API. */
export const PROTOCOL_VERSION = 1;
export const LIMITS = { requestBytes: 16_384, documentBytes: 262_144, pageSize: 20 } as const;
export type ItemStatus = 'pending' | 'working' | 'blocked' | 'done' | 'skipped';
export interface ProbeItem {
  id: string;
  title: string;
  status: ItemStatus;
  kind: 'group' | 'task';
  parentId?: string;
  assigneeSessionId?: string;
}
export interface ProbePlan {
  id: string;
  title: string;
  sessionId: string;
  project: 'Alpha' | 'Beta';
  directory: string;
  revision: number;
  reportedAt: string;
  lifecycle: 'active';
  items: ProbeItem[];
  contributions: { reporterSessionId: string; attributedSessionId: string; mode: 'parent-relay'; itemId: string }[];
  document: { state: 'captured-fixture'; text: string; capturedAt: string; currentFile: 'not-rechecked' };
}
export interface ProbeRead {
  protocolVersion: 1;
  schemaVersion: 1;
  storeId: string;
  sourceId: string;
  sourceBinding: 'unverified-explicit-probe';
  coverage: 'fixture-only';
  plans: ProbePlan[];
  nextCursor: null;
  diagnostics: string[];
}
export function counts(items: ProbeItem[]) {
  const tasks = items.filter(x => x.kind === 'task');
  const skipped = tasks.filter(x => x.status === 'skipped').length;
  const done = tasks.filter(x => x.status === 'done').length;
  return { done, total: tasks.length - skipped, remaining: tasks.length - skipped - done, skipped };
}
export const REPORT_INPUT = {
  type: 'object',
  properties: {
    operation: { type: 'string', enum: ['inspect', 'report'] },
    operationId: { type: 'string', maxLength: 80 },
    expectedRevision: { type: 'integer', minimum: 0 },
  },
  required: ['operation'], additionalProperties: false,
} as const;
