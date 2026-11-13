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
      const navigation=events.length;await send('Page.reload');
      // readyState can still describe the OLD document immediately after reload.
      // Wait for this navigation's load event before inspecting the new target.
      await wait(async()=>events.slice(navigation).some(e=>e.method==='Page.loadEventFired'),Boolean,'fresh host page loaded');await openBoard();
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
    // One scripted tool part per native assistant message. Resolve by that actual
    // transcript message identity, then its accessible header, not a CSS class.
    const toolHeader=(message:string)=>`[...document.querySelectorAll('[data-chat-column="main"] [data-message-id='+CSS.escape(${literal(message)})+'] [role="button"]')].find(e=>e.querySelector('[title]'))`;
    const rowState=(message:string):Promise<any>=>evaluate(`(()=>{const e=${toolHeader(message)};if(!e)return null;const body=e.nextElementSibling,icon=e.querySelector('use'),glyph=icon&&document.querySelector(icon.getAttribute('href'));return {message:e.closest('[data-message-id]')?.getAttribute('data-message-id'),title:e.querySelector('[title]')?.getAttribute('title'),header:e.innerText,expanded:body?.getAttribute('aria-hidden')==='false',body:body?.innerText??'',icon:icon?.getAttribute('href'),glyph:!!glyph?.querySelector('path'),error:!!e.querySelector('[style*="--status-error"]'),tabIndex:e.tabIndex,width:e.getBoundingClientRect().width}})()`);
    const revealRow=async(message:string)=>{
      await wait(async()=>{
        const found=await evaluate(`(()=>{const e=${toolHeader(message)};if(e){e.scrollIntoView({block:'center'});return true;}let node=document.querySelector('[data-chat-column="main"] [data-message-id]');while(node){if(node.scrollHeight>node.clientHeight&&/auto|scroll/.test(getComputedStyle(node).overflowY)){const first=node.querySelector('[data-message-id]')?.getAttribute('data-message-id');node.scrollTop+=first&&first>${literal(message)}?-node.clientHeight/2:node.clientHeight/2;break;}node=node.parentElement;}return false;})()`);
        await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');return found&&!!await rowState(message);
      },Boolean,'native transcript message revealed');
    };
    const rowToggle=async(message:string,expanded:boolean,method:'pointer'|'Enter'|'Space'='pointer')=>{
      await revealRow(message);
      if((await rowState(message)).expanded===expanded)return;
      if(method==='pointer'){
        let prior='';
        const point=await wait<any>(async()=>{
          await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
          const p=await evaluate(`(()=>{const e=${toolHeader(message)};if(!e)return null;const r=e.getBoundingClientRect(),x=r.x+8,y=r.y+r.height/2,hit=document.elementFromPoint(x,y);if(hit&&e.contains(hit))return {x,y};e.scrollIntoView({block:'center',behavior:'instant'});return null;})()`);
          const current=JSON.stringify(p),stable=p&&current===prior;prior=current;return stable?p:null;
        },Boolean,'settled actionable native tool header');
        await pointer(point.x,point.y);
      }
      else {await evaluate(`(${toolHeader(message)}).focus()`);await key(method==='Space'?' ':method,method);}
      await wait(()=>rowState(message),v=>v?.expanded===expanded,`native body disclosure ${method} ${expanded}`);
    };
    const reportRow=async(message:string,output:string,nativeError=false)=>{
      await wait(()=>rowState(message),v=>v?.title==='Agent progress report','neutral report title');
      await rowToggle(message,false);await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:1,y:1});
      const collapsed=await rowState(message);assert.equal(collapsed.message,message);assert.equal(collapsed.icon,'#oc-list-check-2');assert.ok(collapsed.glyph);assert.equal(collapsed.tabIndex,0);
      assert.equal(collapsed.header.trim(),'Agent progress report','no outcome subtitle');
      await rowToggle(message,true,'pointer');
      // Native error UI flattens whitespace; receipt bodies must retain their
      // actual serialized text. Do not force the error through our text layout.
      const expanded=await wait(()=>rowState(message),v=>nativeError?v?.body.replace(/\s+/g,' ').includes(output.replace(/\s+/g,' ')):v?.body.includes(output),'literal native output');
      if(nativeError)assert.equal(expanded.error,true,'native error styling retained');
      await rowToggle(message,false,'Enter');await rowToggle(message,true,'Space');
      return {message,title:collapsed.title,icon:collapsed.icon,glyph:collapsed.glyph,collapsed:true,literalOutput:true,pointer:true,enter:true,space:true,nativeError:expanded.error};
    };
    const rowShot=async(name:string,messages:string[])=>{
      await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1900,deviceScaleFactor:1,mobile:false});
      for(const message of messages)await rowToggle(message,true);
      await revealRow(messages[0]);await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:1,y:1});
      await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');await shot(name);
      await send('Emulation.clearDeviceMetricsOverride');
    };
    const genericRow=async(message:string)=>{
      const row=await wait<any>(()=>evaluate(`(()=>{const e=document.querySelector('[data-chat-column="main"] [data-message-id='+CSS.escape(${literal(message)})+']');if(!e)return null;e.scrollIntoView({block:'center'});return {text:e.innerText,icons:[...e.querySelectorAll('use')].map(n=>n.getAttribute('href'))};})()`),Boolean,'generic native message');
      // The host's humanized generic name happens to equal our neutral label;
      // the actual generic glyph, not different wording, proves rule retirement.
      assert.ok(!row.icons.includes('#oc-list-check-2'));assert.ok(row.icons.includes('#oc-tools')||row.text.includes('Read File'));return row;
    };
    const reloadChat=async()=>{const at=events.length;await send('Page.reload');await wait(async()=>events.slice(at).some(e=>e.method==='Page.loadEventFired'),Boolean,'reloaded chat');};
    const narrow=async(message:string,output:string)=>{
      await send('Emulation.setDeviceMetricsOverride',{width:390,height:1000,deviceScaleFactor:1,mobile:false});
      await rowToggle(message,false);await rowToggle(message,true,'Space');
      const row=await wait(()=>rowState(message),v=>v?.body.replace(/\s+/g,' ').includes(output.replace(/\s+/g,' ')),'narrow native error output');
      assert.ok(row.width<=390);
      await evaluate(`(${toolHeader(message)}).parentElement.scrollIntoView({block:'center',behavior:'instant'})`);
      await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
      await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:1,y:1});await shot('narrow');
      await send('Emulation.clearDeviceMetricsOverride');return {width:390,headerWidth:row.width,literalOutput:true,keyboardDisclosure:true};
    };
    return {install,configure,views,warning,setupShot,observedChatDirectories,selectSession,shot,stop,failure,guest,reportRow,rowShot,rowToggle,genericRow,reloadChat,narrow,screenshots:()=>screenshots,console:()=>({exceptions:events.filter(e=>e.method==='Runtime.exceptionThrown').length})};
  }catch(e){await stop();throw e;}
}
