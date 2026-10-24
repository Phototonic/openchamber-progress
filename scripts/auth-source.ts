/** Read-only managed-source capability. Importing this module performs no IO. */
import { readFileSync, readdirSync, readlinkSync, realpathSync, lstatSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { Credential } from '@opencode/schema/credential';
import { Schema } from 'effect';

export class LiveSafetyError extends Error {
  readonly code: 'source-identity' | 'source-schema' | 'source-http' | 'selection' | 'method-cap-incompatible' | 'metadata' | 'expiry' | 'deadline' | 'cancelled' | 'destination' | 'import-ambiguous' | 'action' | 'cleanup' | 'ledger';
  constructor(code: LiveSafetyError['code']) { super(code); this.code = code; }
}
export function insist(value: unknown, code: ConstructorParameters<typeof LiveSafetyError>[0]): asserts value { if (!value) throw new LiveSafetyError(code); }
export type Wire = (url: string, init: RequestInit) => Promise<Response>;
export interface Source {
  readonly endpoint: string; readonly pid: number; readonly root: string;
  info(): Promise<unknown>; schema(): Promise<unknown>; list(): Promise<Credential.Entry[]>;
  models(): Promise<{ providerID: string; id: string; capabilities: { tools: boolean } }[]>;
}
/** GET-only closure: no generic route, caller headers, redirects or mutation API. */
export function sourceClient(identity: { endpoint: string; pid: number; root: string }, password: string, wire: Wire, signal: AbortSignal): Source {
  const url = new URL(identity.endpoint);
  insist(url.protocol === 'http:' && url.hostname === '127.0.0.1' && url.port && url.pathname === '/' && !url.search && !url.hash && !url.username && !url.password && password, 'source-identity');
  const base = url.origin;
  async function get(route: '/api/info' | '/openapi.json' | '/api/credential' | '/api/model'): Promise<any> {
    try {
      const r = await wire(`${base}${route}`, { method: 'GET', redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]), headers: { authorization: `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}` } });
      insist(r.ok && !r.redirected && (!r.url || r.url === `${base}${route}`), 'source-http');
      return await r.json();
    } catch { throw new LiveSafetyError('source-http'); }
  }
  return Object.freeze({ ...identity, endpoint: base, info: () => get('/api/info'), schema: () => get('/openapi.json'), async models() {
    const body = await get('/api/model'); insist(Array.isArray(body?.data), 'source-schema');
    return body.data.filter((m: any) => m.providerID === 'zai-coding-plan' && typeof m.id === 'string').map((m: any) => ({ providerID: m.providerID as string, id: m.id as string, capabilities: { tools: m.capabilities?.tools === true } }));
  }, async list() {
    try {
      const body = await get('/api/credential'); insist(Array.isArray(body?.data), 'source-schema');
      return body.data.map((v: unknown) => Schema.decodeUnknownSync(Credential.Entry)(v));
    } catch (e) { throw e instanceof LiveSafetyError ? e : new LiveSafetyError('source-schema'); }
  } });
}

/** Static precedent: managed launcher lines77–110. NEVER starts a process.
 * Stronger than launcher: exact version, real parent, unique open DB inode,
 * no runtime DB/path override, canonical private registration and no aliases.
 * Call ONLY after parent clears source process metadata/auth access.
 */
export async function resolveManagedSource(signal: AbortSignal): Promise<Source> {
  try {
    const directory = path.join(homedir(), '.config/openchamber/managed-opencode');
    insist(realpathSync(directory) === directory, 'source-identity');
    const candidates: { pid: number; ownerPid: number; port: number }[] = [];
    for (const name of readdirSync(directory).filter(n => n.endsWith('.json'))) {
      const file = path.join(directory, name); const st = lstatSync(file);
      insist(st.isFile() && !st.isSymbolicLink() && st.uid === process.getuid?.(), 'source-identity');
      const r = JSON.parse(readFileSync(file, 'utf8'));
      insist(['pid', 'ownerPid', 'port'].every(k => Number.isSafeInteger(r[k]) && r[k] > 0) && r.port <= 65535, 'source-identity');
      candidates.push(r);
    }
    // Do not probe multiple credential contexts to guess which one is intended.
    insist(candidates.length === 1, 'source-identity');
    const { pid, ownerPid, port } = candidates[0];
    const exe = realpathSync(`/proc/${pid}/exe`);
    insist(exe.endsWith('/resources/opencode-cli/opencode') && realpathSync(exe) === exe, 'source-identity');
    const ownerExe = realpathSync(`/proc/${ownerPid}/exe`);
    insist(ownerExe === path.join(exe.slice(0, -'/resources/opencode-cli/opencode'.length), 'openchamber'), 'source-identity');
    const status = readFileSync(`/proc/${pid}/status`, 'utf8');
    insist(Number(status.match(/^PPid:\s+(\d+)/m)?.[1]) === ownerPid && Number(status.match(/^Uid:\s+(\d+)/m)?.[1]) === process.getuid?.(), 'source-identity');
    const env = Object.fromEntries(readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0').filter(s => s.includes('=')).map(s => [s.slice(0, s.indexOf('=')), s.slice(s.indexOf('=') + 1)]));
    insist(!env.OPENCODE_DB && !env.OPENCODE_CONFIG_CONTENT && !env.OPENCODE_CONFIG_DIR, 'source-identity');
    // Config is never copied. Reject configured provider origins/auth overlays.
    if (env.OPENCODE_CONFIG) {
      insist(realpathSync(env.OPENCODE_CONFIG) === env.OPENCODE_CONFIG, 'source-identity');
      const config = JSON.parse(readFileSync(env.OPENCODE_CONFIG, 'utf8'));
      insist(!config.provider && !config.providers, 'source-identity');
    }
    const dbs = new Map<string, { dev: number; ino: number }>();
    for (const fd of readdirSync(`/proc/${pid}/fd`)) {
      let target: string; try { target = readlinkSync(`/proc/${pid}/fd/${fd}`); } catch { continue; }
      if (!target.endsWith('/opencode.db')) continue;
      insist(realpathSync(target) === target, 'source-identity');
      const a = lstatSync(target); const b = statSync(`/proc/${pid}/fd/${fd}`);
      insist(a.isFile() && a.dev === b.dev && a.ino === b.ino && a.uid === process.getuid?.(), 'source-identity');
      dbs.set(target, { dev: a.dev, ino: a.ino });
    }
    insist(dbs.size === 1, 'source-identity');
    const root = path.dirname([...dbs.keys()][0]);
    insist(root === path.join(env.XDG_DATA_HOME || path.join(env.HOME || homedir(), '.local/share'), 'opencode'), 'source-identity');
    const source = sourceClient({ endpoint: `http://127.0.0.1:${port}`, root, pid }, env.OPENCODE_PASSWORD || env.OPENCODE_SERVER_PASSWORD || '', fetch, signal);
    const info = await source.info() as any; insist(info?.pid === pid && info.version === '2.1.3', 'source-identity');
    const schema = await source.schema() as any;
    insist(schema?.paths?.['/api/credential']?.get?.operationId === 'credential.list', 'source-schema');
    insist(schema?.paths?.['/api/model']?.get, 'source-schema');
    return source;
  } catch (e) { throw e instanceof LiveSafetyError ? e : new LiveSafetyError('source-identity'); }
}

export function selectZaiKey(entries: Credential.Entry[]): Credential.Entry {
  const active = entries.filter(e => e.active && e.integrationID === 'zai-coding-plan');
  insist(active.length === 1, 'selection'); const selected = active[0];
  insist(selected.value.type === 'key' && selected.value.key.trim().length > 0, 'method-cap-incompatible');
  return { ...selected, label: '', value: { type: 'key', key: selected.value.key } };
}
