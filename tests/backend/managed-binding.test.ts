import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs, { mkdtempSync, mkdirSync, lstatSync, readdirSync, readFileSync, writeFileSync, rmSync, chmodSync, symlinkSync, renameSync, existsSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { once } from 'node:events';
import path from 'node:path';
import { SetupController } from '../../service/setup-controller.ts';
import { createProgressServer } from '../../service/server.ts';
import { serviceBindingFile } from '../../service/state.ts';
import { managedBindingFile, managedSourceRoots, readManagedBinding, createManagedBindingDirectory, managedExpectationFile } from '../../shared/managed-binding.ts';
import { Store } from '../../shared/store.ts';
import { lifecycle } from '../../setup/lifecycle.ts';
import type { SetupRead } from '../../shared/progress.ts';

const payload={plugin:'export default {}',guidance:'Synthetic guidance',removal:'// fixture',version:'1.1.1'};
function fixture() {
  const root=mkdtempSync('/tmp/opencode/managed-binding-');
  const env={HOME:`${root}/home`,XDG_CONFIG_HOME:`${root}/config`,XDG_DATA_HOME:`${root}/data`};
  for(const p of [env.HOME,`${env.XDG_CONFIG_HOME}/opencode`,`${env.XDG_DATA_HOME}/opencode`])mkdirSync(p,{recursive:true,mode:0o700});
  const roots=managedSourceRoots(env),storeRoot=path.join(roots.dataRoot,'openchamber-progress');
  const targets={...roots,storeRoot,confirmed:true};
  const setup=new SetupController({env},()=>payload);
  return {root,env,roots,storeRoot,targets,setup,clean(){setup.close();rmSync(root,{recursive:true,force:true});}};
}
function review(f:ReturnType<typeof fixture>,storeRoot?:string) {return f.setup.run('managed-inspect',storeRoot?{storeRoot}:{}).delivery!.review!;}
function configure(f:ReturnType<typeof fixture>,storeRoot?:string) {const r=review(f,storeRoot);return f.setup.run('managed-configure',{storeRoot:r.targets.storeRoot,confirmed:true,expected:r.expected});}
function tree(root:string):unknown {return readdirSync(root).sort().map(name=>{const file=path.join(root,name),s=lstatSync(file);return [name,s.mode,s.isDirectory()?tree(file):s.isSymbolicLink()?'link':readFileSync(file).toString('base64')];});}
test('isolated managed scopes configure one shared custom store without replacing expectations',()=>{
  const a=fixture(),b=fixture();try{
    configure(a);const first=readManagedBinding(a.env)!,file=managedExpectationFile(first),bytes=readFileSync(file);
    configure(b,a.storeRoot);const second=readManagedBinding(b.env)!;
    assert.equal(second.storeId,first.storeId);assert.notEqual(second.source.id,first.source.id);
    assert.notEqual(managedExpectationFile(second),file);assert.deepEqual(readFileSync(file),bytes);
    assert.equal(a.setup.status().delivery!.observation,'not-observed');assert.equal(b.setup.status().delivery!.observation,'not-observed');
  }finally{b.clean();a.clean();}
});
test('expectation publication failure precedes source registration',t=>{
  const f=fixture(),original=fs.linkSync;let failed=false;
  const mock=t.mock.method(fs,'linkSync',((from:any,to:any)=>{
    if(path.basename(String(to)).startsWith('managed-expectation-')){failed=true;throw Error('Synthetic expectation failure');}
    return original(from,to);
  })as typeof fs.linkSync);syncBuiltinESMExports();
  try{
    assert.throws(()=>configure(f),/Synthetic expectation failure/);assert.equal(failed,true);
    assert.equal(readManagedBinding(f.env),undefined);
    const store=new Store(path.join(f.storeRoot,'progress.sqlite'));try{assert.equal(store.list().sources.length,0);}finally{store.close();}
  }finally{mock.mock.restore();syncBuiltinESMExports();f.clean();}
});
async function http(f:ReturnType<typeof fixture>,run:(request:(action:string,body?:unknown,authorized?:boolean)=>Promise<Response>)=>Promise<void>) {
  const server=createProgressServer(undefined,'fixture-only',undefined,f.setup);
  try {
    server.listen(0,'127.0.0.1');await once(server,'listening');
    const url=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
    await run((action,body,authorized=true)=>fetch(`${url}${action.startsWith('/')?action:'/v1/setup/'+action}`,{
      method:body===undefined?'GET':'POST',headers:{...(authorized?{authorization:'Bearer fixture-only'}:{}),'content-type':'application/json'},
      ...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(3000)}));
  }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
}

test('shared resolver ignores state roots and overrides; missing discovery and inspect create nothing',()=>{
  const f=fixture();try {
    const before=tree(f.root),file=managedBindingFile(f.env);
    for(const extra of [{},{XDG_STATE_HOME:'/synthetic/state-a'},{XDG_STATE_HOME:'/synthetic/state-b',AGENT_PROGRESS_BINDING:'/synthetic/other.json'}])
      assert.equal(serviceBindingFile({...f.env,...extra}),file);
    assert.equal(readManagedBinding(f.env),undefined);
    assert.equal(f.setup.status().delivery?.configuration,'unconfigured');
    assert.equal(review(f).storeId,null);assert.deepEqual(tree(f.root),before);
    for(const shared of [f.roots.configRoot,f.roots.dataRoot,path.dirname(file)])assert.throws(()=>review(f,shared),/managed-selection-conflict/);
    assert.equal(existsSync(path.dirname(file)),false);assert.equal(existsSync(f.storeRoot),false);
    const fallback=managedSourceRoots({HOME:f.env.HOME});
    assert.equal(fallback.dataRoot,path.join(f.env.HOME,'.local/share/opencode'));
  }finally{f.clean();}
});

test('bad explicit XDG and unsupported effective scopes never use a fallback or create state',async()=>{
  for(const extra of [{XDG_DATA_HOME:''},{XDG_DATA_HOME:'relative'},{XDG_DATA_HOME:'/synthetic/../data'},{XDG_CONFIG_HOME:''},{OPENCODE_DB:'/synthetic/override.sqlite'},{OPENCODE_CONFIG_DIR:'/synthetic/config'}]) {
    const f=fixture(),before=tree(f.root),setup=new SetupController({env:{...f.env,...extra}},()=>payload);
    const server=createProgressServer(undefined,'fixture-only',undefined,setup);
    try {
      assert.throws(()=>managedBindingFile({...f.env,...extra}));
      server.listen(0,'127.0.0.1');await once(server,'listening');
      const url=`http://127.0.0.1:${(server.address() as {port:number}).port}`,headers={authorization:'Bearer fixture-only'};
      const health=await(await fetch(`${url}/health`,{headers})).json();assert.equal(health.ready,false);
      const status=await(await fetch(`${url}/v1/setup`,{headers})).json();assert.equal(status.delivery.configuration,'invalid');
      assert.equal(status.configured,false);assert.deepEqual(tree(f.root),before);
    }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));setup.close();f.clean();}
  }
});

test('authenticated reviewed configuration creates only private managed state and preserves report protocol',async()=>{
  const f=fixture();try {await http(f,async request=>{
    const before=tree(f.root);
    assert.equal((await request('managed-inspect',{},false)).status,401);
    assert.equal((await request('managed-configure',{})).status,400);assert.deepEqual(tree(f.root),before);
    assert.equal((await request('managed-configure',{confirmed:true,expected:'a'.repeat(64)})).status,409);assert.deepEqual(tree(f.root),before);
    const inspected=await(await request('managed-inspect',{})).json() as SetupRead;
    const expected=inspected.delivery!.review!.expected;
    const result=await request('managed-configure',{confirmed:true,expected});assert.equal(result.status,200);
    const status=await result.json();assert.equal(status.configured,true);assert.equal(status.installed,false);assert.equal(status.separateLifecycle,false);
    assert.equal(status.delivery.configuration,'configured');assert.equal(status.delivery.mode,'unknown');assert.equal(status.delivery.observation,'not-observed');
    const b=readManagedBinding(f.env)!;assert.equal(b.source.dataRoot,f.roots.dataRoot);
    const file=managedBindingFile(f.env);
    for(const p of [path.dirname(file),f.storeRoot])assert.equal(lstatSync(p).mode&0o777,0o700);
    for(const p of [file,path.join(path.dirname(file),'.ownership.json'),b.database,managedExpectationFile(b)])assert.equal(lstatSync(p).mode&0o777,0o600);
    assert.equal(existsSync(path.join(f.roots.configRoot,'plugins')),false);
    assert.equal((await request('managed-configure',{confirmed:true,expected})).status,409,'duplicate old confirmation is stale');
    const store=new Store(b.database);
    try{store.apply({op:'start',plan:'P-managed',oid:'start',rev:0,title:'Retained report',items:[]},{sourceId:b.source.id,sessionId:'M',agent:'build',directory:'/fixture',parentId:null,ancestry:[],verifiedSource:true});}finally{store.close();}
    let r=await(await request('managed-inspect',{})).json();
    assert.equal((await request('managed-disable',{confirmed:true,expected:r.delivery.review.expected})).status,200);
    r=await(await request('managed-inspect',{})).json();assert.equal((await request('managed-enable',{confirmed:true,expected:r.delivery.review.expected})).status,200);
    const plans=await(await request('/v1/plans')).json();assert.equal(plans.storeId,b.storeId);assert.equal(plans.data[0].revision,1);
    assert.equal(plans.data[0].sourceId,b.source.id);
    assert.equal((await request('install',f.targets)).status,409,'production managed controller does not install global capture');
  });}finally{f.clean();}
});

test('retained source reuse is explicit; stale review cannot select, reset or overwrite history',async()=>{
  const f=fixture();const custom=path.join(f.root,'custom-store');mkdirSync(custom,{mode:0o700});
  const store=new Store(path.join(custom,'progress.sqlite'),{create:true});
  try {
    store.registerSource({id:'retained-source',...f.roots,verified:true});
    store.apply({op:'start',plan:'P-retained',oid:'start',rev:0,title:'Retained',items:[]},{sourceId:'retained-source',sessionId:'M',agent:'build',directory:'/fixture',parentId:null,ancestry:[],verifiedSource:true});
    assert.equal(f.setup.status().configured,false);assert.equal(review(f).storeId,null,'no store scan');
    const reviewed=review(f,custom);store.setEnabled(false);
    assert.throws(()=>f.setup.run('managed-configure',{storeRoot:custom,confirmed:true,expected:reviewed.expected}),/managed-review-stale/);
    assert.equal(readManagedBinding(f.env),undefined);assert.equal(store.list().captureEnabled,false);assert.equal(store.get('retained-source','P-retained')!.revision,1);
    const configured=configure(f,custom);assert.equal(configured.reportingIdentity!.sourceId,'retained-source');assert.equal(configured.reportingIdentity!.storeId,store.list().storeId);
    assert.equal(configured.captureEnabled,false,'configuration never silently re-enables retained capture');
    const other=path.join(f.root,'different-store');mkdirSync(other,{mode:0o700});
    assert.throws(()=>review(f,other),/managed-selection-conflict/);assert.equal(store.get('retained-source','P-retained')!.revision,1);
  }finally{store.close();f.clean();}
});

test('same-scope unverified retained source and unsupported SQLite schemas refuse before selection',()=>{
  for(const kind of ['unverified','schema'] as const) {
    const f=fixture();mkdirSync(f.storeRoot,{mode:0o700});const store=new Store(path.join(f.storeRoot,'progress.sqlite'),{create:true});
    try {
      store.registerSource({id:'retained-source',...f.roots,verified:kind!=='unverified'});
      if(kind==='schema')store.db.exec('PRAGMA user_version=999');
      assert.throws(()=>review(f),new RegExp(kind==='schema'?'schema':'managed-source-conflict'));
      assert.equal(readManagedBinding(f.env),undefined);assert.equal(existsSync(path.dirname(managedBindingFile(f.env))),false);
      assert.equal(store.db.prepare('SELECT count(*) AS n FROM sources').get()!.n,1);
    }finally{store.close();f.clean();}
  }
});

test('invalid directory, marker, descriptor and aliases fail closed without repair or fallback',async()=>{
  for(const kind of ['root-mode','marker-mode','marker-bytes','marker-missing','marker-link','descriptor-mode','descriptor-bytes','descriptor-link','descriptor-schema','root-link','source-alias','store-id','source-id','future-schema'] as const) {
    const f=fixture();try {
      configure(f);const file=managedBindingFile(f.env),root=path.dirname(file),marker=path.join(root,'.ownership.json');
      const b=readManagedBinding(f.env)!;
      if(kind==='root-mode')chmodSync(root,0o755);
      if(kind==='marker-mode')chmodSync(marker,0o644);
      if(kind==='marker-bytes')writeFileSync(marker,'foreign marker');
      if(kind==='marker-missing')rmSync(marker);
      if(kind==='marker-link'){renameSync(marker,marker+'.retained');symlinkSync(marker+'.retained',marker);}
      if(kind==='descriptor-mode')chmodSync(file,0o644);
      if(kind==='descriptor-bytes')writeFileSync(file,'not JSON');
      if(kind==='descriptor-schema')writeFileSync(file,JSON.stringify({...b,schemaVersion:999}));
      if(kind==='descriptor-link'){renameSync(file,file+'.retained');symlinkSync(file+'.retained',file);}
      if(kind==='root-link'){renameSync(root,root+'.retained');symlinkSync(root+'.retained',root);}
      if(kind==='source-alias'){const alias=path.join(f.root,'alias');symlinkSync(f.roots.configRoot,alias);writeFileSync(file,JSON.stringify({...b,source:{...b.source,configRoot:alias}}));}
      if(kind==='store-id')writeFileSync(file,JSON.stringify({...b,storeId:'other-store'}));
      if(kind==='source-id')writeFileSync(file,JSON.stringify({...b,source:{...b.source,id:'other-source'}}));
      if(kind==='future-schema'){const s=new Store(b.database);s.db.exec('PRAGMA user_version=999');s.close();}
      const before=tree(f.root);const status=f.setup.status();assert.equal(status.delivery!.configuration,'invalid',kind);assert.equal(status.captureEnabled,null,kind);
      assert.equal(f.setup.current().store,undefined,kind);assert.throws(()=>review(f),kind);
      const fresh=new SetupController({env:f.env},()=>payload);
      try{assert.equal(fresh.status().delivery!.configuration,'invalid',kind);assert.equal(fresh.current().store,undefined,kind);}finally{fresh.close();}
      await http(f,async request=>{
        const refused=await request('managed-configure',{confirmed:true,expected:'a'.repeat(64)});
        assert.ok(refused.status===409||refused.status===503,kind);
      });
      assert.deepEqual(tree(f.root),before,kind);
    }finally{f.clean();}
  }
});

test('changed valid descriptor and disappeared selection retire admitted service authority',()=>{
  const f=fixture();try {
    configure(f);const file=managedBindingFile(f.env),bytes=readFileSync(file),b=readManagedBinding(f.env)!;
    writeFileSync(file,JSON.stringify({...b,installId:'different-valid-identity'}));
    assert.equal(f.setup.current().store,undefined);assert.ok(f.setup.status().diagnostics.includes('managed-binding-modified'));
    writeFileSync(file,bytes);assert.ok(f.setup.current().store);
    rmSync(file);assert.equal(f.setup.status().delivery!.configuration,'invalid');
    assert.throws(()=>review(f),/managed-binding-modified/);assert.equal(existsSync(file),false);
  }finally{f.clean();}
});

test('foreign ownership is rejected for the directory, marker and descriptor (scoped stat injection)',t=>{
  const f=fixture(),original=fs.lstatSync;
  try {
    configure(f);const file=managedBindingFile(f.env);
    for(const selected of [path.dirname(file),path.join(path.dirname(file),'.ownership.json'),file,f.roots.configRoot,f.roots.dataRoot]) {
      const mock=t.mock.method(fs,'lstatSync',((file:any,...args:any[])=>{const stat=(original as any)(file,...args);if(String(file)===selected&&stat)stat.uid=typeof stat.uid==='bigint'?stat.uid+1n:stat.uid+1;return stat;}) as typeof fs.lstatSync);
      syncBuiltinESMExports();
      try{assert.throws(()=>readManagedBinding(f.env));assert.equal(f.setup.status().delivery!.configuration,'invalid');}
      finally{mock.mock.restore();syncBuiltinESMExports();}
    }
  }finally{f.clean();}
});

test('valid legacy installation is only a migration proposal, never auto-adopted or removed by configure',()=>{
  const f=fixture();try {
    lifecycle('install',f.targets,payload);const before=tree(f.root);
    assert.equal(f.setup.status().configured,false);
    const r=review(f);assert.equal(f.setup.run('managed-inspect',{}).delivery!.migration,'available');
    assert.throws(()=>f.setup.run('managed-configure',{confirmed:true,expected:r.expected}),/managed-migration-required/);
    assert.deepEqual(tree(f.root),before);assert.equal(readManagedBinding(f.env),undefined);
  }finally{f.clean();}
});

test('missing store never recreated by setup reads; unreadable expectation remains unknown without rewrite',()=>{
  const f=fixture();try {
    configure(f);const b=readManagedBinding(f.env)!,expectation=managedExpectationFile(b),original=readFileSync(expectation);
    writeFileSync(expectation,'invalid expectation');
    assert.equal(f.setup.status().delivery!.observation,'unknown');assert.equal(readFileSync(expectation,'utf8'),'invalid expectation');
    writeFileSync(expectation,original);const metadata=JSON.parse(original.toString());
    const store=new Store(b.database);store.observeLoaded(b.source.id,b.installId,metadata.fingerprint);store.close();
    assert.equal(f.setup.status().delivery!.observation,'matching');
    const changed=new Store(b.database);changed.observeLoaded(b.source.id,b.installId,'a'.repeat(64));changed.close();
    assert.equal(f.setup.status().delivery!.observation,'different');assert.ok(f.setup.current().store,'mismatch does not block reporting authority');
    const reporting=f.setup.current().store!;
    reporting.apply({op:'start',plan:'P-warning',oid:'start',rev:0,title:'Warning is not a block',items:[]},{sourceId:b.source.id,sessionId:'M',agent:'build',directory:'/fixture',parentId:null,ancestry:[],verifiedSource:true});
    assert.equal(reporting.get(b.source.id,'P-warning')!.revision,1);
    f.setup.close();renameSync(b.database,b.database+'.retained');
    const before=tree(f.root);assert.equal(f.setup.status().captureEnabled,null);assert.equal(existsSync(b.database),false);assert.deepEqual(tree(f.root),before);
  }finally{f.clean();}
});

test('two independently reviewed selections cannot overwrite the first durable selector',()=>{
  const f=fixture(),second=new SetupController({env:f.env},()=>payload);
  try {
    const first=review(f),other=second.run('managed-inspect',{}).delivery!.review!;
    f.setup.run('managed-configure',{confirmed:true,expected:first.expected});const file=managedBindingFile(f.env),bytes=readFileSync(file);
    assert.throws(()=>second.run('managed-configure',{confirmed:true,expected:other.expected}),/managed-review-stale/);
    assert.deepEqual(readFileSync(file),bytes);assert.equal(readdirSync(path.dirname(file)).includes('.configuration-lock'),false);
    assert.equal(second.status().reportingIdentity!.storeId,f.setup.status().reportingIdentity!.storeId);
  }finally{second.close();f.clean();}
});

test('a concurrent or crash-retained configuration lock refuses without takeover or store creation',async()=>{
  const f=fixture();try {
    const r=review(f),file=createManagedBindingDirectory(f.env),lock=path.join(path.dirname(file),'.configuration-lock');
    writeFileSync(lock,'synthetic retained lock',{mode:0o600,flag:'wx'});
    const before=tree(f.root);
    await http(f,async request=>{
      const refused=await request('managed-configure',{confirmed:true,expected:r.expected});
      assert.equal(refused.status,409);assert.deepEqual(await refused.json(),{error:'managed-configuration-busy'});
    });
    assert.deepEqual(tree(f.root),before);assert.equal(existsSync(f.storeRoot),false);assert.equal(existsSync(file),false);
  }finally{f.clean();}
});
