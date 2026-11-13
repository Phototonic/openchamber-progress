import { searchFixture } from './plan-task-search.ts';
import type { Actor, ItemInput } from '../../shared/progress.ts';

export function mentionFixture() {
  const f=searchFixture(false);
  const other={id:'source-other',verified:true,configRoot:'/fixture/other/config',dataRoot:'/fixture/other/data'};
  f.store.registerSource(other);
  const child:Actor={...f.actor,sessionId:'linked-child',parentId:f.actor.sessionId,ancestry:[f.actor.sessionId]};
  const historical:Actor={...child,sessionId:'historical-child'};
  function seed(id:string,title:string,who:Actor=f.actor,items:ItemInput[]=[{id:'T',title:'Task-only needle',kind:'task',status:'working'}]){return f.apply(id,{op:'start',title,items},who);}
  return {...f,other,child,historical,seed};
}

export function seedMentionLibrary(f:ReturnType<typeof mentionFixture>) {
  for(let n=0;n<450;n++){
    const sourceId=n%3===0?f.alpha.id:n%3===1?f.beta.id:f.other.id;
    const actor={...f.actor,sourceId,sessionId:`owner-${n}`,directory:n%4?'/fixture/elsewhere':'/fixture/main',projectId:n%5?'project-alpha':'project-other'};
    f.seed(`P-${String(n).padStart(4,'0')}`,n%7?'Ordinary report':'Matching report',actor,Array.from({length:n<350?4:3},(_,i)=>({id:`T${i}`,title:`Task ${i}`,kind:'task',status:i?'pending':'working'})));
  }
}
