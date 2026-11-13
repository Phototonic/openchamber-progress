import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';

/** Version of the supplied extracted web host, never the candidate's engine floor. */
export function hostPackageVersion(moduleFile:string):string {
  const manifest=JSON.parse(readFileSync(path.resolve(path.dirname(moduleFile),'../../../package.json'),'utf8'));
  assert.equal(manifest.name,'@openchamber/web','installer must belong to an isolated web host package');
  assert.match(manifest.version,/^\d+\.\d+\.\d+$/,'host package version required');
  return manifest.version;
}
