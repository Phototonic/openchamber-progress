// Synthetic SDK postMessage host, adapted from the prior compact-selection QA.
// No live service, database, authentication or user session. Serve from repo root.
import { HEALTH, plansPage, setupRead, summary } from './fixtures.ts';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
const projects = ['a', 'b', 'c', 'd'].map((id) => ({ id, name: `Project ${id.toUpperCase()}`, directory: `/synthetic/${id}` }));
const items = (working: boolean) => [
  { id: 'prepare', title: 'Prepare the change', kind: 'task' as const, status: 'done' as const },
  { id: 'implement', title: working ? 'Implement the feature' : 'Review the result', kind: 'task' as const, status: working ? 'working' as const : 'pending' as const },
  { id: 'verify', title: 'Verify the result', kind: 'task' as const, status: 'pending' as const },
];
const plans = [
  summary('acceptance', items(false), { title: 'Acceptance plan', sessionId: 'session-a', directory: projects[0].directory, reportedAt: new Date(Date.now() - 60_000).toISOString() }),
  summary('execution', items(true), { title: 'Execution plan', sessionId: 'session-a', directory: projects[0].directory, reportedAt: new Date(Date.now() - 600_000).toISOString() }),
];
const extras = projects.slice(1).map((p, i) => summary(`extra-${i}`, i === 2 ? items(false).map((item) => ({ ...item, status: 'done' as const })) : items(false), { title: ['Documentation plan', 'Follow-up plan', 'Finished plan'][i], sessionId: `session-${p.id}`, directory: p.directory, lifecycle: i === 2 ? 'finished' : 'active', reportedAt: new Date(Date.now() - (i + 20) * 60_000).toISOString() }));
const data = { projects, plans, extras, items: [items(false), items(true)], health: HEALTH, setup: setupRead() };
const script = `
const data=${JSON.stringify(data)}, envelope=${JSON.stringify(plansPage([]))};
const subs=new Map();window.qa={detailRequests:[],listReads:0,scope:'session-a',expanded:false};
const env={channel:'openchamber.sdk',v:1},guest=()=>document.querySelector('iframe').contentWindow;
const send=m=>guest().postMessage({...env,...m},'*');
const theme={mode:'light',tokens:{background:'#fafafa',elevated:'#ffffff',foreground:'#202124',muted:'#64676e',subtle:'#74777e',border:'#dedfe3',hover:'#f0f1f3',selection:'#e7eefb',focus:'#376bc4',primary:'#316ac3',mutedSurface:'#f3f4f6',elevatedForeground:'#202124',active:'#e7e9ed',selectionForeground:'#173964',primaryForeground:'#ffffff',primaryText:'#24579e',successText:'#237044',warningText:'#855900',errorText:'#ad3030',infoText:'#24579e',success:'#27824d',warning:'#a66c00',error:'#c23d3d',info:'#316ac3',font:'system-ui, sans-serif',mono:'monospace',radius:'6px'}};
const ready=()=>send({type:'ready',payload:{theme,locale:'en',directory:data.projects[0].directory,session:{id:'session-a',title:'Feature session',busy:false},surface:'status',connection:{connected:true,account:'synthetic'},settings:{},item:null}});
const list=()=>qa.scope==='session-b'?[{...data.plans[1],id:'other',title:'Other session plan',sessionId:'session-b'}]:qa.expanded?[...data.plans,...data.extras]:data.plans;
const snap=q=>q.kind==='projects'?{kind:'projects',state:'ready',projects:data.projects}:q.kind==='worktrees'?{kind:'worktrees',projectId:q.projectId,state:'ready',worktrees:[]}:{kind:'sessions',projectId:q.projectId,state:'ready',coverage:[],sessions:list().filter(p=>p.directory==='/synthetic/'+q.projectId).map(p=>({id:p.sessionId,title:p.title,projectId:q.projectId,directory:p.directory,parentId:null,createdAt:1,updatedAt:2,archivedAt:null,worktree:null,activity:'idle',outcome:null,items:[]}))};
qa.report=()=>{data.plans[1].revision++;data.plans[1].reportedAt=new Date().toISOString();};
qa.context=id=>{qa.scope=id;send({type:'session',payload:{session:id?{id,title:'Feature session',busy:false}:null}});};
addEventListener('message',e=>{const m=e.data;if(e.source!==guest()||m.channel!==env.channel)return;
 const result=payload=>send({type:'result',id:m.id,ok:true,payload});
 if(m.type==='hello')ready();
 else if(m.type==='workspace-subscribe'){subs.set(m.payload.subscriptionId,m.payload.query);result();send({type:'workspace',payload:{subscriptionId:m.payload.subscriptionId,snapshot:snap(m.payload.query)}})}
 else if(m.type==='workspace-unsubscribe')subs.delete(m.payload.subscriptionId);
 else if(m.type==='service-request'){
  const q=m.payload;let body=null;
  if(q.path==='/health')body=data.health;
  if(q.path==='/v1/setup')body=data.setup;
  if(q.path==='/v1/extension-update')body={installedVersion:'0.2.7',state:'unknown',checkedAt:null,stale:false,diagnostic:'unavailable',nextCheckAt:new Date(Date.now()+3600000).toISOString()};
  if(q.path==='/v1/plans'){qa.listReads++;body={...envelope,data:list(),nextCursor:null};}
  if(q.path==='/v1/plan'){qa.detailRequests.push(q.query.plan);const p=list().find(p=>p.id===q.query.plan);if(p)body={...envelope,plan:p,items:{data:p.lifecycle==='finished'?data.items[0].map(i=>({...i,status:'done'})):p.working.length?data.items[1]:data.items[0],nextCursor:null},contributions:{data:[],nextCursor:null},links:[]};}
  result({status:body?200:404,body:JSON.stringify(body||{error:'not-found'})});
 }else if(m.type==='storage')result({storage:true,op:m.payload.op,found:false});
 else {if(m.type==='resize')document.querySelector('iframe').style.height=m.payload.height+'px';if(m.id)result()}
});
`;
const server = createServer((req, res) => {
  const path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
  if (path === '/') {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(`<!doctype html><html><head><meta charset="utf-8"><title>Work Status QA</title><style>html,body{margin:0;background:#fafafa;color:#202124;font:14px system-ui}section{width:320px;margin:24px}h1{font-size:14px;margin:0 0 12px}iframe{display:block;border:0;width:100%;height:320px}@media(max-width:500px){section{width:auto;margin:16px}}</style></head><body><section><h1>Work Status · Agent progress</h1><script>${script}</script><iframe src="/ui/status/index.html" title="Agent progress"></iframe></section></body></html>`);
  } else if (['/ui/status/index.html', '/ui/status/main.js'].includes(path)) {
    res.setHeader('content-type', path.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8');
    res.end(readFileSync(`.${path}`));
  } else { res.statusCode = path === '/favicon.ico' ? 204 : 404; res.end(); }
});
server.listen(47841, '127.0.0.1', () => console.log('Synthetic status fixture listening on loopback port 47841'));
process.on('SIGTERM', () => { server.close(); server.closeAllConnections(); });
