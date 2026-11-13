import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {hostPackageVersion} from '../../scripts/host-package-version.ts';

test('installer gates use the supplied host package version, not the candidate floor',()=>{
  const root=mkdtempSync(join(tmpdir(),'host-version-'));
  try {
    const module=join(root,'server/lib/guests/install.js');
    mkdirSync(join(root,'server/lib/guests'),{recursive:true});
    for(const version of ['2.5.1','2.7.0','2.7.1']){
      writeFileSync(join(root,'package.json'),JSON.stringify({name:'@openchamber/web',version}));
      assert.equal(hostPackageVersion(module),version);
    }
    writeFileSync(join(root,'package.json'),JSON.stringify({name:'unrelated',version:'2.7.1'}));
    assert.throws(()=>hostPackageVersion(module),/isolated web host package/);
    writeFileSync(join(root,'package.json'),JSON.stringify({name:'@openchamber/web',version:'unknown'}));
    assert.throws(()=>hostPackageVersion(module),/host package version required/);
  }finally{rmSync(root,{recursive:true,force:true});}
});
