import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {syncBuiltinESMExports} from 'node:module';
import {PlatformError} from '../../shared/platform.ts';
import plugin from '../../plugin/index.ts';
import {SetupController} from '../../service/setup-controller.ts';
import {readManagedBinding,managedBindingFile} from '../../shared/managed-binding.ts';
import {Store} from '../../shared/store.ts';
import {RELEASE} from '../../shared/release.ts';
import {isolatedEnvironment} from '../fixtures/managed.ts';

const payload={plugin:'// different bytes at the same release',guidance:'Synthetic',removal:'// removal',version:RELEASE};
const deferred=()=>{let resolve!:()=>void;const promise=new Promise<void>(r=>resolve=r);return {promise,resolve};};
function fixture(){
  const root=fs.mkdtempSync('/tmp/opencode/managed-lifecycle-');
  const env=isolatedEnvironment(root);
  for(const dir of ['home','config/opencode','data/opencode','project','state','cache'])fs.mkdirSync(`${root}/${dir}`,{recursive:true,mode:0o700});
  const saved=new Map<string,string|undefined>();
  for(const [k,v]of Object.entries({...env,AGENT_PROGRESS_BINDING:'/synthetic/ignored.json',OPENCODE_DB:undefined,OPENCODE_CONFIG_DIR:undefined})){saved.set(k,process.env[k]);if(v===undefined)delete process.env[k];else process.env[k]=v;}
  const setup=new SetupController({env},()=>payload);
  const hooks=new Map<string,Set<any>>();let execute:any,skillCount=0;
  const hook=async(name:string,fn:any)=>{let set=hooks.get(name);if(!set)hooks.set(name,set=new Set());set.add(fn);return {dispose:async()=>{set.delete(fn);}};};
  const ctx:any={
    session:{hook,get:async({sessionID}:any)=>({id:sessionID,agent:'build',location:{directory:`${root}/project`},projectID:'project_fixture'})},
    skill:{transform:async(fn:any)=>fn({add:()=>{skillCount++;}})},
    tool:{hook,transform:async(fn:any)=>fn({namespace:()=>{},add:(tool:any)=>{execute=tool.execute;}}),list:async()=>[{id:'agent_progress_report',options:{codemode:false}}]},
    rpc:{register:async()=>{}},permission:{assert:async()=>{}},
  };
  function configure(){const review=setup.run('managed-inspect',{}).delivery!.review!;return setup.run('managed-configure',{confirmed:true,expected:review.expected});}
  return {root,env,setup,ctx,configure,hooks,get skillCount(){return skillCount;},
    report:(input:any)=>execute(input,{sessionID:'ses_fixture',agent:'build',messageID:'msg_fixture',id:'call_fixture'}).then((r:any)=>JSON.parse(r.content)),
    async context(tools:any={agent_progress_report:{}}){const event:any={sessionID:'ses_fixture',system:[],tools};for(const fn of [...(hooks.get('context')??[])])await fn(event);return event;},
    cleanup(){setup.close();for(const[k,v]of saved){if(v===undefined)delete process.env[k];else process.env[k]=v;}fs.rmSync(root,{recursive:true,force:true});},
  };
}
const start=(plan='P-managed')=>({op:'start',plan,oid:'start',rev:0,title:'Synthetic',items:[{id:'work',kind:'task',title:'Work'}]});

test('configure keeps its primary failure when Store and lock cleanup also fail',t=>{
  const f=fixture(),link=fs.linkSync,unlink=fs.unlinkSync,close=Store.prototype.close;let failed=false;
  try{
    t.mock.method(fs,'linkSync',((from:any,to:any)=>{
      if(path.basename(String(to)).startsWith('managed-expectation-')){failed=true;throw new PlatformError('private-permissions');}
      return link(from,to);
    })as typeof fs.linkSync);
    t.mock.method(Store.prototype,'close',function(this:Store){close.call(this);if(failed)throw new Error('Synthetic close failure');});
    t.mock.method(fs,'unlinkSync',((file:any)=>{if(path.basename(String(file))==='.configuration-lock')throw new Error('Synthetic lock cleanup failure');return unlink(file);})as typeof fs.unlinkSync);
    syncBuiltinESMExports();
    assert.throws(()=>f.configure(),/private-permissions/);
    assert.equal(fs.existsSync(path.join(path.dirname(managedBindingFile(f.env)),'.configuration-lock')),true);
  }finally{t.mock.restoreAll();syncBuiltinESMExports();f.cleanup();}
});

test('dormant registration creates nothing, activates once at the next context, preserves restricted tools and warns only on bytes',async()=>{
  const f=fixture();let dispose:any;
  try{
    dispose=await plugin.setup(f.ctx);
    assert.equal(fs.existsSync(managedBindingFile(f.env)),false);assert.equal(f.skillCount,0);
    assert.equal((await f.report(start())).error,'binding');assert.equal((await f.context()).system.length,0);
    f.configure();
    const [a,b]=await Promise.all([f.context(),f.context()]);assert.equal(f.skillCount,1);
    assert.equal(a.system.length,1);assert.equal(b.system.length,1);
    assert.equal((await f.context({})).system.length,0,'restricted session tools are never expanded');
    const state=f.setup.status();assert.equal(state.delivery!.observation,'different');assert.equal(state.version,RELEASE);
    assert.equal((await f.report(start())).rev,1,'same-version mismatching bytes do not block reports');
    const binding=readManagedBinding(f.env)!,store=new Store(binding.database);
    try{assert.equal(store.get(binding.source.id,'P-managed')!.revision,1);}finally{store.close();}
    await dispose();dispose=undefined;
    assert.equal((await f.report(start('P-retired'))).error,'storage');
    assert.equal(f.hooks.get('context')!.size,0);
  }finally{await dispose?.();f.cleanup();}
});

test('retirement before a held document permission completes prevents late report and capture',async()=>{
  const f=fixture(),held=deferred(),entered=deferred();let dispose:any;
  try{
    f.configure();fs.writeFileSync(`${f.root}/project/plan.md`,'# Synthetic plan');
    f.ctx.permission.assert=async()=>{entered.resolve();await held.promise;};
    dispose=await plugin.setup(f.ctx);
    const work=f.report({...start(),source:'plan.md'});await entered.promise;
    const closing=dispose();dispose=undefined;held.resolve();
    assert.equal((await work).error,'storage');await closing;
    const b=readManagedBinding(f.env)!,store=new Store(b.database);
    try{assert.equal(store.get(b.source.id,'P-managed'),undefined);assert.equal(store.db.prepare('SELECT count(*) n FROM captures').get()!.n,0);}finally{store.close();}
  }finally{held.resolve();await dispose?.();f.cleanup();}
});

test('disposal while deferred initialization awaits registration cannot publish loaded observation or report',async()=>{
  const f=fixture(),held=deferred(),entered=deferred();let dispose:any;
  try{
    dispose=await plugin.setup(f.ctx);f.configure();
    f.ctx.skill.transform=async()=>{entered.resolve();await held.promise;};
    const work=f.report(start());await entered.promise;
    const closing=dispose();dispose=undefined;held.resolve();
    assert.equal((await work).error,'storage');await closing;
    const b=readManagedBinding(f.env)!,store=new Store(b.database);
    try{assert.equal(store.loadedFingerprint(b.source.id,b.installId),null);assert.equal(store.get(b.source.id,'P-managed'),undefined);}finally{store.close();}
  }finally{held.resolve();await dispose?.();f.cleanup();}
});

test('a changed descriptor retires pinned runtime identity instead of switching writers',async()=>{
  const f=fixture();let dispose:any;
  try{
    f.configure();dispose=await plugin.setup(f.ctx);const file=managedBindingFile(f.env),b=readManagedBinding(f.env)!;
    fs.writeFileSync(file,JSON.stringify({...b,installId:'different-generation'}));
    assert.equal((await f.report(start())).error,'binding');
    fs.writeFileSync(file,JSON.stringify(b));
    assert.equal((await f.report(start())).error,'storage','restoring the file does not resurrect a retired runtime');
  }finally{await dispose?.();f.cleanup();}
});

test('report authority retires before slow hook teardown closes the Store',async()=>{
  const f=fixture(),held=deferred(),entered=deferred();let dispose:any;
  const hook=f.ctx.tool.hook;
  f.ctx.tool.hook=async(name:string,fn:any)=>{const registered=await hook(name,fn);return {dispose:async()=>{entered.resolve();await held.promise;await registered.dispose();}};};
  try{
    f.configure();dispose=await plugin.setup(f.ctx);
    const closing=dispose();dispose=undefined;await entered.promise;
    assert.equal((await f.report(start())).error,'storage');
    const b=readManagedBinding(f.env)!,store=new Store(b.database);
    try{assert.equal(store.get(b.source.id,'P-managed'),undefined);}finally{store.close();}
    held.resolve();await closing;
  }finally{held.resolve();await dispose?.();f.cleanup();}
});

test('a canonical legacy package never becomes managed authority merely because the Store matches',async()=>{
  const f=fixture();
  try{
    f.configure();fs.mkdirSync(`${f.root}/config/opencode/plugins/agent-progress`,{recursive:true,mode:0o700});
    await assert.rejects(()=>plugin.setup(f.ctx)as Promise<unknown>,(e:any)=>e.code==='binding');
    assert.equal(f.skillCount,0);assert.equal(f.hooks.get('context')!.size,0);
    assert.ok(fs.existsSync(`${f.root}/config/opencode/plugins/agent-progress`),'presence never authorizes removal');
  }finally{f.cleanup();}
});
