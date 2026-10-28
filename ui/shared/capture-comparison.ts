// One explicit Document-tab visit; no polling or persistence. Late replies have no authority.
import type { CaptureRequest, CaptureEntry, CaptureComparison } from '../../shared/document-comparison.ts';
import { readCaptureIndex, readCaptureComparison, type ServiceHost, type ReadFailure } from './source.ts';

export interface CaptureClaim { owner: string; request: CaptureRequest; revision: number; capable: boolean }
export interface CaptureHost { service: (current: () => boolean) => ServiceHost; visible: () => boolean; changed: () => void }
export interface CapturePanel {
  capable: boolean; open: boolean; loading: boolean; comparing: boolean; entries: CaptureEntry[];
  before: CaptureEntry | null; after: CaptureEntry | null; exhausted: boolean; hasRead: boolean;
  indexError: string | null; comparisonError: string | null; result: CaptureComparison | null; newer: boolean;
  toggle: () => void; more: () => void; refresh: () => void; retryIndex: () => void;
  choose: (side: 'before' | 'after', id: number) => void; compare: () => void;
}
interface Visit extends CaptureClaim {
  key: string; open: boolean; page: CaptureEntry[]; before: CaptureEntry | null; after: CaptureEntry | null;
  cursor?: string; exhausted: boolean; hasRead: boolean; indexRevision: number | null;
  indexEpoch: number; pairEpoch: number; loading: boolean; comparing: boolean;
  indexError: string | null; comparisonError: string | null; result: CaptureComparison | null;
}
function failureText(f: ReadFailure) {
  if (f.kind === 'not-found') return 'This plan or capture is no longer available. Refresh the plan list.';
  if (f.code === 'conflict') return 'The source or archive state changed. Refresh this view before comparing.';
  return 'The recorded captures could not be read. Retry when the service is available.';
}
export class CaptureController {
  private visit: Visit | null = null;
  private claimed = false;
  private readonly host: CaptureHost;
  constructor(host: CaptureHost) { this.host = host; }
  beginPaint() { this.claimed = false; }
  endPaint() { if (!this.claimed) this.retire(); }
  retire() { this.visit = null; }
  claim(c: CaptureClaim): CapturePanel {
    this.claimed = true;
    const key = JSON.stringify([c.owner,c.request,c.capable]);
    if (!this.visit || this.visit.key !== key) this.visit = {
      ...c, key, open: false, page: [], before: null, after: null, exhausted: false, hasRead: false,
      indexRevision: null, indexEpoch: 0, pairEpoch: 0, loading: false, comparing: false,
      indexError: null, comparisonError: null, result: null,
    };
    const v = this.visit; v.revision = c.revision;
    const live = () => this.visit === v && this.host.visible();
    const entries = [...new Map([...v.page, ...[v.before,v.after].filter((e): e is CaptureEntry => !!e)].map(e => [e.id,e])).values()].sort((a,b) => b.id-a.id);
    return {
      capable: v.capable, open: v.open, loading: v.loading, comparing: v.comparing, entries,
      before: v.before, after: v.after, exhausted: v.exhausted, hasRead: v.hasRead,
      indexError: v.indexError, comparisonError: v.comparisonError, result: v.result,
      newer: v.revision > (v.result?.current.revision ?? v.indexRevision ?? v.revision),
      toggle: () => {
        if (!live() || !v.capable) return;
        if (v.open) { v.open = false; v.indexEpoch++; v.pairEpoch++; v.loading = v.comparing = false; v.page = []; v.before = v.after = null; v.result = null; v.hasRead = false; v.cursor = undefined; v.exhausted = false; this.host.changed(); }
        else { v.open = true; void this.load(v, true); }
      },
      more: () => { if (live() && !v.loading && !v.exhausted) void this.load(v, false); },
      refresh: () => { if (live() && !v.loading) void this.load(v, true); },
      retryIndex: () => { if (live() && !v.loading) void this.load(v, false); },
      choose: (side,id) => {
        if (!live() || !v.open) return;
        const selected = entries.find(e => e.id === id); if (!selected) return;
        v[side] = selected; v.pairEpoch++; v.comparing = false; v.result = null; v.comparisonError = null; this.host.changed();
      },
      compare: () => { if (live()) void this.compare(v); },
    };
  }
  private current(v: Visit, epoch: number, kind: 'indexEpoch' | 'pairEpoch') {
    return () => this.visit === v && v.open && this.host.visible() && v[kind] === epoch;
  }
  private missing(v: Visit) {
    v.page = []; v.before = v.after = null; v.result = null; v.pairEpoch++; v.indexEpoch++; v.comparing = v.loading = false;
    v.cursor = undefined; v.exhausted = false; v.hasRead = false;
  }
  private async load(v: Visit, refresh: boolean) {
    if (!v.open || !v.capable || v.loading) return;
    if (refresh) { v.cursor = undefined; v.exhausted = false; v.indexRevision = null; }
    v.loading = true; v.indexError = null;
    const own = this.current(v, ++v.indexEpoch, 'indexEpoch'); this.host.changed();
    // Empty sparse windows can advance automatically, but never beyond ten per explicit action.
    for (let window = 0; window < 10; window++) {
      const r = await readCaptureIndex(this.host.service(own), v.request, v.cursor);
      if (!own()) return;
      if (!r.ok) {
        v.indexError = failureText(r.failure); v.loading = false;
        if (r.failure.kind === 'not-found' || r.failure.code === 'conflict') this.missing(v);
        this.host.changed(); return;
      }
      const w = r.value;
      if (v.indexRevision !== null && w.revision !== v.indexRevision) {
        v.indexError = 'The capture discovery boundary changed. Refresh captures to start again.'; v.loading = false; this.host.changed(); return;
      }
      v.indexRevision = w.revision; v.hasRead = true; v.cursor = w.nextCursor ?? undefined; v.exhausted = w.exhausted;
      if (w.data.length || w.exhausted) {
        v.page = w.data;
        // Keep choices across pages/refreshes. Default only through successful gap-free windows.
        v.after ??= w.data[0] ?? null;
        v.before ??= w.data.find(e => v.after && e.id < v.after.id) ?? null;
        v.loading = false; this.host.changed();
        if (v.before && v.after && !v.result && !v.comparing) void this.compare(v);
        return;
      }
    }
    v.loading = false; this.host.changed();
  }
  private async compare(v: Visit) {
    if (!v.open || !v.capable || v.comparing || !v.before || !v.after || v.before.id > v.after.id) return;
    const before = v.before.id, after = v.after.id, own = this.current(v, ++v.pairEpoch, 'pairEpoch');
    v.comparing = true; v.result = null; v.comparisonError = null; this.host.changed();
    const r = await readCaptureComparison(this.host.service(own), v.request, before, after);
    if (!own()) return;
    v.comparing = false;
    if (r.ok) v.result = r.value;
    else { v.comparisonError = failureText(r.failure); if (r.failure.kind === 'not-found' || r.failure.code === 'conflict') this.missing(v); }
    this.host.changed();
  }
}
