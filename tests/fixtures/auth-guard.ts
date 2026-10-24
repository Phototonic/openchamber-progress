/** Isolated M1 fixture ONLY. Never install in real config or reuse with real auth. */
import { Plugin } from '@opencode/plugin';
import { Rpc } from '@opencode/plugin/rpc';
import { readFileSync, writeFileSync, renameSync, realpathSync, lstatSync } from 'node:fs';
import path from 'node:path';

export const METHODS = ['chatgpt-token-sharing', 'chatgpt-browser', 'chatgpt-headless'] as const;
export const PROVIDER = 'zai-coding-plan';
// First tools-capable model in the authorized source metadata snapshot.
export const DEFAULT_MODEL = 'glm-5.3-flash';
export const ROUTE = 'https://api.z.ai/api/coding/paas/v4/chat/completions';
export const Control = Rpc.define({ id: 'm1-auth-guard', methods: {
  inspect: { input: { type: 'object', additionalProperties: false }, output: { type: 'object', additionalProperties: true } },
  resolve: { input: { type: 'object', properties: { credentialID: { type: 'string' }, method: { type: 'string' } }, required: ['credentialID', 'method'], additionalProperties: false }, output: { type: 'object', additionalProperties: true } },
  authorize: { input: { type: 'object', properties: { method: { type: 'string' } }, required: ['method'], additionalProperties: false }, output: { type: 'object', additionalProperties: true } },
  pipeline: { input: { type: 'object', properties: { kind: { type: 'string' } }, required: ['kind'], additionalProperties: false }, output: { type: 'object', additionalProperties: true } },
}, events: {} });

export interface Ledger {
  pid: number; locations: string[]; armed: boolean; deadline: number; dispatches: number;
  activations: Record<string, { methods: string[]; refresh: Record<string, number>; authorize: Record<string, number> }>;
  shaped: Record<string, number>; retriesDenied: number;
  httpStatuses?: { kind: string; status: number }[];
  modelID?: string;
  admissionKinds?: Record<string, number>; dispatchKinds?: Record<string, number>;
  live?: { sessionID: string; admissions: number; toolSnapshots: number; failed: boolean; bindings?: Record<string, { agent: string; directory: string }> };
}
export function stateFile(root: string) { return path.join(root, 'guard-state.json'); }
export function readState(root: string): Ledger { return JSON.parse(readFileSync(stateFile(root), 'utf8')); }
export function changeState<T>(root: string, update: (state: Ledger) => T): T {
  // All loaded locations use this one file and process. No await between R/M/W.
  const current = readState(root); const result = update(current);
  const file = stateFile(root); const tmp = `${file}.new`;
  writeFileSync(tmp, JSON.stringify(current), { mode: 0o600 }); renameSync(tmp, file);
  return result;
}
function check(value: unknown, code: string): asserts value { if (!value) throw new Error(code); }
function narrowTools(tools: Record<string, unknown>) {
  for (const name of Object.keys(tools)) if (name !== 'agent_progress_report') delete tools[name];
}
export function callbacks(root: string, scopeDirectory?: string) {
  function target(model: { providerID: string; id: string }) {
    check(model.providerID === PROVIDER && model.id === (readState(root).modelID ?? DEFAULT_MODEL), 'm1-model-refused');
    check(Date.now() < readState(root).deadline, 'm1-deadline');
  }
  function shape(kind: string, event: { model: { providerID: string; id: string }; options: Record<string, unknown>; tools?: Record<string, unknown> }) {
    target(event.model); event.options.maxTokens = 900;
    changeState(root, s => {
      if (s.live && event.tools) {
        narrowTools(event.tools);
        // Removal only: never add/loosen an agent's tool availability.
        check(Object.keys(event.tools).every(n => n === 'agent_progress_report'), 'm1-tools-refused');
        s.live.toolSnapshots++;
      }
      s.shaped[kind] = (s.shaped[kind] ?? 0) + 1;
    });
  }
  function binding(event: { sessionID?: string; kind?: string; agent?: string }) {
    const live = readState(root).live;
    if (live) {
      const bound = live.bindings?.[event.sessionID ?? ''];
      check(!live.failed && (live.bindings ? bound : event.sessionID === live.sessionID) && ['primary', 'compaction', 'generate', 'title'].includes(event.kind ?? '') && ['build', 'title', 'compaction', 'summary', 'general', 'explore'].includes(event.agent ?? ''), 'm1-role-refused');
      if (bound) check((event.kind !== 'primary' || event.agent === bound.agent) && (!scopeDirectory || scopeDirectory === bound.directory), 'm1-location-refused');
    }
  }
  async function http(event: { model: { providerID: string; id: string }; request: Request; sessionID?: string; kind?: string; agent?: string }) {
    target(event.model);
    binding(event);
    check(event.request.method === 'POST' && event.request.url === ROUTE, 'm1-route-refused');
    check(!event.request.headers.has('content-encoding'), 'm1-encoding-refused');
    // No unobserved redirect hop may forward a copied bearer credential.
    event.request = new Request(event.request, { redirect: 'error' });
    let body: Record<string, unknown>;
    try { body = await event.request.clone().json(); check(body && typeof body === 'object', 'm1-body-refused'); }
    catch { throw new Error('m1-body-refused'); }
    if (readState(root).live) check(body.model === (readState(root).modelID ?? DEFAULT_MODEL), 'm1-wire-model-refused');
    check(Number.isInteger(body.max_tokens) && Number(body.max_tokens) > 0 && Number(body.max_tokens) <= 900, 'm1-output-cap-refused');
    for (const key of ['max_output_tokens', 'max_completion_tokens']) check(!(key in body), 'm1-conflicting-cap-refused');
    changeState(root, s => {
      check(Date.now() < s.deadline, 'm1-deadline');
      check(s.armed && s.locations.every(dir => s.activations[dir]), 'm1-unarmed');
      if (s.live) check(s.live.admissions > 0 && s.live.admissions <= 6, 'm1-admission-required');
      check(s.dispatches < 12, 'm1-dispatch-cap'); s.dispatches++;
      if (event.kind) { s.dispatchKinds ??= {}; s.dispatchKinds[event.kind] = (s.dispatchKinds[event.kind] ?? 0) + 1; }
    });
  }
  function retry(event: { decision: unknown }) { event.decision = { retry: false }; changeState(root, s => { s.retriesDenied++; if (s.live) s.live.failed = true; }); }
  function response(event: { kind: string; response: Response }) {
    changeState(root, s => {
      const kind = ['primary', 'compaction', 'generate', 'title'].includes(event.kind) ? event.kind : 'unknown';
      (s.httpStatuses ??= []).push({ kind, status: event.response.status });
      if (!event.response.ok && s.live) s.live.failed = true;
    });
  }
  function model(event: { model: { providerID: string; id: string }; sessionID?: string; kind?: string; agent?: string }) {
    target(event.model); binding(event);
    changeState(root, s => { if (s.live) { check(s.armed && s.live.admissions < 6, 'm1-action-cap'); s.live.admissions++; s.admissionKinds ??= {}; if (event.kind) s.admissionKinds[event.kind] = (s.admissionKinds[event.kind] ?? 0) + 1; } });
  }
  return { shape, http, retry, model, response };
}

export default Plugin.define({ id: 'm1-auth-guard', async setup(ctx) {
  const root = process.env.M1_GUARD_ROOT;
  check(typeof root === 'string' && (root.startsWith('/tmp/opencode/agent-progress-probe-auth-')||['/tmp/opencode/agent-progress-t6-live','/tmp/opencode/agent-progress-t6-live2'].includes(root)), 'm1-owned-root-required');
  check(realpathSync(root) === root && (lstatSync(root).mode & 0o777) === 0o700, 'm1-root-alias');
  check(ctx.app.version === '2.1.4' && process.env.XDG_DATA_HOME === `${root}/data` && process.env.XDG_CONFIG_HOME === `${root}/config`, 'm1-runtime-scope');
  const directory = String(ctx.location.directory); const state = readState(root);
  check(state.pid === process.pid && state.locations.includes(directory) && !state.armed, 'm1-unexpected-location-or-reload');
  await ctx.integration.transform(editor => {
    const methods = editor.method.list('openai').filter(m => m.type === 'oauth');
    check(methods.length === METHODS.length && METHODS.every(id => methods.some(m => m.type === 'oauth' && m.id === id)), 'm1-unknown-method');
    for (const method of methods) {
      if (method.type !== 'oauth') continue;
      editor.method.update({ integrationID: 'openai', method,
        authorize: async () => { changeState(root, s => { const a = s.activations[directory]; a.authorize[method.id] = (a.authorize[method.id] ?? 0) + 1; }); throw new Error('m1-authorization-denied'); },
        refresh: async () => { changeState(root, s => { const a = s.activations[directory]; a.refresh[method.id] = (a.refresh[method.id] ?? 0) + 1; }); throw new Error('m1-refresh-denied'); },
      });
    }
  });
  const hooks = callbacks(root, directory);
  await ctx.provider.transform(editor => editor.update(PROVIDER, provider => {
    provider.settings = { ...provider.settings, transport: 'http', encoding: 'none', compaction: { type: 'summary' } };
  }));
  for (const [name, kind] of [['context', 'primary'], ['compaction', 'compaction'], ['generate', 'generate'], ['title', 'title']] as const)
    await ctx.session.hook(name, async event => hooks.shape(kind, event));
  await ctx.session.hook('model.request', async event => hooks.model(event));
  await ctx.session.hook('http.request', hooks.http);
  await ctx.session.hook('http.response', async event => hooks.response(event));
  await ctx.session.hook('retry', async event => hooks.retry(event));
  await ctx.session.hook('experimental.ws.handshake', async () => { throw new Error('m1-websocket-refused'); });
  await ctx.session.hook('experimental.ws.send', async () => { throw new Error('m1-websocket-refused'); });
  changeState(root, s => { s.activations[directory] = { methods: [...METHODS], refresh: {}, authorize: {} }; });
  await ctx.rpc.register(Control, {
    inspect: async () => {
      const tools = Object.fromEntries((await ctx.tool.list()).map(t => [t.id, {}]));
      narrowTools(tools);
      return { directory, ...readState(root), narrowedCatalogTools: Object.keys(tools), progressToolAvailable: 'agent_progress_report' in tools, runtime: { node: process.versions.node, bun: process.versions.bun ?? null } };
    },
    resolve: async input => {
      check(!readState(root).live, 'm1-synthetic-control-only');
      const { credentialID, method } = input as { credentialID: string; method: string };
      check(METHODS.includes(method as typeof METHODS[number]), 'm1-method-refused');
      const active = await ctx.integration.connection.active('openai');
      check(active?.type === 'credential' && active.id === credentialID && active.label === 'M1 SYNTHETIC ONLY' && active.method === 'oauth', 'm1-active-mismatch');
      const before = readState(root).activations[directory].refresh[method] ?? 0;
      let refused = false; try { await ctx.integration.connection.resolve(active); } catch { refused = true; }
      const after = readState(root).activations[directory].refresh[method] ?? 0;
      return { directory, method, refused, guardInvocationsIncreased: after > before };
    },
    authorize: async input => {
      const { method } = input as { method: string }; check(METHODS.includes(method as typeof METHODS[number]), 'm1-method-refused');
      const before = readState(root).activations[directory].authorize[method] ?? 0;
      let refused = false; try { await ctx.integration.oauth.connect({ integrationID: 'openai', methodID: method }); } catch { refused = true; }
      const after = readState(root).activations[directory].authorize[method] ?? 0;
      return { method, refused, guardInvocationsIncreased: after > before };
    },
    pipeline: async input => {
      check(!readState(root).live, 'm1-synthetic-control-only');
      const { kind } = input as { kind: string };
      check(['primary', 'compaction', 'generate', 'title'].includes(kind), 'm1-kind-refused');
      const model = { providerID: PROVIDER, id: readState(root).modelID ?? DEFAULT_MODEL };
      const event = { model, options: {} as Record<string, unknown> }; // Models built-in limit deletion.
      hooks.shape(kind, event);
      const retry = { decision: { retry: true } }; hooks.retry(retry);
      let allowed = true;
      try { await hooks.http({ model, request: new Request(ROUTE, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: 'M1-SYNTHETIC-PIPELINE-SENTINEL' }], max_tokens: event.options.maxTokens }) }) }); }
      catch { allowed = false; }
      // Same registered callback functions; no model API, fetch or HTTP sender.
      return { kind, allowed, shapedMaxTokens: event.options.maxTokens, retryDenied: retry.decision.retry === false, dispatches: readState(root).dispatches, transportCalls: 0 };
    },
  });
} });
