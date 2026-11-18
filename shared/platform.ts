import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, realpathSync } from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import { MANAGED_STEP_LIMITS } from './managed-steps.ts';

export const windows = process.platform === 'win32';
export class PlatformError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; }
}
/** Public diagnostics are fixed codes, never arbitrary exception text. The first
 * three are no longer produced (Windows permission queries were removed) but stay
 * accepted so earlier journals, status and clients keep their fixed vocabulary. */
export function platformErrorCode(error: unknown) {
  const codes = ['windows-security-unavailable','private-permissions','path-unverified','unsafe-parent','symlink-escape'] as const;
  return error instanceof PlatformError ? codes.find(code=>code===error.code) : undefined;
}
/** Coordination identity only, not path authority. Resolve existing aliases
 * for the lock key; the ordinary owners still refuse unsafe paths before work. */
export function writerTarget(kind:'scope'|'store',value:string):string {
  let current=path.resolve(value);const missing:string[]=[];
  while(!lstatSync(current,{throwIfNoEntry:false})){
    const parent=path.dirname(current);if(parent===current)break;
    missing.unshift(path.basename(current));current=parent;
  }
  const canonical=path.join(realpathSync.native(current),...missing);
  return `${kind}:${process.platform==='win32'?canonical.toLowerCase():canonical}`;
}
// Below default Linux/macOS/Windows ephemeral client ranges, excluding common
// service/game ports. This routing choice never authorizes an existing listener.
const writerPortDenylist=new Set([25565,26000,...Array.from({length:16},(_,i)=>27015+i),27036,27037,28015,28016,28017,28960]);
/** Stable routing; hash/denylist collisions remain conservative busy refusals. */
export function writerTargetPort(target:string):number {
  let offset=createHash('sha256').update(target).digest().readUInt32BE(0)%4000;
  while(writerPortDenylist.has(25000+offset))offset=(offset+1)%4000;
  return 25000+offset;
}
/** Time kept in reserve before an effect that must be checkpointed, such as an
 * exclusive creation or an intent publication: past this point the request would
 * rather refuse (target still absent, safely retryable) than strand an object. */
export const STEP_HEADROOM_MS = 2_500;
/** A worker-local request boundary: the work deadline and the writer fence. It
 * starts no process. Monotonic nanoseconds use the same clock in service and
 * worker threads. */
export class PlatformRequestBudget {
  readonly startedAt: bigint;
  readonly deadline: bigint;
  readonly writerFence?:{targets?:string[]};
  /** Wire compatibility only: the step accounting shape still carries this count,
   * and no permission check starts a process any more. */
  readonly securitySpawns = 0;
  constructor(startedAt = process.hrtime.bigint(),writerFence?:{targets?:string[]}) {
    this.startedAt=startedAt;
    this.deadline=startedAt+BigInt(MANAGED_STEP_LIMITS.workMs)*1_000_000n;
    this.writerFence=writerFence;
  }
  get elapsedMs(){return Math.max(0,Number(process.hrtime.bigint()-this.startedAt)/1_000_000);}
  /** Refuse to admit further effects once less than `headroomMs` of the work
   * deadline is left (0: once it has passed). */
  require(headroomMs=0) {
    if(Number(this.deadline-process.hrtime.bigint())/1_000_000<=headroomMs)
      throw new PlatformError('managed-step-deadline');
  }
}
let requestBudget:PlatformRequestBudget|undefined;
let writerTargets:string[]|undefined;
/** Synchronous legacy writers share target binding without inheriting the new
 * step budget. The outer HTTP owner holds these slots until this call returns. */
export function withPlatformWriterTargets<T>(targets:string[],run:()=>T):T {
  if(writerTargets)throw new PlatformError('managed-step-conflict');
  writerTargets=targets;
  try{
    const result=run();
    if(result!==null&&(typeof result==='object'||typeof result==='function')&&typeof (result as {then?:unknown}).then==='function')
      throw new PlatformError('managed-step-conflict');
    return result;
  }finally{writerTargets=undefined;}
}
/** Synchronous request work only. Awaiting or resetting a nested budget is not
 * supported. */
export function withPlatformRequestBudget<T>(budget:PlatformRequestBudget,run:()=>T):T {
  if(requestBudget)throw new PlatformError('managed-step-conflict');
  budget.require();requestBudget=budget;
  try{
    const result=run();
    if(result!==null&&(typeof result==='object'||typeof result==='function')&&typeof (result as {then?:unknown}).then==='function')
      throw new PlatformError('managed-step-conflict');
    return result;
  }finally{requestBudget=undefined;}
}
/** A mutation owner checks the request deadline before each effect. */
export function requirePlatformWriteBoundary(headroomMs=0):void {
  requestBudget?.require(headroomMs);
}
/** A pre-dispatch metadata read may route locks, but never grant authority. The
 * fresh owner must bind its actual Store to an acquired slot before any effect. */
export function requirePlatformStoreFence(database:string):void {
  requestBudget?.require();
  const targets=requestBudget?.writerFence?requestBudget.writerFence.targets??[]:writerTargets;
  if(targets&&!targets.includes(writerTarget('store',path.dirname(database))))
    throw new PlatformError('managed-step-conflict');
}

/** Reject ambiguous syntax BEFORE normalization; canonicalize actual spelling.
 * Windows paths are checked with plain filesystem calls only (lstat/realpath):
 * no process is started and no permission (ACL) query is made. */
export function windowsPath(value: string, allowMissing = false): string {
  return windowsPaths([value],allowMissing)[0]!;
}
export function windowsPaths(values: string[], allowMissing = false): string[] {
  return windowsPathsInner(values,allowMissing);
}
function windowsPathsInner(values: string[], allowMissing = false): string[] {
  return values.map(value=>{
  if (value.includes('\0') || value.length > 4096 || !/^[a-z]:[\\/]/i.test(value)) throw new PlatformError('path-unverified');
  const normalized = value.replaceAll('/','\\');
  const parts = normalized.slice(3).split('\\').filter(Boolean);
  if (parts.some(p => p === '.' || p === '..' || /[<>:"|?*\x00-\x1f]/.test(p) || /[. ]$/.test(p) || /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(p))) throw new PlatformError('path-unverified');
  const clean = normalized.slice(0,3) + parts.join('\\');
  let current = clean;
  const tail: string[] = [];
  while (!existsSync(current)) {
    // lstat catches dangling links too, unlike existsSync.
    if (lstatSync(current,{throwIfNoEntry:false})) throw new PlatformError('symlink-escape');
    if (!allowMissing) throw new PlatformError('path-unverified');
    tail.unshift(path.basename(current)); const parent=path.dirname(current);
    if (parent===current) throw new PlatformError('path-unverified'); current=parent;
  }
  // Node reports symbolic links and junctions as links; refuse any in the chain.
  for (let p=current;;p=path.dirname(p)) {
    if(lstatSync(p).isSymbolicLink()) throw new PlatformError('symlink-escape');
    if(path.dirname(p)===p)break;
  }
  return path.join(realpathSync.native(current),...tail);
  });
}

/** Windows has no uid to compare, and ownership is not queried: state lives under
 * the user's profile and relies on its default per-user permissions. */
export function isOwned(file: string) {
  if (windows) { lstatSync(file); return true; }
  return lstatSync(file).uid === process.getuid?.();
}
/** Compare native directory identities, preserving case-sensitive distinctions. */
export function sameWindowsDirectory(left:string,right:string) {
  return sameWindowsObject(left,right,true);
}
export function sameWindowsObject(left:string,right:string,directory=false) {
  const [a,b]=windowsPaths([left,right]);
  const first=lstatSync(a!,{bigint:true}),second=lstatSync(b!,{bigint:true});
  return (!directory||first.isDirectory()&&second.isDirectory())&&first.ino!==0n&&first.dev===second.dev&&first.ino===second.ino;
}
export function privatePaths(files: string[]) {
  // Named aliases must not split SQLite journals or mutate retained metadata.
  // Windows keeps only these pure filesystem checks; POSIX adds uid and mode.
  return windows ? files.every(file=>{const s=lstatSync(file);return !s.isSymbolicLink()&&(!s.isFile()||s.nlink===1);}) : files.every(file=>{
    const s=lstatSync(file);return !s.isSymbolicLink()&&s.uid===process.getuid?.()&&(s.mode&0o777)===(s.isDirectory()?0o700:0o600);
  });
}
/** POSIX creates 0700 directories. Windows creates ordinary directories that
 * inherit the profile's default permissions; no ACL is applied or repaired. */
export function privateDirectory(file: string, recursive=false, creation?:{exclusive:true;validate:()=>void}) {
  if(creation){
    requirePlatformWriteBoundary();
    if(recursive||creation.exclusive!==true||typeof creation.validate!=='function')throw new PlatformError('managed-step-conflict');
    creation.validate();
    const target=windows?windowsPath(file,true):file,parent=path.dirname(target);
    if(!path.isAbsolute(target)||path.resolve(target)!==target||!lstatSync(parent).isDirectory()||
      (!windows&&realpathSync(parent)!==parent)||lstatSync(target,{throwIfNoEntry:false}))throw new PlatformError('path-unverified');
    requirePlatformWriteBoundary(STEP_HEADROOM_MS);
    // Exclusive: mkdir fails if the target appeared since validation. On Windows
    // that is a path refusal, not a raw filesystem error.
    try{if(windows)mkdirSync(target);else mkdirSync(target,{mode:0o700});}
    catch(error){if(windows&&(error as NodeJS.ErrnoException).code==='EEXIST')throw new PlatformError('path-unverified');throw error;}
    syncDirectory(path.dirname(target));
    return;
  }
  if (!windows) { mkdirSync(file,{recursive,mode:0o700}); return; }
  const target=windowsPath(file,true);
  let missing=0; for(let parent=target;!existsSync(parent);parent=path.dirname(parent))missing++;
  if(!recursive&&missing>1)throw new PlatformError('path-unverified');
  if(missing){
    try{mkdirSync(target,{recursive});}
    catch(error){if(['EEXIST','ENOTDIR'].includes((error as NodeJS.ErrnoException).code??''))throw new PlatformError('path-unverified');throw error;}
  }
  else if(!lstatSync(target).isDirectory())throw new PlatformError('path-unverified');
}
export function syncFile(file:string) {const fd=openSync(file,windows?'r+':'r');try{fsyncSync(fd);}finally{closeSync(fd);}}
/** Windows has atomic selection/process recovery, not POSIX directory durability. */
export function syncDirectory(dir:string) {if(windows)return;const fd=openSync(dir,'r');try{fsyncSync(fd);}finally{closeSync(fd);}}
