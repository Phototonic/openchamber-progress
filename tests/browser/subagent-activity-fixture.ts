// Synthetic SDK workspace + service fixture for the sub-agents section, NOT native-host proof.
// Serves the current built guests (ui/*/main.js) on loopback with a synthetic sub-agent runs
// revision-1 read (same wire shape as shared/subagent-runs.ts). Every session, plan and title here
// is synthetic. node --experimental-strip-types tests/browser/subagent-activity-fixture.ts [port]
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { HEALTH, envelope, summary, docRef, setupRead, at } from './fixtures.ts';
import type { Item } from '../../shared/progress.ts';

const port = Number(process.argv[2] ?? 47873);
const ago = (minutes: number) => at(minutes, Date.now());
// Root A coordinates "Release preparation": C1 (running, two tasks), N1 under C1 (waiting for an
// answer), C2 (finished, claims done, but its task is blocked), E1 (idle, no task, no run record).
const items = [
  { id: 'task-1', title: 'Collect references', kind: 'task', status: 'done', assigneeSessionId: 'C1', reporterSessionId: 'A' },
  { id: 'task-4', title: 'Summarize findings', kind: 'task', status: 'working', assigneeSessionId: 'C1' },
  { id: 'task-3', title: 'Check edge cases', kind: 'task', status: 'working', assigneeSessionId: 'N1', reporterSessionId: 'N1' },
  { id: 'task-5', title: 'Review the release note', kind: 'task', status: 'blocked', assigneeSessionId: 'C2', reporterSessionId: 'A' },
  { id: 'task-2', title: 'Write the release note', kind: 'task', status: 'pending' },
] as Item[];
const alphaPlan = summary('plan-alpha', items, { sessionId: 'A', title: 'Release preparation', revision: 4, structuralRevision: 1, reportedAt: ago(4), document: docRef() });
const manyPlan = summary('plan-many', [{ id: 'm-1', title: 'Migrate every table', kind: 'task', status: 'working', assigneeSessionId: 'M' }] as Item[], { sessionId: 'M', title: 'Data migration sweep', revision: 9, reportedAt: ago(60 * 49) });
const foreign = summary('plan-alpha', [{ id: 'task-1', title: 'Lookalike task', kind: 'task', status: 'working' }], { sourceId: 'src-other', sessionId: 'A', title: 'Other setup lookalike', reportedAt: ago(2) });
const contributions = [
  { revision: 3, reporterSessionId: 'A', reporterAgent: 'build', attributedSessionId: 'C2', mode: 'parent-relay', itemIds: ['task-5'], reportedAt: ago(5) },
  { revision: 4, reporterSessionId: 'N1', reporterAgent: 'general', attributedSessionId: 'N1', mode: 'direct', itemIds: ['task-3'], reportedAt: ago(4) },
];
const links = [{ sessionId: 'C1', itemIds: ['task-1', 'task-4'] }, { sessionId: 'N1', itemIds: ['task-3'] }, { sessionId: 'C2', itemIds: ['task-5'] }];
const theme = { mode: 'light', tokens: { background: '#fafafa', elevated: '#ffffff', foreground: '#202124', muted: '#64676e', subtle: '#74777e', border: '#dedfe3', hover: '#f0f1f3', selection: '#e7eefb', focus: '#376bc4', primary: '#316ac3', mutedSurface: '#f3f4f6', elevatedForeground: '#202124', active: '#e7e9ed', selectionForeground: '#173964', primaryForeground: '#ffffff', primaryText: '#24579e', successText: '#237044', warningText: '#855900', errorText: '#ad3030', infoText: '#24579e', success: '#27824d', warning: '#a66c00', error: '#c23d3d', info: '#316ac3', font: 'system-ui, sans-serif', mono: 'monospace', radius: '6px' } };
const s = (id: string, parentId: string | null, title: string, activity: string, extra: object = {}) => ({ id, title, projectId: 'proj-alpha', directory: '/fixture/Alpha', parentId, createdAt: 0, updatedAt: 0, archivedAt: null, worktree: null, activity, outcome: null, items: [], ...extra });
const sessions = {
  'proj-alpha': [
    s('A', null, 'Coordinate the release', 'running'),
    s('C1', 'A', 'Research helper', 'running', { createdAt: 1 }),
    s('C2', 'A', '<b>Literal</b> & restricted reviewer', 'idle', { createdAt: 2, outcome: 'completed' }),
    s('N1', 'C1', 'Edge-case checker', 'waiting-question', { createdAt: 3 }),
    s('E1', 'A', 'Idle helper without tasks', 'idle', { createdAt: 4 }),
    s('B', null, 'Unrelated session', 'idle'),
    s('B-child', 'B', 'Helper of the unrelated session', 'running', { createdAt: 4 }),
    s('B-child2', 'B', 'Second helper of the unrelated session', 'idle', { createdAt: 5, outcome: 'completed' }),
    s('M', null, 'Migration coordinator', 'running'),
    s('M-live', 'M', 'Table batch 214', 'running', { createdAt: 9 }),
  ],
  'proj-beta': [s('Beta-root', null, 'Research helper', 'running', { projectId: 'proj-beta', directory: '/fixture/Beta' })],
};
const script = `
const T=Date.now(),min=60000;
const plans=${JSON.stringify([alphaPlan, manyPlan, foreign])},items=${JSON.stringify(items)},contributions=${JSON.stringify(contributions)},links=${JSON.stringify(links)},base=${JSON.stringify(envelope())},theme=${JSON.stringify(theme)};
const surfaces=['panel','status','page'],frame=s=>document.querySelector('iframe[data-surface="'+s+'"]');
const send=(s,m)=>frame(s).contentWindow.postMessage({channel:'openchamber.sdk',v:1,...m},'*');
// Synthetic sub-agent runs revision 1 (wire shape of shared/subagent-runs.ts RunRow/RunRead).
let n=0;
const run=(parent,child,state,o={})=>{const id='run-'+(++n),dispatched=T-(o.ago??10)*min,started=dispatched+800,ended=['succeeded','failed','interrupted'].includes(state)?started+(o.took??3)*min:null;
  return {id,kind:'dispatch',source:'src-local',parentSessionId:parent,childSessionId:child,tool:'subagent',agent:o.agent??'explorer',description:o.description??'Synthetic job '+n,
   dispatch:{messageId:'m-'+n,callId:'c-'+n,at:dispatched},planContext:o.plan===null?null:{plan:o.plan??'plan-alpha',revision:3,observedAt:dispatched},
   ran:{state,dispatchState:'returned',startedAt:started,endedAt:ended,updatedAt:ended??started,provenance:'native-event',eventId:'e-'+n,sequence:2,errorType:o.errorType??null,interruptionReason:o.reason??null},
   claimed:o.claimed??null,accepted:null};};
const history=(parent,child,o)=>({id:'hist-'+(++n),kind:'historical-session',source:'src-local',parentSessionId:parent,childSessionId:child,tool:null,agent:o.agent??null,description:o.description,dispatch:null,planContext:null,
   ran:{state:o.state??'unknown',dispatchState:'historical',startedAt:null,endedAt:o.idle??null,updatedAt:o.updated,provenance:'native-session',eventId:null,sequence:null,errorType:null,interruptionReason:null},claimed:null,accepted:null});
const alphaRuns=()=>[
  run('A','C1','running',{ago:4.2,description:'Research release references'}),
  run('C1','N1','running',{ago:2.1,description:'Check edge cases',agent:'general'}),
  run('A','C2','succeeded',{ago:12,took:3,description:'<b>Review</b> the release note',agent:'reviewer',claimed:{oid:'h-1',outcome:'done',summary:'Reviewed the note; two <i>wording</i> fixes remain',reportedAt:T-8.5*min,sessionId:'C2',association:'execution'}}),
  run('A','X'+(n+1),'failed',{ago:30,took:1,description:'Draft changelog entries',errorType:'SyntheticFailure'}),
  run('A','X'+(n+1),'interrupted',{ago:40,took:2,description:'Benchmark the build',reason:'user'}),
  run('A','X'+(n+1),'succeeded',{ago:55,took:6,description:'Collect contributor names'}),
  run('A','X'+(n+1),'succeeded',{ago:70,took:4,description:'List open issues'}),
];
const alphaHistory=()=>[history('A','OLD1',{description:'Earlier planning helper',agent:'explorer',updated:T-2*24*60*min-5*min,state:'unknown'}),history('A','OLD2',{description:'Earlier triage helper',updated:T-3*24*60*min,idle:T-3*24*60*min-min,state:'succeeded'})];
const manyRuns=()=>{const r=[run('M','M-live','running',{ago:6,plan:'plan-many',description:'Table batch 214',agent:'migrator'})];
  for(let i=0;i<212;i++){const st=i<4?'failed':i<6?'interrupted':i<7?'unknown':'succeeded';const x=run('M','Y'+(n+1),st,{ago:20+i*13,took:2+i%5,plan:'plan-many',description:'Table batch '+(213-i),agent:'migrator',errorType:st==='failed'?'SyntheticTimeout':null,reason:st==='interrupted'?'superseded':null});if(st==='unknown'){x.ran.endedAt=null;x.ran.dispatchState='unconfirmed';}r.push(x);}
  return r;};
window.qa={session:null,directory:'/fixture/Alpha',capture:true,capable:true,connected:false,hold:false,held:[],requests:[],opened:[],subs:new Map(),
  runs:{A:{useful:alphaRuns(),history:alphaHistory(),recovery:{state:'complete',reason:null,token:null},loss:false},M:{useful:manyRuns(),history:[],recovery:{state:'complete',reason:null,token:null},loss:false}},
  ws:{projectsState:'ready',projects:[{id:'proj-alpha',name:'Alpha',directory:'/fixture/Alpha'},{id:'proj-beta',name:'Beta',directory:'/fixture/Beta'}],
  sessions:${JSON.stringify(sessions)},state:{'proj-alpha':'ready','proj-beta':'ready'},coverage:{'proj-alpha':[{directory:'/fixture/Alpha',state:'ready'}],'proj-beta':[{directory:'/fixture/Beta',state:'ready'}]}}};
let revision=1;qa.bump=()=>{revision++;return revision};
const runRead=(q)=>{const binding=JSON.parse(q.binding),root=qa.runs[q.root];if(!root)return null;
  const all=[...root.useful,...root.history],count=k=>all.filter(r=>r.ran.state===k).length;
  const pool=q.view==='history'?root.history:root.useful,offset=Number(q.cursor||0),data=pool.slice(offset,offset+50);
  return {protocolVersion:2,schemaVersion:2,storeId:q.storeId,sourceBinding:binding,source:q.source,root:q.root,plan:q.plan??null,cleanupRev:q.plan?Number(q.cleanupRev):null,view:q.view??'useful',subagentRuns:1,runFormat:1,availability:'ready',readAt:Date.now(),revision,
   capture:{enabled:qa.capture,state:'last-known',loss:root.loss},recovery:root.recovery,
   counts:{children:new Set(all.map(r=>r.childSessionId||r.id)).size,runs:root.useful.length,historicalSessions:root.history.length,running:count('running'),succeeded:count('succeeded'),failed:count('failed'),interrupted:count('interrupted'),unknown:count('unknown')},
   coverage:{scope:'retained',complete:root.recovery.state==='complete'&&!root.loss,reasons:[...(root.recovery.state==='complete'?[]:['history-not-reconciled']),...(root.loss?['capture-loss']:[])]},
   data,nextCursor:offset+50<pool.length?String(offset+50):null};};
// Realistic ready context: no integration account is linked (connection is integration link state,
// not host transport), while the workspace streams are ready.
const conn=()=>({account:qa.connected?'fixture-link':'',connected:qa.connected});
const ready=s=>send(s,{type:'ready',payload:{theme,locale:'en',surface:s,session:qa.session?{id:qa.session}:null,directory:qa.directory,connection:conn(),settings:{},item:null}});
const snapshot=q=>q.kind==='projects'?{kind:'projects',state:qa.ws.projectsState,projects:qa.ws.projectsState==='ready'?qa.ws.projects:[]}
  :q.kind==='worktrees'?{kind:'worktrees',projectId:q.projectId,state:'ready',worktrees:[]}
  :{kind:'sessions',projectId:q.projectId,state:qa.ws.state[q.projectId]||'ready',coverage:qa.ws.coverage[q.projectId]||[],sessions:(qa.ws.state[q.projectId]||'ready')==='ready'?(qa.ws.sessions[q.projectId]||[]):[]};
qa.push=(kind)=>{for(const x of qa.subs.values())if(!kind||x.query.kind===kind)send(x.surface,{type:'workspace',payload:{subscriptionId:x.id,snapshot:snapshot(x.query)}});return qa.subs.size};
// The native host's periodic reload of the same subscription: loading, then ready with unchanged values.
qa.reload=()=>{for(const x of qa.subs.values())if(x.query.kind==='sessions'){send(x.surface,{type:'workspace',payload:{subscriptionId:x.id,snapshot:{kind:'sessions',projectId:x.query.projectId,state:'loading',coverage:(qa.ws.coverage[x.query.projectId]||[]).map(c=>({...c,state:'loading'})),sessions:[]}}});send(x.surface,{type:'workspace',payload:{subscriptionId:x.id,snapshot:snapshot(x.query)}});}return true};
// The loading half of that reload only (the ready half follows with qa.push('sessions')).
qa.reloadStart=()=>{for(const x of qa.subs.values())if(x.query.kind==='sessions')send(x.surface,{type:'workspace',payload:{subscriptionId:x.id,snapshot:{kind:'sessions',projectId:x.query.projectId,state:'loading',coverage:(qa.ws.coverage[x.query.projectId]||[]).map(c=>({...c,state:'loading'})),sessions:[]}}});return true};
qa.set=(id,patch)=>{for(const list of Object.values(qa.ws.sessions)){const r=list.find(x=>x.id===id);if(r)Object.assign(r,patch)}qa.push('sessions');return true};
qa.context=(id,directory='/fixture/Alpha')=>{qa.session=id;qa.directory=directory;for(const s of surfaces){ready(s);send(s,{type:'directory',payload:{directory}});send(s,{type:'session',payload:{session:id?{id}:null}});}};
qa.connection=(connected)=>{qa.connected=connected;for(const s of surfaces)send(s,{type:'connection',payload:{connection:conn()}});return true};
qa.release=()=>{const h=qa.held.splice(0);h.forEach(f=>f());return h.length};
qa.show=(s,width=360)=>{for(const n of document.querySelectorAll('section'))n.style.display=n.dataset.surface===s?'block':'none';document.querySelector('section[data-surface="'+s+'"]').style.width=width+'px';};
qa.dark=()=>{theme.mode='dark';Object.assign(theme.tokens,{background:'#191b20',elevated:'#24272e',foreground:'#e6e8ee',muted:'#a4a9b4',subtle:'#9298a4',border:'#414650',hover:'#343944',selection:'#293d60',focus:'#90b8ff',primary:'#83aff7',mutedSurface:'#24272e',elevatedForeground:'#e6e8ee',active:'#3b4350',selectionForeground:'#e0ebff',primaryText:'#a6c7ff',successText:'#86dca3',warningText:'#e8c372',errorText:'#ff9e9e',infoText:'#a6c7ff',info:'#83aff7',warning:'#d9a13b',error:'#e06c6c',success:'#5cbf7f'});document.body.style.background='#191b20';document.body.style.color='#e6e8ee';surfaces.forEach(ready)};
const storage=new Map();
const participants={A:['plan-alpha'],C1:['plan-alpha'],N1:['plan-alpha'],C2:['plan-alpha'],M:['plan-many']};
addEventListener('message',e=>{const f=[...document.querySelectorAll('iframe')].find(x=>x.contentWindow===e.source),m=e.data;if(!f||m.channel!=='openchamber.sdk')return;const s=f.dataset.surface;
 const result=payload=>send(s,{type:'result',id:m.id,ok:true,payload});
 if(m.type==='hello')ready(s);
 else if(m.type==='storage'){const q=m.payload;if(q.op==='set')storage.set(q.key,q.value);if(q.op==='delete')storage.delete(q.key);result({storage:true,op:q.op,found:storage.has(q.key),value:storage.get(q.key)});}
 else if(m.type==='workspace-subscribe'){qa.subs.set(s+'|'+m.payload.subscriptionId,{surface:s,id:m.payload.subscriptionId,query:m.payload.query});result();send(s,{type:'workspace',payload:{subscriptionId:m.payload.subscriptionId,snapshot:snapshot(m.payload.query)}});}
 else if(m.type==='workspace-unsubscribe'){qa.subs.delete(s+'|'+m.payload.subscriptionId);if(m.id)result();}
 else if(m.type==='open-session'){qa.opened.push({surface:s,id:m.payload.sessionId});result();}
 else if(m.type==='service-request'){
  const q=m.payload;qa.requests.push({surface:s,context:qa.session,method:q.method||'GET',path:q.path,query:q.query});let body=null;const env={...base,captureEnabled:qa.capture,diagnostics:qa.capture?[]:['capture-disabled']};
  const local=plans.filter(p=>p.sourceId==='src-local');
  if(q.path==='/health')body={...${JSON.stringify({ ...HEALTH, planCleanup: 1 })},...(qa.capable?{subagentRuns:1}:{})};
  else if(q.path==='/v1/setup')body={...${JSON.stringify(setupRead())},captureEnabled:qa.capture};
  else if(q.path==='/v1/plans'){const sid=q.query?.session;body={...env,data:q.query?.archived==='only'?[]:sid?local.filter(p=>(participants[sid]||[]).includes(p.id)):plans,nextCursor:null};}
  else if(q.path==='/v1/plan'){const p=plans.find(p=>p.id===q.query?.plan&&p.sourceId===q.query?.source);if(p)body=p.sourceId!=='src-local'?{...env,plan:p,items:{data:[{id:'task-1',title:'Lookalike task',kind:'task',status:'working'}],nextCursor:null},contributions:{data:[],nextCursor:null},links:[]}:p.id==='plan-alpha'?{...env,plan:p,items:{data:items,nextCursor:null},contributions:{data:contributions,nextCursor:null},links}:{...env,plan:p,items:{data:[{id:'m-1',title:'Migrate every table',kind:'task',status:'working',assigneeSessionId:'M'}],nextCursor:null},contributions:{data:[],nextCursor:null},links:[]};}
  else if(q.path==='/v1/document')body={...env,document:${JSON.stringify(docRef())},text:'# Release preparation\\n\\nSynthetic example.',nextCursor:null};
  else if(q.path==='/v1/history')body={...env,data:[1,2,3,4].map(r=>({revision:r,structuralRevision:1,lifecycle:'active',reportedAt:plans[0].reportedAt})),nextCursor:null};
  else if(q.path==='/v1/subagent-runs')body=runRead(q.query);
  else if(q.path==='/v1/subagent-runs/reconcile'&&qa.reconcileError){result({status:503,body:JSON.stringify({error:qa.reconcileError})});return;}
  else if(q.path==='/v1/subagent-runs/reconcile'){const r=JSON.parse(q.body),root=qa.runs[r.root];if(root){root.recovery={state:'pending',reason:null,token:null};revision++;body={state:'pending',coalesced:false};}}
  const reply=()=>result({status:body?200:404,body:JSON.stringify(body||{error:'not-found'})});
  if(qa.hold&&q.path.startsWith('/v1/subagent-runs'))qa.held.push(reply);else reply();
 }else{if(m.type==='resize'&&s==='status'&&m.payload.height>0)f.style.height=m.payload.height+'px';if(m.id)result();}
});`;
const server = createServer((req, res) => {
  const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
  if (pathname === '/') {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(`<!doctype html><html><head><meta charset="utf-8"><title>Sub-agent activity fixture</title><style>body{margin:0;background:#fafafa;color:#202124;font:14px system-ui}section{margin:16px;width:360px}h1{font-size:14px;margin:0 0 10px}iframe{width:100%;height:900px;border:0;display:block}section[data-surface=status] iframe{height:240px}section:not([data-surface=panel]){display:none}</style></head><body><script>${script}</script>${['panel', 'status', 'page'].map(x => `<section data-surface="${x}"><h1>Agent progress · ${x}</h1><iframe data-surface="${x}" title="${x}" src="/ui/${x}/index.html"></iframe></section>`).join('')}</body></html>`);
  } else if (/^\/ui\/(panel|status|page)\/(index\.html|main\.js)$/.test(pathname)) {
    res.setHeader('content-type', pathname.endsWith('.js') ? 'text/javascript' : 'text/html'); res.end(readFileSync(`.${pathname}`));
  } else { res.statusCode = pathname === '/favicon.ico' ? 204 : 404; res.end(); }
});
server.listen(port, '127.0.0.1', () => console.log(`Synthetic sub-agent activity fixture ready on loopback port ${port}`));
process.on('SIGTERM', () => { server.close(); server.closeAllConnections(); });
