import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { windows, windowsPath, windowsPaths, privatePaths, platformSecurityScope, sameWindowsDirectory, sameWindowsObject, isOwned } from './platform.ts';
import { VERSION, requireProgress as need, type Source } from './progress.ts';
import type { Store } from './store.ts';
export interface Binding { protocolVersion: 2; schemaVersion: 2; installId: string; version: string; database: string; storeId: string; source: Source }
export function readBinding(file: string | URL): Binding {
  return platformSecurityScope(()=>readBindingInner(file));
}
function readBindingInner(file: string | URL): Binding {
  const p = file instanceof URL ? file : path.resolve(file);
  const stat = lstatSync(p); need(!stat.isSymbolicLink() && stat.isFile() && (windows?sameWindowsObject(windowsPath(file instanceof URL?fileURLToPath(file):file),realpathSync.native(p))&&privatePaths([realpathSync.native(p)]):stat.uid===process.getuid?.() && (stat.mode & 0o777) === 0o600), 'binding');
  const b = JSON.parse(readFileSync(p,'utf8')) as Binding;
  need(b.protocolVersion === VERSION && b.schemaVersion === VERSION, 'schema');
  need(typeof b.installId === 'string' && typeof b.version === 'string' && typeof b.storeId === 'string' && path.isAbsolute(b.database) && path.basename(b.database) === 'progress.sqlite', 'binding');
  need(b.source && typeof b.source.id === 'string' && typeof b.source.verified === 'boolean', 'binding');
  const roots=[path.dirname(b.database),b.source.configRoot,b.source.dataRoot];
  if(windows){const resolved=windowsPaths(roots);need(resolved.every((v,i)=>sameWindowsDirectory(v,roots[i]!)&&isOwned(v)),'binding');}
  else for (const root of roots) need(path.isAbsolute(root) && realpathSync(root) === root, 'binding');
  return b;
}
export function verifyStore(store: Store, b: Binding) {
  const envelope = store.list({limit:1}); need(envelope.storeId === b.storeId && envelope.sources.some(s => s.id === b.source.id && s.configRoot === b.source.configRoot && s.dataRoot === b.source.dataRoot && s.verified === b.source.verified),'binding');
}
