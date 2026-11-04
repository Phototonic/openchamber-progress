import type { searchFixture } from './plan-task-search.ts';
import { mapItems } from './dependency-map.ts';

/** Real delegation/binding/run writes. No fixture-authored assignmentBinding DTO. */
export function seedMapAttribution(f: ReturnType<typeof searchFixture>) {
  f.store.installDelegationControl(); f.store.installSubagentRuns();
  f.apply('P-map', { op: 'revise', items: [...mapItems, { id: 'L', title: 'Legacy link-only context', kind: 'task' }] });
  const child = { ...f.actor, sessionId: 'map-child', parentId: f.actor.sessionId, ancestry: [f.actor.sessionId] };
  const base = 1_800_000_000_000;
  f.store.declareDelegation({ op: 'delegate', plan: 'P-map', oid: 'map-delegate', rev: f.store.get(f.alpha.id, 'P-map')!.revision, assign: ['B'] }, f.actor);
  const key = { source: f.alpha.id, parent: f.actor.sessionId, message: 'map-message', call: 'map-call' };
  f.store.beforeRun(key, f.actor, 'subagent', { agent: 'explorer', description: 'Map assigned session' }, base);
  f.store.observeExecution({ source: f.alpha.id, child: child.sessionId, id: 'map-start', sequence: 1, at: base + 100, state: 'running', errorType: null, interruptionReason: null });
  f.store.afterRun(key, f.store.runControl().generation, child, 'returned');
  const linked = { ...child, sessionId: 'map-linked' };
  f.apply('P-map', { op: 'link', child: linked.sessionId, assign: ['C', 'I', 'L'] }, f.actor, linked);
  for (let n = 0; n < 2; n++) f.apply('P-map', { op: 'change', attributed: child.sessionId, changes: [{ id: 'B', status: 'working' }] }, f.actor, child);
  return {
    child,
    terminal() { f.store.observeExecution({ source: f.alpha.id, child: child.sessionId, id: 'map-end', sequence: 2, at: base + 1000, state: 'succeeded', errorType: null, interruptionReason: null }); },
  };
}
