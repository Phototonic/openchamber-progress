import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import {once} from 'node:events';
import path from 'node:path';
import {SetupController} from '../../service/setup-controller.ts';
import {createProgressServer} from '../../service/server.ts';
import {lifecycle} from '../../setup/lifecycle.ts';
import {readBinding} from '../../shared/binding.ts';
import {readManagedBinding,managedBindingFile,managedExpectationFile} from '../../shared/managed-binding.ts';
import {readMigration,migrationFile} from '../../setup/managed-migration.ts';
import {Store} from '../../shared/store.ts';
import {ProgressError} from '../../shared/progress.ts';
import {PlatformError} from '../../shared/platform.ts';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {isolatedEnvironment} from '../fixtures/managed.ts';

test('two isolated legacy scopes migrate to one shared store without replacing expectations',()=>{
  const a=fixture(),b=fixture();try{
    // Reinstall only the disposable second legacy scope against the first Store.
    lifecycle('remove-capture',b.targets);
    const targets={...b.targets,storeRoot:a.targets.storeRoot};lifecycle('install',targets,payload);
    a.migrate();const first=readManagedBinding(a.env)!;
    const before=fs.readFileSync(managedExpectationFile(first));
    const r=b.setup.run('managed-inspect',{}).delivery!.review!;
    b.setup.run('managed-migrate',{confirmed:true,expected:r.expected});
    const second=readManagedBinding(b.env)!;
    assert.equal(second.storeId,first.storeId);assert.notEqual(second.source.id,first.source.id);
    assert.deepEqual(fs.readFileSync(managedExpectationFile(first)),before);
    assert.equal(b.setup.status().delivery!.migration,'complete');assert.equal(a.setup.status().delivery!.migration,'complete');
  }finally{b.cleanup();a.cleanup();}
});
test('expectation publication failure preserves enabled legacy discovery before migration',t=>{
  const f=fixture(),original=fs.linkSync;let failed=false;
  const mock=t.mock.method(fs,'linkSync',((from:any,to:any)=>{
    if(path.basename(String(to)).startsWith('managed-expectation-')){failed=true;throw Error('Synthetic expectation failure');}
    return original(from,to);
  })as typeof fs.linkSync);syncBuiltinESMExports();
  try{
    const selector=fs.readFileSync(path.join(f.legacyRoot,'.ownership.json'));
    assert.throws(()=>f.migrate(),/Synthetic expectation failure/);assert.equal(failed,true);
    assert.equal(f.store.list().captureEnabled,true);assert.equal(readMigration(f.env),undefined);
    assert.deepEqual(fs.readFileSync(path.join(f.legacyRoot,'.ownership.json')),selector);assert.equal(readManagedBinding(f.env),undefined);
  }finally{mock.mock.restore();syncBuiltinESMExports();f.cleanup();}
});

test('a historical default-only loader refuses update before selection and keeps reporting',async()=>{
  const root=fs.mkdtempSync('/tmp/opencode/legacy-update-');let dispose:(()=>Promise<void>)|undefined;
  const saved=new Map<string,string|undefined>();
  try{
    for(const [key,value]of Object.entries({...isolatedEnvironment(root),AGENT_PROGRESS_BINDING:undefined,OPENCODE_DB:undefined,OPENCODE_CONFIG_DIR:undefined})){
      saved.set(key,process.env[key]);if(value===undefined)delete process.env[key];else process.env[key]=value;
    }
    // Generate the ACTUAL old loader, including its ownership manifest, from committed code.
    const names=execFileSync('git',['ls-tree','-r','--name-only','f4d8113','shared','setup'],{encoding:'utf8'}).trim().split('\n').filter(n=>n.endsWith('.ts'));
    for(const name of names){const file=path.join(root,'baseline',name);fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});fs.writeFileSync(file,execFileSync('git',['show',`f4d8113:${name}`]));}
    const old=await import(pathToFileURL(path.join(root,'baseline/setup/lifecycle.ts')).href);
    for(const dir of ['config/opencode','data/opencode','project'])fs.mkdirSync(path.join(root,dir),{recursive:true,mode:0o700});
    const targets={configRoot:path.join(root,'config/opencode'),dataRoot:path.join(root,'data/opencode'),storeRoot:path.join(root,'store'),confirmed:true};
    old.lifecycle('install',targets,{plugin:execFileSync('git',['show','f4d8113:build/companion/index.js'],{encoding:'utf8',maxBuffer:16*1024*1024}),guidance:'Synthetic guidance',removal:'// Synthetic removal',version:'1.1.1'});
    const packageRoot=path.join(targets.configRoot,'plugins/agent-progress'),selector=path.join(packageRoot,'.ownership.json');
    const before=fs.readFileSync(selector),releases=fs.readdirSync(path.join(targets.storeRoot,'payloads'));
    assert.doesNotMatch(fs.readFileSync(path.join(packageRoot,'index.js'),'utf8'),/setupLegacy/);
    const setup=new SetupController(path.join(packageRoot,'progress-binding.json'),()=>({...payload,version:'1.1.2'}));
    try{assert.throws(()=>setup.run('update',{confirmed:true}),/legacy-update-requires-managed-migration/);}finally{setup.close();}
    assert.deepEqual(fs.readFileSync(selector),before);assert.deepEqual(fs.readdirSync(path.join(targets.storeRoot,'payloads')),releases);
    let execute:any;
    const ctx:any={session:{hook:async()=>({dispose:async()=>{}}),get:async()=>({id:'ses_fixture',location:{directory:path.join(root,'project')},agent:'synthetic',projectID:'project_fixture'})},skill:{transform:async()=>{}},tool:{hook:async()=>({dispose:async()=>{}}),transform:async(cb:any)=>cb({namespace:()=>{},add:(v:any)=>{execute=v.execute;}}),list:async()=>[{id:'agent_progress_report',options:{codemode:false}}]},rpc:{register:async()=>{}}};
    const loader=await import(pathToFileURL(path.join(packageRoot,'index.js')).href);
    dispose=await loader.default.setup(ctx);
    const reply=await execute({op:'start',plan:'legacy-kept',oid:'start',rev:0,title:'Synthetic',items:[{id:'work',title:'Work',kind:'task'}]},{sessionID:'ses_fixture',agent:'synthetic'});
    assert.equal(JSON.parse(reply.content).rev,1,'the retained historical release still reports');
  }finally{await dispose?.();for(const[key,value]of saved){if(value===undefined)delete process.env[key];else process.env[key]=value;}fs.rmSync(root,{recursive:true,force:true});}
});

const payload={plugin:'// Synthetic legacy bytes',guidance:'Synthetic guidance',removal:'// Synthetic removal',version:'1.1.1'};
function fixture(){
  const root=fs.mkdtempSync('/tmp/opencode/managed-migration-');
  const env={HOME:`${root}/home`,XDG_CONFIG_HOME:`${root}/config`,XDG_DATA_HOME:`${root}/data`};
  for(const dir of ['home','config/opencode','data/opencode'])fs.mkdirSync(`${root}/${dir}`,{recursive:true,mode:0o700});
  const targets={configRoot:`${root}/config/opencode`,dataRoot:`${root}/data/opencode`,storeRoot:`${root}/legacy-store`,confirmed:true};
  lifecycle('install',targets,payload);
  const legacyRoot=path.join(targets.configRoot,'plugins/agent-progress'),legacy=readBinding(path.join(legacyRoot,'progress-binding.json'));
  const setup=new SetupController({env},()=>payload),store=new Store(legacy.database);
  const actor={sourceId:legacy.source.id,sessionId:'ses_fixture',agent:'build',directory:'/fixture',parentId:null,ancestry:[],verifiedSource:true};
  store.apply({op:'start',plan:'P-history',oid:'retained-start',rev:0,title:'Retained progress',items:[{id:'work',kind:'task',title:'Work'}]},actor);
  const review=()=>setup.run('managed-inspect',{}).delivery!.review!;
  const migrate=()=>{const r=review();return setup.run('managed-migrate',{confirmed:true,expected:r.expected});};
  return {root,env,targets,legacyRoot,legacy,setup,store,review,migrate,cleanup(){setup.close();store.close();fs.rmSync(root,{recursive:true,force:true});}};
}
async function http(f:ReturnType<typeof fixture>,run:(request:(action:string,body:unknown,auth?:boolean)=>Promise<Response>)=>Promise<void>){
  const server=createProgressServer(undefined,'fixture-only',undefined,f.setup);
  try{server.listen(0,'127.0.0.1');await once(server,'listening');
    const url=`http://127.0.0.1:${(server.address()as{port:number}).port}`;
    await run((action,body,auth=true)=>fetch(`${url}/v1/setup/${action}`,{method:'POST',headers:{'content-type':'application/json',...(auth?{authorization:'Bearer fixture-only'}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(3000)}));
  }finally{await new Promise<void>(r=>server.close(()=>r()));}
}

test('one authenticated same-store switch keeps identities, reports, receipts and payloads, with no fabricated load',async()=>{
  const f=fixture();try{
    const oldIds={storeId:f.store.list().storeId,sourceId:f.legacy.source.id};
    const payloads=fs.readdirSync(path.join(f.targets.storeRoot,'payloads'));
    assert.equal(f.setup.status().delivery!.migration,'available','custom legacy store is proposed from the canonical owned package');
    const r=f.review();assert.equal(r.targets.storeRoot,f.targets.storeRoot);
    await http(f,async request=>{
      assert.equal((await request('managed-migrate',{confirmed:true,expected:r.expected},false)).status,401);
      assert.equal((await request('managed-migrate',{expected:r.expected})).status,400);
      assert.equal(f.store.list().captureEnabled,true);assert.ok(fs.existsSync(f.legacyRoot));
      const response=await request('managed-migrate',{confirmed:true,expected:r.expected});assert.equal(response.status,200);
      const result=await response.json();assert.equal(result.delivery.migration,'complete');assert.equal(result.delivery.observation,'not-observed');assert.equal(result.captureEnabled,true);
      assert.equal(result.reportingIdentity.storeId,oldIds.storeId);assert.equal(result.reportingIdentity.sourceId,oldIds.sourceId);
      assert.equal((await request('managed-migrate',{confirmed:true,expected:r.expected})).status,409,'old consent does not replay removal');
    });
    const selected=readManagedBinding(f.env)!;assert.notEqual(selected.installId,f.legacy.installId);
    assert.equal(selected.database,f.legacy.database);assert.equal(fs.existsSync(f.legacyRoot),false);
    assert.deepEqual(fs.readdirSync(path.join(f.targets.storeRoot,'payloads')),payloads);
    assert.equal(f.store.get(f.legacy.source.id,'P-history')!.revision,1);
    assert.equal(f.store.db.prepare('SELECT count(*) n FROM receipts').get()!.n,1);
    assert.equal(f.store.list().sources.length,1);
    const history=fs.readFileSync(path.join(f.targets.storeRoot,'installation-history.jsonl'),'utf8').trim().split('\n').map(line=>JSON.parse(line));
    assert.equal(history.filter(e=>e.action==='remove-capture').length,1);
    const next=new SetupController({env:f.env},()=>payload);
    try{assert.equal(next.status().delivery!.migration,'complete');}finally{next.close();}
    const disable=f.review();f.setup.run('managed-disable',{confirmed:true,expected:disable.expected});
    assert.equal(f.migrate().captureEnabled,false,'reconfirming completed migration never silently re-enables capture');
  }finally{f.cleanup();}
});

test('modified ownership and changed legacy store/source refuse before capture control or deletion',()=>{
  for(const kind of ['bytes','ownership-mode','store-id']as const){const f=fixture();try{
    if(kind==='bytes')fs.appendFileSync(path.join(f.legacyRoot,'index.js'),'// modified');
    if(kind==='ownership-mode')fs.chmodSync(path.join(f.legacyRoot,'.ownership.json'),0o644);
    if(kind==='store-id')f.store.db.prepare('UPDATE meta SET store_id=? WHERE singleton=1').run('different-store');
    const before=fs.readdirSync(f.legacyRoot).sort();
    assert.equal(f.setup.status().delivery!.migration,'conflict');
    assert.throws(()=>f.review(),/managed-migration-conflict/);
    assert.equal(f.store.list().captureEnabled,true);assert.deepEqual(fs.readdirSync(f.legacyRoot).sort(),before);
    assert.equal(readManagedBinding(f.env),undefined);
  }finally{f.cleanup();}}
});

test('legacy and selected managed stores cannot be switched even with a previously valid confirmation',()=>{
  const f=fixture();try{
    // Select another store explicitly while the canonical global package is temporarily retained away.
    const retained=f.legacyRoot+'.retained';fs.renameSync(f.legacyRoot,retained);
    const inspected=f.setup.run('managed-inspect',{}).delivery!.review!;
    f.setup.run('managed-configure',{confirmed:true,expected:inspected.expected});
    fs.renameSync(retained,f.legacyRoot);
    const selected=readManagedBinding(f.env)!,bytes=fs.readFileSync(managedBindingFile(f.env));
    assert.notEqual(selected.database,f.legacy.database);
    assert.equal(f.setup.status().delivery!.migration,'conflict');
    const review=f.review();
    for(const action of ['managed-enable','managed-migrate']as const)assert.throws(()=>f.setup.run(action,{confirmed:true,expected:review.expected}),/managed-migration-conflict/);
    assert.equal(f.store.list().captureEnabled,true);assert.ok(fs.existsSync(f.legacyRoot));assert.deepEqual(fs.readFileSync(managedBindingFile(f.env)),bytes);
  }finally{f.cleanup();}
});

test('confirmed managed capture-off survives modified legacy ownership without authorizing enable or migration',async()=>{
  const f=fixture();try{
    const retained=f.legacyRoot+'.retained';fs.renameSync(f.legacyRoot,retained);
    const r=f.review();f.setup.run('managed-configure',{confirmed:true,expected:r.expected});
    fs.renameSync(retained,f.legacyRoot);fs.appendFileSync(path.join(f.legacyRoot,'index.js'),'// modified');
    const bytes=fs.readFileSync(path.join(f.legacyRoot,'index.js')),selected=readManagedBinding(f.env)!;
    const control=new Store(selected.database);try{
      assert.equal(f.setup.status().delivery!.migration,'conflict');
      await http(f,async request=>{
        const response=await request('managed-inspect',{});assert.equal(response.status,200);
        const review=(await response.json()).delivery.review;
        assert.equal((await request('managed-disable',{expected:review.expected})).status,400);
        assert.equal(control.list().captureEnabled,true);
        for(const action of ['managed-enable','managed-migrate'])assert.equal((await request(action,{confirmed:true,expected:review.expected})).status,409);
        assert.equal((await request('managed-disable',{confirmed:true,expected:review.expected})).status,200);
        assert.equal(control.list().captureEnabled,false);
        assert.equal((await request('managed-disable',{confirmed:true,expected:review.expected})).status,409,'changed control invalidates old consent');
      });
      assert.deepEqual(fs.readFileSync(path.join(f.legacyRoot,'index.js')),bytes);assert.equal(f.store.list().captureEnabled,true,'unselected legacy Store is untouched');
    }finally{control.close();}
  }finally{f.cleanup();}
});

test('migration inspection preserves operational diagnostics instead of claiming an ownership conflict',async t=>{
  for(const phase of ['legacy','record'])for(const code of ['busy','corrupt','schema','storage','windows-security-unavailable']as const)await t.test(`${phase}: ${code}`,async t=>{
    const f=fixture();try{
      if(phase==='record')f.migrate();
      const original=Store.prototype.subagentRunStorage;
      t.mock.method(Store.prototype,'subagentRunStorage',function(this:Store){if(this.file===f.legacy.database)throw code==='windows-security-unavailable'?new PlatformError(code):new ProgressError(code);return original.call(this);});
      const status=f.setup.status();assert.equal(status.delivery!.migration,'unavailable');assert.ok(status.diagnostics.includes(code));
      await http(f,async request=>{const r=await request('managed-inspect',{});assert.equal(r.status,503);assert.deepEqual(await r.json(),{error:code==='windows-security-unavailable'?'storage':code});});
      assert.equal(f.store.list().captureEnabled,true);assert.equal(fs.existsSync(f.legacyRoot),phase==='legacy');
      assert.equal(fs.existsSync(managedBindingFile(f.env)),phase==='record');
    }finally{t.mock.restoreAll();f.cleanup();}
  });
});

test('unsafe private migration records remain ownership conflicts, not operational outages',()=>{
  const f=fixture();try{
    f.migrate();const file=migrationFile(f.env),retained=file+'.retained';
    fs.renameSync(file,retained);fs.symlinkSync(retained,file);
    assert.equal(f.setup.status().delivery!.migration,'conflict');
    const review=f.review();assert.throws(()=>f.setup.run('managed-migrate',{confirmed:true,expected:review.expected}));
    assert.ok(fs.lstatSync(file).isSymbolicLink());assert.equal(f.store.list().captureEnabled,true);
  }finally{f.cleanup();}
});

test('interruption after disable is pending and an explicit retry repeats full ownership validation',t=>{
  const f=fixture(),original=fs.rmSync;let injected=false;
  const mock=t.mock.method(fs,'rmSync',((file:any,...args:any[])=>{if(String(file).startsWith(f.legacyRoot+path.sep)&&!injected){injected=true;throw new Error('Synthetic removal interruption');}return(original as any)(file,...args);})as typeof fs.rmSync);syncBuiltinESMExports();
  try{
    assert.throws(()=>f.migrate(),/Synthetic removal interruption/);
    assert.equal(f.store.list().captureEnabled,false);assert.equal(f.setup.status().delivery!.migration,'pending');assert.equal(readManagedBinding(f.env),undefined);
    mock.mock.restore();syncBuiltinESMExports();
    const result=f.migrate();assert.equal(result.delivery!.migration,'complete');assert.equal(result.captureEnabled,true);
    assert.equal(f.store.get(f.legacy.source.id,'P-history')!.revision,1);
  }finally{mock.mock.restore();syncBuiltinESMExports();f.cleanup();}
});

test('descriptor publication interruption is recoverable after service restart without a second removal',t=>{
  const f=fixture(),original=fs.linkSync;let injected=false;
  const mock=t.mock.method(fs,'linkSync',((from:any,to:any)=>{if(String(to)===managedBindingFile(f.env)&&!injected){injected=true;throw new Error('Synthetic binding publication interruption');}return original(from,to);})as typeof fs.linkSync);syncBuiltinESMExports();
  try{
    assert.throws(()=>f.migrate(),/Synthetic binding publication interruption/);
    assert.equal(f.store.list().captureEnabled,false);assert.equal(fs.existsSync(f.legacyRoot),false);assert.equal(readMigration(f.env)!.phase,'removed');
    assert.equal(f.setup.status().delivery!.migration,'pending');assert.equal(readManagedBinding(f.env),undefined);
    mock.mock.restore();syncBuiltinESMExports();f.setup.close();
    const resumed=new SetupController({env:f.env},()=>payload);
    try{
      const r=resumed.run('managed-inspect',{}).delivery!.review!;
      assert.equal(resumed.run('managed-migrate',{confirmed:true,expected:r.expected}).delivery!.migration,'complete');
    }finally{resumed.close();}
    const history=fs.readFileSync(path.join(f.targets.storeRoot,'installation-history.jsonl'),'utf8').trim().split('\n').map(line=>JSON.parse(line));
    assert.equal(history.filter(e=>e.action==='remove-capture').length,1);assert.equal(f.store.list().captureEnabled,true);
  }finally{mock.mock.restore();syncBuiltinESMExports();f.cleanup();}
});

test('selection published before completion is still capture-off, and only explicit same-target retry enables it',t=>{
  const f=fixture(),original=fs.renameSync;let injected=false;
  const mock=t.mock.method(fs,'renameSync',((from:any,to:any)=>{
    if(String(to)===migrationFile(f.env)&&JSON.parse(fs.readFileSync(from,'utf8')).migration.phase==='complete'&&!injected){injected=true;throw new Error('Synthetic completion interruption');}
    return original(from,to);
  })as typeof fs.renameSync);syncBuiltinESMExports();
  try{
    assert.throws(()=>f.migrate(),/Synthetic completion interruption/);
    assert.ok(readManagedBinding(f.env));assert.equal(f.store.list().captureEnabled,false);
    assert.equal(f.setup.status().delivery!.migration,'pending');assert.equal(f.setup.status().captureEnabled,false);
    const r=f.review();assert.throws(()=>f.setup.run('managed-enable',{confirmed:true,expected:r.expected}),/managed-migration-required/);
    assert.throws(()=>f.setup.enableCapture(),/managed-migration-required/);
    assert.equal(f.store.list().captureEnabled,false);
    mock.mock.restore();syncBuiltinESMExports();assert.equal(f.migrate().delivery!.migration,'complete');
    assert.equal(f.store.list().captureEnabled,true);assert.equal(f.store.get(f.legacy.source.id,'P-history')!.revision,1);
  }finally{mock.mock.restore();syncBuiltinESMExports();f.cleanup();}
});

test('a half-removed legacy package remains capture-off and cannot turn pending state into weaker deletion authority',t=>{
  const f=fixture(),original=fs.rmSync;let removed=0;
  const mock=t.mock.method(fs,'rmSync',((file:any,...args:any[])=>{
    if(String(file).startsWith(f.legacyRoot+path.sep)&&++removed===2)throw new Error('Synthetic mid-removal interruption');
    return(original as any)(file,...args);
  })as typeof fs.rmSync);syncBuiltinESMExports();
  try{
    assert.throws(()=>f.migrate(),/Synthetic mid-removal interruption/);
    mock.mock.restore();syncBuiltinESMExports();
    assert.equal(f.store.list().captureEnabled,false);assert.equal(readMigration(f.env)!.phase,'pending');assert.equal(readManagedBinding(f.env),undefined);
    const remaining=fs.readdirSync(f.legacyRoot).sort();assert.equal(f.setup.status().delivery!.migration,'conflict');
    // Removal deletes the loader entry first, so a fresh OpenCode start finds nothing loadable.
    assert.equal(remaining.includes('index.js'),false,'half-removed legacy package has no loadable entry');
    assert.throws(()=>f.review(),/managed-migration-conflict/);
    assert.deepEqual(fs.readdirSync(f.legacyRoot).sort(),remaining,'no repair, deletion or global-loader restoration');
    assert.equal(f.store.get(f.legacy.source.id,'P-history')!.revision,1);
  }finally{mock.mock.restore();syncBuiltinESMExports();f.cleanup();}
});
