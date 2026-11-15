import {closeSync,fstatSync,lstatSync,openSync,readSync,constants} from 'node:fs';
import path from 'node:path';
import {homedir} from 'node:os';
import {createServer,type Socket,type Server} from 'node:net';
import {writerTarget,writerTargetPort,withPlatformWriterTargets} from '../shared/platform.ts';
import {MANAGED_STEP_LIMITS} from '../shared/managed-steps.ts';

/** Bounded, non-authoritative routing read of fixed metadata only. The worker
 * still validates privacy, roots, bytes, Store identity and the held target key.
 * Unknown/changed metadata cannot authorize a mutation under the wrong lock. */
function routingDatabase(file:string):string|undefined {
  let fd:number|undefined;
  try{
    const before=lstatSync(file,{throwIfNoEntry:false});
    if(!before?.isFile()||before.isSymbolicLink()||before.nlink!==1||before.size>MANAGED_STEP_LIMITS.journalBytes)return;
    fd=openSync(file,constants.O_RDONLY|(constants.O_NOFOLLOW??0));const opened=fstatSync(fd);
    if(!opened.isFile()||opened.nlink!==1||opened.dev!==before.dev||opened.ino!==before.ino||opened.size>MANAGED_STEP_LIMITS.journalBytes)return;
    const bytes=Buffer.alloc(opened.size+1);const length=readSync(fd,bytes,0,bytes.length,0);
    if(length!==opened.size)return;
    const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,length)))?.database;
    if(typeof value==='string'&&value.length<=4096&&!value.includes('\0')&&path.isAbsolute(value)&&path.basename(value)==='progress.sqlite')return value;
  }catch{/* Missing/unreadable claims grant no Store slot; fresh work fails closed. */}
  finally{if(fd!==undefined)closeSync(fd);}
}

export function setupWriterTargets(env:NodeJS.ProcessEnv,database?:string):string[] {
  const dataRoot=path.join(env.XDG_DATA_HOME??path.join(env.HOME??homedir(),'.local/share'),'opencode');
  const root=path.join(dataRoot,'agent-progress-managed');
  const databases=[routingDatabase(path.join(root,'migration.json')),routingDatabase(path.join(root,'progress-binding.json')),database].filter((v):v is string=>!!v);
  if(!databases.length)databases.push(path.join(dataRoot,'openchamber-progress','progress.sqlite'));
  return [...new Set([writerTarget('scope',dataRoot),...databases.map(file=>writerTarget('store',path.dirname(file)))])];
}

/** Acquire all scope/Store slots in stable port order. No waiting/retry or
 * takeover: a collision fails closed and releases every already acquired slot. */
export async function acquireWriterSlots(targets:string[],connection:(socket:Socket)=>void=socket=>socket.destroy(),lateError?:()=>void):Promise<()=>Promise<void>> {
  const locks:Server[]=[];
  const release=async()=>{await Promise.all(locks.map(lock=>new Promise<void>(resolve=>lock.close(()=>resolve()))));};
  try{
    for(const port of [...new Set(targets.map(writerTargetPort))].sort((a,b)=>a-b)){
      const lock=createServer(connection);locks.push(lock);
      await new Promise<void>((resolve,reject)=>{
        let listening=false;
        lock.on('error',(error:NodeJS.ErrnoException)=>{
          if(listening){lateError?.();return;}
          reject(Object.assign(new Error('writer-refused'),{code:error.code==='EADDRINUSE'?'managed-step-port-busy':'managed-step-unsettled'}));
        });
        lock.listen({host:'127.0.0.1',port,exclusive:true},()=>{listening=true;resolve();});
      });
    }
    return release;
  }catch(error){await release();throw error;}
}
export async function withSetupWriter<T>(run:()=>T,targets:string[]):Promise<T> {
  const release=await acquireWriterSlots(targets);
  try{return withPlatformWriterTargets(targets,run);}finally{await release();}
}
