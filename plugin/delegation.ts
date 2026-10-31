import type { Plugin } from '@opencode/plugin';
import type { Store } from '../shared/store.ts';
import type { Actor } from '../shared/progress.ts';
import { createRunCapture } from './subagent-runs.ts';

/** Durable next-dispatch authority and passive capture share one hook/event owner.
 * Call IDs, not assistant-message census or elapsed time, reserve intent. */
export async function registerDelegation(ctx:Plugin.Context,options:{store:Store;sourceId:string;identity(id:string,alive:()=>boolean,signal:AbortSignal):Promise<Actor>;now?:()=>number}) {
  options.store.installDelegationControl();
  const capture=createRunCapture(ctx,{store:options.store,sourceId:options.sourceId,identity:options.identity});
  const abort=new AbortController(),registrations:Array<{dispose():Promise<void>}>=[];
  let disposed=false,events:Promise<void>|undefined;
  async function dispose(){if(disposed)return;disposed=true;capture.dispose();abort.abort();for(const r of registrations.splice(0))try{await r.dispose();}catch{}await events;}
  try {
    registrations.push(await ctx.tool.hook('execute.before',capture.before));
    registrations.push(await ctx.tool.hook('execute.after',capture.after));
    try{capture.observationStarted();const stream=ctx.event.subscribe({signal:abort.signal});
      events=(async()=>{try{for await(const event of stream){if(disposed)break;capture.event(event);}}catch{}finally{if(!disposed)capture.unavailable();}})();
    }catch{capture.unavailable();}
    return {declare:(value:unknown,actor:Actor)=>options.store.declareDelegation(value,actor),dispose,drainRuns:capture.drain,settledRuns:capture.settled,settled:capture.settled};
  }catch(e){await dispose();throw e;}
}
