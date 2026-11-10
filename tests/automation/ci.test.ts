import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

test('actual portable CLI refuses nonfresh artifacts before entry reads or checks, preserving archives',()=>{
  const root=mkdtempSync(join(tmpdir(),'portable-ci-archives-'));
  try {
    mkdirSync(join(root,'build/artifacts'),{recursive:true});
    const sentinel=Buffer.from('synthetic retained archive\0bytes');
    writeFileSync(join(root,'build/artifacts/retained.zip'),sentinel);
    // No generated entries or dependencies exist: any attempt to read/build them is a failure.
    const result=spawnSync(process.execPath,['--experimental-strip-types',resolve('scripts/ci.ts')],{
      cwd:root,encoding:'utf8',env:{...process.env,PATH:''},timeout:10_000,
    });
    assert.equal(result.error,undefined);
    assert.equal(result.status,1);
    assert.match(result.stderr,/fresh disposable checkout/);
    assert.match(result.stderr,/build\/artifacts is nonempty/);
    assert.equal(result.stdout,'','No checks or builds should start');
    assert(!result.stderr.includes('ENOENT'),'Must refuse before reading generated entries');
    assert.deepEqual(readFileSync(join(root,'build/artifacts/retained.zip')),sentinel);
    assert.deepEqual(readdirSync(join(root,'build/artifacts')),['retained.zip']);
    assert.deepEqual(readdirSync(root),['build']);
  } finally {rmSync(root,{recursive:true,force:true});}
});

test('portable CLI refuses missing bump notes on PR/dev and malformed committed notes before builds',()=>{
  const root=mkdtempSync(join(tmpdir(),'portable-ci-notes-'));
  const git=(...args:string[])=>{const r=spawnSync('git',args,{cwd:root,encoding:'utf8'});assert.equal(r.status,0);return r.stdout.trim();};
  try {
    git('init','-q');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');
    writeFileSync(join(root,'package.json'),JSON.stringify({version:'1.0.0'}));git('add','.');git('commit','-qm','Fixture');
    const before=git('rev-parse','HEAD');
    writeFileSync(join(root,'package.json'),JSON.stringify({version:'9.8.7'}));git('add','.');git('commit','-qm','Fixture bump');
    const after=git('rev-parse','HEAD');
    for(const [name,event] of [
      ['pull_request',{pull_request:{base:{sha:before}}}],
      ['push',{before,after,ref:'refs/heads/dev'}],
    ] as const) {
      const path=join(root,'event.json');writeFileSync(path,JSON.stringify(event));
      const r=spawnSync(process.execPath,['--experimental-strip-types',resolve('scripts/ci.ts')],{
        cwd:root,encoding:'utf8',timeout:10_000,
        env:{...process.env,GITHUB_EVENT_PATH:path,GITHUB_EVENT_NAME:name,GITHUB_SHA:after,GITHUB_REPOSITORY:'example/fixture'},
      });
      assert.equal(r.status,1);assert.match(r.stderr,/Release notes validation failed/);
      assert(!r.stderr.includes('ENOENT'));assert.equal(r.stdout,'');
    }
    mkdirSync(join(root,'release-notes'));writeFileSync(join(root,'release-notes/9.8.7.md'),'private malformed fixture detail');
    git('add','.');git('commit','-qm','Malformed fixture');
    const r=spawnSync(process.execPath,['--experimental-strip-types',resolve('scripts/ci.ts')],{
      cwd:root,encoding:'utf8',timeout:10_000,
      env:{...process.env,GITHUB_EVENT_PATH:'',GITHUB_SHA:git('rev-parse','HEAD')},
    });
    assert.equal(r.status,1);assert.match(r.stderr,/Release notes validation failed/);
    assert(!r.stderr.includes('private malformed fixture detail'));assert(!r.stderr.includes('ENOENT'));assert.equal(r.stdout,'');
  } finally {rmSync(root,{recursive:true,force:true});}
});
