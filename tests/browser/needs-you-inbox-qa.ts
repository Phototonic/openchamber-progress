// Needs you inbox QA in isolated headless Chromium with real CDP pointer/keyboard input.
// A synthetic SDK shell loads the three guests (source-built with --source, else the tracked bundles)
// and relays their service requests to a SYNTHETIC in-process service shaped by the frozen inbox
// contract (shared/needs-you.ts): health capability, first window on the first list page, explicit
// GET /v1/needs-you continuation, plan detail with reported blockers. It is not the real service
// projection by default. --real-service instead routes guest requests through the actual HTTP
// service and a disposable synthetic SQLite store (only unsupported capability is stripped).
// Neither mode is native-host or physical-phone proof: synthetic device hints and emulated touch only.
// Usage: node --experimental-strip-types tests/browser/needs-you-inbox-qa.ts [--source] [--real-service] [--chromium <path>] --artifacts <dir>
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
import { PANEL_SURFACE_ID } from '../../ui/shared/config.ts';
import { inboxIntegration } from '../fixtures/inbox-integration.ts';

const arg = (name: string) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const artifacts = arg('--artifacts');
if (!artifacts) throw new Error('usage: needs-you-inbox-qa.ts [--source] [--chromium <path>] --artifacts <dir>');
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
type Mode = 'complete' | 'partial' | 'empty' | 'unsupported';
let mode: Mode = 'complete';
const minutes = (n: number) => new Date(Date.now() - n * 60_000).toISOString();
const annotation = (revision: number, category: string | undefined, reason?: string, nextAction?: string) => ({
  ...(category ? { category } : {}), ...(reason ? { reason } : {}), ...(nextAction ? { nextAction } : {}),
  reportedRevision: revision, validAtRevision: revision, reportedAt: minutes(90), reporterSessionId: S.M, attributedSessionId: S.M, mode: 'direct',
});
type Blocked = { id: string; title: string; category?: string; reason?: string; next?: string; absent?: boolean; since?: [number, 'exact' | 'lower-bound'] };
type Fixture = { id: string; title: string; session: string; revision: number; blocked: Blocked[]; other: Item[] };
const PLANS: Fixture[] = [
  { id: 'plan-alpha', title: 'Export pipeline', session: S.M, revision: 4, other: [{ id: 'task-c', title: 'Write the exporter', kind: 'task', status: 'working' }, { id: 'task-x', title: 'Draft the schema', kind: 'task', status: 'done' }],
    blocked: [
      { id: 'task-a', title: 'Choose the export format', category: 'decision', reason: 'Two formats meet the brief; pick one before work continues.', next: 'Pick CSV or JSON', since: [130, 'exact'] },
      { id: 'task-b', title: 'Review the migration notes', category: 'review', next: 'Read the notes and approve or request changes', since: [35, 'lower-bound'] },
    ] },
  { id: 'plan-beta', title: 'Rollout checklist', session: S.U, revision: 2, other: [{ id: 'task-y', title: 'Prepare the rollout', kind: 'task', status: 'pending' }],
    blocked: [
      { id: 'task-d', title: 'Approve the rollout window', category: 'review', reason: 'The window overlaps a freeze.' },
      { id: 'task-e', title: 'Wait for the API key rotation', category: 'dependency', reason: 'Another team rotates keys first.', since: [600, 'exact'] },
      { id: 'task-f', title: 'Resume indexing', absent: true },
    ] },
  { id: 'plan-gamma', title: 'Подготовка выпуска с очень длинным названием плана для проверки переноса строк', session: S.U, revision: 1, other: [],
    blocked: [
      { id: 'task-g', title: 'Дождаться ответа внешнего подрядчика по договору поставки', category: 'external', reason: 'Ответ ожидается от поставщика.' },
      { id: 'task-h', title: 'Clarify the escalation path', category: 'unclassified' },
    ] },
];
const real = process.argv.includes('--real-service') ? await inboxIntegration(SRC, PLANS.map(p => ({
  id: p.id, title: p.title, session: p.session, items: [...p.other, ...p.blocked.map(b => ({
    id: b.id, title: b.title, kind: 'task' as const, status: 'blocked' as const,
    ...(b.absent ? {} : { blocker: { ...(b.category && b.category !== 'unclassified' ? { category: b.category as 'decision' } : {}), ...(b.reason ? { reason: b.reason } : {}), ...(b.next ? { nextAction: b.next } : {}) } }),
  }))],
}))) : null;
let conflictNext = false;
const realReplies: { path: string; status: number; rows?: number; counts?: unknown; complete?: boolean }[] = [];
const personFacing = (b: Blocked) => b.category === 'decision' || b.category === 'review';
const visibleBlocked = (p: Fixture) => p.blocked.filter((b) => mode !== 'empty' || !personFacing(b));
function items(p: Fixture): Item[] {
  const blocked = p.blocked.map((b): Item => visibleBlocked(p).includes(b)
    ? { id: b.id, title: b.title, kind: 'task', status: 'blocked', ...(b.absent ? {} : { blocker: annotation(p.revision, b.category, b.reason, b.next) as never }) }
    : { id: b.id, title: b.title, kind: 'task', status: 'done' });
  return [...p.other, ...blocked];
}
const planSummary = (p: Fixture): PlanSummary => summary(p.id, items(p), { title: p.title, sessionId: p.session, revision: p.revision, structuralRevision: 1, cleanup: { state: 'visible', revision: 0 } } as Partial<PlanSummary>);
function inboxRows(timing: boolean) {
  const readAt = new Date().toISOString();
  const rows = PLANS.flatMap((p) => visibleBlocked(p).map((b) => ({
    source: SRC, plan: p.id, revision: p.revision, structuralRevision: 1, cleanup: { state: 'visible', revision: 0 },
    planTitle: p.title, coordinatorSessionId: p.session, task: { id: b.id, title: b.title, kind: 'task', status: 'blocked' }, ancestors: [], omittedAncestors: 0,
    group: personFacing(b) ? 'needs-you' : 'also-blocked',
    blocker: b.absent ? { state: 'absent' } : { state: 'reported', annotation: annotation(p.revision, b.category, b.reason, b.next) },
    ...(timing && b.since ? { timing: { readAt, since: minutes(b.since[0]), kind: b.since[1] } } : {}),
  })));
  return { rows, readAt };
}
function window(timing: boolean, cursor: string | null) {
  const { rows, readAt } = inboxRows(timing);
  const split = mode === 'partial' ? 2 : rows.length;
  const page = cursor === 'qa-c1' ? rows.slice(split) : rows.slice(0, split);
  const through = cursor === 'qa-c1' ? rows : rows.slice(0, split);
  const next = mode === 'partial' && cursor === null ? 'qa-c1' : null;
  return {
    protocolVersion: 2, schemaVersion: 2, needsYouInbox: 1, storeId: 'store-1', sourceBinding: { sourceId: SRC, verified: true }, readAt, captureEnabled: true, rows: page,
    counts: { needsYou: through.filter((r) => r.group === 'needs-you').length, alsoBlocked: through.filter((r) => r.group === 'also-blocked').length },
    nextCursor: next, coverage: { kind: 'observed-current', complete: next === null, exhausted: next === null, gapped: false, skippedRecords: 0, reasons: [] },
    work: { planSlots: PLANS.length, inspectedItems: rows.length, inputBytes: 1, outputBytes: 1 },
  };
}
function serve(q: GuestRequest): { status: number; body: unknown } {
  const query = q.query ?? {};
  if (q.method !== 'GET') return { status: 405, body: { error: 'method' } };
  // Search is advertised so the board draws its search field (searches only run on explicit submit).
  if (q.path === '/health') return { status: 200, body: { ...HEALTH, planTaskSearch: 1, ...(mode === 'unsupported' ? {} : { needsYouInbox: 1 }) } };
  if (q.path === '/v1/plans') {
    const data = PLANS.filter((p) => !query.session || p.session === query.session).map(planSummary);
    return { status: 200, body: { ...plansPage(data), ...(mode !== 'unsupported' && query.needsYou === '1' && !query.cursor ? { needsYou: window(query.needsYouTiming === '1', null) } : {}) } };
  }
  if (q.path === '/v1/needs-you') {
    if (mode === 'unsupported') return { status: 404, body: { error: 'not-found' } };
    if (query.storeId !== 'store-1' || query.source !== SRC) return { status: 409, body: { error: 'conflict' } };
    return { status: 200, body: window(query.timing === '1', query.cursor ?? null) };
  }
  if (q.path === '/v1/plan') {
    const p = PLANS.find((x) => x.id === query.plan && query.source === SRC);
    if (!p) return { status: 404, body: { error: 'not-found' } };
    const readAt = new Date().toISOString();
    const timing = Object.fromEntries(visibleBlocked(p).filter((b) => b.since).map((b) => [b.id, { since: minutes(b.since![0]), kind: b.since![1] }]));
    return { status: 200, body: { ...planPage(planSummary(p), items(p), [], undefined, []), blockedTiming: { readAt, items: timing } } };
  }
  if (q.path === '/v1/history') return { status: 200, body: { ...envelope(), data: [], nextCursor: null } };
  return { status: 404, body: { error: 'not-found' } };
}

// ------------------------------------------------------------------ synthetic SDK shell
const LIGHT = { background: '#fafafa', elevated: '#ffffff', foreground: '#202124', muted: '#64676e', subtle: '#74777e', border: '#dedfe3', hover: '#f0f1f3', selection: '#e7eefb', focus: '#376bc4', primary: '#316ac3', mutedSurface: '#f3f4f6', elevatedForeground: '#202124', active: '#e7e9ed', selectionForeground: '#173964', primaryForeground: '#ffffff', primaryText: '#24579e', successText: '#237044', warningText: '#855900', errorText: '#ad3030', infoText: '#24579e', success: '#27824d', warning: '#a66c00', error: '#c23d3d', info: '#316ac3', font: 'system-ui, sans-serif', mono: 'monospace', radius: '6px' };
const DARK = { ...LIGHT, background: '#191b20', elevated: '#24272e', foreground: '#e6e8ee', muted: '#a4a9b4', subtle: '#9298a4', border: '#414650', hover: '#343944', selection: '#293d60', focus: '#90b8ff', primary: '#83aff7', mutedSurface: '#24272e', elevatedForeground: '#e6e8ee', active: '#3b4350', selectionForeground: '#e0ebff', primaryText: '#a6c7ff', successText: '#86dca3', warningText: '#e8c372', errorText: '#ff9e9e', infoText: '#a6c7ff', success: '#6fc58c', warning: '#d9b367', error: '#ee8989', info: '#83aff7' };
const FRAMES = ['page', 'panel', 'status'] as const;
const PROJECT = { id: 'alpha', name: 'Alpha', directory: '/fixture/Alpha' };
const SESSIONS = [S.M, S.U].map((id, i) => ({ id, title: i ? 'Rollout session' : 'Export session', parentId: null, projectId: PROJECT.id, directory: PROJECT.directory, createdAt: 1, updatedAt: 2, archivedAt: null, worktree: null, activity: 'idle', outcome: null, items: [] }));
const shellScript = `
const light=${JSON.stringify(LIGHT)},dark=${JSON.stringify(DARK)};
const frames=${JSON.stringify(FRAMES)},frame=f=>document.querySelector('iframe[data-frame="'+f+'"]');
const send=(f,m)=>frame(f)?.contentWindow?.postMessage({channel:'openchamber.sdk',v:1,...m},'*');
const project=${JSON.stringify(PROJECT)},sessions=${JSON.stringify(SESSIONS)};
window.frame=frame;
window.qa={session:null,locale:'en',mode:'light',device:null,requests:[],messages:[],storage:new Map()};
const theme=()=>({mode:qa.mode,tokens:qa.mode==='dark'?dark:light});
const ready=f=>send(f,{type:'ready',payload:{theme:theme(),locale:qa.locale,directory:project.directory,session:qa.session?{id:qa.session}:null,surface:f,connection:{connected:true,account:'account-example'},settings:{},item:null,...(qa.device?{device:qa.device}:{})}});
qa.ready=()=>frames.forEach(ready);
qa.context=id=>{qa.session=id;for(const f of frames){ready(f);send(f,{type:'directory',payload:{directory:project.directory}});send(f,{type:'session',payload:{session:id?{id}:null}})}};
qa.show=(list,width)=>{for(const n of document.querySelectorAll('section[data-frame]')){const on=list.includes(n.dataset.frame);n.style.display=on?'block':'none';if(on)n.style.width=width+'px'}};
qa.theme=mode=>{qa.mode=mode;const t=theme().tokens;document.body.style.background=t.background;document.body.style.color=t.foreground;frames.forEach(ready)};
qa.lang=l=>{qa.locale=l;frames.forEach(ready)};
qa.phone=on=>{qa.device=on?{formFactor:'phone',pointer:'coarse',insets:{top:20,right:0,bottom:16,left:0},keyboard:0}:null;frames.forEach(ready)};
const snapshot=q=>q.kind==='projects'?{kind:'projects',state:'ready',projects:[project]}:q.kind==='worktrees'?{kind:'worktrees',projectId:q.projectId,state:'ready',worktrees:[]}:{kind:'sessions',projectId:q.projectId,state:'ready',coverage:[],sessions:q.projectId===project.id?sessions:[]};
addEventListener('message',async e=>{
 const el=[...document.querySelectorAll('iframe')].find(x=>x.contentWindow===e.source),m=e.data;if(!el||m.channel!=='openchamber.sdk')return;const f=el.dataset.frame;
 const result=payload=>send(f,{type:'result',id:m.id,ok:true,payload});
 qa.messages.push({frame:f,type:m.type,payload:m.type==='open-surface'||m.type==='open-session'?m.payload:undefined,at:performance.now()});
 if(m.type==='hello')ready(f);
 else if(m.type==='workspace-subscribe'){result();send(f,{type:'workspace',payload:{subscriptionId:m.payload.subscriptionId,snapshot:snapshot(m.payload.query)}})}
 else if(m.type==='storage'){const q=m.payload,k=f+':'+q.key;if(q.op==='set')qa.storage.set(k,q.value);if(q.op==='delete')qa.storage.delete(k);result({storage:true,op:q.op,found:qa.storage.has(k),value:qa.storage.get(k),...(q.op==='keys'?{keys:[]}:{})})}
 else if(m.type==='service-request'){
  const q=m.payload;qa.requests.push({frame:f,method:q.method,path:q.path,needsYou:q.query?.needsYou??null,timing:q.query?.needsYouTiming??q.query?.timing??null,cursor:q.query?.cursor??null,plan:q.query?.plan??null,session:q.query?.session??null,at:performance.now()});
  const r=await fetch('/service',{method:'POST',body:JSON.stringify(q)});result(await r.json());
 }else if(m.id)result();
});
`;
const shell = `<!doctype html><html><head><meta charset="utf-8"><title>Needs you inbox QA</title><style>html,body{margin:0;background:#fafafa;color:#202124;font:14px system-ui}main{display:flex;flex-wrap:wrap;align-items:flex-start}section{margin:12px;display:none}h1{font-size:13px;margin:0 0 8px}iframe{display:block;width:100%;height:1500px;border:0}section[data-frame=status] iframe{height:320px}</style></head><body><script>${shellScript}</script><main>${FRAMES.map((f) => `<section data-frame="${f}" data-surface="${f}"><h1>Agent progress · ${f}</h1><iframe data-frame="${f}" title="${f}" src="/ui/${f}/index.html"></iframe></section>`).join('')}</main></body></html>`;

const assets = createGuestAssets({ source: process.argv.includes('--source') });
const server: Server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  try {
    if (url.pathname === '/') { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(shell); return; }
    const asset = assets.read(url.pathname);
    if (asset) { res.setHeader('content-type', url.pathname.endsWith('.js') ? 'text/javascript' : 'text/html'); res.end(asset); return; }
    if (url.pathname === '/service' && req.method === 'POST') {
      let body = ''; for await (const part of req) body += part;
      const q = JSON.parse(body);
      if (real && conflictNext && q.path === '/v1/needs-you') { conflictNext = false; real.conflict(); }
      // Unsupported mode is an explicit older-service seam; ordinary reads use the real service.
      if (real && mode === 'unsupported' && q.path !== '/health') { delete q.query?.needsYou; delete q.query?.needsYouTiming; }
      const r = real ? await real.request(q) : serve(q);
      if (real && mode === 'unsupported' && q.path === '/health') delete (r.body as Record<string, unknown>).needsYouInbox;
      if (real) { const b = r.body as any, w = q.path === '/v1/needs-you' ? b : b.needsYou; realReplies.push({ path: q.path, status: r.status, ...(w?.rows ? { rows: w.rows.length, counts: w.counts, complete: w.coverage.complete } : {}) }); }
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
const profile = mkdtempSync('/tmp/opencode/needs-you-inbox-qa-');
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
  const key = async (k: string, shift = false) => {
    const text = k === 'Enter' ? { text: '\r', unmodifiedText: '\r' } : k === ' ' ? { text: ' ', unmodifiedText: ' ' } : {};
    const modifiers = shift ? 8 : 0;
    await c.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: k === ' ' ? 'Space' : k, windowsVirtualKeyCode: codes[k] ?? 0, modifiers, ...text });
    await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k === ' ' ? 'Space' : k, windowsVirtualKeyCode: codes[k] ?? 0, modifiers });
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
  const tabTo = async (f: string, selector: string, max = 60) => {
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
  const INBOX = '[data-testid="needs-you-inbox"]';
  const rowIds = (f: string, scope = INBOX) => guest<string[]>(f, `return [...d.querySelectorAll('${scope} [data-testid="needs-you-row"]')].filter(n=>!n.closest('[data-testid="also-blocked"]')||${javascriptLiteral(scope)}.includes('also')).map(n=>n.dataset.task)`);

  await waitTop(`window.qa&&frame('page').contentDocument?.querySelector('[data-testid="progress-root"]')`, 'shell ready', 30_000);
  await evaluate(`qa.theme('light');true`);
  await evaluate(`qa.context(${javascriptLiteral(S.M)});true`);

  // ---------------------------------------------------------------- Work Status line (Q1)
  await show(['status'], 320);
  await wait('status', `d.querySelector('[data-testid="needs-you-line"]')&&d.querySelector('[data-testid="state-chip"][data-state="blocked"]')`, 'status inbox line and complete plan chips');
  const status = await guest<any>('status', `const l=d.querySelector('[data-testid="needs-you-line"]'),b=l.querySelector('button');return {text:l.querySelector('[data-testid="needs-you-count"]').textContent,count:l.dataset.count,complete:l.dataset.complete,aria:b.getAttribute('aria-label'),first:d.querySelector('[data-testid="progress-root"]').firstElementChild===l,chips:[...d.querySelectorAll('[data-testid="state-chip"]')].map(n=>n.textContent)}`);
  check('I1:status-line-count', status.text === '3 tasks need you' && status.count === '3' && status.complete === 'true' && status.first, status);
  check('I1:status-blocked-chip-not-needs-you', !status.chips.some((t: string) => /needs you/i.test(t)) && status.chips.some((t: string) => /blocked/.test(t)), status.chips);
  check('I1:status-line-accessible-name', status.aria === '3 tasks need you across all current plans. Open progress', status.aria);
  await shot('status', 'status', '[data-testid="progress-root"]');
  const before = await evaluate<number>('qa.messages.length');
  await tabTo('status', '.ap-inbox-line-open');
  await key('Enter');
  await waitTop(`qa.messages.slice(${before}).some(m=>m.type==='open-surface')`, 'open-surface from Work Status');
  const opened = await evaluate<any[]>(`qa.messages.slice(${before}).filter(m=>m.type==='open-surface'||m.type==='open-session')`);
  check('I1:status-opens-panel-without-payload', opened.length === 1 && same(opened[0].payload, { surfaceId: PANEL_SURFACE_ID }), opened);

  // ---------------------------------------------------------------- rail inbox (desktop width)
  await show(['panel'], 400);
  await wait('panel', `d.querySelector('${INBOX} [data-testid="needs-you-row"]')&&d.querySelector('article[data-testid="plan-plan-alpha"] .ap-tasks[data-complete]')`, 'rail inbox and plan');
  const rail = await guest<any>('panel', `const box=d.querySelector('${INBOX}'),art=d.querySelector('article[data-testid="plan-plan-alpha"]'),count=box.querySelector('[data-testid="needs-you-count"]');return {before:!!(box.compareDocumentPosition(art)&w.Node.DOCUMENT_POSITION_FOLLOWING),count:count.dataset.count,exact:count.dataset.exact,heading:box.querySelector('h2').textContent,scope:box.querySelector('.ap-inbox-scope').textContent,also:box.querySelector('[data-testid="also-blocked"]')?.open,alsoCount:box.querySelector('[data-testid="also-blocked"]')?.dataset.count,planGroup:art.querySelector('[data-testid="progress-group-needs-you"] .ap-pgroup-h')?.textContent??null}`);
  check('I1:rail-inbox-before-session-plan', rail.before, rail);
  check('I1:rail-count-exact-and-scope-labelled', rail.count === '3' && rail.exact === 'true' && rail.heading.startsWith('Needs you') && /all current plans/.test(rail.scope), rail);
  const needs = await rowIds('panel');
  check('I1:needs-you-rows-source-wide-decision-review-only', same(needs, ['task-a', 'task-b', 'task-d']), needs);
  check('I1:also-blocked-separate-collapsed', rail.also === false && rail.alsoCount === '4', rail);
  check('I1:per-plan-group-says-blocked', rail.planGroup === null || !/needs you/i.test(rail.planGroup), rail.planGroup);
  const facts = await guest<any>('panel', `const row=id=>d.querySelector('${INBOX} [data-testid="needs-you-row"][data-task="'+id+'"]');const f=id=>{const r=row(id);return {reason:r.querySelector('[data-testid="needs-you-reason"]')?.textContent,next:r.querySelector('[data-testid="needs-you-next"]')?.textContent,unknown:[...r.querySelectorAll('[data-unknown]')].map(n=>n.dataset.testid),cat:r.querySelector('[data-testid="needs-you-category"]').dataset.category,wait:r.querySelector('[data-testid="needs-you-wait"]').dataset.timing,waitText:r.querySelector('[data-testid="needs-you-wait"]').textContent,plan:r.querySelector('.ap-inbox-plan').textContent,name:r.querySelector('.ap-inbox-open').getAttribute('aria-label')}};return {a:f('task-a'),b:f('task-b'),d:f('task-d')}`);
  check('I1:row-reported-reason-next-literal', facts.a.reason === 'Two formats meet the brief; pick one before work continues.' && facts.a.next === 'Pick CSV or JSON' && facts.a.cat === 'decision', facts.a);
  check('I1:row-unknowns-stay-unknown', facts.b.reason === 'Unknown' && same(facts.b.unknown, ['needs-you-reason']) && facts.d.next === 'Unknown', facts);
  check('I1:row-waiting-exact-lower-unknown', facts.a.wait === 'exact' && /^Waiting 2 h/.test(facts.a.waitText) && facts.b.wait === 'lower-bound' && /^Waiting at least/.test(facts.b.waitText) && facts.d.wait === 'unknown' && facts.d.waitText === 'Waiting time unknown', facts);
  check('I1:row-names-plan-and-task', facts.d.name === 'Open Approve the rollout window in Rollout checklist' && facts.d.plan === 'Plan: Rollout checklist', facts.d);
  await shot('panel', 'inbox', INBOX);
  await shot('panel', 'panel', '[data-testid="progress-root"]');

  // Keyboard: reach a row from another session's plan and open it (source-wide, read-only).
  const mark = (await requests()).length, msgMark = await evaluate<number>('qa.messages.length');
  await tabTo('panel', `${INBOX} [data-testid="needs-you-row"][data-task="task-d"] .ap-inbox-open`);
  await key('Enter');
  await wait('panel', `d.querySelector('[data-testid="needs-you-reading"]')`, 'inbox reading');
  await wait('panel', `d.activeElement?.dataset.testid==='item-task-d'`, 'revealed task row focused');
  const reading = await guest<any>('panel', `const r=d.querySelector('[data-testid="needs-you-reading"]'),art=d.querySelector('article[data-testid="plan-plan-beta"][data-reading]');return {label:r.querySelector('.ap-inbox-reading-label').textContent,task:r.querySelector('.ap-inbox-reading-task').textContent,check:r.dataset.check,notice:art?.querySelector('[data-testid="focus-notice"]')?.textContent,nav:d.activeElement.hasAttribute('data-nav-target'),inbox:!!d.querySelector('${INBOX}'),scopeLine:!!d.querySelector('[data-testid="session-action-scope"]')}`);
  check('I1:reading-labelled-and-revealed', reading.label === 'Opened from Needs you' && reading.task === 'Approve the rollout window' && reading.check === 'ready' && reading.notice === 'Needs you: Approve the rollout window' && reading.nav && !reading.inbox, reading);
  const after = (await requests()).slice(mark);
  const msgs = await evaluate<any[]>(`qa.messages.slice(${msgMark}).map(m=>m.type)`);
  check('I1:reading-is-read-only', after.every((q) => q.method === 'GET') && after.some((q) => q.path === '/v1/plan' && q.plan === 'plan-beta') && !msgs.includes('open-session') && !msgs.includes('open-surface'), { paths: after.map((q) => `${q.method} ${q.path}`), msgs });
  await shot('panel', 'reading', '[data-testid="progress-root"]');
  await tabTo('panel', '[data-testid="needs-you-back"]');
  await key('Enter');
  await wait('panel', `d.activeElement?.closest('[data-testid="needs-you-row"]')?.dataset.task==='task-d'`, 'focus back on the opened row');
  check('I1:back-returns-focus-to-row', await guest<boolean>('panel', `return !d.querySelector('[data-testid="needs-you-reading"]')&&!!d.querySelector('article[data-testid="plan-plan-alpha"]')`));

  // Also blocked: keyboard disclosure, honest category labels.
  await tabTo('panel', '[data-testid="also-blocked"] > summary');
  await key('Enter');
  await wait('panel', `d.querySelector('[data-testid="also-blocked"]').open`, 'also blocked open');
  const also = await guest<any>('panel', `return [...d.querySelectorAll('[data-testid="also-blocked"] [data-testid="needs-you-row"]')].map(n=>n.dataset.task+':'+n.querySelector('[data-testid="needs-you-category"]').textContent)`);
  check('I1:also-blocked-honest-labels', same(also, ['task-e:Wait category: Dependency', 'task-f:Wait category: No details reported', 'task-g:Wait category: External', 'task-h:Wait category: Category unknown']), also);
  await shot('panel', 'also-blocked', INBOX);

  // ---------------------------------------------------------------- cadence: no extra polling
  const idle = (await requests()).length;
  await new Promise((r) => setTimeout(r, 7_000));
  const window7 = (await requests()).slice(idle);
  const per = (f: string, p: string) => window7.filter((q) => q.frame === f && q.path === p).length;
  check('I1:cadence-reuses-list-poll', ['panel', 'status', 'page'].every((f) => per(f, '/v1/plans') >= 1 && per(f, '/v1/plans') <= 3) && window7.every((q) => q.path !== '/v1/needs-you') && window7.filter((q) => q.path === '/v1/plan').length === 0, window7.map((q) => `${q.frame} ${q.path}`));
  check('I1:summary-only-on-first-list-page', window7.filter((q) => q.path === '/v1/plans').every((q) => q.needsYou === '1' && !q.cursor) && window7.filter((q) => q.frame === 'status' && q.path === '/v1/plans').every((q) => q.timing === null) && window7.filter((q) => q.frame !== 'status' && q.path === '/v1/plans').every((q) => q.timing === '1'), window7.filter((q) => q.path === '/v1/plans'));

  // ---------------------------------------------------------------- phone width, Russian, dark, touch
  await evaluate(`qa.lang('ru');qa.theme('dark');qa.phone(true);true`);
  await c.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await c.send('Emulation.setEmitTouchEventsForMouse', { enabled: true, configuration: 'mobile' });
  await show(['panel'], 390);
  await wait('panel', `d.querySelector('${INBOX} h2')?.textContent.startsWith('Нужно ваше участие')`, 'Russian inbox');
  // The synthetic ready.device reaches the guest's own host-ready path (applyDeviceHooks), which writes
  // the root hooks the phone layout reads; coarse targets then apply whatever the media query says.
  const rootHooks = await guest<{ pointer: string | null; formFactor: string | null; bottom: string }>('panel', `const h=d.documentElement;return {pointer:h.getAttribute('data-device-pointer'),formFactor:h.getAttribute('data-device-form-factor'),bottom:h.style.getPropertyValue('--ap-safe-bottom')}`);
  check('phone:device-hooks-host-ready', rootHooks.pointer === 'coarse' && rootHooks.formFactor === 'phone' && rootHooks.bottom === '16px', rootHooks);
  const coarse = rootHooks.pointer === 'coarse' || await guest<boolean>('panel', `return w.matchMedia('(pointer: coarse)').matches`);
  const phone = await guest<any>('panel', `const hs=[...d.querySelectorAll('${INBOX} .ap-inbox-open, ${INBOX} .ap-inbox-also>summary')].map(n=>Math.round(n.getBoundingClientRect().height));return {min:Math.min(...hs),scope:d.querySelector('.ap-inbox-scope').textContent,also:d.querySelector('[data-testid="also-blocked"] summary').textContent,wait:d.querySelector('[data-testid="needs-you-row"][data-task="task-b"] [data-testid="needs-you-wait"]').textContent}`);
  check('I1:phone-russian-copy', /во всех текущих планах/.test(phone.scope) && phone.also === 'Также заблокировано · 4' && /^Ожидает не менее/.test(phone.wait), phone);
  check('I1:phone-coarse-targets-44px', !coarse || phone.min >= 44, { coarse, min: phone.min });
  const overflow = await noOverflow('panel');
  check('I1:phone-no-horizontal-overflow', overflow.ok, overflow);
  await shot('panel', 'inbox-phone-ru-dark', INBOX);
  await tap('panel', `${INBOX} [data-testid="needs-you-row"][data-task="task-a"] .ap-inbox-open`);
  await wait('panel', `d.activeElement?.dataset.testid==='item-task-a'`, 'tap opens and reveals');
  const ruReading = await guest<any>('panel', `return {label:d.querySelector('.ap-inbox-reading-label').textContent,back:d.querySelector('[data-testid="needs-you-back"]').textContent,backH:Math.round(d.querySelector('[data-testid="needs-you-back"]').getBoundingClientRect().height)}`);
  check('I1:phone-reading-russian-and-reachable', ruReading.label === 'Открыто из раздела «Нужно ваше участие»' && /Назад к прогрессу сессии/.test(ruReading.back) && (!coarse || ruReading.backH >= 44), ruReading);
  const overflow2 = await noOverflow('panel');
  check('I1:phone-reading-no-overflow', overflow2.ok, overflow2);
  await shot('panel', 'reading-phone-ru-dark', '[data-testid="progress-root"]');
  await tap('panel', '[data-testid="needs-you-back"]');
  await wait('panel', `!d.querySelector('[data-testid="needs-you-reading"]')`, 'back by tap');
  // Board at phone width: the shortened Russian search hint fits; the full label stays.
  await show(['page'], 390);
  await wait('page', `d.querySelector('${INBOX}')&&d.querySelector('#ap-search-q')`, 'board at phone width');
  const hint = await guest<any>('page', `const i=d.querySelector('#ap-search-q'),s=getComputedStyle(i),ctx=d.createElement('canvas').getContext('2d');ctx.font=s.font;const room=i.clientWidth-parseFloat(s.paddingLeft)-parseFloat(s.paddingRight);return {placeholder:i.placeholder,label:i.getAttribute('aria-label')??d.querySelector('label[for="ap-search-q"]')?.textContent,fits:ctx.measureText(i.placeholder).width<=room,room:Math.round(room),text:Math.round(ctx.measureText(i.placeholder).width)}`);
  check('I1:board-russian-search-hint-fits', hint.placeholder === 'Поиск' && hint.label === 'Поиск по названиям и ID' && hint.fits, hint);
  const boardOverflow = await noOverflow('page');
  check('I1:board-phone-no-overflow', boardOverflow.ok, boardOverflow);
  const boardPhone = await guest<{ pointer: string | null; small: string[] }>('page', `const sel='${INBOX} :is(button,summary,a[href])';return {pointer:d.documentElement.getAttribute('data-device-pointer'),small:[...d.querySelectorAll(sel)].filter(n=>{const r=n.getBoundingClientRect();return r.width&&r.height&&(r.width<43.5||r.height<43.5)}).map(n=>(n.closest('[data-testid]')?.dataset.testid??n.tagName)+' '+Math.round(n.getBoundingClientRect().width)+'x'+Math.round(n.getBoundingClientRect().height))}`);
  check('phone:board-device-hooks-and-44px-inbox-targets', boardPhone.pointer === 'coarse' && boardPhone.small.length === 0, boardPhone);
  await shot('page', 'board-phone-ru-dark', INBOX);
  await c.send('Emulation.setEmitTouchEventsForMouse', { enabled: false });
  await c.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await evaluate(`qa.lang('en');qa.theme('light');qa.phone(false);true`);

  // ---------------------------------------------------------------- board (desktop)
  await show(['page'], 1200);
  await wait('page', `d.querySelector('${INBOX} h2')?.textContent.startsWith('Needs you')&&d.querySelector('[data-testid="plan-row-plan-alpha"]')`, 'board inbox');
  check('desktop:device-hooks-removed-without-hints', await guest<boolean>('page', `const h=d.documentElement;return !h.hasAttribute('data-device-pointer')&&!h.hasAttribute('data-device-form-factor')&&!h.style.getPropertyValue('--ap-safe-bottom')`));
  check('I1:board-inbox-at-start', await guest<boolean>('page', `const box=d.querySelector('${INBOX}'),b=d.querySelector('.ap-board');return !!b&&!!(box.compareDocumentPosition(b)&w.Node.DOCUMENT_POSITION_FOLLOWING)`));
  await shot('page', 'board', '[data-testid="progress-root"]');
  await click('page', `${INBOX} [data-testid="needs-you-row"][data-task="task-a"] .ap-inbox-open`);
  await wait('page', `d.activeElement?.dataset.testid==='item-task-a'`, 'board reveal');
  check('I1:board-reading-in-detail-pane', await guest<boolean>('page', `return !!d.querySelector('[data-testid="plan-detail"] [data-testid="needs-you-reading"]')&&!d.querySelector('[data-testid="plan-list"]')`));
  await shot('page', 'board-reading', '[data-testid="plan-detail"]');
  await click('page', '[data-testid="needs-you-back"]');
  await wait('page', `d.querySelector('[data-testid="plan-list"]')&&d.activeElement?.closest('[data-testid="needs-you-row"]')?.dataset.task==='task-a'`, 'board back with focus on row');

  // ---------------------------------------------------------------- partial coverage and continuation
  mode = 'partial';
  real?.partial();
  await show(['panel', 'status'], 400);
  await wait('status', `d.querySelector('[data-testid="needs-you-count"]')?.textContent==='At least 2 tasks need you'`, 'status partial count', 15_000);
  await wait('panel', `d.querySelector('[data-testid="needs-you-more"] button')&&d.querySelector('[data-testid="needs-you-partial"]')`, 'rail continuation offered');
  const partial = await guest<any>('panel', `const c=d.querySelector('[data-testid="needs-you-count"]');return {count:c.dataset.count,exact:c.dataset.exact,shown:c.textContent,note:d.querySelector('[data-testid="needs-you-partial"]').textContent}`);
  check('I1:partial-is-a-known-minimum', partial.count === '2' && partial.exact === 'false' && partial.shown.startsWith('2+') && /Only some plans/.test(partial.note), partial);
  await shot('panel', 'partial', INBOX);
  await c.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  const moreHeight = await guest<{ coarse: boolean; h: number }>('panel', `return {coarse:w.matchMedia('(pointer: coarse)').matches,h:Math.round(d.querySelector('[data-testid="needs-you-more"] button').getBoundingClientRect().height)}`);
  await c.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  check('I1:continuation-coarse-target-44px', !moreHeight.coarse || moreHeight.h >= 44, moreHeight);
  const more = (await requests()).length;
  if (real) {
    conflictNext = true;
    await click('panel', '[data-testid="needs-you-more"] button');
    await wait('panel', `d.querySelector('[data-testid="needs-you-restarted"]')`, 'real 409 restart');
    check('integration:409-restarts-without-splicing', realReplies.some(r => r.path === '/v1/needs-you' && r.status === 409));
    await shot('panel', 'restart', INBOX);
    // The normal list poll brings the changed first window; no automatic continuation.
    await waitTop(`qa.requests.filter(q=>q.frame==='panel'&&q.path==='/v1/plans').length>${await evaluate<number>(`qa.requests.filter(q=>q.frame==='panel'&&q.path==='/v1/plans').length`)}`, 'fresh first window after conflict');
    await wait('panel', `d.querySelector('[data-testid="needs-you-more"] button:not(:disabled)')`, 'continuation after restart');
  }
  await click('panel', '[data-testid="needs-you-more"] button');
  await wait('panel', `d.querySelector('[data-testid="needs-you-count"]')?.dataset.exact==='true'`, 'continuation completes');
  const cont = (await requests()).slice(more).filter((q) => q.path === '/v1/needs-you');
  const finalRows = await rowIds('panel');
  check('I1:continuation-explicit-pinned-and-merged', cont.length === (real ? 2 : 1) && (real ? !!cont.at(-1)?.cursor : cont[0].cursor === 'qa-c1') && cont.at(-1)?.timing === '1' && same(finalRows, ['task-a', 'task-b', 'task-d']), { cont, finalRows });
  if (real) check('integration:cumulative-counts-at-real-bound', realReplies.some(r => r.path === '/v1/needs-you' && r.complete && same(r.counts, { needsYou: 3, alsoBlocked: 53 })));

  // ---------------------------------------------------------------- complete empty first group
  mode = 'empty';
  real?.empty();
  await wait('panel', `d.querySelector('[data-testid="needs-you-empty"]')?.dataset.complete==='true'`, 'complete empty', 15_000);
  await wait('status', `d.querySelector('[data-testid="needs-you-count"]')?.textContent==='Nothing needs you'`, 'status empty');
  const empty = await guest<any>('panel', `return {text:d.querySelector('[data-testid="needs-you-empty"]').textContent,also:d.querySelector('[data-testid="also-blocked"]')?.dataset.count,count:d.querySelector('[data-testid="needs-you-count"]').dataset.count}`);
  check('I1:complete-empty-says-nothing-needs-you', empty.text === 'Nothing needs you right now.' && empty.also === '4' && empty.count === '0', empty);
  await shot('panel', 'empty', INBOX);

  // ---------------------------------------------------------------- unsupported service
  mode = 'unsupported';
  const uMark = (await requests()).length;
  await wait('panel', `d.querySelector('[data-testid="needs-you-unavailable"]')`, 'unsupported note', 15_000);
  await wait('status', `!d.querySelector('[data-testid="needs-you-line"]')`, 'status without line');
  await new Promise((r) => setTimeout(r, 3_500));
  const uReqs = (await requests()).slice(uMark).filter((q) => q.path === '/v1/plans');
  const unsupported = await guest<string>('panel', `return d.querySelector('[data-testid="needs-you-unavailable"]').textContent`);
  check('I1:unsupported-not-an-empty-inbox', unsupported === 'Needs you isn’t available with this progress service version.' && !(await guest<boolean>('panel', `return !!d.querySelector('[data-testid="needs-you-count"],[data-testid="needs-you-empty"]')`)), unsupported);
  check('I1:older-service-never-sent-extension', uReqs.length > 0 && uReqs.slice(-3).every((q) => q.needsYou === null), uReqs.slice(-3));
  await shot('panel', 'unsupported', INBOX);
  check('I1:no-console-errors', c.errors.length === 0, c.errors);
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
} finally {
  try { requestLog = page ? await page.send('Runtime.evaluate', { expression: 'JSON.stringify(qa.requests.map(({frame,method,path,needsYou,timing,cursor,plan})=>({frame,method,path,needsYou,timing,cursor:!!cursor,plan})))', returnByValue: true }).then((r: any) => JSON.parse(r.result.value)) : []; } catch { requestLog = []; }
  page?.close();
  try { process.kill(-chrome.pid!, 'SIGTERM'); } catch {}
  await new Promise((r) => setTimeout(r, 300));
  server.close(); server.closeAllConnections();
  assets.dispose();
  await real?.close();
  rmSync(profile, { recursive: true, force: true });
  writeFileSync(join(artifacts, 'results.json'), JSON.stringify({ browser: browserVersion, guests: assets.source ? 'source-built (disposable)' : 'tracked bundles', service: real ? 'actual HTTP service and synthetic SQLite store; older-capability seam only' : 'synthetic contract fixture', realReplies, device: 'synthetic ready.device applied by the guests\' own host-ready path (root hooks checked) and CDP touch emulation; not physical certification', failure, results, shots }, null, 2));
  writeFileSync(join(artifacts, 'requests.json'), JSON.stringify(requestLog.slice(-400), null, 1));
  console.log(JSON.stringify({ pass: !failure && results.every((r) => r.pass), checks: results.length, failure, shots: shots.length }));
  if (failure || !results.every((r) => r.pass)) process.exitCode = 1;
}
