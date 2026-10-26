import { existsSync,lstatSync,realpathSync,mkdirSync,readFileSync,writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { SetupError } from '../setup/lifecycle.ts';
import { windows, windowsPath, privateDirectory, privatePaths, platformSecurityScope, syncFile, syncDirectory, PlatformError, sameWindowsDirectory, sameWindowsObject } from '../shared/platform.ts';

/** Product-owned state, NOT a guessed OpenChamber/OpenCode config/data root.
 * One selected binding per account/XDG state scope; explicit overrides isolate it.
 */
export function serviceBindingFile(env:NodeJS.ProcessEnv=process.env) {
  try{return platformSecurityScope(()=>serviceBindingFileInner(env));}catch(e){throw e instanceof PlatformError?new SetupError(e.code):e;}
}
function serviceBindingFileInner(env:NodeJS.ProcessEnv) {
  let base=env.XDG_STATE_HOME||path.join(env.HOME||homedir(),'.local/state');
  if(windows)base=windowsPath(base,true);
  if(!path.isAbsolute(base)||path.resolve(base)!==base)throw new SetupError('service-binding-collision');
  const root=path.join(base,'agent-progress-service');let existing=root;
  while(!existsSync(existing))existing=path.dirname(existing);
  if(windows?!sameWindowsDirectory(existing,realpathSync(existing)):realpathSync(existing)!==existing)throw new SetupError('service-binding-collision');
  const marker=path.join(root,'.ownership.json');const identity='{"product":"openchamber-agent-progress-service","format":1}';
  if(!existsSync(root)) {
    if(windows){if(!existsSync(base))privateDirectory(base,true);privateDirectory(root);}else{mkdirSync(base,{recursive:true,mode:0o700});mkdirSync(root,{mode:0o700});}
    writeFileSync(marker,identity,{mode:0o600,flag:'wx'});
    syncFile(marker);syncDirectory(root);syncDirectory(base);
  }
  const owned=lstatSync(root);
  if(!owned.isDirectory()||owned.isSymbolicLink()||(!windows&&(owned.uid!==process.getuid?.()||(owned.mode&0o777)!==0o700))||!existsSync(marker))throw new SetupError('service-binding-collision');
  if(windows&&(!sameWindowsDirectory(windowsPath(root),root)||!sameWindowsObject(windowsPath(marker),marker)||!privatePaths([root,marker])))throw new SetupError('service-binding-collision');
  const m=lstatSync(marker);
  if(!m.isFile()||m.isSymbolicLink()||(!windows&&(m.uid!==process.getuid?.()||(m.mode&0o777)!==0o600))||readFileSync(marker,'utf8')!==identity)throw new SetupError('service-binding-collision');
  return path.join(root,'progress-binding.json');
}
