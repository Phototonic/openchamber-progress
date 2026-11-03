import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdirSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { createProgressServer } from '../../service/server.ts';
import { searchFixture } from '../fixtures/plan-task-search.ts';
import { parseHealth, parsePlanGraph, planGraphQuery } from '../../ui/shared/adapter.ts';
import { readPlanGraph, type ServiceHost } from '../../ui/shared/source.ts';
import type { PlanGraphRequest } from '../../shared/progress.ts';

test('graph boundary: real DTO, capability gating, immutable pin, and explicit failures', async () => {
  const f = searchFixture(false); const server = createProgressServer(f.store, 'synthetic-token'); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`; let requests = 0;
  const host: ServiceHost = { serviceRequest: async q => { requests++; assert.equal(q.path, '/v1/plan-graph'); const r = await fetch(`${base}${q.path}?${new URLSearchParams(q.query)}`, { headers: { authorization: 'Bearer synthetic-token' } }); return { status: r.status, body: await r.text() }; } };
  const pin = (plan: string): PlanGraphRequest => ({ storeId: f.storeId, binding: { sourceId: f.alpha.id, verified: true }, source: f.alpha.id, plan, revision: 1, cleanupRev: 0 });
  const cases: { case: string; passed: boolean; requests?: number }[] = [];
  try {
    f.seedPlan('P', 'Plan', [{ id: 'G', title: 'Group', kind: 'group', dependencies: ['T'] }, { id: 'T', title: 'Task', kind: 'task', parentId: 'G' }]); f.seedPlan('empty', 'Empty', []);
    const response = await fetch(base + '/health', { headers: { authorization: 'Bearer synthetic-token' } }); const health = parseHealth(await response.text()); assert.equal(health.planGraph, 1);
    for (const capability of [undefined, null, 0, 2, '1', true, {}]) {
      const h = parseHealth(JSON.stringify({ ok: true, ready: true, sqlite: true, protocolVersion: 2, schemaVersion: 2, planGraph: capability })); assert.equal(h.planGraph, undefined);
      const result = await readPlanGraph(host, { planGraph: capability }, pin('P')); assert.equal(result.ok, false); if (!result.ok) assert.equal(result.reason, 'unavailable'); assert.equal(requests, 0);
    }
    cases.push({ case: 'unsupported-capabilities', passed: true, requests: 0 });
    const result = await readPlanGraph(host, health, pin('P')); assert.equal(requests, 1); assert.equal(result.ok, true); if (!result.ok) throw Error('expected graph');
    assert.equal(result.graph.itemCount, 2); assert.deepEqual(result.graph.items[0].dependencies, ['T']);
    const empty = await readPlanGraph(host, health, pin('empty')); assert.equal(empty.ok, true); if (empty.ok) assert.deepEqual(empty.graph.items, []);
    cases.push({ case: 'real-service-complete-and-empty', passed: true, requests: 2 });
    const dto = result.graph, r = pin('P');
    const invalid = async (body: string) => { let calls = 0; const out = await readPlanGraph({ serviceRequest: async () => { calls++; return { status: 200, body }; } }, health, r); assert.equal(calls, 1); assert.equal(out.ok, false); if (!out.ok) assert.equal(out.reason, 'invalid'); assert.ok(!('graph' in out)); };
    for (const patch of [
      { storeId: 'wrong' }, { source: 'wrong' }, { plan: 'wrong' }, { sourceBinding: { sourceId: f.beta.id, verified: true } }, { sourceBinding: { sourceId: f.alpha.id, verified: false } },
      { revision: 2 }, { structuralRevision: 2 }, { cleanup: { state: 'visible', revision: 1 } }, { protocolVersion: 3 }, { schemaVersion: 3 }, { planGraph: 2 },
      { itemCount: 3 }, { complete: false }, { complete: undefined }, { nextCursor: null }, { partial: true }, { items: [] },
      { items: [{ ...dto.items[0], title: 'not-on-wire' }, dto.items[1]] }, { items: [{ ...dto.items[0], dependencies: ['missing'] }, dto.items[1]] },
      { items: [{ ...dto.items[0], dependencies: ['G'] }, dto.items[1]] }, { items: [dto.items[0], dto.items[0]] },
      { items: [{ ...dto.items[0], parentId: undefined }, dto.items[1]] }, { items: [{ ...dto.items[0], dependencies: undefined }, dto.items[1]] },
      { items: [{ ...dto.items[0], status: 'future' }, dto.items[1]] }, { items: [{ ...dto.items[0], parentId: 'T' }, dto.items[1]] },
      { items: [{ ...dto.items[0], status: ['pending'] }, dto.items[1]] }, { cleanup: { state: ['visible'], revision: 0 } },
    ]) await invalid(JSON.stringify({ ...dto, ...patch }));
    await invalid('{'); await invalid(' '.repeat(1048577));
    // UTF-8 ceiling, not just JS code units.
    await invalid(JSON.stringify({ ...dto, padding: 'é'.repeat(524288) }));
    for (const [status, code, reason] of [[409, 'conflict', 'conflict'], [404, 'not-found', 'not-found'], [413, 'response-too-large', 'invalid'], [503, 'busy', 'read-failed'], [503, 'schema', 'invalid'], [503, 'corrupt', 'read-failed'], [401, 'unauthorized', 'read-failed']] as const) {
      let calls = 0; const out = await readPlanGraph({ serviceRequest: async () => { calls++; return { status, body: JSON.stringify({ error: code }) }; } }, health, r); assert.equal(calls, 1); assert.equal(out.ok, false); if (!out.ok) { assert.equal(out.reason, reason); assert.equal(out.status, status); } assert.ok(!('graph' in out));
    }
    for (const code of ['HOST_TIMEOUT','NOT_GRANTED','RESPONSE_TOO_LARGE']) { const out = await readPlanGraph({ serviceRequest: async () => { throw { code }; } }, health, r); assert.equal(out.ok, false); assert.ok(!('graph' in out)); }
    const mutable = pin('P'); const out = await readPlanGraph({ serviceRequest: async q => { const old = structuredClone(dto); mutable.revision = 2; mutable.binding.sourceId = 'other'; assert.equal(q.query?.revision, '1'); return { status: 200, body: JSON.stringify(old) }; } }, health, mutable); assert.equal(out.ok, true);
    assert.equal(planGraphQuery({ ...r, revision: 10000000000 }).revision, '10000000000'); assert.throws(() => planGraphQuery({ ...r, revision: Number.MAX_SAFE_INTEGER + 1 }));
    assert.deepEqual(parsePlanGraph(JSON.stringify(dto), r), dto);
    cases.push({ case: 'defensive-parser-http-host-errors-and-captured-pin', passed: true });
    if (process.env.EVIDENCE) { mkdirSync(process.env.EVIDENCE, { recursive: true }); writeFileSync(`${process.env.EVIDENCE}/client.json`, JSON.stringify(cases, null, 2) + '\n'); }
  } finally { server.close(); await once(server, 'close'); f.cleanup(); }
});
