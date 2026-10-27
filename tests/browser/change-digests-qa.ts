// Current-bundle "Since you last reviewed" QA in an isolated Chromium (V5/V6). Starts its own
// loopback synthetic SDK shell (change-digests-shell.ts) over real disposable HTTP services and a
// headless Chromium with a fresh disposable profile, drives real CDP pointer/keyboard input, and
// stops only what it started. Never downloads a browser, attaches to an existing one or uses a
// real profile. Synthetic SDK-shell coverage only: not native-host, relay or cross-device proof.
// Usage: node --experimental-strip-types tests/browser/change-digests-qa.ts --artifacts <dir> [--built-service] [--chromium <path>]
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { SOURCE, startDigestShell } from './change-digests-shell.ts';

const arg = (name: string) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const artifacts = arg('--artifacts');
if (!artifacts) throw new Error('usage: change-digests-qa.ts --artifacts <dir> [--built-service] [--chromium <path>]');
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

type Result = { id: string; pass: boolean; facts?: string[] };
const results: Result[] = [];
const races: Result[] = [];
const requestResults: { interaction: string; counts: Record<string, number | boolean>; expectation: string; pass: boolean }[] = [];
const shots: string[] = [];
function check(id: string, pass: boolean, facts?: string[], diagnostic?: unknown, into = results) {
  into.push({ id, pass, ...(facts ? { facts } : {}) });
  if (!pass) throw new Error(`${id} failed${diagnostic === undefined ? '' : `: ${JSON.stringify(diagnostic).slice(0, 600)}`}`);
}
const race = (id: string, pass: boolean, facts?: string[], diagnostic?: unknown) => check(id, pass, facts, diagnostic, races);

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
const profile = mkdtempSync('/tmp/opencode/change-digests-qa-');
const fx = await startDigestShell(built);
const origin = `http://127.0.0.1:${fx.port}`;
const chrome = spawn(findChromium(), ['--headless=new', '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--disable-sync', '--hide-scrollbars', '--window-size=1280,1100', 'about:blank'], { stdio: 'ignore', detached: true });
let page: Cdp | null = null, browser: Cdp | null = null;
let failure: string | null = null;
const facts: Record<string, unknown> = {};
try {
  let devtools = '';
  for (const end = Date.now() + 15_000; Date.now() < end && !devtools;) {
    const f = join(profile, 'DevToolsActivePort');
    if (existsSync(f)) devtools = readFileSync(f, 'utf8').split('\n')[0];
    else await new Promise((r) => setTimeout(r, 100));
  }
  if (!devtools) throw new Error('Chromium did not start its DevTools endpoint.');
  const version = await (await fetch(`http://127.0.0.1:${devtools}/json/version`)).json() as { webSocketDebuggerUrl: string };
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
  /** Run `code` with `w`/`d` = the guest window/document of frame `f`. */
  const guest = <T = any>(f: string, code: string) => evaluate<T>(`(()=>{const w=frame('${f}').contentWindow,d=w.document;${code}})()`);
  const wait = async (f: string, cond: string, what = cond, ms = 12_000) => {
    const ok = await evaluate<boolean>(`(async()=>{const end=Date.now()+${ms};while(Date.now()<end){try{const w=frame('${f}').contentWindow,d=w.document;if(${cond})return true}catch{}await new Promise(r=>setTimeout(r,40));}return false})()`);
    if (!ok) throw new Error(`timed out waiting (${f}): ${what}`);
  };
  const frames2 = () => evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  const key = async (k: string, times = 1, modifiers = 0) => {
    const codes: Record<string, number> = { Enter: 13, Tab: 9, ' ': 32, Escape: 27 };
    for (let i = 0; i < times; i++) {
      const text = k === 'Enter' ? { text: '\r', unmodifiedText: '\r' } : k === ' ' ? { text: ' ', unmodifiedText: ' ' } : {};
      await c.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: k === ' ' ? 'Space' : k, modifiers, windowsVirtualKeyCode: codes[k] ?? 0, ...text });
      await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k === ' ' ? 'Space' : k, modifiers, windowsVirtualKeyCode: codes[k] ?? 0 });
    }
  };
  const click = async (f: string, selector: string) => {
    const point = await evaluate<[number, number] | null>(`(()=>{const fr=frame('${f}'),n=fr.contentDocument.querySelector(${JSON.stringify(selector)});if(!n)return null;n.scrollIntoView({block:'center'});const r=n.getBoundingClientRect(),o=fr.getBoundingClientRect();return [o.x+r.x+Math.min(16,r.width/2),o.y+r.y+Math.min(10,r.height/2)]})()`);
    if (!point) throw new Error(`missing ${selector} in ${f}`);
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await c.send('Input.dispatchMouseEvent', { type, x: point[0], y: point[1], button: 'left', clickCount: 1 });
  };
  const show = async (list: string[], width: number) => { await evaluate(`qa.show(${JSON.stringify(list)},${width});true`); for (const f of list) await wait(f, `w.innerWidth===${width}`, `${f} width ${width}`); };
  const theme = async (mode: 'light' | 'dark') => { await evaluate(`qa.theme('${mode}');true`); await frames2(); };
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const D = (plan: string) => `[data-testid="plan-detail"] article[data-testid="plan-${plan}"] [data-testid="change-digest"]`;
  const H = (plan: string, id: string) => `${D(plan)} [data-testid="${id}"]`;
  const row = (plan: string) => `[data-testid="plan-row-${plan}"][data-source="${SOURCE}"]`;
  const TAB = (id: string) => `[data-testid="detail-tabs"] [role="tab"][data-id="${id}"]`;
  const digestState = (f: string, plan: string) => guest<{ state?: string; review?: string; reason?: string; to?: string; after?: string } | null>(f, `const n=d.querySelector('${D(plan)}');return n?{...n.dataset}:null`);
  const text = (f: string, selector: string) => guest<string>(f, `return d.querySelector(${JSON.stringify(selector)})?.textContent??''`);
  const select = async (f: string, plan: string, tab: 'history' | 'progress' = 'history') => {
    await wait(f, `!!d.querySelector('${row(plan)}')`, `${plan} listed`);
    await click(f, row(plan));
    await wait(f, `!!d.querySelector('[data-testid="plan-detail"] article[data-testid="plan-${plan}"]')`, `${plan} selected`);
    await click(f, TAB(tab));
    if (tab === 'history') await wait(f, `!!d.querySelector('${D(plan)}')`, `${plan} history digest section`);
  };
  const settled = (f: string, plan: string) => wait(f, `(()=>{const n=d.querySelector('${D(plan)}');return n&&n.dataset.state!=='loading'})()`, `${plan} digest settled`);
  const reenter = async (f: string, plan: string) => { await click(f, TAB('progress')); await wait(f, `!d.querySelector('${D(plan)}')`); await click(f, TAB('history')); await settled(f, plan); };
  const counts = () => evaluate<{ digest: Record<string, number>; plans: Record<string, number>; detail: Record<string, number>; deviceSet: number; deviceGet: number; deviceKeys: number; instanceSet: number }>(`(()=>{const by=(p)=>{const o={};for(const r of qa.requests.filter(r=>r.path===p))o[r.frame]=(o[r.frame]??0)+1;return o};const dev=qa.storageLog.filter(l=>l.scope==='device');return {digest:by('/v1/change-digest'),plans:by('/v1/plans'),detail:by('/v1/plan'),deviceSet:dev.filter(l=>l.op==='set').length,deviceGet:dev.filter(l=>l.op==='get').length,deviceKeys:dev.filter(l=>l.op==='keys').length,instanceSet:qa.storageLog.filter(l=>l.scope==='instance'&&l.op==='set').length}})()`);
  const sumOf = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);
  const deviceKeys = (ns = 'profile-1') => evaluate<string[]>(`qa.deviceKeys('${ns}')`);
  const deviceValues = (ns = 'profile-1') => evaluate<any[]>(`qa.deviceValues('${ns}')`);
  /** Wait for `n` more page-frame list polls (the existing 3 s cadence; bounded). */
  const polls = async (f: string, n: number) => { const start = (await counts()).plans[f] ?? 0; await wait(f, `qa.requests.filter(r=>r.frame==='${f}'&&r.path==='/v1/plans').length>=${start + n}`, `${n} polls`, 4000 * n + 2000); await new Promise((r) => setTimeout(r, 150)); };
  const flightDone = async () => { if (!(await evaluate<boolean>(`new Promise(r=>{const end=Date.now()+5000;const t=()=>qa.flight===0?r(true):Date.now()>end?r(false):setTimeout(t,40);t()})`))) throw new Error('service requests did not quiesce'); };
  const noOverflow = (f: string) => guest<{ ok: boolean; sw: number; cw: number; bad: string[] }>(f, `const cw=d.documentElement.clientWidth,sw=d.documentElement.scrollWidth;const bad=[...d.querySelectorAll('[data-testid="change-digest"] *')].filter(n=>{const r=n.getBoundingClientRect();return r.width>0&&(r.left<-0.5||r.right>cw+0.5)}).map(n=>n.dataset?.testid||n.tagName);return {ok:sw<=cw&&!bad.length,sw,cw,bad:bad.slice(0,5)}`);
  const shot = async (f: string, name: string, selector: string, pad = 12) => {
    await guest(f, `d.querySelector(${JSON.stringify(selector)})?.scrollIntoView({block:'start'});return true`);
    await frames2();
    const r = await evaluate<number[] | null>(`(()=>{const fr=frame('${f}'),n=fr.contentDocument.querySelector(${JSON.stringify(selector)});if(!n)return null;const a=n.getBoundingClientRect(),o=fr.getBoundingClientRect();return [o.x+a.x+scrollX,o.y+a.y+scrollY,a.width,a.height]})()`);
    if (!r) throw new Error(`no ${selector} to capture`);
    const png = await c.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: Math.max(0, r[0] - pad), y: Math.max(0, r[1] - pad), width: r[2] + pad * 2, height: Math.min(r[3] + pad * 2, 2400), scale: 1 } });
    writeFileSync(join(artifacts, `${name}.png`), Buffer.from(png.data, 'base64'));
    shots.push(`${name}.png`);
  };
  /** One capture spanning the same element in several side-by-side frames. */
  const shotUnion = async (list: string[], name: string, selector: string, pad = 12) => {
    for (const f of list) await guest(f, `d.querySelector(${JSON.stringify(selector)})?.scrollIntoView({block:'start'});return true`);
    await frames2();
    const rects = await evaluate<number[][]>(`${JSON.stringify(list)}.map(f=>{const fr=frame(f),n=fr.contentDocument.querySelector(${JSON.stringify(selector)}),a=n.getBoundingClientRect(),o=fr.getBoundingClientRect();return [o.x+a.x+scrollX,o.y+a.y+scrollY,o.x+a.right+scrollX,o.y+a.bottom+scrollY]})`);
    const x = Math.min(...rects.map((r) => r[0])) - pad, y = Math.min(...rects.map((r) => r[1])) - pad;
    const png = await c.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: Math.max(0, x), y: Math.max(0, y), width: Math.max(...rects.map((r) => r[2])) - x + pad, height: Math.min(Math.max(...rects.map((r) => r[3])) - y + pad, 2400), scale: 1 } });
    writeFileSync(join(artifacts, `${name}.png`), Buffer.from(png.data, 'base64'));
    shots.push(`${name}.png`);
  };
  /** Labelled seam: this frame's document reports hidden (the host hides frames, not pages). */
  const setHidden = (f: string, hidden: boolean) => guest(f, hidden
    ? `Object.defineProperty(d,'visibilityState',{configurable:true,get:()=>'hidden'});d.dispatchEvent(new Event('visibilitychange'));return true`
    : `delete d.visibilityState;d.dispatchEvent(new Event('visibilitychange'));return true`);
  const unchanged = (a: unknown, b: unknown) => same(a, b);

  await evaluate(`new Promise(r=>{const t=()=>window.qa&&frame('page').contentDocument?.querySelector('[data-testid="progress-root"]')&&frame('panel').contentDocument?.querySelector('[data-testid="progress-root"]')?r(true):setTimeout(t,50);t()})`);
  await theme('light');

  // ------------------------------------------------------------------ V6: History closed
  await show(['page', 'panel', 'status'], 1100);
  await wait('page', `!!d.querySelector('${row('P-digest')}')`);
  await select('page', 'P-digest', 'progress');
  const closed0 = await counts();
  await polls('page', 2);
  fx.advance('P-gap', 'T1');
  await polls('page', 1);
  const closed1 = await counts();
  const closedDigest = sumOf(closed1.digest) - sumOf(closed0.digest);
  requestResults.push({ interaction: 'history-closed: page Progress tab plus panel/status polling across 3 polls and a new revision', counts: { digestRequests: closedDigest, deviceWrites: closed1.deviceSet - closed0.deviceSet, deviceKeyReads: closed1.deviceKeys - closed0.deviceKeys, panelStatusDigestRequests: (closed1.digest.panel ?? 0) + (closed1.digest.status ?? 0) }, expectation: 'all zero', pass: closedDigest === 0 && closed1.deviceSet === 0 && closed1.deviceKeys === 0 });
  check('V6:history-closed-zero-digest-work', requestResults.at(-1)!.pass, ['No digest request, checkpoint read or write while History is closed, including panel/status polling'], requestResults.at(-1));

  // ------------------------------------------------------------------ S1 initial view + Enter
  const before1 = fx.state('P-digest');
  await click('page', TAB('history'));
  await settled('page', 'P-digest');
  const s1 = await digestState('page', 'P-digest');
  const cov1 = await text('page', H('P-digest', 'digest-coverage'));
  check('S1:initial-not-zero', s1?.state === 'initial' && cov1.includes('Initial view — no saved reviewed revision in this profile.') && !/No summarized|0 changes|nothing changed/i.test(await text('page', D('P-digest'))), ['Initial view says so; no invented interval or zero-change claim'], { s1, cov1 });
  check('S1:no-write-before-activation', (await counts()).deviceSet === 0 && (await deviceKeys()).length === 0, ['Mounting the digest wrote nothing']);
  await shot('page', 'initial-view', '[data-testid="plan-detail"] article[data-testid="plan-P-digest"]');
  // Keyboard: Tab from the History tab to Mark reviewed, then Enter.
  await guest('page', `d.querySelector('${TAB('history')}').focus();return true`);
  let tabs = 0;
  while (tabs < 40 && !(await guest<boolean>('page', `return d.activeElement?.dataset?.testid==='digest-mark-reviewed'`))) { await key('Tab'); tabs++; }
  const focus1 = await guest<{ id: string; outline: string; visible: boolean }>('page', `const a=d.activeElement,s=getComputedStyle(a);return {id:a?.dataset?.testid,outline:s.outlineStyle+' '+s.outlineWidth,visible:a.matches(':focus-visible')}`);
  check('S1:mark-reviewed-reached-by-tab', focus1.id === 'digest-mark-reviewed' && focus1.visible && !focus1.outline.startsWith('none'), [`Reached with ${tabs} Tab presses; visible focus outline`], focus1);
  const pre1 = await counts();
  await key('Enter');
  await wait('page', `d.querySelector('${D('P-digest')}')?.dataset.review==='saved'`, 'Enter saved review');
  const post1 = await counts();
  const keys1 = await deviceKeys();
  const values1 = await deviceValues();
  check('S1:enter-acknowledges-displayed-target', keys1.length === 1 && /^rv1\.[0-9a-f]{64}\.1$/.test(keys1[0]) && same(Object.keys(values1[0]).sort(), ['id', 'revision', 'v']) && values1[0].revision === 1, ['One revision-addressed device key for revision 1; value = version, identity, revision'], { keys1, values1 });
  check('S1:no-task-content-persisted', !/Verify checksums|Draft release|Release digest example|Release work/.test(JSON.stringify(values1)), ['No titles or digest text in device storage']);
  check('S1:never-instance-storage', post1.instanceSet === 0, ['Instance storage receives no checkpoint']);
  check('S1:service-and-source-unchanged', unchanged(fx.state('P-digest'), before1), ['Reads and review left revision, rows, schema and the source document unchanged']);
  const preflight1 = { digest: sumOf(post1.digest) - sumOf(pre1.digest), detail: (post1.detail.page ?? 0) - (pre1.detail.page ?? 0), cursorless: await evaluate<boolean>(`qa.requests.filter(r=>r.path==='/v1/plan').every(r=>!r.query?.cursor)`) };
  requestResults.push({ interaction: 'mark-reviewed (Enter): review preflight', counts: preflight1, expectation: 'exactly one first-page /v1/plan read, no digest request', pass: preflight1.digest === 0 && preflight1.detail === 1 && preflight1.cursorless });
  check('V6:preflight-one-bounded-read', requestResults.at(-1)!.pass, undefined, preflight1);
  await wait('page', `/^Marked reviewed through revision 1\\./.test(d.querySelector('[data-testid="digest-announcer"]')?.textContent??'')`, 'outcome announced');
  const status1 = await guest<{ role: string | null; live: string | null; atomic: string | null; outside: boolean; visible: string; focus: string; disabled: string | null }>('page', `const s=d.querySelector('[data-testid="digest-announcer"]'),b=d.querySelector('${H('P-digest', 'digest-mark-reviewed')}');return {role:s.getAttribute('role'),live:s.getAttribute('aria-live'),atomic:s.getAttribute('aria-atomic'),outside:!d.getElementById('root').contains(s),visible:d.querySelector('${H('P-digest', 'digest-status')}').textContent,focus:d.activeElement?.dataset?.testid,disabled:b.getAttribute('aria-disabled')}`);
  check('S1:polite-outcome-and-stable-focus', status1.role === 'status' && status1.live === 'polite' && status1.atomic === 'true' && status1.outside && /^Marked reviewed through revision 1\./.test(status1.visible) && status1.focus === 'digest-mark-reviewed' && status1.disabled === 'true', ['One persistent polite region (outside the repainted root) announces the explicit outcome; focus stays on the now-unavailable control'], status1);

  // ------------------------------------------------------------------ S2 since reviewed
  fx.v1();
  // The pinned target is the listed revision: wait for the existing poll to list revision 6.
  await click('page', TAB('progress'));
  await wait('page', `d.querySelector('[data-testid="plan-detail"] article[data-testid="plan-P-digest"]')?.dataset.revision==='6'`, 'list at revision 6', 8000);
  await click('page', TAB('history')); await settled('page', 'P-digest');
  const s2 = await digestState('page', 'P-digest');
  const ev = await guest<Record<string, string>>('page', `const o={};for(const n of d.querySelectorAll('${H('P-digest', 'digest-summary')} li[data-facet]'))o[n.dataset.facet]=n.textContent;return o`);
  check('S2:comparison-1-to-6', s2?.state === 'comparison' && s2.after === '1' && s2.to === '6', undefined, s2);
  check('S2:transient-blocker-kept', same(ev, { completed: 'Completed: 1', blocked: 'Reported blocked: 1', unblocked: 'No longer reported blocked: 1', added: 'Added: 1' }), ['Blocker reported and cleared between visits; one completion; one task added; repeated same-status report and replay added nothing'], ev);
  const rowB = await text('page', H('P-digest', 'digest-task-B'));
  check('S2:grouped-row-facets', /Verify checksums/.test(rowB) && /Completed · Reported blocked · No longer reported blocked/.test(rowB) && await guest<boolean>('page', `return !!d.querySelector('${H('P-digest', 'digest-group-blockers')} [data-testid="digest-task-B"]')&&!!d.querySelector('${H('P-digest', 'digest-group-added')} [data-testid="digest-task-D"]')`), ['B grouped under Blockers with all facets as text; D under Added'], rowB);
  const scope2 = await text('page', H('P-digest', 'digest-counts'));
  check('S2:scope-explained-independently', scope2.includes('1/2 done (50%) → 2/3 done (67%)') && scope2.includes('Scope: 1 counted task added.') && scope2.includes('Completion: 1 existing task now done.') && scope2.includes('not completions'), ['Denominator change explained apart from completion'], scope2);
  await shot('page', 'since-reviewed', D('P-digest'));
  await shot('page', 'scope-change', H('P-digest', 'digest-counts'));
  // V6: unchanged polls while one digest is open.
  await guest('page', `w.__announced=0;new w.MutationObserver(()=>w.__announced++).observe(d.querySelector('[data-testid="digest-announcer"]'),{childList:true,characterData:true,subtree:true});return true`);
  const open0 = await counts();
  await polls('page', 2);
  const open1 = await counts();
  const chatter = await guest<number>('page', 'return w.__announced');
  requestResults.push({ interaction: 'digest open: 2 unchanged list polls', counts: { digestRequests: sumOf(open1.digest) - sumOf(open0.digest), deviceWrites: open1.deviceSet - open0.deviceSet, announcements: chatter }, expectation: 'zero additional digest scans, writes or announcements', pass: sumOf(open1.digest) === sumOf(open0.digest) && open1.deviceSet === open0.deviceSet && chatter === 0 });
  check('V6:unchanged-polls-no-rescan', requestResults.at(-1)!.pass, undefined, requestResults.at(-1));
  // Identical replay (no revision) plus a same-status report with a fresh operation (new revision, no event).
  fx.replay(); fx.status('P-digest', 'B', 'done');
  await wait('page', `!!d.querySelector('${H('P-digest', 'digest-newer')}')`, 'newer changes offered', 8000);
  const newer = await counts();
  requestResults.push({ interaction: 'new accepted revision observed by a poll', counts: { digestRequests: sumOf(newer.digest) - sumOf(open1.digest), deviceWrites: newer.deviceSet - open1.deviceSet }, expectation: 'Refresh affordance only: zero digest requests, zero writes', pass: sumOf(newer.digest) === sumOf(open1.digest) && newer.deviceSet === open1.deviceSet });
  check('V6:new-revision-refresh-affordance-only', requestResults.at(-1)!.pass && (await digestState('page', 'P-digest'))?.to === '6', ['Pinned text unchanged under the reader; no acknowledgement'], requestResults.at(-1));
  await click('page', H('P-digest', 'digest-refresh'));
  await wait('page', `(()=>{const n=d.querySelector('${D('P-digest')}');return n?.dataset.to==='7'})()`, 'refreshed to 7');
  await flightDone();
  const refreshed = await counts();
  requestResults.push({ interaction: 'one deliberate Refresh digest click', counts: { digestRequests: sumOf(refreshed.digest) - sumOf(newer.digest), checkpointKeyReads: refreshed.deviceKeys - newer.deviceKeys, deviceWrites: refreshed.deviceSet - newer.deviceSet }, expectation: 'one checkpoint read + one digest request, no write', pass: sumOf(refreshed.digest) - sumOf(newer.digest) === 1 && refreshed.deviceKeys - newer.deviceKeys === 1 && refreshed.deviceSet === newer.deviceSet });
  check('V6:refresh-one-coalesced-sequence', requestResults.at(-1)!.pass, undefined, requestResults.at(-1));
  const ev2 = await guest<Record<string, string>>('page', `const o={};for(const n of d.querySelectorAll('${H('P-digest', 'digest-summary')} li[data-facet]'))o[n.dataset.facet]=n.textContent;return o`);
  check('S2:replay-no-duplicate-events', same(ev2, ev) && fx.revision('P-digest') === 7, ['Replay created no revision; same-status report created a revision with no event'], ev2);
  check('S2:refresh-announced', (await text('page', H('P-digest', 'digest-status'))) === 'Digest refreshed.');

  // ------------------------------------------------------------------ S3 removed task, links, race
  await select('page', 'P-removal');
  await settled('page', 'P-removal');
  await click('page', H('P-removal', 'digest-mark-reviewed'));
  await wait('page', `d.querySelector('${D('P-removal')}')?.dataset.review==='saved'`, 'P-removal reviewed');
  fx.removal();
  await wait('page', `!!d.querySelector('${H('P-removal', 'digest-newer')}')`, 'removal newer offered', 8000);
  await click('page', H('P-removal', 'digest-refresh'));
  await wait('page', `d.querySelector('${D('P-removal')}')?.dataset.to==='4'`, 'removal digest');
  await click('page', `${H('P-removal', 'digest-entry-R3')} > summary`);
  const r3 = await guest<{ open: boolean; text: string; link: boolean; group: boolean }>('page', `const e=d.querySelector('${H('P-removal', 'digest-entry-R3')}'),row=d.querySelector('${H('P-removal', 'digest-task-R3')}');return {open:e.open,text:row.textContent,link:!!row.querySelector('[data-testid^="digest-view-"]'),group:!!d.querySelector('${H('P-removal', 'digest-group-removed')} [data-testid="digest-task-R3"]')}`);
  check('S3:removed-task-historical-detail', r3.open && r3.group && !r3.link && /Update download mirrors/.test(r3.text) && /Removed — last Blocked/.test(r3.text) && /Revision 2 → 3/.test(r3.text) && /Last recorded as “Update download mirrors” \(Blocked\)/.test(r3.text) && !/resolved|solved|completed/i.test(r3.text.replace('Recorded changes', '')), ['Removed task: recorded title/status/revision inline, labelled historical, no live link, never called resolved'], r3);
  await shot('page', 'removed-task', H('P-removal', 'digest-group-removed'));
  // Hide R1 behind a task filter and a closed group, then follow its current-task link.
  await click('page', TAB('progress'));
  await wait('page', `!!d.querySelector('[data-testid="focus-mode-unfinished"] button')`);
  await click('page', '[data-testid="focus-mode-unfinished"] button');
  await wait('page', `d.querySelector('[data-testid="item-R1"]')?.hidden===true`, 'R1 hidden by filter');
  await click('page', TAB('history'));
  await settled('page', 'P-removal');
  await click('page', H('P-removal', 'digest-view-R1'));
  await wait('page', `d.activeElement?.dataset?.testid==='item-R1'`, 'canonical row focused');
  const r1 = await guest<{ tab: string | null; mode: string | undefined; open: boolean; notice: string }>('page', `return {tab:d.querySelector('[data-testid="detail-tabs"] [aria-selected="true"]')?.dataset.id??null,mode:d.querySelector('[data-testid="focus-mode"]')?.dataset.mode,open:d.querySelector('[data-testid="group-toggle-M"]').open,notice:d.querySelector('[data-testid="focus-notice"]')?.textContent??''}`);
  check('S3:surviving-link-reveals-canonical-row', r1.tab === 'progress' && r1.mode === 'all' && r1.open && /Current task from History: Archive old builds/.test(r1.notice), ['Progress tab, filters cleared, ancestors open, canonical row focused'], r1);
  // Race: R2 is removed after the digest target, while the current-detail read is held.
  await click('page', TAB('history'));
  await settled('page', 'P-removal');
  fx.removeSurvivor();
  await wait('page', `!!d.querySelector('${H('P-removal', 'digest-newer')}')`, 'list observed the removal revision', 8000);
  await evaluate(`qa.holds.push({tag:'race',frame:'page',path:'/v1/plan',plan:'P-removal',before:true});true`);
  await click('page', H('P-removal', 'digest-view-R2'));
  await wait('page', `qa.held.some(h=>h.tag==='race')`, 'current detail read held');
  const waiting = await guest<{ tab: string | null; status: string }>('page', `return {tab:d.querySelector('[data-testid="detail-tabs"] [aria-selected="true"]')?.dataset.id??null,status:d.querySelector('${H('P-removal', 'digest-status')}')?.textContent??''}`);
  race('S3:link-waits-for-complete-current-detail', waiting.tab === 'history' && /Opening the current task “Rotate signing key”/.test(waiting.status), ['While current detail loads, History stays with a polite progress line'], waiting);
  await evaluate(`qa.release('race')`);
  await wait('page', `/no longer in the current plan/.test(d.querySelector('${H('P-removal', 'digest-status')}')?.textContent??'')`, 'fallback notice', 15_000);
  const raceRemoval = await guest<{ tab: string | null; row: boolean }>('page', `return {tab:d.querySelector('[data-testid="detail-tabs"] [aria-selected="true"]')?.dataset.id??null,row:!!d.querySelector('${H('P-removal', 'digest-task-R2')}')}`);
  race('S3:removed-after-target-fallback', raceRemoval.tab === 'history' && raceRemoval.row, ['Task removed after the digest target: polite notice, History and its recorded row kept, no jump'], raceRemoval);

  // ------------------------------------------------------------------ S4 switches, hidden, two windows
  // Plan switch with a held digest reply.
  await evaluate(`qa.holds.push({tag:'plan',frame:'page',path:'/v1/change-digest',plan:'P-digest'});true`);
  await select('page', 'P-digest');
  await wait('page', `qa.held.some(h=>h.tag==='plan')`);
  await select('page', 'P-gap'); await settled('page', 'P-gap');
  await evaluate(`qa.release('plan')`); await flightDone(); await frames2();
  race('S4:plan-switch-held-reply-retired', !(await guest<boolean>('page', `return !!d.querySelector('${D('P-digest')}')||/Verify checksums/.test(d.querySelector('[data-testid="plan-detail"]').textContent)`)), ['Held P-digest reply released after switching to P-gap never paints']);
  // Account switch with a held reply.
  await evaluate(`qa.holds.push({tag:'account',frame:'page',path:'/v1/change-digest',plan:'P-digest'});true`);
  await select('page', 'P-digest');
  await wait('page', `qa.held.some(h=>h.tag==='account')`);
  const keysBeforeSwitch = await deviceKeys();
  await evaluate(`qa.account='account-other';qa.ready('page');true`);
  await wait('page', `d.querySelector('[data-testid="detail-tabs"] [aria-selected="true"]')?.dataset.id!=='history'&&!d.querySelector('[data-testid="change-digest"]')`, 'selection/UI reset', 10_000);
  await evaluate(`qa.release('account')`); await flightDone(); await frames2();
  race('S4:account-switch-held-reply-retired', !(await guest<boolean>('page', `return !!d.querySelector('[data-testid="change-digest"]')`)) && same(await deviceKeys(), keysBeforeSwitch), ['Held reply from the previous account cannot paint or enable controls']);
  await select('page', 'P-digest'); await settled('page', 'P-digest');
  race('S4:other-account-initial', (await digestState('page', 'P-digest'))?.state === 'initial', ['Another account on the same profile starts initial, never borrowing']);
  await evaluate(`qa.account='account-example';qa.ready('page');true`);
  await wait('page', `d.querySelector('[data-testid="detail-tabs"] [aria-selected="true"]')?.dataset.id!=='history'&&!d.querySelector('[data-testid="change-digest"]')`, 'selection/UI reset', 10_000);
  // Store switch: same plan ID in another store never borrows the checkpoint.
  await evaluate(`qa.holds.push({tag:'store',frame:'page',path:'/v1/change-digest',plan:'P-digest'});true`);
  await select('page', 'P-digest');
  await wait('page', `qa.held.some(h=>h.tag==='store')`);
  await evaluate(`qa.store=1;true`);
  await wait('page', `d.querySelector('[data-testid="detail-tabs"] [aria-selected="true"]')?.dataset.id!=='history'&&!d.querySelector('[data-testid="change-digest"]')`, 'selection/UI reset', 10_000);
  await evaluate(`qa.release('store')`); await flightDone();
  await select('page', 'P-digest'); await settled('page', 'P-digest');
  race('S4:store-switch-isolated', (await digestState('page', 'P-digest'))?.state === 'initial' && /Unrelated task|Second store/.test(await text('page', '[data-testid="plan-detail"]')), ['Same plan ID in another store: initial view, store-1 content only']);
  await evaluate(`qa.store=0;true`);
  await wait('page', `d.querySelector('[data-testid="detail-tabs"] [aria-selected="true"]')?.dataset.id!=='history'&&!d.querySelector('[data-testid="change-digest"]')`, 'selection/UI reset', 10_000);
  // Hidden frame: a held refresh released while hidden cannot acknowledge; revalidated on return.
  await select('page', 'P-digest'); await settled('page', 'P-digest');
  const hidKeys = await deviceKeys();
  await evaluate(`qa.holds.push({tag:'hidden',frame:'page',path:'/v1/change-digest',plan:'P-digest'});true`);
  await click('page', H('P-digest', 'digest-refresh'));
  await wait('page', `qa.held.some(h=>h.tag==='hidden')`);
  await setHidden('page', true);
  fx.advance('P-digest', 'D');
  const hidden0 = await counts();
  await evaluate(`qa.release('hidden')`); await flightDone(); await new Promise((r) => setTimeout(r, 3500));
  const hidden1 = await counts();
  race('S4:hidden-no-reads-no-ack', sumOf(hidden1.digest) === sumOf(hidden0.digest) && (hidden1.plans.page ?? 0) === (hidden0.plans.page ?? 0) && same(await deviceKeys(), hidKeys), ['Hidden frame: no polls, no digest reads, no checkpoint write'], { hidden0, hidden1 });
  await setHidden('page', false);
  await wait('page', `d.querySelector('${D('P-digest')}')?.dataset.state==='comparison'`, 'restarted on return');
  await wait('page', `d.querySelector('${D('P-digest')}')?.dataset.to==='8'||!!d.querySelector('${H('P-digest', 'digest-newer')}')`, 'revision 8 pinned or offered', 8000);
  race('S4:visible-return-revalidates', same(await deviceKeys(), hidKeys), ['On return the retired sequence restarts for the listed revision; the newer revision is pinned or offered via Refresh; no acknowledgement']);
  // Two windows on one profile/account; a third on another profile.
  await show(['page', 'page2', 'page3'], 400);
  await select('page2', 'P-digest'); await settled('page2', 'P-digest');
  await select('page3', 'P-digest'); await settled('page3', 'P-digest');
  race('S4:other-profile-initial', (await digestState('page3', 'P-digest'))?.state === 'initial', ['A different device namespace remains initial']);
  const pinned = (await digestState('page', 'P-digest'))!.to;
  fx.advance('P-digest', 'D');
  await reenter('page2', 'P-digest');
  const b = await digestState('page2', 'P-digest');
  await click('page2', H('P-digest', 'digest-mark-reviewed'));
  await wait('page2', `d.querySelector('${D('P-digest')}')?.dataset.review==='saved'`);
  await click('page', H('P-digest', 'digest-mark-reviewed'));
  await wait('page', `/Already reviewed through revision ${b!.to}/.test(d.querySelector('${H('P-digest', 'digest-status')}')?.textContent??'')`, 'no rewind');
  const sharedKeys = await deviceKeys();
  race('S4:two-windows-never-rewind', sharedKeys.filter((k) => k.endsWith(`.${pinned}`)).length === 0 && sharedKeys.some((k) => k.endsWith(`.${b!.to}`)), [`Window B acknowledged ${b!.to}; window A (pinned ${pinned}) reports "already reviewed" and writes nothing older`], sharedKeys);
  // Focus return in A shows the newer acknowledgement without rewriting A's text.
  await guest('page', `w.dispatchEvent(new Event('focus'));return true`);
  await wait('page', `!!d.querySelector('${H('P-digest', 'digest-elsewhere')}')`, 'elsewhere notice');
  race('S4:focus-return-converges-without-rewrite', (await digestState('page', 'P-digest'))?.to === pinned, ['Focus return marks the other acknowledgement and offers Refresh; displayed interval unchanged']);
  await reenter('page', 'P-digest');
  const a2 = await digestState('page', 'P-digest');
  race('S4:reopen-reads-newest-shared-baseline', a2?.after === b!.to && a2?.state === 'comparison', ['Reopening History in window A compares from window B’s acknowledgement'], a2);
  await reenter('page3', 'P-digest');
  race('S4:other-profile-still-initial', (await digestState('page3', 'P-digest'))?.state === 'initial');
  await shotUnion(['page', 'page2', 'page3'], 'shared-checkpoint', '[data-testid="plan-detail"]');

  // ------------------------------------------------------------------ S5 gap/cap, unsupported, older service
  await show(['page'], 1100);
  await select('page', 'P-gap'); await settled('page', 'P-gap');
  if ((await digestState('page', 'P-gap'))?.review !== 'saved') { await click('page', H('P-gap', 'digest-mark-reviewed')); await wait('page', `d.querySelector('${D('P-gap')}')?.dataset.review==='saved'`); }
  const missing = fx.gap(5);
  await wait('page', `!!d.querySelector('${H('P-gap', 'digest-newer')}')`, 'gap newer offered', 8000);
  await click('page', H('P-gap', 'digest-refresh'));
  await wait('page', `d.querySelector('${H('P-gap', 'digest-coverage')}')?.dataset.complete==='false'`, 'partial');
  const gapCov = await guest<{ reasons: string; text: string; note: string }>('page', `return {reasons:d.querySelector('${H('P-gap', 'digest-coverage')}').dataset.reasons,text:d.querySelector('${H('P-gap', 'digest-coverage')}').textContent,note:d.querySelector('${H('P-gap', 'digest-review-note')}').textContent}`);
  check('S5:gap-qualified', /missing-snapshot/.test(gapCov.reasons) && /could be compared/.test(gapCov.text) && /won’t be recovered/.test(gapCov.note), [`Revision ${missing} removed: only the proven suffix is summarized; totals still compared`], gapCov);
  await shot('page', 'partial-history', D('P-gap'));
  await click('page', H('P-gap', 'digest-mark-reviewed'));
  await wait('page', `d.querySelector('${D('P-gap')}')?.dataset.review==='saved'`, 'partial reviewed explicitly');
  fx.many(140);
  await wait('page', `!!d.querySelector('${H('P-gap', 'digest-newer')}')`, 'cap newer offered', 8000);
  await click('page', H('P-gap', 'digest-refresh'));
  await wait('page', `/revision-bound/.test(d.querySelector('${H('P-gap', 'digest-coverage')}')?.dataset.reasons??'')`, 'revision cap qualified', 15_000);
  check('S5:cap-qualified', /most recent 128 revisions/.test(await text('page', H('P-gap', 'digest-coverage'))), ['More than 128 revisions: bounded and qualified, not zero']);
  // Rejected write: failure is announced, never success; prior baseline kept.
  const rejectKeys = await deviceKeys();
  await evaluate(`qa.storageFaults.push({frame:'page',op:'set',code:'DENIED',once:true});true`);
  await click('page', H('P-gap', 'digest-mark-reviewed'));
  await wait('page', `d.querySelector('${D('P-gap')}')?.dataset.review==='failed'`, 'write rejected');
  const rejected = await text('page', H('P-gap', 'digest-status'));
  check('S5:rejected-write-not-success', /refused/.test(rejected) && !/Marked reviewed/.test(rejected) && same(await deviceKeys(), rejectKeys), ['Rejected write: failure announced, previous review point unchanged'], rejected);
  // Unsupported device storage.
  const unsupported0 = await counts();
  await evaluate(`qa.deviceStorage=false;qa.ready('page');true`);
  await reenter('page', 'P-gap');
  const un = await digestState('page', 'P-gap');
  const unsupported1 = await counts();
  check('S5:unsupported-storage-unavailable', un?.state === 'unavailable' && un.reason === 'checkpoint-unsupported' && !(await guest<boolean>('page', `return !!d.querySelector('${H('P-gap', 'digest-mark-reviewed')}')`)) && unsupported1.deviceKeys === unsupported0.deviceKeys && unsupported1.instanceSet === 0, ['No device feature: unavailable (not initial), no Mark reviewed, no storage of any scope'], un);
  await shot('page', 'checkpoint-unavailable', D('P-gap'));
  await evaluate(`qa.deviceStorage=true;qa.ready('page');true`);
  // Older service without the capability.
  await evaluate(`qa.stripDigests=true;true`);
  await polls('page', 1);
  const old0 = await counts();
  await reenter('page', 'P-gap');
  const old = await digestState('page', 'P-gap');
  check('S5:older-service-unavailable', old?.state === 'unavailable' && old.reason === 'service' && sumOf((await counts()).digest) === sumOf(old0.digest), ['No planChangeDigests capability: unavailable, zero digest requests'], old);
  await evaluate(`qa.stripDigests=false;true`);
  await polls('page', 1);

  // ------------------------------------------------------------------ S6 archive, restore, delete
  await select('page', 'P-release'); await settled('page', 'P-release');
  await click('page', H('P-release', 'digest-mark-reviewed'));
  await wait('page', `d.querySelector('${D('P-release')}')?.dataset.review==='saved'`);
  const releaseRev = String(fx.revision('P-release'));
  await click('page', '[data-testid="cleanup-archive"] button');
  await wait('page', `!!d.querySelector('[data-testid="cleanup-notice"]')&&!d.querySelector('${row('P-release')}')`, 'archived');
  await click('page', '[data-testid="cleanup-archived"] button');
  await select('page', 'P-release'); await settled('page', 'P-release');
  const arch = await digestState('page', 'P-release');
  check('S6:archived-history-inspectable', arch?.state === 'comparison' && arch.after === releaseRev && /No new revisions since you reviewed revision/.test(await text('page', H('P-release', 'digest-coverage'))), ['Archived plan keeps its shared baseline; cleanup changed, progress did not'], arch);
  await shot('page', 'archived-history', '[data-testid="plan-detail"]');
  await click('page', '[data-testid="cleanup-restore"] button');
  await wait('page', `!d.querySelector('${row('P-release')}')`, 'restored');
  await click('page', '[data-testid="cleanup-visible"] button');
  await select('page', 'P-release'); await settled('page', 'P-release');
  check('S6:restored-same-baseline', (await digestState('page', 'P-release'))?.after === releaseRev);
  const relKeys = (await deviceKeys()).length;
  await evaluate(`qa.holds.push({tag:'delete',frame:'page',path:'/v1/change-digest',plan:'P-release'});true`);
  await click('page', H('P-release', 'digest-refresh'));
  await wait('page', `qa.held.some(h=>h.tag==='delete')`);
  await click('page', '[data-testid="cleanup-delete"] button');
  await wait('page', `!!d.querySelector('[data-testid="cleanup-confirm-delete"] button')`);
  await click('page', '[data-testid="cleanup-confirm-delete"] button');
  await wait('page', `!!d.querySelector('[data-testid="cleanup-notice"]')&&!d.querySelector('${row('P-release')}')`, 'deleted', 15_000);
  await evaluate(`qa.release('delete')`); await flightDone(); await frames2();
  const del = await guest<{ digest: boolean; text: boolean; other: string | null }>('page', `return {digest:!!d.querySelector('${D('P-release')}'),text:/Finished release example|Tag release/.test(d.body.textContent),other:d.querySelector('[data-testid="change-digest"]')?.closest('article')?.dataset.testid??null}`);
  check('S6:deleted-held-reply-cannot-resurrect', !del.digest && !del.text && !fx.exists('P-release') && del.other !== 'plan-P-release', ['Held pre-delete reply released after deletion paints nothing; the board shows another plan’s own History'], del);
  await wait('page', `qa.deviceKeys('profile-1').length===${relKeys - 1}`, 'deleted plan markers forgotten');
  check('S6:delete-forgets-markers', true, ['Authoritative delete removed this plan’s device markers only']);
  await shot('page', 'deleted-plan', 'main');

  // ------------------------------------------------------------------ S7 reflow, narrow, motion, panel/status
  await theme('dark');
  await show(['page'], 360);
  await select('page', 'P-removal'); await settled('page', 'P-removal');
  await click('page', `${H('P-removal', 'digest-entry-R3')} > summary`);
  const narrow = await noOverflow('page');
  const reach = await guest<boolean>('page', `const cw=d.documentElement.clientWidth;return ['digest-mark-reviewed','digest-refresh','digest-view-R1'].every(id=>{const n=d.querySelector('${D('P-removal')} [data-testid="'+id+'"]');const r=n.getBoundingClientRect();return r.left>=0&&r.right<=cw&&r.width>0})`);
  check('S7:360-no-overflow-actions-reachable', narrow.ok && reach, ['360px (dark): no horizontal overflow; Mark reviewed, Refresh and task links fully reachable'], narrow);
  await shot('page', 'narrow-history', D('P-removal'));
  await theme('light');
  await c.send('Emulation.setDeviceMetricsOverride', { width: 640, height: 1100, deviceScaleFactor: 2, mobile: false });
  await show(['page'], 550);
  await reenter('page', 'P-removal');
  const reflow = await noOverflow('page');
  // Keyboard reachability at 200%: Tab to Refresh digest and activate it with Space.
  await guest('page', `d.querySelector('${TAB('history')}').focus();return true`);
  let t2 = 0;
  while (t2 < 60 && !(await guest<boolean>('page', `return d.activeElement?.dataset?.testid==='digest-refresh'`))) { await key('Tab'); t2++; }
  const before7 = await counts();
  await key(' ');
  await wait('page', `d.querySelector('${H('P-removal', 'digest-status')}')?.textContent==='Digest refreshed.'`, 'keyboard refresh at 200%');
  check('S7:200-percent-reflow', reflow.ok && sumOf((await counts()).digest) - sumOf(before7.digest) === 1, ['200% reflow (half CSS width at device scale 2): no overflow; Refresh reached by Tab and activated by Space'], reflow);
  const motion = await guest<{ animations: number; transitions: string[] }>('page', `const s=d.querySelector('[data-testid="change-digest"]');return {animations:s.getAnimations({subtree:true}).length,transitions:[...s.querySelectorAll('*')].map(n=>getComputedStyle(n).transitionDuration).filter(t=>t!=='0s').slice(0,3)}`);
  check('S7:no-digest-animation-reduced-motion', motion.animations === 0 && motion.transitions.length === 0, ['No digest animation or transition under reduced motion; nothing hidden by motion'], motion);
  const colourOnly = await guest<boolean>('page', `return [...d.querySelectorAll('[data-testid^="digest-task-"]')].every(r=>r.querySelector('.ap-digest-facets')?.textContent.trim().length>0)`);
  check('S7:classification-not-colour-only', colourOnly, ['Every changed task states its classification in text']);
  await shot('page', 'reflow-history', D('P-removal'));
  await c.send('Emulation.clearDeviceMetricsOverride');
  await show(['panel', 'status'], 360);
  const surfaces = await evaluate<{ panel: boolean; status: boolean; requests: number; storage: number }>(`({panel:!!frame('panel').contentDocument.querySelector('[data-testid="change-digest"]'),status:!!frame('status').contentDocument.querySelector('[data-testid="change-digest"]'),requests:qa.requests.filter(r=>r.path==='/v1/change-digest'&&(r.frame==='panel'||r.frame==='status')).length,storage:qa.storageLog.filter(l=>l.scope==='device'&&(l.frame==='panel'||l.frame==='status')).length})`);
  check('S7:panel-status-unchanged', !surfaces.panel && !surfaces.status && surfaces.requests === 0 && surfaces.storage === 0, ['Rail and Work Status show no digest UI and start no digest or checkpoint work'], surfaces);
  requestResults.push({ interaction: 'whole run: panel/status frames', counts: { digestRequests: surfaces.requests, deviceStorageOps: surfaces.storage }, expectation: 'zero', pass: surfaces.requests === 0 && surfaces.storage === 0 });
  const getKeys = await evaluate<{ own: boolean; total: number }>(`(()=>{const all={};for(const ns of Object.keys(qa.devices))for(const k of qa.deviceKeys(ns))all[k]=1;const gets=qa.storageLog.filter(l=>l.scope==='device'&&l.op==='get');return {own:gets.every(g=>/^rv1\\.[0-9a-f]{64}\\.\\d+$/.test(g.key)),total:gets.length}})()`);
  requestResults.push({ interaction: 'whole run: device value reads', counts: { gets: getKeys.total }, expectation: 'only revision-addressed checkpoint keys are fetched (enumeration via one bounded keys() per read)', pass: getKeys.own });
  check('V6:device-reads-bounded', getKeys.own, undefined, getKeys);

  facts.fixtureWrites = fx.fixtureWrites();
  facts.digestRequests = (await counts()).digest;
  facts.serviceMode = built ? 'built generated service' : 'current TypeScript service';
  check('S0:no-proxy-errors', same(await evaluate('qa.errors'), []));
  const errors = c.events.map((e) => String(e.params.exceptionDetails?.exception?.description ?? e.params.args?.map((a: any) => a.value ?? a.description).join(' ') ?? '').split('\n')[0].slice(0, 160));
  check('S0:no-guest-exceptions-or-console-errors', errors.length === 0, undefined, errors);
} catch (e) {
  failure = e instanceof Error ? e.message.split('\n')[0].slice(0, 600) : String(e);
} finally {
  page?.close(); browser?.close();
  const exited = new Promise((r) => { if (chrome.exitCode !== null) r(null); else chrome.once('exit', r); });
  try { process.kill(-chrome.pid!, 'SIGTERM'); } catch { chrome.kill('SIGTERM'); }
  await exited;
  await fx.stop();
  const evidenceClass = `synthetic SDK shell, real disposable HTTP service over SQLite (${built ? 'built generated service' : 'current TypeScript service'}), isolated headless Linux Chromium, current guest bundles`;
  const summary = { evidenceClass, nativeHostProof: false, crossDeviceProof: false, passed: !failure && results.every((r) => r.pass) && races.every((r) => r.pass), failure, assertions: results.length, results, facts, screenshots: shots };
  writeFileSync(join(artifacts, 'results.json'), `${JSON.stringify(summary, null, 2)}\n`);
  writeFileSync(join(artifacts, 'race-results.json'), `${JSON.stringify({ evidenceClass, passed: !failure && races.every((r) => r.pass), assertions: races.length, results: races }, null, 2)}\n`);
  writeFileSync(join(artifacts, 'request-results.json'), `${JSON.stringify({ evidenceClass, passed: requestResults.every((r) => r.pass), interactions: requestResults }, null, 2)}\n`);
  console.log(JSON.stringify({ passed: summary.passed, assertions: results.length, races: races.length, requests: requestResults.length, failure, screenshots: shots }, null, 2));
  if (!summary.passed) process.exitCode = 1;
  rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
