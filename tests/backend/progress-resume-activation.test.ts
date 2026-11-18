/** Direct disposable binding, never an installer. Fake host + real production plugin/Store. */
import { test, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Effect, DateTime, Stream } from 'effect';
import { fromPromise } from '@opencode/plugin/promise/adapter';
import plugin from '../../plugin/index.ts';
import { registerActivation, delegationRefusalText, ACTIVATION_GUIDANCE as BASE, ACTIVATION_HINT as HINT } from '../../plugin/activation.ts';
import { Store } from '../../shared/store.ts';
import { activationContext as context, requestNote, writeEvent } from '../fixtures/activation-production.ts';
import { isolatedEnvironment, publishFixtureBinding } from '../fixtures/managed.ts';
import { PARALLEL_DELEGATION_HINT } from '../../plugin/delegation.ts';

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
const CLEARED = 'Agent Progress note (delegation): the earlier delegation refusal no longer applies; read the current plan before you declare or link.';
const parts = (c: any) => c.system.filter((p: any) => p.text?.startsWith('# Agent progress (companion)'));
const capsule = (c: any): string => { const note = requestNote(c), at = note.indexOf('## Progress resume'); return at < 0 ? '' : note.slice(at); };
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
  const binding = { protocolVersion: 2 as const, schemaVersion: 2 as const, installId: 'synthetic-install', version: '0.0.0', database: store.file, storeId: String(store.db.prepare('SELECT store_id FROM meta').get()!.store_id), source };
  const file = `${root}/binding.json`; fs.writeFileSync(file, JSON.stringify(binding), { mode: 0o600 });
  const saved = new Map<string, string | undefined>();
  const env=isolatedEnvironment(root);publishFixtureBinding(env,binding);
  for (const [k, v] of Object.entries({ ...env, AGENT_PROGRESS_BINDING: undefined, OPENCODE_DB: undefined, OPENCODE_CONFIG_DIR: undefined })) { saved.set(k, process.env[k]); if (v === undefined) delete process.env[k]; else process.env[k] = v; }
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
    permission: { assert: async () => { if(f.permission)return f.permission();throw new Error('Recovery must not capture'); } },
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

test('ordinary child contexts deliver only current verified assignments without compaction or automatic reports',async()=>fixture(async f=>{
  f.seed();const child={sourceId:f.binding.source.id,sessionId:'ses_C',parentId:'ses_M',ancestry:['ses_M'],agent:'synthetic',directory:'/fixture/project',verifiedSource:true};
  const parent={...child,sessionId:'ses_M',parentId:null,ancestry:[]};
  const text=(c:any)=>requestNote(c);
  assert.equal(text(await f.next('ses_C')).includes('last-known revision'),false);
  f.store.apply({op:'link',plan:'P-alpha',oid:'assign-child',rev:1,child:'ses_C',assign:['I1']},parent,undefined,child);
  const c=await f.next('ses_C');assert.ok(text(c).includes('Assigned-only scope: ["I1"]'));
  assert.ok(text(c).includes('last-known revision 2'));assert.equal(f.store.get(child.sourceId,'P-alpha').revision,2);
  assert.equal(parts(await f.next('ses_C',false)).length,0);
  f.store.apply({op:'link',plan:'P-alpha',oid:'unlink-child',rev:2,child:'ses_C',assign:[]},parent,undefined,child);
  // The delivered brief stays where it was put on a rebuilt request; only a new turn after the unlink has none.
  await f.context(c);assert.equal(text(c).includes('Assigned-only scope:'),true);
  assert.equal(text(await f.next('ses_C')).includes('Assigned-only scope:'),false);
  assert.equal(f.store.get(child.sourceId,'P-alpha').items[0].status,'pending');
}));

// Regression from the linked-child reproducer: explicit links need native
// parentage, not a shared directory/project or a captured dispatch row.
for (const scope of ['same', 'directory', 'project'] as const)
test(`linked child combined handoff without delegate: ${scope}`, async()=>fixture(async f=>{
  const original=f.info;
  f.lookup=async(id:string)=>({...original(id),...(id==='ses_C'&&scope!=='same'?{location:{directory:'/synthetic/beta'},...(scope==='project'?{projectID:'beta'}:{})}:{})});
  await f.report({op:'start',plan:'P-linked',oid:'start-linked',rev:0,title:'Synthetic',items:[{id:'I1',title:'Task',kind:'task'}]});
  assert.equal((await f.report({op:'link',plan:'P-linked',oid:'link-child',rev:1,child:'ses_C',assign:['I1']})).rev,2);
  assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM runs_rows').get().n,0);
  const request={op:'handoff',oid:'linked-final',summary:'Synthetic result',outcome:'done',taskUpdate:{plan:'P-linked',rev:2,changes:[{id:'I1',status:'done'}]}};
  const reply=await f.report(request,'ses_C');
  assert.equal(reply.error,undefined);
  assert.equal(reply.taskReceipt.rev,3);
  assert.equal(f.store.get(f.binding.source.id,'P-linked').items[0].status,'done');
  assert.deepEqual(await f.report(request,'ses_C'),reply);
}));

test('combined handoff retires after a held document permission',async()=>fixture(async f=>{
  const file=`${f.root}/project/plan.md`;fs.writeFileSync(file,'Synthetic plan');
  // The initial denied capture still binds the document, as ordinary reporting does.
  await f.report({op:'start',plan:'P-bound',oid:'start-bound',rev:0,title:'Synthetic',source:file,items:[{id:'I1',title:'Task',kind:'task'}]});
  const child={sourceId:f.binding.source.id,sessionId:'ses_C',parentId:'ses_M',ancestry:['ses_M'],agent:'synthetic',directory:`${f.root}/project`,verifiedSource:true};
  f.store.apply({op:'link',plan:'P-bound',oid:'link-bound',rev:1,child:'ses_C',assign:['I1']},{...child,sessionId:'ses_M',parentId:null,ancestry:[]}, {path:file,state:'denied',checkedAt:new Date().toISOString()},child);
  const entered=deferred(),release=deferred();f.permission=async()=>{entered.resolve();await release.promise;};
  const pending=f.report({op:'handoff',oid:'held-final',summary:'Synthetic',outcome:'done',taskUpdate:{plan:'P-bound',rev:2,changes:[{id:'I1',status:'done'}]}},'ses_C');
  await entered.promise;await f.dispose();release.resolve();const reply=await pending;
  assert.ok(reply.error);assert.equal(f.store.get(child.sourceId,'P-bound').revision,2);
}));

for(const fault of ['missing-parent','wrong-parent-id','unrelated-parent','cycle','sibling','stale','source'] as const)
test(`cross-project combined handoff preserves authority and atomicity: ${fault}`,async()=>fixture(async f=>{
  const info=f.info;
  f.lookup=async(id:string)=>({...info(id),...(id==='ses_C'?{location:{directory:'/synthetic/beta'},projectID:'beta'}:{})});
  await f.report({op:'start',plan:'P-linked',oid:'start',rev:0,title:'Synthetic',items:['I1','I2'].map(id=>({id,title:id,kind:'task'}))});
  assert.equal((await f.report({op:'link',plan:'P-linked',oid:'link',rev:1,child:'ses_C',assign:['I1']})).rev,2);
  const good=f.lookup;
  f.lookup=async(id:string)=>{
    if(id==='ses_M'&&fault==='missing-parent')throw Error('Synthetic missing parent');
    const s=await good(id);
    if(id==='ses_M'&&fault==='wrong-parent-id')s.id='ses_other';
    if(id==='ses_C'&&fault==='unrelated-parent')s.parentID='ses_other';
    if(id==='ses_M'&&fault==='cycle')s.parentID='ses_C';
    return s;
  };
  if(fault==='source')f.store.db.exec('UPDATE sources SET verified=0');
  const before=f.store.db.prepare('SELECT (SELECT count(*) FROM revisions) revisions,(SELECT count(*) FROM receipts) receipts,(SELECT count(*) FROM contributions) contributions,(SELECT count(*) FROM runs_claims) claims').get();
  const reply=await f.report({op:'handoff',oid:'refused-final',summary:'Synthetic result',outcome:'done',taskUpdate:{plan:'P-linked',rev:fault==='stale'?1:2,changes:[{id:fault==='sibling'?'I2':'I1',status:'done'}]}},'ses_C');
  assert.equal(reply.error,fault==='stale'?'conflict':fault==='source'?'source-unverified':'assignment');
  assert.deepEqual(f.store.db.prepare('SELECT (SELECT count(*) FROM revisions) revisions,(SELECT count(*) FROM receipts) receipts,(SELECT count(*) FROM contributions) contributions,(SELECT count(*) FROM runs_claims) claims').get(),before);
  assert.equal(f.store.get(f.binding.source.id,'P-linked').items[0].status,'pending');
}));

test('pending delegation conflict carries the parallel recipe without replacing intent',async()=>fixture(async f=>{
  f.seed();
  const first={op:'delegate',plan:'P-alpha',oid:'first',rev:1,assign:['I1']};
  assert.equal((await f.report(first)).delegation.state,'pending');
  assert.deepEqual(await f.report({...first,oid:'second'}),{error:'conflict',hint:PARALLEL_DELEGATION_HINT});
  assert.equal((await f.report(first)).delegation.state,'pending');
  assert.deepEqual(await f.report({...first,oid:'stale',rev:0}),{error:'conflict',rev:1},'unrelated revision conflicts do not claim a pending-intent cause');
  assert.ok(parts(await f.next())[0].text.includes(PARALLEL_DELEGATION_HINT));
}));

for(const recovery of ['redeclare','link','binding'] as const)
test(`durable refusal is refreshed after ${recovery} recovery on eligible coordinator context only`,async()=>fixture(async f=>{
  f.seed();
  await f.report({op:'delegate',plan:'P-alpha',oid:'refused-declaration',rev:1,assign:['I1']});
  const actor={sourceId:f.binding.source.id,sessionId:'ses_M',parentId:null,ancestry:[],agent:'synthetic',directory:'/fixture/project',verifiedSource:true};
  const key={source:actor.sourceId,parent:actor.sessionId,message:'message',call:'reserved-call'};
  f.store.beforeRun(key,actor,'subagent',{},1000);
  f.store.apply({op:'change',plan:'P-alpha',oid:'target-touch',rev:1,changes:[{id:'I1',status:'working'}]},actor);
  f.store.afterRun(key,0,{...actor,sessionId:'ses_C',parentId:'ses_M',ancestry:['ses_M']},'returned');
  const before=f.store.get(actor.sourceId,'P-alpha');
  const absent=requestNote(await f.next('ses_sibling'));assert.ok(!absent.includes('## Delegation not applied'));
  assert.equal(parts(await f.next('ses_M',false)).length,0);
  const context=await f.next();const text=requestNote(context);
  assert.match(text,/Plan "P-alpha", declaration "refused-declaration" at revision 1; tasks \["I1"\]: not applied because/);
  assert.match(text,/re-declare at the current revision/);assert.match(text,/explicitly link/);
  assert.deepEqual(f.store.get(actor.sourceId,'P-alpha'),before);
  if(recovery==='redeclare')await f.report({op:'delegate',plan:'P-alpha',oid:'new-declaration',rev:2,assign:['I1']});
  else f.store.apply({op:'link',plan:'P-alpha',oid:'recovered-link',rev:2,child:'ses_C',assign:['I1']},actor,undefined,
    {...actor,sessionId:'ses_C',parentId:'ses_M',ancestry:['ses_M']},recovery==='binding'?{generation:0,messageId:key.message,callId:key.call,observedAt:new Date(1000).toISOString()}:undefined);
  // The delivered refusal stays in place; the fixed cleared line follows it once the read is complete and finds none.
  await f.context(context);assert.equal(requestNote(context),`${text}\n\n${CLEARED}`,'delivered refusal stays, then the cleared line');
  await f.context(context);assert.equal(requestNote(context),`${text}\n\n${CLEARED}`,'the cleared line is delivered once');
  assert.equal(requestNote(await f.next()),'','a new turn has nothing to clear');
  f.store.setEnabled(false);assert.equal(parts(await f.next()).length,0);
}));

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

test('V8 reused context keeps delivered notes in place once and preserves unrelated context', async () => {
  await fixture(async f => {
    f.seed(); await f.after(writeEvent()); await f.compact();
    const c = await f.next(); assert.ok(capsule(c)); assert.ok(requestNote(c).includes(HINT)); assert.equal(parts(c)[0].text, BASE);
    const other = c.system[0], messages = c.messages, tools = c.tools, settings = c.options;
    // A rebuilt request keeps the delivered note exactly where it was, once, and never adds the section twice.
    const delivered = requestNote(c);
    await f.context(c); assert.equal(requestNote(c), delivered); assert.equal(parts(c).length, 1); assert.equal(parts(c)[0].text, BASE);
    assert.equal(c.system[0], other); assert.equal(c.messages, messages); assert.equal(c.tools, tools); assert.equal(c.options, settings);
    assert.equal(parts(await f.next())[0].text, BASE);
    await f.compact(); await f.context(c); assert.ok(capsule(c)); assert.equal(parts(c).length, 1); assert.equal(parts(c)[0].text, BASE);
  });
});

// ---- Delivered context notes: stable system section, notes kept in place on later requests ----
// The cleared line is the one fixed text this behaviour adds; the tests spell it out.
const textPart = (value: string) => ({ type: 'text', text: value });
/**
 * A stored conversation that only grows, from which the host rebuilds each request.
 * Every request checks that the stored objects never carry a note, that the system
 * array never changes and that its messages begin with the previous request's messages
 * byte for byte. `added` lists every note on a request as [index, text].
 */
let conversationTurns = 0; // distinct text for every message of every conversation
function conversation(f: any, withId = false, sessionID = 'ses_M') {
  const history: any[] = [], sent: string[][] = [], systems: string[] = [];
  const t = {
    history, systems,
    user: (value = `turn ${++conversationTurns}`) => { history.push({ role: 'user', ...(withId ? { id: `msg_${sessionID}_${++conversationTurns}` } : {}), content: [textPart(value)] }); },
    tool: (name = 'write', value = 'Created file', callId = `call_${++conversationTurns}`) => {
      history.push({ role: 'assistant', content: [{ type: 'tool-call', id: callId, name, input: {} }] },
        { role: 'tool', content: [{ type: 'tool-result', id: callId, name, result: { type: 'content', value: [textPart(value)] } }] });
    },
    get last() { return history.length - 1; },
    async request(available = true, check = true, messages: any[] = history) {
      const stored = JSON.stringify(messages);
      const c = context(sessionID, available); c.messages = [...messages]; f.tick();
      await f.context(c);
      assert.equal(JSON.stringify(messages), stored, 'the stored conversation never carries a note');
      if (check) {
        const previous = sent.at(-1);
        if (previous) assert.deepEqual(c.messages.slice(0, previous.length).map((m: any) => JSON.stringify(m)), previous, 'messages begin with the previous request\'s, notes included');
        systems.push(JSON.stringify(c.system));
        sent.push(c.messages.map((m: any) => JSON.stringify(m)));
      }
      return c;
    },
    added(c: any, messages: any[] = history): Array<[number, string]> {
      return c.messages.flatMap((m: any, i: number): Array<[number, string]> => {
        if (JSON.stringify(m) === JSON.stringify(messages[i])) return [];
        const parts = m.role === 'user' ? m.content.slice(1) : m.content.at(-1).result.value.slice(1);
        return [[i, parts.map((p: any) => p.text).join('\n\n')]];
      });
    },
  };
  return t;
}
/** Controls what the production refusal read returns, per request. */
function refusalReads() {
  let state: any = { complete: true, refusals: [] };
  const read = mock.method(Store.prototype, 'delegationRefusals', function (sourceId: string, sessionId: string) {
    if (state === 'fail') throw new Error('synthetic read failure');
    return { sourceId, sessionId, ...state };
  });
  const refused = (oid: string, taskIds = ['I1']) => ({ complete: true, refusals: [{ plan: 'P-alpha', reason: 'conflict', recovery: 'redeclare-or-link', declaration: { oid, taskIds, declaredRevision: 1 } }] });
  return {
    set: (value: any) => { state = value; }, refused, restore: () => read.mock.restore(),
    text: (oid: string, taskIds?: string[]) => delegationRefusalText({ sourceId: 'x', sessionId: 'y', ...refused(oid, taskIds) } as any),
  };
}

for (const withId of [true, false]) test(`delivered notes stay in place on later requests and the system section never changes (${withId ? 'user message ids' : 'no user message ids'})`, async () => {
  await fixture(async f => {
    f.seed();
    const refusals = refusalReads();
    try {
      const t = conversation(f, withId);
      const revision = () => f.store.get(f.binding.source.id, 'P-alpha').revision;
      t.user(); assert.deepEqual(t.added(await t.request()), []);
      // A hint after a plan-file write rides the tool carrier and stays there.
      await f.after(writeEvent('docs/plans/search.md', 'w1')); t.tool(); const hinted = t.last;
      assert.deepEqual(t.added(await t.request()), [[hinted, HINT]]);
      t.user(); assert.deepEqual(t.added(await t.request()), [[hinted, HINT]], 'the earlier hint is repeated, and not added again');
      // A user carrier: a later hint on a user message.
      await f.after(writeEvent('docs/plans/search.md', 'w2')); t.user(); const userHint = t.last;
      assert.deepEqual(t.added(await t.request()), [[hinted, HINT], [userHint, HINT]]);
      // A refusal appears, is repeated, clears once and appears again.
      refusals.set(refusals.refused('d1')); t.tool('read'); const refused = t.last;
      assert.deepEqual(t.added(await t.request()), [[hinted, HINT], [userHint, HINT], [refused, refusals.text('d1')]]);
      t.user(); assert.equal(t.added(await t.request()).length, 3, 'an unchanged refusal whose carrier is present is not delivered again');
      refusals.set({ complete: true, refusals: [] }); t.tool('read'); const cleared = t.last;
      assert.deepEqual(t.added(await t.request()).slice(3), [[cleared, CLEARED]]);
      t.user(); assert.equal(t.added(await t.request()).length, 4, 'the cleared line is delivered once');
      refusals.set(refusals.refused('d1')); t.tool('read'); const again = t.last;
      assert.deepEqual(t.added(await t.request()).slice(4), [[again, refusals.text('d1')]], 'the same refusal returning after the cleared line is delivered again');
      refusals.set({ complete: true, refusals: [] });
      // A hint, a capsule and a cleared line due together are one note, in that order.
      await f.compact(); await f.report({ op: 'revise', plan: 'P-alpha', oid: 'revise-a', rev: revision(), title: 'Synthetic alpha r2' });
      await f.after(writeEvent('docs/plans/search.md', 'w3')); t.user(); const combined = t.last;
      const joint = t.added(await t.request()).slice(5);
      assert.equal(joint.length, 1); assert.equal(joint[0][0], combined);
      const pieces = joint[0][1].split('\n\n');
      assert.equal(pieces.length, 3); assert.equal(pieces[0], HINT); assert.match(pieces[1], /^## Progress resume.*last-known revision 2/s); assert.equal(pieces[2], CLEARED);
      t.user(); assert.equal(t.added(await t.request()).length, 6, 'the capsule is repeated, not delivered again');
      // A capsule revision delivers the new capsule after the latest message; the old one stays.
      await f.compact(); await f.report({ op: 'revise', plan: 'P-alpha', oid: 'revise-b', rev: revision(), title: 'Synthetic alpha r3' });
      t.user(); const revised = t.last;
      const afterRevision = t.added(await t.request());
      assert.equal(afterRevision.length, 7); assert.equal(afterRevision[6][0], revised); assert.match(afterRevision[6][1], /last-known revision 3/);
      assert.match(afterRevision[5][1], /last-known revision 2/);
      // A lookup that times out adds nothing and leaves every earlier note where it was.
      await f.compact(); const release = deferred(); let calls = 0;
      f.lookup = async (id: string) => { if (++calls > 1) await release.promise; return f.info(id); };
      t.user(); assert.equal(t.added(await t.request()).length, 7);
      release.resolve(); f.lookup = async (id: string) => f.info(id); await new Promise<void>(resolve => setImmediate(resolve));
      assert.equal(new Set(t.systems).size, 1, 'one byte-identical system array on every request');
      assert.deepEqual(JSON.parse(t.systems[0]), [{ type: 'text', text: 'Other system section' }, { type: 'text', text: BASE }]);
      assert.equal(t.systems.length, 13);
    } finally { refusals.restore(); }
  });
});

test('an assigned child gets its brief once, a changed brief after the latest message, and nothing on a lookup timeout', async () => {
  await fixture(async f => {
    f.seed();
    assert.equal((await f.report({ op: 'link', plan: 'P-alpha', oid: 'link', rev: 1, child: 'ses_C', assign: ['I1'] })).error, undefined);
    const t = conversation(f, false, 'ses_C');
    // The brief is read on every request; it is delivered once and then only repeated.
    t.user(); const first = t.last;
    const delivered = t.added(await t.request());
    assert.equal(delivered.length, 1); assert.equal(delivered[0][0], first); assert.match(delivered[0][1], /last-known revision 2.*Assigned-only scope: \["I1"\]/s);
    t.tool('read'); t.user(); t.tool('read');
    assert.deepEqual(t.added(await t.request()), delivered, 'later requests repeat the brief and do not add it again');
    // The plan moves on: the new brief follows the latest message, the old one stays.
    await f.report({ op: 'revise', plan: 'P-alpha', oid: 'revise', rev: 2, title: 'Synthetic alpha r2' });
    t.user(); const revised = t.last;
    const second = t.added(await t.request());
    assert.equal(second.length, 2); assert.deepEqual(second[0], delivered[0]); assert.equal(second[1][0], revised); assert.match(second[1][1], /last-known revision 3/);
    // A lookup that times out adds nothing and leaves both briefs where they were.
    await f.report({ op: 'revise', plan: 'P-alpha', oid: 'revise-again', rev: 3, title: 'Synthetic alpha r3' });
    const release = deferred(); let calls = 0;
    f.lookup = async (id: string) => { if (++calls > 1) await release.promise; return f.info(id); };
    t.user(); assert.deepEqual(t.added(await t.request()), second);
    release.resolve(); f.lookup = async (id: string) => f.info(id); await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(new Set(t.systems).size, 1);
  });
});

test('a standing capsule or refusal is delivered again when its carrier is gone, and a gone carrier keeps nothing alive', async () => {
  await fixture(async f => {
    f.seed();
    const refusals = refusalReads();
    try {
      const t = conversation(f); refusals.set(refusals.refused('d1'));
      await f.compact(); t.user();
      const first = t.added(await t.request());
      assert.equal(first.length, 1); const [capsuleText, refusalText] = first[0][1].split('\n\n');
      assert.match(capsuleText, /^## Progress resume/); assert.equal(first[0][1], `${capsuleText}\n\n${refusalText}`);
      await f.compact(); t.user();
      assert.equal(t.added(await t.request()).length, 1, 'unchanged text with its carrier present is not delivered again, and consumes the armed capsule');
      // Compaction rebuilds the prompt: the old carriers are gone, the text is unchanged.
      const rebuilt = conversation(f); rebuilt.user('Summary of the earlier conversation');
      await f.compact();
      const again = rebuilt.added(await rebuilt.request());
      assert.deepEqual(again, [[0, first[0][1]]], 'both standing notes arrive again after the latest message');
      // A reverted message: the carrier of the last delivery is missing from this request.
      rebuilt.user(); rebuilt.user();
      const reverted = rebuilt.history.slice(); reverted.splice(0, 1, { role: 'user', content: [textPart('A different first message')] });
      const c = await rebuilt.request(true, false, reverted);
      assert.equal(rebuilt.added(c, reverted).filter(([, text]) => text.includes(refusals.text('d1'))).length, 1);
    } finally { refusals.restore(); }
  });
});

test('a failed or incomplete refusal read adds no cleared line; only a complete read that finds none does', async () => {
  await fixture(async f => {
    f.seed();
    const refusals = refusalReads();
    try {
      const t = conversation(f); refusals.set(refusals.refused('d1')); t.user();
      assert.equal(t.added(await t.request()).length, 1);
      refusals.set('fail'); t.user(); assert.equal(t.added(await t.request()).length, 1, 'a failed read adds nothing');
      refusals.set({ complete: false, refusals: [] }); t.user();
      assert.ok(!t.added(await t.request()).some(([, text]) => text.includes(CLEARED)), 'an incomplete read adds no cleared line');
      // No cleared line while the last refusal delivered is not in this request.
      refusals.set({ complete: true, refusals: [] });
      const other = conversation(f); other.user();
      assert.deepEqual(other.added(await other.request()), [], 'a request that does not hold the refusal has nothing to clear');
      t.user(); const last = t.last;
      const done = t.added(await t.request());
      assert.deepEqual(done.at(-1), [last, CLEARED]);
    } finally { refusals.restore(); }
  });
});

test('a tool call identifier reused in a later turn does not receive the earlier note', async () => {
  await fixture(async f => {
    f.seed();
    const t = conversation(f);
    await f.after(writeEvent('docs/plans/search.md', 'w1')); t.user(); t.tool('write', 'First result', 'call_shared'); const first = t.last;
    assert.deepEqual(t.added(await t.request()), [[first, HINT]]);
    t.user(); t.tool('write', 'Second result', 'call_shared');
    assert.deepEqual(t.added(await t.request()), [[first, HINT]], 'the later result with the same identifier stays unchanged');
    // The same position and identifier with a different original output is a different carrier.
    const edited = t.history.slice(); edited[first] = { ...edited[first], content: [{ ...edited[first].content[0], result: { type: 'content', value: [textPart('Another output')] } }] };
    const c = await t.request(true, false, edited);
    assert.deepEqual(t.added(c, edited), [], 'the note belongs to the original output');
  });
});

test('delivered notes are removed with the section and come back with it; only capture off clears the memory', async () => {
  await fixture(async f => {
    f.seed();
    const t = conversation(f);
    await f.after(writeEvent('docs/plans/search.md', 'w1')); t.user(); t.tool(); const hinted = t.last;
    assert.deepEqual(t.added(await t.request()), [[hinted, HINT]]);
    // No report tool, a failed caller lookup: no section and no note, nothing lost.
    t.user();
    const noTool = await t.request(false, false); assert.equal(parts(noTool).length, 0); assert.deepEqual(t.added(noTool), []);
    f.lookup = async () => { throw new Error('lookup unavailable'); };
    const noCaller = await t.request(true, false); assert.equal(parts(noCaller).length, 0); assert.deepEqual(t.added(noCaller), []);
    f.lookup = async (id: string) => f.info(id);
    const back = await t.request(true, false); assert.equal(parts(back).length, 1); assert.deepEqual(t.added(back), [[hinted, HINT]], 'the note returns with the section');
    // A reused event that already carries notes loses them where the section goes.
    const reused = await t.request(); assert.equal(t.added(reused).length, 1);
    f.lookup = async () => { throw new Error('lookup unavailable'); }; await f.context(reused); f.lookup = async (id: string) => f.info(id);
    assert.equal(parts(reused).length, 0); assert.deepEqual(t.added(reused), []);
    // Capture off clears the memory: the note does not return when capture is on again.
    f.store.setEnabled(false); const off = await t.request(true, false); assert.equal(parts(off).length, 0); assert.deepEqual(t.added(off), []);
    f.store.setEnabled(true); const on = await t.request(true, false); assert.equal(parts(on).length, 1); assert.deepEqual(t.added(on), []);
  });
});

test('a user message identifier keeps its note across a shifted history; without one the position and content are the key', async () => {
  for (const withId of [true, false]) await fixture(async f => {
    f.seed();
    const t = conversation(f, withId);
    t.user('First'); await f.after(writeEvent('docs/plans/search.md', 'w1')); t.user('Second'); const carrier = t.last;
    assert.deepEqual(t.added(await t.request()), [[carrier, HINT]]);
    t.user('Third');
    const shifted = [{ role: 'user', content: [textPart('Summary')] }, ...t.history];
    const c = await t.request(true, false, shifted);
    assert.deepEqual(t.added(c, shifted), withId ? [[carrier + 1, HINT]] : []);
  });
});

test('memory is bounded: 128 sessions, 64 carriers and 64 KiB per session, absent carriers first', async () => {
  await fixture(async f => {
    f.seed();
    // Sessions: the least recently used loses its notes.
    const sessions = Array.from({ length: 129 }, (_, i) => conversation(f, false, `ses_s${i}`));
    for (const [i, s] of sessions.entries()) { await f.after(writeEvent('docs/plans/search.md', `s${i}`, `ses_s${i}`)); s.user(); s.tool(); assert.equal(s.added(await s.request()).length, 1); }
    assert.equal(sessions[1].added(await sessions[1].request(true, false)).length, 1);
    assert.equal(sessions[128].added(await sessions[128].request(true, false)).length, 1);
    assert.deepEqual(sessions[0].added(await sessions[0].request(true, false)), [], 'the least recently used session was evicted');
    // Carriers: 65 carried hints on one session keep 64, oldest first.
    const t = conversation(f);
    for (let i = 0; i < 65; i++) { await f.after(writeEvent('docs/plans/search.md', `c${i}`)); t.user(); const c = await t.request(true, false); assert.equal(t.added(c).at(-1)![0], t.last); }
    const full = t.added(await t.request(true, false)); assert.equal(full.length, 64);
    assert.ok(!full.some(([i]) => i === 0) && full.some(([i]) => i === 1), 'the first carrier lost its note');
    // A carrier absent from the latest request goes before older ones that are present.
    const trimmed = t.history.slice(); trimmed[40] = { role: 'user', content: [textPart('Edited')] };
    await f.after(writeEvent('docs/plans/search.md', 'c-next')); const next = [...trimmed, { role: 'user', content: [textPart('Newest')] }];
    await t.request(true, false, next);
    const extended = [...t.history, { role: 'user', content: [textPart('Newest')] }];
    const kept = t.added(await t.request(true, false, extended), extended).map(([i]) => i);
    assert.ok(kept.includes(1), 'an older present carrier kept its note');
    assert.ok(!kept.includes(40), 'the absent carrier was evicted first');
  });
});

test('memory is bounded to 64 KiB of note text per session, oldest first', async () => {
  await fixture(async f => {
    f.seed();
    const refusals = refusalReads();
    try {
      const t = conversation(f), long = Array.from({ length: 30 }, (_, i) => `T${String(i).padStart(2, '0')}-${'x'.repeat(40)}`);
      const sizes: number[] = [], carriers: number[] = [];
      for (let i = 0; i < 40; i++) {
        refusals.set(refusals.refused(`d${i}`, long)); t.user(); carriers.push(t.last);
        const added = t.added(await t.request(true, false)); sizes.push(Buffer.byteLength(added.at(-1)![1]));
        const total = added.reduce((n, [, text]) => n + Buffer.byteLength(text), 0);
        assert.ok(total <= 64 * 1024, `note text stays within 64 KiB: ${total}`);
      }
      assert.ok(sizes.reduce((a, b) => a + b) > 64 * 1024 && Math.min(...sizes) > 1500, 'each refusal note is large enough to fill the bound');
      const final = t.added(await t.request(true, false));
      assert.ok(!final.some(([i]) => i === 0), 'the oldest note was evicted'); assert.ok(final.some(([i]) => i === t.last), 'the newest is kept'); assert.ok(final.some(([i]) => i === carriers[35]), 'recent notes stay in place on later requests');
    } finally { refusals.restore(); }
  });
});

test('an armed capsule waits for a request with a carrier; an assigned child brief rides any tool continuation', async () => {
  await fixture(async f => {
    f.seed(); await f.compact();
    const text = (value: string) => ({ type: 'text', text: value });
    const user = { role: 'user', content: [text('Make a plan')] };
    const result = (name: string) => ({ role: 'tool', content: [{ type: 'tool-result', id: 'c1', name, result: { type: 'content', value: [text('out')] } }] });
    const without = context(); without.messages = [user, { role: 'assistant', content: [text('Partial answer')] }];
    const before = f.reads; f.tick(); await f.context(without);
    assert.deepEqual(without.messages[1], { role: 'assistant', content: [text('Partial answer')] }); assert.equal(f.reads, before, 'no lookup without a carrier');
    assert.equal(without.system.filter((p: any) => p.text === BASE).length, 1, 'the section is still the fixed guidance');
    const delivered = await f.next(); assert.ok(capsule(delivered)); assert.equal(f.reads, before + 1, 'the capsule was not consumed by the request that had no carrier');
    assert.equal(capsule(await f.next()), '');
    // A child's standing brief is read again on every request, so it must survive a continuation ending in any ordinary tool result.
    assert.equal((await f.report({ op: 'link', plan: 'P-alpha', oid: 'link', rev: 1, child: 'ses_C', assign: ['I1'] })).error, undefined);
    for (const name of ['read', 'shell', 'write']) {
      const c = context('ses_C'); c.messages = [user, { role: 'assistant', content: [] }, result(name)]; f.tick(); await f.context(c);
      assert.match(requestNote(c), /Assigned-only scope: \["I1"\]/, name);
    }
    const wrapper = context('ses_C'); wrapper.messages = [user, { role: 'assistant', content: [] }, result('execute')]; f.tick(); await f.context(wrapper);
    assert.equal(requestNote(wrapper), '', 'a Code Mode wrapper result stays the script value');
  });
});

test('V8 optional recovery subscription/hook/stream failure retains generic activation and file hints', async () => {
  for (const unsupported of ['subscribe', 'hook', 'stream'] as const) await fixture(async f => {
    f.seed(); await f.after(writeEvent()); const c = await f.next();
    assert.equal(capsule(c), ''); assert.equal(parts(c).length, 1); assert.equal(parts(c)[0].text, BASE); assert.ok(requestNote(c).includes(HINT)); assert.equal(f.reads, 0);
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
