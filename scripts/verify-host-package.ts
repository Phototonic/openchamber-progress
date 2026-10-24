/** Optional actual-host installer gate. Parent supplies an extracted host module. */
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const moduleFile=process.env.AGENT_PROGRESS_HOST_MODULE;
assert.ok(moduleFile&&path.isAbsolute(moduleFile),'explicit host installer module required');
const {installGuestFromPath}=await import(pathToFileURL(moduleFile).href);
for(const [kind,artifact] of [['folder',process.argv[2]],['zip',`${process.argv[2]}.zip`]]) {
  const persist=path.join(process.env.HOME!,`extensions-${kind}.json`);
  const result=await installGuestFromPath(artifact,persist,{openchamberVersion:'2.5.1'});
  assert.equal(result.ok,true,JSON.stringify(result));
  const installed=JSON.parse(readFileSync(persist,'utf8')).paths[0];
  const manifest=JSON.parse(readFileSync(path.join(installed,'package.json'),'utf8'));
  assert.equal(result.guest.version,manifest.version);
  const entries=[manifest.openchamber.contributes.panel.entry,manifest.openchamber.contributes.page.entry,manifest.openchamber.contributes.statusSection.entry,manifest.openchamber.contributes.service.entry];
  for(const entry of entries)assert.equal(existsSync(path.join(installed,entry)),true,entry);
  console.log(JSON.stringify({actualHostInstaller:kind,accepted:true,version:manifest.version,entries}));
}
