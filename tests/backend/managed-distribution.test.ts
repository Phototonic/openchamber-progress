import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, renameSync, symlinkSync } from 'node:fs';
import { verifyCompanionEntry } from '../../scripts/companion-entry.ts';

function fixture() {
  const root=mkdtempSync('/tmp/opencode/managed-distribution-');
  mkdirSync(`${root}/build/companion`,{recursive:true});
  const manifest={version:'1.0.0',openchamber:{engines:{openchamber:'>=2.7.1'},contributes:{opencodePlugin:'build/companion'}}};
  const plugin={version:'1.0.0',type:'module',exports:{'.':'./index.js'}};
  const save=()=>{writeFileSync(`${root}/package.json`,JSON.stringify(manifest));writeFileSync(`${root}/build/companion/package.json`,JSON.stringify(plugin));};
  save();writeFileSync(`${root}/build/companion/index.js`,'export default {};');writeFileSync(`${root}/build/companion/SKILL.md`,'Synthetic guidance');
  return {root,manifest,plugin,save,clean(){rmSync(root,{recursive:true,force:true});}};
}
test('declared managed plugin directory resolves its shipped ESM entry without consumer dependencies',()=>{
  const f=fixture();try{assert.equal(verifyCompanionEntry(f.root),`${f.root}/build/companion`);}finally{f.clean();}
});
test('missing entry, mismatched release, wrong contribution and aliased folder refuse distribution',()=>{
  for(const mode of ['missing','version','entry','contribution','alias']) {
    const f=fixture();try{
      if(mode==='missing')rmSync(`${f.root}/build/companion/index.js`);
      if(mode==='version'){f.plugin.version='2.0.0';f.save();}
      if(mode==='entry'){f.plugin.exports['.']='./missing.js';f.save();}
      if(mode==='contribution'){f.manifest.openchamber.contributes.opencodePlugin='../foreign';f.save();}
      if(mode==='alias'){renameSync(`${f.root}/build/companion`,`${f.root}/elsewhere`);symlinkSync(`${f.root}/elsewhere`,`${f.root}/build/companion`);}
      assert.throws(()=>verifyCompanionEntry(f.root),mode);
    }finally{f.clean();}
  }
});
