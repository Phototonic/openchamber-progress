// Change-digest QA host bridge: current guest bundles in a synthetic SDK shell, relayed to REAL
// disposable HTTP services over SQLite (cleanup-service fixture; current TypeScript service by
// default, the checked-in generated service with `built`). The bearer stays in this process.
// Frames: page/page2 share device namespace `profile-1`; page3 uses `profile-2`; panel/status are
// present to prove they start no digest work. Labelled QA seams only (never shipped): held
// service replies, storage faults, the device-storage feature flag, account and store switches.
// NOT native-host, relay or cross-device proof.
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import type { GuestRequest, GuestRequestResult } from '@openchamber/sdk';
import { launchCleanupService } from '../fixtures/cleanup-service.ts';

export const SOURCE = 'source-fixture';
const LIGHT = { mode: 'light', tokens: { background: '#fafafa', elevated: '#ffffff', foreground: '#202124', muted: '#64676e', subtle: '#74777e', border: '#dedfe3', hover: '#f0f1f3', selection: '#e7eefb', focus: '#376bc4', primary: '#316ac3', mutedSurface: '#f3f4f6', elevatedForeground: '#202124', active: '#e7e9ed', selectionForeground: '#173964', primaryForeground: '#ffffff', primaryText: '#24579e', successText: '#237044', warningText: '#855900', errorText: '#ad3030', infoText: '#24579e', success: '#27824d', warning: '#a66c00', error: '#c23d3d', info: '#316ac3', font: 'system-ui, sans-serif', mono: 'monospace', radius: '6px' } };
const DARK = { background: '#191b20', elevated: '#24272e', foreground: '#e6e8ee', muted: '#a4a9b4', subtle: '#9298a4', border: '#414650', hover: '#343944', selection: '#293d60', focus: '#90b8ff', primary: '#83aff7', mutedSurface: '#24272e', elevatedForeground: '#e6e8ee', active: '#3b4350', selectionForeground: '#e0ebff', primaryText: '#a6c7ff', successText: '#86dca3', warningText: '#e8c372', errorText: '#ff9e9e', infoText: '#a6c7ff', success: '#6fc58c', warning: '#d9b367', error: '#ee8989', info: '#83aff7' };
export const FRAMES = ['page', 'page2', 'page3', 'panel', 'status'] as const;

const script = `
const light=${JSON.stringify(LIGHT)},dark=${JSON.stringify(DARK)},theme=JSON.parse(JSON.stringify(light));
const frames=${JSON.stringify(FRAMES)},surfaceOf=f=>f.startsWith('page')?'page':f,frame=f=>document.querySelector('iframe[data-frame="'+f+'"]');
const send=(f,m)=>frame(f).contentWindow.postMessage({channel:'openchamber.sdk',v:1,...m},'*');
window.frame=frame;
// devices: one Map per synthetic device namespace (browser profile + runtime + installation).
window.qa={account:'account-example',store:0,deviceStorage:true,ns:{page:'profile-1',page2:'profile-1',page3:'profile-2',panel:'profile-1',status:'profile-1'},devices:{},instance:new Map(),
 holds:[],held:[],requests:[],storageLog:[],storageFaults:[],errors:[],flight:0,stripDigests:false};
const device=f=>qa.devices[qa.ns[f]]??=new Map();
const ready=f=>send(f,{type:'ready',payload:{theme,locale:'en',directory:'/fixture/Alpha',session:null,surface:surfaceOf(f),connection:{connected:true,account:qa.account},settings:{},item:null,...(qa.deviceStorage?{features:{deviceStorage:true}}:{})}});
qa.ready=f=>{(f?[f]:frames).forEach(ready)};
qa.show=(list,width)=>{for(const n of document.querySelectorAll('section[data-frame]')){const on=list.includes(n.dataset.frame);n.style.display=on?'block':'none';if(on)n.style.width=width+'px'}};
qa.theme=mode=>{theme.mode=mode;Object.assign(theme.tokens,mode==='dark'?dark:light.tokens);document.documentElement.style.background=theme.tokens.background;document.body.style.background=theme.tokens.background;document.body.style.color=theme.tokens.foreground;frames.forEach(ready)};
qa.release=tag=>{const out=qa.held.filter(h=>!tag||h.tag===tag);qa.held=qa.held.filter(h=>!out.includes(h));qa.holds=qa.holds.filter(h=>tag&&h.tag!==tag);out.forEach(h=>h.go());return out.length};
qa.deviceKeys=ns=>[...(qa.devices[ns]??new Map()).keys()].sort();
qa.deviceValues=ns=>[...(qa.devices[ns]??new Map()).values()];
const matches=(h,f,q)=>(!h.frame||h.frame===f)&&h.path===q.path&&(h.plan===undefined||q.query?.plan===h.plan);
addEventListener('message',async e=>{
 const el=[...document.querySelectorAll('iframe')].find(x=>x.contentWindow===e.source),m=e.data;if(!el||m.channel!=='openchamber.sdk')return;const f=el.dataset.frame;
 const result=payload=>send(f,{type:'result',id:m.id,ok:true,payload});
 const fail=(code,error)=>send(f,{type:'result',id:m.id,ok:false,code,error});
 if(m.type==='hello')ready(f);
 else if(m.type==='workspace-subscribe'){result();const q=m.payload.query;send(f,{type:'workspace',payload:{subscriptionId:m.payload.subscriptionId,snapshot:q.kind==='projects'?{kind:'projects',state:'ready',projects:[]}:{kind:q.kind,state:'ready',projectId:q.projectId,sessions:[],worktrees:[],coverage:[]}}})}
 else if(m.type==='workspace-unsubscribe')result();
 else if(m.type==='storage'){
  const q=m.payload,scope=q.scope==='device'?'device':'instance';qa.storageLog.push({frame:f,op:q.op,key:q.key??null,scope});
  const fault=qa.storageFaults.find(x=>(!x.frame||x.frame===f)&&x.op===q.op&&(x.scope??'device')===scope);
  if(fault){if(fault.once)qa.storageFaults=qa.storageFaults.filter(x=>x!==fault);fail(fault.code,fault.error??'Synthetic storage fault');return}
  const map=scope==='device'?device(f):qa.instance;
  if(q.op==='keys'){result({storage:true,op:'keys',keys:[...map.keys()].sort()});return}
  if(q.op==='set')map.set(q.key,JSON.parse(JSON.stringify(q.value)));if(q.op==='delete')map.delete(q.key);
  result({storage:true,op:q.op,found:map.has(q.key),value:map.get(q.key)});
 }
 else if(m.type==='service-request'){
  const q=m.payload;qa.requests.push({frame:f,method:q.method,path:q.path,query:q.query||null});
  const forward=async()=>{qa.flight++;try{const r=await fetch('/service',{method:'POST',body:JSON.stringify({request:q,store:qa.store})});if(!r.ok)throw new Error('proxy');const reply=await r.json();
   if(q.path==='/health'&&qa.stripDigests){const b=JSON.parse(reply.body);delete b.planChangeDigests;reply.body=JSON.stringify(b)}return reply}finally{qa.flight--}};
  const deliver=p=>p.then(result,()=>{qa.errors.push('fixture proxy failed');fail('HOST_UNAVAILABLE','Fixture proxy unavailable')});
  const hold=qa.holds.find(h=>matches(h,f,q));
  if(hold){qa.holds=qa.holds.filter(h=>h!==hold);if(hold.before)qa.held.push({tag:hold.tag,frame:f,path:q.path,go:()=>deliver(forward())});else{const reply=forward();qa.held.push({tag:hold.tag,frame:f,path:q.path,go:()=>deliver(reply)})}}
  else deliver(forward());
 }else{if(m.type==='resize'&&f==='status'&&m.payload.height>0)el.style.height=m.payload.height+'px';if(m.id)result()}
});
`;

const html = `<!doctype html><html><head><meta charset="utf-8"><title>Change digests QA</title><style>html,body{margin:0;background:#fafafa;color:#202124;font:14px system-ui}main{display:flex;flex-wrap:wrap;align-items:flex-start}section{margin:12px;display:none}h1{font-size:13px;margin:0 0 8px}iframe{display:block;width:100%;height:1500px;border:0}section[data-frame=status] iframe{height:200px}</style></head><body><script>${script}</script><main>${FRAMES.map((f) => `<section data-frame="${f}"><h1>Agent progress · ${f.startsWith('page') ? `page (${f === 'page3' ? 'profile 2' : 'profile 1'})` : f}</h1><iframe data-frame="${f}" data-surface="${f.startsWith('page') ? 'page' : f}" title="${f}" src="/ui/${f.startsWith('page') ? 'page' : f}/index.html"></iframe></section>`).join('')}</main></body></html>`;

type Fixture = Awaited<ReturnType<typeof launchCleanupService>>;
type Item = { id: string; title: string; kind: 'task' | 'group'; status?: string; parentId?: string };

/** Synthetic, public-safe plans seeded through the ordinary store write path. */
function seed(f: Fixture, second: boolean) {
  let oid = 0;
  const actor = { ...f.actor, sessionId: 'session-example' };
  const rev = (plan: string) => f.store.get(SOURCE, plan)?.revision ?? 0;
  const apply = (plan: string, request: Record<string, unknown>, fixed?: string) => f.store.apply({ plan, rev: rev(plan), oid: fixed ?? `qa-${++oid}`, ...request }, actor);
  const start = (plan: string, title: string, items: Item[]) => apply(plan, { op: 'start', title, items });
  const releaseItems: Item[] = [
    { id: 'G', title: 'Release work', kind: 'group' },
    { id: 'A', title: 'Draft release notes', kind: 'task', status: 'done', parentId: 'G' },
    { id: 'B', title: 'Verify checksums', kind: 'task', status: 'working' },
    { id: 'C', title: 'Optional translation pass', kind: 'task', status: 'skipped' },
  ];
  if (second) { start('P-digest', 'Second store example', [{ id: 'A', title: 'Unrelated task', kind: 'task', status: 'working' }]); return { apply, rev, releaseItems, actor }; }
  start('P-digest', 'Release digest example', releaseItems);
  start('P-removal', 'Mirror maintenance example', [
    { id: 'M', title: 'Maintenance', kind: 'group' },
    { id: 'R1', title: 'Archive old builds', kind: 'task', status: 'working', parentId: 'M' },
    { id: 'R2', title: 'Rotate signing key', kind: 'task', status: 'pending' },
    { id: 'R3', title: 'Update download mirrors', kind: 'task', status: 'blocked' },
  ]);
  start('P-gap', 'Gap history example', [{ id: 'T1', title: 'Collect metrics', kind: 'task', status: 'working' }, { id: 'T2', title: 'Summarize metrics', kind: 'task', status: 'pending' }]);
  start('P-release', 'Finished release example', [{ id: 'F1', title: 'Tag release', kind: 'task', status: 'done' }, { id: 'F2', title: 'Announce release', kind: 'task', status: 'done' }]);
  apply('P-release', { op: 'finish', outcome: 'finished' });
  return { apply, rev, releaseItems, actor };
}

export async function startDigestShell(built = false) {
  const stores = [await launchCleanupService(built, false), await launchCleanupService(built, false)];
  const seeded = [seed(stores[0], false), seed(stores[1], true)];
  const s0 = stores[0], { apply, rev, releaseItems, actor } = seeded[0];
  /** The exact same-status report, kept so it can be replayed byte-for-byte (a receipt replay). */
  let repeat: Record<string, unknown> | null = null;
  const relay = async (q: GuestRequest, store: number): Promise<GuestRequestResult> => {
    if (q.path === '/v1/extension-update') return { status: 404, body: '{"error":"not-found"}' };
    const query = new URLSearchParams(q.query ?? {}).toString();
    const reply = await stores[store === 1 ? 1 : 0].request(q.path + (query ? '?' + query : ''), q.body ? JSON.parse(q.body) : undefined);
    return { status: reply.status, body: await reply.text() };
  };
  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    try {
      if (url.pathname === '/') { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(html); }
      else if (/^\/ui\/(page|panel|status)\/(index\.html|main\.js)$/.test(url.pathname)) { res.setHeader('content-type', url.pathname.endsWith('.js') ? 'text/javascript' : 'text/html'); res.end(readFileSync(`.${url.pathname}`)); }
      else if (url.pathname === '/service' && req.method === 'POST') {
        let body = ''; for await (const part of req) body += part;
        const { request, store } = JSON.parse(body);
        res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(await relay(request, store)));
      } else { res.statusCode = url.pathname === '/favicon.ico' ? 204 : 404; res.end(); }
    } catch { res.statusCode = 500; res.end('{"error":"fixture-failed"}'); }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as { port: number }).port;
  /** Fixture-side writes and cleanup actions, counted apart from guest requests. */
  let fixtureWrites = 0;
  const write = (plan: string, request: Record<string, unknown>, fixed?: string) => { fixtureWrites++; return apply(plan, request, fixed); };
  const status = (plan: string, id: string, value: string, fixed?: string) => write(plan, { op: 'change', changes: [{ id, status: value }] }, fixed);
  async function cleanup(action: 'archive' | 'restore' | 'delete', plan: string) {
    const p = s0.store.detail(SOURCE, plan).plan;
    const r = await s0.request(`/v1/plan/${action}`, { storeId: s0.body().storeId, source: SOURCE, plan, rev: p.revision, cleanupRev: p.cleanup?.revision ?? 0, oid: `qa-cleanup-${++fixtureWrites}`, ...(action === 'delete' ? { confirmed: true } : {}) });
    if (!r.ok) throw new Error(`fixture ${action} failed (${r.status})`);
  }
  /** Row counts and revision of one plan, to prove reads/reviews never change stored state. */
  const state = (plan: string) => {
    const tables = Object.fromEntries(['plans', 'revisions', 'contributions', 'receipts'].map((t) => [t, s0.store.db.prepare(`SELECT count(*) AS n FROM ${t} WHERE source=? AND ${t === 'plans' ? 'id' : 'plan'}=?`).get(SOURCE, plan)!.n]));
    const meta = s0.store.db.prepare("SELECT count(*) AS n FROM sqlite_master").get()!.n;
    return { revision: rev(plan), tables, schemaObjects: meta, sourceDocument: readFileSync(s0.documentPath, 'utf8') };
  };
  return {
    port, storeId: s0.body().storeId, revision: rev, state, cleanup,
    exists: (plan: string) => !!s0.store.get(SOURCE, plan),
    fixtureWrites: () => fixtureWrites,
    /** V1 sequence on P-digest: blocked, same-status repeat (fresh oid), identical replay, working, done, add D. */
    v1() {
      status('P-digest', 'B', 'blocked');
      repeat = { op: 'change', plan: 'P-digest', rev: rev('P-digest'), oid: 'qa-repeat', changes: [{ id: 'B', status: 'blocked' }] };
      s0.store.apply(repeat, actor); s0.store.apply(repeat, actor); fixtureWrites += 2;
      status('P-digest', 'B', 'working'); status('P-digest', 'B', 'done');
      write('P-digest', { op: 'revise', items: [...releaseItems.map((i) => (i.id === 'B' ? { ...i, status: 'done' } : i)), { id: 'D', title: 'Publish announcement', kind: 'task' }] });
    },
    /** Identical replay of an already applied report: no new revision. */
    replay() { if (repeat) { s0.store.apply(repeat, actor); fixtureWrites++; } },
    status,
    /** Removal fixture: R1 completed, R3 removed (while blocked), R2 reported blocked and surviving. */
    removal() {
      status('P-removal', 'R1', 'done');
      write('P-removal', { op: 'revise', items: [{ id: 'M', title: 'Maintenance', kind: 'group' }, { id: 'R1', title: 'Archive old builds', kind: 'task', parentId: 'M' }, { id: 'R2', title: 'Rotate signing key', kind: 'task' }] });
      status('P-removal', 'R2', 'blocked');
    },
    /** Race: R2 disappears after the digest target. */
    removeSurvivor() { write('P-removal', { op: 'revise', items: [{ id: 'M', title: 'Maintenance', kind: 'group' }, { id: 'R1', title: 'Archive old builds', kind: 'task', parentId: 'M' }] }); },
    /** Gap fixture: n progress revisions, then one intermediate snapshot row removed (labelled seam). */
    gap(n: number) {
      for (let i = 0; i < n; i++) status('P-gap', 'T1', i % 2 ? 'working' : 'blocked');
      const missing = rev('P-gap') - 2;
      s0.store.db.prepare('DELETE FROM contributions WHERE source=? AND plan=? AND revision=?').run(SOURCE, 'P-gap', missing);
      s0.store.db.prepare('DELETE FROM revisions WHERE source=? AND plan=? AND revision=?').run(SOURCE, 'P-gap', missing);
      return missing;
    },
    /** Revision-bound fixture: more than 128 revisions after the baseline. */
    many(n: number) { for (let i = 0; i < n; i++) status('P-gap', 'T2', i % 2 ? 'pending' : 'working'); },
    advance(plan: string, id: string) { status(plan, id, 'working'); },
    async stop() { server.close(); server.closeAllConnections(); await Promise.all(stores.map((s) => s.stop())); },
  };
}
