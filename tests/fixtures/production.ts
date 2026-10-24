import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { Store } from '../../shared/store.ts';
import type { Actor, Source, ItemInput } from '../../shared/progress.ts';
export function productionFixture() {
  const root=mkdtempSync('/tmp/opencode/agent-progress-production-');
  for(const dir of ['config','data','store'])mkdirSync(`${root}/${dir}`,{mode:0o700});
  const source:Source={id:'source-fixture',configRoot:`${root}/config`,dataRoot:`${root}/data`,verified:true};
  const actor:Actor={sourceId:source.id,sessionId:'M',agent:'build',directory:'/fixture/Alpha',projectId:'Alpha',parentId:null,ancestry:[],verifiedSource:true};
  const child:Actor={...actor,sessionId:'C1',agent:'general',parentId:'M',ancestry:['M'],directory:'/fixture/Native'};
  const store=new Store(`${root}/store/progress.sqlite`,{create:true});store.registerSource(source);
  return {root,source,actor,child,store,cleanup(){store.close();rmSync(root,{recursive:true,force:true});}};
}
export const P1:ItemInput[]=[{id:'G',title:'Implementation',kind:'group'},
  {id:'I1',title:'Contract',kind:'task',parentId:'G',status:'done'},
  {id:'I2',title:'Probe',kind:'task',parentId:'G',status:'done'},
  {id:'I3',title:'Native',kind:'task',status:'working'},
  {id:'I4',title:'Integration',kind:'task',status:'pending'},
  {id:'I5',title:'Optional',kind:'task',status:'skipped'}];
