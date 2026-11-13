import { lstatSync, realpathSync, readFileSync, writeFileSync, linkSync, unlinkSync, renameSync } from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { readBinding, type Binding } from './binding.ts';
import type { ManagedSetupErrorCode } from './progress.ts';
import { windows, windowsPath, privatePaths, privateDirectory, isOwned, platformSecurityScope, syncFile, syncDirectory } from './platform.ts';

export class ManagedBindingError extends Error {
  readonly code: ManagedSetupErrorCode;
  constructor(code: ManagedSetupErrorCode = 'managed-binding-invalid') { super(code); this.code = code; }
}
function need(value: unknown, code?: ManagedSetupErrorCode): asserts value { if (!value) throw new ManagedBindingError(code); }
const markerText = '{"product":"openchamber-agent-progress-managed","format":1}';
/** Validate syntax and every existing ancestor, including dangling links. Never creates. */
export function managedPath(value: string, missing = false): string {
  if (windows) return windowsPath(value, missing);
  need(value.length <= 4096 && !value.includes('\0') && path.isAbsolute(value) && path.resolve(value) === value, 'managed-path-unverified');
  let current = value;
  while (!lstatSync(current, { throwIfNoEntry: false })) {
    need(missing, 'managed-path-unverified');
    const parent = path.dirname(current); need(parent !== current, 'managed-path-unverified'); current = parent;
  }
  need(realpathSync(current) === current && !lstatSync(current).isSymbolicLink(), 'managed-path-unverified');
  return value;
}
/** The service's observation is not proof of an active runtime's scope. Each consumer verifies independently. */
export function managedSourceRoots(env: NodeJS.ProcessEnv = process.env) {
  return platformSecurityScope(() => {
    need(!env.OPENCODE_DB && !env.OPENCODE_CONFIG_DIR, 'managed-scope-unsupported');
    const home = () => managedPath(env.HOME ?? homedir(), true);
    const base = (key: 'XDG_DATA_HOME' | 'XDG_CONFIG_HOME', fallback: string) =>
      managedPath(env[key] !== undefined ? env[key]! : path.join(home(), fallback), true);
    return { configRoot: managedPath(path.join(base('XDG_CONFIG_HOME', '.config'), 'opencode'), true),
      dataRoot: managedPath(path.join(base('XDG_DATA_HOME', '.local/share'), 'opencode'), true) };
  });
}
/** Sole managed discovery path. State roots, overrides and package siblings are deliberately ignored. */
export function managedBindingFile(env: NodeJS.ProcessEnv = process.env): string {
  return platformSecurityScope(() => {
    const { dataRoot } = managedSourceRoots(env);
    const root = managedPath(path.join(dataRoot, 'agent-progress-managed'), true);
    const stat = lstatSync(root, { throwIfNoEntry: false });
    if (stat) {
      need(stat.isDirectory() && privatePaths([root]));
      const marker = path.join(root, '.ownership.json');
      const m = lstatSync(marker, { throwIfNoEntry: false });
      need(m?.isFile() && !m.isSymbolicLink() && privatePaths([marker]) && readFileSync(marker, 'utf8') === markerText);
    }
    return path.join(root, 'progress-binding.json');
  });
}
export function readManagedBinding(env: NodeJS.ProcessEnv = process.env): Binding | undefined {
  return platformSecurityScope(() => readManagedBindingInner(env));
}
function readManagedBindingInner(env: NodeJS.ProcessEnv): Binding | undefined {
  const file = managedBindingFile(env);
  if (!lstatSync(file, { throwIfNoEntry: false })) return undefined;
  let binding: Binding;
  try { binding = readBinding(file); } catch (e) { if (e instanceof SyntaxError) throw new ManagedBindingError(); throw e; }
  const roots = managedSourceRoots(env);
  need(binding.source.configRoot === roots.configRoot && binding.source.dataRoot === roots.dataRoot);
  need(![roots.configRoot, roots.dataRoot, path.dirname(file)].includes(path.dirname(binding.database)));
  need([roots.configRoot, roots.dataRoot].every(root => lstatSync(root).isDirectory() && isOwned(root)));
  return binding;
}
/** Confirmed mutation only. Existing partial/foreign directories are never repaired. */
export function createManagedBindingDirectory(env: NodeJS.ProcessEnv = process.env) {
  return platformSecurityScope(() => {
    const file = managedBindingFile(env), root = path.dirname(file), { dataRoot } = managedSourceRoots(env);
    need(lstatSync(dataRoot).isDirectory() && isOwned(dataRoot));
    if (!lstatSync(root, { throwIfNoEntry: false })) {
      privateDirectory(root);
      const marker = path.join(root, '.ownership.json');
      writeFileSync(marker, markerText, { mode: 0o600, flag: 'wx' });
      syncFile(marker); syncDirectory(root); syncDirectory(dataRoot);
    }
    managedBindingFile(env);
    return file;
  });
}
/** Atomic publication; absent selectors use no-clobber publication, not replacement. */
export function publishPrivateJson(file: string, value: unknown, replace = false) {
  const stage = `${file}.stage-${randomUUID()}`;
  try {
    writeFileSync(stage, JSON.stringify(value), { mode: 0o600, flag: 'wx' }); syncFile(stage);
    if (replace) renameSync(stage, file);
    else { linkSync(stage, file); unlinkSync(stage); }
    syncDirectory(path.dirname(file));
  } finally { if (lstatSync(stage, { throwIfNoEntry: false })) unlinkSync(stage); }
}

export interface ManagedExpectation {
  format: 1; storeId: string; sourceId: string; installId: string; version: string; fingerprint: string;
}
export function managedExpectationFile(binding: Binding) {
  const identity = createHash('sha256').update(JSON.stringify([binding.source.id, binding.installId])).digest('hex');
  return path.join(path.dirname(binding.database), `managed-expectation-${identity}.json`);
}
/** Missing/unreadable expectation is an unknown observation, never a matching load. */
export function readManagedExpectation(binding: Binding): ManagedExpectation | undefined {
  const file = managedExpectationFile(binding);
  if (!lstatSync(file, { throwIfNoEntry: false })) return undefined;
  managedPath(file);
  const stat = lstatSync(file); need(stat.isFile() && !stat.isSymbolicLink() && privatePaths([path.dirname(file), file]));
  const e = JSON.parse(readFileSync(file, 'utf8')) as ManagedExpectation;
  need(e.format === 1 && e.storeId === binding.storeId && e.sourceId === binding.source.id && e.installId === binding.installId &&
    typeof e.version === 'string' && /^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i.test(e.version) && /^[a-f0-9]{64}$/.test(e.fingerprint));
  return e;
}
export function writeManagedExpectation(binding: Binding, expectation: ManagedExpectation) {
  const file = managedExpectationFile(binding);
  const prior = readManagedExpectation(binding); // invalid private state is never overwritten
  publishPrivateJson(file, expectation, !!prior);
}
