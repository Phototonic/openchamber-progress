/** Real production activation + direct synthetic Store writes; observer never injects recovery. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Store } from '../../shared/store.ts';
import { parseRequest, ProgressError } from '../../shared/progress.ts';

export async function runResumeRegression({ client, root, location, report, records, waitFor, labels }: any) {
  const binding = JSON.parse(fs.readFileSync(`${root}/binding.json`, 'utf8'));
  const store = new Store(binding.database);
  store.bindReads(binding.source.id, true);
  let oid = 0;
  const scenarios: Record<string, any> = report.scenarios = {};
  const makeSession = async (label: string, parentID?: string, agent = 'build') => {
    const session = await client.session.create({ location, ...(parentID ? { parentID } : {}), agent, title: `Synthetic ${label}`, model: { providerID: 'resume-fixture', id: 'script' } }, { signal: AbortSignal.timeout(30000) });
    labels.set(session.id, label);
    return session;
  };
  const actor = (s: any) => ({ sourceId: binding.source.id, sessionId: s.id, agent: s.agent, directory: location.directory, projectId: s.projectID,
    parentId: s.parentID ?? null, ancestry: s.parentID ? [s.parentID] : [], verifiedSource: true });
  const apply = (s: any, value: object, child?: any) => store.apply(parseRequest({ ...value, oid: `fixture-${++oid}` }), actor(s), undefined, child ? actor(child) : undefined);
  const seed = (s: any, plan: string, title = 'Synthetic alpha') => apply(s, { op: 'start', plan, title, rev: 0,
    items: [{ id: 'I-assigned', title: 'SYNTHETIC_ASSIGNED_TASK_PROSE', kind: 'task' }, { id: 'I-sibling', title: 'SYNTHETIC_SIBLING_TASK_PROSE', kind: 'task' }] });
  const revision = (plan: string) => store.get(binding.source.id, plan)!.revision;
  const writeCounts = () => ['plans', 'revisions', 'receipts'].map(table => store.db.prepare(`SELECT count(*) AS n FROM ${table}`).get()!.n);
  const primary = async (s: any, label: string, expected: 'none' | 'pointer' | 'candidates', generic = true, reportTool = true) => {
    const before = records().length;
    const counts = writeCounts();
    await client.session.prompt({ sessionID: s.id, text: 'Continue the synthetic transport probe.' }, { signal: AbortSignal.timeout(30000) });
    await client.session.wait({ sessionID: s.id }, { signal: AbortSignal.timeout(30000) });
    const outgoing = records().slice(before).filter((e: any) => e.type === 'dispatch' && e.kind === 'primary' && e.sessionID === s.id);
    assert.equal(outgoing.length, 1, `${label}: one real outgoing request`);
    const e = outgoing[0];
    scenarios[label] = { pass: false, recovery: e.recovery, generic: e.generic, reportTool: e.tools.includes('agent_progress_report'), sentinelCount: e.sentinelCount, ownedSections: e.ownedSections };
    assert.equal(e.sentinelCount, 0, 'test-only sentinel absent in regression');
    assert.equal(e.generic, generic, `${label}: existing generic guard`);
    assert.equal(e.ownedSections, generic ? 1 : 0, `${label}: one owned section`);
    assert.equal(e.tools.includes('agent_progress_report'), reportTool);
    assert.equal(e.recovery.length, expected === 'none' ? 0 : 1, `${label}: recovery count`);
    if (expected !== 'none') {
      assert.ok(e.recovery[0].startsWith(`## Progress resume — ${expected === 'pointer' ? 'recorded pointer' : 'unconfirmed candidates'}`));
      assert.ok(e.recovery[0].includes('Read current state before any mutation, including after a conflict.'));
      assert.ok(Buffer.byteLength(e.recovery[0], 'utf8') <= 4096);
      assert.equal(/SYNTHETIC_(ASSIGNED|SIBLING)_TASK_PROSE/.test(e.recovery[0]), false);
    }
    assert.deepEqual(writeCounts(), counts, 'outgoing hook/provider performs no report mutation');
    scenarios[label].pass = true;
    return e.recovery[0] ?? '';
  };
  const compact = async (s: any, terminal = 'ended') => {
    const type = `session.compaction.${terminal}`;
    const before = records().filter((e: any) => e.type === type && e.sessionID === s.id).length;
    await client.session.compact({ sessionID: s.id }, { signal: AbortSignal.timeout(30000) });
    await client.session.wait({ sessionID: s.id }, { signal: AbortSignal.timeout(30000) });
    await waitFor(() => records().filter((e: any) => e.type === type && e.sessionID === s.id).length > before);
  };
  const close = (s: any, plan: string, finished = false) => {
    if (finished) apply(s, { op: 'change', plan, rev: revision(plan), changes: [{ id: 'I-assigned', status: 'done' }, { id: 'I-sibling', status: 'done' }] });
    apply(s, { op: 'finish', plan, rev: revision(plan), outcome: finished ? 'finished' : 'cancelled' });
  };
  try {
    const s = await makeSession('root');
    await primary(s, 'initial', 'none');
    seed(s, 'P-alpha');
    await primary(s, 'uncompacted-resume', 'none');
    await compact(s);
    apply(s, { op: 'change', plan: 'P-alpha', rev: 1, changes: [{ id: 'I-assigned', status: 'working' }] });
    const pointer = await primary(s, 'unique-current-r2', 'pointer');
    assert.ok(pointer.includes('source source-resume-fixture; plan P-alpha; title "Synthetic alpha"; last-known revision 2.'));
    assert.ok(pointer.includes('agent_progress_report {"op":"read","plan":"P-alpha"}'));
    assert.equal(store.detail(binding.source.id, 'P-alpha').plan.revision, 2);
    assert.throws(() => apply(s, { op: 'change', plan: 'P-alpha', rev: 1, changes: [{ id: 'I-assigned', status: 'done' }] }), (e: unknown) => e instanceof ProgressError && e.code === 'conflict');
    assert.equal(revision('P-alpha'), 2);
    scenarios['unique-current-r2'].explicitReadRevision = 2;
    scenarios['unique-current-r2'].staleWriteRefused = true;
    await primary(s, 'unique-consumed', 'none');
    seed(s, 'P-beta', 'Synthetic "beta"');
    await compact(s);
    const candidates = await primary(s, 'two-candidates', 'candidates');
    assert.ok(candidates.includes('plan P-alpha;') && candidates.includes('plan P-beta;'));
    assert.ok(candidates.includes('Read and confirm a target before reporting.'));
    const linked = await makeSession('linked-child', s.id);
    apply(s, { op: 'link', plan: 'P-alpha', rev: revision('P-alpha'), child: linked.id, assign: ['I-assigned'] }, linked);
    await primary(linked, 'linked-before-compaction', 'none');
    await compact(linked);
    const childText = await primary(linked, 'linked-assigned-only', 'pointer');
    assert.ok(childText.includes('Assigned-only scope: ["I-assigned"]'));
    assert.equal(childText.includes('I-sibling'), false);
    assert.equal(childText.includes('P-beta'), false);
    const unlinked = await makeSession('unlinked-child', s.id);
    seed(unlinked, 'P-independent', 'Synthetic independent child work');
    await primary(unlinked, 'unlinked-before-compaction', 'none');
    await compact(unlinked);
    await primary(unlinked, 'unlinked-child', 'none');
    const restricted = await makeSession('restricted-child', s.id, 'explore');
    apply(s, { op: 'link', plan: 'P-beta', rev: revision('P-beta'), child: restricted.id, assign: ['I-assigned'] }, restricted);
    await primary(restricted, 'restricted-before-compaction', 'none', false, false);
    await compact(restricted);
    await primary(restricted, 'restricted-child', 'none', false, false);
    // A failed summary and an empty immediate re-compaction must both retire pending recovery.
    fs.writeFileSync(`${root}/fail`, 'synthetic');
    await compact(s, 'failed');
    fs.unlinkSync(`${root}/fail`);
    await primary(s, 'failed-compaction', 'none');
    await compact(s);
    await compact(s, 'failed');
    await primary(s, 'empty-compaction', 'none');
    await compact(s);
    store.setEnabled(false);
    await primary(s, 'disabled-before-delivery', 'none', false);
    store.setEnabled(true);
    await primary(s, 'reenabled-no-backfill', 'none');
    // Real host location reload disposes plugins and opens fresh native event subscriptions.
    // It cannot manufacture replay: the pinned stream explicitly has a volatile, live-only contract.
    await compact(s);
    const registrations = records().filter((e: any) => e.type === 'registered').length;
    const disposals = records().filter((e: any) => e.type === 'disposed').length;
    await client.location.reload({ signal: AbortSignal.timeout(30000) });
    await waitFor(() => records().filter((e: any) => e.type === 'registered').length > registrations);
    assert.ok(records().filter((e: any) => e.type === 'disposed').length > disposals);
    await primary(s, 'native-reload-old-ended-not-rearmed', 'none');
    await compact(s);
    await primary(s, 'native-reload-new-compaction', 'candidates');
    report.replay = { nativePluginReload: 'pass: public location.reload disposed/reloaded the observer and production plugin; old completed compaction did not re-arm; a fresh real compaction still delivered',
      replay: 'not exercised: pinned event.subscribe is volatile/live-only; no cursor/replay input; events during disconnection are missed',
      transportReconnect: 'not applicable to production native subscription: installed adapter uses an in-process host stream, not HTTP SSE',
      knownLimitation: true };
    close(s, 'P-alpha', true); close(s, 'P-beta', true);
    await primary(s, 'finished-control-history', 'none');
    await compact(s);
    await primary(s, 'finished-only', 'none');
    seed(s, 'P-delete', 'Synthetic delete');
    await compact(s);
    close(s, 'P-delete', true);
    store.cleanup('delete', { storeId: binding.storeId, source: binding.source.id, plan: 'P-delete', rev: revision('P-delete'), cleanupRev: 0, oid: `cleanup-${++oid}`, confirmed: true });
    await primary(s, 'deleted-before-delivery', 'none');
    seed(s, 'P-archive', 'Synthetic archive');
    await compact(s);
    close(s, 'P-archive', true);
    store.cleanup('archive', { storeId: binding.storeId, source: binding.source.id, plan: 'P-archive', rev: revision('P-archive'), cleanupRev: 0, oid: `cleanup-${++oid}` });
    await primary(s, 'archived-before-delivery', 'none');
    const all = records();
    const summaries = all.filter((e: any) => e.type === 'dispatch' && e.kind === 'compaction');
    assert.ok(summaries.length > 0 && summaries.every((e: any) => e.recovery.length === 0 && e.sentinelCount === 0));
    assert.equal(all.some((e: any) => ['unexpected-http', 'subscription-failed'].includes(e.type)), false);
    assert.ok(all.filter((e: any) => e.type.startsWith('session.compaction.')).every((e: any) => e.sourceMatches && e.aggregateMatches));
    report.actualReasons = ['manual'];
    report.summarizationRecoveryFree = true;
    report.noReportWritesFromContexts = true;
    report.observerManufacturesRecovery = false;
  } finally { store.close(); }
}
