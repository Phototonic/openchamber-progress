// Current-bundle board-search QA in an isolated Chromium (plan V4/V6, browser cases 1–7 and the F3
// races). Starts its own loopback synthetic SDK shell (plan-task-search-shell.ts) over real
// disposable HTTP services and a headless Chromium with a fresh disposable profile, drives real CDP
// pointer/keyboard input, and stops only what it started. Never downloads a browser, attaches to an
// existing one or uses a real profile. Synthetic SDK-shell coverage only: not native-host or relay proof.
// Usage: node --experimental-strip-types tests/browser/plan-task-search-qa.ts --artifacts <dir> [--built-service] [--measure] [--chromium <path>]
//   writes results.json, races.json, requests.json (hard work/request gates) and, with --measure,
//   performance.json (three samples after a warm-up; diagnostic, no latency SLA) plus screenshots.
// Keyboard/focus verification (opt-in, no measurement): `--only keyboard-focus` (rail, board and Work Status
//   paths over the search fixture plus the synthetic `KF` session) and `--only keyboard-focus-replay` (the
//   large-plan S0–S8 replay with each surface owning focus at removal). Both add neutral shell sentinels and the
//   labelled setup-interception seam, write results.json (per-K coverage, inventory, skips, failed expectations),
//   races.json, requests.json and screenshots, and exit non-zero on any failed assertion. `--kf-scenarios a,b`
//   runs a subset for iteration only and always fails the run as partial.
import { javascriptLiteral } from '../../shared/javascript-literal.ts';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { PROJECTS, startSearchShell } from './plan-task-search-shell.ts';
import { LARGE_PLAN_ID, LARGE_PLAN_SEED, LARGE_PLAN_VERSION } from '../fixtures/large-plan.ts';
import { mapItems } from '../fixtures/dependency-map.ts';
import { productionMapQa } from './dependency-map-final-qa.ts';

const arg = (name: string) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const artifacts = arg('--artifacts');
if (!artifacts) throw new Error('usage: plan-task-search-qa.ts --artifacts <dir> [--built-service] [--measure] [--chromium <path>]');
const built = process.argv.includes('--built-service');
const measure = process.argv.includes('--measure');
/** `--only j1`: just the J1 review cases (detail retirement and retention), for iteration. */
const onlyJ1 = arg('--only') === 'j1';
const onlyCapture = arg('--only') === 'capture';
const onlyLarge = arg('--only') === 'large-plan';
/** `--only keyboard-focus` / `keyboard-focus-replay`: keyboard and focus verification (no measurement). */
const onlyKeyboard = arg('--only') === 'keyboard-focus';
const onlyReplay = arg('--only') === 'keyboard-focus-replay';
const onlyMapRender = arg('--only') === 'dependency-map-render';
const onlyMapInteraction = arg('--only') === 'dependency-map-interaction';
const onlyMapLarge = arg('--only') === 'dependency-map-large';
const onlyMapAttribution = arg('--only') === 'dependency-map-attribution';
const onlyMapFinal = arg('--only') === 'dependency-map-final';
const onlyRailChoice = arg('--only') === 'rail-plan-choice';
const onlyMapAccessibility = arg('--only') === 'dependency-map-accessibility';
const onlyMapOwner = arg('--only') === 'dependency-map-screen-reader';
const productionMap = onlyMapFinal || onlyRailChoice || onlyMapAccessibility || onlyMapOwner || onlyMapLarge;
if (arg('--only') && !['j1', 'capture', 'large-plan', 'keyboard-focus', 'keyboard-focus-replay', 'dependency-map-render', 'dependency-map-interaction', 'dependency-map-large', 'dependency-map-attribution', 'dependency-map-final', 'rail-plan-choice', 'dependency-map-accessibility', 'dependency-map-screen-reader'].includes(arg('--only')!)) throw Error('Unknown --only mode (S5 replaces dependency-map-hidden with dependency-map-final)');
if (onlyMapOwner && !process.argv.includes('--headed')) throw Error('Screen-reader fixture requires --headed');
if (process.argv.includes('--orca-automated')) {
  const root=process.env.ORCA_PRIVATE_ROOT, display=Number(process.env.DISPLAY?.slice(1));
  if(!root?.startsWith('/tmp/opencode/dependency-map-orca-')||process.env.HOME!==join(root,'home')||display<99||display>198
    ||process.env.AT_SPI_BUS_ADDRESS!=='unix:path='+join(root,'run','atspi-bus')
    ||!existsSync(join(root,'worker.pid'))||Number(readFileSync(join(root,'worker.pid'),'utf8'))!==process.ppid
    ||!existsSync(join(root,'xvfb.pid'))||Number(readFileSync(`/tmp/.X${display}-lock`,'utf8').trim())!==Number(readFileSync(join(root,'xvfb.pid'),'utf8')))
    throw Error('Orca automation must be launched by the private Xvfb/D-Bus runner');
}
if ((onlyKeyboard || onlyReplay) && measure) throw Error('keyboard-focus modes take no --measure');
if ((onlyLarge || onlyMapLarge) && !measure) throw Error('large-plan requires --measure (one warm-up and three samples)');
class OnlyDone extends Error {}
mkdirSync(artifacts, { recursive: true });

function findChromium() {
  const explicit = arg('--chromium') ?? process.env.CHROMIUM_PATH;
  if (explicit) return explicit;
  const cache = join(homedir(), '.cache', 'ms-playwright');
  const builds = existsSync(cache) ? readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1])) : [];
  for (const b of builds) { const p = join(cache, b, 'chrome-linux64', 'chrome'); if (existsSync(p)) return p; }
  for (const p of ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome']) if (existsSync(p)) return p;
  throw new Error('No installed Chromium found; pass --chromium (this driver never downloads one).');
}

type Result = { id: string; pass: boolean; facts?: string[] };
const results: Result[] = [];
const races: Result[] = [];
const shots: string[] = [];
function check(id: string, pass: boolean, facts?: string[], diagnostic?: unknown, into = results) {
  into.push({ id, pass, ...(facts ? { facts } : {}) });
  if (!pass) throw new Error(`${id} failed${diagnostic === undefined ? '' : `: ${JSON.stringify(diagnostic).slice(0, 700)}`}`);
}
const race = (id: string, pass: boolean, facts?: string[], diagnostic?: unknown) => check(id, pass, facts, diagnostic, races);
const stats = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return { samples: xs.map((x) => Math.round(x * 10) / 10), median: Math.round(s[Math.floor(s.length / 2)] * 10) / 10, range: [Math.round(s[0] * 10) / 10, Math.round(s[s.length - 1] * 10) / 10] }; };

type Cdp = { send: (method: string, params?: object) => Promise<any>; close: () => void; events: { method: string; params: any }[] };
async function connect(url: string): Promise<Cdp> {
  const ws = new WebSocket(url);
  await new Promise<void>((resolve, reject) => { ws.onopen = () => resolve(); ws.onerror = () => reject(new Error('CDP connect failed')); });
  let next = 1;
  const waiting = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  const events: Cdp['events'] = [];
  ws.onmessage = (event) => {
    const m = JSON.parse(String(event.data));
    const w = m.id && waiting.get(m.id);
    if (w) { waiting.delete(m.id); if (m.error) w.reject(new Error(m.error.message)); else w.resolve(m.result); }
    else if (m.method === 'Runtime.exceptionThrown' || (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error')) events.push({ method: m.method, params: m.params });
  };
  return { events, send: (method, params = {}) => new Promise((resolve, reject) => { const id = next++; waiting.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); }), close: () => ws.close() };
}

mkdirSync('/tmp/opencode', { recursive: true });
const profile = mkdtempSync('/tmp/opencode/plan-task-search-qa-');
let fx = await startSearchShell(built, false, onlyMapAttribution ? 'dependency-map-attribution' : onlyMapLarge ? 'dependency-map-large' : onlyMapInteraction ? 'dependency-map-interaction' : onlyMapRender ? 'dependency-map-render' : productionMap ? 'dependency-map-final' : onlyLarge || onlyReplay ? 'large-plan' : onlyKeyboard ? 'keyboard-focus' : 'search', onlyKeyboard || onlyReplay, productionMap);
let origin = `http://127.0.0.1:${fx.port}`;
const chrome = spawn(findChromium(), [...(process.argv.includes('--headed') ? [] : ['--headless=new']), ...(process.argv.includes('--orca-automated') ? ['--force-renderer-accessibility', '--mute-audio', '--password-store=basic'] : []), '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--disable-sync', '--hide-scrollbars', '--window-size=1280,1100', 'about:blank'], { stdio: 'ignore', detached: true });
let page: Cdp | null = null, browser: Cdp | null = null;
let failure: string | null = null;
let browserVersion = '';
const facts: Record<string, unknown> = {};
const perf: Record<string, unknown> = {};
const gates: { id: string; pass: boolean; observed: unknown; limit: string }[] = [];
const actions: { action: string; windows: number }[] = [];
let replies: any[] = [];
try {
  let devtools = '';
  for (const end = Date.now() + 15_000; Date.now() < end && !devtools;) {
    const f = join(profile, 'DevToolsActivePort');
    if (existsSync(f)) devtools = readFileSync(f, 'utf8').split('\n')[0];
    else await new Promise((r) => setTimeout(r, 100));
  }
  if (!devtools) throw new Error('Chromium did not start its DevTools endpoint.');
  const version = await (await fetch(`http://127.0.0.1:${devtools}/json/version`)).json() as { webSocketDebuggerUrl: string; Browser: string };
  browserVersion = version.Browser;
  browser = await connect(version.webSocketDebuggerUrl);
  const targets = await (await fetch(`http://127.0.0.1:${devtools}/json/list`)).json() as { type: string; webSocketDebuggerUrl: string }[];
  page = await connect(targets.find((t) => t.type === 'page')!.webSocketDebuggerUrl);
  const c = page;
  await c.send('Runtime.enable'); await c.send('Page.enable');
  await c.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await c.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await c.send('Page.navigate', { url: `${origin}/` });

  const evaluate = async <T = any>(expression: string): Promise<T> => {
    const r = await c.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: false });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value as T;
  };
  const guest = <T = any>(f: string, code: string) => evaluate<T>(`(()=>{const w=frame('${f}').contentWindow,d=w.document;${code}})()`);
  /** Polls in the page on animation frames; resolves with the page time when `cond` held. */
  const wait = async (f: string, cond: string, what = cond, ms = 20_000) => {
    const at = await evaluate<number | null>(`(async()=>{const end=performance.now()+${ms};while(performance.now()<end){try{const w=frame('${f}').contentWindow,d=w.document;if(${cond})return performance.now()}catch{}await new Promise(r=>requestAnimationFrame(r));}return null})()`);
    if (at === null) throw new Error(`timed out waiting (${f}): ${what}`);
    return at;
  };
  const now = () => evaluate<number>('performance.now()');
  const sleep = (ms: number) => evaluate(`new Promise(r=>setTimeout(r,${ms}))`);
  const frames2 = () => evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  const codes: Record<string, number> = { Enter: 13, Tab: 9, ' ': 32, Escape: 27, Home: 36, ArrowDown: 40, End: 35, ArrowUp: 38, ArrowLeft: 37, ArrowRight: 39 };
  const key = async (k: string, times = 1, modifiers = 0) => {
    for (let i = 0; i < times; i++) {
      const text = k === 'Enter' ? { text: '\r', unmodifiedText: '\r' } : k === ' ' ? { text: ' ', unmodifiedText: ' ' } : {};
      await c.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: k === ' ' ? 'Space' : k, modifiers, windowsVirtualKeyCode: codes[k] ?? 0, ...text });
      await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k === ' ' ? 'Space' : k, modifiers, windowsVirtualKeyCode: codes[k] ?? 0 });
    }
  };
  const type = (t: string) => c.send('Input.insertText', { text: t });
  const click = async (f: string, selector: string) => {
    const point = await evaluate<[number, number] | null>(`(()=>{const fr=frame('${f}'),n=fr.contentDocument.querySelector(${javascriptLiteral(selector)});if(!n)return null;n.scrollIntoView({block:'center'});const r=n.getBoundingClientRect(),o=fr.getBoundingClientRect(),scale=o.width/fr.clientWidth;return [o.x+(r.x+Math.min(16,r.width/2))*scale,o.y+(r.y+Math.min(10,r.height/2))*scale]})()`);
    if (!point) throw new Error(`missing ${selector} in ${f}`);
    for (const t of ['mouseMoved', 'mousePressed', 'mouseReleased']) await c.send('Input.dispatchMouseEvent', { type: t, x: point[0], y: point[1], button: 'left', clickCount: 1 });
  };
  const show = async (list: string[], width: number) => { await evaluate(`qa.show(${javascriptLiteral(list)},${width});true`); for (const f of list) await wait(f, `w.innerWidth===${width}`, `${f} width ${width}`); };
  const theme = async (mode: 'light' | 'dark') => { await evaluate(`qa.theme('${mode}');true`); await frames2(); };
  const shot = async (name: string, selector = '[data-testid="progress-root"]', pad = 12, height = 1700, surface = 'page') => {
    await guest(surface, `d.querySelector(${javascriptLiteral(selector)})?.scrollIntoView({block:'start'});return true`);
    await frames2();
    const r = await evaluate<number[] | null>(`(()=>{const fr=frame('${surface}'),n=fr.contentDocument.querySelector(${javascriptLiteral(selector)});if(!n)return null;const a=n.getBoundingClientRect(),o=fr.getBoundingClientRect(),scale=o.width/fr.clientWidth;return [o.x+a.x*scale+scrollX,o.y+a.y*scale+scrollY,a.width*scale,a.height*scale]})()`);
    if (!r) throw new Error(`no ${selector} to capture`);
    const png = await c.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: Math.max(0, r[0] - pad), y: Math.max(0, r[1] - pad), width: r[2] + pad * 2, height: Math.min(r[3] + pad * 2, height), scale: 1 } });
    writeFileSync(join(artifacts, `${name}.png`), Buffer.from(png.data, 'base64'));
    shots.push(`${name}.png`);
  };
  const choose = async (holder: string, label: string) => {
    await click('page', `${holder} .oc-sdk-trigger`);
    await wait('page', `d.querySelector('.oc-sdk-popup [role="listbox"] [role="option"]')`, `${holder} options`);
    const options = await guest<string[]>('page', `return [...d.querySelectorAll('.oc-sdk-popup [role="listbox"] [role="option"]')].map(n=>n.querySelector('.oc-sdk-option-label')?.textContent??'')`);
    const index = options.indexOf(label);
    if (index < 0) throw new Error(`no option ${label} in ${holder}: ${JSON.stringify(options)}`);
    await key('Home'); if (index) await key('ArrowDown', index); await key('Enter');
    await wait('page', `!d.querySelector('.oc-sdk-popup [role="listbox"]')`, `${holder} closed`);
  };
  const reqs = (filter = 'true') => evaluate<any[]>(`qa.requests.filter(r=>${filter})`);
  const count = (path: string, frame = 'page') => evaluate<number>(`qa.requests.filter(r=>r.frame==='${frame}'&&r.path==='${path}').length`);
  const counts = () => guest<Record<string, string> | null>('page', `const n=d.querySelector('[data-testid="search-counts"]');return n?{...n.dataset}:null`);
  const run = () => guest<string | null>('page', `return d.querySelector('[data-testid="search-results"]')?.dataset.run??null`);
  const stop = () => guest<string | null>('page', `return d.querySelector('[data-testid="search-status"]')?.dataset.stop??null`);
  const busy = `!!d.querySelector('[data-testid="search-results"] [data-testid="search-loading"]')`;
  const IDLE = `d.querySelector('[data-testid="search-results"]')&&!(${busy})`;
  const idle = () => wait('page', IDLE, 'search idle');
  const hasMore = () => guest<boolean>('page', `return !!d.querySelector('[data-testid="search-more"] button')`);
  const planHits = () => guest<string[]>('page', `return [...d.querySelectorAll('[data-testid="search-results"] .ap-hit-plan')].map(b=>b.dataset.plan)`);
  /** One explicit action and the windows it issued (hard gate: at most ten). */
  const act = async (label: string, run: () => Promise<unknown>) => {
    const before = await count('/v1/search');
    await run(); await idle();
    const windows = (await count('/v1/search')) - before;
    actions.push({ action: label, windows });
    return windows;
  };
  const more = (label = 'continue/load more') => act(label, () => click('page', '[data-testid="search-more"] button'));
  const exhaust = async () => { let n = 0; for (; n < 12 && await hasMore(); n++) await more(); return n; };
  const clearField = async () => { await guest('page', `const i=d.getElementById('ap-search-q');i.focus();i.select();return true`); await key('Escape'); };
  /** Clear the field, type real text, press Enter; waits for a new run to settle. */
  const searchFor = async (q: string, all = false) => {
    const prev = await run();
    await clearField(); await type(q);
    await act(`search “${q}”`, async () => { await key('Enter'); await wait('page', `d.querySelector('[data-testid="search-results"]')?.dataset.run!==${javascriptLiteral(prev)}`, `new run for ${q}`); });
    if (all) await exhaust();
  };
  const overflow = () => guest<boolean>('page', `return d.documentElement.scrollWidth<=w.innerWidth+1`);
  const setHidden = (hidden: boolean) => guest('page', hidden
    ? `Object.defineProperty(d,'visibilityState',{configurable:true,get:()=>'hidden'});d.dispatchEvent(new Event('visibilitychange'));return true`
    : `delete d.visibilityState;d.dispatchEvent(new Event('visibilitychange'));return true`);
  const instrument = (surface = 'page') => guest(surface, `if(w.__paints)return true;w.__paints=[];const mount=d.getElementById('root'),orig=w.queueMicrotask.bind(w);w.queueMicrotask=fn=>orig(()=>{const before=mount.firstElementChild,t0=w.performance.now();fn();if(mount.firstElementChild!==before)w.__paints.push(w.performance.now()-t0)});return true`);
  const paints = (surface = 'page') => guest<number[]>(surface, `return (w.__paints??[]).splice(0)`);
  const pageErrors = () => c.events.map((e) => String(e.params.exceptionDetails?.exception?.description ?? e.params.args?.map((a: any) => a.value ?? a.description).join(' ') ?? '').split('\n')[0].slice(0, 160));
  const T = (plan: string, item: string, source = 'source-alpha') => `[data-testid="search-task-${source}/${plan}/${item}"]`;
  const H = (plan: string, source = 'source-alpha') => `[data-testid="search-plan-${source}/${plan}"]`;

  if (productionMap) {
    Object.assign(facts, { production: true, fixture: onlyMapLarge ? LARGE_PLAN_VERSION : 'dependency-map-v1', ...(onlyMapLarge ? { seed: LARGE_PLAN_SEED } : {}), commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), runtime: process.version, serviceClass: built ? 'built generated service' : 'TypeScript service', browser: browserVersion, bundles: Object.fromEntries(['build/service/main.js', ...['page', 'panel', 'status'].map(f => `ui/${f}/main.js`)].map(p => [p, createHash('sha256').update(readFileSync(p)).digest('hex')])) });
    await productionMapQa({ mode: onlyRailChoice ? 'rail-choice' : onlyMapLarge ? 'large' : onlyMapAccessibility ? 'accessibility' : onlyMapOwner ? 'owner' : 'final', ownerSmoke: process.argv.includes('--owner-fixture-smoke'), artifacts, c, evaluate, guest, wait, key, click, show, shot, frames2, theme, check, count, fx, facts, perf, pageErrors, restart: async () => {
      await fx.stop(); fx = await startSearchShell(built, false, 'dependency-map-large', false, true); origin = `http://127.0.0.1:${fx.port}`;
      await c.send('Page.navigate', { url: `${origin}/` }); return fx;
    } });
    replies = await evaluate('qa.replies');
    throw new OnlyDone();
  }
  if (onlyMapAttribution) {
    facts.renderingAssertions = 'Rendered captions on the real preview, including legacy link-only detail, optional missing view input, waiting, superseded picture, repeated relay reports and foreign-source isolation. Copy-only checks remain supplemental.';
    const ready = (surface: string) => wait(surface, `d.querySelector('[data-testid="map-region"]')?.dataset.current==='true'&&w.mapPreview?.attribution?.B`, 'attribution picture');
    const proof = (surface: string) => guest<any>(surface, 'return w.mapPreview.attribution');
    const positions = (surface: string) => guest(surface, 'return w.mapPreview.coordinates');
    // ── Rendering probes (Designer): what the card and inspector actually say and where.
    const card = (surface: string, id: string) => guest<any>(surface, `const n=d.querySelector('[data-testid="map-card-${id}"]');if(!n)return null;const who=n.querySelector('[data-testid="map-card-who-${id}"]'),live=n.querySelector('[data-testid="map-card-live-${id}"]'),t=who?.querySelector('.ap-map-card-who-text');return {attribution:n.dataset.attribution??null,live:n.dataset.live??null,name:n.getAttribute('aria-label'),status:n.querySelector('.ap-map-card-word')?.textContent,who:who?.textContent??null,whoFits:!!t&&t.scrollWidth<=t.clientWidth,chip:live?.dataset.live??null,markOnSession:!!live&&live.getAttribute('aria-hidden')==='true'&&live.nextSibling?.textContent==='Session map-child'&&getComputedStyle(live).borderRadius==='2px'&&live.offsetWidth===8,statusMarkRound:getComputedStyle(n.querySelector('.ap-map-mark')).borderRadius==='50%'}`);
    /** Card boxes plus each row's box inside it: activity must change none of these numbers. */
    const boxes = (surface: string) => guest<string>(surface, `return JSON.stringify([...d.querySelectorAll('[data-testid="map-viewport"] .ap-map-card')].map(n=>[n.dataset.task,n.offsetLeft,n.offsetTop,n.offsetWidth,n.offsetHeight,...[...n.children].map(c=>c.className+'@'+c.offsetTop+'+'+c.offsetHeight)]))`);
    const contained = (surface: string) => guest<boolean>(surface, `const cards=[...d.querySelectorAll('[data-testid="map-viewport"] .ap-map-card')];return cards.length>0&&cards.every(n=>[...n.children].every(c=>c.offsetTop+c.offsetHeight<=n.clientHeight+0.5))`);
    const inspector = (surface: string) => guest<any>(surface, `const s=d.querySelector('[data-testid="map-attribution"]');if(!s)return null;const t=id=>s.querySelector('[data-testid="'+id+'"] dd')?.textContent??null;return {assignment:s.dataset.assignment,live:s.dataset.live,assignmentText:t('map-attribution-assignment'),links:t('map-attribution-links'),reports:t('map-attribution-reports'),activity:t('map-attribution-live'),liveMark:!!s.querySelector('[data-testid="map-attribution-live"] .ap-map-live-mark[aria-hidden="true"]')}`);
    const select = async (surface: string, id: string) => { await guest(surface, `w.mapPreview.dispatch({type:'select',id:'${id}'});return true`); await frames2(); };
    /** No “running”/“unassigned” in visible text or any accessible name inside the map region. */
    const words = (surface: string) => guest<boolean>(surface, `const r=d.querySelector('[data-testid="map-region"]');const text=r.textContent+' '+[...r.querySelectorAll('[aria-label]')].map(n=>n.getAttribute('aria-label')).join(' ');return !/\\brunning\\b/i.test(text)&&!/unassigned/i.test(text)`);
    const mapShot = async (name: string, surface: string) => { await shot(name, '[data-testid="map-region"]', 12, 1600, surface); };
    await show(['page', 'panel'], 600); await ready('page'); await ready('panel');
    for (const surface of ['page', 'panel']) {
      await wait(surface, `w.mapPreview.attribution.B.live.proven`, 'verified assigned child running');
      const p = await proof(surface);
      check(`attribution:${surface}:verified-binding-child-live`, p.B.assignment.childSessionId === 'map-child' && p.B.live.proven);
      check(`attribution:${surface}:linked-is-not-assigned-or-running`, !p.C.assignment && !p.C.live.proven && p.C.links.includes('map-linked'));
      check(`attribution:${surface}:reports-separate`, p.B.reporter === 'M' && !p.I.live.proven);
      check(`attribution:${surface}:one-separate-roster`, await guest(surface, `return d.querySelectorAll('[data-testid="subagent-activity"]').length===1`));
      // Rendered words: only the proof-positive card says Assigned and carries the session chip.
      await wait(surface, `d.querySelector('[data-testid="map-card-live-B"]')`, 'proven session chip painted');
      const b = await card(surface, 'B'), cc = await card(surface, 'C'), a = await card(surface, 'A');
      check(`attribution:render:${surface}:assigned-caption`, b.attribution === 'assigned' && b.who === 'Assigned to Session map-child' && b.whoFits);
      check(`attribution:render:${surface}:session-mark-shape-on-session-name`, b.live === 'active' && b.chip === 'active' && b.markOnSession && b.statusMarkRound);
      check(`attribution:render:${surface}:status-stays-reported-working`, b.status === 'Reported working');
      check(`attribution:render:${surface}:assigned-name`, b.name.includes('Assigned to Session map-child') && b.name.includes('Assigned session active now, session activity only'));
      check(`attribution:render:${surface}:unverified-never-assigned`, cc.attribution === 'recorded' && cc.who === 'Unverified assignee · Session map-linked' && cc.chip === null && cc.live === null && !cc.name.includes('Assigned to'));
      check(`attribution:render:${surface}:no-assignee-no-line`, a.attribution === 'none' && a.who === null && a.chip === null);
      check(`attribution:render:${surface}:one-chip-only`, await guest(surface, `return d.querySelectorAll('[data-testid^="map-card-live-"]').length===1`));
      check(`attribution:render:${surface}:no-running-or-unassigned-words`, await words(surface));
      check(`attribution:render:${surface}:rows-inside-fixed-slot`, await contained(surface) && await guest(surface, `return [...d.querySelectorAll('[data-testid="map-viewport"] .ap-map-card')].every(n=>n.offsetWidth===220&&n.offsetHeight===100)`));
    }
    const coordinates = await positions('page');
    const visitCounts = async () => ({ runs: await count('/v1/subagent-runs'), polls: await count('/v1/plans') });
    const beforePaint = await visitCounts();
    await guest('page', 'w.mapPreview.repaint();return true'); await frames2(); await frames2();
    const afterPaint = await visitCounts();
    check('attribution:map-and-roster-share-one-visit', afterPaint.runs - beforePaint.runs <= afterPaint.polls - beforePaint.polls);
    await shot('verified-running', '[data-testid="map-region"]');
    await shot('rail-verified-running', '[data-testid="map-region"]', 12, 1200, 'panel');
    // Supplemental copy checks preserved from Designer; corresponding rendered cases follow below.
    {
      const { attributionCopy } = await import('../../ui/shared/dependency-map-view.ts');
      const L = (id: string) => `Session ${id}`;
      const base = { assignment: null, recordedAssignee: null, links: ['link-a', 'link-b'], reporter: null, reports: [], assignmentReason: 'no-assignee-recorded' as const, live: { proven: false as const, reason: 'no-verified-assignment' as const } };
      const linked = attributionCopy(base, true, 3, L);
      check('attribution:copy:link-only', linked.kind === 'linked' && linked.card === 'Linked to Session link-a and 1 more · no verified delegation' && linked.assignment === 'No assignee recorded' && linked.links[0] === 'Linked to Session link-a · no verified delegation' && linked.live === null);
      const missing = attributionCopy(undefined, true, 3, L);
      check('attribution:copy:missing-projection-is-unavailable-not-unassigned', missing.kind === 'unavailable' && missing.card === null && missing.assignment === 'Unavailable in this view' && /doesn’t mean the task is unassigned/.test(missing.assignmentNote ?? ''));
      const bound = { childSessionId: 'kid', coordinatorSessionId: 'M', boundAt: '', boundRevision: 2, validAtRevision: 3 };
      const superseded = attributionCopy({ ...base, links: [], assignment: bound, recordedAssignee: 'kid', assignmentReason: 'verified', live: { proven: true, runId: 'r', kind: 'active' } }, false, 3, L);
      check('attribution:copy:superseded-suppresses-live', superseded.live === null && superseded.card === 'Assigned to Session kid' && superseded.activityNote === 'Hidden while the map shows revision 3 as last reported.');
      const waiting = attributionCopy({ ...base, links: [], assignment: bound, recordedAssignee: 'kid', assignmentReason: 'verified', live: { proven: true, runId: 'r', kind: 'waiting' } }, true, 3, L);
      check('attribution:copy:waiting-session-words', waiting.live?.kind === 'waiting' && waiting.live.text === 'Assigned session waiting for input now' && waiting.session === 'Session kid');
      const relay = attributionCopy({ ...base, links: [], reporter: 'M', reports: [{ revision: 3, reporterSessionId: 'M', attributedSessionId: 'kid', mode: 'parent-relay', itemIds: ['B'] }, { revision: 3, reporterSessionId: 'M', attributedSessionId: 'kid', mode: 'parent-relay', itemIds: ['B'] }] }, true, 3, L);
      check('attribution:copy:relay-separate-and-counted', relay.reports.length === 1 && relay.reports[0] === 'Reported by Session M for Session kid · 2 reports' && relay.kind === 'none');
      const same = (_: string) => 'Session same-title';
      const distinct = attributionCopy({ ...base, links: [], reporter: 'M1', reports: [{ revision: 3, reporterSessionId: 'M1', attributedSessionId: 'M1', mode: 'direct', itemIds: ['B'] }, { revision: 3, reporterSessionId: 'M2', attributedSessionId: 'M2', mode: 'direct', itemIds: ['B'] }] }, true, 3, same);
      check('attribution:copy:same-label-reporters-stay-separate', distinct.reports.length === 2 && distinct.reports.every(r => r === 'Reported directly by Session same-title'));
    }
    // Inspector: the full context for the proof-positive card and the unverified card, both frames.
    for (const surface of ['page', 'panel']) {
      await select(surface, 'B');
      const i = await inspector(surface);
      check(`attribution:render:${surface}:inspector-verified`, i.assignment === 'assigned' && i.assignmentText.startsWith('Assigned to Session map-child') && /Verified delegation, current for revision \d+\./.test(i.assignmentText));
      check(`attribution:render:${surface}:inspector-live-hedged`, i.live === 'active' && i.activity.startsWith('Assigned session active now') && i.activity.includes('doesn’t show that it is working on this task') && i.liveMark);
      const p = (await proof(surface)).B;
      check(`attribution:render:${surface}:inspector-reports-separate`, typeof i.reports === 'string' && !i.reports.includes('Assigned') && (p.reports.length
        ? p.reports.every((r: any) => i.reports.includes(r.mode === 'parent-relay' ? `Reported by Session ${r.reporterSessionId} for Session ${r.attributedSessionId}` : `Reported directly by Session ${r.reporterSessionId}`))
        : i.reports === `Last reported by Session ${p.reporter} · report mode unavailable`));
    }
    await mapShot('attribution-assigned', 'page');
    await mapShot('rail-attribution-assigned', 'panel');
    await select('page', 'C');
    {
      const i = await inspector('page');
      check('attribution:render:inspector-provenance-unavailable', i.assignment === 'recorded' && i.assignmentText.startsWith('Recorded assignee Session map-linked · delegation provenance unavailable') && i.assignmentText.includes('doesn’t mean the task is unassigned'));
      check('attribution:render:inspector-link-context', i.links === 'Linked to Session map-linked · no verified delegation');
      check('attribution:render:inspector-no-activity-without-verified', i.live === '' && i.activity.startsWith('Not shown') && i.activity.endsWith('Shown only for a verified assignment.'));
    }
    await mapShot('provenance-unavailable', 'page');
    await select('page', 'I'); await mapShot('linked-no-activity', 'page');
    // Dark, forced colours and the 360 px rail, with the proven session chip on screen.
    await select('page', 'B'); await select('panel', 'B');
    await theme('dark'); await mapShot('attribution-dark', 'page'); await theme('light');
    await c.send('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: 'active' }, { name: 'prefers-reduced-motion', value: 'reduce' }] }); await frames2();
    check('attribution:render:forced-colors-session-mark', await guest('page', `const m=d.querySelector('[data-testid="map-card-live-B"]'),n=d.querySelector('[data-testid="map-card-B"]');return w.matchMedia('(forced-colors: active)').matches&&getComputedStyle(m).backgroundColor===getComputedStyle(n).color&&getComputedStyle(m).backgroundColor!==getComputedStyle(n).backgroundColor`));
    check('attribution:render:forced-colors-selected-rows-unsqueezed', await guest('page', `const n=d.querySelector('[data-testid="map-card-B"]'),t=n.querySelector('.ap-map-card-title'),wl=n.querySelector('.ap-map-card-who'),f=n.querySelector('.ap-map-card-foot');return getComputedStyle(n).borderTopWidth==='3px'||parseFloat(getComputedStyle(n).borderTopWidth)>=3?t.offsetHeight>=16&&t.offsetTop+t.offsetHeight<=wl.offsetTop&&f.offsetTop+f.offsetHeight<=n.clientHeight+0.5:false`));
    await mapShot('attribution-forced-colors', 'page');
    await c.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }); await frames2();
    check('attribution:render:no-motion', await guest('page', `return [...d.querySelectorAll('[data-testid="map-region"] *')].every(n=>{const s=getComputedStyle(n);return s.animationName==='none'&&(s.transitionDuration.split(',').every(t=>parseFloat(t)===0))})`));
    // qa.show lists every frame to keep visible: keep the board visible (and polling) throughout.
    await show(['page', 'panel'], 360); await wait('panel', `d.querySelector('[data-testid="map-card-live-B"]')`, 'rail 360 chip');
    check('attribution:render:panel-360-contained', await contained('panel') && await guest('panel', `return d.documentElement.scrollWidth<=w.innerWidth+1`));
    await mapShot('rail-attribution-360', 'panel');
    await show(['page', 'panel'], 600); await ready('page'); await ready('panel');
    await wait('page', `d.querySelector('[data-testid="map-card-live-B"]')`, 'board chip after resize');
    const cardBoxes = await boxes('page');
    // Real controller fallback: a failed poll retains ready/cached rows for the roster, but that
    // successful older read must not keep the map's live session proof alive.
    await select('page', 'B');
    await evaluate(`qa.fail.push({path:'/v1/subagent-runs',frame:'page',status:503,code:'unavailable'});true`);
    await wait('page', `!w.mapPreview.attribution.B.live.proven`, 'failed refresh withdraws proof');
    {
      const b = await card('page', 'B'), i = await inspector('page');
      check('attribution:render:failed-refresh-removes-live', b.attribution === 'assigned' && b.chip === null && i.live === '' && i.activity.endsWith('This view’s run records aren’t available.'));
      check('attribution:render:failed-refresh-keeps-roster', await guest('page', `return d.querySelector('[data-testid="subagent-activity"]')?.dataset.state==='ready'&&!!d.querySelector('[data-testid="subagent-activity"] [data-run]')`));
      check('attribution:render:failed-refresh-zero-movement', await boxes('page') === cardBoxes && JSON.stringify(await positions('page')) === JSON.stringify(coordinates));
    }
    await mapShot('failed-run-refresh', 'page');
    await evaluate(`qa.fail=qa.fail.filter(f=>!(f.path==='/v1/subagent-runs'&&f.frame==='page'));true`);
    await wait('page', `w.mapPreview.attribution.B.live.proven&&d.querySelector('[data-testid="map-card-live-B"]')`, 'recovered refresh restores proof');
    check('attribution:render:failed-refresh-recovery', (await card('page', 'B')).chip === 'active' && await boxes('page') === cardBoxes);
    for (const fault of ['missing', 'unloaded', 'childless', 'other']) {
      await evaluate(`qa.mapRunFault={page:'${fault}'};true`);
      await wait('page', `!w.mapPreview.attribution.B.live.proven`, `${fault} evidence withheld`);
      check(`attribution:${fault}:not-proven`, !(await proof('page')).B.live.proven);
      check(`attribution:${fault}:other-frame-independent`, (await proof('panel')).B.live.proven);
      check(`attribution:${fault}:zero-activity-movement`, JSON.stringify(await positions('page')) === JSON.stringify(coordinates));
      await wait('page', `!d.querySelector('[data-testid="map-card-live-B"]')`, `${fault}: chip removed`);
      const b = await card('page', 'B');
      check(`attribution:render:${fault}:assigned-without-chip`, b.who === 'Assigned to Session map-child' && b.chip === null && b.live === null && b.status === 'Reported working');
      check(`attribution:render:${fault}:no-box-moves`, await boxes('page') === cardBoxes);
      check(`attribution:render:${fault}:panel-chip-kept`, !!(await card('panel', 'B')).chip);
      if (fault === 'other') {
        // The bound child's session runs nothing here; another child's run is not this task's activity.
        const i = await inspector('page');
        check('attribution:render:other-child-not-proven-reason', i.live === '' && i.activity.endsWith('This view’s run records don’t confirm the assigned session’s latest run.'));
        await mapShot('live-not-proven-other-child', 'page');
      }
      await evaluate('qa.mapRunFault={};true');
      await wait('page', `w.mapPreview.attribution.B.live.proven`, 'proof recovered on existing poll');
    }
    // A rail rooted in the contributing child must not borrow the coordinator board's run scope.
    await evaluate(`qa.context('map-child');true`); await ready('panel');
    await wait('panel', `!w.mapPreview.attribution.B.live.proven`, 'child-root scope has no bound-child run');
    check('attribution:rail-child-root-no-board-leak', !(await proof('panel')).B.live.proven && (await proof('page')).B.live.proven);
    const roots = await reqs(`r.path==='/v1/subagent-runs'&&r.frame==='panel'`);
    check('attribution:rail-never-widens-root', roots.at(-1)?.query.root === 'map-child');
    await wait('panel', `!d.querySelector('[data-testid="map-card-live-B"]')`, 'rail child root: no chip');
    await select('panel', 'B');
    {
      const b = await card('panel', 'B'), i = await inspector('panel');
      check('attribution:render:rail-child-scope-assigned-no-chip', b.who === 'Assigned to Session map-child' && b.chip === null && !!(await card('page', 'B')).chip);
      check('attribution:render:rail-child-scope-reason', i.live === '' && i.activity.startsWith('Not shown'));
    }
    await shot('rail-child-scope', '[data-testid="map-region"]', 12, 1600, 'panel');
    await evaluate(`qa.context('M');true`); await ready('panel');
    await wait('panel', 'w.mapPreview.attribution.B.live.proven', 'coordinator rail restored');
    // Hold old run data across a new session reading; releasing it must not revive proof.
    await evaluate(`qa.holds.push({path:'/v1/subagent-runs',frame:'panel',tag:'attribution-held'});true`);
    await wait('panel', `parent.qa.held.some(h=>h.tag==='attribution-held')`, 'held run reply');
    await evaluate(`qa.context('map-child');true`); await ready('panel');
    await evaluate(`qa.release('attribution-held');true`); await frames2();
    check('attribution:held-session-reply-retired', !(await proof('panel')).B.live.proven);
    // Legacy link-only data is an explicitly labelled read-fixture seam: the real modern link
    // operation records an assignee too, so the shell removes only L's assignee in the detail DTO.
    await select('page', 'L');
    {
      const l = await card('page', 'L'), i = await inspector('page'), p = (await proof('page')).L;
      check('attribution:render:legacy-link-only-data', p.recordedAssignee === null && !p.assignment && p.links.includes('map-linked'));
      check('attribution:render:legacy-link-only-card', l.attribution === 'linked' && l.who === 'Linked to Session map-linked · no verified delegation' && l.chip === null);
      check('attribution:render:legacy-link-only-inspector', i.assignment === 'linked' && i.assignmentText.startsWith('No assignee recorded') && i.links === 'Linked to Session map-linked · no verified delegation' && i.live === '');
    }
    await mapShot('link-only', 'page');
    await select('page', 'B');
    {
      const i = await inspector('page');
      check('attribution:render:repeated-relay-grouped', i.reports === 'Reported by Session M for Session map-child · 2 reports');
      check('attribution:render:relay-is-not-assignment', i.assignment === 'assigned' && i.assignmentText.startsWith('Assigned to Session map-child'));
    }
    await mapShot('repeated-relay-reports', 'page');
    await guest('page', `w.mapPreview.omitAttribution('B');return true`);
    await wait('page', `d.querySelector('[data-testid="map-card-B"]')?.dataset.attribution==='unavailable'`, 'missing optional projection painted');
    {
      const b = await card('page', 'B'), i = await inspector('page');
      check('attribution:render:missing-projection-card', b.attribution === 'unavailable' && b.who === null && b.chip === null);
      check('attribution:render:missing-projection-inspector', i.assignment === 'unavailable' && i.assignmentText.startsWith('Unavailable in this view') && i.activity.startsWith('Not shown'));
    }
    await mapShot('missing-projection', 'page');
    await guest('page', 'w.mapPreview.omitAttribution(null);return true');
    await wait('page', `d.querySelector('[data-testid="map-card-live-B"]')`, 'projection restored');
    // Real SDK workspace snapshots exercise both recordedLabel and host waiting qualification.
    const sessionRecords = (activity: string) => [
      { id: 'M', title: 'Coordinator', projectId: 'alpha', directory: '/fixture/main', parentId: null, archivedAt: null, worktree: null, activity: 'idle', outcome: null, items: [] },
      { id: 'map-child', title: 'Map worker', projectId: 'alpha', directory: '/fixture/main', parentId: 'M', archivedAt: null, worktree: null, activity, outcome: null, items: [] },
    ];
    await evaluate(`qa.sessionCoverage={alpha:[{directory:'/fixture/main',state:'ready'}]};qa.setSessions('alpha',${JSON.stringify(sessionRecords('running'))});true`);
    await wait('page', `d.querySelector('[data-testid="map-card-who-B"]')?.textContent==='Assigned to Map worker'`, 'verified host title');
    check('attribution:render:verified-source-host-title', (await card('page', 'B')).name.includes('Assigned to Map worker'));
    await mapShot('verified-host-title', 'page');
    await evaluate(`qa.setSessions('alpha',${JSON.stringify(sessionRecords('waiting-question'))});true`);
    await wait('page', `d.querySelector('[data-testid="map-card-live-B"]')?.dataset.live==='waiting'`, 'waiting session mark');
    {
      const b = await card('page', 'B'), i = await inspector('page');
      check('attribution:render:waiting-card', b.live === 'waiting' && b.chip === 'waiting' && b.name.includes('Assigned session waiting for input now, session activity only'));
      check('attribution:render:waiting-inspector', i.live === 'waiting' && i.activity.startsWith('Assigned session waiting for input now') && i.liveMark);
      check('attribution:render:waiting-mark-outlined', await guest('page', `const m=d.querySelector('[data-testid="map-card-live-B"]');return getComputedStyle(m).backgroundColor==='rgba(0, 0, 0, 0)'&&parseFloat(getComputedStyle(m).borderTopWidth)>0`));
    }
    await mapShot('waiting-session', 'page');
    await evaluate(`qa.setSessions('alpha',[]);true`);
    await wait('page', `d.querySelector('[data-testid="map-card-who-B"]')?.textContent==='Assigned to Session map-child'&&d.querySelector('[data-testid="map-card-live-B"]')?.dataset.live==='active'`, 'plain labels restored');
    const lastRevision = await guest<string>('page', `return d.querySelector('[data-testid="map-region"]').dataset.revision`);
    await evaluate(`qa.holds.push({path:'/v1/plan-graph',frame:'page',tag:'attribution-newer-graph'});true`);
    fx.reportMap('P-map', { op: 'change', changes: [{ id: 'I', status: 'working' }] });
    await wait('page', `parent.qa.held.some(h=>h.tag==='attribution-newer-graph')&&d.querySelector('[data-testid="map-region"]')?.dataset.current==='false'`, 'last reported picture during graph hold');
    {
      const b = await card('page', 'B'), i = await inspector('page');
      check('attribution:render:superseded-retains-revision', await guest('page', `return d.querySelector('[data-testid="map-region"]').dataset.revision===${JSON.stringify(lastRevision)}`));
      check('attribution:render:superseded-hides-live', b.attribution === 'assigned' && b.chip === null && i.live === '' && i.activity.endsWith(`Hidden while the map shows revision ${lastRevision} as last reported.`));
      check('attribution:render:superseded-status-last-reported', b.status === 'Reported working' && !(await proof('page')).B.live.proven);
    }
    await mapShot('superseded-picture', 'page');
    await evaluate(`qa.release('attribution-newer-graph');true`); await ready('page');
    await wait('page', `d.querySelector('[data-testid="map-card-live-B"]')?.dataset.live==='active'`, 'live resumes on matched revision');
    fx.mapAttribution!.terminal();
    await wait('page', '!w.mapPreview.attribution.B.live.proven', 'terminal run loses live proof');
    check('attribution:terminal-keeps-assignment-not-activity', !!(await proof('page')).B.assignment && !(await proof('page')).B.live.proven);
    check('attribution:terminal-zero-movement', JSON.stringify(await positions('page')) === JSON.stringify(coordinates));
    await wait('page', `!d.querySelector('[data-testid="map-card-live-B"]')`, 'terminal: chip removed');
    await select('page', 'B');
    {
      const b = await card('page', 'B'), i = await inspector('page');
      check('attribution:render:terminal-assigned-no-chip', b.who === 'Assigned to Session map-child' && b.chip === null);
      check('attribution:render:terminal-reason', i.assignment === 'assigned' && i.live === '' && i.activity.endsWith('The assigned session’s latest recorded run isn’t active now.'));
      check('attribution:render:terminal-no-box-moves', await boxes('page') === cardBoxes);
      check('attribution:render:terminal-no-running-words', await words('page'));
    }
    await shot('terminal-run', '[data-testid="map-region"]', 12, 1600);
    // Same child ID on a foreign source must keep its recorded label and get no borrowed activity.
    await evaluate(`qa.setSessions('alpha',${JSON.stringify(sessionRecords('running'))});true`);
    await guest('page', `w.mapPreview.source('source-beta');return true`); await ready('page');
    await select('page', 'B');
    {
      const b = await card('page', 'B'), i = await inspector('page'), p = (await proof('page')).B;
      check('attribution:render:foreign-source-no-assignment-or-live', p.recordedAssignee === 'map-child' && !p.assignment && !p.live.proven && b.attribution === 'recorded' && b.chip === null);
      check('attribution:render:foreign-source-no-host-title', b.who === 'Unverified assignee · Session map-child' && !b.name.includes('Map worker') && i.assignmentText.startsWith('Recorded assignee Session map-child'));
    }
    await mapShot('foreign-source', 'page');
    check('attribution:status-no-map-work', (await reqs(`r.frame==='status'&&r.path==='/v1/plan-graph'`)).length === 0);
    throw new OnlyDone();
  }
  if (onlyMapInteraction || onlyMapLarge) {
    const region = '[data-testid="map-region"]';
    const ready = (surface: string, revision = 1) => wait(surface, `d.querySelector('${region}')?.dataset.state==='ready'&&d.querySelector('${region}').dataset.revision==='${revision}'&&w.mapPreview?.state.initialFramingDone`, 'complete interactive preview');
    const command = (surface: string, event: object) => guest(surface, `return w.mapPreview.dispatch(${javascriptLiteral(event)})`);
    const state = (surface: string) => guest<any>(surface, 'return w.mapPreview.state');
    const mapShot = async (name: string, surface: string) => {
      const scroll = await guest<number>(surface, 'return w.scrollY');
      await shot(name, region, 0, 1200, surface);
      await guest(surface, `w.scrollTo(0,${scroll});return true`); await frames2();
    };
    const coordinates = (surface: string) => guest<any>(surface, `const v=d.querySelector('[data-testid="map-viewport"]').getBoundingClientRect();return {viewport:[v.x,v.y,v.width,v.height],scrollY:w.scrollY,world:w.mapPreview.coordinates,transform:w.mapPreview.state.transform,screen:Object.fromEntries([...d.querySelectorAll('[data-task]')].map(n=>{const r=n.getBoundingClientRect();return[n.dataset.task,[r.x,r.y,r.width,r.height]]}))}`);
    const inView = (surface: string, id: string) => guest<boolean>(surface, `const n=d.querySelector('[data-testid="map-card-${id}"]'),v=d.querySelector('[data-testid="map-viewport"]');if(!n||!v)return false;const a=n.getBoundingClientRect(),b=v.getBoundingClientRect();return n.matches('button')&&!n.disabled&&a.x>=b.x+7&&a.y>=b.y+7&&a.right<=b.right-7&&a.bottom<=b.bottom-7`);
    Object.assign(facts, { fixture: onlyMapLarge ? LARGE_PLAN_VERSION : 'dependency-map', seed: onlyMapLarge ? LARGE_PLAN_SEED : undefined, preview: true, inputCoverage: onlyMapLarge ? 'controller-dispatched timed actions through the bound shared view, plus two real CDP keyboard actions' : 'controller probes for setup', pendingDesigner: [], commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), previewHash: fx.previewHash });
    if (onlyMapInteraction) {
      for (const [surface, width] of [['page', 1100], ['panel', 360], ['panel', 600]] as const) {
        await show([surface], width); await ready(surface);
        const before = await state(surface);
        check(`interaction:${surface}-${width}:initial-work-frame`, before.initialFramingDone && (width === 600 ? before.selected === 'C' : before.selected === null && before.transform.zoom >= .75));
        await command(surface, { type: 'select', id: 'D' }); await frames2();
        check(`interaction:${surface}-${width}:target-in-view`, await inView(surface, 'D'));
        await command(surface, { type: 'pan', x: -17, y: 19 }); await command(surface, { type: 'zoom', factor: 1.2, point: { x: 100, y: 100 } });
        const moved = await state(surface), mark = await evaluate<number>('qa.replies.length');
        await wait(surface, `qa.replies.slice(${mark}).filter(r=>r.frame==='${surface}'&&r.path==='/v1/plans'&&r.status===200).length>=2`, 'two unchanged polls');
        check(`interaction:${surface}-${width}:poll-continuity`, JSON.stringify((await state(surface)).transform) === JSON.stringify(moved.transform) && (await state(surface)).selected === 'D');
        await command(surface, { type: 'filters', status: 'unfinished' }); await command(surface, { type: 'relation', id: 'A' }); await frames2();
        check(`interaction:${surface}-${width}:relation-reveals-only-hiding-filter`, (await state(surface)).selected === 'A' && (await state(surface)).status === 'all');
        await command(surface, { type: 'fit' }); await frames2();
        const z = (await state(surface)).transform.zoom;
        if (surface === 'panel') { await show(['panel'], width === 360 ? 600 : 360); await frames2(); await show(['panel'], width); await frames2(); check(`interaction:panel-${width}:resize-retains-zoom`, (await state(surface)).transform.zoom === z); }
        // Real shared list and canonical reveal, not a fabricated list. Native switches are preview-only.
        await click(surface, '[data-testid="plan-view-list"]');
        await wait(surface, `d.querySelector('[data-testid="item-B"]')`, 'canonical list');
        await click(surface, '[data-testid="item-B"]'); await click(surface, '[data-testid="plan-view-map"]'); await ready(surface);
        check(`interaction:${surface}-${width}:explicit-list-target`, (await state(surface)).selected === 'B');
        await command(surface, { type: 'select', id: 'C' }); await frames2();
        await click(surface, '[data-testid="map-list"] button'); await wait(surface, `d.activeElement?.dataset.testid==='item-C'`, 'canonical map-to-list reveal');
        check(`interaction:${surface}-${width}:canonical-return`, await guest(surface, `return d.querySelectorAll('[data-testid="item-C"]').length===1`));
        await click(surface, '[data-testid="plan-view-map"]'); await ready(surface);
        check(`interaction:${surface}-${width}:consumed-target-not-replayed`, (await state(surface)).selected === 'C');
        await shot(`${surface}-${width}-controller-preview`, region, 0, 1200, surface);
      }
      // ── Designer bindings through real CDP input (not controller probes): canvas Tab stop, scoped
      // keys, toolbar keyboard operation, background drag across a poll repaint, wheel, highlights,
      // inspector relations, the per-frame live region, handoff focus, resize and forced colours.
      const said = (surface: string) => guest<string[]>(surface, `if(!w.__said){w.__said=[];const n=d.querySelector('[data-testid="map-announcer"]');new w.MutationObserver(()=>{if(n.textContent)w.__said.push(n.textContent)}).observe(n,{childList:true,characterData:true,subtree:true})}return w.__said.slice()`);
      const active = (surface: string) => guest<any>(surface, `const a=d.activeElement;return {task:a?.dataset?.task??null,testid:a?.closest?.('[data-testid]')?.dataset.testid??null,tag:a?.tagName,inCanvas:!!a?.closest?.('[data-testid="map-viewport"]'),outline:a?getComputedStyle(a).outlineStyle+' '+getComputedStyle(a).outlineWidth:''}`);
      const focusOn = (surface: string, selector: string) => guest(surface, `const n=d.querySelector(${javascriptLiteral(selector)});n.focus();return d.activeElement===n`);
      const polls = async (surface: string, n = 2) => { const mark = await evaluate<number>('qa.replies.length'); await wait(surface, `parent.qa.replies.slice(${mark}).filter(r=>r.frame==='${surface}'&&r.path==='/v1/plans'&&r.status===200).length>=${n}`, `${n} completed polls`); };
      const background = (surface: string) => evaluate<[number, number] | null>(`(()=>{const fr=frame('${surface}'),d=fr.contentDocument,v=d.querySelector('[data-testid="map-viewport"]');v.scrollIntoView({block:'center'});const b=v.getBoundingClientRect(),o=fr.getBoundingClientRect();for(let y=b.bottom-14;y>b.top+10;y-=12)for(let x=b.right-14;x>b.left+10;x-=12){const n=d.elementFromPoint(x,y);if(n&&v.contains(n)&&!n.closest('button'))return [o.x+x,o.y+y]}return null})()`);
      const mouse = (type: string, x: number, y: number, extra: object = {}) => c.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, ...extra });
      const near = (a: number, b: number) => Math.abs(a - b) < 0.5;
      const settled = (surface: string) => wait(surface, `(()=>{const v=d.querySelector('[data-testid="map-viewport"]'),h=d.querySelector('[data-testid="preview-map-host"]');return v&&h&&Number(h.dataset.canvasWidth)===v.clientWidth})()`, 'measured canvas after resize');
      const realInput = async (surface: 'page' | 'panel', width: number) => {
        const tag = `${surface}-${width}`;
        await show([surface], width); await ready(surface); await said(surface);
        await command(surface, { type: 'select', id: 'C' }); await frames2();
        check(`interaction:${tag}:one-persistent-announcer`, await guest(surface, `const a=d.querySelectorAll('[data-testid="map-announcer"]');return a.length===1&&!d.getElementById('root').contains(a[0])&&a[0].getAttribute('aria-live')==='polite'`));
        check(`interaction:${tag}:one-canvas-tab-stop`, await guest(surface, `const v=d.querySelector('[data-testid="map-viewport"]'),cards=[...v.querySelectorAll('[data-task]')];return v.getAttribute('role')==='region'&&!!v.getAttribute('aria-label')&&cards.length>0&&cards.every(n=>n.tagName==='BUTTON')&&cards.filter(n=>n.tabIndex===0).length===1&&!d.querySelector('[data-testid="map-region"] [role="application"],[role="tree"],[role="grid"],[role="listbox"]')`));
        // Keyboard entry from the last toolbar control, then scoped keys.
        await focusOn(surface, '[data-testid="map-pan-right"]'); await key('Tab'); await frames2();
        let a = await active(surface);
        check(`interaction:${tag}:tab-enters-roving-card`, a.inCanvas && a.task === 'C' && /solid/.test(a.outline), undefined, a);
        await shot(`${tag}-keyboard-focus`, '[data-testid="map-viewport"]', 40, 900, surface);
        const heard = (await said(surface)).length;
        await key('ArrowRight'); await frames2(); a = await active(surface);
        check(`interaction:${tag}:arrow-selects-neighbour`, a.task === 'D' && (await state(surface)).selected === 'D', undefined, a);
        const spoken = (await said(surface)).slice(heard), focusedName = await guest<string>(surface, `return d.activeElement?.getAttribute('aria-label')??''`);
        // Selection speech once: a move that focuses the card is spoken from the card's own name, and
        // the live region stays quiet (no second copy). The name carries title, state and counts.
        check(`interaction:${tag}:selection-spoken-once`, spoken.length === 0 && /^Join both unfinished branches\. Waiting\./.test(focusedName) && /2 direct recorded prerequisites, 0 direct dependents/.test(focusedName), undefined, { spoken, focusedName });
        await key('['); await frames2(); a = await active(surface);
        check(`interaction:${tag}:bracket-first-prerequisite`, a.task === 'B' && (await state(surface)).selected === 'B', undefined, a);
        await key(']'); await frames2(); a = await active(surface);
        check(`interaction:${tag}:bracket-first-dependent`, a.task === 'D', undefined, a);
        let t = (await state(surface)).transform;
        await key('+'); await frames2();
        check(`interaction:${tag}:plus-zooms`, near((await state(surface)).transform.zoom, Math.min(2, t.zoom * 1.2)));
        await key('-'); await frames2(); t = (await state(surface)).transform;
        await key('+', 1, 2); await key('f', 1, 2); await frames2();
        check(`interaction:${tag}:modified-keys-not-intercepted`, JSON.stringify((await state(surface)).transform) === JSON.stringify(t));
        await key('f'); await frames2();
        check(`interaction:${tag}:F-fits-all`, JSON.stringify((await state(surface)).transform) !== JSON.stringify(t) && (await said(surface)).some(s => /^Fit all/.test(s)));
        await focusOn(surface, '[data-testid="map-group"]'); t = (await state(surface)).transform; await key('-'); await frames2();
        check(`interaction:${tag}:keys-ignored-outside-canvas`, JSON.stringify((await state(surface)).transform) === JSON.stringify(t));
        // Tab leaves forwards and Shift+Tab returns to the same roving card: no trap.
        await focusOn(surface, '[data-testid="map-card-D"]'); await key('Tab'); a = await active(surface);
        check(`interaction:${tag}:tab-leaves-canvas`, !a.inCanvas && a.tag === 'BUTTON', undefined, a);
        await key('Tab', 1, 8); a = await active(surface);
        check(`interaction:${tag}:shift-tab-returns-to-roving-card`, a.task === 'D', undefined, a);
        // Toolbar: keyboard operation and visible focus.
        await focusOn(surface, '[data-testid="map-pan-right"]'); await key('Tab', 1, 8); await key('Tab', 1, 8); await key('Tab', 1, 8); await key('Tab', 1, 8);
        a = await active(surface);
        check(`interaction:${tag}:toolbar-tab-order`, a.testid === 'map-focus-current' && /solid/.test(a.outline), undefined, a);
        t = (await state(surface)).transform; await focusOn(surface, '[data-testid="map-zoom-in"]'); await key('Enter'); await frames2();
        const zin = (await state(surface)).transform;
        await focusOn(surface, '[data-testid="map-pan-left"]'); await key(' '); await frames2();
        const panned = (await state(surface)).transform;
        await focusOn(surface, '[data-testid="map-fit-all"]'); await key('Enter'); await frames2();
        await focusOn(surface, '[data-testid="map-focus-current"]'); await key('Enter'); await frames2();
        const toolSaid = await said(surface);
        check(`interaction:${tag}:toolbar-keyboard-operable`, zin.zoom > t.zoom && panned.x > zin.x && near(panned.y, zin.y) && toolSaid.some(s => /^Zoom /.test(s)) && toolSaid.some(s => /^View moved left/.test(s)) && toolSaid.some(s => /^Focused current reported work/.test(s)), undefined, { t, zin, panned, toolSaid: toolSaid.slice(-4) });
        // Background drag with a captured pointer across poll repaints; cards never drag.
        await command(surface, { type: 'select', id: 'D' }); await frames2();
        let p = await background(surface); if (!p) throw Error(`no map background in ${tag}`);
        t = (await state(surface)).transform;
        await mouse('mouseMoved', p[0], p[1], { buttons: 0 }); await mouse('mousePressed', p[0], p[1]);
        await mouse('mouseMoved', p[0] - 10, p[1] - 6); await mouse('mouseMoved', p[0] - 20, p[1] - 12);
        await polls(surface, 1); await frames2();
        const mid = await guest<any>(surface, `const v=d.querySelector('[data-testid="map-viewport"]');return {captured:v.hasPointerCapture(1),dragging:w.mapPreview.state.dragging,active:d.activeElement?.dataset?.task??null}`);
        await mouse('mouseMoved', p[0] - 30, p[1] - 18); await mouse('mouseMoved', p[0] - 40, p[1] - 24); await mouse('mouseReleased', p[0] - 40, p[1] - 24); await frames2();
        const after = await state(surface);
        check(`interaction:${tag}:captured-drag-survives-poll-repaint`, mid.captured && mid.dragging !== null && near(after.transform.x, t.x - 40) && near(after.transform.y, t.y - 24) && after.dragging === null && after.selected === 'D', undefined, { mid, t, after: after.transform });
        await mapShot(`${tag}-pan-zoom`, surface);
        t = after.transform; p = (await background(surface))!;
        await c.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: p[0], y: p[1], deltaX: 30, deltaY: 50 }); await frames2();
        const wheeled = (await state(surface)).transform;
        // Ctrl/Cmd wheel is browser zoom: a labelled synthetic event (real Ctrl+wheel would zoom this
        // browser) proves the canvas neither consumes nor cancels it.
        const browserZoomKept = await guest<boolean>(surface, `const v=d.querySelector('[data-testid="map-viewport"]');return v.dispatchEvent(new w.WheelEvent('wheel',{deltaY:50,ctrlKey:true,bubbles:true,cancelable:true}))&&v.dispatchEvent(new w.WheelEvent('wheel',{deltaY:50,metaKey:true,bubbles:true,cancelable:true}))`); await frames2();
        check(`interaction:${tag}:wheel-pans-canvas-ctrl-wheel-left-to-browser`, near(wheeled.x, t.x - 30) && near(wheeled.y, t.y - 50) && browserZoomKept && JSON.stringify((await state(surface)).transform) === JSON.stringify(wheeled), undefined, { t, wheeled, browserZoomKept });
        const card = await evaluate<[number, number]>(`(()=>{const fr=frame('${surface}'),n=fr.contentDocument.querySelector('[data-testid="map-card-D"]');n.scrollIntoView({block:'center'});const r=n.getBoundingClientRect(),o=fr.getBoundingClientRect();return [o.x+r.x+r.width/2,o.y+r.y+r.height/2]})()`);
        t = (await state(surface)).transform;
        await mouse('mouseMoved', card[0], card[1], { buttons: 0 }); await mouse('mousePressed', card[0], card[1]); await mouse('mouseMoved', card[0] + 30, card[1] + 20); await mouse('mouseReleased', card[0] + 30, card[1] + 20); await frames2();
        check(`interaction:${tag}:cards-not-draggable`, JSON.stringify((await state(surface)).transform) === JSON.stringify(t));
        // Upstream/downstream highlights by real card clicks; every direct relation via the inspector.
        // Fit all first so every card is on screen for real pointer clicks at any width.
        await command(surface, { type: 'select', id: 'C' }); await command(surface, { type: 'fit' }); await frames2(); await click(surface, '[data-testid="map-card-D"]'); await frames2();
        const marks = () => guest<Record<string, string>>(surface, `return Object.fromEntries([...d.querySelectorAll('[data-task]')].map(n=>[n.dataset.task,n.dataset.related??(n.getAttribute('aria-current')?'selected':'')]))`);
        let m = await marks();
        check(`interaction:${tag}:upstream-highlight`, (await state(surface)).selected === 'D' && m.A === 'upstream' && m.B === 'upstream' && m.C === 'upstream' && m.D === 'selected' && !Object.values(m).includes('downstream') && await guest(surface, `return [...d.querySelectorAll('path[data-path]')].length===4&&[...d.querySelectorAll('path[data-path]')].every(p=>p.dataset.path==='upstream')&&/Upstream of the selected task/.test(d.querySelector('[data-testid="map-card-B"]').getAttribute('aria-label'))`), undefined, m);
        if (surface === 'page' || width === 360) await mapShot(surface === 'page' ? 'upstream-highlight' : 'rail-upstream-highlight', surface);
        for (const rid of ['B', 'C']) {
          await command(surface, { type: 'select', id: 'D' }); await frames2(); await click(surface, `[data-testid="map-relation-${rid}"]`); await frames2();
          a = await active(surface);
          check(`interaction:${tag}:inspector-relation-${rid}`, (await state(surface)).selected === rid && a.task === rid, undefined, a);
        }
        await command(surface, { type: 'select', id: 'C' }); await command(surface, { type: 'fit' }); await frames2(); await click(surface, '[data-testid="map-card-A"]'); await frames2(); m = await marks();
        check(`interaction:${tag}:downstream-highlight`, ['B', 'C', 'D', 'E', 'F'].every(id => m[id] === 'downstream') && m.A === 'selected' && !Object.values(m).includes('upstream'), undefined, m);
        if (surface === 'page') await mapShot('downstream-highlight', surface);
        // Filters through real input: the pressed pair, the group select by keyboard, then the no-match clear.
        await click(surface, '[data-testid="map-status-unfinished"]'); await frames2();
        const ids = () => guest<string[]>(surface, `return [...d.querySelectorAll('[data-task]')].map(n=>n.dataset.task)`);
        check(`interaction:${tag}:unfinished-pressed-filter`, (await state(surface)).status === 'unfinished' && !(await ids()).some(id => ['A', 'S'].includes(id)) && await guest(surface, `return d.querySelector('[data-testid="map-status-unfinished"] button').getAttribute('aria-pressed')==='true'`));
        await focusOn(surface, '[data-testid="map-group"]'); await key('ArrowDown', 2); await frames2();
        check(`interaction:${tag}:no-match-one-named-target`, (await state(surface)).group === 'G' && (await ids()).length === 0 && await guest(surface, `const v=d.querySelector('[data-testid="map-viewport"]');return v.tabIndex<0&&v.querySelectorAll('button').length===1&&/Show all tasks/.test(v.querySelector('button').textContent)`));
        await click(surface, '[data-testid="map-clear-filters"]'); await frames2();
        check(`interaction:${tag}:no-match-clear`, (await state(surface)).status === 'all' && (await state(surface)).group === null && (await ids()).length === 9 && (await said(surface)).some(s => /^9 tasks shown/.test(s)));
        // Two ordinary polls without user action speak nothing.
        const quiet = (await said(surface)).length; await polls(surface, 2);
        check(`interaction:${tag}:polls-silent`, (await said(surface)).length === quiet);
        // Review regression: passive focus restoration after a poll repaint must not undo the reader's
        // pan; genuine keyboard entry still pans the roving card into view.
        await focusOn(surface, '[data-testid="map-pan-right"]'); await key('Tab'); a = await active(surface);
        const rover = a.task as string;
        p = (await background(surface))!;
        await c.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: p[0], y: p[1], deltaX: 3000, deltaY: 0 }); await frames2();
        const away = (await state(surface)).transform;
        check(`interaction:${tag}:wheel-away-keeps-focus`, !!rover && (await active(surface)).task === rover && !(await inView(surface, rover)));
        await polls(surface, 2); await frames2();
        check(`interaction:${tag}:passive-restore-keeps-pan`, JSON.stringify((await state(surface)).transform) === JSON.stringify(away) && (await active(surface)).task === rover && !(await inView(surface, rover)), undefined, { away, after: (await state(surface)).transform });
        await key('Tab', 1, 8); await key('Tab'); await frames2();
        check(`interaction:${tag}:keyboard-reentry-reveals`, (await active(surface)).task === rover && await inView(surface, rover));
        check(`interaction:${tag}:no-animated-transitions`, await guest(surface, `return [...d.querySelectorAll('[data-testid="map-region"] *')].every(n=>getComputedStyle(n).transitionDuration.split(',').every(v=>parseFloat(v)===0))&&d.getAnimations().length===0`));
      };
      await realInput('page', 1100);
      // Review regressions: a focus action ends with its turn, consumed or not.
      await focusOn('page', '[data-testid="map-card-D"]'); await key('ArrowLeft'); await frames2(); await key('Tab'); const moved = await active('page');
      await polls('page', 2); await frames2();
      check('interaction:focus-action-ends-after-user-moves', !moved.inCanvas && JSON.stringify(await active('page')) === JSON.stringify(moved), undefined, { moved, now: await active('page') });
      await focusOn('page', '[data-testid="map-zoom-in"]'); await command('page', { type: 'filters', status: 'unfinished' }); await frames2();
      await guest('page', `w.mapPreview.repaint();w.mapPreview.viewCommand({type:'focus',id:'A',generation:w.mapPreview.state.generation});return true`); await frames2();
      await command('page', { type: 'filters', status: 'all' }); await frames2(); await polls('page', 1); await frames2();
      check('interaction:focus-action-with-missing-target-expires', (await active('page')).testid === 'map-zoom-in' && await guest('page', `return !!d.querySelector('[data-testid="map-card-A"]')`), undefined, await active('page'));
      // Review regressions: a deferred repeat announcement never overwrites a newer message, and
      // never survives leaving Map (the live region outlives the repainted root).
      const tools = (...ids: string[]) => guest('page', `for(const id of ${javascriptLiteral(ids)})(d.querySelector('[data-testid="'+id+'"] button')??d.querySelector('[data-testid="'+id+'"]')).click();return true`);
      const announcerText = () => guest<string>('page', `return d.querySelector('[data-testid="map-announcer"]').textContent`);
      await tools('map-pan-left', 'map-pan-left', 'map-pan-up'); await frames2(); await frames2();
      check('interaction:repeat-announcement-yields-to-newer', await announcerText() === 'View moved up.', undefined, await announcerText());
      await tools('map-pan-left', 'map-pan-left', 'plan-view-list'); await wait('page', `d.querySelector('[data-testid="item-B"]')`, 'list after leaving map'); await frames2(); await frames2();
      check('interaction:repeat-announcement-retired-with-map', await announcerText() === '' && await guest('page', `return d.querySelectorAll('[data-testid="map-announcer"]').length===1`), undefined, await announcerText());
      await click('page', '[data-testid="plan-view-map"]'); await ready('page');
      await theme('dark'); await focusOn('page', '[data-testid="map-card-A"]'); await key('ArrowRight'); await frames2();
      await shot('keyboard-focus-dark', '[data-testid="map-viewport"]', 40, 900, 'page'); await theme('light');
      await focusOn('page', '[data-testid="map-card-A"]'); await key('ArrowRight'); await frames2(); await shot('keyboard-focus', '[data-testid="map-viewport"]', 40, 900, 'page');
      await c.send('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: 'active' }, { name: 'prefers-reduced-motion', value: 'reduce' }] });
      await command('page', { type: 'select', id: 'D' }); await frames2(); await focusOn('page', '[data-testid="map-card-D"]'); await key('ArrowLeft'); await key('ArrowRight'); await frames2();
      check('interaction:forced-colors-system-marks', await guest('page', `const p=d.querySelector('path[data-path]'),c=d.querySelector('[data-related="upstream"]');return w.matchMedia('(forced-colors: active)').matches&&!!p&&getComputedStyle(p).strokeWidth==='3px'&&getComputedStyle(c).borderTopStyle==='solid'&&!!d.querySelector('.ap-map-card-rel')`));
      await mapShot('forced-colors', 'page');
      await c.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
      for (const width of [360, 600] as const) await realInput('panel', width);
      // Rail List → Map handoff through the real canonical list, with focus still on the switch.
      await show(['panel'], 360); await ready('panel');
      await click('panel', '[data-testid="plan-view-list"]'); await wait('panel', `d.querySelector('[data-testid="item-E"]')`, 'canonical list');
      await click('panel', '[data-testid="item-E"]'); const handoffMark = (await said('panel')).length;
      await click('panel', '[data-testid="plan-view-map"]'); await ready('panel'); await wait('panel', `d.activeElement?.dataset?.task==='E'`, 'handoff focus on the list target');
      const handoffSaid = (await said('panel')).slice(handoffMark), handoffName = await guest<string>('panel', `return d.activeElement?.getAttribute('aria-label')??''`);
      // The handoff focuses the card, so its name is the one spoken selection; the live region stays quiet.
      check('interaction:rail-handoff-focus-and-one-spoken-selection', (await state('panel')).selected === 'E' && await inView('panel', 'E') && handoffSaid.length === 0 && /^Sole remaining prerequisite\./.test(handoffName), undefined, { handoffSaid, handoffName });
      check('interaction:rail-switch-pressed-group', await guest('panel', `const g=d.querySelector('[data-testid="plan-view"]');return g.getAttribute('role')==='group'&&/Plan view/.test(d.getElementById(g.getAttribute('aria-labelledby')).textContent)&&g.querySelector('[data-testid="plan-view-map"] button').getAttribute('aria-pressed')==='true'&&g.querySelector('[data-testid="plan-view-list"] button').getAttribute('aria-pressed')==='false'`));
      await shot('rail-list-handoff', '[data-testid="progress-root"]', 12, 1100, 'panel');
      await shot('rail-keyboard-focus', '[data-testid="map-viewport"]', 40, 900, 'panel');
      // Resize 360 → 600 → 360 keeps the selected card visible, the zoom and full coverage.
      const z = (await state('panel')).transform.zoom, cardsBefore = await guest<number>('panel', `return d.querySelectorAll('[data-task]').length`);
      await show(['panel'], 600); await settled('panel');
      check('interaction:rail-resize-600-keeps-selection-visible', (await state('panel')).selected === 'E' && await inView('panel', 'E') && (await state('panel')).transform.zoom === z && await guest<number>('panel', `return d.querySelectorAll('[data-task]').length`) === cardsBefore);
      await shot('rail-resize', '[data-testid="progress-root"]', 12, 1100, 'panel');
      await show(['panel'], 360); await settled('panel');
      check('interaction:rail-resize-360-keeps-selection-visible', (await state('panel')).selected === 'E' && await inView('panel', 'E') && (await state('panel')).transform.zoom === z && await guest('panel', `return d.documentElement.scrollWidth<=w.innerWidth+1`));
      // Two frames: a page poll neither steals the rail's focus nor speaks for it.
      await show(['page', 'panel'], 600); await ready('page'); await ready('panel');
      await focusOn('panel', '[data-testid="map-card-E"]'); await key('ArrowLeft'); await frames2();
      const pageSaid = (await said('page')).length, railSaid = (await said('panel')).length, railFocus = (await active('panel')).task;
      await polls('page', 2);
      check('interaction:other-frame-poll-no-focus-theft-or-speech', await evaluate(`document.activeElement===frame('panel')`) && (await active('panel')).task === railFocus && (await said('page')).length === pageSaid && (await said('panel')).length === railSaid);
      // A structural update keeps the selected card in view (both frames show the same plan).
      await show(['page'], 1100); await ready('page'); await command('page', { type: 'select', id: 'D' }); await frames2();
      const oldRevision = await guest<string>('page', `return d.querySelector('${region}').dataset.revision`);
      fx.reportMap('P-map', { op: 'revise', items: [...mapItems, { id: 'J', title: 'Newly recorded follow-up', kind: 'task', dependencies: ['D'] }] });
      await wait('page', `d.querySelector('${region}')?.dataset.state==='ready'&&d.querySelector('${region}').dataset.revision!==${javascriptLiteral(oldRevision)}&&d.querySelector('[data-testid="map-card-J"]')`, 'structural revision');
      await frames2();
      check('interaction:structural-update-keeps-selection-in-view', (await state('page')).selected === 'D' && await inView('page', 'D'));
      await mapShot('structural-anchor', 'page');
      // Review regression: frame ownership alone does not mean the initial, unselected roving
      // card held focus. A surviving toolbar/switch control must keep focus across its removal.
      for (const target of ['toolbar', 'switch', 'canvas'] as const) {
        fx.reportMap('P-map-none', { op: 'revise', items: [{ id: 'A', title: 'First task', kind: 'task' }, { id: 'B', title: 'Second task', kind: 'task' }] });
        const sequence = await evaluate<number>(`qa.reload('page')`);
        await wait('page', `qa.loaded.page===${sequence}&&d.querySelector('${region}')?.dataset.state==='ready'`, 'reloaded map before removal regression');
        await guest('page', `const picker=d.querySelector('[data-testid="map-plan"]');picker.value='P-map-none';picker.dispatchEvent(new w.Event('change',{bubbles:true}));return true`);
        await wait('page', `d.querySelector('${region}')?.dataset.state==='ready'&&d.querySelector('[data-testid="map-card-A"]')&&d.querySelector('[data-testid="map-card-B"]')&&w.mapPreview.state.selected===null`, 'fresh unselected edgeless map');
        if (target === 'canvas') { await focusOn('page', '[data-testid="map-pan-right"]'); await key('Tab'); }
        else await click('page', target === 'toolbar' ? '[data-testid="map-zoom-in"]' : '[data-testid="plan-view-map"] button');
        await frames2();
        const focusBefore = await active('page'), noticeMark = (await said('page')).length;
        check(`interaction:removed-roving-${target}:unselected-setup`, (await state('page')).selected === null && (await state('page')).roving === 'A' && (target === 'canvas' ? focusBefore.task === 'A' : focusBefore.testid === (target === 'toolbar' ? 'map-zoom-in' : 'plan-view-map')));
        fx.reportMap('P-map-none', { op: 'revise', items: [{ id: 'B', title: 'Second task', kind: 'task' }] });
        await wait('page', `d.querySelector('${region}')?.dataset.state==='ready'&&!d.querySelector('[data-testid="map-card-A"]')&&w.mapPreview.state.roving==='B'`, 'removed initial roving card');
        await frames2(); await polls('page', 1); await frames2();
        const focusAfter = await active('page'), notices = (await said('page')).slice(noticeMark);
        check(`interaction:removed-roving-${target}:focus-and-notice`, (await state('page')).selected === null && (target === 'canvas' ? focusAfter.task === 'B' && notices.length === 1 && /focused task is no longer recorded/.test(notices[0]) : focusAfter.testid === focusBefore.testid && notices.length === 0), undefined, { focusBefore, focusAfter, notices });
      }
      facts.inputCoverage = 'real CDP keyboard, pointer, wheel and click input on Designer bindings, plus controller probes for setup';
      facts.pendingDesigner = [];
      replies = await evaluate('qa.replies');
      check('interaction:no-proxy-errors', JSON.stringify(await evaluate('qa.errors')) === '[]');
      check('interaction:no-guest-errors', pageErrors().length === 0);
      throw new OnlyDone();
    }
    const variants: Record<string, unknown> = {}; perf.variants = variants;
    for (const [index, [surface, width]] of ([['page', 1100], ['panel', 360], ['panel', 600]] as const).entries()) {
      if (index) {
        await fx.stop(); fx = await startSearchShell(built, false, 'dependency-map-large'); origin = `http://127.0.0.1:${fx.port}`;
        await c.send('Page.navigate', { url: `${origin}/` });
      }
      const name = `${surface}-${width}`, destination = join(artifacts, name); mkdirSync(destination, { recursive: true });
      await show([surface], width); await evaluate(`qa.visibility('${surface === 'page' ? 'panel' : 'page'}',false);document.querySelector('iframe[data-frame="${surface}"]').style.height='850px';true`);
      await ready(surface);
      const sampleLoads: number[] = [], streams: unknown[] = [];
      for (let sample = 0; sample < 4; sample++) {
        const start = await now(), mark = await evaluate<number>('qa.replies.length'); await evaluate(`qa.reload('${surface}')`); await ready(surface); await frames2();
        const elapsed = await now() - start, reads = await evaluate<any[]>(`qa.replies.slice(${mark}).filter(r=>r.frame==='${surface}')`);
        if (sample) { sampleLoads.push(elapsed); streams.push({ requests: reads.length, bytes: reads.reduce((n,r)=>n+r.bytes,0), detail: reads.filter(r=>r.path==='/v1/plan').length, graph: reads.filter(r=>r.path==='/v1/plan-graph').length }); }
      }
      const load = stats(sampleLoads), actions: Record<string, unknown> = {}, replayResults: unknown[] = [];
      const budget = (id: string, observation: ReturnType<typeof stats>, limit: number) => { gates.push({ id: `${name}:${id}`, pass: observation.median <= limit, observed: observation, limit: `median ≤${limit} ms` }); };
      budget('load', load, 2000);
      async function action(label: string, setup: object, event: object) {
        const times: number[] = [];
        for (let sample = 0; sample < 4; sample++) { await command(surface, setup); await frames2(); const start = await now(); await command(surface, event); await frames2(); if (sample) times.push(await now() - start); }
        const observation = stats(times); actions[label] = observation; budget(label, observation, 500);
      }
      await action('select-inspect', { type: 'select', id: 'T-00-00' }, { type: 'select', id: 'T-01-00' });
      await action('unfinished', { type: 'filters', status: 'all' }, { type: 'filters', status: 'unfinished' });
      await action('show-all', { type: 'filters', status: 'unfinished' }, { type: 'filters', status: 'all' });
      await action('group-filter', { type: 'filters', group: null }, { type: 'filters', group: 'G-10' });
      await action('group-reset', { type: 'filters', group: 'G-10' }, { type: 'filters', group: null });
      await action('upstream', { type: 'select', id: 'T-01-00' }, { type: 'key', key: '[', canvas: true });
      await action('downstream', { type: 'select', id: 'T-00-00' }, { type: 'key', key: ']', canvas: true });
      await action('fit-all', { type: 'current' }, { type: 'fit' });
      await action('neighbour', { type: 'select', id: 'T-00-00' }, { type: 'key', key: 'ArrowRight', canvas: true });
      await action('pan', { type: 'fit' }, { type: 'pan', x: -30, y: 20 });
      await action('zoom', { type: 'fit' }, { type: 'zoom', factor: 1.2 });
      // Real CDP input through the shared view's bindings: a scoped arrow key on the focused card and a
      // keyboard-activated toolbar Fit all, each timed to its settled frame.
      async function realAction(label: string, setup: () => Promise<unknown>, input: () => Promise<unknown>, settled: string) {
        const times: number[] = [];
        for (let sample = 0; sample < 4; sample++) { await setup(); await frames2(); const start = await now(); await input(); await wait(surface, settled, label); await frames2(); if (sample) times.push(await now() - start); }
        const observation = stats(times); actions[label] = { ...observation, input: 'real CDP keyboard' }; budget(label, observation, 500);
      }
      await realAction('real-key-neighbour', async () => { await command(surface, { type: 'select', id: 'T-00-00' }); await frames2(); await guest(surface, `d.querySelector('[data-testid="map-card-T-00-00"]').focus();return true`); }, () => key('ArrowRight'), `d.activeElement?.dataset?.task&&d.activeElement.dataset.task!=='T-00-00'&&w.mapPreview.state.selected===d.activeElement.dataset.task`);
      await realAction('real-toolbar-fit-all', async () => { await command(surface, { type: 'current' }); await guest(surface, `w.__fit=JSON.stringify(w.mapPreview.state.transform);d.querySelector('[data-testid="map-fit-all"]').focus();return true`); }, () => key('Enter'), `JSON.stringify(w.mapPreview.state.transform)!==w.__fit&&d.querySelector('[data-testid="map-world"]').style.getPropertyValue('--ap-map-zoom')===String(w.mapPreview.state.transform.zoom)`);
      await command(surface, { type: 'current' }); await command(surface, { type: 'select', id: 'T-10-24' }); await frames2();
      const dom = await guest(surface, `return {cards:d.querySelectorAll('[data-task]').length,svg:d.querySelectorAll('svg').length,edges:d.querySelectorAll('path[data-from]').length,nodes:d.querySelectorAll('*').length,viewport:{width:w.innerWidth,height:w.innerHeight}}`);
      check(`map-large:${name}:full-plan`, dom.cards === 980 && dom.edges === 2000, undefined, dom);
      await mapShot(`${name}/map-ready`, surface);
      for (const step of fx.largePlan!.steps.slice(1)) {
        const before = await coordinates(surface); const commit = performance.now(); fx.largePlan!.advance(step.id);
        await ready(surface, step.revision); await frames2(); const elapsed = performance.now() - commit, after = await coordinates(surface);
        const moved = Object.keys(after.world).filter(id => before.world[id] && JSON.stringify(before.world[id]) !== JSON.stringify(after.world[id]));
        const screenMoved = Object.keys(after.screen).filter(id => before.screen[id] && JSON.stringify(before.screen[id]) !== JSON.stringify(after.screen[id]));
        gates.push({ id: `${name}:${step.id}:visible`, pass: elapsed <= 8000, observed: elapsed, limit: '≤8000 ms per observation' });
        if (step.id === 'S4') check(`map-large:${name}:S4:no-topology-relocation`, moved.length === 0 && JSON.stringify(before.transform) === JSON.stringify(after.transform));
        if (['S1','S2','S3','S8'].includes(step.id)) check(`map-large:${name}:${step.id}:zero-movement`, moved.length === 0 && screenMoved.length === 0 && JSON.stringify(before.transform) === JSON.stringify(after.transform), undefined, { moved: moved.length, screenMoved: screenMoved.length, transformBefore: before.transform, transformAfter: after.transform, firstBefore: Object.values(before.screen)[0], firstAfter: Object.values(after.screen)[0], viewportBefore:before.viewport,viewportAfter:after.viewport,scrollBefore:before.scrollY,scrollAfter:after.scrollY });
        if (step.id === 'S5') { check(`map-large:${name}:selected-card-fully-in-view`, await inView(surface, 'T-10-24')); await mapShot(`${name}/map-after-structural`, surface); await command(surface, { type: 'select', id: 'T-19-48' }); await frames2(); }
        if (step.id === 'S6' || step.id === 'S7') check(`map-large:${name}:${step.id}:removed-state-retired`, (await state(surface)).selected !== 'T-19-48');
        replayResults.push({ step: step.id, visibleMs: elapsed, moved: moved.length, screenMoved: screenMoved.length });
      }
      const mark = await evaluate<number>('qa.replies.length'), layouts = await guest<number>(surface, 'return w.mapPreview.cpu.layouts');
      await wait(surface, `qa.replies.slice(${mark}).filter(r=>r.frame==='${surface}'&&r.path==='/v1/plans'&&r.status===200).length>=2`, 'two completed unchanged polls');
      const idle = await evaluate<any[]>(`qa.replies.slice(${mark}).filter(r=>r.frame==='${surface}')`);
      check(`map-large:${name}:unchanged-polls-no-graph-detail-layout`, !idle.some(r=>r.path==='/v1/plan'||r.path==='/v1/plan-graph') && await guest<number>(surface, 'return w.mapPreview.cpu.layouts') === layouts);
      // A real paged read is held across visibility retirement, then released. A visible peer's
      // two ordinary polls bound the observation without assuming/subtracting a poll interval.
      const peer = surface === 'page' ? 'panel' : 'page';
      await evaluate(`qa.holds.push({tag:'map-large-hidden',path:'/v1/plan',frame:'${surface}',cursor:true});qa.reload('${surface}');true`);
      await wait(surface, `qa.held.some(h=>h.tag==='map-large-hidden')`, 'held large-map detail continuation');
      await evaluate(`qa.visibility('${surface}',false);qa.visibility('${peer}',true);true`); await frames2();
      const requestMark = await evaluate<number>('qa.requests.length'), pollMark = await evaluate<number>('qa.replies.length');
      const renderMark = await guest<number>(surface, 'return w.mapPreview.cpu.render.length');
      await evaluate(`qa.release('map-large-hidden');true`);
      await wait(peer, `qa.replies.slice(${pollMark}).filter(r=>r.frame==='${peer}'&&r.path==='/v1/plans'&&r.status===200).length>=2`, 'visible-peer polls after hidden release');
      const hiddenRequests = await evaluate<any[]>(`qa.requests.slice(${requestMark}).filter(r=>r.frame==='${surface}')`);
      const hiddenRenders = await guest<number>(surface, 'return w.mapPreview.cpu.render.length') - renderMark;
      check(`map-large:${name}:hidden-read-neither-continues-nor-paints`, hiddenRequests.length === 0 && hiddenRenders === 0, undefined, { requests: hiddenRequests.length, renders: hiddenRenders });
      await evaluate(`qa.visibility('${surface}',true);qa.visibility('${peer}',false);true`); await ready(surface, 9); await frames2();
      await theme('dark'); await mapShot(`${name}/map-dark-narrow`, surface);
      const cpu = await guest(surface, 'return w.mapPreview.cpu'), requests = await evaluate('qa.replies');
      const summary = { preview: true, input: 'controller-dispatched timed actions through the bound shared view, plus real CDP keyboard actions (real-key-neighbour, real-toolbar-fit-all); pointer/keyboard reachability is proven by dependency-map-interaction', fixture: LARGE_PLAN_VERSION, seed: LARGE_PLAN_SEED, surface, width, frameHeight: 850, browser: browserVersion, runtime: process.version, service: built ? 'built' : 'typescript', serviceHash: createHash('sha256').update(readFileSync('build/service/main.js')).digest('hex'), commit: facts.commit, previewHash: fx.previewHash, load, streams, actions, dom, cpu: { ...cpu, label: 'layout and shared view render CPU; not compositor time' }, hidden: { requests: hiddenRequests.length, renders: hiddenRenders, completedPeerPolls: 2 }, replay: replayResults, budgets: gates.filter(g=>g.id.startsWith(name)) };
      variants[name] = summary;
      writeFileSync(join(destination, 'performance.json'), JSON.stringify(summary, null, 2)+'\n');
      writeFileSync(join(destination, 'requests.json'), JSON.stringify(requests, null, 2)+'\n');
      writeFileSync(join(destination, 'results.json'), JSON.stringify({ checks: results.filter(r=>r.id.includes(name)), preview: true }, null, 2)+'\n');
      replies.push(...requests);
      check(`map-large:${name}:no-proxy-errors`, JSON.stringify(await evaluate('qa.errors')) === '[]');
      check(`map-large:${name}:no-guest-errors`, pageErrors().length === 0);
    }
    for (const g of gates) check(`map-large:budget:${g.id}`, g.pass, [g.limit], g.observed);
    throw new OnlyDone();
  }

  if (onlyMapRender) {
    Object.assign(facts, { mode: 'dependency-map-render', preview: true, fixture: 'dependency-map-v1', runtime: process.version, commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), previewHash: fx.previewHash, serviceHash: createHash('sha256').update(readFileSync('build/service/main.js')).digest('hex'), visualSignoff: 'evidence/dependency-map/render/design-signoff.md' });
    const region = '[data-testid="map-region"]';
    const ready = (f = 'page') => wait(f, `d.querySelector('${region}')?.dataset.state==='ready'&&d.querySelector('[data-testid="map-world"]')`);
    const select = async (f: string, id: string, value: string) => { await guest(f, `const n=d.querySelector('[data-testid="${id}"]');n.value=${javascriptLiteral(value)};n.dispatchEvent(new Event('change',{bubbles:true}));return true`); await frames2(); };
    const plan = async (id: string, f = 'page') => { await select(f, 'map-plan', id); await ready(f); };
    // Show all / Unfinished is the list's pressed-button pair (map-status-{all,unfinished}).
    const showTasks = async (f: string, value: 'all' | 'unfinished') => { await guest(f, `d.querySelector('[data-testid="map-status-${value}"] button').click();return true`); await frames2(); };
    const snapshot = (f: string) => guest<any>(f, `const n=d.querySelector('${region}');return {tasks:n.dataset.tasks,edges:n.dataset.edges,cards:[...n.querySelectorAll('[data-task]')].map(n=>({id:n.dataset.task,x:n.dataset.x,y:n.dataset.y,status:n.dataset.status,readiness:n.dataset.readiness,unlocks:n.dataset.unlocks})),pairs:[...n.querySelectorAll('path[data-from]')].map(n=>[n.dataset.from,n.dataset.to]),arrows:[...n.querySelectorAll('path[data-from]')].every(n=>!!n.getAttribute('marker-end'))}`);
    await show(['page'], 1100); await ready();
    const initial = await snapshot('page');
    const expected = mapItems.filter(i => i.kind === 'task').flatMap(i => (i.dependencies ?? []).map(d => [d, i.id]));
    const pairs = (v: unknown[]) => JSON.stringify(v.map(x => JSON.stringify(x)).sort());
    check('render:explicit-directed-pairs', pairs(initial.pairs) === pairs(expected) && initial.arrows);
    check('render:arrow-geometry-direction', await guest('page', `return [...d.querySelectorAll('path[data-from]')].every(p=>{const a=p.getPointAtLength(0),b=p.getPointAtLength(p.getTotalLength());return a.x<b.x})`));
    check('render:full-task-coverage-no-group-substitution', initial.cards.length === mapItems.filter(i => i.kind === 'task').length && initial.cards.every((i: any) => !i.id.startsWith('G')));
    check('render:no-false-unlock', initial.cards.every((i: any) => !i.unlocks.split(',').includes('F')));
    check('render:skipped-is-not-done', initial.cards.find((i: any) => i.id === 'W').readiness === 'skipped' && initial.cards.find((i: any) => i.id === 'S').unlocks === '');
    check('render:literal-text', await guest('page', `return d.body.textContent.includes('<img src=x onerror=alert(1)>')&&!d.querySelector('${region} img')`));
    // Semantic claims use rendered text / accessible card names, not readiness data attributes.
    const cardText = (id: string) => guest<string>('page', `const n=d.querySelector('[data-testid="map-card-${id}"]');return (n?.innerText??'')+' '+(n?.getAttribute('aria-label')??'')`);
    // Read claims on cards and the named current-work summary, not explanatory notices saying
    // that Ready/Unlocks next guidance is intentionally absent on stale or closed pictures.
    const guidanceText = () => guest<string>('page', `return [...d.querySelectorAll('[data-testid="map-summary"] [aria-label="Current work"],[data-task]')].map(n=>(n.innerText??'')+' '+(n.getAttribute('aria-label')??'')).join(' ')`);
    check('render:current-active-guidance-text', /\bReady\b/.test(await cardText('C')) && /Unlocks next/i.test(await guidanceText()));
    const fullCounts = () => guest<string>('page', `return d.querySelector('[data-testid="map-counts"]')?.innerText??''`);
    const countsMatch = (text: string) => /1 of 8 done/.test(text) && /7 remaining/.test(text) && /1 skipped/.test(text);
    check('render:full-plan-count-text', countsMatch(await fullCounts()));
    await shot('active-overview');
    await click('page', '[data-testid="map-card-B"]'); await wait('page', `d.querySelector('[data-testid="map-inspector"]')?.textContent.includes('Build a deliberately')`); await shot('selected-inspector');
    const unchanged = (after: any) => after.cards.every((i: any) => initial.cards.some((a: any) => a.id === i.id && a.x === i.x && a.y === i.y));
    await showTasks('page', 'unfinished'); check('render:unfinished-stable', unchanged(await snapshot('page')) && !(await snapshot('page')).cards.some((i: any) => ['A','S'].includes(i.id)));
    await showTasks('page', 'all'); await select('page', 'map-group', 'G'); check('render:group-subtree-stable', unchanged(await snapshot('page')) && (await snapshot('page')).cards.map((i: any) => i.id).join() === 'A');
    check('render:filtered-counts-remain-full-plan', countsMatch(await fullCounts()));
    await select('page', 'map-group', '*');
    // A real newer report, with its graph reply held: retain the accepted picture, never reload it away.
    const retainedRevision = await guest<string>('page', `return d.querySelector('${region}').dataset.revision`);
    await evaluate(`qa.holds.push({path:'/v1/plan-graph',frame:'page',tag:'map-newer-graph'});true`);
    fx.reportMap('P-map', { op: 'change', changes: [{ id: 'I', status: 'working' }] });
    await wait('page', `parent.qa.held.some(h=>h.tag==='map-newer-graph')&&d.querySelector('${region}')?.dataset.state==='updating'`, 'retained picture while newer graph is held');
    check('render:updating-retains-accepted-picture', await guest('page', `return d.querySelector('${region}').dataset.revision===${javascriptLiteral(retainedRevision)}&&d.querySelectorAll('[data-task]').length===9&&d.querySelector('[data-testid="map-state"]').innerText.includes('Updating')`));
    check('render:updating-suppresses-guidance-text', !/\bReady\b|Unlocks next/i.test(await guidanceText()) && /Reported pending/i.test(await cardText('C')));
    await shot('retained-updating'); await evaluate(`qa.release('map-newer-graph')`); await ready();
    check('render:matched-picture-restores-guidance-text', /\bReady\b/.test(await cardText('C')) && /Unlocks next/i.test(await guidanceText()));
    // Legacy complete detail with no usable snapshot, after an accepted picture of this same reading.
    await evaluate(`qa.stripDetailSnapshot='page';true`);
    fx.reportMap('P-map', { op: 'change', changes: [{ id: 'I', status: 'pending' }] });
    await wait('page', `d.querySelector('${region}')?.dataset.state==='unavailable'`, 'retained picture becomes unavailable without identity');
    const noDiagram = () => guest<boolean>('page', `const n=d.querySelector('${region}'),control=n.querySelector('[data-testid="map-list"]'),b=control?.matches('button')?control:control?.querySelector('button');return !n.querySelector('[data-task],path[data-from]')&&!n.dataset.revision&&n.dataset.tasks==='0'&&n.dataset.edges==='0'&&!!b&&!b.disabled&&b.tabIndex>=0&&b.getClientRects().length>0&&/View as list/i.test(b.innerText)&&!/Revision [0-9]/i.test(n.innerText)`);
    check('render:unavailable-discards-retained-diagram', await noDiagram() && await guest('page', `return d.querySelector('[data-testid="map-state"]').innerText.includes('earlier map is no longer shown')`)); await shot('retained-unavailable');
    await evaluate(`qa.stripDetailSnapshot=false;true`);
    fx.reportMap('P-map', { op: 'change', changes: [{ id: 'I', status: 'working' }] }); await ready();
    await evaluate(`qa.fail.push({path:'/v1/plan-graph',frame:'page',status:404,code:'not-found',once:true});true`);
    fx.reportMap('P-map', { op: 'change', changes: [{ id: 'I', status: 'pending' }] });
    await wait('page', `d.querySelector('${region}')?.dataset.state==='not-found'`, 'not-found after accepted picture');
    check('render:not-found-discards-previous-diagram', await noDiagram()); await shot('retained-not-found');
    for (const [id, filename, text, tasks] of [['P-map-none','no-prerequisites','No prerequisites recorded for this plan',2],['P-map-groups','group-context','No task-to-task prerequisites recorded',1],['P-map-group-only','group-only','No task cards',0],['P-map-empty','empty','No task cards',0],['P-map-finished','finished','Done',2],['P-map-cancelled','cancelled','Reported pending',1]] as const) {
      await plan(id); check(`render:${id}`, await guest('page', `return d.querySelector('${region}').textContent.includes(${javascriptLiteral(text)})`) && Number((await snapshot('page')).tasks) === tasks && (await snapshot('page')).pairs.length === 0); await shot(filename);
      if (id === 'P-map-empty' || id === 'P-map-group-only') check(`render:${id}-D5-sentence`, await guest('page', `return d.querySelector('${region}').innerText.includes('No prerequisites recorded for this plan')`));
      if (id === 'P-map-finished' || id === 'P-map-cancelled') check(`render:${id}-no-guidance-text`, !/\bReady\b|Unlocks next/i.test(await guidanceText()) && (id === 'P-map-finished' ? /Skipped/.test(await cardText('S')) : /Reported pending/.test(await cardText('P'))));
    }
    await plan('P-map');
    for (const width of [600,360]) { await show(['panel'], width); try { await ready('panel'); } catch (e) { throw Error(String(e) + JSON.stringify(pageErrors())); } const rail = await snapshot('panel'); check(`render:rail-${width}-full-coverage`, rail.tasks === initial.tasks && rail.edges === initial.edges && pairs(rail.pairs) === pairs(initial.pairs)); await shot(width === 600 ? 'rail-map-wide' : 'rail-map-narrow', '[data-testid="progress-root"]', 12, 1700, 'panel'); }
    await theme('dark'); await shot('dark-narrow', '[data-testid="progress-root"]', 12, 1700, 'panel'); await theme('light'); await show(['page'],1100);
    await evaluate(`qa.holds.push({path:'/v1/plan',frame:'page',plan:'P-map-paged',cursor:true,tag:'map-page'});true`); await select('page','map-plan','P-map-paged');
    await wait('page', `parent.qa.held.some(h=>h.tag==='map-page')`, 'held detail continuation'); check('render:no-partial-picture', (await snapshot('page')).cards.length === 0); await evaluate(`qa.release('map-page')`); await ready(); check('render:complete-paged-picture', Number((await snapshot('page')).tasks) === 45);
    const packedToCanvas = `(()=>{const width=Number(d.querySelector('[data-testid="preview-map-host"]')?.dataset.canvasWidth),cards=[...d.querySelectorAll('[data-task]')];return width>0&&cards.length===45&&cards.every(n=>Number(n.dataset.x)+n.offsetWidth<=width+1)})()`;
    await wait('page', packedToCanvas, 'edgeless board packs within reported usable canvas');
    check('render:edgeless-board-packs-to-canvas', await guest('page', `return ${packedToCanvas}`));
    await shot('paged-edgeless-canvas');
    await evaluate(`qa.stripGraph=true;qa.reload('page');true`); await wait('page', `d.querySelector('${region}')?.dataset.state==='unavailable'`); await shot('unavailable');
    await evaluate(`qa.stripGraph=false;qa.fail.push({path:'/v1/plan-graph',frame:'page',status:409,once:true});qa.reload('page');true`); await wait('page', `d.querySelector('${region}')?.dataset.state==='updating'`); await shot('updating'); await click('page','[data-testid="map-retry"]'); await ready(); check('render:conflict-try-again', true);
    await evaluate(`qa.fail.push({path:'/v1/plan-graph',frame:'page',status:503,once:true});qa.reload('page');true`); await wait('page', `d.querySelector('${region}')?.dataset.state==='error'`); await shot('read-failure'); await click('page','[data-testid="map-retry"]'); await ready(); check('render:failure-try-again', true);
    await show(['panel'],360); await evaluate(`qa.stripGraph=true;qa.reload('panel');true`); await wait('panel', `d.querySelector('${region}')?.dataset.state==='unavailable'`); await shot('rail-unavailable', '[data-testid="progress-root"]', 12, 1700, 'panel');
    check('render:no-proxy-errors', await evaluate('qa.errors.length===0'));
    replies = await evaluate('qa.replies');
    throw new OnlyDone();
  }
  if (onlyKeyboard || onlyReplay) {
    await keyboardFocus();
    throw new OnlyDone();
  }

  // ======================================================= Keyboard and focus verification modes
  // Real CDP key events from a neutral shell sentinel; focus ownership is read from the top document
  // (which iframe or sentinel owns focus) and each guest (`hasFocus`, active element). Programmatic
  // focus appears only as labelled setup (`setup:` facts) for non-Tab task rows, never as reachability
  // evidence. Waits are on recorded replies and rendered state, never on assumed poll periods.
  async function keyboardFocus() {
    const coverage: Record<string, { status: 'pass' | 'fail' | 'skipped' | 'secondary'; surfaces: string[]; note?: string; checks: string[] }> = {};
    const inventory: Record<string, unknown> = {};
    const failures: { scenario: string; error: string }[] = [];
    facts.coverage = coverage; facts.inventory = inventory; facts.scenarioFailures = failures;
    Object.assign(facts, { mode: onlyKeyboard ? 'keyboard-focus' : 'keyboard-focus-replay', runtime: process.version, serviceMode: built ? 'built generated service' : 'current TypeScript service', commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), bundles: Object.fromEntries(['build/service/main.js', ...['page', 'panel', 'status'].map(f => `ui/${f}/main.js`)].map(p => [p, createHash('sha256').update(readFileSync(p)).digest('hex')])), reducedMotion: true });
    await evaluate(`window.kf={
      describe(e,w){if(!e)return null;const cs=w.getComputedStyle(e),own=e.closest('[data-testid]'),r=e.getBoundingClientRect(),role=e.getAttribute('role')||undefined;
        const named=['BUTTON','SUMMARY','A'].includes(e.tagName)||/^(tab|option)$/.test(role||'');
        const label=(e.getAttribute('aria-label')||(named?e.textContent:'')||(e.labels&&e.labels[0]?e.labels[0].textContent:'')||'').replace(/\\s+/g,' ').trim().slice(0,64);
        return {tag:e.tagName.toLowerCase(),id:e.id||undefined,testid:own?own.dataset.testid:null,role,label,expanded:e.getAttribute('aria-expanded')??undefined,pressed:e.getAttribute('aria-pressed')??undefined,selected:e.getAttribute('aria-selected')??undefined,disabled:(e.disabled||e.getAttribute('aria-disabled')==='true')||undefined,
          ring:(cs.outlineStyle!=='none'&&parseFloat(cs.outlineWidth)>0)||(cs.boxShadow!=='none'&&cs.boxShadow!==''),inline:r.width>0&&r.height>0&&r.left>=-1&&r.right<=w.innerWidth+1}},
      state(){const a=document.activeElement,fr=a&&a.tagName==='IFRAME'?a:null;const o={top:fr?'iframe':(a&&(a.id||a.tagName.toLowerCase())),frame:fr?fr.dataset.frame:null,topHasFocus:document.hasFocus()};
        if(fr){const w=fr.contentWindow,d=w.document;o.guestHasFocus=d.hasFocus();o.el=kf.describe(d.activeElement===d.body?null:d.activeElement,w)}
        o.guests=Object.fromEntries(['page','panel','status'].map(f=>{const d=frame(f).contentDocument,e=d.activeElement;return [f,{hasFocus:d.hasFocus(),active:e&&e!==d.body?(e.closest('[data-testid]')?.dataset.testid??e.tagName.toLowerCase()):null}]}));return o}};true`);
    type FocusState = { top: string; frame: string | null; topHasFocus: boolean; guestHasFocus?: boolean; el?: { tag: string; testid: string | null; role?: string; label: string; ring: boolean; inline: boolean; expanded?: string; pressed?: string; selected?: string; disabled?: boolean } | null; guests: Record<string, { hasFocus: boolean; active: string | null }> };
    const focusState = () => evaluate<FocusState>('kf.state()');
    const clickTop = async (selector: string) => {
      const p = await evaluate<[number, number] | null>(`(()=>{const n=document.querySelector(${javascriptLiteral(selector)});if(!n)return null;n.scrollIntoView({block:'center'});const r=n.getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2]})()`);
      if (!p) throw Error(`missing shell ${selector}`);
      for (const t of ['mouseMoved', 'mousePressed', 'mouseReleased']) await c.send('Input.dispatchMouseEvent', { type: t, x: p[0], y: p[1], button: 'left', clickCount: 1 });
    };
    const SHIFT = 8;
    /** In the owning guest only: is focus on `selector` (or inside it) while that frame owns focus? */
    const focusedOn = (surface: string, selector: string) => evaluate<boolean>(`(()=>{const a=document.activeElement;if(!a||a.tagName!=='IFRAME'||a.dataset.frame!=='${surface}')return false;const d=a.contentDocument;if(!d.hasFocus())return false;const n=d.querySelector(${javascriptLiteral(selector)});return !!n&&(n===d.activeElement||n.contains(d.activeElement))})()`);
    /** Tab from the neutral start sentinel until focus leaves to the end sentinel; then Shift+Tab back. */
    const walk = async (name: string, max = 160) => {
      await clickTop('#qa-before');
      const stops: FocusState[] = [];
      let forward = false;
      for (let i = 0; i < max; i++) {
        await key('Tab');
        const st = await focusState();
        if (st.top === 'qa-after') { forward = true; break; }
        stops.push(st);
      }
      let back = 0, backward = false;
      if (forward) for (let i = 0; i < max; i++) {
        await key('Tab', 1, SHIFT);
        const st = await focusState();
        if (st.top === 'qa-before') { backward = true; break; }
        back++;
      }
      const list = stops.map((st) => ({ frame: st.frame, ...(st.el ?? { tag: st.top }) }));
      inventory[name] = { forwardExit: forward, backwardExit: backward, forwardStops: stops.length, backwardStops: back, stops: list };
      return { stops, list, forward, backward, back };
    };
    let currentScenario = '';
    const cover = (k: string, surface: string, check: string) => {
      const row = coverage[k] ??= { status: 'pass', surfaces: [], checks: [] };
      if (!row.surfaces.includes(surface)) row.surfaces.push(surface);
      row.checks.push(check);
    };
    /** Each scenario records its failure and the run continues; any failure fails the mode. */
    const only = arg('--kf-scenarios')?.split(',');
    if (only) facts.scenarioFilter = only;
    const scenario = async (name: string, ks: string[], fn: () => Promise<void>) => {
      currentScenario = name;
      if (only && !only.includes(name)) { failures.push({ scenario: name, error: 'not run (iteration filter --kf-scenarios)' }); return; }
      try { await fn(); }
      catch (e) {
        const error = e instanceof Error ? e.message.split('\n')[0].slice(0, 700) : String(e);
        let at: unknown = null;
        try { at = { focus: await focusState(), shown: await evaluate(`[...document.querySelectorAll('section[data-frame]')].filter(n=>n.style.display==='block').map(n=>n.dataset.frame)`), hooks: await evaluate(`Object.fromEntries(['page','panel','status'].map(f=>{const d=frame(f).contentDocument;return [f,[...new Set([...d.querySelectorAll('[data-testid]')].map(n=>n.dataset.testid.replace(/-[A-Z].*$/,'-*')))].slice(0,60)]}))`) }; } catch {}
        failures.push({ scenario: name, error, at } as any);
        if (results.at(-1)?.pass !== false) results.push({ id: `${name}:scenario`, pass: false, facts: [error] });
        for (const k of ks) { const row = coverage[k] ??= { status: 'fail', surfaces: [], checks: [] }; row.status = 'fail'; row.checks.push(`${name} failed`); }
      }
    };
    const kcheck = (k: string, surface: string, id: string, pass: boolean, f?: string[], diagnostic?: unknown) => {
      const full = `${k}:${surface}:${id}`;
      results.push({ id: full, pass, ...(f ? { facts: f } : {}) });
      cover(k, surface, full);
      if (!pass) throw new Error(`${full} failed${diagnostic === undefined ? '' : `: ${JSON.stringify(diagnostic).slice(0, 700)}`}`);
    };
    /**
     * Records a failed expectation without aborting the scenario, so later paths of the same scenario
     * still produce evidence. Any failed expectation still fails the mode (non-zero exit).
     */
    const kexpect = async (k: string, surface: string, id: string, pass: boolean, f?: string[], diagnostic?: unknown) => {
      const full = `${k}:${surface}:${id}`;
      results.push({ id: full, pass, ...(f ? { facts: f } : {}) });
      cover(k, surface, full);
      if (pass) return;
      const name = `expectation-failed-${surface}-${id.replace(/[^a-z0-9-]+/gi, '-')}`;
      ((facts.failedExpectations ??= []) as unknown[]).push({ id: full, scenario: currentScenario, screenshot: `${name}.png`, diagnostic });
      coverage[k].status = 'fail';
      if (['panel', 'page', 'status'].includes(surface)) await shot(name, '[data-testid="progress-root"]', 8, 800, surface);
    };
    /** An explicitly recorded uncovered path (never silent); listed in results `skipped`. */
    const skip = (k: string, surface: string, note: string) => { const row = coverage[k] ??= { status: 'skipped', surfaces: [], checks: [] }; row.checks.push(`skipped (${surface}): ${note}`); ((facts.skipped ??= []) as unknown[]).push({ k, surface, note }); };

    /** Surface-width crop around the focused guest element (synthetic content only). */
    const focusShot = async (name: string, surface: string, above = 70, below = 90) => {
      // Inside the viewport only: a beyond-viewport capture resizes the page, which closes open popups.
      const r = await evaluate<number[] | null>(`(()=>{const fr=frame('${surface}'),d=fr.contentDocument,e=d.activeElement;if(!e||e===d.body)return null;let a=e.getBoundingClientRect(),o=fr.getBoundingClientRect();const y=o.y+a.y;if(y-${above}<0||y+a.height+${below}>innerHeight){scrollBy(0,y-innerHeight/2);a=e.getBoundingClientRect();o=fr.getBoundingClientRect()}return [o.x+scrollX,o.y+a.y+scrollY,o.width,a.height]})()`);
      if (!r) throw Error(`no focused element in ${surface} for ${name}`);
      await frames2();
      const top = Math.max(0, r[1] - above);
      const png = await c.send('Page.captureScreenshot', { format: 'png', clip: { x: Math.max(0, r[0] - 8), y: top, width: r[2] + 16, height: r[3] + above + below, scale: 1 } });
      writeFileSync(join(artifacts!, `${name}.png`), Buffer.from(png.data, 'base64')); shots.push(`${name}.png`);
    };
    /**
     * Same-clip pair for C2 review: the control focused by keyboard, then not focused (labelled
     * reference setup: the shell sentinel takes focus without scrolling; geometry must not change). Computed styles only corroborate; these images are what the visual review inspects.
     */
    const focusPair = async (name: string, surface: string, selector: string, pad = 14) => {
      await tabTo(surface, selector);
      const r = await evaluate<number[]>(`(()=>{const fr=frame('${surface}'),e=fr.contentDocument.activeElement;let a=e.getBoundingClientRect(),o=fr.getBoundingClientRect();if(o.y+a.y<40||o.y+a.y+a.height>innerHeight-40){scrollBy(0,o.y+a.y-innerHeight/2);a=e.getBoundingClientRect();o=fr.getBoundingClientRect()}return [o.x+a.x+scrollX,o.y+a.y+scrollY,a.width,a.height]})()`);
      await frames2();
      const clip = { x: Math.max(0, r[0] - pad), y: Math.max(0, r[1] - pad), width: r[2] + pad * 2, height: r[3] + pad * 2, scale: 2 };
      const cs = await guest<Record<string, string>>(surface, `const a=d.activeElement,e=a.getAttribute('role')==='listbox'?(a.querySelector('[data-active="true"]')??a):a,cs=w.getComputedStyle(e),own=w.getComputedStyle(a);return {outline:own.outlineStyle+' '+own.outlineWidth+' '+own.outlineColor,shadow:cs.boxShadow,bg:cs.backgroundColor,bgImage:cs.backgroundImage,ring:String((own.outlineStyle!=='none'&&parseFloat(own.outlineWidth)>0)||(cs.boxShadow!=='none'&&!/^rgba\\(0, 0, 0, 0\\.0\\d/.test(cs.boxShadow)&&!/0px 1px/.test(cs.boxShadow)))}`);
      const a = await c.send('Page.captureScreenshot', { format: 'png', clip });
      const where = () => evaluate<number[]>(`(()=>{const fr=frame('${surface}'),n=fr.contentDocument.querySelector(${javascriptLiteral(selector)}),a=n.getBoundingClientRect(),o=fr.getBoundingClientRect();return [Math.round(o.x+a.x+scrollX),Math.round(o.y+a.y+scrollY)]})()`);
      const before = await where();
      // Unfocused reference only (not reachability evidence): the shell sentinel takes focus without scrolling.
      await evaluate(`document.getElementById('qa-before').focus({preventScroll:true});true`); await frames2();
      const stable = JSON.stringify(before) === JSON.stringify(await where());
      const cs2 = await guest<Record<string, string>>(surface, `const e=d.querySelector(${javascriptLiteral(selector)}),cs=w.getComputedStyle(e);return {outline:cs.outlineStyle+' '+cs.outlineWidth+' '+cs.outlineColor,shadow:cs.boxShadow,bg:cs.backgroundColor,bgImage:cs.backgroundImage}`);
      const b = await c.send('Page.captureScreenshot', { format: 'png', clip });
      writeFileSync(join(artifacts!, `${name}-focused.png`), Buffer.from(a.data, 'base64'));
      writeFileSync(join(artifacts!, `${name}-unfocused.png`), Buffer.from(b.data, 'base64'));
      shots.push(`${name}-focused.png`, `${name}-unfocused.png`);
      ((facts.focusPairs ??= []) as unknown[]).push({ name, surface, selector, focused: cs, unfocused: cs2, identicalPixels: a.data === b.data, sameGeometry: stable });
      if (!stable) throw Error(`${name}: the control moved between the focused and unfocused captures`);
      return a.data === b.data;
    };
    /** From the start sentinel, real Tab presses until `selector` in `surface` owns focus. */
    const tabTo = async (surface: string, selector: string, max = 120, fromStart = true) => {
      if (fromStart) await clickTop('#qa-before');
      const seen: string[] = [];
      for (let i = 1; i <= max; i++) {
        await key('Tab');
        if (await focusedOn(surface, selector)) { await frames2(); await frames2(); return i; }
        const st = await focusState();
        seen.push(st.el ? `${st.frame}:${st.el.testid ?? st.el.tag}` : String(st.top));
        if (st.top === 'qa-after') throw Error(`Tab left ${surface} before reaching ${selector}; target ${JSON.stringify(await guest(surface, `const n=d.querySelector(${javascriptLiteral(selector)});return n?{disabled:n.disabled??null,hidden:!!n.closest('[hidden]'),tabIndex:n.tabIndex,rects:n.getClientRects().length}:null`))}; stops ${JSON.stringify(seen.slice(-40))}`);
      }
      throw Error(`${selector} not reached in ${surface} within ${max} Tab presses`);
    };
    const setups: string[] = []; facts.labelledSetup = setups;
    /** Labelled setup only: programmatic focus on a non-Tab canonical task row (never reachability evidence). */
    const setupRowFocus = async (surface: string, row: string) => {
      const ok = await evaluate<boolean>(`(()=>{const fr=frame('${surface}');fr.focus();const d=fr.contentDocument,n=d.querySelector('[data-testid="${row}"]');if(!n)return false;n.focus({preventScroll:false});return d.activeElement===n&&d.hasFocus()})()`);
      setups.push(`${currentScenario}: programmatic focus on ${surface} ${row}`);
      if (!ok) throw Error(`setup focus failed on ${surface} ${row}`);
    };
    const activeId = (surface: string) => guest<string | null>(surface, `const e=d.activeElement;return e&&e!==d.body?(e.dataset.testid??e.closest('[data-testid]')?.dataset.testid??e.tagName.toLowerCase()):null`);
    const owns = async (surface: string) => { const st = await focusState(); return st.frame === surface && !!st.guestHasFocus; };
    const repliesMark = () => evaluate<number>('qa.replies.length');
    const completedPolls = (surface: string, mark: number, n: number, what = `${n} completed polls`) => wait(surface, `qa.replies.slice(${mark}).filter(r=>r.frame==='${surface}'&&r.path==='/v1/plans'&&r.status===200).length>=${n}`, `${surface}: ${what}`);
    const popupOpen = (surface: string) => guest<boolean>(surface, `return !!d.querySelector('.oc-sdk-popup [role="listbox"]')`);
    const optionLabels = (surface: string) => guest<string[]>(surface, `return [...d.querySelectorAll('.oc-sdk-popup [role="option"]')].map(n=>n.querySelector('.oc-sdk-option-label')?.textContent??'')`);
    /** Keyboard choice inside an already-open SDK popup: Home, ArrowDown to the label, Enter. */
    const pickOpen = async (surface: string, label: string) => {
      const options = await optionLabels(surface), index = options.indexOf(label);
      if (index < 0) throw Error(`no option ${label}: ${JSON.stringify(options)}`);
      await key('Home'); if (index) await key('ArrowDown', index); await key('Enter');
      await wait(surface, `!d.querySelector('.oc-sdk-popup [role="listbox"]')`, 'popup closed');
    };
    const openPicker = async (surface: string, holder: string, label: string) => {
      await wait(surface, `d.querySelector('[data-testid="${holder}"] .oc-sdk-trigger')`, `${holder} rendered`, 20_000);
      await tabTo(surface, `[data-testid="${holder}"] .oc-sdk-trigger`); await key('Enter');
      await wait(surface, `d.querySelector('.oc-sdk-popup [role="listbox"]')`, `${holder} popup`);
      await pickOpen(surface, label);
    };
    const messages = (type: RegExp) => evaluate<{ frame: string; type: string }[]>(`qa.messages.filter(m=>${type}.test(m.type))`);
    const tasksOf = (_surface: string) => `d.querySelector('article[data-reading] .ap-tasks[data-complete]')`;
    const railPlan = () => guest<string | null>('panel', `return d.querySelector('article[data-reading]')?.dataset.testid??null`);
    const stateSig = (surface: string) => guest<string>(surface, `return JSON.stringify({plan:d.querySelector('article[data-testid^="plan-"]')?.dataset.testid??null,pressed:[...d.querySelectorAll('[aria-pressed]')].map(n=>n.getAttribute('aria-pressed')),open:[...d.querySelectorAll('details')].map(n=>n.open),tabs:[...d.querySelectorAll('[role="tab"]')].map(n=>n.getAttribute('aria-selected')),selected:[...d.querySelectorAll('[role="option"][aria-selected="true"]')].map(n=>n.dataset.testid??n.id),triggers:[...d.querySelectorAll('.oc-sdk-trigger')].map(n=>n.textContent)})`);
    /** Fresh guest document per scenario, so one scenario's failure cannot leak state into the next. */
    const fresh = async (surface: string) => {
      const seq = await evaluate<number>(`qa.reload('${surface}')`);
      await wait(surface, `qa.loaded['${surface}']===${seq}&&d.querySelector('[data-testid="progress-root"]')`, `${surface} reloaded`);
      if (surface === 'page') await wait('page', `d.querySelector('[data-testid="search-form"]')&&d.querySelector('[data-testid="plan-list"]')&&d.querySelector('[data-testid="plan-detail"] .ap-tasks[data-complete]')`, 'board ready', 20_000);
      if (surface === 'panel') await wait('panel', `d.querySelector('[data-testid="plan-selector"] .oc-sdk-trigger')&&d.querySelector('article[data-reading] .ap-tasks[data-complete]')`, 'rail ready', 20_000);
      if (surface === 'status') await wait('status', `d.querySelector('[data-testid="status-plan-selector"] .oc-sdk-trigger')`, 'status ready', 20_000);
    };
    const railOn = async (label: string, plan: string) => {
      if (await guest<string | null>('panel', `return d.querySelector('article[data-reading]')?.dataset.testid??null`) !== `plan-${plan}`) await openPicker('panel', 'plan-selector', label);
      await wait('panel', `d.querySelector('article[data-reading][data-testid="plan-${plan}"] .ap-tasks[data-complete]')`, `rail on ${plan}`);
    };
    /** M1: focus is on the owning heading (this frame owns focus) and the short notice names the outcome. */
    const handedTo = async (k: string, surface: string, id: string, heading: string, notice: RegExp, noticeHook = 'focus-handoff-notice') => {
      const st = await focusState();
      const text = await guest<string>(surface, `return d.querySelector('[data-testid="${noticeHook}"]')?.textContent??''`);
      await kexpect(k, surface, `${id}:owning-heading-and-notice`, await focusedOn(surface, heading) && notice.test(text), [`focus on ${heading}; notice “${text}”`], { st, text });
    };
    const notStranded = (st: FocusState) => !!st.guestHasFocus && !!st.el && st.el.tag !== 'body';
    const walkChecks = async (k: string, surface: string, name: string) => {
      const before = await stateSig(surface);
      const w = await walk(name);
      kcheck(k, surface, `${name}:exits-both-ways`, w.forward && w.backward, [`${w.stops.length} forward stops; Tab left to the end sentinel and Shift+Tab returned to the start sentinel`], { forward: w.forward, backward: w.backward });
      kcheck(k, surface, `${name}:reverse-symmetric`, w.back === w.stops.length, [`Shift+Tab visited ${w.back} stops`], { forward: w.stops.length, back: w.back });
      kcheck(k, surface, `${name}:all-stops-in-guest`, w.stops.every((st) => st.frame === surface && st.guestHasFocus && st.el), undefined, w.list.filter((x: any) => !x.testid && x.frame !== surface));
      kcheck('K11', surface, `${name}:no-horizontal-clipping`, w.stops.every((st) => st.el?.inline), undefined, w.list.filter((x: any) => !x.inline));
      const after = await stateSig(surface);
      kcheck(k, surface, `${name}:tabbing-changes-nothing`, before === after, ['Reaching controls by Tab alone changed no pressed/open/selected/trigger state'], { before, after });
      return w;
    };

    if (onlyKeyboard) {
      // ---------------------------------------------------------------- K1 rail (360 px)
      await scenario('K1-rail', ['K1', 'K11'], async () => {
        await show(['panel'], 360); await theme('light');
        await evaluate(`qa.context('KF');true`);
        await wait('panel', `d.querySelector('[data-testid="plan-selector"] .oc-sdk-trigger')&&${tasksOf('panel')}`, 'rail KF session with complete detail');
        await walkChecks('K1', 'panel', 'rail-360-light-initial');
        // Picker: Tab reaches it; Enter opens; arrows move; Escape restores trigger focus without change.
        await tabTo('panel', '[data-testid="plan-selector"] .oc-sdk-trigger');
        const plan0 = await railPlan();
        await key('Enter');
        await wait('panel', `d.querySelector('.oc-sdk-popup [role="listbox"]')`, 'picker open');
        kcheck('K1', 'panel', 'picker:enter-opens-with-focus-inside', await guest<boolean>('panel', `return !!d.activeElement?.closest('.oc-sdk-popup')&&d.querySelector('[data-testid="plan-selector"] .oc-sdk-trigger').getAttribute('aria-expanded')==='true'`));
        await focusShot('rail-focus-light-picker-open', 'panel', 40, 260);
        await key('ArrowDown', 2);
        await key('Escape');
        await wait('panel', `!d.querySelector('.oc-sdk-popup [role="listbox"]')`, 'picker closed');
        kcheck('K1', 'panel', 'picker:escape-restores-trigger-no-change', await focusedOn('panel', '[data-testid="plan-selector"] .oc-sdk-trigger') && await railPlan() === plan0, undefined, { plan0, now: await railPlan(), focus: await focusState() });
        await key('Enter'); await wait('panel', `d.querySelector('.oc-sdk-popup [role="listbox"]')`, 'picker open again');
        await pickOpen('panel', 'Focus controls example');
        await wait('panel', `d.querySelector('article[data-reading][data-testid="plan-K-focus"] .ap-tasks[data-complete]')`, 'K-focus detail');
        kcheck('K1', 'panel', 'picker:enter-chooses-and-keeps-trigger', await focusedOn('panel', '[data-testid="plan-selector"] .oc-sdk-trigger'), undefined, await focusState());
        await key('Enter'); await wait('panel', `d.querySelector('.oc-sdk-popup [role="listbox"]')`, 'picker open (Tab exit)');
        await key('Tab');
        await wait('panel', `!d.querySelector('.oc-sdk-popup [role="listbox"]')`, 'Tab closes the popup');
        kcheck('K1', 'panel', 'picker:tab-leaves-popup', !(await focusedOn('panel', '.oc-sdk-popup')) && await owns('panel') && await railPlan() === 'plan-K-focus');
        const w = await walkChecks('K1', 'panel', 'rail-360-light-active-plan');
        const ids = w.list.map((x: any) => x.testid);
        for (const hook of ['plan-selector', 'focus-mode-all', 'focus-mode-unfinished', 'focus-participant', 'focus-expand-all', 'focus-collapse-all', 'focus-jump-working', 'focus-jump-blocked']) kcheck('K1', 'panel', `reachable:${hook}`, ids.includes(hook), undefined, ids);
        kcheck('K1', 'panel', 'reachable:readiness-entries', ids.some((t: string) => t?.startsWith('readiness-entry-')), undefined, ids);
        kcheck('K1', 'panel', 'reachable:group-disclosures', ids.some((t: string) => t?.startsWith('group-toggle-')), undefined, ids);
        kcheck('K1', 'panel', 'task-rows-not-tab-stops', !w.list.some((x: any) => /^item-/.test(x.testid ?? '') && x.tag === 'li'), ['Canonical task rows stay navigation targets (tabindex -1), not Tab stops']);
        // Task mode: Tab focuses Unfinished without activating; Space activates.
        await tabTo('panel', '[data-testid="focus-mode-unfinished"] button');
        kcheck('K1', 'panel', 'mode:reach-does-not-activate', await guest<boolean>('panel', `return d.querySelector('[data-testid="focus-mode-unfinished"] button').getAttribute('aria-pressed')==='false'`));
        await focusShot('rail-focus-light-mode', 'panel');
        await key(' ');
        await wait('panel', `d.querySelector('[data-testid="focus-mode-unfinished"] button')?.getAttribute('aria-pressed')==='true'`, 'Unfinished pressed');
        kcheck('K1', 'panel', 'mode:space-activates-focus-kept', await focusedOn('panel', '[data-testid="focus-mode-unfinished"] button') && await guest<boolean>('panel', `return [...d.querySelectorAll('article[data-reading] [data-testid^="item-"]')].filter(n=>n.dataset.status==='done'||n.dataset.status==='skipped').every(n=>n.hidden)`));
        await key('Tab', 1, SHIFT); await key('Enter');
        await wait('panel', `d.querySelector('[data-testid="focus-mode-all"] button')?.getAttribute('aria-pressed')==='true'`, 'Show all again by Enter');
        // Participant picker: opens, Escape returns to it.
        await tabTo('panel', '[data-testid="focus-participant"] .oc-sdk-trigger');
        await key('Enter'); await wait('panel', `d.querySelector('.oc-sdk-popup [role="listbox"]')`, 'participant popup');
        inventory['participant-options'] = await optionLabels('panel');
        await key('Escape'); await wait('panel', `!d.querySelector('.oc-sdk-popup [role="listbox"]')`, 'participant closed');
        kcheck('K1', 'panel', 'participant:escape-restores-trigger', await focusedOn('panel', '[data-testid="focus-participant"] .oc-sdk-trigger'));
        // Expand/collapse all.
        await tabTo('panel', '[data-testid="focus-collapse-all"] button'); await key('Enter');
        await wait('panel', `[...d.querySelectorAll('article[data-reading] .ap-items details')].every(x=>!x.open)`, 'all collapsed');
        kcheck('K1', 'panel', 'collapse-all:keeps-focus', await focusedOn('panel', '[data-testid="focus-collapse-all"] button'));
        await tabTo('panel', '[data-testid="focus-expand-all"] button'); await key('Enter');
        await wait('panel', `[...d.querySelectorAll('article[data-reading] .ap-items details')].every(x=>x.open)`, 'all expanded');
        kcheck('K1', 'panel', 'expand-all:keeps-focus', await focusedOn('panel', '[data-testid="focus-expand-all"] button'));
        // Jump (with ancestors collapsed): lands once on the canonical working row, ancestors opened, visible focus.
        await tabTo('panel', '[data-testid="focus-collapse-all"] button'); await key('Enter');
        await wait('panel', `[...d.querySelectorAll('article[data-reading] .ap-items details')].every(x=>!x.open)`, 'collapsed before jump');
        await tabTo('panel', '[data-testid="focus-jump-working"] button'); await key('Enter');
        await wait('panel', `d.activeElement?.dataset.testid?.startsWith('item-')&&d.activeElement.dataset.status==='working'`, 'jump focused a working row');
        const jumped = await focusState();
        kcheck('K1', 'panel', 'jump:canonical-row-ancestors-open-ring', await guest<boolean>('panel', `const a=d.activeElement;return [...d.querySelectorAll('details')].filter(x=>x.contains(a)).every(x=>x.open)&&d.querySelectorAll('[data-testid="'+a.dataset.testid+'"]').length===1`) && !!jumped.el?.ring && !!jumped.guestHasFocus, undefined, jumped);
        await focusShot('rail-focus-light-jump-row', 'panel');
        // Readiness: Show task / prerequisite buttons reveal the canonical row.
        const entry = await guest<string | null>('panel', `return d.querySelector('[data-testid^="readiness-entry-"] button')?.closest('[data-testid^="readiness-entry-"]').dataset.testid??null`);
        if (!entry) throw Error('no readiness entry button in rail');
        await tabTo('panel', `[data-testid="${entry}"] button`); await key('Enter');
        const item = entry.replace('readiness-entry-', '');
        await wait('panel', `d.activeElement?.dataset.testid==='item-${item}'`, 'readiness reveal');
        kcheck('K1', 'panel', 'readiness:enter-reveals-canonical-row', await owns('panel'));
        const dep = await guest<string | null>('panel', `return d.querySelector('[data-dep] button')?.closest('[data-dep]').dataset.dep??null`);
        if (dep) {
          await tabTo('panel', `[data-dep="${dep}"] button`); await key('Enter');
          await wait('panel', `d.activeElement?.dataset.testid==='item-${dep}'`, 'prerequisite reveal');
          kcheck('K1', 'panel', 'readiness:prerequisite-reveals-row', await owns('panel'));
        } else skip('K1', 'panel', 'no prerequisite button rendered for the fixture');
        // Native group/document disclosures toggle with Enter and keep focus.
        const group = await guest<string>('panel', `return d.querySelector('article[data-reading] details[data-testid^="group-toggle-"]').dataset.testid`);
        await tabTo('panel', `[data-testid="${group}"] > summary`);
        const was = await guest<boolean>('panel', `return d.querySelector('[data-testid="${group}"]').open`);
        await key('Enter');
        await wait('panel', `d.querySelector('[data-testid="${group}"]').open===${!was}`, 'group toggled');
        kcheck('K1', 'panel', 'group-disclosure:enter-toggles-keeps-focus', await focusedOn('panel', `[data-testid="${group}"] > summary`));
        await focusShot('rail-focus-light-summary', 'panel');
        await tabTo('panel', '[data-testid="document-K-focus"] > summary'); await key('Enter');
        await wait('panel', `d.querySelector('[data-testid="document-K-focus"]').open`, 'document disclosure open');
        kcheck('K1', 'panel', 'document-disclosure:enter-opens', await focusedOn('panel', '[data-testid="document-K-focus"] > summary'));
        await key('Enter');
        await shot('rail-light-360', '[data-testid="progress-root"]', 8, 1500, 'panel');
      });
      // ---------------------------------------------------------------- K7 rail filtered-empty recovery
      await scenario('K7-rail-empty', ['K7', 'K11'], async () => {
        await show(['panel'], 360); await fresh('panel');
        await railOn('All tasks done example', 'K-all-done');
        await tabTo('panel', '[data-testid="focus-mode-unfinished"] button'); await key(' ');
        await wait('panel', `d.querySelector('[data-testid="focus-empty"]')`, 'focus-empty');
        kcheck('K7', 'panel', 'all-done-unfinished:focus-empty-not-loading', await guest<boolean>('panel', `return !!d.querySelector('[data-testid="focus-empty"] [data-testid="focus-clear"]')&&!d.querySelector('[data-testid="detail-loading"]')&&d.querySelector('[data-testid="focus-mode-unfinished"] button').getAttribute('aria-pressed')==='true'`));
        const w = await walk('rail-360-light-focus-empty');
        kcheck('K7', 'panel', 'hidden-rows-not-reachable', w.forward && !w.stops.some((s) => s.el?.testid?.startsWith('group-toggle-') && false) && await guest<boolean>('panel', `return [...d.querySelectorAll('article[data-reading] .ap-items [hidden] summary')].length===0||[...d.querySelectorAll('article[data-reading] .ap-items [hidden] summary')].every(s=>s.getClientRects().length===0)`));
        await tabTo('panel', '[data-testid="focus-clear"] button');
        await focusShot('rail-focus-light-filtered-empty', 'panel', 120, 90);
        await key('Enter');
        await wait('panel', `!d.querySelector('[data-testid="focus-empty"]')&&d.querySelector('[data-testid="focus-mode-all"] button')?.getAttribute('aria-pressed')==='true'`, 'tasks restored');
        const after = await focusState();
        inventory['rail-focus-clear-after'] = after;
        await kexpect('K7', 'panel', 'focus-clear:recovers-without-stranding', notStranded(after), ['After Clear, the guest keeps focus on a real element (not body)'], after);
        await handedTo('K7', 'panel', 'focus-clear', 'article[data-reading] .ap-tasks-h', /^Task filters cleared, so focus moved to Tasks\.$/, 'focus-notice');
        await focusShot('rail-focus-light-filter-clear-handoff', 'panel', 40, 120);
        await shot('rail-filtered-empty-recovered', '[data-testid="progress-root"]', 8, 900, 'panel');
        // Participant no-match on the active plan.
        await railOn('Focus controls example', 'K-focus');
        await tabTo('panel', '[data-testid="focus-participant"] .oc-sdk-trigger'); await key('Enter');
        await wait('panel', `d.querySelector('.oc-sdk-popup [role="listbox"]')`, 'participant');
        const labels = await optionLabels('panel');
        const none = labels.find((l) => /no participant/i.test(l));
        if (none) {
          await pickOpen('panel', none);
          if (await guest<boolean>('panel', `return !!d.querySelector('[data-testid="focus-empty"]')`)) {
            await tabTo('panel', '[data-testid="focus-clear"] button'); await key('Enter');
            await wait('panel', `!d.querySelector('[data-testid="focus-empty"]')`, 'participant cleared');
            const st = await focusState();
            await kexpect('K7', 'panel', 'participant-no-match:clear-recovers', notStranded(st), undefined, st);
            await handedTo('K7', 'panel', 'participant-no-match-clear', 'article[data-reading] .ap-tasks-h', /^Task filters cleared/, 'focus-notice');
          } else skip('K7', 'panel', 'the "No participant" choice matched rows in this fixture (no empty state)');
        } else { await key('Escape'); skip('K7', 'panel', `no "No participant" option: ${JSON.stringify(labels)}`); }
      });
      await scenario('K7-board-empty', ['K7'], async () => {
        await show(['page'], 1100); await fresh('page');
        const list = await guest<string>('page', `return d.querySelector('[data-testid="plan-row-K-all-done"]').closest('[data-testid^="project-"]').dataset.testid`);
        await tabTo('page', `[data-testid="${list}"] [role="listbox"]`);
        const idx = await guest<number>('page', `return [...d.querySelectorAll('[data-testid="${list}"] [role="option"]')].findIndex(o=>o.dataset.testid==='plan-row-K-all-done')`);
        await key('Home'); if (idx) await key('ArrowDown', idx); await key('Enter');
        await wait('page', `d.querySelector('article[data-reading][data-testid="plan-K-all-done"] .ap-tasks[data-complete]')`, 'board all-done plan');
        await tabTo('page', '[data-testid="focus-mode-unfinished"] button'); await key(' ');
        await wait('page', `d.querySelector('[data-testid="focus-empty"]')`, 'board focus-empty');
        await tabTo('page', '[data-testid="focus-clear"] button'); await key('Enter');
        await wait('page', `!d.querySelector('[data-testid="focus-empty"]')`, 'board tasks restored');
        await kexpect('K7', 'page', 'focus-clear:recovers-without-stranding', notStranded(await focusState()), undefined, await focusState());
        await handedTo('K7', 'page', 'focus-clear', 'article[data-reading] .ap-tasks-h', /^Task filters cleared, so focus moved to Tasks\.$/, 'focus-notice');
      });
      // ---------------------------------------------------------------- K8 rail asynchronous focus
      await scenario('K8-rail-async', ['K8', 'K10'], async () => {
        await show(['panel'], 360); await fresh('panel');
        await railOn('Focus controls example', 'K-focus');
        await tabTo('panel', '[data-testid="focus-mode-unfinished"] button');
        await instrument('panel'); await paints('panel');
        let mark = await repliesMark();
        await completedPolls('panel', mark, 2);
        kcheck('K8', 'panel', 'unchanged-polls:focus-retained', await focusedOn('panel', '[data-testid="focus-mode-unfinished"] button'), ['Two completed ordinary polls (recorded replies)']);
        const rev = await guest<string>('panel', `return d.querySelector('article[data-reading]').dataset.revision`);
        fx.reportKeyboard('K-focus', { op: 'change', changes: [{ id: 'N', status: 'working' }] });
        await wait('panel', `d.querySelector('article[data-reading]').dataset.revision!=='${rev}'&&${tasksOf('panel')}`, 'changed revision painted');
        kcheck('K8', 'panel', 'changed-repaint:same-control-retained', await focusedOn('panel', '[data-testid="focus-mode-unfinished"] button') && (await paints('panel')).length > 0, ['A real changed repaint replaced the root; the same surviving control keeps focus']);
        // Picker open while a background change arrives: popup stays usable; paint follows close.
        await tabTo('panel', '[data-testid="plan-selector"] .oc-sdk-trigger'); await key('Enter');
        await wait('panel', `d.querySelector('.oc-sdk-popup [role="listbox"]')`, 'picker open');
        const rev2 = await guest<string>('panel', `return d.querySelector('article[data-reading]').dataset.revision`);
        mark = await repliesMark();
        fx.reportKeyboard('K-focus', { op: 'change', changes: [{ id: 'N', status: 'pending' }] });
        await completedPolls('panel', mark, 2, 'two list replies after the change');
        await key('ArrowDown');
        kcheck('K8', 'panel', 'picker-open:background-deferred-usable', await popupOpen('panel') && await focusedOn('panel', '.oc-sdk-popup') && await guest<string>('panel', `return d.querySelector('article[data-reading]').dataset.revision`) === rev2, ['The popup stayed open and navigable; the background change waited']);
        await key('Escape');
        await wait('panel', `d.querySelector('article[data-reading]').dataset.revision!=='${rev2}'`, 'deferred paint after close');
        kcheck('K8', 'panel', 'picker-closed:paint-follows-focus-on-trigger', await focusedOn('panel', '[data-testid="plan-selector"] .oc-sdk-trigger'));
        // Held detail during a revision change: a focused row parks at Tasks and returns only while parked.
        await tabTo('panel', '[data-testid="focus-jump-working"] button'); await key('Enter');
        await wait('panel', `d.activeElement?.dataset.testid?.startsWith('item-')`, 'row focused by jump');
        const row = (await activeId('panel'))!;
        await evaluate(`qa.holds.push({tag:'kf-park',path:'/v1/plan',frame:'panel'});true`);
        fx.reportKeyboard('K-focus', { op: 'change', changes: [{ id: 'N', status: 'working' }] });
        await wait('panel', `qa.held.some(h=>h.tag==='kf-park')`, 'held detail');
        await wait('panel', `d.activeElement?.matches('.ap-tasks-h')`, 'parked at Tasks', 20_000);
        kcheck('K8', 'panel', 'held-detail:parks-at-tasks-heading', await owns('panel'), [`row ${row} parked at .ap-tasks-h while detail is loading`], await focusState());
        await focusShot('rail-focus-light-parked-tasks', 'panel', 40, 60);
        await evaluate(`qa.release('kf-park');true`);
        await wait('panel', `${tasksOf('panel')}&&d.activeElement?.dataset.testid==='${row}'`, 'row restored while parked');
        kcheck('K8', 'panel', 'held-detail:returns-while-parked', await owns('panel'));
        // Move away during the loading gap: no reclaim.
        await evaluate(`qa.holds.push({tag:'kf-park2',path:'/v1/plan',frame:'panel'});true`);
        fx.reportKeyboard('K-focus', { op: 'change', changes: [{ id: 'N', status: 'pending' }] });
        await wait('panel', `qa.held.some(h=>h.tag==='kf-park2')`, 'held detail 2');
        await wait('panel', `d.activeElement?.matches('.ap-tasks-h')`, 'parked again', 20_000);
        await key('Tab', 1, SHIFT);
        const moved = await activeId('panel');
        await evaluate(`qa.release('kf-park2');true`);
        await wait('panel', tasksOf('panel'), 'complete after release');
        mark = await repliesMark(); await completedPolls('panel', mark, 1);
        kcheck('K10', 'panel', 'loading-gap:moved-focus-not-reclaimed', await activeId('panel') === moved && moved !== row && await owns('panel'), [`user moved to ${moved}; the restored detail did not pull focus back to ${row}`], { moved, now: await activeId('panel') });
        // Failed list read with retry: stale banner, error is not empty, Try again reachable.
        await evaluate(`qa.fail.push({path:'/v1/plans',frame:'panel',status:503,code:'busy'});true`);
        await wait('panel', `d.querySelector('[data-testid="stale-banner"]')`, 'stale banner', 20_000);
        kcheck('K8', 'panel', 'failed-poll:stale-not-empty', await guest<boolean>('panel', `return !d.querySelector('[data-testid="empty-state"]')&&!!d.querySelector('article[data-reading]')`));
        await tabTo('panel', '[data-testid="stale-banner"] button');
        await focusShot('rail-focus-light-error-retry', 'panel', 40, 120);
        await evaluate(`qa.fail=qa.fail.filter(x=>x.frame!=='panel');true`);
        await key('Enter');
        await wait('panel', `!d.querySelector('[data-testid="stale-banner"]')`, 'recovered', 20_000);
        const st = await focusState();
        inventory['rail-after-retry'] = st;
        await kexpect('K8', 'panel', 'retry:recovers-focus-not-stranded', notStranded(st), ['Try again disappears after recovery; focus stays on a real element in the rail'], st);
        await handedTo('K8', 'panel', 'retry', '[data-testid="plan-title"]', /^Progress loaded again, so focus moved to /);
        await focusShot('rail-focus-light-retry-handoff', 'panel', 40, 90);
        // One-shot and non-stealing: the user moves on while the retried read is held.
        await evaluate(`qa.fail.push({path:'/v1/plans',frame:'panel',status:503,code:'busy'});true`);
        await wait('panel', `d.querySelector('[data-testid="stale-banner"]')`, 'stale banner again', 20_000);
        await tabTo('panel', '[data-testid="stale-banner"] button');
        await evaluate(`qa.fail=qa.fail.filter(x=>x.frame!=='panel');qa.holds.push({tag:'kf-retry',path:'/v1/plans',frame:'panel'});true`);
        await key('Enter');
        await wait('panel', `qa.held.some(h=>h.tag==='kf-retry')`, 'retried read held');
        await key('Tab');
        const movedTo = await activeId('panel');
        await evaluate(`qa.release('kf-retry');true`);
        await wait('panel', `!d.querySelector('[data-testid="stale-banner"]')`, 'recovered after move', 20_000);
        await frames2();
        await kexpect('K10', 'panel', 'retry:moved-focus-not-reclaimed', await activeId('panel') === movedTo && movedTo !== 'stale-banner' && await owns('panel') && !(await guest<boolean>('panel', `return !!d.querySelector('[data-testid="focus-handoff-notice"]')`)), [`moved to ${movedTo} during the read; the recovery left it there`], { movedTo, now: await focusState() });
      });
      // Post-review regression: a Try again pending when the store/binding changes must not focus or
      // announce in the new store (K10 identity discipline). The second disposable store has no `KF`
      // plans, so an unguarded hand-off would land on its empty state.
      await scenario('K10-retry-store-switch', ['K10'], async () => {
        await evaluate(`qa.context('KF');true`);
        await show(['panel'], 360); await fresh('panel');
        await evaluate(`qa.fail.push({path:'/v1/plans',frame:'panel',status:503,code:'busy'});true`);
        await wait('panel', `d.querySelector('[data-testid="stale-banner"] button')`, 'stale banner', 20_000);
        await tabTo('panel', '[data-testid="stale-banner"] button');
        setups.push('K10-retry-store-switch: labelled store switch (qa.store=1) while Try again is pending');
        await evaluate(`qa.holds.push({tag:'kf-store',path:'/v1/plans',frame:'panel'});qa.fail=qa.fail.filter(x=>x.frame!=='panel');qa.store=1;true`);
        await key('Enter');
        await wait('panel', `qa.held.some(h=>h.tag==='kf-store')`, 'retried read held');
        await evaluate(`qa.release('kf-store');true`);
        await wait('panel', `d.querySelector('[data-testid="empty-state"]')&&!d.querySelector('[data-testid="stale-banner"]')`, 'second store adopted (no KF plans)', 20_000);
        const m = await repliesMark(); await completedPolls('panel', m, 1, 'one poll in the new store');
        const st = await focusState();
        inventory['retry-store-switch'] = st;
        await kexpect('K10', 'panel', 'retry-store-switch:no-hand-off-into-new-store', !/^(empty-state|unscoped-state|plan-title|plan-list-heading|status-plan-title|setup-needed|setup-status-heading)$/.test(st.guests.panel.active ?? '') && !(await guest<boolean>('panel', `return !!d.querySelector('[data-testid="focus-handoff-notice"]')`)), ['A Retry from the old store neither focuses nor announces in the new store'], st);
        await evaluate(`qa.store=0;true`);
        for (const f of ['panel', 'page', 'status']) await fresh(f);
      });
      await scenario('K10-rail-external', ['K10'], async () => {
        await show(['panel'], 360); await fresh('panel');
        await railOn('Focus controls example', 'K-focus');
        await tabTo('panel', '[data-testid="focus-jump-working"] button'); await key('Enter');
        await wait('panel', `d.activeElement?.dataset.testid?.startsWith('item-')`, 'row focused');
        // Real keyboard exit to the end sentinel.
        for (let i = 0; i < 80 && (await focusState()).top !== 'qa-after'; i++) await key('Tab');
        kcheck('K10', 'panel', 'external:tab-out-to-sentinel', (await focusState()).top === 'qa-after');
        const rev = await guest<string>('panel', `return d.querySelector('article[data-reading]').dataset.revision`);
        fx.reportKeyboard('K-focus', { op: 'change', changes: [{ id: 'N', status: 'working' }] });
        await wait('panel', `d.querySelector('article[data-reading]').dataset.revision!=='${rev}'&&${tasksOf('panel')}`, 'changed paint while external');
        const mark = await repliesMark(); await completedPolls('panel', mark, 1);
        const st = await focusState();
        kcheck('K10', 'panel', 'external:background-paint-does-not-steal', st.top === 'qa-after' && !st.guests.panel.hasFocus, ['Top-level focus stays on the shell sentinel; the rail does not own focus'], st);
        // Held loading gap released while focus is external.
        await evaluate(`qa.holds.push({tag:'kf-ext',path:'/v1/plan',frame:'panel'});true`);
        fx.reportKeyboard('K-focus', { op: 'change', changes: [{ id: 'N', status: 'pending' }] });
        await wait('panel', `qa.held.some(h=>h.tag==='kf-ext')`, 'held external');
        await evaluate(`qa.release('kf-ext');true`);
        await wait('panel', tasksOf('panel'), 'complete after external release');
        const st2 = await focusState();
        kcheck('K10', 'panel', 'external:held-completion-does-not-steal', st2.top === 'qa-after' && !st2.guests.panel.hasFocus, undefined, st2);
        // Session KF→B→null→KF: rail follows; old task-reading focus never moves into another identity.
        await tabTo('panel', '[data-testid="focus-jump-working"] button'); await key('Enter');
        await wait('panel', `d.activeElement?.dataset.testid?.startsWith('item-')`, 'row focused before switch');
        await evaluate(`qa.context('B');true`);
        await wait('panel', `d.querySelector('[data-testid="empty-state"]')`, 'session B empty');
        await evaluate(`qa.context(null);true`);
        await wait('panel', `d.querySelector('[data-testid="unscoped-state"]')`, 'no session');
        await evaluate(`qa.context('KF');true`);
        await wait('panel', tasksOf('panel'), 'back to KF');
        const st3 = await focusState();
        kcheck('K10', 'panel', 'session-switch:no-old-row-focus-replayed', !/^item-/.test(st3.guests.panel.active ?? ''), ['KF→B→null→KF starts a new reading; the earlier row focus is not replayed'], st3);
      });
      // ---------------------------------------------------------------- K4 summaries (rail)
      await scenario('K4-rail-summary', ['K4'], async () => {
        await show(['panel'], 360); await fresh('panel');
        await railOn('Focus controls example', 'K-focus');
        await guest('panel', `w.__clip=[];Object.defineProperty(w.navigator,'clipboard',{configurable:true,value:{writeText:t=>new Promise(r=>w.__clip.push({len:t.length,go:()=>r()}))}});return true`);
        setups.push('K4-rail-summary: synthetic clipboard seam (held writeText; text never stored)');
        await tabTo('panel', '[data-testid="summary-progress"]'); await key('Enter');
        await wait('panel', `d.querySelector('[data-testid="summary-text"]')`, 'progress preview');
        await tabTo('panel', '[data-testid="summary-text"]');
        await c.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65, commands: ['selectAll'] });
        await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65 });
        const sel = await guest<number[]>('panel', `const t=d.querySelector('[data-testid="summary-text"]');return [t.selectionStart,t.selectionEnd]`);
        await instrument('panel'); await paints('panel');
        await evaluate(`qa.setSessions('alpha',[{id:'pulse',title:'Synthetic session',projectId:'alpha',directory:'/fixture/main',parentId:null,createdAt:0,updatedAt:1,archivedAt:null,worktree:null,activity:'idle',outcome:null,items:[]}]);true`);
        const pulse = await repliesMark(); await completedPolls('panel', pulse, 1);
        const painted = (await paints('panel')).length;
        const sel2 = await guest<number[]>('panel', `const t=d.querySelector('[data-testid="summary-text"]');return [t.selectionStart,t.selectionEnd]`);
        kcheck('K4', 'panel', 'summary-text:selection-survives-paint', JSON.stringify(sel) === JSON.stringify(sel2) && sel[1] > sel[0] && await focusedOn('panel', '[data-testid="summary-text"]'), [`keyboard selection ${sel[1] - sel[0]} chars; ${painted} root paint(s) during the session snapshot and poll`], { sel, sel2, painted });
        await tabTo('panel', '[data-testid="summary-copy"]'); await key('Enter');
        await wait('panel', `w.__clip.length===1`, 'copy held');
        await key('Tab');
        const moved = await activeId('panel');
        await guest('panel', `w.__clip[0].go();return true`);
        await wait('panel', `/copied/i.test(d.querySelector('[data-testid="summary-status"]')?.textContent??'')`, 'copy completed');
        kcheck('K4', 'panel', 'copy:held-completion-keeps-new-focus', await activeId('panel') === moved && moved !== 'summary-copy', [`focus moved to ${moved} before completion and stayed`], { moved, now: await activeId('panel') });
        await tabTo('panel', '[data-testid="summary-close"]');
        await focusShot('rail-focus-light-summary-close', 'panel', 260, 60);
        await key('Enter');
        await wait('panel', `!d.querySelector('[data-testid="summary-preview"]')`, 'closed');
        kcheck('K4', 'panel', 'close:returns-to-opener', await focusedOn('panel', '[data-testid="summary-progress"]'), undefined, await focusState());
        await tabTo('panel', '[data-testid="summary-handoff"]'); await key('Enter');
        await wait('panel', `d.querySelector('[data-testid="summary-preview"]')`, 'handoff preview');
        await tabTo('panel', '[data-testid="summary-close"]'); await key('Enter');
        await wait('panel', `!d.querySelector('[data-testid="summary-preview"]')`, 'handoff closed');
        kcheck('K4', 'panel', 'handoff-close:returns-to-opener', await focusedOn('panel', '[data-testid="summary-handoff"]'));
      });
      // ---------------------------------------------------------------- K6 cleanup confirmations (rail, disposable plans)
      await scenario('K6-rail-cleanup', ['K6'], async () => {
        await show(['panel'], 360); await fresh('panel');
        await openPicker('panel', 'plan-selector', 'Disposable finished plan A');
        await wait('panel', `d.querySelector('[data-testid="cleanup-delete"] button')`, 'cleanup actions');
        const writes = () => reqs(`r.method!=='GET'`);
        const w0 = (await writes()).length;
        await tabTo('panel', '[data-testid="cleanup-delete"] button');
        kcheck('K6', 'panel', 'delete:reach-sends-nothing', (await writes()).length === w0);
        await key('Enter');
        await wait('panel', `d.querySelector('[data-testid="cleanup-confirm"]')`, 'inline confirmation');
        kcheck('K6', 'panel', 'confirm:cancel-initially-focused', await focusedOn('panel', '[data-testid="cleanup-cancel"]'), undefined, await focusState());
        await focusShot('rail-focus-light-cleanup-confirm', 'panel', 120, 120);
        await key('Enter');
        await wait('panel', `!d.querySelector('[data-testid="cleanup-confirm"]')`, 'cancelled by Enter');
        kcheck('K6', 'panel', 'confirm:enter-cancels-to-opener', await focusedOn('panel', '[data-testid="cleanup-delete"] button') && (await writes()).length === w0, undefined, await focusState());
        await key('Enter'); await wait('panel', `d.querySelector('[data-testid="cleanup-confirm"]')`, 'confirmation again');
        await key('Escape');
        await wait('panel', `!d.querySelector('[data-testid="cleanup-confirm"]')`, 'cancelled by Escape');
        kcheck('K6', 'panel', 'confirm:escape-cancels-to-opener', await focusedOn('panel', '[data-testid="cleanup-delete"] button') && (await writes()).length === w0);
        await key('Enter'); await wait('panel', `d.querySelector('[data-testid="cleanup-confirm"]')`, 'confirmation for delete');
        await tabTo('panel', '[data-testid="cleanup-confirm-delete"]', 30, false);
        kcheck('K6', 'panel', 'confirm:destructive-reachable-not-sent', (await writes()).length === w0);
        await key('Enter');
        await wait('panel', `qa.requests.filter(r=>r.method!=='GET').length===${w0 + 1}`, 'one delete request');
        await wait('panel', `!d.querySelector('[data-testid="plan-K-finished-delete"]')`, 'deleted plan gone', 20_000);
        const del = (await writes()).slice(w0);
        const st = await focusState();
        inventory['rail-after-delete'] = st;
        kcheck('K6', 'panel', 'delete:exactly-one-request', del.length === 1 && /\/v1\/plan\/delete$/.test(del[0].path), ['Deliberate activation sent one delete for the disposable plan'], del.map((r: any) => `${r.method} ${r.path}`));
        await kexpect('K6', 'panel', 'delete:focus-not-stranded', notStranded(st), ['After the deleted plan leaves the rail, focus stays on a real element'], st);
        // Archive with a labelled 503, then success.
        await openPicker('panel', 'plan-selector', 'Disposable finished plan B');
        await wait('panel', `d.querySelector('[data-testid="cleanup-archive"] button')`, 'archive action');
        const pickedB = await railPlan();
        await evaluate(`qa.fail.push({path:'/v1/plan/archive',status:503,code:'busy',once:true});true`);
        await tabTo('panel', '[data-testid="cleanup-archive"] button'); await key('Enter');
        await wait('panel', `d.querySelector('[data-testid="cleanup-error"]')`, 'cleanup error');
        const se = await focusState();
        inventory['rail-after-archive-error'] = { focus: se, planBefore: pickedB, planAfter: await railPlan(), error: await guest<string>('panel', `return d.querySelector('[data-testid="cleanup-error"]')?.closest('[data-testid]')?.dataset.testid??''`) };
        // docs/ui.md Finished-plan cleanup › Invalidation: a failed/ambiguous action clears the affected selection and re-reads.
        await kexpect('K6', 'panel', 'archive-error:focus-not-stranded', notStranded(se), ['Focus moves to the cleanup error message'], se);
        await focusShot('rail-focus-light-cleanup-error', 'panel', 120, 120);
        if (await railPlan() !== pickedB) await openPicker('panel', 'plan-selector', 'Disposable finished plan B');
        await wait('panel', `d.querySelector('[data-testid="cleanup-archive"] button')`, 'archive action again');
        await tabTo('panel', '[data-testid="cleanup-archive"] button'); await key('Enter');
        await wait('panel', `qa.requests.filter(r=>r.path==='/v1/plan/archive').length>=2`, 'archive sent');
        await wait('panel', `!d.querySelector('[data-testid="cleanup-archive"] button')||d.querySelector('[data-testid="cleanup-notice"]')`, 'archived', 20_000);
        const sa = await focusState();
        inventory['rail-after-archive'] = sa;
        await kexpect('K6', 'panel', 'archive-success:focus-not-stranded', notStranded(sa), undefined, sa);
        await fx.cleanupElsewhere('restore', 'K-finished-archive');
      });
      // ---------------------------------------------------------------- K3 Work Status (360 px; 280 spot-check)
      await scenario('K3-status', ['K3', 'K11'], async () => {
        await show(['status'], 360); await theme('light');
        await evaluate(`qa.context('KF');true`); await fresh('status');
        await walkChecks('K3', 'status', 'status-360-light');
        await tabTo('status', '[data-testid="status-plan-selector"] .oc-sdk-trigger');
        await focusShot('status-focus-light-picker', 'status', 30, 60);
        await key('Enter'); await wait('status', `d.querySelector('.oc-sdk-popup [role="listbox"]')`, 'status popup');
        await focusShot('status-focus-light-popup', 'status', 40, 200);
        inventory['status-options'] = await optionLabels('status');
        await pickOpen('status', 'Parallel work example');
        await wait('status', `d.querySelector('section[data-testid="plan-K-many"]')`, 'manual choice shown');
        kcheck('K3', 'status', 'picker:manual-choice-keeps-trigger', await focusedOn('status', '[data-testid="status-plan-selector"] .oc-sdk-trigger'));
        let mark = await repliesMark(); await completedPolls('status', mark, 2);
        kcheck('K3', 'status', 'refresh:keeps-manual-choice-and-focus', await guest<boolean>('status', `return !!d.querySelector('section[data-testid="plan-K-many"]')`) && await focusedOn('status', '[data-testid="status-plan-selector"] .oc-sdk-trigger'));
        await tabTo('status', '[data-testid="open-detail"] button');
        await focusShot('status-focus-light-open', 'status', 60, 40);
        const opens = (await messages(/surface|open/i)).length;
        await key('Enter');
        await wait('status', `qa.messages.filter(m=>/surface|open/i.test(m.type)).length>${opens}`, 'open-surface request');
        mark = await repliesMark(); await completedPolls('status', mark, 1);
        const sent = (await messages(/surface|open/i)).slice(opens);
        kcheck('K3', 'status', 'open-progress:one-synthetic-host-request', sent.length === 1, undefined, sent);
        // 280 px clipping spot-check.
        await show(['status'], 280);
        const w280 = await walk('status-280-light');
        kcheck('K11', 'status', 'status-280:no-horizontal-clipping', w280.forward && w280.stops.every((s) => s.el?.inline), undefined, w280.list);
        await tabTo('status', '[data-testid="status-plan-selector"] .oc-sdk-trigger'); await key('Enter');
        await wait('status', `d.querySelector('.oc-sdk-popup [role="listbox"]')`, 'popup 280');
        kcheck('K11', 'status', 'status-280:popup-within-frame', await guest<boolean>('status', `const r=d.querySelector('.oc-sdk-popup').getBoundingClientRect();return r.left>=-1&&r.right<=w.innerWidth+1`));
        await focusShot('status-focus-light-280-popup', 'status', 40, 200);
        await key('Escape');
        await show(['status'], 360);
        // Selected plan removed elsewhere → Automatic without an unusable focus state.
        await openPicker('status', 'status-plan-selector', 'Disposable finished plan B');
        await wait('status', `d.querySelector('section[data-testid="plan-K-finished-archive"]')`, 'B featured');
        await fx.cleanupElsewhere('archive', 'K-finished-archive');
        await wait('status', `!d.querySelector('section[data-testid="plan-K-finished-archive"]')`, 'B removed', 20_000);
        const sx = await focusState();
        inventory['status-after-removed-choice'] = sx;
        kcheck('K3', 'status', 'removed-choice:automatic', await guest<boolean>('status', `return /Automatic/.test(d.querySelector('[data-testid="status-plan-selector"] .oc-sdk-trigger')?.textContent??'')`), undefined, sx);
        await kexpect('K3', 'status', 'removed-choice:focus-usable', notStranded(sx) && await focusedOn('status', '[data-testid="status-plan-selector"] .oc-sdk-trigger'), ['The surviving picker trigger keeps focus'], sx);
        await fx.cleanupElsewhere('restore', 'K-finished-archive');
        // No-session and error/Retry.
        await evaluate(`qa.context(null);true`);
        await wait('status', `d.querySelector('[data-testid="unscoped-state"]')`, 'no session');
        const ns = await walk('status-360-no-session');
        kcheck('K3', 'status', 'no-session:exits-both-ways', ns.forward && ns.backward);
        await evaluate(`qa.context('KF');qa.fail.push({path:'/v1/plans',frame:'status',status:503,code:'busy'});true`);
        const seq = await evaluate<number>(`qa.reload('status')`);
        await wait('status', `qa.loaded.status===${seq}&&d.querySelector('[data-testid^="state-"] button')`, 'status error with Try again', 20_000);
        kcheck('K3', 'status', 'error:not-empty', await guest<boolean>('status', `return !d.querySelector('[data-testid="empty-state"]')`));
        await tabTo('status', '[data-testid^="state-"] button');
        await focusShot('status-focus-light-error-retry', 'status', 60, 60);
        await evaluate(`qa.fail=qa.fail.filter(x=>x.frame!=='status');true`);
        await key('Enter');
        await wait('status', `d.querySelector('[data-testid="status-plan-selector"] .oc-sdk-trigger')`, 'status recovered', 20_000);
        const sr = await focusState();
        inventory['status-after-retry'] = sr;
        kcheck('K3', 'status', 'retry:recovers-frame-keeps-focus', !!sr.guestHasFocus, ['Status remains operable after its own error'], sr);
        await kexpect('K8', 'status', 'retry:focus-not-stranded-on-body', notStranded(sr), ['Try again disappears on recovery; focus should land on a real element'], sr);
        await handedTo('K8', 'status', 'retry', '[data-testid="status-plan-title"]', /^Progress loaded again, so focus moved to /);
        await focusShot('status-focus-light-retry-handoff', 'status', 40, 60);
        // Setup needed (labelled unconfigured /health seam): Set up sends the existing host action once.
        await evaluate(`qa.unconfigured=true;true`);
        const seq2 = await evaluate<number>(`qa.reload('status')`);
        await wait('status', `qa.loaded.status===${seq2}&&d.querySelector('[data-testid="setup-needed"] button')`, 'setup needed', 20_000);
        await tabTo('status', '[data-testid="setup-needed"] button');
        await focusShot('status-focus-light-setup-needed', 'status', 60, 40);
        const o2 = (await messages(/surface|open/i)).length;
        await key('Enter');
        await wait('status', `qa.messages.filter(m=>/surface|open/i.test(m.type)).length>${o2}`, 'set up request');
        kcheck('K3', 'status', 'setup-needed:one-host-request', (await messages(/surface|open/i)).length === o2 + 1);
        await evaluate(`qa.unconfigured=false;true`);
        for (const f of ['panel', 'page', 'status']) await fresh(f);
      });
      // ---------------------------------------------------------------- K2 board (1100 px)
      await scenario('K2-board', ['K2', 'K11'], async () => {
        await show(['page'], 1100); await theme('light'); await fresh('page');
        const w = await walkChecks('K2', 'page', 'board-1100-light');
        const ids = w.list.map((x: any) => x.testid);
        for (const hook of ['cleanup-visible', 'cleanup-archived', 'search-query', 'search-lifecycle', 'search-task-status', 'search-source', 'search-submit', 'filter-project', 'filter-worktree', 'filter-session', 'detail-tabs']) kcheck('K2', 'page', `reachable:${hook}`, ids.includes(hook), undefined, ids);
        const lists = w.list.filter((x: any) => x.role === 'listbox');
        kcheck('K2', 'page', 'plan-list:one-stop-per-group', lists.length >= 1, [`${lists.length} grouped listboxes`]);
        const listSel = `[data-testid="${(lists[0] as { testid: string }).testid}"] [role="listbox"]`;
        await tabTo('page', listSel);
        const sel0 = await guest<string | null>('page', `return d.querySelector('[role="option"][aria-selected="true"]')?.dataset.testid??null`);
        await focusShot('page-focus-light-listbox', 'page', 40, 200);
        await key('ArrowDown');
        const active1 = await guest<string | null>('page', `return d.querySelector('${listSel}').getAttribute('aria-activedescendant')`);
        kcheck('K2', 'page', 'plan-list:arrow-moves-without-selecting', await guest<string | null>('page', `return d.querySelector('[role="option"][aria-selected="true"]')?.dataset.testid??null`) === sel0 && !!active1, undefined, { sel0, active1 });
        await focusShot('page-focus-light-listbox-arrow', 'page', 40, 200);
        const chosen = await guest<string>('page', `return d.getElementById(d.querySelector('${listSel}').getAttribute('aria-activedescendant'))?.dataset.testid??''`);
        await key('Enter');
        await wait('page', `d.querySelector('[data-testid="${chosen}"]')?.getAttribute('aria-selected')==='true'&&d.querySelector('[data-testid="plan-detail"] article[data-testid="plan-${chosen.replace('plan-row-', '')}"]')`, 'selected plan rendered');
        kcheck('K2', 'page', 'plan-list:enter-selects-and-renders', await focusedOn('page', listSel), [`selected ${chosen}; listbox keeps focus`], await focusState());
        // Tabs: arrows switch Progress → Document → History and keep focus on the tab.
        await tabTo('page', '[data-testid="detail-tabs"] [role="tab"][aria-selected="true"]');
        await focusShot('page-focus-light-tabs', 'page', 30, 60);
        for (const name of ['document', 'history']) {
          await key('ArrowRight');
          await wait('page', `d.querySelector('[data-testid="detail-tabs"] [role="tab"][data-id="${name}"]')?.getAttribute('aria-selected')==='true'`, `${name} tab`);
          kcheck('K2', 'page', `tabs:arrow-to-${name}`, await focusedOn('page', `[data-testid="detail-tabs"] [role="tab"][data-id="${name}"]`), undefined, await focusState());
        }
        await key('Tab', 1, SHIFT);
        kcheck('K2', 'page', 'tabs:shift-tab-leaves-back', !(await focusedOn('page', '[data-testid="detail-tabs"]')) && await owns('page'));
        await key('Tab');
        kcheck('K2', 'page', 'tabs:tab-returns-to-active-tab', await focusedOn('page', '[data-testid="detail-tabs"] [role="tab"][data-id="history"]'));
        await key('Tab');
        kcheck('K2', 'page', 'tabs:tab-leaves-forward', !(await focusedOn('page', '[data-testid="detail-tabs"]')) && await owns('page'));
        await tabTo('page', '[data-testid="detail-tabs"] [role="tab"][aria-selected="true"]');
        await key('Home');
        await wait('page', `d.querySelector('[data-testid="detail-tabs"] [role="tab"][data-id="progress"]')?.getAttribute('aria-selected')==='true'`, 'Home to Progress');
        // Filters: SDK select opens, Escape restores.
        await tabTo('page', '[data-testid="filter-project"] .oc-sdk-trigger');
        await key('Enter');
        await wait('page', `d.querySelector('.oc-sdk-popup [role="listbox"]')`, 'project popup');
        // Observe the open popup across completed background polls (bounded by recorded replies).
        await guest('page', `w.__kfTrace=[];const t0=w.performance.now();const tick=()=>{const a=d.activeElement;w.__kfTrace.push({t:Math.round(w.performance.now()-t0),open:!!d.querySelector('.oc-sdk-popup [role="listbox"]'),active:a&&a!==d.body?(a.closest('[data-testid]')?.dataset.testid??a.tagName):'body',root:d.getElementById('root').firstElementChild?.dataset.kfMark??'new'});if(w.__kfTrace.length<400)w.requestAnimationFrame(tick)};d.getElementById('root').firstElementChild.dataset.kfMark='old';tick();return true`);
        const pm = await repliesMark(); await completedPolls('page', pm, 2, 'two polls with the filter popup open');
        const trace = await guest<any[]>('page', `return w.__kfTrace.filter((x,i,a)=>i===0||x.open!==a[i-1].open||x.active!==a[i-1].active||x.root!==a[i-1].root)`);
        inventory['board-filter-popup-trace'] = trace;
        kcheck('K8', 'page', 'filter-popup:stays-open-with-focus-across-polls', await popupOpen('page') && await focusedOn('page', '.oc-sdk-popup'), ['The popup stays open and owns focus across two completed board polls'], { trace, focus: await focusState() });
        await focusShot('page-focus-light-filter-popup', 'page', 40, 200);
        await key('Escape');
        kcheck('K2', 'page', 'filter:escape-restores-trigger', await focusedOn('page', '[data-testid="filter-project"] .oc-sdk-trigger'), undefined, await focusState());
        // Current/Archived buttons.
        await tabTo('page', '[data-testid="cleanup-archived"] button'); await key('Enter');
        await wait('page', `d.querySelector('[data-testid="cleanup-archived"] button')?.getAttribute('aria-pressed')==='true'`, 'archived mode');
        kcheck('K2', 'page', 'archived-mode:enter-switches-keeps-focus', await focusedOn('page', '[data-testid="cleanup-archived"] button'));
        await key('Tab', 1, SHIFT); await key('Enter');
        await wait('page', `d.querySelector('[data-testid="cleanup-visible"] button')?.getAttribute('aria-pressed')==='true'`, 'current mode');
        kcheck('K2', 'page', 'current-mode:enter-switches-keeps-focus', await focusedOn('page', '[data-testid="cleanup-visible"] button'));
      });
      await scenario('K7-board-search', ['K7', 'K8'], async () => {
        await show(['page'], 1100); await fresh('page');
        await tabTo('page', '#ap-search-q');
        await key('End'); for (let i = 0; i < 40 && await guest<string>('page', `return d.getElementById('ap-search-q').value`); i++) await c.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
        await type('export csv'); await key('Enter');
        await wait('page', `d.querySelector('[data-testid="search-results"]')&&!(${busy})`, 'results');
        kcheck('K7', 'page', 'enter-submits-focus-stays-in-field', await focusedOn('page', '#ap-search-q'));
        if (await hasMore()) { await tabTo('page', '[data-testid="search-more"] button'); await focusShot('page-focus-light-search-continue', 'page', 60, 60); }
        for (let i = 0; i < 12 && await hasMore(); i++) { await tabTo('page', '[data-testid="search-more"] button'); await key('Enter'); await idle(); }
        const st = await focusState();
        inventory['search-after-exhaust'] = st;
        await kexpect('K7', 'page', 'continue:focus-after-last-window', notStranded(st), ['When Continue disappears after the last window, is focus on a real element?'], st);
        await handedTo('K7', 'page', 'continue', '[data-testid="search-results-heading"]', /^Results updated, so focus moved to Search results\.$/);
        await focusShot('page-focus-light-search-continue-handoff', 'page', 40, 90);
        const hit = 'search-task-source-alpha/P-export/T-csv';
        await tabTo('page', `[data-testid="${hit}"]`);
        await focusShot('page-focus-light-search-hit', 'page', 40, 60);
        await key('Enter');
        await wait('page', `d.activeElement?.dataset.testid?.startsWith('item-')`, 'canonical reveal from hit');
        kcheck('K7', 'page', 'hit:enter-reveals-canonical-row', await owns('page'));
        await tabTo('page', '[data-testid="search-chip-q"] button'); await key('Enter');
        await wait('page', `!d.querySelector('[data-testid="search-chip-q"]')`, 'chip removed');
        await frames2();
        const sc = await focusState();
        inventory['search-after-chip'] = sc;
        await kexpect('K7', 'page', 'chip-remove:focus-not-stranded', notStranded(sc), undefined, sc);
        await handedTo('K7', 'page', 'chip-remove', '[data-testid="search-results-heading"], [data-testid="plan-list-heading"]', /^Filter removed, so focus moved to (Search results|Plans)\.$/);
        if (await guest<boolean>('page', `return !!d.querySelector('[data-testid="search-results"]')`)) { await tabTo('page', '[data-testid="search-clear"] button'); await key('Enter'); await wait('page', `!d.querySelector('[data-testid="search-results"]')`, 'cleared'); }
        await tabTo('page', '#ap-search-q');
        await type('zz-kf-absent'); await key('Enter');
        await wait('page', `d.querySelector('[data-testid="search-results"]')&&!(${busy})`, 'absent results');
        for (let i = 0; i < 12 && await hasMore(); i++) {
          kcheck('K7', 'page', `absent:not-empty-while-unchecked-${i}`, await guest<boolean>('page', `return !d.querySelector('[data-testid="search-empty"]')`));
          await tabTo('page', '[data-testid="search-more"] button'); await key('Enter'); await idle();
        }
        kcheck('K7', 'page', 'absent:search-empty-distinct', await guest<boolean>('page', `return !!d.querySelector('[data-testid="search-empty"]')&&!d.querySelector('[data-testid="search-failed"]')&&!d.querySelector('[data-testid="search-loading"]')`));
        const se = await focusState();
        inventory['search-after-empty'] = se;
        await kexpect('K7', 'page', 'absent:last-continue-focus-not-stranded', notStranded(se), undefined, se);
        await handedTo('K7', 'page', 'absent-continue', '[data-testid="search-results-heading"]', /^Results updated, so focus moved to Search results\.$/);
        await tabTo('page', '[data-testid="search-clear"] button');
        await focusShot('page-focus-light-search-empty-clear', 'page', 80, 60);
        await key('Enter');
        await wait('page', `!d.querySelector('[data-testid="search-results"]')&&d.querySelector('[data-testid="plan-list"]')`, 'browsing again');
        const sb = await focusState();
        inventory['search-after-clear'] = sb;
        await kexpect('K7', 'page', 'clear:recovers-browsing-focus-not-stranded', notStranded(sb), undefined, sb);
        await handedTo('K7', 'page', 'clear-all', '[data-testid="plan-list-heading"]', /^Search cleared, so focus moved to Plans\.$/);
        kcheck('K7', 'page', 'clear-all:no-obsolete-results', !(await guest<boolean>('page', `return !!d.querySelector('[data-testid="search-results"]')`)));
        await focusShot('page-focus-light-search-clear-handoff', 'page', 40, 120);
        // Search failure with Retry.
        await evaluate(`qa.fail.push({path:'/v1/search',status:503,code:'busy',once:true});true`);
        await tabTo('page', '#ap-search-q'); await type('Needle'); await key('Enter');
        await wait('page', `d.querySelector('[data-testid="search-failed"]')`, 'search failed');
        kcheck('K8', 'page', 'search-failure:error-not-empty', await guest<boolean>('page', `return !d.querySelector('[data-testid="search-empty"]')`));
        await tabTo('page', '[data-testid="search-retry"] button');
        await focusShot('page-focus-light-search-retry', 'page', 60, 60);
        await key('Enter'); await idle();
        const sr = await focusState();
        inventory['search-after-retry'] = sr;
        await kexpect('K8', 'page', 'search-retry:focus-not-stranded', notStranded(sr), undefined, sr);
        await handedTo('K8', 'page', 'search-retry', '[data-testid="search-results-heading"]', /^Search resumed, so focus moved to Search results\.$/);
        await tabTo('page', '[data-testid="search-clear"] button'); await key('Enter');
        await wait('page', `!d.querySelector('[data-testid="search-results"]')`, 'cleared');
      });
      await scenario('K10-board', ['K10'], async () => {
        await show(['page'], 1100); await fresh('page');
        // Same plan/item IDs from another source, opened through search results by keyboard.
        await tabTo('page', '#ap-search-q'); await type('export csv'); await key('Enter');
        await wait('page', `d.querySelector('[data-testid="search-results"]')&&!(${busy})`, 'results');
        for (let i = 0; i < 12 && await hasMore(); i++) { await tabTo('page', '[data-testid="search-more"] button'); await key('Enter'); await idle(); }
        const alphaHit = 'search-task-source-alpha/P-export/T-csv', betaHit = await guest<string | null>('page', `return d.querySelector('[data-testid^="search-plan-source-beta/P-export"],[data-testid^="search-task-source-beta/P-export"]')?.dataset.testid??null`);
        if (!betaHit) skip('K10', 'page', 'no other-source P-export result offered');
        else {
          await tabTo('page', `[data-testid="${alphaHit}"]`); await key('Enter');
          await wait('page', `d.activeElement?.dataset.testid==='item-T-csv'&&d.activeElement.closest('article')?.dataset.source==='source-alpha'`, 'alpha T-csv revealed by keyboard');
          await tabTo('page', `[data-testid="${betaHit}"]`); await key('Enter');
          await wait('page', `d.querySelector('article[data-testid="plan-P-export"][data-source="source-beta"]')`, 'beta P-export rendered');
          // While searching, the board's ordinary poll is the search freshness read.
          const searchPoll = async () => { const m = await repliesMark(); await wait('page', `qa.replies.slice(${m}).some(r=>r.frame==='page'&&r.path==='/v1/search-state'&&r.status===200)`, 'one completed search freshness poll'); };
          await searchPoll();
          const st = await focusState();
          inventory['board-other-source-focus'] = st;
          kcheck('K10', 'page', 'other-source:no-old-row-focus', !(st.guests.page.active === 'item-T-csv') && await guest<boolean>('page', `return !(d.activeElement?.dataset.testid==='item-T-csv'&&d.activeElement.closest('article')?.dataset.source==='source-beta')`), ['Opening the same plan/item IDs from another source never moves the old row focus into it'], st);
          await kexpect('K10', 'page', 'other-source:initiating-control-kept', await focusedOn('page', `[data-testid="${betaHit}"]`), ['The initiating result keeps focus'], st);
          await evaluate(`qa.context('B');qa.context(null);qa.context('KF');true`);
          await searchPoll();
          kcheck('K10', 'page', 'host-session-changes:board-keeps-scope', await guest<boolean>('page', `return !!d.querySelector('article[data-testid="plan-P-export"][data-source="source-beta"]')`));
          await kexpect('K10', 'page', 'host-session-changes:focus-kept', (await focusState()).guests.page.active === st.guests.page.active, undefined, await focusState());
        }
        await fresh('page');
        // External focus: end sentinel owns focus while the board receives a changed read.
        await click('page', '[data-testid="plan-row-K-focus"]');
        setups.push('K10-board: pointer selection of K-focus');
        await wait('page', `d.querySelector('article[data-reading][data-testid="plan-K-focus"] .ap-tasks[data-complete]')`, 'K-focus on board');
        await tabTo('page', '[data-testid="focus-jump-working"] button'); await key('Enter');
        await wait('page', `d.activeElement?.dataset.testid?.startsWith('item-')`, 'board row focused');
        await clickTop('#qa-after');
        setups.push('K10-board: pointer click on the end sentinel (external focus)');
        const rev = await guest<string>('page', `return d.querySelector('article[data-reading]').dataset.revision`);
        fx.reportKeyboard('K-focus', { op: 'change', changes: [{ id: 'N', status: 'working' }] });
        await wait('page', `d.querySelector('article[data-reading]').dataset.revision!=='${rev}'&&d.querySelector('article[data-reading] .ap-tasks[data-complete]')`, 'board changed paint');
        const m2 = await repliesMark(); await completedPolls('page', m2, 1);
        const se = await focusState();
        kcheck('K10', 'page', 'external:background-paint-does-not-steal', se.top === 'qa-after' && !se.guests.page.hasFocus, undefined, se);
      });
      // ---------------------------------------------------------------- K5/K6 board secondary tabs and footer
      await scenario('K5-board', ['K5', 'K6'], async () => {
        await show(['page'], 1100); await fresh('page');
        await wait('page', `d.querySelector('[data-testid="detail-tabs"]')`, 'detail tabs');
        await tabTo('page', '[data-testid="detail-tabs"] [role="tab"][aria-selected="true"]');
        // Map is the fourth (last) tab since S5, so History is two steps right of Progress, not End.
        await key('ArrowRight');
        await wait('page', `d.querySelector('[data-testid="detail-tabs"] [role="tab"][data-id="document"]')?.getAttribute('aria-selected')==='true'`, 'document');
        await key('ArrowRight');
        await wait('page', `d.querySelector('[data-testid="detail-tabs"] [role="tab"][data-id="history"]')?.getAttribute('aria-selected')==='true'`, 'history');
        await wait('page', `d.querySelector('[data-testid="change-digest"]')&&d.querySelector('[data-testid="change-digest"]').dataset.state!=='loading'`, 'digest settled', 20_000).catch(() => null);
        const hw = await walk('board-1100-light-history');
        const hids = hw.list.map((x: any) => x.testid);
        inventory['history-hooks'] = [...new Set(hids)];
        kcheck('K5', 'page', 'history:walk-exits', hw.forward && hw.backward);
        for (const hook of ['digest-refresh', 'digest-mark-reviewed']) {
          if (!hids.includes(hook)) { skip('K5', 'page', `${hook} not offered in this digest state`); continue; }
          await tabTo('page', `[data-testid="${hook}"] button, button[data-testid="${hook}"]`);
          await focusShot(`page-focus-light-${hook}`, 'page', 40, 40);
          kcheck('K5', 'page', `${hook}:reachable-visible`, !!(await focusState()).el?.inline);
        }
        const recorded = hids.find((h: string) => /^digest-(entry|history|view)-/.test(h ?? ''));
        if (recorded) { await tabTo('page', `[data-testid="${recorded}"] > summary, [data-testid="${recorded}"] button, button[data-testid="${recorded}"], summary[data-testid="${recorded}"]`).catch(() => null); }
        await tabTo('page', '[data-testid="detail-tabs"] [role="tab"][aria-selected="true"]');
        await key('ArrowLeft');
        await wait('page', `d.querySelector('[data-testid="detail-tabs"] [role="tab"][data-id="document"]')?.getAttribute('aria-selected')==='true'`, 'document');
        const dw = await walk('board-1100-light-document');
        inventory['document-hooks'] = [...new Set(dw.list.map((x: any) => x.testid))];
        kcheck('K5', 'page', 'document:walk-exits', dw.forward && dw.backward);
        await tabTo('page', '[data-testid="detail-tabs"] [role="tab"][aria-selected="true"]'); await key('Home');
        await wait('page', `d.querySelector('[data-testid="detail-tabs"] [role="tab"][data-id="progress"]')?.getAttribute('aria-selected')==='true'`, 'progress');
        // Footer: reporting health, Setup (intercepted), Details.
        await tabTo('page', '[data-testid="reporting-health-toggle"] button');
        await key('Enter');
        await wait('page', `d.querySelector('[data-testid="reporting-health-toggle"] button')?.getAttribute('aria-expanded')==='true'`, 'reporting health open', 20_000);
        kcheck('K5', 'page', 'reporting-health:enter-opens-keeps-focus', await focusedOn('page', '[data-testid="reporting-health-toggle"] button'));
        await wait('page', `d.querySelector('[data-testid="reporting-support-preview"],[data-testid="reporting-health-refresh"]')`, 'reporting body', 20_000).catch(() => null);
        const rw = await walk('board-1100-light-footer-health');
        inventory['footer-health-hooks'] = [...new Set(rw.list.map((x: any) => x.testid))];
        for (const hook of ['reporting-health-refresh', 'reporting-support-preview', 'reporting-support-copy']) {
          if (!rw.list.some((x: any) => x.testid === hook)) { skip('K5', 'page', `${hook} not rendered in this state`); continue; }
          await tabTo('page', `[data-testid="${hook}"] button, [data-testid="${hook}"]`);
          await focusShot(`page-focus-light-${hook}`, 'page', 60, 60);
          kcheck('K5', 'page', `${hook}:reachable`, await owns('page'));
        }
        await tabTo('page', '[data-testid="reporting-health-toggle"] button'); await key('Enter');
        await tabTo('page', '[data-testid="setup-section"] > summary'); await key('Enter');
        await wait('page', `d.querySelector('[data-testid="setup-section"]').open&&d.querySelector('[data-testid="setup-panel"]')`, 'setup panel', 20_000);
        kcheck('K5', 'page', 'setup:enter-opens-keeps-focus', await focusedOn('page', '[data-testid="setup-section"] > summary'));
        const sw = await walk('board-1100-light-setup');
        const sids = [...new Set(sw.list.map((x: any) => x.testid))];
        inventory['setup-hooks'] = sids;
        const nonGet = async () => (await evaluate<any[]>('qa.intercepted')).filter((r) => r.method !== 'GET').length;
        const before = await nonGet();
        const action = ['setup-disable', 'setup-enable', 'setup-remove'].find((h) => sids.includes(h));
        if (action) {
          await tabTo('page', `[data-testid="${action}"] button, button[data-testid="${action}"]`);
          kcheck('K6', 'page', `${action}:reach-sends-nothing`, await nonGet() === before);
          await key('Enter');
          await frames2();
          const confirm = await guest<string | null>('page', `return d.querySelector('[data-testid^="setup-confirm-"]')?.dataset.testid??null`);
          const cancel = await guest<boolean>('page', `return !!d.querySelector('[data-testid="setup-cancel"]')`);
          inventory['setup-confirm'] = { confirm, cancel, focus: await focusState() };
          await kexpect('K6', 'page', `${action}:open-focuses-cancel`, await focusedOn('page', '[data-testid="setup-cancel"]'), ['Cancel receives focus when the confirmation opens'], await focusState());
          kcheck('K6', 'page', `${action}:open-sends-nothing`, await nonGet() === before);
          await kexpect('K6', 'page', `${action}:open-confirmation-focus-not-stranded`, notStranded((inventory['setup-confirm'] as any).focus), ['Opening the confirmation leaves focus on a real element'], (inventory['setup-confirm'] as any).focus);
          if (cancel) {
            if (notStranded(await focusState())) await focusShot('page-focus-light-setup-confirm', 'page', 160, 60);
            else await shot('page-setup-confirm-focus-lost', '[data-testid="setup-section"]', 8, 900, 'page');
            await tabTo('page', '[data-testid="setup-cancel"] button, button[data-testid="setup-cancel"]'); await key('Enter');
            await frames2();
            const sc = await focusState();
            kcheck('K6', 'page', `${action}:cancel-sends-nothing`, await nonGet() === before, undefined, sc);
            await kexpect('K6', 'page', `${action}:cancel-focus-not-stranded`, notStranded(sc), undefined, sc);
            await kexpect('K6', 'page', `${action}:cancel-returns-to-opener`, await focusedOn('page', `[data-testid="${action}"]`), undefined, sc);
            // Escape cancels too, and returns once to the opener without a request.
            await key('Enter'); await wait('page', `d.querySelector('[data-testid="setup-cancel"]')`, 'confirmation reopened');
            await key('Escape'); await frames2();
            await kexpect('K6', 'page', `${action}:escape-cancels-to-opener`, await focusedOn('page', `[data-testid="${action}"]`) && !(await guest<boolean>('page', `return !!d.querySelector('[data-testid="setup-cancel"]')`)) && await nonGet() === before, undefined, await focusState());
          } else skip('K6', 'page', `${action}: no cancel control appeared (${confirm})`);
          if (confirm) {
            if (!(await guest<boolean>('page', `return !!d.querySelector('[data-testid="${confirm}"]')`))) { await tabTo('page', `[data-testid="${action}"] button, button[data-testid="${action}"]`); await key('Enter'); await frames2(); }
            await tabTo('page', `[data-testid="${confirm}"] button, button[data-testid="${confirm}"]`); await key('Enter');
            await wait('page', `qa.intercepted.filter(r=>r.method!=='GET').length===${before + 1}`, 'one intercepted setup action');
            const sent = (await evaluate<any[]>('qa.intercepted')).filter((r) => r.method !== 'GET').slice(before);
            kcheck('K6', 'page', `${action}:deliberate-confirm-one-intercepted`, sent.length === 1, ['Setup action answered by the shell from the synthetic setup fixture; never forwarded'], sent.map((r) => `${r.method} ${r.path}`));
            await frames2();
            const sd = await focusState();
            inventory['setup-after-confirm'] = sd;
            await kexpect('K6', 'page', `${action}:after-confirm-focus-not-stranded`, notStranded(sd), undefined, sd);
            const openerGone = !(await guest<boolean>('page', `return !!d.querySelector('[data-testid="${action}"]')`));
            await kexpect('K6', 'page', `${action}:after-confirm-opener-or-heading`, openerGone ? await focusedOn('page', '[data-testid="setup-status-heading"]') : await focusedOn('page', `[data-testid="${action}"]`), [openerGone ? 'The confirmed result replaced the opener: focus is on the setup status heading' : 'Focus returned to the opener'], sd);
            if (await owns('page')) await focusShot('page-focus-light-setup-after-confirm', 'page', 60, 100);
          }
        } else skip('K6', 'page', `no configured-setup action rendered: ${JSON.stringify(sids)}`);
        kcheck('K6', 'all', 'setup:no-setup-request-forwarded', (await evaluate<any[]>('qa.replies')).every((r) => !String(r.path).startsWith('/v1/setup')) && (await reqs(`r.path.startsWith('/v1/setup')`)).length === (await evaluate<any[]>('qa.intercepted')).length, ['Every /v1/setup request was answered by the shell seam']);
        await tabTo('page', '[data-testid="details"] > summary'); await key('Enter');
        kcheck('K5', 'page', 'details:enter-opens', await guest<boolean>('page', `return d.querySelector('[data-testid="details"]').open`) && await focusedOn('page', '[data-testid="details"] > summary'));
        await key('Enter');
      });
      await scenario('K5-document', ['K5'], async () => {
        fx.recordDocument('P-0006', '# Example plan\nKeep this line\nOld action\n');
        fx.recordDocument('P-0006', '# Example plan\nKeep this line\nNew action\n', '/fixture/revised-plan.md');
        setups.push('K5-document: two synthetic recorded captures for P-0006 (existing recordDocument seam)');
        await show(['page'], 1100); await fresh('page');
        const list = await guest<string>('page', `return d.querySelector('[data-testid="plan-row-P-0006"]').closest('[data-testid^="project-"]').dataset.testid`);
        await tabTo('page', `[data-testid="${list}"] [role="listbox"]`);
        const idx = await guest<number>('page', `return [...d.querySelectorAll('[data-testid="${list}"] [role="option"]')].findIndex(o=>o.dataset.testid==='plan-row-P-0006')`);
        await key('Home'); if (idx) await key('ArrowDown', idx); await key('Enter');
        await wait('page', `d.querySelector('[data-testid="plan-row-P-0006"]')?.getAttribute('aria-selected')==='true'&&d.querySelector('article[data-testid="plan-P-0006"]')`, 'P-0006 selected by keyboard');
        await tabTo('page', '[data-testid="detail-tabs"] [role="tab"][aria-selected="true"]'); await key('ArrowRight');
        await wait('page', `d.querySelector('[data-testid="capture-toggle"] button')`, 'comparison action', 20_000);
        const reads = () => evaluate<number>(`qa.requests.filter(q=>q.path==='/v1/document-captures'||q.path==='/v1/document-comparison').length`);
        const r0 = await reads();
        await tabTo('page', '[data-testid="capture-toggle"] button');
        kcheck('K5', 'page', 'capture-toggle:reach-reads-nothing', await reads() === r0);
        await focusShot('page-focus-light-capture-toggle', 'page', 40, 60);
        await key('Enter');
        await wait('page', `d.querySelector('[data-testid="capture-diff"]')`, 'comparison diff', 20_000);
        const st = await focusState();
        inventory['capture-after-open'] = st;
        await kexpect('K5', 'page', 'capture-toggle:open-focus-kept', notStranded(st), ['Opening the comparison keeps focus on a real element'], st);
        const dw = await walk('board-1100-light-document-comparison');
        const hooks = [...new Set(dw.list.map((x: any) => x.testid))];
        inventory['document-comparison-hooks'] = hooks;
        kcheck('K5', 'page', 'comparison:walk-exits', dw.forward && dw.backward);
        for (const hook of ['capture-before', 'capture-after']) {
          if (!hooks.includes(hook)) { skip('K5', 'page', `${hook} selector not rendered`); continue; }
          await tabTo('page', `[data-testid="${hook}"] .oc-sdk-trigger, [data-testid="${hook}"] button`); await key('Enter');
          await wait('page', `d.querySelector('.oc-sdk-popup [role="listbox"]')`, `${hook} popup`);
          await key('Escape');
          kcheck('K5', 'page', `${hook}:escape-restores-trigger`, await focusedOn('page', `[data-testid="${hook}"]`), undefined, await focusState());
        }
        if (hooks.includes('capture-compare')) { await tabTo('page', '[data-testid="capture-compare"] button'); await focusShot('page-focus-light-capture-compare', 'page', 40, 40); kcheck('K5', 'page', 'capture-compare:reachable', await owns('page')); }
        else skip('K5', 'page', 'Compare is disabled for the default pair (native disabled controls need not be focusable)');
        for (const hook of ['capture-refresh', 'capture-more', 'capture-retry']) if (!hooks.includes(hook)) skip('K5', 'page', `${hook} not offered in this comparison state`);
      });
      // ---------------------------------------------------------------- K6 board restore + rail compact setup form
      await scenario('K6-board-restore', ['K6'], async () => {
        await show(['page'], 1100); await fresh('page');
        await fx.cleanupElsewhere('archive', 'K-finished-archive');
        await tabTo('page', '[data-testid="cleanup-archived"] button'); await key('Enter');
        await wait('page', `d.querySelector('[data-testid="plan-row-K-finished-archive"]')`, 'archived list', 20_000);
        await click('page', '[data-testid="plan-row-K-finished-archive"]');
        setups.push('K6-board-restore: pointer selection of the archived disposable plan');
        await wait('page', `d.querySelector('[data-testid="cleanup-restore"] button')`, 'restore action');
        await tabTo('page', '[data-testid="cleanup-restore"] button');
        await focusShot('page-focus-light-restore', 'page', 60, 60);
        await key('Enter');
        await wait('page', `qa.requests.some(r=>r.path==='/v1/plan/restore')`, 'restore sent');
        await wait('page', `!d.querySelector('[data-testid="cleanup-restore"] button')||d.querySelector('[data-testid="cleanup-notice"]')`, 'restored', 20_000);
        await frames2();
        const st = await focusState();
        inventory['board-after-restore'] = st;
        await kexpect('K6', 'page', 'restore:focus-not-stranded', notStranded(st), undefined, st);
        await tabTo('page', '[data-testid="cleanup-visible"] button'); await key('Enter');
        await wait('page', `d.querySelector('[data-testid="cleanup-visible"] button')?.getAttribute('aria-pressed')==='true'`, 'current mode');
      });
      await scenario('K6-rail-setup', ['K6'], async () => {
        await show(['panel'], 360);
        await evaluate(`qa.unconfigured=true;true`);
        const seq = await evaluate<number>(`qa.reload('panel')`);
        await wait('panel', `qa.loaded.panel===${seq}&&d.querySelector('[data-testid="setup-panel"]')`, 'compact setup', 20_000);
        const sw = await walk('rail-360-light-setup');
        const sids = [...new Set(sw.list.map((x: any) => x.testid))];
        inventory['rail-setup-hooks'] = sids;
        kcheck('K6', 'panel', 'setup:walk-exits', sw.forward && sw.backward);
        const fields = sw.list.filter((x: any) => x.tag === 'input');
        kcheck('K6', 'panel', 'setup:labelled-fields-reachable', fields.length > 0 && fields.every((x: any) => x.label), undefined, fields);
        if (fields.length) { await tabTo('panel', 'input'); await focusShot('rail-focus-light-setup-field', 'panel', 40, 60); }
        const nonGet = async () => (await evaluate<any[]>('qa.intercepted')).filter((r) => r.method !== 'GET').length;
        const before = await nonGet();
        const inspect = sids.find((h) => h === 'setup-inspect' || h === 'setup-review');
        if (inspect) {
          await tabTo('panel', `[data-testid="${inspect}"] button, button[data-testid="${inspect}"]`);
          kcheck('K6', 'panel', `${inspect}:reach-sends-nothing`, await nonGet() === before);
          await focusShot('rail-focus-light-setup-action', 'panel', 60, 60);
        } else skip('K6', 'panel', `no inspect/review action: ${JSON.stringify(sids)}`);
        await evaluate(`qa.unconfigured=false;true`);
        for (const f of ['panel', 'page', 'status']) await fresh(f);
      });
      // ---------------------------------------------------------------- K11 dark + narrow walks with screenshots
      // Post-review regression: Try again after an unavailable service that recovers into a genuinely
      // unconfigured service (labelled /health seams) hands focus to the setup state, not body.
      await scenario('K8-retry-to-setup', ['K8'], async () => {
        await evaluate(`qa.context('KF');true`);
        for (const [surface, width, target] of [['panel', 360, '[data-testid="setup-needed"]'], ['page', 1100, '[data-testid="setup-status-heading"]']] as const) {
          await show([surface], width);
          await evaluate(`qa.fail.push({path:'/health',frame:'${surface}',status:503,code:'unavailable'});true`);
          const seq = await evaluate<number>(`qa.reload('${surface}')`);
          await wait(surface, `qa.loaded['${surface}']===${seq}&&d.querySelector('[data-testid^="state-"] button')`, `${surface} failure with Try again`, 20_000);
          await tabTo(surface, '[data-testid^="state-"] button');
          setups.push(`K8-retry-to-setup: labelled /health 503 then not-ready seam (${surface})`);
          await evaluate(`qa.fail=qa.fail.filter(x=>x.frame!=='${surface}');qa.unconfigured=true;true`);
          await key('Enter');
          await wait(surface, `d.querySelector('${target}')&&!d.querySelector('[data-testid^="state-"] button')`, `${surface} setup state`, 20_000);
          await frames2();
          const st = await focusState();
          inventory[`retry-to-setup-${surface}`] = st;
          await kexpect('K8', surface, 'retry-to-setup:focus-not-stranded', notStranded(st), undefined, st);
          await handedTo('K8', surface, 'retry-to-setup', target, /^Setup is needed, so focus moved to /);
          if (notStranded(st)) await focusShot(`${surface === 'panel' ? 'rail' : 'page'}-focus-light-retry-to-setup`, surface, 40, 90);
          // Screenshot evidence only: the same focused rail setup state in the dark theme.
          if (surface === 'panel' && notStranded(st)) { await theme('dark'); await focusShot('rail-focus-dark-retry-to-setup', surface, 40, 90); await theme('light'); }
          await evaluate(`qa.unconfigured=false;true`);
          await fresh(surface);
        }
        for (const f of ['panel', 'page', 'status']) await fresh(f);
      });
      await scenario('K11-visual', ['K11'], async () => {
        await theme('dark');
        await evaluate(`qa.context('KF');true`);
        await show(['panel'], 360); await fresh('panel');
        await railOn('Focus controls example', 'K-focus');
        await walkChecks('K11', 'panel', 'rail-360-dark');
        for (const [sel, name] of [['[data-testid="plan-selector"] .oc-sdk-trigger', 'picker'], ['[data-testid="focus-mode-unfinished"] button', 'mode'], ['[data-testid="focus-expand-all"] button', 'expand'], ['article[data-reading] details[data-testid^="group-toggle-"] > summary', 'summary'], ['[data-testid="summary-progress"]', 'summary-action']] as const) {
          await tabTo('panel', sel); await focusShot(`rail-focus-dark-${name}`, 'panel');
        }
        await tabTo('panel', '[data-testid="focus-jump-working"] button'); await key('Enter');
        await wait('panel', `d.activeElement?.dataset.testid?.startsWith('item-')`, 'dark jump');
        await focusShot('rail-focus-dark-jump-row', 'panel');
        await show(['page'], 1100); await fresh('page');
        await walkChecks('K11', 'page', 'board-1100-dark');
        for (const [sel, name] of [['#ap-search-q', 'search'], ['[data-testid="search-submit"] button', 'submit'], ['[data-testid="plan-list"] [role="listbox"]', 'listbox'], ['[data-testid="detail-tabs"] [role="tab"][aria-selected="true"]', 'tabs'], ['[data-testid="focus-mode-unfinished"] button', 'mode'], ['[data-testid="cleanup-archived"] button', 'mode-archived']] as const) {
          await tabTo('page', sel); await focusShot(`page-focus-dark-${name}`, 'page', 40, sel.includes('listbox') ? 200 : 60);
        }
        await show(['page'], 360);
        const nw = await walk('page-360-dark');
        kcheck('K11', 'page', 'page-360:no-horizontal-clipping', nw.forward && nw.stops.every((s) => s.el?.inline), undefined, nw.list.filter((x: any) => !x.inline));
        await tabTo('page', '[data-testid="focus-mode-unfinished"] button'); await focusShot('page-focus-dark-360-mode', 'page');
        await show(['status'], 360); await fresh('status');
        await walkChecks('K11', 'status', 'status-360-dark');
        await tabTo('status', '[data-testid="status-plan-selector"] .oc-sdk-trigger'); await focusShot('status-focus-dark-picker', 'status', 30, 60);
        await tabTo('status', '[data-testid="open-detail"] button'); await focusShot('status-focus-dark-open', 'status', 60, 40);
        const pairs: [string, string, string][] = [
          ['panel', '[data-testid="focus-mode-unfinished"] button', 'rail-pair-mode'], ['panel', '[data-testid="focus-expand-all"] button', 'rail-pair-expand'],
          ['panel', '[data-testid="focus-jump-working"] button', 'rail-pair-jump'], ['panel', '[data-testid="plan-selector"] .oc-sdk-trigger', 'rail-pair-picker'],
          ['panel', '[data-testid="summary-progress"]', 'rail-pair-summary-action'], ['panel', 'article[data-reading] details[data-testid^="group-toggle-"] > summary', 'rail-pair-group-summary'],
          ['page', '[data-testid^="project-"] [role="listbox"]', 'page-pair-listbox'], ['page', '[data-testid="detail-tabs"] [role="tab"][aria-selected="true"]', 'page-pair-tab'],
          ['page', '[data-testid="search-submit"] button', 'page-pair-submit'], ['page', '#ap-search-q', 'page-pair-search'],
          ['status', '[data-testid="open-detail"] button', 'status-pair-open'], ['status', '[data-testid="status-plan-selector"] .oc-sdk-trigger', 'status-pair-picker'],
        ];
        for (const mode of ['dark', 'light'] as const) {
          await theme(mode);
          for (const [surface, sel, name] of pairs) {
            await show([surface], surface === 'page' ? 1100 : 360);
            if (surface === 'panel') await railOn('Focus controls example', 'K-focus');
            const same = await focusPair(`${name}-${mode}`, surface, sel);
            await kexpect('K11', surface, `${name}-${mode}:focused-differs-from-unfocused`, !same, ['Pixel-identical focused/unfocused captures mean no visible focus at all (review the pair)']);
            const pair = (facts.focusPairs as any[]).at(-1);
            await kexpect('K11', surface, `${name}-${mode}:focus-ring-present`, pair.focused.ring === 'true', ['Corroboration only: an outline or focus-token ring on the control (or the listbox’s active option), not just the hover tint'], pair.focused);
          }
        }
        await theme('light');
        await show(['page'], 1100);
        for (const [sel, name] of [['[data-testid="focus-mode-unfinished"] button', 'mode'], ['[data-testid="focus-expand-all"] button', 'expand'], ['[data-testid="search-submit"] button', 'submit'], ['[data-testid="cleanup-archived"] button', 'mode-archived']] as const) {
          await tabTo('page', sel); await focusShot(`page-focus-light-${name}`, 'page');
        }
      });
      // Coverage notes for paths this mode does not drive (never silent).
      skip('K4', 'panel+page', 'Sub-agents Earlier/Show more/About/Retry and contributor open-session controls are not rendered by this shell (no host census/runs fixture); the existing subagent-activity-qa driver covers them but was not run in this V1 baseline');
      skip('K5', 'panel+page', 'existing update notice actions need an extension-update fixture; this shell answers 404 so none render');
      skip('K9', 'panel+page', 'structural replay is covered by --only keyboard-focus-replay');
      kcheck('K8', 'all', 'no-guest-errors', pageErrors().length === 0, undefined, pageErrors());
      kcheck('K8', 'all', 'no-proxy-errors', JSON.stringify(await evaluate('qa.errors')) === '[]');
      facts.requestsMeta = { writes: (await reqs(`r.method!=='GET'`)).map((r: any) => `${r.method} ${r.path}`), interceptedSetup: (await evaluate<any[]>('qa.intercepted')).map((r) => `${r.method} ${r.path} ${r.status}`), hostMessages: Object.fromEntries(Object.entries((await evaluate<any[]>('qa.messages')).reduce((o: Record<string, number>, m: any) => { o[m.type] = (o[m.type] ?? 0) + 1; return o; }, {}))) };
    }
    if (onlyReplay) {
      const replay = fx.largePlan!;
      const plan = `[data-testid="plan-${LARGE_PLAN_ID}"]`;
      const complete = (revision: number) => `d.querySelector('${plan}[data-revision="${revision}"] .ap-tasks[data-complete]')`;
      const races2: unknown[] = []; facts.replayObservations = races2;
      Object.assign(facts, { fixture: LARGE_PLAN_VERSION, seed: LARGE_PLAN_SEED, viewport: { browser: [1280, 1100], panel: 360, page: 1100 } });
      const observe = (surface: string) => guest<any>(surface, `const e=d.activeElement,a=d.querySelector('${plan}');return {surface:'${surface}',revision:a?.dataset.revision,hasFocus:d.hasFocus(),focus:e&&e!==d.body?(e.matches('summary')?'summary:'+e.parentElement.dataset.testid:e.matches('.ap-tasks-h')?'tasks-heading':(e.dataset.testid??e.tagName.toLowerCase())):'body',connected:!!e?.isConnected,scroll:d.scrollingElement.scrollTop}`);
      /** First task row line in view and its viewport offset (the reading anchor). */
      const anchor = (surface: string) => guest<{ id: string; top: number } | null>(surface, `const rows=[...d.querySelectorAll('${plan} .ap-items li[data-testid]')];for(const li of rows){const n=li.querySelector(':scope > .ap-item, :scope > details > summary')??li;const r=n.getBoundingClientRect();if(r.height>0&&r.bottom>0&&r.top<w.innerHeight)return {id:li.dataset.testid,top:Math.round(r.top)}}return null`);
      /** Viewport offset of one row's line (the same row measured before and after). */
      const rowTop = (surface: string, id: string) => guest<number | null>(surface, `const li=d.querySelector('[data-testid="${id}"]');if(!li)return null;const n=li.querySelector(':scope > .ap-item, :scope > details > summary')??li;return Math.round(n.getBoundingClientRect().top)`);
      /** Scroll bounds after a paint: a removal in the last screenful shortens the page and the browser clamps. */
      const bounds = (surface: string) => guest<{ scroll: number; max: number; clampedAtEnd: boolean }>(surface, `const e=d.scrollingElement,max=e.scrollHeight-w.innerHeight;return {scroll:Math.round(e.scrollTop),max:Math.round(max),clampedAtEnd:e.scrollTop>=max-1}`);
      /**
       * S6 reading-anchor expectation (docs/ui.md Restoration; plan amendment M3, physical rule). Geometry
       * of the same surviving anchor row: `needed` is the scroll that would keep its viewport offset. Only
       * when `needed` exceeds the page's new maximum (whether the page shrank or grew) does the browser's
       * end-of-page clamp bound the rule: then scroll must sit at the new maximum and
       * the row exactly where that scroll puts it, and the surviving rows must not have moved relative to
       * their task list (same offset from the list top). Otherwise the original offset preservation
       * applies. Same ±2 px tolerance.
       */
      const anchorKept = (before: { id: string; top: number } | null, pre: { scroll: number; max: number }, afterTop: number | null, post: { scroll: number; max: number }, inList: { before: number | null; after: number | null }) => {
        if (!before || afterTop === null) return { pass: false, mode: 'missing', facts: { before, afterTop } };
        const docBefore = before.top + pre.scroll, docAfter = afterTop + post.scroll;
        const needed = docAfter - before.top;
        const clamp = needed > post.max + 2;
        const facts = { anchorRow: before.id, offsetBefore: before.top, offsetAfter: afterTop, preScroll: pre.scroll, preMax: pre.max, postScroll: post.scroll, postMax: post.max, neededScroll: needed, documentShift: docAfter - docBefore, offsetInListBefore: inList.before, offsetInListAfter: inList.after, pageShortenedBelowScroll: post.max < pre.scroll };
        if (!clamp) return { pass: Math.abs(afterTop - before.top) <= 2, mode: 'offset-kept', expectedOffset: before.top, facts };
        const expectedOffset = docAfter - post.max;
        const sameInList = inList.before !== null && inList.after !== null && Math.abs(inList.after - inList.before) <= 2;
        return { pass: Math.abs(post.scroll - post.max) <= 2 && Math.abs(afterTop - expectedOffset) <= 2 && sameInList, mode: 'end-of-page-clamp', expectedOffset, facts };
      };
      /** The row line's offset from its task list's top (moves only if rows above it changed). */
      const inListTop = (surface: string, id: string) => guest<number | null>(surface, `const li=d.querySelector('[data-testid="${id}"]'),ul=d.querySelector('${plan} ul.ap-items');if(!li||!ul)return null;const n=li.querySelector(':scope > .ap-item, :scope > details > summary')??li;return Math.round(n.getBoundingClientRect().top-ul.getBoundingClientRect().top)`);
      const noticeBox = (surface: string) => guest<{ h: number; text: boolean }>(surface, `const n=d.querySelector('${plan} [data-testid="focus-notice"]');return {h:n?Math.round(n.getBoundingClientRect().height):0,text:!!n?.textContent}`);
      const statusOk = (step: (typeof replay.steps)[number]) => step.items.filter((i) => step.affectedIds.includes(i.id) && i.kind === 'task').map((i) => `d.querySelector('[data-testid="item-${i.id}"]')?.dataset.status===${javascriptLiteral(i.status)}`).join('&&') || 'true';
      const settle = async (surface: string, step: (typeof replay.steps)[number]) => { await wait(surface, `${complete(step.revision)}&&(${statusOk(step)})${step.id === 'S6' ? `&&!d.querySelector('[data-testid="item-T-19-48"]')` : ''}`, `${surface} ${step.id}`); await frames2(); };
      const step = (id: string) => replay.steps.find((s) => s.id === id)!;
      await scenario('K9-replay', ['K9', 'K8', 'K10'], async () => {
        await show(['page', 'panel'], 1100); await theme('light');
        await evaluate(`document.querySelector('section[data-frame="panel"]').style.width='360px';true`);
        await wait('panel', `w.innerWidth===360`, 'panel 360');
        await wait('panel', complete(1), 'rail S0');
        // Board selection by keyboard: Tab to the plan listbox, Home, Enter.
        await tabTo('page', '[data-testid^="project-"] [role="listbox"]');
        await key('Home'); await key('Enter');
        await wait('page', complete(1), 'board S0');
        kcheck('K9', 'page', 'S0:keyboard-selected-plan', await focusedOn('page', '[data-testid^="project-"] [role="listbox"]'));
        // S1: unaffected row retained in the rail while the rail owns focus.
        await setupRowFocus('panel', 'item-T-01-00');
        replay.advance('S1'); await settle('panel', step('S1')); await settle('page', step('S1'));
        let o = await observe('panel'); races2.push({ step: 'S1', ...o });
        kcheck('K9', 'panel', 'S1:unaffected-row-retained', o.hasFocus && o.focus === 'item-T-01-00', undefined, o);
        replay.advance('S2'); await settle('panel', step('S2')); await settle('page', step('S2'));
        // S3: held continuation during a revision change (page owns focus on a task row).
        await setupRowFocus('page', 'item-T-01-00');
        await evaluate(`qa.holds.push({tag:'kf-s3',path:'/v1/plan',frame:'page',cursor:true});true`);
        replay.advance('S3');
        await wait('page', `qa.held.some(h=>h.tag==='kf-s3')`, 'S3 continuation held');
        await frames2();
        const parked = await observe('page'); races2.push({ step: 'S3-held', ...parked });
        kcheck('K8', 'page', 'S3:held-continuation-parks-or-keeps-row', parked.hasFocus && (parked.focus === 'tasks-heading' || parked.focus === 'item-T-01-00'), [`while the continuation was held focus was on ${parked.focus}`], parked);
        if (parked.focus === 'tasks-heading') await focusShot('page-focus-light-parked-tasks', 'page', 40, 60);
        await evaluate(`qa.release('kf-s3');true`);
        await settle('page', step('S3')); await settle('panel', step('S3'));
        o = await observe('page'); races2.push({ step: 'S3', ...o });
        kcheck('K8', 'page', 'S3:row-restored-after-complete', o.hasFocus && o.focus === 'item-T-01-00', undefined, o);
        // S4: move away during the loading gap; the later complete paint must not reclaim focus.
        await evaluate(`qa.holds.push({tag:'kf-s4',path:'/v1/plan',frame:'page',cursor:true});true`);
        replay.advance('S4');
        await wait('page', `qa.held.some(h=>h.tag==='kf-s4')`, 'S4 continuation held');
        await frames2();
        const gap = await observe('page');
        await key('Tab');
        const moved = await observe('page'); races2.push({ step: 'S4-moved', gap, moved });
        await evaluate(`qa.release('kf-s4');true`);
        await settle('page', step('S4')); await settle('panel', step('S4'));
        o = await observe('page'); races2.push({ step: 'S4', ...o });
        kcheck('K10', 'page', 'S4:moved-focus-not-reclaimed', o.hasFocus && o.focus === moved.focus && moved.focus !== 'item-T-01-00', [`focus during gap ${gap.focus}; Tab moved it to ${moved.focus}; it stayed after the complete paint`], { gap, moved, after: o });
        // S5: focused moved/reparented row keeps focus (page owns focus).
        await setupRowFocus('page', 'item-T-10-24');
        const s5Anchor = await anchor('page');
        replay.advance('S5'); await settle('page', step('S5')); await settle('panel', step('S5'));
        const s5Top = s5Anchor ? await rowTop('page', s5Anchor.id) : null;
        races2.push({ step: 'S5-anchor-control', anchorBefore: s5Anchor, anchorRowAfter: s5Top, notice: await noticeBox('page') });
        await kexpect('K9', 'page', 'S5:reading-anchor-kept', !!s5Anchor && s5Top !== null && Math.abs(s5Top - s5Anchor.top) <= 2, [`anchor row ${s5Anchor?.id}: ${s5Anchor?.top}px → ${s5Top}px (focused row kept; no notice)`], races2.at(-1));
        o = await observe('page'); races2.push({ step: 'S5', ...o });
        kcheck('K9', 'page', 'S5:moved-row-keeps-focus', o.hasFocus && o.focus === 'item-T-10-24' && await guest<boolean>('page', `return d.activeElement.parentElement.closest('[data-testid^="group-G-"]')?.dataset.testid==='group-G-11'`), undefined, o);
        // S6 in the rail (rail owns focus); the page's list poll is held so it observes S6 afterwards.
        await setupRowFocus('panel', 'item-T-19-48');
        const ancestorsOpen = await guest<boolean>('panel', `const a=d.activeElement;return [...d.querySelectorAll('details')].filter(x=>x.contains(a)).every(x=>x.open)`);
        await evaluate(`qa.holds.push({tag:'kf-page-list',path:'/v1/plans',frame:'page'});true`);
        await wait('page', `qa.held.some(h=>h.tag==='kf-page-list')`, 'page list poll held (pre-S6 snapshot)');
        const railAnchor = await anchor('panel');
        const railNotice0 = await noticeBox('panel');
        const railPre = await bounds('panel');
        const railInList0 = railAnchor ? await inListTop('panel', railAnchor.id) : null;
        replay.advance('S6'); await settle('panel', step('S6'));
        const railAnchorTop = railAnchor ? await rowTop('panel', railAnchor.id) : null;
        const railPost = await bounds('panel'), railNotice1 = await noticeBox('panel');
        const railKept = anchorKept(railAnchor, railPre, railAnchorTop, railPost, { before: railInList0, after: railAnchor ? await inListTop('panel', railAnchor.id) : null });
        o = await observe('panel'); races2.push({ step: 'S6-panel', ...o, ancestorsOpen, anchorBefore: railAnchor, anchorRowAfter: railAnchorTop, firstRowAfter: await anchor('panel'), noticeBefore: railNotice0, noticeAfter: railNotice1, boundsBefore: railPre, bounds: railPost, anchorExpectation: railKept });
        kcheck('K9', 'panel', 'S6:removed-focus-uses-ancestor-fallback', o.hasFocus && o.connected && o.focus === 'summary:group-toggle-G-19', ['Nearest shown ancestor summary (E2 order), never body or a detached row'], o);
        await kexpect('K9', 'panel', 'S6:reading-anchor-kept', railKept.pass, [`${railKept.mode}: anchor row ${railAnchor?.id} ${railAnchor?.top}px → ${railAnchorTop}px, expected ${railKept.expectedOffset}px (±2 px); scroll ${railPost.scroll}/${railPost.max} after ${railPre.scroll}/${railPre.max}`], races2.at(-1));
        await shot('rail-removal', `${plan} [data-testid="group-toggle-G-19"]`, 40, 600, 'panel');
        kcheck('K9', 'page', 'S6:page-still-before-removal', await guest<boolean>('page', `return !!d.querySelector('[data-testid="item-T-19-48"]')`));
        await setupRowFocus('page', 'item-T-19-48');
        const pageAnchor = await anchor('page');
        const pageNotice0 = await noticeBox('page');
        const pagePre = await bounds('page');
        const pageInList0 = pageAnchor ? await inListTop('page', pageAnchor.id) : null;
        await evaluate(`qa.release('kf-page-list');true`);
        await settle('page', step('S6'));
        const pageAnchorTop = pageAnchor ? await rowTop('page', pageAnchor.id) : null;
        const pagePost = await bounds('page'), pageNotice1 = await noticeBox('page');
        const pageKept = anchorKept(pageAnchor, pagePre, pageAnchorTop, pagePost, { before: pageInList0, after: pageAnchor ? await inListTop('page', pageAnchor.id) : null });
        o = await observe('page'); races2.push({ step: 'S6-page', ...o, anchorBefore: pageAnchor, anchorRowAfter: pageAnchorTop, firstRowAfter: await anchor('page'), noticeBefore: pageNotice0, noticeAfter: pageNotice1, boundsBefore: pagePre, bounds: pagePost, anchorExpectation: pageKept });
        kcheck('K9', 'page', 'S6:removed-focus-uses-ancestor-fallback', o.hasFocus && o.connected && o.focus === 'summary:group-toggle-G-19', undefined, o);
        await kexpect('K9', 'page', 'S6:reading-anchor-kept', pageKept.pass, [`${pageKept.mode}: anchor row ${pageAnchor?.id} ${pageAnchor?.top}px → ${pageAnchorTop}px, expected ${pageKept.expectedOffset}px (±2 px); scroll ${pagePost.scroll}/${pagePost.max} after ${pagePre.scroll}/${pagePre.max}`], races2.at(-1));
        kcheck('K9', 'page', 'S6:fallback-notice', /no longer shown/.test(await guest<string>('page', `return d.querySelector('${plan} [data-testid="focus-notice"]')?.textContent??''`)));
        await shot('page-removal', `${plan} [data-testid="group-toggle-G-19"]`, 40, 600, 'page');
        await focusShot('page-focus-light-removal-fallback', 'page', 60, 120);
        // S7/S8: reinsertion never replays the old focus or jumps from the fallback.
        for (const id of ['S7', 'S8']) {
          replay.advance(id as 'S7' | 'S8');
          await settle('page', step(id)); await settle('panel', step(id));
          const p = await observe('page'), r = await observe('panel'); races2.push({ step: id, page: p, panel: r });
          kcheck('K9', 'page', `${id}:no-replay-to-reinserted-row`, p.hasFocus && p.focus === 'summary:group-toggle-G-19', undefined, p);
          kcheck('K9', 'panel', `${id}:remembered-focus-not-reinserted-row`, r.focus !== 'item-T-19-48', undefined, r);
        }
        // Two completed unchanged polls with the fallback focus retained.
        const mark = await repliesMark();
        await wait('page', `['panel','page'].every(f=>qa.replies.slice(${mark}).filter(r=>r.frame===f&&r.path==='/v1/plans'&&r.status===200).length>=2)`, 'two completed polls on both surfaces');
        o = await observe('page');
        kcheck('K8', 'page', 'S8:unchanged-polls-keep-focus', o.hasFocus && o.focus === 'summary:group-toggle-G-19', undefined, o);
        // External focus: shell sentinel by real Shift+Tab out of the page's first stop.
        await clickTop('#qa-after');
        setups.push('K9-replay: pointer click on the end sentinel (external focus)');
        const m2 = await repliesMark();
        await wait('page', `['panel','page'].every(f=>qa.replies.slice(${m2}).filter(r=>r.frame===f&&r.path==='/v1/plans'&&r.status===200).length>=1)`, 'poll while external');
        const ext = await focusState();
        kcheck('K10', 'all', 'S8:external-focus-not-stolen-by-polls', ext.top === 'qa-after' && !ext.guests.page.hasFocus && !ext.guests.panel.hasFocus, undefined, ext);
      });
      kcheck('K8', 'all', 'replay:no-guest-errors', pageErrors().length === 0, undefined, pageErrors());
      kcheck('K8', 'all', 'replay:no-proxy-errors', JSON.stringify(await evaluate('qa.errors')) === '[]');
      skip('K10', 'status', 'Work Status has no task-row removal requirement (K9 note); its selected-plan removal is covered in the keyboard-focus mode');
    }
    for (const row of Object.values(coverage)) if (row.status !== 'fail') row.status = row.checks.some((x) => !x.startsWith('skipped')) ? 'pass' : 'skipped';
    if (failures.length) failure = `${failures.length} scenario(s) failed: ${failures.map((f) => f.scenario).join(', ')}`;
    replies = await evaluate<any[]>('qa.replies');
  }

  if (onlyLarge) {
    const replay = fx.largePlan!;
    const plan = `[data-testid="plan-${LARGE_PLAN_ID}"]`;
    const complete = (revision: number) => `d.querySelector('${plan}[data-revision="${revision}"] .ap-tasks[data-complete]')&&d.querySelector('${plan} [data-testid="readiness"][data-state="ready"]')`;
    const node = (id: string) => `[data-testid="${id}"]`;
    Object.assign(facts, { fixture: LARGE_PLAN_VERSION, seed: LARGE_PLAN_SEED, runtime: process.version, serviceMode: built ? 'built generated service' : 'current TypeScript service', commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), bundles: Object.fromEntries(['build/service/main.js', ...['page', 'panel', 'status'].map(f => `ui/${f}/main.js`)].map(p => [p, createHash('sha256').update(readFileSync(p)).digest('hex')])), viewport: { browser: [1280, 1100], panel: 360, page: 1100, darkPage: 360 }, checkpoint: 'S0', sampleCount: 3, warmups: 1 });
    const loadMetrics: Record<string, unknown> = {}, actionMetrics: Record<string, unknown> = {}, dom: Record<string, unknown> = {};
    Object.assign(perf, { checkpoint: 'S0', loads: loadMetrics, actions: actionMetrics, dom, interpretation: 'Synthetic host with real service; local smoke budgets, not an SLA. HTTP, core CPU, root-render CPU and report-to-visible are separate.' });
    const budget = (id: string, measurements: ReturnType<typeof stats>, limit: number) => {
      gates.push({ id, pass: measurements.median <= limit, observed: measurements, limit: `median ≤${limit} ms` });
    };
    async function ready(surface: string, revision: number) {
      await wait(surface, complete(revision), 'complete tasks and ready readiness'); await frames2();
    }
    async function openBoard() {
      await wait('page', `d.querySelector('[data-testid="plan-row-${LARGE_PLAN_ID}"]')`, 'large plan board row');
      await click('page', `[data-testid="plan-row-${LARGE_PLAN_ID}"]`);
    }
    async function reloadGuest(surface: string) {
      const sequence = await evaluate<number>(`qa.reload('${surface}')`);
      await wait(surface, `qa.loaded['${surface}']===${sequence}`, 'new guest document loaded');
    }
    for (const [surface, width] of [['panel', 360], ['page', 1100]] as const) {
      await show([surface], width);
      await theme('light');
      if (surface === 'page') await openBoard();
      await ready(surface, 1);
      const loads: number[] = [], streams: unknown[] = [];
      for (let sample = 0; sample < 4; sample++) {
        const mark = await now(), replyMark = await evaluate<number>('qa.replies.length');
        await reloadGuest(surface);
        if (surface === 'page') await openBoard();
        await ready(surface, 1);
        const elapsed = await now() - mark;
        await instrument(surface);
        const reads = (await evaluate<any[]>(`qa.replies.slice(${replyMark})`)).filter(r => r.frame === surface && r.path === '/v1/plan');
        check(`large:${surface}:load-${sample}:complete-50-pages`, reads.length === 50 && reads.every(r => r.status === 200 && r.revision === 1), undefined, { count: reads.length });
        if (sample) { loads.push(elapsed); streams.push({ requests: reads.length, bytes: reads.reduce((n, r) => n + r.bytes, 0), httpMs: reads.reduce((n, r) => n + r.ms, 0) }); }
      }
      const load = stats(loads); loadMetrics[surface] = { ...load, streams }; budget(`${surface}:complete-ready-load`, load, 2000);
      const counts = await guest<any>(surface, `const a=d.querySelector('${plan}');return {tasks:a.querySelectorAll('.ap-items [data-testid^="item-T-"]').length,groups:a.querySelectorAll('.ap-items [data-testid^="group-G-"]').length,counts:{...a.querySelector('[data-testid="counts"]').dataset},nodes:a.querySelectorAll('*').length}`);
      dom[surface] = counts;
      check(`large:${surface}:complete-counts`, counts.tasks === 980 && counts.groups === 20 && counts.counts.done === '147' && counts.counts.total === '931' && counts.counts.remaining === '784' && counts.counts.skipped === '49', undefined, counts);
      const metrics: Record<string, unknown> = {}; actionMetrics[surface] = metrics;
      async function action(label: string, setup: () => Promise<unknown>, run: () => Promise<unknown>, condition: string) {
        const values: number[] = [], renders: unknown[] = [];
        for (let sample = 0; sample < 4; sample++) {
          await setup(); await frames2(); await paints(surface);
          const start = await now(); await run(); await wait(surface, condition, label); await frames2();
          const elapsed = await now() - start;
          const cpu = await paints(surface);
          if (sample) { values.push(elapsed); renders.push(cpu); }
        }
        const measured = stats(values); metrics[label] = { ...measured, rootRenderCpuMs: renders }; budget(`${surface}:${label}`, measured, 500);
      }
      const mode = (value: string) => click(surface, `${node(`focus-mode-${value}`)} button`);
      const modeIs = (value: string) => `d.querySelector('${node(`focus-mode-${value}`)} button')?.getAttribute('aria-pressed')==='true'`;
      await action('unfinished', () => mode('all'), () => mode('unfinished'), modeIs('unfinished'));
      check(`large:${surface}:filter-hides-completed`, await guest<boolean>(surface, `return d.querySelector('${node('item-T-00-01')}').hidden&&!d.querySelector('${node('item-T-01-00')}').hidden`));
      await action('show-all', () => mode('unfinished'), () => mode('all'), modeIs('all'));
      const disclosure = node('group-toggle-G-15');
      await action('disclosure', async () => { if (!(await guest<boolean>(surface, `return d.querySelector('${disclosure}').open`))) await click(surface, `${disclosure}>summary`); }, () => click(surface, `${disclosure}>summary`), `!d.querySelector('${disclosure}').open`);
      await click(surface, `${disclosure}>summary`);
      await action('jump-working', async () => { await click(surface, `${node('focus-mode-all')} button`); }, () => click(surface, `${node('focus-jump-working')} button`), `d.activeElement?.dataset.testid?.startsWith('item-')&&d.activeElement.dataset.status==='working'`);
      await action('show-task', async () => { await click(surface, `${node('focus-jump-working')} button`); }, () => click(surface, `${node('readiness-entry-T-01-00')} .ap-ready-head button`), `d.activeElement?.dataset.testid==='item-T-01-00'&&!d.activeElement.hidden`);
      check(`large:${surface}:canonical-only`, await guest<boolean>(surface, `return d.querySelectorAll('${node('item-T-01-00')}').length===1&&d.querySelectorAll('${node('readiness-entry-T-01-00')}').length===1`));
      // Real keyboard activation, independent of the pointer action timings.
      await mode('all'); await wait(surface, modeIs('all'), 'Show all selected before keyboard activation');
      await key('Tab');
      check(`large:${surface}:keyboard-unfinished-start`, await guest<boolean>(surface, `return d.activeElement===d.querySelector('${node('focus-mode-unfinished')} button')&&(${modeIs('all')})&&d.querySelector('${node('focus-mode-unfinished')} button').getAttribute('aria-pressed')==='false'&&[...d.querySelectorAll('${plan} .ap-items [data-testid^="item-T-"]')].every(n=>!n.hidden)`), ['Unfinished focused without activation; Show all remains selected and all tasks are unfiltered']);
      await key(' ');
      const unfinishedRows = `(()=>{const rows=[...d.querySelectorAll('${plan} .ap-items [data-testid^="item-T-"]')];return rows.length===980&&rows.filter(n=>!n.hidden).length===784&&rows.every(n=>n.hidden===(n.dataset.status==='done'||n.dataset.status==='skipped'))})()`;
      await wait(surface, `(${modeIs('unfinished')})&&${unfinishedRows}`, 'Space selects Unfinished and filters the task list');
      check(`large:${surface}:keyboard-unfinished-filter`, await guest<boolean>(surface, `return (${modeIs('unfinished')})&&${unfinishedRows}`), ['Space changed Show all to Unfinished; 784 unfinished tasks shown and all 196 done/skipped tasks hidden']);
      await mode('all'); await ready(surface, 1);
      await shot(surface === 'panel' ? 'rail-ready' : 'page-ready', plan, 0, 1500, surface);
    }
    const graphSamples = [];
    for (let sample = 0; sample < 4; sample++) { const probe = await fx.probeLargePlan(); if (sample) graphSamples.push(probe); }
    perf.graphCore = { checkpoint: 'S0', traffic: 'harness-probe (never guest graph wiring)', samples: graphSamples, graphMs: stats(graphSamples.map(s => s.graphMs)), coreMs: stats(graphSamples.map(s => s.coreMs)) };
    check('large:graph-probes-complete', graphSamples.every(s => s.items === 1000 && s.tasks === 980 && s.requests === 1 && s.bytes <= 1048576));

    await show(['page', 'panel'], 1100);
    await evaluate(`document.querySelector('section[data-frame="panel"]').style.width='360px';true`);
    for (const surface of ['panel', 'page']) {
      await ready(surface, 1); await instrument(surface);
      await click(surface, `${node('group-toggle-G-15')}>summary`);
      await click(surface, `${node('readiness-entry-T-01-00')} .ap-ready-head button`);
      await wait(surface, `d.activeElement?.dataset.testid==='item-T-01-00'&&!d.querySelector('${node('group-toggle-G-15')}').open`, 'settled reading state before replay');
    }
    facts.readingBeforeReplay = await Promise.all(['panel', 'page'].map(surface => guest(surface, `return {surface:'${surface}',focus:d.activeElement?.dataset.testid,hasFocus:d.hasFocus(),collapsed:!d.querySelector('${node('group-toggle-G-15')}').open}`)));
    // Only one iframe can own focus. The final real click leaves the page focused;
    // both surfaces retain disclosure state, but an unfocused rail has no focus to restore.
    check('large:focused-page-before-replay', await guest<boolean>('page', `return d.hasFocus()&&d.activeElement?.dataset.testid==='item-T-01-00'`));
    const updates: unknown[] = []; perf.replay = updates;
    for (const step of replay.steps.slice(1)) {
      for (const surface of ['panel', 'page']) await paints(surface);
      const start = performance.now(); replay.advance(step.id); const committedAt = performance.now();
      const observations = await Promise.all(['panel', 'page'].map(async surface => {
        await ready(surface, step.revision);
        // Validate every changed status anchor, complete counts, and the structural witness.
        const statusChecks = step.items.filter(i => step.affectedIds.includes(i.id) && i.kind === 'task').map(i => `d.querySelector('${node(`item-${i.id}`)}')?.dataset.status===${javascriptLiteral(i.status)}`).join('&&') || 'true';
        await wait(surface, `${complete(step.revision)}&&(${statusChecks})${step.id === 'S6' ? `&&!d.querySelector('${node('item-T-19-48')}')` : ''}`, `${step.id} state observed`);
        const visibleMs = performance.now() - committedAt;
        const observed = await guest<any>(surface, `const a=d.querySelector('${plan}');return {tasks:a.querySelectorAll('.ap-items [data-testid^="item-T-"]').length,counts:{...a.querySelector('[data-testid="counts"]').dataset},collapsed:!a.querySelector('${node('group-toggle-G-15')}').open,focus:d.activeElement?.dataset.testid,ready:d.querySelector('${node('readiness-entry-T-01-00')}')?.dataset.group,movedParent:d.querySelector('${node('item-T-10-24')}')?.parentElement.closest('[data-testid^="group-G-"]')?.dataset.testid,movedTitle:d.querySelector('${node('item-T-10-24')} .ap-item-title')?.textContent}`);
        check(`large:${step.id}:${surface}:counts`, observed.tasks === step.itemCount - 20 && Object.entries(step.counts).every(([k,v]) => observed.counts[k] === String(v)));
        if (step.id === 'S1') check(`large:${surface}:status-reading-retained`, observed.collapsed && (surface !== 'page' || observed.focus === 'item-T-01-00'), undefined, observed);
        if (step.id === 'S2') check(`large:${surface}:readiness-unlocked`, observed.ready === 'ready');
        if (step.id === 'S5') check(`large:${surface}:reshape`, observed.movedParent === 'group-G-11' && observed.movedTitle === 'Synthetic task moved', undefined, observed);
        const rootRenderCpuMs = await paints(surface);
        gates.push({ id: `${step.id}:${surface}:update-visible`, pass: visibleMs <= 8000, observed: visibleMs, limit: '≤8000 ms per observation' });
        return { surface, visibleMs, rootRenderCpuMs, tasks: observed.tasks, collapsed: observed.collapsed, focusedTask: observed.focus ?? null };
      }));
      updates.push({ id: step.id, revision: step.revision, mode: 'concurrent two-surface refresh including ordinary poll', reportMs: committedAt - start, observations });
    }
    await shot('page-after-structural', plan, 0);
    // Two actual completed ordinary polls, not a fixed sleep or an assumed poll period.
    const idleMark = await evaluate<number>('qa.replies.length');
    for (const surface of ['panel', 'page']) await paints(surface);
    await wait('page', `['panel','page'].every(f=>qa.replies.slice(${idleMark}).filter(r=>r.frame===f&&r.path==='/v1/plans'&&r.status===200).length>=2)`, 'two completed ordinary polls');
    const idleReplies = await evaluate<any[]>(`qa.replies.slice(${idleMark})`);
    const idlePaints = await Promise.all(['panel', 'page'].map(f => paints(f)));
    check('large:unchanged-polls-no-detail-or-repaint', !idleReplies.some(r => r.path === '/v1/plan') && idlePaints.every(p => p.length === 0), undefined, { detail: idleReplies.filter(r => r.path === '/v1/plan').length, paints: idlePaints });
    perf.idle = { completedPollsPerSurface: 2, detailRequests: idleReplies.filter(r => r.path === '/v1/plan').length, dataRepaints: idlePaints.map(p => p.length) };

    await evaluate(`qa.holds.push({tag:'large-hidden',path:'/v1/plan',frame:'page',cursor:true});true`);
    await reloadGuest('page');
    await openBoard();
    await wait('page', `qa.held.some(h=>h.tag==='large-hidden')`, 'held detail continuation');
    await evaluate(`qa.visibility('page',false);true`); await frames2();
    await instrument('page'); await paints('page');
    const hiddenMark = await evaluate<number>('qa.requests.length'), hiddenPollMark = await evaluate<number>('qa.replies.length');
    await evaluate(`qa.release('large-hidden');true`);
    await wait('panel', `qa.replies.slice(${hiddenPollMark}).filter(r=>r.frame==='panel'&&r.path==='/v1/plans'&&r.status===200).length>=2`, 'two visible-peer polls while detail hidden');
    const hiddenRequests = await evaluate<any[]>(`qa.requests.slice(${hiddenMark}).filter(r=>r.frame==='page')`), hiddenPaints = await paints('page');
    check('large:hidden-retired-continuation', hiddenRequests.length === 0 && hiddenPaints.length === 0, undefined, { requests: hiddenRequests.length, paints: hiddenPaints.length });
    perf.hidden = { requests: hiddenRequests.length, dataRepaints: hiddenPaints.length, observation: 'two completed visible-peer ordinary polls' };
    await evaluate(`qa.visibility('page',true);true`); await ready('page', 9);
    await show(['page'], 360); await theme('dark'); await ready('page', 9);
    check('large:dark-narrow-no-overflow', await overflow());
    await click('page', `${node('focus-mode-unfinished')} button`); await wait('page', `d.querySelector('${node('focus-mode-unfinished')} button')?.getAttribute('aria-pressed')==='true'`, 'narrow operable control');
    await shot('page-dark-narrow', `${plan} .ap-tasks`, 0, 1500);
    await show(['status'], 360);
    await wait('status', Object.entries(replay.steps.at(-1)!.counts).map(([key, value]) => `d.querySelector('[data-testid="counts"]')?.dataset.${key}==='${value}'`).join('&&'), 'Work Status authoritative counts');
    check('large:work-status-count-smoke', await guest<boolean>('status', `return !!d.querySelector('[data-testid="counts"]')&&!d.querySelector('[data-testid="detail-loading"]')`));
    replies = [...await evaluate<any[]>('qa.replies'), ...fx.graphProbes];
    check('large:no-guest-graph-wiring', !replies.some(r => r.path === '/v1/plan-graph' && r.traffic === 'guest'));
    check('large:no-proxy-errors', JSON.stringify(await evaluate('qa.errors')) === '[]');
    check('large:no-guest-errors', pageErrors().length === 0);
    for (const g of gates) check(`large:budget:${g.id}`, g.pass, [g.limit], g.observed);
    throw new OnlyDone();
  }

  await show(['page', 'panel', 'status'], 1100);
  await wait('page', `d.querySelector('[data-testid="search-form"]')&&d.querySelector('[data-testid="plan-list"]')`, 'board with search form');
  await wait('panel', `d.querySelector('[data-testid="progress-root"]')`, 'rail');
  await show(['page'], 1100);
  await theme('light');
  await instrument();
  const storageMark = await now();

  // Capture metadata uses the existing freshness poll, including when a preview stays open.
  if (!onlyJ1) {
    await searchFor('Ship export bundle', true);
    await click('page', H('P-0005-ship'));
    await wait('page', `d.querySelector('[data-testid="summary-handoff"]')`, 'capture fixture detail');
    for (const mode of ['handoff', 'progress']) {
      await click('page', `[data-testid="summary-${mode}"]`);
      await wait('page', `d.querySelector('[data-testid="summary-text"]')`, `${mode} preview`);
      for (const enabled of [false, true]) {
        const mark = await now(), details = await count('/v1/plan');
        await evaluate(`qa.holds.push({tag:'capture-detail',path:'/v1/plan',frame:'page'});true`);
        fx.setCapture(enabled);
        await wait('page', `qa.held.some(h=>h.tag==='capture-detail')`, 'post-toggle detail held');
        check(`capture:${mode}:${enabled}:preview-waits`, await guest<boolean>('page', `return !d.querySelector('[data-testid="summary-text"]')&&d.querySelector('[data-testid="summary-copy"]')?.disabled===true`), ['Completed old summary is withheld and Copy is disabled until fresh detail arrives']);
        await evaluate(`qa.release('capture-detail')`);
        await wait('page', `!!d.querySelector('[data-testid="summary-text"]')&&d.querySelector('[data-testid="summary-text"]').value.includes('Progress capture is disabled.')===${!enabled}`, `${mode} capture ${enabled}`);
        check(`capture:${mode}:${enabled}:warning`, await guest<boolean>('page', `return d.body.textContent.includes('Capture is turned off; no new reports are recorded.')===${!enabled}`));
        const requests = await reqs(`r.frame==='page'&&r.at>=${mark}`);
        check(`capture:${mode}:${enabled}:bounded-reads`, await count('/v1/plan') === details + 1 && requests.some(r => r.path === '/v1/search-state') && requests.every(r => ['/v1/search-state', '/v1/plan'].includes(r.path)), ['Existing freshness poll and one detail refresh; no list read'], requests.map(r => r.path));
        if (!enabled && mode === 'handoff') await shot('capture-off-handoff', '[data-testid="progress-root"]');
        if (enabled && mode === 'progress') await shot('capture-on-progress', '[data-testid="summary-preview"]');
      }
    }
    await paints();
    const mark = await now();
    await sleep(6600);
    const unchanged = await reqs(`r.frame==='page'&&r.at>=${mark}`);
    check('capture:unchanged-polls', unchanged.length >= 2 && unchanged.every(r => r.path === '/v1/search-state') && (await paints()).length === 0, ['No list/detail requests or repaint on unchanged polls']);
    // Hold the off reply after the service captured it, then hide and re-enable capture.
    await evaluate(`qa.holds.push({tag:'capture-held',path:'/v1/search-state',frame:'page'});true`);
    fx.setCapture(false);
    await wait('page', `qa.held.some(h=>h.tag==='capture-held')`, 'held capture reply');
    await setHidden(true); fx.setCapture(true);
    await evaluate(`qa.release('capture-held')`); await sleep(300);
    race('capture:hidden-reply-ignored', await guest<boolean>('page', `return !d.body.textContent.includes('Capture is turned off; no new reports are recorded.')&&!d.querySelector('[data-testid="summary-text"]').value.includes('Progress capture is disabled.')`));
    await setHidden(false); await sleep(300);
    check('capture:no-browser-errors', pageErrors().length === 0 && JSON.stringify(await evaluate('qa.errors')) === '[]');
    replies = await evaluate<any[]>(`qa.replies`);
    if (onlyCapture) throw new OnlyDone();
    await evaluate(`qa.reload('page');true`);
    await wait('page', `d.querySelector('[data-testid="search-form"]')&&d.querySelector('[data-testid="plan-list"]')`, 'fresh board');
    await instrument();
  }

  // ======================================================= J1 review: detail reads of search-opened plans
  {
    const planReads = (plan: string) => reqs(`r.frame==='page'&&r.path==='/v1/plan'&&r.query?.plan==='${plan}'`);
    // B1: in one search run, a held multi-page detail read of a plan outside the loaded list, then
    // another result: the new selection must load without waiting behind the old read, and the
    // released old read must send no continuation pages.
    check('J1:big-plan-outside-list', !(await guest<boolean>('page', `return !!d.querySelector('[data-testid="plan-row-P-0900-big"]')`)));
    await guest('page', `d.getElementById('ap-search-q').focus();return true`);
    await searchFor('j1', true);
    const runId = await run();
    await evaluate(`qa.holds.push({tag:'b1',path:'/v1/plan',plan:'P-0900-big',cursor:false});true`);
    await click('page', H('P-0900-big'));
    await sleep(300);
    race('J1-B1:first-detail-page-held', (await planReads('P-0900-big')).length === 1);
    const t0 = await now();
    await click('page', H('P-0901-recent'));
    const loaded = await evaluate<boolean>(`(async()=>{const end=performance.now()+6000;while(performance.now()<end){if(frame('page').contentDocument.querySelector('article[data-testid="plan-P-0901-recent"] .ap-tasks[data-complete]'))return true;await new Promise(r=>setTimeout(r,40))}return false})()`);
    race('J1-B1:next-selection-not-blocked-by-held-read', loaded && await run() === runId, [`the next result’s detail completed while the old read was still held (${Math.round(await now() - t0)} ms)`]);
    await evaluate(`qa.release('b1')`); await sleep(1500);
    const big = await planReads('P-0900-big');
    race('J1-B1:retired-detail-read-sends-no-continuation', big.length === 1 && !big.some((r: any) => r.query?.cursor), ['The superseded read stops at its released first page: zero continuation pages'], big.map((r: any) => r.query?.cursor ?? 'first'));
    race('J1-B1:superseded-read-does-not-paint', await guest<boolean>('page', `return !!d.querySelector('article[data-testid="plan-P-0901-recent"]')&&!d.querySelector('article[data-testid="plan-P-0900-big"]')`));
    // B4: opening results one after another keeps only the selection and a small recent set.
    for (let n = 2; n <= 6; n++) {
      await click('page', H(`P-090${n}-recent`));
      await wait('page', `d.querySelector('article[data-testid="plan-P-090${n}-recent"] .ap-tasks[data-complete]')`, `R${n} detail`);
    }
    const recentBefore = (await planReads('P-0905-recent')).length;
    await click('page', H('P-0905-recent'));
    await wait('page', `d.querySelector('article[data-testid="plan-P-0905-recent"] .ap-tasks[data-complete]')`, 'R5 again');
    await sleep(300);
    race('J1-B4:recent-selection-reused', (await planReads('P-0905-recent')).length === recentBefore, ['A recently opened result is reused without a new read']);
    const oldBefore = (await planReads('P-0901-recent')).length;
    await click('page', H('P-0901-recent'));
    await wait('page', `d.querySelector('article[data-testid="plan-P-0901-recent"] .ap-tasks[data-complete]')`, 'R1 again');
    race('J1-B4:old-selection-evicted', (await planReads('P-0901-recent')).length === oldBefore + 1, ['An older opened result was evicted: revisiting reads it again (bounded retention)'], { before: oldBefore, after: (await planReads('P-0901-recent')).length });
    await click('page', '[data-testid="search-clear"] button');
    await wait('page', `!d.querySelector('[data-testid="search-results"]')`, 'cleared');
    if (onlyJ1) throw new OnlyDone();
  }

  // ======================================================= 1. Keyboard entry, mixed hits, canonical reveal
  // Labelled setup: a neutral entry at the top of the frame. Blurring alone keeps Chromium's sequential
  // focus starting point where focus last was (Clear all now hands focus to the list heading).
  await guest('page', `const top=d.querySelector('h1');top.tabIndex=-1;top.focus();top.blur();top.removeAttribute('tabindex');w.focus();return true`);
  let tabs = 0;
  for (; tabs < 12 && !(await guest<boolean>('page', `return d.activeElement?.id==='ap-search-q'`)); tabs++) await key('Tab');
  check('A11:tab-reaches-labelled-search', tabs < 12 && await guest<string>('page', `return d.querySelector('label[for="ap-search-q"]')?.textContent??''`) === 'Search titles and IDs', [`Tab reached the labelled field in ${tabs} presses`]);
  const typed = await count('/v1/search');
  await type('export csv'); await frames2();
  check('A10:typing-sends-nothing', await count('/v1/search') === typed, ['Typing changes only the draft; no request before Enter']);
  await act('search “export csv” (Enter)', async () => { await key('Enter'); await wait('page', `d.querySelector('[data-testid="search-results"]')`, 'results'); });
  check('A1:pause-is-not-empty', await guest<boolean>('page', `return !!d.querySelector('[data-testid="search-none-yet"]')&&!d.querySelector('[data-testid="search-empty"]')&&d.querySelector('[data-testid="search-more"]')?.dataset.action==='continue'`), ['F1 plans sort after the 1,200-plan library: the first action pauses honestly']);
  facts.f1ContinueActions = await exhaust();
  let n = await counts();
  check('A3:mixed-results-and-counts', n?.matchedPlans === '3' && n?.matchingTasks === '3' && n?.shown === '4' && n?.final === 'true', ['3 plans, 3 matching tasks, 4 shown hits (one plan-only), final as searched'], n);
  check('A4:no-duplicate-canonical-ids', await guest<boolean>('page', `return !d.querySelector('[data-testid="search-results"] [data-testid^="item-"]')`));
  check('A4:breadcrumb', await guest<string>('page', `return d.querySelector('${T('P-export', 'T-csv')} [data-testid="search-context"]')?.textContent??''`) === 'In: Context only › Export CSV group');
  check('A7:full-plan-totals', /1\/4 done \(whole plan\)/.test(await guest<string>('page', `return d.querySelector('${H('P-export')} .ap-hit-meta').textContent`)));
  const detailMark = await count('/v1/plan');
  await click('page', T('P-export', 'T-csv'));
  await wait('page', `d.querySelector('article[data-testid="plan-P-export"][data-source="source-alpha"] .ap-tasks[data-complete]')&&d.activeElement?.dataset.testid==='item-T-csv'`, 'canonical task focused');
  const reveal = await guest<{ open: boolean; notice: string }>('page', `const a=d.querySelector('article[data-testid="plan-P-export"][data-source="source-alpha"]');return {open:[...a.querySelectorAll('details')].filter(x=>x.contains(d.activeElement)).every(x=>x.open),notice:a.querySelector('[data-testid="focus-notice"]')?.textContent??''}`);
  check('A4:canonical-reveal-once', reveal.open && /Search result: Export CSV/.test(reveal.notice), undefined, reveal);
  const detailReads = (await reqs(`r.frame==='page'&&r.path==='/v1/plan'`)).slice(detailMark);
  check('A10:no-detail-fan-out', detailReads.length >= 1 && detailReads.every((r: any) => r.query.plan === 'P-export'), ['Only the opened hit’s plan is read in detail'], detailReads.map((r: any) => r.query.plan));
  check('A4:read-only', (await reqs(`r.method!=='GET'`)).length === 0 && (await evaluate<number>(`qa.messages.filter(m=>/open-session|openSession/.test(m.type)).length`)) === 0);
  await shot('search-mixed-light');

  // ======================================================= 2. Progressive past plans 500/1,000 in a project; no-match
  await theme('dark');
  await searchFor('Needle');
  await choose('[data-testid="filter-project"]', 'Alpha'); await idle();
  const firstStop = await stop();
  check('A1:first-action-pauses', firstStop === 'paused' && (await counts())?.final === 'false', ['A work pause is not completion'], firstStop);
  const coverageText = () => guest<string>('page', `return d.querySelector('[data-testid="search-coverage"]').textContent`);
  const partial = await coverageText();
  check('A7:partial-narrowed-not-searched-all', !/Searched all/.test(partial) && /membership is limited to locations this window knows/.test(partial), ['A paused narrowed search never says it searched all recorded plans'], partial);
  await exhaust();
  check('A7:exhausted-narrowed-searched-all', /Searched all recorded plans; project membership is limited/.test(await coverageText()));
  n = await counts();
  check('A1:matches-past-500-in-project', JSON.stringify(await planHits()) === '["P-0501","P-1001"]' && n?.matchedPlans === '2' && n?.final === 'true', ['P-0051 (other project) never took a slot or a count'], { hits: await planHits(), n });
  await shot('search-progressive-dark');
  await searchFor('zz-no-such-words');
  for (let i = 0; i < 6 && await hasMore(); i++) {
    check('A1:no-false-empty-while-unchecked', await guest<boolean>('page', `return !d.querySelector('[data-testid="search-empty"]')&&!!d.querySelector('[data-testid="search-none-yet"]')`));
    await more();
  }
  check('A7:exhausted-empty-keeps-controls', await guest<boolean>('page', `return !!d.querySelector('[data-testid="search-empty"]')&&!!d.querySelector('[data-testid="search-clear"]')&&!!d.querySelector('[data-testid="filter-project"]')&&!!d.querySelector('[data-testid="search-scope"]')`));
  await shot('search-no-results');

  // ======================================================= 3. Chips, Clear all, unavailable scope, failure
  await theme('light');
  await choose('[data-testid="search-task-status"]', 'Blocked');
  await searchFor('export csv', true);
  n = await counts();
  check('Q3:status-selects-matching-tasks', n?.matchingTasks === '1' && n?.matchedPlans === '1', undefined, n);
  await guest('page', `d.querySelector('[data-testid="search-chip-status"] button').focus();return true`);
  await act('remove status chip (Enter)', () => key('Enter'));
  await exhaust();
  check('A6:remove-chip-widens-explicitly', (await counts())?.matchingTasks === '3' && !(await guest<boolean>('page', `return !!d.querySelector('[data-testid="search-chip-status"]')`)));
  await guest('page', `d.querySelector('[data-testid="search-clear"] button').focus();return true`);
  await key('Enter');
  await wait('page', `!d.querySelector('[data-testid="search-results"]')&&d.querySelector('[data-testid="plan-list"]')`, 'browsing again');
  check('A6:clear-all-returns-to-browsing', await guest<boolean>('page', `return d.querySelector('[data-testid="cleanup-visible"] button').getAttribute('aria-pressed')==='true'&&d.getElementById('ap-search-q').value===''&&!d.querySelector('[data-testid="search-chips"]')`));
  await searchFor('export csv');
  await choose('[data-testid="filter-project"]', 'Alpha'); await idle();
  // Membership: a routine unrelated session in Alpha keeps the search; the owner of seen plans moving retires it.
  const runBefore = await run();
  const subscribed = await evaluate<boolean>(`qa.subs.some(s=>s.frame==='page'&&s.kind==='sessions'&&s.projectId==='alpha')`);
  await evaluate(`qa.setSessions('alpha',[{id:'unrelated-session',title:'Synthetic session',projectId:'alpha',directory:'/fixture/main',parentId:null,createdAt:0,updatedAt:0,archivedAt:null,worktree:null,activity:'idle',outcome:null,items:[]}]);true`);
  await sleep(500);
  race('A9:unrelated-new-session-keeps-search', subscribed && await run() === runBefore && await stop() !== 'membership', ['The board watches Alpha’s sessions; a new session owning no seen candidate is not a membership change'], { subscribed, stop: await stop() });
  await evaluate(`qa.setProjects(${javascriptLiteral(PROJECTS.filter((p) => p.id !== 'alpha'))});true`);
  await wait('page', `d.querySelector('[data-testid="search-status"]')?.dataset.stop==='membership'`, 'membership change retires the narrowed search');
  await click('page', '[data-testid="search-refresh"] button');
  await wait('page', `d.querySelector('[data-testid="search-blocked"]')?.dataset.reason==='missing'`, 'unavailable project blocks');
  check('A6:unavailable-choice-kept', await guest<boolean>('page', `return d.querySelector('[data-testid="search-chip-project"]')?.dataset.available==='false'&&!!d.querySelector('[data-testid="search-remove-location"]')`));
  await shot('search-unavailable-scope');
  await evaluate(`qa.setProjects(${javascriptLiteral(PROJECTS)});qa.setSessions('alpha',[]);true`);
  await click('page', '[data-testid="search-remove-location"] button'); await idle();
  // A chosen worktree removed later: its chip stays, the narrowed search is blocked (never widened),
  // and only the worktree filter is offered for removal; the project stays.
  await choose('[data-testid="filter-project"]', 'Alpha'); await idle();
  await evaluate(`qa.setWorktrees('alpha',[{directory:'/fixture/wt-a',name:'feature-wt',branch:'feature-wt',status:'ready'}]);true`);
  await wait('page', `[...d.querySelectorAll('[data-testid="filter-worktree"] .oc-sdk-trigger')].length>0`, 'worktree filter');
  await choose('[data-testid="filter-worktree"]', 'feature-wt'); await idle();
  check('A6:worktree-search-runs-while-known', await stop() !== 'membership' && !(await guest<boolean>('page', `return !!d.querySelector('[data-testid="search-blocked"]')`)));
  await evaluate(`qa.setWorktrees('alpha',[]);true`);
  await wait('page', `d.querySelector('[data-testid="search-status"]')?.dataset.stop==='membership'`, 'worktree removal retires the narrowed search');
  const wtSent = await count('/v1/search');
  await click('page', '[data-testid="search-refresh"] button');
  await wait('page', `d.querySelector('[data-testid="search-blocked"]')?.dataset.reason==='missing'`, 'removed worktree blocks');
  const wt = await guest<Record<string, unknown>>('page', `return {parts:d.querySelector('[data-testid="search-blocked"]').dataset.parts,project:d.querySelector('[data-testid="search-chip-project"]')?.dataset.available??'yes',worktree:d.querySelector('[data-testid="search-chip-worktree"]')?.dataset.available,remove:d.querySelector('[data-testid="search-remove-location"]')?.dataset.part,label:d.querySelector('[data-testid="search-remove-location"]')?.textContent}`);
  check('A6:removed-worktree-blocks-not-widened', wt.parts === 'worktree' && wt.project === 'yes' && wt.worktree === 'false' && wt.remove === 'worktree' && wt.label === 'Remove worktree filter' && await count('/v1/search') === wtSent, ['Worktree chip kept as unavailable, project kept, zero search requests, Remove worktree filter offered'], wt);
  await shot('search-unavailable-worktree');
  await click('page', '[data-testid="search-remove-location"] button'); await idle();
  check('A6:remove-worktree-keeps-project', await guest<boolean>('page', `return !!d.querySelector('[data-testid="search-chip-project"]')&&!d.querySelector('[data-testid="search-chip-worktree"]')&&!d.querySelector('[data-testid="search-blocked"]')`));
  await click('page', '[data-testid="search-chip-project"] button'); await idle();
  // Service unavailable on the first window, then a partial failure on a later window.
  await evaluate(`qa.fail.push({path:'/v1/search',status:503,code:'busy',once:true});true`);
  await searchFor('Needle');
  race('F3:service-busy-is-not-empty', await guest<boolean>('page', `return !!d.querySelector('[data-testid="search-failed"]')&&!d.querySelector('[data-testid="search-empty"]')&&!!d.querySelector('[data-testid="search-retry"]')`));
  await act('retry', () => click('page', '[data-testid="search-retry"] button'));
  await exhaust();
  const clean = await counts();
  await evaluate(`qa.fail.push({path:'/v1/search',status:503,code:'unavailable',skip:3,once:true});true`);
  await searchFor('Needle');
  race('F3:partial-window-failure-keeps-found-so-far', await stop() === 'failed' && (await counts())?.final === 'false');
  await act('retry partial', () => click('page', '[data-testid="search-retry"] button'));
  await exhaust();
  race('F3:retry-after-partial-failure-not-double-counted', JSON.stringify(await counts()) === JSON.stringify({ ...clean, }), ['Only accepted windows count; the failed window is re-read once'], { clean, after: await counts() });

  // ======================================================= 4. Archived mode; freshness beyond the list
  await click('page', '[data-testid="cleanup-archived"] button');
  await wait('page', `d.querySelector('[data-testid="cleanup-archived"] button')?.getAttribute('aria-pressed')==='true'&&d.querySelector('[data-testid="search-scope"]')`, 'archived mode');
  await searchFor('archive export', true);
  check('A5:archived-explicit', /archived plans only/.test(await guest<string>('page', `return d.querySelector('[data-testid="search-scope"]').textContent`)) && (await counts())?.matchedPlans === '1');
  await click('page', T('P-archive', 'A1'));
  await wait('page', `d.activeElement?.dataset.testid==='item-A1'`, 'archived task revealed');
  await shot('search-archived');
  await click('page', '[data-testid="cleanup-restore"] button');
  await wait('page', `d.querySelector('[data-testid="search-status"]')?.dataset.stop==='retired'`, 'restore retires the search');
  check('A8:local-cleanup-retires-search', await guest<boolean>('page', `return !!d.querySelector('[data-testid="search-refresh"]')`) && !fx.archived('P-archive'));
  await click('page', '[data-testid="search-refresh"] button'); await idle(); await exhaust();
  check('A8:restored-plan-leaves-archived-results', !(await guest<boolean>('page', `return !!d.querySelector('${H('P-archive')}')`)));
  await click('page', '[data-testid="cleanup-visible"] button');
  await wait('page', `d.querySelector('[data-testid="plan-list"]')`, 'current mode');
  await searchFor('Needle-at-1001', true);
  check('A1:found-past-1000', await guest<boolean>('page', `return !!d.querySelector('${H('P-1001')}')`));
  await fx.deleteElsewhere('P-1001');
  await wait('page', `!d.querySelector('${H('P-1001')}')&&/removed/.test(d.querySelector('[data-testid="search-coverage"]').textContent)`, 'freshness removes the deleted hit', 20_000);
  race('F3:delete-beyond-500-removed-by-freshness', !fx.exists('P-1001'), ['Removed after an authoritative search-state read, not list absence']);

  // ======================================================= F3 held-reply races (labelled seams)
  {
    // R1: held window, then new criteria; the retired reply never paints or continues.
    await evaluate(`qa.holds.push({tag:'r1',path:'/v1/search'});true`);
    await clearField(); await type('Needle-at-0051'); await key('Enter');
    await wait('page', `true`); await sleep(150);
    const heldRun = await run();
    await searchFor('ship export');
    const newRun = await run();
    const beforeRelease = await count('/v1/search');
    await evaluate(`qa.release('r1')`); await sleep(600);
    race('F3:held-reply-after-new-criteria', await run() === newRun && heldRun !== newRun && await count('/v1/search') === beforeRelease && JSON.stringify(await planHits()) === '["P-0005-ship"]', ['The retired window was dropped; no continuation from it'], { heldRun, newRun, hits: await planHits() });
    // R2: held window, then Clear all.
    await evaluate(`qa.holds.push({tag:'r2',path:'/v1/search'});true`);
    await clearField(); await type('Dense match'); await key('Enter'); await sleep(150);
    await click('page', '[data-testid="search-clear"] button');
    await wait('page', `!d.querySelector('[data-testid="search-results"]')`, 'browsing');
    let mark = await count('/v1/search');
    await evaluate(`qa.release('r2')`); await sleep(600);
    race('F3:held-reply-after-clear-all', !(await guest<boolean>('page', `return !!d.querySelector('[data-testid="search-results"]')`)) && await count('/v1/search') === mark);
    // R3: held window, then the Archived mode switch.
    await evaluate(`qa.holds.push({tag:'r3',path:'/v1/search'});true`);
    await clearField(); await type('Dense match'); await key('Enter'); await sleep(150);
    await click('page', '[data-testid="cleanup-archived"] button');
    await wait('page', `d.querySelector('[data-testid="cleanup-archived"] button')?.getAttribute('aria-pressed')==='true'&&!d.querySelector('[data-testid="search-results"]')`, 'archived browse');
    mark = await count('/v1/search');
    await evaluate(`qa.release('r3')`); await sleep(600);
    race('F3:held-reply-after-mode-switch', !(await guest<boolean>('page', `return !!d.querySelector('[data-testid="search-results"]')`)) && await count('/v1/search') === mark);
    await click('page', '[data-testid="cleanup-visible"] button');
    await wait('page', `d.querySelector('[data-testid="plan-list"]')`, 'current');
    // R4: held window, then hidden: no paint, no continuation, no freshness while hidden.
    await evaluate(`qa.holds.push({tag:'r4',path:'/v1/search'});true`);
    await clearField(); await type('Needle-at-1001'); await key('Enter'); await sleep(150);
    await setHidden(true);
    mark = (await reqs(`r.frame==='page'`)).length;
    await evaluate(`qa.release('r4')`); await sleep(7000);
    const whileHidden = (await reqs(`r.frame==='page'`)).slice(mark);
    race('F3:hidden-retires-action-and-polls-nothing', whileHidden.length === 0 && await stop() === 'hidden', ['Zero requests in 7 s hidden (search, freshness and list)'], whileHidden.map((r: any) => r.path));
    await setHidden(false); await sleep(400);
    const afterShow = (await reqs(`r.frame==='page'`)).slice(mark);
    race('F3:visible-no-automatic-continuation', !afterShow.some((r: any) => r.path === '/v1/search'), ['Showing the frame again starts no search window; Continue is explicit'], afterShow.map((r: any) => r.path));
    await more('continue after hidden');
    // R5: held window during a local Archive: the pre-action reply cannot restore the plan.
    await searchFor('ship export');
    await click('page', H('P-0005-ship'));
    await wait('page', `d.querySelector('[data-testid="cleanup-archive"] button')`, 'archive action');
    await evaluate(`qa.holds.push({tag:'r5',path:'/v1/search'});true`);
    await click('page', '[data-testid="search-more"] button'); await sleep(150);
    await click('page', '[data-testid="cleanup-archive"] button');
    await wait('page', `d.querySelector('[data-testid="search-status"]')?.dataset.stop==='retired'`, 'archive retires search');
    mark = await count('/v1/search');
    await evaluate(`qa.release('r5')`); await sleep(600);
    race('F3:held-pre-archive-reply-cannot-act', await count('/v1/search') === mark && await stop() === 'retired' && fx.archived('P-0005-ship'));
    await act('refresh after archive', () => click('page', '[data-testid="search-refresh"] button'));
    await exhaust();
    race('F3:archived-plan-absent-after-refresh', !(await guest<boolean>('page', `return !!d.querySelector('${H('P-0005-ship')}')`)));
    // R6: held detail read while opening a task, then new criteria: no focus, no reveal.
    await searchFor('export csv', true);
    await evaluate(`qa.holds.push({tag:'r6',path:'/v1/plan'});true`);
    await click('page', T('P-export', 'T-blocked'));
    await sleep(150);
    await searchFor('Needle-at-0051');
    await evaluate(`qa.release('r6')`); await sleep(800);
    race('F3:held-detail-then-new-search-no-reveal', !(await guest<boolean>('page', `return /^item-/.test(d.activeElement?.dataset.testid??'')||!!d.querySelector('article[data-testid="plan-P-export"]')`)));
    // R7: same progress revision, new cleanup generation (archive + restore elsewhere): qualified as changed.
    await searchFor('Needle');
    await exhaust();
    await fx.cleanupElsewhere('archive', 'P-0051'); await fx.cleanupElsewhere('restore', 'P-0051');
    await wait('page', `d.querySelector('[data-testid="search-group-source-alpha/P-0051"]')?.dataset.changed==='true'`, 'cleanup generation marks changed', 20_000);
    race('F3:cleanup-generation-invalidates-same-revision', await stop() === 'changed' && (await counts())?.current === 'false');
    // R8: insert behind the cursor: honest as-searched qualification, no frozen census claim.
    await searchFor('Dense match');
    fx.insert('P-0000-late', 'Dense match late insert');
    await exhaust();
    race('F3:insert-behind-cursor-honest', /as searched; reports may change/.test(await guest<string>('page', `return d.querySelector('[data-testid="search-coverage"]').textContent`)) && !(await guest<boolean>('page', `return !!d.querySelector('${H('P-0000-late')}')`)), ['A plan inserted behind the cursor is not claimed; copy says as searched'], undefined);
    // R9: host session A/B/null keeps the board search; zero new windows.
    await searchFor('export csv');
    const keep = await run(); mark = await count('/v1/search');
    for (const s of ['session-a', 'session-b', null]) { await evaluate(`qa.context(${javascriptLiteral(s)});true`); await sleep(300); }
    race('F3:host-session-changes-keep-board-search', await run() === keep && await count('/v1/search') === mark && await guest<boolean>('page', `return !!d.querySelector('[data-testid="search-chip-q"]')`));
    // Rail with a null host session stays health-only and search-free.
    const railMark = (await reqs(`r.frame==='panel'`)).length;
    await sleep(3500);
    const railNull = (await reqs(`r.frame==='panel'`)).slice(railMark).map((r: any) => r.path);
    race('F3:rail-null-session-health-only', railNull.length > 0 && railNull.every((p: string) => ['/health', '/v1/setup', '/v1/extension-update'].includes(p)) && !(await reqs(`r.frame==='panel'`)).some((r: any) => r.path.startsWith('/v1/search')), ['With a null host session the rail polls health only and never searches'], railNull);
    // R10: held window, then account change: the board resets; the held reply cannot act.
    await evaluate(`qa.holds.push({tag:'r10',path:'/v1/search'});true`);
    await clearField(); await type('Dense match'); await key('Enter'); await sleep(150);
    await evaluate(`qa.account='account-other';qa.ready('page');true`);
    await wait('page', `!d.querySelector('[data-testid="search-results"]')&&d.querySelector('[data-testid="plan-list"]')`, 'account reset');
    mark = await count('/v1/search');
    await evaluate(`qa.release('r10')`); await sleep(600);
    race('F3:account-change-retires', await count('/v1/search') === mark && !(await guest<boolean>('page', `return !!d.querySelector('[data-testid="search-results"]')`)) && await guest<string>('page', `return d.getElementById('ap-search-q').value`) === '');
  }

  // ======================================================= 5. Narrow dark, 200% reflow, keyboard rules
  await theme('dark');
  await show(['page'], 360);
  await searchFor('café export', true);
  check('A11:narrow-no-overflow', await overflow(), ['360px: no horizontal overflow with long Unicode titles and chips']);
  const imeBefore = await count('/v1/search');
  await guest('page', `d.getElementById('ap-search-q').focus();return true`);
  await c.send('Input.imeSetComposition', { text: 'かな', selectionStart: 2, selectionEnd: 2 });
  await c.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 229 });
  await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 229 });
  await c.send('Input.insertText', { text: 'かな' });
  await frames2();
  check('A11:ime-enter-does-not-submit', await count('/v1/search') === imeBefore, ['Enter during composition committed text only']);
  check('A11:typed-text-survives-repaint', await guest<string>('page', `return d.getElementById('ap-search-q').value`) === 'café exportかな');
  const shortcuts = await guest<boolean[]>('page', `return ['f','k'].flatMap(k=>[true,false].map(ctrl=>{const e=new KeyboardEvent('keydown',{key:k,ctrlKey:ctrl,metaKey:!ctrl,bubbles:true,cancelable:true});d.getElementById('ap-search-q').dispatchEvent(e);return e.defaultPrevented}))`);
  check('A11:host-shortcuts-not-intercepted', shortcuts.every((x) => !x), ['Ctrl/Cmd+F and Ctrl/Cmd+K are not prevented by the guest (synthetic events, labelled)'], shortcuts);
  await searchFor('café export', true);
  // Shift+Tab from the field reaches the mode buttons; Tab reaches results in order.
  await guest('page', `d.getElementById('ap-search-q').focus();return true`);
  await key('Tab', 1, 8);
  check('A11:shift-tab-reverse-order', await guest<boolean>('page', `return !!d.activeElement?.closest('[data-testid="cleanup-modes"]')`));
  await shot('search-narrow-keyboard', '[data-testid="progress-root"]', 12, 2200);
  await c.send('Emulation.setDeviceMetricsOverride', { width: 640, height: 1100, deviceScaleFactor: 2, mobile: false });
  await show(['page'], 320);
  check('A11:reflow-200', await overflow(), ['Half CSS width at device scale 2: no horizontal scrolling']);
  await c.send('Emulation.clearDeviceMetricsOverride');
  await theme('light');
  await show(['page'], 360);
  await shot('search-narrow-light', '[data-testid="search"]');
  await show(['page'], 1100);

  // ======================================================= Old capability: unavailable, zero search work
  await evaluate(`qa.stripSearch=true;qa.reload('page');true`);
  await wait('page', `d.querySelector('[data-testid="search-unavailable"]')&&d.querySelector('[data-testid="plan-list"]')`, 'old service: unavailable note', 20_000);
  const oldMark = await count('/v1/search');
  await sleep(3500);
  race('F3:old-capability-unavailable-not-zero', await count('/v1/search') === oldMark && !(await guest<boolean>('page', `return !!d.querySelector('[data-testid="search-form"]')`)));
  await evaluate(`qa.stripSearch=false;qa.account='account-example';qa.reload('page');true`);
  await wait('page', `d.querySelector('[data-testid="search-form"]')&&d.querySelector('[data-testid="plan-list"]')`, 'reloaded board', 20_000);
  await instrument();

  // ======================================================= V6 measurements and bounds (same run)
  {
    const first: number[] = [], reveal: number[] = [], loadMore: number[] = [], revisit: number[] = [], context: number[] = [];
    for (let i = 0; i < (measure ? 4 : 1); i++) {
      // First result: Enter → first hit painted (plan 51 is found by the first window).
      await clearField(); await type('Needle-at-0051');
      let t0 = await now(); await key('Enter');
      first.push(await wait('page', `!!d.querySelector('[data-testid="search-results"] .ap-hit')`, 'first hit') - t0);
      await idle();
      await searchFor('export csv', true);
      t0 = await now(); await click('page', T('P-export', 'T-csv'));
      reveal.push(await wait('page', `d.activeElement?.dataset.testid==='item-T-csv'`, 'reveal') - t0);
      // Dense pages: Load more → next full page painted; Previous → retained page painted.
      await searchFor('Dense match');
      t0 = await now(); await click('page', '[data-testid="search-more"] button');
      loadMore.push(await wait('page', `${IDLE}&&d.querySelector('[data-testid="search-results"]').dataset.page==='2'`, 'page 2') - t0);
      actions.push({ action: 'load more (measured)', windows: -1 });
      const rmark = await count('/v1/search');
      t0 = await now(); await click('page', '[data-testid="search-prev"] button');
      revisit.push(await wait('page', `d.querySelector('[data-testid="search-results"]').dataset.page==='1'`, 'page 1') - t0);
      check('A10:cached-revisit-no-window', await count('/v1/search') === rmark);
      t0 = await now(); await choose('[data-testid="filter-project"]', 'Alpha');
      context.push(await wait('page', IDLE + `&&!!d.querySelector('[data-testid="search-chip-project"]')`, 'context change') - t0);
      await click('page', '[data-testid="search-clear"] button');
      await wait('page', `!d.querySelector('[data-testid="search-results"]')`, 'cleared');
    }
    const s = (xs: number[]) => stats(measure ? xs.slice(1) : xs);
    if (measure) Object.assign(perf, { firstResultMs: s(first), taskRevealMs: s(reveal), loadMorePageMs: s(loadMore), cachedRevisitMs: s(revisit), contextChangeMs: s(context) });
    // DOM and page retention after many pages.
    await searchFor('Dense match');
    for (let i = 0; i < 4; i++) await more('load more (retention)');
    const dom = await guest<{ hits: number; buttons: number; nodes: number; page: string; previous: boolean }>('page', `const r=d.querySelector('[data-testid="search-results"]');return {hits:Number(d.querySelector('[data-testid="search-counts"]').dataset.shown),buttons:r.querySelectorAll('.ap-hit').length,nodes:r.querySelectorAll('*').length,page:r.dataset.page,previous:!!d.querySelector('[data-testid="search-prev"]')}`);
    await click('page', '[data-testid="search-prev"] button');
    await wait('page', `d.querySelector('[data-testid="search-results"]').dataset.page==='${Number(dom.page) - 1}'`, 'previous page');
    const oldest = await guest<boolean>('page', `return !!d.querySelector('[data-testid="search-prev"]')`);
    gates.push({ id: 'page-retention', pass: dom.hits <= 50 && !oldest, observed: { ...dom, previousOfPreviousAvailable: oldest }, limit: 'one shown page of ≤50 hits; at most two pages retained' });
    if (measure) perf.dom = { ...dom, heap: await c.send('Runtime.getHeapUsage') };
    // Unchanged polls: only bounded freshness reads, no repaint.
    await click('page', '[data-testid="search-next"] button'); await idle();
    // A reused page repaints once when its freshness check lands; the idle window starts after it.
    await wait('page', `!/Checking that these earlier results/.test(d.querySelector('[data-testid="search-coverage"]').textContent)`, 'reused page checked');
    await sleep(300); await paints();
    let mark = (await reqs(`r.frame==='page'`)).length;
    await sleep(6500);
    const idleReqs = (await reqs(`r.frame==='page'`)).slice(mark);
    const idlePaints = await paints();
    const byPath = idleReqs.reduce((o: Record<string, number>, r: any) => { o[r.path] = (o[r.path] ?? 0) + 1; return o; }, {});
    gates.push({ id: 'unchanged-polls', pass: Object.keys(byPath).every((p) => p === '/v1/search-state') && (byPath['/v1/search-state'] ?? 0) <= 6 && idlePaints.length === 0, observed: { requests: byPath, paints: idlePaints.length }, limit: 'only /v1/search-state (≤2 per 3 s poll), zero repaints' });
    // Hidden frame and disposal.
    await setHidden(true); mark = (await reqs(`r.frame==='page'`)).length; await sleep(7000);
    const hidden = (await reqs(`r.frame==='page'`)).length - mark;
    await setHidden(false); await idle();
    gates.push({ id: 'hidden-frame', pass: hidden === 0, observed: { requestsWhileHidden7s: hidden }, limit: 'zero' });
    if (measure) perf.idle = { requests6500ms: byPath, paints: idlePaints.length, hiddenRequests7s: hidden };
  }

  // ======================================================= 6. Store change (last but disposal)
  await searchFor('Needle-at-0051');
  const storeMark = await evaluate<number>(`qa.replies.length`);
  await evaluate(`qa.store=1;true`);
  await wait('page', `!d.querySelector('[data-testid="search-results"]')&&d.querySelector('[data-testid="plan-list"]')`, 'store change resets the board', 20_000);
  const stateReplies = (await evaluate<any[]>(`qa.replies.slice(${storeMark}).filter(r=>r.path==='/v1/search-state')`)).map((r: any) => ({ status: r.status, keys: r.keys }));
  race('F3:store-change-retires-search', stateReplies.some((r: any) => r.status === 409) && !(await guest<boolean>('page', `return !!d.querySelector('[data-testid="search-results"]')`)), ['Freshness 409 → list read adopts the new store and resets; no results from the old store'], stateReplies);
  await evaluate(`qa.store=0;true`);

  // ======================================================= 7. Saved views blocked: zero preference storage
  const storage = await evaluate<any[]>(`qa.storage.filter(s=>s.frame==='page'&&s.at>=${storageMark})`);
  check('S1:blocked-zero-preference-storage', storage.every((s: any) => !/search|view/i.test(String(s.key))) && storage.filter((s: any) => s.op === 'set' || s.op === 'delete').length === 0, ['Named views are blocked (no proven host-account isolation): search reads and writes no preference storage; no saved-view controls exist'], storage);
  check('S1:no-saved-view-controls', !(await guest<boolean>('page', `return !!d.querySelector('[data-testid^="view-"],[data-testid="views-status"]')`)));
  facts.pageStorageOpsDuringRun = storage.map((s: any) => `${s.op}:${s.scope}`);

  // Disposal: pagehide stops every search read.
  await searchFor('Dense match');
  await guest('page', `w.dispatchEvent(new Event('pagehide'));return true`);
  const dmark = (await reqs(`r.frame==='page'`)).length;
  await sleep(3500);
  gates.push({ id: 'disposal', pass: (await reqs(`r.frame==='page'`)).length === dmark, observed: { requestsAfterPagehide3500ms: (await reqs(`r.frame==='page'`)).length - dmark }, limit: 'zero' });

  // Rail and Work Status: no search controls or requests during the whole run.
  const surfaces = await evaluate<{ controls: number; requests: number }>(`({controls:['panel','status'].map(f=>frame(f).contentDocument.querySelectorAll('[data-testid^="search"]').length).reduce((a,b)=>a+b,0),requests:qa.requests.filter(r=>(r.frame==='panel'||r.frame==='status')&&r.path.startsWith('/v1/search')).length})`);
  check('Q1:rail-status-unchanged', surfaces.controls === 0 && surfaces.requests === 0, ['Rail and Work Status have no search controls and sent no search requests'], surfaces);
  check('S0:only-explicit-cleanup-writes', (await reqs(`r.method!=='GET'`)).every((r: any) => /\/v1\/plan\/(archive|restore)$/.test(r.path)), ['Only the explicit Restore/Archive actions wrote']);
  // Hard work/request gates from the service's own counters on every search reply.
  replies = await evaluate<any[]>(`qa.replies`);
  const windows = replies.filter((r) => r.path === '/v1/search' && r.work);
  const max = (k: string) => Math.max(0, ...windows.map((r) => r.work[k]));
  gates.push(
    { id: 'plan-slots', pass: max('planSlots') <= 64, observed: max('planSlots'), limit: '≤64 per request' },
    { id: 'membership-rows', pass: max('membershipRows') <= 128, observed: max('membershipRows'), limit: '≤128 per request' },
    { id: 'input-bytes', pass: max('inputBytes') <= 8 * 1024 * 1024, observed: max('inputBytes'), limit: '≤8 MiB per request' },
    { id: 'hits', pass: Math.max(0, ...windows.map((r) => r.hits)) <= 50, observed: Math.max(0, ...windows.map((r) => r.hits)), limit: '≤50 per request' },
    { id: 'output-bytes', pass: max('outputBytes') <= 256 * 1024 && Math.max(0, ...windows.map((r) => r.bytes)) <= 256 * 1024, observed: { work: max('outputBytes'), measured: Math.max(0, ...windows.map((r) => r.bytes)) }, limit: '≤256 KiB per response' },
    { id: 'windows-per-action', pass: actions.every((a) => a.windows <= 10), observed: Math.max(...actions.map((a) => a.windows)), limit: '≤10 per explicit action' },
    { id: 'freshness-keys', pass: replies.filter((r) => r.path === '/v1/search-state').every((r) => r.keys >= 1 && r.keys <= 50), observed: Math.max(0, ...replies.filter((r) => r.path === '/v1/search-state').map((r) => r.keys)), limit: '1–50 keys per read' },
  );
  for (const g of gates) check(`V6:${g.id}`, g.pass, [g.limit], g.observed);
  facts.serviceMode = built ? 'built generated service' : 'current TypeScript service';
  facts.searchWindows = windows.length;
  facts.stateReads = replies.filter((r) => r.path === '/v1/search-state').length;
  check('S0:no-proxy-errors', JSON.stringify(await evaluate('qa.errors')) === '[]');
  const errors = pageErrors();
  check('S0:no-guest-exceptions-or-console-errors', errors.length === 0, undefined, errors);
} catch (e) {
  if (!(e instanceof OnlyDone)) failure = e instanceof Error ? e.message.split('\n')[0].slice(0, 700) : String(e);
} finally {
  if (productionMap && page) {
    try {
      const r = await page.send('Runtime.evaluate', { expression: 'qa.replies', returnByValue: true });
      replies = r.result.value ?? [];
      if (failure) {
        const snapshot = await page.send('Runtime.evaluate', { expression: `Object.fromEntries(['page','panel','status'].map(f=>{const d=frame(f).contentDocument;return [f,{text:d.getElementById('root')?.innerText.slice(-1600),active:d.activeElement?.outerHTML.slice(0,250)}]}))`, returnByValue: true });
        writeFileSync(join(artifacts,'failure-state.json'),JSON.stringify(snapshot.result.value,null,2)+'\n');
      }
    } catch { /* Browser failure is already recorded; do not hide the original failure. */ }
  }
  if (onlyLarge && page) {
    try {
      const captured = await page.send('Runtime.evaluate', { expression: 'qa.replies', returnByValue: true });
      replies = [...(captured.result.value ?? []), ...fx.graphProbes];
    } catch { if (!failure) failure = 'large-plan metadata collection failed'; }
  }
  page?.close(); browser?.close();
  const exited = new Promise((r) => { if (chrome.exitCode !== null) r(null); else chrome.once('exit', r); });
  try { process.kill(-chrome.pid!, 'SIGTERM'); } catch { chrome.kill('SIGTERM'); }
  await exited;
  await fx.stop();
   const evidenceClass = `synthetic SDK shell, real disposable HTTP services over SQLite (${built ? 'built generated service' : 'current TypeScript service'}), isolated ${process.argv.includes('--headed') ? 'headed' : 'headless'} Linux Chromium, current guest bundles`;
  const environment = { evidenceClass, browser: browserVersion, reducedMotion: true, nativeHostProof: false };
  const passed = !failure && results.length + races.length > 0 && results.every((r) => r.pass) && races.every((r) => r.pass);
  writeFileSync(join(artifacts, 'results.json'), `${JSON.stringify({ ...environment, passed, failure, assertions: results.length, results, facts, screenshots: shots }, null, 2)}\n`);
  writeFileSync(join(artifacts, 'races.json'), `${JSON.stringify({ ...environment, passed: !failure && races.every((r) => r.pass), assertions: races.length, results: races, note: 'Held replies, failures, capability strip, account/store switches and visibility are labelled shell seams.' }, null, 2)}\n`);
  const windowSummary = replies.filter((r) => r.path === '/v1/search').map((r) => ({ status: r.status, continuation: r.cursor, hits: r.hits ?? null, bytes: r.bytes, ms: Math.round(r.ms * 10) / 10, work: r.work ?? null }));
  const stateSummary = replies.filter((r) => r.path === '/v1/search-state').map((r) => ({ status: r.status, keys: r.keys, bytes: r.bytes, ms: Math.round(r.ms * 10) / 10 }));
  const serviceMs = windowSummary.filter((w) => w.status === 200).map((w) => w.ms);
  const detailGraph = replies.filter(r => r.path === '/v1/plan' || r.path === '/v1/plan-graph').map(({ frame, traffic, path, status, bytes, ms, revision, itemCount, continuation, nextPage }) => ({ frame, traffic, path, status, bytes, ms, revision, itemCount, continuation, nextPage }));
  writeFileSync(join(artifacts, 'requests.json'), `${JSON.stringify({ ...environment, passed: gates.every((g) => g.pass) && !failure, gates, actions, detailGraph, searchWindows: { count: windowSummary.length, serviceRoundTripMs: serviceMs.length ? stats(serviceMs) : null, windows: windowSummary }, freshnessReads: { count: stateSummary.length, reads: stateSummary } }, null, 2)}\n`);
    if (measure) writeFileSync(join(artifacts, 'performance.json'), `${JSON.stringify({ ...environment, mode: onlyMapLarge ? 'dependency-map-large' : onlyLarge ? 'large-plan' : 'candidate-search', passed, failure, measurements: perf, note: productionMap ? 'Production guests. Three samples after one warm-up per surface/width; local budgets, not a latency SLA. Real keyboard actions and labelled native-select group changes, no controller probes. CPU is separately labelled browser layout/style/script, not compositor time.' : 'Three samples after one warm-up; diagnostic on one machine, no latency SLA. Work/request limits and local smoke budgets are in requests.json.' }, null, 2)}\n`);
  console.log(JSON.stringify({ passed, assertions: results.length, races: races.length, gates: gates.length, failure, screenshots: shots }, null, 2));
  if (!passed) process.exitCode = 1;
  rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
