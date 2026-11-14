import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {pathToFileURL} from 'node:url';
import {isolatedEnvironment} from '../fixtures/managed.ts';
import {lifecycle,migrationEvidence} from '../../setup/lifecycle.ts';
import {createManagedBindingDirectory,managedBindingFile,managedExpectationFile} from '../../shared/managed-binding.ts';
import {readManagedStepJournal,migrationFile,writeMigration} from '../../setup/managed-migration.ts';
import {inspectManagedStep,type ManagedInspectionSession} from '../../setup/managed-inspection.ts';
import {beginManagedStep,advanceManagedStep,controlManagedStep} from '../../setup/managed-step-engine.ts';
import {PlatformRequestBudget,withPlatformRequestBudget} from '../../shared/platform.ts';
import {Store} from '../../shared/store.ts';
import type {ManagedStepRequest} from '../../shared/managed-steps.ts';

const payload={plugin:'// synthetic managed',guidance:'synthetic guidance',removal:'// synthetic removal',version:'1.3.0'};
function fixture(receipt=false){
  const root=fs.mkdtempSync('/tmp/opencode/step-engine-'),env=isolatedEnvironment(root);
  const targets={configRoot:path.join(env.XDG_CONFIG_HOME!,'opencode'),dataRoot:path.join(env.XDG_DATA_HOME!,'opencode'),storeRoot:path.join(root,'store'),confirmed:true};
  for(const file of [targets.configRoot,targets.dataRoot])fs.mkdirSync(file,{mode:0o700});
  lifecycle('install',targets,{...payload,version:'1.1.1'});
  if(receipt){
    const evidence=migrationEvidence(targets);createManagedBindingDirectory(env);
    writeMigration(env,{binding:{...evidence.binding,installId:'managed-synthetic'},legacyInstallId:evidence.binding.installId,phase:'pending'});
    lifecycle('remove-capture',targets);
  }
  const review=()=>{let session:ManagedInspectionSession|undefined;for(let i=0;i<6;i++)session=inspectManagedStep(env,payload,session).session;return session!;};
  const session=review(),budget=new PlatformRequestBudget();
  withPlatformRequestBudget(budget,()=>beginManagedStep(env,payload,{version:1,action:'begin',operationId:'11111111-1111-4111-8111-111111111111',confirmed:true,expected:session.review!.expected},budget,session));
  const journal=()=>readManagedStepJournal(env)!;
  const request=():Extract<ManagedStepRequest,{action:'advance'}>=>{const m=journal().migration;return {version:1,action:'advance',operationId:m.operationId,expectedSequence:m.sequence,step:m.step!};};
  const advance=(r=request())=>{const budget=new PlatformRequestBudget();return withPlatformRequestBudget(budget,()=>advanceManagedStep(env,payload,r,budget,journal()));};
  const control=(action:'pause'|'resume'|'abandon',review?:Extract<ManagedStepRequest,{action:'resume'}>['review'],session?:ManagedInspectionSession)=>{
    const current=journal(),budget=new PlatformRequestBudget();
    const request:Extract<ManagedStepRequest,{action:'pause'|'resume'|'abandon'}>={version:1,action,operationId:current.migration.operationId,expectedSequence:current.migration.sequence,...(review?{review}:{})};
    return withPlatformRequestBudget(budget,()=>controlManagedStep(env,payload,request,budget,current,session));
  };
  const until=(step:string)=>{while(journal().migration.step?.name!==step){const result=advance();assert.equal(result.disposition,'applied',JSON.stringify(result.error));}};
  const capture=(enabled?:boolean)=>{const store=new Store(journal().database);try{if(enabled!==undefined)store.setEnabled(enabled);return store.list().captureEnabled;}finally{store.close();}};
  return {root,env,targets,journal,review,request,advance,control,until,capture,cleanup(){fs.rmSync(root,{recursive:true,force:true});}};
}

for(const receipt of [false,true])test(`${receipt?'receipt':'manifest'} engine completes one effect per request, retains identity/history and replays terminal completion`,()=>{
  const f=fixture(receipt);try{
    const initial=f.journal(),history=path.join(f.targets.storeRoot,'installation-history.jsonl'),before=fs.readFileSync(history);
    const steps:string[]=[];let last:ReturnType<typeof f.request>|undefined;
    while(f.journal().migration.state!=='complete'){
      const request=f.request(),prior=f.journal(),result=f.advance(request);last=request;
      assert.equal(result.disposition,'applied',JSON.stringify(result.error));assert.equal(result.error,null);
      const next=f.journal();steps.push(request.step.name);
      assert.equal(next.migration.sequence,prior.migration.sequence+1);assert.deepEqual(next.migration.lastCompleted,request.step);
      assert.deepEqual(next.migration.consent,initial.migration.consent);assert.equal(next.storeId,initial.storeId);assert.deepEqual(next.source,initial.source);
      const bytes=fs.readFileSync(migrationFile(f.env));assert.equal(f.advance(request).disposition,'replayed');assert.deepEqual(fs.readFileSync(migrationFile(f.env)),bytes);
      assert.equal(f.advance(request).progress.capture.state,'unknown');
    }
    assert.deepEqual(steps,initial.migration.plan.slice(1).map(s=>s.name));assert.equal(f.capture(),true);
    assert.equal(fs.existsSync(managedBindingFile(f.env)),true);assert.equal(fs.existsSync(managedExpectationFile(initial)),true);
    const after=fs.readFileSync(history);assert.deepEqual(after.subarray(0,before.length),before);
    assert.equal(after.subarray(before.length).toString().trim().split('\n').filter(Boolean).length,receipt?0:1);
    f.capture(false);assert.equal(f.advance(last!).disposition,'replayed');assert.equal(f.capture(),false);
    assert.throws(()=>f.control('resume'),{code:'managed-step-conflict'});
    assert.throws(()=>f.advance({...last!,expectedSequence:f.journal().migration.sequence}),{code:'managed-step-conflict'});
    assert.equal(f.journal().migration.format,2);assert.equal(f.journal().migration.phase,'complete');
  }finally{f.cleanup();}
});

test('controls are sequenced, effect-free and exactly replayable; stale/reordered requests refuse',()=>{
  const f=fixture();try{
    for(const stage of ['expectation','remove-discovery']){
      f.until(stage);const prior=f.journal(),capture=f.capture(),bytes=fs.readFileSync(prior.database);
      const paused=f.control('pause');assert.equal(paused.progress.state,'paused');assert.equal(paused.progress.sequence,prior.migration.sequence+1);
      assert.equal(f.capture(),capture);assert.deepEqual(fs.readFileSync(prior.database),bytes);
      assert.throws(()=>f.advance(),{code:'managed-step-conflict'});assert.throws(()=>f.control('pause'),{code:'managed-step-conflict'});
      const abandoned=f.control('abandon');assert.equal(abandoned.progress.state,'abandoned');
      assert.throws(()=>f.control('abandon'),{code:'managed-step-conflict'});assert.throws(()=>f.control('pause'),{code:'managed-step-conflict'});
      const resumed=f.control('resume');assert.equal(resumed.progress.state,'pending');assert.deepEqual(resumed.progress.step,prior.migration.step);
      assert.equal(f.capture(),capture);assert.deepEqual(fs.readFileSync(prior.database),bytes);
    }
    const request=f.request(),bytes=fs.readFileSync(migrationFile(f.env));
    for(const changed of [{...request,expectedSequence:request.expectedSequence-1},{...request,expectedSequence:request.expectedSequence+1},
      {...request,step:{name:'enable' as const,batch:0}},{...request,operationId:'22222222-2222-4222-8222-222222222222'}])assert.throws(()=>f.advance(changed));
    assert.deepEqual(fs.readFileSync(migrationFile(f.env)),bytes);
    const prior=f.journal(),control={version:1 as const,action:'pause' as const,operationId:request.operationId,expectedSequence:request.expectedSequence};
    f.control('pause');const budget=new PlatformRequestBudget();
    const replay=withPlatformRequestBudget(budget,()=>controlManagedStep(f.env,payload,control,budget,f.journal()));
    assert.equal(replay.disposition,'replayed');assert.equal(replay.progress.sequence,prior.migration.sequence+1);
  }finally{f.cleanup();}
});

for(const step of ['disable','enable'] as const)for(const after of [false,true])test(`${step} interruption ${after?'after':'before'} capture requires evidence or single-use re-consent`,t=>{
  const f=fixture();try{
    f.until(step);const request=f.request(),set=Store.prototype.setEnabled;let effects=0;
    const mock=t.mock.method(Store.prototype,'setEnabled',function(this:Store,enabled:boolean){if(after){set.call(this,enabled);effects++;}throw new Error('synthetic interruption');});
    let failed:ReturnType<typeof f.advance>;
    try{failed=f.advance();}finally{mock.mock.restore();}
    assert.equal(failed.disposition,'refused');assert.equal(f.journal().migration.state,'failed');
    assert.equal(f.advance(request).disposition,'replayed','failed settlement is replayed without executing the effect');
    if(after){
      f.control('resume');assert.equal(f.advance().disposition,'applied');assert.equal(effects,1);
    }else{
      const intent=structuredClone(f.journal().migration.intent),consent=structuredClone(f.journal().migration.consent);
      assert.throws(()=>f.control('resume'),{code:'managed-step-unsettled'});
      const session=f.review();
      assert.throws(()=>f.control('resume',{confirmed:true,step,expected:'f'.repeat(64)},session),{code:'managed-review-stale'});
      const reviewedRequest={version:1 as const,action:'resume' as const,operationId:request.operationId,expectedSequence:f.journal().migration.sequence,
        review:{confirmed:true as const,step,expected:session.review!.expected}};
      f.control('resume',reviewedRequest.review,session);
      assert.deepEqual(f.journal().migration.intent,intent);assert.deepEqual(f.journal().migration.consent,consent);assert.equal(f.journal().migration.captureRenewals.length,1);
      const budget=new PlatformRequestBudget();
      assert.equal(withPlatformRequestBudget(budget,()=>controlManagedStep(f.env,payload,reviewedRequest,budget,f.journal())).disposition,'replayed','lost reviewed-resume reply needs no live token');
      f.control('pause');f.control('resume'); // Controls retain but cannot multiply this permission.
      const renewed=f.request();assert.equal(f.advance().disposition,'applied');assert.equal(f.journal().migration.captureRenewals.length,1);
      f.capture(step!=='enable');assert.equal(f.advance(renewed).disposition,'replayed');assert.equal(f.capture(),step!=='enable');
    }
  }finally{f.cleanup();}
});

for(const boundary of ['intent','completion'] as const)for(const after of [false,true])test(`every step survives ${boundary} journal interruption ${after?'after':'before'} publication`,t=>{
  const f=fixture();try{
    while(f.journal().migration.state!=='complete'){
      const request=f.request(),journalFile=migrationFile(f.env),rename=fs.renameSync;let tripped=false;
      const mock=t.mock.method(fs,'renameSync',((from:any,to:any)=>{
        if(String(to)===journalFile&&!tripped){
          const next=JSON.parse(fs.readFileSync(from,'utf8'));
          if(boundary==='intent'?next.migration.state==='running':next.migration.lastCompleted?.name===request.step.name&&next.migration.lastCompleted.batch===request.step.batch){
            tripped=true;if(after)rename(from,to);throw new Error('synthetic interruption');
          }
        }
        return rename(from,to);
      }) as typeof fs.renameSync);syncBuiltinESMExports();
      try{assert.equal(f.advance(request).disposition,'refused');}finally{mock.mock.restore();syncBuiltinESMExports();}
      assert.equal(tripped,true);
      const current=f.journal();
      if(current.migration.lastCompleted?.name===request.step.name&&current.migration.lastCompleted.batch===request.step.batch){
        assert.equal(f.advance(request).disposition,'replayed');continue;
      }
      if(current.migration.intent){
        const captureStep=['enable','disable'].includes(request.step.name),ambiguous=captureStep&&f.capture()!==(request.step.name==='enable');
        if(ambiguous){const review=f.review();f.control('resume',{confirmed:true,step:request.step.name as 'enable'|'disable',expected:review.review!.expected},review);}
        else f.control('resume');
      }
      const recovered=f.advance();assert.equal(recovered.disposition,'applied',JSON.stringify(recovered.error));
    }
    assert.equal(f.capture(),true);
    const events=fs.readFileSync(path.join(f.targets.storeRoot,'installation-history.jsonl'),'utf8').trim().split('\n').map(line=>JSON.parse(line));
    assert.equal(events.filter(e=>e.operationId===f.journal().migration.operationId).length,1);
  }finally{f.cleanup();}
});

test('fresh target changes refuse before effect admission and complete removal requires retained history',()=>{
  for(const damage of ['payload','expectation','history','selector','legacy'] as const){
    const f=fixture();try{
      if(damage==='history'||damage==='selector')f.until('enable');else f.until('disable');
      const journal=f.journal(),bytes=fs.readFileSync(migrationFile(f.env));
      if(damage==='expectation')fs.appendFileSync(managedExpectationFile(journal),'invalid');
      if(damage==='selector')fs.appendFileSync(managedBindingFile(f.env),'invalid');
      if(damage==='legacy')fs.appendFileSync(path.join(f.targets.configRoot,'plugins/agent-progress/index.js'),'changed');
      if(damage==='history'){
        const file=path.join(f.targets.storeRoot,'installation-history.jsonl');
        fs.writeFileSync(file,fs.readFileSync(file,'utf8').split('\n').filter(line=>!line.includes(journal.migration.operationId)).join('\n'));
      }
      const budget=new PlatformRequestBudget();
      assert.throws(()=>withPlatformRequestBudget(budget,()=>advanceManagedStep(f.env,damage==='payload'?{...payload,plugin:'changed'}:payload,f.request(),budget,journal)));
      assert.deepEqual(fs.readFileSync(migrationFile(f.env)),bytes);
    }finally{f.cleanup();}
  }
});

test('a second ambiguous capture interruption cannot reuse a consumed renewal',t=>{
  const f=fixture();try{
    f.until('enable');
    const interrupt=()=>{
      const mock=t.mock.method(Store.prototype,'setEnabled',()=>{throw new Error('synthetic interruption');});
      try{assert.equal(f.advance().disposition,'refused');}finally{mock.mock.restore();}
    };
    interrupt();const firstIntent=structuredClone(f.journal().migration.intent);
    const review=f.review();f.control('resume',{confirmed:true,step:'enable',expected:review.review!.expected},review);
    const old=f.request();interrupt();
    const consumed=f.journal();assert.ok(consumed.migration.intent!.captureReviewSequence);
    assert.deepEqual(consumed.migration.captureRenewals[0]!.priorIntent,firstIntent);
    const bytes=fs.readFileSync(migrationFile(f.env));
    assert.throws(()=>f.control('resume'),{code:'managed-step-unsettled'});
    assert.throws(()=>f.control('resume',{confirmed:true,step:'enable',expected:review.review!.expected},review),{code:'managed-review-stale'});
    assert.deepEqual(fs.readFileSync(migrationFile(f.env)),bytes);
    const fresh=f.review();f.control('resume',{confirmed:true,step:'enable',expected:fresh.review!.expected},fresh);
    assert.equal(f.journal().migration.captureRenewals.length,2);
    assert.throws(()=>f.advance(old),{code:'managed-step-conflict'},'old advance cannot consume fresh consent');
    assert.equal(f.advance().disposition,'applied');assert.equal(f.capture(),true);
    assert.equal(f.journal().migration.captureRenewals.length,2);
  }finally{f.cleanup();}
});

for(const action of ['pause','abandon','resume'] as const)test(`fenced running intent supports ${action} without capture or removal`,t=>{
  const f=fixture();try{
    // Leave a durable running expectation intent, simulating process loss after
    // publication. Exhaust accounting so this request cannot settle a failure.
    const prior=f.journal(),budget=new PlatformRequestBudget(),rename=fs.renameSync,file=migrationFile(f.env);
    const mock=t.mock.method(fs,'renameSync',((from:any,to:any)=>{
      rename(from,to);if(String(to)===file){Atomics.store(budget.counter,0,6);throw new Error('synthetic interruption');}
    }) as typeof fs.renameSync);syncBuiltinESMExports();
    try{assert.equal(withPlatformRequestBudget(budget,()=>advanceManagedStep(f.env,payload,f.request(),budget,prior)).disposition,'refused');}
    finally{mock.mock.restore();syncBuiltinESMExports();}
    const running=f.journal();assert.equal(running.migration.state,'running');
    const database=fs.readFileSync(running.database),history=fs.readFileSync(path.join(f.targets.storeRoot,'installation-history.jsonl'));
    const reply=f.control(action),next=f.journal();
    assert.equal(reply.disposition,'applied');assert.equal(next.migration.state,action==='resume'?'pending':action==='pause'?'paused':'abandoned');
    assert.equal(next.migration.sequence,running.migration.sequence+1);assert.deepEqual(next.migration.intent,running.migration.intent);
    assert.equal(reply.progress.worker,'unsettled');assert.equal(reply.progress.effect,'uncertain');
    assert.deepEqual(fs.readFileSync(running.database),database);assert.deepEqual(fs.readFileSync(path.join(f.targets.storeRoot,'installation-history.jsonl')),history);
    assert.equal(fs.existsSync(managedExpectationFile(running)),false);
  }finally{f.cleanup();}
});

for(const exhausted of ['spawns','time'] as const)test(`advance reserves ${exhausted} before intent and any effect`,()=>{
  const f=fixture();try{
    const budget=new PlatformRequestBudget(process.hrtime.bigint()-(exhausted==='time'?7_000_000_000n:0n)),before=fs.readFileSync(migrationFile(f.env));
    if(exhausted==='spawns')Atomics.store(budget.counter,0,3);
    const reply=withPlatformRequestBudget(budget,()=>advanceManagedStep(f.env,payload,f.request(),budget,f.journal()));
    assert.equal(reply.disposition,'refused');assert.equal(reply.error!.code,exhausted==='spawns'?'managed-step-budget':'managed-step-deadline');
    assert.deepEqual(fs.readFileSync(migrationFile(f.env)),before);assert.equal(fs.existsSync(managedExpectationFile(f.journal())),false);
  }finally{f.cleanup();}
});

test('every integrated effect and control fits six launches with fresh supervisor claims',{skip:process.platform==='win32'},async t=>{
  const f=fixture(),originalSystemRoot=process.env.SystemRoot;
  try{
    const source=path.join(f.root,'source');for(const dir of ['shared','setup'])fs.cpSync(path.resolve(dir),path.join(source,dir),{recursive:true});
    const file=path.join(source,'shared/platform.ts');let text=fs.readFileSync(file,'utf8');
    text=text.replace("export const windows = process.platform === 'win32';",'export const windows = true;');
    const start=text.indexOf("  if (value.includes('\\0')",text.indexOf('function windowsPathsInner(')),end=text.indexOf('  let current = clean;',start);
    assert.ok(start>0&&end>start);text=text.slice(0,start)+"  if (!path.isAbsolute(value) || path.resolve(value) !== value) throw new PlatformError('path-unverified');\n  const clean = value;\n"+text.slice(end);fs.writeFileSync(file,text);
    let spawns=0;
    const mock=t.mock.method(cp,'spawnSync',((_command:string,_args:string[],options:cp.SpawnSyncOptionsWithStringEncoding):cp.SpawnSyncReturns<string>=>{
      spawns++;const input=JSON.parse(String(options.input));assert.deepEqual(input.create,[]);
      return {pid:1,output:[],stdout:JSON.stringify(input.paths.map(()=>({owned:true,private:true,reparse:false,unsafeParent:false}))),stderr:'',status:0,signal:null};
    }) as unknown as typeof cp.spawnSync);syncBuiltinESMExports();process.env.SystemRoot='C:\\Windows';
    try{
      const platform=await import(pathToFileURL(file).href) as typeof import('../../shared/platform.ts');
      const engine=await import(pathToFileURL(path.join(source,'setup/managed-step-engine.ts')).href) as typeof import('../../setup/managed-step-engine.ts');
      const counts:Array<{step:string;spawns:number}>=[];
      for(const action of ['pause','abandon','resume'] as const){
        const prior=f.journal(),budget=new platform.PlatformRequestBudget();spawns=0;
        const request={version:1 as const,action,operationId:prior.migration.operationId,expectedSequence:prior.migration.sequence};
        const reply=platform.withPlatformRequestBudget(budget,()=>engine.controlManagedStep(f.env,payload,request,budget,prior));
        assert.equal(reply.disposition,'applied');assert.equal(spawns,budget.securitySpawns);assert.ok(spawns<=6);
        counts.push({step:action,spawns});
      }
      while(f.journal().migration.state!=='complete'){
        const prior=f.journal(),request=f.request(),budget=new platform.PlatformRequestBudget();spawns=0;
        const reply=platform.withPlatformRequestBudget(budget,()=>engine.advanceManagedStep(f.env,payload,request,budget,prior));
        assert.equal(reply.disposition,'applied',`${request.step.name}: ${JSON.stringify(reply.error)}`);assert.equal(spawns,budget.securitySpawns);assert.ok(spawns<=6);
        counts.push({step:`${request.step.name}:${request.step.batch}`,spawns});
        spawns=0;const replayBudget=new platform.PlatformRequestBudget();
        assert.equal(platform.withPlatformRequestBudget(replayBudget,()=>engine.advanceManagedStep(f.env,payload,request,replayBudget,reply.journal)).disposition,'replayed');
        assert.ok(spawns<=6);
      }
      t.diagnostic(JSON.stringify({effects:counts}));
    }finally{mock.mock.restore();syncBuiltinESMExports();}
  }finally{if(originalSystemRoot===undefined)delete process.env.SystemRoot;else process.env.SystemRoot=originalSystemRoot;f.cleanup();}
});
