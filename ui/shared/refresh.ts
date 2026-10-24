// Coalesced, generation-guarded refresh scheduling and recent-scope memory (DOM-free for tests).

/**
 * Latest context wins. A request for the current generation runs at most once at a time, with at
 * most one coalesced follow-up queued. A retired (obsolete) read does not block the new generation;
 * its reply is discarded by the caller's generation check. Overlap is bounded: at most two reads in
 * flight (one obsolete, one current); anything beyond that waits as the single queued follow-up.
 * The transport cannot be aborted, so obsolete reads are discarded, never painted.
 */
export class RefreshGate {
  private inflight = new Set<number>();
  private queued = false;
  private generation = 0;
  private stopped = false;
  private run: (generation: number) => Promise<void>;
  static readonly MAX_IN_FLIGHT = 2;
  constructor(run: (generation: number) => Promise<void>) { this.run = run; }
  get current() { return this.generation; }
  get busy() { return this.inflight.size > 0; }
  get inFlight() { return this.inflight.size; }
  /** Retire every in-flight reply (context or identity change). */
  retire() { this.generation++; }
  request() {
    if (this.stopped) return;
    const generation = this.generation;
    if (this.inflight.has(generation) || this.inflight.size >= RefreshGate.MAX_IN_FLIGHT) { this.queued = true; return; }
    this.inflight.add(generation);
    void this.run(generation).finally(() => {
      this.inflight.delete(generation);
      if (this.queued && !this.stopped) { this.queued = false; this.request(); }
    });
  }
  /** Frame disposal: no new reads start; in-flight replies are already discarded by the caller. */
  stop() { this.stopped = true; this.queued = false; this.generation++; }
}

/**
 * Bounded memory of the last validated read per scope (least recently used first out). Keys must
 * carry the full authority (host account, store, source binding) and the list scope, so an entry
 * can never be served for another session, store or binding.
 */
export class RecentMemory<T> {
  private entries = new Map<string, T>();
  private limit: number;
  constructor(limit = 8) { this.limit = limit; }
  get size() { return this.entries.size; }
  get(key: string): T | undefined {
    const value = this.entries.get(key);
    if (value !== undefined) { this.entries.delete(key); this.entries.set(key, value); }
    return value;
  }
  set(key: string, value: T) {
    this.entries.delete(key);
    this.entries.set(key, value);
    while (this.entries.size > this.limit) this.entries.delete(this.entries.keys().next().value!);
  }
  clear() { this.entries.clear(); }
}
