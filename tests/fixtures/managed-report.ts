/** Exact packaged managed plugin, synthetic native caller. Not actual-host acceptance. */
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { writeFileSync } from 'node:fs';
const [extension,root]=process.argv.slice(2);assert.ok(extension&&root);
let tool:any,inspect:any,skill:any;
const hook=async()=>({dispose:async()=>{}});
const ctx:any={session:{hook,get:async({sessionID}:any)=>({id:sessionID,agent:'fixture',location:{directory:root},projectID:'fixture'})},
  skill:{transform:async(fn:any)=>fn({add:(v:any)=>{skill=v;}})},tool:{hook,transform:async(fn:any)=>fn({namespace(){},add:(v:any)=>{tool=v;}}),list:async()=>[{id:'agent_progress_report',options:{codemode:false}}]},rpc:{register:async(_definition:any,handlers:any)=>{inspect=handlers.inspect;}},permission:{assert:async()=>{}}};
const plugin=(await import(pathToFileURL(path.join(extension,'build/companion/index.js')).href)).default;
const dispose=await plugin.setup(ctx);
try{
  assert.equal(tool.options.codemode,false);assert.match(skill.content,/canonical planner/);
  const source=`${root}/plan.md`;writeFileSync(source,'# Synthetic packaged plan\n');
  const call=async(input:unknown)=>JSON.parse((await tool.execute(input,{sessionID:'package-session',agent:'fixture',messageID:'fixture-message',id:'fixture-call'})).content);
  assert.equal((await call({op:'start',plan:'managed-packaged',oid:'start',rev:0,title:'Managed packaged workflow',source,items:[{id:'a',title:'First task',kind:'task',status:'working'},{id:'b',title:'Second task',kind:'task',dependencies:['a']}]})).rev,1);
  assert.equal((await call({op:'change',plan:'managed-packaged',oid:'change',rev:1,changes:[{id:'a',status:'done'}]})).rev,2);
  assert.equal((await call({op:'read',plan:'managed-packaged'})).documentState,'captured');
  assert.equal((await inspect()).toolAvailable,true);
  console.log(JSON.stringify({packagedManagedReport:true,revision:2,documentCaptured:true,codemodeDisabled:true}));
}finally{await dispose?.();}
