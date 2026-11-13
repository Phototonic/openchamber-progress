/** Test-only explicit binding construction. Never imports or reads a live profile. */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import type { Binding } from '../../shared/binding.ts';
import { Store } from '../../shared/store.ts';
import { RELEASE } from '../../shared/release.ts';
import { createManagedBindingDirectory, managedSourceRoots, publishPrivateJson, readManagedBinding } from '../../shared/managed-binding.ts';

export function isolatedEnvironment(root: string): NodeJS.ProcessEnv {
  const env = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: `${root}/home`,
    XDG_CONFIG_HOME: `${root}/config`, XDG_DATA_HOME: `${root}/data`, XDG_STATE_HOME: `${root}/state`,
    XDG_CACHE_HOME: `${root}/cache`, XDG_RUNTIME_DIR: `${root}/runtime`, TMPDIR: `${root}/tmp` };
  for (const dir of [env.HOME, env.XDG_CONFIG_HOME, env.XDG_DATA_HOME, env.XDG_STATE_HOME, env.XDG_CACHE_HOME, env.XDG_RUNTIME_DIR, env.TMPDIR]) mkdirSync(dir, { recursive: true, mode: 0o700 });
  return env;
}

export function publishFixtureBinding(env: NodeJS.ProcessEnv, binding: Binding): string {
  const roots = managedSourceRoots(env);
  assert.equal(binding.source.configRoot, roots.configRoot, 'fixture config scope must match');
  assert.equal(binding.source.dataRoot, roots.dataRoot, 'fixture data scope must match');
  assert.notEqual(path.dirname(binding.database), roots.dataRoot, 'fixture store must be dedicated');
  const file = createManagedBindingDirectory(env);
  const prior = readManagedBinding(env);
  if (prior) assert.deepEqual(prior, binding, 'never replace a different fixture selection');
  else publishPrivateJson(file, binding);
  return file;
}

export function createFixtureBinding(root:string) {
  const env=isolatedEnvironment(root),source={id:'fixture-source',...managedSourceRoots(env),verified:true};
  for(const dir of [source.configRoot,source.dataRoot,`${root}/store`])mkdirSync(dir,{recursive:true,mode:0o700});
  const store=new Store(`${root}/store/progress.sqlite`,{create:true});
  try {
    store.registerSource(source);
    const binding:Binding={protocolVersion:2,schemaVersion:2,installId:'fixture-install',version:RELEASE,database:store.file,storeId:store.list().storeId,source};
    publishFixtureBinding(env,binding);return {env,binding};
  }finally{store.close();}
}
