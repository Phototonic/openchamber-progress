import { existsSync,lstatSync,realpathSync,mkdirSync,readFileSync,writeFileSync,openSync,fsyncSync,closeSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { SetupError } from '../setup/lifecycle.ts';

/** Product-owned state, NOT a guessed OpenChamber/OpenCode config/data root.
 * One selected binding per account/XDG state scope; explicit overrides isolate it.
 */
export function serviceBindingFile(env:NodeJS.ProcessEnv=process.env) {
  const base=env.XDG_STATE_HOME||path.join(env.HOME||homedir(),'.local/state');
  if(!path.isAbsolute(base)||path.resolve(base)!==base)throw new SetupError('service-binding-collision');
  const root=path.join(base,'agent-progress-service');let existing=root;
  while(!existsSync(existing))existing=path.dirname(existing);
  if(realpathSync(existing)!==existing)throw new SetupError('service-binding-collision');
  const marker=path.join(root,'.ownership.json');const identity='{"product":"openchamber-agent-progress-service","format":1}';
  if(!existsSync(root)) {
    mkdirSync(base,{recursive:true,mode:0o700});mkdirSync(root,{mode:0o700});
    writeFileSync(marker,identity,{mode:0o600,flag:'wx'});
    for(const file of [marker,root,base]){const fd=openSync(file,'r');try{fsyncSync(fd);}finally{closeSync(fd);}}
  }
  const owned=lstatSync(root);
  if(!owned.isDirectory()||owned.isSymbolicLink()||owned.uid!==process.getuid?.()||(owned.mode&0o777)!==0o700||!existsSync(marker))throw new SetupError('service-binding-collision');
  const m=lstatSync(marker);
  if(!m.isFile()||m.isSymbolicLink()||m.uid!==process.getuid?.()||(m.mode&0o777)!==0o600||readFileSync(marker,'utf8')!==identity)throw new SetupError('service-binding-collision');
  return path.join(root,'progress-binding.json');
}
