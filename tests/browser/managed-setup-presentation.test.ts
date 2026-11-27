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

function render(progress?:ManagedFreshStepProgress,locale='en',diagnostics:string[]=[],invalid=false,initial=false){
  const el=(tag:string,_class='',text=''):any=>({tag,text,dataset:{},children:[] as any[],
    get childElementCount(){return this.children.length;},
    append(...children:any[]){this.children.push(...children);},setAttribute(){},removeAttribute(){},addEventListener(){},querySelector:()=>null});
  const testid=(node:any,id:string)=>{node.dataset.testid=id;return node;};
  const exports:any={};
  const js=ts.transpileModule(readFileSync(new URL('../../ui/shared/setup.ts',import.meta.url),'utf8'),
    {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  runInNewContext(js,{exports,document:{visibilityState:'visible'},require:(name:string)=>{
    if(name==='@openchamber/sdk/ui')return {mountBanner:(node:any,o:any)=>node.append(el('p','',o.title),el('p','',o.body)),
      mountTextField:(node:any,o:any)=>node.append(el('label','',o.label),el('p','',o.helper))};
    if(name==='./components.ts')return {el,testid,button:(parent:any,id:string,label:string)=>parent.append(testid(el('button','',label),id))};
    if(name==='./i18n.ts')return {resolveLanguage};
    if(name==='./managed-copy.ts')return copy;
    if(name==='./setup-steps.ts')return steps;
    if(name==='./setup-style.ts')return {ensureSetupStyle(){}};
    if(name==='../../shared/managed-steps.ts')return contract;
    throw new Error(`Unexpected render dependency: ${name}`);
  }});
  const info=parseSetup(JSON.stringify(setupRead({separateLifecycle:false,captureEnabled:null,verified:false,diagnostics,
    delivery:{kind:'managed',revision:1,managedMigrationSteps:1,managedFreshSteps:1,planKind:'fresh',
       configuration:initial?'unconfigured':invalid?'invalid':'configured',migration:initial?'none':invalid?'unavailable':progress?.state==='complete'?'complete':'pending',
      mode:'unknown',observation:'unknown',expectedVersion:null,...(progress?{freshProgress:progress}:{})}})));
  const root=exports.setupBlock({env:{locale},ui:{setup:exports.initialSetupUi()},setup:{state:'ready',value:info},
    ctx:{connection:{account:'synthetic'}},requestSetup(){throw new Error('Unexpected status request');},updateUi(){},service(){throw new Error('Unexpected mutation');}});
  const nodes=(node:any):any[]=>[node,...node.children.flatMap((child:any)=>typeof child==='string'?[{text:child,dataset:{}}]:nodes(child))];
  const all=nodes(root);
  return {all,nodes,text:all.map(n=>n.text).join(' '),has:(id:string)=>all.some(n=>n.dataset.testid===id)};
}

for(const locale of ['en','ru','zh-CN'])test(`fresh ${locale}: initial technical facts remain reachable in one disclosure, recording stays outside`,()=>{
  const shown=render(undefined,locale,[],false,true),text=copy.managedCopy(locale);
  const disclosure=shown.all.find(n=>n.dataset.testid==='setup-changes');
  assert.equal(disclosure.tag,'details');
  assert.equal(disclosure.children[0].tag,'summary');
  assert.equal(disclosure.children[0].text,copy.managedFreshCopy(locale).disclosure);
  const within=shown.nodes(disclosure),facts=within.map(n=>n.text).join(' ');
  for(const fact of [text.unconfigured,text.unknown,text.observation,text.privilege,text.lifecycle,text.reach])assert.ok(facts.includes(fact),'moved fact is retained');
  assert.ok(shown.has('managed-capture-control'));
  assert.ok(!within.some(n=>n.dataset.testid==='managed-capture-control'),'recording is visible before opening the disclosure');
  assert.ok(shown.has('setup-storeRoot'));
  assert.ok(shown.has('setup-inspect'));
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
  assert.ok(!pendingShown.text.includes(f.completedReadUnavailable));
  const complete:ManagedFreshStepProgress={...pending,sequence:8,state:'complete',step:null,lastCompleted:{name:'reconcile',batch:0},recovery:'none'};
  const shown=render(complete,locale,['EACCES']);
  assert.ok(shown.has('setup-migration-progress'),'durable completion survives an unavailable capture observation');
  assert.equal(shown.all.find(n=>n.dataset.testid==='setup-migration-heading')?.text,f.titles.complete);
  assert.equal(shown.text.includes(f.partial),false);
  assert.equal(shown.has('setup-migration-resume'),false);
  assert.ok(shown.has('setup-migration-capture-warning'),'completion with unknown recording keeps the warning');
  assert.ok(shown.has('setup-recording-state'),'recording state remains outside the disclosure');
  assert.ok(shown.has('setup-migration-status'),'completion with unknown recording offers a status check');
  const warning=shown.all.find(n=>n.dataset.testid==='setup-migration-capture-warning');
  assert.ok(shown.nodes(warning).some(n=>n.text===f.completedReadUnavailable));
  assert.ok(!shown.text.includes(f.warn.create.unknown.body),'completion never asks to finish the finished operation');
  const noDiagnostic=render(complete,locale);
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
