import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {pathToFileURL} from 'node:url';
import {isolatedEnvironment} from '../fixtures/managed.ts';
import {lifecycle,migrationEvidence} from '../../setup/lifecycle.ts';
import {Store,canonical,digest} from '../../shared/store.ts';
import {createManagedBindingDirectory,publishPrivateJson} from '../../shared/managed-binding.ts';
import {migrationFile,readMigration,writeMigration,readRemovalReceipt,readManagedStepJournal,upgradeManagedStepJournal,type MigrationRecord} from '../../setup/managed-migration.ts';
import {managedTargetDigest,managedRequestDigest,type ManagedStepJournal} from '../../setup/managed-step-journal.ts';
import type {ManagedVolumeIdentityReader} from '../../setup/managed-volume-identity.ts';

function fixture(removed:boolean,phase:MigrationRecord['phase']='pending'){
  const root=fs.mkdtempSync('/tmp/opencode/step-upgrade-'),env=isolatedEnvironment(root);
  const targets={configRoot:path.join(env.XDG_CONFIG_HOME!,'opencode'),dataRoot:path.join(env.XDG_DATA_HOME!,'opencode'),storeRoot:path.join(root,'store'),confirmed:true};
  for(const p of [targets.configRoot,targets.dataRoot])fs.mkdirSync(p,{mode:0o700});
  lifecycle('install',targets,{plugin:'// synthetic legacy',guidance:'synthetic guidance',removal:'// synthetic remover',version:'1.1.1'});
  const evidence=migrationEvidence(targets),binding={...evidence.binding,installId:'managed-synthetic',version:'1.3.0'};
  const record:MigrationRecord={binding,phase,legacyInstallId:evidence.binding.installId};
  createManagedBindingDirectory(env);writeMigration(env,record);
  const legacyRoot=path.join(targets.configRoot,'plugins','agent-progress');
  if(removed)lifecycle('remove-capture',targets);
  const receipt=removed?readRemovalReceipt(record)!:undefined;
  const plan=removed?(['prepare','expectation','publish-binding','enable','reconcile'] as const).map(name=>({name,batch:0})):evidence.plan;
  const journal:ManagedStepJournal={...binding,migration:{format:2,product:'openchamber-agent-progress-managed',phase:removed?'removed':'pending',legacyInstallId:record.legacyInstallId,
    operationId:'11111111-1111-4111-8111-111111111111',sequence:1,state:'pending',step:plan[1]!,lastCompleted:plan[0]!,
    consent:{reviewDigest:'1'.repeat(64),targetDigest:'2'.repeat(64),planDigest:digest(canonical(plan))},expectation:{version:'1.3.0',fingerprint:'3'.repeat(64)},
    plan,legacy:receipt?{kind:'removal-receipt',ownership:null,ownershipDigest:null,claims:[{path:legacyRoot,kind:'absent',object:null,digest:null}],receipt}:evidence.legacy,
    captureRenewals:[],intent:null,receipt:{requestDigest:'4'.repeat(64),expectedSequence:0,sequence:1,step:plan[0]!,outcome:'applied'},
    capture:{state:'unknown',observedAt:null},diagnostic:null}};
  journal.migration.consent.targetDigest=managedTargetDigest(journal);
  journal.migration.receipt!.requestDigest=managedRequestDigest({version:1,action:'begin',operationId:journal.migration.operationId,confirmed:true,expected:journal.migration.consent.reviewDigest},journal);
  return {root,env,targets,legacyRoot,record,journal,file:migrationFile(env),history:path.join(targets.storeRoot,'installation-history.jsonl'),
    cleanup(){fs.rmSync(root,{recursive:true,force:true});}};
}

for(const removed of [false,true])for(const phase of ['pending','removed'] as const){
  test(`format-1 ${phase} upgrades from ${removed?'receipt-proven removal':'intact original ownership'} without replaying effects`,()=>{
    const f=fixture(removed,phase);try{
      const history=fs.readFileSync(f.history),database=fs.readFileSync(f.record.binding.database);
      upgradeManagedStepJournal(f.env,f.journal,f.record);
      assert.deepEqual(readManagedStepJournal(f.env),f.journal);
      assert.deepEqual(fs.readFileSync(f.history),history);assert.deepEqual(fs.readFileSync(f.record.binding.database),database);
      assert.equal(fs.existsSync(f.legacyRoot),!removed);
      assert.deepEqual(f.journal.migration.plan.map(s=>s.name),removed?
        ['prepare','expectation','publish-binding','enable','reconcile']:
        ['prepare','expectation','disable',...Array(6).fill('remove-discovery'),'record-removal','publish-binding','enable','reconcile']);
      assert.equal(f.journal.migration.phase,removed?'removed':'pending');
      assert.equal(f.journal.migration.capture.state,'unknown');assert.equal(f.journal.migration.intent,null);
      assert.throws(()=>readMigration(f.env),{code:'managed-migration-conflict'},'old reader must refuse format 2');
      // A retry belongs to the engine's durable begin receipt, not a second upgrade.
      const bytes=fs.readFileSync(f.file);assert.throws(()=>upgradeManagedStepJournal(f.env,f.journal,f.record));
      assert.deepEqual(fs.readFileSync(f.file),bytes);
    }finally{f.cleanup();}
  });
}

test('receipt upgrade preserves later manual capture and later same-file history appends',()=>{
  const f=fixture(true);try{
    fs.appendFileSync(f.history,JSON.stringify({action:'unrelated',installId:'other'})+'\n');
    const store=new Store(f.record.binding.database);try{store.setEnabled(true);}finally{store.close();}
    const history=fs.readFileSync(f.history);upgradeManagedStepJournal(f.env,f.journal,f.record);
    const probe=new Store(f.record.binding.database,{readOnly:true});try{assert.equal(probe.list().captureEnabled,true);}finally{probe.close();}
    assert.deepEqual(fs.readFileSync(f.history),history);assert.equal(readManagedStepJournal(f.env)!.migration.capture.state,'unknown');
  }finally{f.cleanup();}
});

for(const removed of [false,true])test(`format-1 upgrade rechecks ${removed?'retained history':'owned discovery'} proof before replacing the journal`,()=>{
  const f=fixture(removed);
  try{
    const m=f.journal.migration,legacy=m.legacy;
    const claim=legacy.kind==='removal-receipt'?legacy.receipt.history:legacy.claims.find(c=>c.path===path.join(f.legacyRoot,'index.js'))!;
    const mount={path:claim.path,fingerprint:'a'.repeat(64)};
    legacy.volumeIdentity={version:1,paths:[mount]};
    const refreshConsent=()=>{
      m.consent.targetDigest=managedTargetDigest(f.journal);
      m.receipt!.requestDigest=managedRequestDigest({version:1,action:'begin',operationId:m.operationId,confirmed:true,expected:m.consent.reviewDigest},f.journal);
    };
    refreshConsent();
    const file=fs.readFileSync(f.file),history=fs.readFileSync(f.history),db=fs.readFileSync(f.record.binding.database);
    const selector=path.join(path.dirname(f.file),'progress-binding.json'),before=fs.readFileSync(claim.path);
    let fingerprint:string|undefined='b'.repeat(64);
    const read:ManagedVolumeIdentityReader=({path})=>{
      assert.equal(path,mount.path);
      return fingerprint?{kind:'verified',fingerprint}:{kind:'unavailable'};
    };
    const unchanged=()=>{
      assert.deepEqual(fs.readFileSync(f.file),file);
      assert.deepEqual(fs.readFileSync(f.history),history);
      assert.deepEqual(fs.readFileSync(f.record.binding.database),db);
      assert.deepEqual(fs.readFileSync(claim.path),before);
      assert.equal(fs.existsSync(f.legacyRoot),!removed);
      assert.equal(fs.existsSync(selector),false);
    };
    assert.throws(()=>upgradeManagedStepJournal(f.env,f.journal,f.record,undefined,read),{code:'managed-migration-conflict'});
    unchanged();
    fingerprint=undefined;
    assert.throws(()=>upgradeManagedStepJournal(f.env,f.journal,f.record,undefined,read),{code:'managed-path-unverified'});
    unchanged();
    claim.object!.device=String(BigInt(claim.object!.device)+1n);
    refreshConsent();fingerprint=mount.fingerprint;
    upgradeManagedStepJournal(f.env,f.journal,f.record,undefined,read);
    assert.deepEqual(readManagedStepJournal(f.env),f.journal);
    assert.deepEqual(fs.readFileSync(f.history),history);
    assert.deepEqual(fs.readFileSync(f.record.binding.database),db);
    assert.deepEqual(fs.readFileSync(claim.path),before);
    assert.equal(fs.existsSync(f.legacyRoot),!removed);
    assert.equal(fs.existsSync(selector),false);
  }finally{f.cleanup();}
});

for(const damage of ['receipt-missing','receipt-replaced','history-alias','remaining-discovery','wrong-install','wrong-binding','wrong-selection','extra-absence','capture-guess','old-complete','old-changed','retained-lock','retained-stage'] as const){
  test(`format-1 receipt upgrade refuses ${damage} without replacing the old record`,()=>{
    const f=fixture(true);try{
      if(damage==='receipt-missing')fs.writeFileSync(f.history,JSON.stringify({action:'remove-capture',installId:'other'})+'\n');
      if(damage==='receipt-replaced'){fs.renameSync(f.history,`${f.history}.retained`);fs.copyFileSync(`${f.history}.retained`,f.history);fs.chmodSync(f.history,0o600);}
      if(damage==='history-alias')fs.linkSync(f.history,path.join(f.root,'alias'));
      if(damage==='remaining-discovery')fs.mkdirSync(f.legacyRoot,{mode:0o700});
      if(damage==='wrong-install')f.journal.migration.legacyInstallId='other';
      if(damage==='wrong-binding')f.journal.installId='other';
      if(damage==='wrong-selection')publishPrivateJson(path.join(path.dirname(f.file),'progress-binding.json'),{...f.record.binding,installId:'other'});
      if(damage==='extra-absence')f.journal.migration.legacy.claims.push({path:path.join(f.root,'not-a-legacy-root'),kind:'absent',object:null,digest:null});
      if(damage==='capture-guess')f.journal.migration.capture={state:'off',observedAt:'2026-01-01T00:00:00.000Z'};
      if(damage==='old-complete'){f.record.phase='complete';writeMigration(f.env,f.record);}
      if(damage==='old-changed')writeMigration(f.env,{...f.record,phase:'removed'});
      if(damage==='retained-lock')fs.writeFileSync(path.join(path.dirname(f.file),'.configuration-lock'),'retained',{mode:0o600});
      if(damage==='retained-stage')fs.writeFileSync(`${f.file}.stage-retained`,'retained',{mode:0o600});
      f.journal.migration.consent.targetDigest=managedTargetDigest(f.journal);
      const old=fs.readFileSync(f.file),history=fs.readFileSync(f.history);
      assert.throws(()=>upgradeManagedStepJournal(f.env,f.journal,f.record));
      assert.deepEqual(fs.readFileSync(f.file),old);assert.deepEqual(fs.readFileSync(f.history),history);
    }finally{f.cleanup();}
  });
}

test('intact format-1 upgrade refuses changed retained ownership',()=>{
  const f=fixture(false);try{
    fs.appendFileSync(path.join(f.legacyRoot,'index.js'),'changed');const before=fs.readFileSync(f.file);
    assert.throws(()=>upgradeManagedStepJournal(f.env,f.journal,f.record),{code:'modified-owned-files'});
    assert.deepEqual(fs.readFileSync(f.file),before);
  }finally{f.cleanup();}
});

for(const after of [false,true])test(`format-1 upgrade interruption ${after?'after':'before'} replacement retains one whole format`,t=>{
  const f=fixture(true);try{
    const original=fs.renameSync;
    const mock=t.mock.method(fs,'renameSync',((from:any,to:any)=>{
      if(String(to)===f.file){if(after)original(from,to);throw new Error('synthetic interruption');}
      return original(from,to);
    }) as typeof fs.renameSync);syncBuiltinESMExports();
    try{assert.throws(()=>upgradeManagedStepJournal(f.env,f.journal,f.record),/synthetic interruption/);}
    finally{mock.mock.restore();syncBuiltinESMExports();}
    if(after)assert.deepEqual(readManagedStepJournal(f.env),f.journal);
    else{assert.deepEqual(readMigration(f.env),f.record);upgradeManagedStepJournal(f.env,f.journal,f.record);}
  }finally{f.cleanup();}
});

test('format-1 upgrade admission, replacement and checkpoint start no process on the Windows path', {skip:process.platform==='win32'},async t=>{
  const originalSystemRoot=process.env.SystemRoot;
  try{
    for(const removed of [false,true]){
      const f=fixture(removed);try{
        const source=path.join(f.root,'source');
        for(const dir of ['shared','setup'])fs.cpSync(path.resolve(dir),path.join(source,dir),{recursive:true});
        const platformFile=path.join(source,'shared/platform.ts');let text=fs.readFileSync(platformFile,'utf8');
        text=text.replace("export const windows = process.platform === 'win32';",'export const windows = true;');
        const start=text.indexOf("  if (value.includes('\\0')",text.indexOf('function windowsPathsInner(')),end=text.indexOf('  let current = clean;',start);
        assert.ok(start>0&&end>start);text=text.slice(0,start)+"  if (!path.isAbsolute(value) || path.resolve(value) !== value) throw new PlatformError('path-unverified');\n  const clean = value;\n"+text.slice(end);
        fs.writeFileSync(platformFile,text);let spawns=0;
        const mock=t.mock.method(cp,'spawnSync',(()=>{spawns++;throw new Error('no permission check may start a process');}) as unknown as typeof cp.spawnSync);syncBuiltinESMExports();process.env.SystemRoot='C:\\Windows';
        try{
          const platform=await import(pathToFileURL(platformFile).href) as typeof import('../../shared/platform.ts');
          const migration=await import(pathToFileURL(path.join(source,'setup/managed-migration.ts')).href) as typeof import('../../setup/managed-migration.ts');
          const owner=await import(pathToFileURL(path.join(source,'setup/lifecycle.ts')).href) as typeof import('../../setup/lifecycle.ts');
          const budget=new platform.PlatformRequestBudget();
          platform.withPlatformRequestBudget(budget,()=>{
            platform.windowsPaths(migration.managedJournalPaths(f.journal),true);assert.deepEqual(migration.readMigration(f.env),f.record);
            if(removed)assert.ok(migration.readRemovalReceipt(f.record));else owner.validateMigrationRemoval(f.journal);
            migration.upgradeManagedStepJournal(f.env,f.journal,f.record);
          });
          assert.equal(spawns,0);
        }finally{mock.mock.restore();syncBuiltinESMExports();}
      }finally{f.cleanup();}
    }
  }finally{if(originalSystemRoot===undefined)delete process.env.SystemRoot;else process.env.SystemRoot=originalSystemRoot;}
});
