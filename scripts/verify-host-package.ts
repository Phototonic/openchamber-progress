/** Optional actual-host installer gate. Parent supplies an extracted host module. */
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {hostPackageVersion} from './host-package-version.ts';

const moduleFile=process.env.AGENT_PROGRESS_HOST_MODULE;
assert.ok(moduleFile&&path.isAbsolute(moduleFile),'explicit host installer module required');
const openchamberVersion=hostPackageVersion(moduleFile);
const expectRefusal=process.argv.includes('--expect-refusal');
const {installGuestFromPath}=await import(pathToFileURL(moduleFile).href);
for(const [kind,artifact] of [['folder',process.argv[2]],['zip',`${process.argv[2]}.zip`]]) {
  const persist=path.join(process.env.HOME!,`extensions-${kind}.json`);
  const result=await installGuestFromPath(artifact,persist,{openchamberVersion});
  if(expectRefusal){
    assert.equal(result.ok,false,'older host must refuse the unchanged candidate');
    assert.equal(result.code,'host-too-old','normal host version feedback required');
    assert.equal(result.required,'2.7.1');
    assert.equal(existsSync(persist),false,'refusal must not register an installation');
    console.log(JSON.stringify({actualHostInstaller:kind,hostVersion:openchamberVersion,accepted:false,code:result.code,required:result.required}));
    continue;
  }
  assert.equal(result.ok,true,JSON.stringify(result));
  const installed=JSON.parse(readFileSync(persist,'utf8')).paths[0];
  const manifest=JSON.parse(readFileSync(path.join(installed,'package.json'),'utf8'));
  assert.equal(result.guest.version,manifest.version);
  const entries=[manifest.openchamber.contributes.panel.entry,manifest.openchamber.contributes.page.entry,manifest.openchamber.contributes.statusSection.entry,manifest.openchamber.contributes.background.entry,'background/main.js',manifest.openchamber.contributes.service.entry];
  for(const entry of entries)assert.equal(existsSync(path.join(installed,entry)),true,entry);
  console.log(JSON.stringify({actualHostInstaller:kind,hostVersion:openchamberVersion,accepted:true,version:manifest.version,entries}));
}
