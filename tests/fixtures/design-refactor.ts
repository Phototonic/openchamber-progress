import type { BlockerItemInput } from '../../shared/progress.ts';
import type { searchFixture } from './plan-task-search.ts';

export const DESIGN_SOURCE = 'source-design';
export const DESIGN_PLAN = 'P-calm';
export const DESIGN_NO_EDGES = 'P-calm-no-edges';
export const designItems = (edges = true): BlockerItemInput[] => [
  ...['D1', 'D2', 'D3'].map((id, n) => ({ id, title: ['Release notes drafted', 'Compatibility checked', 'Package verified'][n], kind: 'task' as const, status: 'done' as const })),
  { id: 'W1', title: 'Build release candidate', kind: 'task', status: 'working' },
  { id: 'W2', title: 'Check release guide', kind: 'task', status: 'working' },
  { id: 'B1', title: 'Confirm distribution window', kind: 'task', status: 'blocked', blocker: { category: 'external', reason: 'Distribution window has not been confirmed.', nextAction: 'Ask the release coordinator to confirm the window.' } },
  { id: 'R1', title: 'Prepare launch checklist', kind: 'task', status: 'pending' },
  { id: 'Q1', title: 'Publish release announcement', kind: 'task', status: 'pending', ...(edges ? { dependencies: ['B1'] } : {}) },
];

/** F8/F8-N; F12 adds nine closed plans, not archived plans. Foreign identity is a
 * separate boundary variant so the quiet F12 board really contains twelve rows.
 * Production writes only.
 */
export function seedDesignFixture(f: ReturnType<typeof searchFixture>, twelve = false, foreign = false) {
  const source = { ...f.alpha, id: DESIGN_SOURCE, configRoot: '/fixture/design/config', dataRoot: '/fixture/design/data' };
  f.store.registerSource(source); f.store.bindReads(source.id, true);
  // The shell's generated-service binding must identify this same synthetic source.
  f.alpha = source;
  const actor = { ...f.actor, sourceId: source.id, projectId: 'harbor-app', directory: '/fixture/harbor-app/release-2-0' };
  f.seedPlan(DESIGN_PLAN, 'Release 2.0 launch', designItems(), actor);
  f.seedPlan(DESIGN_NO_EDGES, 'Release 2.0 launch — no recorded edges', designItems(false), actor);
  // The real timing reader scans a bounded revision history: W2 predates that window;
  // W1's observed transition is inside it. No fixture-authored timing response DTOs.
  for (const plan of [DESIGN_PLAN, DESIGN_NO_EDGES]) {
    for (let n = 0; n < 128; n++) f.apply(plan, { op: 'revise', title: plan === DESIGN_PLAN ? 'Release 2.0 launch' : 'Release 2.0 launch — no recorded edges' }, actor);
    f.apply(plan, { op: 'change', changes: [{ id: 'W1', status: 'pending' }] }, actor);
    f.apply(plan, { op: 'change', changes: [{ id: 'W1', status: 'working' }] }, actor);
    // Same relative time seeds for every before/after run, using the existing synthetic-history seam.
    const base = Date.now() - 180 * 60_000;
    for (const row of f.store.db.prepare('SELECT revision,snapshot FROM revisions WHERE source=? AND plan=?').all(source.id, plan)) {
      const p = JSON.parse(String(row.snapshot));
      p.reportedAt = new Date(base + Number(row.revision) * 60_000).toISOString();
      for (const item of p.items) if (item.blocker) item.blocker.reportedAt = new Date(base + item.blocker.reportedRevision * 60_000).toISOString();
      const snapshot = JSON.stringify(p);
      f.store.db.prepare('UPDATE revisions SET snapshot=? WHERE source=? AND plan=? AND revision=?').run(snapshot, source.id, plan, Number(row.revision));
      f.store.db.prepare('UPDATE plans SET snapshot=? WHERE source=? AND id=? AND revision=?').run(snapshot, source.id, plan, Number(row.revision));
      const contribution = f.store.db.prepare('SELECT payload FROM contributions WHERE source=? AND plan=? AND revision=?').get(source.id, plan, Number(row.revision));
      if (contribution) f.store.db.prepare('UPDATE contributions SET payload=? WHERE source=? AND plan=? AND revision=?').run(JSON.stringify({ ...JSON.parse(String(contribution.payload)), reportedAt: p.reportedAt }), source.id, plan, Number(row.revision));
    }
  }
  f.store.installDelegationControl(); f.store.installSubagentRuns();
  for (const [n, state] of ['running', 'running', 'succeeded', 'unknown'].entries()) {
    const key = { source: source.id, parent: actor.sessionId, message: `design-message-${n}`, call: `design-call-${n}` };
    const child = { ...actor, sessionId: `design-child-${n}`, parentId: actor.sessionId, ancestry: [actor.sessionId] };
    const at = Date.now() - (10 - n) * 60_000;
    // Multiple active plans are deliberately ambiguous. Only an explicit production
    // delegation may associate these runs with F8; recency is not assignment proof.
    f.store.declareDelegation({ op: 'delegate', plan: DESIGN_PLAN, oid: `design-delegate-${n}`, rev: f.store.get(source.id, DESIGN_PLAN)!.revision, assign: [['W1'], ['W2'], ['D1'], ['R1']][n] }, actor);
    f.store.beforeRun(key, actor, 'subagent', { agent: 'explorer', description: `Release check ${n + 1}` }, at);
    if (state !== 'unknown') f.store.observeExecution({ source: source.id, child: child.sessionId, id: `design-start-${n}`, sequence: 1, at: at + 100, state: 'running', errorType: null, interruptionReason: null });
    f.store.afterRun(key, f.store.runControl().generation, child, 'returned');
    if (state === 'succeeded') f.store.observeExecution({ source: source.id, child: child.sessionId, id: `design-end-${n}`, sequence: 2, at: at + 1000, state: 'succeeded', errorType: null, interruptionReason: null });
  }
  // This isolated shell has no native history worker. Complete the real recovery
  // job with an empty historical page so screenshots are not taken mid-recovery.
  f.store.requestRunReconciliation({ storeId: f.storeId, binding: { sourceId: source.id, verified: true }, source: source.id, root: actor.sessionId });
  const recovery = f.store.claimRunRecovery(source.id, actor.sessionId);
  if (!recovery) throw Error('Design fixture history recovery was not admitted');
  f.store.finishRunRecovery(recovery, 'complete');
  const other = { ...actor, projectId: 'lighthouse-app', directory: '/fixture/lighthouse-app/main' };
  f.seedPlan('P-release-other', 'Release companion guide', [{ id: 'R1', title: 'Prepare companion guide', kind: 'task', status: 'pending' }], other);
  if (twelve) {
    for (let n = 1; n <= 9; n++) {
      const who = n <= 7 ? actor : other;
      const plan = `P-release-closed-${n}`;
      f.seedPlan(plan, `Release ${n} record`, [{ id: 'D1', title: 'Release preparation', kind: 'task', status: 'done' }], who);
      f.apply(plan, { op: 'finish', outcome: n === 7 ? 'cancelled' : 'finished' }, who);
    }
  }
  if (foreign) f.seedPlan(DESIGN_PLAN, 'Release source counterpart', designItems(), { ...actor, sourceId: f.beta.id, sessionId: 'N' });
  return { source: source.id, actor, other };
}
