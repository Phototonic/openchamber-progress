/** Assemble approved outputs only. Never compiles or modifies Designer's guests. */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, rmSync, readdirSync, lstatSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { parseManifestJson } from '@openchamber/sdk/schemas';
import { digest } from '../shared/store.ts';
import { VERSION } from '../shared/progress.ts';
import { RELEASE } from '../shared/release.ts';

const source=JSON.parse(readFileSync('package.json','utf8'));
assert.equal(source.version,RELEASE);
assert.match(source.version,/^\d+\.\d+\.\d+$/);
assert.equal(VERSION,2); // Contract version is independent of package semver.
const version:string=source.version;
const output=path.resolve('build/artifacts');
mkdirSync(output,{recursive:true});
const extension=`agent-progress-extension-${version}`;
const companion=`agent-progress-companion-${version}`;
const builds=['build/companion/index.js','build/companion/SKILL.md','build/companion/package.json','build/setup/main.js'];
const guests=['panel','status','page'].flatMap(surface=>[`ui/${surface}/index.html`,`ui/${surface}/main.js`]);
const manifest={name:source.name,version,type:'module',openchamber:source.openchamber};
assert.equal(parseManifestJson(JSON.stringify(manifest)).ok,true);
assert.equal(source.openchamber.contributes.panel.id,'agent-progress-probe');
for(const [name,files,metadata] of [
  [extension,[...builds,'build/service/main.js',...guests],manifest],
  [companion,builds,{name:'openchamber-agent-progress-companion-installer',version,private:true,type:'module',scripts:{setup:'node build/setup/main.js'}}],
] as const) {
  const root=path.join(output,name);rmSync(root,{recursive:true,force:true});mkdirSync(root,{mode:0o700});
  writeFileSync(path.join(root,'package.json'),JSON.stringify(metadata,null,2)+'\n');
  for(const file of [...files,'docs/setup.md']) {
    assert.equal(lstatSync(file).isFile(),true);assert.equal(lstatSync(file).isSymbolicLink(),false);
    mkdirSync(path.dirname(path.join(root,file)),{recursive:true});copyFileSync(file,path.join(root,file));
  }
  // ZIP is a local transport, not an npm package; dependencies are already bundled.
  const archive=path.join(output,`${name}.zip`);rmSync(archive,{force:true});
  assert.equal(spawnSync('zip',['-q','-X','-r',archive,'.'],{cwd:root,stdio:'inherit'}).status,0,'local zip failed');
}
function files(root:string):string[] {return readdirSync(root).sort().flatMap(name=>{const file=path.join(root,name);return lstatSync(file).isDirectory()?files(file):[file];});}
const entries=[...files(path.join(output,extension)),...files(path.join(output,companion))].sort();
writeFileSync(path.join(output,`entries-${version}.sha256`),entries.map(file=>`${digest(readFileSync(file))}  ${path.relative(output,file)}`).join('\n')+'\n');
const inventory=files(output).filter(file=>path.basename(file)!=='sha256.txt');
writeFileSync(path.join(output,'sha256.txt'),inventory.map(file=>`${digest(readFileSync(file))}  ${path.relative(output,file)}`).join('\n')+'\n');
console.log(JSON.stringify({version,protocolVersion:VERSION,schemaVersion:VERSION,extension,companion,guestBundles:'copied-byte-for-byte',files:inventory.length}));
