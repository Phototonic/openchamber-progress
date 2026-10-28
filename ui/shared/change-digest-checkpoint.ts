// Device-scoped "reviewed through revision N" markers for full-page History (docs/ui.md,
// Change digests). Only SDK `{scope:'device'}` storage, and only after the host advertises it:
// never instance storage or another fallback. The SDK has no compare-and-set, so every
// acknowledgement is its own immutable, revision-addressed key; readers take the highest valid one
// and a successful writer compacts only lower revisions of exactly its own context. Values hold the
// version, identity and revision alone: no titles, digest text, paths or report bodies.

export interface DeviceStorage {
  get(key: string, options: { scope: 'device' }): Promise<unknown>;
  set(key: string, value: never, options: { scope: 'device' }): Promise<void>;
  delete(key: string, options: { scope: 'device' }): Promise<void>;
  keys(options: { scope: 'device' }): Promise<string[]>;
}

/**
 * Persistent viewer context of one plan baseline (owner Q4: shared within the local profile and
 * host account, across sessions, board filters, surfaces and frames). Frame/request/reading
 * generations are ephemeral guards and never part of it.
 */
export interface CheckpointIdentity {
  /** Host account; an empty or missing account uses an explicit absent sentinel (null). */
  account: string | null;
  storeId: string;
  binding: { sourceId: string | null; verified: boolean };
  source: string;
  plan: string;
}

export type CheckpointFailure = 'unsupported' | 'denied' | 'quota' | 'malformed' | 'failed' | 'disagreement';
export type CheckpointRead = { state: 'saved'; revision: number } | { state: 'absent' } | { state: 'unavailable'; reason: CheckpointFailure };
export type CheckpointWrite = { ok: true } | { ok: false; reason: CheckpointFailure };

export const CHECKPOINT_VERSION = 1;
const PREFIX = 'rv1.';
const DEVICE = { scope: 'device' } as const;
/** SDK namespace bound: a longer key list is not a reply this reader trusts. */
const KEYS_MAX = 2000;
const KEY = /^rv1\.([0-9a-f]{64})\.([1-9][0-9]{0,15})$/;

/** Canonical, versioned tuple. JSON null is the absent-account sentinel, distinct from any string. */
export function canonicalIdentity(id: CheckpointIdentity) {
  return JSON.stringify(['agent-progress.review', CHECKPOINT_VERSION, id.account || null, id.storeId, id.binding.sourceId, id.binding.verified, id.source, id.plan]);
}

export const contextHash = (id: CheckpointIdentity) => sha256Hex(canonicalIdentity(id));
/** `rv1.<sha256 of the canonical tuple>.<revision>`: at most 86 characters (SDK limit 128). */
export const checkpointKey = (id: CheckpointIdentity, revision: number) => `${PREFIX}${contextHash(id)}.${revision}`;

function parseKey(key: unknown): { hash: string; revision: number } | null {
  if (typeof key !== 'string') return null;
  const m = KEY.exec(key);
  const revision = m ? Number(m[2]) : NaN;
  return m && Number.isSafeInteger(revision) ? { hash: m[1], revision } : null;
}

/** The whole stored value. Its identity is checked in full, so a hash collision cannot cross contexts. */
export const checkpointValue = (id: CheckpointIdentity, revision: number) => ({ v: CHECKPOINT_VERSION, id: canonicalIdentity(id), revision });
function validValue(value: unknown, id: CheckpointIdentity, revision: number) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return Object.keys(v).length === 3 && v.v === CHECKPOINT_VERSION && v.id === canonicalIdentity(id) && v.revision === revision;
}

function failureOf(error: unknown): CheckpointFailure {
  const code = typeof error === 'object' && error !== null && typeof (error as { code?: unknown }).code === 'string' ? (error as { code: string }).code : '';
  const message = error instanceof Error ? error.message : '';
  if (code === 'UNSUPPORTED') return 'unsupported';
  if (code === 'DENIED' || code === 'NOT_GRANTED') return 'denied';
  if (/quota|limit|exceed|full/i.test(message) || code === 'QUOTA') return 'quota';
  return 'failed';
}

export class CheckpointStore {
  private readonly storage: DeviceStorage;
  private readonly supported: () => boolean;
  /** `supported`: the host advertised `features.deviceStorage === true` in its latest ready context. */
  constructor(storage: DeviceStorage, supported: () => boolean) { this.storage = storage; this.supported = supported; }

  private async ownKeys(hash: string): Promise<{ key: string; revision: number }[] | CheckpointFailure> {
    let keys: unknown;
    try { keys = await this.storage.keys(DEVICE); } catch (error) { return failureOf(error); }
    if (!Array.isArray(keys) || keys.length > KEYS_MAX) return 'failed';
    const own: { key: string; revision: number }[] = [];
    for (const key of keys) { const k = parseKey(key); if (k && k.hash === hash) own.push({ key: key as string, revision: k.revision }); }
    return own.sort((a, b) => b.revision - a.revision);
  }

  /**
   * Highest valid acknowledgement of exactly this context. A confirmed absence is `absent` (an
   * initial view); every failure, a malformed highest record or persistent disagreement is
   * `unavailable`, never absent. A highest key that vanished between `keys` and `get` (concurrent
   * deletion) permits one bounded reread.
   */
  async read(id: CheckpointIdentity): Promise<CheckpointRead> {
    if (!this.supported()) return { state: 'unavailable', reason: 'unsupported' };
    const hash = contextHash(id);
    for (let attempt = 0; attempt < 2; attempt++) {
      const own = await this.ownKeys(hash);
      if (typeof own === 'string') return { state: 'unavailable', reason: own };
      if (!own.length) return { state: 'absent' };
      let value: unknown;
      try { value = await this.storage.get(own[0].key, DEVICE); } catch (error) { return { state: 'unavailable', reason: failureOf(error) }; }
      if (value === undefined) continue;
      return validValue(value, id, own[0].revision) ? { state: 'saved', revision: own[0].revision } : { state: 'unavailable', reason: 'malformed' };
    }
    return { state: 'unavailable', reason: 'disagreement' };
  }

  /**
   * Records `revision` under its own key (same identity and revision → the same value, so
   * concurrent writers are idempotent), then deletes only lower revisions of this exact context.
   * Compaction is best effort: a crash leaves redundant lower markers, never a falsely newer one.
   */
  async write(id: CheckpointIdentity, revision: number): Promise<CheckpointWrite> {
    if (!this.supported()) return { ok: false, reason: 'unsupported' };
    if (!Number.isSafeInteger(revision) || revision < 1) return { ok: false, reason: 'failed' };
    try { await this.storage.set(checkpointKey(id, revision), checkpointValue(id, revision) as never, DEVICE); } catch (error) { return { ok: false, reason: failureOf(error) }; }
    const own = await this.ownKeys(contextHash(id));
    if (typeof own !== 'string') for (const k of own) if (k.revision < revision) await this.storage.delete(k.key, DEVICE).catch(() => {});
    return { ok: true };
  }

  /** Authoritative deletion: best-effort removal of this context's markers only. Not secure erasure. */
  async forget(id: CheckpointIdentity) {
    if (!this.supported()) return;
    const own = await this.ownKeys(contextHash(id));
    if (typeof own !== 'string') for (const k of own) await this.storage.delete(k.key, DEVICE).catch(() => {});
  }
}

// Synchronous SHA-256 (FIPS 180-4) over UTF-8: crypto.subtle is unavailable in some guest frames.
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
export function sha256Hex(text: string) {
  const data = new TextEncoder().encode(text);
  const blocks = Math.ceil((data.length + 9) / 64);
  const bytes = new Uint8Array(blocks * 64);
  bytes.set(data); bytes[data.length] = 0x80;
  const view = new DataView(bytes.buffer);
  view.setUint32(bytes.length - 8, Math.floor(data.length / 0x20000000)); view.setUint32(bytes.length - 4, (data.length << 3) >>> 0);
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let b = 0; b < blocks; b++) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(b * 64 + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3), s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, bb, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & bb) ^ (a & c) ^ (bb & c))) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = bb; bb = a; a = (t1 + t2) >>> 0;
    }
    h[0] += a; h[1] += bb; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
  }
  return [...h].map((x) => x.toString(16).padStart(8, '0')).join('');
}
