// Summarises a perf-probe.ts run into per-switch facts and the user-symptom checks.
// Usage: node --experimental-strip-types tests/browser/perf-analyze.ts <out.json> <expect.json> [--json]
//   expect.json: { "A1": ["P1"], "A3": [] , ... }  plans each scenario session must show.
// Checks (red = symptom present):
//   S2-revisit-loading   a mounted surface showed a loading state when returning to a scope it already showed
//   S2-switch-loading-ms longest loading window after a switch (information; latency on the user's host scales it)
//   S2-double-round      list rounds (/v1/plans) before first usable data after one switch (>1 = serial re-read)
//   LEAK-wrong-scope     a data render after a switch showed plans of another session (must stay 0)
//   S2-revisit-repaint   after a revisit's first usable paint, the visible data changed again although
//                        the store did not (state/plans/stale; live chip labels excluded)
//   IDLE-changed-renders renders whose visible state changed during an idle window with unchanged data (must be 0)
import { readFileSync } from 'node:fs';

type Ev = { t: number; src: string; kind: string; [k: string]: any };
const [outFile, expectFile, flag] = process.argv.slice(2);
const run = JSON.parse(readFileSync(outFile, 'utf8')) as { events: Ev[]; startedAt: number };
const expect = JSON.parse(readFileSync(expectFile, 'utf8')) as Record<string, string[]>;
const ev = run.events.slice().sort((a, b) => a.t - b.t);
// Window boundaries are driver actions only (not host-switched/attach/inject notes).
const steps = ev.filter((e) => e.src === 'step' && ['open', 'idle-start', 'idle-end', 'rail', 'page-open', 'metrics'].includes(e.kind));
const rel = (t: number) => +((t - run.startedAt) / 1000).toFixed(2);

const windows: { kind: string; label: string; target?: string; t0: number; t1: number }[] = [];
for (let i = 0; i < steps.length; i++) {
  const s = steps[i];
  const t1 = steps.slice(i + 1).find((x) => x.kind !== 'metrics')?.t ?? ev[ev.length - 1].t;
  if (s.kind === 'open') windows.push({ kind: 'open', label: s.label, target: s.target, t0: s.t, t1 });
  if (s.kind === 'idle-start') windows.push({ kind: 'idle', label: s.label, t0: s.t, t1: steps[i + 1].t });
  if (s.kind === 'page-open') windows.push({ kind: 'page', label: 'page-open', t0: s.t, t1 });
}
const pageOpens: any[] = [];

const seenScope = new Map<string, Set<string>>(); // surface -> targets that surface has shown data for
const switches: any[] = [];
const idles: any[] = [];
let leak = 0, revisitLoading = 0, maxLoadingMs = 0, maxRounds = 0, revisitRepaint = 0, remountColdLoads = 0;

for (const w of windows) {
  const inW = ev.filter((e) => e.t >= w.t0 && e.t < w.t1);
  const renders = inW.filter((e) => e.src === 'frame' && e.kind === 'render');
  const msgs = inW.filter((e) => e.src === 'host' && e.kind === 'guest-msg');
  const surfaces = [...new Set([...renders.map((r) => r.surface), ...msgs.map((m) => m.surface)])];
  if (w.kind === 'idle') {
    const sec = (w.t1 - w.t0) / 1000;
    const byPath: Record<string, number> = {};
    for (const m of msgs.filter((m) => m.type === 'service-request')) byPath[m.path] = (byPath[m.path] ?? 0) + 1;
    idles.push({ label: w.label, seconds: +sec.toFixed(1), surfaces, requestsPerMin: Object.fromEntries(Object.entries(byPath).map(([k, v]) => [k, +(v * 60 / sec).toFixed(1)])), renders: renders.length, changedRenders: renders.filter((r) => r.changed).length, subscribeMsgs: msgs.filter((m) => m.type === 'workspace-subscribe').length });
    continue;
  }
  if (w.kind === 'page') {
    const r = renders.filter((x) => x.surface === 'page');
    const first = r.find((x) => x.s === 'data' || x.s === 'empty');
    const m = msgs.filter((x) => x.surface === 'page' && x.type === 'service-request');
    const byPath: Record<string, number> = {};
    for (const x of m.filter((x) => !first || x.t <= first.t)) byPath[x.path] = (byPath[x.path] ?? 0) + 1;
    pageOpens.push({ at: rel(w.t0), firstUsableMs: first ? first.t - w.t0 : null, firstRenderMs: r.length ? r[0].t - w.t0 : null, requestsBeforeUsable: byPath, rendersInWindow: r.length, instances: [...new Set(r.map((x) => x.inst))].length });
    continue;
  }
  const hostSwitch = inW.find((e) => e.kind === 'host-switched');
  const expected = expect[w.target!] ?? [];
  // Per frame instance: a "revisit" is a scope THIS frame already showed. A scope only an earlier
  // (now disposed) frame showed is a remount revisit — the host rebuilt the frame, it starts cold.
  const units = [...new Set(renders.filter((x) => x.surface !== 'page').map((x) => `${x.surface}#${x.inst}`))];
  for (const unit of units.length ? units : surfaces.filter((s) => s !== 'page').map((s) => `${s}#none`)) {
    const [surface, inst] = unit.split('#');
    const r = renders.filter((x) => x.surface === surface && x.inst === inst);
    const m = msgs.filter((x) => x.surface === surface);
    const firstUsable = r.find((x) => x.s === 'data' || x.s === 'empty');
    const loading = r.filter((x) => x.s === 'loading');
    const loadingMs = loading.length ? (firstUsable ? firstUsable.t : w.t1) - loading[0].t : 0;
    const rounds = m.filter((x) => x.type === 'service-request' && x.path === '/v1/plans' && (!firstUsable || x.t <= firstUsable.t)).length;
    const wrong = r.filter((x) => x.s === 'data' && x.plans.some((p: string) => !expected.includes(p)));
    const visited = seenScope.get(unit)?.has(w.target!) ?? false;
    const remountRevisit = !visited && (seenScope.get(`surface:${surface}`)?.has(w.target!) ?? false);
    if (remountRevisit && r.some((x) => x.s === 'loading')) remountColdLoads++;
    const instances = [...new Set(r.map((x) => x.inst))];
    // Data-visible changes after the first usable paint (state, plans, stale) — live chip labels excluded.
    const dataSig = (x: any) => `${x.s}|${x.plans.join(',')}|${x.stale}`;
    let dataChangesAfterUsable = 0;
    if (firstUsable) { const after = r.slice(r.indexOf(firstUsable)); for (let i = 1; i < after.length; i++) if (dataSig(after[i]) !== dataSig(after[i - 1])) dataChangesAfterUsable++; }
    if (visited && dataChangesAfterUsable) revisitRepaint++;
    if (wrong.length) leak += wrong.length;
    if (visited && loading.length) revisitLoading++;
    maxLoadingMs = Math.max(maxLoadingMs, loadingMs);
    maxRounds = Math.max(maxRounds, rounds);
    if (firstUsable) for (const k of [unit, `surface:${surface}`]) (seenScope.get(k) ?? seenScope.set(k, new Set()).get(k)!).add(w.target!);
    switches.push({
      at: rel(w.t0), label: w.label, target: w.target, surface, frame: inst, revisit: visited, remountRevisit, instances: instances.length, hostSwitchMs: hostSwitch?.ms ?? null,
      frameReactMs: r.length ? r[0].t - w.t0 : null,
      loadingRenders: loading.length, loadingMs, firstUsableMs: firstUsable ? firstUsable.t - w.t0 : null, listRounds: rounds,
      healthReqs: m.filter((x) => x.path === '/health').length, otherReqs: m.filter((x) => x.type === 'service-request' && !['/health', '/v1/plans'].includes(x.path)).map((x) => x.path),
      subscribe: m.filter((x) => x.type === 'workspace-subscribe').length, unsubscribe: m.filter((x) => x.type === 'workspace-unsubscribe').length,
      renders: r.length, changedRenders: r.filter((x) => x.changed).length, dataChangesAfterUsable, final: r.length ? `${r[r.length - 1].s}:${r[r.length - 1].plans.join(',')}` : 'no-render', wrongScopeRenders: wrong.length,
    });
  }
}

const mounts = ev.filter((e) => e.src === 'host' && e.kind === 'frame-mount').map((e) => ({ at: rel(e.t), surface: e.surface, frame: e.frame }));
const unmounts = ev.filter((e) => e.src === 'host' && e.kind === 'frame-unmount').map((e) => ({ at: rel(e.t), surface: e.surface, frame: e.frame }));
const pagehides = ev.filter((e) => e.src === 'frame' && e.kind === 'pagehide').map((e) => ({ surface: e.surface, timers: e.timers, intervals: e.intervals, listeners: e.listeners }));
const metrics = ev.filter((e) => e.kind === 'metrics').map((e) => ({ at: rel(e.t), label: e.label, heapMB: e.heapMB, nodes: e.nodes, listeners: e.listeners, documents: e.documents, frames: e.frames, taskSec: e.taskSec, scriptSec: e.scriptSec, guest: (e.guestStates ?? []).map((g: any) => `${g.surface}:r${g.renders}/t${g.timers}/i${g.intervals}/l${g.listeners}/${g.visibility}`) }));
const subBalance: Record<string, number> = {};
for (const m of ev.filter((e) => e.src === 'host' && e.kind === 'guest-msg' && /workspace-(un)?subscribe/.test(e.type))) {
  const k = `${m.surface}#${m.frame}`; subBalance[k] = (subBalance[k] ?? 0) + (m.type === 'workspace-subscribe' ? 1 : -1);
}
const checks = {
  'S2-revisit-loading': { red: revisitLoading > 0, value: revisitLoading },
  'S2-switch-loading-ms': { value: maxLoadingMs },
  'S2-double-round': { red: maxRounds > 1, value: maxRounds },
  'LEAK-wrong-scope': { red: leak > 0, value: leak },
  'S2-revisit-repaint': { red: revisitRepaint > 0, value: revisitRepaint },
  'INFO-remount-cold-loads': { value: remountColdLoads }, // host rebuilt the frame (e.g. per-project rail state): starts cold by design
  'IDLE-changed-renders': { red: idles.some((i) => i.changedRenders > 0), value: idles.map((i) => i.changedRenders) },
};
const summary = { checks, idles, pageOpens, switches, mounts, unmounts, pagehides, metrics, subscribeBalanceByFrame: subBalance };
if (flag === '--json') console.log(JSON.stringify(summary, null, 2));
else {
  console.log('CHECKS', JSON.stringify(checks));
  for (const i of idles) console.log('IDLE', JSON.stringify(i));
  for (const p of pageOpens) console.log('PAGE', JSON.stringify(p));
  for (const s of switches) console.log('SWITCH', JSON.stringify(s));
  console.log('MOUNTS', JSON.stringify(mounts), 'UNMOUNTS', JSON.stringify(unmounts));
  console.log('PAGEHIDE', JSON.stringify(pagehides));
  for (const m of metrics) console.log('METRICS', JSON.stringify(m));
  console.log('SUB-BALANCE', JSON.stringify(subBalance));
}
process.exitCode = Object.values(checks).some((c: any) => c.red) ? 1 : 0;
