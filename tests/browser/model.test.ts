import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { GuestRequest } from '@openchamber/sdk';
import { countItems } from '../../shared/progress.ts';
import { parseExtensionUpdate, parseHealth, parsePlanPage, parsePlansPage, parseSetup, parseTiming, setupBody } from '../../ui/shared/adapter.ts';
import { elapsedText, relativeAge } from '../../ui/shared/format.ts';
import { canOpen, coverageFor, EMPTY_LIVE, liveLabel, LiveWorkspace, type LiveSession, type LiveSnapshot } from '../../ui/shared/live.ts';
import { currentWork, elapsedAt, itemTree, participants, showsLiveness, summarize, summaryText, type PlanDetail } from '../../ui/shared/model.ts';
import { RecentMemory, RefreshGate } from '../../ui/shared/refresh.ts';
import { ALL, applyFilters, contextListScope, contextScope, coverageGap, filterOptions, NO_FILTERS, normalizeFilters, pageListScope, pickPlan, placeOf } from '../../ui/shared/scope.ts';
import { CSS } from '../../ui/shared/style.ts';
import { classify, readDetail, readDocument, readExtensionUpdate, readHistory, readList, setupCall, type ServiceHost } from '../../ui/shared/source.ts';
import { OFFICIAL_MAIN_HOWTO, OfficialMainState, officialMainLine, officialMainNotice, officialMainText } from '../../ui/shared/official.ts';
import { OFFICIAL_MAIN_URL } from '../../ui/shared/config.ts';
import { absoluteSetupPath, applySuggestions, bundledComparison, captureOffNote, deriveStore, fieldHint, initialSetupUi, reviewVersions, setupErrorText, setupPhase, updateNotice } from '../../ui/shared/setup.ts';
import {
  DOCUMENT_TEXT, envelope, HEALTH, HEALTH_UNCONFIGURED, NOW, OTHER_SRC, P1, P1_ITEMS, P2, P3, planPage, plansPage, RELAY, S, setupRead, SRC, summary, X1,
} from './fixtures.ts';

const list = (data = [P1, P2, P3, X1]) => parsePlansPage(JSON.stringify(plansPage(data)));
const plan = (id: string) => list().data.find((p) => p.id === id)!;
const detailOf = (): PlanDetail => {
  const d = parsePlanPage(JSON.stringify(planPage(P1, P1_ITEMS, [RELAY])));
  return { key: d.plan.key, revision: d.plan.revision, items: d.items.data, contributions: d.contributions.data, links: d.links };
};

function liveWith(sessions: Partial<LiveSession>[], projects = [{ id: 'pa', name: 'Alpha', directory: '/fixture/Alpha' }, { id: 'pb', name: 'Beta', directory: '/fixture/Beta' }]): LiveSnapshot {
  const records = sessions.map((s) => ({ id: '', title: '', projectId: 'pa', directory: '/fixture/Alpha', parentId: null, archivedAt: null, worktree: null, activity: 'idle' as const, outcome: null, ...s }));
  return { projectsState: 'ready', projects, worktrees: new Map(), sessions: new Map(projects.map((p) => [p.id, { state: 'ready' as const, records: records.filter((r) => r.projectId === p.id) }])), capped: [] };
}

function fakeHost(route: (r: GuestRequest) => { status: number; body: unknown }): ServiceHost & { calls: GuestRequest[] } {
  const calls: GuestRequest[] = [];
  return { calls, serviceRequest: async (r) => { calls.push(r); const a = route(r); return { status: a.status, body: typeof a.body === 'string' ? a.body : JSON.stringify(a.body) }; } };
}

test('v2 list maps PlanSummary: owner=sessionId, data[] list, finished→completed, server counts, keyed by source', () => {
  const r = list();
  assert.equal(r.envelope.storeId, 'store-1');
  assert.deepEqual(r.envelope.binding, { sourceId: SRC, verified: true });
  const p1 = plan('P1');
  assert.deepEqual([p1.key, p1.ownerSessionId, p1.counts], [`${SRC}/P1`, S.M, { done: 2, total: 4, remaining: 2, skipped: 1 }]);
  assert.equal(plan('P3').lifecycle, 'completed');
  assert.equal(plan('X1').key, `${OTHER_SRC}/X1`);
  assert.equal(summaryText(summarize(p1)), '2 of 4 done · 2 remaining · 1 skipped');
  assert.deepEqual(p1.working, ['I3']);
  assert.throws(() => parsePlansPage(JSON.stringify({ ...plansPage([]), protocolVersion: 1 })), (e: Error & { incompatible?: boolean }) => e.incompatible === true);
  assert.throws(() => parsePlansPage(JSON.stringify({ ...envelope(), plans: [], nextCursor: null })), /data page/);
  assert.throws(() => parsePlansPage(JSON.stringify(plansPage([{ ...P1, lifecycle: 'done' as never }]))), /lifecycle/);
});

test('counts: groups and skipped excluded, relay contributions never inflate; detail uses the same rule', () => {
  const d = detailOf();
  assert.deepEqual(countItems(d.items), { done: 2, total: 4, remaining: 2, skipped: 1 });
  const s = summarize(plan('P1'), d);
  assert.deepEqual([s.done, s.total, s.remaining, s.skipped, s.working], [2, 4, 2, 1, 1]);
  assert.equal(summarize(plan('P2'), null).total, 1);
  assert.deepEqual([summaryText(summarize({ counts: { done: 0, total: 0, remaining: 0, skipped: 0 }, working: [] })), summarize({ counts: { done: 0, total: 0, remaining: 0, skipped: 0 }, working: [] }).percent], ['No tasks reported', null]);
  assert.deepEqual(itemTree(d.items).map((n) => [n.item.id, n.children.map((c) => c.item.id)]), [['G', ['I1', 'I2']], ['I3', []], ['I4', []], ['I5', []]]);
  assert.deepEqual(currentWork(d).map((i) => i.id), ['I3']);
});

test('participants: links + assignees + relays; relay keeps reporter agent; nothing added to counts', () => {
  const p = participants(plan('P1'), detailOf());
  assert.deepEqual(p.map((x) => [x.sessionId, x.role, x.assigned, x.relayed]), [[S.M, 'main', 0, false], [S.C1, 'child', 1, false], [S.C2, 'child', 0, true]]);
  assert.deepEqual(p[2].reporterAgents, ['build']);
  assert.deepEqual(participants(plan('P1'), null).map((x) => x.sessionId), [S.M]);
});

test('scope: server does session/directory filtering; UI orders owned first and never guesses', () => {
  assert.deepEqual(contextListScope('s1', '/d'), { session: 's1' });
  assert.equal(contextListScope(null, '/d'), null);
  assert.equal(contextListScope(null, null), null);
  const r = list([P1, P2, summary('H', [], { sessionId: 'someone-else', reportedAt: new Date(NOW).toISOString() })]).data;
  const s = contextScope(r, S.M, null);
  assert.deepEqual(s.kind === 'session' && [s.plans.map((p) => p.id), s.owned], [['P2', 'P1', 'H'], 2]);
  assert.equal(pickPlan(r, `${SRC}/P1`)?.id, 'P1');
  assert.equal(pickPlan(r, 'gone')?.id, r[0].id);
  assert.deepEqual(pageListScope({ ...NO_FILTERS, session: S.C1 }), { session: S.C1 });
  assert.deepEqual(pageListScope(NO_FILTERS), {});
});

test('navigation requires the verified bound source AND current SDK coverage', () => {
  const live = liveWith([{ id: S.M, title: 'Main work' }]);
  const cov = coverageFor(S.M, '/fixture/Alpha', live);
  assert.equal(canOpen(SRC, SRC, cov), true);
  assert.equal(canOpen(OTHER_SRC, SRC, cov), false, 'other-source plan stays readable without a target');
  assert.equal(canOpen(SRC, null, cov), false, 'unverified binding gives no target');
  assert.equal(canOpen(SRC, SRC, coverageFor(S.C2, '/fixture/Alpha', live)), false, 'not listed by this host');
  assert.equal(canOpen(SRC, SRC, coverageFor(S.M, '/fixture/Alpha', EMPTY_LIVE)), false);
  assert.deepEqual(coverageGap(list().data, live, SRC), { missing: 1, pending: 0, otherSource: 1, capped: 0 });
});

test('live state labels stay separate from task progress', () => {
  for (const [activity, label] of [['running', 'Running'], ['waiting-permission', 'Waiting for permission'], ['waiting-question', 'Waiting for an answer'], ['retrying', 'Retrying'], ['idle', 'Idle'], ['unknown', 'State unknown']] as const) {
    assert.equal(liveLabel(coverageFor(S.M, '/fixture/Alpha', liveWith([{ id: S.M, activity }]))).label, label);
  }
  assert.equal(liveLabel(coverageFor('x', '/fixture/Alpha', { ...EMPTY_LIVE, projectsState: 'loading' })).label, 'Checking…');
});

test('page filters: recorded directory decides worktree; session options include live children', () => {
  const r = list().data;
  const live = liveWith([{ id: S.M, title: 'Main' }, { id: S.C1, title: 'Child one', parentId: S.M }, { id: 'w', worktree: { directory: '/fixture/Alpha-worktree', name: 'feature', branch: 'feature' } }]);
  const opts = filterOptions(r, live, NO_FILTERS);
  assert.ok(opts.projects.some((o) => o.label === 'Alpha') && opts.projects.some((o) => o.label === 'Beta'));
  assert.equal(placeOf(plan('P2'), live).worktreeLabel, 'feature');
  assert.equal(placeOf(plan('P1'), live).worktreeLabel, 'Main checkout');
  const alpha = opts.projects.find((o) => o.label === 'Alpha')!.id;
  assert.deepEqual(applyFilters(r, live, { ...NO_FILTERS, project: alpha }).map((p) => p.id).sort(), ['P1', 'P2', 'X1']);
  assert.ok(opts.sessions.some((o) => o.id === S.C1 && o.hint === 'child'));
  assert.deepEqual(normalizeFilters(r, live, { project: 'p:gone', worktree: 'w:gone', session: S.C1 }), { ...NO_FILTERS, session: S.C1 });
  assert.equal(ALL, 'all');
});

test('age is relative text only, locale-aware, no staleness judgement', () => {
  assert.equal(relativeAge(new Date(NOW - 7 * 60_000).toISOString(), NOW, 'en'), '7 minutes ago');
  assert.equal(relativeAge(new Date(NOW - 26 * 3_600_000).toISOString(), NOW, 'en'), 'yesterday');
  assert.equal(relativeAge('nope', NOW, 'en'), 'at an unknown time');
});

test('list read: unconfigured health is a setup state, not empty; cursor passed back verbatim; scoped query', async () => {
  const unconfigured = await readList(fakeHost(() => ({ status: 200, body: HEALTH_UNCONFIGURED })), {});
  assert.deepEqual(unconfigured.ok && [unconfigured.health.ready, unconfigured.read], [false, null]);
  const many = Array.from({ length: 60 }, (_, i) => summary(`B${i}`, []));
  const host = fakeHost((r) => {
    if (r.path === '/health') return { status: 200, body: HEALTH };
    const c = Number(r.query?.cursor ?? 0);
    return { status: 200, body: plansPage(many.slice(c, c + 50), c + 50 < many.length ? String(c + 50) : null) };
  });
  const res = await readList(host, { session: S.C1, directory: '/ignored' });
  assert.deepEqual(res.ok && res.read && [res.read.plans.length, res.read.truncated], [60, false]);
  assert.deepEqual(host.calls.filter((c) => c.path === '/v1/plans').map((c) => c.query), [{ limit: '50', session: S.C1 }, { limit: '50', session: S.C1, cursor: '50' }]);
  const capped = await readList(host, {}, 1);
  assert.deepEqual(capped.ok && capped.read && [capped.read.plans.length, capped.read.truncated], [50, true]);
});

test('detail read restarts when the plan revision changes across pages, and stops when both cursors are null', async () => {
  let rev = 4;
  let firstCalls = 0;
  const items2 = Array.from({ length: 25 }, (_, i) => ({ id: `T${i}`, title: `Task ${i}`, kind: 'task' as const, status: 'pending' as const }));
  const host = fakeHost((r) => {
    const cursor = r.query?.cursor;
    if (!cursor) {
      firstCalls++;
      return { status: 200, body: planPage({ ...P1, revision: rev }, items2.slice(0, 20), [RELAY], { items: '1', contributions: null }) };
    }
    const body = planPage({ ...P1, revision: firstCalls === 1 ? 5 : rev }, items2.slice(20), [], { items: null, contributions: null });
    if (firstCalls === 1) rev = 5; // the plan moved on between page 0 and page 1
    return { status: 200, body };
  });
  const res = await readDetail(host, plan('P1'));
  assert.ok(res.ok);
  assert.equal(res.ok && res.restarts, 1);
  assert.deepEqual(res.ok && [res.detail.revision, res.detail.items.length, res.detail.contributions.length], [5, 25, 1]);
  assert.deepEqual(host.calls.map((c) => c.query?.cursor ?? '-'), ['-', '1', '-', '1']);
  // Contributions may continue after items end: one cursor, only the open list is appended.
  const host2 = fakeHost((r) => ({ status: 200, body: r.query?.cursor ? planPage(P1, [], [{ ...RELAY, revision: 4 }], { items: null, contributions: null }) : planPage(P1, P1_ITEMS, [RELAY], { items: null, contributions: '1' }) }));
  const res2 = await readDetail(host2, plan('P1'));
  assert.deepEqual(res2.ok && [res2.detail.items.length, res2.detail.contributions.length], [6, 2]);
});

test('document read pins the first capture ID on continuation pages; retained capture survives a failed refresh', async () => {
  const text = 'x'.repeat(16_384) + DOCUMENT_TEXT;
  const host = fakeHost((r) => {
    const cursor = Number(r.query?.cursor ?? 0);
    const ref = { state: 'missing', path: '/fixture/Alpha/docs/plan.md', captureId: 7, capturedAt: P1.document.capturedAt, checklistSynchronized: false, currentFile: 'not-rechecked' };
    return { status: 200, body: { ...envelope(), document: ref, text: text.slice(cursor, cursor + 16_384), nextCursor: cursor === 0 ? '16384' : null } };
  });
  const res = await readDocument(host, plan('P1'));
  assert.ok(res.ok);
  assert.equal(res.ok && res.body.text, text);
  assert.equal(res.ok && res.body.ref.state, 'missing', 'failure state with the last good capture text');
  assert.deepEqual(host.calls.map((c) => c.query), [{ source: SRC, plan: 'P1' }, { source: SRC, plan: 'P1', cursor: '16384', capture: '7' }]);
  const historical = await readDocument(fakeHost(() => ({ status: 200, body: { ...envelope({ diagnostics: ['historical-capture'] }), document: P1.document, text: 'old', nextCursor: null } })), plan('P1'));
  assert.equal(historical.ok && historical.body.historical, true);
  // T6 live case: re-captured between pages. Page 1 was current; the pinned continuation is now historical.
  const raced = await readDocument(fakeHost((r) => {
    const cursor = Number(r.query?.cursor ?? 0);
    return { status: 200, body: { ...envelope(cursor ? { diagnostics: ['historical-capture'] } : {}), document: { ...P1.document, captureId: 7 }, text: text.slice(cursor, cursor + 16_384), nextCursor: cursor === 0 ? '16384' : null } };
  }), plan('P1'));
  assert.deepEqual(raced.ok && [raced.body.historical, raced.body.text === text, raced.body.captureId], [true, true, 7]);
});

test('history read pages oldest-first', async () => {
  const host = fakeHost((r) => ({ status: 200, body: { ...envelope(), data: r.query?.cursor ? [{ revision: 3, structuralRevision: 2, lifecycle: 'finished', reportedAt: P1.reportedAt }] : [{ revision: 1, structuralRevision: 1, lifecycle: 'active', reportedAt: P1.reportedAt }, { revision: 2, structuralRevision: 2, lifecycle: 'active', reportedAt: P1.reportedAt }], nextCursor: r.query?.cursor ? null : '2' } }));
  const res = await readHistory(host, plan('P1'));
  assert.deepEqual(res.ok && res.entries.map((e) => [e.revision, e.lifecycle]), [[1, 'active'], [2, 'active'], [3, 'completed']]);
});

test('fixed error codes classify into plain user states', async () => {
  const err = (code: string) => Object.assign(new Error(code), { code });
  assert.equal(classify(err('NO_SERVICE')).kind, 'not-approved');
  assert.equal(classify(err('HOST_TIMEOUT')).kind, 'disconnected');
  const http = (status: number, error: string) => readList(fakeHost((r) => (r.path === '/health' ? { status: 200, body: HEALTH } : { status, body: { error } })), {});
  for (const [status, code, kind] of [[503, 'corrupt', 'damaged'], [503, 'schema', 'incompatible'], [503, 'busy', 'busy'], [503, 'storage', 'unavailable'], [400, 'invalid', 'invalid']] as const) {
    const r = await http(status, code);
    assert.deepEqual(!r.ok && [r.failure.kind, r.failure.code], [kind, code]);
  }
  const healthDown = await readList(fakeHost(() => ({ status: 503, body: { error: 'corrupt' } })), {});
  assert.equal(!healthDown.ok && healthDown.failure.kind, 'damaged');
  assert.equal(parseHealth(JSON.stringify(HEALTH)).ready, true);
});

test('setup: body carries only roots/confirmed; phases; plain-language SetupError codes', async () => {
  assert.equal(setupBody(null, true), '{"confirmed":true}');
  assert.equal(setupBody({ configRoot: '/a', dataRoot: '/b', storeRoot: '/c' }, false), '{"configRoot":"/a","dataRoot":"/b","storeRoot":"/c"}');
  const phase = (x: Record<string, unknown>) => setupPhase(parseSetup(JSON.stringify(setupRead(x))));
  assert.equal(phase({ configured: false, installed: false, targets: null, captureEnabled: null }), 'unconfigured');
  assert.equal(phase({}), 'installed');
  assert.equal(phase({ captureEnabled: false }), 'disabled');
  assert.equal(phase({ activation: 'reload-required' }), 'reload-required');
  assert.equal(phase({ installed: false }), 'removed');
  assert.equal(phase({ recovery: { stagedPackages: 1, stagedActivations: 0, stagedReleases: 0 } }), 'recovery');
  const host = fakeHost((r) => (r.path === '/v1/setup/install' && !String(r.body).includes('"confirmed":true') ? { status: 400, body: { error: 'confirmation-required' } } : { status: 200, body: setupRead({ action: 'install', activation: 'reload-required' }) }));
  const refused = await setupCall(host, 'install', { configRoot: '/a', dataRoot: '/b', storeRoot: '/c' }, false);
  assert.deepEqual(!refused.ok && refused.code, 'confirmation-required');
  const ok = await setupCall(host, 'install', { configRoot: '/a', dataRoot: '/b', storeRoot: '/c' }, true);
  assert.equal(ok.ok && ok.setup.activation, 'reload-required');
  assert.deepEqual(host.calls.map((c) => [c.method, c.path]), [['POST', '/v1/setup/install'], ['POST', '/v1/setup/install']]);
  for (const code of ['confirmation-required', 'targets-unverified', 'ownership-invalid', 'service-binding-modified', 'symlink-escape', 'collision']) assert.doesNotMatch(setupErrorText(code), /\(|-/, code);
  assert.match(setupErrorText('brand-new-code'), /brand-new-code/);
});

test('setup suggestions: parsed per field, malformed reads as unknown, configured replies ignore hints', () => {
  const base = { configured: false, verified: false, installed: false, captureEnabled: null, targets: null, version: null, activation: 'unknown', separateLifecycle: true, historyRetained: true, diagnostics: ['targets-unverified'] };
  const hinted = parseSetup(JSON.stringify({ ...base, suggestions: { configRoot: { value: '/h/.config/opencode', state: 'resolved' }, dataRoot: { value: '/h/.local/share/opencode', state: 'candidate' }, storeRoot: null } }));
  assert.deepEqual(hinted.suggestions, { configRoot: { value: '/h/.config/opencode', state: 'resolved' }, dataRoot: { value: '/h/.local/share/opencode', state: 'candidate' }, storeRoot: null });
  const odd = parseSetup(JSON.stringify({ ...base, suggestions: { configRoot: { value: '', state: 'resolved' }, dataRoot: { value: '/x', state: 'verified' }, storeRoot: 'nope' } }));
  assert.deepEqual(odd.suggestions, { configRoot: null, dataRoot: null, storeRoot: null }, 'malformed hints are unknown, the reply still parses');
  assert.equal(parseSetup(JSON.stringify(base)).suggestions, undefined, 'older/unsupported service: no hints at all');
  const configured = parseSetup(JSON.stringify({ ...base, configured: true, targets: { configRoot: '/c', dataRoot: '/d', storeRoot: '/s' }, suggestions: hinted.suggestions }));
  assert.equal(configured.suggestions, undefined, 'configured targets take precedence over hints');
});

test('setup paths: POSIX and drive-qualified Windows folders reach service inspection unchanged', () => {
  for (const value of ['/config/opencode', '/', 'C:\\config\\opencode', 'C:/config/opencode', 'd:\\', 'D:/']) {
    assert.equal(absoluteSetupPath(value), true, value);
  }
  for (const value of ['', 'config/opencode', 'C:opencode', '\\config\\opencode', '\\\\server\\share', '1:/opencode']) {
    assert.equal(absoluteSetupPath(value), false, value);
  }
  assert.equal(deriveStore(' C:\\data\\opencode\\ '), 'C:\\data\\opencode\\openchamber-progress');
  assert.equal(deriveStore('C:/data/opencode///'), 'C:/data/opencode/openchamber-progress');
  assert.equal(deriveStore('C:\\'), 'C:\\openchamber-progress');
  assert.equal(deriveStore('D:/'), 'D:/openchamber-progress');
  assert.equal(deriveStore('/'), '/openchamber-progress');
  assert.equal(deriveStore('/data/opencode\\'), '/data/opencode\\/openchamber-progress', 'a backslash stays part of a POSIX folder name');
  const targets = { configRoot: 'C:\\config\\opencode', dataRoot: 'C:/data/opencode', storeRoot: 'C:\\private\\progress' };
  assert.deepEqual(JSON.parse(setupBody(targets, false)), targets, 'inspection receives the typed roots without client-side resolution');
  const state = initialSetupUi();
  state.form.configRoot = targets.configRoot; state.edited.configRoot = true;
  state.form.dataRoot = ''; state.edited.dataRoot = true;
  state.form.storeRoot = targets.storeRoot; state.edited.storeRoot = true;
  applySuggestions(state, {
    configRoot: { value: 'C:\\usual\\config\\opencode', state: 'candidate' },
    dataRoot: { value: 'C:\\usual\\data\\opencode', state: 'candidate' },
    storeRoot: { value: 'C:\\usual\\data\\opencode\\openchamber-progress', state: 'candidate' },
  });
  assert.deepEqual(state.form, { ...targets, dataRoot: '' }, 'late Windows hints preserve custom folders and a deliberate clear');
  assert.doesNotMatch(setupErrorText('store-permissions'), /700/);
  assert.match(setupErrorText('windows-security-unavailable'), /Windows PowerShell/);
  assert.doesNotMatch(setupErrorText('private-permissions'), /private-permissions/);
});

test('setup prefill: untouched fields only; edits, clears and a manual store survive late hints and refreshes', () => {
  const hints = (data: string | null, state: 'resolved' | 'candidate' = 'resolved') => ({
    configRoot: { value: '/h/.config/opencode', state },
    dataRoot: data ? { value: data, state } : null,
    storeRoot: data ? { value: deriveStore(data), state } : null,
  });
  // Arrives prefilled.
  const a = initialSetupUi();
  applySuggestions(a, hints('/h/.local/share/opencode'));
  assert.deepEqual(a.form, { configRoot: '/h/.config/opencode', dataRoot: '/h/.local/share/opencode', storeRoot: '/h/.local/share/opencode/openchamber-progress' });
  // User edits config, clears data on purpose; a refresh with different hints changes neither.
  a.form.configRoot = '/custom/config'; a.edited.configRoot = true;
  a.form.dataRoot = ''; a.edited.dataRoot = true;
  applySuggestions(a, hints('/other/opencode'));
  assert.equal(a.form.configRoot, '/custom/config');
  assert.equal(a.form.dataRoot, '', 'a deliberately cleared field stays cleared');
  // Custom store typed before a late data hint: the derived suffix never overwrites it.
  const b = initialSetupUi();
  b.form.storeRoot = '/private/progress'; b.edited.storeRoot = true;
  applySuggestions(b, hints('/h/.local/share/opencode'));
  assert.deepEqual([b.form.dataRoot, b.form.storeRoot], ['/h/.local/share/opencode', '/private/progress']);
  // An untouched store follows a data folder the user typed (trailing separators trimmed).
  const c = initialSetupUi();
  applySuggestions(c, hints('/h/.local/share/opencode'));
  c.form.dataRoot = '/data/oc//'; c.edited.dataRoot = true;
  applySuggestions(c, hints('/h/.local/share/opencode'));
  assert.equal(c.form.storeRoot, '/data/oc/openchamber-progress');
  // A later unknown (null) hint never wipes an earlier prefill; with no hints at all fields stay blank.
  const d = initialSetupUi();
  applySuggestions(d, hints('/h/.local/share/opencode'));
  applySuggestions(d, { configRoot: null, dataRoot: null, storeRoot: null });
  assert.equal(d.form.dataRoot, '/h/.local/share/opencode');
  const e = initialSetupUi();
  applySuggestions(e, undefined);
  assert.deepEqual(e.form, { configRoot: '', dataRoot: '', storeRoot: '' });
});

test('capture-off note: removed points to Install again, disabled to turning it on, anything uncertain gives no instruction', () => {
  const ready = (x: Record<string, unknown>) => ({ state: 'ready' as const, value: parseSetup(JSON.stringify({ configured: true, verified: true, installed: true, captureEnabled: true, targets: { configRoot: '/c', dataRoot: '/d', storeRoot: '/s' }, version: '0.2.3', activation: 'control-applies-to-loaded-instances', separateLifecycle: true, historyRetained: true, diagnostics: [], ...x })) });
  const removed = captureOffNote(ready({ installed: false, captureEnabled: false }));
  assert.equal(removed.reason, 'removed');
  assert.match(removed.text, /Install again under Setup/);
  assert.doesNotMatch(removed.text, /Turn it back on/);
  const disabled = captureOffNote(ready({ captureEnabled: false }));
  assert.equal(disabled.reason, 'disabled');
  assert.match(disabled.text, /Turn it back on under Setup/);
  // Not established: never inferred as removed, and no instruction.
  const unknowns = [
    captureOffNote(null),
    captureOffNote({ state: 'loading' }),
    captureOffNote({ state: 'error', failure: { kind: 'unavailable', code: 'x', message: 'x' } }),
    captureOffNote(ready({ installed: false, captureEnabled: false, recovery: { stagedPackages: 1, stagedActivations: 0, stagedReleases: 0 } })),
    captureOffNote(ready({ installed: false, captureEnabled: false, activation: 'reload-required' })),
  ];
  for (const n of unknowns) {
    assert.equal(n.reason, 'unknown');
    assert.doesNotMatch(n.text, /Install again|Turn it back on/);
  }
});

test('setup update comparison: valid metadata maps; malformed, absent or uncertain replies make no claim', () => {
  const read = (x: Record<string, unknown>) => parseSetup(JSON.stringify(setupRead({ version: '0.2.2', ...x })));
  assert.deepEqual(read({ update: { state: 'available', candidateVersion: '0.2.3', rootVersion: '0.2.2' } }).update, { state: 'available', candidateVersion: '0.2.3', rootVersion: '0.2.2' });
  assert.deepEqual(read({ update: { state: 'current', candidateVersion: '0.2.2', rootVersion: null } }).update, { state: 'current', candidateVersion: '0.2.2', rootVersion: null });
  assert.equal(read({ update: { state: 'newer-installed', candidateVersion: '0.2.1', rootVersion: { v: 1 } } }).update?.rootVersion, null, 'odd root metadata is diagnostic only');
  // Absent (older service, inspect reply) or malformed: no comparison, and the reply stays valid.
  const none = [
    read({}),
    read({ update: { state: 'unknown', candidateVersion: '0.2.3', rootVersion: null } }),
    read({ update: { state: 'available', candidateVersion: '', rootVersion: null } }),
    read({ update: { state: 'available', candidateVersion: 3, rootVersion: null } }),
    read({ update: { state: 'available', candidateVersion: '0.2.3 <b>', rootVersion: null } }),
    read({ update: 'available' }),
    // Contradictory replies: the comparison exists only for configured, verified, installed setups.
    read({ installed: false, update: { state: 'available', candidateVersion: '0.2.3', rootVersion: null } }),
    read({ verified: false, update: { state: 'available', candidateVersion: '0.2.3', rootVersion: null } }),
    read({ version: null, update: { state: 'available', candidateVersion: '0.2.3', rootVersion: null } }),
    read({ configured: false, targets: null, update: { state: 'available', candidateVersion: '0.2.3', rootVersion: null } }),
  ];
  for (const s of none) { assert.equal(s.update, undefined); assert.equal(updateNotice(s), null); }
  assert.equal(none[0].version, '0.2.2');
});

test('update notice: upgrade, same-version rebuild and newer installed stay distinct; current and unknown show nothing', () => {
  const read = (version: string, update: Record<string, unknown> | undefined, x: Record<string, unknown> = {}) => parseSetup(JSON.stringify(setupRead({ version, update, ...x })));
  const up = updateNotice(read('0.2.2', { state: 'available', candidateVersion: '0.2.3', rootVersion: '0.2.2' }))!;
  assert.equal(up.kind, 'upgrade');
  assert.match(up.body, /Installed 0\.2\.2 → bundled 0\.2\.3/);
  assert.equal(up.action, 'Review update');
  const rebuild = updateNotice(read('0.2.3', { state: 'available', candidateVersion: '0.2.3', rootVersion: '0.2.2' }))!;
  assert.equal(rebuild.kind, 'rebuild');
  assert.doesNotMatch(`${rebuild.title} ${rebuild.body}`, /newer|→/i, 'a rebuild is a different build, never "newer"');
  const back = updateNotice(read('0.2.4', { state: 'newer-installed', candidateVersion: '0.2.3', rootVersion: null }))!;
  assert.equal(back.kind, 'downgrade');
  assert.equal(back.tone, 'warning');
  assert.match(back.body, /0\.2\.4.*0\.2\.3/);
  assert.doesNotMatch(`${back.title} ${back.body} ${back.action}`, /update available|Review update|→/i, 'never a normal upgrade prompt');
  assert.equal(updateNotice(read('0.2.3', { state: 'current', candidateVersion: '0.2.3', rootVersion: '0.2.2' })), null, 'current shows nothing');
  assert.equal(updateNotice(read('0.2.3', undefined)), null, 'unknown shows nothing, not "up to date"');
  // Independent of activation: an available update still shows while a reload is pending.
  const both = read('0.2.2', { state: 'available', candidateVersion: '0.2.3', rootVersion: '0.2.2' }, { activation: 'reload-required' });
  assert.equal(setupPhase(both), 'reload-required');
  assert.equal(updateNotice(both)?.kind, 'upgrade');
});

test('update review: installed version from inspect, bundled version from the latest setup read; stale or missing makes no claim', () => {
  const inspected = (version: string) => parseSetup(JSON.stringify(setupRead({ version, action: 'inspect' })));
  // The comparison comes from a real setup read; inspect replies never carry one.
  const snap = (state: string, candidateVersion: string, version: string) => bundledComparison(parseSetup(JSON.stringify(setupRead({ version, update: { state, candidateVersion, rootVersion: '0.2.2' } }))));
  const review = (version: string, bundled: ReturnType<typeof snap>, action: 'install' | 'update' = 'update') => reviewVersions({ action, targets: null, result: inspected(version) }, bundled);
  assert.equal(inspected('0.2.2').update, undefined);
  // A refused action's re-read without a comparison (e.g. modified files) drops it from the open review.
  assert.equal(bundledComparison(parseSetup(JSON.stringify(setupRead({ version: '0.2.2' })))), null);
  const up = review('0.2.2', snap('available', '0.2.3', '0.2.2'));
  assert.deepEqual(up.rows, [['Installed version', '0.2.2'], ['Bundled version', '0.2.3']]);
  assert.equal(up.kind, 'upgrade');
  assert.equal(review('0.2.3', snap('available', '0.2.3', '0.2.3')).kind, 'rebuild');
  const back = review('0.2.4', snap('newer-installed', '0.2.3', '0.2.4'));
  assert.equal(back.kind, 'downgrade');
  assert.match(back.note!, /older/);
  assert.equal(review('0.2.3', snap('current', '0.2.3', '0.2.3')).kind, 'same');
  // Missing (older service, re-bind after a reinstall) or describing another installed version: no comparison.
  for (const r of [review('0.2.2', null), review('0.2.3', snap('available', '0.2.3', '0.2.2'))]) {
    assert.equal(r.kind, null);
    assert.equal(r.rows.some(([k]) => k === 'Bundled version'), false);
    assert.match(r.note!, /cannot say/);
  }
  assert.deepEqual(review('0.2.2', snap('available', '0.2.3', '0.2.2'), 'install'), { rows: [['Installed version', '0.2.2']], kind: null, note: null });
});

test('setup prefill copy: provenance is plain and never claims a verified setup', () => {
  const s = initialSetupUi();
  const h = { configRoot: { value: '/h/.config/opencode', state: 'resolved' as const }, dataRoot: { value: '/h/.local/share/opencode', state: 'candidate' as const }, storeRoot: { value: '/h/.local/share/opencode/openchamber-progress', state: 'candidate' as const } };
  applySuggestions(s, h);
  const texts = (['configRoot', 'dataRoot', 'storeRoot'] as const).map((k) => fieldHint(k, s, h));
  assert.match(texts[0], /Found on this computer; not yet confirmed/);
  assert.match(texts[1], /Usual location .*not found there or not confirmed/);
  assert.match(texts[2], /Suggested inside the OpenCode data folder/);
  for (const t of texts) assert.doesNotMatch(t, /verified|your OpenCode setup is|detected setup/i);
  s.form.configRoot = '/mine'; s.edited.configRoot = true;
  assert.match(fieldHint('configRoot', s, h), /^Absolute path/);
});

// Drives RefreshGate exactly like the frame controller: each run reads for the scope current when it
// started and paints only if its generation is still current when the reply lands.
function controllerHarness() {
  let scope = 'A';
  const painted: string[] = [];
  const pending: { scope: string; generation: number; resolve: () => void }[] = [];
  let maxInFlight = 0;
  const gate: RefreshGate = new RefreshGate((generation) => {
    const target = scope;
    return new Promise<void>((resolve) => pending.push({ scope: target, generation, resolve })).then(() => {
      if (generation === gate.current) painted.push(target);
    });
  });
  const request = () => { gate.request(); maxInFlight = Math.max(maxInFlight, gate.inFlight); };
  const switchTo = (next: string) => { scope = next; gate.retire(); request(); };
  const settle = async (pick: (p: typeof pending) => number = () => 0) => { const [p] = pending.splice(pick(pending), 1); p.resolve(); await new Promise((r) => setTimeout(r, 0)); maxInFlight = Math.max(maxInFlight, gate.inFlight); };
  return { gate, painted, pending, request, switchTo, settle, get maxInFlight() { return maxInFlight; } };
}

test('refresh gate: same-generation requests coalesce into one run plus one follow-up', async () => {
  const h = controllerHarness();
  h.request(); h.request(); h.request();
  assert.equal(h.pending.length, 1);
  await h.settle();
  assert.deepEqual([h.painted, h.pending.length], [['A'], 1]); // the coalesced follow-up
  await h.settle();
  assert.equal(h.pending.length, 0);
});

test('refresh gate: latest switch wins — an obsolete read neither blocks nor paints', async () => {
  const h = controllerHarness();
  h.request();                      // read for A in flight
  h.switchTo('B');                  // B starts at once, A is not awaited
  assert.deepEqual(h.pending.map((p) => p.scope), ['A', 'B']);
  await h.settle((p) => p.findIndex((x) => x.scope === 'B'));
  assert.deepEqual(h.painted, ['B']);
  await h.settle();                 // A lands late: discarded, never resurrected
  assert.deepEqual(h.painted, ['B']);
});

test('refresh gate: rapid switches stay bounded (≤2 in flight) and only the newest scope paints', async () => {
  const h = controllerHarness();
  h.request();
  for (const s of ['B', 'C', 'D', 'E']) h.switchTo(s);
  assert.ok(h.maxInFlight <= 2, `in flight ${h.maxInFlight}`);
  assert.deepEqual(h.pending.map((p) => p.scope), ['A', 'B']); // C, D, E collapsed into one queued follow-up
  while (h.pending.length) await h.settle((p) => p.length - 1); // replies land newest-first, then stragglers
  assert.deepEqual(h.painted, ['E']);
  assert.ok(h.maxInFlight <= 2);
});

test('refresh gate: stop() ends the frame — no new or queued reads, in-flight replies discarded', async () => {
  const h = controllerHarness();
  h.request(); h.request();         // one running, one queued
  h.gate.stop();
  h.request();
  await h.settle();
  assert.deepEqual([h.painted, h.pending.length], [[], 0]);
});

test('recent memory: bounded, least-recently-used out, keyed by full authority + scope', () => {
  const m = new RecentMemory<string>(3);
  m.set('acct|store1|src1|true#s:A', 'a'); m.set('acct|store1|src1|true#s:B', 'b'); m.set('acct|store1|src1|true#s:C', 'c');
  assert.equal(m.get('acct|store1|src1|true#s:A'), 'a'); // A is now most recent
  m.set('acct|store1|src1|true#s:D', 'd');
  assert.equal(m.size, 3);
  assert.equal(m.get('acct|store1|src1|true#s:B'), undefined); // B evicted
  assert.equal(m.get('acct|store2|src1|true#s:A'), undefined); // another store never matches
  assert.equal(m.get('acct|store1|src1|false#s:A'), undefined); // binding verification is part of the key
  m.clear();
  assert.equal(m.size, 0);
});

test('live workspace stays within its cap, restarts cleanly and releases late-resolving subscriptions', async () => {
  // Like the host: every subscription has its own id; unsubscribing removes only that one.
  const active = new Map<number, string>();
  let seq = 0;
  let resolveLate: (() => void) | null = null;
  const subscribe = (name: string) => { const id = ++seq; active.set(id, name); return () => { active.delete(id); }; };
  const host = {
    onProjects: async (cb: (s: unknown) => void) => { cb({ state: 'ready', projects: ['a', 'b', 'c', 'late'].map((id) => ({ id, name: id, directory: `/${id}` })) }); return subscribe('projects'); },
    onWorktrees: async () => () => {},
    onSessions: (id: string) => new Promise<() => void>((resolve) => {
      const done = () => resolve(subscribe(id));
      if (id === 'late') resolveLate = done; else done();
    }),
  };
  const names = () => [...active.values()].sort();
  const ws = new LiveWorkspace(host as never, 2, () => {});
  ws.start();
  ws.want(['a', 'b', 'c', 'late']);
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(ws.snapshot.capped, ['c', 'late']);
  assert.deepEqual(names(), ['a', 'b', 'projects']);
  ws.want(['late']);
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(names(), ['projects']);
  // Restart waits for the old slot's late release before replacing subscriptions.
  ws.restart();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(ws.sessionSubscriptionCount, 0);
  assert.deepEqual(names(), []);
  ws.dispose();
  (resolveLate as (() => void) | null)?.();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(names(), []);
});

test('reported-progress motion: only an active plan with working tasks, in a fresh read with capture on', () => {
  const fresh = { fresh: true, captureEnabled: true };
  const s = summarize(plan('P1'), detailOf());
  assert.ok(s.working > 0);
  assert.equal(showsLiveness('active', s, fresh), true);
  // Nothing working, closed plans (even with tasks still marked working), stale/failed reads and
  // capture off all stay static. Report age and live session state are not inputs.
  assert.equal(showsLiveness('active', { working: 0 }, fresh), false);
  for (const lifecycle of ['completed', 'cancelled', 'failed'] as const) assert.equal(showsLiveness(lifecycle, s, fresh), false);
  assert.equal(showsLiveness('active', s, { fresh: false, captureEnabled: true }), false);
  assert.equal(showsLiveness('active', s, { fresh: true, captureEnabled: false }), false);
});

test('motion CSS: gated, compositor-only keyframes, stopped by reduced motion (pseudo-elements too) and while hidden', () => {
  const rules = CSS.split('}').map((r) => r.trim());
  // Every animated rule outside keyframes sits under the motion gate.
  for (const r of rules.filter((x) => /(^|[;{])animation:ap-/.test(x))) assert.match(r, /^\[data-motion="on"\]/, r);
  // Keyframes move only transform/opacity: no width, colour or background animation.
  const frames = CSS.match(/@keyframes ap-[\w-]+\{(?:[^{}]*\{[^{}]*\})+\}/g) ?? [];
  assert.equal(frames.length, 3);
  for (const f of frames) for (const [, prop] of f.matchAll(/[{;]([a-z-]+):/g)) assert.ok(['opacity', 'transform'].includes(prop), `${prop} in ${f}`);
  assert.match(CSS, /@media\(prefers-reduced-motion:reduce\)\{\*,\*::before,\*::after\{animation:none!important/);
  assert.match(CSS, /\[data-ap-hidden\] \*,\[data-ap-hidden\] \*::before,\[data-ap-hidden\] \*::after\{animation:none!important\}/);
  // Readable text token for the status text, with the base colour only as an older-host fallback.
  assert.match(CSS, /\.ap-working-text\{color:var\(--oc-info-text,var\(--oc-info\)\)\}/);
});

test('elapsed text: whole minutes, hours and days; never seconds; nothing for an impossible value', () => {
  const m = 60_000, h = 60 * m, d = 24 * h;
  const cases: [number, string | null][] = [
    [0, '<1 min'], [59_999, '<1 min'], [m, '1 min'], [59 * m + 59_999, '59 min'], [h, '1 h'], [h + 5 * m, '1 h 5 min'],
    [23 * h + 59 * m, '23 h 59 min'], [d, '1 day'], [2 * d + 4 * h + 30 * m, '2 days 4 h'], [-1, null], [Number.NaN, null],
  ];
  for (const [ms, text] of cases) assert.equal(elapsedText(ms), text, String(ms));
});

test('timing parse: optional claim — absent or unreadable gives none; bad or future entries mean unknown start', () => {
  const readAt = '2026-10-25T12:00:00.000Z';
  const t = parseTiming({ readAt, items: {
    A: { since: '2026-10-25T09:00:00.000Z', kind: 'exact' },
    B: { since: '2026-10-25T11:59:30.000Z', kind: 'lower-bound' },
    C: { since: '2026-10-25T12:00:05.000Z', kind: 'exact' }, // after the reply's own read time
    D: { since: 'not a time', kind: 'exact' },
    E: { since: '2026-10-25T10:00:00.000Z', kind: 'started' },
  } });
  assert.deepEqual(t, { items: { A: { kind: 'exact', since: '2026-10-25T09:00:00.000Z', elapsedAtRead: 3 * 3_600_000 }, B: { kind: 'lower-bound', since: '2026-10-25T11:59:30.000Z', elapsedAtRead: 30_000 } } });
  for (const bad of [undefined, null, 'x', { readAt }, { readAt: 'nope', items: {} }, { items: {} }]) assert.equal(parseTiming(bad), null);
  // An older service: the detail reply stays valid and carries no timing.
  assert.equal(parsePlanPage(JSON.stringify(planPage(P1, P1_ITEMS, [RELAY]))).timing, null);
});

test('elapsed anchor: service clock at the reply plus monotonic time since receipt, whatever the browser clock says', async () => {
  const readAt = '2026-10-25T12:00:00.000Z';
  const body = { ...planPage(P1, P1_ITEMS, [RELAY]), timing: { readAt, items: { I3: { since: '2026-10-25T11:00:00.000Z', kind: 'exact' } } } };
  const realNow = Date.now;
  try {
    Date.now = () => Date.parse('2031-01-01T00:00:00Z'); // browser wall clock far ahead of the service
    const res = await readDetail(fakeHost(() => ({ status: 200, body })), plan('P1'), () => 5_000);
    assert.ok(res.ok && res.detail.timing);
    const a = res.ok ? res.detail.timing!.I3 : null;
    assert.deepEqual(a, { kind: 'exact', since: '2026-10-25T11:00:00.000Z', elapsedAtRead: 3_600_000, receivedAt: 5_000 });
    assert.equal(elapsedText(elapsedAt(a!, 5_000)), '1 h');
    assert.equal(elapsedText(elapsedAt(a!, 5_000 + 30 * 60_000)), '1 h 30 min');
    assert.equal(elapsedAt(a!, 4_000), 3_600_000); // a monotonic reading before receipt never shortens it
  } finally { Date.now = realNow; }
  // Older service: no timing at all (no labels), not an empty claim.
  const old = await readDetail(fakeHost(() => ({ status: 200, body: planPage(P1, P1_ITEMS, [RELAY]) })), plan('P1'), () => 0);
  assert.equal(old.ok && old.detail.timing, undefined);
});

test('elapsed anchor follows the revision the detail was read at: a restart takes the new reply and its receipt time', async () => {
  let rev = 4;
  let firstCalls = 0;
  let clock = 100;
  const items = Array.from({ length: 21 }, (_, i) => ({ id: `T${i}`, title: `Task ${i}`, kind: 'task' as const, status: i === 0 ? 'working' as const : 'pending' as const }));
  const timing = (since: string) => ({ readAt: '2026-10-25T12:00:00.000Z', items: { T0: { since, kind: 'exact' } } });
  const host = fakeHost((r) => {
    if (!r.query?.cursor) {
      firstCalls++;
      return { status: 200, body: { ...planPage({ ...P1, revision: rev }, items.slice(0, 20), [], { items: '1', contributions: null }), timing: timing(rev === 4 ? '2026-10-25T11:00:00.000Z' : '2026-10-25T11:50:00.000Z') } };
    }
    const body = planPage({ ...P1, revision: firstCalls === 1 ? 5 : rev }, items.slice(20), [], { items: null, contributions: null });
    if (firstCalls === 1) rev = 5; // T0 was blocked and reopened: a new interval at revision 5
    return { status: 200, body };
  });
  const res = await readDetail(host, plan('P1'), () => clock++);
  assert.ok(res.ok);
  assert.deepEqual(res.ok && [res.detail.revision, res.detail.timing!.T0.elapsedAtRead, res.detail.timing!.T0.receivedAt], [5, 10 * 60_000, 101]);
});

const OFFICIAL = { installedVersion: '0.2.4', repository: 'Phototonic/openchamber-progress', ref: 'main', state: 'available', checkedAt: '2026-10-25T10:00:00.000Z', stale: false, candidateVersion: '0.2.5', diagnostic: 'ok', nextCheckAt: '2026-10-25T11:00:00.000Z' };

test('official-main reply: frozen fields and consistent states only; anything else is unknown, never up to date', async () => {
  const parse = (x: object) => parseExtensionUpdate(JSON.stringify(x));
  const { repository: _r, ref: _f, ...view } = OFFICIAL; // validated, then fixed: the view keeps no source identity of its own
  assert.deepEqual(parse(OFFICIAL), view);
  assert.equal(parse({ ...OFFICIAL, state: 'not-newer', candidateVersion: undefined }).state, 'not-newer');
  assert.deepEqual(parse({ ...OFFICIAL, state: 'unknown', checkedAt: null, candidateVersion: undefined, diagnostic: 'unavailable' }).state, 'unknown');
  // A failed recheck keeps the known candidate as stale knowledge with its original success time.
  assert.deepEqual([parse({ ...OFFICIAL, stale: true, diagnostic: 'timeout' }).stale, parse({ ...OFFICIAL, stale: true, diagnostic: 'timeout' }).checkedAt], [true, OFFICIAL.checkedAt]);
  for (const bad of [
    { ...OFFICIAL, repository: 'someone/fork' }, { ...OFFICIAL, ref: 'dev' }, { ...OFFICIAL, candidateVersion: undefined }, { ...OFFICIAL, checkedAt: null },
    { ...OFFICIAL, state: 'unknown' }, { ...OFFICIAL, state: 'newer' }, { ...OFFICIAL, candidateVersion: 'v0.2.5' }, { ...OFFICIAL, candidateVersion: '<b>1.0.0</b>' },
    { ...OFFICIAL, diagnostic: 'something' }, { ...OFFICIAL, nextCheckAt: 'soon' }, { ...OFFICIAL, stale: 'no' }, { ...OFFICIAL, installedVersion: 1 },
  ]) assert.throws(() => parse(bad), JSON.stringify(bad));
  // Through the service proxy: an older service (404), a malformed body or a failure is null (unknown).
  assert.equal((await readExtensionUpdate(fakeHost(() => ({ status: 200, body: OFFICIAL }))))?.candidateVersion, '0.2.5');
  for (const reply of [{ status: 404, body: { error: 'not-found' } }, { status: 200, body: 'not json' }, { status: 200, body: { ...OFFICIAL, ref: 'dev' } }, { status: 503, body: { error: 'busy' } }]) {
    assert.equal(await readExtensionUpdate(fakeHost(() => reply)), null);
  }
  const host = fakeHost(() => ({ status: 200, body: OFFICIAL }));
  await readExtensionUpdate(host);
  assert.deepEqual(host.calls, [{ method: 'GET', path: '/v1/extension-update' }]); // no query, no body: nothing to choose a source
});

test('official-main notice: an availability only, dismissed per version; fixed link and copy, stale qualified', () => {
  const v = parseExtensionUpdate(JSON.stringify(OFFICIAL));
  const n = officialMainNotice(v, null)!;
  assert.deepEqual([n.candidate, n.installed], ['0.2.5', '0.2.4']);
  assert.equal(officialMainNotice(v, '0.2.5'), null);
  assert.ok(officialMainNotice({ ...v, candidateVersion: '0.2.6' }, '0.2.5')); // a newer version is announced again
  assert.equal(officialMainNotice({ ...v, state: 'not-newer' }, null), null);
  assert.equal(officialMainNotice({ ...v, state: 'unknown', candidateVersion: undefined, checkedAt: null }, null), null);
  assert.equal(officialMainNotice(null, null), null);
  const text = officialMainText(n, 'en', Date.parse('2026-10-25T10:30:00Z'));
  assert.equal(text.title, 'Official main version 0.2.5 available · This extension 0.2.4');
  assert.equal(text.body, OFFICIAL_MAIN_HOWTO);
  assert.match(OFFICIAL_MAIN_HOWTO, /Settings → Extensions/);
  assert.match(OFFICIAL_MAIN_HOWTO, /can’t tell which source/);
  const stale = officialMainText({ ...n, stale: true, diagnostic: 'rate-limited' }, 'en', Date.parse('2026-10-25T12:00:00Z'));
  assert.match(stale.body, /^This may be out of date: the latest check was rate-limited; last confirmed 2 hours ago\. /);
  assert.equal(OFFICIAL_MAIN_URL, 'https://github.com/Phototonic/openchamber-progress/tree/main');
});

test('compact official-main line qualifies stale knowledge and still opens progress', (t) => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    createElement: (tag: string) => {
      assert.equal(tag, 'button');
      return Object.assign(new EventTarget(), { dataset: {}, className: '', textContent: '', type: '', title: '' });
    },
  } });
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'document', previous); else Reflect.deleteProperty(globalThis, 'document'); });
  const v = parseExtensionUpdate(JSON.stringify(OFFICIAL));
  const hooks = { officialMain: v, officialMainDismissed: null as string | null, dismissOfficialMain: () => {}, openOfficialMain: () => {}, env: { locale: 'en' } };
  let opened = 0;
  const open = () => { opened++; };
  const fresh = officialMainLine(hooks, open)!;
  assert.equal(fresh.textContent, 'Official main 0.2.5 available');
  assert.doesNotMatch(fresh.title, /out of date/);
  for (const checkedAt of [v.checkedAt, null]) {
    const stale = officialMainLine({ ...hooks, officialMain: { ...v, stale: true, diagnostic: 'timeout', checkedAt } }, open)!;
    assert.match(stale.textContent!, /Official main 0\.2\.5 available.*check out of date/);
    assert.match(stale.title, /may be out of date/);
    stale.dispatchEvent(new Event('click'));
  }
  assert.equal(opened, 2);
  assert.equal(officialMainLine({ ...hooks, officialMainDismissed: v.candidateVersion! }, open), null);
  assert.equal(officialMainLine({ ...hooks, officialMain: null }, open), null);
});

test('official-main dismissal made while a check is held stays; reloads and newer versions behave', async () => {
  const v = parseExtensionUpdate(JSON.stringify(OFFICIAL));
  let release!: () => void;
  const held = new Promise<void>((r) => { release = r; });
  const heldHost: ServiceHost = { serviceRequest: async () => { await held; return { status: 200, body: JSON.stringify(OFFICIAL) }; } };
  const state = new OfficialMainState();
  state.apply(0, v, null); // 0.2.5 already shown
  assert.ok(officialMainNotice(state.value, state.dismissed));
  const pending = state.check(heldHost, { get: async () => null }); // reads storage before the dismissal lands
  state.dismiss('0.2.5'); // the user dismisses while the reply is held
  release();
  const done = await pending;
  // Pre-fix composition (the reply's stored read overwrote the local choice) would show it again:
  assert.ok(officialMainNotice(done.next, null));
  done.apply();
  assert.equal(officialMainNotice(state.value, state.dismissed), null);
  assert.equal(state.dismissed, '0.2.5');
  // A later check that reads nothing stored yet does not clear it either.
  (await state.check({ serviceRequest: async () => ({ status: 200, body: JSON.stringify(OFFICIAL) }) }, { get: async () => undefined })).apply();
  assert.equal(officialMainNotice(state.value, state.dismissed), null);
  // A reloaded frame takes the stored dismissal; a newer candidate is announced again.
  const fresh = new OfficialMainState();
  (await fresh.check({ serviceRequest: async () => ({ status: 200, body: JSON.stringify(OFFICIAL) }) }, { get: async () => '0.2.5' })).apply();
  assert.equal(officialMainNotice(fresh.value, fresh.dismissed), null);
  (await fresh.check({ serviceRequest: async () => ({ status: 200, body: JSON.stringify({ ...OFFICIAL, candidateVersion: '0.2.6' }) }) }, { get: async () => '0.2.5' })).apply();
  assert.equal(officialMainNotice(fresh.value, fresh.dismissed)?.candidate, '0.2.6');
  // A newer local dismissal wins over an older stored one read by a check in flight.
  let releaseB!: () => void;
  const heldB = new Promise<void>((r) => { releaseB = r; });
  const pendingB = fresh.check({ serviceRequest: async () => { await heldB; return { status: 200, body: JSON.stringify({ ...OFFICIAL, candidateVersion: '0.2.6' }) }; } }, { get: async () => '0.2.5' });
  fresh.dismiss('0.2.6');
  releaseB();
  (await pendingB).apply();
  assert.equal(officialMainNotice(fresh.value, fresh.dismissed), null);
});

test('elapsed labels are blue (readable info text); an unknown start stays muted', () => {
  assert.match(CSS, /\.ap-elapsed\{color:var\(--oc-info-text,var\(--oc-info\)\);/);
  assert.match(CSS, /\.ap-elapsed\[data-kind="unknown"\]\{color:var\(--oc-muted\)\}/);
});
