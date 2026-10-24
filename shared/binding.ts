import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { VERSION, requireProgress as need, type Source } from './progress.ts';
import type { Store } from './store.ts';
export interface Binding { protocolVersion: 2; schemaVersion: 2; installId: string; version: string; database: string; storeId: string; source: Source }
export function readBinding(file: string | URL): Binding {
  const p = file instanceof URL ? file : path.resolve(file);
  const stat = lstatSync(p); need(!stat.isSymbolicLink() && stat.isFile() && stat.uid===process.getuid?.() && (stat.mode & 0o777) === 0o600, 'binding');
  const b = JSON.parse(readFileSync(p,'utf8')) as Binding;
  need(b.protocolVersion === VERSION && b.schemaVersion === VERSION, 'schema');
  need(typeof b.installId === 'string' && typeof b.version === 'string' && typeof b.storeId === 'string' && path.isAbsolute(b.database) && path.basename(b.database) === 'progress.sqlite', 'binding');
  need(b.source && typeof b.source.id === 'string' && typeof b.source.verified === 'boolean', 'binding');
  for (const root of [path.dirname(b.database), b.source.configRoot, b.source.dataRoot]) need(path.isAbsolute(root) && realpathSync(root) === root, 'binding');
  return b;
}
export function verifyStore(store: Store, b: Binding) {
  const envelope = store.list({limit:1}); need(envelope.storeId === b.storeId && envelope.sources.some(s => s.id === b.source.id && s.configRoot === b.source.configRoot && s.dataRoot === b.source.dataRoot && s.verified === b.source.verified),'binding');
}
