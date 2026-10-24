import { test } from 'node:test';
import assert from 'node:assert/strict';
import { productionContext, productionStoreProof,productionToolFacts } from '../../scripts/production-live-check.ts';
import { productionFixture } from '../fixtures/production.ts';
import { destinationClient } from '../../scripts/auth-live.ts';

function calls() {return [
  {op:'start',plan:'t6',oid:'t6-start',rev:0,title:'Tiny plan',items:[{id:'G',title:'Group',kind:'group'},{id:'A',title:'First',kind:'task',parentId:'G'},{id:'B',title:'Second',kind:'task',parentId:'G'},{id:'C',title:'Not needed',kind:'task',parentId:'G',status:'skipped'}]},
  {op:'change',plan:'t6',oid:'t6-change',rev:1,changes:[{id:'A',status:'done'},{id:'B',status:'done'}]},
  {op:'finish',plan:'t6',oid:'t6-finish',rev:2,outcome:'finished'},
];}
function messages() {
  const content=calls().map((input,i)=>({
    type:'tool',name:'agent_progress_report',state:{status:'completed',input,content:[{
      type:'text',text:JSON.stringify({plan:'t6',rev:i+1,structuralRev:1,...(i===1?{changed:['A','B']}:{})}),
    }]},
  }));
  return [{id:'msg_input',type:'user'},{type:'assistant',content}];
}
test('production live context and real SQLite prove identity/counts/revisions/first receipts without retaining context',()=>{
  const f=productionFixture();const actor={...f.actor,sessionId:'ses_root'};
  try {
    const context=productionContext(messages(),'msg_input');
    for(const call of context.calls)call.receipt=f.store.apply(call.input,actor);
    const proof=productionStoreProof(f.store.file,f.source.id,actor.sessionId,actor.directory,context.calls);
    assert.equal(proof.receiptsNonReplayed,true);assert.equal(proof.sqliteWrites,3);
    assert.deepEqual(proof.revisionProgression,[1,2,3]);assert.equal(proof.groupExcluded,true);
    for(const forbidden of ['ses_root',actor.directory,f.root,'Tiny plan'])assert.equal(JSON.stringify(proof).includes(forbidden),false);
    assert.throws(()=>productionStoreProof(f.store.file,f.source.id,'ses_other',actor.directory,context.calls),/action/);
    f.store.db.prepare("UPDATE contributions SET payload=json_set(payload,'$.reporterAgent','other')").run();
    assert.throws(()=>productionStoreProof(f.store.file,f.source.id,actor.sessionId,actor.directory,context.calls),/action/);
  }finally{f.cleanup();}
});
test('production context rejects other tools, repeats, failed/altered receipts, missing prompt and incomplete lifecycle',()=>{
  for(const kind of ['other','repeat','error','revision','missing','unfinished','counts']) {
    const m:any[]=messages();const tools=m[1].content;
    if(kind==='other')tools[0].name='shell';
    if(kind==='repeat')tools.push(structuredClone(tools[0]));
    if(kind==='error')tools[1].state.content[0].text='{"error":"conflict"}';
    if(kind==='revision')tools[1].state.content[0].text='{"plan":"t6","rev":99,"structuralRev":1}';
    if(kind==='missing')m.shift();
    if(kind==='unfinished')tools[2].state.input.outcome='cancelled';
    if(kind==='counts')tools[0].state.input.items[3].status='pending';
    assert.throws(()=>productionContext(m,'msg_input'),/action/,kind);
  }
});
test('production destination sends exactly one prompt/wait/context and sanitizes tool diagnostics',async()=>{
  const requests:string[]=[];const wire=async(url:string,init:RequestInit)=>{
    requests.push(new URL(url).pathname);assert.equal(init.redirect,'error');
    if(url.endsWith('/prompt')){const text=JSON.parse(String(init.body)).text;assert.match(text,/MUST finish/);assert.match(text,/"op":"finish","plan":"t6","oid":"t6-finish","rev":2,"outcome":"finished"/);assert.match(text,/Never reuse an oid/);return Response.json({data:{id:'msg_input'}});}
    if(url.endsWith('/wait'))return Response.json({});
    assert.ok(url.endsWith('/context'));return Response.json({data:messages()});
  };
  const client=destinationClient('http://127.0.0.1:30002','SYNTHETIC-ONLY',wire,new AbortController().signal);
  assert.equal((await client.production('ses_root')).calls.length,3);
  assert.equal(requests.length,3);assert.deepEqual(client.diagnostics().assistantToolCounts,{agent_progress_report:3});
  assert.equal(client.diagnostics().sessionHadErrorPart,false);
});
test('attempt2 permits only one confirming read after change, retaining three mutation receipts',()=>{
  const read={type:'tool',name:'agent_progress_report',state:{status:'completed',input:{op:'read',plan:'t6'},content:[{type:'text',text:JSON.stringify({plan:'t6',rev:2,structuralRev:1,lifecycle:'active',counts:{done:2,total:2,remaining:0,skipped:1}})}]}};
  const m:any[]=messages();m[1].content.splice(2,0,read);
  const observed=productionContext(m,'msg_input');assert.equal(observed.calls.length,3);assert.deepEqual(observed.assistantToolCounts,{agent_progress_report:4});
  const duplicate=structuredClone(m);duplicate[1].content.splice(2,0,structuredClone(read));assert.throws(()=>productionContext(duplicate,'msg_input'),/action/);
  const early=messages() as any[];early[1].content.splice(1,0,structuredClone(read));assert.throws(()=>productionContext(early,'msg_input'),/action/);
  read.state.content[0].text=JSON.stringify({plan:'t6',rev:1,structuralRev:1,lifecycle:'active',counts:{done:0,total:2,remaining:2,skipped:1}});
  assert.throws(()=>productionContext(m,'msg_input'),/action/);
});
test('production failure facts retain only bounded revisions/fixed operations and errors, never payloads',()=>{
  const m:any[]=messages();const part=m[1].content[2];
  part.state.input={op:'finish',plan:'PRIVATE-SENTINEL',oid:'PRIVATE-SENTINEL',rev:2};part.state.content[0].text='{"error":"invalid"}';
  const facts=productionToolFacts(m);assert.equal(facts[2].replyError,'invalid');assert.equal(facts[2].receiptRevision,null);assert.equal(JSON.stringify(facts).includes('PRIVATE-SENTINEL'),false);
  part.state.input={operation:'PRIVATE-SENTINEL',expectedRevision:2,rev:'PRIVATE-SENTINEL'};part.state.content[0].text='{"error":"PRIVATE-SENTINEL"}';
  const redacted=productionToolFacts(m);assert.equal(redacted[2].operation,'other');assert.equal(redacted[2].replyError,'other');assert.equal(redacted[2].legacyAliasesPresent,true);assert.equal(JSON.stringify(redacted).includes('PRIVATE-SENTINEL'),false);
});
