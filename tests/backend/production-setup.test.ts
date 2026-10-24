import{test}from'node:test';
import assert from'node:assert/strict';
import{mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,readdirSync,symlinkSync,existsSync}from'node:fs';
import{lifecycle,inspect,type Targets,type Payload}from'../../setup/lifecycle.ts';
import{Store}from'../../shared/store.ts';
import{readBinding}from'../../shared/binding.ts';

function fixture(){const root=mkdtempSync('/tmp/opencode/agent-progress-setup-');for(const n of ['配置 space','data'])mkdirSync(`${root}/${n}`,{mode:0o700});const targets:Targets={configRoot:`${root}/配置 space`,dataRoot:`${root}/data`,storeRoot:`${root}/store`,confirmed:true};return{root,targets,clean(){rmSync(root,{recursive:true,force:true});}};}
const payload:Payload={plugin:'export default {id:"test",setup:async()=>{}};',guidance:'Keep canonical planner.',removal:'// removal fixture',version:'0.2.0'};
test('QA4 dry-run writes nothing; unicode/custom roots; install/update and transactional disable/enable/removal retain history',()=>{
  const f=fixture();try{
    const foreign=`${f.targets.configRoot}/opencode.jsonc`;const bytes=Buffer.from('{ /* Unicode 🌱 */ "untouched":true }\n');writeFileSync(foreign,bytes);mkdirSync(`${f.targets.configRoot}/plugins`);writeFileSync(`${f.targets.configRoot}/plugins/foreign.js`,'foreign');
    const before=readdirSync(f.root);assert.equal(lifecycle('dry-run',f.targets).writes,false);assert.deepEqual(readdirSync(f.root),before);assert.equal(existsSync(f.targets.storeRoot),false);
    assert.throws(()=>lifecycle('install',{...f.targets,confirmed:false},payload),/confirmation-required/);
    lifecycle('install',f.targets,payload);const pkg=`${f.targets.configRoot}/plugins/agent-progress`;const b=readBinding(`${pkg}/progress-binding.json`);const loaded=new Store(b.database);
    const actor={sourceId:b.source.id,sessionId:'M',agent:'build',directory:'/fixture',parentId:null,ancestry:[],verifiedSource:true};
    loaded.apply({op:'start',plan:'P',oid:'start',rev:0,title:'Retained',items:[]},actor);
    lifecycle('disable',f.targets);assert.throws(()=>loaded.apply({op:'revise',plan:'P',oid:'disabled',rev:1,title:'No'},actor),/disabled/);
    lifecycle('enable',f.targets);loaded.apply({op:'revise',plan:'P',oid:'enabled',rev:1,title:'Yes'},actor);
    const first=JSON.parse(readFileSync(`${pkg}/.ownership.json`,'utf8'));lifecycle('update',f.targets,{...payload,plugin:payload.plugin+'\n// new',version:'0.3.0'});
    const second=JSON.parse(readFileSync(`${pkg}/.ownership.json`,'utf8'));assert.notEqual(second.active,first.active);assert.equal(Object.keys(second.releases).length,2);
    assert.equal(existsSync(`${f.targets.storeRoot}/payloads/${first.active}/index.js`),true);
    lifecycle('remove-capture',f.targets);assert.equal(existsSync(pkg),false);assert.equal(loaded.get(b.source.id,'P')!.revision,2);
    assert.throws(()=>loaded.apply({op:'revise',plan:'P',oid:'removed',rev:2,title:'No'},actor),/disabled/);loaded.close();
    assert.deepEqual(readFileSync(foreign),bytes);assert.equal(readFileSync(`${f.targets.configRoot}/plugins/foreign.js`,'utf8'),'foreign');assert.ok(readFileSync(`${f.targets.storeRoot}/installation-history.jsonl`,'utf8').includes('remove-capture'));
  }finally{f.clean();}
});
test('QA4 collisions, foreign/modified files and symlink escapes refuse; remove disables before preserving modified files',()=>{
  const f=fixture();try{
    mkdirSync(`${f.targets.configRoot}/plugins`);mkdirSync(`${f.targets.configRoot}/plugins/agent-progress`);writeFileSync(`${f.targets.configRoot}/plugins/agent-progress/foreign`,'bytes');
    assert.throws(()=>lifecycle('install',f.targets,payload),/collision/);assert.equal(readFileSync(`${f.targets.configRoot}/plugins/agent-progress/foreign`,'utf8'),'bytes');
    rmSync(`${f.targets.configRoot}/plugins/agent-progress`,{recursive:true});lifecycle('install',f.targets,payload);
    const pkg=`${f.targets.configRoot}/plugins/agent-progress`;writeFileSync(`${pkg}/index.js`,'user changed');
    assert.throws(()=>lifecycle('update',f.targets,payload),/modified-owned-files/);
    assert.throws(()=>lifecycle('remove-capture',f.targets),/modified-owned-files/);assert.equal(readFileSync(`${pkg}/index.js`,'utf8'),'user changed');
    const s=new Store(`${f.targets.storeRoot}/progress.sqlite`);assert.equal(s.list().captureEnabled,false);s.close();
    const alias=`${f.root}/alias`;symlinkSync(f.targets.configRoot,alias);assert.throws(()=>inspect({...f.targets,configRoot:alias}),/symlink-escape/);
  }finally{f.clean();}
});
test('QA4 interrupted activation preserves last runnable selection and distinguishes staged recovery',()=>{
  const f=fixture();try{
    lifecycle('install',f.targets,payload);const file=`${f.targets.configRoot}/plugins/agent-progress/.ownership.json`;const original=readFileSync(file);
    assert.throws(()=>lifecycle('update',f.targets,{...payload,plugin:'export default {new:true}',version:'0.3.0'},phase=>{if(phase==='before-activation')throw new Error('injected interruption');}),/injected/);
    assert.deepEqual(readFileSync(file),original);assert.equal(lifecycle('inspect',f.targets).installed,true);
    assert.ok(lifecycle('inspect',f.targets).diagnostics.includes('unreferenced-payloads-retained'));
    assert.throws(()=>lifecycle('update',f.targets,{...payload,plugin:'export default {newer:true}',version:'0.4.0'},phase=>{if(phase==='release-staged')throw new Error('injected interruption');}),/injected/);
    assert.ok(inspect(f.targets).recovery.stagedReleases>0);assert.deepEqual(readFileSync(file),original);
    lifecycle('update',f.targets,{...payload,plugin:'export default {new:true}',version:'0.3.0'});assert.notDeepEqual(readFileSync(file),original);
    assert.throws(()=>lifecycle('update',f.targets,{...payload,plugin:'export default {committed:true}',version:'0.5.0'},phase=>{if(phase==='after-activation')throw new Error('after-activation-before-reply');}),/after-activation/);
    const recovered=lifecycle('inspect',f.targets);assert.equal(recovered.version,'0.5.0');assert.ok(recovered.diagnostics.includes('rollback-payloads-retained'));
  }finally{f.clean();}
});
