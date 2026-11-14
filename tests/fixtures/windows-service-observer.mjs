// Test-only preload for the UNMODIFIED built entry, inherited by its workers.
// Independent counters surround actual spawnSync calls, including failed attempts;
// never trust the product's accounting as the measurement of itself.
import fs from 'node:fs';
import http from 'node:http';
import cp from 'node:child_process';
import path from 'node:path';
import threads from 'node:worker_threads';
import {AsyncLocalStorage} from 'node:async_hooks';
import {syncBuiltinESMExports} from 'node:module';

const contexts=new AsyncLocalStorage(),startup=new Int32Array(new SharedArrayBuffer(8));
const inherited=threads.workerData?.nativeObserver;
const requests=new Map();
let settings={fault:null,latencyMs:0};
const send=message=>{if(threads.isMainThread&&process.connected)process.send(message);};
const context=()=>inherited??contexts.getStore();
const counter=()=>context()?.counts??startup;
const wait=ms=>Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,ms);
const spawn=cp.spawnSync;
cp.spawnSync=function(command,args,options){
  if(path.basename(command).toLowerCase()!=='powershell.exe')return spawn(command,args,options);
  const c=context(),first=Atomics.add(counter(),0,1)===0;
  if(first&&c?.hold){
    c.port?.postMessage('held');
    // Bounded synchronization, not a timing sleep: the parent proves concurrent
    // health before releasing this request's first security launch.
    if(Atomics.wait(c.gate,0,0,5000)==='timed-out')throw new Error('observer-health-release-timeout');
  }
  const started=performance.now(),input=typeof options?.input==='string'?JSON.parse(options.input):{};
  const creation=input.create?.some(p=>path.basename(p)==='agent-progress-managed');
  if(c?.settings?.fault==='overrun'){
    // A real late helper; do not honor the shortened wait in this injected case.
    // No product script runs and therefore no effect is possible after timeout.
    args=['-NoLogo','-NoProfile','-NonInteractive','-Command','[Threading.Thread]::Sleep(22000)'];
    options={...options,timeout:25000};
  }else if(creation&&c?.settings?.fault==='timeout'){
    args=['-NoLogo','-NoProfile','-NonInteractive','-Command','[Threading.Thread]::Sleep(10000)'];
    options={...options,timeout:100};
  }else if(creation&&c?.settings?.fault==='private'){
    const result=JSON.stringify(input.paths.map(()=>({owned:true,private:false,reparse:false,unsafeParent:false})));
    args=['-NoLogo','-NoProfile','-NonInteractive','-Command',`[Console]::Out.Write('${result}')`];
  }
  try{return spawn(command,args,options);}
  finally{
    // Total helper latency (not 2.5s plus native launch time). Real ACL checks,
    // mutation and the production monotonic deadline remain in force.
    const remaining=(c?.settings?.latencyMs??0)-(performance.now()-started);
    if(remaining>0)wait(remaining);
  }
};
const read=fs.readFileSync;
fs.readFileSync=function(file,...args){
  if(String(file).replaceAll('\\','/').includes('/plugins/agent-progress/'))Atomics.add(counter(),1,1);
  return read(file,...args);
};
if(threads.isMainThread){
  const Worker=threads.Worker;
  threads.Worker=class extends Worker {
    constructor(entry,options={}){
      const c=contexts.getStore();
      if(!c){super(entry,options);return;}
      const {port1,port2}=new threads.MessageChannel();
      super(entry,{...options,workerData:{...options.workerData,nativeObserver:{counts:c.counts,gate:c.gate,hold:c.hold,settings:{...settings},port:port2}},
        transferList:[...(options.transferList??[]),port2]});
      c.workers++;
      port1.on('message',message=>{if(message==='held')send({kind:'held',id:c.id});});
      this.once('exit',()=>{port1.close();send({kind:'worker-exit',id:c.id,queries:Atomics.load(c.counts,0),legacyReads:Atomics.load(c.counts,1)});});
    }
  };
  // Wrap emit, rather than a request listener: ALS must encompass ALL listeners
  // and the async writer acquisition that eventually constructs the Worker.
  const emit=http.Server.prototype.emit;
  http.Server.prototype.emit=function(event,...args){
    if(event!=='request')return emit.call(this,event,...args);
    const [req,res]=args,id=String(req.headers['x-native-request']??'');
    const c={id,counts:new Int32Array(new SharedArrayBuffer(8)),gate:new Int32Array(new SharedArrayBuffer(4)),hold:req.headers['x-native-hold']==='1',workers:0,settings:{...settings}};
    requests.set(id,c);const start=performance.now();
    res.once('finish',()=>{
      send({kind:'request',id,queries:Atomics.load(c.counts,0),legacyReads:Atomics.load(c.counts,1),workers:c.workers,elapsedMs:Math.round(performance.now()-start)});
      requests.delete(id);
    });
    return contexts.run(c,()=>emit.call(this,event,...args));
  };
  const listen=http.Server.prototype.listen;
  http.Server.prototype.listen=function(...args){
    send({kind:'before-listen',queries:Atomics.load(startup,0),legacyReads:Atomics.load(startup,1)});
    this.once('listening',()=>send({kind:'listening'}));
    return listen.apply(this,args);
  };
  process.on('message',message=>{
    if(message?.kind==='settings'&&[null,'timeout','private','overrun'].includes(message.fault)&&[0,2500].includes(message.latencyMs)){
      settings={fault:message.fault,latencyMs:message.latencyMs};send({kind:'settings-set'});
    }else if(message?.kind==='release'){
      const c=requests.get(String(message.id));if(c){Atomics.store(c.gate,0,1);Atomics.notify(c.gate,0);}
    }
  });
}else inherited?.port.unref();
syncBuiltinESMExports();
