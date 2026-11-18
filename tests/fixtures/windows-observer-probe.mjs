// Portable verification of the native observer, NOT simulated Windows acceptance.
import {isMainThread,Worker,parentPort} from 'node:worker_threads';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {createServer} from 'node:http';
if(!isMainThread){
  // Two real failed launches: the observer must count both, independently of
  // any production accounting. The absolute nonexistent path prevents PATH use.
  for(let i=0;i<2;i++)spawnSync('/nonexistent-observer-fixture/helper',[],{encoding:'utf8'});
  try{readFileSync('/nonexistent-observer-fixture/plugins/agent-progress/index.js');}catch{}
  parentPort.postMessage({ok:true});
}else{
  const server=createServer(async(req,res)=>{
    if(req.headers.authorization!=='Bearer fixture-only'){res.writeHead(401);res.end('{}');return;}
    if(req.url==='/health'){res.end(JSON.stringify({state:'starting',ready:false,sqlite:false,managedMigrationSteps:1}));return;}
    let body='';for await(const part of req)body+=part;
    if(JSON.parse(body||'{}').mainThread){
      spawnSync('/nonexistent-observer-fixture/helper',[],{encoding:'utf8'});
      res.end('{"ok":true}');return;
    }
    const worker=new Worker(new URL(import.meta.url));await new Promise((resolve,reject)=>{worker.once('exit',resolve);worker.once('error',reject);});
    res.end('{"ok":true}');
  });
  server.listen(Number(process.env.OPENCHAMBER_SERVICE_PORT),'127.0.0.1');
  process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
}
