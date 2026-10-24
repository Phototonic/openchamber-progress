/** T6 test-only assertions. Raw context/IDs stay in memory, never evidence. */
import { insist } from './auth-source.ts';
import { Store, canonical, digest } from '../shared/store.ts';
import { parseRequest, countItems, type Request, type Receipt } from '../shared/progress.ts';

export const PRODUCTION_PROMPT = `Synthetic production test. Use ONLY agent_progress_report; no files, shell, network, delegation or other actions. Perform three mutations in order, WAITING for each receipt. Use these EXACT production JSON keys: op means operation, oid means operationId, rev means expectedRevision. Do NOT send the legacy aliases operation/operationId/expectedRevision.
1. Start: {"op":"start","plan":"t6","oid":"t6-start","rev":0,"title":"Tiny plan","items":[{"id":"G","title":"Group","kind":"group"},{"id":"A","title":"First","kind":"task","parentId":"G"},{"id":"B","title":"Second","kind":"task","parentId":"G"},{"id":"C","title":"Not needed","kind":"task","parentId":"G","status":"skipped"}]}
2. After receipt rev=1, echo that rev in: {"op":"change","plan":"t6","oid":"t6-change","rev":1,"changes":[{"id":"A","status":"done"},{"id":"B","status":"done"}]}
3. After the changes COMMIT with receipt rev=2, you MUST finish. Echo that last receipt rev=2 in this EXACT call, with NO extra fields: {"op":"finish","plan":"t6","oid":"t6-finish","rev":2,"outcome":"finished"}
You may optionally make ONE read between change and finish: {"op":"read","plan":"t6"}. A read does not replace finish. Never reuse an oid with an altered payload. No retries: stop on any refusal. Do not merely say finished: success REQUIRES the committed finish receipt rev=3. Only then reply OK.`;
export function toolCounts(messages:any[]) {
  const tools=messages.filter(m=>m.type==='assistant').flatMap(m=>m.content??[]).filter(p=>p.type==='tool');
  const counts:Record<string,number>={};
  for(const part of tools){const name=part.name==='agent_progress_report'?part.name:'other';counts[name]=(counts[name]??0)+1;}
  return {tools,counts};
}
export function productionToolFacts(messages:any[]) {
  const operations=['start','change','read','finish'];
  const codes=['invalid','not-found','conflict','operation-reused','assignment','source-unverified','closed','unfinished','disabled','busy','storage','corrupt','schema','binding','stage-incomplete'];
  const revision=(n:unknown)=>Number.isSafeInteger(n)&&Number(n)>=0&&Number(n)<=1_000_000?Number(n):null;
  return toolCounts(messages).tools.map((tool:any)=>{
    const input=tool.state?.input;let reply:any;
    try{reply=JSON.parse(tool.state.content.find((c:any)=>c.type==='text').text);}catch{}
    return {operation:operations.includes(input?.op)?input.op:'other',requestRevision:revision(input?.rev),legacyAliasesPresent:!!input&&['operation','operationId','expectedRevision'].some(k=>Object.hasOwn(input,k)),completed:tool.state?.status==='completed',replyParsed:!!reply&&typeof reply==='object',replyError:typeof reply?.error==='string'?(codes.includes(reply.error)?reply.error:'other'):null,receiptRevision:revision(reply?.rev),structuralRevision:revision(reply?.structuralRev)};
  });
}
export function productionContext(messages:any[],admittedID:string) {
  const start=messages.findIndex(m=>m.id===admittedID&&m.type==='user');insist(start>=0,'action');
  const current=messages.slice(start+1);const {tools,counts}=toolCounts(current);
  insist(!current.some(m=>m.error||m.type==='error'||m.content?.some((p:any)=>p.error||p.type==='error'||p.state?.status==='error')),'action');
  insist((tools.length===3||tools.length===4)&&tools.every(p=>p.name==='agent_progress_report'&&p.state?.status==='completed'),'action');
  const allCalls=tools.map((part:any)=>{
    let input:Request;let receipt:Receipt;
    try{input=parseRequest(part.state.input);receipt=JSON.parse(part.state.content.find((c:any)=>c.type==='text').text);}catch{insist(false,'action');}
    insist(receipt&&typeof receipt==='object'&&!('error' in receipt),'action');return {input,receipt};
  });
  const ops=['start','change','finish'];
  insist(allCalls.map(c=>c.input.op).join(',')===(allCalls.length===4?'start,change,read,finish':'start,change,finish'),'action');
  if(allCalls.length===4) {
    const read=allCalls[2];const state=read.receipt as Receipt&{lifecycle:string;counts:unknown};
    insist(read.input.plan==='t6'&&read.input.page===undefined&&state.plan==='t6'&&state.rev===2&&state.structuralRev===1&&state.lifecycle==='active'&&canonical(state.counts)===canonical({done:2,total:2,remaining:0,skipped:1}),'action');
  }
  const calls=allCalls.filter(c=>c.input.op!=='read');
  calls.forEach(({input,receipt},i)=>{
    insist(input.op===ops[i]&&input.plan==='t6'&&input.oid===`t6-${ops[i]}`&&input.rev===i,'action');
    insist(receipt.plan==='t6'&&receipt.rev===i+1&&receipt.structuralRev===1,'action');
  });
  const items=calls[0].input.items!;
  insist(items.length===4&&items.filter(i=>i.kind==='group').length===1&&items.find(i=>i.id==='G')?.kind==='group','action');
  for(const id of ['A','B'])insist(items.find(i=>i.id===id)?.kind==='task'&&(items.find(i=>i.id===id)?.status??'pending')==='pending','action');
  insist(items.find(i=>i.id==='C')?.kind==='task'&&items.find(i=>i.id==='C')?.status==='skipped','action');
  const changes=calls[1].input.changes!;insist(changes.length===2&&['A','B'].every(id=>changes.some(c=>c.id===id&&c.status==='done')),'action');
  insist(calls[2].input.outcome==='finished','action');
  return {calls,assistantToolCounts:counts};
}
export function productionStoreProof(database:string,sourceID:string,sessionID:string,directory:string,calls:ReturnType<typeof productionContext>['calls']) {
  const store=new Store(database,{readOnly:true});
  try {
    const view=store.detail(sourceID,'t6');
    insist(view.plan.sessionId===sessionID&&view.plan.directory===directory&&view.plan.revision===3&&view.plan.lifecycle==='finished','action');
    insist(canonical(view.plan.counts)===canonical({done:2,total:2,remaining:0,skipped:1}),'action');
    const contributions=view.contributions.data;
    insist(contributions.length===3&&contributions.every((c,i)=>c.revision===i+1&&c.reporterSessionId===sessionID&&c.attributedSessionId===sessionID&&c.reporterAgent==='build'&&c.mode==='direct'),'action');
    const snapshots=store.db.prepare('SELECT revision,snapshot FROM revisions WHERE source=? AND plan=? ORDER BY revision').all(sourceID,'t6');
    insist(snapshots.length===3,'action');
    const counts=snapshots.map(row=>countItems(JSON.parse(String(row.snapshot)).items));
    insist(canonical(counts)===canonical([{done:0,total:2,remaining:2,skipped:1},{done:2,total:2,remaining:0,skipped:1},{done:2,total:2,remaining:0,skipped:1}]),'action');
    const receipts=store.db.prepare('SELECT oid,payload_hash,receipt FROM receipts WHERE source=? AND plan=?').all(sourceID,'t6');
    insist(receipts.length===3,'action');
    for(const {input,receipt}of calls) {
      const row=receipts.find(r=>r.oid===input.oid);
      insist(row&&row.payload_hash===digest(canonical({request:input,session:sessionID,source:sourceID}))&&canonical(JSON.parse(String(row.receipt)))===canonical(receipt),'action');
    }
    // Production receipts intentionally have no replay flag. A fresh empty DB,
    // exactly one observed invocation per distinct oid and 3 matching committed
    // revisions/receipt hashes establish first writes without changing the DTO.
    return {callerSessionVerified:true,callerAgentVerified:true,revisionProgression:[1,2,3],countsVerified:true,groupExcluded:true,skippedVerified:true,lifecycleFinished:true,receiptsNonReplayed:true,sqliteWrites:3};
  }finally{store.close();}
}
