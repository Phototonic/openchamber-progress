import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

/** A released predecessor, not an otherwise unreachable feature-branch commit. */
export function releasedRuntime(root:string) {
  const base='refs/tags/v1.0.0';
  assert.equal(spawnSync('git',['rev-parse','--verify',`${base}^{commit}`],{stdio:'ignore'}).status,0,
    'Release compatibility tests require tag v1.0.0; run git fetch origin tag v1.0.0 (source exports without Git history are insufficient).');
  const legacy=path.join(root,'released-runtime');
  for(const name of execFileSync('git',['ls-tree','-r','--name-only',base,'shared','service','setup','plugin'],{encoding:'utf8'}).trim().split('\n')) {
    const target=path.join(legacy,name);fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o700});
    fs.writeFileSync(target,execFileSync('git',['show',`${base}:${name}`]));
  }
  fs.symlinkSync(path.resolve('node_modules'),path.join(legacy,'node_modules'),'junction');
  return legacy;
}
