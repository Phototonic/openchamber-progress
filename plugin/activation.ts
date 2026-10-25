import type { Plugin } from '@opencode/plugin';
import type { ToolHooks } from '@opencode/plugin/effect/tool';
import path from 'node:path';

const REPORT_TOOL = 'agent_progress_report';
export const ACTIVATION_GUIDANCE = `# Agent progress (companion)
Keep your canonical planner. If not already reported, deliberately mirror actionable plans and meaningful changes with agent_progress_report; repeated guidance alone is not a reason to report again. Use stable plan/item IDs, batch changes, and read current state after compaction or a revision conflict.
For document-backed plans, explicitly name the canonical source only when appropriate; report-time read permissions still apply. Structured or conversation-only plans need items but no source: never manufacture a file.
For a plan you own, coordinate structure, delegation and explicit finish/cancel/fail. For another session's plan, contribute only explicitly assigned items; parentage or an agent name grants no authority. Unlinked work stays independent. Never bypass restricted-child tool policies; a permitted parent may explicitly relay an assigned child's progress without impersonating it.
Needs-input leaves actual work pending or blocked. A successful write is not readiness; Ready is not review or acceptance, and worker completion is not accepted handoff. Never infer completion from activity or invent review work.`;
export const ACTIVATION_HINT = 'A possible plan document was written or revised. If this is your plan and you have not already reported the relevant structure/change, use the progress report tool; otherwise continue your workflow.';

const record = (value: unknown): value is Record<string, any> => typeof value === 'object' && value !== null;
const boundedID = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 512;

// Lexical metadata only. Neither the path nor any document/diff text is retained.
function possiblePath(value: unknown): value is string {
  if (typeof value !== 'string' || !value || value.length > 4096 || /[\x00-\x1f\x7f]/.test(value)) return false;
  const name = path.basename(value).toLowerCase();
  if (!/\.(md|markdown)$/.test(name) || /^(readme|todo)\.(md|markdown)$/.test(name)) return false;
  return /^plan\.(md|markdown)$/.test(name) || path.normalize(value).split(path.sep).slice(0, -1).some(part => part === 'plans' || part === '.plans');
}
function planPath(value: string, directory: string) {
  const relative = path.relative(directory, path.resolve(directory, value));
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return false;
  const parts = relative.split(path.sep);
  return /^plan\.(md|markdown)$/i.test(parts.at(-1)!) || parts.slice(0, -1).some(part => part === 'plans' || part === '.plans');
}
function successfulPath(event: ToolHooks['execute.after']): string | undefined {
  if (event.tool !== 'write' && event.tool !== 'edit') return;
  if (event.status !== 'completed' || !record(event.input) || !possiblePath(event.input.path)) return;
  const result = event.result;
  const output = result.output;
  // No successful-partial variant exists for the pinned single-file tools. Also
  // fail closed on an explicit partial marker from an unknown/extended shape.
  if (!record(output) || output.partial === true || result.metadata?.partial === true) return;
  if (event.tool === 'write') {
    if (output.operation === 'write' && typeof output.existed === 'boolean' && typeof output.target === 'string' && typeof output.resource === 'string') return event.input.path;
  } else if (Number.isSafeInteger(output.replacements) && output.replacements > 0 && Array.isArray(output.files) && output.files.length === 1 && typeof output.files[0]?.file === 'string') return event.input.path;
}

/** Advisory only; no executor, receipt, capture, plan lookup or mutation access. */
export async function registerActivation(ctx: Plugin.Context, source: { id: string; verified: boolean }, enabled: () => boolean) {
  const pending = new Set<string>(); // max128 source/session flags
  const recent = new Set<string>(); // max256 qualifying source/session/message/call IDs
  const owned = Symbol('agent-progress-section');
  const registrations: Array<{ dispose(): Promise<void> }> = [];
  let disposed = false;
  let disableEpoch = 0; // invalidates in-flight lookups when disable is observed
  function control() {
    if (enabled() === true) return true;
    pending.clear(); disableEpoch++; return false;
  }
  function remember(set: Set<string>, key: string, cap: number) {
    set.add(key);
    if (set.size > cap) set.delete(set.values().next().value!);
  }
  const key = (sessionID: string) => JSON.stringify([source.id, sessionID]);
  async function session(sessionID: Parameters<Plugin.Context['session']['get']>[0]['sessionID']) {
    const value = await ctx.session.get({ sessionID });
    // Conditional copy needs no ancestry or plan scan; reporting still performs
    // its unchanged authoritative ancestry/assignment checks at the executor.
    return value.id === sessionID && path.isAbsolute(value.location.directory) ? value : undefined;
  }
  async function dispose() {
    disposed = true; pending.clear(); recent.clear();
    for (const registration of registrations.splice(0)) {
      try { await registration.dispose(); } catch { /* host scope also owns cleanup */ }
    }
  }
  try {
    registrations.push(await ctx.tool.hook('execute.after', async event => {
      try {
        if (disposed || !source.verified) return;
        const candidate = successfulPath(event);
        if (!candidate || !boundedID(event.sessionID) || !boundedID(event.messageID) || !boundedID(event.id)) return;
        const call = JSON.stringify([source.id, event.sessionID, event.messageID, event.id]);
        if (recent.has(call) || !control()) return;
        const epoch = disableEpoch;
        const caller = await session(event.sessionID);
        if (disposed || epoch !== disableEpoch || !control() || !caller || !planPath(candidate, caller.location.directory) || recent.has(call)) return;
        remember(recent, call, 256);
        remember(pending, key(event.sessionID), 128);
      } catch { /* observation must never fail or change the original tool */ }
    }));
    registrations.push(await ctx.session.hook('context', async event => {
      const removeOwned = () => {
        for (let i = event.system.length - 1; i >= 0; i--) if (Object.prototype.hasOwnProperty.call(event.system[i], owned)) event.system.splice(i, 1);
      };
      try {
        if (disposed) { removeOwned(); return; }
        if (!boundedID(event.sessionID)) return;
        const sessionKey = key(event.sessionID);
        if (!source.verified || !Object.prototype.hasOwnProperty.call(event.tools, REPORT_TOOL) || !control()) {
          pending.delete(sessionKey); removeOwned(); return;
        }
        const epoch = disableEpoch;
        const caller = await session(event.sessionID);
        if (disposed || epoch !== disableEpoch) { removeOwned(); return; }
        if (!caller || !control()) { pending.delete(sessionKey); removeOwned(); return; }
        if (event.system.some(part => Object.prototype.hasOwnProperty.call(part, owned))) return;
        const section = { type: 'text' as const, text: ACTIVATION_GUIDANCE + (pending.has(sessionKey) ? `\n\n${ACTIVATION_HINT}` : '') };
        Object.defineProperty(section, owned, { value: true });
        event.system.push(section);
        pending.delete(sessionKey); // consume on delivery, not on a report receipt
      } catch { pending.delete(key(event.sessionID)); try { removeOwned(); } catch { /* malformed/immutable host context */ } }
    }));
    return dispose;
  } catch (error) { await dispose(); throw error; }
}
