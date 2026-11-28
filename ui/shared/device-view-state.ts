import type { LanguageStorage, LanguageStorageValue } from './language.ts';
import type { InboxRowView } from './model.ts';

export type ViewSurface = 'panel' | 'page';
export const HIDDEN_ITEM_LIMIT = 200;
export const DEVICE_VIEW_KEY = 'progress-view.v1';
export const QUIET_VIEW_RECORD = 'quiet-plans.v1';
const DEVICE = { scope: 'device' } as const;
function parseQuiet(value: LanguageStorageValue | undefined): boolean {
  if (value === undefined) return true;
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join() !== 'hide,v' || value.v !== 1 || typeof value.hide !== 'boolean') throw Error('read');
  return value.hide;
}
export interface DeviceViewRecord {
  v: 1;
  hidden: string[];
  expanded: Partial<Record<ViewSurface, boolean>>;
  dismissed: Partial<Record<ViewSurface, string>>;
}
const empty = (): DeviceViewRecord => ({ v: 1, hidden: [], expanded: {}, dismissed: {} });
export function hiddenItemKey<T extends Pick<InboxRowView, 'source' | 'plan' | 'blocker'> & { task: Pick<InboxRowView['task'], 'id'> }>(store: string, row: T): string {
  return JSON.stringify([store, row.source, row.plan, row.task.id, row.blocker.state === 'reported' ? row.blocker.reportedRevision : null]);
}
function parse(value: LanguageStorageValue | undefined): DeviceViewRecord {
  if (value === undefined) return empty();
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('read');
  const r = value as unknown as DeviceViewRecord;
  if (Object.keys(r).sort().join() !== 'dismissed,expanded,hidden,v' || r.v !== 1 || !Array.isArray(r.hidden) || r.hidden.length > HIDDEN_ITEM_LIMIT
    || new Set(r.hidden).size !== r.hidden.length || r.hidden.some(k => {
      if (typeof k !== 'string' || k.length > 4096) return true;
      try { const p = JSON.parse(k); return !Array.isArray(p) || p.length !== 5 || p.slice(0, 4).some(x => typeof x !== 'string' || !x) || !Number.isSafeInteger(p[4]) || p[4] < 1; } catch { return true; }
    })) throw Error('read');
  for (const [field, type] of [['expanded', 'boolean'], ['dismissed', 'string']] as const) {
    const part = r[field];
    if (!part || typeof part !== 'object' || Array.isArray(part) || Object.entries(part).some(([k, v]) => !['panel', 'page'].includes(k) || typeof v !== type || (typeof v === 'string' && v.length > 8192))) throw Error('read');
  }
  return structuredClone(r);
}

/** Device only. No browser fallback, repair of malformed bytes, or optimistic write confirmation.
 * A single serialized read/modify/write preserves this frame's independent fields. Other frames
 * converge on ordinary refresh; the host offers no compare-and-swap or cross-frame transaction.
 */
export class DeviceViewState {
  private record = empty();
  private supported = false;
  private loaded = false;
  private busy = false;
  private idle: Promise<void> = Promise.resolve();
  private epoch = 0;
  private quietHide = true;
  private quietError: 'read' | 'write' | null = null;
  private quietSaving = false;
  get quiet() { return { hide: this.quietHide, supported: this.supported, error: this.quietError, saving: this.quietSaving }; }
  error: 'read' | 'write' | null = null;
  private storage: LanguageStorage;
  private changed: () => void;
  private quietEnabled: boolean;
  constructor(storage: LanguageStorage, changed: () => void, quietEnabled = true) { this.storage = storage; this.changed = changed; this.quietEnabled = quietEnabled; }
  get canHide() { return this.supported && this.loaded && this.error !== 'read'; }
  get pending() { return this.busy; }
  hidden(key: string) { return this.record.hidden.includes(key); }
  /** Read-only input identity for bounded inbox derivations; never persisted by the caller. */
  get hiddenKeys(): readonly string[] { return this.record.hidden; }
  expanded(surface: ViewSurface) { return this.record.expanded[surface] ?? false; }
  dismissed(surface: ViewSurface, identity: string) { return this.record.dismissed[surface] === identity; }
  async refresh(supported: boolean) {
    const snapshot = () => JSON.stringify([this.record, this.loaded, this.error, this.quiet]);
    const before = snapshot();
    if (this.supported !== supported) {
      this.epoch++; this.supported = supported; this.loaded = false; this.record = empty(); this.error = null;
      this.quietHide = true; this.quietError = null;
    }
    if (!supported || this.busy) { if (snapshot() !== before) this.changed(); return; }
    const epoch = this.epoch;
    this.busy = true;
    let release!: () => void;
    this.idle = new Promise<void>(resolve => { release = resolve; });
    try {
      await Promise.all([
        Promise.resolve().then(() => this.storage.get(DEVICE_VIEW_KEY, DEVICE)).then(value => {
          const next = parse(value);
          if (epoch === this.epoch) { this.record = next; this.loaded = true; this.error = null; }
        }).catch(() => { if (epoch === this.epoch) { this.record = empty(); this.error = 'read'; this.loaded = false; } }),
        this.quietEnabled ? Promise.resolve().then(() => this.storage.get(QUIET_VIEW_RECORD, DEVICE)).then(value => {
          const next = parseQuiet(value);
          if (epoch === this.epoch) { this.quietHide = next; this.quietError = null; }
        }).catch(() => { if (epoch === this.epoch) { this.quietHide = true; this.quietError = 'read'; } }) : undefined,
      ]);
    } finally { this.busy = false; release(); if (snapshot() !== before) this.changed(); }
  }
  async setQuiet(hide: boolean): Promise<boolean> {
    if (!this.quietEnabled || this.quietSaving) return false;
    if (!this.supported) { this.quietHide = hide; this.changed(); return true; }
    const epoch = this.epoch;
    this.quietSaving = true; this.changed();
    try {
      while (this.busy) await this.idle;
      if (epoch !== this.epoch) return false;
      this.busy = true;
      let release!: () => void;
      this.idle = new Promise<void>(resolve => { release = resolve; });
      try {
        await this.storage.set(QUIET_VIEW_RECORD, { v: 1, hide }, DEVICE);
        if (epoch !== this.epoch) return false;
        this.quietHide = hide; this.quietError = null; return true;
      } catch { if (epoch === this.epoch) this.quietError = 'write'; return false; }
      finally { this.busy = false; release(); }
    } finally { this.quietSaving = false; this.changed(); }
  }
  private async update(edit: (record: DeviceViewRecord) => void): Promise<boolean> {
    while (this.busy) await this.idle;
    if (!this.supported) { edit(this.record); this.changed(); return true; }
    if (!this.canHide) return false;
    const epoch = this.epoch;
    this.busy = true; this.changed();
    let release!: () => void;
    this.idle = new Promise<void>(resolve => { release = resolve; });
    try {
      // Re-read first so independent fields saved by another frame are not routinely overwritten.
      const next = parse(await this.storage.get(DEVICE_VIEW_KEY, { scope: 'device' }));
      if (epoch !== this.epoch || !this.supported) return false;
      edit(next);
      await this.storage.set(DEVICE_VIEW_KEY, next as unknown as LanguageStorageValue, { scope: 'device' });
      if (epoch !== this.epoch) return false;
      this.record = next; this.error = null;
      return true;
    } catch { if (epoch === this.epoch) this.error = 'write'; return false; }
    finally { this.busy = false; release(); this.changed(); }
  }
  setExpanded(surface: ViewSurface, value: boolean) { return this.update(r => { r.expanded[surface] = value; }); }
  dismiss(surface: ViewSurface, identity: string) { return this.update(r => { r.dismissed[surface] = identity; }); }
  async hide(key: string) {
    while (this.busy) await this.idle;
    if (!this.canHide) return false;
    return this.update(r => { r.hidden = [...r.hidden.filter(k => k !== key), key].slice(-HIDDEN_ITEM_LIMIT); });
  }
  async unhide(key: string) {
    while (this.busy) await this.idle;
    if (!this.canHide) return false;
    return this.update(r => { r.hidden = r.hidden.filter(k => k !== key); });
  }
  async prune(store: string, source: string, keys: Set<string>) {
    while (this.busy) await this.idle;
    const matches = (key: string) => { const parts = JSON.parse(key); return parts[0] === store && parts[1] === source; };
    if (!this.canHide || !this.record.hidden.some(k => matches(k) && !keys.has(k))) return false;
    return this.update(r => { r.hidden = r.hidden.filter(k => !matches(k) || keys.has(k)); });
  }
}
