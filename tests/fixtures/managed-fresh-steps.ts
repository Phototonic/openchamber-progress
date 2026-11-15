/** Synthetic format-3 / wire-2 fixtures. Version-1 fixtures stay unchanged. */
import { managedFreshPlan, type ManagedFreshStepRequest, type ManagedFreshStepResponse } from '../../shared/managed-steps.ts';
import { managedTargetDigest, managedRequestDigest, managedFreshJournalProgress, type ManagedFreshStepJournal,
  type ManagedPathClaim } from '../../setup/managed-step-journal.ts';
import { canonical, digest } from '../../shared/store.ts';
import type { ManagedFreshReview } from '../../shared/progress.ts';

export const absentFreshClaim = (path:string):ManagedPathClaim => ({path,kind:'absent',object:null,digest:null});
export const observedFreshClaim = (path:string,kind:'directory'|'file'):ManagedPathClaim => ({path,kind,
  object:{device:'1',inode:kind==='directory'?'9007199254740993':'9007199254740994',birthNs:'1'},digest:kind==='file'?'1'.repeat(64):null});

export function managedFreshStepFixtures(storeMode:'create'|'retain'='create',directoryMissing=true,sourceMode:'create'|'reuse'='create') {
  const plan=managedFreshPlan(storeMode,directoryMissing,sourceMode),operationId='22222222-2222-4222-8222-222222222222';
  const source={id:'source-fresh',configRoot:'/fixture/config',dataRoot:'/fixture/data',verified:true};
  const journal:ManagedFreshStepJournal={protocolVersion:2,schemaVersion:2,installId:'managed-fresh',version:'1.4.0',
    database:'/fixture/store/progress.sqlite',storeId:'store-fresh',source,migration:{format:3,planKind:'fresh',
      product:'openchamber-agent-progress-managed',phase:'pending',operationId,sequence:1,state:'pending',step:plan[1]!,lastCompleted:plan[0]!,
      consent:{reviewDigest:'a'.repeat(64),targetDigest:'0'.repeat(64),planDigest:digest(canonical(plan))},
      expectation:{version:'1.4.0',fingerprint:'9'.repeat(64)},plan,
      fresh:{storeMode,sourceMode,capturePolicy:storeMode==='create'?'enable-new':'preserve',
        directory:directoryMissing?absentFreshClaim('/fixture/store'):observedFreshClaim('/fixture/store','directory'),
        database:storeMode==='create'?absentFreshClaim('/fixture/store/progress.sqlite'):observedFreshClaim('/fixture/store/progress.sqlite','file'),
        sidecars:['-journal','-wal','-shm'].map(s=>absentFreshClaim('/fixture/store/progress.sqlite'+s)),
        source:sourceMode==='reuse'?{...source}:null,capture:storeMode==='create'?'unknown':'off',
        selection:absentFreshClaim('/fixture/data/agent-progress-managed/progress-binding.json'),
        journal:absentFreshClaim('/fixture/data/agent-progress-managed/migration.json'),
        legacy:absentFreshClaim('/fixture/config/plugins/agent-progress')},
      created:{directory:null,database:null},captureRenewals:[],intent:null,receipt:null,
      capture:{state:'unknown',observedAt:null},diagnostic:null}};
  journal.migration.consent.targetDigest=managedTargetDigest(journal);
  const review:ManagedFreshReview={expected:journal.migration.consent.reviewDigest,planKind:'fresh',
    targets:{configRoot:source.configRoot,dataRoot:source.dataRoot,storeRoot:'/fixture/store'},storeId:journal.storeId,sourceId:source.id,
    storeMode,sourceMode,capturePolicy:journal.migration.fresh.capturePolicy,packageVersion:journal.migration.expectation.version,
    capture:journal.migration.capture,plan};
  const requests={inspect:{version:2,action:'inspect'},inspectNext:{version:2,action:'inspect',cursor:'fresh-page'},
    begin:{version:2,action:'begin',operationId,confirmed:true,expected:review.expected},
    advance:{version:2,action:'advance',operationId,expectedSequence:1,step:plan[1]!},
    pause:{version:2,action:'pause',operationId,expectedSequence:1},resume:{version:2,action:'resume',operationId,expectedSequence:2},
    reviewedResume:{version:2,action:'resume',operationId,expectedSequence:2,review:{confirmed:true,expected:review.expected,step:'enable'}},
    abandon:{version:2,action:'abandon',operationId,expectedSequence:1},status:{version:2,action:'status'}} satisfies Record<string,ManagedFreshStepRequest>;
  journal.migration.receipt={requestDigest:managedRequestDigest(requests.begin,journal),expectedSequence:0,sequence:1,step:plan[0]!,outcome:'applied'};
  const replies={reviewed:{version:2,disposition:'observed',inspection:{state:'complete',stage:'review',cursor:null,review},progress:null,error:null,
      accounting:{securitySpawns:0,elapsedMs:0}},
    prepared:{version:2,disposition:'applied',inspection:null,progress:managedFreshJournalProgress(journal),error:null,
      accounting:{securitySpawns:0,elapsedMs:0}}} satisfies Record<string,ManagedFreshStepResponse>;
  return structuredClone({requests,replies,journal,review,plan});
}
