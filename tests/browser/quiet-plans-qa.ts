import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createProgressServer } from '../../service/server.ts';
import { PLAN_USER_CANCEL_PATH } from '../../shared/user-cancel.ts';
import { productionFixture } from '../fixtures/production.ts';
import { startLanguageFixture } from './interface-language-fixture.ts';
import { javascriptLiteral as js } from '../../shared/javascript-literal.ts';
import { chromiumPath, launchChromium } from './phone-cdp.ts';

const option=(name:string)=>{ const i=process.argv.indexOf(name);return i<0?undefined:process.argv[i+1]; };
const artifacts=option('--artifacts');
if(!artifacts)throw Error('Pass --artifacts <dir>');
mkdirSync(artifacts,{recursive:true});
const plan='sample-plan', title='Sample plan', oldTime=new Date(Date.now()-9*86_400_000).toISOString();
const f=productionFixture(), source=f.source.id;
f.store.bindReads(source,true);
f.store.apply({op:'start',plan,oid:'start',rev:0,title,items:[{id:'check',kind:'task',title:'Review example output',status:'working'}]},f.actor);
const bearer='fixture-only';
const service=createProgressServer(f.store,bearer);
const runs=[
  {width:1280,lang:'en',history:'Cancelled by user',dark:false},
  {width:390,lang:'zh-CN',history:'由用户取消',dark:true},
  {width:1280,lang:'ru',history:'Отменён пользователем',dark:true},
] as const;
const checks:string[]=[], screenshots:string[]=[], exceptions:string[]=[];
let shell:Awaited<ReturnType<typeof startLanguageFixture>>|undefined, browser:Awaited<ReturnType<typeof launchChromium>>|undefined;
let didPass=false, loseReply=false, posts=0, phase='startup';
const more='[data-testid="more-trigger"]', finish='[data-menu-id="finish-cancelled"]', history='[data-menu-id="history"]';
const keep='[data-testid="plan-cancel-keep"] button', confirm='[data-testid="plan-cancel-confirm"] button';
const filtered='[data-testid="quiet-plans-empty"]', show='[data-testid="quiet-show-all"] button';
const menuFilter='[data-menu-id="quiet-plan-filter"]', heading='[data-testid="plan-title"]';
const by=(selector:string)=>`d.querySelector(${js(selector)})`;
const mark=(id:string)=>checks.push(id);
try{
  service.listen(0,'127.0.0.1');await once(service,'listening');
  const base=`http://127.0.0.1:${(service.address() as {port:number}).port}`;
  shell=await startLanguageFixture({source:process.argv.includes('--source'),async service(q){
    // The synthetic SDK proxy forwards guest requests only to its owned service.
    const url=new URL(q.path,base);
    if(url.origin!==base)return {status:404,body:'{"error":"not-found"}'};
    url.search=new URLSearchParams(q.query).toString();
    const cancellation=url.pathname===PLAN_USER_CANCEL_PATH && q.method==='POST';
    if(cancellation)posts++;
    const reply=await fetch(url,{method:q.method,body:q.body,headers:{authorization:`Bearer ${bearer}`},signal:AbortSignal.timeout(5000)});
    const body=await reply.text();
    return {status:reply.status,body:cancellation&&loseReply?'lost receipt':body};
  }});
  browser=await launchChromium(chromiumPath(option('--chromium')));
  const c=browser.page;
  await c.send('Runtime.enable');await c.send('Page.enable');
  await c.send('Emulation.setFocusEmulationEnabled',{enabled:true});
  const evaluate=async <T=unknown>(expression:string):Promise<T>=>{
    const r=await c.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
    if(r.exceptionDetails)throw Error(r.exceptionDetails.text);
    return r.result.value as T;
  };
  let surface='panel', width=1280;
  const guest=<T=unknown>(body:string)=>evaluate<T>(`(()=>{const w=frame(${js(surface)}).contentWindow,d=w.document;${body}})()`);
  const wait=async (condition:string)=>{
    const ok=await evaluate(`(async()=>{const end=performance.now()+7500;while(performance.now()<end){
      try{const w=frame(${js(surface)}).contentWindow,d=w.document;if(${condition})return true}catch{}
      await new Promise(r=>requestAnimationFrame(r));
    }return false})()`);
    assert.ok(ok,`${phase}: ${surface}: ${condition}; ${await guest('return d.body?.innerText.slice(0,350)')}`);
  };
  const exists=(selector:string)=>wait(`!!${by(selector)}`);
  const click=async (selector:string)=>{
    await exists(selector);
    await guest(`${by(selector)}.scrollIntoView({block:'center'});return new Promise(r=>w.requestAnimationFrame(()=>w.requestAnimationFrame(r)))`);
    const [x,y]=await guest<[number,number]>(`const r=${by(selector)}.getBoundingClientRect(),o=w.frameElement.getBoundingClientRect();return [o.x+r.x+r.width/2,o.y+r.y+r.height/2]`);
    if(width===390){
      await c.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
      await c.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    }else for(const type of ['mousePressed','mouseReleased'])await c.send('Input.dispatchMouseEvent',{type,x,y,button:'left',clickCount:1});
  };
  const escape=async()=>{
    for(const type of ['keyDown','keyUp'])await c.send('Input.dispatchKeyEvent',{type,key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  };
  const shot=async (name:string)=>{
    const png=await c.send('Page.captureScreenshot',{format:'png',clip:{x:0,y:0,width,height:844,scale:1}});
    const file=`${name}.png`;
    writeFileSync(join(artifacts,file),Buffer.from(png.data,'base64'));screenshots.push(file);
  };
  const select=async (name:string,lang:string)=>{
    surface=name;
    await evaluate(`qa.show(${js(name)},${width});true`);
    await wait(`d.documentElement.lang===${js(lang)}`);
  };
  const menu=()=>click(more);
  const checkFiltered=async()=>{
    await exists(show);
    assert.equal(await guest(`return d.querySelectorAll(${js(filtered)}).length`),1);
    assert.equal(await guest(`return !!${by('[data-testid="list-empty"], [data-testid="filtered-empty"], [data-testid="empty-state"]')}`),false);
  };
  const began=()=>f.store.get(source,plan)!;
  for(const {width:nextWidth,lang,history:userHistory,dark} of runs){
    phase=`${lang}: fixture setup`;width=nextWidth;
    const old=began();
    if(old.lifecycle!=='active')f.store.apply({op:'revise',plan,oid:`reopen-${lang}`,rev:old.revision,title,reopen:true},f.actor);
    const active=began(), rev=active.revision, initialPosts=posts;
    const aged=JSON.stringify({...active,reportedAt:oldTime});
    f.store.db.prepare('UPDATE plans SET snapshot=? WHERE source=? AND id=?').run(aged,source,plan);
    f.store.db.prepare('UPDATE revisions SET snapshot=? WHERE source=? AND plan=? AND revision=?').run(aged,source,plan,rev);
    await c.send('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:width===390});
    await c.send('Emulation.setTouchEmulationEnabled',{enabled:width===390});
    await c.send('Page.navigate',{url:`http://127.0.0.1:${shell.port}/`});
    const prefix=`${width}-${lang}`;
    await evaluate(`(async()=>{while(!window.qa || !frame('panel'))await new Promise(r=>requestAnimationFrame(r));
      document.querySelector('#outside').hidden=true;document.querySelectorAll('section').forEach(n=>n.style.margin='0');
      qa.context(${js(f.actor.sessionId)});qa.ready(undefined,{locale:${js(lang)},device:{formFactor:${js(width===390?'phone':'desktop')},pointer:${js(width===390?'coarse':'fine')},insets:{top:0,right:0,bottom:0,left:0},keyboard:0}});${dark?'qa.dark();':''}
      return true;})()`);
    phase=`${lang}: default filter`;
    await select('panel',lang);await checkFiltered();
    if(width===390)await shot(`${prefix}-rail-filtered`);
    await select('page',lang);await checkFiltered();await shot(`${prefix}-filtered`);
    await select('status',lang);
    await wait(`${by('[data-testid="status-plan-title"]')}?.textContent===${js(title)}`);
    mark(`${prefix}: one filter empty message on rail and board; Work Status unchanged`);
    await select('panel',lang);
    await menu();await wait(`${by(menuFilter)}?.getAttribute('aria-checked')==='true'`);
    await escape();await click(show);await exists('[data-testid="quiet-plan-age"]');
    await evaluate(`qa.reload('panel');true`);
    await wait(`w.location.search.startsWith('?reload=') && !!${by(heading)} && !${by(filtered)}`);
    await select('page',lang);await evaluate(`qa.focus('page');qa.tick('page');true`);await exists(heading);
    mark(`${prefix}: Show all persisted after reload and reached board`);

    phase=`${lang}: cancel confirmation`;
    if(width===390)await select('panel',lang);
    const listView='[data-testid="plan-view-list"] button';
    const mapView='[data-testid="plan-view-map"] button';
    await exists(listView);await exists(mapView);
    const view=()=>guest(`return [${by(listView)}.getAttribute('aria-pressed'),${by(mapView)}.getAttribute('aria-pressed')]`);
    const selectedView=await view();
    await menu();await exists(finish);await shot(`${prefix}-more`);
    await click(finish);await wait(`d.activeElement===${by(keep)} && !!${by(confirm)}`);
    await shot(`${prefix}-confirmation`);
    await click(keep);await wait(`!${by(confirm)} && d.activeElement===${by(more)}`);
    await menu();await click(finish);await exists(confirm);await escape();await wait(`!${by(confirm)} && d.activeElement===${by(more)}`);
    await menu();await click(finish);await exists(confirm);
    await evaluate(`qa.visible(${js(surface)},false);qa.visible(${js(surface)},true);true`);
    await wait(`!${by(confirm)}`);
    assert.equal(posts,initialPosts);
    assert.deepEqual(await view(),selectedView);
    mark(`${prefix}: Keep, Escape and view retirement never POST or change the task view`);

    phase=`${lang}: resumed report`;
    await select('panel',lang);
    await menu();await click(menuFilter);await exists(filtered);
    f.store.apply({op:'change',plan,oid:`resume-${lang}`,rev,changes:[{id:'check',status:'working'}]},f.actor);
    await evaluate(`qa.focus('panel');qa.tick('panel');true`);await exists(heading);
    assert.equal(await guest(`return !!${by('[data-testid="quiet-plan-age"]')}`),false);
    mark(`${prefix}: fresh report returns hidden plan`);
    if(lang==='ru'){
      await evaluate(`qa.ready('panel',{features:{deviceStorage:false}});true`);
      await exists('[data-testid="quiet-filter-note"]');
      mark(`${prefix}: unavailable storage explained`);
    }
    phase=`${lang}: commit and read history`;
    loseReply=lang==='ru';
    await menu();await click(finish);await click(confirm);
    if(loseReply){
      await wait(`qa.toasts.some(t=>t.kind==='error' && t.message.includes('Не удалось подтвердить отмену')) && !qa.toasts.some(t=>t.kind==='success')`);
      mark(`${prefix}: committed action with lost receipt does not claim success`);
      await evaluate(`qa.focus('panel');qa.tick('panel');true`);
    }else {
      await wait(`qa.toasts.some(t=>t.kind==='success')`);
      mark(`${prefix}: SDK success toast followed the validated receipt`);
    }
    await select('page',lang);await evaluate(`qa.focus('page');qa.tick('page');true`);
    const fold='[data-testid="board-finished-toggle"]';
    await exists(fold);
    if(await guest(`return ${by(fold)}.getAttribute('aria-expanded')==='false'`))await click(fold);
    await click(`[data-testid="plan-row-${plan}"][data-lifecycle="cancelled"]`);
    await exists(heading);await menu();await click(history);
    const entry=`[data-testid="revision-${rev+2}"]`;
    await wait(`${by(entry)}?.textContent.includes(${js(userHistory)})`);
    await shot(`${prefix}-cancelled-history`);
    assert.equal(posts,initialPosts+1);
    assert.equal(began().lifecycle,'cancelled');
    assert.equal(began().items[0]!.status,'working');
    mark(`${prefix}: one POST, retained task and user-attributed history`);
  }
  exceptions.push(...c.errors.map(()=> 'browser console error or uncaught exception'));
  assert.deepEqual(exceptions,[]);
  didPass=true;
}finally{
  writeFileSync(join(artifacts,'results.json'),JSON.stringify({pass:didPass,phase,checks,screenshots,exceptions},null,2)+'\n');
  try{await browser?.stop();}finally{
    try{await shell?.stop();}finally{
      service.closeAllConnections();await new Promise<void>(resolve=>service.close(()=>resolve()));f.cleanup();
    }
  }
}
