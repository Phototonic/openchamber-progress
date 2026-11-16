import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activationFixture, activationContext, writeEvent } from '../fixtures/activation-production.ts';
import { REPORT_CHECKLIST } from '../../plugin/activation.ts';
import { trackerShape } from '../fixtures/activation-proxy-shapes.ts';

const dispatch = (id = 'dispatch', messageID = 'step-dispatch'): any => ({
  tool: 'subagent', sessionID: 'ses_M', agent: 'coordinator-x', messageID, id,
  input: { agent: 'worker', description: 'Synthetic worker', prompt: 'Synthetic task' }, status: 'completed',
  result: { output: { sessionID: 'ses_child', status: 'completed', output: 'Synthetic worker complete' }, content: 'Original dispatch result' },
});
const section = (context: any) => context.system.filter((part: any) => part.text.startsWith('# Agent progress (companion)'));
const notes = (event: any) => JSON.stringify(event.result?.content ?? '').includes('Agent Progress note');
const snapshot = (f: any) => Object.fromEntries(f.store.db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all()
  .map(({ name }: any) => [name, f.store.db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()]));
// Model-facing view deliberately discards every system section, not just ours.
const providerView = (f: any, events: any[]) => ({
  tools: [...f.tools, ['subagent', { description: 'Dispatch a worker' }], ['write', { description: 'Write one file' }]]
    .map(([name, tool]: any) => ({ name: `mcp__opencode__${name}`, description: tool.description })),
  messages: events.map(event => ({ role: 'tool', name: `mcp__opencode__${event.tool}`, result: event.result })),
});
async function context(f: any, sessionID = 'ses_M', available = true) {
  const event = activationContext(sessionID, available); event.messages = [];
  Object.assign(event.tools, Object.fromEntries(['subagent', 'write', 'edit', 'linear_save_issue', 'linear_save_comment'].map(name => [name, {}])));
  await f.context(event); return event;
}

test('provider view without system text gets plan and dispatch notes through production adapter, without reports', async () => {
  await activationFixture(async f => {
    await context(f);
    f.after = f.afterHint;
    const before = snapshot(f);
    const events = [dispatch(), writeEvent('openspec/changes/example/tasks.md', 'spec'),
      writeEvent(`${f.root}/sibling/.slim/plans/example.md`, 'sibling')];
    for (const event of events) {
      event.result.content ??= 'Original write result';
      event.messageID = `step-${event.id}`;
      const output = structuredClone(event.result.output);
      await f.after(event);
      assert.deepEqual(event.result.output, output, 'structured result remains intact');
      assert.ok(notes(event), 'system-dropping provider needs the result carrier');
    }
    f.lookup = async (id: string) => ({ ...f.info(id), ...(id === 'ses_child' ? { parentID: 'ses_M', location: { directory: `${f.root}/sibling` } } : {}) });
    await f.after(writeEvent('openspec/changes/example/proposal.md', 'planner-write', 'ses_child'));
    const returning = dispatch('planner-return', 'step-planner'); await f.after(returning);
    assert.ok(notes(returning)); assert.match(JSON.stringify(returning.result.content), /canonical plan/);
    const later = dispatch('later-return', 'step-later'); await f.after(later);
    assert.ok(notes(later)); assert.doesNotMatch(JSON.stringify(later.result.content), /canonical plan/, 'parent plan note consumed independently once');
    const view = providerView(f, [...events, returning]);
    assert.ok(view.tools[0].description.startsWith(REPORT_CHECKLIST));
    assert.equal(view.messages.length, 4);
    assert.deepEqual(snapshot(f), before, 'delivery does not mutate any store table');
  });
});

test('description keeps the checklist and executable prerequisite example inside the smallest client cut', async () => {
  await activationFixture(async f => {
    const description = f.tools.get('agent_progress_report').description;
    assert.ok(description.startsWith(REPORT_CHECKLIST));
    assert.ok(description.length <= 4096);
    const example = /```json\s*([\s\S]*?)```/.exec(description)!;
    assert.ok(example && example.index + example[0].length <= 2048);
    assert.ok(JSON.parse(example[1]).items[1].dependencies.length);
    for (const text of [f.skill.content]) assert.ok(text.startsWith(REPORT_CHECKLIST));
    assert.match(f.skill.description, /writing, receiving or coordinating a plan.*before dispatching sub-agents/);
  });
});

test('run recorder sees unchanged structured native dispatch output in either advisory-observer order', async () => {
  for (const reverse of [false, true]) await activationFixture(async f => {
    f.lookup = async (id: string) => ({ ...f.info(id), ...(id === 'ses_child' ? { parentID: 'ses_M' } : {}) });
    await context(f);
    const event = dispatch(), original = structuredClone(event.result);
    await f.before(event);
    await (reverse ? f.afterReverse(event) : f.after(event));
    const deadline = Date.now() + 2000;
    let run: any;
    do {
      run = f.store.db.prepare('SELECT child FROM runs_rows WHERE call=?').get(event.id);
      if (run?.child) break;
      await new Promise<void>(resolve => setImmediate(resolve));
    } while (Date.now() < deadline);
    assert.equal(run?.child, 'ses_child', 'production run recorder verified the returned child');
    assert.deepEqual(event.result.output, original.output);
    assert.ok(notes(event));
  });
});

test('spec plan and host-listed worktree recognition is lexical and relays only to the verified direct parent', async () => {
  await activationFixture(async f => {
    const accepted = ['openspec/changes/example/tasks.md', 'openspec/changes/example/proposal.md',
      `${f.root}/sibling/.slim/plans/example.md`];
    for (const [i, file] of accepted.entries()) {
      await f.after(writeEvent(file, `accept-${i}`));
      assert.ok(section(await context(f))[0].text.includes('A possible plan document'));
    }
    const rejected = ['openspec/changes/archive/example/tasks.md', 'openspec/changes/example/specs/plans/example.md',
      'openspec/changes/example/design.md', `${f.root}/elsewhere/plans/x.md`];
    for (const [i, file] of rejected.entries()) {
      await f.after(writeEvent(file, `reject-${i}`));
      assert.ok(!section(await context(f))[0].text.includes('A possible plan document'));
    }
    f.worktrees = async () => { throw new Error('Unavailable list'); };
    await f.after(writeEvent(`${f.root}/sibling/plans/x.md`, 'unavailable'));
    assert.ok(!section(await context(f))[0].text.includes('A possible plan document'));
  });
});

test('result carrier fails closed, coalesces by model step, dedupes calls and retires on disposal', async () => {
  await activationFixture(async f => {
    const unknown = dispatch('unknown'); await f.after(unknown); assert.ok(!notes(unknown));
    await context(f, 'ses_M', false);
    const hidden = dispatch('hidden'); await f.after(hidden); assert.ok(!notes(hidden));
    await context(f);
    const first = dispatch('first', 'one-step'); const second = dispatch('second', 'one-step');
    await f.after(first); await f.after(second); assert.ok(notes(first)); assert.ok(!notes(second));
    const replay = dispatch('first', 'one-step'); await f.after(replay); assert.ok(!notes(replay));
    await context(f, 'ses_M', false);
    const restricted = dispatch('restricted', 'new-step'); await f.after(restricted); assert.ok(!notes(restricted));
    await context(f); f.store.setEnabled(false);
    const disabled = dispatch('disabled', 'disabled-step'); await f.after(disabled); assert.ok(!notes(disabled));
    f.store.setEnabled(true); await context(f);
    const invalid = [ { ...dispatch('failed'), status: 'error', error: {} },
      { ...writeEvent('plan.md', 'partial'), result: { ...writeEvent().result, metadata: { partial: true } } },
      writeEvent('openspec/changes/archive/example/tasks.md', 'archive'),
      writeEvent(`${f.root}/elsewhere/plans/x.md`, 'outside') ];
    for (const event of invalid) { const original = structuredClone(event); await f.after(event); assert.deepEqual(event, original); }
    const tracker = { ...dispatch('tracker', 'tracker-step'), tool: 'linear_save_issue', input: {}, result: { output: trackerShape('save_issue'), content: [{ type: 'text', text: 'Original tracker result' }] } };
    await f.after(tracker); assert.ok(notes(tracker));
    const codeMode = { ...tracker, id: 'inner', messageID: 'code-step', result: { output: trackerShape('save_issue') } };
    await f.after(codeMode); assert.ok(!notes(codeMode), 'unknown or structured-only carrier stays untouched');
    const innerContext = activationContext(); innerContext.tools.execute = {};
    await f.context(innerContext);
    const inner = { ...tracker, id: 'inner-content', messageID: 'inner-step', result: { output: trackerShape('save_issue'), content: 'Original inner result' } };
    await f.after(inner); assert.ok(!notes(inner), 'Code Mode inner tool is not exposed directly');
    const after = f.after; await f.dispose();
    assert.equal(f.hooks.size, 0); void after;
  });
  await activationFixture(async f => {
    await context(f); const unverified = dispatch(); await f.after(unverified); assert.ok(!notes(unverified));
  }, false);
});
