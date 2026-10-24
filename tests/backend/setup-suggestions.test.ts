import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import { once } from 'node:events';
import { spawn,spawnSync } from 'node:child_process';
import { createServer as createNetServer } from 'node:net';
import { SetupController } from '../../service/setup-controller.ts';
import { createProgressServer } from '../../service/server.ts';
import type { HostPathContext } from '../../service/suggestions.ts';

const payload={plugin:'export default {id:"fixture",setup(){}}',guidance:'Synthetic fixture',removal:'// unused fixture',version:'0.2.2'};
function fixture(){
  const root=fs.mkdtempSync('/tmp/opencode/agent-progress-suggestions-');
  for(const dir of ['home/.config/opencode','home/.local/share/opencode','custom-config/opencode','custom-data/opencode','selector'])fs.mkdirSync(`${root}/${dir}`,{recursive:true,mode:0o700});
  const context:HostPathContext={platform:'linux',env:{HOME:`${root}/home`},uid:process.getuid?.()};
  const config=`${root}/home/.config/opencode`,data=`${root}/home/.local/share/opencode`;
  fs.writeFileSync(`${config}/unrelated-fixture`,'preserve synthetic bytes',{mode:0o600});
  return {root,config,data,context,cleanup(){fs.rmSync(root,{recursive:true,force:true});}};
}
/** Snapshot only this fixture, never follow symlinks; mtime/bytes preservation is contractual here. */
function snapshot(root:string){
  const result:Record<string,unknown>={};
  function walk(file:string){const stat=fs.lstatSync(file,{bigint:true});result[path.relative(root,file)]={mode:String(stat.mode),uid:String(stat.uid),mtimeNs:String(stat.mtimeNs),size:String(stat.size),...(stat.isFile()?{hash:createHash('sha256').update(fs.readFileSync(file)).digest('hex')}:{}),...(stat.isSymbolicLink()?{link:fs.readlinkSync(file)}:{})};if(stat.isDirectory())for(const name of fs.readdirSync(file).sort())walk(path.join(file,name));}
  walk(root);return result;
}
async function serve(f:ReturnType<typeof fixture>,run:(request:(route:string,body?:unknown)=>Promise<Response>,setup:SetupController)=>Promise<void>){
  const setup=new SetupController(`${f.root}/selector/binding.json`,()=>payload,undefined,f.context);
  const server=createProgressServer(undefined,'synthetic-suggestions-only',undefined,setup);
  try{server.listen(0,'127.0.0.1');await once(server,'listening');const port=(server.address() as any).port;
    const request=(route:string,body?:unknown)=>fetch(`http://127.0.0.1:${port}${route}`,{headers:{authorization:'Bearer synthetic-suggestions-only','content-type':'application/json'},...(body===undefined?{}:{method:'POST',body:JSON.stringify(body)})});
    await run(request,setup);
  }finally{if(server.listening)await new Promise<void>(resolve=>server.close(()=>resolve()));setup.close();}
}
const targets=(configRoot:string,dataRoot:string,storeRoot=`${dataRoot}/openchamber-progress`)=>({configRoot,dataRoot,storeRoot,confirmed:false});
function unverified(reply:any){assert.equal(reply.configured,false);assert.equal(reply.verified,false);assert.equal(reply.targets,null);assert.equal(Object.hasOwn(reply,'sourceBinding'),false);}

test('QA8 HOME defaults are observed only as folder suggestions; GET and inspect preserve target trees',async()=>{
  const f=fixture();try{const before=snapshot(f.root);await serve(f,async request=>{
    const response=await request('/v1/setup');assert.equal(response.status,200);const reply=await response.json();unverified(reply);
    assert.deepEqual(reply.suggestions,{configRoot:{value:f.config,state:'resolved'},dataRoot:{value:f.data,state:'resolved'},storeRoot:{value:`${f.data}/openchamber-progress`,state:'resolved'}});
    for(const suffix of ['/','//']){
      const inspected=await request('/v1/setup/inspect',targets(f.config+suffix,f.data+suffix,`${f.data}/openchamber-progress${suffix}`));assert.equal(inspected.status,200);
      const review=await inspected.json();assert.equal(review.verified,false);assert.equal(Object.hasOwn(review,'suggestions'),false);assert.deepEqual(review.targets,{configRoot:f.config,dataRoot:f.data,storeRoot:`${f.data}/openchamber-progress`});
    }
    assert.equal((await(await request('/v1/setup')).json()).configured,false,'inspection must not bind suggestions');
    const refused=await request('/v1/setup/install',targets(f.config,f.data));assert.equal(refused.status,400,'confirmation remains mandatory');assert.equal((await refused.json()).error,'confirmation-required');
    assert.equal((await request('/v1/setup?HOME=/untrusted')).status,404,'no guest-controlled discovery input');
  });assert.deepEqual(snapshot(f.root),before);}finally{f.cleanup();}
});

test('QA8 absolute custom XDG wins; missing roots stay candidates and missing hints stay null',async t=>{
  for(const scenario of ['custom','missing-roots','unknown','partial','invalid-override','unsupported'] as const)await t.test(scenario,async()=>{
    const f=fixture();try{
      if(scenario==='custom')f.context.env={HOME:f.context.env.HOME,XDG_CONFIG_HOME:`${f.root}/custom-config/`,XDG_DATA_HOME:`${f.root}/custom-data`};
      if(scenario==='missing-roots')f.context.env={HOME:`${f.root}/missing-home`};
      if(scenario==='unknown')f.context.env={};
      if(scenario==='partial')f.context.env={XDG_CONFIG_HOME:`${f.root}/custom-config`};
      if(scenario==='invalid-override')f.context.env={HOME:f.context.env.HOME,XDG_CONFIG_HOME:'relative',XDG_DATA_HOME:`${f.root}/custom-data/../custom-data`};
      if(scenario==='unsupported')f.context.platform='darwin';
      const before=snapshot(f.root);await serve(f,async request=>{
        const response=await request('/v1/setup');assert.equal(response.status,200);const reply=await response.json();unverified(reply);
        if(scenario==='unsupported')assert.equal(Object.hasOwn(reply,'suggestions'),false);
        else if(scenario==='unknown'||scenario==='invalid-override')assert.deepEqual(reply.suggestions,{configRoot:null,dataRoot:null,storeRoot:null});
        else if(scenario==='partial'){assert.deepEqual(reply.suggestions.configRoot,{value:`${f.root}/custom-config/opencode`,state:'resolved'});assert.equal(reply.suggestions.dataRoot,null);assert.equal(reply.suggestions.storeRoot,null);}
        else {const config=scenario==='custom'?`${f.root}/custom-config/opencode`:`${f.root}/missing-home/.config/opencode`;const data=scenario==='custom'?`${f.root}/custom-data/opencode`:`${f.root}/missing-home/.local/share/opencode`;const state=scenario==='custom'?'resolved':'candidate';assert.deepEqual(reply.suggestions,{configRoot:{value:config,state},dataRoot:{value:data,state},storeRoot:{value:`${data}/openchamber-progress`,state}});}
      });assert.deepEqual(snapshot(f.root),before);
    }finally{f.cleanup();}
  });
});

test('QA8 alias and foreign-owner candidates are never resolved and inspect still refuses',async t=>{
  for(const scenario of ['symlink-root','symlink-parent','foreign-uid','file'] as const)await t.test(scenario,async t=>{
    const f=fixture();let restore=()=>{};try{
      if(scenario==='symlink-root'){fs.rmSync(f.config,{recursive:true});fs.symlinkSync(`${f.root}/custom-config/opencode`,f.config);}
      if(scenario==='symlink-parent'){fs.symlinkSync(`${f.root}/custom-config`,`${f.root}/alias`);f.context.env.XDG_CONFIG_HOME=`${f.root}/alias`;}
      if(scenario==='file'){fs.rmSync(f.config,{recursive:true});fs.writeFileSync(f.config,'not a directory');}
      if(scenario==='foreign-uid'){
        const original=fs.lstatSync;const mock=t.mock.method(fs,'lstatSync',((file:any,...args:any[])=>{const stat=(original as any)(file,...args);if(String(file)===f.config&&!args.length)stat.uid=stat.uid+1;return stat;}) as typeof fs.lstatSync);syncBuiltinESMExports();restore=()=>{mock.mock.restore();syncBuiltinESMExports();};
      }
      const before=snapshot(f.root);await serve(f,async request=>{
        const reply=await(await request('/v1/setup')).json();unverified(reply);assert.equal(reply.suggestions.configRoot.state,'candidate');
        const inspected=await request('/v1/setup/inspect',targets(reply.suggestions.configRoot.value,f.data));assert.equal(inspected.status,409);
        const error=await inspected.json();assert.equal(error.error,scenario.startsWith('symlink')?'symlink-escape':'path-unverified');
      });assert.deepEqual(snapshot(f.root),before);
    }finally{restore();f.cleanup();}
  });
});

test('QA8 derivation never inspects store contents or reads files; existing permissive store stays unchanged',async t=>{
  const f=fixture();try{
    fs.mkdirSync(`${f.data}/openchamber-progress`,{mode:0o700});fs.chmodSync(`${f.data}/openchamber-progress`,0o775);
    const before=snapshot(f.root);await serve(f,async request=>{
      const reads:string[]=[];const probes:string[]=[];const read=fs.readFileSync,stat=fs.lstatSync,real=fs.realpathSync;
      const a=t.mock.method(fs,'readFileSync',((file:any,...args:any[])=>{reads.push(String(file));return(read as any)(file,...args);}) as typeof read);
      const b=t.mock.method(fs,'lstatSync',((file:any,...args:any[])=>{probes.push(String(file));return(stat as any)(file,...args);}) as typeof stat);
      const c=t.mock.method(fs,'realpathSync',((file:any,...args:any[])=>{probes.push(String(file));return(real as any)(file,...args);}) as typeof real);syncBuiltinESMExports();
      let reply:any;try{reply=await(await request('/v1/setup')).json();}finally{a.mock.restore();b.mock.restore();c.mock.restore();syncBuiltinESMExports();}
      assert.deepEqual(reads,[]);assert.ok(probes.length>0&&probes.every(p=>p===f.config||p===f.data),'probe only candidate roots, never child store/config/auth contents');
      assert.equal(reply.suggestions.storeRoot.state,'resolved','store state describes data provenance, not child suitability');
      const refused=await request('/v1/setup/inspect',targets(f.config,f.data));assert.equal(refused.status,409);assert.equal((await refused.json()).error,'store-permissions');
    });assert.deepEqual(snapshot(f.root),before);
  }finally{f.cleanup();}
});

test('QA8 configured target binding wins; suggestions absent from configured and POST replies',async()=>{
  const f=fixture();try{await serve(f,async(request,setup)=>{
    const selected={...targets(f.config+'//',f.data+'//',`${f.data}/openchamber-progress//`),confirmed:true};
    const installed=await request('/v1/setup/install',selected);assert.equal(installed.status,200);
    assert.equal(Object.hasOwn(await installed.json(),'suggestions'),false);
    assert.equal((await request('/v1/setup/disable',selected)).status,200);assert.equal((await request('/v1/setup/enable',selected)).status,200);
    const before=snapshot(f.root);const reply=await(await request('/v1/setup')).json();assert.equal(reply.configured,true);assert.equal(Object.hasOwn(reply,'suggestions'),false);
    assert.deepEqual(reply.targets,{configRoot:f.config,dataRoot:f.data,storeRoot:`${f.data}/openchamber-progress`});assert.equal(setup.current().configured,true);
    const inspected=await request('/v1/setup/inspect',{...targets(f.config,f.data),confirmed:true});assert.equal(inspected.status,200);assert.equal(Object.hasOwn(await inspected.json(),'suggestions'),false);
    assert.deepEqual(snapshot(f.root),before);
    const database=`${f.data}/openchamber-progress/progress.sqlite`;fs.writeFileSync(database,'synthetic corruption');const corruptBefore=snapshot(f.root);
    const unavailable=await(await request('/v1/setup')).json();assert.equal(unavailable.configured,true);assert.equal(unavailable.captureEnabled,null);assert.equal(Object.hasOwn(unavailable,'suggestions'),false,'unavailable configured store must not fall back to hints');
    assert.deepEqual(snapshot(f.root),corruptBefore);
  });}finally{f.cleanup();}
});

test('QA8 compiled service main uses only the fresh host HOME hints, not project/cwd', {timeout:15000},async()=>{
  const f=fixture();let child:ReturnType<typeof spawn>|undefined;try{
    const builtFixture=process.env.AGENT_PROGRESS_T7_SERVICE_FIXTURE;
    if(builtFixture)fs.copyFileSync(builtFixture,`${f.root}/main.js`);
    else assert.equal(spawnSync('bun',['build','service/main.ts','--target=node','--format=esm',`--outfile=${f.root}/main.js`],{stdio:'ignore'}).status,0);
    const reservation=createNetServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');const port=(reservation.address() as any).port;await new Promise<void>(resolve=>reservation.close(()=>resolve()));
    const before=snapshot(f.root);let failed=false;
    child=spawn(process.execPath,[`${f.root}/main.js`],{cwd:`${f.root}/custom-config`,env:{PATH:'/usr/bin:/bin',HOME:`${f.root}/home`,OPENCHAMBER_SERVICE_PORT:String(port),OPENCHAMBER_SERVICE_TOKEN:'synthetic-compiled-service-only',AGENT_PROGRESS_BINDING:`${f.root}/selector/binding.json`},stdio:'ignore'});child.once('error',()=>{failed=true;});
    let reply:any;const end=Date.now()+5000;
    while(Date.now()<end){assert.equal(failed,false);assert.equal(child.exitCode,null);try{const r=await fetch(`http://127.0.0.1:${port}/v1/setup`,{headers:{authorization:'Bearer synthetic-compiled-service-only'},signal:AbortSignal.timeout(500)});if(r.ok){reply=await r.json();break;}}catch{}await new Promise(resolve=>setTimeout(resolve,25));}
    assert.ok(reply,'compiled service readiness');unverified(reply);
    assert.deepEqual(reply.suggestions,{configRoot:{value:f.config,state:'resolved'},dataRoot:{value:f.data,state:'resolved'},storeRoot:{value:`${f.data}/openchamber-progress`,state:'resolved'}});
    assert.deepEqual(snapshot(f.root),before);
  }finally{
    if(child&&child.exitCode===null&&!child.signalCode){const exit=once(child,'exit');child.kill('SIGTERM');const timer=setTimeout(()=>child?.kill('SIGKILL'),3000);try{await exit;}finally{clearTimeout(timer);}}
    f.cleanup();
  }
});
