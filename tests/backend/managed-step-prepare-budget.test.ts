import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {pathToFileURL} from 'node:url';
import {lifecycle} from '../../setup/lifecycle.ts';

/** Feasibility measurement, not engine acceptance or native Windows evidence.
 * Keep the existing directory helper, query sites, cache scopes and snapshots.
 * Only the path dialect and actual OS process boundary are substituted. */
test('existing managed bootstrap fits six launches with fresh known-path batches', {skip:process.platform==='win32'}, async t=>{
  const root=fs.mkdtempSync('/tmp/opencode/prepare-spawns-');
  const originalSystemRoot=process.env.SystemRoot;
  try {
    const source=path.join(root,'source');
    for(const dir of ['shared','setup'])fs.cpSync(path.resolve(dir),path.join(source,dir),{recursive:true});
    const platformFile=path.join(source,'shared/platform.ts');
    let text=fs.readFileSync(platformFile,'utf8');
    assert.ok(text.includes("export const windows = process.platform === 'win32';"));
    text=text.replace("export const windows = process.platform === 'win32';",'export const windows = true;');
    const start=text.indexOf("  if (value.includes('\\0')",text.indexOf('function windowsPathsInner('));
    const end=text.indexOf('  let current = clean;',start);
    assert.ok(start>0&&end>start);
    text=text.slice(0,start)+"  if (!path.isAbsolute(value) || path.resolve(value) !== value) throw new PlatformError('path-unverified');\n  const clean = value;\n"+text.slice(end);
    fs.writeFileSync(platformFile,text);
    const env={HOME:path.join(root,'home space ü')};
    const configRoot=path.join(env.HOME,'.config/opencode'),dataRoot=path.join(env.HOME,'.local/share/opencode');
    for(const dir of [env.HOME,configRoot,dataRoot])fs.mkdirSync(dir,{recursive:true,mode:0o700});
    const targets={configRoot,dataRoot,storeRoot:path.join(dataRoot,'openchamber-progress'),confirmed:true};
    lifecycle('install',targets,{plugin:'// Synthetic',guidance:'Synthetic',removal:'// Synthetic',version:'1.1.1'});
    // Fixture enumeration supplies claims, never security authority. The fresh
    // batch below and the real lifecycle owner validate all of them again.
    const paths:string[]=[];
    function discover(file:string){paths.push(file);if(fs.lstatSync(file).isDirectory())for(const name of fs.readdirSync(file))discover(path.join(file,name));}
    discover(env.HOME);
    let spawns=0;
    t.mock.method(cp,'spawnSync',((command:string,_args:string[],options:cp.SpawnSyncOptionsWithStringEncoding):cp.SpawnSyncReturns<string>=>{
      assert.equal(path.basename(command),'powershell.exe');
      spawns++;
      const request=JSON.parse(String(options.input)) as {paths:string[];create:string[]};
      for(const dir of request.create)fs.mkdirSync(dir,{mode:0o700});
      return {pid:1,output:[],stdout:JSON.stringify(request.paths.map(()=>({owned:true,private:true,reparse:false,unsafeParent:false}))),stderr:'',status:0,signal:null};
    }) as unknown as typeof cp.spawnSync);
    syncBuiltinESMExports();process.env.SystemRoot='C:\\Windows';
    const platform=await import(pathToFileURL(platformFile).href) as typeof import('../../shared/platform.ts');
    const managed=await import(pathToFileURL(path.join(source,'shared/managed-binding.ts')).href) as typeof import('../../shared/managed-binding.ts');
    const migration=await import(pathToFileURL(path.join(source,'setup/managed-migration.ts')).href) as typeof import('../../setup/managed-migration.ts');
    const binding=await import(pathToFileURL(path.join(source,'shared/binding.ts')).href) as typeof import('../../shared/binding.ts');
    const counts:Record<string,number>={};
    const measured=<T>(name:string,run:()=>T)=>{const before=spawns;try{return run();}finally{counts[name]=spawns-before;}};
    const budget=new platform.PlatformRequestBudget();
    platform.withPlatformRequestBudget(budget,()=>{
    const legacy=measured('admission',()=>platform.platformSecurityScope(()=>{
      platform.windowsPaths(paths,true);
      return migration.legacyMigration(env)!;
    }));
    const selector=measured('unchangedDirectoryHelper',()=>managed.createManagedBindingDirectory(env));
    const journal=path.join(path.dirname(selector),'migration.json');
    const known=[...paths,path.dirname(selector),path.join(path.dirname(selector),'.ownership.json'),selector,journal];
    measured('publicationValidation',()=>platform.platformSecurityScope(()=>{
      platform.windowsPaths(known,true);
      assert.equal(managed.managedBindingFile(env),selector);
      assert.equal(migration.readMigration(env),undefined);
      assert.equal(migration.legacyMigration(env)!.ownership,legacy.ownership);
    }));
    // Only the filesystem envelope is under test here, not journal semantics.
    managed.publishPrivateJson(journal,legacy.binding);
    measured('checkpointValidation',()=>platform.platformSecurityScope(()=>{
      platform.windowsPaths(known,true);
      assert.equal(managed.managedBindingFile(env),selector);
      assert.ok(platform.privatePaths([journal]));
      assert.deepEqual(binding.readBinding(journal),legacy.binding);
    }));
    });
    t.diagnostic(JSON.stringify({prepareSecuritySpawns:spawns,stages:counts}));
    assert.equal(budget.securitySpawns,spawns,'the request budget charges every fake spawn');
    assert.ok(spawns<=6,`prepare requires ${spawns} actual security launches`);
  } finally {
    t.mock.restoreAll();syncBuiltinESMExports();
    if(originalSystemRoot===undefined)delete process.env.SystemRoot;else process.env.SystemRoot=originalSystemRoot;
    fs.rmSync(root,{recursive:true,force:true});
  }
});
