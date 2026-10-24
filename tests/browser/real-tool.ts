// Loads the INSTALLED companion (ownership/hash-checking loader → release payload) of an isolated
// root and exposes its registered `agent_progress_report` tool, called exactly as OpenCode would,
// with caller identity taken from real session records of that isolated host.
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

export type SessionRecord = { id: string; location: { directory: string }; parentID?: string | null; projectID?: string; agent?: string };
type Tool = { execute: (value: unknown, caller: Record<string, unknown>) => Promise<{ content: string }> };

let resolverRegistered = false;

export async function loadReportTool(root: string, sessions: Record<string, SessionRecord>) {
  if (!resolverRegistered) {
    // OpenCode supplies `effect` to plugins at runtime; resolve the same pinned package for Node.
    const repoModules = pathToFileURL(path.resolve('node_modules') + '/').href;
    register(`data:text/javascript,${encodeURIComponent(`
export async function resolve(specifier, context, next) {
  if (specifier === 'effect' || specifier.startsWith('effect/')) return next(specifier, { ...context, parentURL: ${JSON.stringify(repoModules)} });
  return next(specifier, context);
}`)}`);
    resolverRegistered = true;
  }
  // The plugin verifies these resolve to the bound config/data roots.
  process.env.HOME = `${root}/home`;
  process.env.XDG_CONFIG_HOME = `${root}/config`;
  process.env.XDG_DATA_HOME = `${root}/data`;
  delete process.env.OPENCODE_DB;
  delete process.env.OPENCODE_CONFIG_DIR;

  const byId = new Map(Object.values(sessions).map((s) => [s.id, s]));
  let denied: string[] = [];
  let tool: Tool | undefined;
  const ctx = {
    session: { get: async ({ sessionID }: { sessionID: string }) => { const s = byId.get(sessionID); if (!s) throw new Error('not-found'); return { ...s, parentID: s.parentID ?? undefined }; } },
    skill: { transform: async (fn: (e: unknown) => void) => fn({ add() {} }) },
    tool: {
      transform: async (fn: (e: unknown) => void) => fn({ namespace() {}, add(def: Tool) { tool = def; } }),
      list: async () => (tool ? [{ id: 'agent_progress_report', options: { codemode: false } }] : []),
    },
    rpc: { register: async () => {} },
    // Caller permission: allowed unless the caller simulates a user denial for this resource.
    permission: { assert: async ({ resources }: { resources: string[] }) => { if (resources.some((r) => denied.includes(r))) throw Object.assign(new Error('denied'), { code: 'EPERM' }); } },
  };
  const loader = `${root}/config/opencode/plugins/agent-progress/index.js`;
  const plugin = (await import(pathToFileURL(loader).href)).default as { setup: (c: typeof ctx) => Promise<() => void> };
  const dispose = await plugin.setup(ctx);
  if (!tool) throw new Error('report tool not registered');
  const registered = tool;
  let n = 0;

  /** One report as session `as`; `rev: 'auto'` reads the current revision through the tool first, as an agent would. */
  async function report(as: string, input: Record<string, unknown>, deny: string[] = []) {
    const caller = sessions[as];
    if (!caller) throw new Error(`unknown session ${as}`);
    denied = deny;
    const who = { sessionID: caller.id, agent: caller.agent ?? 'build', messageID: `msg_seed_${n}`, id: `call_seed_${n}` };
    n++;
    const body = { ...input };
    if (body.rev === 'auto') {
      const current = JSON.parse((await registered.execute({ op: 'read', plan: body.plan }, who)).content) as { rev?: number; error?: string };
      if (typeof current.rev !== 'number') throw new Error(`read failed for ${String(body.plan)}: ${current.error}`);
      body.rev = current.rev;
    }
    return JSON.parse((await registered.execute(body, who)).content) as Record<string, unknown>;
  }
  return { report, dispose: () => dispose?.() };
}
