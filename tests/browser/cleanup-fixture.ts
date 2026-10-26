// Isolated CP-Q4 host bridge. Real built HTTP service/SQLite; synthetic SDK shell.
// Controls below are QA fault seams only, never shipped in a guest or service bundle.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { launchCleanupService } from '../fixtures/cleanup-service.ts';

const fixtures = [await launchCleanupService(true), await launchCleanupService(true, false)];
function seedFinishedSession() { for (const f of fixtures) {
  const actor = { ...f.actor, sessionId: 'F' };
  f.store.apply({ op: 'start', plan: 'P-only', rev: 0, oid: 'only-start', title: 'Finished-only session', items: [{ id: 'A', title: 'Completed task', kind: 'task', status: 'done' }] }, actor);
  f.store.apply({ op: 'finish', plan: 'P-only', rev: 1, oid: 'only-finish', outcome: 'finished' }, actor);
} }
seedFinishedSession();
const theme = { mode: 'light', tokens: { background: '#fafafa', elevated: '#ffffff', foreground: '#202124', muted: '#64676e', subtle: '#74777e', border: '#dedfe3', hover: '#f0f1f3', selection: '#e7eefb', focus: '#376bc4', primary: '#316ac3', mutedSurface: '#f3f4f6', elevatedForeground: '#202124', active: '#e7e9ed', selectionForeground: '#173964', primaryForeground: '#ffffff', primaryText: '#24579e', successText: '#237044', warningText: '#855900', errorText: '#ad3030', infoText: '#24579e', success: '#27824d', warning: '#a66c00', error: '#c23d3d', info: '#316ac3', font: 'system-ui, sans-serif', mono: 'monospace', radius: '6px' } };
const script = `
const theme=${JSON.stringify(theme)},storage=new Map();
window.qa={store:0,old:false,fail:null,hold:null,held:[],requests:[],responses:[],session:'M',errors:[]};
const frame=s=>document.querySelector('iframe[data-surface="'+s+'"]');
const send=(s,m)=>frame(s).contentWindow.postMessage({channel:'openchamber.sdk',v:1,...m},'*');
const ready=s=>send(s,{type:'ready',payload:{theme,locale:'en',directory:'/fixture/Alpha',session:{id:qa.session,title:'Example session',busy:false},surface:s,connection:{connected:true,account:'fixture'},settings:{},item:null}});
qa.show=s=>{for(const section of document.querySelectorAll('section[data-surface]'))section.style.display=section.dataset.surface===s?'block':'none';if(s==='status')frame(s).style.height=Math.ceil(frame(s).contentDocument.querySelector('main').getBoundingClientRect().height)+'px'};
qa.context=id=>{qa.session=id;for(const s of ['panel','status','page'])send(s,{type:'session',payload:{session:id?{id,title:'Example session',busy:false}:null}})};
qa.release=()=>{const held=qa.held.splice(0);qa.hold=null;held.forEach(f=>f());return held.length};
qa.dark=()=>{theme.mode='dark';Object.assign(theme.tokens,{background:'#191b20',elevated:'#24272e',foreground:'#e6e8ee',muted:'#a4a9b4',subtle:'#9298a4',border:'#414650',hover:'#343944',selection:'#293d60',focus:'#90b8ff',primary:'#83aff7',mutedSurface:'#24272e',elevatedForeground:'#e6e8ee',active:'#3b4350',selectionForeground:'#e0ebff',primaryText:'#a6c7ff',successText:'#86dca3',warningText:'#e8c372',errorText:'#ff9e9e',infoText:'#a6c7ff',success:'#6fc58c',warning:'#d9b367',error:'#ee8989',info:'#83aff7'});document.documentElement.style.background=theme.tokens.background;document.body.style.background=theme.tokens.background;document.body.style.color=theme.tokens.foreground;for(const s of ['panel','status','page'])ready(s)};
addEventListener('message',async e=>{
 const f=[...document.querySelectorAll('iframe')].find(f=>f.contentWindow===e.source),m=e.data;if(!f||m.channel!=='openchamber.sdk')return;const s=f.dataset.surface;
 const result=payload=>send(s,{type:'result',id:m.id,ok:true,payload});
 if(m.type==='hello')ready(s);
 else if(m.type==='workspace-subscribe'){result();const q=m.payload.query;send(s,{type:'workspace',payload:{subscriptionId:m.payload.subscriptionId,snapshot:q.kind==='projects'?{kind:'projects',state:'ready',projects:[]}:{kind:q.kind,state:'ready',projectId:q.projectId,sessions:[],worktrees:[],coverage:[]}}})}
 else if(m.type==='workspace-unsubscribe')result();
 else if(m.type==='storage'){const q=m.payload;if(q.op==='set')storage.set(q.key,q.value);if(q.op==='delete')storage.delete(q.key);result({storage:true,op:q.op,found:storage.has(q.key),value:storage.get(q.key)})}
 else if(m.type==='service-request'){
  const q=m.payload;qa.requests.push({surface:s,method:q.method,path:q.path,query:q.query,body:q.body?JSON.parse(q.body):null});
  if(qa.failRead&&s==='page'&&q.path==='/v1/plans'&&q.query?.archived==='only'){qa.failRead=false;result({status:503,body:JSON.stringify({error:'busy'})});return;}
  if(q.method==='POST'&&qa.fail){const mode=qa.fail;qa.fail=null;if(mode==='network'){send(s,{type:'result',id:m.id,ok:false,code:'HOST_UNAVAILABLE',error:'Fixture network unavailable'});return;}result({status:503,body:JSON.stringify({error:'busy'})});return;}
  try{const reply=await fetch('/service',{method:'POST',body:JSON.stringify({request:q,store:qa.store})}).then(r=>r.json());
   if(q.path==='/health'&&qa.old){const body=JSON.parse(reply.body);delete body.planCleanup;reply.body=JSON.stringify(body)}
   qa.responses.push({surface:s,path:q.path,status:reply.status});
   if(qa.hold&&qa.hold.surface===s&&(qa.hold.path===q.path||qa.hold.paths?.includes(q.path))){qa.held.push(()=>result(reply));}else result(reply);
  }catch{qa.errors.push('fixture proxy failed');send(s,{type:'result',id:m.id,ok:false,code:'HOST_UNAVAILABLE',error:'Fixture proxy unavailable'})}
 }else{if(m.type==='resize'&&s==='status'&&m.payload.height>0)f.style.height=m.payload.height+'px';if(m.id)result()}
});
`;
const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  try {
    if (url.pathname === '/') {
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.end(`<!doctype html><html><head><meta charset="utf-8"><title>Progress cleanup QA</title><style>html,body{margin:0;background:#fafafa;color:#202124;font:14px system-ui}section{margin:16px;width:900px}h1{font-size:14px;margin:0 0 10px}iframe{display:block;width:100%;height:680px;border:0}section[data-surface=panel]{width:360px;display:none}section[data-surface=status]{width:280px;display:none}</style></head><body><script>${script}</script>${['page', 'panel', 'status'].map(s => `<section data-surface="${s}"><h1>Agent progress · ${s}</h1><iframe data-surface="${s}" title="${s}" src="/ui/${s}/index.html"></iframe></section>`).join('')}</body></html>`);
    } else if (/^\/ui\/(page|panel|status)\/(index\.html|main\.js)$/.test(url.pathname)) {
      res.setHeader('content-type', url.pathname.endsWith('.js') ? 'text/javascript' : 'text/html'); res.end(readFileSync(`.${url.pathname}`));
    } else if (url.pathname === '/service' && req.method === 'POST') {
      let body = ''; for await (const part of req) body += part;
      const { request: q, store } = JSON.parse(body); const f = fixtures[store === 1 ? 1 : 0];
      // Official-main discovery is unrelated to cleanup and must not contact the network.
      if (q.path === '/v1/extension-update') { res.end(JSON.stringify({ status: 404, body: '{"error":"not-found"}' })); return; }
      const query = new URLSearchParams(q.query ?? {}).toString();
      const reply = await f.request(q.path + (query ? '?' + query : ''), q.body ? JSON.parse(q.body) : undefined);
      res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ status: reply.status, body: await reply.text() }));
    } else if (url.pathname === '/reset' && req.method === 'POST') {
      await Promise.all(fixtures.map(f => f.stop()));
      fixtures.splice(0, fixtures.length, await launchCleanupService(true), await launchCleanupService(true, false));
      seedFinishedSession(); res.end('{}');
    } else if (url.pathname === '/state') {
      const f = fixtures[url.searchParams.get('store') === '1' ? 1 : 0];
      const plan = url.searchParams.get('plan') ?? 'P-done', source = 'source-fixture';
      const saved = f.store.get(source, plan);
      const counts = Object.fromEntries(['plans', 'revisions', 'contributions', 'captures', 'chunks', 'receipts'].map(table => [table, f.store.db.prepare(`SELECT count(*) AS n FROM ${table} WHERE source=? AND ${table === 'plans' ? 'id' : 'plan'}=?`).get(source, plan)!.n]));
      const state = saved ? f.store.detail(source, plan).plan : null;
      res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ exists: !!saved, lifecycle: saved?.lifecycle, revision: saved?.revision, cleanup: state?.cleanup ?? null, counts, sourceUnchanged: readFileSync(f.documentPath, 'utf8') === '# Sample plan\n- [x] Example\n', otherSourceExists: !!f.store.get('source-other', 'P-done'), activeExists: !!f.store.get(source, 'P-active'), otherExists: !!f.store.get(source, 'P-other'), history: saved ? f.store.history(source, plan).data : null, document: saved ? f.store.document(source, plan).text : null }));
    } else if (url.pathname === '/conflict' && req.method === 'POST') {
      const f = fixtures[0], p = f.store.detail('source-fixture', 'P-other').plan;
      for (const [action, n] of [['archive', 0], ['restore', 1]] as const) {
        const r = await f.request(`/v1/plan/${action}`, { storeId: f.body().storeId, source: p.sourceId, plan: p.id, rev: p.revision, cleanupRev: (p.cleanup?.revision ?? 0) + n, oid: crypto.randomUUID() });
        if (!r.ok) throw new Error('conflict setup failed');
      }
      res.end('{}');
    } else { res.statusCode = 404; res.end(); }
  } catch { res.statusCode = 500; res.end('{"error":"fixture-failed"}'); }
});
server.listen(47851, '127.0.0.1', () => console.log(JSON.stringify({ ready: true, host: 'http://127.0.0.1:47851', built: true, stores: 2 })));
process.on('SIGTERM', async () => { server.close(); server.closeAllConnections(); await Promise.all(fixtures.map(f => f.stop())); });
