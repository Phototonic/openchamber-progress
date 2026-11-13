/** Distribution contract: the host consumes a committed, self-contained plugin folder. */
import assert from 'node:assert/strict';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';

export function verifyCompanionEntry(root: string) {
  const manifest=JSON.parse(readFileSync(path.join(root,'package.json'),'utf8'));
  assert.equal(manifest.openchamber.contributes.opencodePlugin,'build/companion');
  assert.equal(manifest.openchamber.engines.openchamber,'>=2.7.1');
  const folder=path.join(realpathSync(root),manifest.openchamber.contributes.opencodePlugin);
  assert.equal(lstatSync(folder).isDirectory(),true);
  assert.equal(realpathSync(folder),folder,'plugin folder must not escape the package');
  const plugin=JSON.parse(readFileSync(path.join(folder,'package.json'),'utf8'));
  assert.equal(plugin.version,manifest.version);
  assert.equal(plugin.type,'module');
  assert.equal(plugin.exports['.'],'./index.js');
  for(const name of ['index.js','package.json','SKILL.md']) {
    const file=path.join(folder,name);
    assert.equal(lstatSync(file).isFile(),true);
    assert.equal(lstatSync(file).isSymbolicLink(),false);
    assert.equal(realpathSync(file),file);
  }
  return folder;
}
