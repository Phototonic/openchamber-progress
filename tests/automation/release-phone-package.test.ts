import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

test('phone QA projection changes only mobile opt-ins and refuses to overwrite',()=>{
  const root=fs.mkdtempSync('/tmp/opencode/phone-package-'),output=path.join(root,'candidate');
  const run=()=>spawnSync(process.execPath,['--experimental-strip-types','tests/fixtures/release-140-phone-package.ts','--output',output],{encoding:'utf8',timeout:10000});
  try{
    assert.equal(run().status,0,'candidate projection');
    const projected=JSON.parse(fs.readFileSync(path.join(output,'package.json'),'utf8'));
    const expected=JSON.parse(fs.readFileSync('package.json','utf8'));
    expected.openchamber.contributes.panel.mobile=true;
    expected.openchamber.contributes.page.mobile=true;
    assert.deepEqual(projected,expected,'no unrelated manifest edits');
    const inventory=JSON.parse(fs.readFileSync(path.join(output,'phone-candidate.json'),'utf8'));
    assert.equal(Object.keys(inventory.runtimeHashes).length,13,'all runtime and HTML entries');
    for(const [entry,hash] of Object.entries(inventory.runtimeHashes)){
      const source=fs.readFileSync(entry),copy=fs.readFileSync(path.join(output,entry));
      assert.ok(source.equals(copy),`verbatim ${entry}`);
      assert.equal(createHash('sha256').update(copy).digest('hex'),hash);
    }
    fs.writeFileSync(path.join(output,'sentinel'),'retain');
    assert.notEqual(run().status,0,'existing candidate refused');
    assert.equal(fs.readFileSync(path.join(output,'sentinel'),'utf8'),'retain');
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
