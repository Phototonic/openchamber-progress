// Performance / lifecycle probe for the three extension surfaces in an ISOLATED desktop host.
// One CDP connection to the host page; no guest source changes.
//   host page : capturing `message` listener attributes every guest→host SDK message (type, service
//               path, scope) to a frame instance + surface; MutationObserver records frame mount/unmount;
//               Network domain times proxied service calls and tracks in-flight; Performance metrics.
//   guest frames (auto-attached, paused at start): an injected document-start script reports renders
//               (#root replacements), visible state transitions with the plan ids shown, timers/listeners.
// Usage: node --experimental-strip-types tests/browser/perf-probe.ts <cdp port> <scenario.json> <out.json>
// Scenario: { sessions: {NAME: "sidebar title"}, steps: Step[], expect?: {...} } — see runStep().
import { readFileSync, writeFileSync } from 'node:fs';

type Msg = { id?: number; method?: string; params?: any; result?: any; error?: { message: string }; sessionId?: string };
type Ev = { t: number; src: 'host' | 'frame' | 'net' | 'step'; kind: string; [k: string]: unknown };

const [portArg, scenarioFile, outFile] = process.argv.slice(2);
if (!outFile) throw new Error('usage: perf-probe.ts <cdp port> <scenario.json> <out.json>');
const scenario = JSON.parse(readFileSync(scenarioFile, 'utf8')) as { sessions: Record<string, string>; steps: Step[] };
type Step =
  | { open: string; settle?: number }            // click a sidebar session by scenario name, then wait
  | { idle: number; label: string }              // observe without input
  | { rail: 'open' | 'close' }                   // right rail toggle via the host's right-bar Agent progress button
  | { page: 'open'; settle?: number }            // fullscreen page via the host's left-bar Agent progress entry
  | { metrics: string }                          // host page metrics after forced GC
  | { repeat: number; steps: Step[]; label: string };

const list = (await (await fetch(`http://127.0.0.1:${portArg}/json/list`)).json()) as { type: string; url: string; webSocketDebuggerUrl: string }[];
const page = list.find((t) => t.type === 'page' && t.url.startsWith('openchamber-ui://')) ?? list.find((t) => t.type === 'page');
if (!page) throw new Error('no page target');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise<void>((res, rej) => { ws.onopen = () => res(); ws.onerror = () => rej(new Error('cdp connect failed')); });
let nextId = 1;
const waiting = new Map<number, (m: Msg) => void>();
const send = (method: string, params: object = {}, sessionId?: string) => new Promise<any>((resolve, reject) => {
  const id = nextId++;
  waiting.set(id, (m) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result)));
  ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
});
const events: Ev[] = [];
const now = () => Date.now();
const inflight = new Map<string, number>();
let maxInflight = 0;

// Guest frames: injected before any guest script; reports through a CDP binding (survives nothing, needs nothing).
const FRAME_SCRIPT = `(() => {
  if (window.__perfInstalled) return; window.__perfInstalled = true;
  const surface = (location.pathname.match(/\\/ui\\/(\\w+)\\//) || [])[1] || (location.href === 'about:srcdoc' ? 'srcdoc' : 'other');
  if (surface === 'other') return;
  const inst = Math.random().toString(36).slice(2, 8);
  const emit = (ev) => { try { window.__perfEmit(JSON.stringify({ inst, surface, t: Date.now(), ...ev })); } catch {} };
  const timers = new Set(), intervals = new Set(); let listeners = 0;
  const st = setTimeout, ct = clearTimeout, si = setInterval, ci = clearInterval;
  window.setTimeout = function (fn, ms, ...a) { const h = st.call(window, (...x) => { timers.delete(h); if (typeof fn === 'function') return fn(...x); }, ms, ...a); timers.add(h); return h; };
  window.clearTimeout = function (h) { timers.delete(h); return ct.call(window, h); };
  window.setInterval = function (...a) { const h = si.apply(window, a); intervals.add(h); return h; };
  window.clearInterval = function (h) { intervals.delete(h); return ci.call(window, h); };
  const ael = EventTarget.prototype.addEventListener, rel = EventTarget.prototype.removeEventListener;
  EventTarget.prototype.addEventListener = function (...a) { if (this === window || this === document) listeners++; return ael.apply(this, a); };
  EventTarget.prototype.removeEventListener = function (...a) { if (this === window || this === document) listeners--; return rel.apply(this, a); };
  let renders = 0, last = '';
  const classify = () => {
    const r = document.querySelector('[data-testid=progress-root]');
    if (!r) return { s: 'none', plans: [] };
    const q = (sel) => !!r.querySelector(sel);
    const plans = [...r.querySelectorAll('[data-testid]')].map((n) => n.dataset.testid).filter((x) => /^plan-(row-)?P/.test(x)).map((x) => x.replace(/^plan-(row-)?/, ''));
    const state = r.getAttribute('aria-busy') === 'true' || q('[data-testid=state-loading]') ? 'loading'
      : q('[data-testid^=state-]') ? [...r.querySelectorAll('[data-testid^=state-]')].map((n) => n.dataset.testid).join('+')
      : q('[data-testid=setup-panel],[data-testid=setup-needed]') ? 'setup'
      : q('[data-testid=unscoped-state]') ? 'unscoped'
      : plans.length ? 'data' : q('[data-testid=empty-state]') ? 'empty' : 'other';
    return { s: state, plans: [...new Set(plans)].sort(), stale: q('[data-testid=stale-banner]'), detailLoading: q('[data-testid=detail-loading]'), checking: /Checking…/.test(r.textContent) };
  };
  new MutationObserver((ms) => {
    if (!ms.some((m) => m.target && m.target.id === 'root')) return;
    renders++;
    const c = classify(); const sig = JSON.stringify(c);
    emit({ kind: 'render', n: renders, ...c, changed: sig !== last });
    last = sig;
  }).observe(document, { subtree: true, childList: true });
  window.__perfState = () => ({ inst, surface, renders, timers: timers.size, intervals: intervals.size, listeners, visibility: document.visibilityState });
  emit({ kind: 'boot' });
  addEventListener('pagehide', () => emit({ kind: 'pagehide', renders, timers: timers.size, intervals: intervals.size, listeners }));
})();`;

// Host page: guest→host messages and frame mount/unmount, attributed to an iframe instance.
const HOST_SCRIPT = `(() => {
  if (window.__hostPerf) return 'already'; window.__hostPerf = true;
  const ids = new WeakMap(); let n = 0;
  const surfaceOf = (f) => { const s = f.getAttribute('src') || ''; const m = s.match(/\\/ui\\/(\\w+)\\//); return m ? m[1] : (f.hasAttribute('srcdoc') ? 'srcdoc' : null); };
  const idOf = (f) => { if (!ids.has(f)) ids.set(f, ++n); return ids.get(f); };
  const emit = (ev) => { try { window.__hostEmit(JSON.stringify({ t: Date.now(), ...ev })); } catch {} };
  addEventListener('message', (e) => {
    const d = e.data; if (!d || typeof d !== 'object' || typeof d.type !== 'string' || !('channel' in d)) return;
    const f = [...document.querySelectorAll('iframe')].find((x) => x.contentWindow === e.source);
    if (!f) return; const surface = surfaceOf(f); if (!surface) return;
    const p = d.payload || {};
    emit({ kind: 'guest-msg', type: d.type, surface, frame: idOf(f), path: p.path, query: p.query && (p.query.kind ? { kind: p.query.kind } : { session: p.query.session ? 'yes' : undefined, directory: p.query.directory ? 'yes' : undefined, cursor: p.query.cursor, capture: p.query.capture }) });
  }, true);
  // A frame instance is an iframe element + its src: the host may reuse one element for another surface.
  const seen = new Map();
  const scan = () => {
    const live = new Map([...document.querySelectorAll('iframe')].filter((f) => surfaceOf(f)).map((f) => [f, (f.getAttribute('src') || 'srcdoc')]));
    for (const [f, src] of live) if (seen.get(f) !== src) {
      if (seen.has(f)) emit({ kind: 'frame-unmount', surface: seen.get(f).match(/\\/ui\\/(\\w+)\\//)?.[1] ?? 'srcdoc', frame: idOf(f), reused: true });
      ids.set(f, ++n); seen.set(f, src); emit({ kind: 'frame-mount', surface: surfaceOf(f), frame: idOf(f), hidden: !f.offsetParent });
    }
    for (const f of [...seen.keys()]) if (!live.has(f)) { emit({ kind: 'frame-unmount', surface: seen.get(f).match(/\\/ui\\/(\\w+)\\//)?.[1] ?? 'srcdoc', frame: idOf(f) }); seen.delete(f); }
  };
  new MutationObserver(scan).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['src', 'srcdoc'] });
  scan();
  window.__hostFrames = () => [...seen.keys()].map((f) => ({ frame: idOf(f), surface: surfaceOf(f), visible: !!f.offsetParent }));
  return 'installed';
})()`;

const sessionsFrames = new Map<string, string>(); // CDP sessionId -> url
ws.onmessage = (event) => {
  const m = JSON.parse(String(event.data)) as Msg;
  if (m.id && waiting.has(m.id)) { waiting.get(m.id)!(m); waiting.delete(m.id); return; }
  if (m.method === 'Runtime.bindingCalled') {
    const p = JSON.parse(m.params.payload);
    if (m.params.name === '__perfEmit') events.push({ src: 'frame', ...p });
    if (m.params.name === '__hostEmit') events.push({ src: 'host', ...p });
  } else if (m.method === 'Target.attachedToTarget') {
    const { sessionId, targetInfo, waitingForDebugger } = m.params;
    sessionsFrames.set(sessionId, targetInfo.url);
    events.push({ src: 'step', kind: 'attach', t: now(), type: targetInfo.type, url: String(targetInfo.url).replace(/guest-files\/[^/]+/, 'g').slice(-40), waitingForDebugger });
    void (async () => {
      const note = (what: string) => (e: Error) => { events.push({ src: 'step', kind: 'inject-error', t: now(), what, error: e.message.slice(0, 120) }); };
      try {
        if (targetInfo.type !== 'iframe') return;
        await send('Runtime.addBinding', { name: '__perfEmit' }, sessionId).catch(note('binding'));
        // Every new document in this frame target announces a default execution context; the probe
        // script is evaluated into it (see executionContextCreated below).
        await send('Runtime.enable', {}, sessionId).catch(note('runtime'));
      } finally { if (waitingForDebugger) await send('Runtime.runIfWaitingForDebugger', {}, sessionId).catch(note('resume')); }
    })();
  } else if (m.method === 'Runtime.executionContextCreated' && m.sessionId && m.params.context.auxData?.isDefault) {
    void send('Runtime.evaluate', { expression: FRAME_SCRIPT, contextId: m.params.context.id }, m.sessionId)
      .catch((e: Error) => events.push({ src: 'step', kind: 'inject-error', t: now(), what: 'context', error: e.message.slice(0, 120) }));
  } else if (m.method === 'Target.detachedFromTarget') sessionsFrames.delete(m.params.sessionId);
  else if (m.method === 'Network.requestWillBeSent' && !m.sessionId && m.params.request.url.includes('/service/request')) {
    let path = '?'; try { path = JSON.parse(m.params.request.postData ?? '{}').path; } catch {}
    inflight.set(m.params.requestId, now());
    maxInflight = Math.max(maxInflight, inflight.size);
    events.push({ src: 'net', kind: 'req', t: now(), path, inflight: inflight.size });
  } else if ((m.method === 'Network.loadingFinished' || m.method === 'Network.loadingFailed') && !m.sessionId && inflight.has(m.params.requestId)) {
    const t0 = inflight.get(m.params.requestId)!; inflight.delete(m.params.requestId);
    events.push({ src: 'net', kind: m.method === 'Network.loadingFailed' ? 'fail' : 'done', t: now(), ms: now() - t0 });
  }
};

await send('Runtime.enable');
await send('Runtime.addBinding', { name: '__hostEmit' });
await send('Network.enable', { maxPostDataSize: 4096 });
await send('Performance.enable');
await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
const hostInstall = (await send('Runtime.evaluate', { expression: HOST_SCRIPT, returnByValue: true })).result.value;
// Frames already alive before the probe started were injected via their (re)announced contexts on Runtime.enable.

const evalHost = async (expression: string) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.value;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function click(x: number, y: number) { for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 }); }
async function clickSession(title: string) {
  const xy = await evalHost(`(()=>{const n=[...document.querySelectorAll('nav *, aside *')].find(n=>n.children.length===0&&n.textContent.trim()===${JSON.stringify(title)});if(!n)return null;const r=n.getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2]})()`);
  if (!xy) throw new Error(`session not in sidebar: ${title}`);
  const t0 = now();
  await click(xy[0], xy[1]);
  // When does the HOST's own chrome show the clicked session (title in the top bar, right of the sidebar)?
  for (let i = 0; i < 80; i++) {
    const shown = await evalHost(`[...document.querySelectorAll('body *')].some(n=>n.children.length===0&&n.textContent.trim()===${JSON.stringify(title)}&&(()=>{const r=n.getBoundingClientRect();return r.y<45&&r.x>285&&r.width>0})())`);
    if (shown) { events.push({ src: 'step', kind: 'host-switched', t: now(), ms: now() - t0 }); return; }
    await sleep(25);
  }
  events.push({ src: 'step', kind: 'host-switched', t: now(), ms: null });
}
const barButton = (side: 'left' | 'right') => evalHost(`(()=>{const x=[...document.querySelectorAll('button')].filter(b=>/Agent progress/.test(b.getAttribute('aria-label')||'')).map(b=>({b,r:b.getBoundingClientRect()})).find(x=>${side === 'right' ? 'x.r.x>innerWidth-100' : 'x.r.x<innerWidth/2'});return x?[x.r.x+x.r.width/2,x.r.y+x.r.height/2]:null})()`);
async function metrics(label: string) {
  await send('HeapProfiler.collectGarbage').catch(() => {});
  const m = Object.fromEntries((await send('Performance.getMetrics')).metrics.map((x: { name: string; value: number }) => [x.name, x.value]));
  const frames = await evalHost('window.__hostFrames ? window.__hostFrames() : []');
  const states = [] as unknown[];
  for (const [sid, url] of sessionsFrames) if (/\/ui\/|srcdoc/.test(url)) states.push(await send('Runtime.evaluate', { expression: 'window.__perfState ? window.__perfState() : null', returnByValue: true }, sid).then((r) => r.result.value).catch(() => null));
  events.push({ src: 'step', kind: 'metrics', t: now(), label, heapMB: +(m.JSHeapUsedSize / 1048576).toFixed(2), nodes: m.Nodes, listeners: m.JSEventListeners, documents: m.Documents, frames: m.Frames, taskSec: +m.TaskDuration.toFixed(3), scriptSec: +m.ScriptDuration.toFixed(3), hostFrames: frames, guestStates: states.filter(Boolean) });
}
async function runStep(step: Step, label = '') {
  if ('open' in step) {
    events.push({ src: 'step', kind: 'open', t: now(), target: step.open, label });
    await clickSession(scenario.sessions[step.open]);
    await sleep(step.settle ?? 4000);
  } else if ('idle' in step) {
    events.push({ src: 'step', kind: 'idle-start', t: now(), label: step.label });
    await sleep(step.idle);
    events.push({ src: 'step', kind: 'idle-end', t: now(), label: step.label });
  } else if ('rail' in step) {
    const open = await evalHost(`!![...document.querySelectorAll('iframe')].find(f=>/\\/ui\\/panel\\//.test(f.getAttribute('src')||'')&&f.offsetParent)`);
    if ((step.rail === 'open') !== open) {
      const xy = await barButton('right');
      if (!xy) throw new Error('no right-bar Agent progress button');
      await click(xy[0], xy[1]);
      await sleep(2500);
    }
    events.push({ src: 'step', kind: 'rail', t: now(), state: step.rail });
  } else if ('page' in step) {
    const xy = await barButton('left');
    if (!xy) throw new Error('no Agent progress page entry');
    events.push({ src: 'step', kind: 'page-open', t: now() });
    await click(xy[0], xy[1]);
    await sleep(step.settle ?? 3000);
  } else if ('metrics' in step) await metrics(step.metrics);
  else if ('repeat' in step) for (let i = 0; i < step.repeat; i++) for (const s of step.steps) await runStep(s, `${step.label}#${i}`);
}

const started = now();
await sleep(500);
for (const s of scenario.steps) await runStep(s);
await sleep(300);
ws.close();
const out = { port: portArg, hostInstall, startedAt: started, durationMs: now() - started, maxInflight, events };
writeFileSync(outFile, JSON.stringify(out));
console.log(JSON.stringify({ events: events.length, durationMs: out.durationMs, maxInflight }));
