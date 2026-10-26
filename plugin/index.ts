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

export default Plugin.define({ id:'agent-progress', async setup(ctx) {
  const b = readBinding(process.env.AGENT_PROGRESS_BINDING ?? new URL('./progress-binding.json',import.meta.url));
  const configRoot = path.join(process.env.XDG_CONFIG_HOME || path.join(homedir(),'.config'),'opencode');
  const dataRoot = path.join(process.env.XDG_DATA_HOME || path.join(homedir(),'.local/share'),'opencode');
  need(!process.env.OPENCODE_DB && !process.env.OPENCODE_CONFIG_DIR && realpathSync(configRoot) === b.source.configRoot && realpathSync(dataRoot) === b.source.dataRoot,'binding');
  const store = new Store(b.database);
  let deactivate: (() => Promise<void>) | undefined;
  try {
  verifyStore(store,b);store.bindReads(b.source.id,b.source.verified);
  async function identity(sessionID: Parameters<typeof ctx.session.get>[0]['sessionID'], agent: string): Promise<Actor> {
    let s:Awaited<ReturnType<typeof ctx.session.get>>;
    try{s=await ctx.session.get({sessionID});}catch{throw new ProgressError('binding');}
    need(s.id === sessionID && path.isAbsolute(s.location.directory),'binding');
    const ancestry: string[] = []; let parent = s.parentID; const seen = new Set<string>([s.id]); let known = true;
    while (parent) {
      if (seen.has(parent) || ancestry.length >= 32) { known = false; break; }
      seen.add(parent); ancestry.push(parent);
      try { parent = (await ctx.session.get({sessionID:parent})).parentID; } catch { known = false; break; }
    }
    return {sourceId:b.source.id,sessionId:s.id,agent:agent==='unknown'?s.agent??'unknown':agent,directory:s.location.directory,projectId:s.projectID,parentId:s.parentID ?? null,ancestry:known ? ancestry : null,verifiedSource:b.source.verified};
  }
  await ctx.skill.transform(editor => editor.add({ id:Skill.ID.make('agent-progress'),name:Skill.Name.make('Agent progress'),description:'Mirror canonical plans and deliberate progress without replacing your planner.',path:Skill.Info.fields.path.make(fileURLToPath(new URL('./SKILL.md',import.meta.url))),content:GUIDANCE }));
  await ctx.tool.transform(editor => {
    editor.namespace({name:'agent_progress',description:'Deliberate plan progress; never inferred from activity.'});
    editor.add({ name:'report',description:`Start/read plans, batch status changes, revise structure, link children, bind source documents or explicitly finish. ${START_HELP} Read agent-progress guidance for chunked commits and delegation.`,input:REPORT_SCHEMA,options:{namespace:'agent_progress',codemode:false},
      execute: async (value,caller) => {
        try {
          const r = parseRequest(value); const actor = await identity(caller.sessionID,caller.agent);
          if (r.op === 'read') {
            const view=store.detail(actor.sourceId,r.plan,r.page??0);
            return {content:JSON.stringify(r.page===undefined?{plan:r.plan,rev:view.plan.revision,structuralRev:view.plan.structuralRevision,lifecycle:view.plan.lifecycle,counts:view.plan.counts,documentState:view.plan.document.state,detailPageSize:20}:view)};
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
  deactivate = await registerActivation(ctx,b.source,()=>control.get()?.enabled===1);
  await ctx.rpc.register(ProgressStatus,{inspect:async()=>{const tool=(await ctx.tool.list()).find(t=>t.id==='agent_progress_report');return{protocolVersion:2,version:b.version,storeId:b.storeId,sourceId:b.source.id,captureEnabled:store.list({limit:1}).captureEnabled,toolAvailable:!!tool,codemodeDisabled:tool?.options?.codemode===false};}});
  store.observeLoaded(b.source.id,b.installId,activationFingerprint(b,readFileSync(fileURLToPath(import.meta.url)),readFileSync(new URL('./SKILL.md',import.meta.url))));
  return async () => { try { await deactivate?.(); } finally { store.close(); } };
  } catch(error) {
    // No disposer is returned when setup rejects. Never strand the opened store,
    // and do not let a secondary close failure replace the setup diagnostic.
    await deactivate?.();
    try { store.close(); } catch { /* preserve the original setup failure */ }
    throw error;
  }
} });

const START_HELP = `Every mutation requires a fresh oid and expected rev; reuse an oid only for an identical retry. New start requires plan, title, complete items and rev:0. Minimal valid start (replace synthetic IDs/title/items with the real plan):
\`\`\`json
{"op":"start","plan":"synthetic-plan","title":"Synthetic plan","oid":"start-1","rev":0,"items":[{"id":"task-1","title":"Synthetic task","kind":"task","status":"working"}]}
\`\`\`
Read uses only op=read, one concrete plan identifier and optional page; no wildcard, oid or rev. Read the current revision before updating an existing plan. Source is optional; denied document access still commits valid checklist changes with diagnostics. Never manufacture a file or report automatically on each turn. Empty/all-skipped plans cannot finish successfully.`;

const GUIDANCE = `Keep using your canonical planner/task workflow. This tool mirrors it, never replaces it. If not already reported, report at meaningful start/change/delegation/finish boundaries, not on a timer. Repeated guidance alone is not a reason to report again. Activity/idle/age never means completion. Structured/conversation-only plans need no source; never manufacture a file. Document-backed plans may explicitly name their canonical source, subject to report-time read permissions. Authored/Ready is not reviewed/accepted; worker completion is not accepted handoff. Needs-input keeps actual work pending/blocked. Never invent review work or infer progress from file writes.
${START_HELP}
Start unrelated objectives as separate plan IDs. Mirror the complete structure once with stable item IDs; groups are not work. Start with op=start, plan/title/items, oid and rev=0. Routine changes send only changes:[{id,status}] with the latest rev and a fresh oid. Batch changes. Status: pending, working, blocked, done, skipped. Read after compaction/conflict before writing. Retry identical input with the same oid only; altered reuse refuses.
Large structures: op=stage with upload/chunk/items (max50/chunk and16KiB/request; at most32 chunks/1000 items), then op=commit with upload/chunks/title and expected rev. Chunks are not a committed plan. Explicitly report limits rather than dropping work. Never truncate a plan or call staging complete. Revise retains item statuses unless explicitly changed. Bind a canonical file using op=bind/source; confirm=true only when its checklist is mirrored. The original document remains authoritative; permission/read failure still commits valid checklist changes with diagnostics.
Coordinator explicitly links a verified child session with op=link, child and assign IDs; pass plan/item IDs in the assignment. Children report assigned items only. Unlinked/unknown children stay independent. Restricted children may be relayed explicitly using attributed child ID after valid linking; this labels the parent reporter honestly, never impersonates a child. Do not loosen child restrictions. Finish is explicit: outcome finished only with actionable work all resolved; cancelled/failed retain unfinished work. Closed plans require explicit coordinator revise/commit with reopen=true. No inference, passive scraping, document rewriting or hidden assignments.`;
