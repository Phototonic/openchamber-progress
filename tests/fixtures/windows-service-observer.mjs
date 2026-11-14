// Test-only preload for the UNMODIFIED built entry. IPC carries fixed counters,
// never paths, command output, auth, or store content. No product test switch.
import fs from 'node:fs';
import http from 'node:http';
import cp from 'node:child_process';
import path from 'node:path';
import {syncBuiltinESMExports} from 'node:module';

let queries=0,legacyReads=0,fault=null;
const send=message=>{if(process.connected)process.send(message);};
const spawn=cp.spawnSync;
cp.spawnSync=function(command,args,options){
  if(path.basename(command).toLowerCase()==='powershell.exe'){
    queries++;
    const input=typeof options?.input==='string'?JSON.parse(options.input):{};
    if(input.create?.some(p=>path.basename(p)==='agent-progress-managed')){
      if(fault==='timeout')return {pid:0,output:[],stdout:'',stderr:'',status:null,signal:'SIGTERM',error:Object.assign(new Error('synthetic'),{code:'ETIMEDOUT'})};
      if(fault==='private')return {pid:0,output:[],stdout:JSON.stringify(input.paths.map(()=>({owned:true,private:false,reparse:false,unsafeParent:false}))),stderr:'',status:0,signal:null};
    }
  }
  return spawn(command,args,options);
};
const read=fs.readFileSync;
fs.readFileSync=function(file,...args){
  if(String(file).replaceAll('\\','/').includes('/plugins/agent-progress/'))legacyReads++;
  return read(file,...args);
};
const listen=http.Server.prototype.listen;
http.Server.prototype.listen=function(...args){
  send({kind:'before-listen',queries,legacyReads});
  this.once('listening',()=>send({kind:'listening'}));
  this.prependListener('request',(req,res)=>{
    const before={queries,legacyReads},start=performance.now();
    const route=['/health','/v1/setup','/v1/setup/managed-inspect','/v1/setup/managed-migrate','/v1/plans'].includes(req.url)?req.url:'other';
    res.once('finish',()=>send({kind:'request',route,queries:queries-before.queries,legacyReads:legacyReads-before.legacyReads,elapsedMs:Math.round(performance.now()-start)}));
  });
  return listen.apply(this,args);
};
process.on('message',message=>{
  if(message?.kind==='fault'&&[null,'timeout','private'].includes(message.value)){
    fault=message.value;send({kind:'fault-set'});
  }
});
syncBuiltinESMExports();
