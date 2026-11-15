// Rendered Setup QA for the step-by-step managed switch. Builds the page guest from current source
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
import { stepEngine } from './managed-migration-engine.ts';
import { managedReview,managedStepFixtures } from '../fixtures/managed-steps.ts';

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
let fresh = false, freshConfigured = false;
let captureControl: boolean | null = null;
const log: { method: string; path: string; action?: string; at: number }[] = [];
const health = { ok: true, ready: false, sqlite: false, protocolVersion: 2, schemaVersion: 2, runtime: { node: '24.22.0', bun: null }, diagnostics: ['targets-unverified'], state: 'unconfigured' };
function setupRead() {
  const p = engine.progress;
  const migration = fresh ? 'none' : !p ? 'available' : p.state === 'complete' ? 'complete' : 'pending';
  return {
    configured: freshConfigured, verified: freshConfigured, installed: false, captureEnabled: captureControl ?? (fresh ? freshConfigured : !p ? true : p.capture.state === 'on' ? true : p.capture.state === 'off' ? false : null),
    targets: freshConfigured ? managedReview.targets : null, version: null, activation: 'unknown', separateLifecycle: false, historyRetained: true, diagnostics: [], recovery: null,
    delivery: { kind: 'managed', revision: 1, configuration: freshConfigured ? 'configured' : 'unconfigured', migration, mode: 'unknown', observation: 'unknown', expectedVersion: '1.4.0', ...(capable ? { managedMigrationSteps: 1 } : {}), ...(capable && p ? { migrationProgress: p } : {}) },
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
      if (fresh && q.path === '/v1/setup/managed-inspect') {
        const read = setupRead();
        return json(200, { ...read, delivery: { ...read.delivery, review: managedReview } });
      }
      if (fresh && q.path === '/v1/setup/managed-configure') {
        const body = JSON.parse(q.body ?? '{}');
        if (body.confirmed !== true || body.expected !== managedReview.expected || body.storeRoot !== managedReview.targets.storeRoot) return json(409, { error: 'managed-review-stale' });
        freshConfigured = true;
        return json(200, setupRead());
      }
      if (q.path === '/v1/setup/managed-step') {
        if (!capable) return json(404, { error: 'not-found' });
        entry.action = JSON.parse(q.body ?? '{}').action;
        const result = await engine.request(q.body ?? '{}');
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
  const shot = async (name: string) => { await guest(`d.querySelector('[data-testid="setup-migration-progress"],[data-testid="setup-review"],[data-testid="setup-migration-capture-review"]')?.scrollIntoView({block:'start'});return true`); await frames(); await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 1 }); const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(artifacts, `${name}.png`), Buffer.from(r.data, 'base64')); shots.push(`${name}.png`); };
  const viewport = async (width: number, height: number) => send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 });
  const card = (attr: string) => guest<string | null>(`return d.querySelector('[data-testid="setup-migration-progress"]')?.getAttribute(${literal(attr)})??null`);
  const fits = () => guest<{ ok: boolean; overflow: number; offenders: string[] }>(`const w=d.documentElement.clientWidth,bad=[...d.querySelectorAll('[data-testid="setup-panel"] *')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&(r.right>w+0.5||r.left<-0.5)}).slice(0,5).map(e=>e.dataset.testid||e.className||e.tagName);return {ok:d.scrollingElement.scrollWidth<=w&&!bad.length,overflow:d.scrollingElement.scrollWidth-w,offenders:bad}`);
  const stepCalls = () => log.filter(l => l.path === '/v1/setup/managed-step').length;
  const idle = async (id: string) => { const steps = stepCalls(), setup = log.filter(l => l.path === '/v1/setup').length; await sleep(2500); check(id, stepCalls() === steps && log.filter(l => l.path === '/v1/setup').length === setup, { steps: stepCalls() - steps, setupReads: log.filter(l => l.path === '/v1/setup').length - setup }); };
  async function open(locale: 'en' | 'ru', mode: 'light' | 'dark', width: number, height: number, configure: (e: ReturnType<typeof stepEngine>) => void = () => {}, keep = false) {
    if (!keep) { captureControl = null; engine = stepEngine({ inspectPages: 2 }); configure(engine); log.length = 0; }
    await viewport(width, height);
    await evaluate(`(()=>{try{frame().contentWindow.__stale=true}catch{}return true})()`);
    await evaluate(`qa.load(${literal(locale)},${literal(mode)})`);
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
  check('paused:distinct-from-pending', await guest(`return d.querySelector('[data-testid="setup-migration-heading"]').textContent`) === 'Switch paused');
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
  check('restart:interrupted-unknown', await guest(`return d.querySelector('[data-testid="setup-migration-heading"]').textContent`) === 'Switch interrupted' && await card('data-capture') === 'unknown');
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

  // 8. Fresh setup still uses inspect → review → explicit configure, not migration steps.
  fresh = true;
  for (const locale of ['en', 'ru'] as const) {
    freshConfigured = false;
    await open(locale, locale === 'en' ? 'light' : 'dark', locale === 'en' ? 1280 : 390, locale === 'en' ? 900 : 844);
    check(`fresh-${locale}:opening-is-read-only`, !log.some(l => l.method === 'POST'));
    await click('[data-testid="setup-inspect"] button');
    await wait(`d.querySelector('[data-testid="setup-review"][data-action="managed-configure"]')`, 'fresh review');
    check(`fresh-${locale}:inspect-only-before-confirm`, log.filter(l => l.method === 'POST').map(l => l.path).join() === '/v1/setup/managed-inspect');
    await shot(`fresh-review-${locale}`);
    await confirmByKeyboard();
    await wait(`d.querySelector('[data-testid="setup-notice"]')&&d.querySelector('[data-testid="setup-panel"][data-phase="configured"]')`, 'fresh configured');
    check(`fresh-${locale}:configure-once-no-steps`, stepCalls() === 0 && log.filter(l => l.method === 'POST').map(l => l.path).join() === '/v1/setup/managed-inspect,/v1/setup/managed-configure' && freshConfigured);
    check(`fresh-${locale}:fits`, (await fits()).ok, await fits());
    await shot(`fresh-configured-${locale}`);
    const controlAt=log.length;
    await click('[data-testid="setup-disable"] button');
    await wait(`d.querySelector('[data-testid="setup-review"][data-action="managed-disable"]')`,'capture confirmation');
    check(`capture-${locale}:review-is-local`,!log.slice(controlAt).some(l=>l.method==='POST'));
    await click('[data-testid="setup-confirm"] button');
    check(`capture-${locale}:ack-required`,!log.slice(controlAt).some(l=>l.path.startsWith('/v1/capture/')));
    await shot(`capture-review-${locale}`);
    await confirmByKeyboard();
    await wait(`d.querySelector('[data-testid="setup-enable"]')`,'capture off observed');
    await click('[data-testid="setup-enable"] button');
    await wait(`d.querySelector('[data-testid="setup-review"][data-action="managed-enable"]')`,'enable confirmation');
    await confirmByKeyboard();
    await wait(`d.querySelector('[data-testid="setup-disable"]')`,'capture on observed');
    check(`capture-${locale}:one-bodyless-route-per-confirmation`,log.slice(controlAt).filter(l=>l.method==='POST').map(l=>l.path).join()==='/v1/capture/disable,/v1/capture/enable'&&captureControl===true);
  }
  fresh = false; freshConfigured = false;

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
