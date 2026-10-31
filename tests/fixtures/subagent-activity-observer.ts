/** Disposable native probe. Records allowlisted metadata, never tool/conversation content. */
import { Model, Provider, Plugin } from '@opencode/plugin';
import fs from 'node:fs';
import { identifier } from '../../shared/progress.ts';

export default Plugin.define({ id: 'subagent-activity-probe', async setup(ctx) {
  const root = process.env.ACTIVITY_ROOT!;
  const start = performance.now();
  const record = (value: object) => fs.appendFileSync(`${root}/events.jsonl`, JSON.stringify({ ms: Math.round(performance.now() - start), ...value }) + '\n');
  const classify = (error: any) => {
    const text = typeof error?.message === 'string' ? error.message.toLowerCase() : '';
    return text.includes('subagent') && (text.includes('cannot') || text.includes('nested')) ? 'native-nested-delegation-refused'
      : text.includes('permission') || text.includes('denied') ? 'permission-refused'
      : text.includes('agent') && (text.includes('not found') || text.includes('unknown')) ? 'unknown-agent'
      : text.includes('missing test-owned identity marker') ? 'fixture-identity-marker-missing'
      : text.includes('synthetic provider failure') ? 'synthetic-provider-failure'
      : 'unclassified-error';
  };
  record({ type: 'startup-phase', phase: 'observer-setup-started' });
  const providerID = Provider.ID.make('activity-fixture');
  const modelID = Model.ID.make('script');
  await ctx.tool.transform(editor => {
    (globalThis as any)[Symbol.for('activity-fixture-native-subagent')] = editor.get('subagent')?.execute;
    // Adversarial fixture only: preserve the real native call, then substitute a
    // verified unrelated root in its structured output for one labeled case.
    if (fs.existsSync(`${root}/production-regression`)) editor.update('subagent', tool => {
      const execute = tool.execute;
      tool.execute = async (input, caller) => {
        const result: any = await execute(input, caller);
        if (caller.id !== 'fault-wrong-output') return result;
        record({ type: 'synthetic-result-fault', callID: caller.id });
        return { ...result, output: { ...result.output, sessionID: fs.readFileSync(`${root}/wrong-child`, 'utf8') } };
      };
    });
  });
  await ctx.provider.transform(editor => {
    for (const p of editor.list()) editor.remove(p.provider.id);
    editor.add({ info: { ...Provider.Info.empty(providerID), activation: 'enabled', package: `aisdk:file://${root}/sdk.mjs` }, models: [Model.Info.default(providerID, modelID)] });
  });
  record({ type: 'startup-phase', phase: 'provider-transform-registered' });
  await ctx.model.transform(editor => editor.default.set(providerID, modelID));
  record({ type: 'startup-phase', phase: 'model-transform-registered' });
  await ctx.agent.transform(editor => {
    for (const agent of editor.list()) editor.update(agent.id, a => { a.model = { providerID, id: modelID }; });
  });
  record({ type: 'startup-phase', phase: 'agent-transform-registered' });
  await ctx.session.hook('title', e => { e.result = 'Synthetic activity probe'; });
  await ctx.session.hook('retry', e => { e.decision = { retry: false }; });
  await ctx.session.hook('http.request', () => { record({ type: 'unexpected-http' }); throw new Error('Local scripted transport only'); });
  await ctx.session.hook('context', e => {
    // Test-owned identity marker only; provider never inspects conversation or other system text.
    e.system.push({ type: 'text', text: `ACTIVITY_FIXTURE_ID:${e.sessionID}` });
    const schema: any = e.tools.subagent?.input;
    record({ type: 'context', sessionID: e.sessionID, agent: e.agent, reportTool: Object.keys(e.tools).some(t => t.includes('agent_progress_report')),
      delegationSchema: schema, tools: Object.keys(e.tools).filter(t => ['subagent', 'task'].includes(t)) });
  });
  await ctx.tool.hook('execute.before', e => {
    if (e.tool !== 'subagent') return;
    const input: any = e.input;
    record({ type: 'before', sessionID: e.sessionID, messageID: e.messageID, callID: e.id, tool: e.tool,
      inputKeys: Object.keys(input ?? {}), background: input?.background === true, resumeID: typeof input?.sessionID === 'string' ? input.sessionID : undefined });
  });
  await ctx.tool.hook('execute.after', async e => {
    if (e.tool === 'agent_progress_report') {
      let reply: any; try { const result = (e as any).result; reply = JSON.parse(result?.output?.content ?? result?.content); } catch {}
      record({ type: 'report-reply', callID: e.id, sessionID: e.sessionID, status: e.status, error: reply?.error, rev: reply?.rev, pending: reply?.pending, disposition: reply?.disposition });
    }
    if (e.tool !== 'subagent') return;
    const result: any = e.status === 'completed' ? e.result : undefined;
    const output = result?.output;
    const childID = typeof output?.sessionID === 'string' ? output.sessionID : undefined;
    let native: any;
    if (childID) { try {
      const child = await ctx.session.get({ sessionID: childID });
      const ancestry: string[] = [];
      let cursor = child;
      const visited = new Set<string>();
      while (cursor.parentID && ancestry.length < 32 && !visited.has(cursor.id)) {
        visited.add(cursor.id); ancestry.push(cursor.parentID); cursor = await ctx.session.get({ sessionID: cursor.parentID });
      }
      native = { id: child.id, parentID: child.parentID, ancestry, complete: !cursor.parentID, sameDirectory: child.location.directory === ctx.location.directory, outcome: child.outcome };
    } catch {} }
    record({ type: 'after', sessionID: e.sessionID, messageID: e.messageID, callID: e.id, tool: e.tool, status: e.status,
      resultKeys: result ? Object.keys(result) : [], outputKeys: output && typeof output === 'object' ? Object.keys(output) : [],
      outputStatus: ['running', 'completed', 'error', 'failed', 'cancelled'].includes(output?.status) ? output.status : undefined,
      childID, native, errorClass: e.status === 'error' ? classify(e.error) : undefined, metadataKeys: result?.metadata ? Object.keys(result.metadata) : [] });
    if (e.id === 'parallel-fast') fs.writeFileSync(`${root}/release`, 'release');
  });
  const abort = new AbortController();
  const events = (async () => {
    try {
      for await (const event of ctx.event.subscribe({ signal: abort.signal })) {
        if (!event.type.startsWith('session.') && !['form.created', 'form.cancelled'].includes(event.type)) continue;
        const e = event as any;
        if(e.type.startsWith('session.execution.'))record({type:'native-shape',kind:e.type,idValid:identifier(e.id),createdType:typeof e.created,createdInteger:Number.isSafeInteger(e.created),sameDirectory:e.location?.directory===ctx.location.directory,aggregateMatches:e.durable?.aggregateID===e.data?.sessionID,sequenceInteger:Number.isSafeInteger(e.durable?.seq)});
        // Kind/identity/state only. No messages, errors, outputs or titles are retained.
        record({ type: 'event', kind: e.type, sessionID: e.data?.sessionID ?? e.data?.form?.sessionID,
          messageID: e.data?.assistantMessageID,
          callID: e.type.startsWith('session.tool.') ? e.data?.id : undefined,
          tool: e.type === 'session.tool.input.started' && e.data?.name === 'subagent' ? 'subagent' : undefined,
          seq: e.durable?.seq,
          parentID: e.type === 'session.created' ? e.data?.parentID : undefined,
          state: ['idle', 'busy', 'retry'].includes(e.data?.status?.type) ? e.data.status.type : undefined,
          failureClass: ['session.step.failed', 'session.execution.failed', 'session.tool.failed'].includes(e.type) ? classify(e.data?.error) : undefined,
          durable: Boolean(e.durable) });
      }
    } catch { if (!abort.signal.aborted) record({ type: 'subscription-failed' }); }
  })();
  const seen = new Set<string>();
  await ctx.aisdk.hook('sdk', e => { record({ type: 'transport-phase', phase: 'sdk-hook', expectedProvider: e.model.providerID === providerID }); if (e.model.providerID !== providerID) throw new Error('Unexpected provider'); e.sdk = {}; });
  await ctx.aisdk.hook('language', e => {
    if (e.model.providerID !== providerID) throw new Error('Unexpected provider');
    record({ type: 'transport-phase', phase: 'language-hook' });
    const dispatch = async (options: any) => {
      const identity = options.prompt.filter((m: any) => m.role === 'system' && typeof m.content === 'string')
        .map((m: any) => m.content.match(/(?:^|\n)ACTIVITY_FIXTURE_ID:(\S+)/)?.[1]).find(Boolean);
      record({ type: 'transport-phase', phase: 'dispatch-entered', identityMarkerPresent: Boolean(identity) });
      if (!identity) throw new Error('Missing test-owned identity marker');
      const session = await ctx.session.get({ sessionID: identity });
      const jobs = JSON.parse(fs.readFileSync(`${root}/jobs.json`, 'utf8'));
      const job = jobs[identity];
      const key = `${identity}:${job?.generation ?? 'initial'}`;
      let calls = !seen.has(key) ? job?.calls : undefined;
      if (!seen.has(key) && session.agent === 'nested-worker') calls = [{ id: 'nested', input: { agent: 'restricted-worker', description: 'Synthetic nested child', prompt: 'Synthetic fixed probe.' } }];
      if(!seen.has(key)&&session.agent==='reporting-worker')calls=[{id:'child-handoff',tool:'agent_progress_report',input:{op:'handoff',oid:'native-claim',summary:'Synthetic child reports its bounded work complete.',outcome:'done'}}];
      seen.add(key);
      record({ type: 'dispatch', sessionID: identity, agent: session.agent, calls: calls?.map((c: any) => c.id) ?? [], hold: job?.hold === true, fault: job?.fault === true });
      if (job?.fault) throw new Error('Synthetic provider failure');
      if(session.agent==='failing-worker'){
        const deadline=Date.now()+15000;
        while(!fs.existsSync(`${root}/release-failure`)&&!options.abortSignal?.aborted&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,20));
        throw new Error('Synthetic provider failure');
      }
      if (job?.hold || session.agent === 'slow-worker') {
        const deadline = Date.now() + 15000;
        while (!fs.existsSync(`${root}/release`) && !options.abortSignal?.aborted && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
        if (options.abortSignal?.aborted) throw new Error('Synthetic aborted transport');
      }
      return { calls, lateSecond: job?.lateSecond === true, identity };
    };
    const usage = { inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 0, text: 0, reasoning: 0 } };
    e.language = {
      specificationVersion: 'v3', provider: providerID, modelId: modelID, supportedUrls: {},
      async doGenerate(options: any) {
        const { calls } = await dispatch(options);
        return { content: calls?.map((c: any) => ({ type: 'tool-call', toolCallId: c.id, toolName: c.tool ?? 'subagent', input: JSON.stringify(c.input) })) ?? [{ type: 'text', text: 'Synthetic fixed response.' }], finishReason: { unified: calls ? 'tool-calls' : 'stop', raw: undefined }, usage, warnings: [] };
      },
      async doStream(options: any) {
        const { calls, lateSecond, identity } = await dispatch(options);
        return { stream: new ReadableStream({ async start(controller) {
          controller.enqueue({ type: 'stream-start', warnings: [] });
          if (calls) for (let i = 0; i < calls.length; i++) {
            const c = calls[i];
            if (lateSecond && i === 1) {
              // A real host input-start observation, not a delay or a first result,
              // releases the second provider call in this still-open stream.
              const deadline = Date.now() + 5000;
              let observedFirstInput = false;
              while (Date.now() < deadline) {
                const events = fs.readFileSync(`${root}/events.jsonl`, 'utf8').trim().split('\n').map(s => JSON.parse(s));
                if (events.some(e => e.kind === 'session.tool.input.started' && e.sessionID === identity && e.callID === calls[0].id)) { observedFirstInput = true; break; }
                await new Promise(resolve => setTimeout(resolve, 10));
              }
              record({ type: 'late-second-release', sessionID: identity, firstCall: calls[0].id, observedFirstInput });
              if (!observedFirstInput) throw new Error('Synthetic first-input observation deadline');
            }
            controller.enqueue({ type: 'tool-call', toolCallId: c.id, toolName: c.tool ?? 'subagent', input: JSON.stringify(c.input) });
          }
          else {
            controller.enqueue({ type: 'text-start', id: 'fixed' });
            controller.enqueue({ type: 'text-delta', id: 'fixed', delta: 'Synthetic fixed response.' });
            controller.enqueue({ type: 'text-end', id: 'fixed' });
          }
          controller.enqueue({ type: 'finish', finishReason: { unified: calls ? 'tool-calls' : 'stop', raw: undefined }, usage });
          controller.close();
        } }) };
      },
    };
  });
  record({ type: 'registered' });
  return async () => { abort.abort(); await events; record({ type: 'disposed' }); };
} });
