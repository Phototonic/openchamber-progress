// Needs-you QA host bridge: current guest bundles (page, rail, Work Status) in a synthetic SDK
// shell, relayed to the REAL disposable needs-you fixture service (tests/fixtures/needs-you.ts:
// SQLite seeded through production writes). Current TypeScript service by default; `built` spawns
// the generated build/service/main.js. The bearer stays in this process.
// Labelled QA seams only (never shipped): held/failed service replies, an older service without
// blocked timing, a malformed annotation an older/odd service could return, endless continuation
// cursors (page-cap exhaustion), SDK session snapshots, host session context, frame visibility and
// fixture-side production writes from "another client". Only bounded request metadata is recorded,
// never reply bodies. NOT native-host, relay or cross-device proof.
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import type { GuestRequest, GuestRequestResult } from '@openchamber/sdk';
import type { BlockerItemInput, Request } from '../../shared/progress.ts';
import { launchNeedsYouService } from '../fixtures/needs-you.ts';

const LIGHT = { mode: 'light', tokens: { background: '#fafafa', elevated: '#ffffff', foreground: '#202124', muted: '#64676e', subtle: '#74777e', border: '#dedfe3', hover: '#f0f1f3', selection: '#e7eefb', focus: '#376bc4', primary: '#316ac3', mutedSurface: '#f3f4f6', elevatedForeground: '#202124', active: '#e7e9ed', selectionForeground: '#173964', primaryForeground: '#ffffff', primaryText: '#24579e', successText: '#237044', warningText: '#855900', errorText: '#ad3030', infoText: '#24579e', success: '#27824d', warning: '#a66c00', error: '#c23d3d', info: '#316ac3', font: 'system-ui, sans-serif', mono: 'monospace', radius: '6px' } };
const DARK = { background: '#191b20', elevated: '#24272e', foreground: '#e6e8ee', muted: '#a4a9b4', subtle: '#9298a4', border: '#414650', hover: '#343944', selection: '#293d60', focus: '#90b8ff', primary: '#83aff7', mutedSurface: '#24272e', elevatedForeground: '#e6e8ee', active: '#3b4350', selectionForeground: '#e0ebff', primaryText: '#a6c7ff', successText: '#86dca3', warningText: '#e8c372', errorText: '#ff9e9e', infoText: '#a6c7ff', success: '#6fc58c', warning: '#d9b367', error: '#ee8989', info: '#83aff7' };
export const FRAMES = ['page', 'panel', 'status'] as const;
/** Synthetic SDK project matching the fixture's recorded owner directory, and its live sessions. */
const PROJECT = { id: 'alpha', name: 'Alpha', directory: '/fixture/Alpha' };
const SESSIONS = [{ id: 'M', title: 'Planner session', parentId: null }, { id: 'C', title: 'Helper session', parentId: 'M' }, { id: 'U', title: 'Unrelated session', parentId: null }]
  .map((s) => ({ ...s, projectId: PROJECT.id, directory: PROJECT.directory, createdAt: 1, updatedAt: 2, archivedAt: null, worktree: null, activity: 'idle', outcome: null, items: [] }));

const script = `
const light=${JSON.stringify(LIGHT)},dark=${JSON.stringify(DARK)},theme=JSON.parse(JSON.stringify(light));
const frames=${JSON.stringify(FRAMES)},frame=f=>document.querySelector('iframe[data-frame="'+f+'"]');
const send=(f,m)=>frame(f)?.contentWindow?.postMessage({channel:'openchamber.sdk',v:1,...m},'*');
const project=${JSON.stringify(PROJECT)},sessions=${JSON.stringify(SESSIONS)};
window.frame=frame;
window.qa={session:null,subs:[],holds:[],held:[],fail:[],edits:{stripBlockedTiming:false,malform:null,endless:null},requests:[],messages:[],storage:new Map(),errors:[]};
const ready=f=>send(f,{type:'ready',payload:{theme,locale:'en',directory:project.directory,session:qa.session?{id:qa.session}:null,surface:f,connection:{connected:true,account:'account-example'},settings:{},item:null}});
qa.ready=f=>{(f?[f]:frames).forEach(ready)};
qa.context=id=>{qa.session=id;for(const f of frames){ready(f);send(f,{type:'directory',payload:{directory:project.directory}});send(f,{type:'session',payload:{session:id?{id}:null}})}};
qa.show=(list,width)=>{for(const n of document.querySelectorAll('section[data-frame]')){const on=list.includes(n.dataset.frame);n.style.display=on?'block':'none';if(on)n.style.width=width+'px'}};
qa.theme=mode=>{theme.mode=mode;Object.assign(theme.tokens,mode==='dark'?dark:light.tokens);document.documentElement.style.background=theme.tokens.background;document.body.style.background=theme.tokens.background;document.body.style.color=theme.tokens.foreground;frames.forEach(ready)};
qa.reload=f=>{const n=frame(f);n.src=n.src};
// Live session activity change (same plan revision): a repaint with no new progress data.
qa.pulse=()=>{const s=sessions.find(x=>x.id==='C');s.activity=s.activity==='idle'?'busy':'idle';s.updatedAt++;for(const x of qa.subs)if(x.kind==='sessions'&&x.projectId===project.id)send(x.frame,{type:'workspace',payload:{subscriptionId:x.id,snapshot:snapshot({kind:'sessions',projectId:project.id})}});return s.activity};
qa.release=tag=>{const out=qa.held.filter(h=>!tag||h.tag===tag);qa.held=qa.held.filter(h=>!out.includes(h));out.forEach(h=>h.go());return out.length};
const snapshot=q=>q.kind==='projects'?{kind:'projects',state:'ready',projects:[project]}:q.kind==='worktrees'?{kind:'worktrees',projectId:q.projectId,state:'ready',worktrees:[]}:{kind:'sessions',projectId:q.projectId,state:'ready',coverage:[],sessions:q.projectId===project.id?sessions:[]};
addEventListener('message',async e=>{
 const el=[...document.querySelectorAll('iframe')].find(x=>x.contentWindow===e.source),m=e.data;if(!el||m.channel!=='openchamber.sdk')return;const f=el.dataset.frame;
 const result=payload=>send(f,{type:'result',id:m.id,ok:true,payload});
 const fail=(code,error)=>send(f,{type:'result',id:m.id,ok:false,code,error});
 qa.messages.push({frame:f,type:m.type,at:performance.now()});
 if(m.type==='hello')ready(f);
 else if(m.type==='workspace-subscribe'){result();const q=m.payload.query;qa.subs.push({frame:f,id:m.payload.subscriptionId,kind:q.kind,projectId:q.projectId??null});send(f,{type:'workspace',payload:{subscriptionId:m.payload.subscriptionId,snapshot:snapshot(q)}})}
 else if(m.type==='workspace-unsubscribe'){qa.subs=qa.subs.filter(s=>s.id!==m.payload?.subscriptionId);result()}
 else if(m.type==='storage'){const q=m.payload,k=f+':'+q.key;if(q.op==='set')qa.storage.set(k,q.value);if(q.op==='delete')qa.storage.delete(k);result({storage:true,op:q.op,found:qa.storage.has(k),value:qa.storage.get(k),...(q.op==='keys'?{keys:[]}:{})})}
 else if(m.type==='service-request'){
  const q=m.payload,t0=performance.now(),entry={frame:f,context:qa.session,method:q.method,path:q.path,plan:q.query?.plan??null,source:q.query?.source??null,cursor:!!q.query?.cursor,session:q.query?.session??null,at:t0,status:null};qa.requests.push(entry);
  const failing=qa.fail.find(x=>(!x.path||x.path===q.path)&&(!x.frame||x.frame===f)&&(x.cursor===undefined||!!q.query?.cursor===x.cursor)&&(!x.plan||q.query?.plan===x.plan));
  if(failing){if(failing.once)qa.fail=qa.fail.filter(x=>x!==failing);entry.status=failing.status??503;result({status:entry.status,body:JSON.stringify({error:failing.code??'unavailable'})});return}
  const forward=async()=>{const r=await fetch('/service',{method:'POST',body:JSON.stringify({request:q,edits:qa.edits})});if(!r.ok)throw new Error('proxy');const reply=await r.json();entry.status=reply.status;return reply};
  const deliver=p=>p.then(result,()=>{qa.errors.push('fixture proxy failed');fail('HOST_UNAVAILABLE','Fixture proxy unavailable')});
  const hold=qa.holds.find(h=>h.path===q.path&&(!h.frame||h.frame===f)&&(h.plan===undefined||q.query?.plan===h.plan)&&(h.cursor===undefined||!!q.query?.cursor===h.cursor));
  // A held reply is fetched now (its content predates later writes) and delivered on release;
  // a lazy hold fetches at release instead (the request was issued before later writes).
  if(hold){qa.holds=qa.holds.filter(h=>h!==hold);const reply=hold.lazy?null:forward();qa.held.push({tag:hold.tag,frame:f,path:q.path,plan:q.query?.plan??null,cursor:!!q.query?.cursor,go:()=>deliver(reply??forward())})}
  else deliver(forward());
 }else if(m.id)result();
});
`;

const html = `<!doctype html><html><head><meta charset="utf-8"><title>Needs you QA</title><style>html,body{margin:0;background:#fafafa;color:#202124;font:14px system-ui}main{display:flex;flex-wrap:wrap;align-items:flex-start}section{margin:12px;display:none}h1{font-size:13px;margin:0 0 8px}iframe{display:block;width:100%;height:1400px;border:0}section[data-frame=status] iframe{height:240px}</style></head><body><script>${script}</script><main>${FRAMES.map((f) => `<section data-frame="${f}"><h1>Agent progress · ${f}</h1><iframe data-frame="${f}" data-surface="${f}" title="${f}" src="/ui/${f}/index.html"></iframe></section>`).join('')}</main></body></html>`;

type Edits = { stripBlockedTiming: boolean; malform: string | null; endless: string | null };
type Rec = Record<string, any>;

export async function startNeedsYouShell(built = false) {
  const f = await launchNeedsYouService(built);
  const endless = new Map<string, string>();
  /** Labelled reply seams applied to /v1/plan bodies only. */
  const edit = (q: GuestRequest, body: Rec, edits: Edits) => {
    if (q.path !== '/v1/plan') return body;
    if (edits.stripBlockedTiming) delete body.blockedTiming; // an older service
    if (edits.malform) for (const i of body.items?.data ?? []) if (i.id === edits.malform && i.blocker) i.blocker = { ...i.blocker, reason: '   ' }; // blank: invalid
    if (edits.endless && q.query?.plan === edits.endless) {
      const n = q.query?.cursor?.startsWith('qa-endless-') ? Number(q.query.cursor.slice(11)) : 0;
      body.items.nextCursor = `qa-endless-${n + 1}`; body.contributions.nextCursor = null;
    }
    return body;
  };
  const relay = async (q: GuestRequest, edits: Edits): Promise<GuestRequestResult> => {
    if (q.path === '/v1/extension-update' || q.path === '/v1/setup') return { status: 404, body: '{"error":"not-found"}' };
    const query = { ...(q.query ?? {}) };
    // Endless continuation pages re-read the plan's first page; the cap ends the read first.
    if (query.cursor?.startsWith('qa-endless-')) delete query.cursor;
    const qs = new URLSearchParams(query).toString();
    const r = await f.request(q.path + (qs ? `?${qs}` : ''), q.body ? JSON.parse(q.body) : undefined);
    const text = await r.text();
    if (r.status !== 200) return { status: r.status, body: text };
    return { status: 200, body: JSON.stringify(edit(q, JSON.parse(text), edits)) };
  };
  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    try {
      if (url.pathname === '/') { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(html); }
      else if (/^\/ui\/(page|panel|status)\/(index\.html|main\.js)$/.test(url.pathname)) { res.setHeader('content-type', url.pathname.endsWith('.js') ? 'text/javascript' : 'text/html'); res.end(readFileSync(`.${url.pathname}`)); }
      else if (url.pathname === '/service' && req.method === 'POST') {
        let body = ''; for await (const part of req) body += part;
        const { request, edits } = JSON.parse(body);
        res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(await relay(request, edits)));
      } else { res.statusCode = url.pathname === '/favicon.ico' ? 204 : 404; res.end(); }
    } catch { res.statusCode = 500; res.end('{"error":"fixture-failed"}'); }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const revision = (plan = 'P-attention') => f.store.get(f.source.id, plan)!.revision;
  /** Fixture-side production writes by M (default), the assigned child C, or a relay. */
  const report = (r: Partial<Request>, as: 'M' | 'C' = 'M') => { f.apply(r, as === 'C' ? f.child : f.actor); return revision(r.plan ?? 'P-attention'); };
  /** "Another client": a confirmed cleanup action through the real service. */
  async function cleanupElsewhere(action: 'archive' | 'restore' | 'delete', plan: string) {
    const r = await f.request(`/v1/plan/${action}`, { ...f.body(plan), ...(action === 'delete' ? { confirmed: true } : {}) });
    if (!r.ok) throw new Error(`fixture ${action} failed (${r.status})`);
  }
  return {
    port: (server.address() as { port: number }).port, built,
    revision, report, cleanupElsewhere,
    /** New active plan owned by M (synthetic, production start write). */
    start: (plan: string, title: string, items: BlockerItemInput[]) => report({ op: 'start', plan, title, items }),
    setCapture: (enabled: boolean) => f.store.setEnabled(enabled),
    exists: (plan: string) => !!f.store.get(f.source.id, plan),
    archived: (plan: string) => f.store.detail(f.source.id, plan).plan.cleanup?.state === 'archived',
    async stop() { server.close(); server.closeAllConnections(); await f.stop(); },
  };
}
