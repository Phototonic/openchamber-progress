import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { VERSION, LIMITS, ProgressError, identifier, type Code } from '../shared/progress.ts';
import { Store, storageError } from '../shared/store.ts';
import { SetupError, type Action } from '../setup/lifecycle.ts';
import type { SetupController } from './setup-controller.ts';
import { taskTiming } from './task-timing.ts';
import { ExtensionUpdates } from './extension-updates.ts';
import { parseCleanup } from '../shared/cleanup.ts';

/** Only fixed read/control routes. No store path, token or SQL from request bodies. */
export function createProgressServer(store: Store | undefined, token: string, unavailableCode?: Code, setup?: SetupController, updates = new ExtensionUpdates()) {
  if (!token) throw new ProgressError('binding');
  const expected = Buffer.from(`Bearer ${token}`);
  const server = http.createServer(async (req,res) => {
    function answer(status: number, body: unknown) {
      let text = JSON.stringify(body);
      if (Buffer.byteLength(text) > LIMITS.responseBytes) { status=413;text=JSON.stringify({error:'response-too-large'}); }
      res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}); res.end(text);
    }
    const supplied = Buffer.from(req.headers.authorization ?? '');
    if (supplied.length !== expected.length || !timingSafeEqual(supplied,expected)) return answer(401,{error:'unauthorized'});
    let cleanupRoute=false;
    try {
      const url = new URL(req.url ?? '/','http://127.0.0.1');
      if (url.origin !== 'http://127.0.0.1') return answer(404,{error:'not-found'});
      cleanupRoute=['/v1/plan/archive','/v1/plan/restore','/v1/plan/delete'].includes(url.pathname);
      if(cleanupRoute) {
        if(req.method!=='POST')return answer(405,{error:'method-not-allowed'});
        if(url.search)return answer(404,{error:'not-found'});
        let size=0;const chunks:Buffer[]=[];
        for await(const chunk of req){const b=Buffer.from(chunk);size+=b.length;if(size>LIMITS.requestBytes){req.resume();return answer(413,{error:'request-too-large'});}chunks.push(b);}
        let body:unknown;try{body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}catch{throw new ProgressError('invalid');}
        const action=url.pathname.endsWith('/archive')?'archive':url.pathname.endsWith('/restore')?'restore':'delete';
        const request=parseCleanup(action,body);
        const active=setup?setup.current():{store,error:unavailableCode};
        if(!active.store)return answer(503,{error:active.error??'storage'});
        return answer(200,active.store.cleanup(action,request));
      }
      if(url.pathname==='/v1/extension-update') {
        if(req.method!=='GET')return answer(405,{error:'method-not-allowed'});
        if(url.search)return answer(404,{error:'not-found'});
        if(req.headers['content-length']&&req.headers['content-length']!=='0'||req.headers['transfer-encoding'])return answer(400,{error:'body-not-allowed'});
        return answer(200,await updates.check());
      }
      if(url.pathname==='/v1/setup'||url.pathname.startsWith('/v1/setup/')) {
        if(url.search)return answer(404,{error:'not-found'});
        if(!setup)return answer(503,{error:'setup-unavailable'});
        if(url.pathname==='/v1/setup') {
          if(req.method!=='GET')return answer(405,{error:'method-not-allowed'});
          if(req.headers['content-length']&&req.headers['content-length']!=='0'||req.headers['transfer-encoding'])return answer(400,{error:'body-not-allowed'});
          return answer(200,setup.status(true));
        }
        const action=url.pathname.slice('/v1/setup/'.length);
        if(!['inspect','install','update','disable','enable','remove-capture'].includes(action))return answer(404,{error:'not-found'});
        if(req.method!=='POST')return answer(405,{error:'method-not-allowed'});
        let size=0;const chunks:Buffer[]=[];
        for await(const chunk of req){const b=Buffer.from(chunk);size+=b.length;if(size>LIMITS.requestBytes){req.resume();return answer(413,{error:'request-too-large'});}chunks.push(b);}
        let body:unknown;try{const text=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));body=text?JSON.parse(text):{};}catch{throw new ProgressError('invalid');}
        return answer(200,setup.run(action as Action,body));
      }
      if (req.headers['content-length'] && req.headers['content-length'] !== '0' || req.headers['transfer-encoding']) return answer(400,{error:'body-not-allowed'});
      const active=setup?setup.current():{store,error:unavailableCode};const currentStore=active.store;
      if (url.pathname === '/v1/capture/disable' || url.pathname === '/v1/capture/enable') {
        if (req.method !== 'POST') return answer(405,{error:'method-not-allowed'});
        if (url.search) return answer(404,{error:'not-found'});
        if(!currentStore)return answer(503,{error:active.error??'storage'});
        if(setup&&url.pathname.endsWith('/enable')){setup.run('enable',{confirmed:true});return answer(200,{ok:true,captureEnabled:true});}
        currentStore.setEnabled(url.pathname.endsWith('/enable')); return answer(200,{ok:true,captureEnabled:url.pathname.endsWith('/enable')});
      }
      if (req.method !== 'GET') return answer(405,{error:'method-not-allowed'});
      const routes: Record<string,string[]> = { '/health':[], '/v1/plans':['cursor','limit','source','session','directory','archived'], '/v1/plan':['source','plan','cursor'], '/v1/document':['source','plan','cursor','capture'], '/v1/history':['source','plan','cursor','limit'] };
      const allowed = routes[url.pathname];
      if (!allowed || [...url.searchParams.keys()].some(k => !allowed.includes(k) || url.searchParams.getAll(k).length !== 1)) return answer(404,{error:'not-found'});
      const number = (key: string, fallback: number) => { const v = url.searchParams.get(key); if (v === null) return fallback; if (!/^\d{1,9}$/.test(v)) throw new ProgressError('invalid'); return Number(v); };
      const text = (key: string, required = false) => { const v = url.searchParams.get(key) ?? undefined; if (required && !v || v !== undefined && (key === 'directory' ? v.length > 4096 || v.includes('\0') : !identifier(v))) throw new ProgressError('invalid'); return v; };
      if(url.pathname==='/health'&&!currentStore&&setup&&'configured' in active&&!active.configured&&active.error==='binding')return answer(200,{ok:true,ready:false,sqlite:false,protocolVersion:VERSION,schemaVersion:VERSION,diagnostics:setup.status().diagnostics,runtime:{node:process.versions.node,bun:process.versions.bun??null}});
      if(!currentStore)return answer(503,{error:active.error??'storage'});
      if (url.pathname === '/health') return answer(200,{ok:true,ready:true,sqlite:true,planCleanup:1,protocolVersion:VERSION,schemaVersion:VERSION,runtime:{node:process.versions.node,bun:process.versions.bun??null}});
      if (url.pathname === '/v1/plans') {
        const archived=url.searchParams.get('archived')??'exclude';if(archived!=='exclude'&&archived!=='only')throw new ProgressError('invalid');
        return answer(200,currentStore.list({cursor:number('cursor',0),limit:number('limit',20),source:text('source'),session:text('session'),directory:text('directory'),archived}));
      }
      const source = text('source',true)!; const plan = text('plan',true)!;
      if (url.pathname === '/v1/plan') {
        const detail=currentStore.detail(source,plan,number('cursor',0));
        return answer(200,{...detail,timing:taskTiming(currentStore,detail)});
      }
      if (url.pathname === '/v1/document') return answer(200,currentStore.document(source,plan,number('cursor',0),url.searchParams.has('capture')?number('capture',0):undefined));
      return answer(200,currentStore.history(source,plan,number('cursor',0),number('limit',20)));
    } catch (e) {
      if(e instanceof SetupError)return answer(e.code==='confirmation-required'||e.code==='targets-unverified'?400:409,{error:e.code});
      const error = e instanceof ProgressError ? e : storageError(e);
      if(cleanupRoute&&['conflict','operation-reused','closed'].includes(error.code))return answer(409,{error:error.code});
      return answer(error.code === 'invalid' ? 400 : error.code === 'not-found' ? 404 : 503,{error:error.code});
    }
  });
  server.requestTimeout=5000;server.headersTimeout=5000;
  const close=server.close.bind(server);
  server.close=(callback?)=>{updates.close();return close(callback);};
  server.on('close',()=>updates.close());
  return server;
}
