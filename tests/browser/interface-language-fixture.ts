// Synthetic SDK host only: current tracked guests, no backend/profile/model/network dependency.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { HEALTH, HEALTH_UNCONFIGURED, P1, P1_ITEMS, S, DOCUMENT_TEXT, envelope, planPage, plansPage, setupRead } from './fixtures.ts';

export const LANGUAGE_KEY = 'interface-language.v1';
export const USER_TASK_TITLE = 'English task · Привет <script>window.__qaInjected=true</script>';
const languageItems = P1_ITEMS.map((item) => item.id === 'I3' ? { ...item, title: USER_TASK_TITLE } : item);

// Intercept only long refresh timers, not SDK promises, popup input or rendering. Tests explicitly
// advance the existing cadence with qa.tick; focus/ready remain independent of progress responses.
const clock = `<script>
(()=>{const schedule=window.setTimeout.bind(window),cancel=window.clearTimeout.bind(window),pending=new Map();let next=-1;
window.__qaClock={pending,tick(){const batch=[...pending];pending.clear();for(const [,f] of batch)f();return batch.length}};
window.setTimeout=(f,ms,...args)=>{if(ms>=3000){const id=next--;pending.set(id,()=>typeof f==='function'?f(...args):null);return id}return schedule(f,ms,...args)};
window.clearTimeout=id=>{if(id<0)pending.delete(id);else cancel(id)};
})();</script>`;

const theme = { mode: 'light', tokens: { background: '#fafafa', elevated: '#ffffff', foreground: '#202124', muted: '#64676e', subtle: '#74777e', border: '#dedfe3', hover: '#f0f1f3', selection: '#e7eefb', focus: '#376bc4', primary: '#316ac3', mutedSurface: '#f3f4f6', elevatedForeground: '#202124', active: '#e7e9ed', selectionForeground: '#173964', primaryForeground: '#ffffff', primaryText: '#24579e', successText: '#237044', warningText: '#855900', errorText: '#ad3030', infoText: '#24579e', success: '#27824d', warning: '#a66c00', error: '#c23d3d', info: '#316ac3', font: 'system-ui, sans-serif', mono: 'monospace', radius: '6px' } };

/** Browser controls (all synthetic):
 * qa.ready(surface?, patch?) updates locale/features/directory/account via a new ready snapshot.
 * qa.context(session|null), qa.namespace(name), qa.reload(surface), qa.tick(surface?), qa.focus(surface),
 * qa.visible(surface, boolean), qa.show(surface,width), qa.seed(value|undefined, namespace?).
 * qa.mode = 'plan'|'empty'|'setup'|'failure'; qa.holds/qa.faults accept
 * {tag?,kind:'storage'|'service',surface?,op?,key?,path?,code?,status?}.
 * Holds capture a read reply BEFORE release (stale-read races); writes commit ON release.
 * qa.release(tag), qa.held, qa.storageLog, qa.requests, qa.messages, qa.maps, qa.instance expose evidence.
 * Storage and service controls are independent; ready does not mutate either namespace map.
 */
const script = `
const surfaces=['panel','status','page'];
window.frame=s=>document.querySelector('iframe[data-surface="'+s+'"]');
const send=(s,m)=>frame(s).contentWindow.postMessage({channel:'openchamber.sdk',v:1,...m},location.origin);
window.qa={mode:'plan',space:'primary',maps:new Map(),instance:new Map(),holds:[],held:[],faults:[],requests:[],storageLog:[],messages:[],clipboard:[],
 ctx:{locale:'en',features:{deviceStorage:true},directory:'/fixture/Alpha',session:null,connection:{connected:true,account:'fixture'}},
 ready(s,patch={}){Object.assign(this.ctx,patch);for(const n of s?[s]:surfaces)send(n,{type:'ready',payload:{theme:${JSON.stringify(theme)},...this.ctx,surface:n,settings:{},item:null}})},
 context(id){this.ctx.session=id?{id,title:'Example session',busy:false}:null;for(const s of surfaces)send(s,{type:'session',payload:{session:this.ctx.session}})},
 namespace(name){this.space=name;this.ready()},
 seed(value,space=this.space){const m=this.maps.get(space)||new Map();this.maps.set(space,m);if(value===undefined)m.delete('${LANGUAGE_KEY}');else m.set('${LANGUAGE_KEY}',structuredClone(value))},
 reload(s){frame(s).src='/ui/'+s+'/index.html?reload='+Math.random()},
 tick(s){return (s?[s]:surfaces).map(n=>frame(n).contentWindow.__qaClock?.tick())},
 focus(s){frame(s).contentWindow.dispatchEvent(new Event('focus'))},
 visible(s,on){const d=frame(s).contentDocument;Object.defineProperty(d,'visibilityState',{configurable:true,value:on?'visible':'hidden'});Object.defineProperty(d,'hidden',{configurable:true,value:!on});d.dispatchEvent(new Event('visibilitychange'))},
 show(s,width){for(const n of document.querySelectorAll('section'))n.style.display=n.dataset.surface===s?'block':'none';const section=document.querySelector('section[data-surface="'+s+'"]');section.style.width=width+'px';frame(s).style.height=(s==='status'?240:850)+'px'},
 release(tag){const out=this.held.filter(h=>h.tag===tag);this.held=this.held.filter(h=>h.tag!==tag);this.holds=this.holds.filter(h=>h.tag!==tag);out.forEach(h=>h.go());return out.length}
};
const matches=(h,kind,s,q)=>h.kind===kind&&(!h.surface||h.surface===s)&&(!h.op||h.op===q.op)&&(!h.key||h.key===q.key)&&(!h.path||h.path===q.path);
addEventListener('message',async e=>{
 const f=[...document.querySelectorAll('iframe')].find(f=>f.contentWindow===e.source),m=e.data;
 if(!f||e.origin!==location.origin||m.channel!=='openchamber.sdk')return;
 const s=f.dataset.surface,q=m.payload||{};qa.messages.push({surface:s,type:m.type});
 const result=payload=>send(s,{type:'result',id:m.id,ok:true,payload});
 const reject=(code='HOST_REJECTED')=>send(s,{type:'result',id:m.id,ok:false,code,error:'synthetic-private-error-never-render'});
 if(m.type==='hello'){qa.ready(s);return}
 if(m.type==='workspace-subscribe'){result();send(s,{type:'workspace',payload:{subscriptionId:q.subscriptionId,snapshot:q.query.kind==='projects'?{kind:'projects',state:'ready',projects:[]}:{kind:q.query.kind,state:'ready',projectId:q.query.projectId,sessions:[],worktrees:[],coverage:[]}}});return}
 if(m.type==='storage'){
  const space=qa.space,device=q.scope==='device';
  const map=device?(qa.maps.get(space)||new Map()):qa.instance; if(device)qa.maps.set(space,map);
  qa.storageLog.push({surface:s,space,...structuredClone(q)});
  if(device&&!qa.ctx.features?.deviceStorage){reject('UNSUPPORTED');return}
  const captured={storage:true,op:'get',found:map.has(q.key),...(map.has(q.key)?{value:structuredClone(map.get(q.key))}:{})};
  const go=()=>{
   const fault=qa.faults.find(h=>matches(h,'storage',s,q));if(fault){reject(fault.code);return}
   if(q.op==='get'){result(captured);return}
   if(q.op==='set'){map.set(q.key,structuredClone(q.value));result({storage:true,op:'set'});return}
   if(q.op==='delete'){map.delete(q.key);result({storage:true,op:'delete'});return}
   result({storage:true,op:'keys',keys:[...map.keys()]});
  };
  const hold=qa.holds.find(h=>matches(h,'storage',s,q));if(hold)qa.held.push({tag:hold.tag,surface:s,op:q.op,go});else go();return
 }
 if(m.type==='service-request'){
  qa.requests.push({surface:s,...structuredClone(q)});
  const go=async()=>{const fault=qa.faults.find(h=>matches(h,'service',s,q));
   if(fault){result({status:fault.status||503,body:JSON.stringify({error:'busy'})});return}
   const r=await fetch('/service',{method:'POST',body:JSON.stringify({...q,mode:qa.mode})});result(await r.json())};
  const hold=qa.holds.find(h=>matches(h,'service',s,q));if(hold)qa.held.push({tag:hold.tag,surface:s,path:q.path,go});else await go();return
 }
 if(m.type==='resize'&&s==='status'&&q.height>0)f.style.height=q.height+'px';
 if(m.id)result();
});`;

const html = `<!doctype html><html><head><meta charset="utf-8"><title>Interface language synthetic QA</title><style>body{margin:0;background:#fafafa;color:#202124;font:14px system-ui}section{margin:12px;width:360px;display:none}iframe{display:block;border:0;width:100%;height:850px}</style></head><body><button id="outside">Synthetic host focus target</button><script>${script}</script>${['panel', 'status', 'page'].map((s) => `<section data-surface="${s}"><iframe data-surface="${s}" title="${s}" src="/ui/${s}/index.html"></iframe></section>`).join('')}</body></html>`;

export async function startLanguageFixture(options: { service?: (request: { method: string; path: string; query?: Record<string, string>; body?: string; mode?: string }) => Promise<{ status: number; body: string }> } = {}) {
  const server = createServer(async (req, res) => {
    const path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
    try {
      if (path === '/') { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(html); }
      else if (/^\/ui\/(panel|status|page)\/(index\.html|main\.js)$/.test(path)) {
        const js = path.endsWith('.js');
        res.setHeader('content-type', js ? 'text/javascript' : 'text/html; charset=utf-8');
        const content = readFileSync(`.${path}`, 'utf8');
        res.end(js ? content : content.replace('<head>', `<head>${clock}`));
      } else if (path === '/service' && req.method === 'POST') {
        let text = ''; for await (const part of req) text += part;
        const q = JSON.parse(text);
        if (options.service) { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(await options.service(q))); return; }
        let status = 200, body: unknown;
        if (q.mode === 'failure') { status = 503; body = { error: 'busy' }; }
        else if (q.path === '/health') body = q.mode === 'setup' ? HEALTH_UNCONFIGURED : HEALTH;
        else if (q.path === '/v1/plans') body = plansPage(q.mode === 'empty' ? [] : [P1]);
        else if (q.path === '/v1/plan') body = planPage(P1, languageItems, []);
        else if (q.path === '/v1/document') body = envelope({ document: P1.document, text: DOCUMENT_TEXT, nextCursor: null });
        else if (q.path === '/v1/history') body = envelope({ data: [], nextCursor: null });
        else if (q.path === '/v1/setup') body = setupRead(q.mode === 'setup' ? { configured: false, verified: false, installed: false } : {});
        else { status = 404; body = { error: 'not-found' }; }
        res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ status, body: JSON.stringify(body) }));
      } else { res.statusCode = path === '/favicon.ico' ? 204 : 404; res.end(); }
    } catch { res.statusCode = 500; res.end('{"error":"fixture-failed"}'); }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { port: (server.address() as { port: number }).port, session: S.M, async stop() { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); } };
}
