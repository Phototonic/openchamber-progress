import { constants, realpathSync, openSync, closeSync, fstatSync, lstatSync, readSync } from 'node:fs';
import path from 'node:path';
import { LIMITS, type Capture, type DocumentRef } from '../shared/progress.ts';
import { digest } from '../shared/store.ts';

/** Caller authorization is mandatory and happens before any document-byte read. */
export async function captureDocument(reference: string, directory: string, authorize: (resource: string) => Promise<void>, previous?: DocumentRef): Promise<Capture> {
  const requested = path.resolve(directory, reference); const checkedAt = new Date().toISOString();
  const result = (state: Capture['state'], canonicalPath?: string): Capture => ({ state,path:requested,checkedAt,...(canonicalPath ? {canonicalPath} : {}) });
  if(process.platform!=='linux')return result('unavailable');
  let fd: number | undefined;
  try {
    await authorize(requested);
    const canonicalPath = realpathSync(requested);
    await authorize(canonicalPath);
    if (previous?.canonicalPath && canonicalPath !== previous.canonicalPath) return result('moved',canonicalPath);
    fd = openSync(canonicalPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    // OpenCode has an authorization API, not a mediated file reader. Check the
    // actual opened target before bytes; unsupported platforms fail closed.
    let actual: string; try { actual = realpathSync(`/proc/self/fd/${fd}`); } catch { return result('unavailable'); }
    if (actual !== canonicalPath || realpathSync(requested) !== canonicalPath) return result('changed-during-read');
    const before = fstatSync(fd,{bigint:true}); const current = lstatSync(canonicalPath,{bigint:true});
    if (!before.isFile()) return result('non-text',canonicalPath);
    if (before.dev !== current.dev || before.ino !== current.ino) return result('changed-during-read');
    if (before.size > BigInt(LIMITS.documentBytes)) return result('oversized',canonicalPath);
    const bytes = Buffer.alloc(LIMITS.documentBytes+1); let offset = 0;
    while (offset < bytes.length) { const n = readSync(fd,bytes,offset,bytes.length-offset,null); if (!n) break; offset += n; }
    if (offset > LIMITS.documentBytes) return result('oversized',canonicalPath);
    const after = fstatSync(fd,{bigint:true}); const still = lstatSync(canonicalPath,{bigint:true});
    if (before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs || after.ino !== still.ino || after.dev !== still.dev || realpathSync(requested) !== canonicalPath) return result('changed-during-read');
    let text: string; try { text = new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes.subarray(0,offset)); } catch { return result('non-text',canonicalPath); }
    if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text)) return result('non-text',canonicalPath);
    return {...result('captured',canonicalPath),text,hash:digest(bytes.subarray(0,offset))};
  } catch (e) {
    const code = (e as {code?: string}).code;
    return result(code === 'ENOENT' || code === 'ENOTDIR' ? 'missing' : code === 'ELOOP' ? 'changed-during-read' : 'denied');
  } finally { if (fd !== undefined) closeSync(fd); }
}
