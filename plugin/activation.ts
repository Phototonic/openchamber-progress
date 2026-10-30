import type { Plugin } from '@opencode/plugin';
import type { ToolHooks } from '@opencode/plugin/effect/tool';
import path from 'node:path';
import { identifier } from '../shared/progress.ts';
import type { ResumeRead, ResumeRequest, ResumeSelection } from '../shared/progress-resume.ts';

const REPORT_TOOL = 'agent_progress_report';
export const ACTIVATION_GUIDANCE = `# Agent progress (companion)
Keep your canonical planner. If not already reported, deliberately mirror actionable plans and meaningful changes with agent_progress_report; repeated guidance alone is not a reason to report again. Use stable plan/item IDs, batch changes, and read current state after compaction or a revision conflict.
Tracker updates are not Agent Progress reports. For tracked plan work, explicitly mirror meaningful unreported canonical state at PLAN_READY handoff, review approval, owner approval and work start; do not report again if already current. These are actual canonical states, not events the plugin detects. At PLAN_READY mirror the actionable structure, not implementation completion or approval. Review approval and owner approval are separate; reflect existing canonical gate/work items only, never invent review tasks to report. Work start means actual work, not a dispatch having run.
For document-backed plans, explicitly name the canonical source only when appropriate; report-time read permissions still apply. Structured or conversation-only plans need items but no source: never manufacture a file.
For a plan you own, coordinate structure, delegation and explicit finish/cancel/fail; finish successfully only when actionable work is all resolved. For another session's plan, contribute only explicitly assigned items; parentage or an agent name grants no authority. Unlinked work stays independent. Never bypass restricted-child tool policies; a permitted parent may explicitly relay an assigned child's progress without impersonating it.
Needs-input leaves actual work pending or blocked. A successful write is not readiness; Ready is not review or acceptance, and worker completion is not accepted handoff. Never infer completion from activity or invent review work. Never manufacture a file or report automatically on each turn.`;
export const ACTIVATION_HINT = 'A possible plan document was written or revised, possibly by a delegated child. Mirror only meaningful unreported canonical work you own or are authorized to coordinate, using the progress report tool; otherwise continue your workflow. This hint grants no assignment or authority.';

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

type SessionID = Parameters<Plugin.Context['session']['get']>[0]['sessionID'];
export interface ResumeActivation {
  storeId: string;
  read: ResumeRead;
  identity: (sessionID: SessionID, alive: () => boolean, signal: AbortSignal) => Promise<Pick<ResumeRequest, 'sourceId' | 'sessionId' | 'parentId' | 'ancestry'>>;
  /** Monotonic clock injection for deadline tests; never persisted. */
  now?: () => number;
}

function resumeText(selection: ResumeSelection): string {
  let candidates = selection.candidates.slice(0, 3);
  let omitted = selection.omitted || selection.candidates.length > 3;
  while (candidates.length) {
    const unconfirmed = selection.incomplete || omitted || candidates.length !== 1;
    const text = [
      unconfirmed ? '## Progress resume — unconfirmed candidates' : '## Progress resume — recorded pointer',
      'Read current state before any mutation, including after a conflict. This selects no action and grants no new permission.',
      ...(unconfirmed ? ['Read and confirm a target before reporting.'] : []),
      ...(selection.incomplete || omitted ? ['Additional eligible candidates may exist; discovery or output is incomplete.'] : []),
      'Progress source IDs below are namespace metadata, not the tool’s document-path source argument.',
      ...candidates.map(p => `- source ${p.sourceId}; plan ${p.plan}; title ${JSON.stringify(p.title)}; last-known revision ${p.revision}. Read: agent_progress_report ${JSON.stringify({ op: 'read', plan: p.plan })}` +
        (p.scope === 'assigned' ? `\n  Assigned-only scope: ${JSON.stringify(p.itemIds)}. Contribute only these assigned item IDs; no broader scope is implied.` : '')),
    ].join('\n');
    if (Buffer.byteLength(text, 'utf8') <= 4096) return text;
    candidates = candidates.slice(0, -1); omitted = true;
  }
  return '';
}

/** Advisory only; optional bounded read projection, never executor/receipt/capture/mutation access. */
export async function registerActivation(ctx: Plugin.Context, source: { id: string; verified: boolean }, enabled: () => boolean, recovery?: ResumeActivation) {
  const pending = new Set<string>(); // max128 source/session flags
  const recent = new Set<string>(); // max256 qualifying source/session/message/call IDs
  const owned = Symbol('agent-progress-section');
  function section(hint: boolean, capsule = '') {
    const part = { type: 'text' as const, text: ACTIVATION_GUIDANCE + (hint ? `\n\n${ACTIVATION_HINT}` : '') + (capsule ? `\n\n${capsule}` : '') };
    Object.defineProperty(part, owned, { value: { hint } });
    return part;
  }
  const registrations: Array<{ dispose(): Promise<void> }> = [];
  let disposed = false;
  let disableEpoch = 0; // invalidates in-flight lookups when disable is observed
  type Compaction = {
    seq: number; fence: number; pending: boolean;
    start?: { reason: 'auto' | 'manual'; created: number };
    firstHook?: number; lastHook?: number; ambiguous?: boolean;
  };
  const compactions = new Map<string, Compaction>(); // max128; identities only, never plan payloads
  const replay = new Set<string>(); // max256 source/session/event identities
  let eventFloor = Date.now(); // eviction/reload must not reconstruct old attempts
  let binding = JSON.stringify([source.id, source.verified, recovery?.storeId]);
  let recoveryAvailable = false, lookupBusy = false;
  let stopRecovery: (() => Promise<void>) | undefined;
  let held: AbortController | undefined;
  function retireRecovery() {
    eventFloor = Math.max(eventFloor, Date.now());
    // A clock rollback must not erase a newer retained retirement boundary.
    for (const attempt of compactions.values()) eventFloor = Math.max(eventFloor, attempt.fence);
    compactions.clear(); held?.abort();
  }
  function control() {
    const current = JSON.stringify([source.id, source.verified, recovery?.storeId]);
    if (current !== binding) { binding = current; retireRecovery(); pending.clear(); disableEpoch++; }
    try { if (enabled() === true) return true; } catch { /* unavailable control is not enabled */ }
    pending.clear(); retireRecovery(); disableEpoch++; return false;
  }
  function remember(set: Set<string>, key: string, cap: number) {
    set.add(key);
    if (set.size > cap) set.delete(set.values().next().value!);
  }
  const key = (sessionID: string) => JSON.stringify([source.id, sessionID]);
  function retain(sessionKey: string, attempt: Compaction, created: number) {
    compactions.delete(sessionKey); compactions.set(sessionKey, attempt);
    if (compactions.size > 128) {
      const oldest = compactions.keys().next().value!;
      // Removing a tombstone must not erase a newer primary-retirement fence.
      eventFloor = Math.max(eventFloor, created, compactions.get(oldest)!.fence);
      compactions.delete(oldest);
    }
  }
  function clearWindow(attempt: Compaction) {
    delete attempt.start; delete attempt.firstHook; delete attempt.lastHook; delete attempt.ambiguous;
  }
  async function session(sessionID: Parameters<Plugin.Context['session']['get']>[0]['sessionID']) {
    const value = await ctx.session.get({ sessionID });
    // Conditional copy needs no plan scan; reporting still performs
    // its unchanged authoritative ancestry/assignment checks at the executor.
    return value.id === sessionID && path.isAbsolute(value.location.directory) ? value : undefined;
  }
  async function dispose() {
    disposed = true; pending.clear(); recent.clear(); retireRecovery(); replay.clear();
    await stopRecovery?.();
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
        let parentID: string | undefined;
        if (boundedID(caller.parentID) && caller.parentID !== caller.id) {
          try {
            const parent = await session(caller.parentID);
            if (parent && boundedID(caller.projectID) && parent.projectID === caller.projectID
              && path.resolve(parent.location.directory) === path.resolve(caller.location.directory)
              && parent.parentID !== parent.id && parent.parentID !== caller.id) parentID = parent.id;
          } catch { /* an unverifiable parent cannot remove the independent writer hint */ }
        }
        // Resolve recipients before one synchronous commit. Concurrent duplicate
        // callbacks must not repopulate either flag after an intervening delivery.
        if (disposed || epoch !== disableEpoch || !control() || recent.has(call)) return;
        remember(recent, call, 256);
        remember(pending, key(event.sessionID), 128);
        if (parentID) remember(pending, key(parentID), 128);
      } catch { /* observation must never fail or change the original tool */ }
    }));
    registrations.push(await ctx.session.hook('context', async event => {
      const removeOwned = () => {
        for (let i = event.system.length - 1; i >= 0; i--) if (Object.prototype.hasOwnProperty.call(event.system[i], owned)) event.system.splice(i, 1);
      };
      try {
        // A reused host array may carry old text, but never a reusable recovery payload.
        for (let i = 0; i < event.system.length; i++) if (Object.prototype.hasOwnProperty.call(event.system[i], owned)) {
          event.system[i] = section((event.system[i] as any)[owned].hint);
        }
        if (disposed) { removeOwned(); return; }
        if (!boundedID(event.sessionID)) return;
        const sessionKey = key(event.sessionID);
        const active = control();
        const attempt = compactions.get(sessionKey) ?? { seq: 0, fence: eventFloor, pending: false };
        const armed = attempt?.pending === true;
        // Consume incomplete evidence too, before any await. Delayed stream parts
        // created before this primary cannot backfill a later turn.
        attempt.pending = false; clearWindow(attempt);
        attempt.fence = Math.max(attempt.fence, Date.now());
        if (recovery && active) retain(sessionKey, attempt, attempt.fence);
        if (!source.verified || !Object.prototype.hasOwnProperty.call(event.tools, REPORT_TOOL) || !active) {
          pending.delete(sessionKey); removeOwned(); return;
        }
        const epoch = disableEpoch;
        const caller = await session(event.sessionID);
        if (disposed || epoch !== disableEpoch) { removeOwned(); return; }
        if (!caller || !control()) { pending.delete(sessionKey); removeOwned(); return; }
        let capsule = '';
        if (armed && recovery && recoveryAvailable && !lookupBusy && compactions.get(sessionKey) === attempt) {
          const controller = new AbortController(); held = controller;
          const now = recovery.now ?? (() => performance.now());
          const deadline = now() + 1000;
          const alive = () => !controller.signal.aborted && !disposed && recoveryAvailable && control() && epoch === disableEpoch && source.verified && compactions.get(sessionKey) === attempt && now() < deadline;
          let timer: ReturnType<typeof setTimeout> | undefined;
          lookupBusy = true;
          const lookup = (async () => {
            try {
              if (!alive()) return null;
              const identity = await recovery.identity(event.sessionID, alive, controller.signal);
              return alive() ? identity : null;
            } catch { return null; }
            finally { lookupBusy = false; if (held === controller) held = undefined; }
          })();
          try {
            // A provider ignoring abort may leave one request outstanding, never another ancestry hop.
            const identity = await Promise.race([lookup, new Promise<null>(resolve => {
              timer = setTimeout(() => { controller.abort(); resolve(null); }, 1000);
            })]);
            if (identity && alive() && Object.prototype.hasOwnProperty.call(event.tools, REPORT_TOOL) && identity.sourceId === source.id && identity.sessionId === event.sessionID) {
              const selection = recovery.read({ storeId: recovery.storeId, sourceId: identity.sourceId, sessionId: identity.sessionId, parentId: identity.parentId, ancestry: identity.ancestry });
              if (selection && selection.storeId === recovery.storeId && selection.sourceId === source.id && selection.sessionId === event.sessionID) capsule = resumeText(selection);
            }
          } catch { /* optional recovery faults preserve eligible base guidance */ }
          finally { if (timer !== undefined) clearTimeout(timer); controller.abort(); }
        }
        if (disposed || !control() || epoch !== disableEpoch || !source.verified || !Object.prototype.hasOwnProperty.call(event.tools, REPORT_TOOL)) { removeOwned(); return; }
        const existing = event.system.findIndex(part => Object.prototype.hasOwnProperty.call(part, owned));
        if (existing !== -1) { if (capsule) event.system[existing] = section((event.system[existing] as any)[owned].hint, capsule); return; }
        const hint = pending.has(sessionKey);
        event.system.push(section(hint, capsule));
        pending.delete(sessionKey); // consume on delivery, not on a report receipt
      } catch { pending.delete(key(event.sessionID)); try { removeOwned(); } catch { /* malformed/immutable host context */ } }
    }));
    if (recovery) {
      const abort = new AbortController();
      let registration: { dispose(): Promise<void> } | undefined;
      let events: Promise<void> | undefined;
      stopRecovery = async () => { abort.abort(); await events; };
      try {
        const stream = ctx.event.subscribe({ signal: abort.signal });
        if (!stream || typeof stream[Symbol.asyncIterator] !== 'function') throw new Error('unsupported');
        registration = await ctx.session.hook('compaction', event => {
          // Observe metadata only; never inspect/change summaries, messages, tools or result.
          if (disposed || !control() || !source.verified || !boundedID(event.sessionID) || !identifier(event.sessionID)) return;
          const sessionKey = key(event.sessionID), observed = Date.now();
          const attempt = { ...(compactions.get(sessionKey) ?? { seq: 0, fence: eventFloor, pending: false }) };
          if (!Number.isFinite(observed) || observed <= Math.max(eventFloor, attempt.fence)) {
            attempt.pending = false; clearWindow(attempt);
            retain(sessionKey, attempt, eventFloor); return;
          }
          // A new observation after completion supersedes, never revives, it.
          attempt.pending = false;
          if (attempt.lastHook !== undefined && observed < attempt.lastHook) attempt.ambiguous = true;
          attempt.firstHook ??= observed; attempt.lastHook = observed;
          retain(sessionKey, attempt, observed);
        });
        recoveryAvailable = true;
        events = (async () => {
          try {
            for await (const event of stream) {
              if (disposed || !control() || !source.verified) continue;
              if (event.type !== 'session.compaction.started' && event.type !== 'session.compaction.ended' && event.type !== 'session.compaction.failed') continue;
              const { sessionID, reason } = event.data;
              if (!identifier(sessionID) || !boundedID(event.id) || !Number.isSafeInteger(event.durable.seq) || event.durable.seq < 1 || event.durable.aggregateID !== sessionID || !Number.isFinite(event.created) || event.location?.directory !== ctx.location.directory || (reason !== 'auto' && reason !== 'manual')) continue;
              const sessionKey = key(sessionID);
              // Timestamps are not unique: a cap-advanced floor may also reject a
              // retained session's failure. Retire its old attempt, never arm it.
              if (event.created <= eventFloor) {
                eventFloor = Math.max(eventFloor, compactions.get(sessionKey)?.fence ?? eventFloor);
                compactions.delete(sessionKey); continue;
              }
              const eventKey = JSON.stringify([sessionKey, event.id]);
              const previous = compactions.get(sessionKey);
              if (replay.has(eventKey) || previous && event.durable.seq <= previous.seq) continue;
              remember(replay, eventKey, 256);
              const started = event.type === 'session.compaction.started';
              const ended = event.type === 'session.compaction.ended';
              const next: Compaction = { ...(previous ?? { seq: 0, fence: eventFloor, pending: false }) };
              next.seq = event.durable.seq;
              next.pending = false;
              if (event.created <= next.fence || event.created > Date.now()) {
                clearWindow(next);
              } else if (started) {
                if (next.start) next.ambiguous = true; // no shared attempt token: crossed starts decline
                next.start = { reason, created: event.created };
              } else {
                next.pending = ended && !next.ambiguous && next.start?.reason === reason &&
                  next.firstHook !== undefined && next.lastHook !== undefined &&
                  next.start.created < next.firstHook && next.firstHook <= next.lastHook && next.lastHook < event.created;
                clearWindow(next);
                next.fence = Math.max(next.fence, event.created);
              }
              retain(sessionKey, next, event.created);
            }
          } catch { /* unavailable optional subscription: generic activation stays registered */ }
          finally { recoveryAvailable = false; retireRecovery(); try { await registration?.dispose(); } catch { /* optional cleanup */ } }
        })();
      } catch {
        abort.abort(); recoveryAvailable = false; retireRecovery();
        try { await registration?.dispose(); } catch { /* optional cleanup */ }
      }
    }
    return dispose;
  } catch (error) { await dispose(); throw error; }
}
