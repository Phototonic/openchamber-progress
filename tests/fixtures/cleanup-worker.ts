import { Store, storageError } from '../../shared/store.ts';
const [file,mode,inputJson,actorJson,captureJson]=process.argv.slice(2);
const store=new Store(file,{busyMs:200});
const input=JSON.parse(inputJson);
try {
  if(mode==='before') {
    store.db.function('qa_pause',()=>{process.send?.({phase:'before-commit'});Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);return 0;});
    store.db.exec('CREATE TEMP TRIGGER qa_pause_cleanup BEFORE INSERT ON cleanup_state BEGIN SELECT qa_pause(); END');
  }
  if(mode==='hold'){store.db.exec('BEGIN IMMEDIATE');process.send?.({phase:'locked'});Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);}
  const receipt=mode==='reopen'?store.apply(input,JSON.parse(actorJson),captureJson?JSON.parse(captureJson):undefined):store.cleanup(input.action,input.body);
  if(mode==='after'){process.send?.({phase:'after-commit'});Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);}
  process.send?.({phase:'result',receipt});
}catch(e){process.send?.({phase:'result',error:storageError(e).code});}
finally{store.close();process.disconnect?.();}
