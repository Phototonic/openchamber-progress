// Board-search QA host bridge: current guest bundles (page, rail, Work Status) in a synthetic SDK
// shell, relayed to REAL disposable HTTP services over SQLite seeded through production writes
// (the accepted search fixture plus a 1,200-plan library; a second small store for store-change
// races). Current TypeScript service by default; `built` spawns the generated service entry
// (build/service/main.js) for each store. The bearer stays in this process.
// Labelled QA seams only (never shipped): held/failed service replies, a stripped search
// capability, the SDK project/session snapshots, host session context, account switch, store
// switch and fixture-side writes from "another client". Reply metadata (status, bytes, the
// service's own work counters) is recorded for request evidence; no reply body is retained.
// NOT native-host, relay or cross-device proof.
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer as netServer } from 'node:net';
import path from 'node:path';
import type { GuestRequest, GuestRequestResult } from '@openchamber/sdk';
import { createProgressServer } from '../../service/server.ts';
import { RELEASE } from '../../shared/release.ts';
import type { ItemInput } from '../../shared/progress.ts';
import { searchFixture, seedSearchLibrary } from '../fixtures/plan-task-search.ts';

const LIGHT = { mode: 'light', tokens: { background: '#fafafa', elevated: '#ffffff', foreground: '#202124', muted: '#64676e', subtle: '#74777e', border: '#dedfe3', hover: '#f0f1f3', selection: '#e7eefb', focus: '#376bc4', primary: '#316ac3', mutedSurface: '#f3f4f6', elevatedForeground: '#202124', active: '#e7e9ed', selectionForeground: '#173964', primaryForeground: '#ffffff', primaryText: '#24579e', successText: '#237044', warningText: '#855900', errorText: '#ad3030', infoText: '#24579e', success: '#27824d', warning: '#a66c00', error: '#c23d3d', info: '#316ac3', font: 'system-ui, sans-serif', mono: 'monospace', radius: '6px' } };
const DARK = { background: '#191b20', elevated: '#24272e', foreground: '#e6e8ee', muted: '#a4a9b4', subtle: '#9298a4', border: '#414650', hover: '#343944', selection: '#293d60', focus: '#90b8ff', primary: '#83aff7', mutedSurface: '#24272e', elevatedForeground: '#e6e8ee', active: '#3b4350', selectionForeground: '#e0ebff', primaryText: '#a6c7ff', successText: '#86dca3', warningText: '#e8c372', errorText: '#ff9e9e', infoText: '#a6c7ff', success: '#6fc58c', warning: '#d9b367', error: '#ee8989', info: '#83aff7' };
export const FRAMES = ['page', 'panel', 'status'] as const;
/** Synthetic SDK projects matching the fixture's recorded checkouts. */
export const PROJECTS = [{ id: 'alpha', name: 'Alpha', directory: '/fixture/main' }, { id: 'other', name: 'Other', directory: '/fixture/other' }];

const script = `
const light=${JSON.stringify(LIGHT)},dark=${JSON.stringify(DARK)},theme=JSON.parse(JSON.stringify(light));
const frames=${JSON.stringify(FRAMES)},frame=f=>document.querySelector('iframe[data-frame="'+f+'"]');
const send=(f,m)=>frame(f).contentWindow.postMessage({channel:'openchamber.sdk',v:1,...m},'*');
window.frame=frame;
window.qa={account:'account-example',store:0,session:null,stripSearch:false,projects:${JSON.stringify(PROJECTS)},sessions:{},worktrees:{},subs:[],holds:[],held:[],fail:[],requests:[],replies:[],storage:[],messages:[],errors:[]};
const ready=f=>send(f,{type:'ready',payload:{theme,locale:'en',directory:'/fixture/main',session:qa.session?{id:qa.session}:null,surface:f,connection:{connected:true,account:qa.account},settings:{},item:null,features:{deviceStorage:true}}});
qa.ready=f=>{(f?[f]:frames).forEach(ready)};
qa.reload=f=>{const n=frame(f);n.src=n.src};
qa.show=(list,width)=>{for(const n of document.querySelectorAll('section[data-frame]')){const on=list.includes(n.dataset.frame);n.style.display=on?'block':'none';if(on)n.style.width=width+'px'}};
qa.theme=mode=>{theme.mode=mode;Object.assign(theme.tokens,mode==='dark'?dark:light.tokens);document.documentElement.style.background=theme.tokens.background;document.body.style.background=theme.tokens.background;document.body.style.color=theme.tokens.foreground;frames.forEach(ready)};
// Host session A/B/null notifications (the board must keep its own explicit scope).
qa.context=id=>{qa.session=id;for(const f of frames)send(f,{type:'session',payload:{session:id?{id,title:'Example session',busy:false}:null}})};
const projectsSnapshot=()=>({kind:'projects',state:'ready',projects:qa.projects});
const sessionsSnapshot=id=>({kind:'sessions',state:'ready',projectId:id,sessions:qa.sessions[id]??[],worktrees:[],coverage:[]});
qa.setProjects=list=>{qa.projects=list;for(const s of qa.subs)if(s.kind==='projects')send(s.frame,{type:'workspace',payload:{subscriptionId:s.id,snapshot:projectsSnapshot()}})};
const worktreesSnapshot=id=>({kind:'worktrees',state:'ready',projectId:id,worktrees:qa.worktrees[id]??[]});
qa.setWorktrees=(id,list)=>{qa.worktrees[id]=list;for(const s of qa.subs)if(s.kind==='worktrees'&&s.projectId===id)send(s.frame,{type:'workspace',payload:{subscriptionId:s.id,snapshot:worktreesSnapshot(id)}})};
qa.setSessions=(id,list)=>{qa.sessions[id]=list;for(const s of qa.subs)if(s.kind==='sessions'&&s.projectId===id)send(s.frame,{type:'workspace',payload:{subscriptionId:s.id,snapshot:sessionsSnapshot(id)}})};
qa.release=tag=>{const out=qa.held.filter(h=>!tag||h.tag===tag);qa.held=qa.held.filter(h=>!out.includes(h));out.forEach(h=>h.go());return out.length};
const record=(f,q,reply,ms)=>{if(!q.path.startsWith('/v1/search'))return;const e={frame:f,path:q.path,status:reply.status,bytes:new TextEncoder().encode(reply.body).length,ms,at:performance.now()};
 if(q.path==='/v1/search')e.cursor=!!q.query?.cursor;
 if(q.path==='/v1/search-state')e.keys=JSON.parse(q.query?.keys??'[]').length;
 if(reply.status===200){try{const b=JSON.parse(reply.body);if(b.work)e.work=b.work;if(b.hits)e.hits=b.hits.length;if(b.coverage)e.gapped=b.coverage.gapped}catch{}}qa.replies.push(e)};
addEventListener('message',async e=>{
 const el=[...document.querySelectorAll('iframe')].find(x=>x.contentWindow===e.source),m=e.data;if(!el||m.channel!=='openchamber.sdk')return;const f=el.dataset.frame;
 const result=payload=>send(f,{type:'result',id:m.id,ok:true,payload});
 const fail=(code,error)=>send(f,{type:'result',id:m.id,ok:false,code,error});
 qa.messages.push({frame:f,type:m.type,at:performance.now()});
 if(m.type==='hello')ready(f);
 else if(m.type==='workspace-subscribe'){result();const q=m.payload.query;qa.subs.push({frame:f,id:m.payload.subscriptionId,kind:q.kind,projectId:q.projectId});send(f,{type:'workspace',payload:{subscriptionId:m.payload.subscriptionId,snapshot:q.kind==='projects'?projectsSnapshot():q.kind==='sessions'?sessionsSnapshot(q.projectId):worktreesSnapshot(q.projectId)}})}
 else if(m.type==='workspace-unsubscribe'){qa.subs=qa.subs.filter(s=>s.id!==m.payload?.subscriptionId);result()}
 else if(m.type==='storage'){const q=m.payload;qa.storage.push({frame:f,op:q.op,key:q.key??null,scope:q.scope??'instance',at:performance.now()});result({storage:true,op:q.op,found:false,...(q.op==='keys'?{keys:[]}:{})})}
 else if(m.type==='service-request'){
  const q=m.payload,t0=performance.now();qa.requests.push({frame:f,method:q.method,path:q.path,query:q.query||null,at:t0});
  const failing=qa.fail.find(x=>x.path===q.path&&(!x.frame||x.frame===f));
  if(failing&&!(failing.skip>0)){if(failing.once)qa.fail=qa.fail.filter(x=>x!==failing);const r={status:failing.status??503,body:JSON.stringify({error:failing.code??'unavailable'})};record(f,q,r,0);result(r);return}
  if(failing)failing.skip--;
  const forward=async()=>{const r=await fetch('/service',{method:'POST',body:JSON.stringify({request:q,store:qa.store})});if(!r.ok)throw new Error('proxy');const reply=await r.json();
   if(q.path==='/health'&&qa.stripSearch){const b=JSON.parse(reply.body);delete b.planTaskSearch;reply.body=JSON.stringify(b)}record(f,q,reply,performance.now()-t0);return reply};
  const deliver=p=>p.then(result,()=>{qa.errors.push('fixture proxy failed');fail('HOST_UNAVAILABLE','Fixture proxy unavailable')});
  const hold=qa.holds.find(h=>h.path===q.path&&(!h.frame||h.frame===f)&&(h.plan===undefined||q.query?.plan===h.plan)&&(h.cursor===undefined||!!q.query?.cursor===h.cursor));
  if(hold){qa.holds=qa.holds.filter(h=>h!==hold);const reply=forward();qa.held.push({tag:hold.tag,frame:f,path:q.path,go:()=>deliver(reply)})}
  else deliver(forward());
 }else if(m.id)result();
});
`;

const html = `<!doctype html><html><head><meta charset="utf-8"><title>Plan search QA</title><style>html,body{margin:0;background:#fafafa;color:#202124;font:14px system-ui}main{display:flex;flex-wrap:wrap;align-items:flex-start}section{margin:12px;display:none}h1{font-size:13px;margin:0 0 8px}iframe{display:block;width:100%;height:1500px;border:0}section[data-frame=status] iframe{height:220px}</style></head><body><script>${script}</script><main>${FRAMES.map((f) => `<section data-frame="${f}"><h1>Agent progress · ${f}</h1><iframe data-frame="${f}" data-surface="${f}" title="${f}" src="/ui/${f}/index.html"></iframe></section>`).join('')}</main></body></html>`;

type Fixture = ReturnType<typeof searchFixture>;

/** Synthetic public-safe extras: long Unicode titles, a finished plan early in key order, an archived plan. */
function seedExtras(f: Fixture) {
  const long: ItemInput[] = [
    { id: 'G-long', title: 'Größere Überarbeitung der Exportpipeline für sehr lange Titel ohne Leerzeichenumbruchmöglichkeit', kind: 'group' },
    { id: 'T-cafe', title: 'Café export — überprüfen 漢字 タスク ✅ with an exceptionally long description that must wrap cleanly at narrow widths', kind: 'task', status: 'working', parentId: 'G-long' },
  ];
  f.seedPlan('P-unicode', 'Exportplan für Café-Daten mit außergewöhnlich langem Titel, der umbrechen muss', long);
  // Sorts right after P-0005: found by the first window, so an action pauses with it shown.
  f.seedPlan('P-0005-ship', 'Ship export bundle', [{ id: 'S1', title: 'Package export bundle', kind: 'task', status: 'done' }]);
  f.apply('P-0005-ship', { op: 'finish', outcome: 'finished' });
  // Outside the ordinary loaded list (it reads the first 500 plans in key order): a 120-task plan,
  // six detail pages at the service's page size, and six small plans to open one after another.
  f.seedPlan('P-0900-big', 'Big export plan J1', Array.from({ length: 120 }, (_, n): ItemInput => ({ id: `B${n}`, title: `Big export task ${n}`, kind: 'task', status: n % 3 ? 'pending' : 'done' })));
  for (let n = 1; n <= 6; n++) f.seedPlan(`P-090${n}-recent`, `Recent export R${n} J1`, [{ id: `R${n}`, title: `Recent task R${n}`, kind: 'task', status: 'pending' }]);
  f.seedPlan('P-archive', 'Archive candidate', [{ id: 'A1', title: 'Archive export notes', kind: 'task', status: 'done' }]);
  f.apply('P-archive', { op: 'finish', outcome: 'finished' });
  const p = f.store.get(f.alpha.id, 'P-archive')!;
  f.store.cleanup('archive', { storeId: f.storeId, source: f.alpha.id, plan: 'P-archive', rev: p.revision, cleanupRev: 0, oid: 'qa-archive' });
}

/** One disposable store behind the current TypeScript service or the generated built entry. */
async function serve(f: Fixture, built: boolean) {
  let child: ChildProcess | undefined;
  let service: ReturnType<typeof createProgressServer> | undefined;
  let port: number;
  if (built) {
    // Labelled setup seam (test-only SQL): the generated service binds only to a source whose
    // config/data roots really exist and match the store, so the fixture's synthetic roots are
    // re-pointed to disposable directories before serving. Plans, IDs and search data are unchanged.
    const roots = { configRoot: `${f.root}/alpha-config`, dataRoot: `${f.root}/alpha-data` };
    for (const dir of Object.values(roots)) mkdirSync(dir, { mode: 0o700 });
    f.store.db.prepare('UPDATE sources SET config_root=?, data_root=? WHERE id=?').run(roots.configRoot, roots.dataRoot, f.alpha.id);
    const binding = `${f.root}/binding.json`;
    writeFileSync(binding, JSON.stringify({ protocolVersion: 2, schemaVersion: 2, installId: 'search-fixture', version: RELEASE, database: f.store.file, storeId: f.storeId, source: { ...f.alpha, ...roots } }), { mode: 0o600 });
    mkdirSync(`${f.root}/home`, { mode: 0o700 });
    const reservation = netServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
    port = (reservation.address() as { port: number }).port; await new Promise<void>((r) => reservation.close(() => r()));
    child = spawn(process.execPath, [path.resolve('build/service/main.js')], { env: { PATH: process.env.PATH, HOME: `${f.root}/home`, XDG_CONFIG_HOME: `${f.root}/config`, XDG_DATA_HOME: `${f.root}/data`, XDG_STATE_HOME: `${f.root}/state`, AGENT_PROGRESS_BINDING: binding, OPENCHAMBER_SERVICE_PORT: String(port), OPENCHAMBER_SERVICE_TOKEN: 'fixture-only' }, stdio: 'ignore' });
  } else {
    service = createProgressServer(f.store, 'fixture-only'); service.listen(0, '127.0.0.1'); await once(service, 'listening');
    port = (service.address() as { port: number }).port;
  }
  const base = `http://127.0.0.1:${port}`;
  const call = (route: string, body?: unknown) => fetch(base + route, { method: body === undefined ? 'GET' : 'POST', headers: { authorization: 'Bearer fixture-only', 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(8000) });
  for (const end = Date.now() + 10_000; ;) {
    try { const h = await (await call('/health')).json(); if (h.ready && h.planTaskSearch === 1) break; } catch {}
    if (Date.now() > end) throw new Error('search fixture service did not become ready with planTaskSearch:1');
    await new Promise((r) => setTimeout(r, 50));
  }
  return {
    call,
    async stop() {
      if (child && child.exitCode === null) { const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited; }
      if (service) await new Promise<void>((r) => service!.close(() => r()));
      f.cleanup();
    },
  };
}

export async function startSearchShell(built = false) {
  const f = searchFixture(true);
  seedSearchLibrary(f);
  seedExtras(f);
  const second = searchFixture(true);
  const services = [await serve(f, built), await serve(second, built)];
  const relay = async (q: GuestRequest, store: number): Promise<GuestRequestResult> => {
    if (q.path === '/v1/extension-update' || q.path === '/v1/setup') return { status: 404, body: '{"error":"not-found"}' };
    const query = new URLSearchParams(q.query ?? {}).toString();
    const r = await services[store === 1 ? 1 : 0].call(q.path + (query ? `?${query}` : ''), q.body ? JSON.parse(q.body) : undefined);
    return { status: r.status, body: await r.text() };
  };
  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    try {
      if (url.pathname === '/') { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(html); }
      else if (/^\/ui\/(page|panel|status)\/(index\.html|main\.js)$/.test(url.pathname)) { res.setHeader('content-type', url.pathname.endsWith('.js') ? 'text/javascript' : 'text/html'); res.end(readFileSync(`.${url.pathname}`)); }
      else if (url.pathname === '/service' && req.method === 'POST') {
        let body = ''; for await (const part of req) body += part;
        const { request, store } = JSON.parse(body);
        res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(await relay(request, store)));
      } else { res.statusCode = url.pathname === '/favicon.ico' ? 204 : 404; res.end(); }
    } catch { res.statusCode = 500; res.end('{"error":"fixture-failed"}'); }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  let oid = 0;
  const call = services[0].call;
  /** Completes open tasks and reports the plan finished (fixture-side production writes). */
  function finish(plan: string) {
    const open = f.store.get(f.alpha.id, plan)!.items.filter((i) => i.kind === 'task' && i.status !== 'done' && i.status !== 'skipped');
    if (open.length) f.apply(plan, { op: 'change', changes: open.map((i) => ({ id: i.id, status: 'done' })) });
    if (f.store.get(f.alpha.id, plan)!.lifecycle === 'active') f.apply(plan, { op: 'finish', outcome: 'finished' });
  }
  /** "Another client": a confirmed cleanup action through the service. */
  async function cleanupElsewhere(action: 'archive' | 'restore' | 'delete', plan: string) {
    finish(plan);
    const s = f.store.get(f.alpha.id, plan)!;
    const r = await call(`/v1/plan/${action}`, { storeId: f.storeId, source: f.alpha.id, plan, rev: s.revision, cleanupRev: f.store.detail(f.alpha.id, plan).plan.cleanup?.revision ?? 0, oid: `qa-${action}-${++oid}`, ...(action === 'delete' ? { confirmed: true } : {}) });
    if (!r.ok) throw new Error(`fixture ${action} failed (${r.status})`);
  }
  return {
    port: (server.address() as { port: number }).port, storeId: f.storeId, secondStoreId: second.storeId, source: f.alpha.id,
    cleanupElsewhere, deleteElsewhere: (plan: string) => cleanupElsewhere('delete', plan),
    /** A new matching plan behind an active keyset cursor (production staged write). */
    insert: (plan: string, title: string) => { f.seedPlan(plan, title, [{ id: 'N1', title: 'Inserted task', kind: 'task', status: 'pending' }]); },
    exists: (plan: string) => !!f.store.get(f.alpha.id, plan),
    archived: (plan: string) => f.store.detail(f.alpha.id, plan).plan.cleanup?.state === 'archived',
    async stop() { server.close(); server.closeAllConnections(); await Promise.all(services.map((s) => s.stop())); },
  };
}
