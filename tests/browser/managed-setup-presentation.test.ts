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

function render(progress?:ManagedFreshStepProgress,locale='en',diagnostics:string[]=[],invalid=false){
  const el=(_tag:string,_class='',text=''):any=>({text,dataset:{},children:[] as any[],
    get childElementCount(){return this.children.length;},
    append(...children:any[]){this.children.push(...children);},setAttribute(){},removeAttribute(){},addEventListener(){},querySelector:()=>null});
  const testid=(node:any,id:string)=>{node.dataset.testid=id;return node;};
  const exports:any={};
  const js=ts.transpileModule(readFileSync(new URL('../../ui/shared/setup.ts',import.meta.url),'utf8'),
    {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  runInNewContext(js,{exports,document:{visibilityState:'visible'},require:(name:string)=>{
    if(name==='@openchamber/sdk/ui')return {mountBanner:(node:any,o:any)=>node.append(el('p','',o.title),el('p','',o.body))};
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
      configuration:invalid?'invalid':'configured',migration:invalid?'unavailable':progress?.state==='complete'?'complete':'pending',
      mode:'unknown',observation:'unknown',expectedVersion:null,...(progress?{freshProgress:progress}:{})}})));
  const root=exports.setupBlock({env:{locale},ui:{setup:exports.initialSetupUi()},setup:{state:'ready',value:info},
    ctx:{connection:{account:'synthetic'}},requestSetup(){throw new Error('Unexpected status request');},updateUi(){},service(){throw new Error('Unexpected mutation');}});
  const nodes=(node:any):any[]=>[node,...node.children.flatMap((child:any)=>typeof child==='string'?[{text:child,dataset:{}}]:nodes(child))];
  const all=nodes(root);
  return {text:all.map(n=>n.text).join(' '),has:(id:string)=>all.some(n=>n.dataset.testid===id)};
}

const prepared=managedFreshStepFixtures().replies.prepared.progress!;
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

test('fresh pending read failure still offers explicit continuation; completed read failure keeps its complete card',()=>{
  const pending:ManagedFreshStepProgress={...prepared,sequence:3,step:{name:'expectation',batch:0},lastCompleted:{name:'create-store',batch:0}};
  assert.ok(render(pending,'en',['EBUSY']).has('setup-migration-continue'));
  const complete:ManagedFreshStepProgress={...pending,sequence:8,state:'complete',step:null,lastCompleted:{name:'reconcile',batch:0},recovery:'none'};
  const shown=render(complete,'en',['EACCES']);
  assert.ok(shown.has('setup-migration-progress'),'durable completion survives an unavailable capture observation');
  assert.match(shown.text,/Setup finished/);
  assert.equal(shown.text.includes(copy.managedFreshCopy().partial),false);
  assert.equal(shown.has('setup-migration-resume'),false);
});

test('fresh retention wording distinguishes database creation in an existing directory from reconnection',()=>{
  const created=managedFreshStepFixtures('create',false).replies.prepared.progress!;
  const p:ManagedFreshStepProgress={...created,sequence:3,state:'failed',step:{name:'expectation',batch:0},lastCompleted:{name:'create-store',batch:0},
    diagnostic:{stage:'expectation',code:'storage'},recovery:'resume'};
  assert.equal(render(p).text.split(copy.managedFreshCopy().partial).length-1,1);
  const retained=managedFreshStepFixtures('retain',false).replies.prepared.progress!;
  assert.equal(render({...retained,state:'failed',diagnostic:{stage:'expectation',code:'storage'},recovery:'resume'}).has('setup-fresh-partial'),false);
});
