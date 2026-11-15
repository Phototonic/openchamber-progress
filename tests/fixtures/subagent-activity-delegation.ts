/** Real native dispatch/report order with a scripted-provider barrier. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import type { Store } from '../../shared/store.ts';
import type { OpenCode } from '@opencode/client';

export async function nativeDelegationReporting(f:{root:string;client:ReturnType<typeof OpenCode.make>;store:Store;coordinator:string;jobs:Record<string,any>;records():any[];prompt(id:any,calls:any[],ended?:boolean):Promise<void>;reportTool(input:any):Promise<void>;spawnCall(id:string,extra?:any):any;childFor(id:string):string;wait(condition:()=>Promise<boolean>|boolean,label:string,timeout?:number):Promise<void>;checks:Record<string,any>;stage(value:string):void}){
  const plan='parallel-reporting',source='source-alpha';
  const detail=()=>f.store.get(source,plan)!;
  const declaration=(oid:string,task:string)=>f.reportTool({op:'delegate',plan,oid,rev:detail().revision,assign:[task]});
  const childReport=async(child:string,id:string,input:any)=>{
    await f.prompt(child,[{id,tool:'agent_progress_report',input}]);
    const reply=f.records().filter(r=>r.type==='report-reply'&&r.callID===id).at(-1);
    assert.ok(reply?.parsed);assert.equal(reply.error,undefined);return reply;
  };
  f.stage('native-parallel-a');
  await f.reportTool({op:'start',plan,oid:'parallel-start',rev:0,title:'Synthetic parallel reporting',items:['task-a','task-b','task-c'].map(id=>({id,title:id,kind:'task'}))});
  f.jobs.firstReportingCall={id:'parallel-initial-read',tool:'agent_progress_report',input:{op:'read',plan}};
  await declaration('declare-a','task-a');
  await f.prompt(f.coordinator,[f.spawnCall('parallel-reporter-a',{agent:'reporting-worker'})]);
  delete f.jobs.firstReportingCall;
  const a=f.childFor('parallel-reporter-a');assert.ok(a);
  await f.wait(()=>detail().items[0]!.assigneeSessionId===a,'parallel-a-bound');
  f.stage('native-parallel-b');
  await declaration('declare-b','task-b');
  // B's real first execution waits for A's actual report receipt, not a sleep.
  // Its foreground dispatch cannot return/bind until that receipt exists.
  f.jobs.firstReportingJob={generation:'parallel-barrier',waitForReport:'parallel-a-working'};
  await f.prompt(f.coordinator,[f.spawnCall('parallel-reporter-b',{agent:'reporting-worker'})],false);
  await f.wait(()=>!!f.store.db.prepare('SELECT 1 FROM runs_intents WHERE source=? AND parent=? AND dispatch IS NOT NULL').get(source,f.coordinator),'parallel-b-reserved');
  await f.wait(()=>f.records().some(r=>r.type==='dispatch'&&r.waitingForReport==='parallel-a-working'),'parallel-b-dispatch');
  f.stage('native-parallel-a-report');
  const before=detail().revision;
  await childReport(a,'parallel-a-working',{op:'change',plan,oid:'parallel-working-a',rev:before,changes:[{id:'task-a',status:'working'}]});
  await f.client.session.wait({sessionID:f.coordinator},{signal:AbortSignal.timeout(30000)});
  delete f.jobs.firstReportingJob;fs.writeFileSync(`${f.root}/jobs.json`,JSON.stringify(f.jobs));
  f.stage('native-parallel-b-binding');
  const b=f.childFor('parallel-reporter-b');assert.ok(b);
  await f.wait(()=>detail().items[1]!.assigneeSessionId===b,'parallel-b-bound-after-a-report');
  assert.equal(detail().revision,before+2);
  const events=f.records(),reportIndex=events.findIndex(r=>r.type==='report-reply'&&r.callID==='parallel-a-working'),returnIndex=events.findIndex(r=>r.type==='after'&&r.callID==='parallel-reporter-b');
  assert.ok(reportIndex>=0&&returnIndex>reportIndex,'A report precedes B dispatch return');
  await childReport(b,'parallel-b-read',{op:'read',plan});
  assert.ok(f.records().some(r=>r.type==='dispatch'&&r.sessionID===b&&r.calls.includes('parallel-b-read')&&r.assignedBrief));
  await childReport(b,'parallel-b-working',{op:'change',plan,oid:'parallel-working-b',rev:detail().revision,changes:[{id:'task-b',status:'working'}]});
  f.checks.parallelSiblingReportBeforeBinding=true;f.checks.parallelSecondAssignmentBriefAndDirectReport=true;

  f.stage('native-visible-refusal');
  await declaration('native-conflict','task-c');
  await f.reportTool({op:'change',plan,oid:'touch-declared-task',rev:detail().revision,changes:[{id:'task-c',status:'pending'}]});
  const conflictRevision=detail().revision;
  await f.prompt(f.coordinator,[f.spawnCall('refused-reporter')]);
  await f.wait(()=>!f.store.db.prepare('SELECT 1 FROM runs_intents WHERE source=? AND parent=?').get(source,f.coordinator),'native-refusal-settled');
  assert.equal(detail().revision,conflictRevision);assert.equal(detail().items[2]!.assigneeSessionId,undefined);
  assert.equal(f.store.delegationRefusals(source,f.coordinator).refusals.find(r=>r.plan===plan)?.reason,'conflict');
  const checkpoint=f.records().length;await childReport(f.coordinator,'refusal-context-read',{op:'read',plan});
  assert.ok(f.records().slice(checkpoint).some(r=>r.type==='dispatch'&&r.sessionID===f.coordinator&&r.refusalHint&&r.refusalIdentity&&r.refusalRecovery));
  f.checks.refusedBindingNextOutgoingCoordinatorHint=true;

  f.stage('native-cross-worktree-move');
  await f.client.session.move({sessionID:b,directory:`${f.root}/Alpha-worktree`});
  const child=await f.client.session.get({sessionID:b}),parent=await f.client.session.get({sessionID:f.coordinator});
  assert.equal(child.parentID,parent.id);assert.notEqual(child.location.directory,parent.location.directory);assert.equal(child.projectID,parent.projectID);
  assert.ok(fs.existsSync(`${f.root}/Alpha-worktree/.git`));
  f.stage('native-cross-worktree-handoff');
  const final={op:'handoff',oid:'cross-worktree-final',summary:'Synthetic cross-worktree final report',outcome:'done',taskUpdate:{plan,rev:detail().revision,changes:[{id:'task-b',status:'done'}]}};
  const reply=await childReport(b,'cross-worktree-final',final);
  assert.equal(reply.handoff,true);assert.equal(reply.taskRev,final.taskUpdate.rev+1);assert.equal(detail().items[1]!.status,'done');
  assert.equal(detail().items[0]!.status,'working');assert.equal(detail().items[2]!.status,'pending');
  await childReport(b,'cross-worktree-retry',final);assert.equal(detail().revision,final.taskUpdate.rev+1);
  f.checks.nativeCrossWorktreeCombinedHandoffAndReplay=true;
}
