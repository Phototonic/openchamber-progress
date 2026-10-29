import type { Plugin } from '@opencode/plugin';
import path from 'node:path';
import { ProgressError, requireProgress as need, type Actor } from '../shared/progress.ts';

/** Host-only identity. Guarded observation additionally requires same project/location ancestry. */
export async function sessionIdentity(ctx: Plugin.Context, source: {id:string;verified:boolean}, sessionID: string, agent: string, guard?: {alive():boolean;signal:AbortSignal;sameScope?:boolean}): Promise<Actor> {
  const checkpoint=()=>{if(guard)need(guard.alive(),'binding');};
  checkpoint();
  let s: Awaited<ReturnType<typeof ctx.session.get>>;
  try{s=await ctx.session.get({sessionID:sessionID as any},guard?{signal:guard.signal}:undefined);}catch{throw new ProgressError('binding');}
  checkpoint();need(s.id===sessionID && path.isAbsolute(s.location.directory),'binding');
  const ancestry:string[]=[],seen=new Set([s.id]);let parent=s.parentID,known=true;
  while(parent) {
    if(seen.has(parent)||ancestry.length>=32){known=false;break;}
    seen.add(parent);ancestry.push(parent);checkpoint();
    try {
      const ancestor=await ctx.session.get({sessionID:parent},guard?{signal:guard.signal}:undefined);checkpoint();
      if(guard)need(ancestor.id===parent,'binding');
      if(guard?.sameScope)need(ancestor.location.directory===s.location.directory && ancestor.projectID===s.projectID,'binding');
      parent=ancestor.parentID;
    } catch {known=false;break;}
  }
  return {sourceId:source.id,sessionId:s.id,agent:agent==='unknown'?s.agent??'unknown':agent,directory:s.location.directory,projectId:s.projectID,parentId:s.parentID??null,ancestry:known?ancestry:null,verifiedSource:source.verified};
}
