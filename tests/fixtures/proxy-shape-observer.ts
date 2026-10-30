/** C0 diagnostic only: deterministic native transport and hook shape observation. */
import { Model, Provider, Plugin } from '@opencode/plugin';
import fs from 'node:fs';

export default Plugin.define({ id: 'proxy-shape-observer', async setup(ctx: any) {
  const root = process.env.PROXY_SHAPE_ROOT!;
  const record = (value: object) => fs.appendFileSync(`${root}/events.jsonl`, JSON.stringify(value) + '\n');
  const providerID = Provider.ID.make('proxy-fixture'), modelID = Model.ID.make('script');
  await ctx.provider.transform((editor: any) => {
    for (const p of editor.list()) editor.remove(p.provider.id);
    editor.add({ info: { ...Provider.Info.empty(providerID), activation: 'enabled', package: `aisdk:file://${root}/sdk.mjs` }, models: [Model.Info.default(providerID, modelID)] });
  });
  await ctx.model.transform((editor: any) => editor.default.set(providerID, modelID));
  await ctx.session.hook('title', (event: any) => { event.result = 'Synthetic proxy fixture'; });
  await ctx.session.hook('retry', (event: any) => { event.decision = { retry: false }; });
  await ctx.session.hook('http.request', () => { record({ type: 'forbidden-http' }); throw new Error('No external provider'); });
  await ctx.session.hook('context', (event: any) => { event.system.push({ type: 'text', text: `PROXY_FIXTURE_ID:${event.sessionID}` }); });
  for (const hook of ['execute.before', 'execute.after'] as const) await ctx.tool.hook(hook, (event: any) => {
    // Only fixture-authored synthetic data; never production telemetry.
    record({ type: hook, ...event, ...(event.error ? { error: { name: event.error.name, message: event.error.message, keys: Object.keys(event.error) } } : {}) });
  });
  const seen = new Set<string>();
  await ctx.aisdk.hook('sdk', async (event: any) => {
    event.sdk = {};
    const deadline = Date.now() + 10000;
    while (!(await ctx.tool.list()).some((t: any) => t.id === 'linear_save_issue')) {
      if (Date.now() >= deadline) throw new Error('Synthetic MCP catalog did not become ready');
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    record({ type: 'catalog', tools: (await ctx.tool.list()).filter((t: any) => t.id === 'subagent' || t.id === 'execute' || t.id.startsWith('linear_')).map((t: any) => ({ id: t.id, input: t.input, output: t.output, options: t.options })) });
  });
  await ctx.aisdk.hook('language', (event: any) => {
    if (event.model.providerID !== providerID) throw new Error('Unexpected provider');
    event.language = {
      specificationVersion: 'v3', provider: providerID, modelId: modelID, supportedUrls: {},
      async doGenerate() { throw new Error('No auxiliary generation'); },
      async doStream(options: any) {
        const id = options.prompt.filter((m: any) => m.role === 'system' && typeof m.content === 'string').map((m: any) => m.content.match(/(?:^|\n)PROXY_FIXTURE_ID:(\S+)/)?.[1]).find(Boolean);
        if (!id) throw new Error('Missing fixture identity');
        const session = await ctx.session.get({ sessionID: id });
        record({ type: 'outgoing', sessionID: id, system: options.prompt.filter((m: any) => m.role === 'system').map((m: any) => m.content) });
        const job = JSON.parse(fs.readFileSync(`${root}/jobs.json`, 'utf8'))[id];
        const key = `${id}:${job?.generation ?? 0}`;
        const call = seen.has(key) ? undefined : job?.call; seen.add(key);
        if (session.agent === 'failure-worker') throw new Error('Synthetic child provider failure');
        if (session.agent === 'slow-worker') {
          record({ type: 'slow-entered', sessionID: id });
          const deadline = Date.now() + 20000;
          while (!fs.existsSync(`${root}/release`) && !options.abortSignal?.aborted && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
          if (options.abortSignal?.aborted) throw new Error('Synthetic cancelled child');
        }
        const usage = { inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 0, text: 0, reasoning: 0 } };
        return { stream: new ReadableStream({ start(controller) {
          controller.enqueue({ type: 'stream-start', warnings: [] });
          if (call) controller.enqueue({ type: 'tool-call', toolCallId: call.id, toolName: call.name, input: JSON.stringify(call.input) });
          else { controller.enqueue({ type: 'text-start', id: 'done' }); controller.enqueue({ type: 'text-delta', id: 'done', delta: 'Synthetic worker complete.' }); controller.enqueue({ type: 'text-end', id: 'done' }); }
          controller.enqueue({ type: 'finish', finishReason: { unified: call ? 'tool-calls' : 'stop', raw: undefined }, usage }); controller.close();
        } }) };
      },
    };
  });
  return () => record({ type: 'disposed' });
} });
