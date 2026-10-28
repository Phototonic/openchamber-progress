// Current-bundle Needs-you QA in an isolated Chromium (plan rows V3 and V4). Starts its own loopback
// synthetic SDK shell (needs-you-shell.ts) over the real disposable needs-you fixture service and a
// headless Chromium with a fresh disposable profile, drives real CDP pointer/keyboard input, and
// stops only what it started. Never downloads a browser, attaches to an existing one or uses a real
// profile. Synthetic SDK-shell coverage only: not native-host or relay proof.
// Usage: node --experimental-strip-types tests/browser/needs-you-qa.ts --artifacts <dir> [--built-service] [--chromium <path>]
//   writes results.json (V3), races.json (V4), requests.json (bounded request metadata) and screenshots.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { startNeedsYouShell } from './needs-you-shell.ts';

const arg = (name: string) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const artifacts = arg('--artifacts');
if (!artifacts) throw new Error('usage: needs-you-qa.ts --artifacts <dir> [--built-service] [--chromium <path>]');
const built = process.argv.includes('--built-service');
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

type Result = { id: string; pass: boolean; facts?: unknown };
const results: Result[] = [];
const races: Result[] = [];
const findings: { id: string; owner: string; observed: unknown; expected: string }[] = [];
const shots: string[] = [];
const failures: string[] = [];
function check(id: string, pass: boolean, facts?: unknown, into = results) {
  into.push({ id, pass, ...(facts === undefined ? {} : { facts }) });
  if (!pass) throw new Error(`${id} failed${facts === undefined ? '' : `: ${JSON.stringify(facts).slice(0, 900)}`}`);
}
const race = (id: string, pass: boolean, facts?: unknown) => check(id, pass, facts, races);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

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

// Records any attempt at a notification or permission prompt in every frame (V4: in-app only).
const ALERT_HOOK = `(()=>{const log=[];Object.defineProperty(window,'__qaAlerts',{value:log});
try{if(window.Notification){const N=window.Notification;const W=function(...a){log.push('notification');return new N(...a)};W.requestPermission=(...a)=>{log.push('requestPermission');return N.requestPermission(...a)};Object.defineProperty(W,'permission',{get:()=>N.permission});window.Notification=W}}catch{}
try{const q=navigator.permissions&&navigator.permissions.query&&navigator.permissions.query.bind(navigator.permissions);if(q)navigator.permissions.query=d=>{log.push('permissions.query:'+(d&&d.name));return q(d)}}catch{}
try{const r=navigator.serviceWorker&&navigator.serviceWorker.register&&navigator.serviceWorker.register.bind(navigator.serviceWorker);if(r)navigator.serviceWorker.register=(...a)=>{log.push('serviceWorker');return r(...a)}}catch{}})()`;

mkdirSync('/tmp/opencode', { recursive: true });
const profile = mkdtempSync('/tmp/opencode/needs-you-qa-');
const fx = await startNeedsYouShell(built);
const origin = `http://127.0.0.1:${fx.port}`;
const chrome = spawn(findChromium(), ['--headless=new', '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--disable-sync', '--hide-scrollbars', '--window-size=1280,1100', 'about:blank'], { stdio: 'ignore', detached: true });
let page: Cdp | null = null;
let browserVersion = '';
let requestLog: any[] = [];
let subsLog: any[] = [];
try {
  let devtools = '';
  for (const end = Date.now() + 15_000; Date.now() < end && !devtools;) {
    const f = join(profile, 'DevToolsActivePort');
    if (existsSync(f)) devtools = readFileSync(f, 'utf8').split('\n')[0];
    else await new Promise((r) => setTimeout(r, 100));
  }
  if (!devtools) throw new Error('Chromium did not start its DevTools endpoint.');
  browserVersion = (await (await fetch(`http://127.0.0.1:${devtools}/json/version`)).json() as { Browser: string }).Browser;
  const targets = await (await fetch(`http://127.0.0.1:${devtools}/json/list`)).json() as { type: string; webSocketDebuggerUrl: string }[];
  page = await connect(targets.find((t) => t.type === 'page')!.webSocketDebuggerUrl);
  const c = page;
  await c.send('Runtime.enable'); await c.send('Page.enable');
  await c.send('Page.addScriptToEvaluateOnNewDocument', { source: ALERT_HOOK });
  await c.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await c.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await c.send('Page.navigate', { url: `${origin}/` });

  const evaluate = async <T = any>(expression: string): Promise<T> => {
    const r = await c.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value as T;
  };
  const guest = <T = any>(f: string, code: string) => evaluate<T>(`(()=>{const w=frame('${f}').contentWindow,d=w.document;${code}})()`);
  /** Polls on animation frames until `cond` holds (observed state, never a fixed sleep). */
  const wait = async (f: string, cond: string, what = cond, ms = 20_000) => {
    const ok = await evaluate<boolean>(`(async()=>{const end=performance.now()+${ms};while(performance.now()<end){try{const w=frame('${f}').contentWindow,d=w.document;if(${cond})return true}catch{}await new Promise(r=>requestAnimationFrame(r));}return false})()`);
    if (!ok) throw new Error(`timed out waiting (${f}): ${what}`);
  };
  const waitTop = async (cond: string, what = cond, ms = 20_000) => {
    const ok = await evaluate<boolean>(`(async()=>{const end=performance.now()+${ms};while(performance.now()<end){try{if(${cond})return true}catch{}await new Promise(r=>requestAnimationFrame(r));}return false})()`);
    if (!ok) throw new Error(`timed out waiting: ${what}`);
  };
  const frames2 = () => evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  const codes: Record<string, number> = { Enter: 13, Tab: 9, ' ': 32, Escape: 27, Home: 36, ArrowDown: 40 };
  const key = async (k: string, times = 1) => {
    for (let i = 0; i < times; i++) {
      const text = k === 'Enter' ? { text: '\r', unmodifiedText: '\r' } : k === ' ' ? { text: ' ', unmodifiedText: ' ' } : {};
      await c.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: k === ' ' ? 'Space' : k, windowsVirtualKeyCode: codes[k] ?? 0, ...text });
      await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k === ' ' ? 'Space' : k, windowsVirtualKeyCode: codes[k] ?? 0 });
    }
  };
  const click = async (f: string, selector: string) => {
    const point = await evaluate<[number, number] | null>(`(()=>{const fr=frame('${f}'),n=fr.contentDocument.querySelector(${JSON.stringify(selector)});if(!n)return null;n.scrollIntoView({block:'center'});fr.scrollIntoView({block:'nearest'});const r=n.getBoundingClientRect(),o=fr.getBoundingClientRect();return [o.x+r.x+Math.min(16,r.width/2),o.y+r.y+Math.min(10,r.height/2)]})()`);
    if (!point) throw new Error(`missing ${selector} in ${f}`);
    for (const t of ['mouseMoved', 'mousePressed', 'mouseReleased']) await c.send('Input.dispatchMouseEvent', { type: t, x: point[0], y: point[1], button: 'left', clickCount: 1 });
  };
  const show = async (list: string[], width: number) => { await evaluate(`qa.show(${JSON.stringify(list)},${width});true`); for (const f of list) await wait(f, `w.innerWidth===${width}`, `${f} width ${width}`); };
  const theme = async (mode: 'light' | 'dark') => { await evaluate(`qa.theme('${mode}');true`); await frames2(); };
  const context = async (id: string | null) => { await evaluate(`qa.context(${JSON.stringify(id)});true`); };
  /** Element screenshot (union of selectors) of frame `f`, page coordinates, beyond the viewport. */
  const shot = async (f: string, name: string, selectors: string[], pad = 10) => {
    await guest(f, `d.querySelector(${JSON.stringify(selectors[0])})?.scrollIntoView({block:'start'});return true`);
    await frames2();
    const r = await evaluate<number[] | null>(`(()=>{const fr=frame('${f}'),o=fr.getBoundingClientRect(),rs=${JSON.stringify(selectors)}.map(s=>fr.contentDocument.querySelector(s)).filter(Boolean).map(n=>n.getBoundingClientRect());if(!rs.length)return null;const x=Math.min(...rs.map(a=>a.left)),y=Math.min(...rs.map(a=>a.top)),x2=Math.max(...rs.map(a=>a.right)),y2=Math.max(...rs.map(a=>a.bottom));return [o.x+x+scrollX,o.y+y+scrollY,x2-x,y2-y]})()`);
    if (!r) throw new Error(`no ${selectors.join(',')} to capture in ${f}`);
    const png = await c.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: Math.max(0, r[0] - pad), y: Math.max(0, r[1] - pad), width: r[2] + 2 * pad, height: Math.min(r[3] + 2 * pad, 4000), scale: 1 } });
    writeFileSync(join(artifacts, `${name}.png`), Buffer.from(png.data, 'base64'));
    shots.push(`${name}.png`);
  };
  const requests = (filter = 'true') => evaluate<any[]>(`qa.requests.filter(q=>${filter})`);
  const count = async () => (await requests()).length;
  /** Waits until frame `f` has issued `n` more list polls after `mark`: a whole refresh cycle passed. */
  const polls = async (f: string, mark: number, n = 2, ms = 25_000) => waitTop(`qa.requests.slice(${mark}).filter(q=>q.frame==='${f}'&&q.path==='/v1/plans').length>=${n}`, `${n} ${f} list polls`, ms);
  const pick = async (f: string, holder: string, text: string) => {
    await click(f, `${holder} button`);
    await wait(f, `d.querySelector('[role="listbox"]')`, `${holder} listbox`);
    const idx = await guest<number>(f, `return [...d.querySelectorAll('[role="listbox"] [role="option"]')].findIndex(o=>o.textContent.includes(${JSON.stringify(text)}))`);
    if (idx < 0) throw new Error(`no option "${text}" in ${holder}`);
    await key('Home'); await key('ArrowDown', idx); await key('Enter');
  };
  /** Rail: show the plan whose title contains `title` (SDK picker when the session has several). */
  const railPlan = async (id: string, title: string) => {
    await wait('panel', `d.querySelector('article.ap-plan')`, 'rail plan');
    for (let attempt = 0; !(await guest<boolean>('panel', `return !!d.querySelector('article[data-testid="plan-${id}"][data-source="source-fixture"]')`)); attempt++) {
      try { await pick('panel', '[data-testid="plan-selector"]', title); break; } catch (e) {
        // A plan reported moments ago appears after the rail's next list read.
        if (attempt >= 3) throw e;
        await key('Escape'); await polls('panel', await count(), 1);
      }
    }
    await wait('panel', `d.querySelector('article[data-testid="plan-${id}"][data-source="source-fixture"] .ap-tasks[data-complete]')`, `rail ${id} complete`);
  };
  const ART = (id = 'P-attention', source = 'source-fixture') => `article[data-testid="plan-${id}"][data-source="${source}"]`;
  const NY = (id = 'P-attention', source = 'source-fixture') => `${ART(id, source)} [data-testid="needs-you"]`;
  const rows = (f: string, id = 'P-attention', source = 'source-fixture') => guest<string[]>(f, `return [...d.querySelectorAll('${NY(id, source)} [data-testid^="readiness-entry-"]')].map(e=>e.dataset.item)`);
  const facts = (f: string, item: string, id = 'P-attention', source = 'source-fixture') => guest<any>(f, `const e=d.querySelector('${NY(id, source)} [data-testid="readiness-entry-${item}"]');if(!e)return null;const q=s=>e.querySelector('[data-testid="'+s+'-${item}"]');const dd=s=>{const n=q(s);return n?{text:n.textContent,unknown:n.hasAttribute('data-unknown'),elements:n.children.length}:null};const t=q('blocked-elapsed');return {group:e.dataset.group,assignment:e.dataset.assignment,category:q('needs-you-category')?.dataset.category,categoryText:q('needs-you-category')?.textContent,details:q('needs-you-facts')?.dataset.details,reason:dd('needs-you-reason'),next:dd('needs-you-next'),invalid:dd('needs-you-details'),wait:t?{kind:t.dataset.kind,timing:t.dataset.timing,text:t.textContent,title:t.title,tag:t.tagName,elapsed:t.dataset.elapsed,received:t.dataset.received}:null,source:q('needs-you-source')?{mode:q('needs-you-source').dataset.blockerReport,text:q('needs-you-source').textContent}:null,reports:[...e.querySelectorAll('[data-report]')].map(x=>x.dataset.report+':'+x.textContent),meta:e.querySelector('.ap-ready-meta')?.textContent??'',button:e.querySelector('.ap-ready-head button')?.getAttribute('aria-label')}`);
  const noOverflow = (f: string, scope: string) => guest<{ ok: boolean; sw: number; cw: number; out: string[] }>(f, `const cw=d.documentElement.clientWidth,sw=d.documentElement.scrollWidth,out=[...d.querySelectorAll('${scope} *')].filter(n=>{const r=n.getBoundingClientRect();return r.width>0&&(r.right>cw+0.5||r.left<-0.5)}).map(n=>n.dataset.testid||n.className||n.tagName).slice(0,8);return {ok:sw<=cw&&!out.length,sw,cw,out}`);
  const neutral = () => fx.report({ op: 'revise', title: `Reported waits ${Date.now() % 100_000}` });

  await waitTop(`window.qa&&frame('page').contentDocument?.querySelector('[data-testid="progress-root"]')`, 'shell and board ready', 30_000);
  check('V3:reduced-motion-emulated', await guest('panel', `return w.matchMedia('(prefers-reduced-motion: reduce)').matches`));
  check('V4:alert-hook-installed-in-every-frame', await evaluate<boolean>(`['page','panel','status'].every(f=>Array.isArray(frame(f).contentWindow.__qaAlerts))`));

  // ================================================================ V3 rendering and interaction
  try {
    await theme('light');
    await show(['panel'], 360);
    await context('M');
    await railPlan('P-attention', 'Reported waits');
    await wait('panel', `d.querySelector('${NY()}[data-count="6"]')`, 'Needs you · 6');
    check('V3:rail-placement-inside-readiness', await guest<boolean>('panel', `const r=d.querySelector('${ART()} [data-testid="readiness"]'),n=d.querySelector('${NY()}');return !!r&&r.contains(n)&&r.dataset.state==='ready'&&n.querySelector('h4').textContent==='Needs you · 6'&&r.querySelector('h3').textContent==='Readiness'&&[...r.children].indexOf(n)<[...r.children].indexOf(r.querySelector('[data-testid="readiness-ready"]'))`));
    const order = await rows('panel');
    check('V3:one-row-per-blocked-task-stored-order', same(order, ['decision', 'dependency', 'review', 'external', 'other', 'unknown']), order);
    check('V3:no-duplicate-ids-no-canonical-rows-in-readiness', await guest<boolean>('panel', `const ids=[...d.querySelectorAll('[data-testid]')].map(n=>n.dataset.testid).filter(t=>t.startsWith('readiness-entry-')||t.startsWith('item-'));return new Set(ids).size===ids.length&&![...d.querySelectorAll('[data-testid^="item-"]')].some(n=>n.closest('[data-testid="readiness"]'))&&d.querySelectorAll('[data-testid="item-decision"]').length===1`));
    check('V3:prerequisite-wait-not-a-blocker', await guest<boolean>('panel', `return d.querySelector('[data-testid="readiness-entry-prerequisite-wait"]')?.dataset.group==='waiting'`));
    const F: Record<string, any> = {};
    for (const id of order) F[id] = await facts('panel', id);
    check('V3:category-labels', same(order.map((id) => `${F[id].category}:${F[id].categoryText}`), ['decision:Wait category: Decision', 'dependency:Wait category: Dependency', 'review:Wait category: Review', 'external:Wait category: External', 'other:Wait category: Other', 'unknown:Wait category: Category unknown']), order.map((id) => F[id].categoryText));
    check('V3:reason-and-next-action', same([F.decision.reason.text, F.decision.next.text, F.dependency.reason.text, F.dependency.next.text, F.review.reason.text, F.review.next.text], ['Choose an output format', 'Select CSV or JSON', 'Input is not yet available', 'Unknown', 'Unknown', 'Review the format proposal']), F);
    check('V3:explicit-unknowns', F.dependency.next.unknown && F.review.reason.unknown && F.other.reason.unknown && F.other.next.unknown && F.unknown.reason.unknown && F.unknown.next.unknown && F.unknown.details === 'unknown' && !F.decision.reason.unknown && F.decision.details === 'reported', F);
    const muted = await guest<any>('panel', `const u=d.querySelector('[data-testid="needs-you-next-dependency"]'),k=d.querySelector('[data-testid="needs-you-reason-dependency"]'),cu=getComputedStyle(u),ck=getComputedStyle(k);return {unknownColor:cu.color,knownColor:ck.color,style:cu.fontStyle,dt:getComputedStyle(u.previousElementSibling).color}`);
    check('V3:unknown-is-muted', muted.unknownColor !== muted.knownColor && muted.style === 'italic', muted);
    const literal = await guest<any>('panel', `const n=d.querySelector('[data-testid="needs-you-reason-external"]');return {text:n.textContent,elements:n.querySelectorAll('*').length,bold:!!d.querySelector('[data-testid="needs-you"] b:not(.ap-ready-who b)')}`);
    check('V3:html-looking-reason-is-literal-text', literal.text === '<b>Awaiting sample input</b>' && literal.elements === 0, literal);
    const remote = await evaluate<string[]>(`['page','panel','status'].flatMap(f=>{const w=frame(f).contentWindow;return w.performance.getEntriesByType('resource').map(e=>e.name).filter(n=>!n.startsWith(w.location.origin))})`);
    check('V3:no-remote-asset-loads', remote.length === 0 && await guest<boolean>('panel', `return !d.querySelector('[data-testid="needs-you"] img,[data-testid="needs-you"] script,[data-testid="needs-you"] iframe')`), remote);
    check('V3:assignment-recorded-only', F.decision.assignment === 'other' && /Assigned to Helper session/.test(F.decision.meta) && F.review.assignment === 'none' && F.review.meta.includes('No assignee recorded'), [F.decision.meta, F.review.meta]);
    check('V3:details-provenance-separate-from-relay-history', F.decision.source?.mode === 'direct' && F.decision.source.text === 'Details reported directly by Planner session'
      && F.decision.reports.includes('parent-relay:Reported by Planner session for Helper session') && F.decision.reports.includes('direct:Reported directly by Helper session') && F.unknown.source === null, F.decision);
    check('V3:reporter-fallback-labelled', F.review.reports.includes('reporter:Last reported by Planner session · report mode unavailable'), F.review.reports);
    const exact = order.map((id) => F[id].wait);
    check('V3:exact-waits', exact.every((w) => w.kind === 'exact' && w.timing === 'exact' && w.tag === 'TIME' && /^\d+ h( \d+ min)?$/.test(w.text) && /^Reported blocked at .+\. Counts reported status, not activity\.$/.test(w.title) && Number(w.elapsed) > 170 * 60_000 && Number(w.elapsed) < 200 * 60_000), exact);
    check('V3:wait-label-context', await guest<boolean>('panel', `return d.querySelector('[data-testid="needs-you-wait-decision"]').previousElementSibling.textContent==='Reported wait'`));
    const openSession = await guest<boolean>('panel', `return !!d.querySelector('${ART()} [data-testid="open-session-C"]')`);
    check('V3:source-verified-open-session-unchanged', openSession);
    await shot('panel', 'reasons-and-attribution', [NY()]);
    await shot('panel', 'reported-waiting', [`${NY()} [data-testid="readiness-entry-decision"]`, `${NY()} [data-testid="readiness-entry-dependency"]`]);

    // Displayed elapsed = service anchor + monotonic time since receipt; never browser wall time.
    const anchor = await guest<any>('panel', `const t=d.querySelector('[data-testid="blocked-elapsed-decision"]');return {e:t.dataset.elapsed,r:t.dataset.received,text:t.textContent,mono:w.performance.now()}`);
    const expectText = (ms: number) => { const m = Math.floor(ms / 60_000); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`; };
    check('V3:elapsed-from-anchor', [expectText(Number(anchor.e) + anchor.mono - Number(anchor.r)), expectText(Number(anchor.e))].includes(anchor.text), anchor);
    // Clock skew (+7 days in the guest) and a repaint (theme): same anchor.
    await guest('panel', `w.__realNow=w.Date.now;w.Date.now=()=>w.__realNow()+7*86400000;return true`);
    await theme('dark'); await theme('light');
    await wait('panel', `d.querySelector('[data-testid="blocked-elapsed-decision"]')`);
    const skew = await guest<any>('panel', `const t=d.querySelector('[data-testid="blocked-elapsed-decision"]');return {e:t.dataset.elapsed,r:t.dataset.received,text:t.textContent}`);
    await guest('panel', `w.Date.now=w.__realNow;return true`);
    check('V3:clock-skew-and-repaint-keep-anchor', skew.e === anchor.e && skew.r === anchor.r && skew.text.endsWith('min') === anchor.text.endsWith('min'), { anchor, skew });

    // Work Status gains no section or waiting label.
    await show(['status'], 360);
    await wait('status', `d.querySelector('[data-testid="counts"]')`, 'Work Status');
    check('V3:work-status-unchanged', await guest<boolean>('status', `return !d.querySelector('[data-testid="needs-you"],[data-testid^="blocked-elapsed-"],[data-testid="readiness"]')&&!d.body.textContent.includes('Needs you')&&!d.body.textContent.includes('Reported wait')`));

    // Unusable details (labelled older/odd-service seam) and unknown details together.
    await show(['panel'], 360);
    await evaluate(`qa.edits.malform='other';true`);
    const rev1 = neutral();
    await wait('panel', `d.querySelector('${ART()}')?.dataset.revision==='${rev1}'&&d.querySelector('[data-testid="needs-you-facts-other"]')?.dataset.details==='invalid'`, 'invalid details');
    const bad = await facts('panel', 'other');
    check('V3:unusable-details-fixed-line', bad.invalid?.text === 'Reported details couldn’t be read' && bad.invalid.unknown && !bad.reason && !bad.next && bad.categoryText === 'Wait category: Category unknown' && bad.wait.kind === 'exact', bad);
    check('V3:unusable-text-not-rendered', await guest<boolean>('panel', `const e=d.querySelector('[data-testid="readiness-entry-other"]');return !e.querySelector('[data-testid="needs-you-source-other"]')`));
    await shot('panel', 'unknown', [`${NY()} [data-testid="readiness-entry-other"]`, `${NY()} [data-testid="readiness-entry-unknown"]`]);
    await evaluate(`qa.edits.malform=null;true`);

    // Older service without blocked timing: every wait "Unavailable", never zero.
    await evaluate(`qa.edits.stripBlockedTiming=true;true`);
    const rev2 = neutral();
    await wait('panel', `d.querySelector('${ART()}')?.dataset.revision==='${rev2}'&&d.querySelector('[data-testid="blocked-elapsed-decision"]')?.dataset.timing==='unavailable'`, 'unavailable timing');
    const unavailable = await guest<string[]>('panel', `return [...d.querySelectorAll('${NY()} [data-testid^="blocked-elapsed-"]')].map(t=>t.dataset.kind+'/'+t.dataset.timing+'/'+t.textContent+'/'+t.tagName)`);
    check('V3:unavailable-wait', unavailable.length === 6 && unavailable.every((x) => x === 'unknown/unavailable/Unavailable/SPAN'), unavailable);
    await shot('panel', 'reported-waiting-unavailable', [`${NY()} [data-testid="readiness-entry-decision"]`]);
    await evaluate(`qa.edits.stripBlockedTiming=false;true`);
    const rev3 = neutral();
    await wait('panel', `d.querySelector('${ART()}')?.dataset.revision==='${rev3}'&&d.querySelector('[data-testid="blocked-elapsed-decision"]')?.dataset.kind==='exact'`, 'timing back');

    // Lower-bound and unknown plans, through the rail's plan picker.
    await railPlan('P-lower', 'Capped reported wait');
    const lower = await facts('panel', 'decision', 'P-lower');
    check('V3:lower-bound-wait', lower.wait.kind === 'lower-bound' && /^at least \d+ h( \d+ min)?$/.test(lower.wait.text) && /^Already reported blocked at .+; the start is earlier and unknown\.$/.test(lower.wait.title), lower.wait);
    await shot('panel', 'reported-waiting-lower-bound', [`${NY('P-lower')} [data-testid="readiness-entry-decision"]`]);
    await railPlan('P-unknown', 'Incomplete reported history');
    const unknownWait = await facts('panel', 'decision', 'P-unknown');
    check('V3:unknown-wait', unknownWait.wait.kind === 'unknown' && unknownWait.wait.timing === 'unknown' && unknownWait.wait.text === 'Unknown' && unknownWait.wait.tag === 'SPAN' && unknownWait.wait.title === 'The progress service couldn’t tell when this task was reported blocked.', unknownWait.wait);
    await shot('panel', 'reported-waiting-unknown', [`${NY('P-unknown')} [data-testid="readiness-entry-decision"]`]);
    await railPlan('P-attention', 'Reported waits');
    await wait('panel', `d.querySelector('${NY()}[data-count="6"]')`);

    // Keyboard: hide decision behind a participant filter and a collapsed ancestor, then Enter on its row.
    await click('panel', `${ART()} [data-testid="group-toggle-group"] > summary`);
    await wait('panel', `!d.querySelector('[data-testid="group-toggle-group"]').open`, 'group collapsed');
    await pick('panel', `${ART()} [data-testid="focus-participant"]`, 'No participant recorded');
    await wait('panel', `d.querySelector('[data-testid="focus-participant"]')?.dataset.participant==='none'&&d.querySelector('[data-testid="item-decision"]').closest('[hidden]')`, 'decision hidden by filter');
    const navMark = await count();
    await guest('panel', `w.focus();d.querySelector('[data-testid="readiness-entry-decision"] .ap-ready-head button').focus();return true`);
    check('V3:show-task-button-named', await guest<string>('panel', `return d.activeElement.getAttribute('aria-label')`) === 'Show task: Choose format');
    await key('Enter');
    await wait('panel', `d.activeElement?.dataset.testid==='item-decision'`, 'focus lands on canonical decision');
    const landed = await guest<any>('panel', `const n=d.activeElement,r=n.getBoundingClientRect();return {filter:d.querySelector('[data-testid="focus-participant"]').dataset.participant,open:d.querySelector('[data-testid="group-toggle-group"]').open,hidden:!!n.closest('[hidden]'),inView:r.top>=0&&r.bottom<=w.innerHeight,ring:getComputedStyle(n).boxShadow!=='none',notice:d.querySelector('[data-testid="focus-notice"]').textContent,animations:d.getAnimations().length}`);
    check('V3:keyboard-reveal-focuses-canonical-row', landed.filter === 'all' && landed.open && !landed.hidden && landed.inView && landed.ring && landed.notice.startsWith('Showing all tasks so this task is visible.'), landed);
    check('V3:reduced-motion-no-animations', landed.animations === 0, landed);
    await frames2();
    {
      const r = await evaluate<number[]>(`(()=>{const r=document.querySelector('section[data-frame="panel"]').getBoundingClientRect();return [r.x+scrollX,r.y+scrollY,r.width,Math.min(r.height,1100)]})()`);
      const fr = await guest<number>('panel', `return d.activeElement.getBoundingClientRect().top`);
      const png = await c.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: r[0], y: r[1] + Math.max(0, fr - 300), width: r[2], height: 700, scale: 1 } });
      writeFileSync(join(artifacts, 'keyboard-target.png'), Buffer.from(png.data, 'base64')); shots.push('keyboard-target.png');
    }
    // Space on another row reveals too; navigation sends nothing and opens no session.
    await guest('panel', `d.querySelector('[data-testid="readiness-entry-review"] .ap-ready-head button').focus();return true`);
    await key(' ');
    await wait('panel', `d.activeElement?.dataset.testid==='item-review'`, 'Space reveals review');
    const navReqs = (await requests()).slice(navMark).filter((q) => q.frame === 'panel' && q.path !== '/v1/plans' && q.path !== '/health');
    check('V3:navigation-sends-nothing', navReqs.length === 0 && !(await evaluate<boolean>(`qa.messages.some(m=>m.type==='open-session')`)), navReqs);

    // Focus stability across a same-revision repaint (live session state of the assignee changes).
    await guest('panel', `d.querySelector('[data-testid="readiness-entry-dependency"] .ap-ready-head button').focus();w.__qaRoot=d.querySelector('[data-testid="progress-root"]');return true`);
    const activity = await evaluate<string>(`qa.pulse()`);
    await wait('panel', `d.querySelector('[data-testid="progress-root"]')!==w.__qaRoot`, 'same-revision repaint');
    void activity;
    await frames2();
    const kept = await guest<any>('panel', `return {label:d.activeElement?.getAttribute('aria-label')??null,tag:d.activeElement?.tagName,repainted:d.querySelector('[data-testid="progress-root"]')!==w.__qaRoot}`);
    check('V3:focus-stable-across-same-revision-repaint', kept.repainted && kept.label === 'Show task: Wait for input', kept);
    await evaluate(`qa.pulse()`);
    // A new revision repaints readiness through its loading state first (pre-existing): observed, not asserted.
    await guest('panel', `d.querySelector('[data-testid="readiness-entry-dependency"] .ap-ready-head button').focus();return true`);
    const rev4 = neutral();
    await wait('panel', `d.querySelector('${ART()}')?.dataset.revision==='${rev4}'&&d.querySelector('${ART()} .ap-tasks[data-complete]')`, 'repaint at new revision');
    await frames2();
    const lost = await guest<any>('panel', `return {label:d.activeElement?.getAttribute('aria-label')??null,tag:d.activeElement?.tagName}`);
    results.push({ id: 'V3:focus-across-revision-change-observed', pass: true, facts: lost });
    if (lost.label !== 'Show task: Wait for input') findings.push({ id: 'V3:readiness-focus-lost-on-new-revision', owner: 'N2 (pre-existing readiness behaviour, not introduced by Needs you)', observed: lost, expected: 'docs/ui.md readiness: "Refreshes never move focus." A new revision paints readiness as loading, the focused Show task button disappears and focus falls to the document body.' });

    // Board: plan row, then the Progress tab; same integrated section; pointer activation.
    await show(['page'], 1100);
    await click('page', `[data-testid="plan-row-P-attention"][data-source="source-fixture"]`);
    if (await guest<boolean>('page', `return !!d.querySelector('[role="tab"][data-id="progress"]')`)) await click('page', `[role="tab"][data-id="progress"]`);
    await wait('page', `d.querySelector('${NY()}[data-count="6"]')`, 'board Needs you');
    check('V3:board-progress-same-rows', same(await rows('page'), order), await rows('page'));
    const bd = await facts('page', 'decision');
    check('V3:board-neutral-assignee-same-details', bd.assignment === 'other' && bd.reason.text === 'Choose an output format' && bd.wait.kind === 'exact', bd);
    await click('page', `${NY()} [data-testid="readiness-entry-decision"] .ap-ready-head button`);
    await wait('page', `d.activeElement?.dataset.testid==='item-decision'`, 'board pointer reveal');
    results.push({ id: 'V3:board-pointer-reveal', pass: true });
    await shot('page', 'board-progress', [NY()]);
    check('V3:board-1100-no-overflow', (await noOverflow('page', NY())).ok, await noOverflow('page', NY()));

    // 360px dark rail and board, 200% reflow, light/dark tokens.
    await theme('dark');
    await show(['panel'], 360);
    await wait('panel', `d.querySelector('${NY()}[data-count="6"]')`);
    const ov = await noOverflow('panel', NY());
    check('V3:rail-360-dark-no-overflow', ov.ok, ov);
    const darkColors = await guest<any>('panel', `const n=d.querySelector('[data-testid="needs-you-reason-decision"]');return {fg:getComputedStyle(n).color,bg:getComputedStyle(d.body).backgroundColor}`);
    check('V3:dark-tokens-applied', darkColors.fg !== 'rgb(32, 33, 36)' && darkColors.bg !== 'rgb(250, 250, 250)', darkColors);
    await shot('panel', 'narrow-dark', [NY()]);
    await show(['page'], 360);
    await wait('page', `d.querySelector('${NY()}')`);
    const ovb = await noOverflow('page', NY());
    check('V3:board-360-dark-no-overflow', ovb.ok, ovb);
    await c.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1100, deviceScaleFactor: 2, mobile: false });
    await show(['panel'], 180);
    await wait('panel', `d.querySelector('${NY()}')`);
    const zoom = await noOverflow('panel', NY());
    const stacked = await guest<boolean>('panel', `const g=getComputedStyle(d.querySelector('[data-testid="needs-you-facts-decision"]')).gridTemplateColumns;return g.split(' ').length===1`);
    check('V3:200pct-reflow-no-overflow-stacked-facts', zoom.ok && stacked, { zoom, stacked });
    await shot('panel', 'zoom-200', [`${NY()} [data-testid="readiness-entry-decision"]`]);
    await c.send('Emulation.clearDeviceMetricsOverride');
    await theme('light');
    await show(['panel'], 360);
  } catch (e) { failures.push(`V3: ${e instanceof Error ? e.message : String(e)}`); }

  // ================================================================ V4 races and honesty
  try {
    await theme('light');
    await show(['panel', 'status', 'page'], 360);
    await context('M');
    await railPlan('P-attention', 'Reported waits');
    await wait('panel', `d.querySelector('${NY()}[data-count="6"]')`);
    await wait('page', `d.querySelector('${ART()}')`, 'board keeps P-attention');
    const anchorM = await guest<string>('panel', `return d.querySelector('[data-testid="blocked-elapsed-decision"]').dataset.received`);
    // M → U → null → M: rail and Work Status follow the session; the board keeps its own scope.
    const ctxMark = await count();
    await context('U');
    await wait('panel', `d.querySelector('[data-testid="empty-state"]')&&!d.querySelector('[data-testid="needs-you"]')`, 'U empty');
    await context(null);
    await wait('panel', `d.querySelector('[data-testid="unscoped-state"]')&&!d.querySelector('article.ap-plan')`, 'null unscoped');
    await wait('status', `d.querySelector('[data-testid="unscoped-state"]')`, 'status null');
    await context('M');
    await wait('panel', `d.querySelector('${NY()}[data-count="6"]')`, 'M back');
    const anchorBack = await guest<string>('panel', `return d.querySelector('[data-testid="blocked-elapsed-decision"]').dataset.received`);
    const ctxReqs = (await requests()).slice(ctxMark);
    race('V4:session-switch-rail-status-follow', ctxReqs.filter((q) => q.frame !== 'page' && q.path === '/v1/plans').every((q) => q.session) && ctxReqs.filter((q) => q.frame === 'panel' && q.path === '/v1/plan' && q.context !== 'M').length === 0, ctxReqs.filter((q) => q.frame !== 'page').map((q) => `${q.frame}:${q.path}:${q.session ?? '-'}:${q.context ?? 'null'}`));
    race('V4:cached-revisit-keeps-anchor', anchorBack === anchorM, { anchorM, anchorBack });
    race('V4:board-keeps-own-scope', await guest<boolean>('page', `return !!d.querySelector('${NY()}')`) && ctxReqs.filter((q) => q.frame === 'page' && q.path === '/v1/plans').every((q) => !q.session));
    race('V4:work-status-never-shows-attention', await guest<boolean>('status', `return !d.querySelector('[data-testid="needs-you"],[data-testid^="blocked-elapsed-"]')&&!d.body.textContent.includes('Needs you')`));

    // Contributor C sees its recorded membership; the assignment is "the selected session".
    await context('C');
    await wait('panel', `d.querySelector('article.ap-plan')`, 'C rail');
    await railPlan('P-attention', 'Reported waits');
    const asC = await facts('panel', 'decision');
    race('V4:contributor-membership', asC.assignment === 'selected' && asC.meta.includes('Assigned to the selected session') && await guest<boolean>('panel', `return !!d.querySelector('[data-testid="helping-note"]')`), asC.meta);
    const cPlans = (await requests(`q.frame==='panel'&&q.path==='/v1/plan'&&q.context==='C'`)).map((q) => q.plan);
    race('V4:contributor-reads-only-membership', cPlans.every((p) => p === 'P-attention'), cPlans);
    await context('M');
    await wait('panel', `d.querySelector('${NY()}[data-count="6"]')`);

    // Same task IDs in another source and another plan stay isolated (board, explicit selection).
    await show(['page'], 1100);
    for (const [plan, source] of [['P-attention', 'source-other'], ['P-other', 'source-fixture']]) {
      await click('page', `[data-testid="plan-row-${plan}"][data-source="${source}"]`);
      await wait('page', `d.querySelector('${NY(plan, source)}')`, `${source}/${plan}`);
      const iso = await facts('page', 'decision', plan, source);
      if (source === 'source-other') race('V4:other-source-no-open-session', await guest<boolean>('page', `return !d.querySelector('${ART(plan, source)} [data-testid^="open-session-"]')&&d.querySelector('${ART(plan, source)} [data-testid="other-source"]')!==null`));
      race(`V4:isolated-${source}-${plan}`, same(await rows('page', plan, source), ['decision']) && iso.details === 'unknown' && iso.reason.text === 'Unknown' && iso.category === 'unknown' && !(await guest<string>('page', `return d.querySelector('${ART(plan, source)}').textContent`)).includes('Choose an output format'), iso);
    }
    await click('page', `[data-testid="plan-row-P-attention"][data-source="source-fixture"]`);
    await wait('page', `d.querySelector('${NY()}[data-count="6"]')`);

    // Late reply after a context switch: no paint, no continuation.
    await show(['panel', 'status', 'page'], 360);
    await evaluate(`qa.holds.push({tag:'ctx',frame:'panel',path:'/v1/plan',plan:'P-attention',cursor:false});true`);
    neutral();
    await waitTop(`qa.held.some(h=>h.tag==='ctx')`, 'held first page');
    await context('U');
    await wait('panel', `d.querySelector('[data-testid="empty-state"]')`);
    let mark = await count();
    await evaluate(`qa.release('ctx');true`);
    await polls('panel', mark, 2);
    let after = (await requests()).slice(mark).filter((q) => q.frame === 'panel' && q.path === '/v1/plan');
    race('V4:context-switch-late-reply-retired', after.length === 0 && await guest<boolean>('panel', `return !d.querySelector('[data-testid="needs-you"]')&&!!d.querySelector('[data-testid="empty-state"]')`), after);
    await context('M');
    await wait('panel', `d.querySelector('${NY()}[data-count="6"]')&&d.querySelector('${ART()}').dataset.revision==='${fx.revision()}'`, 'M current');

    // Hide: polling pauses; a held first page released while hidden is observed for continuations.
    await evaluate(`qa.holds.push({tag:'hide',frame:'panel',path:'/v1/plan',plan:'P-attention',cursor:false});true`);
    const revHide = neutral();
    await waitTop(`qa.held.some(h=>h.tag==='hide')`, 'held before hide');
    await guest('panel', `Object.defineProperty(d,'visibilityState',{configurable:true,get:()=>'hidden'});Object.defineProperty(d,'hidden',{configurable:true,get:()=>true});d.dispatchEvent(new Event('visibilitychange'));return true`);
    mark = await count();
    await evaluate(`qa.release('hide');true`);
    await polls('page', mark, 2);
    after = (await requests()).slice(mark).filter((q) => q.frame === 'panel');
    const hiddenFacts = { listPolls: after.filter((q) => q.path === '/v1/plans').length, detailPages: after.filter((q) => q.path === '/v1/plan').map((q) => (q.cursor ? 'continuation' : 'first')) };
    race('V4:hidden-frame-pauses-polling', hiddenFacts.listPolls === 0, hiddenFacts);
    if (hiddenFacts.detailPages.length) findings.push({ id: 'V4:hidden-held-reply-continues', owner: 'N2 (lifetime clause 7; pre-existing controller behaviour)', observed: hiddenFacts, expected: 'Contract: retire data and callbacks on the hide boundary; a held reply delivered while hidden issues no further continuation.' });
    races.push({ id: 'V4:hidden-held-reply-observed', pass: true, facts: hiddenFacts });
    await guest('panel', `Object.defineProperty(d,'visibilityState',{configurable:true,get:()=>'visible'});Object.defineProperty(d,'hidden',{configurable:true,get:()=>false});d.dispatchEvent(new Event('visibilitychange'));return true`);
    await wait('panel', `d.querySelector('${ART()}')?.dataset.revision==='${revHide}'&&d.querySelector('${NY()}[data-count="6"]')`, 'visible again, current');
    race('V4:visible-again-current-rows', same(await rows('panel'), ['decision', 'dependency', 'review', 'external', 'other', 'unknown']));

    // Failed detail continuation: unavailable, no partial list, no empty claim; recovers on refresh.
    await evaluate(`qa.fail.push({frame:'panel',path:'/v1/plan',cursor:true,status:503,code:'busy'});true`);
    neutral();
    await wait('panel', `d.querySelector('${ART()} [data-testid="readiness"]')?.dataset.state==='unavailable'`, 'continuation failure');
    race('V4:failed-continuation-honest', await guest<boolean>('panel', `const r=d.querySelector('${ART()} [data-testid="readiness"]');return !r.querySelector('[data-testid="needs-you"]')&&!r.textContent.includes('No reported blockers')&&r.textContent.includes('Readiness and reported blockers are unavailable')`));
    await shot('panel', 'continuation-failed', [`${ART()} [data-testid="readiness"]`]);
    await evaluate(`qa.fail=[];true`);
    await wait('panel', `d.querySelector('${NY()}[data-count="6"]')`, 'recovered after failure');

    // Page-cap exhaustion (endless continuation seam): bounded, unavailable, never a prefix.
    mark = await count();
    await evaluate(`qa.edits.endless='P-attention';true`);
    neutral();
    await wait('panel', `d.querySelector('${ART()} [data-testid="readiness"]')?.dataset.state==='unavailable'`, 'cap exhaustion', 60_000);
    const capReqs = (await requests()).slice(mark).filter((q) => q.frame === 'panel' && q.path === '/v1/plan');
    const firstPages = capReqs.filter((q) => !q.cursor).length;
    race('V4:cap-exhaustion-bounded-unavailable', capReqs.length <= 120 * Math.max(1, firstPages) && capReqs.length >= 120 && !(await guest<boolean>('panel', `return !!d.querySelector('[data-testid="needs-you"]')`)), { detailRequests: capReqs.length, firstPages });
    await evaluate(`qa.edits.endless=null;true`);
    await wait('panel', `d.querySelector('${NY()}[data-count="6"]')`, 'recovered after cap', 30_000);

    // Unavailable service with last good data: stale, qualified, rows not re-asserted as current.
    await evaluate(`qa.fail.push({frame:'panel',path:'/v1/plans',status:503,code:'unavailable'},{frame:'panel',path:'/health',status:503,code:'unavailable'});true`);
    await wait('panel', `d.querySelector('[data-testid="stale-banner"]')&&d.querySelector('${NY()}')?.dataset.qualifier==='stale'`, 'stale', 30_000);
    race('V4:unavailable-service-stale-qualified', await guest<boolean>('panel', `const r=d.querySelector('${ART()} [data-testid="readiness"]');return r.dataset.stale==='true'&&r.textContent.includes('Last reported readiness')&&d.querySelectorAll('${NY()} [data-testid^="readiness-entry-"]').length===6`));
    await shot('panel', 'stale-and-unavailable', ['[data-testid="stale-banner"]', NY()]);
    await evaluate(`qa.fail=[];true`);
    await wait('panel', `!d.querySelector('[data-testid="stale-banner"]')&&d.querySelector('${NY()}')?.dataset.qualifier==='current'`, 'fresh again', 30_000);

    // Capture off: rows labelled last reported, not current guidance.
    fx.setCapture(false);
    await wait('panel', `d.querySelector('[data-testid="capture-off"]')&&d.querySelector('${NY()}')?.dataset.qualifier==='capture-off'`, 'capture off', 30_000);
    race('V4:capture-off-qualified', await guest<string>('panel', `return d.querySelector('[data-testid="needs-you-qualifier"]')?.textContent??''`) === 'Capture is off: these are the last reported blockers, not current guidance.');
    await shot('panel', 'capture-off', [NY()]);
    fx.setCapture(true);
    await wait('panel', `!d.querySelector('[data-testid="capture-off"]')&&d.querySelector('${NY()}')?.dataset.qualifier==='current'`, 'capture on', 30_000);

    // Rapid unblock → reblock: one row, details cleared on re-entry, new exact interval, no completion.
    const doneBefore = await guest<string>('panel', `return d.querySelector('${ART()} [data-testid="counts"]').dataset.done`);
    fx.report({ op: 'change', changes: [{ id: 'decision', status: 'pending' }] });
    const revRe = fx.report({ op: 'change', changes: [{ id: 'decision', status: 'blocked' }] });
    await wait('panel', `d.querySelector('${ART()}')?.dataset.revision==='${revRe}'&&d.querySelector('${NY()}[data-count="6"]')`, 'reblocked');
    const re = await facts('panel', 'decision');
    race('V4:unblock-reblock-one-row-reset', same(await rows('panel'), ['decision', 'dependency', 'review', 'external', 'other', 'unknown']) && re.details === 'unknown' && re.wait.kind === 'exact' && re.wait.text === '<1 min' && await guest<string>('panel', `return d.querySelector('${ART()} [data-testid="counts"]').dataset.done`) === doneBefore, re);
    // Explicit unblock removes the row without completing the task.
    const revUn = fx.report({ op: 'change', changes: [{ id: 'decision', status: 'working' }] });
    await wait('panel', `d.querySelector('${ART()}')?.dataset.revision==='${revUn}'&&d.querySelector('${NY()}[data-count="5"]')`, 'unblocked');
    race('V4:unblock-removes-without-completion', !(await rows('panel')).includes('decision') && await guest<string>('panel', `return d.querySelector('${ART()} [data-testid="counts"]').dataset.done`) === doneBefore);
    fx.report({ op: 'change', changes: [{ id: 'decision', status: 'blocked', blocker: { category: 'decision', reason: 'Choose an output format', nextAction: 'Select CSV or JSON' } }] });

    // Repeated relay: no multiplied rows, relay lines or announcements.
    await guest('panel', `w.__qaAnnounce=[];new w.MutationObserver(ms=>{for(const m of ms)for(const n of [m.target,...m.addedNodes]){const el=n.nodeType===1?n:n.parentElement;const live=el?.closest?.('[role="status"],[role="alert"],[aria-live]');if(live&&live.closest('[data-testid="readiness"]')&&live.textContent.trim())w.__qaAnnounce.push(live.dataset.testid||live.className)}}).observe(d.body,{subtree:true,childList:true,characterData:true});return true`);
    let revRelay = 0;
    for (let i = 0; i < 3; i++) revRelay = fx.report({ op: 'change', attributed: 'C', changes: [{ id: 'decision', status: 'blocked' }] });
    await wait('panel', `d.querySelector('${ART()}')?.dataset.revision==='${revRelay}'&&d.querySelector('${NY()}[data-count="6"]')`, 'relays painted');
    const relay = await facts('panel', 'decision');
    const announced = await guest<string[]>('panel', `return w.__qaAnnounce`);
    race('V4:repeated-relay-no-multiplication', same(await rows('panel'), ['decision', 'dependency', 'review', 'external', 'other', 'unknown']) && relay.reports.filter((r: string) => r.startsWith('parent-relay:')).length === 1 && relay.source?.text === 'Details reported directly by Planner session' && announced.length === 0, { reports: relay.reports, announced });

    // Held pre-cleanup replies released after authoritative archive / delete: nothing returns.
    for (const action of ['archive', 'delete'] as const) {
      const plan = `P-race-${action}`;
      fx.start(plan, `Race plan ${action}`, [{ id: 'race', title: 'Race wait', kind: 'task', status: 'blocked', blocker: { category: 'external', reason: 'Waiting for a synthetic sample' } }]);
      await railPlan(plan, `Race plan ${action}`);
      await wait('panel', `d.querySelector('${NY(plan)} [data-testid="readiness-entry-race"]')`, `${plan} row`);
      await evaluate(`qa.holds.push({tag:'${action}',frame:'panel',path:'/v1/plan',plan:'${plan}',cursor:false});true`);
      fx.report({ op: 'revise', plan, title: `Race plan ${action} ` });
      await waitTop(`qa.held.some(h=>h.tag==='${action}')`, `${plan} pre-cleanup reply held`);
      fx.report({ op: 'change', plan, changes: [{ id: 'race', status: 'done' }] });
      fx.report({ op: 'finish', plan, outcome: 'finished' });
      await fx.cleanupElsewhere('archive', plan);
      if (action === 'delete') await fx.cleanupElsewhere('delete', plan);
      await wait('panel', `!d.querySelector('${ART(plan)}')&&![...d.querySelectorAll('[data-testid="plan-selector"] *')].some(n=>n.textContent==='Race plan ${action}')`, `${plan} gone from the rail (authoritative ${action})`, 30_000);
      race(`V4:${action}-observed-before-release`, action === 'delete' ? !fx.exists(plan) : fx.archived(plan));
      mark = await count();
      await evaluate(`qa.release('${action}');true`);
      await polls('panel', mark, 2);
      const late = (await requests()).slice(mark).filter((q) => q.frame === 'panel' && q.path === '/v1/plan' && q.plan === plan);
      race(`V4:held-pre-${action}-reply-no-resurrection`, late.length === 0 && await guest<boolean>('panel', `return !d.querySelector('${ART(plan)}')&&!d.querySelector('[data-testid="readiness-entry-race"]')`), late);
    }

    // Same progress revision, cleanup generation changes between pages (board): restart, never joined.
    fx.start('P-cleanup', 'Cleanup pages', Array.from({ length: 25 }, (_, n) => ({ id: `t${n}`, title: `Cleanup task ${n}`, kind: 'task' as const, status: 'done' as const })));
    fx.report({ op: 'finish', plan: 'P-cleanup', outcome: 'finished' });
    await show(['page'], 1100);
    await wait('page', `d.querySelector('[data-testid="plan-row-P-cleanup"]')`, 'board lists P-cleanup', 30_000);
    await evaluate(`qa.holds.push({tag:'pages',frame:'page',path:'/v1/plan',plan:'P-cleanup',cursor:true,lazy:true});true`);
    mark = await count();
    await click('page', `[data-testid="plan-row-P-cleanup"][data-source="source-fixture"]`);
    await waitTop(`qa.held.some(h=>h.tag==='pages')`, 'P-cleanup continuation held');
    const progressRev = fx.revision('P-cleanup');
    await fx.cleanupElsewhere('archive', 'P-cleanup');
    await fx.cleanupElsewhere('restore', 'P-cleanup');
    await evaluate(`qa.release('pages');true`);
    await waitTop(`qa.requests.slice(${mark}).filter(q=>q.frame==='page'&&q.path==='/v1/plan'&&q.plan==='P-cleanup'&&!q.cursor).length>=2`, 'detail read restarted', 30_000);
    await wait('page', `d.querySelector('${ART('P-cleanup')} .ap-tasks[data-complete]')`, 'P-cleanup complete detail', 30_000);
    const cl = (await requests()).slice(mark).filter((q) => q.frame === 'page' && q.path === '/v1/plan' && q.plan === 'P-cleanup').map((q) => (q.cursor ? 'continuation' : 'first'));
    race('V4:cleanup-generation-between-pages-restarts', fx.revision('P-cleanup') === progressRev && cl.filter((x) => x === 'first').length >= 2 && await guest<boolean>('page', `return !d.querySelector('${ART('P-cleanup')} [data-testid="needs-you"]')`), cl);

    // Request counters: an idle window shows only the existing list polling.
    await show(['panel', 'status', 'page'], 360);
    await context('M');
    await railPlan('P-attention', 'Reported waits');
    await wait('panel', `d.querySelector('${NY()}[data-count="6"]')&&d.querySelector('${ART()}').dataset.revision==='${fx.revision()}'`);
    // An observed archive elsewhere clears the board's selection (existing cleanup rule): select
    // explicitly and let every frame complete one refresh cycle before the idle window starts.
    await click('page', `[data-testid="plan-row-P-attention"][data-source="source-fixture"]`);
    await wait('page', `d.querySelector('${NY()}[data-count="6"]')`, 'board P-attention shown');
    // Settle on observed state, not on poll issuance: the first list read after the cleanup elsewhere
    // applies the existing cleanup-change eviction and re-reads the shown plan once. A frame issues
    // its next poll only after the previous refresh completed, so two polls issued after `settle`
    // prove the first one's reply (and any re-read it triggered) was processed; then every detail
    // read since `settle` must have completed and each view must show current Needs you again.
    const settle = await count();
    await polls('panel', settle, 2); await polls('status', settle, 2); await polls('page', settle, 2);
    await waitTop(`qa.requests.slice(${settle}).filter(q=>q.path==='/v1/plan').every(q=>q.status!==null)`, 'detail reads since settle completed');
    await wait('page', `d.querySelector('${NY()}[data-count="6"]')&&d.querySelector('${ART()}').dataset.revision==='${fx.revision()}'`, 'board settled at current revision');
    await wait('panel', `d.querySelector('${NY()}[data-count="6"]')&&d.querySelector('${ART()}').dataset.revision==='${fx.revision()}'`, 'rail settled at current revision');
    const reReads = (await requests()).slice(settle).filter((q) => q.path === '/v1/plan').map((q) => `${q.frame}:${q.plan}${q.cursor ? ':continuation' : ''}`);
    races.push({ id: 'V4:settle-observed-cleanup-eviction-re-read', pass: true, facts: { detailReadsWhileSettling: reReads } });
    mark = await count();
    await polls('panel', mark, 2); await polls('status', mark, 2); await polls('page', mark, 2);
    const idle = (await requests()).slice(mark);
    const idlePaths = [...new Set(idle.map((q) => `${q.frame}:${q.method}:${q.path}`))].sort();
    race('V4:idle-requests-existing-polling-only', idle.every((q) => q.method === 'GET' && (q.path === '/v1/plans' || q.path === '/health')), idlePaths);

    // Subscriptions within existing per-surface limits and the total of 32.
    const subs = await evaluate<any[]>(`qa.subs`);
    const sessions = (f: string) => subs.filter((s) => s.frame === f && s.kind === 'sessions').length;
    race('V4:subscriptions-bounded', sessions('panel') <= 4 && sessions('status') <= 2 && sessions('page') <= 16 && subs.length <= 32, { panel: sessions('panel'), status: sessions('status'), page: sessions('page'), total: subs.length });

    // Disposal: pagehide with a held first page; release sends nothing further.
    await evaluate(`qa.holds.push({tag:'dispose',frame:'panel',path:'/v1/plan',plan:'P-attention',cursor:false});true`);
    neutral();
    await waitTop(`qa.held.some(h=>h.tag==='dispose')`, 'held before dispose');
    await guest('panel', `w.dispatchEvent(new Event('pagehide'));return true`);
    mark = await count();
    await evaluate(`qa.release('dispose');true`);
    await polls('page', mark, 2);
    after = (await requests()).slice(mark).filter((q) => q.frame === 'panel');
    race('V4:disposed-frame-held-reply-no-continuation', after.length === 0, after.map((q) => q.path));

    // In-app only: no notification/permission prompt, no automatic toast/badge/navigation.
    const alerts = await evaluate<Record<string, string[]>>(`Object.fromEntries(['page','panel','status'].map(f=>[f,[...frame(f).contentWindow.__qaAlerts]]))`);
    const msgTypes = await evaluate<string[]>(`[...new Set(qa.messages.map(m=>m.type))].sort()`);
    race('V4:no-notification-or-permission-request', Object.values(alerts).every((l) => l.length === 0), alerts);
    race('V4:no-automatic-toast-badge-or-navigation', !msgTypes.some((t) => ['toast', 'badge', 'open-session', 'open-surface', 'notification', 'session-link'].includes(t)), msgTypes);
    race('V4:no-service-writes-from-guests', (await requests(`q.method!=='GET'`)).length === 0);
  } catch (e) { failures.push(`V4: ${e instanceof Error ? e.message : String(e)}`); }

  const errors = c.events.map((e) => String(e.params.exceptionDetails?.exception?.description ?? e.params.args?.map((a: any) => a.value ?? a.description).join(' ') ?? '').split('\n')[0].slice(0, 200));
  races.push({ id: 'V4:no-guest-exceptions-or-console-errors', pass: errors.length === 0, ...(errors.length ? { facts: errors } : {}) });
  requestLog = (await evaluate<any[]>(`qa.requests`)).map((q) => ({ frame: q.frame, context: q.context, method: q.method, path: q.path, plan: q.plan, source: q.source, cursor: q.cursor, session: q.session, status: q.status }));
  subsLog = await evaluate<any[]>(`qa.subs.map(s=>({frame:s.frame,kind:s.kind}))`);
} catch (e) {
  failures.push(`setup: ${e instanceof Error ? e.message : String(e)}`);
} finally {
  page?.close();
  const exited = new Promise((r) => { if (chrome.exitCode !== null) r(null); else chrome.once('exit', r); });
  try { process.kill(-chrome.pid!, 'SIGTERM'); } catch { chrome.kill('SIGTERM'); }
  await exited;
  await fx.stop();
  const evidenceClass = `synthetic SDK shell over the real disposable ${built ? 'built (build/service/main.js)' : 'TypeScript'} service, isolated headless Linux Chromium, current guest bundles`;
  const v3Pass = !failures.some((f) => f.startsWith('V3') || f.startsWith('setup')) && results.every((r) => r.pass);
  const v4Pass = !failures.some((f) => f.startsWith('V4') || f.startsWith('setup')) && races.every((r) => r.pass);
  // Open findings keep a row from reading as accepted even when every assertion passed.
  const gate = (pass: boolean, row: string) => (!pass ? 'fail' : findings.some((f) => f.id.startsWith(row)) ? 'assertions-pass-with-open-findings' : 'pass');
  writeFileSync(join(artifacts, 'results.json'), `${JSON.stringify({ row: 'V3', evidenceClass, nativeHostProof: false, browser: browserVersion, passed: v3Pass, gate: gate(v3Pass, 'V3'), findings: findings.filter((f) => f.id.startsWith('V3')), failures: failures.filter((f) => !f.startsWith('V4')), assertions: results.length, results, screenshots: shots }, null, 2)}\n`);
  writeFileSync(join(artifacts, 'races.json'), `${JSON.stringify({ row: 'V4', evidenceClass, nativeHostProof: false, passed: v4Pass, gate: gate(v4Pass, 'V4'), failures: failures.filter((f) => !f.startsWith('V3')), findings: findings.filter((f) => f.id.startsWith('V4')), assertions: races.length, results: races }, null, 2)}\n`);
  const byPath: Record<string, number> = {};
  for (const q of requestLog) { const k = `${q.frame} ${q.method} ${q.path}${q.cursor ? ' (continuation)' : ''}`; byPath[k] = (byPath[k] ?? 0) + 1; }
  writeFileSync(join(artifacts, 'requests.json'), `${JSON.stringify({ evidenceClass, note: 'Bounded request metadata only (no bodies, bearer or URLs). Includes deliberate seams: endless continuation cap exhaustion and injected failures.', totals: byPath, subscriptions: subsLog, requests: requestLog }, null, 2)}\n`);
  console.log(JSON.stringify({ v3: { gate: gate(v3Pass, 'V3'), assertions: results.length }, v4: { gate: gate(v4Pass, 'V4'), assertions: races.length }, findings: findings.map((f) => f.id), failures }, null, 2));
  if (!v3Pass || !v4Pass) process.exitCode = 1;
  rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
