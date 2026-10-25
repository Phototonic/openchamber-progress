/** Actual packaged companion/tool, synthetic SDK caller metadata; no model/runtime. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { P1 } from '../tests/fixtures/production.ts';
import { Store, digest } from '../shared/store.ts';

const root=path.resolve(process.argv[2]);
const entry=path.join(process.env.XDG_CONFIG_HOME!,'opencode/plugins/agent-progress/index.js');
const binding=JSON.parse(readFileSync(path.join(path.dirname(entry),'progress-binding.json'),'utf8'));
let tool:any;let skill:any;let rpc:any;
const ctx={
  session:{hook:async()=>({dispose:async()=>{}}),get:async({sessionID}:{sessionID:string})=>({id:sessionID,agent:sessionID==='M'?'build':'general',location:{directory:root},projectID:'fixture',parentID:sessionID==='C1'?'M':null})},
  permission:{assert:async()=>{}},
  skill:{transform:async(fn:any)=>fn({add:(value:any)=>{skill=value;}})},
  tool:{hook:async()=>({dispose:async()=>{}}),transform:async(fn:any)=>fn({namespace:()=>{},add:(value:any)=>{tool=value;}}),list:async()=>[{id:'agent_progress_report',options:tool.options}]},
  rpc:{register:async(_definition:any,handlers:any)=>{rpc=handlers;}},
};
const plugin=(await import(pathToFileURL(entry).href)).default;
const cleanup=await plugin.setup(ctx);
try {
  assert.equal(tool.options.codemode,false);assert.match(skill.content,/canonical planner/);
  const status=await rpc.inspect();assert.equal(status.version,process.argv[3]);assert.equal(status.protocolVersion,2);assert.equal(status.toolAvailable,true);
  const document=path.join(root,'canonical.md');writeFileSync(document,'# Canonical planner\n\nПривет 🌱\n');const original=digest(readFileSync(document));
  async function report(request:unknown,sessionID='M') {
    const receipt=JSON.parse((await tool.execute(request,{sessionID,agent:sessionID==='M'?'build':'general',messageID:'fixture-message',id:'fixture-tool'})).content);
    assert.equal(receipt.error,undefined,JSON.stringify(receipt));return receipt;
  }
  await report({op:'start',plan:'packaged',oid:'start',rev:0,title:'Canonical workflow',items:P1,source:document});
  await report({op:'link',plan:'packaged',oid:'link',rev:1,child:'C1',assign:['I3']});
  await report({op:'change',plan:'packaged',oid:'child',rev:2,changes:[{id:'I3',status:'done'}]},'C1');
  await report({op:'revise',plan:'packaged',oid:'revise',rev:3,title:'Revised without resetting work'});
  await report({op:'change',plan:'packaged',oid:'batch',rev:4,changes:[{id:'I4',status:'done'}]});
  await report({op:'finish',plan:'packaged',oid:'finish',rev:5,outcome:'finished'});
  function control(action:string) {
    const result=spawnSync(process.execPath,[path.join(path.dirname(entry),'remove.js'),action],{encoding:'utf8',timeout:5000});
    assert.equal(result.status,0,result.stdout+result.stderr);return JSON.parse(result.stdout);
  }
  assert.equal(control('disable').captureEnabled,false);
  const denied=JSON.parse((await tool.execute({op:'revise',plan:'packaged',oid:'while-disabled',rev:6,title:'No write',reopen:true},{sessionID:'M',agent:'build',messageID:'fixture-message',id:'fixture-tool'})).content);
  assert.equal(denied.error,'disabled');assert.equal((await rpc.inspect()).captureEnabled,false);
  assert.equal(control('enable').captureEnabled,true);
  await report({op:'revise',plan:'packaged',oid:'reopen',rev:6,title:'Explicit continuation',reopen:true});
  await report({op:'finish',plan:'packaged',oid:'refinish',rev:7,outcome:'finished'});
  const store=new Store(binding.database);
  try {const plan=store.get(binding.source.id,'packaged')!;assert.equal(plan.lifecycle,'finished');assert.equal(plan.items.find(i=>i.id==='I3')!.status,'done');assert.deepEqual(store.detail(binding.source.id,'packaged').plan.counts,{done:4,total:4,remaining:0,skipped:1});}finally{store.close();}
  assert.equal(digest(readFileSync(document)),original);
  console.log(JSON.stringify({packagedGuidance:true,canonicalDocumentUnchanged:true,delegationRevisionFinish:true,loadedToolHonorsDisableEnable:true,toolVersion:status.version,protocolVersion:status.protocolVersion,modelRequests:0}));
}finally{await cleanup?.();}
