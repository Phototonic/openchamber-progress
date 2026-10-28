// Synthetic SDK device storage for change-digest checkpoint tests: one Map per device namespace
// (browser profile + runtime + installation), SDK key/namespace bounds, held operations and
// labelled fault seams. Instance-scope calls are recorded separately so a test can prove the
// digest never writes them.
export type Op = 'get' | 'set' | 'delete' | 'keys';
export function deferred<T = void>() { let resolve!: (v: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; }

export class Device {
  readonly map = new Map<string, unknown>();
  readonly log: { op: Op; key?: string; scope: string }[] = [];
  /** Instance-scope (default) calls: must stay empty for digest work. */
  readonly instance: { op: Op; key?: string }[] = [];
  /** Labelled seams: hold the next matching operation until released; fail matching operations. */
  holds: { op: Op; key?: RegExp; gate: ReturnType<typeof deferred<void>> }[] = [];
  faults: { op: Op; key?: RegExp; error: Error & { code?: string }; once?: boolean }[] = [];

  storage() {
    const run = async <T>(op: Op, key: string | undefined, scope: string | undefined, fn: () => T): Promise<T> => {
      if (scope !== 'device') { this.instance.push({ op, key }); return undefined as T; }
      this.log.push({ op, key, scope });
      const hold = this.holds.find((h) => h.op === op && (!h.key || (key !== undefined && h.key.test(key))));
      if (hold) { this.holds = this.holds.filter((h) => h !== hold); await hold.gate.promise; }
      const fault = this.faults.find((f) => f.op === op && (!f.key || (key !== undefined && f.key.test(key))));
      if (fault) { if (fault.once) this.faults = this.faults.filter((f) => f !== fault); throw fault.error; }
      return fn();
    };
    return {
      get: (key: string, o?: { scope?: string }) => run('get', key, o?.scope, () => (this.map.has(key) ? structuredClone(this.map.get(key)) : undefined)),
      set: (key: string, value: unknown, o?: { scope?: string }) => run('set', key, o?.scope, () => {
        if (key.length < 1 || key.length > 128) throw Object.assign(new Error('Storage key must contain 1 to 128 characters.'), { code: 'HOST_REJECTED' });
        if (!this.map.has(key) && this.map.size >= 2000) throw Object.assign(new Error('Storage quota exceeded: 2,000 keys.'), { code: 'HOST_REJECTED' });
        this.map.set(key, structuredClone(value));
      }),
      delete: (key: string, o?: { scope?: string }) => run('delete', key, o?.scope, () => { this.map.delete(key); }),
      keys: (o?: { scope?: string }) => run('keys', undefined, o?.scope, () => [...this.map.keys()].sort()),
    };
  }
  hold(op: Op, key?: RegExp) { const gate = deferred(); this.holds.push({ op, key, gate }); return gate.resolve; }
  fail(op: Op, code: string, message = 'synthetic storage failure', key?: RegExp, once = false) { this.faults.push({ op, key, error: Object.assign(new Error(message), { code }), once }); }
  writes() { return this.log.filter((l) => l.op === 'set'); }
}
