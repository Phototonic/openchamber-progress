/** Production plugin through installed2.1.4 adapter; fake host, real SQLite. */
import fs from 'node:fs';
import { Effect, DateTime, Stream } from 'effect';
import { fromPromise } from '@opencode/plugin/promise/adapter';
import plugin from '../../plugin/index.ts';
import { lifecycle } from '../../setup/lifecycle.ts';
import { Store } from '../../shared/store.ts';
import { RELEASE } from '../../shared/release.ts';

type Callback = (event: any) => Effect.Effect<void>;
export async function activationFixture(run: (fixture: any) => Promise<void>, verified = true) {
  const root = fs.mkdtempSync('/tmp/opencode/agent-progress-activation-unit-');
  const saved = new Map<string, string | undefined>();
  let store: Store | undefined;
  try {
    for (const dir of ['config/opencode', 'data/opencode', 'project']) fs.mkdirSync(`${root}/${dir}`, { recursive: true, mode: 0o700 });
    lifecycle('install', { configRoot: `${root}/config/opencode`, dataRoot: `${root}/data/opencode`, storeRoot: `${root}/store`, confirmed: true }, { plugin: '// fixture payload', guidance: 'fixture', removal: '// fixture', version: RELEASE });
    const bindingPath = `${root}/config/opencode/plugins/agent-progress/progress-binding.json`;
    const binding = JSON.parse(fs.readFileSync(bindingPath, 'utf8'));
    store = new Store(binding.database);
    if (!verified) { binding.source.verified = false; store.db.prepare('UPDATE sources SET verified=0').run(); fs.writeFileSync(bindingPath, JSON.stringify(binding)); }
    for (const [name, value] of Object.entries({ AGENT_PROGRESS_BINDING: bindingPath, XDG_CONFIG_HOME: `${root}/config`, XDG_DATA_HOME: `${root}/data`, OPENCODE_CONFIG_DIR: undefined, OPENCODE_DB: undefined })) {
      saved.set(name, process.env[name]); if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    const hooks = new Map<string, Callback>();
    const tools = new Map<string, any>();
    const permissions: any[] = [];
    let lookupCount = 0, closed = false, cleanup: any;
    const info = (id: string) => ({ id, agent: 'coordinator-x', projectID: 'fixture-project', location: { directory: `${root}/project` }, cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }, time: { created: DateTime.makeUnsafe(0), updated: DateTime.makeUnsafe(0) } });
    const f: any = { root, binding, store, hooks, tools, permissions, info, lookup: async (id: string) => info(id), denyRead: false, get lookupCount() { return lookupCount; } };
    const registration = () => ({ dispose: Effect.void });
    const hook = (domain: string) => (name: string, callback: Callback) => Effect.gen(function* () {
      const key = `${domain}:${name}`; hooks.set(key, callback);
      const dispose = Effect.sync(() => { if (hooks.get(key) === callback) hooks.delete(key); });
      yield* Effect.addFinalizer(() => dispose); return { dispose };
    });
    const domains: Record<string, any> = {
      event: { subscribe: () => Stream.empty },
      session: { hook: hook('session'), get: ({ sessionID }: any) => Effect.tryPromise({ try: async () => { lookupCount++; return f.lookup(sessionID); }, catch: error => error }) },
      tool: { hook: hook('tool'), transform: (callback: any) => Effect.sync(() => { callback({ namespace() {}, add(value: any) { tools.set('agent_progress_report', value); } }); return registration(); }), list: () => Effect.succeed([...tools].map(([id, value]) => ({ id, ...value }))) },
      skill: { transform: (callback: any) => Effect.sync(() => { callback({ add(value: any) { f.skill = value; } }); return registration(); }) },
      permission: { assert: (input: any) => Effect.tryPromise({ try: async () => { permissions.push(input); if (f.denyRead) throw new Error('synthetic denied read'); }, catch: error => error }) },
      rpc: Object.assign(() => {}, { register: () => Effect.succeed({ dispose: Effect.void, events: { emit: () => Effect.void } }) }),
    };
    const unused: any = new Proxy(() => {}, { get: () => unused });
    const host: any = new Proxy({}, { get: (_, name) => domains[String(name)] ?? unused });
    f.dispose = async () => { if (!closed) { closed = true; await cleanup?.(); } };
    const adapted = fromPromise({ ...plugin, async setup(ctx) {
      cleanup = await plugin.setup(ctx);
      f.reload = async () => { await f.dispose(); closed = false; cleanup = await plugin.setup(ctx); };
      return f.dispose;
    } });
    const deliver = (key: string, event: any) => Effect.runPromise(hooks.get(key)!(event));
    f.after = (event: any) => deliver('tool:execute.after', event);
    f.context = (event: any) => deliver('session:context', event);
    f.report = async (value: any, sessionID = 'ses_M') => {
      const result = await Effect.runPromise(tools.get('agent_progress_report').execute(value, { sessionID, agent: 'coordinator-x', messageID: 'msg_report', id: 'call_report', progress: () => Effect.void }) as Effect.Effect<any>);
      return JSON.parse(result.content);
    };
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () { yield* adapted.effect(host); yield* Effect.promise(() => run(f)); })));
  } finally {
    store?.close();
    for (const [name, value] of saved) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
    fs.rmSync(root, { recursive: true, force: true });
  }
}

export const activationContext = (sessionID = 'ses_M', available = true): any => ({ sessionID, agent: 'coordinator-x', model: { providerID: 'fixture', id: 'script' }, system: [{ type: 'text', text: 'Other system section' }], messages: [{ role: 'user', content: 'Make a plan' }], tools: available ? { agent_progress_report: { description: 'fixture', input: {} } } : {}, options: { temperature: 0.2 } });
export function writeEvent(file = 'docs/plans/search.md', id = 'call_write', sessionID = 'ses_M'): any {
  return { tool: 'write', sessionID, agent: 'coordinator-x', messageID: 'msg_write', id, input: { path: file, content: 'Incomplete synthetic draft' }, status: 'completed', result: { output: { operation: 'write', target: `/fixture/${file}`, resource: file, existed: false } } };
}
