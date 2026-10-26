import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBinding } from '../shared/binding.ts';
import { lifecycle, SetupError, type Action, type Targets, type Payload } from './lifecycle.ts';
import { RELEASE } from '../shared/release.ts';
import { PlatformError } from '../shared/platform.ts';

try {
  const action=process.argv[2] as Action;
  if(!['inspect','dry-run','install','update','disable','enable','remove-capture'].includes(action))throw new SetupError('action-invalid');
  const flags=new Map<string,string>();
  for(const arg of process.argv.slice(3)){const match=/^--(config-root|data-root|store-root|confirm)=(.+)$/.exec(arg);if(!match||flags.has(match[1]))throw new SetupError('arguments-invalid');flags.set(match[1],match[2]);}
  let targets:Targets;
  if(flags.size){if(!flags.has('config-root')||!flags.has('data-root')||!flags.has('store-root'))throw new SetupError('targets-unverified');targets={configRoot:flags.get('config-root')!,dataRoot:flags.get('data-root')!,storeRoot:flags.get('store-root')!,confirmed:flags.get('confirm')==='true'};}
  else{const b=readBinding(new URL('./progress-binding.json',import.meta.url));targets={configRoot:b.source.configRoot,dataRoot:b.source.dataRoot,storeRoot:path.dirname(b.database),confirmed:true};}
  let payload:Payload|undefined;
  if(action==='install'||action==='update'){
    const dir=path.dirname(fileURLToPath(import.meta.url));
    payload={plugin:readFileSync(path.join(dir,'../companion/index.js'),'utf8'),guidance:readFileSync(path.join(dir,'../companion/SKILL.md'),'utf8'),removal:readFileSync(fileURLToPath(import.meta.url),'utf8'),version:RELEASE};
  }
  console.log(JSON.stringify(lifecycle(action,targets,payload)));
}catch(e){console.log(JSON.stringify({error:e instanceof SetupError||e instanceof PlatformError?e.code:'setup-unavailable'}));process.exitCode=1;}
