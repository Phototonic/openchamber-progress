// Synthetic SDK event-sequence fixture, NOT native-host or real service proof.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { HEALTH, envelope, summary, docRef, setupRead } from './fixtures.ts';

const items = [{ id: 'prepare', title: 'Prepare the change', kind: 'task' as const, status: 'done' as const }, { id: 'verify', title: 'Verify session isolation', kind: 'task' as const, status: 'working' as const }];
const rows = [
  summary('P-A', items, { sessionId: 'A', title: 'Session A implementation', document: docRef() }),
  summary('P-second', items.map(i => ({ ...i, status: 'done' })), { sessionId: 'A', title: 'Completed example', lifecycle: 'finished', document: docRef() }),
  summary('P-finished', items.map(i => ({ ...i, status: 'done' })), { sessionId: 'A', title: 'Archived example', lifecycle: 'finished', cleanup: { state: 'archived', revision: 1 }, document: docRef() }),
];
const theme = { mode: 'light', tokens: { background: '#fafafa', elevated: '#ffffff', foreground: '#202124', muted: '#64676e', subtle: '#74777e', border: '#dedfe3', hover: '#f0f1f3', selection: '#e7eefb', focus: '#376bc4', primary: '#316ac3', mutedSurface: '#f3f4f6', elevatedForeground: '#202124', active: '#e7e9ed', selectionForeground: '#173964', primaryForeground: '#ffffff', primaryText: '#24579e', successText: '#237044', warningText: '#855900', errorText: '#ad3030', infoText: '#24579e', success: '#27824d', warning: '#a66c00', error: '#c23d3d', info: '#316ac3', font: 'system-ui, sans-serif', mono: 'monospace', radius: '6px' } };
const script = `
const rows=${JSON.stringify(rows)},items=${JSON.stringify(items)},base=${JSON.stringify(envelope())},theme=${JSON.stringify(theme)};
const surfaces=['panel','status','page'],frame=s=>document.querySelector('iframe[data-surface="'+s+'"]');
const send=(s,m)=>frame(s).contentWindow.postMessage({channel:'openchamber.sdk',v:1,...m},'*');
window.qa={session:null,directory:'/fixture/Alpha',store:'store-1',requests:[],events:[],held:[],hold:null,holdStorage:false,failB:false,errors:[]};
const ready=s=>send(s,{type:'ready',payload:{theme,locale:'en',surface:s,session:qa.session?{id:qa.session}:null,directory:qa.directory,connection:{account:'fixture',connected:true},settings:{},item:null}});
qa.context=(id,directory='/fixture/Alpha',fullOnly=false)=>{qa.session=id;qa.directory=directory;for(const s of surfaces){ready(s);qa.events.push({surface:s,type:'ready',id});if(!fullOnly){send(s,{type:'directory',payload:{directory}});send(s,{type:'session',payload:{session:id?{id}:null}});}}};
qa.show=(s,width=360)=>{for(const n of document.querySelectorAll('section'))n.style.display=n.dataset.surface===s?'block':'none';document.querySelector('section[data-surface="'+s+'"]').style.width=width+'px';if(s==='status')frame(s).style.height=Math.ceil(frame(s).contentDocument.querySelector('main')?.getBoundingClientRect().height||240)+'px';};
qa.release=()=>{qa.hold=null;qa.holdStorage=false;const held=qa.held.splice(0);held.forEach(x=>x.reply());return held.length};
qa.dark=()=>{theme.mode='dark';Object.assign(theme.tokens,{background:'#191b20',elevated:'#24272e',foreground:'#e6e8ee',muted:'#a4a9b4',subtle:'#9298a4',border:'#414650',hover:'#343944',selection:'#293d60',focus:'#90b8ff',primary:'#83aff7',mutedSurface:'#24272e',elevatedForeground:'#e6e8ee',active:'#3b4350',selectionForeground:'#e0ebff',primaryText:'#a6c7ff',successText:'#86dca3',warningText:'#e8c372',errorText:'#ff9e9e',infoText:'#a6c7ff'});document.body.style.background='#191b20';document.body.style.color='#e6e8ee';surfaces.forEach(ready)};
const storage=new Map();
addEventListener('message',e=>{const f=[...document.querySelectorAll('iframe')].find(x=>x.contentWindow===e.source),m=e.data;if(!f||m.channel!=='openchamber.sdk')return;const s=f.dataset.surface;
 const result=payload=>send(s,{type:'result',id:m.id,ok:true,payload});
 if(m.type==='hello')ready(s);
 else if(m.type==='storage'){const q=m.payload;if(q.op==='set')storage.set(q.key,q.value);if(q.op==='delete')storage.delete(q.key);const reply=()=>result({storage:true,op:q.op,found:storage.has(q.key),value:storage.get(q.key)});if(qa.holdStorage&&s==='panel'&&q.op==='get'&&q.key==='rail-plan:A')qa.held.push({surface:s,path:'storage',reply:()=>result({storage:true,op:'get',found:true,value:'src-local/P-second'})});else reply();}
 else if(m.type==='workspace-subscribe'){result();const q=m.payload.query;send(s,{type:'workspace',payload:{subscriptionId:m.payload.subscriptionId,snapshot:q.kind==='projects'?{kind:'projects',state:'ready',projects:[]}:{kind:q.kind,state:'ready',projectId:q.projectId,sessions:[],worktrees:[],coverage:[]}}})}
 else if(m.type==='service-request'){
  const q=m.payload;qa.requests.push({surface:s,context:qa.session,...q});let body=null,status=200;const env={...base,storeId:qa.store};
  if(q.path==='/health')body=${JSON.stringify({ ...HEALTH, planCleanup: 1 })};
  else if(q.path==='/v1/setup')body=${JSON.stringify(setupRead())};
  else if(q.path==='/v1/plans'){if(qa.failB&&q.query?.session==='B'){status=503;body={error:'busy'}}else body={...env,data:rows.filter(p=>(q.query?.archived==='only')===(p.cleanup?.state==='archived')).filter(p=>!q.query?.session||q.query.session===p.sessionId||(q.query.session==='C'&&p.id==='P-A')),nextCursor:null};}
  else if(q.path==='/v1/plan'){const p=rows.find(p=>p.id===q.query?.plan);if(p)body={...env,plan:p,items:{data:items.map(i=>({...i,status:p.lifecycle==='finished'?'done':i.status})),nextCursor:null},contributions:{data:[{revision:1,reporterSessionId:'C',attributedSessionId:'C',mode:'direct',itemIds:['verify'],reportedAt:p.reportedAt}],nextCursor:null},links:[]};}
  else if(q.path==='/v1/document')body={...env,document:${JSON.stringify(docRef())},text:'# Session A plan\\n\\nRecorded example.',nextCursor:null};
  else if(q.path==='/v1/history')body={...env,data:[{revision:1,structuralRevision:1,lifecycle:'finished',reportedAt:rows[0].reportedAt}],nextCursor:null};
  const reply=()=>result({status:body?status:404,body:JSON.stringify(body||{error:'not-found'})});
  if(qa.hold&&qa.hold.surface===s&&(qa.hold.paths||[qa.hold.path]).includes(q.path)&&(!qa.hold.session||q.query?.session===qa.hold.session))qa.held.push({surface:s,path:q.path,reply});else reply();
 }else{if(m.type==='resize'&&s==='status'&&m.payload.height>0)f.style.height=m.payload.height+'px';if(m.id)result();}
});`;
const server = createServer((req, res) => {
  const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
  if (pathname === '/') {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(`<!doctype html><html><head><meta charset="utf-8"><title>Session progress fixture</title><style>body{margin:0;background:#fafafa;color:#202124;font:14px system-ui}section{margin:16px;width:360px}h1{font-size:14px;margin:0 0 10px}iframe{width:100%;height:680px;border:0;display:block}section:not([data-surface=panel]){display:none}</style></head><body><script>${script}</script>${['panel', 'status', 'page'].map(s => `<section data-surface="${s}"><h1>Agent progress · ${s}</h1><iframe data-surface="${s}" title="${s}" src="/ui/${s}/index.html"></iframe></section>`).join('')}</body></html>`);
  } else if (/^\/ui\/(panel|status|page)\/(index\.html|main\.js)$/.test(pathname)) {
    res.setHeader('content-type', pathname.endsWith('.js') ? 'text/javascript' : 'text/html'); res.end(readFileSync(`.${pathname}`));
  } else { res.statusCode = pathname === '/favicon.ico' ? 204 : 404; res.end(); }
});
server.listen(47871, '127.0.0.1', () => console.log('Synthetic session-context fixture ready on loopback port 47871'));
process.on('SIGTERM', () => { server.close(); server.closeAllConnections(); });
