// Synthetic SDK host for readiness QA: current guest bundles in three same-origin frames, a
// scripted v2 service and workspace streams. NOT native-host, relay or real-service proof.
// Serve from the repository root. Standalone: node --experimental-strip-types tests/browser/ready-tasks-fixture.ts [port]
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { HEALTH, setupRead } from './fixtures.ts';
import { boundaryItems, DIRECTORY, FOREIGN, FOREIGN_ITEMS, READY_CONTRIBUTIONS, READY_ITEMS, READY_LINKS, readyEnvelope, readySummary, SAME_ID_ITEMS, SOURCE } from './ready-tasks-fixtures.ts';

const record = (summary: ReturnType<typeof readySummary>, items: unknown[], contributions: unknown[] = [], links: unknown[] = []) => ({ summary, items, contributions, links });
const PLANS = [
  record(readySummary(), READY_ITEMS, READY_CONTRIBUTIONS, READY_LINKS),
  record(readySummary(SAME_ID_ITEMS, { id: 'P-same', title: 'Same item IDs, other plan', sessionId: 'B', reportedAt: new Date(Date.now() - 600_000).toISOString() }), SAME_ID_ITEMS),
  record(readySummary(FOREIGN_ITEMS, { sourceId: FOREIGN, title: 'Foreign setup plan', revision: 3 }), FOREIGN_ITEMS),
  record(readySummary(boundaryItems(21), { id: 'P-boundary', title: 'Twenty-one task plan', sessionId: 'E', reportedAt: new Date(Date.now() - 1_200_000).toISOString() }), boundaryItems(21)),
];
const LIGHT = { mode: 'light', tokens: { background: '#fafafa', elevated: '#ffffff', foreground: '#202124', muted: '#64676e', subtle: '#74777e', border: '#dedfe3', hover: '#f0f1f3', selection: '#e7eefb', focus: '#376bc4', primary: '#316ac3', mutedSurface: '#f3f4f6', elevatedForeground: '#202124', active: '#e7e9ed', selectionForeground: '#173964', primaryForeground: '#ffffff', primaryText: '#24579e', successText: '#237044', warningText: '#855900', errorText: '#ad3030', infoText: '#24579e', success: '#27824d', warning: '#a66c00', error: '#c23d3d', info: '#316ac3', font: 'system-ui, sans-serif', mono: 'monospace', radius: '6px' } };
const DARK = { background: '#191b20', elevated: '#24272e', foreground: '#e6e8ee', muted: '#a4a9b4', subtle: '#9298a4', border: '#414650', hover: '#343944', selection: '#293d60', focus: '#90b8ff', primary: '#83aff7', mutedSurface: '#24272e', elevatedForeground: '#e6e8ee', active: '#3b4350', selectionForeground: '#e0ebff', primaryText: '#a6c7ff', successText: '#86dca3', warningText: '#e8c372', errorText: '#ff9e9e', infoText: '#a6c7ff', success: '#3fa66a', warning: '#c99a2e', error: '#e06c6c', info: '#5d8fe0' };

const script = `
const plans=${JSON.stringify(PLANS)},envBase=${JSON.stringify(readyEnvelope())},health=${JSON.stringify({ ...HEALTH, planCleanup: 1 })},setup=${JSON.stringify(setupRead())};
const light=${JSON.stringify(LIGHT)},dark=${JSON.stringify(DARK)},theme=JSON.parse(JSON.stringify(light));
const project={id:'proj-ready',name:'Ready project',directory:${JSON.stringify(DIRECTORY)}};
const live=[{id:'A',title:'Planner session'},{id:'B',title:'Review session'}].map(s=>({...s,projectId:project.id,directory:project.directory,parentId:null,createdAt:1,updatedAt:2,archivedAt:null,worktree:null,activity:'idle',outcome:null,items:[]}));
const surfaces=['panel','status','page'],frame=s=>document.querySelector('iframe[data-surface="'+s+'"]');
const send=(s,m)=>frame(s).contentWindow.postMessage({channel:'openchamber.sdk',v:1,...m},'*');
window.frame=frame;window.send=send;
window.qa={session:null,store:${JSON.stringify(readyEnvelope().storeId)},binding:${JSON.stringify(readyEnvelope().sourceBinding)},requests:[],messages:[],held:[],hold:null,fail:null,failList:false,corrupt:false,plans};
const countItems=items=>{const t=items.filter(i=>i.kind==='task'),done=t.filter(i=>i.status==='done').length,skipped=t.filter(i=>i.status==='skipped').length;return{done,total:t.length-skipped,remaining:t.length-skipped-done,skipped}};
qa.plan=(id,source=${JSON.stringify(SOURCE)})=>plans.find(p=>p.summary.id===id&&p.summary.sourceId===source);
qa.update=(id,fn,source)=>{const p=qa.plan(id,source);fn(p);p.summary.revision++;p.summary.reportedAt=new Date().toISOString();p.summary.counts=countItems(p.items);p.summary.working=p.items.filter(i=>i.kind==='task'&&i.status==='working').map(i=>i.id);return p.summary.revision};
const ready=s=>send(s,{type:'ready',payload:{theme,locale:'en',surface:s,session:qa.session?{id:qa.session}:null,directory:project.directory,connection:{account:'fixture',connected:true},settings:{},item:null}});
qa.context=id=>{qa.session=id;for(const s of surfaces){ready(s);send(s,{type:'directory',payload:{directory:project.directory}});send(s,{type:'session',payload:{session:id?{id}:null}});}};
qa.show=(s,width)=>{for(const n of document.querySelectorAll('section'))n.style.display=n.dataset.surface===s?'block':'none';const sec=document.querySelector('section[data-surface="'+s+'"]');sec.style.width=width+'px';frame(s).style.height=(s==='status'?Math.ceil(frame(s).contentDocument.querySelector('main')?.getBoundingClientRect().height||240):s==='page'?900:760)+'px';};
qa.theme=mode=>{theme.mode=mode;Object.assign(theme.tokens,mode==='dark'?dark:light.tokens);document.body.style.background=theme.tokens.background;document.body.style.color=theme.tokens.foreground;surfaces.forEach(ready)};
qa.release=()=>{qa.hold=null;const held=qa.held.splice(0);held.forEach(x=>x.reply());return held.length};
const participants=p=>new Set([p.summary.sessionId,...p.items.map(i=>i.assigneeSessionId).filter(Boolean),...p.contributions.map(c=>c.attributedSessionId),...p.links.map(l=>l.sessionId)]);
const pageOf=(list,n)=>({data:list.slice(n*20,n*20+20),nextCursor:list.length>n*20+20?String(n+1):null});
const storage=new Map();
addEventListener('message',e=>{const f=[...document.querySelectorAll('iframe')].find(x=>x.contentWindow===e.source),m=e.data;if(!f||m.channel!=='openchamber.sdk')return;const s=f.dataset.surface;
 qa.messages.push({surface:s,type:m.type});
 const result=payload=>send(s,{type:'result',id:m.id,ok:true,payload});
 if(m.type==='hello')ready(s);
 else if(m.type==='storage'){const q=m.payload;if(q.op==='set')storage.set(q.key,q.value);if(q.op==='delete')storage.delete(q.key);result({storage:true,op:q.op,found:storage.has(q.key),value:storage.get(q.key)});}
 else if(m.type==='workspace-subscribe'){result();const q=m.payload.query;send(s,{type:'workspace',payload:{subscriptionId:m.payload.subscriptionId,snapshot:q.kind==='projects'?{kind:'projects',state:'ready',projects:[project]}:q.kind==='worktrees'?{kind:'worktrees',projectId:q.projectId,state:'ready',worktrees:[]}:{kind:'sessions',projectId:q.projectId,state:'ready',coverage:[],sessions:q.projectId===project.id?live:[]}}})}
 else if(m.type==='service-request'){
  const q=m.payload;qa.requests.push({surface:s,context:qa.session,method:q.method,path:q.path,query:q.query||null});let body=null,status=200;const env={...envBase,storeId:qa.store,sourceBinding:qa.binding};
  if(q.path==='/health')body=health;
  else if(q.path==='/v1/setup')body=setup;
  else if(q.path==='/v1/plans'){
   if(qa.failList&&s!=='status'){status=503;body={error:'busy'}}
   else{const sid=q.query?.session;const rows=plans.filter(p=>q.query?.archived!=='only').filter(p=>sid?participants(p).has(sid)&&(s==='page'||p.summary.sourceId===${JSON.stringify(SOURCE)}):true).map(p=>p.summary);body={...env,data:rows,nextCursor:null};}
  }
  else if(q.path==='/v1/plan'){const p=qa.plan(q.query?.plan,q.query?.source);if(p){const n=Number(q.query?.cursor??0);
   const fail=qa.fail&&(!qa.fail.cursor||n>0)&&(!qa.fail.plan||qa.fail.plan===p.summary.id);
   if(fail){status=503;body={error:qa.fail.error||'busy'}}
   else{const items=pageOf(p.items,n);if(qa.corrupt&&items.data.length)items.data=items.data.map((i,k)=>k===0?{...i,dependencies:[42]}:i);body={...env,plan:p.summary,links:p.links,items,contributions:pageOf(p.contributions,n)};}}}
  const reply=()=>result({status:body?status:404,body:JSON.stringify(body||{error:'not-found'})});
  const h=qa.hold;if(h&&(!h.surface||h.surface===s)&&h.path===q.path&&(h.cursor===undefined||Boolean(q.query?.cursor)===h.cursor)&&(!h.plan||q.query?.plan===h.plan))qa.held.push({surface:s,path:q.path,query:q.query||null,reply});else reply();
 }else{if(m.type==='resize'&&s==='status'&&m.payload.height>0)f.style.height=m.payload.height+'px';if(m.id)result();}
});`;

export function startReadyFixture(port = 0): Promise<{ server: Server; port: number }> {
  const server = createServer((req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
    if (pathname === '/') {
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.end(`<!doctype html><html><head><meta charset="utf-8"><title>Readiness fixture</title><style>body{margin:0;background:#fafafa;color:#202124;font:14px system-ui}section{margin:16px;width:360px}h1{font-size:14px;margin:0 0 10px}iframe{width:100%;height:760px;border:0;display:block}section:not([data-surface=panel]){display:none}</style></head><body><script>${script}</script>${['panel', 'status', 'page'].map((s) => `<section data-surface="${s}"><h1>Agent progress · ${s}</h1><iframe data-surface="${s}" title="${s}" src="/ui/${s}/index.html"></iframe></section>`).join('')}</body></html>`);
    } else if (/^\/ui\/(panel|status|page)\/(index\.html|main\.js)$/.test(pathname)) {
      res.setHeader('content-type', pathname.endsWith('.js') ? 'text/javascript' : 'text/html'); res.end(readFileSync(`.${pathname}`));
    } else { res.statusCode = pathname === '/favicon.ico' ? 204 : 404; res.end(); }
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ server, port: (server.address() as { port: number }).port })));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { server, port } = await startReadyFixture(Number(process.argv[2] ?? 0));
  console.log(`Synthetic readiness fixture ready on loopback port ${port}`);
  process.on('SIGTERM', () => { server.close(); server.closeAllConnections(); });
}
