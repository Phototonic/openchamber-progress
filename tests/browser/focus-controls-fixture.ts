// Synthetic SDK host for focus-control QA: current guest bundles in three same-origin frames, a
// scripted v2 service and workspace streams. NOT native-host, relay or real-service proof.
// Serve from the repository root. Standalone: node --experimental-strip-types tests/browser/focus-controls-fixture.ts [port]
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { at, HEALTH, setupRead } from './fixtures.ts';
import {
  CLOSED_ITEMS, RELAY_PARENT_CONTRIBUTIONS, RELAY_PARENT_ITEMS, CORE_CONTRIBUTIONS, CORE_ITEMS, CORE_LINKS, DIRECTORY, FINISHED_ITEMS, FOREIGN, GROUP_ONLY_ITEMS, SV, focusEnvelope, focusSummary, MANY_ITEMS, SCALE_LINKS, scaleContributions, scaleItems, SOURCE,
} from './focus-controls-fixtures.ts';

const record = (summary: ReturnType<typeof focusSummary>, items: unknown[], contributions: unknown[] = [], links: unknown[] = []) => ({ summary, items, contributions, links });
const SCALE = scaleItems();
const FAILED_ITEMS = CLOSED_ITEMS.map((i) => (i.id === 'C2' ? { ...i, status: 'blocked' as const } : i));
const PLANS = [
  record(focusSummary(), CORE_ITEMS, CORE_CONTRIBUTIONS, CORE_LINKS),
  record(focusSummary(MANY_ITEMS, { id: 'P-many', title: 'Many tasks in progress', sessionId: 'M', reportedAt: at(10) }), MANY_ITEMS),
  record(focusSummary(SCALE, { id: 'P-scale', title: 'One thousand items', sessionId: 'S', reportedAt: at(20) }), SCALE, scaleContributions(), SCALE_LINKS),
  // Same plan, item and session IDs from another, unverified source.
  record(focusSummary(CORE_ITEMS, { sourceId: FOREIGN, title: 'Other setup focus plan', reportedAt: at(30) }), CORE_ITEMS.map((i) => ({ ...i, title: `Other setup · ${i.id}` })), CORE_CONTRIBUTIONS),
  // Closed lifecycles, an empty plan and a group-only plan (owner V, not a live session).
  record(focusSummary(CLOSED_ITEMS, { id: 'P-closed', title: 'Cancelled plan — überprüfen 日本語 with a long title that wraps', sessionId: SV, lifecycle: 'cancelled', reportedAt: at(40) }), CLOSED_ITEMS),
  record(focusSummary(FINISHED_ITEMS, { id: 'P-finished', title: 'Finished plan', sessionId: SV, lifecycle: 'finished', reportedAt: at(41) }), FINISHED_ITEMS),
  record(focusSummary(FAILED_ITEMS, { id: 'P-failed', title: 'Failed plan', sessionId: SV, lifecycle: 'failed', reportedAt: at(42) }), FAILED_ITEMS),
  record(focusSummary([], { id: 'P-empty', title: 'Empty plan', sessionId: SV, reportedAt: at(43) }), []),
  record(focusSummary(GROUP_ONLY_ITEMS, { id: 'P-groups', title: 'Group-only plan', sessionId: SV, reportedAt: at(44) }), GROUP_ONLY_ITEMS),
  // A relayed report on a task-parent, in the bound source and as a same-ID plan of another source.
  record(focusSummary(RELAY_PARENT_ITEMS, { id: 'P-relay', title: 'Relay on a task-parent', sessionId: SV, reportedAt: at(45) }), RELAY_PARENT_ITEMS, RELAY_PARENT_CONTRIBUTIONS),
  record(focusSummary(RELAY_PARENT_ITEMS, { id: 'P-relay', sourceId: FOREIGN, title: 'Other setup relay plan', sessionId: SV, reportedAt: at(46) }), RELAY_PARENT_ITEMS, RELAY_PARENT_CONTRIBUTIONS),
];
const LIGHT = { mode: 'light', tokens: { background: '#fafafa', elevated: '#ffffff', foreground: '#202124', muted: '#64676e', subtle: '#74777e', border: '#dedfe3', hover: '#f0f1f3', selection: '#e7eefb', focus: '#376bc4', primary: '#316ac3', mutedSurface: '#f3f4f6', elevatedForeground: '#202124', active: '#e7e9ed', selectionForeground: '#173964', primaryForeground: '#ffffff', primaryText: '#24579e', successText: '#237044', warningText: '#855900', errorText: '#ad3030', infoText: '#24579e', success: '#27824d', warning: '#a66c00', error: '#c23d3d', info: '#316ac3', font: 'system-ui, sans-serif', mono: 'monospace', radius: '6px' } };
const DARK = { background: '#191b20', elevated: '#24272e', foreground: '#e6e8ee', muted: '#a4a9b4', subtle: '#9298a4', border: '#414650', hover: '#343944', selection: '#293d60', focus: '#90b8ff', primary: '#83aff7', mutedSurface: '#24272e', elevatedForeground: '#e6e8ee', active: '#3b4350', selectionForeground: '#e0ebff', primaryText: '#a6c7ff', successText: '#86dca3', warningText: '#e8c372', errorText: '#ff9e9e', infoText: '#a6c7ff', success: '#3fa66a', warning: '#c99a2e', error: '#e06c6c', info: '#5d8fe0' };

const script = `
const plans=${JSON.stringify(PLANS)},envBase=${JSON.stringify(focusEnvelope())},health=${JSON.stringify({ ...HEALTH, planCleanup: 1 })},setup=${JSON.stringify(setupRead())};
const light=${JSON.stringify(LIGHT)},dark=${JSON.stringify(DARK)},theme=JSON.parse(JSON.stringify(light));
const project={id:'proj-focus',name:'Focus project',directory:${JSON.stringify(DIRECTORY)}};
const live=[{id:'A',title:'Planner session'},{id:'B',title:'Review session'},{id:'M',title:'Many session'},{id:'S',title:'Scale session'}].map(s=>({...s,projectId:project.id,directory:project.directory,parentId:null,createdAt:1,updatedAt:2,archivedAt:null,worktree:null,activity:'idle',outcome:null,items:[]}));
const surfaces=['panel','status','page'],frame=s=>document.querySelector('iframe[data-surface="'+s+'"]');
const send=(s,m)=>frame(s).contentWindow.postMessage({channel:'openchamber.sdk',v:1,...m},'*');
window.frame=frame;window.send=send;
window.qa={railAll:false,account:'fixture',lag:{},subs:[],session:null,directory:project.directory,store:${JSON.stringify(focusEnvelope().storeId)},binding:${JSON.stringify(focusEnvelope().sourceBinding)},requests:[],messages:[],held:[],hold:null,fail:null,failList:false,plans};
const countItems=items=>{const t=items.filter(i=>i.kind==='task'),done=t.filter(i=>i.status==='done').length,skipped=t.filter(i=>i.status==='skipped').length;return{done,total:t.length-skipped,remaining:t.length-skipped-done,skipped}};
qa.plan=(id,source=${JSON.stringify(SOURCE)})=>plans.find(p=>p.summary.id===id&&p.summary.sourceId===source);
qa.update=(id,fn,source)=>{const p=qa.plan(id,source);fn(p);p.summary.revision++;p.summary.reportedAt=new Date().toISOString();p.summary.counts=countItems(p.items);p.summary.working=p.items.filter(i=>i.kind==='task'&&i.status==='working').map(i=>i.id);return p.summary.revision};
const ready=s=>send(s,{type:'ready',payload:{theme,locale:'en',surface:s,session:qa.session?{id:qa.session}:null,directory:qa.directory,connection:{account:qa.account,connected:true},settings:{},item:null}});
qa.context=(id,directory=project.directory)=>{qa.session=id;qa.directory=directory;for(const s of surfaces){ready(s);send(s,{type:'directory',payload:{directory}});send(s,{type:'session',payload:{session:id?{id}:null}});}};
qa.show=(s,width)=>{for(const n of document.querySelectorAll('section'))n.style.display=n.dataset.surface===s?'block':'none';const sec=document.querySelector('section[data-surface="'+s+'"]');sec.style.width=width+'px';frame(s).style.height=(s==='status'?Math.ceil(frame(s).contentDocument.querySelector('main')?.getBoundingClientRect().height||240):s==='page'?900:760)+'px';};
qa.theme=mode=>{theme.mode=mode;Object.assign(theme.tokens,mode==='dark'?dark:light.tokens);document.body.style.background=theme.tokens.background;document.body.style.color=theme.tokens.foreground;surfaces.forEach(ready)};
qa.pulse=n=>{for(const x of qa.subs)if(x.projectId===project.id)send(x.surface,{type:'workspace',payload:{subscriptionId:x.id,snapshot:{kind:'sessions',projectId:x.projectId,state:'ready',coverage:[],sessions:live.map(v=>v.id==='M'?{...v,activity:n%2?'running':'idle',updatedAt:2+n}:v)}}});return qa.subs.length};
qa.release=()=>{qa.hold=null;const held=qa.held.splice(0);held.forEach(x=>x.reply());return held.length};
const participants=p=>new Set([p.summary.sessionId,...p.items.map(i=>i.assigneeSessionId).filter(Boolean),...p.contributions.map(c=>c.attributedSessionId),...p.links.map(l=>l.sessionId)]);
const pageOf=(list,n)=>({data:list.slice(n*20,n*20+20),nextCursor:list.length>n*20+20?String(n+1):null});
const storage=new Map();
addEventListener('message',e=>{const f=[...document.querySelectorAll('iframe')].find(x=>x.contentWindow===e.source),m=e.data;if(!f||m.channel!=='openchamber.sdk')return;const s=f.dataset.surface;
 qa.messages.push({surface:s,type:m.type,op:m.payload?.op??null});
 const result=payload=>send(s,{type:'result',id:m.id,ok:true,payload});
 if(m.type==='hello')ready(s);
 else if(m.type==='storage'){const q=m.payload;if(q.op==='set')storage.set(q.key,q.value);if(q.op==='delete')storage.delete(q.key);result({storage:true,op:q.op,found:storage.has(q.key),value:storage.get(q.key)});}
 else if(m.type==='workspace-subscribe'){result();const q=m.payload.query;if(q.kind==='sessions')qa.subs.push({surface:s,id:m.payload.subscriptionId,projectId:q.projectId});send(s,{type:'workspace',payload:{subscriptionId:m.payload.subscriptionId,snapshot:q.kind==='projects'?{kind:'projects',state:'ready',projects:[project]}:q.kind==='worktrees'?{kind:'worktrees',projectId:q.projectId,state:'ready',worktrees:[]}:{kind:'sessions',projectId:q.projectId,state:'ready',coverage:[],sessions:q.projectId===project.id?live:[]}}})}
 else if(m.type==='service-request'){
  const q=m.payload,rec={surface:s,context:qa.session,method:q.method,path:q.path,query:q.query||null,at:performance.now()};qa.requests.push(rec);let body=null,status=200;const env=()=>({...envBase,storeId:qa.store,sourceBinding:qa.binding});
  if(q.path==='/health')body=health;
  else if(q.path==='/v1/setup')body=setup;
  else if(q.path==='/v1/plans'){
   if(qa.failList&&s!=='status'){status=503;body={error:'busy'}}
   else{const sid=q.query?.session;const rows=plans.filter(p=>q.query?.archived!=='only').filter(p=>sid?participants(p).has(sid)&&(s==='page'||qa.railAll||p.summary.sourceId===${JSON.stringify(SOURCE)}):true).map(p=>qa.lag[p.summary.id]&&p.summary.sourceId===${JSON.stringify(SOURCE)}?qa.lag[p.summary.id]:p.summary);body={...env(),data:rows,nextCursor:null};}
  }
  // Detail pages are built when the reply is sent, so a held page reflects the plan at release.
  const detail=()=>{const p=qa.plan(q.query?.plan,q.query?.source);if(!p)return;const n=Number(q.query?.cursor??0);
   const fail=qa.fail&&(!qa.fail.cursor||n>0)&&(!qa.fail.plan||qa.fail.plan===p.summary.id);
   if(fail){status=503;body={error:qa.fail.error||'busy'}}
   else{body={...env(),plan:p.summary,links:p.links,items:pageOf(p.items,n),contributions:pageOf(p.contributions,n)};rec.revision=p.summary.revision;}};
  // eager: build a held page at request time instead (a superseded reply keeps its older revision).
  let built=false,text='',code=200;const build=()=>{if(!built){built=true;if(q.path==='/v1/plan')detail();text=JSON.stringify(body||{error:'not-found'});code=body?status:404;}};
  const reply=()=>{build();result({status:code,body:text});};
  const h=qa.hold;if(h&&(!h.surface||h.surface===s)&&h.path===q.path&&(h.cursor===undefined||Boolean(q.query?.cursor)===h.cursor)&&(!h.plan||q.query?.plan===h.plan)){if(h.eager)build();qa.held.push({surface:s,path:q.path,query:q.query||null,reply});if(h.once)qa.hold=null;}else reply();
 }else{if(m.type==='resize'&&s==='status'&&m.payload.height>0)f.style.height=m.payload.height+'px';if(m.id)result();}
});`;

export function startFocusFixture(port = 0): Promise<{ server: Server; port: number }> {
  const server = createServer((req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
    if (pathname === '/') {
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.end(`<!doctype html><html><head><meta charset="utf-8"><title>Focus controls fixture</title><style>body{margin:0;background:#fafafa;color:#202124;font:14px system-ui}section{margin:16px;width:360px}h1{font-size:14px;margin:0 0 10px}iframe{width:100%;height:760px;border:0;display:block}section:not([data-surface=panel]){display:none}</style></head><body><script>${script}</script>${['panel', 'status', 'page'].map((s) => `<section data-surface="${s}"><h1>Agent progress · ${s}</h1><iframe data-surface="${s}" title="${s}" src="/ui/${s}/index.html"></iframe></section>`).join('')}</body></html>`);
    } else if (/^\/ui\/(panel|status|page)\/(index\.html|main\.js)$/.test(pathname)) {
      res.setHeader('content-type', pathname.endsWith('.js') ? 'text/javascript' : 'text/html'); res.end(readFileSync(`.${pathname}`));
    } else { res.statusCode = pathname === '/favicon.ico' ? 204 : 404; res.end(); }
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ server, port: (server.address() as { port: number }).port })));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { server, port } = await startFocusFixture(Number(process.argv[2] ?? 0));
  console.log(`Synthetic focus-controls fixture ready on loopback port ${port}`);
  process.on('SIGTERM', () => { server.close(); server.closeAllConnections(); });
}
