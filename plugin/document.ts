import { constants, realpathSync, openSync, closeSync, fstatSync, lstatSync, readSync } from 'node:fs';
import path from 'node:path';
import { LIMITS, type Capture, type DocumentRef } from '../shared/progress.ts';
import { digest } from '../shared/store.ts';
import { windowsDocumentPath, platformSecurityScope } from '../shared/platform.ts';
import type { BigIntStats } from 'node:fs';

/** Caller authorization is mandatory and happens before any document-byte read. */
export async function captureDocument(reference: string, directory: string, authorize: (resource: string) => Promise<void>, previous?: DocumentRef): Promise<Capture> {
  if(process.platform==='win32')return captureWindowsDocument(reference,directory,authorize,previous);
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

function sameFile(a:BigIntStats,b:BigIntStats) {return a.dev===b.dev&&a.ino===b.ino;}
function unchanged(a:BigIntStats,b:BigIntStats) {return sameFile(a,b)&&a.size===b.size&&a.mtimeNs===b.mtimeNs&&a.ctimeNs===b.ctimeNs;}
function ancestors(file:string) {
  const result=new Map<string,BigIntStats>();
  for(let p=path.dirname(file);;p=path.dirname(p)){
    const stat=lstatSync(p,{bigint:true});if(!stat.isDirectory()||stat.isSymbolicLink())throw new Error('unsupported-path');
    result.set(p,stat);if(path.dirname(p)===p)break;
  }
  return result;
}
/** Ordinary Windows file identity/mutation checks; no final-HANDLE-path claim. */
async function captureWindowsDocument(reference:string,directory:string,authorize:(resource:string)=>Promise<void>,previous?:DocumentRef):Promise<Capture> {
  const requested=path.resolve(directory,reference);const checkedAt=new Date().toISOString();
  const result=(state:Capture['state'],canonicalPath?:string):Capture=>({state,path:requested,checkedAt,...(canonicalPath?{canonicalPath}:{})});
  let fd:number|undefined;
  try{
    await authorize(requested);
    // Do not conceal traversal, ADS, reserved names or device paths by resolve().
    const raw=path.isAbsolute(reference)?reference:directory+'\\'+reference;
    const canonicalPath=platformSecurityScope(()=>windowsDocumentPath(raw,true));
    await authorize(canonicalPath);
    if(previous?.canonicalPath&&canonicalPath!==previous.canonicalPath)return result('moved',canonicalPath);
    const bound=lstatSync(canonicalPath,{bigint:true});
    if(platformSecurityScope(()=>windowsDocumentPath(raw))!==canonicalPath)return result('changed-during-read');
    if(!bound.isFile()||bound.isSymbolicLink())return result('non-text',canonicalPath);
    const parents=ancestors(canonicalPath);
    if(bound.size>BigInt(LIMITS.documentBytes))return result('oversized',canonicalPath);
    fd=openSync(canonicalPath,constants.O_RDONLY);
    const before=fstatSync(fd,{bigint:true});const current=lstatSync(canonicalPath,{bigint:true});
    if(!before.isFile()||before.ino===0n||!unchanged(bound,before)||!unchanged(before,current)||platformSecurityScope(()=>windowsDocumentPath(raw))!==canonicalPath)return result('changed-during-read');
    for(const[p,stat]of parents)if(!sameFile(stat,lstatSync(p,{bigint:true})))return result('changed-during-read');
    const bytes=Buffer.alloc(LIMITS.documentBytes+1);let offset=0;
    while(offset<bytes.length){const n=readSync(fd,bytes,offset,bytes.length-offset,null);if(!n)break;offset+=n;}
    if(offset>LIMITS.documentBytes)return result('oversized',canonicalPath);
    const after=fstatSync(fd,{bigint:true}),still=lstatSync(canonicalPath,{bigint:true});
    if(!still.isFile()||still.isSymbolicLink()||!unchanged(before,after)||!unchanged(after,still)||platformSecurityScope(()=>windowsDocumentPath(raw))!==canonicalPath)return result('changed-during-read');
    for(const[p,stat]of parents)if(!sameFile(stat,lstatSync(p,{bigint:true})))return result('changed-during-read');
    let text:string;try{text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes.subarray(0,offset));}catch{return result('non-text',canonicalPath);}
    if(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text))return result('non-text',canonicalPath);
    return{...result('captured',canonicalPath),text,hash:digest(bytes.subarray(0,offset))};
  }catch(e){const code=(e as{code?:string}).code;return result(code==='ENOENT'||code==='ENOTDIR'?'missing':code==='ELOOP'||code==='symlink-escape'?'changed-during-read':'denied');}
  finally{if(fd!==undefined)closeSync(fd);}
}
