/** Private placement evidence; never a path discovery or ownership authority. */
import path from 'node:path';
import type {Binding} from '../shared/binding.ts';
import {managedExpectationFile} from '../shared/managed-binding.ts';
import type {ManagedPathClaim} from './managed-step-journal.ts';

export interface ManagedVolumeIdentityEvidence {
  version: 1;
  paths: {path:string;fingerprint:string}[];
}
export type ManagedVolumeTarget = Pick<ManagedPathClaim,'path'|'kind'|'object'>;
export type ManagedVolumeObservation = {kind:'verified';fingerprint:string}|{kind:'unavailable'};
/** The caller supplies an already validated canonical target and current native
 * observation. For absence (null object), prove placement through its verified
 * existing ancestor, not object identity. Scope any memoization to one read-only
 * validation batch; never reuse proof across an effect. */
export type ManagedVolumeIdentityReader = (target:ManagedVolumeTarget)=>ManagedVolumeObservation;
export type ManagedHistoricalComparison = 'same'|'different'|'unavailable';

/** Fixed layout paths eligible for evidence. Manifest paths are derived
 * separately by the lifecycle owner and are not discovered from the evidence. */
export function managedVolumeFixedPaths(binding:Binding):string[] {
  const {database,source:{configRoot,dataRoot}}=binding,dialect=/^[a-z]:/i.test(database)?path.win32:path.posix;
  const store=dialect.dirname(database),root=dialect.join(dataRoot,'agent-progress-managed');
  return [configRoot,dataRoot,store,database,...['-journal','-wal','-shm'].map(s=>database+s),
    root,dialect.join(root,'.ownership.json'),dialect.join(root,'progress-binding.json'),dialect.join(root,'migration.json'),
    dialect.join(store,path.basename(managedExpectationFile(binding))),dialect.join(store,'installation-history.jsonl'),
    dialect.join(configRoot,'plugins','agent-progress')];
}

export function compareManagedVolumePlacement(live:ManagedVolumeTarget,evidence:ManagedVolumeIdentityEvidence|undefined,
  read:ManagedVolumeIdentityReader):ManagedHistoricalComparison {
  const saved=evidence?.paths.find(p=>p.path===live.path);
  if(!saved)return 'same'; // No recorded placement constraint; keep the caller's existing checks.
  const observed=read(live);
  if(observed.kind==='unavailable')return 'unavailable';
  return observed.fingerprint===saved.fingerprint?'same':'different';
}

/** Historical-to-live only, after live path/type/security checks. Never replace
 * exact saved-to-saved or live-to-live comparisons. Digest and other owner
 * checks (including the allowed growth of a history file) stay with callers. */
export function compareManagedHistoricalObject(saved:ManagedVolumeTarget,live:ManagedVolumeTarget,
  evidence:ManagedVolumeIdentityEvidence|undefined,read:ManagedVolumeIdentityReader):ManagedHistoricalComparison {
  if(saved.path!==live.path||saved.kind!==live.kind)return 'different';
  if(saved.kind==='absent'){
    if(saved.object!==null||live.object!==null)return 'different';
  }else if(!saved.object||!live.object||saved.object.inode!==live.object.inode||saved.object.birthNs!==live.object.birthNs||
    (saved.object.device!==live.object.device&&!evidence?.paths.some(p=>p.path===live.path)))return 'different';
  return compareManagedVolumePlacement(live,evidence,read);
}
