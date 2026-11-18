// Test-only preload for the UNMODIFIED built entry, inherited by its workers.
// Independent counters surround every child-process launch, including failed
// attempts; never trust the product's accounting as the measurement of itself.
// The service must start none, so any non-zero count is a failure.
import fs from 'node:fs';
import http from 'node:http';
import cp from 'node:child_process';
import threads from 'node:worker_threads';
import {AsyncLocalStorage} from 'node:async_hooks';
import {syncBuiltinESMExports} from 'node:module';

const contexts=new AsyncLocalStorage(),startup=new Int32Array(new SharedArrayBuffer(8));
const inherited=threads.workerData?.nativeObserver;
const send=message=>{if(threads.isMainThread&&process.connected)process.send(message);};
const context=()=>inherited??contexts.getStore();
const counter=()=>context()?.counts??startup;
for(const name of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork']){
  const original=cp[name];
  cp[name]=function(...args){Atomics.add(counter(),0,1);return original.apply(this,args);};
}
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
      super(entry,{...options,workerData:{...options.workerData,nativeObserver:{counts:c.counts}}});
      c.workers++;
      this.once('exit',()=>{send({kind:'worker-exit',id:c.id,queries:Atomics.load(c.counts,0),legacyReads:Atomics.load(c.counts,1)});});
    }
  };
  // Wrap emit, rather than a request listener: ALS must encompass ALL listeners
  // and the async writer acquisition that eventually constructs the Worker.
  const emit=http.Server.prototype.emit;
  http.Server.prototype.emit=function(event,...args){
    if(event!=='request')return emit.call(this,event,...args);
    const [req,res]=args,id=String(req.headers['x-native-request']??'');
    const c={id,counts:new Int32Array(new SharedArrayBuffer(8)),workers:0};
    const start=performance.now();
    res.once('finish',()=>{
      send({kind:'request',id,queries:Atomics.load(c.counts,0),legacyReads:Atomics.load(c.counts,1),workers:c.workers,elapsedMs:Math.round(performance.now()-start)});
    });
    return contexts.run(c,()=>emit.call(this,event,...args));
  };
  const listen=http.Server.prototype.listen;
  http.Server.prototype.listen=function(...args){
    send({kind:'before-listen',queries:Atomics.load(startup,0),legacyReads:Atomics.load(startup,1)});
    this.once('listening',()=>send({kind:'listening'}));
    return listen.apply(this,args);
  };
}
syncBuiltinESMExports();
