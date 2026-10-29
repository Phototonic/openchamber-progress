/** Test-only V2 entry wrapper. The cached slim implementation is copied unchanged. */
import { Plugin } from '@opencode/plugin';
import fs from 'node:fs';

export default Plugin.define({ id: 'oh-my-opencode-slim', async setup(ctx) {
  const root = process.env.ACTIVITY_ROOT!;
  const record = (value: object) => fs.appendFileSync(`${root}/events.jsonl`, JSON.stringify({ type: 'slim-phase', ...value }) + '\n');
  record({ phase: 'entry-loaded' });
  const slim = (await import(`${root}/config/opencode/plugins/slim/implementation.mjs`)).default;
  const hooks: Record<string, number> = {};
  const observed = { ...ctx, tool: { ...ctx.tool,
    transform: async (callback: any) => ctx.tool.transform(editor => {
      const changes: any = { added: [], updated: [], removed: [] };
      const draft = new Proxy(editor, { get(target, key) {
        if (key === 'add') return (info: any) => { changes.added.push(info.name); return target.add(info); };
        if (key === 'update') return (id: string, update: any) => { changes.updated.push(id); return target.update(id, update); };
        if (key === 'remove') return (id: string) => { changes.removed.push(id); return target.remove(id); };
        const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
      } });
      callback(draft); record({ phase: 'tool-transform-applied', ...changes });
    }), hook: async (name: any, callback: any) => {
    hooks[name] = (hooks[name] ?? 0) + 1;
    return ctx.tool.hook(name, async (e: any) => {
      if (e.tool === 'subagent') record({ phase: 'hook-called', hook: name, sessionID: e.sessionID, callID: e.id });
      try { return await callback(e); }
      catch (error: any) {
        if (e.tool === 'subagent') {
          const text = typeof error?.message === 'string' ? error.message.toLowerCase() : '';
          record({ phase: 'hook-threw', hook: name, sessionID: e.sessionID, callID: e.id,
            errorClass: text.includes('unreconciled') || text.includes('acknowledg') ? 'terminal-result-acknowledgment-required'
              : text.includes('still running') && text.includes('resum') ? 'running-task-resume-refused'
              : text.includes('loop') || text.includes('duplicate') ? 'loop-or-duplicate-guard'
              : text.includes('cannot read properties') ? 'undefined-property-access'
              : text.includes('session') && text.includes('not found') ? 'session-not-found' : 'other-slim-hook-error' });
        }
        throw error;
      }
    });
  } } };
  const dispose = await slim.setup(observed);
  record({ phase: 'setup-completed', hooks });
  await ctx.tool.transform(editor => {
    const tool = editor.get('subagent');
    const baseline = (globalThis as any)[Symbol.for('activity-fixture-native-subagent')];
    record({ phase: 'effective-tool', present: Boolean(tool), baselineObserved: Boolean(baseline), executeReferenceEqual: Boolean(tool && baseline && tool.execute === baseline),
      effectiveName: tool?.name === 'subagent' ? 'subagent' : 'other-or-absent', hasStructuredOutputSchema: Boolean(tool?.output) });
  });
  return async () => { await dispose?.(); record({ phase: 'disposed' }); };
} });
