/** Owner-only phone candidate projection. Does not start a host or publish any listener. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const index=process.argv.indexOf('--output');
assert.ok(index>=0&&process.argv[index+1],'explicit --output required');
const output=path.resolve(process.argv[index+1]);
assert.ok(!fs.existsSync(output),'refuse an existing output directory');
const entries=['build/service/main.js','build/setup/main.js',...['index.js','package.json','SKILL.md'].map(f=>`build/companion/${f}`),...['background','ui/panel','ui/status','ui/page'].flatMap(s=>[`${s}/index.html`,`${s}/main.js`])];
const hashes:Record<string,string>={};
fs.mkdirSync(output,{recursive:true,mode:0o700});
for(const entry of entries){
  const bytes=fs.readFileSync(entry),target=path.join(output,entry);
  fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o700});fs.writeFileSync(target,bytes);
  assert.ok(bytes.equals(fs.readFileSync(target)),'verbatim phone candidate runtime');
  hashes[entry]=createHash('sha256').update(bytes).digest('hex');
}
const manifest=JSON.parse(fs.readFileSync('package.json','utf8'));
manifest.openchamber.contributes.panel.mobile=true;
manifest.openchamber.contributes.page.mobile=true;
fs.writeFileSync(path.join(output,'package.json'),JSON.stringify(manifest,null,2)+'\n');
fs.writeFileSync(path.join(output,'phone-candidate.json'),JSON.stringify({purpose:'Disposable owner QA only; not a release acceptance',manifestOnlyChanges:['panel.mobile','page.mobile'],runtimeHashes:hashes},null,2)+'\n');
console.log('Created disposable phone candidate; runtime entries verified verbatim. No host started.');
