/** Native-only affordance: compare the provider message and both observer orders. */
import assert from 'node:assert/strict';
export const PROBE_NOTE = '\n\nAgent Progress native carrier probe.';
export function probeResult(event: any, record: (value: any) => void) {
  if (event.status !== 'completed' || !['write', 'edit', 'subagent', 'linear_save_issue', 'linear_save_comment'].includes(event.tool)) return;
  const before = structuredClone(event.result);
  if (process.env.RESULT_NOTE_PROBE === '1') {
    const content = event.result.content;
    event.result = { ...event.result, content: typeof content === 'string' ? content + PROBE_NOTE
      : content === undefined ? JSON.stringify(event.result.output) + PROBE_NOTE
      : [...content, { type: 'text', text: PROBE_NOTE }] };
  }
  record({ type: 'note-probe', tool: event.tool, id: event.id, messageID: event.messageID, before, after: event.result });
}

export function checkNativeCarrier(probes: any[], requests: any[], codeMode = false) {
  const messages = requests.flatMap(request => request.prompt ?? []).filter(message => message.role === 'tool')
    .flatMap(message => message.content ?? []);
  for (const probe of probes) {
    assert.deepEqual(probe.after.output, probe.before.output, 'structured result survives replacement');
    assert.deepEqual(probe.after.metadata, probe.before.metadata, 'metadata survives replacement');
    const delivered = messages.find(message => message.toolCallId === probe.id);
    assert.ok(delivered, `provider received result for ${probe.tool}`);
    if (codeMode) {
      assert.ok(!JSON.stringify(delivered).includes(PROBE_NOTE.trim()), 'inner content note cannot be a carrier');
      assert.deepEqual(JSON.parse(delivered.output.value), probe.before.output, 'script returns unchanged structured data');
    } else if (process.env.RESULT_NOTE_PROBE === '1') {
      if (typeof probe.before.content === 'string') {
        assert.ok(delivered.output.value.startsWith(probe.before.content));
        assert.ok(delivered.output.value.endsWith(PROBE_NOTE));
      } else {
        assert.deepEqual(delivered.output.value.slice(0, probe.before.content.length), probe.before.content, 'original content is first');
        assert.equal(delivered.output.value.at(-1).text, PROBE_NOTE);
      }
    }
  }
}
