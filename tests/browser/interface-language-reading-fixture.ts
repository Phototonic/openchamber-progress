// Disposable built service and synthetic reports only; no live installation or model.
import { launchCleanupService } from '../fixtures/cleanup-service.ts';
import { digest } from '../../shared/store.ts';
import { S } from './fixtures.ts';
import { startLanguageFixture } from './interface-language-fixture.ts';
import { readDetail } from '../../ui/shared/source.ts';
import { formatSummaryOnly } from '../../ui/shared/summary.ts';

export async function startReadingFixture() {
  const backend = await launchCleanupService(true, false);
  try {
    const actor = { ...backend.actor, sessionId: S.M, directory: '/fixture/Alpha' };
    const source = backend.source.id;
    let oid = 0;
    const apply = (plan: string, request: Record<string, unknown>, text?: string) => backend.store.apply({ plan, rev: backend.store.get(source, plan)?.revision ?? 0, oid: `reading-${++oid}`, ...request }, actor, text === undefined ? undefined : { state: 'captured', path: '/fixture/plan.md', canonicalPath: '/fixture/plan.md', text, hash: digest(text), checkedAt: new Date().toISOString() });
    apply('P-reading', { op: 'start', title: 'Reading example', source: '/fixture/plan.md', items: [
      { id: 'G', title: 'Reading group', kind: 'group', dependencies: ['A'] },
      { id: 'A', title: 'Export example', kind: 'task', status: 'done', parentId: 'G' },
      { id: 'B', title: 'Review example', kind: 'task', status: 'working', dependencies: ['A'] },
    ] }, '# Reading example\nOld line\n');
    apply('P-reading', { op: 'bind', source: '/fixture/plan.md', confirm: false }, '# Reading example\nNew line\n');
    apply('P-reading', { op: 'change', changes: [{ id: 'B', status: 'blocked' }] }, '# Reading example\nNew line\n');
    apply('P-history', { op: 'start', title: 'Historical example', items: Array.from({ length: 21 }, (_, i) => ({ id: `H${i}`, title: `Historical task ${i}`, kind: 'task', status: 'pending' })) });
    const service: NonNullable<Parameters<typeof startLanguageFixture>[0]>['service'] = async (q) => {
      if (q.path === '/v1/extension-update' || q.path === '/v1/setup') return { status: 404, body: '{"error":"not-found"}' };
      // A valid first page retains its authoritative summary; the continuation really fails.
      if (q.path === '/v1/plan' && q.query?.plan === 'P-history' && q.query.cursor) return { status: 503, body: '{"error":"busy"}' };
      const query = new URLSearchParams(q.query ?? {}).toString();
      const reply = await backend.request(q.path + (query ? '?' + query : ''), q.body ? JSON.parse(q.body) : undefined);
      return { status: reply.status, body: await reply.text() };
    };
    const historical = await readDetail({ serviceRequest: service }, { sourceId: source, id: 'P-history' });
    if (historical.ok || !historical.snapshot) throw Error('Historical fixture must retain a valid summary after its continuation fails.');
    const historicalExpected = { en: formatSummaryOnly(historical.snapshot, historical.cause, 'en'), ru: formatSummaryOnly(historical.snapshot, historical.cause, 'ru') };
    const host = await startLanguageFixture({ service });
    return { ...host, source, historicalExpected, async stop() { await host.stop(); await backend.stop(); } };
  } catch (error) { await backend.stop(); throw error; }
}
