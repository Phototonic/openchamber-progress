// Current-bundle board-search QA in an isolated Chromium (plan V4/V6, browser cases 1–7 and the F3
// races). Starts its own loopback synthetic SDK shell (plan-task-search-shell.ts) over real
// disposable HTTP services and a headless Chromium with a fresh disposable profile, drives real CDP
// pointer/keyboard input, and stops only what it started. Never downloads a browser, attaches to an
// existing one or uses a real profile. Synthetic SDK-shell coverage only: not native-host or relay proof.
// Usage: node --experimental-strip-types tests/browser/plan-task-search-qa.ts --artifacts <dir> [--built-service] [--measure] [--chromium <path>]
//   writes results.json, races.json, requests.json (hard work/request gates) and, with --measure,
//   performance.json (three samples after a warm-up; diagnostic, no latency SLA) plus screenshots.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { PROJECTS, startSearchShell } from './plan-task-search-shell.ts';

const arg = (name: string) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const artifacts = arg('--artifacts');
if (!artifacts) throw new Error('usage: plan-task-search-qa.ts --artifacts <dir> [--built-service] [--measure] [--chromium <path>]');
const built = process.argv.includes('--built-service');
const measure = process.argv.includes('--measure');
/** `--only j1`: just the J1 review cases (detail retirement and retention), for iteration. */
const onlyJ1 = arg('--only') === 'j1';
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
const fx = await startSearchShell(built);
const origin = `http://127.0.0.1:${fx.port}`;
const chrome = spawn(findChromium(), ['--headless=new', '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--disable-sync', '--hide-scrollbars', '--window-size=1280,1100', 'about:blank'], { stdio: 'ignore', detached: true });
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
  const codes: Record<string, number> = { Enter: 13, Tab: 9, ' ': 32, Escape: 27, Home: 36, ArrowDown: 40 };
  const key = async (k: string, times = 1, modifiers = 0) => {
    for (let i = 0; i < times; i++) {
      const text = k === 'Enter' ? { text: '\r', unmodifiedText: '\r' } : k === ' ' ? { text: ' ', unmodifiedText: ' ' } : {};
      await c.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: k === ' ' ? 'Space' : k, modifiers, windowsVirtualKeyCode: codes[k] ?? 0, ...text });
      await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k === ' ' ? 'Space' : k, modifiers, windowsVirtualKeyCode: codes[k] ?? 0 });
    }
  };
  const type = (t: string) => c.send('Input.insertText', { text: t });
  const click = async (f: string, selector: string) => {
    const point = await evaluate<[number, number] | null>(`(()=>{const fr=frame('${f}'),n=fr.contentDocument.querySelector(${JSON.stringify(selector)});if(!n)return null;n.scrollIntoView({block:'center'});const r=n.getBoundingClientRect(),o=fr.getBoundingClientRect();return [o.x+r.x+Math.min(16,r.width/2),o.y+r.y+Math.min(10,r.height/2)]})()`);
    if (!point) throw new Error(`missing ${selector} in ${f}`);
    for (const t of ['mouseMoved', 'mousePressed', 'mouseReleased']) await c.send('Input.dispatchMouseEvent', { type: t, x: point[0], y: point[1], button: 'left', clickCount: 1 });
  };
  const show = async (list: string[], width: number) => { await evaluate(`qa.show(${JSON.stringify(list)},${width});true`); for (const f of list) await wait(f, `w.innerWidth===${width}`, `${f} width ${width}`); };
  const theme = async (mode: 'light' | 'dark') => { await evaluate(`qa.theme('${mode}');true`); await frames2(); };
  const shot = async (name: string, selector = '[data-testid="progress-root"]', pad = 12, height = 1700) => {
    await guest('page', `d.querySelector(${JSON.stringify(selector)})?.scrollIntoView({block:'start'});return true`);
    await frames2();
    const r = await evaluate<number[] | null>(`(()=>{const fr=frame('page'),n=fr.contentDocument.querySelector(${JSON.stringify(selector)});if(!n)return null;const a=n.getBoundingClientRect(),o=fr.getBoundingClientRect();return [o.x+a.x+scrollX,o.y+a.y+scrollY,a.width,a.height]})()`);
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
    await act(`search “${q}”`, async () => { await key('Enter'); await wait('page', `d.querySelector('[data-testid="search-results"]')?.dataset.run!==${JSON.stringify(prev)}`, `new run for ${q}`); });
    if (all) await exhaust();
  };
  const overflow = () => guest<boolean>('page', `return d.documentElement.scrollWidth<=w.innerWidth+1`);
  const setHidden = (hidden: boolean) => guest('page', hidden
    ? `Object.defineProperty(d,'visibilityState',{configurable:true,get:()=>'hidden'});d.dispatchEvent(new Event('visibilitychange'));return true`
    : `delete d.visibilityState;d.dispatchEvent(new Event('visibilitychange'));return true`);
  const instrument = () => guest('page', `if(w.__paints)return true;w.__paints=[];const mount=d.getElementById('root'),orig=w.queueMicrotask.bind(w);w.queueMicrotask=fn=>orig(()=>{const before=mount.firstElementChild,t0=w.performance.now();fn();if(mount.firstElementChild!==before)w.__paints.push(w.performance.now()-t0)});return true`);
  const paints = () => guest<number[]>('page', `return (w.__paints??[]).splice(0)`);
  const pageErrors = () => c.events.map((e) => String(e.params.exceptionDetails?.exception?.description ?? e.params.args?.map((a: any) => a.value ?? a.description).join(' ') ?? '').split('\n')[0].slice(0, 160));
  const T = (plan: string, item: string, source = 'source-alpha') => `[data-testid="search-task-${source}/${plan}/${item}"]`;
  const H = (plan: string, source = 'source-alpha') => `[data-testid="search-plan-${source}/${plan}"]`;

  await show(['page', 'panel', 'status'], 1100);
  await wait('page', `d.querySelector('[data-testid="search-form"]')&&d.querySelector('[data-testid="plan-list"]')`, 'board with search form');
  await wait('panel', `d.querySelector('[data-testid="progress-root"]')`, 'rail');
  await show(['page'], 1100);
  await theme('light');
  await instrument();
  const storageMark = await now();

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
  await guest('page', `d.activeElement?.blur();w.focus();return true`);
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
  await evaluate(`qa.setProjects(${JSON.stringify(PROJECTS.filter((p) => p.id !== 'alpha'))});true`);
  await wait('page', `d.querySelector('[data-testid="search-status"]')?.dataset.stop==='membership'`, 'membership change retires the narrowed search');
  await click('page', '[data-testid="search-refresh"] button');
  await wait('page', `d.querySelector('[data-testid="search-blocked"]')?.dataset.reason==='missing'`, 'unavailable project blocks');
  check('A6:unavailable-choice-kept', await guest<boolean>('page', `return d.querySelector('[data-testid="search-chip-project"]')?.dataset.available==='false'&&!!d.querySelector('[data-testid="search-remove-location"]')`));
  await shot('search-unavailable-scope');
  await evaluate(`qa.setProjects(${JSON.stringify(PROJECTS)});qa.setSessions('alpha',[]);true`);
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
    for (const s of ['session-a', 'session-b', null]) { await evaluate(`qa.context(${JSON.stringify(s)});true`); await sleep(300); }
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
  page?.close(); browser?.close();
  const exited = new Promise((r) => { if (chrome.exitCode !== null) r(null); else chrome.once('exit', r); });
  try { process.kill(-chrome.pid!, 'SIGTERM'); } catch { chrome.kill('SIGTERM'); }
  await exited;
  await fx.stop();
  const evidenceClass = `synthetic SDK shell, real disposable HTTP services over SQLite (${built ? 'built generated service' : 'current TypeScript service'}), isolated headless Linux Chromium, current guest bundles`;
  const environment = { evidenceClass, browser: browserVersion, reducedMotion: true, nativeHostProof: false };
  const passed = !failure && results.every((r) => r.pass) && races.every((r) => r.pass);
  writeFileSync(join(artifacts, 'results.json'), `${JSON.stringify({ ...environment, passed, failure, assertions: results.length, results, facts, screenshots: shots }, null, 2)}\n`);
  writeFileSync(join(artifacts, 'races.json'), `${JSON.stringify({ ...environment, passed: !failure && races.every((r) => r.pass), assertions: races.length, results: races, note: 'Held replies, failures, capability strip, account/store switches and visibility are labelled shell seams.' }, null, 2)}\n`);
  const windowSummary = replies.filter((r) => r.path === '/v1/search').map((r) => ({ status: r.status, continuation: r.cursor, hits: r.hits ?? null, bytes: r.bytes, ms: Math.round(r.ms * 10) / 10, work: r.work ?? null }));
  const stateSummary = replies.filter((r) => r.path === '/v1/search-state').map((r) => ({ status: r.status, keys: r.keys, bytes: r.bytes, ms: Math.round(r.ms * 10) / 10 }));
  const serviceMs = windowSummary.filter((w) => w.status === 200).map((w) => w.ms);
  writeFileSync(join(artifacts, 'requests.json'), `${JSON.stringify({ ...environment, passed: gates.every((g) => g.pass) && !failure, gates, actions, searchWindows: { count: windowSummary.length, serviceRoundTripMs: serviceMs.length ? stats(serviceMs) : null, windows: windowSummary }, freshnessReads: { count: stateSummary.length, reads: stateSummary } }, null, 2)}\n`);
  if (measure) writeFileSync(join(artifacts, 'performance.json'), `${JSON.stringify({ ...environment, mode: 'candidate-search', passed, failure, measurements: perf, note: 'Three samples after one warm-up; diagnostic on one machine, no latency SLA. Work/request limits are in requests.json.' }, null, 2)}\n`);
  console.log(JSON.stringify({ passed, assertions: results.length, races: races.length, gates: gates.length, failure, screenshots: shots }, null, 2));
  if (!passed) process.exitCode = 1;
  rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
