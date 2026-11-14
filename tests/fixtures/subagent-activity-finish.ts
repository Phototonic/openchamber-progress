/** Finish-only journey through the real native report tool on the isolated host. */
import assert from 'node:assert/strict';
import type { Store } from '../../shared/store.ts';

export async function nativeAtomicFinish(f:{store:Store;coordinator:string;records():any[];prompt(id:any,calls:any[],ended?:boolean):Promise<void>;checks:Record<string,any>;stage(value:string):void}) {
  f.stage('native-atomic-finish');
  const source='source-alpha',plan='atomic-finish';let serial=0;
  const invoke=async(input:any,error?:string)=>{
    const id=`atomic-finish-${++serial}`;
    await f.prompt(f.coordinator,[{id,tool:'agent_progress_report',input}]);
    const reply=f.records().filter(r=>r.type==='report-reply'&&r.callID===id).at(-1);
    assert.ok(reply?.parsed);assert.equal(reply.status,'completed');assert.equal(reply.error,error);return reply;
  };
  const snapshot=()=>({plan:f.store.get(source,plan),tables:Object.fromEntries(['receipts','revisions','contributions'].map(table=>[table,f.store.db.prepare(`SELECT * FROM ${table} WHERE source=? AND plan=?`).all(source,plan)]))});
  await invoke({op:'start',plan,oid:'native-finish-start',rev:0,title:'Synthetic atomic finish',items:[{id:'group',title:'Group',kind:'group'},...['a','b'].map(id=>({id,title:id,kind:'task'}))]});
  const final={op:'finish',plan,oid:'native-finish',rev:1,outcome:'finished',changes:[{id:'a',status:'done'},{id:'b',status:'done'}]};
  const before=snapshot();
  await invoke({...final,changes:[final.changes[0]]},'unfinished');assert.deepEqual(snapshot(),before);
  await invoke({...final,changes:[final.changes[0],{id:'group',status:'done'}]},'invalid');assert.deepEqual(snapshot(),before);
  await invoke({op:'change',plan,oid:'native-finish-race',rev:1,changes:[{id:'a',status:'working'}]});
  const raced=snapshot();const stale=await invoke(final,'conflict');assert.equal(stale.rev,2);assert.deepEqual(snapshot(),raced);
  const fresh={...final,rev:2};assert.equal((await invoke(fresh)).rev,3);
  const finished=snapshot();assert.equal(finished.plan!.lifecycle,'finished');assert.equal(finished.plan!.structuralRevision,1);
  assert.deepEqual(finished.plan!.items.slice(1).map(i=>[i.status,i.reporterSessionId]),[['done',f.coordinator],['done',f.coordinator]]);
  const contribution=f.store.detail(source,plan).contributions.data.at(-1)!;
  assert.deepEqual(contribution.itemIds,['a','b']);assert.equal(contribution.mode,'direct');
  assert.equal((await invoke(fresh)).rev,3);assert.deepEqual(snapshot(),finished);
  const {changes:_,...omitted}=fresh;await invoke(omitted,'operation-reused');assert.deepEqual(snapshot(),finished);
  await invoke({op:'change',plan,oid:'native-finish-late',rev:2,changes:[{id:'a',status:'working'}]},'conflict');assert.deepEqual(snapshot(),finished);
  f.checks.nativeAtomicFinish=true;f.checks.nativeFinishRefusalRollback=true;f.checks.nativeFinishConflictBothOrders=true;f.checks.nativeFinishFullInputReplay=true;
}
