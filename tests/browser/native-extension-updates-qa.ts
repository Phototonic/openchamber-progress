/** Native Settings actions layered on the existing fresh-browser/CDP owner. */
import assert from 'node:assert/strict';
import { managedBrowser } from './managed-companion-qa.ts';
import { javascriptLiteral as literal } from '../../shared/javascript-literal.ts';

export async function nativeUpdatesBrowser(options:Parameters<typeof managedBrowser>[0]) {
  const browser=await managedBrowser(options);
  const {click,text,wait,evaluate,key,send,events,guestContext,guestClick,openRail,openBoard}=browser.nativeControls;
  const settings=async()=>{
    if(await evaluate(`!!(${text('Check for updates')})`))return;
    const start=events.length;
    if(!await evaluate(`!!(${text('Close settings')})`))await click(text('Settings'));
    await click(text('Extensions'));await wait(()=>evaluate('document.body.innerText'),v=>v.includes('Add extension'),'Extensions settings');
    await wait(async()=>events.slice(start).some(e=>e.method==='Network.responseReceived'&&e.params.response.url.endsWith('/api/guests/updates/check')),Boolean,'automatic Settings check settled');
  };
  const close=async()=>{await key('Escape');};
  const check=async()=>{
    await settings();
    await wait(()=>evaluate(`[...document.querySelectorAll('button')].some(e=>e.checkVisibility()&&e.title==='Check for updates'&&!e.disabled)`),Boolean,'check action enabled after automatic check');
    const start=events.length;
    await click(text('Check for updates'));
    const request=await wait<any>(async()=>events.slice(start).find(e=>e.method==='Network.requestWillBeSent'&&e.params.request.url.endsWith('/api/guests/updates/check')&&JSON.parse(e.params.request.postData??'{}').force===true),Boolean,'actual forced check request');
    await wait(async()=>events.slice(start).some(e=>e.method==='Network.responseReceived'&&e.params.requestId===request.params.requestId),Boolean,'actual forced check response');
  };
  // Locate the smallest visible container holding this extension's name AND
  // its action. This stays scoped even when other extensions offer updates.
  const card=(action:string)=>`(()=>{const b=[...document.querySelectorAll('button')].filter(e=>e.checkVisibility()&&e.textContent.trim()===${literal(action)});return b.find(e=>{let p=e.parentElement;for(let n=0;p&&n<6;n++,p=p.parentElement){if(p.innerText.includes('Agent progress'))return !p.innerText.includes('Add extension');}return false;})})()`;
  const available=async()=>{
    if(!await evaluate(`!!(${card('Update')})`))await click(`[...document.querySelectorAll('button')].find(e=>e.checkVisibility()&&e.innerText.includes('Agent progress')&&/v[0-9]/.test(e.innerText))`);
    await wait(()=>evaluate(`!!(${card('Update')})`),Boolean,'fixture Update available action');await browser.shot('update-available');
  };
  const update=async(version:string,approval:boolean)=>{
    await available();const start=events.length;await click(card('Update'));
    await wait(async()=>events.slice(start).some(e=>e.method==='Network.responseReceived'&&e.params.response.url.endsWith('/api/guests/agent-progress-probe/update')&&e.params.response.status===200),Boolean,'native update response');
    if(approval){await wait(()=>evaluate('document.body.innerText'),v=>v.includes('Allow and enable')&&v.includes(version),'new capability approval dialog');}
    else {await wait(()=>evaluate('document.body.innerText'),v=>v.includes(version)&&!v.includes('Update available')&&!v.includes('Allow and enable'),'same-permission update settled without approval');}
  };
  const defer=async()=>{await browser.shot('permission-deferred');await click(text('Not now'));await wait(()=>evaluate('document.body.innerText'),v=>!v.includes('Allow and enable'),'approval deferred');};
  const approve=async()=>{
    if(!await evaluate('document.body.innerText.includes("Allow and enable")'))await click(card('Review permissions'));
    await wait(()=>evaluate('document.body.innerText'),v=>v.includes('Allow and enable'),'approval review');await browser.shot('permission-approved');await click(text('Allow and enable'));
    await wait(()=>evaluate('document.body.innerText'),v=>!v.includes('Allow and enable'),'approval accepted');
  };
  let languageMenuReopens=0;
  const language=async(surface:string,value:'en'|'ru')=>{
    const languageClick=async(selector:string,beforeProbe?:()=>Promise<void>)=>{try{await guestClick(surface,selector,beforeProbe);}catch{
      const diagnostic=await browser.guest(surface,`(()=>{const e=document.querySelector(${literal(selector)}),b=document.querySelector('[data-testid="interface-language"] button'),r=e?.getBoundingClientRect(),hit=r?document.elementFromPoint(r.x+r.width/2,r.y+r.height/2):null;return {language:document.documentElement.lang,button:b?.textContent,disabled:b?.disabled,targetPresent:!!e,visible:e?.checkVisibility(),rect:r?{x:r.x,y:r.y,width:r.width,height:r.height}:null,hit:hit?{tag:hit.tagName,id:hit.id,text:hit.textContent?.slice(0,80)}:null}})()`);
      throw new Error(`language actionability ${surface} ${selector}: ${JSON.stringify(diagnostic)}`);
    }};
    await wait(()=>browser.guest(surface,`(()=>{const b=document.querySelector('[data-testid="interface-language"] button');return !!b&&!b.disabled&&!document.querySelector('[data-testid="state-loading"],[data-testid="detail-loading"]')})()`),Boolean,`${surface} loaded language control`);
    await languageClick('[data-testid="interface-language"] button');
    const label=value==='ru'?'Русский':'English';
    // The pinned SDK prefixes option IDs with a new select ID on each repaint.
    // Keep only the language suffix: guestClick re-queries the current option
    // on every actionability probe instead of waiting on a detached mount's ID.
    const option=`[role="option"][id$="-${value}"]`;
    await wait(()=>browser.guest(surface,`(()=>{const b=document.querySelector('[data-testid="interface-language"] button'),e=document.querySelector(${literal(option)});return b?.getAttribute('aria-expanded')==='true'&&!!e&&!e.disabled&&e.checkVisibility()&&e.textContent.trim()===${literal(label)}})()`),Boolean,`${surface} settled ${label} menu option`);
    await languageClick(option,async()=>{
      // An asynchronous view repaint can dispose the open select after the
      // settled-menu wait. Recover that specific missing-menu state within the
      // same bounded actionability wait; never keep an old option/mount ID.
      if(await browser.guest(surface,`document.querySelector('[data-testid="interface-language"] button')?.getAttribute('aria-expanded')==='false'`)){
        languageMenuReopens++;await languageClick('[data-testid="interface-language"] button');
      }
    });
    await wait(()=>browser.guest(surface,`document.querySelector('[data-testid="interface-language"] button')?.textContent.includes(${literal(label)})`),Boolean,'saved device language');
    await wait(()=>browser.guest(surface,'document.documentElement.lang'),v=>v===value,`${surface} rendered language ${value}`);
  };
  const russianViews=async()=>{
    // Device preferences are shared, but already-mounted frames do not repaint
    // when another frame saves them. Select/reopen and verify each frame.
    const capture=async(surface:string,name:string)=>{
      await wait(()=>browser.guest(surface,'document.documentElement.lang'),v=>v==='ru',`${name} rendered Russian before capture`);
      assert.equal(await browser.guest(surface,'document.documentElement.lang'),'ru',`${name} screenshot must render Russian`);
      await browser.shot(`${name}-ru`);
    };
    await browser.selectSession('Managed acceptance');
    await openRail();
    await wait(()=>browser.guest('panel',`!!document.querySelector('[data-testid="plan-title"]')&&!document.querySelector('[data-testid="state-loading"],[data-testid="detail-loading"]')`),Boolean,'post-switch rail plan loaded');
    await language('panel','ru');await capture('panel','rail');
    await click(`[...document.querySelectorAll('button[aria-label="Close panel"]')].findLast(e=>e.checkVisibility())`);
    // Work Status has no language picker. Reopen it to read the device language
    // saved through the rail's real UI instead of retaining an English frame.
    const statusToggle=`document.querySelector('button[aria-label="Toggle work-status panel"]')`;
    if(await evaluate(`${statusToggle}?.getAttribute('aria-pressed')==='true'`)){
      await click(statusToggle);await wait(()=>guestContext('status'),v=>v===null,'Work Status closed');
    }
    await click(statusToggle);
    await wait(()=>browser.guest('status','document.body.innerText.includes("Открыть прогресс")'),Boolean,'Work Status Russian action');
    await capture('status','status');
    await openBoard();await language('page','ru');await capture('page','board');
  };
  const contexts=async()=>Object.fromEntries(await Promise.all(['panel','status','page'].map(async s=>[s,(await guestContext(s))?.id??null])));
  const routeRequests=()=>events.filter(e=>e.method==='Network.requestWillBeSent'&&(e.params.request.url.includes('/v1/extension-update')||(e.params.request.postData??'').includes('/v1/extension-update'))).length;
  const stateShot=async(name:string,selector:string)=>{
    const start=events.length;await send('Page.reload');await wait(async()=>events.slice(start).some(e=>e.method==='Page.loadEventFired'),Boolean,'fresh page loaded');
    if(!await guestContext('page'))await click(`[...document.querySelectorAll('button')].find(e=>e.checkVisibility()&&e.textContent.trim()==='Agent progress')`);
    await wait(()=>browser.guest('page',`!!document.querySelector(${literal(selector)})`),Boolean,'visible requested failure state');await browser.shot(name);
  };
  return {...browser,settings,close,check,available,update,defer,approve,language,russianViews,contexts,routeRequests,openRail,openBoard,stateShot,languageMenuReopens:()=>languageMenuReopens,
    noNotices:async()=>{for(const s of ['panel','status','page'])assert.ok(!await browser.guest(s,'!!document.querySelector("[data-testid=extension-update-notice],[data-testid=extension-update-line]")'),'no old notice');},
    hostText:()=>evaluate<string>('document.body.innerText')};
}
