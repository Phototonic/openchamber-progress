// Reported-progress motion probe for an isolated desktop host (QA-M). One CDP connection holds any
// media emulation for the whole command, since emulation ends when the client detaches.
// Usage: node --experimental-strip-types tests/browser/motion-probe.ts <port> <command> [--reduced] [...]
//   observe                      per guest frame: motion gate, running animations (element and
//                                pseudo-element), status-text contrast at its dimmest sampled phase
//   phase <seconds>              animation phase error against the document timeline, sampled across
//                                real repaints (root replacements) during the window
//   perf <seconds>               renderer Performance metric deltas per frame, repaints, in-place
//                                text updates and guest service requests over the window
//   shot <out.png> [x y w h]     screenshot with the emulation applied
//   instrument <surface>         reload that guest frame with a document-start counter of its 30 s
//                                label-ticker timers (window.__apLabelTimers: live, scheduled, fired)
// Guest frames are found by their view root (`[data-surface]`), so this works for srcdoc frames too.
import { writeFileSync } from 'node:fs';

type Msg = { id?: number; method?: string; params?: any; result?: any; error?: { message: string }; sessionId?: string };

const argv = process.argv.slice(2);
const reduced = argv.includes('--reduced');
const [portArg, command, ...args] = argv.filter((a) => a !== '--reduced');
const port = Number(portArg);
if (!Number.isInteger(port) || !command) throw new Error('usage: motion-probe.ts <port> <observe|phase|perf|shot> [--reduced] [...]');

const list = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as { type: string; url: string; webSocketDebuggerUrl: string }[];
const page = list.find((t) => t.type === 'page' && t.url.startsWith('openchamber-ui://')) ?? list.find((t) => t.type === 'page');
if (!page) throw new Error('no page target');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise<void>((resolve, reject) => { ws.onopen = () => resolve(); ws.onerror = () => reject(new Error('cdp connect failed')); });
let next = 1;
const waiting = new Map<number, (m: Msg) => void>();
const listeners: ((m: Msg) => void)[] = [];
ws.onmessage = (event) => {
  const m = JSON.parse(String(event.data)) as Msg;
  if (m.id && waiting.has(m.id)) { waiting.get(m.id)!(m); waiting.delete(m.id); } else listeners.forEach((l) => l(m));
};
const send = (method: string, params: object = {}, sessionId?: string) => new Promise<any>((resolve, reject) => {
  const id = next++;
  waiting.set(id, (m) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result)));
  ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
});
const evaluate = async (expression: string, sessionId?: string) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const attached: { sessionId: string; type: string }[] = [];
listeners.push((m) => { if (m.method === 'Target.attachedToTarget') attached.push({ sessionId: m.params.sessionId, type: m.params.targetInfo.type }); });
await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
await wait(400);
const frames: { surface: string; sessionId: string }[] = [];
for (const f of attached.filter((x) => x.type === 'iframe')) {
  const surface = await evaluate("document.querySelector('[data-surface]')?.dataset.surface ?? null", f.sessionId).catch(() => null);
  if (surface) frames.push({ surface, sessionId: f.sessionId });
}

if (reduced) {
  const media = { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] };
  await send('Emulation.setEmulatedMedia', media);
  for (const f of frames) await send('Emulation.setEmulatedMedia', media, f.sessionId).catch(() => {});
  await wait(300);
}
// Theme comes from the host (its own Appearance setting), never from emulation here.

// In-frame helpers (string-injected): canvas colour parsing handles any CSS colour syntax.
const HELPERS = `
const P = 2400;
const rgba = (css) => { const c = document.createElement('canvas'); c.width = c.height = 1; const x = c.getContext('2d'); x.fillStyle = css; x.fillRect(0, 0, 1, 1); const d = x.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
const over = (top, under) => { const a = top[3]; return [0, 1, 2].map((i) => top[i] * a + under[i] * (1 - a)).concat(1); };
const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const backdrop = (el) => { const chain = []; for (let n = el.parentElement; n; n = n.parentElement) chain.unshift(n); let bg = [255, 255, 255, 1]; for (const n of chain) { const c = rgba(getComputedStyle(n).backgroundColor); if (c[3] > 0) bg = over(c, bg); } return bg; };
const describe = (a) => { const t = a.effect.target; return { name: a.animationName, pseudo: a.effect.pseudoElement ?? null, target: t ? (t.className || t.tagName).toString().slice(0, 40) + (t.dataset?.k ? '[' + t.dataset.k + ']' : '') : null, state: a.playState }; };
// Phase error of each running animation against the document timeline (0 = on the shared phase).
// An animation without a current progress (not yet started) is reported separately, not as phase 0.
const phaseErrors = () => { const t = document.timeline.currentTime; return document.getAnimations().filter((a) => a.animationName?.startsWith('ap-')).map((a) => { const g = a.effect.getComputedTiming().progress; if (g == null) return 'unstarted:' + a.playState + ':' + a.startTime; let e = (((g * P - (t % P)) % P) + P) % P; if (e > P / 2) e -= P; return Math.round(e); }); };
`;

const OBSERVE = `(async () => { ${HELPERS}
  const root = document.querySelector('[data-testid=progress-root]');
  const text = document.querySelector('.ap-working-text');
  const pseudo = [...document.querySelectorAll('.ap-seg [data-k=working], .ap-glyph[data-status=working]')].map((n) => ({ el: n.className || n.dataset.k, k: n.dataset.k ?? n.dataset.status, after: getComputedStyle(n, '::after').animationName }));
  let contrast = null;
  if (text) {
    // Text = base colour (its own opacity) plus the pulse overlay (::after) at its sampled opacity.
    const bg = backdrop(text);
    const base = rgba(getComputedStyle(text).color);
    const layer = getComputedStyle(text, '::after');
    const overlay = layer.content && layer.content !== 'none' ? rgba(layer.color) : null;
    const shown = () => {
      // A repaint replaces the element; sample the current one, never a detached copy.
      const text = document.querySelector('.ap-working-text');
      if (!text) return { r: Infinity, o: 1, oo: 0 };
      const o = Number(getComputedStyle(text).opacity);
      let c = over([base[0], base[1], base[2], base[3] * o], bg);
      const oo = overlay ? Number(getComputedStyle(text, '::after').opacity) : 0;
      if (overlay) c = over([overlay[0], overlay[1], overlay[2], overlay[3] * oo * o], c);
      return { r: ratio(c, bg), o, oo };
    };
    let min = Infinity, max = 0, opacity = [1, 0], layerOpacity = [1, 0];
    const end = performance.now() + 2600;
    while (performance.now() < end) {
      const s = shown();
      if (s.r !== Infinity) { min = Math.min(min, s.r); max = Math.max(max, s.r); }
      opacity = [Math.min(opacity[0], s.o), Math.max(opacity[1], s.o)];
      layerOpacity = [Math.min(layerOpacity[0], s.oo), Math.max(layerOpacity[1], s.oo)];
      await new Promise((r) => requestAnimationFrame(r));
    }
    // Analytic bounds: rest frame (overlay transparent) and the pulse keyframe peak.
    const pulse = document.getAnimations().find((a) => a.animationName === 'ap-text-pulse');
    const peak = pulse ? Math.max(...pulse.effect.getKeyframes().map((k) => Number(k.opacity ?? 0))) : 0;
    const at = (oo) => { let c = over(base, bg); if (overlay) c = over([overlay[0], overlay[1], overlay[2], overlay[3] * oo], c); return Number(ratio(c, bg).toFixed(2)); };
    contrast = { restFrame: at(0), peakFrame: at(peak), peakOpacity: peak, text: text.textContent, color: getComputedStyle(text).color, overlayColor: overlay ? layer.color : null, background: 'rgb(' + bg.slice(0, 3).map(Math.round).join(',') + ')', textOpacity: opacity.map((x) => Number(x.toFixed(3))), overlayOpacity: layerOpacity.map((x) => Number(x.toFixed(3))), leastVisible: Number(min.toFixed(2)), mostVisible: Number(max.toFixed(2)) };
  }
  return {
    theme: document.documentElement.dataset.ocTheme ?? null,
    reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
    hidden: document.visibilityState,
    motionOn: document.querySelectorAll('[data-motion=on]').length,
    plans: [...document.querySelectorAll('[data-testid^=plan-]')].filter((n) => !n.dataset.testid.startsWith('plan-row') && !n.dataset.testid.startsWith('plan-list') && !n.dataset.testid.startsWith('plan-detail') && !n.dataset.testid.startsWith('plan-selector')).map((n) => ({ id: n.dataset.testid, lifecycle: n.dataset.lifecycle ?? null, motion: n.dataset.motion ?? null })),
    banners: ['stale-banner', 'capture-off', 'state-loading'].filter((id) => document.querySelector('[data-testid=' + id + ']')),
    animations: document.getAnimations().map(describe),
    pseudo,
    contrast,
    phaseErrors: phaseErrors(),
  };
})()`;

try {
  if (command === 'observe') {
    const out: Record<string, unknown> = { reducedEmulated: reduced };
    for (const f of frames) out[f.surface] = await evaluate(OBSERVE, f.sessionId);
    console.log(JSON.stringify(out, null, 2));
  } else if (command === 'phase') {
    const seconds = Number(args[0] ?? 20);
    for (const f of frames) await evaluate(`(() => { window.__apRepaints = 0; window.__apPhaseObserver ??= new MutationObserver(() => window.__apRepaints++); window.__apPhaseObserver.observe(document.getElementById('root'), { childList: true }); })()`, f.sessionId);
    const samples: Record<string, { repaints: number; errors: number[] }[]> = {};
    const end = Date.now() + seconds * 1000;
    while (Date.now() < end) {
      for (const f of frames) (samples[f.surface] ??= []).push(await evaluate(`(() => { ${HELPERS} return { repaints: window.__apRepaints, errors: phaseErrors() }; })()`, f.sessionId));
      await wait(500);
    }
    const summary = Object.fromEntries(Object.entries(samples).map(([s, xs]) => {
      const all = xs.flatMap((x) => x.errors as (number | string)[]);
      const nums = all.filter((x): x is number => typeof x === 'number');
      const off = xs.filter((x) => (x.errors as unknown[]).some((e) => typeof e !== 'number' || Math.abs(e) > 20)).slice(0, 5);
      return [s, { repaints: xs.at(-1)?.repaints ?? 0, samples: xs.length, animations: xs.at(-1)?.errors.length ?? 0, maxAbsPhaseErrorMs: nums.length ? Math.max(...nums.map(Math.abs)) : null, unstarted: all.length - nums.length, offSamples: off }];
    }));
    console.log(JSON.stringify({ seconds, reducedEmulated: reduced, ...summary }, null, 2));
  } else if (command === 'perf') {
    const seconds = Number(args[0] ?? 30);
    const requests: Record<string, number> = {};
    listeners.push((m) => {
      if (m.method !== 'Network.requestWillBeSent' || m.sessionId) return;
      const r = m.params.request;
      if (!String(r.url).includes('/service/request')) return;
      let path = '?';
      try { path = String(JSON.parse(r.postData ?? '{}').path ?? '?').split('?')[0]; } catch {}
      requests[path] = (requests[path] ?? 0) + 1;
    });
    await send('Network.enable');
    const pick = (r: { metrics: { name: string; value: number }[] }) => Object.fromEntries(r.metrics.filter((x) => ['TaskDuration', 'ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration', 'LayoutCount', 'RecalcStyleCount'].includes(x.name)).map((x) => [x.name, x.value]));
    const before: Record<string, Record<string, number>> = {};
    for (const f of frames) {
      await send('Performance.enable', {}, f.sessionId);
      await evaluate(`(() => { window.__apRepaints = 0; window.__apText = 0; const root = document.getElementById('root'); window.__apPerfObserver ??= new MutationObserver((ms) => { for (const m of ms) { if (m.target === root) window.__apRepaints++; else window.__apText++; } }); window.__apPerfObserver.observe(root, { childList: true, subtree: true, characterData: true }); })()`, f.sessionId);
      before[f.surface] = pick(await send('Performance.getMetrics', {}, f.sessionId));
    }
    await wait(seconds * 1000); // intentional measurement window, not a synchronization sleep
    const out: Record<string, unknown> = { seconds, reducedEmulated: reduced, serviceRequests: requests };
    for (const f of frames) {
      const after = pick(await send('Performance.getMetrics', {}, f.sessionId));
      const counts = await evaluate(`({ repaints: window.__apRepaints, inPlaceTextMutations: window.__apText, motionOn: document.querySelectorAll('[data-motion=on]').length, running: document.getAnimations().filter((a) => a.playState === 'running').length })`, f.sessionId);
      out[f.surface] = { ...counts, delta: Object.fromEntries(Object.keys(after).map((k) => [k, Number((after[k] - (before[f.surface][k] ?? 0)).toFixed(4))])) };
    }
    console.log(JSON.stringify(out, null, 2));
  } else if (command === 'instrument') {
    const f = frames.find((x) => x.surface === args[0]);
    if (!f) throw new Error(`no ${args[0]} frame`);
    const COUNTER = `(() => { const st = setTimeout, ct = clearTimeout, live = new Set(); const c = window.__apLabelTimers = { scheduled: 0, fired: 0, get live() { return live.size; } };
      window.setTimeout = function (fn, ms, ...a) { if (ms !== 30000) return st.call(window, fn, ms, ...a); const h = st.call(window, (...x) => { live.delete(h); c.fired++; return typeof fn === 'function' ? fn(...x) : undefined; }, ms, ...a); live.add(h); c.scheduled++; return h; };
      window.clearTimeout = function (h) { live.delete(h); return ct.call(window, h); }; })()`;
    await send('Page.enable', {}, f.sessionId);
    await send('Page.addScriptToEvaluateOnNewDocument', { source: COUNTER }, f.sessionId);
    await evaluate('setTimeout(() => location.reload(), 0), 1', f.sessionId);
    await wait(2500);
    console.log(JSON.stringify({ instrumented: args[0] }));
  } else if (command === 'shot') {
    const [file, x, y, w, h] = args;
    await wait(300);
    const clip = w ? { x: Number(x), y: Number(y), width: Number(w), height: Number(h), scale: 1 } : undefined;
    const shot = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip } : {}) });
    writeFileSync(file, Buffer.from(shot.data, 'base64'));
    console.log(`wrote ${file}`);
  } else throw new Error(`unknown command ${command}`);
} finally { ws.close(); }
