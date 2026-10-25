import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { readFileSync, writeFileSync, readdirSync, lstatSync } from 'node:fs';
import { resolve } from 'node:path';
import { createProgressServer } from '../../service/server.ts';
import { ExtensionUpdates, OFFICIAL_MANIFEST, UPDATE_LIMITS, compareUpdateVersions } from '../../service/extension-updates.ts';
import { SetupController } from '../../service/setup-controller.ts';
import { productionFixture } from '../fixtures/production.ts';
import type { ExtensionUpdateRead } from '../../shared/progress.ts';

const manifest=JSON.parse(readFileSync(new URL('../../package.json',import.meta.url),'utf8'));
const body=(version='0.2.5')=>JSON.stringify({...manifest,version});
const deferred=()=>{let resolve!:()=>void;const promise=new Promise<void>(r=>resolve=r);return{promise,resolve};};
type Responder=(req:http.IncomingMessage,res:http.ServerResponse)=>void;

async function fixture(options:{timeoutMs?:number; setup?:SetupController; corrupt?:boolean}={}) {
  let now=Date.UTC(2026,0,1), responder:Responder=(_req,res)=>res.end(body());
  const metadata=http.createServer((req,res)=>responder(req,res));metadata.listen(0,'127.0.0.1');await once(metadata,'listening');
  const outbound:{url:string;init:RequestInit}[]=[];
  const checker=new ExtensionUpdates({now:()=>now,timeoutMs:options.timeoutMs,transport:async(url,init)=>{
    outbound.push({url,init});return fetch(`http://127.0.0.1:${(metadata.address() as any).port}/manifest`,init);
  }});
  const server=createProgressServer(undefined,'fixture-only',options.corrupt?'corrupt':undefined,options.setup,checker);
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const base=`http://127.0.0.1:${(server.address() as any).port}`,headers={authorization:'Bearer fixture-only'};
  return {metadata,server,checker,outbound,base,headers,
    set(fn:Responder){responder=fn;},advance(ms:number){now+=ms;},get now(){return now;},
    async get(){const r=await fetch(`${base}/v1/extension-update`,{headers});assert.equal(r.status,200);return await r.json() as ExtensionUpdateRead;},
    async close(){await new Promise<void>(r=>server.close(()=>r()));metadata.closeAllConnections();await new Promise<void>(r=>metadata.close(()=>r()));},
  };
}

test('QA-U fixed authenticated route refuses guest controls before outbound/store work',{timeout:15000},async()=>{
  const f=productionFixture();
  const setup=new SetupController(`${f.root}/unconfigured-binding.json`,()=>{throw new Error('unused');});
  // A store lookup here would fail this test, not just return an unconfigured state.
  setup.current=()=>{throw new Error('must not consult companion/store');};
  const h=await fixture({setup});
  try {
    for(const headers of [{},{authorization:'Bearer wrong'}] as Record<string,string>[])assert.equal((await fetch(`${h.base}/v1/extension-update`,{headers})).status,401);
    assert.equal((await fetch(`${h.base}/v1/extension-update`,{method:'POST',headers:h.headers})).status,405);
    for(const query of ['?url=http://evil.invalid','?ref=dev','?repository=other','?source=x','?ref=main&ref=dev'])
      assert.equal((await fetch(`${h.base}/v1/extension-update${query}`,{headers:h.headers})).status,404);
    const status=await new Promise<number>((resolve,reject)=>{
      const req=http.request(`${h.base}/v1/extension-update`,{method:'GET',headers:{...h.headers,'content-length':'2'}},res=>{res.resume();resolve(res.statusCode!);});req.on('error',reject);req.end('{}');
    });assert.equal(status,400);assert.equal(h.outbound.length,0);
    const result=await h.get();assert.equal(result.state,'available');assert.equal(result.installedVersion,'0.2.4');
    assert.equal(result.repository,'Phototonic/openchamber-progress');assert.equal(result.ref,'main');assert.equal(result.stale,false);assert.equal(result.diagnostic,'ok');
    const sent=h.outbound[0]!;assert.equal(sent.url,OFFICIAL_MANIFEST);
    assert.equal(sent.url,'https://api.github.com/repos/Phototonic/openchamber-progress/contents/package.json?ref=main');
    const headers=new Headers(sent.init.headers);assert.equal(headers.get('accept'),'application/vnd.github.raw+json');
    assert.equal(headers.has('authorization'),false);assert.equal(headers.has('cookie'),false);assert.equal(sent.init.credentials,'omit');assert.equal(sent.init.redirect,'manual');assert.equal(sent.init.method,'GET');
    assert.equal(Object.keys(result).some(k=>/url|html|body|token/i.test(k)),false);
  }finally{await h.close();setup.close();f.cleanup();}
});

test('QA-U manifest validation and numeric/prerelease ordering through actual HTTP',{timeout:15000},async()=>{
  const h=await fixture({corrupt:true});
  try {
    const cases:[string,string][]=[['0.2.5','available'],['0.2.4','not-newer'],['0.2.3','not-newer'],['0.10.0','available'],['0.2.4-rc.1','not-newer'],['0.2.5-beta.2','available'],['0.2.4+changed','not-newer']];
    for(const [version,state] of cases){h.set((_req,res)=>res.end(body(version)));h.advance(UPDATE_LIMITS.successMs);const r=await h.get();assert.equal(r.state,state);assert.equal(r.candidateVersion,version);}
    h.set((_req,res)=>res.end(JSON.stringify({...manifest,version:'0.2.4',description:'same version, other bytes'})));
    h.advance(UPDATE_LIMITS.successMs);assert.equal((await h.get()).state,'not-newer');
    for(const [a,b,expected] of [['0.10.0','0.9.0',1],['1.0.0-beta.10','1.0.0-beta.2',1],['1.0.0-1','1.0.0-a',-1],['1.0.0-rc','1.0.0',-1],['1.0.0-a','1.0.0-a.1',-1],['1.0.0+abc','1.0.0+def',0]] as const)assert.equal(compareUpdateVersions(a,b),expected);
    const invalid:unknown[]=[null,{}, {version:'0.2.5'}, {...manifest,version:'01.2.5'}, {...manifest,version:'0.2.5-01'}, {...manifest,version:'<script>'}, {...manifest,version:'0.2.5',openchamber:{...manifest.openchamber,apiVersion:999}}];
    for(const field of ['panel','page','statusSection','service']){
      const m=structuredClone(manifest);m.version='0.2.5';delete m.openchamber.contributes[field];invalid.push(m);
    }
    const wrong=structuredClone(manifest);wrong.openchamber.contributes.panel.id='foreign-extension';invalid.push(wrong);
    const unsafe=structuredClone(manifest);unsafe.openchamber.contributes.service.entry='https://evil.invalid/run.js';invalid.push(unsafe);
    for(const value of invalid){h.set((_req,res)=>res.end(JSON.stringify(value)));h.advance(UPDATE_LIMITS.successMs);const r=await h.get();assert.equal(r.diagnostic,'invalid-manifest');assert.equal(r.stale,true);assert.equal(r.candidateVersion,'0.2.4');}
    h.set((_req,res)=>res.end('{not JSON'));h.advance(UPDATE_LIMITS.failureMs);assert.equal((await h.get()).diagnostic,'invalid-manifest');
    // This is deliberately metadata only: no fixture runtime entries exist at this origin.
    h.set((_req,res)=>res.end(body('0.2.5')));h.advance(UPDATE_LIMITS.failureMs);const recovered=await h.get();assert.equal(recovered.state,'available');assert.equal(recovered.stale,false);assert.equal(recovered.diagnostic,'ok');
    assert.equal((await fetch(`${h.base}/v1/plans`,{headers:h.headers})).status,503,'store failure remains independent');
  }finally{await h.close();}
});

test('QA-U service-wide coalescing, TTL, conditional cache, stale retention and provider deadlines',{timeout:15000},async()=>{
  const h=await fixture();
  try {
    const entered=deferred(),release=deferred();
    h.set((_req,res)=>{entered.resolve();void release.promise.then(()=>{res.setHeader('etag','"main-v1"');res.end(body());});});
    const requests=Array.from({length:8},()=>h.get());await entered.promise;assert.equal(h.outbound.length,1);release.resolve();
    const first=(await Promise.all(requests))[0]!;assert.equal(first.state,'available');assert.equal(h.outbound.length,1);
    assert.equal(Date.parse(first.nextCheckAt),h.now+UPDATE_LIMITS.successMs);
    await h.get();h.advance(UPDATE_LIMITS.successMs-1);await h.get();assert.equal(h.outbound.length,1);
    h.advance(1);h.set((req,res)=>{assert.equal(req.headers['if-none-match'],'"main-v1"');res.writeHead(304);res.end();});
    const refreshed=await h.get();assert.equal(refreshed.diagnostic,'ok');assert.equal(refreshed.candidateVersion,'0.2.5');assert.notEqual(refreshed.checkedAt,first.checkedAt);
    h.advance(UPDATE_LIMITS.successMs);h.set((_req,res)=>{res.writeHead(304,{etag:'"foreign"'});res.end();});
    const mismatch=await h.get();assert.equal(mismatch.diagnostic,'invalid-response');assert.equal(mismatch.checkedAt,refreshed.checkedAt);assert.equal(mismatch.stale,true);
    h.advance(UPDATE_LIMITS.failureMs);
    h.set((_req,res)=>{res.writeHead(503);res.end('private raw body must not escape');});
    const stale=await h.get();assert.equal(stale.state,'available');assert.equal(stale.stale,true);assert.equal(stale.checkedAt,refreshed.checkedAt);assert.equal(stale.diagnostic,'unavailable');
    const count=h.outbound.length;await h.get();h.advance(UPDATE_LIMITS.failureMs-1);await h.get();assert.equal(h.outbound.length,count);
    h.advance(1);h.set((_req,res)=>{res.writeHead(429,{'retry-after':'7200','x-ratelimit-remaining':'0','x-ratelimit-reset':String((h.now+3*60*60*1000)/1000)});res.end();});
    const rate=await h.get();assert.equal(rate.diagnostic,'rate-limited');assert.equal(Date.parse(rate.nextCheckAt),h.now+3*60*60*1000);assert.equal(rate.checkedAt,refreshed.checkedAt);
    const rateCount=h.outbound.length;h.advance(2*60*60*1000);await h.get();assert.equal(h.outbound.length,rateCount);
    h.advance(60*60*1000);h.set((_req,res)=>{res.writeHead(403,{'retry-after':new Date(h.now+600_000).toUTCString()});res.end();});
    assert.equal(Date.parse((await h.get()).nextCheckAt),h.now+600_000);
  }finally{await h.close();}
});

test('QA-U unknown HTTP/redirect/size/invalid responses never become current, 304 requires matching cache',{timeout:15000},async()=>{
  const h=await fixture();
  try {
    const cases:[Responder,string][]=[
      [(_req,res)=>{res.writeHead(304);res.end();},'invalid-response'],
      ...[401,403,404,500].map(status=>[((_req,res)=>{res.writeHead(status);res.end('inaccessible');}) as Responder,'unavailable'] as [Responder,string]),
      [(_req,res)=>{res.writeHead(302,{location:'https://evil.invalid/redirect'});res.end();},'redirect'],
      [(_req,res)=>{res.writeHead(200,{'content-length':String(UPDATE_LIMITS.bytes+1)});res.end('x');},'too-large'],
      [(_req,res)=>{res.writeHead(200);res.write('x'.repeat(UPDATE_LIMITS.bytes));res.end('x');},'too-large'],
      [(_req,res)=>res.end(Buffer.from([0xff,0xfe])),'invalid-manifest'],
    ];
    for(const [respond,diagnostic] of cases){h.set(respond);h.advance(UPDATE_LIMITS.failureMs);const r=await h.get();assert.equal(r.state,'unknown');assert.equal(r.checkedAt,null);assert.equal(r.candidateVersion,undefined);assert.equal(r.diagnostic,diagnostic);assert.equal(r.stale,false);assert.ok(Number.isFinite(Date.parse(r.nextCheckAt)));}
    assert.equal(h.outbound.length,cases.length,'redirects were not followed');
  }finally{await h.close();}
});

test('QA-U body/header deadline and service shutdown abort owned real HTTP work',{timeout:15000},async()=>{
  for(const sendHeaders of [false,true]){
    const h=await fixture({timeoutMs:75});
    try {
      const entered=deferred();h.set((_req,res)=>{if(sendHeaders){res.writeHead(200);res.flushHeaders();res.write('{');}entered.resolve();});
      const waiting=h.get();await entered.promise;const result=await waiting;assert.equal(result.diagnostic,'timeout');assert.equal(result.state,'unknown');assert.equal(h.outbound[0]!.init.signal!.aborted,true);
    }finally{await h.close();}
  }
  const h=await fixture();
  try {
    const entered=deferred();h.set((_req,res)=>{res.writeHead(200);res.flushHeaders();entered.resolve();});
    const waiting=h.get();await entered.promise;const closed=new Promise<void>(r=>h.server.close(()=>r()));
    const result=await waiting;assert.equal(result.diagnostic,'shutdown');assert.equal(h.outbound[0]!.init.signal!.aborted,true);await closed;
  }finally{await h.close();}
});

test('QA-U GETs preserve isolated extension/companion selection/config/store bytes',{timeout:15000},async()=>{
  const f=productionFixture();
  const setup=new SetupController(`${f.root}/service-binding.json`,()=>({plugin:'export default {}',guidance:'Fixture only',removal:'// fixture',version:'0.2.4'}));
  setup.run('install',{configRoot:f.source.configRoot,dataRoot:f.source.dataRoot,storeRoot:`${f.root}/store`,confirmed:true});
  f.store.apply({op:'start',plan:'P1',oid:'start',rev:0,title:'Preserved',items:[]},f.actor);
  writeFileSync(`${f.root}/config/user-config.json`,'{"keep":"user settings"}');writeFileSync(`${f.root}/extension-package.json`,body('0.2.4'));
  const snapshot=(root:string):Record<string,string>=>Object.fromEntries(readdirSync(root,{recursive:true}).map(String).map(p=>[p,resolve(root,p)]).filter(([,p])=>lstatSync(p!).isFile()).map(([p,file])=>[p!,readFileSync(file!).toString('base64')]));
  const before=snapshot(f.root),history=f.store.history(f.source.id,'P1');
  const h=await fixture({setup});
  try {
    await h.get();await h.get();h.advance(UPDATE_LIMITS.successMs);h.set((_req,res)=>{res.writeHead(404);res.end();});await h.get();
    assert.deepEqual(snapshot(f.root),before);assert.deepEqual(f.store.history(f.source.id,'P1'),history);
  }finally{await h.close();setup.close();f.cleanup();}
});
