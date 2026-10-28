import { productionFixture } from './production.ts';
import type { ItemInput, Status } from '../../shared/progress.ts';

export const digestItems: ItemInput[] = [
  { id: 'G', title: 'Work', kind: 'group' },
  { id: 'A', title: 'First task', kind: 'task', status: 'done', parentId: 'G' },
  { id: 'B', title: 'Second task', kind: 'task', status: 'working' },
  { id: 'C', title: 'Optional task', kind: 'task', status: 'skipped' },
];
export function digestFixture(seed = true) {
  const f = productionFixture();
  f.store.bindReads(f.source.id, true);
  let oid = 0;
  const apply = (request: Record<string, unknown>) => f.store.apply({ plan: 'P-digest', rev: f.store.get(f.source.id, 'P-digest')?.revision ?? 0, oid: `operation-${++oid}`, ...request }, f.actor);
  const change = (status: Status) => apply({ op: 'change', changes: [{ id: 'B', status }] });
  const revise = (items: ItemInput[]) => apply({ op: 'revise', items });
  if (seed) apply({ op: 'start', title: 'Digest example', items: digestItems });
  const storeId = f.store.list().storeId;
  const request = (to = f.store.get(f.source.id, 'P-digest')!.revision, after?: number, cleanupRev = 0) => ({ storeId, source: f.source.id, plan: 'P-digest', to, ...(after !== undefined ? { after } : {}), cleanupRev });
  const read = (after?: number, to?: number) => f.store.changeDigest(request(to, after));
  function throughSix() {
    change('blocked');
    const repeat = { op: 'change', plan: 'P-digest', rev: 2, oid: 'repeat-blocked', changes: [{ id: 'B', status: 'blocked' }] };
    f.store.apply(repeat, f.actor); f.store.apply(repeat, f.actor);
    change('working'); change('done');
    revise([...digestItems.map(i => i.id === 'B' ? { ...i, status: 'done' as const } : i), { id: 'D', title: 'Added task', kind: 'task' }]);
  }
  return { ...f, apply, change, revise, request, read, storeId, throughSix };
}
