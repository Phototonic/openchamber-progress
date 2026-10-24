import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { GuestRequest } from '@openchamber/sdk';
import { countItems } from '../../shared/progress.ts';
import { parseHealth, parsePlanPage, parsePlansPage, parseSetup, setupBody } from '../../ui/shared/adapter.ts';
import { relativeAge } from '../../ui/shared/format.ts';
import { canOpen, coverageFor, EMPTY_LIVE, liveLabel, LiveWorkspace, type LiveSession, type LiveSnapshot } from '../../ui/shared/live.ts';
import { currentWork, itemTree, participants, summarize, summaryText, type PlanDetail } from '../../ui/shared/model.ts';
import { RecentMemory, RefreshGate } from '../../ui/shared/refresh.ts';
import { ALL, applyFilters, contextListScope, contextScope, coverageGap, filterOptions, NO_FILTERS, normalizeFilters, pageListScope, pickPlan, placeOf } from '../../ui/shared/scope.ts';
import { classify, readDetail, readDocument, readHistory, readList, setupCall, type ServiceHost } from '../../ui/shared/source.ts';
import { applySuggestions, captureOffNote, deriveStore, fieldHint, initialSetupUi, setupErrorText, setupPhase } from '../../ui/shared/setup.ts';
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
  return { projectsState: 'ready', projects, sessions: new Map(projects.map((p) => [p.id, { state: 'ready' as const, records: records.filter((r) => r.projectId === p.id) }])), capped: [] };
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
  assert.deepEqual(contextListScope(null, '/d'), { directory: '/d' });
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
    onProjects: async () => subscribe('projects'),
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
  // Restart (after a host-side drop on context change) re-subscribes the same set once.
  ws.restart();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(ws.subscriptionCount, 2);
  assert.deepEqual(names(), ['projects']);
  ws.dispose();
  (resolveLate as (() => void) | null)?.();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(names(), []);
});
