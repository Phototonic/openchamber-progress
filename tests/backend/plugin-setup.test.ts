import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import plugin from '../../plugin/index.ts';
import { lifecycle } from '../../setup/lifecycle.ts';
import { Store } from '../../shared/store.ts';
import { SetupController } from '../../service/setup-controller.ts';

function fixture(){
  const root=fs.mkdtempSync('/tmp/opencode/agent-progress-plugin-setup-');
  for(const dir of ['config/opencode','data/opencode','project'])fs.mkdirSync(`${root}/${dir}`,{recursive:true,mode:0o700});
  lifecycle('install',{configRoot:`${root}/config/opencode`,dataRoot:`${root}/data/opencode`,storeRoot:`${root}/store`,confirmed:true},{plugin:'// fixture',guidance:'fixture',removal:'// fixture',version:'0.2.2'});
  const binding=`${root}/config/opencode/plugins/agent-progress/progress-binding.json`;
  const saved=new Map<string,string|undefined>();
  for(const [key,value] of Object.entries({AGENT_PROGRESS_BINDING:binding,XDG_CONFIG_HOME:`${root}/config`,XDG_DATA_HOME:`${root}/data`,OPENCODE_DB:undefined,OPENCODE_CONFIG_DIR:undefined})){
    saved.set(key,process.env[key]);if(value===undefined)delete process.env[key];else process.env[key]=value;
  }
  const fds=()=>fs.readdirSync('/proc/self/fd').filter(fd=>{try{return fs.readlinkSync(`/proc/self/fd/${fd}`)===`${root}/store/progress.sqlite`;}catch{return false;}}).length;
  return {root,binding,fds,cleanup(){for(const[key,value]of saved){if(value===undefined)delete process.env[key];else process.env[key]=value;}fs.rmSync(root,{recursive:true,force:true});}};
}

test('failed setup closes the opened store at verification and each later boundary',async t=>{
  for(const stage of ['verify','bindReads','skill','tool','tool-hook','context-hook','rpc','activation','hook-dispose-error','close-error'])await t.test(stage,async t=>{
    const f=fixture();const sentinel=new Error('synthetic setup failure');const secondary=new Error('synthetic close failure');
    const opened=new Set<Store>();let closeCalls=0;const reached:string[]=[];
    const originalList=Store.prototype.list;const originalClose=Store.prototype.close;
    t.mock.method(Store.prototype,'list',function(this:Store,...args:Parameters<Store['list']>){opened.add(this);return originalList.apply(this,args);});
    t.mock.method(Store.prototype,'close',function(this:Store){closeCalls++;originalClose.call(this);if(stage==='close-error')throw secondary;});
    if(stage==='verify'){const b=JSON.parse(fs.readFileSync(f.binding,'utf8'));b.storeId='mismatched-fixture-store';fs.writeFileSync(f.binding,JSON.stringify(b));}
    if(stage==='bindReads')t.mock.method(Store.prototype,'bindReads',()=>{throw sentinel;});
    if(stage==='activation')t.mock.method(Store.prototype,'observeLoaded',()=>{throw sentinel;});
    const hook=(name:string)=>async()=>{reached.push(name);if(stage===name)throw sentinel;return{dispose:async()=>{reached.push(`dispose-${name}`);if(stage==='hook-dispose-error')throw secondary;}};};
    const ctx:any={session:{hook:hook('context-hook')},skill:{transform:async()=>{reached.push('skill');if(stage==='skill')throw sentinel;}},tool:{hook:hook('tool-hook'),transform:async()=>{reached.push('tool');if(stage==='tool'||stage==='close-error')throw sentinel;}},rpc:{register:async()=>{reached.push('rpc');if(stage==='rpc'||stage==='hook-dispose-error')throw sentinel;}}};
    try{
      assert.equal(f.fds(),0);
      await assert.rejects(()=>plugin.setup(ctx) as Promise<unknown>,e=>stage==='verify'?(e as any).code==='binding':e===sentinel,'original setup exception must be preserved');
      assert.equal(f.fds(),0,'failed setup leaked a real SQLite descriptor');
      assert.equal(closeCalls,1,'exactly one setup-failure close');
      if(stage==='tool')assert.deepEqual(reached,['skill','tool'],'failure follows partial successful registration');
      if(stage==='context-hook')assert.deepEqual(reached,['skill','tool','tool-hook','context-hook','dispose-tool-hook']);
      if(stage==='rpc'||stage==='activation'||stage==='hook-dispose-error'){
        assert.ok(reached.indexOf('rpc')>reached.indexOf('context-hook'));
        assert.equal(reached.filter(x=>x==='dispose-tool-hook').length,reached.filter(x=>x==='tool-hook').length,'every successful hook registration is disposed, including delegation hooks');
        assert.equal(reached.filter(x=>x==='dispose-context-hook').length,1);
      }
    }finally{for(const s of opened){try{originalClose.call(s);}catch{}}f.cleanup();}
  });
});

test('successful setup retains its store for reports and closes on successful disposal',async()=>{
  const f=fixture();let execute:any;let skill:any;let status:any;
  const ctx:any={
    session:{hook:async()=>({dispose:async()=>{}}),get:async({sessionID}:{sessionID:string})=>({id:sessionID,location:{directory:`${f.root}/project`},agent:'synthetic',projectID:'project_fixture'})},
    skill:{transform:async(callback:any)=>callback({add:(value:any)=>{skill=value;}})},
    tool:{hook:async()=>({dispose:async()=>{}}),transform:async(callback:any)=>callback({namespace:()=>{},add:(value:any)=>{execute=value.execute;}}),list:async()=>[{id:'agent_progress_report',options:{codemode:false}}]},
    rpc:{register:async(_contract:any,handlers:any)=>{status=handlers.inspect;}},
  };
  try{
    const dispose=await plugin.setup(ctx);assert.equal(f.fds(),1);assert.equal(typeof dispose,'function');
    assert.equal(skill.id,'agent-progress');assert.equal(skill.name,'Agent progress');assert.ok(skill.path.endsWith('/plugin/SKILL.md'));
    assert.equal((await status()).toolAvailable,true);
    const reply=await execute({op:'start',plan:'setup-success',oid:'start',rev:0,title:'Synthetic',items:[{id:'a',title:'Task',kind:'task'}]},{sessionID:'ses_fixture',agent:'synthetic'});
    assert.equal(JSON.parse(reply.content).rev,1);assert.equal(f.fds(),1);
    const recorded=await execute({op:'read',plan:'setup-success'},{sessionID:'ses_fixture',agent:'synthetic'});
    assert.equal(JSON.parse(recorded.content).rev,1);
    const observer=new SetupController(f.binding,()=>({plugin:'// fixture',guidance:'fixture',removal:'// fixture',version:'0.2.2'}));
    try{const binding=JSON.parse(fs.readFileSync(f.binding,'utf8'));assert.deepEqual(observer.status().reportingIdentity,{storeId:binding.storeId,sourceId:binding.source.id,verified:true});}finally{observer.close();}
    await dispose!();assert.equal(f.fds(),0);
  }finally{f.cleanup();}
});
