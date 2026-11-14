/** Combined acceptance on the caller's disposable managed host, never a Store actor seed. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import type { OpenCode } from '@opencode/client';
import type { Binding } from '../../shared/binding.ts';
import type { Store } from '../../shared/store.ts';
import type { managedBrowser } from '../browser/managed-companion-qa.ts';
import { javascriptLiteral as literal } from '../../shared/javascript-literal.ts';

export async function reportingSessionsJourney(o:{root:string;binding:Binding;store:Store;client:ReturnType<typeof OpenCode.make>;location:{directory:string};browser:Awaited<ReturnType<typeof managedBrowser>>;api:(method:string,route:string,body?:unknown)=>Promise<any>}) {
  const {root,binding,store,client,location,browser,api}=o;
  const {wait,click,text,key,send,evaluate,openRail,guestClick}=browser.nativeControls;
  const checks:string[]=[],check=(name:string,value:boolean)=>{assert.ok(value,name);checks.push(name);fs.writeFileSync(`${root}/journey-checks.json`,JSON.stringify(checks));};
  const language=async(value:'en'|'ru')=>{
    await guestClick('panel','[data-testid="interface-language"] button');
    await guestClick('panel',`[role="option"][id$="-${value}"]`,async()=>{
      if(await browser.guest('panel','document.querySelector("[data-testid=interface-language] button")?.getAttribute("aria-expanded")==="false"'))await guestClick('panel','[data-testid="interface-language"] button');
    });
    await wait(()=>browser.guest('panel','document.documentElement.lang'),v=>v===value,'rendered interface language');
  };
  const jobs:Record<string,unknown>={},seen=new Set<string>();let generation=0;
  const create=(title:string)=>client.session.create({location,agent:'build',title,model:{providerID:'managed-fixture',id:'script'},permissions:[{action:'*',resource:'*',effect:'allow'}]});
  const a=await create('Reporting coordinator'),b=await create('Other chat'),empty=await create('No reported plan');
  await api('POST',`/api/openchamber/sessions/${a.id}/links`,{directory:location.directory,linked:true,entries:[{id:'synthetic/project#1',number:1,title:'<b>Synthetic linked issue</b>',url:'https://example.invalid/issues/1',kind:'issue',linkedAt:1}]});
  const invoke=async(sessionID:string,input:any,name='agent_progress_report')=>{
    const agents=name==='subagent'?await client.agent.list({location}):null;
    jobs[sessionID]={generation:++generation,step:{name,input}};fs.writeFileSync(`${root}/jobs.json`,JSON.stringify(jobs));
    await client.session.prompt({sessionID,text:'Run this synthetic local acceptance step.'},{signal:AbortSignal.timeout(15000)});
    await client.session.wait({sessionID},{signal:AbortSignal.timeout(30000)});
    const messages=await client.message.list({sessionID,limit:100});
    const parts=messages.data.flatMap((m:any)=>m.type==='assistant'?m.content.filter((p:any)=>p.type==='tool'&&!seen.has(p.id)):[]);
    fs.writeFileSync(`${root}/journey-stage.json`,JSON.stringify({generation,name,op:input.op??null,agents:agents?.data.map(a=>a.id),sameLocation:(await client.session.get({sessionID})).location.directory===location.directory,parts:parts.map((p:any)=>({name:p.name,status:p.state.status,error:p.state.error?.message?.replaceAll(root,'<fixture>')}))}));
    assert.equal(parts.length,1,'one real tool invocation per scripted turn');const part=parts[0];seen.add(part.id);
    assert.equal(part.name,name,'native tool name');assert.equal(part.state.status,'completed','native tool completed');
    const content=part.state.content?.filter((p:any)=>p.type==='text').map((p:any)=>p.text).join('\n');
    return name==='agent_progress_report'?JSON.parse(content):part;
  };
  const report=(input:any,child=a.id)=>invoke(child,input);
  const plan='reporting-demo',detail=()=>store.detail(binding.source.id,plan),rev=()=>detail().plan.revision;
  await report({op:'start',plan,oid:'start',rev:0,title:'Reporting demonstration',items:['task-a','task-b','task-c'].map(id=>({id,title:id,kind:'task'}))});
  const children:string[]=[];
  for(const [i,task] of ['task-a','task-b'].entries()){
    await report({op:'delegate',plan,oid:`declare-${i}`,rev:rev(),assign:[task]});
    await invoke(a.id,{agent:'general',description:`Synthetic worker ${i+1}`,prompt:'Complete the synthetic bounded work.'},'subagent');
    await wait(async()=>detail().items.data.find(t=>t.id===task)?.assigneeSessionId,Boolean,'actual dispatch assignment');
    const child=detail().items.data.find(t=>t.id===task)!.assigneeSessionId!;assert.ok(child);children.push(child);
    check(`first-turn-${i}-no-inferred-progress`,detail().items.data.find(t=>t.id===task)?.status==='pending');
    assert.equal((await report({op:'change',plan,oid:`working-${i}`,rev:rev(),changes:[{id:task,status:'working'}]},child)).error,undefined);
  }
  await browser.selectSession('Reporting coordinator');await openRail();
  const reading=()=>browser.guest<any>('panel',`(()=>{const p=document.querySelector('[data-testid="plan-reporting-demo"]');return p?{source:p.dataset.source,rev:p.dataset.revision,working:[...document.querySelectorAll('[data-testid="item-task-a"],[data-testid="item-task-b"]')].map(e=>e.textContent)}:null})()`);
  await wait(reading,v=>v?.source===binding.source.id&&v.rev===String(rev()),'current source-qualified rail');await browser.shot('rail-working');
  await guestClick('panel','[data-testid="item-task-a"] summary');
  await wait(()=>browser.guest('panel','!!document.querySelector("[data-report=direct]")'),Boolean,'rendered direct child attribution');
  await guestClick('panel','[data-testid="sessions-more"]');
  await wait(()=>browser.guest('panel','!!document.querySelector("[data-testid=session-host-agent]")&&!!document.querySelector("[data-testid=session-host-link]")'),Boolean,'host-labelled optional metadata');
  check('literal-host-link',!!await browser.guest('panel','[...document.querySelectorAll("[data-testid=session-host-link]")].some(e=>e.textContent.includes("<b>Synthetic linked issue</b>")&&!e.querySelector("b,a"))'));
  const headings=()=>browser.guest<string[]>('panel','[...document.querySelectorAll("[data-testid=plan-panel-sessions] h2,[data-testid=plan-panel-sessions] h3")].map(e=>e.textContent)');
  assert.deepEqual(await headings(),['Sessions']);await browser.shot('sessions-heading');
  await language('ru');assert.deepEqual(await headings(),['Сессии']);await browser.shot('sessions-heading-ru');await language('en');
  await guestClick('panel','[data-testid="plan-panel-sessions-close"] button');
  check('working-reports-direct',detail().contributions.data.filter(c=>c.itemIds.length).every(c=>c.mode==='direct'&&children.includes(c.reporterSessionId)&&c.reporterSessionId===c.attributedSessionId));
  const stale=rev();
  for(const [i,child] of children.entries()){
    const task=i===0?'task-a':'task-b';
    assert.equal((await report({op:'change',plan,oid:`unassigned-${i}`,rev:rev(),changes:[{id:'task-c',status:'done'}]},child)).error,'assignment');
    const final={op:'handoff',oid:`final-${i}`,summary:'Synthetic explicit final task report',outcome:i===0?'done':'blocked',taskUpdate:{plan,rev:rev(),changes:[{id:task,status:i===0?'done':'blocked',...(i===1?{blocker:{reason:'Needs a format decision',nextAction:'Choose a format'}}:{})}]}};
    const receipt=await report(final,child);assert.ok(receipt.handoff);assert.equal(receipt.taskReceipt.rev,final.taskUpdate.rev+1);
    assert.deepEqual(await report(final,child),receipt);
  }
  assert.equal((await report({op:'change',plan,oid:'stale-parent',rev:stale,changes:[{id:'task-c',status:'done'}]})).error,'conflict');
  assert.equal((await report({op:'change',plan,oid:'stale-child',rev:stale,changes:[{id:'task-a',status:'working'}]},children[0])).error,'conflict');
  check('final-statuses',JSON.stringify(detail().items.data.map(t=>t.status))===JSON.stringify(['done','blocked','pending']));
  await wait(reading,v=>v?.rev===String(rev()),'final rail revision');await browser.shot('rail-final');
  await guestClick('panel','[data-testid="plan-view-map"]');
  await guestClick('panel','[data-testid="map-card-task-b"]');
  await wait(()=>browser.guest('panel','!!document.querySelector("[data-testid=map-attribution-reports]")'),Boolean,'map direct reports');
  // Keep the stacked rail inspector inside the actual capture, not clipped below the map.
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1800,deviceScaleFactor:1,mobile:false});
  await wait(()=>browser.guest('panel','(()=>{const e=document.querySelector("[data-testid=map-attribution-reports]"),r=e?.getBoundingClientRect();return !!r&&r.top>=0&&r.bottom<=innerHeight})()'),Boolean,'map attribution fits the visible guest');
  await browser.guest('panel','new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');await browser.shot('map-attribution');await send('Emulation.clearDeviceMetricsOverride');
  await guestClick('panel','[data-testid="plan-view-list"]');
  const actions=async(title:string,action:string)=>{
    fs.writeFileSync(`${root}/journey-stage.json`,JSON.stringify({phase:'session-menu',title,action}));
    const row=`[...document.querySelectorAll('[data-session-row-box]')].find(e=>e.checkVisibility()&&e.querySelector('[data-session-row-main]')?.textContent.includes(${literal(title)}))`;
    const hover=await wait(()=>evaluate<{x:number;y:number}|null>(`(()=>{const e=${row};e?.scrollIntoView({block:'nearest'});const r=e?.getBoundingClientRect();return r?{x:r.x+r.width/2,y:r.y+r.height/2}:null})()`),Boolean,'current visible synthetic session row');
    assert.ok(hover,'visible synthetic session row');await send('Input.dispatchMouseEvent',{type:'mouseMoved',...hover});
    // The pinned host uses right-click for mouse rows; its Session menu button is touch-only.
    await send('Input.dispatchMouseEvent',{type:'mousePressed',button:'right',clickCount:1,...hover});
    await send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'right',clickCount:1,...hover});
    fs.writeFileSync(`${root}/journey-stage.json`,JSON.stringify({phase:'export-submenu',title,action}));
    await click(`[...document.querySelectorAll('[role="menuitem"]')].find(e=>e.textContent==='Export')`);
    fs.writeFileSync(`${root}/journey-stage.json`,JSON.stringify({phase:'extension-action',title,action}));
    await click(text(action));
  };
  await browser.selectSession('Other chat');await actions('Reporting coordinator','Open Agent Progress');
  await wait(reading,v=>v?.rev===String(rev()),'inactive clicked session scope');await browser.shot('session-action');
  await browser.selectSession('No reported plan');await wait(reading,v=>v?.rev===String(rev()),'pinned scope after chat switch');check('clicked-scope-pinned',true);
  await click(`[...document.querySelectorAll('button[aria-label="Close panel"]')].findLast(e=>e.checkVisibility())`);
  await wait(()=>browser.nativeControls.guestContext('panel'),v=>!v,'closed rail retired');await openRail();
  const pinned=()=>browser.guest('panel','document.querySelector("[data-testid=session-action-scope]")?.textContent??null');
  await wait(pinned,v=>!!v?.includes('Reporting coordinator')&&v.includes('Show current session'),'ordinary reopen retains honest pinned scope');
  check('ordinary-reopen-retains-item',true);
  await guestClick('panel','[data-testid="session-action-reset"] button');
  await wait(()=>browser.guest('panel','!!document.querySelector("[data-testid=empty-state]")&&!document.querySelector("[data-testid=session-action-scope]")'),Boolean,'explicit reset shows actual empty current session');
  await wait(()=>browser.guest('panel','!!document.activeElement?.closest("[data-testid=empty-state]")'),Boolean,'reset focus lands in empty state');
  check('explicit-reset-current-session-and-focus',true);await browser.shot('session-action-reset');
  await actions('Reporting coordinator','Open Agent Progress');
  await wait(()=>browser.guest('panel','!!document.querySelector("[data-testid=empty-state]")&&!document.querySelector("[data-testid=session-action-scope]")'),Boolean,'documented identical-item limitation retains reset');check('same-target-repeat-stays-reset-documented-limit',true);
  await actions('Other chat','Open Agent Progress');
  await wait(pinned,v=>!!v?.includes('Other chat'),'different session action ends reset');
  await actions('Reporting coordinator','Open Agent Progress');
  await wait(reading,v=>v?.source===binding.source.id&&v.rev===String(rev()),'A action pins after different target');check('different-target-then-original-repins',true);
  await language('ru');
  assert.ok((await pinned())?.includes('Показать текущую сессию'));
  await wait(reading,v=>v?.source===binding.source.id&&v.rev===String(rev()),'Russian pinned reading ready');
  await guestClick('panel','[data-testid="session-action-scope"] > span:first-child');
  await browser.guest('panel','document.querySelector("[data-testid=session-action-reset] button").focus()');
  await wait(()=>browser.guest('panel','document.hasFocus()&&!!document.activeElement?.closest("[data-testid=session-action-reset]")'),Boolean,'reset owns keyboard focus');
  await key(' ','Space');
  await wait(()=>browser.guest('panel','!!document.querySelector("[data-testid=empty-state]")&&!document.querySelector("[data-testid=session-action-scope]")'),Boolean,'Russian reset returns to current session');
  await wait(()=>browser.guest('panel','!!document.activeElement?.closest("[data-testid=empty-state]")'),Boolean,'Russian reset focus');await browser.shot('session-action-reset-ru');check('russian-reset-focus',true);await language('en');
  await actions('No reported plan','Open Agent Progress');
  await wait(()=>browser.guest('panel','!!document.querySelector("[data-testid=empty-state]")'),Boolean,'complete empty session');await browser.shot('empty-or-unavailable');
  await report({op:'start',plan:'reporting-secondary',oid:'secondary',rev:0,title:'Other reported plan',items:[{id:'other',title:'Other task',kind:'task'}]});
  const providerCalls=()=>fs.readFileSync(`${root}/events.jsonl`,'utf8').split('\n').filter(Boolean).map(s=>JSON.parse(s)).filter(e=>e.type==='outgoing').length;
  const beforeComposer=providerCalls();
  await actions('Reporting coordinator','Open Agent Progress');
  await wait(()=>browser.guest('panel','!!document.querySelector("[data-testid=plan-selector]")'),Boolean,'multiple-plan picker');await browser.shot('multiple-plans');
  // Exercise existing background actions with a different active destination.
  await browser.selectSession('Other chat');
  const draft=()=>evaluate<string>(`document.querySelector('[data-chat-column="main"] [contenteditable="true"]')?.innerText??''`);
  for(const action of ['Insert handoff','Insert progress update']){
    const before=await draft();await actions('Reporting coordinator',action);
    await wait(draft,v=>v.length>before.length&&v.includes('Reported progress, not verified completion'),'background insertion only');
  }
  check('existing-background-actions',true);
  await actions('Reporting coordinator','Open Agent Progress');
  await guestClick('panel','[data-testid="plan-view-map"]');
  check('map-control-focus',!!await browser.guest('panel','document.activeElement?.closest("[data-testid=plan-view-map]")!==null'));
  await key('Tab');check('tab-enters-map',!!await browser.guest('panel','document.activeElement!==document.body'));
  await key('Enter');await key('Escape');
  check('map-keyboard-enter-escape',true);
  await guestClick('panel','[data-testid="plan-view-list"]');
  await language('ru');await browser.shot('session-action-ru');await language('en');check('russian-rendered',true);
  const background=()=>browser.guest('panel','getComputedStyle(document.body).backgroundColor');const light=await background();
  await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'},{name:'prefers-color-scheme',value:'dark'}]});
  await wait(background,v=>v!==light,'host dark theme propagated');await browser.shot('session-action-dark');
  const mediaTarget=await browser.nativeControls.guestContext('panel');assert.ok(mediaTarget);
  await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]},mediaTarget.sessionId);
  await wait(()=>browser.guest('panel','matchMedia("(prefers-reduced-motion: reduce)").matches'),Boolean,'guest reduced-motion emulation');check('reduced-motion',true);
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:1000,deviceScaleFactor:1,mobile:false});
  check('narrow-no-guest-overflow',!!await browser.guest('panel','document.documentElement.scrollWidth<=innerWidth'));await browser.shot('narrow');await send('Emulation.clearDeviceMetricsOverride');
  const gone=await create('Removed target');await actions('Removed target','Open Agent Progress');
  await wait(()=>browser.guest('panel','document.querySelector("[data-testid=session-action-scope]")?.textContent??""'),v=>v.includes('Removed target'),'removed target initially verified');
  await client.session.remove({sessionID:gone.id});
  await wait(()=>browser.guest('panel','!!document.querySelector("[data-testid=session-action-context]")'),Boolean,'removed target refused without fallback');
  check('removed-target-unavailable',true);await browser.shot('unavailable-session');
  await guestClick('panel','[data-testid="session-action-reset"] button');
  await actions('Reporting coordinator','Open Agent Progress');
  const hasShownPlan=()=>browser.guest('panel','!!document.querySelector("[data-testid^=plan-][data-source][data-revision]")');
  await wait(pinned,v=>!!v?.includes('Reporting coordinator'),'restored A scope before grant denial');await wait(hasShownPlan,Boolean,'loaded A plan before grant denial');
  // Denied grants use the actual host approval boundary, not fabricated SDK replies.
  const priorGrants=(await api('GET','/api/guests')).guests.find((g:any)=>g.id==='agent-progress-probe').capabilities.granted;
  await api('PUT','/api/guests/agent-progress-probe/capabilities',{granted:[]});
  await wait(hasShownPlan,v=>!v,'withdrawn grants retire plan');check('withdrawn-grants',true);
  await api('PUT','/api/guests/agent-progress-probe/capabilities',{granted:priorGrants});
  check('ui-and-composer-never-send',providerCalls()===beforeComposer);
  return {checks,realDispatches:children.length,directReports:true,combinedReplay:true,unassignedRefusals:2,staleRefusals:2,credentials:0,limits:['Linux web only; no general model compliance or first-execution reporting guarantee'],sessions:{coordinator:a.id,other:b.id,empty:empty.id}};
}
