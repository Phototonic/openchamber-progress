// Preview-summary QA host bridge: current guest bundles in a synthetic SDK shell, relayed to a real
// built HTTP service over a disposable SQLite store (cleanup-fixture pattern). The bearer stays in
// this process; guests only ever receive { status, body }. Hold/fault controls are QA seams in the
// shell page, never shipped in a guest or service bundle. NOT native-host or relay proof.
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import type { GuestRequest, GuestRequestResult } from '@openchamber/sdk';
import { launchCleanupService } from '../fixtures/cleanup-service.ts';
import { pagedSummaryItems, SUMMARY_ITEMS } from '../fixtures/preview-summaries.ts';
import { readDetail, type DetailResult } from '../../ui/shared/source.ts';
import { formatHandoff, formatProgressUpdate, formatSummaryOnly } from '../../ui/shared/summary.ts';

export const SOURCE = 'source-fixture';
export const PLANS = {
  summary: { id: 'P-summary', session: 'session-example' },
  paged: { id: 'P-paged', session: 'session-paged' },
  race: { id: 'P-race', session: 'session-race' },
  archive: { id: 'P-archive', session: 'session-archive' },
  remove: { id: 'P-delete', session: 'session-delete' },
} as const;

const LIGHT = { mode: 'light', tokens: { background: '#fafafa', elevated: '#ffffff', foreground: '#202124', muted: '#64676e', subtle: '#74777e', border: '#dedfe3', hover: '#f0f1f3', selection: '#e7eefb', focus: '#376bc4', primary: '#316ac3', mutedSurface: '#f3f4f6', elevatedForeground: '#202124', active: '#e7e9ed', selectionForeground: '#173964', primaryForeground: '#ffffff', primaryText: '#24579e', successText: '#237044', warningText: '#855900', errorText: '#ad3030', infoText: '#24579e', success: '#27824d', warning: '#a66c00', error: '#c23d3d', info: '#316ac3', font: 'system-ui, sans-serif', mono: 'monospace', radius: '6px' } };
const DARK = { background: '#191b20', elevated: '#24272e', foreground: '#e6e8ee', muted: '#a4a9b4', subtle: '#9298a4', border: '#414650', hover: '#343944', selection: '#293d60', focus: '#90b8ff', primary: '#83aff7', mutedSurface: '#24272e', elevatedForeground: '#e6e8ee', active: '#3b4350', selectionForeground: '#e0ebff', primaryText: '#a6c7ff', successText: '#86dca3', warningText: '#e8c372', errorText: '#ff9e9e', infoText: '#a6c7ff', success: '#6fc58c', warning: '#d9b367', error: '#ee8989', info: '#83aff7' };

// qa.holds: [{tag,surface,path,plan,cursor,before}] — `before` holds the request itself (released
// requests reach the service afterwards); otherwise the actual reply is held. qa.faults: sticky
// synthetic replies [{surface,path,plan,cursor,status,error}] for deterministic fault injection.
const script = `
const light=${JSON.stringify(LIGHT)},dark=${JSON.stringify(DARK)},theme=JSON.parse(JSON.stringify(light)),storage=new Map();
const surfaces=['panel','status','page'],frame=s=>document.querySelector('iframe[data-surface="'+s+'"]');
const send=(s,m)=>frame(s).contentWindow.postMessage({channel:'openchamber.sdk',v:1,...m},'*');
window.frame=frame;
window.qa={session:null,holds:[],held:[],faults:[],requests:[],messages:[],errors:[],flight:0};
const ready=s=>send(s,{type:'ready',payload:{theme,locale:'en',directory:'/fixture/Alpha',session:qa.session?{id:qa.session,title:'Example session',busy:false}:null,surface:s,connection:{connected:true,account:'fixture'},settings:{},item:null}});
qa.context=id=>{qa.session=id;for(const s of surfaces)send(s,{type:'session',payload:{session:id?{id,title:'Example session',busy:false}:null}})};
qa.show=(s,width)=>{for(const n of document.querySelectorAll('section[data-surface]'))n.style.display=n.dataset.surface===s?'block':'none';document.querySelector('section[data-surface="'+s+'"]').style.width=width+'px';frame(s).style.height=(s==='status'?Math.ceil(frame(s).contentDocument.querySelector('main')?.getBoundingClientRect().height||240):s==='page'?900:820)+'px'};
qa.theme=mode=>{theme.mode=mode;Object.assign(theme.tokens,mode==='dark'?dark:light.tokens);document.documentElement.style.background=theme.tokens.background;document.body.style.background=theme.tokens.background;document.body.style.color=theme.tokens.foreground;surfaces.forEach(ready)};
qa.release=tag=>{const out=qa.held.filter(h=>!tag||h.tag===tag);qa.held=qa.held.filter(h=>!out.includes(h));qa.holds=qa.holds.filter(h=>tag&&h.tag!==tag);out.forEach(h=>h.go());return out.length};
const matches=(h,s,q)=>(!h.surface||h.surface===s)&&h.path===q.path&&(h.plan===undefined||q.query?.plan===h.plan)&&(h.cursor===undefined||Boolean(q.query?.cursor)===h.cursor);
addEventListener('message',async e=>{
 const f=[...document.querySelectorAll('iframe')].find(f=>f.contentWindow===e.source),m=e.data;if(!f||m.channel!=='openchamber.sdk')return;const s=f.dataset.surface;
 qa.messages.push({surface:s,type:m.type});
 const result=payload=>send(s,{type:'result',id:m.id,ok:true,payload});
 if(m.type==='hello')ready(s);
 else if(m.type==='workspace-subscribe'){result();const q=m.payload.query;send(s,{type:'workspace',payload:{subscriptionId:m.payload.subscriptionId,snapshot:q.kind==='projects'?{kind:'projects',state:'ready',projects:[]}:{kind:q.kind,state:'ready',projectId:q.projectId,sessions:[],worktrees:[],coverage:[]}}})}
 else if(m.type==='workspace-unsubscribe')result();
 else if(m.type==='storage'){const q=m.payload;if(q.op==='set')storage.set(q.key,q.value);if(q.op==='delete')storage.delete(q.key);result({storage:true,op:q.op,found:storage.has(q.key),value:storage.get(q.key)})}
 else if(m.type==='service-request'){
  const q=m.payload;qa.requests.push({surface:s,method:q.method,path:q.path,query:q.query||null});
  const fault=qa.faults.find(x=>matches(x,s,q));
  // qa.flight: forwarded requests still awaiting the service, so a test can wait for quiescence.
  const forward=async()=>{if(fault)return {status:fault.status,body:JSON.stringify({error:fault.error})};qa.flight++;try{const r=await fetch('/service',{method:'POST',body:JSON.stringify(q)});if(!r.ok)throw new Error('proxy');return await r.json()}finally{qa.flight--}};
  const deliver=p=>p.then(result,()=>{qa.errors.push('fixture proxy failed');send(s,{type:'result',id:m.id,ok:false,code:'HOST_UNAVAILABLE',error:'Fixture proxy unavailable'})});
  const hold=qa.holds.find(h=>matches(h,s,q));
  if(hold&&hold.before)qa.held.push({tag:hold.tag,surface:s,path:q.path,go:()=>deliver(forward())});
  else if(hold){const reply=forward();qa.held.push({tag:hold.tag,surface:s,path:q.path,go:()=>deliver(reply)})}
  else deliver(forward());
 }else{if(m.type==='resize'&&s==='status'&&m.payload.height>0)f.style.height=m.payload.height+'px';if(m.id)result()}
});
`;

const html = `<!doctype html><html><head><meta charset="utf-8"><title>Preview summaries QA</title><style>html,body{margin:0;background:#fafafa;color:#202124;font:14px system-ui}section{margin:16px;width:360px;display:none}h1{font-size:14px;margin:0 0 10px}iframe{display:block;width:100%;height:820px;border:0}</style></head><body><script>${script}</script>${['panel', 'status', 'page'].map((s) => `<section data-surface="${s}"><h1>Agent progress · ${s}</h1><iframe data-surface="${s}" title="${s}" src="/ui/${s}/index.html"></iframe></section>`).join('')}</body></html>`;

/** Synthetic, public-safe plans seeded through ordinary bounded store operations. */
function seed(f: Awaited<ReturnType<typeof launchCleanupService>>) {
  const as = (session: string) => ({ ...f.actor, sessionId: session });
  let oid = 0;
  const next = () => `qa-${++oid}`;
  // F5 deletion: finished, 21 tasks so detail needs a continuation page.
  const done21 = pagedSummaryItems(21).map((i) => ({ ...i, status: 'done' as const }));
  f.store.apply({ op: 'start', plan: PLANS.remove.id, rev: 0, oid: next(), title: 'Retired export batch', items: done21 }, as(PLANS.remove.session));
  f.store.apply({ op: 'finish', plan: PLANS.remove.id, rev: 1, oid: next(), outcome: 'finished' }, as(PLANS.remove.session));
  // F5 archive/restore and cleanup-revision race: finished, single page.
  f.store.apply({ op: 'start', plan: PLANS.archive.id, rev: 0, oid: next(), title: 'Completed export example', items: [{ id: 'a', title: 'Draft export notes', kind: 'task', status: 'done' }, { id: 'b', title: 'Publish export notes', kind: 'task', status: 'done' }] }, as(PLANS.archive.session));
  f.store.apply({ op: 'finish', plan: PLANS.archive.id, rev: 1, oid: next(), outcome: 'finished' }, as(PLANS.archive.session));
  // F2/F4: 21 tasks, 41 recorded reports; the first task's prerequisite is on the later item page.
  f.store.apply({ op: 'start', plan: PLANS.paged.id, rev: 0, oid: next(), title: 'Paged export checks', items: pagedSummaryItems(21) }, as(PLANS.paged.session));
  for (let n = 1; n <= 40; n++) f.store.apply({ op: 'change', plan: PLANS.paged.id, rev: n, oid: next(), changes: [{ id: 'task-1', status: n % 2 ? 'working' : 'pending' }] }, as(PLANS.paged.session));
  // F5 progress-revision race: active, single page.
  f.store.apply({ op: 'start', plan: PLANS.race.id, rev: 0, oid: next(), title: 'Revision race example', items: [{ id: 'r1', title: 'First race task', kind: 'task', status: 'working' }, { id: 'r2', title: 'Second race task', kind: 'task', status: 'pending' }] }, as(PLANS.race.session));
  // F1 last (most recent): bound capture, 5 direct (start, link, 3 changes) + 2 parent-relay reports.
  const m = as(PLANS.summary.session);
  const child = { ...m, sessionId: 'session-relay', agent: 'general', parentId: PLANS.summary.session, ancestry: [PLANS.summary.session] };
  const items = SUMMARY_ITEMS.map(({ id, title, kind, status, dependencies }) => ({ id, title, kind, ...(kind === 'task' ? { status } : {}), ...(dependencies ? { dependencies } : {}) }));
  let rev = 0;
  f.store.apply({ op: 'start', plan: PLANS.summary.id, rev: rev++, oid: next(), title: 'Add export flow', source: f.documentPath, items }, m, f.capture());
  f.store.apply({ op: 'link', plan: PLANS.summary.id, rev: rev++, oid: next(), child: child.sessionId, assign: ['working'] }, m, f.capture(), child);
  for (let n = 0; n < 3; n++) f.store.apply({ op: 'change', plan: PLANS.summary.id, rev: rev++, oid: next(), changes: [{ id: 'review', status: 'pending' }] }, m, f.capture());
  for (let n = 0; n < 2; n++) f.store.apply({ op: 'change', plan: PLANS.summary.id, rev: rev++, oid: next(), attributed: child.sessionId, changes: [{ id: 'working', status: 'working' }] }, m, f.capture(), child);
  return next;
}

export type Fault = { cursor: boolean; status: number; error: string };

export async function startPreviewFixture() {
  const f = await launchCleanupService(true, false);
  const next = seed(f);
  /** Fixture-initiated service mutations, counted separately from guest requests. */
  let setupMutations = 0;
  const relay = async (q: GuestRequest): Promise<GuestRequestResult> => {
    // Official-main discovery is unrelated and must not contact the network.
    if (q.path === '/v1/extension-update') return { status: 404, body: '{"error":"not-found"}' };
    const query = new URLSearchParams(q.query ?? {}).toString();
    const reply = await f.request(q.path + (query ? '?' + query : ''), q.body ? JSON.parse(q.body) : undefined);
    return { status: reply.status, body: await reply.text() };
  };
  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    try {
      if (url.pathname === '/') { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(html); }
      else if (/^\/ui\/(page|panel|status)\/(index\.html|main\.js)$/.test(url.pathname)) {
        res.setHeader('content-type', url.pathname.endsWith('.js') ? 'text/javascript' : 'text/html'); res.end(readFileSync(`.${url.pathname}`));
      } else if (url.pathname === '/service' && req.method === 'POST') {
        let body = ''; for await (const part of req) body += part;
        res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(await relay(JSON.parse(body))));
      } else { res.statusCode = url.pathname === '/favicon.ico' ? 204 : 404; res.end(); }
    } catch { res.statusCode = 500; res.end('{"error":"fixture-failed"}'); }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as { port: number }).port;

  /** Formatter output over an actual authenticated read (optionally with the same synthetic fault). */
  async function read(plan: string, fault?: Fault): Promise<DetailResult> {
    return readDetail({ serviceRequest: (q) => fault && Boolean(q.query?.cursor) === fault.cursor ? Promise.resolve({ status: fault.status, body: JSON.stringify({ error: fault.error }) }) : relay(q) }, { sourceId: SOURCE, id: plan });
  }
  async function expected(plan: string, mode: 'progress' | 'handoff') {
    const r = await read(plan);
    if (!r.ok) throw new Error(`expected read failed for ${plan}`);
    return mode === 'progress' ? formatProgressUpdate(r) : formatHandoff(r);
  }
  async function expectedSummaryOnly(plan: string, fault: Fault) {
    const r = await read(plan, fault);
    if (r.ok || !r.snapshot) throw new Error('expected a failed read with a first-page snapshot');
    return formatSummaryOnly(r.snapshot, r.cause);
  }
  const plan = (id: string) => f.store.detail(SOURCE, id).plan;
  async function cleanup(action: 'archive' | 'restore' | 'delete', id: string) {
    const p = plan(id);
    const r = await f.request(`/v1/plan/${action}`, { storeId: f.body().storeId, source: SOURCE, plan: id, rev: p.revision, cleanupRev: p.cleanup?.revision ?? 0, oid: next(), ...(action === 'delete' ? { confirmed: true } : {}) });
    setupMutations++;
    if (!r.ok) throw new Error(`fixture ${action} failed (${r.status})`);
  }
  return {
    port, expected, expectedSummaryOnly,
    revision: (id: string) => plan(id).revision,
    cleanupState: (id: string) => plan(id).cleanup ?? null,
    exists: (id: string) => !!f.store.get(SOURCE, id),
    setupMutations: () => setupMutations,
    /** A real recorded report by the plan's own session: progress revision only. */
    advance(id: keyof typeof PLANS) {
      const p = PLANS[id], detail = f.store.detail(SOURCE, p.id);
      const task = detail.items.data.find((i) => i.kind === 'task' && i.status !== 'done')!;
      f.store.apply({ op: 'change', plan: p.id, rev: detail.plan.revision, oid: next(), changes: [{ id: task.id, status: task.status }] }, { ...f.actor, sessionId: p.session });
      setupMutations++;
    },
    /** Archive then restore through the real service: cleanup revision moves, progress revision does not. */
    async bounce(id: string) { await cleanup('archive', id); await cleanup('restore', id); },
    remove: (id: string) => cleanup('delete', id),
    async stop() { server.close(); server.closeAllConnections(); await f.stop(); },
  };
}
