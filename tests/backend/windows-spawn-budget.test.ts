import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {pathToFileURL} from 'node:url';
import {lifecycle} from '../../setup/lifecycle.ts';

/** Portable launch accounting, NOT Windows ACL or timing evidence. Only the
 * platform/path dialect and OS helper are substituted in an isolated source
 * copy. Query sites, scopes, snapshots, validators and migration stay real. */
test('managed operations count actual security spawns with a fake OS helper',{skip:process.platform==='win32'},async t=>{
  const root=fs.mkdtempSync('/tmp/opencode/security-spawns-');
  const originalSystemRoot=process.env.SystemRoot;
  let setup:any;
  try{
    const source=path.join(root,'source');
    for(const dir of ['shared','setup','service'])fs.cpSync(path.resolve(dir),path.join(source,dir),{recursive:true});
    const platform=path.join(source,'shared/platform.ts');
    let text=fs.readFileSync(platform,'utf8');
    assert.ok(text.includes("export const windows = process.platform === 'win32';"));
    text=text.replace("export const windows = process.platform === 'win32';",'export const windows = true;');
    const start=text.indexOf("  if (value.includes('\\0')",text.indexOf('function windowsPathsInner('));
    const end=text.indexOf('  let current = clean;',start);
    assert.ok(start>0&&end>start);
    // Real disposable POSIX paths stand in for drive-absolute NTFS paths. Keep
    // the ancestor walk and the reparsePaths/windowsSecurityQuery calls intact.
    text=text.slice(0,start)+"  if (!path.isAbsolute(value) || path.resolve(value) !== value) throw new PlatformError('path-unverified');\n  const clean = value;\n"+text.slice(end);
    fs.writeFileSync(platform,text);
    const env={HOME:path.join(root,'home ü space')};
    const configRoot=path.join(env.HOME,'.config/opencode'),dataRoot=path.join(env.HOME,'.local/share/opencode');
    for(const dir of [env.HOME,configRoot,dataRoot])fs.mkdirSync(dir,{recursive:true,mode:0o700});
    const targets={configRoot,dataRoot,storeRoot:path.join(dataRoot,'openchamber-progress'),confirmed:true};
    const payload={plugin:'// Synthetic legacy payload',guidance:'Synthetic guidance',removal:'// Synthetic removal',version:'1.1.1'};
    lifecycle('install',targets,payload);
    let spawns=0,fault=false,operation='';
    const migrationStages:Record<string,number>={};
    // The production query uses only the string-encoding overload. Assert that
    // contract; the mock need not implement spawnSync's unrelated Buffer forms.
    t.mock.method(cp,'spawnSync',((command:string,_args:string[],options:cp.SpawnSyncOptionsWithStringEncoding):cp.SpawnSyncReturns<string>=>{
      assert.equal(path.basename(String(command)),'powershell.exe','only the synthetic security helper may spawn');
      assert.equal(options.encoding,'utf8');
      spawns++;
      if(operation==='migrate')migrationStages[setup.migrationStage]=(migrationStages[setup.migrationStage]??0)+1;
      const input=JSON.parse(String(options.input)) as {paths:string[];create:string[]};
      if(fault&&input.create.some((p:string)=>path.basename(p)==='agent-progress-managed'))return {pid:0,output:[],stdout:'',stderr:'',status:null,signal:'SIGTERM',error:Object.assign(new Error('synthetic'),{code:'ETIMEDOUT'})};
      for(const dir of input.create)fs.mkdirSync(dir,{mode:0o700});
      return {pid:1,output:[],stdout:JSON.stringify(input.paths.map(()=>({owned:true,private:true,reparse:false,unsafeParent:false}))),stderr:'',status:0,signal:null};
    })as unknown as typeof cp.spawnSync);
    syncBuiltinESMExports();process.env.SystemRoot='C:\\Windows';
    const {SetupController}=await import(pathToFileURL(path.join(source,'service/setup-controller.ts')).href);
    setup=new SetupController({env},()=>payload);
    const counts:Record<string,number>={};
    function measure<T>(name:string,run:()=>T){spawns=0;operation=name;try{return run();}finally{counts[name]=spawns;}}
    const inspected=measure('inspect',()=>setup.run('managed-inspect',{}));
    assert.equal(inspected.delivery.migration,'available');
    const body={confirmed:true,expected:inspected.delivery.review.expected};
    fault=true;measure('fault',()=>assert.throws(()=>setup.run('managed-migrate',body),/windows-security-unavailable/));fault=false;
    const status=measure('status',()=>setup.status());assert.equal(status.delivery.migration,'available');
    const migrated=measure('migrate',()=>setup.run('managed-migrate',body));
    assert.equal(migrated.delivery.migration,'complete');assert.equal(migrated.captureEnabled,true);
    t.diagnostic(JSON.stringify({securitySpawns:counts,migrationStages}));
    assert.ok(Object.values(counts).every(n=>n>0),'every operation must query the fake OS boundary');
    assert.ok(counts.inspect!<=20);assert.ok(counts.migrate!<=56);assert.ok(counts.fault!<=14);assert.ok(counts.status!<=14);
  }finally{
    setup?.close();t.mock.restoreAll();syncBuiltinESMExports();
    if(originalSystemRoot===undefined)delete process.env.SystemRoot;else process.env.SystemRoot=originalSystemRoot;
    fs.rmSync(root,{recursive:true,force:true});
  }
});
