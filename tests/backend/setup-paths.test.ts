import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs,{ mkdtempSync,mkdirSync,chmodSync,rmSync,statSync,readFileSync,writeFileSync,readdirSync,existsSync,symlinkSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { once } from 'node:events';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { lifecycle,type Targets } from '../../setup/lifecycle.ts';
import { SetupController } from '../../service/setup-controller.ts';
import { createProgressServer } from '../../service/server.ts';
import { readBinding } from '../../shared/binding.ts';

const payload={plugin:'export default {}',guidance:'Synthetic setup only',removal:'// fixture',version:'0.2.2'};

function fixture(storeMode=0o700,configMode=0o700) {
  const root=mkdtempSync('/tmp/opencode/agent-progress-paths-');
  const targets:Targets={configRoot:`${root}/config`,dataRoot:`${root}/data`,storeRoot:`${root}/store`,confirmed:true};
  for(const [dir,mode]of [[targets.configRoot,configMode],[targets.dataRoot,0o700],[targets.storeRoot,storeMode]] as const){mkdirSync(dir);chmodSync(dir,mode);}
  return {root,targets,clean(){rmSync(root,{recursive:true,force:true});}};
}
test('reported all-trailing-slash request reaches the intentional permissive-store diagnostic',()=>{
  const f=fixture(0o775,0o777);try {
    const input={...f.targets,configRoot:f.targets.configRoot+'/',dataRoot:f.targets.dataRoot+'/',storeRoot:f.targets.storeRoot+'/'};
    assert.throws(()=>lifecycle('inspect',input),{message:'store-permissions'});
  }finally{f.clean();}
});
test('minimal config trailing slash inspects the same absolute owned directory without writes',()=>{
  const f=fixture();try {
    const baseline=lifecycle('inspect',f.targets);assert.equal(baseline.writes,false);
    const trailing=lifecycle('inspect',{...f.targets,configRoot:f.targets.configRoot+'/'});
    assert.equal(trailing.writes,false);assert.deepEqual(trailing.targets,baseline.targets);
  }finally{f.clean();}
});
test('real HTTP slash inputs inspect/install/control using the same canonical source binding',async()=>{
  const f=fixture();const setup=new SetupController(`${f.root}/service-binding.json`,()=>payload);const server=createProgressServer(undefined,'fixture-only',undefined,setup);
  try {
    server.listen(0,'127.0.0.1');await once(server,'listening');const port=(server.address() as {port:number}).port;
    const input={...f.targets,configRoot:f.targets.configRoot+'/',dataRoot:f.targets.dataRoot+'/',storeRoot:f.targets.storeRoot+'/'};
    const post=(action:string)=>fetch(`http://127.0.0.1:${port}/v1/setup/${action}`,{method:'POST',headers:{authorization:'Bearer fixture-only','content-type':'application/json'},body:JSON.stringify(input)});
    const before=readdirSync(f.root);const checked=await post('inspect');assert.equal(checked.status,200);
    assert.deepEqual((await checked.json()).targets,{configRoot:f.targets.configRoot,dataRoot:f.targets.dataRoot,storeRoot:f.targets.storeRoot});assert.deepEqual(readdirSync(f.root),before);
    assert.equal((await post('install')).status,200);
    const b=readBinding(`${f.targets.configRoot}/plugins/agent-progress/progress-binding.json`);
    assert.equal(b.source.configRoot,f.targets.configRoot);assert.equal(b.source.dataRoot,f.targets.dataRoot);assert.equal(b.database,`${f.targets.storeRoot}/progress.sqlite`);
    assert.equal((await post('disable')).status,200);assert.equal((await post('enable')).status,200);
    assert.equal(input.configRoot.endsWith('/'),true,'normalization must not mutate caller input');
  }finally{if(server.listening)await new Promise<void>(resolve=>server.close(()=>resolve()));setup.close();f.clean();}
});
test('source setup CLI accepts all-three single/double trailing separators without inspect writes',()=>{
  const f=fixture();try {
    const before=readdirSync(f.root);
    for(const suffix of ['/','//']) {
      const args=Object.entries({config:f.targets.configRoot,data:f.targets.dataRoot,store:f.targets.storeRoot}).map(([key,value])=>`--${key}-root=${value}${suffix}`);
      const result=spawnSync(process.execPath,['--experimental-strip-types',path.resolve('setup/cli.ts'),'inspect',...args,'--confirm=true'],{encoding:'utf8',env:{HOME:f.root,PATH:'/usr/bin:/bin'},timeout:5000});
      assert.equal(result.status,0);const reply=JSON.parse(result.stdout);assert.deepEqual(reply.targets,f.targets);assert.equal(reply.writes,false);
      assert.deepEqual(readdirSync(f.root),before);
    }
  }finally{f.clean();}
});
test('permissive existing stores still refuse and retain modes/bytes; a new child is created private only on install',()=>{
  const f=fixture(0o775,0o777);try {
    const sentinel=`${f.targets.storeRoot}/keep`;writeFileSync(sentinel,'unchanged');
    for(const suffix of ['', '/']) {
      const input={...f.targets,storeRoot:f.targets.storeRoot+suffix};
      assert.throws(()=>lifecycle('install',input,payload),{message:'store-permissions'});
      assert.equal(statSync(f.targets.storeRoot).mode&0o777,0o775);assert.equal(readFileSync(sentinel,'utf8'),'unchanged');
    }
    const parent=`${f.root}/public-parent`;mkdirSync(parent);chmodSync(parent,0o755);
    const selected={...f.targets,storeRoot:`${parent}/new-private/`};
    assert.equal(lifecycle('dry-run',selected).writes,false);assert.equal(existsSync(`${parent}/new-private`),false);
    lifecycle('install',selected,payload);
    assert.equal(statSync(`${parent}/new-private`).mode&0o777,0o700);assert.equal(statSync(`${parent}/new-private/progress.sqlite`).mode&0o777,0o600);
    assert.equal(statSync(parent).mode&0o777,0o755);assert.equal(statSync(f.targets.configRoot).mode&0o777,0o777);assert.equal(statSync(f.targets.storeRoot).mode&0o777,0o775);
  }finally{f.clean();}
});
test('traversal, relative syntax, symlink aliases and foreign discovery collisions remain fail-closed',()=>{
  const f=fixture();try {
    for(const configRoot of ['relative/',`${f.targets.configRoot}/../config/`,`${f.targets.configRoot}/./`])assert.throws(()=>lifecycle('inspect',{...f.targets,configRoot}),{message:'path-unverified'});
    const alias=`${f.root}/alias`;symlinkSync(f.targets.configRoot,alias);
    assert.throws(()=>lifecycle('inspect',{...f.targets,configRoot:alias+'/'}),{message:'symlink-escape'});
    const pkg=`${f.targets.configRoot}/plugins/agent-progress`;mkdirSync(pkg,{recursive:true});writeFileSync(`${pkg}/foreign`,'keep');
    assert.throws(()=>lifecycle('install',{...f.targets,configRoot:f.targets.configRoot+'/'},payload),{message:'collision'});
    assert.equal(readFileSync(`${pkg}/foreign`,'utf8'),'keep');assert.equal(existsSync(`${f.targets.storeRoot}/progress.sqlite`),false);
  }finally{f.clean();}
});
test('foreign ownership metadata still refuses source roots and store writes (scoped stat injection, no chown)',t=>{
  const f=fixture();const original=fs.lstatSync;
  try {
    for(const key of ['configRoot','dataRoot','storeRoot'] as const) {
      const mock=t.mock.method(fs,'lstatSync',((file:any,...args:any[])=>{const stat=(original as any)(file,...args);if(String(file)===f.targets[key]&&stat)stat.uid=typeof stat.uid==='bigint'?stat.uid+1n:stat.uid+1;return stat;}) as typeof fs.lstatSync);
      syncBuiltinESMExports();
      try {
        if(key==='storeRoot')assert.throws(()=>lifecycle('install',f.targets,payload),{message:'binding'});
        else assert.throws(()=>lifecycle('inspect',f.targets),{message:'path-unverified'});
      }finally{mock.mock.restore();syncBuiltinESMExports();}
    }
    assert.equal(existsSync(`${f.targets.storeRoot}/progress.sqlite`),false);assert.equal(existsSync(`${f.targets.configRoot}/plugins`),false);
  }finally{f.clean();}
});
