// V3 (board search, browser logic): the production adapter and SearchController over a REAL
// in-process HTTP service with the accepted search fixture. Held replies and a synthetic settled SDK
// workspace snapshot are labelled seams; direct-SQL corruption is labelled fault injection.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHealth, parseSearchState, parseSearchWindow, searchQuery, searchStateQuery } from '../../ui/shared/adapter.ts';
import type { PlanView, SearchRequest } from '../../ui/shared/model.ts';
import { ALL, applyFilters, filterOptions, placeOf, searchFilterOptions } from '../../ui/shared/scope.ts';
import {
  breadcrumb, discoveryIncomplete, groupHits, locationAvailability, membershipSig, queryProblem, scopeAvailability, searchable, SearchController, SEARCH_PAGE, SEARCH_WINDOWS, type SearchCriteria,
} from '../../ui/shared/search.ts';
import { chipLabel, chipsOf, draftDiffers, NO_DRAFT, scopeText } from '../../ui/shared/search-view.ts';
import { libraryId, seedSearchLibrary } from '../fixtures/plan-task-search.ts';
import type { ItemInput } from '../../shared/progress.ts';
import { searchBackend, searchProxy, settle, until, workspace, type Backend, type SearchProxy } from './plan-task-search-fixture.ts';

const criteria = (patch: Partial<SearchCriteria> = {}): SearchCriteria => ({ q: '', source: ALL, lifecycle: ALL, status: ALL, project: ALL, worktree: ALL, session: ALL, archived: false, labels: {}, ...patch });
const identity = (b: Backend) => ({ storeId: b.f.storeId, binding: { sourceId: b.f.alpha.id, verified: true } });
const request = (patch: Partial<SearchRequest> = {}): SearchRequest => ({ q: '', source: null, session: null, lifecycle: null, status: null, archived: 'exclude', limit: 50, cursor: null, ...patch });

function controller(svc: SearchProxy) {
  let visible = true, changes = 0;
  const c = new SearchController({
    service: (current) => ({ serviceRequest: (q) => (current() ? svc.serviceRequest(q) : Promise.reject(new Error('Retired read'))) }),
    changed: () => { changes++; }, visible: () => visible,
  });
  return { c, hide: () => { visible = false; c.hidden(); }, show: () => { visible = true; }, get changes() { return changes; } };
}
const done = (c: SearchController) => until(() => !!c.view() && !c.view()!.busy, 'search action finished');
let keys = 0;
async function run(c: SearchController, b: Backend, patch: Partial<SearchCriteria>, live = workspace()) {
  c.submit(`k${++keys}`, criteria(patch), identity(b), live);
  await done(c);
  return c.view()!;
}
async function exhaust(c: SearchController) {
  for (let i = 0; i < 40 && c.view()!.more && !c.view()!.stop?.match(/conflict|changed|membership|retired|identity/); i++) { c.more(); await done(c); }
  return c.view()!;
}
async function withBackend(seed: boolean, body: (b: Backend, svc: SearchProxy) => Promise<void>) {
  const b = await searchBackend(seed);
  try { await body(b, searchProxy(b)); } finally { await b.stop(); }
}

test('adapter: capability, frozen query fields, strict window/state parsing and refusals', async () => {
  await withBackend(true, async (b) => {
    assert.equal(parseHealth(JSON.stringify({ ok: true, ready: true, protocolVersion: 2, schemaVersion: 2, planTaskSearch: 1 })).planTaskSearch, 1);
    assert.equal(parseHealth(JSON.stringify({ ok: true, ready: true, protocolVersion: 2, schemaVersion: 2 })).planTaskSearch, undefined, 'absent capability stays absent');
    assert.deepEqual(searchQuery(request({ q: 'export csv', lifecycle: 'completed', status: 'blocked', limit: 50 })), { q: 'export csv', lifecycle: 'finished', status: 'blocked', archived: 'exclude', limit: '50' });
    assert.deepEqual(searchQuery(request()), { archived: 'exclude', limit: '50' }, 'empty text is omitted, never a wildcard');
    const r = request({ q: 'export csv' });
    const body = JSON.stringify(b.f.store.search({ q: 'export csv', archived: 'exclude', limit: 50 }));
    const w = parseSearchWindow(body, r, { ...identity(b), fingerprint: null });
    assert.equal(w.hits.length, 4);
    assert.equal(w.hits[0].plan.key, 'source-alpha/P-export');
    assert.equal(w.hits[0].plan.counts.total, 4, 'full-plan totals, not filtered subsets');
    assert.equal(w.hits[2].task, null, 'plan-only hit'); assert.equal(w.hits[2].planMatched, true);
    assert.throws(() => parseSearchWindow(body, r, { storeId: 'other-store', binding: identity(b).binding, fingerprint: null }), /another store/);
    assert.throws(() => parseSearchWindow(body, r, { ...identity(b), binding: { sourceId: 'source-beta', verified: true }, fingerprint: null }), /another store/);
    assert.throws(() => parseSearchWindow(body, r, { ...identity(b), fingerprint: '0'.repeat(64) }), /other criteria/);
    const tampered = JSON.parse(body); tampered.counts.matchingTasks++;
    assert.throws(() => parseSearchWindow(JSON.stringify(tampered), r, { ...identity(b), fingerprint: null }), /counts disagree/);
    assert.throws(() => parseSearchWindow(body, request({ q: 'export csv', archived: 'only' }), { ...identity(b), fingerprint: null }), /archive mode/);
    assert.throws(() => parseSearchWindow(body, request({ q: 'export csv', limit: 2 }), { ...identity(b), fingerprint: null }), /too many/);
    const other = JSON.parse(body); other.planTaskSearch = 2;
    assert.throws(() => parseSearchWindow(JSON.stringify(other), r, { ...identity(b), fingerprint: null }), /another contract/);
    const k = [{ source: 'source-alpha', plan: 'P-export' }, { source: 'source-beta', plan: 'missing' }];
    assert.deepEqual(searchStateQuery(b.f.storeId, k), { storeId: b.f.storeId, keys: JSON.stringify(k) });
    const state = parseSearchState(JSON.stringify(b.f.store.searchState(b.f.storeId, k)), b.f.storeId, k);
    assert.deepEqual(state.data.map((d) => d.exists), [true, false]);
    assert.throws(() => parseSearchState(JSON.stringify(b.f.store.searchState(b.f.storeId, k)), b.f.storeId, [...k].reverse()), /other plans/, 'rows must answer the requested keys in order');
    assert.throws(() => parseSearchState(JSON.stringify(b.f.store.searchState(b.f.storeId, k)), 'other-store', k), /another store/);
  });
});

test('query text, criteria and view text rules: refused not truncated, explicit scope, chips', () => {
  assert.equal(queryProblem('x'.repeat(256)), null);
  assert.match(queryProblem('x'.repeat(257))!, /256/);
  assert.match(queryProblem(Array(17).fill('w').join(' '))!, /16 words/);
  assert.equal(queryProblem(' a\u3000b\tc '), null);
  assert.equal(searchable(criteria()), false, 'board filters alone are browsing, not a broad search');
  assert.equal(searchable(criteria({ q: '  ' })), false);
  assert.equal(searchable(criteria({ status: 'blocked' })), true, 'empty text plus a status searches all tasks of that status');
  const c = criteria({ q: ' export csv ', status: 'blocked', project: 'p:alpha', labels: { project: 'Alpha' } });
  assert.deepEqual(chipsOf(c), ['q', 'status', 'project']);
  assert.equal(chipLabel('project', c), 'Project: Alpha');
  assert.match(scopeText(c), /all recorded plans in this store, current plans \(archived plans excluded\), in the chosen project/);
  assert.match(scopeText(criteria({ q: 'x', archived: true, source: 'source-beta' })), /source source-beta, archived plans only/);
  assert.equal(draftDiffers('export csv', { ...NO_DRAFT, status: 'blocked' }, c), false);
  assert.equal(draftDiffers('export', { ...NO_DRAFT, status: 'blocked' }, c), true, 'edited text marks results as the previous search');
  // Location choices: live projects plus seen locations, no counts; a chosen unknown value stays listed.
  const o = searchFilterOptions([], workspace(), { project: 'p:gone', worktree: ALL, session: ALL }, { project: 'Gone' });
  assert.deepEqual(o.projects.map((p) => p.label), ['All projects', 'Alpha', 'Other', 'Gone (not available here)']);
  assert.ok(o.projects.every((p) => !('hint' in p)), 'no facet counts');
});

test('membership snapshot: settled signature, discovery qualification and scope availability', () => {
  const live = workspace();
  assert.ok(membershipSig(live));
  assert.equal(membershipSig({ ...live, projectsState: 'loading' }), null, 'unsettled discovery is never judged');
  assert.equal(membershipSig(workspace({ sessions: new Map([['alpha', { state: 'ready', records: [{ id: 'S', title: 'x', projectId: 'alpha', directory: '/fixture/main', parentId: null, archivedAt: null, worktree: null, activity: 'idle', outcome: null }] }]]) })),
    membershipSig(workspace({ sessions: new Map([['alpha', { state: 'ready', records: [{ id: 'S', title: 'renamed', projectId: 'alpha', directory: '/fixture/main', parentId: null, archivedAt: null, worktree: null, activity: 'running', outcome: null }] }]]) })),
    'titles and live activity are not membership');
  const owned = membershipSig(workspace({ sessions: new Map([['alpha', { state: 'ready', records: [{ id: 'S', title: 'x', projectId: 'alpha', directory: '/fixture/main', parentId: null, archivedAt: null, worktree: null, activity: 'idle', outcome: null }] }]]) }), new Set(['M']));
  assert.equal(owned, membershipSig(live, new Set(['M'])), 'a session owning no seen candidate does not change the owner-scoped signature');
  assert.equal(discoveryIncomplete(live), false);
  assert.equal(discoveryIncomplete({ ...live, capped: ['x'] }), true);
  assert.equal(scopeAvailability({ project: 'p:alpha', worktree: ALL }, live), 'ok');
  assert.equal(scopeAvailability({ project: 'p:gone', worktree: ALL }, live), 'missing');
  assert.equal(scopeAvailability({ project: 'p:gone', worktree: ALL }, { ...live, projectsState: 'loading', projects: [] }), 'loading');
  assert.equal(scopeAvailability({ project: 'd:/fixture/elsewhere', worktree: ALL }, live), 'ok', 'recorded-directory fallbacks stay definable');
  // Worktree choices: proven absence blocks like a removed project; pending or failed discovery is not absence.
  const tree = (records: { directory: string }[], state: 'ready' | 'loading' | 'error' = 'ready') => workspace({ worktrees: new Map([['alpha', { state, records: records.map((r) => ({ ...r, name: 'wt-a', branch: 'wt-a', status: 'ready' as const })) }]]) });
  const removed = { project: 'p:alpha', worktree: 'w:/fixture/wt-a' };
  assert.equal(scopeAvailability(removed, tree([])), 'missing', 'ready project + ready empty discovery + absent worktree is unavailable, never ok');
  assert.deepEqual(locationAvailability(removed, tree([])), { project: 'ok', worktree: 'missing' });
  assert.equal(scopeAvailability(removed, tree([{ directory: '/fixture/wt-a' }])), 'ok');
  assert.equal(scopeAvailability({ ...removed, worktree: 'w:/fixture/wt-a/sub' }, tree([{ directory: '/fixture/wt-a' }])), 'ok', 'a subfolder of a ready worktree');
  assert.equal(scopeAvailability(removed, tree([], 'loading')), 'loading', 'still discovering is pending, not absence');
  assert.equal(scopeAvailability(removed, tree([], 'error')), 'unknown', 'failed discovery is not proven absence');
  assert.equal(scopeAvailability(removed, workspace()), 'unknown', 'no discovery for the project in this window');
  assert.equal(scopeAvailability({ ...removed, worktree: 'w:/fixture/main/sub' }, tree([])), 'ok', 'a subfolder of the main checkout stays definable');
  assert.equal(scopeAvailability(removed, workspace({ worktrees: new Map([['alpha', { state: 'ready', records: [] }]]), sessions: new Map([['alpha', { state: 'ready', records: [{ id: 'S', title: 'x', projectId: 'alpha', directory: '/fixture/wt-a', parentId: null, archivedAt: null, worktree: null, activity: 'idle', outcome: null }] }]]) })), 'ok', 'a ready live session location');
  assert.equal(scopeAvailability({ project: 'all', worktree: 'w:/fixture/wt-a' }, tree([])), 'unknown', 'without a chosen project every known project is checked: one was never discovered here');
  assert.equal(scopeAvailability({ project: 'all', worktree: 'w:/fixture/wt-a' }, workspace({ worktrees: new Map([['alpha', { state: 'ready', records: [] }], ['other', { state: 'ready', records: [] }]]) })), 'missing', 'every known project discovered without it');
  assert.deepEqual(locationAvailability({ project: 'p:gone', worktree: 'w:/fixture/wt-a' }, tree([])), { project: 'missing', worktree: 'missing' });
});

test('F1: all-words matching, plan-only vs task hits, status cannot be bypassed by plan text, full counts', async () => {
  await withBackend(true, async (b, svc) => {
    const { c } = controller(svc);
    const v = await run(c, b, { q: 'export csv' });
    assert.equal(v.exhausted, true); assert.equal(v.stop, null);
    assert.deepEqual(v.counts, { matchedPlans: 3, matchingTasks: 3 });
    assert.deepEqual(v.page.hits.map((h) => `${h.plan.key}:${h.task?.id ?? '-'}`), ['source-alpha/P-export:T-csv', 'source-alpha/P-export:T-blocked', 'source-alpha/P-title:-', 'source-beta/P-export:T-csv']);
    const groups = groupHits(v.page.hits);
    assert.deepEqual(groups.map((g) => [g.plan.key, g.hits.length, g.planOnly]), [['source-alpha/P-export', 2, false], ['source-alpha/P-title', 0, true], ['source-beta/P-export', 1, false]]);
    assert.equal(v.page.contextRows, 2, 'context rows are counted apart from matches');
    assert.deepEqual(breadcrumb(v.page.hits[0]).head.map((a) => a.title), ['Context only', 'Export CSV group']);
    const blocked = await run(c, b, { q: 'export csv', status: 'blocked' });
    assert.deepEqual(blocked.counts, { matchedPlans: 1, matchingTasks: 1 });
    assert.deepEqual(blocked.page.hits.map((h) => h.task?.id), ['T-blocked'], 'the plan-title match cannot admit its unrelated blocked task');
    const statusOnly = await run(c, b, { status: 'blocked' });
    assert.deepEqual(statusOnly.page.hits.map((h) => `${h.plan.id}:${h.task!.id}`), ['P-export:T-blocked', 'P-export:T-other', 'P-title:T-other']);
    const reordered = await run(c, b, { q: 'CSV  EXPORT csv' });
    assert.deepEqual(reordered.counts, { matchedPlans: 3, matchingTasks: 3 }, 'order, case and repeats do not matter');
    const none = await run(c, b, { q: 'export nothing' });
    assert.equal(none.page.hits.length, 0); assert.equal(none.exhausted, true); assert.equal(none.stop, null);
    const source = await run(c, b, { q: 'export csv', source: 'source-beta' });
    assert.deepEqual(source.page.hits.map((h) => h.plan.key), ['source-beta/P-export']);
    assert.ok(svc.log.every((l) => l.path === '/v1/search'), 'no detail, list or other reads per result');
  });
});

test('F2: project filter applies before presentation pagination; matches past plans 50/500/1000; ten windows per action; two pages kept', async () => {
  await withBackend(false, async (b, svc) => {
    seedSearchLibrary(b.f);
    const { c } = controller(svc);
    // Earlier textual match (plan 51) is in another project: it never takes a slot or a count.
    let v = await run(c, b, { q: 'Needle', project: 'p:alpha', labels: { project: 'Alpha' } });
    assert.equal(svc.count('/v1/search'), SEARCH_WINDOWS, 'one action issues at most ten windows');
    assert.equal(v.stop, 'paused', 'a work pause is not completion');
    assert.deepEqual(v.page.hits.map((h) => h.plan.id), [libraryId(501)]);
    assert.deepEqual(v.counts, { matchedPlans: 1, matchingTasks: 0 }, 'found so far, after the location choice');
    assert.equal(v.exhausted, false);
    v = await exhaust(c);
    assert.deepEqual(v.page.hits.map((h) => h.plan.id), [libraryId(501), libraryId(1001)]);
    assert.equal(v.exhausted, true);
    assert.deepEqual(v.counts, { matchedPlans: 2, matchingTasks: 0 });
    // A match only after plan 1,000 with no narrowing: the first action pauses with nothing yet.
    const before = svc.count('/v1/search');
    v = await run(c, b, { q: 'Needle-at-1001' });
    assert.equal(v.page.hits.length, 0); assert.equal(v.stop, 'paused'); assert.equal(v.more, true, 'Continue searching, never "No results"');
    assert.equal(svc.count('/v1/search') - before, SEARCH_WINDOWS);
    v = await exhaust(c);
    assert.deepEqual(v.page.hits.map((h) => h.plan.id), [libraryId(1001)]);
    // Dense matches: 350 in the chosen project; pages of 50; at most two retained pages.
    v = await run(c, b, { q: 'Dense match', project: 'p:alpha' });
    assert.equal(v.page.hits.length, SEARCH_PAGE);
    assert.ok(v.page.hits.every((h) => h.plan.directory === '/fixture/main'));
    const seen = new Set(v.page.hits.map((h) => h.plan.key));
    for (let i = 0; i < 20 && v.more; i++) {
      c.more(); await done(c); v = c.view()!;
      assert.ok(v.page.hits.length <= SEARCH_PAGE);
      for (const h of v.page.hits) { assert.equal(h.plan.directory, '/fixture/main'); assert.ok(!seen.has(h.plan.key), 'no plan repeats across pages'); seen.add(h.plan.key); }
    }
    assert.equal(v.exhausted, true);
    assert.deepEqual(v.counts, { matchedPlans: 350, matchingTasks: 350 });
    assert.equal(seen.size, 350);
    assert.equal(v.page.number, 7);
    assert.equal(v.hasPrevious, true);
    c.showPage(-1); assert.equal(c.view()!.page.number, 6); assert.equal(c.view()!.page.checked, false, 'a reused page is revalidated before it counts as checked');
    c.showPage(-1); assert.equal(c.view()!.page.number, 6, 'older pages are not retained');
  });
});

test('freshness: deletion beyond plan 500, archive with unchanged revision and restore generations; failures stay stale', async () => {
  await withBackend(false, async (b, svc) => {
    seedSearchLibrary(b.f);
    b.finish(libraryId(501));
    const { c } = controller(svc);
    await run(c, b, { q: 'Needle' }); let v = await exhaust(c);
    assert.deepEqual(v.page.hits.map((h) => h.plan.id), [libraryId(51), libraryId(501), libraryId(1001)]);
    assert.deepEqual(c.freshKeys().map((k) => k.plan), [libraryId(51), libraryId(501), libraryId(1001)]);
    const plain = { serviceRequest: svc.serviceRequest };
    assert.deepEqual(await c.revalidate(plain), { ok: true });
    assert.equal(c.view()!.stop, null, 'an unchanged poll changes nothing');
    // Same progress revision, new cleanup generation: archived out of Current.
    const revision = b.f.store.get(b.f.alpha.id, libraryId(501))!.revision;
    await b.act('archive', libraryId(501));
    assert.equal(b.f.store.get(b.f.alpha.id, libraryId(501))!.revision, revision);
    await c.revalidate(plain);
    v = c.view()!;
    assert.deepEqual(v.page.hits.map((h) => h.plan.id), [libraryId(51), libraryId(1001)]);
    assert.equal(v.removed, 1); assert.equal(v.stop, 'changed'); assert.equal(v.countsCurrent, false);
    const searches = svc.count('/v1/search');
    c.more(); await settle();
    assert.equal(svc.count('/v1/search'), searches, 'a changed traversal cannot continue');
    // Deleted beyond the ordinary 500-plan list prefix.
    await b.act('delete', libraryId(1001));
    await c.revalidate(plain);
    assert.deepEqual(c.view()!.page.hits.map((h) => h.plan.id), [libraryId(51)]);
    // Archive + restore between polls: still visible, new generation → qualified as changed.
    await b.act('archive', libraryId(51)); await b.act('restore', libraryId(51));
    await c.revalidate(plain);
    assert.equal(c.view()!.changedKeys, 1);
    assert.equal(c.view()!.page.groups[0].changed, true);
    // Archived mode: a restore moves the plan out.
    await run(c, b, { q: 'Needle', archived: true }); v = await exhaust(c);
    assert.deepEqual(v.page.hits.map((h) => h.plan.id), [libraryId(501)]);
    await b.act('restore', libraryId(501));
    await c.revalidate(plain);
    assert.equal(c.view()!.page.hits.length, 0);
    // A failed freshness read is stale, never "missing".
    await run(c, b, { q: 'Needle' });
    const failing = { serviceRequest: async () => ({ status: 503, body: '{"error":"busy"}' }) };
    const result = await c.revalidate(failing);
    assert.equal(result.ok, false);
    assert.ok(c.view()!.page.hits.length > 0, 'nothing removed on failure');
  });
});

test('retirement: held replies after new criteria, hidden and disposed frames; bounded overlap; no hidden continuation', async () => {
  await withBackend(false, async (b, svc) => {
    seedSearchLibrary(b.f);
    const h = controller(svc);
    const c = h.c;
    const release = svc.hold('/v1/search');
    c.submit('old', criteria({ q: 'Dense match' }), identity(b), workspace());
    await until(() => svc.count('/v1/search') === 1, 'held window sent');
    const release2 = svc.hold('/v1/search');
    c.submit('new', criteria({ q: 'Needle' }), identity(b), workspace());
    await until(() => svc.count('/v1/search') === 2, 'second window sent');
    c.submit('newest', criteria({ q: 'Needle-at-0051' }), identity(b), workspace());
    await settle();
    assert.equal(svc.count('/v1/search'), 2, 'a third read waits: one retired plus one current at most');
    release(); release2();
    await done(c);
    const v = c.view()!;
    assert.equal(c.key, 'newest');
    assert.deepEqual(v.page.hits.map((x) => x.plan.id), [libraryId(51)]);
    assert.deepEqual(v.counts, { matchedPlans: 1, matchingTasks: 0 }, 'retired windows never add counts');
    assert.ok(svc.peak <= 2);
    // Hidden: the in-flight action is retired; nothing more is requested until an explicit Continue.
    const hold = svc.hold('/v1/search');
    c.submit('hide', criteria({ q: 'Needle-at-1001' }), identity(b), workspace());
    await until(() => !!svc.log.at(-1)?.query?.q?.includes('1001'), 'window sent');
    const sent = svc.count('/v1/search');
    h.hide(); hold(); await settle();
    assert.equal(svc.count('/v1/search'), sent, 'zero continuations after hiding');
    assert.equal(c.view()!.stop, 'hidden'); assert.equal(c.view()!.windows, 0, 'the held window was not accepted');
    h.show(); c.more(); await done(c);
    assert.ok(svc.count('/v1/search') > sent, 'explicit Continue resumes from the last accepted window');
    // Disposed: a held reply cannot act; no further requests.
    const hold2 = svc.hold('/v1/search');
    c.submit('dispose', criteria({ q: 'Dense match' }), identity(b), workspace());
    await until(() => svc.count('/v1/search') > 0 && svc.log.at(-1)!.query?.q === 'Dense match', 'window sent');
    const total = svc.log.length;
    c.dispose(); hold2(); await settle();
    assert.equal(svc.log.length, total);
    assert.equal(c.view(), null);
    c.submit('after', criteria({ q: 'x' }), identity(b), workspace()); await settle();
    assert.equal(svc.log.length, total, 'a disposed controller starts nothing');
  });
});

test('pinned in-plan continuation conflict requires Refresh; deep context is abbreviated, not invented', async () => {
  await withBackend(false, async (b, svc) => {
    b.f.seedPlan('Z-large', 'Large plan', Array.from({ length: 1000 }, (_, n): ItemInput => ({ id: `T${n}`, title: 'Scale needle', kind: 'task', status: n % 2 ? 'working' : 'done' })));
    b.f.seedPlan('Z-deep', 'Deep plan', Array.from({ length: 1000 }, (_, n): ItemInput => ({ id: `G${n}`, title: n === 999 ? 'Deep needle' : `Level ${n}`, kind: n === 999 ? 'task' : 'group', ...(n ? { parentId: `G${n - 1}` } : {}) })));
    const { c } = controller(svc);
    let v = await run(c, b, { q: 'Scale needle' });
    assert.equal(v.page.hits.length, SEARCH_PAGE);
    assert.deepEqual(v.counts, { matchedPlans: 1, matchingTasks: 1000 }, 'the plan delta counts all its matches once');
    c.more(); await done(c); v = c.view()!;
    assert.equal(v.page.groups[0].continued, true, 'continued group is labelled');
    assert.deepEqual(v.counts, { matchedPlans: 1, matchingTasks: 1000 }, 'task continuation does not recount the plan');
    b.f.apply('Z-large', { op: 'change', changes: [{ id: 'T1', status: 'done' }] });
    c.more(); await done(c); v = c.view()!;
    assert.equal(v.stop, 'conflict'); assert.equal(v.countsCurrent, false);
    const sent = svc.count('/v1/search');
    c.more(); await settle();
    assert.equal(svc.count('/v1/search'), sent, 'no mixed continuation after a pinned conflict');
    v = await run(c, b, { q: 'Deep needle' });
    const hit = v.page.hits[0];
    assert.equal(hit.ancestors.length, 8); assert.equal(hit.omittedAncestors, 991);
    const crumb = breadcrumb(hit);
    assert.deepEqual(crumb.head.map((a) => a.title), ['Level 0']);
    assert.deepEqual(crumb.tail.map((a) => a.title), ['Level 997', 'Level 998']);
    assert.equal(crumb.omitted, 991 + 5);
    assert.equal(v.page.contextRows, 3);
  });
});

test('location membership: unchanged/unsettled snapshots keep a narrowed search; a real change retires it; unavailable choices never widen', async () => {
  await withBackend(true, async (b, svc) => {
    const { c } = controller(svc);
    let v = await run(c, b, { q: 'export csv', project: 'p:alpha' });
    assert.deepEqual(v.counts, { matchedPlans: 3, matchingTasks: 3 });
    c.membership({ ...workspace(), projectsState: 'loading', projects: [] });
    c.membership(workspace());
    assert.equal(c.view()!.stop, null, 'a host A/B/null restart that settles unchanged keeps the search');
    c.membership(workspace({ projects: [{ id: 'alpha', name: 'Alpha', directory: '/fixture/elsewhere' }, { id: 'other', name: 'Other', directory: '/fixture/other' }] }));
    v = c.view()!;
    assert.equal(v.stop, 'membership'); assert.equal(v.countsCurrent, false);
    assert.match(v.status.text, /Refresh search/);
    const sent = svc.count('/v1/search');
    v = await run(c, b, { q: 'export csv', project: 'p:gone', labels: { project: 'Gone' } });
    assert.equal(v.blocked, 'missing'); assert.equal(v.phase, 'blocked');
    assert.equal(svc.count('/v1/search'), sent, 'a removed project choice runs nothing and is not widened');
    v = await run(c, b, { q: 'export csv', project: 'p:alpha' }, { ...workspace(), projectsState: 'loading', projects: [] });
    assert.equal(v.blocked, 'loading');
    // Sessions classify only the plans they own: a new unrelated session in the chosen project keeps
    // the search; the owner of a seen candidate appearing elsewhere would reclassify it, so it retires.
    const session = (id: string, projectId: string, directory: string) => ({ id, title: 'Synthetic session', projectId, directory, parentId: null, archivedAt: null, worktree: null, activity: 'idle' as const, outcome: null });
    v = await run(c, b, { q: 'export csv', project: 'p:alpha' });
    c.membership(workspace({ sessions: new Map([['alpha', { state: 'ready', records: [session('unrelated-new', 'alpha', '/fixture/main')] }]]) }));
    assert.equal(c.view()!.stop, null, 'routine session creation unrelated to seen candidates is not a membership change');
    c.membership(workspace({ sessions: new Map([['alpha', { state: 'ready', records: [session('unrelated-new', 'alpha', '/fixture/main'), session('another', 'alpha', '/fixture/main/sub')] }]]) }));
    assert.equal(c.view()!.stop, null);
    c.membership(workspace({ sessions: new Map([['other', { state: 'ready', records: [session('M', 'other', '/fixture/other')] }]]) }));
    assert.equal(c.view()!.stop, 'membership', 'the owner session of seen plans now places them elsewhere');
    assert.equal(c.view()!.countsCurrent, false, 'accumulated counts are never silently reclassified');
    // A narrowed worktree removed later: the run retires; a fresh/retried search is blocked, not widened.
    b.f.seedPlan('P-wt', 'Export CSV worktree', [{ id: 'W1', title: 'Export CSV in worktree', kind: 'task', status: 'pending' }], { ...b.f.actor, directory: '/fixture/wt-a' });
    const withTree = workspace({ worktrees: new Map([['alpha', { state: 'ready', records: [{ directory: '/fixture/wt-a', name: 'wt-a', branch: 'wt-a', status: 'ready' as const }] }]]) });
    const emptyTree = workspace({ worktrees: new Map([['alpha', { state: 'ready', records: [] }]]) });
    v = await run(c, b, { q: 'export csv', project: 'p:alpha', worktree: 'w:/fixture/wt-a' }, withTree);
    assert.deepEqual(v.page.hits.map((h) => h.plan.id), ['P-wt'], 'only the chosen worktree');
    c.membership(emptyTree);
    assert.equal(c.view()!.stop, 'membership', 'removing the chosen worktree retires the run');
    const sentBefore = svc.count('/v1/search');
    v = await run(c, b, { q: 'export csv', project: 'p:alpha', worktree: 'w:/fixture/wt-a', labels: { project: 'Alpha', worktree: 'wt-a' } }, emptyTree);
    assert.equal(v.blocked, 'missing'); assert.deepEqual(v.blockedParts, ['worktree'], 'the project stays available; only the worktree chip is unavailable');
    assert.equal(svc.count('/v1/search'), sentBefore, 'a removed worktree runs nothing and is not widened');
    v = await run(c, b, { q: 'export csv', project: 'p:alpha', worktree: 'w:/fixture/wt-a' }, workspace({ worktrees: new Map([['alpha', { state: 'loading', records: [] }]]) }));
    assert.equal(v.blocked, 'loading', 'pending discovery stays distinct from proven absence');
    // Unnarrowed searches ignore location changes entirely.
    v = await run(c, b, { q: 'export csv' });
    c.membership(workspace({ projects: [] }));
    assert.equal(c.view()!.stop, null);
  });
});

test('coverage: a skipped unreadable record is disclosed as a gap, never a complete result (fault injection)', async () => {
  await withBackend(true, async (b, svc) => {
    // Labelled fault injection: a corrupt snapshot body in one row.
    b.f.store.db.prepare("UPDATE plans SET snapshot=json_set(snapshot,'$.items',json('[{}]')) WHERE source=? AND id=?").run(b.f.alpha.id, 'P-empty');
    const { c } = controller(svc);
    const v = await run(c, b, { q: 'export csv' });
    assert.equal(v.exhausted, true);
    assert.equal(v.coverage.gapped, true);
    assert.ok(v.coverage.skippedRecords >= 1);
    assert.deepEqual(v.coverage.reasons, ['invalid-snapshot']);
    assert.deepEqual(v.counts, { matchedPlans: 3, matchingTasks: 3 });
  });
});

test('J1-B2: a foreign-source plan is classified by its recorded location, never by a colliding live session ID', async () => {
  await withBackend(true, async (b, svc) => {
    const { c } = controller(svc);
    // Live session "M" is in project Other. source-alpha (the verified binding) owns plans as "M";
    // source-beta's same-ID "M" is another setup's session and must not borrow that live placement.
    const live = workspace({ sessions: new Map([['other', { state: 'ready', records: [{ id: 'M', title: 'Local session', projectId: 'other', directory: '/fixture/other', parentId: null, archivedAt: null, worktree: null, activity: 'idle', outcome: null }] }]]) });
    let v = await run(c, b, { q: 'export csv', project: 'p:alpha' }, live);
    assert.deepEqual(v.page.hits.map((h) => h.plan.key), ['source-beta/P-export'], 'the foreign plan stays in its recorded project Alpha');
    assert.deepEqual(v.counts, { matchedPlans: 1, matchingTasks: 1 });
    v = await run(c, b, { q: 'export csv', project: 'p:other' }, live);
    assert.deepEqual([...new Set(v.page.hits.map((h) => h.plan.key))], ['source-alpha/P-export', 'source-alpha/P-title'], 'only verified-source plans follow their live owner session');
    assert.deepEqual(v.counts, { matchedPlans: 2, matchingTasks: 2 });
  });
});

test('J1-B2: the ordinary board applies the same verified-source placement rule to grouping, filters and session labels', () => {
  const plan = (sourceId: string, id: string, owner: string) => ({ key: `${sourceId}/${id}`, id, sourceId, ownerSessionId: owner, directory: '/fixture/main', lifecycle: 'active', reportedAt: '2026-01-01T00:00:00Z' }) as unknown as PlanView;
  const live = workspace({ sessions: new Map([['other', { state: 'ready', records: [{ id: 'M', title: 'Local session', projectId: 'other', directory: '/fixture/other', parentId: null, archivedAt: null, worktree: null, activity: 'idle', outcome: null }, { id: 'X', title: 'Foreign twin', projectId: 'other', directory: '/fixture/other', parentId: null, archivedAt: null, worktree: null, activity: 'idle', outcome: null }] }]]) });
  const plans = [plan('source-alpha', 'P-local', 'M'), plan('source-beta', 'P-foreign', 'X')];
  assert.deepEqual(applyFilters(plans, live, { project: 'p:alpha', worktree: ALL, session: ALL }, 'source-alpha').map((p) => p.id), ['P-foreign'], 'foreign plan by recorded location');
  assert.deepEqual(applyFilters(plans, live, { project: 'p:other', worktree: ALL, session: ALL }, 'source-alpha').map((p) => p.id), ['P-local'], 'verified plan by its live owner session');
  assert.equal(placeOf(plans[1], live, null).projectKey, 'p:alpha', 'an unverified binding trusts no plan');
  const o = filterOptions(plans, live, { project: ALL, worktree: ALL, session: ALL }, plans, 'source-alpha');
  assert.equal(o.sessions.find((x) => x.id === 'M')?.label, 'Local session');
  assert.notEqual(o.sessions.find((x) => x.id === 'X')?.label, 'Foreign twin', 'a foreign owner never borrows a host session title');
});

test('J1-B3: an idle search hidden during a two-batch freshness read sends no second batch and accepts nothing', async () => {
  await withBackend(false, async (b, svc) => {
    seedSearchLibrary(b.f);
    const h = controller(svc);
    const c = h.c;
    await run(c, b, { q: 'Dense match' });
    c.more(); await done(c);
    const offPage = c.view()!.page.hits[0].plan.key;
    c.select(offPage);
    c.showPage(-1);
    assert.equal(c.freshKeys().length, 51, 'off-page selection plus 50 displayed keys: two batches');
    assert.equal(c.view()!.busy, false, 'the search action is idle');
    const release = svc.hold('/v1/search-state');
    const reading = c.revalidate({ serviceRequest: svc.serviceRequest });
    await until(() => svc.count('/v1/search-state') === 1, 'first batch sent');
    h.hide();
    release();
    const result = await reading;
    await settle();
    assert.equal(svc.count('/v1/search-state'), 1, 'no second batch while hidden');
    assert.equal(c.view()!.page.checked, false, 'the retired batch was not accepted');
    assert.deepEqual(result, { ok: true }, 'a retired freshness read is neither a failure nor a change');
    h.show();
    await c.revalidate({ serviceRequest: svc.serviceRequest });
    assert.equal(svc.count('/v1/search-state'), 3, 'visible again: the next poll reads both batches');
    assert.equal(c.view()!.page.checked, true);
  });
});
