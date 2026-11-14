// Waiting-delegation QA (lane I2) in an isolated headless Chromium with real CDP pointer/keyboard/touch
// input. A synthetic SDK shell loads the three guests (source-built with --source, else the tracked
// bundles) and relays their requests to a SYNTHETIC in-process service shaped by the frozen overlay
// contract (shared/delegation-view.ts): health capability, a delegation token per list row and the
// overlay on the first detail page. It is not the service lane's projection, not native-host proof
// and not physical-phone certification: simulated device hints and touch emulation only.
// Usage: node --experimental-strip-types tests/browser/delegation-intent-qa.ts [--source] [--chromium <path>] --artifacts <dir>
//   writes results.json (checks), requests.json (bounded request metadata) and screenshots.
import { javascriptLiteral } from '../../shared/javascript-literal.ts';
import { spawn } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { GuestRequest } from '@openchamber/sdk';
import type { Item, PlanSummary } from '../../shared/progress.ts';
import { createGuestAssets } from './source-guests.ts';
import { HEALTH, S, SRC, envelope, planPage, plansPage, summary } from './fixtures.ts';

const arg = (name: string) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const artifacts = arg('--artifacts');
if (!artifacts) throw new Error('usage: delegation-intent-qa.ts [--source] [--chromium <path>] --artifacts <dir>');
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

// ------------------------------------------------------------------ synthetic contract service
/** Overlay state; the progress revision never changes between them (declaration/cancel do not advance it). */
type Mode = 'pending' | 'reserved' | 'cancelled' | 'refused' | 'unavailable' | 'mismatch' | 'unsupported';
let mode: Mode = 'pending';
const REVISION = 5;
const ITEMS: Item[] = [
  { id: 'task-a', title: 'Write the export adapter', kind: 'task', status: 'pending' },
  { id: 'task-b', title: 'Подготовить русскую документацию к выпуску с длинным названием задачи', kind: 'task', status: 'pending' },
  { id: 'task-c', title: 'Run the release checks', kind: 'task', status: 'working' },
  { id: 'task-d', title: 'Choose the archive format', kind: 'task', status: 'done' },
];
const plan = (): PlanSummary => ({
  ...summary('plan-alpha', ITEMS, { title: 'Export pipeline', sessionId: S.M, revision: REVISION, structuralRevision: 2, cleanup: { state: 'visible', revision: 0 } } as Partial<PlanSummary>),
  ...(mode === 'unsupported' ? {} : { delegationToken: `token-${mode === 'mismatch' ? 'list-only' : mode}` }),
} as PlanSummary);
const declaration = (dispatched: boolean) => ({ oid: 'declaration-qa', coordinatorSessionId: S.M, declaredRevision: REVISION, taskIds: ['task-a', 'task-b'], dispatch: dispatched ? { tool: 'subagent', messageId: 'message-qa', callId: 'call-qa' } : null });
function overlay() {
  const result = mode === 'unavailable' ? { availability: 'unavailable', complete: false, reason: 'budget' }
    : { availability: 'ready', complete: true, disposition:
      mode === 'pending' || mode === 'mismatch' ? { state: 'pending', eligible: true, declaration: declaration(false) }
        : mode === 'reserved' ? { state: 'reserved', eligible: true, declaration: declaration(true) }
          : mode === 'cancelled' ? { state: 'cancelled', declaration: declaration(false), reason: 'cancelled' }
            : { state: 'refused', declaration: { ...declaration(true), taskIds: ['task-a'] }, reason: 'relevant-change', recovery: 'redeclare-or-link' } };
  return {
    protocolVersion: 2, schemaVersion: 2, delegationIntent: 1, storeId: 'store-1', sourceBinding: { sourceId: SRC, verified: true },
    source: SRC, plan: 'plan-alpha', revision: REVISION, structuralRevision: 2, cleanup: { state: 'visible', revision: 0 },
    token: `token-${mode}`, readAt: new Date().toISOString(), result,
  };
}
function serve(q: GuestRequest): { status: number; body: unknown } {
  const query = q.query ?? {};
  if (q.method !== 'GET') return { status: 405, body: { error: 'method' } };
  if (q.path === '/health') return { status: 200, body: { ...HEALTH, ...(mode === 'unsupported' ? {} : { delegationIntent: 1 }) } };
  if (q.path === '/v1/plans') return { status: 200, body: plansPage(!query.session || query.session === S.M ? [plan()] : []) };
  if (q.path === '/v1/plan') {
    if (query.plan !== 'plan-alpha' || query.source !== SRC) return { status: 404, body: { error: 'not-found' } };
    return { status: 200, body: { ...planPage(plan(), ITEMS, [], undefined, []), ...(mode !== 'unsupported' && query.delegationIntent === '1' && !query.cursor ? { delegationIntent: overlay() } : {}) } };
  }
  if (q.path === '/v1/history') return { status: 200, body: { ...envelope(), data: [], nextCursor: null } };
  return { status: 404, body: { error: 'not-found' } };
}

// ------------------------------------------------------------------ synthetic SDK shell
const LIGHT = { background: '#fafafa', elevated: '#ffffff', foreground: '#202124', muted: '#64676e', subtle: '#74777e', border: '#dedfe3', hover: '#f0f1f3', selection: '#e7eefb', focus: '#376bc4', primary: '#316ac3', mutedSurface: '#f3f4f6', elevatedForeground: '#202124', active: '#e7e9ed', selectionForeground: '#173964', primaryForeground: '#ffffff', primaryText: '#24579e', successText: '#237044', warningText: '#855900', errorText: '#ad3030', infoText: '#24579e', success: '#27824d', warning: '#a66c00', error: '#c23d3d', info: '#316ac3', font: 'system-ui, sans-serif', mono: 'monospace', radius: '6px' };
const DARK = { ...LIGHT, background: '#191b20', elevated: '#24272e', foreground: '#e6e8ee', muted: '#a4a9b4', subtle: '#9298a4', border: '#414650', hover: '#343944', selection: '#293d60', focus: '#90b8ff', primary: '#83aff7', mutedSurface: '#24272e', elevatedForeground: '#e6e8ee', active: '#3b4350', selectionForeground: '#e0ebff', primaryText: '#a6c7ff', successText: '#86dca3', warningText: '#e8c372', errorText: '#ff9e9e', infoText: '#a6c7ff', success: '#6fc58c', warning: '#d9b367', error: '#ee8989', info: '#83aff7' };
const FRAMES = ['page', 'panel', 'status'] as const;
const PROJECT = { id: 'alpha', name: 'Alpha', directory: '/fixture/Alpha' };
const SESSIONS = [{ id: S.M, title: 'Export session', parentId: null, projectId: PROJECT.id, directory: PROJECT.directory, createdAt: 1, updatedAt: 2, archivedAt: null, worktree: null, activity: 'idle', outcome: null, items: [] }];
const shellScript = `
const light=${JSON.stringify(LIGHT)},dark=${JSON.stringify(DARK)};
const frames=${JSON.stringify(FRAMES)},frame=f=>document.querySelector('iframe[data-frame="'+f+'"]');
const send=(f,m)=>frame(f)?.contentWindow?.postMessage({channel:'openchamber.sdk',v:1,...m},'*');
const project=${JSON.stringify(PROJECT)},sessions=${JSON.stringify(SESSIONS)};
window.frame=frame;
window.qa={session:null,locale:'en',mode:'light',device:null,requests:[],messages:[],storage:new Map()};
const theme=()=>({mode:qa.mode,tokens:qa.mode==='dark'?dark:light});
const ready=f=>send(f,{type:'ready',payload:{theme:theme(),locale:qa.locale,directory:project.directory,session:qa.session?{id:qa.session}:null,surface:f,connection:{connected:true,account:'account-example'},settings:{},item:null,...(qa.device?{device:qa.device}:{})}});
qa.context=id=>{qa.session=id;for(const f of frames){ready(f);send(f,{type:'directory',payload:{directory:project.directory}});send(f,{type:'session',payload:{session:id?{id}:null}})}};
qa.show=(list,width)=>{for(const n of document.querySelectorAll('section[data-frame]')){const on=list.includes(n.dataset.frame);n.style.display=on?'block':'none';if(on)n.style.width=width+'px'}};
qa.theme=mode=>{qa.mode=mode;const t=theme().tokens;document.body.style.background=t.background;document.body.style.color=t.foreground;frames.forEach(ready)};
qa.lang=l=>{qa.locale=l;frames.forEach(ready)};
qa.phone=on=>{qa.device=on?{formFactor:'phone',pointer:'coarse',insets:{top:20,right:0,bottom:16,left:0},keyboard:0}:null;frames.forEach(ready)};
const snapshot=q=>q.kind==='projects'?{kind:'projects',state:'ready',projects:[project]}:q.kind==='worktrees'?{kind:'worktrees',projectId:q.projectId,state:'ready',worktrees:[]}:{kind:'sessions',projectId:q.projectId,state:'ready',coverage:[],sessions:q.projectId===project.id?sessions:[]};
addEventListener('message',async e=>{
 const el=[...document.querySelectorAll('iframe')].find(x=>x.contentWindow===e.source),m=e.data;if(!el||m.channel!=='openchamber.sdk')return;const f=el.dataset.frame;
 const result=payload=>send(f,{type:'result',id:m.id,ok:true,payload});
 qa.messages.push({frame:f,type:m.type,at:performance.now()});
 if(m.type==='hello')ready(f);
 else if(m.type==='workspace-subscribe'){result();send(f,{type:'workspace',payload:{subscriptionId:m.payload.subscriptionId,snapshot:snapshot(m.payload.query)}})}
 else if(m.type==='storage'){const q=m.payload,k=f+':'+q.key;if(q.op==='set')qa.storage.set(k,q.value);if(q.op==='delete')qa.storage.delete(k);result({storage:true,op:q.op,found:qa.storage.has(k),value:qa.storage.get(k),...(q.op==='keys'?{keys:[]}:{})})}
 else if(m.type==='service-request'){
  const q=m.payload;qa.requests.push({frame:f,method:q.method,path:q.path,intent:q.query?.delegationIntent??null,cursor:q.query?.cursor??null,plan:q.query?.plan??null,at:performance.now()});
  const r=await fetch('/service',{method:'POST',body:JSON.stringify(q)});result(await r.json());
 }else if(m.id)result();
});
`;
const shell = `<!doctype html><html><head><meta charset="utf-8"><title>Waiting delegation QA</title><style>html,body{margin:0;background:#fafafa;color:#202124;font:14px system-ui}main{display:flex;flex-wrap:wrap;align-items:flex-start}section{margin:12px;display:none}h1{font-size:13px;margin:0 0 8px}iframe{display:block;width:100%;height:1400px;border:0}section[data-frame=status] iframe{height:320px}</style></head><body><script>${shellScript}</script><main>${FRAMES.map((f) => `<section data-frame="${f}"><h1>Agent progress · ${f}</h1><iframe data-frame="${f}" title="${f}" src="/ui/${f}/index.html"></iframe></section>`).join('')}</main></body></html>`;

const assets = createGuestAssets({ source: process.argv.includes('--source') });
const server: Server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  try {
    if (url.pathname === '/') { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(shell); return; }
    const asset = assets.read(url.pathname);
    if (asset) { res.setHeader('content-type', url.pathname.endsWith('.js') ? 'text/javascript' : 'text/html'); res.end(asset); return; }
    if (url.pathname === '/service' && req.method === 'POST') {
      let body = ''; for await (const part of req) body += part;
      const r = serve(JSON.parse(body));
      res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ status: r.status, body: JSON.stringify(r.body) })); return;
    }
    res.statusCode = url.pathname === '/favicon.ico' ? 204 : 404; res.end();
  } catch { res.statusCode = 500; res.end('{"error":"fixture-failed"}'); }
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

// ------------------------------------------------------------------ CDP
type Cdp = { send: (method: string, params?: object) => Promise<any>; close: () => void; errors: string[] };
async function connect(url: string): Promise<Cdp> {
  const ws = new WebSocket(url);
  await new Promise<void>((resolve, reject) => { ws.onopen = () => resolve(); ws.onerror = () => reject(new Error('CDP connect failed')); });
  let next = 1;
  const waiting = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  const errors: string[] = [];
  ws.onmessage = (event) => {
    const m = JSON.parse(String(event.data));
    const w = m.id && waiting.get(m.id);
    if (w) { waiting.delete(m.id); if (m.error) w.reject(new Error(m.error.message)); else w.resolve(m.result); }
    else if (m.method === 'Runtime.exceptionThrown') errors.push(String(m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text).slice(0, 300));
    else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(String(m.params.args?.[0]?.value ?? 'console.error').slice(0, 300));
  };
  return { errors, send: (method, params = {}) => new Promise((resolve, reject) => { const id = next++; waiting.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); }), close: () => ws.close() };
}

type Result = { id: string; pass: boolean; facts?: unknown };
const results: Result[] = [];
const shots: string[] = [];
function check(id: string, pass: boolean, facts?: unknown) {
  results.push({ id, pass, ...(facts === undefined ? {} : { facts }) });
  if (!pass) throw new Error(`${id} failed${facts === undefined ? '' : `: ${JSON.stringify(facts).slice(0, 900)}`}`);
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

mkdirSync('/tmp/opencode', { recursive: true });
const profile = mkdtempSync('/tmp/opencode/delegation-intent-qa-');
const chrome = spawn(findChromium(), ['--headless=new', '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--disable-sync', '--hide-scrollbars', '--window-size=1320,1100', 'about:blank'], { stdio: 'ignore', detached: true });
let page: Cdp | null = null;
let browserVersion = '';
let requestLog: unknown[] = [];
let failure: string | null = null;
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
  await c.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await c.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await c.send('Page.navigate', { url: `${origin}/` });

  const evaluate = async <T = any>(expression: string): Promise<T> => {
    const r = await c.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value as T;
  };
  const guest = <T = any>(f: string, code: string) => evaluate<T>(`(()=>{const w=frame('${f}').contentWindow,d=w.document;${code}})()`);
  const wait = async (f: string, cond: string, what = cond, ms = 20_000) => {
    const ok = await evaluate<boolean>(`(async()=>{const end=performance.now()+${ms};while(performance.now()<end){try{const w=frame('${f}').contentWindow,d=w.document;if(${cond})return true}catch{}await new Promise(r=>requestAnimationFrame(r));}return false})()`);
    if (!ok) throw new Error(`timed out waiting (${f}): ${what}`);
  };
  const waitTop = async (cond: string, what = cond, ms = 20_000) => {
    const ok = await evaluate<boolean>(`(async()=>{const end=performance.now()+${ms};while(performance.now()<end){try{if(${cond})return true}catch{}await new Promise(r=>requestAnimationFrame(r));}return false})()`);
    if (!ok) throw new Error(`timed out waiting: ${what}`);
  };
  const settle = () => evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  const codes: Record<string, number> = { Enter: 13, Tab: 9, ' ': 32, Escape: 27 };
  const key = async (k: string) => {
    const text = k === 'Enter' ? { text: '\r', unmodifiedText: '\r' } : k === ' ' ? { text: ' ', unmodifiedText: ' ' } : {};
    await c.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: k === ' ' ? 'Space' : k, windowsVirtualKeyCode: codes[k] ?? 0, ...text });
    await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k === ' ' ? 'Space' : k, windowsVirtualKeyCode: codes[k] ?? 0 });
  };
  const point = (f: string, selector: string) => evaluate<[number, number] | null>(`(()=>{const fr=frame('${f}'),n=fr.contentDocument.querySelector(${javascriptLiteral(selector)});if(!n)return null;n.scrollIntoView({block:'center'});fr.scrollIntoView({block:'nearest'});const r=n.getBoundingClientRect(),o=fr.getBoundingClientRect();return [o.x+r.x+Math.min(16,r.width/2),o.y+r.y+Math.min(10,r.height/2)]})()`);
  const click = async (f: string, selector: string) => {
    const p = await point(f, selector);
    if (!p) throw new Error(`missing ${selector} in ${f}`);
    for (const t of ['mouseMoved', 'mousePressed', 'mouseReleased']) await c.send('Input.dispatchMouseEvent', { type: t, x: p[0], y: p[1], button: 'left', clickCount: 1 });
  };
  const tap = async (f: string, selector: string) => {
    const p = await point(f, selector);
    if (!p) throw new Error(`missing ${selector} in ${f}`);
    await c.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p[0], y: p[1] }] });
    await c.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  /** Real keyboard Tab presses until `selector` has focus (bounded). */
  const tabTo = async (f: string, selector: string, max = 80) => {
    await guest(f, `w.focus();return true`);
    for (let i = 0; i < max; i++) {
      if (await guest<boolean>(f, `return !!d.activeElement?.matches(${javascriptLiteral(selector)})`)) return i;
      await key('Tab');
    }
    throw new Error(`Tab never reached ${selector} in ${f}`);
  };
  const show = async (list: string[], width: number) => { await evaluate(`qa.show(${javascriptLiteral(list)},${width});true`); for (const f of list) await wait(f, `w.innerWidth===${width}`, `${f} width ${width}`); };
  const shot = async (f: string, name: string, selector: string, pad = 10) => {
    await guest(f, `d.querySelector(${javascriptLiteral(selector)})?.scrollIntoView({block:'start'});return true`);
    await settle();
    const r = await evaluate<number[] | null>(`(()=>{const fr=frame('${f}'),o=fr.getBoundingClientRect(),n=fr.contentDocument.querySelector(${javascriptLiteral(selector)});if(!n)return null;const a=n.getBoundingClientRect();return [o.x+a.left+scrollX,o.y+a.top+scrollY,a.width,a.height]})()`);
    if (!r) throw new Error(`no ${selector} to capture in ${f}`);
    const png = await c.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: Math.max(0, r[0] - pad), y: Math.max(0, r[1] - pad), width: r[2] + 2 * pad, height: Math.min(r[3] + 2 * pad, 3000), scale: 1 } });
    writeFileSync(join(artifacts, `${name}.png`), Buffer.from(png.data, 'base64'));
    shots.push(`${name}.png`);
  };
  const requests = () => evaluate<any[]>('qa.requests');
  const noOverflow = (f: string) => guest<{ ok: boolean; sw: number; cw: number; out: string[] }>(f, `const cw=d.documentElement.clientWidth,sw=d.documentElement.scrollWidth,out=[...d.querySelectorAll('[data-testid="progress-root"] *')].filter(n=>{const r=n.getBoundingClientRect();return r.width>0&&!n.closest('.ap-sr')&&(r.right>cw+0.5||r.left<-0.5)}).map(n=>n.dataset.testid||n.className||n.tagName).slice(0,8);return {ok:sw<=cw&&!out.length,sw,cw,out}`);
  const ART = 'article[data-testid="plan-plan-alpha"]';
  const notes = (f: string) => guest<any[]>(f, `return [...d.querySelectorAll('${ART} .ap-intent')].map(n=>({task:n.closest('li[data-testid^="item-"]').dataset.testid.slice(5),hook:n.dataset.testid,intent:n.dataset.intent,reason:n.dataset.reason??null,text:n.textContent,status:n.closest('li').dataset.status}))`);
  const article = (f: string) => guest<any>(f, `const a=d.querySelector('${ART}');return a?{delegation:a.dataset.delegation??null,revision:a.dataset.revision,chips:[...a.querySelectorAll('[data-testid="state-chip"]')].map(n=>n.dataset.state+':'+n.textContent),statuses:[...a.querySelectorAll('li[data-testid^="item-"]')].map(n=>n.dataset.testid.slice(5)+':'+n.dataset.status)}:null`);
  // Records whether the task list was ever replaced by its loading placeholder (a token-only refresh must not do that).
  const watchGap = (f: string) => guest(f, `w.__gap=false;w.__gapObs?.disconnect();w.__gapObs=new w.MutationObserver(()=>{if(d.querySelector('${ART} [data-testid="detail-loading"]')||!d.querySelector('${ART} li[data-testid="item-task-c"]'))w.__gap=true});w.__gapObs.observe(d.body,{childList:true,subtree:true});return true`);

  await waitTop(`window.qa&&frame('panel').contentDocument?.querySelector('[data-testid="progress-root"]')`, 'shell ready', 30_000);
  await evaluate(`qa.theme('light');true`);
  await evaluate(`qa.context(${javascriptLiteral(S.M)});true`);

  // ---------------------------------------------------------------- rail: pending (desktop width)
  await show(['panel', 'status'], 400);
  await wait('panel', `d.querySelector('${ART} [data-testid="delegation-pending"]')`, 'pending note in the rail');
  const pending = await notes('panel');
  check('I2:rail-pending-on-declared-tasks-only', same(pending.map((n) => n.task), ['task-a', 'task-b']) && pending.every((n) => n.hook === 'delegation-pending' && n.intent === 'waiting' && n.text === 'Next sub-agent will take this'), pending);
  const pendingArt = await article('panel');
  check('I2:note-is-display-only', pendingArt.delegation === 'waiting' && same([...pendingArt.statuses].sort(), ['task-a:pending', 'task-b:pending', 'task-c:working', 'task-d:done']) && pendingArt.revision === String(REVISION), pendingArt);
  const a11y = await guest<any>('panel', `const n=d.querySelector('${ART} li[data-testid="item-task-a"] .ap-intent'),s=n.closest('summary');return {inSummary:!!s,focusable:n.matches('a,button,input,[tabindex]')||!!n.querySelector('a,button,input,[tabindex]'),name:s.textContent,color:getComputedStyle(n).color,titleColor:getComputedStyle(s.querySelector('.ap-trow-title')).color,size:parseFloat(getComputedStyle(n).fontSize)}`);
  check('I2:note-read-with-row-and-not-a-control', a11y.inSummary && !a11y.focusable && /Write the export adapter.*Next sub-agent will take this/.test(a11y.name), a11y);
  check('I2:note-is-faint', a11y.color !== a11y.titleColor && a11y.size < 13, a11y);
  // Keyboard: open the row and read the explanation (no work started, no sub-agent assigned).
  await tabTo('panel', `${ART} li[data-testid="item-task-a"] summary`);
  await key('Enter');
  await wait('panel', `d.querySelector('[data-testid="delegation-fact-task-a"]')`, 'pending fact');
  const fact = await guest<any>('panel', `const dd=d.querySelector('[data-testid="delegation-fact-task-a"]');return {term:dd.previousElementSibling.textContent,text:dd.textContent,intent:dd.dataset.intent}`);
  check('I2:pending-fact-says-nothing-started', fact.term === 'Sub-agent handoff' && fact.intent === 'waiting' && fact.text === 'Waiting for the next sub-agent the coordinator starts. No work has started, and no sub-agent is assigned yet.', fact);
  await shot('panel', 'panel', '[data-testid="progress-root"]');
  check('I2:status-never-asks', (await requests()).filter((q) => q.frame === 'status').every((q) => q.intent === null));

  // ---------------------------------------------------------------- reserved, then cancelled: same revision
  mode = 'reserved';
  await new Promise((r) => setTimeout(r, 3_800));
  check('I2:reserved-still-waiting', same((await notes('panel')).map((n) => n.intent), ['waiting', 'waiting']));
  await watchGap('panel');
  const mark = (await requests()).length;
  mode = 'cancelled';
  await wait('panel', `d.querySelector('${ART}')?.dataset.delegation==='clear'`, 'cancel clears the note', 15_000);
  const cleared = await notes('panel');
  const gap = await guest<boolean>('panel', `return w.__gap`);
  const afterCancel = (await requests()).slice(mark).filter((q) => q.frame === 'panel' && q.path === '/v1/plan');
  check('I2:cancel-clears-on-ordinary-refresh', cleared.length === 0 && (await article('panel')).revision === String(REVISION), cleared);
  check('I2:token-refresh-keeps-tasks-painted', !gap, { gap });
  check('I2:token-refresh-reads-detail-once', afterCancel.length === 1 && afterCancel[0].intent === '1', afterCancel);

  // ---------------------------------------------------------------- refused: labelled as a refusal
  mode = 'refused';
  await wait('panel', `d.querySelector('${ART} [data-testid="delegation-refused"]')`, 'refusal note', 15_000);
  const refused = await notes('panel');
  check('I2:refusal-labelled-not-waiting', same(refused.map((n) => [n.task, n.hook, n.reason, n.text]), [['task-a', 'delegation-refused', 'changed', 'Sub-agent handoff refused']]) && !(await guest<boolean>('panel', `return !!d.querySelector('[data-testid="delegation-pending"]')`)), refused);
  const refusedFact = await guest<any>('panel', `const li=d.querySelector('${ART} li[data-testid="item-task-a"]');if(!li.querySelector('details').open)li.querySelector('summary').click();const dd=d.querySelector('[data-testid="delegation-fact-task-a"]');return dd?{text:[...dd.querySelectorAll('span')].map(s=>s.textContent),icon:!!li.querySelector('.ap-intent .ap-icon[aria-hidden="true"]')}:null`);
  check('I2:refusal-gives-reason-and-recovery', !!refusedFact && same(refusedFact.text.slice(-2), ['Not applied: the plan changed after the handoff was planned.', 'The coordinator can plan the handoff again for the current plan, or link the task to a session.']) && refusedFact.icon, refusedFact);
  await shot('panel', 'intent-conflict', ART);

  // ---------------------------------------------------------------- incomplete evidence: nothing, never a guess
  for (const m of ['unavailable', 'mismatch'] as const) {
    mode = m;
    await wait('panel', `d.querySelector('${ART}')?.dataset.delegation===${javascriptLiteral(m === 'unavailable' ? 'unknown' : 'stale')}`, `${m} shows nothing`, 15_000);
    check(`I2:${m}-shows-no-note`, (await notes('panel')).length === 0);
  }

  // ---------------------------------------------------------------- cadence: no extra polling, reads only
  mode = 'pending';
  await wait('panel', `d.querySelectorAll('${ART} [data-testid="delegation-pending"]').length===2`, 'pending again', 15_000);
  const idle = (await requests()).length, msgs = await evaluate<number>('qa.messages.length');
  await new Promise((r) => setTimeout(r, 7_000));
  const window7 = (await requests()).slice(idle);
  const lists = window7.filter((q) => q.frame === 'panel' && q.path === '/v1/plans');
  check('I2:cadence-reuses-list-poll', lists.length >= 1 && lists.length <= 3 && lists.every((q) => q.intent === '1') && window7.filter((q) => q.path === '/v1/plan').length === 0, window7.map((q) => `${q.frame} ${q.path} ${q.intent}`));
  const sent = await evaluate<string[]>(`qa.messages.slice(${msgs}).map(m=>m.type)`);
  check('I2:no-writes-session-switch-or-surface-open', (await requests()).every((q) => q.method === 'GET') && !sent.includes('open-session') && !sent.includes('open-surface'), sent);

  // ---------------------------------------------------------------- board (desktop)
  await show(['page'], 1200);
  await wait('page', `d.querySelector('[data-testid="plan-row-plan-alpha"]')`, 'board list');
  if (!(await guest<boolean>('page', `return !!d.querySelector('[data-testid="plan-detail"] ${ART}')`))) await click('page', '[data-testid="plan-row-plan-alpha"]');
  await wait('page', `d.querySelectorAll('[data-testid="plan-detail"] ${ART} [data-testid="delegation-pending"]').length===2`, 'board notes');
  check('I2:board-same-notes', same((await notes('page')).map((n) => n.task), ['task-a', 'task-b']));
  await shot('page', 'board', '[data-testid="plan-detail"]');

  // ---------------------------------------------------------------- phone width, Russian, dark, touch
  await evaluate(`qa.lang('ru');qa.theme('dark');qa.phone(true);true`);
  await c.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await c.send('Emulation.setEmitTouchEventsForMouse', { enabled: true, configuration: 'mobile' });
  await show(['panel'], 390);
  await wait('panel', `d.querySelector('${ART} [data-testid="delegation-pending"]')?.textContent==='Следующий субагент возьмёт эту задачу'`, 'Russian note');
  const ru = await notes('panel');
  check('I2:phone-russian-note', ru.length === 2 && ru.every((n) => n.text === 'Следующий субагент возьмёт эту задачу'), ru);
  const wrap = await guest<any>('panel', `const n=d.querySelector('${ART} li[data-testid="item-task-b"] .ap-intent'),t=n.closest('summary').querySelector('.ap-trow-title'),a=n.getBoundingClientRect(),b=t.getBoundingClientRect();return {below:a.top>=b.bottom-1,left:Math.round(a.left),width:Math.round(a.width)}`);
  check('I2:phone-note-on-its-own-line', wrap.below, wrap);
  const overflow = await noOverflow('panel');
  check('I2:phone-no-horizontal-overflow', overflow.ok, overflow);
  const li = `${ART} li[data-testid="item-task-b"]`;
  if (await guest<boolean>('panel', `return d.querySelector('${li} details').open`)) await tap('panel', `${li} summary`);
  await tap('panel', `${li} summary`);
  await wait('panel', `d.querySelector('[data-testid="delegation-fact-task-b"]')`, 'tap opens the facts');
  const ruFact = await guest<any>('panel', `const dd=d.querySelector('[data-testid="delegation-fact-task-b"]'),s=d.querySelector('${li} summary');return {term:dd.previousElementSibling.textContent,text:dd.textContent,h:Math.round(s.getBoundingClientRect().height),coarse:w.matchMedia('(pointer: coarse)').matches}`);
  check('I2:phone-russian-fact', ruFact.term === 'Передача субагенту' && ruFact.text === 'Ждёт следующего субагента, которого запустит координатор. Работа не начата, субагент пока не назначен.', ruFact);
  check('I2:phone-row-target-44px', !ruFact.coarse || ruFact.h >= 44, ruFact);
  await shot('panel', 'panel-phone-ru-dark', ART);
  mode = 'refused';
  await wait('panel', `d.querySelector('${ART} [data-testid="delegation-refused"]')`, 'Russian refusal', 15_000);
  const ruRefused = await guest<string>('panel', `return d.querySelector('${ART} [data-testid="delegation-refused"]').textContent`);
  check('I2:phone-russian-refusal', ruRefused === 'Передача субагенту отклонена', ruRefused);
  await shot('panel', 'intent-conflict-phone-ru-dark', ART);
  await c.send('Emulation.setEmitTouchEventsForMouse', { enabled: false });
  await c.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await evaluate(`qa.lang('en');qa.theme('light');qa.phone(false);true`);

  // ---------------------------------------------------------------- older service
  mode = 'unsupported';
  await show(['panel'], 400);
  await wait('panel', `d.querySelector('${ART}')?.dataset.delegation==='absent'`, 'older service: no overlay', 15_000);
  await new Promise((r) => setTimeout(r, 3_500));
  const old = (await requests()).filter((q) => q.frame === 'panel').slice(-4);
  check('I2:older-service-never-sent-extension-no-note', (await notes('panel')).length === 0 && old.length > 0 && old.every((q) => q.intent === null), old);
  check('I2:no-console-errors', c.errors.length === 0, c.errors);
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
} finally {
  try { requestLog = page ? await page.send('Runtime.evaluate', { expression: 'JSON.stringify(qa.requests.map(({frame,method,path,intent,cursor,plan})=>({frame,method,path,intent,cursor:!!cursor,plan})))', returnByValue: true }).then((r: any) => JSON.parse(r.result.value)) : []; } catch { requestLog = []; }
  page?.close();
  try { process.kill(-chrome.pid!, 'SIGTERM'); } catch {}
  await new Promise((r) => setTimeout(r, 300));
  server.close(); server.closeAllConnections();
  assets.dispose();
  rmSync(profile, { recursive: true, force: true });
  writeFileSync(join(artifacts, 'results.json'), JSON.stringify({ browser: browserVersion, guests: assets.source ? 'source-built (disposable)' : 'tracked bundles', service: 'synthetic contract fixture (not the service lane projection)', device: 'simulated ready.device and CDP touch emulation; not physical certification', failure, results, shots }, null, 2));
  writeFileSync(join(artifacts, 'requests.json'), JSON.stringify(requestLog.slice(-400), null, 1));
  console.log(JSON.stringify({ pass: !failure && results.every((r) => r.pass), checks: results.length, failure, shots: shots.length }));
  if (failure || !results.every((r) => r.pass)) process.exitCode = 1;
}
