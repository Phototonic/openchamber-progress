import { execFileSync } from 'node:child_process';
import { mkdirSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** Immutable released source: never emulate an older service by disabling a check. */
export async function previousCleanup(root:string) {
  const revision='1c747bc5ea13082ee578fc6cf3c50dec179cd77e';
  mkdirSync(root,{mode:0o700});
  const archive=execFileSync('git',['archive',revision,'shared','service','setup']);
  execFileSync('tar',['-x','-C',root],{input:archive});
  symlinkSync(path.resolve('node_modules'),`${root}/node_modules`,'junction');
  const {Store}=await import(pathToFileURL(`${root}/shared/store.ts`).href);
  const {createProgressServer}=await import(pathToFileURL(`${root}/service/server.ts`).href);
  return {Store,createProgressServer};
}
