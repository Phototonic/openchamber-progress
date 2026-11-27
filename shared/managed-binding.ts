import { closeSync, constants, fstatSync, fsyncSync, lstatSync, openSync, readSync, realpathSync, readFileSync, writeFileSync, linkSync, unlinkSync, renameSync, type BigIntStats } from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { readBinding, type Binding } from './binding.ts';
import type { ManagedSetupErrorCode } from './progress.ts';
import { windows, windowsPath, windowsPaths, privatePaths, privateDirectory, isOwned, syncFile, syncDirectory, requirePlatformWriteBoundary, PlatformError } from './platform.ts';

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
  need(!env.OPENCODE_DB && !env.OPENCODE_CONFIG_DIR, 'managed-scope-unsupported');
  if(windows){
    const home=env.HOME??homedir();
    const config=env.XDG_CONFIG_HOME??path.join(home,'.config'),data=env.XDG_DATA_HOME??path.join(home,'.local/share');
    // Validate the raw inputs too: joining first must not normalize away unsafe
    // syntax. All known roots/ancestors share one query and one bounded scope.
    const inputs=[...(env.XDG_CONFIG_HOME===undefined||env.XDG_DATA_HOME===undefined?[home]:[]),config,data];
    const roots=windowsPaths([...inputs,path.join(config,'opencode'),path.join(data,'opencode')],true);
    return {configRoot:roots[inputs.length]!,dataRoot:roots[inputs.length+1]!};
  }
  const home = () => managedPath(env.HOME ?? homedir(), true);
  const base = (key: 'XDG_DATA_HOME' | 'XDG_CONFIG_HOME', fallback: string) =>
    managedPath(env[key] !== undefined ? env[key]! : path.join(home(), fallback), true);
  return { configRoot: managedPath(path.join(base('XDG_CONFIG_HOME', '.config'), 'opencode'), true),
    dataRoot: managedPath(path.join(base('XDG_DATA_HOME', '.local/share'), 'opencode'), true) };
}
/** Sole managed discovery path. State roots, overrides and package siblings are deliberately ignored. */
export function managedBindingFile(env: NodeJS.ProcessEnv = process.env): string {
  const { dataRoot } = managedSourceRoots(env);
  const proposed=path.join(dataRoot,'agent-progress-managed');
  const root = windows?windowsPaths([proposed,path.join(proposed,'.ownership.json'),path.join(proposed,'progress-binding.json')],true)[0]!:managedPath(proposed,true);
  const stat = lstatSync(root, { throwIfNoEntry: false });
  if (stat) {
    need(stat.isDirectory() && privatePaths([root]));
    const marker = path.join(root, '.ownership.json');
    const m = lstatSync(marker, { throwIfNoEntry: false });
    need(m?.isFile() && !m.isSymbolicLink() && m.size===Buffer.byteLength(markerText) && privatePaths([marker]) && readFileSync(marker, 'utf8') === markerText);
  }
  return path.join(root, 'progress-binding.json');
}
export function readManagedBinding(env: NodeJS.ProcessEnv = process.env): Binding | undefined {
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
  const file = managedBindingFile(env), root = path.dirname(file), { dataRoot } = managedSourceRoots(env);
  need(lstatSync(dataRoot).isDirectory() && isOwned(dataRoot));
  if (!lstatSync(root, { throwIfNoEntry: false })) {
    privateDirectory(root,false,{exclusive:true,validate:()=>{need(managedBindingFile(env)===file);}});
    const marker = path.join(root, '.ownership.json');
    writeFileSync(marker, markerText, { mode: 0o600, flag: 'wx' });
    syncFile(marker); syncDirectory(root); syncDirectory(dataRoot);
  }
  managedBindingFile(env);
  return file;
}
function sameFile(a:BigIntStats,b:BigIntStats|undefined) {
  return b?.isFile()&&a.ino!==0n&&a.dev===b.dev&&a.ino===b.ino&&a.birthtimeNs===b.birthtimeNs;
}
function stableFile(a:BigIntStats,b:BigIntStats|undefined) {
  return sameFile(a,b)&&!!b&&a.size===b.size&&a.nlink===b.nlink&&a.mode===b.mode&&
    a.uid===b.uid&&a.mtimeNs===b.mtimeNs&&a.ctimeNs===b.ctimeNs;
}
export function initialJournalStage(file:string,bytes:string|Uint8Array) {
  need(path.basename(file)==='migration.json');
  return `${file}.stage-prepare-${createHash('sha256').update(bytes).digest('hex')}`;
}
/** Physical evidence only: this bounded read grants neither path authority
 * nor permission to unlink. The journal owner validates both before recovery. */
export function readInitialJournalPair(file:string,maxBytes:number) {
  const before=lstatSync(file,{bigint:true,throwIfNoEntry:false});
  if(!before?.isFile()||before.nlink!==2n||before.ino===0n||before.size>BigInt(maxBytes))return;
  const fd=openSync(file,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
  try{
    if(!stableFile(before,fstatSync(fd,{bigint:true})))return;
    const buffer=Buffer.alloc(Number(before.size)+1),length=readSync(fd,buffer,0,buffer.length,0);
    if(BigInt(length)!==before.size)return;
    const bytes=buffer.subarray(0,length),stage=initialJournalStage(file,bytes);
    if(!stableFile(before,lstatSync(stage,{bigint:true,throwIfNoEntry:false}))||
      !stableFile(before,lstatSync(file,{bigint:true,throwIfNoEntry:false}))||
      !stableFile(before,fstatSync(fd,{bigint:true})))return;
    return {bytes,stage,stat:before};
  }finally{closeSync(fd);}
}
/** Call only after journal/request admission; never remove a replacement. */
export function finishInitialJournalPair(file:string,expected:NonNullable<ReturnType<typeof readInitialJournalPair>>,maxBytes:number) {
  const pair=readInitialJournalPair(file,maxBytes);
  need(pair&&stableFile(expected.stat,pair.stat)&&expected.bytes.equals(pair.bytes),'managed-migration-conflict');
  requirePlatformWriteBoundary();
  unlinkSync(pair.stage);
  syncDirectory(path.dirname(file));
  const final=lstatSync(file,{bigint:true});
  if(!sameFile(pair.stat,final)||final.nlink!==1n||final.size!==pair.stat.size||final.mtimeNs!==pair.stat.mtimeNs||
    lstatSync(pair.stage,{throwIfNoEntry:false}))throw new PlatformError('managed-step-unsettled');
}
/** Atomic publication; absent selectors use no-clobber publication, not replacement. */
export function publishPrivateJson(file: string, value: unknown, replace = false, initialJournal = false) {
  const bytes=JSON.stringify(value);
  need(!initialJournal||!replace);
  const stage=initialJournal?initialJournalStage(file,bytes):`${file}.stage-${randomUUID()}`;
  let created:BigIntStats|undefined;
  let failed=false;
  try {
    const fd=openSync(stage,'wx',0o600);
    try {created=fstatSync(fd,{bigint:true});writeFileSync(fd,bytes);fsyncSync(fd);}finally{closeSync(fd);}
    need(sameFile(created,lstatSync(stage,{bigint:true,throwIfNoEntry:false})));
    if (replace) renameSync(stage, file);
    else {
      linkSync(stage, file);
      need(sameFile(created,lstatSync(stage,{bigint:true,throwIfNoEntry:false})));
      unlinkSync(stage);
    }
    syncDirectory(path.dirname(file));
  } catch(e) {failed=true;throw e;} finally {
    try{if(created&&sameFile(created,lstatSync(stage,{bigint:true,throwIfNoEntry:false})))unlinkSync(stage);}catch(e){if(!failed)throw e;}
  }
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
  const bytes = readFileSync(file, 'utf8');
  let e: ManagedExpectation;
  try { e = JSON.parse(bytes) as ManagedExpectation; }
  catch { throw new ManagedBindingError('managed-migration-conflict'); }
  need(e.format === 1 && e.storeId === binding.storeId && e.sourceId === binding.source.id && e.installId === binding.installId &&
    typeof e.version === 'string' && /^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i.test(e.version) && /^[a-f0-9]{64}$/.test(e.fingerprint));
  return e;
}
export function writeManagedExpectation(binding: Binding, expectation: ManagedExpectation) {
  const file = managedExpectationFile(binding);
  const prior = readManagedExpectation(binding); // invalid private state is never overwritten
  publishPrivateJson(file, expectation, !!prior);
}
