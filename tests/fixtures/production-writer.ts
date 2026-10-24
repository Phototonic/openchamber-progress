import { Store, storageError } from '../../shared/store.ts';
import type { Actor } from '../../shared/progress.ts';
const [file,mode,oid]=process.argv.slice(2);
const actor:Actor={sourceId:'source-fixture',sessionId:'M',agent:'build',directory:'/fixture/Alpha',projectId:'Alpha',parentId:null,ancestry:[],verifiedSource:true};
const store=new Store(file);
const input={op:'change',plan:'P1',oid,rev:1,changes:[{id:'I4',status:'done'}]};
try{
  if(mode==='before'){
    store.db.function('qa_pause',()=>{process.send?.({phase:'before-commit'});Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);return 0;});
    store.db.exec('CREATE TEMP TRIGGER qa_before BEFORE INSERT ON receipts BEGIN SELECT qa_pause(); END;');
  }
  if(mode==='hold'){store.db.exec('BEGIN IMMEDIATE');process.send?.({phase:'locked'});Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);}
  const receipt=store.apply(input,actor);
  if(mode==='after'){process.send?.({phase:'after-commit'});Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);}
  process.send?.({phase:'finished',receipt});store.close();process.disconnect?.();
}catch(e){process.send?.({phase:'failed',code:storageError(e).code});store.close();process.disconnect?.();}
