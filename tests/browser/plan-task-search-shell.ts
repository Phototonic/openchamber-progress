// Board-search QA host bridge: current guest bundles (page, rail, Work Status) in a synthetic SDK
// shell, relayed to REAL disposable HTTP services over SQLite seeded through production writes
// (the accepted search fixture plus a 1,200-plan library; a second small store for store-change
// races). Current TypeScript service by default; `built` spawns the generated service entry
// (build/service/main.js) for each store. The bearer stays in this process.
// Labelled QA seams only (never shipped): held/failed service replies (HTTP-like or host-rejected,
// the latter rejecting like a missing service entry), a stripped search
// capability, the SDK project/session snapshots, host session context, account switch, store
// switch and fixture-side writes from "another client". Reply metadata (status, bytes, the
// service's own work counters) is recorded for request evidence; no reply body is retained.
// NOT native-host, relay or cross-device proof.
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { createServer as netServer } from 'node:net';
import path from 'node:path';
import type { GuestRequest, GuestRequestResult } from '@openchamber/sdk';
import { createProgressServer } from '../../service/server.ts';
import { RELEASE } from '../../shared/release.ts';
import type { ItemInput } from '../../shared/progress.ts';
import { searchFixture, seedSearchLibrary } from '../fixtures/plan-task-search.ts';
import { mapItems, seedMapFixture } from '../fixtures/dependency-map.ts';
import { digest } from '../../shared/store.ts';
import { createLargePlanReplay, LARGE_PLAN_ID } from '../fixtures/large-plan.ts';
import { readPlanGraph, type ServiceHost } from '../../ui/shared/source.ts';
import { deriveDependencies } from '../../ui/shared/dependency-derivation.ts';
import { setupRead } from './fixtures.ts';
import { CORE_ITEMS, FINISHED_ITEMS, MANY_ITEMS } from './focus-controls-fixtures.ts';
import { seedMapAttribution } from '../fixtures/dependency-map-attribution.ts';
import { seedDesignFixture } from '../fixtures/design-refactor.ts';

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
window.qa={account:'account-example',store:0,session:window.__largePlan?'M':null,stripSearch:false,stripComparison:false,projects:${JSON.stringify(PROJECTS)},sessions:{},worktrees:{},subs:[],holds:[],held:[],fail:[],requests:[],replies:[],storage:[],preferenceReplies:[],messages:[],errors:[]};
// Keyboard-focus modes only (labelled seams): every /v1/setup read and setup action is answered here
// from the existing synthetic setup fixture and never forwarded to a service or installation code;
// "unconfigured" makes /health report not ready. Metadata (method/path/status) is recorded.
if(window.__keyboardFocus){qa.intercepted=[];qa.unconfigured=false;qa.capture=true;qa.setupReply=q=>{const action=q.method==='GET'?null:q.path.split('/').pop();if(action==='disable')qa.capture=false;if(action==='enable')qa.capture=true;const v=qa.unconfigured?{...${JSON.stringify(setupRead({ configured: false, installed: false, verified: false, targets: null, version: null }))}}:{...${JSON.stringify(setupRead())},captureEnabled:qa.capture};if(action)v.action=action;return{status:200,body:JSON.stringify(v)}}}
const ready=f=>send(f,{type:'ready',payload:{theme,locale:'en',directory:'/fixture/main',session:qa.session?{id:qa.session}:null,surface:f,connection:{connected:true,account:qa.account},settings:{},item:null,features:{deviceStorage:true}}});
qa.ready=f=>{(f?[f]:frames).forEach(ready)};
qa.loads={};qa.loaded={};
qa.reload=f=>{const n=frame(f),seq=qa.loads[f]=(qa.loads[f]??0)+1;n.addEventListener('load',()=>qa.loaded[f]=seq,{once:true});n.src=n.src;return seq};
qa.visibility=(f,visible)=>{const d=frame(f).contentDocument;if(!d)return;Object.defineProperty(d,'visibilityState',{configurable:true,get:()=>visible?'visible':'hidden'});d.dispatchEvent(new Event('visibilitychange'))};
qa.show=(list,width)=>{for(const n of document.querySelectorAll('section[data-frame]')){const on=list.includes(n.dataset.frame);n.style.display=on?'block':'none';if(on)n.style.width=width+'px';if(window.__largePlan)qa.visibility(n.dataset.frame,on)}};
qa.theme=mode=>{theme.mode=mode;Object.assign(theme.tokens,mode==='dark'?dark:light.tokens);document.documentElement.style.background=theme.tokens.background;document.body.style.background=theme.tokens.background;document.body.style.color=theme.tokens.foreground;frames.forEach(ready)};
// Host session A/B/null notifications (the board must keep its own explicit scope).
qa.context=id=>{qa.session=id;for(const f of frames)send(f,{type:'session',payload:{session:id?{id,title:'Example session',busy:false}:null}})};
const projectsSnapshot=()=>({kind:'projects',state:'ready',projects:qa.projects});
const sessionsSnapshot=id=>({kind:'sessions',state:'ready',projectId:id,sessions:qa.sessions[id]??[],worktrees:[],coverage:qa.sessionCoverage?.[id]??[]});
qa.setProjects=list=>{qa.projects=list;for(const s of qa.subs)if(s.kind==='projects')send(s.frame,{type:'workspace',payload:{subscriptionId:s.id,snapshot:projectsSnapshot()}})};
const worktreesSnapshot=id=>({kind:'worktrees',state:'ready',projectId:id,worktrees:qa.worktrees[id]??[]});
qa.setWorktrees=(id,list)=>{qa.worktrees[id]=list;for(const s of qa.subs)if(s.kind==='worktrees'&&s.projectId===id)send(s.frame,{type:'workspace',payload:{subscriptionId:s.id,snapshot:worktreesSnapshot(id)}})};
qa.setSessions=(id,list)=>{qa.sessions[id]=list;for(const s of qa.subs)if(s.kind==='sessions'&&s.projectId===id)send(s.frame,{type:'workspace',payload:{subscriptionId:s.id,snapshot:sessionsSnapshot(id)}})};
qa.release=tag=>{const out=qa.held.filter(h=>!tag||h.tag===tag);qa.held=qa.held.filter(h=>!out.includes(h));out.forEach(h=>h.go());return out.length};
const record=(f,q,reply,ms)=>{if(!q.path.startsWith('/v1/search')&&!['/v1/plan','/v1/plan-graph','/v1/subagent-runs','/health','/v1/plans'].includes(q.path))return;const e={frame:f,traffic:'guest',path:q.path,status:reply.status,bytes:new TextEncoder().encode(reply.body).length,ms,at:performance.now()};
 if(q.path==='/v1/search')e.cursor=!!q.query?.cursor;
 if(q.path==='/v1/search-state')e.keys=JSON.parse(q.query?.keys??'[]').length;
 if(q.path==='/v1/plan')e.continuation=!!q.query?.cursor;
  if(reply.status===200){try{const b=JSON.parse(reply.body);if(b.storeId)e.storeId=b.storeId;if(b.work)e.work=b.work;if(b.hits)e.hits=b.hits.length;if(b.coverage)e.gapped=b.coverage.gapped;if(b.plan){e.revision=b.plan.revision;e.itemCount=b.items?.data?.length;e.nextPage=!!b.items?.nextCursor}else if(q.path==='/v1/plan-graph'){e.revision=b.revision;e.itemCount=b.itemCount}}catch{}}qa.replies.push(e)};
addEventListener('message',async e=>{
 const el=[...document.querySelectorAll('iframe')].find(x=>x.contentWindow===e.source),m=e.data;if(!el)return;const f=el.dataset.frame;
 if(m.channel==='qa.preference-consumed'){const r=qa.preferenceReplies[m.ticket];if(r?.frame===f)r.consumed=true;return}
 if(m.channel!=='openchamber.sdk')return;
 const result=payload=>{send(f,{type:'result',id:m.id,ok:true,payload});if(m.type==='storage'&&m.payload.op==='get'&&m.payload.key?.startsWith('rail-plan:')){const ticket=qa.preferenceReplies.length;qa.preferenceReplies.push({frame:f,key:m.payload.key,consumed:false});send(f,{channel:'qa.preference-barrier',ticket})}};
 const fail=(code,error)=>send(f,{type:'result',id:m.id,ok:false,code,error});
 qa.messages.push({frame:f,type:m.type,at:performance.now()});
 if(m.type==='hello')ready(f);
 else if(m.type==='workspace-subscribe'){result();const q=m.payload.query;qa.subs.push({frame:f,id:m.payload.subscriptionId,kind:q.kind,projectId:q.projectId});send(f,{type:'workspace',payload:{subscriptionId:m.payload.subscriptionId,snapshot:q.kind==='projects'?projectsSnapshot():q.kind==='sessions'?sessionsSnapshot(q.projectId):worktreesSnapshot(q.projectId)}})}
 else if(m.type==='workspace-unsubscribe'){qa.subs=qa.subs.filter(s=>s.id!==m.payload?.subscriptionId);result()}
 else if(m.type==='storage'){const q=m.payload;qa.storage.push({frame:f,op:q.op,key:q.key??null,scope:q.scope??'instance',at:performance.now()});
  const reply={storage:true,op:q.op,found:false,...(q.op==='keys'?{keys:[]}:{})};
  // Labelled delayed preference seam. Ordinary modes retain their no-saved-preference fixture.
  if(qa.holdPreference&&f==='panel'&&q.op==='get'&&q.key==='rail-plan:M'){qa.holdPreference=false;qa.held.push({tag:'preference',frame:f,path:'storage',go:()=>result({...reply,found:true,value:'source-beta/P-map'})})}
  else if(qa.railPreferences&&f==='panel'&&q.key?.startsWith('rail-plan:')){if(q.op==='set')qa.railPreferences[q.key]=q.value;if(q.op==='delete')delete qa.railPreferences[q.key];result({...reply,...(q.op==='get'&&typeof qa.railPreferences[q.key]==='string'?{found:true,value:qa.railPreferences[q.key]}:{})})}
  else result(reply)}
 else if(m.type==='service-request'){
  const q=m.payload,t0=performance.now();qa.requests.push({frame:f,method:q.method,path:q.path,query:q.query||null,at:t0});
  const failing=qa.fail.find(x=>x.path===q.path&&(!x.frame||x.frame===f));
  if(failing&&!(failing.skip>0)){if(failing.once)qa.fail=qa.fail.filter(x=>x!==failing);
   if(failing.reject){fail(failing.code??'NO_SERVICE',failing.error??'Service entry is missing.');return}
   const r={status:failing.status??503,body:JSON.stringify({error:failing.code??'unavailable'})};record(f,q,r,0);result(r);return}
  if(failing)failing.skip--;
  if(window.__keyboardFocus&&q.path.startsWith('/v1/setup')){const r=qa.setupReply(q);qa.intercepted.push({frame:f,method:q.method,path:q.path,status:r.status,at:t0});result(r);return}
  const forward=async()=>{const r=await fetch('/service',{method:'POST',body:JSON.stringify({request:q,store:qa.store})});if(!r.ok)throw new Error('proxy');const reply=await r.json();
   // Labelled legacy-detail seam: optional aggregate metadata is absent, so readDetail cannot
   // construct its authoritative snapshot/identity. Other wire identity validation stays intact.
    if(q.path==='/v1/plan'&&reply.status===200&&qa.stripDetailSnapshot===f){const b=JSON.parse(reply.body);delete b.plan.counts;reply.body=JSON.stringify(b)}
    // QT legacy-read fixture: modern link writes also record an assignee. Older readable snapshots
    // can retain links alone; foreign same-ID assignees must not borrow this host's title/activity.
    if(window.__mapAttribution&&q.path==='/v1/plan'&&reply.status===200){const b=JSON.parse(reply.body);for(const item of b.items.data){if(item.id==='L')delete item.assigneeSessionId;if(q.query.source==='source-beta'&&item.id==='B')item.assigneeSessionId='map-child'}reply.body=JSON.stringify(b)}
    // QT fault injection only: older/missing/unloaded/mismatched child evidence, not Store writes.
    if(q.path==='/v1/subagent-runs'&&reply.status===200&&qa.mapRunFault?.[f]){const b=JSON.parse(reply.body),fault=qa.mapRunFault[f];for(const row of b.data){if(fault==='missing')delete row.latestForChild;if(fault==='unloaded')row.latestForChild=false;if(fault==='childless'){row.childSessionId=null;row.latestForChild=false}if(fault==='other')row.childSessionId='other-child'}reply.body=JSON.stringify(b)}
   if(q.path==='/health'&&window.__keyboardFocus&&qa.unconfigured){const b=JSON.parse(reply.body);b.ready=false;reply.body=JSON.stringify(b)}
    if(q.path==='/health'&&(qa.stripSearch||qa.stripComparison||qa.stripGraph)){const b=JSON.parse(reply.body);if(qa.stripSearch)delete b.planTaskSearch;if(qa.stripComparison)delete b.documentCaptureComparison;if(qa.stripGraph)delete b.planGraph;reply.body=JSON.stringify(b)}record(f,q,reply,performance.now()-t0);return reply};
  const deliver=p=>p.then(result,()=>{qa.errors.push('fixture proxy failed');fail('HOST_UNAVAILABLE','Fixture proxy unavailable')});
  const hold=qa.holds.find(h=>h.path===q.path&&(!h.frame||h.frame===f)&&(h.plan===undefined||q.query?.plan===h.plan)&&(h.cursor===undefined||!!q.query?.cursor===h.cursor));
  if(hold){qa.holds=qa.holds.filter(h=>h!==hold);const reply=forward();qa.held.push({tag:hold.tag,frame:f,path:q.path,go:()=>deliver(reply)})}
  else deliver(forward());
 }else if(m.id)result();
});
`;

const html = `<!doctype html><html><head><meta charset="utf-8"><title>Plan search QA</title><style>html,body{margin:0;background:#fafafa;color:#202124;font:14px system-ui}main{display:flex;flex-wrap:wrap;align-items:flex-start}section{margin:12px;display:none}h1{font-size:13px;margin:0 0 8px}iframe{display:block;width:100%;height:1500px;border:0}section[data-frame=status] iframe{height:220px}</style></head><body><script>${script}</script><main>${FRAMES.map((f) => `<section data-frame="${f}"><h1>Agent progress · ${f}</h1><iframe data-frame="${f}" data-surface="${f}" title="${f}" src="/ui/${f}/index.html"></iframe></section>`).join('')}</main></body></html>`;

// Fixture-only guest acknowledgement. The parent's result and marker are FIFO message tasks:
// the SDK resolves storage in the result handler, and its promise chain (including the rail's
// restore callback) drains at that task's microtask checkpoint before this marker can run.
const preferenceBarrier = `<script>addEventListener('message',e=>{if(e.source===parent&&e.data?.channel==='qa.preference-barrier')parent.postMessage({channel:'qa.preference-consumed',ticket:e.data.ticket},'*')})</script>`;

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
    child = spawn(process.execPath, [path.resolve('build/service/main.js')], { env: { PATH: process.env.PATH, HOME: `${f.root}/home`, XDG_CONFIG_HOME: `${f.root}/config`, XDG_DATA_HOME: `${f.root}/data`, XDG_STATE_HOME: `${f.root}/state`, ...(process.env.ORCA_PRIVATE_ROOT ? { ORCA_PRIVATE_ROOT: process.env.ORCA_PRIVATE_ROOT } : {}), AGENT_PROGRESS_BINDING: binding, OPENCHAMBER_SERVICE_PORT: String(port), OPENCHAMBER_SERVICE_TOKEN: 'fixture-only' }, stdio: 'ignore' });
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

/** Keyboard-focus session (synthetic): the existing focus-control fixture items as real reports. */
export const KEYBOARD_SESSION = 'KF';
export const KEYBOARD_PLANS = { active: 'K-focus', many: 'K-many', allDone: 'K-all-done', deletable: 'K-finished-delete', archivable: 'K-finished-archive' } as const;
/** Reported plans cannot nest a task under a task: such a child moves up to that task's own group. */
const asInput = (items: typeof CORE_ITEMS): ItemInput[] => items.map(({ id, title, kind, status, parentId, dependencies }) => {
  const parent = items.find((i) => i.id === parentId);
  const group = parent?.kind === 'task' ? parent.parentId : parentId;
  return { id, title, kind, status, ...(group ? { parentId: group } : {}), ...(dependencies ? { dependencies } : {}) };
});
function seedKeyboard(f: Fixture) {
  const who = { ...f.actor, sessionId: KEYBOARD_SESSION };
  f.seedPlan(KEYBOARD_PLANS.active, 'Focus controls example', asInput(CORE_ITEMS), who);
  f.seedPlan(KEYBOARD_PLANS.many, 'Parallel work example', asInput(MANY_ITEMS), who);
  f.seedPlan(KEYBOARD_PLANS.allDone, 'All tasks done example', asInput(FINISHED_ITEMS), who);
  for (const plan of [KEYBOARD_PLANS.deletable, KEYBOARD_PLANS.archivable]) {
    f.seedPlan(plan, plan === KEYBOARD_PLANS.deletable ? 'Disposable finished plan A' : 'Disposable finished plan B', asInput(FINISHED_ITEMS), who);
    f.apply(plan, { op: 'finish', outcome: 'finished' }, who);
  }
}

/**
 * `keyboard`: neutral shell sentinels before/after the frames and the labelled setup/health seams
 * (keyboard-focus modes only). Mode `keyboard-focus` also seeds the synthetic `KF` session.
 */
export async function startSearchShell(built = false, reportingSetup = false, mode: 'search' | 'large-plan' | 'keyboard-focus' | 'dependency-map-final' | 'dependency-map-render' | 'dependency-map-interaction' | 'dependency-map-large' | 'dependency-map-attribution' | 'design-refactor' = 'search', keyboard = mode === 'keyboard-focus', productionMap = mode === 'dependency-map-final', design: { guestRoot?: string; slice?: string } = {}) {
  if (!['search', 'large-plan', 'keyboard-focus', 'dependency-map-final', 'dependency-map-render', 'dependency-map-interaction', 'dependency-map-large', 'dependency-map-attribution', 'design-refactor'].includes(mode)) throw Error('Unknown search-shell fixture mode');
  const isDesign = mode === 'design-refactor';
  const large = mode === 'large-plan' || mode === 'dependency-map-large';
  const interaction = mode === 'dependency-map-interaction' || mode === 'dependency-map-large' || mode === 'dependency-map-attribution';
  const preview = !productionMap && (mode === 'dependency-map-render' || interaction);
  const previewPrefix = interaction ? `globalThis.__mapInteraction=true;globalThis.__mapLarge=${large};globalThis.__mapAttribution=${mode === 'dependency-map-attribution'};\n` : '';
  const map = mode === 'dependency-map-final' || preview || productionMap;
  const previewRoot = preview ? mkdtempSync('/tmp/opencode/dependency-map-preview-') : null;
  const primitiveRoot = isDesign ? mkdtempSync('/tmp/opencode/design-primitives-') : null;
  if (primitiveRoot) execFileSync('bun', ['node_modules/@openchamber/sdk/scripts/bundle-guest.ts', 'tests/browser/design-primitives-guest.ts', `${primitiveRoot}/main.js`], { stdio: 'pipe' });
  if (previewRoot) execFileSync('bun', ['node_modules/@openchamber/sdk/scripts/bundle-guest.ts', 'tests/browser/dependency-map-guest.ts', `${previewRoot}/main.js`], { stdio: 'pipe' });
  const f = searchFixture(!large && !map && !isDesign);
  const replay = large ? createLargePlanReplay(f) : null;
  const designFixture = isDesign ? seedDesignFixture(f, design.slice === 'board') : null;
  if (replay) replay.seed(); else if (map) seedMapFixture(f); else if (!isDesign) { seedSearchLibrary(f); seedExtras(f); }
  let attribution = mode === 'dependency-map-attribution' ? seedMapAttribution(f) : null;
  if (mode === 'keyboard-focus') seedKeyboard(f);
  const second = searchFixture(!large && !map && !isDesign);
  if (isDesign) seedDesignFixture(second, design.slice === 'board');
  if (map) seedMapFixture(second);
  if (attribution) seedMapAttribution(second);
  const services = [await serve(f, built), await serve(second, built)];
  const relay = async (q: GuestRequest, store: number): Promise<GuestRequestResult> => {
    if (q.path === '/v1/extension-update' || (q.path === '/v1/setup' && !reportingSetup)) return { status: 404, body: '{"error":"not-found"}' };
    const query = new URLSearchParams(q.query ?? {}).toString();
    const r = await services[store === 1 ? 1 : 0].call(q.path + (query ? `?${query}` : ''), q.body ? JSON.parse(q.body) : undefined);
    return { status: r.status, body: await r.text() };
  };
  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    try {
      if (url.pathname === '/') {
        let page = large || preview || productionMap ? html.replace('<script>', '<script>window.__largePlan=true;') : html;
        if (isDesign) page = page.replace('<script>', '<script>window.__largePlan=true;').replace('</body>', `<script>qa.projects=[{id:'harbor-app',name:'harbor-app',directory:'/fixture/harbor-app'},{id:'lighthouse-app',name:'lighthouse-app',directory:'/fixture/lighthouse-app'}];qa.worktrees={'harbor-app':[{directory:'/fixture/harbor-app/release-2-0',name:'release-2-0'}]};qa.show(['page','panel','status'],360);document.querySelector('section[data-frame=page]').style.width='1100px';</script></body>`);
        if (attribution) page = page.replace('<script>', '<script>window.__mapAttribution=true;');
        if (preview) page = page.replace('</body>', '<script>qa.show(["page","panel"],600);document.querySelector("section[data-frame=page]").style.width="1100px";</script></body>');
        if (keyboard) page = page.replace('<script>', '<script>window.__keyboardFocus=true;').replace('<main>', '<button id="qa-before" type="button">Shell start</button><main>').replace('</main>', '</main><button id="qa-after" type="button">Shell end</button>');
        res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(page);
      }
      else if (primitiveRoot && url.pathname === '/primitives.html') { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><html lang="en"><meta name="viewport" content="width=device-width"><title>Primitive QA</title><div id="root"></div><script src="/primitives.js"></script></html>'); }
      else if (primitiveRoot && url.pathname === '/primitives.js') { res.setHeader('content-type', 'text/javascript'); res.end(readFileSync(`${primitiveRoot}/main.js`)); }
      else if (productionMap && url.pathname === '/fixture-step' && req.method === 'POST') {
        let body = ''; for await (const part of req) body += part;
        const step = JSON.parse(body).step;
        if (step === 'status') f.apply('P-map', { op: 'change', changes: [{ id: 'C', status: 'working' }] });
        else if (step === 'structure') f.apply('P-map', { op: 'revise', title: 'Dependency map fixture', items: [...mapItems.map(i=>i.id==='C'?{...i,status:'working' as const}:i), { id: 'N', title: 'New independent task', kind: 'task' }] });
        else throw Error('Unknown fixture step');
        res.end('{}');
      }
      else if (/^\/ui\/(page|panel|status)\/(index\.html|main\.js)$/.test(url.pathname)) { res.setHeader('content-type', url.pathname.endsWith('.js') ? 'text/javascript' : 'text/html'); const isPreview = previewRoot && /^\/ui\/(page|panel)\/main.js$/.test(url.pathname); let body = (isPreview ? previewPrefix : '') + readFileSync(isPreview ? `${previewRoot}/main.js` : path.join(design.guestRoot ?? '.', url.pathname.slice(1)), 'utf8'); if (url.pathname.endsWith('.html')) body = body.replace('</body>', preferenceBarrier + '</body>'); res.end(body); }
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
  const graphProbes: { frame: string; traffic: string; path: string; status: number; bytes: number; ms: number; revision: number }[] = [];
  async function probeLargePlan() {
    if (!replay) throw Error('Large-plan mode required');
    const plan = f.store.get(f.alpha.id, LARGE_PLAN_ID)!;
    const health = await (await call('/health')).json();
    let requests = 0;
    const host: ServiceHost = { serviceRequest: async q => {
      requests++; const start = performance.now();
      const response = await call(`${q.path}?${new URLSearchParams(q.query)}`), body = await response.text();
      const bytes = Buffer.byteLength(body), ms = performance.now() - start;
      graphProbes.push({ frame: 'harness', traffic: 'harness-probe', path: q.path, status: response.status, bytes, ms, revision: plan.revision });
      if (bytes > 1048576) throw Error('Graph response byte limit exceeded');
      return { status: response.status, body };
    } };
    const start = performance.now();
    const result = await readPlanGraph(host, health, { storeId: f.storeId, binding: { sourceId: f.alpha.id, verified: true }, source: f.alpha.id, plan: LARGE_PLAN_ID, revision: plan.revision, cleanupRev: 0 });
    const graphMs = performance.now() - start;
    if (!result.ok || requests !== 1 || result.graph.itemCount !== plan.items.length) throw Error('Complete pinned graph probe failed');
    const coreStart = performance.now(), derived = deriveDependencies(result.graph.items), coreMs = performance.now() - coreStart;
    if (derived.state !== 'valid') throw Error('Graph probe derivation invalid');
    return { revision: plan.revision, items: result.graph.itemCount, tasks: derived.tasks.size, graphMs, coreMs, bytes: graphProbes.at(-1)!.bytes, requests };
  }
  const recordedCapture = (plan: string) => {
    const p=f.store.get(f.alpha.id,plan)!;if(!p.document.captureId)return undefined;
    const row=f.store.db.prepare('SELECT text FROM captures WHERE id=?').get(p.document.captureId)!;
    return {state:'captured' as const,path:p.document.path!,canonicalPath:p.document.canonicalPath!,text:String(row.text),hash:p.document.hash!,checkedAt:new Date().toISOString()};
  };
  function report(plan:string,request:Record<string,unknown>){
    f.store.apply({plan,rev:f.store.get(f.alpha.id,plan)!.revision,oid:`document-qa-${++oid}`,...request},designFixture?.actor ?? f.actor,recordedCapture(plan));
  }
  /** Completes open tasks and reports the plan finished (fixture-side production writes). */
  function finish(plan: string) {
    const open = f.store.get(f.alpha.id, plan)!.items.filter((i) => i.kind === 'task' && i.status !== 'done' && i.status !== 'skipped');
    if (open.length) report(plan, { op: 'change', changes: open.map((i) => ({ id: i.id, status: 'done' })) });
    if (f.store.get(f.alpha.id, plan)!.lifecycle === 'active') report(plan, { op: 'finish', outcome: 'finished' });
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
    previewHash: previewRoot ? createHash('sha256').update(previewPrefix).update(readFileSync(`${previewRoot}/main.js`)).digest('hex') : null,
    largePlan: replay, probeLargePlan, graphProbes,
    mapAttribution: attribution,
    enableMapAttribution: () => { if (!productionMap || large) throw Error('Small production map fixture required'); return attribution ??= seedMapAttribution(f); },
    cleanupElsewhere, deleteElsewhere: (plan: string) => cleanupElsewhere('delete', plan),
    /** A new matching plan behind an active keyset cursor (production staged write). */
    insert: (plan: string, title: string) => { f.seedPlan(plan, title, [{ id: 'N1', title: 'Inserted task', kind: 'task', status: 'pending' }]); },
    /** Another client changes capture without updating any plan revision. */
    setCapture: (enabled: boolean) => f.store.setEnabled(enabled),
    seedDesignFailed: () => {
      if (!designFixture) throw Error('Design fixture required');
      f.seedPlan('P-release-failed', 'Release failed record', [{ id: 'F1', title: 'Release check', kind: 'task', status: 'pending' }], designFixture.actor);
      f.apply('P-release-failed', { op: 'finish', outcome: 'failed' }, designFixture.actor);
    },
    seedDesignRegroup: (outcome: 'finished' | 'cancelled') => {
      if (!designFixture) throw Error('Design fixture required');
      const plan = `P-review-${outcome}`;
      f.seedPlan(plan, `Release ${outcome} focus check`, [{ id: 'T1', title: 'Release focus check', kind: 'task', status: 'pending' }], designFixture.actor);
      return plan;
    },
    seedDesignKeyboardRegroup: (outcome: 'finished' | 'cancelled') => {
      if (!designFixture) throw Error('Design fixture required');
      const plan = `P-keyboard-${outcome}`;
      const items = [{ id: 'T1', title: 'Release keyboard check', kind: 'task' as const, status: 'pending' as const }];
      f.seedPlan(plan, `Release keyboard ${outcome} check`, items, designFixture.actor);
      f.seedPlan(plan, `Independent keyboard ${outcome} counterpart`, items, { ...designFixture.actor, sourceId: f.beta.id, sessionId: 'N' });
      return { plan, source: designFixture.actor.sourceId, foreignSource: f.beta.id };
    },
    finishDesignRegroup: (plan: string, outcome: 'finished' | 'cancelled') => {
      if (!designFixture) throw Error('Design fixture required');
      if (outcome === 'finished') f.apply(plan, { op: 'change', changes: [{ id: 'T1', status: 'done' }] }, designFixture.actor);
      f.apply(plan, { op: 'finish', outcome }, designFixture.actor);
    },
    /** Explicit synthetic document report for the capture-comparison QA; no source file read. */
    recordDocument: (plan:string,text:string,source='/fixture/plan.md',state:'captured'|'denied'='captured') => {
      f.store.apply({op:'bind',plan,rev:f.store.get(f.alpha.id,plan)!.revision,oid:`capture-qa-${++oid}`,source,confirm:false},f.actor,{state,path:source,canonicalPath:source,text,hash:digest(text),checkedAt:new Date().toISOString()});
      return f.store.get(f.alpha.id,plan)!.document.captureId!;
    },
    /** Keyboard-focus mode: a synthetic report by the `KF` session (production write path). */
    reportKeyboard: (plan: string, request: Record<string, unknown>) => { f.apply(plan, request, { ...f.actor, sessionId: KEYBOARD_SESSION }); },
    /** Map preview: another client's ordinary report, to exercise retained-picture refreshes. */
    reportMap: (plan: string, request: Record<string, unknown>) => { if (!map) throw Error('Map fixture required'); f.apply(plan, request); },
    exists: (plan: string) => !!f.store.get(f.alpha.id, plan),
    /** Scope the rail matrix to two linked plans, rather than the first 500 library keys. */
    prepareRetirementPlans: () => {
      const child = { ...f.actor, sessionId: 'retirement-reader', parentId: f.actor.sessionId, ancestry: [f.actor.sessionId] };
      for (const id of ['P-export', 'P-title']) {
        const item = f.store.get(f.alpha.id, id)!.items.find(i => i.kind === 'task')!;
        f.apply(id, { op: 'link', child: child.sessionId, assign: [item.id] }, f.actor, child);
      }
    },
    archived: (plan: string) => f.store.detail(f.alpha.id, plan).plan.cleanup?.state === 'archived',
    async stop() { server.close(); server.closeAllConnections(); await Promise.all(services.map((s) => s.stop())); if (previewRoot) rmSync(previewRoot, { recursive: true, force: true }); if (primitiveRoot) rmSync(primitiveRoot, { recursive: true, force: true }); },
  };
}
