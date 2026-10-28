import { searchFixture } from './plan-task-search.ts';
import { digest } from '../../shared/store.ts';
import type { CaptureRequest } from '../../shared/document-comparison.ts';
import type { DocumentState } from '../../shared/progress.ts';

/** Synthetic reports only; these paths never reference a real source file. */
export function captureFixture() {
  const f = searchFixture(false); let sequence = 0;
  function record(text: string, plan = 'P-captures', path = '/fixture/plan.md', state: DocumentState = 'captured') {
    const previous = f.store.get(f.alpha.id, plan);
    const capture = { state, path, canonicalPath: path, checkedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, sequence)).toISOString(), ...(state === 'captured' ? { text, hash: digest(text) } : {}) };
    f.store.apply({ plan, oid: `capture-${++sequence}`, rev: previous?.revision ?? 0,
      ...(previous ? { op: 'bind', source: path, confirm: false } : { op: 'start', title: plan, source: path, items: [{ id: 'T', title: 'Record plan', kind: 'task', status: 'done' }] }),
    }, f.actor, capture);
    return f.store.get(f.alpha.id, plan)!.document.captureId!;
  }
  const request = (plan = 'P-captures', cleanupRev = 0): CaptureRequest => ({ storeId: f.storeId, binding: { sourceId: f.alpha.id, verified: true }, source: f.alpha.id, plan, cleanupRev });
  return { ...f, record, request };
}
