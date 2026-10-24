/** One root inspect/report run. No default resolver, transport or execution at import. */
import { randomUUID } from 'node:crypto';
import { Credential } from '@opencode/schema/credential';
import { Schema } from 'effect';
import { insist, LiveSafetyError, selectZaiKey, type Source, type Wire } from './auth-source.ts';
import { PRODUCTION_PROMPT, productionContext, toolCounts, productionToolFacts } from './production-live-check.ts';

export const LIVE_CLEARANCE = true; // Parent must review this revision before changing this gate.
export const ROOT_PROMPT = 'Synthetic compatibility test only. No file reads, shell, network, delegation or lifecycle actions. Call agent_progress_report with operation inspect, then operation report, operationId m1-root-1, expectedRevision 0. Reply only OK. Do not infer plan completion.';
export interface ReportExpectation {
  agent: 'build' | 'general'; directory?: string; parentID?: string;
  operationId: string; expectedRevision: number; inspect: boolean;
}
export function destinationClient(endpoint: string, password: string, wire: Wire, signal: AbortSignal) {
  type Stage = 'prompt' | 'wait' | 'context' | 'list' | 'create' | 'remove' | 'model' | 'move' | 'compact';
  let destinationStage: Stage | null = null;
  let sessionHadErrorPart: boolean | null = null;
  let assistantToolCounts: Record<string, number> | null = null;
  let productionCalls:ReturnType<typeof productionToolFacts>|null=null;
  const origin = new URL(endpoint);
  insist(origin.protocol === 'http:' && origin.hostname === '127.0.0.1' && origin.port && origin.pathname === '/' && !origin.search && !origin.hash && !origin.username && !origin.password && password, 'destination');
  async function call(stage: Stage, route: string, method = 'GET', body?: unknown, cleanup = false): Promise<any> {
    try {
      const r = await wire(`${endpoint}${route}`, { method, redirect: 'error', headers: { authorization: `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`, 'content-type': 'application/json' },
        signal: cleanup ? AbortSignal.timeout(5000) : AbortSignal.any([signal, AbortSignal.timeout(['prompt', 'wait', 'context'].includes(stage) ? 45_000 : 15_000)]), ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      insist(r.ok && !r.redirected && (!r.url || r.url === `${endpoint}${route}`), 'destination');
      return r.status === 204 ? undefined : await r.json();
    } catch { destinationStage ??= stage; throw new LiveSafetyError('destination'); }
  }
  const entry = (v: unknown) => { try { return Schema.decodeUnknownSync(Credential.Entry)(v); } catch { throw new LiveSafetyError('destination'); } };
  function id(value: string, prefix: string) { insist(new RegExp(`^${prefix}_[A-Za-z0-9_-]+$`).test(value), 'destination'); return encodeURIComponent(value); }
  async function context(sessionID: string) {
    const b = await call('context', `/api/session/${id(sessionID, 'ses')}/context`);
    insist(Array.isArray(b?.data), 'destination');
    sessionHadErrorPart = b.data.some((m: any) => m.error || m.type === 'error' || m.content?.some((p: any) => p.error || p.type === 'error' || p.state?.status === 'error'));
    return b.data as any[];
  }
  async function reportSession(sessionID: string, expected: ReportExpectation) {
    sessionHadErrorPart = null; assistantToolCounts = null;
    const key = id(sessionID, 'ses');
    const text = expected.operationId === 'm1-root-1' ? ROOT_PROMPT : `Synthetic compatibility test only. No file reads, shell, network, delegation or lifecycle actions. ${expected.inspect ? 'Call agent_progress_report with operation inspect. Then ' : ''}Call agent_progress_report with operation report, operationId ${expected.operationId}, expectedRevision ${expected.expectedRevision}. Reply only OK. Do not repeat prior operations or infer plan completion.`;
    const admitted = await call('prompt', `/api/session/${key}/prompt`, 'POST', { text });
    insist(typeof admitted?.data?.id === 'string', 'destination');
    await call('wait', `/api/experimental/session/${key}/wait`, 'POST', {});
    const messages = await context(sessionID);
    const start = messages.findIndex(m => m.id === admitted.data.id);
    insist(start >= 0, 'action');
    const current = messages.slice(start + 1);
    const tools = current.filter(m => m.type === 'assistant').flatMap(m => m.content ?? []).filter(p => p.type === 'tool');
    assistantToolCounts = {};
    for (const tool of tools) {
      const name = tool.name === 'agent_progress_report' ? tool.name : 'other';
      assistantToolCounts[name] = (assistantToolCounts[name] ?? 0) + 1;
    }
    insist(!sessionHadErrorPart && tools.length >= (expected.inspect ? 2 : 1) && tools.every(p => p.name === 'agent_progress_report' && p.state?.status === 'completed'), 'action');
    const report = tools.find(p => p.state.input?.operation === 'report' && p.state.input.operationId === expected.operationId && p.state.input.expectedRevision === expected.expectedRevision);
    function output(part: any) { try { return JSON.parse(part.state.content.find((c: any) => c.type === 'text').text); } catch { throw new LiveSafetyError('action'); } }
    const receipt = output(report);
    insist(receipt.revision === expected.expectedRevision + 1 && receipt.replay === false, 'action');
    if (expected.inspect) {
      const identity = output(tools.find(p => p.state.input?.operation === 'inspect'));
      insist(identity.callerSessionId === sessionID && identity.callerAgent === expected.agent && identity.session?.id === sessionID && identity.sqlite === true, 'action');
      if (expected.parentID) insist(identity.session.parentID === expected.parentID, 'action');
      if (expected.directory) insist(identity.session.location?.directory === expected.directory && identity.instanceLocation?.directory === expected.directory, 'action');
    }
    return { completedProgressCalls: tools.length };
  }
  return Object.freeze({
    resetDiagnostics() { destinationStage = null; sessionHadErrorPart = null; assistantToolCounts = null;productionCalls=null; },
    diagnostics() { return { destinationStage, sessionHadErrorPart, assistantToolCounts,productionToolFacts:productionCalls }; },
    async list() { const b = await call('list', '/api/credential', 'GET', undefined, true); insist(Array.isArray(b?.data), 'destination'); return b.data.map(entry) as Credential.Entry[]; },
    async create(input: Credential.CreateInput) { return entry((await call('create', '/api/credential', 'POST', input)).data); },
    async remove(credentialID: string) { await call('remove', `/api/credential/${id(credentialID, 'cred')}`, 'DELETE', undefined, true); },
    async verifyModel(modelID: string) {
      const catalog = await call('model', '/api/model');
      insist(Array.isArray(catalog?.data) && catalog.data.some((m: any) => m.providerID === 'zai-coding-plan' && m.id === modelID && m.capabilities?.tools === true), 'selection');
    },
    reportSession,
    async production(sessionID:string) {
      sessionHadErrorPart=null;assistantToolCounts=null;productionCalls=null;
      const key=id(sessionID,'ses');
      const admitted=await call('prompt',`/api/session/${key}/prompt`,'POST',{text:PRODUCTION_PROMPT});
      insist(typeof admitted?.data?.id==='string','destination');
      await call('wait',`/api/experimental/session/${key}/wait`,'POST',{});
      const messages=await context(sessionID);
      const start=messages.findIndex(m=>m.id===admitted.data.id);
      assistantToolCounts=toolCounts(start>=0?messages.slice(start+1):[]).counts;
      productionCalls=productionToolFacts(start>=0?messages.slice(start+1):[]);
      return productionContext(messages,admitted.data.id);
    },
    async move(sessionID: string, directory: string) {
      await call('move', `/api/session/${id(sessionID, 'ses')}/move`, 'POST', { directory });
    },
    async compact(sessionID: string) {
      sessionHadErrorPart = null; assistantToolCounts = null;
      const key = id(sessionID, 'ses');
      const admitted = await call('compact', `/api/session/${key}/compact`, 'POST', {});
      insist(typeof admitted?.data?.id === 'string', 'destination');
      await call('wait', `/api/experimental/session/${key}/wait`, 'POST', {});
      const messages = await context(sessionID);
      const compacted = messages.find(m => m.id === admitted.data.id && m.type === 'compaction');
      insist(!sessionHadErrorPart && compacted?.status === 'completed', 'action');
      assistantToolCounts = {};
      return { completedProgressCalls: 0 };
    },
    async root(sessionID: string) {
      return reportSession(sessionID, { agent: 'build', operationId: 'm1-root-1', expectedRevision: 0, inspect: true });
    },
  });
}
export type Destination = ReturnType<typeof destinationClient>;
export async function runRootWithCopy(input: {
  source: Source; destination: Destination; endpoint: string; pid: number; root: string; sessionID: string; modelID: string;
  deadline: number; signal: AbortSignal;
  assertReady: () => void; stop: (hard: boolean) => Promise<void>; dispose: () => void;
  exercise?: (destination: Destination, boundary: () => void) => Promise<number>;
}) {
  let sourceID: string | undefined; let createdID: string | undefined; let attempted = false; let imported = false;
  let failure: LiveSafetyError['code'] | undefined; let cleanupUncertain = false;
  let completedProgressCalls = 0;
  function boundary() {
    insist(!input.signal.aborted, 'cancelled'); insist(Date.now() < input.deadline, 'deadline');
    try { input.assertReady(); } catch (e) { throw e instanceof LiveSafetyError ? e : new LiveSafetyError('ledger'); }
  }
  try {
    boundary();
    insist(input.endpoint !== input.source.endpoint && input.pid !== input.source.pid && input.root !== input.source.root && !input.root.startsWith(`${input.source.root}/`) && !input.source.root.startsWith(`${input.root}/`), 'source-identity');
    insist((await input.destination.list()).length === 0, 'destination'); boundary();
    const selected = selectZaiKey(await input.source.list()); sourceID = selected.id;
    boundary();
    const label = `m1-isolated-${randomUUID()}`;
    const payload = { integrationID: 'zai-coding-plan', value: selected.value, label, activate: true } as Credential.CreateInput;
    try {
      attempted = true;
      const created = await input.destination.create(payload);
      // Retain known destination ID even if other acknowledgement fields mismatch.
      if (created.id !== sourceID) createdID = created.id;
      insist(createdID && created.label === label && created.active && created.integrationID === 'zai-coding-plan' && created.value.type === 'key' && selected.value.type === 'key' && created.value.key === selected.value.key, 'import-ambiguous');
    } catch {
      const candidates = (await input.destination.list()).filter(e => e.id !== sourceID && e.integrationID === 'zai-coding-plan' && e.label === label && e.value.type === 'key' && selected.value.type === 'key' && e.value.key === selected.value.key);
      if (candidates.length === 1) createdID = candidates[0].id;
      else cleanupUncertain = true;
      throw new LiveSafetyError('import-ambiguous');
    }
    imported = true; boundary();
    await input.destination.verifyModel(input.modelID); boundary();
    completedProgressCalls = input.exercise ? await input.exercise(input.destination, boundary) : (await input.destination.root(input.sessionID)).completedProgressCalls;
    boundary();
  } catch (e) { failure = e instanceof LiveSafetyError ? e.code : 'destination'; }
  finally {
    if (attempted) {
      if (createdID && createdID !== sourceID) {
        try { await input.destination.remove(createdID); insist((await input.destination.list()).length === 0, 'cleanup'); }
        catch { cleanupUncertain = true; }
      } else cleanupUncertain = true;
    }
    try { await input.stop(cleanupUncertain); } catch { cleanupUncertain = true; }
    try { input.dispose(); } catch { cleanupUncertain = true; }
  }
  return { imported, completedProgressCalls, failure: cleanupUncertain ? 'cleanup' : failure ?? null, cleanupUncertain, ...input.destination.diagnostics(), skipped: ['native', 'move', 'compaction', 'slim'] };
}
