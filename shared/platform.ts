import { spawnSync } from 'node:child_process';
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, realpathSync } from 'node:fs';
import path from 'node:path';

export const windows = process.platform === 'win32';
export class PlatformError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; }
}
type Security = { owned: boolean; private: boolean; reparse: boolean; unsafeParent: boolean };
const cache = new Map<string, { snapshot: string; result: Security }>();
const reparseCache = new Map<string,{identity:string;reparse:boolean;unsafeParent:boolean}>();
let scope = 0;
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
${windowsDaclValidationScript}
try {
  $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
  $user = [Security.Principal.WindowsIdentity]::GetCurrent().User
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
} catch { [Console]::Out.Write('{"error":"windows-security-unavailable"}'); exit 1 }
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
  const before=pending.map(objectIdentity),stats=pending.map(snapshot),results=pending.length?query(pending):[];
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
function query(paths: string[], create: string[] = []): Security[] {
  const systemRoot = process.env.SystemRoot ?? process.env.SYSTEMROOT;
  if (!systemRoot || !/^[a-z]:[\\/]/i.test(systemRoot)) throw new PlatformError('windows-security-unavailable');
  // Do not inherit profile, module, proxy, Node or PowerShell startup overrides.
  const env: NodeJS.ProcessEnv = {};
  for (const key of ['SystemRoot','SYSTEMROOT','WINDIR','TEMP','TMP','USERPROFILE','HOMEDRIVE','HOMEPATH','LOCALAPPDATA']) {
    if (process.env[key]) env[key] = process.env[key];
  }
  const child = spawnSync(path.join(systemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe'),
    ['-NoLogo','-NoProfile','-NonInteractive','-Command',securityScript],
    { input: JSON.stringify({ paths, create }), encoding:'utf8', env, windowsHide:true, shell:false, timeout:10000, maxBuffer:1024*1024 });
  if (child.error || child.status !== 0) throw new PlatformError('windows-security-unavailable');
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
    const results = query(files);
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
      const results=query(missing,missing);
      if(results.some(r=>!r.private))throw new PlatformError('private-permissions');
      missing.forEach(p=>cache.delete(p));
    } else if(!lstatSync(target).isDirectory()||!privatePaths([target]))throw new PlatformError('private-permissions');
  });
}
export function syncFile(file:string) {const fd=openSync(file,windows?'r+':'r');try{fsyncSync(fd);}finally{closeSync(fd);}}
/** Windows has atomic selection/process recovery, not POSIX directory durability. */
export function syncDirectory(dir:string) {if(windows)return;const fd=openSync(dir,'r');try{fsyncSync(fd);}finally{closeSync(fd);}}
