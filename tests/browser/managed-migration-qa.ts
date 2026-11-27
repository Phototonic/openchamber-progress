// Rendered Setup QA for the step-by-step managed switch and fresh setup. Builds the page guest from current source
// into a disposable folder (tracked bundles are never touched), serves it in a loopback synthetic SDK
// shell whose service replies come from the synthetic step responder (managed-migration-engine.ts),
// and drives a fresh headless Chromium with real CDP pointer/keyboard input. Presentation evidence
// only: NOT the engine, native Windows timing or host proof.
// Usage: node --experimental-strip-types tests/browser/managed-migration-qa.ts --source --artifacts <dir> [--chromium <path>]
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { javascriptLiteral as literal } from '../../shared/javascript-literal.ts';
import type { ManagedStepProgress } from '../../shared/managed-steps.ts';
import { freshEngine, stepEngine, type FreshOptions } from './managed-migration-engine.ts';
import { managedStepFixtures } from '../fixtures/managed-steps.ts';

const arg = (name: string) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const artifacts = arg('--artifacts');
if (!artifacts || !process.argv.includes('--source')) throw new Error('usage: managed-migration-qa.ts --source --artifacts <dir> [--chromium <path>]');
mkdirSync(artifacts, { recursive: true });
function findChromium() {
  const explicit = arg('--chromium') ?? process.env.CHROMIUM_PATH;
  if (explicit) return explicit;
  const cache = join(homedir(), '.cache', 'ms-playwright');
  const builds = existsSync(cache) ? readdirSync(cache).filter(d => /^chromium-\d+$/.test(d)).sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1])) : [];
  for (const b of builds) { const p = join(cache, b, 'chrome-linux64', 'chrome'); if (existsSync(p)) return p; }
  throw new Error('No installed Chromium found; pass --chromium (this driver never downloads one).');
}

mkdirSync('/tmp/opencode', { recursive: true });
const work = mkdtempSync('/tmp/opencode/managed-migration-qa-');
// Source build of the page guest only, with the SDK's own guest bundler.
const built = spawnSync('bun', [resolve('node_modules/@openchamber/sdk/scripts/bundle-guest.ts'), 'ui/page/main.ts', join(work, 'page.js')], { encoding: 'utf8', timeout: 120_000 });
if (built.status !== 0) throw new Error(`source build failed: ${built.stderr.slice(0, 400)}`);

const LIGHT = { background: '#fafafa', elevated: '#ffffff', foreground: '#202124', muted: '#64676e', subtle: '#74777e', border: '#dedfe3', hover: '#f0f1f3', selection: '#e7eefb', focus: '#376bc4', primary: '#316ac3', mutedSurface: '#f3f4f6', elevatedForeground: '#202124', active: '#e7e9ed', selectionForeground: '#173964', primaryForeground: '#ffffff', primaryText: '#24579e', successText: '#237044', warningText: '#855900', errorText: '#ad3030', infoText: '#24579e', success: '#27824d', warning: '#a66c00', error: '#c23d3d', info: '#316ac3', font: 'system-ui, sans-serif', mono: 'monospace', radius: '6px' };
const DARK = { ...LIGHT, background: '#191b20', elevated: '#24272e', foreground: '#e6e8ee', muted: '#a4a9b4', subtle: '#9298a4', border: '#414650', hover: '#343944', selection: '#293d60', focus: '#90b8ff', primary: '#83aff7', mutedSurface: '#24272e', elevatedForeground: '#e6e8ee', active: '#3b4350', selectionForeground: '#e0ebff', primaryForeground: '#10131a', primaryText: '#a6c7ff', successText: '#86dca3', warningText: '#e8c372', errorText: '#ff9e9e', infoText: '#a6c7ff', success: '#6fc58c', warning: '#d9b367', error: '#ee8989', info: '#83aff7' };

const shellScript = `
const light=${JSON.stringify(LIGHT)},dark=${JSON.stringify(DARK)};
window.qa={mode:'light',locale:'en',storage:new Map()};
const frame=()=>document.querySelector('iframe');window.frame=frame;
const send=m=>frame()?.contentWindow?.postMessage({channel:'openchamber.sdk',v:1,...m},'*');
const ready=()=>send({type:'ready',payload:{theme:{mode:qa.mode,tokens:qa.mode==='dark'?dark:light},locale:qa.locale,directory:null,session:null,surface:'page',connection:{connected:true,account:'account-example'},settings:{},item:null}});
qa.load=(locale,mode)=>{qa.locale=locale;qa.mode=mode;const t=mode==='dark'?dark:light;document.body.style.background=t.background;frame().src='/ui/page/index.html?'+Date.now()};
addEventListener('message',async e=>{
 const m=e.data;if(!frame()||e.source!==frame().contentWindow||m.channel!=='openchamber.sdk')return;
 const result=payload=>send({type:'result',id:m.id,ok:true,payload});
 if(m.type==='hello')ready();
 else if(m.type==='workspace-subscribe'){result();const q=m.payload.query;send({type:'workspace',payload:{subscriptionId:m.payload.subscriptionId,snapshot:q.kind==='projects'?{kind:'projects',state:'ready',projects:[]}:q.kind==='worktrees'?{kind:'worktrees',projectId:q.projectId,state:'ready',worktrees:[]}:{kind:'sessions',projectId:q.projectId,state:'ready',coverage:[],sessions:[]}}})}
 else if(m.type==='storage'){const q=m.payload;if(q.op==='set')qa.storage.set(q.key,q.value);if(q.op==='delete')qa.storage.delete(q.key);result({storage:true,op:q.op,found:qa.storage.has(q.key),value:qa.storage.get(q.key),...(q.op==='keys'?{keys:[]}:{})})}
 else if(m.type==='service-request'){try{const r=await fetch('/service',{method:'POST',body:JSON.stringify(m.payload)});const reply=await r.json();if(reply.drop)send({type:'result',id:m.id,ok:false,code:'HOST_TIMEOUT',error:'Fixture reply dropped'});else result(reply)}catch{send({type:'result',id:m.id,ok:false,code:'HOST_UNAVAILABLE',error:'Fixture proxy unavailable'})}}
 else if(m.id)result();
});`;
const shell = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Setup step QA</title><style>html,body{margin:0;height:100%}iframe{display:block;width:100vw;height:100vh;border:0}</style></head><body><script>${shellScript}</script><iframe title="Agent progress"></iframe></body></html>`;

// ---- Synthetic service ----
let engine = stepEngine({ inspectPages: 2 });
let capable = true;
// Fresh setup: no legacy files. The version-2 responder answers only when the service advertises
// managedFreshSteps; old single-request fresh routes refuse like the new Windows service and are
// recorded, because the step client must never use them.
let fresh = false, freshCapable = true;
let freshEng = freshEngine({ inspectPages: 2 });
const oldRoutes: string[] = [];
let captureControl: boolean | null = null;
let freshRefusal: string | null = null;
const log: { method: string; path: string; action?: string; version?: number; at: number }[] = [];
const health = { ok: true, ready: false, sqlite: false, protocolVersion: 2, schemaVersion: 2, runtime: { node: '24.22.0', bun: null }, diagnostics: ['targets-unverified'], state: 'unconfigured' };
function setupRead() {
  if (fresh) {
    const p = freshEng.observeSetup(), done = p?.state === 'complete';
    const published=!!p&&p.plan.findIndex(s=>s.name===p.lastCompleted?.name)>=p.plan.findIndex(s=>s.name==='publish-binding');
    // Coarse status stays conservative for older clients: a fresh journal reads pending/complete.
    return {
      configured: published, verified: published, installed: false, captureEnabled: captureControl ?? (!p ? null : p.capture.state === 'on' ? true : p.capture.state === 'off' ? false : null),
      targets: published ? freshEng.review.targets : null, version: null, activation: 'unknown', separateLifecycle: false, historyRetained: true, diagnostics: [], recovery: null,
      delivery: { kind: 'managed', revision: 1, planKind:'fresh', configuration: published ? 'configured' : 'unconfigured', migration: !p ? 'none' : done ? 'complete' : 'pending', mode: 'unknown', observation: 'unknown', expectedVersion: '1.4.0',
        managedMigrationSteps: 1, ...(freshCapable ? { managedFreshSteps: 1 } : {}), ...(freshCapable && p ? { freshProgress: p } : {}) },
      ...(freshRefusal?{diagnostics:[freshRefusal],captureEnabled:null,
        delivery:{kind:'managed',revision:1,planKind:'fresh',configuration:'invalid',migration:'unavailable',mode:'unknown',observation:'unknown',expectedVersion:null,managedMigrationSteps:1,managedFreshSteps:1}}:{}),
    };
  }
  const p = engine.observeSetup();
  const migration = !p ? 'available' : p.state === 'complete' ? 'complete' : 'pending';
  return {
    configured: false, verified: false, installed: false, captureEnabled: captureControl ?? (!p ? true : p.capture.state === 'on' ? true : p.capture.state === 'off' ? false : null),
    targets: null, version: null, activation: 'unknown', separateLifecycle: false, historyRetained: true, diagnostics: [], recovery: null,
    delivery: { kind: 'managed', revision: 1, configuration: 'unconfigured', migration, mode: 'unknown', observation: 'unknown', expectedVersion: '1.4.0', ...(capable ? { managedMigrationSteps: 1 } : {}), ...(capable && p ? { migrationProgress: p } : {}) },
  };
}
const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  try {
    if (url.pathname === '/') { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(shell); return; }
    if (url.pathname === '/ui/page/index.html') { res.setHeader('content-type', 'text/html'); res.end(readFileSync('ui/page/index.html')); return; }
    if (url.pathname === '/ui/page/main.js') { res.setHeader('content-type', 'text/javascript'); res.end(readFileSync(join(work, 'page.js'))); return; }
    if (url.pathname === '/service' && req.method === 'POST') {
      let body = ''; for await (const part of req) body += part;
      const q = JSON.parse(body) as { method: string; path: string; body?: string };
      const entry: typeof log[number] = { method: q.method, path: q.path, at: Date.now() }; log.push(entry);
      const json = (status: number, value: unknown) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ status, body: JSON.stringify(value) })); };
      if (q.path === '/health') return json(200, health);
      if (q.path === '/v1/setup' && q.method === 'GET') return json(200, setupRead());
      if (q.path === '/v1/capture/disable' || q.path === '/v1/capture/enable') {
        if (q.method !== 'POST' || q.body !== undefined) return json(400, { error: 'body-not-allowed' });
        captureControl = q.path.endsWith('/enable');
        return json(200, { ok: true, captureEnabled: captureControl });
      }
      if (fresh && (q.path === '/v1/setup/managed-inspect' || q.path === '/v1/setup/managed-configure')) {
        oldRoutes.push(q.path);
        return json(409, { error: 'managed-action-required' });
      }
      if (q.path === '/v1/setup/managed-step') {
        if (!capable) return json(404, { error: 'not-found' });
        const sent = JSON.parse(q.body ?? '{}');
        entry.action = sent.action; entry.version = sent.version;
        // Version 2 reaches the fresh responder only when advertised; it records any shape violation.
        if (fresh && sent.version !== 2) oldRoutes.push('version-1-step');
        if (sent.version === 2 && !(fresh && freshCapable)) return json(404, { error: 'not-found' });
        const result = await (sent.version === 2 ? freshEng : engine).request(q.body ?? '{}');
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(result === 'drop' ? { drop: true } : result));
        return;
      }
      if (q.path.startsWith('/v1/setup/managed-')) return json(409, { error: 'managed-action-required' });
      return json(404, { error: 'not-found' });
    }
    res.statusCode = url.pathname === '/favicon.ico' ? 204 : 404; res.end();
  } catch { res.statusCode = 500; res.end('{"error":"fixture-failed"}'); }
});
await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
const port = (server.address() as { port: number }).port;

// ---- Browser ----
const profile = join(work, 'profile');
const browser = spawn(findChromium(), ['--headless=new', '--no-sandbox', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--disable-background-networking', '--disable-sync', '--disable-extensions', '--hide-scrollbars', '--window-size=1280,900', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const results: { id: string; pass: boolean; facts?: unknown }[] = [];
const shots: string[] = [];
const check = (id: string, pass: boolean, facts?: unknown) => { results.push({ id, pass, ...(facts === undefined ? {} : { facts }) }); if (!pass) throw new Error(`${id} failed ${JSON.stringify(facts ?? null).slice(0, 600)}`); };
let ws: WebSocket | undefined;
let exitCode = 0;
try {
  let devtools = '';
  for (const end = Date.now() + 20_000; !devtools; await sleep(50)) { if (Date.now() > end) throw new Error('browser start'); if (existsSync(join(profile, 'DevToolsActivePort'))) devtools = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]; }
  const targets = await (await fetch(`http://127.0.0.1:${devtools}/json/list`)).json() as { type: string; webSocketDebuggerUrl: string }[];
  ws = new WebSocket(targets.find(t => t.type === 'page')!.webSocketDebuggerUrl);
  await new Promise<void>((r, j) => { ws!.onopen = () => r(); ws!.onerror = () => j(new Error('cdp')); });
  let next = 0; const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>(); const exceptions: string[] = [];
  ws.onmessage = e => { const m = JSON.parse(String(e.data)); const p = pending.get(m.id); if (p) { pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); } else if (m.method === 'Runtime.exceptionThrown') exceptions.push(String(m.params.exceptionDetails?.text ?? 'exception')); };
  const send = (method: string, params: object = {}) => new Promise<any>((r, j) => { const id = ++next; pending.set(id, { resolve: r, reject: j }); ws!.send(JSON.stringify({ id, method, params })); });
  const evaluate = async <T = any>(expression: string): Promise<T> => { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(`evaluate: ${r.exceptionDetails.text} ${expression.slice(0, 120)}`); return r.result.value; };
  /** Guest DOM through the same-origin frame: `d` is its document. */
  const guest = <T = any>(body: string) => evaluate<T>(`(()=>{const d=frame().contentDocument;if(!d)return null;${body}})()`);
  const wait = async (cond: string, what: string, ms = 10_000) => { for (const end = Date.now() + ms; ; await sleep(40)) { if (await guest(`return !!(${cond})`).catch(() => false)) return; if (Date.now() > end) throw new Error(`timeout: ${what}`); } };
  const frames = () => evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  const point = (selector: string) => guest<{ x: number; y: number } | null>(`const e=d.querySelector(${literal(selector)});if(!e)return null;e.scrollIntoView({block:'nearest'});const f=frame().getBoundingClientRect(),r=e.getBoundingClientRect();return {x:f.x+r.x+r.width/2,y:f.y+r.y+r.height/2}`);
  const click = async (selector: string) => {
    await wait(`d.querySelector(${literal(selector)})`, `control ${selector}`); await frames();
    const p = await point(selector); if (!p) throw new Error(`no point ${selector}`);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...p });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...p, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...p, button: 'left', clickCount: 1 });
  };
  const key = async (k: string, code = k === ' ' ? 'Space' : k) => { const text = k.length === 1 ? k : k === 'Enter' ? '\r' : undefined; await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: { Enter: 13, Escape: 27, Tab: 9, ' ': 32 }[k] ?? 0, ...(text ? { text } : {}) }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: { Enter: 13, Escape: 27, Tab: 9, ' ': 32 }[k] ?? 0 }); };
  const focused = () => guest<string | null>(`return d.activeElement?.closest('[data-testid]')?.dataset.testid??null`);
  const shot = async (name: string, fromTop = false) => { await guest(fromTop ? `frame().contentWindow.scrollTo(0,0);return true` : `d.querySelector('[data-testid="setup-migration-progress"],[data-testid="setup-review"],[data-testid="setup-migration-capture-review"]')?.scrollIntoView({block:'start'});return true`); await frames(); await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 1 }); const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(artifacts, `${name}.png`), Buffer.from(r.data, 'base64')); shots.push(`${name}.png`); };
  const viewport = async (width: number, height: number) => send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 });
  const releaseShot = async (name: string, width: number) => {
    const bottom = await guest<number>(`return d.querySelector('[data-testid="surface-panel-setup"]').getBoundingClientRect().bottom+frame().contentWindow.scrollY`);
    await viewport(width, Math.max(844, Math.ceil(bottom) + 20));
    await shot(name, true);
  };
  const card = (attr: string) => guest<string | null>(`return d.querySelector('[data-testid="setup-migration-progress"]')?.getAttribute(${literal(attr)})??null`);
  const fits = () => guest<{ ok: boolean; overflow: number; offenders: string[] }>(`const w=d.documentElement.clientWidth,bad=[...d.querySelectorAll('[data-testid="setup-panel"] *')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&(r.right>w+0.5||r.left<-0.5)}).slice(0,5).map(e=>e.dataset.testid||e.className||e.tagName);return {ok:d.scrollingElement.scrollWidth<=w&&!bad.length,overflow:d.scrollingElement.scrollWidth-w,offenders:bad}`);
  const stepCalls = () => log.filter(l => l.path === '/v1/setup/managed-step').length;
  const idle = async (id: string) => { const steps = stepCalls(), setup = log.filter(l => l.path === '/v1/setup').length; await sleep(2500); check(id, stepCalls() === steps && log.filter(l => l.path === '/v1/setup').length === setup, { steps: stepCalls() - steps, setupReads: log.filter(l => l.path === '/v1/setup').length - setup }); };
  async function open(locale: 'en' | 'ru' | 'zh-CN', mode: 'light' | 'dark', width: number, height: number, configure: (e: ReturnType<typeof stepEngine>) => void = () => {}, keep = false) {
    if (!keep) { captureControl = null; engine = stepEngine({ inspectPages: 2 }); configure(engine); log.length = 0; }
    await viewport(width, height);
    await evaluate(`(()=>{try{frame().contentWindow.__stale=true}catch{}return true})()`);
    await evaluate(`qa.load(${literal(locale)},${literal(mode)})`);
    await wait(`!frame().contentWindow.__stale&&d.readyState==='complete'&&d.querySelector('[data-testid="more-trigger"]')`, 'surface menu');
    await click('[data-testid="more-trigger"]');
    await click('[data-testid="more-setup"]');
    await wait(`!frame().contentWindow.__stale&&d.readyState==='complete'&&d.querySelector('[data-testid="setup-panel"][data-steps="1"],[data-testid="setup-panel"][data-phase]')`, 'setup panel');
    await watchAlerts();
  }
  // Records every inserted role=alert by its owning hook, to prove one announcement per new warning/failure.
  const watchAlerts = () => guest(`const win=frame().contentWindow;win.__alerts=[];new win.MutationObserver(ms=>{for(const m of ms)for(const n of m.addedNodes){if(!n.querySelectorAll)continue;for(const x of [n,...n.querySelectorAll('[role="alert"]')])if(x.getAttribute&&x.getAttribute('role')==='alert')win.__alerts.push(x.closest('[data-testid]')?.dataset.testid??'?')}}).observe(d.body,{subtree:true,childList:true});return true`);
  const alerts = (hook: string) => guest<number>(`return frame().contentWindow.__alerts.filter(a=>a===${literal(hook)}).length`);
  const startSwitch = async () => {
    await click('[data-testid="setup-migrate"] button');
    await wait(`d.querySelector('[data-testid="setup-review"]')`, 'begin review');
  };
  const confirmByKeyboard = async () => {
    // Space toggles the acknowledgement; Enter on Confirm submits (docs/ui.md Setup keyboard contract).
    await guest(`d.querySelector('[data-testid="setup-ack"] [role="checkbox"],[data-testid="setup-ack"] input')?.focus();return true`);
    await key(' ');
    await wait(`d.querySelector('[data-testid="setup-confirm"] button')?.getAttribute('aria-disabled')==='false'`, 'confirm enabled');
    await guest(`d.querySelector('[data-testid="setup-confirm"] button').focus();return true`);
    await key('Enter');
  };

  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await send('Page.navigate', { url: `http://127.0.0.1:${port}/` });
  for (const end = Date.now() + 10_000; await evaluate('document.readyState') !== 'complete'; await sleep(50)) if (Date.now() > end) throw new Error('shell load');

  // 1. Success, EN desktop light: inspection pages → consent → running (capture off warning) → complete.
  await open('en', 'light', 1280, 900);
  check('negotiated:no-step-request-on-open', stepCalls() === 0);
  await startSwitch();
  check('success:inspection-paged', log.filter(l => l.action === 'inspect').length === 2);
  check('success:review-focus-cancel', await focused() === 'setup-cancel', await focused());
  await shot('review-en');
  const release = engine.hold(8); // inspect×2, begin, expectation, disable, remove-discovery 0..2 → hold the third removal
  await confirmByKeyboard();
  await wait(`d.querySelector('[data-testid="setup-migration-progress"][data-driving="true"][data-step="remove-discovery"][data-batch="2"]')`, 'running at a removal step');
  check('running:focus-on-pause', await focused() === 'setup-migration-pause', await focused());
  check('running:honest-step-text', await guest(`return d.querySelector('[data-testid="setup-migration-step"]').textContent`) === 'Step 5 of 9: Removing old plugin files (part 3)');
  check('running:capture-off-warning', await guest(`const w=d.querySelector('[data-testid="setup-migration-capture-warning"]');return !!w&&w.dataset.capture==='off'&&w.checkVisibility()`));
  check('running:no-percentage', await guest(`return !/%/.test(d.querySelector('[data-testid="setup-migration-progress"]').textContent)&&!d.querySelector('[data-testid="setup-migration-progress"] progress,[data-testid="setup-migration-progress"] [role="progressbar"]')`));
  check('running:one-request-in-flight', engine.maxInflight() === 1);
  await shot('progress');
  release();
  await wait(`d.querySelector('[data-testid="setup-migration-progress"][data-state="complete"]')`, 'complete');
  check('complete:no-warning', await guest(`return !d.querySelector('[data-testid="setup-migration-capture-warning"]')`));
  check('complete:all-steps-once', JSON.stringify(log.filter(l => l.action === 'advance').length) === String(engine.plan.length - 1));
  await shot('complete-en');
  await idle('complete:no-polling-or-continuation');

  // A real visibility event must retire without relying on a hidden-frame paint.
  await open('en','light',1280,900);
  await startSwitch();const heldVisible=engine.hold(4);await confirmByKeyboard();
  await wait(`d.querySelector('[data-testid="setup-migration-progress"][data-driving="true"][data-step="expectation"]')`,'held expectation');
  await guest(`Object.defineProperty(d,'visibilityState',{configurable:true,value:'hidden'});d.dispatchEvent(new Event('visibilitychange'));Object.defineProperty(d,'visibilityState',{configurable:true,value:'visible'});d.dispatchEvent(new Event('visibilitychange'));return true`);
  heldVisible();
  await wait(`d.querySelector('[data-testid="setup-migration-continue"]')`,'reopened explicit Continue');
  check('hide-show:held-reply-retired',engine.requests.filter(r=>r.action==='advance').length===1 && engine.progress?.capture.state==='on');
  await shot('hide-show-continue');
  await click('[data-testid="setup-migration-continue"] button');
  await wait(`d.querySelector('[data-testid="setup-migration-progress"][data-state="complete"]')`,'explicit Continue completes');
  check('hide-show:explicit-continue-finishes',engine.progress?.state==='complete');

  // Shell close is presentation retirement, not a pause/cancel of the operation in flight.
  for (const close of ['Back', 'Escape']) {
    await open('en', 'light', close === 'Escape' ? 390 : 1280, 900);
    await startSwitch(); const releaseClosed = engine.hold(5); await confirmByKeyboard();
    await wait(`d.querySelector('[data-testid="setup-migration-progress"][data-driving="true"][data-step="disable"]')`, 'held disable before panel close');
    const sentBefore = stepCalls();
    if (close === 'Back') await click('[data-testid="surface-panel-back"] button');
    else await key('Escape');
    await wait(`!d.querySelector('[data-testid="surface-panel-setup"]')`, `${close} closes Setup`);
    check(`panel-${close}:focus-returns-to-more`, await focused() === 'more-trigger', await focused());
    releaseClosed();
    for (const end = Date.now() + 10_000; engine.progress?.step?.name !== 'remove-discovery'; await sleep(40)) {
      if (Date.now() > end) throw new Error('held operation did not settle after panel close');
    }
    await frames();
    check(`panel-${close}:operation-settles-without-control-request`, engine.progress?.capture.state === 'off' && stepCalls() === sentBefore);
    await idle(`panel-${close}:no-unattended-continuation`);
    await click('[data-testid="more-trigger"]');
    await click('[data-testid="more-setup"]');
    await wait(`d.querySelector('[data-testid="setup-migration-progress"][data-step="remove-discovery"][data-capture="off"][data-driving="false"]')&&d.querySelector('[data-testid="setup-migration-continue"]')`, 'reopened current durable state');
    check(`panel-${close}:reopen-is-read-only`, stepCalls() === sentBefore);
    await shot(`panel-${close.toLowerCase()}-reopened`);
    await click('[data-testid="setup-migration-continue"] button');
    await wait(`d.querySelector('[data-testid="setup-migration-progress"][data-state="complete"]')`, 'explicit continuation after panel reopen');
    check(`panel-${close}:explicit-continue-finishes`, engine.progress?.state === 'complete');
  }

  // 2. Failure at a middle step, RU phone light: fixed stage/code, actionable text, Resume focused.
  await open('ru', 'light', 390, 844, e => e.faults.fail.add('remove-discovery:2'));
  await startSwitch(); await confirmByKeyboard();
  await wait(`d.querySelector('[data-testid="setup-migration-failure"]')`, 'failure');
  const failure = await guest(`const f=d.querySelector('[data-testid="setup-migration-failure"]');return {stage:f.dataset.stage,code:f.dataset.code,text:f.textContent,role:f.getAttribute('role')}`);
  check('failure:stage-code', failure.stage === 'remove-discovery' && failure.code === 'managed-step-deadline' && failure.text.includes('Удаление старых файлов плагина · managed-step-deadline'), failure);
  check('failure:announced-once', await alerts('setup-migration-failure') === 1, { failure: await alerts('setup-migration-failure'), role: failure.role });
  check('failure:capture-unknown-warning', await card('data-capture') === 'unknown' && await guest(`return d.querySelector('[data-testid="setup-migration-capture-warning"]').textContent.includes('Запись, возможно, выключена')`));
  check('failure:focus-on-resume', await focused() === 'setup-migration-resume', await focused());
  check('failure:no-retry', log.filter(l => l.action === 'advance').length === 5);
  const phone = await fits(); check('failure:fits-390', phone.ok, phone);
  await shot('failure-ru');
  await idle('failure:no-polling');
  const failureResumeAt=engine.requests.length;
  await click('[data-testid="setup-migration-resume"] button');
  await wait(`d.querySelector('[data-testid="setup-migration-progress"][data-state="complete"]')`, 'failure resumed to completion');
  check('failure:resume-reconciles-unsettled-intent', engine.requests.slice(failureResumeAt,failureResumeAt+2).map(r=>r.action).join()==='resume,advance');

  // 3. Pause after capture off, EN phone dark: confirmation (Keep going focused, Escape returns), then paused.
  await open('en', 'dark', 390, 844);
  await startSwitch();
  let hold = engine.hold(7);
  await confirmByKeyboard();
  await wait(`d.querySelector('[data-testid="setup-migration-progress"][data-driving="true"][data-step="remove-discovery"][data-batch="1"]')`, 'running removal 2');
  await click('[data-testid="setup-migration-pause"] button');
  await wait(`d.querySelector('[data-testid="setup-migration-confirm-pause"]')`, 'pause confirmation');
  check('pause:cancel-owns-focus', await focused() === 'setup-migration-cancel', await focused());
  await key('Escape');
  await wait(`!d.querySelector('[data-testid="setup-migration-confirm-pause"]')`, 'escape closes');
  check('pause:escape-returns-focus', await focused() === 'setup-migration-pause', await focused());
  await click('[data-testid="setup-migration-pause"] button');
  await wait(`d.querySelector('[data-testid="setup-migration-confirm-pause"]')`, 'pause confirmation again');
  await shot('pause-confirm-dark');
  await click('[data-testid="setup-migration-confirm"] button');
  check('pause:waits-for-step', await guest(`return d.querySelector('[data-testid="setup-migration-pause"] button')?.getAttribute('aria-disabled')==='true'`));
  hold();
  await wait(`d.querySelector('[data-testid="setup-migration-progress"][data-state="paused"]')`, 'paused');
  const actions = log.filter(l => l.path === '/v1/setup/managed-step').slice(-2).map(l => l.action);
  check('pause:after-settle', JSON.stringify(actions) === '["advance","pause"]', actions);
  check('paused:off-warning', await card('data-capture') === 'off' && await guest(`return d.querySelector('[data-testid="setup-migration-capture-warning"]').checkVisibility()`));
  check('paused:resume-focused', await focused() === 'setup-migration-resume', await focused());
  check('paused:distinct-from-pending', await guest(`return d.querySelector('[data-testid="setup-migration-heading"]').textContent`) === 'Move paused');
  check('paused:warning-announced-once', await alerts('setup-migration-capture-warning') === 1, await alerts('setup-migration-capture-warning'));
  check('paused:fits-390', (await fits()).ok, await fits());
  await shot('paused-off');
  await idle('paused:no-polling');
  await click('[data-testid="setup-migration-resume"] button');
  await wait(`d.querySelector('[data-testid="setup-migration-progress"][data-state="complete"]')`, 'paused journey complete');
  check('paused:resume-completes',engine.progress?.state==='complete');

  // 4. Close the view mid-step, then a service restart: retained progress, nothing sent until Resume.
  await open('en', 'dark', 390, 844);
  await startSwitch();
  engine.faults.crash.add('remove-discovery:1');
  hold = engine.hold(7);
  await confirmByKeyboard();
  await wait(`d.querySelector('[data-testid="setup-migration-progress"][data-driving="true"][data-batch="1"]')`, 'running before close');
  const sent = stepCalls();
  await open('en', 'dark', 390, 844, undefined, true); // reloading the frame closes the view mid-step
  hold(); await sleep(400);
  check('close:no-unattended-continuation', stepCalls() === sent, { sent, now: stepCalls() });
  engine.restart();
  const before = stepCalls();
  await open('en', 'dark', 390, 844, undefined, true);
  await wait(`d.querySelector('[data-testid="setup-migration-progress"][data-state="running"]')`, 'reopened interrupted');
  check('restart:no-step-request-on-reopen', stepCalls() === before);
  check('restart:interrupted-unknown', await guest(`return d.querySelector('[data-testid="setup-migration-heading"]').textContent`) === 'Move interrupted' && await card('data-capture') === 'unknown');
  await shot('restart-reopened');
  await click('[data-testid="setup-migration-resume"] button');
  await wait(`d.querySelector('[data-testid="setup-migration-progress"][data-state="complete"]')`, 'complete after resume');
  check('restart:resume-then-reconcile', log.filter(l => l.path === '/v1/setup/managed-step').slice(before, before + 2).map(l => l.action).join() === 'resume,advance');

  // 5. Reviewed resume, RU desktop dark: fresh review of the exact capture decision.
  await open('ru', 'dark', 1280, 900, e => { e.faults.unsettledEnable = true; });
  await startSwitch(); await confirmByKeyboard();
  await wait(`d.querySelector('[data-testid="setup-migration-review-capture"]')`, 'review needed');
  check('review:needs-decision', await card('data-recovery') === 'review' && await guest(`return d.querySelector('[data-testid="setup-migration-failure"]').dataset.code`) === 'managed-step-unsettled');
  await shot('review-needed-ru-dark');
  await click('[data-testid="setup-migration-review-capture"] button');
  await wait(`d.querySelector('[data-testid="setup-migration-capture-review"]')`, 'capture review card');
  check('review:focus-cancel', await focused() === 'setup-cancel', await focused());
  await shot('capture-review-ru-dark');
  await confirmByKeyboard();
  await wait(`d.querySelector('[data-testid="setup-migration-progress"][data-state="complete"]')`, 'complete after review');
  const resumeBody = engine.requests.find(r => r.action === 'resume');
  check('review:reviewed-resume-payload', !!resumeBody && 'review' in resumeBody && resumeBody.review?.step === 'enable', resumeBody);
  const reviewAt=engine.requests.findIndex(r=>r.action==='resume');
  check('review:resume-then-reconciling-advance',engine.requests[reviewAt+1]?.action==='advance'&&engine.progress?.state==='complete');

  // 6. Stop (abandon) after a failure, EN phone light; then a dropped reply with Check status.
  await open('en', 'light', 390, 844, e => e.faults.fail.add('remove-discovery:0'));
  await startSwitch(); await confirmByKeyboard();
  await wait(`d.querySelector('[data-testid="setup-migration-abandon"]')`, 'stop available');
  await click('[data-testid="setup-migration-abandon"] button');
  await wait(`d.querySelector('[data-testid="setup-migration-confirm-abandon"]')`, 'stop confirmation');
  await shot('abandon-confirm');
  await click('[data-testid="setup-migration-confirm"] button');
  await wait(`d.querySelector('[data-testid="setup-migration-progress"][data-state="abandoned"]')`, 'abandoned');
  check('abandon:warning-kept', await card('data-capture') === 'unknown' && await guest(`return !!d.querySelector('[data-testid="setup-migration-capture-warning"]')&&!!d.querySelector('[data-testid="setup-migration-resume"]')`));
  await shot('abandoned');
  await click('[data-testid="setup-migration-resume"] button');
  await wait(`d.querySelector('[data-testid="setup-migration-progress"][data-state="complete"]')`, 'abandoned journey complete');
  check('abandon:explicit-resume-completes',engine.progress?.state==='complete');
  // Lost before reaching the service: effect unknown to Setup, so only Check status is offered.
  await open('en', 'light', 390, 844, e => e.faults.lose.add('disable:0'));
  await startSwitch(); await confirmByKeyboard();
  await wait(`d.querySelector('[data-testid="setup-migration-failure"][data-code="managed-step-no-reply"]')`, 'dropped reply');
  check('dropped:status-only', await guest(`return !!d.querySelector('[data-testid="setup-migration-status"]')&&!d.querySelector('[data-testid="setup-migration-continue"],[data-testid="setup-migration-resume"]')`));
  check('dropped:focus-on-status', await focused() === 'setup-migration-status', await focused());
  check('dropped:no-repeat', log.filter(l => l.action === 'advance').length === 2);
  await shot('dropped-en');
  await idle('dropped:no-polling');
  await click('[data-testid="setup-migration-status"] button');
  await wait(`d.querySelector('[data-testid="setup-migration-continue"] button')?.getAttribute('aria-disabled')==='false'`, 'status observed');
  check('dropped:status-observed-same-step', await card('data-step') === 'disable' && log.filter(l => l.action === 'status').length === 1, { step: await card('data-step'), capture: await card('data-capture'), status: log.filter(l => l.action === 'status').length });
  await click('[data-testid="setup-migration-continue"] button');
  await wait(`d.querySelector('[data-testid="setup-migration-progress"][data-state="complete"]')`, 'request lost before service recovered');
  check('dropped:explicit-continue-completes',engine.progress?.state==='complete');
  // Lost after the effect: the one existing status re-read shows the durable step; nothing repeats.
  await open('en', 'light', 390, 844, e => e.faults.drop.add('disable:0'));
  await startSwitch(); await confirmByKeyboard();
  await wait(`d.querySelector('[data-testid="setup-migration-continue"]')&&d.querySelector('[data-testid="setup-migration-progress"][data-step="remove-discovery"]')`, 'durable step after lost reply');
  check('dropped-after-effect:refresh-shows-durable-step', await card('data-capture') === 'off' && log.filter(l => l.action === 'advance').length === 2 && !log.some(l => l.action === 'status'));
  await click('[data-testid="setup-migration-continue"] button');
  await wait(`d.querySelector('[data-testid="setup-migration-progress"][data-state="complete"]')`, 'lost effect reply recovered');
  check('dropped-after-effect:no-second-disable',engine.requests.filter(r=>r.action==='advance'&&r.step.name==='disable').length===1);

  // A failed settlement leaves running intent; a fenced pause retains that same
  // uncertainty. Both must send the reconciling advance after explicit Resume.
  await open('en','light',390,844,e=>e.faults.settlement.add('remove-discovery:0'));
  await startSwitch();await confirmByKeyboard();
  await wait(`d.querySelector('[data-testid="setup-migration-progress"][data-state="running"][data-driving="false"]')`,'failed settlement');
  await shot('settlement-interrupted');
  const settlementAt=engine.requests.length;
  await click('[data-testid="setup-migration-resume"] button');
  await wait(`d.querySelector('[data-testid="setup-migration-progress"][data-state="complete"]')`,'settlement resumed');
  check('settlement:resume-then-advance',engine.requests.slice(settlementAt,settlementAt+2).map(r=>r.action).join()==='resume,advance');
  await open('ru','dark',390,844,e=>{e.progress=managedStepFixtures().replies.pausedRunning.progress;});
  await wait(`d.querySelector('[data-testid="setup-migration-progress"][data-state="paused"]')`,'fenced pause with intent');
  check('fenced-pause:unsettled-retained',engine.progress?.worker==='unsettled');
  await shot('fenced-paused-ru');
  await click('[data-testid="setup-migration-resume"] button');
  await wait(`d.querySelector('[data-testid="setup-migration-progress"][data-state="complete"]')`,'fenced pause resumed');
  check('fenced-pause:resume-then-advance',engine.requests.slice(0,2).map(r=>r.action).join()==='resume,advance');

  // 7. Port contention and replayed failure retain fixed recovery copy, not success.
  await open('en', 'light', 1280, 900, e => { e.faults.portBusy = true; });
  await click('[data-testid="setup-migrate"] button');
  await wait(`d.querySelector('[data-testid="setup-migration-failure"][data-code="managed-step-port-busy"]')`, 'port occupied');
  check('port-busy:recovery-copy', await guest(`return d.querySelector('[data-testid="setup-migration-failure"]').textContent.includes('Another program is using the coordination port. Close it and retry.')`));
  check('port-busy:no-mutation', engine.requests.length === 1 && engine.requests[0].action === 'inspect' && !engine.progress);
  await shot('port-busy-en');
  await open('ru', 'dark', 390, 844, e => e.faults.failedReplay.add('remove-discovery:0'));
  await startSwitch(); await confirmByKeyboard();
  await wait(`d.querySelector('[data-testid="setup-migration-failure"][data-code="managed-step-deadline"]')`, 'failed replay');
  check('failed-replay:failed-not-applied', await card('data-state') === 'failed' && await guest(`return d.querySelector('[data-testid="setup-migration-heading"]').textContent`) === 'Шаг перехода не выполнен');
  check('failed-replay:stopped', log.filter(l => l.action === 'advance').length === 3 && await focused() === 'setup-migration-resume');
  check('failed-replay:fits-390', (await fits()).ok, await fits());
  await shot('failed-replay-ru');
  await idle('failed-replay:no-automatic-retry');

  // Chinese step diagnostics on the same synthetic Windows-setup protocol, at phone width.
  await open('zh-CN', 'light', 390, 844, e => e.faults.fail.add('remove-discovery:2'));
  await startSwitch(); await confirmByKeyboard();
  await wait(`d.querySelector('[data-testid="setup-migration-failure"]')`, 'Chinese step failure');
  check('failure:chinese-diagnostic', await guest(`return d.querySelector('[data-testid="setup-migration-failure"]').textContent.includes('此步骤已超时，可能已部分完成。')`));
  check('failure:chinese-fits-390', (await fits()).ok, await fits());
  await shot('failure-zh-CN');

  // 8. Fresh setup (no legacy files) on a fresh-capable service: the same step driver and card over
  // wire version 2, never the old single-request fresh routes. Phone width in EN/RU/zh-CN, retained
  // reconnection, capability mismatch, then desktop keyboard use.
  fresh = true;
  let freshViolations = 0;
  const openFresh = async (locale: 'en' | 'ru' | 'zh-CN', mode: 'light' | 'dark', width: number, height: number, options: FreshOptions = {}, configure: (e: ReturnType<typeof freshEngine>) => void = () => {}) => {
    freshViolations += freshEng.violations.length;
    captureControl = null; freshRefusal=null; freshEng = freshEngine({ inspectPages: 2, ...options }); configure(freshEng); log.length = 0;
    await open(locale, mode, width, height, undefined, true);
  };
  const freshPosts = () => log.filter(l => l.method === 'POST');
  const freshCard = (attr: string) => card(attr);
  const startFresh = async () => {
    await click('[data-testid="setup-inspect"] button');
    await wait(`d.querySelector('[data-testid="setup-review"][data-action="managed-fresh"]')`, 'fresh review');
  };
  /** Text that is cut off inside the Setup panel: overflowing buttons, or hidden/ellipsis overflow on text. */
  const clipped = () => guest<{ ok: boolean; offenders: string[] }>(`const win=frame().contentWindow;const bad=[...d.querySelectorAll('[data-testid="setup-panel"] *')].filter(e=>{const r=e.getBoundingClientRect();if(r.width<=2||r.height<=2||!e.checkVisibility())return false;const cs=win.getComputedStyle(e);const text=[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim());const cut=/(hidden|clip)/.test(cs.overflowX)||cs.textOverflow==='ellipsis';return (e.tagName==='BUTTON'||(text&&cut))&&e.scrollWidth>e.clientWidth+1}).slice(0,5).map(e=>e.closest('[data-testid]')?.dataset.testid||e.className||e.tagName);return {ok:!bad.length,offenders:bad}`);
  const fitsAll = async () => { const a = await fits(), b = await clipped(); return { ok: a.ok && b.ok, overflow: a.overflow, offenders: a.offenders, clipped: b.offenders }; };
  const FRESH = {
    en: { step: 'Step 1 of 4: Create a private progress folder', paused: 'Setup paused', complete: 'Setup finished', partial: 'Setup kept the partial folder.' },
    ru: { step: 'Шаг 1 из 4: Создать приватную папку прогресса', paused: 'Настройка приостановлена', complete: 'Настройка завершена', partial: 'Настройка сохранила частично созданную папку.' },
    'zh-CN': { step: '第 1 步，共 4 步：创建私有进度文件夹', paused: '设置已暂停', complete: '设置已完成', partial: '设置已保留未完成的文件夹' },
  } as const;
  const pauseHeld = async (release: () => void) => {
    await click('[data-testid="setup-migration-pause"] button');
    await wait(`d.querySelector('[data-testid="setup-migration-confirm-pause"]')`, 'fresh pause confirmation');
    await click('[data-testid="setup-migration-confirm"] button');
    release();
    await wait(`d.querySelector('[data-testid="setup-migration-progress"][data-state="paused"]')`, 'fresh paused');
  };
  const waitComplete = (what: string) => wait(`d.querySelector('[data-testid="setup-migration-progress"][data-family="fresh"][data-state="complete"]')`, what);
  const leadBeforeDetails = (action: string) => guest<boolean>(`const q=h=>d.querySelector('[data-testid="'+h+'"]');
    const heading=q('setup-migration-heading'),warning=q('setup-migration-capture-warning'),button=q(${literal(action)}),details=q('setup-details');
    return heading.checkVisibility()&&warning.checkVisibility()&&button.checkVisibility()&&!!(heading.compareDocumentPosition(warning)&4)&&
      !!(warning.compareDocumentPosition(button)&4)&&!!(button.compareDocumentPosition(details)&4)&&
      !q('setup-recording-state')&&!q('managed-capture-control')&&!details.open&&
      ['setup-fresh-plan','managed-load-observation','setup-disclosure'].every(h=>details.contains(q(h))&&!q(h).checkVisibility())`);

  for (const [L, mode] of [['en', 'light'], ['ru', 'dark'], ['zh-CN', 'light']] as const) {
    // Review → running creation → pause after the store exists (capture off) → resume → complete.
    await openFresh(L, mode, 390, 844);
    check(`fresh-${L}:opening-is-read-only`, freshPosts().length === 0);
    await startFresh();
    check(`fresh-${L}:review-uses-version-2-inspection-only`, freshPosts().length === 2 && freshPosts().every(l => l.path === '/v1/setup/managed-step' && l.version === 2 && l.action === 'inspect'), freshPosts());
    check(`fresh-${L}:review-focus-cancel`, await focused() === 'setup-cancel', await focused());
    check(`fresh-${L}:review-shows-frozen-plan`, await guest(`return [...d.querySelectorAll('[data-testid="setup-fresh-plan"] li')].map(li=>li.dataset.testid.replace('setup-fresh-plan-','')).join()`) === freshEng.plan.map(s => s.name).join());
    check(`fresh-${L}:review-four-groups-one-closed-disclosure`, await guest(`return d.querySelectorAll('[data-testid="setup-fresh-groups"] li').length===4&&d.querySelectorAll('[data-testid="setup-review"] details').length===1&&!d.querySelector('[data-testid="setup-changes"]').open`));
    check(`fresh-${L}:review-start-refuses-without-consent`, await guest(`return d.querySelector('[data-testid="setup-confirm"] button').getAttribute('aria-disabled')==='true'`));
    await guest(`d.querySelector('[data-testid="setup-changes-summary"]').focus();return true`); await key('Enter');
    check(`fresh-${L}:disclosure-keyboard-before-consent`, await guest(`return d.querySelector('[data-testid="setup-changes"]').open&&d.querySelector('[data-testid="setup-fresh-facts"]').checkVisibility()`));
    check(`fresh-${L}:disclosure-fits-390`, (await fitsAll()).ok, await fitsAll());
    await shot(`fresh-review-details-${L}`);
    await key('Enter');
    check(`fresh-${L}:review-fits-390`, (await fitsAll()).ok, await fitsAll());
    await shot(`fresh-review-${L}`);
    let release = freshEng.hold(5); // inspect×2, begin, store-directory, then hold create-store
    await confirmByKeyboard();
    await wait(`d.querySelector('[data-testid="setup-migration-progress"][data-family="fresh"][data-driving="true"][data-step="create-store"]')`, 'running creation');
    check(`fresh-${L}:running-focus-on-pause`, await focused() === 'setup-migration-pause', await focused());
    check(`fresh-${L}:running-step-of-own-plan`, await guest(`return d.querySelector('[data-testid="setup-migration-step"]').textContent`) === FRESH[L].step, await guest(`return d.querySelector('[data-testid="setup-migration-step"]').textContent`));
    check(`fresh-${L}:running-plain-recording-before-store`, await guest(`return !d.querySelector('[data-testid="setup-migration-capture-warning"]')&&d.querySelector('[data-testid="setup-recording-state"]').checkVisibility()`));
    check(`fresh-${L}:running-current-group`, await guest(`return d.querySelector('[data-testid="setup-fresh-group-folder"]').dataset.state==='running'&&d.querySelector('[data-testid="setup-fresh-group-folder"]').getAttribute('aria-current')==='step'`));
    check(`fresh-${L}:running-no-percentage`, await guest(`return !/%/.test(d.querySelector('[data-testid="setup-migration-progress"]').textContent)&&!d.querySelector('[data-testid="setup-migration-progress"] progress,[data-testid="setup-migration-progress"] [role="progressbar"]')`));
    check(`fresh-${L}:running-fits-390`, (await fitsAll()).ok, await fitsAll());
    await shot(`fresh-running-${L}`);
    await pauseHeld(release);
    check(`fresh-${L}:pause-after-settle`, freshPosts().slice(-2).map(l => `${l.version}:${l.action}`).join() === '2:advance,2:pause', freshPosts().slice(-2));
    check(`fresh-${L}:paused-off-after-creation`, await freshCard('data-capture') === 'off' && await guest(`return d.querySelector('[data-testid="setup-migration-capture-warning"]').checkVisibility()`));
    check(`fresh-${L}:paused-title`, await guest(`return d.querySelector('[data-testid="setup-migration-heading"]').textContent`) === FRESH[L].paused);
    check(`fresh-${L}:paused-resume-focused`, await focused() === 'setup-migration-resume', await focused());
    // Unknown while creating, then off once the store exists: each new warning is announced once.
    check(`fresh-${L}:warnings-announced-once-per-recording-state`, await alerts('setup-migration-capture-warning') === 2, await alerts('setup-migration-capture-warning'));
    check(`fresh-${L}:paused-group-not-complete`, await guest(`return d.querySelector('[data-testid="setup-fresh-group-folder"]').dataset.state==='complete'&&d.querySelector('[data-testid="setup-fresh-group-connect"]').dataset.state==='paused'`));
    check(`fresh-${L}:paused-fits-390`, (await fitsAll()).ok, await fitsAll());
    await shot(`fresh-paused-off-${L}`);
    if (L === 'en') await idle('fresh-paused:no-polling');
    await click('[data-testid="setup-migration-resume"] button');
    await waitComplete('fresh resumed to completion');
    check(`fresh-${L}:complete-each-step-once`, freshEng.requests.filter(r => r.action === 'advance').length === freshEng.plan.length - 1 && freshEng.progress?.capture.state === 'on');
    check(`fresh-${L}:complete-no-warning`, await guest(`return !d.querySelector('[data-testid="setup-migration-capture-warning"]')`) && await guest(`return d.querySelector('[data-testid="setup-migration-heading"]').textContent`) === FRESH[L].complete);
    check(`fresh-${L}:complete-groups-durable`, await guest(`return [...d.querySelectorAll('[data-testid="setup-fresh-groups"] li')].every(li=>li.dataset.state==='complete')`));
    await wait(`d.querySelector('[data-testid="setup-panel"][data-phase="configured"]')`, 'fresh configured status');
    check(`fresh-${L}:complete-fits-390`, (await fitsAll()).ok, await fitsAll());
    await shot(`fresh-complete-${L}`);
    freshEng.restart(); // cold completion cannot reuse a historical recording bit
    await open(L, mode, 390, 844, undefined, true);
    await wait(`d.querySelector('[data-testid="setup-migration-progress"][data-state="complete"][data-capture="unknown"]')`, 'complete with unknown recording');
    check(`fresh-${L}:complete-unknown-warning-and-recovery`, await guest(`return d.querySelector('[data-testid="setup-migration-capture-warning"]').checkVisibility()&&!!d.querySelector('[data-testid="setup-migration-status"] button')`));
    check(`fresh-${L}:complete-unknown-leads-before-details`, await leadBeforeDetails('setup-migration-status'));
    await guest(`d.querySelector('[data-testid="setup-migration-status"] button').focus();return true`); await key('Enter');
    await wait(`d.querySelector('[data-testid="setup-migration-status"] button')?.getAttribute('aria-disabled')==='false'`, 'completed recording status checked');
    check(`fresh-${L}:complete-recovery-read-only`, freshEng.requests.at(-1)?.action === 'status');
    check(`fresh-${L}:complete-unknown-fits-390`, (await fitsAll()).ok, await fitsAll());
    await shot(`fresh-complete-unknown-${L}`);

    // Failure while creating the store: fixed stage/code, kept-files note, Resume recovers.
    await openFresh(L, mode, 390, 844, {}, e => e.faults.fail.add('create-store:0'));
    await startFresh(); await confirmByKeyboard();
    await wait(`d.querySelector('[data-testid="setup-migration-failure"]')`, 'fresh failure');
    const failed = await guest(`const f=d.querySelector('[data-testid="setup-migration-failure"]');return {stage:f.dataset.stage,code:f.dataset.code,partial:d.querySelector('[data-testid="setup-fresh-partial"]')?.textContent??''}`);
    check(`fresh-${L}:failure-stage-code`, failed.stage === 'create-store' && failed.code === 'managed-step-deadline' && failed.partial.includes(FRESH[L].partial), failed);
    check(`fresh-${L}:failure-group-not-complete`, await guest(`return d.querySelector('[data-testid="setup-fresh-group-folder"]').dataset.state==='failed'`));
    check(`fresh-${L}:failure-announced-once`, await alerts('setup-migration-failure') === 1, await alerts('setup-migration-failure'));
    check(`fresh-${L}:failure-focus-on-resume`, await focused() === 'setup-migration-resume', await focused());
    check(`fresh-${L}:failure-no-retry`, freshEng.requests.filter(r => r.action === 'advance').length === 2);
    check(`fresh-${L}:failure-fits-390`, (await fitsAll()).ok, await fitsAll());
    await shot(`fresh-failure-${L}`);
    const resumeAt = freshEng.requests.length;
    await click('[data-testid="setup-migration-resume"] button');
    await waitComplete('fresh failure recovered');
    check(`fresh-${L}:recovery-resume-then-reconciling-advance`, freshEng.requests.slice(resumeAt, resumeAt + 2).map(r => r.action === 'advance' ? `advance:${r.step.name}` : r.action).join() === 'resume,advance:create-store');
    await shot(`fresh-recovered-${L}`);

    // Paused before any store exists: capture is unknown, not off.
    await openFresh(L, mode, 390, 844);
    await startFresh(); release = freshEng.hold(4);
    await confirmByKeyboard();
    await wait(`d.querySelector('[data-testid="setup-migration-progress"][data-driving="true"][data-step="store-directory"]')`, 'running folder creation');
    await pauseHeld(release);
    check(`fresh-${L}:paused-unknown-before-store`, await freshCard('data-capture') === 'unknown' && await guest(`const w=d.querySelector('[data-testid="setup-migration-capture-warning"]');return w.dataset.capture==='unknown'&&w.checkVisibility()`));
    check(`fresh-${L}:paused-unknown-fits-390`, (await fitsAll()).ok, await fitsAll());
    await shot(`fresh-paused-unknown-${L}`);
    // A refusal from ordinary status overrides even this frame's cached Resume
    // card. There is no inferred operation authority in the presentation hint.
    freshRefusal='managed-migration-conflict';
    freshEng.faults.portBusy=true;
    await click('[data-testid="setup-migration-resume"] button');
    await wait(`d.querySelector('[data-testid="setup-migration-unavailable"]')`,'refusal supersedes cached progress');
    check(`fresh-${L}:refusal-overrides-cached-resume`,await guest(`return !d.querySelector('[data-testid="setup-migration-progress"],[data-testid="setup-migration-resume"]')`));
    // Reopening also verifies a cold client has the same manual-diagnosis view.
    await open(L,mode,390,844,undefined,true);
    await wait(`d.querySelector('[data-testid="setup-migration-unavailable"]')`,'fresh refused partial status');
    const refused=await guest(`const p=d.querySelector('[data-testid="setup-panel"]');return {text:p.textContent,recovery:[...p.querySelectorAll('.ap-doc-warn')].map(n=>n.textContent).join(' '),partial:p.querySelector('[data-testid="setup-fresh-partial"]')?.textContent??'',resume:!!p.querySelector('[data-testid="setup-migration-resume"],[data-testid="setup-migrate"],[data-testid="setup-enable"]')}`);
    // General delivery guidance can discuss toggling a plugin. Only recovery
    // copy must not describe this fresh setup as a legacy switch.
    // Status has no usable progress/resource checkpoint: retain manual diagnosis,
    // but do not claim a store folder exists from the family hint alone.
    check(`fresh-${L}:refusal-no-folder-claim-resume-or-codes`,!refused.resume&&!refused.partial&&!refused.text.includes(FRESH[L].partial)&&!/managed-/.test(refused.text)&&!/switch|migrat|перенос|переход|切换|迁移/i.test(refused.recovery),refused);
    check(`fresh-${L}:refusal-fits-390`,(await fitsAll()).ok,await fitsAll());
    await shot(`fresh-refused-partial-${L}`);
    freshRefusal=null;
  }

  // Retained store reconnection keeps its own capture setting (off) and never enables it.
  for (const [L, mode, source] of [['en', 'light', 'reuse'], ['zh-CN', 'dark', 'create']] as const) {
    await openFresh(L, mode, 390, 844, { storeMode: 'retain', sourceMode: source, retainedCapture: 'off' });
    await startFresh();
    check(`fresh-retained-${L}:review-reconnects`, await guest(`const c=d.querySelector('[data-testid="setup-review"]');return c.dataset.storeMode==='retain'&&!c.querySelector('[data-testid="setup-fresh-plan-create-store"],[data-testid="setup-fresh-plan-enable"]')`));
    check(`fresh-retained-${L}:review-fits-390`, (await fitsAll()).ok, await fitsAll());
    await shot(`fresh-retained-review-${L}`);
    const release = freshEng.hold(source === 'reuse' ? 5 : 6); // hold publish-binding
    await confirmByKeyboard();
    await wait(`d.querySelector('[data-testid="setup-migration-progress"][data-driving="true"][data-step="publish-binding"]')`, 'retained running');
    await pauseHeld(release);
    check(`fresh-retained-${L}:paused-off-kept`, await freshCard('data-capture') === 'off' && await freshCard('data-store-mode') === 'retain');
    check(`fresh-retained-${L}:paused-fits-390`, (await fitsAll()).ok, await fitsAll());
    await shot(`fresh-retained-paused-off-${L}`);
    await click('[data-testid="setup-migration-resume"] button');
    await waitComplete('retained complete');
    await wait(`d.querySelector('[data-testid="setup-panel"][data-phase="configured"]')&&d.querySelector('[data-testid="setup-enable"]')`, 'retained configured with capture off');
    check(`fresh-retained-${L}:capture-preserved`, freshEng.progress?.capture.state === 'off' && !freshEng.requests.some(r => r.action === 'advance' && r.step.name === 'enable') && await freshCard('data-capture') === 'off' && !!(await guest(`return d.querySelector('[data-testid="setup-fresh-kept"]')?.checkVisibility()`)));
    check(`fresh-retained-${L}:complete-fits-390`, (await fitsAll()).ok, await fitsAll());
    await shot(`fresh-retained-complete-${L}`);
  }

  // Bodyless capture controls stay available after fresh completion (unchanged negotiated behaviour).
  await openFresh('en', 'light', 390, 844);
  await startFresh(); await confirmByKeyboard();
  await waitComplete('fresh complete before capture controls');
  await wait(`d.querySelector('[data-testid="setup-disable"]')`, 'capture on after fresh setup');
  const controlAt = log.length;
  await click('[data-testid="setup-disable"] button');
  await wait(`d.querySelector('[data-testid="setup-review"][data-action="managed-disable"]')`, 'capture confirmation');
  check('fresh-capture:review-is-local', !log.slice(controlAt).some(l => l.method === 'POST'));
  await confirmByKeyboard();
  await wait(`d.querySelector('[data-testid="setup-enable"]')`, 'capture off observed');
  check('fresh-capture:bodyless-disable', log.slice(controlAt).filter(l => l.method === 'POST').map(l => l.path).join() === '/v1/capture/disable' && captureControl === false);
  check('fresh-capture:disable-keeps-setup-open', await guest(`return !!d.querySelector('[data-testid="surface-panel-setup"]')`));
  await click('[data-testid="setup-enable"] button');
  await wait(`d.querySelector('[data-testid="setup-review"][data-action="managed-enable"]')`, 'capture on confirmation');
  await confirmByKeyboard();
  await wait(`d.querySelector('[data-testid="setup-disable"]')`, 'capture on observed');
  check('fresh-capture:enable-keeps-setup-open', await guest(`return !!d.querySelector('[data-testid="surface-panel-setup"]')`) && captureControl === true);
  check('fresh-capture:bodyless-enable', log.slice(controlAt).filter(l => l.method === 'POST').map(l => l.path).join() === '/v1/capture/disable,/v1/capture/enable');

  // Capability mismatch: a service without managedFreshSteps gets update-together guidance, no requests.
  freshCapable = false;
  for (const L of ['en', 'ru', 'zh-CN'] as const) {
    await openFresh(L, 'light', 390, 844);
    await wait(`d.querySelector('[data-testid="setup-fresh-unsupported"]')`, 'fresh unsupported guidance');
    check(`fresh-unsupported-${L}:no-review-control`, await guest(`return !d.querySelector('[data-testid="setup-inspect"],[data-testid="setup-storeRoot"]')`));
    check(`fresh-unsupported-${L}:fits-390`, (await fitsAll()).ok, await fitsAll());
    await guest(`d.querySelector('[data-testid="setup-fresh-unsupported"]').scrollIntoView({block:'center'});return true`);
    await frames(); const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(artifacts, `fresh-unsupported-${L}.png`), Buffer.from(r.data, 'base64')); shots.push(`fresh-unsupported-${L}.png`);
  }
  await idle('fresh-unsupported:no-requests');
  check('fresh-unsupported:no-post', freshPosts().length === 0, freshPosts());
  freshCapable = true;

  // Desktop keyboard: Enter starts the review, Escape cancels to the opener, Space/Enter confirm,
  // Pause confirmation by keyboard, then a reopened frame shows progress without running it.
  await openFresh('en', 'light', 1280, 900);
  await guest(`d.querySelector('[data-testid="setup-inspect"] button').focus();return true`); await key('Enter');
  await wait(`d.querySelector('[data-testid="setup-review"][data-action="managed-fresh"]')`, 'keyboard review');
  check('fresh-desktop:review-focus-cancel', await focused() === 'setup-cancel', await focused());
  await key('Escape');
  await wait(`!d.querySelector('[data-testid="setup-review"]')`, 'escape cancels review');
  check('fresh-desktop:escape-returns-to-opener', await focused() === 'setup-inspect' && !freshEng.requests.some(r => r.action === 'begin'), await focused());
  await key('Enter');
  await wait(`d.querySelector('[data-testid="setup-review"][data-action="managed-fresh"]')`, 'keyboard review again');
  await shot('fresh-desktop-review');
  let held = freshEng.hold(7); // inspect×4, begin, store-directory, then hold create-store
  await confirmByKeyboard();
  await wait(`d.querySelector('[data-testid="setup-migration-progress"][data-driving="true"][data-step="create-store"]')`, 'desktop running');
  check('fresh-desktop:running-focus-on-pause', await focused() === 'setup-migration-pause', await focused());
  await key('Enter');
  await wait(`d.querySelector('[data-testid="setup-migration-confirm-pause"]')`, 'keyboard pause confirmation');
  check('fresh-desktop:keep-going-focused', await focused() === 'setup-migration-cancel', await focused());
  await key('Escape');
  await wait(`!d.querySelector('[data-testid="setup-migration-confirm-pause"]')`, 'escape keeps going');
  check('fresh-desktop:escape-returns-to-pause', await focused() === 'setup-migration-pause', await focused());
  await shot('fresh-desktop-running');
  const sentBeforeClose = freshEng.requests.length;
  await open('en', 'light', 1280, 900, undefined, true); // reloading closes the view mid-step
  held(); await sleep(400);
  check('fresh-desktop:close-no-continuation', freshEng.requests.length === sentBeforeClose, { before: sentBeforeClose, now: freshEng.requests.length });
  await open('en', 'light', 1280, 900, undefined, true); // reopen after the step in flight settled
  await wait(`d.querySelector('[data-testid="setup-migration-progress"][data-family="fresh"][data-state="pending"]')`, 'reopened fresh progress');
  check('fresh-desktop:reopen-sends-nothing', freshEng.requests.length === sentBeforeClose && !!(await guest(`return !!d.querySelector('[data-testid="setup-migration-continue"]')`)));
  check('fresh-desktop:reopen-keeps-off-warning', await freshCard('data-capture') === 'off' && await guest(`return d.querySelector('[data-testid="setup-migration-capture-warning"]').checkVisibility()`));
  check('fresh-desktop:reopened-group-paused-not-complete', await guest(`return d.querySelector('[data-testid="setup-fresh-group-connect"]').dataset.state==='paused'`));
  await shot('fresh-desktop-reopened');
  await guest(`d.querySelector('[data-testid="setup-migration-continue"] button').focus();return true`); await key('Enter');
  await waitComplete('desktop continue completes');
  check('fresh-desktop:explicit-continue-completes', freshEng.requests[sentBeforeClose]?.action === 'advance' && freshEng.progress?.state === 'complete');
  await shot('fresh-desktop-complete');

  // Matching desktop dark evidence of the simplified review and every stopped/running state.
  await openFresh('en', 'dark', 1280, 900);
  await startFresh();
  await shot('fresh-desktop-dark-review');
  const frameTree = await send('Page.getFrameTree');
  const ax = await send('Accessibility.getFullAXTree', { frameId: frameTree.frameTree.childFrames[0].frame.id });
  check('fresh-desktop:consent-and-disclosure-accessible-names', ax.nodes.some((n: any) => n.name?.value === 'I understand the progress service runs with my account’s access.')
    && ax.nodes.some((n: any) => n.name?.value === 'What Setup changes on this computer'),
    ax.nodes.filter((n: any) => ['checkbox','DisclosureTriangle'].includes(n.role?.value)).map((n: any) => ({ role:n.role.value,name:n.name?.value })));
  held = freshEng.hold(5);
  await confirmByKeyboard();
  await wait(`d.querySelector('[data-testid="setup-migration-progress"][data-driving="true"][data-step="create-store"]')`, 'dark desktop running');
  await shot('fresh-desktop-dark-running');
  await pauseHeld(held);
  await shot('fresh-desktop-dark-paused');
  await click('[data-testid="setup-migration-resume"] button');
  await waitComplete('dark desktop complete');
  await shot('fresh-desktop-dark-complete');
  await openFresh('en', 'dark', 1280, 900, {}, e => e.faults.fail.add('create-store:0'));
  await startFresh(); await confirmByKeyboard();
  await wait(`d.querySelector('[data-testid="setup-migration-failure"]')`, 'dark desktop failure');
  await shot('fresh-desktop-dark-failed');

  // A real visibility event retires a held fresh reply; reopening needs explicit Continue.
  await openFresh('en', 'dark', 1280, 900);
  await startFresh(); held = freshEng.hold(4); await confirmByKeyboard();
  await wait(`d.querySelector('[data-testid="setup-migration-progress"][data-driving="true"][data-step="store-directory"]')`, 'held folder step');
  await guest(`Object.defineProperty(d,'visibilityState',{configurable:true,value:'hidden'});d.dispatchEvent(new Event('visibilitychange'));Object.defineProperty(d,'visibilityState',{configurable:true,value:'visible'});d.dispatchEvent(new Event('visibilitychange'));return true`);
  held();
  await wait(`d.querySelector('[data-testid="setup-migration-continue"]')`, 'fresh hide/show continue');
  check('fresh-hide-show:held-reply-retired', freshEng.requests.filter(r => r.action === 'advance').length === 1);
  await shot('fresh-hide-show-continue');
  for (const size of [1180,390]) {
    await viewport(size,844);
    check(`fresh-continue-${size}:lead-before-details`, await leadBeforeDetails('setup-migration-continue'));
    await releaseShot(`16-setup-continue-${size === 390 ? '390' : 'desktop'}-fixed`,size);
  }

  // An uncertain enable needs a fresh capture decision for exactly that enable.
  await openFresh('en', 'dark', 1280, 900, {}, e => { e.faults.unsettledEnable = true; });
  await startFresh(); await confirmByKeyboard();
  await wait(`d.querySelector('[data-testid="setup-migration-review-capture"]')`, 'fresh capture decision needed');
  check('fresh-review:needs-decision', await freshCard('data-recovery') === 'review' && await freshCard('data-capture') === 'off');
  check('fresh-review:unfinished-has-no-ordinary-enable', await guest(`return d.querySelector('[data-testid="setup-panel"]').dataset.phase==='configured'&&!d.querySelector('[data-testid="setup-enable"]')`));
  await click('[data-testid="setup-migration-review-capture"] button');
  await wait(`d.querySelector('[data-testid="setup-migration-capture-review"][data-family="fresh"]')`, 'fresh capture review');
  check('fresh-review:focus-cancel', await focused() === 'setup-cancel', await focused());
  await shot('fresh-capture-review-desktop');
  await confirmByKeyboard();
  await waitComplete('fresh complete after capture decision');
  const reviewed = freshEng.requests.find(r => r.action === 'resume');
  check('fresh-review:reviewed-resume-payload', !!reviewed && 'review' in reviewed && reviewed.version === 2 && reviewed.review?.step === 'enable', reviewed);
  freshEng.restart();
  for (const size of [1180,390]) {
    await open('en','dark',size,844,undefined,true);
    await wait(`d.querySelector('[data-testid="setup-migration-progress"][data-state="complete"][data-capture="unknown"]')`, 'finished with recording unconfirmed');
    check(`fresh-unknown-${size}:lead-before-details`, await leadBeforeDetails('setup-migration-status'));
    await releaseShot(`17-setup-recording-unconfirmed-${size === 390 ? '390' : 'desktop'}-fixed`,size);
  }

  freshViolations += freshEng.violations.length;
  check('fresh:no-old-routes-version-1-or-shape-violations', oldRoutes.length === 0 && freshViolations === 0, { oldRoutes, freshViolations });
  fresh = false;

  // 9. Older service: no capability → existing flow, zero step requests.
  capable = false;
  await open('en', 'light', 1280, 900);
  const steps0 = stepCalls();
  await click('[data-testid="setup-migrate"] button');
  await wait(`d.querySelector('[data-testid="setup-error"][data-code="managed-action-required"]')`, 'old route guidance');
  check('old-service:no-step-request', stepCalls() === steps0 && !(await guest(`return d.querySelector('[data-testid="setup-panel"]').dataset.steps`)));
  capable = true;
  check('no-exceptions', exceptions.length === 0, exceptions);
} catch (error) {
  exitCode = 1;
  results.push({ id: 'driver', pass: false, facts: String(error instanceof Error ? error.message : error).slice(0, 500) });
} finally {
  writeFileSync(join(artifacts, 'results.json'), JSON.stringify({ kind: 'synthetic-shell rendered Setup QA (source-built page guest, synthetic step responder)', pass: exitCode === 0 && results.every(r => r.pass), checks: results.length, failed: results.filter(r => !r.pass).map(r => r.id), screenshots: shots, results }, null, 2));
  ws?.close();
  if (browser.exitCode === null) { const done = once(browser, 'exit'); browser.kill('SIGTERM'); const t = setTimeout(() => browser.kill('SIGKILL'), 3000); await done.catch(() => {}); clearTimeout(t); }
  server.close(); server.closeAllConnections();
  if (work.startsWith('/tmp/opencode/managed-migration-qa-')) rmSync(work, { recursive: true, force: true });
  console.log(`${results.filter(r => r.pass).length}/${results.length} checks passed; screenshots: ${shots.length}`);
  process.exit(exitCode);
}
