/** Direct disposable binding, never an installer. Fake host + real production plugin/Store. */
import { test, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Effect, DateTime, Stream } from 'effect';
import { fromPromise } from '@opencode/plugin/promise/adapter';
import plugin from '../../plugin/index.ts';
import { registerActivation, ACTIVATION_GUIDANCE as BASE, ACTIVATION_HINT as HINT } from '../../plugin/activation.ts';
import { Store } from '../../shared/store.ts';
import { activationContext as context, writeEvent } from '../fixtures/activation-production.ts';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(r => { resolve = r; });
  return { promise, resolve };
}
async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Synthetic fixture wait timed out')), 3000); })]); }
  finally { clearTimeout(timer); }
}
const parts = (c: any) => c.system.filter((p: any) => p.text?.startsWith('# Agent progress (companion)'));
const capsule = (c: any): string => parts(c)[0]?.text.split('\n\n## Progress resume')[1] ? `## Progress resume${parts(c)[0].text.split('\n\n## Progress resume')[1]}` : '';
const samples: Record<string, string> = {};
after(() => {
  if (process.env.RESUME_LIFECYCLE_EVIDENCE) fs.writeFileSync(process.env.RESUME_LIFECYCLE_EVIDENCE, JSON.stringify({ syntheticDataOnly: true, layer: 'unit/installed-adapter; not native outgoing proof', samples }, null, 2) + '\n');
});

class Events implements AsyncIterable<any> {
  private queue: Array<{ value: any; done: ReturnType<typeof deferred> }> = [];
  private wake = deferred();
  closed = false;
  private previous: ReturnType<typeof deferred> | undefined;
  push(value: any) { const done = deferred(); this.queue.push({ value, done }); this.wake.resolve(); return done.promise; }
  close() { this.closed = true; this.previous?.resolve(); for (const e of this.queue) e.done.resolve(); this.wake.resolve(); }
  [Symbol.asyncIterator]() { return {
    next: async (): Promise<IteratorResult<any>> => {
      this.previous?.resolve(); this.previous = undefined;
      while (!this.queue.length && !this.closed) { await this.wake.promise; this.wake = deferred(); }
      if (this.closed) return { done: true, value: undefined };
      const e = this.queue.shift()!; this.previous = e.done;
      return { done: false, value: e.value };
    },
    return: async (): Promise<IteratorResult<any>> => { this.close(); return { done: true, value: undefined }; },
  }; }
}

async function fixture(run: (f: any) => Promise<void>, options: { adapter?: boolean; unsupported?: 'subscribe' | 'hook' | 'stream' } = {}) {
  const root = fs.mkdtempSync('/tmp/opencode/progress-resume-unit-');
  for (const dir of ['config/opencode', 'data/opencode', 'store', 'project']) fs.mkdirSync(`${root}/${dir}`, { recursive: true, mode: 0o700 });
  const source = { id: 'source-fixture', configRoot: `${root}/config/opencode`, dataRoot: `${root}/data/opencode`, verified: true };
  const store = new Store(`${root}/store/progress.sqlite`, { create: true }); store.registerSource(source); store.bindReads(source.id, true);
  const binding = { protocolVersion: 2, schemaVersion: 2, installId: 'synthetic-install', version: '0.0.0', database: store.file, storeId: String(store.db.prepare('SELECT store_id FROM meta').get()!.store_id), source };
  const file = `${root}/binding.json`; fs.writeFileSync(file, JSON.stringify(binding), { mode: 0o600 });
  const saved = new Map<string, string | undefined>();
  for (const [k, v] of Object.entries({ AGENT_PROGRESS_BINDING: file, XDG_CONFIG_HOME: `${root}/config`, XDG_DATA_HOME: `${root}/data`, OPENCODE_DB: undefined, OPENCODE_CONFIG_DIR: undefined })) { saved.set(k, process.env[k]); if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  const hooks = new Map<string, any>(), tools = new Map<string, any>();
  const events = new Events();
  const streams = new Set<Events>();
  const subscribe = (signal?: AbortSignal) => {
    const stream = streams.size ? new Events() : events;
    streams.add(stream);
    signal?.addEventListener('abort', () => stream.close(), { once: true });
    return stream;
  };
  const callbacks = new Map<string,Set<any>>();
  function installHook(key: string, callback: any) {
    const set=callbacks.get(key)??new Set<any>();callbacks.set(key,set);set.add(callback);
    hooks.set(key, async(event:any)=>{for(const cb of set)await cb(event);});
    return ()=>{set.delete(callback);if(!set.size){callbacks.delete(key);hooks.delete(key);}};
  }
  let dispose: (() => Promise<void>) | undefined;
  let clock = 1_800_000_000_000, sequence = 0, reads = 0, gets = 0;
  const wallClock = mock.method(Date, 'now', () => clock);
  const info = (id: string): any => ({ id, agent: 'synthetic', projectID: 'fixture', location: { directory: `${root}/project` }, parentID: id === 'ses_C' || id === 'ses_sibling' ? 'ses_M' : undefined, cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }, time: { created: DateTime.makeUnsafe(0), updated: DateTime.makeUnsafe(0) } });
  const f: any = { root, store, binding, hooks, tools, events, info, lookup: async (id: string) => info(id), get reads() { return reads; }, get gets() { return gets; } };
  const hook = (domain: string) => async (name: string, callback: any) => {
    if (name === 'compaction' && options.unsupported === 'hook') throw new Error('synthetic unavailable hook');
    const remove=installHook(`${domain}:${name}`,callback);
    return { dispose: async () => { remove(); } };
  };
  const ctx: any = {
    location: { directory: `${root}/project` },
    session: { hook: hook('session'), get: async ({ sessionID }: any, request: any) => { gets++; return f.lookup(sessionID, request); } },
    event: { subscribe: ({ signal }: any) => { if (options.unsupported === 'subscribe') throw new Error('synthetic unavailable subscription'); if (options.unsupported === 'stream') return { async *[Symbol.asyncIterator]() { throw new Error('synthetic stream failure'); } }; return subscribe(signal); } },
    tool: { hook: hook('tool'), transform: async (callback: any) => callback({ namespace() {}, add(v: any) { tools.set('agent_progress_report', v); } }), list: async () => [...tools].map(([id, v]) => ({ id, ...v })) },
    skill: { transform: async (callback: any) => callback({ add() {} }) },
    permission: { assert: async () => { throw new Error('Recovery must not capture'); } },
    rpc: { register: async () => {} },
  };
  f.tick = (amount = 1) => clock += amount;
  f.time = (value: number) => clock = value;
  f.event = (type: string, sessionID = 'ses_M', overrides: any = {}) => ({ type: `session.compaction.${type}`, id: `evt_${++sequence}`, created: clock += 2, durable: { aggregateID: sessionID, seq: sequence, version: 1 }, location: { directory: `${root}/project` }, data: { sessionID, reason: 'manual', ...(type === 'ended' ? { text: 'Synthetic unused summary' } : {}), ...(type === 'failed' ? { error: { type: 'synthetic', message: 'Unused error' } } : {}) }, ...overrides });
  f.emit = (event: any) => bounded(Promise.all([...streams].filter(s=>!s.closed).map(s=>s.push(event))));
  f.compact = async (sessionID = 'ses_M', reason = 'manual', order = 'start-first') => {
    const start = f.event('started', sessionID); start.data.reason = reason;
    if (order === 'start-first') await f.emit(start);
    await f.aux('compaction', context(sessionID));
    if (order === 'hook-first') await f.emit(start);
    const end = f.event('ended', sessionID); end.data.reason = reason; await f.emit(end);
    return { start, end };
  };
  f.next = async (sessionID = 'ses_M', available = true, system?: any[]) => { f.tick(); const c = context(sessionID, available); if (system) c.system = system; await f.context(c); return c; };
  f.seed = (plan = 'P-alpha', title = 'Synthetic alpha', sessionID = 'ses_M', items = [{ id: 'I1', title: 'Private task prose', kind: 'task', status: 'pending' }]) => store.apply({ op: 'start', plan, title, oid: 'start', rev: 0, items }, { sourceId: source.id, sessionId: sessionID, parentId: sessionID === 'ses_C' ? 'ses_M' : null, ancestry: sessionID === 'ses_C' ? ['ses_M'] : [], agent: 'synthetic', directory: '/fixture/project', verifiedSource: true });
  f.report = async (value: any, sessionID = 'ses_M') => {
    const execute = tools.get('agent_progress_report').execute(value, { sessionID, agent: 'synthetic', messageID: 'msg_fixture', id: 'call_fixture', progress: () => Effect.void });
    const reply: any = options.adapter ? await Effect.runPromise(execute) : await execute;
    return JSON.parse(reply.content);
  };
  const original = Store.prototype.resumePlans;
  Store.prototype.resumePlans = function(...args) { reads++; return original.apply(this, args); };
  try {
    if (!options.adapter) {
      f.context = (event: any) => hooks.get('session:context')(event);
      f.aux = async (name: string, event: any) => { f.tick(); await hooks.get(`session:${name}`)?.(event); };
      f.after = (event: any) => hooks.get('tool:execute.after')(event);
      dispose = await plugin.setup(ctx) as () => Promise<void>;
      f.dispose = async () => { const close = dispose; dispose = undefined; await close?.(); };
      await run(f);
    } else {
      const asEffect = (action: () => Promise<any>) => Effect.tryPromise({ try: action, catch: e => e });
      const effectHook = (domain: string) => (name: string, callback: any) => Effect.sync(() => {
        const remove=installHook(`${domain}:${name}`,(event:any)=>Effect.runPromise(callback(event)));
        return { dispose: Effect.sync(remove) };
      });
      const unused: any = new Proxy(() => {}, { get: () => unused });
      const domains: any = {
        location: ctx.location,
        session: { hook: effectHook('session'), get: (r: any) => asEffect(() => ctx.session.get(r)) },
        event: { subscribe: () => Stream.fromAsyncIterable(subscribe(), e => e) },
        tool: { hook: effectHook('tool'), transform: (c: any) => Effect.sync(() => { c({ namespace() {}, add(v: any) { tools.set('agent_progress_report', v); } }); return { dispose: Effect.void }; }), list: () => asEffect(() => ctx.tool.list()) },
        skill: { transform: (c: any) => Effect.sync(() => { c({ add() {} }); return { dispose: Effect.void }; }) },
        rpc: Object.assign(() => {}, { register: () => Effect.succeed({ dispose: Effect.void, events: { emit: () => Effect.void } }) }),
      };
      const host: any = new Proxy({}, { get: (_, name) => domains[name] ?? unused });
      const adapted = fromPromise({ ...plugin, async setup(context) { dispose = await plugin.setup(context) as () => Promise<void>; return dispose; } });
      f.context = (e: any) => hooks.get('session:context')(e);
      f.aux = async (name: string, e: any) => { f.tick(); const h = hooks.get(`session:${name}`); if (h) await h(e); };
      try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () { yield* adapted.effect(host); yield* Effect.promise(() => run(f)); }))); }
      finally { dispose = undefined; } // adapter scope already disposed, including on assertion failure
    }
  } finally {
    for(const stream of streams)stream.close();events.close(); await dispose?.(); Store.prototype.resumePlans = original; store.close();
    for (const [k, v] of saved) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    fs.rmSync(root, { recursive: true, force: true });
    wallClock.mock.restore();
  }
}

test('V1/V2 pinned 2.1.4 adapter transports paired compaction and production current Store pointer', { timeout: 10000 }, async () => {
  for (const order of ['start-first', 'hook-first']) await fixture(async f => {
    f.seed(); assert.equal(capsule(await f.next()), ''); assert.equal(f.reads, 0);
    await f.compact('ses_M', 'manual', order);
    assert.equal((await f.report({ op: 'revise', plan: 'P-alpha', oid: 'revise', rev: 1, title: 'Synthetic alpha r2' })).rev, 2);
    const c = await f.next();
    samples.single = capsule(c);
    assert.match(capsule(c), /recorded pointer/); assert.match(capsule(c), /last-known revision 2/);
    assert.match(capsule(c), /agent_progress_report \{"op":"read","plan":"P-alpha"\}/);
    assert.equal(f.reads, 1); assert.equal(capsule(await f.next()), ''); assert.equal(f.reads, 1);
  }, { adapter: true });
});

test('V1/V8 only a live paired successful compaction arms; duplicates, stale sequences and body fields are ignored', async () => {
  await fixture(async f => {
    f.seed();
    await f.emit(f.event('ended')); assert.equal(capsule(await f.next()), '');
    const replayStart = f.event('started'), replayEnd = f.event('ended');
    await f.emit(replayStart); await f.emit(replayEnd); assert.equal(capsule(await f.next()), '', 'subscription replay has no live hook');
    for (const reason of ['auto', 'manual']) {
      const start = f.event('started'); start.data.reason = reason; await f.emit(start);
      await f.aux('compaction', context());
      const failed = f.event('failed'); failed.data.reason = reason;
      Object.defineProperty(failed.data, 'error', { get() { throw new Error('error body inspected'); } });
      await f.emit(failed); assert.equal(capsule(await f.next()), '');
      await f.emit(f.event('ended')); assert.equal(capsule(await f.next()), '');
      const completed = await f.compact('ses_M', reason);
      const end = { ...completed.end, data: { sessionID: 'ses_M', reason } };
      Object.defineProperty(end.data, 'text', { get() { throw new Error('summary inspected'); } });
      await f.emit(end);
      const c = await f.next(); assert.ok(capsule(c));
      await f.emit(completed.start); await f.emit(end); assert.equal(capsule(await f.next()), '');
      await f.emit({ ...end, id: 'distinct_stale_id' }); assert.equal(capsule(await f.next()), '');
    }
    const before = f.reads;
    const old = f.event('started', 'ses_M', { created: 0 }); await f.emit(old);
    await f.aux('compaction', context()); await f.emit(f.event('ended')); assert.equal(capsule(await f.next()), '');
    assert.equal(f.reads, before);
  });
});

test('V3 pointer versus unconfirmed list, output omissions, JSON-quoted literal titles, whole-candidate 4 KiB cap', async () => {
  await fixture(async f => {
    f.seed(); f.seed('P-beta', 'Synthetic "beta"\n🌱');
    await f.compact(); const two = capsule(await f.next());
    samples.candidates = two;
    assert.match(two, /unconfirmed candidates/); assert.match(two, /Read and confirm a target before reporting/);
    assert.ok(two.includes(JSON.stringify('Synthetic "beta"\n🌱'))); assert.doesNotMatch(two, /Additional eligible/);
    f.seed('P-gamma'); f.seed('P-delta'); await f.compact(); const four = capsule(await f.next());
    assert.match(four, /Additional eligible candidates may exist/); assert.equal((four.match(/last-known revision/g) ?? []).length, 3);
    // Maximum-length child IDs + titles force whole-candidate output removal, never partial scope.
    const ids = Array.from({ length: 20 }, (_, i) => `I${i}`.padEnd(80, 'x'));
    for (const plan of ['P-a'.padEnd(80, 'a'), 'P-b'.padEnd(80, 'b')]) {
      f.seed(plan, '🌱'.repeat(128), 'ses_M', ids.map(id => ({ id, title: 'Hidden', kind: 'task' })));
      assert.equal((await f.report({ op: 'link', plan, oid: 'link', rev: 1, child: 'ses_C', assign: ids })).error, undefined);
    }
    await f.compact('ses_C'); const child = capsule(await f.next('ses_C'));
    assert.ok(Buffer.byteLength(child) <= 4096); assert.match(child, /unconfirmed/); assert.match(child, /Additional eligible/);
    assert.equal((child.match(/Assigned-only scope/g) ?? []).length, 1);
    for (const id of ids) assert.ok(child.includes(JSON.stringify(id)), 'complete assigned IDs survive together');
  });
});

test('correlation declines incomplete, crossed and temporally ambiguous episodes, then accepts a clean attempt', async t => {
  const scenarios: Record<string, (f: any) => Promise<void>> = {
    'hook only': async f => { await f.aux('compaction', context()); },
    'start and hook without end': async f => { await f.emit(f.event('started')); await f.aux('compaction', context()); },
    'terminal before start delivery': async f => {
      const start = f.event('started'); await f.aux('compaction', context());
      await f.emit(f.event('ended')); await f.emit(start);
    },
    'reason mismatch': async f => {
      await f.emit(f.event('started')); await f.aux('compaction', context());
      const end = f.event('ended'); end.data.reason = 'auto'; await f.emit(end);
    },
    'orphan before a later start': async f => {
      await f.aux('compaction', context()); await f.emit(f.event('started')); await f.emit(f.event('ended'));
    },
    'overlapping starts': async f => {
      await f.emit(f.event('started')); await f.aux('compaction', context());
      await f.emit(f.event('started')); await f.aux('compaction', context()); await f.emit(f.event('ended'));
    },
    'start hook tie': async f => {
      const start = f.event('started'); await f.emit(start); f.time(start.created - 1);
      await f.aux('compaction', context()); await f.emit(f.event('ended'));
    },
    'hook end tie': async f => {
      await f.emit(f.event('started')); await f.aux('compaction', context());
      const hookTime = Date.now(); await f.emit(f.event('ended', 'ses_M', { created: hookTime }));
    },
    'hook after completion creation': async f => {
      await f.emit(f.event('started')); const end = f.event('ended');
      await f.aux('compaction', context()); await f.emit(end);
    },
    'backward hook clock': async f => {
      const start = f.event('started'); await f.emit(start); await f.aux('compaction', context());
      f.time(start.created - 1); await f.aux('compaction', context()); await f.emit(f.event('ended'));
    },
    'future start creation': async f => {
      const start = f.event('started', 'ses_M', { created: Date.now() + 20 }); await f.emit(start);
      f.tick(30); await f.aux('compaction', context()); await f.emit(f.event('ended'));
    },
    'new hook after completed attempt': async f => { await f.compact(); await f.aux('compaction', context()); },
  };
  for (const [name, scenario] of Object.entries(scenarios)) await t.test(name, () => fixture(async f => {
    f.seed(); await scenario(f);
    const c = await f.next(); assert.equal(capsule(c), ''); assert.equal(parts(c)[0].text, BASE); assert.equal(f.reads, 0);
    await f.compact('ses_M', 'auto', 'hook-first'); assert.ok(capsule(await f.next())); assert.equal(f.reads, 1);
  }));
});

test('first primary retires incomplete windows before awaits, including missing tools; delayed parts cannot backfill', async t => {
  for (const available of [true, false]) for (const deliveredStart of [true, false]) await t.test(`${available}/${deliveredStart}`, () => fixture(async f => {
    f.seed(); const start = f.event('started');
    if (deliveredStart) await f.emit(start);
    await f.aux('compaction', context());
    const primary = context('ses_M', available), entered = deferred(), release = deferred();
    f.lookup = async (id: string) => { entered.resolve(); await release.promise; return f.info(id); };
    f.tick(); const task = f.context(primary);
    if (available) await bounded(entered.promise);
    if (!deliveredStart) await f.emit(start);
    await f.emit(f.event('ended'));
    release.resolve(); await task; f.lookup = async (id: string) => f.info(id);
    assert.equal(capsule(primary), ''); assert.equal(capsule(await f.next()), ''); assert.equal(f.reads, 0);
    await f.compact(); assert.ok(capsule(await f.next()));
  }));
});

for (const removal of ['eviction', 'floor rejection']) test(`primary retirement fence survives ${removal} by older-created queued events`, async () => {
  await fixture(async f => {
    f.seed(); const floor = Date.now();
    // These starts were created before the primary but delivered later. None is
    // a replay, including the target start that has never reached the stream.
    const queued = Array.from({ length: 128 }, (_, i) => {
      f.time(floor + 3); return f.event('started', `ses_queued${i}`);
    });
    f.time(floor + 18); const delayedStart = f.event('started');
    if (removal === 'floor rejection') for (const event of queued.slice(0, 127)) await f.emit(event);
    f.time(floor + 29); await f.aux('compaction', context());
    f.time(floor + 39); assert.equal(capsule(await f.next()), ''); // fence = floor + 40
    if (removal === 'eviction') {
      for (const event of queued) await f.emit(event);
    } else {
      // Evict a filler, advancing the global floor only to +5 while the target
      // tombstone remains. A floor-rejected event then removes that tombstone.
      await f.emit(queued[127]);
      await f.emit(f.event('failed', 'ses_M', { created: floor + 5 }));
    }
    await f.emit(delayedStart);
    f.time(floor + 49); await f.aux('compaction', context());
    f.time(floor + 58); await f.emit(f.event('ended'));
    const primary = await f.next();
    assert.equal(capsule(primary), '', 'a removed tombstone must not allow retired episode backfill');
    assert.equal(parts(primary)[0].text, BASE); assert.equal(f.reads, 0);
    await f.compact(); assert.ok(capsule(await f.next())); assert.equal(f.reads, 1);
  });
});

test('primary retirement fence survives clock rollback and observed disable clearing', async () => {
  await fixture(async f => {
    f.seed(); const floor = Date.now();
    f.time(floor + 18); const delayedStart = f.event('started');
    f.time(floor + 39); assert.equal(capsule(await f.next()), ''); // primary fence = +40
    f.time(floor + 9); f.store.setEnabled(false);
    await f.next('ses_other'); // observe disable at +10, below the retained fence
    f.store.setEnabled(true);
    f.time(floor + 30); await f.emit(delayedStart); // first delivery, not a replay
    f.time(floor + 49); await f.aux('compaction', context());
    f.time(floor + 58); await f.emit(f.event('ended'));
    const primary = await f.next();
    assert.equal(capsule(primary), '', 'disable must not erase a newer primary fence after rollback');
    assert.equal(parts(primary)[0].text, BASE); assert.equal(f.reads, 0);
    await f.compact(); assert.ok(capsule(await f.next())); assert.equal(f.reads, 1);
    assert.equal(capsule(await f.next()), ''); assert.equal(f.reads, 1);
  });
});

test('duplicate observations coalesce without inspecting or changing compaction payloads', async () => {
  await fixture(async f => {
    f.seed(); const start = f.event('started');
    const hook: any = { sessionID: 'ses_M' };
    for (const key of ['system', 'messages', 'tools', 'options', 'result']) Object.defineProperty(hook, key, { get() { throw new Error(`compaction ${key} inspected`); } });
    await f.aux('compaction', hook); await f.emit(start); await f.aux('compaction', hook);
    await f.emit(f.event('ended')); assert.ok(capsule(await f.next())); assert.equal(f.reads, 1);
    assert.equal(capsule(await f.next()), ''); assert.equal(f.reads, 1);
    const unchanged = context(); const keys = Object.keys(unchanged), refs = { ...unchanged };
    await f.emit(f.event('started')); await f.aux('compaction', unchanged); await f.emit(f.event('ended'));
    assert.deepEqual(Object.keys(unchanged), keys);
    for (const key of keys) assert.equal(unchanged[key], refs[key]);
  });
});

test('orphan observations share session eviction bounds and retire on disable, stream failure or disposal', async t => {
  for (const mode of ['evict', 'disable', 'stream', 'dispose']) await t.test(mode, () => fixture(async f => {
    f.seed(); const start = f.event('started'); await f.aux('compaction', context());
    if (mode === 'evict') {
      for (let i = 0; i < 129; i++) await f.aux('compaction', context(`ses_orphan${i}`));
    } else if (mode === 'disable') {
      f.store.setEnabled(false); await f.next('ses_other'); f.store.setEnabled(true);
    } else if (mode === 'stream') {
      f.events.close(); await new Promise<void>(resolve => setImmediate(resolve));
    } else await f.dispose();
    await f.emit(start); await f.emit(f.event('ended'));
    if (mode === 'dispose') { assert.equal(f.hooks.size, 0); assert.equal(f.reads, 0); return; }
    assert.equal(capsule(await f.next()), ''); assert.equal(f.reads, 0);
    if (mode !== 'stream') { await f.compact(); assert.ok(capsule(await f.next())); }
  }));
});

test('V4 assigned child only, unlinked/sibling/restricted child fallback and missing ancestry', async () => {
  await fixture(async f => {
    f.seed(); f.seed('P-independent', 'Independent child work', 'ses_C');
    await f.compact('ses_C'); assert.equal(capsule(await f.next('ses_C')), '');
    assert.equal((await f.report({ op: 'link', plan: 'P-alpha', oid: 'link', rev: 1, child: 'ses_C', assign: ['I1'] })).rev, 2);
    await f.compact('ses_C'); const child = await f.next('ses_C');
    samples.child = capsule(child);
    assert.match(capsule(child), /Assigned-only scope: \["I1"\]/); assert.doesNotMatch(capsule(child), /Private task prose|Independent child work|pending/);
    await f.compact('ses_sibling'); assert.equal(capsule(await f.next('ses_sibling')), '');
    await f.compact('ses_C'); const before = f.reads; const restricted = await f.next('ses_C', false);
    assert.equal(parts(restricted).length, 0); assert.equal(f.reads, before);
    assert.equal(capsule(await f.next('ses_C')), '', 'missing tool consumed the opportunity');
    f.lookup = async (id: string) => { if (id === 'ses_M') throw new Error('unknown ancestry'); return f.info(id); };
    await f.compact('ses_C'); assert.equal(capsule(await f.next('ses_C')), '');
  });
});

test('V6 fresh final read excludes finished/archived/deleted/unlinked state and reads only once per attempt', async () => {
  await fixture(async f => {
    f.seed('P-alpha', 'Synthetic alpha', 'ses_M', [{ id: 'I1', title: 'Synthetic', kind: 'task', status: 'done' }]);
    await f.compact(); assert.ok(capsule(await f.next()));
    await f.compact(); await f.report({ op: 'finish', plan: 'P-alpha', oid: 'finish', rev: 1, outcome: 'finished' });
    assert.equal(capsule(await f.next()), '');
    const request = { storeId: f.binding.storeId, source: f.binding.source.id, plan: 'P-alpha', rev: 2, cleanupRev: 0, oid: 'archive' };
    await f.compact(); f.store.cleanup('archive', request); assert.equal(capsule(await f.next()), '');
    await f.compact(); f.store.cleanup('delete', { ...request, cleanupRev: 1, oid: 'delete', confirmed: true }); assert.equal(capsule(await f.next()), '');
    f.seed('P-linked'); await f.report({ op: 'link', plan: 'P-linked', oid: 'link', rev: 1, child: 'ses_C', assign: ['I1'] });
    await f.compact('ses_C'); await f.report({ op: 'link', plan: 'P-linked', oid: 'unlink', rev: 2, child: 'ses_C', assign: [] });
    assert.equal(capsule(await f.next('ses_C')), ''); const reads = f.reads;
    await f.next(); await f.next(); assert.equal(f.reads, reads);
  });
});

test('V4 authoritative ancestry rejects cycles, over-depth chains and mismatched ancestor identities', async () => {
  await fixture(async f => {
    f.seed(); await f.report({ op: 'link', plan: 'P-alpha', oid: 'link', rev: 1, child: 'ses_C', assign: ['I1'] });
    for (const mode of ['cycle', 'depth', 'mismatch']) {
      f.lookup = async (id: string) => {
        const info = f.info(id);
        if (id === 'ses_C') return info;
        if (mode === 'cycle') return { ...info, parentID: 'ses_C' };
        if (mode === 'mismatch') return { ...info, id: 'ses_wrong' };
        return { ...info, parentID: id === 'ses_M' ? 'ses_depth0' : `ses_depth${Number(id.slice('ses_depth'.length)) + 1}` };
      };
      await f.compact('ses_C'); const before = f.gets;
      const c = await f.next('ses_C'); assert.equal(capsule(c), ''); assert.equal(parts(c)[0].text, BASE);
      assert.ok(f.gets - before <= 34, 'ordinary current lookup plus bounded ancestry lookup');
    }
  });
});

test('V6/V8 held ancestry retires on disable/disposal, no next hop or late injection; no re-enable backfill', async () => {
  for (const mode of ['disable', 'dispose']) await fixture(async f => {
    f.seed(); await f.compact('ses_C');
    const entered = deferred(), release = deferred(); const seen: string[] = [];
    f.lookup = async (id: string) => { seen.push(id); if (id === 'ses_M') { entered.resolve(); await release.promise; return { ...f.info(id), parentID: 'ses_grandparent' }; } return f.info(id); };
    const c = context('ses_C'); const task = f.context(c); await bounded(entered.promise);
    if (mode === 'dispose') await f.dispose();
    else { f.store.setEnabled(false); await f.next('ses_other'); f.store.setEnabled(true); }
    release.resolve(); await task;
    assert.equal(seen.includes('ses_grandparent'), false); assert.equal(f.reads, 0); assert.equal(parts(c).length, 0);
    if (mode === 'disable') { assert.equal(capsule(await f.next('ses_C')), ''); f.lookup = async (id: string) => f.info(id); await f.compact(); assert.ok(capsule(await f.next())); }
    else assert.equal(f.hooks.size, 0);
  });
});

test('V8 reused system strips consumed recovery but preserves generic/file hints and unrelated context', async () => {
  await fixture(async f => {
    f.seed(); await f.after(writeEvent()); await f.compact();
    const c = await f.next(); assert.ok(capsule(c)); assert.ok(parts(c)[0].text.includes(HINT));
    const other = c.system[0], messages = c.messages, tools = c.tools, settings = c.options;
    await f.context(c); assert.equal(capsule(c), ''); assert.equal(parts(c).length, 1); assert.ok(parts(c)[0].text.includes(HINT));
    assert.equal(c.system[0], other); assert.equal(c.messages, messages); assert.equal(c.tools, tools); assert.equal(c.options, settings);
    assert.equal(parts(await f.next())[0].text, BASE);
    await f.compact(); await f.context(c); assert.ok(capsule(c)); assert.equal(parts(c).length, 1);
  });
});

test('V8 optional recovery subscription/hook/stream failure retains generic activation and file hints', async () => {
  for (const unsupported of ['subscribe', 'hook', 'stream'] as const) await fixture(async f => {
    f.seed(); await f.after(writeEvent()); const c = await f.next();
    assert.equal(capsule(c), ''); assert.equal(parts(c).length, 1); assert.ok(parts(c)[0].text.includes(HINT)); assert.equal(f.reads, 0);
    assert.equal(f.hooks.has('session:compaction'), false);
  }, { unsupported });
});

test('V7 compaction/session caps and replay eviction never resurrect a consumed/evicted opportunity', async () => {
  await fixture(async f => {
    f.seed();
    const old = await f.compact();
    for (let i = 0; i < 129; i++) await f.compact(`ses_${i}`);
    assert.equal(capsule(await f.next()), '', 'oldest session evicted');
    const before = f.reads;
    await f.emit(old.start); await f.aux('compaction', context()); await f.emit(old.end);
    assert.equal(capsule(await f.next()), ''); assert.equal(f.reads, before, 'old replay cannot reconstruct after both caps evict');
    await f.compact(); await f.compact(); const c = await f.next(); assert.ok(capsule(c)); assert.equal(f.reads, before + 1, 'coalesced completions scan once');
  });
});

test('V6/V7 equal-timestamp eviction retires retained recovery on floor-rejected start/failed or ended', async t => {
  for (const terminal of ['failed', 'ended']) await t.test(terminal, async () => {
    await fixture(async f => {
      f.seed();
      const timestamp = f.tick(10_000);
      // Retain the target session while a different, older record is evicted.
      for (let i = 0; i < 127; i++) await f.emit(f.event('started', `ses_fill${i}`, { created: timestamp - 5 }));
      await f.emit(f.event('started', 'ses_M', { created: timestamp - 4 }));
      f.time(timestamp - 4);
      await f.aux('compaction', context());
      await f.emit(f.event('ended', 'ses_M', { created: timestamp - 2 }));
      await f.emit(f.event('started', 'ses_evict', { created: timestamp }));
      if (terminal === 'failed') {
        await f.emit(f.event('started', 'ses_M', { created: timestamp }));
        await f.aux('compaction', context());
      }
      await f.emit(f.event(terminal, 'ses_M', { created: timestamp }));
      const c = await f.next();
      assert.equal(capsule(c), '', 'floor rejection retires old pending recovery rather than preserving it');
      assert.equal(parts(c)[0].text, BASE);
      assert.equal(f.reads, 0, 'floor-rejected terminal cannot arm a recovery read');
    });
  });
});

test('V6/V7 one-second deadline returns generic guidance while one abort-ignoring lookup remains outstanding, with no later hop', { timeout: 10000 }, async t => {
  await fixture(async f => {
    f.seed(); await f.compact('ses_C');
    const entered = deferred(), release = deferred(); let held = false, now = 0;
    const seen: string[] = [];
    f.lookup = async (id: string) => {
      seen.push(id);
      if (id === 'ses_M' && !held) { held = true; entered.resolve(); await release.promise; return { ...f.info(id), parentID: 'ses_grandparent' }; }
      return f.info(id);
    };
    const clock = t.mock.method(performance, 'now', () => now);
    t.mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const c = context('ses_C'); const task = f.context(c); await entered.promise;
      now = 1000; t.mock.timers.tick(1000); await task;
      assert.equal(parts(c)[0].text, BASE); assert.equal(f.reads, 0);
      await f.compact(); const before = seen.length; await f.next();
      assert.equal(seen.length, before + 1, 'busy slot permits only ordinary current-session lookup');
      assert.equal(f.reads, 0);
      release.resolve(); await new Promise<void>(resolve => setImmediate(resolve));
      assert.equal(seen.includes('ses_grandparent'), false);
      assert.equal(capsule(await f.next()), '', 'expired attempt does not backfill');
    } finally { release.resolve(); t.mock.timers.reset(); clock.mock.restore(); }
    await f.compact(); assert.ok(capsule(await f.next()));
  });
});

test('V6 tool loss during ancestry declines recovery and removes generic section under existing guards', async () => {
  await fixture(async f => {
    f.seed(); await f.compact('ses_C');
    const entered = deferred(), release = deferred();
    f.lookup = async (id: string) => { if (id === 'ses_M') { entered.resolve(); await release.promise; } return f.info(id); };
    const c = context('ses_C'); const task = f.context(c); await bounded(entered.promise);
    delete c.tools.agent_progress_report; release.resolve(); await task;
    assert.equal(parts(c).length, 0); assert.equal(f.reads, 0);
    assert.equal(capsule(await f.next('ses_C')), '');
  });
});

test('V5/V6 source and store-generation changes retire held authority even if later restored', async () => {
  for (const change of ['source', 'store']) {
    let clock = 1_800_000_000_000;
    const wallClock = mock.method(Date, 'now', () => clock);
    const events = new Events(), hooks = new Map<string, any>();
    const source = { id: 'source-fixture', verified: true };
    const entered = deferred(), release = deferred(); let reads = 0;
    const recovery = { storeId: 'store-fixture', read: () => { reads++; return null; }, identity: async () => { entered.resolve(); await release.promise; return { sourceId: 'source-fixture', sessionId: 'ses_M', parentId: null, ancestry: [] }; } };
    const ctx: any = { location: { directory: '/fixture/project' },
      session: { get: async ({ sessionID }: any) => ({ id: sessionID, location: { directory: '/fixture/project' } }), hook: async (name: string, fn: any) => { hooks.set(name, fn); return { dispose: async () => { hooks.delete(name); } }; } },
      tool: { hook: async () => ({ dispose: async () => {} }) },
      event: { subscribe: ({ signal }: any) => { signal.addEventListener('abort', () => events.close()); return events; } },
    };
    const dispose = await registerActivation(ctx, source, () => true, recovery);
    try {
      const e = (kind: string, seq: number) => ({ type: `session.compaction.${kind}`, id: `evt_${seq}`, created: clock += 2, durable: { seq, aggregateID: 'ses_M', version: 1 }, location: ctx.location, data: { sessionID: 'ses_M', reason: 'manual' } });
      const orphanStart = e('started', 1); clock++; await hooks.get('compaction')(context());
      if (change === 'source') source.id = 'source-other'; else recovery.storeId = 'store-other';
      clock++; await hooks.get('context')(context('ses_other'));
      source.id = 'source-fixture'; recovery.storeId = 'store-fixture';
      await events.push(orphanStart); await events.push(e('ended', 2));
      await hooks.get('context')(context()); assert.equal(reads, 0, 'generation change retires pre-start observation');
      await events.push(e('started', 3)); clock++; await hooks.get('compaction')(context()); await events.push(e('ended', 4));
      const c = context(); const task = hooks.get('context')(c); await bounded(entered.promise);
      if (change === 'source') source.id = 'source-other'; else recovery.storeId = 'store-other';
      await hooks.get('context')(context('ses_other'));
      source.id = 'source-fixture'; recovery.storeId = 'store-fixture';
      release.resolve(); await task;
      assert.equal(capsule(c), ''); assert.equal(reads, 0);
      await hooks.get('context')(context()); assert.equal(reads, 0);
    } finally { events.close(); await dispose(); wallClock.mock.restore(); }
  }
});

test('V8 failed read/render and incomplete singleton keep base guidance and never imply uniqueness', async t => {
  await fixture(async f => {
    f.seed(); await f.compact();
    const original = Store.prototype.resumePlans;
    const failure = t.mock.method(Store.prototype, 'resumePlans', () => { throw new Error('Synthetic unavailable read'); });
    assert.equal(parts(await f.next())[0].text, BASE); failure.mock.restore();
    await f.compact();
    const partial = t.mock.method(Store.prototype, 'resumePlans', function(this: Store, ...args: Parameters<Store['resumePlans']>) {
      const result = original.apply(this, args)!; return { ...result, incomplete: true, limit: 'slots' as const };
    });
    const c = capsule(await f.next()); assert.match(c, /unconfirmed candidates/); assert.match(c, /Additional eligible candidates may exist/);
    partial.mock.restore();
    await f.compact();
    const renderFailure = t.mock.method(Store.prototype, 'resumePlans', function(this: Store, ...args: Parameters<Store['resumePlans']>) {
      const result = original.apply(this, args)!;
      Object.defineProperty(result.candidates[0], 'title', { get() { throw new Error('Synthetic render fault'); } });
      return result;
    });
    assert.equal(parts(await f.next())[0].text, BASE); renderFailure.mock.restore();
    assert.equal(capsule(await f.next()), '');
  });
});
