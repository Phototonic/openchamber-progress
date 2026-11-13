// Real supporting-host acceptance. The caller owns a disposable, credential-free,
// loopback-only host; this driver starts/stops only its own fresh Chromium profile.
// No synthetic SDK shell, prompt, provider call or attachment to a live browser.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {javascriptLiteral as literal} from '../../shared/javascript-literal.ts';

const arg=(name:string)=>{const i=process.argv.indexOf(name);return i<0?undefined:process.argv[i+1];};
const artifacts=arg('--artifacts'),hostUrl=arg('--host-url'),fixtureFile=arg('--fixture'),chromium=arg('--chromium')??process.env.CHROMIUM_PATH;
assert.ok(artifacts&&hostUrl&&fixtureFile&&chromium,'--artifacts, --host-url, --fixture and --chromium required');
const origin=new URL(hostUrl);assert.equal(origin.hostname,'127.0.0.1');assert.equal(origin.protocol,'http:');
const fixture=JSON.parse(readFileSync(fixtureFile,'utf8'));
mkdirSync(artifacts,{recursive:true});
const profile=mkdtempSync('/tmp/opencode/plan-composer-browser-');
const results:{id:string;pass:boolean}[]=[],screenshots:string[]=[];
const bundleHashes=Object.fromEntries(['build/service/main.js','background/main.js','ui/panel/main.js','ui/status/main.js','ui/page/main.js'].map(file=>[file,createHash('sha256').update(readFileSync(new URL('../../'+file,import.meta.url))).digest('hex')]));
let browser:ReturnType<typeof spawn>|undefined,ws:WebSocket|undefined,failure:string|null=null,captureFailure:(()=>Promise<void>)|undefined;
const wait=async<T>(fn:()=>Promise<T>,ok:(x:T)=>boolean,label:string,ms=20000)=>{const end=Date.now()+ms;while(Date.now()<end){const v=await fn();if(ok(v))return v;await new Promise(r=>setTimeout(r,50));}throw Error(label+' timeout');};
try {
 browser=spawn(chromium,['--headless=new','--no-sandbox','--remote-debugging-address=127.0.0.1','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-sync','--disable-extensions','--window-size=1440,1100','about:blank'],{stdio:'ignore',detached:true});
 const port=await wait(async()=>existsSync(join(profile,'DevToolsActivePort'))?readFileSync(join(profile,'DevToolsActivePort'),'utf8').split('\n')[0]:'',Boolean,'browser startup');
 const targets=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()as any[];
 ws=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);
 await new Promise<void>((r,j)=>{ws!.onopen=()=>r();ws!.onerror=()=>j(Error('browser connection'));});
 let next=0;const pending=new Map<number,{resolve:(v:any)=>void;reject:(e:Error)=>void}>();
 const events:any[]=[];let onEvent:((m:any)=>void)|undefined;
 ws.onmessage=e=>{const m=JSON.parse(String(e.data));const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}else {events.push(m);onEvent?.(m);}};
 const send=(method:string,params:object={})=>new Promise<any>((r,j)=>{const id=++next;pending.set(id,{resolve:r,reject:j});ws!.send(JSON.stringify({id,method,params}));});
 const evaluate=async<T=any>(expression:string):Promise<T>=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description?.split('\n')[0]??'page evaluation failed');return r.result.value;};
 const shot=async(name:string)=>{const s=await send('Page.captureScreenshot',{format:'png'});writeFileSync(join(artifacts,name),Buffer.from(s.data,'base64'));screenshots.push(name);};
 captureFailure=async()=>{await shot('failed-journey.png');writeFileSync(join(artifacts,'failed-journey.json'),JSON.stringify({text:await evaluate('document.body.innerText'),columns:await evaluate(`[...document.querySelectorAll('[data-chat-session-id]')].map(e=>({id:e.getAttribute('data-chat-session-id'),column:e.hasAttribute('data-chat-column'),editor:!!e.querySelector('[contenteditable="true"]')}))`),mentions:events.filter(m=>m.method==='Network.responseReceived'&&m.params.response.url.includes('/mentions/')).map(m=>({path:new URL(m.params.response.url).pathname,status:m.params.response.status}))},null,2));};
 const click=async(expression:string,button='left')=>{const box=await evaluate(`(()=>{const e=${expression};if(!e) return null;e.scrollIntoView({block:'center'});const b=e.getBoundingClientRect();return {x:b.x+b.width/2,y:b.y+b.height/2};})()`);assert.ok(box,'click target exists');await send('Input.dispatchMouseEvent',{type:'mouseMoved',...box});await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');await send('Input.dispatchMouseEvent',{type:'mousePressed',...box,button,clickCount:1});await send('Input.dispatchMouseEvent',{type:'mouseReleased',...box,button,clickCount:1});};
 const textTarget=(text:string)=>`[...document.querySelectorAll('span,div,button')].find(e=>e.textContent===${literal(text)}&&![...e.children].some(c=>c.textContent===${literal(text)}))`;
 const key=async(key:string,code=key,modifiers=0)=>{await send('Input.dispatchKeyEvent',{type:'keyDown',key,code,modifiers});await send('Input.dispatchKeyEvent',{type:'keyUp',key,code,modifiers});};
 const editor=`document.querySelector('[data-chat-column="main"] [data-testid="chat-input"] [contenteditable="true"][role="textbox"]')`;
 const draft=()=>evaluate<string>(`${editor}?.innerText??''`);
 const toast=(text:string)=>wait(()=>evaluate(`[...document.querySelectorAll('[data-sonner-toast]')].some(e=>e.innerText.includes(${literal(text)}))`),Boolean,'toast: '+text);
 const check=(id:string,pass:boolean)=>{results.push({id,pass});assert.ok(pass,id);};
 const api=async(path:string,body:unknown,method='POST')=>{const r=await fetch(hostUrl+path,{method,headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});const value=await r.json();assert.ok(r.ok,'host request accepted');return value;};
 const control=async(path:string)=>{assert.ok(arg('--control-url'),'disposable control URL required');const url=new URL(arg('--control-url')!);assert.equal(url.hostname,'127.0.0.1');const r=await fetch(new URL(path,url),{method:'POST',body:'{}',signal:AbortSignal.timeout(5000)});assert.ok(r.ok,'disposable control accepted');};
 const session=async(title:string)=>{assert.ok(Object.values(fixture.sessions).some((s:any)=>s.title===title),'known disposable session');await click(`[...document.querySelectorAll('[data-session-row-main]')].find(e=>e.innerText===${literal(title)})`);await wait(()=>evaluate(`document.querySelector('[data-session-row-box][aria-current="page"]')?.innerText??''`),x=>x===title,'active session '+title);await wait(()=>evaluate(`!!(${editor})`),Boolean,'main composer');await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');};
 const openActions=async(title:string)=>{await click(`[...document.querySelectorAll('[data-session-row-box]')].find(e=>e.innerText.includes(${literal(title)}))?.querySelector('button[aria-label="Session menu"]')`);await wait(()=>evaluate(`!!document.querySelector('[role="menu"]')`),Boolean,'session menu');await click(`[...document.querySelectorAll('[role="menuitem"]')].find(e=>e.textContent==='Export')`);await wait(()=>evaluate(`document.body.innerText.includes('Insert handoff')&&document.body.innerText.includes('Insert progress update')`),Boolean,'extension actions');};
 await send('Page.enable');await send('Runtime.enable');await send('Network.enable');
 await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
 await send('Page.navigate',{url:hostUrl});
 await wait(()=>evaluate('document.readyState'),x=>x==='complete','page load');
 await wait(()=>evaluate('document.body.innerText'),x=>x.length>100,'host content');
 await wait(()=>evaluate(`!!(${textTarget('Destination draft')})`),Boolean,'destination listed');
 await session('Destination draft');
 await wait(()=>evaluate(`document.querySelector('[contenteditable="true"][role="textbox"]')?.getAttribute('aria-placeholder')??''`),Boolean,'active composer');
 await click(`document.querySelector('[contenteditable="true"][role="textbox"]')`);
 await send('Input.insertText',{text:'@Compose'});
 await wait(()=>evaluate('document.body.innerText'),x=>x.includes('Compose fixture'),'mention rows').catch(async e=>{await shot('failure.png');writeFileSync(join(artifacts,'failed-dom.json'),JSON.stringify(await evaluate(`({text:document.body.innerText,html:document.body.innerHTML})`)));throw e;});
 await shot('mentions.png');
 writeFileSync(join(artifacts,'dom.json'),JSON.stringify(await evaluate(`({text:document.body.innerText,buttons:[...document.querySelectorAll('button')].map(b=>({text:b.innerText,label:b.getAttribute('aria-label'),title:b.title})),editors:[...document.querySelectorAll('[contenteditable]')].map(e=>e.outerHTML),source:[...document.querySelectorAll('span')].filter(e=>e.textContent==='Source reports').map(e=>e.parentElement.parentElement.outerHTML),mentions:[...document.querySelectorAll('[role="option"]')].map(e=>e.outerHTML)})`),null,2));
 results.push({id:'real-host-ui-loaded',pass:true});
 const searched=events.findLast(m=>m.method==='Network.responseReceived'&&m.params.response.url.endsWith('/api/guests/mentions/search'));
 assert.ok(searched,'real host mention search');
 const groups=JSON.parse((await send('Network.getResponseBody',{requestId:searched.params.requestId})).body).groups;
 check('agent-progress-menu-contribution',groups.some((g:any)=>g.label==='Agent progress'&&g.items.some((i:any)=>i.id===fixture.source+'/P-compose')));
 await click(textTarget('Compose fixture'));
 await wait(()=>evaluate(`!!document.querySelector('button[title="Compose fixture"]')`),Boolean,'mention selected');
 await shot('chip.png');
 const resolved=events.findLast(m=>m.method==='Network.responseReceived'&&m.params.response.url.endsWith('/mentions/resolve'));
 assert.ok(resolved,'selection-time resolution');
 const resolvedText=JSON.parse((await send('Network.getResponseBody',{requestId:resolved.params.requestId})).body).text;
 const direct=await api('/api/guests/agent-progress-probe/service/request',{method:'POST',path:'/mentions/resolve',body:JSON.stringify({id:fixture.source+'/P-compose'})});
 check('host-resolve-matches-shipped-service',resolvedText===JSON.parse(direct.body).text&&resolvedText.length<=16000);
 // Read only the real chip/composer's bounded React state; the host exposes no
 // context-text inspector. This is observation, never SDK/state substitution.
 const attached=await evaluate<string|null>(`(()=>{
   const button=document.querySelector('button[title="Compose fixture"]');
   let fiber=button?.[Object.keys(button).find(k=>k.startsWith('__reactFiber'))];
   const seen=new Set();let budget=20000;
   function reference(value,depth){
     if(!value||typeof value!=='object'||depth<0||seen.has(value)||--budget<0)return null;
     seen.add(value);
     if(value.kind==='guest'&&value.providerId==='agent-progress-probe'&&value.id==='source-composer/P-compose')return value.contextText??null;
     const prototype=Object.getPrototypeOf(value);
     if(value instanceof Map||value instanceof Set){for(const entry of value.values()){const found=reference(entry,depth-1);if(found)return found;}return null;}
     if(!Array.isArray(value)&&prototype!==Object.prototype&&prototype!==null)return null;
     for(const [key,entry]of Object.entries(value)){
       if(key==='next'||key.startsWith('_'))continue;
       const found=reference(entry,depth-1);if(found)return found;
     }
     return null;
   }
   for(let n=0;fiber&&n<30;n++,fiber=fiber.return)for(const current of [fiber,fiber.alternate]){
     if(!current)continue;
     let found=reference(current.memoizedProps,6);if(found)return found;
     for(let hook=current.memoizedState,j=0;hook&&j<200;j++,hook=hook.next){found=reference(hook,6);if(found)return found;}
     for(let context=current.dependencies?.firstContext,j=0;context&&j<32;j++,context=context.next){found=reference(context.memoizedValue,6);if(found)return found;}
   }
   return null;
 })()`);
 if(attached===null)writeFileSync(join(artifacts,'chip-state-shape.json'),JSON.stringify(await evaluate(`(()=>{const b=document.querySelector('button[title="Compose fixture"]');let f=b?.[Object.keys(b).find(k=>k.startsWith('__reactFiber'))];const r=[];for(let n=0;f&&n<30;n++,f=f.return)r.push({name:typeof f.type==='string'?f.type:f.type?.name,props:Object.keys(f.memoizedProps??{}),state:typeof f.memoizedState,alternate:!!f.alternate});return r})()`),null,2));
 results.push({id:'attached-chip-is-resolved-snapshot',pass:attached===resolvedText});
 writeFileSync(join(artifacts,'attached-context.txt'),attached??'Context text unavailable to the inspector.');
 writeFileSync(join(artifacts,'chip-context.json'),JSON.stringify({codeUnits:resolvedText.length,sha256:createHash('sha256').update(resolvedText).digest('hex'),attachedMatches:attached===resolvedText,reportedNotVerified:true},null,2));
 writeFileSync(join(artifacts,'chip-dom.json'),JSON.stringify(await evaluate(`({text:document.body.innerText,composer:document.querySelector('[data-testid="chat-input"]')?.parentElement.parentElement.outerHTML})`)));
 await key('Escape');
 await click(`document.querySelector('button[title="Compose fixture"]')`);
 await shot('chip-detail.png');
 writeFileSync(join(artifacts,'chip-detail-dom.json'),JSON.stringify(await evaluate(`({text:document.body.innerText,dialogs:[...document.querySelectorAll('[role="dialog"],textarea,pre')].map(e=>e.outerHTML)})`)));
 await key('Escape');
 await click(`document.querySelector('button[aria-label="Remove source-composer/P-compose"]')`);
 await click(editor);await send('Input.insertText',{text:'@Removed'});
 await wait(()=>evaluate(`!!(${textTarget('Removed fixture')})`),Boolean,'removable mention row');
 await control('/delete-removed');
 const removedStart=events.length;await click(textTarget('Removed fixture'));
 await wait(async()=>events.slice(removedStart).some(m=>m.method==='Network.responseReceived'&&m.params.response.url.endsWith('/mentions/resolve')&&m.params.response.status===502),Boolean,'removed target host refusal');
 check('removed-target-does-not-attach-chip',!await evaluate(`!!document.querySelector('button[title="Removed fixture"]')`));
 await shot('removed-target.png');
 await click(`document.querySelector('[contenteditable="true"][role="textbox"]')`);
 await key('a','KeyA',2);await key('Backspace');await send('Input.insertText',{text:'Keep this draft'});
 await openActions('Source reports');
 await shot('action-menu.png');
 writeFileSync(join(artifacts,'menu-dom.json'),JSON.stringify(await evaluate(`({text:document.body.innerText,menus:[...document.querySelectorAll('[role="menu"]')].map(e=>e.outerHTML)})`)));
 let hold=false,held:any=null;
 onEvent=m=>{if(m.method!=='Fetch.requestPaused')return;let request:any;try{request=JSON.parse(m.params.request.postData??'{}');}catch{}
  if(hold&&request?.path==='/v1/plans'&&request.query?.session===fixture.sessions.source.id){held={id:m.params.requestId,path:request.path,session:request.query.session};hold=false;}
  else void send('Fetch.continueRequest',{requestId:m.params.requestId}).catch(()=>{});
 };
 await send('Fetch.enable',{patterns:[{urlPattern:'*/api/guests/agent-progress-probe/service/request',requestStage:'Request'}]});
 const baseline=await evaluate<number>('document.querySelectorAll("iframe").length');
 hold=true;await click(textTarget('Insert handoff'));
 await wait(async()=>held,Boolean,'clicked source read held');
 check('clicked-session-source',held.session===fixture.sessions.source.id);
 await send('Fetch.continueRequest',{requestId:held.id});held=null;
 await wait(()=>draft(),x=>x.includes('Reported progress, not verified completion'),'handoff appended');
 await toast('Added to the active chat. Review before sending.');
 const handoff=await draft();
 check('saved-finished-choice-and-other-plan-notice',handoff.startsWith('Keep this draft')&&handoff.includes('P\\-compose')&&handoff.includes('1 other plan')&&!handoff.includes('Do not merge this task'));
 await wait(()=>evaluate<number>('document.querySelectorAll("iframe").length'),x=>x===baseline,'background frame disposal');
 await shot('handoff-draft.png');
 await openActions('Source reports');hold=true;await click(textTarget('Insert progress update'));
 await wait(async()=>held,Boolean,'second clicked source held');
 await session('Switch destination');await wait(()=>draft(),x=>x==='','new active destination before compose');await send('Fetch.continueRequest',{requestId:held.id});held=null;
 await wait(()=>draft(),x=>x.includes('Reported progress, not verified completion'),'progress appended after switch');
 const progress=await draft();check('switch-during-read-keeps-clicked-source-and-new-destination',progress.startsWith('Plan: Compose fixture')&&progress.includes('P\\-compose')&&progress.includes('1 other plan')&&!progress.includes('Origin session:')&&!progress.includes('Keep this draft'));
 await toast('Added to the active chat. Review before sending.');
 await shot('progress-draft.png');
 const beforeEmpty=await draft();await openActions('No reported plan');await click(textTarget('Insert handoff'));
 await toast('No plan reported for this session');
 check('no-plan-does-not-change-draft',await draft()===beforeEmpty);await shot('no-plan.png');
 const beforeSingle=await draft();await openActions('One reported plan');await click(textTarget('Insert progress update'));
 await wait(()=>draft(),x=>x.includes('Single plan fixture'),'single-plan insertion');check('single-plan-fallback',!(await draft()).slice(beforeSingle.length).includes('other plans reported'));
 const beforeFailure=await draft();await control('/unavailable');
 try{await openActions('Source reports');await click(textTarget('Insert handoff'));await toast('Progress is unavailable. Check the Agent progress setup and service.');check('unavailable-service-preserves-draft',await draft()===beforeFailure);await shot('failure.png');}
 finally{await control('/available');}
 await openActions('Source reports');hold=true;await click(textTarget('Insert handoff'));await wait(async()=>held,Boolean,'permission withdrawal held');
 await api('/api/guests/agent-progress-probe/capabilities',{granted:[]},'PUT');
 await wait(()=>evaluate<number>('document.querySelectorAll("iframe").length'),x=>x<baseline+1,'permission teardown');
 await send('Fetch.continueRequest',{requestId:held.id}).catch(()=>{});held=null;
 check('permission-withdrawal-no-late-insertion',await draft()===beforeFailure);
 await api('/api/guests/agent-progress-probe/capabilities',{granted:['sessions','service']},'PUT');
 await send('Fetch.disable');
 await session('Source reports');
 await wait(()=>evaluate<number>('document.querySelectorAll("iframe").length'),x=>x>=2,'visible progress frames restored');
 await shot('source-views.png');
 await click(textTarget('Agent progress'));
 await shot('board.png');
 assert.ok(results.every(r=>r.pass),'all acceptance assertions');
}catch(e){failure=e instanceof Error?e.message:'acceptance failed';await captureFailure?.().catch(()=>{});}
finally {
 ws?.close();
 if(browser?.pid){try{process.kill(-browser.pid,'SIGTERM');}catch{}await new Promise<void>(r=>{if(browser!.exitCode!==null)r();else browser!.once('exit',()=>r());});}
 rmSync(profile,{recursive:true,force:true});
 writeFileSync(join(artifacts,'results.json'),JSON.stringify({hostVersion:fixture.hostVersion,openCodeVersion:fixture.openCodeVersion,bundleHashes,results,screenshots,failure,profileRemoved:!existsSync(profile)},null,2));
}
if(failure){console.error(failure);process.exitCode=1;}
