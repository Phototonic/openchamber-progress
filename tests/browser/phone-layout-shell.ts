// Phone-layout QA host: one guest frame at a time, sized like a phone screen, in a synthetic SDK
// shell relayed to a REAL disposable in-process progress service (synthetic SQLite seeded through
// production writes). Guests are the tracked bundles by default, or disposable source-built bundles
// (`source: true`, tests/browser/source-guests.ts) that never overwrite tracked outputs.
// Labelled QA seams only: host ready context (locale, theme, optional `device` hints), the frame's
// size and SDK session snapshots. Only bounded request metadata is recorded, never reply bodies.
// NOT native-host, relay or physical-phone proof.
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import type { GuestRequest, GuestRequestResult } from '@openchamber/sdk';
import type { BlockerItemInput, Request } from '../../shared/progress.ts';
import { createProgressServer } from '../../service/server.ts';
import { productionFixture } from '../fixtures/production.ts';
import { createGuestAssets } from './source-guests.ts';

const LIGHT = { background: '#fafafa', elevated: '#ffffff', foreground: '#202124', muted: '#64676e', subtle: '#74777e', border: '#dedfe3', hover: '#f0f1f3', selection: '#e7eefb', focus: '#376bc4', primary: '#316ac3', mutedSurface: '#f3f4f6', elevatedForeground: '#202124', active: '#e7e9ed', selectionForeground: '#173964', primaryForeground: '#ffffff', primaryText: '#24579e', successText: '#237044', warningText: '#855900', errorText: '#ad3030', infoText: '#24579e', success: '#27824d', warning: '#a66c00', error: '#c23d3d', info: '#316ac3', font: 'system-ui, sans-serif', mono: 'monospace', radius: '6px' };
const DARK = { ...LIGHT, background: '#191b20', elevated: '#24272e', foreground: '#e6e8ee', muted: '#a4a9b4', subtle: '#9298a4', border: '#414650', hover: '#343944', selection: '#293d60', focus: '#90b8ff', primary: '#83aff7', mutedSurface: '#24272e', elevatedForeground: '#e6e8ee', active: '#3b4350', selectionForeground: '#e0ebff', primaryText: '#a6c7ff', successText: '#86dca3', warningText: '#e8c372', errorText: '#ff9e9e', infoText: '#a6c7ff', success: '#6fc58c', warning: '#d9b367', error: '#ee8989', info: '#83aff7' };
export const FRAMES = ['panel', 'page'] as const;
const PROJECT = { id: 'alpha', name: 'Alpha', directory: '/fixture/Alpha' };
const SESSIONS = [
  { id: 'M', title: 'Planner session for the phone layout review', parentId: null },
  { id: 'C1', title: 'Helper session with a deliberately long descriptive title', parentId: 'M' },
  { id: 'C2', title: 'Сессия помощника с длинным названием', parentId: 'M' },
].map((s) => ({ ...s, projectId: PROJECT.id, directory: PROJECT.directory, createdAt: 1, updatedAt: 2, archivedAt: null, worktree: null, activity: 'idle', outcome: null, items: [] }));

/** Long English and Cyrillic titles, groups, prerequisites and reported waits: phone wrapping stress. */
export const PHONE_ITEMS: BlockerItemInput[] = [
  { id: 'design', title: 'Design', kind: 'group' },
  { id: 'task-a', title: 'Inventory every phone entry surface and record which ones open without an error', kind: 'task', parentId: 'design', status: 'done' },
  { id: 'task-b', title: 'Адаптировать доску и панель задач для узкого экрана телефона без горизонтальной прокрутки', kind: 'task', parentId: 'design', status: 'working', dependencies: ['task-a'] },
  { id: 'task-c', title: 'Choose the touch target sizes', kind: 'task', parentId: 'design', status: 'blocked', dependencies: ['task-a'], blocker: { category: 'decision', reason: 'Choose between a 44 pixel minimum and the host kit default of 40 pixels for buttons', nextAction: 'Confirm the minimum with the owner' } },
  { id: 'build', title: 'Build', kind: 'group' },
  { id: 'task-d', title: 'Keep sheets above the on-screen keyboard', kind: 'task', parentId: 'build', status: 'pending', dependencies: ['task-b', 'task-c'] },
  { id: 'task-e', title: 'Respect safe-area insets in landscape', kind: 'task', parentId: 'build', status: 'pending', dependencies: ['task-b'] },
  { id: 'task-f', title: 'Ожидание отзыва', kind: 'task', parentId: 'build', status: 'blocked', blocker: { category: 'review', reason: 'Нужен отзыв владельца о макете', nextAction: 'Проверить на телефоне' } },
  { id: 'task-g', title: 'Verify reflow at 200% and 400% zoom', kind: 'task', status: 'pending', dependencies: ['task-d', 'task-e'] },
  { id: 'task-h', title: 'Optional landscape experiment', kind: 'task', status: 'skipped' },
  ...Array.from({ length: 6 }, (_, i) => ({ id: `extra-${i}`, title: `Follow-up check ${i + 1}`, kind: 'task' as const, status: (i < 2 ? 'done' : 'pending') as 'done' | 'pending' })),
];

export function phoneFixture() {
  const f = productionFixture();
  const c2 = { ...f.child, sessionId: 'C2' };
  let oid = 0;
  const apply = (r: Partial<Request>, actor = f.actor, child?: typeof f.child) => f.store.apply({ plan: 'P-phone', oid: `phone-${oid++}`, rev: f.store.get(actor.sourceId, r.plan ?? 'P-phone')?.revision ?? 0, ...r }, actor, undefined, child);
  apply({ op: 'start', plan: 'P-second', title: 'Второй план: проверка длинных русских подписей', items: [{ id: 'r1', title: 'Проверить перенос строк', kind: 'task', status: 'working' }, { id: 'r2', title: 'Сверить переводы', kind: 'task', status: 'pending', dependencies: ['r1'] }] });
  apply({ op: 'start', plan: 'P-done', title: 'Finished warm-up plan', items: [{ id: 'd1', title: 'Warm up', kind: 'task', status: 'done' }] });
  apply({ op: 'finish', plan: 'P-done', outcome: 'finished' });
  apply({ op: 'start', title: 'Phone layout for the progress rail and the full board on a 390 pixel screen', items: PHONE_ITEMS });
  apply({ op: 'link', child: 'C1', assign: ['task-b', 'task-c'] }, f.actor, f.child);
  apply({ op: 'link', child: 'C2', assign: ['task-f'] }, f.actor, c2);
  apply({ op: 'change', changes: [{ id: 'task-b', status: 'working' }] }, f.child);
  apply({ op: 'change', changes: [{ id: 'task-f', status: 'blocked', blocker: { category: 'review', reason: 'Нужен отзыв владельца о макете', nextAction: 'Проверить на телефоне' } }] }, c2);
  f.store.bindReads(f.source.id, true);
  return { ...f, apply };
}

const script = `
const light=${JSON.stringify(LIGHT)},dark=${JSON.stringify(DARK)};
const theme={mode:'light',tokens:{...light}};
const frames=${JSON.stringify(FRAMES)},frame=f=>document.querySelector('iframe[data-frame="'+f+'"]');
const send=(f,m)=>frame(f)?.contentWindow?.postMessage({channel:'openchamber.sdk',v:1,...m},'*');
const project=${JSON.stringify(PROJECT)},sessions=${JSON.stringify(SESSIONS)};
window.frame=frame;
window.qa={session:'M',locale:'en',device:undefined,requests:[],messages:[],subs:[],storage:new Map()};
const ready=f=>send(f,{type:'ready',payload:{theme,locale:qa.locale,directory:project.directory,session:qa.session?{id:qa.session}:null,surface:f,connection:{connected:true,account:'account-example'},settings:{},item:null,...(qa.device?{device:qa.device}:{})}});
qa.ready=f=>{(f?[f]:frames).forEach(ready)};
/** Host re-sends ready on rotation/keyboard changes; undefined omits the optional field. */
qa.setDevice=d=>{qa.device=d;frames.forEach(ready)};
qa.setLocale=l=>{qa.locale=l;frames.forEach(ready)};
qa.theme=mode=>{theme.mode=mode;Object.assign(theme.tokens,mode==='dark'?dark:light);document.documentElement.style.background=theme.tokens.background;frames.forEach(ready)};
/** Shows one frame as the whole phone screen (width x height CSS pixels). */
qa.show=(f,width,height)=>{for(const n of document.querySelectorAll('section[data-frame]')){const on=n.dataset.frame===f;n.style.display=on?'block':'none';if(on){n.style.width=width+'px';n.querySelector('iframe').style.height=height+'px'}}};
const snapshot=q=>q.kind==='projects'?{kind:'projects',state:'ready',projects:[project]}:q.kind==='worktrees'?{kind:'worktrees',projectId:q.projectId,state:'ready',worktrees:[]}:{kind:'sessions',projectId:q.projectId,state:'ready',coverage:[],sessions:q.projectId===project.id?sessions:[]};
addEventListener('message',async e=>{
 const el=[...document.querySelectorAll('iframe')].find(x=>x.contentWindow===e.source),m=e.data;if(!el||m.channel!=='openchamber.sdk')return;const f=el.dataset.frame;
 const result=payload=>send(f,{type:'result',id:m.id,ok:true,payload});
 qa.messages.push({frame:f,type:m.type,payload:m.type==='open-surface'||m.type==='openSurface'?m.payload:undefined,at:performance.now()});
 if(m.type==='hello')ready(f);
 else if(m.type==='workspace-subscribe'){result();const q=m.payload.query;qa.subs.push({frame:f,id:m.payload.subscriptionId,kind:q.kind});send(f,{type:'workspace',payload:{subscriptionId:m.payload.subscriptionId,snapshot:snapshot(q)}})}
 else if(m.type==='workspace-unsubscribe'){qa.subs=qa.subs.filter(s=>s.id!==m.payload?.subscriptionId);result()}
 else if(m.type==='storage'){const q=m.payload,k=f+':'+q.key;if(q.op==='set')qa.storage.set(k,q.value);if(q.op==='delete')qa.storage.delete(k);result({storage:true,op:q.op,found:qa.storage.has(k),value:qa.storage.get(k),...(q.op==='keys'?{keys:[]}:{})})}
 else if(m.type==='service-request'){
  const q=m.payload,entry={frame:f,method:q.method,path:q.path,plan:q.query?.plan??null,cursor:!!q.query?.cursor,at:performance.now(),status:null};qa.requests.push(entry);
  try{const r=await fetch('/service',{method:'POST',body:JSON.stringify(q)});const reply=await r.json();entry.status=reply.status;result(reply)}
  catch{send(f,{type:'result',id:m.id,ok:false,code:'HOST_UNAVAILABLE',error:'Fixture proxy unavailable'})}
 }else if(m.id)result();
});
`;

const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Phone layout QA</title><style>html,body{margin:0;background:#fafafa}section{display:none;margin:0}iframe{display:block;width:100%;height:844px;border:0}</style></head><body><script>${script}</script>${FRAMES.map((f) => `<section data-frame="${f}"><iframe data-frame="${f}" data-surface="${f}" title="${f}" src="/ui/${f}/index.html"></iframe></section>`).join('')}</body></html>`;

export async function startPhoneShell(options: { source?: boolean } = {}) {
  const f = phoneFixture();
  const assets = createGuestAssets({ source: options.source, surfaces: ['panel', 'page'] });
  let service: Server | undefined, server: Server | undefined;
  const stop = async () => {
    if (server) { server.close(); server.closeAllConnections(); }
    if (service) { service.close(); service.closeAllConnections(); }
    assets.dispose(); f.cleanup();
  };
  try {
    service = createProgressServer(f.store, 'fixture-only');
    service.listen(0, '127.0.0.1'); await once(service, 'listening');
    const url = `http://127.0.0.1:${(service.address() as { port: number }).port}`;
    const relay = async (q: GuestRequest): Promise<GuestRequestResult> => {
      if (q.path === '/v1/extension-update' || q.path === '/v1/setup') return { status: 404, body: '{"error":"not-found"}' };
      const qs = new URLSearchParams(q.query ?? {}).toString();
      const r = await fetch(`${url}${q.path}${qs ? `?${qs}` : ''}`, { method: q.body ? 'POST' : 'GET', headers: { authorization: 'Bearer fixture-only', 'content-type': 'application/json' }, ...(q.body ? { body: q.body } : {}), signal: AbortSignal.timeout(5000) });
      return { status: r.status, body: await r.text() };
    };
    server = createServer(async (req, res) => {
      const u = new URL(req.url ?? '/', 'http://127.0.0.1');
      try {
        if (u.pathname === '/') { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(html); return; }
        const asset = assets.read(u.pathname);
        if (asset) { res.setHeader('content-type', u.pathname.endsWith('.js') ? 'text/javascript' : 'text/html'); res.end(asset); return; }
        if (u.pathname === '/service' && req.method === 'POST') {
          let body = ''; for await (const part of req) body += part;
          res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(await relay(JSON.parse(body))));
          return;
        }
        res.statusCode = u.pathname === '/favicon.ico' ? 204 : 404; res.end();
      } catch { res.statusCode = 500; res.end('{"error":"fixture-failed"}'); }
    });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    return { port: (server.address() as { port: number }).port, source: assets.source, stop };
  } catch (error) { await stop(); throw error; }
}
