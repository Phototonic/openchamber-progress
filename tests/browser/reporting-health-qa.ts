// Current-bundle browser QA over real disposable stores. Synthetic SDK seams are explicit;
// this does not certify a native host, screen reader, live profile or installed companion.
// node --experimental-strip-types tests/browser/reporting-health-qa.ts <artifact-directory> [--built-service]
import { javascriptLiteral } from '../../shared/javascript-literal.ts';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { startSearchShell } from './plan-task-search-shell.ts';

const output=process.argv[2];if(!output)throw Error('Pass an artifact directory.');mkdirSync(output,{recursive:true});
const cache=join(homedir(),'.cache/ms-playwright');
const candidates=[...(process.env.CHROMIUM_PATH?[process.env.CHROMIUM_PATH]:[]),...(existsSync(cache)?readdirSync(cache).filter(n=>/^chromium-\d+$/.test(n)).sort().reverse().map(n=>join(cache,n,'chrome-linux64/chrome')):[]),'/usr/bin/chromium','/usr/bin/google-chrome'];
const executable=candidates.find(existsSync);if(!executable)throw Error('No installed Chromium; this test never downloads a browser.');
const profile=mkdtempSync('/tmp/opencode/reporting-health-qa-');
const fx=await startSearchShell(true, true);
const chrome=spawn(executable,['--headless=new','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','--disable-extensions','--disable-background-networking','--disable-sync','--window-size=1280,1100','about:blank'],{stdio:'ignore'});
const results:{id:string;pass:boolean;facts?:unknown}[]=[];let ws:WebSocket|undefined;let failure:string|null=null;let diagnose:(()=>Promise<unknown>)|undefined;
try{
  for(let n=0;!existsSync(join(profile,'DevToolsActivePort'))&&n<200;n++)await new Promise(r=>setTimeout(r,50));
  const port=Number(readFileSync(join(profile,'DevToolsActivePort'),'utf8').split('\n')[0]);
  const targets=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();ws=new WebSocket(targets.find((t:any)=>t.type==='page').webSocketDebuggerUrl);
  await new Promise<void>((resolve,reject)=>{ws!.onopen=()=>resolve();ws!.onerror=()=>reject(Error('Browser connection failed.'));});
  let next=0;const pending=new Map<number,{resolve:(v:any)=>void;reject:(e:Error)=>void}>();const remote:string[]=[];let runtimeErrors=0;
  ws.onmessage=e=>{const m=JSON.parse(String(e.data)),p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}else{if(m.method==='Runtime.exceptionThrown')runtimeErrors++;if(m.method==='Network.requestWillBeSent'&&!m.params.request.url.startsWith('http://127.0.0.1:')&&!m.params.request.url.startsWith('data:'))remote.push(m.params.request.url);}};
  const send=(method:string,params:object={})=>new Promise<any>((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject});ws!.send(JSON.stringify({id,method,params}));});
  const evaluate=async<T=any>(expression:string):Promise<T>=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description??'Browser expression failed');return r.result.value;};
  const guest=<T=any>(code:string)=>evaluate<T>(`(()=>{const w=frame('page').contentWindow,d=w.document;${code}})()`);
  diagnose=()=>guest(`return {health:d.querySelector('[data-testid="reporting-health"]')?.textContent,active:d.activeElement?.outerHTML,query:d.getElementById('ap-search-q')?.value,search:d.querySelector('[data-testid="search-results"]')?.textContent?.slice(0,2500),buttons:[...d.querySelectorAll('button')].map(n=>n.textContent).slice(-30),requests:qa.requests.slice(-8).map(q=>({path:q.path,frame:q.frame}))}`);
  const wait=async(condition:string,label:string)=>{const ok=await evaluate(`(async()=>{const end=performance.now()+20000;while(performance.now()<end){try{const w=frame('page').contentWindow,d=w.document;if(${condition})return true}catch{}await new Promise(r=>setTimeout(r,25))}return false})()`);if(!ok)throw Error('Timed out: '+label);};
  const check=(id:string,pass:boolean,facts?:unknown)=>{results.push({id,pass,...(facts===undefined?{}:{facts})});if(!pass)throw Error('Failed: '+id);};
  const key=async(k:string)=>{const code:Record<string,number>={Enter:13,Tab:9,ArrowDown:40,ArrowUp:38,Escape:27,Home:36,Space:32};const key=k==='Space'?' ':k;await send('Input.dispatchKeyEvent',{type:'keyDown',key,code:k,windowsVirtualKeyCode:code[k]??0,...(k==='Enter'?{text:'\r'}:k==='Space'?{text:' '}:{})});await send('Input.dispatchKeyEvent',{type:'keyUp',key,code:k,windowsVirtualKeyCode:code[k]??0});};
  const click=async(selector:string)=>{
    const xy=await evaluate(`(async()=>{const end=performance.now()+20000;let prior='';while(performance.now()<end){const f=frame('page'),d=f.contentDocument,n=d.querySelector(${javascriptLiteral(selector)});if(n){n.scrollIntoView({block:'center'});await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const a=n.getBoundingClientRect(),b=f.getBoundingClientRect(),x=a.x+a.width/2,y=a.y+a.height/2,hit=d.elementFromPoint(x,y),p=[x+b.x,y+b.y],same=JSON.stringify(p)===prior;prior=JSON.stringify(p);if(n.isConnected&&same&&a.width&&a.height&&(hit===n||n.contains(hit))&&document.elementFromPoint(p[0],p[1])===f)return p}else await new Promise(r=>requestAnimationFrame(r))}throw Error(${javascriptLiteral('Not actionable: '+selector)})})()`);
    for(const type of ['mouseMoved','mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,x:xy[0],y:xy[1],button:'left',clickCount:1});
  };
  const focus=async(selector:string)=>guest(`w.focus();d.querySelector(${javascriptLiteral(selector)}).focus();return new Promise(r=>w.requestAnimationFrame(()=>w.requestAnimationFrame(r)))`);
  await send('Runtime.enable');await send('Page.enable');await send('Network.enable');await send('Emulation.setFocusEmulationEnabled',{enabled:true});
  await send('Page.navigate',{url:`http://127.0.0.1:${fx.port}/`});await evaluate(`qa.show(['page'],1100);true`);
  // The first complete list adopts the service's Store/source identity and retires
  // earlier reporting observations. Start the interaction only in that reading.
  await wait(`!!d.querySelector('article[data-testid^="plan-"]')&&!d.querySelector('[data-testid="state-loading"]')&&!!d.querySelector('[data-testid="reporting-health-toggle"] button')`,'adopted initial reading');
  await focus('[data-testid="reporting-health-toggle"] button');await key('Enter');await wait(`!!d.querySelector('[data-testid="reporting-support-preview"]')`,'observations');
  check('secondary-placement',await guest(`return !!d.querySelector('.ap-footer [data-testid="reporting-health"]')`));
  check('details-collapsed-by-default',await guest(`return !d.querySelector('[data-testid="reporting-explanations"]').open&&!d.querySelector('[data-testid="reporting-support"]').open`));
  check('compact-status-overview',await guest(`return d.querySelectorAll('.ap-health-row').length===7&&d.querySelector('.ap-health-grid').getBoundingClientRect().height<330`));
  await focus('[data-testid="reporting-support"] summary');await key('Enter');await wait(`d.querySelector('[data-testid="reporting-support"]').open`,'support expanded');
  check('keyboard-open',await guest(`return d.querySelector('[data-testid="reporting-health-toggle"] button').getAttribute('aria-expanded')==='true'`));
  check('privacy-preview',await guest(`return !/fixture|source-|account-|private|\\//.test(d.querySelector('[data-testid="reporting-support-preview"]').value)`));
  await guest(`Object.defineProperty(w.navigator,'clipboard',{configurable:true,value:{writeText:()=>Promise.reject(new Error('fixture rejection'))}});return true`);
  await click('[data-testid="reporting-support-copy"] button');await wait(`d.querySelector('[data-testid="reporting-health"]').textContent.includes('manually')`,'copy fallback');check('copy-fallback',true);
  await guest(`const n=d.querySelector('[data-testid="reporting-support-preview"]');n.focus();n.setSelectionRange(3,24);return true`);
  await guest(`d.querySelector('[data-testid="reporting-support-preview"]').dataset.qaOld='true';d.querySelector('[data-testid="reporting-support-copy"] button').click();return true`);await wait(`d.querySelector('[data-testid="reporting-support-preview"]')?.dataset.qaOld===undefined&&d.querySelector('[data-testid="reporting-support-preview"]')?.selectionStart===3`,'selection retained after actual replacement');check('selection-preserved-on-repaint',await guest(`return d.querySelector('[data-testid="reporting-support-preview"]').selectionEnd===24`));
  await evaluate(`qa.show(['page'],360);true`);await wait('w.innerWidth===360','narrow');check('narrow-preview',await guest(`const n=d.querySelector('[data-testid="reporting-support-preview"]');return n.getBoundingClientRect().width<=360`));
  await evaluate('new Promise(r=>setTimeout(r,250))');
  if(await guest(`return !d.querySelector('[data-testid="reporting-support-preview"]')`)){await focus('[data-testid="reporting-health-toggle"] button');await key('Enter');await wait(`!!d.querySelector('[data-testid="reporting-support-preview"]')`,'reopen after host context update');}
  await guest(`d.querySelector('[data-testid="reporting-support"]').open=false;d.querySelector('[data-testid="reporting-explanations"]').open=false;return true`);await guest(`d.querySelector('[data-testid="reporting-health"]').scrollIntoView({block:'start'});return true`);await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  const clip=await evaluate(`(()=>{const f=frame('page'),n=f.contentDocument.querySelector('[data-testid="reporting-health"]'),a=n.getBoundingClientRect(),b=f.getBoundingClientRect();return {x:Math.floor(window.scrollX+b.left+a.left),y:Math.floor(window.scrollY+b.top+a.top),width:Math.ceil(a.width),height:Math.ceil(a.height),scale:1}})()`);
  check('screenshot-frames-reporting-controls',clip.width>250&&clip.width<400&&clip.height>250&&clip.height<650);
  const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip});writeFileSync(join(output,'reporting-health-narrow.png'),Buffer.from(shot.data,'base64'));
  await focus('[data-testid="reporting-health-toggle"] button');await key('Enter');await wait(`!d.querySelector('[data-testid="reporting-support-preview"]')`,'preview closed');check('close-clears-preview',await guest(`return !d.querySelector('[data-testid="reporting-support-preview"]')`));
  await wait(`d.querySelector('[data-testid="reporting-health-toggle"] button')?.textContent==='Reporting health'`,'closed');await evaluate(`qa.holds.push({path:'/v1/setup',tag:'health',frame:'page'});true`);await focus('[data-testid="reporting-health-toggle"] button');await key('Enter');await wait(`qa.held.some(h=>h.tag==='health')`,'held setup');await focus('[data-testid="reporting-health-toggle"] button');await key('Enter');await evaluate(`qa.release('health');true`);await evaluate('new Promise(r=>setTimeout(r,150))');check('closed-reply-discarded',await guest(`return !d.querySelector('[data-testid="reporting-support-preview"]')`));
  // One service outage keeps one message: a host-rejected NO_SERVICE poll (no service entry), then
  // 404 and 502 replies, all read as not responding; only a real missing grant (NOT_GRANTED) keeps
  // permission copy. The last board data stays visible under the stale banner.
  await evaluate(`qa.show(['page'],1100);true`);
  const health=`qa.requests.filter(r=>r.path==='/health').length`;
  const outage=async(entry:string,label:string,permission:boolean)=>{
    const copy=permission?'Progress needs permission':'Progress service is not responding';
    const other=permission?'Progress service is not responding':'Progress needs permission';
    const before=await evaluate(health);
    await evaluate(`qa.fail=[${entry}];true`);
    if(await guest(`return !!d.querySelector('[data-testid="stale-banner"] button')`))await click('[data-testid="stale-banner"] button');
    await wait(`${health}>${before}&&!!d.querySelector('[data-testid="stale-banner"]')&&d.querySelector('[data-testid="stale-banner"]').textContent.includes(${javascriptLiteral(copy)})`,'outage '+label);
    check('outage-'+label,await guest(`const b=d.querySelector('[data-testid="stale-banner"]');return !!b&&b.textContent.includes(${javascriptLiteral(copy)})&&!b.textContent.includes(${javascriptLiteral(other)})&&!!d.querySelector('article[data-testid^="plan-"]')`));
  };
  await outage(`{path:'/health',reject:true}`,'no-service-not-responding',false);
  const outageClip=await evaluate(`(()=>{const f=frame('page'),n=f.contentDocument.querySelector('[data-testid="stale-banner"]');if(!n)return null;const a=n.getBoundingClientRect(),b=f.getBoundingClientRect();return {x:Math.floor(window.scrollX+b.left+a.left),y:Math.floor(window.scrollY+b.top+a.top),width:Math.ceil(a.width),height:Math.ceil(a.height),scale:1}})()`);
  if(outageClip){const outageShot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:outageClip});writeFileSync(join(output,'outage-not-responding.png'),Buffer.from(outageShot.data,'base64'));}
  await outage(`{path:'/health',status:404}`,'404-stable-message',false);
  await outage(`{path:'/health',status:502}`,'502-stable-message',false);
  await outage(`{path:'/health',reject:true,code:'NOT_GRANTED'}`,'not-granted-permission-copy',true);
  await evaluate('qa.fail=[];true');await wait(`!d.querySelector('[data-testid="stale-banner"]')`,'outage recovered');check('outage-recovers',await guest(`return !d.querySelector('[data-testid="stale-banner"]')&&!!d.querySelector('article[data-testid^="plan-"]')`));
  // Contract fake only: no managed mutation reaches a service or a host installation.
  await evaluate(`qa.managedNotReady=true;qa.managedRequests=[];qa.managed={configured:false,verified:false,installed:false,separateLifecycle:false,historyRetained:true,captureEnabled:null,targets:null,diagnostics:[],activation:'unknown',version:null,delivery:{kind:'managed',revision:1,configuration:'unconfigured',migration:'none',observation:'unknown',mode:'unknown',expectedVersion:'1.2.3'}};
    qa.managedSetupReply=q=>{const action=q.path.split('/').pop(),v=structuredClone(qa.managed),body=JSON.parse(q.body||'{}');qa.managedRequests.push({action,body});
      if(q.method==='POST'&&action==='managed-inspect'){v.delivery.review={expected:'a'.repeat(64),targets:{configRoot:'/fixture/config',dataRoot:'/fixture/data',storeRoot:body.storeRoot||'/fixture/private-store'},storeId:null,sourceId:null};return {status:200,body:JSON.stringify(v)}}
      if(q.method==='POST'){if(body.confirmed!==true||body.expected!=='a'.repeat(64))return {status:400,body:JSON.stringify({error:'confirmation-required'})};if(qa.partial){qa.partial=false;qa.managed.delivery.migration='pending';qa.managed.captureEnabled=false;return {status:409,body:JSON.stringify({error:'managed-migration-pending'})}}qa.managed.configured=true;qa.managed.verified=true;qa.managed.delivery.configuration='configured';if(action!=='managed-disable')qa.managed.delivery.migration=action==='managed-migrate'?'complete':'none';qa.managed.captureEnabled=action!=='managed-disable';qa.managed.targets={configRoot:'/fixture/config',dataRoot:'/fixture/data',storeRoot:body.storeRoot||'/fixture/private-store'};qa.managed.delivery.observation='not-observed'}
      return {status:200,body:JSON.stringify(qa.managed)}};true`);
  const reload=async()=>{const seq=await evaluate(`qa.reload('page')`);await wait(`qa.loaded.page===${seq}&&!!d.querySelector('[data-testid="setup-panel"],[data-testid="setup-section"] summary')`,'fresh page');if(!await guest(`return !!d.querySelector('[data-testid="setup-panel"]')`))await click('[data-testid="setup-section"] summary');await wait(`!!d.querySelector('[data-testid="setup-panel"]')?.dataset.phase`,'setup response visible');};
  const shotSetup=async(name:string,surface='page')=>{
    // A fixture-only trailing spacer permits a short bottom-of-page panel to align at the top of
    // its iframe. Capture within the visible frame, rather than asking CDP to raster off-frame UI.
    await evaluate(`(()=>{const f=frame(${javascriptLiteral(surface)}),w=f.contentWindow,d=w.document,n=d.querySelector('[data-testid="setup-panel"]')||d.querySelector('[data-testid="managed-integrity-warning"]');let spacer=d.getElementById('qa-capture-spacer');if(!spacer){spacer=d.createElement('div');spacer.id='qa-capture-spacer';spacer.style.height='2000px';d.body.append(spacer)}w.scrollTo(0,w.scrollY+n.getBoundingClientRect().top);window.scrollTo(0,0);return true})()`);
    await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    const clip=await evaluate(`(()=>{const f=frame(${javascriptLiteral(surface)}),n=f.contentDocument.querySelector('[data-testid="setup-panel"]')||f.contentDocument.querySelector('[data-testid="managed-integrity-warning"]');const a=n.getBoundingClientRect(),b=f.getBoundingClientRect();return {x:Math.max(0,Math.floor(window.scrollX+b.left+a.left)),y:Math.max(0,Math.floor(window.scrollY+b.top+a.top)),width:Math.ceil(a.width),height:Math.ceil(a.height),scale:1}})()`);
    const image=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip});writeFileSync(join(output,name+'.png'),Buffer.from(image.data,'base64'));
  };
  await evaluate(`qa.freshSetup=true;qa.show(['page'],360);true`);await reload();
  await guest(`const input=d.querySelector('[data-testid="setup-storeRoot"] input');input.value='/fixture/custom-store';input.dispatchEvent(new w.Event('input',{bubbles:true}));return true`);
  await click('[data-testid="setup-inspect"] button');await wait(`!!d.querySelector('[data-testid="setup-review"]')`,'configure review');
  check('review-needs-consent',await guest(`return d.querySelector('[data-testid="setup-confirm"] button').getAttribute('aria-disabled')==='true'&&d.querySelector('[data-testid="setup-review"]').textContent.includes('/fixture/custom-store')`));
  await wait(`d.activeElement?.closest('[data-testid="setup-cancel"]')`,'cancel initial focus');await key('Escape');await wait(`!!d.querySelector('[data-testid="setup-inspect"]')`,'cancelled review');
  check('cancel-keeps-custom-store',await guest(`return d.querySelector('[data-testid="setup-storeRoot"] input').value==='/fixture/custom-store'&&!!d.activeElement?.closest('[data-testid="setup-inspect"]')`));
  check('cancel-does-not-mutate',fx.freshSetup.engine.requests.every(q=>q.action==='inspect'));
  await evaluate(`qa.fail=[{path:'/v1/setup/managed-step',status:409,code:'managed-review-stale',once:true}];true`);await click('[data-testid="setup-inspect"] button');await wait(`!!d.querySelector('[data-testid="setup-migration-failure"]')`,'inspect failure');check('failed-inspect-keeps-custom-store',await guest(`return d.querySelector('[data-testid="setup-storeRoot"] input').value==='/fixture/custom-store'&&!d.querySelector('[data-testid="setup-review"]')`));
  await shotSetup('managed-setup-phone-en');
  await click('[data-testid="setup-inspect"] button');await wait(`!!d.querySelector('[data-testid="setup-review"]')`,'fresh configuration consent');await focus('[data-testid="setup-ack"] [role="checkbox"]');await key('Space');await wait(`d.querySelector('[data-testid="setup-confirm"] button').getAttribute('aria-disabled')==='false'`,'configuration acknowledged');await focus('[data-testid="setup-confirm"] button');await key('Enter');await wait(`!!d.querySelector('[data-testid="setup-migration-progress"][data-family="fresh"][data-state="complete"]')`,'fresh steps complete');
  check('confirmed-configuration-keeps-custom-store',fx.freshSetup.engine.requests.filter(q=>q.action==='begin').length===1&&fx.freshSetup.engine.review.targets.storeRoot==='/fixture/custom-store');
  check('fresh-uses-only-versioned-steps',fx.freshSetup.requests.every(q=>q.path==='/v1/setup'||q.path==='/v1/setup/managed-step'&&q.version===2));
  await shotSetup('managed-configured-phone-en');
  // Old monolithic migration simulations are superseded by managed-migration-qa.ts's step journeys.
  // Keep independent reporting/control presentation checks on an explicit synthetic snapshot.
  await evaluate(`qa.freshSetup=false;qa.managed.configured=true;qa.managed.verified=true;qa.managed.delivery.configuration='configured';qa.managed.captureEnabled=true;qa.managed.targets={configRoot:'/fixture/config',dataRoot:'/fixture/data',storeRoot:'/fixture/custom-store'};qa.managed.delivery.observation='different';qa.locale='en';qa.show(['page'],360);true`);await reload();
  check('warning-does-not-disable-capture-control',await guest(`return !!d.querySelector('[data-testid="managed-integrity-warning"]')&&!d.querySelector('[data-testid="setup-disable"] button').disabled`));await shotSetup('managed-warning-phone-en');
  for(const [locale,width]of [['en',1100],['ru',360]]as const){
    await evaluate(`qa.locale=${javascriptLiteral(locale)};qa.show(['page'],${width});qa.managed.delivery.migration='conflict';qa.managed.captureEnabled=true;true`);await reload();
    check(`conflict-keeps-only-disable-${locale}`,await guest(`return !!d.querySelector('[data-testid="setup-disable"] button')&&!d.querySelector('[data-testid="setup-enable"]')&&!d.querySelector('[data-testid="setup-migrate"]')`));
    await focus('[data-testid="setup-disable"] button');await key('Enter');await wait(`d.querySelector('[data-testid="setup-review"]')?.dataset.action==='managed-disable'`,'conflict capture-off review');
    await focus('[data-testid="setup-cancel"] button');await key('Escape');await wait(`!d.querySelector('[data-testid="setup-review"]')`,'conflict cancel');
    check(`conflict-cancel-focus-${locale}`,await guest(`return !!d.activeElement?.closest('[data-testid="setup-disable"]')`));
    await key('Enter');await wait(`!!d.querySelector('[data-testid="setup-review"]')`,'conflict reviewed again');
    await shotSetup(`managed-conflict-disable-${locale}`);
    await click('[data-testid="setup-ack"] [role="checkbox"]');await focus('[data-testid="setup-confirm"] button');await key('Enter');
    await wait(`!d.querySelector('[data-testid="setup-review"]')&&!!d.querySelector('[data-testid="setup-notice"]')`,'confirmed capture-off');
    check(`conflict-confirmed-disable-${locale}`,await evaluate(`qa.managedRequests.filter(q=>q.action==='managed-disable').at(-1).body.confirmed===true&&qa.managed.captureEnabled===false`));
    for(const code of ['busy','corrupt','schema','storage','windows-security-unavailable']){
      await evaluate(`qa.managed.delivery.migration='unavailable';qa.managed.diagnostics=[${javascriptLiteral(code)}];true`);await reload();
      check(`unavailable-not-conflict-${locale}-${code}`,await guest(`return !!d.querySelector('[data-testid="setup-migration-unavailable"]')&&!!d.querySelector('[data-testid="setup-retry"]')&&!d.querySelector('[data-testid="setup-enable"]')&&!d.querySelector('[data-testid="setup-migrate"]')`));
    }
    await shotSetup(`managed-inspection-unavailable-${locale}`);
  }
  await evaluate(`qa.managed.diagnostics=[];qa.managed.delivery.migration='none';true`);
  await evaluate(`qa.managed.delivery.revision=99;true`);await reload();check('future-delivery-unsupported',await guest(`return d.querySelector('[data-testid="setup-panel"]').dataset.phase==='unsupported'&&!d.querySelector('[data-testid="setup-migrate"]')&&!d.querySelector('[data-testid="setup-inspect"]')`));
  await evaluate(`qa.savedDelivery=qa.managed.delivery;delete qa.managed.delivery;true`);await reload();check('legacy-service-has-no-managed-or-global-actions',await guest(`return d.querySelector('[data-testid="setup-panel"]').dataset.phase==='unsupported'&&!d.querySelector('[data-testid="setup-panel"] button')`));await evaluate(`qa.managed.delivery=qa.savedDelivery;true`);
  const railSeq=await evaluate<number>(`qa.managed.delivery.revision=1;qa.managed.delivery.migration='none';qa.locale='ru';qa.context('M');qa.show(['panel'],360);qa.reload('panel')`);
  await wait(`qa.loaded.panel===${railSeq}&&!!frame('panel').contentDocument.querySelector('[data-testid="setup-panel"]')`,'actual rail setup');
  check('rail-phone-reflow',await evaluate(`(()=>{const w=frame('panel').contentWindow;return w.document.documentElement.scrollWidth<=w.innerWidth})()`));await shotSetup('managed-migration-panel360-ru','panel');
  fx.freshSetup.engine.progress=null;
  await evaluate(`qa.freshSetup=true;qa.show(['page'],360);qa.locale='en';true`);await reload();
  await evaluate(`qa.holds.push({path:'/v1/setup/managed-step',tag:'managed-late',frame:'page'});true`);await click('[data-testid="setup-inspect"] button');await wait(`qa.held.some(h=>h.tag==='managed-late')`,'held managed review');
  await evaluate(`qa.account='account-other';qa.ready('page');true`);await wait(`!d.querySelector('[data-testid="setup-review"]')&&!!d.querySelector('[data-testid="setup-inspect"]')`,'new account setup');const beforeLate=fx.freshSetup.engine.requests.length;await evaluate(`qa.release('managed-late');true`);
  await wait(`!d.querySelector('[data-testid="setup-panel"]')?.getAttribute('aria-busy')||d.querySelector('[data-testid="setup-panel"]').getAttribute('aria-busy')==='false'`,'late review retired');
  check('late-managed-review-cannot-cross-account',await guest(`return !d.querySelector('[data-testid="setup-review"]')&&!d.querySelector('[data-testid="setup-error"]')`));
  check('retired-inspection-does-not-continue',fx.freshSetup.engine.requests.length===beforeLate);
  check('no-runtime-errors',runtimeErrors===0);
}catch(error){failure=error instanceof Error?error.message:String(error);process.exitCode=1;if(diagnose)writeFileSync(join(output,'failure-state.json'),JSON.stringify(await diagnose().catch(()=>null),null,2));}
finally{writeFileSync(join(output,'results.json'),JSON.stringify({scope:'synthetic SDK shell, current guest bundles and disposable HTTP stores',results,failure},null,2));ws?.close();chrome.kill('SIGTERM');await fx.stop();await new Promise(r=>setTimeout(r,200));rmSync(profile,{recursive:true,force:true});}
console.log(JSON.stringify({passed:results.filter(r=>r.pass).length,failed:results.filter(r=>!r.pass).length,failure}));
