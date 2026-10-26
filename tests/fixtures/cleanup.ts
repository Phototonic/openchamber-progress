import { writeFileSync } from 'node:fs';
import { productionFixture } from './production.ts';
import { digest } from '../../shared/store.ts';
import type { CleanupRequest } from '../../shared/cleanup.ts';
export const documentText='# Sample plan\n- [x] Example\n';
export function cleanupFixture(pages=false) {
  const f=productionFixture();
  const documentPath=`${f.root}/sample.md`;writeFileSync(documentPath,documentText,{mode:0o600});
  const capture=(text=documentText)=>({state:'captured' as const,path:documentPath,canonicalPath:documentPath,text,hash:digest(text),checkedAt:new Date().toISOString()});
  const starts=new Map<string,unknown>();
  function seed(plan:string,outcome?:'finished'|'cancelled'|'failed',source=f.source.id) {
    const actor={...f.actor,sourceId:source};
    const start={op:'start',plan,oid:`start-${plan}`,rev:0,title:plan==='P-done'?'Completed example — 計画 '.repeat(8):plan,source:documentPath,items:[{id:'A',title:'Example A',kind:'task',status:outcome?'done':'working'},{id:'B',title:'Example B',kind:'task',status:'done'}]};
    f.store.apply(start,actor,capture());starts.set(`${source}/${plan}`,start);
    if(outcome)f.store.apply({op:'finish',plan,oid:`finish-${plan}`,rev:1,outcome},actor,capture(`${documentText}\nRecorded finish\n`));
  }
  for(const [plan,outcome]of [['P-active',undefined],['P-done','finished'],['P-other','finished'],['P-cancelled','cancelled'],['P-failed','failed']]as const)seed(plan,outcome);
  f.store.registerSource({...f.source,id:'source-other',configRoot:`${f.root}/other-config`,dataRoot:`${f.root}/other-data`});seed('P-done','finished','source-other');
  if(pages)for(let i=0;i<55;i++)seed(`P-page-${String(i).padStart(2,'0')}`,'finished');
  f.store.apply({op:'stage',plan:'P-done',rev:2,oid:'staged',upload:'upload',chunk:0,reopen:true,items:[{id:'A',title:'Staged example',kind:'task',status:'done'}]},f.actor);
  const storeId=f.store.list().storeId;
  const body=(plan='P-done',cleanupRev=0,oid='archive',rev=2):CleanupRequest=>({storeId,source:f.source.id,plan,rev,cleanupRev,oid});
  return {...f,documentPath,capture,starts,seed,body};
}
