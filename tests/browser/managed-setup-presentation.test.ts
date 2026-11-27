// Exercise the actual Setup renderer with text-only primitives; layout/focus use rendered QA.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import * as steps from '../../ui/shared/setup-steps.ts';
import * as copy from '../../ui/shared/managed-copy.ts';
import {resolveLanguage} from '../../ui/shared/i18n.ts';
import * as contract from '../../shared/managed-steps.ts';
import {parseSetup} from '../../ui/shared/adapter.ts';
import {managedFreshStepFixtures} from '../fixtures/managed-fresh-steps.ts';
import {setupRead} from './fixtures.ts';
import type {ManagedFreshStepProgress} from '../../shared/managed-steps.ts';

function render(progress?:ManagedFreshStepProgress,locale='en',diagnostics:string[]=[],invalid=false,initial=false,legacy?: 'verified' | 'unverified',
  options: { defaultStoreRoot?: unknown; refusal?: string } = {}){
  const el=(tag:string,_class='',text=''):any=>({tag,text,dataset:{},children:[] as any[],
    set textContent(value:string){this.text=value;},
    get childElementCount(){return this.children.length;},
    append(...children:any[]){this.children.push(...children);},setAttribute(){},removeAttribute(){},addEventListener(){},querySelector:()=>null});
  const testid=(node:any,id:string)=>{node.dataset.testid=id;return node;};
  let field: {value:string;onChange:(value:string)=>void} | undefined;
  const exports:any={};
  const js=ts.transpileModule(readFileSync(new URL('../../ui/shared/setup.ts',import.meta.url),'utf8'),
    {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  runInNewContext(js,{exports,document:{visibilityState:'visible'},require:(name:string)=>{
    if(name==='@openchamber/sdk/ui')return {mountBanner:(node:any,o:any)=>node.append(el('p','',o.title),el('p','',o.body)),
      mountTextField:(node:any,o:any)=>{field=o;node.append(el('label','',o.label),el('p','',o.helper));}};
    if(name==='./components.ts')return {el,testid,button:(parent:any,id:string,label:string,click:()=>void)=>parent.append(Object.assign(testid(el('button','',label),id),{click}))};
    if(name==='./i18n.ts')return {resolveLanguage};
    if(name==='./managed-copy.ts')return copy;
    if(name==='./setup-steps.ts')return steps;
    if(name==='./setup-style.ts')return {ensureSetupStyle(){}};
    if(name==='../../shared/managed-steps.ts')return contract;
    throw new Error(`Unexpected render dependency: ${name}`);
  }});
  const info=parseSetup(JSON.stringify(setupRead({configured:!initial,separateLifecycle:false,captureEnabled:legacy==='verified'?true:null,verified:legacy==='verified'||!!progress,diagnostics,
    delivery:{kind:'managed',revision:1,managedMigrationSteps:1,managedFreshSteps:1,...(!legacy?{planKind:'fresh'}:{}),
       configuration:initial?'unconfigured':invalid?'invalid':'configured',migration:initial?'none':invalid?'unavailable':legacy||progress?.state==='complete'?'complete':'pending',
      mode:'unknown',observation:'unknown',expectedVersion:null,defaultStoreRoot:options.defaultStoreRoot,...(progress?{freshProgress:progress}:{})}})));
  const sent: Array<{method: string;path: string;body: unknown}> = [];
  let statusReads=0;
  const vc={env:{locale},ui:{setup:exports.initialSetupUi()},setup:{state:'ready',value:info},
    ctx:{connection:{account:'synthetic'}},requestSetup(){statusReads++;},
    updateUi(update:(ui: unknown)=>object){Object.assign(this.ui,update(this.ui));},handoff(){},
    service(){return {async serviceRequest(q:{method:string;path:string;body:string}){
      sent.push({...q,body:JSON.parse(q.body)});
      assert.ok(options.refusal,'unexpected service call');
      return {status:409,body:JSON.stringify({version:2,disposition:'refused',progress:null,inspection:null,
        error:{stage:'store',code:options.refusal},accounting:{securitySpawns:0,elapsedMs:0}})};
    }};}};
  const paint=()=>exports.setupBlock(vc);
  const root=paint();
  const nodes=(node:any):any[]=>[node,...node.children.flatMap((child:any)=>typeof child==='string'?[{text:child,dataset:{}}]:nodes(child))];
  const all=nodes(root);
  const node=(id:string)=>all.find(n=>n.dataset.testid===id);
  return {all,nodes,node,text:all.map(n=>n.text).join(' '),has:(id:string)=>!!node(id),paint,sent,field,statusReads:()=>statusReads};
}

const defaultStoreRoot='/example/opencode/openchamber-progress';
const opening = (locale: string, options?: Parameters<typeof render>[6]) => render(undefined,locale,[],false,true,undefined,options);
test('fresh setup shows the actual recommended folder before inspection without prefilling it', async ()=>{
  const shown=opening('en',{defaultStoreRoot,refusal:'foreign-files'});
  assert.ok(shown.nodes(shown.node('setup-default-folder')).some(n=>n.text===defaultStoreRoot));
  assert.equal(shown.field?.value,'');
  assert.deepEqual(shown.sent,[]);
  assert.equal(shown.statusReads(),0);
  shown.node('setup-inspect').click();
  await new Promise<void>(resolve=>setImmediate(resolve));
  assert.deepEqual(shown.sent,[{method:'POST',path:'/v1/setup/managed-step',body:{version:2,action:'inspect'}}]);
  assert.ok(!opening('en').has('setup-default-folder'),'older services do not get a guessed path');
  assert.ok(!opening('en',{defaultStoreRoot:'not/an/absolute/path'}).has('setup-default-folder'));
});

for(const locale of ['en','ru','zh-CN'])test(`fresh ${locale}: relative and filesystem-root guidance adds no requests or new path rules`,async ()=>{
  const shown=opening(locale,{defaultStoreRoot,refusal:'managed-migration-conflict'}), words=copy.freshFolderCopy(locale);
  shown.field!.onChange('progress/data');
  assert.equal(shown.node('setup-folder-hint').text,words.relative);
  shown.node('setup-inspect').click();
  assert.equal(shown.sent.length,0);
  assert.equal(shown.statusReads(),0);
  for(const root of ['/','C:\\']){
    shown.field!.onChange(root);
    assert.equal(shown.node('setup-folder-hint').text,words.root);
  }
  assert.equal(shown.sent.length,0);
  shown.node('setup-inspect').click();
  await new Promise<void>(resolve=>setImmediate(resolve));
  assert.deepEqual(shown.sent.map(q=>q.body),[{version:2,action:'inspect',storeRoot:'C:\\'}],'root advice never changes server admission');
});

for(const [code,key] of [['managed-migration-conflict','conflict'],['managed-path-unverified','path'],['path-unverified','path'],
  ['managed-selection-conflict','selection'],['foreign-files','foreign'],['store-permissions','permissions'],
  ['EACCES','permissions'],['symlink-escape','link']] as const)test(`initial folder review: ${code} keeps its code and shows actionable guidance`,async ()=>{
  const shown=opening('en',{defaultStoreRoot,refusal:code});
  shown.field!.onChange('/example/custom folder');
  assert.equal(shown.node('setup-folder-hint').text,'');
  assert.deepEqual(shown.sent,[]);
  shown.node('setup-inspect').click();
  await new Promise<void>(resolve=>setImmediate(resolve));
  assert.deepEqual(shown.sent,[{method:'POST',path:'/v1/setup/managed-step',body:{version:2,action:'inspect',storeRoot:'/example/custom folder'}}]);
  const failure=shown.nodes(shown.paint()).find(n=>n.dataset.testid==='setup-migration-failure');
  assert.equal(failure?.dataset.code,code);
  assert.ok(shown.nodes(failure).some(n=>n.text===copy.freshFolderCopy('en')[key]));
  assert.equal(shown.statusReads(),1,'only the existing status reread after failure');
});

for(const locale of ['en','ru','zh-CN'])test(`fresh ${locale}: initial technical facts remain reachable in one disclosure, recording stays outside`,()=>{
  const shown=render(undefined,locale,[],false,true),text=copy.managedCopy(locale);
  const disclosure=shown.node('setup-details');
  assert.equal(disclosure.tag,'details');
  assert.equal(disclosure.children[0].tag,'summary');
  assert.equal(disclosure.children[0].text,text.details);
  const within=shown.nodes(disclosure),facts=within.map(n=>n.text).join(' ');
  for(const fact of [text.unconfigured,text.unknown,text.observation,text.privilege,text.lifecycle,text.reach])assert.ok(facts.includes(fact),'moved fact is retained');
  assert.ok(shown.has('managed-capture-control'));
  assert.ok(!within.some(n=>n.dataset.testid==='managed-capture-control'),'recording is visible before opening the disclosure');
  assert.ok(shown.has('setup-storeRoot'));
  assert.ok(shown.has('setup-inspect'));
  assert.ok(shown.all.indexOf(shown.node('setup-inspect'))<shown.all.indexOf(disclosure));
});

for(const locale of ['en','ru','zh-CN'])test(`managed ${locale}: verification and recording lead before technical details`,()=>{
  const words=copy.managedCopy(locale);
  for (const [state, diagnostics, status, next] of [
    ['unverified',['managed-migration-conflict'],words.unverified,words.conflict],
    ['unverified',[],words.unverified,words.checkFolders],
    ['verified',[],words.ready,words.on],
  ] as const){
    const shown=render(undefined,locale,[...diagnostics],false,false,state);
    const disclosure=shown.node('setup-details');
    const facts=shown.nodes(disclosure).map(n=>n.text);
    const lead=shown.all.slice(1,shown.all.indexOf(disclosure)).map(n=>n.text);
    assert.equal(lead[0],status);
    assert.ok(lead.includes(next),'recovery or recording is visible');
    for (const fact of [words.configured,words.complete,words.unknown,words.observation,words.privilege,words.lifecycle,words.reach]) assert.ok(facts.includes(fact));
    assert.ok(!facts.includes(next),'no duplicate lead guidance');
    if (state==='verified') assert.ok(shown.all.indexOf(shown.node('setup-disable'))<shown.all.indexOf(disclosure));
  }
});

const prepared=managedFreshStepFixtures().replies.prepared.progress!;
for (const [store, missing, source] of [['create',true,'create'],['create',false,'create'],['retain',false,'create'],['retain',false,'reuse']] as const)
test(`fresh groups ${store}/${missing}/${source}: frozen order, durable completion and stopped states`,()=>{
  const fixture=managedFreshStepFixtures(store,missing,source),plan=fixture.review.plan;
  const before=structuredClone(plan),groups=steps.freshStepGroups(plan);
  assert.deepEqual(groups.flatMap(g=>g.steps),plan,'every internal step belongs to exactly one contiguous group');
  assert.deepEqual(groups.map(g=>g.id),store==='create'?['folder','connect','record','check']:['folder','connect','check']);
  assert.equal(groups[0].existingFolder,!missing);
  assert.ok(groups.every(g=>g.state==='pending'));
  for(let at=1;at<plan.length;at++){
    for(const state of ['pending','running','paused','failed','abandoned'] as const){
      const p:ManagedFreshStepProgress={...fixture.replies.prepared.progress!,step:plan[at],lastCompleted:plan[at-1],state,worker:state==='running'?'active':'idle'};
      const shown=steps.freshStepGroups(plan,p),current=shown.findIndex(g=>g.steps.some(s=>s.name===plan[at].name));
      assert.equal(shown[current].state,state==='pending'?'paused':state,'a partly finished or reopened group is not complete');
      assert.ok(shown.slice(0,current).every(g=>g.state==='complete'));
      assert.ok(shown.slice(current+1).every(g=>g.state==='pending'));
    }
  }
  const completed=steps.freshStepGroups(plan,{...fixture.replies.prepared.progress!,state:'complete',step:null,lastCompleted:plan.at(-1)!});
  assert.ok(completed.every(g=>g.state==='complete'));
  assert.deepEqual(plan,before,'presentation never mutates the frozen plan');
});

for(const locale of ['en','ru','zh-CN'])test(`fresh ${locale}: last-action stage and bounded code remain visible beside localized guidance`,()=>{
  const code='managed-step-deadline',stage='create-store';
  const p:ManagedFreshStepProgress={...prepared,state:'failed',sequence:2,step:{name:stage,batch:0},
    lastCompleted:{name:'store-directory',batch:0},diagnostic:{stage,code},recovery:'resume'};
  const shown=render(p,locale),text=copy.managedFamilyStepCopy('fresh',locale);
  assert.ok(shown.text.includes(code),'support code must be visible, not only a data attribute');
  assert.ok(shown.text.includes(text.stoppedAt(text.stages[stage]!)));
  const guidance=copy.managedErrorText(code,locale,'fresh');assert.ok(guidance);
  assert.ok(shown.text.includes(guidance));
});

for(const locale of ['en','ru','zh-CN'])test(`fresh ${locale}: partial-folder guidance is resource-based, not repeated by error copy`,()=>{
  const partial=copy.managedFreshCopy(locale).partial;
  for(const code of ['managed-migration-conflict','storage'] as const){
    const p:ManagedFreshStepProgress={...prepared,state:'failed',sequence:2,step:{name:'create-store',batch:0},
      lastCompleted:{name:'store-directory',batch:0},diagnostic:{stage:'create-store',code},recovery:'resume'};
    const shown=render(p,locale);
    assert.equal(shown.text.split(partial).length-1,1,'one checkpoint-backed retention message');
    assert.ok(shown.has('setup-fresh-partial'));
  }
});

for(const locale of ['en','ru','zh-CN'])test(`fresh ${locale}: no partial-folder claim before storage creation`,()=>{
  const partial=copy.managedFreshCopy(locale).partial;
  const beforeFolder:ManagedFreshStepProgress={...prepared,state:'failed',diagnostic:{stage:'store-directory',code:'storage'},recovery:'resume'};
  assert.equal(render(beforeFolder,locale).text.includes(partial),false,'no storage checkpoint yet');
  const preMarker=render(undefined,locale,['managed-binding-invalid'],true);
  assert.equal(preMarker.text.includes(partial),false,'an invalid marker is not a store-folder claim');
  assert.equal(preMarker.has('setup-fresh-partial'),false);
});

for(const locale of ['en','ru','zh-CN'])test(`fresh ${locale}: read failure qualifies the completed card without displacing it`,()=>{
  const pending:ManagedFreshStepProgress={...prepared,sequence:3,step:{name:'expectation',batch:0},lastCompleted:{name:'create-store',batch:0}};
  const f=copy.managedFreshCopy(locale);
  const pendingShown=render(pending,locale,['EBUSY']);
  assert.ok(pendingShown.has('setup-migration-continue'));
  assert.ok(pendingShown.has('setup-migration-capture-warning'));
  assert.ok(!pendingShown.text.includes(f.completedReadUnavailable));
  const complete:ManagedFreshStepProgress={...pending,sequence:8,state:'complete',step:null,lastCompleted:{name:'reconcile',batch:0},recovery:'none'};
  const shown=render(complete,locale,['EACCES']);
  assert.ok(shown.has('setup-migration-progress'),'durable completion survives an unavailable capture observation');
  assert.equal(shown.all.find(n=>n.dataset.testid==='setup-migration-heading')?.text,f.titles.complete);
  assert.equal(shown.text.includes(f.partial),false);
  assert.equal(shown.has('setup-migration-resume'),false);
  assert.ok(shown.has('setup-migration-capture-warning'),'completion with unknown recording keeps the warning');
  assert.ok(!shown.has('setup-recording-state'),'the warning already explains that recording is unconfirmed');
  assert.ok(shown.has('setup-migration-status'),'completion with unknown recording offers a status check');
  for (const [view, action] of [[pendingShown,'setup-migration-continue'],[shown,'setup-migration-status']] as const) {
    const i=(hook:string)=>view.all.indexOf(view.node(hook));
    assert.ok(i('setup-migration-heading')<i('setup-migration-capture-warning'));
    assert.ok(i('setup-migration-capture-warning')<i(action) && i(action)<i('setup-fresh-groups'));
    assert.ok(i('setup-fresh-groups')<i('setup-details'));
    const facts=view.nodes(view.node('setup-details'));
    for (const hook of ['setup-fresh-plan','managed-load-observation','setup-disclosure']) assert.ok(facts.includes(view.node(hook)));
    assert.ok(!view.has('managed-capture-control'));
  }
  const warning=shown.all.find(n=>n.dataset.testid==='setup-migration-capture-warning');
  assert.ok(shown.nodes(warning).some(n=>n.text===f.completedReadUnavailable));
  const card=shown.all.find(n=>n.dataset.testid==='setup-migration-progress');
  const cardNodes=shown.nodes(card);
  assert.equal(cardNodes.filter(n=>n.text===f.completedReadUnavailable).length,1);
  assert.ok(!cardNodes.some(n=>n.text===f.recording.unknown));
  assert.ok(!shown.text.includes(f.warn.create.unknown.body),'completion never asks to finish the finished operation');
  const noDiagnostic=render(complete,locale);
  assert.ok(!noDiagnostic.has('setup-recording-state'));
  assert.ok(noDiagnostic.text.includes(f.completedRecording.unknown));
  assert.ok(!noDiagnostic.text.includes(f.completedReadUnavailable));
});

test('fresh retention wording distinguishes database creation in an existing directory from reconnection',()=>{
  const created=managedFreshStepFixtures('create',false).replies.prepared.progress!;
  const p:ManagedFreshStepProgress={...created,sequence:3,state:'failed',step:{name:'expectation',batch:0},lastCompleted:{name:'create-store',batch:0},
    diagnostic:{stage:'expectation',code:'storage'},recovery:'resume'};
  assert.equal(render(p).text.split(copy.managedFreshCopy().partial).length-1,1);
  const retained=managedFreshStepFixtures('retain',false).replies.prepared.progress!;
  assert.equal(render({...retained,state:'failed',diagnostic:{stage:'expectation',code:'storage'},recovery:'resume'}).has('setup-fresh-partial'),false);
});
