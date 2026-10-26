// Immutable pre-amendment implementation, not today's Store with a disabled check.
// The two files are extracted from the pinned repository object into disposable storage.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const [file,root]=process.argv.slice(2);
export const LEGACY_REVISION='498c7e58fc0b53b21edfe71b3ba4abbcca3faee6';
mkdirSync(root,{mode:0o700});
for(const name of ['store','progress'])writeFileSync(`${root}/${name}.ts`,execFileSync('git',['show',`${LEGACY_REVISION}:shared/${name}.ts`]),{mode:0o600});
const {Store,storageError}=await import(pathToFileURL(`${root}/store.ts`).href);
const store=new Store(file);
process.send?.({phase:'ready',revision:LEGACY_REVISION});
process.on('message',(message:any)=>{
  if(message.close){store.close();process.disconnect?.();return;}
  try{process.send?.({phase:'result',receipt:store.apply(message.input,message.actor,message.capture)});}
  catch(e){process.send?.({phase:'result',error:storageError(e).code});}
});
