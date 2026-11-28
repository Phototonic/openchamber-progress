import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {lifecycle} from '../../setup/lifecycle.ts';
import {readBinding} from '../../shared/binding.ts';
import {readRemovalReceipt,type MigrationRecord} from '../../setup/managed-migration.ts';
import type {ManagedVolumeIdentityEvidence,ManagedVolumeIdentityReader} from '../../setup/managed-volume-identity.ts';
import {managedStepFixtures} from '../fixtures/managed-steps.ts';

function fixture(){
  const root=fs.mkdtempSync('/tmp/opencode/removal-receipt-');
  const targets={configRoot:path.join(root,'config'),dataRoot:path.join(root,'data'),storeRoot:path.join(root,'store'),confirmed:true};
  for(const dir of [targets.configRoot,targets.dataRoot])fs.mkdirSync(dir,{mode:0o700});
  lifecycle('install',targets,{plugin:'// Synthetic',guidance:'Synthetic',removal:'// Synthetic',version:'1.1.1'});
  const legacyRoot=path.join(targets.configRoot,'plugins/agent-progress');
  const binding=readBinding(path.join(legacyRoot,'progress-binding.json'));
  const record:MigrationRecord={binding:{...binding,installId:'managed-synthetic'},legacyInstallId:binding.installId,phase:'pending'};
  return {root,targets,legacyRoot,record,history:path.join(targets.storeRoot,'installation-history.jsonl'),close:()=>fs.rmSync(root,{recursive:true,force:true})};
}

test('receipt recovery returns the specific existing line and fresh native file claim without writes',()=>{
  const f=fixture();
  try{
    assert.throws(()=>readRemovalReceipt(f.record),/managed-migration-conflict/,'remaining discovery is never authorized by history');
    lifecycle('remove-capture',f.targets);
    const before=fs.readFileSync(f.history);
    const receipt=readRemovalReceipt(f.record)!;
    assert.ok(receipt);assert.equal(JSON.parse(receipt.entry).action,'remove-capture');
    assert.equal(JSON.parse(receipt.entry).installId,f.record.legacyInstallId);
    assert.equal(receipt.history.path,f.history);assert.equal(receipt.history.kind,'file');
    assert.equal(typeof receipt.history.object?.inode,'string');assert.match(receipt.history.digest!,/^[a-f0-9]{64}$/);
    assert.ok(before.toString().split('\n').includes(receipt.entry));
    assert.deepEqual(fs.readFileSync(f.history),before);
    // Consume the frozen shared discriminant rather than inventing a parallel
    // receipt shape. Its synthetic claims are replaced by actual observations.
    const journal=managedStepFixtures().removedJournal;
    journal.migration.legacy={kind:'removal-receipt',ownership:null,ownershipDigest:null,
      claims:[{path:f.legacyRoot,kind:'absent',object:null,digest:null}],receipt};
    assert.equal(journal.migration.legacy.receipt.entry,receipt.entry);
    assert.deepEqual(readRemovalReceipt(f.record,receipt),receipt);
  }finally{f.close();}
});

test('receipt revalidation permits later same-file appends but refuses a missing or changed exact event',()=>{
  const f=fixture();
  try{
    lifecycle('remove-capture',f.targets);
    const receipt=readRemovalReceipt(f.record)!;
    fs.appendFileSync(f.history,JSON.stringify({action:'other',installId:'another-install'})+'\n');
    const refreshed=readRemovalReceipt(f.record,receipt)!;
    assert.equal(refreshed.entry,receipt.entry);assert.deepEqual(refreshed.history.object,receipt.history.object);
    assert.notEqual(refreshed.history.digest,receipt.history.digest);
    fs.writeFileSync(f.history,JSON.stringify({...JSON.parse(receipt.entry),changed:true})+'\n');
    assert.throws(()=>readRemovalReceipt(f.record,receipt),/managed-migration-conflict/);
  }finally{f.close();}
});

test('history receipt permits renumbering with its own proof and later appends; no fallback on lost or reused proof',()=>{
  const f=fixture();
  try{
    lifecycle('remove-capture',f.targets);
    const receipt=readRemovalReceipt(f.record)!;
    const {database}=f.record.binding,paths=[{path:f.history,fingerprint:'a'.repeat(64)},{path:database,fingerprint:'b'.repeat(64)}];
    const evidence:ManagedVolumeIdentityEvidence={version:1,paths};
    const observed=new Map(paths.map(p=>[p.path,p.fingerprint]));
    const read:ManagedVolumeIdentityReader=({path})=>{
      const fingerprint=observed.get(path);
      return fingerprint?{kind:'verified',fingerprint}:{kind:'unavailable'};
    };
    const renumbered=structuredClone(receipt);
    renumbered.history.object!.device=String(BigInt(receipt.history.object!.device)+1n);
    fs.appendFileSync(f.history,'{"action":"later"}\n');
    const history=fs.readFileSync(f.history),db=fs.readFileSync(database);
    assert.throws(()=>readRemovalReceipt(f.record,renumbered),{code:'managed-migration-conflict'});
    const refreshed=readRemovalReceipt(f.record,renumbered,evidence,read)!;
    assert.equal(refreshed.entry,receipt.entry);
    assert.deepEqual(refreshed.history.object,receipt.history.object);
    observed.set(f.history,'c'.repeat(64));
    assert.throws(()=>readRemovalReceipt(f.record,receipt,evidence,read),{code:'managed-migration-conflict'},'device/inode/birth and event still match');
    observed.delete(f.history);
    assert.throws(()=>readRemovalReceipt(f.record,receipt,evidence,read),{code:'managed-migration-conflict'});
    observed.set(f.history,'a'.repeat(64));
    observed.set(database,'a'.repeat(64));
    assert.throws(()=>readRemovalReceipt(f.record,receipt,evidence,read),{code:'managed-migration-conflict'},'history proof cannot stand in for database placement');
    assert.deepEqual(fs.readFileSync(f.history),history);
    assert.deepEqual(fs.readFileSync(database),db);
    assert.equal(fs.existsSync(f.legacyRoot),false);
  }finally{f.close();}
});

test('receipt revalidation refuses replacement even with identical bytes and refuses hard links',()=>{
  const f=fixture();
  try{
    lifecycle('remove-capture',f.targets);
    const receipt=readRemovalReceipt(f.record)!;
    const copy=path.join(f.root,'replacement');fs.writeFileSync(copy,fs.readFileSync(f.history),{mode:0o600});
    fs.renameSync(copy,f.history);
    assert.throws(()=>readRemovalReceipt(f.record,receipt),/managed-migration-conflict/);
    fs.linkSync(f.history,path.join(f.root,'alias'));
    assert.throws(()=>readRemovalReceipt(f.record),/managed-migration-conflict/);
  }finally{f.close();}
});

test('foreign receipt identity, changed Store identity and renewed discovery never grant removal evidence',()=>{
  const f=fixture();
  try{
    lifecycle('remove-capture',f.targets);
    assert.equal(readRemovalReceipt({...f.record,legacyInstallId:'unrelated-install'}),undefined);
    assert.throws(()=>readRemovalReceipt({...f.record,binding:{...f.record.binding,storeId:'unrelated-store'}}),/binding/);
    const receipt=readRemovalReceipt(f.record)!;
    fs.mkdirSync(f.legacyRoot,{mode:0o700});
    assert.throws(()=>readRemovalReceipt(f.record,receipt),/managed-migration-conflict/);
    assert.deepEqual(fs.readdirSync(f.legacyRoot),[],'foreign directory remains untouched');
  }finally{f.close();}
});

test('private state aliases, changed permissions and non-UTF-8 history fail fresh receipt validation',()=>{
  const f=fixture();
  try{
    lifecycle('remove-capture',f.targets);
    const receipt=readRemovalReceipt(f.record)!;
    const alias=path.join(f.root,'database-alias');fs.linkSync(f.record.binding.database,alias);
    assert.throws(()=>readRemovalReceipt(f.record,receipt),/managed-migration-conflict/);
    fs.unlinkSync(alias);
    fs.chmodSync(f.history,0o644);
    assert.throws(()=>readRemovalReceipt(f.record,receipt),/managed-migration-conflict/);
    fs.chmodSync(f.history,0o600);
    fs.appendFileSync(f.history,Buffer.from([0xff]));
    assert.throws(()=>readRemovalReceipt(f.record,receipt),/managed-migration-conflict/);
  }finally{f.close();}
});
