import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

/** A released predecessor, not an otherwise unreachable feature-branch commit. */
export function releasedRuntime(root:string,built=false) {
  const base='refs/tags/v1.0.0';
  assert.equal(spawnSync('git',['rev-parse','--verify',`${base}^{commit}`],{stdio:'ignore'}).status,0,
    'Release compatibility tests require tag v1.0.0; run git fetch origin tag v1.0.0 (source exports without Git history are insufficient).');
  const legacy=path.join(root,'released-runtime');
  const entries=['shared','service','setup','plugin',...(built?['build/companion','build/setup/main.js']:[])];
  for(const name of execFileSync('git',['ls-tree','-r','--name-only',base,...entries],{encoding:'utf8',timeout:15000}).trim().split('\n')) {
    const target=path.join(legacy,name);fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o700});
    fs.writeFileSync(target,execFileSync('git',['show',`${base}:${name}`],{maxBuffer:8*1024*1024,timeout:15000}));
  }
  fs.symlinkSync(path.resolve('node_modules'),path.join(legacy,'node_modules'),'junction');
  return legacy;
}
