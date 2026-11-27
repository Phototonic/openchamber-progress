import { identifier, requireProgress as need, type Envelope } from './progress.ts';

export const PLAN_USER_CANCEL = 1;
export const PLAN_USER_CANCEL_PATH = '/v1/plan/cancel';
export const PLAN_USER_CANCEL_MAX_BYTES = 16_384;
export const USER_CANCEL_ACTOR = { kind: 'user', action: 'cancel' } as const;

export interface UserCancelRequest {
  storeId: string;
  binding: Envelope['sourceBinding'];
  source: string;
  plan: string;
  rev: number;
  cleanupRev: number;
  oid: string;
  confirmed: true;
}

export interface UserCancelReceipt {
  storeId: string;
  sourceBinding: Envelope['sourceBinding'];
  source: string;
  plan: string;
  oid: string;
  rev: number;
  structuralRev: number;
  lifecycle: 'cancelled';
  actor: 'user';
  reportedAt: string;
}

const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const integer = (v: unknown, min: number): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= min;

export function parseUserCancel(v: unknown): UserCancelRequest {
  need(record(v) && Object.keys(v).length === 8);
  const { storeId, binding, source, plan, rev, cleanupRev, oid, confirmed } = v;
  need(identifier(storeId) && identifier(source) && identifier(plan) && identifier(oid));
  need(integer(rev, 1) && integer(cleanupRev, 0) && confirmed === true);
  need(record(binding) && Object.keys(binding).length === 2);
  const { sourceId, verified } = binding;
  need((sourceId === null || identifier(sourceId)) && typeof verified === 'boolean');
  return { storeId, binding: { sourceId, verified }, source, plan, rev, cleanupRev, oid, confirmed };
}

/** History projects only this discriminator, never stored actor JSON. */
export interface HistoryAttribution { actor?: 'user' }
