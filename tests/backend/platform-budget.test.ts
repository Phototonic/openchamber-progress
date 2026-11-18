import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {syncBuiltinESMExports} from 'node:module';
import {pathToFileURL} from 'node:url';
import {PlatformRequestBudget,withPlatformRequestBudget} from '../../shared/platform.ts';

test('a request budget is synchronous-only: a Promise or custom thenable is refused and the budget is released',()=>{
  for(const value of [Promise.resolve(1),{then(){}},Object.assign(()=>{},{then(){}})])
    assert.throws(()=>withPlatformRequestBudget(new PlatformRequestBudget(),()=>value),{code:'managed-step-conflict'});
  assert.equal(withPlatformRequestBudget(new PlatformRequestBudget(),()=>42),42,'a refusal releases the local budget');
});

test('a nested request budget is refused, and a failure releases the outer one',()=>{
  assert.throws(()=>withPlatformRequestBudget(new PlatformRequestBudget(),()=>withPlatformRequestBudget(new PlatformRequestBudget(),()=>1)),{code:'managed-step-conflict'});
  assert.throws(()=>withPlatformRequestBudget(new PlatformRequestBudget(),()=>{throw new Error('synthetic');}),/synthetic/);
  assert.equal(withPlatformRequestBudget(new PlatformRequestBudget(),()=>'ok'),'ok');
});

test('a budget past its deadline, or inside the requested headroom, refuses',()=>{
  const started=process.hrtime.bigint()-16_000_000_000n;
  assert.doesNotThrow(()=>new PlatformRequestBudget(started).require());
  assert.throws(()=>new PlatformRequestBudget(started).require(2_500),{code:'managed-step-deadline'});
  assert.throws(()=>new PlatformRequestBudget(started-2_000_000_000n).require(),{code:'managed-step-deadline'});
  assert.equal(new PlatformRequestBudget().securitySpawns,0);
});

/** The platform flag and the drive-letter syntax are the only substitutions. */
test('Windows exclusive directory creation maps a lost creation race to a path refusal',{skip:process.platform==='win32'},async t=>{
  const root=fs.mkdtempSync('/tmp/opencode/platform-race-');
  try{
    const source=path.join(root,'source');
    fs.cpSync(path.resolve('shared'),path.join(source,'shared'),{recursive:true});
    const file=path.join(source,'shared/platform.ts');
    let text=fs.readFileSync(file,'utf8');
    text=text.replace("export const windows = process.platform === 'win32';",'export const windows = true;');
    const start=text.indexOf("  if (value.includes('\\0')",text.indexOf('function windowsPathsInner('));
    const end=text.indexOf('  let current = clean;',start);
    assert.ok(start>0&&end>start);
    text=text.slice(0,start)+"  if (!path.isAbsolute(value) || path.resolve(value) !== value) throw new PlatformError('path-unverified');\n  const clean = value;\n"+text.slice(end);
    fs.writeFileSync(file,text);
    const platform=await import(pathToFileURL(file).href) as typeof import('../../shared/platform.ts');
    const target=path.join(root,'created');
    // Another writer wins the race between validation and creation.
    const real=fs.mkdirSync;
    const mock=t.mock.method(fs,'mkdirSync',((dir:any,...rest:any[])=>{if(String(dir)===target)(real as any)(dir);return (real as any)(dir,...rest);}) as typeof fs.mkdirSync);
    syncBuiltinESMExports();
    try{assert.throws(()=>platform.privateDirectory(target,false,{exclusive:true,validate(){}}),{code:'path-unverified'});}
    finally{mock.mock.restore();syncBuiltinESMExports();}
    assert.equal(fs.existsSync(target),true,'the winner\'s directory is left untouched');
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
