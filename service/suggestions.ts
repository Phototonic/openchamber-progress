import { lstatSync,realpathSync } from 'node:fs';
import path from 'node:path';
import type { SetupSuggestions,Suggestion } from '../shared/progress.ts';

/** Trusted service-host inputs only; never supplied by an HTTP caller. */
export interface HostPathContext {
  platform: NodeJS.Platform;
  env: Partial<Pick<NodeJS.ProcessEnv,'HOME'|'XDG_CONFIG_HOME'|'XDG_DATA_HOME'>>;
  uid: number | undefined;
}

/** Read-only prefill. Observed folders still do not establish effective source identity. */
export function setupSuggestions(context?:HostPathContext):SetupSuggestions|undefined {
  const host=context??{platform:process.platform,env:{HOME:process.env.HOME,XDG_CONFIG_HOME:process.env.XDG_CONFIG_HOME,XDG_DATA_HOME:process.env.XDG_DATA_HOME},uid:process.getuid?.()};
  if(host.platform!=='linux')return undefined;
  function base(value:string|undefined):string|null {
    if(!value||value.includes('\0')||value.length>4096)return null;
    const trimmed=value.replace(/\/+$/,'')||'/';
    return path.isAbsolute(trimmed)&&path.resolve(trimmed)===trimmed?trimmed:null;
  }
  function root(override:string|undefined,fallback:string):Suggestion|null {
    const home=base(host.env.HOME);
    const parent=override?base(override):home?path.join(home,fallback):null;
    if(!parent)return null;
    const value=path.join(parent,'opencode');if(value.length>4096)return null;
    let state:Suggestion['state']='candidate';
    try {
      const stat=lstatSync(value);
      if(stat.isDirectory()&&!stat.isSymbolicLink()&&host.uid!==undefined&&stat.uid===host.uid&&realpathSync(value)===value)state='resolved';
    } catch { /* Missing/inaccessible roots remain honest defaults, not verified folders. */ }
    return {value,state};
  }
  const configRoot=root(host.env.XDG_CONFIG_HOME,'.config');
  const dataRoot=root(host.env.XDG_DATA_HOME,'.local/share');
  const storeValue=dataRoot?path.join(dataRoot.value,'openchamber-progress'):null;
  return {configRoot,dataRoot,storeRoot:dataRoot&&storeValue&&storeValue.length<=4096?{value:storeValue,state:dataRoot.state}:null};
}
