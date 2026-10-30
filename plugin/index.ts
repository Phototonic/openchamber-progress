import { Plugin, Skill } from '@opencode/plugin';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import path from 'node:path';
import { realpathSync, readFileSync } from 'node:fs';
import { readBinding, verifyStore } from '../shared/binding.ts';
import { Store, storageError } from '../shared/store.ts';
import { parseRequest, REPORT_SCHEMA, ProgressError, requireProgress as need, type Actor } from '../shared/progress.ts';
import { captureDocument } from './document.ts';
import { ProgressStatus } from './status.ts';
import { activationFingerprint } from '../shared/activation.ts';
import { registerActivation } from './activation.ts';
import { registerDelegation } from './delegation.ts';
import { sessionIdentity } from './identity.ts';
import { windows, windowsPaths, sameWindowsDirectory, platformSecurityScope } from '../shared/platform.ts';

export default Plugin.define({ id:'agent-progress', async setup(ctx) {
  const b = readBinding(process.env.AGENT_PROGRESS_BINDING ?? new URL('./progress-binding.json',import.meta.url));
  const configRoot = path.join(process.env.XDG_CONFIG_HOME || path.join(homedir(),'.config'),'opencode');
  const dataRoot = path.join(process.env.XDG_DATA_HOME || path.join(homedir(),'.local/share'),'opencode');
  need(!process.env.OPENCODE_DB && !process.env.OPENCODE_CONFIG_DIR && (windows?platformSecurityScope(()=>{windowsPaths([configRoot,dataRoot,b.source.configRoot,b.source.dataRoot]);return sameWindowsDirectory(configRoot,b.source.configRoot)&&sameWindowsDirectory(dataRoot,b.source.dataRoot);}):realpathSync(configRoot) === b.source.configRoot && realpathSync(dataRoot) === b.source.dataRoot),'binding');
  const store = new Store(b.database);
  let deactivate: (() => Promise<void>) | undefined;
  let delegation: Awaited<ReturnType<typeof registerDelegation>> | undefined;
  try {
  verifyStore(store,b);store.bindReads(b.source.id,b.source.verified);
  async function identity(sessionID: Parameters<typeof ctx.session.get>[0]['sessionID'], agent: string, guard?: { alive(): boolean; signal: AbortSignal }): Promise<Actor> {
    return sessionIdentity(ctx,b.source,sessionID,agent,guard);
  }
  await ctx.skill.transform(editor => editor.add({ id:Skill.ID.make('agent-progress'),name:Skill.Name.make('Agent progress'),description:'Mirror canonical plans and deliberate progress without replacing your planner.',path:Skill.Info.fields.path.make(fileURLToPath(new URL('./SKILL.md',import.meta.url))),content:GUIDANCE }));
  await ctx.tool.transform(editor => {
    editor.namespace({name:'agent_progress',description:'Deliberate plan progress; never inferred from activity.'});
    editor.add({ name:'report',description:`Tracker updates are not Agent Progress reports. For tracked plan work, explicitly mirror meaningful unreported canonical state at PLAN_READY handoff, review approval, owner approval and work start; do not report again if already current. Start/read plans, batch status changes, revise structure, link children, bind source documents or explicitly finish. ${START_HELP} Read agent-progress guidance for chunked commits and delegation.`,input:REPORT_SCHEMA,options:{namespace:'agent_progress',codemode:false},
      execute: async (value,caller) => {
        try {
          const r = parseRequest(value); const actor = await identity(caller.sessionID,caller.agent);
          if (r.op === 'read') {
            const view=store.detail(actor.sourceId,r.plan,r.page??0);
            return {content:JSON.stringify(r.page===undefined?{plan:r.plan,rev:view.plan.revision,structuralRev:view.plan.structuralRevision,lifecycle:view.plan.lifecycle,counts:view.plan.counts,documentState:view.plan.document.state,detailPageSize:20}:view)};
          }
          if (r.op === 'delegate') {
            need(delegation,'binding');
            return {content:JSON.stringify(delegation.declare(r,actor))};
          }
          const previous = store.get(actor.sourceId,r.plan);
          let child: Actor | undefined;
          const childID = r.child ?? r.attributed;
          if (childID) { try { child = await identity(childID as typeof caller.sessionID,'unknown'); } catch { throw new ProgressError('assignment'); } }
          const reference = r.source ?? previous?.document.path;
          const capture = reference && r.op !== 'stage' ? await captureDocument(reference,actor.directory,resource => ctx.permission.assert({sessionID:caller.sessionID,agent:caller.agent,source:{type:'tool',messageID:caller.messageID,id:caller.id},action:'read',resources:[resource]}),r.op === 'bind' || r.op === 'start' ? undefined : previous ? {...previous.document,canonicalPath:previous.boundCanonicalPath} : undefined) : undefined;
          const receipt = store.apply(r,actor,capture,child);
          return {content:JSON.stringify(receipt)};
        } catch (e) {
          const error = e instanceof ProgressError ? e : storageError(e);
          return {content:JSON.stringify({error:error.code,...(error.revision !== undefined ? {rev:error.revision} : {}),...(error.code === 'invalid' && error.hint ? {hint:error.hint} : {})})};
        }
      },
    });
  });
  const control = store.db.prepare('SELECT enabled FROM meta WHERE singleton=1');
  deactivate = await registerActivation(ctx,b.source,()=>control.get()?.enabled===1,{
    storeId:b.storeId,
    read:request=>store.resumePlans(request),
    identity:(sessionID,alive,signal)=>identity(sessionID,'unknown',{alive,signal}),
  });
  delegation = await registerDelegation(ctx,{
    store,sourceId:b.source.id,
    identity:(sessionID,alive,signal)=>sessionIdentity(ctx,b.source,sessionID,'unknown',{alive,signal,sameScope:true}),
  });
  await ctx.rpc.register(ProgressStatus,{inspect:async()=>{const tool=(await ctx.tool.list()).find(t=>t.id==='agent_progress_report');return{protocolVersion:2,version:b.version,storeId:b.storeId,sourceId:b.source.id,captureEnabled:store.list({limit:1}).captureEnabled,toolAvailable:!!tool,codemodeDisabled:tool?.options?.codemode===false};}});
  store.observeLoaded(b.source.id,b.installId,activationFingerprint(b,readFileSync(fileURLToPath(import.meta.url)),readFileSync(new URL('./SKILL.md',import.meta.url))));
  return async () => { try { await delegation?.dispose(); await deactivate?.(); } finally { store.close(); } };
  } catch(error) {
    // No disposer is returned when setup rejects. Never strand the opened store,
    // and do not let a secondary close failure replace the setup diagnostic.
    try { await delegation?.dispose(); } catch { /* preserve setup diagnostic */ }
    try { await deactivate?.(); } catch { /* preserve setup diagnostic */ }
    try { store.close(); } catch { /* preserve the original setup failure */ }
    throw error;
  }
} });

const START_HELP = `Every mutation requires a fresh oid and expected rev; reuse an oid only for an identical retry. New start requires plan, title, complete items and rev:0. Minimal valid start (replace synthetic IDs/title/items with the real plan):
\`\`\`json
{"op":"start","plan":"synthetic-plan","title":"Synthetic plan","oid":"start-1","rev":0,"items":[{"id":"task-1","title":"Synthetic task","kind":"task","status":"working"}]}
\`\`\`
Read uses only op=read, one concrete plan identifier and optional 0-based page; no wildcard, oid or rev. Omit page for a compact summary without items; explicit page returns paged detail. Read the current revision before updating an existing plan. Source is optional; denied document access still commits valid checklist changes with diagnostics. Never manufacture a file or report automatically on each turn. Empty/all-skipped plans cannot finish successfully.
Coordinator may use op=delegate with plan, oid, expected rev and assign task IDs (max50) for its next subagent delegation; empty assign cancels that plan's pending intent. Declaration is not assignment or dispatch: pending authority is memory-only, expires in five minutes and is lost on restart. Identical retries do not re-arm it. Any installed subagent implementation qualifies only with a matching hook pair, exactly agreeing native call census, matching step.ended and verified immediate child/complete ancestry; ambiguity or missing evidence retires without assignment. These gates prove call correlation and child lineage, not that the tool actually created or continued the child: installed tools are trusted to report the child they delegated to. Slim is covered through these same gates, not separate certification. Use explicit link and assigned parent relay when evidence is unavailable. After restart deliberately re-declare with a fresh oid. Binding never changes task progress, reporting permissions or accepted handoff.`;

const GUIDANCE = `Keep using your canonical planner/task workflow. This tool mirrors it, never replaces it. If not already reported, report at meaningful start/change/delegation/finish boundaries, not on a timer. Repeated guidance alone is not a reason to report again. Activity/idle/age never means completion. Structured/conversation-only plans need no source; never manufacture a file. Document-backed plans may explicitly name their canonical source, subject to report-time read permissions. Authored/Ready is not reviewed/accepted; worker completion is not accepted handoff. Needs-input keeps actual work pending/blocked. Never invent review work or infer progress from file writes.
Tracker updates are not Agent Progress reports. For tracked plan work, explicitly mirror meaningful unreported canonical state at PLAN_READY handoff, review approval, owner approval and work start; do not report again if already current. These are actual canonical states, not events the plugin detects. At PLAN_READY mirror the actionable structure, not implementation completion or approval. Review approval and owner approval are separate; reflect existing canonical gate/work items only, never invent review tasks to report. Work start means actual work, not a dispatch having run.
Conditional native dispatch/tracker hints ask only whether meaningful canonical state remains unreported. They are not report receipts, assignments or evidence of work start, review, approval or completion; already-current state needs no mutation.
${START_HELP}
Blocked tasks may optionally include blocker:{category?,reason?,nextAction?}; categories are decision/dependency/review/external/other. Prose must be nonblank, at most 512 JS code units each, without NUL. Supply purpose-written safe summaries, never private prompts, transcripts or raw tool output; bounds do not redact secrets. Missing parts are unknown. An object completely replaces details; null clears details without resolving status. Omission retains only verified-current details on a continuously blocked task. Groups reject blocker; non-null objects require blocked status. A metadata-only change repeats status:"blocked". Start/revise/staged task entries also accept blocker; staging publishes nothing before commit. Leaving blocked or closing clears details; re-entry/reopen without an explicit object is unknown. Older writers can invalidate optional details: deliberately re-report rather than resurrecting text. Do not send unsupported fields automatically to older tools. Waiting durations are derived from reported status history, not caller input, actual model activity or approval.
Start unrelated objectives as separate plan IDs. Mirror the complete structure once with stable item IDs; groups are not work. Start with op=start, plan/title/items, oid and rev=0. Routine changes send only changes:[{id,status}] with the latest rev and a fresh oid. Batch changes. Status: pending, working, blocked, done, skipped. Read after compaction/conflict before writing. Retry identical input with the same oid only; altered reuse refuses.
Large structures: op=stage with upload/chunk/items (max50/chunk and16KiB/request; at most32 chunks/1000 items), then op=commit with upload/chunks/title and expected rev. Chunks are not a committed plan. Explicitly report limits rather than dropping work. Never truncate a plan or call staging complete. Revise retains item statuses unless explicitly changed. Bind a canonical file using op=bind/source; confirm=true only when its checklist is mirrored. The original document remains authoritative; permission/read failure still commits valid checklist changes with diagnostics.
Coordinator explicitly links a verified child session with op=link, child and assign IDs; pass plan/item IDs in the assignment. Children report assigned items only. Unlinked/unknown children stay independent. Restricted children may be relayed explicitly using attributed child ID after valid linking; this labels the parent reporter honestly, never impersonates a child. Do not loosen child restrictions. Finish is explicit: outcome finished only with actionable work all resolved; cancelled/failed retain unfinished work. Closed plans require explicit coordinator revise/commit with reopen=true. No inference, passive scraping, document rewriting or hidden assignments.`;
