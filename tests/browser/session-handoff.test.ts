import test from 'node:test';
import assert from 'node:assert/strict';
import type { GuestActionItem, GuestRequest, GuestRequestResult, HostReadyContext, HostClient } from '@openchamber/sdk';
import { registerSessionActions, SESSION_ACTIONS } from '../../background/session-actions.ts';
import { HEALTH, SRC, OTHER_SRC, summary, planPage, plansPage, at } from './fixtures.ts';
import type { Item, PlanSummary } from '../../shared/progress.ts';
import { markdownLiteral } from '../../shared/summary.ts';

const items: Item[] = [{ id: 'task', title: 'Reported task', kind: 'task', status: 'working' }];
const active = summary('active', items, { sessionId: 'clicked', reportedAt: at(1) });
const finishedItems: Item[] = [{ id: 'done', title: 'Finished task', kind: 'task', status: 'done' }];
const finished = summary('finished', finishedItems, { sessionId: 'clicked', lifecycle: 'finished', reportedAt: at(10) });
const response = (value: unknown, status = 200): GuestRequestResult => ({ status, body: JSON.stringify(value) });
const action = (id: string = SESSION_ACTIONS.handoff): GuestActionItem => ({ kind: 'session', action: id, sessionId: 'clicked', sessionTitle: 'Source session', directory: '/fixture/Alpha' });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }

function fixture() {
  let handler!: (item: GuestActionItem) => void | Promise<void>;
  let ready!: (ctx: HostReadyContext) => void;
  let connection!: (ctx: HostReadyContext['connection']) => void;
  let rows = [active];
  let saved: unknown;
  let locale = 'en', language: unknown;
  let device = false, clock = 0;
  let currentChat = 'destination';
  const drafts = new Map([['destination', 'Keep this draft'], ['new-chat', 'Another draft']]);
  const requests: GuestRequest[] = [], storage: { key: string; scope?: string }[] = [];
  const toasts: { kind?: string; message: string }[] = [], composed: { text: string; mode?: string }[] = [];
  let health: unknown = { ...HEALTH, planCleanup: 1, planComposerHandoff: 1 };
  let get = async (key: string, options?: { scope: string }): Promise<any> => {
    storage.push({ key, scope: options?.scope });
    return key === 'interface-language.v1' ? language : saved;
  };
  let request = async (q: GuestRequest): Promise<GuestRequestResult> => {
    if (q.path === '/health') return response(health);
    if (q.path === '/v1/plans') return response(plansPage(rows));
    if (q.path === '/v1/plan') {
      const row = rows.find(p => p.sourceId === q.query?.source && p.id === q.query?.plan);
      return row ? response(planPage(row, row.id === 'finished' ? finishedItems : items, [])) : response({ error: 'not-found' }, 404);
    }
    throw Error('Unexpected route');
  };
  let compose = async (value: { text: string; mode?: string }) => {
    composed.push(value);
    assert.equal(value.mode, 'append');
    drafts.set(currentChat, `${drafts.get(currentChat) ?? ''}\n\n${value.text}`);
  };
  let toast = async (value: { message: string; kind?: string }) => { toasts.push(value); };
  const forbidden = () => { throw Error('Forbidden side effect'); };
  const host = {
    onAction(fn: typeof handler) { assert.equal(ready, undefined, 'register action before readiness'); handler = fn; return () => {}; },
    onReady(fn: typeof ready) { ready = fn; return () => {}; },
    onConnection(fn: typeof connection) { connection = fn; return () => {}; },
    storage: { get: (key: string, options?: { scope: string }) => get(key, options), set: forbidden, delete: forbidden },
    serviceRequest(q: GuestRequest) { requests.push(q); return request(q); },
    compose: (value: { text: string; mode?: string }) => compose(value),
    toast: (value: { message: string; kind?: string }) => toast(value),
    prompt: forbidden, writeClipboard: forbidden, openSession: forbidden, openSurface: forbidden,
  } as unknown as HostClient;
  const retire = registerSessionActions(host, () => clock);
  const readyContext = () => ({ surface: 'background', locale, features: { deviceStorage: device }, session: { id: 'not-the-clicked-session' }, connection: { connected: false, account: '' } } as HostReadyContext);
  return {
    host, requests, storage, toasts, composed, drafts, retire,
    ready: () => ready(readyContext()), run: async (item = action()) => { ready(readyContext()); await handler(item); },
    invoke: (item = action()) => handler(item), connection: () => connection({ connected: true, account: 'other' }),
    replacement: () => ready({ ...readyContext(), connection: { connected: true, account: 'other' } }),
    setRows: (value: PlanSummary[]) => { rows = value; }, setSaved: (value: unknown) => { saved = value; },
    setLanguage: (value: unknown, hostLocale = 'en', supported = true) => { language = value; locale = hostLocale; device = supported; },
    setHealth: (value: unknown) => { health = value; }, advance: () => { clock = 18_001; },
    switchChat: () => { currentChat = 'new-chat'; },
    intercept: (fn: (q: GuestRequest, next: () => Promise<GuestRequestResult>) => Promise<GuestRequestResult>) => { const next = request; request = q => fn(q, () => next(q)); },
    interceptStorage: (fn: (key: string, next: () => Promise<any>) => Promise<any>) => { const next = get; get = (key, options) => fn(key, () => next(key, options)); },
    interceptCompose: (fn: (next: () => Promise<void>) => Promise<void>) => { const next = compose; compose = value => fn(() => next(value)); },
    interceptToast: (fn: (next: () => Promise<void>) => Promise<void>) => { const next = toast; toast = value => fn(() => next(value)); },
  };
}

test('both actions use the clicked session, append once to the active draft, await feedback and do no other work', async () => {
  for (const id of Object.values(SESSION_ACTIONS)) {
    const f = fixture();
    await f.run(action(id));
    assert.equal(f.composed.length, 1);
    assert.match(f.composed[0].text, /Reported progress, not verified completion/);
    assert.equal(f.composed[0].text.includes('Origin session: clicked'), id === SESSION_ACTIONS.handoff);
    assert.ok(f.composed[0].text.includes(markdownLiteral(`${SRC}/active`)));
    assert.ok(f.drafts.get('destination')!.startsWith('Keep this draft\n\n'));
    assert.deepEqual(f.toasts.map(t => t.message), ['Added to the active chat. Review before sending.']);
    assert.deepEqual(f.storage, [{ key: 'rail-plan:clicked', scope: undefined }]);
    assert.deepEqual(f.requests.map(q => q.path), ['/health', '/v1/plans', '/v1/plan']);
    assert.equal(f.requests[1].query?.session, 'clicked');
    assert.equal(f.requests[1].query?.directory, undefined);
    await f.invoke();
    assert.equal(f.composed.length, 1, 'frame handles at most one invocation');
    f.retire();
  }
});

test('starting and refused services admit once before checking composer capability', async () => {
  for (const state of ['starting', 'refused']) {
    const f = fixture(); let admitted = false;
    f.intercept(async (q, next) => {
      if (q.path === '/v1/setup') { admitted = true; return response({}); }
      if (q.path === '/health' && !admitted) return response({ ...HEALTH, state, ready: false });
      return next();
    });
    await f.run();
    assert.equal(f.composed.length, 1);
    assert.deepEqual(f.requests.map(q => q.path), ['/health', '/v1/setup', '/health', '/v1/plans', '/v1/plan']);
    f.retire();
  }
});

test('a valid saved finished choice wins; stale and missing choices use the automatic featured rule', async () => {
  for (const saved of [`${SRC}/finished`, `${SRC}/removed`, undefined]) {
    const f = fixture(); f.setRows([finished, active]); f.setSaved(saved);
    await f.run();
    const chosen = saved === `${SRC}/finished` ? 'finished' : 'active';
    assert.equal(f.requests.at(-1)?.query?.plan, chosen);
    assert.ok(f.composed[0].text.includes(markdownLiteral(`${SRC}/${chosen}`)));
    assert.match(f.composed[0].text, /1 other plan.*only this plan is included/);
    assert.ok(f.composed[0].text.length <= 16_000);
    f.retire();
  }
});

test('fallback keeps owned-first scoped ordering when no active plan reports working', async () => {
  const f = fixture();
  const helping = summary('helping', [], { sessionId: 'another', reportedAt: at(0) });
  const owned = summary('owned', [], { sessionId: 'clicked', reportedAt: at(9) });
  f.setRows([helping, owned]);
  f.intercept(async (q, next) => q.path === '/v1/plan' ? response(planPage(owned, [], [])) : next());
  await f.run();
  assert.equal(f.requests.at(-1)?.query?.plan, 'owned');
  assert.equal(f.composed.length, 1);
});

test('multiple-plan context is inside the composer bound even when a whole long task row is omitted', async () => {
  const f = fixture(); f.setRows([active, finished]);
  f.intercept(async (q, next) => q.path === '/v1/plan'
    ? response(planPage(active, [{ ...items[0], title: 'Long recorded task '.repeat(1_000) }], [])) : next());
  await f.run();
  assert.equal(f.composed.length, 1);
  const text = f.composed[0].text;
  assert.ok(text.length <= 16_000);
  assert.match(text, /1 other plans reported for this session; only this plan is included/);
  assert.match(text, /1 tasks omitted from these sections/);
  assert.ok(!text.includes('Long recorded task'), 'no sliced task row');
});

test('complete empty list alone gives no-plan; failed, partial, unsupported and unverified reads never do', async () => {
  const empty = fixture(); empty.setRows([]); await empty.run();
  assert.deepEqual(empty.toasts.map(t => t.message), ['No plan reported for this session']);
  assert.equal(empty.composed.length, 0);
  for (const scenario of ['list-error', 'health-error', 'unconfigured', 'old-service', 'truncated', 'unbound', 'unverified-record', 'collision', 'archived']) {
    const f = fixture();
    if (scenario === 'unconfigured') f.setHealth({ ...HEALTH, ready: false });
    if (scenario === 'old-service') f.setHealth(HEALTH);
    if (scenario === 'list-error' || scenario === 'health-error') f.intercept(async (q, next) => q.path === (scenario === 'list-error' ? '/v1/plans' : '/health') ? response({ error: 'busy' }, 503) : next());
    if (scenario === 'truncated') f.intercept(async (q, next) => q.path === '/v1/plans' ? response(plansPage([active], 'more')) : next());
    if (scenario === 'unbound') f.intercept(async (q, next) => q.path === '/v1/plans' ? response(plansPage([], null, { sourceBinding: { sourceId: SRC, verified: false } })) : next());
    if (scenario === 'unverified-record') f.intercept(async (q, next) => q.path === '/v1/plans' ? response(plansPage([active], null, { sources: [{ id: SRC, verified: false }] })) : next());
    if (scenario === 'collision') f.setRows([{ ...active, sourceId: OTHER_SRC }]);
    if (scenario === 'archived') f.setRows([{ ...active, cleanup: { state: 'archived', revision: 1 } }]);
    await f.run();
    assert.equal(f.composed.length, 0, scenario);
    assert.equal(f.toasts.length, 1, scenario);
    assert.notEqual(f.toasts[0].message, 'No plan reported for this session', scenario);
    if (scenario === 'old-service') assert.match(f.toasts[0].message, /does not support/);
    if (scenario === 'collision') assert.match(f.toasts[0].message, /could not be verified/);
    assert.ok(!f.requests.some(q => q.path === '/v1/plan'), scenario);
    f.retire();
  }
});

test('failed or malformed saved preference refuses instead of silently choosing another plan', async () => {
  for (const value of [null, {}, 17, 'throw']) {
    const f = fixture(); f.setSaved(value);
    if (value === 'throw') f.interceptStorage(async () => { throw Error('private diagnostic'); });
    await f.run();
    assert.equal(f.composed.length, 0);
    assert.deepEqual(f.toasts.map(t => t.message), ['The saved plan choice could not be read. No text was added.']);
    assert.equal(f.requests.length, 0);
  }
});

test('detail errors, removed/archived selections and changed store/binding/verification refuse complete summary', async () => {
  for (const scenario of ['error', 'removed', 'archived', 'cleanup', 'store', 'binding', 'source', 'wrong-plan', 'null-formatter', 'continuation-error', 'revision-churn']) {
    const f = fixture();
    f.intercept(async (q, next) => {
      if (q.path !== '/v1/plan') return next();
      if (scenario === 'error') throw Error('private detail diagnostic');
      if (scenario === 'removed') return response({ error: 'not-found' }, 404);
      const row = { ...active };
      if (scenario === 'archived') row.cleanup = { state: 'archived', revision: 1 };
      if (scenario === 'cleanup') row.cleanup = { state: 'visible', revision: 1 };
      if (scenario === 'wrong-plan') row.id = 'other';
      if (scenario === 'null-formatter') row.title = 'x'.repeat(17_000);
      if (scenario === 'revision-churn' && q.query?.cursor) row.revision++;
      const page = planPage(row, items, [], { items: ['continuation-error', 'revision-churn'].includes(scenario) ? 'next' : null, contributions: null });
      if (scenario === 'store') page.storeId = 'replacement';
      if (scenario === 'binding') page.sourceBinding = { sourceId: OTHER_SRC, verified: true };
      if (scenario === 'source') page.sources = [{ id: SRC, configRoot: '/cfg', dataRoot: '/data', verified: false }];
      if (scenario === 'continuation-error' && q.query?.cursor) return response({ error: 'busy' }, 503);
      return response(page);
    });
    await f.run();
    assert.equal(f.composed.length, 0, scenario);
    assert.deepEqual(f.toasts.map(t => t.message), ['Complete progress could not be read. No text was added.'], scenario);
    f.retire();
  }
});

test('list continuations cannot cross store, binding or recorded verification identities', async () => {
  for (const scenario of ['store', 'binding', 'verification']) {
    const f = fixture();
    f.intercept(async (q, next) => {
      if (q.path !== '/v1/plans') return next();
      const page = plansPage([active], q.query?.cursor ? null : 'next');
      if (q.query?.cursor) {
        if (scenario === 'store') page.storeId = 'replacement';
        if (scenario === 'binding') page.sourceBinding.sourceId = OTHER_SRC;
        if (scenario === 'verification') page.sources[0].verified = false;
      }
      return response(page);
    });
    await f.run();
    assert.equal(f.composed.length, 0, scenario);
    assert.equal(f.toasts.length, 1);
  }
});

test('permission failures have plain feedback, never raw diagnostics or an empty-plan claim', async () => {
  for (const stage of ['storage', 'health', 'list', 'detail']) {
    const f = fixture();
    const denied = () => { throw Object.assign(Error('private permission diagnostic'), { code: 'NOT_GRANTED' }); };
    if (stage === 'storage') f.interceptStorage(async () => denied());
    else f.intercept(async (q, next) => q.path === ({ health: '/health', list: '/v1/plans', detail: '/v1/plan' }[stage]) ? denied() : next());
    await f.run();
    assert.deepEqual(f.toasts.map(t => t.message), ['Access to Agent progress was denied. Check the extension permissions.']);
    assert.equal(f.composed.length, 0);
  }
});

test('effective language is read once in device scope, with host/English fallback and no writes', async () => {
  for (const [value, locale, supported, russian] of [
    [{ v: 1, preference: 'ru' }, 'en', true, true],
    [{ v: 1, preference: 'en' }, 'ru-RU', true, false],
    [undefined, 'ru-RU', true, true],
    [null, 'ru-RU', true, true],
    ['throw', 'ru-RU', true, true],
    [{ v: 1, preference: 'ru' }, 'de-DE', false, false],
    [undefined, 'bad_locale', true, false],
  ] as const) {
    const f = fixture(); f.setLanguage(value, locale, supported);
    if (value === 'throw') f.interceptStorage(async (key, next) => { if (key === 'interface-language.v1') throw Error('private preference error'); return next(); });
    await f.run(action(SESSION_ACTIONS.progress));
    assert.equal(f.composed.length, 1);
    assert.match(f.toasts[0].message, russian ? /текущий чат/ : /active chat/);
    assert.match(f.composed[0].text, russian ? /Прогресс/ : /Progress/);
    assert.ok(f.composed[0].text.includes('Reported task'), 'recorded titles are not translated');
    assert.deepEqual(f.storage.filter(s => s.key === 'interface-language.v1'), supported && value !== 'throw' ? [{ key: 'interface-language.v1', scope: 'device' }] : []);
  }
});

test('a chat switch while preparing changes only the destination, not the clicked-session source', async () => {
  const f = fixture(), held = deferred<GuestRequestResult>();
  const entered = deferred<void>();
  f.intercept(async (q, next) => { if (q.path === '/v1/plan') { entered.resolve(); return held.promise; } return next(); });
  const running = f.run(); await entered.promise;
  f.switchChat(); held.resolve(response(planPage(active, items, []))); await running;
  assert.equal(f.drafts.get('destination'), 'Keep this draft');
  assert.ok(f.drafts.get('new-chat')!.startsWith('Another draft\n\n'));
  assert.equal(f.requests.find(q => q.path === '/v1/plans')?.query?.session, 'clicked');
  assert.match(f.toasts[0].message, /active chat.*Review/);
});

test('retirement during pending storage/list/detail prevents continuation, compose and success', async () => {
  for (const stage of ['language', 'preference', 'health', 'list', 'detail', 'continuation']) {
    for (const retirement of ['dispose', 'connection', 'ready']) {
      const f = fixture(), entered = deferred<void>(), held = deferred<void>();
      if (stage === 'language') f.setLanguage(undefined);
      f.interceptStorage(async (key, next) => {
        if (key === (stage === 'language' ? 'interface-language.v1' : stage === 'preference' ? 'rail-plan:clicked' : 'unused')) { entered.resolve(); await held.promise; }
        return next();
      });
      f.intercept(async (q, next) => {
        const path = { health: '/health', list: '/v1/plans', detail: '/v1/plan', continuation: '/v1/plan' }[stage];
        if (q.path === path && (stage !== 'continuation' || q.query?.cursor)) { entered.resolve(); await held.promise; }
        if (stage === 'detail' || stage === 'continuation') {
          if (q.path === '/v1/plan') return response(planPage(active, items, [], { items: 'more', contributions: null }));
        }
        return next();
      });
      const running = f.run(); await entered.promise;
      if (retirement === 'dispose') f.retire(); else if (retirement === 'connection') f.connection(); else f.replacement();
      const count = f.requests.length; held.resolve(); await running;
      assert.equal(f.requests.length, count, `${stage}/${retirement}`);
      assert.equal(f.composed.length, 0, `${stage}/${retirement}`);
      assert.equal(f.toasts.length, 0, `${stage}/${retirement}`);
    }
  }
});

test('lost compose acknowledgement is never retried or called success; retirement cannot claim success', async () => {
  for (const outcome of ['lost-ack', 'retired']) {
    const f = fixture();
    f.interceptCompose(async next => { await next(); if (outcome === 'retired') f.retire(); else throw Error('private compose error'); });
    await f.run();
    assert.equal(f.composed.length, 1);
    assert.deepEqual(f.toasts.map(t => t.message), outcome === 'retired' ? [] : ['The host did not confirm the insertion. Check the active chat before trying again.']);
  }
});

test('handler waits for readiness and rejects non-session targets without reading progress', async () => {
  const f = fixture(); const running = f.invoke({ kind: 'message', action: SESSION_ACTIONS.handoff, sessionId: 'clicked', sessionTitle: 'Source', directory: null, messageId: 'message', text: 'not requested', role: 'assistant' });
  assert.equal(f.requests.length, 0); f.ready(); await running;
  assert.equal(f.requests.length, 0); assert.equal(f.composed.length, 0);
  assert.match(f.toasts[0].message, /requires a session/);
});

test('handler awaits compose and plain feedback, and toast failure never retries insertion or leaks diagnostics', async () => {
  const f = fixture(), composing = deferred<void>(), composed = deferred<void>(), showing = deferred<void>(), shown = deferred<void>();
  f.interceptCompose(async next => { composing.resolve(); await composed.promise; await next(); });
  f.interceptToast(async next => { showing.resolve(); await shown.promise; await next(); });
  let done = false;
  const running = f.run().then(() => { done = true; });
  await composing.promise; assert.equal(done, false); assert.equal(f.toasts.length, 0);
  composed.resolve(); await showing.promise; assert.equal(done, false);
  shown.resolve(); await running; assert.equal(done, true);
  const failing = fixture();
  failing.interceptToast(async () => { throw Error('private toast diagnostic'); });
  await assert.rejects(failing.run(), { message: 'Added to the active chat. Review before sending.' });
  assert.equal(failing.composed.length, 1);
});

test('a deadline reached during a read refuses without continuing or composing', async () => {
  const f = fixture();
  f.intercept(async (q, next) => {
    const reply = await next();
    if (q.path === '/v1/plans') f.advance();
    return reply;
  });
  await f.run();
  assert.equal(f.composed.length, 0);
  assert.deepEqual(f.requests.map(q => q.path), ['/health', '/v1/plans']);
  assert.deepEqual(f.toasts.map(t => t.message), ['Preparing the summary took too long. No text was added.']);
});

test('all matching pages complete before compose; recorded-source withdrawal during detail refuses', async () => {
  for (const withdraw of [false, true]) {
    const f = fixture(); f.setRows([active, finished]);
    f.intercept(async (q, next) => {
      if (q.path === '/v1/plans') return response(plansPage(q.query?.cursor ? [finished] : [active], q.query?.cursor ? null : 'list-next'));
      if (q.path === '/v1/plan') {
        const page = planPage(active, q.query?.cursor ? [] : items, [], { items: q.query?.cursor ? null : 'detail-next', contributions: null });
        if (withdraw && q.query?.cursor) page.sources[0].verified = false;
        assert.equal(f.composed.length, 0);
        return response(page);
      }
      return next();
    });
    await f.run();
    assert.equal(f.requests.filter(q => q.path === '/v1/plans').length, 2);
    assert.equal(f.requests.filter(q => q.path === '/v1/plan').length, 2);
    assert.equal(f.composed.length, withdraw ? 0 : 1);
    if (!withdraw) assert.match(f.composed[0].text, /1 other plans reported/);
  }
});
