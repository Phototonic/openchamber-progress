import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const release='refs/tags/v1.6.0';

/** Load the actual released readers into an isolated test fixture, not a copy
 * of the old allowlist maintained by the code under test. */
export async function releasedManagedJournal(root:string) {
  const files=execFileSync('git',['ls-tree','-r','--name-only',release,'setup','shared'],{encoding:'utf8',timeout:15000})
    .trim().split('\n').filter(file=>file.endsWith('.ts'));
  for(const file of files){
    const target=path.join(root,file);
    mkdirSync(path.dirname(target),{recursive:true,mode:0o700});
    writeFileSync(target,execFileSync('git',['show',`${release}:${file}`],{timeout:15000}),{mode:0o600});
  }
  writeFileSync(path.join(root,'package.json'),'{"type":"module"}',{mode:0o600});
  const load=(file:string)=>import(pathToFileURL(path.join(root,`setup/${file}.ts`)).href);
  const [reader,observation]=await Promise.all([load('managed-migration'),load('managed-observation')]);
  return {...reader,...observation} as Pick<typeof import('../../setup/managed-migration.ts'),'readManagedStepJournal'|'readManagedFreshStepJournal'>&
    Pick<typeof import('../../setup/managed-observation.ts'),'observeManagedSetup'>;
}
