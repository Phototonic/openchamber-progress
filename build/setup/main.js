// setup/cli.ts
import { readFileSync as readFileSync3 } from "node:fs";
import path6 from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";

// shared/binding.ts
import { lstatSync as lstatSync2, readFileSync, realpathSync as realpathSync2 } from "node:fs";
import path2 from "node:path";
import { fileURLToPath } from "node:url";

// shared/platform.ts
import { spawnSync } from "node:child_process";
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, realpathSync } from "node:fs";
import path from "node:path";
var windows = process.platform === "win32";

class PlatformError extends Error {
  code;
  reason;
  constructor(code, reason) {
    super(code);
    this.code = code;
    this.reason = reason;
  }
}
var cache = new Map;
var reparseCache = new Map;
var scope = 0;
function platformSecurityScope(run) {
  const finish = beginPlatformSecurityScope();
  try {
    return run();
  } finally {
    finish();
  }
}
function beginPlatformSecurityScope() {
  if (!scope) {
    cache.clear();
    reparseCache.clear();
  }
  scope++;
  return () => {
    if (!--scope) {
      cache.clear();
      reparseCache.clear();
    }
  };
}
var windowsPowerShellBootstrap = String.raw`
$env:PSModulePath = $PSHOME + '\Modules'
$PSModuleAutoLoadingPreference = 'None'
Import-Module ($PSHOME + '\Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1') -ErrorAction Stop
`;
var windowsDaclValidationScript = String.raw`
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
var securityScript = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
${windowsPowerShellBootstrap}
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
function snapshot(file) {
  const s = lstatSync(file, { bigint: true });
  return [s.dev, s.ino, s.mode, s.nlink, s.size, s.mtimeNs, s.ctimeNs, s.birthtimeNs].join(":");
}
function objectIdentity(file) {
  const s = lstatSync(file, { bigint: true });
  return [s.dev, s.ino, s.mode, s.birthtimeNs].join(":");
}
function reparsePaths(paths, parents) {
  const fresh = new Map;
  const pending = paths.filter((p) => !scope || reparseCache.get(p)?.identity !== objectIdentity(p));
  const before = pending.map(objectIdentity), stats = pending.map(snapshot), results = pending.length ? query(pending) : [];
  pending.forEach((p, i) => {
    const after = objectIdentity(p);
    if (after !== before[i])
      throw new PlatformError("path-unverified");
    const result = { identity: after, reparse: results[i].reparse, unsafeParent: results[i].unsafeParent };
    fresh.set(p, result);
    if (reparseCache.size < 1024 || reparseCache.has(p))
      reparseCache.set(p, result);
    if (snapshot(p) === stats[i] && (cache.size < 1024 || cache.has(p)))
      cache.set(p, { snapshot: stats[i], result: results[i] });
  });
  if (paths.some((p) => parents.has(p) && (fresh.get(p) ?? reparseCache.get(p)).unsafeParent))
    throw new PlatformError("unsafe-parent");
  return paths.some((p) => (fresh.get(p) ?? reparseCache.get(p)).reparse);
}
function query(paths, create = []) {
  const systemRoot = process.env.SystemRoot ?? process.env.SYSTEMROOT;
  if (!systemRoot || !/^[a-z]:[\\/]/i.test(systemRoot))
    throw new PlatformError("windows-security-unavailable");
  const env = {};
  for (const key of ["SystemRoot", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "LOCALAPPDATA"]) {
    if (process.env[key])
      env[key] = process.env[key];
  }
  env.PSModulePath = path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "Modules");
  const child = spawnSync(path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"), ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", securityScript], { input: JSON.stringify({ paths, create }), encoding: "utf8", env, windowsHide: true, shell: false, timeout: 1e4, maxBuffer: 1024 * 1024 });
  if (child.error || child.status !== 0)
    throw new PlatformError("windows-security-unavailable", child.error ? child.error.code === "ETIMEDOUT" ? "timeout" : "spawn" : "exit");
  let results;
  try {
    results = JSON.parse(child.stdout.replace(/^\uFEFF/, ""));
  } catch {
    throw new PlatformError("windows-security-unavailable");
  }
  if (!Array.isArray(results) || results.length !== paths.length || results.some((r) => !r || ["owned", "private", "reparse", "unsafeParent"].some((k) => typeof r[k] !== "boolean")))
    throw new PlatformError("windows-security-unavailable");
  return results;
}
function windowsSecurity(paths) {
  const pending = new Map;
  const fresh = new Map;
  for (const file of paths) {
    const stat = snapshot(file);
    if (!scope || cache.get(file)?.snapshot !== stat)
      pending.set(file, stat);
  }
  const files = [...pending.keys()];
  if (files.length) {
    const results = query(files);
    files.forEach((file, i) => {
      const after = snapshot(file), before = pending.get(file);
      if (after.split(":").slice(0, 2).join(":") !== before.split(":").slice(0, 2).join(":"))
        throw new PlatformError("path-unverified");
      fresh.set(file, results[i]);
      if (reparseCache.size < 1024 || reparseCache.has(file))
        reparseCache.set(file, { identity: objectIdentity(file), reparse: results[i].reparse, unsafeParent: results[i].unsafeParent });
      if (after === before) {
        if (cache.size < 1024 || cache.has(file))
          cache.set(file, { snapshot: before, result: results[i] });
      } else
        cache.delete(file);
    });
  }
  return paths.map((file) => fresh.get(file) ?? cache.get(file).result);
}
function windowsPath(value, allowMissing = false) {
  return windowsPaths([value], allowMissing)[0];
}
function windowsPaths(values, allowMissing = false) {
  return platformSecurityScope(() => windowsPathsInner(values, allowMissing));
}
function windowsPathsInner(values, allowMissing = false, privateState = true) {
  const ancestors = new Set, parents = new Set;
  const resolved = values.map((value) => {
    if (value.includes("\x00") || value.length > 4096 || !/^[a-z]:[\\/]/i.test(value))
      throw new PlatformError("path-unverified");
    const normalized = value.replaceAll("/", "\\");
    const parts = normalized.slice(3).split("\\").filter(Boolean);
    if (parts.some((p) => p === "." || p === ".." || /[<>:"|?*\x00-\x1f]/.test(p) || /[. ]$/.test(p) || /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(p)))
      throw new PlatformError("path-unverified");
    const clean = normalized.slice(0, 3) + parts.join("\\");
    let current = clean;
    const tail = [];
    while (!existsSync(current)) {
      if (lstatSync(current, { throwIfNoEntry: false }))
        throw new PlatformError("symlink-escape");
      if (!allowMissing)
        throw new PlatformError("path-unverified");
      tail.unshift(path.basename(current));
      const parent = path.dirname(current);
      if (parent === current)
        throw new PlatformError("path-unverified");
      current = parent;
    }
    for (let p = current;; p = path.dirname(p)) {
      const stat = lstatSync(p);
      if (stat.isSymbolicLink())
        throw new PlatformError("symlink-escape");
      ancestors.add(p);
      if (path.dirname(p) === p)
        break;
    }
    for (let p = tail.length ? current : path.dirname(current);; p = path.dirname(p)) {
      parents.add(p);
      if (path.dirname(p) === p)
        break;
    }
    return path.join(realpathSync.native(current), ...tail);
  });
  if (reparsePaths([...ancestors], privateState ? parents : new Set))
    throw new PlatformError("symlink-escape");
  return resolved;
}
function isOwned(file) {
  return windows ? windowsSecurity([file])[0].owned : lstatSync(file).uid === process.getuid?.();
}
function sameWindowsDirectory(left, right) {
  return sameWindowsObject(left, right, true);
}
function sameWindowsObject(left, right, directory = false) {
  return platformSecurityScope(() => {
    const [a, b] = windowsPaths([left, right]);
    const first = lstatSync(a, { bigint: true }), second = lstatSync(b, { bigint: true });
    return (!directory || first.isDirectory() && second.isDirectory()) && first.ino !== 0n && first.dev === second.dev && first.ino === second.ino;
  });
}
function privatePaths(files) {
  return windows ? files.every((file) => {
    const s = lstatSync(file);
    return !s.isFile() || s.nlink === 1;
  }) && windowsSecurity(files).every((s) => s.private) : files.every((file) => {
    const s = lstatSync(file);
    return !s.isSymbolicLink() && s.uid === process.getuid?.() && (s.mode & 511) === (s.isDirectory() ? 448 : 384);
  });
}
function privateDirectory(file, recursive = false) {
  if (!windows) {
    mkdirSync(file, { recursive, mode: 448 });
    return;
  }
  platformSecurityScope(() => {
    const target = windowsPath(file, true);
    const missing = [];
    let parent = target;
    while (!existsSync(parent)) {
      missing.unshift(parent);
      parent = path.dirname(parent);
    }
    if (!recursive && missing.length > 1)
      throw new PlatformError("path-unverified");
    if (missing.length) {
      const results = query(missing, missing);
      if (results.some((r) => !r.private))
        throw new PlatformError("private-permissions");
      missing.forEach((p) => cache.delete(p));
    } else if (!lstatSync(target).isDirectory() || !privatePaths([target]))
      throw new PlatformError("private-permissions");
  });
}
function syncFile(file) {
  const fd = openSync(file, windows ? "r+" : "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
function syncDirectory(dir) {
  if (windows)
    return;
  const fd = openSync(dir, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

// shared/progress.ts
var VERSION = 2;
var LIMITS = { requestBytes: 16384, documentBytes: 262144, pageSize: 20, maxPageSize: 50, chunkItems: 50, chunks: 32, planItems: 1000, responseBytes: 1048576 };
var BLOCKER_LIMITS = { textCodeUnits: 512, snapshotVisits: 128, inputBytes: 8 * 1024 * 1024, taskEntries: 1000 };

class ProgressError extends Error {
  code;
  revision;
  hint;
  constructor(code, revision, hint) {
    super(code);
    this.code = code;
    this.revision = revision;
    if (code === "invalid")
      this.hint = hint;
  }
}
function requireProgress(value, code = "invalid", revision) {
  if (!value)
    throw new ProgressError(code, revision);
}
function countItems(items) {
  const leaves = items.filter((i) => i.kind === "task");
  const done = leaves.filter((i) => i.status === "done").length;
  const skipped = leaves.filter((i) => i.status === "skipped").length;
  return { done, total: leaves.length - skipped, remaining: leaves.length - skipped - done, skipped };
}
var SEARCH_LIMITS = { plans: 64, membershipRows: 128, inputBytes: 8 * 1024 * 1024, hits: 50, ancestors: 8, responseBytes: 256 * 1024, queryBytes: 16 * 1024, queryPoints: 256, tokens: 16, cursorBytes: 4096, stateKeys: 50 };
function identifier(value) {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/.test(value);
}
var BLOCKER_CATEGORIES = ["decision", "dependency", "review", "external", "other"];
function blockerText(value) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= BLOCKER_LIMITS.textCodeUnits && !value.includes("\x00");
}
function validBlockerInput(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return false;
  const b = value;
  return Object.keys(b).every((k) => ["category", "reason", "nextAction"].includes(k)) && (b.category === undefined || typeof b.category === "string" && BLOCKER_CATEGORIES.includes(b.category)) && (b.reason === undefined || blockerText(b.reason)) && (b.nextAction === undefined || blockerText(b.nextAction));
}
function validBlockerAnnotation(value, revision) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return false;
  const b = value;
  return Object.keys(b).every((k) => ["category", "reason", "nextAction", "reportedRevision", "reportedAt", "reporterSessionId", "attributedSessionId", "mode", "validAtRevision"].includes(k)) && (b.category === undefined || typeof b.category === "string" && BLOCKER_CATEGORIES.includes(b.category)) && (b.reason === undefined || blockerText(b.reason)) && (b.nextAction === undefined || blockerText(b.nextAction)) && Number.isSafeInteger(b.reportedRevision) && Number(b.reportedRevision) > 0 && Number(b.reportedRevision) <= revision && Number.isSafeInteger(b.validAtRevision) && b.validAtRevision === revision && typeof b.reportedAt === "string" && Number.isFinite(Date.parse(b.reportedAt)) && new Date(b.reportedAt).toISOString() === b.reportedAt && identifier(b.reporterSessionId) && identifier(b.attributedSessionId) && (b.mode === "direct" && b.reporterSessionId === b.attributedSessionId || b.mode === "parent-relay" && b.reporterSessionId !== b.attributedSessionId);
}
function parseRequest(value) {
  const r = parseReportRequest(value);
  requireProgress(r.op !== "handoff");
  return r;
}
function parseReportRequest(value) {
  validRequest(value && typeof value === "object" && !Array.isArray(value), "request");
  if (value.op === "handoff") {
    const r2 = value;
    requireProgress(Object.keys(r2).every((k) => ["op", "oid", "summary", "outcome"].includes(k)) && identifier(r2.oid) && typeof r2.summary === "string" && r2.summary.trim().length > 0 && r2.summary.length <= 200 && !/[\u0000\r\n\u2028\u2029]/.test(r2.summary) && ["done", "partial", "blocked"].includes(r2.outcome) && Buffer.byteLength(JSON.stringify(r2)) <= LIMITS.requestBytes);
    return { op: "handoff", oid: r2.oid, summary: r2.summary, outcome: r2.outcome };
  }
  const r = value;
  const fields = {
    start: ["title", "items", "source"],
    read: ["page"],
    change: ["changes", "attributed"],
    revise: ["title", "items", "reopen"],
    stage: ["upload", "chunk", "items", "reopen"],
    commit: ["upload", "chunks", "title", "reopen"],
    link: ["child", "assign"],
    delegate: ["assign"],
    bind: ["source", "confirm"],
    finish: ["outcome"]
  };
  validRequest(Object.hasOwn(fields, r.op), "op");
  validRequest(identifier(r.plan), "plan");
  const allowed = ["op", "plan", ...r.op === "read" ? [] : ["oid", "rev"], ...fields[r.op]];
  validRequest(Object.keys(r).every((k) => allowed.includes(k)), "fields");
  requireProgress(Buffer.byteLength(JSON.stringify(r)) <= LIMITS.requestBytes);
  if (r.op !== "read") {
    validRequest(identifier(r.oid), "oid");
    validRequest(Number.isSafeInteger(r.rev) && r.rev >= 0, "rev");
  }
  if (r.page !== undefined)
    requireProgress(Number.isSafeInteger(r.page) && r.page >= 0);
  if (r.title !== undefined)
    validRequest(typeof r.title === "string" && r.title.trim().length > 0 && r.title.length <= 256, "title");
  if (r.source !== undefined)
    validRequest(typeof r.source === "string" && r.source.length > 0 && r.source.length <= 4096 && !r.source.includes("\x00"), "source");
  for (const f of ["confirm", "reopen"])
    if (r[f] !== undefined)
      requireProgress(typeof r[f] === "boolean");
  if (r.items !== undefined) {
    validRequest(Array.isArray(r.items) && r.items.length <= LIMITS.chunkItems, "items");
    for (const i of r.items) {
      validRequest(i && Object.keys(i).every((k) => ["id", "title", "kind", "status", "parentId", "dependencies", "blocker"].includes(k)) && identifier(i.id) && typeof i.title === "string" && i.title.trim().length > 0 && i.title.length <= 512 && ["task", "group"].includes(i.kind), "items");
      if (i.status !== undefined)
        validRequest(["pending", "working", "blocked", "done", "skipped"].includes(i.status), "items");
      if (i.parentId !== undefined)
        validRequest(identifier(i.parentId), "items");
      if (i.dependencies !== undefined)
        validRequest(Array.isArray(i.dependencies) && i.dependencies.length <= 16 && i.dependencies.every(identifier), "items");
      if (Object.hasOwn(i, "blocker"))
        requireProgress(i.kind === "task" && (i.blocker === null || validBlockerInput(i.blocker)) && (i.blocker === null || i.status === undefined || i.status === "blocked"));
    }
  }
  if (r.changes !== undefined)
    requireProgress(Array.isArray(r.changes) && r.changes.length > 0 && r.changes.length <= 50 && r.changes.every((c) => c && Object.keys(c).every((k) => ["id", "status", "blocker"].includes(k)) && identifier(c.id) && ["pending", "working", "blocked", "done", "skipped"].includes(c.status) && (!Object.hasOwn(c, "blocker") || c.blocker === null || c.status === "blocked" && validBlockerInput(c.blocker))));
  if (r.child !== undefined)
    requireProgress(identifier(r.child));
  if (r.attributed !== undefined)
    requireProgress(identifier(r.attributed));
  if (r.assign !== undefined)
    requireProgress(Array.isArray(r.assign) && r.assign.length <= LIMITS.planItems && r.assign.every(identifier));
  if (r.upload !== undefined)
    requireProgress(identifier(r.upload));
  if (r.chunk !== undefined)
    requireProgress(Number.isInteger(r.chunk) && r.chunk >= 0 && r.chunk < LIMITS.chunks);
  if (r.chunks !== undefined)
    requireProgress(Number.isInteger(r.chunks) && r.chunks > 0 && r.chunks <= LIMITS.chunks);
  if (r.outcome !== undefined)
    requireProgress(["finished", "cancelled", "failed"].includes(r.outcome));
  validRequest(r.op !== "start" || !!r.title && !!r.items, "start");
  requireProgress(r.op !== "change" || !!r.changes);
  requireProgress(r.op !== "revise" || !!r.items || !!r.title);
  requireProgress(r.op !== "stage" || !!r.upload && r.chunk !== undefined && !!r.items);
  requireProgress(r.op !== "commit" || !!r.upload && !!r.chunks);
  requireProgress(r.op !== "link" || !!r.child && !!r.assign);
  requireProgress(r.op !== "delegate" || Array.isArray(r.assign) && r.assign.length <= 50 && new Set(r.assign).size === r.assign.length);
  requireProgress(r.op !== "bind" || !!r.source);
  requireProgress(r.op !== "finish" || !!r.outcome);
  return JSON.parse(JSON.stringify(r));
}
var VALIDATION_HINTS = {
  request: "Send one request object.",
  op: "Use a supported op: start, read, change, revise, stage, commit, link, delegate, bind, finish or handoff.",
  plan: "Use one concrete plan identifier (1-80 letters, digits, _, ., : or -, starting with a letter or digit); read does not accept wildcards.",
  fields: "Remove unsupported fields for this op. Read accepts only op, plan and optional 0-based page; omit page for a compact summary without items, or set page for paged detail. Mutations also require oid and rev.",
  oid: "Every mutation requires oid: a fresh identifier (1-80 letters, digits, _, ., : or -, starting with a letter or digit). Reuse only for an identical retry.",
  rev: "Every mutation requires rev: a nonnegative safe integer. Use rev:0 for a new start; read the current revision before updating.",
  title: "Use a nonempty title of at most 256 characters.",
  source: "Optional source must be a nonempty path string of at most 4096 characters without NUL.",
  items: "Items must be an array of at most 50 entries, each with id, nonempty title (at most 512 characters) and kind task or group; use valid statuses and identifiers.",
  start: "Start requires title and items, plus oid and rev. Use rev:0 for a new plan and include the complete item structure."
};
function validRequest(value, hint) {
  if (!value)
    throw new ProgressError("invalid", undefined, VALIDATION_HINTS[hint]);
}

// shared/binding.ts
function readBinding(file) {
  return platformSecurityScope(() => readBindingInner(file));
}
function readBindingInner(file) {
  const p = file instanceof URL ? file : path2.resolve(file);
  const stat = lstatSync2(p);
  requireProgress(!stat.isSymbolicLink() && stat.isFile() && (windows ? sameWindowsObject(windowsPath(file instanceof URL ? fileURLToPath(file) : file), realpathSync2.native(p)) && privatePaths([realpathSync2.native(p)]) : stat.uid === process.getuid?.() && (stat.mode & 511) === 384), "binding");
  const b = JSON.parse(readFileSync(p, "utf8"));
  requireProgress(b.protocolVersion === VERSION && b.schemaVersion === VERSION, "schema");
  requireProgress(typeof b.installId === "string" && typeof b.version === "string" && typeof b.storeId === "string" && path2.isAbsolute(b.database) && path2.basename(b.database) === "progress.sqlite", "binding");
  requireProgress(b.source && typeof b.source.id === "string" && typeof b.source.verified === "boolean", "binding");
  const roots = [path2.dirname(b.database), b.source.configRoot, b.source.dataRoot];
  if (windows) {
    const resolved = windowsPaths(roots);
    requireProgress(resolved.every((v, i) => sameWindowsDirectory(v, roots[i]) && isOwned(v)), "binding");
  } else
    for (const root of roots)
      requireProgress(path2.isAbsolute(root) && realpathSync2(root) === root, "binding");
  return b;
}
function verifyStore(store, b) {
  const envelope = store.list({ limit: 1 });
  requireProgress(envelope.storeId === b.storeId && envelope.sources.some((s) => s.id === b.source.id && s.configRoot === b.source.configRoot && s.dataRoot === b.source.dataRoot && s.verified === b.source.verified), "binding");
}

// setup/lifecycle.ts
import { randomUUID as randomUUID4 } from "node:crypto";
import { existsSync as existsSync4, lstatSync as lstatSync5, realpathSync as realpathSync5, mkdirSync as mkdirSync2, readFileSync as readFileSync2, readdirSync, writeFileSync, renameSync, rmSync, rmdirSync, appendFileSync } from "node:fs";
import path5 from "node:path";

// shared/store.ts
import { DatabaseSync as DatabaseSync2 } from "node:sqlite";

// shared/subagent-runs.ts
import { createHash as createHash2, randomUUID as randomUUID2 } from "node:crypto";

// shared/cleanup.ts
import { DatabaseSync } from "node:sqlite";
import { randomUUID, createHash } from "node:crypto";
import { openSync as openSync2, closeSync as closeSync2, lstatSync as lstatSync3, unlinkSync, realpathSync as realpathSync3, existsSync as existsSync2 } from "node:fs";
import path3 from "node:path";
var definitions = {
  cleanup_format: "CREATE TABLE cleanup_format(singleton INTEGER PRIMARY KEY CHECK(singleton=1), version INTEGER NOT NULL CHECK(version=1))",
  cleanup_state: "CREATE TABLE cleanup_state(source TEXT NOT NULL, plan TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN('visible','archived','deleted')), generation INTEGER NOT NULL CHECK(generation>0), oid TEXT NOT NULL, request_hash TEXT NOT NULL, receipt TEXT NOT NULL CHECK(json_valid(receipt)), PRIMARY KEY(source,plan))"
};
for (const table of ["plans", "chunks", "captures", "revisions", "contributions", "receipts"]) {
  const key = table === "plans" ? "id" : "plan";
  for (const event of ["INSERT", "UPDATE"]) {
    const name = `cleanup_guard_${table}_${event.toLowerCase()}`;
    const predicate = (row) => `EXISTS(SELECT 1 FROM cleanup_state WHERE source=${row}.source AND plan=${row}.${key} AND state IN('archived','deleted'))`;
    definitions[name] = `CREATE TRIGGER ${name} BEFORE ${event} ON ${table} WHEN ${predicate("NEW")}${event === "UPDATE" ? ` OR ${predicate("OLD")}` : ""} BEGIN SELECT RAISE(ABORT, 'cleanup-closed'); END`;
  }
}
var normalized = (sql) => sql.trim().replace(/\s+/g, " ");
function cleanupInstalled(db) {
  requireProgress(Number(db.prepare("PRAGMA user_version").get().user_version) === 2, "schema");
  const rows = db.prepare("SELECT name,sql FROM sqlite_master WHERE name GLOB 'cleanup_*'").all();
  if (!rows.length)
    return false;
  requireProgress(rows.length === Object.keys(definitions).length, "schema");
  for (const row of rows)
    requireProgress(typeof row.name === "string" && definitions[row.name] !== undefined && normalized(String(row.sql)) === normalized(definitions[row.name]), "schema");
  const format = db.prepare("SELECT * FROM cleanup_format").all();
  requireProgress(format.length === 1 && format[0].singleton === 1 && format[0].version === 1, "schema");
  return true;
}
function cleanupState(db, source, plan) {
  return db.prepare("SELECT * FROM cleanup_state WHERE source=? AND plan=?").get(source, plan);
}
function parseCleanup(action, value) {
  requireProgress(["archive", "restore", "delete"].includes(action));
  requireProgress(value && typeof value === "object" && !Array.isArray(value));
  const r = value;
  const fields = ["storeId", "source", "plan", "rev", "cleanupRev", "oid", ...action === "delete" ? ["confirmed"] : []];
  requireProgress(Object.keys(r).every((k) => fields.includes(k)));
  requireProgress(identifier(r.storeId) && identifier(r.source) && identifier(r.plan) && identifier(r.oid));
  requireProgress(Number.isSafeInteger(r.rev) && r.rev > 0 && Number.isSafeInteger(r.cleanupRev) && r.cleanupRev >= 0 && r.cleanupRev < Number.MAX_SAFE_INTEGER);
  requireProgress(action !== "delete" || r.confirmed === true);
  return r;
}
function requestHash(action, r) {
  return createHash("sha256").update(JSON.stringify([action, r.storeId, r.source, r.plan, r.rev, r.cleanupRev, r.oid, r.confirmed ?? false])).digest("hex");
}
function preflight(db, action, r, installed) {
  requireProgress(db.prepare("SELECT store_id FROM meta WHERE singleton=1").get()?.store_id === r.storeId, "conflict");
  const state = installed ? cleanupState(db, r.source, r.plan) : undefined;
  if (state?.oid === r.oid) {
    requireProgress(state.request_hash === requestHash(action, r), "operation-reused");
    return JSON.parse(String(state.receipt));
  }
  requireProgress((state?.generation ?? 0) === r.cleanupRev, "conflict");
  const row = db.prepare("SELECT snapshot,revision FROM plans WHERE source=? AND id=?").get(r.source, r.plan);
  requireProgress(row && state?.state !== "deleted", "not-found");
  requireProgress(row.revision === r.rev, "conflict");
  let p;
  try {
    p = JSON.parse(String(row.snapshot));
  } catch {
    throw new ProgressError("corrupt");
  }
  requireProgress(p.id === r.plan && p.sourceId === r.source && p.revision === r.rev, "corrupt");
  requireProgress(p.lifecycle === "finished", "closed");
  requireProgress(action === "restore" ? state?.state === "archived" : action === "delete" || !state || state.state === "visible", "closed");
}
function backup(db, file) {
  return platformSecurityScope(() => backupPrivate(db, file));
}
function backupPrivate(db, file) {
  const parent = path3.dirname(file);
  const owned = lstatSync3(parent);
  requireProgress(owned.isDirectory() && !owned.isSymbolicLink() && privatePaths([parent]), "binding");
  if (windows) {
    const secured = [parent, file, ...["-journal", "-wal", "-shm"].map((s) => file + s)].filter(existsSync2);
    const resolved = windowsPaths(secured);
    requireProgress(existsSync2(file) && sameWindowsDirectory(resolved[0], parent) && resolved.every((v, i) => sameWindowsObject(v, secured[i])) && privatePaths(secured), "binding");
  } else
    requireProgress(realpathSync3(parent) === parent, "binding");
  const destination = path3.join(path3.dirname(file), `cleanup-backup-${randomUUID()}.sqlite`);
  const fd = openSync2(destination, "wx", 384);
  closeSync2(fd);
  let copy;
  try {
    if (windows)
      requireProgress(sameWindowsObject(windowsPaths([destination])[0], destination), "binding");
    requireProgress(privatePaths([destination]), "binding");
    db.prepare("VACUUM INTO ?").run(destination);
    const stat = lstatSync3(destination);
    requireProgress(stat.isFile() && !stat.isSymbolicLink() && privatePaths([parent, destination]), "binding");
    if (windows)
      requireProgress(sameWindowsObject(windowsPaths([destination])[0], destination), "binding");
    copy = new DatabaseSync(destination, { readOnly: true });
    requireProgress(copy.prepare("PRAGMA integrity_check").get()?.integrity_check === "ok" && copy.prepare("PRAGMA foreign_key_check").all().length === 0, "corrupt");
    requireProgress(copy.prepare("PRAGMA user_version").get()?.user_version === 2 && copy.prepare("SELECT store_id FROM meta").get()?.store_id === db.prepare("SELECT store_id FROM meta").get()?.store_id, "corrupt");
  } catch (e) {
    copy?.close();
    copy = undefined;
    unlinkSync(destination);
    throw e;
  } finally {
    copy?.close();
  }
}
function mutateCleanup(db, file, action, value, transaction) {
  const r = parseCleanup(action, value);
  const initial = transaction(false, () => {
    const installed = cleanupInstalled(db);
    return { installed, replay: preflight(db, action, r, installed) };
  });
  if (initial.replay)
    return initial.replay;
  if (!initial.installed)
    backup(db, file);
  return transaction(true, () => {
    const installed = cleanupInstalled(db);
    const replay = preflight(db, action, r, installed);
    if (replay)
      return replay;
    if (!installed) {
      for (const sql of Object.values(definitions))
        db.exec(sql);
      db.exec("INSERT INTO cleanup_format VALUES(1,1)");
    }
    const receipt = { storeId: r.storeId, source: r.source, plan: r.plan, cleanup: { state: action === "archive" ? "archived" : action === "restore" ? "visible" : "deleted", revision: r.cleanupRev + 1 }, oid: r.oid };
    db.prepare("INSERT INTO cleanup_state VALUES(?,?,?,?,?,?,?) ON CONFLICT(source,plan) DO UPDATE SET state=excluded.state,generation=excluded.generation,oid=excluded.oid,request_hash=excluded.request_hash,receipt=excluded.receipt").run(r.source, r.plan, receipt.cleanup.state, receipt.cleanup.revision, r.oid, requestHash(action, r), JSON.stringify(receipt));
    if (action === "delete")
      for (const table of ["contributions", "revisions", "captures", "chunks", "receipts", "plans"])
        db.prepare(`DELETE FROM ${table} WHERE source=? AND ${table === "plans" ? "id" : "plan"}=?`).run(r.source, r.plan);
    return receipt;
  });
}

// shared/subagent-runs.ts
var RUN_LIMITS = Object.freeze({ parent: 1024, total: 16384, candidates: 256, candidateAdoptionMs: 300000, jobs: 64, claims: 256, intents: 128, page: 50, dtoBytes: 4096, responseBytes: 262144, queryBytes: 16384, cursorBytes: 4096, traversal: 2000, depth: 32, calls: 64, elapsedMs: 1e4 });
var definitions2 = {
  runs_format: "CREATE TABLE runs_format(singleton INTEGER PRIMARY KEY CHECK(singleton=1), version INTEGER NOT NULL CHECK(version=1), revision INTEGER NOT NULL, generation INTEGER NOT NULL, loss INTEGER NOT NULL CHECK(loss IN(0,1)))",
  runs_rows: "CREATE TABLE runs_rows(id TEXT PRIMARY KEY, source TEXT NOT NULL, parent TEXT NOT NULL, child TEXT, message TEXT, call TEXT, generation INTEGER NOT NULL, terminal INTEGER NOT NULL CHECK(terminal IN(0,1)), at INTEGER NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload) AND length(CAST(payload AS BLOB))<=4096), UNIQUE(source,parent,message,call))",
  runs_parent: "CREATE INDEX runs_parent ON runs_rows(source,parent,at)",
  runs_child: "CREATE INDEX runs_child ON runs_rows(source,child,at)",
  runs_candidates: "CREATE TABLE runs_candidates(source TEXT NOT NULL, child TEXT NOT NULL, generation INTEGER NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload) AND length(CAST(payload AS BLOB))<=4096), PRIMARY KEY(source,child))",
  runs_jobs: "CREATE TABLE runs_jobs(source TEXT NOT NULL, root TEXT NOT NULL, request_id TEXT NOT NULL, generation INTEGER NOT NULL, state TEXT NOT NULL CHECK(state IN('pending','running','complete','partial','failed')), claim TEXT, token TEXT, reason TEXT, PRIMARY KEY(source,root))",
  runs_intents: "CREATE TABLE runs_intents(source TEXT NOT NULL, parent TEXT NOT NULL, plan TEXT NOT NULL, oid TEXT NOT NULL, generation INTEGER NOT NULL, dispatch TEXT, payload TEXT NOT NULL CHECK(json_valid(payload) AND length(CAST(payload AS BLOB))<=16384), PRIMARY KEY(source,parent))",
  runs_claims: "CREATE TABLE runs_claims(source TEXT NOT NULL, child TEXT NOT NULL, execution INTEGER NOT NULL, oid TEXT NOT NULL, hash TEXT NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload) AND length(CAST(payload AS BLOB))<=2048), PRIMARY KEY(source,child,execution), UNIQUE(source,child,oid))",
  runs_retired: "CREATE TABLE runs_retired(source TEXT NOT NULL, child TEXT NOT NULL, execution INTEGER NOT NULL, oid TEXT NOT NULL, hash TEXT NOT NULL, PRIMARY KEY(source,child,oid))",
  runs_recovery_work: "CREATE TABLE runs_recovery_work(source TEXT NOT NULL, root TEXT NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload) AND length(CAST(payload AS BLOB))<=4194304), PRIMARY KEY(source,root))",
  runs_recovery_lease: "CREATE TABLE runs_recovery_lease(source TEXT NOT NULL, location TEXT NOT NULL, producer TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY(source,location))",
  runs_capture_epoch: `CREATE TRIGGER runs_capture_epoch AFTER UPDATE OF enabled ON meta WHEN NEW.enabled != OLD.enabled BEGIN UPDATE runs_format SET generation=generation+1,revision=revision+1 WHERE singleton=1; UPDATE runs_jobs SET state='failed',claim=NULL,token=lower(hex(randomblob(16))),reason='capture-disabled' WHERE state IN('pending','running'); DELETE FROM runs_candidates; UPDATE receipts SET receipt=json_set(receipt,'$.delegation.state','retired','$.delegation.reason','capture-disabled') WHERE EXISTS(SELECT 1 FROM runs_intents i WHERE i.source=receipts.source AND i.plan=receipts.plan AND i.oid=receipts.oid); DELETE FROM runs_intents; END`,
  runs_plan_delete: "CREATE TRIGGER runs_plan_delete AFTER DELETE ON plans BEGIN UPDATE runs_rows SET payload=json_set(payload,'$.planContext',json('null'),'$.accepted',json('null')) WHERE source=OLD.source AND (json_extract(payload,'$.planContext.plan')=OLD.id OR json_extract(payload,'$.accepted.plan')=OLD.id); UPDATE runs_format SET revision=revision+1 WHERE singleton=1; END",
  runs_intent_delete: "CREATE TRIGGER runs_intent_delete BEFORE DELETE ON plans BEGIN DELETE FROM runs_intents WHERE source=OLD.source AND plan=OLD.id; END",
  runs_intent_close: "CREATE TRIGGER runs_intent_close AFTER UPDATE ON plans WHEN json_extract(NEW.snapshot,'$.lifecycle')!='active' BEGIN UPDATE receipts SET receipt=json_set(receipt,'$.delegation.state','retired','$.delegation.reason','closed') WHERE source=NEW.source AND plan=NEW.id AND oid IN(SELECT oid FROM runs_intents WHERE source=NEW.source AND plan=NEW.id); DELETE FROM runs_intents WHERE source=NEW.source AND plan=NEW.id; END",
  runs_progress_change: "CREATE TRIGGER runs_progress_change AFTER UPDATE ON plans BEGIN UPDATE runs_format SET revision=revision+1 WHERE singleton=1; END"
};
var normalized2 = (s) => s.trim().replace(/\s+/g, " ");
var integer = (v) => Number.isSafeInteger(v) && Number(v) >= 0;
var obj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
function runsInstalled(db) {
  const rows = db.prepare("SELECT name,sql FROM sqlite_master WHERE name GLOB 'runs_*'").all();
  if (!rows.length)
    return false;
  requireProgress(rows.length === Object.keys(definitions2).length, "schema");
  for (const r of rows)
    requireProgress(typeof r.name === "string" && definitions2[r.name] !== undefined && normalized2(String(r.sql)) === normalized2(definitions2[r.name]), "schema");
  const f = db.prepare("SELECT * FROM runs_format").all();
  requireProgress(f.length === 1 && f[0].singleton === 1 && f[0].version === 1 && integer(f[0].revision) && integer(f[0].generation) && [0, 1].includes(Number(f[0].loss)), "schema");
  return true;
}
function installRuns(db) {
  if (runsInstalled(db))
    return;
  for (const sql of Object.values(definitions2))
    db.exec(sql);
  db.exec("INSERT INTO runs_format VALUES(1,1,0,0,0)");
}
function runControl(db) {
  requireProgress(runsInstalled(db), "schema");
  const r = db.prepare("SELECT enabled,generation FROM meta JOIN runs_format USING(singleton)").get();
  return { enabled: r.enabled === 1, generation: Number(r.generation) };
}
function bump(db) {
  db.exec("UPDATE runs_format SET revision=revision+1 WHERE singleton=1");
}
function loss(db) {
  db.exec("UPDATE runs_format SET loss=1,revision=revision+1 WHERE singleton=1");
}
function runCaptureUnavailable(db) {
  if (runsInstalled(db))
    loss(db);
}
function claimValue(value) {
  requireProgress(obj(value) && Object.keys(value).length === 6 && Object.keys(value).every((k) => ["oid", "outcome", "summary", "reportedAt", "sessionId", "association"].includes(k)) && identifier(value.oid) && identifier(value.sessionId) && ["done", "partial", "blocked"].includes(value.outcome) && typeof value.summary === "string" && value.summary.trim().length > 0 && value.summary.length <= 200 && !/[\u0000\r\n\u2028\u2029]/.test(value.summary) && integer(value.reportedAt) && ["execution", "session-only"].includes(value.association), "corrupt");
  return { oid: value.oid, outcome: value.outcome, summary: value.summary, reportedAt: value.reportedAt, sessionId: value.sessionId, association: value.association };
}
function startEvent(value) {
  requireProgress(Array.isArray(value) && value.length === 2 && identifier(value[0]) && integer(value[1]), "corrupt");
  return value;
}
function claimFence(value) {
  requireProgress(Array.isArray(value) && value.length === 2 && identifier(value[0]) && typeof value[1] === "string" && /^[a-f0-9]{64}$/.test(value[1]), "corrupt");
  return value;
}
function row(value) {
  requireProgress(typeof value === "string" && Buffer.byteLength(value) <= RUN_LIMITS.dtoBytes, "corrupt");
  let r;
  try {
    r = JSON.parse(value);
  } catch {
    requireProgress(false, "corrupt");
  }
  requireProgress(obj(r) && identifier(r.id) && identifier(r.source) && identifier(r.parentSessionId) && (r.childSessionId === null || identifier(r.childSessionId)) && obj(r.ran) && ["unknown", "running", "succeeded", "failed", "interrupted"].includes(r.ran.state), "corrupt");
  if (Object.hasOwn(r, "_retiredClaim")) {
    requireProgress(r.childSessionId !== null, "corrupt");
    claimFence(r._retiredClaim);
    delete r._retiredClaim;
  }
  if (Object.hasOwn(r, "_startEvent")) {
    requireProgress(r.childSessionId !== null && r.ran.startedAt !== null, "corrupt");
    startEvent(r._startEvent);
    delete r._startEvent;
  }
  const keys = (v, allowed) => obj(v) && Object.keys(v).length === allowed.length && Object.keys(v).every((k) => allowed.includes(k));
  const time = (v) => v === null || integer(v);
  requireProgress(keys(r, ["id", "kind", "source", "parentSessionId", "childSessionId", "tool", "agent", "description", "dispatch", "planContext", "ran", "claimed", "accepted"]) && ["dispatch", "historical-session"].includes(r.kind) && [null, "subagent", "task"].includes(r.tool) && (r.agent === null || typeof r.agent === "string" && r.agent.length <= 80) && (r.description === null || typeof r.description === "string" && r.description.length <= 200), "corrupt");
  requireProgress(r.dispatch === null || keys(r.dispatch, ["messageId", "callId", "at"]) && identifier(r.dispatch.messageId) && identifier(r.dispatch.callId) && integer(r.dispatch.at), "corrupt");
  requireProgress(r.planContext === null || keys(r.planContext, ["plan", "revision", "observedAt"]) && identifier(r.planContext.plan) && integer(r.planContext.revision) && integer(r.planContext.observedAt), "corrupt");
  requireProgress(keys(r.ran, ["state", "dispatchState", "startedAt", "endedAt", "updatedAt", "provenance", "eventId", "sequence", "errorType", "interruptionReason"]) && ["pending", "returned", "failed-unconfirmed", "unconfirmed", "historical"].includes(r.ran.dispatchState) && ["dispatch", "native-event", "native-session"].includes(r.ran.provenance) && time(r.ran.startedAt) && time(r.ran.endedAt) && integer(r.ran.updatedAt) && (r.ran.eventId === null || identifier(r.ran.eventId)) && time(r.ran.sequence) && (r.ran.errorType === null || r.ran.errorType === safeErrorType(r.ran.errorType)) && [null, "user", "shutdown", "superseded", "inactivity", "unknown"].includes(r.ran.interruptionReason), "corrupt");
  if (r.claimed)
    claimValue(r.claimed);
  if (r.accepted)
    requireProgress(keys(r.accepted, ["plan", "revision", "items", "omittedItems"]) && identifier(r.accepted.plan) && integer(r.accepted.revision) && integer(r.accepted.omittedItems) && Array.isArray(r.accepted.items) && r.accepted.items.length <= 50 && r.accepted.items.every((i) => keys(i, ["id", "status"]) && identifier(i.id) && ["pending", "working", "blocked", "done", "skipped"].includes(i.status)), "corrupt");
  return r;
}
function save(db, r, retiredClaim, provenStart) {
  const existing = db.prepare("SELECT json_extract(payload,'$._retiredClaim') AS fence,json_extract(payload,'$._startEvent') AS start FROM runs_rows WHERE id=?").get(r.id);
  const fence = retiredClaim ?? (existing?.fence ? claimFence(JSON.parse(String(existing.fence))) : undefined);
  const start = provenStart ?? (existing?.start ? startEvent(JSON.parse(String(existing.start))) : undefined);
  const text = JSON.stringify({ ...r, ...fence ? { _retiredClaim: fence } : {}, ...start ? { _startEvent: start } : {} });
  requireProgress(Buffer.byteLength(text) <= RUN_LIMITS.dtoBytes, "invalid");
  row(text);
  db.prepare("UPDATE runs_rows SET child=?,terminal=?,payload=? WHERE id=?").run(r.childSessionId, Number(["succeeded", "failed", "interrupted"].includes(r.ran.state) || r.ran.dispatchState === "failed-unconfirmed" || r.ran.dispatchState === "unconfirmed" && r.childSessionId === null), text, r.id);
  bump(db);
}
function retainedCount(db) {
  return Number(db.prepare("SELECT (SELECT count(*) FROM runs_rows)+(SELECT count(*) FROM runs_jobs)+(SELECT count(*) FROM runs_retired)+(SELECT count(*) FROM runs_recovery_lease)+(SELECT count(*) FROM runs_claims)+(SELECT count(*) FROM runs_recovery_work) AS n").get().n);
}
function capacity(db, parent) {
  for (let attempts = 0;attempts < 4; attempts++) {
    const fullParent = parent && Number(db.prepare("SELECT count(*) AS n FROM runs_rows WHERE source=? AND parent=?").get(parent.source, parent.parent).n) >= RUN_LIMITS.parent;
    if (!fullParent && retainedCount(db) < RUN_LIMITS.total)
      return true;
    const victim = db.prepare(`SELECT id,source,child,payload FROM runs_rows WHERE terminal=1 AND NOT EXISTS(SELECT 1 FROM runs_intents i WHERE i.dispatch=runs_rows.id)
      AND (child IS NULL OR NOT EXISTS(SELECT 1 FROM runs_rows d WHERE d.source=runs_rows.source AND d.parent=runs_rows.child)
        OR EXISTS(SELECT 1 FROM runs_rows edge WHERE edge.source=runs_rows.source AND edge.parent=runs_rows.parent AND edge.child=runs_rows.child AND edge.id!=runs_rows.id))
      ${fullParent ? "AND source=? AND parent=?" : ""} ORDER BY at,id LIMIT 1`).get(...fullParent ? [parent.source, parent.parent] : []);
    if (!victim) {
      loss(db);
      return false;
    }
    const r = row(victim.payload);
    const dropped = JSON.parse(String(victim.payload))._retiredClaim;
    if ((r.claimed || dropped) && r.childSessionId) {
      const fences = new Map(dropped ? [dropped] : []);
      if (r.claimed)
        fences.set(r.claimed.oid, hash([r.claimed.outcome, r.claimed.summary]));
      if (retainedCount(db) + fences.size - 1 > RUN_LIMITS.total) {
        loss(db);
        return false;
      }
      for (const [oid, digest] of fences)
        db.prepare("INSERT INTO runs_retired VALUES(?,?,?,?,?) ON CONFLICT(source,child,oid) DO UPDATE SET execution=max(execution,excluded.execution)").run(r.source, r.childSessionId, r.ran.sequence ?? 0, oid, digest);
    }
    db.prepare("DELETE FROM runs_rows WHERE id=?").run(victim.id);
    loss(db);
  }
  return false;
}
function metadataString(v, max) {
  return typeof v === "string" ? v.replace(/[\u0000\r\n\t\u2028\u2029]/g, " ").slice(0, max) || null : null;
}
function safeErrorType(v) {
  return typeof v === "string" && /^[A-Za-z0-9_.:-]{1,80}$/.test(v) ? v : "unknown";
}
function hash(v) {
  return createHash2("sha256").update(JSON.stringify(v)).digest("hex");
}
function keyId(k) {
  return hash([k.source, k.parent, k.message, k.call]);
}
function validKey(k) {
  requireProgress([k.source, k.parent, k.message, k.call].every(identifier));
}
function captureIdentity(db, actor) {
  if (db.prepare("SELECT 1 FROM sessions WHERE source=? AND id=?").get(actor.sourceId, actor.sessionId))
    return;
  const participant = db.prepare(`SELECT 1 FROM plans WHERE source=? AND (json_extract(snapshot,'$.sessionId')=?
    OR EXISTS(SELECT 1 FROM json_each(snapshot,'$.links') l WHERE json_extract(l.value,'$.sessionId')=?))
    UNION ALL SELECT 1 FROM contributions WHERE source=? AND json_extract(payload,'$.attributedSessionId')=? LIMIT 1`).get(actor.sourceId, actor.sessionId, actor.sessionId, actor.sourceId, actor.sessionId);
  if (!participant)
    db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(actor.sourceId, actor.sessionId, JSON.stringify(actor));
}
function activeIntent(db, source, parent) {
  const r = db.prepare("SELECT dispatch,CASE WHEN length(CAST(payload AS BLOB))<=16384 THEN payload END AS payload FROM runs_intents WHERE source=? AND parent=?").get(source, parent);
  if (!r)
    return null;
  requireProgress(typeof r.payload === "string", "corrupt");
  return { ...JSON.parse(r.payload), dispatch: r.dispatch };
}
function intentDisposition(db, i, state, reason, dispatch, receipt) {
  const reply = { plan: i.request.plan, rev: i.request.rev, delegation: { state, memoryOnly: false, lostOnRestart: false, requires: "supported-next-delegation", ...dispatch ? { dispatchId: dispatch } : {}, ...reason ? { reason } : {}, ...receipt ? { receipt } : {} } };
  db.prepare("UPDATE receipts SET receipt=? WHERE source=? AND plan=? AND oid=?").run(JSON.stringify(reply), i.caller.sourceId, i.request.plan, i.request.oid);
  return reply;
}
function declareIntent(db, r, actor, validate) {
  const c = runControl(db);
  requireProgress(c.enabled, "disabled");
  const payloadHash = hash([r, actor.sourceId, actor.sessionId]);
  const old = db.prepare("SELECT payload_hash,receipt FROM receipts WHERE source=? AND plan=? AND oid=?").get(actor.sourceId, r.plan, r.oid);
  if (old) {
    requireProgress(old.payload_hash === payloadHash, "operation-reused");
    return JSON.parse(String(old.receipt));
  }
  validate();
  const current = activeIntent(db, actor.sourceId, actor.sessionId);
  if (r.assign.length)
    requireProgress(!current, "conflict");
  else if (current) {
    intentDisposition(db, current, "retired", "cancelled", current.dispatch ?? undefined);
    db.prepare("DELETE FROM runs_intents WHERE source=? AND parent=?").run(actor.sourceId, actor.sessionId);
  }
  requireProgress(!r.assign.length || Number(db.prepare("SELECT count(*) AS n FROM runs_intents").get().n) < RUN_LIMITS.intents, "busy");
  const i = { request: r, caller: { sourceId: actor.sourceId, sessionId: actor.sessionId }, generation: c.generation, bindOid: `binding-${randomUUID2()}`, dispatch: null };
  db.prepare("INSERT INTO receipts VALUES(?,?,?,?,?)").run(actor.sourceId, r.plan, r.oid, payloadHash, "{}");
  if (r.assign.length)
    db.prepare("INSERT INTO runs_intents VALUES(?,?,?,?,?,NULL,?)").run(actor.sourceId, actor.sessionId, r.plan, r.oid, c.generation, JSON.stringify(i));
  return intentDisposition(db, i, r.assign.length ? "pending" : "retired", r.assign.length ? undefined : "cancelled");
}
function reservedIntent(db, k) {
  const i = activeIntent(db, k.source, k.parent);
  return i?.dispatch === keyId(k) ? i : null;
}
function settleIntent(db, i, receipt, reason) {
  intentDisposition(db, i, receipt ? "bound" : "retired", reason, i.dispatch ?? undefined, receipt);
  db.prepare("DELETE FROM runs_intents WHERE source=? AND parent=? AND dispatch=?").run(i.caller.sourceId, i.caller.sessionId, i.dispatch);
}
function claimHash(r) {
  return hash([r.outcome, r.summary]);
}
function claimFits(db, r, claim, start = provenStart(db, r)) {
  if (!start || claim.reportedAt < start.at || r.ran.endedAt !== null && claim.reportedAt > r.ran.endedAt)
    return false;
  const next = nextStart(db, start);
  return !next || next.at >= start.at && claim.reportedAt < next.at;
}
function claimOwners(db, source, child, claim) {
  return db.prepare(`SELECT payload FROM runs_rows WHERE source=? AND child=? AND message IS NOT NULL
    AND json_extract(payload,'$.ran.startedAt')<=? AND (json_extract(payload,'$.ran.endedAt') IS NULL OR json_extract(payload,'$.ran.endedAt')>=?)
    ORDER BY coalesce(json_extract(payload,'$._startEvent[1]'),CASE WHEN json_extract(payload,'$.ran.state')='running' THEN json_extract(payload,'$.ran.sequence') END) DESC LIMIT 2`).all(source, child, claim.reportedAt, claim.reportedAt).map((v) => row(v.payload)).filter((r) => claimFits(db, r, claim));
}
function attachClaim(db, r) {
  if (!r.childSessionId || r.ran.startedAt === null || r.claimed)
    return;
  const claims = db.prepare("SELECT * FROM runs_claims WHERE source=? AND child=? LIMIT 2").all(r.source, r.childSessionId);
  const matching = claims.filter((c) => claimFits(db, r, claimValue(JSON.parse(String(c.payload)))) && (Number(c.execution) === 0 || Number(c.execution) <= Number(r.ran.sequence)));
  if (matching.length !== 1)
    return;
  const claim = claimValue(JSON.parse(String(matching[0].payload))), owners = claimOwners(db, r.source, r.childSessionId, claim);
  if (owners.length !== 1 || owners[0].id !== r.id)
    return;
  r.claimed = { ...claim, association: "execution" };
  save(db, r);
  db.prepare("DELETE FROM runs_claims WHERE source=? AND child=? AND execution=?").run(r.source, r.childSessionId, matching[0].execution);
}
function reassociateClaims(db, source, child) {
  for (const staged of db.prepare("SELECT payload FROM runs_claims WHERE source=? AND child=? LIMIT ?").all(source, child, RUN_LIMITS.claims)) {
    const claim = claimValue(JSON.parse(String(staged.payload)));
    const owners = claimOwners(db, source, child, claim);
    if (owners.length === 1)
      attachClaim(db, owners[0]);
  }
}
function handoff(db, r, actor, now) {
  requireProgress(runControl(db).enabled, "disabled");
  requireProgress(actor.verifiedSource && identifier(actor.parentId) && actor.ancestry?.[0] === actor.parentId && actor.ancestry.length <= 32, "assignment");
  requireProgress(db.prepare("SELECT verified FROM sources WHERE id=?").get(actor.sourceId)?.verified === 1, "source-unverified");
  const existing = db.prepare("SELECT payload FROM runs_rows WHERE source=? AND child=? AND json_extract(payload,'$.claimed.oid')=? LIMIT 1").get(actor.sourceId, actor.sessionId, r.oid);
  if (existing) {
    const claim2 = row(existing.payload).claimed;
    requireProgress(hash([claim2.outcome, claim2.summary]) === claimHash(r), "operation-reused");
    return { handoff: claim2 };
  }
  const oldClaim = db.prepare("SELECT hash FROM runs_retired WHERE source=? AND child=? AND oid=?").get(actor.sourceId, actor.sessionId, r.oid) ?? db.prepare("SELECT json_extract(payload,'$._retiredClaim[1]') AS hash FROM runs_rows WHERE source=? AND child=? AND json_extract(payload,'$._retiredClaim[0]')=? LIMIT 1").get(actor.sourceId, actor.sessionId, r.oid);
  if (oldClaim) {
    requireProgress(oldClaim.hash === claimHash(r), "operation-reused");
    requireProgress(false, "not-found");
  }
  const retired = db.prepare("SELECT max(execution) AS execution FROM runs_retired WHERE source=? AND child=?").get(actor.sourceId, actor.sessionId);
  const c = candidate(db, actor.sourceId, actor.sessionId);
  const retained = db.prepare("SELECT json_extract(payload,'$.ran.sequence') AS seq,json_extract(payload,'$.ran.startedAt') AS started_at FROM runs_rows WHERE source=? AND child=? AND json_extract(payload,'$.ran.state')='running' ORDER BY at DESC LIMIT 1").get(actor.sourceId, actor.sessionId);
  const execution = c?.start?.sequence ?? Number(retained?.seq ?? 0);
  const staged = db.prepare("SELECT oid,hash,payload FROM runs_claims WHERE source=? AND child=? AND (execution=? OR oid=?) LIMIT 1").get(actor.sourceId, actor.sessionId, execution, r.oid);
  if (staged) {
    requireProgress(staged.oid === r.oid, "conflict");
    requireProgress(staged.hash === claimHash(r), "operation-reused");
    return { handoff: claimValue(JSON.parse(String(staged.payload))) };
  }
  const runs = db.prepare("SELECT payload FROM runs_rows WHERE source=? AND child=? ORDER BY at DESC LIMIT 2").all(actor.sourceId, actor.sessionId).map((v) => row(v.payload));
  const current = claimOwners(db, actor.sourceId, actor.sessionId, { oid: r.oid, outcome: r.outcome, summary: r.summary, reportedAt: now, sessionId: actor.sessionId, association: "session-only" });
  const currentStart = c?.start?.at ?? retained?.started_at ?? runs.find((v) => v.ran.startedAt !== null)?.ran.startedAt;
  if (current.some((v) => v.claimed) || runs.some((v) => v.claimed && currentStart === v.ran.startedAt))
    requireProgress(false, "conflict");
  if (retired?.execution !== null && retired?.execution !== undefined && execution <= Number(retired.execution))
    requireProgress(false, "not-found");
  requireProgress(Number(db.prepare("SELECT count(*) AS n FROM runs_claims").get().n) < RUN_LIMITS.claims && capacity(db), "busy");
  const claim = { oid: r.oid, outcome: r.outcome, summary: r.summary, reportedAt: now, sessionId: actor.sessionId, association: "session-only" };
  db.prepare("INSERT INTO runs_claims VALUES(?,?,?,?,?,?)").run(actor.sourceId, actor.sessionId, execution, r.oid, claimHash(r), JSON.stringify(claim));
  if (current.length === 1) {
    attachClaim(db, current[0]);
    if (current[0].claimed)
      return { handoff: current[0].claimed };
  }
  bump(db);
  return { handoff: claim };
}
function associatedPlan(db, actor, at) {
  const p = db.prepare(`SELECT id,revision FROM plans WHERE source=? AND json_extract(snapshot,'$.lifecycle')='active' AND
    (json_extract(snapshot,'$.sessionId')=? OR EXISTS(SELECT 1 FROM json_each(snapshot,'$.links') l WHERE json_extract(l.value,'$.sessionId')=? AND json_array_length(json_extract(l.value,'$.itemIds'))>0)) LIMIT 3`).all(actor.sourceId, actor.sessionId, actor.sessionId);
  const eligible = p.filter((r) => !cleanupInstalled(db) || !["archived", "deleted"].includes(String(cleanupState(db, actor.sourceId, String(r.id))?.state)));
  if (p.length >= 3)
    return null;
  const incoming = db.prepare(`SELECT json_extract(payload,'$.planContext.plan') AS plan FROM runs_rows r WHERE source=? AND child=? AND terminal=0 AND json_extract(payload,'$.ran.state')='running' AND json_extract(payload,'$.planContext.plan') IS NOT NULL
    AND (SELECT loss FROM runs_format)=0 AND NOT EXISTS(SELECT 1 FROM runs_candidates c WHERE c.source=r.source AND c.child=r.child AND json_extract(c.payload,'$.start.at')!=json_extract(r.payload,'$.ran.startedAt')) LIMIT 2`).all(actor.sourceId, actor.sessionId);
  if (incoming.length === 1) {
    const plan = db.prepare("SELECT id,revision FROM plans WHERE source=? AND id=? AND json_extract(snapshot,'$.lifecycle')='active'").get(actor.sourceId, String(incoming[0].plan));
    if (plan && (!cleanupInstalled(db) || !["archived", "deleted"].includes(String(cleanupState(db, actor.sourceId, String(plan.id))?.state))))
      eligible.push(plan);
  }
  const unique = new Map(eligible.map((r) => [String(r.id), r]));
  const only = [...unique.values()][0];
  return unique.size === 1 ? { plan: String(only.id), revision: Number(only.revision), observedAt: at } : null;
}
function beforeRun(db, k, actor, tool, input, at) {
  validKey(k);
  requireProgress(integer(at));
  const control = runControl(db);
  if (!control.enabled)
    return;
  requireProgress(actor.verifiedSource && actor.sourceId === k.source && actor.sessionId === k.parent && actor.ancestry !== null, "binding");
  requireProgress(db.prepare("SELECT verified FROM sources WHERE id=?").get(k.source)?.verified === 1, "binding");
  const id = keyId(k);
  if (db.prepare("SELECT 1 FROM runs_rows WHERE id=?").get(id))
    return;
  if (!capacity(db, k))
    return;
  const i = obj(input) ? input : {};
  const intent = tool === "subagent" ? activeIntent(db, k.source, k.parent) : null;
  const r = { id, kind: "dispatch", source: k.source, parentSessionId: k.parent, childSessionId: null, tool, agent: metadataString(i.agent, 80), description: metadataString(i.description ?? i.title, 200), dispatch: { messageId: k.message, callId: k.call, at }, planContext: intent && !intent.dispatch ? { plan: intent.request.plan, revision: intent.request.rev, observedAt: at } : associatedPlan(db, actor, at), ran: { state: "unknown", dispatchState: "pending", startedAt: null, endedAt: null, updatedAt: at, provenance: "dispatch", eventId: null, sequence: null, errorType: null, interruptionReason: null }, claimed: null, accepted: null };
  db.prepare("INSERT INTO runs_rows VALUES(?,?,?,?,?,?,?,?,?,?)").run(id, k.source, k.parent, null, k.message, k.call, control.generation, 0, at, JSON.stringify(r));
  if (intent && !intent.dispatch) {
    db.prepare("UPDATE runs_intents SET dispatch=? WHERE source=? AND parent=? AND dispatch IS NULL").run(id, k.source, k.parent);
    intentDisposition(db, intent, "reserved", undefined, id);
  }
  captureIdentity(db, actor);
  bump(db);
}
function candidate(db, source, child) {
  const r = db.prepare("SELECT CASE WHEN length(CAST(payload AS BLOB))<=4096 THEN payload END AS payload FROM runs_candidates WHERE source=? AND child=?").get(source, child);
  if (!r)
    return null;
  requireProgress(typeof r.payload === "string", "corrupt");
  return JSON.parse(r.payload);
}
var verifiedRootIdentity = `json_extract(s.actor,'$.verifiedSource')=1
  AND json_extract(s.actor,'$.sourceId')=s.source AND json_extract(s.actor,'$.sessionId')=s.id
  AND json_type(s.actor,'$.parentId')='null' AND json_type(s.actor,'$.ancestry')='array'
  AND json_array_length(s.actor,'$.ancestry')=0`;
function adopt(db, r, c) {
  if (!r.dispatch || !r.childSessionId || !c.start || c.ambiguous || c.start.at < r.dispatch.at)
    return false;
  if (r.ran.startedAt !== null && r.ran.startedAt !== c.start.at)
    return false;
  if (r.ran.startedAt === null) {
    if (db.prepare("SELECT 1 FROM runs_rows WHERE source=? AND parent=? AND id!=? AND child IS NULL AND json_extract(payload,'$.tool')='subagent' AND json_extract(payload,'$.ran.dispatchState')='pending' AND at<=? LIMIT 1").get(r.source, r.parentSessionId, r.id, c.start.at))
      return false;
    if (db.prepare(`SELECT 1 FROM (SELECT terminal,at,json_extract(payload,'$.ran.startedAt') AS started,
      coalesce(json_extract(payload,'$._startEvent[1]'),CASE WHEN json_extract(payload,'$.ran.state')='running' THEN json_extract(payload,'$.ran.sequence') END) AS sequence
      FROM runs_rows WHERE source=? AND child=? AND message IS NOT NULL AND id!=?)
      WHERE (terminal=0 AND started IS NULL AND at<=?) OR sequence=? OR (sequence>? AND started<?) OR (sequence<? AND started>?) LIMIT 1`).get(r.source, r.childSessionId, r.id, c.start.at, c.start.sequence, c.start.sequence, c.start.at, c.start.sequence, c.start.at))
      return false;
  }
  const e = c.end && c.end.sequence > c.start.sequence && c.end.at >= c.start.at ? c.end : c.start;
  if (r.ran.endedAt !== null) {
    if (e === c.start || e.sequence >= Number(r.ran.sequence))
      return false;
  } else if (r.ran.sequence !== null && e.sequence <= r.ran.sequence) {
    attachClaim(db, r);
    return false;
  }
  recomputeInterval(db, r, c.start, e === c.start ? null : e);
  return true;
}
function recomputeInterval(db, r, start, end) {
  const next = nextStart(db, start);
  const wrongOwner = end && (end.sequence <= start.sequence || next && end.sequence >= next.sequence);
  const badClock = next && next.at < start.at || end && (end.at < start.at || !wrongOwner && next && end.at > next.at);
  if (badClock)
    loss(db);
  const displaced = end && (wrongOwner || badClock) ? end : null;
  if (displaced)
    end = null;
  const e = end ?? start;
  r.ran = { ...r.ran, state: e.state, startedAt: start.at, endedAt: end?.at ?? null, updatedAt: e.at, provenance: "native-event", eventId: e.id, sequence: e.sequence, errorType: e.errorType, interruptionReason: e.interruptionReason };
  let retiredClaim;
  let restaged = false;
  if (r.claimed && !claimFits(db, r, r.claimed, start)) {
    const claim = { ...r.claimed, association: "session-only" };
    const room = Number(db.prepare("SELECT count(*) AS n FROM runs_claims").get().n) < RUN_LIMITS.claims && retainedCount(db) < RUN_LIMITS.total;
    restaged = room && Boolean(db.prepare("INSERT INTO runs_claims VALUES(?,?,?,?,?,?) ON CONFLICT DO NOTHING").run(r.source, r.childSessionId, 0, claim.oid, hash([claim.outcome, claim.summary]), JSON.stringify(claim)).changes);
    if (!restaged) {
      retiredClaim = [claim.oid, hash([claim.outcome, claim.summary])];
      loss(db);
    }
    r.claimed = null;
  }
  save(db, r, retiredClaim, [start.id, start.sequence]);
  attachClaim(db, r);
  if (restaged)
    reassociateClaims(db, r.source, start.child);
  return displaced;
}
function provenStart(db, r) {
  const stored = db.prepare("SELECT json_extract(payload,'$._startEvent') AS start FROM runs_rows WHERE id=?").get(r.id);
  const proof = stored?.start ? startEvent(JSON.parse(String(stored.start))) : r.ran.state === "running" && r.ran.eventId && r.ran.sequence !== null ? [r.ran.eventId, r.ran.sequence] : null;
  return proof && r.childSessionId && r.ran.startedAt !== null ? { source: r.source, child: r.childSessionId, id: proof[0], sequence: proof[1], at: r.ran.startedAt, state: "running", errorType: null, interruptionReason: null } : null;
}
function provenEnd(r) {
  return r.childSessionId && r.ran.endedAt !== null && r.ran.eventId && r.ran.sequence !== null && ["succeeded", "failed", "interrupted"].includes(r.ran.state) ? { source: r.source, child: r.childSessionId, id: r.ran.eventId, sequence: r.ran.sequence, at: r.ran.endedAt, state: r.ran.state, errorType: r.ran.errorType, interruptionReason: r.ran.interruptionReason } : null;
}
function nextStart(db, start) {
  const stored = db.prepare(`SELECT payload,coalesce(json_extract(payload,'$._startEvent[1]'),CASE WHEN json_extract(payload,'$.ran.state')='running' THEN json_extract(payload,'$.ran.sequence') END) AS sequence
    FROM runs_rows WHERE source=? AND child=? AND message IS NOT NULL AND sequence>? ORDER BY sequence LIMIT 1`).get(start.source, start.child, start.sequence);
  const known = stored ? provenStart(db, row(stored.payload)) : null, pending = candidate(db, start.source, start.child)?.start;
  return pending && pending.sequence > start.sequence && (!known || pending.sequence < known.sequence) ? pending : known;
}
function routeTerminal(db, e) {
  const rows = db.prepare(`SELECT payload,coalesce(json_extract(payload,'$._startEvent[1]'),CASE WHEN json_extract(payload,'$.ran.state')='running' THEN json_extract(payload,'$.ran.sequence') END) AS sequence
    FROM runs_rows WHERE source=? AND child=? AND message IS NOT NULL AND sequence<? ORDER BY sequence DESC LIMIT 2`).all(e.source, e.child, e.sequence);
  const r = rows[0] && row(rows[0].payload), start = r && provenStart(db, r);
  if (!r || !start)
    return { handled: false };
  if (rows[1]?.sequence === start.sequence) {
    loss(db);
    return { handled: false };
  }
  const pending = candidate(db, e.source, e.child)?.start;
  if (pending && pending.sequence > start.sequence && pending.sequence < e.sequence) {
    if (pending.at > e.at)
      loss(db);
    return { handled: false };
  }
  const next = nextStart(db, start);
  if (next && next.sequence <= e.sequence) {
    loss(db);
    return { handled: false };
  }
  if (e.at < start.at || next && (next.at < start.at || e.at > next.at)) {
    loss(db);
    return { handled: false };
  }
  const prior = provenEnd(r);
  if (prior?.sequence === e.sequence)
    return { handled: true };
  if (prior && prior.sequence < e.sequence)
    return { handled: false };
  return adopt(db, r, { start, end: e }) ? { handled: true, ...prior ? { displaced: prior } : {} } : { handled: false };
}
function correlate(db, source, child) {
  const c = candidate(db, source, child);
  if (!c)
    return;
  if (c.start && !c.ambiguous) {
    const owners = db.prepare(`SELECT payload FROM runs_rows WHERE source=? AND child=? AND message IS NOT NULL AND terminal=0
      AND json_extract(payload,'$.ran.startedAt') IS NULL AND at<=? LIMIT 2`).all(source, child, c.start.at);
    if (owners.length === 1 && adopt(db, row(owners[0].payload), { start: c.start, end: null }))
      c.start = null;
  }
  while (c.end) {
    const routed = routeTerminal(db, c.end);
    if (!routed.handled)
      break;
    c.end = routed.displaced ?? null;
  }
  if (!c.start && !c.end)
    db.prepare("DELETE FROM runs_candidates WHERE source=? AND child=?").run(source, child);
  else
    db.prepare("UPDATE runs_candidates SET payload=? WHERE source=? AND child=?").run(JSON.stringify(c), source, child);
}
function afterRun(db, k, generation, child, disposition) {
  validKey(k);
  const c = runControl(db);
  if (!c.enabled || c.generation !== generation)
    return;
  const stored = db.prepare("SELECT generation,payload FROM runs_rows WHERE id=?").get(keyId(k));
  if (!stored || stored.generation !== generation)
    return;
  const r = row(stored.payload);
  if (r.ran.dispatchState !== "pending" && !(r.ran.dispatchState === "unconfirmed" && r.childSessionId === null && child)) {
    if (child && r.childSessionId !== child.sessionId)
      loss(db);
    return;
  }
  if (child) {
    const parent = db.prepare("SELECT actor FROM sessions WHERE source=? AND id=?").get(k.source, k.parent);
    requireProgress(parent && typeof parent.actor === "string", "binding");
    const actor = JSON.parse(parent.actor);
    requireProgress(r.tool === "subagent" && child.verifiedSource && child.sourceId === k.source && identifier(child.sessionId) && child.parentId === k.parent && child.ancestry?.[0] === k.parent && child.directory === actor.directory && child.projectId === actor.projectId, "binding");
    r.childSessionId = child.sessionId;
  }
  r.ran.dispatchState = disposition;
  save(db, r);
  if (child)
    captureIdentity(db, child);
  for (const other of db.prepare("SELECT DISTINCT child FROM runs_rows WHERE source=? AND parent=? AND child IS NOT NULL AND terminal=0 LIMIT 1024").all(k.source, k.parent))
    correlate(db, k.source, String(other.child));
}
function observeExecution(db, e) {
  const control = runControl(db);
  if (!control.enabled)
    return;
  requireProgress(identifier(e.source) && identifier(e.child) && identifier(e.id) && integer(e.sequence) && integer(e.at) && ["running", "succeeded", "failed", "interrupted"].includes(e.state), "invalid");
  e = { source: e.source, child: e.child, id: e.id, sequence: e.sequence, at: e.at, state: e.state, errorType: e.state === "failed" ? safeErrorType(e.errorType) : null, interruptionReason: e.state === "interrupted" && ["user", "shutdown", "superseded", "inactivity"].includes(String(e.interruptionReason)) ? e.interruptionReason : e.state === "interrupted" ? "unknown" : null };
  if (e.state === "failed" || e.state === "interrupted") {
    for (const pending of db.prepare("SELECT payload FROM runs_rows WHERE source=? AND parent=? AND child IS NULL AND at<=? AND json_extract(payload,'$.ran.dispatchState')='pending' LIMIT 1024").all(e.source, e.child, e.at)) {
      const r = row(pending.payload);
      r.ran.dispatchState = "unconfirmed";
      save(db, r);
      const i = activeIntent(db, e.source, e.child);
      if (i?.dispatch === r.id)
        settleIntent(db, i, undefined, "parent-execution-ended");
    }
  }
  if (db.prepare(`SELECT 1 FROM sessions s WHERE s.source=? AND s.id=? AND ${verifiedRootIdentity}`).get(e.source, e.child)) {
    db.prepare("DELETE FROM runs_candidates WHERE source=? AND child=?").run(e.source, e.child);
    return;
  }
  const c = candidate(db, e.source, e.child) ?? { start: null, end: null };
  let refine;
  let routed = false;
  if (e.state !== "running") {
    const result = routeTerminal(db, e);
    routed = result.handled;
    if (routed) {
      if (c.end?.sequence === e.sequence)
        c.end = null;
      if (result.displaced && (!c.end || result.displaced.sequence > c.end.sequence))
        c.end = result.displaced;
    }
  } else {
    if (db.prepare(`SELECT 1 FROM runs_rows WHERE source=? AND child=? AND message IS NOT NULL AND
      coalesce(json_extract(payload,'$._startEvent[1]'),CASE WHEN json_extract(payload,'$.ran.state')='running' THEN json_extract(payload,'$.ran.sequence') END)=? LIMIT 1`).get(e.source, e.child, e.sequence)) {
      correlate(db, e.source, e.child);
      return;
    }
    const previous = db.prepare(`SELECT payload,coalesce(json_extract(payload,'$._startEvent[1]'),CASE WHEN json_extract(payload,'$.ran.state')='running' THEN json_extract(payload,'$.ran.sequence') END) AS sequence
      FROM runs_rows WHERE source=? AND child=? AND message IS NOT NULL AND sequence<? ORDER BY sequence DESC LIMIT 2`).all(e.source, e.child, e.sequence);
    if (previous[0] && previous[1]?.sequence !== previous[0].sequence)
      refine = row(previous[0].payload);
    else if (previous.length > 1)
      loss(db);
    if (!refine && db.prepare(`SELECT 1 FROM runs_rows WHERE source=? AND child=? AND json_extract(payload,'$.ran.startedAt')>?
      AND coalesce(json_extract(payload,'$._startEvent[1]'),CASE WHEN json_extract(payload,'$.ran.state')='running' THEN json_extract(payload,'$.ran.sequence') END)>? LIMIT 1`).get(e.source, e.child, e.at, e.sequence) && !db.prepare(`SELECT 1 FROM runs_rows WHERE source=? AND terminal=0 AND at<=? AND json_extract(payload,'$.ran.startedAt') IS NULL
        AND (child=? OR (child IS NULL AND json_extract(payload,'$.tool')='subagent')) LIMIT 1`).get(e.source, e.at, e.child)) {
      correlate(db, e.source, e.child);
      return;
    }
  }
  if (!routed) {
    const latest = Math.max(c.start?.sequence ?? -1, c.end?.sequence ?? -1);
    if (e.sequence <= latest && !(e.state === "running" && !c.start && c.end && e.sequence < c.end.sequence))
      return;
    if (e.state === "running") {
      if (c.start && c.end && e.sequence > c.end.sequence) {
        c.start = e;
        c.end = null;
        c.ambiguous = false;
      } else if (!c.start)
        c.start = e;
      else {
        c.ambiguous = true;
        c.start = e;
        c.end = null;
      }
    } else
      c.end = e;
  }
  if (!c.start && !c.end) {
    db.prepare("DELETE FROM runs_candidates WHERE source=? AND child=?").run(e.source, e.child);
    return;
  }
  if (!candidate(db, e.source, e.child) && Number(db.prepare("SELECT count(*) AS n FROM runs_candidates").get().n) >= RUN_LIMITS.candidates) {
    const victim = db.prepare(`SELECT c.source,c.child,coalesce((${verifiedRootIdentity}),0) AS root,
      coalesce((c.source=? AND json_extract(c.payload,'$.end.state') IN ('succeeded','failed','interrupted')
        AND json_type(c.payload,'$.end.at')='integer' AND json_extract(c.payload,'$.end.at')<?),0) AS stale
      FROM runs_candidates c LEFT JOIN sessions s ON s.source=c.source AND s.id=c.child WHERE NOT EXISTS
      (SELECT 1 FROM runs_rows r WHERE r.source=c.source AND r.child=c.child AND r.message IS NOT NULL AND r.terminal=0)
      ORDER BY root DESC,stale DESC,c.rowid LIMIT 1`).get(e.source, e.at - RUN_LIMITS.candidateAdoptionMs);
    if (!victim) {
      loss(db);
      return;
    }
    if (!victim.root && !victim.stale)
      loss(db);
    db.prepare("DELETE FROM runs_candidates WHERE source=? AND child=?").run(victim.source, victim.child);
  }
  const project = (v) => v ? { source: e.source, child: e.child, id: v.id, sequence: v.sequence, at: v.at, state: v.state, errorType: v.state === "failed" ? safeErrorType(v.errorType) : null, interruptionReason: v.state === "interrupted" && ["user", "shutdown", "superseded", "inactivity"].includes(String(v.interruptionReason)) ? v.interruptionReason : v.state === "interrupted" ? "unknown" : null } : null;
  const safe = { start: project(c.start), end: project(c.end), ambiguous: c.ambiguous ?? false };
  db.prepare("INSERT INTO runs_candidates VALUES(?,?,?,?) ON CONFLICT(source,child) DO UPDATE SET generation=excluded.generation,payload=excluded.payload").run(e.source, e.child, control.generation, JSON.stringify(safe));
  if (refine) {
    const start = provenStart(db, refine);
    const displaced = recomputeInterval(db, refine, start, provenEnd(refine));
    if (displaced) {
      const held = candidate(db, e.source, e.child);
      if (!held.end || displaced.sequence > held.end.sequence)
        held.end = displaced;
      else if (displaced.sequence !== held.end.sequence)
        loss(db);
      db.prepare("UPDATE runs_candidates SET payload=? WHERE source=? AND child=?").run(JSON.stringify(held), e.source, e.child);
    }
  }
  correlate(db, e.source, e.child);
}
function identity(db, binding, r) {
  requireProgress(identifier(r.storeId) && identifier(r.source) && identifier(r.root));
  requireProgress(obj(r.binding) && Object.keys(r.binding).length === 2 && r.binding.sourceId === binding.sourceId && r.binding.verified === binding.verified && binding.sourceId === r.source && binding.verified, "conflict");
  const m = db.prepare("SELECT store_id,enabled FROM meta WHERE singleton=1").get();
  requireProgress(m.store_id === r.storeId, "conflict");
  requireProgress(db.prepare("SELECT verified FROM sources WHERE id=?").get(r.source)?.verified === 1, "binding");
  requireProgress(db.prepare("SELECT 1 FROM sessions WHERE source=? AND id=?").get(r.source, r.root), "not-found");
  return m;
}
function scopedParents(db, source, root) {
  const ids = new Set([root]);
  let frontier = [root], complete = true;
  for (let depth = 0;frontier.length && depth < RUN_LIMITS.depth; depth++) {
    const next = [];
    for (const parent of frontier) {
      const children = db.prepare("SELECT DISTINCT child FROM runs_rows WHERE source=? AND parent=? AND child IS NOT NULL LIMIT ?").all(source, parent, RUN_LIMITS.traversal + 1);
      for (const r of children) {
        const id = String(r.child);
        if (ids.has(id))
          continue;
        if (ids.size >= RUN_LIMITS.traversal) {
          complete = false;
          break;
        }
        ids.add(id);
        next.push(id);
      }
    }
    frontier = next;
    if (depth === RUN_LIMITS.depth - 1 && next.length)
      complete = false;
  }
  return { ids: [...ids], complete };
}
function readRuns(db, binding, r, now = Date.now()) {
  const m = identity(db, binding, r);
  requireProgress(r.view === undefined || r.view === "useful" || r.view === "history");
  requireProgress(r.plan === undefined === (r.cleanupRev === undefined));
  if (r.plan !== undefined) {
    requireProgress(identifier(r.plan) && integer(r.cleanupRev));
    const plan = db.prepare(`SELECT json_extract(snapshot,'$.sessionId') AS owner,
      EXISTS(SELECT 1 FROM json_each(snapshot,'$.links') l WHERE json_extract(l.value,'$.sessionId')=?) AS linked FROM plans WHERE source=? AND id=?`).get(r.root, r.source, r.plan);
    requireProgress(plan, "not-found");
    const incoming = runsInstalled(db) && db.prepare("SELECT 1 FROM runs_rows WHERE source=? AND child=? AND json_extract(payload,'$.planContext.plan')=? LIMIT 1").get(r.source, r.root, r.plan);
    requireProgress(plan.owner === r.root || plan.linked === 1 || incoming, "not-found");
    const state = cleanupInstalled(db) ? cleanupState(db, r.source, r.plan) : undefined;
    requireProgress((state?.generation ?? 0) === r.cleanupRev && state?.state !== "deleted", "conflict");
  }
  const installed = runsInstalled(db), f = installed ? db.prepare("SELECT revision,loss FROM runs_format").get() : undefined;
  const job = installed ? db.prepare("SELECT state,CASE WHEN length(CAST(token AS BLOB))<=80 THEN token END AS token,CASE WHEN length(CAST(reason AS BLOB))<=80 THEN reason END AS reason,length(CAST(token AS BLOB)) AS token_bytes,length(CAST(reason AS BLOB)) AS reason_bytes FROM runs_jobs WHERE source=? AND root=?").get(r.source, r.root) : undefined;
  if (job)
    requireProgress(["pending", "running", "complete", "partial", "failed"].includes(String(job.state)) && (job.token_bytes === null || Number(job.token_bytes) <= 80) && (job.reason_bytes === null || Number(job.reason_bytes) <= 80) && [null, "budget", "capture-disabled", "capture-unavailable"].includes(job.reason) && (job.token === null || identifier(job.token)), "corrupt");
  const out = { protocolVersion: 2, schemaVersion: 2, storeId: r.storeId, sourceBinding: { ...binding }, source: r.source, root: r.root, plan: r.plan ?? null, cleanupRev: r.cleanupRev ?? null, view: r.view ?? "useful", subagentRuns: installed ? 1 : null, runFormat: installed ? 1 : null, availability: installed ? "ready" : "unavailable", readAt: now, revision: Number(f?.revision ?? 0), capture: { enabled: m.enabled === 1, state: installed ? "last-known" : "unavailable", loss: f?.loss === 1 }, recovery: { state: job?.state ?? (installed ? "not-requested" : "unavailable"), reason: job?.reason ?? null, token: job?.token ?? null }, counts: { children: 0, runs: 0, historicalSessions: 0, running: 0, succeeded: 0, failed: 0, interrupted: 0, unknown: 0 }, coverage: { scope: "retained", complete: false, reasons: installed ? [] : ["legacy-unavailable"] }, data: [], nextCursor: null };
  if (!installed)
    return out;
  if (!job || job.state !== "complete")
    out.coverage.reasons.push(job && ["partial", "failed"].includes(String(job.state)) ? "partial-history" : "history-not-reconciled");
  if (f?.loss === 1)
    out.coverage.reasons.push("capture-loss");
  const scope2 = scopedParents(db, r.source, r.root);
  if (!scope2.complete)
    out.coverage.reasons.push("traversal-limit");
  const placeholders = scope2.ids.map(() => "?").join(",");
  const where = `source=? AND parent IN (${placeholders})`;
  const args = [r.source, ...scope2.ids];
  const counts = db.prepare(`SELECT count(DISTINCT child) AS children,sum(message IS NOT NULL) AS runs,sum(message IS NULL) AS history,
    sum(json_extract(payload,'$.ran.state')='running') AS running,sum(json_extract(payload,'$.ran.state')='succeeded') AS succeeded,
    sum(json_extract(payload,'$.ran.state')='failed') AS failed,sum(json_extract(payload,'$.ran.state')='interrupted') AS interrupted,sum(json_extract(payload,'$.ran.state')='unknown') AS unknown FROM runs_rows WHERE ${where}`).get(...args);
  for (const key of ["children", "runs", "running", "succeeded", "failed", "interrupted", "unknown"])
    out.counts[key] = Number(counts[key] ?? 0);
  out.counts.historicalSessions = Number(counts.history ?? 0);
  const useful = "coalesce((json_extract(payload,'$.ran.state')='running' OR (? IS NOT NULL AND (json_extract(payload,'$.planContext.plan')=? OR json_extract(payload,'$.accepted.plan')=? OR EXISTS(SELECT 1 FROM plans p,json_each(p.snapshot,'$.links') l WHERE p.source=runs_rows.source AND p.id=? AND json_extract(l.value,'$.sessionId')=runs_rows.child)))),0)";
  const selection = `${where} AND ${out.view === "history" ? "NOT " : ""}${useful}`;
  const identityKey = hash([r.storeId, binding, r.source, r.root, r.plan ?? null, r.cleanupRev ?? null, out.view]);
  let offset = 0;
  if (r.cursor) {
    requireProgress(Buffer.byteLength(r.cursor) <= RUN_LIMITS.cursorBytes && /^[A-Za-z0-9_-]+$/.test(r.cursor));
    let c;
    try {
      c = JSON.parse(Buffer.from(r.cursor, "base64url").toString("utf8"));
    } catch {
      requireProgress(false);
    }
    requireProgress(obj(c) && Object.keys(c).length === 3 && c.key === identityKey && c.revision === out.revision && integer(c.offset) && c.offset <= RUN_LIMITS.total, "conflict");
    offset = c.offset;
  }
  const rows = db.prepare(`SELECT CASE WHEN length(CAST(payload AS BLOB))<=4096 THEN payload END AS payload FROM runs_rows WHERE ${selection} ORDER BY (json_extract(payload,'$.ran.state')='running') DESC,at DESC,id LIMIT ? OFFSET ?`).all(...args, r.plan ?? null, r.plan ?? null, r.plan ?? null, r.plan ?? null, RUN_LIMITS.page + 1, offset);
  out.data = rows.slice(0, RUN_LIMITS.page).map((v) => row(v.payload));
  if (r.plan) {
    const snapshot2 = db.prepare(`SELECT CASE WHEN json_type(snapshot,'$.items')='array' AND json_array_length(snapshot,'$.items')<=1000
      AND json_type(snapshot,'$.links')='array' AND json_array_length(snapshot,'$.links')<=64 THEN
      json_object('revision',json_extract(snapshot,'$.revision'),'links',json_extract(snapshot,'$.links'),
        'items',json((SELECT json_group_array(json_object('id',json_extract(i.value,'$.id'),'kind',json_extract(i.value,'$.kind'),
          'status',json_extract(i.value,'$.status'),'assigneeSessionId',json_extract(i.value,'$.assigneeSessionId')))
          FROM json_each(snapshot,'$.items') i))) END AS snapshot FROM plans WHERE source=? AND id=?`).get(r.source, r.plan);
    requireProgress(typeof snapshot2?.snapshot === "string", "corrupt");
    const p = JSON.parse(snapshot2.snapshot);
    requireProgress(Array.isArray(p.items) && p.items.length <= 1000 && Array.isArray(p.links) && p.links.length <= 64, "corrupt");
    for (const run of out.data) {
      const linked = p.links.find((l) => l.sessionId === run.childSessionId);
      if (!linked)
        continue;
      requireProgress(Array.isArray(linked.itemIds) && linked.itemIds.length <= 1000, "corrupt");
      const facts = p.items.filter((i) => i.kind === "task" && i.assigneeSessionId === run.childSessionId && linked.itemIds.includes(i.id)).map((i) => ({ id: i.id, status: i.status }));
      run.accepted = { plan: r.plan, revision: p.revision, items: facts.slice(0, 50), omittedItems: Math.max(0, facts.length - 50) };
      while (run.accepted.items.length && Buffer.byteLength(JSON.stringify(run)) > RUN_LIMITS.dtoBytes) {
        run.accepted.items.pop();
        run.accepted.omittedItems++;
      }
      row(JSON.stringify(run));
    }
  }
  if (rows.length > RUN_LIMITS.page)
    out.nextCursor = Buffer.from(JSON.stringify({ key: identityKey, revision: out.revision, offset: offset + RUN_LIMITS.page })).toString("base64url");
  out.coverage.complete = out.coverage.reasons.length === 0;
  requireProgress(Buffer.byteLength(JSON.stringify(out)) <= RUN_LIMITS.responseBytes, "corrupt");
  return out;
}
function requestReconciliation(db, binding, r) {
  requireProgress(obj(r) && Object.keys(r).every((k) => ["storeId", "binding", "source", "root", "token"].includes(k)));
  identity(db, binding, r);
  const c = runControl(db);
  requireProgress(c.enabled, "disabled");
  const old = db.prepare("SELECT state,token FROM runs_jobs WHERE source=? AND root=?").get(r.source, r.root);
  if (old && !r.token)
    return { state: String(old.state), coalesced: true };
  if (r.token) {
    requireProgress(identifier(r.token) && old?.token === r.token && ["partial", "failed"].includes(String(old?.state)), "conflict");
  }
  requireProgress(Number(db.prepare("SELECT count(*) AS n FROM runs_jobs WHERE state IN('pending','running')").get().n) < RUN_LIMITS.jobs, "busy");
  if (!old)
    requireProgress(capacity(db), "busy");
  db.prepare("INSERT INTO runs_jobs VALUES(?,?,?,?,'pending',NULL,NULL,NULL) ON CONFLICT(source,root) DO UPDATE SET request_id=excluded.request_id,generation=excluded.generation,state='pending',claim=NULL,token=NULL,reason=NULL").run(r.source, r.root, randomUUID2(), c.generation);
  bump(db);
  return { state: "pending", coalesced: false };
}
function pendingRecovery(db, source) {
  if (!runControl(db).enabled)
    return null;
  return db.prepare("SELECT root FROM runs_jobs WHERE source=? AND state='pending' ORDER BY rowid LIMIT 1").get(source)?.root ?? null;
}
function recoveryWork(db, j) {
  const r = db.prepare("SELECT CASE WHEN length(CAST(payload AS BLOB))<=4194304 THEN payload END AS payload FROM runs_recovery_work WHERE source=? AND root=?").get(j.source, j.root);
  if (!r)
    return { queue: [{ id: j.root, depth: 0 }], seen: [j.root] };
  requireProgress(typeof r.payload === "string", "corrupt");
  const w = JSON.parse(r.payload);
  requireProgress(Array.isArray(w.queue) && w.queue.length <= RUN_LIMITS.total && Array.isArray(w.seen) && w.seen.length <= RUN_LIMITS.total && w.seen.every(identifier) && w.queue.every((n) => identifier(n.id) && integer(n.depth) && n.depth <= 32 && (n.cursor === undefined || typeof n.cursor === "string" && Buffer.byteLength(n.cursor) <= 4096)), "corrupt");
  return w;
}
function saveRecoveryWork(db, j, w) {
  if (!recoveryAlive(db, j))
    return;
  const payload = JSON.stringify(w);
  requireProgress(Buffer.byteLength(payload) <= 4194304 && w.seen.length <= RUN_LIMITS.total && w.queue.length <= RUN_LIMITS.total, "busy");
  if (!db.prepare("SELECT 1 FROM runs_recovery_work WHERE source=? AND root=?").get(j.source, j.root))
    requireProgress(capacity(db), "busy");
  db.prepare("INSERT INTO runs_recovery_work VALUES(?,?,?) ON CONFLICT(source,root) DO UPDATE SET payload=excluded.payload").run(j.source, j.root, payload);
}
function recoveryMaintenance(db, source, directory, producer, now) {
  if (!runControl(db).enabled)
    return;
  const location = hash(directory), lease = db.prepare("SELECT producer,at FROM runs_recovery_lease WHERE source=? AND location=?").get(source, location);
  if (lease && lease.producer !== producer && now - Number(lease.at) < 1e4)
    return;
  if (!lease && !capacity(db))
    return;
  if (!lease || lease.producer !== producer) {
    db.prepare("UPDATE runs_jobs SET state='partial',claim=NULL,reason='capture-unavailable',token=? WHERE source=? AND state='running' AND root IN(SELECT id FROM sessions WHERE source=? AND json_extract(actor,'$.directory')=?)").run(randomUUID2(), source, source, directory);
    const roots = db.prepare("SELECT DISTINCT parent FROM runs_rows WHERE source=? AND terminal=0 AND child IS NOT NULL AND parent IN(SELECT id FROM sessions WHERE source=? AND json_extract(actor,'$.directory')=?) LIMIT 64").all(source, source, directory);
    for (const r of roots) {
      const old = db.prepare("SELECT state FROM runs_jobs WHERE source=? AND root=?").get(source, r.parent);
      if (old && ["pending", "running"].includes(String(old.state)))
        continue;
      if (Number(db.prepare("SELECT count(*) AS n FROM runs_jobs WHERE state IN('pending','running')").get().n) >= RUN_LIMITS.jobs)
        break;
      if (!old && !capacity(db))
        break;
      db.prepare("INSERT INTO runs_jobs VALUES(?,?,?,?,'pending',NULL,NULL,NULL) ON CONFLICT(source,root) DO UPDATE SET request_id=excluded.request_id,generation=excluded.generation,state='pending',claim=NULL,token=NULL,reason=NULL").run(source, r.parent, randomUUID2(), runControl(db).generation);
    }
  }
  db.prepare("INSERT INTO runs_recovery_lease VALUES(?,?,?,?) ON CONFLICT(source,location) DO UPDATE SET producer=excluded.producer,at=excluded.at").run(source, location, producer, now);
}
function pendingRecoveryAt(db, source, directory) {
  if (!runControl(db).enabled)
    return null;
  return db.prepare("SELECT root FROM runs_jobs WHERE source=? AND state='pending' AND root IN(SELECT id FROM sessions WHERE source=? AND json_extract(actor,'$.directory')=?) ORDER BY rowid LIMIT 1").get(source, source, directory)?.root ?? null;
}
function claimRecovery(db, source, root) {
  const c = runControl(db);
  if (!c.enabled)
    return null;
  const r = db.prepare("SELECT request_id,generation FROM runs_jobs WHERE source=? AND root=? AND state='pending'").get(source, root);
  if (!r || r.generation !== c.generation)
    return null;
  const claim = randomUUID2();
  db.prepare("UPDATE runs_jobs SET state='running',claim=? WHERE source=? AND root=?").run(claim, source, root);
  bump(db);
  return { source, root, generation: c.generation, claim, requestId: String(r.request_id) };
}
function recoveryAlive(db, j) {
  const c = runControl(db);
  return c.enabled && c.generation === j.generation && !!db.prepare("SELECT 1 FROM runs_jobs WHERE source=? AND root=? AND request_id=? AND claim=? AND state='running'").get(j.source, j.root, j.requestId, j.claim);
}
function publishHistory(db, j, s) {
  if (!recoveryAlive(db, j))
    return;
  requireProgress(identifier(s.id) && identifier(s.parent) && integer(s.createdAt) && integer(s.updatedAt) && (s.idleAt === null || integer(s.idleAt)));
  const recorded = db.prepare("SELECT payload FROM runs_rows WHERE source=? AND child=? AND message IS NOT NULL ORDER BY at DESC LIMIT 2").all(j.source, s.id).map((v) => row(v.payload));
  if (recorded.length) {
    if (s.idleAt === null || s.outcome === null || recorded.some((r2) => r2.ran.endedAt === s.idleAt && r2.ran.state === s.outcome))
      return;
  }
  const id = hash(["history", j.source, s.id]);
  if (db.prepare("SELECT 1 FROM runs_rows WHERE id=?").get(id))
    return;
  if (!capacity(db, { source: j.source, parent: s.parent }))
    return;
  const ended = s.idleAt !== null && s.idleAt >= s.createdAt ? s.idleAt : null;
  const r = { id, kind: "historical-session", source: j.source, parentSessionId: s.parent, childSessionId: s.id, tool: null, agent: metadataString(s.agent, 80), description: metadataString(s.title, 200), dispatch: null, planContext: null, ran: { state: ended !== null && ["succeeded", "failed", "interrupted"].includes(String(s.outcome)) ? s.outcome : "unknown", dispatchState: "historical", startedAt: null, endedAt: ended, updatedAt: s.updatedAt, provenance: "native-session", eventId: null, sequence: null, errorType: null, interruptionReason: null }, claimed: null, accepted: null };
  db.prepare("INSERT INTO runs_rows VALUES(?,?,?,?,NULL,NULL,?,?,?,?)").run(id, j.source, s.parent, s.id, j.generation, Number(["succeeded", "failed", "interrupted"].includes(r.ran.state)), s.createdAt, JSON.stringify(r));
  bump(db);
}
function finishRecovery(db, j, state) {
  if (!recoveryAlive(db, j))
    return;
  db.prepare("UPDATE runs_jobs SET state=?,claim=NULL,token=?,reason=? WHERE source=? AND root=?").run(state, state === "complete" ? null : randomUUID2(), state === "partial" ? "budget" : state === "failed" ? "capture-unavailable" : null, j.source, j.root);
  bump(db);
  if (state === "complete")
    db.prepare("DELETE FROM runs_recovery_work WHERE source=? AND root=?").run(j.source, j.root);
}

// shared/assignment-binding.ts
function currentBinding(value, plan, itemId) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return false;
  const b = value;
  const item = plan.items.find((i) => i.id === itemId);
  const time = (s) => typeof s === "string" && Number.isFinite(Date.parse(s)) && new Date(s).toISOString() === s;
  return Object.keys(b).every((k) => ["coordinatorSessionId", "childSessionId", "planId", "itemId", "tool", "messageId", "callId", "observedAt", "boundAt", "boundRevision", "validAtRevision"].includes(k)) && b.coordinatorSessionId === plan.sessionId && b.planId === plan.id && b.itemId === itemId && b.tool === "subagent" && identifier(b.childSessionId) && identifier(b.messageId) && identifier(b.callId) && time(b.observedAt) && time(b.boundAt) && Number.isSafeInteger(b.boundRevision) && b.boundRevision > 0 && b.boundRevision <= plan.revision && b.validAtRevision === plan.revision && item?.kind === "task" && item.assigneeSessionId === b.childSessionId && plan.links.some((l) => l.sessionId === b.childSessionId && l.itemIds.includes(itemId));
}

// shared/document-comparison.ts
var CAPTURE_LIMITS = {
  rows: 128,
  entries: 50,
  responseBytes: 262144,
  cursorBytes: 4096,
  queryBytes: 16384,
  snapshotBytes: 1048576,
  documentBytes: 262144,
  lines: 20000,
  steps: 1e6,
  traceCells: 1e6,
  renderedLines: 2000,
  renderedBytes: 131072
};
function compareCaptureText(before, after) {
  const bytes = (s) => new TextEncoder().encode(s).length;
  if (bytes(before) > CAPTURE_LIMITS.documentBytes || bytes(after) > CAPTURE_LIMITS.documentBytes)
    return { state: "limited", reason: "bytes" };
  const lines = (s) => {
    const out = [];
    let start = 0;
    for (let i = 0;i < s.length; i++)
      if (s[i] === `
`) {
        if (out.length === CAPTURE_LIMITS.lines)
          return null;
        out.push(s.slice(start, i + 1));
        start = i + 1;
      }
    if (start < s.length) {
      if (out.length === CAPTURE_LIMITS.lines)
        return null;
      out.push(s.slice(start));
    }
    return out;
  };
  const a = lines(before), b = lines(after);
  if (!a || !b)
    return { state: "limited", reason: "lines" };
  if (before === after)
    return { state: "equal" };
  const intern = new Map;
  const ids = (values) => values.map((s) => {
    let id = intern.get(s);
    if (id === undefined) {
      id = intern.size;
      intern.set(s, id);
    }
    return id;
  });
  const aa = ids(a), bb = ids(b), n = a.length, m = b.length;
  const trace = [];
  const v = new Map([[1, 0]]);
  let steps = 0, cells = 0, found = -1;
  outer:
    for (let d = 0;d <= n + m; d++) {
      cells += v.size;
      if (cells > CAPTURE_LIMITS.traceCells)
        return { state: "limited", reason: "work" };
      trace.push(new Map(v));
      for (let k = -d;k <= d; k += 2) {
        if (++steps > CAPTURE_LIMITS.steps)
          return { state: "limited", reason: "work" };
        let x2 = k === -d || k !== d && (v.get(k - 1) ?? -1) < (v.get(k + 1) ?? -1) ? v.get(k + 1) ?? 0 : (v.get(k - 1) ?? 0) + 1;
        let y2 = x2 - k;
        while (x2 < n && y2 < m && aa[x2] === bb[y2]) {
          x2++;
          y2++;
          if (++steps > CAPTURE_LIMITS.steps)
            return { state: "limited", reason: "work" };
        }
        v.set(k, x2);
        if (x2 >= n && y2 >= m) {
          found = d;
          break outer;
        }
      }
    }
  const operations = [];
  let x = n, y = m;
  for (let d = found;d >= 0; d--) {
    const previous = trace[d], k = x - y;
    const pk = k === -d || k !== d && (previous.get(k - 1) ?? -1) < (previous.get(k + 1) ?? -1) ? k + 1 : k - 1;
    const px = previous.get(pk) ?? 0, py = px - pk;
    while (x > px && y > py) {
      operations.push({ kind: "context", value: a[--x] });
      y--;
    }
    if (d > 0) {
      if (x === px)
        operations.push({ kind: "added", value: b[--y] });
      else
        operations.push({ kind: "removed", value: a[--x] });
    }
  }
  operations.reverse();
  let oldLine = 1, newLine = 1, added = 0, removed = 0;
  const positioned = operations.map((o) => {
    const ending = o.value.endsWith(`\r
`) ? "crlf" : o.value.endsWith(`
`) ? "lf" : "none";
    if (o.kind === "added")
      added++;
    if (o.kind === "removed")
      removed++;
    return { kind: o.kind, oldLine: o.kind === "added" ? null : oldLine++, newLine: o.kind === "removed" ? null : newLine++, text: o.value.slice(0, o.value.length - (ending === "crlf" ? 2 : ending === "lf" ? 1 : 0)), ending };
  });
  const ranges = [];
  for (let i = 0;i < positioned.length; i++)
    if (positioned[i].kind !== "context") {
      const start = Math.max(0, i - 3), end = Math.min(positioned.length, i + 4), last = ranges.at(-1);
      if (last && start <= last[1])
        last[1] = end;
      else
        ranges.push([start, end]);
    }
  let count = 0, size = 0, previousEnd = 0;
  const hunks = [];
  for (const [start, end] of ranges) {
    count += end - start;
    if (count > CAPTURE_LIMITS.renderedLines)
      return { state: "limited", reason: "output" };
    const kept = positioned.slice(start, end);
    for (const line of kept) {
      size += bytes(line.text);
      if (size > CAPTURE_LIMITS.renderedBytes)
        return { state: "limited", reason: "output" };
    }
    const oldStart = kept.find((l) => l.oldLine !== null)?.oldLine ?? positioned.slice(0, start).filter((l) => l.oldLine !== null).length + 1;
    const newStart = kept.find((l) => l.newLine !== null)?.newLine ?? positioned.slice(0, start).filter((l) => l.newLine !== null).length + 1;
    hunks.push({ oldStart, newStart, omittedBefore: start - previousEnd, lines: kept });
    previousEnd = end;
  }
  return { state: "diff", hunks, omittedAfter: positioned.length - previousEnd, added, removed };
}

// shared/document-captures.ts
var integer2 = (v, min = 0) => Number.isSafeInteger(v) && Number(v) >= min;
var same = (a, b) => a.sourceId === b.sourceId && a.verified === b.verified;
var validTime = (v) => typeof v === "string" && v.length <= 40 && Number.isFinite(Date.parse(v));
function head(db, binding, r) {
  requireProgress(identifier(r.storeId) && identifier(r.source) && identifier(r.plan) && integer2(r.cleanupRev));
  requireProgress(r.binding && same(binding, r.binding), "conflict");
  const meta = db.prepare("SELECT CASE WHEN length(store_id)<=80 THEN store_id END AS store_id,enabled FROM meta WHERE singleton=1").get();
  requireProgress(meta.store_id === r.storeId, "conflict");
  const row2 = db.prepare(`SELECT revision, length(CAST(snapshot AS BLOB)) AS bytes,
    CASE WHEN length(CAST(snapshot AS BLOB))<=? AND json_type(snapshot,'$.id')='text' THEN substr(json_extract(snapshot,'$.id'),1,81) END AS snapshot_id,
    CASE WHEN length(CAST(snapshot AS BLOB))<=? AND json_type(snapshot,'$.sourceId')='text' THEN substr(json_extract(snapshot,'$.sourceId'),1,81) END AS snapshot_source,
    CASE WHEN length(CAST(snapshot AS BLOB))<=? AND json_type(snapshot,'$.revision')='integer' THEN json_extract(snapshot,'$.revision') END AS snapshot_revision,
    CASE WHEN length(CAST(snapshot AS BLOB))<=? THEN
      CASE WHEN length(CAST(json_extract(snapshot,'$.document') AS BLOB))<=32768 THEN json_extract(snapshot,'$.document') END
    END AS document FROM plans WHERE source=? AND id=?`).get(CAPTURE_LIMITS.snapshotBytes, CAPTURE_LIMITS.snapshotBytes, CAPTURE_LIMITS.snapshotBytes, CAPTURE_LIMITS.snapshotBytes, r.source, r.plan);
  requireProgress(row2, "not-found");
  requireProgress(integer2(row2.revision, 1) && Number(row2.bytes) <= CAPTURE_LIMITS.snapshotBytes, "corrupt");
  requireProgress(row2.snapshot_id === r.plan && row2.snapshot_source === r.source && row2.snapshot_revision === row2.revision, "corrupt");
  const cleanup = (cleanupInstalled(db) ? cleanupState(db, r.source, r.plan) : undefined) ?? { generation: 0, state: "visible" };
  requireProgress(Number(cleanup.generation) === r.cleanupRev && cleanup.state !== "deleted", "conflict");
  requireProgress(typeof row2.document === "string", "corrupt");
  let doc;
  try {
    doc = JSON.parse(row2.document);
  } catch {
    requireProgress(false, "corrupt");
  }
  requireProgress(doc && typeof doc === "object" && !Array.isArray(doc) && ["unbound", "captured", "denied", "missing", "moved", "oversized", "non-text", "unavailable", "changed-during-read"].includes(String(doc.state)) && typeof doc.checklistSynchronized === "boolean", "corrupt");
  for (const key of ["path", "canonicalPath"])
    requireProgress(doc[key] === undefined || typeof doc[key] === "string" && doc[key].length <= 4096, "corrupt");
  requireProgress(doc.captureId === undefined || integer2(doc.captureId, 1), "corrupt");
  requireProgress(doc.checkedAt === undefined || validTime(doc.checkedAt), "corrupt");
  return {
    identity: { ...r, binding: { ...binding }, protocolVersion: 2, schemaVersion: 2, documentCaptureComparison: 1, sourceBinding: { ...binding } },
    current: { revision: Number(row2.revision), captureId: doc.captureId ?? null, state: String(doc.state), checklistSynchronized: doc.checklistSynchronized, checkedAt: doc.checkedAt ?? null, path: doc.path ?? null, currentFile: "not-rechecked", captureEnabled: Boolean(meta.enabled) }
  };
}
var projection = `id, revision,
 CASE WHEN length(CAST(source AS BLOB))<=80 THEN source END AS source,
 CASE WHEN length(CAST(plan AS BLOB))<=80 THEN plan END AS plan,
 CASE WHEN length(CAST(hash AS BLOB))=64 THEN hash END AS hash,
 CASE WHEN length(CAST(captured_at AS BLOB))<=40 THEN captured_at END AS captured_at,
 CASE WHEN length(CAST(canonical_path AS BLOB))<=16384 THEN substr(canonical_path,1,4097) END AS canonical_path`;
function entry(row2) {
  requireProgress(integer2(row2.id, 1) && integer2(row2.revision, 1) && identifier(row2.source) && identifier(row2.plan) && typeof row2.hash === "string" && /^[a-f0-9]{64}$/.test(row2.hash) && validTime(row2.captured_at) && typeof row2.canonical_path === "string" && row2.canonical_path.length <= 4096 && !row2.canonical_path.includes("\x00"), "corrupt");
  return { id: row2.id, revision: row2.revision, hash: row2.hash, capturedAt: row2.captured_at, path: row2.canonical_path };
}
function decodeCursor(raw, r) {
  requireProgress(Buffer.byteLength(raw) <= CAPTURE_LIMITS.cursorBytes && /^[A-Za-z0-9_-]+$/.test(raw));
  let c;
  try {
    c = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    requireProgress(false);
  }
  requireProgress(c && typeof c === "object" && Object.keys(c).length === 4 && integer2(c.ceiling) && c.ceiling < Number.MAX_SAFE_INTEGER && integer2(c.revision, 1) && integer2(c.before, 1) && c.before <= c.ceiling + 1);
  const i = c.identity;
  requireProgress(i && i.storeId === r.storeId && i.source === r.source && i.plan === r.plan && i.cleanupRev === r.cleanupRev && i.binding && same(i.binding, r.binding), "conflict");
  return { identity: r, ceiling: c.ceiling, revision: c.revision, before: c.before };
}
function captureIndex(db, binding, r, cursor) {
  const h = head(db, binding, r);
  const max = Number(db.prepare("SELECT coalesce(max(id),0) AS id FROM captures").get().id);
  requireProgress(integer2(max) && max < Number.MAX_SAFE_INTEGER, "corrupt");
  const c = cursor !== undefined ? decodeCursor(cursor, r) : { identity: r, ceiling: max, revision: h.current.revision, before: max + 1 };
  requireProgress(c.revision <= h.current.revision, "conflict");
  const rows = db.prepare(`SELECT ${projection} FROM captures WHERE id<? AND id<=? ORDER BY id DESC LIMIT ?`).all(c.before, c.ceiling, CAPTURE_LIMITS.rows);
  const out = { ...h.identity, data: [], nextCursor: null, exhausted: false, scanned: 0, revision: c.revision, limit: null };
  let before = c.before;
  for (const row2 of rows) {
    const e = entry(row2);
    const qualifies = row2.source === r.source && row2.plan === r.plan && e.revision <= c.revision;
    if (qualifies) {
      if (out.data.length === CAPTURE_LIMITS.entries) {
        out.limit = "entries";
        break;
      }
      if (Buffer.byteLength(JSON.stringify({ ...out, data: [...out.data, e] })) > CAPTURE_LIMITS.responseBytes - CAPTURE_LIMITS.cursorBytes - 1024) {
        out.limit = "bytes";
        break;
      }
      out.data.push(e);
    }
    before = e.id;
    out.scanned++;
  }
  out.exhausted = out.scanned === rows.length && rows.length < CAPTURE_LIMITS.rows;
  if (!out.exhausted) {
    out.limit ??= "rows";
    out.nextCursor = Buffer.from(JSON.stringify({ ...c, before })).toString("base64url");
  }
  requireProgress(Buffer.byteLength(JSON.stringify(out)) <= CAPTURE_LIMITS.responseBytes, "corrupt");
  return out;
}
function captureComparison(db, binding, r, before, after) {
  requireProgress(integer2(before, 1) && integer2(after, 1) && before <= after);
  const h = head(db, binding, r);
  const read = (id) => {
    const row2 = db.prepare(`SELECT ${projection},length(CAST(text AS BLOB)) AS bytes FROM captures WHERE id=? AND source=? AND plan=?`).get(id, r.source, r.plan);
    requireProgress(row2, "not-found");
    return { entry: entry(row2), bytes: Number(row2.bytes) };
  };
  const a = read(before), b = before === after ? a : read(after);
  const out = { ...h.identity, before: a.entry, after: b.entry, current: h.current, result: { state: "limited", reason: "bytes" } };
  if (a.bytes <= CAPTURE_LIMITS.documentBytes && b.bytes <= CAPTURE_LIMITS.documentBytes && a.bytes >= 0 && b.bytes >= 0) {
    const body = (id) => String(db.prepare("SELECT text FROM captures WHERE id=?").get(id).text);
    const text = body(before);
    out.result = compareCaptureText(text, before === after ? text : body(after));
  }
  if (Buffer.byteLength(JSON.stringify(out)) > CAPTURE_LIMITS.responseBytes)
    out.result = { state: "limited", reason: "output" };
  requireProgress(Buffer.byteLength(JSON.stringify(out)) <= CAPTURE_LIMITS.responseBytes, "corrupt");
  return out;
}

// shared/store.ts
import { randomUUID as randomUUID3, createHash as createHash4 } from "node:crypto";
import { existsSync as existsSync3, lstatSync as lstatSync4, openSync as openSync3, readSync, closeSync as closeSync3, realpathSync as realpathSync4, chmodSync } from "node:fs";
import path4 from "node:path";

// shared/plan-task-search.ts
import { createHash as createHash3 } from "node:crypto";

// shared/change-digest.ts
var DIGEST_LIMITS = { snapshots: 128, bytes: 8 * 1024 * 1024, tasks: 50, references: 4, responseBytes: 256 * 1024 };
function emptyEvents() {
  return { added: 0, removed: 0, revised: 0, completed: 0, reopened: 0, blocked: 0, unblocked: 0, skipped: 0, unskipped: 0 };
}
var facts = (i) => ({ title: i.title, status: i.status, parentId: i.parentId ?? null, dependencies: [...new Set(i.dependencies ?? [])].sort() });
var tasks = (p) => new Map(p.items.filter((i) => i.kind === "task").map((i) => [i.id, i]));
function compareTasks(before, after) {
  const a = tasks(before), b = tasks(after), changes = [];
  for (const id of [...new Set([...a.keys(), ...b.keys()])].sort()) {
    const old = a.get(id), next = b.get(id), facets = [];
    if (!old) {
      facets.push("added");
      if (next.status === "blocked")
        facets.push("blocked");
    } else if (!next)
      facets.push("removed");
    else {
      if (old.status !== "done" && next.status === "done")
        facets.push("completed");
      if (old.status === "done" && next.status !== "done")
        facets.push("reopened");
      if (old.status !== "blocked" && next.status === "blocked")
        facets.push("blocked");
      if (old.status === "blocked" && next.status !== "blocked")
        facets.push("unblocked");
      if (old.status !== "skipped" && next.status === "skipped")
        facets.push("skipped");
      if (old.status === "skipped" && next.status !== "skipped")
        facets.push("unskipped");
      const x = facts(old), y = facts(next);
      if (x.title !== y.title || x.parentId !== y.parentId || JSON.stringify(x.dependencies) !== JSON.stringify(y.dependencies))
        facets.push("revised");
    }
    if (facets.length)
      changes.push({ id, reference: { from: before.revision, to: after.revision, reportedAt: after.reportedAt, facets, before: old ? facts(old) : null, after: next ? facts(next) : null } });
  }
  return changes;
}
function endpointCounts(before, after) {
  const scope2 = { addedCounted: 0, removedCounted: 0, skipped: 0, unskipped: 0, addedDone: 0, removedDone: 0, completed: 0, reopened: 0 };
  const a = tasks(before), b = tasks(after);
  for (const id of new Set([...a.keys(), ...b.keys()])) {
    const old = a.get(id), next = b.get(id);
    if (!old) {
      if (next.status !== "skipped")
        scope2.addedCounted++;
      if (next.status === "done")
        scope2.addedDone++;
    } else if (!next) {
      if (old.status !== "skipped")
        scope2.removedCounted++;
      if (old.status === "done")
        scope2.removedDone++;
    } else {
      if (old.status !== "skipped" && next.status === "skipped")
        scope2.skipped++;
      if (old.status === "skipped" && next.status !== "skipped")
        scope2.unskipped++;
      if (old.status !== "done" && next.status === "done")
        scope2.completed++;
      if (old.status === "done" && next.status !== "done")
        scope2.reopened++;
    }
  }
  return { before: countItems(before.items), after: countItems(after.items), scope: scope2 };
}
function aggregatePair(result, before, after, target) {
  for (const { id, reference } of compareTasks(before, after)) {
    for (const facet of reference.facets)
      result.summary.events[facet]++;
    let row2 = result.tasks.find((t) => t.id === id);
    if (!row2 && result.tasks.length >= DIGEST_LIMITS.tasks) {
      result.details.omittedTasks = true;
      result.details.omittedTaskCount = null;
      result.details.truncated = true;
      continue;
    }
    if (!row2) {
      const atTarget = target.items.find((i) => i.id === id && i.kind === "task");
      const latest = atTarget ?? reference.after ?? reference.before;
      row2 = { id, title: latest.title, status: latest.status, presentAtTarget: !!atTarget, latestRevision: after.revision, occurrences: emptyEvents(), references: [], omittedReferences: 0 };
      result.tasks.push(row2);
    }
    for (const facet of reference.facets)
      row2.occurrences[facet]++;
    if (row2.references.length < DIGEST_LIMITS.references)
      row2.references.push(reference);
    else {
      row2.omittedReferences++;
      result.details.truncated = true;
    }
  }
}
function validateDigestSnapshot(value, source, plan, revision) {
  try {
    const p = value;
    if (!p || p.id !== plan || p.sourceId !== source || p.revision !== revision || !Number.isSafeInteger(revision) || revision < 1 || !Number.isSafeInteger(p.structuralRevision) || p.structuralRevision < 1 || p.structuralRevision > revision || !["active", "finished", "cancelled", "failed"].includes(p.lifecycle) || typeof p.reportedAt !== "string" || !Number.isFinite(Date.parse(p.reportedAt)) || new Date(p.reportedAt).toISOString() !== p.reportedAt || !Array.isArray(p.items) || p.items.length > LIMITS.planItems)
      return null;
    const byId = new Map;
    for (const i of p.items) {
      if (!i || !identifier(i.id) || byId.has(i.id) || typeof i.title !== "string" || !i.title.trim() || i.title.length > 512 || !["task", "group"].includes(i.kind) || !["pending", "working", "blocked", "done", "skipped"].includes(i.status) || i.parentId !== undefined && !identifier(i.parentId) || i.dependencies !== undefined && (!Array.isArray(i.dependencies) || i.dependencies.length > 16 || !i.dependencies.every(identifier)))
        return null;
      byId.set(i.id, i);
    }
    for (const i of p.items) {
      if (i.parentId !== undefined && byId.get(i.parentId)?.kind !== "group" || (i.dependencies ?? []).some((id) => id === i.id || byId.get(id)?.kind !== "task"))
        return null;
      const seen = new Set([i.id]);
      let parent = i.parentId;
      while (parent) {
        if (seen.has(parent))
          return null;
        seen.add(parent);
        parent = byId.get(parent)?.parentId;
      }
    }
    const visiting = new Set, visited = new Set;
    const visit = (id) => {
      if (visited.has(id))
        return true;
      if (visiting.has(id))
        return false;
      visiting.add(id);
      for (const dep of byId.get(id)?.dependencies ?? [])
        if (!visit(dep))
          return false;
      visiting.delete(id);
      visited.add(id);
      return true;
    };
    if (!p.items.every((i) => visit(i.id)))
      return null;
    return { id: p.id, sourceId: p.sourceId, revision, structuralRevision: p.structuralRevision, lifecycle: p.lifecycle, reportedAt: p.reportedAt, items: p.items.map((i) => ({ id: i.id, title: i.title, kind: i.kind, status: i.status, ...i.parentId !== undefined ? { parentId: i.parentId } : {}, ...i.dependencies ? { dependencies: [...i.dependencies] } : {} })) };
  } catch {
    return null;
  }
}
function capDigest(result) {
  while (Buffer.byteLength(JSON.stringify(result)) > DIGEST_LIMITS.responseBytes && result.tasks.length) {
    result.tasks.pop();
    result.details.truncated = true;
    result.details.omittedTasks = true;
    if (result.details.omittedTaskCount !== null)
      result.details.omittedTaskCount++;
  }
  return result;
}

// shared/plan-task-search.ts
var normalize = (s) => s.normalize("NFC").toLowerCase().normalize("NFC");
function searchTokens(q) {
  requireProgress(typeof q === "string" && Array.from(q).length <= SEARCH_LIMITS.queryPoints && !q.includes("\x00"));
  const tokens = normalize(q).trim().split(/\s+/u).filter(Boolean);
  requireProgress(tokens.length <= SEARCH_LIMITS.tokens);
  return tokens;
}
function searchMatches(tokens, title, id) {
  const t = normalize(title), key = normalize(id);
  return tokens.every((word) => t.includes(word) || key.includes(word));
}
var safe = (n, min = 0) => Number.isSafeInteger(n) && Number(n) >= min;
var hash2 = (v) => createHash3("sha256").update(JSON.stringify(v)).digest("hex");
var fields = (v, keys) => Object.keys(v).length === keys.length && Object.keys(v).every((k) => keys.includes(k));
function parseCursor(text) {
  requireProgress(typeof text === "string" && Buffer.byteLength(text) <= SEARCH_LIMITS.cursorBytes && /^[A-Za-z0-9_-]+$/.test(text));
  let c;
  try {
    c = JSON.parse(Buffer.from(text, "base64url").toString("utf8"));
  } catch {
    requireProgress(false);
  }
  requireProgress(c && fields(c, ["v", "identity", "fingerprint", "after", "pending", "gapped"]) && c.v === 1 && typeof c.identity === "string" && /^[a-f0-9]{64}$/.test(c.identity) && typeof c.fingerprint === "string" && /^[a-f0-9]{64}$/.test(c.fingerprint) && typeof c.gapped === "boolean");
  const key = (v) => v && fields(v, ["source", "plan"]) && identifier(v.source) && identifier(v.plan);
  requireProgress(c.after === null || key(c.after));
  const p = c.pending;
  requireProgress(p === null || p && fields(p, ["source", "plan", "revision", "cleanup", "member", "offset", "counted", "phase"]) && identifier(p.source) && identifier(p.plan) && safe(p.revision, 1) && safe(p.cleanup) && safe(p.member) && p.member <= p.revision && safe(p.offset) && p.offset <= 1000 && typeof p.counted === "boolean" && typeof p.phase === "string" && ["membership", "hits"].includes(p.phase) && (p.phase !== "membership" || p.offset === 0 && !p.counted));
  return c;
}
function searchIdentity(db, binding) {
  return { protocolVersion: 2, schemaVersion: 2, planTaskSearch: 1, storeId: String(db.prepare("SELECT store_id FROM meta WHERE singleton=1").get().store_id), sourceBinding: { ...binding } };
}
function cleanup(db, installed, source, plan) {
  const c = installed ? cleanupState(db, source, plan) : undefined;
  return { state: c?.state ?? "visible", revision: Number(c?.generation ?? 0) };
}
function validPlan(value, source, id, revision) {
  const p = value;
  if (!validateDigestSnapshot(value, source, id, revision) || typeof p.title !== "string" || !p.title.trim() || p.title.length > 256 || !identifier(p.sessionId) || typeof p.directory !== "string" || p.directory.length > 4096 || p.directory.includes("\x00") || p.projectId !== undefined && (typeof p.projectId !== "string" || p.projectId.length > 4096) || !Array.isArray(p.links) || p.links.length > 64 || p.links.some((l) => !l || !identifier(l.sessionId) || !Array.isArray(l.itemIds) || l.itemIds.length > 1000 || !l.itemIds.every(identifier)))
    return null;
  return p;
}
function context(p, item) {
  const byId = new Map(p.items.map((i) => [i.id, i]));
  const ancestors = [];
  let parent = item.parentId;
  while (parent) {
    const a = byId.get(parent);
    ancestors.unshift({ id: a.id, title: a.title });
    parent = a.parentId;
  }
  const omittedAncestors = Math.max(0, ancestors.length - SEARCH_LIMITS.ancestors);
  return { ancestors: omittedAncestors ? [ancestors[0], ...ancestors.slice(-(SEARCH_LIMITS.ancestors - 1))] : ancestors, omittedAncestors };
}
function searchWindow(db, binding, options = {}) {
  requireProgress(Object.keys(options).every((k) => ["q", "source", "session", "lifecycle", "status", "archived", "limit", "cursor"].includes(k)));
  const tokens = searchTokens(options.q ?? ""), limit = options.limit ?? 20, archived = options.archived ?? "exclude";
  requireProgress(Number.isInteger(limit) && limit > 0 && limit <= SEARCH_LIMITS.hits && ["exclude", "only"].includes(archived));
  for (const key of ["source", "session"])
    requireProgress(options[key] === undefined || identifier(options[key]));
  requireProgress(options.lifecycle === undefined || ["active", "finished", "cancelled", "failed"].includes(options.lifecycle));
  requireProgress(options.status === undefined || ["pending", "working", "blocked", "done", "skipped"].includes(options.status));
  const identity2 = searchIdentity(db, binding), identityHash = hash2(identity2), fingerprint = hash2([options.q ?? "", options.source ?? null, options.session ?? null, options.lifecycle ?? null, options.status ?? null, archived, limit]);
  const c = options.cursor === undefined ? { v: 1, identity: identityHash, fingerprint, after: null, pending: null, gapped: false } : parseCursor(options.cursor);
  requireProgress(c.identity === identityHash && c.fingerprint === fingerprint, "conflict");
  requireProgress(!options.source || (!c.after || c.after.source === options.source) && (!c.pending || c.pending.source === options.source));
  const installed = cleanupInstalled(db);
  const r = { ...identity2, fingerprint, hits: [], counts: { matchedPlans: 0, matchingTasks: 0 }, nextCursor: null, exhausted: false, coverage: { kind: "recorded-current", asSearched: true, gapped: c.gapped, skippedRecords: 0, reasons: [] }, work: { planSlots: 0, inspectedItems: 0, membershipRows: 0, inputBytes: 0, outputHits: 0, outputBytes: 0 } };
  const gap = (reason) => {
    c.gapped = r.coverage.gapped = true;
    r.coverage.skippedRecords++;
    if (!r.coverage.reasons.includes(reason))
      r.coverage.reasons.push(reason);
  };
  const advance = (source, plan) => {
    c.after = { source, plan };
    c.pending = null;
  };
  let hitBytes = 0;
  while (r.work.planSlots < SEARCH_LIMITS.plans && r.hits.length < limit) {
    const pending = c.pending;
    const row2 = pending ? db.prepare("SELECT source,id,revision,length(CAST(snapshot AS BLOB)) AS bytes FROM plans WHERE source=? AND id=?").get(pending.source, pending.plan) : options.source ? db.prepare("SELECT source,id,revision,length(CAST(snapshot AS BLOB)) AS bytes FROM plans WHERE source=? AND id>? ORDER BY id LIMIT 1").get(options.source, c.after?.plan ?? "") : db.prepare("SELECT source,id,revision,length(CAST(snapshot AS BLOB)) AS bytes FROM plans WHERE (source,id)>(?,?) ORDER BY source,id LIMIT 1").get(c.after?.source ?? "", c.after?.plan ?? "");
    r.work.planSlots++;
    if (!row2) {
      requireProgress(!pending, "conflict");
      r.exhausted = true;
      break;
    }
    const source = String(row2.source), id = String(row2.id), revision = Number(row2.revision), state = cleanup(db, installed, source, id);
    if (pending)
      requireProgress(pending.revision === revision && pending.cleanup === state.revision && state.state !== "deleted", "conflict");
    requireProgress(identifier(source) && identifier(id), "corrupt");
    if (!safe(revision, 1)) {
      gap("invalid-snapshot");
      advance(source, id);
      continue;
    }
    if (state.state === "deleted" || state.state === "archived" !== (archived === "only")) {
      advance(source, id);
      continue;
    }
    const bytes = Number(row2.bytes);
    if (bytes > SEARCH_LIMITS.inputBytes) {
      gap("oversized-snapshot");
      advance(source, id);
      continue;
    }
    if (r.work.inputBytes + bytes > SEARCH_LIMITS.inputBytes)
      break;
    const text = db.prepare("SELECT snapshot FROM plans WHERE source=? AND id=?").get(source, id).snapshot;
    r.work.inputBytes += bytes;
    let p = null;
    try {
      p = validPlan(JSON.parse(String(text)), source, id, revision);
    } catch {}
    if (!p) {
      gap("invalid-snapshot");
      advance(source, id);
      continue;
    }
    r.work.inspectedItems += p.items.length;
    if (options.lifecycle && options.lifecycle !== p.lifecycle) {
      advance(source, id);
      continue;
    }
    const pos = pending ?? { source, plan: id, revision, cleanup: state.revision, member: 0, offset: 0, counted: false, phase: "membership" };
    if (options.session && pos.phase === "membership" && p.sessionId !== options.session && !p.links.some((l) => l.sessionId === options.session)) {
      let member = false, finished = false, invalid = false;
      while (r.work.membershipRows < SEARCH_LIMITS.membershipRows) {
        const m = db.prepare("SELECT revision,length(CAST(payload AS BLOB)) AS bytes FROM contributions WHERE source=? AND plan=? AND revision>? AND revision<=? ORDER BY revision LIMIT 1").get(source, id, pos.member, revision);
        if (!m) {
          finished = true;
          break;
        }
        r.work.membershipRows++;
        const size = Number(m.bytes);
        if (size + bytes > SEARCH_LIMITS.inputBytes) {
          gap("oversized-membership");
          invalid = true;
          break;
        }
        if (r.work.inputBytes + size > SEARCH_LIMITS.inputBytes)
          break;
        const payload = db.prepare("SELECT payload FROM contributions WHERE source=? AND plan=? AND revision=?").get(source, id, m.revision).payload;
        r.work.inputBytes += size;
        let v;
        try {
          v = JSON.parse(String(payload));
        } catch {}
        if (!v || v.revision !== m.revision || !identifier(v.attributedSessionId)) {
          gap("invalid-membership");
          invalid = true;
          break;
        }
        pos.member = Number(m.revision);
        if (v.attributedSessionId === options.session) {
          member = true;
          break;
        }
      }
      if (invalid || finished && !member) {
        advance(source, id);
        continue;
      }
      if (!member) {
        c.pending = pos;
        break;
      }
    }
    pos.phase = "hits";
    const planMatched = searchMatches(tokens, p.title, p.id);
    const matches = p.items.filter((i) => i.kind === "task" && (!options.status || i.status === options.status) && searchMatches(tokens, i.title, i.id));
    if (!matches.length && (!planMatched || options.status)) {
      advance(source, id);
      continue;
    }
    const tasks2 = matches.length ? matches : [null];
    const sourceVerified = Boolean(db.prepare("SELECT verified FROM sources WHERE id=?").get(source)?.verified);
    const plan = { id, sourceId: source, title: p.title, sessionId: p.sessionId, revision, structuralRevision: p.structuralRevision, lifecycle: p.lifecycle, reportedAt: p.reportedAt, directory: p.directory, ...p.projectId === undefined ? {} : { projectId: p.projectId }, counts: countItems(p.items), cleanup: state, sourceVerified };
    requireProgress(pos.offset < tasks2.length);
    while (pos.offset < tasks2.length && r.hits.length < limit) {
      const task = tasks2[pos.offset];
      const hit = { plan, planMatched, task: task ? { id: task.id, title: task.title, status: task.status } : null, ...task ? context(p, task) : { ancestors: [], omittedAncestors: 0 }, continued: pos.counted, classified: pos.counted ? null : { matchedPlans: 1, matchingTasks: matches.length } };
      const size = Buffer.byteLength(JSON.stringify(hit)) + 1;
      if (hitBytes + size > SEARCH_LIMITS.responseBytes - 16 * 1024)
        break;
      if (!pos.counted) {
        r.counts.matchedPlans++;
        r.counts.matchingTasks += matches.length;
        pos.counted = true;
      }
      hitBytes += size;
      r.hits.push(hit);
      pos.offset++;
    }
    if (pos.offset < tasks2.length) {
      c.pending = pos;
      break;
    }
    advance(source, id);
  }
  r.nextCursor = r.exhausted ? null : Buffer.from(JSON.stringify(c)).toString("base64url");
  requireProgress(r.nextCursor === null || Buffer.byteLength(r.nextCursor) <= SEARCH_LIMITS.cursorBytes);
  r.work.outputHits = r.hits.length;
  for (let n = 0;n < 3; n++)
    r.work.outputBytes = Buffer.byteLength(JSON.stringify(r));
  requireProgress(r.work.outputBytes <= SEARCH_LIMITS.responseBytes);
  return r;
}
function searchState(db, binding, storeId, keys) {
  requireProgress(identifier(storeId) && Array.isArray(keys) && keys.length > 0 && keys.length <= SEARCH_LIMITS.stateKeys && keys.every((k) => k && fields(k, ["source", "plan"]) && identifier(k.source) && identifier(k.plan)));
  requireProgress(new Set(keys.map((k) => JSON.stringify([k.source, k.plan]))).size === keys.length);
  const identity2 = searchIdentity(db, binding);
  requireProgress(identity2.storeId === storeId, "conflict");
  const installed = cleanupInstalled(db);
  const captureEnabled = Boolean(db.prepare("SELECT enabled FROM meta WHERE singleton=1").get().enabled);
  return { ...identity2, captureEnabled, data: keys.map((k) => {
    const row2 = db.prepare("SELECT revision FROM plans WHERE source=? AND id=?").get(k.source, k.plan), state = cleanup(db, installed, k.source, k.plan);
    requireProgress(!row2 || safe(row2.revision, 1), "corrupt");
    return { ...k, exists: !!row2 && state.state !== "deleted", revision: row2 ? Number(row2.revision) : null, cleanup: state };
  }) };
}

// shared/progress-resume.ts
var RESUME_LIMITS = { candidates: 3, assignments: 20, planSlots: 64, snapshotBytes: 1048576, inputBytes: 8388608, scanMs: 100 };
function validPlan2(value, source, id, revision) {
  const p = value;
  requireProgress(validateDigestSnapshot(value, source, id, revision), "corrupt");
  requireProgress(typeof p.title === "string" && !!p.title.trim() && p.title.length <= 256 && !p.title.includes("\x00") && identifier(p.sessionId), "corrupt");
  requireProgress(Array.isArray(p.links) && p.links.length <= 64, "corrupt");
  const sessions = new Set, assigned = new Map;
  const items = new Map(p.items.map((i) => [i.id, i]));
  for (const link of p.links) {
    requireProgress(link && identifier(link.sessionId) && !sessions.has(link.sessionId) && link.sessionId !== p.sessionId && Array.isArray(link.itemIds) && link.itemIds.length <= 1000, "corrupt");
    sessions.add(link.sessionId);
    for (const id2 of link.itemIds) {
      requireProgress(identifier(id2) && !assigned.has(id2) && items.get(id2)?.kind === "task" && items.get(id2)?.assigneeSessionId === link.sessionId, "corrupt");
      assigned.set(id2, link.sessionId);
    }
  }
  for (const item of p.items)
    if (item.assigneeSessionId !== undefined) {
      requireProgress(identifier(item.assigneeSessionId) && item.kind === "task" && assigned.get(item.id) === item.assigneeSessionId, "corrupt");
    }
  return p;
}
function resumeSelection(db, binding, r, now = () => performance.now()) {
  if (!identifier(r.storeId) || !identifier(r.sourceId) || !identifier(r.sessionId) || binding.sourceId !== r.sourceId || !binding.verified || !Array.isArray(r.ancestry) || r.ancestry.length > 32 || !r.ancestry.every(identifier) || new Set([r.sessionId, ...r.ancestry]).size !== r.ancestry.length + 1 || (r.parentId === null ? r.ancestry.length !== 0 : !identifier(r.parentId) || r.ancestry[0] !== r.parentId))
    return null;
  const meta = db.prepare("SELECT store_id,enabled FROM meta WHERE singleton=1").get();
  const source = db.prepare("SELECT verified FROM sources WHERE id=?").get(r.sourceId);
  requireProgress(meta && identifier(meta.store_id) && (meta.enabled === 0 || meta.enabled === 1), "corrupt");
  if (meta.store_id !== r.storeId || meta.enabled !== 1 || source?.verified !== 1)
    return null;
  requireProgress(Number(db.prepare("PRAGMA busy_timeout").get().timeout) <= 1000, "binding");
  const installed = cleanupInstalled(db);
  const result = { storeId: r.storeId, sourceId: r.sourceId, sessionId: r.sessionId, candidates: [], omitted: false, incomplete: false, limit: null, work: { planSlots: 0, snapshots: 0, inputBytes: 0 } };
  const start = now();
  let last = start;
  requireProgress(Number.isFinite(start), "invalid");
  const expired = () => {
    const t = now();
    requireProgress(Number.isFinite(t) && t >= last, "invalid");
    last = t;
    return t - start >= RESUME_LIMITS.scanMs;
  };
  const stop = (limit) => {
    result.incomplete = true;
    result.limit = limit;
    return result;
  };
  let after = null;
  while (result.work.planSlots < RESUME_LIMITS.planSlots) {
    if (expired())
      return stop("time");
    const row2 = db.prepare("SELECT id,revision,length(CAST(snapshot AS BLOB)) AS bytes,CASE WHEN length(CAST(snapshot AS BLOB))<=? THEN snapshot ELSE NULL END AS snapshot FROM plans WHERE source=?" + (after === null ? "" : " AND id>?") + " ORDER BY id LIMIT 1").get(Math.min(RESUME_LIMITS.snapshotBytes, RESUME_LIMITS.inputBytes - result.work.inputBytes), r.sourceId, ...after === null ? [] : [after]);
    result.work.planSlots++;
    if (!row2)
      return result;
    requireProgress(identifier(row2.id) && Number.isSafeInteger(row2.revision) && Number(row2.revision) > 0 && Number.isSafeInteger(row2.bytes) && Number(row2.bytes) > 0, "corrupt");
    after = row2.id;
    requireProgress(Number(row2.bytes) <= RESUME_LIMITS.snapshotBytes, "corrupt");
    if (Number(row2.bytes) > RESUME_LIMITS.inputBytes - result.work.inputBytes)
      return stop("bytes");
    result.work.inputBytes += Number(row2.bytes);
    result.work.snapshots++;
    let value;
    try {
      value = JSON.parse(String(row2.snapshot));
    } catch {
      throw new ProgressError("corrupt");
    }
    const p = validPlan2(value, r.sourceId, row2.id, Number(row2.revision));
    const cleanup2 = installed ? db.prepare("SELECT state,generation FROM cleanup_state WHERE source=? AND plan=?").get(r.sourceId, row2.id) : undefined;
    if (cleanup2)
      requireProgress(["visible", "archived", "deleted"].includes(String(cleanup2.state)) && Number.isSafeInteger(cleanup2.generation) && Number(cleanup2.generation) > 0 && cleanup2.state !== "deleted", "corrupt");
    if (expired())
      return stop("time");
    if (cleanup2?.state === "archived" || p.lifecycle !== "active")
      continue;
    const pointer = { sourceId: r.sourceId, plan: p.id, title: p.title, revision: p.revision };
    let candidate2;
    if (r.parentId === null) {
      if (p.sessionId !== r.sessionId)
        continue;
      candidate2 = { ...pointer, scope: "coordinator" };
    } else {
      const link = p.links.find((l) => l.sessionId === r.sessionId);
      if (!r.ancestry.includes(p.sessionId) || !link?.itemIds.length)
        continue;
      if (link.itemIds.length > RESUME_LIMITS.assignments) {
        result.omitted = true;
        continue;
      }
      candidate2 = { ...pointer, scope: "assigned", itemIds: [...link.itemIds] };
    }
    if (result.candidates.length === RESUME_LIMITS.candidates) {
      result.omitted = true;
      return stop("candidates");
    }
    result.candidates.push(candidate2);
  }
  return stop("slots");
}

// shared/store.ts
function canonical(value) {
  if (Array.isArray(value))
    return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value);
}
function digest(value) {
  return createHash4("sha256").update(value).digest("hex");
}
function directoryFilter(value) {
  return windows ? value?.replaceAll("\\", "/").replace(/^[a-z]:/i, (drive) => drive.toUpperCase()) : value;
}
function directoryExpression(expression) {
  if (!windows)
    return expression;
  const separators = `replace(${expression},char(92),'/')`;
  return `(CASE WHEN substr(${expression},1,1) GLOB '[A-Za-z]' AND substr(${expression},2,1)=':' THEN upper(substr(${expression},1,1))||substr(${separators},2) ELSE ${separators} END)`;
}
function storageError(e) {
  if (e instanceof ProgressError)
    return e;
  const err = e;
  if ([5, 6].includes(err?.errcode ?? 0) || /locked|busy/i.test(err?.message ?? ""))
    return new ProgressError("busy");
  if ([11, 26].includes(err?.errcode ?? 0) || /malformed|not a database/i.test(err?.message ?? ""))
    return new ProgressError("corrupt");
  return new ProgressError("storage");
}
var SCHEMA = `
CREATE TABLE meta(singleton INTEGER PRIMARY KEY CHECK(singleton=1), store_id TEXT NOT NULL UNIQUE, enabled INTEGER NOT NULL CHECK(enabled IN(0,1)), product TEXT NOT NULL CHECK(product='openchamber-agent-progress'));
CREATE TABLE sources(id TEXT PRIMARY KEY, config_root TEXT NOT NULL, data_root TEXT NOT NULL, verified INTEGER NOT NULL CHECK(verified IN(0,1)), UNIQUE(config_root,data_root));
CREATE TABLE plans(source TEXT NOT NULL REFERENCES sources(id), id TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>0), snapshot TEXT NOT NULL CHECK(json_valid(snapshot)), PRIMARY KEY(source,id));
CREATE TABLE revisions(source TEXT NOT NULL, plan TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>0), snapshot TEXT NOT NULL CHECK(json_valid(snapshot)), actor TEXT NOT NULL CHECK(json_valid(actor)), PRIMARY KEY(source,plan,revision), FOREIGN KEY(source,plan) REFERENCES plans(source,id));
CREATE TABLE receipts(source TEXT NOT NULL REFERENCES sources(id), plan TEXT NOT NULL, oid TEXT NOT NULL, payload_hash TEXT NOT NULL, receipt TEXT NOT NULL CHECK(json_valid(receipt)), PRIMARY KEY(source,plan,oid));
CREATE TABLE sessions(source TEXT NOT NULL REFERENCES sources(id), id TEXT NOT NULL, actor TEXT NOT NULL CHECK(json_valid(actor)), PRIMARY KEY(source,id));
CREATE TABLE chunks(source TEXT NOT NULL REFERENCES sources(id), plan TEXT NOT NULL, owner TEXT NOT NULL, upload TEXT NOT NULL, chunk INTEGER NOT NULL CHECK(chunk>=0 AND chunk<32), expected INTEGER NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload)), PRIMARY KEY(source,plan,owner,upload,chunk));
CREATE TABLE captures(id INTEGER PRIMARY KEY, source TEXT NOT NULL, plan TEXT NOT NULL, revision INTEGER NOT NULL, hash TEXT NOT NULL, text TEXT NOT NULL, captured_at TEXT NOT NULL, canonical_path TEXT NOT NULL);
CREATE TABLE contributions(source TEXT NOT NULL, plan TEXT NOT NULL, revision INTEGER NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload)), PRIMARY KEY(source,plan,revision), FOREIGN KEY(source,plan,revision) REFERENCES revisions(source,plan,revision));
PRAGMA user_version=2;`;

class Store {
  db;
  file;
  readOnly;
  readBinding = { sourceId: null, verified: false };
  constructor(file, options = {}) {
    this.file = file;
    this.readOnly = options.readOnly ?? false;
    const finish = beginPlatformSecurityScope();
    try {
      if (windows) {
        file = windowsPath(file, true);
        this.file = file;
      }
      requireProgress(path4.isAbsolute(file), "binding");
      const parent = lstatSync4(path4.dirname(file));
      requireProgress(parent.isDirectory() && !parent.isSymbolicLink() && (windows ? sameWindowsDirectory(windowsPath(path4.dirname(file)), path4.dirname(file)) : parent.uid === process.getuid?.() && realpathSync4(path4.dirname(file)) === path4.dirname(file) && (parent.mode & 511) === 448), "binding");
      const existed = existsSync3(file);
      requireProgress(existed || options.create && !options.readOnly, "not-found");
      if (windows) {
        const secured = [path4.dirname(file), file, ...["-journal", "-wal", "-shm"].map((s) => file + s)].filter(existsSync3);
        requireProgress(windowsPaths(secured).every((v, i) => sameWindowsObject(v, secured[i])) && privatePaths(secured), "binding");
      }
      if (existed) {
        const stat = lstatSync4(file);
        requireProgress(stat.isFile() && !stat.isSymbolicLink() && (windows || stat.uid === process.getuid?.() && (stat.mode & 511) === 384), "binding");
        const fd = openSync3(file, "r");
        const head2 = Buffer.alloc(16);
        try {
          readSync(fd, head2, 0, 16, 0);
        } finally {
          closeSync3(fd);
        }
        requireProgress(head2.toString("binary") === "SQLite format 3\x00", "corrupt");
      }
      this.db = new DatabaseSync2(file, { readOnly: options.readOnly ?? false });
      if (!existed) {
        if (windows)
          requireProgress(privatePaths([file]), "binding");
        else
          chmodSync(file, 384);
      }
      this.db.exec(`PRAGMA busy_timeout=${Math.max(0, Math.min(5000, options.busyMs ?? 1000))}; PRAGMA foreign_keys=ON;`);
      const version = Number(this.db.prepare("PRAGMA user_version").get().user_version);
      if (!existed) {
        this.db.exec("BEGIN IMMEDIATE");
        try {
          this.db.exec(SCHEMA);
          this.db.prepare("INSERT INTO meta VALUES(1,?,1,'openchamber-agent-progress')").run(randomUUID3());
          this.db.exec("COMMIT");
        } catch (e) {
          this.db.exec("ROLLBACK");
          throw e;
        }
      } else
        requireProgress(version === VERSION, "schema");
      requireProgress(this.db.prepare("PRAGMA table_info(meta)").all().some((r) => r.name === "product"), "corrupt");
      requireProgress(this.db.prepare("SELECT product FROM meta WHERE singleton=1").get()?.product === "openchamber-agent-progress", "corrupt");
    } catch (e) {
      this.db?.close();
      if (e instanceof PlatformError)
        throw e;
      throw storageError(e);
    } finally {
      finish();
    }
  }
  close() {
    this.db.close();
  }
  installSubagentRuns() {
    return this.transaction(true, () => installRuns(this.db));
  }
  subagentRunsAvailable() {
    return this.transaction(false, () => runsInstalled(this.db));
  }
  runControl() {
    return this.transaction(false, () => runControl(this.db));
  }
  runCaptureUnavailable() {
    return this.transaction(true, () => runCaptureUnavailable(this.db));
  }
  beforeRun(key, actor, tool, input, at) {
    return this.transaction(true, () => beforeRun(this.db, key, actor, tool, input, at));
  }
  afterRun(key, generation, child, disposition) {
    return this.transaction(true, () => {
      afterRun(this.db, key, generation, child, disposition);
      const i = reservedIntent(this.db, key);
      if (!i)
        return;
      if (!child || disposition !== "returned" || !this.runControlInTransaction(i.generation)) {
        settleIntent(this.db, i, undefined, "dispatch-unconfirmed");
        return;
      }
      this.db.exec("SAVEPOINT run_binding");
      try {
        requireProgress(i.caller.sourceId === key.source && i.caller.sessionId === key.parent, "binding");
        const stored = this.db.prepare("SELECT CASE WHEN length(CAST(actor AS BLOB))<=16384 THEN actor END AS actor FROM sessions WHERE source=? AND id=?").get(i.caller.sourceId, i.caller.sessionId);
        requireProgress(typeof stored?.actor === "string", "binding");
        const actor = JSON.parse(stored.actor);
        requireProgress(actor.sourceId === i.caller.sourceId && actor.sessionId === i.caller.sessionId, "binding");
        const at = this.db.prepare("SELECT json_extract(payload,'$.dispatch.at') AS at FROM runs_rows WHERE id=?").get(i.dispatch);
        requireProgress(Number.isSafeInteger(at?.at), "corrupt");
        const receipt = this.applyMutation({ op: "link", plan: i.request.plan, oid: i.bindOid, rev: i.request.rev, child: child.sessionId, assign: i.request.assign }, actor, undefined, child, { generation: this.delegationControl().generation, messageId: key.message, callId: key.call, observedAt: new Date(Number(at.at)).toISOString() });
        this.db.exec("RELEASE run_binding");
        settleIntent(this.db, i, receipt);
      } catch (e) {
        this.db.exec("ROLLBACK TO run_binding; RELEASE run_binding");
        settleIntent(this.db, i, undefined, storageError(e).code);
      }
    });
  }
  runControlInTransaction(generation) {
    const c = runControl(this.db);
    return c.enabled && c.generation === generation;
  }
  declareDelegation(value, actor) {
    const r = parseRequest(value);
    requireProgress(r.op === "delegate");
    return this.transaction(true, () => declareIntent(this.db, r, actor, () => this.validateDeclarationMutation(r, actor)));
  }
  handoff(value, actor, now = Date.now()) {
    const r = parseReportRequest(value);
    requireProgress(r.op === "handoff");
    requireProgress(this.readBinding.verified && this.readBinding.sourceId === actor.sourceId, "source-unverified");
    return this.transaction(true, () => handoff(this.db, r, actor, now));
  }
  observeExecution(event) {
    return this.transaction(true, () => observeExecution(this.db, event));
  }
  subagentRuns(request, now) {
    return this.transaction(false, () => readRuns(this.db, this.readBinding, request, now));
  }
  requestRunReconciliation(request) {
    return this.transaction(true, () => requestReconciliation(this.db, this.readBinding, request));
  }
  pendingRunRecovery(source) {
    return this.transaction(false, () => pendingRecovery(this.db, source));
  }
  pendingRunRecoveryAt(source, directory) {
    return this.transaction(false, () => pendingRecoveryAt(this.db, source, directory));
  }
  maintainRunRecovery(source, directory, producer, now = Date.now()) {
    return this.transaction(true, () => recoveryMaintenance(this.db, source, directory, producer, now));
  }
  runRecoveryWork(job) {
    return this.transaction(false, () => recoveryWork(this.db, job));
  }
  saveRunRecoveryWork(job, work) {
    return this.transaction(true, () => saveRecoveryWork(this.db, job, work));
  }
  claimRunRecovery(source, root) {
    return this.transaction(true, () => claimRecovery(this.db, source, root));
  }
  runRecoveryAlive(job) {
    return this.transaction(false, () => recoveryAlive(this.db, job));
  }
  publishRunHistory(job, session) {
    return this.transaction(true, () => publishHistory(this.db, job, session));
  }
  finishRunRecovery(job, state) {
    return this.transaction(true, () => finishRecovery(this.db, job, state));
  }
  documentCaptures(r, cursor) {
    return this.transaction(false, () => captureIndex(this.db, this.readBinding, r, cursor));
  }
  documentComparison(r, before, after) {
    return this.transaction(false, () => captureComparison(this.db, this.readBinding, r, before, after));
  }
  search(options = {}) {
    return this.transaction(false, () => searchWindow(this.db, this.readBinding, options));
  }
  searchState(storeId, keys) {
    return this.transaction(false, () => searchState(this.db, this.readBinding, storeId, keys));
  }
  resumePlans(request, options = {}) {
    return this.transaction(false, () => resumeSelection(this.db, this.readBinding, request, options.now));
  }
  observeLoaded(source, installId, fingerprint) {
    this.transaction(true, () => {
      this.db.exec("CREATE TABLE IF NOT EXISTS loaded_activation(source TEXT PRIMARY KEY REFERENCES sources(id), install_id TEXT NOT NULL, fingerprint TEXT NOT NULL)");
      this.db.prepare("INSERT INTO loaded_activation VALUES(?,?,?) ON CONFLICT(source) DO UPDATE SET install_id=excluded.install_id,fingerprint=excluded.fingerprint").run(source, installId, fingerprint);
    });
  }
  loadedFingerprint(source, installId) {
    return this.transaction(false, () => {
      if (!this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='loaded_activation'").get())
        return null;
      const row2 = this.db.prepare("SELECT fingerprint FROM loaded_activation WHERE source=? AND install_id=?").get(source, installId);
      return row2 ? String(row2.fingerprint) : null;
    });
  }
  bindReads(sourceId, verified) {
    const source = this.db.prepare("SELECT verified FROM sources WHERE id=?").get(sourceId);
    requireProgress(source, "binding");
    this.readBinding = { sourceId, verified: verified && Boolean(source.verified) };
  }
  transaction(write, action) {
    try {
      this.db.exec(write ? "BEGIN IMMEDIATE" : "BEGIN");
    } catch (e) {
      throw storageError(e);
    }
    try {
      requireProgress(Number(this.db.prepare("PRAGMA user_version").get().user_version) === VERSION, "schema");
      const value = action();
      this.db.exec("COMMIT");
      return value;
    } catch (e) {
      try {
        this.db.exec("ROLLBACK");
      } catch {}
      throw storageError(e);
    }
  }
  registerSource(source) {
    this.transaction(true, () => {
      const old = this.db.prepare("SELECT * FROM sources WHERE id=?").get(source.id);
      if (old)
        requireProgress(old.config_root === source.configRoot && old.data_root === source.dataRoot && Boolean(old.verified) === source.verified, "binding");
      else
        this.db.prepare("INSERT INTO sources VALUES(?,?,?,?)").run(source.id, source.configRoot, source.dataRoot, Number(source.verified));
    });
  }
  setEnabled(enabled) {
    this.transaction(true, () => {
      this.db.prepare("UPDATE meta SET enabled=? WHERE singleton=1").run(Number(enabled));
    });
  }
  installDelegationControl() {
    this.transaction(true, () => this.db.exec(`CREATE TABLE IF NOT EXISTS delegation_control(singleton INTEGER PRIMARY KEY CHECK(singleton=1), generation INTEGER NOT NULL);
      INSERT OR IGNORE INTO delegation_control VALUES(1,0);
      CREATE TRIGGER IF NOT EXISTS delegation_capture_epoch AFTER UPDATE OF enabled ON meta WHEN NEW.enabled != OLD.enabled
      BEGIN UPDATE delegation_control SET generation=generation+1 WHERE singleton=1; END;`));
  }
  delegationControl() {
    const row2 = this.db.prepare("SELECT enabled,generation FROM meta JOIN delegation_control USING(singleton)").get();
    return { enabled: row2.enabled === 1, generation: Number(row2.generation) };
  }
  validateDeclaration(value, actor) {
    const r = parseRequest(value);
    requireProgress(r.op === "delegate");
    return this.transaction(false, () => this.validateDeclarationMutation(r, actor));
  }
  validateDeclarationMutation(r, actor) {
    requireProgress(this.delegationControl().enabled, "disabled");
    const source = this.db.prepare("SELECT verified FROM sources WHERE id=?").get(actor.sourceId);
    requireProgress(actor.verifiedSource && source?.verified === 1 && this.readBinding.verified && this.readBinding.sourceId === actor.sourceId, "source-unverified");
    const state = cleanupInstalled(this.db) ? cleanupState(this.db, actor.sourceId, r.plan) : undefined;
    requireProgress(state?.state !== "deleted", "not-found");
    requireProgress(state?.state !== "archived", "closed");
    const p = this.raw(actor.sourceId, r.plan);
    requireProgress(p, "not-found");
    requireProgress(p.sessionId === actor.sessionId, "assignment");
    requireProgress(p.lifecycle === "active", "closed");
    requireProgress(p.revision === r.rev, "conflict", p.revision);
    assignmentIDs(p, r.assign);
    requireProgress(p.links.every((l) => l.itemIds.every((id) => !r.assign.includes(id))), "assignment");
    return this.delegationControl().generation;
  }
  raw(source, id) {
    const row2 = this.db.prepare("SELECT snapshot FROM plans WHERE source=? AND id=?").get(source, id);
    try {
      if (!row2)
        return;
      const p = JSON.parse(String(row2.snapshot));
      requireProgress(p.sourceId === source && p.id === id && Array.isArray(p.items) && Array.isArray(p.links), "corrupt");
      for (const item of p.items)
        if (!currentBinding(item.assignmentBinding, p, item.id))
          delete item.assignmentBinding;
      return p;
    } catch {
      throw new ProgressError("corrupt");
    }
  }
  get(source, id) {
    return this.transaction(false, () => this.raw(source, id));
  }
  cleanup(action, value) {
    requireProgress(!this.readOnly, "storage");
    try {
      return mutateCleanup(this.db, this.file, action, value, (write, fn) => this.transaction(write, fn));
    } catch (e) {
      throw storageError(e);
    }
  }
  summary(p) {
    const { items, links: _links, boundCanonicalPath: _bound, ...rest } = p;
    const state = cleanupInstalled(this.db) ? cleanupState(this.db, p.sourceId, p.id) : undefined;
    return { ...rest, ...state ? { cleanup: { state: state.state, revision: Number(state.generation) } } : {}, counts: countItems(items), working: items.filter((i) => i.kind === "task" && i.status === "working").map((i) => i.id) };
  }
  metadata() {
    const meta = this.db.prepare("SELECT * FROM meta WHERE singleton=1").get();
    const sources = this.db.prepare("SELECT * FROM sources ORDER BY id").all().map((r) => ({ id: String(r.id), configRoot: String(r.config_root), dataRoot: String(r.data_root), verified: Boolean(r.verified) }));
    return { protocolVersion: VERSION, schemaVersion: VERSION, storeId: String(meta.store_id), sources, sourceBinding: { ...this.readBinding }, captureEnabled: Boolean(meta.enabled), coverage: "recorded-only", diagnostics: [...!meta.enabled ? ["capture-disabled"] : [], ...sources.some((s) => !s.verified) ? ["source-unverified"] : [], ...!this.readBinding.verified ? ["host-source-binding-unverified"] : []] };
  }
  list(options = {}) {
    return this.transaction(false, () => {
      const limit = options.limit ?? LIMITS.pageSize;
      const cursor = options.cursor ?? 0;
      requireProgress(options.archived === undefined || options.archived === "exclude" || options.archived === "only");
      const installed = cleanupInstalled(this.db);
      const cleanupWhere = installed ? ` AND ${options.archived === "only" ? "" : "NOT "}EXISTS(SELECT 1 FROM cleanup_state cs WHERE cs.source=plans.source AND cs.plan=plans.id AND cs.state='archived')` : options.archived === "only" ? " AND 0" : "";
      requireProgress(Number.isSafeInteger(cursor) && cursor >= 0 && Number.isInteger(limit) && limit > 0 && limit <= LIMITS.maxPageSize);
      const where = ["(? IS NULL OR source=?)", `(? IS NULL OR json_extract(snapshot,'$.sessionId')=? OR EXISTS(SELECT 1 FROM json_each(plans.snapshot,'$.links') j WHERE json_extract(j.value,'$.sessionId')=?) OR EXISTS(SELECT 1 FROM contributions c WHERE c.source=plans.source AND c.plan=plans.id AND json_extract(c.payload,'$.attributedSessionId')=?))`, `(? IS NULL OR ${directoryExpression("json_extract(snapshot,'$.directory')")}=? OR EXISTS(SELECT 1 FROM sessions s WHERE s.source=plans.source AND ${directoryExpression("json_extract(s.actor,'$.directory')")}=? AND (s.id=json_extract(plans.snapshot,'$.sessionId') OR EXISTS(SELECT 1 FROM json_each(plans.snapshot,'$.links') j WHERE json_extract(j.value,'$.sessionId')=s.id) OR EXISTS(SELECT 1 FROM contributions c WHERE c.source=plans.source AND c.plan=plans.id AND json_extract(c.payload,'$.attributedSessionId')=s.id))))`].join(" AND ");
      const directory = directoryFilter(options.directory) ?? null;
      const rows = this.db.prepare(`SELECT snapshot FROM plans WHERE ${where}${cleanupWhere} ORDER BY source,id LIMIT ? OFFSET ?`).all(options.source ?? null, options.source ?? null, options.session ?? null, options.session ?? null, options.session ?? null, options.session ?? null, directory, directory, directory, limit + 1, cursor);
      const data = rows.slice(0, limit).map((r) => this.summary(JSON.parse(String(r.snapshot))));
      return { ...this.metadata(), data, nextCursor: rows.length > limit ? String(cursor + limit) : null };
    });
  }
  detail(source, id, page = 0) {
    return this.transaction(false, () => {
      requireProgress(Number.isSafeInteger(page) && page >= 0);
      const p = this.raw(source, id);
      requireProgress(p, "not-found");
      const start = page * LIMITS.pageSize;
      const rows = this.db.prepare("SELECT payload FROM contributions WHERE source=? AND plan=? ORDER BY revision LIMIT ? OFFSET ?").all(source, id, LIMITS.pageSize + 1, start);
      return {
        ...this.metadata(),
        plan: this.summary(p),
        links: p.links,
        items: { data: p.items.slice(start, start + LIMITS.pageSize).map((i) => {
          const { blocker, ...item } = i;
          return p.lifecycle === "active" && i.kind === "task" && i.status === "blocked" && validBlockerAnnotation(blocker, p.revision) ? { ...item, blocker } : item;
        }), nextCursor: p.items.length > start + LIMITS.pageSize ? String(page + 1) : null },
        contributions: { data: rows.slice(0, LIMITS.pageSize).map((r) => JSON.parse(String(r.payload))), nextCursor: rows.length > LIMITS.pageSize ? String(page + 1) : null }
      };
    });
  }
  document(source, id, cursor = 0, captureId) {
    return this.transaction(false, () => {
      requireProgress(Number.isSafeInteger(cursor) && cursor >= 0);
      const p = this.raw(source, id);
      requireProgress(p, "not-found");
      if (captureId !== undefined)
        requireProgress(Number.isSafeInteger(captureId) && captureId > 0);
      const chosen = captureId ?? p.document.captureId;
      const capture = chosen === undefined ? undefined : this.db.prepare("SELECT * FROM captures WHERE id=? AND source=? AND plan=?").get(chosen, source, id);
      if (captureId !== undefined)
        requireProgress(capture, "not-found");
      const historical = capture && chosen !== p.document.captureId;
      const envelope = this.metadata();
      if (historical)
        envelope.diagnostics.push("historical-capture");
      const document = historical ? { state: "captured", path: String(capture.canonical_path), canonicalPath: String(capture.canonical_path), captureId: Number(capture.id), hash: String(capture.hash), capturedAt: String(capture.captured_at), checklistSynchronized: false, currentFile: "not-rechecked" } : p.document;
      const chars = capture ? Array.from(String(capture.text)) : null;
      return { ...envelope, document, text: chars ? chars.slice(cursor, cursor + 16384).join("") : null, nextCursor: chars && chars.length > cursor + 16384 ? String(cursor + 16384) : null };
    });
  }
  history(source, id, cursor = 0, limit = LIMITS.pageSize) {
    return this.transaction(false, () => {
      requireProgress(Number.isSafeInteger(cursor) && cursor >= 0 && Number.isInteger(limit) && limit > 0 && limit <= LIMITS.maxPageSize);
      requireProgress(this.raw(source, id), "not-found");
      const rows = this.db.prepare("SELECT snapshot FROM revisions WHERE source=? AND plan=? ORDER BY revision LIMIT ? OFFSET ?").all(source, id, limit + 1, cursor);
      return { ...this.metadata(), data: rows.slice(0, limit).map((r) => {
        const p = JSON.parse(String(r.snapshot));
        return { revision: p.revision, structuralRevision: p.structuralRevision, lifecycle: p.lifecycle, reportedAt: p.reportedAt };
      }), nextCursor: rows.length > limit ? String(cursor + limit) : null };
    });
  }
  changeDigest(request) {
    const { source, plan, to, after, cleanupRev } = request;
    requireProgress(Number.isSafeInteger(to) && to > 0 && (after === undefined || Number.isSafeInteger(after) && after > 0 && after <= to) && Number.isSafeInteger(cleanupRev) && cleanupRev >= 0);
    return this.transaction(false, () => {
      const storeId = String(this.db.prepare("SELECT store_id FROM meta WHERE singleton=1").get().store_id);
      requireProgress(storeId === request.storeId, "conflict");
      const live = this.db.prepare("SELECT revision,json_extract(snapshot,'$.lifecycle') AS lifecycle,json_extract(snapshot,'$.id') AS id,json_extract(snapshot,'$.sourceId') AS sourceId,json_extract(snapshot,'$.revision') AS snapshotRevision FROM plans WHERE source=? AND id=?").get(source, plan);
      requireProgress(live, "not-found");
      requireProgress(live.id === plan && live.sourceId === source && live.snapshotRevision === live.revision && Number.isSafeInteger(live.revision) && Number(live.revision) > 0 && ["active", "finished", "cancelled", "failed"].includes(String(live.lifecycle)), "corrupt");
      const state = cleanupInstalled(this.db) ? cleanupState(this.db, source, plan) : undefined;
      requireProgress(state?.state !== "deleted", "not-found");
      const cleanup2 = { state: state?.state ?? "visible", revision: Number(state?.generation ?? 0) };
      requireProgress(cleanup2.revision === cleanupRev, "conflict");
      requireProgress(to <= Number(live.revision));
      const result = {
        protocolVersion: 2,
        schemaVersion: 2,
        storeId,
        sourceBinding: { ...this.readBinding },
        source,
        plan,
        cleanup: cleanup2,
        interval: { after: after ?? null, to, targetLifecycle: null, targetReportedAt: null, latestRevision: Number(live.revision), currentLifecycle: live.lifecycle, coverageStart: null, coverageEnd: null, coverageStartReportedAt: null, coverageEndReportedAt: null },
        availability: "target-unavailable",
        complete: false,
        reasons: [],
        validTarget: false,
        counts: { before: null, after: null, scope: null },
        summary: { unit: "transitions", events: emptyEvents() },
        tasks: [],
        details: { omittedTasks: false, omittedTaskCount: 0, truncated: false },
        work: { intervalSnapshots: 0, baselineLookups: 0, inputBytes: 0 }
      };
      const reason = (r) => {
        if (!result.reasons.includes(r))
          result.reasons.push(r);
      };
      const load = (revision, baseline2 = false) => {
        if (baseline2)
          result.work.baselineLookups++;
        else
          result.work.intervalSnapshots++;
        const remaining = DIGEST_LIMITS.bytes - result.work.inputBytes;
        const row2 = this.db.prepare("SELECT length(CAST(snapshot AS BLOB)) AS bytes,CASE WHEN length(CAST(snapshot AS BLOB))<=? THEN snapshot ELSE NULL END AS snapshot FROM revisions WHERE source=? AND plan=? AND revision=?").get(remaining, source, plan, revision);
        if (!row2) {
          reason("missing-snapshot");
          return null;
        }
        if (Number(row2.bytes) > remaining) {
          reason("byte-bound");
          return null;
        }
        result.work.inputBytes += Number(row2.bytes);
        let p = null;
        try {
          p = validateDigestSnapshot(JSON.parse(String(row2.snapshot)), source, plan, revision);
        } catch {}
        if (!p)
          reason("invalid-snapshot");
        return p;
      };
      const target = load(to);
      if (!target)
        return result;
      result.validTarget = true;
      result.interval.targetLifecycle = target.lifecycle;
      result.interval.targetReportedAt = target.reportedAt;
      result.interval.coverageStart = result.interval.coverageEnd = to;
      result.interval.coverageStartReportedAt = result.interval.coverageEndReportedAt = target.reportedAt;
      result.counts.after = countItems(target.items);
      if (after === undefined) {
        result.availability = "initial";
        result.complete = true;
        return result;
      }
      const baseline = after === to ? target : load(after, true);
      result.availability = baseline ? "comparison" : "baseline-unavailable";
      if (baseline)
        result.counts = endpointCounts(baseline, target);
      let newer = target;
      while (newer.revision > after) {
        if (result.work.intervalSnapshots >= DIGEST_LIMITS.snapshots) {
          reason("revision-bound");
          break;
        }
        const expected = newer.revision - 1;
        let older;
        if (expected === after) {
          result.work.intervalSnapshots++;
          older = baseline;
        } else
          older = load(expected);
        if (!older) {
          if (expected !== after)
            reason("gap");
          break;
        }
        if (older.reportedAt > newer.reportedAt || older.structuralRevision > newer.structuralRevision || newer.structuralRevision - older.structuralRevision > 1) {
          reason("invalid-snapshot");
          break;
        }
        aggregatePair(result, older, newer, target);
        newer = older;
        result.interval.coverageStart = older.revision;
        result.interval.coverageStartReportedAt = older.reportedAt;
      }
      result.complete = !!baseline && newer.revision === after;
      return capDigest(result);
    });
  }
  apply(value, actor, capture, child, binding) {
    return this.transaction(true, () => this.applyMutation(value, actor, capture, child, binding));
  }
  applyMutation(value, actor, capture, child, binding) {
    const r = parseRequest(value);
    requireProgress(r.op !== "read" && r.op !== "delegate");
    const hash3 = digest(canonical({ request: r, session: actor.sessionId, source: actor.sourceId, ...binding ? { binding } : {} }));
    const receiptStatement = this.db.prepare("INSERT INTO receipts VALUES(?,?,?,?,?)");
    return (() => {
      requireProgress(Boolean(this.db.prepare("SELECT enabled FROM meta WHERE singleton=1").get().enabled), "disabled");
      if (binding) {
        requireProgress(r.op === "link" && this.delegationControl().generation === binding.generation, "disabled");
        requireProgress(this.readBinding.verified && this.readBinding.sourceId === actor.sourceId, "source-unverified");
        requireProgress(child?.parentId === actor.sessionId && child.ancestry !== null && child.directory === actor.directory && child.projectId === actor.projectId, "assignment");
      }
      const cleanup2 = cleanupInstalled(this.db) ? cleanupState(this.db, actor.sourceId, r.plan) : undefined;
      requireProgress(cleanup2?.state !== "deleted", "not-found");
      requireProgress(cleanup2?.state !== "archived", "closed");
      const source = this.db.prepare("SELECT verified FROM sources WHERE id=?").get(actor.sourceId);
      requireProgress(source, "binding");
      const replay = this.db.prepare("SELECT * FROM receipts WHERE source=? AND plan=? AND oid=?").get(actor.sourceId, r.plan, r.oid);
      if (replay) {
        requireProgress(replay.payload_hash === hash3, "operation-reused");
        return JSON.parse(String(replay.receipt));
      }
      const previous = this.raw(actor.sourceId, r.plan);
      const revision = previous?.revision ?? 0;
      requireProgress(r.rev === revision, "conflict", revision);
      const coordinator = !previous || previous.sessionId === actor.sessionId;
      if (!coordinator)
        requireProgress(r.op === "change", "assignment");
      if (previous?.lifecycle !== undefined && previous.lifecycle !== "active")
        requireProgress(coordinator && ["revise", "commit", "stage"].includes(r.op) && r.reopen, "closed");
      const now = new Date().toISOString();
      if (r.op === "stage") {
        requireProgress(coordinator, "assignment");
        const old = this.db.prepare("SELECT payload,expected FROM chunks WHERE source=? AND plan=? AND owner=? AND upload=? AND chunk=?").get(actor.sourceId, r.plan, actor.sessionId, r.upload, r.chunk);
        if (old)
          requireProgress(String(old.payload) === canonical(r.items) && Number(old.expected) === revision, "operation-reused");
        else
          this.db.prepare("INSERT INTO chunks VALUES(?,?,?,?,?,?,?)").run(actor.sourceId, r.plan, actor.sessionId, r.upload, r.chunk, revision, canonical(r.items));
        return saveReceipt({ plan: r.plan, rev: revision, structuralRev: previous?.structuralRevision ?? 0, staged: r.chunk });
      }
      let items = r.items;
      if (r.op === "commit") {
        const chunks = this.db.prepare("SELECT chunk,payload,expected FROM chunks WHERE source=? AND plan=? AND owner=? AND upload=? ORDER BY chunk").all(actor.sourceId, r.plan, actor.sessionId, r.upload);
        requireProgress(chunks.length === r.chunks && chunks.every((c, i) => c.chunk === i && c.expected === revision), "stage-incomplete");
        items = chunks.flatMap((c) => JSON.parse(String(c.payload)));
      }
      if (!previous)
        requireProgress(["start", "commit"].includes(r.op) && !!r.title && !!items, "not-found");
      else
        requireProgress(r.op !== "start", "invalid");
      const p = previous ? structuredClone(previous) : { id: r.plan, sourceId: actor.sourceId, title: r.title, sessionId: actor.sessionId, revision: 0, structuralRevision: 0, lifecycle: "active", reportedAt: now, directory: actor.directory, projectId: actor.projectId, items: [], links: [], document: { state: "unbound", checklistSynchronized: false, currentFile: "not-rechecked" } };
      for (const item of p.items)
        if (previous?.lifecycle !== "active" || item.kind !== "task" || item.status !== "blocked" || !validBlockerAnnotation(item.blocker, revision))
          delete item.blocker;
      requireProgress(p.revision < Number.MAX_SAFE_INTEGER);
      p.revision++;
      const annotate = (item, input) => {
        if (input !== undefined) {
          requireProgress(item.kind === "task" && (input === null || item.status === "blocked" && validBlockerInput(input)));
          if (input === null)
            delete item.blocker;
          else
            item.blocker = { ...input, reportedRevision: p.revision, reportedAt: now, reporterSessionId: actor.sessionId, attributedSessionId: r.attributed ?? actor.sessionId, mode: r.attributed ? "parent-relay" : "direct", validAtRevision: p.revision };
        }
        if (item.kind !== "task" || item.status !== "blocked")
          delete item.blocker;
      };
      if (coordinator) {
        p.directory = actor.directory;
        p.projectId = actor.projectId;
      }
      if (!binding)
        p.reportedAt = now;
      const structural = ["start", "revise", "commit"].includes(r.op);
      if (structural) {
        p.structuralRevision++;
        if (r.title)
          p.title = r.title;
        if (r.reopen)
          p.lifecycle = "active";
        if (items) {
          requireProgress(items.length <= LIMITS.planItems);
          const old = new Map(p.items.map((i) => [i.id, i]));
          p.items = items.map((i) => {
            const { blocker, ...fields2 } = i;
            const retained = old.get(i.id);
            const item = { ...fields2, status: i.status ?? retained?.status ?? "pending", assigneeSessionId: i.kind === "task" ? retained?.assigneeSessionId : undefined, reporterSessionId: i.status !== undefined || !old.has(i.id) ? actor.sessionId : retained?.reporterSessionId };
            if (retained?.kind === "task" && retained.status === "blocked" && item.kind === "task" && item.status === "blocked" && retained.blocker)
              item.blocker = retained.blocker;
            if (retained?.kind === "task" && item.kind === "task" && retained.assignmentBinding)
              item.assignmentBinding = retained.assignmentBinding;
            annotate(item, blocker);
            return item;
          });
          validateItems(p.items);
          const ids = new Set(p.items.filter((i) => i.kind === "task").map((i) => i.id));
          p.links = p.links.map((l) => ({ ...l, itemIds: l.itemIds.filter((id) => ids.has(id)) })).filter((l) => l.itemIds.length > 0);
        }
      }
      let changed;
      if (r.op === "change") {
        const attributed = r.attributed ?? actor.sessionId;
        if (r.attributed)
          requireProgress(coordinator && r.attributed !== actor.sessionId, "assignment");
        if (!coordinator || r.attributed) {
          requireProgress(actor.verifiedSource && Boolean(source.verified), "source-unverified");
          const link = p.links.find((l) => l.sessionId === attributed);
          requireProgress(link && r.changes.every((c) => link.itemIds.includes(c.id)), "assignment");
          if (r.attributed)
            requireProgress(child?.sessionId === attributed && child.sourceId === actor.sourceId && child.verifiedSource && child.ancestry?.includes(p.sessionId), "assignment");
          else
            requireProgress(actor.ancestry?.includes(p.sessionId), "assignment");
        }
        requireProgress(new Set(r.changes.map((c) => c.id)).size === r.changes.length);
        for (const c of r.changes) {
          const item = p.items.find((i) => i.id === c.id);
          requireProgress(item?.kind === "task");
          item.status = c.status;
          item.reporterSessionId = actor.sessionId;
          annotate(item, c.blocker);
        }
        changed = r.changes.map((c) => c.id);
      }
      if (r.op === "link") {
        requireProgress(actor.verifiedSource && Boolean(source.verified), "source-unverified");
        requireProgress(child && child.sessionId === r.child && child.sourceId === actor.sourceId && child.verifiedSource && child.ancestry?.includes(actor.sessionId), "assignment");
        assignmentIDs(p, r.assign);
        const declared = [...r.assign];
        if (binding)
          r.assign = [...new Set([...p.links.find((l) => l.sessionId === r.child)?.itemIds ?? [], ...declared])];
        const other = p.links.filter((l) => l.sessionId !== r.child);
        requireProgress(other.every((l) => l.itemIds.every((id) => !r.assign.includes(id))), "assignment");
        p.links = [...other, ...r.assign.length ? [{ sessionId: r.child, itemIds: r.assign }] : []];
        requireProgress(p.links.length <= 64);
        for (const item of p.items) {
          if (item.assigneeSessionId === r.child)
            delete item.assigneeSessionId;
          if (r.assign.includes(item.id))
            item.assigneeSessionId = r.child;
        }
        for (const item of p.items) {
          if (!binding && (item.assignmentBinding?.childSessionId === r.child || r.assign.includes(item.id)))
            delete item.assignmentBinding;
          if (binding && declared.includes(item.id))
            item.assignmentBinding = { coordinatorSessionId: actor.sessionId, childSessionId: r.child, planId: p.id, itemId: item.id, tool: "subagent", messageId: binding.messageId, callId: binding.callId, observedAt: binding.observedAt, boundAt: now, boundRevision: p.revision, validAtRevision: p.revision };
        }
      }
      if (r.op === "finish") {
        if (r.outcome === "finished") {
          const counts = countItems(p.items);
          requireProgress(counts.total > 0 && counts.remaining === 0, "unfinished");
        }
        p.lifecycle = r.outcome;
      }
      if (r.op === "bind" || r.op === "start" && r.source) {
        requireProgress(capture && path4.isAbsolute(capture.path), "invalid");
        p.document = { ...p.document, path: capture.path, checklistSynchronized: false };
        p.boundCanonicalPath = capture.canonicalPath;
      }
      if (p.document.path && !binding) {
        requireProgress(capture?.path === p.document.path, "binding");
        const oldHash = p.document.hash;
        p.document.state = capture.state;
        p.document.checkedAt = capture.checkedAt;
        if (capture.state === "captured") {
          requireProgress(capture.text !== undefined && capture.hash === digest(capture.text) && !!capture.canonicalPath && Buffer.byteLength(capture.text) <= LIMITS.documentBytes);
          const unchanged = oldHash === capture.hash && p.document.canonicalPath === capture.canonicalPath && p.document.captureId !== undefined;
          const captureId = unchanged ? p.document.captureId : Number(this.db.prepare("INSERT INTO captures(source,plan,revision,hash,text,captured_at,canonical_path) VALUES(?,?,?,?,?,?,?)").run(actor.sourceId, r.plan, p.revision, capture.hash, capture.text, capture.checkedAt, capture.canonicalPath).lastInsertRowid);
          p.document = {
            ...p.document,
            captureId,
            hash: capture.hash,
            capturedAt: unchanged ? p.document.capturedAt : capture.checkedAt,
            canonicalPath: capture.canonicalPath,
            checklistSynchronized: structural && !!items || r.op === "bind" && r.confirm === true || oldHash === capture.hash && p.document.checklistSynchronized
          };
          p.boundCanonicalPath ??= capture.canonicalPath;
        } else
          p.document.checklistSynchronized = false;
      }
      for (const item of p.items) {
        if (item.assignmentBinding) {
          item.assignmentBinding.validAtRevision = p.revision;
          if (!currentBinding(item.assignmentBinding, p, item.id))
            delete item.assignmentBinding;
        }
        if (p.lifecycle !== "active" || item.kind !== "task" || item.status !== "blocked")
          delete item.blocker;
        else if (item.blocker)
          item.blocker.validAtRevision = p.revision;
      }
      const snapshot2 = JSON.stringify(p);
      this.db.prepare("INSERT INTO plans VALUES(?,?,?,?) ON CONFLICT(source,id) DO UPDATE SET revision=excluded.revision,snapshot=excluded.snapshot").run(actor.sourceId, r.plan, p.revision, snapshot2);
      this.db.prepare("INSERT INTO revisions VALUES(?,?,?,?,?)").run(actor.sourceId, r.plan, p.revision, snapshot2, JSON.stringify(actor));
      this.db.prepare("INSERT INTO sessions VALUES(?,?,?) ON CONFLICT(source,id) DO UPDATE SET actor=excluded.actor").run(actor.sourceId, actor.sessionId, JSON.stringify(actor));
      if (child)
        this.db.prepare("INSERT INTO sessions VALUES(?,?,?) ON CONFLICT(source,id) DO UPDATE SET actor=excluded.actor").run(actor.sourceId, child.sessionId, JSON.stringify(child));
      const contribution = { revision: p.revision, reporterSessionId: actor.sessionId, reporterAgent: actor.agent, attributedSessionId: r.attributed ?? actor.sessionId, mode: r.attributed ? "parent-relay" : "direct", itemIds: changed ?? [], reportedAt: now };
      this.db.prepare("INSERT INTO contributions VALUES(?,?,?,?)").run(actor.sourceId, r.plan, p.revision, JSON.stringify(contribution));
      return saveReceipt({ plan: r.plan, rev: p.revision, structuralRev: p.structuralRevision, ...changed ? { changed } : {} });
      function saveReceipt(receipt) {
        save2(receipt);
        return receipt;
      }
      function save2(receipt) {
        receiptStatement.run(actor.sourceId, r.plan, r.oid, hash3, JSON.stringify(receipt));
      }
    })();
  }
}
function assignmentIDs(p, ids) {
  requireProgress(new Set(ids).size === ids.length && ids.every((id) => p.items.some((i) => i.id === id && i.kind === "task")));
}
function validateItems(items) {
  const byId = new Map(items.map((i) => [i.id, i]));
  requireProgress(byId.size === items.length);
  for (const item of items) {
    if (item.parentId)
      requireProgress(byId.get(item.parentId)?.kind === "group");
    requireProgress((item.dependencies ?? []).every((id) => byId.get(id)?.kind === "task" && id !== item.id));
    const seen = new Set([item.id]);
    let parent = item.parentId;
    while (parent) {
      requireProgress(!seen.has(parent));
      seen.add(parent);
      parent = byId.get(parent)?.parentId;
    }
    if (item.kind === "task")
      requireProgress(!items.some((i) => i.parentId === item.id));
  }
  const visiting = new Set;
  const done = new Set;
  function visit(id) {
    if (done.has(id))
      return;
    requireProgress(!visiting.has(id));
    visiting.add(id);
    for (const next of byId.get(id)?.dependencies ?? [])
      visit(next);
    visiting.delete(id);
    done.add(id);
  }
  for (const i of items)
    visit(i.id);
}

// shared/activation.ts
function activationFingerprint(binding, plugin, guidance) {
  return digest(canonical({ binding, plugin: digest(plugin), guidance: digest(guidance) }));
}

// setup/lifecycle.ts
function normalizeTargets(targets) {
  if (windows)
    try {
      return platformSecurityScope(() => {
        const [configRoot, dataRoot, storeRoot] = windowsPaths([targets.configRoot, targets.dataRoot, targets.storeRoot, path5.join(targets.configRoot, "plugins", "agent-progress"), path5.join(targets.storeRoot, "payloads")], true);
        return { ...targets, configRoot, dataRoot, storeRoot };
      });
    } catch (e) {
      throw e instanceof PlatformError ? new SetupError(e.code) : e;
    }
  const trim = (value) => {
    const root = path5.parse(value).root;
    while (value.length > root.length && value.endsWith(path5.sep))
      value = value.slice(0, -1);
    return value;
  };
  return { ...targets, configRoot: trim(targets.configRoot), dataRoot: trim(targets.dataRoot), storeRoot: trim(targets.storeRoot) };
}

class SetupError extends Error {
  code;
  constructor(code) {
    super(code);
    this.code = code;
  }
}
function need(v, code) {
  if (!v)
    throw new SetupError(code);
}
function safe2(p, allowMissing = false) {
  if (windows) {
    try {
      windowsPath(p, allowMissing);
      return;
    } catch (e) {
      throw e instanceof PlatformError ? new SetupError(e.code) : e;
    }
  }
  need(path5.isAbsolute(p) && path5.resolve(p) === p, "path-unverified");
  let current = p;
  while (!existsSync4(current)) {
    need(allowMissing, "path-unverified");
    const parent = path5.dirname(current);
    need(parent !== current, "path-unverified");
    current = parent;
  }
  need(realpathSync5(current) === current && !lstatSync5(current).isSymbolicLink(), "symlink-escape");
}
function fsyncDir(dir) {
  syncDirectory(dir);
}
function atomic(file, content, stagingRoot) {
  if (windows)
    stagingRoot = path5.dirname(file);
  const tmp = path5.join(stagingRoot, `.agent-progress-activation-${randomUUID4()}`);
  try {
    writeFileSync(tmp, content, { mode: 384, flag: "wx" });
    syncFile(tmp);
    renameSync(tmp, file);
    fsyncDir(path5.dirname(file));
  } finally {
    if (existsSync4(tmp))
      rmSync(tmp);
  }
}
function writeFiles(root, files) {
  privateDirectory(root);
  for (const [name, body] of Object.entries(files)) {
    need(/^[A-Za-z0-9_.-]+$/.test(name), "payload-invalid");
    writeFileSync(path5.join(root, name), body, { mode: 384, flag: "wx" });
    syncFile(path5.join(root, name));
  }
  fsyncDir(root);
}
function hashes(files) {
  return Object.fromEntries(Object.entries(files).map(([name, body]) => [name, digest(body)]));
}
function releasePayload(binding, payload) {
  const files = { "index.js": payload.plugin, "SKILL.md": payload.guidance, "progress-binding.json": JSON.stringify({ ...binding, version: payload.version }) };
  const releaseHash = hashes(files);
  return { files, releaseHash, release: digest(canonical(releaseHash)) };
}
function versionParts(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([a-z0-9.-]+))?$/i.exec(version);
  return match ? { core: match.slice(1, 4).map(BigInt), pre: match[4]?.split(".") } : undefined;
}
function compareVersions(a, b) {
  const left = versionParts(a), right = versionParts(b);
  if (!left || !right)
    return;
  for (let i = 0;i < 3; i++)
    if (left.core[i] !== right.core[i])
      return left.core[i] > right.core[i] ? 1 : -1;
  if (!left.pre || !right.pre)
    return left.pre ? -1 : right.pre ? 1 : 0;
  for (let i = 0;i < Math.max(left.pre.length, right.pre.length); i++) {
    const x = left.pre[i], y = right.pre[i];
    if (x === y)
      continue;
    if (x === undefined)
      return -1;
    if (y === undefined)
      return 1;
    const xn = /^\d+$/.test(x), yn = /^\d+$/.test(y);
    if (xn && yn) {
      if (BigInt(x) !== BigInt(y))
        return BigInt(x) > BigInt(y) ? 1 : -1;
      continue;
    }
    if (xn !== yn)
      return xn ? -1 : 1;
    return x > y ? 1 : -1;
  }
  return 0;
}
function updatePreview(o, payload) {
  const comparison = compareVersions(payload.version, o.manifest.releases[o.manifest.active].version);
  if (comparison === undefined || !payload.plugin || !payload.guidance)
    return;
  const rootPackage = JSON.parse(readFileSync2(path5.join(o.root, "package.json"), "utf8"));
  return { state: releasePayload(o.binding, payload).release === o.manifest.active ? "current" : comparison < 0 ? "newer-installed" : "available", candidateVersion: payload.version, rootVersion: typeof rootPackage.version === "string" ? rootPackage.version : null };
}
function verifyFiles(root, expected, extras = []) {
  if (!windows)
    safe2(root);
  need(lstatSync5(root).isDirectory(), "collision");
  need(readdirSync(root).every((name) => Object.hasOwn(expected, name) || extras.includes(name)), "foreign-files");
  const files = Object.keys(expected).map((name) => path5.join(root, name));
  if (windows) {
    const extraFiles = extras.map((name) => path5.join(root, name)).filter(existsSync4), all = [root, ...files, ...extraFiles];
    need(windowsPaths(all).every((v, i) => sameWindowsObject(v, all[i])) && privatePaths(all) && extraFiles.every((p) => lstatSync5(p).isFile()), "modified-owned-files");
  }
  for (const [name, hash3] of Object.entries(expected)) {
    const file = path5.join(root, name);
    need(existsSync4(file), "modified-owned-files");
    if (!windows)
      safe2(file);
    const st = lstatSync5(file);
    need(st.isFile() && (windows || st.uid === process.getuid?.() && (st.mode & 511) === 384) && digest(readFileSync2(file)) === hash3, "modified-owned-files");
  }
}
function inspect(targets) {
  return platformSecurityScope(() => inspectInner(targets));
}
function inspectInner(targets) {
  targets = normalizeTargets(targets);
  safe2(targets.configRoot);
  safe2(targets.dataRoot);
  safe2(targets.storeRoot, true);
  for (const root of [targets.configRoot, targets.dataRoot])
    need(lstatSync5(root).isDirectory() && isOwned(root), "path-unverified");
  const packageRoot = path5.join(targets.configRoot, "plugins", "agent-progress");
  safe2(packageRoot, true);
  if (existsSync4(targets.storeRoot))
    need(lstatSync5(targets.storeRoot).isDirectory() && (windows ? privatePaths([targets.storeRoot]) : (lstatSync5(targets.storeRoot).mode & 511) === 448), "store-permissions");
  const payloadRoot = path5.join(targets.storeRoot, "payloads");
  safe2(payloadRoot, true);
  if (windows && existsSync4(payloadRoot))
    need(privatePaths([payloadRoot]), "store-permissions");
  if (windows) {
    const historyFile = path5.join(targets.storeRoot, "installation-history.jsonl");
    safe2(historyFile, true);
    if (existsSync4(historyFile))
      need(lstatSync5(historyFile).isFile() && privatePaths([historyFile]), "store-permissions");
  }
  return {
    targets,
    packageRoot,
    verified: targets.confirmed,
    installed: existsSync4(packageRoot),
    version: null,
    fingerprint: null,
    diagnostics: [],
    activation: "unknown",
    separateLifecycle: true,
    historyRetained: true,
    recovery: { stagedPackages: readdirSync(windows && existsSync4(path5.dirname(packageRoot)) ? path5.dirname(packageRoot) : targets.configRoot).filter((n) => n.startsWith(".agent-progress-stage-")).length, stagedActivations: readdirSync(windows && existsSync4(packageRoot) ? packageRoot : targets.configRoot).filter((n) => n.startsWith(".agent-progress-activation-")).length, stagedReleases: existsSync4(payloadRoot) ? readdirSync(payloadRoot).filter((n) => n.startsWith(".staged-")).length : 0 }
  };
}
function owned(targets) {
  const info = inspect(targets);
  need(info.installed, "not-installed");
  const manifestFile = path5.join(info.packageRoot, ".ownership.json");
  need(existsSync4(manifestFile), "collision");
  safe2(manifestFile);
  if (windows)
    need(privatePaths([info.packageRoot, manifestFile]), "ownership-invalid");
  let m;
  try {
    m = JSON.parse(readFileSync2(manifestFile, "utf8"));
  } catch {
    throw new SetupError("ownership-invalid");
  }
  need(m.product === "openchamber-agent-progress" && typeof m.installId === "string" && /^[a-f0-9]{64}$/.test(m.active) && m.releases?.[m.active], "collision");
  need(Object.keys(m.files).sort().join(",") === "SKILL.md,index.js,package.json,progress-binding.json,remove.js", "ownership-invalid");
  const staged = windows ? readdirSync(info.packageRoot).filter((n) => /^\.agent-progress-activation-[a-f0-9-]{36}$/.test(n)) : [];
  verifyFiles(info.packageRoot, m.files, [".ownership.json", ...staged]);
  const b = readBinding(path5.join(info.packageRoot, "progress-binding.json"));
  need(b.installId === m.installId && (windows ? sameWindowsDirectory(b.source.configRoot, targets.configRoot) && sameWindowsDirectory(b.source.dataRoot, targets.dataRoot) && sameWindowsDirectory(path5.dirname(b.database), targets.storeRoot) : b.source.configRoot === targets.configRoot && b.source.dataRoot === targets.dataRoot && path5.dirname(b.database) === targets.storeRoot), "ownership-invalid");
  for (const [id, release] of Object.entries(m.releases)) {
    need(/^[a-f0-9]{64}$/.test(id) && Object.keys(release.files).sort().join(",") === "SKILL.md,index.js,progress-binding.json", "ownership-invalid");
    verifyFiles(path5.join(targets.storeRoot, "payloads", id), release.files);
  }
  return { root: info.packageRoot, manifest: m, binding: b, staged };
}
function removableSelectors(o) {
  return o.staged.map((name) => {
    const file = path5.join(o.root, name);
    let m;
    try {
      m = JSON.parse(readFileSync2(file, "utf8"));
    } catch {
      throw new SetupError("staged-activation-retained");
    }
    need(m.product === o.manifest.product && m.installId === o.manifest.installId && canonical(m.files) === canonical(o.manifest.files) && /^[a-f0-9]{64}$/.test(m.active) && m.releases?.[m.active] && Object.entries(o.manifest.releases).every(([id, r]) => canonical(m.releases[id]) === canonical(r)), "staged-activation-retained");
    return file;
  });
}
function history(targets, event) {
  const file = path5.join(targets.storeRoot, "installation-history.jsonl");
  safe2(file, true);
  if (windows && existsSync4(file))
    need(privatePaths([file]), "store-permissions");
  appendFileSync(file, JSON.stringify(event) + `
`, { mode: 384 });
  syncFile(file);
}
function matchesRetainedSource(source, targets) {
  if (!windows)
    return source.configRoot === targets.configRoot && source.dataRoot === targets.dataRoot;
  try {
    return sameWindowsDirectory(source.configRoot, targets.configRoot) && sameWindowsDirectory(source.dataRoot, targets.dataRoot);
  } catch (e) {
    if (e instanceof PlatformError) {
      if (["path-unverified", "symlink-escape", "unsafe-parent"].includes(e.code))
        return false;
      throw e;
    }
    if (["ENOENT", "ENOTDIR", "EACCES", "EPERM", "ELOOP", "ENAMETOOLONG"].includes(e?.code ?? ""))
      return false;
    throw e;
  }
}
function lifecycle(action, targets, payload, testBoundary) {
  try {
    return platformSecurityScope(() => lifecycleInner(action, targets, payload, testBoundary));
  } catch (e) {
    throw e instanceof PlatformError ? new SetupError(e.code) : e;
  }
}
function lifecycleInner(action, targets, payload, testBoundary) {
  const info = inspect(targets);
  targets = info.targets;
  if (action === "inspect" || action === "dry-run") {
    const o = info.installed ? owned(targets) : undefined;
    const payloadRoot2 = path5.join(targets.storeRoot, "payloads");
    const unreferenced = existsSync4(payloadRoot2) && readdirSync(payloadRoot2).some((id) => {
      if (!/^[a-f0-9]{64}$/.test(id) || o?.manifest.releases[id])
        return false;
      try {
        safe2(path5.join(payloadRoot2, id));
        const b = readBinding(path5.join(payloadRoot2, id, "progress-binding.json"));
        return b.source.configRoot === targets.configRoot && b.source.dataRoot === targets.dataRoot;
      } catch {
        return !!o;
      }
    });
    const active = o ? path5.join(payloadRoot2, o.manifest.active) : undefined;
    const fingerprint = active ? activationFingerprint(readBinding(path5.join(active, "progress-binding.json")), readFileSync2(path5.join(active, "index.js")), readFileSync2(path5.join(active, "SKILL.md"))) : null;
    return { ...info, fingerprint, version: o ? o.manifest.releases[o.manifest.active].version : null, ...o && targets.confirmed && o.binding.source.verified && payload ? { update: updatePreview(o, payload) } : {}, action, writes: false, diagnostics: [...!targets.confirmed ? ["targets-unverified"] : [], ...o && Object.keys(o.manifest.releases).length > 1 ? ["rollback-payloads-retained"] : [], ...unreferenced ? ["unreferenced-payloads-retained"] : [], ...info.recovery.stagedPackages || info.recovery.stagedActivations || info.recovery.stagedReleases ? ["staged-payloads-present"] : []] };
  }
  need(targets.confirmed, "confirmation-required");
  if (action === "disable" || action === "enable" || action === "remove-capture") {
    const file = path5.join(targets.storeRoot, "progress.sqlite");
    need(existsSync4(file), "not-installed");
    const store2 = new Store(file);
    try {
      if (action === "remove-capture") {
        const controlBinding = readBinding(path5.join(info.packageRoot, "progress-binding.json"));
        need(windows ? sameWindowsObject(controlBinding.database, file) && sameWindowsDirectory(controlBinding.source.configRoot, targets.configRoot) && sameWindowsDirectory(controlBinding.source.dataRoot, targets.dataRoot) : controlBinding.database === file && controlBinding.source.configRoot === targets.configRoot && controlBinding.source.dataRoot === targets.dataRoot, "ownership-invalid");
        verifyStore(store2, controlBinding);
        store2.setEnabled(false);
        const o = owned(targets);
        verifyStore(store2, o.binding);
        const selectors = removableSelectors(o);
        for (const file2 of selectors)
          rmSync(file2);
        for (const name of Object.keys(o.manifest.files))
          rmSync(path5.join(o.root, name));
        rmSync(path5.join(o.root, ".ownership.json"));
        rmdirSync(o.root);
        fsyncDir(path5.dirname(o.root));
        history(targets, { action, at: new Date().toISOString(), installId: o.manifest.installId });
      } else {
        const o = owned(targets);
        verifyStore(store2, o.binding);
        store2.setEnabled(action === "enable");
        history(targets, { action, at: new Date().toISOString(), installId: o.manifest.installId });
      }
      return { ...info, action, writes: true, captureEnabled: action === "enable", activation: action === "remove-capture" ? "removed-reload-may-be-required" : "control-applies-to-loaded-instances", historyRetained: true };
    } finally {
      store2.close();
    }
  }
  need(action === "install" || action === "update", "action-invalid");
  need(payload && typeof payload.plugin === "string" && payload.plugin.length > 0 && payload.guidance.length > 0 && payload.removal.length > 0 && /^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i.test(payload.version), "payload-invalid");
  need(action === "update" ? info.installed : !info.installed, action === "update" ? "not-installed" : "collision");
  const old = info.installed ? owned(targets) : undefined;
  if (!existsSync4(targets.storeRoot))
    privateDirectory(targets.storeRoot, true);
  const store = new Store(path5.join(targets.storeRoot, "progress.sqlite"), { create: true });
  let binding;
  try {
    if (old) {
      binding = { ...old.binding, version: payload.version };
      verifyStore(store, binding);
    } else {
      const source = store.list({ limit: 1 }).sources.find((s) => matchesRetainedSource(s, targets)) ?? { id: randomUUID4(), configRoot: targets.configRoot, dataRoot: targets.dataRoot, verified: true };
      store.registerSource(source);
      binding = { protocolVersion: VERSION, schemaVersion: VERSION, installId: randomUUID4(), version: payload.version, database: store.file, storeId: store.list({ limit: 1 }).storeId, source };
    }
  } finally {
    store.close();
  }
  const { files, releaseHash, release } = releasePayload(binding, payload);
  const payloadRoot = path5.join(targets.storeRoot, "payloads");
  safe2(payloadRoot, true);
  privateDirectory(payloadRoot, true);
  const releaseRoot = path5.join(payloadRoot, release);
  if (existsSync4(releaseRoot))
    verifyFiles(releaseRoot, releaseHash);
  else {
    const stage = path5.join(payloadRoot, `.staged-${randomUUID4()}`);
    writeFiles(stage, files);
    testBoundary?.("release-staged");
    renameSync(stage, releaseRoot);
    fsyncDir(payloadRoot);
  }
  let manifest;
  if (old) {
    manifest = { ...old.manifest, active: release, releases: { ...old.manifest.releases, [release]: { version: payload.version, files: releaseHash } } };
  } else {
    const loader = `import{readFileSync,lstatSync,realpathSync}from'node:fs';import{createHash}from'node:crypto';import{pathToFileURL}from'node:url';import path from'node:path';function same(file){const a=lstatSync(file,{bigint:true}),b=lstatSync(realpathSync(file),{bigint:true});return a.nlink===1n&&a.ino!==0n&&a.dev===b.dev&&a.ino===b.ino;}export default{id:'agent-progress',async setup(ctx){const selector=new URL('./.ownership.json',import.meta.url);if(process.platform==='win32'&&lstatSync(selector,{bigint:true}).nlink>1n)throw new Error('agent-progress-installation-invalid');const m=JSON.parse(readFileSync(selector,'utf8'));if(m.product!=='openchamber-agent-progress'||m.installId!==${JSON.stringify(binding.installId)}||!/^[a-f0-9]{64}$/.test(m.active)||!m.releases[m.active])throw new Error('agent-progress-installation-invalid');const dir=path.join(${JSON.stringify(payloadRoot)},m.active);for(const[name,hash]of Object.entries(m.releases[m.active].files)){const file=path.join(dir,name);if(!/^[A-Za-z0-9_.-]+$/.test(name)||(process.platform==='win32'?!same(file):realpathSync(file)!==file)||!lstatSync(file).isFile()||createHash('sha256').update(readFileSync(file)).digest('hex')!==hash)throw new Error('agent-progress-payload-modified');}return(await import(pathToFileURL(path.join(dir,'index.js')).href)).default.setup(ctx);}};`;
    const rootFiles = { "index.js": loader, "package.json": JSON.stringify({ name: "openchamber-agent-progress", version: payload.version, type: "module", exports: { ".": "./index.js" } }), "progress-binding.json": JSON.stringify(binding), "remove.js": payload.removal, "SKILL.md": payload.guidance };
    manifest = { product: "openchamber-agent-progress", installId: binding.installId, active: release, files: hashes(rootFiles), releases: { [release]: { version: payload.version, files: releaseHash } } };
    const plugins = path5.dirname(info.packageRoot);
    safe2(plugins, true);
    if (windows && !existsSync4(plugins))
      privateDirectory(plugins, true);
    const stage = path5.join(windows ? plugins : targets.configRoot, `.agent-progress-stage-${randomUUID4()}`);
    writeFiles(stage, { ...rootFiles, ".ownership.json": JSON.stringify(manifest) });
    testBoundary?.("before-activation");
    if (!windows)
      mkdirSync2(plugins, { recursive: true, mode: 448 });
    need(!existsSync4(info.packageRoot), "collision");
    renameSync(stage, info.packageRoot);
    fsyncDir(plugins);
  }
  if (old) {
    testBoundary?.("before-activation");
    const current = owned(targets);
    need(canonical(current.manifest) === canonical(old.manifest), "installation-changed");
    atomic(path5.join(old.root, ".ownership.json"), JSON.stringify(manifest), targets.configRoot);
  }
  testBoundary?.("after-activation");
  history(targets, { action, at: new Date().toISOString(), installId: binding.installId, active: release, version: payload.version });
  return { ...info, installed: true, action, writes: true, activation: "reload-required", active: release, version: payload.version, historyRetained: true };
}

// shared/release.ts
var RELEASE = "0.5.0";

// setup/cli.ts
try {
  const action = process.argv[2];
  if (!["inspect", "dry-run", "install", "update", "disable", "enable", "remove-capture"].includes(action))
    throw new SetupError("action-invalid");
  const flags = new Map;
  for (const arg of process.argv.slice(3)) {
    const match = /^--(config-root|data-root|store-root|confirm)=(.+)$/.exec(arg);
    if (!match || flags.has(match[1]))
      throw new SetupError("arguments-invalid");
    flags.set(match[1], match[2]);
  }
  let targets;
  if (flags.size) {
    if (!flags.has("config-root") || !flags.has("data-root") || !flags.has("store-root"))
      throw new SetupError("targets-unverified");
    targets = { configRoot: flags.get("config-root"), dataRoot: flags.get("data-root"), storeRoot: flags.get("store-root"), confirmed: flags.get("confirm") === "true" };
  } else {
    const b = readBinding(new URL("./progress-binding.json", import.meta.url));
    targets = { configRoot: b.source.configRoot, dataRoot: b.source.dataRoot, storeRoot: path6.dirname(b.database), confirmed: true };
  }
  let payload;
  if (action === "install" || action === "update") {
    const dir = path6.dirname(fileURLToPath2(import.meta.url));
    payload = { plugin: readFileSync3(path6.join(dir, "../companion/index.js"), "utf8"), guidance: readFileSync3(path6.join(dir, "../companion/SKILL.md"), "utf8"), removal: readFileSync3(fileURLToPath2(import.meta.url), "utf8"), version: RELEASE };
  }
  console.log(JSON.stringify(lifecycle(action, targets, payload)));
} catch (e) {
  console.log(JSON.stringify({ error: e instanceof SetupError || e instanceof PlatformError ? e.code : "setup-unavailable" }));
  process.exitCode = 1;
}
