/** Read-only capture comparison contract revision 1; no capture or schema mutation. */
export const CAPTURE_LIMITS = {
  rows: 128, entries: 50, responseBytes: 262_144, cursorBytes: 4096, queryBytes: 16_384,
  snapshotBytes: 1_048_576, documentBytes: 262_144, lines: 20_000,
  steps: 1_000_000, traceCells: 1_000_000, renderedLines: 2000, renderedBytes: 131_072,
} as const;
export interface CaptureBinding { sourceId: string | null; verified: boolean }
export interface CaptureRequest { storeId: string; binding: CaptureBinding; source: string; plan: string; cleanupRev: number }
export interface CaptureIdentity extends CaptureRequest { protocolVersion: 2; schemaVersion: 2; documentCaptureComparison: 1; sourceBinding: CaptureBinding }
export interface CaptureEntry { id: number; revision: number; hash: string; capturedAt: string; path: string }
export interface CaptureIndex extends CaptureIdentity {
  data: CaptureEntry[]; nextCursor: string | null; exhausted: boolean; scanned: number; revision: number;
  limit: 'rows' | 'entries' | 'bytes' | null;
}
export interface CaptureCurrent {
  revision: number; captureId: number | null; state: string; checklistSynchronized: boolean;
  checkedAt: string | null; path: string | null; currentFile: 'not-rechecked'; captureEnabled: boolean;
}
export interface DiffLine { kind: 'context' | 'added' | 'removed'; oldLine: number | null; newLine: number | null; text: string; ending: 'lf' | 'crlf' | 'none' }
export interface DiffHunk { oldStart: number; newStart: number; omittedBefore: number; lines: DiffLine[] }
export type CaptureDiff = { state: 'equal' } | { state: 'limited'; reason: 'bytes' | 'lines' | 'work' | 'output' } | { state: 'diff'; hunks: DiffHunk[]; omittedAfter: number; added: number; removed: number };
export interface CaptureComparison extends CaptureIdentity { before: CaptureEntry; after: CaptureEntry; current: CaptureCurrent; result: CaptureDiff }

/** Interned line Myers diff, with admission, work, trace and rendered-output bounds. */
export function compareCaptureText(before: string, after: string): CaptureDiff {
  const bytes = (s: string) => new TextEncoder().encode(s).length;
  if (bytes(before) > CAPTURE_LIMITS.documentBytes || bytes(after) > CAPTURE_LIMITS.documentBytes) return { state: 'limited', reason: 'bytes' };
  const lines = (s: string): string[] | null => {
    const out: string[] = []; let start = 0;
    for (let i = 0; i < s.length; i++) if (s[i] === '\n') {
      if (out.length === CAPTURE_LIMITS.lines) return null;
      out.push(s.slice(start, i + 1)); start = i + 1;
    }
    if (start < s.length) { if (out.length === CAPTURE_LIMITS.lines) return null; out.push(s.slice(start)); }
    return out;
  };
  const a = lines(before), b = lines(after);
  if (!a || !b) return { state: 'limited', reason: 'lines' };
  if (before === after) return { state: 'equal' };
  const intern = new Map<string, number>();
  const ids = (values: string[]) => values.map(s => { let id = intern.get(s); if (id === undefined) { id = intern.size; intern.set(s, id); } return id; });
  const aa = ids(a), bb = ids(b), n = a.length, m = b.length;
  const trace: Map<number, number>[] = []; const v = new Map<number, number>([[1, 0]]);
  let steps = 0, cells = 0, found = -1;
  outer: for (let d = 0; d <= n + m; d++) {
    cells += v.size; if (cells > CAPTURE_LIMITS.traceCells) return { state: 'limited', reason: 'work' };
    trace.push(new Map(v));
    for (let k = -d; k <= d; k += 2) {
      if (++steps > CAPTURE_LIMITS.steps) return { state: 'limited', reason: 'work' };
      let x = k === -d || k !== d && (v.get(k - 1) ?? -1) < (v.get(k + 1) ?? -1) ? v.get(k + 1) ?? 0 : (v.get(k - 1) ?? 0) + 1;
      let y = x - k;
      while (x < n && y < m && aa[x] === bb[y]) { x++; y++; if (++steps > CAPTURE_LIMITS.steps) return { state: 'limited', reason: 'work' }; }
      v.set(k, x);
      if (x >= n && y >= m) { found = d; break outer; }
    }
  }
  const operations: { kind: DiffLine['kind']; value: string }[] = [];
  let x = n, y = m;
  for (let d = found; d >= 0; d--) {
    const previous = trace[d], k = x - y;
    const pk = k === -d || k !== d && (previous.get(k - 1) ?? -1) < (previous.get(k + 1) ?? -1) ? k + 1 : k - 1;
    const px = previous.get(pk) ?? 0, py = px - pk;
    while (x > px && y > py) { operations.push({ kind: 'context', value: a[--x] }); y--; }
    if (d > 0) { if (x === px) operations.push({ kind: 'added', value: b[--y] }); else operations.push({ kind: 'removed', value: a[--x] }); }
  }
  operations.reverse();
  let oldLine = 1, newLine = 1, added = 0, removed = 0;
  const positioned: DiffLine[] = operations.map(o => {
    const ending = o.value.endsWith('\r\n') ? 'crlf' : o.value.endsWith('\n') ? 'lf' : 'none';
    if (o.kind === 'added') added++; if (o.kind === 'removed') removed++;
    return { kind: o.kind, oldLine: o.kind === 'added' ? null : oldLine++, newLine: o.kind === 'removed' ? null : newLine++, text: o.value.slice(0, o.value.length - (ending === 'crlf' ? 2 : ending === 'lf' ? 1 : 0)), ending };
  });
  const ranges: [number, number][] = [];
  for (let i = 0; i < positioned.length; i++) if (positioned[i].kind !== 'context') {
    const start = Math.max(0, i - 3), end = Math.min(positioned.length, i + 4), last = ranges.at(-1);
    if (last && start <= last[1]) last[1] = end; else ranges.push([start, end]);
  }
  let count = 0, size = 0, previousEnd = 0;
  const hunks: DiffHunk[] = [];
  for (const [start, end] of ranges) {
    count += end - start; if (count > CAPTURE_LIMITS.renderedLines) return { state: 'limited', reason: 'output' };
    const kept = positioned.slice(start, end);
    for (const line of kept) { size += bytes(line.text); if (size > CAPTURE_LIMITS.renderedBytes) return { state: 'limited', reason: 'output' }; }
    const oldStart = kept.find(l => l.oldLine !== null)?.oldLine ?? (positioned.slice(0, start).filter(l => l.oldLine !== null).length + 1);
    const newStart = kept.find(l => l.newLine !== null)?.newLine ?? (positioned.slice(0, start).filter(l => l.newLine !== null).length + 1);
    hunks.push({ oldStart, newStart, omittedBefore: start - previousEnd, lines: kept }); previousEnd = end;
  }
  return { state: 'diff', hunks, omittedAfter: positioned.length - previousEnd, added, removed };
}
