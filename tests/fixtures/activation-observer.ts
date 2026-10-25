/** Separate test observer + deterministic public AISDK driver; never production ingress. */
import { Model, Provider, Plugin } from '@opencode/plugin';
import { appendFileSync } from 'node:fs';

export default Plugin.define({ id: 'activation-observer-fixture', async setup(ctx: any) {
    const record = (value: unknown) => appendFileSync(process.env.ACTIVATION_EVENTS!, JSON.stringify(value) + '\n');
      const providerID = Provider.ID.make('activation-fixture');
      const modelID = Model.ID.make('script');
      await ctx.provider.transform((editor: any) => {
        for (const p of editor.list()) editor.remove(p.provider.id);
        editor.add({ info: { ...Provider.Info.empty(providerID), activation: 'enabled', package: `aisdk:${process.env.ACTIVATION_SDK}` }, models: [Model.Info.default(providerID, modelID)] });
      });
      await ctx.model.transform((editor: any) => editor.default.set(providerID, modelID));
      await ctx.session.hook('title', (event: any) => { event.result = 'Synthetic activation fixture'; });
      await ctx.session.hook('retry', (event: any) => { event.decision = { retry: false }; });
      await ctx.session.hook('http.request', () => { record({ type: 'unexpected-http' }); throw new Error('No HTTP provider transport allowed'); });
      await ctx.session.hook('context', (event: any) => {
        record({ type: 'context', sessionID: event.sessionID, agent: event.agent, tools: Object.keys(event.tools), system: event.system });
      });
      await ctx.tool.hook('execute.after', (event: any) => {
        // All inputs here are fixture-authored. Never ship this observer or transcript capture.
        record({ type: 'after', ...event });
      });
      const steps = [
        { name: 'write', input: { path: 'docs/plans/search.md', content: '# Search\nFirst draft\n' } },
        { name: 'write', input: { path: 'docs/plans/search.md', content: '# Search\nSecond draft\n' } },
        { name: 'edit', input: { path: 'docs/plans/search.md', oldString: 'Second draft', newString: 'Third draft' } },
        { name: 'write', input: { path: 'docs/plans', content: 'Cannot replace a directory' } },
        { name: 'agent_progress_report', input: { op: 'start', plan: 'native-structured', oid: 'native-start', rev: 0, title: 'Synthetic structured plan', items: [{ id: 'a', title: 'First', kind: 'task' }, { id: 'b', title: 'Second', kind: 'task' }] } },
      ];
      let index = 0;
      await ctx.aisdk.hook('sdk', (event: any) => {
        record({type:'sdk', providerID:event.model.providerID});
        if (event.model.providerID !== providerID) throw new Error('Unexpected provider');
        event.sdk = {};
      });
      await ctx.aisdk.hook('language', (event: any) => {
        record({type:'language', providerID:event.model.providerID});
        if (event.model.providerID !== providerID) throw new Error('Unexpected provider');
        event.language = {
          specificationVersion: 'v3', provider: providerID, modelId: modelID, supportedUrls: {},
          async doGenerate() { throw new Error('Unexpected auxiliary generation'); },
          async doStream(options: any) {
            const step = steps[index++];
            record({ type: 'driver', index, tools: options.tools?.map((t: any) => t.name), prompt: options.prompt });
            const usage = { inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 0, text: 0, reasoning: 0 } };
            return { stream: new ReadableStream({ start(controller) {
              controller.enqueue({ type: 'stream-start', warnings: [] });
              if (step) controller.enqueue({ type: 'tool-call', toolCallId: `fixture-call-${index}`, toolName: step.name, input: JSON.stringify(step.input) });
              else {
                controller.enqueue({ type: 'text-start', id: 'done' });
                controller.enqueue({ type: 'text-delta', id: 'done', delta: 'Synthetic fixture complete.' });
                controller.enqueue({ type: 'text-end', id: 'done' });
              }
              controller.enqueue({ type: 'finish', finishReason: { unified: step ? 'tool-calls' : 'stop', raw: undefined }, usage });
              controller.close();
            } }) };
          },
        };
      });
      record({ type: 'registered', tools: (await ctx.tool.list()).map((t: any) => ({ id: t.id, input: t.input, options: t.options })) });
      return () => { record({ type: 'disposed' }); };
} });
