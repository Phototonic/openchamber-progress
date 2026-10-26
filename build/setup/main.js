// setup/cli.ts
import { readFileSync as readFileSync3 } from "node:fs";
import path5 from "node:path";
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
function identifier(value) {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/.test(value);
}
function parseRequest(value) {
  validRequest(value && typeof value === "object" && !Array.isArray(value), "request");
  const r = value;
  const fields = {
    start: ["title", "items", "source"],
    read: ["page"],
    change: ["changes", "attributed"],
    revise: ["title", "items", "reopen"],
    stage: ["upload", "chunk", "items", "reopen"],
    commit: ["upload", "chunks", "title", "reopen"],
    link: ["child", "assign"],
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
      validRequest(i && Object.keys(i).every((k) => ["id", "title", "kind", "status", "parentId", "dependencies"].includes(k)) && identifier(i.id) && typeof i.title === "string" && i.title.trim().length > 0 && i.title.length <= 512 && ["task", "group"].includes(i.kind), "items");
      if (i.status !== undefined)
        validRequest(["pending", "working", "blocked", "done", "skipped"].includes(i.status), "items");
      if (i.parentId !== undefined)
        validRequest(identifier(i.parentId), "items");
      if (i.dependencies !== undefined)
        validRequest(Array.isArray(i.dependencies) && i.dependencies.length <= 16 && i.dependencies.every(identifier), "items");
    }
  }
  if (r.changes !== undefined)
    requireProgress(Array.isArray(r.changes) && r.changes.length > 0 && r.changes.length <= 50 && r.changes.every((c) => c && Object.keys(c).every((k) => ["id", "status"].includes(k)) && identifier(c.id) && ["pending", "working", "blocked", "done", "skipped"].includes(c.status)));
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
  requireProgress(r.op !== "bind" || !!r.source);
  requireProgress(r.op !== "finish" || !!r.outcome);
  return JSON.parse(JSON.stringify(r));
}
var VALIDATION_HINTS = {
  request: "Send one request object.",
  op: "Use a supported op: start, read, change, revise, stage, commit, link, bind or finish.",
  plan: "Use one concrete plan identifier (1-80 letters, digits, _, ., : or -, starting with a letter or digit); read does not accept wildcards.",
  fields: "Remove unsupported fields for this op. Read accepts only op, plan and optional page; mutations also require oid and rev.",
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
import { randomUUID as randomUUID2 } from "node:crypto";
import { existsSync as existsSync3, lstatSync as lstatSync4, realpathSync as realpathSync4, mkdirSync as mkdirSync2, readFileSync as readFileSync2, readdirSync, writeFileSync, renameSync, rmSync, rmdirSync, appendFileSync } from "node:fs";
import path4 from "node:path";

// shared/store.ts
import { DatabaseSync } from "node:sqlite";
import { randomUUID, createHash } from "node:crypto";
import { existsSync as existsSync2, lstatSync as lstatSync3, openSync as openSync2, readSync, closeSync as closeSync2, realpathSync as realpathSync3, chmodSync } from "node:fs";
import path3 from "node:path";
function canonical(value) {
  if (Array.isArray(value))
    return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value);
}
function digest(value) {
  return createHash("sha256").update(value).digest("hex");
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
  readBinding = { sourceId: null, verified: false };
  constructor(file, options = {}) {
    this.file = file;
    const finish = beginPlatformSecurityScope();
    try {
      if (windows) {
        file = windowsPath(file, true);
        this.file = file;
      }
      requireProgress(path3.isAbsolute(file), "binding");
      const parent = lstatSync3(path3.dirname(file));
      requireProgress(parent.isDirectory() && !parent.isSymbolicLink() && (windows ? sameWindowsDirectory(windowsPath(path3.dirname(file)), path3.dirname(file)) : parent.uid === process.getuid?.() && realpathSync3(path3.dirname(file)) === path3.dirname(file) && (parent.mode & 511) === 448), "binding");
      const existed = existsSync2(file);
      requireProgress(existed || options.create && !options.readOnly, "not-found");
      if (windows) {
        const secured = [path3.dirname(file), file, ...["-journal", "-wal", "-shm"].map((s) => file + s)].filter(existsSync2);
        requireProgress(windowsPaths(secured).every((v, i) => sameWindowsObject(v, secured[i])) && privatePaths(secured), "binding");
      }
      if (existed) {
        const stat = lstatSync3(file);
        requireProgress(stat.isFile() && !stat.isSymbolicLink() && (windows || stat.uid === process.getuid?.() && (stat.mode & 511) === 384), "binding");
        const fd = openSync2(file, "r");
        const head = Buffer.alloc(16);
        try {
          readSync(fd, head, 0, 16, 0);
        } finally {
          closeSync2(fd);
        }
        requireProgress(head.toString("binary") === "SQLite format 3\x00", "corrupt");
      }
      this.db = new DatabaseSync(file, { readOnly: options.readOnly ?? false });
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
          this.db.prepare("INSERT INTO meta VALUES(1,?,1,'openchamber-agent-progress')").run(randomUUID());
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
      const row = this.db.prepare("SELECT fingerprint FROM loaded_activation WHERE source=? AND install_id=?").get(source, installId);
      return row ? String(row.fingerprint) : null;
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
  raw(source, id) {
    const row = this.db.prepare("SELECT snapshot FROM plans WHERE source=? AND id=?").get(source, id);
    try {
      if (!row)
        return;
      const p = JSON.parse(String(row.snapshot));
      requireProgress(p.sourceId === source && p.id === id && Array.isArray(p.items) && Array.isArray(p.links), "corrupt");
      return p;
    } catch {
      throw new ProgressError("corrupt");
    }
  }
  get(source, id) {
    return this.transaction(false, () => this.raw(source, id));
  }
  summary(p) {
    const { items, links: _links, boundCanonicalPath: _bound, ...rest } = p;
    return { ...rest, counts: countItems(items), working: items.filter((i) => i.kind === "task" && i.status === "working").map((i) => i.id) };
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
      requireProgress(Number.isSafeInteger(cursor) && cursor >= 0 && Number.isInteger(limit) && limit > 0 && limit <= LIMITS.maxPageSize);
      const where = ["(? IS NULL OR source=?)", `(? IS NULL OR json_extract(snapshot,'$.sessionId')=? OR EXISTS(SELECT 1 FROM json_each(plans.snapshot,'$.links') j WHERE json_extract(j.value,'$.sessionId')=?) OR EXISTS(SELECT 1 FROM contributions c WHERE c.source=plans.source AND c.plan=plans.id AND json_extract(c.payload,'$.attributedSessionId')=?))`, `(? IS NULL OR ${directoryExpression("json_extract(snapshot,'$.directory')")}=? OR EXISTS(SELECT 1 FROM sessions s WHERE s.source=plans.source AND ${directoryExpression("json_extract(s.actor,'$.directory')")}=? AND (s.id=json_extract(plans.snapshot,'$.sessionId') OR EXISTS(SELECT 1 FROM json_each(plans.snapshot,'$.links') j WHERE json_extract(j.value,'$.sessionId')=s.id) OR EXISTS(SELECT 1 FROM contributions c WHERE c.source=plans.source AND c.plan=plans.id AND json_extract(c.payload,'$.attributedSessionId')=s.id))))`].join(" AND ");
      const directory = directoryFilter(options.directory) ?? null;
      const rows = this.db.prepare(`SELECT snapshot FROM plans WHERE ${where} ORDER BY source,id LIMIT ? OFFSET ?`).all(options.source ?? null, options.source ?? null, options.session ?? null, options.session ?? null, options.session ?? null, options.session ?? null, directory, directory, directory, limit + 1, cursor);
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
        items: { data: p.items.slice(start, start + LIMITS.pageSize), nextCursor: p.items.length > start + LIMITS.pageSize ? String(page + 1) : null },
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
  apply(value, actor, capture, child) {
    const r = parseRequest(value);
    requireProgress(r.op !== "read");
    const hash = digest(canonical({ request: r, session: actor.sessionId, source: actor.sourceId }));
    const receiptStatement = this.db.prepare("INSERT INTO receipts VALUES(?,?,?,?,?)");
    return this.transaction(true, () => {
      requireProgress(Boolean(this.db.prepare("SELECT enabled FROM meta WHERE singleton=1").get().enabled), "disabled");
      const source = this.db.prepare("SELECT verified FROM sources WHERE id=?").get(actor.sourceId);
      requireProgress(source, "binding");
      const replay = this.db.prepare("SELECT * FROM receipts WHERE source=? AND plan=? AND oid=?").get(actor.sourceId, r.plan, r.oid);
      if (replay) {
        requireProgress(replay.payload_hash === hash, "operation-reused");
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
      requireProgress(p.revision < Number.MAX_SAFE_INTEGER);
      p.revision++;
      if (coordinator) {
        p.directory = actor.directory;
        p.projectId = actor.projectId;
      }
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
          p.items = items.map((i) => ({ ...i, status: i.status ?? old.get(i.id)?.status ?? "pending", assigneeSessionId: i.kind === "task" ? old.get(i.id)?.assigneeSessionId : undefined, reporterSessionId: i.status !== undefined || !old.has(i.id) ? actor.sessionId : old.get(i.id)?.reporterSessionId }));
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
        }
        changed = r.changes.map((c) => c.id);
      }
      if (r.op === "link") {
        requireProgress(actor.verifiedSource && Boolean(source.verified), "source-unverified");
        requireProgress(child && child.sessionId === r.child && child.sourceId === actor.sourceId && child.verifiedSource && child.ancestry?.includes(actor.sessionId), "assignment");
        requireProgress(new Set(r.assign).size === r.assign.length && r.assign.every((id) => p.items.some((i) => i.id === id && i.kind === "task")));
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
      }
      if (r.op === "finish") {
        if (r.outcome === "finished") {
          const counts = countItems(p.items);
          requireProgress(counts.total > 0 && counts.remaining === 0, "unfinished");
        }
        p.lifecycle = r.outcome;
      }
      if (r.op === "bind" || r.op === "start" && r.source) {
        requireProgress(capture && path3.isAbsolute(capture.path), "invalid");
        p.document = { ...p.document, path: capture.path, checklistSynchronized: false };
        p.boundCanonicalPath = capture.canonicalPath;
      }
      if (p.document.path) {
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
        save(receipt);
        return receipt;
      }
      function save(receipt) {
        receiptStatement.run(actor.sourceId, r.plan, r.oid, hash, JSON.stringify(receipt));
      }
    });
  }
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
        const [configRoot, dataRoot, storeRoot] = windowsPaths([targets.configRoot, targets.dataRoot, targets.storeRoot, path4.join(targets.configRoot, "plugins", "agent-progress"), path4.join(targets.storeRoot, "payloads")], true);
        return { ...targets, configRoot, dataRoot, storeRoot };
      });
    } catch (e) {
      throw e instanceof PlatformError ? new SetupError(e.code) : e;
    }
  const trim = (value) => {
    const root = path4.parse(value).root;
    while (value.length > root.length && value.endsWith(path4.sep))
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
function safe(p, allowMissing = false) {
  if (windows) {
    try {
      windowsPath(p, allowMissing);
      return;
    } catch (e) {
      throw e instanceof PlatformError ? new SetupError(e.code) : e;
    }
  }
  need(path4.isAbsolute(p) && path4.resolve(p) === p, "path-unverified");
  let current = p;
  while (!existsSync3(current)) {
    need(allowMissing, "path-unverified");
    const parent = path4.dirname(current);
    need(parent !== current, "path-unverified");
    current = parent;
  }
  need(realpathSync4(current) === current && !lstatSync4(current).isSymbolicLink(), "symlink-escape");
}
function fsyncDir(dir) {
  syncDirectory(dir);
}
function atomic(file, content, stagingRoot) {
  if (windows)
    stagingRoot = path4.dirname(file);
  const tmp = path4.join(stagingRoot, `.agent-progress-activation-${randomUUID2()}`);
  try {
    writeFileSync(tmp, content, { mode: 384, flag: "wx" });
    syncFile(tmp);
    renameSync(tmp, file);
    fsyncDir(path4.dirname(file));
  } finally {
    if (existsSync3(tmp))
      rmSync(tmp);
  }
}
function writeFiles(root, files) {
  privateDirectory(root);
  for (const [name, body] of Object.entries(files)) {
    need(/^[A-Za-z0-9_.-]+$/.test(name), "payload-invalid");
    writeFileSync(path4.join(root, name), body, { mode: 384, flag: "wx" });
    syncFile(path4.join(root, name));
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
  const rootPackage = JSON.parse(readFileSync2(path4.join(o.root, "package.json"), "utf8"));
  return { state: releasePayload(o.binding, payload).release === o.manifest.active ? "current" : comparison < 0 ? "newer-installed" : "available", candidateVersion: payload.version, rootVersion: typeof rootPackage.version === "string" ? rootPackage.version : null };
}
function verifyFiles(root, expected, extras = []) {
  if (!windows)
    safe(root);
  need(lstatSync4(root).isDirectory(), "collision");
  need(readdirSync(root).every((name) => Object.hasOwn(expected, name) || extras.includes(name)), "foreign-files");
  const files = Object.keys(expected).map((name) => path4.join(root, name));
  if (windows) {
    const extraFiles = extras.map((name) => path4.join(root, name)).filter(existsSync3), all = [root, ...files, ...extraFiles];
    need(windowsPaths(all).every((v, i) => sameWindowsObject(v, all[i])) && privatePaths(all) && extraFiles.every((p) => lstatSync4(p).isFile()), "modified-owned-files");
  }
  for (const [name, hash] of Object.entries(expected)) {
    const file = path4.join(root, name);
    need(existsSync3(file), "modified-owned-files");
    if (!windows)
      safe(file);
    const st = lstatSync4(file);
    need(st.isFile() && (windows || st.uid === process.getuid?.() && (st.mode & 511) === 384) && digest(readFileSync2(file)) === hash, "modified-owned-files");
  }
}
function inspect(targets) {
  return platformSecurityScope(() => inspectInner(targets));
}
function inspectInner(targets) {
  targets = normalizeTargets(targets);
  safe(targets.configRoot);
  safe(targets.dataRoot);
  safe(targets.storeRoot, true);
  for (const root of [targets.configRoot, targets.dataRoot])
    need(lstatSync4(root).isDirectory() && isOwned(root), "path-unverified");
  const packageRoot = path4.join(targets.configRoot, "plugins", "agent-progress");
  safe(packageRoot, true);
  if (existsSync3(targets.storeRoot))
    need(lstatSync4(targets.storeRoot).isDirectory() && (windows ? privatePaths([targets.storeRoot]) : (lstatSync4(targets.storeRoot).mode & 511) === 448), "store-permissions");
  const payloadRoot = path4.join(targets.storeRoot, "payloads");
  safe(payloadRoot, true);
  if (windows && existsSync3(payloadRoot))
    need(privatePaths([payloadRoot]), "store-permissions");
  if (windows) {
    const historyFile = path4.join(targets.storeRoot, "installation-history.jsonl");
    safe(historyFile, true);
    if (existsSync3(historyFile))
      need(lstatSync4(historyFile).isFile() && privatePaths([historyFile]), "store-permissions");
  }
  return {
    targets,
    packageRoot,
    verified: targets.confirmed,
    installed: existsSync3(packageRoot),
    version: null,
    fingerprint: null,
    diagnostics: [],
    activation: "unknown",
    separateLifecycle: true,
    historyRetained: true,
    recovery: { stagedPackages: readdirSync(windows && existsSync3(path4.dirname(packageRoot)) ? path4.dirname(packageRoot) : targets.configRoot).filter((n) => n.startsWith(".agent-progress-stage-")).length, stagedActivations: readdirSync(windows && existsSync3(packageRoot) ? packageRoot : targets.configRoot).filter((n) => n.startsWith(".agent-progress-activation-")).length, stagedReleases: existsSync3(payloadRoot) ? readdirSync(payloadRoot).filter((n) => n.startsWith(".staged-")).length : 0 }
  };
}
function owned(targets) {
  const info = inspect(targets);
  need(info.installed, "not-installed");
  const manifestFile = path4.join(info.packageRoot, ".ownership.json");
  need(existsSync3(manifestFile), "collision");
  safe(manifestFile);
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
  const b = readBinding(path4.join(info.packageRoot, "progress-binding.json"));
  need(b.installId === m.installId && (windows ? sameWindowsDirectory(b.source.configRoot, targets.configRoot) && sameWindowsDirectory(b.source.dataRoot, targets.dataRoot) && sameWindowsDirectory(path4.dirname(b.database), targets.storeRoot) : b.source.configRoot === targets.configRoot && b.source.dataRoot === targets.dataRoot && path4.dirname(b.database) === targets.storeRoot), "ownership-invalid");
  for (const [id, release] of Object.entries(m.releases)) {
    need(/^[a-f0-9]{64}$/.test(id) && Object.keys(release.files).sort().join(",") === "SKILL.md,index.js,progress-binding.json", "ownership-invalid");
    verifyFiles(path4.join(targets.storeRoot, "payloads", id), release.files);
  }
  return { root: info.packageRoot, manifest: m, binding: b, staged };
}
function removableSelectors(o) {
  return o.staged.map((name) => {
    const file = path4.join(o.root, name);
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
  const file = path4.join(targets.storeRoot, "installation-history.jsonl");
  safe(file, true);
  if (windows && existsSync3(file))
    need(privatePaths([file]), "store-permissions");
  appendFileSync(file, JSON.stringify(event) + `
`, { mode: 384 });
  syncFile(file);
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
    const payloadRoot2 = path4.join(targets.storeRoot, "payloads");
    const unreferenced = existsSync3(payloadRoot2) && readdirSync(payloadRoot2).some((id) => {
      if (!/^[a-f0-9]{64}$/.test(id) || o?.manifest.releases[id])
        return false;
      try {
        safe(path4.join(payloadRoot2, id));
        const b = readBinding(path4.join(payloadRoot2, id, "progress-binding.json"));
        return b.source.configRoot === targets.configRoot && b.source.dataRoot === targets.dataRoot;
      } catch {
        return !!o;
      }
    });
    const active = o ? path4.join(payloadRoot2, o.manifest.active) : undefined;
    const fingerprint = active ? activationFingerprint(readBinding(path4.join(active, "progress-binding.json")), readFileSync2(path4.join(active, "index.js")), readFileSync2(path4.join(active, "SKILL.md"))) : null;
    return { ...info, fingerprint, version: o ? o.manifest.releases[o.manifest.active].version : null, ...o && targets.confirmed && o.binding.source.verified && payload ? { update: updatePreview(o, payload) } : {}, action, writes: false, diagnostics: [...!targets.confirmed ? ["targets-unverified"] : [], ...o && Object.keys(o.manifest.releases).length > 1 ? ["rollback-payloads-retained"] : [], ...unreferenced ? ["unreferenced-payloads-retained"] : [], ...info.recovery.stagedPackages || info.recovery.stagedActivations || info.recovery.stagedReleases ? ["staged-payloads-present"] : []] };
  }
  need(targets.confirmed, "confirmation-required");
  if (action === "disable" || action === "enable" || action === "remove-capture") {
    const file = path4.join(targets.storeRoot, "progress.sqlite");
    need(existsSync3(file), "not-installed");
    const store2 = new Store(file);
    try {
      if (action === "remove-capture") {
        const controlBinding = readBinding(path4.join(info.packageRoot, "progress-binding.json"));
        need(windows ? sameWindowsObject(controlBinding.database, file) && sameWindowsDirectory(controlBinding.source.configRoot, targets.configRoot) && sameWindowsDirectory(controlBinding.source.dataRoot, targets.dataRoot) : controlBinding.database === file && controlBinding.source.configRoot === targets.configRoot && controlBinding.source.dataRoot === targets.dataRoot, "ownership-invalid");
        verifyStore(store2, controlBinding);
        store2.setEnabled(false);
        const o = owned(targets);
        verifyStore(store2, o.binding);
        const selectors = removableSelectors(o);
        for (const file2 of selectors)
          rmSync(file2);
        for (const name of Object.keys(o.manifest.files))
          rmSync(path4.join(o.root, name));
        rmSync(path4.join(o.root, ".ownership.json"));
        rmdirSync(o.root);
        fsyncDir(path4.dirname(o.root));
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
  if (!existsSync3(targets.storeRoot))
    privateDirectory(targets.storeRoot, true);
  const store = new Store(path4.join(targets.storeRoot, "progress.sqlite"), { create: true });
  let binding;
  try {
    if (old) {
      binding = { ...old.binding, version: payload.version };
      verifyStore(store, binding);
    } else {
      const source = store.list({ limit: 1 }).sources.find((s) => windows ? sameWindowsDirectory(s.configRoot, targets.configRoot) && sameWindowsDirectory(s.dataRoot, targets.dataRoot) : s.configRoot === targets.configRoot && s.dataRoot === targets.dataRoot) ?? { id: randomUUID2(), configRoot: targets.configRoot, dataRoot: targets.dataRoot, verified: true };
      store.registerSource(source);
      binding = { protocolVersion: VERSION, schemaVersion: VERSION, installId: randomUUID2(), version: payload.version, database: store.file, storeId: store.list({ limit: 1 }).storeId, source };
    }
  } finally {
    store.close();
  }
  const { files, releaseHash, release } = releasePayload(binding, payload);
  const payloadRoot = path4.join(targets.storeRoot, "payloads");
  safe(payloadRoot, true);
  privateDirectory(payloadRoot, true);
  const releaseRoot = path4.join(payloadRoot, release);
  if (existsSync3(releaseRoot))
    verifyFiles(releaseRoot, releaseHash);
  else {
    const stage = path4.join(payloadRoot, `.staged-${randomUUID2()}`);
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
    const plugins = path4.dirname(info.packageRoot);
    safe(plugins, true);
    if (windows && !existsSync3(plugins))
      privateDirectory(plugins, true);
    const stage = path4.join(windows ? plugins : targets.configRoot, `.agent-progress-stage-${randomUUID2()}`);
    writeFiles(stage, { ...rootFiles, ".ownership.json": JSON.stringify(manifest) });
    testBoundary?.("before-activation");
    if (!windows)
      mkdirSync2(plugins, { recursive: true, mode: 448 });
    need(!existsSync3(info.packageRoot), "collision");
    renameSync(stage, info.packageRoot);
    fsyncDir(plugins);
  }
  if (old) {
    testBoundary?.("before-activation");
    const current = owned(targets);
    need(canonical(current.manifest) === canonical(old.manifest), "installation-changed");
    atomic(path4.join(old.root, ".ownership.json"), JSON.stringify(manifest), targets.configRoot);
  }
  testBoundary?.("after-activation");
  history(targets, { action, at: new Date().toISOString(), installId: binding.installId, active: release, version: payload.version });
  return { ...info, installed: true, action, writes: true, activation: "reload-required", active: release, version: payload.version, historyRetained: true };
}

// shared/release.ts
var RELEASE = "0.2.7";

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
    targets = { configRoot: b.source.configRoot, dataRoot: b.source.dataRoot, storeRoot: path5.dirname(b.database), confirmed: true };
  }
  let payload;
  if (action === "install" || action === "update") {
    const dir = path5.dirname(fileURLToPath2(import.meta.url));
    payload = { plugin: readFileSync3(path5.join(dir, "../companion/index.js"), "utf8"), guidance: readFileSync3(path5.join(dir, "../companion/SKILL.md"), "utf8"), removal: readFileSync3(fileURLToPath2(import.meta.url), "utf8"), version: RELEASE };
  }
  console.log(JSON.stringify(lifecycle(action, targets, payload)));
} catch (e) {
  console.log(JSON.stringify({ error: e instanceof SetupError || e instanceof PlatformError ? e.code : "setup-unavailable" }));
  process.exitCode = 1;
}
