import type { Plugin } from '@opencode/plugin';
import { randomUUID } from 'node:crypto';
import { Store } from '../shared/store.ts';
import { identifier, type Actor } from '../shared/progress.ts';
import { RUN_LIMITS, safeErrorType, type DispatchKey, type ExecutionObservation, type HistoricalSession } from '../shared/subagent-runs.ts';

const object=(v:unknown):v is Record<string,any>=>!!v&&typeof v==='object'&&!Array.isArray(v);
/** Passive projection on the existing delegation hook/event owner. No result text is parsed. */
export function createRunCapture(ctx:Plugin.Context,options:{store:Store;sourceId:string;identity(id:string,alive:()=>boolean,signal:AbortSignal):Promise<Actor>;now?:()=>number}) {
  const {store,sourceId}=options;store.installSubagentRuns();
  const now=options.now??Date.now,abort=new AbortController();let disposed=false,draining=false;
  const lookups=new Set<Promise<void>>();
  const producer=randomUUID();
  let physicalIdentities=0;
  const active=()=>!disposed&&!abort.signal.aborted;
  const key=(e:any):DispatchKey=>({source:sourceId,parent:e.sessionID,message:e.messageID,call:e.id});
  const valid=(e:any)=>['subagent','task'].includes(e.tool)&&[e.sessionID,e.messageID,e.id].every(identifier);
  // Failure is fixed metadata only; observation must never abort a native tool.
  const unavailable=()=>{try{store.runCaptureUnavailable();}catch{}};
  async function identity(id:string) {
    if(physicalIdentities>=2)throw Error('capture-unavailable');
    const controller=new AbortController(),signal=AbortSignal.any([controller.signal,abort.signal]);
    physicalIdentities++;
    const pending=options.identity(id,()=>active()&&!signal.aborted,signal).finally(()=>{physicalIdentities--;});
    let cancel:()=>void=()=>{};
    const timeout=setTimeout(()=>controller.abort(),1000);timeout.unref();
    try{return await Promise.race([pending,new Promise<never>((_,reject)=>{cancel=()=>reject(Error('capture-unavailable'));signal.addEventListener('abort',cancel,{once:true});if(signal.aborted)cancel();})]);}
    finally{clearTimeout(timeout);signal.removeEventListener('abort',cancel);controller.abort();}
  }
  async function before(e:any) {
    if(!valid(e)||!active())return;
    try{
      const c=store.runControl();if(!c.enabled)return;
      const at=now();const actor=await identity(e.sessionID);if(!active()||store.runControl().generation!==c.generation)return;
      if(actor.directory!==ctx.location.directory||!actor.ancestry)return;
      store.beforeRun(key(e),actor,e.tool,e.input,at);
    }catch{unavailable();}
  }
  async function resolveAfter(e:any) {
    if(!valid(e)||!active())return;
    try{
      const c=store.runControl();if(!c.enabled)return;
      const output=e.status==='completed'&&object(e.result?.output)?e.result.output:undefined;
      if(e.tool!=='subagent'||!identifier(output?.sessionID)||!['running','completed'].includes(output?.status)){
        store.afterRun(key(e),c.generation,undefined,e.status==='error'?'failed-unconfirmed':'unconfirmed');return;
      }
      const child=await identity(output.sessionID);
      if(!active())return;if(child.directory!==ctx.location.directory)throw Error('capture-unavailable');
      store.afterRun(key(e),c.generation,child,'returned');
    }catch{try{store.afterRun(key(e),store.runControl().generation,undefined,'unconfirmed');}catch{}unavailable();}
  }
  function after(e:any) {
    if(!valid(e)||!active())return;
    if(lookups.size>=2){
      // Declining identity work still closes this admitted call and consumes any
      // reserved intent in the Store's transaction; it must not strand authority.
      try{store.afterRun(key(e),store.runControl().generation,undefined,'unconfirmed');}catch{}
      unavailable();return;
    }
    const job=resolveAfter(e);lookups.add(job);void job.finally(()=>lookups.delete(job));
  }
  function event(e:any) {
    if(!active())return;
    if(e.type==='session.tool.failed') {
      const d=e.data;if(!object(d)||![d.sessionID,d.assistantMessageID,d.id].every(identifier)||e.location!==undefined&&e.location?.directory!==ctx.location.directory)return;
      try{store.afterRun({source:sourceId,parent:d.sessionID,message:d.assistantMessageID,call:d.id},store.runControl().generation,undefined,'failed-unconfirmed');}catch{unavailable();}return;
    }
    if(!e.type?.startsWith('session.execution.'))return;
    const d=e.data,state=e.type.slice('session.execution.'.length);
    // Native 2.2.2 omits the optional event location. Such metadata is only a
    // candidate until after-hook/child-handoff identity proves native lineage.
    if(!['started','succeeded','failed','interrupted'].includes(state)||!object(d)||!identifier(d.sessionID)||!identifier(e.id)||!Number.isSafeInteger(e.created)||e.created<0||!Number.isSafeInteger(e.durable?.seq)||e.durable.seq<0||e.durable.aggregateID!==d.sessionID||e.location!==undefined&&e.location?.directory!==ctx.location.directory)return;
    const observation:ExecutionObservation={source:sourceId,child:d.sessionID,id:e.id,sequence:e.durable.seq,at:e.created,state:state==='started'?'running':state,errorType:state==='failed'?safeErrorType(d.error?.type):null,interruptionReason:state==='interrupted'&&['user','shutdown','superseded','inactivity'].includes(d.reason)?d.reason:state==='interrupted'?'unknown':null};
    try{store.observeExecution(observation);}catch{unavailable();}
  }
  async function drain() {
    if(!active())return;
    try{store.maintainRunRecovery(sourceId,ctx.location.directory,producer);}catch{unavailable();return;}
    if(draining)return;draining=true;
    try{
      const root=store.pendingRunRecoveryAt(sourceId,ctx.location.directory);if(!root)return;
      const started=performance.now();
      // A wrong-location companion must leave the request alone.
      if(physicalIdentities>=2)return;physicalIdentities++;
      let nativeRoot:Awaited<ReturnType<typeof ctx.session.get>>;
      try{nativeRoot=await ctx.session.get({sessionID:root as any},{signal:abort.signal});}catch{const failed=store.claimRunRecovery(sourceId,root);if(failed)store.finishRunRecovery(failed,'failed');return;}finally{physicalIdentities--;}
      if(!active()||nativeRoot.id!==root||nativeRoot.location.directory!==ctx.location.directory)return;
      const job=store.claimRunRecovery(sourceId,root);if(!job)return;
      const alive=()=>active()&&store.runRecoveryAlive(job);
      let calls=1,discovered=0,partial=false;
      const work=store.runRecoveryWork(job),queue=work.queue,seen=new Set(work.seen);
      try{
        while(queue.length&&alive()){
          const parent=queue[0]!;let cursor=parent.cursor;
          do{
            if(calls>=RUN_LIMITS.calls||performance.now()-started>=RUN_LIMITS.elapsedMs){partial=true;break;}
            if(physicalIdentities>=2){partial=true;break;}calls++;physicalIdentities++;
            let page:Awaited<ReturnType<typeof ctx.session.list>>;
            try{page=await ctx.session.list({parentID:parent.id,limit:50,...(cursor?{cursor}:{}),directory:ctx.location.directory},{signal:abort.signal});}finally{physicalIdentities--;}
            if(!alive())return;
            if(!Array.isArray(page.data)||page.data.length>50){partial=true;break;}
            for(const s of page.data){
              if(discovered>=RUN_LIMITS.traversal||seen.size>=RUN_LIMITS.total){partial=true;break;}
              if(!identifier(s.id)||s.parentID!==parent.id||s.location.directory!==ctx.location.directory||s.projectID!==nativeRoot.projectID){partial=true;continue;}
              if(seen.has(s.id)){continue;}
              if(parent.depth>=RUN_LIMITS.depth){partial=true;continue;}
              seen.add(s.id);discovered++;
              const t=s.time;
              if(!Number.isSafeInteger(t.created)||!Number.isSafeInteger(t.updated)){partial=true;continue;}
              const projected:HistoricalSession={id:s.id,parent:parent.id,agent:s.agent??null,title:s.title??null,createdAt:t.created,updatedAt:t.updated,idleAt:Number.isSafeInteger(t.idle)?t.idle!:null,outcome:['succeeded','failed','interrupted'].includes(String(s.outcome))?s.outcome as HistoricalSession['outcome']:null};
              store.publishRunHistory(job,projected);queue.push({id:s.id,depth:parent.depth+1});
            }
            // A budget can stop inside a page. Keep that page's cursor so the
            // explicit continuation deduplicates its prefix without losing tail rows.
            if(partial)break;
            const next=page.cursor?.next;
            if(next!==null&&next!==undefined&&(typeof next!=='string'||Buffer.byteLength(next)>RUN_LIMITS.cursorBytes||next===cursor)){partial=true;break;}
            cursor=next??undefined;
            parent.cursor=cursor;
          }while(cursor&&!partial&&alive());
          if(!cursor&&!partial)queue.shift();
          if(partial)break;
        }
        if(alive()){store.saveRunRecoveryWork(job,{queue,seen:[...seen]});store.finishRunRecovery(job,partial?'partial':'complete');}
      }catch{if(alive())store.finishRunRecovery(job,'failed');}
    }catch{unavailable();}finally{draining=false;}
  }
  const timer=setInterval(()=>{void drain();},3000);timer.unref();
  return {before,after,event,drain,settled:async()=>{await Promise.all([...lookups]);},dispose(){disposed=true;abort.abort();clearInterval(timer);}};
}
