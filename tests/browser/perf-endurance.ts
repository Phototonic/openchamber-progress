// Aggregates one long perf-probe.ts run (plus its perf-analyze.ts --json summary and a proc-trend.sh
// series) into per-cycle and early-vs-late trends, instead of per-tick logs.
// Usage: node --experimental-strip-types tests/browser/perf-endurance.ts <probe out.json> <analyze.json> <proc.jsonl> [phases.json]
//   Cycles are delimited by metrics labels "<name>-start"/"<name>-end" (perf-hostcost.ts convention).
//   phases.json: [{ name, from, to }] epoch seconds, for per-role CPU/RSS/FD windows outside the probe run.
// Trends are reported as values and least-squares slopes; nothing here asserts a fixed budget.
import { existsSync, readFileSync } from 'node:fs';

const [probeFile, analyzeFile, procFile, phasesFile] = process.argv.slice(2);
if (!procFile) throw new Error('usage: perf-endurance.ts <probe out.json> <analyze.json> <proc.jsonl> [phases.json]');
const run = JSON.parse(readFileSync(probeFile, 'utf8')) as { startedAt: number; durationMs: number; maxInflight: number; events: any[] };
const analysis = JSON.parse(readFileSync(analyzeFile, 'utf8'));
const proc = readFileSync(procFile, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as { t: number; roles: Record<string, { n: number; cpu: number; rssMB: number; fd: number; thr: number }> });
const phases = phasesFile && existsSync(phasesFile) ? JSON.parse(readFileSync(phasesFile, 'utf8')) as { name: string; from: number; to: number }[] : [];

const pct = (xs: number[], p: number) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))]; };
const slope = (pts: [number, number][]) => {
  if (pts.length < 3) return null;
  const n = pts.length, mx = pts.reduce((a, p) => a + p[0], 0) / n, my = pts.reduce((a, p) => a + p[1], 0) / n;
  const sxx = pts.reduce((a, p) => a + (p[0] - mx) ** 2, 0);
  return sxx ? +(pts.reduce((a, p) => a + (p[0] - mx) * (p[1] - my), 0) / sxx).toFixed(4) : null;
};
const ev = run.events.slice().sort((a, b) => a.t - b.t);
const rel = (t: number) => (t - run.startedAt) / 1000;

// Cycles from metrics pairs.
const metrics = ev.filter((e) => e.kind === 'metrics');
const cycles = metrics.filter((m) => m.label.endsWith('-start')).map((a) => {
  const name = a.label.slice(0, -6);
  const b = metrics.find((m) => m.label === `${name}-end`);
  return b ? { name, t0: a.t, t1: b.t, a, b } : null;
}).filter(Boolean) as { name: string; t0: number; t1: number; a: any; b: any }[];

const switches = analysis.switches as any[];
const perCycle = cycles.map((c) => {
  const inC = (t: number) => t >= c.t0 && t <= c.t1;
  const sw = switches.filter((s) => inC(run.startedAt + s.at * 1000));
  const hostMs = [...new Set(sw.map((s) => `${s.at}|${s.hostSwitchMs}`))].map((k) => Number(k.split('|')[1])).filter((x) => Number.isFinite(x));
  const revisits = sw.filter((s) => s.revisit);
  const extMs = revisits.filter((s) => s.firstUsableMs != null && s.hostSwitchMs != null).map((s) => s.firstUsableMs - s.hostSwitchMs);
  const sec = (c.t1 - c.t0) / 1000;
  const net = ev.filter((e) => e.src === 'net' && inC(e.t));
  const msgs = ev.filter((e) => e.kind === 'guest-msg' && inC(e.t));
  const byType: Record<string, number> = {};
  for (const m of msgs) byType[m.type] = (byType[m.type] ?? 0) + 1;
  return {
    cycle: c.name, at: +rel(c.t0).toFixed(0), seconds: +sec.toFixed(1),
    hostSwitchMs: { n: hostMs.length, p50: pct(hostMs, 0.5), max: hostMs.length ? Math.max(...hostMs) : null },
    revisits: revisits.length, revisitLoading: revisits.filter((s) => s.loadingRenders > 0).length, revisitFirstUsableMsP50: pct(revisits.map((s) => s.firstUsableMs).filter((x) => x != null), 0.5),
    extensionBeyondHostMsP50: pct(extMs, 0.5), remountColdLoads: sw.filter((s) => s.remountRevisit && s.loadingRenders > 0).length,
    wrongScope: sw.reduce((a, s) => a + s.wrongScopeRenders, 0), maxListRounds: Math.max(0, ...sw.map((s) => s.listRounds)),
    requestsPerMin: +(net.filter((e) => e.kind === 'req').length * 60 / sec).toFixed(1), failed: net.filter((e) => e.kind === 'fail').length,
    maxInflight: Math.max(0, ...net.filter((e) => e.kind === 'req').map((e) => e.inflight)), reqMsP90: pct(net.filter((e) => e.kind === 'done').map((e) => e.ms), 0.9),
    guestMsgs: byType, mounts: ev.filter((e) => e.kind === 'frame-mount' && inC(e.t)).length, unmounts: ev.filter((e) => e.kind === 'frame-unmount' && inC(e.t)).length,
    renderer: { taskPerSec: +((c.b.taskSec - c.a.taskSec) / sec).toFixed(4), scriptPerSec: +((c.b.scriptSec - c.a.scriptSec) / sec).toFixed(4) },
    end: { heapMB: c.b.heapMB, nodes: c.b.nodes, listeners: c.b.listeners, documents: c.b.documents, frames: c.b.frames, liveExtFrames: c.b.hostFrames.length, guests: c.b.guestStates.map((g: any) => `${g.surface}:t${g.timers}/i${g.intervals}/l${g.listeners}/${g.visibility}/${(g.counts ?? []).join(',')}`) },
  };
});

const k = Math.min(2, Math.floor(perCycle.length / 2));
const early = perCycle.slice(0, k), late = perCycle.slice(-k);
const flat = (xs: typeof perCycle, f: (c: (typeof perCycle)[number]) => number | null) => xs.map(f).filter((x): x is number => x != null);
const earlyLate = {
  cycles: [early.map((c) => c.cycle), late.map((c) => c.cycle)],
  hostSwitchP50: [pct(flat(early, (c) => c.hostSwitchMs.p50), 0.5), pct(flat(late, (c) => c.hostSwitchMs.p50), 0.5)],
  revisitFirstUsableP50: [pct(flat(early, (c) => c.revisitFirstUsableMsP50), 0.5), pct(flat(late, (c) => c.revisitFirstUsableMsP50), 0.5)],
  extensionBeyondHostP50: [pct(flat(early, (c) => c.extensionBeyondHostMsP50), 0.5), pct(flat(late, (c) => c.extensionBeyondHostMsP50), 0.5)],
  requestsPerMin: [pct(flat(early, (c) => c.requestsPerMin), 0.5), pct(flat(late, (c) => c.requestsPerMin), 0.5)],
  rendererTaskPerSec: [pct(flat(early, (c) => c.renderer.taskPerSec), 0.5), pct(flat(late, (c) => c.renderer.taskPerSec), 0.5)],
};
const endPts = (f: (c: (typeof perCycle)[number]) => number) => perCycle.map((c) => [c.at / 60, f(c)] as [number, number]);
const hostSlopesPerMin = { heapMB: slope(endPts((c) => c.end.heapMB)), nodes: slope(endPts((c) => c.end.nodes)), listeners: slope(endPts((c) => c.end.listeners)), documents: slope(endPts((c) => c.end.documents)), hostSwitchP50Ms: slope(endPts((c) => c.hostSwitchMs.p50 ?? 0)) };

// Process roles: per sample window CPU %, RSS/FD/thread trends, and named phases.
const roles = [...new Set(proc.flatMap((s) => Object.keys(s.roles)))];
const procTrend = Object.fromEntries(roles.map((r) => {
  const pts = proc.filter((s) => s.roles[r]);
  const cpuPct = pts.slice(1).map((s, i) => 100 * Math.max(0, s.roles[r].cpu - pts[i].roles[r].cpu) / (s.t - pts[i].t));
  const t0 = pts[0]?.t ?? 0;
  return [r, {
    samples: pts.length, n: [pts[0]?.roles[r].n, pts.at(-1)?.roles[r].n],
    cpuPctP50: +(pct(cpuPct, 0.5) ?? 0).toFixed(2), cpuPctP90: +(pct(cpuPct, 0.9) ?? 0).toFixed(2),
    rssMB: [pts[0]?.roles[r].rssMB, pts.at(-1)?.roles[r].rssMB], rssMinMax: [Math.min(...pts.map((s) => s.roles[r].rssMB)), Math.max(...pts.map((s) => s.roles[r].rssMB))],
    rssSlopeMBperMin: slope(pts.map((s) => [(s.t - t0) / 60, s.roles[r].rssMB])),
    fd: [pts[0]?.roles[r].fd, pts.at(-1)?.roles[r].fd], fdMax: Math.max(...pts.map((s) => s.roles[r].fd)), fdSlopePerMin: slope(pts.map((s) => [(s.t - t0) / 60, s.roles[r].fd])),
    thr: [pts[0]?.roles[r].thr, pts.at(-1)?.roles[r].thr],
  }];
}));
const phaseCpu = phases.map((p) => {
  const inP = proc.filter((s) => s.t >= p.from && s.t <= p.to);
  if (inP.length < 2) return { phase: p.name, samples: inP.length };
  const a = inP[0], b = inP.at(-1)!, sec = b.t - a.t;
  return { phase: p.name, seconds: +sec.toFixed(0), cpuPct: Object.fromEntries([...new Set([...Object.keys(a.roles), ...Object.keys(b.roles)])].map((r) => [r, a.roles[r] && b.roles[r] ? +(100 * (b.roles[r].cpu - a.roles[r].cpu) / sec).toFixed(2) : (b.roles[r] ? 'appeared' : 'gone')])), rssEndMB: Object.fromEntries(Object.entries(b.roles).map(([r, v]) => [r, v.rssMB])), fdEnd: Object.fromEntries(Object.entries(b.roles).map(([r, v]) => [r, v.fd])) };
});

const updates = ev.filter((e) => e.kind === 'report-update').map((e) => ({ at: +rel(e.t).toFixed(0), script: e.script, ok: e.ok, ms: e.ms }));
console.log(JSON.stringify({
  window: { seconds: +(run.durationMs / 1000).toFixed(0), cycles: perCycle.length, switches: switches.length, maxInflight: run.maxInflight },
  checks: analysis.checks, idles: analysis.idles, pageOpens: analysis.pageOpens, updates,
  subscribeBalanceByFrame: analysis.subscribeBalanceByFrame, pagehides: analysis.pagehides,
  earlyLate, hostSlopesPerMin, perCycle, procTrend, phaseCpu,
}, null, 1));
