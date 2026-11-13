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
import {readManagedBinding,managedBindingFile} from '../../shared/managed-binding.ts';
import {readMigration,migrationFile} from '../../setup/managed-migration.ts';
import {Store} from '../../shared/store.ts';

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
    assert.throws(()=>f.review(),/managed-migration-conflict/);
    assert.equal(f.store.list().captureEnabled,true);assert.ok(fs.existsSync(f.legacyRoot));assert.deepEqual(fs.readFileSync(managedBindingFile(f.env)),bytes);
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
    assert.throws(()=>f.review(),/managed-migration-conflict/);
    assert.deepEqual(fs.readdirSync(f.legacyRoot).sort(),remaining,'no repair, deletion or global-loader restoration');
    assert.equal(f.store.get(f.legacy.source.id,'P-history')!.revision,1);
  }finally{mock.mock.restore();syncBuiltinESMExports();f.cleanup();}
});
