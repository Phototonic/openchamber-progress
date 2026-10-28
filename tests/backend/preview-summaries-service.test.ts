import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdirSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import type { GuestRequest, GuestRequestResult } from '@openchamber/sdk';
import { createProgressServer } from '../../service/server.ts';
import { readDetail, type DetailResult, type ServiceHost } from '../../ui/shared/source.ts';
import { formatHandoff, formatSummaryOnly } from '../../ui/shared/summary.ts';
import { productionFixture } from '../fixtures/production.ts';
import { FORBIDDEN, pagedSummaryItems, SUMMARY_REQUEST } from '../fixtures/preview-summaries.ts';

type SafeCase = { case: string; passed: boolean; facts: string[] };

test('Q2 authenticated service: whole-plan reads, honest failures, archive readability, deletion and privacy', { timeout: 15000 }, async () => {
  const f = productionFixture();
  const token = 'synthetic-summary-test-only';
  const server = createProgressServer(f.store, token);
  const cases: SafeCase[] = [];
  const actor = { ...f.actor, sessionId: 'session-example', agent: FORBIDDEN, projectId: FORBIDDEN };
  const requestPlan = { ...SUMMARY_REQUEST, sourceId: f.source.id };
  const items = pagedSummaryItems();
  let completed = false;
  try {
    f.store.apply({ op: 'start', plan: requestPlan.id, oid: 'start', rev: 0, title: 'Add export flow', items }, actor);
    for (let n = 1; n <= 40; n++) f.store.apply({ op: 'change', plan: requestPlan.id, oid: `report-${n}`, rev: n, changes: [{ id: 'task-1', status: n % 2 ? 'working' : 'pending' }] }, actor);
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const httpReply = async (q: GuestRequest, bearer = token): Promise<GuestRequestResult> => {
      const url = new URL(q.path, base);
      for (const [key, value] of Object.entries(q.query ?? {})) url.searchParams.set(key, value);
      const r = await fetch(url, { method: q.method, headers: { authorization: `Bearer ${bearer}` }, ...(q.body === undefined ? {} : { body: q.body }) });
      return { status: r.status, body: await r.text() };
    };
    const http: ServiceHost = { serviceRequest: (q) => httpReply(q) };
    let release!: () => void, reached!: () => void;
    const hold = new Promise<void>((r) => { release = r; });
    const atContinuation = new Promise<void>((r) => { reached = r; });
    const cursors: string[] = []; let settled = false;
    const pending = readDetail({ serviceRequest: async (q) => {
      cursors.push(q.query?.cursor ?? '0');
      if (q.query?.cursor === '1') { reached(); await hold; }
      return httpReply(q);
    } }, requestPlan).then((r) => { settled = true; return r; });
    await atContinuation; assert.equal(settled, false); release();
    const full = await pending; assert.ok(full.ok); assert.ok(full.snapshot);
    assert.deepEqual(cursors, ['0', '1', '2']);
    assert.deepEqual([full.detail.items.length, full.detail.contributions.length], [21, 41]);
    assert.deepEqual(full.snapshot.plan.counts, { done: 1, total: 21, remaining: 20, skipped: 0 });
    const text = formatHandoff(full)!;
    assert.match(text, /Recorded reports: 41 direct; 0 parent-relay/);
    assert.match(text, /Task 21 \(Done\)/);
    assert.match(text, /…showing 10 of 20/);
    for (const forbidden of [token, f.root, f.source.id, full.snapshot.identity.storeId, FORBIDDEN, 'task-0']) assert.ok(!text.includes(forbidden));
    cases.push({ case: 'full-pagination', passed: true, facts: ['21 tasks and 41 recorded reports', 'No complete result during held continuation', 'Server counts and later-page prerequisite preserved', 'Private metadata omitted'] });

    const assertFailure = (result: DetailResult, kind: string, hasSnapshot: boolean) => {
      assert.equal(result.ok, false); if (result.ok) throw new Error('expected failure');
      assert.equal(result.cause.kind, kind); assert.equal(Boolean(result.snapshot), hasSnapshot);
      assert.ok(!('detail' in result));
      if (result.snapshot) {
        assert.ok(!('items' in result.snapshot)); assert.ok(!('contributions' in result.snapshot)); assert.ok(!('links' in result.snapshot));
        const fallback = formatSummaryOnly(result.snapshot, result.cause);
        assert.match(fallback, /summary-only historical snapshot/);
        assert.doesNotMatch(fallback, /## Current work|Not started|Origin session:|Recorded reports:|Suggested next step|Remaining breakdown/);
        for (const forbidden of [token, f.root, FORBIDDEN, f.source.id, 'task-0']) assert.ok(!fallback.includes(forbidden));
      }
      return result;
    };
    assertFailure(await readDetail({ serviceRequest: (q) => httpReply(q, 'wrong-synthetic-token') }, requestPlan), 'unreachable-auth', false);
    assertFailure(await readDetail({ serviceRequest: (q) => httpReply(q, q.query?.cursor ? 'wrong-synthetic-token' : token) }, requestPlan), 'unreachable-auth', true);
    cases.push({ case: 'real-auth-refusal', passed: true, facts: ['Initial refusal has no snapshot', 'Continuation refusal retains only first-page summary'] });

    // Fault injection happens only after obtaining actual authenticated service replies.
    for (const fault of ['revision-restarts', 'page-cap', 'store-identity', 'binding-identity', 'plan-identity', 'contract', 'host-refusal', 'disconnected'] as const) {
      let attempt = 0;
      const result = await readDetail({ serviceRequest: async (q) => {
        if (!q.query?.cursor) attempt++;
        if (q.query?.cursor && (fault === 'host-refusal' || fault === 'disconnected')) throw Object.assign(new Error(FORBIDDEN), { code: fault === 'host-refusal' ? 'NOT_GRANTED' : 'DISCONNECTED' });
        const r = await httpReply(q); assert.equal(r.status, 200);
        const body = JSON.parse(r.body);
        if (fault === 'revision-restarts') body.plan.revision += attempt + (q.query?.cursor ? 1 : 0);
        if (fault === 'page-cap') { body.items.nextCursor = '1'; body.contributions.nextCursor = '1'; }
        if (q.query?.cursor) {
          if (fault === 'store-identity') body.storeId = FORBIDDEN;
          if (fault === 'binding-identity') body.sourceBinding = { sourceId: FORBIDDEN, verified: false };
          if (fault === 'plan-identity') body.plan.id = 'foreign-plan';
          if (fault === 'contract') body.items = {};
        }
        return { ...r, body: JSON.stringify(body) };
      } }, requestPlan);
      const expected = fault === 'revision-restarts' || fault === 'page-cap' ? fault : fault === 'host-refusal' || fault === 'disconnected' ? 'unreachable-auth' : 'identity-contract';
      assertFailure(result, expected, true);
      cases.push({ case: fault, passed: true, facts: ['Classified actual failure', 'Summary-only fallback contains no salvaged detail'] });
    }

    // Real service 503s, including the production unavailable-store code (storage).
    for (const code of ['storage', 'corrupt', 'schema', 'busy'] as const) {
      const unavailable = createProgressServer(undefined, token, code);
      unavailable.listen(0, '127.0.0.1'); await once(unavailable, 'listening');
      const url = `http://127.0.0.1:${(unavailable.address() as AddressInfo).port}/v1/plan?source=${f.source.id}&plan=${requestPlan.id}`;
      const unavailableReply = async (): Promise<GuestRequestResult> => {
        const r = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
        return { status: r.status, body: await r.text() };
      };
      try {
        assertFailure(await readDetail({ serviceRequest: unavailableReply }, requestPlan), 'store', false);
        const r = assertFailure(await readDetail({ serviceRequest: (q) => q.query?.cursor ? unavailableReply() : httpReply(q) }, requestPlan), 'store', true);
        assert.deepEqual(r.cause, { kind: 'store', code });
        assert.match(formatSummaryOnly(r.snapshot!, r.cause), new RegExp(`returned ${code} \\(HTTP 503\\)`));
        cases.push({ case: `real-503-${code}`, passed: true, facts: ['Fixed service code preserved', 'No initial fallback; historical summary after first page'] });
      } finally { await new Promise<void>((resolve) => unavailable.close(() => resolve())); }
    }

    f.store.apply({ op: 'start', plan: 'P-archive', title: 'Completed export example', rev: 0, oid: 'archive-start', items: items.map((i) => ({ ...i, status: 'done' })) }, actor);
    f.store.apply({ op: 'finish', plan: 'P-archive', rev: 1, oid: 'archive-finish', outcome: 'finished' }, actor);
    f.store.cleanup('archive', { storeId: full.snapshot.identity.storeId, source: f.source.id, plan: 'P-archive', rev: 2, cleanupRev: 0, oid: 'archive' });
    const archived = await readDetail(http, { sourceId: f.source.id, id: 'P-archive' });
    assert.ok(archived.ok); assert.match(formatHandoff(archived)!, /\(archived\)\nLifecycle: Finished/);
    assert.match(formatHandoff(archived)!, /No ready next step is recorded/);
    cases.push({ case: 'real-archive-readable', passed: true, facts: ['Archived Finished plan readable through ordinary detail endpoint'] });

    let deleted = false;
    const gone = await readDetail({ serviceRequest: async (q) => {
      if (q.query?.cursor && !deleted) {
        f.store.cleanup('delete', { storeId: full.snapshot!.identity.storeId, source: f.source.id, plan: 'P-archive', rev: 2, cleanupRev: 1, oid: 'delete', confirmed: true });
        deleted = true;
      }
      return httpReply(q);
    } }, { sourceId: f.source.id, id: 'P-archive' });
    assertFailure(gone, 'not-found', true);
    assertFailure(await readDetail(http, { sourceId: f.source.id, id: 'P-archive' }), 'not-found', false);
    cases.push({ case: 'real-delete-not-found', passed: true, facts: ['Actual deletion during continuation classified as not-found, not revision churn', 'Later initial read has no fallback'] });
    completed = true;
  } finally {
    if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
    f.cleanup();
    if (process.env.EVIDENCE) {
      mkdirSync(process.env.EVIDENCE, { recursive: true });
      writeFileSync(`${process.env.EVIDENCE}/service.json`, JSON.stringify({ suite: 'preview-summaries-service', completed, casesCompleted: cases.length, cases }, null, 2) + '\n');
    }
  }
});
