/** M1 steps 1–2: review-gated, in-memory algorithm; NO live resolver/runner. */
import { randomUUID } from 'node:crypto';
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Credential } from '@opencode/schema/credential';
import { Schema } from 'effect';

export const LIVE_REVIEW = Object.freeze({
  sourceSchema: false, destinationSchema: false, sourceReadNoRefresh: false,
  removalIsLocal: false, providerRefreshExcluded: false, requestCapsEnforced: false,
});
export type Review = {
  sourceSchema: boolean; destinationSchema: boolean; sourceReadNoRefresh: boolean;
  removalIsLocal: boolean; providerRefreshExcluded: boolean; requestCapsEnforced: boolean;
};
type Code = 'review-blocked' | 'identity' | 'root' | 'redirect' | 'http' | 'schema' | 'selection' |
  'expired' | 'refresh-unsafe' | 'unsupported-method' | 'interrupted' | 'deadline' | 'import-ambiguous' | 'cleanup';
export class SafetyError extends Error {
  readonly code: Code;
  constructor(code: Code) { super(code); this.code = code; this.name = 'SafetyError'; }
}
function requireThat(value: unknown, code: Code): asserts value { if (!value) throw new SafetyError(code); }
function reviewed(review: Review) { requireThat(Object.values(review).length === 6 && Object.values(review).every(x => x === true), 'review-blocked'); }

export function createDisposable() {
  const parent = '/tmp/opencode';
  requireThat(realpathSync(parent) === parent && !lstatSync(parent).isSymbolicLink(), 'root');
  const root = mkdtempSync(`${parent}/agent-progress-probe-auth-`);
  chmodSync(root, 0o700);
  const original = lstatSync(root); const nonce = randomUUID();
  writeFileSync(path.join(root, '.owner'), nonce, { mode: 0o600, flag: 'wx' });
  mkdirSync(path.join(root, 'data'), { mode: 0o700 });
  function owned() {
    const now = lstatSync(root);
    requireThat(!now.isSymbolicLink() && realpathSync(root) === root && now.dev === original.dev && now.ino === original.ino, 'root');
    const marker = path.join(root, '.owner');
    requireThat(!lstatSync(marker).isSymbolicLink() && readFileSync(marker, 'utf8') === nonce, 'root');
  }
  function validate() {
    owned();
    function walk(dir: string) {
      const stat = lstatSync(dir);
      requireThat(!stat.isSymbolicLink() && (stat.mode & 0o777) === (stat.isDirectory() ? 0o700 : 0o600), 'root');
      if (stat.isDirectory()) for (const entry of readdirSync(dir)) walk(path.join(dir, entry));
    }
    walk(root);
  }
  return { root, validate, dispose() { owned(); rmSync(root, { recursive: true }); } };
}
export type Disposable = ReturnType<typeof createDisposable>;
export interface Binding { endpoint: string; root: string; version: '2.1.3' | '2.1.4'; pid: number; expectedPid: number }
export type Transport = (url: string, init: RequestInit) => Promise<Response>;
function endpoint(value: string) {
  let url: URL; try { url = new URL(value); } catch { throw new SafetyError('identity'); }
  requireThat(url.protocol === 'http:' && url.hostname === '127.0.0.1' && url.port && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash, 'identity');
  return url.origin;
}
export function validatePair(source: Binding, destination: Binding, owned: Disposable) {
  owned.validate();
  const a = endpoint(source.endpoint); const b = endpoint(destination.endpoint);
  requireThat(a !== b && source.version === '2.1.3' && destination.version === '2.1.4' && source.pid > 0 && destination.pid > 0 && source.pid === source.expectedPid && destination.pid === destination.expectedPid && source.pid !== destination.pid, 'identity');
  requireThat(realpathSync(source.root) === source.root && realpathSync(destination.root) === destination.root && destination.root === owned.root && source.root !== destination.root && !source.root.startsWith(`${destination.root}/`) && !destination.root.startsWith(`${source.root}/`), 'root');
  return { a, b };
}
/** Transport has no default and no auth/environment discovery. Tests inject fake endpoints. */
export function clients(source: Binding, destination: Binding, owned: Disposable, transport: Transport) {
  const { a, b } = validatePair(source, destination, owned);
  async function request(base: string, route: string, method: string, body?: unknown) {
    try {
      const response = await transport(`${base}${route}`, { method, redirect: 'error', signal: AbortSignal.timeout(5000), headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      requireThat(!response.redirected && response.status < 300 && (!response.url || new URL(response.url).origin === base), response.status >= 300 && response.status < 400 || response.redirected ? 'redirect' : 'http');
      requireThat(response.ok, 'http');
      if (response.status === 204) return undefined;
      return await response.json() as unknown;
    } catch (error) { throw error instanceof SafetyError ? error : new SafetyError('http'); }
  }
  function entry(value: unknown): Credential.Entry {
    try { return Schema.decodeUnknownSync(Credential.Entry)(value); } catch { throw new SafetyError('schema'); }
  }
  async function list(base: string) {
    const value = await request(base, '/api/credential', 'GET');
    requireThat(value !== null && typeof value === 'object' && 'data' in value && Array.isArray(value.data), 'schema');
    return value.data.map(entry);
  }
  return {
    source: Object.freeze({ list: () => list(a) }),
    destination: Object.freeze({
      list: () => list(b),
      async create(value: Credential.CreateInput) {
        const answer = await request(b, '/api/credential', 'POST', value);
        requireThat(answer !== null && typeof answer === 'object' && 'data' in answer, 'schema');
        return entry(answer.data);
      },
      async remove(id: string) { requireThat(/^cred_[A-Za-z0-9_-]+$/.test(id), 'identity'); await request(b, `/api/credential/${encodeURIComponent(id)}`, 'DELETE'); },
    }),
  };
}
/** Exercise transfer/cleanup mechanics with SYNTHETIC review facts only.
 * Current LIVE_REVIEW refuses BEFORE any credential-list request. OAuth is always
 * refused: no invented refresh/expiry and no access-as-key conversion.
 */
export async function withTransferredKey(input: {
  review: Review; source: Binding; destination: Binding; owned: Disposable; transport: Transport;
  deadline: number; signal?: AbortSignal; now?: () => number;
  useSynthetic: () => Promise<void>; stopOwned: () => Promise<void>;
}) {
  let createdId: string | undefined; let sourceId: string | undefined;
  let destination: ReturnType<typeof clients>['destination'] | undefined;
  let failure: Code | undefined; let cleanupFailed = false; let imported = false;
  const now = input.now ?? Date.now;
  function boundary() { requireThat(!input.signal?.aborted, 'interrupted'); requireThat(now() < input.deadline, 'deadline'); }
  try {
    reviewed(input.review); boundary();
    const api = clients(input.source, input.destination, input.owned, input.transport); destination = api.destination;
    // Empty, fresh destination only; no existing-account activation or takeover.
    requireThat((await destination.list()).length === 0, 'identity'); boundary();
    const entries = await api.source.list();
    const matches = entries.filter(x => x.integrationID === 'openai' && x.active);
    requireThat(matches.length === 1, 'selection'); const selected = matches[0]; sourceId = selected.id;
    if (selected.value.type === 'oauth') {
      requireThat(selected.value.expires > now(), 'expired');
      throw new SafetyError('refresh-unsafe');
    }
    requireThat(selected.value.type === 'key' && selected.value.key.length > 0, 'unsupported-method');
    const label = `m1-synthetic-${randomUUID()}`;
    const value = { type: 'key' as const, key: selected.value.key }; // Never source label/metadata.
    boundary();
    try {
      const created = await destination.create({ integrationID: selected.integrationID, label, value, activate: true } as Credential.CreateInput);
      requireThat(created.id !== sourceId && created.integrationID === selected.integrationID && created.label === label && created.active && created.value.type === 'key' && created.value.key === value.key, 'import-ambiguous');
      createdId = created.id;
    } catch {
      // A lost reply may follow a committed create. Destination-only reconcile;
      // one create attempt, no blind retry, never remove the source ID.
      const candidates = (await destination.list()).filter(x => x.id !== sourceId && x.integrationID === selected.integrationID && x.label === label && x.value.type === 'key' && x.value.key === value.key);
      if (candidates.length === 1) createdId = candidates[0].id;
      throw new SafetyError('import-ambiguous');
    }
    imported = true; boundary(); await input.useSynthetic(); boundary();
  } catch (error) { failure = error instanceof SafetyError ? error.code : 'interrupted'; }
  finally {
    if (createdId && createdId !== sourceId && destination) {
      try { await destination.remove(createdId); } catch { cleanupFailed = true; }
    }
    try { await input.stopOwned(); } catch { cleanupFailed = true; }
    try { input.owned.dispose(); } catch { cleanupFailed = true; }
  }
  return { imported, failure: cleanupFailed ? 'cleanup' : failure, cleanupFailed };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // Deliberately no --live implementation, source auth lookup or credential read.
  console.log(JSON.stringify({ mode: 'M1-review-only', liveTransferEnabled: false,
    blockers: ['parent-clearance', 'actual-schema-attestation', 'source-read-refresh-semantics', 'oauth-refresh-exclusion', 'local-remove-semantics', 'provider-request-caps'] }));
  if (process.argv[2] !== '--preflight') process.exitCode = 2;
}
