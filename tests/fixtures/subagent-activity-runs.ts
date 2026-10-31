import { Store } from '../../shared/store.ts';
import type { Actor } from '../../shared/progress.ts';
import type { RunRequest } from '../../shared/subagent-runs.ts';

/** Deterministic revision-1 UI seam, populated exclusively through real Store writes.
 * Caller supplies a private temporary database path and owns close/removal. */
export function seedRunReadFixture(file:string) {
  const store=new Store(file,{create:true});
  const source={id:'source-fixture',configRoot:'/synthetic/config',dataRoot:'/synthetic/data',verified:true};
  store.registerSource(source);store.bindReads(source.id,true);store.installSubagentRuns();
  const actor:Actor={sourceId:source.id,sessionId:'root-fixture',agent:'coordinator',directory:'/synthetic/project',projectId:'project-fixture',parentId:null,ancestry:[],verifiedSource:true};
  store.apply({op:'start',plan:'plan-fixture',oid:'start-fixture',rev:0,title:'Synthetic work',items:[{id:'task-fixture',title:'Review result',kind:'task',status:'blocked'}]},actor);
  const base=1_800_000_000_000;
  for(const [index,state] of ['succeeded','running','failed','interrupted'].entries()) {
    const child={...actor,sessionId:`child-${index}`,parentId:actor.sessionId,ancestry:[actor.sessionId]};
    const key={source:source.id,parent:actor.sessionId,message:`message-${index}`,call:`call-${index}`};
    store.beforeRun(key,actor,'subagent',{agent:'explorer',description:`Synthetic work ${index}`},base+index*10000);
    store.observeExecution({source:source.id,child:child.sessionId,id:`event-start-${index}`,sequence:1,at:base+index*10000+100,state:'running',errorType:null,interruptionReason:null});
    if(state!=='running')store.observeExecution({source:source.id,child:child.sessionId,id:`event-end-${index}`,sequence:2,at:base+index*10000+1000,state:state as 'succeeded'|'failed'|'interrupted',errorType:state==='failed'?'SyntheticFailure':null,interruptionReason:state==='interrupted'?'user':null});
    store.afterRun(key,store.runControl().generation,child,'returned');
  }
  const request:RunRequest={storeId:store.list().storeId,binding:{sourceId:source.id,verified:true},source:source.id,root:actor.sessionId,plan:'plan-fixture',cleanupRev:0,view:'useful'};
  store.requestRunReconciliation({storeId:request.storeId,binding:request.binding,source:request.source,root:request.root});
  const job=store.claimRunRecovery(source.id,actor.sessionId)!;
  store.publishRunHistory(job,{id:'historical-child',parent:actor.sessionId,agent:'explorer',title:'Historical session',createdAt:base-200000,updatedAt:base-100000,idleAt:base-110000,outcome:'succeeded'});
  store.finishRunRecovery(job,'complete');
  // Each representative child has one retained row, so each must be marked
  // latest even when its row is in the other view. The flag is read-only.
  const latestChildIds=['child-0','child-1','child-2','child-3','historical-child'];
  return {store,request,latestChildIds,read:()=>store.subagentRuns(request,base+180000)};
}
