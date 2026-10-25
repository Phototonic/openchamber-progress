import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { Effect } from 'effect';
import { activationFixture, activationContext as context, writeEvent as write } from '../fixtures/activation-production.ts';
import { ACTIVATION_GUIDANCE as BASE, ACTIVATION_HINT as HINT } from '../../plugin/activation.ts';
import { Store } from '../../shared/store.ts';

const copy = (c: any) => c.system.filter((p: any) => p.text.startsWith('# Agent progress (companion)'));
const hint = (c: any) => copy(c).some((p: any) => p.text.includes(HINT));
async function next(f: any, sessionID = 'ses_M', available = true) { const c = context(sessionID, available); await f.context(c); return c; }

test('production hooks via2.1.4 adapter: agnostic recurring section, idempotence and untouched context/mutations', async t => {
  await activationFixture(async f => {
    await f.report({ op: 'start', plan: 'existing', oid: 'start', rev: 0, title: 'Existing', items: [] });
    const before = f.store.get(f.binding.source.id, 'existing');
    const c = context(); const original = { system: c.system[0], messages: c.messages, tools: c.tools, options: c.options };
    const mutation = t.mock.method(Store.prototype, 'apply', () => { throw new Error('hook mutated progress'); });
    const scans = ['list', 'get', 'detail', 'document'].map(name => t.mock.method(Store.prototype as any, name, () => { throw new Error('hook scanned plans'); }));
    const reads = ['openSync', 'readSync', 'readFileSync', 'statSync', 'lstatSync', 'realpathSync'].map(name => t.mock.method(fs as any, name, () => { throw new Error('hook read document/filesystem'); }));
    syncBuiltinESMExports();
    try {
      await f.context(c); await f.context(c);
      assert.equal(copy(c).length, 1); assert.equal(copy(c)[0].text, BASE);
      assert.equal(c.system[0], original.system); assert.equal(c.messages, original.messages); assert.equal(c.tools, original.tools); assert.equal(c.options, original.options);
      const e = write('docs/plans/<injection>.md'); Object.defineProperty(e.input, 'content', { get() { throw new Error('body inspected'); } });
      await f.after(e); const delivered = await next(f);
      assert.equal(hint(delivered), true); assert.equal(JSON.stringify(delivered.system).includes('<injection>'), false);
      assert.equal(hint(await next(f)), false);
      const file = { file: 'docs/plans/search.md' }; Object.defineProperty(file, 'patch', { get() { throw new Error('diff inspected'); } });
      const edit = { ...write('docs/plans/search.md', 'edit-with-opaque-body'), tool: 'edit', input: { path: 'docs/plans/search.md' }, result: { output: { files: [file], replacements: 1 } } };
      Object.defineProperty(edit.input, 'oldString', { get() { throw new Error('edit body inspected'); } });
      await f.after(edit); assert.equal(hint(await next(f)), true, 'edit uses only path/success metadata');
      assert.equal(mutation.mock.callCount(), 0); for (const scan of scans) assert.equal(scan.mock.callCount(), 0); for (const read of reads) assert.equal(read.mock.callCount(), 0);
      assert.equal(f.permissions.length, 0);
    } finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
    assert.deepEqual(f.store.get(f.binding.source.id, 'existing'), before);
    assert.match(BASE, /no source/); assert.match(BASE, /only explicitly assigned items/); assert.match(BASE, /Ready is not review or acceptance/);
  });
});

test('covered creates/revisions coalesce, consume on delivery, dedupe and remain source/session-local', async () => {
  await activationFixture(async f => {
    const first = write(); const revision = write('.plans/search.markdown', 'revision'); revision.result.output.existed = true;
    const edit = { ...write('plan.md', 'edit'), tool: 'edit', input: { path: 'plan.md' }, result: { output: { replacements: 1, files: [{ file: 'plan.md' }] } } };
    await f.after(first); await f.after(revision); await f.after(edit);
    const c = await next(f); assert.equal(hint(c), true); assert.equal(copy(c).length, 1);
    await f.context(c); assert.equal(copy(c).length, 1);
    assert.equal(hint(await next(f)), false);
    await f.after(first); assert.equal(hint(await next(f)), false, 'recent same call cannot recreate hint');
    await f.after(write('plan.markdown', 'later')); assert.equal(hint(await next(f, 'ses_another')), false);
    await activationFixture(async other => { assert.equal(hint(await next(other)), false, 'different source/instance receives none'); });
    assert.equal(hint(await next(f)), true);
    await f.after(write('docs/plans/search.md', 'incomplete'));
    await f.report({ op: 'start', plan: 'reported', oid: 'reported', rev: 0, title: 'Already reported', items: [] });
    const claimed = context(); claimed.messages.push({ role: 'assistant', content: 'Already reported everything' }); await f.context(claimed);
    assert.equal(hint(claimed), true, 'receipt/model claims do not drive reminder state');
    assert.equal(hint(await next(f)), false);
  });
});

test('unknown/opaque/error/partial/unrelated metadata filters before lookup and cannot change original events', async () => {
  await activationFixture(async f => {
    const events = [
      ...['docs/plans/README.md', '.plans/TODO.markdown', 'notes.md', 'plans/search.txt', `plans/${'x'.repeat(4097)}.md`, 'plans/injection\n.md'].map((p, i) => write(p, String(i))),
      ...['shell', 'patch', 'apply_patch', 'functions.patch', 'unknown'].map(tool => ({ ...write(), tool })),
      { ...write(), status: 'error', error: { message: 'Partial bytes left after failure' } },
      { ...write(), status: 'cancelled' },
      { ...write(), status: 'partial' },
      { ...write(), result: { output: { operation: 'write', partial: true } } },
      { ...write(), result: { ...write().result, metadata: { partial: true } } },
      { ...write(), input: { filePath: 'docs/plans/search.md' } },
      { ...write(), result: { content: 'Success!' } },
      { ...write(), tool: 'edit', result: { output: { replacements: 0, files: [] } } },
    ];
    for (const e of events) { const before = structuredClone(e); await f.after(e); assert.deepEqual(e, before); }
    assert.equal(f.lookupCount, 0); assert.equal(hint(await next(f)), false);
    fs.mkdirSync(`${f.root}/project/docs/plans`, {recursive:true});
    const partial = `${f.root}/project/docs/plans/partial.md`; fs.writeFileSync(partial, '# Unfinished bytes');
    await f.after({...write('docs/plans/partial.md', 'partial-error'), status:'error', error:{message:'failed after writing bytes'}});
    assert.equal(hint(await next(f)), false); assert.equal(fs.readFileSync(partial,'utf8'), '# Unfinished bytes');
    // Lexical containment uses the verified directory, without any filesystem read.
    await f.after(write('../plans/outside.md', 'escape')); assert.equal(hint(await next(f)), false);
    await f.after(write(`${f.root}/project/docs/plans/inside.md`, 'absolute')); assert.equal(hint(await next(f)), true);
    await f.after(write('plans/draft.md', 'success-before-error')); await f.after({ ...write(), status: 'error' });
    assert.equal(hint(await next(f)), true, 'failed observation does not undo prior success');
  });
});

test('availability, unverified/failed identity and control failures fail closed; disabled drops hints without backfill', async t => {
  await activationFixture(async f => {
    await f.after(write()); assert.equal(copy(await next(f, 'ses_M', false)).length, 0); assert.equal(hint(await next(f)), false);
    await f.after(write('plan.md', 'disable')); f.store.setEnabled(false);
    const c = await next(f); assert.equal(copy(c).length, 0);
    await f.after(write('plan.md', 'disabled-write')); f.store.setEnabled(true); assert.equal(hint(await next(f)), false);
    const reused = await next(f); f.store.setEnabled(false); await f.context(reused); assert.equal(copy(reused).length, 0); f.store.setEnabled(true);
    f.lookup = async () => { throw new Error('lookup unavailable'); };
    await f.after(write('plan.md', 'lookup-error')); assert.equal(copy(await next(f)).length, 0);
    f.lookup = async () => f.info('ses_wrong-session'); assert.equal(copy(await next(f)).length, 0);
    f.lookup = async (id: string) => ({ ...f.info(id), location: { directory: 'not-absolute' } }); assert.equal(copy(await next(f)).length, 0);
    f.lookup = async (id: string) => ({ ...f.info(id), parentID: 'ses_missing-parent' });
    const lookups = f.lookupCount;
    assert.equal(copy(await next(f)).length, 1, 'conditional guidance neither scans nor grants ancestry authority');
    assert.equal(f.lookupCount, lookups + 1, 'only current session is needed for conditional guidance');
    const statementPrototype = Object.getPrototypeOf(f.store.db.prepare('SELECT enabled FROM meta'));
    const failure = t.mock.method(statementPrototype, 'get', () => { throw new Error('control unavailable'); });
    await f.after(write('plan.md', 'control-failure')); assert.equal(copy(await next(f)).length, 0);
    failure.mock.restore(); assert.equal(hint(await next(f)), false);
  });
  await activationFixture(async f => { await f.after(write()); assert.equal(f.lookupCount, 0); assert.equal(copy(await next(f)).length, 0); }, false);
});

test('local caps evict oldest hints/calls; fresh instance loses hints but retains deliberately recorded progress', async () => {
  await activationFixture(async f => {
    for (let i = 0; i < 129; i++) await f.after(write('plan.md', `pending-${i}`, `ses_session-${i}`));
    assert.equal(hint(await next(f, 'ses_session-0')), false); assert.equal(hint(await next(f, 'ses_session-128')), true, 'pending cap128');
    for (let i = 0; i < 257; i++) await f.after(write('plan.md', `recent-${i}`));
    assert.equal(hint(await next(f)), true);
    await f.after(write('plan.md', 'recent-256')); assert.equal(hint(await next(f)), false);
    await f.after(write('plan.md', 'recent-0')); assert.equal(hint(await next(f)), true, 'recent cap256 permits old replay after eviction');
    await f.report({ op: 'start', plan: 'retained', oid: 'start', rev: 0, title: 'Durable', items: [] });
    await f.after(write('plan.md', 'undelivered')); await f.reload();
    const fresh = await next(f); assert.equal(hint(fresh), false); assert.equal(copy(fresh).length, 1);
    assert.equal(f.store.get(f.binding.source.id, 'retained').revision, 1, 'same durable Store survives plugin reload');
    await f.dispose(); assert.equal(f.hooks.size, 0);
  });
});

test('disposal and observed disable invalidate awaited callbacks without late injection', {timeout:5000}, async () => {
  for (const mode of ['dispose', 'disable']) await activationFixture(async f => {
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; }); const started = new Promise<void>(resolve => { entered = resolve; });
    f.lookup = async (id: string) => { entered(); await gate; return f.info(id); };
    const c = context(); const task = f.context(c); await started;
    if (mode === 'dispose') await f.dispose();
    else { f.store.setEnabled(false); await f.context(context('ses_other')); f.store.setEnabled(true); }
    release(); await task; assert.equal(copy(c).length, 0);
  });
});

test('concurrent same-call replay cannot recreate a hint after intervening delivery', {timeout:5000}, async () => {
  await activationFixture(async f => {
    let releaseFirst!: () => void, releaseSecond!: () => void, bothEntered!: () => void;
    const firstGate = new Promise<void>(resolve => { releaseFirst = resolve; });
    const secondGate = new Promise<void>(resolve => { releaseSecond = resolve; });
    const entered = new Promise<void>(resolve => { bothEntered = resolve; });
    let calls = 0;
    f.lookup = async (id: string) => { calls++; if (calls === 1) await firstGate; else if (calls === 2) { bothEntered(); await secondGate; } return f.info(id); };
    const event = write(); const first = f.after(event), second = f.after(event); await entered;
    releaseFirst(); await first; assert.equal(hint(await next(f)), true);
    releaseSecond(); await second; assert.equal(hint(await next(f)), false);
  });
});

test('production executor keeps source-free/document/denied-read and caller-spoof boundaries unchanged', async () => {
  await activationFixture(async f => {
    const items = [{ id: 'a', title: 'First', kind: 'task' }, { id: 'b', title: 'Second', kind: 'task' }];
    const start = (plan: string) => ({ op: 'start', plan, oid: `start-${plan}`, rev: 0, title: plan, items });
    const structured = await f.report(start('P-structured')); assert.equal(structured.rev, 1); assert.equal(f.permissions.length, 0);
    assert.equal(f.store.get(f.binding.source.id, 'P-structured').document.state, 'unbound'); assert.deepEqual(fs.readdirSync(`${f.root}/project`), []);
    fs.mkdirSync(`${f.root}/project/docs/plans`, { recursive: true }); const file = `${f.root}/project/docs/plans/search.md`; const bytes = '# Canonical\n'; fs.writeFileSync(file, bytes);
    const doc = await f.report({ ...start('P-doc'), source: 'docs/plans/search.md' }); assert.equal(doc.rev, 1); assert.equal(f.store.get(f.binding.source.id, 'P-doc').document.state, 'captured');
    assert.ok(f.permissions.length >= 2); assert.equal(fs.readFileSync(file, 'utf8'), bytes);
    f.denyRead = true; const denied = await f.report({ ...start('P-denied'), source: 'docs/plans/search.md' }); assert.equal(denied.rev, 1); assert.equal(f.store.get(f.binding.source.id, 'P-denied').document.state, 'denied');
    f.lookup = async () => f.info('ses_spoofed'); const spoof = await f.report(start('P-spoof')); assert.equal(spoof.error, 'binding'); assert.equal(f.store.get(f.binding.source.id, 'P-spoof'), undefined);
    assert.equal(f.store.get(f.binding.source.id, 'P-structured').revision, 1);
  });
});
