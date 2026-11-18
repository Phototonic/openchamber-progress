import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {pathToFileURL} from 'node:url';

/** Windows permission checks must never start a process. Portable proof: an
 * isolated source copy is switched to the Windows code path (the platform flag and
 * the drive-letter path syntax are the only substitutions) and every child-process
 * entry point is spied on. Real NTFS behaviour is covered by the native Windows
 * suite; this test only proves that nothing on these paths can spawn. */
const spawnApis=['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork'] as const;

test('no product source starts a process or imports child_process',()=>{
  const offenders:string[]=[];
  const visit=(dir:string)=>{
    for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
      const file=path.join(dir,entry.name);
      if(entry.isDirectory())visit(file);
      else if(/\.(?:ts|mjs|js)$/.test(entry.name)&&/(?:from\s*|import\s*\(\s*|require\s*\(\s*)['"](?:node:)?child_process['"]/.test(fs.readFileSync(file,'utf8')))offenders.push(file);
    }
  };
  for(const dir of ['plugin','service','setup','shared'])visit(path.resolve(dir));
  assert.deepEqual(offenders,[]);
});

test('Windows setup, service and companion paths start no process',{skip:process.platform==='win32'},async t=>{
  const root=fs.mkdtempSync('/tmp/opencode/windows-no-process-');
  const saved=new Map<string,string|undefined>();
  const calls:string[]=[],phases:Record<string,number>={};
  const phase=(name:string)=>{phases[name]=calls.length;calls.length=0;};
  let dispose:undefined|(()=>Promise<void>),setup:any;
  try{
    const source=path.join(root,'source');
    for(const dir of ['shared','setup','service','plugin'])fs.cpSync(path.resolve(dir),path.join(source,dir),{recursive:true});
    fs.symlinkSync(path.resolve('node_modules'),path.join(source,'node_modules'));
    const platform=path.join(source,'shared/platform.ts');
    let text=fs.readFileSync(platform,'utf8');
    assert.ok(text.includes("export const windows = process.platform === 'win32';"));
    text=text.replace("export const windows = process.platform === 'win32';",'export const windows = true;');
    const start=text.indexOf("  if (value.includes('\\0')",text.indexOf('function windowsPathsInner('));
    const end=text.indexOf('  let current = clean;',start);
    assert.ok(start>0&&end>start);
    // Disposable POSIX paths stand in for drive-absolute NTFS paths.
    text=text.slice(0,start)+"  if (!path.isAbsolute(value) || path.resolve(value) !== value) throw new PlatformError('path-unverified');\n  const clean = value;\n"+text.slice(end);
    fs.writeFileSync(platform,text);

    const env:NodeJS.ProcessEnv={PATH:process.env.PATH??'/usr/bin:/bin',HOME:`${root}/home`,XDG_CONFIG_HOME:`${root}/config`,XDG_DATA_HOME:`${root}/data`,SystemRoot:'C:\\Windows'};
    for(const dir of ['home','config/opencode','data/opencode','project'])fs.mkdirSync(`${root}/${dir}`,{recursive:true,mode:0o700});
    for(const [k,v]of Object.entries({...env,AGENT_PROGRESS_BINDING:undefined,OPENCODE_DB:undefined,OPENCODE_CONFIG_DIR:undefined})){saved.set(k,process.env[k]);if(v===undefined)delete process.env[k];else process.env[k]=v;}

    // A pre-change build answered through this fake helper; the fixed build must
    // never reach it, so any call is recorded and fails the test below.
    for(const api of spawnApis){
      t.mock.method(cp,api,((command:string,_args?:string[],options?:{input?:string})=>{
        calls.push(`${api}:${path.basename(String(command))}`);
        if(api!=='spawnSync')throw new Error(`unexpected ${api}`);
        const input=JSON.parse(String(options?.input??'{}')) as {paths:string[];create?:string[]};
        for(const dir of input.create??[])fs.mkdirSync(dir,{mode:0o700});
        return {pid:1,output:[],stdout:JSON.stringify(input.paths.map(()=>({owned:true,private:true,reparse:false,unsafeParent:false}))),stderr:'',status:0,signal:null};
      })as never);
    }
    syncBuiltinESMExports();

    const {SetupController}=await import(pathToFileURL(path.join(source,'service/setup-controller.ts')).href);
    const {default:plugin}=await import(pathToFileURL(path.join(source,'plugin/index.ts')).href);
    const {managedBindingFile}=await import(pathToFileURL(path.join(source,'shared/managed-binding.ts')).href);
    const {RELEASE}=await import(pathToFileURL(path.join(source,'shared/release.ts')).href);
    const payload={plugin:'// Synthetic',guidance:'Synthetic',removal:'// removal',version:RELEASE};

    // (b) Setup and service: inspection, configuration and status.
    setup=new SetupController({env},()=>payload);
    const review=setup.run('managed-inspect',{}).delivery.review;
    setup.run('managed-configure',{confirmed:true,expected:review.expected});
    assert.equal(setup.status().configured,true);
    phase('setup and service');

    // (a) Companion: load, guard (report tool), tool hooks and status inspect.
    const hooks=new Map<string,Set<any>>();let execute:any,inspect:any;
    const hook=async(name:string,fn:any)=>{let set=hooks.get(name);if(!set)hooks.set(name,set=new Set());set.add(fn);return {dispose:async()=>{set.delete(fn);}};};
    const ctx:any={
      session:{hook,get:async({sessionID}:any)=>({id:sessionID,agent:'build',location:{directory:`${root}/project`},projectID:'project_fixture'})},
      skill:{transform:async(fn:any)=>fn({add:()=>{}})},
      tool:{hook,transform:async(fn:any)=>fn({namespace:()=>{},add:(tool:any)=>{execute=tool.execute;}}),list:async()=>[{id:'agent_progress_report',options:{codemode:false}}]},
      rpc:{register:async(_:unknown,impl:{inspect:()=>Promise<unknown>})=>{inspect=impl.inspect;}},permission:{assert:async()=>{}},
      event:{subscribe:()=>(async function*(){})()},
    };
    const binding=managedBindingFile(env);
    const bindingReads=()=>reads.filter(f=>f===binding).length;
    const reads:string[]=[],lstat=fs.lstatSync;
    t.mock.method(fs,'lstatSync',((file:any,...rest:any[])=>{reads.push(String(file));return (lstat as any)(file,...rest);})as typeof fs.lstatSync);
    syncBuiltinESMExports();
    dispose=await plugin.setup(ctx);
    for(const fn of [...(hooks.get('context')??[])])await fn({sessionID:'ses_fixture',system:[],tools:{agent_progress_report:{}}});
    phase('companion load');
    const loaded=bindingReads();assert.ok(loaded>0,'loading the companion read the binding');
    const receipt=JSON.parse((await execute({op:'start',plan:'P-win',oid:'start',rev:0,title:'Synthetic',items:[{id:'work',kind:'task',title:'Work'}]},{sessionID:'ses_fixture',agent:'build',messageID:'msg',id:'call'})).content);
    assert.equal(receipt.rev,1,'a guarded report succeeds');
    phase('guarded report');
    const beforeHooks=bindingReads();
    for(const name of ['execute.before','execute.after'])
      for(const fn of hooks.get(name)??[])try{await fn({sessionID:'ses_fixture',callID:'call_hook',tool:'bash',input:{},output:{}});}catch{/* only the hook's guard matters */}
    assert.ok(bindingReads()>beforeHooks,'tool hooks re-checked the binding');
    phase('tool hooks');
    const status:any=await inspect();assert.equal(status.toolAvailable,true);
    phase('status inspect');
    assert.deepEqual(phases,{'setup and service':0,'companion load':0,'guarded report':0,'tool hooks':0,'status inspect':0},'process calls per phase');
  }finally{
    await dispose?.();setup?.close();t.mock.restoreAll();syncBuiltinESMExports();
    for(const [k,v]of saved){if(v===undefined)delete process.env[k];else process.env[k]=v;}
    fs.rmSync(root,{recursive:true,force:true});
  }
});
