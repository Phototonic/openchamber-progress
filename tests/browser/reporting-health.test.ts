import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { captureFixture } from '../fixtures/document-captures.ts';
import { createProgressServer } from '../../service/server.ts';
import { readList } from '../../ui/shared/source.ts';
import { parseSetup } from '../../ui/shared/adapter.ts';
import { ReportingHealth, setupFacts, supportSummary, type HealthClaim } from '../../ui/shared/reporting-health.ts';
import { managedCopy } from '../../ui/shared/managed-copy.ts';

async function fixture(){
 const f=captureFixture();f.record('private-document-sentinel');const request=f.request();
 const server=createProgressServer(f.store,'fixture-only');server.listen(0,'127.0.0.1');await once(server,'listening');
 const url=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
 let setup:any={configured:true,verified:true,installed:true,separateLifecycle:true,historyRetained:true,captureEnabled:true,activation:'control-applies-to-loaded-instances',version:'0.3.0',diagnostics:['private-diagnostic-sentinel'],targets:{configRoot:'/private/config',dataRoot:'/private/data',storeRoot:'/private/store'},reportingIdentity:{storeId:request.storeId,sourceId:request.source,verified:true}};
 let held=false,hold:string|null=null,release:()=>void=()=>{},copyFail=false;const calls:string[]=[],copied:string[]=[];
 const service={serviceRequest:async(q:any)=>{calls.push(q.path);const response=q.path==='/v1/setup'?{status:200,body:JSON.stringify(setup)}:await fetch(url+q.path+'?'+new URLSearchParams(q.query),{headers:{authorization:'Bearer fixture-only'}}).then(async r=>({status:r.status,body:await r.text()}));if(hold===q.path){hold=null;held=true;await new Promise<void>(r=>release=r);}return response;}};
 const result=await readList(service,{},1);assert(result.ok&&result.read);calls.length=0;
 const claim:HealthClaim={key:'one',read:result.read,plan:result.read.plans[0],stale:false};
 const controller=new ReportingHealth({service:own=>({serviceRequest:q=>own()?service.serviceRequest(q):Promise.reject(Error('retired'))}),visible:()=>true,changed:()=>{},copy:async text=>{if(copyFail)throw Error('private-error');copied.push(text);}});
 const panel=()=>controller.claim(claim);const until=async(fn:()=>boolean)=>{for(let i=0;i<1000;i++){if(fn())return;await new Promise(r=>setTimeout(r,2));}throw Error('timeout');};
 return {f,claim,controller,panel,calls,copied,until,setSetup:(patch:any)=>Object.assign(setup,patch),hold:(path:string)=>{held=false;hold=path;},held:()=>held,release:()=>release(),copyFail:()=>copyFail=true,stop:async()=>{release();await new Promise<void>(r=>server.close(()=>r()));f.cleanup();}};
}
test('explicit bounded observation reads a real stored revision and exports only allowlisted facts',async()=>{
 const x=await fixture();try{assert(!x.panel().open);assert.equal(x.calls.length,0);x.panel().toggle();await x.until(()=>!!x.panel().facts);assert.deepEqual(x.calls,['/v1/setup','/v1/plan']);assert.equal(x.panel().facts!.report,'recorded-revision');assert.equal(x.panel().facts!.viewer,'selected-report');x.panel().copySummary();await x.until(()=>x.panel().copy==='Copied.');assert(!/private|source-|capture-|\/|sentinel/.test(x.copied[0]));for(let i=0;i<10;i++)x.panel();assert.equal(x.calls.length,2);x.copyFail();x.panel().copySummary();await x.until(()=>x.panel().copy.includes('manually'));}finally{await x.stop();}
});
test('missing and mismatched setup identity never joins setup success to another viewer',async()=>{
 const x=await fixture();try{for(const reportingIdentity of [undefined,{storeId:'foreign',sourceId:'foreign',verified:true}]){x.setSetup({reportingIdentity});x.panel().toggle();await x.until(()=>!!x.panel().facts);if(reportingIdentity){assert.equal(x.panel().facts!.report,'context-changed');assert.equal(x.panel().facts!.loaded,'unknown');}else assert.equal(x.panel().facts!.scope,'association-unknown');x.panel().toggle();}assert(!x.calls.includes('/v1/plan'));}finally{await x.stop();}
});
test('close, context switch and retirement discard held setup and report responses',async()=>{
 const x=await fixture();try{for(const path of ['/v1/setup','/v1/plan'])for(const mode of ['close','context','retire']){x.hold(path);x.panel().toggle();await x.until(x.held);if(mode==='close')x.panel().toggle();else if(mode==='context'){x.claim.key+='x';x.panel();}else x.controller.retire();x.release();await new Promise(r=>setTimeout(r,15));assert.equal(x.panel().facts,null);assert(!x.panel().open);}}finally{await x.stop();}
});
test('no selection is unknown rather than no reports; stale and newer revisions remain distinct',async()=>{
 const x=await fixture();try{const plan=x.claim.plan;x.claim.plan=null;x.panel().toggle();await x.until(()=>!!x.panel().facts);assert.equal(x.panel().facts!.report,'not-checked');assert(!x.calls.includes('/v1/plan'));x.panel().toggle();x.claim.plan=plan;x.claim.stale=true;x.panel().toggle();await x.until(()=>!!x.panel().facts);assert.equal(x.panel().facts!.viewer,'stale');x.panel().toggle();x.claim.stale=false;x.f.record('new content');x.panel().toggle();await x.until(()=>!!x.panel().facts);assert.equal(x.panel().facts!.viewer,'revision-changed');}finally{await x.stop();}
});
test('summary rejects attacker-controlled values and version metadata',()=>{
 const setup=parseSetup(JSON.stringify({configured:true,installed:true,separateLifecycle:true,activation:'private',version:'1.2.3-private',diagnostics:['secret']}));const facts=setupFacts(setup);assert.equal(facts.version,'unknown');assert.equal(facts.loaded,'unknown');for(const key of Object.keys(facts))assert(!supportSummary({...facts,[key]:'private-sentinel'}).includes('private-sentinel'));
});

test('managed load, capture and delivery stay independent and support output excludes review authority',()=>{
 const base={configured:true,installed:false,separateLifecycle:false,captureEnabled:true,delivery:{kind:'managed',revision:1,configuration:'configured',migration:'none',mode:'unknown',observation:'different',expectedVersion:'1.2.3',review:{expected:'a'.repeat(64),targets:{configRoot:'/private/config',dataRoot:'/private/data',storeRoot:'/private/store'},storeId:'private-store',sourceId:'private-source'}}};
 const facts=(patch:object={})=>setupFacts(parseSetup(JSON.stringify({...base,delivery:{...base.delivery,...patch}})));
 assert.equal(facts().installation,'managed-configured'); assert.equal(facts().loaded,'different-bytes');assert.equal(facts().capture,'on');assert.equal(facts().report,'not-checked');
 assert.equal(facts({observation:'matching'}).loaded,'matching-observation');
 assert.equal(facts({observation:'matching',migration:'available'}).loaded,'legacy-unresolved');
 assert.equal(facts({observation:'matching',migration:'unavailable'}).loaded,'unknown');
 assert.equal(facts({observation:'not-observed'}).loaded,'not-observed');
 assert.equal(facts({revision:2}).installation,'legacy-unsupported');assert.equal(facts({revision:2}).loaded,'unknown');
 assert.doesNotMatch(supportSummary(facts()),/private|aaaa|\//);
});
test('managed update/load explanations retain bilingual observation and conditional restart boundaries', () => {
  for (const locale of ['en', 'ru']) {
    const text = managedCopy(locale);
    assert.ok(text.unknown && text.missing && text.matching && text.different);
    assert.match(text.observation, /OpenChamber/); assert.match(text.observation, /OPENCODE_CONFIG/);
    assert.match(text.observation, /OpenCode/);
    assert.match(text.observation, locale === 'en' ? /watched managed file can reload/ : /отслеживаемый управляемый файл может перезагрузиться/);
    assert.match(text.observation, locale === 'en' ? /does not prove.*every running session/ : /не доказывает.*всеми работающими сессиями/);
    assert.match(text.warning, locale === 'en' ? /does not block reporting/ : /не блокирует отчёты/);
    assert.match(text.observation, locale === 'en' ? /Nothing is restarted here/ : /ничего не перезапускается/);
    assert.match(text.switchEffect, locale === 'en' ? /legacy.*explicit reload/ : /старым копиям.*явная перезагрузка/);
  }
});
test('copy state translates at presentation time without another check or changing support bytes', async()=>{
  const x=await fixture();try{
    x.panel().toggle();await x.until(()=>!!x.panel().facts);
    const payload=supportSummary(x.panel().facts!);const calls=x.calls.length;
    x.panel().copySummary();
    assert.equal(x.controller.claim(x.claim,'ru').copy,'Копирование…');
    await x.until(()=>x.panel().copy==='Copied.');
    assert.equal(x.controller.claim(x.claim,'ru').copy,'Скопировано.');
    assert.equal(x.calls.length,calls);assert.equal(x.copied[0],payload);
    assert.equal(supportSummary(x.controller.claim(x.claim,'ru').facts!),payload);
    x.controller.claim(x.claim,'ru').copySummary();await x.until(()=>x.copied.length===2);
    assert.equal(x.copied[1],payload);assert.equal(x.calls.length,calls);
    x.copyFail();x.panel().copySummary();await x.until(()=>x.panel().copy.includes('manually'));
    assert.match(x.controller.claim(x.claim,'ru').copy,/вручную/);
    assert.doesNotMatch(x.controller.claim(x.claim,'ru').copy,/private-error/);
  }finally{await x.stop();}
});

test('service failures, stale viewer and source mismatch are independent observations',async()=>{
 const x=await fixture();try{
   x.claim.stale=true;x.claim.plan=null;x.setSetup({diagnostics:['storage'],reportingIdentity:undefined,captureEnabled:null});x.panel().toggle();await x.until(()=>!!x.panel().facts);assert.equal(x.panel().facts!.service,'store-unavailable');assert.equal(x.panel().facts!.viewer,'stale');assert.equal(x.panel().facts!.scope,'association-unknown');
   x.panel().toggle();x.setSetup({diagnostics:[],reportingIdentity:{storeId:x.claim.read!.storeId,sourceId:x.claim.read!.binding.sourceId,verified:x.claim.read!.binding.verified}});x.claim.plan={...x.claim.read!.plans[0],sourceId:'another-source'};x.panel().toggle();await x.until(()=>!!x.panel().facts);assert.equal(x.panel().facts!.scope,'source-mismatch');assert(!x.calls.includes('/v1/plan'));
 }finally{await x.stop();}
});
test('hidden observations and delayed clipboard results lose authority',async()=>{
 let visible=true,resolve:(v:any)=>void=()=>{},copied:()=>void=()=>{};
 const c=new ReportingHealth({service:()=>({serviceRequest:()=>new Promise(r=>resolve=r)}),visible:()=>visible,changed:()=>{},copy:()=>new Promise<void>(r=>copied=r)});
 const claim:HealthClaim={key:'one',read:null,plan:null,stale:false};const panel=()=>c.claim(claim);
 panel().toggle();visible=false;c.retire();resolve({status:200,body:JSON.stringify({configured:false,installed:false,separateLifecycle:true})});await new Promise(r=>setTimeout(r,0));visible=true;assert.equal(panel().facts,null);
 panel().toggle();resolve({status:200,body:JSON.stringify({configured:false,installed:false,separateLifecycle:true})});await new Promise(r=>setTimeout(r,0));panel().copySummary();panel().toggle();copied();await new Promise(r=>setTimeout(r,0));assert.equal(panel().copy,'');assert.equal(panel().facts,null);
});
