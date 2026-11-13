import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {requestedGuestCapabilities} from '@openchamber/sdk';
import {parseManifestJson} from '@openchamber/sdk/schemas';

test('composer contributions use one built background entry without content permissions',()=>{
  const parsed=parseManifestJson(readFileSync(new URL('../../package.json',import.meta.url),'utf8'));
  assert.ok(parsed.ok);
  const c=parsed.manifest.contributes;
  assert.deepEqual(c.background,{entry:'background/index.html'});
  assert.deepEqual(c.mentions,{label:'Agent progress'});
  assert.deepEqual(c.actions,[
    {id:'insert-handoff',label:'Insert handoff',where:'session',mode:'background'},
    {id:'insert-progress-update',label:'Insert progress update',where:'session',mode:'background'},
  ]);
  assert.deepEqual(requestedGuestCapabilities(c).sort(),['opencodePlugin','service','sessions']);
  assert.equal(c.opencodePlugin,'build/companion');
  assert.equal(parsed.manifest.engines?.openchamber,'>=2.7.1');
});
