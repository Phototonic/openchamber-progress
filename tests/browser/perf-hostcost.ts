// Host-side cost summary of a perf-probe.ts run, for enabled vs disabled comparison (symptom 3).
// Usage: node --experimental-strip-types tests/browser/perf-hostcost.ts <out.json> [more out.json ...]
//   host-switch latency (click → host chrome shows the session), host renderer task/script seconds per
//   wall second between metrics pairs named "<x>-start"/"<x>-end", heap/nodes/listeners at each metric,
//   extension traffic (guest messages, proxied service requests) and frames.
import { readFileSync } from 'node:fs';

const pct = (xs: number[], p: number) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))]; };
for (const file of process.argv.slice(2)) {
  const run = JSON.parse(readFileSync(file, 'utf8')) as { events: any[] };
  const ev = run.events;
  const sw = ev.filter((e) => e.kind === 'host-switched' && typeof e.ms === 'number').map((e) => e.ms as number);
  const m = ev.filter((e) => e.kind === 'metrics');
  const windows: Record<string, unknown> = {};
  for (const a of m.filter((x) => x.label.endsWith('-start'))) {
    const name = a.label.slice(0, -6);
    const b = m.find((x) => x.label === `${name}-end`);
    if (!b) continue;
    const sec = (b.t - a.t) / 1000;
    windows[name] = { seconds: +sec.toFixed(1), taskPerSec: +((b.taskSec - a.taskSec) / sec).toFixed(4), scriptPerSec: +((b.scriptSec - a.scriptSec) / sec).toFixed(4), heapMB: [a.heapMB, b.heapMB], nodes: [a.nodes, b.nodes], listeners: [a.listeners, b.listeners], frames: [a.frames, b.frames] };
  }
  const guest = ev.filter((e) => e.kind === 'guest-msg');
  const byType: Record<string, number> = {};
  for (const g of guest) byType[g.type] = (byType[g.type] ?? 0) + 1;
  console.log(JSON.stringify({
    file: file.split('/').pop(),
    hostSwitchMs: { n: sw.length, p50: pct(sw, 0.5), p90: pct(sw, 0.9), max: sw.length ? Math.max(...sw) : null, over500: sw.filter((x) => x > 500).length },
    windows,
    extension: { guestMessages: byType, proxiedRequests: ev.filter((e) => e.src === 'net' && e.kind === 'req').length, frameMounts: ev.filter((e) => e.kind === 'frame-mount').length, frameRenders: ev.filter((e) => e.kind === 'render').length },
  }));
}
