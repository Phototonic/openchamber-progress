import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {syncBuiltinESMExports} from 'node:module';
import cp from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {lifecycle,migrationEvidence,validateMigrationRemoval,removeMigrationFile} from '../../setup/lifecycle.ts';
import {Store,canonical,digest} from '../../shared/store.ts';
import {platformSecurityScope} from '../../shared/platform.ts';
import {parseManagedStepJournal,managedTargetDigest,type ManagedStepJournal} from '../../setup/managed-step-journal.ts';
import {isolatedEnvironment} from '../fixtures/managed.ts';
import {createManagedBindingDirectory,publishPrivateJson} from '../../shared/managed-binding.ts';
import {migrationFile} from '../../setup/managed-migration.ts';

function fixture(){
  const root=fs.mkdtempSync('/tmp/opencode/step-removal-'),env=isolatedEnvironment(root);
  const targets={configRoot:path.join(env.XDG_CONFIG_HOME!,'opencode'),dataRoot:path.join(env.XDG_DATA_HOME!,'opencode'),storeRoot:path.join(root,'store'),confirmed:true};
  for(const dir of [targets.configRoot,targets.dataRoot])fs.mkdirSync(dir,{mode:0o700});
  lifecycle('install',targets,{plugin:'// synthetic plugin',guidance:'synthetic guidance',removal:'// synthetic remover',version:'1.1.1'});
  const evidence=migrationEvidence(targets),binding={...evidence.binding,installId:'managed-synthetic',version:'1.3.0'};
  const journal:ManagedStepJournal={...binding,migration:{format:2,product:'openchamber-agent-progress-managed',phase:'pending',legacyInstallId:evidence.binding.installId,
    operationId:'11111111-1111-4111-8111-111111111111',sequence:3,state:'pending',step:evidence.plan[3]!,lastCompleted:evidence.plan[2]!,
    consent:{reviewDigest:'1'.repeat(64),targetDigest:'2'.repeat(64),planDigest:digest(canonical(evidence.plan))},expectation:{version:'1.3.0',fingerprint:'3'.repeat(64)},
    plan:evidence.plan,legacy:evidence.legacy,captureRenewals:[],intent:null,
    receipt:{requestDigest:'5'.repeat(64),expectedSequence:2,sequence:3,step:{name:'disable',batch:0},outcome:'applied'},
    capture:{state:'off',observedAt:'2026-01-01T00:00:00.000Z'},diagnostic:null}};
  journal.migration.consent.targetDigest=managedTargetDigest(journal);
  const store=new Store(binding.database);store.setEnabled(false);
  const legacyRoot=path.join(targets.configRoot,'plugins','agent-progress'),history=path.join(targets.storeRoot,'installation-history.jsonl');
  return {root,env,targets,journal,legacyRoot,history,store,cleanup(){store.close();fs.rmSync(root,{recursive:true,force:true});}};
}
function authorize(journal:ManagedStepJournal){
  const layout=validateMigrationRemoval(journal),file=layout.file(journal.migration.step)!;
  const m=journal.migration;m.state='running';m.capture=layout.capture;
  m.intent={requestDigest:'4'.repeat(64),expectedSequence:m.sequence,step:m.step!,effect:'intent',before:[layout.claims.get(file)!],
    after:[{path:file,kind:'absent',object:null,digest:null}],captureBefore:layout.capture,captureReviewSequence:null};
  return file;
}
function complete(journal:ManagedStepJournal){
  const m=journal.migration,index=m.plan.findIndex(s=>canonical(s)===canonical(m.step));
  m.receipt={requestDigest:m.intent!.requestDigest,expectedSequence:m.sequence,sequence:++m.sequence,step:m.step,outcome:'applied'};
  m.lastCompleted=m.step;m.step=m.plan[index+1]!;m.intent=null;m.state='pending';
  parseManagedStepJournal(JSON.stringify(journal));
}

test('lifecycle owner removes one frozen file at a time, keeps manifest last, retains payloads/history',()=>{
  const f=fixture();try{
    const original=fs.readFileSync(f.history),released=f.journal.migration.legacy.claims.filter(c=>c.kind==='file'&&c.path.includes(`${path.sep}payloads${path.sep}`));
    const removed:string[]=[];
    while(f.journal.migration.step!.name==='remove-discovery'){
      const file=authorize(f.journal),before=fs.readdirSync(f.legacyRoot);
      assert.deepEqual(removeMigrationFile(f.journal).removed,true);
      assert.equal(fs.readdirSync(f.legacyRoot).length,before.length-1);removed.push(path.basename(file));
      assert.equal(f.store.list().captureEnabled,false);assert.deepEqual(fs.readFileSync(f.history),original);
      for(const c of released)assert.equal(digest(fs.readFileSync(c.path)),c.digest);
      complete(f.journal);
    }
    assert.equal(removed.length,6);assert.equal(removed.at(-1),'.ownership.json');
    assert.equal(f.journal.migration.step!.name,'record-removal');assert.deepEqual(fs.readdirSync(f.legacyRoot),[]);
    validateMigrationRemoval(f.journal);
  }finally{f.cleanup();}
});

for(const afterEffect of [false,true])test(`each discovery file reconciles interruption ${afterEffect?'after':'before'} unlink without a second effect`,t=>{
  const f=fixture();try{
    for(let batch=0;batch<6;batch++){
      const file=authorize(f.journal),prior=structuredClone(f.journal),unlink=fs.unlinkSync;let effects=0;
      const mock=t.mock.method(fs,'unlinkSync',((p:any)=>{
        if(String(p)===file){if(afterEffect){unlink(p);effects++;}throw new Error('synthetic interruption');}
        return unlink(p);
      }) as typeof fs.unlinkSync);syncBuiltinESMExports();
      try{assert.throws(()=>removeMigrationFile(f.journal),/synthetic interruption/);}
      finally{mock.mock.restore();syncBuiltinESMExports();}
      assert.deepEqual(f.journal,prior,'effect owner never claims a journal checkpoint');
      const result=removeMigrationFile(f.journal);if(result.removed)effects++;
      assert.equal(effects,1);assert.equal(fs.existsSync(file),false);
      assert.equal(removeMigrationFile(f.journal).removed,false,'same intent replay observes absence, never unlinks twice');
      complete(f.journal);
    }
  }finally{f.cleanup();}
});

test('missing files without the current intent or completed same-operation evidence refuse',()=>{
  const f=fixture();try{
    const file=validateMigrationRemoval(f.journal).file(f.journal.migration.step)!;fs.unlinkSync(file);
    assert.throws(()=>validateMigrationRemoval(f.journal),{code:'modified-owned-files'});
    assert.throws(()=>removeMigrationFile(f.journal),{code:'managed-step-conflict'});
  }finally{f.cleanup();}
});

test('removal requires durable exact intent, fresh off capture and no enclosing security scope',()=>{
  const f=fixture();try{
    assert.throws(()=>removeMigrationFile(f.journal),{code:'managed-step-conflict'});
    const file=authorize(f.journal);f.store.setEnabled(true);
    assert.throws(()=>removeMigrationFile(f.journal),{code:'managed-step-conflict'});assert.equal(fs.existsSync(file),true);
    f.store.setEnabled(false);
    assert.throws(()=>platformSecurityScope(()=>removeMigrationFile(f.journal)),{code:'managed-step-conflict'});
    const before=f.journal.migration.intent!.before;f.journal.migration.intent!.before=[];
    assert.throws(()=>removeMigrationFile(f.journal),{code:'managed-step-conflict'});f.journal.migration.intent!.before=before;
    f.journal.migration.intent!.after[0]!.path=path.join(f.legacyRoot,'other');
    assert.throws(()=>removeMigrationFile(f.journal),{code:'managed-step-conflict'});assert.equal(fs.existsSync(file),true);
  }finally{f.cleanup();}
});

for(const damage of ['bytes','object','link','foreign-discovery','foreign-release','manifest','store-source','plan'] as const){
  test(`fresh remaining-set validation refuses changed ${damage} before deletion`,()=>{
    const f=fixture();try{
      const file=authorize(f.journal),bytes=fs.readFileSync(file);
      if(damage==='bytes')fs.appendFileSync(file,'changed');
      if(damage==='object'){fs.renameSync(file,`${file}.old`);fs.writeFileSync(file,bytes,{mode:0o600});fs.unlinkSync(`${file}.old`);}
      if(damage==='link')fs.linkSync(file,path.join(f.root,'alias'));
      if(damage==='foreign-discovery')fs.writeFileSync(path.join(f.legacyRoot,'foreign'),'foreign',{mode:0o600});
      if(damage==='foreign-release'){
        const payload=f.journal.migration.legacy.claims.find(c=>c.kind==='file'&&c.path.includes(`${path.sep}payloads${path.sep}`))!;
        fs.writeFileSync(path.join(path.dirname(payload.path),'foreign'),'foreign',{mode:0o600});
      }
      if(damage==='manifest')fs.appendFileSync(path.join(f.legacyRoot,'.ownership.json'),' ');
      if(damage==='store-source')f.journal.source.id='other-source';
      if(damage==='plan')f.journal.migration.plan[3]!.batch=1;
      assert.throws(()=>removeMigrationFile(f.journal));assert.equal(fs.existsSync(file),true,'refusal precedes unlink');
      assert.equal(f.store.list().captureEnabled,false);
    }finally{f.cleanup();}
  });
}

test('completed removal evidence never authorizes deleting a replacement at an earlier path',()=>{
  const f=fixture();try{
    const first=authorize(f.journal),bytes=fs.readFileSync(first);removeMigrationFile(f.journal);complete(f.journal);
    fs.writeFileSync(first,bytes,{mode:0o600});
    assert.throws(()=>validateMigrationRemoval(f.journal),{code:'installation-changed'});
    assert.equal(fs.existsSync(first),true);
  }finally{f.cleanup();}
});

test('each one-file request fits six actual launches including both durable journal publications', {skip:process.platform==='win32'},async t=>{
  const f=fixture(),originalSystemRoot=process.env.SystemRoot;
  try{
    // Source projection preserves the actual query/cache/publication owners.
    // Only OS path dialect and the real process boundary are substituted. This
    // establishes portable accounting, not native Windows ACL/timing evidence.
    const source=path.join(f.root,'source');
    for(const dir of ['shared','setup'])fs.cpSync(path.resolve(dir),path.join(source,dir),{recursive:true});
    const platformFile=path.join(source,'shared/platform.ts');let text=fs.readFileSync(platformFile,'utf8');
    text=text.replace("export const windows = process.platform === 'win32';",'export const windows = true;');
    const start=text.indexOf("  if (value.includes('\\0')",text.indexOf('function windowsPathsInner(')),end=text.indexOf('  let current = clean;',start);
    assert.ok(start>0&&end>start);
    text=text.slice(0,start)+"  if (!path.isAbsolute(value) || path.resolve(value) !== value) throw new PlatformError('path-unverified');\n  const clean = value;\n"+text.slice(end);
    fs.writeFileSync(platformFile,text);
    createManagedBindingDirectory(f.env);publishPrivateJson(migrationFile(f.env),f.journal);
    let spawns=0;
    t.mock.method(cp,'spawnSync',((_command:string,_args:string[],options:cp.SpawnSyncOptionsWithStringEncoding):cp.SpawnSyncReturns<string>=>{
      spawns++;const input=JSON.parse(String(options.input));
      assert.deepEqual(input.create,[],'removal never creates a directory');
      return {pid:1,output:[],stdout:JSON.stringify(input.paths.map(()=>({owned:true,private:true,reparse:false,unsafeParent:false}))),stderr:'',status:0,signal:null};
    }) as unknown as typeof cp.spawnSync);syncBuiltinESMExports();process.env.SystemRoot='C:\\Windows';
    const platform=await import(pathToFileURL(platformFile).href) as typeof import('../../shared/platform.ts');
    const owner=await import(pathToFileURL(path.join(source,'setup/lifecycle.ts')).href) as typeof import('../../setup/lifecycle.ts');
    const migration=await import(pathToFileURL(path.join(source,'setup/managed-migration.ts')).href) as typeof import('../../setup/managed-migration.ts');
    const counts:number[]=[];
    for(let batch=0;batch<6;batch++){
      const budget=new platform.PlatformRequestBudget(),before=spawns;
      platform.withPlatformRequestBudget(budget,()=>{
        const prior=platform.platformSecurityScope(()=>{
          platform.windowsPaths(migration.managedJournalPaths(f.journal),true);
          const current=migration.readManagedStepJournal(f.env)!;owner.validateMigrationRemoval(current);return current;
        });
        const intent=structuredClone(prior),layoutFile=path.join(f.legacyRoot,[...Object.keys(JSON.parse(prior.migration.legacy.ownership!).files).sort(),'.ownership.json'][batch]!);
        intent.migration.state='running';intent.migration.intent={requestDigest:'4'.repeat(64),expectedSequence:prior.migration.sequence,step:prior.migration.step!,effect:'intent',
          before:[prior.migration.legacy.claims.find(c=>c.path===layoutFile)!],after:[{path:layoutFile,kind:'absent',object:null,digest:null}],captureBefore:prior.migration.capture,captureReviewSequence:null};
        migration.writeManagedStepJournal(f.env,intent,prior,()=>{owner.validateMigrationRemoval(prior);});
        assert.equal(owner.removeMigrationFile(intent).removed,true);
        const next=structuredClone(intent);complete(next);next.migration.capture={state:'unknown',observedAt:null};
        migration.writeManagedStepJournal(f.env,next,intent,()=>{owner.validateMigrationRemoval(intent);});
        f.journal=next;
      });
      counts.push(spawns-before);assert.equal(budget.securitySpawns,spawns-before);
      assert.ok(spawns-before<=6,`discovery batch ${batch} exceeded six real security launches`);
    }
    t.diagnostic(JSON.stringify({removeDiscoverySecuritySpawns:counts}));
  }finally{
    t.mock.restoreAll();syncBuiltinESMExports();
    if(originalSystemRoot===undefined)delete process.env.SystemRoot;else process.env.SystemRoot=originalSystemRoot;
    f.cleanup();
  }
});
