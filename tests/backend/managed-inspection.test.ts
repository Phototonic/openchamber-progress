import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {pathToFileURL} from 'node:url';
import {isolatedEnvironment} from '../fixtures/managed.ts';
import {lifecycle,migrationEvidence} from '../../setup/lifecycle.ts';
import {createManagedBindingDirectory,publishPrivateJson} from '../../shared/managed-binding.ts';
import {writeMigration,migrationFile} from '../../setup/managed-migration.ts';
import {parseManagedStepJournal} from '../../setup/managed-step-journal.ts';
import {inspectManagedStep,validateManagedInspectionReview,type ManagedInspectionSession} from '../../setup/managed-inspection.ts';
import {Store} from '../../shared/store.ts';

const payload={plugin:'// synthetic managed',guidance:'synthetic guidance',removal:'// synthetic removal',version:'1.3.0'};
function fixture(kind:'manifest'|'upgrade'|'receipt'='manifest'){
  const root=fs.mkdtempSync('/tmp/opencode/step-inspection-'),env=isolatedEnvironment(root);
  const targets={configRoot:path.join(env.XDG_CONFIG_HOME!,'opencode'),dataRoot:path.join(env.XDG_DATA_HOME!,'opencode'),storeRoot:path.join(root,'store'),confirmed:true};
  for(const file of [targets.configRoot,targets.dataRoot])fs.mkdirSync(file,{mode:0o700});
  lifecycle('install',targets,{...payload,version:'1.1.1'});
  const evidence=migrationEvidence(targets);
  if(kind!=='manifest'){
    createManagedBindingDirectory(env);
    writeMigration(env,{binding:{...evidence.binding,installId:'managed-synthetic'},legacyInstallId:evidence.binding.installId,phase:'pending'});
    if(kind==='receipt')lifecycle('remove-capture',targets);
  }
  return {root,env,targets,evidence,cleanup(){fs.rmSync(root,{recursive:true,force:true});}};
}
function files(root:string):Record<string,string>{
  const result:Record<string,string>={};
  const visit=(file:string)=>{const s=fs.lstatSync(file);if(s.isDirectory())for(const name of fs.readdirSync(file))visit(path.join(file,name));else result[path.relative(root,file)]=fs.readFileSync(file).toString('hex');};
  visit(root);return result;
}
function inspectAll(f:ReturnType<typeof fixture>,inspect=inspectManagedStep){
  let session:ManagedInspectionSession|undefined;
  for(const stage of ['roots','managed-state','legacy-discovery','legacy-releases','store','review']){
    const result=inspect(f.env,payload,session);session=result.session;
    assert.equal(result.inspection.stage,stage);
    assert.equal(result.inspection.state,stage==='review'?'complete':'incomplete');
  }
  return session!;
}
for(const kind of ['manifest','upgrade','receipt'] as const)test(`bounded ${kind} inspection is read-only and binds a freshly revalidated review`,()=>{
  const f=fixture(kind);try{
    const before=files(f.root),session=inspectAll(f);
    assert.deepEqual(files(f.root),before,'inspection must not create metadata, change capture or initialize a database');
    const checked=validateManagedInspectionReview(f.env,payload,session);
    assert.equal(checked.review.expected,session.review!.expected);
    assert.equal(checked.candidate.migration.legacy.kind,kind==='receipt'?'removal-receipt':'manifest');
    assert.deepEqual(files(f.root),before);
    assert.throws(()=>inspectManagedStep(f.env,payload,session),{code:'managed-inspection-expired'});
    assert.throws(()=>validateManagedInspectionReview(f.env,{...payload,plugin:'// changed package'},session),{code:'managed-review-stale'});
    const store=new Store(f.evidence.binding.database);try{store.setEnabled(checked.capture.state!=='on');}finally{store.close();}
    assert.throws(()=>validateManagedInspectionReview(f.env,payload,session),{code:'managed-review-stale'});
  }finally{f.cleanup();}
});

for(const damage of ['manifest','payload','selector','foreign','alias','permissions','identity','source','lock','receipt'] as const)test(`inspection refuses changed ${damage} before confirmation`,()=>{
  const f=fixture(damage==='receipt'?'receipt':'upgrade');try{
    let session:ManagedInspectionSession|undefined;
    for(let i=0;i<3;i++)session=inspectManagedStep(f.env,payload,session).session;
    const legacy=path.join(f.targets.configRoot,'plugins','agent-progress');
    if(damage==='manifest'){
      const file=path.join(legacy,'.ownership.json'),m=JSON.parse(fs.readFileSync(file,'utf8'));m.releases['f'.repeat(64)]=m.releases[m.active];fs.writeFileSync(file,JSON.stringify(m));
    }
    if(damage==='payload')fs.appendFileSync(path.join(f.targets.storeRoot,'payloads',JSON.parse(f.evidence.legacy.ownership).active,'index.js'),'changed');
    if(damage==='selector')fs.appendFileSync(path.join(legacy,'index.js'),'changed');
    if(damage==='foreign')fs.writeFileSync(path.join(legacy,'foreign'),'foreign',{mode:0o600});
    if(damage==='alias')fs.linkSync(path.join(legacy,'index.js'),path.join(f.root,'alias'));
    if(damage==='permissions')fs.chmodSync(path.join(legacy,'index.js'),0o644);
    if(damage==='identity'){
      // Swap after discovery does not grant ownership; full review then binds
      // the freshly observed object, and mutation admission rejects another swap.
      session=inspectManagedStep(f.env,payload,session).session;
      const file=path.join(legacy,'index.js');fs.renameSync(file,`${file}.retained`);fs.copyFileSync(`${file}.retained`,file);fs.unlinkSync(`${file}.retained`);
    }
    if(damage==='source'){
      const store=new Store(f.evidence.binding.database);try{store.db.prepare('UPDATE sources SET verified=0').run();}finally{store.close();}
    }
    if(damage==='lock')fs.writeFileSync(path.join(f.targets.dataRoot,'agent-progress-managed','.configuration-lock'),'retained',{mode:0o600});
    if(damage==='receipt')fs.writeFileSync(path.join(f.targets.storeRoot,'installation-history.jsonl'),'{}\n');
    const before=files(f.root);
    assert.throws(()=>{while(session!.stage<6)session=inspectManagedStep(f.env,payload,session).session;});
    assert.deepEqual(files(f.root),before);
  }finally{f.cleanup();}
});

test('changed roots and a different requested Store cannot continue discovery',()=>{
  const f=fixture();try{
    const session=inspectManagedStep(f.env,payload).session;
    assert.throws(()=>inspectManagedStep({...f.env,XDG_DATA_HOME:path.join(f.root,'other')},payload,session));
    let other=inspectManagedStep(f.env,payload,undefined,path.join(f.root,'different-store')).session;
    other=inspectManagedStep(f.env,payload,other).session;
    assert.throws(()=>inspectManagedStep(f.env,payload,other),{code:'managed-selection-conflict'});
  }finally{f.cleanup();}
});

for(const decision of ['disable','enable'] as const)test(`uncertain ${decision} inspection binds the operation, sequence, full intent and capture decision`,()=>{
  const f=fixture();try{
    const candidate=inspectAll(f).candidate!,m=candidate.migration;
    if(decision==='enable')lifecycle('remove-capture',f.targets);
    const index=m.plan.findIndex(s=>s.name===decision);
    m.state='running';m.sequence=index;m.step=m.plan[index]!;m.lastCompleted=m.plan[index-1]!;
    m.phase=decision==='enable'?'removed':'pending';m.receipt=null;
    m.intent={requestDigest:'a'.repeat(64),expectedSequence:index,step:m.step,effect:'uncertain',before:[],after:[],
      captureBefore:{state:'unknown',observedAt:null},captureReviewSequence:null};
    createManagedBindingDirectory(f.env);publishPrivateJson(migrationFile(f.env),candidate);
    parseManagedStepJournal(JSON.stringify(candidate));
    const before=files(f.root),session=inspectAll(f),review=validateManagedInspectionReview(f.env,payload,session);
    assert.equal(review.operation!.migration.intent!.step.name,decision);
    assert.equal(review.operation!.migration.sequence,index);
    assert.deepEqual(files(f.root),before);
    for(const change of ['operation','sequence','intent'] as const){
      const fresh=inspectAll(f);
      const altered=structuredClone(candidate);
      if(change==='operation')altered.migration.operationId='11111111-1111-4111-8111-111111111111';
      if(change==='sequence')altered.migration.sequence++;
      if(change==='intent')altered.migration.intent!.requestDigest='b'.repeat(64);
      publishPrivateJson(migrationFile(f.env),altered,true);
      assert.throws(()=>validateManagedInspectionReview(f.env,payload,fresh),{code:'managed-review-stale'});
      assert.notEqual(inspectAll(f).review!.expected,fresh.review!.expected);
      publishPrivateJson(migrationFile(f.env),candidate,true);
      // Atomic replacement intentionally changes the journal object. Obtain a
      // new review for each operation snapshot instead of adopting the old one.
    }
  }finally{f.cleanup();}
});

test('oversized discovered sets and history refuse without a truncated review',()=>{
  for(const kind of ['manifest','receipt'] as const){
    const f=fixture(kind);try{
      if(kind==='manifest'){
        const file=path.join(f.targets.configRoot,'plugins','agent-progress','.ownership.json'),m=JSON.parse(fs.readFileSync(file,'utf8'));
        for(let i=0;i<70;i++)m.releases[i.toString(16).padStart(64,'0')]=m.releases[m.active];
        fs.writeFileSync(file,JSON.stringify(m));
      }else fs.appendFileSync(path.join(f.targets.storeRoot,'installation-history.jsonl'),' '.repeat(1_048_576));
      const before=files(f.root);
      assert.throws(()=>inspectAll(f),{code:'managed-step-limit'});assert.deepEqual(files(f.root),before);
    }finally{f.cleanup();}
  }
});

test('each inspection stage and review revalidation charge at most six security launches',{skip:process.platform==='win32'},async t=>{
  const original=process.env.SystemRoot;
  try{for(const kind of ['manifest','upgrade','receipt'] as const){
    const f=fixture(kind);try{
      const source=path.join(f.root,'source');for(const dir of ['shared','setup'])fs.cpSync(path.resolve(dir),path.join(source,dir),{recursive:true});
      const platformFile=path.join(source,'shared/platform.ts');let text=fs.readFileSync(platformFile,'utf8');
      text=text.replace("export const windows = process.platform === 'win32';",'export const windows = true;');
      const start=text.indexOf("  if (value.includes('\\0')",text.indexOf('function windowsPathsInner(')),end=text.indexOf('  let current = clean;',start);
      assert.ok(start>0&&end>start);text=text.slice(0,start)+"  if (!path.isAbsolute(value) || path.resolve(value) !== value) throw new PlatformError('path-unverified');\n  const clean = value;\n"+text.slice(end);fs.writeFileSync(platformFile,text);
      let spawns=0;
      const mock=t.mock.method(cp,'spawnSync',((_command:string,_args:string[],options:cp.SpawnSyncOptionsWithStringEncoding):cp.SpawnSyncReturns<string>=>{
        spawns++;const input=JSON.parse(String(options.input));assert.deepEqual(input.create,[]);
        return {pid:1,output:[],stdout:JSON.stringify(input.paths.map(()=>({owned:true,private:true,reparse:false,unsafeParent:false}))),stderr:'',status:0,signal:null};
      }) as unknown as typeof cp.spawnSync);syncBuiltinESMExports();process.env.SystemRoot='C:\\Windows';
      try{
        const platform=await import(pathToFileURL(platformFile).href) as typeof import('../../shared/platform.ts');
        const inspection=await import(pathToFileURL(path.join(source,'setup/managed-inspection.ts')).href) as typeof import('../../setup/managed-inspection.ts');
        const counts:number[]=[];
        const session=inspectAll(f,((...args:Parameters<typeof inspectManagedStep>)=>{
          spawns=0;const budget=new platform.PlatformRequestBudget();
          const result=platform.withPlatformRequestBudget(budget,()=>inspection.inspectManagedStep(...args));
          assert.equal(budget.securitySpawns,spawns);assert.ok(spawns<=6);counts.push(spawns);return result;
        }));
        spawns=0;const budget=new platform.PlatformRequestBudget();
        platform.withPlatformRequestBudget(budget,()=>inspection.validateManagedInspectionReview(f.env,payload,session));
        assert.equal(budget.securitySpawns,spawns);assert.ok(spawns<=6);
        t.diagnostic(JSON.stringify({kind,stages:counts,reviewAdmission:spawns}));
      }finally{mock.mock.restore();syncBuiltinESMExports();}
    }finally{f.cleanup();}
  }}finally{if(original===undefined)delete process.env.SystemRoot;else process.env.SystemRoot=original;}
});
