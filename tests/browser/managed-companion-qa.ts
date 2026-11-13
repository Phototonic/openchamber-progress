/** Real web UI/CDP driver. No SDK shell, browser attachment or synthetic host replies. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { once } from 'node:events';
import { javascriptLiteral as literal } from '../../shared/javascript-literal.ts';

export async function managedBrowser(options:{chromium:string;root:string;artifacts:string;url:string}) {
  const {root,artifacts,url}=options,profile=`${root}/browser`;
  const browser=spawn(options.chromium,['--headless=new','--no-sandbox','--remote-debugging-address=127.0.0.1','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--no-first-run','--disable-background-networking','--disable-sync','--disable-extensions','--window-size=1440,1100','about:blank'],{stdio:'ignore'});
  let ws:WebSocket|undefined;
  const wait=async<T>(fn:()=>Promise<T>,ok:(v:T)=>boolean,label:string,ms=20000)=>{for(const end=Date.now()+ms;;){const v=await fn();if(ok(v))return v;assert.ok(Date.now()<end,label);await new Promise(r=>setTimeout(r,50));}};
  const stop=async()=>{ws?.close();if(browser.exitCode===null&&!browser.signalCode){const done=once(browser,'exit');browser.kill('SIGTERM');const timer=setTimeout(()=>browser.kill('SIGKILL'),3000);try{await done;}finally{clearTimeout(timer);}}};
  try {
    const port=await wait(async()=>existsSync(`${profile}/DevToolsActivePort`)?readFileSync(`${profile}/DevToolsActivePort`,'utf8').split('\n')[0]:'',Boolean,'browser ready');
    const targets=await wait<any[]>(async()=>(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as any[],v=>v.some(t=>t.type==='page'),'browser page target');
    ws=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);
    await new Promise<void>((r,j)=>{ws!.onopen=()=>r();ws!.onerror=()=>j(new Error('browser connection'));});
    let next=0;const pending=new Map<number,{resolve:(v:any)=>void;reject:(e:Error)=>void}>(),events:any[]=[];
    const send=(method:string,params:object={},sessionId?:string)=>new Promise<any>((r,j)=>{const id=++next;pending.set(id,{resolve:r,reject:j});ws!.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});
    ws.onmessage=e=>{const m=JSON.parse(String(e.data)),p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result);}else{events.push(m);if(m.method==='Target.attachedToTarget')void send('Runtime.enable',{},m.params.sessionId).catch(()=>{});}};
    const evaluate=async<T=any>(expression:string,contextId?:number,sessionId?:string):Promise<T>=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,...(contextId?{contextId}:{})},sessionId);if(r.exceptionDetails)throw new Error('browser evaluation failed');return r.result.value;};
    const screenshots:string[]=[];
    const shot=async(name:string)=>{const r=await send('Page.captureScreenshot',{format:'png'});writeFileSync(`${artifacts}/${name}.png`,Buffer.from(r.data,'base64'));screenshots.push(`${name}.png`);};
    const key=async(key:string,code=key)=>{await send('Input.dispatchKeyEvent',{type:'keyDown',key,code});await send('Input.dispatchKeyEvent',{type:'keyUp',key,code});};
    const pointer=async(x:number,y:number)=>{await send('Input.dispatchMouseEvent',{type:'mouseMoved',x,y});await send('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1});await send('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',clickCount:1});};
    const click=async(expression:string)=>{const p=await wait<any>(()=>evaluate<any>(`(()=>{const e=${expression};if(!e||!e.checkVisibility())return null;e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`),Boolean,'visible host control');await pointer(p.x,p.y);};
    const text=(value:string)=>`[...document.querySelectorAll('button,[role="tab"],[role="menuitem"],label,span')].find(e=>e.checkVisibility()&&(e.textContent.trim()===${literal(value)}||e.getAttribute('aria-label')===${literal(value)}||e.getAttribute('title')===${literal(value)}))`;
    const guestContext=async(surface:string)=>{
      for(const event of events.filter(e=>e.method==='Runtime.executionContextCreated'&&e.params.context.auxData?.isDefault).toReversed()) {
        try{
          if(!await evaluate(`document.querySelector('[data-surface]')?.getAttribute('data-surface')===${literal(surface)}&&!document.documentElement.hasAttribute('data-ap-hidden')`,event.params.context.id,event.sessionId))continue;
          const frame=event.params.context.auxData.frameId,owner=await send('DOM.getFrameOwner',{frameId:frame});
          const node=await send('DOM.resolveNode',{backendNodeId:owner.backendNodeId,objectGroup:'visible-guest'});
          const visible=await send('Runtime.callFunctionOn',{objectId:node.object.objectId,functionDeclaration:'function(){const r=this.getBoundingClientRect();return this.checkVisibility()&&r.width>0&&r.height>0&&document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===this;}',returnByValue:true});
          await send('Runtime.releaseObjectGroup',{objectGroup:'visible-guest'});if(!visible.result?.value)continue;
          return {id:event.params.context.id,frame,sessionId:event.sessionId};
        }catch{}
      }return null;
    };
    const guest=async<T=any>(surface:string,expression:string):Promise<T|null>=>{const context=await guestContext(surface);return context?evaluate<T>(expression,context.id,context.sessionId):null;};
    const guestClick=async(surface:string,selector:string)=>{
      const found=await wait<any>(async()=>{const context=await guestContext(surface);if(!context)return null;await evaluate(`document.querySelector(${literal(selector)})?.scrollIntoView({block:'nearest'})`,context.id,context.sessionId);await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');const local=await evaluate<any>(`(()=>{const e=document.querySelector(${literal(selector)});if(!e||!e.checkVisibility())return null;const r=e.getBoundingClientRect(),p={x:r.x+r.width/2,y:r.y+r.height/2},hit=document.elementFromPoint(p.x,p.y);return hit&&(hit===e||e.contains(hit))?p:null})()`,context.id,context.sessionId);return local?{context,local}:null;},Boolean,'visible actionable guest control');
      const {context,local}=found;
      const owner=await send('DOM.getFrameOwner',{frameId:context.frame});const box=await send('DOM.getBoxModel',{backendNodeId:owner.backendNodeId});await pointer(local.x+box.model.content[0],local.y+box.model.content[1]);
    };
    await send('Page.enable');await send('Runtime.enable');await send('Network.enable');await send('Target.setAutoAttach',{autoAttach:true,waitForDebuggerOnStart:false,flatten:true});
    await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
    await send('Page.navigate',{url});await wait(()=>evaluate('document.readyState'),v=>v==='complete','actual web UI');
    const install=async(extension:string)=>{
      await click(text('Settings'));await click(text('Extensions'));
      await wait(()=>evaluate('document.body.innerText'),v=>v.includes('Extensions'),'extension settings');
      // Host UI owns installation and its capability approval. No install/grant API shortcut.
      await click(text('Add extension'));
      const input=`[...document.querySelectorAll('input')].find(e=>e.checkVisibility()&&/path|folder|url/i.test(e.placeholder))`;
      await click(input);await send('Input.insertText',{text:extension});
      await click(`[...document.querySelectorAll('button')].findLast(e=>e.checkVisibility()&&/^(Install|Add|Install extension)$/.test(e.textContent.trim()))`);
      await wait(()=>evaluate('document.body.innerText'),v=>v.includes('Add a plugin to OpenCode')&&v.includes('Allow and enable'),'visible plugin disclosure');
      await shot('approval');await click(text('Allow and enable'));
      await wait(()=>evaluate('document.body.innerText'),v=>!v.includes('Allow and enable'),'approval accepted');await key('Escape');
    };
    const openRail=async()=>{
      if(await guest('panel',`!!document.querySelector('[data-testid="setup-panel"],[data-testid="plan-title"]')`))return;
      await click(`document.querySelector('button[aria-label="Agent progress"]')??document.querySelector('button[title="Agent progress"]')`);
      await wait(()=>guest('panel','!!document.querySelector("[data-surface]")'),Boolean,'rail open');
    };
    const openBoard=async()=>{
      if(await guestContext('panel'))await click(`[...document.querySelectorAll('button[aria-label="Close panel"]')].findLast(e=>e.checkVisibility())`);
      if(!await guestContext('page'))await click(`[...document.querySelectorAll('button')].find(e=>e.checkVisibility()&&e.textContent.trim()==='Agent progress')`);
      await wait(()=>guestContext('page'),Boolean,'visible board');
      await wait(()=>guest('page','!document.querySelector("[data-testid=state-loading],[data-testid=detail-loading]")&&!!document.querySelector("[data-testid=empty-state],[data-testid=plan-list-heading],[data-testid=plan-title]")'),Boolean,'board initial read settled');
    };
    const configure=async()=>{
      await openRail();await guestClick('panel','[data-testid="setup-inspect"] button');
      await wait(()=>guest('panel','!!document.querySelector("[data-testid=setup-review]")'),Boolean,'configuration consent');await shot('configuration-review');
      await guestClick('panel','[data-testid="setup-ack"] [role="checkbox"]');await guestClick('panel','[data-testid="setup-confirm"] button');
      await wait(()=>guest('panel','!!document.querySelector("[data-testid=setup-disable]")||(!document.querySelector("[data-testid=setup-needed]")&&!document.querySelector("[data-testid=setup-panel]"))'),Boolean,'configured');
      await openBoard();await guestClick('page','[data-testid="setup-section"] > summary');
      await wait(()=>guest('page','document.querySelector("[data-testid=setup-section]")?.open'),Boolean,'configured Setup disclosure open');
      await wait(()=>guest('page','!!document.querySelector("[data-testid=setup-disable]")'),Boolean,'configured Setup facts');await shot('configured');
    };
    const selectSession=async(title:string)=>{await click(`[...document.querySelectorAll('[data-session-row-main]')].find(e=>e.innerText===${literal(title)})`);await wait(()=>evaluate(`document.querySelector('[data-session-row-box][aria-current="page"]')?.innerText===${literal(title)}&&!!document.querySelector('[data-chat-column="main"] [contenteditable="true"]')`),Boolean,'session chat selected');};
    const warning=async()=>{await openBoard();if(!await guest('page','document.querySelector("[data-testid=setup-section]")?.open'))await guestClick('page','[data-testid="setup-section"] > summary');await wait(()=>guest('page','!!document.querySelector("[data-testid=managed-integrity-warning]")'),Boolean,'visible integrity warning');await shot('warning');};
    const setupShot=async(name:string,selector:string)=>{
      // Setup observations are deliberately not polled. After test-side external
      // mutations, a user-equivalent page refresh obtains a new real status read.
      await send('Page.reload');await wait(()=>evaluate('document.readyState'),v=>v==='complete','fresh host page');await openBoard();
      if(!await guest('page','document.querySelector("[data-testid=setup-section]")?.open'))await guestClick('page','[data-testid="setup-section"] > summary');
      await wait(()=>guest('page',`!!document.querySelector(${literal(selector)})`),Boolean,'current Setup state');await shot(name);
    };
    const observedChatDirectories=()=>{
      const paths=new Set<string>(),prefix=`${root}/home/.config/openchamber/chats/`;
      for(const event of events.filter(e=>e.method==='Network.requestWillBeSent')) {
        let text=event.params.request.url+'\n'+(event.params.request.postData??'');
        for(let n=0;n<3;n++){const at=text.indexOf(prefix);if(at>=0){const suffix=text.slice(at+prefix.length).match(/^\d{4}-\d{2}-\d{2}\/session-[a-f0-9-]+/);if(suffix)paths.add(prefix+suffix[0]);}try{text=decodeURIComponent(text);}catch{break;}}
      }return [...paths];
    };
    const views=async(done:number,total:number,revision:number)=>{
      await selectSession('Managed acceptance');
      const matches=(v:any)=>v?.title==='Managed acceptance plan'&&v.done===String(done)&&v.total===String(total)&&v.revision===String(revision)&&!v.loading;
      const reading=(surface:string)=>guest(surface,`(()=>{const root=document.querySelector('[data-surface]'),counts=root?.querySelector('[data-testid="counts"]');return {title:root?.querySelector('[data-testid="plan-title"],[data-testid="status-plan-title"]')?.textContent,revision:root?.querySelector('[data-testid="plan-P-managed"]')?.getAttribute('data-revision'),done:counts?.getAttribute('data-done'),total:counts?.getAttribute('data-total'),loading:!!root?.querySelector('[data-testid="state-loading"],[data-testid="detail-loading"]')}})()`);
      await openRail();const panel=await wait(()=>reading('panel'),matches,'rail revision counts');await shot(`rail-r${revision}`);
      await click(`[...document.querySelectorAll('button[aria-label="Close panel"]')].findLast(e=>e.checkVisibility())`);
      if(!await evaluate(`document.querySelector('button[aria-label="Toggle work-status panel"]')?.getAttribute('aria-pressed')==='true'`))await click(`document.querySelector('button[aria-label="Toggle work-status panel"]')`);
      const status=await wait(()=>reading('status'),matches,'Work Status revision counts');await shot(`status-r${revision}`);await openBoard();
      const page=await wait(()=>reading('page'),matches,'board revision counts');await shot(`board-r${revision}`);return {panel,status,page};
    };
    const failure=async()=>{await shot('failure').catch(()=>{});writeFileSync(`${artifacts}/failure-dom.json`,JSON.stringify(await evaluate('({text:document.body.innerText,buttons:[...document.querySelectorAll("button")].map(e=>({text:e.innerText,label:e.getAttribute("aria-label"),title:e.title})),inputs:[...document.querySelectorAll("input")].map(e=>({placeholder:e.placeholder,type:e.type}))})').catch(()=>null),null,2));};
    return {install,configure,views,warning,setupShot,observedChatDirectories,selectSession,shot,stop,failure,guest,screenshots:()=>screenshots,console:()=>({exceptions:events.filter(e=>e.method==='Runtime.exceptionThrown').length})};
  }catch(e){await stop();throw e;}
}
