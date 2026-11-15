import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import plugin from '../../plugin/index.ts';
import { Store } from '../../shared/store.ts';
import { parseRequest, REPORT_SCHEMA } from '../../shared/progress.ts';
import { createFixtureBinding } from '../fixtures/managed.ts';

test('registered report provides safe recovery hints and executable start help without weakening mutations', async () => {
  const root=fs.mkdtempSync('/tmp/opencode/agent-progress-invocation-');
  const saved=new Map<string,string|undefined>();let dispose:(()=>Promise<void>)|undefined;
  try {
    for(const dir of ['config/opencode','data/opencode','project'])fs.mkdirSync(`${root}/${dir}`,{recursive:true,mode:0o700});
    const {env}=createFixtureBinding(root);
    for(const [key,value] of Object.entries({...env,AGENT_PROGRESS_BINDING:undefined,OPENCODE_DB:undefined,OPENCODE_CONFIG_DIR:undefined})){
      saved.set(key,process.env[key]);if(value===undefined)delete process.env[key];else process.env[key]=value;
    }
    let tool:any;let skill:any;let identities=0;
    const ctx:any={
      session:{hook:async()=>({dispose:async()=>{}}),get:async({sessionID}:any)=>{identities++;return{id:sessionID,location:{directory:`${root}/project`},agent:'synthetic',projectID:'fixture'};}},
      skill:{transform:async(cb:any)=>cb({add:(v:any)=>{skill=v;}})},
      tool:{hook:async()=>({dispose:async()=>{}}),transform:async(cb:any)=>cb({namespace:()=>{},add:(v:any)=>{tool=v;}}),list:async()=>[]},
      rpc:{register:async()=>{}},permission:{assert:async()=>{throw new Error('PRIVATE_PERMISSION_SENTINEL');}},
    };
    dispose=await plugin.setup(ctx) as typeof dispose;
    const call=async(input:any)=>JSON.parse((await tool.execute(input,{sessionID:'ses_fixture',agent:'synthetic'})).content);
    const view=()=>{const s=new Store(`${root}/store/progress.sqlite`,{readOnly:true});try{return s.list();}finally{s.close();}};
    const full={op:'start',plan:'recovery-plan',title:'PRIVATE_TITLE_SENTINEL',items:[{id:'a',title:'PRIVATE_ITEM_SENTINEL',kind:'task',status:'working'}],source:'PRIVATE_SOURCE_SENTINEL.md'};
    const invalids:[any,RegExp][]=[
      [null,/request/i],
      [{op:'PRIVATE_OP_SENTINEL',plan:'synthetic-plan'},/supported op/],
      [full,/oid/],
      [{...full,oid:'start-1'},/rev/],
      [{...full,oid:'bad mutation',rev:0},/oid/],
      [{...full,oid:'start-1',rev:-1},/rev/],
      [{op:'start',plan:'minimal',title:'Synthetic',oid:'minimal',rev:0},/items/],
      [{...full,oid:'start-1',rev:0,items:'PRIVATE_ITEMS_SENTINEL'},/items/i],
      [{...full,oid:'start-1',rev:0,title:''},/title/],
      [{op:'read',plan:'*'},/plan.*identifier|concrete plan/],
      [{op:'read',plan:'synthetic-plan',oid:'read-1',rev:0},/fields|read/],
      [{...full,oid:'start-1',rev:0,PRIVATE_UNKNOWN_KEY:'PRIVATE_VALUE_SENTINEL'},/fields/],
      [{...full,oid:'start-1',rev:0,source:'PRIVATE_SOURCE_SENTINEL\0'},/source/i],
    ];
    for(const [input,hint] of invalids){
      const before=identities;const reply=await call(input);
      assert.equal(reply.error,'invalid');assert.match(reply.hint,hint);assert.ok(reply.hint.length<=256);
      assert.doesNotMatch(JSON.stringify(reply),/PRIVATE_|\/tmp\/|\/home\//);
      assert.equal(identities,before,'parse rejects before identity or permissions');
    }
    assert.equal(view().data.length,0,'rejected starts do not create plans');
    assert.deepEqual(await call({op:'read',plan:full.plan}),{error:'not-found'});
    const fixed={...full,oid:'start-1',rev:0};const receipt=await call(fixed);
    assert.equal(receipt.rev,1);assert.deepEqual(await call(fixed),receipt,'identical retry returns original receipt');
    const read=await call({op:'read',plan:full.plan});assert.equal(read.rev,1);assert.equal(read.documentState,'denied');
    assert.deepEqual(await call({...fixed,title:'Changed'}),{error:'operation-reused'});
    const update={op:'change',plan:full.plan,oid:'change-1',rev:0,changes:[{id:'a',status:'done'}]};
    assert.deepEqual(await call(update),{error:'conflict',rev:1});
    assert.equal((await call({...update,rev:read.rev})).rev,2);
    // A change that names a group or an unknown ID refuses with a constant recovery hint and no revision.
    const grouped={op:'start',plan:'grouped-plan',oid:'grouped-start',rev:0,title:'Grouped',items:[{id:'G',title:'Group',kind:'group',status:'working'},{id:'t',title:'Task',kind:'task',parentId:'G'}]};
    assert.equal((await call(grouped)).rev,1);
    for(const op of ['change','finish'])for(const id of ['G','PRIVATE_MISSING_SENTINEL']){
      const reply=await call({op,plan:'grouped-plan',oid:`grouped-${op}-${id.length}`,rev:1,...(op==='finish'?{outcome:'finished'}:{}),changes:[{id:'t',status:'done'},{id,status:'done'}]});
      assert.equal(reply.error,'invalid');assert.match(reply.hint,/existing task IDs only.*revise/);assert.ok(reply.hint.length<=256);
      assert.doesNotMatch(JSON.stringify(reply),/PRIVATE_/);
    }
    assert.equal((await call({op:'read',plan:'grouped-plan'})).rev,1,'refused changes advance nothing, including valid task entries in the same batch');
    const revised=await call({op:'revise',plan:'grouped-plan',oid:'grouped-revise',rev:1,items:[{id:'G',title:'Group',kind:'group',status:'done'},{id:'t',title:'Task',kind:'task',parentId:'G',status:'done'}]});
    assert.equal(revised.rev,2,'revise sets a group status');
    const final={op:'finish',plan:'grouped-plan',oid:'atomic-finish',rev:2,outcome:'finished',changes:[{id:'t',status:'done'}]};
    assert.deepEqual(await call({...final,rev:1}),{error:'conflict',rev:2});
    const finished=await call(final);assert.deepEqual(finished,{plan:'grouped-plan',rev:3,structuralRev:2,changed:['t']});
    assert.deepEqual(await call(final),finished);
    assert.deepEqual(await call({...final,changes:[{id:'t',status:'skipped'}]}),{error:'operation-reused'});
    assert.equal((await call({op:'read',plan:'grouped-plan'})).lifecycle,'finished');
    assert.equal(view().data.length,2);

    // Every advertised example is executable; help must not omit hidden start prerequisites.
    const advertised:any[]=[];
    for(const text of [tool.description,skill.content,fs.readFileSync('plugin/SKILL.md','utf8')]){
      const examples=[...text.matchAll(/```json\s*([\s\S]*?)```/g)].map(m=>JSON.parse(m[1]));
      assert.ok(examples.length>0,'direct tool and both guidance surfaces include JSON start example');
      for(const example of examples){assert.equal(parseRequest(example).op,'start');assert.equal(example.rev,0);assert.equal(example.items[0].kind,'task');
        const reply=await call(example);assert.equal(reply.rev,1);
        const page=await call({op:'read',plan:example.plan,page:0});
        const first=page.items.data.find((i:any)=>i.id==='task-1');const second=page.items.data.find((i:any)=>i.id==='task-2');
        assert.deepEqual(first.dependencies??[],[]);assert.deepEqual(second.dependencies,['task-1']);
        assert.equal(first.status,'working');assert.equal(second.status,'pending','a prerequisite does not force blocked status');
        advertised.push(example);
      }
    }
    // Check all identical starts before revising: retries return the original receipt.
    for(const [index,example] of advertised.entries()){
      for(const retain of [true,false]){
        const current=await call({op:'read',plan:example.plan});
        const items=example.items.map(({dependencies,...item}:any)=>retain&&dependencies?{...item,dependencies}:item);
        const reply=await call({op:'revise',plan:example.plan,oid:`example-${index}-${retain}`,rev:current.rev,items});
        assert.equal(reply.rev,current.rev+1);
        const page=await call({op:'read',plan:example.plan,page:0});
        const first=page.items.data.find((i:any)=>i.id==='task-1');const second=page.items.data.find((i:any)=>i.id==='task-2');
        assert.deepEqual(first.dependencies??[],[]);assert.deepEqual(second.dependencies??[],retain?['task-1']:[]);
        assert.equal(first.status,'working');assert.equal(second.status,'pending','revising edges does not force blocked status');
      }
    }
    for(const field of ['op','plan','oid','rev','items'] as const)assert.ok(REPORT_SCHEMA.properties[field].description?.length,'schema directly explains operation requirements');
    ctx.session.get=async()=>{throw new Error('PRIVATE_NATIVE_SENTINEL');};
    assert.deepEqual(await call({op:'read',plan:'synthetic-plan'}),{error:'binding'},'non-validation failures remain generic');
  } finally {
    await dispose?.();for(const[key,value]of saved){if(value===undefined)delete process.env[key];else process.env[key]=value;}
    fs.rmSync(root,{recursive:true,force:true});
  }
});
