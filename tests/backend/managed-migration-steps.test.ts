import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {pathToFileURL} from 'node:url';
import {isolatedEnvironment} from '../fixtures/managed.ts';
import {lifecycle,migrationEvidence} from '../../setup/lifecycle.ts';
import {createManagedBindingDirectory,managedExpectationFile,publishPrivateJson} from '../../shared/managed-binding.ts';
import {writeMigration,migrationFile,readManagedStepJournal} from '../../setup/managed-migration.ts';
import {inspectManagedStep,type ManagedInspectionSession} from '../../setup/managed-inspection.ts';
import {beginManagedStep,observeManagedStep} from '../../setup/managed-step-engine.ts';
import {PlatformRequestBudget,withPlatformRequestBudget} from '../../shared/platform.ts';
import type {ManagedStepRequest} from '../../shared/managed-steps.ts';
import {Store} from '../../shared/store.ts';

const payload={plugin:'// synthetic managed',guidance:'synthetic guidance',removal:'// synthetic removal',version:'1.3.0'};
function fixture(kind:'manifest'|'selected'|'upgrade'|'receipt'='manifest'){
  const root=fs.mkdtempSync('/tmp/opencode/step-begin-'),env=isolatedEnvironment(root);
  const targets={configRoot:path.join(env.XDG_CONFIG_HOME!,'opencode'),dataRoot:path.join(env.XDG_DATA_HOME!,'opencode'),storeRoot:path.join(root,'store'),confirmed:true};
  for(const file of [targets.configRoot,targets.dataRoot])fs.mkdirSync(file,{mode:0o700});
  lifecycle('install',targets,{...payload,version:'1.1.1'});
  const evidence=migrationEvidence(targets);
  if(kind!=='manifest'){
    const file=createManagedBindingDirectory(env);
    if(kind==='selected')publishPrivateJson(file,{...evidence.binding,installId:'managed-synthetic'});
    else writeMigration(env,{binding:{...evidence.binding,installId:'managed-synthetic'},legacyInstallId:evidence.binding.installId,phase:'pending'});
    if(kind==='receipt')lifecycle('remove-capture',targets);
  }
  let session:ManagedInspectionSession|undefined;
  for(let i=0;i<6;i++)session=inspectManagedStep(env,payload,session).session;
  const request:Extract<ManagedStepRequest,{action:'begin'}>={version:1,action:'begin',operationId:'11111111-1111-4111-8111-111111111111',confirmed:true,expected:session!.review!.expected};
  return {root,env,targets,evidence,session:session!,request,cleanup(){fs.rmSync(root,{recursive:true,force:true});}};
}
function begin(f:ReturnType<typeof fixture>,session:ManagedInspectionSession|null=f.session,request=f.request,budget=new PlatformRequestBudget()){
  return withPlatformRequestBudget(budget,()=>beginManagedStep(f.env,payload,request,budget,session??undefined));
}
for(const kind of ['manifest','selected','upgrade','receipt'] as const)test(`${kind} begin prepares once; cold exact retry uses only its durable receipt`,()=>{
  const f=fixture(kind);try{
    const db=fs.readFileSync(f.evidence.binding.database),history=fs.readFileSync(path.join(f.targets.storeRoot,'installation-history.jsonl'));
    const prepared=begin(f);assert.equal(prepared.disposition,'applied');assert.equal(prepared.progress.sequence,1);
    assert.equal(prepared.progress.state,'pending');assert.deepEqual(prepared.progress.step,{name:'expectation',batch:0});
    assert.equal(prepared.progress.capture.state,'unknown');
    const journal=readManagedStepJournal(f.env)!;
    assert.equal(journal.migration.operationId,f.request.operationId);assert.equal(journal.migration.consent.reviewDigest,f.request.expected);
    assert.equal(journal.migration.legacy.kind,kind==='receipt'?'removal-receipt':'manifest');
    assert.deepEqual(fs.readdirSync(path.dirname(migrationFile(f.env))).sort(),['.ownership.json','migration.json',...(kind==='selected'?['progress-binding.json']:[])]);
    assert.equal(fs.existsSync(managedExpectationFile(journal)),false);
    assert.deepEqual(fs.readFileSync(f.evidence.binding.database),db);assert.deepEqual(fs.readFileSync(path.join(f.targets.storeRoot,'installation-history.jsonl')),history);
    const bytes=fs.readFileSync(migrationFile(f.env));
    const budget=new PlatformRequestBudget();
    const replay=withPlatformRequestBudget(budget,()=>beginManagedStep(f.env,payload,f.request,budget));
    assert.equal(replay.disposition,'replayed');assert.equal(replay.progress.sequence,1);assert.equal(replay.progress.capture.state,'unknown');
    assert.deepEqual(fs.readFileSync(migrationFile(f.env)),bytes);
    assert.equal(begin(f).disposition,'replayed','an old retained review cannot duplicate a published prepare');
    const store=new Store(journal.database);try{store.setEnabled(false);}finally{store.close();}
    assert.equal(begin(f).progress.capture.state,'unknown','replay never reports historical capture-on');
    assert.throws(()=>begin(f,null,{...f.request,expected:'f'.repeat(64)}),{code:'managed-step-conflict'});
    assert.throws(()=>begin(f,null,{...f.request,operationId:'22222222-2222-4222-8222-222222222222'}),{code:'managed-step-conflict'});
    assert.deepEqual(fs.readFileSync(migrationFile(f.env)),bytes);
  }finally{f.cleanup();}
});

test('begin refuses absent consent and changed capture/ownership before creating metadata',()=>{
  for(const change of ['expired','capture','ownership'] as const){
    const f=fixture();try{
      if(change==='capture'){const store=new Store(f.evidence.binding.database);try{store.setEnabled(false);}finally{store.close();}}
      if(change==='ownership')fs.appendFileSync(path.join(f.targets.configRoot,'plugins','agent-progress','index.js'),'changed');
      const budget=new PlatformRequestBudget();
      assert.throws(()=>withPlatformRequestBudget(budget,()=>beginManagedStep(f.env,payload,f.request,budget,change==='expired'?undefined:f.session)));
      assert.equal(fs.existsSync(path.dirname(migrationFile(f.env))),false);
    }finally{f.cleanup();}
  }
});

test('a legacy install identity cannot be adopted as the managed selection',()=>{
  const f=fixture('selected');try{
    const selector=path.join(path.dirname(migrationFile(f.env)),'progress-binding.json');
    publishPrivateJson(selector,f.evidence.binding,true);
    assert.throws(()=>begin(f),{code:'managed-review-stale'});
    let session:ManagedInspectionSession|undefined;
    assert.throws(()=>{for(let i=0;i<6;i++)session=inspectManagedStep(f.env,payload,session).session;},{code:'managed-migration-conflict'});
    assert.equal(fs.existsSync(migrationFile(f.env)),false);
  }finally{f.cleanup();}
});

test('prepare refuses an exhausted deadline before directory creation',()=>{
  const f=fixture();try{
    const budget=new PlatformRequestBudget(process.hrtime.bigint()-18_000_000_000n);
    assert.throws(()=>begin(f,f.session,f.request,budget),{code:'managed-step-deadline'});
    assert.equal(fs.existsSync(path.dirname(migrationFile(f.env))),false);
  }finally{f.cleanup();}
});

test('a slow directory creation stops before journal publication and permits explicit retry',t=>{
  const f=fixture();try{
    const clock=process.hrtime.bigint,started=clock(),file=migrationFile(f.env);
    const mock=t.mock.method(process.hrtime,'bigint',()=>fs.existsSync(path.join(path.dirname(file),'.ownership.json'))?started+18_000_000_000n:started);
    try{assert.throws(()=>begin(f,f.session,f.request,new PlatformRequestBudget(started)),{code:'managed-step-deadline'});}
    finally{mock.mock.restore();}
    assert.equal(fs.existsSync(file),false);assert.equal(fs.existsSync(path.join(path.dirname(file),'.ownership.json')),true);
    assert.equal(begin(f).disposition,'applied');
  }finally{f.cleanup();}
});

for(const boundary of ['directory','marker','journal-before','journal-after'] as const)test(`interrupted prepare at ${boundary} retains honest bootstrap recovery`,t=>{
  const f=fixture();try{
    const file=migrationFile(f.env),root=path.dirname(file),mkdir=fs.mkdirSync,write=fs.writeFileSync,link=fs.linkSync;
    const fail=()=>{throw new Error('synthetic interruption');};
    const mocks=[
      t.mock.method(fs,'mkdirSync',((p:any,...args:any[])=>{const result=(mkdir as any)(p,...args);if(boundary==='directory'&&String(p)===root)fail();return result;}) as typeof fs.mkdirSync),
      t.mock.method(fs,'writeFileSync',((p:any,...args:any[])=>{const result=(write as any)(p,...args);if(boundary==='marker'&&String(p)===path.join(root,'.ownership.json'))fail();return result;}) as typeof fs.writeFileSync),
      t.mock.method(fs,'linkSync',((from:any,to:any)=>{if(boundary==='journal-before'&&String(to)===file)fail();const result=link(from,to);if(boundary==='journal-after'&&String(to)===file)fail();return result;}) as typeof fs.linkSync),
    ];syncBuiltinESMExports();
    try{assert.throws(()=>begin(f),/synthetic interruption/);}finally{for(const mock of mocks)mock.mock.restore();syncBuiltinESMExports();}
    if(boundary==='directory')assert.throws(()=>begin(f),{code:'managed-binding-invalid'});
    else assert.equal(begin(f).disposition,boundary==='journal-after'?'replayed':'applied');
    assert.equal(fs.existsSync(path.join(root,'progress-binding.json')),false);
  }finally{f.cleanup();}
});

test('status is read-only, reports no operation when absent, and refuses a different operation identity',()=>{
  const f=fixture();try{
    assert.equal(observeManagedStep(f.env),undefined);
    assert.throws(()=>observeManagedStep(f.env,f.request.operationId),{code:'not-found'});
    begin(f);const bytes=fs.readFileSync(migrationFile(f.env));
    assert.equal(observeManagedStep(f.env,f.request.operationId)!.migration.sequence,1);
    assert.throws(()=>observeManagedStep(f.env,'22222222-2222-4222-8222-222222222222'),{code:'not-found'});
    assert.deepEqual(fs.readFileSync(migrationFile(f.env)),bytes);
  }finally{f.cleanup();}
});

test('integrated prepare, upgrade, retry and status start no process on the Windows path',{skip:process.platform==='win32'},async t=>{
  const original=process.env.SystemRoot;
  try{for(const kind of ['manifest','selected','upgrade','receipt'] as const){
    const f=fixture(kind);try{
      const source=path.join(f.root,'source');for(const dir of ['shared','setup'])fs.cpSync(path.resolve(dir),path.join(source,dir),{recursive:true});
      const platformFile=path.join(source,'shared/platform.ts');let text=fs.readFileSync(platformFile,'utf8');
      text=text.replace("export const windows = process.platform === 'win32';",'export const windows = true;');
      const start=text.indexOf("  if (value.includes('\\0')",text.indexOf('function windowsPathsInner(')),end=text.indexOf('  let current = clean;',start);
      assert.ok(start>0&&end>start);text=text.slice(0,start)+"  if (!path.isAbsolute(value) || path.resolve(value) !== value) throw new PlatformError('path-unverified');\n  const clean = value;\n"+text.slice(end);fs.writeFileSync(platformFile,text);
      let spawns=0;
      const mock=t.mock.method(cp,'spawnSync',(()=>{spawns++;throw new Error('no permission check may start a process');}) as unknown as typeof cp.spawnSync);syncBuiltinESMExports();process.env.SystemRoot='C:\\Windows';
      try{
        const platform=await import(pathToFileURL(platformFile).href) as typeof import('../../shared/platform.ts');
        const engine=await import(pathToFileURL(path.join(source,'setup/managed-step-engine.ts')).href) as typeof import('../../setup/managed-step-engine.ts');
        for(const name of ['begin','retry','status'] as const){
          const budget=new platform.PlatformRequestBudget();
          platform.withPlatformRequestBudget(budget,()=>name==='status'?engine.observeManagedStep(f.env,f.request.operationId):engine.beginManagedStep(f.env,payload,f.request,budget,name==='begin'?f.session:undefined));
          assert.equal(spawns,0,`${kind} ${name}`);
        }
      }finally{mock.mock.restore();syncBuiltinESMExports();}
    }finally{f.cleanup();}
  }}finally{if(original===undefined)delete process.env.SystemRoot;else process.env.SystemRoot=original;}
});
