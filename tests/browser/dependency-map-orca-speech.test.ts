import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOrcaSpeech, stripSsmlTags } from './dependency-map-orca-steps.ts';

test('SSML stripping reaches a fixpoint and preserves escaped literal title markup',()=>{
  for(const raw of ['<speak>Hello <mark name="0:5"/>world</speak>','<<one>two><three>text</three>','plain 日本語']){
    const stripped=stripSsmlTags(raw);
    assert.equal(stripSsmlTags(stripped),stripped);
  }
  assert.equal(stripSsmlTags('<speak>&lt;img src=x&gt;</speak>'),'&lt;img src=x&gt;');
  const log=`SPEECH DISPATCHER: Speaking '<speak><mark name="0:4"/>Task 日本語 &lt;img src=x&gt; &amp; &quot;quoted&quot; &apos;ok&apos;</speak>' \n                  ORCA rate 50, pitch 5\n`;
  assert.deepEqual(parseOrcaSpeech(log),['Task 日本語 <img src=x> & "quoted" \'ok\'']);
});
