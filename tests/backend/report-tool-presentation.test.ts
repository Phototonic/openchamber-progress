import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseManifestJson } from '@openchamber/sdk/schemas';

const candidate=JSON.parse(readFileSync('package.json','utf8'));
const presentation={match:'agent_progress_report',name:'Agent progress report',icon:'list-check-2',output:'text'};

test('candidate SDK parser retains exact neutral report identity and literal text, without outcome templates',()=>{
  const parsed=parseManifestJson(JSON.stringify(candidate));
  assert.equal(parsed.ok,true);
  if(!parsed.ok)throw new Error('candidate manifest rejected');
  assert.deepEqual(candidate.openchamber.contributes.tools,[presentation]);
  assert.deepEqual(parsed.manifest.contributes.tools,[presentation]);
  assert.equal(candidate.openchamber.engines.openchamber,'>=2.7.1');
  assert.equal(candidate.dependencies['@openchamber/sdk'],'2.7.1');
  assert.equal(candidate.dependencies['@opencode/plugin'],'2.1.4');
  const without=structuredClone(candidate);delete without.openchamber.contributes.tools;
  const baseline=parseManifestJson(JSON.stringify(without));assert.equal(baseline.ok,true);
  if(!baseline.ok)throw new Error('baseline manifest rejected');
  const {tools,...contributions}=parsed.manifest.contributes;
  assert.deepEqual(contributions,baseline.manifest.contributes,'presentation adds no grants or changes to runtime contributions');
  assert.equal(candidate.openchamber.contributes.opencodePlugin,'build/companion');
  assert.deepEqual(candidate.openchamber.contributes.capabilities,['sessions']);
  assert.deepEqual(candidate.openchamber.contributes.service,{entry:'build/service/main.js',runtime:'host',permissions:{}});
});

test('distribution projection preserves the complete presentation through the actual SDK parser',()=>{
  // package.ts copies this block as-is; the separate folder/ZIP gate checks its artifacts.
  const {name,version,license,openchamber}=candidate;
  const parsed=parseManifestJson(JSON.stringify({name,version,license,type:'module',openchamber}));
  assert.equal(parsed.ok,true);
  if(!parsed.ok)throw new Error('distribution manifest rejected');
  assert.deepEqual(parsed.manifest.contributes.tools,[presentation]);
});

test('installed SDK supports independent literal-true mobile opt-ins; shipped manifest retains omission',()=>{
  const sdk=JSON.parse(readFileSync('node_modules/@openchamber/sdk/package.json','utf8'));
  assert.equal(sdk.version,'2.7.1');
  assert.equal('mobile' in candidate.openchamber.contributes.panel,false);
  assert.equal('mobile' in candidate.openchamber.contributes.page,false);
  for(const surface of ['panel','page']) {
    const enabled=structuredClone(candidate);enabled.openchamber.contributes[surface].mobile=true;
    const parsed=parseManifestJson(JSON.stringify(enabled));assert.equal(parsed.ok,true);
    if(!parsed.ok)throw new Error('mobile fixture rejected');
    assert.equal((parsed.manifest.contributes[surface as 'panel'|'page'] as {mobile?:true}).mobile,true);
    const other=surface==='panel'?'page':'panel';
    assert.equal('mobile' in (parsed.manifest.contributes[other] as object),false);
    for(const invalid of [false,'true',1]) {
      enabled.openchamber.contributes[surface].mobile=invalid;
      assert.equal(parseManifestJson(JSON.stringify(enabled)).ok,false);
    }
  }
});
