/** Synthetic recording inputs only. The managed companion is installed verbatim,
 * activated by the real loader, and is never wrapped or patched by this probe. */
import { Plugin } from '@opencode/plugin';
import { Rpc } from '@opencode/plugin/rpc';
import fs from 'node:fs';
import { readManagedBinding } from '../../shared/managed-binding.ts';

export const UpgradeProbe=Rpc.define({id:'subagent-upgrade-probe',methods:{seed:{input:{type:'object',additionalProperties:true},output:{type:'object',additionalProperties:true}}},events:{}});

export function upgradeProbe(ReleasedStore:any,createRunCapture:any,sessionIdentity:any) {
  return Plugin.define({id:'subagent-upgrade-probe',async setup(ctx){
    const root=process.env.UPGRADE_ROOT!;
    const forbidden=()=>{fs.appendFileSync(`${root}/model-attempts`,'attempt\n');throw Error('Model requests forbidden in upgrade rehearsal');};
    const guards=[await ctx.session.hook('model.request',forbidden),await ctx.session.hook('http.request',forbidden),await ctx.aisdk.hook('sdk',forbidden),await ctx.aisdk.hook('language',forbidden)];
    await ctx.rpc.register(UpgradeProbe,{seed:async(input:any)=>{
      const b=readManagedBinding();if(!b)throw new Error('managed fixture binding required');
      const store=new ReleasedStore(b.database);let capture:any;
      try{
        store.bindReads(b.source.id,true);
        // No prompt or native subagent execution: those would enter a model loop.
        // Session IDs and lineage come from the actual host, not a fake identity map.
        const parent=await ctx.session.create({agent:'build',title:'Upgrade fixture parent',model:{providerID:'upgrade-fixture',id:'never-called'}} as any);
        const child=await ctx.session.create({agent:'build',parentID:parent.id,title:'Upgrade fixture child',model:{providerID:'upgrade-fixture',id:'never-called'}} as any);
        const actor=await sessionIdentity(ctx,b.source,parent.id,'build',{alive:()=>true,signal:new AbortController().signal,sameScope:true});
        store.apply({op:'start',plan:'upgrade-rehearsal',oid:'seed-upgrade',rev:0,title:'Synthetic upgrade rehearsal',items:[{id:'verify',title:'Verify retained progress',kind:'task',status:'working'}]},actor);
        capture=createRunCapture(ctx,{store,sourceId:b.source.id,identity:(id:any,alive:any,signal:any)=>sessionIdentity(ctx,b.source,id,'build',{alive,signal,sameScope:true})});
        const event={tool:'subagent',sessionID:parent.id,messageID:'message-upgrade',id:'call-upgrade',input:{agent:'build',description:'Synthetic upgrade run'}};
        await capture.before(event);capture.after({...event,status:'completed',result:{output:{sessionID:child.id,status:'completed'}}});await capture.settled();
        const at=Date.now()+1000;
        capture.event({type:'session.execution.started',id:'upgrade-start',created:at,location:ctx.location,durable:{aggregateID:child.id,seq:1},data:{sessionID:child.id}});
        capture.event({type:'session.execution.succeeded',id:'upgrade-end',created:at+100,location:ctx.location,durable:{aggregateID:child.id,seq:2},data:{sessionID:child.id}});
        if(input.loss)capture.unavailable();
        return {parent:parent.id,child:child.id};
      }finally{try{capture?.dispose();}finally{store.close();}}
    }});
    return async()=>{for(const guard of guards)await guard.dispose();};
  }});
}
