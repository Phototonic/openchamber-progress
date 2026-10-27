// Current-bundle focus-control QA in an isolated Chromium with deliberately synthetic SDK/service
// events (focus-controls-fixture.ts). It starts its own loopback fixture and a headless Chromium
// with a fresh disposable profile, drives real mouse/keyboard input over CDP, and stops only what
// it started. Never attaches to an existing browser or uses a real profile.
// Usage: node --experimental-strip-types tests/browser/focus-controls-qa.ts --artifacts <dir> [--baseline] [--chromium <path>]
//   --baseline: only the existing large-plan render/disclosure/request measurements (no focus
//   controls needed), for comparison with a later run of the same fixture and runtime.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { startFocusFixture } from './focus-controls-fixture.ts';
import { CORE_ITEMS } from './focus-controls-fixtures.ts';

const arg = (name: string) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const artifacts = arg('--artifacts');
const baseline = process.argv.includes('--baseline');
if (!artifacts) throw new Error('usage: focus-controls-qa.ts --artifacts <dir> [--baseline] [--chromium <path>]');
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

type Result = { id: string; pass: boolean; detail?: unknown };
const results: Result[] = [];
const shots: string[] = [];
const perf: Record<string, unknown> = {};
const requestFacts: Record<string, unknown> = {};
function check(id: string, pass: boolean, detail?: unknown) {
  results.push({ id, pass, ...(detail === undefined ? {} : { detail }) });
  if (!pass) throw new Error(`${id} failed${detail === undefined ? '' : `: ${JSON.stringify(detail)}`}`);
}
const stats = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p: number) => (s.length ? s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)] : null);
  const r = (v: number | null) => (v === null ? null : Math.round(v * 10) / 10);
  return { n: s.length, median: r(q(0.5)), p95: r(q(0.95)), max: r(s.at(-1) ?? null) };
};

// ---- minimal CDP client (page target only)
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
  return {
    events,
    send: (method, params = {}) => new Promise((resolve, reject) => { const id = next++; waiting.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); }),
    close: () => ws.close(),
  };
}

const profile = mkdtempSync(join(tmpdir(), 'focus-controls-qa-'));
const { server, port } = await startFocusFixture(0);
const chrome = spawn(findChromium(), ['--headless=new', '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--disable-sync', '--hide-scrollbars', '--window-size=1280,1000', 'about:blank'], { stdio: 'ignore', detached: true });
let cdp: Cdp | null = null;
let failure: string | null = null;
let browserVersion = '';
try {
  let devtools = '';
  for (const end = Date.now() + 15_000; Date.now() < end && !devtools;) {
    const f = join(profile, 'DevToolsActivePort');
    if (existsSync(f)) devtools = readFileSync(f, 'utf8').split('\n')[0];
    else await new Promise((r) => setTimeout(r, 100));
  }
  if (!devtools) throw new Error('Chromium did not start its DevTools endpoint.');
  browserVersion = String(((await (await fetch(`http://127.0.0.1:${devtools}/json/version`)).json()) as { Browser: string }).Browser).split('/')[0];
  const targets = await (await fetch(`http://127.0.0.1:${devtools}/json/list`)).json() as { id: string; type: string; webSocketDebuggerUrl: string }[];
  const pageTarget = targets.find((t) => t.type === 'page')!;
  cdp = await connect(pageTarget.webSocketDebuggerUrl);
  const c = cdp;
  await c.send('Runtime.enable');
  await c.send('Page.enable');
  // Reduced motion is set before navigation so every guest starts under it.
  await c.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await c.send('Page.navigate', { url: `http://127.0.0.1:${port}/` });

  const evaluate = async <T = any>(expression: string): Promise<T> => {
    const r = await c.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value as T;
  };
  /** Run `code` with `d` = the guest document of surface `s`. */
  const guest = <T = any>(s: string, code: string) => evaluate<T>(`(()=>{const w=frame('${s}').contentWindow,d=w.document;${code}})()`);
  const wait = async (s: string, cond: string, what = cond, ms = 10_000) => {
    const ok = await evaluate<boolean>(`(async()=>{const end=Date.now()+${ms};while(Date.now()<end){try{const w=frame('${s}').contentWindow,d=w.document;if(${cond})return true}catch{}await new Promise(r=>setTimeout(r,40));}return false})()`);
    if (!ok) throw new Error(`timed out waiting (${s}): ${what}`);
  };
  const key = async (k: string, times = 1, modifiers = 0) => {
    const codes: Record<string, number> = { Enter: 13, Tab: 9, ' ': 32, Escape: 27, ArrowDown: 40, Home: 36 };
    const code = k === ' ' ? 'Space' : k;
    for (let i = 0; i < times; i++) {
      await c.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, modifiers, windowsVirtualKeyCode: codes[k] ?? 0, ...(k === 'Enter' ? { text: '\r', unmodifiedText: '\r' } : k === ' ' ? { text: ' ', unmodifiedText: ' ' } : {}) });
      await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, modifiers, windowsVirtualKeyCode: codes[k] ?? 0 });
    }
  };
  const SHIFT = 8;
  const point = (s: string, selector: string) => evaluate<[number, number] | null>(`(()=>{const f=frame('${s}'),n=f.contentDocument.querySelector(${JSON.stringify(selector)});if(!n)return null;n.scrollIntoView({block:'center'});const r=n.getBoundingClientRect(),o=f.getBoundingClientRect();return [o.x+r.x+Math.min(16,r.width/2),o.y+r.y+r.height/2]})()`);
  const click = async (s: string, selector: string) => {
    const p = await point(s, selector);
    if (!p) throw new Error(`missing ${selector} in ${s}`);
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await c.send('Input.dispatchMouseEvent', { type, x: p[0], y: p[1], button: 'left', clickCount: 1 });
  };
  const frameRaf = (s: string) => guest(s, `return new Promise(r=>w.requestAnimationFrame(()=>w.requestAnimationFrame(()=>r(true))))`);
  /** Interaction-to-visible-state time: a real click, then the first animation frame where `cond` holds. */
  const timedClick = async (s: string, selector: string, cond: string) => {
    await guest(s, `w.__t0=null;w.addEventListener('pointerdown',()=>{w.__t0=w.performance.now()},{capture:true,once:true});return true`);
    await click(s, selector);
    return guest<number>(s, `return new Promise((res,rej)=>{const end=w.performance.now()+10000;const tick=()=>{try{if(w.__t0!==null&&(${cond}))return res(w.performance.now()-w.__t0)}catch{}if(w.performance.now()>end)return rej(new Error('timed click: '+${JSON.stringify(cond)}));w.requestAnimationFrame(tick)};w.requestAnimationFrame(tick)})`);
  };
  const show = async (s: string, width: number) => { await evaluate(`qa.show('${s}',${width});true`); await wait(s, `w.innerWidth===${width}`, `${s} width ${width}`); };
  const noOverflow = (s: string) => guest<boolean>(s, `const sw=d.documentElement.scrollWidth,cw=d.documentElement.clientWidth;return sw<=cw&&[...d.querySelectorAll('[data-testid="focus-controls"] button')].every(b=>{const r=b.getBoundingClientRect();return r.right<=cw+0.5&&r.left>=-0.5})`);
  const shot = async (s: string, name: string, scrollTo: string | null = '[data-testid="focus-controls"]') => {
    check(`${name}:no-horizontal-overflow`, await noOverflow(s));
    if (scrollTo) await guest(s, `d.querySelector(${JSON.stringify(scrollTo)})?.scrollIntoView({block:'start'});return true`);
    await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    const r = await evaluate<number[]>(`(()=>{const r=document.querySelector('section[data-surface="${s}"]').getBoundingClientRect();return [r.x-8,r.y-8,r.width+16,r.height+16]})()`);
    const png = await c.send('Page.captureScreenshot', { format: 'png', clip: { x: r[0], y: r[1], width: r[2], height: r[3], scale: 1 }, captureBeyondViewport: true });
    writeFileSync(join(artifacts, `${name}.png`), Buffer.from(png.data, 'base64'));
    shots.push(`${name}.png`);
  };
  const context = (id: string | null, directory?: string) => evaluate(`qa.context(${JSON.stringify(id)}${directory ? `,${JSON.stringify(directory)}` : ''});true`);
  const requests = (filter = 'true') => evaluate<any[]>(`qa.requests.filter(q=>${filter})`);
  const messages = (filter = 'true') => evaluate<any[]>(`qa.messages.filter(m=>${filter})`);
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const ROWS = `li[data-testid^="item-"],li[data-testid^="group-"]`;
  /** Paint recorder: every root replacement, with its render time and canonical row count. */
  const instrument = (s: string) => guest(s, `if(w.__paints)return true;w.__paints=[];const mount=d.getElementById('root'),orig=w.queueMicrotask.bind(w);w.queueMicrotask=fn=>orig(()=>{const before=mount.firstElementChild,t0=w.performance.now();fn();if(mount.firstElementChild!==before)w.__paints.push({ms:w.performance.now()-t0,rows:mount.querySelectorAll('${ROWS}').length})});return true`);
  const paints = (s: string) => guest<{ ms: number; rows: number }[]>(s, `return w.__paints.splice(0)`);
  const counts = (s: string, scope = 'article.ap-plan') => guest<string[]>(s, `const n=d.querySelector('${scope} [data-testid="counts"]');return [n.dataset.done,n.dataset.total,n.dataset.remaining,n.dataset.skipped]`);
  const detailPages = (s: string, plan: string, mark: number) => requests(`q.surface==='${s}'&&q.path==='/v1/plan'&&q.query?.plan==='${plan}'`).then((r) => r.filter((q: any) => q.at >= mark).length);
  const hostNow = () => evaluate<number>('performance.now()');

  await evaluate(`new Promise(r=>{const t=()=>window.qa&&frame('page').contentDocument?.querySelector('[data-testid="progress-root"]')?r(true):setTimeout(t,50);t()})`);
  check('Q7:reduced-motion-emulated', await guest('panel', `return w.matchMedia('(prefers-reduced-motion: reduce)').matches`));
  const mode = baseline ? 'baseline' : 'candidate';

  // ================================================================ Q8: 1,000-item rail (both modes)
  await show('panel', 360);
  await instrument('panel');
  const firstStart = await hostNow();
  const firstRender = await evaluate<number>(`(async()=>{const t0=performance.now();qa.context('S');const d=()=>frame('panel').contentDocument;await new Promise((res,rej)=>{const end=t0+20000;const tick=()=>{if(d().querySelectorAll('${ROWS}').length===1000)return res(true);if(performance.now()>end)return rej(new Error('first render'));requestAnimationFrame(tick)};tick()});return performance.now()-t0})()`);
  const firstPaints = await paints('panel');
  const rowFacts = await guest('panel', `const rows=[...d.querySelectorAll('${ROWS}')].map(n=>n.dataset.testid);return {rows:rows.length,unique:new Set(rows).size,tasks:rows.filter(x=>x.startsWith('item-')).length,groups:rows.filter(x=>x.startsWith('group-')).length,disclosures:d.querySelectorAll('ul.ap-items details').length}`);
  check('Q8:scale-canonical-rows', rowFacts.rows === 1000 && rowFacts.unique === 1000 && rowFacts.tasks === 990 && rowFacts.groups === 10, rowFacts);
  check('Q8:scale-counts', same(await counts('panel'), ['198', '792', '594', '198']), await counts('panel'));
  check('Q8:scale-detail-pages', await detailPages('panel', 'P-scale', firstStart) === 50, await detailPages('panel', 'P-scale', firstStart));
  perf.railFirstRender = { untilRowsMs: Math.round(firstRender), paints: firstPaints.map((p) => ({ ms: Math.round(p.ms * 10) / 10, rows: p.rows })), ...rowFacts };

  // Unchanged snapshots: polling continues, nothing repaints.
  {
    const mark = await hostNow();
    await evaluate('new Promise(r=>setTimeout(r,6500))'); // two poll periods: absence of paints needs a window
    const reqs = (await requests(`q.surface==='panel'`)).filter((q: any) => q.at >= mark);
    const idle = await paints('panel');
    const byPath = reqs.reduce((o: Record<string, number>, q: any) => { o[q.path] = (o[q.path] ?? 0) + 1; return o; }, {});
    check('Q8:unchanged-snapshot-no-repaint', idle.length === 0, idle);
    check('Q8:unchanged-snapshot-no-detail-read', !byPath['/v1/plan'], byPath);
    requestFacts.railIdle6500ms = byPath;
  }

  // Native disclosure interaction timing (collapse/expand SG0 with the mouse).
  {
    const collapse: number[] = [];
    const expand: number[] = [];
    for (let i = 0; i < 5; i++) {
      collapse.push(await timedClick('panel', '[data-testid="group-toggle-SG0"] > summary', `!d.querySelector('[data-testid="group-toggle-SG0"]').open`));
      expand.push(await timedClick('panel', '[data-testid="group-toggle-SG0"] > summary', `d.querySelector('[data-testid="group-toggle-SG0"]').open`));
    }
    perf.railNativeDisclosure = { collapse: stats(collapse), expand: stats(expand) };
    check('Q8:native-disclosure-no-repaint', (await paints('panel')).length === 0);
  }

  // Five warm-ups, then 20 same-plan changed-snapshot paints. Each change is one revision; the
  // controller paints a loading state for the new revision and then its complete detail.
  {
    // A collapsed group before the changes: does that choice survive a new revision?
    await click('panel', '[data-testid="group-toggle-SG5"] > summary');
    await wait('panel', `!d.querySelector('[data-testid="group-toggle-SG5"]').open`);
    const ready: number[] = []; const loading: number[] = []; const visible: number[] = []; const perChange: number[] = [];
    let survived = true;
    for (let k = 0; k < 25; k++) {
      await paints('panel');
      const t0 = await hostNow();
      const title = `Scale task edited ${k}`;
      await evaluate(`qa.update('P-scale',p=>{p.items.find(i=>i.id==='ST${10 + k}').title=${JSON.stringify(title)}});true`);
      await wait('panel', `d.querySelector('[data-testid="item-ST${10 + k}"]')?.textContent.includes(${JSON.stringify(title)})`, `change ${k}`, 15_000);
      await frameRaf('panel');
      const t1 = await hostNow();
      const ps = await paints('panel');
      if (k < 5) continue;
      visible.push(t1 - t0);
      perChange.push(ps.length);
      for (const p of ps) (p.rows === 1000 ? ready : loading).push(p.ms);
      if (await guest<boolean>('panel', `return d.querySelector('[data-testid="group-toggle-SG5"]').open`)) survived = false;
    }
    perf.railChangedSnapshots = { warmups: 5, measured: 20, readyPaintMs: stats(ready), loadingPaintMs: stats(loading), paintsPerChange: stats(perChange), updateToVisibleMs: stats(visible), note: 'updateToVisibleMs includes waiting for the next 3 s poll and the 50-page detail read' };
    perf.collapsedChoiceSurvivesRevision = survived;
    check('Q8:no-render-loop', perChange.every((n) => n <= 3), perChange);
    check('Q8:rows-after-changes', await guest<number>('panel', `return d.querySelectorAll('${ROWS}').length`) === 1000);
    await click('panel', '[data-testid="group-toggle-SG5"] > summary');
  }

  if (!baseline) {
    // Focus-control interactions at 1,000 items: no request, timings recorded.
    const mark = await hostNow();
    const t: Record<string, number> = {};
    t.unfinished = await timedClick('panel', '[data-testid="focus-mode-unfinished"] button', `d.querySelector('[data-testid="focus-mode"]')?.dataset.mode==='unfinished'&&d.querySelectorAll('li[data-focus="hidden"]').length>0`);
    check('Q8:scale-unfinished-summary', same(await guest('panel', `const s=d.querySelector('[data-testid="focus-summary"]').dataset;return [s.rows,s.matching,s.hidden]`), ['990', '594', String(990 - 594 - Number(await guest('panel', `return d.querySelector('[data-testid="focus-summary"]').dataset.context`)))]));
    // Expected targets in canonical hierarchy order (document order of the materialized rows).
    const order = await guest<Record<string, string[]>>('panel', `const o={working:[],blocked:[]};for(const n of d.querySelectorAll('li[data-testid^="item-"]'))if(n.dataset.status in o)o[n.dataset.status].push(n.dataset.testid);return o`);
    t.collapseAll = await timedClick('panel', '[data-testid="focus-collapse-all"] button', `[...d.querySelectorAll('ul.ap-items details')].every(x=>!x.open)`);
    t.jumpWorking = await timedClick('panel', '[data-testid="focus-jump-working"] button', `d.activeElement?.dataset.testid==='${order.working[0]}'`);
    t.jumpWorkingNext = await timedClick('panel', '[data-testid="focus-jump-working"] button', `d.activeElement?.dataset.testid==='${order.working[1]}'`);
    t.jumpBlocked = await timedClick('panel', '[data-testid="focus-jump-blocked"] button', `d.activeElement?.dataset.testid==='${order.blocked[0]}'`);
    t.expandAll = await timedClick('panel', '[data-testid="focus-expand-all"] button', `[...d.querySelectorAll('ul.ap-items details')].every(x=>x.open)`);
    t.showAll = await timedClick('panel', '[data-testid="focus-mode-all"] button', `d.querySelector('[data-testid="focus-mode"]')?.dataset.mode==='all'&&!d.querySelector('li[hidden]')`);
    perf.railFocusInteractionsMs = Object.fromEntries(Object.entries(t).map(([k, v]) => [k, Math.round(v * 10) / 10]));
    const after = (await requests(`q.surface==='panel'`)).filter((q: any) => q.at >= mark);
    check('Q8:focus-interactions-no-part-reads', !after.some((q: any) => q.method !== 'GET' || ['/v1/plan', '/v1/document', '/v1/history'].includes(q.path)), after.map((q: any) => q.path));
    check('Q8:focus-interactions-rows-kept', await guest<number>('panel', `return d.querySelectorAll('${ROWS}').length`) === 1000);
    await paints('panel');
  }

  // ================================================================ Q8: 1,000-item page (both modes)
  await evaluate(`qa.theme('dark');true`);
  await show('page', 1100);
  await instrument('page');
  await wait('page', `d.querySelector('[data-testid="plan-row-P-scale"]')`);
  {
    const mark = await hostNow();
    const ms = await timedClick('page', '[data-testid="plan-row-P-scale"]', `d.querySelectorAll('${ROWS}').length===1000`);
    perf.pageFirstRender = { untilRowsMs: Math.round(ms), paints: (await paints('page')).map((p) => ({ ms: Math.round(p.ms * 10) / 10, rows: p.rows })) };
    check('Q8:page-scale-counts', same(await counts('page'), ['198', '792', '594', '198']));
    check('Q8:page-only-selected-detail', (await requests(`q.surface==='page'&&q.path==='/v1/plan'`)).filter((q: any) => q.at >= mark).every((q: any) => q.query.plan === 'P-scale'));
  }

  // Narrow page: an explicit selection reveals the detail; does a later repaint scroll back to it?
  await evaluate(`qa.theme('light');true`);
  await show('page', 360);
  {
    await click('page', '[data-testid="plan-row-P-many"]');
    await wait('page', `d.querySelector('article[data-testid="plan-P-many"] ul.ap-items')`);
    await frameRaf('page');
    const revealed = await guest<number>('page', `return d.scrollingElement.scrollTop`);
    await guest('page', `d.scrollingElement.scrollTop=0;return true`);
    await evaluate(`qa.update('P-many',p=>{p.items.find(i=>i.id==='K8').title='Afterwards (edited)'});true`);
    await wait('page', `d.querySelector('[data-testid="item-K8"]')?.textContent.includes('edited')`, 'P-many repaint', 15_000);
    await frameRaf('page');
    const afterRepaint = await guest<number>('page', `return d.scrollingElement.scrollTop`);
    perf.narrowRevealRepeatsOnRepaint = afterRepaint > 50;
    if (!baseline) check('Q6:narrow-reveal-once', revealed > 50 && afterRepaint < 50, { revealed, afterRepaint });
  }

  if (!baseline) {
    // ================================================================ Q4 rail, light, 360px
    await show('panel', 360);
    await context('A');
    const art = 'article[data-testid="plan-P-focus"][data-source="source-focus"]';
    await wait('panel', `d.querySelector('${art} [data-testid="focus-controls"]')`, 'P-focus controls');
    const rowState = (s: string) => guest<Record<string, string>>(s, `const o={};for(const n of d.querySelectorAll('${art} ${ROWS}'))o[n.dataset.testid]=(n.hidden?'hidden':n.dataset.focus??'shown');return o`);
    const summary = (s: string) => guest<Record<string, string>>(s, `return {...d.querySelector('${art} [data-testid="focus-summary"]').dataset}`);
    const fmode = (s: string) => guest<string>(s, `return d.querySelector('${art} [data-testid="focus-mode"]').dataset.mode`);
    check('Q4:rail-counts', same(await counts('panel', art), ['2', '9', '7', '1']), await counts('panel', art));
    const allRows = await rowState('panel');
    check('Q4:rail-show-all-every-row', Object.keys(allRows).length === 14 && Object.values(allRows).every((v) => v !== 'hidden'), allRows);
    check('Q4:rail-show-all-summary', same([await fmode('panel'), (await summary('panel')).rows, (await summary('panel')).matching, (await summary('panel')).hidden], ['all', '10', '10', '0']), await summary('panel'));
    const agg = await guest('panel', `const g=id=>{const n=d.querySelector('${art} [data-testid="'+id+'"]');return [n.dataset.working,n.dataset.blocked,n.querySelector(':scope>details>summary').textContent]};return {G:g('group-G'),H:g('group-H'),Z:g('group-Z'),T:g('item-T')}`);
    check('Q4:rail-branch-aggregates', agg.G[0] === '1' && agg.G[1] === '1' && agg.Z[0] === '1' && agg.Z[1] === '1' && agg.T[0] === '0' && /1 in progress/.test(agg.G[2]) && /1 blocked/.test(agg.G[2]) && /2\/5/.test(agg.G[2]), agg);

    // Unfinished with a real mouse click.
    const navMark = await hostNow();
    await click('panel', `${art} [data-testid="focus-mode-unfinished"] button`);
    await wait('panel', `d.querySelector('${art} [data-testid="focus-mode"]').dataset.mode==='unfinished'`);
    const un = await rowState('panel');
    check('Q4:rail-unfinished-membership', same(un, {
      'group-G': 'context', 'group-H': 'context', 'item-D': 'hidden', 'item-S': 'hidden', 'item-W': 'match', 'item-B1': 'match', 'item-T': 'context', 'item-U': 'match',
      'group-E': 'hidden', 'group-Z': 'context', 'item-L': 'match', 'item-R': 'match', 'item-X': 'match', 'item-N': 'match',
    }), un);
    const us = await summary('panel');
    check('Q4:rail-unfinished-summary', same([us.rows, us.matching, us.context, us.hidden], ['10', '7', '1', '2']), us);
    check('Q4:rail-unfinished-full-counts', same(await counts('panel', art), ['2', '9', '7', '1']));
    check('Q4:rail-hidden-not-rendered', await guest('panel', `return [...d.querySelectorAll('${art} li[hidden]')].every(n=>getComputedStyle(n).display==='none'&&!n.checkVisibility())`));
    check('Q4:rail-context-labelled', await guest('panel', `return !!d.querySelector('${art} [data-testid="item-T"] .ap-context')&&!d.querySelector('${art} [data-testid="item-U"] .ap-context')`));
    check('Q4:rail-group-hidden-counts', same(await guest('panel', `return ['group-G','group-H','item-T','group-Z'].map(id=>d.querySelector('${art} [data-testid="'+id+'"]').dataset.filterHidden)`), ['2', '2', '0', '0']));
    check('Q4:rail-totals-labelled-full-plan', await guest('panel', `return /whole plan/i.test(d.querySelector('${art} [data-testid="focus-summary"]').textContent)`));
    await shot('panel', 'rail-controls-light');

    // Tab order through the task list never reaches a hidden row.
    await guest('panel', `w.focus();d.querySelector('${art} [data-testid="focus-expand-all"] button').focus();return true`);
    const tabbed: string[] = [];
    for (let i = 0; i < 12; i++) {
      await key('Tab');
      const id = await guest<string | null>('panel', `const a=d.activeElement;return a&&a.closest('ul.ap-items')?(a.closest('li[data-testid]')?.dataset.testid??null):'out:'+(a?.closest('[data-testid]')?.dataset.testid??a?.tagName)`);
      tabbed.push(id ?? '');
    }
    const listTabbed = tabbed.filter((x) => !x.startsWith('out:'));
    // Summaries are the only tab stops in the hierarchy (rows are tabindex -1); hidden E is skipped.
    check('Q4:rail-tab-skips-hidden', same(listTabbed, ['group-G', 'group-H', 'item-T', 'group-Z']), tabbed);

    // Collapse all with the keyboard (Tab from Expand all, Enter); Details and the document stay as they are.
    await click('panel', `${art} [data-testid="document-P-focus"] > summary`);
    await wait('panel', `d.querySelector('${art} [data-testid="document-P-focus"]').open`);
    await guest('panel', `d.querySelector('${art} [data-testid="focus-expand-all"] button').focus();return true`);
    await key('Tab');
    check('Q4:rail-tab-to-collapse-all', await guest('panel', `return !!d.activeElement?.closest('[data-testid="focus-collapse-all"]')`));
    await key('Enter');
    await wait('panel', `[...d.querySelectorAll('${art} ul.ap-items details')].every(x=>!x.open)`, 'collapse all');
    check('Q4:rail-collapse-only-task-disclosures', await guest('panel', `return d.querySelector('${art} [data-testid="document-P-focus"]').open&&!d.querySelector('[data-testid="details"]').open&&!!d.activeElement?.closest('[data-testid="focus-collapse-all"]')`));
    const folded = await guest('panel', `const s=id=>d.querySelector('${art} [data-testid="'+id+'"]>details>summary');return {G:s('group-G').innerText,Z:s('group-Z').innerText,gFolded:d.querySelector('${art} [data-testid="group-G"]').dataset.folded}`);
    check('Q4:rail-collapsed-keep-indicators', /1 in progress/.test(folded.G) && /1 blocked/.test(folded.G) && /4 tasks? folded/.test(folded.G) && /1 in progress/.test(folded.Z) && /1 blocked/.test(folded.Z) && folded.gFolded === '4', folded);
    await shot('panel', 'collapsed-indicators', `${art} [data-testid="focus-controls"]`);
    await key('Tab', 1, SHIFT);
    check('Q4:rail-shift-tab-to-expand-all', await guest('panel', `return !!d.activeElement?.closest('[data-testid="focus-expand-all"]')`));
    await key(' ');
    await wait('panel', `[...d.querySelectorAll('${art} ul.ap-items details')].every(x=>x.open)`, 'expand all (Space)');
    results.push({ id: 'Q4:rail-space-expands-all', pass: true });
    // Native summaries keep Enter/Space.
    await guest('panel', `d.querySelector('${art} [data-testid="group-toggle-G"]>summary').focus();return true`);
    await key('Enter');
    await wait('panel', `!d.querySelector('${art} [data-testid="group-toggle-G"]').open`, 'Enter closes G');
    await key(' ');
    await wait('panel', `d.querySelector('${art} [data-testid="group-toggle-G"]').open`, 'Space opens G');
    results.push({ id: 'Q4:rail-native-summary-keys', pass: true });

    // Jumps: collapsed ancestors open, canonical row focused once, repeated activation advances and wraps.
    await click('panel', `${art} [data-testid="focus-collapse-all"] button`);
    await wait('panel', `[...d.querySelectorAll('${art} ul.ap-items details')].every(x=>!x.open)`);
    await click('panel', `${art} [data-testid="focus-jump-working"] button`);
    await wait('panel', `d.activeElement?.dataset.testid==='item-W'`, 'jump focuses W');
    const landed = await guest('panel', `const n=d.activeElement,r=n.getBoundingClientRect();return {g:d.querySelector('${art} [data-testid="group-toggle-G"]').open,h:d.querySelector('${art} [data-testid="group-toggle-H"]').open,z:d.querySelector('${art} [data-testid="group-toggle-Z"]').open,inView:r.top>=0&&r.bottom<=w.innerHeight,ring:getComputedStyle(n).boxShadow!=='none',notice:d.querySelector('${art} [data-testid="focus-notice"]').textContent,mode:d.querySelector('${art} [data-testid="focus-mode"]').dataset.mode,animations:d.getAnimations().length}`);
    check('Q4:rail-jump-reveals-and-focuses', landed.g && landed.h && !landed.z && landed.inView && landed.ring && /1 of 2/.test(landed.notice) && landed.mode === 'unfinished' && landed.animations === 0, landed);
    await frameRaf('panel');
    await shot('panel', 'keyboard-target', null);
    await guest('panel', `d.querySelector('${art} [data-testid="focus-jump-working"] button').focus();return true`);
    await key('Enter');
    await wait('panel', `d.activeElement?.dataset.testid==='item-X'`, 'second jump focuses X');
    check('Q4:rail-jump-advances', await guest('panel', `return d.querySelector('${art} [data-testid="group-toggle-Z"]').open&&/2 of 2/.test(d.querySelector('${art} [data-testid="focus-notice"]').textContent)`));
    await click('panel', `${art} [data-testid="focus-jump-working"] button`);
    await wait('panel', `d.activeElement?.dataset.testid==='item-W'`, 'third jump wraps to W');
    await click('panel', `${art} [data-testid="focus-jump-blocked"] button`);
    await wait('panel', `d.activeElement?.dataset.testid==='item-B1'`, 'blocked jump B1');
    await click('panel', `${art} [data-testid="focus-jump-blocked"] button`);
    await wait('panel', `d.activeElement?.dataset.testid==='item-R'`, 'blocked jump R');
    results.push({ id: 'Q4:rail-jump-wraps-both-kinds', pass: true });

    // A later poll/revision neither replays the jump nor loses the reading state.
    await click('panel', `${art} [data-testid="group-toggle-H"] > summary`);
    await wait('panel', `!d.querySelector('${art} [data-testid="group-toggle-H"]').open`);
    await guest('panel', `d.querySelector('${art} [data-testid="item-R"]').focus({preventScroll:true});d.scrollingElement.scrollTop=0;return true`);
    await frameRaf('panel');
    await evaluate(`qa.update('P-focus',p=>{p.items.find(i=>i.id==='N').title='Notify the channel (edited)'});true`);
    await wait('panel', `d.querySelector('${art} [data-testid="item-N"]')?.textContent.includes('edited')`, 'P-focus repaint', 15_000);
    await frameRaf('panel');
    const kept = await guest('panel', `return {top:d.scrollingElement.scrollTop,active:d.activeElement?.dataset.testid,mode:d.querySelector('${art} [data-testid="focus-mode"]').dataset.mode,h:d.querySelector('${art} [data-testid="group-toggle-H"]').open}`);
    check('Q4:rail-poll-no-replay', kept.top < 2 && kept.active === 'item-R' && kept.mode === 'unfinished' && kept.h === false, kept);

    // The hidden done prerequisite D (readiness of L) is revealed through the same path: filters clear.
    await click('panel', `${art} [data-testid="readiness-entry-L"] [data-dep="D"] button`);
    await wait('panel', `d.activeElement?.dataset.testid==='item-D'`, 'readiness reveals hidden D');
    const revealedD = await guest('panel', `return {mode:d.querySelector('${art} [data-testid="focus-mode"]').dataset.mode,notice:d.querySelector('${art} [data-testid="focus-notice"]').textContent,h:d.querySelector('${art} [data-testid="group-toggle-H"]').open}`);
    check('Q4:rail-readiness-hidden-target-clears-filters', revealedD.mode === 'all' && /all tasks/i.test(revealedD.notice) && revealedD.h, revealedD);
    const navReqs = (await requests(`q.surface==='panel'`)).filter((q: any) => q.at >= navMark && q.path !== '/v1/plans' && q.path !== '/health' && q.path !== '/v1/setup');
    const writes = (await messages(`m.type==='storage'&&m.op!=='get'`)).length;
    check('Q4:rail-controls-send-nothing', navReqs.every((q: any) => q.method === 'GET' && q.path === '/v1/plan' && q.query.plan === 'P-focus') && navReqs.length <= 1 && !(await evaluate<boolean>(`qa.messages.some(m=>m.type==='open-session')`)), { navReqs: navReqs.map((q: any) => q.path), writes });

    // Reading identity: same-session directory move keeps it; another session (same plan) resets it, also on return.
    await click('panel', `${art} [data-testid="focus-mode-unfinished"] button`);
    await wait('panel', `d.querySelector('${art} [data-testid="focus-mode"]').dataset.mode==='unfinished'`);
    await context('A', '/fixture/focus/subfolder');
    await evaluate('new Promise(r=>setTimeout(r,300))');
    await wait('panel', `d.querySelector('${art} [data-testid="focus-controls"]')`);
    check('Q4:rail-directory-move-keeps-reading', await fmode('panel') === 'unfinished');
    await context('B');
    await wait('panel', `d.querySelector('${art} [data-testid="focus-mode"]')`, 'B shows P-focus');
    check('Q4:rail-other-session-resets', await fmode('panel') === 'all');
    await context('A');
    await wait('panel', `d.querySelector('${art} [data-testid="focus-mode"]')`);
    check('Q4:rail-return-does-not-restore', await fmode('panel') === 'all');

    // Work Status has no focus controls.
    await show('status', 360);
    await wait('status', `d.querySelector('[data-testid="counts"]')`);
    check('Q4:status-has-no-focus-controls', await guest('status', `return !d.querySelector('[data-testid="focus-controls"]')`));

    // ================================================================ Q4 page, dark, 1100px
    await evaluate(`qa.theme('dark');true`);
    await show('page', 1100);
    await click('page', '[data-testid="plan-row-P-focus"][data-source="source-focus"]');
    await wait('page', `d.querySelector('${art} [data-testid="focus-controls"]')`, 'page P-focus');
    check('Q4:page-counts', same(await counts('page', art), ['2', '9', '7', '1']));
    await click('page', `${art} [data-testid="focus-mode-unfinished"] button`);
    await wait('page', `d.querySelector('${art} [data-testid="focus-mode"]').dataset.mode==='unfinished'`);
    check('Q4:page-unfinished-membership', same(await rowState('page'), un));
    await click('page', `${art} [data-testid="group-toggle-Z"] > summary`);
    await wait('page', `!d.querySelector('${art} [data-testid="group-toggle-Z"]').open`);
    for (const id of ['B1', 'R', 'B1']) {
      await click('page', `${art} [data-testid="focus-jump-blocked"] button`);
      await wait('page', `d.activeElement?.dataset.testid==='item-${id}'`, `page blocked jump ${id}`);
    }
    results.push({ id: 'Q4:page-blocked-jumps-wrap', pass: true });
    await click('page', `${art} [data-testid="group-toggle-H"] > summary`);
    await wait('page', `!d.querySelector('${art} [data-testid="group-toggle-H"]').open`);
    await shot('page', 'page-controls-dark');
    // Same-plan tabs keep the reading state; host A/B/null leave the board alone.
    for (const tab of ['Document', 'History', 'Progress']) {
      await guest('page', `[...d.querySelectorAll('[data-testid="detail-tabs"] [role="tab"]')].find(t=>t.textContent==='${tab}').click();return true`);
      await wait('page', `[...d.querySelectorAll('[data-testid="detail-tabs"] [role="tab"]')].find(t=>t.textContent==='${tab}').getAttribute('aria-selected')==='true'`);
    }
    await wait('page', `d.querySelector('${art} [data-testid="focus-mode"]')`);
    check('Q4:page-tabs-keep-reading', await fmode('page') === 'unfinished' && await guest<boolean>('page', `return !d.querySelector('${art} [data-testid="group-toggle-H"]').open&&d.querySelector('${art} [data-testid="group-toggle-G"]').open`));
    await context('B'); await context(null);
    await evaluate('new Promise(r=>setTimeout(r,300))');
    check('Q4:page-host-context-keeps-reading', await fmode('page') === 'unfinished');
    // Another plan, then back: a new reading.
    await click('page', '[data-testid="plan-row-P-many"]');
    await wait('page', `d.querySelector('article[data-testid="plan-P-many"] [data-testid="focus-controls"]')`);
    // Beyond Now's cap: six working tasks, jumps reach all of them and wrap.
    check('Q4:now-cap-unchanged', await guest('page', `const n=d.querySelector('[data-testid="current-work"]');return n.querySelectorAll('.ap-now-item').length===4&&n.textContent.includes('and 3 more')`));
    for (const id of ['K1', 'K2', 'K3', 'K4', 'K5', 'K6', 'K1']) {
      await click('page', `article[data-testid="plan-P-many"] [data-testid="focus-jump-working"] button`);
      await wait('page', `d.activeElement?.dataset.testid==='item-${id}'`, `page working jump ${id}`);
    }
    check('Q4:page-jumps-beyond-now-cap', await guest('page', `return /1 of 6/.test(d.querySelector('[data-testid="focus-notice"]').textContent)`));
    await click('page', '[data-testid="plan-row-P-focus"][data-source="source-focus"]');
    await wait('page', `d.querySelector('${art} [data-testid="focus-mode"]')`);
    check('Q4:page-plan-change-resets', await fmode('page') === 'all');
    check('Q4:no-service-writes', (await requests(`q.method!=='GET'`)).length === 0);
    check('Q4:no-storage-writes-from-reading', (await messages(`m.type==='storage'&&m.op!=='get'&&m.surface==='page'`)).length === 0);

    // ================================================================ Q5 participant filter (page 1100 dark, then rail 360 light)
    const foreignArt = 'article[data-testid="plan-P-focus"][data-source="source-focus-other"]';
    const part = (s: string, a = art) => guest<{ key: string; available: string; value: string } | null>(s, `const n=d.querySelector('${a} [data-testid="focus-participant"]');return n?{key:n.dataset.participant,available:n.dataset.available,value:n.querySelector('.oc-sdk-trigger-value')?.textContent??''}:null`);
    const matched = (s: string, a = art) => guest<string[]>(s, `return [...d.querySelectorAll('${a} li[data-focus="match"]')].map(n=>n.dataset.testid).filter(x=>x.startsWith('item-')).map(x=>x.slice(5))`);
    const contextRows = (s: string) => guest<string[]>(s, `return [...d.querySelectorAll('${art} li[data-focus="context"]')].map(n=>n.dataset.testid)`);
    const reasons = (s: string, a = art) => guest<Record<string, string>>(s, `const o={};for(const n of d.querySelectorAll('${a} [data-testid^="reasons-"]'))o[n.dataset.testid.slice(8)]=n.dataset.relations;return o`);
    const reasonText = (s: string, id: string) => guest<string>(s, `return d.querySelector('${art} [data-testid="reasons-${id}"]')?.textContent??''`);
    /** Opens a kit select with the mouse and reads its options (label + hint). */
    const openOptions = async (s: string, holder: string) => {
      await click(s, `${holder} .oc-sdk-trigger`);
      await wait(s, `d.querySelector('.oc-sdk-popup [role="listbox"] [role="option"]')`, `${holder} options`);
      return guest<{ label: string; hint: string }[]>(s, `return [...d.querySelectorAll('.oc-sdk-popup [role="listbox"] [role="option"]')].map(n=>({label:n.querySelector('.oc-sdk-option-label')?.textContent??'',hint:n.querySelector('.oc-sdk-option-hint')?.textContent??''}))`);
    };
    /** Mouse to open, real keys to pick (Home, ArrowDown × index, Enter); waits for the popup to close. */
    const choose = async (s: string, holder: string, label: string | number) => {
      const options = await openOptions(s, holder);
      const index = typeof label === 'number' ? label : options.findIndex((o) => o.label === label);
      if (index < 0) throw new Error(`no option ${label} in ${holder}: ${JSON.stringify(options.map((o) => o.label))}`);
      await key('Home'); if (index) await key('ArrowDown', index); await key('Enter');
      await wait(s, `!d.querySelector('.oc-sdk-popup [role="listbox"]')`, `${holder} closed`);
      return options;
    };
    const P = `${art} [data-testid="focus-participant"]`;
    const pickPart = async (s: string, label: string, want: string) => { await choose(s, P, label); await wait(s, `d.querySelector('${P}')?.dataset.participant===${JSON.stringify(want)}`, `participant ${want}`); };
    const readinessCounts = (s: string) => guest<string[]>(s, `return [...d.querySelectorAll('${art} [data-testid^="readiness-"][data-count]')].map(n=>n.dataset.testid+'='+n.dataset.count)`);

    // Page: the board's own session filter never picks the task participant.
    await choose('page', '[data-testid="filter-session"]', 'Planner session');
    await wait('page', `d.querySelector('[data-testid="plan-row-P-focus"][data-source="source-focus"]')`);
    await click('page', '[data-testid="plan-row-P-focus"][data-source="source-focus"]');
    await wait('page', `d.querySelector('${P}')`, 'page participant control');
    check('Q5:page-board-session-filter-not-inferred', (await part('page'))?.key === 'all', await part('page'));
    check('Q5:bound-plan-keeps-host-titles', await guest<boolean>('page', `const a=d.querySelector('${art}');return /Review session/.test(a.querySelector('[data-testid="item-W"] .ap-chip')?.textContent??'')&&/Reported by Planner session for Session C/.test(a.querySelector('[data-testid="relay-R"]')?.textContent??'')&&/Review session/.test(a.querySelector('[data-testid="contributors"]').textContent)`));
    await pickPart('page', 'Review session', 's:B');
    check('Q5:page-B-membership', same(await matched('page'), ['D', 'W', 'L', 'R']), await matched('page'));
    check('Q5:page-B-full-counts', same(await counts('page', art), ['2', '9', '7', '1']));
    await choose('page', '[data-testid="filter-session"]', 0);
    await wait('page', `d.querySelector('[data-testid="plan-row-P-focus"][data-source="source-focus-other"]')`);
    // Same plan, item and session IDs from another, unverified source: plain labels, its own membership, nothing merged.
    await click('page', '[data-testid="plan-row-P-focus"][data-source="source-focus-other"]');
    await wait('page', `d.querySelector('${foreignArt} [data-testid="focus-participant"]')`, 'foreign plan controls');
    check('Q5:foreign-plan-starts-at-all', (await part('page', foreignArt))?.key === 'all');
    const foreignOptions = await openOptions('page', `${foreignArt} [data-testid="focus-participant"]`);
    await key('Escape');
    await wait('page', `!d.querySelector('.oc-sdk-popup [role="listbox"]')`);
    check('Q5:foreign-plain-labels', same(foreignOptions.map((o) => o.label), ['All participants', 'Session A', 'Session B', 'Session C', 'Session D', 'No participant recorded']), foreignOptions);
    await choose('page', `${foreignArt} [data-testid="focus-participant"]`, 'Session B');
    await wait('page', `d.querySelector('${foreignArt} [data-testid="focus-participant"]').dataset.participant==='s:B'`);
    const rowText = (source: string) => guest<string>('page', `return d.querySelector('[data-testid="plan-row-P-focus"][data-source="${source}"]')?.textContent??''`);
    const [boundRow, foreignRow] = [await rowText('source-focus'), await rowText('source-focus-other')];
    check('Q5:board-list-subtitle-source-safe', /Planner session/.test(boundRow) && /Session A/.test(foreignRow) && !/Planner session|Review session/.test(foreignRow), { boundRow, foreignRow });
    check('Q5:foreign-membership-not-merged', same(await matched('page', foreignArt), ['D', 'W', 'R']), await matched('page', foreignArt));
    // Existing surfaces of the foreign plan (row chips, relay line, Now, Sessions) never borrow host titles or live state.
    const foreignFacts = await guest<Record<string, any>>('page', `const a=d.querySelector('${foreignArt}'),t=s=>a.querySelector(s)?.textContent??'';return {all:a.textContent,chipW:t('[data-testid="item-W"] .ap-chip'),relay:t('[data-testid="relay-R"]'),now:t('[data-testid="current-work"]'),people:t('[data-testid="contributors"]'),open:a.querySelectorAll('[data-testid^="open-session"]').length}`);
    check('Q5:foreign-existing-surfaces-plain-labels', !/Review session|Planner session|Idle/.test(foreignFacts.all) && /Session B/.test(foreignFacts.chipW) && /from another OpenCode setup/.test(foreignFacts.chipW)
      && /Reported by Session A for Session C/.test(foreignFacts.relay) && /Session B/.test(foreignFacts.now) && /Session A/.test(foreignFacts.people) && /Session B/.test(foreignFacts.people) && foreignFacts.open === 0, { ...foreignFacts, all: undefined });
    check('Q5:foreign-reasons-no-host-names', await guest<boolean>('page', `return ![...d.querySelectorAll('${foreignArt} [data-testid^="reasons-"], ${foreignArt} [data-testid="focus-summary"], ${foreignArt} [data-testid="focus-participant"]')].some(n=>/Review session|Planner session/.test(n.textContent))`));
    // A different, independent plan: a new reading with its own options.
    await click('page', '[data-testid="plan-row-P-many"]');
    await wait('page', `d.querySelector('article[data-testid="plan-P-many"] [data-testid="focus-participant"]')`);
    const manyOptions = await openOptions('page', 'article[data-testid="plan-P-many"] [data-testid="focus-participant"]');
    await key('Escape');
    await wait('page', `!d.querySelector('.oc-sdk-popup [role="listbox"]')`);
    check('Q5:independent-plan-own-options', await guest<string>('page', `return d.querySelector('article[data-testid="plan-P-many"] [data-testid="focus-participant"]').dataset.participant`) === 'all'
      && same(manyOptions.map((o) => o.label), ['All participants', 'Many session', 'No participant recorded']) && /8 tasks/.test(manyOptions[2].hint), manyOptions);

    // Rail: the selected host session never preselects the participant either.
    await evaluate(`qa.theme('light');true`);
    await show('panel', 360);
    await context('B');
    await wait('panel', `d.querySelector('${P}')`, 'rail participant (B)');
    check('Q5:rail-host-session-not-inferred', (await part('panel'))?.key === 'all', await part('panel'));
    await context('A');
    await wait('panel', `d.querySelector('${P}')`, 'rail participant (A)');
    check('Q5:rail-owner-not-inferred', (await part('panel'))?.key === 'all');
    const q5Mark = await hostNow();
    const q5Writes = (await messages(`m.surface==='panel'&&m.type==='storage'&&m.op!=='get'`)).length;
    const railOptions = await openOptions('panel', P);
    await shot('panel', 'participant-options', null);
    await key('Escape');
    await wait('panel', `!d.querySelector('.oc-sdk-popup [role="listbox"]')`);
    check('Q5:rail-options-include-report-only', same(railOptions.map((o) => o.label), ['All participants', 'Planner session', 'Review session', 'Session C', 'Session D', 'No participant recorded'])
      && /main session/.test(railOptions[1].hint) && /1 task\b/.test(railOptions[1].hint) && /4 tasks/.test(railOptions[2].hint) && /4 tasks/.test(railOptions[5].hint), railOptions);
    check('Q5:report-only-session-absent-from-sessions-summary', await guest<boolean>('panel', `return !d.querySelector('${art} [data-testid="contributor-D"]')`));

    // B: assignment, link context and a direct report, each task once.
    const readinessBefore = await readinessCounts('panel');
    await pickPart('panel', 'Review session', 's:B');
    check('Q5:readiness-ignores-participant', readinessBefore.length > 0 && same(await readinessCounts('panel'), readinessBefore), { before: readinessBefore, after: await readinessCounts('panel') });
    check('Q5:rail-B-membership', same(await matched('panel'), ['D', 'W', 'L', 'R']), await matched('panel'));
    check('Q5:rail-B-reasons', same(await reasons('panel'), { D: 'assigned', W: 'assigned', L: 'linked', R: 'direct' }), await reasons('panel'));
    check('Q5:link-is-not-assignment', /not an assignment/.test(await reasonText('panel', 'L')));
    check('Q5:rail-B-summary', /4 matching tasks for Review session/.test(await guest<string>('panel', `return d.querySelector('${art} [data-testid="focus-summary"]').textContent`)) && same(await counts('panel', art), ['2', '9', '7', '1']));
    check('Q5:participant-focus-returns-to-control', await guest<boolean>('panel', `return !!d.activeElement?.closest('[data-testid="focus-participant"]')`));
    await click('panel', `${art} [data-testid="focus-mode-unfinished"] button`);
    await wait('panel', `d.querySelector('${art} [data-testid="focus-mode"]').dataset.mode==='unfinished'`);
    check('Q5:rail-B-unfinished', same(await matched('panel'), ['W', 'L', 'R']) && (await rowState('panel'))['item-D'] === 'hidden', await matched('panel'));
    // C: assignment plus the relay child; the relay line keeps reporter and child.
    await pickPart('panel', 'Session C', 's:C');
    check('Q5:rail-C-membership', same(await matched('panel'), ['B1', 'R']) && same(await reasons('panel'), { B1: 'assigned', R: 'relayed-for' }), await reasons('panel'));
    check('Q5:relay-line-kept', /Reported by Planner session for Session C/.test(await guest<string>('panel', `return d.querySelector('${art} [data-testid="relay-R"]')?.textContent??''`)) && /Reported for this session/.test(await reasonText('panel', 'R')));
    await shot('panel', 'participant-relay');
    // A, the owner: only the relayed report, never every owner task.
    await pickPart('panel', 'Planner session', 's:A');
    check('Q5:rail-A-relay-reporter-only', same(await matched('panel'), ['R']) && same(await reasons('panel'), { R: 'relayed-by' }) && /Relayed by this session/.test(await reasonText('panel', 'R')), await reasons('panel'));
    // D: a recorded reporter whose report mode is unknown.
    await pickPart('panel', 'Session D', 's:D');
    check('Q5:rail-D-reporter-mode-unknown', same(await matched('panel'), ['X']) && same(await reasons('panel'), { X: 'reporter' }) && /report mode unavailable/.test(await reasonText('panel', 'X')), await reasons('panel'));
    // No participant recorded: unknown participation, not "unassigned".
    await pickPart('panel', 'No participant recorded', 'none');
    check('Q5:rail-none-unfinished', same(await matched('panel'), ['U', 'N']) && same(await contextRows('panel'), ['group-G', 'item-T', 'group-Z']), { m: await matched('panel'), c: await contextRows('panel') });
    await click('panel', `${art} [data-testid="focus-mode-all"] button`);
    await wait('panel', `d.querySelector('${art} [data-testid="focus-mode"]').dataset.mode==='all'`);
    check('Q5:rail-none-show-all', same(await matched('panel'), ['S', 'T', 'U', 'N']) && Object.values(await reasons('panel')).every((r) => r === 'none'), await matched('panel'));
    // Jumps search the whole plan: an excluded target clears both filters, a matching one keeps them.
    await pickPart('panel', 'Session C', 's:C');
    await click('panel', `${art} [data-testid="focus-mode-unfinished"] button`);
    await wait('panel', `d.querySelector('${art} [data-testid="focus-mode"]').dataset.mode==='unfinished'`);
    await click('panel', `${art} [data-testid="focus-jump-blocked"] button`);
    await wait('panel', `['item-B1','item-R'].includes(d.activeElement?.dataset.testid)`, 'blocked jump within C');
    check('Q5:jump-matching-target-keeps-filters', (await part('panel'))?.key === 's:C' && await fmode('panel') === 'unfinished');
    await click('panel', `${art} [data-testid="focus-jump-working"] button`);
    await wait('panel', `d.activeElement?.dataset.testid==='item-W'`, 'working jump to W (not C’s)');
    const cleared = await guest('panel', `return {mode:d.querySelector('${art} [data-testid="focus-mode"]').dataset.mode,p:d.querySelector('${P}').dataset.participant,notice:d.querySelector('${art} [data-testid="focus-notice"]').textContent}`);
    check('Q5:jump-excluded-target-clears-both', cleared.mode === 'all' && cleared.p === 'all' && /Showing all tasks/.test(cleared.notice), cleared);
    // A chosen participant that disappears stays chosen, unavailable, with no matches.
    await pickPart('panel', 'Session D', 's:D');
    await evaluate(`qa.update('P-focus',p=>{delete p.items.find(i=>i.id==='X').reporterSessionId});true`);
    await wait('panel', `d.querySelector('${P}')?.dataset.available==='false'`, 'D no longer recorded', 15_000);
    const gone = await guest('panel', `return {p:d.querySelector('${P}').dataset.participant,value:d.querySelector('${P} .oc-sdk-trigger-value').textContent,empty:d.querySelector('${art} [data-testid="focus-empty"]')?.textContent??'',matching:d.querySelector('${art} [data-testid="focus-summary"]').dataset.matching,hidden:d.querySelectorAll('${art} li[hidden]').length}`);
    check('Q5:removed-participant-stays-selected', gone.p === 's:D' && gone.value === 'Session D' && gone.matching === '0' && /no longer records Session D/.test(gone.empty) && gone.hidden > 0, gone);
    check('Q5:removed-participant-full-counts', same(await counts('panel', art), ['2', '9', '7', '1']));
    await shot('panel', 'no-match');
    await click('panel', `${art} [data-testid="focus-clear"] button`);
    await wait('panel', `d.querySelector('${P}')?.dataset.participant==='all'&&d.querySelector('${art} [data-testid="focus-mode"]').dataset.mode==='all'`, 'clear task filters');
    check('Q5:clear-resets-both', !(await guest<boolean>('panel', `return !!d.querySelector('${art} li[hidden]')`)));
    const q5Reqs = (await requests(`q.surface==='panel'`)).filter((q: any) => q.at >= q5Mark && !['/v1/plans', '/health', '/v1/setup'].includes(q.path));
    check('Q5:no-service-session-or-storage-writes', q5Reqs.every((q: any) => q.method === 'GET' && q.path === '/v1/plan' && q.query.plan === 'P-focus')
      && (await messages(`m.surface==='panel'&&m.type==='storage'&&m.op!=='get'`)).length === q5Writes && !(await evaluate<boolean>(`qa.messages.some(m=>m.type==='open-session')`)), q5Reqs.map((q: any) => q.path));
    check('Q5:no-open-session-in-task-view', await guest<boolean>('panel', `return !d.querySelector('${art} [data-testid="focus-controls"] [data-testid^="open-session"], ${art} ul.ap-items [data-testid^="open-session"]')`));
    await evaluate(`qa.update('P-focus',p=>{p.items.find(i=>i.id==='X').reporterSessionId='D'});true`);
    await wait('panel', `d.querySelector('${art}')?.dataset.revision===String(qa.plan('P-focus').summary.revision)`, 'restored X reporter', 15_000);
    // Unverified binding: an authority reset (back to All participants) and no host names at all.
    await pickPart('panel', 'Review session', 's:B');
    await evaluate(`qa.binding={sourceId:'source-focus',verified:false};true`);
    await wait('panel', `d.querySelector('${P}')?.dataset.participant==='all'`, 'binding change resets', 15_000);
    const unverified = await openOptions('panel', P);
    await key('Escape');
    await wait('panel', `!d.querySelector('.oc-sdk-popup [role="listbox"]')`);
    check('Q5:unverified-binding-plain-labels', same(unverified.map((o) => o.label), ['All participants', 'Session A', 'Session B', 'Session C', 'Session D', 'No participant recorded']), unverified);
    await wait('page', `![...d.querySelectorAll('[data-testid^="plan-row-"]')].some(n=>/Planner session|Many session|Scale session/.test(n.textContent))`, 'board rows plain while unverified', 15_000);
    results.push({ id: 'Q5:unverified-binding-board-rows-plain', pass: true });
    await context('B');
    await wait('panel', `/contributes to a plan from Session A\./.test(d.querySelector('[data-testid="helping-note"]')?.textContent??'')`, 'rail note plain while unverified', 15_000);
    results.push({ id: 'Q5:unverified-binding-helping-note-plain', pass: true });
    await context('A');
    await evaluate(`qa.binding={sourceId:'source-focus',verified:true};true`);
    await wait('panel', `d.querySelector('${art} [data-testid="readiness-link-L"]')?.textContent.includes('Review session')`, 'binding verified again', 15_000);
    await evaluate('qa.railAll=true;true');
    await context('B');
    await wait('panel', `d.querySelector('[data-testid="plan-selector"]')&&/Planner session/.test(d.querySelector('[data-testid="helping-note"]')?.textContent??'')`, 'rail B: bound plan note', 15_000);
    check('Q5:rail-helping-note-bound-keeps-host-title', /contributes to a plan from Planner session\./.test(await guest<string>('panel', `return d.querySelector('[data-testid="helping-note"]').textContent`)));
    await choose('panel', '[data-testid="plan-selector"]', 'Other setup focus plan');
    await wait('panel', `d.querySelector('${foreignArt}')`, 'rail foreign plan', 15_000);
    const railForeign = await guest<string>('panel', `return d.querySelector('[data-testid="helping-note"]')?.textContent??''`);
    check('Q5:rail-helping-note-foreign-plain', /contributes to a plan from Session A\./.test(railForeign) && !/Planner session/.test(railForeign), railForeign);
    await choose('panel', '[data-testid="plan-selector"]', 'Focus controls example');
    await wait('panel', `d.querySelector('${art}')`, 'rail back to the bound plan');
    await evaluate('qa.railAll=false;true');
    await context('A');
    await wait('panel', `d.querySelector('${art} [data-testid="focus-controls"]')`, 'rail A again', 15_000);
    // ================================================================ Q8 controlled revision-change-during-load windows (Q10 in the browser)
    // Frames: rail (session S), Work Status (session S) and board, all reading the 1,000-item plan (50 detail pages).
    // Detail requests are classified from each frame's request stream: a first page directly after a
    // continuation that answered another revision is an internal restart (source.ts); any other first
    // page is a controller read start. Repaints are forced with live-session pulses meanwhile.
    const SP = 'P-scale';
    const sleep = (ms: number) => evaluate(`new Promise(r=>setTimeout(r,${ms}))`);
    const quiet = async (plan: string, ms = 1500, held = 0) => {
      for (const end = Date.now() + 25_000; Date.now() < end;) {
        const last = await evaluate<number>(`Math.max(0,...qa.requests.filter(q=>q.path==='/v1/plan'&&q.query?.plan==='${plan}').map(q=>q.at))`);
        if ((await hostNow()) - last > ms && (await evaluate<number>('qa.held.length')) <= held) return;
        await sleep(250);
      }
      const t = await hostNow();
      const recent = (await requests(`q.path==='/v1/plan'&&q.query?.plan==='${plan}'`)).filter((q: any) => q.at >= t - 3000);
      throw new Error(`detail reads of ${plan} did not settle: ${JSON.stringify({ held: await evaluate('qa.held.length'), recent: recent.reduce((o: any, q: any) => { const k = `${q.surface}:${q.query?.cursor ? 'page' : 'first'}:r${q.revision}`; o[k] = (o[k] ?? 0) + 1; return o; }, {}), listRev: await evaluate(`qa.plan('${plan}').summary.revision`) })}`);
    };
    const classify = (reqs: any[]) => {
      let readStarts = 0, restarts = 0, pages = 0, current: number | null = null, prev: any = null;
      // Compact stream signature: F<revision> per first page, P×n per run of continuation pages.
      const sig: string[] = [];
      for (const q of reqs) {
        if (q.query?.cursor) { const m = /^P×(\d+)$/.exec(sig.at(-1) ?? ''); if (m) sig[sig.length - 1] = `P×${Number(m[1]) + 1}`; else sig.push('P×1'); } else sig.push(`F${q.revision ?? '?'}`);
        if (!q.query?.cursor) {
          if (prev?.query?.cursor && prev.revision !== undefined && current !== null && prev.revision !== current) restarts++; else readStarts++;
          current = q.revision ?? null;
        } else pages++;
        prev = q;
      }
      return { readStarts, restarts, pages, stream: sig.join(' ') };
    };
    const streams = async (plan: string, mark: number) => {
      const reqs = (await requests(`q.path==='/v1/plan'&&q.query?.plan==='${plan}'`)).filter((q: any) => q.at >= mark).sort((a: any, b: any) => a.at - b.at);
      return Object.fromEntries(['panel', 'status', 'page'].map((s) => [s, classify(reqs.filter((q: any) => q.surface === s))]));
    };
    const pulses = async (n: number, from = 0) => { for (let i = 0; i < n; i++) { await evaluate(`qa.pulse(${from + i});true`); await sleep(100); } };
    const setHidden = (s: string, hidden: boolean) => guest(s, hidden
      ? `Object.defineProperty(d,'visibilityState',{configurable:true,get:()=>'hidden'});d.dispatchEvent(new Event('visibilitychange'));return true`
      : `delete d.visibilityState;d.dispatchEvent(new Event('visibilitychange'));return true`);
    const edit = (plan: string, k: number) => evaluate<number>(`qa.update('${plan}',p=>{p.items.find(i=>i.id==='ST${200 + k}').title='Storm edit ${k}'})`);
    const heldBy = (s: string) => `qa.held.some(h=>h.surface==='${s}')`;
    await evaluate(`qa.theme('light');true`);
    await show('panel', 360);
    await context('S');
    await wait('panel', `d.querySelectorAll('${ROWS}').length===1000`, 'rail scale plan', 20_000);
    await show('page', 1100);
    await click('page', '[data-testid="plan-row-P-scale"]');
    await wait('page', `d.querySelectorAll('${ROWS}').length===1000`, 'board scale plan', 20_000);
    await instrument('status');
    const stormWindows: Record<string, unknown>[] = [];
    let editNo = 0;
    const stormWindow = async (name: string, mode: 'lagging-list' | 'superseded-reply', hiddenStatus: boolean) => {
      await quiet(SP);
      for (const s of ['panel', 'page', 'status']) await paints(s);
      const mark = await hostNow();
      const start = await evaluate<number>(`qa.plan('${SP}').summary.revision`);
      if (hiddenStatus) await setHidden('status', true);
      const frames = hiddenStatus ? ['panel', 'page'] : ['panel', 'page', 'status'];
      let announced = 0;
      if (mode === 'lagging-list') {
        // r1 is announced; while its reads are mid-flight the service moves to r2 and the list keeps announcing r1.
        await evaluate(`qa.hold={path:'/v1/plan',cursor:true,plan:'${SP}'};true`);
        await edit(SP, editNo++); announced++;
        for (const s of frames) await wait(s, heldBy(s), `${name}: ${s} read in flight`, 10_000);
        await evaluate(`qa.hold=null;qa.lag['${SP}']=JSON.parse(JSON.stringify(qa.plan('${SP}').summary));true`);
        await edit(SP, editNo++);
        await evaluate('qa.release()');
        await pulses(20, editNo * 100);
        await sleep(4500); // the lagging list is polled at least twice more
        await evaluate(`delete qa.lag['${SP}'];true`); announced++;
      } else {
        // r1's first page is held with its own (older) revision; r2 is announced before that superseded reply lands.
        await evaluate(`qa.hold={path:'/v1/plan',cursor:false,plan:'${SP}',eager:true};true`);
        await edit(SP, editNo++); announced++;
        for (const s of frames) await wait(s, heldBy(s), `${name}: ${s} first page held`, 10_000);
        await evaluate('qa.hold=null;true');
        await edit(SP, editNo++); announced++;
        await pulses(20, editNo * 100);
        await sleep(1500);
        await evaluate('qa.release()');
      }
      await pulses(10, editNo * 100 + 50);
      await sleep(4000);
      let hiddenRequests: number | null = null;
      if (hiddenStatus) {
        hiddenRequests = (await requests(`q.surface==='status'`)).filter((q: any) => q.at >= mark).length;
        await setHidden('status', false);
        await sleep(4000);
      }
      await quiet(SP);
      const counts = await streams(SP, mark);
      const painted = Object.fromEntries(await Promise.all(['panel', 'page', 'status'].map(async (s) => [s, (await paints(s)).length])));
      const end = await evaluate<number>(`qa.plan('${SP}').summary.revision`);
      const entry = { window: name, mode, hiddenStatus, revisions: `${start}→${end}`, announcedRevisionChanges: announced, perFrame: counts, repaintsPerFrame: painted, statusRequestsWhileHidden: hiddenRequests };
      stormWindows.push(entry);
      for (const s of ['panel', 'page', 'status']) {
        const k = counts[s];
        // A hidden frame observes at most the latest change once it is shown again.
        const observed = hiddenStatus && s === 'status' ? 1 : announced;
        check(`Q8:storm-${name}-${s}-reads-bounded`, k.readStarts >= 1 && k.readStarts <= observed && k.restarts <= 3 * k.readStarts && k.pages <= 49 * (k.readStarts + k.restarts), { ...k, observed, repaints: painted[s] });
      }
      if (hiddenStatus) check(`Q8:storm-${name}-hidden-status-silent`, hiddenRequests === 0, hiddenRequests);
      check(`Q8:storm-${name}-repaints-forced`, painted.panel >= 10, painted);
      check(`Q8:storm-${name}-converged`, await guest<boolean>('panel', `return d.querySelector('article[data-testid="plan-${SP}"]')?.dataset.revision==='${end}'&&d.querySelectorAll('${ROWS}').length===1000`)
        && await guest<boolean>('page', `return d.querySelector('article[data-testid="plan-${SP}"]')?.dataset.revision==='${end}'`));
    };
    await stormWindow('lagging-list', 'lagging-list', false);
    await stormWindow('superseded-reply', 'superseded-reply', false);
    await stormWindow('hidden-work-status', 'lagging-list', true);
    requestFacts.stormWindows = stormWindows;

    // ================================================================ Q6 races and changing structure
    const scaleArt = `article[data-testid="plan-${SP}"]`;
    const race: Record<string, unknown> = {};
    // Held page 2 of the old authority, then a colliding-ID authority change; the old reply lands last.
    await show('panel', 360);
    for (const variant of ['store', 'account', 'session'] as const) {
      await quiet(SP);
      await click('panel', `${scaleArt} [data-testid="focus-mode-unfinished"] button`);
      await wait('panel', `d.querySelector('${scaleArt} [data-testid="focus-mode"]').dataset.mode==='unfinished'`);
      await click('panel', `${scaleArt} [data-testid="group-toggle-SG5"] > summary`);
      await wait('panel', `!d.querySelector('${scaleArt} [data-testid="group-toggle-SG5"]').open`);
      await evaluate(`qa.hold={surface:'panel',path:'/v1/plan',cursor:true,plan:'${SP}',eager:true,once:true};true`);
      await edit(SP, editNo++);
      await wait('panel', heldBy('panel'), `${variant}: page 2 held`, 10_000);
      if (variant === 'store') await evaluate(`qa.store=qa.store==='store-focus'?'store-focus-2':'store-focus';true`);
      if (variant === 'account') { await evaluate(`qa.account=qa.account==='fixture'?'fixture-2':'fixture';true`); await context('S'); }
      if (variant === 'session') { await context('A'); await sleep(300); await context('S'); }
      const now = await evaluate<number>(`qa.plan('${SP}').summary.revision`);
      await wait('panel', `d.querySelector('${scaleArt}')?.dataset.revision==='${now}'&&d.querySelectorAll('${ROWS}').length===1000&&d.querySelector('${scaleArt} [data-testid="focus-mode"]')?.dataset.mode==='all'`, `${variant}: new authority painted`, 25_000);
      await quiet(SP, 1500, 1);
      const rel = await hostNow();
      await evaluate('qa.release()');
      await sleep(2000);
      const after = (await requests(`q.surface==='panel'&&q.path==='/v1/plan'&&q.query?.plan==='${SP}'`)).filter((q: any) => q.at >= rel).length;
      const state = await guest('panel', `const a=d.querySelector('${scaleArt}');return {mode:a.querySelector('[data-testid="focus-mode"]').dataset.mode,sg5:a.querySelector('[data-testid="group-toggle-SG5"]').open,rows:d.querySelectorAll('${ROWS}').length,error:!!a.querySelector('[data-testid="detail-loading"]'),hidden:a.querySelectorAll('li[hidden]').length}`);
      race[`authority-${variant}`] = { requestsAfterOldReply: after, ...state };
      check(`Q6:${variant}-change-retires-held-read`, after === 0 && state.rows === 1000 && !state.error, race[`authority-${variant}`]);
      check(`Q6:${variant}-change-no-cross-authority-reading`, state.mode === 'all' && state.sg5 === true && state.hidden === 0, state);
      check(`Q6:${variant}-counts`, same(await counts('panel', scaleArt), ['198', '792', '594', '198']));
    }
    await evaluate(`qa.store='store-focus';qa.account='fixture';true`);
    await context('S');
    await quiet(SP);

    // Reparent, remove and fold around a focused row; new groups default open; user-moved focus wins.
    await context('A');
    await wait('panel', `d.querySelector('${art} [data-testid="focus-controls"]')`, 'P-focus again');
    const rev = () => evaluate<number>(`qa.plan('P-focus').summary.revision`);
    const repainted = async (what: string) => { const r = await rev(); await wait('panel', `d.querySelector('${art}')?.dataset.revision==='${r}'&&d.querySelector('${art} [data-testid="focus-controls"]')`, what, 15_000); await frameRaf('panel'); };
    const active = () => guest<string>('panel', `const a=d.activeElement;return a?.tagName==='SUMMARY'?'summary:'+a.parentElement.dataset.testid:a?.dataset?.testid??a?.closest('[data-testid]')?.dataset.testid??a?.tagName`);
    await click('panel', `${art} [data-testid="focus-expand-all"] button`);
    await guest('panel', `d.querySelector('${art} [data-testid="item-U"]').focus({preventScroll:true});return true`);
    await evaluate(`qa.update('P-focus',p=>{p.items.find(i=>i.id==='U').parentId='Z';p.summary.structuralRevision++});true`);
    await repainted('U reparented');
    check('Q6:reparented-focus-survives', await active() === 'item-U' && await guest<boolean>('panel', `return !!d.querySelector('${art} [data-testid="group-Z"] [data-testid="item-U"]')`), await active());
    await click('panel', `${art} [data-testid="group-toggle-H"] > summary`);
    await wait('panel', `!d.querySelector('${art} [data-testid="group-toggle-H"]').open`);
    await guest('panel', `d.querySelector('${art} [data-testid="item-U"]').focus({preventScroll:true});return true`);
    const topBefore = await guest<number>('panel', `return d.scrollingElement.scrollTop`);
    await evaluate(`qa.update('P-focus',p=>{p.items=p.items.filter(i=>i.id!=='U');p.items.push({id:'NG',title:'New follow-up group',kind:'group',status:'pending'},{id:'NT',title:'New follow-up task',kind:'task',status:'pending',parentId:'NG'});p.summary.structuralRevision++});true`);
    await repainted('U removed, NG added');
    const fallback = await guest('panel', `return {notice:d.querySelector('${art} [data-testid="focus-notice"]').textContent,ng:d.querySelector('${art} [data-testid="group-toggle-NG"]')?.open,h:d.querySelector('${art} [data-testid="group-toggle-H"]').open,top:d.scrollingElement.scrollTop,ring:d.activeElement.matches(':focus')}`);
    race.removedFocus = { active: await active(), ...fallback, topBefore };
    check('Q6:removed-focus-falls-back-to-ancestor', await active() === 'summary:group-toggle-Z' && /no longer shown/.test(fallback.notice) && Math.abs(fallback.top - topBefore) < 2, race.removedFocus);
    check('Q6:new-group-open-old-choice-kept', fallback.ng === true && fallback.h === false, fallback);
    await shot('panel', 'focus-fallback', `${art} [data-testid="focus-controls"]`);
    await click('panel', `${art} [data-testid="focus-mode-unfinished"] button`);
    await wait('panel', `d.querySelector('${art} [data-testid="focus-mode"]').dataset.mode==='unfinished'`);
    await guest('panel', `d.querySelector('${art} [data-testid="item-N"]').focus({preventScroll:true});return true`);
    await evaluate(`qa.update('P-focus',p=>{p.items.find(i=>i.id==='N').status='done'});true`);
    await repainted('N done');
    check('Q6:matching-task-done-hides-and-falls-back', await guest<boolean>('panel', `return d.querySelector('${art} [data-testid="item-N"]').hidden`) && await active() === 'summary:group-toggle-Z', await active());
    await guest('panel', `d.querySelector('${art} [data-testid="focus-expand-all"] button').focus();return true`);
    await evaluate(`qa.update('P-focus',p=>{p.items.find(i=>i.id==='L').title='Label the release (edited)'});true`);
    await repainted('L edited');
    check('Q6:user-moved-focus-wins', await guest<boolean>('panel', `return !!d.activeElement?.closest('[data-testid="focus-expand-all"]')`));
    // Loading gap: focus parks at Tasks, never "no matches"; it returns when complete detail lands.
    await guest('panel', `d.querySelector('${art} [data-testid="item-L"]').focus({preventScroll:true});return true`);
    await evaluate(`qa.hold={surface:'panel',path:'/v1/plan',cursor:false,plan:'P-focus',once:true};true`);
    await evaluate(`qa.update('P-focus',p=>{p.items.find(i=>i.id==='X').title='Cross-check the artifacts (edited)'});true`);
    await wait('panel', heldBy('panel'), 'P-focus detail held', 10_000);
    await wait('panel', `d.querySelector('${art} [data-testid="detail-loading"]')`, 'loading paint');
    const loading = await guest('panel', `const a=d.querySelector('${art}');return {controls:!!a.querySelector('[data-testid="focus-controls"]'),empty:!!a.querySelector('[data-testid="focus-empty"]'),noMatch:/No tasks match/.test(a.textContent),readiness:a.querySelector('[data-testid="readiness"]')?.dataset.state,parked:d.activeElement?.matches('.ap-tasks-h'),counts:a.querySelector('[data-testid="counts"]').dataset.total}`);
    race.loading = loading;
    check('Q6:loading-never-claims-no-matches', !loading.controls && !loading.empty && !loading.noMatch && loading.readiness === 'loading' && loading.parked === true, loading);
    await shot('panel', 'loading', `${art} [data-testid="readiness"]`);
    await evaluate('qa.release()');
    await repainted('P-focus loaded');
    check('Q6:parked-focus-returns', await active() === 'item-L' && await fmode('panel') === 'unfinished', await active());
    // Detail error: an error state with retry, never "no matches"; the next list refresh recovers it.
    await evaluate(`qa.fail={plan:'P-focus'};qa.update('P-focus',p=>{p.items.find(i=>i.id==='R').title='Request the review (edited)'});true`);
    await wait('panel', `/could not be loaded/.test(d.querySelector('${art} [data-testid="detail-loading"]')?.textContent??'')`, 'detail error', 15_000);
    check('Q6:error-never-claims-no-matches', await guest<boolean>('panel', `const a=d.querySelector('${art}');return !a.querySelector('[data-testid="focus-controls"]')&&!/No tasks match/.test(a.textContent)&&a.querySelector('[data-testid="readiness"]').dataset.state==='unavailable'`));
    await evaluate('qa.fail=null;true');
    await repainted('P-focus recovered');
    // A control kept from a replaced paint does nothing; a missing target in the current paint gives a local notice.
    await guest('panel', `w.__oldJump=d.querySelector('${art} [data-testid="focus-jump-blocked"] button');return true`);
    await evaluate(`qa.update('P-focus',p=>{p.items.find(i=>i.id==='W').title='Write the migration notes (edited)'});true`);
    await repainted('W edited');
    await guest('panel', `d.querySelector('${art} [data-testid="focus-expand-all"] button').focus();return true`);
    const detached = await guest('panel', `const b=w.__oldJump,before=d.querySelector('${art} [data-testid="focus-notice"]').textContent;b.click();return {connected:b.isConnected,stay:!!d.activeElement?.closest('[data-testid="focus-expand-all"]'),notice:d.querySelector('${art} [data-testid="focus-notice"]').textContent===before}`);
    check('Q6:detached-control-inert', !detached.connected && detached.stay && detached.notice, detached);
    await guest('panel', `d.querySelector('${art} [data-testid="item-R"]').remove();return true`);
    await click('panel', `${art} [data-testid="readiness-entry-R"] .ap-ready-head button`);
    check('Q6:missing-target-local-notice', /no longer shown/.test(await guest<string>('panel', `return d.querySelector('${art} [data-testid="readiness-notice"]').textContent`)) && await guest<boolean>('panel', `return !d.activeElement?.closest('ul.ap-items')`));
    await evaluate(`qa.update('P-focus',p=>{p.items=${JSON.stringify(CORE_ITEMS)};p.summary.structuralRevision++});true`);
    await repainted('P-focus restored');
    // A complete empty detail is not a loading gap: it forgets disclosures and parked focus, so the
    // same IDs coming back start at their defaults and focus stays at the Tasks heading.
    await click('panel', `${art} [data-testid="focus-mode-all"] button`);
    await wait('panel', `d.querySelector('${art} [data-testid="focus-mode"]').dataset.mode==='all'`);
    await click('panel', `${art} [data-testid="focus-expand-all"] button`);
    await click('panel', `${art} [data-testid="group-toggle-Z"] > summary`);
    await wait('panel', `!d.querySelector('${art} [data-testid="group-toggle-Z"]').open`);
    await guest('panel', `d.querySelector('${art} [data-testid="item-W"]').focus({preventScroll:true});return true`);
    const focusedW = await active();
    await evaluate(`qa.update('P-focus',p=>{p.items=[];p.summary.structuralRevision++});true`);
    { const r = await rev(); await wait('panel', `d.querySelector('${art}')?.dataset.revision==='${r}'&&d.querySelector('${art} .ap-tasks[data-complete]')&&/no tasks yet/.test(d.querySelector('${art} .ap-tasks').textContent)`, 'complete empty detail', 15_000); }
    await frameRaf('panel');
    const emptyFocus = await guest<boolean>('panel', `return d.activeElement?.matches('.ap-tasks-h')`);
    await evaluate(`qa.update('P-focus',p=>{p.items=${JSON.stringify(CORE_ITEMS)};p.summary.structuralRevision++});true`);
    await repainted('same IDs reintroduced');
    const back = await guest('panel', `return {z:d.querySelector('${art} [data-testid="group-toggle-Z"]').open,heading:d.activeElement?.matches('.ap-tasks-h'),active:d.activeElement?.dataset?.testid??null}`);
    race.emptyThenSameIds = { focusedBefore: focusedW, focusAtTasksWhenEmpty: emptyFocus, ...back };
    check('Q6:complete-empty-detail-not-a-loading-gap', focusedW === 'item-W' && emptyFocus && back.z === true && back.heading === true && back.active !== 'item-W', race.emptyThenSameIds);
    // Narrow board: explicit selection reveals once, a jump scrolls once, a poll scrolls nowhere.
    await show('page', 360);
    await click('page', '[data-testid="plan-row-P-many"]');
    await wait('page', `d.querySelector('article[data-testid="plan-P-many"] [data-testid="focus-controls"]')`);
    await frameRaf('page');
    await click('page', `article[data-testid="plan-P-many"] [data-testid="focus-jump-working"] button`);
    await wait('page', `d.activeElement?.dataset.testid==='item-K1'`, 'narrow jump K1');
    await frameRaf('page');
    const jumpTop = await guest<number>('page', `return d.scrollingElement.scrollTop`);
    const rowTop = () => guest<number>('page', `return Math.round(d.querySelector('[data-testid="item-K1"] .ap-item').getBoundingClientRect().top)`);
    const k1Before = await rowTop();
    await paints('page');
    await evaluate(`qa.update('P-many',p=>{p.items.find(i=>i.id==='K8').title='Afterwards (edited again)'});true`);
    await wait('page', `d.querySelector('[data-testid="item-K8"]')?.textContent.includes('edited again')`, 'P-many poll', 15_000);
    await frameRaf('page');
    race.narrow = { jumpTop, afterPoll: await guest<number>('page', `return d.scrollingElement.scrollTop`), active: await guest<string>('page', `return d.activeElement?.dataset.testid`), k1Before, k1After: await rowTop(), paints: (await paints('page')).map((x) => x.rows), height: await guest<number>('page', `return d.scrollingElement.scrollHeight`) };
    // The reading anchor keeps the target row's viewport position (raw scroll may change when content above it changes height).
    check('Q6:narrow-select-jump-poll-no-rescroll', Math.abs((race.narrow as any).k1After - k1Before) < 2 && (race.narrow as any).active === 'item-K1' && (race.narrow as any).afterPoll > 50, race.narrow);
    requestFacts.race = race;

    // ================================================================ Q7 widths, themes, motion, zoom/reflow and states
    const visual: Record<string, unknown> = {};
    // Rail 280, dark, both filters active; the participant popup stays inside the frame.
    await evaluate(`qa.theme('dark');true`);
    await show('panel', 280);
    await context('A');
    await wait('panel', `d.querySelector('${art} [data-testid="focus-controls"]')`);
    await click('panel', `${art} [data-testid="focus-mode-unfinished"] button`);
    await wait('panel', `d.querySelector('${art} [data-testid="focus-mode"]').dataset.mode==='unfinished'`);
    await pickPart('panel', 'Review session', 's:B');
    check('Q7:rail-280-active-filters-apparent', await guest<boolean>('panel', `const a=d.querySelector('${art}');return a.querySelector('[data-testid="focus-mode-unfinished"] button').getAttribute('aria-pressed')==='true'&&a.querySelector('${P} .oc-sdk-trigger-value').textContent==='Review session'&&/for Review session/.test(a.querySelector('[data-testid="focus-summary"]').textContent)`));
    await shot('panel', 'rail-280-dark');
    const popup = await openOptions('panel', P);
    const fit = await guest('panel', `const r=d.querySelector('.oc-sdk-popup').getBoundingClientRect();return {left:r.left,right:r.right,width:d.documentElement.clientWidth}`);
    check('Q7:rail-280-popup-fits', fit.left >= 0 && fit.right <= fit.width + 0.5 && popup.length === 6, fit);
    await shot('panel', 'participant-popup-280-dark', null);
    await key('Escape');
    await wait('panel', `!d.querySelector('.oc-sdk-popup [role="listbox"]')`);
    // Board 360 light and 1100 dark.
    await evaluate(`qa.theme('light');true`);
    await show('page', 360);
    await click('page', '[data-testid="plan-row-P-focus"][data-source="source-focus"]');
    await wait('page', `d.querySelector('${P}')`);
    await click('page', `${art} [data-testid="focus-mode-unfinished"] button`);
    await wait('page', `d.querySelector('${art} [data-testid="focus-mode"]').dataset.mode==='unfinished'`);
    await shot('page', 'page-360-light');
    await evaluate(`qa.theme('dark');true`);
    await show('page', 1100);
    await wait('page', `d.querySelector('${P}')`);
    await pickPart('page', 'Session C', 's:C');
    await shot('page', 'page-1100-dark');
    // Closed lifecycles: same predicates, historical wording, no readiness or motion; long untrusted titles wrap as text.
    await evaluate(`qa.theme('light');true`);
    const closedArt = 'article[data-testid="plan-P-closed"]';
    await click('page', '[data-testid="plan-row-P-closed"]');
    await wait('page', `d.querySelector('${closedArt} [data-testid="focus-controls"]')`, 'cancelled plan');
    await click('page', `${closedArt} [data-testid="focus-mode-unfinished"] button`);
    await wait('page', `d.querySelector('${closedArt} [data-testid="focus-mode"]').dataset.mode==='unfinished'`);
    const closed = await guest('page', `const a=d.querySelector('${closedArt}');return {matched:[...a.querySelectorAll('li[data-focus="match"]')].map(n=>n.dataset.testid),readiness:!!a.querySelector('[data-testid="readiness"]'),motion:a.dataset.motion??null,jump:a.querySelector('[data-testid="focus-jump-working"]').textContent,lead:/Last reported/.test(a.querySelector('[data-testid="group-CG"] summary').textContent),markup:a.querySelectorAll('.ap-item-title *, ul.ap-items summary .ap-grow *, .ap-plan-title *').length,literal:/<b>not markup<\\/b>/.test(a.textContent),animations:d.getAnimations().length}`);
    visual.cancelled = closed;
    check('Q7:closed-cancelled-reading-controls', same(closed.matched, ['item-C2', 'item-C3', 'item-C4']) && !closed.readiness && closed.motion === null && /Jump to reported in progress \(1\)/.test(closed.jump) && closed.lead && closed.markup === 0 && closed.literal && closed.animations === 0, closed);
    await shot('page', 'closed-unfinished');
    await click('page', '[data-testid="plan-row-P-finished"]');
    await wait('page', `d.querySelector('article[data-testid="plan-P-finished"] [data-testid="focus-controls"]')`);
    await click('page', `article[data-testid="plan-P-finished"] [data-testid="focus-mode-unfinished"] button`);
    await wait('page', `d.querySelector('article[data-testid="plan-P-finished"] [data-testid="focus-empty"]')`, 'finished: no unfinished matches');
    check('Q7:closed-finished-no-matches-state', await guest<boolean>('page', `const a=d.querySelector('article[data-testid="plan-P-finished"]');return !!a.querySelector('[data-testid="focus-clear"]')&&a.querySelector('[data-testid="focus-jump-working"] button').disabled&&/No tasks reported in progress/.test(a.querySelector('[data-testid="focus-jump-working"]').textContent)&&a.querySelector('[data-testid="counts"]').dataset.done==='2'`));
    await click('page', '[data-testid="plan-row-P-failed"]');
    await wait('page', `d.querySelector('article[data-testid="plan-P-failed"] [data-testid="focus-controls"]')`);
    await click('page', `article[data-testid="plan-P-failed"] [data-testid="focus-mode-unfinished"] button`);
    await wait('page', `d.querySelector('article[data-testid="plan-P-failed"] [data-testid="focus-mode"]').dataset.mode==='unfinished'`);
    check('Q7:closed-failed-keeps-unfinished-records', same(await guest('page', `return [...d.querySelectorAll('article[data-testid="plan-P-failed"] li[data-focus="match"]')].map(n=>n.dataset.testid)`), ['item-C2', 'item-C3', 'item-C4']) && /Jump to reported blocked \(2\)/.test(await guest<string>('page', `return d.querySelector('article[data-testid="plan-P-failed"] [data-testid="focus-jump-blocked"]').textContent`)));
    // Empty and group-only plans (360 dark).
    await evaluate(`qa.theme('dark');true`);
    await show('page', 360);
    await click('page', '[data-testid="plan-row-P-empty"]');
    await wait('page', `d.querySelector('article[data-testid="plan-P-empty"] .ap-tasks')&&!d.querySelector('article[data-testid="plan-P-empty"] [data-testid="detail-loading"]')`, 'empty plan');
    check('Q7:empty-plan-honest', await guest<boolean>('page', `const a=d.querySelector('article[data-testid="plan-P-empty"]');return /This plan has no tasks yet/.test(a.textContent)&&!a.querySelector('[data-testid="focus-controls"]')`));
    await shot('page', 'empty', 'article[data-testid="plan-P-empty"]');
    await click('page', '[data-testid="plan-row-P-groups"]');
    await wait('page', `d.querySelector('article[data-testid="plan-P-groups"] [data-testid="focus-controls"]')`, 'group-only plan');
    await click('page', `article[data-testid="plan-P-groups"] [data-testid="focus-mode-unfinished"] button`);
    await wait('page', `d.querySelector('article[data-testid="plan-P-groups"] [data-testid="focus-mode"]').dataset.mode==='unfinished'`);
    check('Q7:group-only-plan-honest', await guest<boolean>('page', `const a=d.querySelector('article[data-testid="plan-P-groups"]');return !!a.querySelector('[data-testid="focus-no-tasks"]')&&!a.querySelector('[data-testid="focus-empty"]')&&a.querySelector('[data-testid="group-Y0"]').hidden`));
    await click('page', `article[data-testid="plan-P-groups"] [data-testid="focus-mode-all"] button`);
    await wait('page', `!d.querySelector('article[data-testid="plan-P-groups"] [data-testid="group-Y0"]').hidden`, 'groups shown again');
    await shot('page', 'group-only', 'article[data-testid="plan-P-groups"]');
    // A task-parent's own people stay in its folded summary, source-safe and once (board 360 dark: foreign; rail 280 dark: bound).
    const relayArt = (source: string) => `article[data-testid="plan-P-relay"][data-source="${source}"]`;
    const relayFacts = (s: string, a: string) => guest<Record<string, any>>(s, `const a=d.querySelector('${a}'),sum=a.querySelector('[data-testid="item-toggle-TP"]>summary'),r=sum.querySelector('[data-testid="relay-TP"]');return {open:a.querySelector('[data-testid="item-toggle-TP"]').open,count:a.querySelectorAll('[data-testid="relay-TP"]').length,inSummary:!!r,visible:!!r?.checkVisibility(),relay:r?.textContent??'',chip:sum.querySelector('.ap-chip')?.textContent??'',summary:sum.textContent}`);
    await click('page', '[data-testid="plan-row-P-relay"][data-source="source-focus-other"]');
    await wait('page', `d.querySelector('${relayArt('source-focus-other')} [data-testid="item-toggle-TP"]')`, 'foreign relay plan');
    await click('page', `${relayArt('source-focus-other')} [data-testid="item-toggle-TP"] > summary`);
    await wait('page', `!d.querySelector('${relayArt('source-focus-other')} [data-testid="item-toggle-TP"]').open`);
    const foreignParent = await relayFacts('page', relayArt('source-focus-other'));
    visual.taskParentForeign = foreignParent;
    check('Q5:task-parent-relay-foreign-source-safe', !foreignParent.open && foreignParent.count === 1 && foreignParent.inSummary && foreignParent.visible && foreignParent.relay === 'Reported by Session A for Session C'
      && /Session B/.test(foreignParent.chip) && /from another OpenCode setup/.test(foreignParent.chip) && !/Planner session|Review session/.test(foreignParent.summary), foreignParent);
    await show('panel', 280);
    await context('C');
    await wait('panel', `d.querySelector('[data-testid="plan-selector"]')&&d.querySelector('[data-testid="readiness-entry-B1"][data-assignment="selected"]')`, 'rail C plan selector', 15_000);
    await choose('panel', '[data-testid="plan-selector"]', 'Relay on a task-parent');
    await wait('panel', `d.querySelector('${relayArt('source-focus')} [data-testid="item-toggle-TP"]')`, 'rail relay plan', 15_000);
    await click('panel', `${relayArt('source-focus')} [data-testid="item-toggle-TP"] > summary`);
    await wait('panel', `!d.querySelector('${relayArt('source-focus')} [data-testid="item-toggle-TP"]').open`);
    const boundParent = await relayFacts('panel', relayArt('source-focus'));
    visual.taskParentBound = boundParent;
    check('Q5:task-parent-relay-bound-in-folded-summary', !boundParent.open && boundParent.count === 1 && boundParent.inSummary && boundParent.visible && boundParent.relay === 'Reported by Planner session for Session C' && /Review session/.test(boundParent.chip), boundParent);
    await shot('panel', 'task-parent-relay-280-dark', `${relayArt('source-focus')} [data-testid="focus-controls"]`);
    await context('A');
    await wait('panel', `d.querySelector('${art} [data-testid="focus-controls"]')`, 'rail A after relay check', 15_000);
    // Stale list (rail 360 dark): last reported data stays readable and navigable, explicitly qualified.
    await show('panel', 360);
    await evaluate('qa.failList=true;true');
    await wait('panel', `d.querySelector('[data-testid="stale-banner"]')`, 'stale banner', 15_000);
    const stale = await guest('panel', `const a=d.querySelector('${art}');return {controls:!!a.querySelector('[data-testid="focus-controls"]'),readinessStale:a.querySelector('[data-testid="readiness"]')?.dataset.stale??null,motion:a.dataset.motion??null}`);
    visual.stale = stale;
    check('Q7:stale-qualified-and-readable', stale.controls && stale.readinessStale === 'true' && stale.motion === null, stale);
    await shot('panel', 'stale-error', null);
    await evaluate('qa.failList=false;true');
    await wait('panel', `!d.querySelector('[data-testid="stale-banner"]')`, 'fresh again', 15_000);
    // Normal-motion sample: motion only where it already existed; the task view adds none and jumps stay instant.
    await c.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
    await evaluate(`qa.theme('light');true`);
    await show('page', 1100);
    await click('page', '[data-testid="plan-row-P-many"]');
    await wait('page', `d.querySelector('article[data-testid="plan-P-many"] [data-testid="focus-controls"]')`);
    await frameRaf('page');
    await click('page', `article[data-testid="plan-P-many"] [data-testid="focus-jump-working"] button`);
    await wait('page', `d.activeElement?.closest('ul.ap-items')`, 'normal-motion jump');
    const motion = await guest('page', `const a=d.querySelector('article[data-testid="plan-P-many"]'),r=d.activeElement.getBoundingClientRect();return {reduced:w.matchMedia('(prefers-reduced-motion: reduce)').matches,motion:a.dataset.motion??null,planAnimations:d.getAnimations().length,taskViewAnimations:d.getAnimations().filter(x=>!(x instanceof w.CSSTransition)&&(x.effect?.target?.closest?.('.ap-focus')||x.effect?.target?.matches?.('li[data-nav-target],.ap-items li:focus'))).length,kitTransitions:d.getAnimations().filter(x=>x instanceof w.CSSTransition&&x.effect?.target?.closest?.('.ap-focus')).length,animated:[...new Set(d.getAnimations().map(x=>x.effect?.target?.className||x.effect?.target?.tagName))],inView:r.top>=0&&r.bottom<=w.innerHeight}`);
    visual.normalMotion = motion;
    check('Q7:normal-motion-sample', motion.reduced === false && motion.motion === 'on' && motion.taskViewAnimations === 0 && motion.inView, motion);
    await c.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    // 200% zoom as reflow: half the CSS layout width (board 550, rail 180) rendered at device scale 2, same physical capture size.
    await c.send('Emulation.setDeviceMetricsOverride', { width: 640, height: 500, deviceScaleFactor: 2, mobile: false });
    await show('page', 550);
    await click('page', '[data-testid="plan-row-P-focus"][data-source="source-focus"]');
    await wait('page', `d.querySelector('${art} [data-testid="focus-controls"]')`);
    await guest('page', `d.querySelector('${art} [data-testid="focus-jump-blocked"] button').focus();return true`);
    await key('Enter');
    await wait('page', `['item-B1','item-R'].includes(d.activeElement?.dataset.testid)`, 'keyboard jump at 200%');
    const zoomPage = await guest('page', `return {width:d.documentElement.clientWidth,dpr:w.devicePixelRatio}`);
    await shot('page', 'zoom-200');
    await show('panel', 180);
    await wait('panel', `d.querySelector('${art} [data-testid="focus-controls"]')`);
    const zoomRail = await guest('panel', `return {width:d.documentElement.clientWidth,dpr:w.devicePixelRatio}`);
    await shot('panel', 'zoom-200-rail');
    visual.zoom = { method: 'reflow emulation: CSS layout width halved (board 1100→550, rail 360→180) at deviceScaleFactor 2, same physical capture size', page: zoomPage, rail: zoomRail };
    check('Q7:zoom-200-reflow', zoomPage.width === 550 && zoomPage.dpr === 2 && zoomRail.width === 180, visual.zoom);
    await c.send('Emulation.clearDeviceMetricsOverride');
    requestFacts.visual = visual;
  }

  // ================================================================ Q8: background, foreground, dispose (both modes)
  {
    await show('panel', 360);
    await context('S');
    await wait('panel', `d.querySelectorAll('${ROWS}').length===1000`, 'scale again', 20_000);
    const blank = await c.send('Target.createTarget', { url: 'about:blank' });
    await evaluate('new Promise(r=>setTimeout(r,300))');
    let method = 'second browser tab activated';
    let hidden = await guest<string>('panel', `return d.visibilityState`) === 'hidden';
    if (!hidden) {
      // Headless may keep both tabs visible; fall back to the frame's own visibility signal.
      method = 'synthetic visibilitychange (headless kept the tab visible)';
      await guest('panel', `Object.defineProperty(d,'visibilityState',{configurable:true,get:()=>'hidden'});d.dispatchEvent(new Event('visibilitychange'));return true`);
      hidden = true;
    }
    const mark = await hostNow();
    await evaluate('new Promise(r=>setTimeout(r,7000))');
    const whileHidden = (await requests(`q.surface==='panel'`)).filter((q: any) => q.at >= mark).length;
    const back = await hostNow();
    if (method.startsWith('second')) await c.send('Target.activateTarget', { targetId: pageTarget.id });
    else await guest('panel', `delete d.visibilityState;d.dispatchEvent(new Event('visibilitychange'));return true`);
    await c.send('Target.closeTarget', { targetId: blank.targetId });
    await wait('panel', `d.visibilityState==='visible'`, 'visible again');
    await evaluate('new Promise(r=>setTimeout(r,1500))');
    const afterVisible = (await requests(`q.surface==='panel'`)).filter((q: any) => q.at >= back).length;
    requestFacts.hidden = { method, requestsWhileHidden7s: whileHidden, requestsWithin1500msOfVisible: afterVisible };
    check('Q8:hidden-polls-nothing', whileHidden === 0, requestFacts.hidden);
    check('Q8:visible-resumes', afterVisible > 0, requestFacts.hidden);
    // Disposal: pagehide stops the frame's reads and its subscriptions.
    const subsBefore = await messages(`m.surface==='panel'&&(m.type==='workspace-subscribe'||m.type==='workspace-unsubscribe')`);
    await guest('panel', `w.dispatchEvent(new Event('pagehide'));return true`);
    const dmark = await hostNow();
    await evaluate('new Promise(r=>setTimeout(r,3500))'); // one poll period
    const disposed = (await requests(`q.surface==='panel'`)).filter((q: any) => q.at >= dmark).length;
    const subsAfter = await messages(`m.surface==='panel'&&(m.type==='workspace-subscribe'||m.type==='workspace-unsubscribe')`);
    const net = (l: any[]) => l.filter((m) => m.type === 'workspace-subscribe').length - l.filter((m) => m.type === 'workspace-unsubscribe').length;
    requestFacts.dispose = { requestsAfterPagehide3500ms: disposed, subscriptionsOpenBefore: net(subsBefore), subscriptionsOpenAfter: net(subsAfter) };
    check('Q8:disposed-frame-reads-nothing', disposed === 0, requestFacts.dispose);
    check('Q8:disposed-frame-releases-subscriptions', net(subsAfter) === 0, requestFacts.dispose);
  }
  const all = await requests();
  requestFacts.totals = all.reduce((o: Record<string, number>, q: any) => { const k = `${q.surface} ${q.method} ${q.path}`; o[k] = (o[k] ?? 0) + 1; return o; }, {});
  const subs = await messages(`m.type==='workspace-subscribe'||m.type==='workspace-unsubscribe'`);
  requestFacts.subscriptions = subs.reduce((o: Record<string, number>, m: any) => { const k = `${m.surface} ${m.type}`; o[k] = (o[k] ?? 0) + 1; return o; }, {});
  check('Q8:no-service-writes', all.every((q: any) => q.method === 'GET'));
  // Bounded synthetic diagnostics only: the first line of any exception or console error.
  const errors = c.events.map((e) => String(e.params.exceptionDetails?.exception?.description ?? e.params.args?.map((a: any) => a.value ?? a.description).join(' ') ?? '').split('\n')[0].slice(0, 200));
  check('Q4:no-guest-exceptions-or-console-errors', errors.length === 0, errors);
  void mode;
} catch (e) {
  failure = e instanceof Error ? e.message : String(e);
} finally {
  cdp?.close();
  // Our own Chromium process group only (its helpers too), never another browser.
  const exited = new Promise((r) => { if (chrome.exitCode !== null) r(null); else chrome.once('exit', r); });
  try { process.kill(-chrome.pid!, 'SIGTERM'); } catch { chrome.kill('SIGTERM'); }
  await exited;
  server.close(); server.closeAllConnections();
  const environment = { evidenceClass: 'synthetic SDK/service, isolated headless Linux Chromium, current guest bundles', browser: browserVersion, reducedMotion: true, nativeHostProof: false };
  const passed = !failure && results.every((r) => r.pass);
  const performance = { mode: baseline ? 'baseline' : 'candidate', ...environment, passed, failure, measurements: perf, note: 'Diagnostic measurements on one machine; no latency SLA is implied.' };
  writeFileSync(join(artifacts, 'performance.json'), `${JSON.stringify(performance, null, 2)}\n`);
  writeFileSync(join(artifacts, 'request-results.json'), `${JSON.stringify({ mode: performance.mode, ...environment, passed, failure, requests: requestFacts, results: results.filter((r) => r.id.startsWith('Q8:')) }, null, 2)}\n`);
  if (!baseline) writeFileSync(join(artifacts, 'race-results.json'), `${JSON.stringify({ ...environment, passed, failure, assertions: results.filter((r) => r.id.startsWith('Q6:')).length, facts: requestFacts.race ?? null, results: results.filter((r) => r.id.startsWith('Q6:')), screenshots: shots.filter((n) => /focus-fallback|loading/.test(n)) }, null, 2)}\n`);
  if (!baseline) writeFileSync(join(artifacts, 'participant-ui-results.json'), `${JSON.stringify({ ...environment, passed, failure, assertions: results.filter((r) => r.id.startsWith('Q5:')).length, results: results.filter((r) => r.id.startsWith('Q5:')), screenshots: shots.filter((n) => /participant|no-match/.test(n)) }, null, 2)}\n`);
  if (!baseline) writeFileSync(join(artifacts, 'results.json'), `${JSON.stringify({ ...environment, passed, failure, assertions: results.length, results, screenshots: shots }, null, 2)}\n`);
  console.log(JSON.stringify({ mode: performance.mode, passed, assertions: results.length, failure }, null, 2));
  if (!passed) process.exitCode = 1;
  // Chromium helpers may still be flushing the disposable profile right after exit.
  rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
