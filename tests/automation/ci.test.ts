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
