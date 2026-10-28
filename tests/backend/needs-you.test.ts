import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import plugin from '../../plugin/index.ts';
import { lifecycle } from '../../setup/lifecycle.ts';
import { Store } from '../../shared/store.ts';
import { attentionItems } from '../fixtures/needs-you.ts';

test('V1 registered report: annotation replacement, provenance, relay, atomic validation and staged commit',async()=>{
  const root=fs.mkdtempSync('/tmp/opencode/needs-you-invocation-');
  const saved=new Map<string,string|undefined>();let dispose:(()=>Promise<void>)|undefined;let store:Store|undefined;
  try {
    for(const dir of ['config/opencode','data/opencode','project'])fs.mkdirSync(`${root}/${dir}`,{recursive:true,mode:0o700});
    lifecycle('install',{configRoot:`${root}/config/opencode`,dataRoot:`${root}/data/opencode`,storeRoot:`${root}/store`,confirmed:true},{plugin:'// fixture',guidance:'fixture',removal:'// fixture',version:'0.4.0'});
    for(const [key,value] of Object.entries({AGENT_PROGRESS_BINDING:`${root}/config/opencode/plugins/agent-progress/progress-binding.json`,XDG_CONFIG_HOME:`${root}/config`,XDG_DATA_HOME:`${root}/data`,OPENCODE_DB:undefined,OPENCODE_CONFIG_DIR:undefined})){
      saved.set(key,process.env[key]);if(value===undefined)delete process.env[key];else process.env[key]=value;
    }
    let tool:any;
    const ctx:any={session:{hook:async()=>({dispose:async()=>{}}),get:async({sessionID}:any)=>({id:sessionID,location:{directory:`${root}/project`},agent:'synthetic',...(sessionID==='C'?{parentID:'M'}:{})})},skill:{transform:async()=>{}},tool:{hook:async()=>({dispose:async()=>{}}),transform:async(cb:any)=>cb({namespace:()=>{},add:(v:any)=>{tool=v;}}),list:async()=>[]},rpc:{register:async()=>{}},permission:{assert:async()=>{throw new Error('not-used');}}};
    dispose=await plugin.setup(ctx) as typeof dispose;
    store=new Store(`${root}/store/progress.sqlite`);const source=store.list().sources[0]!.id;
    let rev=0,oid=0;
    const call=async(r:any,sessionID='M')=>JSON.parse((await tool.execute(r,{sessionID,agent:'synthetic'})).content);
    const change=async(r:any,sessionID='M')=>{const reply=await call({op:'change',plan:'P-attention',oid:`op-${oid++}`,rev,...r},sessionID);assert.equal(reply.error,undefined);rev=reply.rev;return reply;};
    const snapshot=()=>store!.get(source,'P-attention')!;
    const item=()=>store!.detail(source,'P-attention').items.data.find(i=>i.id==='decision')!;
    const start={op:'start',plan:'P-attention',oid:'start',rev:0,title:'Reported waits',items:attentionItems};
    const first=await call(start);rev=first.rev;assert.equal(rev,1);assert.equal(first.items,undefined,'mutations return only a Receipt');
    assert.deepEqual(await call(start),first);assert.equal(snapshot().revision,1);
    const initial=item().blocker!;
    assert.equal(initial.category,'decision');assert.equal(initial.reporterSessionId,'M');assert.equal(initial.attributedSessionId,'M');assert.equal(initial.mode,'direct');assert.equal(initial.reportedRevision,1);assert.equal(initial.validAtRevision,1);assert.ok(Number.isFinite(Date.parse(initial.reportedAt)));
    const paged=await call({op:'read',plan:'P-attention',page:0});assert.equal(paged.items.nextCursor,'1');assert.equal(paged.blockedTiming,undefined);
    rev=(await call({op:'link',plan:'P-attention',oid:'link',rev,child:'C',assign:['decision','dependency']})).rev;
    assert.equal(item().blocker?.reportedRevision,1);assert.equal(item().blocker?.validAtRevision,rev);
    await change({changes:[{id:'decision',status:'blocked'}]},'C');assert.equal(item().blocker?.reporterSessionId,'M','retained prose is not re-authored');
    await change({attributed:'C',changes:[{id:'decision',status:'blocked',blocker:{category:'review',nextAction:'Review the format proposal'}}]});
    const relay=item().blocker!;assert.equal(relay.reporterSessionId,'M');assert.equal(relay.attributedSessionId,'C');assert.equal(relay.mode,'parent-relay');assert.equal(relay.reason,undefined);assert.equal(relay.reportedRevision,rev);
    await change({changes:[{id:'decision',status:'blocked',blocker:{reason:'Await input'}}]},'C');assert.equal(item().blocker?.mode,'direct');assert.equal(item().blocker?.attributedSessionId,'C');assert.equal(item().blocker?.category,undefined);
    const authored=item().blocker!.reportedRevision;
    rev=(await call({op:'bind',plan:'P-attention',oid:'neutral-bind',rev,source:`${root}/project/summary.md`})).rev;
    assert.equal(item().blocker?.reportedRevision,authored);assert.equal(item().blocker?.validAtRevision,rev,'neutral bind retains original annotation author');
    const before=snapshot();
    for(const [r,session] of [
      [{changes:[{id:'decision',status:'blocked',blocker:{reason:'Invalid owner'}}]},'U'],
      [{changes:[{id:'review',status:'blocked',blocker:{reason:'Not assigned'}}]},'C'],
      [{attributed:'U',changes:[{id:'decision',status:'blocked',blocker:{}}]},'M'],
    ] as const){const reply=await call({op:'change',plan:'P-attention',oid:`bad-${oid++}`,rev,...r},session);assert.equal(reply.error,'assignment');assert.deepEqual(snapshot(),before);}
    const invalids:any[]=[
      {changes:[{id:'decision',status:'working',blocker:{}}]},
      {changes:[{id:'group',status:'blocked',blocker:null}]},
      {changes:[{id:'decision',status:'blocked',blocker:{reason:' '}}]},
      ...['x'.repeat(513),'a\0b'].flatMap(text=>['reason','nextAction'].map(field=>({changes:[{id:'decision',status:'blocked',blocker:{[field]:text}}]}))),
      {changes:[{id:'decision',status:'blocked',blocker:{category:'future'}}]},
      {changes:[{id:'decision',status:'blocked',blocker:{reportedRevision:1}}]},
      {changes:[{id:'decision',status:'blocked',blocker:[]}]},
      {changes:[{id:'decision',status:'pending'},{id:'missing',status:'blocked',blocker:{}}]},
      {op:'revise',items:[{id:'group',title:'Group',kind:'group',blocker:null}]},
      {op:'revise',items:[{id:'new',title:'New',kind:'task',blocker:{}}]},
      {changes:Array.from({length:20},()=>({id:'decision',status:'blocked',blocker:{reason:'x'.repeat(512),nextAction:'y'.repeat(512)}}))},
    ];
    for(const r of invalids){const reply=await call({op:'change',plan:'P-attention',oid:`invalid-${oid++}`,rev,...r});assert.equal(reply.error,'invalid');assert.deepEqual(snapshot(),before,'whole-batch rollback');assert.equal(JSON.stringify(reply).includes('reportedRevision'),false);}
    await change({changes:[{id:'decision',status:'blocked',blocker:{reason:'x'.repeat(512),nextAction:'y'.repeat(512)}}]});assert.equal(item().blocker?.reason?.length,512);
    const request={op:'change',plan:'P-attention',oid:'retry-details',rev,changes:[{id:'decision',status:'blocked',blocker:{}}]};const receipt=await call(request);rev=receipt.rev;assert.deepEqual(await call(request),receipt);assert.equal(item().blocker?.reason,undefined);
    assert.deepEqual(await call({...request,changes:[{id:'decision',status:'blocked',blocker:{reason:'Changed'}}]}),{error:'operation-reused'});
    await change({changes:[{id:'decision',status:'blocked',blocker:null}]});assert.equal(item().blocker,undefined);assert.equal(item().status,'blocked');
    const done=snapshot().items.filter(i=>i.status==='done').length;
    await change({changes:[{id:'decision',status:'pending'}]});await change({changes:[{id:'decision',status:'blocked'}]});assert.equal(item().blocker,undefined);assert.equal(snapshot().items.filter(i=>i.status==='done').length,done);
    const staged=[{id:'decision',title:'Choose format',kind:'task',status:'blocked',blocker:{reason:'Staged safe summary'}}];
    const preStage=snapshot();const stage={op:'stage',plan:'P-attention',oid:'stage',rev,upload:'upload',chunk:0,items:staged};assert.equal((await call(stage)).rev,rev);assert.deepEqual(snapshot(),preStage);
    assert.equal((await call({op:'commit',plan:'P-attention',oid:'incomplete',rev,upload:'upload',chunks:2})).error,'stage-incomplete');assert.deepEqual(snapshot(),preStage);
    const committed=await call({op:'commit',plan:'P-attention',oid:'commit',rev,upload:'upload',chunks:1});rev=committed.rev;assert.equal(item().blocker?.reason,'Staged safe summary');assert.equal(item().blocker?.reportedRevision,rev);
    rev=(await call({op:'revise',plan:'P-attention',oid:'retained',rev,items:[{id:'decision',title:'Renamed',kind:'task',blocker:{nextAction:'Choose CSV'}}]})).rev;assert.equal(item().blocker?.reason,undefined);assert.equal(item().blocker?.nextAction,'Choose CSV','structural inherited blocked status accepts annotation');
    rev=(await call({op:'finish',plan:'P-attention',oid:'close',rev,outcome:'cancelled'})).rev;assert.equal(snapshot().items[0]!.blocker,undefined);
    rev=(await call({op:'revise',plan:'P-attention',oid:'reopen',rev,title:'Reopened',reopen:true})).rev;assert.equal(item().blocker,undefined);
    rev=(await call({op:'revise',plan:'P-attention',oid:'group',rev,items:[{id:'decision',title:'Group',kind:'group',status:'blocked'}]})).rev;
    rev=(await call({op:'revise',plan:'P-attention',oid:'task',rev,items:[{id:'decision',title:'Task',kind:'task'}]})).rev;assert.equal(item().blocker,undefined);
    await change({changes:[{id:'decision',status:'blocked',blocker:{reason:'Current reason'}}]});
    rev=(await call({op:'revise',plan:'P-attention',oid:'remove',rev,items:[]})).rev;
    rev=(await call({op:'revise',plan:'P-attention',oid:'readd',rev,items:[{id:'decision',title:'Task',kind:'task',status:'blocked'}]})).rev;assert.equal(item().blocker,undefined);
    rev=(await call({op:'finish',plan:'P-attention',oid:'close-again',rev,outcome:'failed'})).rev;
    rev=(await call({op:'revise',plan:'P-attention',oid:'explicit-reopen',rev,reopen:true,items:[{id:'decision',title:'Task',kind:'task',blocker:{nextAction:'Choose a format'}}]})).rev;
    assert.equal(item().blocker?.reportedRevision,rev);assert.equal(item().blocker?.nextAction,'Choose a format','explicit reopen annotation is newly authored');
    assert.equal((await call({op:'read',plan:'P-attention'})).rev,rev);
  } finally {store?.close();await dispose?.();for(const [key,value]of saved){if(value===undefined)delete process.env[key];else process.env[key]=value;}fs.rmSync(root,{recursive:true,force:true});}
});
