import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {verifyPackageContents} from '../../scripts/verify-package.ts';
import {RELEASE} from '../../shared/release.ts';

const repository=fileURLToPath(new URL('../../',import.meta.url));
const notices=['LICENSE','THIRD_PARTY_NOTICES.md','licenses/Apache-2.0.txt'];
function put(root:string,name:string,value:string|Buffer) {
  mkdirSync(path.dirname(path.join(root,name)),{recursive:true});writeFileSync(path.join(root,name),value);
}
function fixture(kind:'extension'|'companion') {
  const root=mkdtempSync('/tmp/opencode/package-notices-');
  const source=path.join(root,'source');const artifact=path.join(source,`build/artifacts/agent-progress-${kind}-${RELEASE}`);
  const entries=['package.json','docs/setup.md',...notices,'build/companion/index.js','build/companion/package.json','build/companion/SKILL.md','build/setup/main.js',...(kind==='extension'?['build/service/main.js',...['panel','status','page'].flatMap(view=>[`ui/${view}/index.html`,`ui/${view}/main.js`])]:[])];
  for(const entry of entries) {
    const content=notices.includes(entry)?readFileSync(path.join(repository,entry)):entry==='package.json'?JSON.stringify({version:RELEASE,license:'MIT'}):'synthetic package fixture\n';
    put(source,entry,content);put(artifact,entry,content);
  }
  function zip() {
    rmSync(`${artifact}.zip`,{force:true});
    const result=spawnSync('zip',['-q','-X','-r',`${artifact}.zip`,'.'],{cwd:artifact});assert.equal(result.status,0);
  }
  zip();
  return {source,artifact,zip,cleanup(){rmSync(root,{recursive:true,force:true});}};
}

test('known grants, embedded credits and complete Apache terms are retained in Git notice material',()=>{
  const text=readFileSync(path.join(repository,'THIRD_PARTY_NOTICES.md'),'utf8');
  for(const pkg of ['@openchamber/sdk','zod','effect']) {
    const upstream=readFileSync(path.join(repository,'node_modules',pkg,'LICENSE'),'utf8').trim();
    assert.ok(text.includes(upstream),`complete installed ${pkg} grant`);
  }
  const project=readFileSync(path.join(repository,'LICENSE'),'utf8').trim();
  assert.ok(text.includes(project.replace('Copyright (c) 2026 Phototonic','Copyright (c) 2025 opencode')),'complete OpenCode grant for plugin/schema');
  const normalize=(value:string)=>value.replace(/[“”']/g,'"').replace(/\s+/g,' ').trim();
  const mitGrants=[...text.matchAll(/```text\n([\s\S]*?)\n```/g)].map(match=>match[1]).filter(block=>block.startsWith('MIT License')||block.startsWith('(The MIT License)'));
  assert.equal(mitGrants.length,7,'four package grants and three embedded-origin grants');
  for(const grant of mitGrants)assert.equal(normalize(grant.slice(grant.indexOf('Permission is hereby granted'))),normalize(project.slice(project.indexOf('Permission is hereby granted'))),'full MIT permission, condition and warranty text');
  for(const credit of ['@opencode/plugin','@opencode/schema','Copyright (c) Fabian Hiller','Copyright (c) Fastify','Copyright (c) 2017-present The Fastify team','James Sumners','Copyright (c) 2012-2014 Roman Shtylman','Copyright (c) 2015 Douglas Christopher Wilson','Copyright 2024, Jaen','Brock Adams','https://stackoverflow.com/a/3143231','https://creativecommons.org/licenses/by-sa/2.5/legalcode','Adaptation/modification notice for `build/service/main.js`']) {
    assert.ok(text.includes(credit),`known attribution: ${credit}`);
  }
  const apache=readFileSync(path.join(repository,'licenses/Apache-2.0.txt'),'utf8');
  // Canonical full text from https://www.apache.org/licenses/LICENSE-2.0.txt.
  assert.equal(createHash('sha256').update(apache.trim()).digest('hex'),'283ea6cc2997a1a70da0049e09adf9317bb60ca1b51279b65196b83a69e1996b','full canonical Apache grant (ignoring outer whitespace)');
});

for(const kind of ['extension','companion'] as const) {
  test(`${kind}: exact declared payload, project MIT metadata and source/folder/ZIP notice bytes join`,()=>{
    const f=fixture(kind);try{assert.ok(verifyPackageContents(f.artifact,kind,f.source).includes('licenses/Apache-2.0.txt'));}finally{f.cleanup();}
  });
  test(`${kind}: absent notice and altered grant/attribution fail before any reassembly`,()=>{
    const f=fixture(kind);try{
      for(const notice of notices) {
        const original=readFileSync(path.join(f.artifact,notice));
        rmSync(path.join(f.artifact,notice));
        assert.throws(()=>verifyPackageContents(f.artifact,kind,f.source),/declared payload/);
        put(f.artifact,notice,original);
      }
      for(const [before,after] of [['Permission is hereby granted','Permission is withheld'],['Brock Adams','unknown author']]) {
        const original=readFileSync(path.join(f.artifact,'THIRD_PARTY_NOTICES.md'),'utf8');
        put(f.artifact,'THIRD_PARTY_NOTICES.md',original.replaceAll(before,after));f.zip();
        assert.throws(()=>verifyPackageContents(f.artifact,kind,f.source),/package\/source bytes: THIRD_PARTY_NOTICES/);
        put(f.artifact,'THIRD_PARTY_NOTICES.md',original);f.zip();
      }
      const original=readFileSync(path.join(f.artifact,'THIRD_PARTY_NOTICES.md'),'utf8');
      put(f.artifact,'THIRD_PARTY_NOTICES.md',original.replaceAll('Brock Adams','unknown author'));f.zip();
      put(f.artifact,'THIRD_PARTY_NOTICES.md',original);
      assert.throws(()=>verifyPackageContents(f.artifact,kind,f.source),/ZIP\/source notice bytes/);
      f.zip();
      put(f.source,'THIRD_PARTY_NOTICES.md',original.replaceAll('Brock Adams','unknown author'));
      assert.throws(()=>verifyPackageContents(f.artifact,kind,f.source),/package\/source bytes/);
    }finally{f.cleanup();}
  });
  test(`${kind}: undeclared folder/ZIP payload and omitted ZIP notice are refused`,()=>{
    const f=fixture(kind);try{
      put(f.artifact,'undeclared.txt','synthetic unexpected payload');
      assert.throws(()=>verifyPackageContents(f.artifact,kind,f.source),/declared payload/);
      f.zip();rmSync(path.join(f.artifact,'undeclared.txt'));
      assert.throws(()=>verifyPackageContents(f.artifact,kind,f.source),/ZIP entry allowlist/);
      f.zip();
      assert.equal(spawnSync('zip',['-q','-d',`${f.artifact}.zip`,'THIRD_PARTY_NOTICES.md']).status,0);
      assert.throws(()=>verifyPackageContents(f.artifact,kind,f.source),/ZIP entry allowlist/);
    }finally{f.cleanup();}
  });
  test(`${kind}: project metadata cannot silently drop or replace MIT`,()=>{
    const f=fixture(kind);try{
      put(f.artifact,'package.json',JSON.stringify({version:RELEASE,license:'UNLICENSED'}));
      assert.throws(()=>verifyPackageContents(f.artifact,kind,f.source),/packaged project license metadata/);
    }finally{f.cleanup();}
  });
}

test('verifier CLI rejects a damaged input before its automatic reassembly can hide it',()=>{
  const f=fixture('extension');try{
    rmSync(path.join(f.artifact,'THIRD_PARTY_NOTICES.md'));
    put(f.source,'scripts/package.ts',"import {writeFileSync} from 'node:fs'; writeFileSync('reassembled-marker','unexpected'); process.exit(55);\n");
    const result=spawnSync(process.execPath,['--experimental-strip-types',path.join(repository,'scripts/verify-package.ts')],{cwd:f.source,encoding:'utf8',timeout:15000});
    assert.notEqual(result.status,0);assert.match(result.stderr,/declared payload/);
    assert.equal(existsSync(path.join(f.source,'reassembled-marker')),false,'reassembly must not run before preflight');
  }finally{f.cleanup();}
});
