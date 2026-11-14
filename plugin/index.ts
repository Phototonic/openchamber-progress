import { Plugin, Skill } from '@opencode/plugin';
import type { SessionHooks } from '@opencode/plugin/effect/session';
import { fileURLToPath } from 'node:url';
import { readFileSync, lstatSync } from 'node:fs';
import path from 'node:path';
import { readBinding, verifyStore, type Binding } from '../shared/binding.ts';
import { readManagedBinding, managedSourceRoots } from '../shared/managed-binding.ts';
import { RELEASE } from '../shared/release.ts';
import { Store, storageError, canonical } from '../shared/store.ts';
import { parseReportRequest, REPORT_SCHEMA, ProgressError, requireProgress as need, type Actor } from '../shared/progress.ts';
import { captureDocument } from './document.ts';
import { ProgressStatus } from './status.ts';
import { activationFingerprint } from '../shared/activation.ts';
import { registerActivation } from './activation.ts';
import { registerDelegation, PARALLEL_DELEGATION_HINT } from './delegation.ts';
import { PendingDelegationError } from '../shared/subagent-runs.ts';
import { sessionIdentity } from './identity.ts';

export default Plugin.define({ id:'agent-progress', setup: ctx => setupCompanion(ctx, () => {
  const b=readManagedBinding();
  // Presence is grounds to refuse competing authority, never permission to remove.
  if(b)need(!lstatSync(path.join(b.source.configRoot,'plugins/agent-progress'),{throwIfNoEntry:false}),'binding');
  return b;
}, true) });

/** Explicit legacy loader dependency, never a managed discovery fallback. */
export function setupLegacy(ctx: Plugin.Context, file: string) {
  return setupCompanion(ctx, () => {
    const b=readBinding(file), roots=managedSourceRoots();
    need(roots.configRoot===b.source.configRoot&&roots.dataRoot===b.source.dataRoot,'binding');return b;
  }, false);
}

async function setupCompanion(ctx: Plugin.Context, read: () => Binding | undefined, managed: boolean) {
  let b: Binding, store: Store | undefined, active=false, retired=false;
  const abort=new AbortController();
  let starting: Promise<boolean> | undefined;
  let deactivate: (() => Promise<void>) | undefined;
  let delegation: Awaited<ReturnType<typeof registerDelegation>> | undefined;
  let firstContext: ((event:SessionHooks['context'])=>Promise<void>) | undefined;
  let dormant: {dispose():Promise<void>} | undefined;
  function alive() { return !retired&&!abort.signal.aborted; }
  function guard() {
    need(alive()&&active&&store,'storage');
    try { need(canonical(read())===canonical(b),'binding'); }
    catch(e) { retired=true;abort.abort();void cleanup();throw e; }
  }
  function authorized() { try{guard();return true;}catch{return false;} }
  async function cleanup() {
    const pending=[delegation?.dispose(),deactivate?.(),dormant?.dispose()];
    delegation=undefined;deactivate=undefined;dormant=undefined;
    try { await Promise.allSettled(pending); } finally { const opened=store;store=undefined;try{opened?.close();}catch{/* preserve primary diagnostic */} }
  }
  async function initialize() {
    need(alive(),'storage');
    if(active){guard();return true;}
    if(starting)return starting;
    starting=(async()=>{
      const selected=read();if(!selected)return false;
      b=selected;store=new Store(b.database);
      try {
        verifyStore(store,b);store.bindReads(b.source.id,b.source.verified);
        const check=()=>{need(alive(),'storage');need(canonical(read())===canonical(b),'binding');};
        await ctx.skill.transform(editor => editor.add({ id:Skill.ID.make('agent-progress'),name:Skill.Name.make('Agent progress'),description:'Mirror canonical plans and deliberate progress without replacing your planner.',path:Skill.Info.fields.path.make(fileURLToPath(new URL('./SKILL.md',import.meta.url))),content:GUIDANCE }));check();
        // Reuse the activation owner. Deliver its initial context even when the host
        // snapshots callbacks before this deferred registration was admitted.
        // Recurring guidance checks read only the capture control row, never plan snapshots.
        const control=store.db.prepare('SELECT enabled FROM meta WHERE singleton=1');
        deactivate=await registerActivation(ctx,b.source,()=>{try{guard();return control.get()?.enabled===1;}catch{return false;}},{
          storeId:b.storeId,read:request=>store!.resumePlans(request),
          refusals:sessionID=>store!.delegationRefusals(b.source.id,sessionID),
          identity:(sessionID,alive,signal)=>identity(sessionID,'unknown',{alive,signal}),
        },callback=>{firstContext=callback;});check();
        delegation=await registerDelegation(ctx,{store,sourceId:b.source.id,
          alive:authorized,
          identity:(sessionID,observing,signal)=>sessionIdentity(ctx,b.source,sessionID,'unknown',{alive:()=>authorized()&&observing(),signal,sameScope:true}),
        });check();
        store.observeLoaded(b.source.id,b.installId,activationFingerprint({...b,version:managed?RELEASE:b.version},readFileSync(fileURLToPath(import.meta.url)),readFileSync(new URL('./SKILL.md',import.meta.url))));
        active=true;return true;
      } catch(e) { retired=true;abort.abort();await cleanup();throw e; }
    })();
    try{return await starting;}finally{starting=undefined;}
  }
  async function identity(sessionID: Parameters<typeof ctx.session.get>[0]['sessionID'], agent: string, guard?: { alive(): boolean; signal: AbortSignal }): Promise<Actor> {
    return sessionIdentity(ctx,b.source,sessionID,agent,guard??{alive,signal:abort.signal});
  }
  try {
  // The only dormant hook is boundary-driven; it creates no state and polls nothing.
  dormant=await ctx.session.hook('context',async event=>{
    if(active||!alive())return;
    try{if(await initialize())await firstContext?.(event);}catch{/* fixed report failures; no verified guidance */}
  });
  await ctx.tool.transform(editor => {
    editor.namespace({name:'agent_progress',description:'Deliberate plan progress; never inferred from activity.'});
    editor.add({ name:'report',description:`Tracker updates are not Agent Progress reports. For tracked plan work, explicitly mirror meaningful unreported canonical state at PLAN_READY handoff, review approval, owner approval and work start; do not report again if already current. Start/read plans, batch status changes, revise structure, link children, bind source documents or explicitly finish. ${START_HELP} Read agent-progress guidance for chunked commits and delegation.`,input:REPORT_SCHEMA,options:{namespace:'agent_progress',codemode:false},
      execute: async (value,caller) => {
        try {
            const r = parseReportRequest(value);need(await initialize(),'binding');guard();
            const current=store!;
            const observedAt=Date.now(),observedEpoch=r.op==='handoff'?delegation!.currentEpoch():undefined; const actor = await identity(caller.sessionID,caller.agent);guard();
           if(r.op==='handoff') {
               // Explicit reporting follows verified native parentage across worktrees
               // and projects. Same-scope proof remains required for automatic binding.
               const child=actor;
              const previous=r.taskUpdate?current.get(child.sourceId,r.taskUpdate.plan):undefined;
              const reference=previous?.document.path;
              const capture=reference?await captureDocument(reference,child.directory,resource=>ctx.permission.assert({sessionID:caller.sessionID,agent:caller.agent,source:{type:'tool',messageID:caller.messageID,id:caller.id},action:'read',resources:[resource]}),{...previous!.document,canonicalPath:previous!.boundCanonicalPath}):undefined;
              guard();
              return {content:JSON.stringify(current.handoff(r,child,observedAt,observedEpoch,capture))};
           }
          if (r.op === 'read') {
             const view=current.detail(actor.sourceId,r.plan,r.page??0);
            return {content:JSON.stringify(r.page===undefined?{plan:r.plan,rev:view.plan.revision,structuralRev:view.plan.structuralRevision,lifecycle:view.plan.lifecycle,counts:view.plan.counts,documentState:view.plan.document.state,detailPageSize:20}:view)};
          }
          if (r.op === 'delegate') {
            need(delegation,'binding');
            return {content:JSON.stringify(delegation.declare(r,actor))};
          }
           const previous = current.get(actor.sourceId,r.plan);
          let child: Actor | undefined;
          const childID = r.child ?? r.attributed;
          if (childID) { try { child = await identity(childID as typeof caller.sessionID,'unknown'); } catch { throw new ProgressError('assignment'); } }
          const reference = r.source ?? previous?.document.path;
          const capture = reference && r.op !== 'stage' ? await captureDocument(reference,actor.directory,resource => ctx.permission.assert({sessionID:caller.sessionID,agent:caller.agent,source:{type:'tool',messageID:caller.messageID,id:caller.id},action:'read',resources:[resource]}),r.op === 'bind' || r.op === 'start' ? undefined : previous ? {...previous.document,canonicalPath:previous.boundCanonicalPath} : undefined) : undefined;
           guard();
           need(current.list({limit:1}).captureEnabled,'disabled');
           const receipt = current.apply(r,actor,capture,child);
          return {content:JSON.stringify(receipt)};
        } catch (e) {
          const error = e instanceof ProgressError ? e : storageError(e);
          return {content:JSON.stringify({error:error.code,...(error.revision !== undefined ? {rev:error.revision} : {}),...(error.code === 'invalid' && error.hint ? {hint:error.hint} : {}),...(e instanceof PendingDelegationError?{hint:PARALLEL_DELEGATION_HINT}:{})})};
        }
      },
    });
  });
   await ctx.rpc.register(ProgressStatus,{inspect:async()=>{guard();const tool=(await ctx.tool.list()).find(t=>t.id==='agent_progress_report');guard();return{protocolVersion:2,version:managed?RELEASE:b.version,storeId:b.storeId,sourceId:b.source.id,captureEnabled:store!.list({limit:1}).captureEnabled,toolAvailable:!!tool,codemodeDisabled:tool?.options?.codemode===false};}});
   await initialize();
   return async () => { retired=true;abort.abort();const cleaning=cleanup();await starting?.catch(()=>{});await cleaning;await cleanup(); };
  } catch(error) {
    // No disposer is returned when setup rejects. Never strand the opened store,
    // and do not let a secondary close failure replace the setup diagnostic.
     retired=true;abort.abort();await cleanup();
    throw error;
  }
}

const START_HELP = `Every plan mutation requires a fresh oid and expected rev; reuse an oid only for an identical retry. New start requires plan, title, complete items and rev:0.
When starting or revising a plan, put real prerequisites in each task's optional dependencies array: IDs of tasks in the same plan that must finish first (max 16). Omit it when none are known; never add links just for list order or infer them from titles, sessions or activity. When replacing items in revise or stage/commit, include all still-needed links; omitted dependencies are not retained. Do not ask the user to fill them in. Links neither set blocked nor enforce execution.
Valid start with a prerequisite (replace synthetic IDs, title and items with the real plan): task-2 needs task-1 finished first; task-1 has no prerequisite.
\`\`\`json
{"op":"start","plan":"synthetic-plan","title":"Synthetic report","oid":"start-1","rev":0,"items":[{"id":"task-1","title":"Prepare sample data","kind":"task","status":"working"},{"id":"task-2","title":"Summarize sample data","kind":"task","status":"pending","dependencies":["task-1"]}]}
\`\`\`
Read uses only op=read, one concrete plan identifier and optional 0-based page; no wildcard, oid or rev. Omit page for a compact summary without items; explicit page returns paged detail. Read the current revision before updating an existing plan. Source is optional; denied document access still commits valid checklist changes with diagnostics. Never manufacture a file or report automatically on each turn. Empty/all-skipped plans cannot finish successfully.
For known assigned work, coordinators should read and declare op=delegate with plan, oid, expected rev and assign task IDs (max50) before supported dispatch. Include plan/task IDs and the reporting expectation in the assignment; IDs alone grant no authority. Durable intent reserves the first subsequently admitted supported subagent dispatch in database order; it survives restart without a five-minute expiry. Declaration is not assignment or dispatch. Identical retries never re-arm; a second nonempty declaration conflicts. ${PARALLEL_DELEGATION_HINT} Empty assign explicitly cancels before re-declaration. Verified immediate child/source/project/location and complete ancestry are required for automatic binding; an unconfirmed reserved call consumes intent instead of transferring it. Binding can tolerate intervening unrelated reports or assignments only with complete retained proof; relevant changes or incomplete proof refuse. Read a refusal before deliberately re-declaring or explicitly linking. Installed tools are trusted to report their structured child identity; task aliases and result text are not identity proof. Explicit link and assigned parent relay remain the fallback. Binding never changes task status, counts, report time or reporting permissions. Report after binding only, on naturally occurring contexts: no automatic preparation or resume; a first-turn-only child may have no task reports.
A permitted child may optionally send one final op=handoff with fresh oid, safe single-line summary (max200 JavaScript code units, no NUL/newlines) and outcome done/partial/blocked. No top-level plan/rev, child, attributed identity or source is accepted. Optional taskUpdate:{plan,rev,changes} atomically commits explicit changes for 1–50 unique currently assigned tasks with the claim, returning taskReceipt. Read current state first; report actual working, blocked with safe reason/nextAction when known, and final done/blocked changes. Never change siblings, structure or plan lifecycle. Bare handoff is claim-only; outcome never selects task status or acceptance. Host completion is independent and absence is normal. Identical full-input retries use the same oid; altered reuse or another claim for that execution conflicts. Older tools reject taskUpdate; inspect state before deliberately using separate reports, never strip fields automatically. Never expose a tool hidden by host policy, relay a handoff for another session, copy prompts/results or include secrets. Bounds and literal rendering do not redact secrets. A run/claim marked done can still have explicitly blocked tasks; only explicit task reports change them.`;

const GUIDANCE = `Keep using your canonical planner/task workflow. This tool mirrors it, never replaces it. If not already reported, report at meaningful start/change/delegation/finish boundaries, not on a timer. Repeated guidance alone is not a reason to report again. Activity/idle/age never means completion. Structured/conversation-only plans need no source; never manufacture a file. Document-backed plans may explicitly name their canonical source, subject to report-time read permissions. Authored/Ready is not reviewed/accepted; worker completion is not accepted handoff. Needs-input keeps actual work pending/blocked. Never invent review work or infer progress from file writes.
Tracker updates are not Agent Progress reports. For tracked plan work, explicitly mirror meaningful unreported canonical state at PLAN_READY handoff, review approval, owner approval and work start; do not report again if already current. These are actual canonical states, not events the plugin detects. At PLAN_READY mirror the actionable structure, not implementation completion or approval. Review approval and owner approval are separate; reflect existing canonical gate/work items only, never invent review tasks to report. Work start means actual work, not a dispatch having run.
Conditional native dispatch/tracker hints ask only whether meaningful canonical state remains unreported. They are not report receipts, assignments or evidence of work start, review, approval or completion; already-current state needs no mutation.
${START_HELP}
Blocked tasks may optionally include blocker:{category?,reason?,nextAction?}; categories are decision/dependency/review/external/other. Prose must be nonblank, at most 512 JS code units each, without NUL. Supply purpose-written safe summaries, never private prompts, transcripts or raw tool output; bounds do not redact secrets. Missing parts are unknown. An object completely replaces details; null clears details without resolving status. Omission retains only verified-current details on a continuously blocked task. Groups reject blocker; non-null objects require blocked status. A metadata-only change repeats status:"blocked". Start/revise/staged task entries also accept blocker; staging publishes nothing before commit. Leaving blocked or closing clears details; re-entry/reopen without an explicit object is unknown. Older writers can invalidate optional details: deliberately re-report rather than resurrecting text. Do not send unsupported fields automatically to older tools. Waiting durations are derived from reported status history, not caller input, actual model activity or approval.
Start unrelated objectives as separate plan IDs. Mirror the complete structure once with stable item IDs; groups are not work. Start with op=start, plan/title/items, oid and rev=0. Routine changes send only changes:[{id,status}] with the latest rev and a fresh oid. Batch changes. Status: pending, working, blocked, done, skipped. Read after compaction/conflict before writing. Retry identical input with the same oid only; altered reuse refuses. Every call needs op, including change; if the host rejects a call with "op: Missing key", resend the same call with op added and the same oid.
Large structures: op=stage with upload/chunk/items (max50/chunk and16KiB/request; at most32 chunks/1000 items), then op=commit with upload/chunks/title and expected rev. Chunks are not a committed plan. Explicitly report limits rather than dropping work. Never truncate a plan or call staging complete. Revise retains item statuses unless explicitly changed. Bind a canonical file using op=bind/source; confirm=true only when its checklist is mirrored. The original document remains authoritative; permission/read failure still commits valid checklist changes with diagnostics.
Coordinator explicitly links a verified child session with op=link, child and assign IDs; pass plan/item IDs in the assignment. Children report assigned items only. Unlinked/unknown children stay independent. Restricted children may be relayed explicitly using attributed child ID after valid linking; this labels the parent reporter honestly, never impersonates a child. Do not loosen child restrictions. Finish is explicit: outcome finished only with actionable work all resolved; cancelled/failed retain unfinished work. Closed plans require explicit coordinator revise/commit with reopen=true. No inference, passive scraping, document rewriting or hidden assignments.`;
