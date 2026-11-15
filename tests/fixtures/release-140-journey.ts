/** Joined release acceptance on an owned, isolated real host and tracked built entries. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import type { reportingSessionsJourney } from './reporting-sessions-journey.ts';

export async function release140Journey(o:Parameters<typeof reportingSessionsJourney>[0]) {
  const {root,binding,store,client,location,browser}=o;
  const {wait,openRail,openBoard,guestClick,holdNextServiceReply,send,evaluate}=browser.nativeControls;
  const checks:string[]=[];
  const check=(id:string,ok:boolean)=>{assert.ok(ok,id);checks.push(id);fs.writeFileSync(`${root}/release-checks.json`,JSON.stringify(checks));};
  const stage=(phase:string)=>fs.writeFileSync(`${root}/journey-stage.json`,JSON.stringify({phase}));
  const jobs=JSON.parse(fs.readFileSync(`${root}/jobs.json`,'utf8'));let generation=1000;
  const create=(title:string)=>client.session.create({location,agent:'build',title,model:{providerID:'managed-fixture',id:'script'},permissions:[{action:'*',resource:'*',effect:'allow'}]});
  const a=await create('Release coordinator'),b=await create('Release inbox reviewer');
  const invoke=async(sessionID:string,input:any,name='agent_progress_report',during?:()=>Promise<void>)=>{
    const before=(await client.message.list({sessionID,limit:100})).data.flatMap((m:any)=>m.type==='assistant'?m.content.map((p:any)=>p.id):[]);
    jobs[sessionID]={generation:++generation,step:{name,input}};fs.writeFileSync(`${root}/jobs.json`,JSON.stringify(jobs));
    await client.session.prompt({sessionID,text:'Run the synthetic release acceptance step.'},{signal:AbortSignal.timeout(15000)});
    if(during)await during();
    await client.session.wait({sessionID},{signal:AbortSignal.timeout(40000)});
    const parts=(await client.message.list({sessionID,limit:100})).data.flatMap((m:any)=>m.type==='assistant'?m.content.filter((p:any)=>p.type==='tool'&&!before.includes(p.id)):[]);
    assert.equal(parts.length,1,'one actual native tool call');assert.equal(parts[0].name,name);assert.equal(parts[0].state.status,'completed');
    return name==='agent_progress_report'?JSON.parse(parts[0].state.content.filter((p:any)=>p.type==='text').map((p:any)=>p.text).join('\n')):parts[0];
  };
  const report=(input:any,sessionID=a.id)=>invoke(sessionID,input);
  const plan='plan-alpha',detail=()=>store.detail(binding.source.id,plan),rev=()=>detail().plan.revision;
  const planNode='[data-testid="plan-plan-alpha"]';
  const reading=()=>browser.guest<any>('panel',`(()=>{const p=document.querySelector('${planNode}');return p?{source:p.dataset.source,revision:p.dataset.revision,delegation:p.dataset.delegation}:null})()`);
  const intent=async(state:string,hook?:string)=>{
    await wait(reading,v=>v?.source===binding.source.id&&v.revision===String(rev())&&v.delegation===state,`release intent ${state}`);
    if(hook)await wait(()=>browser.guest('panel',`!!document.querySelector('${planNode} [data-testid="${hook}"]')`),Boolean,hook);
  };
  const language=async(surface:string,value:'en'|'ru'|'zh-CN')=>{
    await guestClick(surface,'[data-testid="interface-language"] button');
    await guestClick(surface,`[role="option"][id$="-${value}"]`);
    await wait(()=>browser.guest(surface,'document.documentElement.lang'),v=>v===value,'release interface language');
  };
  stage('release-pending-cancelled');
  await report({op:'start',plan,oid:'release-start',rev:0,title:'Release synthetic plan',items:['task-a','task-b','task-c'].map(id=>({id,title:id,kind:'task'}))});
  await browser.selectSession('Release coordinator');await openRail();
  // The legacy journey deliberately ends with another pinned action. Reset it explicitly.
  if(await browser.guest('panel','!!document.querySelector("[data-testid=session-action-reset]")'))await guestClick('panel','[data-testid="session-action-reset"] button');
  await report({op:'delegate',plan,oid:'release-pending',rev:rev(),assign:['task-a']});
  await intent('waiting','delegation-pending');await browser.shot('release-intent-pending');
  check('plan-and-task-hooks-source-revision',!!await browser.guest('panel',`(()=>{const p=document.querySelector('${planNode}'),t=p?.querySelector('[data-testid="item-task-a"]');return p?.dataset.source===${JSON.stringify(binding.source.id)}&&p.dataset.revision===${JSON.stringify(String(rev()))}&&!!t})()`));
  check('pending-note-no-status-or-assignee',detail().items.data.every(i=>i.status==='pending'&&!i.assigneeSessionId));
  await report({op:'delegate',plan,oid:'release-cancel',rev:rev(),assign:[]});await intent('clear');
  check('cancelled-clears-note',!await browser.guest('panel',`!!document.querySelector('${planNode} [data-testid="delegation-pending"]')`));
  stage('release-reserved-parallel');
  await report({op:'delegate',plan,oid:'release-a',rev:rev(),assign:['task-a']});
  await invoke(a.id,{agent:'general',description:'Release first worker',prompt:'Complete synthetic bounded work.'},'subagent');
  const childA=detail().items.data.find(i=>i.id==='task-a')!.assigneeSessionId!;assert.ok(childA);
  await report({op:'delegate',plan,oid:'release-b',rev:rev(),assign:['task-b']});
  fs.writeFileSync(`${root}/hold-children`,'synthetic barrier');
  try{
    await invoke(a.id,{agent:'general',description:'Release second worker',prompt:'Complete synthetic bounded work.'},'subagent',async()=>{
      await wait(async()=>store.db.prepare('SELECT dispatch FROM runs_intents WHERE source=? AND parent=?').get(binding.source.id,a.id)?.dispatch,Boolean,'real reserved dispatch');
      await intent('waiting','delegation-pending');await browser.shot('release-intent-reserved');check('reserved-still-unassigned',!detail().items.data.find(i=>i.id==='task-b')!.assigneeSessionId);
      await report({op:'change',plan,oid:'release-a-working',rev:rev(),changes:[{id:'task-a',status:'working'}]},childA);
      check('parallel-sibling-direct-report-before-binding',detail().items.data.find(i=>i.id==='task-a')!.reporterSessionId===childA);
      fs.unlinkSync(`${root}/hold-children`);
    });
  }finally{fs.rmSync(`${root}/hold-children`,{force:true});}
  const childB=detail().items.data.find(i=>i.id==='task-b')!.assigneeSessionId!;assert.ok(childB&&childA!==childB);
  await report({op:'change',plan,oid:'release-b-working',rev:rev(),changes:[{id:'task-b',status:'working'}]},childB);
  check('two-real-children-direct',detail().items.data.slice(0,2).every(i=>i.reporterSessionId===i.assigneeSessionId));
  stage('release-intent-refused');
  await report({op:'delegate',plan,oid:'release-refuse',rev:rev(),assign:['task-c']});
  await report({op:'change',plan,oid:'release-touch',rev:rev(),changes:[{id:'task-c',status:'pending'}]});
  await invoke(a.id,{agent:'general',description:'Release refused worker',prompt:'Complete synthetic bounded work.'},'subagent');
  await intent('refused','delegation-refused');check('conflict-refusal-no-assignment',!detail().items.data.find(i=>i.id==='task-c')!.assigneeSessionId);
  await browser.shot('release-intent-conflict');
  stage('release-atomic-finish');
  const finishPlan='release-finish';
  await report({op:'start',plan:finishPlan,oid:'finish-start',rev:0,title:'Atomic finish demonstration',items:[{id:'finish-task',title:'Finish task',kind:'task'}]});
  await report({op:'change',plan:finishPlan,oid:'finish-race',rev:1,changes:[{id:'finish-task',status:'working'}]});
  const stale=await report({op:'finish',plan:finishPlan,oid:'finish-stale',rev:1,outcome:'finished',changes:[{id:'finish-task',status:'done'}]});
  check('atomic-finish-conflict-no-mutation',stale.error==='conflict'&&store.get(binding.source.id,finishPlan)!.revision===2&&store.get(binding.source.id,finishPlan)!.lifecycle==='active');
  const finish={op:'finish',plan:finishPlan,oid:'finish-atomic',rev:2,outcome:'finished',changes:[{id:'finish-task',status:'done'}]};
  const receipt=await report(finish);const finished=store.get(binding.source.id,finishPlan)!;
  check('real-atomic-finish-one-revision',receipt.rev===3&&finished.lifecycle==='finished'&&finished.items[0].status==='done');
  check('real-atomic-finish-replay',JSON.stringify(await report(finish))===JSON.stringify(receipt)&&store.get(binding.source.id,finishPlan)!.revision===3);
  stage('release-source-wide-inbox');
  await report({op:'start',plan:'release-decisions',oid:'decisions',rev:0,title:'Source-wide review',items:['review-one','review-two','review-three'].map(id=>({id,title:id,kind:'task',status:'blocked',blocker:{category:id==='review-two'?'review':'decision',reason:'Synthetic choice required',nextAction:'Choose a synthetic format'}}))},b.id);
  await wait(()=>browser.guest('panel','document.querySelector("[data-testid=needs-you-count]")?.getAttribute("data-count")'),v=>v==='3','three source-wide inbox tasks');
  check('source-wide-inbox-three-outside-current-session',true);await browser.shot('release-inbox');
  for(const locale of ['ru','zh-CN'] as const){
    await language('panel',locale);
    await wait(()=>browser.guest('panel','document.querySelector("[data-testid=needs-you-heading]")?.textContent'),v=>!!v?.includes(locale==='ru'?'Нужно ваше участие':'需要你'),'translated inbox heading');
    await browser.shot(`release-inbox-${locale}`);check(`inbox-${locale}`,true);
  }
  await guestClick('panel','[data-testid="needs-you-row"] button');
  await wait(()=>browser.guest('panel','!!document.querySelector("[data-testid=needs-you-reading-heading]")'),Boolean,'inbox source-wide reading');
  await wait(()=>browser.guest('panel',`document.querySelector('[data-testid="plan-release-decisions"]')?.dataset.source===${JSON.stringify(binding.source.id)}&&!!document.querySelector('[data-testid="item-review-one"][data-nav-target]')`),Boolean,'source-qualified canonical task reveal');
  check('task-reveal-source-qualified',true);
  await browser.shot('release-task-reveal-zh-CN');
  await openBoard();
  await language('page','zh-CN');
  if(!await browser.guest('page','document.querySelector("[data-testid=setup-section]")?.open'))await guestClick('page','[data-testid="setup-section"] > summary');
  await wait(()=>browser.guest('page','!!document.querySelector("[data-testid=setup-disable]")'),Boolean,'Chinese configured Setup');
  check('setup-zh-CN',!!await browser.guest('page','document.documentElement.lang==="zh-CN"&&!!document.querySelector("[data-testid=setup-panel]")'));
  await browser.shot('release-setup-zh-CN');
  stage('release-session-held-reply');
  await browser.selectSession('Release coordinator');await openRail();
  if(await browser.guest('panel','!!document.querySelector("[data-testid=needs-you-back]")'))await guestClick('panel','[data-testid="needs-you-back"]');
  await wait(reading,v=>v?.source===binding.source.id,'coordinator before held reply');
  const hold=await holdNextServiceReply('/v1/plans');
  try{
    await hold.wait();
    await browser.selectSession('Release inbox reviewer');
    await wait(()=>browser.guest('panel','!!document.querySelector("[data-testid=plan-release-decisions]")&&!document.querySelector("[data-testid=plan-plan-alpha]")'),Boolean,'new session while old reply held');
    await hold.release();
    await browser.guest('panel','new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    check('session-switch-retires-held-reply',!await browser.guest('panel',`!!document.querySelector('${planNode}')`));
    await browser.shot('release-session-held-reply');
  }finally{await hold.release();}
  stage('release-browser-reconnect');
  await send('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:-1,uploadThroughput:-1});
  await wait(()=>evaluate('navigator.onLine'),v=>v===false,'browser is actually offline');
  await send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
  await browser.reloadChat();
  // A document load precedes the host's retained-panel hydration. Wait for the
  // actual session selection before touching its toggle, not an old guest target.
  await wait(()=>evaluate('document.querySelector("[data-session-row-box][aria-current=page]")?.innerText.includes("Release inbox reviewer")'),Boolean,'reloaded host session hydrated');
  await browser.selectSession('Release inbox reviewer');await openRail();
  await wait(()=>browser.guest('panel','!!document.querySelector("[data-testid=plan-release-decisions]")&&!document.querySelector("[data-testid=plan-plan-alpha]")'),Boolean,'fresh host reconnect reading');
  check('browser-reconnect-current-session',true);await browser.shot('release-reconnect');
  return {checks,realDispatches:3,parallelChildren:2,atomicFinish:{conflict:true,replay:true,oneRevision:true},intentStates:['pending','reserved','cancelled','refused'],limits:['Host/source switching with a held reply remain unexecuted; not certified by this journey.','Reconnect covers browser transport plus reload, not host-process restart or mobile relay.','Linux web only; physical phone acceptance is owner-only.']};
}
