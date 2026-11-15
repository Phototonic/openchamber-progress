import { spawnSync, type SpawnSyncOptionsWithStringEncoding, type SpawnSyncReturns } from 'node:child_process';
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, realpathSync } from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import { MANAGED_STEP_LIMITS } from './managed-steps.ts';

export const windows = process.platform === 'win32';
export class PlatformError extends Error {
  readonly code: string;
  readonly reason?: 'timeout'|'spawn'|'exit';
  constructor(code: string, reason?: 'timeout'|'spawn'|'exit') { super(code); this.code = code; this.reason = reason; }
}
/** Public diagnostics are fixed codes, never arbitrary exception text. */
export function platformErrorCode(error: unknown) {
  const codes = ['windows-security-unavailable','private-permissions','path-unverified','unsafe-parent','symlink-escape'] as const;
  return error instanceof PlatformError ? codes.find(code=>code===error.code) : undefined;
}
type Security = { owned: boolean; private: boolean; reparse: boolean; unsafeParent: boolean };
/** Coordination identity only, not path/ACL authority. Resolve existing aliases
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
const cache = new Map<string, { snapshot: string; result: Security }>();
const reparseCache = new Map<string,{identity:string;reparse:boolean;unsafeParent:boolean}>();
let scope = 0;
/** A worker-local request boundary, never a cached security verdict. The shared
 * counter lets its supervisor report actual attempts even after a lost reply.
 * Monotonic nanoseconds use the same clock in service and worker threads. */
export class PlatformRequestBudget {
  readonly counter: Int32Array<SharedArrayBuffer>;
  readonly startedAt: bigint;
  readonly deadline: bigint;
  readonly writerFence?:{port:number;nonce:string;targets?:string[]};
  constructor(startedAt = process.hrtime.bigint(), counter = new SharedArrayBuffer(4),writerFence?:{port:number;nonce:string;targets?:string[]}) {
    if(counter.byteLength!==4)throw new PlatformError('managed-step-budget');
    this.counter=new Int32Array(counter);this.startedAt=startedAt;
    this.deadline=startedAt+BigInt(MANAGED_STEP_LIMITS.workMs)*1_000_000n;
    this.writerFence=writerFence;
  }
  get securitySpawns(){return Atomics.load(this.counter,0);}
  get elapsedMs(){return Math.max(0,Number(process.hrtime.bigint()-this.startedAt)/1_000_000);}
  /** Reserve before admitting effects. Reservation does not consume attempts. */
  require(spawns=0,headroomMs=0) {
    if(!Number.isSafeInteger(spawns)||spawns<0||!Number.isFinite(headroomMs)||headroomMs<0||
      this.securitySpawns<0||this.securitySpawns+spawns>MANAGED_STEP_LIMITS.securitySpawns)
      throw new PlatformError('managed-step-budget');
    if(Number(this.deadline-process.hrtime.bigint())/1_000_000<=headroomMs)
      throw new PlatformError('managed-step-deadline');
  }
  /** Charge before the OS call, including a failed/throwing process launch. */
  launch() {
    this.require(1,1_000);
    // There is one worker, but CAS also prevents accidental shared-counter
    // consumers from exceeding the ceiling rather than discovering it later.
    const before=this.securitySpawns;
    if(before>=MANAGED_STEP_LIMITS.securitySpawns||Atomics.compareExchange(this.counter,0,before,before+1)!==before)
      throw new PlatformError('managed-step-budget');
    return Math.max(1,Math.floor(Number(this.deadline-process.hrtime.bigint())/1_000_000-1_000));
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
 * supported; no caller may hide an outer security scope across requests. */
export function withPlatformRequestBudget<T>(budget:PlatformRequestBudget,run:()=>T):T {
  if(requestBudget||scope)throw new PlatformError('managed-step-conflict');
  budget.require();requestBudget=budget;cache.clear();reparseCache.clear();
  try{
    const result=run();
    if(result!==null&&(typeof result==='object'||typeof result==='function')&&typeof (result as {then?:unknown}).then==='function')
      throw new PlatformError('managed-step-conflict');
    return result;
  }finally{requestBudget=undefined;cache.clear();reparseCache.clear();}
}
/** Cache only one synchronous operation, and only unchanged object snapshots. */
export function platformSecurityScope<T>(run: () => T): T {
  const finish=beginPlatformSecurityScope();
  try { return run(); } finally { finish(); }
}
export function beginPlatformSecurityScope():()=>void {
  if (!scope) {cache.clear();reparseCache.clear();}
  scope++;
  return ()=>{if (!--scope) {cache.clear();reparseCache.clear();}};
}
/** A mutation owner must end the actual scope, not merely a nested wrapper.
 * Refuse misuse rather than clearing an enclosing reader's authority silently. */
export function requirePlatformWriteBoundary():void {
  if(scope)throw new PlatformError('managed-step-conflict');
  requestBudget?.require();
}
/** A pre-dispatch metadata read may route locks, but never grant authority. The
 * fresh owner must bind its actual Store to an acquired slot before any effect. */
export function requirePlatformStoreFence(database:string):void {
  requestBudget?.require();
  const targets=requestBudget?.writerFence?requestBudget.writerFence.targets??[]:writerTargets;
  if(targets&&!targets.includes(writerTarget('store',path.dirname(database))))
    throw new PlatformError('managed-step-conflict');
}

/** Windows PowerShell can expand inherited module paths during startup. */
export const windowsPowerShellBootstrap = String.raw`
$env:PSModulePath = $PSHOME + '\Modules'
$PSModuleAutoLoadingPreference = 'None'
Import-Module ($PSHOME + '\Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1') -ErrorAction Stop
`;

/** Shared pure descriptor policy, also exercised by public .NET fixtures. */
export const windowsDaclValidationScript = String.raw`
function Test-OrdinaryDacl($binary) {
  $raw = [Security.AccessControl.RawSecurityDescriptor]::new($binary, 0)
  if ($null -eq $raw.DiscretionaryAcl) { return $false }
  foreach ($ace in $raw.DiscretionaryAcl) {
    if ($ace -isnot [Security.AccessControl.CommonAce] -or $ace.IsCallback -or $ace.AceQualifier -notin @([Security.AccessControl.AceQualifier]::AccessAllowed, [Security.AccessControl.AceQualifier]::AccessDenied) -or ([int]$ace.AceFlags -band 224)) { return $false }
  }
  return $true
}
function Test-TrustedAncestorOwner($owner, $currentUser) {
  # Owners can rewrite a DACL even without an explicit write ACE. The service
  # SID below is Windows Modules Installer (TrustedInstaller), ancestor-only.
  return $owner -in @($currentUser, 'S-1-5-18', 'S-1-5-32-544', 'S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464')
}
`;
// Trusted code only. User-supplied paths travel through UTF-8 JSON stdin.
const securityScript = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
${windowsPowerShellBootstrap}
${windowsDaclValidationScript}
$writerMutex = $null
$writerOwned = $false
$failureCode = 'windows-security-unavailable'
try {
  $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
  $user = [Security.Principal.WindowsIdentity]::GetCurrent().User
  if ($request.fence) {
    $failureCode = 'managed-step-unsettled'
    # The main service holds the TCP writer slot until its Node worker exits.
    # This account-scoped mutex additionally fences a security child that might
    # outlive that service. Obtain it BEFORE checking the current slot nonce.
    # Every new writer's first fresh query crosses this barrier before effects.
    $writerMutex = [Threading.Mutex]::new($false, ('Global\OpenChamberAgentProgressWriterV1-' + $user.Value))
    try { $writerOwned = $writerMutex.WaitOne(15000) }
    catch [Threading.AbandonedMutexException] { $writerOwned = $true }
    if (-not $writerOwned) { $failureCode = 'managed-step-unsettled'; throw 'writer-unsettled' }
    $client = [Net.Sockets.TcpClient]::new()
    try {
      $client.SendTimeout = 1000; $client.ReceiveTimeout = 1000
      $client.Connect('127.0.0.1', [int]$request.fence.port)
      $stream = $client.GetStream()
      $bytes = [Text.Encoding]::ASCII.GetBytes(([string]$request.fence.nonce + [char]10))
      $stream.Write($bytes, 0, $bytes.Length)
      $reply = [byte[]]::new(3); $offset = 0
      while ($offset -lt 3) {
        $count = $stream.Read($reply, $offset, 3 - $offset)
        if ($count -le 0) { throw 'writer-unsettled' }
        $offset += $count
      }
      if ([Text.Encoding]::ASCII.GetString($reply) -ne ('ok' + [char]10)) { throw 'writer-unsettled' }
    } finally { $client.Dispose() }
    $failureCode = 'windows-security-unavailable'
  }
  $allowed = @($user.Value, 'S-1-5-18', 'S-1-5-32-544')
  if ($request.create) {
    foreach ($target in $request.create) {
      if (-not [IO.Directory]::Exists($target)) {
        $security = [Security.AccessControl.DirectorySecurity]::new()
        $security.SetOwner($user)
        $security.SetAccessRuleProtection($true, $false)
        foreach ($value in $allowed) {
          $sid = [Security.Principal.SecurityIdentifier]::new($value)
          $rule = [Security.AccessControl.FileSystemAccessRule]::new($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
          $security.AddAccessRule($rule)
        }
        [void][IO.Directory]::CreateDirectory($target, $security)
      }
    }
  }
  $results = @()
  foreach ($target in $request.paths) {
    $owned = $false; $private = $false; $reparse = $true; $unsafeParent = $true
    try {
      $attributes = [IO.File]::GetAttributes($target)
      $reparse = [bool]($attributes -band [IO.FileAttributes]::ReparsePoint)
      if ($attributes -band [IO.FileAttributes]::Directory) { $acl = [IO.Directory]::GetAccessControl($target) }
      else { $acl = [IO.File]::GetAccessControl($target) }
      $owner = $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value
      $owned = $owner -eq $user.Value
      $ordinary = Test-OrdinaryDacl ($acl.GetSecurityDescriptorBinaryForm())
      $private = $ordinary -and $owned -and $acl.AreAccessRulesCanonical -and -not $reparse
      $unsafeParent = -not $ordinary -or -not (Test-TrustedAncestorOwner $owner $user.Value)
      $granted = $false
      $full = [Security.AccessControl.FileSystemRights]::FullControl
      $replace = [Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor [Security.AccessControl.FileSystemRights]::Delete -bor [Security.AccessControl.FileSystemRights]::ChangePermissions -bor [Security.AccessControl.FileSystemRights]::TakeOwnership -bor 0x10000000
      if ($ordinary) { foreach ($rule in $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
        if ($rule.AccessControlType -ne 'Allow' -or $rule.IdentityReference.Value -notin $allowed) { $private = $false }
        if (($attributes -band [IO.FileAttributes]::Directory) -and $rule.AccessControlType -eq 'Allow' -and $rule.IdentityReference.Value -notin $allowed -and -not ($rule.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly) -and ($rule.FileSystemRights -band $replace)) { $unsafeParent = $true }
        if ($rule.AccessControlType -eq 'Allow' -and $rule.IdentityReference.Value -eq $user.Value -and -not ($rule.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly) -and ($rule.FileSystemRights -band $full) -eq $full) { $granted = $true }
      } }
      $private = $private -and $granted
    } catch { $private = $false; $unsafeParent = $true }
    $results += @{owned=$owned;private=$private;reparse=$reparse;unsafeParent=$unsafeParent}
  }
  [Console]::Out.Write((ConvertTo-Json -InputObject $results -Compress))
} catch { [Console]::Out.Write(('{"error":"' + $failureCode + '"}')); exit 1 }
finally {
  if ($writerOwned) { $writerMutex.ReleaseMutex() }
  if ($null -ne $writerMutex) { $writerMutex.Dispose() }
}
`;

function snapshot(file: string) {
  const s = lstatSync(file, { bigint: true });
  return [s.dev,s.ino,s.mode,s.nlink,s.size,s.mtimeNs,s.ctimeNs,s.birthtimeNs].join(':');
}
function objectIdentity(file:string) {const s=lstatSync(file,{bigint:true});return[s.dev,s.ino,s.mode,s.birthtimeNs].join(':');}
/** Directory content timestamps do not describe reparse identity or permissions. */
function reparsePaths(paths:string[],parents:Set<string>) {
  const fresh=new Map<string,{identity:string;reparse:boolean;unsafeParent:boolean}>();
  const pending=paths.filter(p=>!scope||reparseCache.get(p)?.identity!==objectIdentity(p));
  const before=pending.map(objectIdentity),stats=pending.map(snapshot),results=pending.length?windowsSecurityQuery(pending):[];
  pending.forEach((p,i)=>{
    const after=objectIdentity(p);if(after!==before[i])throw new PlatformError('path-unverified');
    const result={identity:after,reparse:results[i]!.reparse,unsafeParent:results[i]!.unsafeParent};fresh.set(p,result);
    if(reparseCache.size<1024||reparseCache.has(p))reparseCache.set(p,result);
    // ACL caching remains stricter: full object and mutation metadata only.
    if(snapshot(p)===stats[i]&&(cache.size<1024||cache.has(p)))cache.set(p,{snapshot:stats[i]!,result:results[i]!});
  });
  if(paths.some(p=>parents.has(p)&&(fresh.get(p)??reparseCache.get(p)!).unsafeParent))throw new PlatformError('unsafe-parent');
  return paths.some(p=>(fresh.get(p)??reparseCache.get(p)!).reparse);
}
let securityQueryAttempted = false;
/** Injectable process boundary; production callers always use the built-in spawn. */
export function windowsSecurityQuery(paths: string[], create: string[] = [], spawn: (command: string, args: string[], options: SpawnSyncOptionsWithStringEncoding) => SpawnSyncReturns<string> = spawnSync): Security[] {
  const systemRoot = process.env.SystemRoot ?? process.env.SYSTEMROOT;
  if (!systemRoot || !/^[a-z]:[\\/]/i.test(systemRoot)) throw new PlatformError('windows-security-unavailable');
  // Do not inherit profile, module, proxy, Node or PowerShell startup overrides.
  const env: NodeJS.ProcessEnv = {};
  for (const key of ['SystemRoot','SYSTEMROOT','WINDIR','TEMP','TMP','USERPROFILE','HOMEDRIVE','HOMEPATH','LOCALAPPDATA']) {
    if (process.env[key]) env[key] = process.env[key];
  }
  // Pin startup hints too; the trusted script resets the effective path and
  // imports only the built-in utility module by its absolute system path.
  env.PSModulePath=path.join(systemRoot,'System32','WindowsPowerShell','v1.0','Modules');
  const input = JSON.stringify({ paths, create, ...(requestBudget?.writerFence?{fence:requestBudget.writerFence}:{}) });
  const firstQuery = !securityQueryAttempted;
  const run = () => {
    const timeout=requestBudget?requestBudget.launch():firstQuery?30000:10000;
    try{return spawn(path.join(systemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe'),
      ['-NoLogo','-NoProfile','-NonInteractive','-Command',securityScript],
      { input, encoding:'utf8', env, windowsHide:true, shell:false, timeout, maxBuffer:1024*1024 });
    }finally{securityQueryAttempted=true;}
  };
  // Only the process's first query gets cold-start headroom and one retry.
  // Consume that budget even on failure; steady-state calls stay bounded at 10s.
  // Existing creation targets are only inspected, never repaired, on a retry.
  let child: SpawnSyncReturns<string>;
  child = run();
  if (!requestBudget && firstQuery && (child.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT') child = run();
  requestBudget?.require();
  if(requestBudget&&(child.error as NodeJS.ErrnoException|undefined)?.code==='ETIMEDOUT')throw new PlatformError('managed-step-deadline','timeout');
  if(requestBudget?.writerFence&&!child.error&&child.status!==0){
    let failure:unknown;try{failure=JSON.parse(child.stdout.replace(/^\uFEFF/,''));}catch{/* Never expose raw child text. */}
    if(failure&&typeof failure==='object'&&Object.keys(failure).length===1&&(failure as {error?:unknown}).error==='managed-step-unsettled')
      throw new PlatformError('managed-step-unsettled','exit');
  }
  if (child.error || child.status !== 0) throw new PlatformError('windows-security-unavailable',child.error?(child.error as NodeJS.ErrnoException).code==='ETIMEDOUT'?'timeout':'spawn':'exit');
  let results: Security[];
  try { results = JSON.parse(child.stdout.replace(/^\uFEFF/,'')); } catch { throw new PlatformError('windows-security-unavailable'); }
  if (!Array.isArray(results) || results.length !== paths.length || results.some(r => !r || ['owned','private','reparse','unsafeParent'].some(k => typeof r[k as keyof Security] !== 'boolean'))) throw new PlatformError('windows-security-unavailable');
  return results;
}
/** Batch related paths; never retain a security result across operations. */
export function windowsSecurity(paths: string[]): Security[] {
  const pending = new Map<string,string>();
  const fresh = new Map<string,Security>();
  for (const file of paths) { const stat = snapshot(file); if (!scope || cache.get(file)?.snapshot !== stat) pending.set(file,stat); }
  const files = [...pending.keys()];
  if (files.length) {
    const results = windowsSecurityQuery(files);
    files.forEach((file,i) => {
      const after=snapshot(file),before=pending.get(file)!;
      if (after.split(':').slice(0,2).join(':') !== before.split(':').slice(0,2).join(':')) throw new PlatformError('path-unverified');
      fresh.set(file,results[i]!);
      if(reparseCache.size<1024||reparseCache.has(file))reparseCache.set(file,{identity:objectIdentity(file),reparse:results[i]!.reparse,unsafeParent:results[i]!.unsafeParent});
      // Shared ancestors can change while PowerShell starts (e.g. OS temp).
      // Return the fresh observation, but never cache a changed snapshot.
      if(after===before){if(cache.size<1024||cache.has(file))cache.set(file,{snapshot:before,result:results[i]!});}
      else cache.delete(file);
    });
  }
  return paths.map(file => fresh.get(file)??cache.get(file)!.result);
}

/** Reject ambiguous syntax BEFORE normalization; canonicalize actual spelling. */
export function windowsPath(value: string, allowMissing = false): string {
  return windowsPaths([value],allowMissing)[0]!;
}
export function windowsPaths(values: string[], allowMissing = false): string[] {
  return platformSecurityScope(()=>windowsPathsInner(values,allowMissing));
}
/** Source documents are authorized reads, not private product storage. */
export function windowsDocumentPath(value:string,allowMissing=false):string {
  return platformSecurityScope(()=>windowsPathsInner([value],allowMissing,false)[0]!);
}
function windowsPathsInner(values: string[], allowMissing = false, privateState=true): string[] {
  const ancestors=new Set<string>(),parents=new Set<string>();
  const resolved=values.map(value=>{
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
  for (let p=current;;p=path.dirname(p)) {
    const stat=lstatSync(p); if(stat.isSymbolicLink()) throw new PlatformError('symlink-escape');
    ancestors.add(p); if(path.dirname(p)===p)break;
  }
  for(let p=tail.length?current:path.dirname(current);;p=path.dirname(p)){parents.add(p);if(path.dirname(p)===p)break;}
  return path.join(realpathSync.native(current),...tail);
  });
  if (reparsePaths([...ancestors],privateState?parents:new Set())) throw new PlatformError('symlink-escape');
  return resolved;
}

export function isOwned(file: string) {
  return windows ? windowsSecurity([file])[0]!.owned : lstatSync(file).uid === process.getuid?.();
}
/** Compare native directory identities, preserving case-sensitive distinctions. */
export function sameWindowsDirectory(left:string,right:string) {
  return sameWindowsObject(left,right,true);
}
export function sameWindowsObject(left:string,right:string,directory=false) {
  return platformSecurityScope(()=>{
    const [a,b]=windowsPaths([left,right]);
    const first=lstatSync(a!,{bigint:true}),second=lstatSync(b!,{bigint:true});
    return (!directory||first.isDirectory()&&second.isDirectory())&&first.ino!==0n&&first.dev===second.dev&&first.ino===second.ino;
  });
}
export function privatePaths(files: string[]) {
  // Named aliases must not split SQLite journals or mutate retained metadata.
  return windows ? files.every(file=>{const s=lstatSync(file);return !s.isFile()||s.nlink===1;})&&windowsSecurity(files).every(s=>s.private) : files.every(file=>{
    const s=lstatSync(file);return !s.isSymbolicLink()&&s.uid===process.getuid?.()&&(s.mode&0o777)===(s.isDirectory()?0o700:0o600);
  });
}
export function privateDirectory(file: string, recursive=false) {
  if (!windows) { mkdirSync(file,{recursive,mode:0o700}); return; }
  platformSecurityScope(()=>{
    const target=windowsPath(file,true);
    const missing:string[]=[]; let parent=target;
    while(!existsSync(parent)){missing.unshift(parent);parent=path.dirname(parent);}
    if(!recursive&&missing.length>1)throw new PlatformError('path-unverified');
    if(missing.length) {
      const results=windowsSecurityQuery(missing,missing);
      if(results.some(r=>!r.private))throw new PlatformError('private-permissions');
      missing.forEach(p=>cache.delete(p));
    } else if(!lstatSync(target).isDirectory()||!privatePaths([target]))throw new PlatformError('private-permissions');
  });
}
export function syncFile(file:string) {const fd=openSync(file,windows?'r+':'r');try{fsyncSync(fd);}finally{closeSync(fd);}}
/** Windows has atomic selection/process recovery, not POSIX directory durability. */
export function syncDirectory(dir:string) {if(windows)return;const fd=openSync(dir,'r');try{fsyncSync(fd);}finally{closeSync(fd);}}
