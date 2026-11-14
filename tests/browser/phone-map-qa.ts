// Phone-width touch QA for the dependency map (board Map tab and rail Map view) in an isolated
// Chromium with CDP touch emulation, over the existing synthetic SDK shell and real disposable
// services (plan-task-search-shell.ts, production-map fixture). With --source the guests are
// compiled from TypeScript into a disposable directory (source-guests.ts); tracked bundles are
// never read for the guests or overwritten. Touch emulation and a simulated ready.device are
// supporting evidence only, not physical-phone certification.
// Usage: node --experimental-strip-types tests/browser/phone-map-qa.ts [--source] --chromium <path> --artifacts <dir>
//   writes results.json and map.png, map-selected.png, map-rail.png, map-dark.png, map-ru.png,
//   map-desktop.png into <dir>. Exits non-zero on the first failed check.
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { javascriptLiteral as literal } from '../../shared/javascript-literal.ts';
import { createGuestAssets, type GuestSurface } from './source-guests.ts';
import { startSearchShell } from './plan-task-search-shell.ts';

const arg = (name: string) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const artifacts = arg('--artifacts'), chromium = arg('--chromium') ?? process.env.CHROMIUM;
if (!artifacts || !chromium || !existsSync(chromium)) throw new Error('usage: phone-map-qa.ts [--source] --chromium <path> --artifacts <dir>');
mkdirSync(artifacts, { recursive: true });

type Check = { id: string; pass: boolean; facts?: unknown };
const results: Check[] = [], shots: string[] = [];
function check(id: string, pass: boolean, facts?: unknown) {
  results.push({ id, pass, ...(facts === undefined ? {} : { facts }) });
  if (!pass) throw new Error(`${id} failed: ${JSON.stringify(facts ?? null).slice(0, 800)}`);
}
type Cdp = { send: (method: string, params?: object) => Promise<any>; close: () => void; errors: string[] };
async function connect(url: string): Promise<Cdp> {
  const ws = new WebSocket(url);
  await new Promise<void>((resolve, reject) => { ws.onopen = () => resolve(); ws.onerror = () => reject(new Error('CDP connect failed')); });
  let next = 1; const waiting = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>(); const errors: string[] = [];
  ws.onmessage = event => {
    const m = JSON.parse(String(event.data)), w = m.id && waiting.get(m.id);
    if (w) { waiting.delete(m.id); if (m.error) w.reject(new Error(m.error.message)); else w.resolve(m.result); }
    else if (m.method === 'Runtime.exceptionThrown') errors.push(String(m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text).slice(0, 300));
  };
  return { errors, close: () => ws.close(), send: (method, params = {}) => new Promise((resolve, reject) => { const id = next++; waiting.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); }) };
}

// Disposable guest root: /ui/<surface>/{index.html,main.js}. With --source, main.js is compiled now.
const surfaces: GuestSurface[] = ['page', 'panel', 'status'];
const assets = createGuestAssets({ source: process.argv.includes('--source'), surfaces });
mkdirSync('/tmp/opencode', { recursive: true });
const scratch = mkdtempSync('/tmp/opencode/phone-map-qa-');
for (const s of surfaces) {
  mkdirSync(join(scratch, 'ui', s), { recursive: true });
  for (const file of ['index.html', 'main.js']) writeFileSync(join(scratch, 'ui', s, file), assets.read(`/ui/${s}/${file}`)!);
}
const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, HOME: join(scratch, 'home'), TMPDIR: scratch };
for (const key of ['CONFIG', 'CACHE', 'DATA', 'STATE']) { env[`XDG_${key}_HOME`] = join(scratch, key.toLowerCase()); mkdirSync(env[`XDG_${key}_HOME`]!, { recursive: true }); }
env.XDG_RUNTIME_DIR = join(scratch, 'runtime'); mkdirSync(env.XDG_RUNTIME_DIR, { recursive: true, mode: 0o700 }); mkdirSync(env.HOME!, { recursive: true });

let fx: Awaited<ReturnType<typeof startSearchShell>> | null = null, chrome: ChildProcess | null = null, page: Cdp | null = null;
let failure: string | null = null, browserVersion = '';
const facts: Record<string, unknown> = { source: assets.source, evidenceClass: 'synthetic SDK shell, real Chromium touch emulation; not physical-phone proof' };
try {
  fx = await startSearchShell(false, false, 'dependency-map-final', false, true, { guestRoot: scratch });
  const profile = join(scratch, 'profile');
  chrome = spawn(chromium, ['--headless=new', '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--disable-sync', '--hide-scrollbars', '--window-size=1280,1000', 'about:blank'], { stdio: 'ignore', detached: true, env });
  let devtools = '';
  for (const end = Date.now() + 15_000; Date.now() < end && !devtools;) {
    const f = join(profile, 'DevToolsActivePort');
    if (existsSync(f)) devtools = readFileSync(f, 'utf8').split('\n')[0]; else await new Promise(r => setTimeout(r, 100));
  }
  if (!devtools) throw new Error('Chromium did not start its DevTools endpoint.');
  browserVersion = (await (await fetch(`http://127.0.0.1:${devtools}/json/version`)).json() as { Browser: string }).Browser;
  const targets = await (await fetch(`http://127.0.0.1:${devtools}/json/list`)).json() as { type: string; webSocketDebuggerUrl: string }[];
  page = await connect(targets.find(t => t.type === 'page')!.webSocketDebuggerUrl);
  const c = page;
  await c.send('Runtime.enable'); await c.send('Page.enable');
  await c.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await c.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });

  const evaluate = async <T = any>(expression: string): Promise<T> => {
    const r = await c.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value as T;
  };
  const guest = <T = any>(f: string, code: string) => evaluate<T>(`(()=>{const w=frame(${literal(f)}).contentWindow,d=w.document;${code}})()`);
  const wait = async (f: string, cond: string, what = cond, ms = 20_000) => {
    const ok = await evaluate<boolean>(`(async()=>{const end=performance.now()+${ms};while(performance.now()<end){try{const w=frame(${literal(f)}).contentWindow,d=w.document;if(${cond})return true}catch{}await new Promise(r=>requestAnimationFrame(r));}return false})()`);
    if (!ok) throw new Error(`timed out waiting (${f}): ${what}`);
  };
  /** Until the guest page's scroll position holds still for 12 frames (fling momentum ends). */
  const settle = (f: string) => evaluate(`(async()=>{const d=frame(${literal(f)}).contentDocument;let last=-1,same=0;for(let i=0;i<600&&same<12;i++){const now=d.scrollingElement.scrollTop;same=now===last?same+1:0;last=now;await new Promise(r=>requestAnimationFrame(r))}return true})()`);
  const frames2 = () => evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  const hook = (id: string) => `[data-testid="${id}"]`;
  const region = hook('map-region'), viewport = hook('map-viewport'), inspector = hook('map-inspector');
  /** Page (top-level CSS px) point of a guest element: its centre, or `at` fractions of its box. */
  const point = (f: string, selector: string, at: [number, number] = [0.5, 0.5]) => evaluate<[number, number] | null>(`(()=>{const fr=frame(${literal(f)}),n=fr.contentDocument.querySelector(${literal(selector)});if(!n)return null;const r=n.getBoundingClientRect(),o=fr.getBoundingClientRect();return [o.x+r.x+r.width*${at[0]},o.y+r.y+r.height*${at[1]}]})()`);
  const need = async (f: string, selector: string, at?: [number, number]) => { const p = await point(f, selector, at); if (!p) throw new Error(`missing ${selector} in ${f}`); return p; };
  const touch = async (type: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel', points: [number, number][]) =>
    c.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y], id) => ({ x, y, id, radiusX: 4, radiusY: 4, force: 1 })) });
  const tap = async (p: [number, number]) => { await touch('touchStart', [p]); await touch('touchEnd', []); await frames2(); };
  /** One finger from `a` to `b` in `steps` moves. */
  const swipe = async (a: [number, number], b: [number, number], steps = 8) => {
    await touch('touchStart', [a]);
    for (let i = 1; i <= steps; i++) await touch('touchMove', [[a[0] + (b[0] - a[0]) * i / steps, a[1] + (b[1] - a[1]) * i / steps]]);
    await touch('touchEnd', []); await frames2();
  };
  const pinch = async (centre: [number, number], from: number, to: number, steps = 8) => {
    const at = (d: number): [number, number][] => [[centre[0] - d / 2, centre[1]], [centre[0] + d / 2, centre[1]]];
    await touch('touchStart', at(from));
    for (let i = 1; i <= steps; i++) await touch('touchMove', at(from + (to - from) * i / steps));
    await touch('touchEnd', []); await frames2();
  };
  const mouse = async (type: string, [x, y]: [number, number], buttons = 1) => c.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons, clickCount: 1 });
  const key = async (k: string) => { const codes: Record<string, number> = { Enter: 13, ArrowRight: 39, ArrowLeft: 37, Escape: 27 }; for (const type of ['keyDown', 'keyUp']) await c.send('Input.dispatchKeyEvent', { type, key: k, code: k, windowsVirtualKeyCode: codes[k] ?? 0, ...(type === 'keyDown' && k === 'Enter' ? { text: '\r' } : {}) }); await frames2(); };
  const transform = (f: string) => guest<{ x: number; y: number; zoom: number }>(f, `const n=d.querySelector('${hook('map-world')}'),m=/translate\\(([-\\d.e]+)px, ?([-\\d.e]+)px\\) scale\\(([-\\d.e]+)\\)/.exec(n.style.transform);return {x:+m[1],y:+m[2],zoom:+m[3]}`);
  const selected = (f: string) => guest<string>(f, `return d.querySelector('${inspector}')?.dataset.selected??''`);
  const scrollTop = (f: string) => guest<number>(f, `return d.scrollingElement.scrollTop`);
  const noOverflow = (f: string) => guest<boolean>(f, `return d.documentElement.scrollWidth<=d.documentElement.clientWidth`);
  const shot = async (name: string, f: string, selector = region, height = 1400) => {
    await guest(f, `d.querySelector(${literal(selector)})?.scrollIntoView({block:'start'});return true`); await frames2();
    const r = await evaluate<number[]>(`(()=>{const fr=frame(${literal(f)}),n=fr.contentDocument.querySelector(${literal(selector)}),a=n.getBoundingClientRect(),o=fr.getBoundingClientRect();return [o.x+a.x,o.y+Math.max(0,a.y),a.width,Math.min(a.height,o.height-Math.max(0,a.y))]})()`);
    const png = await c.send('Page.captureScreenshot', { format: 'png', clip: { x: Math.max(0, r[0] - 8), y: Math.max(0, r[1] - 8), width: r[2] + 16, height: Math.min(r[3] + 16, height), scale: 1 } });
    writeFileSync(join(artifacts, `${name}.png`), Buffer.from(png.data, 'base64')); shots.push(`${name}.png`);
  };
  const DEVICE = { formFactor: 'phone', pointer: 'coarse', insets: { top: 47, right: 0, bottom: 34, left: 0 }, keyboard: 0 };
  /** Simulated ready.device: wrap the guest window's postMessage from the shell's realm, so the
   * message still comes from the shell (event.source) and only `ready` gains the hint. */
  const withDevice = async (f: string, device: object | null) => evaluate(`(()=>{const w=frame(${literal(f)}).contentWindow;w.__qaPost??=w.postMessage;const post=w.__qaPost,dev=${literal(device)};w.postMessage=function(m,o){if(m&&m.type==='ready'){m={...m,payload:{...m.payload}};if(dev)m.payload.device=dev;else delete m.payload.device}return post.call(w,m,o)};qa.ready(${literal(f)});return true})()`);
  const phone = async (f: string, coarseMedia = true) => {
    await c.send('Emulation.setDeviceMetricsOverride', { width: 430, height: 940, deviceScaleFactor: 2, mobile: coarseMedia });
    await c.send('Emulation.setTouchEmulationEnabled', { enabled: coarseMedia, maxTouchPoints: 5 });
    await evaluate(`qa.show([${literal(f)}],390);frame(${literal(f)}).style.height='844px';true`);
    await wait(f, 'w.innerWidth===390', `${f} at 390`);
  };
  const desktop = async (f: string) => {
    await c.send('Emulation.setTouchEmulationEnabled', { enabled: false });
    await c.send('Emulation.clearDeviceMetricsOverride');
    await evaluate(`qa.show([${literal(f)}],1200);frame(${literal(f)}).style.height='1000px';true`);
    await wait(f, 'w.innerWidth===1200', `${f} at 1200`);
  };
  const ready = (f: string) => wait(f, `d.querySelector('${region}')?.dataset.current==='true'&&d.querySelector('${viewport}')&&d.querySelector('${hook('map-world')}')`, 'current map');
  const smallTargets = (f: string) => guest<string[]>(f, `return [...d.querySelectorAll('${region} :is(.ap-map-tool,.ap-map-select,.oc-sdk-btn,.ap-map-help-trigger,.ap-map-rel-item),.ap-map-switch .oc-sdk-btn')].filter(n=>n.getClientRects().length).map(n=>{const r=n.getBoundingClientRect();return [n.dataset.testid??n.closest('[data-testid]')?.dataset.testid??n.className,Math.round(r.width),Math.round(r.height)]}).filter(([,w,h])=>w<44||h<44).map(x=>x.join(':'))`);

  await c.send('Page.navigate', { url: `http://127.0.0.1:${fx.port}/` });
  await wait('page', `d.querySelector('[data-testid="detail-tabs"]')`, 'board loaded');

  // ── Board at 390 with touch emulation and a simulated phone device hint.
  await phone('page');
  facts.coarseMedia = await guest('page', `return w.matchMedia('(pointer: coarse)').matches`);
  await withDevice('page', DEVICE);
  await wait('page', `d.querySelector('[data-testid="plan-row-P-map"][data-source="source-alpha"]')`, 'map plan row');
  await tap(await need('page', '[data-testid="plan-row-P-map"][data-source="source-alpha"]'));
  await wait('page', `d.querySelector('[data-testid="detail-tabs"] [data-id="map"]')`, 'Map tab');
  await guest('page', `d.querySelector('[data-testid="detail-tabs"] [data-id="map"]').scrollIntoView({block:'center'});return true`); await frames2();
  await tap(await need('page', '[data-testid="detail-tabs"] [data-id="map"]'));
  await ready('page');
  await guest('page', `d.querySelector('${viewport}').scrollIntoView({block:'center'});return true`); await frames2();
  check('board-coarse-flag', await guest('page', `return d.querySelector('${region}').dataset.pointer==='coarse'`), { coarseMedia: facts.coarseMedia });
  check('board-no-horizontal-overflow', await noOverflow('page'));
  check('board-touch-action', await guest('page', `return getComputedStyle(d.querySelector('${viewport}')).touchAction==='none'`));
  check('board-44px-targets', (await smallTargets('page')).length === 0, await smallTargets('page'));
  // Readable framing: the current-work card is drawn at full size inside the canvas.
  const first = await guest<{ id: string; width: number; inside: boolean; zoom: string }>('page', `const v=d.querySelector('${viewport}').getBoundingClientRect(),n=d.querySelector('[data-testid="map-card-B"]'),r=n.getBoundingClientRect();return {id:n.dataset.task,width:Math.round(r.width),inside:r.left>=v.left-1&&r.right<=v.right+1&&r.top>=v.top-1&&r.bottom<=v.bottom+1,zoom:d.querySelector('${hook('map-zoom-level')}').textContent}`);
  check('board-readable-initial-framing', first.width >= 219 && first.inside, first);
  const canvasHeight = await guest<number>('page', `return d.querySelector('${viewport}').getBoundingClientRect().height`);
  check('board-canvas-leaves-page-scroll-room', canvasHeight <= 844 * 0.55, { canvasHeight });
  await shot('map', 'page');

  // Tap selects; the stacked inspector names it; no hover was needed.
  await tap(await need('page', hook('map-card-B')));
  await wait('page', `d.querySelector('${inspector}')?.dataset.selected==='B'`, 'tap selected B');
  check('board-tap-selects', await guest('page', `return d.querySelector('${hook('map-card-B')}').getAttribute('aria-current')==='true'`));
  // One finger on a card pans the map, keeps the selection and does not scroll the page.
  const t0 = await transform('page'), s0 = await scrollTop('page');
  const onCard = await need('page', hook('map-card-B'));
  await swipe(onCard, [onCard[0] - 60, onCard[1] - 40]);
  const t1 = await transform('page');
  check('board-finger-pan-from-card', Math.abs(t1.x - t0.x + 60) < 2 && Math.abs(t1.y - t0.y + 40) < 2 && await selected('page') === 'B' && await scrollTop('page') === s0, { t0, t1 });
  // Two fingers zoom around the point between them.
  const centre = await need('page', viewport);
  const before = await transform('page');
  await pinch(centre, 80, 160);
  const after = await transform('page');
  const anchor = await guest<[number, number]>('page', `const r=d.querySelector('${viewport}').getBoundingClientRect(),o=w.frameElement.getBoundingClientRect();return [${centre[0]}-o.x-r.x,${centre[1]}-o.y-r.y]`);
  const world = (t: typeof before) => [(anchor[0] - (t.x - 28 * t.zoom)) / t.zoom, (anchor[1] - (t.y - 28 * t.zoom)) / t.zoom];
  check('board-pinch-zooms-around-midpoint', after.zoom > before.zoom * 1.8 && Math.hypot(world(after)[0] - world(before)[0], world(after)[1] - world(before)[1]) < 3 && await selected('page') === 'B' && await scrollTop('page') === s0, { before, after });
  await pinch(centre, 160, 80);
  check('board-pinch-out', (await transform('page')).zoom < after.zoom);
  await shot('map-selected', 'page');
  // A background tap clears the selection once.
  const empty = await guest<[number, number] | null>('page', `const v=d.querySelector('${viewport}').getBoundingClientRect(),o=w.frameElement.getBoundingClientRect();for(let y=v.top+6;y<v.bottom-6;y+=12)for(let x=v.left+6;x<v.right-6;x+=12){const n=d.elementFromPoint(x,y);if(n&&n.closest('${viewport}')&&!n.closest('button'))return [o.x+x,o.y+y]}return null`);
  if (!empty) throw new Error('no empty canvas point');
  await tap(empty);
  await wait('page', `!d.querySelector('${inspector}')?.dataset.selected`, 'background tap cleared');
  check('board-background-tap-clears', true);
  // Toolbar buttons are labelled tap alternatives to the gestures.
  const z = (await transform('page')).zoom;
  await tap(await need('page', hook('map-zoom-in')));
  check('board-zoom-button-tap', (await transform('page')).zoom > z);
  await tap(await need('page', hook('map-fit-all')));
  // Page scroll: a swipe outside the canvas scrolls the guest page; on the canvas it pans instead.
  await guest('page', `d.scrollingElement.scrollTop=0;return true`); await frames2();
  const header = await need('page', '[data-testid="detail-tabs"]');
  await swipe([header[0], header[1] + 120], [header[0], header[1] - 120], 10);
  const scrolled = await scrollTop('page');
  check('board-page-scrolls-outside-canvas', scrolled > 0, { scrolled });
  // A touch fling keeps scrolling after the finger lifts: let it come to rest first.
  await settle('page');
  await guest('page', `d.querySelector('${viewport}').scrollIntoView({block:'center'});return true`); await settle('page');
  const s1 = await scrollTop('page'), tc = await transform('page');
  const mid = await need('page', viewport);
  await swipe([mid[0], mid[1] + 60], [mid[0], mid[1] - 60], 10);
  const s2 = await scrollTop('page'), tm = await transform('page');
  check('board-canvas-swipe-pans-not-scrolls', s2 === s1 && tm.y < tc.y - 100, { s1, s2, tc, tm });
  // Help: the touch wording is present and the disclosure opens by tap.
  await guest('page', `d.querySelector('${hook('map-help-trigger')}').scrollIntoView({block:'center'});return true`); await settle('page');
  await tap(await need('page', hook('map-help-trigger')));
  const help = await guest<{ open: boolean; touch: boolean }>('page', `return {open:d.querySelector('${hook('map-help')}').open,touch:!!d.querySelector('${hook('map-touch-help')}')}`);
  check('board-help-touch-wording', help.open && help.touch, help);
  await tap(await need('page', hook('map-help-trigger')));
  // Reduced motion: no running animation or transition anywhere in the map after gestures.
  check('board-reduced-motion-still', await guest('page', `return d.getAnimations().filter(a=>a.playState==='running').length===0&&getComputedStyle(d.querySelector('${hook('map-world')}')).transitionDuration==='0s'`));
  // Device hint absent and no coarse media: plain responsive layout, no fabricated phone presentation.
  await withDevice('page', null); await phone('page', false); await ready('page');
  await wait('page', `!d.querySelector('${region}').dataset.pointer`, 'fine media repaint');
  check('board-no-hint-fine-media-not-coarse', await guest('page', `return !d.querySelector('${region}').dataset.pointer&&!d.querySelector('${hook('map-touch-help')}')`) && await noOverflow('page'));

  // ── Dark theme and Russian long labels on the phone board.
  await withDevice('page', DEVICE); await phone('page');
  await evaluate(`qa.theme('dark');true`); await ready('page'); await frames2();
  // Focus current work (after Fit all's overview) returns to full-size, readable cards on a coarse pointer.
  await guest('page', `d.querySelector('${hook('map-focus-current')}').scrollIntoView({block:'center'});return true`); await settle('page');
  await tap(await need('page', hook('map-focus-current')));
  check('board-focus-current-readable', (await transform('page')).zoom >= 1, await transform('page'));
  check('board-dark-no-overflow', await noOverflow('page'));
  await shot('map-dark', 'page');
  await evaluate(`qa.theme('light');qa.locale='ru';qa.ready();true`);
  await wait('page', `d.querySelector('${hook('map-help-trigger')}')?.textContent!=='Map help and definitions'`, 'Russian map');
  await ready('page');
  check('board-russian-no-overflow', await noOverflow('page') && (await smallTargets('page')).length === 0, await smallTargets('page'));
  check('board-russian-touch-help', await guest('page', `return (d.querySelector('${hook('map-touch-help')}')?.textContent??'').startsWith('Касание')`));
  await shot('map-ru', 'page');
  await evaluate(`qa.locale='en';qa.ready();true`); await wait('page', `d.querySelector('${hook('map-help-trigger')}')?.textContent==='Map help and definitions'`, 'English map');

  // ── Rail Map at 390 with touch.
  await phone('panel'); await withDevice('panel', DEVICE);
  await wait('panel', `d.querySelector('${hook('plan-selector')} .oc-sdk-trigger')`, 'rail picker');
  const options = async () => guest<string[]>('panel', `return [...d.querySelectorAll('.oc-sdk-option-label')].map(n=>n.textContent)`);
  await guest('panel', `d.querySelector('${hook('plan-selector')} .oc-sdk-trigger').scrollIntoView({block:'center'});return true`); await settle('panel');
  await tap(await need('panel', `${hook('plan-selector')} .oc-sdk-trigger`));
  await wait('panel', `d.querySelector('.oc-sdk-option-label')`, 'rail options opened by tap');
  const index = (await options()).indexOf('Dependency map fixture');
  if (index < 0) throw new Error('missing rail plan');
  await tap(await need('panel', `.oc-sdk-popup [role="option"]:nth-of-type(${index + 1})`));
  await wait('panel', `d.querySelector('${hook('plan-view-map')} button')`, 'rail Map switch');
  check('rail-switch-44px', await guest('panel', `return [...d.querySelectorAll('${hook('plan-view')} button')].every(n=>n.getBoundingClientRect().height>=44)`));
  await tap(await need('panel', `${hook('plan-view-map')} button`));
  await ready('panel');
  await guest('panel', `d.querySelector('${viewport}').scrollIntoView({block:'center'});return true`); await frames2();
  check('rail-coarse-and-targets', await guest('panel', `return d.querySelector('${region}').dataset.pointer==='coarse'`) && (await smallTargets('panel')).length === 0 && await noOverflow('panel'), await smallTargets('panel'));
  await tap(await need('panel', hook('map-card-B')));
  await wait('panel', `d.querySelector('${inspector}')?.dataset.selected==='B'`, 'rail tap selected');
  const r0 = await transform('panel'), railCard = await need('panel', hook('map-card-B'));
  await swipe(railCard, [railCard[0] + 40, railCard[1] + 30]);
  const r1 = await transform('panel');
  check('rail-finger-pan-keeps-selection', Math.abs(r1.x - r0.x - 40) < 2 && Math.abs(r1.y - r0.y - 30) < 2 && await selected('panel') === 'B', { r0, r1 });
  // View as list by tap returns to the list with the selected task revealed (existing handoff).
  await guest('panel', `d.querySelector('${hook('map-list')}').scrollIntoView({block:'center'});return true`); await frames2();
  await tap(await need('panel', `${hook('map-list')}`));
  await wait('panel', `d.querySelector('${hook('item-B')}')&&!d.querySelector('${region}')`, 'rail list after map');
  check('rail-view-as-list-tap', true);
  await tap(await need('panel', `${hook('plan-view-map')} button`)); await ready('panel');
  await shot('map-rail', 'panel');

  // ── Desktop: mouse and keyboard behaviour unchanged (fine pointer, no touch).
  await withDevice('page', null); await desktop('page'); await ready('page');
  await guest('page', `d.querySelector('${viewport}').scrollIntoView({block:'center'});return true`); await frames2();
  check('desktop-not-coarse', await guest('page', `return !d.querySelector('${region}').dataset.pointer&&getComputedStyle(d.querySelector('${hook('map-zoom-in')}')).height==='28px'`));
  const fitAll = await need('page', hook('map-fit-all'));
  await mouse('mouseMoved', fitAll, 0); await mouse('mousePressed', fitAll); await mouse('mouseReleased', fitAll, 0); await frames2();
  const card = await need('page', hook('map-card-C'));
  await guest('page', `w.__qaDown=[];d.addEventListener('pointerdown',e=>w.__qaDown.push(e.pointerType+':'+(e.target.closest('[data-testid]')?.dataset.testid)),{capture:true});return true`);
  await mouse('mouseMoved', card, 0); await mouse('mousePressed', card); await frames2();
  // Measured after the press: focusing a card may already pan it clear of the canvas edge (existing rule).
  const d0 = await transform('page');
  // Released well off the card (so no click selects it): a mouse drag from a card never pans.
  for (let i = 1; i <= 6; i++) await mouse('mouseMoved', [card[0], card[1] + i * 25]);
  await mouse('mouseReleased', [card[0], card[1] + 150], 0); await frames2();
  const cardDrag = { d0, d1: await transform('page'), down: await guest<string[]>('page', `return w.__qaDown`) };
  check('desktop-card-mouse-drag-does-not-pan', JSON.stringify(cardDrag.d1) === JSON.stringify(d0) && cardDrag.down.join() === 'mouse:map-card-C', cardDrag);
  const bg = await guest<[number, number] | null>('page', `const v=d.querySelector('${viewport}').getBoundingClientRect(),o=w.frameElement.getBoundingClientRect();for(let y=v.top+6;y<v.bottom-6;y+=12)for(let x=v.left+6;x<v.right-6;x+=12){const n=d.elementFromPoint(x,y);if(n&&n.closest('${viewport}')&&!n.closest('button'))return [o.x+x,o.y+y]}return null`);
  if (!bg) throw new Error('no desktop background point');
  const d1 = await transform('page');
  await mouse('mouseMoved', bg, 0); await mouse('mousePressed', bg);
  for (let i = 1; i <= 5; i++) await mouse('mouseMoved', [bg[0] + i * 8, bg[1] + i * 4]);
  await mouse('mouseReleased', [bg[0] + 40, bg[1] + 20], 0); await frames2();
  const d2 = await transform('page');
  check('desktop-background-mouse-drag-pans', Math.abs(d2.x - d1.x - 40) < 2 && Math.abs(d2.y - d1.y - 20) < 2, { d1, d2 });
  await guest('page', `d.querySelector('${hook('map-card-C')}').focus();return true`); await key('Enter');
  await wait('page', `d.querySelector('${inspector}')?.dataset.selected==='C'`, 'keyboard select C');
  await key('ArrowLeft');
  check('desktop-keyboard-navigation', (await selected('page')) !== 'C' && await guest('page', `return d.activeElement?.dataset.task===d.querySelector('${inspector}').dataset.selected`));
  await shot('map-desktop', 'page');
  check('no-page-errors', c.errors.length === 0, c.errors);
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
} finally {
  page?.close();
  if (chrome?.pid) { try { process.kill(-chrome.pid, 'SIGTERM'); } catch { /* already gone */ } }
  await fx?.stop().catch(() => {});
  assets.dispose();
  await new Promise(r => setTimeout(r, 300));
  rmSync(scratch, { recursive: true, force: true });
}
writeFileSync(join(artifacts, 'results.json'), JSON.stringify({ passed: !failure && results.every(r => r.pass), failure, browser: browserVersion, facts, results, screenshots: shots }, null, 2) + '\n');
console.log(JSON.stringify({ passed: !failure, failure, checks: results.length, screenshots: shots }, null, 2));
if (failure) process.exit(1);
