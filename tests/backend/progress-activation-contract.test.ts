import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Effect } from 'effect';
import { fromPromise } from '@opencode/plugin/promise/adapter';

test('A1 installed 2.1.4 adapter preserves native post-execute/context fields (fake host, not native proof)', async () => {
  const registered = new Map<string, (event: any) => Effect.Effect<void>>();
  let disposed = 0;
  const unused: any = new Proxy(() => {}, { get: () => unused });
  const domain = (name: string) => new Proxy({}, { get: (_, key) => key === 'hook'
    ? (hook: string, callback: any) => Effect.sync(() => {
      registered.set(`${name}:${hook}`, callback);
      return { dispose: Effect.sync(() => { disposed++; }) };
    }) : unused });
  const host: any = new Proxy({}, { get: (_, name) => domain(String(name)) });
  const seen: any[] = [];
  const plugin = fromPromise({ id: 'activation-contract-only', async setup(ctx) {
    const after = await ctx.tool.hook('execute.after', event => { seen.push(event); });
    const context = await ctx.session.hook('context', event => { seen.push(event); });
    return async () => { await after.dispose(); await context.dispose(); };
  } });
  await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    yield* plugin.effect(host);
    const identity = { sessionID: 'ses_fixture', agent: 'arbitrary-coordinator', messageID: 'msg_fixture', id: 'call_fixture' };
    const cases = [
      { ...identity, tool: 'write', input: { path: 'docs/plans/search.md', content: 'fixture' }, status: 'completed', result: { output: { operation: 'write', target: '/fixture/docs/plans/search.md', resource: 'docs/plans/search.md', existed: false }, content: [{ type: 'text', text: 'Created file successfully: docs/plans/search.md' }] } },
      { ...identity, tool: 'edit', input: { path: 'docs/plans/search.md', oldString: 'fixture', newString: 'revision' }, status: 'completed', result: { output: { files: [{ file: 'docs/plans/search.md', status: 'modified' }], replacements: 1 } } },
      { ...identity, tool: 'write', input: { path: 'docs/plans', content: 'failure' }, status: 'error', error: { _tag: 'Tool.Error', message: 'Unable to write docs/plans' } },
    ];
    for (const event of cases) yield* registered.get('tool:execute.after')!(event);
    const context = { sessionID: identity.sessionID, agent: identity.agent, model: { providerID: 'fixture', id: 'script' }, system: [], messages: [], options: {}, tools: { agent_progress_report: { description: 'fixture', input: {} } } };
    yield* registered.get('session:context')!(context);
    assert.deepEqual(seen, [...cases, context]);
  })));
  assert.equal(disposed, 2, 'fake host disposers reached through real adapter');
});
