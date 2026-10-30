/** Gate-only provider. Retains metadata/counts, never conversation, summary or error text. */
import { Model, Provider, Plugin } from '@opencode/plugin';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';

export const RESUME_SENTINEL = 'SYNTHETIC_PROGRESS_RESUME_SENTINEL';
// Fixed synthetic reply in the pinned host's Markdown checkpoint format. No conversation-derived content.
const COMPACTION_REPLY = `## Objective
- Run a synthetic transport probe.
## Requirements
- Scripted local provider only.
## Decisions
- (none)
## Work State
### Completed
- Initial synthetic turn.
### Active
- Transport probe.
### Blocked
- (none)
## Next Move
1. Continue the synthetic probe.
## Relevant Files
- (none)
## Important Context
- (none)
`;

export default Plugin.define({ id: 'progress-resume-observer', async setup(ctx) {
  const regression = process.env.RESUME_PHASE === 'regression';
  const start = performance.now();
  const record = (value: object) => appendFileSync(process.env.RESUME_EVENTS!, JSON.stringify({ ms: Math.round(performance.now() - start), ...value }) + '\n');
  const binding = JSON.parse(readFileSync(process.env.AGENT_PROGRESS_BINDING!, 'utf8'));
  const providerID = Provider.ID.make('resume-fixture');
  const modelID = Model.ID.make('script');
  await ctx.provider.transform(editor => {
    for (const p of editor.list()) editor.remove(p.provider.id);
    editor.add({ info: { ...Provider.Info.empty(providerID), activation: 'enabled', package: `aisdk:${process.env.RESUME_SDK}` }, models: [Model.Info.default(providerID, modelID)] });
  });
  await ctx.model.transform(editor => editor.default.set(providerID, modelID));
  await ctx.session.hook('title', event => { event.result = 'Synthetic resume fixture'; });
  await ctx.session.hook('retry', event => { event.decision = { retry: false }; });
  await ctx.session.hook('http.request', () => { record({ type: 'unexpected-http' }); throw new Error('Scripted transport only'); });
  const seen = new Set<string>();
  const started = new Map<string, number>();
  const pending = new Set<string>();
  const abort = new AbortController();
  let latest: { sessionID: string; kind: string } | undefined;
  const observe = (e: { id: string; type: string; sessionID: string; seq: number }) => {
    if (seen.has(e.id)) return false;
    seen.add(e.id);
    if (e.type === 'session.compaction.started') { started.set(e.sessionID, e.seq); pending.delete(e.sessionID); }
    if (e.type === 'session.compaction.failed') { started.delete(e.sessionID); pending.delete(e.sessionID); }
    if (e.type === 'session.compaction.ended') {
      const seq = started.get(e.sessionID);
      if (seq !== undefined && e.seq > seq) pending.add(e.sessionID);
      started.delete(e.sessionID);
    }
    return true;
  };
  // Project only allowed metadata before passing to any recorder/replay control.
  const events = (async () => {
    try {
      for await (const event of ctx.event.subscribe({ signal: abort.signal })) {
        if (!['session.compaction.started', 'session.compaction.ended', 'session.compaction.failed'].includes(event.type)) continue;
        const e = event as any;
        const session = await ctx.session.get({ sessionID: e.data.sessionID });
        const sourceMatches = session.id === e.data.sessionID && session.location.directory === ctx.location.directory
          && binding.source.configRoot === `${process.env.XDG_CONFIG_HOME}/opencode`
          && binding.source.dataRoot === `${process.env.XDG_DATA_HOME}/opencode`;
        const metadata = { id: e.id as string, type: e.type as string, sessionID: e.data.sessionID as string, seq: e.durable.seq as number };
        const accepted = sourceMatches && observe(metadata);
        const duplicateRejected = !observe(metadata);
        // Owner-authorized diagnosis: compare the host failure transiently, never serialize its body/message.
        const failureClassification = e.type === 'session.compaction.failed'
          ? e.data.error?.type === 'compaction.failed' && e.data.error?.message === 'Compaction summary did not match the required template'
            ? 'provider reply rejected: missing required Markdown template heading'
            : e.data.error?.type === 'compaction.unavailable' && e.data.error?.message === 'Nothing to compact yet'
              ? 'compaction unavailable: nothing new to compact'
              : 'other failure: cause not classified'
          : undefined;
        record({ ...metadata, ...(failureClassification ? { failureClassification } : {}), source: binding.source.id, sourceMatches, aggregateMatches: e.durable.aggregateID === session.id,
          reason: e.data.reason, accepted, duplicateRejected, eventCreated: e.created, locationMatches: e.location?.directory === ctx.location.directory });
      }
    } catch { if (!abort.signal.aborted) record({ type: 'subscription-failed' }); }
  })();
  await ctx.session.hook('context', event => {
    const armed = pending.delete(event.sessionID);
    if (armed && !regression) event.system.push({ type: 'text', text: RESUME_SENTINEL });
    latest = { sessionID: event.sessionID, kind: 'primary' };
    record({ type: 'context', sessionID: event.sessionID, sentinel: armed });
  });
  await ctx.session.hook('compaction', event => {
    latest = { sessionID: event.sessionID, kind: 'compaction' };
    record({ type: 'compaction-hook', sessionID: event.sessionID, tools: Object.keys(event.tools) });
    // Observe only: never inspect or change system/messages/options/result.
  });
  await ctx.session.hook('model.request', event => {
    latest = { sessionID: event.sessionID, kind: event.kind };
    record({ type: 'model.request', ...latest });
  });
  await ctx.aisdk.hook('sdk', event => {
    if (event.model.providerID !== providerID) throw new Error('Unexpected provider');
    event.sdk = {};
  });
  await ctx.aisdk.hook('language', event => {
    if (event.model.providerID !== providerID) throw new Error('Unexpected provider');
    const dispatch = (options: any, method: string) => {
      // Only test sentinel presence in actual system parts; never inspect conversation/summary messages.
      const count = options.prompt.filter((m: any) => m.role === 'system').reduce((n: number, m: any) =>
        n + (typeof m.content === 'string' ? m.content.split(RESUME_SENTINEL).length - 1 : 0), 0);
      const invalidReply = latest?.kind === 'compaction' && existsSync(process.env.RESUME_FAIL!);
      const systems: string[] = options.prompt.filter((m: any) => m.role === 'system' && typeof m.content === 'string').map((m: any) => m.content);
      const recovery = systems.flatMap(text => {
        const at = text.indexOf('## Progress resume —');
        return at < 0 ? [] : [text.slice(at)];
      });
      record({ type: 'dispatch', ...latest, sentinelCount: count, provider: providerID, method,
        ...(regression ? { recovery, generic: systems.some(text => text.includes('# Agent progress (companion)')),
          ownedSections: systems.reduce((n, text) => n + text.split('# Agent progress (companion)').length - 1, 0) } : {}),
        tools: options.tools?.map((tool: any) => tool.name) ?? [], responseFormat: options.responseFormat?.type ?? 'unspecified',
        replyShape: latest?.kind === 'compaction' ? invalidReply ? 'plain-text-without-template' : 'markdown-checkpoint-template' : 'plain-text' });
      return latest?.kind === 'compaction' && !invalidReply ? COMPACTION_REPLY : 'Synthetic fixed response.';
    };
    const usage = { inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 0, text: 0, reasoning: 0 } };
    event.language = {
      specificationVersion: 'v3', provider: providerID, modelId: modelID, supportedUrls: {},
      async doGenerate(options: any) {
        const text = dispatch(options, 'doGenerate');
        return { content: [{ type: 'text', text }], finishReason: { unified: 'stop', raw: undefined }, usage, warnings: [] };
      },
      async doStream(options: any) {
        const text = dispatch(options, 'doStream');
        return { stream: new ReadableStream({ start(controller) {
          controller.enqueue({ type: 'stream-start', warnings: [] });
          controller.enqueue({ type: 'text-start', id: 'fixed' });
          controller.enqueue({ type: 'text-delta', id: 'fixed', delta: text });
          controller.enqueue({ type: 'text-end', id: 'fixed' });
          controller.enqueue({ type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage });
          controller.close();
        } }) };
      },
    };
  });
  record({ type: 'registered' });
  return async () => { abort.abort(); await events; record({ type: 'disposed' }); };
} });
