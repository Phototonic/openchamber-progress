// Real supporting-host acceptance. The caller owns a disposable, credential-free,
// loopback-only host; this driver starts/stops only its own fresh Chromium profile.
// No synthetic SDK shell or attachment to a live browser. Only after proving the
// extension did not send, the harness sends one chip to a local scripted provider.
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
 ws.onmessage=e=>{const m=JSON.parse(String(e.data));const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}else {events.push(m);if(m.method==='Target.attachedToTarget')void send('Runtime.enable',{},m.params.sessionId).catch(()=>{});onEvent?.(m);}};
 const send=(method:string,params:object={},sessionId?:string)=>new Promise<any>((r,j)=>{const id=++next;pending.set(id,{resolve:r,reject:j});ws!.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});
 const evaluate=async<T=any>(expression:string):Promise<T>=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description?.split('\n')[0]??'page evaluation failed');return r.result.value;};
 const shot=async(name:string)=>{const s=await send('Page.captureScreenshot',{format:'png'});writeFileSync(join(artifacts,name),Buffer.from(s.data,'base64'));screenshots.push(name);};
 captureFailure=async()=>{await shot('failed-journey.png');writeFileSync(join(artifacts,'failed-journey.json'),JSON.stringify({text:await evaluate('document.body.innerText'),columns:await evaluate(`[...document.querySelectorAll('[data-chat-session-id]')].map(e=>({id:e.getAttribute('data-chat-session-id'),column:e.hasAttribute('data-chat-column'),editor:!!e.querySelector('[contenteditable="true"]')}))`),mentions:events.filter(m=>m.method==='Network.responseReceived'&&m.params.response.url.includes('/mentions/')).map(m=>({path:new URL(m.params.response.url).pathname,status:m.params.response.status}))},null,2));};
 const click=async(expression:string,button='left')=>{
   await evaluate(`(()=>{const e=${expression};if(e)e.scrollIntoView({block:'nearest'});})()`);
   await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
   const locate=()=>evaluate<{x:number;y:number}|null>(`(()=>{const e=${expression};if(!e)return null;const b=e.getBoundingClientRect();let left=Math.max(0,b.left),right=Math.min(innerWidth,b.right),top=Math.max(0,b.top),bottom=Math.min(innerHeight,b.bottom);for(let a=e.parentElement;a;a=a.parentElement){const s=getComputedStyle(a),r=a.getBoundingClientRect();if(/auto|scroll|hidden|clip/.test(s.overflowX)){left=Math.max(left,r.left);right=Math.min(right,r.right);}if(/auto|scroll|hidden|clip/.test(s.overflowY)){top=Math.max(top,r.top);bottom=Math.min(bottom,r.bottom);}}if(right<=left||bottom<=top)return null;const p={x:(left+right)/2,y:(top+bottom)/2},hit=document.elementFromPoint(p.x,p.y);return hit&&(hit===e||e.contains(hit))?p:null;})()`);
   let box=await wait(locate,value=>value!==null,'actionable click target: '+expression);assert.ok(box);
   await send('Input.dispatchMouseEvent',{type:'mouseMoved',...box});
   await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
   box=await wait(locate,value=>value!==null,'settled click target');assert.ok(box);
   await send('Input.dispatchMouseEvent',{type:'mousePressed',...box,button,clickCount:1});
   await send('Input.dispatchMouseEvent',{type:'mouseReleased',...box,button,clickCount:1});
 };
 const textTarget=(text:string)=>`[...document.querySelectorAll('span,div,button')].find(e=>e.textContent===${literal(text)}&&![...e.children].some(c=>c.textContent===${literal(text)}))`;
 const key=async(key:string,code=key,modifiers=0)=>{await send('Input.dispatchKeyEvent',{type:'keyDown',key,code,modifiers});await send('Input.dispatchKeyEvent',{type:'keyUp',key,code,modifiers});};
 const editor=`document.querySelector('[data-chat-column="main"] [data-testid="chat-input"] [contenteditable="true"][role="textbox"]')`;
 const guest=async(surface:string)=>{
   for(const event of events.filter(m=>m.method==='Runtime.executionContextCreated'&&m.params.context.auxData?.isDefault).toReversed()){
     try{
       const owner=await send('DOM.getFrameOwner',{frameId:event.params.context.auxData.frameId});
       const node=await send('DOM.resolveNode',{backendNodeId:owner.backendNodeId,objectGroup:'frame-visibility'});
       const visible=await send('Runtime.callFunctionOn',{objectId:node.object.objectId,functionDeclaration:`function(){const b=this.getBoundingClientRect();return this.checkVisibility({checkOpacity:true,checkVisibilityCSS:true})&&b.width>0&&b.height>0&&document.elementFromPoint(b.x+b.width/2,b.y+b.height/2)===this;}`,returnByValue:true});
       await send('Runtime.releaseObjectGroup',{objectGroup:'frame-visibility'});
       if(!visible.result?.value)continue;
       const r=await send('Runtime.evaluate',{contextId:event.params.context.id,returnByValue:true,expression:`(()=>{const root=document.querySelector('[data-surface]');if(root?.getAttribute('data-surface')!==${literal(surface)}||document.documentElement.hasAttribute('data-ap-hidden'))return null;const counts=root.querySelector('[data-testid="counts"]');return {surface:${literal(surface)},title:root.querySelector('[data-testid="plan-title"],[data-testid="status-plan-title"]')?.textContent,done:counts?.getAttribute('data-done'),total:counts?.getAttribute('data-total'),rows:root.querySelectorAll('[data-testid^="plan-row-"]').length,loading:!!root.querySelector('[data-testid="state-loading"],[data-testid="detail-loading"]')};})()`},event.sessionId);
       if(r.result?.value)return r.result.value;
     }catch{/* A retired frame/context is not a current observation. */}
   }
   return null;
 };
 const draft=()=>evaluate<string>(`${editor}?.innerText??''`);
 const showDraftStart=async()=>{await evaluate(`${editor}?.closest('.cm-scroller')?.scrollTo(0,0)`);await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');};
 const toast=(text:string)=>wait(()=>evaluate(`[...document.querySelectorAll('[data-sonner-toast]')].some(e=>e.innerText.includes(${literal(text)}))`),Boolean,'toast: '+text);
 const check=(id:string,pass:boolean)=>{results.push({id,pass});assert.ok(pass,id);};
 const api=async(path:string,body:unknown,method='POST')=>{const r=await fetch(hostUrl+path,{method,headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});const value=await r.json();assert.ok(r.ok,'host request accepted');return value;};
 const control=async(path:string)=>{assert.ok(arg('--control-url'),'disposable control URL required');const url=new URL(arg('--control-url')!);assert.equal(url.hostname,'127.0.0.1');const r=await fetch(new URL(path,url),{method:'POST',body:'{}',signal:AbortSignal.timeout(5000)});assert.ok(r.ok,'disposable control accepted');return r.json();};
 const session=async(title:string)=>{assert.ok(Object.values(fixture.sessions).some((s:any)=>s.title===title),'known disposable session');await click(`[...document.querySelectorAll('[data-session-row-main]')].find(e=>e.innerText===${literal(title)})`);await wait(()=>evaluate(`document.querySelector('[data-session-row-box][aria-current="page"]')?.innerText??''`),x=>x===title,'active session '+title);await wait(()=>evaluate(`!!(${editor})`),Boolean,'main composer');await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');};
 const openActions=async(title:string)=>{await click(`[...document.querySelectorAll('[data-session-row-box]')].find(e=>e.innerText.includes(${literal(title)}))?.querySelector('button[aria-label="Session menu"]')`);await wait(()=>evaluate(`!!document.querySelector('[role="menu"]')`),Boolean,'session menu');await click(`[...document.querySelectorAll('[role="menuitem"]')].find(e=>e.textContent==='Export')`);await wait(()=>evaluate(`document.body.innerText.includes('Insert handoff')&&document.body.innerText.includes('Insert progress update')`),Boolean,'extension actions');};
 await send('Page.enable');await send('Runtime.enable');await send('Network.enable');await send('Target.setAutoAttach',{autoAttach:true,waitForDebuggerOnStart:false,flatten:true});
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
 // The host has no context-text inspector. DevTools reads only the real chip's
 // click-handler closure and its captured guest reference, without invoking it,
 // changing host state, constructing SDK replies or submitting a prompt.
 let attached:string|null=null;
 try {
   const handler=await send('Runtime.evaluate',{expression:`(()=>{const b=document.querySelector('button[title="Compose fixture"]');return b?.[Object.keys(b).find(k=>k.startsWith('__reactProps'))]?.onClick;})()`,objectGroup:'chip-inspection'});
   const queue:any[]=[handler.result],seen=new Set<string>();
   for(let visits=0;queue.length&&visits<128;visits++){
     const value=queue.shift();if(!value?.objectId||seen.has(value.objectId))continue;seen.add(value.objectId);
     const properties=await send('Runtime.getProperties',{objectId:value.objectId,ownProperties:true});
     if(value.type==='function'){
       const scopes=properties.internalProperties?.find((p:any)=>p.name==='[[Scopes]]')?.value;
       if(!scopes?.objectId)continue;
       const list=await send('Runtime.getProperties',{objectId:scopes.objectId,ownProperties:true});
       for(const scope of list.result){
         if(!scope.value?.objectId||! /^(Closure|Block|Local)/.test(scope.value.description??''))continue;
         const captured=await send('Runtime.getProperties',{objectId:scope.value.objectId,ownProperties:true});
         for(const entry of captured.result)if(entry.value?.objectId&&(entry.value.type==='function'||entry.value.className==='Object'))queue.push(entry.value);
       }
     }else if(value.className==='Object'){
       const reference=await send('Runtime.callFunctionOn',{objectId:value.objectId,functionDeclaration:`function(id){return this.kind==='guest'&&this.providerId==='agent-progress-probe'&&this.id===id?this.contextText:null;}`,arguments:[{value:fixture.source+'/P-compose'}],returnByValue:true,throwOnSideEffect:true});
       if(typeof reference.result?.value==='string'){attached=reference.result.value;break;}
       for(const entry of properties.result)if(['onClick','onReopenPicker','onOpen'].includes(entry.name)&&entry.value?.type==='function')queue.push(entry.value);
     }
   }
 }finally{await send('Runtime.releaseObjectGroup',{objectGroup:'chip-inspection'});}
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
 check('background-frame-disposed-after-acknowledgement',true);
 await showDraftStart();await shot('handoff-draft.png');
 await openActions('Source reports');hold=true;await click(textTarget('Insert progress update'));
 await wait(async()=>held,Boolean,'second clicked source held');
 await session('Switch destination');await wait(()=>draft(),x=>x.trim()==='','new active destination before compose');await send('Fetch.continueRequest',{requestId:held.id});held=null;
 await wait(()=>draft(),x=>x.includes('Reported progress, not verified completion'),'progress appended after switch');
 const progress=await draft();check('switch-during-read-keeps-clicked-source-and-new-destination',progress.trimStart().startsWith('Plan: Compose fixture')&&progress.includes('P\\-compose')&&progress.includes('1 other plan')&&!progress.includes('Origin session:')&&!progress.includes('Keep this draft'));
 await toast('Added to the active chat. Review before sending.');
 await showDraftStart();await shot('progress-draft.png');
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
 const rail=await wait(()=>guest('panel'),v=>v?.title==='Automatic active fixture'&&v.total==='1'&&!v.loading,'complete rail restored');
 check('real-rail-smoke',rail.done==='0');
 await shot('source-views.png');
 await click(`[...document.querySelectorAll('button[aria-label="Close panel"]')].findLast(e=>e.getBoundingClientRect().width>0)`);
 if(!await evaluate(`document.querySelector('button[aria-label="Toggle work-status panel"]')?.getAttribute('aria-pressed')==='true'`))await click(`document.querySelector('button[aria-label="Toggle work-status panel"]')`);
 const status=await wait(()=>guest('status'),v=>v?.title==='Automatic active fixture'&&v.total==='1'&&!v.loading,'complete Work Status restored');
 check('real-work-status-smoke',status.done==='0');
 await shot('status.png');
 const pageStart=events.length;
 await click(textTarget('Agent progress'));
 await wait(async()=>{const requests=events.slice(pageStart).filter(m=>m.method==='Network.requestWillBeSent').filter(m=>{try{const q=JSON.parse(m.params.request.postData??'{}');return q.path==='/v1/plans'&&!q.query?.session;}catch{return false;}});return requests.some(r=>events.some(m=>m.method==='Network.loadingFinished'&&m.params.requestId===r.params.requestId));},Boolean,'board list read');
 await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
 const board=await wait(()=>guest('page'),v=>v?.rows>=2&&v.total==='1'&&!v.loading,'complete board');
 check('real-board-smoke',board.done==='0');
 await shot('board.png');
 const exceptions=events.filter(m=>m.method==='Runtime.exceptionThrown').length;
 writeFileSync(join(artifacts,'console.json'),JSON.stringify({uncaughtExceptions:exceptions,consoleErrors:events.filter(m=>m.method==='Runtime.consoleAPICalled'&&m.params.type==='error').length,note:'Loopback-only host metadata failures and the deliberately failed mention/service requests are expected.'},null,2));
 check('no-uncaught-browser-exceptions',exceptions===0);
 // Freeze all extension no-send evidence before the sole harness-as-user send.
 const noSend=await control('/safety');
 check('extension-journeys-never-send',noSend.providerCalls===0&&noSend.credentials===0);
 writeFileSync(join(artifacts,'no-send.json'),JSON.stringify({stage:'before harness send',...noSend,assertions:results},null,2));
 await session('Destination draft');
 await click(editor);await key('a','KeyA',2);await key('Backspace');
 await send('Input.insertText',{text:'@Compose'});
 await wait(()=>evaluate(`!!(${textTarget('Compose fixture')})`),Boolean,'final chip row');
 await click(textTarget('Compose fixture'));
 await wait(()=>evaluate(`!!document.querySelector('button[title="Compose fixture"]')`),Boolean,'final chip selected');
 const finalResolve=events.findLast(m=>m.method==='Network.responseReceived'&&m.params.response.url.endsWith('/mentions/resolve'));
 const finalText=JSON.parse((await send('Network.getResponseBody',{requestId:finalResolve.params.requestId})).body).text;
 check('harness-chip-snapshot-unchanged',finalText===resolvedText);
 await shot('chip-send.png');
 await click(editor);await key('Enter');
 const outgoing=await wait(()=>control('/provider-request'),v=>v.providerCalls>0,'scripted provider request');
 const strings=(value:any):string[]=>typeof value==='string'?[value]:Array.isArray(value)?value.flatMap(strings):value&&typeof value==='object'?Object.values(value).flatMap(strings):[];
 const content=strings(outgoing.prompt);
 const delivered=content.find(text=>text.includes(finalText));
 check('chip-summary-exactly-present-in-provider-request',outgoing.providerCalls===1&&!!delivered);
 writeFileSync(join(artifacts,'chip-context.json'),JSON.stringify({method:'harness user-equivalent send to local scripted provider',status:'pass',noSendEvidence:'no-send.json',providerCalls:outgoing.providerCalls,codeUnits:finalText.length,sha256:createHash('sha256').update(finalText).digest('hex'),attachedMatches:attached===resolvedText,exactSummaryPresent:!!delivered,observerExcerpt:delivered?.slice(delivered.indexOf(finalText),delivered.indexOf(finalText)+finalText.length)},null,2));
 assert.ok(results.every(r=>r.pass),'all acceptance assertions');
}catch(e){failure=e instanceof Error?e.message:'acceptance failed';await captureFailure?.().catch(()=>{});}
finally {
 ws?.close();
 if(browser?.pid){try{process.kill(-browser.pid,'SIGTERM');}catch{}await new Promise<void>(r=>{if(browser!.exitCode!==null)r();else browser!.once('exit',()=>r());});}
 rmSync(profile,{recursive:true,force:true});
 writeFileSync(join(artifacts,'results.json'),JSON.stringify({hostVersion:fixture.hostVersion,openCodeVersion:fixture.openCodeVersion,bundleHashes,results,screenshots,failure,profileRemoved:!existsSync(profile)},null,2));
}
if(failure){console.error(failure);process.exitCode=1;}
